export const dynamic = 'force-dynamic'
import { Screen } from '@/components/screen'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { cachedCatalogs } from '@/modules/catalog/service'
import { duesByMonth, listFeeChangeRequests, listFeesPage, listOpenFeeRemarks, mayFixFees } from '@/modules/fees/service'
import { summaries } from '@/modules/reports/service'

export default async function Page() {
  const { actor, ok } = await requirePage('Fees')
  const d = await withTenant(actor, async (tx) => ({ fees: await listFeesPage(tx, actor, { limit: 25 }), catalogs: await cachedCatalogs(tx, actor.orgId), sums: await summaries(tx, actor), requests: await listFeeChangeRequests(tx, actor), remarks: await listOpenFeeRemarks(tx, actor), dues: await duesByMonth(tx, actor) }))
  return <Screen name="fees" props={{ rows: d.fees.rows, total: d.fees.total, summary: d.sums.fees, departments: d.catalogs.departments, requests: d.requests, remarks: d.remarks, canFix: mayFixFees(actor), dues: d.dues, canCollect: ok('create', 'fee'), canEdit: ok('update', 'fee'), canDiscount: ok('create', 'fee') || ok('update', 'fee') || ok('approve', 'fee') }} />
}
