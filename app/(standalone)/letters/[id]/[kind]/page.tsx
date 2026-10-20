export const dynamic = 'force-dynamic'
import { notFound } from 'next/navigation'
import { sql } from 'drizzle-orm'
import { getActor } from '@/lib/auth/current'
import { LetterSheet } from '@/components/letter-body'
import { PrintButton } from '@/components/print-button'
import { withOrgSystem, withTenant, type Actor } from '@/lib/db/withTenant'
import { longDate } from '@/lib/letters/render'
import { requirePage } from '@/lib/panel/base'
import { letterFor } from '@/modules/letters/service'
import { ownsRegistration } from '@/modules/portal/study'
import { UUID } from '@/lib/auth/acting'

// One internship letter on letterhead, ready to print or save as PDF: /letters/<intern>/internship_offer or
// /letters/<intern>/internship_completion. An issued letter shows its frozen text; otherwise a marked draft.
// A student opens their own letters from the portal, and only once issued (never a draft).
export default async function Page({ params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await params
  const { actor: me } = await getActor()
  const student = me.role === 'student'
  let l
  if (student) {
    if (!UUID.test(id)) notFound()
    const office: Actor = { userId: me.userId, orgId: me.orgId, role: 'super_admin', branchId: null }
    const [i] = (await withOrgSystem(me.orgId, (tx) => tx.execute<{ registration_id: string | null }>(sql`select registration_id from internships where id = ${id}`))).rows
    if (!i?.registration_id || !(await withTenant(me, (tx) => ownsRegistration(tx, i.registration_id!)))) notFound()
    l = await withOrgSystem(me.orgId, (tx) => letterFor(tx, office, id, kind).catch(() => null))
    if (l?.draft) notFound()
  } else {
    const { actor } = await requirePage('Internship Requests')
    if (!UUID.test(id)) notFound()
    l = await withTenant(actor, (tx) => letterFor(tx, actor, id, kind).catch(() => null))
  }
  if (!l) notFound()
  return (
    <main className="lt-page">
      <style>{`@page { size: A4 portrait; margin: 0 } @media print { html, body { background: transparent !important } .no-print { display: none !important } .lt-page { padding: 0 !important; background: #fff !important } .lt-sheet { box-shadow: none !important; margin: 0 !important } }`}</style>
      <div className="no-print lt-bar"><a href={student ? '/?tab=documents' : l.kind === 'internship_offer' ? '/internships' : '/internship-complete'} className="filter-button">← Back</a><PrintButton /></div>
      <LetterSheet text={l.text} refNo={l.refNo} date={longDate((l.issuedAt ?? new Date().toISOString()).slice(0, 10))} draft={l.draft} cancelled={l.cancelled} letterhead={l.art.letterhead} sign={l.art.stamp} />
    </main>
  )
}
