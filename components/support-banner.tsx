'use client'
// Shown on every panel page to the institute's head office while a platform support session is open (and to the
// support person, so they know they are inside someone's institute). Head office can end it at once.
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { endSupportSessionAction } from '@/app/actions'

export function SupportBanner({ s, isSupport }: { s: { id: string; by: string; reason: string; mode: 'read' | 'write'; expiresAt: string }; isSupport: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const until = new Date(s.expiresAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
  return (
    <div role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', margin: '0 28px 12px', padding: '10px 16px', borderRadius: 12, background: '#fff7e6', border: '1px solid #f5c26b', color: '#5c3b00', fontSize: 13 }}>
      <span>
        {isSupport ? <><strong>You are in this institute as platform support</strong> ({s.mode === 'read' ? 'read-only' : 'changes allowed'}) until {until}. Everything you do is in its audit log.</>
          : <><strong>Platform support is working in your institute:</strong> {s.by}, {s.mode === 'read' ? 'read-only' : 'can change things'}, until {until}. Reason: “{s.reason}”.</>}
      </span>
      {!isSupport && <button type="button" className="filter-button" disabled={pending} onClick={() => start(async () => { await endSupportSessionAction(s.id); router.refresh() })}>End now</button>}
    </div>
  )
}
