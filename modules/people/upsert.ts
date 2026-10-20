import { and, eq } from 'drizzle-orm'
import { persons } from '@/lib/db/schema'
import type { Tx } from '@/lib/db/withTenant'
import { normalizePhone } from './phone'

export type PersonBasics = { firstName: string; lastName?: string | null; phone: string; altPhone?: string | null; email?: string | null }

/**
 * Finds the student in this branch by phone number, or creates them. Safe when several people enter the same
 * number at the same instant: the insert is "do nothing on conflict", then we read whoever won.
 */
export async function upsertPerson(tx: Tx, branchId: string, p: PersonBasics) {
  const norm = normalizePhone(p.phone)
  const [created] = await tx
    .insert(persons)
    .values({
      branchId, firstName: p.firstName, lastName: p.lastName ?? null, phone: p.phone,
      phoneNorm: norm, altPhone: p.altPhone ?? null, email: p.email ?? null,
    })
    .onConflictDoNothing({ target: [persons.branchId, persons.phoneNorm] })
    .returning()
  if (created) return { person: created, created: true }
  const [existing] = await tx.select().from(persons).where(and(eq(persons.branchId, branchId), eq(persons.phoneNorm, norm)))
  return { person: existing, created: false }
}
