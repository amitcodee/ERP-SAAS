// Inter-branch transfers. The branch a student leaves asks (a manager: registration approve), with a reason; the
// branch they go to accepts (whoever admits students there) or turns it down; the old branch may cancel while it
// waits. Until it is accepted nothing moves and the old branch keeps the student.
// On acceptance, in one transaction on the server's own connection (two branches' rows are touched):
//   - the new branch gets the person (the one it already has with that mobile, or a copy), their occupation and
//     their documents (photo, ID; not payment proofs), and the student's login moves there (signed out once);
//   - a new registration there: same course, dates and letters, the same total fees, with what was already paid
//     and discounted in the old branch written in as such, so the balance carries over exactly; the coming
//     installments move with it;
//   - the old registration becomes TRANSFERRED: its balance is moved out by an adjustment, its coming installments
//     are cancelled and it leaves its batches. Its payments, receipts and attendance stay where they were made.
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { assertCan, can } from '@/lib/auth/permissions'
import { withOrgSystem, type Actor, type Tx } from '@/lib/db/withTenant'
import { nextRegNo } from '@/lib/numbering'

export type TransferRow = {
  id: string; status: 'pending' | 'accepted' | 'rejected' | 'cancelled'; direction: 'out' | 'in' | 'both'
  fromBranch: string; toBranch: string; fromRegistrationId: string; fromRegNo: string; toRegistrationId: string | null; toRegNo: string | null
  name: string; phone: string; course: string | null; reason: string; balance: number
  requestedBy: string | null; requestedAt: string; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null
}

const uuid = z.string().uuid()
export const mayRequestTransfer = (a: Actor) => can(a, 'approve', 'registration')
export const mayAcceptTransfer = (a: Actor) => can(a, 'create', 'registration')

/** The old branch asks to move a student to another branch. */
export async function requestTransfer(tx: Tx, actor: Actor, raw: { registrationId: string; toBranchId: string; reason: string }) {
  assertCan(actor, 'approve', 'registration')
  const v = z.object({ registrationId: uuid, toBranchId: uuid, reason: z.string().trim().min(5, 'Say why the student is moving (a few words)').max(500) }).parse(raw)
  const [r] = (await tx.execute<{ id: string; branch_id: string; status: string; reg_no: string; balance: number }>(sql`
    select r.id, r.branch_id, r.status::text as status, r.reg_no, coalesce(b.balance, 0)::int as balance
    from registrations r left join v_fee_balance b on b.registration_id = r.id where r.id = ${v.registrationId} for update of r`)).rows
  if (!r) throw new Error('Registration not found')
  if (r.status !== 'active' && r.status !== 'on_hold') throw new Error(`A ${r.status.replace('_', ' ')} registration cannot be transferred`)
  if (r.branch_id === v.toBranchId) throw new Error('The student is already in that branch')
  const [open] = (await tx.execute(sql`select 1 from registration_transfers where from_registration_id = ${r.id} and status = 'pending'`)).rows
  if (open) throw new Error('A transfer for this student is already waiting')
  const [t] = (await tx.execute<{ id: string }>(sql`
    insert into registration_transfers (from_registration_id, from_branch_id, to_branch_id, reason, balance_at_request, requested_by)
    values (${r.id}, ${r.branch_id}, ${v.toBranchId}, ${v.reason}, ${r.balance}, ${actor.userId}) returning id`)).rows
  await audit(tx, actor, { action: 'request_transfer', entity: 'registration', entityId: r.id, after: { transferId: t.id, toBranchId: v.toBranchId, reason: v.reason } })
  return t
}

/** The branch to move to must exist and be open (branches are read across, so on the server's own connection). */
export async function assertTransferBranch(orgId: string, toBranchId: string) {
  const [b] = await withOrgSystem(orgId, async (sys) => (await sys.execute<{ status: string }>(sql`select status from branches where id = ${uuid.parse(toBranchId)}`)).rows)
  if (!b) throw new Error('Choose the branch to transfer to')
  if (b.status !== 'active') throw new Error('That branch is not active')
}

/** The branches a student can be moved to: every open branch but this one. */
export const transferTargets = (actor: Actor) => withOrgSystem(actor.orgId, async (sys) => (await sys.execute<{ id: string; name: string }>(sql`
  select id, name from branches where status = 'active' ${actor.branchId ? sql`and id <> ${actor.branchId}` : sql``} order by name`)).rows)

/** The old branch takes its request back while it waits. */
export async function cancelTransfer(tx: Tx, actor: Actor, transferId: string) {
  assertCan(actor, 'approve', 'registration')
  const [t] = (await tx.execute<{ status: string; from_branch_id: string }>(sql`select status, from_branch_id from registration_transfers where id = ${uuid.parse(transferId)} for update`)).rows
  if (!t) throw new Error('Transfer not found')
  if (actor.branchId && t.from_branch_id !== actor.branchId) throw new Error('Only the branch the student is leaving can cancel')
  if (t.status !== 'pending') throw new Error(`This transfer is already ${t.status}`)
  await tx.execute(sql`update registration_transfers set status = 'cancelled', decided_by = ${actor.userId}, decided_at = now() where id = ${transferId}`)
  await audit(tx, actor, { action: 'cancel_transfer', entity: 'registration_transfer', entityId: transferId })
}

/** The new branch turns it down, saying why; the student stays where they are. */
export async function rejectTransfer(tx: Tx, actor: Actor, transferId: string, note: string) {
  if (!mayAcceptTransfer(actor)) throw new Error('Forbidden: decide transfers')
  const why = z.string().trim().min(3, 'Say why the transfer is turned down').max(500).parse(note)
  const [t] = (await tx.execute<{ status: string; to_branch_id: string }>(sql`select status, to_branch_id from registration_transfers where id = ${uuid.parse(transferId)} for update`)).rows
  if (!t) throw new Error('Transfer not found')
  if (actor.branchId && t.to_branch_id !== actor.branchId) throw new Error('Only the branch the student is moving to can decide')
  if (t.status !== 'pending') throw new Error(`This transfer is already ${t.status}`)
  await tx.execute(sql`update registration_transfers set status = 'rejected', decided_by = ${actor.userId}, decided_at = now(), decision_note = ${why} where id = ${transferId}`)
  await audit(tx, actor, { action: 'reject_transfer', entity: 'registration_transfer', entityId: transferId, after: { note: why } })
}

/** The new branch accepts: the student, their fees and their login move (see the top of this file). */
export const acceptTransfer = (actor: Actor, transferId: string, note: string | null, opts: AcceptOpts = {}) => withOrgSystem(actor.orgId, (tx) => acceptTransferIn(tx, actor, transferId, note, opts))

// ---- who the student is in the new branch -----------------------------------------------------------
// A branch keeps one record per mobile number, and a family often shares one. So the record the new branch already has
// with the student's mobile is used only when it is clearly the same person: the same name and the same date of birth or
// e-mail (with nothing that contradicts it). Unsure (same name, nothing else to compare): the accepting branch is shown
// both and must confirm. Someone else (another name, another date of birth / e-mail), or a record with its own login:
// the transfer is refused until the mobile is corrected on one of the records.
type PersonFacts = { name: string; dob: string | null; email: string | null; hasLogin: boolean }
export type PersonMatch =
  | { kind: 'none' } // no record with this mobile: a new one is made
  | { kind: 'same' | 'maybe' | 'other' | 'login'; existing: PersonFacts & { id: string }; student: PersonFacts; why: string }
export type AcceptOpts = { samePerson?: boolean }

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const dayOf = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))

async function matchPerson(tx: Tx, oldPersonId: string, toBranch: string): Promise<PersonMatch & { studentUser?: string | null; existingUser?: string | null }> {
  const pick = sql`id, trim(first_name || ' ' || coalesce(last_name, '')) as name, first_name, dob, email, user_id, phone_norm`
  const [p] = (await tx.execute<Record<string, unknown>>(sql`select ${pick} from persons where id = ${oldPersonId}`)).rows
  const [e] = (await tx.execute<Record<string, unknown>>(sql`select ${pick} from persons where branch_id = ${toBranch} and phone_norm = ${p.phone_norm as string} and deleted_at is null`)).rows
  if (!e) return { kind: 'none', studentUser: (p.user_id as string) ?? null }
  const facts = (r: Record<string, unknown>): PersonFacts => ({ name: String(r.name), dob: dayOf(r.dob), email: (r.email as string) || null, hasLogin: !!r.user_id })
  const student = facts(p), existing = { id: String(e.id), ...facts(e) }
  const base = { existing, student, studentUser: (p.user_id as string) ?? null, existingUser: (e.user_id as string) ?? null }
  const dobDiffers = !!(student.dob && existing.dob && student.dob !== existing.dob)
  const emailDiffers = !!(student.email && existing.email && norm(student.email) !== norm(existing.email))
  const sameName = norm(student.name) === norm(existing.name)
  const sameFirst = norm(p.first_name) === norm(e.first_name)
  const proof = (student.dob && student.dob === existing.dob) || (student.email && norm(student.email) === norm(existing.email))
  if (!sameFirst || dobDiffers || emailDiffers)
    return { kind: 'other', ...base, why: !sameFirst ? 'the name is different' : dobDiffers ? 'the date of birth is different' : 'the e-mail is different' }
  if (e.user_id && e.user_id !== p.user_id) return { kind: 'login', ...base, why: 'that record already has its own student login' }
  if (sameName && proof) return { kind: 'same', ...base, why: student.dob && student.dob === existing.dob ? 'same name and date of birth' : 'same name and e-mail' }
  return { kind: 'maybe', ...base, why: sameName ? 'same name, but no date of birth or e-mail to compare' : 'the same first name, but the full name differs' }
}

const refusal = (m: Exclude<PersonMatch, { kind: 'none' }>) =>
  `In the new branch, this mobile is already on the record of ${m.existing.name}${m.existing.dob ? ` (born ${m.existing.dob})` : ''}, and ${m.why}. ` +
  (m.kind === 'login'
    ? 'Two student logins cannot be joined: ask head office to sort the two records out first.'
    : `Correct the mobile on ${m.existing.name}'s record or on ${m.student.name}'s, then accept.`)

/** What accepting would do with the student's record (shown to the accepting branch before it accepts). */
export async function transferPersonCheck(actor: Actor, transferId: string): Promise<PersonMatch> {
  if (!mayAcceptTransfer(actor)) throw new Error('Forbidden: decide transfers')
  return withOrgSystem(actor.orgId, async (tx) => {
    const [t] = (await tx.execute<{ to_branch_id: string; person_id: string }>(sql`
      select t.to_branch_id, r.person_id from registration_transfers t join registrations r on r.id = t.from_registration_id where t.id = ${uuid.parse(transferId)}`)).rows
    if (!t) throw new Error('Transfer not found')
    if (actor.branchId ? t.to_branch_id !== actor.branchId : actor.role !== 'super_admin') throw new Error('Only the branch the student is moving to can accept')
    const { studentUser: _s, existingUser: _e, ...m } = await matchPerson(tx, t.person_id, t.to_branch_id)
    void _s; void _e
    return m
  })
}

/** The acceptance itself, on a connection that sees both branches. */
export async function acceptTransferIn(tx: Tx, actor: Actor, transferId: string, note: string | null, opts: AcceptOpts = {}) {
  if (!mayAcceptTransfer(actor)) throw new Error('Forbidden: decide transfers')
  const id = uuid.parse(transferId)
  {
    const [t] = (await tx.execute<{ status: string; from_registration_id: string; from_branch_id: string; to_branch_id: string }>(sql`
      select status, from_registration_id, from_branch_id, to_branch_id from registration_transfers where id = ${id} for update`)).rows
    if (!t) throw new Error('Transfer not found')
    if (actor.branchId ? t.to_branch_id !== actor.branchId : actor.role !== 'super_admin') throw new Error('Only the branch the student is moving to can accept')
    if (t.status !== 'pending') throw new Error(`This transfer is already ${t.status}`)
    const [r] = (await tx.execute<Record<string, never>>(sql`select * from registrations where id = ${t.from_registration_id} for update`)).rows as Record<string, unknown>[]
    if (!r) throw new Error('Registration not found')
    if (r.status !== 'active' && r.status !== 'on_hold') throw new Error(`The registration is ${String(r.status).replace('_', ' ')} now: it cannot be transferred`)
    const [bal] = (await tx.execute<{ charged: number; discounted: number; paid: number; balance: number }>(sql`select charged, discounted, paid, balance from v_fee_balance where registration_id = ${t.from_registration_id}`)).rows
    const [names] = (await tx.execute<{ from_name: string; to_code: string; to_name: string }>(sql`
      select f.name as from_name, b.code as to_code, b.name as to_name from branches f, branches b where f.id = ${t.from_branch_id} and b.id = ${t.to_branch_id}`)).rows
    const to = t.to_branch_id, oldPerson = r.person_id as string

    // the person in the new branch: the record it already has with this mobile only when it is the same student
    // (sure, or confirmed by the accepting branch); someone else's record, or one with its own login: refused
    const [p] = (await tx.execute<Record<string, unknown>>(sql`select * from persons where id = ${oldPerson}`)).rows
    const match = await matchPerson(tx, oldPerson, to)
    if (match.kind === 'other' || match.kind === 'login') throw new Error(refusal(match))
    if (match.kind === 'maybe' && !opts.samePerson) throw new Error(`Check the student first: ${match.existing.name} in this branch has the same mobile (${match.why}). If it is the same student, confirm it and accept again.`)
    let np = match.kind === 'none' ? undefined : { id: match.existing.id, user_id: match.existingUser ?? null }
    if (!np) {
      ;[np] = (await tx.execute<{ id: string; user_id: string | null }>(sql`
        insert into persons (branch_id, first_name, last_name, father_name, mother_name, gender, dob, phone, phone_norm, alt_phone, guardian_phone, email, address, aadhaar_no, aadhaar_last4)
        select ${to}, first_name, last_name, father_name, mother_name, gender, dob, phone, phone_norm, alt_phone, guardian_phone, email, address, aadhaar_no, aadhaar_last4 from persons where id = ${oldPerson}
        returning id, user_id`)).rows
      await tx.execute(sql`
        insert into person_occupations (person_id, branch_id, type_id, school_or_college, qualification, semester, job_role, company, skills, country)
        select ${np.id}, ${to}, type_id, school_or_college, qualification, semester, job_role, company, skills, country
        from person_occupations where person_id = ${oldPerson} order by valid_from desc limit 1`)
    }
    // the student's login follows them (and is signed out once, so it opens on the new branch)
    if (p.user_id && !np.user_id) {
      await tx.execute(sql`update persons set user_id = null where id = ${oldPerson}`)
      await tx.execute(sql`update persons set user_id = ${p.user_id as string} where id = ${np.id}`)
      await tx.execute(sql`update users set branch_id = ${to}, password_changed_at = now() where id = ${p.user_id as string}`)
    }

    // the new registration: same course and letters, the same total, with the old branch's payments written in
    const regNo = await nextRegNo(tx, to, names.to_code)
    const [nr] = (await tx.execute<{ id: string }>(sql`
      insert into registrations (reg_no, branch_id, person_id, kind, previous_registration_id, department_id, course_id, custom_course_title, custom_course, class_mode_id,
        enrollment_date, joining_date, class_minutes_per_day, class_days_per_week, class_start_time, course_hours, expected_end_date, total_fee, fee_plan, list_fee, course_fee, gst_amount,
        project_certificate, internship_offer, internship_completion, offer_template_id, completion_template_id, status, created_by)
      select ${regNo}, ${to}, ${np.id}, kind, id, department_id, course_id, custom_course_title, custom_course, class_mode_id,
        enrollment_date, joining_date, class_minutes_per_day, class_days_per_week, class_start_time, course_hours, expected_end_date, total_fee, fee_plan, list_fee, course_fee, gst_amount,
        project_certificate, internship_offer, internship_completion, offer_template_id, completion_template_id, 'active', ${actor.userId}
      from registrations where id = ${t.from_registration_id} returning id`)).rows
    const fromNo = r.reg_no as string
    const ledger = async (reg: string, branch: string, type: string, amount: number, note: string) => {
      if (amount) await tx.execute(sql`insert into fee_ledger (branch_id, registration_id, entry_type, amount, note, created_by) values (${branch}, ${reg}, ${type}::ledger_entry_type, ${amount}, ${note}, ${actor.userId})`)
    }
    // charged - discounted - paid = the old balance, to the paisa; the total fee is what was charged (the money check compares them)
    await ledger(nr.id, to, 'charge', bal.charged, `Total fees (transferred from ${names.from_name}, ${fromNo})`)
    await ledger(nr.id, to, 'discount', -bal.discounted, `Discount given at ${names.from_name} (${fromNo})`)
    await ledger(nr.id, to, 'adjustment', -bal.paid, `Paid at ${names.from_name} before the transfer (${fromNo})`)
    await tx.execute(sql`update registrations set total_fee = ${bal.charged - bal.discounted} where id = ${nr.id}`)
    // the classes held and attended at the old branch (and its approved capstone) count here: the new branch issues the certificate
    await tx.execute(sql`
      update registrations n set
        prior_sessions = o.prior_sessions + (select count(*) from attendance a where a.registration_id = o.id),
        prior_present = o.prior_present + (select count(*) filter (where a.present) from attendance a where a.registration_id = o.id),
        prior_capstone_ok = o.prior_capstone_ok or exists (select 1 from assessments x where x.registration_id = o.id and x.kind = 'capstone' and x.approved_at is not null)
      from registrations o where o.id = ${t.from_registration_id} and n.id = ${nr.id}`)
    await tx.execute(sql`insert into installments (branch_id, registration_id, due_date, amount) select ${to}, ${nr.id}, due_date, amount from installments where registration_id = ${t.from_registration_id} and status = 'scheduled'`)
    await tx.execute(sql`
      insert into registration_documents (branch_id, registration_id, kind, file_name, mime, size_bytes, sha256, data, uploaded_by, uploaded_at)
      select ${to}, ${nr.id}, kind, file_name, mime, size_bytes, sha256, data, uploaded_by, uploaded_at from registration_documents
      where registration_id = ${t.from_registration_id} and payment_id is null and kind not in ('payment_proof', 'payment_slip')`)
    await tx.execute(sql`insert into registration_events (registration_id, branch_id, by_user, from_status, to_status, note) values (${nr.id}, ${to}, ${actor.userId}, null, 'active', ${`Transferred from ${names.from_name} (${fromNo})`})`)

    // the old registration: balance moved out, installments cancelled, out of its batches, TRANSFERRED
    await ledger(t.from_registration_id, t.from_branch_id, 'transfer', -bal.balance, `Balance moved to ${names.to_name} on transfer (${regNo})`)
    await tx.execute(sql`update installments set status = 'cancelled' where registration_id = ${t.from_registration_id} and status = 'scheduled'`)
    await tx.execute(sql`delete from batch_members where registration_id = ${t.from_registration_id}`)
    await tx.execute(sql`update registrations set status = 'transferred', updated_at = now() where id = ${t.from_registration_id}`)
    await tx.execute(sql`update fee_change_requests set status = 'rejected', decided_by = ${actor.userId}, decided_at = now(), decision_note = ${`Closed: transferred to ${names.to_name}`}
      where registration_id = ${t.from_registration_id} and status = 'pending'`)
    await tx.execute(sql`insert into registration_events (registration_id, branch_id, by_user, from_status, to_status, note) values (${t.from_registration_id}, ${t.from_branch_id}, ${actor.userId}, ${r.status as string}::registration_status, 'transferred', ${`Transferred to ${names.to_name} (${regNo})`})`)

    await tx.execute(sql`update registration_transfers set status = 'accepted', to_registration_id = ${nr.id}, decided_by = ${actor.userId}, decided_at = now(), decision_note = ${note?.trim().slice(0, 500) || null} where id = ${id}`)
    await audit(tx, actor, { action: 'accept_transfer', entity: 'registration_transfer', entityId: id, after: { from: fromNo, to: regNo, balance: bal.balance, person: match.kind === 'none' ? 'new record' : `existing record (${match.kind === 'same' ? match.why : 'confirmed by the branch'})` } })
    return { regNo, registrationId: nr.id }
  }
}

/** Transfers out of and into the branch (head office: every branch, or the one picked). */
export async function listTransfers(tx: Tx, actor: Actor): Promise<TransferRow[]> {
  assertCan(actor, 'read', 'registration')
  const b = actor.branchId
  const rows = (await tx.execute<Record<string, never>>(sql`
    select t.id, t.status, t.from_branch_id, t.to_branch_id, t.from_registration_id, t.to_registration_id, t.reason, t.balance_at_request,
      t.requested_at, t.decided_at, t.decision_note, ru.name as requested_by, du.name as decided_by
    from registration_transfers t left join users ru on ru.id = t.requested_by left join users du on du.id = t.decided_by
    ${b ? sql`where t.from_branch_id = ${b} or t.to_branch_id = ${b}` : sql``}
    order by (t.status = 'pending') desc, t.requested_at desc limit 300`)).rows
  if (!rows.length) return []
  // the student, both registration numbers and both branch names, across the two branches: read for exactly these transfers
  const regIds = rows.flatMap((r) => [r.from_registration_id, r.to_registration_id]).filter(Boolean) as string[]
  const branchIds = [...new Set(rows.flatMap((r) => [r.from_branch_id, r.to_branch_id]) as string[])]
  const list = (ids: string[]) => sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `)
  const { regs, names } = await withOrgSystem(actor.orgId, async (sys) => ({
    regs: (await sys.execute<{ id: string; reg_no: string; name: string; phone: string; course: string | null }>(sql`
      select r.id, r.reg_no, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, p.phone, coalesce(c.title, r.custom_course_title) as course
      from registrations r join persons p on p.id = r.person_id left join courses c on c.id = r.course_id where r.id in (${list(regIds)})`)).rows,
    names: (await sys.execute<{ id: string; name: string }>(sql`select id, name from branches where id in (${list(branchIds)})`)).rows,
  }))
  const branchName = (id: string) => names.find((n) => n.id === id)?.name ?? 'Branch'
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)
  return rows.map((t) => {
    const from = regs.find((x) => x.id === t.from_registration_id), to = regs.find((x) => x.id === t.to_registration_id)
    return {
      id: t.id, status: t.status, direction: !b ? 'both' : t.from_branch_id === b ? 'out' : 'in',
      fromBranch: branchName(t.from_branch_id), toBranch: branchName(t.to_branch_id), fromRegistrationId: t.from_registration_id, fromRegNo: from?.reg_no ?? '—', toRegistrationId: t.to_registration_id, toRegNo: to?.reg_no ?? null,
      name: from?.name ?? 'Student', phone: from?.phone ?? '', course: from?.course ?? null, reason: t.reason, balance: t.balance_at_request,
      requestedBy: t.requested_by, requestedAt: iso(t.requested_at)!, decidedBy: t.decided_by, decidedAt: iso(t.decided_at), decisionNote: t.decision_note,
    }
  })
}
