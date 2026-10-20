import { createHmac, timingSafeEqual } from 'crypto'

// Each organisation's website-lead secret: what its websites send as `Authorization: Bearer <secret>` to
// /api/webhooks/web-leads on the org's own address. Derived from the platform's WEBLEADS_SECRET and the org's id, so
// one institute's secret never opens another's door. Head office sees it in Settings → Integrations (each look is
// audited). (Phase 4, lead integrations, replaces this with keys an org can rotate.)

/** The org's secret, or null while the platform has no WEBLEADS_SECRET (24+ characters). */
export function webLeadsSecretFor(orgId: string): string | null {
  const base = process.env.WEBLEADS_SECRET
  if (!base || base.length < 24) return null
  return createHmac('sha256', base).update(`web-leads:${orgId}`).digest('base64url')
}

/** True when the request carries this org's secret. */
export function webLeadsAuthorized(orgId: string, req: Request): boolean {
  const secret = webLeadsSecretFor(orgId)
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const a = Buffer.from(given), b = Buffer.from(secret ?? '')
  return !!secret && a.length === b.length && timingSafeEqual(a, b)
}
