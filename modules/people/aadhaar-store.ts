// Aadhaar numbers are kept encrypted in persons.aadhaar_no (lib/secret-box, its own key), with the last 4 digits in
// persons.aadhaar_last4 for display. A database dump, a backup or a query that reads the whole person row then shows
// no full number; only the panel's own screens open it, for the people allowed to see the record.
import { sql } from 'drizzle-orm'
import { seal, unseal } from '@/lib/secret-box'
import type { Tx } from '@/lib/db/withTenant'
import { cleanAadhaar } from './aadhaar'

const PLAIN = /^[2-9]\d{11}$/

/** The columns to save for a number typed in (already validated): the sealed number and its last 4 digits. */
export function aadhaarColumns(orgId: string, raw: string | null | undefined): { aadhaarNo: string | null; aadhaarLast4: string | null } {
  const v = raw ? cleanAadhaar(raw) : ''
  return v ? { aadhaarNo: seal(v, 'personal-ids', orgId), aadhaarLast4: v.slice(-4) } : { aadhaarNo: null, aadhaarLast4: null }
}

/** The number from a stored value (sealed, or a plain one not yet sealed). Null when empty or unreadable. */
export function openAadhaar(orgId: string, stored: string | null | undefined): string | null {
  if (!stored) return null
  if (PLAIN.test(stored)) return stored
  return unseal<string>(stored, 'personal-ids', orgId)
}

/** Seals numbers still stored in plain text (before encryption, or copied in by an import). Safe to run again. */
export async function sealPlainAadhaars(tx: Tx, orgId: string): Promise<number> {
  const rows = (await tx.execute<{ id: string; aadhaar_no: string }>(sql`select id, aadhaar_no from persons where aadhaar_no ~ '^[2-9][0-9]{11}$' limit 5000`)).rows
  for (const r of rows) {
    const c = aadhaarColumns(orgId, r.aadhaar_no)
    await tx.execute(sql`update persons set aadhaar_no = ${c.aadhaarNo}, aadhaar_last4 = ${c.aadhaarLast4} where id = ${r.id}`)
  }
  return rows.length
}
