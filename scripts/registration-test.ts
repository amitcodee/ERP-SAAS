// Registration flow against the real DB, inside ONE transaction that is rolled back.
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, departments, enquiries, persons, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { createEnquiry } from '../modules/enquiries/service'
import { createRegistration, listRegistrations, registrationHistory, transitionRegistration, upcomingRegNo } from '../modules/registrations/service'
import { setRegNumbering } from '../modules/branches/service'
import { regFormatProblem, regNumberOf } from '../lib/numbering'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(tx: Tx, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  await tx.execute(sql`savepoint sp`)
  try { await fn(); check(name, false, 'expected error') }
  catch (e) {
    await tx.execute(sql`rollback to savepoint sp`)
    check(name, !match || match.test(String(e)), match ? String(e).slice(0, 70) : '')
  }
}

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [a] = await tx.insert(branches).values({ code: 'RA1', name: 'Reg A' }).returning()
      const [ua] = await tx.insert(users).values({ branchId: a.id, name: 'Counselor', email: 'rc@test.invalid', passwordHash: 'x' }).returning()
      const [dept] = await tx.select().from(departments).limit(1)
      const actA: Actor = { userId: ua.id, orgId: ORG, role: 'counselor', branchId: a.id }
      const mgr: Actor = { ...actA, role: 'branch_manager' }
      await applyTenant(tx, actA)

      const e = await createEnquiry(tx, actA, { person: { firstName: 'Neha', phone: '9812345678' }, departmentId: dept.id, proposedFee: 2000000 })
      const reg = await createRegistration(tx, actA, {
        enquiryId: e.enquiry.id, enrollmentDate: '2026-10-01',
        profile: { fatherName: 'R. Verma', dob: '2005-04-09', guardianPhone: '9811111111', email: 'neha@test.invalid', address: 'Ludhiana' },
      })
      check('registration number format', /^REG-\d{4}-RA1-0001$/.test(reg.regNo), reg.regNo)
      check('fee, department carried over from the enquiry (nothing retyped)', reg.totalFee === 2000000 && reg.departmentId === dept.id)
      const [p] = await tx.select().from(persons).where(eq(persons.id, reg.personId))
      check('father/DOB/email saved on the PERSON (one source)', p.fatherName === 'R. Verma' && p.dob === '2005-04-09' && p.email === 'neha@test.invalid')
      const [enq] = await tx.select().from(enquiries).where(eq(enquiries.id, e.enquiry.id))
      check('enquiry auto-moved to joined', enq.status === 'joined')
      await throws(tx, 'same enquiry cannot be registered twice', () => createRegistration(tx, actA, { enquiryId: e.enquiry.id, enrollmentDate: '2026-10-01' }), /already/)

      const walk = await createRegistration(tx, actA, { person: { firstName: 'Walk', phone: '9700000001' }, departmentId: dept.id, totalFee: 500000, enrollmentDate: '2026-10-02' })
      check('walk-in registration gets next number', walk.regNo.endsWith('-0002'))
      await throws(tx, 'missing fee rejected', () => createRegistration(tx, actA, { person: { firstName: 'X', phone: '9700000002' }, departmentId: dept.id, enrollmentDate: '2026-10-02' }), /fee/i)

      const up = await createRegistration(tx, actA, { person: { firstName: 'Neha', phone: '9812345678' }, departmentId: dept.id, totalFee: 900000, enrollmentDate: '2026-11-01', kind: 'upgrade', previousRegistrationId: reg.id })
      check('upgrade links to previous registration for the SAME person', up.previousRegistrationId === reg.id && up.personId === reg.personId)
      await throws(tx, 'upgrade for a different student rejected', () => createRegistration(tx, actA, { person: { firstName: 'Walk', phone: '9700000001' }, departmentId: dept.id, totalFee: 1, enrollmentDate: '2026-11-01', kind: 'upgrade', previousRegistrationId: reg.id }), /same student/)

      await throws(tx, 'discontinue needs a reason', () => transitionRegistration(tx, actA, { registrationId: reg.id, to: 'discontinued' }), /reason/)
      await transitionRegistration(tx, actA, { registrationId: reg.id, to: 'on_hold', note: 'exam break' })
      await transitionRegistration(tx, actA, { registrationId: reg.id, to: 'active' })
      await transitionRegistration(tx, actA, { registrationId: reg.id, to: 'discontinued', note: 'moved city' })
      await throws(tx, 'counselor cannot reactivate a discontinued student', () => transitionRegistration(tx, actA, { registrationId: reg.id, to: 'active' }), /Forbidden/)
      const back = await transitionRegistration(tx, mgr, { registrationId: reg.id, to: 'active', note: 'returned' })
      check('branch manager can reactivate', back.status === 'active')
      const hist = await registrationHistory(tx, actA, reg.id)
      check('full history kept', hist.map((h) => h.toStatus).join() === 'active,on_hold,active,discontinued,active')

      const list = await listRegistrations(tx, actA, { q: '5678' })
      check('search by phone finds both registrations of the student', list.total === 2, String(list.total))
      await throws(tx, 'accountant cannot create registrations', () => createRegistration(tx, { ...actA, role: 'accountant' }, { person: { firstName: 'Z', phone: '9700000009' }, departmentId: dept.id, totalFee: 1, enrollmentDate: '2026-10-02' }), /Forbidden/)

      // ---- the branch's own registration number format (carrying on the old records' numbering)
      check('a branch with no format keeps REG-year-code-0001', /^REG-\d{4}-RA1-\d{4}$/.test(reg.regNo), reg.regNo)
      check('format check: the number must be in it', !!regFormatProblem('TCD/4002/') && !regFormatProblem('TCD/4002/{n}') && !!regFormatProblem('TCD/{x}/{n}') && !!regFormatProblem('TCD/{n}/{n}'))
      check('reading the number back from a registration number', regNumberOf('TCD/4002/{n}', 'RA1', 'TCD/4002/2577') === 2577 && regNumberOf('TCD/4002/{n}', 'RA1', 'TCD/4001/5') === null)
      await throws(tx, 'only head office sets the numbering', () => setRegNumbering(tx, mgr, a.id, 'TCD/4002/{n}', 2586), /Only head office/)
      const head: Actor = { userId: ua.id, orgId: ORG, role: 'super_admin', branchId: a.id }
      await tx.execute(sql`reset role`); await applyTenant(tx, head)
      await throws(tx, 'a bad format is refused', () => setRegNumbering(tx, head, a.id, 'TCD-{n}-{n}', null), /once/)
      const set = await setRegNumbering(tx, head, a.id, 'TCD/4002/{n}', 2586)
      check('the next number is shown as set', set.next === 'TCD/4002/2586', set.next)
      await tx.execute(sql`reset role`); await applyTenant(tx, actA)
      check('the form shows the number the next student gets', (await upcomingRegNo(tx, actA)) === 'TCD/4002/2586')
      const t1 = await createRegistration(tx, actA, { person: { firstName: 'Old', phone: '9700000021' }, departmentId: dept.id, totalFee: 100, enrollmentDate: '2026-10-02' })
      check('a new admission carries on the series', t1.regNo === 'TCD/4002/2586', t1.regNo)
      // a number already used (brought over from the old records) is skipped
      await tx.execute(sql`reset role`); await tx.execute(sql`update registrations set reg_no = 'TCD/4002/2587' where id = ${reg.id}`); await applyTenant(tx, actA)
      const t2 = await createRegistration(tx, actA, { person: { firstName: 'Next', phone: '9700000022' }, departmentId: dept.id, totalFee: 100, enrollmentDate: '2026-10-02' })
      check('a number already used is never given again', t2.regNo === 'TCD/4002/2588', t2.regNo)
      await tx.execute(sql`reset role`); await applyTenant(tx, head)
      const low = await setRegNumbering(tx, head, a.id, 'TCD/4002/{n}', 5)
      check('the counter never goes back below a number already used', low.next === 'TCD/4002/2589', low.next)
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
