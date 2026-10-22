import 'server-only'
// Course certificates drawn with the institute's own design (Certificate Designs; Settings → Certificates picks it),
// else the built-in layout (lib/cert-course.ts). The design's {{fields}} are filled from the certificate, its SIGN_*
// images are the signatures set in Settings → Certificates, BRAND_LOGO the institute's logo.
import { sql } from 'drizzle-orm'
import { fmtCertDate } from '@/lib/cert-art'
import { courseCertOps, type CertOp, type CourseCertInput } from '@/lib/cert-course'
import { SIGN_AUTHORISED, SIGN_HEAD, type Design } from '@/lib/cert-design'
import { designOps } from '@/lib/cert-design-ops'
import { getConfig } from '@/lib/config/store'
import { withOrgSystem } from '@/lib/db/withTenant'

const day = fmtCertDate

/** What a design prints for this certificate. */
export function courseDesignValues(v: CourseCertInput): Record<string, string> {
  return {
    name: v.name, father: v.father ?? '', course: v.course, duration: v.duration ?? '', reg_no: v.regNo, branch: v.branch,
    joined: day(v.joined), ended: day(v.ended), date: day(v.ended ?? v.issuedAt), issued: day(v.issuedAt), cert_no: v.certNo,
    tools: v.tools.join(', '), authorised_title: v.signers.authorised.title, head_title: v.signers.head.title,
  }
}

/** The design course certificates use now, or null (none chosen, or it was archived). */
export async function courseDesign(orgId: string): Promise<{ id: string; design: Design } | null> {
  const { designId } = (await getConfig(orgId, 'course_certificate')).config
  if (!designId) return null
  const [d] = await withOrgSystem(orgId, async (tx) => (await tx.execute<{ id: string; design: Design }>(sql`
    select id, design from certificate_designs where id = ${designId} and is_active`)).rows)
  return d ?? null
}

/** The course certificate's drawing: the chosen design, or the built-in layout. */
export async function courseCertificateOps(orgId: string, v: CourseCertInput): Promise<{ ops: CertOp[]; portrait: boolean }> {
  const d = await courseDesign(orgId)
  if (!d) return { ops: courseCertOps(v), portrait: false }
  return { ops: designOps(d.design, courseDesignValues(v), v.verifyUrl, v.brand, { [SIGN_AUTHORISED]: v.signers.authorised.image, [SIGN_HEAD]: v.signers.head.image }), portrait: d.design.page === 'portrait' }
}
