import 'server-only'
// What every panel page needs: who is signed in (live roles/permissions), their menu, and the branch list.
// Wrapped in React cache(): the layout and the page share ONE load per request.
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { getActor } from '@/lib/auth/current'
import { can, type Action, type Resource } from '@/lib/auth/permissions'
import { cached } from '@/lib/cache'
import { withTenant } from '@/lib/db/withTenant'
import { listBranches, setupOverview } from '@/modules/branches/service'
import { listRoles } from '@/modules/roles/service'
import { MODULES, type ModuleKey } from './modules'
import { orgPlan, planHasModule } from '@/lib/plan/limits'

const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

export const loadPanelBase = cache(async () => {
  const { session: s, actor, mustChange, myBranches } = await getActor({ allowMustChange: true })
  const isSuper = s.role === 'super_admin'
  const ok = (a: Action, r: Resource) => can(actor, a, r)
  // Kept in the shared cache (lib/cache.ts): each key holds everything that decides what the database shows for it.
  // Branches: head office sees them all, anyone else their own branch (branches_read). Role user counts follow who asks.
  const [branches, setupPct, roleRows, plan] = await Promise.all([
    cached(actor.orgId, `branches:${isSuper ? '*' : actor.branchId}`, () => withTenant(actor, listBranches)),
    isSuper ? cached(actor.orgId, 'setup-pct', () => withTenant(actor, setupOverview)) : ({} as Record<string, number>),
    cached(actor.orgId, `roles:${actor.userId}:${actor.role}:${actor.branchId}:${!!actor.ownOnly}`, () => withTenant(actor, listRoles)),
    cached(actor.orgId, 'plan', () => withTenant(actor, orgPlan)),
  ])
  const base = { branches, setupPct, roleRows }
  const acting = base.branches.find((b) => b.id === actor.branchId)
  // the name from the live branch (the session's copy is as old as the sign-in)
  const branchName = isSuper ? acting?.name ?? 'All branches' : acting?.name ?? myBranches.find((b) => b.id === actor.branchId)?.name ?? 'Branch'
  // pages of a paid module show only when the plan includes it (every module during the trial)
  const modules = MODULES.filter((m) => m.allowed(ok) && (!m.planModule || planHasModule(plan, m.planModule))).map((m) => m.key)
  return {
    session: s, actor, mustChange, isSuper, ok, modules, plan,
    roleRows: base.roleRows,
    // The branches the sidebar lets this person switch between: all for a super admin, their own for shared staff.
    switchBranches: isSuper ? base.branches.map((b) => ({ id: b.id, code: b.code, name: b.name })) : myBranches,
    needsBranch: !actor.branchId,
    branches: base.branches.map((b) => ({ id: b.id, code: b.code, name: b.name, city: b.city, address: b.address, phone: b.phone, state: b.state, pincode: b.pincode, email: b.email, certCode: b.certCode, websiteUrl: b.websiteUrl, status: b.status, setupPct: base.setupPct[b.id] ?? 0 })),
    user: {
      id: s.userId, name: s.name, email: s.email, initials: initials(s.name),
      roleLabel: actor.roles?.map((k) => base.roleRows.find((r) => r.key === k)?.name ?? k).join(' · ') ?? s.role,
      branchName, branchInitials: acting ? acting.code.slice(0, 2) : initials(branchName),
      branchSub: isSuper ? 'Head office' : 'Branch', hasBranch: !!actor.branchId,
    },
  }
})
export type PanelBase = Awaited<ReturnType<typeof loadPanelBase>>

/** For a page: the signed-in staff member, or a redirect when this page is not theirs. */
export async function requirePage(key: ModuleKey) {
  const b = await loadPanelBase()
  if (b.mustChange || b.session.role === 'student') redirect('/')
  if (!b.modules.includes(key)) redirect('/dashboard')
  return b
}
