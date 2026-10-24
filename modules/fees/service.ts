// The ONLY place money is written (P4). Balance is never stored: it is sum(fee_ledger) via v_fee_balance.
import { ruleValue } from '../settings/service'
import { assertFranchiseFee } from '../franchise/fees'
import { emitPayment } from '@/modules/integrations/webhooks'
import { and, eq, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { assertCan, can } from '@/lib/auth/permissions'
import { branches, feeChangeRequests, feeLedger, feeRemarks, installments, lookups, payments, receipts, registrationDocuments, registrations } from '@/lib/db/schema'
import { buildPlan, MAX_INSTALLMENTS, MIN_FIRST_PAYMENT, paymentChannel, dayLabel, paymentProblem, planLimits, planProblem, todayIST, type FeePlan, type PlanLimits, type PlanLine } from './plan'
import { attachPaymentProof } from '../documents/service'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { nextReceiptNo } from '@/lib/numbering'
import { parseReceiptToken, receiptToken, receiptTokenValid } from '@/lib/receipt-token'
import { withOrgSystem } from '@/lib/db/withTenant'
import type { ListQuery } from '@/lib/list-query'
import { cleanQuery, inRange } from '@/lib/list-query-sql'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const paise = z.number().int().positive()

export const recordPaymentInput = z.object({
  registrationId: z.string().uuid(),
  amount: paise,
  modeId: z.string().uuid(),
  txnRef: z.string().trim().max(100).optional().nullable(),
  /** The day the money was received, when not today (never in the future). */
  paidOn: isoDate.optional().nullable(),
  remark: z.string().trim().max(200).optional().nullable(),
  /** A paper slip was given at the desk: it gets a slip ID and is kept as uploaded; no e-receipt is made. */
  paperSlip: z.boolean().optional(),
  nextInstallmentDate: isoDate.optional().nullable(),
  nextInstallmentAmount: paise.optional().nullable(),
})
export type RecordPaymentInput = z.infer<typeof recordPaymentInput>

export const discountInput = z.object({
  registrationId: z.string().uuid(),
  amount: paise,
  reason: z.string().trim().min(3, 'A reason is required').max(300),
})
export type DiscountInput = z.infer<typeof discountInput>

export type FeeBalance = { charged: number; discounted: number; paid: number; balance: number }

export async function getBalance(tx: Tx, registrationId: string): Promise<FeeBalance> {
  const res = await tx.execute<{ charged: number; discounted: number; paid: number; balance: number }>(
    sql`select charged, discounted, paid, balance from v_fee_balance where registration_id = ${registrationId}`,
  )
  if (!res.rows[0]) throw new Error('Registration not found')
  return res.rows[0]
}

/** Called by createRegistration in the same transaction: the fee becomes a CHARGE row. */
export async function postCharge(tx: Tx, actor: Actor, reg: { id: string; branchId: string; totalFee: number }) {
  await tx.insert(feeLedger).values({ branchId: reg.branchId, registrationId: reg.id, entryType: 'charge', amount: reg.totalFee, note: 'Course fee', createdBy: actor.userId })
}

/**
 * Data migration only (insti.md §11.5): what a student paid BEFORE this system becomes one ADJUSTMENT row,
 * so the ledger starts at the right balance without minting receipts for old payments. Optionally schedules
 * the next installment from the old records.
 */
export async function postOpeningBalance(tx: Tx, actor: Actor, reg: { id: string; branchId: string; totalFee: number }, paidBefore: number, next?: { dueDate: string; amount: number } | null) {
  assertCan(actor, 'create', 'fee')
  if (!Number.isInteger(paidBefore) || paidBefore < 0) throw new Error('Amount paid must be zero or more')
  if (paidBefore > reg.totalFee) throw new Error('Amount paid is more than the total fee')
  if (paidBefore > 0) {
    await tx.insert(feeLedger).values({ branchId: reg.branchId, registrationId: reg.id, entryType: 'adjustment', amount: -paidBefore, note: 'Opening balance: paid before migration', createdBy: actor.userId })
  }
  const remaining = reg.totalFee - paidBefore
  if (next) {
    if (remaining <= 0) throw new Error('Next due given but nothing is left to pay')
    if (next.amount <= 0 || next.amount > remaining) throw new Error('Next due amount must be between 1 and the remaining balance')
    await tx.insert(installments).values({ branchId: reg.branchId, registrationId: reg.id, dueDate: next.dueDate, amount: next.amount })
  }
  return { balance: remaining }
}

/** A registration moved to another branch is closed for money: payments, discounts, fee changes and reversals are made at the new branch. */
export function assertOpenFees(reg: { status: string }) {
  if (reg.status === 'transferred') throw new Error('This student was transferred to another branch: their fees are handled there now')
}

/** `opts.online`: paid by the student online (modules/fees/online.ts): nobody at the desk received it. */
export async function recordPayment(tx: Tx, actor: Actor, raw: RecordPaymentInput, opts: { online?: boolean } = {}) {
  assertCan(actor, 'create', 'fee')
  const input = recordPaymentInput.parse(raw)
  const [reg] = await tx.select().from(registrations).where(eq(registrations.id, input.registrationId)).for('update')
  if (!reg) throw new Error('Registration not found')
  assertOpenFees(reg)
  const [mode] = await tx.select().from(lookups).where(and(eq(lookups.id, input.modeId), eq(lookups.kind, 'payment_mode')))
  if (!mode) throw new Error('Invalid payment mode')

  const today = todayIST()
  if (input.paidOn && input.paidOn > today) throw new Error('The payment date cannot be in the future')
  if (input.paidOn && input.paidOn < String(reg.enrollmentDate)) throw new Error('The payment date cannot be before the registration date')
  // The same transfer or cheque is not taken twice (a reversed payment — e.g. entered wrongly — does not count).
  if (input.txnRef && paymentChannel(mode.value) !== 'cash') {
    const dup = await tx.execute<{ receipt_no: string }>(sql`select rc.receipt_no from v_live_payments p join receipts rc on rc.payment_id = p.id where p.mode_id = ${mode.id} and lower(p.txn_ref) = lower(${input.txnRef}) limit 1`)
    if (dup.rows[0]) throw new Error(`This reference is already recorded on receipt ${dup.rows[0].receipt_no}`)
  }
  const { balance } = await getBalance(tx, reg.id)
  if (balance <= 0) throw new Error('Nothing is due on this registration')
  if (input.amount > balance) throw new Error('Amount is more than the outstanding balance')

  // The first payment activates the student: it cannot be a token amount.
  const { charged, discounted } = await getBalance(tx, reg.id)
  const firstMin = Math.min(MIN_FIRST_PAYMENT, balance)
  if (charged - discounted - balance <= 0 && input.amount < firstMin) throw new Error(`The first payment must be at least ₹${(firstMin / 100).toLocaleString('en-IN')}`)

  const remaining = balance - input.amount
  const planned = !!reg.feePlan // a payment plan decides the coming installments; without one the next installment is asked for
  if (remaining > 0 && !planned) {
    // fildes.md: next installment date + amount are mandatory whenever a balance is left.
    if (!input.nextInstallmentDate || !input.nextInstallmentAmount) throw new Error('Next installment date and amount are mandatory')
    if (input.nextInstallmentAmount > remaining) throw new Error('Next installment cannot exceed the remaining balance')
    const limits = await courseLimits(tx, reg.id)
    if (limits && !limits.late && input.nextInstallmentDate > limits.lastDue) throw new Error(`The next installment must be on or before ${dayLabel(limits.lastDue)}, one month before the course ends (${dayLabel(limits.end)})`)
  }

  const [branch] = await tx.select().from(branches).where(eq(branches.id, reg.branchId))
  const receiptNo = await nextReceiptNo(tx, reg.branchId, branch.code) // also the slip ID of a paper slip
  const [pay] = await tx
    .insert(payments)
    .values({ branchId: reg.branchId, registrationId: reg.id, amount: input.amount, modeId: input.modeId, txnRef: input.txnRef, manualSlipNo: input.paperSlip ? receiptNo : null, receivedBy: opts.online ? null : actor.userId, ...(input.paidOn && input.paidOn !== today ? { paidAt: new Date(`${input.paidOn}T12:00:00+05:30`) } : {}) })
    .returning()
  await tx.insert(feeLedger).values({ branchId: reg.branchId, registrationId: reg.id, entryType: 'payment', amount: -input.amount, refId: pay.id, note: input.remark ? `${mode.value} · ${input.remark}` : mode.value, createdBy: actor.userId })
  const [receipt] = await tx.insert(receipts).values({ receiptNo, branchId: reg.branchId, paymentId: pay.id }).returning()

  if (planned) {
    // The money goes to the installments in the order they fall due; one paid in part stays scheduled for the rest.
    await settleInstallments(tx, reg, remaining)
  } else {
    // The payment settles whatever was scheduled; the next one (if any) replaces it.
    await tx.update(installments).set({ status: 'paid' }).where(and(eq(installments.registrationId, reg.id), eq(installments.status, 'scheduled')))
    if (remaining > 0) {
      await tx.insert(installments).values({ branchId: reg.branchId, registrationId: reg.id, dueDate: input.nextInstallmentDate!, amount: input.nextInstallmentAmount! })
    }
  }
  await audit(tx, actor, { action: 'create', entity: 'payment', entityId: pay.id, after: { receiptNo, amount: input.amount, registrationId: reg.id } })
  await emitPayment(tx, pay.id, remaining)
  return { payment: pay, receipt, balanceAfter: remaining }
}

type RegRef = { id: string; branchId: string }

/**
 * Makes the scheduled installments add up to what is still to be paid (`balance`), keeping their dates.
 * Less to pay (a payment, a lower fee): the earliest installments are paid off first. More to pay (a higher fee):
 * the difference goes on the last installment, or a new one a month from now when none is left.
 */
async function settleInstallments(tx: Tx, reg: RegRef, balance: number, why: 'payment' | 'fee_cut' = 'payment') {
  const rows = await tx.select().from(installments).where(and(eq(installments.registrationId, reg.id), eq(installments.status, 'scheduled'))).orderBy(installments.dueDate, installments.createdAt)
  let over = rows.reduce((n, r) => n + r.amount, 0) - balance
  // A payment pays off the earliest installments; a lower fee comes off the last ones (and nothing was paid for those).
  for (const r of why === 'payment' ? rows : [...rows].reverse()) {
    if (over <= 0) break
    if (r.amount <= over) { await tx.update(installments).set({ status: why === 'payment' ? 'paid' : 'cancelled' }).where(eq(installments.id, r.id)); over -= r.amount }
    else { await tx.update(installments).set({ amount: r.amount - over }).where(eq(installments.id, r.id)); over = 0 }
  }
  if (over < 0) {
    const last = rows[rows.length - 1]
    if (last) await tx.update(installments).set({ amount: last.amount - over }).where(eq(installments.id, last.id))
    else await tx.insert(installments).values({ branchId: reg.branchId, registrationId: reg.id, dueDate: sql`(current_date + 30)`, amount: -over })
  }
}

export const feePlanInput = z.object({
  type: z.enum(['full', 'installments']),
  count: z.number().int().min(1).max(MAX_INSTALLMENTS),
  pattern: z.enum(['monthly', 'alternate', 'custom']),
  firstDue: isoDate,
  /** Only for pattern 'custom': the installments as typed. */
  lines: z.array(z.object({ dueDate: isoDate, amount: paise })).max(MAX_INSTALLMENTS).optional().nullable(),
})
export type FeePlanInput = z.infer<typeof feePlanInput>

/** What the registration's course allows a plan (see planLimits): from the joining (else registration) date to the expected finish. */
export async function courseLimits(tx: Tx, registrationId: string): Promise<PlanLimits | null> {
  const [r] = await tx.select({ start: sql<string | null>`coalesce(${registrations.joiningDate}, ${registrations.enrollmentDate})::text`, end: sql<string | null>`${registrations.expectedEndDate}::text` })
    .from(registrations).where(eq(registrations.id, registrationId))
  return r ? planLimits(r.start, r.end, todayIST()) : null
}

/** The plan as saved, and its installments for `balance`. */
function planAndLines(input: FeePlanInput, balance: number): { plan: FeePlan; lines: PlanLine[] } {
  const plan: FeePlan = { type: input.type, count: input.type === 'full' ? 1 : input.count, pattern: input.type === 'full' ? 'monthly' : input.pattern, firstDue: input.firstDue }
  return { plan, lines: plan.type === 'installments' && plan.pattern === 'custom' ? input.lines ?? [] : buildPlan(balance, plan) }
}

/** Replaces the coming installments of a registration by those of the plan, for what is still to be paid. No permission check: callers decide who may. */
export async function writeFeePlan(tx: Tx, reg: RegRef, balance: number, raw: FeePlanInput) {
  const { plan, lines } = planAndLines(feePlanInput.parse(raw), balance)
  if (balance > 0) {
    const problem = planProblem(balance, lines, await courseLimits(tx, reg.id))
    if (problem) throw new Error(problem)
  }
  await tx.update(installments).set({ status: 'cancelled' }).where(and(eq(installments.registrationId, reg.id), eq(installments.status, 'scheduled')))
  if (balance > 0) await tx.insert(installments).values(lines.map((l) => ({ branchId: reg.branchId, registrationId: reg.id, dueDate: l.dueDate, amount: l.amount })))
  await tx.update(registrations).set({ feePlan: { ...plan, count: plan.type === 'full' ? 1 : lines.length || plan.count } }).where(eq(registrations.id, reg.id))
  return lines
}

/** Accounts (or whoever may change fees) sets or changes how the rest of a student's fee is paid. */
export async function setFeePlan(tx: Tx, actor: Actor, raw: { registrationId: string; plan: FeePlanInput }) {
  assertCan(actor, 'update', 'fee')
  const [reg] = await tx.select().from(registrations).where(eq(registrations.id, z.string().uuid().parse(raw.registrationId))).for('update')
  if (!reg) throw new Error('Registration not found')
  assertOpenFees(reg)
  const { balance } = await getBalance(tx, reg.id)
  if (balance <= 0) throw new Error('Nothing is left to pay on this registration')
  const lines = await writeFeePlan(tx, reg, balance, raw.plan)
  await audit(tx, actor, { action: 'update', entity: 'fee_plan', entityId: reg.id, before: { plan: reg.feePlan }, after: { plan: raw.plan.type, installments: lines.length, balance } })
  return lines
}

export type InstallmentRow = { id: string; dueDate: string; amount: number; status: 'scheduled' | 'paid' | 'cancelled' }
/** What is still to come (and what was paid) for one registration, with its plan. */
export async function feeSchedule(tx: Tx, actor: Actor, registrationId: string): Promise<{ plan: FeePlan | null; balance: FeeBalance; installments: InstallmentRow[] }> {
  assertCan(actor, 'read', 'fee')
  const [reg] = await tx.select({ id: registrations.id, feePlan: registrations.feePlan }).from(registrations).where(eq(registrations.id, z.string().uuid().parse(registrationId)))
  if (!reg) throw new Error('Registration not found')
  const rows = await tx.select().from(installments).where(and(eq(installments.registrationId, reg.id), sql`${installments.status} <> 'cancelled'`)).orderBy(installments.dueDate, installments.createdAt)
  return { plan: reg.feePlan, balance: await getBalance(tx, reg.id), installments: rows.map((r) => ({ id: r.id, dueDate: String(r.dueDate), amount: r.amount, status: r.status })) }
}

// ---- Changing a student's total fees: only accounts does it; admissions sends a request ----

export const feeChangeInput = z.object({
  registrationId: z.string().uuid(),
  newTotal: paise,
  reason: z.string().trim().min(3, 'A reason is required').max(300),
  /** A request may also (or only) ask for another payment plan. */
  plan: feePlanInput.optional().nullable(),
})
export type FeeChangeInput = z.infer<typeof feeChangeInput>

/** Changes the total fees of a registration. A rise is a further charge, a cut a discount, so the ledger stays the record. */
export async function changeTotalFee(tx: Tx, actor: Actor, raw: FeeChangeInput) {
  assertCan(actor, 'update', 'fee')
  const input = feeChangeInput.parse(raw)
  const [reg] = await tx.select().from(registrations).where(eq(registrations.id, input.registrationId)).for('update')
  if (!reg) throw new Error('Registration not found')
  assertOpenFees(reg)
  // the total fee is what the student owes in all after discounts: the ledger's charges less its discounts
  const { balance, charged, discounted } = await getBalance(tx, reg.id)
  const current = charged - discounted
  const delta = input.newTotal - current
  if (delta === 0) throw new Error('That is already the total fees')
  if (balance + delta < 0) throw new Error(`The student has already paid more than that: the total cannot go below ₹${((current - balance) / 100).toLocaleString('en-IN')}`)
  await assertFranchiseFee(tx, reg.branchId, reg.courseId, input.newTotal)
  const limit = await overHeadOfficeLimit(tx, actor, current, -delta)
  if (limit) throw new Error(`A cut of more than ${limit}% of the fee is approved by head office: give it as a discount and it goes to them`)

  await tx.insert(feeLedger).values({ branchId: reg.branchId, registrationId: reg.id, entryType: delta > 0 ? 'charge' : 'discount', amount: delta, note: `Total fees changed: ${input.reason}`, createdBy: actor.userId })
  // The fee's parts follow in the same proportion (course fee + GST = total; the list fee is never below it).
  const gst = reg.courseFee != null && reg.gstAmount != null && reg.totalFee > 0 ? Math.round(input.newTotal * reg.gstAmount / reg.totalFee) : null
  await tx.update(registrations).set({
    totalFee: input.newTotal, updatedAt: new Date(),
    ...(gst != null ? { gstAmount: gst, courseFee: input.newTotal - gst } : {}),
    ...(reg.listFee != null && reg.listFee < input.newTotal ? { listFee: input.newTotal } : {}),
  }).where(eq(registrations.id, reg.id))
  await settleInstallments(tx, reg, balance + delta, 'fee_cut')
  await audit(tx, actor, { action: 'update', entity: 'registration_fee', entityId: reg.id, before: { totalFee: current }, after: { totalFee: input.newTotal, reason: input.reason } })
  return { totalFee: input.newTotal, balance: balance + delta }
}

/** Admissions asks accounts to change a student's total fees. One open request per registration. */
export async function requestFeeChange(tx: Tx, actor: Actor, raw: FeeChangeInput) {
  if (!can(actor, 'update', 'registration') && !can(actor, 'create', 'registration')) throw new Error('Forbidden: request a fee change')
  const input = feeChangeInput.parse(raw)
  const [reg] = await tx.select().from(registrations).where(eq(registrations.id, input.registrationId))
  if (!reg) throw new Error('Registration not found')
  assertOpenFees(reg)
  if (input.newTotal === reg.totalFee && !input.plan) throw new Error('Nothing is asked to change: give new total fees or a new payment plan')
  const [open] = await tx.select({ id: feeChangeRequests.id }).from(feeChangeRequests).where(and(eq(feeChangeRequests.registrationId, reg.id), eq(feeChangeRequests.status, 'pending')))
  if (open) throw new Error('A fee change is already waiting with accounts for this student')
  if (input.plan) {
    // Checked now, so accounts is not handed a plan the course does not allow.
    const balance = (await getBalance(tx, reg.id)).balance + input.newTotal - reg.totalFee
    const problem = balance > 0 ? planProblem(balance, planAndLines(input.plan, balance).lines, await courseLimits(tx, reg.id)) : ''
    if (problem) throw new Error(`Payment plan: ${problem}`)
  }
  const [row] = await tx.insert(feeChangeRequests).values({ branchId: reg.branchId, registrationId: reg.id, currentTotal: reg.totalFee, newTotal: input.newTotal, requestedPlan: input.plan ?? null, reason: input.reason, requestedBy: actor.userId }).returning()
  await audit(tx, actor, { action: 'create', entity: 'fee_change_request', entityId: row.id, after: { registrationId: reg.id, from: reg.totalFee, to: input.newTotal } })
  return row
}

export type FeeChangeRequestRow = { id: string; registrationId: string; regNo: string; name: string; currentTotal: number; newTotal: number; plan: FeePlanInput | null; reason: string; requestedBy: string | null; requestedAt: string; headOffice: boolean }
/** Fee changes waiting for accounts, oldest first. */
export async function listFeeChangeRequests(tx: Tx, actor: Actor): Promise<FeeChangeRequestRow[]> {
  assertCan(actor, 'read', 'fee')
  const res = await tx.execute<Record<string, never>>(sql`
    select q.id, q.registration_id, r.reg_no, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, r.total_fee, q.new_total, q.requested_plan, q.reason, u.name as requested_by, q.requested_at, q.head_office
    from fee_change_requests q join registrations r on r.id = q.registration_id join persons p on p.id = r.person_id left join users u on u.id = q.requested_by
    where q.status = 'pending' order by q.requested_at desc limit 100`)
  return res.rows.map((r) => ({ id: r.id, registrationId: r.registration_id, regNo: r.reg_no, name: r.name, currentTotal: r.total_fee, newTotal: r.new_total, plan: r.requested_plan, reason: r.reason, requestedBy: r.requested_by, requestedAt: new Date(r.requested_at).toISOString(), headOffice: !!r.head_office }))
}

/** Accounts approves (the total fees are then changed) or rejects a request. */
export async function decideFeeChange(tx: Tx, actor: Actor, raw: { requestId: string; approve: boolean; note?: string | null }) {
  assertCan(actor, 'update', 'fee')
  const [q] = await tx.select().from(feeChangeRequests).where(eq(feeChangeRequests.id, z.string().uuid().parse(raw.requestId))).for('update')
  if (!q || q.status !== 'pending') throw new Error('This request is no longer waiting')
  if (q.headOffice && actor.role !== 'super_admin') throw new Error('Head office decides this one: the discount is above the institute’s limit')
  const note = raw.note?.trim().slice(0, 300) || null
  if (!raw.approve && !note) throw new Error('Say why the request is rejected')
  if (raw.approve) {
    const [reg] = await tx.select().from(registrations).where(eq(registrations.id, q.registrationId)).for('update')
    assertOpenFees(reg)
    if (q.newTotal !== reg.totalFee) await changeTotalFee(tx, actor, { registrationId: q.registrationId, newTotal: q.newTotal, reason: q.reason })
    if (q.requestedPlan) {
      const { balance } = await getBalance(tx, reg.id)
      // The plan was drawn up for the balance at the time: set dates are kept only when they still add up.
      const plan = q.requestedPlan.lines && q.requestedPlan.lines.reduce((n, l) => n + l.amount, 0) !== balance ? { ...q.requestedPlan, pattern: 'monthly' as const, lines: null } : q.requestedPlan
      if (balance > 0) await writeFeePlan(tx, reg, balance, plan)
    }
  }
  await tx.update(feeChangeRequests).set({ status: raw.approve ? 'approved' : 'rejected', decidedBy: actor.userId, decidedAt: new Date(), decisionNote: note }).where(eq(feeChangeRequests.id, q.id))
  await audit(tx, actor, { action: raw.approve ? 'approve' : 'reject', entity: 'fee_change_request', entityId: q.id, after: { registrationId: q.registrationId, newTotal: q.newTotal, note } })
  return { approved: raw.approve }
}

// ---- Accounts checks the fees admissions collects: a remark on anything wrong, fixed by whoever collects ----

export const feeRemarkInput = z.object({
  registrationId: z.string().uuid(),
  /** the receipt it is about, when it is about one payment */
  receiptNo: z.string().trim().max(60).optional().nullable(),
  note: z.string().trim().min(5, 'Write what is wrong (at least a few words)').max(500),
})
export type FeeRemarkInput = z.infer<typeof feeRemarkInput>
export type FeeRemarkRow = {
  id: string; registrationId: string; regNo: string; name: string; receiptNo: string | null; note: string; status: 'open' | 'fixed'
  raisedBy: string | null; raisedAt: string; fixedBy: string | null; fixedAt: string | null; fixNote: string | null
}

/** Who fixes a remark: whoever collects or changes fees (and branch heads). */
export const mayFixFees = (a: Actor) => can(a, 'create', 'fee') || can(a, 'update', 'fee') || can(a, 'approve', 'fee')

/** Accounts raises a remark on a student's fees, or on one of their receipts. */
export async function raiseFeeRemark(tx: Tx, actor: Actor, raw: FeeRemarkInput) {
  assertCan(actor, 'clear', 'fee')
  const input = feeRemarkInput.parse(raw)
  const [reg] = await tx.select({ id: registrations.id, branchId: registrations.branchId }).from(registrations).where(eq(registrations.id, input.registrationId))
  if (!reg) throw new Error('Registration not found')
  const receiptNo = input.receiptNo || null
  if (receiptNo) {
    const [rc] = await tx.select({ no: receipts.receiptNo }).from(receipts).innerJoin(payments, eq(payments.id, receipts.paymentId))
      .where(and(eq(receipts.receiptNo, receiptNo), eq(payments.registrationId, reg.id)))
    if (!rc) throw new Error('That receipt is not one of this student’s')
  }
  const [row] = await tx.insert(feeRemarks).values({ branchId: reg.branchId, registrationId: reg.id, receiptNo, note: input.note, raisedBy: actor.userId }).returning({ id: feeRemarks.id })
  await audit(tx, actor, { action: 'create', entity: 'fee_remark', entityId: row.id, after: { registrationId: reg.id, receiptNo, note: input.note } })
  return row
}

/** Marks a remark fixed, saying what was done. Whoever collects fees does it; the one who raised it may also close it. */
export async function fixFeeRemark(tx: Tx, actor: Actor, raw: { remarkId: string; note: string }) {
  const [q] = await tx.select().from(feeRemarks).where(eq(feeRemarks.id, z.string().uuid().parse(raw.remarkId))).for('update')
  if (!q) throw new Error('Remark not found')
  if (!mayFixFees(actor) && q.raisedBy !== actor.userId) throw new Error('Forbidden: fix a fee remark')
  if (q.status !== 'open') throw new Error('This remark is already fixed')
  const note = z.string().trim().min(3, 'Say what was fixed').max(500).parse(raw.note)
  await tx.update(feeRemarks).set({ status: 'fixed', fixedBy: actor.userId, fixedAt: new Date(), fixNote: note }).where(eq(feeRemarks.id, q.id))
  await audit(tx, actor, { action: 'update', entity: 'fee_remark', entityId: q.id, before: { status: 'open' }, after: { status: 'fixed', note } })
  return { fixed: true }
}

const remarkRow = (r: Record<string, never>): FeeRemarkRow => ({
  id: r.id, registrationId: r.registration_id, regNo: r.reg_no, name: r.name, receiptNo: r.receipt_no, note: r.note, status: r.status,
  raisedBy: r.raised_by, raisedAt: new Date(r.raised_at).toISOString(), fixedBy: r.fixed_by, fixedAt: r.fixed_at ? new Date(r.fixed_at).toISOString() : null, fixNote: r.fix_note,
})
const remarksSql = (where: SQL) => sql`
  select q.id, q.registration_id, r.reg_no, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, q.receipt_no, q.note, q.status,
    u.name as raised_by, q.raised_at, fu.name as fixed_by, q.fixed_at, q.fix_note
  from fee_remarks q join registrations r on r.id = q.registration_id join persons p on p.id = r.person_id
    left join users u on u.id = q.raised_by left join users fu on fu.id = q.fixed_by
  where ${where} order by q.status = 'open' desc, q.raised_at desc limit 100`

/** The remarks still open in the branch, for the fees page. */
export async function listOpenFeeRemarks(tx: Tx, actor: Actor): Promise<FeeRemarkRow[]> {
  assertCan(actor, 'read', 'fee')
  return (await tx.execute<Record<string, never>>(remarksSql(sql`q.status = 'open'`))).rows.map(remarkRow)
}

// ---- Correcting a payment: it is reversed, never edited (payments, receipts and the ledger are append-only) ----

export const reversalInput = z.object({
  receiptNo: z.string().trim().min(3).max(60),
  kind: z.enum(['wrong_entry', 'refund']),
  reason: z.string().trim().min(5, 'Write why (at least a few words)').max(300),
  /** a refund: how the money went back (cash, UPI…) and its reference */
  refundMode: z.string().trim().max(40).optional().nullable(),
  refundRef: z.string().trim().max(80).optional().nullable(),
})
export type ReversalInput = z.infer<typeof reversalInput>

/**
 * Reverses a payment: a wrong entry (the money never came, or it was entered twice) or a refund (money given back).
 * The receipt stays, marked CANCELLED; a REFUND ledger row puts the amount back on the balance, and the coming
 * installments grow by it. Only who approves fees (branch manager, head office) does this; once per payment.
 */
export async function reversePayment(tx: Tx, actor: Actor, raw: ReversalInput) {
  assertCan(actor, 'approve', 'fee')
  const input = reversalInput.parse(raw)
  if (input.kind === 'refund' && !input.refundMode) throw new Error('Say how the money was given back (cash, UPI, bank transfer…)')
  const [p] = (await tx.execute<{ id: string; amount: number; registration_id: string; branch_id: string }>(sql`
    select pay.id, pay.amount, pay.registration_id, pay.branch_id from receipts rc join payments pay on pay.id = rc.payment_id where rc.receipt_no = ${input.receiptNo}`)).rows
  if (!p) throw new Error('Receipt not found')
  // one at a time per student: the registration row is the lock (payments themselves are never updated)
  const [reg] = await tx.select().from(registrations).where(eq(registrations.id, p.registration_id)).for('update')
  if (!reg) throw new Error('Registration not found')
  // after a transfer the payment is counted at the new branch: a refund there is made at the new branch
  assertOpenFees(reg)
  const [done] = (await tx.execute(sql`select 1 from payment_reversals where payment_id = ${p.id}`)).rows
  if (done) throw new Error('This payment is already reversed')

  await tx.execute(sql`insert into payment_reversals (payment_id, branch_id, registration_id, kind, reason, refund_mode, refund_ref, reversed_by)
    values (${p.id}, ${p.branch_id}, ${reg.id}, ${input.kind}, ${input.reason}, ${input.kind === 'refund' ? input.refundMode ?? null : null}, ${input.kind === 'refund' ? input.refundRef || null : null}, ${actor.userId})`)
  const label = input.kind === 'refund' ? 'Refund' : 'Wrong entry reversed'
  await tx.insert(feeLedger).values({ branchId: reg.branchId, registrationId: reg.id, entryType: 'refund', amount: p.amount, refId: p.id, note: `${label} · receipt ${input.receiptNo} · ${input.reason}`, createdBy: actor.userId })
  const { balance } = await getBalance(tx, reg.id)
  if (balance > 0) await settleInstallments(tx, reg, balance)
  await audit(tx, actor, { action: input.kind === 'refund' ? 'refund' : 'reverse', entity: 'payment', entityId: p.id, after: { receiptNo: input.receiptNo, amount: p.amount, kind: input.kind, reason: input.reason } })
  return { receiptNo: input.receiptNo, amount: p.amount, balance }
}

export type Reversal = { kind: 'wrong_entry' | 'refund'; reason: string; refundMode: string | null; refundRef: string | null; by: string | null; at: string }
const reversalSql = (paymentCol: SQL) => sql`(select json_build_object('kind', v.kind, 'reason', v.reason, 'refundMode', v.refund_mode, 'refundRef', v.refund_ref, 'by', vu.name, 'at', v.reversed_at)
  from payment_reversals v left join users vu on vu.id = v.reversed_by where v.payment_id = ${paymentCol})`

/**
 * A payment taken at the desk, with its proof: an online payment or a cheque needs its reference number and a
 * picture of it; cash may have one. Everything is saved together.
 */
export async function recordPaymentWithProof(tx: Tx, actor: Actor, raw: RecordPaymentInput, proofs: { fileName: string; bytes: Buffer }[], slips: { fileName: string; bytes: Buffer }[] = []) {
  assertCan(actor, 'create', 'fee')
  const [mode] = await tx.select().from(lookups).where(and(eq(lookups.id, z.string().uuid('Choose the mode of payment').parse(raw.modeId)), eq(lookups.kind, 'payment_mode')))
  if (!mode) throw new Error('Choose the mode of payment')
  if (!Number.isInteger(raw.amount) || raw.amount <= 0) throw new Error('Enter the amount received')
  if (slips.length && !raw.paperSlip) throw new Error('A paper slip was uploaded, but the receipt given is not marked as an offline slip')
  const problem = paymentProblem(mode.value, raw.txnRef, proofs.length, !!raw.paperSlip, slips.length)
  if (problem) throw new Error(problem)
  // Less than the installment that is due now: the reason has to be written down.
  const due = await tx.execute<{ amount: number }>(sql`select amount from installments where registration_id = ${z.string().uuid().parse(raw.registrationId)} and status = 'scheduled' order by due_date, created_at limit 1`)
  if (due.rows[0] && raw.amount < due.rows[0].amount && (raw.remark?.trim().length ?? 0) < 3) throw new Error(`This is less than the current installment (₹${(due.rows[0].amount / 100).toLocaleString('en-IN')}): write in the remarks why less is paid`)
  const r = await recordPayment(tx, actor, raw)
  for (const f of slips) await attachPaymentProof(tx, actor, { id: r.payment.registrationId, branchId: r.payment.branchId }, r.payment.id, f, 'payment_slip')
  for (const f of proofs) await attachPaymentProof(tx, actor, { id: r.payment.registrationId, branchId: r.payment.branchId }, r.payment.id, f)
  return r
}

export async function applyDiscount(tx: Tx, actor: Actor, raw: DiscountInput) {
  // No fixed limit: whoever takes payments (counselors) or changes fees gives the discount the student needs, with a
  // reason; it is in the fee history and the activity log, and accounts can raise a remark on it.
  if (!can(actor, 'create', 'fee') && !can(actor, 'update', 'fee') && !can(actor, 'approve', 'fee')) throw new Error('Forbidden: discount fee')
  const input = discountInput.parse(raw)
  const [reg] = await tx.select().from(registrations).where(eq(registrations.id, input.registrationId)).for('update')
  if (!reg) throw new Error('Registration not found')
  assertOpenFees(reg)
  const { balance } = await getBalance(tx, reg.id)
  if (input.amount > balance) throw new Error('Discount is more than the outstanding balance')
  await assertFranchiseFee(tx, reg.branchId, reg.courseId, reg.totalFee - input.amount)
  const pct = reg.totalFee > 0 ? (input.amount / reg.totalFee) * 100 : 0
  const limit = await overHeadOfficeLimit(tx, actor, reg.totalFee, input.amount)
  if (limit) throw new Error(`A discount of more than ${limit}% of the fee is approved by head office: send it to them`)

  await tx.insert(feeLedger).values({ branchId: reg.branchId, registrationId: reg.id, entryType: 'discount', amount: -input.amount, note: input.reason, createdBy: actor.userId })
  // the total fee is after discounts: it comes down too (with its course fee / GST split), the full fee stays as the list fee
  const newTotal = reg.totalFee - input.amount
  const gst = reg.courseFee != null && reg.gstAmount != null && reg.totalFee > 0 ? Math.round(newTotal * reg.gstAmount / reg.totalFee) : null
  await tx.update(registrations).set({
    totalFee: newTotal, listFee: reg.listFee ?? reg.totalFee, updatedAt: new Date(),
    ...(gst != null ? { gstAmount: gst, courseFee: newTotal - gst } : {}),
  }).where(eq(registrations.id, reg.id))
  // the coming installments shrink with the balance (a discount of everything due leaves none overdue)
  await settleInstallments(tx, reg, balance - input.amount, 'fee_cut')
  await audit(tx, actor, { action: 'discount', entity: 'registration', entityId: reg.id, after: { amount: input.amount, pct: Math.round(pct * 10) / 10, reason: input.reason } })
  return getBalance(tx, reg.id)
}

/**
 * The institute's limit (business rule discount.head_office_pct) when this cut of `total` is above it and the person is
 * not head office, else null: such a cut waits for head office.
 */
async function overHeadOfficeLimit(tx: Tx, actor: Actor, total: number, cut: number): Promise<number | null> {
  if (actor.role === 'super_admin' || cut <= 0 || total <= 0) return null
  const limit = await ruleValue(tx, 'discount.head_office_pct')
  return limit < 100 && (cut / total) * 100 > limit ? limit : null
}

/**
 * A discount from the Fees screen: given at once, or, above the institute's limit for someone not at head office, sent to
 * head office as a request (they approve it from Fees → requests).
 */
export async function discountOrAsk(tx: Tx, actor: Actor, raw: DiscountInput): Promise<{ balance: number } | { asked: string; limit: number }> {
  const input = discountInput.parse(raw)
  const [reg] = await tx.select().from(registrations).where(eq(registrations.id, input.registrationId))
  if (!reg) throw new Error('Registration not found')
  const limit = await overHeadOfficeLimit(tx, actor, reg.totalFee, input.amount)
  if (!limit) return { balance: (await applyDiscount(tx, actor, input)).balance }
  if (!can(actor, 'create', 'fee') && !can(actor, 'update', 'fee') && !can(actor, 'approve', 'fee')) throw new Error('Forbidden: discount fee')
  assertOpenFees(reg)
  const { balance } = await getBalance(tx, reg.id)
  if (input.amount > balance) throw new Error('Discount is more than the outstanding balance')
  await assertFranchiseFee(tx, reg.branchId, reg.courseId, reg.totalFee - input.amount)
  const [open] = await tx.select({ id: feeChangeRequests.id }).from(feeChangeRequests).where(and(eq(feeChangeRequests.registrationId, reg.id), eq(feeChangeRequests.status, 'pending')))
  if (open) throw new Error('A fee change for this student is already waiting: it has to be decided first')
  const [row] = await tx.insert(feeChangeRequests).values({ branchId: reg.branchId, registrationId: reg.id, currentTotal: reg.totalFee, newTotal: reg.totalFee - input.amount, reason: `Discount: ${input.reason}`, requestedBy: actor.userId, headOffice: true }).returning()
  await audit(tx, actor, { action: 'create', entity: 'fee_change_request', entityId: row.id, after: { registrationId: reg.id, discount: input.amount, headOffice: true } })
  return { asked: row.id, limit }
}

export type FeeRow = {
  registrationId: string
  regNo: string
  name: string
  phone: string
  course: string
  status: string
  charged: number
  discounted: number
  paid: number
  balance: number
  nextDue: string | null
  nextDueAmount: number | null
  daysOverdue: number
  /** How the fee is paid; null = no plan (the next installment is asked for with each payment). */
  plan: FeePlan | null
  /** Installments still to come. */
  scheduled: number
  /** The course runs from courseStart (joining, else registration date) to courseEnd (expected finish); see planLimits. */
  courseStart: string | null
  courseEnd: string | null
  /** With the "Due in" month filter: what falls due in that month (or is overdue). */
  monthDue: number | null
}

/** "Due in" filter: 'overdue' (an installment past its date) or a month 'YYYY-MM' (from today on, for this month). */
function dueMonth(c: ReturnType<typeof cleanQuery>): SQL | null {
  const m = c.f('month')
  if (m === 'overdue') return sql`i.due_date < current_date`
  if (m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return sql`i.due_date >= greatest(${m + '-01'}::date, current_date) and i.due_date < ${m + '-01'}::date + interval '1 month'`
  return null
}

const FEES_FROM = sql`
    from registrations r
    join persons p on p.id = r.person_id
    join departments d on d.id = r.department_id
    left join courses c on c.id = r.course_id
    join v_fee_balance b on b.registration_id = r.id
    left join lateral (
      select i.due_date, i.amount from installments i
      where i.registration_id = r.id and i.status = 'scheduled' order by i.due_date limit 1
    ) nx on true`

/**
 * Filters (query.f): balance (due|cleared|overdue), status (registration), dept. Date range = next installment due date.
 * Sort: due, balance, paid, total, name, reg, enrolled. Default: newest first (with a "Due in" month: by due date).
 */
function feesWhere(query: ListQuery) {
  const c = cleanQuery(query)
  // the branch's own students only: a student shared INTO this branch for some classes is not one of its registrations
  const parts = [sql`(app_branch() is null or r.branch_id = app_branch())`]
  if (c.like) parts.push(sql`(p.first_name ilike ${c.like} or p.last_name ilike ${c.like} or trim(p.first_name || ' ' || coalesce(p.last_name, '')) ilike ${c.like} or p.phone ilike ${c.like} or r.reg_no ilike ${c.like})`)
  const bal = c.one(['due', 'cleared', 'overdue'] as const, 'balance')
  if (bal === 'due') parts.push(sql`b.balance > 0`)
  if (bal === 'cleared') parts.push(sql`b.balance <= 0`)
  if (bal === 'overdue') parts.push(sql`b.balance > 0 and nx.due_date < current_date`)
  const status = c.one(['active', 'on_hold', 'discontinued', 'completed', 'transferred'] as const, 'status')
  if (status) parts.push(sql`r.status = ${status}`)
  if (c.id('dept')) parts.push(sql`r.department_id = ${c.id('dept')}`)
  const range = inRange(sql`nx.due_date`, c.from, c.to)
  if (range) parts.push(range)
  const month = dueMonth(c)
  if (month) parts.push(sql`exists (select 1 from installments i where i.registration_id = r.id and i.status = 'scheduled' and ${month})`)
  return { c, where: sql.join(parts, sql` and `) }
}

const FEE_SORTS: Record<string, string> = {
  due: 'nx.due_date', balance: 'b.balance', paid: 'b.paid', total: '(b.charged - b.discounted)',
  name: "lower(trim(p.first_name || ' ' || coalesce(p.last_name, '')))", reg: 'r.reg_no', enrolled: 'r.enrollment_date',
}

export async function listFees(tx: Tx, actor: Actor, opts: { q?: string; limit?: number; offset?: number; query?: ListQuery } = {}): Promise<FeeRow[]> {
  assertCan(actor, 'read', 'fee')
  const { c, where } = feesWhere({ ...opts.query, q: opts.query?.q ?? opts.q })
  const month = dueMonth(c)
  const order = Object.hasOwn(FEE_SORTS, c.sort)
    ? sql.raw(`${FEE_SORTS[c.sort]} ${c.dir} nulls last, r.created_at desc`)
    : month ? sql`nx.due_date nulls last, r.created_at desc` : sql`r.created_at desc` // newest first; a "Due in" month lists by due date
  const res = await tx.execute<{
    registration_id: string; reg_no: string; name: string; phone: string; course: string; status: string
    charged: number; discounted: number; paid: number; balance: number
    next_due: string | null; next_due_amount: number | null; days_overdue: number | null; fee_plan: FeePlan | null; scheduled: number
    course_start: string | null; course_end: string | null; month_due: number | null
  }>(sql`
    select r.id as registration_id, r.reg_no, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, p.phone,
      coalesce(c.title, r.custom_course_title, d.name) as course, r.status,
      b.charged, b.discounted, b.paid, b.balance,
      nx.due_date::text as next_due, nx.amount as next_due_amount, greatest(current_date - nx.due_date, 0) as days_overdue, r.fee_plan,
      (select count(*)::int from installments i where i.registration_id = r.id and i.status = 'scheduled') as scheduled,
      coalesce(r.joining_date, r.enrollment_date)::text as course_start, r.expected_end_date::text as course_end,
      ${month ? sql`(select sum(i.amount)::bigint from installments i where i.registration_id = r.id and i.status = 'scheduled' and ${month})` : sql`null::bigint`} as month_due
    ${FEES_FROM}
    where ${where}
    order by ${order}
    limit ${opts.limit ?? 100} offset ${opts.offset ?? 0}`)
  return res.rows.map((r) => ({
    registrationId: r.registration_id, regNo: r.reg_no, name: r.name, phone: r.phone, course: r.course, status: r.status,
    charged: r.charged, discounted: r.discounted, paid: r.paid, balance: r.balance,
    nextDue: r.next_due, nextDueAmount: r.next_due_amount, daysOverdue: Number(r.days_overdue ?? 0), plan: r.fee_plan, scheduled: r.scheduled,
    courseStart: r.course_start, courseEnd: r.course_end, monthDue: r.month_due == null ? null : Number(r.month_due),
  }))
}

export type MonthDue = { key: string; amount: number; students: number }

/** Installments still to collect: overdue, then this month (from today) and the next five months. Active and on-hold students. */
export async function duesByMonth(tx: Tx, actor: Actor): Promise<MonthDue[]> {
  assertCan(actor, 'read', 'fee')
  const rows = (await tx.execute<{ k: string; amount: number; students: number }>(sql`
    select case when i.due_date < current_date then 'overdue' else to_char(i.due_date, 'YYYY-MM') end as k,
      sum(i.amount)::bigint as amount, count(distinct i.registration_id)::int as students
    from installments i join registrations r on r.id = i.registration_id
    where i.status = 'scheduled' and r.status in ('active', 'on_hold') and i.due_date < date_trunc('month', current_date) + interval '6 months'
    group by 1`)).rows
  const [m0] = (await tx.execute<{ m: string }>(sql`select to_char(current_date, 'YYYY-MM') as m`)).rows
  const [y, mo] = m0.m.split('-').map(Number)
  const keys = ['overdue', ...Array.from({ length: 6 }, (_, k) => { const d = new Date(Date.UTC(y, mo - 1 + k, 1)); return d.toISOString().slice(0, 7) })]
  return keys.map((key) => { const r = rows.find((x) => x.k === key); return { key, amount: Number(r?.amount ?? 0), students: Number(r?.students ?? 0) } })
}

export async function listReceipts(tx: Tx, actor: Actor, registrationId: string) {
  assertCan(actor, 'read', 'receipt')
  return tx
    .select({ receiptNo: receipts.receiptNo, amount: payments.amount, paidAt: payments.paidAt, mode: lookups.value, txnRef: payments.txnRef, slipId: payments.manualSlipNo,
      cancelled: sql<boolean>`exists (select 1 from payment_reversals v where v.payment_id = ${payments.id})` })
    .from(receipts)
    .innerJoin(payments, eq(payments.id, receipts.paymentId))
    .innerJoin(lookups, eq(lookups.id, payments.modeId))
    .where(eq(payments.registrationId, registrationId))
    .orderBy(payments.paidAt)
}

/** One uploaded picture (or PDF) of a paper slip. Whoever may see the receipt may see it. */
export async function paperSlipFile(tx: Tx, actor: Actor, receiptNo: string, docId: string) {
  const r = await getReceipt(tx, actor, receiptNo) // the access check
  if (!r.slips.some((s) => s.id === docId)) return null
  const [d] = await tx.select().from(registrationDocuments).where(eq(registrationDocuments.id, docId))
  return d ?? null
}

export type ReceiptView = {
  receiptNo: string; token: string; paidAt: string; amount: number; mode: string; txnRef: string | null
  /** A paper slip was given at the desk: it is shown as uploaded (`slips`), under this number as its slip ID. */
  paperSlip: boolean
  slips: { id: string; mime: string; fileName: string }[]
  studentName: string; phone: string; regNo: string; course: string
  branchName: string; branchAddress: string | null; branchPhone: string | null; gstin: string | null
  /** A franchise centre: the partner's legal name, printed as the receiving business (migration 0115). */
  franchisePartner: string | null
  charged: number; discounted: number; paidToDate: number; balanceAfter: number; receivedBy: string | null
  /** The payment was reversed (wrong entry / refund): the receipt is CANCELLED. */
  reversal: Reversal | null
}

/** Everything printed on a receipt. Balances are as at the moment of THIS payment (ledger rows up to and including it). */
export async function getReceipt(tx: Tx, actor: Actor, receiptNo: string): Promise<ReceiptView> {
  assertCan(actor, 'read', 'receipt')
  const res = await tx.execute<{
    receipt_no: string; payment_id: string; amount: number; paid_at: string; mode: string; txn_ref: string | null; manual_slip_no: string | null
    name: string; phone: string; reg_no: string; course: string
    bname: string; baddr: string | null; bphone: string | null; gstin: string | null; received_by: string | null; partner: string | null
    charged: number; discounted: number; paid_to_date: number; balance_after: number; reversal: Reversal | null
  }>(sql`
    select rc.receipt_no, pay.id as payment_id, pay.amount, pay.paid_at::text, m.value as mode, pay.txn_ref, pay.manual_slip_no,
      trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, p.phone, r.reg_no, coalesce(c.title, r.custom_course_title, d.name) as course,
      b.name as bname, b.address as baddr, b.phone as bphone, b.gstin, u.name as received_by, case when b.kind = 'franchise' then b.partner_name end as partner,
      coalesce(sum(l.amount) filter (where l.entry_type = 'charge'), 0)::int as charged,
      coalesce(-sum(l.amount) filter (where l.entry_type = 'discount'), 0)::int as discounted,
      coalesce(-sum(l.amount) filter (where l.entry_type in ('payment', 'adjustment', 'refund')), 0)::int as paid_to_date, -- as v_fee_balance: a refund lowers it
      coalesce(sum(l.amount), 0)::int as balance_after, ${reversalSql(sql`pay.id`)} as reversal
    from receipts rc
    join payments pay on pay.id = rc.payment_id
    join lookups m on m.id = pay.mode_id
    join registrations r on r.id = pay.registration_id
    join persons p on p.id = r.person_id
    join departments d on d.id = r.department_id
    left join courses c on c.id = r.course_id
    join branches b on b.id = rc.branch_id
    left join users u on u.id = pay.received_by
    join fee_ledger pl on pl.ref_id = pay.id and pl.entry_type = 'payment'
    join fee_ledger l on l.registration_id = r.id and l.seq <= pl.seq
    where rc.receipt_no = ${receiptNo}
    group by rc.receipt_no, pay.id, pay.amount, pay.paid_at, m.value, pay.txn_ref, pay.manual_slip_no, p.first_name, p.last_name, p.phone, r.reg_no, c.title, r.custom_course_title, d.name, b.name, b.address, b.phone, b.gstin, b.kind, b.partner_name, u.name`);
  const r = res.rows[0];
  if (!r) throw new Error('Receipt not found');
  const slips = r.manual_slip_no ? await tx.select({ id: registrationDocuments.id, mime: registrationDocuments.mime, fileName: registrationDocuments.fileName }).from(registrationDocuments).where(and(eq(registrationDocuments.paymentId, r.payment_id), eq(registrationDocuments.kind, 'payment_slip'))).orderBy(registrationDocuments.uploadedAt) : []
  return {
    receiptNo: r.receipt_no, token: receiptToken(r.receipt_no, r.payment_id, r.amount), paidAt: r.paid_at, amount: r.amount, mode: r.mode, txnRef: r.txn_ref, paperSlip: !!r.manual_slip_no, slips,
    studentName: r.name, phone: r.phone, regNo: r.reg_no, course: r.course,
    branchName: r.bname, branchAddress: r.baddr, branchPhone: r.bphone, gstin: r.gstin, franchisePartner: r.partner,
    charged: r.charged, discounted: r.discounted, paidToDate: r.paid_to_date, balanceAfter: r.balance_after, receivedBy: r.received_by,
    reversal: r.reversal ? { ...r.reversal, at: new Date(r.reversal.at).toISOString() } : null,
  };
}

export type ReceiptCheck = { valid: false } | { valid: true; receiptNo: string; amount: number; paidAt: string; mode: string; branch: string; cancelled: boolean };

/** Public: confirms a QR token is genuine. Reveals amount/date/branch only - no student identity. */
export const verifyReceipt = (orgId: string, token: string): Promise<ReceiptCheck> => withOrgSystem(orgId, (tx) => verifyReceiptIn(tx, token));

export async function verifyReceiptIn(tx: Tx, token: string): Promise<ReceiptCheck> {
  const t = parseReceiptToken(token);
  if (!t) return { valid: false } as const;
  const res = await tx.execute<{ payment_id: string; amount: number; paid_at: string; mode: string; branch: string; cancelled: boolean }>(sql`
    select pay.id as payment_id, pay.amount, pay.paid_at::text, m.value as mode, b.name as branch,
      exists (select 1 from payment_reversals v where v.payment_id = pay.id) as cancelled
    from receipts rc join payments pay on pay.id = rc.payment_id join lookups m on m.id = pay.mode_id join branches b on b.id = rc.branch_id
    where rc.receipt_no = ${t.receiptNo}`);
  const r = res.rows[0];
  if (!r || !receiptTokenValid(t.receiptNo, r.payment_id, r.amount, t.mac)) return { valid: false } as const;
  return { valid: true, receiptNo: t.receiptNo, amount: r.amount, paidAt: r.paid_at, mode: r.mode, branch: r.branch, cancelled: r.cancelled } as const;
}

export async function listFeesPage(tx: Tx, actor: Actor, opts: { q?: string; limit?: number; offset?: number; query?: ListQuery } = {}): Promise<{ rows: FeeRow[]; total: number }> {
  const rows = await listFees(tx, actor, opts)
  const { where } = feesWhere({ ...opts.query, q: opts.query?.q ?? opts.q })
  const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n ${FEES_FROM} where ${where}`)).rows
  return { rows, total: n }
}

export type StudentFees = {
  row: FeeRow
  branch: string; department: string | null; enrollmentDate: string; listFee: number | null; gstAmount: number | null; totalFee: number
  installments: InstallmentRow[]
  receipts: { receiptNo: string; amount: number; paidAt: string; mode: string; txnRef: string | null; paperSlip: boolean; receivedBy: string | null; proofs: { id: string; fileName: string; mime: string; slip: boolean }[]; reversal: Reversal | null }[]
  ledger: { at: string; type: string; amount: number; note: string | null; by: string | null }[]
  requests: { id: string; status: string; currentTotal: number; newTotal: number; plan: FeePlanInput | null; reason: string; requestedBy: string | null; requestedAt: string; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null }[]
  /** accounts' remarks on these fees, open ones first */
  remarks: FeeRemarkRow[]
  /** payments made in the old system (brought over on import): their old receipt, date, mode and book no. */
  oldPayments: { paidOn: string; amount: number; mode: string | null; receiptNo: string | null; bookNo: string | null; note: string | null }[]
  /** the student's old registration number, if brought over from the old system */
  legacyRegNo: string | null
}

/** Everything about one student's fees, for their fees page. Open to accounts and to admissions (who can only send requests). */
export async function studentFees(tx: Tx, actor: Actor, rawId: string): Promise<StudentFees | null> {
  if (!can(actor, 'read', 'fee') && !can(actor, 'read', 'registration')) throw new Error('Forbidden: read fee')
  const id = z.string().uuid().safeParse(rawId)
  if (!id.success) return null
  const res = await tx.execute<Record<string, never>>(sql`
    select r.id as registration_id, r.reg_no, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, p.phone,
      coalesce(c.title, r.custom_course_title, d.name) as course, r.status, b.charged, b.discounted, b.paid, b.balance,
      nx.due_date::text as next_due, nx.amount as next_due_amount, greatest(current_date - nx.due_date, 0) as days_overdue, r.fee_plan,
      (select count(*)::int from installments i where i.registration_id = r.id and i.status = 'scheduled') as scheduled,
      br.name as branch, d.name as department, r.enrollment_date::text as enrollment_date, r.list_fee, r.gst_amount, r.total_fee,
      coalesce(r.joining_date, r.enrollment_date)::text as course_start, r.expected_end_date::text as course_end
    ${FEES_FROM} join branches br on br.id = r.branch_id
    where r.id = ${id.data}`)
  const r = res.rows[0]
  if (!r) return null
  const inst = await tx.select().from(installments).where(and(eq(installments.registrationId, id.data), sql`${installments.status} <> 'cancelled'`)).orderBy(installments.dueDate, installments.createdAt)
  const rec = can(actor, 'read', 'receipt') ? (await tx.execute<Record<string, never>>(sql`
    select rc.receipt_no, pay.amount, pay.paid_at, m.value as mode, pay.txn_ref, pay.manual_slip_no, u.name as received_by,
      coalesce((select json_agg(json_build_object('id', dc.id, 'fileName', dc.file_name, 'mime', dc.mime, 'slip', dc.kind = 'payment_slip') order by dc.kind desc, dc.uploaded_at) from registration_documents dc where dc.payment_id = pay.id), '[]'::json) as proofs,
      ${reversalSql(sql`pay.id`)} as reversal
    from receipts rc join payments pay on pay.id = rc.payment_id join lookups m on m.id = pay.mode_id left join users u on u.id = pay.received_by
    where pay.registration_id = ${id.data} order by pay.paid_at desc, rc.receipt_no desc`)).rows : []
  const led = await tx.execute<Record<string, never>>(sql`
    select l.created_at, l.entry_type::text as type, l.amount, l.note, u.name as by from fee_ledger l left join users u on u.id = l.created_by where l.registration_id = ${id.data} order by l.seq`)
  const req = await tx.execute<Record<string, never>>(sql`
    select q.id, q.status, q.current_total, q.new_total, q.requested_plan, q.reason, q.requested_at, q.decided_at, q.decision_note, u.name as requested_by, du.name as decided_by
    from fee_change_requests q left join users u on u.id = q.requested_by left join users du on du.id = q.decided_by where q.registration_id = ${id.data} order by q.requested_at desc`)
  const remarks = (await tx.execute<Record<string, never>>(remarksSql(sql`q.registration_id = ${id.data}`))).rows.map(remarkRow)
  const oldPay = (await tx.execute<{ paid_on: string; amount: number; mode: string | null; receipt_no: string | null; book_no: string | null; note: string | null }>(sql`
    select paid_on::text, amount, mode, receipt_no, book_no, note from legacy_payments where registration_id = ${id.data} order by paid_on, imported_at`)).rows
  const [legacy] = (await tx.execute<{ legacy_reg_no: string | null }>(sql`select legacy_reg_no from registrations where id = ${id.data}`)).rows
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)
  return {
    row: {
      registrationId: r.registration_id, regNo: r.reg_no, name: r.name, phone: r.phone, course: r.course, status: r.status,
      charged: r.charged, discounted: r.discounted, paid: r.paid, balance: r.balance,
      nextDue: r.next_due, nextDueAmount: r.next_due_amount, daysOverdue: Number(r.days_overdue ?? 0), plan: r.fee_plan, scheduled: r.scheduled,
      courseStart: r.course_start, courseEnd: r.course_end, monthDue: null,
    },
    branch: r.branch, department: r.department, enrollmentDate: r.enrollment_date, listFee: r.list_fee, gstAmount: r.gst_amount, totalFee: r.total_fee,
    installments: inst.map((i) => ({ id: i.id, dueDate: String(i.dueDate), amount: i.amount, status: i.status })),
    receipts: rec.map((x) => ({ receiptNo: x.receipt_no, amount: x.amount, paidAt: new Date(x.paid_at).toISOString(), mode: x.mode, txnRef: x.txn_ref, paperSlip: !!x.manual_slip_no, receivedBy: x.received_by, proofs: x.proofs, reversal: x.reversal ? { ...(x.reversal as Reversal), at: new Date((x.reversal as Reversal).at).toISOString() } : null })),
    ledger: led.rows.map((l) => ({ at: iso(l.created_at)!, type: l.type, amount: l.amount, note: l.note, by: l.by })),
    requests: req.rows.map((q) => ({ id: q.id, status: q.status, currentTotal: q.current_total, newTotal: q.new_total, plan: q.requested_plan, reason: q.reason, requestedBy: q.requested_by, requestedAt: iso(q.requested_at)!, decidedBy: q.decided_by, decidedAt: iso(q.decided_at), decisionNote: q.decision_note })),
    remarks,
    oldPayments: oldPay.map((x) => ({ paidOn: x.paid_on, amount: Number(x.amount), mode: x.mode, receiptNo: x.receipt_no, bookNo: x.book_no, note: x.note })),
    legacyRegNo: legacy?.legacy_reg_no ?? null,
  }
}
