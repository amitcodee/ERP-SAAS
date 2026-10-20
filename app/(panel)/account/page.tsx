export const dynamic = 'force-dynamic'
import { redirect } from 'next/navigation'
import { AccountPanel } from '@/components/account-panel'
import { loadPanelBase } from '@/lib/panel/base'
import { loadProfile } from '@/modules/auth/account'

// My account: open to everyone signed in to the panel (reached from the profile menu, not the sidebar).
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const b = await loadPanelBase()
  const profile = await loadProfile(b.session.org, b.session.userId)
  if (!profile) redirect('/api/logout')
  const { tab } = await searchParams
  return <AccountPanel profile={profile} tab={tab === 'security' ? 'security' : 'profile'} initials={b.user.initials} roleLabel={b.user.roleLabel}
    branch={b.isSuper ? 'Head office (all branches)' : b.switchBranches.map((x) => `${x.code} — ${x.name}`).join(', ') || b.user.branchName} />
}
