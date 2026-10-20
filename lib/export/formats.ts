import 'server-only'
// A list as a file: Excel (.xlsx), CSV or PDF. No extra libraries: the .xlsx is a small zip of XML parts written here
// (Node's own deflate), the PDF a landscape table drawn with pdf-lib. Every cell that would start a formula is defused.
import { deflateRawSync } from 'node:zlib'
import { PDFDocument, rgb } from 'pdf-lib'
import { embedFaces, type Face } from '@/lib/pdf-fonts'

export type Cell = string | number | null | undefined
export type Column = { label: string; kind?: 'text' | 'money' | 'number' | 'date' | 'datetime'; width?: number }
export type Sheet = { title: string; subtitle?: string; columns: Column[]; rows: Cell[][] }

// ---- shared

/** A cell as text the way people read it: ₹ amounts, Indian digit grouping, dates as 13 Oct 2026. */
export function display(v: Cell, kind: Column['kind'] = 'text'): string {
  if (v == null || v === '') return ''
  if (kind === 'money') return '₹' + (Number(v) / 100).toLocaleString('en-IN', { minimumFractionDigits: Number(v) % 100 ? 2 : 0 })
  if (kind === 'number') return Number(v).toLocaleString('en-IN')
  if (kind === 'date') return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? new Date(`${String(v).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : String(v)
  if (kind === 'datetime') return new Date(String(v)).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
  return String(v)
}
/** Text that a spreadsheet would run as a formula (=, +, -, @, tab, CR at the start) gets a leading apostrophe. */
const defuse = (s: string) => (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s)

// ---- CSV (UTF-8 with BOM so Excel shows ₹ and Indian names right)

export function toCsv(s: Sheet): Buffer {
  const q = (x: string) => (/[",\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)
  const line = (cells: string[]) => cells.map((c) => q(defuse(c))).join(',')
  const body = [line(s.columns.map((c) => c.label)), ...s.rows.map((r) => line(r.map((v, i) => {
    const k = s.columns[i]?.kind
    // money as plain rupees (a number Excel can add up); other kinds as people read them
    return k === 'money' ? (v == null || v === '' ? '' : String(Number(v) / 100)) : k === 'number' ? (v == null ? '' : String(v)) : display(v, k)
  })))].join('\r\n')
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(body + '\r\n', 'utf8')])
}

// ---- XLSX: a zip of the few XML parts a workbook needs

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
function crc32(b: Buffer) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

function zip(files: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), comp = deflateRawSync(f.data), crc = crc32(f.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8)
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(f.data.length, 22)
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28)
    parts.push(local, name, comp)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10)
    cen.writeUInt32LE(0, 12); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(f.data.length, 24)
    cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42)
    central.push(cen, name)
    offset += 30 + name.length + comp.length
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, end])
}

const xml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
const colName = (i: number) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }
/** Excel's day number for a date (1900 system). */
const excelDay = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000 + 25569

export function toXlsx(s: Sheet): Buffer {
  // styles: 0 normal, 1 bold header, 2 money (₹ #,##,##0.00), 3 date, 4 whole number, 5 title
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;₹&quot;#,##,##0.00"/><numFmt numFmtId="165" formatCode="dd mmm yyyy"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF10186A"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF10186A"/></patternFill></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="6"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="165" applyNumberFormat="1"/><xf numFmtId="3" applyNumberFormat="1"/><xf fontId="2" applyFont="1"/></cellXfs>
</styleSheet>`
  const top = s.subtitle ? 2 : 1 // title row (+ subtitle row), then a blank row, then the header
  const headerRow = top + 2
  const cell = (r: number, c: number, v: Cell, kind: Column['kind']) => {
    const ref = `${colName(c)}${r}`
    if (v == null || v === '') return ''
    if (kind === 'money' && Number.isFinite(Number(v))) return `<c r="${ref}" s="2"><v>${Number(v) / 100}</v></c>`
    if (kind === 'number' && Number.isFinite(Number(v))) return `<c r="${ref}" s="4"><v>${Number(v)}</v></c>`
    if (kind === 'date' && /^\d{4}-\d{2}-\d{2}/.test(String(v))) return `<c r="${ref}" s="3"><v>${excelDay(String(v))}</v></c>`
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(defuse(display(v, kind)))}</t></is></c>`
  }
  const text = (r: number, v: string, st: number) => `<row r="${r}"><c r="A${r}" t="inlineStr" s="${st}"><is><t xml:space="preserve">${xml(v)}</t></is></c></row>`
  const widths = s.columns.map((c, i) => c.width ?? Math.min(48, Math.max(c.label.length + 2, ...s.rows.slice(0, 300).map((r) => display(r[i], c.kind).length + 2), 8)))
  const last = colName(s.columns.length - 1)
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${text(1, s.title, 5)}${s.subtitle ? text(2, s.subtitle, 0) : ''}<row r="${headerRow}">${s.columns.map((c, i) => `<c r="${colName(i)}${headerRow}" t="inlineStr" s="1"><is><t>${xml(c.label)}</t></is></c>`).join('')}</row>${
  s.rows.map((r, k) => `<row r="${headerRow + 1 + k}">${r.map((v, i) => cell(headerRow + 1 + k, i, v, s.columns[i]?.kind)).join('')}</row>`).join('')}</sheetData>
<autoFilter ref="A${headerRow}:${last}${headerRow + Math.max(s.rows.length, 1)}"/>
</worksheet>`
  const sheetName = xml(s.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1')
  return zip([
    { name: '[Content_Types].xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`) },
    { name: '_rels/.rels', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: 'xl/workbook.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${sheetName.replace(/'/g, "''")}'!$A$${headerRow}:$${last}$${headerRow + Math.max(s.rows.length, 1)}</definedName></definedNames></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: 'xl/styles.xml', data: Buffer.from(styles) },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet) },
  ])
}

// ---- PDF: landscape A4 table, header repeated on every page, page numbers

function fit(s: string, font: Face, size: number, w: number) {
  let t = s
  if (font.widthOfTextAtSize(t, size) <= w) return t
  while (t.length > 1 && font.widthOfTextAtSize(t + '...', size) > w) t = [...t].slice(0, -1).join('')
  return t + '...'
}

export async function toPdf(s: Sheet): Promise<Buffer> {
  const doc = await PDFDocument.create()
  doc.setTitle(s.title); doc.setCreator('techcadd ERP')
  const { sans: font, sansBold: bold } = await embedFaces(doc, ['sans', 'sansBold'])
  const W = 842, H = 595, M = 28, size = 7.5, rowH = 15
  const navy = rgb(0.063, 0.094, 0.416), line = rgb(0.88, 0.89, 0.94), zebra = rgb(0.965, 0.97, 0.99), muted = rgb(0.42, 0.45, 0.55)
  const cells = s.rows.map((r) => r.map((v, i) => display(v, s.columns[i]?.kind)))
  // column widths from the content, squeezed to the page width
  const want = s.columns.map((c, i) => Math.min(170, Math.max(bold.widthOfTextAtSize(c.label, size), ...cells.slice(0, 400).map((r) => font.widthOfTextAtSize(r[i] ?? '', size))) + 8))
  const total = want.reduce((a, b) => a + b, 0), avail = W - 2 * M
  const widths = want.map((w) => (total > avail ? (w * avail) / total : w))
  const right = s.columns.map((c) => c.kind === 'money' || c.kind === 'number')
  const made = display(new Date().toISOString(), 'datetime')
  let page = doc.addPage([W, H]), y = 0, n = 0
  const head = () => {
    bold.draw(page, s.title, { x: M, y: H - M - 4, size: 14, color: navy })
    font.draw(page, (`${s.subtitle ? s.subtitle + '  ·  ' : ''}${s.rows.length} row${s.rows.length === 1 ? '' : 's'}  ·  made ${made}`), { x: M, y: H - M - 20, size: 8, color: muted })
    y = H - M - 36
    page.drawRectangle({ x: M, y: y - rowH + 4, width: avail, height: rowH, color: navy })
    let x = M
    s.columns.forEach((c, i) => {
      const t = fit(c.label, bold, size, widths[i] - 6)
      bold.draw(page, t, { x: right[i] ? x + widths[i] - 4 - bold.widthOfTextAtSize(t, size) : x + 4, y: y - 6, size, color: rgb(1, 1, 1) })
      x += widths[i]
    })
    y -= rowH
  }
  const foot = () => font.draw(page, `techcadd  ·  page ${doc.getPageCount()}`, { x: W - M - 80, y: M - 14, size: 7, color: muted })
  head()
  for (const r of cells) {
    if (y - rowH < M) { foot(); page = doc.addPage([W, H]); head() }
    if (n++ % 2) page.drawRectangle({ x: M, y: y - rowH + 4, width: avail, height: rowH, color: zebra })
    let x = M
    r.forEach((v, i) => {
      const t = fit(v, font, size, widths[i] - 6)
      font.draw(page, t, { x: right[i] ? x + widths[i] - 4 - font.widthOfTextAtSize(t, size) : x + 4, y: y - 6, size })
      x += widths[i]
    })
    page.drawLine({ start: { x: M, y: y - rowH + 4 }, end: { x: M + avail, y: y - rowH + 4 }, thickness: 0.4, color: line })
    y -= rowH
  }
  if (!cells.length) font.draw(page, 'Nothing to show for these filters.', { x: M, y: y - 8, size: 9, color: muted })
  foot()
  return Buffer.from(await doc.save())
}
