import { sql } from 'drizzle-orm'
import { withPlatform } from '../db/withTenant'

/** An organisation as background work sees it: who it is and the time zone its days run in. */
export type JobOrg = { id: string; slug: string; status: string; timezone: string }

/**
 * The organisations background jobs run for: every one still open. A read-only org (billing) still gets its
 * reminders, money check and clean-up; a suspended or cancelled one gets nothing.
 */
export async function activeOrgs(): Promise<JobOrg[]> {
  return withPlatform(async (tx) => (await tx.execute<JobOrg>(sql`
    select id, slug, status, timezone from organisations
    where status in ('trial', 'active', 'past_due', 'read_only') order by created_at`)).rows)
}

/** One org's work after another; a failure in one never stops the others. */
export async function forEachOrg<T>(fn: (org: JobOrg) => Promise<T>, onError: (org: JobOrg, e: unknown) => void): Promise<T[]> {
  const out: T[] = []
  for (const org of await activeOrgs()) {
    try { out.push(await fn(org)) } catch (e) { onError(org, e) }
  }
  return out
}
