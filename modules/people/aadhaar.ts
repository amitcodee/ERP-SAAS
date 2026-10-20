// Aadhaar numbers: 12 digits, the first is 2-9, the last is a Verhoeff check digit (catches a mistyped or swapped digit).
const D = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]]
const P = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]]

/** The 12 digits without spaces or dashes. */
export const cleanAadhaar = (v: string) => v.replace(/[\s-]/g, '')

export function isValidAadhaar(v: string): boolean {
  const s = cleanAadhaar(v)
  if (!/^[2-9]\d{11}$/.test(s)) return false
  let c = 0
  for (let i = 0; i < s.length; i++) c = D[c][P[i % 8][Number(s[s.length - 1 - i])]]
  return c === 0
}

/** "1234 5678 9012" */
export const formatAadhaar = (v: string) => cleanAadhaar(v).replace(/(\d{4})(?=\d)/g, '$1 ')
