export const dynamic = 'force-dynamic'
import { notFound, redirect } from 'next/navigation'
import { EventForm } from '@/components/event-form'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { getEvent, listDesigns } from '@/modules/events/service'

// Changing an event (its quiz stays as it was once people have answered).
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const b = await requirePage('Seminars & Workshops')
  const { id } = await params
  if (!b.ok('update', 'event')) redirect(`/events/${id}`)
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const d = await withTenant(b.actor, async (tx) => ({ ev: await getEvent(tx, b.actor, id), designs: await listDesigns(tx, b.actor) }))
  if (!d.ev) notFound()
  const designs = d.designs.map((x) => ({ id: x.id, name: x.name, branch: x.branch, design: x.design }))
  return <EventForm key={d.ev.event.id} event={d.ev.event} designs={designs} canDesign={b.ok('read', 'certdesign')} />
}
