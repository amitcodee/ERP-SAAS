// A short-lived in-memory cache for what many pages read and few actions change: the course, department and source
// lists, the branch list, role names, branch setup %, today's birthdays. Saves a database trip on nearly every click.
// Every entry belongs to one organisation. A transaction that wrote anything (lib/db/withTenant.ts) empties its org's
// entries once it commits (a platform write empties them all), so this process never shows its own stale copy; another
// process (a second server, an import script) is at most TTL behind.
// Only for values that do not depend on who asks, or whose key carries everything that decides what the database shows.

const DEFAULT_TTL = 60_000
const MAX_ENTRIES = 2000

type Entry = { at: number; ttl: number; value: Promise<unknown> }
type Org = { map: Map<string, Entry>; gen: number }
const g = globalThis as unknown as { appCache?: { orgs: Map<string, Org> } }
const store = (g.appCache ??= { orgs: new Map() })
const size = () => [...store.orgs.values()].reduce((n, o) => n + o.map.size, 0)

const orgOf = (orgId: string): Org => {
  if (!orgId) throw new Error('cached: an orgId is required')
  let o = store.orgs.get(orgId)
  if (!o) store.orgs.set(orgId, (o = { map: new Map(), gen: 0 }))
  return o
}

/** The cached value of `key` in `orgId`, or `load()` (shared by concurrent callers). A failed load is never kept. */
export function cached<T>(orgId: string, key: string, load: () => Promise<T>, ttlMs = DEFAULT_TTL): Promise<T> {
  const now = Date.now()
  const org = orgOf(orgId)
  const hit = org.map.get(key)
  if (hit && now - hit.at < hit.ttl) return hit.value as Promise<T>
  if (size() >= MAX_ENTRIES) for (const o of store.orgs.values()) for (const [k, e] of o.map) if (now - e.at >= e.ttl) o.map.delete(k)
  const gen = org.gen
  const value = load()
  const entry: Entry = { at: now, ttl: ttlMs, value }
  org.map.set(key, entry)
  // A write that commits while this load runs may not be in what it read: keep the result for this caller only.
  value.then(() => { if (org.gen !== gen && org.map.get(key) === entry) org.map.delete(key) },
    () => { if (org.map.get(key) === entry) org.map.delete(key) })
  return value
}

/** Forget one org's entries (after a write in it, see withTenant), or with no org everything. */
export function dropCache(orgId?: string) {
  for (const [id, o] of store.orgs) {
    if (orgId && id !== orgId) continue
    o.gen++
    o.map.clear()
  }
}
