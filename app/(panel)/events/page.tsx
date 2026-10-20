export const dynamic = 'force-dynamic'
import { EventsPanel } from '@/components/events-panel'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { listEvents } from '@/modules/events/service'

// Events / Seminars & Workshops: the branch's events (head office: every branch's) with sign-ups and certificates.
export default async function Page() {
  const b = await requirePage('Seminars & Workshops')
  const events = await withTenant(b.actor, (tx) => listEvents(tx, b.actor))
  return <EventsPanel events={events} canCreate={b.ok('create', 'event')} showBranch={b.isSuper && !b.actor.branchId} />
}
