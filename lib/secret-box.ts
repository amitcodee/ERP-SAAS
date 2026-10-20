// Encrypts passwords and tokens saved from the panel, and personal numbers kept on people (Aadhaar): AES-256-GCM,
// one key per purpose AND per organisation (`scope`, the org id), each derived from AUTH_SECRET: one org's sealed
// value cannot be opened as another's, even if it were copied across. Changing AUTH_SECRET makes them unreadable: saved settings
// secrets then have to be entered again, and Aadhaar numbers are lost - so AUTH_SECRET is never changed on a live server.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import { serverSecret } from './auth/secret'

export type BoxPurpose = 'settings-secrets' | 'personal-ids'

const key = (purpose: BoxPurpose, scope: string) => createHash('sha256').update(`${serverSecret('AUTH_SECRET')}:${purpose}:${scope}`).digest()

/** The scope of the platform's own secrets (platform_config), never an org id. */
export const PLATFORM_SCOPE = 'platform'

export function seal(value: unknown, purpose: BoxPurpose, scope: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(purpose, scope), iv)
  const data = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()])
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
}

export function unseal<T>(box: string | null | undefined, purpose: BoxPurpose, scope: string): T | null {
  if (!box) return null
  try {
    const [v, iv, tag, data] = box.split('.')
    if (v !== 'v1') return null
    const d = createDecipheriv('aes-256-gcm', key(purpose, scope), Buffer.from(iv, 'base64url'))
    d.setAuthTag(Buffer.from(tag, 'base64url'))
    return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8')) as T
  } catch {
    return null
  }
}
