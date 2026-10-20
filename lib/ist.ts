// Dates in India time (IST, UTC+05:30, no daylight saving). The server and the database may run in UTC, and
// `new Date().toISOString().slice(0, 10)` is the UTC date: wrong from 00:00 to 05:30 in India. Every "today", every
// year / financial year in a number, and every default month goes through here. Safe on the server and in the browser.
const OFFSET_MS = 330 * 60_000

/** The calendar date in India at `d` (default now): { y, m: 1-12, d }. */
export function istParts(at: Date = new Date()) {
  const s = new Date(at.getTime() + OFFSET_MS)
  return { y: s.getUTCFullYear(), m: s.getUTCMonth() + 1, d: s.getUTCDate() }
}

/** Today's date in India, YYYY-MM-DD. */
export const todayIST = (at: Date = new Date()) => new Date(at.getTime() + OFFSET_MS).toISOString().slice(0, 10)

/** This month in India, YYYY-MM. */
export const monthIST = (at: Date = new Date()) => todayIST(at).slice(0, 7)

/** The year in India (a receipt / registration number made at 00:30 on 1 January is already the new year). */
export const yearIST = (at: Date = new Date()) => istParts(at).y
