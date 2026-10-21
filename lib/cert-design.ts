// Certificate designs made on the canvas (Certificate Designs page): what a design is, the details it can print
// ({{name}}, {{event}}…), the shapes' outlines and the ready-made templates to start from. Shared by the editor (in the
// browser) and the server, which turns a design and a participant into the same layout ops the course certificate
// uses (lib/cert-design-ops.ts), so the page and the PDF match. Sizes are in mm, y from the top; A4 landscape is
// 297 x 210 and portrait 210 x 297. A text's y is its first line's baseline.
import type { CertFont } from './cert-course'

export type DesignFont = CertFont
export type Align = 'left' | 'center' | 'right'
type Box = { id: string; x: number; y: number; w: number; h: number; opacity?: number; locked?: boolean }
type Paint = { fill?: string | null; stroke?: string | null; sw?: number }
export type DesignEl =
  | (Box & { t: 'text'; text: string; font: DesignFont; size: number; color: string; align: Align; track?: number; lineHeight?: number; upper?: boolean })
  | (Box & Paint & { t: 'rect'; r?: number; rot?: number })
  | (Box & Paint & { t: 'ellipse' })
  | (Box & Paint & { t: 'poly'; sides: number; r?: number; rot?: number }) // a regular polygon in its box: 3 a triangle, 6 a hexagon
  | (Box & { t: 'line'; stroke: string; sw: number; dash?: boolean }) // from (x, y) to (x + w, y + h)
  | (Box & { t: 'image'; src: string; stretch?: boolean }) // src: a data: URL (PNG / JPEG), a file of the panel, or BRAND_LOGO
  | (Box & { t: 'qr'; color: string }) // the code that opens the certificate's own page

export type Design = { page: 'landscape' | 'portrait'; bg: string; els: DesignEl[] }
/** An image's src that stands for the institute's logo (Set Up), drawn as it is when the certificate is made. */
export const BRAND_LOGO = 'brand:logo'
export const pageSize = (d: Pick<Design, 'page'>) => (d.page === 'portrait' ? { W: 210, H: 297 } : { W: 297, H: 210 })

/** What a design can print, filled for each participant. */
export const DESIGN_FIELDS = {
  name: { label: 'Participant name', sample: 'Aman Gill' },
  institute: { label: 'Institute name', sample: 'Your institute' },
  event: { label: 'Event title', sample: 'Hands-on Workshop on Generative AI' },
  kind: { label: 'Event type (Seminar, Workshop…)', sample: 'Workshop' },
  date: { label: 'Event date', sample: '19 Oct 2026' },
  venue: { label: 'Venue', sample: 'Jalandhar branch, Hall 2' },
  speaker: { label: 'Speaker / trainer', sample: 'Er. Rohit Sharma' },
  organisation: { label: 'Participant’s college / company', sample: 'DAV College, Jalandhar' },
  score: { label: 'Quiz score (8 / 10)', sample: '8 / 10' },
  percent: { label: 'Quiz score in % (80%)', sample: '80%' },
  cert_no: { label: 'Certificate number', sample: 'EV-26-000123' },
  issued: { label: 'Date issued', sample: '20 Oct 2026' },
  branch: { label: 'Branch', sample: 'Jalandhar' },
} as const
export type DesignField = keyof typeof DESIGN_FIELDS
export const SAMPLE_VALUES = Object.fromEntries(Object.entries(DESIGN_FIELDS).map(([k, v]) => [k, v.sample])) as Record<DesignField, string>
const FIELD = /\{\{\s*(\w+)\s*\}\}/g
/**
 * Fills {{field}} with the values; an unknown {{…}} is left as it is (so a typo shows on the preview). Words in
 * [square brackets] are left out when a detail inside them is empty: "held on {{date}}[ at {{venue}}]".
 */
export const fillDesignText = (s: string, v: Partial<Record<string, string>>) =>
  s.replace(/\[([^\[\]]*)\]/g, (_m, part: string) => ([...part.matchAll(FIELD)].some((x) => x[1] in v && !v[x[1]]?.trim()) ? '' : part))
    .replace(FIELD, (m, k: string) => v[k] ?? m)

export const FONT_LABEL: Record<DesignFont, string> = {
  light: 'Poppins Light', regular: 'Poppins', medium: 'Poppins Medium', semibold: 'Poppins SemiBold', bold: 'Poppins Bold', extrabold: 'Poppins ExtraBold',
  serif: 'Serif (Noto Serif)', script: 'Script (Great Vibes)',
}
export const FONT_KEYS = Object.keys(FONT_LABEL) as DesignFont[]

/** Words wrapped to lines no wider than max (lines the user broke stay broken), measured by `width`. */
export function wrapText(s: string, max: number, width: (s: string) => number): string[] {
  const out: string[] = []
  for (const para of s.split('\n')) {
    let cur = ''
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const t = cur ? `${cur} ${w}` : w
      if (cur && width(t) > max) { out.push(cur); cur = w } else cur = t
    }
    out.push(cur)
  }
  return out
}

/**
 * How a text element sets its words: a one-line box (h under 1.6 lines) shrinks the text to fit its width, down to
 * half size; a taller box wraps it and shrinks only when the lines would not fit its height. `width(s, size)` measures.
 */
export function layoutText(e: Extract<DesignEl, { t: 'text' }>, content: string, width: (s: string, size: number) => number): { size: number; lines: string[]; lead: number } {
  const lh = e.lineHeight ?? 1.25
  const s = e.upper ? content.toUpperCase() : content
  let size = e.size
  if (e.h < e.size * lh * 1.6 && !s.includes('\n')) {
    while (size > e.size / 2 && width(s, size) > e.w) size = Math.max(e.size / 2, size - e.size / 40)
    return { size, lines: [s], lead: size * lh }
  }
  let lines = wrapText(s, e.w, (t) => width(t, size))
  while (size > e.size / 2 && lines.length > 1 && (lines.length - 1) * size * lh + size > e.h + e.size * 0.3) {
    size = Math.max(e.size / 2, size - e.size / 40)
    lines = wrapText(s, e.w, (t) => width(t, size))
  }
  return { size, lines, lead: size * lh }
}
/** Where a line starts, for its alignment in the box. */
export const lineX = (e: { x: number; w: number; align: Align }, lineWidth: number) => (e.align === 'center' ? e.x + (e.w - lineWidth) / 2 : e.align === 'right' ? e.x + e.w - lineWidth : e.x)

// ---- outlines ----------------------------------------------------------------------------------------------------
const f = (n: number) => +n.toFixed(3)
/** A closed outline through the points, each corner rounded by r (0: sharp). */
function roundedPath(pts: [number, number][], r: number) {
  if (!r) return `M${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' L')} Z`
  const n = pts.length
  let d = ''
  for (let i = 0; i < n; i++) {
    const [px, py] = pts[(i - 1 + n) % n], [x, y] = pts[i], [nx, ny] = pts[(i + 1) % n]
    const l1 = Math.hypot(px - x, py - y), l2 = Math.hypot(nx - x, ny - y), k = Math.min(r, l1 / 2, l2 / 2)
    const a = [x + ((px - x) / l1) * k, y + ((py - y) / l1) * k], b = [x + ((nx - x) / l2) * k, y + ((ny - y) / l2) * k]
    d += `${i ? 'L' : 'M'}${f(a[0])},${f(a[1])} Q${f(x)},${f(y)} ${f(b[0])},${f(b[1])} `
  }
  return d + 'Z'
}
const turn = (pts: [number, number][], cx: number, cy: number, deg: number): [number, number][] => {
  if (!deg) return pts
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r)
  return pts.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c])
}
/** The outline of a shape element, in mm. */
export function shapePath(e: Extract<DesignEl, { t: 'rect' | 'ellipse' | 'poly' }>): string {
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2
  if (e.t === 'ellipse') {
    const rx = e.w / 2, ry = e.h / 2
    return `M${f(cx - rx)},${f(cy)} a${f(rx)},${f(ry)} 0 1,0 ${f(2 * rx)},0 a${f(rx)},${f(ry)} 0 1,0 ${f(-2 * rx)},0 Z`
  }
  if (e.t === 'rect') return roundedPath(turn([[e.x, e.y], [e.x + e.w, e.y], [e.x + e.w, e.y + e.h], [e.x, e.y + e.h]], cx, cy, e.rot ?? 0), e.r ?? 0)
  // a regular polygon stretched to its box; a triangle points up, a hexagon has its points left and right
  const n = Math.max(3, Math.min(12, Math.round(e.sides)))
  const start = n === 3 ? -90 : n % 2 ? -90 : 0
  const pts: [number, number][] = Array.from({ length: n }, (_, i) => { const a = ((start + (360 / n) * i) * Math.PI) / 180; return [Math.cos(a), Math.sin(a)] })
  const [x0, x1] = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))], [y0, y1] = [Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))]
  const fitted = pts.map(([x, y]): [number, number] => [e.x + ((x - x0) / (x1 - x0)) * e.w, e.y + ((y - y0) / (y1 - y0)) * e.h])
  return roundedPath(turn(fitted, cx, cy, e.rot ?? 0), e.r ?? 0)
}

// ---- the ready-made templates -------------------------------------------------------------------------------------
let seq = 0
const id = () => `e${(++seq).toString(36)}`
const T = (x: number, y: number, w: number, text: string, font: DesignFont, size: number, color: string, align: Align = 'center', more: Partial<Extract<DesignEl, { t: 'text' }>> = {}): DesignEl =>
  ({ id: id(), t: 'text', x, y, w, h: size, text, font, size, color, align, ...more })
const P = (x: number, y: number, w: number, h: number, sides: number, paint: Paint & { r?: number; rot?: number; opacity?: number }): DesignEl => ({ id: id(), t: 'poly', x, y, w, h, sides, ...paint })
const R = (x: number, y: number, w: number, h: number, paint: Paint & { r?: number; rot?: number; opacity?: number }): DesignEl => ({ id: id(), t: 'rect', x, y, w, h, ...paint })
const E = (x: number, y: number, w: number, h: number, paint: Paint & { opacity?: number }): DesignEl => ({ id: id(), t: 'ellipse', x, y, w, h, ...paint })
const L = (x: number, y: number, w: number, h: number, stroke: string, sw: number, dash?: boolean): DesignEl => ({ id: id(), t: 'line', x, y, w, h, stroke, sw, ...(dash ? { dash } : {}) })
const LOGO = (x: number, y: number, w: number): DesignEl => ({ id: id(), t: 'image', x, y, w, h: w / (952 / 262), src: BRAND_LOGO })
const QR = (x: number, y: number, s: number, color = '#111827'): DesignEl => ({ id: id(), t: 'qr', x, y, w: s, h: s, color })
const BODY = 'For taking part in the {{kind}} “{{event}}” held on {{date}}[ at {{venue}}][, conducted by {{speaker}}].'

/** A seal: a gold disc with a ring, two ribbon tails and CERTIFIED. */
const seal = (cx: number, cy: number, r: number, gold = '#c9a227', dark = '#8a6d12'): DesignEl[] => [
  P(cx - r * 0.75, cy + r * 0.2, r * 0.6, r * 1.5, 4, { fill: dark, rot: 18 }),
  P(cx + r * 0.15, cy + r * 0.2, r * 0.6, r * 1.5, 4, { fill: dark, rot: -18 }),
  P(cx - r, cy - r, r * 2, r * 2, 12, { fill: gold, r: r * 0.08 }),
  E(cx - r * 0.78, cy - r * 0.78, r * 1.56, r * 1.56, { stroke: '#fff7d6', sw: 0.5 }),
  T(cx - r, cy - r * 0.02, r * 2, 'CERTIFIED', 'bold', r * 0.25, '#ffffff', 'center', { track: 0.04 }),
  T(cx - r, cy + r * 0.36, r * 2, '{{institute}}', 'semibold', r * 0.2, '#fff7d6', 'center', { track: 0.1 }),
]

export type Preset = { key: string; name: string; about: string; make: () => Design }
export const PRESETS: Preset[] = [
  {
    key: 'hexagon', name: 'Hexagon — teal & navy', about: 'White page with navy, teal and grey hexagons, your logo; the name in handwriting.',
    make: () => {
      const NAVY = '#0b4a73', TEAL = '#21c1bd', GREY = '#e6e9ed', INK = '#123d5c'
      return {
        page: 'landscape', bg: '#ffffff', els: [
          P(30, -10, 30, 24, 3, { fill: GREY, r: 3, rot: 180 }),
          P(-48, 22, 100, 95, 6, { fill: NAVY, r: 8 }),
          P(58, 23, 42, 36, 6, { stroke: TEAL, sw: 2.2, r: 4 }),
          P(30, 74, 72, 64, 6, { fill: GREY, r: 6, opacity: 0.9 }),
          P(-42, 128, 104, 94, 6, { fill: TEAL, r: 8 }),
          P(258, 18, 60, 50, 6, { stroke: GREY, sw: 1.4, r: 5 }),
          P(220, 55, 64, 56, 6, { fill: GREY, r: 6, opacity: 0.9 }),
          P(256, 102, 80, 72, 6, { stroke: NAVY, sw: 2.4, r: 7 }),
          P(226, 176, 66, 56, 6, { fill: TEAL, r: 6 }),
          P(129, 172, 40, 46, 3, { stroke: NAVY, sw: 1.6, r: 3 }),
          ...seal(262, 23, 11),
          LOGO(124.5, 7, 48),
          T(48.5, 42, 200, 'CERTIFICATE', 'extrabold', 17, INK, 'center', { track: 0.04 }),
          T(48.5, 56, 200, 'Of {{kind}}', 'regular', 8.5, INK),
          T(48.5, 73, 200, 'This Certificate is Proudly Presented to', 'regular', 3.8, '#556372'),
          T(58.5, 100, 180, '{{name}}', 'script', 17, INK),
          L(88.5, 106, 120, 0, '#9aa5b1', 0.35),
          T(73.5, 120, 150, BODY, 'regular', 3.4, '#556372', 'center', { lineHeight: 1.5, h: 16 }),
          T(66, 158, 44, '{{date}}', 'medium', 3.6, INK),
          L(66, 161, 44, 0, '#9aa5b1', 0.35),
          T(66, 166.5, 44, 'DATE', 'semibold', 3.2, INK, 'center', { track: 0.1 }),
          T(187, 158, 44, '{{speaker}}', 'medium', 3.6, INK),
          L(187, 161, 44, 0, '#9aa5b1', 0.35),
          T(187, 166.5, 44, 'SIGNATURE', 'semibold', 3.2, INK, 'center', { track: 0.1 }),
          T(98.5, 141, 100, 'Certificate No. {{cert_no}}', 'regular', 2.6, '#8090a0'),
          QR(276, 182, 14, INK),
        ],
      }
    },
  },
  {
    key: 'classic', name: 'Classic — gold border', about: 'Cream page in a double gold frame, serif heading, your logo and a seal.',
    make: () => {
      const GOLD = '#b8902f', INK = '#2b2416'
      return {
        page: 'landscape', bg: '#fbf7ec', els: [
          R(8, 8, 281, 194, { stroke: GOLD, sw: 1.6 }),
          R(12, 12, 273, 186, { stroke: GOLD, sw: 0.5 }),
          ...[[12, 12], [285, 12], [12, 198], [285, 198]].map(([x, y]) => P(x - 5, y - 5, 10, 10, 4, { fill: GOLD })),
          LOGO(118.5, 20, 60),
          T(48.5, 58, 200, 'Certificate of {{kind}}', 'serif', 13, INK),
          L(118.5, 64, 60, 0, GOLD, 0.6),
          T(48.5, 78, 200, 'THIS CERTIFICATE IS PRESENTED TO', 'medium', 3.6, '#6d5a2c', 'center', { track: 0.18 }),
          T(38.5, 102, 220, '{{name}}', 'script', 19, INK),
          L(83.5, 108, 130, 0, GOLD, 0.4),
          T(68.5, 121, 160, BODY, 'serif', 3.8, '#4a3f2a', 'center', { lineHeight: 1.5, h: 18 }),
          ...seal(148.5, 165, 13, GOLD, '#8a6d12'),
          T(40, 172, 60, '{{date}}', 'medium', 3.6, INK), L(40, 175, 60, 0, INK, 0.3), T(40, 181, 60, 'Date', 'serif', 3.4, '#6d5a2c'),
          T(197, 172, 60, '{{speaker}}', 'medium', 3.6, INK), L(197, 175, 60, 0, INK, 0.3), T(197, 181, 60, 'Signature', 'serif', 3.4, '#6d5a2c'),
          T(20, 194, 120, 'Certificate No. {{cert_no}}', 'regular', 2.6, '#8a7a55', 'left'),
          QR(266, 176, 14, INK),
        ],
      }
    },
  },
  {
    key: 'ribbon', name: 'Modern — navy band', about: 'A deep navy band down the left with a gold stripe; clean left-aligned text.',
    make: () => {
      const NAVY = '#14205c', GOLD = '#e0b13c', INK = '#1d2470'
      return {
        page: 'landscape', bg: '#ffffff', els: [
          R(0, 0, 78, 210, { fill: NAVY }),
          R(78, 0, 4, 210, { fill: GOLD }),
          E(-30, 150, 90, 90, { stroke: '#2b3a86', sw: 1.2 }),
          E(-20, -40, 80, 80, { stroke: '#2b3a86', sw: 1.2 }),
          T(10, 96, 58, '{{kind}}', 'extrabold', 7, '#ffffff', 'left', { upper: true, track: 0.08 }),
          T(10, 106, 58, 'CERTIFICATE', 'medium', 4, GOLD, 'left', { track: 0.3 }),
          LOGO(98, 18, 50),
          T(98, 62, 180, 'Certificate of {{kind}}', 'bold', 10, INK, 'left'),
          T(98, 78, 180, 'This is to certify that', 'regular', 4, '#4b5563', 'left'),
          T(98, 98, 185, '{{name}}', 'bold', 13, INK, 'left'),
          L(98, 104, 120, 0, GOLD, 0.8),
          T(98, 117, 180, BODY, 'regular', 3.8, '#4b5563', 'left', { lineHeight: 1.55, h: 18 }),
          T(98, 170, 60, '{{date}}', 'semibold', 3.8, INK, 'left'), T(98, 177, 60, 'Date', 'regular', 3.2, '#6b7280', 'left'),
          T(170, 170, 70, '{{speaker}}', 'semibold', 3.8, INK, 'left'), T(170, 177, 70, 'Speaker / Trainer', 'regular', 3.2, '#6b7280', 'left'),
          T(98, 200, 120, 'Certificate No. {{cert_no}}', 'regular', 2.8, '#9ca3af', 'left'),
          QR(262, 172, 18, INK),
        ],
      }
    },
  },
  {
    key: 'minimal', name: 'Minimal — clean', about: 'Lots of white, a thin frame and one accent colour; the name large.',
    make: () => {
      const ACC = '#2563eb', INK = '#111827'
      return {
        page: 'landscape', bg: '#ffffff', els: [
          R(14, 14, 269, 182, { stroke: '#d1d5db', sw: 0.4 }),
          R(14, 14, 269, 4, { fill: ACC }),
          LOGO(20, 26, 46),
          T(48.5, 62, 200, 'CERTIFICATE', 'light', 12, INK, 'center', { track: 0.35 }),
          T(48.5, 72, 200, 'of {{kind}}', 'regular', 5, '#6b7280', 'center', { track: 0.1 }),
          T(28.5, 104, 240, '{{name}}', 'semibold', 15, INK),
          T(63.5, 122, 170, BODY, 'regular', 3.8, '#4b5563', 'center', { lineHeight: 1.55, h: 18 }),
          L(40, 168, 60, 0, '#9ca3af', 0.3), T(40, 174, 60, '{{date}}', 'regular', 3.4, '#4b5563'),
          L(197, 168, 60, 0, '#9ca3af', 0.3), T(197, 174, 60, '{{speaker}}', 'regular', 3.4, '#4b5563'),
          QR(141.5, 160, 14, INK),
          T(98.5, 188, 100, '{{cert_no}}', 'regular', 2.6, '#9ca3af'),
        ],
      }
    },
  },
  {
    key: 'dark', name: 'Elegant — dark & gold', about: 'Midnight page, gold frame and lettering, your logo on a white plate; for awards and toppers.',
    make: () => {
      const GOLD = '#d9b45a', SOFT = '#efe3c2'
      return {
        page: 'landscape', bg: '#0f1a2e', els: [
          R(9, 9, 279, 192, { stroke: GOLD, sw: 0.8 }),
          P(-30, -30, 80, 80, 4, { fill: GOLD, opacity: 0.12 }),
          P(247, 160, 80, 80, 4, { fill: GOLD, opacity: 0.12 }),
          // the navy logo on a white plate, so it shows on the dark page
          R(120.5, 12, 56, 18, { fill: '#ffffff', r: 3 }),
          LOGO(123.5, 14, 50),
          T(48.5, 46, 200, 'CERTIFICATE', 'serif', 15, GOLD, 'center', { track: 0.2 }),
          T(48.5, 58, 200, 'OF {{kind}}', 'medium', 4.4, SOFT, 'center', { upper: true, track: 0.4 }),
          T(48.5, 80, 200, 'Proudly presented to', 'regular', 4, SOFT),
          T(38.5, 106, 220, '{{name}}', 'script', 19, GOLD),
          L(93.5, 112, 110, 0, GOLD, 0.4),
          T(63.5, 126, 170, BODY, 'regular', 3.7, SOFT, 'center', { lineHeight: 1.55, h: 18 }),
          ...seal(148.5, 168, 12, GOLD, '#9c7b2c'),
          T(40, 175, 60, '{{date}}', 'medium', 3.6, SOFT), L(40, 178, 60, 0, GOLD, 0.3), T(40, 184, 60, 'DATE', 'semibold', 3, GOLD, 'center', { track: 0.2 }),
          T(197, 175, 60, '{{speaker}}', 'medium', 3.6, SOFT), L(197, 178, 60, 0, GOLD, 0.3), T(197, 184, 60, 'SIGNATURE', 'semibold', 3, GOLD, 'center', { track: 0.2 }),
          QR(270, 16, 13, GOLD),
          T(20, 196, 140, 'No. {{cert_no}}', 'regular', 2.6, '#8c8466', 'left'),
        ],
      }
    },
  },
  {
    key: 'portrait', name: 'Portrait — participation', about: 'A4 portrait with a coloured header, for seminars and webinars.',
    make: () => {
      const NAVY = '#0b4a73', TEAL = '#21c1bd', INK = '#123d5c'
      return {
        page: 'portrait', bg: '#ffffff', els: [
          R(0, 0, 210, 62, { fill: NAVY }),
          P(140, -20, 90, 80, 6, { fill: TEAL, r: 6, opacity: 0.9 }),
          P(-30, 30, 70, 60, 6, { stroke: TEAL, sw: 1.6, r: 5 }),
          T(15, 32, 180, 'CERTIFICATE', 'extrabold', 13, '#ffffff', 'left', { track: 0.06 }),
          T(15, 44, 180, 'of {{kind}}', 'regular', 6, '#dbeafe', 'left'),
          LOGO(65, 78, 80),
          T(15, 120, 180, 'This certificate is proudly presented to', 'regular', 4.2, '#556372'),
          T(10, 146, 190, '{{name}}', 'script', 17, INK),
          L(45, 152, 120, 0, '#9aa5b1', 0.35),
          T(25, 168, 160, BODY, 'regular', 3.8, '#556372', 'center', { lineHeight: 1.55, h: 24 }),
          T(25, 215, 70, '{{date}}', 'medium', 3.8, INK), L(25, 218, 70, 0, '#9aa5b1', 0.35), T(25, 224, 70, 'DATE', 'semibold', 3.2, INK, 'center', { track: 0.1 }),
          T(115, 215, 70, '{{speaker}}', 'medium', 3.8, INK), L(115, 218, 70, 0, '#9aa5b1', 0.35), T(115, 224, 70, 'SIGNATURE', 'semibold', 3.2, INK, 'center', { track: 0.1 }),
          R(0, 272, 210, 25, { fill: TEAL }),
          QR(93, 244, 24, INK),
          T(15, 287, 180, 'Certificate No. {{cert_no}} · Scan the code to verify', 'medium', 3, '#ffffff'),
        ],
      }
    },
  },
]
export const presetDesign = (key: string) => (PRESETS.find((p) => p.key === key) ?? PRESETS[0]).make()
/** A fresh element id, unique within a design. */
export const newElId = (d: Design) => { let i = d.els.length; while (d.els.some((e) => e.id === `n${i}`)) i++; return `n${i}` }
