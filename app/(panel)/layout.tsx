import { redirect } from 'next/navigation'
import { BranchEmailPrompt } from '@/components/branch-email-prompt'
import { ForcedChangeScreen } from '@/components/change-password'
import { PanelShell } from '@/components/panel-shell'
import { cached } from '@/lib/cache'
import { canManageBranchEmail, needsBranchEmail } from '@/lib/config/store'
import { loadPanelBase } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { todayIST } from '@/lib/ist'
import { todaysBirthdays } from '@/modules/notifications/birthday'
import { BirthdayToast } from '@/components/birthday-toast'

export const dynamic = 'force-dynamic'

// The frame around every panel page. Each page under (panel)/ is its own URL and loads only its own data.
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const b = await loadPanelBase()
  if (b.mustChange) return <ForcedChangeScreen name={b.session.name} />
  if (b.session.role === 'student') redirect('/') // students have their own portal
  const a = b.actor, today = todayIST()
  const [askEmail, birthdays] = await Promise.all([
    // a branch with no mail server of its own works only once it is set up: its staff are told on every page
    needsBranchEmail(a),
    // students whose birthday it is today, shown bottom-right to the staff who look after them (who sees whom depends
    // on the login, so the cache key carries all of it)
    b.ok('read', 'registration')
      ? cached(a.orgId, `birthdays:${today}:${a.userId}:${a.role}:${a.branchId}:${!!a.ownOnly}`, () => withTenant(a, (tx) => todaysBirthdays(tx, today)), 10 * 60_000).catch(() => [])
      : [],
  ])
  return (
    <PanelShell user={b.user} modules={b.modules} branches={b.switchBranches} isSuper={b.isSuper} actingBranchId={b.actor.branchId}>
      {children}
      {birthdays.length > 0 && <BirthdayToast people={birthdays} today={today} showBranch={b.isSuper && !b.actor.branchId} />}
      {askEmail && <BranchEmailPrompt branchName={b.user.branchName} canSetUp={canManageBranchEmail(b.actor)} />}
    </PanelShell>
  )
}
