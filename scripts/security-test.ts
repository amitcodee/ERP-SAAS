// Security fixes from the review, against the real DB in ONE rolled-back transaction.
import { sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, departments, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { branchMatchDetailsIn, branchMatchesIn } from '../modules/people/matches'
import { createRegistration } from '../modules/registrations/service'
import { toCsv } from '../modules/integrations/api'
import { ownsRegistration } from '../modules/portal/study'
import { createNote } from '../modules/teaching/service'
import { askForHelp, chooseHelper, closeHelp, listHelp, offerHelp, withdrawOffer } from '../modules/teaching/service'
import { can } from '../lib/auth/permissions'
import { canManageBranchEmail } from '../lib/config/store'
import { createEnquiry } from '../modules/enquiries/service'
import { cleanQuery } from '../lib/list-query-sql'
import { assertPublicHost, isInternalIp, publicGet } from '../lib/net-guard'
import { userMessage } from '../lib/errors'
import { serverSecret } from '../lib/auth/secret'
import { loadUserStateIn } from '../modules/auth/account'
import { aadhaarColumns, openAadhaar } from '../modules/people/aadhaar-store'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'
import { PLATFORM_SCOPE, seal, unseal } from '../lib/secret-box'
import { classifyHost, sessionFitsHost } from '../lib/tenant/host'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(tx: Tx, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  await tx.execute(sql`savepoint sp`)
  try { await fn(); check(name, false, 'expected error') }
  catch (e) { await tx.execute(sql`rollback to savepoint sp`); const msg = `${e} ${(e as { cause?: unknown }).cause ?? ''}`; check(name, !match || match.test(msg), match ? msg.slice(0, 140) : '') }
}
const as = async (tx: Tx, a: Actor) => { await tx.execute(sql`reset role`); await applyTenant(tx, a) }
/** The server's own connection (as the lookups run): sees every branch. */
const system = async (tx: Tx) => { await tx.execute(sql`reset role`); await tx.execute(sql`set local role techcadd_app`); await tx.execute(sql`select set_config('app.is_super', 'true', true), set_config('app.role', 'system', true)`) }

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [a] = await tx.insert(branches).values({ code: 'SCA', name: 'Sec A', status: 'active' }).returning()
      const [b] = await tx.insert(branches).values({ code: 'SCB', name: 'Sec B', status: 'active' }).returning()
      const mk = async (name: string, branchId: string) => (await tx.execute(sql`reset role`), await tx.insert(users).values({ branchId, name, email: `${name}@sec.test.invalid`, passwordHash: 'x' }).returning())[0]
      const [ua, ub] = [await mk('fa', a.id), await mk('fb', b.id)]
      const [dept] = await tx.select().from(departments).limit(1)
      const frontA: Actor = { userId: ua.id, orgId: ORG, role: 'front_desk', branchId: a.id }
      const frontB: Actor = { userId: ub.id, orgId: ORG, role: 'front_desk', branchId: b.id }

      // ---- 1. branch matching: another branch's person is masked; full details only on request, logged
      await tx.execute(sql`insert into persons (branch_id, first_name, last_name, phone, phone_norm, email, dob, address, father_name)
        values (${a.id}, 'Harpreet', 'Sandhu', '9855500001', '9855500001', 'harpreet@x.test', '2004-04-04', 'House 1, Mohali', 'Gurdev Singh')`)
      await system(tx)
      const fromB = await branchMatchesIn(tx, frontB, { phone: '9855500001' })
      const m = fromB[0]
      check('another branch finds the person', fromB.length === 1 && !m.sameBranch && m.branch === 'Sec A')
      check('... masked: last-name initial and a hidden mobile', m.firstName === 'Harpreet' && m.lastName === 'S.' && m.phone === '98••••••01' && !m.full, `${m.lastName} ${m.phone}`)
      check('... no e-mail, date of birth, address or parents', !m.email && !m.dob && !m.address && !m.fatherName && !m.altPhone)
      const fromA = await branchMatchesIn(tx, frontA, { phone: '9855500001' })
      check('the own branch sees its person in full', fromA[0]?.full === true && fromA[0].email === 'harpreet@x.test' && fromA[0].lastName === 'Sandhu')
      const before = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from audit_logs where action = 'view_person' and entity_id = ${m.personId}`)).rows[0].n
      const full = await branchMatchDetailsIn(tx, frontB, { phone: '9855500001' }, m.personId)
      check('"Use these details" gives the full record', full.full && full.email === 'harpreet@x.test' && full.dob === '2004-04-04' && full.address === 'House 1, Mohali')
      const after = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from audit_logs where action = 'view_person' and entity_id = ${m.personId}`)).rows[0].n
      check('... and the look-up is in the activity log', after === before + 1)
      await throws(tx, 'details only for a person that matches what was typed', () => branchMatchDetailsIn(tx, frontB, { phone: '9855500002' }, m.personId), /does not match/)
      await as(tx, frontA)

      // ---- 2. project help: only the branch, teaching staff and the student — not every staff login
      const role = async (u: { id: string }, r: string) => { await tx.execute(sql`reset role`); await tx.execute(sql`insert into user_roles (user_id, role) values (${u.id}, ${r}) on conflict do nothing`) }
      const [trB, trC, cnA, stU] = [await mk('trainerb', b.id), await mk('trainerc', b.id), await mk('counsa', a.id), await mk('stud', a.id)]
      await role(trB, 'trainer'); await role(trC, 'trainer'); await role(cnA, 'counselor'); await role(ub, 'front_desk')
      const trainerB: Actor = { userId: trB.id, orgId: ORG, role: 'trainer', branchId: b.id }
      const trainerC: Actor = { userId: trC.id, orgId: ORG, role: 'trainer', branchId: b.id }
      const counsA: Actor = { userId: cnA.id, orgId: ORG, role: 'counselor', branchId: a.id }
      await as(tx, counsA)
      const reg = await createRegistration(tx, counsA, { person: { firstName: 'Asker', phone: '9855500009' }, departmentId: dept.id, totalFee: 100000, enrollmentDate: '2026-07-01' })
      await tx.execute(sql`reset role`); await tx.execute(sql`update persons set user_id = ${stU.id} where id = ${reg.personId}`)
      const student: Actor = { userId: stU.id, orgId: ORG, role: 'student', branchId: a.id, personId: reg.personId }
      await as(tx, student)
      const hr = await askForHelp(tx, student, { kind: (await import('../modules/teaching/service')).HELP_KINDS[0].key, title: 'Stuck on React hooks', details: 'useEffect runs twice' })
      const seen = async (who: Actor) => { await as(tx, who); return (await tx.execute<{ n: number }>(sql`select count(*)::int as n from help_requests where id = ${hr.id}`)).rows[0].n === 1 }
      check('a trainer of another branch sees the open request (to offer help)', await seen(trainerB))
      check('the student\'s branch sees it', await seen(counsA))
      check('front desk of another branch does not', !(await seen(frontB)))
      await as(tx, frontB)
      await throws(tx, 'non-teaching staff cannot offer', () => tx.execute(sql`insert into help_offers (request_id, trainer_id) values (${hr.id}, ${ub.id})`), /Failed query|row-level security/)
      await throws(tx, 'nor change a request of another branch', async () => { const r = await tx.execute(sql`update help_requests set status = 'cancelled' where id = ${hr.id} returning id`); if (!r.rows.length) throw new Error('row-level security: no row') }, /row-level security/)
      await as(tx, trainerB)
      await offerHelp(tx, trainerB, hr.id, 'I can help on Saturday')
      await as(tx, trainerC)
      await offerHelp(tx, trainerC, hr.id, 'Me too')
      await throws(tx, 'a trainer cannot remove another trainer\'s offer', async () => { const r = await tx.execute(sql`delete from help_offers where request_id = ${hr.id} and trainer_id = ${trB.id} returning 1`); if (!r.rows.length) throw new Error('row-level security: no row') }, /row-level security/)
      await withdrawOffer(tx, trainerC, hr.id)
      await as(tx, student)
      check('the student sees their request and the one offer left', (await listHelp(tx, student)).some((x) => x.id === hr.id) && (await tx.execute<{ n: number }>(sql`select count(*)::int as n from help_offers where request_id = ${hr.id}`)).rows[0].n === 1)
      await chooseHelper(tx, student, hr.id, trB.id)
      check('assigned: another trainer no longer sees it', !(await seen(trainerC)))
      check('the chosen trainer still does', await seen(trainerB))
      await as(tx, trainerB)
      await closeHelp(tx, trainerB, hr.id, 'done')
      check('the chosen trainer marks it done', (await tx.execute<{ status: string }>(sql`select status from help_requests where id = ${hr.id}`)).rows[0]?.status === 'done')

      // ---- 3. small hardening: note links, CSV formulas, malformed ids
      await as(tx, trainerB)
      await throws(tx, 'a note link must be a web address (javascript: refused)', () => createNote(tx, trainerB, { title: 'x', url: 'javascript:alert(1)' } as never), /http/)
      await throws(tx, '... and data: refused', () => createNote(tx, trainerB, { title: 'x', url: 'data:text/html,<b>hi</b>' } as never), /http/)
      const csv = toCsv([{ a: '=HYPERLINK("http://x")', b: '-500', c: '+91 98', d: '@SUM(1)', e: 'Riya', f: -12.5 }], ['a', 'b', 'c', 'd', 'e', 'f'])
      const cells = csv.split('\r\n')[1]
      check('CSV: formulas shown as text, plain numbers kept', cells.startsWith(`"'=HYPERLINK`) && cells.includes(',-500,') && cells.includes(",'+91 98,") && cells.includes(",'@SUM(1),") && cells.endsWith(',Riya,-12.5'), cells)
      check('a malformed id is "not found", never a database error', (await ownsRegistration(tx, '-'.repeat(36))) === false)

      // ---- 4. internal tickets: the raiser, the assignee, the branch manager (not tickets for head office), head office
      const [c2] = [await mk('couns2', a.id)]
      const couns2: Actor = { userId: c2.id, orgId: ORG, role: 'counselor', branchId: a.id }
      const mgrA: Actor = { userId: (await mk('mgra', a.id)).id, orgId: ORG, role: 'branch_manager', branchId: a.id }
      await as(tx, counsA)
      const [it1] = (await tx.execute<{ id: string }>(sql`insert into support_tickets (branch_id, created_by, kind, category, subject, to_head_office) values (${a.id}, ${cnA.id}, 'internal', 'it', 'Printer broken', false) returning id`)).rows
      const [it2] = (await tx.execute<{ id: string }>(sql`insert into support_tickets (branch_id, created_by, kind, category, subject, to_head_office) values (${a.id}, ${cnA.id}, 'internal', 'hr', 'About my manager', true) returning id`)).rows
      await tx.execute(sql`insert into support_messages (ticket_id, branch_id, author_id, from_staff, body) values (${it2.id}, ${a.id}, ${cnA.id}, true, 'private')`)
      const sees = async (who: Actor, id: string) => { await as(tx, who); return (await tx.execute(sql`select 1 from support_tickets where id = ${id}`)).rows.length === 1 }
      check('internal ticket: a colleague of the branch cannot read it', !(await sees(couns2, it1.id)))
      check('... the branch manager can', await sees(mgrA, it1.id))
      check('a ticket for head office: not even the branch manager', !(await sees(mgrA, it2.id)))
      check('... nor its messages', (await tx.execute(sql`select 1 from support_messages where ticket_id = ${it2.id}`)).rows.length === 0)
      check('the raiser still sees both', (await sees(counsA, it1.id)) && (await sees(counsA, it2.id)))
      const head: Actor = { userId: ua.id, orgId: ORG, role: 'super_admin', branchId: null }
      check('head office sees the one for head office', await sees(head, it2.id))

      // ---- 5. the syllabus: only head office writes the live topics; a change only by its author
      const [course] = (await tx.execute<{ id: string }>(sql`select id from courses limit 1`)).rows
      await as(tx, mgrA)
      await throws(tx, 'a branch manager cannot write the live syllabus directly', () => tx.execute(sql`insert into course_topics (course_id, title) values (${course.id}, 'Sneaky topic')`), /Failed query|row-level/)
      await as(tx, head)
      await tx.execute(sql`insert into syllabus_changes (course_id, branch_id, topics, proposed_by) values (${course.id}, ${a.id}, '[]'::jsonb, ${mgrA.userId}) on conflict do nothing`)
      const [chg] = (await tx.execute<{ id: string; proposed_by: string }>(sql`select id, proposed_by from syllabus_changes where course_id = ${course.id} and status = 'pending'`)).rows
      await as(tx, couns2)
      check('nobody but its author (or head office) can change a waiting change', (await tx.execute(sql`update syllabus_changes set status = 'approved' where id = ${chg.id} returning 1`)).rows.length === 0)
      await as(tx, head)
      check('head office can', (await tx.execute(sql`update syllabus_changes set status = 'rejected', decision_note = 'test' where id = ${chg.id} returning 1`)).rows.length === 1)

      // ---- 6. notes shared with trainers: teaching staff only
      await as(tx, trainerB)
      await tx.execute(sql`insert into notes (branch_id, title, share_trainers, share_students, created_by) values (${b.id}, 'Trainer tips', true, false, ${trB.id})`)
      await as(tx, trainerC)
      check('a note shared with trainers: another trainer sees it', (await tx.execute(sql`select 1 from notes where title = 'Trainer tips'`)).rows.length === 1)
      await as(tx, frontA)
      check('... front desk of another branch does not', (await tx.execute(sql`select 1 from notes where title = 'Trainer tips'`)).rows.length === 0)

      // ---- 7. the October 2026 review
      // the database itself refuses what only head office may do
      await as(tx, mgrA)
      await throws(tx, 'a branch cannot give the super admin role (database rule)', () => tx.execute(sql`insert into user_roles (user_id, role) values (${couns2.userId}, 'super_admin')`), /Only head office can give/)
      await throws(tx, 'a branch cannot reset a login head office made (database rule)', () => tx.execute(sql`update users set password_hash = 'x2' where id = ${cnA.id}`), /Head office made this login/)
      await throws(tx, 'a branch cannot move a person to another branch by an edit (database rule)', () => tx.execute(sql`update persons set branch_id = ${b.id} where phone = '9855500001'`), /transfer|row-level|Failed query/)
      await tx.execute(sql`reset role`)
      // staff shared into a branch for their own work only do not run that branch
      const shared = { role: 'branch_manager', roles: ['branch_manager'], ownOnly: true }
      check('own work only: no user management or settings in that branch', !can(shared, 'update', 'user') && !can(shared, 'create', 'user') && !can(shared, 'update', 'setting') && can(shared, 'read', 'user'))
      check('own work only: not the branch mail server', !canManageBranchEmail({ userId: ua.id, orgId: ORG, role: 'branch_manager', roles: ['branch_manager'], branchId: b.id, ownOnly: true }))
      check('... their day-to-day work stays', can(shared, 'create', 'registration') && can(shared, 'create', 'fee'))
      // a new lead is given to someone else only by those who hand out leads
      await as(tx, frontA)
      await throws(tx, 'front desk cannot assign a new lead to another login', () => createEnquiry(tx, frontA, { person: { firstName: 'Assign', phone: '9855500044' }, departmentId: dept.id, assignedTo: ub.id }), /Forbidden/)
      await tx.execute(sql`reset role`)
      // search and sort input is taken literally
      check('a search for "%" is not a wildcard', cleanQuery({ q: '50%_off' }).like === String.raw`%50\%\_off%`, String(cleanQuery({ q: '50%_off' }).like))
      check('an inherited name is not a sort key', cleanQuery({ sort: 'constructor' }).sort === '' && cleanQuery({ sort: '__proto__' }).sort === '' && cleanQuery({ sort: 'name' }).sort === 'name')
      // outgoing connections never reach the server's own network
      check('internal addresses are recognised', ['127.0.0.1', '10.0.0.5', '172.17.0.2', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', '::ffff:127.0.0.1'].every(isInternalIp) && !isInternalIp('8.8.8.8'))
      // IPv6 spellings of an internal IPv4 (the URL parser turns [::ffff:127.0.0.1] into [::ffff:7f00:1])
      check('IPv6 forms that carry an internal IPv4 are internal too', ['::ffff:7f00:1', '[::ffff:7f00:1]', '::ffff:a9fe:a9fe', '::7f00:1', '::127.0.0.1', '64:ff9b::7f00:1', '64:ff9b::a00:5', '2002:7f00:1::1', '2001:0:4136:e378::1', 'fe80::1', 'ff02::1', '0:0:0:0:0:0:0:1'].every(isInternalIp)
        && !['2606:4700:4700::1111', '::ffff:808:808', '64:ff9b::808:808', '2002:808:808::1'].some(isInternalIp))
      check('a picture link to the server itself is refused at connect time', await publicGet(new URL('http://[::ffff:127.0.0.1]:9/x.png'), 1000).then(() => false, (e) => /not allowed/.test(String(e))))
      check('a picture link to localhost by name is refused', await publicGet(new URL('http://localhost:9/x.png'), 1000).then(() => false, (e) => /not allowed/.test(String(e))))
      for (const host of ['postgres', 'techcadd-panel-redis', 'localhost', '127.0.0.1', '169.254.169.254']) {
        check(`a mail server / webhook at "${host}" is refused`, await assertPublicHost(host).then(() => false, () => true))
      }
      // database errors are not shown as they are
      const dbErr = Object.assign(new Error('Failed query: select secret from users'), { cause: Object.assign(new Error('relation "x" does not exist'), { code: '42P01' }) })
      check('a database error reaches the user as a plain sentence', userMessage(dbErr) === 'Something went wrong. Please try again.')
      check('... a business rule is shown as written', userMessage(new Error('Nothing is due')) === 'Nothing is due')
      // weak secrets stop the panel
      const saved = process.env.CRON_SECRET
      process.env.CRON_SECRET = 'short'
      check('a short secret is refused', (() => { try { serverSecret('CRON_SECRET'); return false } catch { return true } })())
      process.env.CRON_SECRET = saved
      // "Sign out" ends the sign-in for good
      await tx.execute(sql`insert into revoked_sessions (sid, expires_at) values ('test-sid-1', now() + interval '1 hour')`)
      check('a signed-out session is refused', (await loadUserStateIn(tx, ua.id, 'test-sid-1'))?.signedOut === true && (await loadUserStateIn(tx, ua.id, 'other-sid'))?.signedOut === false)
      // Aadhaar numbers are stored encrypted
      const aad = aadhaarColumns(ORG, '2345 6789 0124')
      check('an Aadhaar number is stored sealed, with the last 4 apart', !!aad.aadhaarNo && !aad.aadhaarNo.includes('234567890124') && aad.aadhaarLast4 === '0124' && openAadhaar(ORG, aad.aadhaarNo) === '234567890124')

      // ---- across institutes ---------------------------------------------------------------------------------------
      const OTHER = '00000000-0000-4000-8000-0000000000ff'
      check('an Aadhaar number sealed for one institute does not open as another’s', openAadhaar(OTHER, aad.aadhaarNo!) === null)
      const box = seal({ password: 'mailbox-secret' }, 'settings-secrets', ORG)
      check('a settings secret opens only for its own institute and purpose', unseal<{ password: string }>(box, 'settings-secrets', ORG)?.password === 'mailbox-secret'
        && unseal(box, 'settings-secrets', OTHER) === null && unseal(box, 'personal-ids', ORG) === null && unseal(box, 'settings-secrets', PLATFORM_SCOPE) === null)
      // which institute a host is: no spoofing by look-alike names
      // '' = no default org (undefined would take DEFAULT_ORG_SLUG from the environment)
      const kinds = (root: string | undefined, ...hosts: string[]) => hosts.map((h) => { const k = classifyHost(h, root, ''); return k.kind === 'org' ? `org:${k.slug}` : k.kind })
      check('hosts: a subdomain of the root is that institute; the console and the apex are not institutes',
        kinds('example.com', 'acme.example.com', 'ACME.Example.com.', 'admin.example.com', 'www.example.com', 'example.com', 'api.example.com').join() === 'org:acme,org:acme,platform,apex,apex,apex')
      check('hosts: look-alikes are only someone’s possible custom domain, never an institute by slug',
        kinds('example.com', 'acme.example.com.evil.net', 'a.b.example.com', 'acmeexample.com', 'acme.localhost.evil.net').every((k) => k === 'custom'))
      check('a session never fits another institute’s host, nor the console',
        sessionFitsHost(classifyHost('acme.example.com', 'example.com'), 'acme') && !sessionFitsHost(classifyHost('other.example.com', 'example.com'), 'acme')
          && !sessionFitsHost(classifyHost('admin.example.com', 'example.com'), 'acme') && !sessionFitsHost(classifyHost('ACME2.localhost:3000'), 'acme'))
      // a custom domain counts only once verified
      await tx.execute(sql`reset role`)
      await tx.execute(sql`insert into org_domains (org_id, host, token) values (${ORG}, 'learn.sample-test.invalid', 'tok')`)
      const viaDomain = async () => (await tx.execute<{ id: string }>(sql`select id from org_for_host(null, 'learn.sample-test.invalid')`)).rows[0]?.id ?? null
      check('an unverified custom domain resolves to no institute', (await viaDomain()) === null)
      await tx.execute(sql`update org_domains set verified_at = now() where host = 'learn.sample-test.invalid'`)
      check('... and to its own once verified', (await viaDomain()) === ORG)
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) { console.error(e); failed++ }
  }
  await pool.end()
  console.log(failed ? `\n${failed} FAILED` : '\nall checks passed (rolled back, DB untouched)')
  process.exitCode = failed ? 1 : 0
}
main()
