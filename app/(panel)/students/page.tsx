export const dynamic = 'force-dynamic'
import { Screen } from '@/components/screen'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { listBatches, listTrainers } from '@/modules/academics/service'
import { incomingTrainerRequests, outgoingTrainerRequests } from '@/modules/academics/trainer-requests'
import { cachedCatalogs } from '@/modules/catalog/service'
import { certificatePage } from '@/modules/certificates/service'
import { summaries } from '@/modules/reports/service'

// Students (certificates and documents, portal login, attendance calendar) and, as a second tab, Batches & attendance:
// batches, their trainer and students, marking attendance, grades and capstone sign-off.
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { actor, ok, needsBranch } = await requirePage('Students')
  const sp = await searchParams
  const seeStudents = ok('read', 'certificate')
  const seeBatches = ok('read', 'batch')
  const d = await withTenant(actor, async (tx) => {
    const catalogs = await cachedCatalogs(tx, actor.orgId)
    return {
      catalogs,
      certs: seeStudents ? await certificatePage(tx, actor, { limit: 25 }) : null,
      sums: seeStudents ? await summaries(tx, actor) : null,
      batches: seeBatches ? await listBatches(tx, actor) : null,
      trainers: seeBatches ? await listTrainers(tx) : [],
      requestsOut: seeBatches && ok('update', 'batch') ? await outgoingTrainerRequests(tx) : [],
      requestsIn: seeBatches ? await incomingTrainerRequests(tx, actor) : [],
    }
  })
  // those who mark attendance but do not admit students (trainers, academic managers) start on the batches
  const initialTab = sp.tab === 'batches' || (sp.tab !== 'students' && ok('create', 'attendance') && !ok('create', 'registration')) ? 'batches' : 'students'
  return <Screen name="students" props={{
    initialTab,
    list: d.certs && d.sums ? {
      rows: d.certs.rows, total: d.certs.total, summary: d.sums.students, departments: d.catalogs.departments,
      canCreateLogin: ok('create', 'user'), canSeeAttendance: ok('read', 'attendance'),
    } : null,
    batchesView: d.batches ? {
      batches: d.batches, catalogs: d.catalogs, trainers: d.trainers, canCreateBatch: ok('create', 'batch'), canAddMember: ok('update', 'batch') || ok('update', 'registration'), canMark: ok('create', 'attendance'), canApproveCapstone: ok('update', 'assessment'), needsBranch,
      canAskTrainer: ok('update', 'batch'), requestsOut: d.requestsOut, requestsIn: d.requestsIn,
    } : null,
  }} />
}
