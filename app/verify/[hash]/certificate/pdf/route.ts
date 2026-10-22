import { clientIpFrom } from '@/lib/client-ip'
import { underLimit } from '@/lib/redis'
import { appOrigin } from '@/lib/app-url'
import { orgBrand } from '@/lib/brand'
import { courseCertificateOps } from '@/modules/certificates/course-design'
import { projectCertOps } from '@/lib/cert-project'
import { courseCertInput, projectCertInput } from '@/lib/cert-course-input'
import { certificatePdf } from '@/lib/pdf'
import { verifyCertificate } from '@/modules/certificates/service'
import { requestOrg } from '@/lib/tenant/request'

export const dynamic = 'force-dynamic'

// Public, like the certificate page: whoever holds the verification link may download the PDF.
export async function GET(req: Request, { params }: { params: Promise<{ hash: string }> }) {
  // each download draws a PDF: a few a minute is plenty for a person, so a script cannot keep the server busy
  if (!(await underLimit(`cert-pdf:${clientIpFrom(req.headers) ?? 'unknown'}`, 40, 600))) return new Response('Too many downloads: try again in a few minutes', { status: 429 })
  const hash = (await params).hash.toLowerCase()
  const org = await requestOrg()
  if (!org) return new Response('Not found', { status: 404 })
  const v = await verifyCertificate(org.id, hash)
  if (!v.found) return new Response('Not found', { status: 404 })
  // ?kind=project: the project certificate, for a registration that includes one
  const kind = new URL(req.url).searchParams.get('kind') === 'project' && v.projectCertificate ? 'project' : 'course'
  const verifyUrl = `${await appOrigin(org.id)}/verify/${hash}`
  const brand = await orgBrand(org.id)
  // the course certificate in the institute's own design when it chose one (Settings → Certificates)
  const drawn = kind === 'course' ? await courseCertificateOps(org.id, courseCertInput(v, verifyUrl, brand)) : { ops: projectCertOps(projectCertInput(v, brand)), portrait: false }
  const pdf = await certificatePdf(v, hash, verifyUrl, kind, drawn.ops, brand.name, drawn.portrait)
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${v.certNo}${kind === 'project' ? '-project' : ''}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
