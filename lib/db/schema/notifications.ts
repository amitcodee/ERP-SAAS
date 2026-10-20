import { sql } from 'drizzle-orm'
import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { branches, users } from './core'
import type { WaAudience, WaCampaignParam } from '@/lib/notify/whatsapp'
import { persons } from './admissions'
import { registrations } from './registrations'
import { orgId } from './tenancy'

export const channelEnum = pgEnum('notification_channel', ['whatsapp', 'sms', 'email'])
export const notificationStatusEnum = pgEnum('notification_status', ['queued', 'sent', 'failed', 'skipped'])

// Outbox: every message is written here first (with a dedupe key), then delivered by a provider adapter.
export const notifications = pgTable(
  'notifications',
  {
    orgId: orgId(),
    id: uuid('id').primaryKey().defaultRandom(),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    personId: uuid('person_id').references(() => persons.id),
    registrationId: uuid('registration_id').references(() => registrations.id),
    channel: channelEnum('channel').notNull(),
    template: text('template').notNull(), // e.g. fee_due_soon, fee_overdue
    toAddress: text('to_address').notNull(),
    body: text('body').notNull(),
    subject: text('subject'), // its own subject (e-mail), when it has one; otherwise the template's usual one
    html: text('html'), // its own HTML body, when it has one (e.g. a birthday wish); otherwise made from the text
    params: jsonb('params').$type<string[]>(), // WhatsApp: the template's parameters, in order (lib/notify/whatsapp.ts)
    campaign: text('campaign'), // Bulk WhatsApp: the AiSensy API campaign it goes out through (event messages: lib/notify/whatsapp.ts)
    media: jsonb('media').$type<{ url: string; filename: string }>(), // Bulk WhatsApp: the campaign's image / document / video
    broadcastId: uuid('broadcast_id').references((): AnyPgColumn => waBroadcasts.id),
    dedupeKey: text('dedupe_key').notNull().unique(), // "fee:<installmentId>:<stage>:<channel>" - same event never queues twice
    status: notificationStatusEnum('status').notNull().default('queued'),
    providerRef: text('provider_ref'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [index('notifications_status_idx').on(t.status, t.createdAt), index('notifications_branch_idx').on(t.branchId, t.createdAt), index('notifications_registration_idx').on(t.registrationId), index('notifications_person_idx').on(t.personId), index('notifications_broadcast_idx').on(t.broadcastId)],
)

// Bulk WhatsApp. A campaign is made in AiSensy (Campaigns → API, on an approved template) and listed here by head office
// (Settings → WhatsApp campaigns) with what fills its {{1}}, {{2}}…; the Bulk WhatsApp page sends it to students or
// leads. Each send is a broadcast; its messages go through the outbox (notifications.broadcast_id).
export const waCampaigns = pgTable(
  'wa_campaigns',
  {
    orgId: orgId(),
    id: uuid('id').primaryKey().defaultRandom(),
    label: text('label').notNull(), // what staff see, e.g. "Diwali offer"
    campaign: text('campaign').notNull(), // the AiSensy API campaign's name, exactly
    params: jsonb('params').$type<WaCampaignParam[]>().notNull().default([]),
    body: text('body'), // the template's words with {{1}}… (for the preview and the outbox log), as approved
    mediaUrl: text('media_url'), // a template with an image / document / video header: its public link
    mediaName: text('media_name'),
    audience: text('audience').$type<WaAudience>().notNull().default('any'),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('wa_campaigns_campaign_uq').on(t.orgId, sql`lower(campaign)`)],
)

export const waBroadcasts = pgTable(
  'wa_broadcasts',
  {
    orgId: orgId(),
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id').notNull().references(() => waCampaigns.id),
    branchId: uuid('branch_id').references(() => branches.id), // the branch it was sent in; null = head office, every branch
    audience: jsonb('audience').$type<Record<string, unknown>>().notNull(), // the filter, as chosen
    summary: text('summary').notNull(), // the filter in words
    texts: jsonb('texts').$type<string[]>().notNull().default([]), // what was typed for the `text` parameters
    total: integer('total').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('wa_broadcasts_branch_idx').on(t.branchId, t.createdAt)],
)
