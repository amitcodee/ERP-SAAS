import { sql } from 'drizzle-orm'
import { boolean, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { branches, users } from './core'
import { persons } from './admissions'
import { registrations } from './registrations'
import { orgId } from './tenancy'

// Student help: a student raises a ticket from the portal, the branch answers in its thread.
// status: open (waiting for the branch) -> answered (waiting for the student) -> closed
export const supportTickets = pgTable('support_tickets', {
  orgId: orgId(),
  id: uuid('id').primaryKey().defaultRandom(),
  ticketNo: text('ticket_no').notNull().default(sql`'TKT-' || lpad(app_org_seq('TKT', 'ALL')::text, 5, '0')`), // the org's format (lib/numbering.ts); this default only for rows made outside it
  branchId: uuid('branch_id').notNull().references(() => branches.id),
  registrationId: uuid('registration_id').references(() => registrations.id),
  personId: uuid('person_id').references(() => persons.id), // the student (null on an internal ticket)
  createdBy: uuid('created_by').references(() => users.id),
  kind: text('kind').notNull().default('student'), // student | internal (raised by staff)
  category: text('category').notNull(), // student: fees | course | ...; internal: it | accounts | ...
  subject: text('subject').notNull(),
  status: text('status').notNull().default('open'),
  priority: text('priority').notNull().default('normal'), // low | normal | high | urgent
  assignedTo: uuid('assigned_to').references(() => users.id),
  assignedAt: timestamp('assigned_at', { withTimezone: true }),
  dueAt: timestamp('due_at', { withTimezone: true }), // SLA: a reply is due by then, while it waits for the branch
  firstReplyAt: timestamp('first_reply_at', { withTimezone: true }),
  escalationLevel: integer('escalation_level').notNull().default(0), // 0 none, 1 branch manager, 2 head office
  escalatedAt: timestamp('escalated_at', { withTimezone: true }),
  escalationNote: text('escalation_note'),
  toHeadOffice: boolean('to_head_office').notNull().default(false), // an internal ticket for head office
  rating: integer('rating'), // 1-5, from whoever raised it
  ratingNote: text('rating_note'),
  ratedAt: timestamp('rated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
},
  (t) => [index('support_tickets_due_idx').on(t.status, t.dueAt), index('support_tickets_created_by_idx').on(t.createdBy), uniqueIndex('support_tickets_no_uq').on(t.ticketNo), index('support_tickets_branch_idx').on(t.branchId, t.status, t.updatedAt), index('support_tickets_person_idx').on(t.personId), index('support_tickets_assigned_idx').on(t.assignedTo, t.status), index('support_tickets_registration_idx').on(t.registrationId)])

export const supportMessages = pgTable('support_messages', {
  orgId: orgId(),
  id: uuid('id').primaryKey().defaultRandom(),
  ticketId: uuid('ticket_id').notNull().references(() => supportTickets.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id').notNull().references(() => branches.id),
  authorId: uuid('author_id').references(() => users.id),
  fromStaff: boolean('from_staff').notNull().default(false),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
},
  (t) => [index('support_messages_ticket_idx').on(t.ticketId, t.createdAt)])

// The notice board students see: head office posts to every branch (branchId null) or one; a branch manager to theirs.
export const announcements = pgTable('announcements', {
  orgId: orgId(),
  id: uuid('id').primaryKey().defaultRandom(),
  branchId: uuid('branch_id').references(() => branches.id),
  title: text('title').notNull(),
  body: text('body').notNull(),
  pinned: boolean('pinned').notNull().default(false),
  endsOn: date('ends_on'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
},
  (t) => [index('announcements_branch_idx').on(t.branchId, t.createdAt)])
