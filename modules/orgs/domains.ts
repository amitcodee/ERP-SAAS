// An institute's own domain (Settings → Your domain; the plan's custom_domain module): it adds e.g. erp.acme.in, points
// it at its address (a CNAME) and proves it is theirs with a TXT record holding a token. Once the TXT record is seen,
// the domain is verified: the institute answers on it (org_for_host) and its links use it (lib/app-url.ts). Head office
// only (RLS: org_domains_write). The lookup is done here, never trusted from the browser.
import { randomBytes } from 'crypto'
import { resolveTxt } from 'dns/promises'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { assertCan } from '@/lib/auth/permissions'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { assertModule } from '@/lib/plan/limits'

/** At most this many domains per institute (one is the usual; a second while moving). */
const MAX = 3
export const TXT_PREFIX = '_institute-verify'

export type DomainRow = { id: string; host: string; token: string; verifiedAt: string | null; createdAt: string }

/** 'https://ERP.Acme.in/' -> 'erp.acme.in'; null when it is not a domain someone can own. */
export function domainOf(raw: string): string | null {
  const v = raw.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '')
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(v)) return null
  return v
}

/** Where the domain should point (its CNAME): the institute's own address on the platform. */
export function cnameTarget(slug: string): string {
  const root = process.env.ROOT_DOMAIN?.toLowerCase()
  if (root) return `${slug}.${root}`
  try { return new URL(process.env.APP_URL ?? '').hostname || `${slug}.localhost` } catch { return `${slug}.localhost` }
}

export async function listDomains(tx: Tx): Promise<DomainRow[]> {
  return (await tx.execute<DomainRow>(sql`
    select id, host, token, verified_at::text as "verifiedAt", created_at::text as "createdAt" from org_domains where org_id = app_org() order by created_at`)).rows
}

export async function addDomain(tx: Tx, actor: Actor, raw: string): Promise<DomainRow> {
  assertCan(actor, 'update', 'setting')
  if (actor.role !== 'super_admin') throw new Error('Only head office sets the institute’s domain')
  await assertModule(tx, 'custom_domain', 'Your own domain')
  const host = domainOf(z.string().max(300).parse(raw))
  if (!host) throw new Error('Type a domain, e.g. erp.yourinstitute.com')
  const root = process.env.ROOT_DOMAIN?.toLowerCase()
  if (root && (host === root || host.endsWith(`.${root}`))) throw new Error('That is an address of this platform: use your own domain')
  const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from org_domains where org_id = app_org()`)).rows
  if (n >= MAX) throw new Error(`At most ${MAX} domains: remove one first`)
  const [taken] = (await tx.execute(sql`select 1 from org_domains where host = ${host}`)).rows // RLS: only this org's; the unique index catches the rest
  if (taken) throw new Error('This domain is added already')
  const token = randomBytes(18).toString('base64url')
  try {
    const [row] = (await tx.execute<DomainRow>(sql`insert into org_domains (org_id, host, token) values (app_org(), ${host}, ${token})
      returning id, host, token, verified_at::text as "verifiedAt", created_at::text as "createdAt"`)).rows
    await audit(tx, actor, { action: 'create', entity: 'domain', entityId: row.id, after: { host } })
    return row
  } catch (e) {
    if ((e as { cause?: { code?: string } }).cause?.code === '23505' || (e as { code?: string }).code === '23505') throw new Error('Another institute has added this domain')
    throw e
  }
}

/** The TXT records a name has (a missing name is no records). */
export type TxtLookup = (name: string) => Promise<string[]>
const dnsTxt: TxtLookup = async (name) => {
  try { return (await resolveTxt(name)).map((parts) => parts.join('')) } catch { return [] }
}

/**
 * Checks the domain's TXT record (`_institute-verify.<domain>` = its token) and marks it verified when it is there.
 * Returns whether it is verified now.
 */
export async function verifyDomain(tx: Tx, actor: Actor, id: string, lookup: TxtLookup = dnsTxt): Promise<boolean> {
  assertCan(actor, 'update', 'setting')
  if (actor.role !== 'super_admin') throw new Error('Only head office sets the institute’s domain')
  const [d] = (await tx.execute<{ id: string; host: string; token: string; verified_at: string | null }>(sql`
    select id, host, token, verified_at::text from org_domains where id = ${z.string().uuid().parse(id)} and org_id = app_org()`)).rows
  if (!d) throw new Error('Domain not found')
  if (d.verified_at) return true
  const records = await lookup(`${TXT_PREFIX}.${d.host}`)
  if (!records.some((r) => r.trim() === d.token)) return false
  await tx.execute(sql`update org_domains set verified_at = now() where id = ${d.id}`)
  await audit(tx, actor, { action: 'update', entity: 'domain', entityId: d.id, after: { host: d.host, verified: true } })
  return true
}

export async function removeDomain(tx: Tx, actor: Actor, id: string) {
  assertCan(actor, 'update', 'setting')
  if (actor.role !== 'super_admin') throw new Error('Only head office sets the institute’s domain')
  const r = await tx.execute<{ host: string }>(sql`delete from org_domains where id = ${z.string().uuid().parse(id)} and org_id = app_org() returning host`)
  if (!r.rows[0]) throw new Error('Domain not found')
  await audit(tx, actor, { action: 'delete', entity: 'domain', entityId: id, before: { host: r.rows[0].host } })
}
