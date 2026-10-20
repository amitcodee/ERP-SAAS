// Integrations: one card per outside service (what it does, whether it is on, how to switch it on), then the
// websites sending leads and the daily jobs. Read-only: shown in Settings → Integrations, where each service is set up.
import type { IntegrationsData } from '@/modules/reports/integrations'

const LABEL = { on: 'On', off: 'Off', warn: 'Needs attention' } as const
const TONE = { on: 'green', off: 'slate', warn: 'amber' } as const

export function IntegrationsPanel({ data: d, isSuper, embedded }: { data: IntegrationsData; isSuper: boolean; embedded?: boolean }) {
  const Wrap = ({ children }: { children: React.ReactNode }) => (embedded ? <div className="col-page">{children}</div> : <section className="page-container table-page col-page">{children}</section>)
  return (
    <Wrap>
      {!embedded && <div className="page-heading">
        <div>
          <p className="eyebrow">Reports / Integrations</p>
          <h1>Integrations</h1>
          <p className="subheading">The outside services the panel works with. Green is working, grey is switched off, amber needs a look. Each card says what the service does and how to switch it on.</p>
        </div>
      </div>}

      <div className="int-grid">
        {d.items.map((i) => (
          <div key={i.key} className="panel int-card">
            <div className="int-top">
              <h2>{i.name}</h2>
              <span className={`status-badge status-${TONE[i.state]}`}><span className="status-dot" />{LABEL[i.state]}</span>
            </div>
            <p className="int-what">{i.what}</p>
            <p className="int-status"><strong>Now:</strong> {i.status}</p>
            {i.facts.length > 0 && <dl className="int-facts">{i.facts.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>}
            {(i.state !== 'on' || isSuper) && <p className="int-setup"><strong>How to set up:</strong> {i.setup}</p>}
          </div>
        ))}
      </div>

      {d.sites.length > 0 && (
        <div className="panel table-panel">
          <div className="panel-header"><div><h2>Websites sending leads</h2><span>Each website that has sent a form, how many leads, how many still wait for a branch, and which branch owns it (set under Branches → website).</span></div></div>
          <div className="table-scroll"><table>
            <thead><tr><th>Website</th><th>Branch</th><th>Leads</th><th>Waiting</th><th>Last lead</th></tr></thead>
            <tbody>{d.sites.map((s) => (
              <tr key={s.host}>
                <td><strong>{s.host}</strong></td>
                <td>{s.branch ?? <span className="status-badge status-amber"><span className="status-dot" />No branch set</span>}</td>
                <td>{s.total.toLocaleString('en-IN')}</td>
                <td>{s.waiting ? <span className="status-badge status-amber"><span className="status-dot" />{s.waiting}</span> : 0}</td>
                <td>{s.last ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      {isSuper && !embedded && (
        <div className="panel table-panel">
          <div className="panel-header"><div><h2>Daily jobs — last run</h2><span>Jobs the server runs by itself every day. A failed or missing run is also shown on the dashboard.</span></div></div>
          {d.jobs.length ? (
            <div className="table-scroll"><table>
              <thead><tr><th>Job</th><th>Last run</th><th>Result</th></tr></thead>
              <tbody>{d.jobs.map((j) => (
                <tr key={j.job}><td><strong>{j.job}</strong></td><td>{j.when ?? '—'}</td>
                  <td>{j.ok === false ? <span className="status-badge status-red"><span className="status-dot" />Failed{j.error ? `: ${j.error}` : ''}</span> : j.ok ? <span className="status-badge status-green"><span className="status-dot" />OK</span> : <span className="status-badge status-amber"><span className="status-dot" />Running or not finished</span>}</td></tr>
              ))}</tbody>
            </table></div>
          ) : <p className="section-hint" style={{ margin: 0 }}>No job has run yet.</p>}
        </div>
      )}
    </Wrap>
  )
}
