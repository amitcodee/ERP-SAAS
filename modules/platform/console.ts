// The platform console beyond organisations and support (PLAN.md 2.6): the business at a glance (MRR, trials,
// conversion, churn), plans and coupons, an institute's plan / trial / feature flags, notices to institutes, and the
// health of every institute's daily jobs. Platform admins only (each action takes the PlatformUser and writes the
// change into the institute's own audit log where it concerns one institute).
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { applyOrgSystem, withPlatform, type Tx } from '@/lib/db/withTenant'
import { forgetHosts } from '@/lib/tenant/resolve'
import { appOrigin } from '@/lib/app-url'
import { log } from '@/lib/log'
import { platformMailer } from '@/lib/notify/providers'
import { PRODUCT } from '@/lib/product'
import { PLAN_MODULES } from '@/modules/plans/service'
import { onboardingRulesIn } from './rules'
import type { PlatformUser } from './service'

/** A text[] parameter (drizzle spreads a JS array into a list of parameters, so it goes over as JSON). */
const textArray = (xs: string[]) => sql`(select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(${JSON.stringify(xs)}::jsonb) x)`

// ---- the business at a glance -----------------------------------------------------------------------------------------

export type Metrics = {
  byStatus: Record<string, number>
  mrr: number // paise a month, before GST: each running subscription's last net payment, a year's divided by 12
  paying: number
  signups30: number
  trialsEnding7: number
  conversion90: { started: number; paid: number }
  churn30: number
  jobFailures: { org: string; job: string; failed: number; runs: number; lastError: string | null }[]
}

export async function metrics(): Promise<Metrics> {
  return withPlatform(async (tx) => {
    const rows = <T,>(q: ReturnType<typeof sql>) => tx.execute<T & Record<string, unknown>>(q).then((r) => r.rows)
    const status = await rows<{ status: string; n: number }>(sql`select status, count(*)::int as n from organisations group by status`)
    const [m] = await rows<{ mrr: number; paying: number }>(sql`
      select coalesce(sum(case when s.interval = 'year' then p.net / 12 else p.net end), 0)::int as mrr, count(*)::int as paying
      from subscriptions s join lateral (select amount - discount as net from platform_payments x where x.org_id = s.org_id and x.status = 'paid' order by x.paid_at desc limit 1) p on true
      join organisations o on o.id = s.org_id
      where s.status = 'active' and s.current_period_end > now() and o.status in ('active', 'past_due')`)
    const [c] = await rows<{ signups30: number; ending7: number; started: number; paid: number; churn30: number }>(sql`
      select (select count(*)::int from signups where completed_at > now() - interval '30 days') as signups30,
        (select count(*)::int from organisations where status = 'trial' and trial_ends_at between now() and now() + interval '7 days') as ending7,
        (select count(*)::int from signups where completed_at > now() - interval '90 days') as started,
        (select count(distinct g.org_id)::int from signups g join platform_payments p on p.org_id = g.org_id and p.status = 'paid' where g.completed_at > now() - interval '90 days') as paid,
        (select count(*)::int from organisations o where o.status in ('suspended', 'cancelled') and o.updated_at > now() - interval '30 days') as churn30`)
    const jobs = await rows<{ org: string; job: string; failed: number; runs: number; last_error: string | null }>(sql`
      select o.name as org, h.job, h.failed, h.runs, h.last_error from platform_job_health() h join organisations o on o.id = h.org_id
      where h.failed > 0 order by h.last_failed desc limit 30`)
    return {
      byStatus: Object.fromEntries(status.map((s) => [s.status, s.n])), mrr: m.mrr, paying: m.paying, signups30: c.signups30, trialsEnding7: c.ending7,
      conversion90: { started: c.started, paid: c.paid }, churn30: c.churn30, jobFailures: jobs.map((j) => ({ org: j.org, job: j.job, failed: j.failed, runs: j.runs, lastError: j.last_error })),
    }
  })
}

// ---- plans and coupons -----------------------------------------------------------------------------------------------

const limit = z.number().int().min(0).nullable()
export const planInput = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Key: lower-case letters, digits and _'),
  name: z.string().trim().min(2).max(40),
  description: z.string().trim().max(200).default(''),
  priceMonthly: z.number().int().min(0), priceYearly: z.number().int().min(0), // paise
  limits: z.object({ branches: limit, staff: limit, activeStudents: limit, storageMb: limit, messagesPerMonth: limit }),
  modules: z.array(z.string()).refine((ms) => ms.every((m) => m in PLAN_MODULES), 'Unknown module'),
  isPublic: z.boolean(), isActive: z.boolean(), sort: z.number().int().min(0).max(100),
})

/** Adds or changes a plan (prices take effect for the next payment; institutes on it keep their paid period). */
export async function savePlan(raw: z.input<typeof planInput>) {
  const v = planInput.parse(raw)
  await withPlatform((tx) => tx.execute(sql`
    insert into plans (key, name, description, price_monthly, price_yearly, limits, modules, is_public, is_active, sort)
    values (${v.key}, ${v.name}, ${v.description || null}, ${v.priceMonthly}, ${v.priceYearly}, ${JSON.stringify(v.limits)}::jsonb, ${textArray(v.modules)}, ${v.isPublic}, ${v.isActive}, ${v.sort})
    on conflict (key) do update set name = excluded.name, description = excluded.description, price_monthly = excluded.price_monthly, price_yearly = excluded.price_yearly,
      limits = excluded.limits, modules = excluded.modules, is_public = excluded.is_public, is_active = excluded.is_active, sort = excluded.sort, updated_at = now()`))
}

export const couponInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,30}$/, 'Code: 3 to 30 letters, digits or -'),
  percentOff: z.number().int().min(1).max(100).nullable(), amountOff: z.number().int().min(1).nullable(), // paise
  plans: z.array(z.string()).default([]), validUntil: z.string().datetime().nullable().default(null), maxRedemptions: z.number().int().min(1).nullable().default(null),
}).refine((c) => (c.percentOff == null) !== (c.amountOff == null), 'Give either a percentage or an amount off')

export async function createCoupon(raw: z.input<typeof couponInput>) {
  const v = couponInput.parse(raw)
  await withPlatform(async (tx) => {
    const [dup] = (await tx.execute(sql`select 1 from coupons where code = ${v.code}`)).rows
    if (dup) throw new Error('That code exists already')
    await tx.execute(sql`insert into coupons (code, percent_off, amount_off, plans, valid_until, max_redemptions) values (${v.code}, ${v.percentOff}, ${v.amountOff}, ${textArray(v.plans)}, ${v.validUntil}, ${v.maxRedemptions})`)
  })
}
export async function setCouponActive(code: string, active: boolean) {
  const r = await withPlatform((tx) => tx.execute(sql`update coupons set is_active = ${active} where code = ${code.toUpperCase()}`))
  if (!r.rowCount) throw new Error('No such code')
}
export const listCoupons = () => withPlatform(async (tx) => (await tx.execute<{ code: string; percent_off: number | null; amount_off: number | null; plans: string[]; valid_until: string | null; max_redemptions: number | null; redeemed: number; is_active: boolean }>(sql`
  select code, percent_off, amount_off, plans, valid_until::text, max_redemptions, redeemed, is_active from coupons order by created_at desc limit 200`)).rows)
export const listAllPlans = () => withPlatform(async (tx) => (await tx.execute<{ key: string; name: string; description: string | null; price_monthly: number; price_yearly: number; limits: Record<string, number | null>; modules: string[]; is_public: boolean; is_active: boolean; sort: number; orgs: number }>(sql`
  select p.*, (select count(*)::int from organisations o where o.plan_key = p.key) as orgs from plans p order by sort, key`)).rows)

// ---- one institute: plan, trial, feature flags -----------------------------------------------------------------------

async function auditOrg(tx: Tx, orgId: string, pu: PlatformUser, action: string, after: unknown) {
  await applyOrgSystem(tx, orgId)
  await tx.execute(sql`insert into audit_logs (user_id, action, entity, entity_id, after, impersonator_id) values (null, ${action}, 'organisation', ${orgId}, ${JSON.stringify({ by: `${pu.name} (platform)`, ...(after as object) })}::jsonb, ${pu.id})`)
}

/** Moves an institute to another plan (a deal, a correction), with a reason; its paid period is left as it is. */
export async function setOrgPlan(pu: PlatformUser, orgId: string, planKey: string, reason: string) {
  if (reason.trim().length < 3) throw new Error('Give a reason')
  await withPlatform(async (tx) => {
    const [p] = (await tx.execute(sql`select 1 from plans where key = ${planKey}`)).rows
    if (!p) throw new Error('No such plan')
    const [o] = (await tx.execute<{ plan_key: string }>(sql`select plan_key from organisations where id = ${orgId}`)).rows
    if (!o) throw new Error('Organisation not found')
    await tx.execute(sql`update organisations set plan_key = ${planKey} where id = ${orgId}`)
    await auditOrg(tx, orgId, pu, 'plan_changed', { from: o.plan_key, to: planKey, reason })
  })
}

/** Gives a trial (or a read-only institute back on trial) more days. */
export async function extendTrial(pu: PlatformUser, orgId: string, days: number, reason: string) {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('Between 1 and 90 days')
  if (reason.trim().length < 3) throw new Error('Give a reason')
  await withPlatform(async (tx) => {
    const [o] = (await tx.execute<{ status: string; until: Date | null }>(sql`select status, trial_ends_at as until from organisations where id = ${orgId} for update`)).rows
    if (!o) throw new Error('Organisation not found')
    if (!['trial', 'read_only'].includes(o.status)) throw new Error('Only a trial (or a lapsed trial) can be extended')
    const from = o.until && new Date(o.until) > new Date() ? new Date(o.until) : new Date()
    const until = new Date(from.getTime() + days * 86_400_000)
    await tx.execute(sql`update organisations set status = 'trial', trial_ends_at = ${until} where id = ${orgId}`)
    await auditOrg(tx, orgId, pu, 'trial_extended', { days, until: until.toISOString(), reason })
  })
  forgetHosts()
}

/**
 * Approves an institute that waits (status pending). Paid already: it is active; else its trial starts now, for the
 * platform's trial length (modules/platform/rules.ts).
 */
export async function approveOrg(pu: PlatformUser, orgId: string) {
  const out = await withPlatform(async (tx) => {
    const [o] = (await tx.execute<{ status: string; paid: boolean }>(sql`
      select o.status, exists (select 1 from subscriptions s where s.org_id = o.id and s.status = 'active' and s.current_period_end > now()) as paid
      from organisations o where o.id = ${orgId} for update`)).rows
    if (!o) throw new Error('Organisation not found')
    if (o.status !== 'pending') throw new Error('It is not waiting for approval')
    const { trialDays } = await onboardingRulesIn(tx)
    if (o.paid) await tx.execute(sql`update organisations set status = 'active', trial_ends_at = null where id = ${orgId}`)
    else await tx.execute(sql`update organisations set status = 'trial', trial_ends_at = now() + make_interval(days => ${trialDays}) where id = ${orgId}`)
    await auditOrg(tx, orgId, pu, 'approved', { to: o.paid ? 'active' : 'trial', trialDays: o.paid ? null : trialDays })
    const [owner] = (await tx.execute<{ email: string; name: string; org: string }>(sql`
      select u.email, u.name, o.name as org from organisations o join users u on u.id = o.owner_user_id where o.id = ${orgId}`)).rows
    return { status: o.paid ? 'active' : 'trial', trialDays, owner }
  })
  forgetHosts()
  // the owner hears at once (best effort: the approval stands without it)
  const m = platformMailer()
  if (m && out.owner) {
    const link = await appOrigin(orgId).catch(() => '')
    const r = await m.send({ channel: 'email', to: out.owner.email, template: 'approved', subject: `${out.owner.org} is approved`,
      body: `Hello ${out.owner.name},

${out.owner.org} has been approved. ${out.status === 'active' ? 'Your plan is active.' : `Your ${out.trialDays}-day free trial starts now; choose a plan in Settings → Plan & billing to carry on after it.`}${link ? `

Sign in: ${link}/login` : ''}

${PRODUCT.name}` })
    if (!r.ok) log.warn('approve.mail_failed', { orgId, error: r.error })
  }
  return { status: out.status, trialDays: out.trialDays }
}

/**
 * Makes an institute active by the platform's hand (paid by bank transfer or cash, a deal, a partner): until a date,
 * which then runs like a paid period (reminder, grace, then closed), or with no end (never billed: features.billing_exempt).
 */
export async function activateOrg(pu: PlatformUser, orgId: string, until: string | null, reason: string) {
  if (reason.trim().length < 3) throw new Error('Give a reason')
  const end = until ? new Date(`${until}T23:59:59+05:30`) : null
  if (end && (Number.isNaN(end.getTime()) || end.getTime() < Date.now() + 3600_000)) throw new Error('Choose a date after today')
  await withPlatform(async (tx) => {
    const [o] = (await tx.execute<{ status: string; plan_key: string }>(sql`select status, plan_key from organisations where id = ${orgId} for update`)).rows
    if (!o) throw new Error('Organisation not found')
    if (o.status === 'cancelled') throw new Error('A cancelled organisation cannot be changed here')
    if (end) {
      const interval = end.getTime() - Date.now() > 45 * 86_400_000 ? 'year' : 'month'
      await tx.execute(sql`
        insert into subscriptions (org_id, plan_key, interval, status, current_period_start, current_period_end, cancel_at_period_end)
        values (${orgId}, ${o.plan_key}, ${interval}, 'active', now(), ${end}, false)
        on conflict (org_id) do update set plan_key = excluded.plan_key, interval = excluded.interval, status = 'active', current_period_start = now(),
          current_period_end = excluded.current_period_end, cancel_at_period_end = false, reminded_at = null, updated_at = now()`)
    }
    await tx.execute(sql`update organisations set status = 'active', trial_ends_at = null,
      features = case when ${!end}::boolean then features || '{"billing_exempt": true}'::jsonb else features - 'billing_exempt' end where id = ${orgId}`)
    await auditOrg(tx, orgId, pu, 'activated', { from: o.status, until: end?.toISOString() ?? 'no end', reason: reason.trim() })
  })
  forgetHosts()
}

/** Feature flags per institute (organisations.features): switch something on or off for one institute. */
export async function setFeature(pu: PlatformUser, orgId: string, flag: string, on: boolean) {
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(flag)) throw new Error('Flag: lower-case letters, digits and _')
  await withPlatform(async (tx) => {
    const r = await tx.execute(sql`update organisations set features = features || jsonb_build_object(${flag}::text, ${on}::boolean) where id = ${orgId}`)
    if (!r.rowCount) throw new Error('Organisation not found')
    await auditOrg(tx, orgId, pu, 'feature', { flag, on })
  })
}

// ---- notices to institutes -----------------------------------------------------------------------------------------------

export const announcementInput = z.object({
  title: z.string().trim().min(3).max(120), body: z.string().trim().min(3).max(1000), tone: z.enum(['info', 'warning']).default('info'),
  plans: z.array(z.string()).default([]), endsAt: z.string().datetime().nullable().default(null),
})
export async function createAnnouncement(pu: PlatformUser, raw: z.input<typeof announcementInput>) {
  const v = announcementInput.parse(raw)
  await withPlatform((tx) => tx.execute(sql`insert into platform_announcements (title, body, tone, plans, ends_at, created_by) values (${v.title}, ${v.body}, ${v.tone}, ${textArray(v.plans)}, ${v.endsAt}, ${pu.id})`))
}
export async function endAnnouncement(id: string) {
  const r = await withPlatform((tx) => tx.execute(sql`update platform_announcements set ends_at = now() where id = ${id} and (ends_at is null or ends_at > now())`))
  if (!r.rowCount) throw new Error('That notice has ended already')
}
export const listAnnouncements = () => withPlatform(async (tx) => (await tx.execute<{ id: string; title: string; body: string; tone: string; plans: string[]; starts_at: string; ends_at: string | null; live: boolean }>(sql`
  select id, title, body, tone, plans, starts_at::text, ends_at::text, (starts_at <= now() and (ends_at is null or ends_at > now())) as live from platform_announcements order by created_at desc limit 50`)).rows)

/** The notices running now for the transaction's institute (its own context: the policy picks them). */
export async function liveAnnouncementsIn(tx: Tx) {
  return (await tx.execute<{ id: string; title: string; body: string; tone: 'info' | 'warning' }>(sql`select id, title, body, tone from platform_announcements order by starts_at desc limit 3`)).rows
}
