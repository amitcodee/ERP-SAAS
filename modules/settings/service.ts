// Business rules as config (P7). Only these keys exist; each has a validated range.
import { and, eq, isNull } from 'drizzle-orm'
import { audit } from '@/lib/audit'
import { assertCan } from '@/lib/auth/permissions'
import { settings } from '@/lib/db/schema'
import type { Actor, Tx } from '@/lib/db/withTenant'

export const RULES = {
  'certificate.min_attendance_pct': { label: 'Minimum attendance for a certificate (%)', min: 1, max: 100, fallback: 80 },
  'followup.sla_hours': { label: 'Follow-up reminder window (hours)', min: 1, max: 168, fallback: 2 },
  // Overdues: days past the follow-up / installment date before it reaches the branch manager, then head office
  'escalation.lead_manager_days': { label: 'Overdue lead: days before it goes to the branch manager', min: 1, max: 60, fallback: 1 },
  'escalation.lead_head_office_days': { label: 'Overdue lead: days before it goes to head office', min: 1, max: 120, fallback: 3 },
  'escalation.fee_manager_days': { label: 'Overdue fee: days before it goes to the branch manager', min: 1, max: 90, fallback: 7 },
  'escalation.fee_head_office_days': { label: 'Overdue fee: days before it goes to head office', min: 1, max: 180, fallback: 30 },
  // a discount (or a cut in the total fees) above this share of the fee waits for head office; 100: never
  'discount.head_office_pct': { label: 'Discount: above this % of the fee, head office approves it (100 = never)', min: 1, max: 100, fallback: 100 },
} as const
export type RuleKey = keyof typeof RULES

export type RuleRow = { key: RuleKey; label: string; value: number; min: number; max: number }

export async function listRules(tx: Tx): Promise<RuleRow[]> {
  const rows = await tx.select().from(settings).where(isNull(settings.branchId))
  return (Object.keys(RULES) as RuleKey[]).map((key) => {
    const found = rows.find((r) => r.key === key)
    const r = RULES[key]
    return { key, label: r.label, value: found ? Number(found.value) : r.fallback, min: r.min, max: r.max }
  })
}

/** One rule's value (saved, else its default). */
export async function ruleValue(tx: Tx, key: RuleKey): Promise<number> {
  const [r] = await tx.select().from(settings).where(and(isNull(settings.branchId), eq(settings.key, key)))
  return r ? Number(r.value) : RULES[key].fallback
}

export async function updateRule(tx: Tx, actor: Actor, key: string, value: number) {
  assertCan(actor, 'update', 'setting')
  const rule = RULES[key as RuleKey]
  if (!rule) throw new Error('Unknown setting')
  if (!Number.isInteger(value) || value < rule.min || value > rule.max) throw new Error(`${rule.label}: enter a whole number from ${rule.min} to ${rule.max}`)
  const [cur] = await tx.select().from(settings).where(and(isNull(settings.branchId), eq(settings.key, key)))
  if (cur) await tx.update(settings).set({ value }).where(eq(settings.id, cur.id))
  else await tx.insert(settings).values({ key, value })
  await audit(tx, actor, { action: 'update', entity: 'setting', entityId: key, before: cur?.value ?? null, after: value })
}
