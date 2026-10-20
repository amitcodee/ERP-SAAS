// Proves RLS + numbering + audit immutability against the real database.
// Everything runs inside ONE transaction that is rolled back, so no data is left behind.
import { sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { auditLogs, branches, users } from '../lib/db/schema'
import { nextReceiptNo, nextRegNo } from '../lib/numbering'
import type { Tx } from '../lib/db/withTenant'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

class Rollback extends Error {}
let failed = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
  if (!ok) failed++
}
async function as(tx: Tx, role: string, branchId: string | null, fn: () => Promise<void>) {
  await tx.execute(sql`savepoint s`)
  await tx.execute(sql`set local role techcadd_app`)
  await tx.execute(sql`select set_config('app.role', ${role}, true), set_config('app.branch_id', ${branchId ?? ''}, true),
    set_config('app.is_super', ${role === 'super_admin' ? 'true' : 'false'}, true)`)
  try { await fn() } finally { await tx.execute(sql`reset role`) }
}
async function expectError(tx: Tx, name: string, fn: () => Promise<unknown>) {
  await tx.execute(sql`savepoint e`)
  try { await fn(); check(name, false, 'expected an error') }
  catch { await tx.execute(sql`rollback to savepoint e`); check(name, true) }
}

async function main() {
try {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
    const [a] = await tx.insert(branches).values({ code: 'TA1', name: 'Test A' }).returning()
    const [b] = await tx.insert(branches).values({ code: 'TB1', name: 'Test B' }).returning()
    await tx.insert(users).values([
      { branchId: a.id, name: 'ua', email: 'ua@test.invalid', passwordHash: 'x' },
      { branchId: b.id, name: 'ub', email: 'ub@test.invalid', passwordHash: 'x' },
    ])

    await as(tx, 'branch_manager', a.id, async () => {
      const bs = await tx.select().from(branches)
      check('branch A manager sees only branch A', bs.length === 1 && bs[0].id === a.id, `${bs.length} row(s)`)
      const us = await tx.select().from(users)
      check('branch A manager sees only branch A users', us.length === 1 && us[0].email === 'ua@test.invalid')
      await expectError(tx, 'branch manager cannot create a branch', () => tx.insert(branches).values({ code: 'ZZ', name: 'z' }))
      await expectError(tx, 'branch A cannot insert a user into branch B', () =>
        tx.insert(users).values({ branchId: b.id, name: 'x', email: 'x@test.invalid', passwordHash: 'x' }))
      await tx.insert(auditLogs).values({ branchId: a.id, action: 't', entity: 't' })
      await expectError(tx, 'audit_logs cannot be updated', () => tx.execute(sql`update audit_logs set action = 'hacked'`))
      await expectError(tx, 'audit_logs cannot be deleted', () => tx.execute(sql`delete from audit_logs`))
    })

    await as(tx, 'super_admin', null, async () => {
      const bs = await tx.select().from(branches)
      check('super admin sees all test branches', bs.filter((x) => x.code.startsWith('T') && x.code.endsWith('1')).length >= 2)
    })

    await as(tx, 'branch_manager', a.id, async () => {
      const r1 = await nextReceiptNo(tx, a.id, 'TA1', new Date('2026-09-30'))
      const r2 = await nextReceiptNo(tx, a.id, 'TA1', new Date('2027-02-01'))
      const r3 = await nextReceiptNo(tx, a.id, 'TA1', new Date('2027-04-01'))
      check('receipt numbers are gapless within a financial year', r1 === 'RCP-TA1-2026-27-00001' && r2 === 'RCP-TA1-2026-27-00002', `${r1}, ${r2}`)
      check('receipt sequence resets in the new financial year', r3 === 'RCP-TA1-2027-28-00001', r3)
      check('registration number format', (await nextRegNo(tx, a.id, 'TA1', new Date('2026-09-30'))) === 'REG-2026-TA1-0001')
      await expectError(tx, 'branch A cannot mint numbers for branch B', () => nextRegNo(tx, b.id, 'TB1'))
    })
    throw new Rollback()
  })
} catch (e) {
  if (!(e instanceof Rollback)) { console.error(e); failed++ }
}
await pool.end()
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed (transaction rolled back, DB untouched)')
process.exitCode = failed ? 1 : 0

}

main().catch((e) => { console.error(e); process.exit(1) })
