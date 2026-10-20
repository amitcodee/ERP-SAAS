import { pool } from '../lib/db/client'
import { migrateAll } from './migrate-prod.mjs' // plain JS, shared with the container

async function main() {
  const done: string[] = await migrateAll(pool)
  console.log(`migrations applied${done.length ? ` (${done.length})` : ''}`)
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
