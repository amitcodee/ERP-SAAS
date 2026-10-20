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
import { SupportBanner } from '@/components/support-banner'
import { openSupport } from '@/modules/platform/service'
import { onboardingState } from '@/modules/onboarding/service'
import { liveAnnouncementsIn } from '@/modules/platform/console'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

// The frame around every panel page. Each page under (panel)/ is its own URL and loads only its own data.
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const b = await loadPanelBase()
  if (b.mustChange) return <ForcedChangeScreen name={b.session.name} />
  if (b.session.role === 'student') redirect('/') // students have their own portal
  const a = b.actor, today = todayIST()
  const [askEmail, birthdays, support, setup, notices] = await Promise.all([
    // a branch with no mail server of its own works only once it is set up: its staff are told on every page
    needsBranchEmail(a),
    // students whose birthday it is today, shown bottom-right to the staff who look after them (who sees whom depends
    // on the login, so the cache key carries all of it)
    b.ok('read', 'registration')
      ? cached(a.orgId, `birthdays:${today}:${a.userId}:${a.role}:${a.branchId}:${!!a.ownOnly}`, () => withTenant(a, (tx) => todaysBirthdays(tx, today)), 10 * 60_000).catch(() => [])
      : [],
    // a platform support session open in this institute: head office sees who is in and why
    b.isSuper ? openSupport(a.orgId).catch(() => null) : null,
    // a new institute's setup steps, until each is settled or head office puts the list away
    b.isSuper && b.modules.includes('Set Up') ? cached(a.orgId, 'onboarding', () => withTenant(a, onboardingState)).catch(() => null) : null,
    // the platform's notices to institutes (a maintenance window, a new feature), while they run
    cached(a.orgId, 'notices', () => withTenant(a, liveAnnouncementsIn), 5 * 60_000).catch(() => []),
  ])
  return (
    <PanelShell user={b.user} modules={b.modules} branches={b.switchBranches} isSuper={b.isSuper} actingBranchId={b.actor.branchId}>
      {notices.map((n) => (
        <div key={n.id} role="status" style={{ margin: '0 28px 12px', padding: '10px 16px', borderRadius: 12, fontSize: 13, background: n.tone === 'warning' ? '#fff7e6' : '#eef0ff', border: `1px solid ${n.tone === 'warning' ? '#f5c26b' : '#c9ccf5'}` }}>
          <strong>{n.title}</strong> {n.body}
        </div>
      ))}
      {support && <SupportBanner s={support} isSupport={!!a.impersonatorId} />}
      {setup && !setup.complete && !setup.dismissed && (
        <div role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', margin: '0 28px 12px', padding: '10px 16px', borderRadius: 12, background: '#eef0ff', border: '1px solid #c9ccf5', fontSize: 13 }}>
          <span><strong>Finish setting up your institute</strong>: {setup.settled} of {setup.steps.length} steps done.</span>
          <Link href="/setup" className="filter-button">Continue</Link>
        </div>
      )}
      {children}
      {birthdays.length > 0 && <BirthdayToast people={birthdays} today={today} showBranch={b.isSuper && !b.actor.branchId} />}
      {askEmail && <BranchEmailPrompt branchName={b.user.branchName} canSetUp={canManageBranchEmail(b.actor)} />}
    </PanelShell>
  )
}
