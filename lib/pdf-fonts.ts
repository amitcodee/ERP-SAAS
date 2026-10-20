import 'server-only'
// Unicode fonts for the server-made PDFs (receipts, certificates, list exports): Noto Sans / Serif (and Poppins for the
// course completion certificate) for Latin and "₹",
// with Noto Sans Gurmukhi and Devanagari for Punjabi and Hindi names. A line is cut into runs by script and each run
// drawn in the font that has it. Fonts: public/fonts/pdf (SIL OFL; the Latin ones trimmed with fontTools pyftsubset).
// fontkit's Indic shaping (syllables for Gurmukhi / Devanagari) is compiled with generators that need this global
import 'regenerator-runtime/runtime'
import fontkit from '@pdf-lib/fontkit'
import { degrees, type PDFDocument, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'

type Script = 'latin' | 'gurmukhi' | 'devanagari'
const FILES = {
  sans: { latin: 'NotoSans-Regular', gurmukhi: 'NotoSansGurmukhi-Regular', devanagari: 'NotoSansDevanagari-Regular' },
  sansBold: { latin: 'NotoSans-Bold', gurmukhi: 'NotoSansGurmukhi-Bold', devanagari: 'NotoSansDevanagari-Bold' },
  sansItalic: { latin: 'NotoSans-Italic', gurmukhi: 'NotoSansGurmukhi-Regular', devanagari: 'NotoSansDevanagari-Regular' },
  serif: { latin: 'NotoSerif-Regular', gurmukhi: 'NotoSansGurmukhi-Regular', devanagari: 'NotoSansDevanagari-Regular' },
  // Poppins, for the course completion certificate (lib/cert-course.ts)
  light: { latin: 'Poppins-Light', gurmukhi: 'NotoSansGurmukhi-Regular', devanagari: 'NotoSansDevanagari-Regular' },
  regular: { latin: 'Poppins-Regular', gurmukhi: 'NotoSansGurmukhi-Regular', devanagari: 'NotoSansDevanagari-Regular' },
  medium: { latin: 'Poppins-Medium', gurmukhi: 'NotoSansGurmukhi-Regular', devanagari: 'NotoSansDevanagari-Regular' },
  semibold: { latin: 'Poppins-SemiBold', gurmukhi: 'NotoSansGurmukhi-Bold', devanagari: 'NotoSansDevanagari-Bold' },
  bold: { latin: 'Poppins-Bold', gurmukhi: 'NotoSansGurmukhi-Bold', devanagari: 'NotoSansDevanagari-Bold' },
  extrabold: { latin: 'Poppins-ExtraBold', gurmukhi: 'NotoSansGurmukhi-Bold', devanagari: 'NotoSansDevanagari-Bold' },
  // Great Vibes, the handwriting of the designs made in Certificate Designs
  script: { latin: 'GreatVibes-Regular', gurmukhi: 'NotoSansGurmukhi-Regular', devanagari: 'NotoSansDevanagari-Regular' },
} as const
export type FaceName = keyof typeof FILES

const bytes = new Map<string, Promise<Uint8Array>>()
const fontFile = (name: string) => {
  if (!bytes.has(name)) bytes.set(name, (async () => {
    const { readFile } = await import('fs/promises')
    const { join } = await import('path')
    return new Uint8Array(await readFile(join(process.cwd(), 'public', 'fonts', 'pdf', `${name}.ttf`)))
  })())
  return bytes.get(name)!
}
// which characters the Latin fonts can draw (anything else prints as "?")
const covers = new Map<string, Promise<(cp: number) => boolean>>()
const coverage = (name: string) => {
  if (!covers.has(name)) covers.set(name, fontFile(name).then((b) => { const f = fontkit.create(b as Buffer); return (cp: number) => f.hasGlyphForCodePoint(cp) }))
  return covers.get(name)!
}

const scriptOf = (cp: number): Script | null =>
  cp >= 0x0a00 && cp <= 0x0a7f ? 'gurmukhi'
  : (cp >= 0x0900 && cp <= 0x097f) || (cp >= 0xa8e0 && cp <= 0xa8ff) || (cp >= 0x1cd0 && cp <= 0x1cff) ? 'devanagari'
  : cp === 0x20 || cp === 0x200c || cp === 0x200d ? null // spaces and joiners stay with the run they are in
  : 'latin'

/** A font face that draws any mix of Latin, ₹, Gurmukhi and Devanagari; same calls as pdf-lib's PDFFont where it matters. */
export class Face {
  constructor(private fonts: Record<Script, PDFFont>, private hasLatin: (cp: number) => boolean) {}

  /** The text cut into runs of one script each, with characters no font has turned into "?". */
  runs(s: string): { script: Script; text: string }[] {
    const out: { script: Script; text: string }[] = []
    for (const ch of s.replace(/[\u0000-\u001f\u007f]/g, ' ')) {
      const cp = ch.codePointAt(0)!
      let script = scriptOf(cp)
      let c = ch
      if (script === 'latin' && !this.hasLatin(cp)) c = '?'
      script ??= out.at(-1)?.script ?? 'latin'
      const last = out.at(-1)
      if (last?.script === script) last.text += c
      else out.push({ script, text: c })
    }
    return out
  }

  widthOfTextAtSize(s: string, size: number) {
    return this.runs(s).reduce((w, r) => w + this.fonts[r.script].widthOfTextAtSize(r.text, size), 0)
  }

  heightAtSize(size: number) { return this.fonts.latin.heightAtSize(size) }

  draw(page: PDFPage, s: string, o: { x: number; y: number; size: number; color?: RGB; rotate?: number; opacity?: number }) {
    const rad = ((o.rotate ?? 0) * Math.PI) / 180
    let x = o.x, y = o.y
    for (const r of this.runs(s)) {
      const font = this.fonts[r.script]
      page.drawText(r.text, { x, y, size: o.size, font, color: o.color, opacity: o.opacity, ...(o.rotate ? { rotate: degrees(o.rotate) } : {}) })
      const w = font.widthOfTextAtSize(r.text, o.size)
      x += w * Math.cos(rad); y += w * Math.sin(rad)
    }
  }
}

// pdf-lib draws the shaped glyphs (GSUB: conjuncts, vowel signs in place) with their advance widths and never uses
// GPOS offsets, while fontkit's GPOS code crashes on a null mark anchor (legal OpenType, found in the Indic fonts).
// The fonts are therefore read without their GPOS table: same output, no crash.
const pdfFontkit = { create: (buf: Uint8Array, name?: string) => { const f = fontkit.create(buf as Buffer, name) as unknown as { directory: { tables: Record<string, unknown> } }; delete f.directory.tables.GPOS; return f } } as unknown as typeof fontkit

/** Embeds the faces a document asks for (each subset to the glyphs it draws). */
export async function embedFaces<K extends FaceName>(doc: PDFDocument, names: K[]): Promise<Record<K, Face>> {
  doc.registerFontkit(pdfFontkit)
  const out = {} as Record<K, Face>
  for (const name of names) {
    const files = FILES[name]
    // pdf-lib's subsetting drops Latin glyphs from these fonts, and a whole font gives no width to a glyph made by
    // shaping (Indic conjuncts and vowel signs). So: the Latin fonts whole (trimmed beforehand to Latin, punctuation
    // and ₹, ~30 KB; no ligatures, so every glyph drawn has its width), the Indic fonts subset to what is drawn.
    const whole = async (file: string) => doc.embedFont(await fontFile(file), { subset: false, features: { liga: false, clig: false } })
    const subset = async (file: string) => doc.embedFont(await fontFile(file), { subset: true })
    out[name] = new Face({ latin: await whole(files.latin), gurmukhi: await subset(files.gurmukhi), devanagari: await subset(files.devanagari) }, await coverage(files.latin))
  }
  return out
}

/** Money in rupees with the ₹ sign, Indian grouping (₹1,25,000), paise only when there are some. */
export const inrPdf = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0 })
