'use client'
// Import from a spreadsheet (app/(panel)/import): students, enquiries or staff of one branch from a CSV file, at any
// time. 1. what the file holds and the template, 2. the branch (head office) and the file, 3. a check that saves nothing,
// 4. the import. Running the same file again skips the rows already in.
import { useState } from 'react'
import { CheckCircle2, Download, FileUp, PlayCircle, UploadCloud } from 'lucide-react'
import { useNotify } from '@/components/panel-shell'
import type { SheetKind } from '@/modules/import/sheet'

type Col = { key: string; need?: boolean; what: string }
type Reject = { line: number; key: string; reason: string }
type Result = {
  commit: boolean; report: { total: number; created: number; skipped: number; rejected: number; rejects: Reject[] }
  staff: { emailed: string[]; show: { name: string; email: string; password: string }[]; pending: boolean } | null
}
const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const NOUN: Record<SheetKind, [string, string]> = { students: ['student', 'students'], enquiries: ['enquiry', 'enquiries'], staff: ['staff member', 'staff'] }
const ABOUT: Record<SheetKind, string> = {
  students: 'Students already studying with you, with their course, fee and what they have paid. Each gets a registration number of the branch; the paid amount goes in as an opening balance (no receipts are made), the next installment as their due.',
  enquiries: 'People who asked about a course, with where they stand (follow-up, demo, not joined…). Nobody is messaged.',
  staff: 'Your team, with their role. Each gets a login; it is e-mailed to them when the import is done (or shown here once).',
}

export function SheetImport({ kinds, columns, branches, fixedBranch }: {
  kinds: SheetKind[]
  columns: Record<SheetKind, Col[]>
  /** head office picks the branch; branch staff import into their own (fixedBranch) */
  branches: { id: string; name: string; code: string }[]
  fixedBranch: string | null
}) {
  const notify = useNotify()
  const [kind, setKind] = useState<SheetKind>(kinds[0])
  const [branchId, setBranchId] = useState(fixedBranch ?? (branches.length === 1 ? branches[0].id : ''))
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState<'' | 'dry' | 'commit'>('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [one, many] = NOUN[kind]
  const branch = branches.find((b) => b.id === branchId)

  const run = async (commit: boolean) => {
    if (!file) return
    setBusy(commit ? 'commit' : 'dry'); setError('')
    const fd = new FormData()
    fd.set('kind', kind); fd.set('file', file)
    if (!fixedBranch) fd.set('branchId', branchId)
    if (commit) fd.set('commit', '1')
    try {
      const res = await fetch('/api/import-sheet', { method: 'POST', body: fd })
      const j = (await res.json().catch(() => ({ ok: false, error: 'The import could not run' }))) as { ok: boolean; error?: string } & Partial<Result>
      if (!j.ok) return setError(j.error ?? 'The import could not run')
      setResult({ commit: !!j.commit, report: j.report!, staff: j.staff ?? null })
      if (j.commit) notify(`Imported: ${j.report!.created} ${j.report!.created === 1 ? one : many}`)
    } catch { setError('The connection dropped: check the network and run it again (rows already in are skipped)') }
    finally { setBusy('') }
  }
  const downloadRejects = () => {
    if (!result) return
    const rows = [['line', 'row', 'reason'], ...result.report.rejects.map((x) => [x.line, x.key, x.reason])]
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }))
    a.download = `${kind}-refused.csv`; a.click(); URL.revokeObjectURL(a.href)
  }
  const reset = () => { setResult(null); setError('') }
  const ready = !!file && !!branchId

  return (
    <section className="page-container">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Setup / Import</p>
          <h1>Import from a spreadsheet</h1>
          <p className="subheading">Bring in students, enquiries or staff from Excel or Google Sheets, whenever you need to: a new branch, a batch from another centre, last year’s list. Check the file first (nothing is saved), then import. Running the same file again only adds what is new.</p>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-header"><div><h2>1. What are you bringing in?</h2><span>Start from the template: its first row names the columns.</span></div></div>
        <div className="row-actions" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }} role="tablist">
          {kinds.map((k) => <button key={k} type="button" role="tab" aria-selected={k === kind} className={k === kind ? 'button primary small' : 'filter-button'} onClick={() => { setKind(k); setFile(null); reset() }}>{k === 'staff' ? 'Staff' : k[0].toUpperCase() + k.slice(1)}</button>)}
        </div>
        <p className="section-hint" style={{ marginTop: 0 }}>{ABOUT[kind]}</p>
        <a className="button secondary" href={`/api/import-sheet?template=${kind}`} download><Download size={14} /> {many[0].toUpperCase() + many.slice(1)} template (CSV)</a>
        <details style={{ marginTop: 12 }}>
          <summary className="section-hint" style={{ cursor: 'pointer' }}>The columns ({columns[kind].filter((c) => c.need).length} needed)</summary>
          <div className="table-scroll"><table>
            <thead><tr><th>Column</th><th>What goes in it</th></tr></thead>
            <tbody>{columns[kind].map((c) => <tr key={c.key}><td><code>{c.key}</code>{c.need && <span className="required-mark">*</span>}</td><td>{c.what}</td></tr>)}</tbody>
          </table></div>
          <p className="section-hint">Other usual names work too (Mobile No., Admission date, Fee paid…). Dates as DD-MM-YYYY; amounts in rupees (₹30,000 is fine). Departments, courses, class modes and sources must be spelt as in your lists.</p>
        </details>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-header"><div><h2>2. Branch and file</h2><span>In Excel: File → Save as → CSV. In Google Sheets: File → Download → CSV.</span></div></div>
        <div className="wl-form">
          {!fixedBranch && <label>Branch<span className="required-mark">*</span>
            <select value={branchId} onChange={(e) => { setBranchId(e.target.value); reset() }}>
              <option value="">Pick the branch…</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
            </select>
          </label>}
          <label>The file (CSV)<span className="required-mark">*</span><input type="file" accept=".csv,text/csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset() }} /></label>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><div><h2>3. Check, then import</h2><span>The check does everything and saves nothing: fix what it turns down in the file and check again.</span></div></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="fee-action-row">
          <button type="button" className="button secondary" disabled={!ready || !!busy} onClick={() => run(false)}><PlayCircle size={15} /> {busy === 'dry' ? 'Checking…' : 'Check the file'}</button>
          <button type="button" className="button primary" disabled={!ready || !!busy || !result || result.commit || !result.report.created} title={!result ? 'Check the file first' : undefined}
            onClick={() => { if (confirm(`Import ${result!.report.created} ${result!.report.created === 1 ? one : many}${branch ? ` into ${branch.name}` : ''}?`)) run(true) }}><UploadCloud size={15} /> {busy === 'commit' ? 'Importing…' : result && !result.commit ? `Import ${result.report.created} ${result.report.created === 1 ? one : many}` : 'Import'}</button>
        </div>
        {result && (
          <div style={{ marginTop: 16 }}>
            <p className={result.commit ? 'fee-note' : 'section-hint'} role="status">{result.commit ? <><CheckCircle2 size={14} /> Imported.</> : <><FileUp size={14} /> Checked: nothing was saved. This is what the import will do.</>}</p>
            <div className="table-summary">
              <div><strong>{result.report.total}</strong><span>Rows in the file</span></div>
              <div><strong className="text-green">{result.report.created}</strong><span>{result.commit ? 'Added' : 'Will be added'}</span></div>
              <div><strong>{result.report.skipped}</strong><span>Already in (skipped)</span></div>
              <div><strong className={result.report.rejected ? 'text-red' : undefined}>{result.report.rejected}</strong><span>Turned down</span></div>
            </div>
            {result.staff?.pending && <p className="fee-note">The branch is not active yet: their logins are e-mailed when it is activated (Branches).</p>}
            {!!result.staff?.emailed.length && <p className="fee-note"><CheckCircle2 size={14} /> Logins e-mailed to {result.staff.emailed.length} {result.staff.emailed.length === 1 ? 'person' : 'people'}.</p>}
            {!!result.staff?.show.length && <>
              <p className="form-error" role="alert">These logins could not be e-mailed. Give each person their one-time password now: it is not shown again.</p>
              <div className="table-scroll"><table><thead><tr><th>Name</th><th>Username</th><th>One-time password</th></tr></thead>
                <tbody>{result.staff.show.map((s) => <tr key={s.email}><td>{s.name}</td><td>{s.email}</td><td><code>{s.password}</code></td></tr>)}</tbody></table></div>
            </>}
            {!!result.report.rejected && <>
              <h3 className="set-sub" style={{ marginTop: 14 }}>Turned down{result.report.rejected > 50 ? ' (first 50)' : ''} <button type="button" className="button secondary" style={{ height: 30, padding: '0 10px', marginLeft: 8 }} onClick={downloadRejects}><Download size={13} /> All (CSV)</button></h3>
              <div className="table-scroll"><table>
                <thead><tr><th>Line</th><th>Row</th><th>Why</th></tr></thead>
                <tbody>{result.report.rejects.slice(0, 50).map((x, i) => <tr key={i}><td>{x.line}</td><td>{x.key}</td><td>{x.reason}</td></tr>)}</tbody>
              </table></div>
            </>}
          </div>
        )}
      </div>
    </section>
  )
}
