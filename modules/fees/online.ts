// Students paying their fees online (the portal's Pay online), into the institute's OWN Razorpay account (Settings →
// Online payments): a hosted payment page (Razorpay Payment Links), so no payment script runs in our pages. The
// provider confirms twice: the browser comes back with a signed answer (/pay/fees/return), and a signed webhook
// arrives on its own (/api/webhooks/fee-payments/<org>); either one records the payment ONCE, through recordPayment,
// so the ledger, the receipt, the installments and the webhooks are exactly as for a payment at the desk.
// Without keys, outside production (or with BILLING_FAKE=1), the fake provider stands in, as for billing.
import { sql } from 'drizzle-orm'
import { getConfig } from '@/lib/config/store'
import { feePaymentLinks } from '@/lib/db/schema'
import { withOrgSystem, withTenant, type Actor, type Tx } from '@/lib/db/withTenant'
import { log } from '@/lib/log'
import { fakeAllowed, fakeProvider, razorpay, type BillingProvider, type Paid } from '@/modules/billing/providers'
import { addMonths, MIN_FIRST_PAYMENT, todayIST } from './plan'
import { courseLimits, getBalance, recordPayment } from './service'

/** A payment page is reused while it is this fresh and for the same amount (a double click opens one page). */
const REUSE_MINUTES = 30

/** The org's provider, or null when online payment is off (or, in production, not set up). */
async function orgProvider(orgId: string, kind?: string): Promise<BillingProvider | null> {
  const { config: c, secrets: s } = await getConfig(orgId, 'payments')
  // a page opened with the fake provider is answered by the fake one, whatever is set up since
  if (kind === 'fake') return fakeAllowed() ? fakeProvider() : null
  if (c.keyId && s.keySecret) return razorpay(c.keyId, s.keySecret, s.webhookSecret ?? null)
  return c.enabled && fakeAllowed() ? fakeProvider() : null
}

/** Whether the org's students can pay online (switched on, and a provider to pay through). */
export async function onlinePaymentsOn(orgId: string): Promise<boolean> {
  const { config: c } = await getConfig(orgId, 'payments')
  return c.enabled && !!(await orgProvider(orgId))
}

/**
 * What a student pays online now: the next installment (what is left of it), else the whole balance; a first payment
 * is at least the minimum first payment. 0 when nothing is due.
 */
export async function dueNow(tx: Tx, registrationId: string): Promise<number> {
  const { charged, discounted, balance } = await getBalance(tx, registrationId)
  if (balance <= 0) return 0
  const [next] = (await tx.execute<{ amount: number }>(sql`
    select amount from installments where registration_id = ${registrationId} and status = 'scheduled' order by due_date, created_at limit 1`)).rows
  let amount = next ? Math.min(next.amount, balance) : balance
  if (charged - discounted - balance <= 0) amount = Math.max(amount, Math.min(MIN_FIRST_PAYMENT, balance))
  return amount
}

/** What a payment page asks for: what is due now, or (the office) the amount given, up to the balance. */
export async function linkAmount(tx: Tx, registrationId: string, asked?: number | null): Promise<number> {
  if (asked != null) {
    const { balance } = await getBalance(tx, registrationId)
    if (!Number.isInteger(asked) || asked < 100) throw new Error('Enter the amount to ask for (at least ₹1)')
    if (balance <= 0) throw new Error('Nothing is due on these fees')
    if (asked > balance) throw new Error(`Only ₹${(balance / 100).toLocaleString('en-IN')} is due`)
    return asked
  }
  const amount = await dueNow(tx, registrationId)
  if (amount <= 0) throw new Error('Nothing is due on your fees')
  return amount
}

/** Where the return from a payment page lands: `back` (feeReturnPath) with how it went and the receipt. */
export const feeReturnUrl = (back: string, status: string, receipt?: string) =>
  `${back === '/' ? '/?tab=fees&' : `${back}${back.includes('?') ? '&' : '?'}`}payment=${status}${receipt ? `&receipt=${encodeURIComponent(receipt)}` : ''}`

/**
 * Opens a payment page for a student's registration (their own only: the student's RLS shows no other) and returns its
 * address. `origin`: the institute's own address, where the browser comes back to.
 */
export async function startFeePayment(actor: Actor, registrationId: string, origin: string): Promise<{ url: string; amount: number }> {
  if (actor.role !== 'student') throw new Error('Online payment is made by the student from their portal')
  const [mine] = (await withTenant(actor, (tx) => tx.execute<{ id: string }>(sql`select id from registrations where id = ${registrationId}`))).rows
  if (!mine) throw new Error('Registration not found')
  return openFeePayment(actor.orgId, registrationId, actor.userId, origin)
}

/**
 * Opens the payment page of a registration the caller has already been allowed (the student's own, or the one a
 * parent's link is for). `by`: the user it is recorded for (the student, or whoever made the parent's link).
 */
export async function openFeePayment(orgId: string, registrationId: string, by: string, origin: string, via: 'student' | 'parent' | 'office' = 'student', opts: { amount?: number | null } = {}): Promise<{ url: string; amount: number }> {
  const provider = await orgProvider(orgId)
  const { config } = await getConfig(orgId, 'payments')
  if (!config.enabled || !provider) throw new Error('Online payment is not available: please pay at your branch office')

  const made = await withOrgSystem(orgId, async (tx) => {
    const [r] = (await tx.execute<{ branch_id: string; status: string; name: string; email: string | null; phone: string | null; course: string | null }>(sql`
      select r.branch_id, r.status, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, p.email, p.phone,
        coalesce(c.title, r.custom_course_title) as course
      from registrations r join persons p on p.id = r.person_id left join courses c on c.id = r.course_id where r.id = ${registrationId}`)).rows
    if (!r) throw new Error('Registration not found')
    if (r.status === 'transferred') throw new Error('Your fees are handled at your new branch now')
    const amount = await linkAmount(tx, registrationId, opts.amount)
    const [open] = (await tx.execute<{ id: string; url: string | null }>(sql`
      select id, url from fee_payment_links where registration_id = ${registrationId} and status = 'pending' and amount = ${amount}
        and provider = ${provider.name} and via = ${via} and url is not null and created_at > now() - make_interval(mins => ${REUSE_MINUTES}) order by created_at desc limit 1`)).rows
    if (open?.url) return { reuse: open.url, amount, r }
    const [link] = await tx.insert(feePaymentLinks).values({ branchId: r.branch_id, registrationId, amount, provider: provider.name, via, createdBy: by }).returning({ id: feePaymentLinks.id })
    return { id: link.id, amount, r }
  })
  if ('reuse' in made && made.reuse) return { url: made.reuse, amount: made.amount }
  const id = (made as { id: string }).id
  try {
    const page = await provider.createPaymentLink({
      ref: id, amount: made.amount, description: `Fees${made.r.course ? `: ${made.r.course}` : ''}`,
      customer: { name: made.r.name, email: made.r.email ?? '', contact: made.r.phone }, callbackUrl: `${origin}/pay/fees/return`,
    })
    await withOrgSystem(orgId, (tx) => tx.execute(sql`update fee_payment_links set provider_link_id = ${page.id}, url = ${page.url} where id = ${id}`))
    return { url: page.url, amount: made.amount }
  } catch (e) {
    await withOrgSystem(orgId, (tx) => tx.execute(sql`update fee_payment_links set status = 'expired', note = ${e instanceof Error ? e.message.slice(0, 300) : 'failed'} where id = ${id}`))
    throw e
  }
}

export type FeeCompletion = { ok: boolean; already?: boolean; receiptNo?: string; review?: boolean }

/** Where the browser goes back to after a payment page: the student's portal, or the thank-you page (a parent's or office link). */
export async function feeReturnPath(orgId: string, ref: string | null): Promise<string> {
  if (!ref || !/^[0-9a-f-]{36}$/i.test(ref)) return '/'
  const [l] = (await withOrgSystem(orgId, (tx) => tx.execute<{ via: string }>(sql`select via from fee_payment_links where id = ${ref}`))).rows
  return l?.via === 'parent' ? '/p/done' : l?.via === 'office' ? '/p/done?via=office' : '/'
}

/**
 * Records a confirmed online payment, once (the browser's return and the webhook may both arrive). A payment that can
 * no longer be recorded as it is (the balance changed meanwhile, e.g. paid at the desk) is kept for the office to
 * decide (status review): the money was taken, so it is never dropped silently.
 */
export async function completeFeePayment(orgId: string, paid: Paid): Promise<FeeCompletion> {
  if (!/^[0-9a-f-]{36}$/i.test(paid.ref)) return { ok: false }
  return withOrgSystem(orgId, (tx) => completeFeePaymentIn(tx, orgId, paid))
}
export async function completeFeePaymentIn(tx: Tx, orgId: string, paid: Paid): Promise<FeeCompletion> {
  {
    const [l] = (await tx.execute<{ id: string; registration_id: string; amount: number; status: string; created_by: string | null; payment_id: string | null }>(sql`
      select id, registration_id, amount, status, created_by, payment_id from fee_payment_links where id = ${paid.ref} for update`)).rows
    if (!l) return { ok: false }
    if (l.status === 'paid') {
      const [rc] = (await tx.execute<{ receipt_no: string }>(sql`select receipt_no from receipts where payment_id = ${l.payment_id}`)).rows
      return { ok: true, already: true, receiptNo: rc?.receipt_no }
    }
    if (l.status === 'review') return { ok: true, already: true, review: true }
    // the same money confirmed for another payment page (a replayed answer): it is recorded there, once
    const [other] = (await tx.execute<{ status: string; receipt_no: string | null }>(sql`
      select l.status, rc.receipt_no from fee_payment_links l left join receipts rc on rc.payment_id = l.payment_id
      where l.provider_payment_id = ${paid.providerPaymentId} and l.id <> ${l.id} limit 1`)).rows
    if (other) return { ok: true, already: true, review: other.status === 'review', receiptNo: other.receipt_no ?? undefined }
    const review = async (why: string) => {
      await tx.execute(sql`update fee_payment_links set status = 'review', provider_payment_id = ${paid.providerPaymentId}, paid_at = now(), note = ${why.slice(0, 300)} where id = ${l.id}`)
      log.warn('fees.online_review', { orgId, link: l.id, why })
      return { ok: true, review: true }
    }
    const modeId = await onlineModeId(tx)
    const today = todayIST()
    const { balance } = await getBalance(tx, l.registration_id)
    if (l.amount > balance) return review(`Paid ₹${l.amount / 100} online, but only ₹${Math.max(0, balance) / 100} was due by then`)
    const [reg] = (await tx.execute<{ planned: boolean }>(sql`select fee_plan is not null as planned from registrations where id = ${l.registration_id}`)).rows
    const remaining = balance - l.amount
    // without a payment plan, a payment that leaves a balance names the next installment: a month on, by the course's last due date
    let next: { nextInstallmentDate: string; nextInstallmentAmount: number } | null = null
    if (remaining > 0 && !reg?.planned) {
      const limits = await courseLimits(tx, l.registration_id)
      const month = addMonths(today, 1)
      next = { nextInstallmentDate: limits && !limits.late && limits.lastDue < month ? (limits.lastDue < today ? today : limits.lastDue) : month, nextInstallmentAmount: remaining }
    }
    // the office's own act on the student's behalf: the student who paid is who it is recorded for
    const actor: Actor = { userId: l.created_by ?? '00000000-0000-0000-0000-000000000000', orgId, role: 'super_admin', branchId: null }
    try {
      const done = await tx.transaction((sp) => recordPayment(sp, actor, {
        registrationId: l.registration_id, amount: l.amount, modeId, txnRef: paid.providerPaymentId, remark: 'Paid online', ...(next ?? {}),
      }, { online: true }))
      await tx.execute(sql`update fee_payment_links set status = 'paid', provider_payment_id = ${paid.providerPaymentId}, payment_id = ${done.payment.id}, paid_at = now() where id = ${l.id}`)
      return { ok: true, receiptNo: done.receipt.receiptNo }
    } catch (e) {
      return review(e instanceof Error ? e.message : String(e))
    }
  }
}

/** The org's "Online" payment mode (made when it has none). */
async function onlineModeId(tx: Tx): Promise<string> {
  const [m] = (await tx.execute<{ id: string }>(sql`
    select id from lookups where kind = 'payment_mode' and lower(value) = 'online' order by is_active desc limit 1`)).rows
  if (m) return m.id
  const [made] = (await tx.execute<{ id: string }>(sql`insert into lookups (kind, value) values ('payment_mode', 'Online') returning id`)).rows
  return made.id
}

/** The browser's return from the payment page: the payment, if the signature is right (with the provider that opened it). */
export async function verifyFeeReturn(orgId: string, q: URLSearchParams): Promise<Paid | null> {
  for (const kind of ['razorpay', 'fake']) {
    const p = await orgProvider(orgId, kind === 'fake' ? 'fake' : undefined)
    const paid = p?.name === kind ? p.verifyCallback(q) : null
    if (paid) return paid
  }
  return null
}

/** A webhook from the org's Razorpay account: the payment, if the signature is right and it is a paid payment page. */
export async function verifyFeeWebhook(orgId: string, rawBody: string, headers: Headers): Promise<Paid | null | 'bad'> {
  const p = await orgProvider(orgId)
  const v = p?.name === 'razorpay' ? p.verifyWebhook(rawBody, headers) : null
  if (!v) return 'bad'
  return v.paid
}

export type OnlinePaymentRow = { id: string; createdAt: string; amount: number; status: string; name: string; regNo: string; branch: string; receiptNo: string | null; note: string | null; providerPaymentId: string | null }

/** The online payments the staff may see (their branch; head office every branch): the newest first. */
export async function listOnlinePayments(tx: Tx, limit = 100): Promise<OnlinePaymentRow[]> {
  return (await tx.execute<OnlinePaymentRow>(sql`
    select l.id, l.created_at::text as "createdAt", l.amount, l.status, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, r.reg_no as "regNo",
      b.name as branch, rc.receipt_no as "receiptNo", l.note, l.provider_payment_id as "providerPaymentId"
    from fee_payment_links l join registrations r on r.id = l.registration_id join persons p on p.id = r.person_id join branches b on b.id = l.branch_id
      left join receipts rc on rc.payment_id = l.payment_id
    where l.status <> 'expired' order by l.created_at desc limit ${limit}`)).rows
}
