import { sql } from 'drizzle-orm'
import { boolean, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { branches, courses, departments, leadCategories, lookups, users } from './core'
import { orgId } from './tenancy'

const id = () => uuid('id').primaryKey().defaultRandom()
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

// One human = one row (P2). Enquiry and registration both point here.
export const persons = pgTable(
  'persons',
  {
    orgId: orgId(),
    id: id(),
    branchId: uuid('branch_id').notNull().references(() => branches.id), // home branch
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    fatherName: text('father_name'),
    motherName: text('mother_name'),
    gender: text('gender'), // male | female | other
    dob: date('dob'),
    phone: text('phone').notNull(),
    phoneNorm: text('phone_norm').notNull(), // last 10 digits — dedup key
    altPhone: text('alt_phone'),
    guardianPhone: text('guardian_phone'),
    email: text('email'),
    address: text('address'),
    aadhaarNo: text('aadhaar_no'), // sealed (modules/people/aadhaar-store): never read or written directly
    aadhaarLast4: text('aadhaar_last4'), // last 4 digits, for display
    createdAt: createdAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    userId: uuid('user_id').references(() => users.id).unique(), // student portal login, if any
  },
  (t) => [unique('persons_branch_phone_uq').on(t.branchId, t.phoneNorm), index('persons_email_lower_idx').on(sql`lower(email)`).where(sql`email IS NOT NULL`), index('persons_phone_norm_idx').on(t.phoneNorm), index('persons_dob_idx').on(t.dob).where(sql`dob IS NOT NULL`)],
)

// Latest row per person is the current occupation snapshot.
export const personOccupations = pgTable(
  'person_occupations',
  {
    orgId: orgId(),
    id: id(),
    personId: uuid('person_id').notNull().references(() => persons.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    typeId: uuid('type_id').notNull().references(() => lookups.id), // lookups.kind = occupation_type
    schoolOrCollege: text('school_or_college'),
    qualification: text('qualification'),
    semester: text('semester'),
    jobRole: text('job_role'),
    company: text('company'),
    skills: text('skills'),
    country: text('country'),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('person_occ_person_idx').on(t.personId, t.validFrom)],
)

export const enquiryStatusEnum = pgEnum('enquiry_status', [
  'new', 'contacted', 'follow_up', 'demo', 'joined', 'not_joined', 'dead',
])

export const calls = pgTable(
  'calls',
  {
    orgId: orgId(),
    id: id(),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    personId: uuid('person_id').references(() => persons.id),
    calledAt: timestamp('called_at', { withTimezone: true }).notNull().defaultNow(),
    receivedBy: uuid('received_by').references(() => users.id),
    proposedFee: integer('proposed_fee'), // paise
    departmentId: uuid('department_id').references(() => departments.id),
    courseId: uuid('course_id').references(() => courses.id),
    status: text('status'),
    remarks: text('remarks'),
    followUpDate: date('follow_up_date'), // NEXT follow-up
    enquiryId: uuid('enquiry_id'), // set when the call is promoted to an enquiry
    // Lead details: always the latest state (each follow-up call is also kept in call_followups)
    callRemark: text('call_remark'), // what the caller said (remarks = the staff member's own note)
    interested: boolean('interested'),
    interestPct: integer('interest_pct'),
    expectedVisitDate: date('expected_visit_date'), // status "Will visit"
    deadReason: text('dead_reason'), // status "Dead lead"
    categoryId: uuid('category_id').references(() => leadCategories.id), // lead category
    assignedTo: uuid('assigned_to').references(() => users.id), // lead distribution: who follows this call up (may be in another branch)
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }), // deleted calls are hidden by the database (policy not_deleted)
    deletedBy: uuid('deleted_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('calls_branch_at_idx').on(t.branchId, t.calledAt), index('calls_assigned_idx').on(t.assignedTo), index('calls_person_idx').on(t.personId)],
)

// Every follow-up call made on a random call (history; the call row holds the latest state).
export const callFollowups = pgTable(
  'call_followups',
  {
    orgId: orgId(),
    id: id(),
    callId: uuid('call_id').notNull().references(() => calls.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    calledAt: timestamp('called_at', { withTimezone: true }).notNull().defaultNow(),
    byUser: uuid('by_user').references(() => users.id),
    status: text('status'),
    callRemark: text('call_remark'),
    remarks: text('remarks'),
    interested: boolean('interested'),
    interestPct: integer('interest_pct'),
    nextFollowUp: date('next_follow_up'),
    expectedVisitDate: date('expected_visit_date'),
    deadReason: text('dead_reason'),
    createdAt: createdAt(),
  },
  (t) => [index('call_followups_call_idx').on(t.callId, t.calledAt)],
)

export const enquiries = pgTable(
  'enquiries',
  {
    orgId: orgId(),
    id: id(),
    enquiryNo: text('enquiry_no').notNull(),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    personId: uuid('person_id').notNull().references(() => persons.id),
    sourceId: uuid('source_id').references(() => lookups.id),
    departmentId: uuid('department_id').references(() => departments.id),
    courseId: uuid('course_id').references(() => courses.id),
    classModeId: uuid('class_mode_id').references(() => lookups.id),
    courseFee: integer('course_fee'), // paise: the course's actual (full) fee quoted
    proposedFee: integer('proposed_fee'), // paise: the discounted / proposed fee offered
    actualFee: integer('actual_fee'), // paise: the fee agreed at registration
    demoBy: uuid('demo_by').references(() => users.id),
    assignedTo: uuid('assigned_to').references(() => users.id),
    assignedAt: timestamp('assigned_at', { withTimezone: true }), // when a lead was last handed to someone (lead distribution)
    expectedJoinDate: date('expected_join_date'),
    status: enquiryStatusEnum('status').notNull().default('new'),
    notJoinedReasonId: uuid('not_joined_reason_id').references(() => lookups.id),
    nextFollowUp: date('next_follow_up'),
    finalRemarks: text('final_remarks'),
    // Lead details (set when the lead is added, updated after each call)
    interested: boolean('interested'), // null = not asked yet
    interestPct: integer('interest_pct'), // 0-100, only when interested
    visited: boolean('visited').notNull().default(false), // the person came to the branch (a call becomes an enquiry at the visit)
    visitedAt: timestamp('visited_at', { withTimezone: true }),
    callDone: boolean('call_done').notNull().default(false),
    callAt: timestamp('call_at', { withTimezone: true }), // when the call was made (date + time)
    callRemark: text('call_remark'),
    location: text('location'), // where the person is (area / city)
    interestedBranchId: uuid('interested_branch_id').references(() => branches.id), // the branch they want to join
    categoryId: uuid('category_id').references(() => leadCategories.id), // lead category
    deletedAt: timestamp('deleted_at', { withTimezone: true }), // deleted leads are hidden by the database (policy not_deleted)
    deletedBy: uuid('deleted_by').references(() => users.id),
    legacyRef: text('legacy_ref'), // key from the old records, set only by the importer (insti.md §11)
    sourceUrl: text('source_url'), // a website lead: the page its form was sent from
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('enquiries_no_uq').on(t.orgId, t.enquiryNo),
    unique('enquiries_legacy_uq').on(t.branchId, t.legacyRef),
    index('enquiries_branch_status_idx').on(t.branchId, t.status),
    index('enquiries_person_idx').on(t.personId),
    index('enquiries_assigned_idx').on(t.assignedTo, t.status),
    index('enquiries_created_idx').on(t.branchId, t.createdAt.desc()),
    index('enquiries_course_idx').on(t.courseId)],
)

// Append-only history (P5): covers Followups and the "Enquiry update" screen.
export const enquiryEvents = pgTable(
  'enquiry_events',
  {
    orgId: orgId(),
    id: id(),
    enquiryId: uuid('enquiry_id').notNull().references(() => enquiries.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    byUser: uuid('by_user').references(() => users.id),
    fromStatus: enquiryStatusEnum('from_status'),
    toStatus: enquiryStatusEnum('to_status').notNull(),
    followUpDate: date('follow_up_date'),
    note: text('note'),
  },
  (t) => [index('enquiry_events_enq_idx').on(t.enquiryId, t.at)],
)

export type EnquiryStatus = (typeof enquiryStatusEnum.enumValues)[number]

// Website leads (migration 0048). Each form sent on a website arrives here first. When the site belongs to a branch
// (branches.website_host) or the lead's place names one branch, it is placed there at once as a Lead (enquiry_id);
// otherwise it waits, shown by website, until head office sends it to a branch. Branches see only their own (RLS).
export const webLeads = pgTable('web_leads', {
  orgId: orgId(),
  id: id(),
  siteHost: text('site_host').notNull(), // e.g. techcaddludhiana.com (no www.)
  sourceUrl: text('source_url'), // the page the form was on
  externalId: text('external_id'), // the website's own id for the lead: sending it twice does not add it twice
  name: text('name').notNull(),
  phone: text('phone'),
  phoneNorm: text('phone_norm'),
  email: text('email'),
  course: text('course'),
  location: text('location'),
  message: text('message'),
  payload: jsonb('payload'), // everything the website sent, as sent
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  branchId: uuid('branch_id').references(() => branches.id),
  matchedBy: text('matched_by'), // website | location | manual
  enquiryId: uuid('enquiry_id').references(() => enquiries.id),
  problem: text('problem'), // why it could not become a lead (e.g. no valid phone number)
  placedBy: uuid('placed_by').references(() => users.id),
  placedAt: timestamp('placed_at', { withTimezone: true }),
  createdAt: createdAt(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }), // in the Recycle Bin (hidden by the database)
  deletedBy: uuid('deleted_by').references(() => users.id),
}, (t) => [index('web_leads_branch_idx').on(t.branchId, t.submittedAt), index('web_leads_site_idx').on(t.siteHost, t.submittedAt), uniqueIndex('web_leads_site_ext_uq').on(t.orgId, t.siteHost, t.externalId).where(sql`external_id IS NOT NULL`), index('web_leads_enquiry_idx').on(t.enquiryId)])
