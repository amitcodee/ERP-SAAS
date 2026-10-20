import Redis from 'ioredis'

const g = globalThis as unknown as { redis?: Redis; memHits?: Map<string, { n: number; until: number }> }
export const redis =
  g.redis ?? new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1, commandTimeout: 1500, lazyConnect: true })
if (process.env.NODE_ENV !== 'production') g.redis = redis
// Redis only backs rate-limiting, which has an in-memory fallback; never let a connection error crash or spam the process.
redis.on('error', () => {})

// Per-process fallback used only while Redis is unreachable. Weaker than Redis (not shared between instances)
// but far better than no limit at all.
const mem = (g.memHits ??= new Map<string, { n: number; until: number }>())
function memIncr(key: string, windowSec: number): number {
  const now = Date.now()
  const cur = mem.get(key)
  if (!cur || cur.until < now) {
    if (mem.size > 5000) for (const [k, v] of mem) if (v.until < now) mem.delete(k)
    mem.set(key, { n: 1, until: now + windowSec * 1000 })
    return 1
  }
  return ++cur.n
}

/** Fixed-window counter. Returns true while the caller is still under `limit`. Uses Redis, falling back to memory. */
export async function underLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  try {
    const n = await redis.incr(key)
    if (n === 1) await redis.expire(key, windowSec)
    return n <= limit
  } catch {
    return memIncr(key, windowSec) <= limit
  }
}

/** True once `key` has been counted `limit` times in its window (reads only; does not count). */
export async function limitReached(key: string, limit: number): Promise<boolean> {
  try {
    return Number(await redis.get(key)) >= limit
  } catch {
    const cur = mem.get(key)
    return !!cur && cur.until >= Date.now() && cur.n >= limit
  }
}

export async function clearLimit(key: string) {
  mem.delete(key)
  await redis.del(key).catch(() => {})
}
