'use client'

export function Pager({ page, pages, total, shown, loading, setPage, noun }: { page: number; pages: number; total: number; shown: number; loading: boolean; setPage: (p: number) => void; noun: string }) {
  const from = total === 0 ? 0 : page * 25 + 1
  return (
    <div className="pagination">
      <span>{loading ? 'Loading…' : <>Showing <strong>{from}–{from + shown - (shown ? 1 : 0)}</strong> of <strong>{total.toLocaleString('en-IN')}</strong> {noun}</>}</span>
      <div>
        <button className="page-btn" disabled={page === 0 || loading} onClick={() => setPage(page - 1)} aria-label="Previous page">‹</button>
        <span style={{ margin: '0 8px', fontSize: 11 }}>Page {page + 1} of {pages}</span>
        <button className="page-btn" disabled={page + 1 >= pages || loading} onClick={() => setPage(page + 1)} aria-label="Next page">›</button>
      </div>
    </div>
  )
}
