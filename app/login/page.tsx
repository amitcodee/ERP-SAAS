'use client'
import { useActionState, useState } from 'react'
import Link from 'next/link'
import { Eye, EyeOff } from 'lucide-react'
import { AuthShell } from '@/components/auth-shell'
import { loginAction } from './actions'

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, undefined)
  const [show, setShow] = useState(false)
  return (
    <AuthShell tagline="Sign in to continue to your account.">
      <form action={action} className="login-form">
        <h1>Welcome Back</h1>
        <p className="login-sub">Enter your email and password to access your account</p>
        <label>
          Email
          <input name="email" type="email" autoComplete="username" placeholder="Enter your email" required />
        </label>
        <label>
          Password
          <span className="login-password">
            <input name="password" type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" required />
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </span>
        </label>
        <Link href="/login/forgot" className="login-forgot">Forgot Password?</Link>
        {state?.error && <p role="alert" className="login-error">{state.error}</p>}
        <button className="login-submit" disabled={pending}>{pending ? 'Signing in…' : 'Sign In'}</button>
      </form>
    </AuthShell>
  )
}
