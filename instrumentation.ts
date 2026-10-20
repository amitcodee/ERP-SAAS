import type { Instrumentation } from 'next'
import { log } from '@/lib/log'

// The panel's own scheduler (daily jobs at the times in Settings → Scheduled jobs, webhooks every minute). It runs in
// the production server; in development only when SCHEDULER=on.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NODE_ENV === 'production') {
    // say at start-up, loudly, what would otherwise only fail on the first sign-in, certificate or reset e-mail
    const { serverSecret } = await import('@/lib/auth/secret')
    for (const name of ['AUTH_SECRET', 'CERT_SECRET'] as const) try { serverSecret(name) } catch (e) { log.error('config.secret', { error: e }) }
    if (!/^https:\/\//.test(process.env.APP_URL ?? '')) log.error('config.app_url', { error: 'APP_URL must be set to the https address of the panel' })
    // Aadhaar numbers saved before they were encrypted (or brought in by an import) are sealed now, in the background
    void (async () => {
      const [{ withOrgSystem }, { sealPlainAadhaars }, { activeOrgs }] = await Promise.all([import('@/lib/db/withTenant'), import('@/modules/people/aadhaar-store'), import('@/lib/tenant/orgs')])
      let n = 0, sealed = 0
      for (const org of await activeOrgs()) do { n = await withOrgSystem(org.id, (tx) => sealPlainAadhaars(tx, org.id)); sealed += n } while (n > 0)
      if (sealed) log.info('aadhaar.sealed', { count: sealed })
    })().catch((error) => log.error('aadhaar.seal_failed', { error }))
  }
  if (process.env.NODE_ENV !== 'production' && process.env.SCHEDULER !== 'on') return
  const { startScheduler } = await import('@/lib/scheduler')
  startScheduler()
}

// Any error that escapes a page render, route handler or server action lands here as one JSON log line.
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  log.error('request.error', { path: request.path, method: request.method, route: context.routePath, kind: context.routeType, error })
}
