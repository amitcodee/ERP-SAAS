// Student help desk and notice board.
// Tickets: a student raises one from the portal (about fees, the course, a certificate...), the branch answers in its
// thread, and either side can close it. The database keeps a student to their own tickets (student RLS) and staff to
// their branch. Announcements: head office posts to every branch or one; a branch manager to their own branch.
import { sql, type SQL } from 'drizzle-orm'
import { nextOrgNo } from '@/lib/numbering'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { can } from '@/lib/auth/permissions'

export const TICKET_CATEGORIES = [
  { key: 'fees', label: 'Fees & receipts' },
  { key: 'course', label: 'Course & classes' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'certificate', label: 'Certificate & letters' },
  { key: 'id_card', label: 'ID card' },
  { key: 'login', label: 'Login & portal' },
  { key: 'other', label: 'Something else' },
] as const
/** What staff raise internal tickets about. */
export const INTERNAL_CATEGORIES = [
  { key: 'it', label: 'Computers, internet & panel' },
  { key: 'accounts', label: 'Accounts & fees' },
  { key: 'admissions', label: 'Admissions & leads' },
  { key: 'academics', label: 'Classes & academics' },
  { key: 'hr', label: 'HR, salary & leave' },
  { key: 'facility', label: 'Building & facilities' },
  { key: 'other_internal', label: 'Something else' },
] as const
export type TicketCategory = (typeof TICKET_CATEGORIES)[number]['key']
export type InternalCategory = (typeof INTERNAL_CATEGORIES)[number]['key']
export const categoryLabel = (k: string) => [...TICKET_CATEGORIES, ...INTERNAL_CATEGORIES].find((c) => c.key === k)?.label ?? k

/** Priority and its SLA: a reply is due within these hours while the ticket waits for the branch. */
export const PRIORITIES = [
  { key: 'urgent', label: 'Urgent', hours: 4 },
  { key: 'high', label: 'High', hours: 12 },
  { key: 'normal', label: 'Normal', hours: 24 },
  { key: 'low', label: 'Low', hours: 72 },
] as const
export type Priority = (typeof PRIORITIES)[number]['key']
const slaHours = (p: string) => PRIORITIES.find((x) => x.key === p)?.hours ?? 24
/** Overdue by this much more, an escalated ticket goes on to head office. */
export const HEAD_OFFICE_AFTER_HOURS = 24

const isStudent = (a: Actor) => a.role === 'student'
/** Who runs the help desk of the branch (the branch manager by default; head office for every branch). */
const isManager = (a: Actor) => a.role !== 'student' && can(a, 'update', 'helpdesk')
/** Who runs the help desk: head office and branch managers (every ticket of the branch). */
export const canAnswerTickets = (a: Actor) => isManager(a)
/** Who posts announcements: head office, or a branch manager for their branch. */
export const canPostAnnouncements = (a: Actor) => isManager(a)

export type TicketMessage = { id: string; body: string; fromStaff: boolean; author: string | null; at: string; requester: boolean }
export type TicketRow = {
  id: string; ticketNo: string; kind: 'student' | 'internal'; category: string; subject: string; status: 'open' | 'answered' | 'closed'
  createdAt: string; updatedAt: string; closedAt: string | null
  /** who raised it: the student, or the staff member (internal) */
  student: string; regNo: string | null; phone: string | null; branch: string | null; registrationId: string | null
  messages: number; lastFromStaff: boolean
  priority: Priority; dueAt: string | null; firstReplyAt: string | null
  assignedTo: { id: string; name: string } | null
  escalationLevel: 0 | 1 | 2; escalatedAt: string | null; escalationNote: string | null; toHeadOffice: boolean
  rating: number | null; ratingNote: string | null
  /** what this person may do with it */
  can: { answer: boolean; manage: boolean; requester: boolean }
}

const body = z.string().trim().min(2, 'Write your message').max(4000, 'The message is too long (4,000 characters at most)')
const raiseInput = z.object({
  registrationId: z.string().uuid().nullable().optional(),
  category: z.enum(TICKET_CATEGORIES.map((c) => c.key) as [TicketCategory, ...TicketCategory[]]),
  subject: z.string().trim().min(3, 'Give it a short subject').max(150),
  body,
})
export type RaiseTicketInput = z.input<typeof raiseInput>

/** A student raises a ticket about one of their enrolments (or in general). The first message opens the thread. */
export async function raiseTicket(tx: Tx, actor: Actor, raw: RaiseTicketInput) {
  if (!isStudent(actor) || !actor.personId) throw new Error('Only a student raises a ticket here')
  const v = raiseInput.parse(raw)
  // the database returns only this student's registrations
  const [reg] = (await tx.execute<{ id: string; branch_id: string }>(sql`
    select id, branch_id from registrations ${v.registrationId ? sql`where id = ${v.registrationId}` : sql``} order by created_at desc limit 1`)).rows
  if (!reg) throw new Error('No enrolment found on your account')
  // a login problem keeps the student out of their portal: answered sooner
  const priority: Priority = v.category === 'login' ? 'high' : 'normal'
  const [t] = (await tx.execute<{ id: string; ticket_no: string }>(sql`
    insert into support_tickets (ticket_no, branch_id, registration_id, person_id, created_by, category, subject, priority, due_at)
    values (${await nextOrgNo(tx, 'TKT')}, ${reg.branch_id}, ${reg.id}, ${actor.personId}, ${actor.userId}, ${v.category}, ${v.subject}, ${priority}, now() + make_interval(hours => ${slaHours(priority)})) returning id, ticket_no`)).rows
  await tx.execute(sql`insert into support_messages (ticket_id, branch_id, author_id, from_staff, body) values (${t.id}, ${reg.branch_id}, ${actor.userId}, false, ${v.body})`)
  await audit(tx, actor, { action: 'raise', entity: 'support_ticket', entityId: t.id, after: { category: v.category, subject: v.subject } })
  return { id: t.id, ticketNo: t.ticket_no }
}

const internalInput = z.object({
  category: z.enum(INTERNAL_CATEGORIES.map((c) => c.key) as [InternalCategory, ...InternalCategory[]]),
  subject: z.string().trim().min(3, 'Give it a short subject').max(150),
  priority: z.enum(PRIORITIES.map((p) => p.key) as [Priority, ...Priority[]]).default('normal'),
  toHeadOffice: z.boolean().default(false),
  body,
})
export type InternalTicketInput = z.input<typeof internalInput>

/** Any staff member raises an internal ticket: to their branch manager, or (toHeadOffice) to head office. */
export async function raiseInternalTicket(tx: Tx, actor: Actor, raw: InternalTicketInput) {
  if (isStudent(actor)) throw new Error('Students raise their questions from the portal')
  if (!actor.branchId) throw new Error('Pick the branch first (top left)')
  const v = internalInput.parse(raw)
  const [t] = (await tx.execute<{ id: string; ticket_no: string }>(sql`
    insert into support_tickets (ticket_no, branch_id, person_id, created_by, kind, category, subject, priority, to_head_office, due_at)
    values (${await nextOrgNo(tx, 'TKT')}, ${actor.branchId}, null, ${actor.userId}, 'internal', ${v.category}, ${v.subject}, ${v.priority}, ${v.toHeadOffice}, now() + make_interval(hours => ${slaHours(v.priority)})) returning id, ticket_no`)).rows
  await tx.execute(sql`insert into support_messages (ticket_id, branch_id, author_id, from_staff, body) values (${t.id}, ${actor.branchId}, ${actor.userId}, true, ${v.body})`)
  await audit(tx, actor, { action: 'raise_internal', entity: 'support_ticket', entityId: t.id, after: { category: v.category, priority: v.priority, toHeadOffice: v.toHeadOffice } })
  return { id: t.id, ticketNo: t.ticket_no }
}

type TicketRef = { id: string; branch_id: string; status: string; ticket_no: string; person_id: string | null; kind: string; created_by: string | null; assigned_to: string | null; to_head_office: boolean; priority: string }
async function lockTicket(tx: Tx, ticketId: string) {
  const [t] = (await tx.execute<TicketRef>(sql`
    select id, branch_id, status, ticket_no, person_id, kind, created_by, assigned_to, to_head_office, priority from support_tickets where id = ${z.string().uuid().parse(ticketId)} for update`)).rows
  if (!t) throw new Error('Ticket not found')
  return t
}
/** The one who raised it: the student (their own, by the student rule) or the staff member of an internal ticket. */
const isRequester = (a: Actor, t: Pick<TicketRef, 'kind' | 'created_by'>) => (t.kind === 'student' ? isStudent(a) : t.created_by === a.userId)
/** Who handles it: head office; the branch manager (not a ticket meant for head office, unless assigned); the assignee. */
const isHandler = (a: Actor, t: Pick<TicketRef, 'kind' | 'created_by' | 'assigned_to' | 'to_head_office'>) =>
  !isStudent(a) && !isRequester(a, t) && (a.role === 'super_admin' || t.assigned_to === a.userId || (isManager(a) && !t.to_head_office))

/** A reply in the thread: from whoever raised it (the ticket waits for the branch again, the SLA restarts) or from a handler (answered). */
export async function replyTicket(tx: Tx, actor: Actor, ticketId: string, raw: string) {
  const text = body.parse(raw)
  const t = await lockTicket(tx, ticketId)
  const requester = isRequester(actor, t)
  if (!requester && !isHandler(actor, t)) throw new Error('Forbidden: answer tickets')
  if (t.status === 'closed' && !requester) throw new Error('This ticket is closed')
  await tx.execute(sql`insert into support_messages (ticket_id, branch_id, author_id, from_staff, body) values (${t.id}, ${t.branch_id}, ${actor.userId}, ${!isStudent(actor)}, ${text})`)
  if (requester) await tx.execute(sql`update support_tickets set status = 'open', closed_at = null, updated_at = now(), due_at = now() + make_interval(hours => ${slaHours(t.priority)}) where id = ${t.id}`)
  else await tx.execute(sql`update support_tickets set status = 'answered', closed_at = null, updated_at = now(), due_at = null, escalation_level = 0, first_reply_at = coalesce(first_reply_at, now()) where id = ${t.id}`)
  if (!requester) await audit(tx, actor, { action: 'answer', entity: 'support_ticket', entityId: t.id })
  // the student is e-mailed when the branch answers (the action does it, after the response)
  return { ticketNo: t.ticket_no, branchId: t.branch_id, personId: t.person_id, staff: !requester && t.kind === 'student', requesterId: t.kind === 'internal' && !requester ? t.created_by : null }
}

export async function closeTicket(tx: Tx, actor: Actor, ticketId: string) {
  const t = await lockTicket(tx, ticketId)
  if (!isRequester(actor, t) && !isHandler(actor, t)) throw new Error('Forbidden: answer tickets')
  if (t.status === 'closed') throw new Error('Ticket not found, or already closed')
  await tx.execute(sql`update support_tickets set status = 'closed', closed_at = now(), updated_at = now(), due_at = null where id = ${t.id}`)
  await audit(tx, actor, { action: 'close', entity: 'support_ticket', entityId: t.id })
}

/** A handler hands the ticket to a staff member of its branch (or takes it back with null). */
export async function assignTicket(tx: Tx, actor: Actor, ticketId: string, userId: string | null) {
  const t = await lockTicket(tx, ticketId)
  if (!isManager(actor) || !isHandler(actor, t)) throw new Error('Only head office or the branch manager assigns tickets')
  const uid = userId ? z.string().uuid().parse(userId) : null
  if (uid) {
    const [u] = (await tx.execute<{ id: string }>(sql`
      select u.id from users u where u.id = ${uid} and u.is_active and u.deleted_at is null and (u.branch_id = ${t.branch_id} or u.branch_id is null)
        and not exists (select 1 from user_roles r where r.user_id = u.id and r.role = 'student')`)).rows
    if (!u) throw new Error('Pick someone of the ticket’s branch')
  }
  await tx.execute(sql`update support_tickets set assigned_to = ${uid}, assigned_at = ${uid ? sql`now()` : sql`null`}, updated_at = now() where id = ${t.id}`)
  await audit(tx, actor, { action: 'assign', entity: 'support_ticket', entityId: t.id, after: { to: uid } })
  return { ticketNo: t.ticket_no, assignee: uid }
}

/** A handler changes the priority; while it waits, its SLA moves with it (from when it started waiting). */
export async function setTicketPriority(tx: Tx, actor: Actor, ticketId: string, priority: string) {
  const p = z.enum(PRIORITIES.map((x) => x.key) as [Priority, ...Priority[]]).parse(priority)
  const t = await lockTicket(tx, ticketId)
  if (!isHandler(actor, t)) throw new Error('Forbidden: change the priority')
  await tx.execute(sql`update support_tickets set priority = ${p},
    due_at = case when status = 'open' then due_at - make_interval(hours => ${slaHours(t.priority)}) + make_interval(hours => ${slaHours(p)}) else due_at end where id = ${t.id}`)
  await audit(tx, actor, { action: 'priority', entity: 'support_ticket', entityId: t.id, after: { priority: p } })
}

/** A handler (or the one who raised it) escalates to head office by hand, saying why. */
export async function escalateTicket(tx: Tx, actor: Actor, ticketId: string, note: string) {
  const why = z.string().trim().min(3, 'Say why it is escalated').max(500).parse(note)
  const t = await lockTicket(tx, ticketId)
  if (!isHandler(actor, t) && !(isRequester(actor, t) && !isStudent(actor))) throw new Error('Forbidden: escalate')
  if (t.status === 'closed') throw new Error('This ticket is closed')
  await tx.execute(sql`update support_tickets set escalation_level = 2, escalated_at = now(), escalation_note = ${why}, updated_at = now() where id = ${t.id}`)
  await audit(tx, actor, { action: 'escalate', entity: 'support_ticket', entityId: t.id, after: { note: why } })
}

/** Whoever raised it rates the help, once it is answered or closed (they may change their mind). */
export async function rateTicket(tx: Tx, actor: Actor, ticketId: string, rating: number, note: string | null) {
  const r = z.number().int().min(1, 'Pick 1 to 5 stars').max(5).parse(rating)
  const t = await lockTicket(tx, ticketId)
  if (!isRequester(actor, t)) throw new Error('Only the one who raised the ticket rates it')
  if (t.status === 'open') throw new Error('Rate it once the branch has answered')
  await tx.execute(sql`update support_tickets set rating = ${r}, rating_note = ${note?.trim().slice(0, 500) || null}, rated_at = now() where id = ${t.id}`)
  await audit(tx, actor, { action: 'rate', entity: 'support_ticket', entityId: t.id, after: { rating: r } })
}

/**
 * Escalation by the clock: a ticket waiting past its SLA goes to the branch manager (level 1), and HEAD_OFFICE_AFTER_HOURS
 * later to head office (level 2). Run before the lists are read (only the rows this person may change move).
 */
export async function escalateOverdue(tx: Tx) {
  await tx.execute(sql`
    update support_tickets set
      escalation_level = case when due_at + make_interval(hours => ${HEAD_OFFICE_AFTER_HOURS}) < now() then 2 else greatest(escalation_level, 1) end,
      escalated_at = coalesce(escalated_at, now()),
      escalation_note = coalesce(escalation_note, 'No reply within the SLA')
    where status = 'open' and due_at < now() and escalation_level < case when due_at + make_interval(hours => ${HEAD_OFFICE_AFTER_HOURS}) < now() then 2 else 1 end`)
}

/**
 * Tickets. A student: their own (student rule). The help desk (head office / branch manager): every ticket of the
 * branch, students' and internal (a branch manager does not see internal tickets meant for head office). 'mine':
 * the tickets this staff member raised or was given.
 */
export async function listTickets(tx: Tx, actor: Actor, opts: { status?: string; scope?: 'desk' | 'mine' } = {}): Promise<TicketRow[]> {
  const scope = isStudent(actor) ? 'student' : opts.scope ?? 'desk'
  if (scope === 'desk' && !canAnswerTickets(actor)) throw new Error('Forbidden: read tickets')
  if (!isStudent(actor)) await escalateOverdue(tx)
  const st = opts.status && ['open', 'answered', 'closed'].includes(opts.status) ? opts.status : null
  const where: SQL[] = []
  if (st) where.push(sql`t.status = ${st}`)
  if (scope === 'mine') where.push(sql`(t.created_by = ${actor.userId} and t.kind = 'internal' or t.assigned_to = ${actor.userId})`)
  if (scope === 'desk' && actor.role !== 'super_admin') where.push(sql`(not t.to_head_office or t.assigned_to = ${actor.userId} or t.created_by = ${actor.userId})`)
  const rows = (await tx.execute<Record<string, unknown>>(sql`
    select t.id, t.ticket_no, t.kind, t.category, t.subject, t.status, t.created_at, t.updated_at, t.closed_at, t.registration_id, t.created_by,
      t.priority, t.due_at, t.first_reply_at, t.assigned_to, au.name as assignee, t.escalation_level, t.escalated_at, t.escalation_note, t.to_head_office, t.rating, t.rating_note,
      case when t.kind = 'internal' then cu.name else trim(p.first_name || ' ' || coalesce(p.last_name, '')) end as student,
      case when t.kind = 'internal' then cu.phone else p.phone end as phone, r.reg_no, b.name as branch,
      (select count(*)::int from support_messages m where m.ticket_id = t.id) as messages,
      coalesce((select m.author_id is distinct from t.created_by from support_messages m where m.ticket_id = t.id order by m.created_at desc limit 1), false) as last_from_staff
    from support_tickets t left join persons p on p.id = t.person_id left join registrations r on r.id = t.registration_id left join branches b on b.id = t.branch_id
      left join users au on au.id = t.assigned_to left join users cu on cu.id = t.created_by
    ${where.length ? sql`where ${sql.join(where, sql` and `)}` : sql``}
    order by (t.status = 'open') desc, t.escalation_level desc, t.due_at nulls last, t.updated_at desc limit 300`)).rows
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)
  return rows.map((r) => {
    const ref = { kind: String(r.kind), created_by: (r.created_by as string) ?? null, assigned_to: (r.assigned_to as string) ?? null, to_head_office: !!r.to_head_office }
    const requester = isRequester(actor, ref)
    return {
      id: String(r.id), ticketNo: String(r.ticket_no), kind: r.kind as TicketRow['kind'], category: String(r.category), subject: String(r.subject), status: r.status as TicketRow['status'],
      createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!, closedAt: iso(r.closed_at),
      student: String(r.student ?? 'Staff'), regNo: (r.reg_no as string) ?? null, phone: (r.phone as string) ?? null, branch: (r.branch as string) ?? null, registrationId: (r.registration_id as string) ?? null,
      messages: Number(r.messages ?? 0), lastFromStaff: !!r.last_from_staff,
      priority: r.priority as Priority, dueAt: iso(r.due_at), firstReplyAt: iso(r.first_reply_at),
      assignedTo: r.assigned_to ? { id: String(r.assigned_to), name: String(r.assignee ?? 'Staff') } : null,
      escalationLevel: Number(r.escalation_level ?? 0) as 0 | 1 | 2, escalatedAt: iso(r.escalated_at), escalationNote: (r.escalation_note as string) ?? null, toHeadOffice: !!r.to_head_office,
      rating: r.rating == null ? null : Number(r.rating), ratingNote: (r.rating_note as string) ?? null,
      can: { answer: !requester && isHandler(actor, ref), manage: !requester && isManager(actor) && isHandler(actor, ref), requester },
    }
  })
}

/** The staff of a ticket's branch it can be given to. */
export async function ticketAssignees(tx: Tx, actor: Actor, ticketId: string) {
  const t = await lockTicket(tx, ticketId)
  if (!isManager(actor) || !isHandler(actor, t)) throw new Error('Only head office or the branch manager assigns tickets')
  return (await tx.execute<{ id: string; name: string }>(sql`
    select u.id, u.name from users u where u.is_active and u.deleted_at is null and u.branch_id = ${t.branch_id}
      and not exists (select 1 from user_roles r where r.user_id = u.id and r.role = 'student') order by u.name`)).rows
}

/** A ticket's messages, oldest first. Staff names show to staff; a student sees "<branch> office". */
export async function ticketMessages(tx: Tx, actor: Actor, ticketId: string): Promise<TicketMessage[]> {
  const [t] = (await tx.execute<Pick<TicketRef, 'kind' | 'created_by' | 'assigned_to' | 'to_head_office'>>(sql`
    select kind, created_by, assigned_to, to_head_office from support_tickets where id = ${z.string().uuid().parse(ticketId)}`)).rows
  if (!t) throw new Error('Ticket not found')
  if (!isRequester(actor, t) && !isHandler(actor, t)) throw new Error('Forbidden: read tickets')
  const rows = (await tx.execute<{ id: string; body: string; from_staff: boolean; author: string | null; author_id: string | null; created_at: string }>(sql`
    select m.id, m.body, m.from_staff, u.name as author, m.author_id, m.created_at from support_messages m left join users u on u.id = m.author_id
    where m.ticket_id = ${ticketId} order by m.created_at`)).rows
  return rows.map((m) => ({
    id: m.id, body: m.body, author: m.author, at: new Date(m.created_at).toISOString(),
    // the requester's own messages vs the branch's answers (an internal ticket's raiser is staff too)
    requester: t.kind === 'student' ? !m.from_staff : m.author_id === t.created_by,
    fromStaff: t.kind === 'student' ? m.from_staff : m.author_id !== t.created_by,
  }))
}

// ---- announcements

export type Announcement = { id: string; title: string; body: string; pinned: boolean; endsOn: string | null; branch: string | null; createdAt: string; by: string | null }

const announcementInput = z.object({
  title: z.string().trim().min(3, 'Give it a title').max(150),
  body: z.string().trim().min(3, 'Write the announcement').max(5000),
  pinned: z.boolean().default(false),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  /** head office: a branch, or null for every branch. Ignored for a branch manager (always their branch). */
  branchId: z.string().uuid().nullable().optional(),
})
export type AnnouncementInput = z.input<typeof announcementInput>

/** What is on the board now (or, with `all`, also the ended ones, for the people who post). Pinned first, newest next. */
export async function listAnnouncements(tx: Tx, actor: Actor, all = false): Promise<Announcement[]> {
  const rows = (await tx.execute<{ id: string; title: string; body: string; pinned: boolean; ends_on: string | null; branch: string | null; created_at: string; by: string | null }>(sql`
    select a.id, a.title, a.body, a.pinned, a.ends_on::text, b.name as branch, a.created_at, u.name as by
    from announcements a left join branches b on b.id = a.branch_id left join users u on u.id = a.created_by
    where a.deleted_at is null ${all ? sql`` : sql`and (a.ends_on is null or a.ends_on >= (now() at time zone 'Asia/Kolkata')::date)`}
      ${!isStudent(actor) && actor.role !== 'super_admin' ? sql`and (a.branch_id is null or a.branch_id = ${actor.branchId}::uuid)` : sql``}
    order by a.pinned desc, a.created_at desc limit 100`)).rows
  return rows.map((r) => ({ id: r.id, title: r.title, body: r.body, pinned: r.pinned, endsOn: r.ends_on, branch: r.branch, createdAt: new Date(r.created_at).toISOString(), by: r.by }))
}

export async function postAnnouncement(tx: Tx, actor: Actor, raw: AnnouncementInput) {
  if (!canPostAnnouncements(actor)) throw new Error('Only head office or a branch manager posts announcements')
  const v = announcementInput.parse(raw)
  const branchId = actor.role === 'super_admin' ? v.branchId ?? null : actor.branchId
  if (actor.role !== 'super_admin' && !branchId) throw new Error('Pick the branch first (top left)')
  const [a] = (await tx.execute<{ id: string }>(sql`
    insert into announcements (branch_id, title, body, pinned, ends_on, created_by) values (${branchId}, ${v.title}, ${v.body}, ${v.pinned}, ${v.endsOn ?? null}, ${actor.userId}) returning id`)).rows
  await audit(tx, actor, { action: 'create', entity: 'announcement', entityId: a.id, after: { title: v.title, branchId } })
  return a
}

export async function setAnnouncementPinned(tx: Tx, actor: Actor, id: string, pinned: boolean) {
  if (!canPostAnnouncements(actor)) throw new Error('Only head office or a branch manager changes announcements')
  const [a] = (await tx.execute<{ id: string }>(sql`update announcements set pinned = ${pinned} where id = ${z.string().uuid().parse(id)} and deleted_at is null returning id`)).rows
  if (!a) throw new Error('Announcement not found (a branch changes only its own)')
}

export async function removeAnnouncement(tx: Tx, actor: Actor, id: string) {
  if (!canPostAnnouncements(actor)) throw new Error('Only head office or a branch manager removes announcements')
  const [a] = (await tx.execute<{ id: string }>(sql`update announcements set deleted_at = now() where id = ${z.string().uuid().parse(id)} and deleted_at is null returning id`)).rows
  if (!a) throw new Error('Announcement not found (a branch removes only its own)')
  await audit(tx, actor, { action: 'delete', entity: 'announcement', entityId: a.id })
}

