export const dynamic = 'force-dynamic'
import { Screen } from '@/components/screen'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { cachedCatalogs } from '@/modules/catalog/service'
import { listEnquiries } from '@/modules/enquiries/service'
import { summaries } from '@/modules/reports/service'

export default async function Page() {
  const { actor, ok, needsBranch } = await requirePage('My Leads')
  const d = await withTenant(actor, async (tx) => ({ list: await listEnquiries(tx, actor, { limit: 25, mine: true }), catalogs: await cachedCatalogs(tx, actor.orgId), sums: await summaries(tx, actor) }))
  return <Screen name="enquiries" props={{
    mode: 'mine', rows: d.list.rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), nextFollowUp: r.nextFollowUp ?? null, callAt: r.callAt?.toISOString() ?? null })), total: d.list.total, summary: d.sums.enquiries, catalogs: d.catalogs,
    canCreate: false, canUpdate: ok('update', 'enquiry'), needsBranch: false,
  }} />
}
