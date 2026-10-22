// A new organisation (institute), ready to sign in to: the org row, its roles (from DEFAULT_ROLES), the standard
// lists (sources, payment modes, class modes, …), a first branch and the owner's head-office login. One transaction:
// a failure leaves nothing behind. Used by the platform console (and, in Phase 2, self sign-up and its onboarding).
import { NEW_ORG_OFF } from '@/lib/panel/features'
import { randomBytes } from 'crypto'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { DEFAULT_ROLES, ALL_PERMS } from '@/lib/auth/permissions'
import { hashPassword } from '@/lib/auth/password'
import { applyOrgSystem, withPlatform, type Tx } from '@/lib/db/withTenant'
import { branches, lookups, roles, userRoles, users } from '@/lib/db/schema'
import { slugProblem } from '@/lib/tenant/host'
import { forgetHosts } from '@/lib/tenant/resolve'

/** The lists every institute starts with (it can change them under Courses & Lists). */
export const STARTER_LOOKUPS: Record<'enquiry_source' | 'payment_mode' | 'class_mode' | 'occupation_type' | 'not_joined_reason', string[]> = {
  enquiry_source: ['Walk-in', 'Phone call', 'Reference', 'Website', 'Social Media', 'Banners/Posters', 'Seminar', 'Other'],
  payment_mode: ['Cash', 'Online', 'Card Payment', 'Cheque'],
  class_mode: ['Online', 'Offline'],
  occupation_type: ['Student', 'Working', 'Unemployed'],
  not_joined_reason: ['Will register soon', 'Will take time to register', 'Will confirm within days'],
}

export const newOrgInput = z.object({
  name: z.string().trim().min(2, 'Enter the institute’s name').max(120),
  slug: z.string().trim().toLowerCase(),
  ownerName: z.string().trim().min(2, 'Enter the owner’s name').max(120),
  ownerEmail: z.string().trim().toLowerCase().email('Enter a valid e-mail'),
  ownerPassword: z.string().min(10).max(200).optional(), // none: a temporary one, changed at first sign-in
  ownerPasswordHash: z.string().startsWith('$argon2').optional(), // already hashed (self sign-up keeps only the hash)
  status: z.enum(['pending', 'trial', 'active']).default('trial'), // pending: waits for the platform's approval
  planKey: z.string().default('starter'),
  trialDays: z.number().int().min(1).max(90).default(14),
  timezone: z.string().default('Asia/Kolkata'),
  branch: z.object({ name: z.string().trim().min(2).max(80), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,8}$/, 'Branch code: 2 to 8 letters or digits') }).default({ name: 'Main branch', code: 'MAIN' }),
})
export type NewOrgInput = z.input<typeof newOrgInput>

export type Provisioned = { orgId: string; slug: string; ownerUserId: string; branchId: string; tempPassword: string | null }

/** Seeds an org's roles from the defaults (the transaction is in that org). */
export async function seedRoles(tx: Tx) {
  await tx.insert(roles).values(DEFAULT_ROLES.map((r) => ({
    key: r.key, name: r.name, description: r.description, kind: r.kind, locked: r.locked, isSystem: true,
    permissions: [...(r.kind === 'super' ? ALL_PERMS : r.perms)].sort(),
  })))
}

export async function provisionOrg(raw: NewOrgInput): Promise<Provisioned> {
  const out = await withPlatform((tx) => provisionOrgIn(tx, raw))
  forgetHosts() // a host that answered "no such institute" a moment ago now has one
  return out
}

/** The same inside an open platform transaction (withPlatform); it ends in the new org's context. */
export async function provisionOrgIn(tx: Tx, raw: NewOrgInput): Promise<Provisioned> {
  const v = newOrgInput.parse(raw)
  const bad = slugProblem(v.slug)
  if (bad) throw new Error(`Web address: ${bad}`)
  const chosen = !!(v.ownerPassword || v.ownerPasswordHash)
  const tempPassword = chosen ? null : randomBytes(9).toString('base64url')
  const passwordHash = v.ownerPasswordHash ?? (await hashPassword(v.ownerPassword ?? tempPassword!))
  const [taken] = (await tx.execute(sql`select 1 from organisations where slug = ${v.slug}`)).rows
  if (taken) throw new Error('That web address is taken: pick another')
  const [org] = (await tx.execute<{ id: string }>(sql`
    insert into organisations (name, slug, status, plan_key, trial_ends_at, timezone)
    values (${v.name}, ${v.slug}, ${v.status}, ${v.planKey}, ${v.status === 'trial' ? sql`now() + make_interval(days => ${v.trialDays})` : null}, ${v.timezone})
    returning id`)).rows

  // from here on, inside the new org
  await applyOrgSystem(tx, org.id)
  await seedRoles(tx)
  for (const [kind, values] of Object.entries(STARTER_LOOKUPS)) {
    await tx.insert(lookups).values(values.map((value, i) => ({ kind: kind as keyof typeof STARTER_LOOKUPS, value, sortOrder: i })))
  }
  // a new institute starts simple: the extra feature packs off until it switches them on (Settings → Features)
  await tx.execute(sql`insert into app_config (key, config) values ('features', ${JSON.stringify({ off: NEW_ORG_OFF })}::jsonb)`)
  const [b] = await tx.insert(branches).values({ code: v.branch.code, name: v.branch.name }).returning({ id: branches.id })
  const [u] = await tx.insert(users).values({ name: v.ownerName, email: v.ownerEmail, branchId: null, passwordHash, mustChangePassword: !chosen }).returning({ id: users.id })
  await tx.insert(userRoles).values({ userId: u.id, role: 'super_admin' })
  await tx.execute(sql`update organisations set owner_user_id = ${u.id} where id = ${org.id}`)
  await tx.execute(sql`insert into audit_logs (user_id, action, entity, entity_id, after) values (${u.id}, 'create', 'organisation', ${org.id}, ${JSON.stringify({ name: v.name, slug: v.slug, plan: v.planKey, status: v.status })}::jsonb)`)
  return { orgId: org.id, slug: v.slug, ownerUserId: u.id, branchId: b.id, tempPassword }
}
