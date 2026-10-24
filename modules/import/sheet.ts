// Import from a spreadsheet (Import page, any time, not only in Set Up): one branch's students, enquiries or staff from
// a CSV file (Excel / Google Sheets: "Save as" / "Download" CSV). Students and enquiries go through ./legacy (the same
// services as the screens, a row at a time; a bad row is turned down with its reason and the rest carry on; a second
// run skips the rows already in). Staff through createUser: each gets a login, e-mailed by the caller after the import.
// Headers are matched loosely: "Mobile No." is phone, "Admission date" is enrollment_date (ALIASES).
import { sql } from 'drizzle-orm'
import type { Actor, Tx } from '@/lib/db/withTenant'
import type { Login } from '../branches/service'
import { createUser } from '../users/service'
import { eachRow, importEnquiries, importRegistrations, type ImportReport, type Row } from './legacy'

export type SheetKind = 'students' | 'enquiries' | 'staff'
export const SHEET_KINDS: SheetKind[] = ['students', 'enquiries', 'staff']
/** The most rows one file may carry (a bigger list goes in parts; each part can be run again safely). */
export const MAX_ROWS = 3000

type Col = { key: string; need?: boolean; what: string; example: string }
/** The columns of each file, in the template's order. */
export const SHEET_COLUMNS: Record<SheetKind, Col[]> = {
  students: [
    { key: 'first_name', need: true, what: 'First name', example: 'Karan' },
    { key: 'last_name', what: 'Last name', example: 'Mehta' },
    { key: 'phone', need: true, what: 'Mobile number (10 digits)', example: '9876500003' },
    { key: 'email', what: 'E-mail', example: 'karan@example.com' },
    { key: 'father_name', what: 'Father’s / guardian’s name', example: 'Rajesh Mehta' },
    { key: 'guardian_phone', what: 'Guardian’s mobile', example: '9876500004' },
    { key: 'dob', what: 'Date of birth (DD-MM-YYYY)', example: '12-03-2004' },
    { key: 'address', what: 'Address', example: '12 Model Town, Ludhiana' },
    { key: 'department', need: true, what: 'Department, as in Courses (or give the course)', example: 'Computer Courses' },
    { key: 'course', what: 'Course, as in Courses', example: '' },
    { key: 'class_mode', what: 'Class mode (Offline, Online…)', example: 'Offline' },
    { key: 'enrollment_date', need: true, what: 'Admission date (DD-MM-YYYY)', example: '01-07-2026' },
    { key: 'total_fee', need: true, what: 'Total fee (₹)', example: '30000' },
    { key: 'paid_to_date', what: 'Paid so far (₹)', example: '12000' },
    { key: 'next_due_date', what: 'Next installment date', example: '10-10-2026' },
    { key: 'next_due_amount', what: 'Next installment (₹)', example: '9000' },
    { key: 'status', what: 'active, on_hold, discontinued or completed', example: 'active' },
    { key: 'legacy_reg_no', what: 'Their number in your old records (optional; kept and searchable)', example: 'OLD/2026/0101' },
    { key: 'remarks', what: 'Remarks', example: '' },
  ],
  enquiries: [
    { key: 'enquiry_date', what: 'Date of the enquiry (DD-MM-YYYY)', example: '15-08-2026' },
    { key: 'first_name', need: true, what: 'First name', example: 'Riya' },
    { key: 'last_name', what: 'Last name', example: 'Sharma' },
    { key: 'phone', need: true, what: 'Mobile number', example: '9876500001' },
    { key: 'email', what: 'E-mail', example: 'riya@example.com' },
    { key: 'source', what: 'Source (as in your lists)', example: 'Social Media' },
    { key: 'department', what: 'Department', example: 'Computer Courses' },
    { key: 'course', what: 'Course', example: '' },
    { key: 'class_mode', what: 'Class mode', example: 'Offline' },
    { key: 'proposed_fee', what: 'Fee offered (₹)', example: '25000' },
    { key: 'status', what: 'new, contacted, follow_up, demo, not_joined or dead', example: 'follow_up' },
    { key: 'follow_up_date', what: 'Next follow-up (DD-MM-YYYY)', example: '05-11-2026' },
    { key: 'not_joined_reason', what: 'Why they did not join (as in your lists)', example: '' },
    { key: 'remarks', what: 'Remarks', example: 'Asked about the weekend batch' },
    { key: 'legacy_ref', what: 'Their number in your old records (optional)', example: '' },
  ],
  staff: [
    { key: 'name', need: true, what: 'Full name', example: 'Neha Verma' },
    { key: 'email', need: true, what: 'E-mail (their login)', example: 'neha@example.com' },
    { key: 'phone', what: 'Mobile number', example: '9876500010' },
    { key: 'role', need: true, what: 'Role, as in Roles & Permissions (several: separate with ;)', example: 'Counselor' },
  ],
}

/** The template file: the headers and one example row. */
export function sheetTemplate(kind: SheetKind): string {
  const cols = SHEET_COLUMNS[kind]
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  return `${cols.map((c) => c.key).join(',')}\r\n${cols.map((c) => cell(c.example)).join(',')}\r\n`
}

/** Other names people give the columns (after "First Name" -> first_name). */
const ALIASES: Record<string, string> = {
  name_first: 'first_name', firstname: 'first_name', student_name: 'first_name', surname: 'last_name', lastname: 'last_name',
  mobile: 'phone', mobile_no: 'phone', mobile_number: 'phone', phone_no: 'phone', phone_number: 'phone', contact: 'phone', contact_no: 'phone',
  e_mail: 'email', email_id: 'email', mail: 'email',
  father: 'father_name', fathers_name: 'father_name', guardian_name: 'father_name', parent_phone: 'guardian_phone', guardian_mobile: 'guardian_phone',
  date_of_birth: 'dob', birth_date: 'dob',
  admission_date: 'enrollment_date', date_of_admission: 'enrollment_date', joining_date: 'enrollment_date', enrolment_date: 'enrollment_date',
  fee: 'total_fee', fees: 'total_fee', total_fees: 'total_fee', course_fee: 'total_fee',
  paid: 'paid_to_date', fee_paid: 'paid_to_date', amount_paid: 'paid_to_date', paid_amount: 'paid_to_date',
  due_date: 'next_due_date', due_amount: 'next_due_amount', mode: 'class_mode', batch_mode: 'class_mode',
  reg_no: 'legacy_reg_no', registration_no: 'legacy_reg_no', old_reg_no: 'legacy_reg_no', roll_no: 'legacy_reg_no',
  date: 'enquiry_date', remark: 'remarks', note: 'remarks', notes: 'remarks', category: 'department', roles: 'role', designation: 'role',
}
export const normaliseRows = (rows: Row[]): Row[] => rows.map((r) => {
  const out: Row = {}
  for (const [k, v] of Object.entries(r)) { const key = ALIASES[k] ?? k; if (!out[key]) out[key] = v }
  return out
})

/** Which required columns the file lacks (none of the rows has them under any name). */
export function missingColumns(kind: SheetKind, rows: Row[]): string[] {
  const have = new Set(rows.flatMap((r) => Object.keys(r)))
  const need = SHEET_COLUMNS[kind].filter((c) => c.need).map((c) => c.key)
  // a student's department may come from the course
  return need.filter((k) => !have.has(k) && !(kind === 'students' && k === 'department' && have.has('course')))
}

export type SheetReport = ImportReport & { logins: Login[] }

export async function importSheet(tx: Tx, actor: Actor, kind: SheetKind, raw: Row[]): Promise<SheetReport> {
  const rows = normaliseRows(raw)
  if (!rows.length) throw new Error('The file has no rows under its headings')
  if (rows.length > MAX_ROWS) throw new Error(`The file has ${rows.length} rows: import at most ${MAX_ROWS} at a time (split it; running a part again is safe)`)
  const missing = missingColumns(kind, rows)
  if (missing.length) throw new Error(`The file has no ${missing.join(', ')} column${missing.length > 1 ? 's' : ''}: start from the template`)
  if (kind === 'students') return { ...(await importRegistrations(tx, actor, rows)), logins: [] }
  if (kind === 'enquiries') return { ...(await importEnquiries(tx, actor, rows)), logins: [] }
  return importStaff(tx, actor, rows)
}

/** Staff: a login each at the actor's branch, with the roles named (by name or key); an e-mail already in is skipped. */
async function importStaff(tx: Tx, actor: Actor, rows: Row[]): Promise<SheetReport> {
  const roles = (await tx.execute<{ key: string; name: string; kind: string }>(sql`select key, name, kind from roles`)).rows
  const byName = new Map(roles.flatMap((r) => [[r.key.toLowerCase(), r], [r.name.toLowerCase(), r]]))
  const logins: Login[] = []
  const rep = await eachRow(tx, 'staff', rows, (r, i) => r.email || `line ${i + 2}`, async (r) => {
    const email = (r.email ?? '').trim().toLowerCase()
    if (!r.name?.trim()) throw new Error('name is required')
    if (!email) throw new Error('email is required')
    const [had] = (await tx.execute<{ id: string }>(sql`select id from users where lower(email) = ${email} and deleted_at is null`)).rows
    if (had) return 'skipped'
    const keys = (r.role ?? '').split(/[;|/]+/).map((x) => x.trim()).filter(Boolean).map((x) => {
      const role = byName.get(x.toLowerCase())
      if (!role) throw new Error(`role: "${x}" is not one of your roles (${roles.filter((y) => y.kind === 'staff').map((y) => y.name).join(', ')})`)
      if (role.kind !== 'staff') throw new Error(`role: "${x}" cannot be given by an import`)
      return role.key
    })
    if (!keys.length) throw new Error('role is required')
    const made = await createUser(tx, actor, { name: r.name.trim(), email, phone: r.phone?.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '') || undefined, roles: keys, branchId: actor.branchId })
    logins.push({ userId: made.user.id, name: made.user.name, email: made.user.email, password: made.tempPassword, roles: made.roles })
    return 'created'
  })
  return { ...rep, logins }
}
