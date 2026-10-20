export const dynamic = 'force-dynamic'
import { notFound } from 'next/navigation'
import { getActor } from '@/lib/auth/current'
import { IdCard } from '@/components/id-card'
import { appOrigin, qrSvg } from '@/lib/app-url'
import { withOrgSystem, withTenant, type Actor } from '@/lib/db/withTenant'
import { CARD } from '@/lib/id-card'
import { requirePage } from '@/lib/panel/base'
import { addMonths } from '@/modules/fees/plan'
import { ownsRegistration } from '@/modules/portal/study'
import { registrationDetails } from '@/modules/registrations/service'

// The student membership (ID) card of one registration, made from what was entered at registration: front and back,
// ready to print on a card printer. Opened from the registrations table and right after a registration is saved,
// and by the student from their portal (their own card only).
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { actor: me } = await getActor()
  const student = me.role === 'student'
  let r
  if (student) {
    // their own registration only (the student rule returns only theirs); then read it as the office would
    if (!(await withTenant(me, (tx) => ownsRegistration(tx, id)))) notFound()
    const office: Actor = { userId: me.userId, orgId: me.orgId, role: 'super_admin', branchId: null }
    r = await withOrgSystem(me.orgId, (tx) => registrationDetails(tx, office, id))
  } else {
    const { actor } = await requirePage('Registration')
    r = await withTenant(actor, (tx) => registrationDetails(tx, actor, id))
  }
  if (!r) notFound()
  const origin = await appOrigin(me.orgId)
  const [verifyQr, followQr] = await Promise.all([qrSvg(`${origin}${CARD.verifyPath}`, '#16246e'), qrSvg(CARD.followUrl, '#16246e')])
  return (
    <IdCard
      backHref={student ? '/?tab=documents' : '/registrations'} verifyQr={verifyQr} followQr={followQr}
      v={{
        name: r.name, course: r.course ?? r.department ?? '—', regNo: r.regNo, enrolledOn: r.enrollmentDate,
        // valid for the course; a year when the finish date is not known
        validUntil: r.expectedEndDate ?? addMonths(r.enrollmentDate, 12),
        campus: r.branchCity || r.branch, photoUrl: r.photoId ? `/documents/${r.photoId}` : null,
      }}
    />
  )
}
