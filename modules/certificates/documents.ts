// Documents: the certificate desk in two lists.
//   Certificate Requests: every student with their joining date, course and fees (clear or due), and where their
//     certificate request stands: not asked yet -> waiting for accounts -> approved by accounts -> issued (or rejected).
//   Issue Certificate: students whose course is complete and whose request accounts has approved, ready to issue;
//     and the certificates already issued.
// The steps themselves (request, accounts approval, issue) are the existing ones in ./service. RLS scopes the rows to
// the branch; head office sees every branch (or the one picked in the sidebar).
import { sql, type SQL } from 'drizzle-orm'
import { assertCan } from '@/lib/auth/permissions'
import type { Actor, Tx } from '@/lib/db/withTenant'

export type CertStage = 'none' | 'waiting' | 'approved' | 'rejected' | 'issued' | 'revoked'
export type CertDeskRow = {
  registrationId: string; regNo: string; name: string; phone: string; course: string; branch: string
  joined: string; expectedEnd: string | null; courseComplete: boolean; projectCertificate: boolean
  daysLeft: number | null // days until the course ends (0 or less = ended); null when no end date
  totalFee: number; paid: number; balance: number
  stage: CertStage
  requestId: string | null; requestedAt: string | null; requestedBy: string | null
  clearedAt: string | null; clearedBy: string | null; rejectionReason: string | null
  /** what the certificate will print instead of the course's own (asked for with the request); null = the course's */
  certCourseTitle: string | null; certTools: string[] | null
  certificateId: string | null; certNo: string | null; issuedAt: string | null; verificationHash: string | null
  /** the latest certificate was revoked (by head office): why, when, by whom */
  revoked: { reason: string | null; at: string | null; by: string | null } | null
  /** a franchise centre whose certificates head office issues */
  byHeadOffice: boolean
  blockers: string[] // what still stops the certificate being issued (fees, attendance, capstone, course not finished)
}
/** The batches whose students the desk can be narrowed to (newest first). */
export async function deskBatches(tx: Tx, branchId: string | null): Promise<{ id: string; name: string }[]> {
  return (await tx.execute<{ id: string; name: string }>(sql`
    select b.id, b.name || coalesce(' · ' || c.title, '') as name from batches b left join courses c on c.id = b.course_id
    where (${branchId}::uuid is null or b.branch_id = ${branchId}::uuid) and exists (select 1 from batch_members m where m.batch_id = b.id)
    order by b.created_at desc limit 200`)).rows
}
export type CertDesk = { rows: CertDeskRow[]; total: number; counts: Record<CertStage | 'due' | 'clear' | 'ready' | 'thisMonth' | 'nextMonth' | 'all', number> }

const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN')
const LIMIT = 300

export async function certificateDesk(tx: Tx, actor: Actor, q: { list: 'requests' | 'issue'; q?: string; stage?: string; fee?: string; period?: string; batch?: string; today: string; branchId: string | null }): Promise<CertDesk> {
  assertCan(actor, 'read', 'certificate')
  const b = q.branchId
  const term = q.q?.trim()
  const like = term ? `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null

  const stageSql = sql`(case
      when ce.id is not null and not ce.is_revoked then 'issued'
      -- revoked, and not asked for again since: still 'revoked' (asked again: the new request's step below)
      when ce.id is not null and (rq.id is null or rq.id = ce.request_id or (ce.request_id is null and rq.requested_at < ce.issued_at)) then 'revoked'
      when rq.status = 'rejected' then 'rejected'
      when rq.status = 'pending' and rq.fee_cleared_at is not null then 'approved'
      when rq.status = 'pending' then 'waiting'
      else 'none' end)`
  const complete = sql`(r.status = 'completed' or (r.expected_end_date is not null and r.expected_end_date <= ${q.today}::date))`
  const where: SQL[] = [
    sql`(${b}::uuid is null or r.branch_id = ${b}::uuid)`,
    sql`r.status in ('active', 'completed', 'on_hold')`,
  ]
  // one batch's students (a batch's certificates at once)
  if (q.batch && /^[0-9a-f-]{36}$/i.test(q.batch)) where.push(sql`exists (select 1 from batch_members bm where bm.registration_id = r.id and bm.batch_id = ${q.batch}::uuid)`)
  if (like) where.push(sql`(p.first_name || ' ' || coalesce(p.last_name, '') ilike ${like} or p.phone ilike ${like} or r.reg_no ilike ${like})`)
  if (q.list === 'issue') where.push(sql`(${stageSql} in ('issued', 'revoked') or (${stageSql} = 'approved' and ${complete}))`)
  // the course-completion tabs: courses ending this calendar month, next month, or all
  const thisMonth = sql`(r.expected_end_date >= date_trunc('month', ${q.today}::date) and r.expected_end_date < date_trunc('month', ${q.today}::date) + interval '1 month')`
  const nextMonth = sql`(r.expected_end_date >= date_trunc('month', ${q.today}::date) + interval '1 month' and r.expected_end_date < date_trunc('month', ${q.today}::date) + interval '2 months')`
  const all = sql.join(where, sql` and `)
  if (q.period === 'this') where.push(thisMonth)
  if (q.period === 'next') where.push(nextMonth)
  const base = sql.join(where, sql` and `)

  const filters: SQL[] = [base]
  if (q.stage && ['none', 'waiting', 'approved', 'rejected', 'issued', 'revoked'].includes(q.stage)) filters.push(sql`${stageSql} = ${q.stage}`)
  if (q.stage === 'ready') filters.push(sql`${stageSql} = 'approved' and ${complete}`)
  if (q.fee === 'due') filters.push(sql`coalesce(fb.balance, 0) > 0`)
  if (q.fee === 'clear') filters.push(sql`coalesce(fb.balance, 0) <= 0`)
  const filtered = sql.join(filters, sql` and `)

  const FROM = sql`
    from registrations r
    join persons p on p.id = r.person_id
    join branches br on br.id = r.branch_id
    left join courses co on co.id = r.course_id
    left join v_fee_balance fb on fb.registration_id = r.id
    left join v_certificate_eligibility el on el.registration_id = r.id
    left join lateral (select x.* from certificate_requests x where x.registration_id = r.id order by x.requested_at desc, (x.status = 'pending') desc limit 1) rq on true
    left join users rb on rb.id = rq.requested_by
    left join users cb on cb.id = rq.fee_cleared_by
    left join lateral (select x.* from certificates x where x.registration_id = r.id order by x.is_revoked, x.issued_at desc limit 1) ce on true
    left join users vb on vb.id = ce.revoked_by`

  const rows = (await tx.execute<Record<string, unknown>>(sql`
    select r.id, r.reg_no, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, p.phone, coalesce(co.title, r.custom_course_title, '—') as course, br.name as branch, (br.kind = 'franchise' and br.hq_certificates) as by_hq,
      coalesce(r.joining_date, r.enrollment_date)::text as joined, r.expected_end_date::text as expected_end, ${complete} as complete, r.project_certificate,
      r.total_fee, coalesce(fb.balance, 0)::bigint as balance, coalesce(fb.charged - fb.discounted - fb.balance, 0)::bigint as paid,
      (r.expected_end_date - ${q.today}::date) as days_left,
      ${stageSql} as stage, rq.id as request_id, rq.requested_at::text as requested_at, rb.name as requested_by,
      rq.fee_cleared_at::text as cleared_at, cb.name as cleared_by, rq.rejection_reason, rq.cert_course_title, rq.cert_tools,
      ce.id as certificate_id, ce.cert_no, ce.issued_at::text as issued_at, ce.verification_hash,
      ce.is_revoked, ce.revoked_reason, ce.revoked_at::text as revoked_at, vb.name as revoked_by,
      r.status::text as reg_status, el.sessions_total, el.attendance_pct, el.min_attendance_pct, el.capstone_ok
    ${FROM} where ${filtered}
    order by ${q.period ? sql`r.expected_end_date asc,` : sql``} coalesce(ce.issued_at, rq.requested_at, r.created_at) desc
    limit ${LIMIT}`)).rows

  const [c] = (await tx.execute<Record<string, number>>(sql`
    select count(*)::int as total,
      count(*) filter (where ${stageSql} = 'none')::int as none, count(*) filter (where ${stageSql} = 'waiting')::int as waiting,
      count(*) filter (where ${stageSql} = 'approved')::int as approved, count(*) filter (where ${stageSql} = 'rejected')::int as rejected,
      count(*) filter (where ${stageSql} = 'issued')::int as issued, count(*) filter (where ${stageSql} = 'revoked')::int as revoked,
      count(*) filter (where coalesce(fb.balance, 0) > 0)::int as due, count(*) filter (where coalesce(fb.balance, 0) <= 0)::int as clear,
      count(*) filter (where ${stageSql} = 'approved' and ${complete})::int as ready
    ${FROM} where ${base}`)).rows
  const [t] = (await tx.execute<Record<string, number>>(sql`
    select count(*)::int as all, count(*) filter (where ${thisMonth})::int as this_month, count(*) filter (where ${nextMonth})::int as next_month
    ${FROM} where ${all}`)).rows
  const num = (v: unknown) => Number(v ?? 0)

  return {
    total: num(c?.total),
    counts: { none: num(c?.none), waiting: num(c?.waiting), approved: num(c?.approved), rejected: num(c?.rejected), issued: num(c?.issued), revoked: num(c?.revoked), due: num(c?.due), clear: num(c?.clear), ready: num(c?.ready), thisMonth: num(t?.this_month), nextMonth: num(t?.next_month), all: num(t?.all) },
    rows: rows.map((r): CertDeskRow => {
      const balance = num(r.balance)
      const blockers: string[] = []
      if (!r.complete) blockers.push(r.expected_end ? `Course runs till ${new Date(`${r.expected_end}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Course end date not set')
      if (r.reg_status === 'on_hold') blockers.push('Registration is on hold')
      if (balance > 0) blockers.push(`Fees: ${inr(balance)} due`)
      if (!num(r.sessions_total)) blockers.push('Attendance: no classes recorded')
      else if (num(r.attendance_pct) < num(r.min_attendance_pct)) blockers.push(`Attendance ${num(r.attendance_pct)}% (needs ${num(r.min_attendance_pct)}%)`)
      if (!r.capstone_ok) blockers.push('Capstone project not approved by the trainer')
      return {
        registrationId: String(r.id), regNo: String(r.reg_no), name: String(r.name), phone: String(r.phone ?? ''), course: String(r.course), branch: String(r.branch),
        joined: String(r.joined), expectedEnd: (r.expected_end as string) ?? null, courseComplete: !!r.complete, projectCertificate: !!r.project_certificate,
        daysLeft: r.days_left == null ? null : num(r.days_left),
        totalFee: num(r.total_fee), paid: num(r.paid), balance,
        stage: r.stage as CertStage,
        requestId: (r.request_id as string) ?? null, requestedAt: (r.requested_at as string) ?? null, requestedBy: (r.requested_by as string) ?? null,
        clearedAt: (r.cleared_at as string) ?? null, clearedBy: (r.cleared_by as string) ?? null, rejectionReason: (r.rejection_reason as string) ?? null,
        certCourseTitle: (r.cert_course_title as string) ?? null, certTools: (r.cert_tools as string[]) ?? null,
        certificateId: (r.certificate_id as string) ?? null, certNo: (r.cert_no as string) ?? null, issuedAt: (r.issued_at as string) ?? null, verificationHash: (r.verification_hash as string) ?? null,
        revoked: r.is_revoked ? { reason: (r.revoked_reason as string) ?? null, at: (r.revoked_at as string) ?? null, by: (r.revoked_by as string) ?? null } : null,
        byHeadOffice: !!r.by_hq, blockers,
      }
    }),
  }
}
