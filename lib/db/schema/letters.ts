import { sql } from 'drizzle-orm'
import { boolean, customType, date, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { branches, users } from './core'
import { registrations } from './registrations'
import { orgId } from './tenancy'

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' })

// The companies internship letters are issued for (the institute itself, the main one, and others it places interns with), each with its own
// name, contact, letterhead (a full A4 page image) and stamp / signature. Head office keeps them in Letter Templates.
export const letterCompanies = pgTable('letter_companies', {
  orgId: orgId(),
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(), // as the letters write it in a sentence, e.g. "Syntax Developer"
  legalName: text('legal_name').notNull(), // {{company}}, e.g. "Acme Learning Pvt. Ltd."
  contactPhone: text('contact_phone'),
  contactEmail: text('contact_email'),
  letterheadMime: text('letterhead_mime'),
  letterhead: bytea('letterhead'), // none: a plain one with the name
  stampMime: text('stamp_mime'),
  stamp: bytea('stamp'), // none: no stamp
  isDefault: boolean('is_default').notNull().default(false), // the institute itself: what an intern or template without a company belongs to
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
},
  (t) => [uniqueIndex('letter_companies_name_uq').on(t.orgId, sql`lower(name)`), uniqueIndex('letter_companies_default_uq').on(t.orgId, t.isDefault).where(sql`is_default`)])

// Head office's own wording for a letter; without a row the standard template (lib/letters/standard.ts) is used.
// Several per letter and company, by name (e.g. "Web Development Intern"); a row named "Standard" is that company's
// edited Standard.
export const letterTemplates = pgTable('letter_templates', {
  orgId: orgId(),
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => letterCompanies.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // internship_offer | internship_completion
  name: text('name').notNull().default('Standard'),
  body: text('body').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
},
  (t) => [uniqueIndex('letter_templates_company_kind_name_uq').on(t.companyId, t.kind, sql`lower(name)`)])

// An intern and their two letters: the selection letter, then the completion certificate.
// status: offer_requested -> offer_issued -> completion_requested -> completed (or cancelled)
export const internships = pgTable('internships', {
  orgId: orgId(),
  id: uuid('id').primaryKey().defaultRandom(),
  branchId: uuid('branch_id').notNull().references(() => branches.id),
  refNo: text('ref_no').notNull(),
  companyId: uuid('company_id').notNull().references(() => letterCompanies.id), // the company that takes the intern on
  registrationId: uuid('registration_id').references(() => registrations.id),
  name: text('name').notNull(),
  gender: text('gender'), // male | female | other: picks he / she / they in the letters
  phone: text('phone'),
  email: text('email'),
  address: text('address'),
  designation: text('designation').notNull(),
  domain: text('domain'),
  trainingFrom: date('training_from'),
  trainingTo: date('training_to'),
  trainingLocation: text('training_location'),
  fromDate: date('from_date').notNull(),
  toDate: date('to_date').notNull(),
  stipend: integer('stipend'), // paise a month
  workLocation: text('work_location'),
  workingHours: text('working_hours'),
  workMode: text('work_mode'),
  responsibilities: text('responsibilities'),
  skills: text('skills'),
  project: text('project'),
  status: text('status').notNull().default('offer_requested'),
  wantsOffer: boolean('wants_offer').notNull().default(true), // false: only the completion certificate is needed
  offerTemplateId: uuid('offer_template_id').references(() => letterTemplates.id, { onDelete: 'set null' }), // null = Standard
  completionTemplateId: uuid('completion_template_id').references(() => letterTemplates.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  offerIssuedBy: uuid('offer_issued_by').references(() => users.id),
  offerIssuedAt: timestamp('offer_issued_at', { withTimezone: true }),
  offerText: text('offer_text'), // the letter as issued (frozen)
  completionRequestedBy: uuid('completion_requested_by').references(() => users.id),
  completionRequestedAt: timestamp('completion_requested_at', { withTimezone: true }),
  completedBy: uuid('completed_by').references(() => users.id),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  completionText: text('completion_text'), // the certificate as issued (frozen)
  cancelReason: text('cancel_reason'),
},
  (t) => [index('internships_branch_idx').on(t.branchId, t.status, t.toDate), uniqueIndex('internships_ref_uq').on(t.orgId, t.refNo), uniqueIndex('internships_registration_uq').on(t.registrationId).where(sql`registration_id IS NOT NULL AND status <> 'cancelled'`)])

// The authorised signatory's signature for the certificates (key 'authorised'), uploaded by head office in Settings.
export const signatureImages = pgTable('signature_images', {
  orgId: orgId(),
  key: text('key').notNull(),
  signerName: text('signer_name'),
  signerTitle: text('signer_title'),
  mime: text('mime').notNull(), // image/png | image/jpeg
  data: bytea('data').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.orgId, t.key] })])
