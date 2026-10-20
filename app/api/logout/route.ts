import { redirectHere } from '@/lib/http'
import { SESSION_COOKIE } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

// Used when a session is no longer valid (user deactivated, password changed elsewhere): clear the cookie, go to login.
// A link or image on another site must not sign people out, so a cross-site request only goes to the login page.
export async function GET(req: Request) {
  const res = redirectHere('/login', 307)
  if (req.headers.get('sec-fetch-site') !== 'cross-site') res.cookies.delete(SESSION_COOKIE)
  return res
}
