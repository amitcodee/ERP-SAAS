// Which org a host belongs to (a slug or a verified custom domain), from the database, kept a minute: every page and
// action of a workspace asks. No request APIs here, so scripts and the provisioning code can use it too.
import { sql } from 'drizzle-orm'
import { withPlatform } from '../db/withTenant'
import type { HostKind, OrgRef } from './host'

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
