import { sql } from 'drizzle-orm'
import type { Tx } from './db/withTenant'
import { NUMBER_KIND_KEYS, NUMBER_KINDS, numberOf, periodOf, renderNumber, type NumberKind } from './number-format'

// Every number the panel gives out (enquiry, registration, receipt, certificate, ticket, help request, event
// certificate) is drawn from a format (lib/number-format.ts). Head office sets the org's formats in Settings →
// Numbering (organisations.numbering); a branch may still have its own registration format (Branches). No format:
// the default.
export * from './number-format'

/** The org's formats, each kind with its default filled in. */
export async function orgFormats(tx: Tx): Promise<Record<NumberKind, string>> {
  const [o] = (await tx.execute<{ numbering: Record<string, string> | null }>(sql`select numbering from organisations where id = app_org()`)).rows
  return Object.fromEntries(NUMBER_KIND_KEYS.map((k) => [k, o?.numbering?.[k] || NUMBER_KINDS[k].default])) as Record<NumberKind, string>
}
const formatFor = async (tx: Tx, kind: NumberKind) => (await orgFormats(tx))[kind]

/**
 * Atomically mints the next value of a branch's counter. Must be called inside the same transaction that inserts the
 * record, so a rollback also rolls back the number (keeps receipts gapless).
 */
export async function nextSeq(tx: Tx, branchId: string, kind: NumberKind, period: string): Promise<number> {
  const res = await tx.execute<{ last_value: number }>(sql`
    insert into number_sequences (branch_id, kind, period, last_value)
    values (${branchId}, ${kind}, ${period}, 1)
    on conflict (branch_id, kind, period)
    do update set last_value = number_sequences.last_value + 1
    returning last_value`)
  return res.rows[0].last_value
}
/** The same for a counter of the whole org (in the transaction's org). */
async function nextOrgSeq(tx: Tx, kind: NumberKind, period: string): Promise<number> {
  return (await tx.execute<{ v: number }>(sql`select app_org_seq(${kind}, ${period}) as v`)).rows[0].v
}

const taken = async (tx: Tx, kind: NumberKind, no: string) => {
  const t = NUMBER_KINDS[kind].taken
  return !!t && !!(await tx.execute(sql`select 1 from ${sql.identifier(t[0])} where ${sql.identifier(t[1])} = ${no} limit 1`)).rows.length
}
/** Draws numbers until one is free (a number already used, e.g. brought over from old records, is skipped). */
async function mint(tx: Tx, kind: NumberKind, f: string, draw: (period: string) => Promise<number>, code: string, d: Date) {
  for (let i = 0; i < 5000; i++) {
    const no = renderNumber(f, code, await draw(periodOf(f, d)), d)
    if (!(await taken(tx, kind, no))) return no
  }
  throw new Error(`No free ${NUMBER_KINDS[kind].label.toLowerCase()} number: check the number format`)
}

export async function nextEnquiryNo(tx: Tx, branchId: string, branchCode: string, d = new Date()) {
  return mint(tx, 'ENQ', await formatFor(tx, 'ENQ'), (p) => nextSeq(tx, branchId, 'ENQ', p), branchCode, d)
}
/** Receipts never skip a number: the format always holds the branch and {FY}, so a number cannot repeat. */
export async function nextReceiptNo(tx: Tx, branchId: string, branchCode: string, d = new Date()) {
  const f = await formatFor(tx, 'RCP')
  return renderNumber(f, branchCode, await nextSeq(tx, branchId, 'RCP', periodOf(f, d)), d)
}
export async function nextCertNo(tx: Tx, branchId: string, certCode: string, d = new Date()) {
  return mint(tx, 'CERT', await formatFor(tx, 'CERT'), (p) => nextSeq(tx, branchId, 'CERT', p), certCode, d)
}
/** A number counted across the whole org: support tickets, help requests, event certificates. */
export async function nextOrgNo(tx: Tx, kind: 'TKT' | 'HLP' | 'EVC', d = new Date()) {
  return mint(tx, kind, await formatFor(tx, kind), (p) => nextOrgSeq(tx, kind, p), '', d)
}

// ---- registration numbers: a branch may have its own format (head office sets it in Branches) -----------------
// e.g. TCD/4002/{n} from 2586, to carry on the old records' numbering. No branch format: the org's.
async function regFormatOf(tx: Tx, branchId: string) {
  const [b] = (await tx.execute<{ reg_format: string | null }>(sql`select reg_format from branches where id = ${branchId}`)).rows
  return b?.reg_format || (await formatFor(tx, 'REG'))
}
/** The registration format of the org (what a branch without its own uses). */
export const orgRegFormat = (tx: Tx) => formatFor(tx, 'REG')

/** Mints the branch's next registration number; a number already used (e.g. brought over from the old records) is skipped. */
export async function nextRegNo(tx: Tx, branchId: string, branchCode: string, d = new Date()) {
  return mint(tx, 'REG', await regFormatOf(tx, branchId), (p) => nextSeq(tx, branchId, 'REG', p), branchCode, d)
}
/** The number nextRegNo would mint now, without minting it (two people registering at once: the later one gets the next). */
export async function peekRegNo(tx: Tx, branchId: string, branchCode: string, d = new Date()) {
  const f = await regFormatOf(tx, branchId)
  const res = await tx.execute<{ last_value: number }>(sql`select last_value from number_sequences where branch_id = ${branchId} and kind = 'REG' and period = ${periodOf(f, d)}`)
  let n = (res.rows[0]?.last_value ?? 0) + 1
  for (let i = 0; i < 5000 && (await taken(tx, 'REG', renderNumber(f, branchCode, n, d))); i++) n++
  return renderNumber(f, branchCode, n, d)
}
/** Sets the branch's counter so the next number is `next` (never below a number already used in this format). */
export async function setRegCounter(tx: Tx, branchId: string, branchCode: string, next: number | null, d = new Date()) {
  const f = await regFormatOf(tx, branchId)
  const used = (await tx.execute<{ reg_no: string }>(sql`select reg_no from registrations where branch_id = ${branchId}`)).rows
    .map((r) => numberOf(f, branchCode, r.reg_no, d)).filter((n): n is number => n !== null)
  const highest = used.length ? Math.max(...used) : 0
  const last = Math.max(highest, (next ?? highest + 1) - 1)
  await tx.execute(sql`insert into number_sequences (branch_id, kind, period, last_value) values (${branchId}, 'REG', ${periodOf(f, d)}, ${last})
    on conflict (branch_id, kind, period) do update set last_value = ${last}`)
  return { next: last + 1, highest }
}
