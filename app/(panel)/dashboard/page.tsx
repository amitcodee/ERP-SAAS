export const dynamic = 'force-dynamic'
import { Screen } from '@/components/screen'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { myHome } from '@/modules/home/service'
import { systemAlerts } from '@/modules/ops/status'
import { dashboard, dashRange } from '@/modules/reports/service'

// ?from=YYYY-MM-DD&to=YYYY-MM-DD: the period of the numbers (none: this month so far)
export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const b = await requirePage('Dashboard')
  const sp = await searchParams
  const range = dashRange(sp.from, sp.to)
  const { actor, ok } = b
  const d = await withTenant(actor, async (tx) => ({
    home: await myHome(tx, actor),
    dash: ok('read', 'report') ? await dashboard(tx, actor, actor.branchId, range) : null,
    alerts: await systemAlerts(tx, actor),
  }))
  return <Screen name="dashboard"
    home={{ sections: d.home, roleLabel: b.user.roleLabel }}
    dashboard={{ data: d.dash, firstName: b.user.name.split(' ')[0], scopeLabel: actor.branchId || !b.isSuper ? b.user.branchName : 'All branches', canAddEnquiry: ok('create', 'enquiry'), alerts: d.alerts }} />
}
