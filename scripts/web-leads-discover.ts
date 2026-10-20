// Step 1 of bringing the website leads in: look at each website's database (read-only) and draft ONE plan for all of
// them, because every site keeps its enquiries in its own way.
//
//   SITES='[{"site":"https://techcaddludhiana.com","project":"techcadd-ludhiana","db":"postgres://user:pass@host:5432/db"}]' \
//     pnpm -s web-leads:discover > web-leads.plan.json
//
// For each site it lists the tables that look like enquiries (a phone/mobile column next to a name column), with
// their row count and a guessed column mapping. Check the plan (fix a mapping where the guess is wrong, drop tables
// that are not leads), then run `pnpm web-leads:import web-leads.plan.json` (step 2). Nothing is written anywhere.
import pg from 'pg'

type SiteIn = { site: string; project?: string; db: string }
type Column = { table: string; column: string; type: string }

const FIELDS: Record<string, RegExp[]> = {
  name: [/^(full_?)?name$/i, /^(student|customer|lead|user|contact)_?name$/i, /^fullname$/i],
  firstName: [/^first_?name$/i, /^fname$/i],
  lastName: [/^last_?name$/i, /^lname$/i, /^surname$/i],
  phone: [/^(phone|mobile|mobile_?no|phone_?no|phone_?number|mobile_?number|contact|contact_?no|contact_?number|whatsapp|number|tel)$/i],
  email: [/^e?_?mail(_?id|_?address)?$/i],
  course: [/^(course|course_?name|program|programme|interested_?(course|in)|subject|service)$/i],
  location: [/^(city|location|address|area|branch|center|centre|place|state)$/i],
  message: [/^(message|msg|query|remarks?|comments?|description|details|note)$/i],
  sourceUrl: [/^(page_?url|source_?url|url|page|referr?er|landing_?page|form_?url)$/i],
  externalId: [/^id$/i, /^(lead|enquiry|inquiry|contact)_?id$/i, /^uuid$/i],
  submittedAt: [/^(created_?at|created_?on|submitted_?at|date|created|timestamp|inserted_?at|createdat|enquiry_?date)$/i],
}
const LEADISH = /(enquir|inquir|lead|contact|form|submission|registration|callback|query|message|apply|admission)/i
const quoteId = (s: string) => `"${s.replace(/"/g, '""')}"`
const siteName = (site: string) => site.replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '').split(/[/:]/)[0]

async function discover(s: SiteIn) {
  const c = new pg.Client({ connectionString: s.db, statement_timeout: 20000 })
  await c.connect()
  try {
    await c.query('begin read only') // looks only, never changes the website's data
    const cols = (await c.query<Column>(`select table_schema || '.' || table_name as table, column_name as column, data_type as type
      from information_schema.columns where table_schema not in ('pg_catalog','information_schema') order by table_schema, table_name, ordinal_position`)).rows
    const byTable = new Map<string, Column[]>()
    for (const col of cols) byTable.set(col.table, [...(byTable.get(col.table) ?? []), col])
    const tables = []
    for (const [table, list] of byTable) {
      const pick = (f: string) => list.find((col) => FIELDS[f].some((re) => re.test(col.column)))?.column ?? null
      const map = Object.fromEntries(Object.keys(FIELDS).map((f) => [f, pick(f)]).filter(([, v]) => v)) as Record<string, string>
      const hasName = map.name || map.firstName
      if (!map.phone && !map.email) continue
      if (!hasName && !LEADISH.test(table)) continue
      const [schema, name] = table.split('.')
      const rows = Number((await c.query(`select count(*)::int as n from ${quoteId(schema)}.${quoteId(name)}`)).rows[0].n)
      tables.push({ table, rows, leadLike: LEADISH.test(table), map, columns: list.map((col) => col.column) })
    }
    tables.sort((a, b) => Number(b.leadLike) - Number(a.leadLike) || b.rows - a.rows)
    // The import reads the URL from this environment variable, so no password is kept in the plan file.
    const dbEnv = `SITE_DB_${(s.project ?? siteName(s.site)).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
    await c.query('rollback')
    return { site: s.site, project: s.project ?? null, dbEnv, tables }
  } finally {
    await c.end()
  }
}

async function main() {
  const sites = JSON.parse(process.env.SITES ?? '[]') as SiteIn[]
  if (!sites.length) throw new Error('Set SITES to a JSON list of { site, project, db }')
  const plan = []
  for (const s of sites) {
    try {
      plan.push(await discover(s))
    } catch (e) {
      plan.push({ site: s.site, project: s.project ?? null, error: e instanceof Error ? e.message : String(e), tables: [] })
    }
  }
  process.stdout.write(JSON.stringify({ note: 'Check each site: keep only the tables that hold leads, fix any wrong column in "map".', sites: plan }, null, 2) + '\n')
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
