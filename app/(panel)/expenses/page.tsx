export const dynamic = 'force-dynamic'
import { ExpensesPanel } from '@/components/expenses-panel'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { todayIST } from '@/lib/ist'
import { EXPENSE_CATEGORIES, EXPENSE_MODES, listExpenses, profitReport } from '@/modules/expenses/service'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const lastDay = (month: string) => { const [y, m] = month.split('-').map(Number); return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}` }

// Expenses and profit: what was spent in a month, by head, and the profit (fees received less expenses) of the six
// months up to it. The month (and, for head office, the branch) live in the address.
export default async function Page({ searchParams }: { searchParams: Promise<{ month?: string; branch?: string }> }) {
  const { actor, isSuper, branches, ok } = await requirePage('Expenses')
  const sp = await searchParams
  const now = todayIST().slice(0, 7)
  const month = sp.month && MONTH.test(sp.month) && sp.month <= now ? sp.month : now
  // head office: the branch it is working in, else every branch (or the one picked); branch staff: their own (RLS)
  const branchId = actor.branchId ?? (isSuper ? sp.branch || null : null)
  const d = await withTenant(actor, async (tx) => ({
    report: await profitReport(tx, { month, count: 6, branchId }),
    rows: await listExpenses(tx, { from: `${month}-01`, to: lastDay(month), branchId }),
  }))
  return (
    <ExpensesPanel
      month={month} thisMonth={now} today={todayIST()} report={d.report} rows={d.rows}
      categories={[...EXPENSE_CATEGORIES]} modes={[...EXPENSE_MODES]}
      canAdd={ok('create', 'expense')} canDelete={ok('delete', 'expense')}
      branches={isSuper && !actor.branchId ? branches.map((b) => ({ id: b.id, name: b.name })) : []} branchId={branchId ?? ''}
    />
  )
}
