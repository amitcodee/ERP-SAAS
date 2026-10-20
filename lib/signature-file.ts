// Browser side: a signature photo (up to MAX_SIGNATURE_BYTES, e.g. straight from a phone camera) made small before it
// is uploaded. Every certificate page and PDF carries the image, so it is cut to 1200 px wide at most; a PNG stays a
// PNG (a transparent background is kept), a JPEG stays a JPEG. Small files go up as they are.
export const MAX_SIGNATURE_MB = 5
const MAX_WIDTH = 1200
const SMALL = 300 * 1024

export const shrinkSignature = (file: File) => shrinkImage(file, MAX_WIDTH)

/** The same for any image: at most maxWidth px wide (a full-page letterhead: 1800). */
export async function shrinkImage(file: File, maxWidth: number): Promise<File> {
  if (file.size <= SMALL || !/^image\/(png|jpeg)$/.test(file.type) || typeof createImageBitmap !== 'function') return file
  try {
    const img = await createImageBitmap(file)
    const scale = Math.min(1, maxWidth / img.width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, file.type, 0.9))
    return blob && blob.size < file.size ? new File([blob], file.name, { type: file.type }) : file
  } catch {
    return file // the server checks it anyway
  }
}
