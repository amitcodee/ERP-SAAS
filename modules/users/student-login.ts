// The student's portal login, made by itself once their first (token) fee is paid, and e-mailed to them.
// Best effort: runs after the payment is saved; a student without an e-mail, or with a login already, is left alone,
// and nothing here can undo or fail the payment. What happened is told back, so the payment screen can say it.
import { sql } from 'drizzle-orm'
import { withOrgSystem, type Actor } from '@/lib/db/withTenant'
import { log } from '@/lib/log'
import { providerFor } from '@/lib/notify/providers'
import { mailLogins } from '@/modules/branches/welcome'
import { appOrigin } from '@/lib/app-url'
import { createStudentLogin } from './service'

/**
 * emailed: login made and mailed · not_sent: made, the mail failed · not_made: could not be made (error says why) ·
 * no_email: no e-mail on record · skipped: has a login already, or this was not the first payment.
 */
export type AutoLogin = { status: 'emailed' | 'not_sent' | 'not_made' | 'no_email' | 'skipped'; email?: string; error?: string }

/** After a payment: the student's first payment gives them a portal login, mailed to the e-mail on record. */
export async function loginAfterFirstPayment(actor: Actor, registrationId: string): Promise<AutoLogin> {
  // no e-mail server: no login made by itself (nobody would get its password); Students → Portal login does it
  if (!(await providerFor(actor.orgId, 'email', actor.branchId))) return { status: 'not_made', error: 'no e-mail server is set up, so it cannot be mailed (make it under Students → Portal login)' }
  try {
    const made = await withOrgSystem(actor.orgId, async (tx) => {
      const [r] = (await tx.execute<{ has_login: boolean; email: string | null; payments: number }>(sql`
        select p.user_id is not null as has_login, p.email,
          (select count(*)::int from payments x where x.registration_id = r.id) as payments
        from registrations r join persons p on p.id = r.person_id where r.id = ${registrationId}`)).rows
      if (!r || r.has_login || r.payments < 1) return null
      if (!r.email) return 'no_email' as const
      // made as the system: the person taking the fee (e.g. accounts) need not be allowed to add users
      const res = await createStudentLogin(tx, { ...actor, perms: [...(actor.perms ?? []), 'user:create'] } as Actor, { registrationId, email: r.email })
      const [b] = res.user.branchId ? (await tx.execute<Record<string, string | null>>(sql`select id, name, code, cert_code as "certCode", city, address, state, pincode, phone from branches where id = ${res.user.branchId}`)).rows : [null]
      return { res, b }
    })
    if (!made) return { status: 'skipped' }
    if (made === 'no_email') return { status: 'no_email' }
    const { res, b } = made
    const [m] = await mailLogins(actor.orgId, b as never, [{ userId: res.user.id, name: res.user.name, email: res.user.email, password: res.tempPassword, roles: ['student'] }], { student: 'Student' }, await appOrigin(actor.orgId))
    if (m.emailed) return { status: 'emailed', email: m.email }
    log.warn('student_login.not_mailed', { registrationId, error: m.error })
    return { status: 'not_sent', email: m.email, error: m.error }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    log.warn('student_login.auto_failed', { registrationId, error })
    return { status: 'not_made', error: /already used in the system by/.test(error) ? `${error.replace(/ Use a different e-mail\.$/, '')} Use Students → Portal login with a different e-mail.` : error }
  }
}
