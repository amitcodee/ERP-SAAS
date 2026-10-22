import Link from 'next/link'
import { requirePlatform } from '@/lib/platform/current'
import { ORG_STATUSES } from '@/lib/db/schema/tenancy'
import { listOrgs } from '@/modules/platform/service'
import { metrics } from '@/modules/platform/console'

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—')
const inr = (paise: number) => '₹' + Math.round(paise / 100).toLocaleString('en-IN')
const TONE: Record<string, string> = { pending: 'amber', active: 'green', trial: 'blue', past_due: 'amber', read_only: 'amber', suspended: 'red', cancelled: 'slate' }

// Every organisation, newest first: its status and plan and how big it is (sizes only, never a record).
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  await requirePlatform()
  const { q = '', status = '' } = await searchParams
  const [orgs, m, waiting] = await Promise.all([listOrgs({ q, status }), metrics(), listOrgs({ q: '', status: 'pending' })])
  return (
    <section className="page-container">
      <div className="page-heading"><div><p className="eyebrow">Platform</p><h1>Organisations</h1><p className="subheading">{orgs.length} shown. Open one to change its status or start a support session.</p></div></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
        {[
          ['MRR (before GST)', inr(m.mrr), `${m.paying} paying`],
          ['On trial', String(m.byStatus.trial ?? 0), `${m.trialsEnding7} ending this week`],
          ['Sign-ups, 30 days', String(m.signups30), ''],
          ['Trial to paid, 90 days', m.conversion90.started ? `${Math.round((m.conversion90.paid / m.conversion90.started) * 100)}%` : '—', `${m.conversion90.paid} of ${m.conversion90.started}`],
          ['Overdue or read-only', String((m.byStatus.past_due ?? 0) + (m.byStatus.read_only ?? 0)), `${m.byStatus.suspended ?? 0} suspended`],
          ['Lost, 30 days', String(m.churn30), 'suspended or cancelled'],
        ].map(([label, value, sub]) => <div key={label} className="panel"><small style={{ color: '#64748b' }}>{label}</small><div style={{ fontSize: 24, fontWeight: 800 }}>{value}</div>{sub && <small style={{ color: '#64748b' }}>{sub}</small>}</div>)}
      </div>
      {waiting.length > 0 && (
        <div className="panel" style={{ marginBottom: 16, borderLeft: '4px solid #d97706' }}>
          <strong>Waiting for your approval ({waiting.length})</strong>
          <p className="section-hint" style={{ margin: '4px 0 8px' }}>New institutes do not run until you approve them (Settings). Open one to approve it, or to reject it.</p>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>{waiting.map((o) => <li key={o.id}><Link href={`/orgs/${o.id}`}><strong>{o.name}</strong></Link> <small>({o.slug}, signed up {day(o.createdAt)}, {o.branches} branch{o.branches === 1 ? '' : 'es'}, {o.users} login{o.users === 1 ? '' : 's'})</small></li>)}</ul>
        </div>
      )}
      {m.jobFailures.length > 0 && (
        <div className="panel" style={{ marginBottom: 16, borderLeft: '4px solid #dc2626' }}>
          <strong>Daily jobs failing (last 7 days)</strong>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>{m.jobFailures.map((j) => <li key={`${j.org}-${j.job}`}>{j.org}: {j.job}, {j.failed} of {j.runs} failed{j.lastError ? ` (${j.lastError.slice(0, 120)})` : ''}</li>)}</ul>
        </div>
      )}
      <form className="panel" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <input name="q" defaultValue={q} placeholder="Name or web address" aria-label="Search" style={{ flex: '1 1 220px' }} />
        <select name="status" defaultValue={status} aria-label="Status"><option value="">Every status</option>{ORG_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
        <button className="button secondary">Search</button>
      </form>
      <div className="panel table-scroll">
        <table>
          <thead><tr><th>Organisation</th><th>Status</th><th>Plan</th><th>Branches</th><th>Logins</th><th>Active students</th><th>Receipts (30 days)</th><th>Last sign-in</th><th>Created</th><th /></tr></thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id}>
                <td><strong>{o.name}</strong><small>{o.slug}</small></td>
                <td><span className={`status-badge status-${TONE[o.status] ?? 'slate'}`}><span className="status-dot" />{o.status.replace('_', ' ')}</span>{o.supportOpen && <small>support session open</small>}{o.status === 'trial' && o.trialEndsAt && <small>until {day(o.trialEndsAt)}</small>}</td>
                <td>{o.plan}</td><td>{o.branches}</td><td>{o.users}</td><td>{o.activeStudents}</td><td>{o.receipts30d}</td><td>{day(o.lastSignIn)}</td><td>{day(o.createdAt)}</td>
                <td><Link className="filter-button" href={`/orgs/${o.id}`}>Open</Link></td>
              </tr>
            ))}
            {!orgs.length && <tr><td colSpan={10} style={{ textAlign: 'center', padding: 20, color: '#8b98aa' }}>No organisation matches.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}
