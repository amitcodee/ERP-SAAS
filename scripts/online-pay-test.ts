// Students paying fees online (modules/fees/online.ts) against the real DB, inside ONE transaction that is rolled back.
// The provider is the test one (fake): its signed return is checked, then the payment is recorded once, as at the desk.
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, departments, feePaymentLinks, payments, users } from '../lib/db/schema'
import { applyTenant, type Actor } from '../lib/db/withTenant'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'
import { fakePaidSig } from '../modules/billing/providers'
import { completeFeePaymentIn, dueNow, verifyFeeReturn } from '../modules/fees/online'
import { getBalance, listReceipts } from '../modules/fees/service'
import { MIN_FIRST_PAYMENT } from '../modules/fees/plan'
import { createRegistration } from '../modules/registrations/service'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [a] = await tx.insert(branches).values({ code: 'OP1', name: 'Online Pay' }).returning()
      const [u] = await tx.insert(users).values({ branchId: a.id, name: 'Desk', email: 'op@test.invalid', passwordHash: 'x' }).returning()
      const [dept] = await tx.select().from(departments).limit(1)
      const counselor: Actor = { userId: u.id, orgId: ORG, role: 'counselor', branchId: a.id }
      await applyTenant(tx, counselor)
      const reg = await createRegistration(tx, counselor, { person: { firstName: 'Online Student', phone: '9855500091' }, departmentId: dept.id, totalFee: 3000000, enrollmentDate: '2026-10-01' })
      await tx.execute(sql`reset role`)

      // what paying now pays: nothing scheduled and nothing paid yet -> the balance (at least the first-payment minimum)
      const due = await dueNow(tx, reg.id)
      check('due now: the balance when no installment is scheduled', due === 3000000, String(due))
      await tx.execute(sql`insert into installments (branch_id, registration_id, due_date, amount) values (${a.id}, ${reg.id}, '2026-11-01', 1000000)`)
      check('due now: the next installment when one is scheduled', (await dueNow(tx, reg.id)) === 1000000)
      await tx.execute(sql`update installments set amount = 10000 where registration_id = ${reg.id}`)
      check('due now: a first payment is at least the minimum', (await dueNow(tx, reg.id)) === MIN_FIRST_PAYMENT)
      await tx.execute(sql`update installments set amount = 1000000 where registration_id = ${reg.id}`)

      // a payment page opened for the next installment, then paid
      const [link] = await tx.insert(feePaymentLinks).values({ branchId: a.id, registrationId: reg.id, amount: 1000000, provider: 'fake', createdBy: u.id }).returning()
      const q = new URLSearchParams({ ref: link.id, payment: 'fakepay_t1', sig: fakePaidSig(link.id, 'fakepay_t1') })
      const paid = await verifyFeeReturn(ORG, q)
      check('the signed return is accepted', paid?.ref === link.id && paid.providerPaymentId === 'fakepay_t1')
      check('a return with a wrong signature is refused', (await verifyFeeReturn(ORG, new URLSearchParams({ ref: link.id, payment: 'fakepay_t1', sig: 'x'.repeat(64) }))) === null)
      check('a return for another payment id is refused', (await verifyFeeReturn(ORG, new URLSearchParams({ ref: link.id, payment: 'fakepay_t2', sig: fakePaidSig(link.id, 'fakepay_t1') }))) === null)

      const done = await completeFeePaymentIn(tx, ORG, paid!)
      check('the payment is recorded with a receipt', done.ok && !done.review && !!done.receiptNo, JSON.stringify(done))
      const bal = await getBalance(tx, reg.id)
      check('the balance goes down by what was paid', bal.balance === 2000000, String(bal.balance))
      const [p] = await tx.select().from(payments).where(eq(payments.registrationId, reg.id))
      const [mode] = (await tx.execute<{ value: string }>(sql`select value from lookups where id = ${p.modeId}`)).rows
      check('recorded as Online, with the provider’s payment id, received by nobody at the desk', mode?.value === 'Online' && p.txnRef === 'fakepay_t1' && p.receivedBy === null)
      const [l1] = await tx.select().from(feePaymentLinks).where(eq(feePaymentLinks.id, link.id))
      check('the payment page is marked paid, with the payment', l1.status === 'paid' && l1.paymentId === p.id && !!l1.paidAt)
      const next = (await tx.execute<{ amount: number; status: string }>(sql`select amount, status from installments where registration_id = ${reg.id} order by created_at`)).rows
      check('without a plan, the rest becomes the next installment', next.some((i) => i.status === 'paid') && next.some((i) => i.status === 'scheduled' && i.amount === 2000000), JSON.stringify(next))

      const again = await completeFeePaymentIn(tx, ORG, paid!)
      check('a second confirmation (webhook after the return) records nothing more', again.ok && again.already === true && again.receiptNo === done.receiptNo && (await listReceipts(tx, counselor, reg.id)).length === 1)

      // more than is due by then (e.g. paid at the desk meanwhile): kept for the office, never dropped
      const [big] = await tx.insert(feePaymentLinks).values({ branchId: a.id, registrationId: reg.id, amount: 2500000, provider: 'fake', createdBy: u.id }).returning()
      const r2 = await completeFeePaymentIn(tx, ORG, { ref: big.id, providerPaymentId: 'fakepay_t3' })
      const [l2] = await tx.select().from(feePaymentLinks).where(eq(feePaymentLinks.id, big.id))
      check('a payment that no longer fits is kept for review', r2.ok && r2.review === true && l2.status === 'review' && l2.providerPaymentId === 'fakepay_t3' && /due/.test(l2.note ?? ''), JSON.stringify(l2.note))
      check('... and nothing is recorded for it', (await getBalance(tx, reg.id)).balance === 2000000)
      check('an unknown payment page is refused', !(await completeFeePaymentIn(tx, ORG, { ref: '00000000-0000-4000-8000-0000000000ff', providerPaymentId: 'x' })).ok)

      // the same provider payment cannot be recorded on a second page
      const [dup] = await tx.insert(feePaymentLinks).values({ branchId: a.id, registrationId: reg.id, amount: 1000000, provider: 'fake', createdBy: u.id }).returning()
      const r3 = await completeFeePaymentIn(tx, ORG, { ref: dup.id, providerPaymentId: 'fakepay_t1' })
      const [l3] = await tx.select().from(feePaymentLinks).where(eq(feePaymentLinks.id, dup.id))
      check('a provider payment already recorded is not recorded again', r3.already === true && r3.receiptNo === done.receiptNo && l3.status === 'pending' && (await getBalance(tx, reg.id)).balance === 2000000, JSON.stringify(r3))

      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) { console.error(e); failed++ }
  } finally {
    await pool.end()
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed')
  process.exit(failed ? 1 : 0)
}
main()
