export const dynamic = 'force-dynamic'
import { Screen } from '@/components/screen'
import { requirePage } from '@/lib/panel/base'

export default async function Page() {
  const b = await requirePage('Roles & Permissions')
  return <Screen name="roles" props={{ roles: b.roleRows, canEdit: b.ok('update', 'role') }} />
}
