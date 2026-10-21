import { clientIpFrom } from '@/lib/client-ip'
import { underLimit } from '@/lib/redis'
import { appOrigin } from '@/lib/app-url'
import { designOps } from '@/lib/cert-design-ops'
import { layoutPdf } from '@/lib/pdf'
import { orgBrand } from '@/lib/brand'
import { eventCertificate } from '@/modules/events/service'
import { requestOrg } from '@/lib/tenant/request'

export const dynamic = 'force-dynamic'

// The event certificate as a PDF: public, like its page.
export async function GET(req: Request, { params }: { params: Promise<{ hash: string }> }) {
  // each download draws a PDF: a few a minute is plenty for a person, so a script cannot keep the server busy
  if (!(await underLimit(`cert-pdf:${clientIpFrom(req.headers) ?? 'unknown'}`, 40, 600))) return new Response('Too many downloads: try again in a few minutes', { status: 429 })
  const hash = (await params).hash.toLowerCase()
  const org = await requestOrg()
  if (!org) return new Response('Not found', { status: 404 })
  const c = await eventCertificate(org.id, hash)
  if (!c) return new Response('Not found', { status: 404 })
  const brand = await orgBrand(org.id)
  const pdf = await layoutPdf(`Certificate ${c.certNo}`, designOps(c.design, c.values, `${await appOrigin(org.id)}/e/c/${hash}`, brand), c.design.page === 'portrait', brand.name)
  return new Response(new Uint8Array(pdf), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${c.certNo}.pdf"`, 'Cache-Control': 'no-store' },
  })
}
