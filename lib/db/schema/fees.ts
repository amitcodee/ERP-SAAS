import { sql } from 'drizzle-orm'
import { bigint, check, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import type { FeePlanInput } from '@/modules/fees/service'
import { branches, lookups, users } from './core'
import { registrations } from './registrations'
import { orgId } from './tenancy'

const id = () => uuid('id').primaryKey().defaultRandom()

export const ledgerEntryEnum = pgEnum('ledger_entry_type', ['charge', 'discount', 'payment', 'refund', 'adjustment', 'transfer'])
export const installmentStatusEnum = pgEnum('installment_status', ['scheduled', 'paid', 'cancelled'])

// Money is a ledger (P4): append-only, signed paise. balance = sum(amount). charge/refund +, discount/payment -.
export const feeLedger = pgTable(
  'fee_ledger',
  {
    orgId: orgId(),
    id: id(),
    seq: bigint('seq', { mode: 'number' }).notNull().generatedAlwaysAsIdentity(), // strict order, immune to same-transaction timestamp ties
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    registrationId: uuid('registration_id').notNull().references(() => registrations.id),
    entryType: ledgerEntryEnum('entry_type').notNull(),
    amount: integer('amount').notNull(),
    refId: uuid('ref_id'), // payment id for payments
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('fee_ledger_reg_idx').on(t.registrationId, t.createdAt)],
)

export const installments = pgTable(
  'installments',
  {
    orgId: orgId(),
    id: id(),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    registrationId: uuid('registration_id').notNull().references(() => registrations.id),
    dueDate: date('due_date').notNull(),
    amount: integer('amount').notNull(),
    status: installmentStatusEnum('status').notNull().default('scheduled'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('installments_due_idx').on(t.branchId, t.status, t.dueDate), index('installments_registration_idx').on(t.registrationId, t.status, t.dueDate)],
)

export const payments = pgTable(
  'payments',
  {
    orgId: orgId(),
    id: id(),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    registrationId: uuid('registration_id').notNull().references(() => registrations.id),
    amount: integer('amount').notNull(), // paise, > 0
    modeId: uuid('mode_id').notNull().references(() => lookups.id), // lookups.kind = payment_mode
    txnRef: text('txn_ref'),
    // Set when a paper slip was given at the desk: the slip ID, made here (the same number as the receipt row). The
    // uploaded slip is then what is shown for this payment; no e-receipt is made from it.
    manualSlipNo: text('manual_slip_no'),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
    receivedBy: uuid('received_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('payments_reg_idx').on(t.registrationId, t.paidAt), index('payments_registration_idx2').on(t.registrationId), index('payments_manual_slip_idx').on(t.branchId, sql`lower(manual_slip_no)`).where(sql`manual_slip_no IS NOT NULL`)],
)

// Immutable, gapless (per branch per financial year), 1:1 with a payment.
export const receipts = pgTable(
  'receipts',
  {
    orgId: orgId(),
    id: id(),
    receiptNo: text('receipt_no').notNull(),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    paymentId: uuid('payment_id').notNull().unique().references(() => payments.id),
    pdfObjectKey: text('pdf_object_key'), // filled by the receipt-PDF job (later)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('receipts_receipt_no_unique').on(t.orgId, t.receiptNo)],
)

// A request to change a student's total fees: admissions asks, accounts approves (the change is then made) or rejects.
export const feeChangeRequests = pgTable(
  'fee_change_requests',
  {
    orgId: orgId(),
    id: id(),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    registrationId: uuid('registration_id').notNull().references(() => registrations.id),
    currentTotal: integer('current_total').notNull(), // paise, when it was asked
    newTotal: integer('new_total').notNull(), // the same as currentTotal when only the payment plan is to change
    requestedPlan: jsonb('requested_plan').$type<FeePlanInput>(), // a new payment plan, when one is asked for
    reason: text('reason').notNull(),
    status: text('status').notNull().default('pending'), // pending | approved | rejected
    requestedBy: uuid('requested_by').references(() => users.id),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
  },
  (t) => [index('fee_change_requests_branch_idx').on(t.branchId, t.status, t.requestedAt), uniqueIndex('fee_change_requests_open_uq').on(t.registrationId).where(sql`status = 'pending'`)],
)

// Accounts checks the fees admissions collects: a remark on a student's fees (or one receipt) for them to fix.
export const feeRemarks = pgTable(
  'fee_remarks',
  {
    orgId: orgId(),
    id: id(),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    registrationId: uuid('registration_id').notNull().references(() => registrations.id),
    receiptNo: text('receipt_no'), // the receipt it is about, when it is about one payment
    note: text('note').notNull(),
    status: text('status').notNull().default('open'), // open | fixed
    raisedBy: uuid('raised_by').references(() => users.id),
    raisedAt: timestamp('raised_at', { withTimezone: true }).notNull().defaultNow(),
    fixedBy: uuid('fixed_by').references(() => users.id),
    fixedAt: timestamp('fixed_at', { withTimezone: true }),
    fixNote: text('fix_note'),
  },
  (t) => [index('fee_remarks_branch_idx').on(t.branchId, t.status, t.raisedAt), index('fee_remarks_reg_idx').on(t.registrationId)],
)

// A payment taken back: entered by mistake (wrong_entry) or money given back (refund). The payment row stays; its
// receipt shows CANCELLED / REFUNDED and the ledger gets the opposite entry.
export const paymentReversals = pgTable(
  'payment_reversals',
  {
    orgId: orgId(),
    paymentId: uuid('payment_id').primaryKey().references(() => payments.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    registrationId: uuid('registration_id').notNull().references(() => registrations.id),
    kind: text('kind').notNull(), // wrong_entry | refund
    reason: text('reason').notNull(),
    refundMode: text('refund_mode'),
    refundRef: text('refund_ref'),
    reversedBy: uuid('reversed_by').references(() => users.id),
    reversedAt: timestamp('reversed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('payment_reversals_reg_idx').on(t.registrationId), check('payment_reversals_kind_ck', sql`kind IN ('wrong_entry', 'refund')`)],
)

// Payments made in the old system (history; the money reaches the balance through a ledger adjustment per payment).
export const legacyPayments = pgTable(
  'legacy_payments',
  {
    orgId: orgId(),
    id: uuid('id').primaryKey().defaultRandom(),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    registrationId: uuid('registration_id').notNull().references(() => registrations.id),
    paidOn: date('paid_on').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(), // paise
    mode: text('mode'), // as the old system wrote it
    receiptNo: text('receipt_no'), // the old receipt, e.g. TCD/17266
    bookNo: text('book_no'),
    note: text('note'),
    oldId: text('old_id'), // the old fee table's id (re-runs never add a payment twice)
    raw: jsonb('raw'),
    importedBy: uuid('imported_by').references(() => users.id),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('legacy_payments_old_uq').on(t.branchId, t.oldId).where(sql`old_id IS NOT NULL`),
    index('legacy_payments_reg_idx').on(t.registrationId, t.paidOn),
    check('legacy_payments_amount_ck', sql`amount > 0`),
  ],
)
