import 'server-only'
import { sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import QRCode from 'qrcode'
import { withPlatform } from './db/withTenant'

// org -> its address, kept a minute (every e-mail, receipt and QR code asks)
const TTL_MS = 60_000
const known = new Map<string, { at: number; org: { slug: string; domain: string | null } }>()

async function orgAddress(orgId: string) {
  const hit = known.get(orgId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.org
  const org = await withPlatform(async (tx) => (await tx.execute<{ slug: string; domain: string | null }>(sql`
    select o.slug, (select d.host from org_domains d where d.org_id = o.id and d.verified_at is not null order by d.verified_at limit 1) as domain
    from organisations o where o.id = ${orgId}`)).rows[0])
  if (!org) throw new Error(`No organisation ${orgId}`)
  known.set(orgId, { at: Date.now(), org })
  return org
}

/** Forget the addresses (a slug changed, a custom domain was verified or removed). */
export const forgetOrgAddresses = () => known.clear()

/**
 * Public origin of an organisation's workspace, for links in e-mails, receipts and QR codes: its verified custom
 * domain, else https://<slug>.<ROOT_DOMAIN>. Never the request's host in production: the caller controls that, and a
 * live server building a password-reset link from it would mail a link to whatever site the attacker named.
 * Without ROOT_DOMAIN (one-host installs, development) the default org is at APP_URL; outside production (or when
 * APP_URL is this machine) the others are at <slug>.localhost, and the default org falls back to the request's host.
 */
export async function appOrigin(orgId: string): Promise<string> {
  const org = await orgAddress(orgId)
  if (org.domain) return `https://${org.domain}`
  const root = process.env.ROOT_DOMAIN?.toLowerCase()
  if (root) return `https://${org.slug}.${root}`
  const prod = process.env.NODE_ENV === 'production'
  const app = process.env.APP_URL?.replace(/\/$/, '')
  if (org.slug === process.env.DEFAULT_ORG_SLUG && app) return app
  // a production build on this machine (the end-to-end run) may use <slug>.localhost; a real server needs ROOT_DOMAIN
  const onThisMachine = !!app && /^(localhost|127\.0\.0\.1)$/.test(new URL(app).hostname)
  if (prod && !onThisMachine) throw new Error('ROOT_DOMAIN is not set: add the domain institutes work under (e.g. example.com) to the server settings')
  // in development, the port this server is answering on (APP_URL may name another one, e.g. the e2e build's)
  const here = prod ? null : await requestHere()
  const local = here ?? (app ? new URL(app) : await requestBase())
  const port = local.port ? `:${local.port}` : ''
  if (org.slug !== process.env.DEFAULT_ORG_SLUG) return `${local.protocol}//${org.slug}.localhost${port}`
  return local.hostname.endsWith('.localhost') ? `${local.protocol}//localhost${port}` : `${local.protocol}//${local.host}`
}

/** The request's own local address (<x>.localhost or 127.0.0.1), or null outside a request or on another host. */
async function requestHere(): Promise<URL | null> {
  const h = await headers().catch(() => null)
  const host = h?.get('host')
  return host && /^(localhost|127\.0\.0\.1|[a-z0-9-]+\.localhost)(:\d+)?$/i.test(host) ? new URL(`http://${host}`) : null
}

async function requestBase(): Promise<URL> {
  const h = await headers().catch(() => null)
  const host = h?.get('x-forwarded-host') ?? h?.get('host') ?? 'localhost:3000'
  const proto = h?.get('x-forwarded-proto') ?? (/^(localhost|127\.0\.0\.1|[^.]+\.localhost)(:|$)/.test(host) ? 'http' : 'https')
  return new URL(`${proto}://${host}`)
}

/** Inline SVG markup of a QR code for the given URL. */
export const qrSvg = (url: string, dark = '#111827') =>
  QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark, light: '#0000' } })
