import { and, eq, isNull, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { cookieOptions, readSupportLink, SESSION_COOKIE, signSession, type Session } from '@/lib/auth/session'
import { users } from '@/lib/db/schema'
import { withOrgSystem } from '@/lib/db/withTenant'
import { requestOrg } from '@/lib/tenant/request'
import { openSupportIn } from '@/modules/platform/service'

export const dynamic = 'force-dynamic'

// A platform admin's way into an org (support session, opened in the platform console): the console hands them a
// signed link for this org's own address, good for 5 minutes and once. It signs them in as the org's owner (head
// office), marked as support: getActor checks the session is still open on every request, read-only sessions cannot
// write, and everything they do is in the org's audit log with their own name.
export async function GET(req: Request) {
  const refuse = () => new Response('This support link is not valid any more. Open a new one from the platform console.', { status: 403 })
  const link = await readSupportLink(new URL(req.url).searchParams.get('t') ?? undefined)
  const org = await requestOrg()
  if (!link || !org || org.id !== link.org || org.status === 'suspended' || org.status === 'cancelled') return refuse()

  const session = await withOrgSystem(org.id, async (tx): Promise<Session | null> => {
    const open = await openSupportIn(tx)
    if (!open || open.id !== link.sup) return null
    // once only: a copied link cannot open a second session
    const used = await tx.execute(sql`insert into revoked_sessions (sid, expires_at) values (${`support-link:${link.jti}`}, to_timestamp(${link.exp})) on conflict (sid) do nothing returning sid`)
    if (!used.rows.length) return null
    const [u] = await tx.select({ id: users.id, email: users.email, changed: users.passwordChangedAt }).from(users)
      .where(and(sql`${users.id} = (select owner_user_id from organisations where id = ${org.id})`, eq(users.isActive, true), isNull(users.deletedAt)))
    if (!u) return null
    await tx.execute(sql`insert into audit_logs (user_id, action, entity, entity_id, impersonator_id, support_session_id)
      values (${u.id}, 'support_enter', 'support_session', ${open.id}, ${open.platformUserId}, ${open.id})`)
    return { userId: u.id, org: org.id, orgSlug: org.slug, name: `${open.by} (platform support)`, email: u.email, roles: ['super_admin'], role: 'super_admin', branchId: null, branchName: null, pwv: u.changed.getTime(), sup: open.id }
  })
  if (!session) return refuse()
  const res = NextResponse.redirect(new URL('/', req.url))
  // a support session lasts no longer than its support session (getActor ends it the moment that ends)
  res.cookies.set(SESSION_COOKIE, await signSession(session), { ...cookieOptions, secure: new URL(req.url).protocol === 'https:', maxAge: 60 * 60 })
  return res
}
