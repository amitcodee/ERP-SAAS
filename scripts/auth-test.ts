// Login flow against the real DB: good password, bad password, session round-trip, the lockout ladder and IP block.
import { SAMPLE_ORG } from '../lib/db/schema/tenancy'
import { readSession, signSession } from '../lib/auth/session'
import { pool } from '../lib/db/client'
import { redis } from '../lib/redis'
import { BLOCKED_MSG, FREE_TRIES, LADDER, STEP } from '../modules/auth/guard'
import { login } from '../modules/auth/login'

let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' — ' + x : ''}`); if (!ok) failed++ }
const at = (ip: string) => ({ ip, userAgent: 'auth-test' })

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL!, pw = process.env.SEED_ADMIN_PASSWORD!
  const ip = 'auth-test-' + Date.now()
  const lower = email.toLowerCase()
  try {
    const good = await login(SAMPLE_ORG, email, pw, at(ip))
    check('super admin can log in', good.ok && good.session.role === 'super_admin')
    if (good.ok) {
      const back = await readSession(await signSession(good.session))
      check('session token round-trips', back?.userId === good.session.userId && back.branchId === null)
      check('tampered token is rejected', (await readSession((await signSession(good.session)) + 'x')) === null)
    }
    check('wrong password rejected with generic error', JSON.stringify(await login(SAMPLE_ORG, email, 'wrong', at(ip + 'a'))) === JSON.stringify({ ok: false, error: 'Invalid email or password' }))
    check('unknown user rejected identically', JSON.stringify(await login(SAMPLE_ORG, 'nobody@x.test', 'x', at(ip + 'b'))) === JSON.stringify({ ok: false, error: 'Invalid email or password' }))

    // the account: the 5th wrong password locks it for 30 seconds, and a locked account refuses even the right one
    let last: Awaited<ReturnType<typeof login>> | null = null
    for (let i = 0; i < FREE_TRIES; i++) last = await login(SAMPLE_ORG, email, 'bad', at(ip + 'c'))
    check('5th wrong password locks for 30 seconds', !!last && !last.ok && /Try again in 30 seconds/.test(last.error), last && !last.ok ? last.error : '')
    const locked = await login(SAMPLE_ORG, email, pw, at(ip + 'd'))
    check('while locked, even the right password is refused', !locked.ok && /Too many wrong passwords/.test(locked.error))
    const logged = (await pool.query(`select count(*)::int as n from login_attempts where email = $1 and result = 'locked' and at > now() - interval '1 minute'`, [lower])).rows[0].n
    check('locked attempts are in the sign-in log', logged >= 1)
    await pool.query(`delete from login_locks where key = $1`, [`email:${lower}`])

    // one IP guessing different accounts climbs the ladder: 30 s, 1 min, 10 min, 30 min, 1 h, then the IP is blocked
    const bad = ip + '-ladder'
    const waits: string[] = []
    let n = 0, blocked = false
    for (let round = 0; round <= LADDER.length && n < 60; round++) {
      const tries = round === 0 ? FREE_TRIES + 1 : STEP
      for (let k = 0; k < tries; k++) {
        const r = await login(SAMPLE_ORG, `ladder${n++}@x.test`, 'x', at(bad))
        if (!r.ok && k === tries - 1) { if (r.error === BLOCKED_MSG) blocked = true; else waits.push(r.error.replace(/.*Try again in /, '')) }
      }
      await pool.query(`update login_locks set locked_until = now() - interval '1 second' where key = $1`, [`ip:${bad}`]) // skip the wait
    }
    check('the ladder is 30 s → 1 min → 10 min → 30 min → 1 h', waits.join(' | ') === '30 seconds. | 1 minute. | 10 minutes. | 30 minutes. | 1 hour.', waits.join(' | '))
    check('after the ladder the IP is blocked', blocked && (await pool.query(`select 1 from ip_rules where ip = $1 and kind = 'block' and auto`, [bad])).rowCount === 1)
    const afterBlock = await login(SAMPLE_ORG, email, pw, at(bad))
    check('a blocked IP cannot sign in, even with the right password', !afterBlock.ok && afterBlock.error === BLOCKED_MSG)

    // a trusted IP (a branch office) is never locked or blocked by the IP ladder
    const office = ip + '-office'
    await pool.query(`insert into ip_rules (org_id, ip, kind, reason) values ($2, $1, 'allow', 'auth-test')`, [office, SAMPLE_ORG.id])
    for (let i = 0; i < FREE_TRIES + STEP; i++) await login(SAMPLE_ORG, `office${i}@x.test`, 'x', at(office))
    check('a trusted IP is never locked', (await pool.query(`select 1 from login_locks where key = $1`, [`ip:${office}`])).rowCount === 0)
  } finally {
    // the test's locks and rules go; log rows stay (they are a log), they age out after 180 days
    await pool.query(`delete from login_locks where key like $1 or key like 'email:ladder%@x.test' or key like 'email:office%@x.test' or key = $2 or key = 'email:nobody@x.test'`, [`ip:${ip}%`, `email:${lower}`])
    await pool.query(`delete from ip_rules where ip like $1`, [`${ip}%`])
    redis.disconnect(); await pool.end()
  }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => { process.exitCode = failed ? 1 : 0 })
