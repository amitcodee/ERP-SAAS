// The org's number formats (Settings → Numbering): enquiry, registration, receipt, certificate, ticket, help request
// and event certificate numbers. Head office sets them; a blank format means the default. A branch's own
// registration format (Branches) still comes first for that branch.
import { sql } from 'drizzle-orm'
import { audit } from '@/lib/audit'
import { assertCan } from '@/lib/auth/permissions'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { formatProblem, NUMBER_KIND_KEYS, NUMBER_KINDS, orgFormats, renderNumber, type NumberKind } from '@/lib/numbering'

export type NumberingRow = { kind: NumberKind; label: string; format: string | null; defaultFormat: string; example: string; perBranch: boolean }

/** Each kind: the org's own format (null: the default), the default, and what the first number looks like. */
export async function listNumbering(tx: Tx): Promise<NumberingRow[]> {
  const [o] = (await tx.execute<{ numbering: Record<string, string> | null }>(sql`select numbering from organisations where id = app_org()`)).rows
  const used = await orgFormats(tx)
  return NUMBER_KIND_KEYS.map((kind) => ({
    kind, label: NUMBER_KINDS[kind].label, format: o?.numbering?.[kind] || null, defaultFormat: NUMBER_KINDS[kind].default,
    example: renderNumber(used[kind], NUMBER_KINDS[kind].branch ? 'MAIN' : '', 1), perBranch: NUMBER_KINDS[kind].branch,
  }))
}

/** Saves the formats given (a blank one goes back to the default). Head office only; every format is checked first. */
export async function setNumbering(tx: Tx, actor: Actor, formats: Partial<Record<string, string | null>>) {
  if (actor.role !== 'super_admin') throw new Error('Only head office sets the number formats')
  assertCan(actor, 'update', 'setting')
  const [o] = (await tx.execute<{ numbering: Record<string, string> | null }>(sql`select numbering from organisations where id = app_org()`)).rows
  const next: Record<string, string> = { ...(o?.numbering ?? {}) }
  for (const [kind, raw] of Object.entries(formats)) {
    if (!(NUMBER_KIND_KEYS as string[]).includes(kind)) throw new Error(`Unknown number kind ${kind}`)
    const f = (raw ?? '').trim()
    if (!f || f === NUMBER_KINDS[kind as NumberKind].default) { delete next[kind]; continue }
    const why = formatProblem(kind as NumberKind, f)
    if (why) throw new Error(`${NUMBER_KINDS[kind as NumberKind].label} number: ${why}`)
    next[kind] = f
  }
  const r = await tx.execute(sql`update organisations set numbering = ${JSON.stringify(next)}::jsonb where id = app_org()`)
  if (!r.rowCount) throw new Error('Only head office sets the number formats')
  await audit(tx, actor, { action: 'set_numbering', entity: 'settings', entityId: 'numbering', before: o?.numbering ?? {}, after: next })
  return next
}
