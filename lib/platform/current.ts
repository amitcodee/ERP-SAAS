import 'server-only'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { PLATFORM_COOKIE, readPlatformSession } from '../auth/session'
import { requestHost } from '../tenant/request'
import { platformUser, type PlatformUser } from '@/modules/platform/service'

/** The platform admin of this request: only on the platform host, only with a live platform session. */
export async function requirePlatform(): Promise<PlatformUser> {
  if ((await requestHost()).kind !== 'platform') notFound()
  const s = await readPlatformSession((await cookies()).get(PLATFORM_COOKIE)?.value)
  const u = s ? await platformUser(s.pid) : null
  if (!u) redirect('/platform/login') // a console route by name: from a server action this renders without the proxy
  return u
}
