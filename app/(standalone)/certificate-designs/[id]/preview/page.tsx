export const dynamic = 'force-dynamic'
import { notFound } from 'next/navigation'
import { DesignCertificateSheet } from '@/components/event-certificate-sheet'
import { appOrigin } from '@/lib/app-url'
import { SAMPLE_VALUES } from '@/lib/cert-design'
import { designOps } from '@/lib/cert-design-ops'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { getDesign } from '@/modules/events/service'

export const metadata = { title: 'Certificate preview | techcadd' }

// A saved design with sample details, exactly as a participant's certificate prints (and its PDF).
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const b = await requirePage('Certificate Designs')
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const d = await withTenant(b.actor, (tx) => getDesign(tx, b.actor, id))
  if (!d) notFound()
  const ops = designOps(d.design, SAMPLE_VALUES, `${await appOrigin(b.actor.orgId)}/e/c/sample`)
  return <DesignCertificateSheet ops={ops} portrait={d.design.page === 'portrait'} label={d.name} note={<>Preview of “{d.name}” with sample details. Each participant’s certificate prints their own.</>} />
}
