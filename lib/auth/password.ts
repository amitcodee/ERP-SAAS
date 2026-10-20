import { hash, verify } from '@node-rs/argon2'

export const hashPassword = (plain: string) => hash(plain)

export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try {
    return await verify(stored, plain)
  } catch {
    return false
  }
}
