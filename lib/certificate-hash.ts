import { createHmac, timingSafeEqual } from 'crypto'
import { serverSecret } from './auth/secret'
import { SAMPLE_ORG_ID } from './db/schema/tenancy'

const key = () => serverSecret('CERT_SECRET')

/**
 * HMAC over the certificate's identity and its organisation (v2). Forging a valid URL requires the server secret, and a
 * hash made for one institute never verifies as another's.
 */
export const certHash = (orgId: string, certNo: string, registrationId: string, issuedAt: Date) =>
  createHmac('sha256', key()).update(`v2|${orgId}|${certNo}|${registrationId}|${issuedAt.toISOString()}`).digest('hex')

/** The hash certificates had before organisations (v1): still printed on the sample org's earlier certificates. */
const certHashV1 = (certNo: string, registrationId: string, issuedAt: Date) =>
  createHmac('sha256', key()).update(`${certNo}|${registrationId}|${issuedAt.toISOString()}`).digest('hex')

/** True when `hash` is this certificate's: its v2 hash, or (the sample org only) its v1 hash. */
export function certHashMatches(c: { orgId: string; certNo: string; registrationId: string; issuedAt: Date }, hash: string): boolean {
  if (hashMatches(certHash(c.orgId, c.certNo, c.registrationId, c.issuedAt), hash)) return true
  return c.orgId === SAMPLE_ORG_ID && hashMatches(certHashV1(c.certNo, c.registrationId, c.issuedAt), hash)
}

export function hashMatches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected), b = Buffer.from(actual)
  return a.length === b.length && timingSafeEqual(a, b)
}
