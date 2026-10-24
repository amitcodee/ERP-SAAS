// Whole journey against the real DB in ONE rolled-back transaction:
// enquiry -> registration -> fees -> batch -> attendance -> capstone -> certificate -> public verify.
import { createHmac } from 'crypto'
import { eq, sql } from 'drizzle-orm'
import { serverSecret } from '../lib/auth/secret'
import { certHash, certHashMatches } from '../lib/certificate-hash'
import { db, pool } from '../lib/db/client'
import { branches, departments, lookups, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { addAssessment, addBatchMember, approveCapstone, batchRoster, createBatch, createSession, markAttendance } from '../modules/academics/service'
import { approveCertificate, certificateOverview, issueCertificates, clearCertificateFees, getEligibility, rejectCertificate, requestCertificate, revokeCertificate, verifyCertificateIn } from '../modules/certificates/service'
import { certificateDesk } from '../modules/certificates/documents'
import { createEnquiry } from '../modules/enquiries/service'
import { recordPayment } from '../modules/fees/service'
import { createRegistration } from '../modules/registrations/service'
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
    check(name, !match || match.test(msg), match ? msg.slice(0, 110).replace(/\s+/g, ' ') : '')
  }
}

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [a] = await tx.insert(branches).values({ code: 'CA1', name: 'Cert A' }).returning()
      const mk = async (name: string) => (await tx.insert(users).values({ branchId: a.id, name, email: `${name}@cert.test.invalid`, passwordHash: 'x' }).returning())[0]
      const [uc, ut, um, uacc, ut2] = [await mk('c'), await mk('t'), await mk('m'), await mk('acc'), await mk('t2')]
      const [dept] = await tx.select().from(departments).limit(1)
      const [cash] = await tx.select().from(lookups).where(eq(lookups.value, 'Cash'))
      const counselor: Actor = { userId: uc.id, orgId: ORG, role: 'counselor', branchId: a.id }
      const trainer: Actor = { userId: ut.id, orgId: ORG, role: 'trainer', branchId: a.id }
      const otherTrainer: Actor = { userId: ut2.id, orgId: ORG, role: 'trainer', branchId: a.id }
      const mgr: Actor = { userId: um.id, orgId: ORG, role: 'branch_manager', branchId: a.id }
      const acct: Actor = { userId: uacc.id, orgId: ORG, role: 'accountant', branchId: a.id }
      await applyTenant(tx, mgr)

      const enq = await createEnquiry(tx, counselor, { person: { firstName: 'Asha', lastName: 'Gill', phone: '9866600001' }, departmentId: dept.id, proposedFee: 1000000 })
      const reg = await createRegistration(tx, counselor, { enquiryId: enq.enquiry.id, enrollmentDate: '2026-10-01' })
      const batch = await createBatch(tx, mgr, { name: 'CSE Morning', departmentId: dept.id, trainerId: ut.id, capacity: 1 })
      await addBatchMember(tx, mgr, batch.id, reg.id)
      await throws(tx, 'batch capacity enforced', async () => {
        const r2 = await createRegistration(tx, counselor, { person: { firstName: 'Extra', phone: '9866600002' }, departmentId: dept.id, totalFee: 100, enrollmentDate: '2026-10-01' })
        await addBatchMember(tx, mgr, batch.id, r2.id)
      }, /full/)

      let el = await getEligibility(tx, reg.id)
      check('starts NOT eligible with three exact blockers', !el.eligible && el.reasons.length === 3, el.reasons.join(' | '))
      check('fee blocker shows the amount', el.reasons.some((r) => /Fees: ₹10,000 pending/.test(r)))

      await throws(tx, 'accounts cannot clear fees while money is due', async () => {
        const { request } = await requestCertificate(tx, counselor, reg.id)
        await clearCertificateFees(tx, acct, request.id)
      }, /still due/)
      // the branch manager needs no accounts step, but still cannot issue while fees are due
      await throws(tx, 'the branch manager skips accounts, but not unpaid fees', async () => {
        const { request } = await requestCertificate(tx, counselor, reg.id)
        await approveCertificate(tx, mgr, request.id)
      }, /Fees: ₹10,000 pending/)

      // fees
      await recordPayment(tx, counselor, { registrationId: reg.id, amount: 1000000, modeId: cash.id })
      // attendance: 10 sessions, present 7 -> 70% (blocks), then 9/10... use 5 more present
      const days = Array.from({ length: 10 }, (_, i) => `2026-10-${String(i + 2).padStart(2, '0')}`)
      const sessions: Awaited<ReturnType<typeof createSession>>[] = []
      for (const d of days) sessions.push(await createSession(tx, trainer, { batchId: batch.id, sessionDate: d }))
      await throws(tx, 'another trainer cannot mark attendance for this batch', () => markAttendance(tx, otherTrainer, sessions[0].id, [{ registrationId: reg.id, present: true }]), /not your batch/)
      for (let i = 0; i < 10; i++) await markAttendance(tx, trainer, sessions[i].id, [{ registrationId: reg.id, present: i < 7 }])
      el = await getEligibility(tx, reg.id)
      check('attendance 70% shown exactly like the spec', el.reasons.includes('Attendance: 70% (need 80%)'), el.reasons.join(' | '))
      check('fees now clear', el.feeBalance === 0 && !el.reasons.some((r) => r.startsWith('Fees')))

      // fix attendance: flip 2 absences to present -> 90%
      await markAttendance(tx, trainer, sessions[7].id, [{ registrationId: reg.id, present: true }])
      await markAttendance(tx, trainer, sessions[8].id, [{ registrationId: reg.id, present: true }])
      el = await getEligibility(tx, reg.id)
      check('90% attendance passes; only capstone blocks', el.attendancePct === 90 && el.reasons.length === 1 && /Capstone/.test(el.reasons[0]), el.reasons.join(' | '))

      await addAssessment(tx, trainer, { registrationId: reg.id, kind: 'test', title: 'Unit 1', score: 40, maxScore: 50 })
      await addAssessment(tx, trainer, { registrationId: reg.id, kind: 'assignment', title: 'HW 1', score: 6, maxScore: 10 })
      const rosterNow = await batchRoster(tx, trainer, batch.id)
      check('roster shows the average of graded work (80% and 60% -> 70%)', rosterNow.rows[0].avgScore === 70 && rosterNow.rows[0].graded === 2, String(rosterNow.rows[0].avgScore))
      await throws(tx, 'score above the maximum is rejected', () => addAssessment(tx, trainer, { registrationId: reg.id, kind: 'test', title: 'Bad', score: 11, maxScore: 10 }), /between 0 and/)
      await throws(tx, 'a test needs marks', () => addAssessment(tx, trainer, { registrationId: reg.id, kind: 'test', title: 'No marks' }), /required/)
      await throws(tx, 'other trainer cannot grade my student', () => addAssessment(tx, otherTrainer, { registrationId: reg.id, kind: 'test', title: 'x', score: 1, maxScore: 2 }), /not in your batch/)
      await throws(tx, 'counselor cannot grade', () => addAssessment(tx, counselor, { registrationId: reg.id, kind: 'test', title: 'x', score: 1, maxScore: 2 }), /Forbidden/)
      const cap = await addAssessment(tx, trainer, { registrationId: reg.id, kind: 'capstone', title: 'Final project' })
      await throws(tx, 'counselor cannot approve a capstone', () => approveCapstone(tx, counselor, cap.id), /Forbidden/)
      await approveCapstone(tx, trainer, cap.id)
      el = await getEligibility(tx, reg.id)
      check('all three gates clear -> eligible', el.eligible && el.reasons.length === 0)

      // request/approve
      const overview = await certificateOverview(tx, mgr)
      check('overview lists the student as eligible', overview.find((o) => o.registrationId === reg.id)?.eligibility.eligible === true)
      const pending = (await requestCertificate(tx, counselor, reg.id)).request
      check('request made when eligible has no blockers recorded', (pending.blockingReasons as string[]).length === 0)
      await throws(tx, 'a trainer cannot issue certificates', () => approveCertificate(tx, trainer, pending.id), /Forbidden/)
      await throws(tx, 'a counselor cannot clear fees (that is accounts)', () => clearCertificateFees(tx, counselor, pending.id), /Forbidden/)
      await throws(tx, 'a counselor cannot issue certificates', () => approveCertificate(tx, counselor, pending.id), /Forbidden/)
      await throws(tx, 'accounts cannot issue before the fees are cleared', () => approveCertificate(tx, acct, pending.id), /not cleared the fees/)
      await clearCertificateFees(tx, acct, pending.id)
      await throws(tx, 'fees cannot be cleared twice', () => clearCertificateFees(tx, acct, pending.id), /already cleared/)
      check('overview shows the clearance', (await certificateOverview(tx, mgr)).find((o) => o.registrationId === reg.id)?.feeCleared === true)
      const cert = await approveCertificate(tx, acct, pending.id) // accounts cleared the fees -> accounts issues the certificate
      check('certificate number format + 64-char hash', /^CERT-CA1-\d{4}-0001$/.test(cert.certNo) && cert.verificationHash.length === 64, cert.certNo)
      await throws(tx, 'cannot request again after issue', () => requestCertificate(tx, counselor, reg.id), /already been issued/)

      const v = await verifyCertificateIn(tx, cert.verificationHash)
      check('public verification returns holder and course', v.found && v.name === 'Asha Gill' && !v.revoked)
      const bad = await verifyCertificateIn(tx, cert.verificationHash.slice(0, 63) + (cert.verificationHash.endsWith('0') ? '1' : '0'))
      check('a one-character-off hash is NOT found', !bad.found)
      // v2 hashes carry the org: the same certificate under another org's id does not match, and the hash from before
      // organisations (v1) still verifies, in the Sample Institute only
      const ident = { orgId: ORG, certNo: cert.certNo, registrationId: cert.registrationId, issuedAt: cert.issuedAt }
      const OTHER = '00000000-0000-4000-8000-0000000000ff'
      check('the issued hash is the v2 hash of its org', cert.verificationHash === certHash(ORG, cert.certNo, cert.registrationId, cert.issuedAt) && certHashMatches(ident, cert.verificationHash))
      check('... and does not match under another org', !certHashMatches({ ...ident, orgId: OTHER }, cert.verificationHash))
      const v1 = createHmac('sha256', serverSecret('CERT_SECRET')).update(`${cert.certNo}|${cert.registrationId}|${cert.issuedAt.toISOString()}`).digest('hex')
      check('a v1 hash still verifies in the Sample Institute', certHashMatches(ident, v1))
      check('... but never in another org', !certHashMatches({ ...ident, orgId: OTHER }, v1))
      await throws(tx, 'tampering with the stored hash is rejected by the DB', () => tx.execute(sql`update certificates set verification_hash = repeat('a', 64)`), /immutable|permission denied/)
      await throws(tx, 'certificates cannot be deleted', () => tx.execute(sql`delete from certificates`), /permission denied|cannot be deleted/)

      // revoking: head office only (the app, and the database too)
      await throws(tx, 'a branch manager cannot revoke', () => revokeCertificate(tx, mgr, cert.id, 'issued in error'), /Only head office/)
      await throws(tx, 'the database refuses a revoke that is not head office', () => tx.execute(sql`update certificates set is_revoked = true where id = ${cert.id}`), /only head office/)
      const head: Actor = { userId: um.id, orgId: ORG, role: 'super_admin', branchId: null }
      await tx.execute(sql`reset role`); await applyTenant(tx, head)
      await throws(tx, 'a reason is needed', () => revokeCertificate(tx, head, cert.id, ' '), /reason/)
      const rv = await revokeCertificate(tx, head, cert.id, 'issued in error')
      check('revoked by head office, with who and when', rv.isRevoked && rv.revokedBy === um.id && !!rv.revokedAt)
      await throws(tx, 'cannot revoke twice', () => revokeCertificate(tx, head, cert.id, 'again'), /already revoked/)
      await tx.execute(sql`reset role`); await applyTenant(tx, mgr)
      const v2 = await verifyCertificateIn(tx, cert.verificationHash)
      check('revoked certificate still verifies but is flagged REVOKED', v2.found && v2.revoked && v2.revokedReason === 'issued in error')
      await throws(tx, 'a revoked certificate cannot be un-revoked', () => tx.execute(sql`update certificates set is_revoked = false`), /un-revoked|permission denied/)
      const deskRow = async () => (await certificateDesk(tx, mgr, { list: 'requests', today: '2027-01-01', branchId: a.id })).rows.find((x) => x.registrationId === reg.id)
      check('the desk shows it revoked, with the reason', (await deskRow())?.stage === 'revoked' && (await deskRow())?.revoked?.reason === 'issued in error')

      // the student no longer sees it
      const student: Actor = { userId: uc.id, orgId: ORG, role: 'student', branchId: a.id, personId: reg.personId }
      await tx.execute(sql`reset role`); await applyTenant(tx, student)
      const [seen] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from certificates where registration_id = ${reg.id}`)).rows
      check('the student cannot see the revoked certificate', seen.n === 0)
      check('... nor in their portal overview', !(await certificateOverview(tx, student)).find((o) => o.registrationId === reg.id)?.certificateId)
      await tx.execute(sql`reset role`); await applyTenant(tx, mgr)

      // issued again: a new request, a new number; the old one stays revoked
      const again = (await requestCertificate(tx, counselor, reg.id)).request
      check('after revoking, the certificate can be requested again', !!again.id)
      check('the desk follows the new request', ['waiting', 'approved'].includes((await deskRow())?.stage ?? ''), (await deskRow())?.stage)
      // issued with another at once (Issue all ready): the eligible one is issued, the other is listed with its reason
      const r4 = await createRegistration(tx, counselor, { person: { firstName: 'Bulk', lastName: 'Notready', phone: '9866600004' }, departmentId: dept.id, totalFee: 5000, enrollmentDate: '2026-10-01' })
      const notReady = (await requestCertificate(tx, counselor, r4.id)).request
      const bulk = await issueCertificates(tx, mgr, [again.id, notReady.id])
      check('issuing several at once: the ready one is issued, the other listed with its reason', bulk.issued.length === 1 && bulk.issued[0].requestId === again.id && bulk.failed.length === 1 && bulk.failed[0].name === 'Bulk Notready' && /Not eligible|not cleared/.test(bulk.failed[0].reason), JSON.stringify(bulk.failed))
      check('… and that one waits as it was', (await tx.execute<{ status: string }>(sql`select status from certificate_requests where id = ${notReady.id}`)).rows[0].status === 'pending')
      await throws(tx, 'a trainer cannot issue several either', () => issueCertificates(tx, trainer, [notReady.id]), /Forbidden/)
      const cert2 = { certNo: bulk.issued[0].certNo }
      check('issued again with a new number', cert2.certNo !== cert.certNo && /-0002$/.test(cert2.certNo), cert2.certNo)
      check('the desk shows the new certificate as issued', (await deskRow())?.certNo === cert2.certNo && (await deskRow())?.stage === 'issued')
      check('the old number still verifies as REVOKED', (await verifyCertificateIn(tx, cert.verificationHash) as { revoked?: boolean }).revoked === true)
      await throws(tx, 'only one live certificate per student', () => requestCertificate(tx, counselor, reg.id), /already been issued/)
      await tx.execute(sql`reset role`); await applyTenant(tx, student)
      check('the student sees the new certificate', (await certificateOverview(tx, student)).find((o) => o.registrationId === reg.id)?.certNo === cert2.certNo)
      await tx.execute(sql`reset role`); await applyTenant(tx, mgr)

      // rejection path on a second student
      const r3 = await createRegistration(tx, counselor, { person: { firstName: 'Nope', phone: '9866600003' }, departmentId: dept.id, totalFee: 5000, enrollmentDate: '2026-10-01' })
      const { request } = await requestCertificate(tx, counselor, r3.id)
      await rejectCertificate(tx, mgr, request.id, 'fees pending')
      const [rq] = (await tx.execute<{ status: string }>(sql`select status from certificate_requests where id = ${request.id}`)).rows
      check('manager can reject with a reason', rq.status === 'rejected')
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
