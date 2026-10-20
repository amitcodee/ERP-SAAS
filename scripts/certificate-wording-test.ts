// What a certificate prints, against the real DB in ONE rolled-back transaction: the course's name and tools by
// default, a customized course's title and modules, a name / tools asked for with the request — frozen at issue.
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { certHash } from '../lib/certificate-hash'
import { branches, certificates, courses, departments, lookups, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { approveCertificate, certificateWording, requestCertificate, verifyCertificateIn } from '../modules/certificates/service'
import { recordPayment } from '../modules/fees/service'
import { createRegistration } from '../modules/registrations/service'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(tx: Tx, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  await tx.execute(sql`savepoint sp`)
  try { await fn(); check(name, false, 'expected error') }
  catch (e) { await tx.execute(sql`rollback to savepoint sp`); const msg = String(e) + String((e as { cause?: unknown }).cause ?? ''); check(name, !match || match.test(msg), match ? msg.slice(0, 100) : '') }
}

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [a] = await tx.insert(branches).values({ code: 'CWD', name: 'Wording Branch', status: 'active' }).returning()
      const [u] = await tx.insert(users).values({ branchId: a.id, name: 'm', email: 'm@wording.test.invalid', passwordHash: 'x' }).returning()
      const [dept] = await tx.select().from(departments).limit(1)
      const [cash] = await tx.select().from(lookups).where(eq(lookups.value, 'Cash'))
      const [course] = await tx.insert(courses).values({ departmentId: dept.id, title: 'Civil CAD', baseFee: 50000, skills: 'AutoCAD, Revit; 3ds Max' } as typeof courses.$inferInsert).returning()
      const mgr: Actor = { userId: u.id, orgId: ORG, role: 'branch_manager', branchId: a.id }
      await applyTenant(tx, mgr)

      const reg = await createRegistration(tx, mgr, { person: { firstName: 'Wordy', phone: '9866700001' }, departmentId: dept.id, courseId: course.id, totalFee: 50000, enrollmentDate: '2026-07-01' })
      const w1 = await certificateWording(tx, reg.id)
      check('by default: the course name and its tools', w1?.course === 'Civil CAD' && w1.tools.join('|') === 'AutoCAD|Revit|3ds Max' && w1.toolsLabel === 'Tools', JSON.stringify(w1))

      const reg2 = await createRegistration(tx, mgr, { person: { firstName: 'Custom', phone: '9866700002' }, departmentId: dept.id, courseId: course.id, totalFee: 50000, enrollmentDate: '2026-07-01' })
      await tx.execute(sql`update registrations set course_id = null, custom_course_title = 'Interior Design Pro', custom_course = ${JSON.stringify({ modules: [{ name: 'SketchUp' }, { name: 'V-Ray' }] })}::jsonb where id = ${reg2.id}`)
      const w2 = await certificateWording(tx, reg2.id)
      check('a customized course: its own title and its modules', w2?.course === 'Interior Design Pro' && w2.tools.join('|') === 'SketchUp|V-Ray' && w2.toolsLabel === 'Modules', JSON.stringify(w2))

      // make the first student eligible: fees paid, a class attended, the capstone approved
      await recordPayment(tx, mgr, { registrationId: reg.id, amount: 50000, modeId: cash.id })
      const [b] = (await tx.execute<{ id: string }>(sql`insert into batches (branch_id, name, department_id, course_id) values (${a.id}, 'W batch', ${dept.id}, ${course.id}) returning id`)).rows
      const [s1] = (await tx.execute<{ id: string }>(sql`insert into class_sessions (branch_id, batch_id, session_date) values (${a.id}, ${b.id}, '2026-08-01') returning id`)).rows
      await tx.execute(sql`insert into attendance (session_id, registration_id, branch_id, present) values (${s1.id}, ${reg.id}, ${a.id}, true)`)
      await tx.execute(sql`insert into assessments (branch_id, registration_id, kind, title, approved_by, approved_at) values (${a.id}, ${reg.id}, 'capstone', 'Project', ${u.id}, now())`)
      await tx.execute(sql`update registrations set expected_end_date = '2026-09-01' where id = ${reg.id}`)

      // a different name and tools, asked for with the request
      const { request } = await requestCertificate(tx, mgr, reg.id, { courseTitle: '  BIM   with Revit ', tools: 'Revit\nNavisworks, Revit' })
      check('the request keeps the asked-for name and tools (cleaned, no repeats)', request.certCourseTitle === 'BIM with Revit' && request.certTools?.join('|') === 'Revit|Navisworks', JSON.stringify([request.certCourseTitle, request.certTools]))
      const cert = await approveCertificate(tx, mgr, request.id)
      check('issued: the words are frozen on the certificate', cert.courseTitle === 'BIM with Revit' && cert.tools?.join('|') === 'Revit|Navisworks' && cert.toolsLabel === 'Tools', JSON.stringify([cert.courseTitle, cert.tools, cert.toolsLabel]))
      const v = await verifyCertificateIn(tx, cert.verificationHash)
      check('the certificate and its public check show them', v.found && v.course === 'BIM with Revit' && v.modules.join('|') === 'Revit|Navisworks' && v.toolsLabel === 'Tools', JSON.stringify(v.found ? [v.course, v.modules, v.toolsLabel] : v))
      await tx.execute(sql`update courses set title = 'Renamed course', skills = 'Other' where id = ${course.id}`)
      const v2 = await verifyCertificateIn(tx, cert.verificationHash)
      check('renaming the course later does not change an issued certificate', v2.found && v2.course === 'BIM with Revit')
      await throws(tx, 'the printed words cannot be edited', () => tx.execute(sql`update certificates set course_title = 'Forged' where id = ${cert.id}`), /immutable|permission denied/)

      // a certificate issued while its course had no skills yet (stored with none): it lists the course's skills
      const reg3 = await createRegistration(tx, mgr, { person: { firstName: 'Early', phone: '9866700003' }, departmentId: dept.id, courseId: course.id, totalFee: 50000, enrollmentDate: '2026-07-01' })
      const at = new Date()
      const [early] = await tx.insert(certificates).values({ certNo: 'CERT-CWD-EARLY', branchId: a.id, registrationId: reg3.id, issuedAt: at, verificationHash: certHash(ORG, 'CERT-CWD-EARLY', reg3.id, at), tools: [], toolsLabel: 'Tools' } as typeof certificates.$inferInsert).returning()
      const v3 = await verifyCertificateIn(tx, early.verificationHash)
      check('a certificate issued with no tools lists the course’s current skills', v3.found && v3.modules.join('|') === 'AutoCAD|Revit|3ds Max' && v3.toolsLabel === 'Tools', JSON.stringify(v3.found ? [v3.modules, v3.toolsLabel] : v3))

      // asked for "as the course": nothing extra stored
      const r2 = await requestCertificate(tx, mgr, reg2.id, { courseTitle: 'Interior Design Pro', tools: ['SketchUp', 'V-Ray'] })
      check('the same words as the course are not stored as custom', r2.request.certCourseTitle === null && r2.request.certTools === null)
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
