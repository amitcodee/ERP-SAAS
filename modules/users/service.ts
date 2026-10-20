import { randomBytes } from 'crypto'
import { eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { assertCan, DEFAULT_ROLE, mayGrant } from '@/lib/auth/permissions'
import { hashPassword } from '@/lib/auth/password'
import { assertEmailFree } from '@/lib/email-taken'
import { persons, registrations, roles, userRoles, users } from '@/lib/db/schema'
import type { Role } from '@/lib/db/schema'
import type { Actor, Tx } from '@/lib/db/withTenant'

export const createUserInput = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  role: z.string().trim().optional(), // one role, or
  roles: z.array(z.string().trim()).optional(), // several (a person can be counselor + telecaller + branch head)
  phone: z.string().trim().transform((v) => v.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '')).refine((v) => v === '' || /^[6-9]\d{9}$/.test(v), 'Enter a 10-digit mobile number').optional().nullable(),
  branchId: z.string().uuid().optional().nullable(),
})
export type CreateUserInput = z.infer<typeof createUserInput>

/**
 * No privilege escalation: a super admin may grant any role; anyone else may grant only staff roles whose every
 * permission they hold themselves (so a branch head cannot mint another branch head or a super admin).
 */
async function assertMayGrant(tx: Tx, actor: Actor, keys: string[]) {
  if (!keys.length) throw new Error('Pick at least one role')
  const rows = await tx.select().from(roles).where(inArray(roles.key, keys))
  const missing = keys.filter((k) => !rows.some((r) => r.key === k))
  if (missing.length) throw new Error(`Unknown role: ${missing.join(', ')}`)
  if (rows.some((r) => r.kind === 'student')) throw new Error('Student logins are created from the Students screen')
  const granter = { isSuper: actor.role === 'super_admin', perms: actor.perms ?? (actor.roles ?? [actor.role]).flatMap((k) => DEFAULT_ROLE[k]?.perms ?? []) }
  const tooBig = rows.filter((r) => !mayGrant(granter, r))
  if (tooBig.length) throw new Error(`Forbidden: you cannot create this role (${tooBig.map((r) => r.name).join(', ')})`)
  return rows
}

export type StaffRow = { id: string; name: string; email: string; phone: string | null; roles: Role[]; branchCode: string | null; branchName: string | null; isActive: boolean; createdAt: string; lastLoginAt: string | null; branchMade: boolean
  /** Home branch, and the other branches the person also works in (shared staff). */
  branchId: string | null; alsoBranches: { id: string; code: string; name: string; access?: 'own' | 'full' }[] }

/**
 * A branch changes (roles, password, active, delete) only the logins made in the branch; those head office made -
 * including the ones it made while setting the branch up - only head office changes.
 */
export async function assertBranchMayChange(tx: Tx, actor: Actor, userId: string) {
  if (actor.role === 'super_admin') return
  const [u] = await tx.select({ branchMade: users.branchMade, branchId: users.branchId }).from(users).where(eq(users.id, userId))
  if (u && u.branchId !== actor.branchId) throw new Error('This person belongs to another branch; only head office can change them')
  if (u && !u.branchMade) throw new Error('Head office made this login, so only head office can change it')
  // only someone who could have given every staff role this login holds may change it (no switching off a fellow manager)
  const held = (await tx.select().from(userRoles).where(eq(userRoles.userId, userId))).map((r) => r.role).filter((r) => r !== 'student')
  if (held.length) await assertMayGrant(tx, actor, held).catch(() => { throw new Error('Forbidden: only head office can change a manager or admin') })
}

export async function listUsers(tx: Tx, actor: Actor): Promise<StaffRow[]> {
  assertCan(actor, 'read', 'user')
  const res = await tx.execute<{ id: string; name: string; email: string; phone: string | null; roles: Role[]; code: string | null; bname: string | null; is_active: boolean; created_at: string; last_login_at: string | null; branch_made: boolean; branch_id: string | null; also: { id: string; code: string; name: string; access: 'own' | 'full' }[] }>(sql`
    select u.id, u.name, u.email, u.phone, u.is_active, u.branch_made, u.branch_id,
      coalesce((select json_agg(json_build_object('id', ob.id, 'code', ob.code, 'name', ob.name, 'access', ub.access) order by ob.code) from user_branches ub join branches ob on ob.id = ub.branch_id where ub.user_id = u.id), '[]') as also, b.code, b.name as bname, to_json(u.created_at) #>> '{}' as created_at, to_json(u.last_login_at) #>> '{}' as last_login_at,
      coalesce((select array_agg(ur.role::text order by ur.role) from user_roles ur where ur.user_id = u.id), '{}') as roles
    from users u left join branches b on b.id = u.branch_id where u.deleted_at is null order by u.created_at desc`)
  return res.rows.map((r) => ({
    id: r.id, name: r.name, email: r.email, phone: r.phone, roles: r.roles, branchCode: r.code, branchName: r.bname, isActive: r.is_active,
    createdAt: new Date(r.created_at).toISOString(), lastLoginAt: r.last_login_at ? new Date(r.last_login_at).toISOString() : null, branchMade: r.branch_made,
    branchId: r.branch_id, alsoBranches: r.also,
  }))
}

/** Creates a staff login with a one-time temporary password (returned once, never stored in plain text). */
export async function createUser(tx: Tx, actor: Actor, raw: CreateUserInput) {
  assertCan(actor, 'create', 'user')
  const input = createUserInput.parse(raw)
  const keys = [...new Set(input.roles?.length ? input.roles : input.role ? [input.role] : [])]
  const granted = await assertMayGrant(tx, actor, keys)
  const isSuper = granted.some((r) => r.kind === 'super')
  let branchId = input.branchId ?? null
  if (actor.role !== 'super_admin') branchId = actor.branchId // branch heads only ever add to their own branch
  else if (isSuper) branchId = null
  else if (!branchId) throw new Error('Choose a branch for this staff member')

  await assertEmailFree(tx, input.email)

  const tempPassword = randomBytes(9).toString('base64url')
  const [u] = await tx.insert(users).values({ name: input.name, email: input.email, phone: input.phone || null, branchId, passwordHash: await hashPassword(tempPassword), mustChangePassword: true, branchMade: actor.role !== 'super_admin' }).returning()
  await tx.insert(userRoles).values(keys.map((role) => ({ userId: u.id, role })))
  await audit(tx, actor, { action: 'create', entity: 'user', entityId: u.id, after: { email: input.email, roles: keys, branchId } })
  return { user: u, tempPassword, roles: keys }
}

export async function setUserActive(tx: Tx, actor: Actor, userId: string, active: boolean) {
  assertCan(actor, 'update', 'user')
  if (userId === actor.userId) throw new Error('You cannot deactivate your own account')
  await assertBranchMayChange(tx, actor, userId)
  const [u] = await tx.update(users).set({ isActive: active }).where(eq(users.id, userId)).returning()
  if (!u) throw new Error('User not found')
  await audit(tx, actor, { action: active ? 'activate' : 'deactivate', entity: 'user', entityId: userId })
  return u
}

/** Gives an enrolled student a portal login (their own fees, receipts, attendance and certificate - nothing else). */
export async function createStudentLogin(tx: Tx, actor: Actor, input: { registrationId: string; email?: string | null }) {
  assertCan(actor, 'create', 'user')
  const [reg] = await tx.select().from(registrations).where(eq(registrations.id, input.registrationId))
  if (!reg) throw new Error('Registration not found')
  const [person] = await tx.select().from(persons).where(eq(persons.id, reg.personId))
  if (!person) throw new Error('Student not found')
  if (person.userId) throw new Error('This student already has a login')
  const email = z.string().trim().toLowerCase().email('Enter a valid email').parse(input.email || person.email || '')
  await assertEmailFree(tx, email)

  const tempPassword = randomBytes(9).toString('base64url')
  const name = `${person.firstName} ${person.lastName ?? ''}`.trim()
  const [u] = await tx.insert(users).values({ name, email, branchId: person.branchId, passwordHash: await hashPassword(tempPassword), mustChangePassword: true, branchMade: actor.role !== 'super_admin' }).returning()
  await tx.insert(userRoles).values({ userId: u.id, role: 'student' })
  await tx.update(persons).set({ userId: u.id, email }).where(eq(persons.id, person.id)) // the login e-mail becomes the one on record
  await audit(tx, actor, { action: 'create_student_login', entity: 'user', entityId: u.id, after: { personId: person.id, email } })
  return { user: u, tempPassword }
}

/**
 * Admin password reset: issues a new one-time password, forces a change at next sign-in and voids the user's
 * existing sessions. A manager may reset staff and students of their own branch; only a super admin may reset
 * managers or other admins. Nobody resets their own password this way (use "change password").
 */
export async function resetUserPassword(tx: Tx, actor: Actor, userId: string) {
  assertCan(actor, 'update', 'user')
  if (userId === actor.userId) throw new Error('Use "change password" for your own account')
  const [u] = await tx.select().from(users).where(eq(users.id, userId)) // RLS: only this branch (or all, for super admin)
  if (!u) throw new Error('User not found')
  if (actor.role !== 'super_admin' && u.branchId !== actor.branchId) throw new Error('This person belongs to another branch; only head office can change them')
  await assertBranchMayChange(tx, actor, userId)
  const held = (await tx.select().from(userRoles).where(eq(userRoles.userId, userId))).map((r) => r.role)
  // Only someone who could have granted all of this user's roles may reset their password.
  if (actor.role !== 'super_admin') await assertMayGrant(tx, actor, held).catch(() => { throw new Error('Forbidden: only a super admin can reset a manager or admin') })
  const tempPassword = randomBytes(9).toString('base64url')
  await tx.update(users).set({ passwordHash: await hashPassword(tempPassword), mustChangePassword: true, passwordChangedAt: new Date() }).where(eq(users.id, userId))
  await audit(tx, actor, { action: 'reset_password', entity: 'user', entityId: userId })
  return { email: u.email, tempPassword }
}

/** Replace a staff member's roles (several allowed). Same no-escalation rule; takes effect on their next click. */
export async function setUserRoles(tx: Tx, actor: Actor, userId: string, keys: string[]) {
  assertCan(actor, 'update', 'user')
  if (userId === actor.userId) throw new Error('You cannot change your own roles')
  const [u] = await tx.select().from(users).where(eq(users.id, userId)) // RLS: own branch (all for super admin)
  if (!u) throw new Error('User not found')
  if (actor.role !== 'super_admin' && u.branchId !== actor.branchId) throw new Error('This person belongs to another branch; only head office can change them')
  await assertBranchMayChange(tx, actor, userId)
  const before = (await tx.select().from(userRoles).where(eq(userRoles.userId, userId))).map((r) => r.role)
  if (before.includes('student')) throw new Error('Student logins cannot be given staff roles')
  const wanted = [...new Set(keys)]
  const granted = await assertMayGrant(tx, actor, wanted)
  if (actor.role !== 'super_admin') await assertMayGrant(tx, actor, before) // cannot strip roles you could not grant
  if (granted.some((r) => r.kind === 'super') !== !u.branchId) throw new Error(u.branchId ? 'A branch user cannot be made super admin here; create a head-office account instead' : 'A head-office account must keep the Super Admin role')
  await tx.delete(userRoles).where(eq(userRoles.userId, userId))
  await tx.insert(userRoles).values(wanted.map((role) => ({ userId, role })))
  await audit(tx, actor, { action: 'set_roles', entity: 'user', entityId: userId, before: { roles: before }, after: { roles: wanted } })
  return wanted
}
