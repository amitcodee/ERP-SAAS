import { revalidatePath } from 'next/cache'
import { sql } from 'drizzle-orm'
import { audit } from '@/lib/audit'
import { getActor } from '@/lib/auth/current'
import { db } from '@/lib/db/client'
import { applyTenant, type Actor } from '@/lib/db/withTenant'
import { userMessage } from '@/lib/errors'
import { DEFAULT_DEPT_MAP, importOldFees, importOldRegistrations, type OldReport } from '@/modules/import/oldsystem'
import { parseCsv } from '@/modules/import/legacy'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** The most one upload may weigh (the shared fee table of every branch is the big one). */
const MAX_BYTES = 40 * 1024 * 1024
class DryRun extends Error {}

// Old System Import (head office): the old system's tables exported from phpMyAdmin as CSV, brought into one branch.
// multipart: branchId, registrations (<branch>_registration.csv), fees (fee.csv), map (optional "course_type,department"),
// commit=1 to keep the data (else a dry run: everything happens and is rolled back, the report says what would happen).
// The same engine as `pnpm import:legacy` (modules/import/oldsystem.ts): old numbers kept, new admissions carry on after
// the highest, and a re-run skips what is already in, so it can be run again to sync while the old system is in use.
export async function POST(req: Request) {
  const origin = req.headers.get('origin')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (!origin || !host || new URL(origin).host !== host) return Response.json({ ok: false, error: 'Bad origin' }, { status: 403 })
  const { actor } = await getActor()
  if (actor.role !== 'super_admin') return Response.json({ ok: false, error: 'Only head office can import the old system' }, { status: 403 })
  if (Number(req.headers.get('content-length') ?? Infinity) > MAX_BYTES) return Response.json({ ok: false, error: 'The files are too big (40 MB at most together)' }, { status: 413 })
  try {
    const fd = await req.formData()
    const branchId = String(fd.get('branchId') ?? '')
    if (!/^[0-9a-f-]{36}$/i.test(branchId)) throw new Error('Pick the branch')
    const text = async (k: string) => { const f = fd.get(k); return f instanceof File && f.size ? (await f.text()).replace(/^﻿/, '') : null }
    const [regs, fees, mapText] = [await text('registrations'), await text('fees'), await text('map')]
    if (!regs && !fees) throw new Error('Add the registration file, the fee file, or both')
    const commit = fd.get('commit') === '1'
    const deptMap = mapText ? { ...DEFAULT_DEPT_MAP, ...Object.fromEntries(parseCsv(mapText).map((r) => [Object.values(r)[0], Object.values(r)[1]])) } : undefined
    // head office acting in the chosen branch: the import runs under the database's rules for that branch
    const as: Actor = { ...actor, branchId }
    const reports: OldReport[] = []
    try {
      await db.transaction(async (tx) => {
        await applyTenant(tx, as)
        const [b] = (await tx.execute<{ id: string }>(sql`select id from branches where id = ${branchId}::uuid`)).rows
        if (!b) throw new Error('That branch does not exist')
        // the students first, then their payments
        if (regs) reports.push(await importOldRegistrations(tx, as, parseCsv(regs), deptMap))
        if (fees) reports.push(await importOldFees(tx, as, parseCsv(fees)))
        if (commit) await audit(tx, as, { action: 'import_old_system', entity: 'branch', entityId: branchId, after: reports.map((r) => ({ kind: r.kind, total: r.total, created: r.created, skipped: r.skipped, rejected: r.rejects.length })) })
        if (!commit) throw new DryRun()
      })
    } catch (e) {
      if (!(e instanceof DryRun)) throw e
    }
    if (commit) revalidatePath('/', 'layout')
    return Response.json({ ok: true, commit, reports })
  } catch (e) {
    return Response.json({ ok: false, error: userMessage(e, 'The import could not run') }, { status: 400 })
  }
}
