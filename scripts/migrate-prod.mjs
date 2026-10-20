// Runs pending migrations at container start (and from pnpm db:migrate). Plain JS so the runtime image needs no
// TypeScript tooling. Each migration file runs in its OWN transaction: a fresh database applies them all in one go,
// and PostgreSQL will not use an enum value added (ALTER TYPE ... ADD VALUE) until the transaction that added it
// commits - drizzle's migrator puts every pending file in one transaction and fails there. The bookkeeping is
// drizzle's own (drizzle.__drizzle_migrations: sha256 of the file, the journal's `when`), so either tool reads it.
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import pg from 'pg'

const FOLDER = './lib/db/migrations'

/** Applies every migration newer than the last one recorded. Returns the tags applied. */
export async function migrateAll(pool, folder = FOLDER) {
  const journal = JSON.parse(readFileSync(`${folder}/meta/_journal.json`, 'utf8'))
  const c = await pool.connect()
  const done = []
  try {
    await c.query('CREATE SCHEMA IF NOT EXISTS drizzle')
    await c.query('CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)')
    const [last] = (await c.query('SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1')).rows
    const after = last ? Number(last.created_at) : -1
    for (const e of journal.entries) {
      if (e.when <= after) continue
      const text = readFileSync(`${folder}/${e.tag}.sql`, 'utf8')
      const statements = text.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)
      await c.query('BEGIN')
      try {
        for (const s of statements) await c.query(s)
        await c.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [createHash('sha256').update(text).digest('hex'), e.when])
        await c.query('COMMIT')
      } catch (err) {
        await c.query('ROLLBACK')
        err.message = `${e.tag}: ${err.message}`
        throw err
      }
      done.push(e.tag)
    }
  } finally {
    c.release()
  }
  return done
}

async function main() {
  const url = process.env.DATABASE_OWNER_URL || process.env.DATABASE_URL // the tables' owner when the app has its own login
  if (!url) {
    console.error('[migrate] DATABASE_URL is not set')
    process.exit(1)
  }
  const pool = new pg.Pool({ connectionString: url, max: 1 })
  try {
    const done = await migrateAll(pool)
    console.log(`[migrate] database is up to date${done.length ? ` (applied ${done.length})` : ''}`)
  } catch (e) {
    console.error('[migrate] FAILED:', e)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

// run directly (node scripts/migrate-prod.mjs), not when imported by scripts/migrate.ts
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
