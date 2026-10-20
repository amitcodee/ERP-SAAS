export const dynamic = 'force-dynamic'
import { TransfersPanel } from '@/components/transfers-panel'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { listTransfers, mayAcceptTransfer, mayRequestTransfer, transferTargets } from '@/modules/registrations/transfer'

// Students moving between branches: those leaving this branch (asked here) and those coming in (accepted here).
export default async function Page() {
  const { actor, isSuper, user } = await requirePage('Transfers')
  const rows = await withTenant(actor, (tx) => listTransfers(tx, actor))
  return <TransfersPanel rows={rows} canAccept={mayAcceptTransfer(actor) && (!!actor.branchId || isSuper)} canCancel={mayRequestTransfer(actor)}
    newBranches={mayRequestTransfer(actor) && (actor.branchId || isSuper) ? await transferTargets(actor) : []} scope={isSuper ? user.branchName : ''} />
}
