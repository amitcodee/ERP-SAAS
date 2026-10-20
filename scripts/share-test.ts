// Branches working together, against the real DB in ONE rolled-back transaction.
// 1. Shared student: Mohali asks, Phagwara accepts into its batch; Phagwara sees only that student (no fees), and the
//    classes taken there count for the certificate at Mohali.
// 2. Own work only: a counselor of Mohali also working in Phagwara sees there only the leads that are theirs.
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, departments, enquiries, lookups, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { createBatch, createSession, markAttendance } from '../modules/academics/service'
import { recordPayment } from '../modules/fees/service'
import { getEligibility } from '../modules/certificates/service'
import { createRegistration, listRegistrations } from '../modules/registrations/service'
import { acceptShare, askShare, declineShare, listShares } from '../modules/registrations/shares'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(tx: Tx, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  await tx.execute(sql`savepoint sp`)
  try { await fn(); check(name, false, 'expected error') }
  catch (e) { await tx.execute(sql`rollback to savepoint sp`); const msg = String(e); check(name, !match || match.test(msg), match ? msg.slice(0, 120) : '') }
}
const as = async (tx: Tx, a: Actor) => { await tx.execute(sql`reset role`); await applyTenant(tx, a) }
const n = async (tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute<{ n: number }>(q)).rows[0].n

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [a] = await tx.insert(branches).values({ code: 'SHA', name: 'Share Mohali', status: 'active' }).returning()
      const [b] = await tx.insert(branches).values({ code: 'SHB', name: 'Share Phagwara', status: 'active' }).returning()
      const mk = async (name: string, branchId: string) => (await tx.insert(users).values({ branchId, name, email: `${name}@share.test.invalid`, passwordHash: 'x' }).returning())[0]
      const [ua, ub, uc, ux] = [await mk('mgra', a.id), await mk('mgrb', b.id), await mk('couns', a.id), await mk('other', b.id)]
      const [dept] = await tx.select().from(departments).limit(1)
      const [cash] = await tx.select().from(lookups).where(eq(lookups.value, 'Cash'))
      const mgrA: Actor = { userId: ua.id, orgId: ORG, role: 'branch_manager', branchId: a.id }
      const mgrB: Actor = { userId: ub.id, orgId: ORG, role: 'branch_manager', branchId: b.id }
      const counselorA: Actor = { userId: uc.id, orgId: ORG, role: 'counselor', branchId: a.id }
      await as(tx, mgrA)

      // ---- 1. shared student
      const reg = await createRegistration(tx, counselorA, { person: { firstName: 'Shared', lastName: 'Student', phone: '9822200001' }, departmentId: dept.id, totalFee: 2000000, enrollmentDate: '2026-07-01' })
      await recordPayment(tx, counselorA, { registrationId: reg.id, amount: 500000, modeId: cash.id, nextInstallmentDate: '2026-11-01', nextInstallmentAmount: 500000 })
      const other = await createRegistration(tx, counselorA, { person: { firstName: 'Private', phone: '9822200002' }, departmentId: dept.id, totalFee: 100000, enrollmentDate: '2026-07-01' })
      await throws(tx, 'not to its own branch', () => askShare(tx, mgrA, { registrationId: reg.id, toBranchId: a.id, note: 'Same branch please' }), /own branch/)
      await throws(tx, 'a reason is needed', () => askShare(tx, mgrA, { registrationId: reg.id, toBranchId: b.id, note: '' }), /why/i)
      const s = await askShare(tx, mgrA, { registrationId: reg.id, toBranchId: b.id, mode: 'classroom', schedule: 'Tue, Thu', note: 'Lives near Phagwara' })
      await throws(tx, 'one open request per branch', () => askShare(tx, mgrA, { registrationId: reg.id, toBranchId: b.id, note: 'Asking again' }), /already shared/)

      await as(tx, mgrB)
      check('before accepting, Phagwara does not see the student', (await n(tx, sql`select count(*)::int as n from registrations where id = ${reg.id}`)) === 0)
      check('Phagwara sees the request coming in', (await listShares(tx, mgrB)).some((x) => x.id === s.id && x.direction === 'in' && x.status === 'pending'))
      const bb = await createBatch(tx, mgrB, { name: 'Phagwara evening', departmentId: dept.id, capacity: 5 })
      await throws(tx, 'the home branch cannot accept its own request', async () => { await as(tx, mgrA); await acceptShare(tx, mgrA, s.id, bb.id, null) }, /comes to/)
      await as(tx, mgrB)
      await acceptShare(tx, mgrB, s.id, bb.id, 'Tue/Thu evening')
      check('accepted: the student is in the Phagwara batch', (await n(tx, sql`select count(*)::int as n from batch_members where batch_id = ${bb.id} and registration_id = ${reg.id}`)) === 1)
      check('Phagwara now sees the shared student', (await n(tx, sql`select count(*)::int as n from registrations where id = ${reg.id}`)) === 1)
      check('... but not Mohali’s other students', (await n(tx, sql`select count(*)::int as n from registrations where id = ${other.id}`)) === 0)
      check('... nor the student’s fees', (await n(tx, sql`select count(*)::int as n from payments where registration_id = ${reg.id}`)) === 0)
      check('the shared student is not in Phagwara’s registrations list', !(await listRegistrations(tx, mgrB, { limit: 100 })).rows.some((r) => r.id === reg.id))
      const ses = await createSession(tx, mgrB, { batchId: bb.id, sessionDate: '2026-09-01' })
      await markAttendance(tx, mgrB, ses.id, [{ registrationId: reg.id, present: true }])

      await as(tx, mgrA)
      check('Mohali sees the attendance taken at Phagwara', (await n(tx, sql`select count(*)::int as n from attendance where registration_id = ${reg.id}`)) === 1)
      const el = await getEligibility(tx, reg.id)
      check('the class at Phagwara counts for the certificate at Mohali', el.sessionsTotal === 1 && el.attendancePct === 100, JSON.stringify(el))
      check('Mohali sees it going out, accepted', (await listShares(tx, mgrA)).some((x) => x.id === s.id && x.direction === 'out' && x.status === 'accepted'))

      // declined and cancelled requests
      const s2 = await askShare(tx, mgrA, { registrationId: other.id, toBranchId: b.id, mode: 'online', note: 'Online classes from home' })
      await as(tx, mgrB)
      await declineShare(tx, mgrB, s2.id, 'No online batch')
      await as(tx, mgrA)
      check('Phagwara turned it down', (await listShares(tx, mgrA)).find((x) => x.id === s2.id)?.status === 'declined')
      const s3 = await askShare(tx, mgrA, { registrationId: other.id, toBranchId: b.id, note: 'Asking once more' })
      await declineShare(tx, mgrA, s3.id, 'Not needed now')
      check('Mohali took its own request back (cancelled)', (await listShares(tx, mgrA)).find((x) => x.id === s3.id)?.status === 'cancelled')

      // ---- 2. own work only in a second branch
      await tx.execute(sql`reset role`)
      await tx.execute(sql`insert into user_branches (user_id, branch_id) values (${uc.id}, ${b.id})`)
      const [acc] = (await tx.execute<{ access: string }>(sql`select access from user_branches where user_id = ${uc.id} and branch_id = ${b.id}`)).rows
      check('a newly shared person gets own work only', acc.access === 'own')
      const lead = async (no: string, phone: string, by: string) => {
        const [p] = (await tx.execute<{ id: string }>(sql`insert into persons (branch_id, first_name, phone, phone_norm) values (${b.id}, 'Lead', ${phone}, ${phone}) returning id`)).rows
        return (await tx.insert(enquiries).values({ enquiryNo: no, branchId: b.id, personId: p.id, createdBy: by }).returning())[0]
      }
      const mine = await lead('ENQ-SHB-T1', '9822200010', uc.id), theirs = await lead('ENQ-SHB-T2', '9822200011', ux.id)
      const inB: Actor = { userId: uc.id, orgId: ORG, role: 'counselor', branchId: b.id, ownOnly: true }
      await as(tx, inB)
      const seen = (await tx.execute<{ id: string }>(sql`select id from enquiries where id in (${mine.id}, ${theirs.id})`)).rows.map((r) => r.id)
      check('own work only: sees their own lead in Phagwara, not a colleague’s', seen.length === 1 && seen[0] === mine.id, JSON.stringify(seen))
      await as(tx, { ...inB, ownOnly: false })
      check('full access: sees every lead in Phagwara', (await n(tx, sql`select count(*)::int as n from enquiries where id in (${mine.id}, ${theirs.id})`)) === 2)
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
