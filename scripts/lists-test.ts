// List screens: search, filters, date range and sort, against the real DB inside ONE transaction that is rolled back.
import { sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, departments, lookups, users } from '../lib/db/schema'
import { applyTenant, type Actor } from '../lib/db/withTenant'
import type { ListQuery } from '../lib/list-query'
import { visitSummary, callFollowUps, createEnquiry, deleteCall, deleteLead, enquiryTimeline, followUpCall, followUpLead, leadRecord, listCallsPage, listDeleted, restoreDeleted, listEnquiries, logCall, promoteCall, transitionEnquiry } from '../modules/enquiries/service'
import { addLeadCategory, leadCategoryCounts, leadCategoryMembers, listLeadCategories, loadCatalogs, updateLeadCategory } from '../modules/catalog/service'
import { describeChange, listLogs, logFilters } from '../modules/audit/service'
import { createRegistration, enquiryForRegistration, listRegistrations } from '../modules/registrations/service'
import { listFeesPage } from '../modules/fees/service'
import { certificatePage } from '../modules/certificates/service'
import { eq } from 'drizzle-orm'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
const today = new Date().toISOString().slice(0, 10)

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [a] = await tx.insert(branches).values({ code: 'LQ1', name: 'Lists' }).returning()
      const [u] = await tx.insert(users).values({ branchId: a.id, name: 'Lister', email: 'lists@test.invalid', passwordHash: 'x' }).returning()
      const [d1, d2] = await tx.select().from(departments).limit(2)
      const [reason] = await tx.select().from(lookups).where(eq(lookups.kind, 'not_joined_reason')).limit(1)
      const act: Actor = { userId: u.id, orgId: ORG, role: 'branch_manager', branchId: a.id }
      await applyTenant(tx, act)

      const e1 = await createEnquiry(tx, act, { person: { firstName: 'Aman', lastName: 'Gill', phone: '9811100001' }, departmentId: d1.id, proposedFee: 1000000 })
      const e2 = await createEnquiry(tx, act, { person: { firstName: 'Bina', phone: '9811100002' }, departmentId: d2?.id ?? d1.id, proposedFee: 3000000, followUpDate: '2020-01-01' })
      await createEnquiry(tx, act, { person: { firstName: 'Chetan', phone: '9811100003' }, departmentId: d1.id })
      await transitionEnquiry(tx, act, { enquiryId: e1.enquiry.id, to: 'not_joined', notJoinedReasonId: reason.id })
      await tx.execute(sql`update enquiries set created_at = now() - interval '40 days' where id = ${e2.enquiry.id}`)

      const enq = (query: ListQuery) => listEnquiries(tx, act, { query })
      check('search matches full name "aman gill"', (await enq({ q: 'aman gill' })).total === 1)
      check('status filter', (await enq({ f: { status: 'not_joined' } })).rows.every((r) => r.status === 'not_joined') && (await enq({ f: { status: 'not_joined' } })).total === 1)
      check('department filter', (await enq({ f: { dept: d1.id } })).rows.every((r) => r.department === d1.name))
      check('follow-up overdue filter', (await enq({ f: { follow: 'overdue' } })).rows.map((r) => r.name).join() === 'Bina')
      check('date range excludes the 40-day-old enquiry', (await enq({ from: today, to: today })).total === 2)
      check('date "to" alone keeps only older ones', (await enq({ to: new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10) })).total === 1)
      const byName = (await enq({ sort: 'name', dir: 'asc' })).rows.map((r) => r.name)
      check('sort by name ascending', byName.join() === 'Aman Gill,Bina,Chetan', byName.join())
      check('sort by fee descending, blanks last', (await enq({ sort: 'fee', dir: 'desc' })).rows.map((r) => r.name).join() === 'Bina,Aman Gill,Chetan')
      check('junk filter values are ignored, not an SQL error', (await enq({ f: { status: 'x; drop', dept: 'not-a-uuid' }, sort: 'evil', from: '2020-13-99' })).total === 3)
      check('unassigned filter', (await enq({ f: { assigned: 'none' } })).total === 0 && (await enq({ f: { assigned: 'me' } })).total === 3)

      const c1 = await logCall(tx, act, { person: { firstName: 'Dev', phone: '9811100004' }, departmentId: d1.id, status: 'Interested', followUpDate: today })
      const c2 = await logCall(tx, act, { person: { firstName: 'Esha', phone: '9811100005' }, departmentId: d1.id })
      await promoteCall(tx, act, c2.call.id)
      const calls = (query: ListQuery) => listCallsPage(tx, act, { query })
      check('calls: converted filter', (await calls({ f: { converted: 'yes' } })).rows.map((r) => r.name).join() === 'Esha')
      check('calls: not converted + follow-up today', (await calls({ f: { converted: 'no', follow: 'today' } })).rows.map((r) => r.name).join() === 'Dev')
      check('calls: search by status text', (await calls({ q: 'interest' })).total === 1)
      check('calls: today range + mine', (await calls({ from: today, to: today, f: { mine: 'yes' } })).total === 2)

      const fails = async (fn: () => Promise<unknown>) => { await tx.execute(sql`savepoint s`); try { await fn(); return false } catch { await tx.execute(sql`rollback to savepoint s`); return true } }
      const dev = async () => (await calls({ q: 'Dev' })).rows[0]
      check('follow-up: "Will visit" needs the expected visit date', await fails(() => followUpCall(tx, act, { callId: c1.call.id, status: 'Will visit', nextFollowUp: today })))
      check('follow-up: needs the next follow-up date', await fails(() => followUpCall(tx, act, { callId: c1.call.id, status: 'In process' })))
      check('follow-up: not on a call that is already an enquiry', await fails(() => followUpCall(tx, act, { callId: c2.call.id, status: 'In process', nextFollowUp: today })))
      await followUpCall(tx, act, { callId: c1.call.id, status: 'Will visit', expectedVisitDate: '2030-01-05', nextFollowUp: '2030-01-04', interested: true, interestPct: 80, callRemark: 'will come Saturday' })
      let row = await dev()
      check('follow-up: the call shows the latest state', row.status === 'Will visit' && row.expectedVisitDate === '2030-01-05' && row.followUpDate === '2030-01-04' && row.interestPct === 80 && row.followUps === 1, JSON.stringify(row))
      check('calls: interest filter + sort', (await calls({ f: { interest: 'yes' }, sort: 'interest', dir: 'desc' })).rows.map((r) => r.name).join() === 'Dev' && (await calls({ f: { interest: 'unset' } })).total === 1)
      check('follow-up: "Dead lead" needs a reason', await fails(() => followUpCall(tx, act, { callId: c1.call.id, status: 'Dead lead' })))
      await followUpCall(tx, act, { callId: c1.call.id, status: 'Dead lead', deadReason: 'joined elsewhere', interested: true, interestPct: 80 })
      row = await dev()
      check('follow-up: a dead lead has no follow-up, visit date or interest', row.status === 'Dead lead' && row.followUpDate === null && row.expectedVisitDate === null && row.interested === false && row.interestPct === null && row.deadReason === 'joined elsewhere', JSON.stringify(row))
      const hist = await callFollowUps(tx, act, c1.call.id)
      check('follow-up: history keeps every call', hist.length === 2 && hist.some((h) => h.status === 'Will visit' && h.callRemark === 'will come Saturday') && hist.some((h) => h.status === 'Dead lead'))

      // Lead categories: head office keeps the list; calls, leads and visited enquiries carry one.
      const hq: Actor = { userId: u.id, orgId: ORG, role: 'super_admin', branchId: a.id }
      await applyTenant(tx, hq)
      const catId = await addLeadCategory(tx, hq, 'Walk-in Promise')
      check('category: no duplicate name (any case)', await fails(() => addLeadCategory(tx, hq, 'walk-in promise')))
      await applyTenant(tx, act)
      check('category: branch staff cannot add one', await fails(() => addLeadCategory(tx, act, 'Mine')))
      check('category: offered in the dropdowns', (await loadCatalogs(tx)).leadCategories.some((c) => c.id === catId))
      const c3 = await logCall(tx, act, { person: { firstName: 'Ishan', phone: '9811100009' }, departmentId: d1.id, categoryId: catId })
      check('category: saved on a call and filterable', (await calls({ f: { category: catId } })).rows.map((r) => `${r.name}:${r.category}`).join() === 'Ishan:Walk-in Promise')
      const visitedEnq = await promoteCall(tx, act, c3.call.id)
      check('category: carried from the call to the visited enquiry', (await enq({ f: { category: catId } })).rows.map((r) => r.id).join() === visitedEnq.id)
      await followUpLead(tx, act, { enquiryId: visitedEnq.id, nextFollowUp: '2030-03-01', callRemark: 'visited, will decide' })
      const ish = (await enq({ q: 'Ishan' })).rows[0]
      check('visited enquiry: follow-up keeps the category and sets the next date', ish.visited && ish.status === 'follow_up' && ish.nextFollowUp === '2030-03-01' && ish.category === 'Walk-in Promise', JSON.stringify(ish))
      const c4 = await logCall(tx, act, { person: { firstName: 'Jaya', phone: '9811100010' }, departmentId: d1.id, categoryId: catId })
      const cnt = (await leadCategoryCounts(tx)).find((c) => c.id === catId)!
      check('category page: counts calls, leads and visited enquiries, a promoted call only once', cnt.calls === 1 && cnt.leads === 0 && cnt.visited === 1 && cnt.total === 2, JSON.stringify(cnt))
      const mem = await leadCategoryMembers(tx, catId)
      check('category page: lists everyone in the category', mem?.members.map((m) => `${m.kind}:${m.name}`).sort().join() === 'call:Jaya,visited:Ishan', JSON.stringify(mem?.members))
      check('category page: unknown or junk id gives nothing', (await leadCategoryMembers(tx, 'not-a-uuid')) === null && (await leadCategoryMembers(tx, u.id)) === null)
      const recE = await leadRecord(tx, act, 'enquiry', visitedEnq.id)
      check('record view: an enquiry shows its details, follow-ups and logs', recE.title === 'Visited enquiry — Ishan' && recE.fields.some(([k, v]) => k === 'Lead category' && v === 'Walk-in Promise') && recE.followUps.length === 2 && recE.logs.some((l) => l.what.startsWith('Follow-up call saved')) && recE.logs.some((l) => l.what === 'Added'), JSON.stringify(recE.logs))
      await followUpCall(tx, act, { callId: c4.call.id, status: 'In process', nextFollowUp: '2030-04-01', callRemark: 'thinking' })
      const recC = await leadRecord(tx, act, 'call', c4.call.id)
      check('record view: a call shows its details, follow-ups and logs', recC.title === 'Random call — Jaya' && recC.followUps.length === 1 && recC.followUps[0].text.includes('thinking') && recC.logs.length === 2 && recC.logs[0].by === 'Lister', JSON.stringify(recC.logs))
      check('record view: junk id is refused', await fails(() => leadRecord(tx, act, 'call', "x' or 1=1")))
      await deleteCall(tx, act, c4.call.id)
      check('category page: a deleted call drops out of the count', (await leadCategoryCounts(tx)).find((c) => c.id === catId)!.total === 1)
      await applyTenant(tx, hq)
      await updateLeadCategory(tx, hq, { id: catId, isActive: false })
      check('category: switched off = not offered, but kept on records', !(await loadCatalogs(tx)).leadCategories.some((c) => c.id === catId) && (await listLeadCategories(tx)).some((c) => c.id === catId && !c.isActive))
      await applyTenant(tx, act)
      check('category: records keep a switched-off category', (await enq({ q: 'Ishan' })).rows[0].category === 'Walk-in Promise')

      const lead = await createEnquiry(tx, act, { person: { firstName: 'Hina', phone: '9811100008' }, departmentId: d1.id, lead: { visited: false, callDone: false } })
      const leads = (query: ListQuery = {}) => listEnquiries(tx, act, { visited: false, query })
      check('lead: shows on the Leads list only', (await leads()).rows.map((r) => r.name).join() === 'Hina' && (await listEnquiries(tx, act, { visited: true })).rows.every((r) => r.name !== 'Hina'))
      await followUpLead(tx, act, { enquiryId: lead.enquiry.id, calledAt: new Date(Date.now() - 864e5).toISOString(), nextFollowUp: '2030-02-01', interested: true, interestPct: 60, callRemark: 'call back next week' })
      const hina = (await leads()).rows[0]
      check('lead follow-up: status, next date, call and interest are updated', hina.status === 'follow_up' && hina.nextFollowUp === '2030-02-01' && hina.callDone && hina.interestPct === 60 && hina.callRemark === 'call back next week', JSON.stringify(hina))
      const tl = await enquiryTimeline(tx, act, lead.enquiry.id)
      check('lead follow-up: kept in the history with who and when', tl.length === 2 && tl.some((h) => h.toStatus === 'follow_up' && h.followUpDate === '2030-02-01' && h.note === 'call back next week' && h.by === 'Lister'))
      const before = { enq: (await enq({})).total, calls: (await calls({})).total }
      // the rule since the Recycle Bin (10 Oct): any lead can be deleted (it waits 30 days in the bin), except one already registered
      await tx.execute(sql`savepoint del_sp`)
      check('delete: a visited enquiry can be deleted too (to the Recycle Bin)', !(await fails(() => deleteLead(tx, act, e1.enquiry.id))))
      const regd = await createEnquiry(tx, act, { person: { firstName: 'Reggie', phone: '9811100099' }, departmentId: d1.id, proposedFee: 100000 })
      await createRegistration(tx, act, { enquiryId: regd.enquiry.id, enrollmentDate: '2026-01-15' })
      check('delete: a lead already registered cannot be deleted', await fails(() => deleteLead(tx, act, regd.enquiry.id)))
      await tx.execute(sql`rollback to savepoint del_sp`)
      check('delete: a call that became an enquiry cannot be deleted', await fails(() => deleteCall(tx, act, c2.call.id)))
      check('delete: needs the delete permission', await fails(() => deleteLead(tx, { ...act, role: 'counselor' }, lead.enquiry.id)) && await fails(() => deleteCall(tx, { ...act, role: 'counselor' }, c1.call.id)))
      await deleteLead(tx, act, lead.enquiry.id)
      await deleteCall(tx, act, c1.call.id)
      check('delete: the lead is gone from every list and count', (await leads()).total === 0 && (await enq({})).total === before.enq - 1 && (await enq({ q: 'Hina' })).total === 0)
      check('delete: the call is gone from the list', (await calls({})).total === before.calls - 1 && (await calls({ q: 'Dev' })).total === 0)
      check('delete: a deleted row cannot be changed or deleted again', await fails(() => deleteLead(tx, act, lead.enquiry.id)) && await fails(() => followUpCall(tx, act, { callId: c1.call.id, status: 'In process', nextFollowUp: today })))
      const kept = await tx.execute(sql`select set_config('app.show_deleted', 'on', true), (select count(*)::int from enquiries where id = ${lead.enquiry.id} and deleted_by = ${u.id}) as n`)
      await tx.execute(sql`select set_config('app.show_deleted', '', true)`)
      check('delete: the row is kept in the database with who deleted it', Number(kept.rows[0].n) === 1)

      await createRegistration(tx, act, { person: { firstName: 'Farah', phone: '9811100006' }, departmentId: d1.id, totalFee: 500000, enrollmentDate: '2026-01-15' })
      await createRegistration(tx, act, { person: { firstName: 'Gagan', phone: '9811100007' }, departmentId: d1.id, totalFee: 900000, enrollmentDate: '2026-03-10', kind: 'new' })
      const regs = (query: ListQuery) => listRegistrations(tx, act, { query })
      check('registrations: enrolment date range', (await regs({ from: '2026-03-01', to: '2026-03-31' })).rows.map((r) => r.name).join() === 'Gagan')
      check('registrations: sort by fee ascending', (await regs({ sort: 'fee', dir: 'asc' })).rows.map((r) => r.name).join() === 'Farah,Gagan')
      check('registrations: status filter', (await regs({ f: { status: 'on_hold' } })).total === 0 && (await regs({ f: { status: 'active', kind: 'new' } })).total === 2)

      const fees = (query: ListQuery) => listFeesPage(tx, act, { query })
      check('fees: dues filter', (await fees({ f: { balance: 'due' } })).total === 2 && (await fees({ f: { balance: 'cleared' } })).total === 0)
      check('fees: sort by balance desc', (await fees({ sort: 'balance', dir: 'desc' })).rows.map((r) => r.name).join() === 'Gagan,Farah')
      for (const s of ['due', 'paid', 'total', 'name', 'reg', 'enrolled']) await fees({ sort: s, dir: 'asc', f: { balance: 'overdue', status: 'active', dept: d1.id }, from: '2026-01-01', to: '2026-12-31', q: 'a' })
      check('fees: every sort + filter combination runs', true)

      const certs = (query: ListQuery) => certificatePage(tx, act, { query })
      check('students: blocked filter (fees due)', (await certs({ f: { cert: 'blocked' } })).total === 2 && (await certs({ f: { cert: 'issued' } })).total === 0)
      for (const c of ['eligible', 'pending', 'revoked']) for (const s of ['name', 'reg', 'attendance', 'enrolled', 'balance']) await certs({ f: { cert: c, status: 'active', dept: d1.id }, sort: s, dir: 'desc', from: '2026-01-01', q: 'g' })
      check('students: every sort + filter combination runs', (await certs({ sort: 'name', dir: 'asc', from: '2026-01-01', to: '2026-01-31' })).rows.map((r) => r.name).join() === 'Farah')

      const del = await listDeleted(tx, act)
      check('deleted list: shows deleted calls and leads with who deleted them', del.map((r) => `${r.kind}:${r.name}`).sort().join() === 'call:Dev,call:Jaya,lead:Hina' && del.every((r) => r.deletedBy === 'Lister' && r.daysLeft === 30), JSON.stringify(del.map((r) => [r.kind, r.name, r.deletedBy, r.daysLeft])))
      check('deleted list: reading it does not un-hide deleted rows elsewhere', (await calls({ q: 'Dev' })).total === 0)
      check('restore: needs the delete permission', await fails(() => restoreDeleted(tx, { ...act, role: 'counselor' }, 'lead', lead.enquiry.id)))
      await restoreDeleted(tx, act, 'lead', lead.enquiry.id)
      check('restore: the lead is back on the Leads list and off the deleted list', (await leads()).rows.map((r) => r.name).join() === 'Hina' && !(await listDeleted(tx, act)).some((r) => r.name === 'Hina'))
      await tx.execute(sql`select set_config('app.show_deleted', 'on', true)`)
      await tx.execute(sql`update calls set deleted_at = now() - interval '31 days' where id = ${c1.call.id}`)
      await tx.execute(sql`select set_config('app.show_deleted', '', true)`)
      check('deleted list: gone after 30 days and no longer restorable', !(await listDeleted(tx, act)).some((r) => r.name === 'Dev') && await fails(() => restoreDeleted(tx, act, 'call', c1.call.id)))

      const feeEnq = await createEnquiry(tx, act, { person: { firstName: 'Kiran', phone: '9811100011' }, departmentId: d1.id, courseFee: 2500000, proposedFee: 2000000 })
      const kiran = (await enq({ q: 'Kiran' })).rows[0]
      check('enquiry fees: the actual fee and the discounted fee are both kept', kiran.courseFee === 2500000 && kiran.proposedFee === 2000000 && kiran.fee === 2000000)
      check('enquiry fees: shown in the record view with the discount', (await leadRecord(tx, act, 'enquiry', feeEnq.enquiry.id)).fields.some(([k, v]) => k === 'Discount' && v === '₹5,000'))
      check('enquiry fees: a discounted fee above the actual fee is refused', await fails(() => createEnquiry(tx, act, { person: { firstName: 'Lata', phone: '9811100012' }, departmentId: d1.id, courseFee: 1000000, proposedFee: 1200000 })))

      // Visits count in the month of the visit; registrations in the month they were made, even for an earlier visit.
      const lastMonth = new Date(Date.now() - 31 * 864e5), lm = lastMonth.toISOString().slice(0, 10)
      const lmFrom = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10), lmTo = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10)
      const thisFrom = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10)
      const vBefore = { last: await visitSummary(tx, act, { from: lmFrom, to: lmTo }), now: await visitSummary(tx, act, { from: thisFrom, to: today }) }
      const old1 = await createEnquiry(tx, act, { person: { firstName: 'Mohan', phone: '9811100021' }, departmentId: d1.id, proposedFee: 500000 })
      const old2 = await createEnquiry(tx, act, { person: { firstName: 'Nita', phone: '9811100022' }, departmentId: d1.id, proposedFee: 500000 })
      await tx.execute(sql`update enquiries set created_at = ${lm}::date + interval '10 hours', visited_at = ${lm}::date + interval '10 hours' where id in (${old1.enquiry.id}, ${old2.enquiry.id})`)
      const forReg = await enquiryForRegistration(tx, act, old1.enquiry.id)
      check('registration page: an enquiry brings its details to fill the form', forReg?.firstName === 'Mohan' && forReg.phone === '9811100021' && forReg.proposedFee === 500000 && forReg.departmentId === d1.id && forReg.visited === true, JSON.stringify(forReg))
      const madeReg = await createRegistration(tx, act, { enquiryId: old1.enquiry.id, departmentId: d1.id, totalFee: 500000, enrollmentDate: today, profile: { fatherName: 'Ram Lal', motherName: 'Sita Devi', guardianPhone: '9811100099', gender: 'male', dob: '2004-05-06' } })
      const parent = (await tx.execute<{ father_name: string; mother_name: string; guardian_phone: string; gender: string }>(sql`select father_name, mother_name, guardian_phone, gender from persons where id = ${madeReg.personId}`)).rows[0]
      check('registration: father, mother, parent mobile and gender are saved on the student', parent.father_name === 'Ram Lal' && parent.mother_name === 'Sita Devi' && parent.guardian_phone === '9811100099' && parent.gender === 'male', JSON.stringify(parent))
      check('registration page: an enquiry that is already registered (or a junk id) is not offered', (await enquiryForRegistration(tx, act, old1.enquiry.id)) === null && (await enquiryForRegistration(tx, act, 'nope')) === null)
      const last = await visitSummary(tx, act, { from: lmFrom, to: lmTo }), now = await visitSummary(tx, act, { from: thisFrom, to: today })
      check('visit summary: last month counts the 2 visits, no registration made then, both still unregistered at month end', last.visited === vBefore.last.visited + 2 && last.registered === vBefore.last.registered && last.notRegistered === vBefore.last.notRegistered + 2, JSON.stringify(last))
      check('visit summary: this month counts no new visit but the registration, marked as from an earlier visit', now.visited === vBefore.now.visited && now.registered === vBefore.now.registered + 1 && now.registeredFromEarlier === vBefore.now.registeredFromEarlier + 1, JSON.stringify(now))
      const lmRows = (await listEnquiries(tx, act, { visited: true, query: { from: lmFrom, to: lmTo } })).rows
      check('visited list: filtered by visit date, and the registered one is marked (green) in the month it visited', lmRows.map((r) => r.name).sort().join() === 'Mohan,Nita' && !!lmRows.find((r) => r.name === 'Mohan')?.registeredAt && !lmRows.find((r) => r.name === 'Nita')?.registeredAt)
      const allTime = await visitSummary(tx, act)
      check('visit summary: all time adds up', allTime.visited >= 2 && allTime.registered >= 1 && allTime.registeredFromEarlier === 0)

      const logs = (query: ListQuery = {}) => listLogs(tx, act, { query, limit: 200 })
      const allLogs = await logs()
      check('logs: every action of this branch is listed, newest first', allLogs.total > 10 && allLogs.rows.every((r, i, arr) => i === 0 || arr[i - 1].at >= r.at) && allLogs.rows.every((r) => r.by === 'Lister'))
      check('logs: filter by area and action', (await logs({ f: { entity: 'call', action: 'delete' } })).rows.every((r) => r.entity === 'call' && r.action === 'delete') && (await logs({ f: { entity: 'call', action: 'delete' } })).total === 2)
      const one = (await logs({ f: { entity: 'enquiry', action: 'follow_up' } })).rows.find((r) => r.subject?.includes('Ishan'))
      check('logs: say what happened, to which record, and what changed', !!one && one.what === 'Saved a follow-up on an enquiry / lead' && one.detail.includes('status: new → follow_up') && one.detail.includes('2030-03-01'), JSON.stringify(one))
      check('logs: search by person name and junk filters are ignored', (await logs({ q: 'lister' })).total === allLogs.total && (await logs({ f: { entity: "x'; drop", user: 'nope' } })).total === allLogs.total)
      check('logs: date range', (await logs({ from: today, to: today })).total === allLogs.total && (await logs({ to: '2020-01-01' })).total === 0)
      check('logs: secrets and bare ids are left out of the details', describeChange({ passwordHash: 'a', status: 'new', personId: '6d2f682c-178f-475c-9622-a4c7bcaca3ab' }, { passwordHash: 'b', status: 'dead', personId: '7d2f682c-178f-475c-9622-a4c7bcaca3ab' }) === 'status: new → dead')
      check('logs: filter lists come from the log itself', (await logFilters(tx, act)).actions.some((x) => x.value === 'follow_up' && x.label === 'Saved a follow-up on'))
      check('logs: only with the permission to see the audit log', await fails(() => listLogs(tx, { ...act, role: 'counselor' }, {})))

      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) { console.error(e); failed++ }
  }
  await pool.end()
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASS')
  process.exit(failed ? 1 : 0)
}
main()
