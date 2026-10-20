'use client'

export function PrintButton({ label = 'Print / Save as PDF', pdfHref }: { label?: string; pdfHref?: string }) {
  return (
    <div className="no-print" style={{ display: 'flex', gap: 10 }}>
    <button
      onClick={() => window.print()}
      className="no-print"
      style={{ padding: '10px 18px', borderRadius: 8, border: 0, background: '#1d4ed8', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}
    >
      {label}
    </button>
    {pdfHref && <a href={pdfHref} style={{ padding: '10px 18px', borderRadius: 8, background: '#fff', color: '#1d4ed8', border: '1px solid #1d4ed8', fontWeight: 600, fontSize: 14, textDecoration: 'none' }}>Download PDF</a>}
    </div>
  )
}
