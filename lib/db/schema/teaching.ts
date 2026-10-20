import { sql } from 'drizzle-orm'
import { boolean, check, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { branches, bytea, courses, users } from './core'
import { persons } from './admissions'
import { registrations } from './registrations'
import { batches, classSessions } from './academics'
import { orgId } from './tenancy'

// The syllabus: one list of topics per course, shared by every branch (a change waits for head office).
export const courseTopics = pgTable(
  'course_topics',
  {
    orgId: orgId(),
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
    module: text('module'), // the heading the topic sits under
    title: text('title').notNull(),
    details: text('details'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('course_topics_course_idx').on(t.courseId, t.sortOrder)],
)

/** The course's syllabus as a file (PDF / document), one per course. */
export const courseSyllabusFiles = pgTable('course_syllabus_files', {
  orgId: orgId(),
  courseId: uuid('course_id').primaryKey().references(() => courses.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  mime: text('mime').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  data: bytea('data').notNull(),
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
})

// A branch proposes a new topic list and / or file; head office approves or rejects it. One pending per course.
export const syllabusChanges = pgTable(
  'syllabus_changes',
  {
    orgId: orgId(),
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').references(() => branches.id),
    topics: jsonb('topics'), // the proposed list (null = topics unchanged)
    fileAction: text('file_action'), // replace | remove | null (file unchanged)
    fileName: text('file_name'),
    mime: text('mime'),
    sizeBytes: integer('size_bytes'),
    data: bytea('data'),
    status: text('status').notNull().default('pending'), // pending | approved | rejected | withdrawn
    proposedBy: uuid('proposed_by').references(() => users.id),
    proposedAt: timestamp('proposed_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
  },
  (t) => [
    uniqueIndex('syllabus_changes_pending_uq').on(t.courseId).where(sql`status = 'pending'`),
    index('syllabus_changes_status_idx').on(t.status, t.proposedAt),
    check('syllabus_changes_file_ck', sql`file_action IS NULL OR file_action IN ('replace', 'remove')`),
    check('syllabus_changes_status_ck', sql`status IN ('pending', 'approved', 'rejected', 'withdrawn')`),
  ],
)

/** The topics a batch has covered, and on which class. */
export const batchTopics = pgTable(
  'batch_topics',
  {
    orgId: orgId(),
    batchId: uuid('batch_id').notNull().references(() => batches.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id').notNull().references(() => courseTopics.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    sessionId: uuid('session_id').references(() => classSessions.id, { onDelete: 'set null' }),
    coveredOn: date('covered_on').notNull(),
    markedBy: uuid('marked_by').references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.batchId, t.topicId] }), index('batch_topics_session_idx').on(t.sessionId), index('batch_topics_topic_idx').on(t.topicId)],
)

/** A trainer's test for a batch; each student's marks are an assessment of kind 'test'. */
export const tests = pgTable(
  'tests',
  {
    orgId: orgId(),
    id: uuid('id').primaryKey().defaultRandom(),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    batchId: uuid('batch_id').notNull().references(() => batches.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    testDate: date('test_date').notNull(),
    maxScore: integer('max_score').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('tests_batch_idx').on(t.batchId, t.testDate), check('tests_max_score_check', sql`max_score > 0`)],
)

/** Study notes (text, link or file) for a batch or a course, shared with its students and / or trainers. */
export const notes = pgTable(
  'notes',
  {
    orgId: orgId(),
    id: uuid('id').primaryKey().defaultRandom(),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    batchId: uuid('batch_id').references(() => batches.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id').references(() => courses.id),
    title: text('title').notNull(),
    body: text('body'),
    url: text('url'),
    fileName: text('file_name'),
    mime: text('mime'),
    sizeBytes: integer('size_bytes'),
    data: bytea('data'),
    shareStudents: boolean('share_students').notNull().default(true),
    shareTrainers: boolean('share_trainers').notNull().default(false),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('notes_batch_idx').on(t.batchId, t.createdAt)],
)

// Project / study help: a student asks, trainers of any branch offer, the student picks one.
// status: open -> assigned (a trainer chosen) -> done | cancelled
export const helpRequests = pgTable(
  'help_requests',
  {
    orgId: orgId(),
    id: uuid('id').primaryKey().defaultRandom(),
    requestNo: text('request_no').notNull().default(sql`'HLP-' || lpad(app_org_seq('HLP', 'ALL')::text, 5, '0')`),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    registrationId: uuid('registration_id').references(() => registrations.id),
    personId: uuid('person_id').notNull().references(() => persons.id),
    createdBy: uuid('created_by').references(() => users.id),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    details: text('details').notNull(),
    status: text('status').notNull().default('open'),
    chosenTrainerId: uuid('chosen_trainer_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('help_requests_status_idx').on(t.status, t.createdAt), check('help_requests_status_ck', sql`status IN ('open', 'assigned', 'done', 'cancelled')`), index('help_requests_person_idx').on(t.personId), index('help_requests_chosen_trainer_idx').on(t.chosenTrainerId), index('help_requests_registration_idx').on(t.registrationId)],
)

export const helpOffers = pgTable(
  'help_offers',
  {
    orgId: orgId(),
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id').notNull().references(() => helpRequests.id, { onDelete: 'cascade' }),
    trainerId: uuid('trainer_id').notNull().references(() => users.id),
    message: text('message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('help_offers_uq').on(t.requestId, t.trainerId), index('help_offers_trainer_idx').on(t.trainerId)],
)

// A branch asks a trainer (of any branch) to take a batch; the trainer accepts or declines. One pending per batch.
// The labels are copied in so the trainer can read the request without seeing the other branch's data.
export const trainerRequests = pgTable(
  'trainer_requests',
  {
    orgId: orgId(),
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id').notNull().references(() => batches.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    trainerId: uuid('trainer_id').notNull().references(() => users.id),
    trainerLabel: text('trainer_label').notNull(),
    branchLabel: text('branch_label').notNull(),
    batchLabel: text('batch_label').notNull(),
    note: text('note'),
    status: text('status').notNull().default('pending'), // pending | accepted | declined | cancelled | ended
    requestedBy: uuid('requested_by').references(() => users.id),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
  },
  (t) => [
    uniqueIndex('trainer_requests_one_pending').on(t.batchId).where(sql`status = 'pending'`),
    index('trainer_requests_trainer').on(t.trainerId, t.status),
    check('trainer_requests_status_check', sql`status IN ('pending', 'accepted', 'declined', 'cancelled', 'ended')`),
  ],
)
