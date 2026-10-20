// Branch codes come from the branch's city, never typed by hand. Shared by the server (which decides) and the
// add-branch form (which previews). The code prefixes every enquiry, registration, receipt and certificate number.

/** Usual short forms for cities we operate in; anything else is derived from the letters of the name. */
const KNOWN: Record<string, string> = {
  ludhiana: 'LDH', jalandhar: 'JAL', amritsar: 'ASR', chandigarh: 'CHD', mohali: 'MOH', hoshiarpur: 'HSP',
  phagwara: 'PGW', patiala: 'PTA', bathinda: 'BTI', delhi: 'DEL', 'new delhi': 'DEL', panchkula: 'PKL',
  kapurthala: 'KPT', pathankot: 'PTK', moga: 'MOG', ferozepur: 'FZR', zirakpur: 'ZRK', kharar: 'KHR',
}

/** "Ludhiana" -> "LDH"; unknown "Nawanshahr" -> "NWN" (first letter + next two consonants). */
export function codeForCity(city: string): string {
  const key = city.trim().toLowerCase().replace(/\s+/g, ' ')
  if (KNOWN[key]) return KNOWN[key]
  const letters = key.toUpperCase().replace(/[^A-Z]/g, '')
  if (letters.length < 2) return ''
  const consonants = letters.slice(1).replace(/[AEIOU]/g, '')
  const code = (letters[0] + consonants).slice(0, 3)
  return code.length === 3 ? code : letters.slice(0, 3)
}

/** First free code: LDH, then LDH2, LDH3 ... (max 6 characters, matching the code rule). */
export function nextFreeCode(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((c) => c.toUpperCase()))
  if (!used.has(base)) return base
  for (let n = 2; n < 1000; n++) {
    const c = `${base}${n}`.slice(0, 6)
    if (!used.has(c)) return c
  }
  throw new Error('No free branch code left for this city')
}
