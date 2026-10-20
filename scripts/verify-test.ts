// The public "Verify a certificate" page (/verify): the drawn sum (right answer once, wrong / reused / forged refused,
// nothing readable as text) and the lookup by number (certificate no., registration no. typed loosely, nothing for a
// registration with no certificate). Read-only on the database.
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'
import { pool } from '../lib/db/client'
import { redis } from '../lib/redis'
import { checkPuzzle, makePuzzle } from '../lib/verify-puzzle'
import { findCertificateByNumber } from '../modules/certificates/service'

let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }

async function main() {
  try {
    // ---- the sum ----
    const p = makePuzzle()
    check('the sum is drawn as shapes, not text a script can read', p.svg.startsWith('<svg') && !/<text/.test(p.svg) && !/\d\s*[+−-]\s*\d/.test(p.svg.replace(/<path d="[^"]*"/g, '')))
    // find its answer the way the test may (it knows nothing the page does not): exactly one number in range works
    const right: number[] = []
    const probe = makePuzzle()
    for (let n = -10; n <= 20 && !right.length; n++) if (await checkPuzzle(probe.token, String(n))) right.push(n)
    check('one answer opens it', right.length === 1)
    check('the same sum cannot be used twice', !(await checkPuzzle(probe.token, String(right[0]))))
    const fresh = makePuzzle()
    check('a forged token is refused', !(await checkPuzzle(fresh.token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), '5')) && !(await checkPuzzle('x.y.z', '5')) && !(await checkPuzzle('', '')))
    check('an expired token is refused', !(await checkPuzzle(fresh.token.replace(/^\d{13}/, String(Date.now() - 60_000)), '5')))

    // ---- the lookup ----
    const [c] = (await pool.query<{ cert_no: string; reg_no: string; hash: string }>(`
      select ce.cert_no, r.reg_no, ce.verification_hash as hash from certificates ce join registrations r on r.id = ce.registration_id
      where not ce.is_revoked order by ce.issued_at desc limit 1`)).rows
    if (c) {
      check('found by its certificate number', (await findCertificateByNumber(ORG, c.cert_no))?.href === `/verify/${c.hash}`)
      check('found by the registration number, typed in small letters with spaces', (await findCertificateByNumber(ORG, ` ${c.reg_no.toLowerCase().split('').join(' ')} `))?.href === `/verify/${c.hash}`)
      check('found by the registration number typed without its dashes / slashes', (await findCertificateByNumber(ORG, c.reg_no.replace(/[^A-Za-z0-9]/g, '')))?.href === `/verify/${c.hash}`)
    } else console.log('(no certificate in this database: lookup by number not checked)')
    const [none] = (await pool.query<{ reg_no: string }>(`select r.reg_no from registrations r where not exists (select 1 from certificates ce where ce.registration_id = r.id) limit 1`)).rows
    if (none) check('a registration with no certificate looks the same as an unknown number', (await findCertificateByNumber(ORG, none.reg_no)) === null)
    check('an unknown number finds nothing', (await findCertificateByNumber(ORG, 'TCD/9999/999999')) === null && (await findCertificateByNumber(ORG, 'EV-99-999999')) === null && (await findCertificateByNumber(ORG, 'ab')) === null)
  } catch (e) { console.error(e); failed++ }
  await pool.end()
  redis.disconnect()
  console.log(failed ? `\n${failed} FAILED` : '\nall checks passed (read-only)')
  process.exitCode = failed ? 1 : 0
}
main()
