// Step 2: brings every website's existing leads into the panel, following the plan made by web-leads:discover.
//
//   pnpm web-leads:import web-leads.plan.json            -> shows what would come in (nothing is written)
//   pnpm web-leads:import web-leads.plan.json --apply    -> writes it into the database in DATABASE_URL
//   WEBLEADS_SECRET=... pnpm web-leads:import web-leads.plan.json --apply --to=<the panel's address, e.g. $APP_URL>
//                                                         -> sends it to the live panel's webhook instead (batches of 100)
//
// The plan lists, per website: its address ("site"), where its database is ("dbEnv": the name of an environment
// variable holding the read-only connection URL, so no password sits in the file) and, per table, which column is
// which ("map"). A site whose leads are not in Postgres can be given as a file instead ("file": an exported .json
// list or .csv with a header row), with the same "map".
// Each lead goes through the same path as the live webhook (modules/web-leads): matched to a branch by its website or
// place, else left waiting under its website. Running it twice adds nothing twice (site + the lead's own id).
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import pg from 'pg'
import { pool } from '../lib/db/client'
import { withOrgSystem } from '../lib/db/withTenant'
import { ingestWebLead, siteHostOf } from '../modules/web-leads/service'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

type Map = Partial<Record<'name' | 'firstName' | 'lastName' | 'phone' | 'email' | 'course' | 'location' | 'message' | 'sourceUrl' | 'externalId' | 'submittedAt', string>>
type TablePlan = { table: string; map: Map; where?: string; skip?: boolean }
type SitePlan = { site: string; project?: string | null; dbEnv?: string; file?: string; map?: Map; tables?: TablePlan[]; skip?: boolean }

const apply = process.argv.includes('--apply')
// --to alone (no address) means the panel in APP_URL.
const toArg = process.argv.find((a) => a === '--to' || a.startsWith('--to='))
const to = toArg ? (toArg.slice(5) || process.env.APP_URL || '').replace(/\/$/, '') : undefined
const planFile = process.argv.slice(2).find((a) => !a.startsWith('--'))
const quoteId = (s: string) => s.split('.').map((p) => `"${p.replace(/"/g, '""')}"`).join('.')

/**
 * One row of the website's data as a lead, by the plan's map. Only the mapped columns are sent (never a whole row:
 * a table may hold passwords or other private columns). Without a mapped id, the row's own content is its id, so a
 * second import of the same rows adds nothing.
 */
function toLead(site: string, row: Record<string, unknown>, map: Map, table: string) {
  const get = (k: keyof Map) => { const col = map[k]; const v = col ? row[col] : undefined; return v == null || v === '' ? null : v }
  const str = (k: keyof Map) => { const v = get(k); return v == null ? null : v instanceof Date ? v.toISOString() : String(v) }
  const name = str('name') ?? [str('firstName'), str('lastName')].filter(Boolean).join(' ')
  const lead = { name: name || '(no name)', phone: str('phone'), email: str('email'), course: str('course'), location: str('location'), message: str('message'), sourceUrl: str('sourceUrl'), submittedAt: str('submittedAt') }
  const id = str('externalId') ?? `h${createHash('sha256').update(JSON.stringify(lead)).digest('hex').slice(0, 24)}`
  return { site, ...lead, externalId: `${table}:${id}` } // the table is part of the key: two tables may both have a row 7
}

function readFileRows(path: string): Record<string, unknown>[] {
  const raw = readFileSync(path, 'utf8')
  if (path.endsWith('.json')) { const j = JSON.parse(raw); return Array.isArray(j) ? j : j.rows ?? j.data ?? [] }
  // CSV with a header row; quoted fields may hold commas, quotes ("") and line breaks.
  const rows: string[][] = []; let cur: string[] = [], f = '', q = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (q) { if (ch === '"' && raw[i + 1] === '"') { f += '"'; i++ } else if (ch === '"') q = false; else f += ch }
    else if (ch === '"') q = true
    else if (ch === ',') { cur.push(f); f = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && raw[i + 1] === '\n') i++; cur.push(f); f = ''; if (cur.some((x) => x !== '')) rows.push(cur); cur = [] }
    else f += ch
  }
  if (f !== '' || cur.length) { cur.push(f); rows.push(cur) }
  const [head, ...body] = rows
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])))
}

async function rowsOf(s: SitePlan): Promise<{ table: string; map: Map; rows: Record<string, unknown>[] }[]> {
  if (s.file) return [{ table: 'file', map: s.map ?? {}, rows: readFileRows(s.file) }]
  const url = s.dbEnv ? process.env[s.dbEnv] : undefined
  if (!url) throw new Error(`set ${s.dbEnv ?? 'dbEnv'} to the site's database URL`)
  const c = new pg.Client({ connectionString: url, statement_timeout: 60000 })
  await c.connect()
  try {
    await c.query('begin read only') // never changes the website's data
    const out = []
    for (const t of (s.tables ?? []).filter((x) => !x.skip)) {
      if (t.where && /;|--|\/\*/.test(t.where)) throw new Error(`${t.table}: "where" must be one plain condition`)
      const order = t.map.submittedAt ? ` order by ${quoteId(t.map.submittedAt)}` : ''
      out.push({ table: t.table, map: t.map, rows: (await c.query(`select * from ${quoteId(t.table)}${t.where ? ` where ${t.where}` : ''}${order}`)).rows })
    }
    await c.query('rollback')
    return out
  } finally {
    await c.end()
  }
}

async function main() {
  if (!planFile) throw new Error('usage: pnpm web-leads:import <plan.json> [--apply] [--to=<panel address>]')
  if (to !== undefined && !/^https?:\/\/[^/]+/.test(to)) throw new Error('--to needs the panel address (or set APP_URL)')
  if (to && apply && !process.env.WEBLEADS_SECRET) throw new Error('set WEBLEADS_SECRET (the same value as on the panel)')
  const plan = JSON.parse(readFileSync(planFile, 'utf8')) as { sites: SitePlan[] }
  const total: Record<string, number> = {}
  for (const s of plan.sites.filter((x) => !x.skip)) {
    const host = siteHostOf(s.site)
    if (!host) { console.log(`✗ ${s.site}: not a website address`); continue }
    const counts: Record<string, number> = {}
    const batch: Record<string, unknown>[] = []
    /** Sends what is collected to the live panel (same path as a website's own form). */
    const flush = async () => {
      if (!batch.length) return
      const sent = batch.length
      let res: Response
      try {
        res = await fetch(`${to}/api/webhooks/web-leads`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.WEBLEADS_SECRET ?? ''}` }, body: JSON.stringify(batch.splice(0)) })
      } catch (e) {
        counts.error = (counts.error ?? 0) + sent; total.error = (total.error ?? 0) + sent
        throw new Error(`${to} could not be reached: ${e instanceof Error ? e.message : e}`)
      }
      const body = await res.json().catch(() => ({})) as { results?: { status: string; error?: string }[]; error?: string }
      if (!body.results) {
        counts.error = (counts.error ?? 0) + sent; total.error = (total.error ?? 0) + sent // none of this batch is in
        throw new Error(`${to} answered ${res.status}: ${body.error ?? ''}`)
      }
      for (const r of body.results ?? []) {
        counts[r.status] = (counts[r.status] ?? 0) + 1; total[r.status] = (total[r.status] ?? 0) + 1
        if (r.error) console.log(`  ! ${r.error}`)
      }
    }
    try {
      for (const t of await rowsOf(s)) {
        for (const row of t.rows) {
          const lead = toLead(s.site, row, t.map, t.table)
          if (to && apply) { batch.push(lead); if (batch.length === 100) await flush(); continue }
          let status: string
          if (!apply) status = lead.phone || lead.email ? 'would_import' : 'no_contact'
          else {
            try { status = (await withOrgSystem(ORG, (tx) => ingestWebLead(tx, lead))).status } catch (e) { status = 'error'; console.log(`  ! ${t.table}: ${e instanceof Error ? e.message : e}`) }
          }
          counts[status] = (counts[status] ?? 0) + 1
          total[status] = (total[status] ?? 0) + 1
        }
        await flush()
      }
      console.log(`✓ ${host}${s.project ? ` (${s.project})` : ''}: ${JSON.stringify(counts)}`)
    } catch (e) {
      console.log(`✗ ${host}: ${e instanceof Error ? e.message : e}`)
    }
  }
  console.log(`${apply ? `Imported${to ? ` into ${to}` : ''}` : 'Dry run (add --apply to write)'}: ${JSON.stringify(total)}`)
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 }).finally(() => pool.end())
