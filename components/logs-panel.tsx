'use client'

import { useState, useTransition } from 'react'
import { RotateCcw } from 'lucide-react'
import { queryLogsAction, restoreDeletedAction } from '@/app/actions'
import { ListToolbar, SortTh } from '@/components/list-toolbar'
import { Pager } from '@/components/pager'
import { PAGE_SIZE, usePagedList } from '@/components/use-paged-list'
import type { LogRow } from '@/modules/audit/service'
import type { DeletedRow } from '@/modules/enquiries/service'

type Opt = { value: string; label: string }
const fmtTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })
const TONE: Record<string, string> = { create: 'status-green', delete: 'status-red', update: 'status-blue', transition: 'status-violet', follow_up: 'status-amber', login: 'status-slate' }

/** The audit log: who did what, on which record, and when. It can only be read; nothing here can be changed. */
export function LogsPanel({ rows, total, filters, branches, deleted, canRestore, notify }: {
  rows: LogRow[]; total: number; filters: { actions: Opt[]; entities: Opt[]; people: Opt[] }; branches: { id: string; code: string; name: string }[]
  deleted: DeletedRow[]; canRestore: { call: boolean; lead: boolean }; notify: (m: string) => void
}) {
  const list = usePagedList({ rows, total }, queryLogsAction)
  const [tab, setTab] = useState<'activity' | 'deleted'>('activity')
  const [pending, start] = useTransition()
  const restore = (r: DeletedRow) => start(async () => {
    const res = await restoreDeletedAction(r.kind, r.id)
    notify(res.ok ? `${r.name ?? 'Record'} restored` : res.error)
  })
  const showBranch = branches.length > 0 // head office: the log of every branch
  return (
    <section className="page-container table-page">
      <div className="page-heading">
        <div><p className="eyebrow">Administration / Logs</p><h1>Logs</h1><p className="subheading">Every action in the panel: who did it, on which record, and when. The log cannot be edited or deleted.</p></div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <div className="seg">
          <button type="button" className={tab === 'activity' ? 'on' : ''} aria-pressed={tab === 'activity'} onClick={() => setTab('activity')}>Activity</button>
          <button type="button" className={tab === 'deleted' ? 'on' : ''} aria-pressed={tab === 'deleted'} onClick={() => setTab('deleted')}>Deleted leads &amp; calls ({deleted.length})</button>
        </div>
      </div>
      {tab === 'deleted' && (
        <div className="panel table-panel">
          <p className="section-hint" style={{ margin: 0, padding: '16px 18px 4px' }}>Leads and random calls deleted by anyone are kept here for 30 days, with who deleted them. After 30 days they are no longer shown.</p>
          <div className="table-scroll">
            <table>
              <thead><tr><th>S.No.</th><th>Type</th><th>Name</th><th>Interested in</th>{showBranch && <th>Branch</th>}<th>Deleted by</th><th>Deleted on</th><th>Shown for</th><th>Actions</th></tr></thead>
              <tbody>
                {deleted.map((r, i) => (
                  <tr key={`${r.kind}-${r.id}`}>
                    <td>{i + 1}</td>
                    <td><span className={`status-badge ${r.kind === 'call' ? 'status-blue' : 'status-amber'}`}><span className="status-dot" />{r.kind === 'call' ? 'Random call' : 'Lead'}</span>{r.ref && <small>{r.ref}</small>}</td>
                    <td><div><strong>{r.name ?? '—'}</strong><span style={{ display: 'block' }}>{r.phone ?? ''}</span></div></td>
                    <td>{r.course ?? '—'}</td>
                    {showBranch && <td><strong className="id-text">{r.branch ?? '—'}</strong></td>}
                    <td><strong>{r.deletedBy ?? '—'}</strong></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtTime(r.deletedAt)}</td>
                    <td>{r.daysLeft} more day{r.daysLeft === 1 ? '' : 's'}</td>
                    <td><div className="row-actions">{canRestore[r.kind] && <button className="filter-button" disabled={pending} onClick={() => restore(r)} aria-label={`Restore ${r.name ?? 'record'}`}><RotateCcw size={13} /> Restore</button>}</div></td>
                  </tr>
                ))}
                {!deleted.length && <tr><td colSpan={showBranch ? 9 : 8} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>Nothing was deleted in the last 30 days.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="panel table-panel" style={tab === 'activity' ? undefined : { display: 'none' }}>
        <ListToolbar list={list} exportList={'logs'} placeholder="Search person, action or record…" dateLabel="When"
          filters={[
            ...(showBranch ? [{ key: 'branch', label: 'Branch', options: branches.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` })) }] : []),
            { key: 'entity', label: 'Area', options: filters.entities },
            { key: 'action', label: 'Action', options: filters.actions },
            { key: 'user', label: 'Person', options: filters.people },
          ]}
          sorts={[{ key: 'at', label: 'Newest first', dir: 'desc' }, { key: 'at', label: 'Oldest first', dir: 'asc' }]} />
        <div className="table-scroll">
          <table>
            <thead><tr><th>S.No.</th><SortTh list={list} k="at" first="desc">When</SortTh><th>Who</th>{showBranch && <th>Branch</th>}<th>What</th><th>Record</th><th>Details</th><th>IP</th></tr></thead>
            <tbody>
              {list.rows.map((r, i) => (
                <tr key={r.id}>
                  <td>{list.page * PAGE_SIZE + i + 1}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtTime(r.at)}</td>
                  <td><strong>{r.by ?? 'System'}</strong></td>
                  {showBranch && <td><strong className="id-text">{r.branch ?? '—'}</strong></td>}
                  <td><span className={`status-badge ${TONE[r.action] ?? 'status-slate'}`}><span className="status-dot" />{r.what}</span></td>
                  <td>{r.subject ?? '—'}</td>
                  <td style={{ maxWidth: 360, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{r.detail || '—'}</td>
                  <td>{r.ip ?? '—'}</td>
                </tr>
              ))}
              {!list.rows.length && !list.loading && <tr><td colSpan={showBranch ? 8 : 7} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>{list.filtered ? 'No log entries match these filters.' : 'No log entries yet.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={list.page} pages={list.pages} total={list.total} shown={list.rows.length} loading={list.loading} setPage={list.setPage} noun="log entries" />
      </div>
    </section>
  )
}
