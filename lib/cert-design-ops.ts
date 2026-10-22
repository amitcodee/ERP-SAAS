import 'server-only'
// A design made on the canvas (lib/cert-design.ts) and one participant's details, as the layout ops the certificate
// page draws as SVG and lib/pdf.ts draws into the PDF (the same ops the course certificate uses), so both match.
import { certWidth, type CertOp } from '@/lib/cert-course'
import { BRAND_LOGO, fillDesignText, layoutText, lineX, pageSize, shapePath, type Design } from '@/lib/cert-design'

/** A dashed line as its dashes. */
function dashed(x1: number, y1: number, x2: number, y2: number, sw: number) {
  const len = Math.hypot(x2 - x1, y2 - y1), dash = Math.max(1, sw * 4), step = dash * 1.8
  if (!len) return ''
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len
  let d = ''
  for (let t = 0; t < len; t += step) { const e = Math.min(len, t + dash); d += `M${x1 + ux * t},${y1 + uy * t} L${x1 + ux * e},${y1 + uy * e} ` }
  return d
}

/** The design's ops for these details; qr: what the QR codes open (the certificate's own page); brand: the institute
 * whose certificate it is (its name fills {{institute}}, its logo BRAND_LOGO; without one that image is left out). */
/** images: what the SIGN_* images stand for (course certificates: the signatures of Settings → Certificates). */
export function designOps(design: Design, values: Record<string, string>, qr: string, brand: { name: string; logo: string | null }, images: Record<string, string | null> = {}): CertOp[] {
  values = { ...values, institute: brand.name }
  const { W, H } = pageSize(design)
  const ops: CertOp[] = [{ k: 'path', d: `M0,0 H${W} V${H} H0 Z`, fill: design.bg || '#ffffff' }]
  for (const e of design.els) {
    const opacity = e.opacity !== undefined && e.opacity < 1 ? e.opacity : undefined
    if (e.t === 'rect' || e.t === 'ellipse' || e.t === 'poly') {
      if (opacity === 0 || (!e.fill && !e.stroke)) continue
      const d = shapePath(e)
      if (e.fill) ops.push({ k: 'path', d, fill: e.fill, opacity })
      if (e.stroke && e.sw) ops.push({ k: 'path', d, stroke: e.stroke, sw: e.sw, opacity })
    } else if (e.t === 'line') {
      ops.push({ k: 'path', d: e.dash ? dashed(e.x, e.y, e.x + e.w, e.y + e.h, e.sw) : `M${e.x},${e.y} L${e.x + e.w},${e.y + e.h}`, stroke: e.stroke, sw: e.sw, opacity, round: true })
    } else if (e.t === 'image') {
      const src = e.src === BRAND_LOGO ? brand.logo : e.src.startsWith('sign:') ? images[e.src] ?? null : e.src
      if (!src) continue
      ops.push({ k: 'img', x: e.x, y: e.y, w: e.w, h: e.h, src, ...(e.stretch ? { stretch: true } : {}), ...(opacity !== undefined ? { opacity } : {}) })
    } else if (e.t === 'qr') {
      ops.push({ k: 'qr', x: e.x, y: e.y, size: Math.min(e.w, e.h), text: qr, fill: e.color })
    } else {
      const track = e.track ?? 0
      const content = fillDesignText(e.text, values).trim()
      if (!content) continue
      const t = layoutText(e, content, (s, size) => certWidth(s, e.font, size, track))
      t.lines.forEach((l, i) => {
        if (!l) return
        ops.push({ k: 'text', x: lineX(e, certWidth(l, e.font, t.size, track)), y: e.y + i * t.lead, s: l, font: e.font, size: t.size, fill: e.color, ...(track ? { track } : {}) })
      })
    }
  }
  return ops
}
