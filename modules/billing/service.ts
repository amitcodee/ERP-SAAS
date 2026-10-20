// Billing (PLAN.md 2.5): an institute picks a plan and how often to pay, pays on the provider's page, and gets a
// paid period and a GST tax invoice. Prices are in paise before 18% GST. Changing plan or how often mid-period
// credits the unused part of what was paid; paying again for the same plan carries on from the end of the period.
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { applyOrgSystem, withPlatform } from '@/lib/db/withTenant'
import { financialYear } from '@/lib/numbering'
import { log } from '@/lib/log'
import { PRODUCT } from '@/lib/product'
import { forgetHosts } from '@/lib/tenant/resolve'
import { billingProvider, type Paid } from './providers'

export const GST_RATE = 18
const DAY = 86_400_000

export type Interval = 'month' | 'year'
export type Quote = { plan: string; planName: string; interval: Interval; amount: number; discount: number; credit: number; gst: number; total: number; coupon: string | null; startsAt: Date; endsAt: Date }

const addInterval = (d: Date, i: Interval) => { const x = new Date(d); if (i === 'month') x.setMonth(x.getMonth() + 1); else x.setFullYear(x.getFullYear() + 1); return x }
const gstOf = (net: number) => Math.round((net * GST_RATE) / 100)

/** The price of a plan for an institute now: coupon, credit for an unused period, GST, and the period it buys. */
export async function quote(tx: Tx, orgId: string, planKey: string, interval: Interval, couponCode?: string | null): Promise<Quote> {
  const [p] = (await tx.execute<{ key: string; name: string; m: number; y: number; ok: boolean }>(sql`
    select key, name, price_monthly as m, price_yearly as y, is_active and is_public as ok from plans where key = ${planKey}`)).rows
  if (!p || !p.ok) throw new Error('That plan is not on offer')
  const amount = interval === 'month' ? p.m : p.y
  if (amount <= 0) throw new Error(`${p.name} is arranged with our team: write to ${PRODUCT.supportEmail}`)
  const now = new Date()
  // the current paid period: the same plan and interval carries on from its end; anything else starts now, with
  // the unused part of what was paid for the current period taken off
  const [sub] = (await tx.execute<{ plan_key: string; interval: Interval; status: string; start: Date; end: Date; paid: number | null }>(sql`
    select s.plan_key, s.interval, s.status, s.current_period_start as start, s.current_period_end as "end",
      (select p.amount - p.discount from platform_payments p where p.org_id = s.org_id and p.status = 'paid' order by p.paid_at desc limit 1) as paid
    from subscriptions s where s.org_id = ${orgId}`)).rows
  const running = !!sub && sub.status === 'active' && new Date(sub.end) > now
  const renewal = running && sub.plan_key === planKey && sub.interval === interval
  const startsAt = renewal ? new Date(sub.end) : now
  let credit = 0
  if (running && !renewal && sub.paid) {
    const total = new Date(sub.end).getTime() - new Date(sub.start).getTime()
    credit = Math.floor((sub.paid * Math.max(0, new Date(sub.end).getTime() - now.getTime())) / total)
  }
  let discount = 0, coupon: string | null = null
  if (couponCode?.trim()) {
    const code = couponCode.trim().toUpperCase()
    const [c] = (await tx.execute<{ percent_off: number | null; amount_off: number | null; plans: string[]; ok: boolean }>(sql`
      select percent_off, amount_off, plans, is_active and (valid_until is null or valid_until > now()) and (max_redemptions is null or redeemed < max_redemptions) as ok
      from coupons where code = ${code}`)).rows
    if (!c || !c.ok || (c.plans.length && !c.plans.includes(planKey))) throw new Error('That code is not valid for this plan')
    discount = c.percent_off ? Math.floor((amount * c.percent_off) / 100) : Math.min(amount, c.amount_off ?? 0)
    coupon = code
  }
  discount = Math.min(amount, discount + credit)
  const gst = gstOf(amount - discount)
  return { plan: p.key, planName: p.name, interval, amount, discount, credit, gst, total: amount - discount + gst, coupon, startsAt, endsAt: addInterval(startsAt, interval) }
}

export const checkoutInput = z.object({ plan: z.string(), interval: z.enum(['month', 'year']), coupon: z.string().trim().max(30).optional().nullable() })

/** A quote for head office's screen (dates as text). */
export async function quoteFor(actor: Actor, raw: z.input<typeof checkoutInput>) {
  const v = checkoutInput.parse(raw)
  const q = await withPlatform((tx) => quote(tx, actor.orgId, v.plan, v.interval, v.coupon))
  return { ...q, startsAt: q.startsAt.toISOString(), endsAt: q.endsAt.toISOString() }
}

/** Head office starts paying: a payment row, and the provider's page to send them to (paid via the callback). */
export async function startCheckout(actor: Actor, raw: z.input<typeof checkoutInput>, callbackUrl: string): Promise<{ url: string; paymentId: string; total: number }> {
  if (actor.role !== 'super_admin' || actor.impersonatorId) throw new Error('Only the institute’s head office pays for it')
  const v = checkoutInput.parse(raw)
  const provider = billingProvider()
  if (!provider) throw new Error(`Online payment is not set up yet: write to ${PRODUCT.supportEmail} to pay`)
  const { q, pay, customer } = await withPlatform(async (tx) => {
    const q = await quote(tx, actor.orgId, v.plan, v.interval, v.coupon)
    if (q.total <= 0) throw new Error('Nothing to pay: your credit covers this plan. Write to us to switch.')
    const [pay] = (await tx.execute<{ id: string }>(sql`
      insert into platform_payments (org_id, plan_key, interval, coupon, amount, discount, gst, total, provider, created_by)
      values (${actor.orgId}, ${q.plan}, ${q.interval}, ${q.coupon}, ${q.amount}, ${q.discount}, ${q.gst}, ${q.total}, ${provider.name}, ${actor.userId}) returning id`)).rows
    await applyOrgSystem(tx, actor.orgId)
    const [c] = (await tx.execute<{ name: string; email: string; phone: string | null; org: string }>(sql`
      select u.name, u.email, u.phone, o.name as org from users u, organisations o where u.id = ${actor.userId} and o.id = ${actor.orgId}`)).rows
    return { q, pay, customer: c }
  })
  const link = await provider.createPaymentLink({
    ref: pay.id, amount: q.total, description: `${PRODUCT.name} ${q.planName} (${q.interval === 'month' ? 'monthly' : 'yearly'}) for ${customer.org}`,
    customer: { name: customer.name, email: customer.email, contact: customer.phone }, callbackUrl,
  })
  await withPlatform((tx) => tx.execute(sql`update platform_payments set provider_ref = ${link.id} where id = ${pay.id}`))
  return { url: link.url, paymentId: pay.id, total: q.total }
}

/**
 * The provider says a payment was made (callback or webhook): mark it paid, move the institute's paid period on,
 * open the institute again if billing had closed it, and issue the invoice. Once only, however often it is told.
 */
export async function completePayment(provider: string, paid: Paid): Promise<{ ok: boolean; already?: boolean; invoice?: string; orgId?: string }> {
  const out = await withPlatform(async (tx) => {
    const [p] = (await tx.execute<{ id: string; org_id: string; plan_key: string; interval: Interval; coupon: string | null; amount: number; discount: number; gst: number; total: number; status: string; provider: string }>(sql`
      select id, org_id, plan_key, interval, coupon, amount, discount, gst, total, status, provider from platform_payments where id = ${paid.ref} for update`)).rows
    if (!p || p.provider !== provider) return { ok: false }
    if (p.status === 'paid') return { ok: true, already: true, orgId: p.org_id }
    // the period: carry on from a running period of the same plan and interval, else start now
    const [sub] = (await tx.execute<{ plan_key: string; interval: Interval; status: string; end: Date }>(sql`
      select plan_key, interval, status, current_period_end as "end" from subscriptions where org_id = ${p.org_id} for update`)).rows
    const now = new Date()
    const start = sub && sub.status === 'active' && new Date(sub.end) > now && sub.plan_key === p.plan_key && sub.interval === p.interval ? new Date(sub.end) : now
    const end = addInterval(start, p.interval)
    await tx.execute(sql`
      insert into subscriptions (org_id, plan_key, interval, status, current_period_start, current_period_end)
      values (${p.org_id}, ${p.plan_key}, ${p.interval}, 'active', ${start}, ${end})
      on conflict (org_id) do update set plan_key = excluded.plan_key, interval = excluded.interval, status = 'active', cancel_at_period_end = false,
        current_period_start = case when subscriptions.current_period_end > now() and subscriptions.plan_key = excluded.plan_key and subscriptions.interval = excluded.interval then subscriptions.current_period_start else excluded.current_period_start end,
        current_period_end = excluded.current_period_end, reminded_at = null, updated_at = now()`)
    // paying opens an institute billing had closed (not one the platform suspended for another reason: those stay)
    await tx.execute(sql`update organisations set plan_key = ${p.plan_key}, trial_ends_at = null,
      status = case when status in ('trial', 'past_due', 'read_only') then 'active' else status end where id = ${p.org_id}`)
    if (p.coupon) await tx.execute(sql`update coupons set redeemed = redeemed + 1 where code = ${p.coupon}`)
    const invoice = await issueInvoice(tx, p, start, end)
    await tx.execute(sql`update platform_payments set status = 'paid', paid_at = now(), provider_payment_id = ${paid.providerPaymentId}, invoice_id = ${invoice.id} where id = ${p.id}`)
    await applyOrgSystem(tx, p.org_id)
    await tx.execute(sql`insert into audit_logs (user_id, action, entity, entity_id, after) values (null, 'payment', 'billing', ${p.id}, ${JSON.stringify({ plan: p.plan_key, interval: p.interval, total: p.total, invoice: invoice.number, until: end.toISOString() })}::jsonb)`)
    return { ok: true, invoice: invoice.number, orgId: p.org_id }
  })
  if (out.ok && !out.already) { forgetHosts(); log.info('billing.paid', { payment: paid.ref, invoice: out.invoice }) }
  return out
}

/** Keeps a provider's webhook event; false when it has been handled before (providers retry). */
export async function recordBillingEvent(provider: string, eventId: string, type: string, payload: unknown): Promise<boolean> {
  return withPlatform(async (tx) => (await tx.execute(sql`
    insert into billing_events (provider, event_id, type, payload) values (${provider}, ${eventId}, ${type}, ${JSON.stringify(payload)}::jsonb)
    on conflict do nothing returning event_id`)).rows.length > 0)
}

/** The seller on every invoice: the platform (environment; placeholders until the owner sets them). */
export const seller = () => ({
  name: PRODUCT.legalName, gstin: process.env.PLATFORM_GSTIN || null, address: PRODUCT.address || null,
  state: process.env.PLATFORM_GSTIN?.slice(0, 2) || process.env.PLATFORM_STATE_CODE || null,
})

async function issueInvoice(tx: Tx, p: { id: string; org_id: string; plan_key: string; interval: Interval; amount: number; discount: number; gst: number; total: number }, start: Date, end: Date) {
  const fy = financialYear()
  // the next number of this financial year's series, under a row lock: no gaps, no repeats
  await tx.execute(sql`insert into platform_counters (key, value) values (${`invoice:${fy}`}, 0) on conflict (key) do nothing`)
  const [n] = (await tx.execute<{ value: number }>(sql`update platform_counters set value = value + 1 where key = ${`invoice:${fy}`} returning value`)).rows
  const number = `INV/${fy}/${String(n.value).padStart(5, '0')}`
  const [o] = (await tx.execute<{ name: string; legal_name: string | null; gstin: string | null; address: string | null; email: string | null; plan: string }>(sql`
    select o.name, o.legal_name, o.gstin, o.address, o.email, (select name from plans where key = ${p.plan_key}) as plan from organisations o where o.id = ${p.org_id}`)).rows
  const s = seller()
  // the same state (GSTIN's first two digits) as the seller, or not known: CGST + SGST; another state: IGST
  const interState = !!(s.state && o.gstin && o.gstin.slice(0, 2) !== s.state)
  const cgst = interState ? 0 : Math.floor(p.gst / 2), sgst = interState ? 0 : p.gst - cgst, igst = interState ? p.gst : 0
  const [inv] = (await tx.execute<{ id: string }>(sql`
    insert into platform_invoices (org_id, number, period_start, period_end, description, amount, discount, cgst, sgst, igst, total, billed_to, seller, payment_id)
    values (${p.org_id}, ${number}, ${start}, ${end}, ${`${PRODUCT.name} ${o.plan} plan, ${p.interval === 'month' ? 'monthly' : 'yearly'} (SAC 998431)`},
      ${p.amount}, ${p.discount}, ${cgst}, ${sgst}, ${igst}, ${p.total},
      ${JSON.stringify({ name: o.legal_name || o.name, gstin: o.gstin, address: o.address, email: o.email })}::jsonb, ${JSON.stringify(s)}::jsonb, ${p.id})
    returning id`)).rows
  return { id: inv.id, number }
}

/** Stops renewing at the end of the paid period (or takes that back). Head office only. */
export async function setCancelAtPeriodEnd(actor: Actor, cancel: boolean) {
  if (actor.role !== 'super_admin' || actor.impersonatorId) throw new Error('Only the institute’s head office changes its plan')
  const r = await withPlatform((tx) => tx.execute(sql`update subscriptions set cancel_at_period_end = ${cancel}, updated_at = now() where org_id = ${actor.orgId} and status = 'active'`))
  if (!r.rowCount) throw new Error('There is no paid plan to change')
}

// ---- what head office sees (Settings → Plan & billing) ----------------------------------------------------------------

export type BillingOverview = {
  status: string; trialEndsAt: string | null; plan: { key: string; name: string }
  sub: { planKey: string; interval: Interval; start: string; end: string; cancelAtPeriodEnd: boolean; status: string } | null
  invoices: { id: string; number: string; issuedAt: string; total: number; description: string }[]
  payments: { id: string; createdAt: string; total: number; status: string; plan: string; interval: Interval }[]
}

/** The institute's own billing, read in its own context (its policies show it only its rows). */
export async function billingOverview(tx: Tx): Promise<BillingOverview> {
  const [o] = (await tx.execute<{ status: string; trial: string | null; key: string; name: string }>(sql`
    select o.status, o.trial_ends_at::text as trial, p.key, p.name from organisations o join plans p on p.key = o.plan_key where o.id = app_org()`)).rows
  const [s] = (await tx.execute<NonNullable<BillingOverview['sub']>>(sql`
    select plan_key as "planKey", interval, current_period_start::text as start, current_period_end::text as "end", cancel_at_period_end as "cancelAtPeriodEnd", status
    from subscriptions where org_id = app_org()`)).rows
  const invoices = (await tx.execute<BillingOverview['invoices'][number]>(sql`
    select id, number, issued_at::text as "issuedAt", total, description from platform_invoices where org_id = app_org() order by issued_at desc limit 50`)).rows
  const payments = (await tx.execute<BillingOverview['payments'][number]>(sql`
    select id, created_at::text as "createdAt", total, status, plan_key as plan, interval from platform_payments where org_id = app_org() order by created_at desc limit 20`)).rows
  return { status: o.status, trialEndsAt: o.trial, plan: { key: o.key, name: o.name }, sub: s ?? null, invoices, payments }
}
