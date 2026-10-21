// Creates a repeatable local/demo dataset for exercising the full institute workflow.
// Run `pnpm db:seed:demo` after `pnpm db:migrate`. All demo logins use Demo@12345.
import { hash } from '@node-rs/argon2'
import { and, eq } from 'drizzle-orm'
import { approveCertificate, requestCertificate, clearCertificateFees } from '@/modules/certificates/service'
import { createEnquiry } from '@/modules/enquiries/service'
import { getBalance, recordPayment } from '@/modules/fees/service'
import { createRegistration } from '@/modules/registrations/service'
import { db, pool } from '@/lib/db/client'
import {
  assessments, attendance, batchMembers, batches, branches, certificateRequests, classSessions, courses, departments,
  enquiries, feeChangeRequests, installments, lookups, payments, personOccupations, persons, registrations,
  roles, settings, users, userRoles,
} from '@/lib/db/schema'
import { withOrgSystem, type Actor, type Tx } from '@/lib/db/withTenant'
import { SAMPLE_ORG_ID as ORG } from '@/lib/db/schema/tenancy'

const DEMO_BRANCH = 'DEMO'
const DEMO_PASSWORD = 'Demo@12345'
const COURSE_DATA = [
  ['CSE-IT', 'Full Stack Web Development', 3000000, 16],
  ['Graphic Designing', 'Graphic Design Professional', 2400000, 12],
  ['Digital Marketing', 'Digital Marketing Professional', 2200000, 12],
  ['CAD/CAM', 'AutoCAD Mechanical', 1800000, 10],
  ['Video Editing', 'Video Editing Professional', 2600000, 14],
  ['Robotics', 'Robotics and IoT', 2800000, 16],
] as const

async function one<T>(tx: Tx, query: Promise<T[]>) {
  const [row] = await query
  if (!row) throw new Error('Demo seed expected a row but found none')
  return row
}

async function ensureUser(tx: Tx, branchId: string, name: string, email: string, role: string) {
  const existing = await tx.select().from(users).where(eq(users.email, email))
  const user = existing[0] ?? await one(tx, tx.insert(users).values({
    branchId, name, email, passwordHash: await hash(DEMO_PASSWORD),
  }).returning())
  await tx.insert(userRoles).values({ userId: user.id, role }).onConflictDoNothing()
  return user
}

async function ensureCourse(tx: Tx, departmentId: string, title: string, baseFee: number, durationWeeks: number) {
  const existing = await tx.select().from(courses).where(and(eq(courses.departmentId, departmentId), eq(courses.title, title)))
  return existing[0] ?? await one(tx, tx.insert(courses).values({ departmentId, title, baseFee, durationWeeks, skills: title }).returning())
}

async function ensureRegistration(tx: Tx, actor: Actor, phone: string, input: Parameters<typeof createRegistration>[2]) {
  const existingPerson = await tx.select().from(persons).where(and(eq(persons.branchId, actor.branchId!), eq(persons.phoneNorm, phone)))
  const existing = existingPerson[0]
    ? await tx.select().from(registrations).where(eq(registrations.personId, existingPerson[0].id))
    : []
  return existing[0] ?? await createRegistration(tx, actor, input, { quiet: true })
}

async function addAttendance(tx: Tx, branchId: string, batchId: string, registrationId: string, trainerId: string, presentCount: number, total: number) {
  for (let i = 0; i < total; i++) {
    const date = `2026-09-${String(i + 1).padStart(2, '0')}`
    const session = await one(tx, tx.insert(classSessions).values({
      branchId, batchId, sessionDate: date, topic: `Module ${i + 1}`, createdBy: trainerId,
    }).onConflictDoNothing().returning())
      .catch(async () => one(tx, tx.select().from(classSessions).where(and(eq(classSessions.batchId, batchId), eq(classSessions.sessionDate, date)))))
    await tx.insert(attendance).values({
      sessionId: session.id, registrationId, branchId, present: i < presentCount, markedBy: trainerId,
    }).onConflictDoNothing()
  }
}

async function main() {
  await withOrgSystem(ORG, async (tx) => {
    const branch = (await tx.select().from(branches).where(eq(branches.code, DEMO_BRANCH)))[0]
      ?? await one(tx, tx.insert(branches).values({
        code: DEMO_BRANCH, certCode: 'DEMO', name: 'Demo Branch', city: 'Ludhiana',
        state: 'Punjab', pincode: '141001', status: 'active', activatedAt: new Date(),
      }).returning())

    const manager = await ensureUser(tx, branch.id, 'Demo Branch Manager', 'demo.manager@demo.test', 'branch_manager')
    const accountant = await ensureUser(tx, branch.id, 'Demo Accountant', 'demo.accountant@demo.test', 'accountant')
    const trainer = await ensureUser(tx, branch.id, 'Demo Trainer', 'demo.trainer@demo.test', 'trainer')
    const counselor = await ensureUser(tx, branch.id, 'Demo Counselor', 'demo.counselor@demo.test', 'counselor')
    const actor: Actor = { userId: manager.id, orgId: ORG, role: 'branch_manager', branchId: branch.id }
    const accountantActor: Actor = { userId: accountant.id, orgId: ORG, role: 'accountant', branchId: branch.id }

    const departmentRows = await tx.select().from(departments)
    const department = departmentRows.find((d) => d.name === 'CSE-IT') ?? departmentRows[0]
    if (!department) throw new Error('Run pnpm db:seed first so departments exist')
    const course = await ensureCourse(tx, department.id, COURSE_DATA[0][1], COURSE_DATA[0][2], COURSE_DATA[0][3])
    for (const [name, title, fee, weeks] of COURSE_DATA.slice(1)) {
      const d = departmentRows.find((row) => row.name === name)
      if (d) await ensureCourse(tx, d.id, title, fee, weeks)
    }

    const mode = await one(tx, tx.select().from(lookups).where(and(eq(lookups.kind, 'payment_mode'), eq(lookups.value, 'Online'))))
    const source = await one(tx, tx.select().from(lookups).where(and(eq(lookups.kind, 'enquiry_source'), eq(lookups.value, 'Website'))))
      .catch(async () => one(tx, tx.select().from(lookups).where(and(eq(lookups.kind, 'enquiry_source'), eq(lookups.value, 'Reference')))))
    const occupation = await one(tx, tx.select().from(lookups).where(and(eq(lookups.kind, 'occupation_type'), eq(lookups.value, 'Student'))))
    await tx.insert(settings).values({ branchId: branch.id, key: 'certificate.min_attendance_pct', value: 80 }).onConflictDoNothing()

    const riya = (await tx.select().from(persons).where(and(eq(persons.branchId, branch.id), eq(persons.phoneNorm, '9800000001'))))[0]
    const existingEnquiry = riya
      ? (await tx.select().from(enquiries).where(eq(enquiries.personId, riya.id)))[0]
      : undefined
    const enquiry = existingEnquiry
      ? { enquiry: existingEnquiry }
      : await createEnquiry(tx, actor, {
        person: { firstName: 'Riya', lastName: 'Sharma', phone: '9800000001', email: 'riya.demo@demo.test' },
        sourceId: source.id, departmentId: department.id, courseId: course.id, courseFee: 3000000,
        proposedFee: 2800000, actualFee: 2800000,
        lead: { visited: true, interested: true, interestPct: 90, callDone: true, callRemark: 'Demo enquiry for admission and follow-up testing' },
        occupation: { typeId: occupation.id },
      }, { quiet: true })
    const eligible = await ensureRegistration(tx, actor, '9800000001', {
      enquiryId: enquiry.enquiry.id, enrollmentDate: '2026-08-20', joiningDate: '2026-09-01',
      courseHours: 160, classDaysPerWeek: 5, classMinutesPerDay: 120, projectCertificate: true,
    })

    const due = await ensureRegistration(tx, actor, '9800000002', {
      person: { firstName: 'Arjun', lastName: 'Kumar', phone: '9800000002', email: 'arjun.demo@demo.test' },
      departmentId: department.id, courseId: course.id, totalFee: 3000000, listFee: 3000000,
      enrollmentDate: '2026-09-01', joiningDate: '2026-09-05',
    })
    const lowAttendance = await ensureRegistration(tx, actor, '9800000003', {
      person: { firstName: 'Simran', lastName: 'Kaur', phone: '9800000003', email: 'simran.demo@demo.test' },
      departmentId: department.id, courseId: course.id, totalFee: 2400000, enrollmentDate: '2026-09-01',
    })

    const paid = await getBalance(tx, eligible.id)
    if (paid.balance > 0) await recordPayment(tx, actor, { registrationId: eligible.id, amount: paid.balance, modeId: mode.id, txnRef: 'DEMO-RIYA-FULL' })
    const dueBalance = await getBalance(tx, due.id)
    if (dueBalance.paid === 0) await recordPayment(tx, actor, {
      registrationId: due.id, amount: 1000000, modeId: mode.id, txnRef: 'DEMO-ARJUN-PART',
      nextInstallmentDate: '2026-11-01', nextInstallmentAmount: 1000000,
    })
    const lowBalance = await getBalance(tx, lowAttendance.id)
    if (lowBalance.balance > 0) await recordPayment(tx, actor, { registrationId: lowAttendance.id, amount: lowBalance.balance, modeId: mode.id, txnRef: 'DEMO-SIMRAN-FULL' })

    const batch = (await tx.select().from(batches).where(and(eq(batches.branchId, branch.id), eq(batches.name, 'DEMO Full Stack Morning'))))[0]
      ?? await one(tx, tx.insert(batches).values({
        branchId: branch.id, name: 'DEMO Full Stack Morning', departmentId: department.id, courseId: course.id,
        trainerId: trainer.id, days: [1, 3, 5], startTime: '09:00', endTime: '11:00', room: 'Demo Lab',
        startDate: '2026-09-01', capacity: 30,
      }).returning())
    for (const registration of [eligible, due, lowAttendance]) {
      await tx.insert(batchMembers).values({ batchId: batch.id, registrationId: registration.id, branchId: branch.id }).onConflictDoNothing()
    }
    await addAttendance(tx, branch.id, batch.id, eligible.id, trainer.id, 9, 10)
    await addAttendance(tx, branch.id, batch.id, due.id, trainer.id, 8, 10)
    await addAttendance(tx, branch.id, batch.id, lowAttendance.id, trainer.id, 5, 10)
    await tx.insert(assessments).values([
      { branchId: branch.id, registrationId: eligible.id, kind: 'capstone', title: 'Institute Management Portal', score: 92, maxScore: 100, approvedBy: trainer.id, approvedAt: new Date(), createdBy: trainer.id },
      { branchId: branch.id, registrationId: due.id, kind: 'capstone', title: 'Pending fee student project', score: 78, maxScore: 100, createdBy: trainer.id },
      { branchId: branch.id, registrationId: lowAttendance.id, kind: 'capstone', title: 'Attendance blocker project', score: 88, maxScore: 100, approvedBy: trainer.id, approvedAt: new Date(), createdBy: trainer.id },
    ]).onConflictDoNothing()

    const existingRequest = (await tx.select().from(certificateRequests).where(eq(certificateRequests.registrationId, eligible.id)))[0]
    if (!existingRequest) {
      const requested = await requestCertificate(tx, actor, eligible.id)
      // a branch manager who can both request and clear skips the accounts step for their own requests
      if (!requested.request.feeClearedAt) await clearCertificateFees(tx, accountantActor, requested.request.id)
      await approveCertificate(tx, actor, requested.request.id)
    }
    if (!(await tx.select().from(certificateRequests).where(eq(certificateRequests.registrationId, due.id))).length) await requestCertificate(tx, actor, due.id)
    if (!(await tx.select().from(certificateRequests).where(eq(certificateRequests.registrationId, lowAttendance.id))).length) await requestCertificate(tx, actor, lowAttendance.id)

    console.log('Demo data ready')
    console.log('Logins: demo.manager@demo.test, demo.accountant@demo.test, demo.trainer@demo.test, demo.counselor@demo.test')
    console.log(`Password: ${DEMO_PASSWORD}`)
    console.log(`Branch: ${branch.name} (${branch.code})`)
    console.log(`Students: ${eligible.regNo} eligible/certificate issued, ${due.regNo} fee due, ${lowAttendance.regNo} attendance blocker`)
  })
  await pool.end()
}

main().catch(async (error) => {
  console.error(error)
  await pool.end()
  process.exit(1)
})
