// Roles & permissions administration. Only a super admin (role:update) changes roles; RLS on `roles` enforces it too.
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { ALL_PERMS, assertCan, withRequired } from '@/lib/auth/permissions'
import { roles, userRoles } from '@/lib/db/schema'
import type { Actor, Tx } from '@/lib/db/withTenant'

export type RoleRow = { key: string; name: string; description: string | null; kind: string; locked: boolean; isSystem: boolean; permissions: string[]; users: number }

export async function listRoles(tx: Tx): Promise<RoleRow[]> {
  const res = await tx.execute<{ key: string; name: string; description: string | null; kind: string; locked: boolean; is_system: boolean; permissions: string[]; users: number }>(sql`
    select r.key, r.name, r.description, r.kind, r.locked, r.is_system, r.permissions,
      (select count(*)::int from user_roles ur join users u on u.id = ur.user_id where ur.role = r.key and u.deleted_at is null and u.is_active) as users
    from roles r order by r.is_system desc, r.name`)
  return res.rows.map((r) => ({ key: r.key, name: r.name, description: r.description, kind: r.kind, locked: r.locked, isSystem: r.is_system, permissions: r.permissions, users: Number(r.users) }))
}

const VALID = new Set<string>(ALL_PERMS)
export const saveRoleInput = z.object({
  key: z.string().optional().nullable(), // absent = create a new role
  name: z.string().trim().min(2, 'Role name is required').max(60),
  description: z.string().trim().max(300).optional().nullable(),
  permissions: z.array(z.string()).refine((ps) => ps.every((p) => VALID.has(p)), 'Unknown permission'),
})
export type SaveRoleInput = z.input<typeof saveRoleInput>

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'r_$1').slice(0, 40)

export async function saveRole(tx: Tx, actor: Actor, raw: SaveRoleInput) {
  assertCan(actor, 'update', 'role')
  const input = saveRoleInput.parse(raw)
  const perms = withRequired(input.permissions).sort()
  if (input.key) {
    const [r] = await tx.select().from(roles).where(eq(roles.key, input.key))
    if (!r) throw new Error('Role not found')
    if (r.locked) throw new Error(`${r.name} cannot be changed`)
    await tx.update(roles).set({ name: input.name, description: input.description ?? null, permissions: perms, updatedAt: new Date() }).where(eq(roles.key, r.key))
    await audit(tx, actor, { action: 'update', entity: 'role', entityId: r.key, before: { name: r.name, permissions: r.permissions }, after: { name: input.name, permissions: perms } })
    return r.key
  }
  let key = slug(input.name)
  if (key.length < 2) throw new Error('Use letters in the role name')
  const taken = new Set((await tx.select({ key: roles.key }).from(roles)).map((r) => r.key))
  for (let n = 2; taken.has(key); n++) key = `${slug(input.name).slice(0, 36)}_${n}`
  const [byName] = await tx.select().from(roles).where(sql`lower(${roles.name}) = lower(${input.name})`)
  if (byName) throw new Error(`A role called "${byName.name}" already exists`)
  await tx.insert(roles).values({ key, name: input.name, description: input.description ?? null, kind: 'staff', permissions: perms })
  await audit(tx, actor, { action: 'create', entity: 'role', entityId: key, after: { name: input.name, permissions: perms } })
  return key
}

/** Custom roles only, and only when nobody holds them. */
export async function deleteRole(tx: Tx, actor: Actor, key: string) {
  assertCan(actor, 'update', 'role')
  const [r] = await tx.select().from(roles).where(eq(roles.key, key))
  if (!r) throw new Error('Role not found')
  if (r.isSystem || r.locked) throw new Error('Built-in roles cannot be deleted (you can change their permissions)')
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(userRoles).where(eq(userRoles.role, key))
  if (n) throw new Error(`${n} user(s) still have this role. Remove it from them first`)
  await tx.delete(roles).where(eq(roles.key, key))
  await audit(tx, actor, { action: 'delete', entity: 'role', entityId: key, before: { name: r.name, permissions: r.permissions } })
}
