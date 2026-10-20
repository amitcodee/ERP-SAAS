export const dynamic = 'force-dynamic'
import { notFound } from 'next/navigation'
import { CertDesigner } from '@/components/cert-designer'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { getDesign } from '@/modules/events/service'

// One design on the canvas. A design this person may not change (head office's, for a branch) opens to look at, with
// "Save a copy for my branch".
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const b = await requirePage('Certificate Designs')
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const d = await withTenant(b.actor, (tx) => getDesign(tx, b.actor, id))
  if (!d) notFound()
  return <CertDesigner key={`${d.id}${d.updatedAt}`} id={d.id} initialName={d.name} initial={d.design} readOnly={!d.editable} />
}
