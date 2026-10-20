'use client'
import { useActionState, useState, useTransition } from 'react'
import Link from 'next/link'
import { resendTwoFactorAction, verifyTwoFactorAction, type VerifyState } from '../actions'

export function VerifyForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(verifyTwoFactorAction, undefined)
  const [resent, setResent] = useState<VerifyState>(undefined)
  const [sending, start] = useTransition()
  const error = resent?.error ?? state?.error
  return (
    <form action={action} className="login-form" onSubmit={() => setResent(undefined)}>
      <h1>Check Your E-mail</h1>
      <p className="login-sub">We sent a 6-digit code to {email}. Enter it to finish signing in.</p>
      <label>
        Verification code
        <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} placeholder="6-digit code" required autoFocus style={{ letterSpacing: 4 }} />
      </label>
      {error && <p role="alert" className="login-error">{error}</p>}
      {resent?.sent && <p role="status" className="login-sub" style={{ margin: 0 }}>A new code is on its way.</p>}
      <button className="login-submit" disabled={pending}>{pending ? 'Checking…' : 'Verify & Sign In'}</button>
      <button type="button" className="login-back" disabled={sending} onClick={() => start(async () => setResent(await resendTwoFactorAction()))} style={{ border: 0, background: 'transparent', cursor: 'pointer' }}>
        {sending ? 'Sending…' : 'Send the code again'}
      </button>
      <Link href="/login" className="login-back">Back to Sign In</Link>
    </form>
  )
}
