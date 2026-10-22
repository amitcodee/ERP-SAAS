// Drawing for the certificates, shared by the web page (SVG) and the PDF (pdf-lib drawSvgPath), so both look the same.
// All sizes are in millimetres on an A4 landscape sheet (297 x 210).

/** A guilloche rosette: many thin rotated ellipses around one centre, like the security pattern on a banknote. */
export function rosette(cx: number, cy: number, rx: number, ry: number, count: number): string[] {
  const paths: string[] = []
  for (let k = 0; k < count; k++) {
    const a = (Math.PI * k) / count
    const ca = Math.cos(a), sa = Math.sin(a)
    let d = ''
    for (let i = 0; i <= 72; i++) {
      const t = (2 * Math.PI * i) / 72
      const x = rx * Math.cos(t), y = ry * Math.sin(t)
      d += `${i ? 'L' : 'M'}${(cx + x * ca - y * sa).toFixed(2)},${(cy + x * sa + y * ca).toFixed(2)}`
    }
    paths.push(d + 'Z')
  }
  return paths
}

/** Small marks round a circle (the edge of the seal). */
export function ring(cx: number, cy: number, r: number, count: number, size: number): string {
  let d = ''
  for (let i = 0; i < count; i++) {
    const a = (2 * Math.PI * i) / count
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a)
    d += `M${(x - size).toFixed(2)},${y.toFixed(2)}a${size},${size} 0 1,0 ${(2 * size).toFixed(2)},0a${size},${size} 0 1,0 ${(-2 * size).toFixed(2)},0`
  }
  return d
}

/** The words that run round the seal, one letter at a time (position and angle in degrees), for drawing without textPath. */
export function arcLetters(text: string, cx: number, cy: number, r: number, from: number, to: number): { ch: string; x: number; y: number; deg: number }[] {
  const chars = [...text]
  return chars.map((ch, i) => {
    const a = from + ((to - from) * (i + 0.5)) / chars.length // radians, 0 = right, clockwise in screen coordinates
    return { ch, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), deg: (a * 180) / Math.PI + 90 }
  })
}

// "30 Sep 2026" in India's time (written out: the en-IN locale now says "Sept", which looks wrong on a certificate)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const fmtCertDate = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso.length > 10 ? iso : `${iso}T00:00:00+05:30`)
  if (Number.isNaN(d.getTime())) return ''
  const ist = new Date(d.getTime() + 330 * 60_000)
  return `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`
}
export const durationText = (weeks: number | null, hours: number | null) => {
  const w = weeks ? (weeks % 4 === 0 && weeks >= 8 ? `${weeks / 4} months` : `${weeks} weeks`) : null
  return [w, hours ? `${hours} hours` : null].filter(Boolean).join(' · ')
}
