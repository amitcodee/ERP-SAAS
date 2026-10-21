// Report cards: the grading rules (lib/grades.ts), then one report card against the real DB (modules/academics/
// report-card.ts) inside ONE transaction that is rolled back: marks, overall result and grade, pass / fail, the rank
// in the batch (ties share a rank), what is still to be marked, attendance and the capstone.
import { sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { batches, batchMembers, branches, departments, users } from '../lib/db/schema'
import { applyTenant, type Actor } from '../lib/db/withTenant'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'
import { DEFAULT_GRADES, gradeOf, gradesProblem, overall, pctOf, ranks } from '../lib/grades'
import { reportCardIn } from '../modules/academics/report-card'
import { createRegistration } from '../modules/registrations/service'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }

async function main() {
  // ---- the rules
  check('grade bands: 90 is A+, 89.9 is A, 40 is D, 39 is E, 0 is E', gradeOf(90).grade === 'A+' && gradeOf(89.9).grade === 'A' && gradeOf(40).grade === 'D' && gradeOf(39).grade === 'E' && gradeOf(0).grade === 'E')
  check('bands in any order give the same grade', gradeOf(75, [...DEFAULT_GRADES.bands].reverse()).grade === 'B+')
  check('percent to one decimal', pctOf(2, 3) === 66.7 && pctOf(0, 0) === 0)
  check('overall is total marks over total maximums (not the average of percents)', overall([{ score: 9, maxScore: 10 }, { score: 10, maxScore: 100 }])?.pct === 17.3)
  check('nothing marked: no overall', overall([{ score: null, maxScore: 10 }]) === null)
  check('equal results share a rank (1, 2, 2, 4)', ranks([{ pct: 50 }, { pct: 90 }, { pct: 70 }, { pct: 70 }]).map((r) => r.rank).join() === '1,2,2,4')
  check('the standard bands are valid', gradesProblem(DEFAULT_GRADES) === null)
  check('bands without one at 0% are refused', !!gradesProblem({ bands: [{ min: 50, grade: 'P', label: '' }], passPct: 50 }))
  check('two bands at the same percent are refused', !!gradesProblem({ bands: [{ min: 0, grade: 'F', label: '' }, { min: 0, grade: 'P', label: '' }], passPct: 50 }))

  // ---- one report card
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [b] = await tx.insert(branches).values({ code: 'RC1', name: 'Report Pur' }).returning()
      const [u] = await tx.insert(users).values({ branchId: b.id, name: 'T', email: 'rc@test.invalid', passwordHash: 'x' }).returning()
      const [dept] = await tx.select().from(departments).limit(1)
      const mgr: Actor = { userId: u.id, orgId: ORG, role: 'branch_manager', branchId: b.id }
      await applyTenant(tx, mgr)
      const mk = (first: string, phone: string) => createRegistration(tx, mgr, { person: { firstName: first, phone }, departmentId: dept.id, totalFee: 100000, enrollmentDate: '2026-10-01' })
      const [ana, ben, cai] = [await mk('Ana', '9855500081'), await mk('Ben', '9855500082'), await mk('Cai', '9855500083')]
      await tx.execute(sql`reset role`)
      const [bt] = await tx.insert(batches).values({ branchId: b.id, name: 'Evening Web', departmentId: dept.id }).returning()
      for (const r of [ana, ben, cai]) await tx.insert(batchMembers).values({ batchId: bt.id, registrationId: r.id, branchId: b.id })
      const test = async (title: string, date: string, max: number, marks: [string, number | null][]) => {
        const [t] = (await tx.execute<{ id: string }>(sql`insert into tests (branch_id, batch_id, title, test_date, max_score, created_by) values (${b.id}, ${bt.id}, ${title}, ${date}, ${max}, ${u.id}) returning id`)).rows
        for (const [reg, score] of marks) await tx.execute(sql`insert into assessments (branch_id, registration_id, kind, title, score, max_score, test_id, created_by) values (${b.id}, ${reg}, 'test', ${title}, ${score}, ${max}, ${t.id}, ${u.id})`)
      }
      await test('HTML basics', '2026-10-05', 50, [[ana.id, 45], [ben.id, 30], [cai.id, 30]])
      await test('CSS layout', '2026-10-12', 50, [[ana.id, 40], [ben.id, 40], [cai.id, 40]])
      await test('JavaScript', '2026-10-19', 100, [[ana.id, null]]) // an answer sheet in, marks to come
      await tx.execute(sql`insert into assessments (branch_id, registration_id, kind, title, created_by) values (${b.id}, ${ana.id}, 'capstone', 'Portfolio site', ${u.id})`)
      const [s1] = (await tx.execute<{ id: string }>(sql`insert into class_sessions (batch_id, branch_id, session_date, created_by) values (${bt.id}, ${b.id}, '2026-10-05', ${u.id}) returning id`)).rows
      const [s2] = (await tx.execute<{ id: string }>(sql`insert into class_sessions (batch_id, branch_id, session_date, created_by) values (${bt.id}, ${b.id}, '2026-10-06', ${u.id}) returning id`)).rows
      await tx.execute(sql`insert into attendance (session_id, registration_id, branch_id, present) values (${s1.id}, ${ana.id}, ${b.id}, true), (${s2.id}, ${ana.id}, ${b.id}, false)`)

      const card = await reportCardIn(tx, ana.id, DEFAULT_GRADES)
      check('the student and course are on it', card?.student.name === 'Ana' && card.student.branch === 'Report Pur' && card.student.regNo === ana.regNo)
      check('each marked test with its percent and grade, in date order', card?.marks.map((m) => `${m.title}:${m.pct}:${m.grade}`).join() === 'HTML basics:90:A+,CSS layout:80:A', JSON.stringify(card?.marks))
      check('overall: 85 of 100 = 85%, grade A, a pass', card?.overall?.pct === 85 && card.overall.grade === 'A' && card.overall.passed && card.overall.score === 85 && card.overall.max === 100, JSON.stringify(card?.overall))
      check('a test still to be marked is counted, not scored', card?.pending === 1)
      check('rank 1 of the 3 marked in the batch', card?.rank?.rank === 1 && card.rank.of === 3 && card.rank.batch === 'Evening Web', JSON.stringify(card?.rank))
      const benCard = await reportCardIn(tx, ben.id, DEFAULT_GRADES), caiCard = await reportCardIn(tx, cai.id, DEFAULT_GRADES)
      check('equal results share second place', benCard?.rank?.rank === 2 && caiCard?.rank?.rank === 2 && benCard.overall?.pct === 70)
      check('attendance: 1 of 2 classes, 50%', card?.attendance.present === 1 && card.attendance.total === 2 && card.attendance.pct === 50)
      check('the capstone is shown, under review until approved', card?.capstone?.title === 'Portfolio site' && card.capstone.approved === false)
      const strict = await reportCardIn(tx, ben.id, { bands: DEFAULT_GRADES.bands, passPct: 75 })
      check('the institute’s pass mark decides pass / not yet', strict?.overall?.passed === false)
      check('an unknown registration has no report card', (await reportCardIn(tx, '00000000-0000-4000-8000-0000000000aa', DEFAULT_GRADES)) === null)
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) { console.error(e); failed++ }
  } finally {
    await pool.end()
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall checks passed (rolled back, DB untouched)')
  process.exit(failed ? 1 : 0)
}
main()
