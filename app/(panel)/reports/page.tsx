export const dynamic = 'force-dynamic'
import { Screen } from '@/components/screen'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { listNotifications } from '@/modules/notifications/service'
import { reports } from '@/modules/reports/service'

export default async function Page() {
  const { actor, isSuper } = await requirePage('Reports')
  const d = await withTenant(actor, async (tx) => ({ rep: await reports(tx, actor, actor.branchId), notes: await listNotifications(tx, actor) }))
  return <Screen name="reports" props={{ data: d.rep, showBranches: isSuper, log: d.notes }} />
}
