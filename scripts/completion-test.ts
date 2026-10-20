// Course completion against the real DB in ONE rolled-back transaction: syllabus covered + certificate issued
// (+ internship letter when picked at admission) => the registration completes; a manager can mark one by hand.
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, courses, departments, registrations, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { addBatchMember, createBatch } from '../modules/academics/service'
import { createRegistration } from '../modules/registrations/service'
import { completeIfDone, completionStatus, markCompleted } from '../modules/registrations/completion'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(tx: Tx, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  await tx.execute(sql`savepoint sp`)
  try { await fn(); check(name, false, 'expected error') }
  catch (e) { await tx.execute(sql`rollback to savepoint sp`); const msg = String(e); check(name, !match || match.test(msg), match ? msg.slice(0, 110) : '') }
}

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [a] = await tx.insert(branches).values({ code: 'CP1', name: 'Completion A' }).returning()
      const [u] = await tx.insert(users).values({ branchId: a.id, name: 'm', email: 'm@completion.test.invalid', passwordHash: 'x' }).returning()
      const [dept] = await tx.select().from(departments).limit(1)
      const [course] = await tx.insert(courses).values({ departmentId: dept.id, title: 'Completion Course', baseFee: 0 } as typeof courses.$inferInsert).returning()
      const mgr: Actor = { userId: u.id, orgId: ORG, role: 'branch_manager', branchId: a.id }
      const counselor: Actor = { ...mgr, role: 'counselor' }
      await applyTenant(tx, mgr)
      const status = async (id: string) => (await tx.select({ s: registrations.status }).from(registrations).where(eq(registrations.id, id)))[0].s

      const reg = await createRegistration(tx, counselor, { person: { firstName: 'Done', phone: '9877700001' }, departmentId: dept.id, courseId: course.id, totalFee: 1000, enrollmentDate: '2026-10-01' })
      const batch = await createBatch(tx, mgr, { name: 'Completion batch', departmentId: dept.id, trainerId: u.id, capacity: 5 })
      await addBatchMember(tx, mgr, batch.id, reg.id)

      let c = (await completionStatus(tx, mgr, reg.id))!
      check('no syllabus: not ready, says so', !c.ready && c.missing.some((m) => /No syllabus/.test(m)), c.missing.join(' | '))

      // set-up: a syllabus (only head office writes the live syllabus, so it is added as the owner here)
      await tx.execute(sql`reset role`)
      const topics = (await tx.execute<{ id: string }>(sql`insert into course_topics (course_id, title, sort_order) values (${course.id}, 'One', 1), (${course.id}, 'Two', 2) returning id`)).rows
      await applyTenant(tx, mgr)
      await tx.execute(sql`insert into batch_topics (batch_id, topic_id, branch_id, covered_on) values (${batch.id}, ${topics[0].id}, ${a.id}, '2026-10-05')`)
      c = (await completionStatus(tx, mgr, reg.id))!
      check('half the syllabus: 1 of 2 covered', c.syllabus.covered === 1 && c.syllabus.total === 2 && !c.syllabus.done)

      await tx.execute(sql`insert into batch_topics (batch_id, topic_id, branch_id, covered_on) values (${batch.id}, ${topics[1].id}, ${a.id}, '2026-10-06')`)
      check('syllabus done but no certificate: stays active', (await completeIfDone(tx, mgr, [reg.id])).length === 0 && (await status(reg.id)) === 'active')

      await tx.execute(sql`insert into certificates (cert_no, branch_id, registration_id, verification_hash) values ('CERT-CP1-T-1', ${a.id}, ${reg.id}, repeat('b', 64))`)
      await tx.execute(sql`update registrations set internship_completion = true where id = ${reg.id}`)
      c = (await completionStatus(tx, mgr, reg.id))!
      check('internship completion picked at admission: still missing', !c.ready && c.internship.needs === 'completion' && !c.internship.done)
      await tx.execute(sql`update registrations set internship_completion = false where id = ${reg.id}`)

      check('syllabus + certificate: completes', (await completeIfDone(tx, mgr, [reg.id, null])).length === 1 && (await status(reg.id)) === 'completed')
      check('a completed one is not completed twice', (await completeIfDone(tx, mgr, [reg.id])).length === 0)
      const [ev] = (await tx.execute<{ to_status: string; note: string }>(sql`select to_status::text, note from registration_events where registration_id = ${reg.id} and to_status = 'completed' limit 1`)).rows
      check('the change is in the registration history', ev?.to_status === 'completed' && /syllabus covered/.test(ev.note))

      // by hand
      const reg2 = await createRegistration(tx, counselor, { person: { firstName: 'Manual', phone: '9877700002' }, departmentId: dept.id, totalFee: 1000, enrollmentDate: '2026-10-01' })
      await throws(tx, 'a counselor cannot mark a course completed', () => markCompleted(tx, counselor, { registrationId: reg2.id, note: 'done' }), /Forbidden/)
      await throws(tx, 'a reason is needed', () => markCompleted(tx, mgr, { registrationId: reg2.id, note: '' }), /why/)
      const m = await markCompleted(tx, mgr, { registrationId: reg2.id, note: 'Finished outside the panel' })
      check('manager marks it completed; what was missing is kept', (await status(reg2.id)) === 'completed' && m.missing.length > 0)
      await throws(tx, 'cannot mark a completed one again', () => markCompleted(tx, mgr, { registrationId: reg2.id, note: 'again' }), /cannot be marked/)
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
