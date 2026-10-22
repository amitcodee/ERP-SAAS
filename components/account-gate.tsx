import Link from 'next/link'
import type { Gate } from '@/lib/tenant/gate'

// The page shown instead of the panel while an institute waits for approval or is closed until paid (lib/tenant/gate.ts).
export function AccountGate({ gate, isHeadOffice, name }: { gate: Gate; isHeadOffice: boolean; name: string }) {
  const card: React.CSSProperties = { maxWidth: 620, margin: '40px auto', padding: 28, borderRadius: 20, background: '#fff', border: '1px solid var(--line)', display: 'grid', gap: 12 }
  if (gate === 'pending') return (
    <section style={card} role="status">
      <h1 style={{ margin: 0, fontSize: 24 }}>Waiting for approval</h1>
      {isHeadOffice ? <>
        <p style={{ margin: 0, color: 'var(--text)' }}>Thank you for signing up {name}. We check every new institute before it starts; you will get an e-mail as soon as it is approved, usually within a working day. Your free trial starts then.</p>
        <p style={{ margin: 0, color: 'var(--text)' }}>Meanwhile you can finish setting up: your brand, branches, courses and staff, and choose a plan.</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/setup" className="button primary">Continue Set Up</Link>
          <Link href="/settings?tab=billing" className="button secondary">Plans &amp; billing</Link>
        </div>
      </> : <p style={{ margin: 0, color: 'var(--text)' }}>{name} is being set up. You can use it as soon as it is approved: please check again later.</p>}
    </section>
  )
  return (
    <section style={card} role="status">
      <h1 style={{ margin: 0, fontSize: 24 }}>{name} is paused</h1>
      {isHeadOffice ? <>
        <p style={{ margin: 0, color: 'var(--text)' }}>The free trial or the paid plan has ended. Choose a plan and pay to open everything again at once. Nothing has been deleted: your students, fees and certificates are all kept.</p>
        <div><Link href="/settings?tab=billing" className="button primary">Choose a plan and pay</Link></div>
      </> : <p style={{ margin: 0, color: 'var(--text)' }}>The institute’s plan needs renewing. Please ask your head office; everything will be back as soon as it is paid. Nothing has been deleted.</p>}
    </section>
  )
}
