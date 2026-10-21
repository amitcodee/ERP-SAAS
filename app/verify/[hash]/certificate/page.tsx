import { notFound } from 'next/navigation'
import { CertificateSheet } from '@/components/certificate-sheet'
import { appOrigin } from '@/lib/app-url'
import { orgBrand } from '@/lib/brand'
import { courseCertInput, projectCertInput } from '@/lib/cert-course-input'
import { courseCertOps } from '@/lib/cert-course'
import { projectCertOps } from '@/lib/cert-project'
import { verifyCertificate } from '@/modules/certificates/service'
import { requireRequestOrg } from '@/lib/tenant/request'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Certificate' }

// The course completion certificate; with ?kind=project the project certificate (only when the registration includes one).
export default async function CertificatePage({ params, searchParams }: { params: Promise<{ hash: string }>; searchParams: Promise<{ kind?: string }> }) {
  const { hash } = await params
  const org = await requireRequestOrg()
  const v = await verifyCertificate(org.id, hash.toLowerCase())
  if (!v.found) notFound()
  const kind = (await searchParams).kind === 'project' && v.projectCertificate ? 'project' : 'course'
  const verifyUrl = `${await appOrigin(org.id)}/verify/${hash}`
  const brand = await orgBrand(org.id)
  const ops = kind === 'course' ? courseCertOps(courseCertInput(v, verifyUrl, brand)) : projectCertOps(projectCertInput(v, brand))
  return <CertificateSheet v={v} hash={hash} kind={kind} ops={ops} verifyUrl={verifyUrl} />
}
