import { and, eq, isNull, sql } from 'drizzle-orm'
import { httpsRequest } from '@/lib/auth/https-request'
import { redirectHere } from '@/lib/http'
import { cookieOptions, primaryRole, readWelcomeLink, SESSION_COOKIE, signSession } from '@/lib/auth/session'
import { userRoles, users, type Role } from '@/lib/db/schema'
import { withOrgSystem } from '@/lib/db/withTenant'
import { requestOrg } from '@/lib/tenant/request'

export const dynamic = 'force-dynamic'

// The end of self sign-up: the public site sends the new owner here, on their institute's own address, with a signed
// link good for 10 minutes and once. It signs them in (a normal session, checked like any other from then on).
export async function GET(req: Request) {
  const link = await readWelcomeLink(new URL(req.url).searchParams.get('t') ?? undefined)
  const org = await requestOrg()
  if (!link || !org || org.id !== link.org || org.status === 'suspended' || org.status === 'cancelled') return redirectHere('/login')
  const session = await withOrgSystem(org.id, async (tx) => {
    const used = await tx.execute(sql`insert into revoked_sessions (sid, expires_at) values (${`welcome-link:${link.jti}`}, to_timestamp(${link.exp})) on conflict (sid) do nothing returning sid`)
    if (!used.rows.length) return null
    const [u] = await tx.select().from(users).where(and(eq(users.id, link.user), eq(users.isActive, true), isNull(users.deletedAt)))
    if (!u) return null
    const roles = (await tx.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, u.id))).map((r) => r.role as Role)
    if (!roles.length) return null
    await tx.execute(sql`insert into audit_logs (user_id, action, entity, entity_id) values (${u.id}, 'login', 'user', ${u.id})`)
    return { userId: u.id, org: org.id, orgSlug: org.slug, name: u.name, email: u.email, roles, role: primaryRole(roles), branchId: u.branchId, branchName: null, pwv: u.passwordChangedAt.getTime() }
  })
  if (!session) return redirectHere('/login')
  const res = redirectHere('/setup') // a new institute starts with its setup steps
  res.cookies.set(SESSION_COOKIE, await signSession(session), { ...cookieOptions, secure: await httpsRequest() })
  return res
}
