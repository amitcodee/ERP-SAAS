// Gives the panel its own database login, so the running app no longer signs in as the database owner (postgres).
// Run once, inside the app container (Coolify → techcadd-panel → Terminal):  node scripts/create-db-login.mjs
//
// The new login "techcadd_web" can only act as the app role (techcadd_app): row-level security always applies, it
// cannot change tables, read server files or run programs. Running this again gives it a new password.
// Then in Coolify → Environment Variables:
//   DATABASE_OWNER_URL = the current DATABASE_URL (the owner: migrations, data reset, Recycle Bin purge)
//   DATABASE_URL       = the URL this script prints
// and redeploy.
import { randomBytes } from 'crypto'
import pg from 'pg'

const ownerUrl = process.env.DATABASE_OWNER_URL || process.env.DATABASE_URL
if (!ownerUrl) { console.error('DATABASE_URL is not set (run this inside the app container)'); process.exit(1) }
const LOGIN = 'techcadd_web'

const c = new pg.Client({ connectionString: ownerUrl })
await c.connect()
try {
  const password = randomBytes(24).toString('hex') // hex: safe inside a URL as it is
  const exists = (await c.query('select 1 from pg_roles where rolname = $1', [LOGIN])).rowCount > 0
  // the password cannot be a bind parameter in CREATE / ALTER ROLE: it is hex, so quoting it is safe
  await c.query(`${exists ? 'ALTER' : 'CREATE'} ROLE ${LOGIN} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`)
  await c.query(`GRANT techcadd_app TO ${LOGIN}`)
  const db = (await c.query('select current_database() as d')).rows[0].d
  await c.query(`GRANT CONNECT ON DATABASE "${db.replace(/"/g, '""')}" TO ${LOGIN}`)
  const url = new URL(ownerUrl)
  url.username = LOGIN
  url.password = password
  console.log(`${exists ? 'Updated' : 'Created'} the login ${LOGIN}.\n`)
  console.log('In Coolify → Environment Variables, set:')
  console.log('  DATABASE_OWNER_URL = (the current DATABASE_URL, unchanged)')
  console.log(`  DATABASE_URL       = ${url.toString()}`)
  console.log('\nthen redeploy. Keep this URL secret; it is not shown again (run this again for a new password).')
} finally {
  await c.end()
}
