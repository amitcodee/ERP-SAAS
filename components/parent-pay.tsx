'use client'
// The parent's Pay online (app/p/[token]): opens the institute's payment page for what is due now.
import { useState, useTransition } from 'react'
import { payAsParentAction } from '@/app/actions'

export function ParentPayButton({ token, amount }: { token: string; amount: number }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState('')
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <button type="button" className="button primary" disabled={pending} onClick={() => start(async () => {
        setError('')
        const r = await payAsParentAction(token)
        if (!r.ok) return setError(r.error)
        window.location.href = r.data!.url
      })}>{pending ? 'Opening…' : `Pay ₹${(amount / 100).toLocaleString('en-IN')} online`}</button>
      <small style={{ color: 'var(--muted)' }}>UPI, card, net banking or wallet. The receipt shows here at once.</small>
      {error && <small role="alert" style={{ color: '#b91c1c' }}>{error}</small>}
    </div>
  )
}
