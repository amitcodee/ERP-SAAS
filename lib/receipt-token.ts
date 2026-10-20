import { createHmac, timingSafeEqual } from 'crypto'
import { serverSecret } from './auth/secret'

const key = () => serverSecret('CERT_SECRET')
const mac = (receiptNo: string, paymentId: string, amount: number) =>
  createHmac('sha256', key()).update(`receipt|${receiptNo}|${paymentId}|${amount}`).digest('hex').slice(0, 24)

/** Public proof-of-authenticity token embedded in the receipt QR: "<receiptNo>.<hmac>". */
export const receiptToken = (receiptNo: string, paymentId: string, amount: number) => `${receiptNo}.${mac(receiptNo, paymentId, amount)}`

export function parseReceiptToken(token: string): { receiptNo: string; mac: string } | null {
  const i = token.lastIndexOf('.')
  if (i < 1) return null
  const receiptNo = token.slice(0, i), m = token.slice(i + 1)
  return /^RCP-[A-Z0-9]+-\d{4}-\d{2}-\d{5}$/.test(receiptNo) && /^[0-9a-f]{24}$/.test(m) ? { receiptNo, mac: m } : null
}

export const receiptTokenValid = (receiptNo: string, paymentId: string, amount: number, given: string) => {
  const a = Buffer.from(mac(receiptNo, paymentId, amount)), b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
}
