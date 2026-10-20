// Password lifecycle. Uses withOrgSystem (the person's own org) because it must work before/without a normal tenant context
// (e.g. a user who is forced to change password is otherwise locked out of every business action).
import { and, eq, sql } from 'drizzle-orm'
import { audit } from '@/lib/audit'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { ALL_PERMS } from '@/lib/auth/permissions'
import { passwordProblem, type UserState } from '@/lib/auth/validity'
import { branches, roles, userBranches, userRoles, users } from '@/lib/db/schema'
import { withOrgSystem, type Tx } from '@/lib/db/withTenant'
import { clearLimit, underLimit } from '@/lib/redis'

export type LiveUser = UserState & { mustChange: boolean; roles: string[]; perms: string[]; branchActive: boolean; branches: WorkBranch[]; homeBranchId: string | null }
/** A branch the person may work in: their home branch first, then the active branches they are shared with ('own': only their own work there). */
export type WorkBranch = { id: string; code: string; name: string; access?: 'own' | 'full' }

export async function loadUserStateIn(tx: Tx, userId: string, sid?: string): Promise<LiveUser | undefined> {
  const [u] = await tx.select().from(users).where(eq(users.id, userId))
  if (!u) return undefined
  // this sign-in was ended with "Sign out" (its cookie may still be around, copied or on a shared computer)
  const signedOut = !!sid && (await tx.execute(sql`select 1 from revoked_sessions where sid = ${sid}`)).rows.length > 0
  // Roles and permissions are read live, so a role edited by an admin applies on the very next click.
  const rs = await tx.select({ key: roles.key, kind: roles.kind, perms: roles.permissions }).from(userRoles).innerJoin(roles, eq(roles.key, userRoles.role)).where(eq(userRoles.userId, userId))
  const perms = [...new Set(rs.flatMap((r) => (r.kind === 'super' ? ALL_PERMS : r.perms)))]
  const [b] = u.branchId ? await tx.select({ id: branches.id, code: branches.code, name: branches.name, status: branches.status }).from(branches).where(eq(branches.id, u.branchId)) : []
  const shared = b ? await tx.select({ id: branches.id, code: branches.code, name: branches.name, access: userBranches.access }).from(userBranches).innerJoin(branches, eq(branches.id, userBranches.branchId)).where(and(eq(userBranches.userId, userId), eq(branches.status, 'active'), eq(branches.isActive, true))) : []
  return { isActive: u.isActive, deleted: !!u.deletedAt, signedOut, passwordChangedAt: u.passwordChangedAt, mustChange: u.mustChangePassword, roles: rs.map((r) => r.key), perms, branchActive: !u.branchId || b?.status === 'active', homeBranchId: u.branchId,
    branches: b ? [{ id: b.id, code: b.code, name: b.name, access: 'full' as const }, ...shared.map((x) => ({ ...x, access: (x.access === 'full' ? 'full' : 'own') as 'own' | 'full' }))] : [] }
}

/** Current authoritative state of a user (read on every request; one indexed lookup). */
export const loadUserState = (orgId: string, userId: string, sid?: string) => withOrgSystem(orgId, (tx) => loadUserStateIn(tx, userId, sid))

/** "Sign out": this sign-in's id goes on the revoked list until its cookie would have expired anyway. */
export const revokeSession = (orgId: string, sid: string, expiresAt: Date) => withOrgSystem(orgId, async (tx) => {
  await tx.execute(sql`insert into revoked_sessions (sid, expires_at) values (${sid}, ${expiresAt}) on conflict (sid) do nothing`)
  await tx.execute(sql`delete from revoked_sessions where expires_at < now()`)
})

export type ChangeResult = { ok: true; pwv: number } | { ok: false; error: string }

/** The rules of a password change (no rate limit; callers add that). */
export async function changePasswordIn(tx: Tx, userId: string, current: string, next: string, ip?: string): Promise<ChangeResult> {
  const [u] = await tx.select().from(users).where(eq(users.id, userId))
  if (!u || !u.isActive || u.deletedAt) return { ok: false, error: 'Account not available' }
  if (!(await verifyPassword(u.passwordHash, current))) return { ok: false, error: 'Current password is not correct' }
  const problem = passwordProblem(next, { email: u.email, current })
  if (problem) return { ok: false, error: problem }
  const changedAt = new Date()
  await tx.update(users).set({ passwordHash: await hashPassword(next), mustChangePassword: false, passwordChangedAt: changedAt }).where(eq(users.id, userId))
  await audit(tx, { userId, role: 'system' as never, branchId: u.branchId }, { action: 'change_password', entity: 'user', entityId: userId, ip })
  return { ok: true, pwv: changedAt.getTime() }
}

// ---- My account: a person's own details and sign-in security ---------------------------------
export type Profile = {
  name: string; email: string; phone: string | null; twoFactorEmail: boolean
  createdAt: string; lastLoginAt: string | null; passwordChangedAt: string
}

export const loadProfile = (orgId: string, userId: string) => withOrgSystem(orgId, async (tx): Promise<Profile | null> => {
  const [u] = await tx.select().from(users).where(eq(users.id, userId))
  if (!u) return null
  return { name: u.name, email: u.email, phone: u.phone, twoFactorEmail: u.twoFactorEmail, createdAt: u.createdAt.toISOString(), lastLoginAt: u.lastLoginAt?.toISOString() ?? null, passwordChangedAt: u.passwordChangedAt.toISOString() }
})

export type ProfileResult = { ok: true; name: string } | { ok: false; error: string }

/** A person edits their own name and phone. The e-mail is their sign-in and stays with the administrator. */
export async function updateOwnProfile(orgId: string, userId: string, input: { name: string; phone: string }, ip?: string): Promise<ProfileResult> {
  const name = input.name.trim().replace(/\s+/g, ' ')
  const phone = input.phone.trim()
  if (name.length < 2 || name.length > 80) return { ok: false, error: 'Enter your full name (2 to 80 characters)' }
  if (phone && !/^\+?[0-9][0-9 -]{8,16}$/.test(phone)) return { ok: false, error: 'Enter a valid phone number' }
  return withOrgSystem(orgId, async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId))
    if (!u || !u.isActive || u.deletedAt) return { ok: false, error: 'Account not available' }
    await tx.update(users).set({ name, phone: phone || null }).where(eq(users.id, userId))
    await audit(tx, { userId, role: 'system' as never, branchId: u.branchId }, { action: 'update_own_profile', entity: 'user', entityId: userId, before: { name: u.name, phone: u.phone }, after: { name, phone: phone || null }, ip })
    return { ok: true, name }
  })
}

/** Switch two-step sign-in on or off. Turning it OFF asks for the password, so an unattended screen cannot weaken the account. */
export async function setTwoFactor(orgId: string, userId: string, on: boolean, opts: { password?: string; ip?: string } = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  return withOrgSystem(orgId, async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId))
    if (!u || !u.isActive || u.deletedAt) return { ok: false, error: 'Account not available' }
    if (!on && !(await verifyPassword(u.passwordHash, opts.password ?? ''))) return { ok: false, error: 'Password is not correct' }
    await tx.update(users).set({ twoFactorEmail: on }).where(eq(users.id, userId))
    await audit(tx, { userId, role: 'system' as never, branchId: u.branchId }, { action: on ? 'two_factor_on' : 'two_factor_off', entity: 'user', entityId: userId, ip: opts.ip })
    return { ok: true }
  })
}

/** Checks a password change without making it, so a code is only mailed for a change that would go through. */
export async function checkOwnPasswordChange(orgId: string, userId: string, current: string, next: string): Promise<{ ok: true; email: string; name: string } | { ok: false; error: string }> {
  if (!(await underLimit(`pwchange:${userId}`, 8, 15 * 60))) return { ok: false, error: 'Too many attempts. Try again in 15 minutes.' }
  return withOrgSystem(orgId, async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId))
    if (!u || !u.isActive || u.deletedAt) return { ok: false as const, error: 'Account not available' }
    if (!(await verifyPassword(u.passwordHash, current))) return { ok: false as const, error: 'Current password is not correct' }
    const problem = passwordProblem(next, { email: u.email, current })
    if (problem) return { ok: false as const, error: problem }
    return { ok: true as const, email: u.email, name: u.name }
  })
}

export async function changeOwnPassword(orgId: string, userId: string, current: string, next: string, ip?: string): Promise<ChangeResult> {
  const key = `pwchange:${userId}`
  if (!(await underLimit(key, 8, 15 * 60))) return { ok: false, error: 'Too many attempts. Try again in 15 minutes.' }
  const res = await withOrgSystem(orgId, (tx) => changePasswordIn(tx, userId, current, next, ip))
  if (res.ok) await clearLimit(key)
  return res
}
