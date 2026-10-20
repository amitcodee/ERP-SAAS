export const dynamic = 'force-dynamic'
import { Screen } from '@/components/screen'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { cachedCatalogs } from '@/modules/catalog/service'
import { leadProgress, listTelecallers } from '@/modules/leads/service'

export default async function Page() {
  const b = await requirePage('Lead Distribution')
  const d = await withTenant(b.actor, async (tx) => ({ telecallers: await listTelecallers(tx, b.actor), progress: await leadProgress(tx, b.actor), categories: (await cachedCatalogs(tx, b.actor.orgId)).leadCategories }))
  return <Screen name="leads" props={{ telecallers: d.telecallers, progress: d.progress, categories: d.categories, branches: b.branches.map((x) => ({ id: x.id, code: x.code, name: x.name })), isSuper: b.isSuper }} />
}
