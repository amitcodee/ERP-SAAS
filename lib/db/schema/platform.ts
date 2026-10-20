import { sql } from 'drizzle-orm'
import { bigserial, boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { branches, users } from './core'
import { orgId } from './tenancy'

// ---- settings and message wording

/** Settings saved in the panel, per area (key); secrets are stored encrypted, apart from the plain config. */
export const appConfig = pgTable('app_config', {
  orgId: orgId(),
  key: text('key').notNull(),
  config: jsonb('config').notNull().default({}),
  secrets: text('secrets'),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.orgId, t.key] })])

// Message wording: head office's (branch null) and a branch's own version of each; announcements may be many.
export const messageTemplates = pgTable(
  'message_templates',
  {
    orgId: orgId(),
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    branchId: uuid('branch_id').references(() => branches.id),
    title: text('title'),
    subject: text('subject'),
    body: text('body').notNull(),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('message_templates_branch_idx').on(t.branchId, t.key),
    uniqueIndex('message_templates_one_uq').on(t.orgId, t.key, sql`coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)`).where(sql`key <> 'announcement'`),
  ],
)

// ---- sign-in security

/** Every sign-in attempt (the sign-in log); result: ok | wrong_password | unknown_email | locked | blocked ... */
export const loginAttempts = pgTable(
  'login_attempts',
  {
    orgId: orgId(),
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    email: text('email'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    ip: text('ip'),
    userAgent: text('user_agent'),
    result: text('result').notNull(),
  },
  (t) => [index('login_attempts_at_idx').on(t.at.desc()), index('login_attempts_email_idx').on(t.email, t.at.desc()), index('login_attempts_ip_idx').on(t.ip, t.at.desc()), index('login_attempts_user_idx').on(t.userId)],
)

/** Wrong-password lockout ladder per e-mail / IP (key): failures in a row, level reached, locked until when. */
export const loginLocks = pgTable('login_locks', {
  orgId: orgId(),
  key: text('key').notNull(),
  failures: integer('failures').notNull().default(0),
  level: integer('level').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lastFailedAt: timestamp('last_failed_at', { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.orgId, t.key] })])

/** Sign-ins ended with "Sign out": the session id, until its cookie would have expired anyway. */
export const revokedSessions = pgTable('revoked_sessions', {
  orgId: orgId(),
  sid: text('sid').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => [index('revoked_sessions_expires_idx').on(t.expiresAt)])

/** IPs blocked (by hand, or automatically after the ladder) or always allowed. */
export const ipRules = pgTable(
  'ip_rules',
  {
    orgId: orgId(),
    ip: text('ip').notNull(),
    kind: text('kind').notNull(), // block | allow
    reason: text('reason'),
    auto: boolean('auto').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.ip] }), check('ip_rules_kind_ck', sql`kind IN ('block', 'allow')`)],
)

/** Where an IP is (for the sign-in log), looked up once and kept. */
export const ipGeo = pgTable('ip_geo', {
  ip: text('ip').primaryKey(),
  country: text('country'),
  region: text('region'),
  city: text('city'),
  isp: text('isp'),
  lookedUpAt: timestamp('looked_up_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---- integrations

/** API keys for other systems: only the hash is kept; scopes limit what a key may do, branch (if set) where. */
export const apiKeys = pgTable(
  'api_keys',
  {
    orgId: orgId(),
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(), // the first characters, to recognise a key in the list
    keyHash: text('key_hash').notNull(),
    scopes: text('scopes').array().notNull(),
    branchId: uuid('branch_id').references(() => branches.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastUsedIp: text('last_used_ip'),
    useCount: integer('use_count').notNull().default(0),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('api_keys_key_hash_key').on(t.keyHash)],
)

/** Webhooks: events posted (signed with the secret) to another system's URL. */
export const webhooks = pgTable('webhooks', {
  orgId: orgId(),
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  secret: text('secret').notNull(),
  events: text('events').array().notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastStatus: integer('last_status'),
  lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true }),
  lastError: text('last_error'),
})

/** Each event to send, retried until sent or given up (pending -> sent | failed). */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    orgId: orgId(),
    id: uuid('id').primaryKey().defaultRandom(),
    webhookId: uuid('webhook_id').notNull().references(() => webhooks.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [
    index('webhook_deliveries_due').on(t.status, t.nextAttemptAt),
    index('webhook_deliveries_hook').on(t.webhookId, t.createdAt.desc()),
    check('webhook_deliveries_status_check', sql`status IN ('pending', 'sent', 'failed')`),
  ],
)
