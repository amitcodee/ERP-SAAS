// The server's own secrets (AUTH_SECRET, CERT_SECRET, CRON_SECRET), checked wherever they are read. A short or
// placeholder value would let anyone forge sign-ins, certificates or job calls, so it stops the panel instead.
// Edge-safe (no Node imports): proxy.ts verifies sessions with it.

export const MIN_SECRET_LENGTH = 32

/** The value of `name`, or throws when it is missing, shorter than 32 characters, or the example's placeholder. */
export function serverSecret(name: 'AUTH_SECRET' | 'CERT_SECRET' | 'CRON_SECRET'): string {
  const s = process.env[name]?.trim()
  if (!s || s.length < MIN_SECRET_LENGTH || /^(changeme|generate-with|replace-me|your-)/i.test(s)) {
    throw new Error(`${name} is not set to a real secret (at least ${MIN_SECRET_LENGTH} random characters: openssl rand -base64 32)`)
  }
  return s
}
