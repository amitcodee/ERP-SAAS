// A private PostgreSQL 16 for development and tests, so nothing ever touches the production database.
//   pnpm dev:db          start it (leave running in its own terminal), creating + migrating + seeding on first run
// Data lives in .devdb/ (gitignored). Delete that folder to start fresh.
import { existsSync } from 'fs'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'

const DIR = '.devdb/data'
const PORT = Number(process.env.DEV_DB_PORT ?? 5655)
const PASSWORD = 'dev-only-password'
export const DEV_DATABASE_URL = `postgresql://postgres:${PASSWORD}@127.0.0.1:${PORT}/saas_dev`

async function main() {
  const fresh = !existsSync(`${DIR}/PG_VERSION`)
  const server = new EmbeddedPostgres({ databaseDir: DIR, user: 'postgres', password: PASSWORD, port: PORT, persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'] })
  if (fresh) await server.initialise()
  await server.start()
  if (fresh) await server.createDatabase('saas_dev')
  console.log(`[dev-db] PostgreSQL 16 ready on 127.0.0.1:${PORT}  (database saas_dev)`)
  console.log(`[dev-db] DATABASE_URL=${DEV_DATABASE_URL}`)

  const stop = async () => { await server.stop(); process.exit(0) }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  // keep alive
  setInterval(async () => {
    try { const c = new pg.Client({ connectionString: DEV_DATABASE_URL }); await c.connect(); await c.end() } catch { /* ignore */ }
  }, 60000)
}
main().catch((e) => { console.error(e); process.exit(1) })
