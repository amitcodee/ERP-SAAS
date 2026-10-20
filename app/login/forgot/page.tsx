'use client'
import { useActionState } from 'react'
import Link from 'next/link'
import { ArrowLeft, MailCheck } from 'lucide-react'
import { AuthShell } from '@/components/auth-shell'
import { forgotPasswordAction } from '../actions'

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState(forgotPasswordAction, undefined)
  return (
    <AuthShell tagline="Reset your password in a few steps.">
      {state?.sent ? (
        <div className="login-form">
          <span className="login-icon"><MailCheck size={22} /></span>
          <h1>Check Your Email</h1>
          <p className="login-sub">
            If an account exists for <strong>{state.email}</strong>, a link to reset the password has been sent. The link works for 30 minutes.
          </p>
          <p className="login-help">No email after a few minutes? Check the spam folder, or contact your branch office for a reset.</p>
          <Link href="/login" className="login-submit">Back to Sign In</Link>
        </div>
      ) : (
        <form action={action} className="login-form">
          <h1>Forgot Password</h1>
          <p className="login-sub">Enter your account email and we will send you a link to reset your password</p>
          <label>
            Email
            <input name="email" type="email" autoComplete="username" placeholder="Enter your email" required autoFocus />
          </label>
          {state?.error && <p role="alert" className="login-error">{state.error}</p>}
          <button className="login-submit" disabled={pending}>{pending ? 'Sending…' : 'Send Reset Link'}</button>
          <Link href="/login" className="login-back"><ArrowLeft size={14} /> Back to Sign In</Link>
        </form>
      )}
    </AuthShell>
  )
}
