'use client'
// Old System Import: bring a branch's records from the institute's old system (phpMyAdmin CSV exports) into the panel.
// 1. the branch (its number format must be set), 2. the files, 3. a dry run that saves nothing, 4. the import.
// Running it again later brings over only what is new, so it keeps the panel in step until the old system is switched off.
import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Download, FileUp, PlayCircle, UploadCloud } from 'lucide-react'
import { useNotify } from '@/components/panel-shell'
import type { OldReport } from '@/modules/import/oldsystem'

type Branch = { id: string; code: string; name: string; regFormat: string | null; next: string | null; imported: number }
const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

export function OldImport({ branches }: { branches: Branch[] }) {
  const notify = useNotify()
  const [branchId, setBranchId] = useState('')
  const [files, setFiles] = useState<{ registrations: File | null; fees: File | null; map: File | null }>({ registrations: null, fees: null, map: null })
  const [busy, setBusy] = useState<'' | 'dry' | 'commit'>('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ commit: boolean; reports: OldReport[] } | null>(null)
  const b = branches.find((x) => x.id === branchId)

  const run = async (commit: boolean) => {
    setBusy(commit ? 'commit' : 'dry'); setError('')
    const fd = new FormData()
    fd.set('branchId', branchId)
    if (files.registrations) fd.set('registrations', files.registrations)
    if (files.fees) fd.set('fees', files.fees)
    if (files.map) fd.set('map', files.map)
    if (commit) fd.set('commit', '1')
    try {
      const res = await fetch('/api/import-old', { method: 'POST', body: fd })
      const j = (await res.json().catch(() => ({ ok: false, error: 'The import could not run' }))) as { ok: boolean; error?: string; commit?: boolean; reports?: OldReport[] }
      if (!j.ok) return setError(j.error ?? 'The import could not run')
      setResult({ commit: !!j.commit, reports: j.reports ?? [] })
      if (j.commit) notify('Imported: the records are in the panel')
    } catch { setError('The connection dropped: check the network and run it again (rows already imported are skipped)') }
    finally { setBusy('') }
  }
  const downloadRejects = () => {
    if (!result) return
    const rows = [['file', 'line', 'number', 'reason'], ...result.reports.flatMap((r) => r.rejects.map((x) => [r.kind, x.line, x.key, x.reason]))]
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }))
    a.download = `import-rejects-${b?.code ?? 'branch'}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }
  const pick = (k: keyof typeof files) => (e: React.ChangeEvent<HTMLInputElement>) => { setFiles({ ...files, [k]: e.target.files?.[0] ?? null }); setResult(null) }
  const ready = !!b?.regFormat && (files.registrations || files.fees)

  return (
    <section className="page-container">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Administration / Old System Import</p>
          <h1>Old System Import</h1>
          <p className="subheading">Bring a branch’s students and payments over from your old system. Every student keeps their old registration number, new admissions carry on after the highest one, and running it again later brings over only what is new — so it keeps the panel in step until the old system is switched off.</p>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-header"><div><h2>1. Export from the old system</h2><span>In phpMyAdmin (cPanel → phpMyAdmin → database techcff9_techit)</span></div></div>
        <ol className="section-hint" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
          <li>Click the branch’s table, e.g. <b>hsp_registration</b> (Hoshiarpur), <b>jal_registration</b> (Jalandhar) → <b>Export</b> → Format <b>CSV</b> → tick <b>“Put columns names in the first row”</b> → Export.</li>
          <li>Do the same for the <b>fee</b> table (it holds every branch’s payments; only this branch’s are taken).</li>
          <li>Nothing in the old system is changed by exporting.</li>
        </ol>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-header"><div><h2>2. Branch and files</h2><span>Set the branch’s number format first in Branches → Registration numbers (e.g. <code>TCD/4002/{'{n}'}</code> for Hoshiarpur).</span></div></div>
        <div className="wl-form">
          <label>Branch<span className="required-mark">*</span>
            <select value={branchId} onChange={(e) => { setBranchId(e.target.value); setResult(null) }}>
              <option value="">Pick the branch…</option>
              {branches.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.code}){x.imported ? ` · ${x.imported} imported so far` : ''}</option>)}
            </select>
          </label>
          <label>Old registrations (CSV)<input type="file" accept=".csv,text/csv" onChange={pick('registrations')} /></label>
          <label>Old fees (CSV)<input type="file" accept=".csv,text/csv" onChange={pick('fees')} /></label>
          <label>Course type map (optional CSV: course_type,department)<input type="file" accept=".csv,text/csv" onChange={pick('map')} /></label>
        </div>
        {b && (b.regFormat
          ? <p className="section-hint" style={{ marginTop: 10 }}><CheckCircle2 size={14} style={{ color: '#16a34a', verticalAlign: -2 }} /> Number format <b>{b.regFormat}</b>{b.next ? <> · next new admission now: <b>{b.next}</b></> : null}{b.imported ? <> · {b.imported} students already brought over (they are skipped)</> : null}</p>
          : <p className="fee-note" role="alert"><AlertTriangle size={14} /> {b.name} has no registration number format yet. Set it in <Link href="/branches">Branches → Registration numbers</Link> (e.g. TCD/4002/{'{n}'}), then come back.</p>)}
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-header"><div><h2>3. Check, then import</h2><span>The dry run does everything and saves nothing; read its report, fix what it refuses in the old system (or here), and run it again.</span></div></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="fee-action-row">
          <button type="button" className="button secondary" disabled={!ready || !!busy} onClick={() => run(false)}><PlayCircle size={15} /> {busy === 'dry' ? 'Checking… (a minute for thousands of rows)' : 'Dry run (saves nothing)'}</button>
          <button type="button" className="button primary" disabled={!ready || !!busy || !result || result.commit} title={!result ? 'Do a dry run first' : undefined}
            onClick={() => { if (confirm(`Import into ${b?.name}? Rows already brought over are skipped; this can be run again later to sync.`)) run(true) }}><UploadCloud size={15} /> {busy === 'commit' ? 'Importing…' : 'Import for real'}</button>
        </div>
        {result && (
          <div style={{ marginTop: 16 }}>
            <p className={result.commit ? 'fee-note' : 'section-hint'} role="status">{result.commit ? <><CheckCircle2 size={14} /> Imported.</> : <><FileUp size={14} /> Dry run: nothing was saved. This is what the import will do.</>}</p>
            <div className="table-scroll"><table>
              <thead><tr><th>File</th><th>Rows</th><th>{result.commit ? 'Brought over' : 'Would be brought over'}</th><th>Already in (skipped)</th><th>Refused</th></tr></thead>
              <tbody>{result.reports.map((r) => <tr key={r.kind}><td>{r.kind}</td><td>{r.total}</td><td><b>{r.created}</b></td><td>{r.skipped}</td><td>{r.rejects.length ? <span className="status-badge status-red">{r.rejects.length}</span> : 0}</td></tr>)}</tbody>
            </table></div>
            {result.reports.some((r) => r.rejects.length) && <>
              <h3 className="set-sub" style={{ marginTop: 14 }}>Refused rows (first 50) <button type="button" className="button secondary" style={{ height: 30, padding: '0 10px', marginLeft: 8 }} onClick={downloadRejects}><Download size={13} /> All (CSV)</button></h3>
              <div className="table-scroll"><table>
                <thead><tr><th>File</th><th>Line</th><th>Number</th><th>Why</th></tr></thead>
                <tbody>{result.reports.flatMap((r) => r.rejects.map((x) => ({ ...x, kind: r.kind }))).slice(0, 50).map((x, i) => <tr key={i}><td>{x.kind}</td><td>{x.line}</td><td>{x.key}</td><td>{x.reason}</td></tr>)}</tbody>
              </table></div>
            </>}
            {result.reports.some((r) => r.notes.length) && <>
              <h3 className="set-sub" style={{ marginTop: 14 }}>Notes</h3>
              <ul className="section-hint" style={{ margin: 0, paddingLeft: 18 }}>{result.reports.flatMap((r) => r.notes).slice(0, 60).map((n, i) => <li key={i}>{n}</li>)}</ul>
            </>}
          </div>
        )}
      </div>
    </section>
  )
}
