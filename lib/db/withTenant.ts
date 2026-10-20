import { sql } from 'drizzle-orm'
import { dropCache } from '../cache'
import { db } from './client'
import type { Role } from './schema'

export type Actor = {
  userId: string
  orgId: string // the organisation (institute) the person belongs to: the database shows only its rows
  role: Role
  branchId: string | null // null only for super_admin (the org's head office)
  personId?: string | null // set for student logins: the database then only shows that person's rows
  ownOnly?: boolean // working in a second branch for their own work only: the database shows only their own work there
  roles?: string[] // every role the person holds
  perms?: string[] // live union of those roles' permissions; when absent, the default role definitions apply
  readOnly?: boolean // the org is read-only (billing) or this is a read-only support session: the database refuses writes
  impersonatorId?: string | null // a platform admin working in the org through a support session
}

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Every business query runs through here. Inside one transaction we drop to the
 * non-superuser `techcadd_app` role (so RLS is enforced even if the login role
 * owns the tables) and publish who is asking. RLS policies read these settings:
 * app.org_id keeps organisations apart (a RESTRICTIVE policy on every tenant table),
 * the rest decide branches and people inside the org.
 */
/** Applies the tenant context to an open transaction. Exported so tests use the exact production path. */
export async function applyTenant(tx: Tx, actor: Actor) {
  if (!actor.orgId) throw new Error('withTenant: the actor needs an orgId')
  const isSuper = actor.role === 'super_admin'
  if (!isSuper && !actor.branchId) throw new Error('withTenant: non-super actor needs a branchId')
  await tx.execute(sql`set local role techcadd_app`)
  await tx.execute(sql`select
    set_config('app.org_id', ${actor.orgId}, true),
    set_config('app.read_only', ${actor.readOnly ? 'true' : 'false'}, true),
    set_config('app.platform', 'false', true),
    set_config('app.user_id', ${actor.userId}, true),
    set_config('app.role', ${actor.role}, true),
    set_config('app.branch_id', ${actor.branchId ?? ''}, true),
    set_config('app.is_super', ${isSuper ? 'true' : 'false'}, true),
    set_config('app.person_id', ${actor.personId ?? ''}, true),
    set_config('app.own_only', ${actor.ownOnly ? 'true' : 'false'}, true)`)
}

/** True when this transaction has written anything (it was given a transaction id). */
const wrote = async (tx: Tx) => (await tx.execute<{ w: boolean }>(sql`select txid_current_if_assigned() is not null as w`)).rows[0]?.w === true

/**
 * Runs `fn` in a transaction; once one that wrote commits, the org's entries in the shared cache (lib/cache.ts) are
 * emptied (no org, a platform write: every org's).
 */
async function inTransaction<T>(orgId: string | undefined, setup: (tx: Tx) => Promise<void>, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let changed = false
  const out = await db.transaction(async (tx) => {
    await setup(tx)
    const r = await fn(tx)
    changed = await wrote(tx)
    return r
  })
  if (changed) dropCache(orgId)
  return out
}

export async function withTenant<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction(actor.orgId, (tx) => applyTenant(tx, actor), fn)
}

/** Applies the system context of one org to an open transaction (see withOrgSystem). */
export async function applyOrgSystem(tx: Tx, orgId: string) {
  if (!orgId) throw new Error('withOrgSystem: an orgId is required')
  await tx.execute(sql`set local role techcadd_app`)
  await tx.execute(sql`select set_config('app.org_id', ${orgId}, true), set_config('app.is_super', 'true', true),
    set_config('app.role', 'system', true), set_config('app.read_only', 'false', true), set_config('app.platform', 'false', true)`)
}

/**
 * Work for ONE organisation that has no signed-in person behind it: sign-in before the session exists, public pages
 * resolved from the host (certificate checks, event sign-ups), and background jobs (run once per org). It sees the
 * whole org (every branch) and nothing outside it. Never call it from request handlers that act on behalf of a user.
 */
export async function withOrgSystem<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction(orgId, (tx) => applyOrgSystem(tx, orgId), fn)
}

/**
 * The platform's own tables (organisations, plans, platform users, support sessions). No org is set, so every tenant
 * table shows nothing: the platform cannot read an org's students this way.
 */
export async function withPlatform<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction(undefined, async (tx) => {
    await tx.execute(sql`set local role techcadd_app`)
    await tx.execute(sql`select set_config('app.platform', 'true', true), set_config('app.org_id', '', true), set_config('app.role', 'platform', true)`)
  }, fn)
}

/** The organisation an open transaction works in (from app.org_id). Throws outside any org. */
export async function txOrg(tx: Tx): Promise<string> {
  const [r] = (await tx.execute<{ o: string | null }>(sql`select app_org()::text as o`)).rows
  if (!r?.o) throw new Error('This needs an organisation context (withTenant / withOrgSystem)')
  return r.o
}
