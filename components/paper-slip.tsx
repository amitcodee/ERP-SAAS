import { PrintButton } from '@/components/print-button'
import { inr } from '@/lib/money'
import type { ReceiptView } from '@/modules/fees/service'

/**
 * A payment for which a paper slip was given at the desk: the slip is shown exactly as it was uploaded, under its
 * slip ID. No e-receipt is made from it.
 */
export function PaperSlip({ r }: { r: ReceiptView }) {
  const date = new Date(r.paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
  const file = (id: string) => `/receipts/${encodeURIComponent(r.receiptNo)}/slip/${id}`
  return (
    <main className="ps-page">
      <style>{`
        .ps-page { min-height: 100vh; padding: 24px 12px 48px; background: #e9ebf5; display: grid; justify-items: center; align-content: start; gap: 16px; font-family: Inter, 'Segoe UI', Arial, sans-serif; color: #141a33; }
        .ps-card { width: min(820px, 100%); background: #fff; border-radius: 16px; box-shadow: 0 6px 24px #0b103022; overflow: hidden; }
        .ps-head { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding: 18px 22px; border-bottom: 1px solid #e3e6f2; }
        .ps-head small { display: block; color: #6b7394; font-size: 12px; font-weight: 600; letter-spacing: .06em; }
        .ps-head strong { font-size: 20px; }
        .ps-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px 18px; padding: 16px 22px; border-bottom: 1px solid #e3e6f2; margin: 0; }
        .ps-meta dt { color: #6b7394; font-size: 11.5px; font-weight: 600; }
        .ps-meta dd { margin: 3px 0 0; font-size: 13.5px; font-weight: 600; }
        .ps-file { padding: 18px 22px; display: grid; gap: 14px; justify-items: center; }
        .ps-file img { max-width: 100%; border: 1px solid #e3e6f2; border-radius: 10px; }
        .ps-file a.pdf { padding: 12px 18px; border: 1px solid #1c2f8f; border-radius: 10px; color: #1c2f8f; font-weight: 600; text-decoration: none; }
        .ps-note { margin: 0; color: #6b7394; font-size: 12.5px; text-align: center; max-width: 620px; }
        @media print { html, body { background: #fff !important; } .ps-page { padding: 0; background: #fff; } .no-print, .ps-note { display: none !important; } .ps-card { box-shadow: none; border-radius: 0; width: 100%; } }
      `}</style>
      <PrintButton label="Print the slip" />
      <article className="ps-card">
        <header className="ps-head">
          <div><small>PAPER SLIP (OFFLINE)</small><strong>Slip ID {r.receiptNo}</strong></div>
          <div style={{ textAlign: 'right' }}><small>{r.branchName.toUpperCase()}</small><strong>{inr(r.amount)}</strong></div>
        </header>
        <dl className="ps-meta">
          <div><dt>Received from</dt><dd>{r.studentName}</dd></div>
          <div><dt>Registration ID</dt><dd>{r.regNo}</dd></div>
          <div><dt>Date</dt><dd>{date}</dd></div>
          <div><dt>Mode of payment</dt><dd>{r.mode}{r.txnRef ? ` (${r.txnRef})` : ''}</dd></div>
          <div><dt>Received by</dt><dd>{r.receivedBy ?? '—'}</dd></div>
        </dl>
        <div className="ps-file">
          {r.slips.map((s, i) => (s.mime === 'application/pdf'
            ? <a key={s.id} className="pdf" href={file(s.id)}>Download the slip (PDF): {s.fileName}</a>
            // eslint-disable-next-line @next/next/no-img-element
            : <img key={s.id} src={file(s.id)} alt={`Paper slip ${i + 1}`} />))}
          {!r.slips.length && <p className="ps-note">The picture of this slip is not on record.</p>}
        </div>
      </article>
      <p className="ps-note">This is the paper slip given at the desk, kept as it was uploaded. Fees once paid are non-refundable and non-transferable.</p>
    </main>
  )
}
