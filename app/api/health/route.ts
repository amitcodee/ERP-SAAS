import { pool } from '@/lib/db/client'
import { redis } from '@/lib/redis'

export const dynamic = 'force-dynamic'

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

// Used by Coolify / Docker health checks. Public on purpose; reveals nothing but up/down.
// The app is "ok" when the database answers. Redis only backs login rate-limiting (which fails open),
// so it is reported but does not fail the check.
export async function GET() {
  const db = await withTimeout(pool.query('select 1'), 3000).then(() => true, () => false)
  const cache = await withTimeout(redis.ping(), 1500).then((r) => r === 'PONG', () => false)
  return Response.json({ ok: db, db, redis: cache }, { status: db ? 200 : 503 })
}
