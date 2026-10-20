// Sign-in protection: a log of every attempt, a lockout ladder for wrong passwords, and IP block / trust rules.
//
// The ladder (per IP and per account): the first 4 wrong passwords are free; the 5th locks for 30 seconds, then every
// 3 more wrong tries lock longer: 1 min, 10 min, 30 min, 1 hour. One more round after the hour and the IP is blocked
// until head office unblocks it (the account itself is never blocked for good, only locked for an hour at a time,
// so nobody can shut a real person out). A correct password clears both; a quiet day starts the ladder over.
// IPs head office trusts (a branch office) are never locked or blocked; private / unknown IPs are never blocked.
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { assertCan } from '@/lib/auth/permissions'
import { isPrivateIp, normalizeIp } from '@/lib/client-ip'
import { withOrgSystem, type Actor, type Tx } from '@/lib/db/withTenant'
import { log } from '@/lib/log'

export const FREE_TRIES = 4
export const STEP = 3
/** Lock lengths, in seconds, for each step up the ladder. After the last one the IP is blocked. */
export const LADDER = [30, 60, 10 * 60, 30 * 60, 60 * 60] as const
const QUIET_RESET_HOURS = 24

export type AttemptResult = 'success' | 'two_factor_sent' | 'wrong_password' | 'unknown_email' | 'inactive' | 'branch_not_ready' | 'locked' | 'blocked_ip' | 'two_factor_wrong'
export type Ctx = { ip: string | null; userAgent: string | null }

const ipKey = (ip: string) => `ip:${ip}`
const emailKey = (email: string) => `email:${email}`

/** "30 seconds", "1 minute", "10 minutes", "1 hour". */
export function waitText(sec: number) {
  if (sec < 60) return `${Math.max(1, Math.ceil(sec))} seconds`
  const m = Math.ceil(sec / 60)
  if (m < 60) return m === 1 ? '1 minute' : `${m} minutes`
  const h = Math.round(m / 60)
  return h === 1 ? '1 hour' : `${h} hours`
}

export const BLOCKED_MSG = 'Sign-in from your network is blocked after too many wrong passwords. Ask head office to unblock it.'
const lockedMsg = (sec: number) => `Too many wrong passwords. Try again in ${waitText(sec)}.`

export async function recordAttempt(tx: Tx, a: { email: string | null; userId?: string | null; result: AttemptResult } & Ctx) {
  await tx.execute(sql`insert into login_attempts (email, user_id, ip, user_agent, result)
    values (${a.email}, ${a.userId ?? null}, ${a.ip}, ${a.userAgent?.slice(0, 400) ?? null}, ${a.result})`)
}

/** Before the password is checked: null to go ahead, or the message (the attempt is then logged as locked / blocked). */
export async function checkGate(tx: Tx, email: string, ctx: Ctx): Promise<string | null> {
  // one sign-in at a time per account and per IP (until this transaction ends), so a burst of parallel guesses cannot
  // all pass the check below before the first wrong one is counted. Always the account first, then the IP: no deadlock.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(app_org()::text || ${emailKey(email)}))`)
  if (ctx.ip) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(app_org()::text || ${ipKey(ctx.ip)}))`)
  const rule = ctx.ip ? (await tx.execute<{ kind: 'block' | 'allow' }>(sql`select kind from ip_rules where ip = ${ctx.ip}`)).rows[0]?.kind : undefined
  if (rule === 'block') { await recordAttempt(tx, { email, result: 'blocked_ip', ...ctx }); return BLOCKED_MSG }
  // A lock on the account (wrong passwords from anywhere) does not hold back a trusted IP, or one this account has
  // signed in from in the last 30 days: otherwise anyone could keep a real person (even head office) locked out.
  // Wrong passwords from there still count, and still lock the IP.
  const knownIp = !!ctx.ip && rule !== 'allow' && (await tx.execute(sql`select 1 from login_attempts
    where email = ${email} and ip = ${ctx.ip} and result in ('success', 'two_factor_sent') and at > now() - interval '30 days' limit 1`)).rows.length > 0
  const keys = [...(rule === 'allow' || knownIp ? [] : [emailKey(email)]), ...(ctx.ip && rule !== 'allow' ? [ipKey(ctx.ip)] : [])]
  if (!keys.length) return null
  const r = (await tx.execute<{ wait: number }>(sql`
    select greatest(0, extract(epoch from max(locked_until) - now()))::float as wait from login_locks
    where key in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)}) and locked_until > now()`)).rows[0]
  if (r?.wait) { await recordAttempt(tx, { email, result: 'locked', ...ctx }); return lockedMsg(r.wait) }
  return null
}

/** One more wrong try on a key. Returns the lock it caused (seconds), 'block' for an IP past the ladder, or null. */
async function failKey(tx: Tx, key: string, isIp: boolean): Promise<number | 'block' | null> {
  const [row] = (await tx.execute<{ failures: number; level: number }>(sql`
    insert into login_locks (key, failures, level, last_failed_at) values (${key}, 1, 0, now())
    on conflict (org_id, key) do update set
      failures = case when login_locks.last_failed_at < now() - make_interval(hours => ${QUIET_RESET_HOURS}) then 1 else login_locks.failures + 1 end,
      level = case when login_locks.last_failed_at < now() - make_interval(hours => ${QUIET_RESET_HOURS}) then 0 else login_locks.level end,
      last_failed_at = now()
    returning failures, level`)).rows
  const over = row.failures - FREE_TRIES
  if (over < 1 || (over - 1) % STEP !== 0) return null
  const step = (over - 1) / STEP // 0 → 30 s, 1 → 1 min, … 4 → 1 h, 5 → past the ladder
  if (step >= LADDER.length && isIp) return 'block'
  const sec = LADDER[Math.min(step, LADDER.length - 1)]
  await tx.execute(sql`update login_locks set level = ${step + 1}, locked_until = now() + make_interval(secs => ${sec}) where key = ${key}`)
  return sec
}

/** After a wrong password (or unknown account): counts it on the account and the IP. Returns the message to show, or null. */
export async function registerFailure(tx: Tx, email: string, ctx: Ctx): Promise<string | null> {
  const trusted = ctx.ip ? (await tx.execute(sql`select 1 from ip_rules where ip = ${ctx.ip} and kind = 'allow'`)).rows.length > 0 : false
  const byEmail = await failKey(tx, emailKey(email), false)
  const byIp = ctx.ip && !trusted ? await failKey(tx, ipKey(ctx.ip), true) : null
  if (byIp === 'block') {
    if (isPrivateIp(ctx.ip!)) {
      await tx.execute(sql`update login_locks set locked_until = now() + make_interval(secs => ${LADDER[LADDER.length - 1]}) where key = ${ipKey(ctx.ip!)}`)
      return lockedMsg(LADDER[LADDER.length - 1])
    }
    await tx.execute(sql`insert into ip_rules (ip, kind, reason, auto) values (${ctx.ip}, 'block', 'Too many wrong passwords', true) on conflict (org_id, ip) do nothing`)
    log.warn('ip_auto_blocked', { ip: ctx.ip, email })
    return BLOCKED_MSG
  }
  const sec = Math.max(typeof byIp === 'number' ? byIp : 0, byEmail === 'block' ? 0 : (byEmail ?? 0))
  return sec ? lockedMsg(sec) : null
}

/** A correct password: the ladder starts over for this account and this IP. */
export async function clearFailures(tx: Tx, email: string, ip: string | null) {
  const keys = [emailKey(email), ...(ip ? [ipKey(ip)] : [])]
  await tx.execute(sql`delete from login_locks where key in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`)
}

/** Logs an attempt on the server's own connection (for the steps that have no transaction open). */
export const logAttempt = (orgId: string, a: { email: string | null; userId?: string | null; result: AttemptResult } & Ctx) =>
  withOrgSystem(orgId, (tx) => recordAttempt(tx, a)).catch((e) => log.error('login_attempt_log_failed', { error: e instanceof Error ? e.message : String(e) }))

// ---- head office: the sign-in log, locks, blocked and trusted IPs

export type LoginLogRow = { id: string; at: string; email: string | null; user: string | null; ip: string | null; userAgent: string | null; result: AttemptResult; place: string | null; isp: string | null; blocked: boolean; trusted: boolean }
export type IpRuleRow = { ip: string; kind: 'block' | 'allow'; reason: string | null; auto: boolean; by: string | null; at: string; place: string | null; isp: string | null; tries: number }
export type LockRow = { key: string; kind: 'ip' | 'email'; value: string; failures: number; level: number; until: string }
export type LoginStats = { today: number; failedToday: number; lockedNow: number; blocked: number }

const PAGE = 50
const place = (g: { city: string | null; region: string | null; country: string | null }) => [g.city, g.region, g.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ') || null

const headOffice = (actor: Actor) => assertCan(actor, 'update', 'setting')

export const loginLogQuery = z.object({
  q: z.string().trim().max(120).optional().default(''),
  result: z.enum(['', 'success', 'failed', 'locked', 'blocked_ip', 'two_factor']).optional().default(''),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')).default(''),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')).default(''),
  page: z.number().int().min(1).max(10_000).optional().default(1),
})

export async function listLoginLog(tx: Tx, actor: Actor, raw: z.input<typeof loginLogQuery>): Promise<{ rows: LoginLogRow[]; total: number; pages: number }> {
  headOffice(actor)
  const f = loginLogQuery.parse(raw)
  const like = `%${f.q.toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`
  const where = sql.join([
    sql`true`,
    f.q ? sql`(lower(coalesce(a.email, '')) like ${like} or coalesce(a.ip, '') like ${like} or lower(coalesce(u.name, '')) like ${like})` : sql`true`,
    f.result === 'success' ? sql`a.result = 'success'`
      : f.result === 'failed' ? sql`a.result in ('wrong_password', 'unknown_email', 'inactive', 'branch_not_ready', 'two_factor_wrong')`
      : f.result === 'two_factor' ? sql`a.result in ('two_factor_sent', 'two_factor_wrong')`
      : f.result ? sql`a.result = ${f.result}` : sql`true`,
    f.from ? sql`a.at >= (${f.from}::date)::timestamp at time zone 'Asia/Kolkata'` : sql`true`,
    f.to ? sql`a.at < ((${f.to}::date + 1)::timestamp at time zone 'Asia/Kolkata')` : sql`true`,
  ], sql` and `)
  const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from login_attempts a left join users u on u.id = a.user_id where ${where}`)).rows
  const rows = (await tx.execute<{ id: string; at: string; email: string | null; user: string | null; ip: string | null; user_agent: string | null; result: AttemptResult; city: string | null; region: string | null; country: string | null; isp: string | null; rule: string | null }>(sql`
    select a.id::text, a.at, a.email, u.name as user, a.ip, a.user_agent, a.result, g.city, g.region, g.country, g.isp, r.kind as rule
    from login_attempts a left join users u on u.id = a.user_id left join ip_geo g on g.ip = a.ip left join ip_rules r on r.ip = a.ip
    where ${where} order by a.at desc, a.id desc limit ${PAGE} offset ${(f.page - 1) * PAGE}`)).rows
  return {
    total: n, pages: Math.max(1, Math.ceil(n / PAGE)),
    rows: rows.map((r) => ({ id: r.id, at: new Date(r.at).toISOString(), email: r.email, user: r.user, ip: r.ip, userAgent: r.user_agent, result: r.result, place: place(r), isp: r.isp, blocked: r.rule === 'block', trusted: r.rule === 'allow' })),
  }
}

export async function loginSecurity(tx: Tx, actor: Actor): Promise<{ rules: IpRuleRow[]; locks: LockRow[]; stats: LoginStats }> {
  headOffice(actor)
  const rules = (await tx.execute<{ ip: string; kind: 'block' | 'allow'; reason: string | null; auto: boolean; by: string | null; created_at: string; city: string | null; region: string | null; country: string | null; isp: string | null; tries: number }>(sql`
    select r.ip, r.kind, r.reason, r.auto, u.name as by, r.created_at, g.city, g.region, g.country, g.isp,
      (select count(*)::int from login_attempts a where a.ip = r.ip and a.result <> 'success') as tries
    from ip_rules r left join users u on u.id = r.created_by left join ip_geo g on g.ip = r.ip order by r.created_at desc`)).rows
  const locks = (await tx.execute<{ key: string; failures: number; level: number; locked_until: string }>(sql`
    select key, failures, level, locked_until from login_locks where locked_until > now() order by locked_until desc limit 200`)).rows
  const [s] = (await tx.execute<{ today: number; failed: number; blocked: number }>(sql`
    select count(*) filter (where at >= (now() at time zone 'Asia/Kolkata')::date::timestamp at time zone 'Asia/Kolkata')::int as today,
      count(*) filter (where result not in ('success', 'two_factor_sent') and at >= (now() at time zone 'Asia/Kolkata')::date::timestamp at time zone 'Asia/Kolkata')::int as failed,
      (select count(*)::int from ip_rules where kind = 'block') as blocked
    from login_attempts where at > now() - interval '2 days'`)).rows
  return {
    rules: rules.map((r) => ({ ip: r.ip, kind: r.kind, reason: r.reason, auto: r.auto, by: r.by, at: new Date(r.created_at).toISOString(), place: place(r), isp: r.isp, tries: r.tries })),
    locks: locks.map((l) => ({ key: l.key, kind: l.key.startsWith('ip:') ? 'ip' : 'email', value: l.key.slice(l.key.indexOf(':') + 1), failures: l.failures, level: l.level, until: new Date(l.locked_until).toISOString() })),
    stats: { today: s?.today ?? 0, failedToday: s?.failed ?? 0, lockedNow: locks.length, blocked: s?.blocked ?? 0 },
  }
}

const ruleInput = z.object({ ip: z.string(), kind: z.enum(['block', 'allow']), reason: z.string().trim().max(200).optional().nullable() })

/** Blocks an IP, or trusts it (a branch office: never locked or blocked). Replaces any rule it had. */
export async function setIpRule(tx: Tx, actor: Actor, raw: z.input<typeof ruleInput>) {
  headOffice(actor)
  const v = ruleInput.parse(raw)
  const ip = normalizeIp(v.ip)
  if (!ip) throw new Error('Enter a valid IP address (e.g. 103.21.58.4)')
  await tx.execute(sql`insert into ip_rules (ip, kind, reason, auto, created_by) values (${ip}, ${v.kind}, ${v.reason || null}, false, ${actor.userId})
    on conflict (org_id, ip) do update set kind = excluded.kind, reason = excluded.reason, auto = false, created_by = excluded.created_by, created_at = now()`)
  if (v.kind === 'allow') await tx.execute(sql`delete from login_locks where key = ${ipKey(ip)}`)
  await audit(tx, actor, { action: v.kind === 'block' ? 'ip_block' : 'ip_trust', entity: 'ip', after: { ip, reason: v.reason ?? null } })
  return ip
}

/** Unblocks / stops trusting an IP; unblocking also starts its ladder over. */
export async function removeIpRule(tx: Tx, actor: Actor, ipRaw: string) {
  headOffice(actor)
  const ip = normalizeIp(ipRaw)
  if (!ip) throw new Error('Not a valid IP address')
  const [r] = (await tx.execute<{ kind: string }>(sql`delete from ip_rules where ip = ${ip} returning kind`)).rows
  if (!r) throw new Error('That IP has no rule')
  await tx.execute(sql`delete from login_locks where key = ${ipKey(ip)}`)
  await audit(tx, actor, { action: r.kind === 'block' ? 'ip_unblock' : 'ip_untrust', entity: 'ip', before: { ip } })
}

/** Lifts a running lock (an IP or an account) at once. */
export async function clearLock(tx: Tx, actor: Actor, key: string) {
  headOffice(actor)
  if (!/^(ip|email):.{1,200}$/.test(key)) throw new Error('Not a lock')
  await tx.execute(sql`delete from login_locks where key = ${key}`)
  await audit(tx, actor, { action: 'login_unlock', entity: 'login_lock', before: { key } })
}

/** Keeps the log bounded: attempts older than 180 days go (run by the daily purge). */
export const pruneLoginLog = (orgId: string) => withOrgSystem(orgId, async (tx) => {
  await tx.execute(sql`delete from login_attempts where at < now() - interval '180 days'`)
  await tx.execute(sql`delete from login_locks where (locked_until is null or locked_until < now()) and last_failed_at < now() - interval '2 days'`)
})
