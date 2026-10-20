import { webLeadsSecretFor } from '@/lib/tenant/web-leads-secret'
import 'server-only'
// Integrations: the outside services the panel works with, whether each one is set up, and what it did lately.
// Only yes/no is read from the settings (never a value), so nothing secret reaches the page.
import { sql } from 'drizzle-orm'
import { can } from '@/lib/auth/permissions'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { getConfig } from '@/lib/config/store'
import { providerFor } from '@/lib/notify/providers'

export type Integration = {
  key: string; name: string; what: string
  state: 'on' | 'off' | 'warn'
  status: string
  setup: string // how to switch it on or fix it
  facts: { label: string; value: string }[]
}
export type IntegrationsData = {
  items: Integration[]
  sites: { host: string; total: number; waiting: number; last: string | null; branch: string | null }[]
  jobs: { job: string; when: string | null; ok: boolean | null; error: string | null }[]
  outbox: { queued: number; sent: number; failed: number }
}

const set = (...names: string[]) => names.every((n) => !!process.env[n]?.trim())
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : null)

export async function integrations(tx: Tx, actor: Actor): Promise<IntegrationsData> {
  const isSuper = actor.role === 'super_admin'
  const rows = async <T>(q: ReturnType<typeof sql>) => (await tx.execute<T & Record<string, unknown>>(q)).rows

  const sites = can(actor, 'read', 'weblead')
    ? (await rows<{ host: string; total: number; waiting: number; last: string | null; branch: string | null }>(sql`
        select w.site_host as host, count(*)::int as total, count(*) filter (where w.branch_id is null)::int as waiting,
          max(w.submitted_at)::text as last, min(b.name) as branch
        from web_leads w left join branches b on b.website_host = w.site_host group by w.site_host order by w.site_host`))
        .map((s) => ({ ...s, total: Number(s.total), waiting: Number(s.waiting), last: when(s.last) }))
    : []
  const jobs = isSuper
    ? (await rows<{ job: string; started_at: string | null; ok: boolean | null; error: string | null }>(sql`
        select distinct on (job) job, started_at::text, ok, error from job_runs order by job, started_at desc`))
        .map((j) => ({ job: j.job, when: when(j.started_at), ok: j.ok, error: j.error }))
    : []
  const [o] = await rows<{ queued: number; sent: number; failed: number }>(sql`
    select count(*) filter (where status = 'queued')::int as queued, count(*) filter (where status = 'sent')::int as sent, count(*) filter (where status = 'failed')::int as failed
    from notifications where created_at > now() - interval '30 days'`)
  const outbox = { queued: Number(o?.queued ?? 0), sent: Number(o?.sent ?? 0), failed: Number(o?.failed ?? 0) }

  const webOn = !!webLeadsSecretFor(actor.orgId)
  const lastLead = sites.map((s) => s.last).filter(Boolean).sort().at(-1) ?? null
  const email = await providerFor(actor.orgId, 'email'), wa = await providerFor(actor.orgId, 'whatsapp'), sms = await providerFor(actor.orgId, 'sms')
  const smtp = email?.name === 'smtp', sendgrid = email?.name === 'sendgrid'
  const rem = (await getConfig(actor.orgId, 'reminders')).config
  const ready = await Promise.all(rem.channels.map(async (c) => [c, !!(await providerFor(actor.orgId, c))] as const))
  const channel = rem.channels.join(', ') || 'no channel'
  const reminderReady = ready.length > 0 && ready.every(([, on]) => on)
  const jobsCfg = (await getConfig(actor.orgId, 'jobs')).config
  const cronOn = jobsCfg.scheduler === 'panel' || set('CRON_SECRET')
  const jobFailed = jobs.some((j) => j.ok === false)

  const items: Integration[] = [
    {
      key: 'web', name: 'Website leads', state: webOn ? (sites.length ? 'on' : 'warn') : 'off',
      what: 'Every enquiry form filled on the institute websites comes here by itself, under Web Leads, and becomes a lead in the branch that owns the website.',
      status: webOn ? (sites.length ? `Receiving from ${sites.length} website${sites.length === 1 ? '' : 's'}` : 'Ready, but no website has sent a lead yet') : 'Off',
      setup: 'The panel needs WEBLEADS_SECRET (24+ characters). Each website’s CMS needs WEBLEADS_URL (this panel’s address) and the same WEBLEADS_SECRET. Set a branch’s website under Branches so its leads go straight to it.',
      facts: [{ label: 'Websites', value: String(sites.length) }, { label: 'Leads received', value: sites.reduce((n, s) => n + s.total, 0).toLocaleString('en-IN') }, { label: 'Waiting for a branch', value: String(sites.reduce((n, s) => n + s.waiting, 0)) }, { label: 'Last lead', value: lastLead ?? '—' }],
    },
    {
      key: 'email', name: 'E-mail', state: smtp || sendgrid ? 'on' : 'off',
      what: 'Sends branch logins, “forgot password” links, two-step sign-in codes and, when chosen, fee reminders.',
      status: smtp ? 'On: SMTP mailbox' : sendgrid ? 'On: SendGrid' : 'Off — logins and password resets cannot be e-mailed',
      setup: 'Settings → E-mail: the mail server, its login and the sender address. Send a test e-mail there.',
      facts: [{ label: 'Service', value: smtp ? 'SMTP' : sendgrid ? 'SendGrid' : '—' }],
    },
    {
      key: 'whatsapp', name: 'WhatsApp', state: wa ? 'on' : 'off',
      what: 'Sends fee reminders on WhatsApp (AiSensy API campaigns, or the WhatsApp Cloud API directly).',
      status: wa ? `On: ${wa.name === 'aisensy' ? 'AiSensy' : 'WhatsApp Cloud API'}` : 'Off',
      setup: 'Settings → WhatsApp & SMS: the AiSensy API key and a live API campaign for each message (the steps are listed there).',
      facts: [{ label: 'Service', value: wa ? (wa.name === 'aisensy' ? 'AiSensy' : 'Meta Cloud API') : '—' }],
    },
    {
      key: 'sms', name: 'SMS', state: sms ? 'on' : 'off',
      what: 'Sends fee reminders by SMS through MSG91.',
      status: sms ? 'On' : 'Off',
      setup: 'Settings → WhatsApp & SMS: the MSG91 auth key and a DLT-approved template ID.',
      facts: [],
    },
    {
      key: 'reminders', name: 'Fee reminders', state: reminderReady ? 'on' : 'warn',
      what: 'Each day, students with an installment due soon or overdue get a reminder on the chosen channel.',
      status: reminderReady ? `On, by ${channel}` : `Waiting: reminders go by ${channel}; ${ready.filter(([, on]) => !on).map(([c]) => c).join(', ') || 'a channel'} is not set up, so they stay queued`,
      setup: 'Settings → Reminders: the channels, the days and the wording. Each channel must be set up above.',
      facts: [{ label: 'Sent (30 days)', value: String(outbox.sent) }, { label: 'Waiting', value: String(outbox.queued) }, { label: 'Failed', value: String(outbox.failed) }],
    },
    {
      key: 'jobs', name: 'Daily jobs', state: !cronOn ? 'off' : jobFailed ? 'warn' : 'on',
      what: 'Run by the server every day: send the fee reminders, and check that every receipt adds up with the fee records.',
      status: !cronOn ? 'Off: outside scheduler chosen but CRON_SECRET is not set' : jobFailed ? 'A job failed — see below' : isSuper ? (jobs.length ? `Running (${jobsCfg.scheduler === 'panel' ? 'by the panel' : 'outside scheduler'})` : 'Set up, no run recorded yet') : 'Set up',
      setup: 'Settings → Scheduled jobs: the daily time of each job, or Run now. The alert e-mail (Settings → E-mail) hears when one fails.',
      facts: jobs.map((j) => ({ label: j.job, value: `${j.when ?? 'never'}${j.ok === false ? ' — failed' : ''}` })),
    },
  ]
  return { items, sites, jobs, outbox }
}
