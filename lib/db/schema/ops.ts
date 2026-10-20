import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { orgId } from './tenancy'

// One row per scheduled-job run (reminders, reconciliation, ...). System-level: no branch, super admin only.
// A failed run or a reconciliation mismatch shows as an alert on the super admin's dashboard.
export const jobRuns = pgTable(
  'job_runs',
  {
    orgId: orgId(),
    id: uuid('id').primaryKey().defaultRandom(),
    job: text('job').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    ok: boolean('ok'),
    summary: jsonb('summary').$type<Record<string, unknown>>(),
    error: text('error'),
  },
  (t) => [index('job_runs_job_idx').on(t.job, t.startedAt)],
)
