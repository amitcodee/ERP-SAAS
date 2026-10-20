import { randomBytes } from 'crypto'
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { hashPassword } from '@/lib/auth/password'
import { assertCan } from '@/lib/auth/permissions'
import { passwordProblem } from '@/lib/auth/validity'
import { codeForCity, nextFreeCode } from '@/lib/branch-code'
import { orgRegFormat, peekRegNo, regFormatProblem, renderRegNo, setRegCounter } from '@/lib/numbering'
import { emailOwner, emailTakenMessage } from '@/lib/email-taken'
import { branches, certificates, roles, userBranches, userRoles, users } from '@/lib/db/schema'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { claimSiteLeads, siteHostOf } from '../web-leads/service'

// Branch life cycle (head office only):
//   1. create  -> status "setup", with its branch admin login (a Branch Manager for the branch e-mail), nobody can sign in
//   2. add the branch counselor, 3. add the branch accountant (one person may be both: roles add up)
//   4. activate (only at 100%) -> everyone of the branch who has not signed in yet gets their login by e-mail.
// The branch code is generated from the city (lib/branch-code.ts). No GST.
const digits = (s: string) => s.replace(/\D/g, '')
const details = {
  name: z.string().trim().min(3, 'Branch name is required').max(100),
  address: z.string().trim().min(5, 'Full address is required').max(300),
  state: z.string().trim().min(2, 'State is required').max(60),
  pincode: z.string().trim().transform(digits).refine((v) => /^[1-9]\d{5}$/.test(v), 'PIN code must be 6 digits'),
  phone: z.string().trim().transform((v) => digits(v).replace(/^(91|0)(?=\d{10}$)/, '')).refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a 10-digit mobile number'),
  email: z.string().trim().toLowerCase().email('Enter a valid branch e-mail'),
  certCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/, 'Certificate code: 2-10 letters/digits').optional().nullable(), // defaults to the branch code
  // The branch's own website: the leads its forms send come to this branch (modules/web-leads).
  websiteUrl: z.string().trim().max(300).optional().nullable().transform((v) => v || null).refine((v) => !v || !!siteHostOf(v), 'Enter the website address, e.g. https://techcaddludhiana.com'),
}
export const createBranchInput = z.object({
  ...details,
  city: z.string().trim().min(2, 'City is required').max(60).regex(/[A-Za-z]{2}/, 'Enter the city name'),
  adminName: z.string().trim().max(100).optional().nullable(), // defaults to "<branch name> Admin"
})
export type CreateBranchInput = z.input<typeof createBranchInput>
export const updateBranchInput = z.object({ id: z.string().uuid(), ...details })
export type UpdateBranchInput = z.input<typeof updateBranchInput>

export async function listBranches(tx: Tx) {
  return tx.select().from(branches).where(eq(branches.isActive, true)).orderBy(asc(branches.name))
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase())
export const generatePassword = () => `Tc${randomBytes(9).toString('base64url')}7` // always has a letter and a digit

export type Login = { userId: string; name: string; email: string; password: string; roles: string[] }

/** The website's address as stored, and its host (what leads are matched on). One website belongs to one branch. */
async function websiteOf(tx: Tx, url: string | null | undefined, exceptId?: string) {
  const host = siteHostOf(url)
  if (!host) return { websiteUrl: null, websiteHost: null }
  const [clash] = await tx.select({ name: branches.name }).from(branches).where(and(eq(branches.websiteHost, host), exceptId ? ne(branches.id, exceptId) : undefined))
  if (clash) throw new Error(`The website ${host} is already set on ${clash.name}`)
  return { websiteUrl: /^https?:\/\//i.test(url!.trim()) ? url!.trim() : `https://${url!.trim()}`, websiteHost: host }
}

async function assertCertCodeFree(tx: Tx, certCode: string, exceptId?: string) {
  const [clash] = await tx.select({ id: branches.id }).from(branches).where(and(eq(branches.certCode, certCode), exceptId ? ne(branches.id, exceptId) : undefined))
  if (clash) throw new Error(`Certificate code ${certCode} is already used by another branch`)
}

/** The branch admin login: a Branch Manager account for the branch e-mail (created with the branch, mailed on activation). */
async function ensureBranchAdmin(tx: Tx, b: { id: string; name: string; email: string }, adminName?: string | null) {
  const [taken] = await tx.select().from(users).where(eq(users.email, b.email))
  if (taken?.branchId === b.id) return taken
  const owner = taken?.name ?? await emailOwner(tx, b.email)
  if (owner) throw new Error(`${emailTakenMessage(b.email, owner)} The branch admin login needs the branch's own e-mail.`)
  const [u] = await tx.insert(users).values({ name: adminName || `${b.name} Admin`, email: b.email, branchId: b.id, passwordHash: await hashPassword(generatePassword()), mustChangePassword: true }).returning()
  await tx.insert(userRoles).values({ userId: u.id, role: 'branch_manager' })
  return u
}

export async function createBranch(tx: Tx, actor: Actor, raw: CreateBranchInput) {
  assertCan(actor, 'create', 'branch')
  const input = createBranchInput.parse(raw)
  const city = titleCase(input.city.replace(/\s+/g, ' '))
  const base = codeForCity(city)
  if (!base) throw new Error('Enter the city name')
  const all = await tx.select({ code: branches.code }).from(branches) // inactive too: codes are never reused
  const code = nextFreeCode(base, all.map((b) => b.code))
  const certCode = input.certCode || code
  await assertCertCodeFree(tx, certCode)
  const values = { code, certCode, name: input.name, city, address: input.address, state: titleCase(input.state), pincode: input.pincode, phone: input.phone, email: input.email, status: 'setup', ...(await websiteOf(tx, input.websiteUrl)) }
  const [b] = await tx.insert(branches).values(values).returning()
  if (b.websiteHost) await claimSiteLeads(tx, b.id, b.websiteHost, actor.userId)
  const admin = await ensureBranchAdmin(tx, { id: b.id, name: b.name, email: input.email }, input.adminName)
  await audit(tx, actor, { action: 'create', entity: 'branch', entityId: b.id, after: { ...values, adminUserId: admin.id } })
  return { branch: b, adminUserId: admin.id }
}

/** View & edit later. The branch code stays (it is in every number already issued); the certificate code is locked once certificates exist. */
export async function updateBranch(tx: Tx, actor: Actor, raw: UpdateBranchInput) {
  assertCan(actor, 'update', 'branch')
  const input = updateBranchInput.parse(raw)
  const [b] = await tx.select().from(branches).where(eq(branches.id, input.id))
  if (!b) throw new Error('Branch not found')
  const certCode = input.certCode || b.certCode || b.code
  if (certCode !== b.certCode) {
    const [issued] = await tx.select({ id: certificates.id }).from(certificates).where(eq(certificates.branchId, b.id)).limit(1)
    if (issued) throw new Error('The certificate code cannot change after certificates have been issued')
    await assertCertCodeFree(tx, certCode, b.id)
  }
  const after = { name: input.name, address: input.address, state: titleCase(input.state), pincode: input.pincode, phone: input.phone, email: input.email, certCode,
    ...(raw.websiteUrl === undefined ? { websiteUrl: b.websiteUrl, websiteHost: b.websiteHost } : await websiteOf(tx, input.websiteUrl, b.id)) } // not sent = unchanged
  // The branch admin login follows the branch e-mail until that admin has signed in for the first time.
  if (b.email && input.email !== b.email) {
    const [old] = await tx.select().from(users).where(and(eq(users.email, b.email), eq(users.branchId, b.id)))
    const owner = await emailOwner(tx, input.email)
    if (owner) throw new Error(`${emailTakenMessage(input.email, owner)} The branch admin login needs the branch's own e-mail.`)
    if (old && !old.lastLoginAt) await tx.update(users).set({ email: input.email }).where(eq(users.id, old.id))
  }
  await tx.update(branches).set(after).where(eq(branches.id, b.id))
  await ensureBranchAdmin(tx, { id: b.id, name: input.name, email: input.email })
  // A website newly set on the branch: what it already sent and was waiting comes to the branch now.
  if (after.websiteHost && after.websiteHost !== b.websiteHost) await claimSiteLeads(tx, b.id, after.websiteHost, actor.userId)
  await audit(tx, actor, { action: 'update', entity: 'branch', entityId: b.id, before: { name: b.name, address: b.address, state: b.state, pincode: b.pincode, phone: b.phone, email: b.email, certCode: b.certCode, websiteUrl: b.websiteUrl }, after })
  return after
}

// ---- setup progress ---------------------------------------------------------------------------------

export type SetupStep = { key: 'details' | 'counselor' | 'accountant'; label: string; done: boolean; people: string[] }
export type BranchSetup = { branchId: string; status: string; pct: number; ready: boolean; steps: SetupStep[]; team: TeamMember[] }
/** `home` is set for someone shared from another branch: the code of the branch they belong to; `access` what they see here. */
export type TeamMember = { id: string; name: string; email: string; phone: string | null; roles: string[]; isActive: boolean; signedIn: boolean; home: string | null; access: 'own' | 'full' | null }

export async function branchTeam(tx: Tx, branchId: string): Promise<TeamMember[]> {
  const rows = await tx.execute<{ id: string; name: string; email: string; phone: string | null; is_active: boolean; last_login_at: string | null; roles: string[]; home: string | null; access: string | null }>(sql`
    select u.id, u.name, u.email, u.phone, u.is_active, u.last_login_at::text,
      coalesce((select array_agg(ur.role order by ur.role) from user_roles ur where ur.user_id = u.id), '{}') as roles,
      case when u.branch_id = ${branchId} then null else (select hb.code from branches hb where hb.id = u.branch_id) end as home,
      (select ub.access from user_branches ub where ub.user_id = u.id and ub.branch_id = ${branchId} and u.branch_id <> ${branchId}) as access
    from users u where (u.branch_id = ${branchId} or exists (select 1 from user_branches ub where ub.user_id = u.id and ub.branch_id = ${branchId})) and u.deleted_at is null
      and not exists (select 1 from user_roles s where s.user_id = u.id and s.role = 'student')
    order by (u.branch_id = ${branchId}) desc, u.created_at desc`)
  return rows.rows.map((r) => ({ id: r.id, name: r.name, email: r.email, phone: r.phone, roles: r.roles, isActive: r.is_active, signedIn: !!r.last_login_at, home: r.home, access: r.home ? (r.access === 'full' ? 'full' : 'own') : null }))
}

export async function branchSetup(tx: Tx, actor: Actor, branchId: string): Promise<BranchSetup> {
  assertCan(actor, 'read', 'branch')
  const [b] = await tx.select().from(branches).where(eq(branches.id, branchId))
  if (!b) throw new Error('Branch not found')
  const team = (await branchTeam(tx, branchId)).filter((m) => m.isActive)
  const holders = (role: string) => team.filter((m) => m.roles.includes(role)).map((m) => m.name)
  const detailsDone = !!(b.name && b.city && b.address && b.state && b.pincode && b.phone && b.email && (b.certCode || b.code)) && holders('branch_manager').length > 0
  const steps: SetupStep[] = [
    { key: 'details', label: 'Branch details and branch admin login', done: detailsDone, people: holders('branch_manager') },
    { key: 'counselor', label: 'Branch counselor', done: holders('counselor').length > 0, people: holders('counselor') },
    { key: 'accountant', label: 'Branch accountant', done: holders('accountant').length > 0, people: holders('accountant') },
  ]
  const pct = Math.round((steps.filter((s) => s.done).length / steps.length) * 100)
  return { branchId, status: b.status, pct, ready: pct === 100, steps, team: await branchTeam(tx, branchId) }
}

/** Progress of every branch at once, for the branches list. */
export async function setupOverview(tx: Tx): Promise<Record<string, number>> {
  const rows = await tx.execute<{ id: string; pct: number }>(sql`
    select b.id, round((
      (case when b.address is not null and b.state is not null and b.pincode is not null and b.phone is not null and b.email is not null
             and exists (select 1 from users u join user_roles r on r.user_id = u.id where (u.branch_id = b.id or exists (select 1 from user_branches ub where ub.user_id = u.id and ub.branch_id = b.id)) and u.is_active and u.deleted_at is null and r.role = 'branch_manager') then 1 else 0 end)
      + (case when exists (select 1 from users u join user_roles r on r.user_id = u.id where (u.branch_id = b.id or exists (select 1 from user_branches ub where ub.user_id = u.id and ub.branch_id = b.id)) and u.is_active and u.deleted_at is null and r.role = 'counselor') then 1 else 0 end)
      + (case when exists (select 1 from users u join user_roles r on r.user_id = u.id where (u.branch_id = b.id or exists (select 1 from user_branches ub where ub.user_id = u.id and ub.branch_id = b.id)) and u.is_active and u.deleted_at is null and r.role = 'accountant') then 1 else 0 end)
    ) * 100.0 / 3)::int as pct from branches b`)
  return Object.fromEntries(rows.rows.map((r) => [r.id, Number(r.pct)]))
}

/**
 * Opens the branch (100% only). Everyone of the branch who has never signed in gets a fresh one-time password,
 * returned here so the caller can e-mail it AFTER the transaction commits.
 */
export async function activateBranch(tx: Tx, actor: Actor, branchId: string): Promise<{ branch: typeof branches.$inferSelect; logins: Login[] }> {
  assertCan(actor, 'update', 'branch')
  const setup = await branchSetup(tx, actor, branchId)
  if (setup.status === 'active') throw new Error('This branch is already active')
  if (!setup.ready) throw new Error(`Setup is ${setup.pct}% complete. Still missing: ${setup.steps.filter((s) => !s.done).map((s) => s.label).join(', ')}`)
  const [b] = await tx.update(branches).set({ status: 'active', activatedAt: new Date() }).where(eq(branches.id, branchId)).returning()
  const logins = await freshLogins(tx, branchId)
  await audit(tx, actor, { action: 'activate', entity: 'branch', entityId: branchId, after: { mailedTo: logins.map((l) => l.email) } })
  return { branch: b, logins }
}

/** New one-time passwords for the branch's people who have not signed in yet (or one person). */
export async function freshLogins(tx: Tx, branchId: string, onlyUserId?: string): Promise<Login[]> {
  const pending = await tx.select().from(users).where(and(eq(users.branchId, branchId), eq(users.isActive, true), isNull(users.deletedAt), onlyUserId ? eq(users.id, onlyUserId) : isNull(users.lastLoginAt)))
  const out: Login[] = []
  for (const u of pending) {
    const rs = (await tx.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, u.id))).map((r) => r.role)
    if (rs.includes('student')) continue
    const password = generatePassword()
    await tx.update(users).set({ passwordHash: await hashPassword(password), mustChangePassword: true, passwordChangedAt: new Date() }).where(eq(users.id, u.id))
    out.push({ userId: u.id, name: u.name, email: u.email, password, roles: rs })
  }
  return out
}

/** "Resend login" for one person of an ACTIVE branch (super admin): new one-time password, mailed again. */
export async function resendLogin(tx: Tx, actor: Actor, userId: string): Promise<{ branch: typeof branches.$inferSelect; logins: Login[] }> {
  assertCan(actor, 'update', 'branch')
  const [u] = await tx.select().from(users).where(eq(users.id, userId))
  if (!u?.branchId) throw new Error('User not found')
  const [b] = await tx.select().from(branches).where(eq(branches.id, u.branchId))
  if (b.status !== 'active') throw new Error('The branch is not active yet: logins are sent when it is activated')
  const logins = await freshLogins(tx, b.id, u.id)
  await audit(tx, actor, { action: 'reset_password', entity: 'user', entityId: u.id, after: { via: 'resend_login' } })
  return { branch: b, logins }
}

export const roleNames = async (tx: Tx) => Object.fromEntries((await tx.select({ key: roles.key, name: roles.name }).from(roles)).map((r) => [r.key, r.name]))

// ---- staff shared between branches -------------------------------------------------------------------

export type StaffOption = { id: string; name: string; email: string; home: string | null }

/** Everyone in the company holding this role who is not yet in this branch (to share them with it). */
export async function staffElsewhere(tx: Tx, actor: Actor, branchId: string, role: string): Promise<StaffOption[]> {
  assertCan(actor, 'update', 'branch')
  const rows = await tx.execute<StaffOption>(sql`
    select u.id, u.name, u.email, hb.code as home
    from users u join user_roles r on r.user_id = u.id and r.role = ${role} join branches hb on hb.id = u.branch_id
    where u.is_active and u.deleted_at is null and u.branch_id <> ${branchId}
      and not exists (select 1 from user_branches ub where ub.user_id = u.id and ub.branch_id = ${branchId})
    order by u.name`)
  return rows.rows
}

/** The person keeps their home branch and login, and also works in this branch. */
export async function shareStaff(tx: Tx, actor: Actor, branchId: string, userId: string) {
  assertCan(actor, 'update', 'branch')
  const [u] = await tx.select().from(users).where(and(eq(users.id, userId), eq(users.isActive, true), isNull(users.deletedAt)))
  if (!u?.branchId) throw new Error('Choose a branch staff member')
  if (u.branchId === branchId) throw new Error(`${u.name} already belongs to this branch`)
  const held = (await tx.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId))).map((r) => r.role)
  if (held.includes('student')) throw new Error('A student login cannot be staff')
  await tx.insert(userBranches).values({ userId, branchId }).onConflictDoNothing()
  await audit(tx, actor, { action: 'share_staff', entity: 'branch', entityId: branchId, after: { userId, roles: held } })
  return { name: u.name }
}

/**
 * Head office moves a staff member's home branch to `branchId` (one they may already also work in). `keepOld`: the old
 * home stays one of their branches; otherwise they leave it. Their login, roles and records stay as they are.
 */
export async function setHomeBranch(tx: Tx, actor: Actor, userId: string, branchId: string, keepOld: boolean) {
  assertCan(actor, 'update', 'branch')
  const [u] = await tx.select().from(users).where(and(eq(users.id, userId), isNull(users.deletedAt)))
  if (!u?.branchId) throw new Error('Choose a branch staff member')
  if (u.branchId === branchId) throw new Error(`This is already ${u.name}'s home branch`)
  const [b] = await tx.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.id, branchId))
  if (!b) throw new Error('Branch not found')
  const held = (await tx.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId))).map((r) => r.role)
  if (held.includes('student')) throw new Error('A student belongs to the branch they registered in')
  await tx.update(users).set({ branchId }).where(eq(users.id, userId))
  await tx.delete(userBranches).where(and(eq(userBranches.userId, userId), eq(userBranches.branchId, branchId)))
  // their old home: they keep seeing it as before
  if (keepOld) await tx.insert(userBranches).values({ userId, branchId: u.branchId, access: 'full' }).onConflictDoNothing()
  await audit(tx, actor, { action: 'set_home_branch', entity: 'user', entityId: userId, before: { branchId: u.branchId }, after: { branchId, keepOld } })
  return { name: u.name, branch: b.name }
}

/** In a branch they are shared with, a person sees only their own work there ('own', the default) or all of it as their role allows ('full'). */
export async function setStaffAccess(tx: Tx, actor: Actor, branchId: string, userId: string, access: 'own' | 'full') {
  assertCan(actor, 'update', 'branch')
  if (access !== 'own' && access !== 'full') throw new Error('Choose own work or full access')
  const [row] = await tx.update(userBranches).set({ access }).where(and(eq(userBranches.userId, userId), eq(userBranches.branchId, branchId))).returning({ userId: userBranches.userId })
  if (!row) throw new Error('This person is not shared with this branch')
  await audit(tx, actor, { action: 'set_staff_access', entity: 'branch', entityId: branchId, after: { userId, access } })
}

export async function unshareStaff(tx: Tx, actor: Actor, branchId: string, userId: string) {
  assertCan(actor, 'update', 'branch')
  await tx.delete(userBranches).where(and(eq(userBranches.userId, userId), eq(userBranches.branchId, branchId)))
  await audit(tx, actor, { action: 'unshare_staff', entity: 'branch', entityId: branchId, before: { userId } })
}

// ---- registration numbers ------------------------------------------------------------------------------

export type RegNumbering = { format: string | null; defaultFormat: string; next: string; example: string; code: string }

/** How the branch numbers its registrations, and the number the next one gets. */
export async function regNumbering(tx: Tx, actor: Actor, branchId: string): Promise<RegNumbering> {
  assertCan(actor, 'read', 'branch')
  const [b] = await tx.select({ code: branches.code, regFormat: branches.regFormat }).from(branches).where(eq(branches.id, branchId))
  if (!b) throw new Error('Branch not found')
  const orgFormat = await orgRegFormat(tx)
  const f = b.regFormat || orgFormat
  return { format: b.regFormat, defaultFormat: orgFormat, next: await peekRegNo(tx, branchId, b.code), example: renderRegNo(f, b.code, 1), code: b.code }
}

/**
 * Head office sets the branch's registration number format (null: the default) and, if given, the number the next
 * registration gets — e.g. TCD/4002/{n} from 2586, to carry on the old records' numbering. Numbers already used are
 * never given again (the counter never goes below the highest one in this format, and a used number is skipped).
 */
export async function setRegNumbering(tx: Tx, actor: Actor, branchId: string, rawFormat: string | null, next: number | null) {
  if (actor.role !== 'super_admin') throw new Error('Only head office sets registration numbers')
  const format = rawFormat?.trim() || null
  if (format) { const why = regFormatProblem(format); if (why) throw new Error(`Number format: ${why}`) }
  if (next != null && (!Number.isInteger(next) || next < 1 || next > 99_999_999)) throw new Error('Next number: a whole number from 1')
  const [b] = await tx.select({ code: branches.code, regFormat: branches.regFormat }).from(branches).where(eq(branches.id, branchId))
  if (!b) throw new Error('Branch not found')
  await tx.update(branches).set({ regFormat: format }).where(eq(branches.id, branchId))
  const counter = await setRegCounter(tx, branchId, b.code, next)
  await audit(tx, actor, { action: 'set_reg_numbering', entity: 'branch', entityId: branchId, before: { format: b.regFormat }, after: { format, next: counter.next } })
  return regNumbering(tx, actor, branchId)
}
