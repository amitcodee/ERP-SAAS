import 'server-only'
// Server-generated PDFs for receipts and certificates (the HTML pages remain for on-screen printing).
// Unicode fonts (lib/pdf-fonts.ts): amounts carry "₹" and Punjabi / Hindi names print as written.
import { LineCapStyle, PDFDocument, rgb, type PDFImage, type PDFPage, type RGB } from 'pdf-lib'
import { embedFaces, inrPdf, type Face } from '@/lib/pdf-fonts'
import QRCode from 'qrcode'
import { qrPath, type CertFont, type CertOp } from '@/lib/cert-course'
import { rupeesInWords } from '@/lib/money'
import { paymentChannel } from '@/modules/fees/plan'
import type { ReceiptView } from '@/modules/fees/service'
import type { Brand } from '@/lib/brand'
import { PRODUCT } from '@/lib/product'

const MM = 72 / 25.4
const rs = inrPdf
const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255)

function drawQr(page: PDFPage, text: string, x: number, y: number, size: number, color = rgb(0.07, 0.09, 0.15)) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const n = qr.modules.size
  const cell = size / n
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (qr.modules.get(r, c)) page.drawRectangle({ x: x + c * cell, y: y + size - (r + 1) * cell, width: cell + 0.05, height: cell + 0.05, color })
}

function text(page: PDFPage, s: string, x: number, y: number, font: Face, size: number, opts: { color?: RGB; align?: 'left' | 'center' | 'right'; maxWidth?: number } = {}) {
  let str = s
  if (opts.maxWidth && font.widthOfTextAtSize(str, size) > opts.maxWidth) {
    while (str.length > 1 && font.widthOfTextAtSize(str + '...', size) > opts.maxWidth) str = [...str].slice(0, -1).join('')
    str += '...'
  }
  const w = font.widthOfTextAtSize(str, size)
  const dx = opts.align === 'center' ? -w / 2 : opts.align === 'right' ? -w : 0
  font.draw(page, str, { x: x + dx, y, size, color: opts.color ?? rgb(0.07, 0.09, 0.15) })
}

/** A PNG / JPEG data URL embedded, or null (another format: left out). */
async function embedDataImage(doc: PDFDocument, src: string | null): Promise<PDFImage | null> {
  const m = src ? /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(src) : null
  if (!m) return null
  return (m[1] === 'image/png' ? doc.embedPng(Buffer.from(m[2], 'base64')) : doc.embedJpg(Buffer.from(m[2], 'base64'))).catch(() => null)
}

/** A5 landscape fee receipt, same content as the printable page, under the institute's logo (or its name). */
export async function receiptPdf(r: ReceiptView, verifyUrl: string, brand: Pick<Brand, 'name' | 'logo'>): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`Receipt ${r.receiptNo}`); doc.setAuthor(brand.name); doc.setCreator(PRODUCT.name)
  const page = doc.addPage([210 * MM, 148 * MM])
  const { width: W, height: H } = page.getSize()
  const { sans: reg, sansBold: bold, sansItalic: ital } = await embedFaces(doc, ['sans', 'sansBold', 'sansItalic'])
  const grey = rgb(0.42, 0.45, 0.5)
  const L = 12 * MM, R = W - 12 * MM
  let y = H - 16 * MM

  const channel = paymentChannel(r.mode)
  const online = channel === 'online'
  // Watermark, drawn first so that everything else is on top of it.
  if (r.reversal) {
    // a reversed payment: the receipt is kept, plainly marked as no longer counting
    const word = r.reversal.kind === 'refund' ? 'REFUNDED' : 'CANCELLED'
    bold.draw(page, word, { x: W / 2 - 130, y: H / 2 - 60, size: 62, color: rgb(0.86, 0.15, 0.15), opacity: 0.28, rotate: 24 })
    text(page, `${word} ${new Date(r.reversal.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}: ${r.reversal.reason}`.slice(0, 140), L, 8 * MM, bold, 8, { color: rgb(0.7, 0.1, 0.2) })
  } else bold.draw(page, 'NON-REFUNDABLE', { x: W / 2 - 150, y: H / 2 - 75, size: 46, color: rgb(0.86, 0.15, 0.15), opacity: 0.09, rotate: 24 })

  const logo = await embedDataImage(doc, brand.logo)
  if (logo) {
    const s = Math.min((60 * MM) / logo.width, (11 * MM) / logo.height)
    page.drawImage(logo, { x: L, y: y - 2, width: logo.width * s, height: logo.height * s })
  } else text(page, brand.name, L, y, bold, 18, { maxWidth: 110 * MM })
  text(page, online ? 'E-RECEIPT' : 'FEE RECEIPT', R, y, bold, 14, { align: 'right' })
  text(page, online ? 'ONLINE PAYMENT' : channel === 'cheque' ? 'OFFLINE - CHEQUE / DRAFT' : 'OFFLINE - CASH', R, y + 13, bold, 7, { align: 'right', color: online ? rgb(0.11, 0.31, 0.85) : grey })
  y -= 14
  text(page, r.branchName, L, y, bold, 10)
  text(page, `No. ${r.receiptNo}`, R, y, reg, 10, { align: 'right' })
  y -= 12
  if (r.branchAddress) { text(page, r.branchAddress, L, y, reg, 8.5, { color: grey, maxWidth: 110 * MM }) }
  text(page, `Date: ${new Date(r.paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })}`, R, y, reg, 10, { align: 'right' })
  y -= 11
  const contact = [r.branchPhone && `Ph: ${r.branchPhone}`, r.gstin && `GSTIN: ${r.gstin}`].filter(Boolean).join('   ')
  if (contact) text(page, contact, L, y, reg, 8.5, { color: grey })
  y -= 8
  page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 1.5 })

  const rows = (items: [string, string, boolean?][], x: number, top: number) => {
    let yy = top
    for (const [k, v, strong] of items) {
      text(page, k, x, yy, reg, 9, { color: grey })
      const f = strong ? bold : reg, max = 56 * MM
      let size = 9.5 // long course names: shrink to fit first, cut only below 7pt
      while (size > 7 && f.widthOfTextAtSize(v, size) > max) size -= 0.25
      text(page, v, x + 34 * MM, yy, f, size, { maxWidth: max })
      yy -= 15
    }
  }
  y -= 18
  rows([
    ['Received from', r.studentName, true], ['Registration ID', r.regNo], ['Course', r.course], ['Contact', r.phone],
    ['Mode of payment', r.mode + (r.txnRef ? ` (${online ? 'Txn' : channel === 'cheque' ? 'Chq' : 'Slip'} ${r.txnRef})` : '')],
  ], L, y)
  rows([
    ['Total course fee', rs(r.charged)], ...(r.discounted > 0 ? [['Discount', '- ' + rs(r.discounted)] as [string, string]] : []),
    ['Paid till date', rs(r.paidToDate)], ['Balance after this', r.balanceAfter > 0 ? rs(r.balanceAfter) : 'Nil - fully paid', true],
  ], W / 2 + 4 * MM, y)

  const boxY = 30 * MM
  page.drawRectangle({ x: L, y: boxY, width: R - L, height: 24 * MM, color: rgb(0.953, 0.957, 0.965) })
  text(page, 'Amount received', L + 5 * MM, boxY + 18 * MM, reg, 8.5, { color: grey })
  text(page, rs(r.amount), L + 5 * MM, boxY + 10 * MM, bold, 18)
  text(page, rupeesInWords(r.amount), L + 5 * MM, boxY + 4 * MM, ital, 8.5, { maxWidth: 140 * MM })
  drawQr(page, verifyUrl, R - 23 * MM, boxY + 3 * MM, 18 * MM)
  text(page, 'Scan to verify', R - 14 * MM, boxY - 3.5 * MM, reg, 7, { color: grey, align: 'center' })

  text(page, `Received by: ${r.receivedBy ?? '-'}`, L, 16 * MM, reg, 8.5, { color: grey })
  text(page, `Fees once paid are non-refundable and non-transferable.${channel === 'cheque' ? ' Subject to the cheque / draft being cleared.' : ''}`, L, 12 * MM, bold, 8.5, { color: rgb(0.73, 0.11, 0.11) })
  if (online) {
    // an e-receipt is made by the system and carries no signature
    text(page, 'Computer-generated e-receipt for an online payment.', R, 16 * MM, reg, 8, { color: grey, align: 'right' })
    text(page, 'Valid without a signature; scan the code to verify it.', R, 12 * MM, reg, 8, { color: grey, align: 'right' })
  } else {
    page.drawLine({ start: { x: R - 50 * MM, y: 17 * MM }, end: { x: R, y: 17 * MM }, thickness: 0.8 })
    text(page, 'Authorised signatory', R - 25 * MM, 12.5 * MM, reg, 8.5, { align: 'center' })
  }
  return doc.save()
}

export type CertPdfData = {
  name: string; course: string; branch: string; certNo: string; issuedAt: string; revoked: boolean
  department: string; joined: string; ended: string | null; durationWeeks: number | null; hours: number | null; modules: string[]; toolsLabel?: string
}





/** Draws a certificate layout (lib/cert-course.ts, lib/cert-project.ts) on an A4 landscape page: the same shapes as the page's SVG. */
async function drawCertOps(doc: PDFDocument, page: PDFPage, ops: CertOp[]) {
  const H = page.getHeight()
  // only the fonts the layout uses
  const faces = await embedFaces(doc, [...new Set(ops.flatMap((o) => (o.k === 'text' || o.k === 'glyph' ? [o.font] : [])))] as CertFont[])
  const images = new Map<string, PDFImage>()
  const image = async (src: string) => {
    if (!images.has(src)) {
      const data = src.startsWith('data:') ? await embedDataImage(doc, src) : null
      if (data) images.set(src, data)
      else if (/^\/[\w/.-]+\.(png|jpe?g)$/.test(src) && !src.includes('..')) {
        const { readFile } = await import('fs/promises')
        const { join, resolve, sep } = await import('path')
        // only files under public/ (a path that climbs out is refused, whoever wrote it)
        const root = resolve(process.cwd(), 'public'), file = resolve(join(root, ...src.slice(1).split('/')))
        if (!file.startsWith(root + sep)) return null
        const bytes = await readFile(file)
        images.set(src, /\.png$/.test(src) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes))
      } else return null // a format the PDF cannot hold: left out, as a blank space to sign by hand
    }
    return images.get(src)!
  }
  const svg = (d: string, o: { color?: RGB; borderColor?: RGB; borderWidth?: number; opacity?: number; borderOpacity?: number; borderLineCap?: LineCapStyle }) => page.drawSvgPath(d, { x: 0, y: H, scale: MM, ...o })
  for (const o of ops) {
    if (o.k === 'path') {
      svg(o.d, {
        ...(o.fill ? { color: hex(o.fill), opacity: o.opacity } : {}),
        ...(o.stroke ? { borderColor: hex(o.stroke), borderWidth: o.sw, borderOpacity: o.opacity, ...(o.round ? { borderLineCap: LineCapStyle.Round } : {}) } : {}),
      })
    } else if (o.k === 'text') {
      const f = faces[o.font], size = o.size * MM, color = hex(o.fill)
      if (!o.track) f.draw(page, o.s, { x: o.x * MM, y: H - o.y * MM, size, color })
      else { let x = o.x * MM; for (const ch of o.s) { f.draw(page, ch, { x, y: H - o.y * MM, size, color }); x += f.widthOfTextAtSize(ch, size) + o.track * size } }
    } else if (o.k === 'glyph') {
      // centred on (x, y) and turned: the same offset (-w/2, +0.35 size) the page uses, rotated
      const f = faces[o.font], size = o.size * MM, rad = (o.rot * Math.PI) / 180
      const dx = -o.w / 2, dy = o.size * 0.35
      const x = o.x + dx * Math.cos(rad) - dy * Math.sin(rad), y = o.y + dx * Math.sin(rad) + dy * Math.cos(rad)
      f.draw(page, o.ch, { x: x * MM, y: H - y * MM, size, color: hex(o.fill), rotate: -o.rot })
    } else if (o.k === 'img') {
      const img = await image(o.src)
      if (!img) continue
      const s = Math.min(o.w / img.width, o.h / img.height), w = o.stretch ? o.w : img.width * s, h = o.stretch ? o.h : img.height * s
      page.drawImage(img, { x: (o.x + (o.left ? 0 : (o.w - w) / 2)) * MM, y: H - (o.y + o.h) * MM, width: w * MM, height: h * MM, ...(o.opacity !== undefined ? { opacity: o.opacity } : {}) })
    } else if (o.k === 'qr') svg(qrPath(o.text, o.x, o.y, o.size), { color: hex(o.fill) })
  }
}

/** A layout made in Certificate Designs (lib/cert-design-ops.ts) as a one-page PDF, A4 landscape or portrait. */
export async function layoutPdf(title: string, ops: CertOp[], portrait = false, author = ''): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(title); doc.setAuthor(author); doc.setCreator(PRODUCT.name)
  await drawCertOps(doc, doc.addPage(portrait ? [210 * MM, 297 * MM] : [297 * MM, 210 * MM]), ops)
  return doc.save()
}

/**
 * The certificate as a PDF, in the same two designs as the printable page: the course completion certificate
 * (kind 'course') or the project completion certificate (kind 'project'). A revoked one carries a REVOKED watermark.
 */
export async function certificatePdf(v: CertPdfData, _hash: string, _verifyUrl: string, kind: 'course' | 'project' = 'course', ops: CertOp[] = [], author = '', portrait = false): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`${kind === 'project' ? 'Project certificate' : 'Certificate'} ${v.certNo}`); doc.setAuthor(author); doc.setCreator(PRODUCT.name)
  const page = doc.addPage(portrait ? [210 * MM, 297 * MM] : [297 * MM, 210 * MM]) // the institute's own design may be portrait
  const { width: W, height: H } = page.getSize()
  await drawCertOps(doc, page, ops)
  if (v.revoked) {
    const { sansBold } = await embedFaces(doc, ['sansBold'])
    sansBold.draw(page, 'REVOKED', { x: W / 2 - 105 * MM, y: H / 2 - 45 * MM, size: 120, color: rgb(0.86, 0.15, 0.15), opacity: 0.22, rotate: 20 })
  }
  return doc.save()
}
