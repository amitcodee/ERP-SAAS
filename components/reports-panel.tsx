'use client'

import type { NotificationLog } from '@/modules/notifications/service'
import type { Reports } from '@/modules/reports/service'

const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN')
const LABEL: Record<string, string> = { upcoming: 'Not yet due', '0-15': '1–15 days overdue', '16-30': '16–30 days overdue', '30+': 'Over 30 days overdue' }

export function ReportsPanel({ data, showBranches, log }: { data: Reports | null; showBranches: boolean; log: NotificationLog | null }) {
  if (!data) return <section className="page-container"><div className="panel" style={{ padding: 24 }}>Reports are available to managers, accountants and admins.</div></section>
  const f = data.funnel
  const rate = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')
  const overdueTotal = data.dues.filter((d) => d.bucket !== 'upcoming').reduce((n, d) => n + d.amount, 0)
  return (
    <section className="page-container table-page">
      <div className="page-heading"><div><p className="eyebrow">Reports / Reports</p><h1>Reports</h1><p className="subheading">Every figure is calculated live from the records — nothing is typed in.</p></div></div>

      <div className="table-summary">
        <div><strong>{f.enquiries}</strong><span>Enquiries</span></div>
        <div><strong className="text-blue">{f.demo}</strong><span>Reached demo</span></div>
        <div><strong className="text-green">{f.registered}</strong><span>Registered ({rate(f.registered, f.enquiries)})</span></div>
        <div><strong className="text-amber">{inr(overdueTotal)}</strong><span>Overdue fees</span></div>
      </div>

      <div className="panel table-panel" style={{ marginBottom: 16 }}>
        <div className="panel-header" style={{ padding: '16px 16px 0' }}><div><h2>Fee dues aging</h2><span>Scheduled installments not yet paid</span></div></div>
        <div className="table-scroll"><table><thead><tr><th>Bucket</th><th>Installments</th><th>Amount</th></tr></thead>
          <tbody>{data.dues.map((d) => <tr key={d.bucket}><td>{LABEL[d.bucket]}</td><td>{d.count}</td><td><strong className={d.bucket === 'upcoming' ? '' : d.amount ? 'text-amber' : ''}>{inr(d.amount)}</strong></td></tr>)}</tbody></table></div>
      </div>

      <div className="panel table-panel" style={{ marginBottom: 16 }}>
        <div className="panel-header" style={{ padding: '16px 16px 0' }}><div><h2>Lead sources</h2><span>Which channels bring students</span></div></div>
        <div className="table-scroll"><table><thead><tr><th>Source</th><th>Enquiries</th><th>Joined</th><th>Conversion</th></tr></thead>
          <tbody>{data.sources.map((s) => <tr key={s.source}><td>{s.source}</td><td>{s.enquiries}</td><td>{s.joined}</td><td>{rate(s.joined, s.enquiries)}</td></tr>)}
            {!data.sources.length && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: '#8b98aa' }}>No enquiries yet.</td></tr>}</tbody></table></div>
      </div>

      {log && (
        <div className="panel table-panel" style={{ marginBottom: 16 }}>
          <div className="panel-header" style={{ padding: '16px 16px 0' }}><div><h2>Fee reminders</h2><span>{log.counts.sent} sent · {log.counts.queued} waiting · {log.counts.failed} failed{log.counts.queued > 0 && log.counts.sent === 0 ? ' — no SMS/WhatsApp/email provider is connected yet, so messages wait in the queue' : ''}</span></div></div>
          <div className="table-scroll"><table><thead><tr><th>When</th><th>To</th><th>Message</th><th>Status</th></tr></thead>
            <tbody>{log.rows.map((n) => <tr key={n.id}><td>{new Date(n.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td><td>{n.to}<small>{n.channel}</small></td><td style={{ maxWidth: 420 }}>{n.body}</td><td><span className={`status-badge ${n.status === 'sent' ? 'status-green' : n.status === 'failed' ? 'status-red' : 'status-amber'}`}><span className="status-dot" />{n.status}</span></td></tr>)}
              {!log.rows.length && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: '#8b98aa' }}>No reminders yet. They are queued daily for installments that are about to fall due or are overdue.</td></tr>}</tbody></table></div>
        </div>
      )}

      {showBranches && (
        <div className="panel table-panel">
          <div className="panel-header" style={{ padding: '16px 16px 0' }}><div><h2>Branch summary</h2><span>Cross-branch comparison</span></div></div>
          <div className="table-scroll"><table><thead><tr><th>Branch</th><th>Enquiries</th><th>Registrations</th><th>Collected</th><th>Pending</th></tr></thead>
            <tbody>{data.branches.map((b) => <tr key={b.code}><td><strong className="id-text">{b.code}</strong> {b.name}</td><td>{b.enquiries}</td><td>{b.registrations}</td><td>{inr(b.collected)}</td><td>{inr(b.pending)}</td></tr>)}
              {!data.branches.length && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: '#8b98aa' }}>No branches yet.</td></tr>}</tbody></table></div>
        </div>
      )}
    </section>
  )
}
