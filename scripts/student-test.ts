// Student portal isolation against the real DB, ONE rolled-back transaction.
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { verifyPassword } from '../lib/auth/password'
import { branches, departments, lookups, persons, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { requestCertificate } from '../modules/certificates/service'
import { createEnquiry } from '../modules/enquiries/service'
import { getReceipt, recordPayment } from '../modules/fees/service'
import { myPortal } from '../modules/portal/service'
import { createRegistration } from '../modules/registrations/service'
import { createStudentLogin } from '../modules/users/service'
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
    check(name, !match || match.test(msg), match ? msg.slice(0, 100).replace(/\s+/g, ' ') : '')
  }
}
const count = async (tx: Tx, table: string) => (await tx.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table}`))).rows[0].n

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [a] = await tx.insert(branches).values({ code: 'SA1', name: 'Student A' }).returning()
      const mk = async (name: string) => (await tx.insert(users).values({ branchId: a.id, name, email: `${name}@s.test.invalid`, passwordHash: 'x' }).returning())[0]
      const [uc, uacc, um] = [await mk('c'), await mk('acc'), await mk('m')]
      const [dept] = await tx.select().from(departments).limit(1)
      const [cash] = await tx.select().from(lookups).where(eq(lookups.value, 'Cash'))
      const counselor: Actor = { userId: uc.id, orgId: ORG, role: 'counselor', branchId: a.id }
      const acct: Actor = { userId: uacc.id, orgId: ORG, role: 'accountant', branchId: a.id }
      const mgr: Actor = { userId: um.id, orgId: ORG, role: 'branch_manager', branchId: a.id }
      await applyTenant(tx, mgr)

      const r1 = await createRegistration(tx, counselor, { person: { firstName: 'Stu', lastName: 'One', phone: '9300000001' }, departmentId: dept.id, totalFee: 1000000, enrollmentDate: '2026-10-01' })
      const r2 = await createRegistration(tx, counselor, { person: { firstName: 'Stu', lastName: 'Two', phone: '9300000002' }, departmentId: dept.id, totalFee: 2000000, enrollmentDate: '2026-10-01' })
      const p1 = await recordPayment(tx, counselor, { registrationId: r1.id, amount: 300000, modeId: cash.id, nextInstallmentDate: '2026-12-01', nextInstallmentAmount: 700000 })
      const p2 = await recordPayment(tx, counselor, { registrationId: r2.id, amount: 500000, modeId: cash.id, nextInstallmentDate: '2026-12-01', nextInstallmentAmount: 1500000 })
      await createEnquiry(tx, counselor, { person: { firstName: 'Lead', phone: '9300000003' }, departmentId: dept.id })

      // ---- logins -----------------------------------------------------------------
      const l1 = await createStudentLogin(tx, mgr, { registrationId: r1.id, email: 'Stu.One@s.test.invalid' })
      check('manager creates a student login with a hashed temp password', (await verifyPassword(l1.user.passwordHash, l1.tempPassword)) && l1.user.email === 'stu.one@s.test.invalid')
      await throws(tx, 'a student cannot get a second login', () => createStudentLogin(tx, mgr, { registrationId: r1.id, email: 'other@s.test.invalid' }), /already has a login/)
      await throws(tx, 'duplicate email rejected', () => createStudentLogin(tx, mgr, { registrationId: r2.id, email: 'stu.one@s.test.invalid' }), /already used in the system by/)
      await throws(tx, 'counselor cannot create logins', () => createStudentLogin(tx, counselor, { registrationId: r2.id, email: 'x@s.test.invalid' }), /Forbidden/)
      const l2 = await createStudentLogin(tx, mgr, { registrationId: r2.id, email: 'stu.two@s.test.invalid' })
      const [pp1] = await tx.select().from(persons).where(eq(persons.userId, l1.user.id))
      const [pp2] = await tx.select().from(persons).where(eq(persons.userId, l2.user.id))

      // ---- student 1's view -----------------------------------------------------------
      await tx.execute(sql`reset role`)
      const s1: Actor = { userId: l1.user.id, orgId: ORG, role: 'student', branchId: a.id, personId: pp1.id }
      await applyTenant(tx, s1)
      const portal = await myPortal(tx, s1)
      check('portal shows exactly the student\'s own enrolment', portal.length === 1 && portal[0].fee.registrationId === r1.id)
      check('own fees are right (paid 3,000 / balance 7,000)', portal[0].fee.paid === 300000 && portal[0].fee.balance === 700000)
      check('only own receipts listed', portal[0].receipts.length === 1 && portal[0].receipts[0].receiptNo === p1.receipt.receiptNo)
      check('portal shows certificate blockers', (portal[0].cert?.eligibility.reasons.length ?? 0) >= 2)

      check('DB: registrations -> 1 row', (await count(tx, 'registrations')) === 1)
      check('DB: persons -> 1 row (self)', (await count(tx, 'persons')) === 1)
      check('DB: fee_ledger only own rows', (await tx.execute<{ n: number }>(sql`select count(*)::int as n from fee_ledger where registration_id <> ${r1.id}`)).rows[0].n === 0)
      check('DB: payments -> 1 row', (await count(tx, 'payments')) === 1)
      check('DB: receipts -> 1 row', (await count(tx, 'receipts')) === 1)
      check('DB: installments -> own only', (await count(tx, 'installments')) === 1)
      check('DB: users -> only self', (await count(tx, 'users')) === 1)
      for (const t of ['enquiries', 'enquiry_events', 'calls', 'person_occupations', 'audit_logs', 'notifications', 'batches', 'number_sequences']) {
        check(`DB: ${t} -> 0 rows for a student`, (await count(tx, t)) === 0)
      }

      await throws(tx, "cannot open another student's receipt", () => getReceipt(tx, s1, p2.receipt.receiptNo), /not found/)
      await throws(tx, "cannot request a certificate for another student", () => requestCertificate(tx, s1, r2.id), /not found/)
      await throws(tx, 'cannot create enquiries (permission)', () => createEnquiry(tx, s1, { person: { firstName: 'X', phone: '9300000009' }, departmentId: dept.id }), /Forbidden/)
      await throws(tx, 'cannot record payments (permission)', () => recordPayment(tx, s1, { registrationId: r1.id, amount: 1, modeId: cash.id, nextInstallmentDate: '2027-01-01', nextInstallmentAmount: 1 }), /Forbidden/)
      await throws(tx, 'raw SQL insert into enquiries is blocked by the database', () => tx.execute(sql`insert into enquiries (enquiry_no, branch_id, person_id) values ('X', ${a.id}, ${pp1.id})`), /row-level security|permission denied/)
      await throws(tx, "raw SQL update of another student's person is a no-op or blocked", async () => {
        const r = await tx.execute(sql`update persons set first_name = 'Hacked' where id = ${pp2.id} returning id`)
        if (r.rows.length) throw new Error('UPDATED!')
        throw new Error('no rows affected')
      }, /no rows affected/)
      const own = await requestCertificate(tx, s1, r1.id)
      check('student CAN request a certificate for their own enrolment', own.request.registrationId === r1.id)

      // ---- a broken student login sees nothing ---------------------------------------------
      await tx.execute(sql`reset role`)
      const ghost: Actor = { userId: l1.user.id, orgId: ORG, role: 'student', branchId: a.id, personId: null }
      await applyTenant(tx, ghost)
      check('student session with no linked person sees nothing (fails closed)', (await myPortal(tx, ghost)).length === 0 && (await count(tx, 'registrations')) === 0)

      // ---- staff are not restricted -----------------------------------------------------------
      await tx.execute(sql`reset role`)
      await applyTenant(tx, mgr)
      check('staff still see the whole branch', (await count(tx, 'registrations')) === 2 && (await count(tx, 'enquiries')) === 1)
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
