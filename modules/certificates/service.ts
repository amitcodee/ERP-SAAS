// Certificate workflow. Eligibility is NOT stored: it is read from v_certificate_eligibility every time (P6).
import { emitCertificate } from '@/modules/integrations/webhooks'
import { and, eq, sql, type SQL } from 'drizzle-orm'
import { audit } from '@/lib/audit'
import { assertCan, can } from '@/lib/auth/permissions'
import { certHash, certHashMatches } from '@/lib/certificate-hash'
import { branches, certificateRequests, certificates, courses, departments, lookups, persons, registrations } from '@/lib/db/schema'
import { withOrgSystem, type Actor, type Tx } from '@/lib/db/withTenant'
import { nextCertNo } from '@/lib/numbering'
import { cleanSignature } from '@/lib/signature-clean'
import { authorisedSignatureInfo, getSignatureChoice, signatureImage } from '@/modules/catalog/categories'
import type { ListQuery } from '@/lib/list-query'
import { cleanQuery, inRange } from '@/lib/list-query-sql'
import { namedProject } from '@/lib/project-title'

const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN')

export type Eligibility = {
  registrationId: string
  eligible: boolean
  reasons: string[] // exact blockers shown to the student/staff
  feeBalance: number
  attendancePct: number
  minAttendancePct: number
  sessionsTotal: number
  capstoneOk: boolean
}

type EligibilityRow = { fee_balance: number; attendance_pct: number; min_attendance_pct: number; sessions_total: number; capstone_ok: boolean; registration_status: string }

/** The single definition of "what is blocking this certificate" (used by the detail check and the list). */
function eligibilityFrom(registrationId: string, r: EligibilityRow): Eligibility {
  const reasons: string[] = []
  if (r.registration_status !== 'active' && r.registration_status !== 'completed') reasons.push(`Registration is ${r.registration_status.replace('_', ' ')}`)
  if (r.fee_balance > 0) reasons.push(`Fees: ${inr(r.fee_balance)} pending`)
  if (r.sessions_total === 0) reasons.push('Attendance: no classes recorded yet')
  else if (r.attendance_pct < r.min_attendance_pct) reasons.push(`Attendance: ${r.attendance_pct}% (need ${r.min_attendance_pct}%)`)
  if (!r.capstone_ok) reasons.push('Capstone project: not approved by trainer')
  return {
    registrationId, eligible: reasons.length === 0, reasons, feeBalance: r.fee_balance, attendancePct: r.attendance_pct,
    minAttendancePct: r.min_attendance_pct, sessionsTotal: r.sessions_total, capstoneOk: r.capstone_ok,
  }
}

/** Head office and branch managers need no accounts step: when they request or issue, the fees are cleared by them. */
export const skipsAccounts = (a: Actor) => can(a, 'create', 'certificate') && can(a, 'clear', 'certificate')

export async function getEligibility(tx: Tx, registrationId: string): Promise<Eligibility> {
  const res = await tx.execute<EligibilityRow>(sql`select fee_balance, attendance_pct, min_attendance_pct, sessions_total, capstone_ok, registration_status
         from v_certificate_eligibility where registration_id = ${registrationId}`)
  if (!res.rows[0]) throw new Error('Registration not found')
  return eligibilityFrom(registrationId, res.rows[0])
}

export type CertWording = { course: string; tools: string[]; toolsLabel: 'Tools' | 'Modules' }

/**
 * What a certificate prints by default: the course's name and its tools (the course's skills list) — or, for a
 * customized course, its own title and its modules.
 */
export async function certificateWording(tx: Tx, registrationId: string): Promise<CertWording | null> {
  const [r] = (await tx.execute<{ course: string | null; custom_title: string | null; dept: string | null; skills: string | null; custom: { modules?: { name?: string }[] } | null }>(sql`
    select c.title as course, r.custom_course_title as custom_title, d.name as dept, c.skills, r.custom_course as custom
    from registrations r left join courses c on c.id = r.course_id left join departments d on d.id = r.department_id where r.id = ${registrationId}`)).rows
  if (!r) return null
  const modules = (r.custom?.modules ?? []).map((m) => m.name?.trim()).filter((x): x is string => !!x)
  if (r.custom_title || modules.length) return { course: r.custom_title ?? r.course ?? r.dept ?? 'Course', tools: modules, toolsLabel: 'Modules' }
  return { course: r.course ?? r.dept ?? 'Course', tools: splitTools(r.skills ?? ''), toolsLabel: 'Tools' }
}
/** "AutoCAD, Revit; 3ds Max" or one per line -> a clean list (at most 12, each 60 characters). */
export const splitTools = (s: string) => [...new Set(s.split(/[\n,;]+/).map((x) => x.trim().replace(/\s+/g, ' ').slice(0, 60)).filter(Boolean))].slice(0, 12)

/** A different name / tools for this certificate, asked for with the request (staff only; null = the course's own). */
export type CertWordingInput = { courseTitle?: string | null; tools?: string | string[] | null }

export async function requestCertificate(tx: Tx, actor: Actor, registrationId: string, wording?: CertWordingInput) {
  assertCan(actor, 'create', 'certificate')
  const [reg] = await tx.select().from(registrations).where(eq(registrations.id, registrationId))
  if (!reg) throw new Error('Registration not found')
  // a revoked certificate does not count: the student can be issued a new one
  const [issued] = await tx.select({ id: certificates.id }).from(certificates).where(and(eq(certificates.registrationId, registrationId), eq(certificates.isRevoked, false)))
  if (issued) throw new Error('A certificate has already been issued for this registration')
  const [open] = await tx.select({ id: certificateRequests.id }).from(certificateRequests).where(and(eq(certificateRequests.registrationId, registrationId), eq(certificateRequests.status, 'pending')))
  if (open) throw new Error('A request is already pending')
  const el = await getEligibility(tx, registrationId)
  // the wording only when it differs from the course's own (a student asking from the portal cannot change it)
  const def = await certificateWording(tx, registrationId)
  const title = actor.role !== 'student' ? wording?.courseTitle?.trim().replace(/\s+/g, ' ').slice(0, 150) || null : null
  const tools = actor.role !== 'student' && wording?.tools != null ? (Array.isArray(wording.tools) ? splitTools(wording.tools.join('\n')) : splitTools(wording.tools)) : null
  const certCourseTitle = title && title !== def?.course ? title : null
  const certTools = tools && tools.join('|') !== (def?.tools ?? []).join('|') ? tools : null
  const [req] = await tx
    .insert(certificateRequests)
    .values({ branchId: reg.branchId, registrationId, requestedBy: actor.userId, blockingReasons: el.reasons, certCourseTitle, certTools,
      // asked by head office or the branch manager with nothing due: no need to wait for accounts
      ...(skipsAccounts(actor) && el.feeBalance <= 0 ? { feeClearedBy: actor.userId, feeClearedAt: new Date() } : {}) })
    .returning()
  await audit(tx, actor, { action: 'request', entity: 'certificate_request', entityId: req.id, after: { eligible: el.eligible, reasons: el.reasons, feesCleared: !!req.feeClearedAt, courseTitle: certCourseTitle, tools: certTools } })
  return { request: req, eligibility: el }
}

/** Accounts step: confirms nothing is due on a pending request. Only then can the certificate be issued. */
export async function clearCertificateFees(tx: Tx, actor: Actor, requestId: string) {
  assertCan(actor, 'clear', 'certificate')
  const [req] = await tx.select().from(certificateRequests).where(eq(certificateRequests.id, requestId)).for('update')
  if (!req) throw new Error('Request not found')
  if (req.status !== 'pending') throw new Error(`Request is already ${req.status}`)
  if (req.feeClearedAt) throw new Error('Fees are already cleared for this request')
  const el = await getEligibility(tx, req.registrationId)
  if (el.feeBalance > 0) throw new Error(`Cannot clear: ${inr(el.feeBalance)} is still due`)
  await tx.update(certificateRequests).set({ feeClearedBy: actor.userId, feeClearedAt: new Date() }).where(eq(certificateRequests.id, req.id))
  await audit(tx, actor, { action: 'clear_fees', entity: 'certificate_request', entityId: req.id })
}

/** Whether this person may issue at a branch: a franchise that waits for head office takes head office (the database checks it too). */
export const issuesAt = (actor: Actor, b: { kind: string; hqCertificates: boolean } | undefined) => actor.role === 'super_admin' || !b || b.kind !== 'franchise' || !b.hqCertificates

/**
 * Issue (counselor / manager; at a franchise, head office unless it lets the centre issue). Needs the accounts clearance - except from head office or the branch manager, whose
 * issuing clears the fees too - and re-checks eligibility now: the request-time snapshot is not trusted.
 */
export async function approveCertificate(tx: Tx, actor: Actor, requestId: string) {
  assertCan(actor, 'approve', 'certificate')
  const [req] = await tx.select().from(certificateRequests).where(eq(certificateRequests.id, requestId)).for('update')
  if (!req) throw new Error('Request not found')
  if (req.status !== 'pending') throw new Error(`Request is already ${req.status}`)
  if (!req.feeClearedAt && !skipsAccounts(actor)) throw new Error('Accounts has not cleared the fees for this request yet')
  if (!issuesAt(actor, await tx.select({ kind: branches.kind, hqCertificates: branches.hqCertificates }).from(branches).where(eq(branches.id, req.branchId)).then((r) => r[0]))) throw new Error('Head office issues the certificates of a franchise centre: the request waits for them')
  const el = await getEligibility(tx, req.registrationId)
  if (!el.eligible) throw new Error(`Not eligible: ${el.reasons.join('; ')}`)
  if (!req.feeClearedAt) {
    await tx.update(certificateRequests).set({ feeClearedBy: actor.userId, feeClearedAt: new Date() }).where(eq(certificateRequests.id, req.id))
    await audit(tx, actor, { action: 'clear_fees', entity: 'certificate_request', entityId: req.id, after: { by: 'issuer' } })
  }

  const [branch] = await tx.select().from(branches).where(eq(branches.id, req.branchId))
  const certNo = await nextCertNo(tx, req.branchId, branch.certCode ?? branch.code) // the branch's certificate code (defaults to its branch code)
  const issuedAt = new Date()
  const [cert] = await tx
    .insert(certificates)
    .values({
      certNo, branchId: req.branchId, registrationId: req.registrationId, requestId: req.id, issuedAt, issuedBy: actor.userId, verificationHash: certHash(actor.orgId, certNo, req.registrationId, issuedAt),
      // the words it prints, frozen now: the request's own, else the course's
      ...(await (async () => {
        const def = await certificateWording(tx, req.registrationId)
        return { courseTitle: req.certCourseTitle ?? def?.course ?? null, tools: req.certTools ?? def?.tools ?? [], toolsLabel: req.certTools ? 'Tools' : def?.toolsLabel ?? 'Tools' }
      })()),
    })
    .returning()
  await tx.update(certificateRequests).set({ status: 'approved', decidedBy: actor.userId, decidedAt: new Date() }).where(eq(certificateRequests.id, req.id))
  await audit(tx, actor, { action: 'issue', entity: 'certificate', entityId: cert.id, after: { certNo } })
  await emitCertificate(tx, cert.id)
  return cert
}

export type BulkIssue = { issued: { requestId: string; certNo: string }[]; failed: { requestId: string; name: string; reason: string }[] }

/**
 * Issues several certificates at once (Issue Certificate → "Issue all ready", e.g. a whole batch): each request on its
 * own, with every check of a single issue; one that cannot be issued is listed with its reason and the rest go on.
 */
export async function issueCertificates(tx: Tx, actor: Actor, requestIds: string[]): Promise<BulkIssue> {
  assertCan(actor, 'approve', 'certificate')
  const ids = [...new Set(requestIds)]
  if (!ids.length) throw new Error('Nothing to issue')
  if (ids.length > 200) throw new Error('Issue at most 200 at a time')
  const out: BulkIssue = { issued: [], failed: [] }
  for (const id of ids) {
    await tx.execute(sql`savepoint bulk_issue`)
    try {
      const c = await approveCertificate(tx, actor, id)
      await tx.execute(sql`release savepoint bulk_issue`)
      out.issued.push({ requestId: id, certNo: c.certNo })
    } catch (e) {
      await tx.execute(sql`rollback to savepoint bulk_issue`)
      const [who] = (await tx.execute<{ name: string }>(sql`select trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name
        from certificate_requests q join registrations r on r.id = q.registration_id join persons p on p.id = r.person_id where q.id = ${id}`)).rows
      out.failed.push({ requestId: id, name: who?.name ?? 'Unknown request', reason: e instanceof Error ? e.message : String(e) })
    }
  }
  await audit(tx, actor, { action: 'issue_bulk', entity: 'certificate', entityId: out.issued[0]?.requestId ?? ids[0], after: { issued: out.issued.length, failed: out.failed.length } })
  return out
}

export async function rejectCertificate(tx: Tx, actor: Actor, requestId: string, reason: string) {
  assertCan(actor, 'approve', 'certificate')
  if (!reason.trim()) throw new Error('A reason is required')
  const [req] = await tx.select().from(certificateRequests).where(eq(certificateRequests.id, requestId)).for('update')
  if (!req) throw new Error('Request not found')
  if (req.status !== 'pending') throw new Error(`Request is already ${req.status}`)
  await tx.update(certificateRequests).set({ status: 'rejected', decidedBy: actor.userId, decidedAt: new Date(), rejectionReason: reason }).where(eq(certificateRequests.id, requestId))
  await audit(tx, actor, { action: 'reject', entity: 'certificate_request', entityId: requestId, after: { reason } })
}

/** Only head office revokes (the database checks it too). The certificate stays on record and its verify link says
 * REVOKED; the student no longer sees it, and the branch can request and issue a new one (a new number). */
export const mayRevokeCertificate = (actor: Actor) => can(actor, 'delete', 'certificate')
export async function revokeCertificate(tx: Tx, actor: Actor, certificateId: string, reason: string) {
  if (!mayRevokeCertificate(actor)) throw new Error('Only head office can revoke a certificate')
  const why = reason.trim()
  if (why.length < 3) throw new Error('A reason is required')
  const [old] = await tx.select().from(certificates).where(eq(certificates.id, certificateId)).for('update')
  if (!old) throw new Error('Certificate not found')
  if (old.isRevoked) throw new Error('This certificate is already revoked')
  const [c] = await tx.update(certificates).set({ isRevoked: true, revokedReason: why.slice(0, 500), revokedAt: new Date(), revokedBy: actor.userId }).where(eq(certificates.id, certificateId)).returning()
  await audit(tx, actor, { action: 'revoke', entity: 'certificate', entityId: c.id, after: { certNo: c.certNo, reason: c.revokedReason } })
  return c
}

export type CertOverviewRow = {
  registrationId: string; regNo: string; name: string; course: string
  eligibility: Eligibility
  requestId: string | null; requestStatus: string | null; feeCleared: boolean
  certificateId: string | null; certNo: string | null; verificationHash: string | null; revoked: boolean
  hasLogin: boolean; email: string | null
  joined: string; ends: string | null
  /** The student's documents: project certificate and internship letters only when the registration includes them. */
  projectCertificate: boolean
  internship: { offer: boolean; completion: boolean; offerIssued: boolean; completionIssued: boolean; completionRequested: boolean }
}

const CERT_FROM = sql`
    from registrations r
    join persons p on p.id = r.person_id
    join departments d on d.id = r.department_id
    left join courses c on c.id = r.course_id
    join v_certificate_eligibility e on e.registration_id = r.id
    left join lateral (select q.id, q.status, q.fee_cleared_at is not null as cleared from certificate_requests q where q.registration_id = r.id order by q.requested_at desc, (q.status = 'pending') desc limit 1) rq on true
    left join lateral (select x.* from certificates x where x.registration_id = r.id order by x.is_revoked, x.issued_at desc limit 1) ce on true
    left join lateral (select i.offer_issued_at, i.completed_at, i.status, i.wants_offer from internships i where i.registration_id = r.id and i.status <> 'cancelled' order by i.created_at desc limit 1) it on true`

const ELIGIBLE = sql`(e.registration_status in ('active', 'completed') and e.fee_balance <= 0 and e.sessions_total > 0 and e.attendance_pct >= e.min_attendance_pct and e.capstone_ok)`

const CERT_SORTS: Record<string, string> = {
  name: "lower(trim(p.first_name || ' ' || coalesce(p.last_name, '')))", reg: 'r.reg_no', attendance: 'e.attendance_pct',
  enrolled: 'r.enrollment_date', balance: 'e.fee_balance',
}

/**
 * One page of registrations with eligibility (from the view) + latest request + certificate. ONE query, however many students.
 * Filters (query.f): cert (eligible|blocked|pending|issued|revoked), status (registration), dept. Date range = enrolment date.
 * Sort: name, reg, attendance, enrolled, balance.
 */
export async function certificatePage(tx: Tx, actor: Actor, opts: { q?: string; limit?: number; offset?: number; query?: ListQuery } = {}): Promise<{ rows: CertOverviewRow[]; total: number }> {
  assertCan(actor, 'read', 'certificate')
  const c = cleanQuery({ ...opts.query, q: opts.query?.q ?? opts.q })
  // the branch's own students only: a student shared INTO this branch for some classes is not one of its registrations
  const parts = [sql`(app_branch() is null or r.branch_id = app_branch())`]
  if (c.like) parts.push(sql`(p.first_name ilike ${c.like} or p.last_name ilike ${c.like} or trim(p.first_name || ' ' || coalesce(p.last_name, '')) ilike ${c.like} or p.phone ilike ${c.like} or r.reg_no ilike ${c.like} or ce.cert_no ilike ${c.like})`)
  const cert = c.one(['eligible', 'blocked', 'pending', 'issued', 'revoked'] as const, 'cert')
  if (cert === 'issued') parts.push(sql`ce.id is not null and not ce.is_revoked`)
  if (cert === 'revoked') parts.push(sql`ce.is_revoked`)
  if (cert === 'pending') parts.push(sql`ce.id is null and rq.status = 'pending'`)
  if (cert === 'eligible') parts.push(sql`ce.id is null and ${ELIGIBLE}`)
  if (cert === 'blocked') parts.push(sql`ce.id is null and not ${ELIGIBLE}`)
  const status = c.one(['active', 'on_hold', 'discontinued', 'completed', 'transferred'] as const, 'status')
  if (status) parts.push(sql`r.status = ${status}`)
  if (c.id('dept')) parts.push(sql`r.department_id = ${c.id('dept')}`)
  const range = inRange(sql`r.enrollment_date`, c.from, c.to)
  if (range) parts.push(range)
  const where = sql.join(parts, sql` and `)
  const order = sql.raw(Object.hasOwn(CERT_SORTS, c.sort) ? `${CERT_SORTS[c.sort]} ${c.dir} nulls last, r.id` : 'r.created_at desc, r.id')
  const res = await tx.execute<EligibilityRow & {
    id: string; reg_no: string; name: string; course: string; req_id: string | null; req_status: string | null; req_cleared: boolean | null
    cert_id: string | null; cert_no: string | null; hash: string | null; revoked: boolean | null; user_id: string | null; email: string | null
    joined: string; ends: string | null; project_certificate: boolean; internship_offer: boolean; internship_completion: boolean
    offer_issued: boolean; completion_issued: boolean; completion_requested: boolean; has_intern: boolean; wants_offer: boolean | null
  }>(sql`
    select r.id, r.reg_no, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, coalesce(c.title, r.custom_course_title, d.name) as course,
      e.fee_balance, e.attendance_pct, e.min_attendance_pct, e.sessions_total, e.capstone_ok, e.registration_status,
      rq.id as req_id, rq.status as req_status, rq.cleared as req_cleared, ce.id as cert_id, ce.cert_no, ce.verification_hash as hash, ce.is_revoked as revoked,
      p.user_id, p.email, coalesce(r.joining_date, r.enrollment_date)::text as joined, r.expected_end_date::text as ends,
      r.project_certificate, r.internship_offer, r.internship_completion, it.status is not null as has_intern, it.wants_offer,
      it.offer_issued_at is not null as offer_issued, it.completed_at is not null as completion_issued, it.status = 'completion_requested' as completion_requested
    ${CERT_FROM}
    where ${where}
    order by ${order}
    limit ${opts.limit ?? 25} offset ${opts.offset ?? 0}`)
  // The count only needs the eligibility/request/certificate joins when a filter looks at them.
  const light = !cert && !c.like
  const [{ n }] = (await tx.execute<{ n: number }>(light
    ? sql`select count(*)::int as n from registrations r join persons p on p.id = r.person_id where ${where}`
    : sql`select count(*)::int as n ${CERT_FROM} where ${where}`)).rows
  return {
    total: n,
    rows: res.rows.map((r) => ({
      registrationId: r.id, regNo: r.reg_no, name: r.name, course: r.course, eligibility: eligibilityFrom(r.id, r),
      requestId: r.req_id, requestStatus: r.req_status, feeCleared: !!r.req_cleared, certificateId: r.cert_id, certNo: r.cert_no, verificationHash: r.hash, revoked: r.revoked ?? false,
      hasLogin: !!r.user_id, email: r.email, joined: r.joined, ends: r.ends, projectCertificate: !!r.project_certificate,
      internship: {
        offer: !!r.internship_offer || (!!r.has_intern && !!r.wants_offer), completion: !!r.internship_completion || !!r.has_intern,
        offerIssued: !!r.offer_issued, completionIssued: !!r.completion_issued, completionRequested: !!r.completion_requested,
      },
    })),
  }
}

/** Everything (no paging). Fine for a student's own portal and for tests; the staff screen uses certificatePage. */
export async function certificateOverview(tx: Tx, actor: Actor): Promise<CertOverviewRow[]> {
  return (await certificatePage(tx, actor, { limit: 100000 })).rows
}

/** The signatures a certificate carries: the course one per the head office choice; the project one only the category head. */
export type CertSignatures = {
  course: CertSigner[]
  project: CertSigner[]
  /** each signature on its own, for the course completion design (the authorised signatory and the department head) */
  authorisedImage: string | null; authorisedTitle: string | null; headImage: string | null
}
/** The authorised signatory is the MD: a plain "Authorised Signatory" (or none) prints as "Authorised Signatory (MD)". */
const mdTitle = (t: string) => (!t || /^authori[sz]ed signatory$/i.test(t) ? 'Authorised Signatory (MD)' : t)
export type CertSigner = { image: string | null; name: string | null; title: string }

export type Verification =
  | { found: false }
  | {
      found: true; revoked: boolean; certNo: string; name: string; course: string; branch: string; issuedAt: string; revokedReason: string | null
      // for the two certificate designs (course completion, and the project certificate when the registration includes one)
      projectCertificate: boolean; department: string; joined: string; ended: string | null; durationWeeks: number | null; hours: number | null; modules: string[]
      /** the heading of that list: 'Tools' or 'Modules' (a customized course) */
      toolsLabel: string
      /** the capstone project as the trainer approved it (for the project certificate); title null while unnamed */
      project: { title: string | null; tools: string[] } | null
      signatures: CertSignatures
      /** for the course completion design: who the student is, how they studied, and the two signatures */
      sheet: {
        father: string | null; gender: string | null; regNo: string; mode: string | null; serial: string
        authorised: { image: string | null; title: string }; head: { image: string | null; title: string }
      }
    }

/**
 * The public "Verify a certificate" page (/verify): the certificate a number belongs to — a certificate number, the
 * student's registration number (new or old system), or a seminar / workshop certificate number (EV-…). Returns where its
 * verification page is, or null. Only issued certificates are found: a registration with none gives the same null as a
 * number that does not exist, so the page tells nobody which students exist.
 * Typed without its dashes / slashes (REG2026TST400001 for REG-2026-TST40-0001) it is still found, but only when exactly
 * one student's number matches that way: a loosely typed number never opens someone else's certificate.
 */
export async function findCertificateByNumber(orgId: string, raw: string): Promise<{ href: string } | null> {
  const q = raw.trim().replace(/\s+/g, '').toUpperCase().slice(0, 60)
  const bare = q.replace(/[^A-Z0-9]/g, '') // the number's letters and digits only
  if (bare.length < 3) return null
  const loose = (col: SQL) => sql`regexp_replace(upper(${col}), '[^A-Z0-9]', '', 'g')`
  return withOrgSystem(orgId, async (tx) => {
    // an event certificate (its number has the org's own format, so look at those first)
    const ev = (await tx.execute<{ hash: string }>(sql`select hash from event_participants where cert_no is not null and (upper(cert_no) = ${q} or ${loose(sql`cert_no`)} = ${bare}) limit 2`)).rows
    if (ev.length === 1) return { href: `/e/c/${ev[0].hash}` }
    // the newest certificate that stands, else the newest (a revoked one is shown as revoked)
    const pick = (where: SQL) => tx.execute<{ hash: string; reg: string }>(sql`
      select ce.verification_hash as hash, r.id as reg from certificates ce join registrations r on r.id = ce.registration_id
      where ${where} order by ce.is_revoked, ce.issued_at desc limit 20`)
    const exact = (await pick(sql`upper(ce.cert_no) = ${q} or upper(replace(r.reg_no, ' ', '')) = ${q} or upper(replace(coalesce(r.legacy_reg_no, ''), ' ', '')) = ${q}`)).rows
    if (exact.length) return { href: `/verify/${exact[0].hash}` }
    const near = (await pick(sql`${loose(sql`ce.cert_no`)} = ${bare} or ${loose(sql`r.reg_no`)} = ${bare} or ${loose(sql`coalesce(r.legacy_reg_no, '')`)} = ${bare}`)).rows
    return near.length && new Set(near.map((x) => x.reg)).size === 1 ? { href: `/verify/${near[0].hash}` } : null
  })
}

/** Public check (no login). Looks up by hash, then re-derives the HMAC so a tampered row cannot pass. */
export const verifyCertificate = (orgId: string, hash: string): Promise<Verification> => withOrgSystem(orgId, (tx) => verifyCertificateIn(tx, hash))

export async function verifyCertificateIn(tx: Tx, hash: string): Promise<Verification> {
  if (!/^[0-9a-f]{64}$/.test(hash)) return { found: false }
  {
    const [c] = await tx.select().from(certificates).where(eq(certificates.verificationHash, hash))
    if (!c || !certHashMatches(c, hash)) return { found: false } as const
    const [row] = await tx
      .select({
        first: persons.firstName, last: persons.lastName, course: sql<string | null>`coalesce(${courses.title}, ${registrations.customCourseTitle})`, dept: departments.name, branch: branches.name,
        project: registrations.projectCertificate, joined: sql<string>`coalesce(${registrations.joiningDate}, ${registrations.enrollmentDate})::text`, ended: sql<string | null>`${registrations.expectedEndDate}::text`,
        weeks: sql<number | null>`coalesce(${courses.durationWeeks}, (${registrations.customCourse}->>'durationWeeks')::int)`, hours: registrations.courseHours, custom: registrations.customCourse,
        deptId: departments.id, headName: departments.headName,
        father: persons.fatherName, gender: persons.gender, regNo: registrations.regNo, mode: lookups.value,
      })
      .from(registrations)
      .innerJoin(persons, eq(persons.id, registrations.personId))
      .innerJoin(departments, eq(departments.id, registrations.departmentId))
      .innerJoin(branches, eq(branches.id, registrations.branchId))
      .leftJoin(courses, eq(courses.id, registrations.courseId))
      .leftJoin(lookups, eq(lookups.id, registrations.classModeId))
      .where(eq(registrations.id, c.registrationId))
    // the serial printed top left: TCD/<this certificate's place among the year's certificates, every branch>/<yy>
    const [{ n, yy }] = (await tx.execute<{ n: number; yy: string }>(sql`
      select count(*)::int as n, to_char(${c.issuedAt}::timestamptz at time zone 'Asia/Kolkata', 'YY') as yy from certificates x
      where date_trunc('year', x.issued_at at time zone 'Asia/Kolkata') = date_trunc('year', ${c.issuedAt}::timestamptz at time zone 'Asia/Kolkata')
        and (x.issued_at, x.id) <= (${c.issuedAt}::timestamptz, ${c.id}::uuid)`)).rows
    const signatures = await certSignatures(tx, row.deptId, row.dept, row.headName)
    // the tools / modules it lists: the ones kept with the certificate; when it was issued with none (the course had no
    // skills yet), the course's current skills, or the modules of a customized course
    const wording = c.tools?.length ? null : await certificateWording(tx, c.registrationId)
    const [cap] = (await tx.execute<{ title: string; tools: string | null }>(sql`
      select title, tools from assessments where registration_id = ${c.registrationId} and kind = 'capstone' and approved_at is not null
      order by approved_at desc limit 1`)).rows
    return {
      found: true, revoked: c.isRevoked, revokedReason: c.revokedReason, certNo: c.certNo,
      name: `${row.first} ${row.last ?? ''}`.trim(), course: c.courseTitle ?? row.course ?? row.dept, branch: row.branch, issuedAt: c.issuedAt.toISOString(),
      projectCertificate: row.project, department: row.dept, joined: row.joined, ended: row.ended, durationWeeks: row.weeks, hours: row.hours,
      modules: c.tools?.length ? c.tools : wording?.tools ?? [],
      toolsLabel: c.tools?.length ? c.toolsLabel ?? 'Tools' : wording?.toolsLabel ?? 'Tools',
      project: cap ? { title: namedProject(cap.title), tools: cap.tools ? cap.tools.split(',').map((t) => t.trim()).filter(Boolean) : [] } : null,
      signatures,
      sheet: {
        father: row.father, gender: row.gender, regNo: row.regNo, mode: row.mode, serial: `TCD/${n}/${yy}`,
        authorised: { image: signatures.authorisedImage, title: mdTitle((signatures.authorisedTitle ?? '').trim()) },
        head: { image: signatures.headImage, title: 'Head Department' },
      },
    } as const
  }
}

/** Who signs: the authorised signatory and/or the instructor (the head of the course's category), per Settings. */
async function certSignatures(tx: Tx, deptId: string, dept: string, headName: string | null): Promise<CertSignatures> {
  const choice = await getSignatureChoice(tx)
  const info = await authorisedSignatureInfo(tx)
  // the paper around a photographed signature is made transparent (lib/signature-clean.ts)
  const authorised: CertSigner = { image: cleanSignature(await signatureImage(tx, { authorised: true })), name: info?.name ?? null, title: info?.title || 'Authorised Signatory' }
  const instructor: CertSigner = { image: cleanSignature(await signatureImage(tx, { departmentId: deptId })), name: headName, title: `Instructor · ${dept}` }
  return {
    course: choice === 'authorised' ? [authorised] : choice === 'instructor' ? [instructor] : [authorised, instructor], project: [{ ...instructor, title: `Category Head · ${dept}` }],
    authorisedImage: authorised.image, authorisedTitle: info?.title ?? null, headImage: instructor.image,
  }
}
