import { sql } from 'drizzle-orm'
import { check, date, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { branches, users } from './core'
import { orgId } from './tenancy'

// What a branch spends (modules/expenses/service.ts): one row per expense, in paise. Against the fees received it
// makes the profit (Expenses → Profit). An expense entered by mistake is deleted softly (deleted_at): it stays on
// record and in the log.
export const expenses = pgTable(
  'expenses',
  {
    orgId: orgId(),
    id: uuid('id').primaryKey().defaultRandom(),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    spentOn: date('spent_on').notNull(),
    category: text('category').notNull(),
    amount: integer('amount').notNull(),
    paidTo: text('paid_to'),
    mode: text('mode'),
    note: text('note'),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id),
  },
  (t) => [index('expenses_branch_day_idx').on(t.branchId, t.spentOn), check('expenses_amount_ck', sql`amount > 0`)],
)

// Royalty a franchise partner pays head office (modules/franchise/service.ts), in paise, against what its centre owes
// (branches.royalty_kind / royalty_value). Recorded by head office; a wrong one is deleted softly and stays on record.
export const royaltyPayments = pgTable(
  'royalty_payments',
  {
    orgId: orgId(),
    id: uuid('id').primaryKey().defaultRandom(),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    paidOn: date('paid_on').notNull(),
    amount: integer('amount').notNull(),
    mode: text('mode'),
    ref: text('ref'),
    note: text('note'),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id),
  },
  (t) => [index('royalty_payments_branch_day_idx').on(t.branchId, t.paidOn), check('royalty_payments_amount_ck', sql`amount > 0`)],
)
