import 'server-only'
// Every list the panel can download (Excel, CSV, PDF): its columns and how its rows are read. The rows come from the
// SAME functions as the screen, with the screen's search, filters, date range and sort, so a download is exactly what
// the list shows — all pages of it (up to MAX_ROWS). Who may download a list = who may open its page.
import type { ModuleKey } from '@/lib/panel/modules'
import type { Actor, Tx } from '@/lib/db/withTenant'
import type { ListQuery } from '@/lib/list-query'
import type { Cell, Column } from '@/lib/export/formats'
import { listLogs } from '@/modules/audit/service'
import { listCallsPage, listEnquiries } from '@/modules/enquiries/service'
import { listRegistrations } from '@/modules/registrations/service'
import { listFeesPage } from '@/modules/fees/service'
import { certificatePage } from '@/modules/certificates/service'
import { listCourses } from '@/modules/catalog/service'
import { listUsers } from '@/modules/users/service'
import { listTransfers } from '@/modules/registrations/transfer'
import { listTickets, categoryLabel } from '@/modules/support/service'
import { leaderboards } from '@/modules/reports/leaderboards'
import { listWebLeads } from '@/modules/web-leads/service'
import { getEvent } from '@/modules/events/service'
import { todayIST } from '@/lib/ist'

export const MAX_ROWS = 10000
type Def = { title: string; module: ModuleKey; columns: Column[]; rows: (tx: Tx, actor: Actor, q: ListQuery) => Promise<Cell[][]> }
const T = (label: string, width?: number): Column => ({ label, width })
const M = (label: string): Column => ({ label, kind: 'money' })
const D = (label: string): Column => ({ label, kind: 'date' })
const DT = (label: string): Column => ({ label, kind: 'datetime' })
const N = (label: string): Column => ({ label, kind: 'number' })
const yes = (b: unknown) => (b ? 'Yes' : 'No')
const word = (s: unknown) => (s == null ? '' : String(s).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()))

// leads / enquiries share one shape
type Enq = Awaited<ReturnType<typeof listEnquiries>>['rows'][number]
const ENQ_COLUMNS = [T('Enquiry no.'), DT('Added'), T('Name'), T('Phone'), T('Course / department'), T('Source'), T('Status'), N('Interest %'), D('Next follow-up'), T('Staff'), M('Fee'), T('Registration no.'), T('Location'), T('Category')]
const enqRow = (r: Enq): Cell[] => [r.enquiryNo, String(r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt), r.name, r.phone, r.course ?? r.department, r.source, word(r.status), r.interestPct, r.nextFollowUp, r.staff, r.fee, r.regNo, r.location, r.category]
const enquiries = (visited: boolean | undefined, mine = false) => async (tx: Tx, actor: Actor, query: ListQuery) =>
  (await listEnquiries(tx, actor, { query, visited, mine, limit: MAX_ROWS, offset: 0 })).rows.map(enqRow)

export const EXPORTS: Record<string, Def> = {
  enquiries: { title: 'Visited enquiries', module: 'Enquiry', columns: ENQ_COLUMNS, rows: enquiries(true) },
  leads: { title: 'Leads', module: 'Leads', columns: ENQ_COLUMNS, rows: enquiries(false) },
  'my-leads': { title: 'My leads', module: 'My Leads', columns: ENQ_COLUMNS, rows: enquiries(undefined, true) },
  'enquiry-update': { title: 'All enquiries', module: 'Enquiry Update', columns: ENQ_COLUMNS, rows: enquiries(undefined) },
  calls: {
    title: 'Random calls', module: 'Random Call',
    columns: [DT('Called at'), T('Name'), T('Phone'), T('Alternate no.'), T('Course / department'), T('Status'), N('Interest %'), D('Follow-up date'), T('Received by'), T('Branch'), N('Follow-ups'), T('Remarks')],
    rows: async (tx, actor, query) => (await listCallsPage(tx, actor, { query, limit: MAX_ROWS, offset: 0 })).rows.map((r) => [
      r.calledAt instanceof Date ? r.calledAt.toISOString() : String(r.calledAt), r.name, r.phone, r.altPhone, r.course ?? r.department, r.status, r.interestPct, r.followUpDate, r.receivedBy, r.branchName, r.followUps, r.callRemark ?? r.remarks]),
  },
  registrations: {
    title: 'Registrations', module: 'Registration',
    columns: [T('Registration no.'), T('Name'), T('Phone'), T('Course'), T('Department'), T('Mode'), D('Enrolled'), D('Joining'), D('Expected end'), T('Status'), M('Total fee'), M('Paid')],
    rows: async (tx, actor, query) => (await listRegistrations(tx, actor, { query, limit: MAX_ROWS, offset: 0 })).rows.map((r) => [
      r.regNo, r.name, r.phone, r.course, r.department, r.mode, String(r.enrollmentDate), r.joiningDate, r.expectedEndDate, word(r.status), r.totalFee, r.settled]),
  },
  fees: {
    title: 'Fees', module: 'Fees',
    columns: [T('Registration no.'), T('Name'), T('Phone'), T('Course'), T('Status'), M('Total fee'), M('Discount'), M('Paid'), M('Balance'), D('Next due'), M('Next due amount'), N('Days overdue'), N('Installments to come')],
    rows: async (tx, actor, query) => (await listFeesPage(tx, actor, { query, limit: MAX_ROWS, offset: 0 })).rows.map((r) => [
      r.regNo, r.name, r.phone, r.course, word(r.status), r.charged - r.discounted, r.discounted, r.paid, r.balance, r.nextDue, r.nextDueAmount, r.daysOverdue || null, r.scheduled]),
  },
  students: {
    title: 'Students', module: 'Students',
    columns: [T('Registration no.'), T('Name'), T('Course'), D('Joined'), D('Ends'), M('Fee balance'), N('Attendance %'), T('Capstone'), T('Certificate ready'), T('Certificate no.'), T('Certificate request'), T('E-mail')],
    rows: async (tx, actor, query) => (await certificatePage(tx, actor, { query, limit: MAX_ROWS, offset: 0 })).rows.map((r) => [
      r.regNo, r.name, r.course, r.joined, r.ends, r.eligibility.feeBalance, Math.round(r.eligibility.attendancePct), r.eligibility.capstoneOk ? 'Approved' : 'Not yet', yes(r.eligibility.eligible),
      r.certNo ? `${r.certNo}${r.revoked ? ' (revoked)' : ''}` : '', word(r.requestStatus), r.email]),
  },
  logs: {
    title: 'Activity log', module: 'Logs',
    columns: [DT('When'), T('By'), T('Branch'), T('What'), T('About'), T('Detail'), T('IP')],
    rows: async (tx, actor, query) => (await listLogs(tx, actor, { query, limit: MAX_ROWS, offset: 0 })).rows.map((r) => [r.at, r.by, r.branch, r.what, r.subject, r.detail, r.ip]),
  },
  courses: {
    title: 'Courses', module: 'Courses',
    columns: [T('Course'), T('Department'), M('Fee'), N('Weeks'), N('Syllabus topics'), T('Syllabus PDF'), T('Status'), T('Skills / tools')],
    rows: async (tx, actor) => (await listCourses(tx, actor)).map((r) => [r.title, r.department, r.baseFee, r.durationWeeks, r.topics, yes(r.syllabusFile), word(r.status), r.skills]),
  },
  staff: {
    title: 'Users & staff', module: 'Users & Staff',
    columns: [T('Name'), T('E-mail'), T('Phone'), T('Roles'), T('Branch'), T('Also works in'), T('Active'), DT('Added'), DT('Last sign-in')],
    rows: async (tx, actor) => (await listUsers(tx, actor)).map((r) => [
      r.name, r.email, r.phone, r.roles.map((x) => (typeof x === 'string' ? x : (x as { name?: string; key?: string }).name ?? (x as { key?: string }).key ?? '')).join(', '), r.branchName,
      r.alsoBranches.map((b) => b.name).join(', '), yes(r.isActive), r.createdAt, r.lastLoginAt]),
  },
  transfers: {
    title: 'Student transfers', module: 'Transfers',
    columns: [T('Student'), T('Phone'), T('Course'), T('From branch'), T('From reg. no.'), T('To branch'), T('To reg. no.'), T('Reason'), M('Balance when asked'), T('Status'), DT('Asked'), T('Asked by'), DT('Decided'), T('Decided by'), T('Note')],
    rows: async (tx, actor) => (await listTransfers(tx, actor)).map((r) => [
      r.name, r.phone, r.course, r.fromBranch, r.fromRegNo, r.toBranch, r.toRegNo, r.reason, r.balance, word(r.status === 'accepted' ? 'transferred' : r.status), r.requestedAt, r.requestedBy, r.decidedAt, r.decidedBy, r.decisionNote]),
  },
  // the screen's website (f.site), state (f.state) and search
  'web-leads': {
    title: 'Website leads', module: 'Web Leads',
    columns: [DT('Received'), T('Name'), T('Phone'), T('E-mail'), T('Course'), T('Location'), T('Message', 40), T('Website'), T('Page'), T('Branch'), T('Sent to the branch'), T('Lead no.'), T('Not made a lead because')],
    rows: async (tx, actor, q) => (await listWebLeads(tx, actor, { site: q.f?.site || undefined, state: q.f?.state || undefined, q: q.q, limit: MAX_ROWS, max: MAX_ROWS })).rows.map((r) => [
      r.submittedAt, r.name, r.phone, r.email, r.course, r.location, r.message, r.siteHost, r.sourceUrl, r.branchName, r.matchedBy === 'location' ? 'By place' : r.matchedBy === 'manual' ? 'By head office' : r.matchedBy ? 'By its website' : '', r.enquiryNo, r.problem]),
  },
  // one event's participants (f.event)
  'event-participants': {
    title: 'Event participants', module: 'Seminars & Workshops',
    columns: [T('Name'), T('E-mail'), T('Mobile'), T('College / company'), N('Score'), N('Out of'), T('Passed'), T('Certificate no.'), DT('Certificate e-mailed'), T('E-mail problem'), DT('Signed up')],
    rows: async (tx, actor, q) => {
      const ev = /^[0-9a-f-]{36}$/i.test(q.f?.event ?? '') ? await getEvent(tx, actor, q.f!.event!) : null
      if (!ev) return []
      return ev.participants.map((p) => [p.name, p.email, p.mobile, p.organisation, p.score, p.total, p.passed == null ? '' : yes(p.passed), p.certNo, p.mailedAt, p.mailError, p.createdAt])
    },
  },
  tickets: {
    title: 'Help desk tickets', module: 'Help Desk',
    columns: [T('Ticket'), T('Type'), T('Subject'), T('About'), T('Raised by'), T('Reg. no.'), T('Branch'), T('Priority'), T('Status'), DT('Reply due'), T('Assigned to'), T('Escalation'), N('Rating'), DT('Raised'), DT('Last update')],
    rows: async (tx, actor) => (await listTickets(tx, actor, { scope: 'desk' })).map((r) => [
      r.ticketNo, r.kind === 'internal' ? 'Staff' : 'Student', r.subject, categoryLabel(r.category), r.student, r.regNo, r.branch, word(r.priority), word(r.status), r.status === 'open' ? r.dueAt : null,
      r.assignedTo?.name, ['', 'Branch manager', 'Head office'][r.escalationLevel], r.rating, r.createdAt, r.updatedAt]),
  },
  // leaderboards: the period comes in the query's date range (this month when none)
  'leaderboard-admissions': {
    title: 'Leaderboard — telecallers & counselors', module: 'Leaderboards',
    columns: [N('Rank'), T('Name'), T('Branch'), N('Leads'), N('Visited'), N('Joined'), N('Conversion %'), N('Follow-ups')],
    rows: async (_tx, actor, q) => ((await leaderboards(actor, period(q), { admissions: true, teaching: false })).admissions ?? []).map((r, i) => [i + 1, r.name, r.branch, r.leads, r.visited, r.joined, r.conversion, r.followUps]),
  },
  'leaderboard-trainers': {
    title: 'Leaderboard — trainers', module: 'Leaderboards',
    columns: [N('Rank'), T('Trainer'), T('Branch'), N('Index'), N('Attendance %'), N('Classes'), N('Test average %'), N('Tests'), N('Syllabus %'), N('Help done'), N('Batches')],
    rows: async (_tx, actor, q) => ((await leaderboards(actor, period(q), { admissions: false, teaching: true })).trainers ?? []).map((r, i) => [i + 1, r.name, r.branch, r.index, r.attendance, r.sessions, r.testAvg, r.tests, r.syllabus, r.helpDone, r.batches]),
  },
  'leaderboard-students': {
    title: 'Leaderboard — students', module: 'Leaderboards',
    columns: [N('Rank'), T('Student'), T('Registration no.'), T('Course'), T('Batch'), T('Branch'), N('Score'), N('Attendance %'), N('Classes'), N('Test average %'), N('Tests')],
    rows: async (_tx, actor, q) => ((await leaderboards(actor, period(q), { admissions: false, teaching: true }, q.f?.batch || null)).students ?? []).map((r, i) => [i + 1, r.name, r.regNo, r.course, r.batch, r.branch, r.score, r.attendance, r.sessions, r.testAvg, r.tests]),
  },
}

function period(q: ListQuery) {
  const today = todayIST()
  const iso = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && v <= today ? v : null)
  const from = iso(q.from) ?? today.slice(0, 8) + '01'
  const to = iso(q.to) && iso(q.to)! >= from ? iso(q.to)! : today
  return { from, to }
}
