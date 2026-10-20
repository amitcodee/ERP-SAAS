// Self sign-up (modules/signup/service.ts): the checks on the form, the e-mailed code (kept only as an HMAC, 5 tries,
// 3 sends), the institute made on a trial with the chosen plan and password, the one-time welcome link, and
// "find my institute". The services commit their own transactions: each run uses its own names and cancels the
// institute it made at the end (jobs and lists skip cancelled ones).
import { sql } from 'drizzle-orm'
import { pool } from '../lib/db/client'
import { readSession, readWelcomeLink, signWelcomeLink } from '../lib/auth/session'
import { withPlatform } from '../lib/db/withTenant'
import { classifyHost } from '../lib/tenant/host'
import { orgForHost } from '../lib/tenant/resolve'
import { login } from '../modules/auth/login'
import { isDisposable, slugBlocked } from '../modules/signup/blocklists'
import { findInstitutes, resendSignupCode, signupCodeHash, slugAvailability, startSignup, suggestSlug, verifySignup, type SignupInput } from '../modules/signup/service'

let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
const RUN = Date.now().toString(36)
const IP = `signup-test-${RUN}`
const SLUG = `su-${RUN}`
const EMAIL = `owner.${RUN}@signup-test.dev`
const PASSWORD = `Chosen-pass-${RUN}9`
const form = (over: Partial<SignupInput> = {}): SignupInput => ({ name: 'Signup Test Academy', slug: SLUG, ownerName: 'Neha Test', email: EMAIL, mobile: '98765 43210', password: PASSWORD, plan: 'growth', accept: true, ...over })
const setCode = (id: string, code: string) => withPlatform((tx) => tx.execute(sql`update signups set code_hash = ${signupCodeHash(id, code)} where id = ${id}`))
const row = (id: string) => withPlatform(async (tx) => (await tx.execute<{ code_hash: string; password_hash: string; attempts: number; sends: number; completed_at: string | null; org_id: string | null }>(sql`
  select code_hash, password_hash, attempts, sends, completed_at::text, org_id from signups where id = ${id}`)).rows[0])

async function main() {
  let orgId: string | null = null
  try {
    // ---- the web address -------------------------------------------------------------------------------------------
    check('an address is suggested from the name', suggestSlug('  Bright Future Academy (Ludhiana) ') === 'bright-future-academy-ludhiana')
    check('reserved, look-alike and malformed addresses are refused', !!(await slugAvailability('admin')) && !!(await slugAvailability('google')) && !!(await slugAvailability('sbi-academy')) && !!(await slugAvailability('-bad-')) && !!(await slugAvailability('UPPER CASE')))
    check('... ordinary words that merely start alike are not', !slugBlocked('bankim-academy') && !slugBlocked('governance-institute') && slugBlocked('google2') && slugBlocked('bank-of-learning'))
    check('an address in use is taken', (await slugAvailability('sample')) === 'That address is taken: pick another')
    check('a free one is free', (await slugAvailability(SLUG)) === null)
    check('throw-away mailboxes are known', isDisposable('x@mailinator.com') && !isDisposable('x@gmail.com'))

    // ---- the form ------------------------------------------------------------------------------------------------------
    const refused = async (over: Partial<SignupInput>, re: RegExp) => { const r = await startSignup(form(over), IP); return !r.ok && re.test(r.error) }
    check('the terms must be accepted', await refused({ accept: false }, /accept the terms/))
    check('a throw-away mailbox is refused', await refused({ email: `x.${RUN}@yopmail.com` }, /throw-away/))
    check('a weak password is refused', await refused({ password: 'short1' }, /Password/))
    check('a mobile must be a real Indian mobile', await refused({ mobile: '12345' }, /10-digit/))
    check('a taken address is refused', await refused({ slug: 'sample' }, /taken/))

    const started = await startSignup(form(), IP)
    if (!started.ok) throw new Error(`sign-up did not start: ${started.error}`)
    const r0 = await row(started.id)
    check('the code is kept only as an HMAC, the password only as a hash', /^[0-9a-f]{64}$/.test(r0.code_hash) && r0.password_hash.startsWith('$argon2') && !r0.password_hash.includes(PASSWORD))
    check('while it waits, its address is not offered to anyone else', (await slugAvailability(SLUG)) === 'That address is taken: pick another')

    // ---- the code --------------------------------------------------------------------------------------------------------
    check('a malformed code is refused without counting', !(await verifySignup(started.id, '12ab')).ok && (await row(started.id)).attempts === 0)
    await setCode(started.id, '111111')
    const wrong = await verifySignup(started.id, '222222')
    check('a wrong code is refused and counted', !wrong.ok && /not right/.test(wrong.error) && (await row(started.id)).attempts === 1)
    for (let i = 0; i < 4; i++) await verifySignup(started.id, '222222')
    const locked = await verifySignup(started.id, '111111')
    check('after 5 wrong codes even the right one is refused', !locked.ok && /Too many wrong/.test(locked.error))
    check('a new code starts the count again', (await resendSignupCode(started.id)).ok && (await row(started.id)).attempts === 0 && (await row(started.id)).sends === 2)
    await setCode(started.id, '333333')
    const done = await verifySignup(started.id, '333333')
    if (!done.ok) throw new Error(`verify failed: ${done.error}`)
    orgId = done.org.orgId
    const after = await row(started.id)
    check('confirmed: the sign-up is closed and its secrets wiped', !!after.completed_at && after.org_id === orgId && after.code_hash === '' && after.password_hash === '')
    check('a closed sign-up cannot be used again', !(await verifySignup(started.id, '333333')).ok && !(await resendSignupCode(started.id)).ok)

    // ---- the institute ----------------------------------------------------------------------------------------------------
    const org = await orgForHost(classifyHost(`${SLUG}.localhost`))
    const [o] = await withPlatform(async (tx) => (await tx.execute<{ status: string; plan_key: string; name: string }>(sql`select status, plan_key, name from organisations where id = ${orgId}`)).rows)
    check('the institute is on a trial of the chosen plan, at its address', org?.id === orgId && o.status === 'trial' && o.plan_key === 'growth' && o.name === 'Signup Test Academy')
    const signedIn = await login(org!, EMAIL, PASSWORD, { ip: IP, userAgent: 'signup-test' })
    check('the owner signs in with the password chosen at sign-up, as head office, no change forced', signedIn.ok && signedIn.session.role === 'super_admin' && signedIn.session.org === orgId)

    const link = await signWelcomeLink({ org: orgId!, user: done.org.ownerUserId })
    const w = await readWelcomeLink(link)
    check('the welcome link names the institute and its owner, for minutes', w?.org === orgId && w.user === done.org.ownerUserId && w.exp - Date.now() / 1000 <= 600)
    check('... and is never a session itself', (await readSession(link)) === null)

    // ---- find my institute ------------------------------------------------------------------------------------------------
    const found = await withPlatform(async (tx) => (await tx.execute<{ org_id: string }>(sql`select org_id from platform_orgs_for_email(${EMAIL.toUpperCase()})`)).rows)
    check('find-my-institute knows the owner’s institute (any letter case)', found.length === 1 && found[0].org_id === orgId)
    check('it answers the same for an e-mail with no login', (await findInstitutes(`nobody.${RUN}@signup-test.dev`, IP, async () => 'x')).ok && (await findInstitutes(EMAIL, IP, async () => 'x')).ok)
    check('... and refuses a malformed e-mail', !(await findInstitutes('not-mail', IP, async () => 'x')).ok)
  } finally {
    if (orgId) await withPlatform((tx) => tx.execute(sql`update organisations set status = 'cancelled' where id = ${orgId}`))
    await pool.end()
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed')
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
