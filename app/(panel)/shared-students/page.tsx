export const dynamic = 'force-dynamic'
import { SharedStudentsPanel } from '@/components/shared-students-panel'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { transferTargets } from '@/modules/registrations/transfer'
import { hostBatches, listShares, mayAskShare, mayHostShare } from '@/modules/registrations/shares'

// Students of one branch taking some classes in another: those this branch sends (asked here) and those it hosts (accepted here).
export default async function Page() {
  const { actor, isSuper, user } = await requirePage('Shared Students')
  const d = await withTenant(actor, async (tx) => ({ rows: await listShares(tx, actor), batches: actor.branchId ? await hostBatches(tx, actor) : [] }))
  return <SharedStudentsPanel rows={d.rows} batches={d.batches} canHost={mayHostShare(actor) && !!actor.branchId} canAsk={mayAskShare(actor)}
    newBranches={mayAskShare(actor) && (actor.branchId || isSuper) && !actor.ownOnly ? await transferTargets(actor) : []} scope={isSuper ? user.branchName : ''} />
}
