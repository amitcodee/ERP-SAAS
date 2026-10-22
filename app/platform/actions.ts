'use server'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { appOrigin } from '@/lib/app-url'
import { httpsRequest } from '@/lib/auth/https-request'
import { cookieOptions, PLATFORM_COOKIE, signPlatformSession, signSupportLink } from '@/lib/auth/session'
import { clientIpFrom } from '@/lib/client-ip'
import { userMessage } from '@/lib/errors'
import { requirePlatform } from '@/lib/platform/current'
import { underLimit } from '@/lib/redis'
import { requestHost } from '@/lib/tenant/request'
import { activateOrg, approveOrg, announcementInput, couponInput, createAnnouncement, createCoupon, endAnnouncement, extendTrial, planInput, savePlan, setCouponActive, setFeature, setOrgPlan } from '@/modules/platform/console'
import { rulesInput, saveOnboardingRules } from '@/modules/platform/rules'
import { assertOwnOpenSession, endSupportByPlatform, platformLogin, setOrgStatus, startSupport } from '@/modules/platform/service'

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string }
async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try { return { ok: true, data: await fn() } } catch (e) { return { ok: false, error: userMessage(e, 'Something went wrong. Please try again.', 'platform.error') } }
}

export async function platformLoginAction(_: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  if ((await requestHost()).kind !== 'platform') return { error: 'Not found' }
  const v = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) }).safeParse({ email: form.get('email'), password: form.get('password') })
  if (!v.success) return { error: 'Enter a valid e-mail and password' }
  const ip = clientIpFrom(await headers()) ?? 'unknown'
  if (!(await underLimit(`plogin:ip:${ip}`, 10, 15 * 60)) || !(await underLimit(`plogin:email:${v.data.email}`, 5, 15 * 60))) return { error: 'Too many attempts. Try again in 15 minutes.' }
  const u = await platformLogin(v.data.email, v.data.password)
  if (!u) return { error: 'Wrong e-mail or password' }
  ;(await cookies()).set(PLATFORM_COOKIE, await signPlatformSession({ pid: u.id, name: u.name, email: u.email }), { ...cookieOptions, maxAge: 8 * 3600, secure: await httpsRequest() })
  // a server action's redirect is rendered here, without the proxy's rewrite: name the console's own route
  redirect('/platform')
}

export async function platformLogoutAction() {
  ;(await cookies()).delete(PLATFORM_COOKIE)
  redirect('/platform/login')
}

export async function setOrgStatusAction(orgId: string, status: 'suspended' | 'active' | 'read_only', reason: string) {
  return run(async () => { const pu = await requirePlatform(); await setOrgStatus(pu, z.string().uuid().parse(orgId), z.enum(['suspended', 'active', 'read_only']).parse(status), reason) })
}

/** Lets an institute that waits for approval run: its trial starts (or it is active, when it has paid). */
export async function approveOrgAction(orgId: string) {
  return run(async () => { const pu = await requirePlatform(); return approveOrg(pu, z.string().uuid().parse(orgId)) })
}
/** Active by the platform's hand: until a date (YYYY-MM-DD), or with no end (null). */
export async function activateOrgAction(orgId: string, until: string | null, reason: string) {
  return run(async () => {
    const pu = await requirePlatform()
    await activateOrg(pu, z.string().uuid().parse(orgId), until === null ? null : z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date').parse(until), reason)
  })
}
/** How new institutes start: the trial's length and whether they wait for approval. */
export async function saveRulesAction(v: z.input<typeof rulesInput>) {
  return run(async () => { await requirePlatform(); await saveOnboardingRules(v) })
}

/** Opens a support session and returns the one-time link into the org (5 minutes, once). */
export async function startSupportAction(orgId: string, v: { reason: string; mode: 'read' | 'write'; minutes: number }) {
  return run(async () => {
    const pu = await requirePlatform()
    const id = z.string().uuid().parse(orgId)
    const s = await startSupport(pu, id, v)
    return `${await appOrigin(id)}/login/support?t=${encodeURIComponent(await signSupportLink({ sup: s.id, org: id }))}`
  })
}

/** A fresh link into an open session (the first one is good for 5 minutes only). */
export async function supportLinkAction(orgId: string, sessionId: string) {
  return run(async () => {
    const pu = await requirePlatform()
    const id = z.string().uuid().parse(orgId), sup = z.string().uuid().parse(sessionId)
    await assertOwnOpenSession(pu, id, sup)
    return `${await appOrigin(id)}/login/support?t=${encodeURIComponent(await signSupportLink({ sup, org: id }))}`
  })
}

export async function endSupportAction(sessionId: string) {
  return run(async () => { const pu = await requirePlatform(); await endSupportByPlatform(pu, z.string().uuid().parse(sessionId)) })
}

// ---- the rest of the console (modules/platform/console.ts) ----
export async function savePlanAction(v: z.input<typeof planInput>) {
  return run(async () => { await requirePlatform(); await savePlan(v) })
}
export async function createCouponAction(v: z.input<typeof couponInput>) {
  return run(async () => { await requirePlatform(); await createCoupon(v) })
}
export async function setCouponActiveAction(code: string, active: boolean) {
  return run(async () => { await requirePlatform(); await setCouponActive(code, active) })
}
export async function setOrgPlanAction(orgId: string, plan: string, reason: string) {
  return run(async () => { const pu = await requirePlatform(); await setOrgPlan(pu, z.string().uuid().parse(orgId), plan, reason) })
}
export async function extendTrialAction(orgId: string, days: number, reason: string) {
  return run(async () => { const pu = await requirePlatform(); await extendTrial(pu, z.string().uuid().parse(orgId), days, reason) })
}
export async function setFeatureAction(orgId: string, flag: string, on: boolean) {
  return run(async () => { const pu = await requirePlatform(); await setFeature(pu, z.string().uuid().parse(orgId), flag, on) })
}
export async function createAnnouncementAction(v: z.input<typeof announcementInput>) {
  return run(async () => { const pu = await requirePlatform(); await createAnnouncement(pu, v) })
}
export async function endAnnouncementAction(id: string) {
  return run(async () => { await requirePlatform(); await endAnnouncement(z.string().uuid().parse(id)) })
}

