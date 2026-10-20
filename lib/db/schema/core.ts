import { sql } from 'drizzle-orm'
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  type AnyPgColumn,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { orgId, platformUsers, supportSessions } from './tenancy'

/** Binary data (signature images), stored in the database so a redeploy cannot lose it. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' })

export const lookupKindEnum = pgEnum('lookup_kind', [
  'enquiry_source',
  'qualification',
  'payment_mode',
  'class_mode',
  'occupation_type',
  'not_joined_reason',
  'disposition',
])

const id = () => uuid('id').primaryKey().defaultRandom()
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const deletedAt = () => timestamp('deleted_at', { withTimezone: true })

// ---- Branches -------------------------------------------------------------
export const branches = pgTable(
  'branches',
  {
    orgId: orgId(),
    id: id(),
    code: text('code').notNull(), // e.g. LDH — generated from the city, used in every generated number
    name: text('name').notNull(),
    city: text('city'),
    state: text('state'),
    pincode: text('pincode'),
    email: text('email'), // the branch's own address: its admin login is created for it and login details are mailed to it
    certCode: text('cert_code'), // printed in certificate numbers, e.g. CERT-<certCode>-2026-0001
    regFormat: text('reg_format'), // registration number format, e.g. TCD/4002/{n}; null = REG-{yyyy}-{code}-{nnnn} (lib/numbering.ts)
    status: text('status').notNull().default('setup'), // setup -> active: nobody of the branch can sign in until it is activated
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    gstin: text('gstin'),
    address: text('address'),
    phone: text('phone'),
    websiteUrl: text('website_url'), // the branch's own website (e.g. a techcadd-<city> site): its form leads come to this branch
    websiteHost: text('website_host'), // websiteUrl's host without www., which is what incoming leads are matched on
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('branches_code_uq').on(t.orgId, t.code), uniqueIndex('branches_cert_code_uq').on(t.orgId, t.certCode), uniqueIndex('branches_website_host_uq').on(t.orgId, t.websiteHost).where(sql`website_host IS NOT NULL`)],
)

// ---- Users ----------------------------------------------------------------
export const users = pgTable(
  'users',
  {
    orgId: orgId(),
    id: id(),
    branchId: uuid('branch_id').references(() => branches.id), // NULL only for super_admin
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    passwordHash: text('password_hash').notNull(),
    mustChangePassword: boolean('must_change_password').notNull().default(false), // forced on first login and after an admin reset
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }).notNull().defaultNow(), // sessions issued before this are void
    twoFactorEmail: boolean('two_factor_email').notNull().default(false), // sign-in also asks for a code e-mailed to the person
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }), // null = never signed in (activation mails them their login)
    branchMade: boolean('branch_made').notNull().default(false), // made by branch staff: the branch may change it; otherwise head office's
    createdAt: createdAt(),
    deletedAt: deletedAt(),
    deletedBy: uuid('deleted_by').references((): AnyPgColumn => users.id),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.orgId, t.email), index('users_branch_idx').on(t.branchId)],
)

// Roles are data: a super admin creates roles and edits their permissions (lib/auth/permissions.ts has the catalog
// and the defaults). kind: super = everything everywhere; student = portal only; staff = listed permissions in their branch.
export const roles = pgTable('roles', {
  orgId: orgId(),
  key: text('key').notNull(), // e.g. counselor, telecaller, or a custom key; unique inside the org
  name: text('name').notNull(),
  description: text('description'),
  kind: text('kind').notNull().default('staff'), // super | staff | student
  locked: boolean('locked').notNull().default(false), // super_admin and student cannot be edited
  permissions: text('permissions').array().notNull().default([]), // "resource:action"
  isSystem: boolean('is_system').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.orgId, t.key] })])

// A person can hold several roles (e.g. counselor + telecaller + branch head); permissions are the union.
export const userRoles = pgTable(
  'user_roles',
  {
    orgId: orgId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull(), // (org_id, role) -> roles (org_id, key): user_roles_role_orgfk in SQL
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
)

// The OTHER branches a staff member also serves (users.branchId is their home branch). Head office decides.
export const userBranches = pgTable(
  'user_branches',
  {
    orgId: orgId(),
    userId: uuid('user_id').notNull().references(() => users.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    access: text('access').notNull().default('own'), // own: only their own work in this branch; full: as their role allows
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.branchId] }), index('user_branches_branch_idx').on(t.branchId)],
)

// ---- Catalogs (SSOT for every dropdown) -----------------------------------
export const departments = pgTable(
  'departments',
  {
    orgId: orgId(),
    id: id(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    // As a course category: a remark, its head (the instructor whose signature goes on certificates), and approval:
    // head office adds approved ones; a branch admin asks for one (pending) and head office approves it.
    remark: text('remark'),
    headName: text('head_name'),
    headSignature: bytea('head_signature'),
    headSignatureMime: text('head_signature_mime'), // image/png | image/jpeg
    status: text('status').notNull().default('approved'), // approved | pending | rejected
    requestedBy: uuid('requested_by').references(() => users.id),
    requestedBranchId: uuid('requested_branch_id').references(() => branches.id),
    requestedAt: timestamp('requested_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
  },
  (t) => [uniqueIndex('departments_name_uq').on(t.orgId, t.name)],
)

export const courses = pgTable(
  'courses',
  {
    orgId: orgId(),
    id: id(),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id),
    title: text('title').notNull(),
    baseFee: integer('base_fee').notNull().default(0), // paise
    durationWeeks: integer('duration_weeks'),
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: deletedAt(), // in the Recycle Bin (hidden from the course lists)
    deletedBy: uuid('deleted_by').references(() => users.id),
    skills: text('skills'), // tools / skills taught, for {{skills}} in internship letters
    // head office adds approved courses; a branch admin adds one (pending) and head office approves it
    status: text('status').notNull().default('approved'), // approved | pending | rejected
    requestedBy: uuid('requested_by').references(() => users.id),
    requestedBranchId: uuid('requested_branch_id').references(() => branches.id),
    requestedAt: timestamp('requested_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
  },
  (t) => [uniqueIndex('courses_dept_title_uq').on(t.departmentId, t.title)],
)

export const lookups = pgTable(
  'lookups',
  {
    orgId: orgId(),
    id: id(),
    kind: lookupKindEnum('kind').notNull(),
    value: text('value').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('lookups_kind_value_uq').on(t.orgId, t.kind, t.value)],
)

// Lead categories: head office keeps this list (Settings); set on random calls, leads and visited enquiries.
// Names are unique ignoring case (index lead_categories_name_uq in migration 0037).
export const leadCategories = pgTable('lead_categories', {
  orgId: orgId(),
  id: id(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
},
  (t) => [uniqueIndex('lead_categories_name_uq').on(t.orgId, sql`lower(name)`)])

// ---- Rules as config (global default when branch_id IS NULL) --------------
export const settings = pgTable(
  'settings',
  {
    orgId: orgId(),
    id: id(),
    branchId: uuid('branch_id').references(() => branches.id),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
  },
  (t) => [unique('settings_scope_key_uq').on(t.orgId, t.branchId, t.key).nullsNotDistinct()],
)

// ---- Numbering + audit ----------------------------------------------------
export const numberSequences = pgTable(
  'number_sequences',
  {
    orgId: orgId(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    kind: text('kind').notNull(), // ENQ | REG | RCP | CERT
    period: text('period').notNull(), // '2026' or FY '2026-27'
    lastValue: integer('last_value').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.branchId, t.kind, t.period] })],
)

export const auditLogs = pgTable(
  'audit_logs',
  {
    orgId: orgId(),
    id: id(),
    userId: uuid('user_id').references(() => users.id),
    branchId: uuid('branch_id').references(() => branches.id),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    impersonatorId: uuid('impersonator_id').references(() => platformUsers.id), // a platform admin working in the org (support session)
    supportSessionId: uuid('support_session_id').references(() => supportSessions.id),
  },
  (t) => [index('audit_entity_idx').on(t.entity, t.entityId), index('audit_branch_at_idx').on(t.branchId, t.at), index('audit_logs_user_idx').on(t.userId)],
)

export type Role = string // a roles.key
