import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const globalForDb = globalThis as unknown as { pgPool?: Pool; ownerPool?: Pool }

export const pool =
  globalForDb.pgPool ??
  // Every session runs in India time, so current_date / now()::date in SQL is the date in India (not UTC, which is a
  // day behind from 00:00 to 05:30). Timestamps are stored as absolute instants either way.
  new Pool({ connectionString: process.env.DATABASE_URL, max: 10, options: '-c timezone=Asia/Kolkata' })

if (process.env.NODE_ENV !== 'production') globalForDb.pgPool = pool

export const db = drizzle(pool, { schema })
export type Db = typeof db

// The tables' owner, for the two jobs that need more than the app may do: emptying the data (TRUNCATE) and deleting
// for good from the Recycle Bin. On the live server DATABASE_URL is a login that can only act as the app (row-level
// security, no DDL, not a superuser) and DATABASE_OWNER_URL the owner; when only DATABASE_URL is set, it is used for both.
const ownerUrl = process.env.DATABASE_OWNER_URL
const ownerPool = ownerUrl && ownerUrl !== process.env.DATABASE_URL
  ? (globalForDb.ownerPool ??= new Pool({ connectionString: ownerUrl, max: 2, options: '-c timezone=Asia/Kolkata' }))
  : pool
export const ownerDb = ownerPool === pool ? db : drizzle(ownerPool, { schema })
