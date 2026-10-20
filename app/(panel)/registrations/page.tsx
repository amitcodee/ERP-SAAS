export const dynamic = 'force-dynamic'
import { Screen } from '@/components/screen'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { cachedCatalogs } from '@/modules/catalog/service'
import { listRegistrations } from '@/modules/registrations/service'
import { mayRequestTransfer, transferTargets } from '@/modules/registrations/transfer'
import { mayAskShare } from '@/modules/registrations/shares'
import { summaries } from '@/modules/reports/service'

export default async function Page() {
  const { actor, ok, needsBranch, isSuper } = await requirePage('Registration')
  const d = await withTenant(actor, async (tx) => ({ list: await listRegistrations(tx, actor, { limit: 25 }), catalogs: await cachedCatalogs(tx, actor.orgId), sums: await summaries(tx, actor) }))
  return <Screen name="registrations" props={{
    mode: 'list', rows: d.list.rows.map((r) => ({ ...r, enrollmentDate: String(r.enrollmentDate) })), total: d.list.total, summary: d.sums.registrations, catalogs: d.catalogs,
    canCreate: ok('create', 'registration'), canUpdate: ok('update', 'registration'), canReactivate: ok('approve', 'registration'), canDelete: ok('delete', 'registration'), needsBranch,
    // a branch moves / shares its own students; head office can do it for any branch, also while working in all branches
    transferBranches: mayRequestTransfer(actor) && (actor.branchId || isSuper) ? await transferTargets(actor) : [],
    shareBranches: mayAskShare(actor) && (actor.branchId || isSuper) && !actor.ownOnly ? await transferTargets(actor) : [],
  }} />
}
