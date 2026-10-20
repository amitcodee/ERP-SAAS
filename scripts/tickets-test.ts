// Tickets against the real DB in ONE rolled-back transaction: student and internal tickets, priority + SLA, assignee,
// escalation by the clock and by hand, rating; who may see and answer what.
import { sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, departments, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { createRegistration } from '../modules/registrations/service'
import { assignTicket, escalateOverdue, escalateTicket, listTickets, raiseInternalTicket, raiseTicket, rateTicket, replyTicket, setTicketPriority } from '../modules/support/service'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(tx: Tx, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  await tx.execute(sql`savepoint sp`)
  try { await fn(); check(name, false, 'expected error') }
  catch (e) { await tx.execute(sql`rollback to savepoint sp`); const msg = String(e); check(name, !match || match.test(msg), match ? msg.slice(0, 100) : '') }
}

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [a] = await tx.insert(branches).values({ code: 'TKA', name: 'Ticket Branch', status: 'active' }).returning()
      const mk = async (n: string, br: string | null) => (await tx.insert(users).values({ branchId: br, name: n, email: `${n}@tickets.test.invalid`, passwordHash: 'x' }).returning())[0]
      const [um, uc, ut, us, uh] = [await mk('mgr', a.id), await mk('coun', a.id), await mk('trainer', a.id), await mk('stud', a.id), await mk('ho', null)]
      const mgr: Actor = { userId: um.id, orgId: ORG, role: 'branch_manager', branchId: a.id }
      const coun: Actor = { userId: uc.id, orgId: ORG, role: 'counselor', branchId: a.id }
      const trainer: Actor = { userId: ut.id, orgId: ORG, role: 'trainer', branchId: a.id }
      const ho: Actor = { userId: uh.id, orgId: ORG, role: 'super_admin', branchId: null }
      await applyTenant(tx, mgr)
      const [dept] = await tx.select().from(departments).limit(1)
      const reg = await createRegistration(tx, coun, { person: { firstName: 'Tick', phone: '9844400001' }, departmentId: dept.id, totalFee: 1000, enrollmentDate: '2026-07-01' })
      const student: Actor = { userId: us.id, orgId: ORG, role: 'student', branchId: a.id, personId: reg.personId }

      // a student's question, with its SLA
      await applyTenant(tx, student)
      const st = await raiseTicket(tx, student, { registrationId: reg.id, category: 'login', subject: 'Cannot sign in', body: 'My password does not work' })
      const [due] = (await tx.execute<{ priority: string; hours: number }>(sql`select priority, round(extract(epoch from due_at - created_at) / 3600)::int as hours from support_tickets where id = ${st.id}`)).rows
      check('a login question is high priority, reply due in 12 h', due.priority === 'high' && due.hours === 12, JSON.stringify(due))

      // staff raise internal tickets
      await applyTenant(tx, trainer)
      const it = await raiseInternalTicket(tx, trainer, { category: 'it', subject: 'Projector broken', priority: 'urgent', body: 'Lab 2 projector does not turn on' })
      const ho1 = await raiseInternalTicket(tx, trainer, { category: 'hr', subject: 'Salary question', priority: 'normal', toHeadOffice: true, body: 'About last month' })
      check('the trainer sees their own tickets in My Tickets', (await listTickets(tx, trainer, { scope: 'mine' })).filter((t) => t.kind === 'internal').length === 2)
      await throws(tx, 'a trainer has no help desk', () => listTickets(tx, trainer, { scope: 'desk' }), /Forbidden/)

      await applyTenant(tx, mgr)
      const desk = await listTickets(tx, mgr, { scope: 'desk' })
      check('the branch manager sees the student’s and the internal ticket', desk.some((t) => t.id === st.id) && desk.some((t) => t.id === it.id && t.kind === 'internal'))
      check('…but not one meant for head office', !desk.some((t) => t.id === ho1.id))

      // assignee
      await applyTenant(tx, coun)
      await throws(tx, 'a counselor cannot answer a ticket not given to them', () => replyTicket(tx, coun, st.id, 'Try again'), /Forbidden/)
      await applyTenant(tx, mgr)
      await assignTicket(tx, mgr, st.id, uc.id)
      await applyTenant(tx, coun)
      check('the assignee finds it in My Tickets', (await listTickets(tx, coun, { scope: 'mine' })).some((t) => t.id === st.id && t.can.answer))
      await replyTicket(tx, coun, st.id, 'Your password is reset: check your e-mail')
      const [ans] = (await tx.execute<{ status: string; due: string | null; first: string | null }>(sql`select status, due_at as due, first_reply_at as first from support_tickets where id = ${st.id}`)).rows
      check('answered: the SLA stops and the first reply is kept', ans.status === 'answered' && !ans.due && !!ans.first)

      // rating, by whoever raised it
      await applyTenant(tx, student)
      await rateTicket(tx, student, st.id, 5, 'Quick help!')
      const [rt] = (await tx.execute<{ rating: number }>(sql`select rating from support_tickets where id = ${st.id}`)).rows
      check('the student rates the help', rt.rating === 5)
      await applyTenant(tx, coun)
      await throws(tx, 'only the one who raised it rates it', () => rateTicket(tx, coun, st.id, 1, null), /Only the one who raised/)
      await applyTenant(tx, trainer)
      await throws(tx, 'a ticket still waiting cannot be rated', () => rateTicket(tx, trainer, it.id, 4, null), /once the branch has answered/)

      // priority moves the SLA; escalation by the clock
      await applyTenant(tx, mgr)
      await setTicketPriority(tx, mgr, it.id, 'low')
      const [lp] = (await tx.execute<{ hours: number }>(sql`select round(extract(epoch from due_at - created_at) / 3600)::int as hours from support_tickets where id = ${it.id}`)).rows
      check('urgent -> low: the reply is due in 72 h instead of 4', lp.hours === 72, JSON.stringify(lp))
      await tx.execute(sql`update support_tickets set due_at = now() - interval '1 hour' where id = ${it.id}`)
      await escalateOverdue(tx)
      const lv = async (id: string) => (await tx.execute<{ l: number }>(sql`select escalation_level as l from support_tickets where id = ${id}`)).rows[0].l
      check('overdue: escalated to the branch manager', (await lv(it.id)) === 1)
      await tx.execute(sql`update support_tickets set due_at = now() - interval '30 hours' where id = ${it.id}`)
      await escalateOverdue(tx)
      check('a day later still waiting: escalated to head office', (await lv(it.id)) === 2)
      await replyTicket(tx, mgr, it.id, 'New projector on its way')
      check('answering clears the escalation', (await lv(it.id)) === 0)

      // by hand, and head office sees what was meant for it
      await applyTenant(tx, trainer)
      await escalateTicket(tx, trainer, it.id, 'Still broken after a week')
      check('the raiser can escalate their own internal ticket to head office', (await lv(it.id)) === 2)
      await applyTenant(tx, ho)
      const hodesk = await listTickets(tx, ho, { scope: 'desk' })
      check('head office sees the ticket meant for it, and the escalated one', hodesk.some((t) => t.id === ho1.id && t.toHeadOffice) && hodesk.some((t) => t.id === it.id && t.escalationLevel === 2))
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
