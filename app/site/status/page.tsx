import { sql } from 'drizzle-orm'
import { SitePage } from '@/components/site/shell'
import { withPlatform } from '@/lib/db/withTenant'
import { redis } from '@/lib/redis'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Status' }

// Live checks of what the service needs, at the moment the page is opened.
export default async function Status() {
  const t0 = Date.now()
  const db = await withPlatform((tx) => tx.execute(sql`select 1`)).then(() => true, () => false)
  const dbMs = Date.now() - t0
  // Redis only backs rate limits, which fall back to memory: slower protection, not an outage
  const cache = await redis.ping().then(() => true, () => false)
  const all = db
  return (
    <SitePage eyebrow="Status" title={all ? 'All systems working' : 'Some systems are having trouble'} intro={`Checked ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} (India time).`}>
      <div className="site-status">
        <div><span>Web app</span><span style={{ color: '#166534' }}>Working</span></div>
        <div><span>Database</span><span style={{ color: db ? '#166534' : '#b91c1c' }}>{db ? `Working (${dbMs} ms)` : 'Not answering'}</span></div>
        <div><span>Sign-in protection</span><span style={{ color: cache ? '#166534' : '#a16207' }}>{cache ? 'Working' : 'Working (reduced)'}</span></div>
      </div>
    </SitePage>
  )
}
