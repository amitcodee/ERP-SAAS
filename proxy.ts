import { NextResponse, type NextRequest } from 'next/server'
import { PLATFORM_COOKIE, readPlatformSession, readSession, SESSION_COOKIE } from '@/lib/auth/session'
import { classifyHost, sessionFitsHost } from '@/lib/tenant/host'

// Content Security Policy, fresh for every page: only scripts carrying this request's nonce run (Next.js puts it on its
// own scripts), so a script slipped into a page by an attacker would not. Inline style attributes stay allowed (the UI
// uses them; they cannot run code). 'wasm-unsafe-eval' lets the photo check on the registration page run its face
// detector (WebAssembly, served from this origin); dev mode (React refresh) also needs 'unsafe-eval' and a websocket.
function csp(nonce: string) {
  const dev = process.env.NODE_ENV !== 'production'
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

/** Continues to the page with the nonce'd policy on both the request (Next.js reads the nonce from it) and the response. */
function withCsp(req: NextRequest, res?: (headers: Headers) => NextResponse) {
  const nonce = btoa(crypto.randomUUID())
  const policy = csp(nonce)
  const headers = new Headers(req.headers)
  headers.set('x-nonce', nonce)
  headers.set('Content-Security-Policy', policy)
  const out = res ? res(headers) : NextResponse.next({ request: { headers } })
  out.headers.set('Content-Security-Policy', policy)
  return out
}

// Route guard: everything except /login, /login/* (forgot / reset password), /support (public help page), /verify/* (public certificate check),
// /e/* (public event sign-up and event certificates),
// webhooks and static assets needs a valid session.
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  // The platform console lives on its own host (admin.<root>) and only there: on it, every path is a console page
  // (behind its own cookie); on an institute's address the console's pages do not exist.
  const host = classifyHost(req.headers.get('host'))
  const consolePath = pathname === '/platform' || pathname.startsWith('/platform/')
  if (host.kind === 'platform') {
    const path = consolePath ? pathname : `/platform${pathname === '/' ? '' : pathname}`
    const signedIn = !!(await readPlatformSession(req.cookies.get(PLATFORM_COOKIE)?.value))
    if (!signedIn && path !== '/platform/login') return NextResponse.redirect(new URL('/login', req.url))
    if (signedIn && path === '/platform/login') return NextResponse.redirect(new URL('/', req.url))
    return withCsp(req, (headers) => NextResponse.rewrite(new URL(`${path}${req.nextUrl.search}`, req.url), { request: { headers } }))
  }
  if (consolePath) return new NextResponse('Not found', { status: 404 })
  if (pathname === '/verify' || pathname.startsWith('/verify/')) return withCsp(req) // public certificate and receipt checks, and the search
  if (pathname.startsWith('/e/')) return withCsp(req) // public event sign-up (seminars, workshops) and event certificates
  // a session belongs to one organisation: on another org's address it counts as none (getActor checks it again
  // against the database, which also covers custom domains)
  const cookie = await readSession(req.cookies.get(SESSION_COOKIE)?.value)
  const session = cookie && sessionFitsHost(host, cookie.orgSlug) ? cookie : null
  if (pathname === '/login') return session ? NextResponse.redirect(new URL('/', req.url)) : withCsp(req)
  if (pathname.startsWith('/login/') || pathname === '/support') return withCsp(req)
  // Visitors who are not signed in get the public landing page at the home address.
  if (!session && pathname === '/') return withCsp(req, (headers) => NextResponse.rewrite(new URL('/support', req.url), { request: { headers } }))
  if (!session) return NextResponse.redirect(new URL('/login', req.url))
  // Uploaded files (documents, payment slips, notes, syllabus files) are not pages: they get a sandbox and nothing may
  // load or run, so even a file that slipped past the upload checks cannot act on this site.
  if (UPLOADED_FILE.test(pathname)) {
    const out = NextResponse.next()
    out.headers.set('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'")
    return out
  }
  return withCsp(req)
}
const UPLOADED_FILE = /^\/(documents\/[^/]+|receipts\/[^/]+\/slip\/[^/]+|api\/notes\/[^/]+|api\/syllabus\/[^/]+)\/?$/

export const config = {
  matcher: ['/((?!_next/|api/health|api/jobs/|api/webhooks/|api/v1/|favicon|icon|apple-icon|placeholder|.*\\.(?:png|jpg|svg|ico|webp)$).*)'],
}
