// Pure rule (unit-tested): is a signed session still allowed to act, given the CURRENT state of its user?
// Sessions are stateless tokens, so this is what makes "deactivate user" and "password changed/reset" take effect at once.
// Each token carries `pwv` = the user's password_changed_at (ms) at the moment it was issued. Any later change or reset
// moves that value, so every older token stops matching - exactly, with no time-window.

export type UserState = { isActive: boolean; deleted: boolean; passwordChangedAt: Date; signedOut?: boolean }

export function sessionValidity(pwv: number | undefined, user: UserState | undefined): 'ok' | 'revoked' {
  if (!user || !user.isActive || user.deleted || user.signedOut) return 'revoked'
  if (pwv === undefined || pwv !== user.passwordChangedAt.getTime()) return 'revoked'
  return 'ok'
}

const MIN = 10
/** Password policy: at least 10 characters with a letter and a digit. Returns a message, or null when acceptable. */
export function passwordProblem(pw: string, opts: { email?: string; current?: string } = {}): string | null {
  if (pw.length < MIN) return `Use at least ${MIN} characters`
  if (pw.length > 200) return 'Password is too long'
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Include at least one letter and one number'
  if (opts.current && pw === opts.current) return 'Choose a password different from the current one'
  if (opts.email && pw.toLowerCase().includes(opts.email.split('@')[0].toLowerCase()) && opts.email.split('@')[0].length >= 4) return 'Do not include your email name in the password'
  return null
}
