'use client'
// Console → Settings: the free trial's length and whether new institutes wait for approval (modules/platform/rules.ts).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveRulesAction } from '@/app/platform/actions'
import type { OnboardingRules } from '@/modules/platform/rules'

export function PlatformRules({ rules }: { rules: OnboardingRules }) {
  const router = useRouter()
  const [v, setV] = useState(rules)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  return (
    <div className="panel" style={{ display: 'grid', gap: 14, maxWidth: 720 }}>
      <h2 style={{ margin: 0 }}>New institutes</h2>
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <input type="checkbox" checked={v.approval} onChange={(e) => setV({ ...v, approval: e.target.checked })} style={{ marginTop: 3 }} />
        <span><strong>Wait for my approval</strong><small style={{ display: 'block', color: '#64748b' }}>Anyone can sign up. Until you approve it (Organisations → Waiting for your approval), the owner can sign in, finish Set Up and choose a plan, but nothing else. Off: the trial starts at sign-up.</small></span>
      </label>
      <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        Free trial
        <input type="number" min={1} max={90} value={v.trialDays} onChange={(e) => setV({ ...v, trialDays: Number(e.target.value) })} aria-label="Free trial days" style={{ width: 90 }} />
        days
      </label>
      <p className="section-hint" style={{ margin: 0 }}>When the trial ends, the institute is closed until it pays: its owner sees only Plan &amp; billing, everyone else that it is paused. Paying opens it at once. Nothing is deleted. You can activate, extend or block any institute from its page.</p>
      {msg && <p role="status" className={msg.ok ? 'section-hint' : 'login-error'} style={{ margin: 0 }}>{msg.text}</p>}
      <div><button type="button" className="button primary" disabled={pending} onClick={() => start(async () => { const r = await saveRulesAction(v); setMsg(r.ok ? { ok: true, text: 'Saved. New sign-ups follow these from now on.' } : { ok: false, text: r.error }); if (r.ok) router.refresh() })}>{pending ? 'Saving…' : 'Save'}</button></div>
    </div>
  )
}
