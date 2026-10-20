// What the super admin should know about the background jobs: failures, mismatches, and jobs that stopped running.
import { sql } from 'drizzle-orm'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { can } from '@/lib/auth/permissions'

export type SystemAlert = { job: string; text: string }

/** Jobs expected to run daily. A run older than this many hours counts as "stopped". */
const DAILY = ['reminders', 'reconcile']
const STALE_HOURS = 26

export async function systemAlerts(tx: Tx, actor: Actor): Promise<SystemAlert[]> {
  if (actor.role !== 'super_admin' || !can(actor, 'update', 'setting')) return []
  const last = (
    await tx.execute<{ job: string; started_at: string; finished_at: string | null; ok: boolean | null; error: string | null; problems: number | null }>(sql`
      select distinct on (job) job, started_at::text, finished_at::text, ok, error, (summary->>'problemCount')::int as problems
      from job_runs order by job, started_at desc`)
  ).rows
  const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })
  const out: SystemAlert[] = []
  for (const job of DAILY) {
    const r = last.find((x) => x.job === job)
    if (!r) { out.push({ job, text: `The "${job}" job has never run. Check the scheduled task in Coolify.` }); continue }
    const ageH = (Date.now() - new Date(r.started_at).getTime()) / 3600000
    if (!r.finished_at && ageH > 1) out.push({ job, text: `The "${job}" job started ${when(r.started_at)} and never finished.` })
    else if (r.ok === false) out.push({ job, text: r.problems ? `Reconciliation on ${when(r.started_at)} found ${r.problems} money mismatch${r.problems === 1 ? '' : 'es'}. See job_runs for details.` : `The "${job}" job failed on ${when(r.started_at)}: ${r.error ?? 'unknown error'}` })
    else if (ageH > STALE_HOURS) out.push({ job, text: `The "${job}" job last ran ${when(r.started_at)}. It should run daily.` })
  }
  return out
}
