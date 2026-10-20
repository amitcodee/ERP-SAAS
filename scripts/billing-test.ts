// Billing (modules/billing): prices with GST, codes and the credit for an unused period; checkout through the
// provider; a payment completed exactly once (callback or webhook, any number of times) into a paid period, an open
// institute and a gapless GST invoice; Razorpay's signatures; renewals; and dunning (trial over -> read-only, unpaid
// -> past due -> read-only -> suspended). The services commit their own transactions: each run makes its own
// institutes and cancels them at the end.
import { createHmac } from 'crypto'
import { sql } from 'drizzle-orm'
import { pool } from '../lib/db/client'
import { withPlatform, type Actor } from '../lib/db/withTenant'
import { dueStatus, runDunning } from '../modules/billing/dunning'
import { fakePaidSig, fakeProvider, razorpay } from '../modules/billing/providers'
import { completePayment, quote, setCancelAtPeriodEnd, startCheckout } from '../modules/billing/service'
import { provisionOrg } from '../modules/orgs/provision'

let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(name: string, fn: () => Promise<unknown>, match?: RegExp) {
  try { await fn(); check(name, false, 'expected error') } catch (e) { const m = `${e} ${(e as { cause?: unknown }).cause ?? ''}`; check(name, !match || match.test(m), match ? m.slice(0, 110) : '') }
}
const RUN = Date.now().toString(36)
const plat = <T,>(fn: Parameters<typeof withPlatform<T>>[0]) => withPlatform(fn)
const one = async <T,>(q: ReturnType<typeof sql>) => (await plat(async (tx) => (await tx.execute<T & Record<string, unknown>>(q)).rows))[0]
const D = 86_400_000

async function main() {
  const made: string[] = []
  try {
    // ---- pure: Razorpay's signatures, dunning's rule -------------------------------------------------------------------
    const rp = razorpay('rzp_test', 'key-secret', 'hook-secret')
    const sig = createHmac('sha256', 'key-secret').update('plink_1|ref-1|paid|pay_1').digest('hex')
    const cb = (s: string, status = 'paid') => new URLSearchParams({ razorpay_payment_link_id: 'plink_1', razorpay_payment_link_reference_id: 'ref-1', razorpay_payment_link_status: status, razorpay_payment_id: 'pay_1', razorpay_signature: s })
    check('Razorpay’s callback: a right signature is a payment', rp.verifyCallback(cb(sig))?.providerPaymentId === 'pay_1')
    check('... a wrong one, or an unpaid status, is not', rp.verifyCallback(cb(sig.replace(/.$/, '0'))) === null && rp.verifyCallback(cb(createHmac('sha256', 'key-secret').update('plink_1|ref-1|cancelled|pay_1').digest('hex'), 'cancelled')) === null)
    const body = JSON.stringify({ event: 'payment_link.paid', payload: { payment_link: { entity: { reference_id: 'ref-2' } }, payment: { entity: { id: 'pay_2' } } } })
    const hook = (s: string) => new Headers({ 'x-razorpay-signature': s, 'x-razorpay-event-id': 'evt_1' })
    check('Razorpay’s webhook: signed with the webhook secret', rp.verifyWebhook(body, hook(createHmac('sha256', 'hook-secret').update(body).digest('hex')))?.paid?.ref === 'ref-2')
    check('... with the key secret, or tampered, it is refused', rp.verifyWebhook(body, hook(createHmac('sha256', 'key-secret').update(body).digest('hex'))) === null && rp.verifyWebhook(body.replace('pay_2', 'pay_3'), hook(createHmac('sha256', 'hook-secret').update(body).digest('hex'))) === null)
    const now = new Date(), past = (d: number) => new Date(now.getTime() - d * D)
    check('dunning: nothing before the end', dueStatus('active', new Date(now.getTime() + D), now, false) === null && dueStatus('trial', new Date(now.getTime() + D), now, false) === null)
    check('dunning: trial over -> read-only; paid period over -> past due; cancelled -> read-only', dueStatus('trial', past(1), now, false) === 'read_only' && dueStatus('active', past(1), now, false) === 'past_due' && dueStatus('active', past(1), now, true) === 'read_only')
    check('dunning: 7 days’ grace, then read-only, then suspended after 30 more', dueStatus('past_due', past(6), now, false) === null && dueStatus('past_due', past(8), now, false) === 'read_only' && dueStatus('read_only', past(30), now, false) === null && dueStatus('read_only', past(38), now, false) === 'suspended')

    // ---- an institute pays ----------------------------------------------------------------------------------------------
    const org = await provisionOrg({ name: `Billing Test ${RUN}`, slug: `bill-${RUN}`, ownerName: 'Payer', ownerEmail: `payer.${RUN}@billing.test.invalid`, planKey: 'starter' })
    made.push(org.orgId)
    const head: Actor = { userId: org.ownerUserId, orgId: org.orgId, role: 'super_admin', branchId: null }
    const q = await plat((tx) => quote(tx, org.orgId, 'starter', 'month'))
    check('a monthly Starter: ₹999 + 18% GST', q.amount === 99900 && q.discount === 0 && q.gst === 17982 && q.total === 117882 && q.endsAt.getTime() - q.startsAt.getTime() > 27 * D)
    await throws('a plan arranged with sales cannot be bought here', () => plat((tx) => quote(tx, org.orgId, 'enterprise', 'month')), /arranged with our team/)
    await throws('an unknown plan is refused', () => plat((tx) => quote(tx, org.orgId, 'nope', 'month')), /not on offer/)
    const code = `T${RUN}`.toUpperCase().slice(0, 20)
    await plat((tx) => tx.execute(sql`insert into coupons (code, percent_off, plans, max_redemptions) values (${code}, 20, '{starter}', 1)`))
    const qc = await plat((tx) => quote(tx, org.orgId, 'starter', 'month', code.toLowerCase()))
    check('a code takes 20% off before GST', qc.discount === 19980 && qc.gst === Math.round((99900 - 19980) * 0.18) && qc.coupon === code)
    await throws('... but only for its plans', () => plat((tx) => quote(tx, org.orgId, 'growth', 'month', code)), /not valid/)
    await throws('a branch manager cannot pay for the institute', () => startCheckout({ ...head, role: 'branch_manager', branchId: org.branchId }, { plan: 'starter', interval: 'month' }, 'http://x/billing/return'), /head office/)

    const co = await startCheckout(head, { plan: 'starter', interval: 'month', coupon: code }, `http://bill-${RUN}.localhost:3000/billing/return`)
    check('checkout: a payment waiting, and the (test) payment page', co.url.startsWith('/billing/fake-pay?') && co.total === qc.total)
    const fake = fakeProvider()
    check('the test provider’s return is signed too', fake.verifyCallback(new URLSearchParams({ ref: co.paymentId, payment: 'p1', sig: fakePaidSig(co.paymentId, 'p1') }))?.ref === co.paymentId && fake.verifyCallback(new URLSearchParams({ ref: co.paymentId, payment: 'p1', sig: 'bad' })) === null)
    check('the payment is not recorded under another provider', !(await completePayment('razorpay', { ref: co.paymentId, providerPaymentId: 'x' })).ok)
    const done = await completePayment('fake', { ref: co.paymentId, providerPaymentId: `p1-${RUN}` })
    check('paid: an invoice of this financial year', done.ok && !done.already && /^INV\/\d{4}-\d{2}\/\d{5}$/.test(done.invoice ?? ''), done.invoice)
    check('... told again (callback and webhook), nothing happens twice', (await completePayment('fake', { ref: co.paymentId, providerPaymentId: `p1-${RUN}` })).already === true)
    const o1 = await one<{ status: string; plan_key: string; trial_ends_at: string | null }>(sql`select status, plan_key, trial_ends_at from organisations where id = ${org.orgId}`)
    check('the institute is active on the plan it paid for, its trial over', o1.status === 'active' && o1.plan_key === 'starter' && o1.trial_ends_at === null)
    const s1 = await one<{ start: Date; end: Date; interval: string }>(sql`select current_period_start as start, current_period_end as "end", interval from subscriptions where org_id = ${org.orgId}`)
    check('a month is paid for, from now', s1.interval === 'month' && Math.abs(new Date(s1.start).getTime() - Date.now()) < 60_000 && new Date(s1.end).getTime() - new Date(s1.start).getTime() > 27 * D)
    const i1 = await one<{ number: string; amount: number; discount: number; cgst: number; sgst: number; igst: number; total: number }>(sql`select * from platform_invoices where org_id = ${org.orgId}`)
    check('the invoice: CGST + SGST within the state, adding up to what was paid', i1.amount === 99900 && i1.discount === 19980 && i1.igst === 0 && i1.cgst + i1.sgst === qc.gst && i1.total === qc.total)
    await throws('an issued invoice cannot be changed', () => plat((tx) => tx.execute(sql`update platform_invoices set total = 1 where org_id = ${org.orgId}`)), /cannot be changed/)
    await throws('a code good for one use is used up', () => plat((tx) => quote(tx, org.orgId, 'starter', 'month', code)), /not valid/)

    // renewal carries on; a change of plan starts now with credit
    const renew = await plat((tx) => quote(tx, org.orgId, 'starter', 'month'))
    check('renewing the same plan carries on from the end of the paid period', Math.abs(renew.startsAt.getTime() - new Date(s1.end).getTime()) < 1000 && renew.credit === 0)
    const up = await plat((tx) => quote(tx, org.orgId, 'growth', 'month'))
    check('a bigger plan starts now, with the unused part of this month taken off', up.credit > 79000 && up.credit <= 79920 && up.discount === up.credit && Math.abs(up.startsAt.getTime() - Date.now()) < 60_000)
    process.env.PLATFORM_GSTIN = '03AAAAA0000A1Z5'
    await plat((tx) => tx.execute(sql`update organisations set gstin = '27BBBBB1111B1Z5' where id = ${org.orgId}`))
    const co2 = await startCheckout(head, { plan: 'starter', interval: 'month' }, 'http://x/billing/return')
    const d2 = await completePayment('fake', { ref: co2.paymentId, providerPaymentId: `p2-${RUN}` })
    const s2 = await one<{ end: Date }>(sql`select current_period_end as "end" from subscriptions where org_id = ${org.orgId}`)
    check('the renewal moves the paid period on by a month', new Date(s2.end).getTime() - new Date(s1.end).getTime() > 27 * D)
    const i2 = await one<{ number: string; igst: number; cgst: number }>(sql`select number, igst, cgst from platform_invoices where org_id = ${org.orgId} order by issued_at desc limit 1`)
    const [n1, n2] = [Number(done.invoice!.split('/')[2]), Number(d2.invoice!.split('/')[2])]
    check('invoice numbers follow each other', n2 > n1 && i2.number === d2.invoice)
    check('another state’s GSTIN: IGST', i2.igst === 17982 && i2.cgst === 0)
    await setCancelAtPeriodEnd(head, true)
    check('stopping renewal is kept on the subscription', (await one<{ c: boolean }>(sql`select cancel_at_period_end as c from subscriptions where org_id = ${org.orgId}`)).c === true)

    // ---- dunning on a real institute ------------------------------------------------------------------------------------
    const lapsed = await provisionOrg({ name: `Lapsed ${RUN}`, slug: `lapse-${RUN}`, ownerName: 'Late', ownerEmail: `late.${RUN}@billing.test.invalid` })
    made.push(lapsed.orgId)
    await plat((tx) => tx.execute(sql`update organisations set trial_ends_at = now() - interval '1 day' where id = ${lapsed.orgId}`))
    const r = await runDunning()
    check('a trial that ended without payment becomes read-only', r.changed.some((c) => c.org === `Lapsed ${RUN}` && c.from === 'trial' && c.to === 'read_only'))
    check('... and running it again changes nothing more', !(await runDunning()).changed.some((c) => c.org === `Lapsed ${RUN}`))
    const co3 = await startCheckout({ userId: lapsed.ownerUserId, orgId: lapsed.orgId, role: 'super_admin', branchId: null }, { plan: 'starter', interval: 'year' }, 'http://x/billing/return')
    await completePayment('fake', { ref: co3.paymentId, providerPaymentId: `p3-${RUN}` })
    check('paying opens a read-only institute again, for a year', (await one<{ status: string }>(sql`select status from organisations where id = ${lapsed.orgId}`)).status === 'active')
  } finally {
    for (const id of made) await withPlatform((tx) => tx.execute(sql`update organisations set status = 'cancelled' where id = ${id}`))
    await pool.end()
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed')
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
