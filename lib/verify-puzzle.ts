import 'server-only'
// The little sum on the public "Verify a certificate" page (/verify): it keeps scripts from running through every
// registration number. The question is drawn as letter outlines (no text a script can read off the page), each
// character turned a little, over a few stray lines. Its answer travels signed in a token (no server state); a token
// lasts 10 minutes and is accepted once (lib/redis.ts).
import { createHmac, randomInt, timingSafeEqual } from 'crypto'
import { serverSecret } from '@/lib/auth/secret'
import { certTextPath, certWidth } from '@/lib/cert-course'
import { underLimit } from '@/lib/redis'

const LIFE_MS = 10 * 60_000
const sign = (s: string) => createHmac('sha256', serverSecret('AUTH_SECRET')).update(`verify-puzzle|${s}`).digest('base64url')

export type Puzzle = { token: string; svg: string }

/** A new sum ("7 + 5 = ?"), drawn, with its signed token. */
export function makePuzzle(): Puzzle {
  const a = randomInt(2, 10), b = randomInt(1, 10), plus = randomInt(0, 2) === 0 || a <= b
  const answer = plus ? a + b : a - b
  const exp = Date.now() + LIFE_MS, nonce = randomInt(1e9, 1e10).toString(36)
  const token = `${exp}.${nonce}.${sign(`${answer}|${exp}|${nonce}`)}`
  // draw "a + b = ?" glyph by glyph, each turned and nudged
  const chars = `${a} ${plus ? '+' : '−'} ${b} = ?`.split('')
  let x = 6, paths = ''
  for (const ch of chars) {
    if (ch === ' ') { x += 5; continue }
    const size = 15 + randomInt(0, 4), w = certWidth(ch === '−' ? '-' : ch, 'bold', size)
    const d = certTextPath({ k: 'glyph', x: x + w / 2, y: 22 + randomInt(-2, 3), ch: ch === '−' ? '-' : ch, font: 'bold', size, fill: '#1d2470', rot: randomInt(-18, 19), w })
    if (d) paths += `<path d="${d}" fill="#1d2470"/>`
    x += w + 2
  }
  let noise = ''
  for (let i = 0; i < 5; i++) noise += `<path d="M${randomInt(0, 20)},${randomInt(4, 36)} Q${randomInt(30, 90)},${randomInt(0, 40)} ${randomInt(100, 140)},${randomInt(4, 36)}" stroke="#94a3b8" stroke-width="0.7" fill="none" opacity="0.7"/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(x + 6)} 40" role="img" aria-label="A sum to solve">${noise}${paths}</svg>`
  return { token, svg }
}

/** True once for a right answer to a live token; false for a wrong answer, an old token or one already used. */
export async function checkPuzzle(token: string, answer: string): Promise<boolean> {
  const m = /^(\d{13})\.([0-9a-z]{4,12})\.([\w-]{43})$/.exec(token ?? '')
  const n = Number(String(answer ?? '').trim())
  if (!m || !Number.isInteger(n) || Number(m[1]) < Date.now()) return false
  const want = Buffer.from(sign(`${n}|${m[1]}|${m[2]}`)), got = Buffer.from(m[3])
  if (want.length !== got.length || !timingSafeEqual(want, got)) return false
  return underLimit(`verify-puzzle:${m[2]}`, 1, LIFE_MS / 1000) // each puzzle works once
}
