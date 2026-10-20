'use server'
// The public "Verify a certificate" form (/verify): the number and the answer to the drawn sum. Limited per connection,
// each sum works once; a wrong answer or no match hands back a new sum.
import { headers } from 'next/headers'
import { clientIpFrom } from '@/lib/client-ip'
import { underLimit } from '@/lib/redis'
import { checkPuzzle, makePuzzle, type Puzzle } from '@/lib/verify-puzzle'
import { findCertificateByNumber } from '@/modules/certificates/service'
import { requireRequestOrg } from '@/lib/tenant/request'

export type FindResult = { ok: true; href: string } | { ok: false; error: string; puzzle: Puzzle }

export async function findCertificateAction(number: string, answer: string, token: string): Promise<FindResult> {
  const ip = clientIpFrom(await headers())
  const who = ip && ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip ?? 'unknown'
  if (!(await underLimit(`verify-find:${who}`, 20, 600))) return { ok: false, error: 'Too many searches from this connection: please try again in a few minutes', puzzle: makePuzzle() }
  if (!(await checkPuzzle(String(token), String(answer)))) return { ok: false, error: 'The answer to the sum is not right (or it was used already): solve the new one', puzzle: makePuzzle() }
  const found = await findCertificateByNumber((await requireRequestOrg()).id, String(number ?? ''))
  if (!found) return { ok: false, error: 'No certificate was found for this number. Check it is typed exactly as printed (e.g. TCD/4002/123 or CERT-MOH-2026-0002).', puzzle: makePuzzle() }
  return { ok: true, href: found.href }
}

/** A different sum (the refresh button); limited like the search. */
export async function newPuzzleAction(): Promise<Puzzle | null> {
  const ip = clientIpFrom(await headers())
  const who = ip && ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip ?? 'unknown'
  return (await underLimit(`verify-puzzle-new:${who}`, 30, 600)) ? makePuzzle() : null
}
