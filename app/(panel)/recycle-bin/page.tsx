export const dynamic = 'force-dynamic'
import { RecycleBin } from '@/components/recycle-bin'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { KEEP_DAYS, KINDS, listRecycle } from '@/modules/ops/recycle'

// Administration / Recycle Bin: everything deleted in the last 30 days (head office: every branch), to restore or delete for good.
export default async function Page() {
  const { actor, ok, isSuper } = await requirePage('Recycle Bin')
  const rows = await withTenant(actor, (tx) => listRecycle(tx, actor))
  return <RecycleBin rows={rows} days={KEEP_DAYS} kinds={Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.label]))}
    canRestore={ok('update', 'recycle')} canPurge={ok('delete', 'recycle')} everyBranch={isSuper} />
}
