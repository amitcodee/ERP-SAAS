import 'server-only'
// A signature photographed or scanned on paper comes with its paper: a grey or white box around the ink. This makes the
// paper transparent and crops close to the ink, so only the signature shows on the certificate (page and PDF).
// The paper's shade is read from the image's edges; pixels as light as it become transparent, darker ones keep their
// colour with an opacity that grows with how much darker they are (smooth ink edges). Results are kept in memory.
import { createHash } from 'crypto'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'

const done = new Map<string, string>()

/** A data: URL of a PNG / JPEG signature -> a data: URL of a PNG with a transparent background (or the input, if unreadable). */
export function cleanSignature(dataUrl: string | null): string | null {
  if (!dataUrl) return dataUrl
  const m = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(dataUrl)
  if (!m) return dataUrl
  const key = createHash('sha1').update(dataUrl).digest('hex')
  const hit = done.get(key)
  if (hit) return hit
  let out = dataUrl
  try {
    const bytes = Buffer.from(m[2], 'base64')
    const img = m[1] === 'image/png' ? PNG.sync.read(bytes) : jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true })
    const { width: W, height: H } = img
    const px = img.data as Uint8Array
    const lum = (i: number) => 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
    // the paper: the median shade of the edge pixels (opaque ones)
    const edge: number[] = []
    const step = Math.max(1, Math.floor((W + H) / 400))
    for (let x = 0; x < W; x += step) for (const y of [0, 1, H - 2, H - 1]) { const i = (y * W + x) * 4; if (px[i + 3] > 200) edge.push(lum(i)) }
    for (let y = 0; y < H; y += step) for (const x of [0, 1, W - 2, W - 1]) { const i = (y * W + x) * 4; if (px[i + 3] > 200) edge.push(lum(i)) }
    if (edge.length < 8) { done.set(key, out); return out } // already transparent all round
    edge.sort((a, b) => a - b)
    const paper = edge[Math.floor(edge.length / 2)]
    const clear = paper - 28, solid = paper - 110 // lighter than clear: gone; darker than solid: fully ink
    let x0 = W, y0 = H, x1 = -1, y1 = -1
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const l = lum(i)
      const a = l >= clear ? 0 : l <= solid ? 255 : Math.round((255 * (clear - l)) / (clear - solid))
      px[i + 3] = Math.min(px[i + 3], a)
      if (px[i + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    }
    if (x1 < 0) { done.set(key, out); return out } // no ink found: leave it as it was
    const pad = Math.round(Math.min(W, H) * 0.02)
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad)
    const crop = new PNG({ width: x1 - x0 + 1, height: y1 - y0 + 1 })
    for (let y = y0; y <= y1; y++) Buffer.from(px.buffer, px.byteOffset + (y * W + x0) * 4, (x1 - x0 + 1) * 4).copy(crop.data, (y - y0) * crop.width * 4)
    out = `data:image/png;base64,${PNG.sync.write(crop).toString('base64')}`
  } catch {
    out = dataUrl
  }
  if (done.size > 50) done.clear()
  done.set(key, out)
  return out
}
