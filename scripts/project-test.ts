// The capstone project and the project completion certificate, against the real DB in ONE rolled-back transaction:
// the student names the project, the trainer checks, corrects and approves it, and the certificate prints that title.
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { certHash } from '../lib/certificate-hash'
import { projectCertInput } from '../lib/cert-course-input'
import { projectCertOps } from '../lib/cert-project'
import { assessments, branches, certificates, departments, persons, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { addAssessment, approveCapstone, submitMyProject } from '../modules/academics/service'
import { verifyCertificateIn } from '../modules/certificates/service'
import { myStudy } from '../modules/portal/study'
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
    const msg = String(e) + ' ' + String((e as { cause?: unknown }).cause ?? '') + ' ' + JSON.stringify((e as { issues?: unknown }).issues ?? '')
    check(name, !match || match.test(msg), match ? msg.slice(0, 100).replace(/\s+/g, ' ') : '')
  }
}
const as = async (tx: Tx, a: Actor) => { await tx.execute(sql`reset role`); await applyTenant(tx, a) }

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [b] = await tx.insert(branches).values({ code: 'PJ1', name: 'Techcadd Projects' }).returning()
      const mk = async (name: string) => (await tx.insert(users).values({ branchId: b.id, name, email: `${name}@pj.test.invalid`, passwordHash: 'x' }).returning())[0]
      const [uc, um] = [await mk('c'), await mk('m')]
      const [dept] = await tx.select().from(departments).limit(1)
      const counselor: Actor = { userId: uc.id, orgId: ORG, role: 'counselor', branchId: b.id }
      const mgr: Actor = { userId: um.id, orgId: ORG, role: 'branch_manager', branchId: b.id }
      await as(tx, mgr)
      const r1 = await createRegistration(tx, counselor, { person: { firstName: 'Chirag', lastName: 'Garg', phone: '9300000011' }, departmentId: dept.id, totalFee: 1000000, enrollmentDate: '2026-07-20' })
      const r2 = await createRegistration(tx, counselor, { person: { firstName: 'Other', phone: '9300000012' }, departmentId: dept.id, totalFee: 1000000, enrollmentDate: '2026-07-20' })
      await tx.update(persons).set({ fatherName: 'Deepak Kumar' }).where(eq(persons.id, r1.personId))
      const l1 = await createStudentLogin(tx, mgr, { registrationId: r1.id, email: 'chirag@pj.test.invalid' })
      const [p1] = await tx.select().from(persons).where(eq(persons.userId, l1.user.id))
      const student: Actor = { userId: l1.user.id, orgId: ORG, role: 'student', branchId: b.id, personId: p1.id }
      const caps = async (regId: string) => tx.select().from(assessments).where(sql`${assessments.registrationId} = ${regId} and ${assessments.kind} = 'capstone'`)

      // ---- the student names the project ------------------------------------------------
      await as(tx, student)
      await throws(tx, 'the placeholder is not a project title', () => submitMyProject(tx, student, r1.id, { title: 'Capstone project' }), /real name/)
      await throws(tx, 'a title is needed', () => submitMyProject(tx, student, r1.id, { title: '  ' }), /project title/)
      await submitMyProject(tx, student, r1.id, { title: '  Student   managment  System ', tools: 'React,  Node.js\nMySQL, ' })
      await submitMyProject(tx, student, r1.id, { title: 'Student managment System', tools: 'React, Node.js, MySQL, Tailwind CSS' })
      const [mine] = await caps(r1.id)
      check('the student\'s project is saved, spaces tidied, one record when changed', (await caps(r1.id)).length === 1 && mine.title === 'Student managment System' && mine.tools === 'React, Node.js, MySQL, Tailwind CSS' && !mine.approvedAt)
      await throws(tx, 'a student cannot name another student\'s project', () => submitMyProject(tx, student, r2.id, { title: 'Not mine' }), /not found/)
      await throws(tx, 'staff cannot use the student\'s form', () => submitMyProject(tx, mgr, r1.id, { title: 'Staff try' }), /Forbidden/)
      const study = await myStudy(tx, student)
      check('the portal shows the project and its tools', study.some((s) => s.grades.some((g) => g.kind === 'capstone' && g.title === 'Student managment System' && g.tools === 'React, Node.js, MySQL, Tailwind CSS' && !g.approved)))

      // ---- the trainer checks, corrects and approves ------------------------------------
      await as(tx, mgr)
      await approveCapstone(tx, mgr, mine.id, { title: 'Student Management System', tools: 'React, Node.js, Express.js, MySQL, Tailwind CSS' })
      const [ok] = await caps(r1.id)
      check('approved with the corrected title and tools', !!ok.approvedAt && ok.approvedBy === mgr.userId && ok.title === 'Student Management System' && ok.tools === 'React, Node.js, Express.js, MySQL, Tailwind CSS')
      await as(tx, student)
      await throws(tx, 'once approved the student cannot change it', () => submitMyProject(tx, student, r1.id, { title: 'Something else' }), /already approved/)
      // a project recorded before students named them ("Capstone project") needs a real title to be approved
      await as(tx, mgr)
      const old = await tx.insert(assessments).values({ branchId: b.id, registrationId: r2.id, kind: 'capstone', title: 'Capstone project', createdBy: mgr.userId }).returning()
      await throws(tx, 'an unnamed project cannot be approved', () => approveCapstone(tx, mgr, old[0].id), /real name/)
      await approveCapstone(tx, mgr, old[0].id, { title: 'Library System' })
      check('approved once the trainer names it', (await caps(r2.id))[0].title === 'Library System')
      await throws(tx, 'the trainer records a project only with a real title', () => addAssessment(tx, mgr, { registrationId: r1.id, kind: 'capstone', title: '' }), /title is required/)

      // ---- the project completion certificate prints the approved project -----------------
      await tx.execute(sql`reset role`)
      const issuedAt = new Date()
      const certNo = `PJ-TEST-${Date.now()}`
      await tx.insert(certificates).values({ certNo, branchId: b.id, registrationId: r1.id, issuedAt, verificationHash: certHash(ORG, certNo, r1.id, issuedAt) })
      const v = await verifyCertificateIn(tx, certHash(ORG, certNo, r1.id, issuedAt))
      check('the verification carries the approved project', v.found && v.project?.title === 'Student Management System' && v.project.tools.join('|') === 'React|Node.js|Express.js|MySQL|Tailwind CSS')
      if (v.found) {
        const input = projectCertInput(v)
        const texts = projectCertOps(input).flatMap((o) => (o.k === 'text' ? [o.s] : []))
        check('the certificate prints the student, father, project, tools, registration and branch',
          texts.includes('Chirag Garg') && texts.includes('Mr. Deepak Kumar') && texts.includes('Student Management System') && texts.some((t) => t.startsWith('React, Node.js, Express.js'))
          && texts.includes(r1.regNo) && texts.includes('projects branch') && texts.includes('PROJECT COMPLETION'), texts.join(' / ').slice(0, 300))
        const noProject = projectCertInput({ ...v, project: null })
        check('an older certificate without a named project prints the course', noProject.project === v.course && noProject.tools === v.modules)
      }
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
