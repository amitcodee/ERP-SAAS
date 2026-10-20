import { sql } from 'drizzle-orm'
import { boolean, date, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, time, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { branches, courses, departments, users } from './core'
import { registrations } from './registrations'
import { registrationDocuments } from './documents'
import { tests } from './teaching'
import { orgId } from './tenancy'

const id = () => uuid('id').primaryKey().defaultRandom()
const ts = (n: string) => timestamp(n, { withTimezone: true })

export const batches = pgTable(
  'batches',
  {
    orgId: orgId(),
    id: id(),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    name: text('name').notNull(),
    departmentId: uuid('department_id').notNull().references(() => departments.id),
    courseId: uuid('course_id').references(() => courses.id),
    trainerId: uuid('trainer_id').references(() => users.id),
    timing: text('timing'), // free text from before structured schedules; shown when days/times are not set
    days: integer('days').array(), // ISO weekdays the batch meets: 1 = Monday ... 7 = Sunday
    startTime: time('start_time'),
    endTime: time('end_time'),
    room: text('room'),
    startDate: date('start_date'),
    capacity: integer('capacity'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
    deletedAt: ts('deleted_at'), // in the Recycle Bin
    deletedBy: uuid('deleted_by').references(() => users.id),
  },
  (t) => [unique('batches_branch_name_uq').on(t.branchId, t.name), index('batches_trainer_idx').on(t.trainerId)],
)

export const batchMembers = pgTable(
  'batch_members',
  {
    orgId: orgId(),
    batchId: uuid('batch_id').notNull().references(() => batches.id),
    registrationId: uuid('registration_id').notNull().references(() => registrations.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    joinedAt: ts('joined_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.batchId, t.registrationId] }), index('batch_members_registration_idx').on(t.registrationId)],
)

export const classSessions = pgTable(
  'class_sessions',
  {
    orgId: orgId(),
    id: id(),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    batchId: uuid('batch_id').notNull().references(() => batches.id),
    sessionDate: date('session_date').notNull(),
    topic: text('topic'),
    createdBy: uuid('created_by').references(() => users.id),
  },
  (t) => [unique('class_sessions_batch_date_uq').on(t.batchId, t.sessionDate)],
)

export const attendance = pgTable(
  'attendance',
  {
    orgId: orgId(),
    sessionId: uuid('session_id').notNull().references(() => classSessions.id),
    registrationId: uuid('registration_id').notNull().references(() => registrations.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    present: boolean('present').notNull(),
    markedBy: uuid('marked_by').references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.registrationId] }), index('attendance_registration_idx').on(t.registrationId)],
)

export const assessmentKindEnum = pgEnum('assessment_kind', ['assignment', 'test', 'capstone'])

export const assessments = pgTable(
  'assessments',
  {
    orgId: orgId(),
    id: id(),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    registrationId: uuid('registration_id').notNull().references(() => registrations.id),
    kind: assessmentKindEnum('kind').notNull(),
    title: text('title').notNull(),
    score: integer('score'),
    maxScore: integer('max_score'),
    approvedBy: uuid('approved_by').references(() => users.id), // capstone: trainer sign-off
    tools: text('tools'), // capstone: what the project was built with, comma-separated (printed on the project certificate)
    approvedAt: ts('approved_at'),
    testId: uuid('test_id').references(() => tests.id, { onDelete: 'cascade' }), // a test of the batch (tests table); null for older one-off grades and the capstone
    sheetDocId: uuid('sheet_doc_id').references(() => registrationDocuments.id), // photo of the answer sheet (registration_documents)
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('assessments_reg_idx').on(t.registrationId, t.kind), uniqueIndex('assessments_test_reg_uq').on(t.testId, t.registrationId).where(sql`test_id IS NOT NULL`)],
)

export const certRequestStatusEnum = pgEnum('cert_request_status', ['pending', 'approved', 'rejected'])

export const certificateRequests = pgTable(
  'certificate_requests',
  {
    orgId: orgId(),
    id: id(),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    registrationId: uuid('registration_id').notNull().references(() => registrations.id),
    status: certRequestStatusEnum('status').notNull().default('pending'),
    blockingReasons: jsonb('blocking_reasons').$type<string[]>().notNull().default([]), // snapshot at request time
    requestedBy: uuid('requested_by').references(() => users.id),
    requestedAt: ts('requested_at').notNull().defaultNow(),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: ts('decided_at'),
    rejectionReason: text('rejection_reason'),
    feeClearedBy: uuid('fee_cleared_by').references(() => users.id), // accounts confirms nothing is due before issue
    feeClearedAt: ts('fee_cleared_at'),
    certCourseTitle: text('cert_course_title'), // what the certificate should print instead of the course name (null = the course's)
    certTools: text('cert_tools').array(), // the tools / modules it should list instead of the course's (null = the course's)
  },
  (t) => [index('cert_req_status_idx').on(t.branchId, t.status), index('certificate_requests_registration_idx').on(t.registrationId, t.requestedAt.desc())],
)

export const certificates = pgTable(
  'certificates',
  {
    orgId: orgId(),
    id: id(),
    certNo: text('cert_no').notNull(),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    registrationId: uuid('registration_id').notNull().references(() => registrations.id), // one LIVE certificate each (a revoked one may be followed by a new one)
    requestId: uuid('request_id').references(() => certificateRequests.id),
    issuedAt: ts('issued_at').notNull().defaultNow(),
    issuedBy: uuid('issued_by').references(() => users.id),
    verificationHash: text('verification_hash').notNull().unique(),
    isRevoked: boolean('is_revoked').notNull().default(false),
    revokedReason: text('revoked_reason'),
    revokedAt: ts('revoked_at'), // revoking: head office only
    revokedBy: uuid('revoked_by').references(() => users.id),
    // the words printed, frozen at issue (null on older certificates: the course's own words are shown)
    courseTitle: text('course_title'),
    tools: text('tools').array(),
    toolsLabel: text('tools_label'), // 'Tools' or 'Modules'
  },
  (t) => [
    uniqueIndex('certificates_cert_no_unique').on(t.orgId, t.certNo),
    uniqueIndex('certificates_live_uq').on(t.registrationId).where(sql`NOT is_revoked`),
    index('certificates_registration_idx').on(t.registrationId, t.issuedAt.desc()),
    index('certificates_request_idx').on(t.requestId)],
)
