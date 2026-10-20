export const dynamic = 'force-dynamic'
import { Screen } from '@/components/screen'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { listLogs, logFilters } from '@/modules/audit/service'
import { listDeleted } from '@/modules/enquiries/service'

// Logs: the audit trail (who did what, on which record, when). Read-only.
export default async function Page() {
  const { actor, isSuper, branches, ok } = await requirePage('Logs')
  const d = await withTenant(actor, async (tx) => ({ list: await listLogs(tx, actor, { limit: 25 }), filters: await logFilters(tx, actor), deleted: await listDeleted(tx, actor) }))
  return <Screen name="logs" props={{
    rows: d.list.rows, total: d.list.total, filters: d.filters,
    deleted: d.deleted, canRestore: { call: ok('delete', 'call'), lead: ok('delete', 'enquiry') },
    // Head office sees every branch's log, so it gets the branch column and a branch filter.
    branches: isSuper ? branches.map((b) => ({ id: b.id, code: b.code, name: b.name })) : [],
  }} />
}
