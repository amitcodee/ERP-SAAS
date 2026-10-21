import 'server-only'
// The Project Completion Certificate, laid out once and drawn twice like the course certificate (lib/cert-course.ts):
// as SVG on the certificate page and into the PDF. All centred on white: the institute's logo (or its name), PROJECT COMPLETION / CERTIFICATE between two short bars, the student, the project the
// trainer approved, a row of duration / tools / registration number, the head of the department's signature and the
// branch at the foot. Positions in mm on A4 landscape (297 x 210), y from the top.
import { fmtCertDate } from '@/lib/cert-art'
import { branchPlace, certWidth, type CertBrand, type CertFont, type CertOp } from '@/lib/cert-course'

export type ProjectCertInput = {
  name: string; father: string | null; gender: string | null
  /** the project's title as the trainer approved it */
  project: string
  tools: string[]
  joined: string; ended: string | null; issuedAt: string; regNo: string; branch: string
  head: { image: string | null; title: string }
  brand: CertBrand
}

const INK = '#1d2470', BLUE = '#1638d6'
const CX = 148.5

/** The largest size (down to min) at which s fits max; at min it is cut with "…". */
function fit(s: string, font: CertFont, size: number, max: number, min: number) {
  let z = size
  while (z > min && certWidth(s, font, z) > max) z = Math.max(min, z - 0.1)
  let t = s
  while (t.length > 1 && certWidth(t, font, z) > max) t = t.slice(0, -2).trimEnd() + '…'
  return { s: t, size: z }
}
/** Words wrapped to lines no wider than max. */
function wrap(s: string, font: CertFont, size: number, max: number) {
  const lines: string[] = []
  let cur = ''
  for (const w of s.split(/\s+/).filter(Boolean)) {
    const t = cur ? `${cur} ${w}` : w
    if (cur && certWidth(t, font, size) > max) { lines.push(cur); cur = w } else cur = t
  }
  if (cur) lines.push(cur)
  return lines
}
const withTitle = (n: string) => (/^(mr|mr\.|shri|sh\.?|s\.|sardar|late|dr\.?|sri)\b/i.test(n.trim()) ? n.trim() : `Mr. ${n.trim()}`)

export function projectCertOps(v: ProjectCertInput): CertOp[] {
  const ops: CertOp[] = []
  const NAVY = /^#[0-9a-fA-F]{6}$/.test(v.brand.color) ? v.brand.color : '#141a6e'
  const T = (x: number, y: number, s: string, font: CertFont, size: number, fill: string, track?: number) => { ops.push({ k: 'text', x, y, s, font, size, fill, ...(track ? { track } : {}) }); return x + certWidth(s, font, size, track) }
  const centred = (y: number, s: string, font: CertFont, size: number, fill: string, track?: number, cx = CX) => T(cx - certWidth(s, font, size, track) / 2, y, s, font, size, fill, track)
  /** One centred line in several weights. */
  const runs = (y: number, size: number, parts: [string, CertFont, string][]) => {
    let x = CX - parts.reduce((w, [s, f]) => w + certWidth(s, f, size), 0) / 2
    for (const [s, f, c] of parts) x = T(x, y, s, f, size, c)
  }
  const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, sw: number) => ops.push({ k: 'path', d: `M${x1},${y1} L${x2},${y2}`, stroke, sw })
  const bar = (y: number) => ops.push({ k: 'path', d: `M${CX - 11.5},${y} H${CX + 11.5}`, stroke: NAVY, sw: 0.5 })

  ops.push({ k: 'path', d: 'M0,0 H297 V210 H0 Z', fill: '#ffffff' })

  // the logo, and the heading between two short bars
  if (v.brand.logo) ops.push({ k: 'img', x: CX - 42, y: 4.5, w: 84, h: 84 / (952 / 262), src: v.brand.logo })
  else { const n = fit(v.brand.name, 'bold', 9, 200, 5); centred(22, n.s, 'bold', n.size, NAVY) }
  bar(30.6)
  centred(39.8, 'PROJECT COMPLETION', 'regular', 5.4, NAVY, 0.36)
  centred(58.6, 'CERTIFICATE', 'medium', 22, NAVY, 0.02)
  bar(63.8)

  // who, and the project they completed
  centred(73.4, 'This is to certify that', 'regular', 5, INK)
  const nm = fit(v.name, 'bold', 14, 230, 9)
  centred(88.4, nm.s, 'bold', nm.size, NAVY)
  let y = 98.8
  if (v.father?.trim()) {
    const rel = v.gender === 'male' ? 'Son of ' : v.gender === 'female' ? 'Daughter of ' : 'Son / Daughter of '
    const f = fit(withTitle(v.father), 'semibold', 5, 230 - certWidth(rel, 'regular', 5), 3.8)
    runs(y, f.size, [[rel, 'regular', INK], [f.s, 'semibold', NAVY]])
  } else y -= 4
  centred(y + 9.8, 'has successfully completed the project titled', 'regular', 5.2, INK)
  // a long title takes two lines before it gets smaller
  const PT = 8.6, MAXW = 236
  let title = wrap(v.project, 'bold', PT, MAXW)
  let pSize = PT
  if (title.length > 1) { pSize = 7; title = wrap(v.project, 'bold', pSize, MAXW).slice(0, 2) }
  y += 20.5
  for (const [i, l] of title.entries()) { const f = fit(l, 'bold', pSize, MAXW, 5); centred(y + i * pSize * 1.15, f.s, 'bold', f.size, BLUE) }
  y += (title.length - 1) * pSize * 1.15

  // what the project shows
  const about = `This project was designed and developed as part of the practical training at ${v.brand.name}, demonstrating proficiency in project development and implementation.`
  // under a two-line title it takes two wider lines, so it stays clear of the row below
  for (const [i, l] of wrap(about, 'regular', 4.4, title.length > 1 ? 222 : 172).slice(0, 3).entries()) centred(y + 9.9 + i * 6.3, l, 'regular', 4.4, INK)

  // the facts row: duration, tools, registration number, each with its icon
  const RY = 149.4
  const icon = (d: string) => ops.push({ k: 'path', d, stroke: NAVY, sw: 0.75, round: true })
  // a calendar
  icon('M38.4,152.2 h8.4 a1.2,1.2 0 0 1 1.2,1.2 v7.6 a1.2,1.2 0 0 1 -1.2,1.2 h-8.4 a1.2,1.2 0 0 1 -1.2,-1.2 v-7.6 a1.2,1.2 0 0 1 1.2,-1.2 Z M37.2,155 H48 M40.2,150.8 V153.2 M45,150.8 V153.2')
  for (const [cx, cy] of [[40, 157.2], [42.6, 157.2], [45.2, 157.2], [40, 159.6], [42.6, 159.6], [45.2, 159.6]]) ops.push({ k: 'path', d: `M${cx - 0.5},${cy - 0.45} h1 v0.9 h-1 Z`, fill: NAVY })
  // layers (tools)
  icon('M125.4,151.6 L131,154.4 L125.4,157.2 L119.8,154.4 Z M119.8,157 L125.4,159.8 L131,157 M119.8,159.6 L125.4,162.4 L131,159.6')
  // a document (registration)
  icon('M207.4,150.8 h7.8 a1.2,1.2 0 0 1 1.2,1.2 v9.8 a1.2,1.2 0 0 1 -1.2,1.2 h-7.8 a1.2,1.2 0 0 1 -1.2,-1.2 v-9.8 a1.2,1.2 0 0 1 1.2,-1.2 Z M209.2,154 H210.2 M211.6,154 H214.4 M209.2,157 H210.2 M211.6,157 H214.4 M209.2,160 H210.2 M211.6,160 H214.4')
  line(111.2, RY, 111.2, 164.6, NAVY, 0.35)
  line(196, RY, 196, 164.6, NAVY, 0.35)
  const span = [fmtCertDate(v.joined), fmtCertDate(v.ended ?? v.issuedAt)].filter(Boolean).join(' – ')
  const fact = (x: number, label: string, value: string, max: number) => {
    T(x, 154, label, 'regular', 3.5, INK)
    const lines = wrap(value || '—', 'medium', 3.75, max)
    if (lines.length <= 2) lines.forEach((l, i) => T(x, 160 + i * 5, l, 'medium', 3.75, NAVY))
    else { const two = wrap(value, 'medium', 3.3, max); two.slice(0, 2).forEach((l, i) => { const f = fit(i === 1 && two.length > 2 ? `${l} …` : l, 'medium', 3.3, max, 3); T(x, 160 + i * 4.6, f.s, 'medium', f.size, NAVY) }) }
  }
  fact(52.8, 'Project Duration', span || '—', 55)
  fact(137, 'Tools Used', v.tools.join(', '), 55)
  fact(222.2, 'Registration No.', v.regNo, 60)

  // the head of the department's signature, centred
  if (v.head.image) ops.push({ k: 'img', x: CX - 24, y: 168.4, w: 48, h: 18.2, src: v.head.image })
  line(115.6, 187.4, 181.4, 187.4, NAVY, 0.35)
  const ht = fit(v.head.title, 'semibold', 4.1, 66, 3.2)
  centred(193.8, ht.s, 'semibold', ht.size, NAVY)

  // the foot: <institute> | <place> branch, between two lines
  const left = fit(v.brand.name, 'semibold', 3.25, 110, 2.6).s, right = `${branchPlace(v.branch, v.brand.name).toLowerCase()} branch`, FS = 3.25, TR = 0.12
  const gap = 4.2, wl = certWidth(left, 'semibold', FS, TR), wr = certWidth(right, 'semibold', FS, TR)
  const x0 = CX - (wl + gap * 2 + wr) / 2
  T(x0, 200.9, left, 'semibold', FS, NAVY, TR)
  line(x0 + wl + gap, 197.9, x0 + wl + gap, 201.4, NAVY, 0.3)
  const end = T(x0 + wl + gap * 2, 200.9, right, 'semibold', FS, NAVY, TR)
  line(41.4, 199.4, x0 - 5, 199.4, NAVY, 0.4)
  line(end + 5, 199.4, 255.6, 199.4, NAVY, 0.4)
  return ops
}
