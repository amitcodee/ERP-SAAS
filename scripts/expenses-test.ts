// Expenses and profit (modules/expenses/service.ts) against the real DB, inside ONE transaction that is rolled back:
// who may record and delete, a branch sees only its own (RLS), a deleted expense leaves the totals, and the profit is
// fees received (payments that stand) less expenses, month by month.
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, departments, lookups, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'
import { todayIST } from '../lib/ist'
import { addExpense, deleteExpense, listExpenses, profitReport } from '../modules/expenses/service'
import { recordPayment } from '../modules/fees/service'
import { createRegistration } from '../modules/registrations/service'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(tx: Tx, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  await tx.execute(sql`savepoint sp`)
  try { await fn(); check(name, false, 'expected error') }
  catch (e) { await tx.execute(sql`rollback to savepoint sp`); const msg = String(e); check(name, !match || match.test(msg), msg.slice(0, 100)) }
}

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [a] = await tx.insert(branches).values({ code: 'EXA', name: 'Expense A' }).returning()
      const [b] = await tx.insert(branches).values({ code: 'EXB', name: 'Expense B' }).returning()
      const [ua] = await tx.insert(users).values({ branchId: a.id, name: 'Mgr A', email: 'exa@test.invalid', passwordHash: 'x' }).returning()
      const [ub] = await tx.insert(users).values({ branchId: b.id, name: 'Mgr B', email: 'exb@test.invalid', passwordHash: 'x' }).returning()
      const [dept] = await tx.select().from(departments).limit(1)
      const [cash] = await tx.select().from(lookups).where(eq(lookups.value, 'Cash'))
      const mgrA: Actor = { userId: ua.id, orgId: ORG, role: 'branch_manager', branchId: a.id }
      const acctA: Actor = { ...mgrA, role: 'accountant' }
      const counselorA: Actor = { ...mgrA, role: 'counselor' }
      const mgrB: Actor = { userId: ub.id, orgId: ORG, role: 'branch_manager', branchId: b.id }
      const head: Actor = { userId: ua.id, orgId: ORG, role: 'super_admin', branchId: null }
      const today = todayIST(), month = today.slice(0, 7)

      await applyTenant(tx, mgrA)
      const reg = await createRegistration(tx, mgrA, { person: { firstName: 'Exp Student', phone: '9855500061' }, departmentId: dept.id, totalFee: 5000000, enrollmentDate: `${month}-01` })
      await recordPayment(tx, mgrA, { registrationId: reg.id, amount: 3000000, modeId: cash.id, nextInstallmentDate: `${month}-28`, nextInstallmentAmount: 2000000 })
      const rent = await addExpense(tx, mgrA, { spentOn: today, category: 'Rent', amount: 1500000, paidTo: 'Landlord', mode: 'Bank transfer' })
      await addExpense(tx, acctA, { spentOn: today, category: 'Electricity & water', amount: 250000 })
      check('the branch manager and the accountant record expenses', (await listExpenses(tx, { from: `${month}-01`, to: today })).length === 2)
      await throws(tx, 'a counselor cannot record an expense', () => addExpense(tx, counselorA, { spentOn: today, category: 'Rent', amount: 100 }), /Forbidden/)
      await throws(tx, 'an expense in the future is refused', () => addExpense(tx, mgrA, { spentOn: '2999-01-01', category: 'Rent', amount: 100 }), /future/)
      await throws(tx, 'an amount of 0 is refused', () => addExpense(tx, mgrA, { spentOn: today, category: 'Rent', amount: 0 }), /amount/i)
      await throws(tx, 'an accountant cannot delete one', () => deleteExpense(tx, acctA, rent), /Forbidden/)

      const p = await profitReport(tx, { month, count: 6 })
      const cur = p.months[p.months.length - 1]
      check('six months, the last being this one', p.months.length === 6 && cur.month === month)
      check('profit = fees received − spent (30,000 − 17,500 = 12,500)', cur.income === 3000000 && cur.expenses === 1750000 && cur.profit === 1250000, JSON.stringify(cur))
      check('this month’s spending by head, the largest first', p.byCategory[0]?.category === 'Rent' && p.byCategory[0].amount === 1500000 && p.byCategory.length === 2)

      // another branch sees none of it
      await tx.execute(sql`reset role`); await applyTenant(tx, mgrB)
      check('another branch sees none of these expenses', !(await listExpenses(tx, { from: `${month}-01`, to: today })).length)
      check('... nor its profit', (await profitReport(tx, { month })).months.at(-1)?.expenses === 0)
      await throws(tx, 'nor can it record one for that branch', () => addExpense(tx, { ...mgrB, branchId: null }, { spentOn: today, category: 'Rent', amount: 100, branchId: a.id }), /Forbidden|not found|row-level/i)

      // head office sees every branch, or one
      await tx.execute(sql`reset role`); await applyTenant(tx, head)
      check('head office sees the branch’s expenses (filtered to it)', (await listExpenses(tx, { from: `${month}-01`, to: today, branchId: a.id })).length === 2)
      await throws(tx, 'head office names the branch an expense is for', () => addExpense(tx, head, { spentOn: today, category: 'Rent', amount: 100 }), /branch/)

      // a deleted expense leaves the totals but stays on record
      await tx.execute(sql`reset role`); await applyTenant(tx, mgrA)
      await deleteExpense(tx, mgrA, rent)
      check('a deleted expense leaves the list and the totals', (await listExpenses(tx, { from: `${month}-01`, to: today })).length === 1 && (await profitReport(tx, { month })).months.at(-1)?.expenses === 250000)
      const [kept] = (await tx.execute<{ deleted_by: string | null }>(sql`select deleted_by from expenses where id = ${rent}`)).rows
      check('... and stays on record, with who deleted it', kept?.deleted_by === ua.id)
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) { console.error(e); failed++ }
  } finally {
    await pool.end()
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall checks passed (rolled back, DB untouched)')
  process.exit(failed ? 1 : 0)
}
main()
