'use client'
// A password box with an eye button to show or hide what is typed (as on the sign-in page).
import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

export function PasswordInput(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [show, setShow] = useState(false)
  return (
    <span className="pw-field">
      <input {...props} type={show ? 'text' : 'password'} />
      <button type="button" tabIndex={-1} onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'}>
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </span>
  )
}
