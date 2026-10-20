// Server half of list-query: turns a ListQuery into safe SQL pieces.
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import type { ListQuery } from './list-query'

const DAY = /^\d{4}-\d{2}-\d{2}$/
/** A real calendar day (2026-02-30 and 2026-13-01 are rejected). */
const isDay = (v: unknown): v is string => typeof v === 'string' && DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A search term taken literally inside LIKE / ILIKE: its % _ and \ are not wildcards (backslash is Postgres's default escape). */
export const escapeLike = (term: string) => term.replace(/[%_\\]/g, (c) => `\\${c}`)
/** A sort key: a plain name, never one an object inherits ("constructor", "__proto__"...). */
const SORT_KEY = /^[A-Za-z][A-Za-z0-9_]{0,40}$/

/** Never trust what the browser sends: bad dates, odd sort keys and junk ids are dropped, not passed to SQL. */
export function cleanQuery(raw: ListQuery | undefined) {
  const lq = raw ?? {}
  const q = typeof lq.q === 'string' ? lq.q.trim().slice(0, 100) : ''
  const from = isDay(lq.from) ? lq.from : null
  const to = isDay(lq.to) ? lq.to : null
  const f = (k: string) => { const v = lq.f?.[k]; return typeof v === 'string' && v ? v.slice(0, 64) : null }
  const id = (k: string) => { const v = f(k); return v && UUID.test(v) ? v : null }
  /** Picks a filter value from a fixed list, e.g. one(['active','on_hold'], 'status'). */
  const one = <T extends string>(allowed: readonly T[], k: string) => { const v = f(k); return v && (allowed as readonly string[]).includes(v) ? (v as T) : null }
  const sort = typeof lq.sort === 'string' && SORT_KEY.test(lq.sort) && !(lq.sort in Object.prototype) ? lq.sort : ''
  return { q, like: q ? `%${escapeLike(q)}%` : null, from, to, f, id, one, sort, dir: lq.dir === 'asc' ? 'asc' : 'desc' as 'asc' | 'desc' }
}

/** `col` within [from, to] (whole days). Works for date and timestamp columns. */
export function inRange(col: SQLWrapper, from: string | null, to: string | null): SQL | undefined {
  if (from && to) return sql`${col} >= ${from}::date and ${col} < ${to}::date + 1`
  if (from) return sql`${col} >= ${from}::date`
  if (to) return sql`${col} < ${to}::date + 1`
  return undefined
}

/** ORDER BY from a whitelist of sortable expressions; unknown keys fall back to the default. Blanks always go last. */
export function orderFrom(map: Record<string, SQLWrapper>, sort: string, dir: 'asc' | 'desc', fallback: string, tiebreak: SQLWrapper): SQL {
  const known = Object.hasOwn(map, sort)
  const col = known ? map[sort] : map[fallback]
  const d = sql.raw(known && dir === 'asc' ? 'asc' : 'desc')
  return sql`${col} ${d} nulls last, ${tiebreak} desc`
}
