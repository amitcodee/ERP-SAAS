// One-off import of existing records (insti.md §11). Every row goes through the SAME services as the UI,
// so numbering, phone de-duplication and ledger rules apply. Each row runs in its own savepoint: a bad row
// is rejected with a reason and the rest carry on. Re-running is safe: rows already imported are skipped.
import { and, eq, sql } from 'drizzle-orm'
import { courses, departments, enquiries, lookups, registrationEvents, registrations } from '@/lib/db/schema'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { createEnquiry, transitionEnquiry } from '../enquiries/service'
import { postOpeningBalance } from '../fees/service'
import { createRegistration, transitionRegistration } from '../registrations/service'

export type Row = Record<string, string>
export type Reject = { line: number; key: string; reason: string }
export type ImportReport = { kind: 'enquiries' | 'registrations' | 'staff'; total: number; created: number; skipped: number; rejects: Reject[] }

// ---- parsing -------------------------------------------------------------------------------

/** RFC 4180 CSV (quoted fields, "" escapes, CRLF/LF). Headers are normalised: "First Name" -> first_name. */
export function parseCsv(text: string): Row[] {
  const out: string[][] = []
  let row: string[] = [], field = '', q = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') q = false
      else field += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((v) => v.trim() !== '')) out.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some((v) => v.trim() !== '')) out.push(row)
  const [head, ...body] = out
  if (!head) return []
  const keys = head.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''))
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])))
}

/** YYYY-MM-DD, or Indian DD-MM-YYYY / DD/MM/YYYY / DD.MM.YYYY. Returns ISO or throws. */
export function parseDate(v: string, field: string): string {
  let y: number, m: number, d: number
  let x = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (x) [y, m, d] = [+x[1], +x[2], +x[3]]
  else if ((x = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) [d, m, y] = [+x[1], +x[2], +x[3]]
  else throw new Error(`${field}: "${v}" is not a date (use DD-MM-YYYY or YYYY-MM-DD)`)
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw new Error(`${field}: "${v}" is not a real date`)
  return dt.toISOString().slice(0, 10)
}

/** Rupees as typed in Excel ("₹12,500", "12500.50") -> paise. */
export function parseRupees(v: string, field: string): number {
  const clean = v.replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '')
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) throw new Error(`${field}: "${v}" is not an amount`)
  return Math.round(Number(clean) * 100)
}

const opt = (r: Row, k: string) => (r[k] ? r[k] : null)
const need = (r: Row, k: string) => { if (!r[k]) throw new Error(`${k} is required`); return r[k] }
const phone = (v: string | null) => (v ? v.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '') : null)

// ---- catalog lookups by name (case-insensitive) -------------------------------------------------

type Catalog = { dept: Map<string, string>; course: Map<string, { id: string; departmentId: string }>; mode: Map<string, string>; source: Map<string, string>; reason: Map<string, string> }

async function loadCatalog(tx: Tx): Promise<Catalog> {
  const k = (s: string) => s.trim().toLowerCase()
  const ls = await tx.select().from(lookups)
  const of = (kind: string) => new Map(ls.filter((l) => l.kind === kind).map((l) => [k(l.value), l.id]))
  return {
    dept: new Map((await tx.select().from(departments)).map((d) => [k(d.name), d.id])),
    course: new Map((await tx.select().from(courses)).map((c) => [k(c.title), { id: c.id, departmentId: c.departmentId }])),
    mode: of('class_mode'), source: of('enquiry_source'), reason: of('not_joined_reason'),
  }
}
const pick = (m: Map<string, string>, v: string | null, field: string) => {
  if (!v) return null
  const id = m.get(v.trim().toLowerCase())
  if (!id) throw new Error(`${field}: "${v}" is not in the catalog (add it first, or fix the spelling)`)
  return id
}

export async function eachRow(tx: Tx, kind: ImportReport['kind'], rows: Row[], keyOf: (r: Row, i: number) => string, fn: (r: Row, key: string) => Promise<'created' | 'skipped'>): Promise<ImportReport> {
  const rep: ImportReport = { kind, total: rows.length, created: 0, skipped: 0, rejects: [] }
  for (let i = 0; i < rows.length; i++) {
    const line = i + 2 // header is line 1
    const key = keyOf(rows[i], i)
    await tx.execute(sql`savepoint import_row`)
    try {
      rep[await fn(rows[i], key)]++
      await tx.execute(sql`release savepoint import_row`)
    } catch (e) {
      await tx.execute(sql`rollback to savepoint import_row`)
      const zod = (e as { issues?: { message: string; path: (string | number)[] }[] }).issues
      const cause = (e as { cause?: { message?: string } }).cause?.message
      rep.rejects.push({ line, key, reason: zod ? zod.map((z) => `${z.path.join('.')}: ${z.message}`).join('; ') : cause ?? (e instanceof Error ? e.message : String(e)) })
    }
  }
  return rep
}

// ---- enquiries ----------------------------------------------------------------------------------
// Columns: legacy_ref, enquiry_date, first_name*, last_name, phone*, alt_phone, email, source, department, course,
//          class_mode, proposed_fee, status (new|contacted|follow_up|demo|not_joined|dead), follow_up_date, not_joined_reason, remarks

export async function importEnquiries(tx: Tx, actor: Actor, rows: Row[]): Promise<ImportReport> {
  const cat = await loadCatalog(tx)
  const branchId = actor.branchId!
  return eachRow(tx, 'enquiries', rows, (r, i) => r.legacy_ref || `${phone(r.phone) ?? 'row' + (i + 2)}:${r.enquiry_date ?? ''}`, async (r, key) => {
    const [dup] = await tx.select({ id: enquiries.id }).from(enquiries).where(and(eq(enquiries.branchId, branchId), eq(enquiries.legacyRef, key)))
    if (dup) return 'skipped'
    const course = r.course ? cat.course.get(r.course.trim().toLowerCase()) : null
    if (r.course && !course) throw new Error(`course: "${r.course}" is not in the catalog`)
    const status = (r.status || 'new').toLowerCase().replace(/[\s-]+/g, '_')
    const followUp = r.follow_up_date ? parseDate(r.follow_up_date, 'follow_up_date') : null
    const { enquiry } = await createEnquiry(tx, actor, {
      person: { firstName: need(r, 'first_name'), lastName: opt(r, 'last_name'), phone: phone(need(r, 'phone'))!, altPhone: phone(opt(r, 'alt_phone')), email: opt(r, 'email') },
      sourceId: pick(cat.source, opt(r, 'source'), 'source'),
      departmentId: pick(cat.dept, opt(r, 'department'), 'department') ?? course?.departmentId ?? null,
      courseId: course?.id ?? null,
      classModeId: pick(cat.mode, opt(r, 'class_mode'), 'class_mode'),
      proposedFee: r.proposed_fee ? parseRupees(r.proposed_fee, 'proposed_fee') : null,
      followUpDate: status === 'new' ? followUp : null,
      remarks: opt(r, 'remarks'),
    }, { quiet: true })
    if (status !== 'new') {
      if (!['contacted', 'follow_up', 'demo', 'not_joined', 'dead'].includes(status)) throw new Error(`status: "${r.status}" is not one of new, contacted, follow_up, demo, not_joined, dead (registered students go in the registrations file)`)
      await transitionEnquiry(tx, actor, {
        enquiryId: enquiry.id, to: status as 'contacted', followUpDate: followUp,
        notJoinedReasonId: pick(cat.reason, opt(r, 'not_joined_reason'), 'not_joined_reason'), note: 'Imported from old records',
      })
    }
    const at = r.enquiry_date ? parseDate(r.enquiry_date, 'enquiry_date') : null
    await tx.update(enquiries).set({ legacyRef: key, ...(at ? { createdAt: new Date(at + 'T09:00:00+05:30') } : {}) }).where(eq(enquiries.id, enquiry.id))
    return 'created'
  })
}

// ---- registrations ------------------------------------------------------------------------------
// Columns: legacy_reg_no (without it, a row is matched by phone, department and admission date), first_name*, last_name, phone*, alt_phone, guardian_phone, email, father_name, dob, address,
//          department*, course, class_mode, enrollment_date*, total_fee*, paid_to_date, status (active|on_hold|discontinued|completed),
//          next_due_date, next_due_amount, remarks

export async function importRegistrations(tx: Tx, actor: Actor, rows: Row[]): Promise<ImportReport> {
  const cat = await loadCatalog(tx)
  const branchId = actor.branchId!
  return eachRow(tx, 'registrations', rows, (r, i) => r.legacy_reg_no || [r.first_name, r.phone].filter(Boolean).join(' ') || `line ${i + 2}`, async (r) => {
    // the old number when the file has one; else the same student (phone), department and admission date is the same row
    const legacy = opt(r, 'legacy_reg_no')
    if (legacy) {
      const [dup] = await tx.select({ id: registrations.id }).from(registrations).where(and(eq(registrations.branchId, branchId), eq(registrations.legacyRegNo, legacy)))
      if (dup) return 'skipped'
    }
    const course = r.course ? cat.course.get(r.course.trim().toLowerCase()) : null
    if (r.course && !course) throw new Error(`course: "${r.course}" is not in the catalog`)
    const departmentId = pick(cat.dept, opt(r, 'department'), 'department') ?? course?.departmentId
    if (!departmentId) throw new Error('department is required')
    const enrolled = parseDate(need(r, 'enrollment_date'), 'enrollment_date')
    if (!legacy) {
      const [dup] = (await tx.execute<{ id: string }>(sql`select r.id from registrations r join persons p on p.id = r.person_id
        where r.branch_id = ${branchId} and p.phone = ${phone(need(r, 'phone'))} and r.department_id = ${departmentId} and r.enrollment_date = ${enrolled}::date limit 1`)).rows
      if (dup) return 'skipped'
    }
    const totalFee = parseRupees(need(r, 'total_fee'), 'total_fee')
    const paid = r.paid_to_date ? parseRupees(r.paid_to_date, 'paid_to_date') : 0
    const status = (r.status || 'active').toLowerCase().replace(/[\s-]+/g, '_')
    if (!['active', 'on_hold', 'discontinued', 'completed'].includes(status)) throw new Error(`status: "${r.status}" is not one of active, on_hold, discontinued, completed`)
    const next = r.next_due_date || r.next_due_amount
      ? { dueDate: parseDate(need(r, 'next_due_date'), 'next_due_date'), amount: parseRupees(need(r, 'next_due_amount'), 'next_due_amount') }
      : null

    const reg = await createRegistration(tx, actor, {
      person: { firstName: need(r, 'first_name'), lastName: opt(r, 'last_name'), phone: phone(need(r, 'phone'))!, altPhone: phone(opt(r, 'alt_phone')), email: opt(r, 'email') },
      profile: { fatherName: opt(r, 'father_name'), dob: r.dob ? parseDate(r.dob, 'dob') : null, altPhone: phone(opt(r, 'alt_phone')), guardianPhone: phone(opt(r, 'guardian_phone')), email: opt(r, 'email'), address: opt(r, 'address') },
      departmentId, courseId: course?.id ?? null, classModeId: pick(cat.mode, opt(r, 'class_mode'), 'class_mode'),
      enrollmentDate: enrolled, totalFee,
    }, { quiet: true })
    await tx.update(registrations).set({ ...(legacy ? { legacyRegNo: legacy } : {}), createdAt: new Date(enrolled + 'T09:00:00+05:30') }).where(eq(registrations.id, reg.id))
    await postOpeningBalance(tx, actor, reg, paid, next)

    const note = r.remarks ? `Imported: ${r.remarks}` : 'Imported from old records'
    if (status === 'on_hold' || status === 'discontinued') await transitionRegistration(tx, actor, { registrationId: reg.id, to: status, note })
    if (status === 'completed') {
      // The app has no "complete" action yet; the old records are the authority for students who already finished.
      await tx.update(registrations).set({ status: 'completed' }).where(eq(registrations.id, reg.id))
      await tx.insert(registrationEvents).values({ registrationId: reg.id, branchId, byUser: actor.userId, fromStatus: 'active', toStatus: 'completed', note })
    }
    return 'created'
  })
}
