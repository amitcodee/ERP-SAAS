import { sql } from 'drizzle-orm'
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import type { Design } from '@/lib/cert-design'
import { branches, users } from './core'
import { orgId } from './tenancy'

// Certificate designs made on the canvas (Certificate Designs page, lib/cert-design.ts). No branch: head office's,
// offered to every branch.
export const certificateDesigns = pgTable('certificate_designs', {
  orgId: orgId(),
  id: uuid('id').primaryKey().defaultRandom(),
  branchId: uuid('branch_id').references(() => branches.id),
  name: text('name').notNull(),
  design: jsonb('design').$type<Design>().notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('certificate_designs_branch_idx').on(t.branchId)])

export type EventKind = 'seminar' | 'workshop' | 'webinar' | 'bootcamp' | 'competition' | 'other'
/** One quiz question: its options and which one is right (0-based). */
export type QuizQuestion = { q: string; options: string[]; answer: number }

// Seminars, workshops and other events. People sign up on the public page /e/<token> (its link and QR code), take the
// quiz when there is one, and get a certificate in the event's design by e-mail.
export const events = pgTable('events', {
  orgId: orgId(),
  id: uuid('id').primaryKey().defaultRandom(),
  branchId: uuid('branch_id').references(() => branches.id), // none: head office's own
  kind: text('kind').$type<EventKind>().notNull(),
  title: text('title').notNull(),
  description: text('description'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  mode: text('mode').$type<'offline' | 'online' | 'hybrid'>().notNull().default('offline'),
  venue: text('venue'), // the place, or the meeting link for an online one
  speaker: text('speaker'),
  token: text('token').notNull(), // the public link's code
  askMobile: boolean('ask_mobile').notNull().default(true),
  askOrg: boolean('ask_org').notNull().default(true), // ask for the college / company
  hasQuiz: boolean('has_quiz').notNull().default(false),
  quiz: jsonb('quiz').$type<QuizQuestion[]>().notNull().default([]),
  passPercent: integer('pass_percent').notNull().default(60),
  quizMinutes: integer('quiz_minutes'), // a time limit for the quiz, when set
  certificate: boolean('certificate').notNull().default(true),
  certFor: text('cert_for').$type<'all' | 'passed'>().notNull().default('passed'), // with a quiz: everyone, or those who pass
  designId: uuid('design_id').references(() => certificateDesigns.id),
  isOpen: boolean('is_open').notNull().default(true), // taking sign-ups (live)
  closesAt: timestamp('closes_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('events_token_uq').on(t.token), index('events_branch_idx').on(t.branchId, t.startsAt)])

// Who signed up for an event, their quiz result and their certificate (number and the code of its public page).
export const eventParticipants = pgTable('event_participants', {
  orgId: orgId(),
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().references(() => events.id),
  branchId: uuid('branch_id').references(() => branches.id), // the event's
  name: text('name').notNull(),
  email: text('email').notNull(),
  mobile: text('mobile'),
  organisation: text('organisation'),
  answers: jsonb('answers').$type<number[]>(),
  score: integer('score'),
  total: integer('total'),
  passed: boolean('passed'),
  certNo: text('cert_no'), // set when a certificate is issued
  hash: text('hash').notNull(), // the code of the certificate's public page /e/c/<hash>
  mailedAt: timestamp('mailed_at', { withTimezone: true }),
  mailError: text('mail_error'),
  ip: text('ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('event_participants_email_uq').on(t.eventId, sql`lower(email)`),
  uniqueIndex('event_participants_hash_uq').on(t.hash),
  uniqueIndex('event_participants_cert_no_uq').on(t.orgId, t.certNo),
  index('event_participants_event_idx').on(t.eventId, t.createdAt),
])
