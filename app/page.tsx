import { redirect } from 'next/navigation'
import { ForcedChangeScreen } from '@/components/change-password'
import { StudentPortal } from '@/components/student-portal'
import { getActor } from '@/lib/auth/current'
import { AccountGate } from '@/components/account-gate'
import { gateFor } from '@/lib/tenant/gate'
import { requestOrg } from '@/lib/tenant/request'
import { withTenant } from '@/lib/db/withTenant'
import { myPortal, myProfile } from '@/modules/portal/service'
import { myStudy } from '@/modules/portal/study'
import { onlinePaymentsOn } from '@/modules/fees/online'
import { HELP_KINDS, listHelp, listNotes } from '@/modules/teaching/service'
import { listAnnouncements, listTickets, TICKET_CATEGORIES } from '@/modules/support/service'

export const dynamic = 'force-dynamic'

// "/" : students get their portal; staff go to their dashboard (each panel page has its own URL).
export default async function Home() {
  const { session: s, actor, mustChange } = await getActor({ allowMustChange: true })
  if (mustChange) return <ForcedChangeScreen name={s.name} />
  if (s.role !== 'student') redirect('/dashboard')
  // the institute waits for approval or is closed until paid: its students are told, nothing else is shown
  const org = await requestOrg()
  const gate = gateFor(org?.status ?? 'active', '/', false)
  if (gate) return <main style={{ minHeight: '100vh', background: 'var(--page)', padding: 16 }}><AccountGate gate={gate} isHeadOffice={false} name={org?.name ?? 'The institute'} /></main>
  // The database only returns this student's rows (student RLS), whatever this code asks for.
  const d = await withTenant(actor, async (tx) => ({
    items: await myPortal(tx, actor), study: await myStudy(tx, actor), profile: await myProfile(tx, actor),
    announcements: await listAnnouncements(tx, actor), tickets: await listTickets(tx, actor),
    notes: await listNotes(tx, actor), help: await listHelp(tx, actor),
  }))
  return <StudentPortal name={s.name} email={s.email} {...d} payOnline={await onlinePaymentsOn(actor.orgId)} categories={TICKET_CATEGORIES.map((c) => ({ key: c.key, label: c.label }))} helpKinds={HELP_KINDS.map((k) => ({ key: k.key, label: k.label }))} />
}
