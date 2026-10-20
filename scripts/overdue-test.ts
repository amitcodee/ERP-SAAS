// Overdues against the real DB in ONE rolled-back transaction: leads past their follow-up date and fees past their
// installment date climb to the branch manager and head office by the days in Settings -> Rules; following up or
// paying clears them; one branch never sees another's.
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, departments, lookups, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { createEnquiry, logCall } from '../modules/enquiries/service'
import { recordPayment } from '../modules/fees/service'
import { escalatedToMe, overdues, thresholds } from '../modules/overdues/service'
import { createRegistration } from '../modules/registrations/service'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
const as = async (tx: Tx, a: Actor) => { await tx.execute(sql`reset role`); await applyTenant(tx, a) }
const owner = async (tx: Tx, q: ReturnType<typeof sql>) => { await tx.execute(sql`reset role`); await tx.execute(q) }

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [a] = await tx.insert(branches).values({ code: 'OVA', name: 'Overdue A', status: 'active' }).returning()
      const [b] = await tx.insert(branches).values({ code: 'OVB', name: 'Overdue B', status: 'active' }).returning()
      const mk = async (name: string, branchId: string) => (await tx.insert(users).values({ branchId, name, email: `${name}@overdue.test.invalid`, passwordHash: 'x' }).returning())[0]
      const [uc, um, ub] = [await mk('couns', a.id), await mk('mgr', a.id), await mk('mgrb', b.id)]
      const [dept] = await tx.select().from(departments).limit(1)
      const [cash] = await tx.select().from(lookups).where(eq(lookups.value, 'Cash'))
      const counselor: Actor = { userId: uc.id, orgId: ORG, role: 'counselor', branchId: a.id }
      const mgr: Actor = { userId: um.id, orgId: ORG, role: 'branch_manager', branchId: a.id }
      const mgrB: Actor = { userId: ub.id, orgId: ORG, role: 'branch_manager', branchId: b.id }
      const head: Actor = { userId: um.id, orgId: ORG, role: 'super_admin', branchId: null }
      // the rules for this test: leads 2 days -> manager, 5 -> head office; fees 7 -> manager, 30 -> head office
      await owner(tx, sql`delete from settings where branch_id is null and key like 'escalation.%'`)
      await owner(tx, sql`insert into settings (key, value) values ('escalation.lead_manager_days', '2'), ('escalation.lead_head_office_days', '5'), ('escalation.fee_manager_days', '7'), ('escalation.fee_head_office_days', '30')`)
      await as(tx, counselor)
      const t = await thresholds(tx)
      check('thresholds come from Settings -> Rules', t.leadManager === 2 && t.leadHeadOffice === 5 && t.feeManager === 7 && t.feeHeadOffice === 30, JSON.stringify(t))

      // leads: 1 day over (owner), 3 days (manager), 10 days (head office), and a random call 6 days over
      const lead = async (phone: string, days: number) => {
        const e = await createEnquiry(tx, counselor, { person: { firstName: `Lead${days}`, phone }, departmentId: dept.id, proposedFee: 100000 })
        await owner(tx, sql`update enquiries set next_follow_up = current_date - ${days}::int, assigned_to = ${uc.id} where id = ${e.enquiry.id}`)
        await as(tx, counselor)
        return e.enquiry.id
      }
      const l1 = await lead('9877700001', 1), l3 = await lead('9877700003', 3), l10 = await lead('9877700010', 10)
      const call = await logCall(tx, counselor, { person: { firstName: 'Caller', phone: '9877700006' }, status: 'Interested', followUpDate: new Date().toISOString().slice(0, 10) })
      await owner(tx, sql`update calls set follow_up_date = current_date - 6 where id = ${call.call.id}`)
      await owner(tx, sql`insert into calls (branch_id, follow_up_date, status) values (${a.id}, current_date - 9, 'Dead lead')`) // closed: never overdue

      // a fee: an installment 40 days past due (head office) and one 10 days past (manager)
      await as(tx, counselor)
      const reg = await createRegistration(tx, counselor, { person: { firstName: 'Payer', phone: '9877700020' }, departmentId: dept.id, totalFee: 3000000, enrollmentDate: '2026-07-01' })
      await recordPayment(tx, counselor, { registrationId: reg.id, amount: 1000000, modeId: cash.id, nextInstallmentDate: '2030-01-01', nextInstallmentAmount: 1000000 })
      await owner(tx, sql`update installments set status = 'cancelled' where registration_id = ${reg.id}`)
      await owner(tx, sql`insert into installments (branch_id, registration_id, due_date, amount) values (${a.id}, ${reg.id}, current_date - 40, 500000), (${a.id}, ${reg.id}, current_date - 10, 500000)`)
      const reg2 = await createRegistration(tx, counselor, { person: { firstName: 'Late', phone: '9877700021' }, departmentId: dept.id, totalFee: 2000000, enrollmentDate: '2026-07-01' })
      await recordPayment(tx, counselor, { registrationId: reg2.id, amount: 1000000, modeId: cash.id, nextInstallmentDate: '2030-01-01', nextInstallmentAmount: 1000000 })
      await owner(tx, sql`update installments set due_date = current_date - 8 where registration_id = ${reg2.id} and status = 'scheduled'`)

      await as(tx, mgr)
      const all = await overdues(tx, mgr, { tab: 'leads' })
      const lv = (id: string) => all.leads.find((x) => x.id === id)?.level
      check('leads: 1 day over stays with the owner, 3 days -> branch manager, 10 days -> head office', lv(l1) === 0 && lv(l3) === 1 && lv(l10) === 2, JSON.stringify([lv(l1), lv(l3), lv(l10)]))
      check('a random call past its follow-up is an overdue lead (6 days -> head office)', all.leads.find((x) => x.id === call.call.id)?.level === 2)
      check('a dead call is never overdue', all.leads.every((x) => !(x.kind === 'call' && x.status === 'Dead lead')))
      check('counts by level', all.counts.leads.all === 4 && all.counts.leads.owner === 1 && all.counts.leads.manager === 1 && all.counts.leads.headOffice === 2, JSON.stringify(all.counts.leads))
      check('oldest and highest first', all.leads[0].level === 2 && all.leads[0].days === 10)
      check('filter: head office only', (await overdues(tx, mgr, { tab: 'leads', level: 'head_office' })).leads.length === 2)
      check('filter: random calls only', (await overdues(tx, mgr, { tab: 'leads', kind: 'call' })).leads.every((x) => x.kind === 'call'))
      check('filter: overdue 8-30 days', (await overdues(tx, mgr, { tab: 'leads', age: '8-30' })).leads.map((x) => x.id).join() === l10)
      check('filter: search by phone', (await overdues(tx, mgr, { tab: 'leads', q: '9877700003' })).leads.map((x) => x.id).join() === l3)
      check('filter: mine (assigned to me)', (await overdues(tx, counselor, { tab: 'leads', mine: '1' })).leads.filter((x) => x.kind === 'enquiry').length === 3)

      const f = await overdues(tx, mgr, { tab: 'fees' })
      const fr = f.fees.find((x) => x.registrationId === reg.id), fr2 = f.fees.find((x) => x.registrationId === reg2.id)
      check('fees: 40 days over -> head office, with the amount overdue (₹10,000 of 2 installments)', fr?.level === 2 && fr.overdue === 1000000 && fr.installments === 2 && fr.days === 40, JSON.stringify(fr))
      check('fees: 8 days over -> branch manager', fr2?.level === 1 && fr2.days === 8, JSON.stringify(fr2))
      check('the overdue amount is totalled', f.counts.fees.amount === 2000000, String(f.counts.fees.amount))

      // escalated to me: the manager sees level 1+, head office level 2
      check('the branch manager: 3 leads and 2 fees have reached them', JSON.stringify(await escalatedToMe(tx, mgr)) === JSON.stringify({ leads: 3, fees: 2 }), JSON.stringify(await escalatedToMe(tx, mgr)))
      check('a counselor gets no escalations', JSON.stringify(await escalatedToMe(tx, counselor)) === JSON.stringify({ leads: 0, fees: 0 }))
      await as(tx, head)
      const ho = await escalatedToMe(tx, head)
      check('head office: what reached head office (2 leads, 1 fee) — at least', ho.leads >= 2 && ho.fees >= 1, JSON.stringify(ho))
      check('head office can narrow to one branch', (await overdues(tx, head, { tab: 'leads', branch: a.id })).counts.leads.all === 4)

      // another branch sees none of it
      await as(tx, mgrB)
      check('another branch sees none of these', (await overdues(tx, mgrB, { tab: 'leads' })).counts.leads.all === 0 && (await overdues(tx, mgrB, { tab: 'fees' })).counts.fees.all === 0)

      // following up / paying clears it
      await owner(tx, sql`update enquiries set next_follow_up = current_date + 2 where id = ${l10}`)
      await as(tx, counselor)
      await recordPayment(tx, counselor, { registrationId: reg2.id, amount: 1000000, modeId: cash.id })
      await as(tx, mgr)
      const after = await overdues(tx, mgr, { tab: 'leads' })
      check('a new follow-up date clears the lead', !after.leads.some((x) => x.id === l10) && after.counts.leads.all === 3)
      check('paying the fee clears it', !(await overdues(tx, mgr, { tab: 'fees' })).fees.some((x) => x.registrationId === reg2.id))
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
