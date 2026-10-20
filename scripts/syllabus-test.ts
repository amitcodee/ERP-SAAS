// Shared syllabus with head office approval, against the real DB in ONE rolled-back transaction: an academic manager's
// change waits (live topics unchanged), a second change is blocked, head office approves (live, ticks kept) or turns
// down; the author may withdraw; head office's own edits apply at once.
import { sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, courses, departments, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { decideSyllabusChange, listSyllabusChanges, saveSyllabus, setSyllabusFile } from '../modules/teaching/service'
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
      const [a] = await tx.insert(branches).values({ code: 'SYA', name: 'Syllabus A', status: 'active' }).returning()
      const [b] = await tx.insert(branches).values({ code: 'SYB', name: 'Syllabus B', status: 'active' }).returning()
      const mk = async (n: string, br: string | null) => (await tx.insert(users).values({ branchId: br, name: n, email: `${n}@syllabus.test.invalid`, passwordHash: 'x' }).returning())[0]
      const [ua, ub, us] = [await mk('ama', a.id), await mk('amb', b.id), await mk('sup', null)]
      const [dept] = await tx.select().from(departments).limit(1)
      const [course] = await tx.insert(courses).values({ departmentId: dept.id, title: 'Syllabus Course', baseFee: 0 } as typeof courses.$inferInsert).returning()
      const amA: Actor = { userId: ua.id, orgId: ORG, role: 'academic_manager', branchId: a.id }
      const amB: Actor = { userId: ub.id, orgId: ORG, role: 'academic_manager', branchId: b.id }
      const sup: Actor = { userId: us.id, orgId: ORG, role: 'super_admin', branchId: null }
      const live = async () => (await tx.execute<{ id: string; title: string }>(sql`select id, title from course_topics where course_id = ${course.id} order by sort_order`)).rows

      await applyTenant(tx, sup)
      await saveSyllabus(tx, sup, course.id, [{ module: 'M1', title: 'Intro' }, { module: 'M1', title: 'Basics' }])
      const t0 = await live()
      check('head office’s own edit is live at once', t0.map((t) => t.title).join() === 'Intro,Basics')

      await applyTenant(tx, amA)
      const r1 = await saveSyllabus(tx, amA, course.id, [{ id: t0[0].id, module: 'M1', title: 'Introduction' }, { module: 'M2', title: 'Advanced' }])
      check('an academic manager’s change waits for approval', r1.pending === true)
      check('…and the live syllabus is unchanged meanwhile', (await live()).map((t) => t.title).join() === 'Intro,Basics')
      await saveSyllabus(tx, amA, course.id, [{ id: t0[0].id, module: 'M1', title: 'Introduction' }, { module: 'M2', title: 'Advanced' }, { module: 'M2', title: 'Project' }])
      const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from syllabus_changes where course_id = ${course.id} and status = 'pending'`)).rows
      check('the author updates their own waiting change (still one)', n === 1)
      await setSyllabusFile(tx, amA, course.id, { fileName: 'syl.pdf', bytes: Buffer.from('%PDF-1.4\n%test\n') })
      await applyTenant(tx, amB)
      await throws(tx, 'another branch cannot send a second change while one waits', () => saveSyllabus(tx, amB, course.id, [{ module: null, title: 'Other', details: null }]), /waiting for head office/)
      await throws(tx, 'an academic manager cannot approve', async () => {
        const [c] = (await tx.execute<{ id: string }>(sql`select id from syllabus_changes where course_id = ${course.id} and status = 'pending'`)).rows
        await decideSyllabusChange(tx, amB, c.id, true, null)
      }, /Only head office/)

      // a trainer ticked "Intro" in a batch: the tick must survive the approval (same topic id)
      await applyTenant(tx, sup)
      const [batch] = (await tx.execute<{ id: string }>(sql`insert into batches (branch_id, name, department_id, course_id) values (${a.id}, 'SYL batch', ${dept.id}, ${course.id}) returning id`)).rows
      await tx.execute(sql`insert into batch_topics (batch_id, topic_id, branch_id, covered_on) values (${batch.id}, ${t0[0].id}, ${a.id}, '2026-10-01')`)
      const waiting = await listSyllabusChanges(tx, sup)
      const mine = waiting.find((w) => w.courseId === course.id)
      check('head office sees the waiting change with who sent it', !!mine && mine.topics === 3 && mine.file === 'replace' && mine.branch === 'Syllabus A')
      await decideSyllabusChange(tx, sup, mine!.id, true, null)
      const t1 = await live()
      check('approved: live for every branch', t1.map((t) => t.title).join() === 'Introduction,Advanced,Project', t1.map((t) => t.title).join())
      const [tick] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from batch_topics where topic_id = ${t0[0].id}`)).rows
      check('a topic kept (renamed) keeps the batches’ ticks', tick.n === 1)
      const [f] = (await tx.execute<{ file_name: string }>(sql`select file_name from course_syllabus_files where course_id = ${course.id}`)).rows
      check('the new syllabus file is live too', f?.file_name === 'syl.pdf')

      // turned down, and withdrawn
      await applyTenant(tx, amB)
      await saveSyllabus(tx, amB, course.id, [{ module: null, title: 'Only one topic', details: null }])
      await applyTenant(tx, sup)
      const [c2] = (await tx.execute<{ id: string }>(sql`select id from syllabus_changes where course_id = ${course.id} and status = 'pending'`)).rows
      await throws(tx, 'turning down needs a reason', () => decideSyllabusChange(tx, sup, c2.id, false, null), /Say why/)
      await decideSyllabusChange(tx, sup, c2.id, false, 'Too short')
      check('turned down: the live syllabus stays', (await live()).length === 3)
      await applyTenant(tx, amB)
      await saveSyllabus(tx, amB, course.id, [{ module: null, title: 'Second try', details: null }])
      const [c3] = (await tx.execute<{ id: string }>(sql`select id from syllabus_changes where course_id = ${course.id} and status = 'pending'`)).rows
      const w = await decideSyllabusChange(tx, amB, c3.id, false, null)
      check('the author can withdraw their change', w.status === 'withdrawn' && (await live()).length === 3)
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
