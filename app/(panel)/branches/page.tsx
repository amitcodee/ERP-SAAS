export const dynamic = 'force-dynamic'
import { Screen } from '@/components/screen'
import { mayGrant } from '@/lib/auth/permissions'
import { requirePage } from '@/lib/panel/base'
import { sql } from 'drizzle-orm'
import { withTenant } from '@/lib/db/withTenant'
import { listZones } from '@/modules/branches/zones'

export default async function Page() {
  const b = await requirePage('Branches')
  const { actor, isSuper } = b
  const roles = b.roleRows.map((r) => ({ key: r.key, name: r.name, kind: r.kind, description: r.description, grantable: mayGrant({ isSuper, perms: actor.perms ?? [] }, r) }))
  // head office: the zones, each branch's zone and the staff who could manage one
  const zoning = isSuper ? await withTenant(actor, async (tx) => ({
    zones: await listZones(tx, actor),
    branches: (await tx.execute<{ id: string; name: string; code: string; zoneId: string | null }>(sql`select id, name, code, zone_id as "zoneId" from branches where is_active order by name`)).rows,
    staff: (await tx.execute<{ id: string; name: string; home: string }>(sql`
      select u.id, u.name, b.name as home from users u join branches b on b.id = u.branch_id
      where u.is_active and u.deleted_at is null and not exists (select 1 from user_roles r where r.user_id = u.id and r.role = 'student') order by u.name limit 500`)).rows,
  })) : null
  return <Screen name="branches" props={{ branches: b.branches, roles, zoning }} />
}
