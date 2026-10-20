import { readFile } from 'fs/promises'
import path from 'path'

// The face detector's WebAssembly runtime (used by the photo check on the registration page), served from this origin
// straight out of the installed package, so it always matches the library version and nothing is fetched from a CDN.
const FILES: Record<string, string> = { 'vision_wasm_internal.js': 'text/javascript', 'vision_wasm_internal.wasm': 'application/wasm' }

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  const type = FILES[file]
  if (!type) return new Response('Not found', { status: 404 })
  const body = await readFile(path.join(process.cwd(), 'node_modules', '@mediapipe', 'tasks-vision', 'wasm', file))
  return new Response(new Uint8Array(body), { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400' } })
}
