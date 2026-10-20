export const dynamic = 'force-dynamic'
import { CourseCategoriesPanel } from '@/components/course-categories-panel'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { canRequestCategory, listCategories } from '@/modules/catalog/categories'

// Management / Course Categories: categories with their head and signature; branch admins ask, head office approves.
export default async function Page() {
  const { actor, isSuper } = await requirePage('Course Categories')
  const rows = await withTenant(actor, (tx) => listCategories(tx, actor))
  return <CourseCategoriesPanel rows={rows} isSuper={isSuper} canAdd={canRequestCategory(actor) && (isSuper || !!actor.branchId)} />
}
