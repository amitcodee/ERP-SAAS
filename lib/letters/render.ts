// Filling a letter template and turning its simple formatting into blocks to draw (no HTML is ever injected).

export type Inline = { text: string; bold?: boolean; missing?: boolean }
export type Block =
  | { type: 'h1'; lines: Inline[][] } | { type: 'h2'; lines: Inline[][] } | { type: 'p'; lines: Inline[][] }
  | { type: 'ol'; items: Inline[][] } | { type: 'ul'; items: Inline[][] }

/** Replaces each {{variable}}; an unknown or empty one becomes a marked gap ⟦name⟧ so it is easy to spot. */
export function fill(template: string, vars: Record<string, string | null | undefined>): string {
  return template.replace(/\{\{\s*([A-Za-z_]+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k]
    return v != null && String(v).trim() !== '' ? String(v) : `⟦${k}⟧`
  })
}

/** **bold** and gaps, inside one line. */
function inline(line: string): Inline[] {
  const out: Inline[] = []
  const re = /\*\*(.+?)\*\*|⟦([A-Za-z_]+)⟧/g
  let last = 0
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) out.push({ text: line.slice(last, m.index) })
    out.push(m[1] != null ? { text: m[1], bold: true } : { text: `missing: ${m[2]}`, missing: true })
    last = re.lastIndex
  }
  if (last < line.length) out.push({ text: line.slice(last) })
  return out
}

/** The filled text as headings, paragraphs (lines kept) and numbered / bulleted lists. */
export function toBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  let list: { type: 'ol' | 'ul'; items: string[] } | null = null
  const flushPara = () => { if (para.length) blocks.push({ type: 'p', lines: para.map(inline) }); para = [] }
  const flushList = () => { if (list) blocks.push(list.type === 'ol' ? { type: 'ol', items: list.items.map(inline) } : { type: 'ul', items: list.items.map(inline) }); list = null }
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) { flushPara(); flushList(); continue }
    const h = /^(#{1,2})\s+(.*)$/.exec(line)
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    const ul = /^\s*[-•*]\s+(.*)$/.exec(line)
    if (h) { flushPara(); flushList(); blocks.push(h[1].length === 1 ? { type: 'h1', lines: [inline(h[2])] } : { type: 'h2', lines: [inline(h[2])] }) }
    else if (ol || ul) {
      flushPara()
      const type = ol ? 'ol' : 'ul'
      if (list && list.type !== type) flushList()
      list ??= { type, items: [] }
      list.items.push((ol ?? ul)![1])
    } else { flushList(); para.push(line.trim()) }
  }
  flushPara(); flushList()
  return blocks
}

const ORD = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`
/** '2026-01-01' -> '1st January 2026' */
export const longDate = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  return `${ORD(d.getUTCDate())} ${d.toLocaleDateString('en-IN', { month: 'long', timeZone: 'UTC' })} ${d.getUTCFullYear()}`
}
/** '2026-01-01' -> 'January 2026' */
export const monthYear = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '')
const WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
/** 2026-01-01 .. 2026-06-30 -> 'six months' (or weeks when shorter than a month). */
export function durationWords(from: string | null | undefined, to: string | null | undefined) {
  if (!from || !to) return ''
  const a = new Date(`${from}T00:00:00Z`), b = new Date(`${to}T00:00:00Z`)
  b.setUTCDate(b.getUTCDate() + 1)
  const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + (b.getUTCDate() - a.getUTCDate()) / 30
  const m = Math.round(months)
  if (m >= 1) return `${WORDS[m] ?? m} month${m === 1 ? '' : 's'}`
  const w = Math.max(1, Math.round((b.getTime() - a.getTime()) / (7 * 86400000)))
  return `${WORDS[w] ?? w} week${w === 1 ? '' : 's'}`
}
