export const dynamic = 'force-dynamic'
import { redirect } from 'next/navigation'
import { EventForm } from '@/components/event-form'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { listDesigns } from '@/modules/events/service'

// A new seminar, workshop or other event.
export default async function Page() {
  const b = await requirePage('Seminars & Workshops')
  if (!b.ok('create', 'event')) redirect('/events')
  const designs = await withTenant(b.actor, (tx) => listDesigns(tx, b.actor))
  return <EventForm event={null} designs={designs.map((d) => ({ id: d.id, name: d.name, branch: d.branch, design: d.design }))} canDesign={b.ok('read', 'certdesign')} />
}
