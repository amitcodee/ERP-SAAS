// Number formats, without the database (so the Settings screen can preview them too): what each kind of number is,
// its default format, checking a format, and drawing a number from one. lib/numbering.ts mints them.
// Tokens: {n} the running number as is, {nnnn} the same padded (as many digits as n's, up to 8), {yyyy} / {YYYY} and
// {yy} / {YY} the year, {FY} the Indian financial year (2026-27), {code} / {BRANCH} the branch code (the certificate
// code for certificates). A year in the format makes the count start again each year; {FY} each financial year.
import { istParts, yearIST } from './ist'

export type NumberKind = 'ENQ' | 'REG' | 'RCP' | 'CERT' | 'TKT' | 'HLP' | 'EVC'

type KindInfo = { label: string; default: string; branch: boolean; taken?: [table: string, column: string] }
/** What each kind is, its default format, and whether each branch counts its own (else the whole org counts one). */
export const NUMBER_KINDS: Record<NumberKind, KindInfo> = {
  ENQ: { label: 'Enquiry', default: 'ENQ-{code}-{yy}-{nnnn}', branch: true, taken: ['enquiries', 'enquiry_no'] },
  REG: { label: 'Registration', default: 'REG-{yyyy}-{code}-{nnnn}', branch: true, taken: ['registrations', 'reg_no'] },
  RCP: { label: 'Receipt', default: 'RCP-{code}-{FY}-{nnnnn}', branch: true }, // gapless: never skips
  CERT: { label: 'Certificate', default: 'CERT-{code}-{yyyy}-{nnnn}', branch: true, taken: ['certificates', 'cert_no'] },
  TKT: { label: 'Support ticket', default: 'TKT-{nnnnn}', branch: false, taken: ['support_tickets', 'ticket_no'] },
  HLP: { label: 'Help request', default: 'HLP-{nnnnn}', branch: false, taken: ['help_requests', 'request_no'] },
  EVC: { label: 'Event certificate', default: 'EV-{yy}-{nnnnnn}', branch: false, taken: ['event_participants', 'cert_no'] },
}
export const NUMBER_KIND_KEYS = Object.keys(NUMBER_KINDS) as NumberKind[]
export const REG_DEFAULT_FORMAT = NUMBER_KINDS.REG.default

/** Indian financial year label (by the date in India), e.g. 2026-09-30 -> '2026-27', 2027-02-01 -> '2026-27'. */
export function financialYear(d = new Date()): string {
  const { y, m } = istParts(d)
  const start = m >= 4 ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

const TOKEN = /\{(code|BRANCH|yyyy|YYYY|yy|YY|FY|n{1,8})\}/g
const NUM = /\{n{1,8}\}/g
const pad = (n: number, w = 4) => String(n).padStart(w, '0')

/** What is wrong with a format, or null. `org`: an org-wide format (a branch's own registration format is `branch`). */
export function formatProblem(kind: NumberKind, f: string, level: 'org' | 'branch' = 'org'): string | null {
  const info = NUMBER_KINDS[kind]
  if (!f.trim()) return 'Enter a format'
  if (f.length > 40) return 'At most 40 characters'
  if ((f.match(NUM) ?? []).length !== 1) return 'Put the running number in it once: {n} (as is) or {nnnn} (4 digits)'
  const rest = f.replace(TOKEN, '')
  if (/[{}]/.test(rest)) return `Unknown {…} part: use {n}, {nnnn}, {yyyy}, {yy}, {FY}${info.branch ? ' or {code}' : ''}`
  if (!/^[A-Za-z0-9/._ -]*$/.test(rest)) return 'Use letters, digits and / - _ . only'
  const hasCode = /\{(code|BRANCH)\}/.test(f)
  if (!info.branch && hasCode) return 'These are counted for the whole institute: leave out {code}'
  if (info.branch && level === 'org' && !hasCode) return 'Put the branch in it ({code}): each branch counts its own'
  if (kind === 'RCP' && !f.includes('{FY}')) return 'Receipts are counted per financial year: put {FY} in it'
  if (kind === 'RCP' && !/\{n{1,8}\}$/.test(f)) return 'End a receipt number with the running number'
  return null
}
/** A branch's own registration format (Branches): the org-wide rules, except that it need not name the branch. */
export const regFormatProblem = (f: string) => formatProblem('REG', f, 'branch')

/** The counter a number of this format draws from: a year, a financial year, or one for all time. */
export function periodOf(f: string, d = new Date()): string {
  if (f.includes('{FY}')) return financialYear(d)
  return /\{(yyyy|YYYY|yy|YY)\}/.test(f) ? String(yearIST(d)) : 'ALL'
}
export const regPeriod = periodOf

export function renderNumber(f: string, code: string, n: number, d = new Date()): string {
  const y = String(yearIST(d))
  return f.replace(TOKEN, (_, t: string) =>
    t === 'code' || t === 'BRANCH' ? code : t === 'yyyy' || t === 'YYYY' ? y : t === 'yy' || t === 'YY' ? y.slice(2)
      : t === 'FY' ? financialYear(d) : t === 'n' ? String(n) : pad(n, t.length))
}
export const renderRegNo = renderNumber

/** The running number inside a number of this format (null: not of this format). */
export function numberOf(f: string, code: string, no: string, d = new Date()): number | null {
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  let re = '', last = 0
  for (const m of f.matchAll(TOKEN)) {
    re += esc(f.slice(last, m.index))
    re += /^n+$/.test(m[1]) ? '(\\d+)' : esc(renderNumber(m[0], code, 0, d))
    last = m.index + m[0].length
  }
  const hit = new RegExp('^' + re + esc(f.slice(last)) + '$').exec(no)
  return hit ? Number(hit[1]) : null
}
export const regNumberOf = numberOf
