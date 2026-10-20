import { redirect } from 'next/navigation'
import { ForcedChangeScreen } from '@/components/change-password'
import { StudentPortal } from '@/components/student-portal'
import { getActor } from '@/lib/auth/current'
import { withTenant } from '@/lib/db/withTenant'
import { myPortal, myProfile } from '@/modules/portal/service'
import { myStudy } from '@/modules/portal/study'
import { HELP_KINDS, listHelp, listNotes } from '@/modules/teaching/service'
import { listAnnouncements, listTickets, TICKET_CATEGORIES } from '@/modules/support/service'

export const dynamic = 'force-dynamic'

// "/" : students get their portal; staff go to their dashboard (each panel page has its own URL).
export default async function Home() {
  const { session: s, actor, mustChange } = await getActor({ allowMustChange: true })
  if (mustChange) return <ForcedChangeScreen name={s.name} />
  if (s.role !== 'student') redirect('/dashboard')
  // The database only returns this student's rows (student RLS), whatever this code asks for.
  const d = await withTenant(actor, async (tx) => ({
    items: await myPortal(tx, actor), study: await myStudy(tx, actor), profile: await myProfile(tx, actor),
    announcements: await listAnnouncements(tx, actor), tickets: await listTickets(tx, actor),
    notes: await listNotes(tx, actor), help: await listHelp(tx, actor),
  }))
  return <StudentPortal name={s.name} email={s.email} {...d} categories={TICKET_CATEGORIES.map((c) => ({ key: c.key, label: c.label }))} helpKinds={HELP_KINDS.map((k) => ({ key: k.key, label: k.label }))} />
}
