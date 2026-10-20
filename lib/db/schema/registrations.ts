import { boolean, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { branches, courses, departments, lookups, users } from './core'
import { enquiries, persons } from './admissions'
import type { FeePlan } from '@/modules/fees/plan'
import { letterCompanies, letterTemplates } from './letters'
import { orgId } from './tenancy'

const id = () => uuid('id').primaryKey().defaultRandom()

export const registrationStatusEnum = pgEnum('registration_status', ['active', 'on_hold', 'discontinued', 'completed', 'transferred'])
export const registrationKindEnum = pgEnum('registration_kind', ['new', 'upgrade'])

// A person enrolling in a course. Personal details live on `persons` (P2), not here.
export const registrations = pgTable(
  'registrations',
  {
    orgId: orgId(),
    id: id(),
    regNo: text('reg_no').notNull(),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    personId: uuid('person_id').notNull().references(() => persons.id),
    enquiryId: uuid('enquiry_id').references(() => enquiries.id),
    kind: registrationKindEnum('kind').notNull().default('new'),
    previousRegistrationId: uuid('previous_registration_id'), // set for upgrades
    departmentId: uuid('department_id').notNull().references(() => departments.id),
    courseId: uuid('course_id').references(() => courses.id),
    // A customized course, made of modules chosen by the student, instead of one from the course list (courseId is then NULL).
    customCourseTitle: text('custom_course_title'),
    customCourse: jsonb('custom_course').$type<CustomCourse>(),
    classModeId: uuid('class_mode_id').references(() => lookups.id),
    enrollmentDate: date('enrollment_date').notNull(),
    joiningDate: date('joining_date'), // the day classes start (may be later than the registration)
    // How the classes run, and from that when the course should finish (worked out on the registration form).
    classMinutesPerDay: integer('class_minutes_per_day'),
    classDaysPerWeek: integer('class_days_per_week'),
    classStartTime: text('class_start_time'), // 'HH:MM'
    courseHours: integer('course_hours'), // the whole course, in hours
    expectedEndDate: date('expected_end_date'),
    totalFee: integer('total_fee').notNull().default(0), // paise
    feePlan: jsonb('fee_plan').$type<FeePlan>(), // paid in full or in installments, and on what schedule (the installments table has the dates)
    listFee: integer('list_fee'), // paise: the course's fee with GST before any offer; the discount given = listFee - totalFee
    courseFee: integer('course_fee'), // paise, before GST; with gstAmount it adds up to totalFee (both NULL on older records)
    gstAmount: integer('gst_amount'), // paise
    projectCertificate: boolean('project_certificate').notNull().default(false),
    // internship letters the student needs, and from which template (null = Standard); set up in Internship Requests
    internshipOffer: boolean('internship_offer').notNull().default(false),
    internshipCompletion: boolean('internship_completion').notNull().default(false),
    offerTemplateId: uuid('offer_template_id').references(() => letterTemplates.id, { onDelete: 'set null' }),
    completionTemplateId: uuid('completion_template_id').references(() => letterTemplates.id, { onDelete: 'set null' }), // a project certificate is given with the course certificate
    letterCompanyId: uuid('letter_company_id').references(() => letterCompanies.id), // the company the letters come from; null: techcadd
    status: registrationStatusEnum('status').notNull().default('active'),
    // carried over from the branch a transferred student came from: classes held / attended there, capstone approved there
    priorSessions: integer('prior_sessions').notNull().default(0),
    priorPresent: integer('prior_present').notNull().default(0),
    priorCapstoneOk: boolean('prior_capstone_ok').notNull().default(false),
    legacyRegNo: text('legacy_reg_no'), // ID from the old records (Excel/paper), kept as-is on import (insti.md §11)
    legacyData: jsonb('legacy_data'), // the student's whole row from the old system, as it was (no password)
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }), // in the Recycle Bin (hidden by the database, policy not_deleted)
    deletedBy: uuid('deleted_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('registrations_reg_no_uq').on(t.orgId, t.regNo),
    unique('registrations_enquiry_uq').on(t.enquiryId), // one enquiry converts once
    unique('registrations_legacy_uq').on(t.branchId, t.legacyRegNo), // re-running an import never duplicates
    index('registrations_branch_status_idx').on(t.branchId, t.status),
    index('registrations_person_idx').on(t.personId),
    index('registrations_created_idx').on(t.branchId, t.createdAt.desc()),
    index('registrations_course_idx').on(t.courseId)],
)

// Append-only history: covers the "Registration update" screen.
export const registrationEvents = pgTable(
  'registration_events',
  {
    orgId: orgId(),
    id: id(),
    registrationId: uuid('registration_id').notNull().references(() => registrations.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    byUser: uuid('by_user').references(() => users.id),
    fromStatus: registrationStatusEnum('from_status'),
    toStatus: registrationStatusEnum('to_status').notNull(),
    note: text('note'),
  },
  (t) => [index('registration_events_reg_idx').on(t.registrationId, t.at)],
)

/** The modules of a customized course. feeMode 'modules' = each module has its fee and the course fee is their sum; 'total' = one fee for the whole course. Fees in paise. */
export type CustomCourse = { durationWeeks: number | null; feeMode: 'modules' | 'total'; modules: { name: string; fee: number | null }[] }

export type RegistrationStatus = (typeof registrationStatusEnum.enumValues)[number]
