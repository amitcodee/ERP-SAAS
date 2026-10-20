'use client'
// Administration / Recycle Bin: what was deleted in the last 30 days, newest first. Restore brings it back where it
// was; Delete for good removes it now. After 30 days the daily purge job removes it by itself.
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw, Search, Trash2 } from 'lucide-react'
import { purgeItemAction, restoreItemAction } from '@/app/actions'
import { useNotify } from '@/components/panel-shell'
import type { BinRow, Kind } from '@/modules/ops/recycle'

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })

export function RecycleBin({ rows, days, kinds, canRestore, canPurge, everyBranch }: { rows: BinRow[]; days: number; kinds: Record<string, string>; canRestore: boolean; canPurge: boolean; everyBranch: boolean }) {
  const notify = useNotify()
  const router = useRouter()
  const [kind, setKind] = useState<Kind | ''>('')
  const [q, setQ] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const counts = useMemo(() => rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.kind]: (a[r.kind] ?? 0) + 1 }), {}), [rows])
  const shown = rows.filter((r) => (!kind || r.kind === kind) && (!q.trim() || `${r.title} ${r.detail ?? ''} ${r.branch ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())))
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => start(async () => { const r = await fn(); notify(r.ok ? ok : (r as { error: string }).error); setConfirm(null); if (r.ok) router.refresh() })
  return (
    <section className="page-container table-page">
      <div className="page-heading"><div><p className="eyebrow">Administration / Recycle Bin</p><h1>Recycle Bin</h1>
        <p className="subheading">Everything deleted in the last {days} days, {everyBranch ? 'from every branch' : 'in this branch'}. Restore puts it back where it was. After {days} days it is removed for good by itself (Settings → Scheduled jobs). Payments, receipts and issued certificates are never deleted.</p></div></div>
      <div className="bin-kinds">
        <button type="button" className={!kind ? 'on' : ''} onClick={() => setKind('')}>All <b>{rows.length}</b></button>
        {Object.entries(kinds).map(([k, label]) => <button key={k} type="button" className={kind === k ? 'on' : ''} onClick={() => setKind(k as Kind)}>{label} <b>{counts[k] ?? 0}</b></button>)}
      </div>
      <div className="panel table-panel">
        <div className="table-toolbar"><div className="table-search"><Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, number, branch…" aria-label="Search the Recycle Bin" /></div></div>
        <div className="table-scroll"><table>
          <thead><tr><th>What</th><th>Type</th><th>Branch</th><th>Deleted</th><th>Removed for good in</th><th /></tr></thead>
          <tbody>
            {shown.map((r) => {
              const key = `${r.kind}:${r.id}`
              return (
                <tr key={key}>
                  <td><strong>{r.title}</strong>{r.detail && <small>{r.detail}</small>}</td>
                  <td><span className="status-badge status-slate"><span className="status-dot" />{kinds[r.kind]}</span></td>
                  <td>{r.branch ?? '—'}</td>
                  <td>{when(r.deletedAt)}<small>by {r.deletedBy ?? '—'}</small></td>
                  <td>{r.purge ? <span className={`status-badge ${r.daysLeft <= 3 ? 'status-red' : r.daysLeft <= 10 ? 'status-amber' : 'status-green'}`}><span className="status-dot" />{r.daysLeft} day{r.daysLeft === 1 ? '' : 's'}</span> : <small>Kept hidden (older records show its name)</small>}</td>
                  <td><div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                    {canRestore && <button type="button" className="filter-button" disabled={pending} onClick={() => act(() => restoreItemAction(r.kind, r.id), `${r.title} restored`)}><RotateCcw size={14} /> Restore</button>}
                    {canPurge && r.purge && (confirm === key
                      ? <button type="button" className="button wl-danger-fill small" disabled={pending} onClick={() => act(() => purgeItemAction(r.kind, r.id), `${r.title} deleted for good`)}>Delete for good</button>
                      : <button type="button" className="filter-button icon-only" title="Delete for good now" aria-label={`Delete ${r.title} for good`} onClick={() => setConfirm(key)}><Trash2 size={14} /></button>)}
                  </div></td>
                </tr>
              )
            })}
            {!shown.length && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>{rows.length ? 'Nothing matches.' : 'The Recycle Bin is empty.'}</td></tr>}
          </tbody>
        </table></div>
      </div>
    </section>
  )
}
