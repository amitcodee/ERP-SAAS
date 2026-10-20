export const dynamic = 'force-dynamic'
import { sql } from 'drizzle-orm'
import { OverduesPanel } from '@/components/overdues-panel'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { overdues } from '@/modules/overdues/service'

// Overview / Overdues: leads past their follow-up date and fees past their installment date, escalated by days to the
// branch manager and head office. Tabs and filters live in the address: ?tab=&level=&age=&kind=&mine=&branch=&q=
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { actor, isSuper, ok } = await requirePage('Overdues')
  const sp = await searchParams
  const filters = { tab: sp.tab ?? '', level: sp.level ?? '', age: sp.age ?? '', kind: sp.kind ?? '', mine: sp.mine ?? '', branch: sp.branch ?? '', q: (sp.q ?? '').slice(0, 80) }
  const d = await withTenant(actor, async (tx) => ({
    data: await overdues(tx, actor, filters),
    branches: isSuper && !actor.branchId ? (await tx.execute<{ id: string; name: string }>(sql`select id, name from branches where status = 'active' order by name`)).rows : [],
  }))
  return <OverduesPanel data={d.data} filters={{ ...filters, tab: d.data.tab }} branches={d.branches} showBranch={isSuper && !actor.branchId} role={isSuper ? 'headOffice' : ok('read', 'overdue') ? 'manager' : null} />
}
