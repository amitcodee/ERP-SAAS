import { audit } from '@/lib/audit'
import { loadPanelBase } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { toCsv, toPdf, toXlsx, type Sheet } from '@/lib/export/formats'
import { todayIST } from '@/lib/ist'
import type { ListQuery } from '@/lib/list-query'
import { EXPORTS, MAX_ROWS } from '@/modules/exports/lists'
import { userMessage } from '@/lib/errors'

export const dynamic = 'force-dynamic'

const TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  pdf: 'application/pdf',
} as const

/** The search / filters / dates / sort of the screen, as sent by the Export button (the services whitelist each part). */
function readQuery(raw: string | null): ListQuery {
  try {
    const v = raw ? JSON.parse(raw) : {}
    const str = (x: unknown, n = 200) => (typeof x === 'string' ? x.slice(0, n) : undefined)
    const f = v && typeof v.f === 'object' && v.f ? Object.fromEntries(Object.entries(v.f).slice(0, 20).map(([k, x]) => [k.slice(0, 40), str(x, 100) ?? ''])) : undefined
    return { q: str(v.q), from: str(v.from, 10), to: str(v.to, 10), sort: str(v.sort, 40), dir: v.dir === 'asc' ? 'asc' : v.dir === 'desc' ? 'desc' : undefined, f }
  } catch { return {} }
}

// Downloads a list as Excel, CSV or PDF: GET /api/export?list=fees&format=xlsx&query={...}
// Only for those who may open the list's page; every download is written to the activity log.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const def = EXPORTS[url.searchParams.get('list') ?? '']
  const format = url.searchParams.get('format') as keyof typeof TYPES
  if (!def || !(format in TYPES)) return new Response('Unknown list or format', { status: 400 })
  const b = await loadPanelBase()
  if (b.mustChange || b.session.role === 'student' || !b.modules.includes(def.module)) return new Response('Forbidden', { status: 403 })
  const query = readQuery(url.searchParams.get('query'))
  try {
    const rows = await withTenant(b.actor, async (tx) => {
      const r = await def.rows(tx, b.actor, query)
      await audit(tx, b.actor, { action: 'export', entity: 'list', after: { list: url.searchParams.get('list'), format, rows: r.length, query } })
      return r
    })
    const filters = [query.q && `search “${query.q}”`, query.from && `from ${query.from}`, query.to && `to ${query.to}`, ...Object.entries(query.f ?? {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join(' · ')
    const sheet: Sheet = {
      title: def.title, columns: def.columns, rows: rows.slice(0, MAX_ROWS),
      subtitle: [b.user.branchName, filters, rows.length >= MAX_ROWS ? `first ${MAX_ROWS.toLocaleString('en-IN')} rows only` : ''].filter(Boolean).join(' · '),
    }
    const body = format === 'xlsx' ? toXlsx(sheet) : format === 'csv' ? toCsv(sheet) : await toPdf(sheet)
    const name = `${def.title.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '')}-${b.user.branchName.replace(/[^\w]+/g, '-')}-${todayIST()}.${format}`
    return new Response(new Uint8Array(body), {
      headers: { 'Content-Type': TYPES[format], 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' },
    })
  } catch (e) {
    return new Response(userMessage(e, 'Could not make the file'), { status: 500 })
  }
}
