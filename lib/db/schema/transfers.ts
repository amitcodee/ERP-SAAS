import { sql } from 'drizzle-orm'
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { branches, users } from './core'
import { registrations } from './registrations'
import { batches } from './academics'
import { orgId } from './tenancy'

// A student moving to another branch: the branch they leave asks, the other accepts (a new registration there,
// to_registration_id) or rejects. One open request per registration.
export const registrationTransfers = pgTable(
  'registration_transfers',
  {
    orgId: orgId(),
    id: uuid('id').primaryKey().defaultRandom(),
    fromRegistrationId: uuid('from_registration_id').notNull().references(() => registrations.id),
    fromBranchId: uuid('from_branch_id').notNull().references(() => branches.id),
    toBranchId: uuid('to_branch_id').notNull().references(() => branches.id),
    toRegistrationId: uuid('to_registration_id').references(() => registrations.id),
    status: text('status').notNull().default('pending'), // pending | accepted | rejected | cancelled
    reason: text('reason').notNull(),
    balanceAtRequest: integer('balance_at_request').notNull().default(0), // paise
    requestedBy: uuid('requested_by').references(() => users.id),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
  },
  (t) => [
    index('registration_transfers_from_idx').on(t.fromBranchId, t.status, t.requestedAt),
    uniqueIndex('registration_transfers_open_uq').on(t.fromRegistrationId).where(sql`status = 'pending'`),
    index('registration_transfers_to_idx').on(t.toBranchId, t.status, t.requestedAt),
    check('registration_transfers_branches_ck', sql`from_branch_id <> to_branch_id`),
    check('registration_transfers_status_ck', sql`status IN ('pending', 'accepted', 'rejected', 'cancelled')`),
    index('registration_transfers_to_registration_idx').on(t.toRegistrationId)],
)

// A student of one branch (home) taking some classes in another (host): the home branch asks, the host accepts into
// one of its batches; either side ends it (modules/registrations/shares.ts). One open share per student and branch.
export const studentShares = pgTable(
  'student_shares',
  {
    orgId: orgId(),
    id: uuid('id').primaryKey().defaultRandom(),
    registrationId: uuid('registration_id').notNull().references(() => registrations.id),
    fromBranchId: uuid('from_branch_id').notNull().references(() => branches.id),
    toBranchId: uuid('to_branch_id').notNull().references(() => branches.id),
    mode: text('mode').notNull().default('classroom'), // classroom | online
    schedule: text('schedule'), // e.g. Tue, Thu, Sat 4-6 pm
    note: text('note').notNull(),
    status: text('status').notNull().default('pending'), // pending | accepted | declined | cancelled | ended
    batchId: uuid('batch_id').references(() => batches.id),
    requestedBy: uuid('requested_by').references(() => users.id),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    endedBy: uuid('ended_by').references(() => users.id),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('student_shares_open_uq').on(t.registrationId, t.toBranchId).where(sql`status IN ('pending', 'accepted')`),
    index('student_shares_to_idx').on(t.toBranchId, t.status),
    index('student_shares_from_idx').on(t.fromBranchId, t.status),
    check('student_shares_mode_ck', sql`mode IN ('classroom', 'online')`),
    check('student_shares_status_ck', sql`status IN ('pending', 'accepted', 'declined', 'cancelled', 'ended')`),
    check('student_shares_branches_ck', sql`from_branch_id <> to_branch_id`),
    index('student_shares_batch_idx').on(t.batchId)],
)
