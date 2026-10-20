export const dynamic = 'force-dynamic'
import { redirect } from 'next/navigation'
import { sql } from 'drizzle-orm'
import { OldImport } from '@/components/old-import'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { peekRegNo } from '@/lib/numbering'

// Administration / Old System Import (head office): each branch with its number format, the next new number and how
// many old students are already in, for the import screen.
export default async function Page() {
  const b = await requirePage('Old System Import')
  if (!b.isSuper) redirect('/dashboard')
  const branches = await withTenant(b.actor, async (tx) => {
    const rows = (await tx.execute<{ id: string; code: string; name: string; reg_format: string | null; imported: number }>(sql`
      select b.id, b.code, b.name, b.reg_format, (select count(*)::int from registrations r where r.branch_id = b.id and r.legacy_data is not null) as imported
      from branches b order by b.name`)).rows
    return Promise.all(rows.map(async (r) => ({ id: r.id, code: r.code, name: r.name, regFormat: r.reg_format, imported: r.imported, next: r.reg_format ? await peekRegNo(tx, r.id, r.code) : null })))
  })
  return <OldImport branches={branches} />
}
