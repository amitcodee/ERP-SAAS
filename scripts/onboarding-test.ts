// Set Up (modules/onboarding): a brand-new institute's steps, ticked by what it really does (branding, a course list,
// the fee settings) or marked done / skipped by head office; only head office may do any of it.
// Against the real DB in ONE rolled-back transaction, on an institute made the real way.
import { sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { provisionOrgIn } from '../modules/orgs/provision'
import { applyCatalogue, defaultGstPct, markStep, onboardingState, saveBranding, saveFees } from '../modules/onboarding/service'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(tx: Tx, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  await tx.execute(sql`savepoint sp`)
  try { await fn(); check(name, false, 'expected error') }
  catch (e) { await tx.execute(sql`rollback to savepoint sp`); const msg = String(e); check(name, !match || match.test(msg), match ? msg.slice(0, 100) : '') }
}
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local role techcadd_app`)
      await tx.execute(sql`select set_config('app.platform', 'true', true), set_config('app.org_id', '', true), set_config('app.role', 'platform', true)`)
      const org = await provisionOrgIn(tx, { name: 'Onboarding Test Academy', slug: 'onboarding-test', ownerName: 'Owner', ownerEmail: 'owner@onboarding.test.invalid' })
      const head: Actor = { userId: org.ownerUserId, orgId: org.orgId, role: 'super_admin', branchId: null }
      const mgr: Actor = { userId: org.ownerUserId, orgId: org.orgId, role: 'branch_manager', branchId: org.branchId }
      await tx.execute(sql`reset role`); await applyTenant(tx, head)
      const state = async () => onboardingState(tx)
      const done = async (k: string) => (await state()).steps.find((s) => s.key === k)!

      const s0 = await state()
      check('a new institute starts with every step to do', s0.settled === 0 && !s0.complete && !s0.dismissed && s0.steps.length === 7, JSON.stringify(s0.steps.map((s) => [s.key, s.done])))

      // branding
      await throws(tx, 'a logo must be a small image', () => saveBranding(tx, head, { legalName: 'Onboarding Test Academy Pvt Ltd', logo: 'data:text/html;base64,PHNjcmlwdD4=' }), /PNG or JPEG/)
      await saveBranding(tx, head, { legalName: 'Onboarding Test Academy Pvt Ltd', tagline: 'Learn by doing', color: '#123456', logo: LOGO })
      const [o] = (await tx.execute<{ legal_name: string; branding: { logo: string; color: string; tagline: string } }>(sql`select legal_name, branding from organisations where id = app_org()`)).rows
      check('branding is kept on the institute and ticks the step', o.legal_name === 'Onboarding Test Academy Pvt Ltd' && o.branding.logo === LOGO && o.branding.color === '#123456' && (await done('branding')).done)

      // courses from a catalogue
      const first = await applyCatalogue(tx, head, 'computer')
      check('a ready-made course list adds its departments and courses', first.departments === 3 && first.courses === 8, JSON.stringify(first))
      const again = await applyCatalogue(tx, head, 'computer')
      check('... and adding it again adds nothing twice', again.departments === 0 && again.courses === 0)
      const [fee] = (await tx.execute<{ base_fee: number; status: string }>(sql`select base_fee, status from courses where title = 'Tally Prime with GST'`)).rows
      check('its courses are approved, fees in paise', fee.base_fee === 900000 && fee.status === 'approved')
      check('... and the step is ticked', (await done('courses')).done)
      await throws(tx, 'an unknown list is refused', () => applyCatalogue(tx, head, 'astrology'), /Unknown course list/)

      // fees
      await saveFees(tx, head, { gstPct: 18, paymentModes: ['UPI', 'Cash'] })
      const modes = (await tx.execute<{ value: string }>(sql`select value from lookups where kind = 'payment_mode'`)).rows.map((r) => r.value)
      check('the usual GST is kept for the registration form', (await defaultGstPct(tx)) === 18)
      check('a new way to pay is added once; existing ones are not doubled', modes.filter((m) => m === 'UPI').length === 1 && modes.filter((m) => m === 'Cash').length === 1)
      check('... and the step is ticked', (await done('fees')).done)
      await saveFees(tx, head, { gstPct: 5 })
      check('changing the GST updates the one setting', (await defaultGstPct(tx)) === 5)
      await throws(tx, 'GST stays a real rate', () => saveFees(tx, head, { gstPct: 40 }))

      // marking and skipping
      await markStep(tx, head, 'import', 'skip')
      await markStep(tx, head, 'email', 'done')
      check('skipped and marked-done steps count as settled', (await done('import')).skipped && (await done('email')).done && (await state()).settled === 5)
      await markStep(tx, head, 'import', 'undo')
      check('a skipped step can be put back', !(await done('import')).skipped)
      await throws(tx, 'only head office sets up the institute', () => markStep(tx, mgr, 'staff', 'done'), /Only head office/)
      await throws(tx, '... nor its branding', () => saveBranding(tx, mgr, { legalName: 'X Y' }), /Only head office/)
      await markStep(tx, head, 'dismiss', 'done')
      check('the checklist can be put away', (await state()).dismissed)
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) { console.error(e); failed++ }
  } finally {
    await pool.end()
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed')
  process.exit(failed ? 1 : 0)
}
main()
