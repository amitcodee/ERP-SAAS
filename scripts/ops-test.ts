// Dashboard/reports numbers, staff management and call->enquiry, in ONE rolled-back transaction.
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { verifyPassword } from '../lib/auth/password'
import { branches, departments, lookups, personOccupations, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { createEnquiry, listCalls, logCall, promoteCall } from '../modules/enquiries/service'
import { recordPayment } from '../modules/fees/service'
import { createRegistration } from '../modules/registrations/service'
import { dashboard, dashRange, reports } from '../modules/reports/service'
import { createUser, listUsers, setUserActive } from '../modules/users/service'
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
    check(name, !match || match.test(msg), match ? msg.slice(0, 100).replace(/\s+/g, ' ') : '')
  }
}
/** A day in India time (the dashboard's days). */
const istDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86400000 + 5.5 * 3600000).toISOString().slice(0, 10)
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10)

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [a] = await tx.insert(branches).values({ code: 'OA1', name: 'Ops A' }).returning()
      const [b] = await tx.insert(branches).values({ code: 'OB1', name: 'Ops B' }).returning()
      const mk = async (name: string, branchId: string) => (await tx.insert(users).values({ branchId, name, email: `${name}@ops.test.invalid`, passwordHash: 'x' }).returning())[0]
      const [uc, um, uacc, ub] = [await mk('counselor', a.id), await mk('manager', a.id), await mk('acct', a.id), await mk('mgrB', b.id)]
      const [dept] = await tx.select().from(departments).limit(1)
      const [cash] = await tx.select().from(lookups).where(eq(lookups.value, 'Cash'))
      const counselor: Actor = { userId: uc.id, orgId: ORG, role: 'counselor', branchId: a.id }
      const mgr: Actor = { userId: um.id, orgId: ORG, role: 'branch_manager', branchId: a.id }
      const acct: Actor = { userId: uacc.id, orgId: ORG, role: 'accountant', branchId: a.id }
      const mgrB: Actor = { userId: ub.id, orgId: ORG, role: 'branch_manager', branchId: b.id }
      await applyTenant(tx, mgr)

      // ---- data with known totals -------------------------------------------------
      await createEnquiry(tx, counselor, { person: { firstName: 'E1', phone: '9100000001' }, departmentId: dept.id, followUpDate: iso(-1) }) // overdue follow-up
      await createEnquiry(tx, counselor, { person: { firstName: 'E2', phone: '9100000002' }, departmentId: dept.id })
      const e3 = await createEnquiry(tx, counselor, { person: { firstName: 'E3', phone: '9100000003' }, departmentId: dept.id, proposedFee: 1000000 })
      const reg = await createRegistration(tx, counselor, { enquiryId: e3.enquiry.id, enrollmentDate: iso(0) })
      await recordPayment(tx, counselor, { registrationId: reg.id, amount: 400000, modeId: cash.id, nextInstallmentDate: iso(-20), nextInstallmentAmount: 600000 })

      const d = await dashboard(tx, mgr, a.id)
      check('enquiries total and this month', d.enquiries.total === 3 && d.enquiries.value === 3, JSON.stringify(d.enquiries))
      check('no last-month baseline -> no % change', d.enquiries.changePct === null)
      check('registrations / active students', d.registrations.total === 1 && d.students === 1)
      check('fees collected equals payments', d.feesCollected.total === 400000 && d.feesCollected.value === 400000)
      check('pending dues = fee - paid', d.pendingDues === 600000, String(d.pendingDues))
      check('follow-ups due counts the overdue one', d.followUpsDue === 1 && d.todaysFollowUps.length === 1 && d.todaysFollowUps[0].overdue)
      check('12-month series, current month holds the counts', d.series.length === 12 && d.series[11].enquiries === 3 && d.series[11].registrations === 1)
      check('department breakdown', d.byDepartment.length === 1 && d.byDepartment[0].count === 1)
      check('recent activity present and excludes logins', d.recentActivity.length > 0 && d.recentActivity.every((r) => !/login/.test(r.what)))
      const today = await dashboard(tx, mgr, a.id, dashRange(istDay(0), istDay(0)))
      check('a picked day: its numbers, day by day, against the day before', today.range.picked && today.range.days === 1 && today.enquiries.value === 3 && today.registrations.value === 1 && today.feesCollected.value === 400000 && today.seriesBy === 'day' && today.series.length === 1 && today.sources.reduce((n, x) => n + x.enquiries, 0) === 3)
      const before = await dashboard(tx, mgr, a.id, dashRange(istDay(-40), istDay(-10)))
      check('a range before anything happened shows nothing', before.enquiries.value === 0 && before.feesCollected.value === 0 && before.recentActivity.length === 0)
      check('a bad range is no range', dashRange('2026-13-40', 'x') === null && dashRange('2026-10-12', '2026-10-01')?.from === '2026-10-01')

      const r = await reports(tx, mgr, null)
      const bucket = Object.fromEntries(r.dues.map((x) => [x.bucket, x]))
      check('dues aging: 20 days overdue lands in 16-30', bucket['16-30'].count === 1 && bucket['16-30'].amount === 600000 && bucket['0-15'].count === 0)
      check('funnel', r.funnel.enquiries === 3 && r.funnel.joined === 1 && r.funnel.registered === 1)
      // a student who has stopped (discontinued) is not counted in the dues, as on the Fees page
      await tx.execute(sql`savepoint dues_sp`)
      await tx.execute(sql`reset role`); await tx.execute(sql`update registrations set status = 'discontinued' where id = ${reg.id}`); await applyTenant(tx, mgr)
      const rd = Object.fromEntries((await reports(tx, mgr, null)).dues.map((x) => [x.bucket, x]))
      check('dues aging leaves out a discontinued student (same as the Fees page)', !rd['16-30'] || rd['16-30'].count === 0, JSON.stringify(rd['16-30']))
      await tx.execute(sql`rollback to savepoint dues_sp`)
      check('a manager sees only their own branch in the branch table', r.branches.length === 1 && r.branches[0].code === 'OA1' && r.branches[0].collected === 400000)
      check('source breakdown adds up', r.sources.reduce((n, s) => n + s.enquiries, 0) === 3)
      await throws(tx, 'counselor cannot open reports', () => reports(tx, counselor, null), /Forbidden/)

      // ---- users ---------------------------------------------------------------
      const made = await createUser(tx, mgr, { name: 'New Trainer', email: 'New.Trainer@ops.test.invalid', role: 'trainer' })
      check('manager creates staff in own branch with a temp password', made.user.branchId === a.id && made.tempPassword.length >= 10)
      check('temp password is stored hashed and works', made.user.passwordHash !== made.tempPassword && (await verifyPassword(made.user.passwordHash, made.tempPassword)))
      check('email is normalised to lower case', made.user.email === 'new.trainer@ops.test.invalid')
      await throws(tx, 'manager cannot create another manager', () => createUser(tx, mgr, { name: 'X Y', email: 'x@ops.test.invalid', role: 'branch_manager' }), /cannot create this role/)
      await throws(tx, 'duplicate email rejected', () => createUser(tx, mgr, { name: 'Dup', email: 'new.trainer@ops.test.invalid', role: 'trainer' }), /already used in the system by/)
      await throws(tx, 'counselor cannot list users', () => listUsers(tx, counselor), /Forbidden/)
      check('manager lists only own branch staff (incl. new one)', (await listUsers(tx, mgr)).every((u) => u.branchCode === 'OA1') && (await listUsers(tx, mgr)).some((u) => u.name === 'New Trainer'))
      await throws(tx, 'cannot deactivate yourself', () => setUserActive(tx, mgr, mgr.userId, false), /own account/)
      const off = await setUserActive(tx, mgr, made.user.id, false)
      check('deactivating a user works', off.isActive === false)

      // ---- calls -----------------------------------------------------------------
      const { call, person } = await logCall(tx, counselor, { person: { firstName: 'Caller', phone: '9100000009' }, qualification: 'B.Sc', collegeName: 'GNDU', departmentId: dept.id, proposedFee: 500000, followUpDate: iso(1), remarks: 'asked fees' })
      const occ = await tx.select().from(personOccupations).where(eq(personOccupations.personId, person.id))
      check('qualification + college saved on the person (one source)', occ.length === 1 && occ[0].qualification === 'B.Sc' && occ[0].schoolOrCollege === 'GNDU')
      const enq = await promoteCall(tx, counselor, call.id)
      check('call promoted to an enquiry for the SAME person with source "Random call"', enq.personId === person.id && enq.proposedFee === 500000)
      const [src] = await tx.select().from(lookups).where(eq(lookups.id, enq.sourceId!))
      check('source is Random call', src.value === 'Random call')
      await throws(tx, 'a call cannot be promoted twice', () => promoteCall(tx, counselor, call.id), /already/)
      const c2 = await logCall(tx, counselor, { person: { firstName: 'NoDept', phone: '9100000010' } })
      await throws(tx, 'promotion needs a department', () => promoteCall(tx, counselor, c2.call.id), /department/i)
      check('call list shows both calls, newest first', (await listCalls(tx, counselor)).length === 2)

      // ---- "All branches" counts active branches only (branch A now has 4 enquiries: 3 + the promoted call) --
      await tx.execute(sql`reset role`)
      const sup: Actor = { userId: um.id, orgId: ORG, role: 'super_admin', branchId: null }
      await applyTenant(tx, sup)
      const allBefore = await dashboard(tx, sup, null)
      const repBefore = await reports(tx, sup, null)
      await tx.update(branches).set({ isActive: false }).where(eq(branches.id, a.id))
      const allAfter = await dashboard(tx, sup, null)
      const picked = await dashboard(tx, sup, a.id)
      check('a deactivated branch drops out of "All branches" totals', allBefore.enquiries.total - allAfter.enquiries.total === 4 && allBefore.feesCollected.total - allAfter.feesCollected.total === 400000)
      check('a deactivated branch is still viewable when picked', picked.enquiries.total === 4)
      const repAfter = await reports(tx, sup, null)
      check('reports skip it too', repBefore.funnel.enquiries - repAfter.funnel.enquiries === 4 && !repAfter.branches.some((x) => x.code === 'OA1'))
      await tx.update(branches).set({ isActive: true }).where(eq(branches.id, a.id))

      // ---- isolation -------------------------------------------------------------
      await tx.execute(sql`reset role`)
      await applyTenant(tx, mgrB)
      const db2 = await dashboard(tx, mgrB, null)
      check('branch B manager sees zero of branch A activity', db2.enquiries.total === 0 && db2.feesCollected.total === 0 && db2.students === 0)
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
