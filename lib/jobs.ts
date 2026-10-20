// Shared plumbing for scheduled jobs: bearer-secret check, a job_runs row per run (per organisation), structured
// logs, and an e-mail alert when a run fails: to the org's alert address (Settings → E-mail) and to the platform's
// (ALERT_EMAIL, through the platform's mailer).
import { timingSafeEqual } from 'crypto'
import { eq } from 'drizzle-orm'
import { jobRuns } from '@/lib/db/schema'
import { withOrgSystem } from '@/lib/db/withTenant'
import { log } from '@/lib/log'
import { getConfig } from '@/lib/config/store'
import { platformMailer, providerFor } from '@/lib/notify/providers'
import { serverSecret } from '@/lib/auth/secret'

/** True when the request carries `Authorization: Bearer $CRON_SECRET`. */
export function jobAuthorized(req: Request): boolean {
  let secret: string
  try { secret = serverSecret('CRON_SECRET') } catch { return false } // unset or too short: outside job calls stay off
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const a = Buffer.from(given), b = Buffer.from(secret ?? '')
  return !!secret && a.length === b.length && timingSafeEqual(a, b)
}

export type JobOutcome = { ok: boolean; summary: Record<string, unknown> }

/** Runs `fn` for one org, records the run in that org's job_runs, logs it, and alerts on failure. Never throws. */
export async function runJob(orgId: string, job: string, fn: () => Promise<JobOutcome>): Promise<JobOutcome & { error?: string }> {
  const [run] = await withOrgSystem(orgId, (tx) => tx.insert(jobRuns).values({ job }).returning({ id: jobRuns.id }))
  const t0 = Date.now()
  let outcome: JobOutcome & { error?: string }
  try {
    outcome = await fn()
  } catch (e) {
    outcome = { ok: false, summary: {}, error: e instanceof Error ? e.message : String(e) }
  }
  await withOrgSystem(orgId, (tx) =>
    tx.update(jobRuns).set({ finishedAt: new Date(), ok: outcome.ok, summary: outcome.summary, error: outcome.error ?? null }).where(eq(jobRuns.id, run.id)),
  )
  const fields = { orgId, job, ms: Date.now() - t0, ...outcome.summary, ...(outcome.error ? { error: outcome.error } : {}) }
  if (outcome.ok) log.info('job.ok', fields)
  else {
    log.error('job.failed', fields)
    await alert(orgId, `Scheduled job "${job}" failed`, JSON.stringify(fields, null, 2))
  }
  return outcome
}

async function alert(orgId: string, subject: string, body: string) {
  const send = async (to: string | undefined, mail: Awaited<ReturnType<typeof providerFor>>) => {
    if (!to || !mail) return
    const r = await mail.send({ channel: 'email', to, body: `${subject}\n\n${body}`, template: 'ops_alert' }).catch((e: unknown) => ({ ok: false, error: String(e) }))
    if (!r.ok) log.warn('alert.not_sent', { orgId, subject, error: 'error' in r ? r.error : undefined })
  }
  const orgTo = await getConfig(orgId, 'email').then((c) => c.config.alertEmail).catch(() => '')
  await send(orgTo, await providerFor(orgId, 'email').catch(() => null))
  await send(process.env.ALERT_EMAIL, platformMailer())
}
