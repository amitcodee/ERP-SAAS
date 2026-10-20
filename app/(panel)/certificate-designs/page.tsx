export const dynamic = 'force-dynamic'
import { DesignsPanel } from '@/components/designs-panel'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { listDesigns } from '@/modules/events/service'

// Events / Certificate Designs: the designs of this branch and head office's, as small previews; new from a template,
// a blank page or a picture; each opens on the canvas.
export default async function Page() {
  const b = await requirePage('Certificate Designs')
  const designs = await withTenant(b.actor, (tx) => listDesigns(tx, b.actor))
  return <DesignsPanel designs={designs} canEdit={b.ok('update', 'certdesign')} branchName={b.user.branchName} isHeadOffice={!b.actor.branchId} />
}
