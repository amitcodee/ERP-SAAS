import { PrintButton } from '@/components/print-button'
import { CERT_FONT_FAMILY, CERT_FONT_FILES, CERT_FONT_WEIGHT, certTextPath, qrPath, type CertFont, type CertOp } from '@/lib/cert-course'

// The institute's two certificates, A4 landscape, each drawn from its layout (the same one the PDF draws):
//   course  — Course Completion Certificate (lib/cert-course.ts), with the QR code that opens the public verification.
//   project — Project Completion Certificate (lib/cert-project.ts): the project the trainer approved.

export type CertData = {
  name: string; course: string; branch: string; certNo: string; issuedAt: string; revoked: boolean
  projectCertificate: boolean; department: string; joined: string; ended: string | null; durationWeeks: number | null; hours: number | null; modules: string[]; toolsLabel?: string
  signatures: { course: Signer[]; project: Signer[] }
}
export type CertKind = 'course' | 'project'
type Signer = { image: string | null; name: string | null; title: string }

const SERIF = '"Cambria", "Georgia", "Times New Roman", serif'
/** The certificate fonts for the page (used only where a text is written as text: a letter the fonts lack). */
export const CERT_FONT_FACES = (Object.keys(CERT_FONT_FILES) as CertFont[]).map((f) => `@font-face { font-family: ${CERT_FONT_FAMILY[f]}; font-weight: ${CERT_FONT_WEIGHT[f]}; src: url(/fonts/pdf/${CERT_FONT_FILES[f]}.ttf) format('truetype'); font-display: block }`).join(' ')

export function CertificateSheet({ v, hash, verifyUrl, kind, ops }: { v: CertData; hash: string; verifyUrl: string; kind: CertKind; ops: CertOp[] }) {
  const pdf = `/verify/${hash}/certificate/pdf${kind === 'project' ? '?kind=project' : ''}`
  return (
    <main style={{ background: '#e5e7eb', minHeight: '100vh', padding: '20px 12px', display: 'grid', justifyItems: 'center', gap: 16 }}>
      <style>{`
        @page { size: A4 landscape; margin: 0 }
        @media print { html, body { background: #fff !important } main { padding: 0 !important; background: #fff !important } .no-print { display: none !important } .sheet { box-shadow: none !important } }
        .sheet { position: relative; width: 297mm; height: 210mm; max-width: 100%; background: #fff; box-shadow: 0 10px 40px #0003; overflow: hidden; box-sizing: border-box; color: #2f3440; font-family: ${SERIF} }
        .sheet svg.art { position: absolute; inset: 0; width: 100%; height: 100% }
        ${CERT_FONT_FACES}
        .sheet svg.course text { font-family: CertPoppins, system-ui, sans-serif; font-kerning: none; text-rendering: geometricPrecision }
        .cert-tabs { display: flex; gap: 6px } .cert-tabs a { padding: 8px 14px; border-radius: 999px; background: #fff; color: #1f2a6b; font: 600 13px system-ui; text-decoration: none; border: 1px solid #c7cbe3 } .cert-tabs a.on { background: #1f2a6b; color: #fff }
      `}</style>
      <div className="no-print" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
        {v.projectCertificate && (
          <nav className="cert-tabs" aria-label="Certificate">
            <a href={`/verify/${hash}/certificate`} className={kind === 'course' ? 'on' : ''}>Course completion certificate</a>
            <a href={`/verify/${hash}/certificate?kind=project`} className={kind === 'project' ? 'on' : ''}>Project completion certificate</a>
          </nav>
        )}
        <PrintButton pdfHref={pdf} />
      </div>
      <LayoutSheet ops={ops} revoked={v.revoked} label={kind === 'project' ? 'Project completion certificate' : 'Course completion certificate'} />
      <div className="no-print" style={{ fontSize: 12, color: '#6b7280' }}>Verify: {verifyUrl}</div>
    </main>
  )
}

function Revoked() {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
      <div style={{ transform: 'rotate(-20deg)', fontSize: '38mm', fontWeight: 800, color: '#dc2626', opacity: 0.22, border: '2mm solid #dc2626', padding: '0 10mm', letterSpacing: '0.1em' }}>REVOKED</div>
    </div>
  )
}

/** A certificate layout's shapes, text and images as one SVG in mm (A4 landscape, or portrait). */
export function LayoutSheet({ ops, revoked, label, portrait }: { ops: CertOp[]; revoked: boolean; label: string; portrait?: boolean }) {
  return (
    <div className="sheet" style={portrait ? { width: '210mm', height: '297mm' } : undefined}>
      <svg className="art course" viewBox={portrait ? '0 0 210 297' : '0 0 297 210'} aria-label={label}>
        {ops.map((o, i) => {
          switch (o.k) {
            case 'path': return <path key={i} d={o.d} fill={o.fill ?? 'none'} stroke={o.stroke} strokeWidth={o.sw} opacity={o.opacity} strokeLinecap={o.round ? 'round' : undefined} strokeLinejoin={o.round ? 'round' : undefined} />
            // text as letter outlines (the same in every browser); as text only when the font lacks a letter
            case 'text': { const d = certTextPath(o); return d ? <path key={i} d={d} fill={o.fill} /> : <text key={i} x={o.x} y={o.y} fontSize={o.size} style={{ fontFamily: CERT_FONT_FAMILY[o.font] }} fontWeight={CERT_FONT_WEIGHT[o.font]} fill={o.fill} letterSpacing={o.track ? o.track * o.size : undefined} xmlSpace="preserve">{o.s}</text> }
            case 'glyph': { const d = certTextPath(o); if (d) return <path key={i} d={d} fill={o.fill} /> }
              return <text key={i} x={-o.w / 2} y={o.size * 0.35} transform={`translate(${o.x} ${o.y}) rotate(${o.rot})`} fontSize={o.size} style={{ fontFamily: CERT_FONT_FAMILY[o.font] }} fontWeight={CERT_FONT_WEIGHT[o.font]} fill={o.fill} xmlSpace="preserve">{o.ch}</text>
            case 'img': return <image key={i} href={o.src} x={o.x} y={o.y} width={o.w} height={o.h} preserveAspectRatio={o.stretch ? 'none' : o.left ? 'xMinYMax meet' : 'xMidYMax meet'} opacity={o.opacity} />
            case 'qr': return <path key={i} d={qrPath(o.text, o.x, o.y, o.size)} fill={o.fill} />
          }
        })}
      </svg>
      {revoked && <Revoked />}
    </div>
  )
}
