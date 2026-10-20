// Dunning (PLAN.md 2.5): what happens when an institute has not paid. Run by the scheduler (hourly; each step is a
// change of state, so running it again does nothing new).
//   trial over, nothing paid           -> read_only (everyone can still sign in and look; nothing can be changed)
//   paid period over, not renewed      -> past_due, with 7 days' grace (everything still works)
//   7 days past due                    -> read_only
//   30 more days                       -> suspended (nobody can sign in; the platform can reopen it)
//   cancelled by the institute         -> read_only at the end of the paid period
// Paying at any point opens it again (modules/billing/service.ts completePayment). Owners get an e-mail 7 days before
// a period ends and at each change.
import { sql } from 'drizzle-orm'
import { appOrigin } from '@/lib/app-url'
import { applyOrgSystem, withPlatform } from '@/lib/db/withTenant'
import { log } from '@/lib/log'
import { platformMailer } from '@/lib/notify/providers'
import { PRODUCT } from '@/lib/product'
import { forgetHosts } from '@/lib/tenant/resolve'

export const GRACE_DAYS = 7
export const SUSPEND_AFTER_DAYS = 30

type Due = { id: string; name: string; status: string; until: Date; owner_email: string | null; owner_name: string | null; cancelling: boolean; sub_end: Date | null; reminded: boolean }

/** The status an institute should have now, from when it is paid until (null: leave it). */
export function dueStatus(status: string, until: Date, now: Date, cancelling: boolean): string | null {
  if (now < until) return null
  const days = (now.getTime() - until.getTime()) / 86_400_000
  if (status === 'trial') return 'read_only'
  if (status === 'active') return cancelling ? 'read_only' : 'past_due'
  if (status === 'past_due' && days >= GRACE_DAYS) return 'read_only'
  if (status === 'read_only' && days >= GRACE_DAYS + SUSPEND_AFTER_DAYS) return 'suspended'
  return null
}

const NOTE: Record<string, (d: Due) => string> = {
  past_due: (d) => `Your ${PRODUCT.name} plan for ${d.name} ended on ${d.until.toDateString()}. Everything keeps working for ${GRACE_DAYS} days; pay in Settings → Plan & billing to carry on.`,
  read_only: (d) => `${d.name} is now read-only: everyone can still sign in and look, but nothing can be changed until it is paid for (Settings → Plan & billing).`,
  suspended: (d) => `${d.name} has been suspended for non-payment. Nothing has been deleted; write to ${PRODUCT.supportEmail} to open it again.`,
}

async function mail(orgId: string, d: Due, subject: string, text: string) {
  const m = platformMailer()
  if (!m || !d.owner_email) { log.info('dunning.mail_skipped', { org: d.name, subject }); return }
  const link = await appOrigin(orgId).then((o) => `${o}/settings?tab=billing`).catch(() => '')
  const r = await m.send({ channel: 'email', to: d.owner_email, template: 'billing', subject, body: `Hello ${d.owner_name ?? ''},\n\n${text}${link ? `\n\n${link}` : ''}` })
  if (!r.ok) log.warn('dunning.mail_failed', { org: d.name, error: r.error })
}

export async function runDunning(now = new Date()): Promise<{ changed: { org: string; from: string; to: string }[]; reminded: string[] }> {
  const rows = await withPlatform(async (tx) => (await tx.execute<Due>(sql`
    select o.id, o.name, o.status,
      coalesce(case when s.status = 'active' then s.current_period_end end, o.trial_ends_at, s.current_period_end) as until,
      coalesce(s.cancel_at_period_end, false) as cancelling, s.current_period_end as sub_end,
      (s.reminded_at is not null and s.reminded_at > s.current_period_start) as reminded,
      null::text as owner_email, null::text as owner_name
    from organisations o left join subscriptions s on s.org_id = o.id
    where o.status in ('trial', 'active', 'past_due', 'read_only')
      and (o.trial_ends_at is not null or s.org_id is not null)`)).rows)
  const changed: { org: string; from: string; to: string }[] = [], reminded: string[] = []
  for (const d of rows) {
    if (!d.until) continue
    const until = new Date(d.until)
    const to = dueStatus(d.status, until, now, d.cancelling)
    const owner = async () => {
      const [u] = await withPlatform(async (tx) => { await applyOrgSystem(tx, d.id); return (await tx.execute<{ email: string; name: string }>(sql`select u.email, u.name from organisations o join users u on u.id = o.owner_user_id where o.id = ${d.id}`)).rows })
      return { ...d, until, owner_email: u?.email ?? null, owner_name: u?.name ?? null }
    }
    if (to) {
      // only from the status read: a payment (or the platform) that moved it meanwhile wins
      const moved = await withPlatform(async (tx) => {
        const r = await tx.execute(sql`update organisations set status = ${to} where id = ${d.id} and status = ${d.status}`)
        if (r.rowCount && d.cancelling && to === 'read_only') await tx.execute(sql`update subscriptions set status = 'cancelled', updated_at = now() where org_id = ${d.id}`)
        if (r.rowCount) { await applyOrgSystem(tx, d.id); await tx.execute(sql`insert into audit_logs (user_id, action, entity, entity_id, after) values (null, ${`billing_${to}`}, 'organisation', ${d.id}, ${JSON.stringify({ from: d.status, until: until.toISOString() })}::jsonb)`) }
        return !!r.rowCount
      })
      if (moved) {
        changed.push({ org: d.name, from: d.status, to })
        const full = await owner()
        await mail(d.id, full, `${d.name}: ${to === 'past_due' ? 'payment due' : to === 'read_only' ? 'now read-only' : 'suspended'}`, NOTE[to](full))
      }
      continue
    }
    // a week before a paid period ends, once per period (not when it will not renew)
    if (d.status === 'active' && d.sub_end && !d.cancelling && !d.reminded && until.getTime() - now.getTime() < 7 * 86_400_000) {
      await withPlatform((tx) => tx.execute(sql`update subscriptions set reminded_at = now() where org_id = ${d.id}`))
      const full = await owner()
      await mail(d.id, full, `${d.name}: your plan renews on ${until.toDateString()}`, `Your ${PRODUCT.name} plan for ${d.name} runs until ${until.toDateString()}. Pay for the next period in Settings → Plan & billing so nothing stops.`)
      reminded.push(d.name)
    }
  }
  if (changed.length) forgetHosts()
  return { changed, reminded }
}
