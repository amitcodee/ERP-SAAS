// The tenancy boundary, checked three ways (PLAN.md 1.13):
//  1. the catalogue: every table is tenant or platform; each tenant table carries org_id the right way, has RLS on and
//     forced, the restrictive org guard and the read-only write guards; every foreign key between tenant tables has
//     its org companion; unique keys lead with org_id; no business sequence is shared; every SECURITY DEFINER
//     function names the org (or the platform); every view runs as its caller;
//  2. the data: another institute, seen from the Sample Institute and the other way round, for every tenant table;
//     changes across the line touch nothing; a row cannot be stamped with, or point at, another institute;
//  3. the code: every server action and route signs the caller in (or names its public resolver); no raw database
//     handle or platform context outside the few files that need one.
// Read-only on the catalogue and code; the data part runs in ONE rolled-back transaction.
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'
import { applyOrgSystem, applyTenant, type Tx } from '../lib/db/withTenant'
import { provisionOrgIn } from '../modules/orgs/provision'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
const list = (xs: string[]) => (xs.length ? xs.slice(0, 12).join(', ') + (xs.length > 12 ? ` … (${xs.length})` : '') : '')

/** Tables of the platform itself (no org_id guard). Everything else is an org's data. */
const PLATFORM = ['billing_events', 'coupons', 'ip_geo', 'organisations', 'org_domains', 'plans', 'platform_config', 'platform_counters', 'platform_announcements', 'platform_invoices', 'platform_payments', 'platform_users', 'signups', 'subscriptions', 'support_sessions']
/** Tenant tables that stay writable while an org is read-only: signing in and out, the audit trail, job bookkeeping. */
const WRITABLE_WHEN_READ_ONLY = ['audit_logs', 'job_runs', 'login_attempts', 'login_locks', 'revoked_sessions']
/** Unique keys that are global on purpose: a public link or key carries them, and the host's org must still match. */
const GLOBAL_UNIQUE = ['api_keys.key_hash', 'certificates.verification_hash', 'events.token', 'event_participants.hash', 'notifications.dedupe_key', 'revoked_sessions.sid']
/** SECURITY DEFINER functions that need no org filter, and why. */
const DEFINER_OK: Record<string, string> = {
  org_for_host: 'resolves a host to an org before anyone signs in: returns only id, slug, name, status',
  platform_org_stats: 'platform only (checks app_is_platform())',
  platform_job_health: 'platform only (checks app_is_platform()); counts and the last error of each org’s jobs',
  platform_orgs_for_email: 'platform only (checks app_is_platform()); returns institute ids, nothing of the login',
  app_org_seq: 'writes only the transaction org’s counter (checks app_org())',
  app_can_teach: 'only calls app_has_perm(), which filters by app_org()',
  app_is_branch_manager: 'only calls app_has_perm(), which filters by app_org()',
}
/** Sequences that are not a table's id counter, and why that is fine. */
const SEQUENCE_OK: Record<string, string> = {
  fee_ledger_seq_seq: 'fee_ledger.seq only orders a student’s ledger rows; it is never shown and numbers nothing',
}

async function catalogue(tx: Tx) {
  const rows = async <T,>(q: ReturnType<typeof sql>) => (await tx.execute<T & Record<string, unknown>>(q)).rows
  const tables = (await rows<{ t: string; rls: boolean; forced: boolean }>(sql`
    select c.relname as t, c.relrowsecurity as rls, c.relforcerowsecurity as forced from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`))
  const tenant = tables.filter((t) => !PLATFORM.includes(t.t))
  const T = new Set(tenant.map((t) => t.t))

  const cols = await rows<{ t: string; nullable: string; def: string | null }>(sql`
    select table_name as t, is_nullable as nullable, column_default as def from information_schema.columns where table_schema = 'public' and column_name = 'org_id'`)
  const bad = tenant.filter((t) => { const c = cols.find((x) => x.t === t.t); return !c || c.nullable !== 'NO' || !/app_org\(\)/.test(c.def ?? '') })
  check('every tenant table has org_id NOT NULL DEFAULT app_org()', !bad.length, list(bad.map((t) => t.t)))
  check('... and row-level security on and forced', tenant.every((t) => t.rls && t.forced), list(tenant.filter((t) => !t.rls || !t.forced).map((t) => t.t)))

  const pols = await rows<{ t: string; name: string; permissive: string; cmd: string; qual: string | null; chk: string | null }>(sql`
    select tablename as t, policyname as name, permissive, cmd, qual, with_check as chk from pg_policies where schemaname = 'public'`)
  const guarded = (t: string) => pols.some((p) => p.t === t && p.name === 'org_guard' && p.permissive === 'RESTRICTIVE' && p.cmd === 'ALL' && /org_id = app_org\(\)/.test(p.qual ?? '') && /org_id = app_org\(\)/.test(p.chk ?? ''))
  check('... and the restrictive org guard (org_id = app_org(), read and write)', tenant.every((t) => guarded(t.t)), list(tenant.filter((t) => !guarded(t.t)).map((t) => t.t)))
  const roGuarded = (t: string) => ['INSERT', 'UPDATE', 'DELETE'].every((cmd) => pols.some((p) => p.t === t && p.permissive === 'RESTRICTIVE' && p.cmd === cmd && /app_read_only\(\)/.test(`${p.qual ?? ''} ${p.chk ?? ''}`)))
  const noRo = tenant.filter((t) => !WRITABLE_WHEN_READ_ONLY.includes(t.t) && !roGuarded(t.t))
  check('... and the read-only write guards (except sign-in, audit and job bookkeeping)', !noRo.length, list(noRo.map((t) => t.t)))
  check('platform tables have row-level security too', tables.filter((t) => PLATFORM.includes(t.t)).every((t) => t.rls && t.forced))

  // foreign keys between tenant tables: each has an (org_id, col) companion onto the same parent
  const fks = await rows<{ name: string; child: string; parent: string; cols: string[] }>(sql`
    select con.conname as name, ch.relname as child, pa.relname as parent,
      array(select a.attname::text from unnest(con.conkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.o) as cols
    from pg_constraint con join pg_class ch on ch.oid = con.conrelid join pg_class pa on pa.oid = con.confrelid join pg_namespace n on n.oid = ch.relnamespace
    where con.contype = 'f' and n.nspname = 'public'`)
  const lonely = fks.filter((f) => T.has(f.child) && T.has(f.parent) && !f.cols.includes('org_id'))
    .filter((f) => !fks.some((g) => g.child === f.child && g.parent === f.parent && g.cols.length === 2 && g.cols[0] === 'org_id' && g.cols[1] === f.cols[0]))
  check('every foreign key between tenant tables has its org companion', !lonely.length, list(lonely.map((f) => `${f.child}.${f.cols.join('+')}`)))

  // unique keys lead with org_id, or with a uuid (a row id: unique across every org already), or are global on purpose
  const uniques = await rows<{ t: string; idx: string; cols: string[]; first: string | null }>(sql`
    select c.relname as t, i.relname as idx,
      array(select coalesce(a.attname::text, '(expr)') from unnest(x.indkey) with ordinality k(n, o) left join pg_attribute a on a.attrelid = x.indrelid and a.attnum = k.n order by k.o) as cols,
      (select format_type(a.atttypid, a.atttypmod) from pg_attribute a where a.attrelid = x.indrelid and a.attnum = x.indkey[0]) as first
    from pg_index x join pg_class c on c.oid = x.indrelid join pg_class i on i.oid = x.indexrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and x.indisunique`)
  const global = uniques.filter((u) => T.has(u.t) && u.cols[0] !== 'org_id' && u.first !== 'uuid' && !(u.idx.endsWith('_pkey') && u.cols.join() === 'id') && !GLOBAL_UNIQUE.includes(`${u.t}.${u.cols.join('+')}`))
  check('unique keys of tenant tables lead with org_id (or are global on purpose)', !global.length, list(global.map((u) => `${u.idx}(${u.cols.join(', ')})`)))

  // sequences: only a table's own id counters (owned by their column); business numbers are per org (org_sequences)
  const seqs = await rows<{ s: string; owner: string | null }>(sql`
    select s.relname as s, (select a.attname::text from pg_depend d join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
      where d.objid = s.oid and d.deptype in ('a', 'i') limit 1) as owner
    from pg_class s join pg_namespace n on n.oid = s.relnamespace where s.relkind = 'S' and n.nspname = 'public'`)
  const shared = seqs.filter((x) => x.owner !== 'id' && !SEQUENCE_OK[x.s])
  check('no sequence is shared: each one is a table’s own id counter (or audited)', !shared.length, list(shared.map((x) => x.s)))
  const defaults = await rows<{ t: string; c: string; def: string }>(sql`
    select table_name as t, column_name as c, column_default as def from information_schema.columns where table_schema = 'public' and column_default like '%nextval(%' and column_name <> 'id'`)
  check('no column outside an id draws from a sequence', !defaults.length, list(defaults.map((d) => `${d.t}.${d.c}`)))

  // SECURITY DEFINER skips row-level security: each must filter by the org itself
  const defs = await rows<{ f: string; body: string }>(sql`
    select p.proname as f, p.prosrc as body from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef`)
  const unfiltered = defs.filter((d) => !DEFINER_OK[d.f] && !/app_org\(\)/.test(d.body))
  check(`every SECURITY DEFINER function (${defs.length}) names the org, or is audited as not needing to`, !unfiltered.length, list(unfiltered.map((d) => d.f)))

  const views = await rows<{ v: string; opts: string[] | null }>(sql`
    select c.relname as v, c.reloptions as opts from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v'`)
  check(`every view (${views.length}) runs as its caller (security_invoker), so RLS applies through it`, views.every((v) => (v.opts ?? []).includes('security_invoker=true')), list(views.filter((v) => !(v.opts ?? []).includes('security_invoker=true')).map((v) => v.v)))
  return tenant.map((t) => t.t)
}

async function data(tx: Tx, tenant: string[]) {
  const sp = async <T,>(fn: () => Promise<T>): Promise<{ ok: true; v: T } | { ok: false; e: string }> => {
    await tx.execute(sql`savepoint s`)
    try { const v = await fn(); await tx.execute(sql`release savepoint s`); return { ok: true, v } }
    catch (e) { await tx.execute(sql`rollback to savepoint s`); return { ok: false, e: String(e) + ' ' + String((e as { cause?: unknown }).cause ?? '') } }
  }
  // org B, made the way a real one is
  await tx.execute(sql`set local role techcadd_app`)
  await tx.execute(sql`select set_config('app.platform', 'true', true), set_config('app.org_id', '', true), set_config('app.role', 'platform', true)`)
  const b = await provisionOrgIn(tx, { name: 'Tenancy Test B', slug: 'tenancy-test-b', ownerName: 'Owner B', ownerEmail: 'owner@tenancy-b.test.invalid' })
  await tx.execute(sql`reset role`)
  const [counts] = (await tx.execute<Record<string, number>>(sql.raw(`select ${tenant.map((t) => `(select count(*)::int from ${t} where org_id = '${b.orgId}') as "${t}"`).join(', ')}`))).rows
  const bTables = tenant.filter((t) => counts[t] > 0)
  check(`org B has rows in ${bTables.length} tables`, bTables.length >= 6, list(bTables))
  const [aCounts] = (await tx.execute<Record<string, number>>(sql.raw(`select ${tenant.map((t) => `(select count(*)::int from ${t} where org_id = '${ORG}') as "${t}"`).join(', ')}`))).rows
  const aTables = tenant.filter((t) => aCounts[t] > 0)

  // A's head office and system see nothing of B, for every table; and the other way round
  const sees = async (orgId: string, other: string, tables: string[]) => {
    await tx.execute(sql`reset role`); await applyOrgSystem(tx, orgId)
    const out: string[] = []
    for (const t of tables) {
      const r = await sp(() => tx.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${t} where org_id = '${other}'`)))
      if (!r.ok) { if (!/permission denied/.test(r.e)) out.push(`${t}: ${r.e.slice(0, 60)}`) } // no SELECT at all: nothing seen either
      else if (r.v.rows[0].n !== 0) out.push(`${t}: ${r.v.rows[0].n}`)
    }
    return out
  }
  const aSeesB = await sees(ORG, b.orgId, bTables)
  check('the Sample Institute (whole-org view) sees none of B’s rows, in any table', !aSeesB.length, list(aSeesB))
  const bSeesA = await sees(b.orgId, ORG, aTables)
  check(`B (whole-org view) sees none of the Sample Institute’s rows, in any of its ${aTables.length} tables`, !bSeesA.length, list(bSeesA))
  // the views (fee balance, dues, …) run as the caller: B sees nothing of A through them either
  const views = (await tx.execute<{ v: string }>(sql`select c.relname as v from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v'`)).rows.map((r) => r.v)
  const viewRows = async (orgId: string) => { await tx.execute(sql`reset role`); await applyOrgSystem(tx, orgId); let n = 0; for (const v of views) n += (await tx.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${v}`))).rows[0].n; return n }
  const [inA, inB] = [await viewRows(ORG), await viewRows(b.orgId)]
  check(`through the ${views.length} views, B sees none of the Sample Institute’s ${inA} rows`, inA > 0 && inB === 0, `A ${inA}, B ${inB}`)
  await tx.execute(sql`reset role`); await applyTenant(tx, { userId: b.ownerUserId, orgId: b.orgId, role: 'super_admin', branchId: null })
  const bHead = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from users`)).rows[0].n
  check('... and B’s head office sees exactly its own one login', bHead === 1)

  // changes across the line touch nothing
  await tx.execute(sql`reset role`); await applyOrgSystem(tx, ORG)
  const touched: string[] = []
  for (const t of bTables) {
    const u = await sp(() => tx.execute(sql.raw(`update ${t} set org_id = org_id where org_id = '${b.orgId}'`)))
    if (u.ok && u.v.rowCount) touched.push(`update ${t}: ${u.v.rowCount}`)
    const d = await sp(() => tx.execute(sql.raw(`delete from ${t} where org_id = '${b.orgId}'`)))
    if (d.ok && d.v.rowCount) touched.push(`delete ${t}: ${d.v.rowCount}`)
  }
  check('UPDATE and DELETE of B’s rows from the Sample Institute change 0 rows', !touched.length, list(touched))
  const stamped = await sp(() => tx.execute(sql`insert into lookups (org_id, kind, value) values (${b.orgId}, 'enquiry_source', 'smuggled')`))
  check('a row stamped with another org is refused', !stamped.ok && /row-level security/.test(stamped.e))
  const bBranch = (await tx.execute<{ id: string }>(sql`select ${b.branchId}::uuid as id`)).rows[0].id
  const pointing = await sp(() => tx.execute(sql`insert into users (name, email, password_hash, branch_id) values ('X', 'x@cross.test.invalid', 'x', ${bBranch})`))
  check('a row pointing at another org’s row is refused (org companion key)', !pointing.ok && /foreign key|violates/.test(pointing.e), pointing.ok ? 'inserted' : pointing.e.slice(0, 80))
  const moved = await sp(() => tx.execute(sql`update branches set org_id = ${b.orgId} where org_id = ${ORG}`))
  check('a row cannot be moved to another org', !moved.ok || !moved.v.rowCount)

  // a read-only org writes nothing
  await tx.execute(sql`reset role`); await applyTenant(tx, { userId: b.ownerUserId, orgId: b.orgId, role: 'super_admin', branchId: null, readOnly: true })
  const ro = await sp(() => tx.execute(sql`insert into lookups (kind, value) values ('enquiry_source', 'while read-only')`))
  check('a read-only org cannot write', !ro.ok && /row-level security/.test(ro.e))
  const roAudit = await sp(() => tx.execute(sql`insert into audit_logs (user_id, action, entity) values (${b.ownerUserId}, 'look', 'test')`))
  check('... but its audit trail still records', roAudit.ok)
}

// ---- the code -------------------------------------------------------------------------------------------------------
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [] })
const rel = (p: string) => p.replace(/\\/g, '/')
/** What signs a caller in, or names how a public route finds its org. */
const AUTH = /siteOnly\(|getActor\(|requirePage\(|loadPanelBase\(|branchEmailOwner\(|headOffice\(\)|requirePlatform\(|requireRequestOrg\(|requestOrg\(|requestHost\(|webLeadsAuthorized\(|apiKeyFrom|authorizeApiKey|CRON_SECRET|cronAuthorized|readChallenge\(|readSupportLink\(|verifyCallback\(|verifyWebhook\(/
/** Server actions with nothing to protect: they touch no org's data. */
const PUBLIC_ACTIONS: Record<string, string> = {
  logoutAction: 'clears this browser’s cookies (and revokes its own session id)',
  platformLogoutAction: 'clears the platform cookie',
  newPuzzleAction: 'a fresh sum for the public certificate check; rate-limited, no data',
  startQuizAction: 'signs a start time for an event quiz (HMAC, no database); the answers are checked against the org of the host',
}
/** Routes with nothing to protect. */
const PUBLIC_OK = ['app/api/health/route.ts', 'app/api/logout/route.ts', 'app/api/face-wasm/[file]/route.ts']

function code() {
  const all = ['app', 'lib', 'modules', 'components'].flatMap(files).map(rel)
  const routes = all.filter((f) => f.startsWith('app/') && /\/route\.ts$/.test(f) && !PUBLIC_OK.includes(f))
  const open = routes.filter((f) => !AUTH.test(readFileSync(f, 'utf8')))
  check(`every route (${routes.length}) signs the caller in or names its public resolver`, !open.length, list(open))

  const actionFiles = all.filter((f) => f.startsWith('app/') && /^['"]use server['"]/m.test(readFileSync(f, 'utf8')))
  const unguarded: string[] = []
  for (const f of actionFiles) {
    const src = readFileSync(f, 'utf8')
    for (const chunk of src.split(/\nexport async function /).slice(1)) {
      const name = chunk.slice(0, chunk.indexOf('('))
      const body = chunk.slice(0, (chunk.indexOf('\n}\n') + 1) || undefined)
      if (!AUTH.test(body) && !PUBLIC_ACTIONS[name]) unguarded.push(`${f}:${name}`)
    }
  }
  check(`every server action (${actionFiles.length} files) signs the caller in or names its public resolver`, !unguarded.length, list(unguarded))

  const RAW_OK = ['lib/db/withTenant.ts', 'lib/db/client.ts', 'app/api/health/route.ts', 'lib/scheduler.ts', 'modules/ops/recycle.ts', 'app/api/import-old/route.ts']
  const raw = all.filter((f) => !RAW_OK.includes(f) && /from ['"](@\/lib\/db\/client|\.\.?\/(\.\.\/)*db\/client|\.\/client)['"]/.test(readFileSync(f, 'utf8')))
  check('no raw database handle outside the audited files', !raw.length, list(raw))
  // each reads or writes platform tables (plans, sign-ups, organisations, billing) or the find-my-institute function or
  // a ping; billing and dunning step into one org's own context only to write its audit log
  const PLATFORM_OK = ['lib/db/withTenant.ts', 'lib/app-url.ts', 'lib/ip-geo.ts', 'lib/tenant/orgs.ts', 'lib/tenant/resolve.ts', 'modules/orgs/provision.ts', 'modules/platform/service.ts',
    'modules/plans/service.ts', 'modules/signup/service.ts', 'app/site/status/page.tsx', 'modules/billing/service.ts', 'modules/billing/dunning.ts', 'modules/platform/console.ts']
  const plat = all.filter((f) => !PLATFORM_OK.includes(f) && /withPlatform\(/.test(readFileSync(f, 'utf8')))
  check('the platform context (withPlatform) only in the audited files', !plat.length, list(plat))
  return { RAW_OK, PLATFORM_OK }
}

async function main() {
  try {
    code()
    await db.transaction(async (tx) => {
      const tenant = await catalogue(tx)
      await data(tx, tenant)
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
