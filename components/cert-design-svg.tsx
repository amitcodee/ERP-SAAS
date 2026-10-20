'use client'
// A certificate design (lib/cert-design.ts) drawn in the browser: the canvas of the editor and the small previews of
// the design list. Text is set with the same rules the server uses (layoutText), measured here on a <canvas> in the
// same fonts, so what is on the canvas is what prints.
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { fillDesignText, layoutText, lineX, pageSize, shapePath, type Design, type DesignEl, type DesignFont } from '@/lib/cert-design'

const FILES: Record<DesignFont, string> = {
  light: 'Poppins-Light', regular: 'Poppins-Regular', medium: 'Poppins-Medium', semibold: 'Poppins-SemiBold', bold: 'Poppins-Bold', extrabold: 'Poppins-ExtraBold',
  serif: 'NotoSerif-Regular', script: 'GreatVibes-Regular',
}
/** Each font under its own family, so the canvas and the SVG pick exactly that file. */
export const designFamily = (f: DesignFont) => `CD-${f}`
export const DESIGN_FONT_CSS = (Object.keys(FILES) as DesignFont[]).map((f) => `@font-face { font-family: ${designFamily(f)}; src: url(/fonts/pdf/${FILES[f]}.ttf) format('truetype'); font-display: block }`).join('\n')

let fontsReady: Promise<void> | null = null
/** Resolves once every design font has loaded (measuring before would use a fallback font's widths). */
export function loadDesignFonts() {
  fontsReady ??= Promise.all((Object.keys(FILES) as DesignFont[]).map((f) => document.fonts.load(`40px ${designFamily(f)}`))).then(() => undefined).catch(() => undefined)
  return fontsReady
}
export function useDesignFonts() {
  const [ready, setReady] = useState(false)
  useEffect(() => { let live = true; loadDesignFonts().then(() => live && setReady(true)); return () => { live = false } }, [])
  return ready
}

let ctx: CanvasRenderingContext2D | null = null
const widths = new Map<string, number>()
/** Width in mm of s at size mm with extra letter spacing track (em), with no kerning (as the PDF draws it). */
export function measure(s: string, font: DesignFont, size: number, track = 0) {
  const key = `${font}|${s}`
  let em = widths.get(key)
  if (em === undefined) {
    ctx ??= document.createElement('canvas').getContext('2d')
    if (!ctx) return s.length * size * 0.55
    ctx.font = `100px ${designFamily(font)}`
    ;(ctx as CanvasRenderingContext2D & { fontKerning: string }).fontKerning = 'none'
    em = ctx.measureText(s).width / 100
    if (widths.size > 5000) widths.clear()
    widths.set(key, em)
  }
  return em * size + (s.length > 1 ? track * size * ([...s].length - 1) : 0)
}

const qrCache = new Map<string, string>()
/** The dark squares of a QR code as one path, x / y / size in mm. */
export function qrD(text: string, x: number, y: number, size: number) {
  const key = `${text}|${x}|${y}|${size}`
  if (!qrCache.has(key)) {
    const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
    const n = qr.modules.size, c = size / n
    let d = ''
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.modules.get(r, col)) d += `M${(x + col * c).toFixed(3)},${(y + r * c).toFixed(3)}h${(c + 0.02).toFixed(3)}v${(c + 0.02).toFixed(3)}h${(-c - 0.02).toFixed(3)}Z`
    qrCache.set(key, d)
  }
  return qrCache.get(key)!
}

/** One element's drawing (no selection, no events). */
export function ElDrawing({ e, values }: { e: DesignEl; values: Record<string, string> | null }) {
  const op = e.opacity !== undefined && e.opacity < 1 ? e.opacity : undefined
  switch (e.t) {
    case 'rect': case 'ellipse': case 'poly': {
      const d = shapePath(e)
      return <path d={d} fill={e.fill ?? 'none'} stroke={e.stroke ?? undefined} strokeWidth={e.stroke ? e.sw : undefined} opacity={op} />
    }
    case 'line': return <line x1={e.x} y1={e.y} x2={e.x + e.w} y2={e.y + e.h} stroke={e.stroke} strokeWidth={e.sw} strokeLinecap="round" strokeDasharray={e.dash ? `${Math.max(1, e.sw * 4)} ${Math.max(1, e.sw * 4) * 0.8}` : undefined} opacity={op} />
    case 'image': return <image href={e.src} x={e.x} y={e.y} width={Math.max(0.1, e.w)} height={Math.max(0.1, e.h)} preserveAspectRatio={e.stretch ? 'none' : 'xMidYMax meet'} opacity={op} />
    case 'qr': { const s = Math.min(e.w, e.h); return <path d={qrD('https://techcadd.com/e/c/sample-certificate', e.x, e.y, s)} fill={e.color} /> }
    case 'text': {
      const content = values ? fillDesignText(e.text, values).trim() : e.text
      if (!content) return null
      const track = e.track ?? 0
      const t = layoutText(e, content, (s, size) => measure(s, e.font, size, track))
      return (
        <g fill={e.color} style={{ fontFamily: designFamily(e.font), fontKerning: 'none' }} opacity={op}>
          {t.lines.map((l, i) => l && <text key={i} x={lineX(e, measure(l, e.font, t.size, track))} y={e.y + i * t.lead} fontSize={t.size} letterSpacing={track ? track * t.size : undefined} xmlSpace="preserve">{l}</text>)}
        </g>
      )
    }
  }
}

/** A whole design as an SVG (values: fills {{fields}}; null shows them as typed). */
export function DesignSvg({ design, values, className, style }: { design: Design; values: Record<string, string> | null; className?: string; style?: React.CSSProperties }) {
  const ready = useDesignFonts()
  const { W, H } = pageSize(design)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} style={style} role="img" aria-label="Certificate design">
      <defs><style>{DESIGN_FONT_CSS}</style></defs>
      <rect x={0} y={0} width={W} height={H} fill={design.bg} />
      {ready && design.els.map((e) => <ElDrawing key={e.id} e={e} values={values} />)}
    </svg>
  )
}
