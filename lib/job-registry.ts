// The daily jobs, in one place. Each runs for ONE organisation at a time (its own data, settings and mail servers):
// by the panel's own scheduler (lib/scheduler.ts) at the times the org set in Settings → Scheduled jobs, by "Run
// now" there, or by an outside cron calling /api/jobs/<name> (every open org, one after another).
import { getConfig, type JobKey } from '@/lib/config/store'
import { withOrgSystem } from '@/lib/db/withTenant'
import { runJob } from '@/lib/jobs'
import { log } from '@/lib/log'
import { providerFor, type Channel } from '@/lib/notify/providers'
import { forEachOrg } from '@/lib/tenant/orgs'
import { deliverPendingWebhooks } from '@/modules/integrations/webhooks'
import { dispatchQueued, generateFeeReminders } from '@/modules/notifications/service'
import { queueBirthdayWishes } from '@/modules/notifications/birthday'
import { reconcile } from '@/modules/ops/reconcile'
import { purgeExpired } from '@/modules/ops/recycle'
import { pruneLoginLog } from '@/modules/auth/guard'
import { sendEscalationDigest } from '@/modules/overdues/digest'

type JobResult = { ok: boolean; summary: Record<string, unknown> }

/** An org's providers, in the shape the message queue asks for. */
const orgProviders = (orgId: string) => (c: Channel, branchId?: string | null) => providerFor(orgId, c, branchId)

export const JOBS: Record<JobKey, { label: string; what: string; run: (orgId: string) => Promise<JobResult> }> = {
  reminders: {
    label: 'Fee reminders & birthday wishes',
    what: 'Queues the day’s fee reminders (Settings → Reminders) and the birthday e-mails of students whose birthday it is, and sends them on the channels that are set up.',
    async run(orgId) {
      const cfg = (await getConfig(orgId, 'reminders')).config
      const gen = await withOrgSystem(orgId, (tx) => generateFeeReminders(tx, cfg))
      const bday = await withOrgSystem(orgId, (tx) => queueBirthdayWishes(tx))
      const sent = await withOrgSystem(orgId, (tx) => dispatchQueued(tx, orgProviders(orgId)))
      const ready = await Promise.all(cfg.channels.map(async (c) => [c, !!(await providerFor(orgId, c))] as const))
      return { ok: true, summary: { channels: cfg.channels.join(', '), notSetUp: ready.filter(([, on]) => !on).map(([c]) => c).join(', ') || null, ...gen, ...bday, ...sent } }
    },
  },
  reconcile: {
    label: 'Money check',
    what: 'Checks every branch’s payments, receipts and ledger agree. Read-only; a mismatch marks the run failed and alerts head office.',
    async run(orgId) {
      const res = await withOrgSystem(orgId, (tx) => reconcile(tx))
      return { ok: res.problems.length === 0, summary: { branches: res.branches, payments: res.payments, problems: res.problems.slice(0, 50), problemCount: res.problems.length } }
    },
  },
  purge: {
    label: 'Empty the Recycle Bin',
    what: 'Removes for good what has been in the Recycle Bin for more than 30 days. Anything with payments, receipts or a certificate is never removed. Also drops sign-in log entries older than 180 days.',
    run: async (orgId) => { await pruneLoginLog(orgId); return purgeExpired(orgId) },
  },
  escalations: {
    label: 'Overdue escalations',
    what: 'E-mails each branch manager the overdue leads and fees that have reached them, and head office what has reached head office (days set in Settings → Rules). The same lists are on the Overdues page.',
    run: (orgId) => sendEscalationDigest(orgId),
  },
}

/** Runs one org's job now, recorded in its job_runs (and alerting on failure). */
export const runNamedJob = (orgId: string, key: JobKey) => runJob(orgId, key, () => JOBS[key].run(orgId))

/** Runs a job for every open org, one after another (the outside cron's /api/jobs/<name>). */
export async function runJobForAllOrgs(key: JobKey) {
  const runs = await forEachOrg(async (org) => ({ org: org.slug, ...(await runNamedJob(org.id, key)) }), (org, e) => log.error('job.org_failed', { job: key, org: org.slug, error: String(e) }))
  return { ok: runs.every((r) => r.ok), orgs: runs.length, failed: runs.filter((r) => !r.ok).map((r) => r.org) }
}

/** Sends an org's webhook deliveries that are due (every minute by the scheduler). Deliveries keep their own log. */
export const deliverWebhooks = (orgId: string) => deliverPendingWebhooks(orgId)

/**
 * Sends an org's queued messages (every minute by the scheduler), so a WhatsApp "thank you for visiting" goes out
 * while the person is still at the desk, not with the next day's reminders. Rows being sent elsewhere are skipped
 * (SKIP LOCKED).
 */
export async function deliverMessages(orgId: string, budgetMs = 40_000) {
  // batches of 50, each saved as it goes, for up to the budget: a Bulk WhatsApp send of thousands goes out in
  // minutes; stops when a batch is not full of messages that went out (nothing more, or the channel is not set up)
  const until = Date.now() + budgetMs
  const total = { sent: 0, failed: 0, waiting: 0 }
  for (;;) {
    const r = await withOrgSystem(orgId, (tx) => dispatchQueued(tx, orgProviders(orgId), 50))
    total.sent += r.sent; total.failed += r.failed; total.waiting = r.waiting
    if (r.sent + r.failed < 50 || Date.now() > until) return total
  }
}
