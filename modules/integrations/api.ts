// Read-only data API for business tools (Power BI, Excel, Google Sheets, n8n, Metabase...).
//   GET /api/v1/<dataset>?from=YYYY-MM-DD&to=YYYY-MM-DD&branch=MOH&limit=1000&offset=0&format=json|csv
//   Authorization: Bearer tc_live_…   (or the header X-API-Key: tc_live_…)
// Keys are made in Settings → API access, each limited to some datasets and optionally one branch. Only a hash of
// the key is stored; the full key is shown once, when it is made.
import { clientIpFrom } from '@/lib/client-ip'
import { createHash, randomBytes } from 'crypto'
import { sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { withOrgSystem, type Tx } from '@/lib/db/withTenant'
import { underLimit } from '@/lib/redis'
import { assertModule, hasModule } from '@/lib/plan/limits'

type Dataset = {
  label: string; what: string; dateField: string
  fields: { key: string; about: string }[]
  query: (w: { from: string | null; to: string | null; branchId: string | null; limit: number; offset: number }) => SQL
}

const range = (col: SQL, from: string | null, to: string | null) => sql`${from ? sql`and ${col} >= ${from}::date` : sql``} ${to ? sql`and ${col} < ${to}::date + 1` : sql``}`
const branch = (col: SQL, id: string | null) => (id ? sql`and ${col} = ${id}::uuid` : sql``)
const NAME = sql`trim(p.first_name || ' ' || coalesce(p.last_name, ''))`

export const DATASETS: Record<string, Dataset> = {
  leads: {
    label: 'Leads and enquiries', what: 'Every lead: who, where it came from, what they asked about, and where it stands.', dateField: 'created_at',
    fields: [
      { key: 'enquiry_no', about: 'Lead number' }, { key: 'created_at', about: 'When added' }, { key: 'status', about: 'new, follow_up, joined, not_joined…' },
      { key: 'name', about: 'Name' }, { key: 'phone', about: 'Phone' }, { key: 'email', about: 'E-mail' }, { key: 'source', about: 'Where it came from' },
      { key: 'department', about: 'Course category' }, { key: 'course', about: 'Course' }, { key: 'branch', about: 'Branch code' }, { key: 'assigned_to', about: 'Telecaller' },
      { key: 'next_follow_up', about: 'Next follow-up date' }, { key: 'visited', about: 'Visited the branch' },
    ],
    query: (w) => sql`
      select e.enquiry_no, e.created_at, e.status::text as status, ${NAME} as name, p.phone, p.email, src.value as source, d.name as department, c.title as course,
        b.code as branch, u.name as assigned_to, e.next_follow_up, e.visited
      from enquiries e join persons p on p.id = e.person_id join branches b on b.id = e.branch_id left join lookups src on src.id = e.source_id
      left join departments d on d.id = e.department_id left join courses c on c.id = e.course_id left join users u on u.id = e.assigned_to
      where e.deleted_at is null ${range(sql`e.created_at`, w.from, w.to)} ${branch(sql`e.branch_id`, w.branchId)}
      order by e.created_at desc limit ${w.limit} offset ${w.offset}`,
  },
  registrations: {
    label: 'Registrations', what: 'Admissions with course, dates and fees (total, paid and balance, in rupees).', dateField: 'enrollment_date',
    fields: [
      { key: 'reg_no', about: 'Registration ID' }, { key: 'enrollment_date', about: 'Registered on' }, { key: 'joining_date', about: 'Classes start' }, { key: 'expected_end_date', about: 'Course ends' },
      { key: 'status', about: 'active, on_hold, discontinued, completed' }, { key: 'name', about: 'Student' }, { key: 'phone', about: 'Phone' }, { key: 'email', about: 'E-mail' },
      { key: 'department', about: 'Course category' }, { key: 'course', about: 'Course' }, { key: 'branch', about: 'Branch code' },
      { key: 'total_fee', about: 'Fees after discount (₹)' }, { key: 'paid', about: 'Paid (₹)' }, { key: 'balance', about: 'Still to pay (₹)' },
    ],
    query: (w) => sql`
      select r.reg_no, r.enrollment_date, r.joining_date, r.expected_end_date, r.status::text as status, ${NAME} as name, p.phone, p.email,
        d.name as department, coalesce(c.title, r.custom_course_title) as course, b.code as branch,
        round((coalesce(fb.charged, 0) - coalesce(fb.discounted, 0)) / 100.0, 2) as total_fee, round(coalesce(fb.paid, 0) / 100.0, 2) as paid, round(coalesce(fb.balance, 0) / 100.0, 2) as balance
      from registrations r join persons p on p.id = r.person_id join branches b on b.id = r.branch_id join departments d on d.id = r.department_id
      left join courses c on c.id = r.course_id left join v_fee_balance fb on fb.registration_id = r.id
      where r.deleted_at is null ${range(sql`r.enrollment_date`, w.from, w.to)} ${branch(sql`r.branch_id`, w.branchId)}
      order by r.enrollment_date desc, r.reg_no limit ${w.limit} offset ${w.offset}`,
  },
  payments: {
    label: 'Fee payments', what: 'Every payment with its receipt, amount (₹) and mode.', dateField: 'paid_at',
    fields: [
      { key: 'receipt_no', about: 'Receipt number' }, { key: 'paid_at', about: 'When paid' }, { key: 'amount', about: 'Amount (₹)' }, { key: 'mode', about: 'Cash, UPI, card…' },
      { key: 'txn_ref', about: 'Transaction reference' }, { key: 'reg_no', about: 'Registration ID' }, { key: 'name', about: 'Student' }, { key: 'branch', about: 'Branch code' },
    ],
    query: (w) => sql`
      select rc.receipt_no, pm.paid_at, round(pm.amount / 100.0, 2) as amount, m.value as mode, pm.txn_ref, r.reg_no, ${NAME} as name, b.code as branch
      from payments pm join registrations r on r.id = pm.registration_id join persons p on p.id = r.person_id join branches b on b.id = pm.branch_id
      left join receipts rc on rc.payment_id = pm.id left join lookups m on m.id = pm.mode_id
      where r.deleted_at is null ${range(sql`pm.paid_at`, w.from, w.to)} ${branch(sql`pm.branch_id`, w.branchId)}
      order by pm.paid_at desc limit ${w.limit} offset ${w.offset}`,
  },
  students: {
    label: 'Students', what: 'Each registered student with attendance and certificate status.', dateField: 'enrollment_date',
    fields: [
      { key: 'reg_no', about: 'Registration ID' }, { key: 'name', about: 'Student' }, { key: 'course', about: 'Course' }, { key: 'branch', about: 'Branch code' },
      { key: 'status', about: 'Registration status' }, { key: 'enrollment_date', about: 'Registered on' }, { key: 'attendance_pct', about: 'Attendance %' },
      { key: 'classes', about: 'Classes marked' }, { key: 'certificate_no', about: 'Certificate number (when issued)' }, { key: 'has_portal_login', about: 'Has a portal login' },
    ],
    query: (w) => sql`
      select r.reg_no, ${NAME} as name, coalesce(c.title, r.custom_course_title, d.name) as course, b.code as branch, r.status::text as status, r.enrollment_date,
        a.pct as attendance_pct, (select count(*)::int from attendance t where t.registration_id = r.id) as classes, ce.cert_no as certificate_no, p.user_id is not null as has_portal_login
      from registrations r join persons p on p.id = r.person_id join branches b on b.id = r.branch_id join departments d on d.id = r.department_id
      left join courses c on c.id = r.course_id left join v_attendance_pct a on a.registration_id = r.id left join certificates ce on ce.registration_id = r.id and not ce.is_revoked
      where r.deleted_at is null ${range(sql`r.enrollment_date`, w.from, w.to)} ${branch(sql`r.branch_id`, w.branchId)}
      order by r.enrollment_date desc, r.reg_no limit ${w.limit} offset ${w.offset}`,
  },
  attendance: {
    label: 'Attendance', what: 'One row per student per class, as marked by the trainer.', dateField: 'date',
    fields: [
      { key: 'date', about: 'Class date' }, { key: 'batch', about: 'Batch' }, { key: 'trainer', about: 'Trainer' }, { key: 'reg_no', about: 'Registration ID' },
      { key: 'name', about: 'Student' }, { key: 'present', about: 'true / false' }, { key: 'branch', about: 'Branch code' },
    ],
    query: (w) => sql`
      select s.session_date as date, bt.name as batch, u.name as trainer, r.reg_no, ${NAME} as name, a.present, b.code as branch
      from attendance a join class_sessions s on s.id = a.session_id join batches bt on bt.id = s.batch_id left join users u on u.id = bt.trainer_id
      join registrations r on r.id = a.registration_id join persons p on p.id = r.person_id join branches b on b.id = a.branch_id
      where r.deleted_at is null ${range(sql`s.session_date`, w.from, w.to)} ${branch(sql`a.branch_id`, w.branchId)}
      order by s.session_date desc, bt.name, r.reg_no limit ${w.limit} offset ${w.offset}`,
  },
  certificates: {
    label: 'Certificates', what: 'Issued course certificates.', dateField: 'issued_at',
    fields: [
      { key: 'cert_no', about: 'Certificate number' }, { key: 'issued_at', about: 'Issued on' }, { key: 'revoked', about: 'Revoked' }, { key: 'reg_no', about: 'Registration ID' },
      { key: 'name', about: 'Student' }, { key: 'course', about: 'Course' }, { key: 'branch', about: 'Branch code' },
    ],
    query: (w) => sql`
      select ce.cert_no, ce.issued_at, ce.is_revoked as revoked, r.reg_no, ${NAME} as name, coalesce(c.title, r.custom_course_title, d.name) as course, b.code as branch
      from certificates ce join registrations r on r.id = ce.registration_id join persons p on p.id = r.person_id join branches b on b.id = ce.branch_id
      join departments d on d.id = r.department_id left join courses c on c.id = r.course_id
      where r.deleted_at is null ${range(sql`ce.issued_at`, w.from, w.to)} ${branch(sql`ce.branch_id`, w.branchId)}
      order by ce.issued_at desc limit ${w.limit} offset ${w.offset}`,
  },
}
export type DatasetKey = keyof typeof DATASETS

// ---- keys

export type ApiKeyRow = { id: string; name: string; prefix: string; scopes: string[]; branch: string | null; createdAt: string; expiresAt: string | null; lastUsedAt: string | null; lastUsedIp: string | null; useCount: number; revokedAt: string | null }

const hash = (key: string) => createHash('sha256').update(key).digest('hex')

export async function listApiKeys(tx: Tx): Promise<ApiKeyRow[]> {
  const rows = (await tx.execute<Record<string, unknown>>(sql`
    select k.id, k.name, k.prefix, k.scopes, b.name as branch, k.created_at, k.expires_at, k.last_used_at, k.last_used_ip, k.use_count, k.revoked_at
    from api_keys k left join branches b on b.id = k.branch_id order by k.revoked_at is not null, k.created_at desc`)).rows
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)
  return rows.map((r) => ({
    id: String(r.id), name: String(r.name), prefix: String(r.prefix), scopes: r.scopes as string[], branch: (r.branch as string) ?? null, createdAt: iso(r.created_at)!,
    expiresAt: iso(r.expires_at), lastUsedAt: iso(r.last_used_at), lastUsedIp: (r.last_used_ip as string) ?? null, useCount: Number(r.use_count), revokedAt: iso(r.revoked_at),
  }))
}

const keyInput = z.object({
  name: z.string().trim().min(2, 'Give the key a name, e.g. “Power BI — head office”').max(80),
  scopes: z.array(z.string().refine((s) => s in DATASETS, 'Unknown dataset')).min(1, 'Pick at least one dataset'),
  branchId: z.string().uuid().nullable(),
  expiresInDays: z.number().int().min(0).max(3650),
})

/** Makes a key. The full key is returned only here: it cannot be shown again. */
export async function createApiKey(tx: Tx, userId: string, raw: z.input<typeof keyInput>) {
  await assertModule(tx, 'api', 'The read API')
  const v = keyInput.parse(raw)
  const key = `tc_live_${randomBytes(24).toString('base64url')}`
  await tx.execute(sql`
    insert into api_keys (name, prefix, key_hash, scopes, branch_id, created_by, expires_at)
    values (${v.name}, ${key.slice(0, 14)}, ${hash(key)}, ${`{${v.scopes.join(',')}}`}::text[], ${v.branchId}, ${userId},
      ${v.expiresInDays ? sql`now() + make_interval(days => ${v.expiresInDays})` : null})`)
  return key
}

export async function revokeApiKey(tx: Tx, id: string) {
  await tx.execute(sql`update api_keys set revoked_at = now() where id = ${z.string().uuid().parse(id)} and revoked_at is null`)
}

// ---- serving a request

export type ApiAnswer = { status: number; body: string; type: string }
const json = (status: number, v: unknown): ApiAnswer => ({ status, body: JSON.stringify(v), type: 'application/json; charset=utf-8' })
const isDay = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

export function toCsv(rows: Record<string, unknown>[], fields: string[]) {
  const cell = (v: unknown) => {
    let s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v)
    // a cell Excel / Sheets would run as a formula is shown as text instead (a plain number, e.g. -500, stays a number)
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [fields.join(','), ...rows.map((r) => fields.map((f) => cell(r[f])).join(','))].join('\r\n')
}

/** Checks the key (one of THIS org's: the org is the address the request came to), then answers one dataset request. */
export async function serveApi(orgId: string, datasetKey: string, req: Request): Promise<ApiAnswer> {
  const auth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || req.headers.get('x-api-key') || ''
  if (!auth.startsWith('tc_live_')) return json(401, { error: 'Missing API key: send Authorization: Bearer <key> (or X-API-Key)' })
  const ds = DATASETS[datasetKey]
  if (!ds) return json(404, { error: `Unknown dataset. Use one of: ${Object.keys(DATASETS).join(', ')}` })
  const url = new URL(req.url)
  const ip = clientIpFrom(req.headers)
  return withOrgSystem(orgId, async (tx) => {
    const [k] = (await tx.execute<{ id: string; scopes: string[]; branch_id: string | null; expires_at: string | null; revoked_at: string | null }>(sql`
      select id, scopes, branch_id, expires_at, revoked_at from api_keys where key_hash = ${hash(auth)}`)).rows
    if (!k || k.revoked_at || (k.expires_at && new Date(k.expires_at) < new Date())) return json(401, { error: 'This API key is not valid (revoked, expired or wrong)' })
    if (!k.scopes.includes(datasetKey)) return json(403, { error: `This key may not read ${datasetKey}. It may read: ${k.scopes.join(', ')}` })
    if (!(await hasModule(tx, 'api'))) return json(402, { error: 'The read API is not part of this institute’s plan' })
    // a leaked key must not be able to pull everything in one go: 60 calls a minute and 2,000 an hour per key
    if (!(await underLimit(`api:min:${k.id}`, 60, 60)) || !(await underLimit(`api:hour:${k.id}`, 2000, 3600))) return json(429, { error: 'Too many requests with this key: slow down and try again in a minute' })
    await tx.execute(sql`update api_keys set last_used_at = now(), last_used_ip = ${ip}, use_count = use_count + 1 where id = ${k.id}`)
    let branchId = k.branch_id
    const code = url.searchParams.get('branch')
    if (code && !branchId) {
      const [b] = (await tx.execute<{ id: string }>(sql`select id from branches where upper(code) = upper(${code})`)).rows
      if (!b) return json(400, { error: `No branch with code ${code}` })
      branchId = b.id
    }
    const num = (v: string | null, dflt: number) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : dflt }
    const limit = Math.min(Math.max(num(url.searchParams.get('limit'), 1000) || 1000, 1), 5000)
    const offset = Math.min(Math.max(num(url.searchParams.get('offset'), 0), 0), 10_000_000)
    const from = isDay(url.searchParams.get('from')), to = isDay(url.searchParams.get('to'))
    const rows = (await tx.execute<Record<string, unknown>>(ds.query({ from, to, branchId, limit, offset }))).rows
    const fields = ds.fields.map((f) => f.key)
    if (url.searchParams.get('format') === 'csv') return { status: 200, body: toCsv(rows, fields), type: 'text/csv; charset=utf-8' }
    return json(200, { dataset: datasetKey, count: rows.length, limit, offset, next: rows.length === limit ? offset + limit : null, filters: { from, to, branch: code ?? null }, data: rows })
  })
}
