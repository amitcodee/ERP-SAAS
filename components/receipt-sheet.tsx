import { BadgeCheck, ShieldCheck } from 'lucide-react'
import { PrintButton } from '@/components/print-button'
import { inr, rupeesInWords } from '@/lib/money'
import { paymentChannel } from '@/modules/fees/plan'
import type { ReceiptView } from '@/modules/fees/service'
import { BrandMark } from '@/components/brand-mark'
import type { Brand } from '@/lib/brand'

const NAVY = '#10186a', DEEP = '#0b1050', INDIGO = '#4a4af4', INK = '#0f1437', MUTED = '#6b7394', LINE = '#e3e6f3', RED = '#c81e1e'
// The watermark: "NON-REFUNDABLE" repeated slantwise over the whole slip, with one large one in the middle.
const TILE = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='250' height='120'><text x='125' y='66' text-anchor='middle' transform='rotate(-24 125 60)' font-family='Arial, sans-serif' font-size='13' font-weight='700' letter-spacing='3' fill='${RED}' fill-opacity='.075'>NON-REFUNDABLE</text></svg>`)}")`

export function ReceiptSheet({ r, qr, verifyUrl , brand }: { r: ReceiptView; qr: string; verifyUrl: string; brand: Brand }) {
  // An online payment gets an e-receipt (made by the system, valid without a signature); cash and cheques a receipt that is signed.
  const channel = paymentChannel(r.mode)
  const online = channel === 'online'
  const date = new Date(r.paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
  const paidUp = r.balanceAfter <= 0
  const row = (k: string, v: React.ReactNode) => <div><dt>{k}</dt><dd>{v}</dd></div>
  return (
    <main className="rc-page">
      <style>{`
        @page { size: A5 landscape; margin: 8mm }
        .rc-page { min-height: 100vh; padding: 20px 12px 40px; background: #e9ebf5; display: grid; justify-items: center; align-content: start; gap: 16px; }
        .rc { position: relative; width: min(194mm, 100%); border-radius: 14px; background: #fff; color: ${INK}; font-size: 12.5px; line-height: 1.35; box-shadow: 0 14px 44px #0b103026; overflow: hidden; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .rc-mark { position: absolute; inset: 0; z-index: 2; display: grid; place-items: center; background-image: ${TILE}; pointer-events: none; }
        .rc-mark span { transform: rotate(-24deg); padding: 4px 26px; border: 4px double ${RED}; border-radius: 12px; color: ${RED}; font-size: 54px; font-weight: 900; letter-spacing: .1em; white-space: nowrap; opacity: .085; }
        .rc-head { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 12px 26px; background: linear-gradient(115deg, ${DEEP}, ${NAVY} 55%, #2a2fb0); color: #fff; }
        .rc-head img { display: block; width: auto; height: 32px; filter: brightness(0) invert(1); }
        .rc-org { margin-top: 5px; font-size: 11px; line-height: 1.45; color: #ffffffc4; max-width: 330px; }
        .rc-org strong { display: block; color: #fff; font-size: 12.5px; }
        .rc-doc { text-align: right; white-space: nowrap; }
        .rc-doc h1 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: .09em; line-height: 1; }
        .rc-chip { display: inline-block; margin: 6px 0; padding: 3px 10px; border: 1px solid #ffffff55; border-radius: 99px; background: #ffffff1c; font-size: 9.5px; font-weight: 700; letter-spacing: .12em; }
        .rc-doc p { margin: 0; font-size: 11.5px; color: #ffffffc4; }
        .rc-doc p strong { color: #fff; font-size: 13px; letter-spacing: .03em; }
        .rc-rule { height: 4px; background: linear-gradient(90deg, #5cc8ff, ${INDIGO} 45%, #c9f74a); }
        .rc-body { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 0 26px; padding: 12px 26px 2px; }
        .rc-body h2 { margin: 0 0 6px; color: ${INDIGO}; font-size: 9.5px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
        .rc-body dl { margin: 0; }
        .rc-body dl div { display: flex; justify-content: space-between; align-items: baseline; gap: 14px; padding: 3.5px 0; border-bottom: 1px dashed ${LINE}; }
        .rc-body dt { flex: none; color: ${MUTED}; }
        .rc-body dd { margin: 0; min-width: 0; font-weight: 600; text-align: right; overflow-wrap: anywhere; }
        .rc-name { margin: 0 0 4px; font-size: 18px; font-weight: 800; letter-spacing: -.01em; line-height: 1.15; }
        .rc-bal dd { padding: 1px 9px; border-radius: 99px; font-weight: 800; }
        .rc-bal.ok dd { background: #e3f6ea; color: #0c7a3c; }
        .rc-bal.due dd { background: #fff4d6; color: #8a6100; }
        /* The amount is a stub of its own, torn off along a dotted line like a ticket */
        .rc-tear { position: relative; height: 18px; margin-top: 4px; }
        .rc-tear::before { content: ''; position: absolute; left: 20px; right: 20px; top: 50%; border-top: 2px dotted #c3c8e6; }
        .rc-tear i { position: absolute; top: 0; width: 18px; height: 18px; border-radius: 50%; background: #e9ebf5; box-shadow: inset 0 3px 6px #0b10301a; }
        .rc-tear i:first-child { left: -9px; } .rc-tear i:last-child { right: -9px; }
        .rc-pay { display: flex; align-items: center; gap: 20px; margin: 2px 26px 0; padding: 8px 16px 8px 18px; border: 1px solid ${LINE}; border-left: 5px solid ${NAVY}; border-radius: 12px; background: #f6f7fe; }
        .rc-pay > div:first-child { flex: 1; min-width: 0; }
        .rc-pay small { display: block; color: ${MUTED}; font-size: 9.5px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
        .rc-amt { color: ${NAVY}; font-size: 30px; font-weight: 800; letter-spacing: -.02em; line-height: 1.15; }
        .rc-words { font-size: 11.5px; font-style: italic; color: #2a3052; }
        .rc-paid { flex: none; display: flex; align-items: center; gap: 6px; padding: 6px 14px; border: 2px solid #12a150; border-radius: 8px; color: #0c7a3c; font-size: 15px; font-weight: 900; letter-spacing: .14em; transform: rotate(-6deg); }
        .rc-paid svg { width: 18px; height: 18px; }
        .rc-qr { flex: none; text-align: center; color: ${MUTED}; font-size: 8.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
        .rc-qr div { width: 62px; height: 62px; margin-bottom: 3px; padding: 4px; border: 1px solid ${LINE}; border-radius: 8px; background: #fff; }
        .rc-qr svg { display: block; width: 100%; height: 100%; }
        .rc-foot { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding: 12px 26px 10px; font-size: 11px; color: ${MUTED}; }
        .rc-foot strong { color: ${INK}; }
        .rc-sign { flex: none; width: 170px; padding-top: 5px; border-top: 1px solid ${INK}; color: ${INK}; text-align: center; font-weight: 600; }
        .rc-auto { flex: none; display: flex; align-items: center; gap: 8px; max-width: 290px; text-align: left; }
        .rc-auto svg { flex: none; width: 22px; height: 22px; color: ${INDIGO}; }
        .rc-terms { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 5px 26px; background: #fdecec; color: ${RED}; font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; text-align: center; }
        .rc-url { font-size: 11px; color: ${MUTED}; overflow-wrap: anywhere; text-align: center; }
        @media (max-width: 640px) { .rc-head, .rc-pay, .rc-foot { flex-wrap: wrap; } .rc-body { grid-template-columns: 1fr; gap: 14px; } .rc-doc { text-align: left; } .rc-mark span { font-size: 30px; } }
        /* a little smaller on paper, so that the slip stays on one A5 page when the address runs to two lines */
        @media print {
          html, body { background: #fff !important; }
          .rc-page { min-height: 0; padding: 0; background: #fff; display: block; }
          .no-print, .rc-url { display: none !important; }
          .rc { zoom: .94; width: 100%; box-shadow: none; border: 1px solid #b8bdd6; break-inside: avoid; }
          .rc-tear i { background: #fff; box-shadow: none; border: 1px solid #b8bdd6; }
        }
      `}</style>
      <PrintButton label={online ? 'Print e-slip' : 'Print receipt'} pdfHref={`/receipts/${encodeURIComponent(r.receiptNo)}/pdf`} />
      {r.reversal && (
        <div role="alert" style={{ width: 'min(194mm, 100%)', padding: '12px 18px', borderRadius: 12, background: '#ffe4ec', color: '#9f1239', fontSize: 13, lineHeight: 1.45 }}>
          <strong>{r.reversal.kind === 'refund' ? 'REFUNDED' : 'CANCELLED'}</strong> on {new Date(r.reversal.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })}: {r.reversal.reason}
          {r.reversal.kind === 'refund' && r.reversal.refundMode ? ` · given back by ${r.reversal.refundMode}${r.reversal.refundRef ? ` (${r.reversal.refundRef})` : ''}` : ''}. This receipt no longer counts as a payment.
        </div>
      )}
      <article className="rc">
        <header className="rc-head">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <BrandMark brand={brand} height={40} />
            <div className="rc-org">
              <strong>{r.branchName}</strong>
              {r.branchAddress}
              {(r.branchPhone || r.gstin) && <div>{[r.branchPhone && `Ph: ${r.branchPhone}`, r.gstin && `GSTIN: ${r.gstin}`].filter(Boolean).join('  ·  ')}</div>}
            </div>
          </div>
          <div className="rc-doc">
            <h1>{online ? 'E-RECEIPT' : 'FEE RECEIPT'}</h1>
            <span className="rc-chip">{online ? 'ONLINE PAYMENT' : channel === 'cheque' ? 'OFFLINE · CHEQUE / DRAFT' : 'OFFLINE · CASH'}</span>
            <p>Receipt no. <strong>{r.receiptNo}</strong></p>
            <p>Date <strong>{date}</strong></p>
          </div>
        </header>
        <div className="rc-rule" />

        <div className="rc-body">
          <section>
            <h2>Received from</h2>
            <p className="rc-name">{r.studentName}</p>
            <dl>
              {row('Registration ID', r.regNo)}
              {row('Course', r.course)}
              {row('Contact', r.phone)}
              {row('Mode of payment', r.mode)}
              {r.txnRef && row(online ? 'Transaction / UTR no.' : channel === 'cheque' ? 'Cheque / draft no.' : 'Slip no.', r.txnRef)}
            </dl>
          </section>
          <section>
            <h2>Fee summary</h2>
            <dl>
              {row('Total course fee', inr(r.charged))}
              {r.discounted > 0 && row('Discount', '− ' + inr(r.discounted))}
              {row('This payment', inr(r.amount))}
              {row('Paid till date', inr(r.paidToDate))}
              <div className={paidUp ? 'rc-bal ok' : 'rc-bal due'}><dt>Balance after this payment</dt><dd>{paidUp ? 'Nil · fully paid' : inr(r.balanceAfter)}</dd></div>
            </dl>
          </section>
        </div>

        <div className="rc-tear" aria-hidden><i /><i /></div>
        <div className="rc-pay">
          <div>
            <small>Amount received</small>
            <div className="rc-amt">{inr(r.amount)}</div>
            <div className="rc-words">{rupeesInWords(r.amount)}</div>
          </div>
          <div className="rc-paid"><BadgeCheck /> PAID</div>
          <div className="rc-qr"><div dangerouslySetInnerHTML={{ __html: qr }} />Scan to verify</div>
        </div>

        <footer className="rc-foot">
          <div>Received by: <strong>{r.receivedBy ?? '—'}</strong>{channel === 'cheque' && <><br />Subject to the cheque / draft being cleared.</>}</div>
          {online
            ? <div className="rc-auto"><ShieldCheck /><span>Computer-generated e-receipt for an online payment. Valid without a signature; scan the code to verify it.</span></div>
            : <div className="rc-sign">Authorised signatory</div>}
        </footer>
        <div className="rc-terms">Fees once paid are non-refundable and non-transferable</div>
        <div className="rc-mark" aria-hidden><span style={r.reversal ? { opacity: 0.3 } : undefined}>{r.reversal ? (r.reversal.kind === 'refund' ? 'REFUNDED' : 'CANCELLED') : 'NON-REFUNDABLE'}</span></div>
      </article>
      <div className="rc-url no-print">{verifyUrl}</div>
    </main>
  )
}
