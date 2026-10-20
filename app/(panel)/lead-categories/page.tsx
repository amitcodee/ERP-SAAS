export const dynamic = 'force-dynamic'
import { Screen } from '@/components/screen'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { leadCategoryCounts } from '@/modules/catalog/service'

// Lead categories: head office keeps the list; everyone sees how many calls, leads and visited enquiries are in each.
export default async function Page() {
  const b = await requirePage('Lead Categories')
  const categories = await withTenant(b.actor, (tx) => leadCategoryCounts(tx))
  return <Screen name="leadCategories" props={{ categories, canEdit: b.isSuper && b.ok('update', 'catalog') }} />
}
