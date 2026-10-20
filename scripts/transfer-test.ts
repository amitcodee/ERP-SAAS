// Inter-branch transfer against the real DB in ONE rolled-back transaction: Mohali asks, Phagwara accepts; the
// student, the balance, the coming installments and the login move; the old registration stays, TRANSFERRED.
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, departments, lookups, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { addAssessment, addBatchMember, approveCapstone, createBatch, createSession, markAttendance } from '../modules/academics/service'
import { applyDiscount, decideFeeChange, getBalance, recordPayment, requestFeeChange, reversePayment } from '../modules/fees/service'
import { getEligibility } from '../modules/certificates/service'
import { reconcile } from '../modules/ops/reconcile'
import { reports } from '../modules/reports/service'
import { createRegistration } from '../modules/registrations/service'
import { acceptTransferIn, cancelTransfer, listTransfers, rejectTransfer, requestTransfer } from '../modules/registrations/transfer'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(tx: Tx, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  await tx.execute(sql`savepoint sp`)
  try { await fn(); check(name, false, 'expected error') }
  catch (e) { await tx.execute(sql`rollback to savepoint sp`); const msg = String(e); check(name, !match || match.test(msg), match ? msg.slice(0, 120) : '') }
}

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [a] = await tx.insert(branches).values({ code: 'TRA', name: 'Transfer Mohali', status: 'active' }).returning()
      const [b] = await tx.insert(branches).values({ code: 'TRB', name: 'Transfer Phagwara', status: 'active' }).returning()
      const mk = async (name: string, branchId: string) => (await tx.insert(users).values({ branchId, name, email: `${name}@transfer.test.invalid`, passwordHash: 'x' }).returning())[0]
      const [ua, ub, us] = [await mk('mgra', a.id), await mk('cb', b.id), await mk('student', a.id)]
      const [dept] = await tx.select().from(departments).limit(1)
      const [cash] = await tx.select().from(lookups).where(eq(lookups.value, 'Cash'))
      const mgrA: Actor = { userId: ua.id, orgId: ORG, role: 'branch_manager', branchId: a.id }
      const counselorA: Actor = { ...mgrA, role: 'counselor' }
      const counselorB: Actor = { userId: ub.id, orgId: ORG, role: 'counselor', branchId: b.id }
      await applyTenant(tx, mgrA)

      const reg = await createRegistration(tx, counselorA, { person: { firstName: 'Moving', lastName: 'Student', phone: '9811100001' }, departmentId: dept.id, totalFee: 3000000, enrollmentDate: '2026-07-01' })
      await recordPayment(tx, counselorA, { registrationId: reg.id, amount: 1000000, modeId: cash.id, nextInstallmentDate: '2026-11-01', nextInstallmentAmount: 1000000 })
      const batch = await createBatch(tx, mgrA, { name: 'Transfer batch', departmentId: dept.id, capacity: 5 })
      await addBatchMember(tx, mgrA, batch.id, reg.id)
      await tx.execute(sql`update persons set user_id = ${us.id} where id = ${reg.personId}`)

      // a discount lowers the TOTAL fee too (total = after discounts); the full fee stays as the list fee
      await applyDiscount(tx, counselorA, { registrationId: reg.id, amount: 200000, reason: 'Sibling discount' })
      const [tf] = (await tx.execute<{ total_fee: number; list_fee: number }>(sql`select total_fee, list_fee from registrations where id = ${reg.id}`)).rows
      check('a discount brings the total fee down (30,000 -> 28,000), list fee stays 30,000', tf.total_fee === 2800000 && tf.list_fee === 3000000, JSON.stringify(tf))
      // two classes (one attended) and an approved capstone at the old branch
      for (const [d, present] of [['2026-09-01', true], ['2026-09-02', false]] as const) {
        const ses = await createSession(tx, mgrA, { batchId: batch.id, sessionDate: d })
        await markAttendance(tx, mgrA, ses.id, [{ registrationId: reg.id, present }])
      }
      const cap = await addAssessment(tx, mgrA, { registrationId: reg.id, kind: 'capstone', title: 'Portfolio site' })
      await approveCapstone(tx, mgrA, cap.id)
      // a payment entered by mistake and reversed: not money in, in the collections
      const wrong = await recordPayment(tx, counselorA, { registrationId: reg.id, amount: 100000, modeId: cash.id, nextInstallmentDate: '2026-11-01', nextInstallmentAmount: 1000000 })
      await reversePayment(tx, mgrA, { receiptNo: wrong.receipt.receiptNo, kind: 'wrong_entry', reason: 'Entered twice by mistake' })
      const repA = await reports(tx, mgrA, a.id)
      check('collections leave the reversed payment out (10,000, not 11,000)', repA.branches.find((x) => x.code === 'TRA')?.collected === 1000000, JSON.stringify(repA.branches.find((x) => x.code === 'TRA')))
      // a fee change still waiting when the student leaves
      await requestFeeChange(tx, counselorA, { registrationId: reg.id, newTotal: 2500000, reason: 'Asked for a lower fee' })

      await throws(tx, 'a counselor cannot ask for a transfer', () => requestTransfer(tx, counselorA, { registrationId: reg.id, toBranchId: b.id, reason: 'Moving house' }), /Forbidden/)
      await throws(tx, 'not to its own branch', () => requestTransfer(tx, mgrA, { registrationId: reg.id, toBranchId: a.id, reason: 'Moving house' }), /already in that branch/)
      const t = await requestTransfer(tx, mgrA, { registrationId: reg.id, toBranchId: b.id, reason: 'Family moved to Phagwara' })
      await throws(tx, 'one open transfer at a time', () => requestTransfer(tx, mgrA, { registrationId: reg.id, toBranchId: b.id, reason: 'Again please' }), /already waiting/)
      await throws(tx, 'the old branch cannot accept or reject its own request', () => rejectTransfer(tx, mgrA, t.id, 'not this one'), /moving to/)
      const listed = await listTransfers(tx, mgrA)
      check('Mohali sees it going out, waiting, with the balance (18,000)', listed.some((x) => x.id === t.id && x.direction === 'out' && x.status === 'pending' && x.balance === 1800000))

      // Phagwara accepts (the accept runs on a connection that sees both branches)
      await applyTenant(tx, counselorB)
      check('Phagwara sees it coming in', (await listTransfers(tx, counselorB)).some((x) => x.id === t.id && x.direction === 'in'))
      await tx.execute(sql`select set_config('app.is_super', 'true', true)`)
      const done = await acceptTransferIn(tx, counselorB, t.id, null)
      check('new registration numbered in Phagwara', /^REG-\d{4}-TRB-\d{4}$/.test(done.regNo), done.regNo)
      const nb = await getBalance(tx, done.registrationId), ob = await getBalance(tx, reg.id)
      check('the balance carries over exactly: 30,000 charged, 2,000 off, 10,000 paid, 18,000 due', nb.charged === 3000000 && nb.discounted === 200000 && nb.paid === 1000000 && nb.balance === 1800000, JSON.stringify(nb))
      const [ntf] = (await tx.execute<{ total_fee: number }>(sql`select total_fee from registrations where id = ${done.registrationId}`)).rows
      check('the new branch’s total fee is the fee after discounts (28,000)', ntf.total_fee === 2800000, JSON.stringify(ntf))
      const el = await getEligibility(tx, done.registrationId)
      check('the certificate counts the old branch’s classes and capstone (2 classes, 50%, capstone ok)', el.sessionsTotal === 2 && el.attendancePct === 50 && el.capstoneOk, JSON.stringify(el))
      await throws(tx, 'the old branch cannot reverse a payment after the transfer', () => reversePayment(tx, mgrA, { receiptNo: (wrong.receipt.receiptNo.replace(/\d+$/, (n) => String(Number(n) - 1).padStart(n.length, '0'))), kind: 'refund', reason: 'Money given back', refundMode: 'Cash' }), /transferred to another branch/)
      const [fq] = (await tx.execute<{ status: string; decision_note: string }>(sql`select status, decision_note from fee_change_requests where registration_id = ${reg.id}`)).rows
      check('the fee change waiting at the old branch is closed', fq.status === 'rejected' && /transferred/.test(fq.decision_note), JSON.stringify(fq))
      await throws(tx, 'a discount on the transferred record is refused', () => applyDiscount(tx, mgrA, { registrationId: reg.id, amount: 1000, reason: 'late discount' }), /transferred to another branch/)
      const rec = await reconcile(tx)
      check('the money check is clean for both branches', !rec.problems.some((x) => x.branch === 'TRA' || x.branch === 'TRB'), JSON.stringify(rec.problems.filter((x) => x.branch === 'TRA' || x.branch === 'TRB')))
      check('the old registration owes nothing more and still shows only what was paid there', ob.balance === 0 && ob.paid === 1000000, JSON.stringify(ob))
      const [old] = (await tx.execute<{ status: string }>(sql`select status::text from registrations where id = ${reg.id}`)).rows
      check('the old registration is TRANSFERRED', old.status === 'transferred')
      const inst = (await tx.execute<{ registration_id: string; status: string }>(sql`select registration_id, status::text from installments where registration_id in (${reg.id}, ${done.registrationId}) and due_date = '2026-11-01'`)).rows
      check('the coming installment moved', inst.some((i) => i.registration_id === done.registrationId && i.status === 'scheduled') && inst.some((i) => i.registration_id === reg.id && i.status === 'cancelled'))
      const [nr] = (await tx.execute<{ branch_id: string; person_id: string; total_fee: number; enrollment_date: string }>(sql`select branch_id, person_id, total_fee, enrollment_date::text from registrations where id = ${done.registrationId}`)).rows
      const [np] = (await tx.execute<{ branch_id: string; user_id: string | null; first_name: string }>(sql`select branch_id, user_id, first_name from persons where id = ${nr.person_id}`)).rows
      check('a copy of the person in Phagwara, with the login', np.branch_id === b.id && np.user_id === us.id && np.first_name === 'Moving')
      check('same enrolment date, total fee after discounts', nr.enrollment_date === '2026-07-01' && nr.total_fee === 2800000)
      const [u] = (await tx.execute<{ branch_id: string }>(sql`select branch_id from users where id = ${us.id}`)).rows
      check('the student login now belongs to Phagwara', u.branch_id === b.id)
      const [bm] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from batch_members where registration_id = ${reg.id}`)).rows
      check('left the Mohali batch', bm.n === 0)
      // the admission is counted once: at the branch the student joined, not again where they moved
      const rep2 = await reports(tx, { userId: ua.id, orgId: ORG, role: 'super_admin', branchId: null }, null)
      const adm = (code: string) => rep2.branches.find((x) => x.code === code)?.registrations
      check('reports count the admission once (Mohali 1, Phagwara 0)', adm('TRA') === 1 && adm('TRB') === 0, `TRA ${adm('TRA')} TRB ${adm('TRB')}`)
      await throws(tx, 'cannot accept twice', () => acceptTransferIn(tx, counselorB, t.id, null), /already accepted/)

      // a second student: turned down, then another request cancelled
      await applyTenant(tx, mgrA)
      const r2 = await createRegistration(tx, counselorA, { person: { firstName: 'Staying', phone: '9811100002' }, departmentId: dept.id, totalFee: 100000, enrollmentDate: '2026-07-01' })
      const t2 = await requestTransfer(tx, mgrA, { registrationId: r2.id, toBranchId: b.id, reason: 'Wants evening batch' })
      await applyTenant(tx, counselorB)
      await throws(tx, 'turning down needs a reason', () => rejectTransfer(tx, counselorB, t2.id, ''), /why/)
      await rejectTransfer(tx, counselorB, t2.id, 'No evening seats')
      await applyTenant(tx, mgrA)
      const [s2] = (await tx.execute<{ status: string }>(sql`select status::text from registrations where id = ${r2.id}`)).rows
      check('turned down: the student stays active in Mohali', s2.status === 'active')
      const t3 = await requestTransfer(tx, mgrA, { registrationId: r2.id, toBranchId: b.id, reason: 'Asking again later' })
      await cancelTransfer(tx, mgrA, t3.id)
      check('Mohali can cancel while it waits', (await listTransfers(tx, mgrA)).find((x) => x.id === t3.id)?.status === 'cancelled')

      // ---- who the student is in the new branch: a shared family mobile never attaches them to someone else
      const ask = async (first: string, last: string | null, phone: string, extra: { dob?: string; email?: string } = {}) => {
        await applyTenant(tx, mgrA)
        const rg = await createRegistration(tx, counselorA, { person: { firstName: first, lastName: last ?? undefined, phone }, departmentId: dept.id, totalFee: 100000, enrollmentDate: '2026-07-01' })
        if (extra.dob || extra.email) { await tx.execute(sql`reset role`); await tx.execute(sql`update persons set dob = ${extra.dob ?? null}, email = ${extra.email ?? null} where id = ${rg.personId}`); await applyTenant(tx, mgrA) }
        const tr = await requestTransfer(tx, mgrA, { registrationId: rg.id, toBranchId: b.id, reason: 'Moving to Phagwara' })
        return { rg, tr }
      }
      const atB = async (first: string, last: string | null, phone: string, extra: { dob?: string; email?: string; userId?: string } = {}) => {
        await tx.execute(sql`reset role`)
        const [x] = (await tx.execute<{ id: string }>(sql`insert into persons (branch_id, first_name, last_name, phone, phone_norm, dob, email, user_id)
          values (${b.id}, ${first}, ${last}, ${phone}, ${phone}, ${extra.dob ?? null}, ${extra.email ?? null}, ${extra.userId ?? null}) returning id`)).rows
        return x.id
      }
      const accept = async (id: string, same = false) => { await tx.execute(sql`reset role`); await applyTenant(tx, counselorB); await tx.execute(sql`select set_config('app.is_super', 'true', true)`); return acceptTransferIn(tx, counselorB, id, null, { samePerson: same }) }
      const personOf = async (regId: string) => (await tx.execute<{ person_id: string }>(sql`select person_id from registrations where id = ${regId}`)).rows[0].person_id

      // 1. the mobile belongs to someone else in Phagwara (a sibling): refused, nothing moves
      await atB('Ravi', 'Kumar', '9811100011')
      const m1 = await ask('Simran', 'Kumar', '9811100011')
      await throws(tx, 'a sibling on the same mobile: refused (the name is different)', () => accept(m1.tr.id), /Ravi Kumar.*name is different/)
      await applyTenant(tx, mgrA)
      check('... and the student stays in Mohali', (await tx.execute<{ status: string }>(sql`select status::text from registrations where id = ${m1.rg.id}`)).rows[0].status === 'active')

      // 2. a different date of birth: someone else, refused
      await atB('Aman', 'Gill', '9811100012', { dob: '2001-01-01' })
      const m2 = await ask('Aman', 'Gill', '9811100012', { dob: '2005-05-05' })
      await throws(tx, 'same name, different date of birth: refused', () => accept(m2.tr.id), /date of birth is different/)

      // 3. same name, nothing else to compare: the branch must confirm
      const mp3 = await atB('Neha', 'Sharma', '9811100013')
      const m3 = await ask('Neha', 'Sharma', '9811100013')
      await throws(tx, 'same name only: the branch must confirm first', () => accept(m3.tr.id), /Check the student first/)
      const md3 = await accept(m3.tr.id, true)
      check('confirmed: the transfer joins the existing record', (await personOf(md3.registrationId)) === mp3)

      // 4. same name and date of birth: the same student, used without asking
      const mp4 = await atB('Karan', 'Mehta', '9811100014', { dob: '2003-03-03' })
      const m4 = await ask('Karan', 'Mehta', '9811100014', { dob: '2003-03-03' })
      const md4 = await accept(m4.tr.id)
      check('same name and date of birth: joins the existing record', (await personOf(md4.registrationId)) === mp4)

      // 5. the record there already has its own student login: refused
      await tx.execute(sql`reset role`)
      const [lu] = (await tx.execute<{ id: string }>(sql`insert into users (branch_id, name, email, password_hash) values (${b.id}, 'Old Login', 'old.login@transfer.test.invalid', 'x') returning id`)).rows
      await atB('Pooja', 'Rani', '9811100015', { userId: lu.id })
      const m5 = await ask('Pooja', 'Rani', '9811100015')
      const [su] = (await tx.execute<{ id: string }>(sql`insert into users (branch_id, name, email, password_hash) values (${a.id}, 'Pooja Login', 'pooja.login@transfer.test.invalid', 'x') returning id`)).rows
      await tx.execute(sql`reset role`); await tx.execute(sql`update persons set user_id = ${su.id} where id = ${m5.rg.personId}`)
      await throws(tx, 'the record there has its own login: refused', () => accept(m5.tr.id, true), /own student login/)

      // 6. no record with that mobile: a new one is made (as before)
      const m6 = await ask('Fresh', null, '9811100016')
      const md6 = await accept(m6.tr.id)
      check('no record with the mobile: a new record in Phagwara', (await personOf(md6.registrationId)) !== m6.rg.personId)
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
