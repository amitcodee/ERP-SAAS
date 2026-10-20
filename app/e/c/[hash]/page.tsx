import { notFound } from 'next/navigation'
import { DesignCertificateSheet } from '@/components/event-certificate-sheet'
import { appOrigin } from '@/lib/app-url'
import { designOps } from '@/lib/cert-design-ops'
import { eventCertificate } from '@/modules/events/service'
import { requireRequestOrg } from '@/lib/tenant/request'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Certificate | techcadd', robots: { index: false } }

// A participant's event certificate, public like the course certificate: whoever has the link (or scans its QR code)
// sees it, which is also how it is checked to be genuine.
export default async function Page({ params }: { params: Promise<{ hash: string }> }) {
  const hash = (await params).hash.toLowerCase()
  const org = await requireRequestOrg()
  const c = await eventCertificate(org.id, hash)
  if (!c) notFound()
  const url = `${await appOrigin(org.id)}/e/c/${hash}`
  return <DesignCertificateSheet ops={designOps(c.design, c.values, url)} portrait={c.design.page === 'portrait'} label={`Certificate ${c.certNo}`} pdfHref={`/e/c/${hash}/pdf`}
    note={<>Genuine techcadd certificate {c.certNo}, issued to {c.name} for “{c.event}”.</>} />
}
