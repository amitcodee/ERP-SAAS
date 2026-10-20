// What an error may tell the person who caused it. Business rules throw plain Errors written for people, and those are
// shown as they are. A database or driver failure carries the SQL text, table and column names and policy names, so it
// is logged and replaced with a plain sentence.
import { log } from '@/lib/log'

type DbError = { code?: string; message?: string; cause?: DbError }

const isInternal = (e: unknown): boolean => {
  if (!(e instanceof Error)) return true
  const x = e as Error & DbError
  return !!x.code || !!x.cause || x.name === 'DrizzleQueryError' || /^Failed query:/.test(x.message)
}

/** The database error underneath a driver wrapper (drizzle puts the pg error in `cause`). */
const dbCause = (e: unknown): DbError | undefined => {
  let x = e as DbError | undefined
  for (let i = 0; x && i < 5; i++, x = x.cause) if (typeof x.code === 'string' && /^[0-9A-Z]{5}$/.test(x.code)) return x
  return undefined
}

/** Message for the user (zod issues joined, a business rule's own words, or a plain sentence); logs anything internal. */
export function userMessage(e: unknown, fallback = 'Something went wrong. Please try again.', where = 'request.error'): string {
  const zod = (e as { issues?: { message: string; path?: (string | number)[] }[] }).issues
  if (zod) return zod.map((i) => (i.path?.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ')
  if (!isInternal(e)) return (e as Error).message
  log.error(where, { error: e })
  const db = dbCause(e)
  if (db?.code === 'P0001' && db.message) return db.message // a rule the database itself states (RAISE EXCEPTION), written for people
  if (db?.code === '23505') return 'This already exists'
  if (db?.code === '42501') return 'You do not have access to this'
  if (db?.code?.startsWith('22')) return 'Some of the details are not valid'
  return fallback
}
