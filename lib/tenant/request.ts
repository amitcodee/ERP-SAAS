import 'server-only'
import { sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { withPlatform } from '../db/withTenant'
import { classifyHost, type HostKind, type OrgRef } from './host'

export type { OrgRef }

// host -> org, kept a minute: every page and action of a workspace asks
const TTL_MS = 60_000
const known = new Map<string, { at: number; org: OrgRef | null }>()

export async function orgForHost(kind: HostKind): Promise<OrgRef | null> {
  if (kind.kind !== 'org' && kind.kind !== 'custom') return null
  const k = kind.kind === 'org' ? `s:${kind.slug}` : `h:${kind.host}`
  const hit = known.get(k)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.org
  const org = await withPlatform(async (tx) => (await tx.execute<OrgRef>(
    sql`select id, slug, name, status from org_for_host(${kind.kind === 'org' ? kind.slug : null}, ${kind.kind === 'custom' ? kind.host : null})`)).rows[0] ?? null)
  known.set(k, { at: Date.now(), org })
  return org
}

/** Forget what a host resolved to (a slug or domain changed, an org was suspended). */
export const forgetHosts = () => known.clear()

/** What the current request's host is (an org's workspace, the platform console, the public site). */
export const requestHost = cache(async (): Promise<HostKind> => classifyHost((await headers()).get('host')))

/** The organisation of the current request's host, or null (the public site, the platform console, an unknown host). */
export const requestOrg = cache(async (): Promise<OrgRef | null> => orgForHost(await requestHost()))

/** The organisation of this request; a host that is not a (live) workspace answers 404. */
export async function requireRequestOrg(): Promise<OrgRef> {
  const org = await requestOrg()
  if (!org || org.status === 'cancelled') notFound()
  return org
}
