// Franchises (modules/franchise/service.ts) against the real DB, inside ONE transaction that is rolled back: the royalty
// rule, who may set terms and record payments, the monthly statement and balance, the partner's name on the centre's
// receipts, and that a franchise's staff see only their own centre.
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, departments, lookups, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'
import { todayIST } from '../lib/ist'
import { getReceipt, recordPayment } from '../modules/fees/service'
import { deleteRoyaltyPayment, franchiseStatements, recordRoyaltyPayment, royaltyFor, setFranchise } from '../modules/franchise/service'
import { createRegistration } from '../modules/registrations/service'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(tx: Tx, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  await tx.execute(sql`savepoint sp`)
  try { await fn(); check(name, false, 'expected error') }
  catch (e) { await tx.execute(sql`rollback to savepoint sp`); const msg = String(e); check(name, !match || match.test(msg), msg.slice(0, 100)) }
}

async function main() {
  // ---- the royalty rule (pure) ----
  const pct = { royaltyKind: 'percent' as const, royaltyValue: 1250, agreementFrom: '2026-03-15', agreementTo: '2026-12-31' }
  check('a percent: 12.5% of ₹40,000 is ₹5,000', royaltyFor(pct, '2026-06', 4000000) === 500000)
  check('nothing before the agreement starts, the starting month counts', royaltyFor(pct, '2026-02', 4000000) === 0 && royaltyFor(pct, '2026-03', 1000000) === 125000)
  check('nothing after it ends', royaltyFor(pct, '2027-01', 4000000) === 0)
  check('a fixed amount, whatever the fees (even none)', royaltyFor({ royaltyKind: 'fixed', royaltyValue: 1000000, agreementFrom: null, agreementTo: null }, '2026-06', 0) === 1000000)
  check('no terms: nothing', royaltyFor({ royaltyKind: null, royaltyValue: null, agreementFrom: null, agreementTo: null }, '2026-06', 4000000) === 0)

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`)
      const [fr] = await tx.insert(branches).values({ code: 'FRA', name: 'Franchise Town', gstin: '03ABCDE1234F1Z5' }).returning()
      const [own] = await tx.insert(branches).values({ code: 'FRB', name: 'Own City' }).returning()
      const [uf] = await tx.insert(users).values({ branchId: fr.id, name: 'Partner', email: 'fra@test.invalid', passwordHash: 'x' }).returning()
      const [uo] = await tx.insert(users).values({ branchId: own.id, name: 'Own Mgr', email: 'frb@test.invalid', passwordHash: 'x' }).returning()
      const [dept] = await tx.select().from(departments).limit(1)
      const [cash] = await tx.select().from(lookups).where(eq(lookups.value, 'Cash'))
      const partner: Actor = { userId: uf.id, orgId: ORG, role: 'branch_manager', branchId: fr.id }
      const ownMgr: Actor = { userId: uo.id, orgId: ORG, role: 'branch_manager', branchId: own.id }
      const head: Actor = { userId: uf.id, orgId: ORG, role: 'super_admin', branchId: null }
      const today = todayIST(), month = today.slice(0, 7)

      // fees received at the franchise this month: ₹40,000
      await applyTenant(tx, partner)
      const reg = await createRegistration(tx, partner, { person: { firstName: 'Fr Student', phone: '9855500081' }, departmentId: dept.id, totalFee: 6000000, enrollmentDate: `${month}-01` })
      const pay = await recordPayment(tx, partner, { registrationId: reg.id, amount: 4000000, modeId: cash.id, nextInstallmentDate: `${month}-28`, nextInstallmentAmount: 2000000 })

      await throws(tx, 'a branch manager cannot make a centre a franchise', () => setFranchise(tx, partner, { branchId: fr.id, kind: 'franchise', partnerName: 'X' }), /Forbidden/)
      await tx.execute(sql`reset role`); await applyTenant(tx, head)
      await throws(tx, 'a franchise needs its partner’s legal name', () => setFranchise(tx, head, { branchId: fr.id, kind: 'franchise', royaltyKind: 'percent', royaltyValue: 1000 }), /legal name/)
      await throws(tx, 'a royalty over 100% is refused', () => setFranchise(tx, head, { branchId: fr.id, kind: 'franchise', partnerName: 'Bright Skills LLP', royaltyKind: 'percent', royaltyValue: 10001 }), /100%/)
      await throws(tx, 'an agreement ending before it starts is refused', () => setFranchise(tx, head, { branchId: fr.id, kind: 'franchise', partnerName: 'Bright Skills LLP', agreementFrom: '2026-05-01', agreementTo: '2026-04-01' }), /end before/)
      await setFranchise(tx, head, { branchId: fr.id, kind: 'franchise', partnerName: 'Bright Skills LLP', partnerOwner: 'Ravi', partnerEmail: 'Ravi@Bright.test', agreementFrom: `${month}-01`, royaltyKind: 'percent', royaltyValue: 1250 })
      const [b1] = await tx.select().from(branches).where(eq(branches.id, fr.id))
      check('head office makes it a franchise: partner and 12.5% kept', b1.kind === 'franchise' && b1.partnerName === 'Bright Skills LLP' && b1.partnerEmail === 'ravi@bright.test' && b1.royaltyKind === 'percent' && b1.royaltyValue === 1250)

      const [s1] = await franchiseStatements(tx, head, { month, branchId: fr.id })
      check('this month: ₹40,000 received, ₹5,000 royalty, nothing paid, ₹5,000 owed', s1.month.income === 4000000 && s1.month.royalty === 500000 && s1.month.paid === 0 && s1.balance === 500000, JSON.stringify(s1.month))
      check('only franchises are listed', !(await franchiseStatements(tx, head, { month })).some((f) => f.branchId === own.id))

      await throws(tx, 'a payment from an own centre is refused', () => recordRoyaltyPayment(tx, head, { branchId: own.id, paidOn: today, amount: 100 }), /not a franchise/)
      await throws(tx, 'a payment in the future is refused', () => recordRoyaltyPayment(tx, head, { branchId: fr.id, paidOn: '2999-01-01', amount: 100 }), /future/)
      const p1 = await recordRoyaltyPayment(tx, head, { branchId: fr.id, paidOn: today, amount: 300000, mode: 'UPI', ref: 'UTR123' })
      const [s2] = await franchiseStatements(tx, head, { month, branchId: fr.id })
      check('a ₹3,000 payment leaves ₹2,000 owed', s2.month.paid === 300000 && s2.balance === 200000)
      await deleteRoyaltyPayment(tx, head, p1)
      check('a payment deleted by mistake leaves the statement', (await franchiseStatements(tx, head, { month, branchId: fr.id }))[0].balance === 500000)

      // the receipt is the partner's
      await tx.execute(sql`reset role`); await applyTenant(tx, partner)
      const rc = await getReceipt(tx, partner, pay.receipt.receiptNo)
      check('the centre’s receipt carries the partner’s legal name (and its GSTIN)', rc.franchisePartner === 'Bright Skills LLP' && rc.gstin === '03ABCDE1234F1Z5' && rc.branchName === 'Franchise Town')

      // the partner sees their own statement; another branch sees nothing
      const mine = await franchiseStatements(tx, partner, { month })
      check('the partner sees their own centre’s statement', mine.length === 1 && mine[0].branchId === fr.id && mine[0].balance === 500000)
      await throws(tx, 'the partner cannot record payments', () => recordRoyaltyPayment(tx, partner, { branchId: fr.id, paidOn: today, amount: 100 }), /Forbidden/)
      await throws(tx, '… nor change the terms', () => setFranchise(tx, partner, { branchId: fr.id, kind: 'own' }), /Forbidden/)
      await tx.execute(sql`reset role`); await applyTenant(tx, ownMgr)
      check('another branch sees no franchise', (await franchiseStatements(tx, ownMgr, { month })).length === 0)
      const ownReceipt = (await tx.execute<{ n: number }>(sql`select count(*)::int n from royalty_payments`)).rows[0].n
      check('… and no royalty payments', ownReceipt === 0)

      // back to an own centre
      await tx.execute(sql`reset role`); await applyTenant(tx, head)
      await setFranchise(tx, head, { branchId: fr.id, kind: 'own' })
      const [b2] = await tx.select().from(branches).where(eq(branches.id, fr.id))
      check('made own again: its terms are cleared', b2.kind === 'own' && b2.partnerName === null && b2.royaltyKind === null)
      await tx.execute(sql`reset role`); await applyTenant(tx, partner)
      check('… and its receipts are in its own name again', (await getReceipt(tx, partner, pay.receipt.receiptNo)).franchisePartner === null)
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) { console.error(e); failed++ }
  }
  const { redis } = await import('../lib/redis'); redis.disconnect()
  await pool.end()
  console.log(failed ? `\n${failed} FAILED` : '\nall checks passed (rolled back, DB untouched)')
  process.exitCode = failed ? 1 : 0
}
main()
