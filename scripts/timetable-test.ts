// Batch schedules, clash rules and the timetable views, in ONE rolled-back transaction.
import { sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { batchMembers, branches, departments, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { addBatchMember, createBatch, myClasses, timetable } from '../modules/academics/service'
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
    check(name, !match || match.test(msg), match ? msg.slice(0, 100).replace(/\s+/g, ' ') : '')
  }
}
const as = async (tx: Tx, a: Actor) => { await tx.execute(sql`reset role`); await applyTenant(tx, a) }

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [br] = await tx.insert(branches).values({ code: 'TT1', name: 'Timetable A' }).returning()
      const mk = async (name: string) => (await tx.insert(users).values({ branchId: br.id, name, email: `${name}@tt.test.invalid`, passwordHash: 'x' }).returning())[0]
      const [um, ut1, ut2, us1, us2] = [await mk('mgr'), await mk('trainer1'), await mk('trainer2'), await mk('stu1'), await mk('stu2')]
      const [dept] = await tx.select().from(departments).limit(1)
      const mgr: Actor = { userId: um.id, orgId: ORG, role: 'branch_manager', branchId: br.id }
      const t1: Actor = { userId: ut1.id, orgId: ORG, role: 'trainer', branchId: br.id }
      const base = { departmentId: dept.id }

      await as(tx, mgr)
      const morning = await createBatch(tx, mgr, { ...base, name: 'Morning', trainerId: ut1.id, days: [1, 3, 5], startTime: '10:00', endTime: '12:00', room: 'Lab 1' })
      check('schedule saved (days sorted, times, room)', JSON.stringify(morning.days) === '[1,3,5]' && morning.startTime?.startsWith('10:00') === true && morning.room === 'Lab 1')
      await createBatch(tx, mgr, { ...base, name: 'Back to back', trainerId: ut1.id, days: [1], startTime: '12:00', endTime: '14:00', room: 'Lab 1' })
      check('back-to-back slots for the same trainer and room are fine', true)
      await createBatch(tx, mgr, { ...base, name: 'Tuesday', trainerId: ut1.id, days: [2], startTime: '10:30', endTime: '11:30', room: 'Lab 1' })
      check('same time on a different day is fine', true)
      await throws(tx, 'trainer double-booked is refused', () => createBatch(tx, mgr, { ...base, name: 'Clash T', trainerId: ut1.id, days: [5], startTime: '11:00', endTime: '13:00' }), /already teaches "Morning"/)
      await throws(tx, 'room double-booked is refused (case-insensitive)', () => createBatch(tx, mgr, { ...base, name: 'Clash R', trainerId: ut2.id, days: [3], startTime: '09:00', endTime: '10:30', room: 'lab 1' }), /Room lab 1 is already used by "Morning"/)
      const other = await createBatch(tx, mgr, { ...base, name: 'Other trainer', trainerId: ut2.id, days: [1], startTime: '10:00', endTime: '12:00', room: 'Lab 2' })
      check('another trainer in another room at the same time is fine', !!other.id)
      await throws(tx, 'end before start is refused', () => createBatch(tx, mgr, { ...base, name: 'Bad', days: [1], startTime: '12:00', endTime: '11:00' }), /after the start/)
      await throws(tx, 'days without times is refused', () => createBatch(tx, mgr, { ...base, name: 'Bad2', days: [1] }), /needs days/)
      await throws(tx, 'bad time format is refused', () => createBatch(tx, mgr, { ...base, name: 'Bad3', days: [1], startTime: '25:00', endTime: '26:00' }), /HH:MM/)
      await throws(tx, 'weekday 8 is refused', () => createBatch(tx, mgr, { ...base, name: 'Bad4', days: [8], startTime: '10:00', endTime: '11:00' }))
      await createBatch(tx, mgr, { ...base, name: 'Unscheduled', timing: 'alternate Saturdays' })
      check('a batch without a schedule is still allowed (free-text timing)', true)
      await tx.execute(sql`reset role`)
      await throws(tx, 'the database refuses an inconsistent schedule too', () => tx.execute(sql`insert into batches (branch_id, name, department_id, days, start_time, end_time) values (${br.id}, 'Raw', ${dept.id}, '{1}', '12:00', '11:00')`), /batches_schedule_ck/)

      await as(tx, mgr)
      const all = await timetable(tx, mgr)
      check('manager timetable lists every active batch, ordered by start time', all.length === 5 && all[0].start === '10:00' && all.at(-1)!.name === 'Unscheduled', all.map((e) => `${e.name}@${e.start}`).join(','))
      const mine = await timetable(tx, t1)
      check('a trainer sees only their own batches', mine.length === 3 && mine.every((e) => e.trainer === 'trainer1'))

      // ---- students: read their own batches, nothing else, write nothing --------------------------
      const r1 = await createRegistration(tx, { ...mgr, role: 'counselor' }, { person: { firstName: 'Stu', lastName: 'One', phone: '9888800001' }, departmentId: dept.id, totalFee: 100000, enrollmentDate: '2026-10-01' })
      const r2 = await createRegistration(tx, { ...mgr, role: 'counselor' }, { person: { firstName: 'Stu', lastName: 'Two', phone: '9888800002' }, departmentId: dept.id, totalFee: 100000, enrollmentDate: '2026-10-01' })
      await addBatchMember(tx, mgr, morning.id, r1.id)
      await addBatchMember(tx, mgr, other.id, r2.id)
      const s1: Actor = { userId: us1.id, orgId: ORG, role: 'student', branchId: br.id, personId: r1.personId }
      void us2
      await as(tx, s1)
      const cls = await myClasses(tx, s1)
      check('a student sees only the batch they are in', cls.length === 1 && cls[0].name === 'Morning' && cls[0].start === '10:00' && cls[0].room === 'Lab 1', JSON.stringify(cls.map((c) => c.name)))
      const members = await tx.execute(sql`select registration_id from batch_members`)
      check('a student sees only their own membership row', members.rows.length === 1 && members.rows[0].registration_id === r1.id)
      const sessions = await tx.execute(sql`select count(*)::int as n from class_sessions`)
      check('class sessions stay hidden from students', Number(sessions.rows[0].n) === 0)
      await throws(tx, 'a student cannot add themselves to another batch (RLS)', () => tx.insert(batchMembers).values({ batchId: other.id, registrationId: r1.id, branchId: br.id }), /row-level security/)
      await throws(tx, 'a student cannot change their batch (RLS)', async () => {
        const r = await tx.execute(sql`update batches set room = 'X' where id = ${morning.id} returning id`)
        if (r.rows.length === 0) throw new Error('row-level security: no rows updated')
      }, /row-level security/)
      await throws(tx, 'a student cannot leave or delete memberships (RLS)', async () => {
        const r = await tx.execute(sql`delete from batch_members returning batch_id`)
        if (r.rows.length === 0) throw new Error('row-level security: no rows deleted')
      }, /row-level security/)
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
