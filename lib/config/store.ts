// Settings saved from the panel (Settings → E-mail, WhatsApp & SMS, Reminders, Scheduled jobs), read by the server.
// Every organisation has its own (app_config is a tenant table, secrets sealed with the org's own key). Each key has
// defaults. The server's environment variables describe only the PLATFORM's mailer, used for an org that has not set
// up its own e-mail (lib/notify/providers.ts); WhatsApp and SMS always use the org's own accounts. Values are cached
// for 30 seconds per org (and dropped on save).
// A failed read is never taken for "nothing saved": the last good value is kept (or the error is raised), and it is
// not cached, so a short database hiccup cannot make a configured mail server look missing.
import { sql } from 'drizzle-orm'
import { log } from '@/lib/log'
import { seal, unseal } from '@/lib/secret-box'
import { withOrgSystem, type Actor } from '@/lib/db/withTenant'
import { can } from '@/lib/auth/permissions'
import type { WaEventKey, WaMessageKey } from '@/lib/notify/whatsapp'
import { DEFAULT_GRADES, type GradesConfig } from '@/lib/grades'

export type Channel = 'whatsapp' | 'sms' | 'email'

export type EmailConfig = { enabled: boolean; host: string; port: number; security: 'ssl' | 'starttls' | 'none'; user: string; fromName: string; fromAddress: string; replyTo: string; alertEmail: string }
export type EmailSecrets = { password?: string }
/** `aisensy`: AiSensy API campaigns (lib/notify/whatsapp.ts names them). `meta`: the WhatsApp Cloud API directly. */
export type WhatsAppConfig = {
  enabled: boolean; provider: 'aisensy' | 'meta'; countryCode: string
  /** AiSensy campaign names that differ from the ones in lib/notify/whatsapp.ts, by message. */
  campaigns: Partial<Record<WaMessageKey, string>>
  /** Event messages switched off in Settings (fee reminders follow Settings → Reminders). */
  off: WaEventKey[]
  /** Opt-in event messages (WaMessage.optIn) switched on in Settings. */
  on?: WaEventKey[]
  phoneNumberId: string; businessAccountId: string; apiVersion: string; reminderTemplate: string; language: string
}
export type WhatsAppSecrets = { token?: string; apiKey?: string }
export type SmsConfig = { enabled: boolean; provider: 'msg91'; templateId: string; senderId: string; countryCode: string }
export type SmsSecrets = { authKey?: string }
export type RemindersConfig = {
  channels: Channel[]
  /** Days before the due date a reminder goes out, e.g. [2]. */
  daysBefore: number[]
  onDueDay: boolean
  /** Days after the due date a reminder goes out again, e.g. [3, 7, 15]. */
  overdueDays: number[]
  texts: { soon: string; today: string; overdue: string }
}
/** Students paying their fees online (the portal's Pay online), through the institute's own Razorpay account. */
export type PaymentsConfig = { enabled: boolean; provider: 'razorpay'; keyId: string }
export type PaymentsSecrets = { keySecret?: string; webhookSecret?: string }
/** The public admission form (/apply, and /apply/embed on the institute's own website): modules/web-leads/apply.ts. */
export type AdmissionFormConfig = { enabled: boolean; heading: string; intro: string; thanks: string; askEmail: boolean; askLocation: boolean; askMessage: boolean }
export type JobKey = 'reminders' | 'reconcile' | 'purge' | 'escalations'
export type JobsConfig = Record<JobKey, { enabled: boolean; time: string }> & { scheduler: 'panel' | 'external' }

export type ConfigMap = {
  email: { config: EmailConfig; secrets: EmailSecrets }
  whatsapp: { config: WhatsAppConfig; secrets: WhatsAppSecrets }
  sms: { config: SmsConfig; secrets: SmsSecrets }
  reminders: { config: RemindersConfig; secrets: Record<string, never> }
  jobs: { config: JobsConfig; secrets: Record<string, never> }
  payments: { config: PaymentsConfig; secrets: PaymentsSecrets }
  grades: { config: GradesConfig; secrets: Record<string, never> }
  admission_form: { config: AdmissionFormConfig; secrets: Record<string, never> }
  /** The feature packs switched off (lib/panel/features.ts). */
  features: { config: { off: string[] }; secrets: Record<string, never> }
}
export type ConfigKey = keyof ConfigMap

export const DEFAULTS: { [K in ConfigKey]: ConfigMap[K]['config'] } = {
  email: {
    // an org's own mail server starts switched off: until it is set up, mail goes out from the platform's mailer
    enabled: false, host: 'smtp.gmail.com', port: 465, security: 'ssl', user: '', fromName: '', fromAddress: '', replyTo: '', alertEmail: '',
  },
  whatsapp: {
    enabled: false, provider: 'aisensy', countryCode: '91', campaigns: {}, off: [], on: [],
    phoneNumberId: '', businessAccountId: '', apiVersion: 'v20.0', reminderTemplate: 'fee_reminder', language: 'en',
  },
  sms: { enabled: false, provider: 'msg91', templateId: '', senderId: '', countryCode: '91' },
  reminders: {
    channels: ['email'],
    daysBefore: [2], onDueDay: true, overdueDays: [3, 7, 15],
    texts: {
      soon: 'Dear {{first_name}}, your {{amount}} installment for {{reg_no}} is due on {{due_date}}. - {{institute}} {{branch}}',
      today: 'Dear {{first_name}}, your {{amount}} installment for {{reg_no}} is due today. Please pay at the office. - {{institute}} {{branch}}',
      overdue: 'Dear {{first_name}}, your {{amount}} installment for {{reg_no}} was due on {{due_date}} and is overdue. Please pay at the earliest. - {{institute}} {{branch}}',
    },
  },
  jobs: { scheduler: 'panel', reminders: { enabled: true, time: '09:00' }, reconcile: { enabled: true, time: '02:00' }, purge: { enabled: true, time: '03:00' }, escalations: { enabled: true, time: '10:00' } },
  payments: { enabled: false, provider: 'razorpay', keyId: '' },
  grades: DEFAULT_GRADES,
  features: { off: [] },
  admission_form: { enabled: false, heading: 'Apply for admission', intro: '', thanks: 'Thank you! Our team will call you shortly.', askEmail: true, askLocation: true, askMessage: true },
}

export type Loaded<K extends ConfigKey> = ConfigMap[K] & { saved: boolean; updatedAt: string | null }
const cache = new Map<string, { at: number; value: Loaded<ConfigKey> }>() // `<org id>:<key>`

type ConfigRow = { config: Record<string, unknown>; secrets: string | null; updated_at: string }
const readRow = async (orgId: string, key: string) => (await withOrgSystem(orgId, async (tx) => (await tx.execute<ConfigRow>(sql`
  select config, secrets, updated_at::text from app_config where key = ${key}`)).rows))[0] as ConfigRow | undefined

/** The saved row; on a database error the last good value is used (logged), or the error is raised when there is none. */
async function readOrStale<T>(orgId: string, key: string, stale: T | undefined, build: (row: ConfigRow | undefined) => T): Promise<{ value: T; fresh: boolean }> {
  try {
    return { value: build(await readRow(orgId, key)), fresh: true }
  } catch (e) {
    log.warn('config_read_failed', { orgId, key, stale: stale !== undefined, error: e instanceof Error ? e.message : String(e) })
    if (stale !== undefined) return { value: stale, fresh: false }
    throw e
  }
}

/** An org's setting as the server uses it: saved values over defaults. */
export async function getConfig<K extends ConfigKey>(orgId: string, key: K): Promise<Loaded<K>> {
  const ck = `${orgId}:${key}`
  const hit = cache.get(ck)
  if (hit && Date.now() - hit.at < 30_000) return hit.value as Loaded<K>
  const { value, fresh } = await readOrStale(orgId, key, hit?.value as Loaded<K> | undefined, (row) => ({
    config: { ...DEFAULTS[key], ...(row?.config ?? {}) },
    secrets: row ? (unseal(row.secrets, 'settings-secrets', orgId) ?? {}) : {},
    saved: !!row, updatedAt: row?.updated_at ?? null,
  }) as Loaded<K>)
  if (fresh) cache.set(ck, { at: Date.now(), value: value as Loaded<ConfigKey> })
  return value
}

/** Saves an org's setting. Secrets left empty keep what was saved before. */
export async function saveConfig<K extends ConfigKey>(orgId: string, key: K, config: ConfigMap[K]['config'], secrets: Partial<ConfigMap[K]['secrets']>, userId: string) {
  const cur = await getConfig(orgId, key)
  cache.delete(`${orgId}:${key}`)
  const merged = { ...cur.secrets } as Record<string, unknown>
  for (const [k, v] of Object.entries(secrets)) if (typeof v === 'string' && v.trim()) merged[k] = v.trim()
  await withOrgSystem(orgId, (tx) => tx.execute(sql`
    insert into app_config (key, config, secrets, updated_by, updated_at) values (${key}, ${JSON.stringify(config)}::jsonb, ${seal(merged, 'settings-secrets', orgId)}, ${userId}, now())
    on conflict (org_id, key) do update set config = excluded.config, secrets = excluded.secrets, updated_by = excluded.updated_by, updated_at = now()`))
  cache.delete(`${orgId}:${key}`)
}

export const dropConfigCache = () => { cache.clear(); branchCache.clear() }

// ---- A branch's own mail server. Saved as app_config `email@<branch id>`; mail sent for that branch (student logins,
// reminders, staff logins) goes out from it. A branch that has none set up uses the central one above.
const branchKey = (branchId: string) => `email@${branchId}`
const BRANCH_EMAIL: EmailConfig = { enabled: false, host: '', port: 465, security: 'ssl', user: '', fromName: '', fromAddress: '', replyTo: '', alertEmail: '' }
export type BranchEmail = { config: EmailConfig; secrets: EmailSecrets; saved: boolean; updatedAt: string | null }
const branchCache = new Map<string, { at: number; value: BranchEmail }>()

export async function getBranchEmail(orgId: string, branchId: string): Promise<BranchEmail> {
  const hit = branchCache.get(branchId)
  if (hit && Date.now() - hit.at < 30_000) return hit.value
  const { value, fresh } = await readOrStale(orgId, branchKey(branchId), hit?.value, (row): BranchEmail => (
    { config: { ...BRANCH_EMAIL, ...(row?.config ?? {}) } as EmailConfig, secrets: row ? (unseal(row.secrets, 'settings-secrets', orgId) ?? {}) : {}, saved: !!row, updatedAt: row?.updated_at ?? null }))
  if (fresh) branchCache.set(branchId, { at: Date.now(), value })
  return value
}

/** Who sets a branch's mail server: its branch manager (not one shared in for their own work only), or head office while working in that branch. */
export const canManageBranchEmail = (a: Actor) => !!a.branchId && !a.ownOnly && can(a, 'update', 'branchmail')

/**
 * A branch works only once its own mail server is set up: until then its staff cannot add or change anything (head
 * office is never held). The message to show, or null when the actor may go ahead. BRANCH_EMAIL_OPTIONAL=1 (test runs)
 * switches this off.
 */
export async function needsBranchEmail(a: Actor): Promise<boolean> {
  // students are never held: their portal (tickets, certificate requests) is not the branch's work
  if (process.env.BRANCH_EMAIL_OPTIONAL === '1' || a.role === 'super_admin' || a.role === 'student' || !a.branchId) return false
  // the setting could not be read at all: let the work go on rather than lock the branch over a database hiccup
  const e = await getBranchEmail(a.orgId, a.branchId).catch(() => null)
  return !!e && !branchEmailReady(e)
}
export async function branchEmailBlock(a: Actor): Promise<string | null> {
  if (!(await needsBranchEmail(a))) return null
  return canManageBranchEmail(a)
    ? 'Set up the branch e-mail first: Settings → Branch e-mail. Nothing can be added or changed until then.'
    : 'Set up the branch e-mail first: ask your branch manager to set it up (Settings → Branch e-mail). Nothing can be added or changed until then.'
}

/** Set up = switched on, with a server, a login and a password. */
export const branchEmailReady = (e: BranchEmail) => !!(e.config.enabled && e.config.host && e.config.user && e.secrets.password)

/** Saves a branch's mail server. An empty password keeps the one saved before. */
export async function saveBranchEmail(orgId: string, branchId: string, config: EmailConfig, password: string | null, userId: string) {
  const cur = await getBranchEmail(orgId, branchId)
  const secrets = password?.trim() ? { password: password.trim() } : cur.secrets
  await withOrgSystem(orgId, (tx) => tx.execute(sql`
    insert into app_config (key, config, secrets, updated_by, updated_at) values (${branchKey(branchId)}, ${JSON.stringify(config)}::jsonb, ${seal(secrets, 'settings-secrets', orgId)}, ${userId}, now())
    on conflict (org_id, key) do update set config = excluded.config, secrets = excluded.secrets, updated_by = excluded.updated_by, updated_at = now()`))
  branchCache.delete(branchId)
}
