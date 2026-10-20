export const dynamic = 'force-dynamic'
import { Screen } from '@/components/screen'
import { mayGrant } from '@/lib/auth/permissions'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { listUsers } from '@/modules/users/service'

export default async function Page() {
  const b = await requirePage('Users & Staff')
  const { actor, ok, isSuper } = b
  const staff = await withTenant(actor, (tx) => listUsers(tx, actor))
  return <Screen name="users" props={{
    rows: staff, branches: b.branches, isSuper, canCreate: ok('create', 'user'), canEdit: ok('update', 'user'), canBranches: ok('update', 'branch'), currentUserId: actor.userId, actingBranchId: actor.branchId,
    roles: b.roleRows.map((r) => ({ key: r.key, name: r.name, kind: r.kind, description: r.description, grantable: mayGrant({ isSuper, perms: actor.perms ?? [] }, r) })),
  }} />
}
