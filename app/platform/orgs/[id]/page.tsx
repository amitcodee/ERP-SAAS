import { notFound } from 'next/navigation'
import { PlatformOrgActions } from '@/components/platform-org'
import { appOrigin } from '@/lib/app-url'
import { requirePlatform } from '@/lib/platform/current'
import { orgDetail } from '@/modules/platform/service'

// One organisation: who owns it, its status (suspend / reactivate / read-only) and its support sessions.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const pu = await requirePlatform()
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const o = await orgDetail(id)
  if (!o) notFound()
  return (
    <section className="page-container">
      <div className="page-heading"><div><p className="eyebrow">Platform / Organisations</p><h1>{o.name}</h1><p className="subheading">{await appOrigin(o.id)} · {o.plan} plan · owner {o.ownerName ?? '—'} ({o.ownerEmail ?? 'no owner'})</p></div></div>
      <PlatformOrgActions org={{ id: o.id, status: o.status }} sessions={o.sessions} me={pu.name} />
    </section>
  )
}
