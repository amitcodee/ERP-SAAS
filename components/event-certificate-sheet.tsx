import { CERT_FONT_FACES, LayoutSheet } from '@/components/certificate-sheet'
import { PrintButton } from '@/components/print-button'
import type { CertOp } from '@/lib/cert-course'

// A certificate made from a design (Certificate Designs): the participant's own page (/e/c/<hash>) and the design's
// print preview. A4 in the design's direction, drawn from the same ops as its PDF.
export function DesignCertificateSheet({ ops, portrait, label, pdfHref, note }: { ops: CertOp[]; portrait: boolean; label: string; pdfHref?: string; note?: React.ReactNode }) {
  return (
    <main style={{ background: '#e5e7eb', minHeight: '100vh', padding: '20px 12px', display: 'grid', justifyItems: 'center', alignContent: 'start', gap: 16 }}>
      <style>{`
        @page { size: A4 ${portrait ? 'portrait' : 'landscape'}; margin: 0 }
        @media print { html, body { background: #fff !important } main { padding: 0 !important; background: #fff !important } .no-print { display: none !important } .sheet { box-shadow: none !important } }
        .sheet { position: relative; width: 297mm; height: 210mm; max-width: 100%; background: #fff; box-shadow: 0 10px 40px #0003; overflow: hidden; box-sizing: border-box }
        .sheet svg.art { position: absolute; inset: 0; width: 100%; height: 100% }
        ${CERT_FONT_FACES}
        .sheet svg.course text { font-kerning: none; text-rendering: geometricPrecision }
      `}</style>
      <div className="no-print" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
        <PrintButton pdfHref={pdfHref} />
      </div>
      <LayoutSheet ops={ops} revoked={false} label={label} portrait={portrait} />
      {note && <div className="no-print" style={{ fontSize: 12, color: '#6b7280', textAlign: 'center' }}>{note}</div>}
    </main>
  )
}
