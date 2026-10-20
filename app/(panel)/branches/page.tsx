export const dynamic = 'force-dynamic'
import { Screen } from '@/components/screen'
import { mayGrant } from '@/lib/auth/permissions'
import { requirePage } from '@/lib/panel/base'

export default async function Page() {
  const b = await requirePage('Branches')
  const { actor, isSuper } = b
  const roles = b.roleRows.map((r) => ({ key: r.key, name: r.name, kind: r.kind, description: r.description, grantable: mayGrant({ isSuper, perms: actor.perms ?? [] }, r) }))
  return <Screen name="branches" props={{ branches: b.branches, roles }} />
}
