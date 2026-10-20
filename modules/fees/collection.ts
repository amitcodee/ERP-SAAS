// Fee collection over a period: what came in, when, from whom and how. Read-only; the numbers are the payments that
// stand (a reversed payment, wrong entry or refund, is left out: v_live_payments).
import { sql } from 'drizzle-orm'
import { assertCan } from '@/lib/auth/permissions'
import type { Actor, Tx } from '@/lib/db/withTenant'

const ISO = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IST = sql`'Asia/Kolkata'`
export const COLLECTION_ROWS = 500

export type CollectionQuery = { from: string; to: string; branchId?: string | null; modeId?: string | null }
export type CollectionRow = {
  receiptNo: string; registrationId: string; paidAt: string; amount: number; mode: string; txnRef: string | null; paperSlip: boolean
  student: string; phone: string; regNo: string; course: string; department: string | null; branch: string; receivedBy: string | null
}
export type CollectionReport = {
  from: string; to: string
  total: number; count: number; students: number
  /** One point per day, or per month when the period is longer than about two months. */
  by: 'day' | 'month'
  series: { key: string; total: number; count: number }[]
  byMode: { name: string; total: number; count: number }[]
  byCourse: { name: string; total: number; count: number }[]
  byBranch: { name: string; total: number; count: number }[]
  rows: CollectionRow[]
}

/** Payments received from `from` to `to` (dates in India), optionally of one branch or one mode of payment. */
export async function collectionReport(tx: Tx, actor: Actor, q: CollectionQuery): Promise<CollectionReport> {
  assertCan(actor, 'read', 'fee')
  if (!ISO.test(q.from) || !ISO.test(q.to) || q.from > q.to) throw new Error('Choose a valid period')
  const branchId = q.branchId && UUID.test(q.branchId) ? q.branchId : null
  const modeId = q.modeId && UUID.test(q.modeId) ? q.modeId : null
  const day = sql`(pay.paid_at at time zone ${IST})::date`
  const where = sql`${day} between ${q.from}::date and ${q.to}::date
    and (${branchId}::uuid is null or pay.branch_id = ${branchId}::uuid) and (${modeId}::uuid is null or pay.mode_id = ${modeId}::uuid)`
  const from = sql`from v_live_payments pay join receipts rc on rc.payment_id = pay.id join lookups m on m.id = pay.mode_id
    join registrations r on r.id = pay.registration_id join persons p on p.id = r.person_id join branches br on br.id = pay.branch_id
    left join departments d on d.id = r.department_id left join courses c on c.id = r.course_id left join users u on u.id = pay.received_by`
  const course = sql`coalesce(c.title, r.custom_course_title, d.name, 'Other')`

  const days = Math.round((Date.parse(q.to) - Date.parse(q.from)) / 86400000) + 1
  const by: 'day' | 'month' = days > 62 ? 'month' : 'day'
  const bucket = by === 'day' ? sql`to_char(${day}, 'YYYY-MM-DD')` : sql`to_char(${day}, 'YYYY-MM')`
  const num = <T extends { total: unknown; count: unknown }>(r: T) => ({ ...r, total: Number(r.total), count: Number(r.count) }) as Omit<T, 'total' | 'count'> & { total: number; count: number }

  const [tot] = (await tx.execute<{ total: string; count: string; students: string }>(sql`select coalesce(sum(pay.amount), 0) as total, count(*) as count, count(distinct p.phone_norm) as students ${from} where ${where}`)).rows
  const series = (await tx.execute<{ key: string; total: string; count: string }>(sql`select ${bucket} as key, sum(pay.amount) as total, count(*) as count ${from} where ${where} group by 1 order by 1`)).rows.map(num)
  const byMode = (await tx.execute<{ name: string; total: string; count: string }>(sql`select m.value as name, sum(pay.amount) as total, count(*) as count ${from} where ${where} group by 1 order by 2 desc`)).rows.map(num)
  const byCourse = (await tx.execute<{ name: string; total: string; count: string }>(sql`select ${course} as name, sum(pay.amount) as total, count(*) as count ${from} where ${where} group by 1 order by 2 desc`)).rows.map(num)
  const byBranch = (await tx.execute<{ name: string; total: string; count: string }>(sql`select br.name as name, sum(pay.amount) as total, count(*) as count ${from} where ${where} group by 1 order by 2 desc`)).rows.map(num)
  const rows = (await tx.execute<Record<string, never>>(sql`
    select rc.receipt_no, r.id as registration_id, pay.paid_at, pay.amount, m.value as mode, pay.txn_ref, pay.manual_slip_no,
      trim(p.first_name || ' ' || coalesce(p.last_name, '')) as student, p.phone, r.reg_no, ${course} as course, d.name as department, br.name as branch, u.name as received_by
    ${from} where ${where} order by pay.paid_at desc, rc.receipt_no desc limit ${COLLECTION_ROWS}`)).rows

  // every day (or month) of the period appears, also those with nothing collected
  const filled: CollectionReport['series'] = []
  const have = new Map(series.map((s) => [s.key, s]))
  if (by === 'day') {
    for (let t = Date.parse(q.from); t <= Date.parse(q.to); t += 86400000) { const k = new Date(t).toISOString().slice(0, 10); filled.push(have.get(k) ?? { key: k, total: 0, count: 0 }) }
  } else {
    for (let y = Number(q.from.slice(0, 4)), mo = Number(q.from.slice(5, 7)); `${y}-${String(mo).padStart(2, '0')}` <= q.to.slice(0, 7); mo === 12 ? (y++, mo = 1) : mo++) {
      const k = `${y}-${String(mo).padStart(2, '0')}`; filled.push(have.get(k) ?? { key: k, total: 0, count: 0 })
    }
  }
  // the long tail of courses is folded into "Other courses"
  const top = byCourse.slice(0, 8)
  const rest = byCourse.slice(8)
  if (rest.length) top.push({ name: `Other courses (${rest.length})`, total: rest.reduce((n, x) => n + x.total, 0), count: rest.reduce((n, x) => n + x.count, 0) })

  return {
    from: q.from, to: q.to, total: Number(tot.total), count: Number(tot.count), students: Number(tot.students), by, series: filled, byMode, byCourse: top, byBranch,
    rows: rows.map((r) => ({
      receiptNo: r.receipt_no, registrationId: r.registration_id, paidAt: new Date(r.paid_at).toISOString(), amount: r.amount, mode: r.mode, txnRef: r.txn_ref, paperSlip: !!r.manual_slip_no,
      student: r.student, phone: r.phone, regNo: r.reg_no, course: r.course, department: r.department, branch: r.branch, receivedBy: r.received_by,
    })),
  }
}
