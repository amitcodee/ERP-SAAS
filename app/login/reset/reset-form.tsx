'use client'
import { useActionState, useState } from 'react'
import Link from 'next/link'
import { CircleCheck, Eye, EyeOff } from 'lucide-react'
import { resetPasswordAction } from '../actions'

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, undefined)
  const [show, setShow] = useState(false)
  if (state?.done) {
    return (
      <div className="login-form">
        <span className="login-icon"><CircleCheck size={22} /></span>
        <h1>Password Changed</h1>
        <p className="login-sub">Your password has been updated. Sign in with the new password.</p>
        <Link href="/login" className="login-submit">Sign In</Link>
      </div>
    )
  }
  return (
    <form action={action} className="login-form">
      <h1>New Password</h1>
      <p className="login-sub">Use at least 10 characters, with a letter and a number</p>
      <input type="hidden" name="token" value={token} />
      <label>
        New password
        <span className="login-password">
          <input name="next" type={show ? 'text' : 'password'} autoComplete="new-password" placeholder="Enter a new password" required minLength={10} autoFocus />
          <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'}>
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </span>
      </label>
      <label>
        Repeat new password
        <input name="confirm" type={show ? 'text' : 'password'} autoComplete="new-password" placeholder="Repeat the new password" required minLength={10} />
      </label>
      {state?.error && <p role="alert" className="login-error">{state.error}</p>}
      <button className="login-submit" disabled={pending}>{pending ? 'Saving…' : 'Change Password'}</button>
      <Link href="/login" className="login-back">Back to Sign In</Link>
    </form>
  )
}
