export const dynamic = 'force-dynamic'
import { Screen } from '@/components/screen'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { canAddCourse, listCourses, cachedCatalogs } from '@/modules/catalog/service'
import { canEditSyllabus, listSyllabusChanges } from '@/modules/teaching/service'

export default async function Page() {
  const { actor, ok, isSuper } = await requirePage('Courses')
  const d = await withTenant(actor, async (tx) => ({ courses: await listCourses(tx, actor), catalogs: await cachedCatalogs(tx, actor.orgId), changes: await listSyllabusChanges(tx, actor) }))
  // a branch admin adds courses too; they wait for head office (isSuper) to approve them
  return <Screen name="courses" props={{ rows: d.courses, catalogs: d.catalogs, canCreate: canAddCourse(actor), canEdit: ok('update', 'catalog'), isSuper, canSyllabus: canEditSyllabus(actor), syllabusChanges: d.changes }} />
}
