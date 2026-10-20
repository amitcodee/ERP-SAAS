// The shared cache (lib/cache.ts): kept across reads, emptied by any transaction that wrote once it commits, never
// keeps a load that a write overtook. Commits for real (one lookup row), and removes it again at the end.
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { lookups } from '../lib/db/schema'
import { withOrgSystem } from '../lib/db/withTenant'
import { cached, dropCache } from '../lib/cache'
import { cachedCatalogs } from '../modules/catalog/service'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
const VALUE = `Cache test ${Date.now()}`
const OTHER = '00000000-0000-4000-8000-0000000000ff' // never touches the database: only the cache's own bookkeeping
const sources = () => withOrgSystem(ORG, async (tx) => (await cachedCatalogs(tx, ORG)).sources.map((s) => s.value))

async function main() {
  try {
    dropCache()
    let loads = 0
    const load = async () => ++loads
    await cached(ORG, 't', load); await cached(ORG, 't', load)
    check('a second read is served from the cache', loads === 1)
    await Promise.all([cached(ORG, 'u', load), cached(ORG, 'u', load)])
    check('callers at the same moment share one load', loads === 2)

    await withOrgSystem(ORG, (tx) => tx.select().from(lookups).limit(1))
    await cached(ORG, 't', load)
    check('a read-only transaction keeps the cache', loads === 2)

    const before = await sources()
    await withOrgSystem(ORG, (tx) => tx.insert(lookups).values({ kind: 'enquiry_source', value: VALUE, sortOrder: 999 }))
    await cached(ORG, 't', load)
    check('a committed write empties the cache', loads === 3)
    check('a new list entry shows at once', !before.includes(VALUE) && (await sources()).includes(VALUE))

    await withOrgSystem(ORG, async (tx) => { await tx.update(lookups).set({ value: `${VALUE} x` }).where(eq(lookups.value, VALUE)); throw new Error('undo') }).catch(() => {})
    check('a rolled-back write changes nothing', (await sources()).includes(VALUE))

    let release!: () => void
    const slow = cached(ORG, 'slow', () => new Promise<number>((r) => { release = () => r(1) }))
    dropCache() // a write commits while the load is still running
    release(); await slow
    let again = 0
    await cached(ORG, 'slow', async () => ++again)
    check('a load overtaken by a write is not kept', again === 1)

    await cached(ORG, 'bad', () => Promise.reject(new Error('db down'))).catch(() => {})
    check('a failed load is not kept', (await cached(ORG, 'bad', async () => 'ok')) === 'ok')

    // every entry belongs to one org: the same key in another org is its own entry, and a write empties only its org
    await cached(ORG, 'k', async () => 'sample'); await cached(OTHER, 'k', async () => 'other')
    check('the same key in two orgs holds two values', (await cached(ORG, 'k', async () => 'x')) === 'sample' && (await cached(OTHER, 'k', async () => 'x')) === 'other')
    await withOrgSystem(ORG, (tx) => tx.insert(lookups).values({ kind: 'enquiry_source', value: `${VALUE} 2`, sortOrder: 999 }))
    check('a write in one org empties that org only', (await cached(ORG, 'k', async () => 'fresh')) === 'fresh' && (await cached(OTHER, 'k', async () => 'x')) === 'other')
    dropCache()
    check('with no org, everything is emptied (a platform write)', (await cached(OTHER, 'k', async () => 'gone')) === 'gone')
  } finally {
    await db.delete(lookups).where(sql`${lookups.value} like 'Cache test %'`) // the app's login may not delete list entries
    dropCache()
    await pool.end()
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed')
  process.exit(failed ? 1 : 0)
}
main()
