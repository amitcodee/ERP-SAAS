// Fee ledger against the real DB, inside ONE transaction that is rolled back.
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, departments, lookups, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { rupeesInWords } from '../lib/money'
import { applyDiscount, fixFeeRemark, getBalance, getReceipt, listFees, listOpenFeeRemarks, listReceipts, raiseFeeRemark, recordPayment, reversePayment, verifyReceiptIn } from '../modules/fees/service'
import { createRegistration } from '../modules/registrations/service'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(tx: Tx, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  await tx.execute(sql`savepoint sp`)
  try { await fn(); check(name, false, 'expected error') }
  catch (e) {
    await tx.execute(sql`rollback to savepoint sp`)
    const msg = String(e) + ' ' + String((e as { cause?: unknown }).cause ?? '')
    check(name, !match || match.test(msg), match ? msg.slice(0, 100).replace(/s+/g, ' ') : '')
  }
}

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [a] = await tx.insert(branches).values({ code: 'FA1', name: 'Fee A' }).returning()
      const [b] = await tx.insert(branches).values({ code: 'FB1', name: 'Fee B' }).returning()
      const [ua] = await tx.insert(users).values({ branchId: a.id, name: 'Acct', email: 'fa@test.invalid', passwordHash: 'x' }).returning()
      const [ub] = await tx.insert(users).values({ branchId: b.id, name: 'Acct B', email: 'fb@test.invalid', passwordHash: 'x' }).returning()
      const [dept] = await tx.select().from(departments).limit(1)
      const [cash] = await tx.select().from(lookups).where(eq(lookups.value, 'Cash'))
      const counselor: Actor = { userId: ua.id, orgId: ORG, role: 'counselor', branchId: a.id }
      const acct: Actor = { ...counselor, role: 'accountant' }
      const mgr: Actor = { ...counselor, role: 'branch_manager' }
      const acctB: Actor = { userId: ub.id, orgId: ORG, role: 'accountant', branchId: b.id }
      const counselorB: Actor = { ...acctB, role: 'counselor' }

      await applyTenant(tx, counselor)
      const reg = await createRegistration(tx, counselor, { person: { firstName: 'Fee Student', phone: '9855500001' }, departmentId: dept.id, totalFee: 3000000, enrollmentDate: '2026-10-01' })
      let bal = await getBalance(tx, reg.id)
      check('registration posts a CHARGE: balance = total fee', bal.charged === 3000000 && bal.balance === 3000000)

      // admissions (the counselor) collects fees; accounts only checks them
      await throws(tx, 'accountant cannot take payments', () => recordPayment(tx, acct, { registrationId: reg.id, amount: 100000, modeId: cash.id }), /Forbidden/)
      await throws(tx, 'partial payment WITHOUT next installment is rejected (fildes.md rule)', () => recordPayment(tx, counselor, { registrationId: reg.id, amount: 1000000, modeId: cash.id }), /mandatory/)
      await throws(tx, 'overpayment rejected', () => recordPayment(tx, counselor, { registrationId: reg.id, amount: 3000001, modeId: cash.id, nextInstallmentDate: '2026-11-01', nextInstallmentAmount: 1 }), /more than/)

      const p1 = await recordPayment(tx, counselor, { registrationId: reg.id, amount: 1000000, modeId: cash.id, nextInstallmentDate: '2026-11-01', nextInstallmentAmount: 1000000 })
      check('payment reduces balance', p1.balanceAfter === 2000000 && (await getBalance(tx, reg.id)).balance === 2000000)
      check('receipt numbered in financial-year format', /^RCP-FA1-\d{4}-\d{2}-00001$/.test(p1.receipt.receiptNo), p1.receipt.receiptNo)

      const p2 = await recordPayment(tx, counselor, { registrationId: reg.id, amount: 1000000, modeId: cash.id, nextInstallmentDate: '2026-12-01', nextInstallmentAmount: 1000000 })
      check('receipt numbers are sequential and gapless', p2.receipt.receiptNo.endsWith('-00002'))

      const g1 = await getReceipt(tx, acct, p1.receipt.receiptNo)
      check('receipt 1 prints balance AS AT that payment (not today)', g1.charged === 3000000 && g1.paidToDate === 1000000 && g1.balanceAfter === 2000000, `${g1.balanceAfter}`)
      const g2 = await getReceipt(tx, acct, p2.receipt.receiptNo)
      check('receipt 2 balance moves on', g2.paidToDate === 2000000 && g2.balanceAfter === 1000000 && g2.studentName === 'Fee Student')
      const ok = await verifyReceiptIn(tx, g1.token)
      check('QR token of a real receipt verifies (amount + branch only)', ok.valid && ok.amount === 1000000 && ok.branch === 'Fee A')
      const forged = g1.token.slice(0, -1) + (g1.token.endsWith('0') ? '1' : '0')
      check('a one-character-off token is NOT genuine', !(await verifyReceiptIn(tx, forged)).valid)
      check('a token for another receipt number does not verify', !(await verifyReceiptIn(tx, p2.receipt.receiptNo + '.' + g1.token.split('.')[1])).valid)
      check('rupees in words (Indian numbering)', rupeesInWords(1250050) === 'Rupees Twelve Thousand Five Hundred and Fifty Paise Only' && rupeesInWords(15000000) === 'Rupees One Lakh Fifty Thousand Only' && rupeesInWords(0) === 'Rupees Zero Only', rupeesInWords(1250050))
      const fees = await listFees(tx, acct)
      const row = fees.find((f) => f.registrationId === reg.id)!
      check('fee list shows the single next installment (Dec, not Nov)', row.nextDue === '2026-12-01' && row.balance === 1000000, `${row.nextDue}`)

      // discounts: no fixed limit; the counselor gives what the student needs (never more than what is due)
      await throws(tx, 'a discount cannot be more than what is due', () => applyDiscount(tx, counselor, { registrationId: reg.id, amount: 1000001, reason: 'too much' }), /more than the outstanding/)
      const afterSmall = await applyDiscount(tx, counselor, { registrationId: reg.id, amount: 100000, reason: 'early bird' })
      check('the counselor gives a discount and it lowers the balance', afterSmall.balance === 900000 && afterSmall.discounted === 100000)

      const last = await recordPayment(tx, counselor, { registrationId: reg.id, amount: 900000, modeId: cash.id })
      check('final payment clears balance with no next installment needed', last.balanceAfter === 0)
      await throws(tx, 'nothing left to pay', () => recordPayment(tx, counselor, { registrationId: reg.id, amount: 1, modeId: cash.id }), /Nothing is due/)
      check('all 3 receipts listed', (await listReceipts(tx, acct, reg.id)).length === 3)

      // P10: money history cannot be edited or deleted, even by the table owner path
      await throws(tx, 'ledger row cannot be updated', () => tx.execute(sql`update fee_ledger set amount = 0`), /permission denied|append-only|not allowed/)
      await throws(tx, 'payment cannot be deleted', () => tx.execute(sql`delete from payments`), /permission denied|append-only|not allowed/)
      await throws(tx, 'receipt number cannot be changed', () => tx.execute(sql`update receipts set receipt_no = 'X'`), /permission denied|immutable/)

      // no 25% rule any more: a counselor may give a large discount (a scholarship) on their own
      await applyTenant(tx, counselor).catch(() => {})
      const reg2 = await createRegistration(tx, counselor, { person: { firstName: 'Big Disc', phone: '9855500002' }, departmentId: dept.id, totalFee: 1000000, listFee: 2000000, enrollmentDate: '2026-10-01' })
      check('an offer fee of half the full fee is accepted at registration', (await getBalance(tx, reg2.id)).balance === 1000000)
      const md = await applyDiscount(tx, counselor, { registrationId: reg2.id, amount: 600000, reason: 'scholarship' })
      check('the counselor gives a 60% discount without a manager', md.balance === 400000)
      await throws(tx, 'a trainer cannot give a discount', () => applyDiscount(tx, { ...counselor, role: 'trainer' }, { registrationId: reg2.id, amount: 1000, reason: 'x' }), /Forbidden/)

      // accounts checks: a remark on a receipt, fixed by admissions
      await throws(tx, 'counselor cannot raise a fee remark', () => raiseFeeRemark(tx, counselor, { registrationId: reg.id, note: 'looks wrong' }), /Forbidden/)
      await throws(tx, 'a remark on another student’s receipt is refused', () => raiseFeeRemark(tx, acct, { registrationId: reg2.id, receiptNo: p1.receipt.receiptNo, note: 'amount differs' }), /not one of this student/)
      const rm = await raiseFeeRemark(tx, acct, { registrationId: reg.id, receiptNo: p1.receipt.receiptNo, note: 'Amount differs from the bank statement' })
      check('accountant raises a remark; it is open on the fees page', (await listOpenFeeRemarks(tx, acct)).some((x) => x.id === rm.id && x.receiptNo === p1.receipt.receiptNo))
      await throws(tx, 'fixing needs a note', () => fixFeeRemark(tx, counselor, { remarkId: rm.id, note: '' }), /what was fixed/)
      await fixFeeRemark(tx, counselor, { remarkId: rm.id, note: 'Checked with the bank: entered right' })
      check('counselor marks it fixed; it leaves the open list', !(await listOpenFeeRemarks(tx, acct)).some((x) => x.id === rm.id))
      await throws(tx, 'a fixed remark cannot be fixed again', () => fixFeeRemark(tx, counselor, { remarkId: rm.id, note: 'again' }), /already fixed/)

      // a payment entered wrongly and reversed: its UPI / cheque reference can be entered again
      const [online] = await tx.select().from(lookups).where(eq(lookups.value, 'Online'))
      const r9 = await createRegistration(tx, counselor, { person: { firstName: 'Ref Again', phone: '9855500019' }, departmentId: dept.id, totalFee: 3000000, enrollmentDate: '2026-10-01' })
      const w1 = await recordPayment(tx, counselor, { registrationId: r9.id, amount: 1000000, modeId: online.id, txnRef: 'UTR-778899', nextInstallmentDate: '2026-12-01', nextInstallmentAmount: 2000000 })
      await throws(tx, 'the same reference twice is refused', () => recordPayment(tx, counselor, { registrationId: r9.id, amount: 500000, modeId: online.id, txnRef: 'utr-778899', nextInstallmentDate: '2026-12-01', nextInstallmentAmount: 1500000 }), /already recorded/)
      await reversePayment(tx, mgr, { receiptNo: w1.receipt.receiptNo, kind: 'wrong_entry', reason: 'Wrong student' })
      const w2 = await recordPayment(tx, counselor, { registrationId: r9.id, amount: 1000000, modeId: online.id, txnRef: 'UTR-778899', nextInstallmentDate: '2026-12-01', nextInstallmentAmount: 2000000 })
      check('after a wrong entry is reversed, its reference can be entered again', !!w2.receipt.receiptNo)
      // a refund lowers "paid to date" on the receipts that follow (as the balance does)
      const c1 = await recordPayment(tx, counselor, { registrationId: r9.id, amount: 500000, modeId: cash.id, nextInstallmentDate: '2026-12-01', nextInstallmentAmount: 1500000 })
      await reversePayment(tx, mgr, { receiptNo: c1.receipt.receiptNo, kind: 'refund', reason: 'Paid twice', refundMode: 'Cash' })
      const c2 = await recordPayment(tx, counselor, { registrationId: r9.id, amount: 200000, modeId: cash.id, nextInstallmentDate: '2026-12-01', nextInstallmentAmount: 1800000 })
      const rc2 = await getReceipt(tx, acct, c2.receipt.receiptNo)
      const bal9 = await getBalance(tx, r9.id)
      check('receipt "paid to date" counts the refund: 10,000 + 2,000 = 12,000 (not 17,000)', rc2.paidToDate === 1200000 && rc2.paidToDate === bal9.paid, `${rc2.paidToDate} / balance view ${bal9.paid}`)

      // RLS: another branch's accountant sees nothing
      await tx.execute(sql`reset role`)
      await applyTenant(tx, acctB)
      check('branch B accountant sees no fee rows of branch A', (await listFees(tx, acctB)).length === 0)
      await throws(tx, 'branch B cannot pay branch A registration', () => recordPayment(tx, counselorB, { registrationId: reg.id, amount: 1, modeId: cash.id }), /not found/)
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
