// The platform console (admin.<root>): the platform's own people sign in, see the organisations (sizes only, never a
// record), suspend or reactivate one, and open a support session in one. Everything a platform admin does to an org
// goes in that org's own audit log, so its admins see it.
import { randomBytes } from 'crypto'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { ORG_STATUSES, type OrgStatus } from '@/lib/db/schema/tenancy'
import { applyOrgSystem, withOrgSystem, withPlatform, type Tx } from '@/lib/db/withTenant'
import { forgetHosts } from '@/lib/tenant/resolve'

export type PlatformUser = { id: string; name: string; email: string }

// ---- platform people ----------------------------------------------------------------------------------------------

/** Adds a platform admin (or gives an existing one a new password). Returns the password to hand over. */
export async function upsertPlatformUser(v: { name: string; email: string; password?: string }): Promise<{ id: string; password: string }> {
  const email = z.string().trim().toLowerCase().email().parse(v.email)
  const password = v.password ?? randomBytes(12).toString('base64url')
  if (password.length < 12) throw new Error('A platform password needs at least 12 characters')
  const hash = await hashPassword(password)
  const [u] = await withPlatform(async (tx) => (await tx.execute<{ id: string }>(sql`
    insert into platform_users (name, email, password_hash) values (${v.name}, ${email}, ${hash})
    on conflict (lower(email)) do update set password_hash = excluded.password_hash, name = excluded.name, is_active = true
    returning id`)).rows)
  return { id: u.id, password }
}

let dummy: Promise<string> | undefined
const dummyHash = () => (dummy ??= hashPassword(randomBytes(16).toString('hex')))

/** Signs a platform admin in, or null (the same answer for a wrong password and an unknown e-mail). */
export async function platformLogin(email: string, password: string): Promise<PlatformUser | null> {
  const e = email.trim().toLowerCase()
  return withPlatform(async (tx) => {
    const [u] = (await tx.execute<{ id: string; name: string; email: string; password_hash: string; is_active: boolean }>(sql`
      select id, name, email, password_hash, is_active from platform_users where lower(email) = ${e}`)).rows
    // check a password even when nobody has this e-mail, so the answer takes as long either way
    const ok = await verifyPassword(u?.password_hash ?? (await dummyHash()), password).catch(() => false)
    if (!u || !u.is_active || !ok) return null
    await tx.execute(sql`update platform_users set last_login_at = now() where id = ${u.id}`)
    return { id: u.id, name: u.name, email: u.email }
  })
}

/** The platform admin behind a session, while still active. */
export async function platformUser(id: string): Promise<PlatformUser | null> {
  return withPlatform(async (tx) => (await tx.execute<PlatformUser>(sql`select id, name, email from platform_users where id = ${id} and is_active`)).rows[0] ?? null)
}

// ---- organisations --------------------------------------------------------------------------------------------------

export type OrgListRow = {
  id: string; name: string; slug: string; status: OrgStatus; plan: string; createdAt: string; trialEndsAt: string | null
  branches: number; users: number; activeStudents: number; receipts30d: number; lastSignIn: string | null; supportOpen: boolean
}

export async function listOrgs(f: { q?: string; status?: string } = {}): Promise<OrgListRow[]> {
  const q = (f.q ?? '').trim().toLowerCase()
  const status = (ORG_STATUSES as readonly string[]).includes(f.status ?? '') ? f.status! : null
  return withPlatform(async (tx) => (await tx.execute<OrgListRow>(sql`
    select o.id, o.name, o.slug, o.status, o.plan_key as plan, o.created_at::text as "createdAt", o.trial_ends_at::text as "trialEndsAt",
      coalesce(s.branches, 0) as branches, coalesce(s.users, 0) as users, coalesce(s.active_students, 0) as "activeStudents",
      coalesce(s.receipts_30d, 0) as "receipts30d", s.last_sign_in::text as "lastSignIn",
      exists (select 1 from support_sessions x where x.org_id = o.id and x.ended_at is null and x.expires_at > now()) as "supportOpen"
    from organisations o left join platform_org_stats() s on s.org_id = o.id
    where (${q} = '' or lower(o.name) like ${'%' + q + '%'} or o.slug like ${'%' + q + '%'}) and (${status}::text is null or o.status = ${status})
    order by o.created_at desc limit 500`)).rows)
}

export type OrgDetail = OrgListRow & { ownerName: string | null; ownerEmail: string | null; sessions: SupportRow[] }
export type SupportRow = { id: string; by: string; reason: string; mode: 'read' | 'write'; startedAt: string; expiresAt: string; endedAt: string | null; endedBy: string | null; open: boolean }

export async function orgDetail(id: string): Promise<OrgDetail | null> {
  const [row] = (await listOrgs()).filter((o) => o.id === id)
  if (!row) return null
  // the owner's name and e-mail, so support can reach them: read inside the org, nothing else
  const owner = await withOrgSystem(id, async (tx) => (await tx.execute<{ name: string; email: string }>(sql`
    select u.name, u.email from organisations o join users u on u.id = o.owner_user_id where o.id = ${id}`)).rows[0] ?? null)
  return { ...row, ownerName: owner?.name ?? null, ownerEmail: owner?.email ?? null, sessions: await withPlatform((tx) => supportSessionsIn(tx, id)) }
}

/** Writes a platform admin's action into the org's own audit log (inside an open platform transaction). */
async function auditInOrg(tx: Tx, orgId: string, pu: PlatformUser, a: { action: string; entity: string; entityId: string; after?: unknown; supportSessionId?: string }) {
  await applyOrgSystem(tx, orgId)
  await tx.execute(sql`insert into audit_logs (user_id, action, entity, entity_id, after, impersonator_id, support_session_id)
    values (null, ${a.action}, ${a.entity}, ${a.entityId}, ${JSON.stringify({ by: `${pu.name} (platform)`, ...(a.after as object ?? {}) })}::jsonb, ${pu.id}, ${a.supportSessionId ?? null})`)
}

/** Suspends an org (nobody can sign in; its jobs stop) or opens it again. A reason is required either way. */
export async function setOrgStatus(pu: PlatformUser, orgId: string, status: 'suspended' | 'active' | 'read_only', reason: string) {
  const why = reason.trim()
  if (why.length < 3) throw new Error('Give a reason')
  await withPlatform(async (tx) => {
    const [o] = (await tx.execute<{ status: string }>(sql`select status from organisations where id = ${orgId} for update`)).rows
    if (!o) throw new Error('Organisation not found')
    if (o.status === status) throw new Error(`It is already ${status.replace('_', '-')}`)
    if (o.status === 'cancelled') throw new Error('A cancelled organisation cannot be changed here')
    await tx.execute(sql`update organisations set status = ${status} where id = ${orgId}`)
    if (status === 'suspended') await tx.execute(sql`update support_sessions set ended_at = now(), ended_by = 'platform' where org_id = ${orgId} and ended_at is null`)
    await auditInOrg(tx, orgId, pu, { action: `status_${status}`, entity: 'organisation', entityId: orgId, after: { from: o.status, to: status, reason: why } })
  })
  forgetHosts() // the proxy and every page see the new status at once
}

// ---- support sessions -------------------------------------------------------------------------------------------------

const startInput = z.object({
  reason: z.string().trim().min(5, 'Say why you need to go in (at least a few words)').max(300),
  mode: z.enum(['read', 'write']).default('read'),
  minutes: z.number().int().min(5).max(60).default(30),
})

/** Opens a support session (at most 60 minutes; read-only unless asked otherwise). One open session per org at a time. */
export async function startSupport(pu: PlatformUser, orgId: string, raw: z.input<typeof startInput>): Promise<{ id: string }> {
  const v = startInput.parse(raw)
  return withPlatform(async (tx) => {
    const [o] = (await tx.execute<{ status: string; owner: string | null }>(sql`select status, owner_user_id as owner from organisations where id = ${orgId}`)).rows
    if (!o) throw new Error('Organisation not found')
    if (o.status === 'suspended' || o.status === 'cancelled') throw new Error(`It is ${o.status}: reactivate it first`)
    if (!o.owner) throw new Error('This organisation has no owner login to work as')
    const [open] = (await tx.execute(sql`select 1 from support_sessions where org_id = ${orgId} and ended_at is null and expires_at > now()`)).rows
    if (open) throw new Error('A support session is already open in this organisation: end it first')
    const [s] = (await tx.execute<{ id: string }>(sql`
      insert into support_sessions (org_id, platform_user_id, by_name, reason, mode, expires_at)
      values (${orgId}, ${pu.id}, ${pu.name}, ${v.reason}, ${v.mode}, now() + make_interval(mins => ${v.minutes})) returning id`)).rows
    await auditInOrg(tx, orgId, pu, { action: 'support_start', entity: 'support_session', entityId: s.id, after: { reason: v.reason, mode: v.mode, minutes: v.minutes }, supportSessionId: s.id })
    return s
  })
}

/** The caller's own open session in that org (a new link is only for the admin who opened it), or an error. */
export async function assertOwnOpenSession(pu: PlatformUser, orgId: string, sessionId: string) {
  const [s] = await withPlatform(async (tx) => (await tx.execute(sql`
    select 1 from support_sessions where id = ${sessionId} and org_id = ${orgId} and platform_user_id = ${pu.id} and ended_at is null and expires_at > now()`)).rows)
  if (!s) throw new Error('That session is not open, or it is someone else’s')
}

/** Ends a support session: by the platform (from the console) or by the org's head office (the banner). */
export async function endSupportByPlatform(pu: PlatformUser, sessionId: string) {
  await withPlatform(async (tx) => {
    const [s] = (await tx.execute<{ org_id: string }>(sql`update support_sessions set ended_at = now(), ended_by = 'platform' where id = ${sessionId} and ended_at is null returning org_id`)).rows
    if (!s) throw new Error('That session has already ended')
    await auditInOrg(tx, s.org_id, pu, { action: 'support_end', entity: 'support_session', entityId: sessionId, supportSessionId: sessionId })
  })
}

async function supportSessionsIn(tx: Tx, orgId: string): Promise<SupportRow[]> {
  return (await tx.execute<SupportRow>(sql`
    select s.id, p.name as by, s.reason, s.mode, s.started_at::text as "startedAt", s.expires_at::text as "expiresAt", s.ended_at::text as "endedAt", s.ended_by as "endedBy",
      (s.ended_at is null and s.expires_at > now()) as open
    from support_sessions s join platform_users p on p.id = s.platform_user_id where s.org_id = ${orgId} order by s.started_at desc limit 20`)).rows
}

// ---- the org's side -----------------------------------------------------------------------------------------------------

export type OpenSupport = { id: string; by: string; reason: string; mode: 'read' | 'write'; expiresAt: string; platformUserId: string }

/** The org's open support session, if any (in the org's own context: its staff see who is in and why). */
export async function openSupportIn(tx: Tx): Promise<OpenSupport | null> {
  return (await tx.execute<OpenSupport>(sql`
    select s.id, s.reason, s.mode, s.expires_at::text as "expiresAt", s.platform_user_id as "platformUserId",
      coalesce(nullif(s.by_name, ''), 'Platform support') as by
    from support_sessions s where s.org_id = app_org() and s.ended_at is null and s.expires_at > now() order by s.started_at desc limit 1`)).rows[0] ?? null
}
export const openSupport = (orgId: string) => withOrgSystem(orgId, openSupportIn)

/** The org's head office ends the open support session (the banner's "End now"). */
export async function endSupportByOrg(tx: Tx, actor: { userId: string; branchId: string | null; role: string; impersonatorId?: string | null }, sessionId: string) {
  if (actor.role !== 'super_admin' || actor.impersonatorId) throw new Error('Only the institute’s head office ends a support session')
  const r = await tx.execute(sql`update support_sessions set ended_at = now(), ended_by = 'org' where id = ${sessionId} and org_id = app_org() and ended_at is null`)
  if (!r.rowCount) throw new Error('That session has already ended')
  await tx.execute(sql`insert into audit_logs (user_id, branch_id, action, entity, entity_id) values (${actor.userId}, ${actor.branchId}, 'support_end', 'support_session', ${sessionId})`)
}
