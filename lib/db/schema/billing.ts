import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { organisations, plans } from './tenancy'

// Billing (migration 0105, modules/billing): what each institute pays the platform. Platform tables: the platform
// writes them; an institute reads its own subscription, payments and invoices.

/** The institute's paid period: one row per institute, moved on by each payment. */
export const subscriptions = pgTable(
  'subscriptions',
  {
    orgId: uuid('org_id').primaryKey().references(() => organisations.id),
    planKey: text('plan_key').notNull().references(() => plans.key, { onUpdate: 'cascade' }),
    interval: text('interval').$type<'month' | 'year'>().notNull(),
    status: text('status').$type<'active' | 'cancelled'>().notNull().default('active'),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).notNull(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check('subscriptions_interval_ck', sql`interval IN ('month', 'year')`),
    check('subscriptions_status_ck', sql`status IN ('active', 'cancelled')`),
    check('subscriptions_period_ck', sql`current_period_end > current_period_start`),
  ],
)

export const coupons = pgTable(
  'coupons',
  {
    code: text('code').primaryKey(),
    percentOff: integer('percent_off'),
    amountOff: integer('amount_off'), // paise
    plans: text('plans').array().notNull().default(sql`'{}'`), // empty: every plan
    validUntil: timestamp('valid_until', { withTimezone: true }),
    maxRedemptions: integer('max_redemptions'),
    redeemed: integer('redeemed').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check('coupons_code_ck', sql`code = upper(code) AND code ~ '^[A-Z0-9-]{3,30}$'`),
    check('coupons_off_ck', sql`(percent_off IS NULL) <> (amount_off IS NULL) AND coalesce(percent_off, 1) BETWEEN 1 AND 100 AND coalesce(amount_off, 1) > 0`),
  ],
)

/** One attempt to pay (paise): made at checkout, paid when the provider confirms it. */
export const platformPayments = pgTable(
  'platform_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organisations.id),
    planKey: text('plan_key').notNull().references(() => plans.key, { onUpdate: 'cascade' }),
    interval: text('interval').$type<'month' | 'year'>().notNull(),
    coupon: text('coupon').references(() => coupons.code),
    amount: integer('amount').notNull(),
    discount: integer('discount').notNull().default(0),
    gst: integer('gst').notNull(),
    total: integer('total').notNull(),
    provider: text('provider').notNull(),
    providerRef: text('provider_ref'),
    providerPaymentId: text('provider_payment_id'),
    status: text('status').$type<'created' | 'paid' | 'failed' | 'expired'>().notNull().default('created'),
    invoiceId: uuid('invoice_id').references((): AnyPgColumn => platformInvoices.id),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('platform_payments_provider_payment_uq').on(t.provider, t.providerPaymentId).where(sql`provider_payment_id IS NOT NULL`),
    index('platform_payments_org_idx').on(t.orgId, t.createdAt),
    check('platform_payments_status_ck', sql`status IN ('created', 'paid', 'failed', 'expired')`),
    check('platform_payments_money_ck', sql`amount >= 0 AND discount >= 0 AND gst >= 0 AND total = amount - discount + gst`),
  ],
)

/** The platform's GST tax invoices, numbered without gaps per financial year. Never changed once issued. */
export const platformInvoices = pgTable(
  'platform_invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organisations.id),
    number: text('number').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    description: text('description').notNull(),
    amount: integer('amount').notNull(),
    discount: integer('discount').notNull().default(0),
    cgst: integer('cgst').notNull().default(0),
    sgst: integer('sgst').notNull().default(0),
    igst: integer('igst').notNull().default(0),
    total: integer('total').notNull(),
    billedTo: jsonb('billed_to').$type<{ name: string; gstin: string | null; address: string | null; email: string | null }>().notNull(),
    seller: jsonb('seller').$type<{ name: string; gstin: string | null; address: string | null; state: string | null }>().notNull(),
    paymentId: uuid('payment_id').notNull().references(() => platformPayments.id),
  },
  (t) => [
    uniqueIndex('platform_invoices_number_uq').on(t.number),
    uniqueIndex('platform_invoices_payment_uq').on(t.paymentId),
    index('platform_invoices_org_idx').on(t.orgId, t.issuedAt),
    check('platform_invoices_money_ck', sql`total = amount - discount + cgst + sgst + igst`),
  ],
)

export const platformCounters = pgTable('platform_counters', {
  key: text('key').primaryKey(),
  value: integer('value').notNull().default(0),
})

/** Each provider event handled once (webhooks are retried). */
export const billingEvents = pgTable(
  'billing_events',
  {
    provider: text('provider').notNull(),
    eventId: text('event_id').notNull(),
    type: text('type').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb('payload').notNull(),
  },
  (t) => [primaryKey({ name: 'billing_events_pk', columns: [t.provider, t.eventId] })],
)
