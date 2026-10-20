export const dynamic = 'force-dynamic'
import { Screen } from '@/components/screen'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { cachedCatalogs } from '@/modules/catalog/service'
import { listCallsPage } from '@/modules/enquiries/service'
import { summaries } from '@/modules/reports/service'

export default async function Page() {
  const { actor, ok, needsBranch, isSuper, branches } = await requirePage('Random Call')
  const d = await withTenant(actor, async (tx) => ({ calls: await listCallsPage(tx, actor, { limit: 25 }), catalogs: await cachedCatalogs(tx, actor.orgId), sums: await summaries(tx, actor) }))
  return <Screen name="calls" props={{
    rows: d.calls.rows.map((c) => ({ ...c, calledAt: c.calledAt.toISOString(), followUpDate: c.followUpDate ?? null })), total: d.calls.total,
    summary: d.sums.calls, catalogs: d.catalogs, canCreate: ok('create', 'call'), canEdit: ok('update', 'call'), canDelete: ok('delete', 'call'), canPromote: ok('create', 'enquiry'), needsBranch,
    // Head office sees every branch's calls, so it gets the branch column and a branch filter.
    branches: isSuper ? branches.map((b) => ({ id: b.id, code: b.code, name: b.name })) : [],
  }} />
}
