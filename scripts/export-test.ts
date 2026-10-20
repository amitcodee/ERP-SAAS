// Every downloadable list, in every format, built from the real (local) data: the files are written to a folder so
// they can be opened, and checked here (xlsx = a zip with a sheet, csv = UTF-8 BOM + header, pdf = %PDF).
// Usage: pnpm test:export [outDir]
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { pool } from '../lib/db/client'
import { withOrgSystem, withTenant, type Actor } from '../lib/db/withTenant'
import { display, toCsv, toPdf, toXlsx } from '../lib/export/formats'
import { EXPORTS } from '../modules/exports/lists'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }

async function main() {
  const out = process.argv[2] ?? path.join(process.cwd(), '.export-test')
  mkdirSync(out, { recursive: true })
  // formula injection and money/date formatting
  const csv = toCsv({ title: 't', columns: [{ label: 'Name' }, { label: 'Fee', kind: 'money' }, { label: 'On', kind: 'date' }], rows: [['=HYPERLINK("x")', 250050, '2026-10-13'], ['-5', 100, null]] }).toString('utf8')
  check('CSV: a cell that would run as a formula is defused', csv.includes(`"'=HYPERLINK(""x"")"`), csv)
  check('CSV: money as rupees, dates readable, BOM for Excel', csv.charCodeAt(0) === 0xfeff && csv.includes('2500.5') && csv.includes('13 Oct 2026'))
  check('display: ₹ with Indian grouping', display(1234567800, 'money') === '₹1,23,45,678')

  const [u] = (await withOrgSystem(ORG, (tx) => tx.execute<{ id: string }>(sql`select u.id from users u join user_roles r on r.user_id = u.id where r.role = 'super_admin' limit 1`))).rows
  if (!u) { console.log('no super admin in this database: skipping the lists'); await pool.end(); return }
  const actor: Actor = { userId: u.id, orgId: ORG, role: 'super_admin', roles: ['super_admin'], branchId: null }
  for (const [key, def] of Object.entries(EXPORTS)) {
    try {
      const rows = await withTenant(actor, (tx) => def.rows(tx, actor, {}))
      const sheet = { title: def.title, subtitle: 'All branches', columns: def.columns, rows }
      const bad = rows.find((r) => r.length !== def.columns.length)
      check(`${key}: ${rows.length} rows, every row has ${def.columns.length} cells`, !bad)
      const x = toXlsx(sheet), c = toCsv(sheet), p = await toPdf(sheet)
      writeFileSync(path.join(out, `${key}.xlsx`), x); writeFileSync(path.join(out, `${key}.csv`), c); writeFileSync(path.join(out, `${key}.pdf`), p)
      check(`${key}: xlsx / csv / pdf made`, x.readUInt32LE(0) === 0x04034b50 && c[0] === 0xef && p.subarray(0, 4).toString() === '%PDF')
    } catch (e) { check(`${key}: builds`, false, String(e).slice(0, 160)) }
  }
  console.log(`files in ${out}`)
  await pool.end()
  console.log(failed ? `\n${failed} FAILED` : '\nall checks passed')
  process.exitCode = failed ? 1 : 0
}
main()
