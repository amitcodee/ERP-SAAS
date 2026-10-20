// Import from the OLD techcadd system, table by table as exported from phpMyAdmin (CSV, first row = column names):
//   <branch>_registration (jal_registration, hsp_registration, ...): the students, with their old numbers
//   fee: every payment (shared by all branches; only this branch's students are taken)
// Nothing is lost: each student keeps their exact old registration number (the branch's number format must be set
// first, e.g. TCD/4002/{n}, so new admissions carry on after the highest old number), their whole old row is kept
// as it was (minus the password), and every old payment is kept with its date, mode and old receipt number.
// Re-running is safe (rows already brought over are skipped), so it can be run again while the old system is still
// in use. Every row runs in its own savepoint: a row that cannot be brought over is listed with the reason.
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { branches, departments, courses, registrations, registrationEvents } from '@/lib/db/schema'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { regNumberOf, setRegCounter } from '@/lib/numbering'
import { normalizePhone } from '@/modules/people/phone'
import { createRegistration } from '../registrations/service'
import type { Reject, Row } from './legacy'

export type OldReport = {
  kind: 'old registrations' | 'old fees'; total: number; created: number; skipped: number
  rejects: Reject[]; notes: string[]
}

/** The old course types and the new departments they belong to (head office can change these with --map). */
export const DEFAULT_DEPT_MAP: Record<string, string> = {
  'computer application': 'Basic & Accounting', it: 'CSE-IT', mechanical: 'CAD/CAM', civil: 'CAD/CAM', electrical: 'CAD/CAM',
  'civil architecture': 'CAD/CAM', architecture: 'CAD/CAM', 'digital marketing': 'Digital Marketing', 'graphic designing': 'Graphic Designing',
  computer: 'Basic & Accounting', 'cnc programming': 'CAD/CAM', automobile: 'CAD/CAM',
}
// an empty course type: guessed from words in the course name
const GUESS: [RegExp, string][] = [
  [/cad|civil|mechanical|revit|3ds|architect|staad|solid ?works|catia|electrical/i, 'cad/cam'], [/digital marketing|seo|smm/i, 'digital marketing'],
  [/graphic|photoshop|coreldraw|illustrator/i, 'graphic designing'], [/python|java|web|data|php|full stack|react|software|cse|\bit\b/i, 'it'],
  [/computer application|basic computer|tally|accounting|excel|office/i, 'computer application'],
]

// phpMyAdmin writes an empty value as NULL in a CSV export
const clean = (v: unknown) => { const t = String(v ?? '').trim(); return t.toUpperCase() === 'NULL' ? '' : t }
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
const rupees = (v: string) => { const n = Number(v.replace(/[,₹\s]/g, '')); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null }
const title = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s)
const phoneOf = (v: string) => { const p = normalizePhone(v); return p.length === 10 ? p : null }
/** The old row without what must not be copied (the plain-text password, the photo path). */
const isEmail = (v: string) => z.string().email().safeParse(v).success
const keep = (r: Row) => Object.fromEntries(Object.entries(r).filter(([k]) => !['passcode', 'password', 'image'].includes(k)))

async function each(tx: Tx, rep: OldReport, rows: Row[], keyOf: (r: Row, i: number) => string, fn: (r: Row) => Promise<'created' | 'skipped'>) {
  for (let i = 0; i < rows.length; i++) {
    await tx.execute(sql`savepoint old_row`)
    try { rep[await fn(rows[i])]++; await tx.execute(sql`release savepoint old_row`) }
    catch (e) {
      await tx.execute(sql`rollback to savepoint old_row`)
      const zod = (e as { issues?: { message: string; path: (string | number)[] }[] }).issues
      rep.rejects.push({ line: i + 2, key: keyOf(rows[i], i), reason: zod ? zod.map((z) => `${z.path.join('.')}: ${z.message}`).join('; ') : (e as { cause?: { message?: string } }).cause?.message ?? (e instanceof Error ? e.message : String(e)) })
    }
  }
}

async function branchOf(tx: Tx, actor: Actor) {
  const [b] = await tx.select({ id: branches.id, code: branches.code, regFormat: branches.regFormat }).from(branches).where(eq(branches.id, actor.branchId!))
  if (!b) throw new Error('Branch not found')
  return b
}

// ---- students ------------------------------------------------------------------------------------------

export async function importOldRegistrations(tx: Tx, actor: Actor, rows: Row[], deptMap: Record<string, string> = DEFAULT_DEPT_MAP): Promise<OldReport> {
  const rep: OldReport = { kind: 'old registrations', total: rows.length, created: 0, skipped: 0, rejects: [], notes: [] }
  const b = await branchOf(tx, actor)
  if (!b.regFormat) throw new Error('Set this branch\'s registration number format first (Branches → Registration numbers), e.g. TCD/4002/{n}: the old numbers are kept and new admissions carry on after them')
  const depts = new Map((await tx.select({ id: departments.id, name: departments.name }).from(departments)).map((d) => [d.name.toLowerCase(), d.id]))
  const cats = new Map((await tx.select({ id: courses.id, title: courses.title, dept: courses.departmentId }).from(courses)).map((c) => [c.title.toLowerCase(), c]))
  const map = Object.fromEntries(Object.entries({ ...DEFAULT_DEPT_MAP, ...deptMap }).map(([k, v]) => [k.toLowerCase(), v]))

  await each(tx, rep, rows, (r, i) => clean(r.regno) || `line ${i + 2}`, async (r) => {
    const regno = clean(r.regno), oldId = clean(r.id)
    if (!regno) throw new Error('regno is empty')
    if (regNumberOf(b.regFormat!, b.code, regno) === null) throw new Error(`${regno} is not in this branch's number format (${b.regFormat}): is it another branch's file?`)
    // already brought over (a re-run): the same old row
    const [done] = (await tx.execute(sql`select 1 from registrations where branch_id = ${b.id} and (legacy_data->>'id' = ${oldId} and legacy_data->>'regno' = ${regno})`)).rows
    if (oldId && done) return 'skipped'

    // the student: a record with this mobile is used only when it is the same person (same first name)
    const [first, ...rest] = title(clean(r.name)).split(/\s+/)
    if (!first) throw new Error('name is empty')
    const candidates = [phoneOf(clean(r.phone)), phoneOf(clean(r.whatsappno))].filter((x): x is string => !!x)
    if (!candidates.length) throw new Error(`no valid 10-digit mobile (phone "${clean(r.phone)}")`)
    let phone: string | null = null
    for (const p of candidates) {
      const [o] = (await tx.execute<{ first_name: string }>(sql`select first_name from persons where branch_id = ${b.id} and phone_norm = ${p}`)).rows
      if (!o || o.first_name.trim().toLowerCase() === first.toLowerCase()) { phone = p; break }
    }
    if (!phone) throw new Error(`mobile ${candidates.join(' / ')} is already used by another student here (a different name): give one of them their own number and run again`)

    const typ = clean(r.coursetype).toLowerCase() || (GUESS.find(([re]) => re.test(clean(r.course)))?.[1] ?? '')
    const course = cats.get(clean(r.course).toLowerCase())
    const deptName = typ ? map[typ] ?? typ : ''
    const departmentId = course?.dept ?? depts.get(deptName.toLowerCase())
    if (!departmentId) throw new Error(`no department for course type "${clean(r.coursetype) || '(empty)'}"${deptName ? ` (looked for "${deptName}")` : ''}: add it with --map or create the department`)
    // the old entry date is sometimes after the joining date: the earlier of the two is the enrolment date
    const days = [clean(r.date), clean(r.j_date)].filter(isDay).sort()
    const enrolled = days[0] ?? null
    if (!enrolled) throw new Error(`date "${clean(r.date)}" is not a date (yyyy-mm-dd)`)
    const joining = isDay(clean(r.j_date)) ? clean(r.j_date) : null
    // no total fee written in the old record: what was paid stands for it (noted); neither: refused
    let total = rupees(clean(r.total_fee)) || rupees(clean(r.fee)) || null
    if (!total) {
      total = rupees(clean(r.paid)) || null
      if (!total) throw new Error('no total fee and nothing paid in the old record: give the fee and run again')
      rep.notes.push(`${regno}: no total fee in the old record, the amount paid (${clean(r.paid)}) is used`)
    }
    const dob = isDay(clean(r.dob)) ? clean(r.dob) : null
    const email = isEmail(clean(r.email)) ? clean(r.email) : null // a malformed e-mail is left out, not a reason to refuse
    const alt = phoneOf(clean(r.whatsappno)), guardian = phoneOf(clean(r.parents))

    const reg = await createRegistration(tx, actor, {
      person: { firstName: first, lastName: rest.join(' ') || undefined, phone, email },
      profile: { fatherName: title(clean(r.f_name)) || null, dob, email, altPhone: alt && alt !== phone ? alt : null, guardianPhone: guardian, address: clean(r.address) || null },
      departmentId, courseId: course?.id ?? null, enrollmentDate: enrolled, joiningDate: joining,
      totalFee: total,
    }, { quiet: true })
    // the old number: as it was; an old number used twice (the old system allowed it) gets -2, -3 ... and a note
    let no = regno
    for (let k = 2; (await tx.execute(sql`select 1 from registrations where reg_no = ${no} and id <> ${reg.id}`)).rows.length; k++) no = `${regno}-${k}`
    if (no !== regno) rep.notes.push(`${regno} was used twice in the old system: ${title(clean(r.name))} is ${no}`)
    await tx.update(registrations).set({
      regNo: no, legacyRegNo: no, legacyData: keep(r), createdAt: new Date(enrolled + 'T09:00:00+05:30'),
      ...(course ? {} : { customCourseTitle: clean(r.course).slice(0, 120) || null }),
    }).where(eq(registrations.id, reg.id))
    // finished in the old system (certificate given) or discontinued there
    const status = /discontinu|^yes$|^1$/i.test(clean(r.discontinue)) ? 'discontinued' : /deliver/i.test(clean(r.certi_delver)) ? 'completed' : null
    if (status) {
      await tx.update(registrations).set({ status }).where(eq(registrations.id, reg.id))
      await tx.insert(registrationEvents).values({ registrationId: reg.id, branchId: b.id, byUser: actor.userId, fromStatus: 'active', toStatus: status, note: status === 'completed' ? 'Imported: certificate delivered in the old system' : 'Imported: discontinued in the old system' })
    }
    return 'created'
  })
  // new admissions carry on after the highest number brought over
  const c = await setRegCounter(tx, b.id, b.code, null)
  rep.notes.push(`Next new admission: number ${c.next} (highest brought over: ${c.highest})`)
  return rep
}

// ---- payments --------------------------------------------------------------------------------------------

export async function importOldFees(tx: Tx, actor: Actor, rows: Row[]): Promise<OldReport> {
  const rep: OldReport = { kind: 'old fees', total: rows.length, created: 0, skipped: 0, rejects: [], notes: [] }
  const b = await branchOf(tx, actor)
  const regs = new Map((await tx.execute<{ id: string; reg_no: string; legacy_reg_no: string | null }>(sql`
    select id, reg_no, legacy_reg_no from registrations where branch_id = ${b.id}`)).rows.flatMap((r) => [[r.reg_no, r.id], ...(r.legacy_reg_no ? [[r.legacy_reg_no, r.id]] : [])] as [string, string][]))
  let zero = 0
  const touched = new Set<string>()
  // the fee table is shared by every branch: only this branch's students (brought over) are taken
  const all = rows.filter((r) => regs.has(clean(r.regno)))
  const otherBranch = rows.length - all.length
  rep.skipped += otherBranch
  // the old system sometimes saved one payment several times (same receipt no., student, amount and day): taken once
  const seen = new Set<string>(), sameDay = new Map<string, string[]>()
  let repeated = 0
  const mine = all.filter((r) => {
    const recep = clean(r.recep)
    const key = `${clean(r.regno)}|${recep}|${clean(r.paid)}|${clean(r.feedate)}`
    if (recep && seen.has(key)) { repeated++; return false }
    seen.add(key)
    const day = `${clean(r.regno)}|${clean(r.paid)}|${clean(r.feedate)}`
    if (rupees(clean(r.paid))) sameDay.set(day, [...(sameDay.get(day) ?? []), recep || `id ${clean(r.id)}`])
    return true
  })
  rep.skipped += repeated
  if (repeated) rep.notes.push(`${repeated} payment rows were the same receipt saved again in the old system: taken once`)
  // two different receipts for the same amount on the same day: kept (they may be real), listed to be checked
  for (const [k, receipts] of sameDay) if (receipts.length > 1) {
    const [regno, paid, day] = k.split('|')
    rep.notes.push(`${regno}: check — receipts ${receipts.join(', ')} are the same amount (${paid}) on the same day (${day}); both are counted`)
  }

  await each(tx, rep, mine, (r, i) => clean(r.recep) || clean(r.id) || `line ${i + 2}`, async (r) => {
    const regId = regs.get(clean(r.regno))!
    const amount = rupees(clean(r.paid))
    if (!amount) { zero++; return 'skipped' }
    const oldId = clean(r.id) || null
    if (oldId && (await tx.execute(sql`select 1 from legacy_payments where branch_id = ${b.id} and old_id = ${oldId}`)).rows.length) return 'skipped'
    const day = isDay(clean(r.feedate)) ? clean(r.feedate) : isDay(clean(r.cdate)) ? clean(r.cdate) : null
    if (!day) throw new Error(`feedate "${clean(r.feedate)}" is not a date (yyyy-mm-dd)`)
    const mode = clean(r.status) || null, receipt = clean(r.recep) || null
    await tx.execute(sql`insert into legacy_payments (branch_id, registration_id, paid_on, amount, mode, receipt_no, book_no, note, old_id, raw, imported_by)
      values (${b.id}, ${regId}, ${day}, ${amount}, ${mode}, ${receipt}, ${clean(r.bookno) || null}, ${clean(r.message) || null}, ${oldId}, ${JSON.stringify(keep(r))}::jsonb, ${actor.userId})`)
    await tx.execute(sql`insert into fee_ledger (branch_id, registration_id, entry_type, amount, note, created_by)
      values (${b.id}, ${regId}, 'adjustment', ${-amount}, ${`Paid in the old system${receipt ? `, receipt ${receipt}` : ''}, ${day}${mode ? ` (${mode})` : ''}`}, ${actor.userId})`)
    touched.add(regId)
    return 'created'
  })
  if (otherBranch) rep.notes.push(`${otherBranch} payments are of other branches' students (or students not brought over yet): left out`)
  if (zero) rep.notes.push(`${zero} rows with nothing paid: left out`)
  // the check: what the old student record says was paid, against the payments brought over
  if (touched.size) {
    const ids = sql.join([...touched].map((x) => sql`${x}::uuid`), sql`, `)
    const diff = (await tx.execute<{ reg_no: string; old_paid: string | null; brought: number; balance: number }>(sql`
      select r.reg_no, r.legacy_data->>'paid' as old_paid, coalesce((select sum(amount) from legacy_payments l where l.registration_id = r.id), 0)::bigint as brought, fb.balance::bigint as balance
      from registrations r join v_fee_balance fb on fb.registration_id = r.id where r.id in (${ids})`)).rows
    for (const d of diff) {
      const old = d.old_paid != null && d.old_paid !== '' ? rupees(d.old_paid) : null
      if (old !== null && old !== Number(d.brought)) rep.notes.push(`${d.reg_no}: the old record says ₹${(old / 100).toLocaleString('en-IN')} paid, the payments brought over add up to ₹${(Number(d.brought) / 100).toLocaleString('en-IN')}`)
      if (Number(d.balance) < 0) rep.notes.push(`${d.reg_no}: paid ₹${(-Number(d.balance) / 100).toLocaleString('en-IN')} more than the total fee`)
    }
  }
  return rep
}
