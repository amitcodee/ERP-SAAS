/** Canonical phone key: last 10 digits (drops +91 / 0 prefixes, spaces, dashes). */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.length > 10 ? digits.slice(-10) : digits
}
export const isValidPhone = (raw: string) => normalizePhone(raw).length === 10
/** A real Indian mobile number: 10 digits starting 6-9, not one digit repeated. Used for leads typed by strangers (website forms). */
export const isMobile = (raw: string | null | undefined) => {
  if (!raw) return false
  const digits = raw.replace(/\D/g, '')
  const n = normalizePhone(raw)
  // More than one number typed in the box (e.g. "98xxxxxxxx / 97xxxxxxxx") is not one mobile number.
  if (digits.length > 12) return false
  return /^[6-9]\d{9}$/.test(n) && !/^(\d)\1{9}$/.test(n)
}
