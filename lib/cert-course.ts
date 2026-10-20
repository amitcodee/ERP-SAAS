import 'server-only'
// The Course Completion Certificate, laid out once and drawn twice: as SVG on the certificate page
// (components/certificate-sheet.tsx) and into the PDF (lib/pdf.ts), so both are the same to the millimetre.
// The design follows the techcadd certificate artwork; positions are in mm on A4 landscape (297 x 210),
// y from the top. Text is Poppins (public/fonts/pdf, Latin), measured here so that long names, course titles and
// tool lists are shrunk to fit their space instead of running into the next block.
import fontkit from '@pdf-lib/fontkit'
import { readFileSync } from 'fs'
import { join } from 'path'
import QRCode from 'qrcode'
import { fmtCertDate } from '@/lib/cert-art'

// Poppins in six weights; serif (Noto Serif) and script (Great Vibes) for the designs made in Certificate Designs.
export type CertFont = 'light' | 'regular' | 'medium' | 'semibold' | 'bold' | 'extrabold' | 'serif' | 'script'
export const CERT_FONT_FILES: Record<CertFont, string> = {
  light: 'Poppins-Light', regular: 'Poppins-Regular', medium: 'Poppins-Medium', semibold: 'Poppins-SemiBold', bold: 'Poppins-Bold', extrabold: 'Poppins-ExtraBold',
  serif: 'NotoSerif-Regular', script: 'GreatVibes-Regular',
}
export const CERT_FONT_WEIGHT: Record<CertFont, number> = { light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, serif: 400, script: 400 }
/** The CSS family each font is loaded under on the certificate page (the Poppins weights share one). */
export const CERT_FONT_FAMILY: Record<CertFont, string> = { light: 'CertPoppins', regular: 'CertPoppins', medium: 'CertPoppins', semibold: 'CertPoppins', bold: 'CertPoppins', extrabold: 'CertPoppins', serif: 'CertSerif', script: 'CertScript' }

/** What the design draws: all text is start-anchored at a measured x (no browser / PDF differences in centring). */
export type CertOp =
  | { k: 'text'; x: number; y: number; s: string; font: CertFont; size: number; fill: string; track?: number } // track: extra space per letter, in em
  | { k: 'glyph'; x: number; y: number; ch: string; font: CertFont; size: number; fill: string; rot: number; w: number } // one letter centred on (x, y), turned rot degrees
  | { k: 'path'; d: string; fill?: string; stroke?: string; sw?: number; opacity?: number; round?: boolean }
  | { k: 'img'; x: number; y: number; w: number; h: number; src: string; stretch?: boolean; opacity?: number } // fitted into the box: centred, resting on its bottom (stretch: filling it)
  | { k: 'qr'; x: number; y: number; size: number; text: string; fill: string }

export type CourseCertInput = {
  name: string; father: string | null; gender: string | null; course: string; tools: string[]; toolsLabel: string
  duration: string | null; joined: string; ended: string | null; mode: string | null; regNo: string; branch: string
  certNo: string; serial: string; issuedAt: string; verifyUrl: string
  signers: { authorised: { image: string | null; title: string }; head: { image: string | null; title: string } }
}

// ---- measuring (Poppins advance widths, no kerning: pdf-lib draws without it and the page switches it off) ----
type GlyphPath = { scale(x: number, y: number): GlyphPath; translate(x: number, y: number): GlyphPath; rotate(rad: number): GlyphPath; toSVG(): string }
type Kit = { unitsPerEm: number; hasGlyphForCodePoint(cp: number): boolean; glyphForCodePoint(cp: number): { advanceWidth: number; path: GlyphPath } }
const kits = new Map<CertFont, Kit>()
const kit = (f: CertFont) => {
  if (!kits.has(f)) kits.set(f, fontkit.create(readFileSync(join(process.cwd(), 'public', 'fonts', 'pdf', `${CERT_FONT_FILES[f]}.ttf`)) as Buffer) as unknown as Kit)
  return kits.get(f)!
}
/** Width in mm of s at size mm (letters Poppins does not have, e.g. Gurmukhi, are counted at 0.6 em). */
export function certWidth(s: string, font: CertFont, size: number, track = 0) {
  const k = kit(font)
  let em = 0
  for (const ch of s) { const cp = ch.codePointAt(0)!; em += (k.hasGlyphForCodePoint(cp) ? k.glyphForCodePoint(cp).advanceWidth / k.unitsPerEm : 0.6) + track }
  return em * size - (s.length ? track * size : 0)
}
/** The largest size (down to min) at which s fits max; at min it is cut with "…". */
function fit(s: string, font: CertFont, size: number, max: number, min: number) {
  let z = size
  while (z > min && certWidth(s, font, z) > max) z = Math.max(min, z - 0.1)
  let t = s
  while (t.length > 1 && certWidth(t, font, z) > max) t = t.slice(0, -2).trimEnd() + '…'
  return { s: t, size: z }
}

// LOGO is the navy of the techcadd logo (public/tce-logo.png), in place of a bright blue: the course title, the bars,
// the band and the frame. The dark text and the QR code keep their own colours.
const LOGO = '#0a1d6b', NAVY = '#16205c', INK = '#1f2a5a', BLUE = LOGO, SOFT = '#c9d6f3'

/** A rounded rectangle as a path. */
const rrect = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x + r} Q${x},${y + h} ${x},${y + h - r} V${y + r} Q${x},${y} ${x + r},${y} Z`
const circle = (cx: number, cy: number, r: number) => `M${cx - r},${cy} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0 Z`
const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, sw: number): CertOp => ({ k: 'path', d: `M${x1},${y1} L${x2},${y2}`, stroke, sw })

const titleCase = (s: string) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase())
/** "Mr. Deepak Kumar": the father's name with "Mr." unless it already starts with a title. */
const withTitle = (n: string) => (/^(mr|mr\.|shri|sh\.?|s\.|sardar|late|dr\.?|sri)\b/i.test(n.trim()) ? n.trim() : `Mr. ${n.trim()}`)
/** The branch's place: "Techcadd Mohali" -> "Mohali". */
export const branchPlace = (b: string) => b.replace(/^\s*techcadd\s*/i, '').replace(/\s+branch\s*$/i, '').trim() || b
/** Course modes as the certificate says them. */
const modeText = (m: string | null) => (!m ? '—' : /^offline$/i.test(m) ? 'Offline / Classroom' : /^online$/i.test(m) ? 'Online / Live Classes' : m)

export function courseCertOps(v: CourseCertInput): CertOp[] {
  const ops: CertOp[] = []
  const T = (x: number, y: number, s: string, font: CertFont, size: number, fill: string, track?: number) => { ops.push({ k: 'text', x, y, s, font, size, fill, ...(track ? { track } : {}) }); return x + certWidth(s, font, size, track) }
  const centred = (cx: number, y: number, s: string, font: CertFont, size: number, fill: string, track?: number) => T(cx - certWidth(s, font, size, track) / 2, y, s, font, size, fill, track)
  /** One line in several weights, from x. */
  const runs = (x: number, y: number, size: number, parts: [string, CertFont, string][]) => { let at = x; for (const [s, f, c] of parts) at = T(at, y, s, f, size, c); return at }

  // the frame and a straight band along the bottom
  ops.push({ k: 'path', d: rrect(6.2, 3.4, 284.6, 202.6, 2.6), fill: '#ffffff', stroke: '#3c4a8c', sw: 0.35 })
  ops.push({ k: 'path', d: 'M6.37,199.2 H290.63', stroke: '#8c96c4', sw: 0.35 })
  ops.push({ k: 'path', d: 'M6.37,200.4 H290.63 V203.4 Q290.63,205.83 288.2,205.83 H8.8 Q6.37,205.83 6.37,203.4 Z', fill: LOGO })

  // the watermark: a thick ring (stopping at the divider), a scalloped badge with two ribbon tails and a tick
  const [bx, by] = [202, 89.2]
  const end = Math.acos((232 - bx) / 45) // where the ring meets the divider
  const p = (a: number) => `${(bx + 45 * Math.cos(a)).toFixed(2)},${(by + 45 * Math.sin(a)).toFixed(2)}`
  ops.push({ k: 'path', d: `M${p(end)} A45,45 0 1,1 ${p(-end)}`, stroke: '#eef3fd', sw: 6.7 })
  ops.push({ k: 'path', d: 'M190.5,104 L181,141 L187.8,137.6 L191.4,144 L199.6,108 Z', fill: '#e6edfb' })
  ops.push({ k: 'path', d: 'M213.5,104 L223,141 L216.2,137.6 L212.6,144 L204.4,108 Z', fill: '#e6edfb' })
  let badge = ''
  for (let i = 0; i <= 160; i++) { const a = (2 * Math.PI * i) / 160, r = 20.3 + 1.3 * Math.cos(16 * a); badge += `${i ? 'L' : 'M'}${(bx + r * Math.cos(a)).toFixed(2)},${(by + r * Math.sin(a)).toFixed(2)}` }
  ops.push({ k: 'path', d: badge + 'Z', fill: '#e6edfb' })
  ops.push({ k: 'path', d: circle(bx, by, 14), fill: '#f4f7fe' })
  ops.push({ k: 'path', d: 'M193.6,88.8 L200.6,96 L212.4,81.8', stroke: '#d6e2f8', sw: 3.4, round: true })

  // top left: serial number, the logo
  runs(13.2, 11.9, 3.3, [['S. No.: ', 'semibold', NAVY], [v.serial, 'regular', INK]])
  // the word "techcadd" starts 67 of the image's 952 px in: it lines up with "COURSE COMPLETION" below (x 20.1)
  ops.push({ k: 'img', x: 20.1 - (67 / 952) * 92, y: 14.2, w: 92, h: 92 / (952 / 262), src: '/tce-logo.png' })

  // top: what techcadd does, and the line between the certificate and the side panel
  {
    const items = ['TRAINING', 'CERTIFICATION', 'PLACEMENT SUPPORT'], size = 2.7, tr = 0.05, gap = 4.2
    const widths = items.map((s) => certWidth(s, 'regular', size, tr))
    let x = 229.2 - (widths.reduce((a, b) => a + b, 0) + gap * 2 * (items.length - 1))
    items.forEach((s, i) => {
      x = T(x, 14.2, s, 'regular', size, INK, tr)
      if (i < items.length - 1) { ops.push(line(x + gap, 11.9, x + gap, 14.9, INK, 0.2)); x += gap * 2 }
    })
  }
  ops.push(line(232.5, 10.3, 232.5, 179.5, SOFT, 0.3))

  // the heading
  T(20.1, 47.2, 'COURSE COMPLETION', 'regular', 4.7, INK, 0.112)
  T(19.7, 63.8, 'CERTIFICATE', 'light', 15.5, NAVY, 0.087)
  ops.push({ k: 'path', d: rrect(20.1, 66.5, 14.3, 0.9, 0.45), fill: LOGO })

  // who, and what they completed
  T(20.4, 77.5, 'This is to certify that', 'light', 4.4, INK)
  const nm = fit(v.name, 'bold', 10.6, 205, 7)
  T(20, 91.7, nm.s, 'bold', nm.size, NAVY)
  const BODY = 4.4
  let y = 101.1
  if (v.father?.trim()) {
    const rel = v.gender === 'male' ? 'Son of ' : v.gender === 'female' ? 'Daughter of ' : 'Son / Daughter of '
    const f = fit(withTitle(v.father), 'semibold', BODY, 205 - certWidth(rel, 'light', BODY), 3.4)
    runs(20.4, y, BODY, [[rel, 'light', INK], [f.s, 'semibold', NAVY]])
    y += 7.6
  }
  runs(20.4, y, BODY, v.duration ? [['has successfully completed the ', 'light', INK], [titleCase(v.duration), 'bold', NAVY], [' course', 'light', INK]] : [['has successfully completed the course', 'light', INK]])
  T(20.4, y + 7, 'and fulfilled all the requirements for the program.', 'light', BODY, INK)
  const ct = fit(v.course, 'bold', 7.6, 205, 5)
  T(20.2, 127.6, ct.s, 'bold', ct.size, BLUE)
  if (v.tools.length) {
    const label = `${/^tools$/i.test(v.toolsLabel) ? 'Technologies Used' : `${v.toolsLabel} Covered`}: `
    let size = 4.3
    const list = v.tools.join(', ')
    while (size > 3.2 && certWidth(label, 'semibold', size) + certWidth(list, 'light', size) > 205) size -= 0.1
    const t = fit(list, 'light', size, 205 - certWidth(label, 'semibold', size), size)
    runs(20.2, 135.4, size, [[label, 'semibold', NAVY], [t.s, 'light', INK]])
  }

  // the facts row: duration, mode, registration number, each with its icon
  const span = [fmtCertDate(v.joined), fmtCertDate(v.ended ?? v.issuedAt)].filter(Boolean).join(' to ')
  const icon = (d: string) => ops.push({ k: 'path', d, stroke: NAVY, sw: 0.55, round: true })
  icon(`${rrect(21.4, 143.6, 8.4, 7.8, 0.9)} M21.4,146.4 H29.8 M23.8,142.4 V144.6 M27.4,142.4 V144.6`)
  for (const [cx, cy] of [[23.4, 148], [25.6, 148], [27.8, 148], [23.4, 150], [25.6, 150], [27.8, 150]]) ops.push({ k: 'path', d: rrect(cx - 0.45, cy - 0.4, 0.9, 0.8, 0.15), fill: NAVY })
  icon(`${rrect(97.9, 142.8, 9.6, 6.6, 0.7)} M102.7,149.4 V151.6 M100.2,151.8 H105.2`)
  icon(`M166.6,142.6 H172.2 L174.8,145.2 V151.6 H166.6 Z M172.2,142.6 V145.2 H174.8 M168.4,146.6 H173 M168.4,148.4 H173 M168.4,150.2 H171.2`)
  ops.push(line(90.3, 141.4, 90.3, 152.2, NAVY, 0.3), line(157.8, 141.4, 157.8, 152.2, NAVY, 0.3))
  const facts: [number, string, string, number][] = [[35.6, 'Course Duration', span || '—', 52], [113.1, 'Course Mode', modeText(v.mode), 42], [180.8, 'Roll No / Reg No.', v.regNo, 49]]
  for (const [x, label, value, max] of facts) {
    T(x, 145.4, label, 'light', 2.85, INK)
    const f = fit(value, 'medium', 3.25, max, 2.6)
    T(x, 151.6, f.s, 'medium', f.size, NAVY)
  }

  ops.push({ k: 'img', x: 177.2, y: 182.4, w: 107.5, h: 107.5 / (1112 / 172), src: '/cert/accreditations.png' })

  // signatures: the authorised signatory on the left, the head of the department on the right
  for (const [cx, x1, x2, s] of [[61.2, 31.5, 91, v.signers.authorised], [185.7, 155.7, 215.6, v.signers.head]] as const) {
    if (s.image) ops.push({ k: 'img', x: cx - 26, y: 156.8, w: 52, h: 16.6, src: s.image })
    ops.push(line(x1, 174.1, x2, 174.1, NAVY, 0.3))
    const t = fit(s.title, 'semibold', 3.1, 62, 2.6)
    centred(cx, 179.1, t.s, 'semibold', t.size, NAVY)
  }

  // bottom: the branch, the company, the accreditations
  let fx = T(14.9, 191.8, 'techcadd', 'regular', 3.92, NAVY)
  ops.push(line(fx + 2.6, 188.8, fx + 2.6, 192.4, NAVY, 0.25))
  T(fx + 5.2, 191.8, `${branchPlace(v.branch)} Branch`, 'medium', 3.29, NAVY)
  fx = T(14.9, 196.5, 'A Unit of Techcadd Computer Education Pvt. Ltd.', 'light', 2.94, INK)
  ops.push(line(fx + 2.6, 194.1, fx + 2.6, 197.1, INK, 0.2))
  T(fx + 5.2, 196.5, 'An ISO 9001:2015 Certified company', 'light', 2.94, INK)

  // the side panel: the motto, the QR code, the certificate ID and the date of issue
  for (const [i, s] of ['EMPOWERING', 'SKILLS FOR A', 'BETTER', 'TOMORROW'].entries()) centred(262, 33.8 + i * 6.2, s, 'regular', 4.5, INK, 0.147)
  ops.push({ k: 'path', d: rrect(255, 59, 14.3, 0.9, 0.45), fill: LOGO })
  ops.push({ k: 'qr', x: 248.4, y: 74.4, size: 27.4, text: v.verifyUrl, fill: '#0d1333' })
  centred(262, 111, 'Scan to Verify', 'medium', 3.5, NAVY)
  ops.push(line(255.5, 118.5, 268.5, 118.5, '#9fb1df', 0.25))
  centred(262, 127.4, 'Certificate ID', 'light', 3.4, INK)
  const id = fit(v.certNo, 'semibold', 3.6, 52, 2.8)
  centred(262, 134, id.s, 'semibold', id.size, NAVY)
  ops.push(line(255.5, 140, 268.5, 140, '#9fb1df', 0.25))
  centred(262, 149.1, 'Date of Issue', 'light', 3.4, INK)
  centred(262, 155.7, fmtCertDate(v.issuedAt), 'semibold', 3.8, NAVY)
  return ops
}

/**
 * A text (or turned letter) of the layout as the outlines of its Poppins letters, in mm: the page draws these instead of
 * text, so every browser shows the certificate the same (no web font to load, nothing to fall back to). null when the
 * font lacks a letter (e.g. a name in Gurmukhi): the page then writes it as text.
 */
export function certTextPath(o: Extract<CertOp, { k: 'text' } | { k: 'glyph' }>): string | null {
  const k = kit(o.font), s = o.size / k.unitsPerEm
  const text = o.k === 'text' ? o.s : o.ch
  if ([...text].some((ch) => !/\s/.test(ch) && !k.hasGlyphForCodePoint(ch.codePointAt(0)!))) return null
  const track = o.k === 'text' ? (o.track ?? 0) * o.size : 0
  const rad = o.k === 'glyph' ? (o.rot * Math.PI) / 180 : 0
  let d = '', at = o.k === 'text' ? 0 : -o.w / 2
  for (const ch of text) {
    const g = k.glyphForCodePoint(ch.codePointAt(0)!)
    let p = g.path.scale(s, -s).translate(at, o.k === 'text' ? 0 : o.size * 0.35)
    if (rad) p = p.rotate(rad)
    d += p.translate(o.x, o.y).toSVG()
    at += g.advanceWidth * s + track
  }
  return d
}

/** The QR code's dark modules as one path (both renderers draw this). */
export function qrPath(text: string, x: number, y: number, size: number) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const n = qr.modules.size, c = size / n
  let d = ''
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.modules.get(r, col)) d += `M${(x + col * c).toFixed(3)},${(y + r * c).toFixed(3)}h${(c + 0.02).toFixed(3)}v${(c + 0.02).toFixed(3)}h${(-c - 0.02).toFixed(3)}Z`
  return d
}
