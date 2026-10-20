import { sql } from 'drizzle-orm'
import { customType, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { branches, users } from './core'
import { registrations } from './registrations'
import { payments } from './fees'
import { orgId } from './tenancy'

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' })

// Files attached to a registration (photo, ID proof, marksheets...). Stored in the database on purpose:
// the app container's disk is rebuilt on every deploy, and this way the daily DB backup covers them too.
export const registrationDocuments = pgTable(
  'registration_documents',
  {
    orgId: orgId(),
    id: uuid('id').primaryKey().defaultRandom(),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    registrationId: uuid('registration_id').notNull().references(() => registrations.id),
    kind: text('kind').notNull(), // photo | id_proof | marksheet | payment_proof | other
    paymentId: uuid('payment_id').references(() => payments.id), // payment_proof only: the payment it proves
    fileName: text('file_name').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    data: bytea('data').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('registration_documents_reg_idx').on(t.registrationId, t.uploadedAt), index('registration_documents_payment_idx').on(t.paymentId).where(sql`payment_id IS NOT NULL`)],
)
