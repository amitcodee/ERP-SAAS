// Nightly reconciliation + job alerts, in ONE rolled-back transaction. Each break is made by hand (bypassing the
// services, as a bug or a manual DB edit would) and must be reported; a clean branch must report nothing.
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, departments, feeLedger, jobRuns, lookups, numberSequences, payments, users } from '../lib/db/schema'
import { applyTenant, type Actor } from '../lib/db/withTenant'
import { recordPayment } from '../modules/fees/service'
import { reconcile } from '../modules/ops/reconcile'
import { systemAlerts } from '../modules/ops/status'
import { createRegistration } from '../modules/registrations/service'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [a] = await tx.insert(branches).values({ code: 'RC1', name: 'Recon A' }).returning()
      const [u] = await tx.insert(users).values({ branchId: a.id, name: 'Acct', email: 'rc@test.invalid', passwordHash: 'x' }).returning()
      const [dept] = await tx.select().from(departments).limit(1)
      const [cash] = await tx.select().from(lookups).where(eq(lookups.value, 'Cash'))
      const counselor: Actor = { userId: u.id, orgId: ORG, role: 'counselor', branchId: a.id }
      const acct: Actor = { ...counselor, role: 'accountant' }
      const sup: Actor = { userId: u.id, orgId: ORG, role: 'super_admin', branchId: null }
      const mine = async () => (await reconcile(tx)).problems.filter((p) => p.branch === 'RC1')

      await applyTenant(tx, counselor)
      const reg = await createRegistration(tx, counselor, { person: { firstName: 'Recon', phone: '9866600001' }, departmentId: dept.id, totalFee: 1000000, enrollmentDate: '2026-10-01' })
      await recordPayment(tx, counselor, { registrationId: reg.id, amount: 400000, modeId: cash.id, nextInstallmentDate: '2026-11-01', nextInstallmentAmount: 600000 })
      await recordPayment(tx, counselor, { registrationId: reg.id, amount: 600000, modeId: cash.id })

      await tx.execute(sql`reset role`)
      await applyTenant(tx, sup)
      check('a branch run only through the app reconciles cleanly', (await mine()).length === 0, JSON.stringify(await mine()))

      // ---- break things the way only a bug or a manual edit could ---------------------
      await tx.execute(sql`reset role`) // owner role: bypasses RLS like a manual psql session
      const [stray] = await tx.insert(payments).values({ branchId: a.id, registrationId: reg.id, amount: 5000, modeId: cash.id }).returning()
      let p = await mine()
      check('payment with no ledger row is caught', p.some((x) => x.check === 'payment has no matching ledger row' && x.detail === stray.id))
      check('payment with no receipt is caught', p.some((x) => x.check === 'payment has no receipt' && x.detail === stray.id))
      check('payments vs ledger total mismatch is caught', p.some((x) => x.check === 'payments = ledger'))

      await tx.update(numberSequences).set({ lastValue: sql`${numberSequences.lastValue} + 1` }).where(eq(numberSequences.branchId, a.id))
      p = await mine()
      check('a skipped receipt number is caught', p.some((x) => x.check === 'receipt numbers gapless'), JSON.stringify(p.filter((x) => x.check.startsWith('receipt'))))

      await tx.insert(feeLedger).values({ branchId: a.id, registrationId: reg.id, entryType: 'charge', amount: 100 })
      p = await mine()
      check('a charge that differs from the total fee is caught', p.some((x) => x.check === 'total fee = charges less discounts'))
      await tx.insert(feeLedger).values({ branchId: a.id, registrationId: reg.id, entryType: 'adjustment', amount: -5000 })
      p = await mine()
      check('a negative balance (overpaid) is caught', p.some((x) => x.check === 'no overpayment'), JSON.stringify(p.map((x) => x.check)))

      // ---- job alerts ----------------------------------------------------------------
      await tx.delete(jobRuns)
      await applyTenant(tx, sup)
      let al = await systemAlerts(tx, sup)
      check('never-run daily jobs are flagged (an institute older than a day), in words for the institute', al.length === 2 && al.every((x) => /has not run yet/.test(x.text) && !/Coolify/.test(x.text)))
      await tx.insert(jobRuns).values([
        { job: 'reminders', ok: true, startedAt: new Date(), finishedAt: new Date(), summary: {} },
        { job: 'reconcile', ok: false, startedAt: new Date(Date.now() - 4 * 3600000), finishedAt: new Date(), summary: { problemCount: 3 } },
      ])
      al = await systemAlerts(tx, sup)
      check('a reconcile mismatch is flagged, a healthy job is not', al.length === 1 && al[0].job === 'reconcile' && /3 money mismatches/.test(al[0].text), JSON.stringify(al))
      await tx.insert(jobRuns).values({ job: 'reminders', ok: true, startedAt: new Date(Date.now() - 2 * 86400000), finishedAt: new Date(Date.now() - 2 * 86400000) })
      await tx.insert(jobRuns).values({ job: 'reconcile', ok: null, startedAt: new Date(Date.now() - 2 * 3600000) })
      al = await systemAlerts(tx, sup)
      check('a stuck run is flagged', al.some((x) => x.job === 'reconcile' && /never finished/.test(x.text)), JSON.stringify(al))
      check('the newest run decides (stale old row ignored)', !al.some((x) => x.job === 'reminders'))
      check('only a super admin gets alerts', (await systemAlerts(tx, acct)).length === 0)

      await tx.execute(sql`reset role`)
      await applyTenant(tx, { userId: u.id, orgId: ORG, role: 'branch_manager', branchId: a.id })
      const seen = await tx.execute(sql`select count(*)::int as n from job_runs`)
      check('job_runs is invisible to branch staff (RLS)', Number(seen.rows[0].n) === 0)
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) { console.error(e); failed++ }
  }
  await pool.end()
  console.log(failed ? `\n${failed} FAILED` : '\nall checks passed (rolled back, DB untouched)')
  process.exitCode = failed ? 1 : 0
}
main()
