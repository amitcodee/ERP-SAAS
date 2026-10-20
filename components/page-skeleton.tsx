// The shape of a panel page while its data loads: heading, the summary tiles, a toolbar and table rows.
// Shown by app/(panel)/loading.tsx (sent first by the server) and by the sidebar the moment a link is clicked.
export function PageSkeleton() {
  return (
    <section className="page-container sk-page" aria-busy="true" aria-label="Loading">
      <div className="page-heading">
        <div>
          <span className="sk sk-eyebrow" />
          <span className="sk sk-title" />
          <span className="sk sk-line" />
        </div>
        <span className="sk sk-button" />
      </div>
      <div className="table-summary sk-summary">
        {[0, 1, 2, 3].map((i) => <div key={i}><span className="sk sk-num" /><span className="sk sk-small" /></div>)}
      </div>
      <div className="panel sk-table">
        <div className="sk-toolbar">{[0, 1, 2, 3].map((i) => <span key={i} className="sk sk-chip" />)}</div>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="sk-row">
            <span className="sk" style={{ width: '14%' }} />
            <span className="sk" style={{ width: '20%' }} />
            <span className="sk" style={{ width: '18%' }} />
            <span className="sk" style={{ width: '10%' }} />
            <span className="sk sk-actions" />
          </div>
        ))}
      </div>
      <span className="sr-only" role="status">Loading…</span>
    </section>
  )
}
