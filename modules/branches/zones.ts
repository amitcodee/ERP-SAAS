// Zones (regions) above branches (Branches → Zones, head office): a zone groups branches and has zonal managers, who
// work in every branch of their zone with full access, as their roles allow (user_branches rows marked via_zone; the
// branch picker lists them). Putting a branch in a zone, or a manager on it, gives the access; taking the branch out,
// the manager off, or deleting the zone takes away only what the zone gave: a branch head office had already shared
// with that person keeps the access head office set.
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { assertCan } from '@/lib/auth/permissions'
import type { Actor, Tx } from '@/lib/db/withTenant'

export type ZoneRow = { id: string; name: string; branches: { id: string; name: string; code: string }[]; managers: { userId: string; name: string; email: string; home: string | null }[] }

const uuid = z.string().uuid()
const zoneName = z.string().trim().min(1, 'Name the zone').max(80, 'At most 80 characters')
const headOffice = (actor: Actor) => {
  assertCan(actor, 'update', 'branch')
  if (actor.role !== 'super_admin') throw new Error('Only head office sets up zones')
}

/** Every zone with its branches and managers. */
export async function listZones(tx: Tx, actor: Actor): Promise<ZoneRow[]> {
  assertCan(actor, 'read', 'branch')
  const zones = (await tx.execute<{ id: string; name: string }>(sql`select id, name from zones order by lower(name)`)).rows
  if (!zones.length) return []
  const branches = (await tx.execute<{ zone_id: string; id: string; name: string; code: string }>(sql`select zone_id, id, name, code from branches where zone_id is not null order by name`)).rows
  const managers = (await tx.execute<{ zone_id: string; user_id: string; name: string; email: string; home: string | null }>(sql`
    select m.zone_id, m.user_id, u.name, u.email, b.name as home from zone_managers m join users u on u.id = m.user_id left join branches b on b.id = u.branch_id order by u.name`)).rows
  return zones.map((zn) => ({
    id: zn.id, name: zn.name,
    branches: branches.filter((b) => b.zone_id === zn.id).map((b) => ({ id: b.id, name: b.name, code: b.code })),
    managers: managers.filter((m) => m.zone_id === zn.id).map((m) => ({ userId: m.user_id, name: m.name, email: m.email, home: m.home })),
  }))
}

export async function createZone(tx: Tx, actor: Actor, rawName: string) {
  headOffice(actor)
  const name = zoneName.parse(rawName)
  const [dup] = (await tx.execute(sql`select 1 from zones where lower(name) = lower(${name})`)).rows
  if (dup) throw new Error(`There is a zone called ${name} already`)
  const [row] = (await tx.execute<{ id: string }>(sql`insert into zones (name) values (${name}) returning id`)).rows
  await audit(tx, actor, { action: 'create', entity: 'zone', entityId: row.id, after: { name } })
  return row.id
}

export async function renameZone(tx: Tx, actor: Actor, zoneId: string, rawName: string) {
  headOffice(actor)
  const name = zoneName.parse(rawName)
  const [dup] = (await tx.execute(sql`select 1 from zones where lower(name) = lower(${name}) and id <> ${uuid.parse(zoneId)}`)).rows
  if (dup) throw new Error(`There is a zone called ${name} already`)
  const r = await tx.execute(sql`update zones set name = ${name} where id = ${zoneId}`)
  if (!r.rowCount) throw new Error('Zone not found')
  await audit(tx, actor, { action: 'update', entity: 'zone', entityId: zoneId, after: { name } })
}

/** The zone goes; its branches stay (in no zone) and its managers lose what the zone gave them. */
export async function deleteZone(tx: Tx, actor: Actor, zoneId: string) {
  headOffice(actor)
  await tx.execute(sql`delete from user_branches where via_zone = ${uuid.parse(zoneId)}`)
  await tx.execute(sql`update branches set zone_id = null where zone_id = ${zoneId}`)
  const r = await tx.execute(sql`delete from zones where id = ${zoneId}`)
  if (!r.rowCount) throw new Error('Zone not found')
  await audit(tx, actor, { action: 'delete', entity: 'zone', entityId: zoneId })
}

/** Gives a manager a branch of their zone (full access), unless it is their home or they were shared into it already. */
async function grant(tx: Tx, userId: string, branchId: string, zoneId: string) {
  await tx.execute(sql`insert into user_branches (user_id, branch_id, access, via_zone)
    select ${userId}, ${branchId}, 'full', ${zoneId} where not exists (select 1 from users where id = ${userId} and branch_id = ${branchId})
    on conflict (user_id, branch_id) do nothing`)
}

/** Puts a branch in a zone (or in none): the zone's managers get it, the old zone's lose it. */
export async function setBranchZone(tx: Tx, actor: Actor, branchId: string, zoneId: string | null) {
  headOffice(actor)
  const [b] = (await tx.execute<{ zone_id: string | null }>(sql`select zone_id from branches where id = ${uuid.parse(branchId)}`)).rows
  if (!b) throw new Error('Branch not found')
  if (zoneId) {
    const [zn] = (await tx.execute(sql`select 1 from zones where id = ${uuid.parse(zoneId)}`)).rows
    if (!zn) throw new Error('Zone not found')
  }
  if (b.zone_id === (zoneId ?? null)) return
  if (b.zone_id) await tx.execute(sql`delete from user_branches where branch_id = ${branchId} and via_zone = ${b.zone_id}`)
  await tx.execute(sql`update branches set zone_id = ${zoneId} where id = ${branchId}`)
  if (zoneId) for (const m of (await tx.execute<{ user_id: string }>(sql`select user_id from zone_managers where zone_id = ${zoneId}`)).rows) await grant(tx, m.user_id, branchId, zoneId)
  await audit(tx, actor, { action: 'set_zone', entity: 'branch', entityId: branchId, before: { zoneId: b.zone_id }, after: { zoneId } })
}

/** Makes a staff member a manager of the zone: they work in each of its branches. */
export async function addZoneManager(tx: Tx, actor: Actor, zoneId: string, userId: string) {
  headOffice(actor)
  const [zn] = (await tx.execute(sql`select 1 from zones where id = ${uuid.parse(zoneId)}`)).rows
  if (!zn) throw new Error('Zone not found')
  const [u] = (await tx.execute<{ name: string; branch_id: string | null; student: boolean }>(sql`
    select name, branch_id, exists (select 1 from user_roles r where r.user_id = u.id and r.role = 'student') as student
    from users u where id = ${uuid.parse(userId)} and is_active and deleted_at is null`)).rows
  if (!u) throw new Error('Choose an active staff member')
  if (u.student) throw new Error('A student login cannot manage a zone')
  if (!u.branch_id) throw new Error(`${u.name} works at head office and sees every branch already`)
  await tx.execute(sql`insert into zone_managers (zone_id, user_id) values (${zoneId}, ${userId}) on conflict do nothing`)
  for (const b of (await tx.execute<{ id: string }>(sql`select id from branches where zone_id = ${zoneId}`)).rows) await grant(tx, userId, b.id, zoneId)
  await audit(tx, actor, { action: 'add_manager', entity: 'zone', entityId: zoneId, after: { userId } })
  return { name: u.name }
}

export async function removeZoneManager(tx: Tx, actor: Actor, zoneId: string, userId: string) {
  headOffice(actor)
  await tx.execute(sql`delete from zone_managers where zone_id = ${uuid.parse(zoneId)} and user_id = ${uuid.parse(userId)}`)
  await tx.execute(sql`delete from user_branches where user_id = ${userId} and via_zone = ${zoneId}`)
  await audit(tx, actor, { action: 'remove_manager', entity: 'zone', entityId: zoneId, before: { userId } })
}
