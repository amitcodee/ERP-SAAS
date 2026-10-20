// One e-mail = one login inside an organisation (another institute may have a login with the same e-mail). Every place
// that gives a login an e-mail (staff, student portal, branch admin) checks it here and says who has it: first in the
// caller's own transaction (it sees logins made in it), then across all the org's branches (a branch user's own view cannot see other branches' logins: those are only said to exist, not named).
import { sql } from 'drizzle-orm'
import { txOrg, withOrgSystem, type Tx } from '@/lib/db/withTenant'

const ownerIn = async (tx: Tx, email: string, exceptUserId?: string | null) => (await tx.execute<{ name: string }>(sql`
  select name from users where lower(email) = lower(${email.trim()}) and id is distinct from ${exceptUserId ?? null}::uuid limit 1`)).rows[0]?.name ?? null

/**
 * Who already uses this e-mail (other than `exceptUserId`), or null when it is free: the name when the caller can see
 * that login anyway, else only "a login in another branch" (no names from other branches).
 */
export async function emailOwner(tx: Tx, email: string, exceptUserId?: string | null): Promise<string | null> {
  return (await ownerIn(tx, email, exceptUserId)) ?? ((await withOrgSystem(await txOrg(tx), (sys) => ownerIn(sys, email, exceptUserId))) ? 'a login in another branch' : null)
}

export const emailTakenMessage = (email: string, owner: string) => `${email.trim()} is already used in the system by ${owner}. Use a different e-mail.`

/** Throws "<e-mail> is already used in the system by <name>. Use a different e-mail." when it is taken. */
export async function assertEmailFree(tx: Tx, email: string, exceptUserId?: string | null) {
  const owner = await emailOwner(tx, email, exceptUserId)
  if (owner) throw new Error(emailTakenMessage(email, owner))
}
