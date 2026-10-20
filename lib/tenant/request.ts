import 'server-only'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { classifyHost, type HostKind, type OrgRef } from './host'
import { orgForHost } from './resolve'

export type { OrgRef }
export { forgetHosts, orgForHost } from './resolve'

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
