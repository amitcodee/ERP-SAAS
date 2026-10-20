// The Drizzle schema (lib/db/schema) against the real database the SQL migrations built: every table, column, type,
// NOT NULL, default, foreign key and index must match, so typed queries can trust it. Read-only.
import { is } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { pool } from '../lib/db/client'
import * as schema from '../lib/db/schema'

let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
const norm = (t: string) => t.toLowerCase().replace(/"/g, '').replace('timestamp with time zone', 'timestamptz').replace('time without time zone', 'time')
  .replace('character varying', 'varchar').replace(/^(big)?serial$/, (_m, b) => (b ? 'bigint' : 'integer'))

async function main() {
  try {
    const code = new Map<string, ReturnType<typeof getTableConfig>>()
    for (const v of Object.values(schema)) if (is(v, PgTable)) { const c = getTableConfig(v); code.set(c.name, c) }

    const cols = (await pool.query<{ t: string; n: string; type: string; nn: boolean; hasdef: boolean }>(`
      select c.relname t, a.attname n, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as nn, (a.atthasdef or a.attidentity <> '') as hasdef
      from pg_class c join pg_namespace s on s.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where s.nspname = 'public' and c.relkind in ('r', 'p') order by c.relname, a.attnum`)).rows
    const db = new Map<string, Map<string, (typeof cols)[number]>>()
    for (const r of cols) { if (!db.has(r.t)) db.set(r.t, new Map()); db.get(r.t)!.set(r.n, r) }
    const fks = (await pool.query<{ t: string; col: string; ref: string }>(`
      select c.relname t, a.attname col, r.relname ref from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_class r on r.oid = k.confrelid
      join pg_namespace s on s.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum = k.conkey[1]
      where k.contype = 'f' and s.nspname = 'public' and array_length(k.conkey, 1) = 1`)).rows
    const idx = (await pool.query<{ t: string; name: string }>(`
      select tablename t, indexname as name from pg_indexes where schemaname = 'public'
        and indexname not in (select conname from pg_constraint where contype = 'p')`)).rows

    const missing = [...db.keys()].filter((t) => !code.has(t))
    check('every table in the database is in the schema', !missing.length, missing.join(', '))
    const extra = [...code.keys()].filter((t) => !db.has(t))
    check('every table in the schema is in the database', !extra.length, extra.join(', '))

    const bad: Record<string, string[]> = { columns: [], types: [], notnull: [], defaults: [], fks: [], indexes: [] }
    for (const [t, c] of code) {
      const d = db.get(t)
      if (!d) continue
      const mine = new Map(c.columns.map((x) => [x.name, x]))
      for (const n of d.keys()) if (!mine.has(n)) bad.columns.push(`${t}.${n} (not in schema)`)
      for (const [n, x] of mine) {
        const r = d.get(n)
        if (!r) { bad.columns.push(`${t}.${n} (not in database)`); continue }
        if (norm(x.getSQLType()) !== norm(r.type)) bad.types.push(`${t}.${n}: ${x.getSQLType()} vs ${r.type}`)
        if (x.notNull !== r.nn) bad.notnull.push(`${t}.${n}`)
        const def = x.hasDefault || x.columnType === 'PgSerial' || x.columnType === 'PgBigSerial53' || x.columnType === 'PgBigSerial64'
        if (def !== r.hasdef) bad.defaults.push(`${t}.${n}: ${def ? 'schema has a default' : 'database has a default'}`)
      }
      const codeFks = new Set(c.foreignKeys.filter((f) => f.reference().columns.length === 1).map((f) => `${f.reference().columns[0].name}->${getTableConfig(f.reference().foreignTable).name}`))
      const dbFks = new Set(fks.filter((f) => f.t === t).map((f) => `${f.col}->${f.ref}`))
      for (const f of dbFks) if (!codeFks.has(f)) bad.fks.push(`${t}: ${f} (not in schema)`)
      for (const f of codeFks) if (!dbFks.has(f)) bad.fks.push(`${t}: ${f} (not in database)`)
      const codeIdx = new Set([...c.indexes.map((i) => i.config.name), ...c.uniqueConstraints.map((u) => u.name), ...c.columns.filter((x) => x.isUnique).map((x) => x.uniqueName)].filter(Boolean) as string[])
      // the org boundary indexes migration 0095 generates on every tenant table (checked by pnpm test:tenancy instead)
      const generated = (n: string) => n === `${t}_org_idx` || n === `${t.slice(0, 50)}_org_id_uq`
      for (const i of idx.filter((x) => x.t === t)) if (!codeIdx.has(i.name) && !generated(i.name)) bad.indexes.push(`${t}: ${i.name}`)
    }
    check('columns match', !bad.columns.length, bad.columns.join('; '))
    check('column types match', !bad.types.length, bad.types.join('; '))
    check('NOT NULL matches', !bad.notnull.length, bad.notnull.join('; '))
    check('defaults match (present or not)', !bad.defaults.length, bad.defaults.join('; '))
    check('foreign keys match', !bad.fks.length, bad.fks.join('; '))
    check('every database index is named in the schema', !bad.indexes.length, bad.indexes.join('; '))
    // what the app's role may do: new tables get read / add only, and records that must never change stay that way
    const [acl] = (await pool.query<{ a: string | null }>(`select string_agg(defaclacl::text, ' ') as a from pg_default_acl where defaclobjtype = 'r'`)).rows
    check('new tables are not writable by default (no UPDATE / DELETE for the app)', !/techcadd_app=[a-zA-Z]*[wd]/.test(acl?.a ?? ''), acl?.a ?? '')
    const LOCKED = ['audit_logs', 'fee_ledger', 'payments', 'payment_reversals', 'receipts', 'certificates', 'registration_events', 'enquiry_events', 'support_messages', 'call_followups']
    const open = (await pool.query<{ t: string; u: boolean; d: boolean }>(`select t, has_table_privilege('techcadd_app', t, 'UPDATE') u, has_table_privilege('techcadd_app', t, 'DELETE') d from unnest($1::text[]) t`, [LOCKED])).rows.filter((r) => r.u || r.d)
    check('append-only and immutable tables cannot be changed or emptied by the app', !open.length, open.map((r) => `${r.t}${r.u ? ' UPDATE' : ''}${r.d ? ' DELETE' : ''}`).join(', '))
    const wide = (await pool.query<{ n: number }>(`select count(*)::int n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind in ('r','p') and has_table_privilege('techcadd_app', c.oid, 'DELETE')`)).rows[0].n
    // 21: org_domains joined (0094): removing a custom domain removes its row
    check('DELETE is granted on few tables (where the code removes rows)', wide <= 21, `${wide} tables`)
    console.log(`(${code.size} tables, ${[...code.values()].reduce((n, c) => n + c.columns.length, 0)} columns)`)
  } catch (e) { console.error(e); failed++ }
  await pool.end()
  console.log(failed ? `\n${failed} FAILED` : '\nall checks passed (read-only)')
  process.exitCode = failed ? 1 : 0
}
main()
