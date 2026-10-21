// What a branch spends, and the profit it makes: fees received (payments that stand: v_live_payments) less expenses,
// month by month. Staff with expense:read see their branch (head office every branch, or the one picked); RLS keeps
// it so whatever the query. Amounts are in paise. A wrong entry is deleted softly: it stays on record and in the log.
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { assertCan } from '@/lib/auth/permissions'
import { expenses } from '@/lib/db/schema'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { todayIST } from '@/lib/ist'

/** The usual heads, offered in the form (any other may be typed). */
export const EXPENSE_CATEGORIES = [
  'Rent', 'Salaries', 'Electricity & water', 'Internet & phone', 'Marketing & ads', 'Stationery & printing',
  'Equipment & repairs', 'Software & subscriptions', 'Travel', 'Refreshments', 'Taxes & fees', 'Other',
] as const
export const EXPENSE_MODES = ['Cash', 'UPI', 'Bank transfer', 'Card', 'Cheque'] as const

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date')
const optText = (max: number) => z.preprocess((v) => (v == null ? null : String(v).trim() || null), z.string().max(max).nullable()).optional()
export const expenseInput = z.object({
  spentOn: isoDate,
  category: z.string().trim().min(2, 'Pick or type what it was for').max(60),
  amount: z.number().int('Amount in whole paise').positive('Enter the amount').max(100_000_000_00, 'That amount is too large'),
  paidTo: optText(120),
  mode: optText(40),
  note: optText(300),
  /** head office, for a branch (branch staff always record for their own) */
  branchId: z.string().uuid().nullable().optional(),
})
export type ExpenseInput = z.input<typeof expenseInput>

export async function addExpense(tx: Tx, actor: Actor, raw: ExpenseInput) {
  assertCan(actor, 'create', 'expense')
  const v = expenseInput.parse(raw)
  if (v.spentOn > todayIST()) throw new Error('An expense cannot be in the future')
  const branchId = actor.branchId ?? v.branchId
  if (!branchId) throw new Error('Pick the branch it was spent for')
  const [b] = (await tx.execute<{ id: string }>(sql`select id from branches where id = ${branchId}`)).rows
  if (!b) throw new Error('Branch not found')
  const [row] = await tx.insert(expenses).values({ branchId, spentOn: v.spentOn, category: v.category, amount: v.amount, paidTo: v.paidTo ?? null, mode: v.mode ?? null, note: v.note ?? null, createdBy: actor.userId }).returning({ id: expenses.id })
  await audit(tx, actor, { action: 'create', entity: 'expense', entityId: row.id, after: { amount: v.amount, category: v.category, spentOn: v.spentOn } })
  return row.id
}

/** Takes an expense out of the totals (entered by mistake); it stays on record. */
export async function deleteExpense(tx: Tx, actor: Actor, id: string) {
  assertCan(actor, 'delete', 'expense')
  const res = await tx.execute(sql`update expenses set deleted_at = now(), deleted_by = ${actor.userId} where id = ${z.string().uuid().parse(id)} and deleted_at is null`)
  if (!res.rowCount) throw new Error('Expense not found')
  await audit(tx, actor, { action: 'delete', entity: 'expense', entityId: id })
}

export type ExpenseRow = { id: string; spentOn: string; category: string; amount: number; paidTo: string | null; mode: string | null; note: string | null; branch: string; by: string }

const branchIs = (branchId: string | null | undefined, col: string) => (branchId ? sql`and ${sql.raw(col)} = ${branchId}::uuid` : sql``)

/** Expenses of a period (dates included), the newest first. */
export async function listExpenses(tx: Tx, opts: { from: string; to: string; branchId?: string | null }): Promise<ExpenseRow[]> {
  return (await tx.execute<ExpenseRow>(sql`
    select e.id, e.spent_on::text as "spentOn", e.category, e.amount, e.paid_to as "paidTo", e.mode, e.note, b.name as branch, u.name as by
    from expenses e join branches b on b.id = e.branch_id join users u on u.id = e.created_by
    where e.deleted_at is null and e.spent_on between ${opts.from}::date and ${opts.to}::date ${branchIs(opts.branchId, 'e.branch_id')}
    order by e.spent_on desc, e.created_at desc limit 1000`)).rows
}

export type MonthProfit = { month: string; income: number; expenses: number; profit: number }
export type ProfitReport = { months: MonthProfit[]; byCategory: { category: string; amount: number }[]; month: string }

/**
 * The profit of the last `count` months up to `month` (YYYY-MM): fees received less expenses, each month; and that
 * month's expenses by head.
 */
export async function profitReport(tx: Tx, opts: { month: string; count?: number; branchId?: string | null }): Promise<ProfitReport> {
  const count = Math.min(24, Math.max(1, opts.count ?? 6))
  const end = `${opts.month}-01`
  const rows = (await tx.execute<{ month: string; income: number; expenses: number }>(sql`
    with months as (select to_char(m, 'YYYY-MM') as month, m::date as first, (m + interval '1 month')::date as next
      from generate_series((${end}::date - make_interval(months => ${count - 1})), ${end}::date, interval '1 month') m)
    select months.month,
      coalesce((select sum(p.amount) from v_live_payments p where (p.paid_at at time zone 'Asia/Kolkata')::date >= months.first and (p.paid_at at time zone 'Asia/Kolkata')::date < months.next ${branchIs(opts.branchId, 'p.branch_id')}), 0)::bigint as income,
      coalesce((select sum(e.amount) from expenses e where e.deleted_at is null and e.spent_on >= months.first and e.spent_on < months.next ${branchIs(opts.branchId, 'e.branch_id')}), 0)::bigint as expenses
    from months order by months.month`)).rows
  const byCategory = (await tx.execute<{ category: string; amount: number }>(sql`
    select category, sum(amount)::bigint as amount from expenses
    where deleted_at is null and spent_on >= ${end}::date and spent_on < (${end}::date + interval '1 month') ${branchIs(opts.branchId, 'branch_id')}
    group by category order by 2 desc`)).rows
  return {
    month: opts.month,
    months: rows.map((r) => ({ month: r.month, income: Number(r.income), expenses: Number(r.expenses), profit: Number(r.income) - Number(r.expenses) })),
    byCategory: byCategory.map((c) => ({ category: c.category, amount: Number(c.amount) })),
  }
}
