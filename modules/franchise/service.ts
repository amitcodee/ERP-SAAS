// Franchises: a centre run by a partner who pays head office a royalty, either a percent of the fees the centre
// receives (payments that stand: v_live_payments) or a fixed amount a month, from the agreement's start. Head office
// sets the terms (franchise:update) and records the partner's payments (franchise:create); a franchise's own staff with
// franchise:read see their centre's statement (RLS keeps them to it). Amounts in paise; percent in basis points.
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { assertCan } from '@/lib/auth/permissions'
import { royaltyPayments } from '@/lib/db/schema'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { todayIST } from '@/lib/ist'
import { freshLogins, shareStaff, type Login } from '../branches/service'
import { createUser } from '../users/service'

export const ROYALTY_MODES = ['Bank transfer', 'UPI', 'Cheque', 'Cash', 'Adjusted'] as const
/** At most this many months back a statement goes (an agreement older than that starts there). */
const MAX_MONTHS = 60

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date')
const optText = (max: number) => z.preprocess((v) => (v == null ? null : String(v).trim() || null), z.string().max(max).nullable()).optional()
const optDate = z.preprocess((v) => (v == null || v === '' ? null : v), isoDate.nullable()).optional()

export const franchiseInput = z.object({
  branchId: z.string().uuid(),
  kind: z.enum(['own', 'franchise']),
  partnerName: optText(160),
  partnerOwner: optText(120),
  partnerPhone: optText(30),
  partnerEmail: z.preprocess((v) => (v == null ? null : String(v).trim().toLowerCase() || null), z.string().email('Check the partner’s e-mail').max(160).nullable()).optional(),
  agreementFrom: optDate,
  agreementTo: optDate,
  royaltyKind: z.enum(['percent', 'fixed']).nullable().optional(),
  /** percent: basis points (1250 = 12.5%); fixed: paise a month */
  royaltyValue: z.number().int().min(0).nullable().optional(),
})
export type FranchiseInput = z.input<typeof franchiseInput>

/** Makes a centre a franchise (with its partner and royalty) or the institute's own again (its terms cleared). */
export async function setFranchise(tx: Tx, actor: Actor, raw: FranchiseInput) {
  assertCan(actor, 'update', 'franchise')
  const v = franchiseInput.parse(raw)
  const [b] = (await tx.execute<{ id: string; kind: string }>(sql`select id, kind from branches where id = ${v.branchId}`)).rows
  if (!b) throw new Error('Branch not found')
  if (v.kind === 'own') {
    await tx.execute(sql`update branches set kind = 'own', partner_name = null, partner_owner = null, partner_phone = null, partner_email = null,
      agreement_from = null, agreement_to = null, royalty_kind = null, royalty_value = null where id = ${v.branchId}`)
    await audit(tx, actor, { action: 'update', entity: 'franchise', entityId: v.branchId, after: { kind: 'own' } })
    return
  }
  if (!v.partnerName) throw new Error('Give the partner’s legal name: it is printed on the centre’s receipts')
  if (v.agreementFrom && v.agreementTo && v.agreementTo < v.agreementFrom) throw new Error('The agreement cannot end before it starts')
  const kind = v.royaltyKind ?? null, value = kind ? v.royaltyValue ?? null : null
  if (kind && value == null) throw new Error(kind === 'percent' ? 'Give the royalty percent' : 'Give the monthly royalty')
  if (kind === 'percent' && value! > 10000) throw new Error('The royalty cannot be over 100%')
  await tx.execute(sql`update branches set kind = 'franchise', partner_name = ${v.partnerName}, partner_owner = ${v.partnerOwner ?? null}, partner_phone = ${v.partnerPhone ?? null},
    partner_email = ${v.partnerEmail ?? null}, agreement_from = ${v.agreementFrom ?? null}, agreement_to = ${v.agreementTo ?? null}, royalty_kind = ${kind}, royalty_value = ${value}
    where id = ${v.branchId}`)
  await audit(tx, actor, { action: 'update', entity: 'franchise', entityId: v.branchId, after: { kind: 'franchise', partnerName: v.partnerName, royaltyKind: kind, royaltyValue: value, agreementFrom: v.agreementFrom ?? null, agreementTo: v.agreementTo ?? null } })
}

/**
 * What a centre owes for one month (`month`: YYYY-MM) on these terms and that month's fees received: a percent of the
 * fees, or the fixed amount; nothing for a month outside the agreement.
 */
export function royaltyFor(t: { royaltyKind: 'percent' | 'fixed' | null; royaltyValue: number | null; agreementFrom: string | null; agreementTo: string | null }, month: string, income: number): number {
  if (!t.royaltyKind || t.royaltyValue == null) return 0
  const first = `${month}-01`, last = lastDay(month)
  if (t.agreementFrom && t.agreementFrom > last) return 0
  if (t.agreementTo && t.agreementTo < first) return 0
  return t.royaltyKind === 'percent' ? Math.round((income * t.royaltyValue) / 10000) : t.royaltyValue
}
const lastDay = (month: string) => { const [y, m] = month.split('-').map(Number); return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}` }
const addMonths = (month: string, n: number) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
export const monthOf = (iso: string) => iso.slice(0, 7)

export type StatementMonth = { month: string; income: number; royalty: number; paid: number }
export type Franchise = {
  branchId: string; branch: string; code: string; partnerName: string | null; partnerOwner: string | null; partnerPhone: string | null; partnerEmail: string | null
  agreementFrom: string | null; agreementTo: string | null; royaltyKind: 'percent' | 'fixed' | null; royaltyValue: number | null
  /** the month asked for */
  month: StatementMonth
  /** owed to the end of that month, less everything paid by then */
  balance: number
  months: StatementMonth[]
}

/**
 * The franchise centres (head office: all, or the one picked; a franchise's staff: their own) with their statement up
 * to `month` (YYYY-MM): each month's fees received, royalty and payments, newest first, and what is owed to date.
 */
export async function franchiseStatements(tx: Tx, actor: Actor, opts: { month: string; branchId?: string | null }): Promise<Franchise[]> {
  assertCan(actor, 'read', 'franchise')
  if (!/^\d{4}-\d{2}$/.test(opts.month)) throw new Error('Pick a month')
  const rows = (await tx.execute<{ id: string; name: string; code: string; partner_name: string | null; partner_owner: string | null; partner_phone: string | null; partner_email: string | null; agreement_from: string | null; agreement_to: string | null; royalty_kind: 'percent' | 'fixed' | null; royalty_value: number | null; since: string }>(sql`
    select id, name, code, partner_name, partner_owner, partner_phone, partner_email, agreement_from::text, agreement_to::text, royalty_kind, royalty_value,
      to_char(coalesce(agreement_from, (created_at at time zone 'Asia/Kolkata')::date), 'YYYY-MM') as since
    from branches where kind = 'franchise' ${opts.branchId ? sql`and id = ${opts.branchId}::uuid` : sql``} order by name`)).rows
  const out: Franchise[] = []
  for (const b of rows) {
    const start = b.since > opts.month ? opts.month : b.since < addMonths(opts.month, -(MAX_MONTHS - 1)) ? addMonths(opts.month, -(MAX_MONTHS - 1)) : b.since
    const end = lastDay(opts.month)
    const income = new Map((await tx.execute<{ month: string; amount: number }>(sql`
      select to_char((paid_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM') as month, sum(amount)::bigint as amount from v_live_payments
      where branch_id = ${b.id} and (paid_at at time zone 'Asia/Kolkata')::date between ${`${start}-01`}::date and ${end}::date group by 1`)).rows.map((r) => [r.month, Number(r.amount)]))
    const paid = new Map((await tx.execute<{ month: string; amount: number }>(sql`
      select to_char(paid_on, 'YYYY-MM') as month, sum(amount)::bigint as amount from royalty_payments
      where branch_id = ${b.id} and deleted_at is null and paid_on <= ${end}::date group by 1`)).rows.map((r) => [r.month, Number(r.amount)]))
    const terms = { royaltyKind: b.royalty_kind, royaltyValue: b.royalty_value, agreementFrom: b.agreement_from, agreementTo: b.agreement_to }
    const months: StatementMonth[] = []
    for (let m = start; m <= opts.month; m = addMonths(m, 1)) {
      const inc = income.get(m) ?? 0
      months.push({ month: m, income: inc, royalty: royaltyFor(terms, m, inc), paid: paid.get(m) ?? 0 })
    }
    // payments before the statement's first month still count against what is owed
    const paidBefore = [...paid.entries()].filter(([m]) => m < start).reduce((n, [, a]) => n + a, 0)
    const owed = months.reduce((n, m) => n + m.royalty, 0), paidTotal = months.reduce((n, m) => n + m.paid, 0) + paidBefore
    out.push({
      branchId: b.id, branch: b.name, code: b.code, partnerName: b.partner_name, partnerOwner: b.partner_owner, partnerPhone: b.partner_phone, partnerEmail: b.partner_email,
      agreementFrom: b.agreement_from, agreementTo: b.agreement_to, royaltyKind: b.royalty_kind, royaltyValue: b.royalty_value,
      month: months[months.length - 1], balance: owed - paidTotal, months: [...months].reverse(),
    })
  }
  return out
}

export const royaltyPaymentInput = z.object({
  branchId: z.string().uuid(),
  paidOn: isoDate,
  amount: z.number().int('Amount in whole paise').positive('Enter the amount').max(100_000_000_00, 'That amount is too large'),
  mode: optText(40),
  ref: optText(80),
  note: optText(300),
})
export type RoyaltyPaymentInput = z.input<typeof royaltyPaymentInput>

/** Head office records a royalty payment from a franchise partner. */
export async function recordRoyaltyPayment(tx: Tx, actor: Actor, raw: RoyaltyPaymentInput) {
  assertCan(actor, 'create', 'franchise')
  const v = royaltyPaymentInput.parse(raw)
  if (v.paidOn > todayIST()) throw new Error('A payment cannot be in the future')
  const [b] = (await tx.execute<{ kind: string }>(sql`select kind from branches where id = ${v.branchId}`)).rows
  if (!b) throw new Error('Branch not found')
  if (b.kind !== 'franchise') throw new Error('This centre is not a franchise')
  const [row] = await tx.insert(royaltyPayments).values({ branchId: v.branchId, paidOn: v.paidOn, amount: v.amount, mode: v.mode ?? null, ref: v.ref ?? null, note: v.note ?? null, createdBy: actor.userId }).returning({ id: royaltyPayments.id })
  await audit(tx, actor, { action: 'create', entity: 'royalty_payment', entityId: row.id, after: { branchId: v.branchId, amount: v.amount, paidOn: v.paidOn } })
  return row.id
}

/** Takes a royalty payment out of the statement (recorded by mistake); it stays on record. */
export async function deleteRoyaltyPayment(tx: Tx, actor: Actor, id: string) {
  assertCan(actor, 'delete', 'franchise')
  const res = await tx.execute(sql`update royalty_payments set deleted_at = now(), deleted_by = ${actor.userId} where id = ${z.string().uuid().parse(id)} and deleted_at is null`)
  if (!res.rowCount) throw new Error('Payment not found')
  await audit(tx, actor, { action: 'delete', entity: 'royalty_payment', entityId: id })
}

export type RoyaltyPaymentRow = { id: string; branchId: string; branch: string; paidOn: string; amount: number; mode: string | null; ref: string | null; note: string | null; by: string }

/** The latest royalty payments (one centre, or every one head office may see). */
export async function listRoyaltyPayments(tx: Tx, actor: Actor, branchId?: string | null): Promise<RoyaltyPaymentRow[]> {
  assertCan(actor, 'read', 'franchise')
  return (await tx.execute<RoyaltyPaymentRow>(sql`
    select r.id, r.branch_id as "branchId", b.name as branch, r.paid_on::text as "paidOn", r.amount, r.mode, r.ref, r.note, u.name as by
    from royalty_payments r join branches b on b.id = r.branch_id join users u on u.id = r.created_by
    where r.deleted_at is null ${branchId ? sql`and r.branch_id = ${branchId}::uuid` : sql``}
    order by r.paid_on desc, r.created_at desc limit 200`)).rows
}

export type PartnerInvite =
  | { status: 'new'; login: Login; branchActive: boolean }
  | { status: 'resent'; login: Login }
  | { status: 'shared'; name: string }
  | { status: 'pending_activation'; email: string }
  | { status: 'signed_in'; email: string }

/**
 * Gives the franchise's partner their login (Franchises → Invite partner), to the e-mail in the terms:
 *  - nobody has it yet: a branch-manager login at this centre, with a one-time password (e-mailed by the caller; while
 *    the branch is not active, it goes out when it is activated, like every login of the branch);
 *  - their login is this centre's already: a fresh one-time password (they had not signed in, or asked again);
 *  - they run another centre already: this one is added to theirs, with full access (one login for all their centres).
 */
export async function invitePartner(tx: Tx, actor: Actor, branchId: string): Promise<PartnerInvite> {
  assertCan(actor, 'update', 'franchise')
  const [b] = (await tx.execute<{ id: string; kind: string; status: string; partner_email: string | null; partner_owner: string | null; partner_name: string | null; partner_phone: string | null }>(sql`
    select id, kind, status, partner_email, partner_owner, partner_name, partner_phone from branches where id = ${z.string().uuid().parse(branchId)}`)).rows
  if (!b) throw new Error('Branch not found')
  if (b.kind !== 'franchise') throw new Error('This centre is not a franchise')
  if (!b.partner_email) throw new Error('Add the partner’s e-mail to the franchise terms first')
  const [u] = (await tx.execute<{ id: string; branch_id: string | null; name: string; email: string; is_active: boolean; signed_in: boolean }>(sql`
    select id, branch_id, name, email, is_active, last_login_at is not null as signed_in from users where lower(email) = ${b.partner_email} and deleted_at is null`)).rows
  if (u && !u.is_active) throw new Error('That e-mail belongs to a deactivated login: activate it under Users & Staff first')
  if (u && !u.branch_id) throw new Error('That e-mail is a head-office login: give the partner another e-mail')
  if (u && u.branch_id !== branchId) {
    const { name } = await shareStaff(tx, actor, branchId, u.id)
    await tx.execute(sql`update user_branches set access = 'full' where user_id = ${u.id} and branch_id = ${branchId}`)
    await audit(tx, actor, { action: 'invite_partner', entity: 'franchise', entityId: branchId, after: { userId: u.id, shared: true } })
    return { status: 'shared', name }
  }
  if (u) {
    if (b.status !== 'active') return { status: 'pending_activation', email: u.email }
    // already working: a new password would lock them out (they use Forgot password if they lost it)
    if (u.signed_in) return { status: 'signed_in', email: u.email }
    const [login] = await freshLogins(tx, branchId, u.id)
    if (!login) throw new Error('That login cannot be sent again')
    await audit(tx, actor, { action: 'invite_partner', entity: 'franchise', entityId: branchId, after: { userId: u.id, resent: true } })
    return { status: 'resent', login }
  }
  const made = await createUser(tx, actor, { name: b.partner_owner || b.partner_name || 'Partner', email: b.partner_email, phone: b.partner_phone ?? undefined, roles: ['branch_manager'], branchId })
  await audit(tx, actor, { action: 'invite_partner', entity: 'franchise', entityId: branchId, after: { userId: made.user.id } })
  if (b.status !== 'active') return { status: 'pending_activation', email: made.user.email }
  return { status: 'new', branchActive: true, login: { userId: made.user.id, name: made.user.name, email: made.user.email, password: made.tempPassword, roles: made.roles } }
}
