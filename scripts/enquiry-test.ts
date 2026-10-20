// Enquiry desk against the real DB, inside ONE transaction that is rolled back.
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, departments, lookups, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { createEnquiry, enquiryHistory, listEnquiries, logCall, transitionEnquiry } from '../modules/enquiries/service'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(tx: Tx, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  await tx.execute(sql`savepoint sp`)
  try { await fn(); check(name, false, 'expected error') }
  catch (e) {
    await tx.execute(sql`rollback to savepoint sp`)
    check(name, !match || match.test(String(e)), match ? String(e).slice(0, 80) : '')
  }
}

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [a] = await tx.insert(branches).values({ code: 'EA1', name: 'Enq A' }).returning()
      const [b] = await tx.insert(branches).values({ code: 'EB1', name: 'Enq B' }).returning()
      const [ua] = await tx.insert(users).values({ branchId: a.id, name: 'Counselor A', email: 'ca@test.invalid', passwordHash: 'x' }).returning()
      const [ub] = await tx.insert(users).values({ branchId: b.id, name: 'Counselor B', email: 'cb@test.invalid', passwordHash: 'x' }).returning()
      const [dept] = await tx.select().from(departments).limit(1)
      const [reason] = await tx.select().from(lookups).where(eq(lookups.kind, 'not_joined_reason')).limit(1)
      const actA: Actor = { userId: ua.id, orgId: ORG, role: 'counselor', branchId: a.id }
      const actB: Actor = { userId: ub.id, orgId: ORG, role: 'counselor', branchId: b.id }

      await applyTenant(tx, actA)
      const r1 = await createEnquiry(tx, actA, { person: { firstName: 'Riya', phone: '+91 98765-43210' }, departmentId: dept.id, proposedFee: 1500000 })
      check('enquiry number minted in branch format', /^ENQ-EA1-\d{2}-0001$/.test(r1.enquiry.enquiryNo), r1.enquiry.enquiryNo)
      check('new enquiry starts as "new"', r1.enquiry.status === 'new')

      const r2 = await createEnquiry(tx, actA, { person: { firstName: 'Riya Sharma', phone: '9876543210' }, departmentId: dept.id })
      check('same phone (different format) reuses the SAME person', r2.personWasExisting && r2.person.id === r1.person.id)
      check('second enquiry gets the next number', r2.enquiry.enquiryNo.endsWith('-0002'))

      await throws(tx, 'invalid phone rejected', () => createEnquiry(tx, actA, { person: { firstName: 'X', phone: '123' } }), /10-digit/)
      await throws(tx, 'follow_up without a date rejected', () => transitionEnquiry(tx, actA, { enquiryId: r1.enquiry.id, to: 'follow_up' }), /needs a date/)
      await throws(tx, 'not_joined without a reason rejected', () => transitionEnquiry(tx, actA, { enquiryId: r1.enquiry.id, to: 'not_joined' }), /reason/)

      await transitionEnquiry(tx, actA, { enquiryId: r1.enquiry.id, to: 'follow_up', followUpDate: '2026-10-05', note: 'call back' })
      await transitionEnquiry(tx, actA, { enquiryId: r1.enquiry.id, to: 'not_joined', notJoinedReasonId: reason.id })
      const j = await transitionEnquiry(tx, actA, { enquiryId: r1.enquiry.id, to: 'joined' })
      check('can reach joined', j.status === 'joined')
      await throws(tx, 'joined is final', () => transitionEnquiry(tx, actA, { enquiryId: r1.enquiry.id, to: 'dead' }), /Illegal/)

      const hist = await enquiryHistory(tx, actA, r1.enquiry.id)
      check('every change is in history', hist.length === 4 && hist.map((h) => h.toStatus).join() === 'new,follow_up,not_joined,joined', hist.map((h) => h.toStatus).join())

      const call = await logCall(tx, actA, { person: { firstName: 'Random', phone: '9000000001' }, remarks: 'asked fees' })
      check('random call logged against a person', !!call.call.personId)

      const list = await listEnquiries(tx, actA, { q: '43210' })
      check('search by phone finds it', list.total === 2 && list.rows[0].name.startsWith('Riya'), `${list.total}`)

      await throws(tx, 'accountant cannot create enquiries', () => createEnquiry(tx, { ...actA, role: 'accountant' }, { person: { firstName: 'X', phone: '9111111111' } }), /Forbidden/)

      await applyTenant(tx, { userId: ub.id, orgId: ORG, role: 'counselor', branchId: b.id }).catch(() => {})
      await tx.execute(sql`reset role`)
      await applyTenant(tx, actB)
      const other = await listEnquiries(tx, actB, {})
      check('branch B cannot see branch A enquiries (RLS)', other.total === 0)
      await throws(tx, 'branch B cannot move branch A enquiry', () => transitionEnquiry(tx, actB, { enquiryId: r1.enquiry.id, to: 'dead' }), /not found/)

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
