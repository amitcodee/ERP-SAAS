import 'server-only'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { loadUserState, type WorkBranch } from '@/modules/auth/account'
import { openSupport } from '@/modules/platform/service'
import { requestOrg } from '../tenant/request'
import type { Actor } from '../db/withTenant'
import { actingBranch } from './acting'
import { primaryRole, readSession, SESSION_COOKIE, type Session } from './session'
import { sessionValidity } from './validity'

export const ACTING_BRANCH_COOKIE = 'tc_branch'

export async function getSession(): Promise<Session | null> {
  return readSession((await cookies()).get(SESSION_COOKIE)?.value)
}

export async function requireSession(): Promise<Session> {
  const s = await getSession()
  if (!s) redirect('/login')
  return s
}

/**
 * The actor for tenant queries, checked against the user's CURRENT state on every call:
 *  - deactivated / deleted user, or a password changed after this session was issued -> signed out at once;
 *  - a user who must choose a new password can do nothing else until they have (unless allowMustChange).
 * Branch staff work in their CURRENT home branch (read live, not from the session). A super admin has no home branch, so they
 * "act inside" one chosen via the tc_branch cookie (RLS still lets them see everything). Staff who serve several
 * branches use the same cookie to pick which of THEIR branches they are working in; anything else falls back to home.
 */
export async function getActor(opts: { allowMustChange?: boolean } = {}): Promise<{ session: Session; actor: Actor; mustChange: boolean; myBranches: WorkBranch[] }> {
  const session = await requireSession()
  // a session is good only on its own org's host, and only while that org is open
  const org = await requestOrg()
  if (!org || org.id !== session.org || org.status === 'suspended' || org.status === 'cancelled') redirect('/api/logout')
  const state = await loadUserState(org.id, session.userId, session.sid)
  if (sessionValidity(session.pwv, state) === 'revoked' || !state?.roles.length || !state.branchActive) redirect('/api/logout')
  // a platform admin's support session: good only while it is open (ended by either side, or run out: signed out)
  const support = session.sup ? await openSupport(org.id) : null
  if (session.sup && support?.id !== session.sup) redirect('/api/logout')
  const mustChange = support ? false : state!.mustChange
  if (mustChange && !opts.allowMustChange) throw new Error('Password change required: sign in again and choose a new password')

  const roles = state!.roles
  const role = primaryRole(roles) // from the LIVE roles: granting or removing super admin applies at once
  // the branch from the LIVE state: a move by head office applies at once, not when the session runs out
  const { branchId, ownOnly } = actingBranch(state!, role, (await cookies()).get(ACTING_BRANCH_COOKIE)?.value)
  if (role !== 'super_admin' && !branchId) redirect('/api/logout') // a staff role needs a home branch
  // the session's own branch fields are as old as the sign-in: hand on the live ones
  const live = { branchId: role === 'super_admin' ? session.branchId : state!.homeBranchId, branchName: role === 'super_admin' ? session.branchName : state!.branches.find((b) => b.id === state!.homeBranchId)?.name ?? null }
  return { session: { ...session, ...live, role, roles }, mustChange, myBranches: state!.branches, actor: {
    userId: session.userId, orgId: org.id, role, roles, perms: state!.perms, branchId, personId: session.personId ?? null, ownOnly,
    readOnly: org.status === 'read_only' || support?.mode === 'read', impersonatorId: support?.platformUserId ?? null, supportSessionId: support?.id ?? null,
  } }
}
