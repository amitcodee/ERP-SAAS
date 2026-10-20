// The panel's own scheduler (started from instrumentation.ts in the server process). Every minute, for each open
// organisation, it delivers due webhooks and queued messages (WhatsApp on events), and runs each daily job once a day
// at the time that org set in Settings → Scheduled jobs (in the org's own time zone). A job that already ran that
// day for that org (by the scheduler, Run now, or an outside cron) is not run again by the scheduler.
// Several app instances: a Postgres advisory lock per org and job lets only one of them run it at a time.
// (Phase 5 moves this onto a real queue; until then one org's slow job only delays the orgs after it.)
import { sql } from 'drizzle-orm'
import { getConfig, type JobKey } from '@/lib/config/store'
import { pool } from '@/lib/db/client'
import { withOrgSystem } from '@/lib/db/withTenant'
import { log } from '@/lib/log'
import { activeOrgs, type JobOrg } from '@/lib/tenant/orgs'

const local = (timeZone: string, d = new Date()) => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00'
  return { day: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}` }
}

let busy = false

async function orgTick(org: JobOrg) {
  const { deliverMessages, deliverWebhooks, runNamedJob } = await import('@/lib/job-registry')
  await deliverWebhooks(org.id).catch((e) => log.warn('scheduler.webhooks', { org: org.slug, error: String(e) }))
  await deliverMessages(org.id, 10_000).catch((e) => log.warn('scheduler.messages', { org: org.slug, error: String(e) }))
  const cfg = (await getConfig(org.id, 'jobs')).config
  if (cfg.scheduler !== 'panel') return
  const now = local(org.timezone || 'Asia/Kolkata')
  for (const key of ['reminders', 'reconcile', 'purge', 'escalations'] as JobKey[]) {
    const j = cfg[key]
    if (!j?.enabled || !/^\d{2}:\d{2}$/.test(j.time) || now.time < j.time) continue
    const lockKey = `job:${org.id}:${key}`
    const client = await pool.connect()
    try {
      const lock = (await client.query<{ ok: boolean }>('select pg_try_advisory_lock(hashtext($1)) as ok', [lockKey])).rows[0]?.ok
      if (!lock) continue
      try {
        const ran = await withOrgSystem(org.id, async (tx) => (await tx.execute<{ n: number }>(sql`
          select count(*)::int as n from job_runs where job = ${key} and (started_at at time zone ${org.timezone || 'Asia/Kolkata'})::date = ${now.day}::date`)).rows[0]?.n)
        if (!ran) {
          log.info('scheduler.run', { org: org.slug, job: key, at: now })
          await runNamedJob(org.id, key)
        }
      } finally {
        await client.query('select pg_advisory_unlock(hashtext($1))', [lockKey])
      }
    } finally {
      client.release()
    }
  }
}

async function tick() {
  if (busy) return
  busy = true
  try {
    for (const org of await activeOrgs()) {
      // one org's trouble never holds back the next
      await orgTick(org).catch((e) => log.error('scheduler.org', { org: org.slug, error: e instanceof Error ? e.message : String(e) }))
    }
  } catch (e) {
    log.error('scheduler.tick', { error: e instanceof Error ? e.message : String(e) })
  } finally {
    busy = false
  }
}

/** Starts the minute timer once per server process. */
export function startScheduler() {
  const g = globalThis as { __tcScheduler?: NodeJS.Timeout }
  if (g.__tcScheduler) return
  g.__tcScheduler = setInterval(() => void tick(), 60_000)
  setTimeout(() => void tick(), 15_000)
  log.info('scheduler.started', {})
}
