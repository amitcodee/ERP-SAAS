export const dynamic = 'force-dynamic'
import { redirect } from 'next/navigation'
import { SheetImport } from '@/components/sheet-import'
import { requirePage } from '@/lib/panel/base'
import { SHEET_COLUMNS, SHEET_KINDS } from '@/modules/import/sheet'

// Setup / Import: students, enquiries or staff from a spreadsheet, any time (modules/import/sheet.ts). Each person sees
// the kinds they may add on their own screens; head office picks the branch, branch staff import into theirs.
export default async function Page() {
  const b = await requirePage('Import')
  const kinds = SHEET_KINDS.filter((k) => (k === 'students' ? b.ok('create', 'registration') : k === 'enquiries' ? b.ok('create', 'enquiry') : b.ok('create', 'user')))
  if (!kinds.length) redirect('/dashboard')
  return (
    <SheetImport kinds={kinds} columns={SHEET_COLUMNS} fixedBranch={b.isSuper ? null : b.actor.branchId}
      branches={b.branches.map((x) => ({ id: x.id, name: x.name, code: x.code }))} />
  )
}
