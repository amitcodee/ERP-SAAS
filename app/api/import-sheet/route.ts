import { revalidatePath } from 'next/cache'
import { sql } from 'drizzle-orm'
import { audit } from '@/lib/audit'
import { getActor } from '@/lib/auth/current'
import { can } from '@/lib/auth/permissions'
import { withTenant, type Actor } from '@/lib/db/withTenant'
import { userMessage } from '@/lib/errors'
import { appOrigin } from '@/lib/app-url'
import { roleNames } from '@/modules/branches/service'
import { mailLogins } from '@/modules/branches/welcome'
import { parseCsv } from '@/modules/import/legacy'
import { importSheet, sheetTemplate, SHEET_KINDS, type SheetKind, type SheetReport } from '@/modules/import/sheet'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_BYTES = 5 * 1024 * 1024
class DryRun extends Error {}

/** Who may bring in each kind: whoever may add one on its own screen. */
const allowed = (actor: Actor, kind: SheetKind) =>
  kind === 'students' ? can(actor, 'create', 'registration') : kind === 'enquiries' ? can(actor, 'create', 'enquiry') : can(actor, 'create', 'user')

// Import from a spreadsheet (modules/import/sheet.ts), for the Import page.
// GET ?template=students|enquiries|staff: the template file.
// POST multipart: kind, file (CSV), branchId (head office: the branch it goes into; branch staff: their own),
// commit=1 to keep it (else a dry run: everything happens and is rolled back; the report says what would happen).
export async function GET(req: Request) {
  await getActor()
  const kind = new URL(req.url).searchParams.get('template') as SheetKind
  if (!SHEET_KINDS.includes(kind)) return new Response('Not found', { status: 404 })
  return new Response(`﻿${sheetTemplate(kind)}`, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${kind}-template.csv"` } })
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (!origin || !host || new URL(origin).host !== host) return Response.json({ ok: false, error: 'Bad origin' }, { status: 403 })
  const { actor } = await getActor()
  if (Number(req.headers.get('content-length') ?? Infinity) > MAX_BYTES) return Response.json({ ok: false, error: 'The file is too big (5 MB at most): split it' }, { status: 413 })
  try {
    const fd = await req.formData()
    const kind = String(fd.get('kind') ?? '') as SheetKind
    if (!SHEET_KINDS.includes(kind)) throw new Error('Pick what the file holds')
    if (!allowed(actor, kind)) return Response.json({ ok: false, error: 'You cannot add these' }, { status: 403 })
    const branchId = actor.role === 'super_admin' ? String(fd.get('branchId') ?? '') : actor.branchId
    if (!branchId || !/^[0-9a-f-]{36}$/i.test(branchId)) throw new Error('Pick the branch they belong to')
    const f = fd.get('file')
    if (!(f instanceof File) || !f.size) throw new Error('Choose the file')
    if (/\.xlsx?$/i.test(f.name)) throw new Error('That is an Excel workbook: in Excel use File → Save as → CSV, then choose that file')
    const commit = fd.get('commit') === '1'
    const rows = parseCsv((await f.text()).replace(/^﻿/, ''))
    // head office working in the chosen branch: the import runs under the database's rules for that branch
    const as: Actor = { ...actor, branchId }
    type BranchRow = { id: string; name: string; code: string; status: string; certCode: string | null; city: string | null; address: string | null; state: string | null; pincode: string | null; phone: string | null }
    const out: { report?: SheetReport; branch?: BranchRow } = {}
    try {
      // a dry run throws at the end, so everything it did is rolled back
      await withTenant(as, async (tx) => {
        const [b] = (await tx.execute<BranchRow>(sql`
          select id, name, code, status, cert_code as "certCode", city, address, state, pincode, phone from branches where id = ${branchId}::uuid`)).rows
        if (!b) throw new Error('That branch does not exist')
        out.branch = b
        const report = out.report = await importSheet(tx, as, kind, rows)
        if (commit) await audit(tx, as, { action: 'import_sheet', entity: 'branch', entityId: branchId, after: { kind, file: f.name.slice(0, 120), total: report.total, created: report.created, skipped: report.skipped, rejected: report.rejects.length } })
        if (!commit) throw new DryRun()
      })
    } catch (e) {
      if (!(e instanceof DryRun)) throw e
    }
    const r = out.report
    if (!r) throw new Error('The import could not run')
    // staff: their logins, once the import is in (a branch not active yet: they go out when it is activated)
    let staff: { emailed: string[]; show: { name: string; email: string; password: string }[]; pending: boolean } | null = null
    if (commit && kind === 'staff' && r.logins.length) {
      const b = out.branch ?? null
      if (b && b.status !== 'active') staff = { emailed: [], show: [], pending: true }
      else {
        const names = await withTenant(actor, (tx) => roleNames(tx))
        const mailed = await mailLogins(actor.orgId, b, r.logins, names, await appOrigin(actor.orgId))
        staff = { emailed: mailed.filter((m) => m.emailed).map((m) => m.email), show: mailed.filter((m) => !m.emailed).map((m) => ({ name: m.name, email: m.email, password: m.password ?? '' })), pending: false }
      }
    }
    if (commit) revalidatePath('/', 'layout')
    return Response.json({ ok: true, commit, report: { total: r.total, created: r.created, skipped: r.skipped, rejects: r.rejects.slice(0, 500), rejected: r.rejects.length }, staff })
  } catch (e) {
    return Response.json({ ok: false, error: userMessage(e, 'The import could not run') }, { status: 400 })
  }
}
