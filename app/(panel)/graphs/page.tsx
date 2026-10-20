export const dynamic = 'force-dynamic'
import { GraphsPanel } from '@/components/graphs-panel'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { todayIST } from '@/modules/fees/plan'
import { graphs } from '@/modules/reports/graphs'

const ISO = /^\d{4}-\d{2}-\d{2}$/

// Graphs of the admissions work over a period (the last 30 days unless another is picked; ?from=&to= in the address).
export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { actor, isSuper, user } = await requirePage('Graphs')
  const sp = await searchParams
  const today = todayIST()
  const d30 = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10)
  const from = sp.from && ISO.test(sp.from) && sp.from <= today ? sp.from : d30
  const to = sp.to && ISO.test(sp.to) && sp.to >= from && sp.to <= today ? sp.to : today
  const data = await withTenant(actor, (tx) => graphs(tx, actor, { from, to, branchId: actor.branchId }))
  return <GraphsPanel data={data} today={today} showBranches={isSuper && !actor.branchId} scope={isSuper ? user.branchName : ''} />
}
