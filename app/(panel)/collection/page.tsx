export const dynamic = 'force-dynamic'
import { CollectionPanel } from '@/components/collection-panel'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { cachedCatalogs } from '@/modules/catalog/service'
import { collectionReport } from '@/modules/fees/collection'

const ISO = /^\d{4}-\d{2}-\d{2}$/
/** Today's date in India. */
const today = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)

// Fee collection: what was received in a period (today by default), by day or month, by mode, course and branch,
// with every payment listed. The period and filters live in the address, so a view can be bookmarked or shared.
export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; branch?: string; mode?: string }> }) {
  const { actor, isSuper, branches } = await requirePage('Collection')
  const sp = await searchParams
  const t = today()
  const from = sp.from && ISO.test(sp.from) ? sp.from : t
  const to = sp.to && ISO.test(sp.to) && sp.to >= from ? sp.to : from > t ? from : sp.to && ISO.test(sp.to) ? from : t
  // Head office sees every branch and may narrow to one; branch staff always see their own.
  const branchId = isSuper ? sp.branch || null : null
  const d = await withTenant(actor, async (tx) => ({ report: await collectionReport(tx, actor, { from, to, branchId, modeId: sp.mode || null }), catalogs: await cachedCatalogs(tx, actor.orgId) }))
  return (
    <CollectionPanel
      report={d.report} today={t} branchId={branchId ?? ''} modeId={sp.mode ?? ''} paymentModes={d.catalogs.paymentModes}
      branches={isSuper ? branches.map((b) => ({ id: b.id, name: b.name })) : []}
    />
  )
}
