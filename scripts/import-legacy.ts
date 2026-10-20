// Import existing records (Excel -> CSV) into one branch. DRY RUN by default: everything happens inside one
// transaction that is rolled back, and you get a report plus a rejects file. Add --commit to keep the data.
//
//   pnpm import:legacy --branch LDH --as admin@techcadd.com --enquiries enq.csv --registrations reg.csv [--commit]
//
// From the OLD techcadd system (phpMyAdmin → table → Export → CSV, "Put columns names in the first row" ticked):
//   pnpm import:legacy --branch HSP --as admin@techcadd.com --old-registrations hsp_registration.csv --old-fees fee.csv [--map map.csv] [--commit]
// Set the branch's registration number format first (Branches → Registration numbers, e.g. TCD/4002/{n}). --map is
// a CSV "course_type,department" for old course types whose department has another name here.
//
// Templates with every column: import-templates/*.csv. Targets the database in .env.local unless DATABASE_URL
// is already set in the environment (e.g. production through an SSH tunnel, see DEPLOY.md §9).
import { readFileSync, writeFileSync } from 'fs'
import { eq } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, userRoles, users } from '../lib/db/schema'
import { applyTenant, type Actor } from '../lib/db/withTenant'
import { importEnquiries, importRegistrations, parseCsv, type ImportReport } from '../modules/import/legacy'
import { importOldFees, importOldRegistrations, type OldReport } from '../modules/import/oldsystem'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'
import { sql } from 'drizzle-orm'

const args = process.argv.slice(2)
const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
const commit = args.includes('--commit')
class DryRun extends Error {}

async function main() {
  const code = arg('branch'), email = arg('as'), enqFile = arg('enquiries'), regFile = arg('registrations')
  const oldRegFile = arg('old-registrations'), oldFeeFile = arg('old-fees'), mapFile = arg('map')
  if (!code || !email || (!enqFile && !regFile && !oldRegFile && !oldFeeFile)) {
    console.error('usage: pnpm import:legacy --branch CODE --as super-admin@email [--enquiries file.csv] [--registrations file.csv] [--old-registrations file.csv] [--old-fees file.csv] [--map map.csv] [--commit]')
    process.exit(2)
  }
  const [branch] = await db.select().from(branches).where(eq(branches.code, code))
  if (!branch) throw new Error(`No branch with code ${code}`)
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()))
  const roles = user ? (await db.select().from(userRoles).where(eq(userRoles.userId, user.id))).map((r) => r.role) : []
  if (!user || !roles.includes('super_admin')) throw new Error(`${email} must be an existing super admin (imports are recorded under this user)`)
  const actor: Actor = { userId: user.id, orgId: ORG, role: 'super_admin', branchId: branch.id }

  console.log(`${commit ? 'IMPORTING' : 'DRY RUN (nothing is saved; add --commit to save)'} into ${branch.code} · ${branch.name}`)
  const reports: (ImportReport | OldReport)[] = []
  const deptMap = mapFile ? Object.fromEntries(parseCsv(readFileSync(mapFile, 'utf8')).map((r) => [Object.values(r)[0], Object.values(r)[1]])) : undefined
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      await applyTenant(tx, actor)
      // Enquiries first, so a registration of the same phone reuses the person they created.
      if (enqFile) reports.push(await importEnquiries(tx, actor, parseCsv(readFileSync(enqFile, 'utf8'))))
      if (regFile) reports.push(await importRegistrations(tx, actor, parseCsv(readFileSync(regFile, 'utf8'))))
      // old system: the students first, then their payments
      if (oldRegFile) reports.push(await importOldRegistrations(tx, actor, parseCsv(readFileSync(oldRegFile, 'utf8')), deptMap))
      if (oldFeeFile) reports.push(await importOldFees(tx, actor, parseCsv(readFileSync(oldFeeFile, 'utf8'))))
      if (!commit) throw new DryRun()
    })
  } catch (e) {
    if (!(e instanceof DryRun)) throw e
  }

  const rejects: string[] = ['file,line,key,reason']
  for (const r of reports) {
    console.log(`\n${r.kind}: ${r.total} rows · ${r.created} ${commit ? 'created' : 'would be created'} · ${r.skipped} already imported · ${r.rejects.length} rejected`)
    for (const x of r.rejects.slice(0, 20)) console.log(`  line ${x.line} (${x.key}): ${x.reason}`)
    if (r.rejects.length > 20) console.log(`  ... ${r.rejects.length - 20} more`)
    if ('notes' in r) for (const n of r.notes.slice(0, 40)) console.log(`  note: ${n}`)
    for (const x of r.rejects) rejects.push([r.kind, x.line, x.key, x.reason].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
  }
  if (rejects.length > 1) {
    const out = arg('rejects') ?? `import-rejects-${code}.csv`
    writeFileSync(out, rejects.join('\n') + '\n')
    console.log(`\nRejected rows written to ${out}. Fix them in the sheet and run again: rows already imported are skipped.`)
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 }).finally(() => pool.end())
