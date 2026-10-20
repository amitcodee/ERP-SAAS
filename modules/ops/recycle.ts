// Recycle Bin. Deleting keeps the record hidden for 30 days (Administration → Recycle Bin, head office), where it can
// be restored or removed for good; the daily "purge" job removes what is older. Hidden by the database: random calls,
// leads, registrations and website leads (policy not_deleted); hidden by the screens: courses, batches and staff,
// whose names older records still show, so those are never removed for good (only kept hidden).
// Removing for good deletes the item's own rows (its history, installments, documents...) and lets go of links from
// other records. It refuses anything that has money or a certificate behind it: payments, receipts and issued
// certificates are never deleted.
// The owner's connection skips row-level security (a superuser) or sees no org (not one), so every owner transaction
// here names its org (app.org_id) and filters by it. The child rows removed with an item are found through its
// foreign keys, which are org-bound (0095: every key has an (org_id, col) companion), so they are the same org's.
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { assertCan, can } from '@/lib/auth/permissions'
import { ownerDb as db } from '@/lib/db/client' // owner: TRUNCATE / purge (see lib/db/client.ts)
import type { Actor, Tx } from '@/lib/db/withTenant'
import { log } from '@/lib/log'
import { assertBranchMayChange } from '@/modules/users/service'

export const KEEP_DAYS = 30
export const KINDS = {
  call: { table: 'calls', label: 'Random call', purge: true },
  lead: { table: 'enquiries', label: 'Lead / enquiry', purge: true },
  web_lead: { table: 'web_leads', label: 'Website lead', purge: true },
  registration: { table: 'registrations', label: 'Registration', purge: true },
  course: { table: 'courses', label: 'Course', purge: false },
  batch: { table: 'batches', label: 'Batch', purge: false },
  user: { table: 'users', label: 'Staff login', purge: false },
} as const
export type Kind = keyof typeof KINDS
const PROTECTED = ['payments', 'receipts', 'certificates', 'audit_logs']
const uuid = z.string().uuid()

/** Lets the statement see (and change) rows that are in the bin. */
async function showDeleted(tx: Tx, on: boolean) {
  await tx.execute(sql`select set_config('app.show_deleted', ${on ? 'on' : ''}, true)`)
}
async function softDelete(tx: Tx, actor: Actor, kind: Kind, id: string, before: Record<string, unknown>, extra = sql``) {
  await showDeleted(tx, true)
  await tx.execute(sql`update ${sql.raw(KINDS[kind].table)} set deleted_at = now(), deleted_by = ${actor.userId} ${extra} where id = ${id}`)
  await showDeleted(tx, false)
  await audit(tx, actor, { action: 'delete', entity: kind, entityId: id, before })
}

// ---- deleting

/** A registration with no payment. One with payments is discontinued instead (receipts must stay complete). */
export async function deleteRegistration(tx: Tx, actor: Actor, rawId: string) {
  assertCan(actor, 'delete', 'registration')
  const id = uuid.parse(rawId)
  const [r] = (await tx.execute<{ reg_no: string; paid: number; cert: number }>(sql`
    select r.reg_no, (select count(*)::int from payments p where p.registration_id = r.id) as paid,
      (select count(*)::int from certificates c where c.registration_id = r.id) as cert
    from registrations r where r.id = ${id} for update`)).rows
  if (!r) throw new Error('Registration not found')
  if (r.paid) throw new Error('This registration has payments, so it cannot be deleted: discontinue it instead (its receipts stay)')
  if (r.cert) throw new Error('A certificate was issued for this registration, so it cannot be deleted')
  await softDelete(tx, actor, 'registration', id, { regNo: r.reg_no })
}

export async function deleteCourse(tx: Tx, actor: Actor, rawId: string) {
  assertCan(actor, 'update', 'catalog')
  const id = uuid.parse(rawId)
  const [c] = (await tx.execute<{ title: string }>(sql`select title from courses where id = ${id}`)).rows
  if (!c) throw new Error('Course not found')
  await softDelete(tx, actor, 'course', id, { title: c.title }, sql`, is_active = false`)
}

export async function deleteBatch(tx: Tx, actor: Actor, rawId: string) {
  assertCan(actor, 'update', 'batch')
  const id = uuid.parse(rawId)
  const [b] = (await tx.execute<{ name: string }>(sql`select name from batches where id = ${id}`)).rows
  if (!b) throw new Error('Batch not found')
  await softDelete(tx, actor, 'batch', id, { name: b.name }, sql`, is_active = false`)
}

/** A staff login: signed out at once and hidden. Head office logins only by head office; never one's own. */
export async function deleteUser(tx: Tx, actor: Actor, rawId: string) {
  assertCan(actor, 'update', 'user')
  const id = uuid.parse(rawId)
  if (id === actor.userId) throw new Error('You cannot delete your own login')
  const [u] = (await tx.execute<{ name: string; email: string; ho: boolean }>(sql`
    select name, email, exists (select 1 from user_roles r where r.user_id = users.id and r.role = 'super_admin') as ho from users where id = ${id} and deleted_at is null`)).rows
  if (!u) throw new Error('User not found')
  if (u.ho && actor.role !== 'super_admin') throw new Error('Only head office can delete a head-office login')
  await assertBranchMayChange(tx, actor, id)
  await softDelete(tx, actor, 'user', id, { name: u.name, email: u.email }, sql`, is_active = false`)
}

/** A website lead not yet made a lead in a branch. */
export async function deleteWebLeadSoft(tx: Tx, actor: Actor, rawId: string) {
  assertCan(actor, 'assign', 'weblead')
  const id = uuid.parse(rawId)
  const [w] = (await tx.execute<{ name: string; site_host: string; enquiry_id: string | null }>(sql`select name, site_host, enquiry_id from web_leads where id = ${id} for update`)).rows
  if (!w) throw new Error('Website lead not found')
  if (w.enquiry_id) throw new Error('It is already a lead in a branch. Delete the lead there instead.')
  await softDelete(tx, actor, 'web_lead', id, { name: w.name, site: w.site_host })
}

// ---- the bin

export type BinRow = { kind: Kind; id: string; title: string; detail: string | null; branch: string | null; deletedAt: string; deletedBy: string | null; daysLeft: number; purge: boolean }

/** Head office sees (and restores) every branch's deleted records; anyone else given the Recycle Bin, their own branch's. */
const headOffice = (actor: Actor) => actor.role === 'super_admin'

/** The branch a deleted record belongs to (a course belongs to every branch: null). Read as owner, so deleted rows show. */
async function itemBranch(orgId: string, kind: Kind, id: string): Promise<string | null> {
  if (kind === 'course') return null
  const [r] = (await db.execute<{ branch_id: string | null }>(sql`select branch_id from ${sql.raw(KINDS[kind].table)} where id = ${id} and org_id = ${orgId}`)).rows
  return r?.branch_id ?? null
}
async function assertMayTouch(actor: Actor, kind: Kind, id: string) {
  if (headOffice(actor)) return
  const branch = await itemBranch(actor.orgId, kind, id)
  if (!actor.branchId || branch !== actor.branchId) throw new Error('Only head office can restore or delete this: it is not your branch’s')
}

/** Everything deleted in the last 30 days, newest first (head office: every branch; others: their own branch). */
export async function listRecycle(tx: Tx, actor: Actor): Promise<BinRow[]> {
  assertCan(actor, 'read', 'recycle')
  await showDeleted(tx, true)
  const PERSON = sql`trim(p.first_name || ' ' || coalesce(p.last_name, ''))`
  const all = headOffice(actor)
  const fresh = (col: string, branchCol: string | null) => sql.raw(`${col} > now() - interval '${KEEP_DAYS} days'`
    + (all ? '' : branchCol ? ` and ${branchCol} = '${actor.branchId ?? '00000000-0000-0000-0000-000000000000'}'::uuid` : ' and false'))
  const rows = (await tx.execute<{ kind: Kind; id: string; title: string; detail: string | null; branch: string | null; deleted_at: string; deleted_by: string | null }>(sql`
    select 'call' as kind, k.id, ${PERSON} as title, p.phone as detail, b.name as branch, k.deleted_at, u.name as deleted_by
      from calls k left join persons p on p.id = k.person_id left join branches b on b.id = k.branch_id left join users u on u.id = k.deleted_by where ${fresh('k.deleted_at', 'k.branch_id')}
    union all
    select 'lead', e.id, ${PERSON} || ' · ' || e.enquiry_no, p.phone, b.name, e.deleted_at, u.name
      from enquiries e join persons p on p.id = e.person_id left join branches b on b.id = e.branch_id left join users u on u.id = e.deleted_by where ${fresh('e.deleted_at', 'e.branch_id')}
    union all
    select 'web_lead', w.id, w.name, coalesce(w.phone, '') || ' · ' || w.site_host, b.name, w.deleted_at, u.name
      from web_leads w left join branches b on b.id = w.branch_id left join users u on u.id = w.deleted_by where ${fresh('w.deleted_at', 'w.branch_id')}
    union all
    select 'registration', r.id, ${PERSON} || ' · ' || r.reg_no, coalesce(c.title, r.custom_course_title), b.name, r.deleted_at, u.name
      from registrations r join persons p on p.id = r.person_id left join courses c on c.id = r.course_id left join branches b on b.id = r.branch_id left join users u on u.id = r.deleted_by where ${fresh('r.deleted_at', 'r.branch_id')}
    union all
    select 'course', c.id, c.title, d.name, null, c.deleted_at, u.name
      from courses c left join departments d on d.id = c.department_id left join users u on u.id = c.deleted_by where ${fresh('c.deleted_at', null)}
    union all
    select 'batch', bt.id, bt.name, null, b.name, bt.deleted_at, u.name
      from batches bt left join branches b on b.id = bt.branch_id left join users u on u.id = bt.deleted_by where ${fresh('bt.deleted_at', 'bt.branch_id')}
    union all
    select 'user', x.id, x.name, x.email, b.name, x.deleted_at, u.name
      from users x left join branches b on b.id = x.branch_id left join users u on u.id = x.deleted_by where ${fresh('x.deleted_at', 'x.branch_id')}
    order by 6 desc limit 1000`)).rows
  await showDeleted(tx, false)
  return rows.map((r) => ({
    kind: r.kind, id: r.id, title: r.title, detail: r.detail, branch: r.branch, deletedBy: r.deleted_by, deletedAt: new Date(r.deleted_at).toISOString(), purge: KINDS[r.kind].purge,
    daysLeft: Math.max(0, KEEP_DAYS - Math.floor((Date.now() - new Date(r.deleted_at).getTime()) / 864e5)),
  }))
}

export async function restoreItem(tx: Tx, actor: Actor, kind: Kind, rawId: string) {
  assertCan(actor, 'update', 'recycle')
  if (!Object.hasOwn(KINDS, kind)) throw new Error('Unknown item')
  const id = uuid.parse(rawId)
  await assertMayTouch(actor, kind, id)
  await showDeleted(tx, true)
  const extra = kind === 'course' || kind === 'batch' || kind === 'user' ? sql`, is_active = true` : sql``
  const res = await tx.execute(sql`update ${sql.raw(KINDS[kind].table)} set deleted_at = null, deleted_by = null ${extra} where id = ${id} and deleted_at is not null returning id`)
  await showDeleted(tx, false)
  if (!res.rows.length) throw new Error('This item is no longer in the Recycle Bin')
  await audit(tx, actor, { action: 'restore', entity: kind, entityId: id })
}

// ---- removing for good

type Ref = { child: string; col: string; nullable: boolean }
let refsCache: Map<string, Ref[]> | null = null
async function refsTo(tx: Tx, table: string): Promise<Ref[]> {
  if (!refsCache) {
    refsCache = new Map()
    const rows = (await tx.execute<{ parent: string; child: string; col: string; nullable: boolean }>(sql`
      select c.confrelid::regclass::text as parent, c.conrelid::regclass::text as child, a.attname as col, not a.attnotnull as nullable
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace and array_length(c.conkey, 1) = 1`)).rows
    for (const r of rows) refsCache.set(r.parent, [...(refsCache.get(r.parent) ?? []), { child: r.child, col: r.col, nullable: r.nullable }])
  }
  return refsCache.get(table) ?? []
}

/** Deletes rows of `table` with these ids: first their own child rows (or the link, when it may be empty). */
async function removeRows(tx: Tx, table: string, ids: string[], depth: number) {
  if (!ids.length) return
  if (depth > 6) throw new Error(`Too deep at ${table}`)
  const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)
  for (const ref of await refsTo(tx, table)) {
    const child = ref.child.replace(/"/g, '')
    if (child === table) continue
    const rows = (await tx.execute<{ id: string }>(sql`select ${sql.raw(['batch_members', 'attendance', 'user_roles', 'user_branches'].includes(child) ? 'ctid::text' : 'id::text')} as id from ${sql.raw(ref.child)} where ${sql.raw(`"${ref.col}"`)} in (${list})`)).rows
    if (!rows.length) continue
    if (PROTECTED.includes(child)) throw new Error(`it has ${child.replace(/_/g, ' ')}`)
    if (ref.nullable) await tx.execute(sql`update ${sql.raw(ref.child)} set ${sql.raw(`"${ref.col}"`)} = null where ${sql.raw(`"${ref.col}"`)} in (${list})`)
    else if (['batch_members', 'attendance', 'user_roles', 'user_branches'].includes(child)) await tx.execute(sql`delete from ${sql.raw(ref.child)} where ${sql.raw(`"${ref.col}"`)} in (${list})`)
    else await removeRows(tx, child, rows.map((r) => r.id), depth + 1)
  }
  await tx.execute(sql`delete from ${sql.raw(`"${table}"`)} where id in (${list})`)
}

/** Removes one bin item for good. Runs on the server's own connection, with history deletes allowed for this item only. */
async function purgeOne(orgId: string, kind: Kind, id: string): Promise<string | null> {
  if (!KINDS[kind].purge) return 'kept hidden (older records still show it)'
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${orgId}, true), set_config('app.is_super', 'true', true), set_config('app.role', 'system', true), set_config('app.show_deleted', 'on', true), set_config('app.purging', 'on', true)`)
      const [row] = (await tx.execute(sql`select 1 from ${sql.raw(KINDS[kind].table)} where id = ${id} and org_id = ${orgId} and deleted_at is not null`)).rows
      if (!row) throw new Error('not in the Recycle Bin')
      await removeRows(tx as unknown as Tx, KINDS[kind].table, [id], 0)
    })
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/** "Delete for good" from the Recycle Bin. */
export async function purgeItem(actor: Actor, kind: Kind, rawId: string) {
  if (!can(actor, 'delete', 'recycle')) throw new Error('Forbidden: delete for good')
  if (!Object.hasOwn(KINDS, kind)) throw new Error('Unknown item')
  const id = uuid.parse(rawId)
  await assertMayTouch(actor, kind, id)
  const why = await purgeOne(actor.orgId, kind, id)
  if (why) throw new Error(`Could not delete for good: ${why}`)
  await db.transaction(async (tx) => { await tx.execute(sql`insert into audit_logs (org_id, user_id, action, entity, entity_id) values (${actor.orgId}, ${actor.userId}, 'purge', ${kind}, ${id})`) })
}

/** The daily job (per org): removes for good what has been in the org's bin for more than 30 days. */
export async function purgeExpired(orgId: string) {
  const due = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true), set_config('app.is_super', 'true', true), set_config('app.show_deleted', 'on', true)`)
    const out: { kind: Kind; id: string }[] = []
    for (const [kind, k] of Object.entries(KINDS) as [Kind, (typeof KINDS)[Kind]][]) {
      if (!k.purge) continue
      const rows = (await tx.execute<{ id: string }>(sql`select id::text from ${sql.raw(k.table)} where org_id = ${orgId} and deleted_at < now() - make_interval(days => ${KEEP_DAYS}) limit 500`)).rows
      out.push(...rows.map((r) => ({ kind, id: r.id })))
    }
    return out
  })
  let removed = 0
  const kept: string[] = []
  for (const d of due) {
    const why = await purgeOne(orgId, d.kind, d.id)
    if (why) { kept.push(`${d.kind} ${d.id.slice(0, 8)}: ${why}`); log.warn('recycle.purge_skipped', { ...d, why }) } else removed++
  }
  return { ok: true, summary: { due: due.length, removed, kept: kept.length, notes: kept.slice(0, 20).join('; ') || null } }
}
