import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { PLATFORM_COOKIE, readPlatformSession } from '@/lib/auth/session'
import { requestHost } from '@/lib/tenant/request'
import { platformLogoutAction } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Platform console', robots: { index: false } }

// The platform console (admin.<root> only): organisations, their status and support sessions.
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  if ((await requestHost()).kind !== 'platform') notFound()
  const s = await readPlatformSession((await cookies()).get(PLATFORM_COOKIE)?.value)
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #f5f6fb)' }}>
      {s && (
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '14px 28px', background: '#0f1437', color: '#fff' }}>
          <a href="/" style={{ color: '#fff', fontWeight: 800, textDecoration: 'none' }}>Platform console</a>
          <form action={platformLogoutAction} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13 }}>
            <span>{s.name} · {s.email}</span>
            <button className="filter-button">Sign out</button>
          </form>
        </header>
      )}
      {children}
    </div>
  )
}
