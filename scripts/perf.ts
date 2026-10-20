// Times the main page as a specific user against a running server:  pnpm perf  (on the private dev database)
// Usage: tsx scripts/perf.ts <userId> <role> <branchId|-> [runs]
import { SAMPLE_ORG_ID } from '../lib/db/schema/tenancy'
import pg from 'pg'
import { signSession } from '../lib/auth/session'

async function main() {
  const [userId, role, branchId, runs = '5'] = process.argv.slice(2)
  if (!/127.0.0.1|localhost/.test(process.env.DATABASE_URL ?? '')) throw new Error('perf is for the private dev database only')
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect()
  const pwv = (await c.query('update users set must_change_password = false where id = $1 returning password_changed_at', [userId])).rows[0].password_changed_at.getTime()
  await c.end()
  const tok = await signSession({ pwv, org: SAMPLE_ORG_ID, orgSlug: 'sample', userId, name: 'Perf User', email: 'perf@test', roles: [role as never], role: role as never, branchId: branchId === '-' ? null : branchId, branchName: 'Perf' })
  const base = process.env.BASE_URL ?? 'http://localhost:3300'
  const times: number[] = []
  let size = 0, status = 0
  for (let i = 0; i < Number(runs); i++) {
    const t = performance.now()
    const r = await fetch(`${base}/`, { headers: { cookie: `tc_session=${tok}` }, redirect: 'manual' })
    const body = await r.text()
    times.push(Math.round(performance.now() - t)); size = body.length; status = r.status
  }
  console.log(`status=${status} size=${(size / 1024).toFixed(0)}KB  times(ms)=${times.join(', ')}  median=${[...times].sort((a, b) => a - b)[Math.floor(times.length / 2)]}ms`)
}
main()
