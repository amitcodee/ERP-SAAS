export const dynamic = 'force-dynamic'
import { notFound } from 'next/navigation'
import { EventDetail } from '@/components/event-detail'
import { appOrigin, qrSvg } from '@/lib/app-url'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { getEvent } from '@/modules/events/service'

// One event: its sign-up link and QR code, open / close, and the participants with their scores and certificates.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const b = await requirePage('Seminars & Workshops')
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const d = await withTenant(b.actor, (tx) => getEvent(tx, b.actor, id))
  if (!d) notFound()
  const link = `${await appOrigin(b.actor.orgId)}/e/${d.event.token}`
  return <EventDetail event={d.event} participants={d.participants} link={link} qr={await qrSvg(link, '#0f1437')} canUpdate={b.ok('update', 'event')} />
}
