import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { BrandMark } from '@/components/brand-mark'
import { ParentPayButton } from '@/components/parent-pay'
import { orgBrand } from '@/lib/brand'
import { clientIpFrom } from '@/lib/client-ip'
import { underLimit } from '@/lib/redis'
import { requireRequestOrg } from '@/lib/tenant/request'
import { onlinePaymentsOn } from '@/modules/fees/online'
import { parentView } from '@/modules/portal/parent'

export const dynamic = 'force-dynamic'
// the address is the key: never indexed, never sent on to another site
export const metadata = { title: 'Student progress', robots: { index: false, follow: false }, referrer: 'no-referrer' as const }

const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN')
const day = (d: string) => new Date(d.length > 10 ? d : `${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
const STATUS: Record<string, string> = { active: 'Studying', on_hold: 'On hold', discontinued: 'Discontinued', completed: 'Completed', transferred: 'Moved to another branch' }

// A parent's or guardian's view of one student (modules/portal/parent.ts): attendance, fees and marks, read-only,
// with Pay online when the institute takes it. Opened from the private link the office sent.
export default async function ParentPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ payment?: string }> }) {
  const { token } = await params
  const org = await requireRequestOrg()
  // a few openings a minute is plenty for a person: guessing addresses gets nowhere
  if (!(await underLimit(`parent-view:${clientIpFrom(await headers()) ?? 'unknown'}`, 30, 300))) return <main style={{ padding: 24 }}>Too many requests: please try again in a few minutes.</main>
  const v = await parentView(org.id, token)
  if (!v) notFound()
  const [brand, payOn] = await Promise.all([orgBrand(org.id), onlinePaymentsOn(org.id)])
  const pct = v.attendance.total ? Math.round((v.attendance.present * 100) / v.attendance.total) : null
  const total = v.fees.charged - v.fees.discounted
  const payment = (await searchParams).payment
  const card: React.CSSProperties = { background: '#fff', border: '1px solid var(--line)', borderRadius: 18, padding: 18, display: 'grid', gap: 10 }
  const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14, borderTop: '1px solid var(--line)', paddingTop: 8 }
  return (
    <main style={{ minHeight: '100vh', background: 'var(--page)', padding: '20px 16px 40px', color: 'var(--ink)' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', display: 'grid', gap: 14 }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <BrandMark brand={brand} height={36} />
          <small style={{ color: 'var(--muted)' }}>For parents</small>
        </header>
        {payment && <p role="status" style={{ ...card, display: 'block', margin: 0, background: payment === 'failed' ? '#fff7e6' : '#ecfdf3' }}>{payment === 'paid' ? 'Payment received. Thank you! The receipt is below.' : payment === 'review' ? 'Payment received. The office will confirm it and add the receipt.' : 'The payment was not completed. If money was taken, it shows here within a few minutes.'}</p>}

        <section style={card}>
          <div><h1 style={{ margin: 0, fontSize: 22 }}>{v.student.name}</h1><small style={{ color: 'var(--muted)' }}>{v.student.regNo} · {v.student.course ?? 'Course'} · {v.student.branch}</small></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <div><small style={{ color: 'var(--muted)' }}>Status</small><strong style={{ display: 'block' }}>{STATUS[v.student.status] ?? v.student.status}</strong></div>
            <div><small style={{ color: 'var(--muted)' }}>Attendance</small><strong style={{ display: 'block', color: pct != null && pct < 75 ? '#b91c1c' : undefined }}>{pct != null ? `${pct}%` : '—'}</strong></div>
            <div><small style={{ color: 'var(--muted)' }}>Fees due</small><strong style={{ display: 'block', color: v.fees.balance > 0 ? '#b45309' : '#047857' }}>{v.fees.balance > 0 ? inr(v.fees.balance) : 'All paid'}</strong></div>
          </div>
        </section>

        <section style={card}>
          <h2 style={{ margin: 0, fontSize: 17 }}>Fees</h2>
          <div style={row}><span>Total fees</span><strong>{inr(total)}</strong></div>
          <div style={row}><span>Paid</span><strong>{inr(v.fees.paid)}</strong></div>
          <div style={row}><span>Balance</span><strong>{v.fees.balance > 0 ? inr(v.fees.balance) : 'Nothing due'}</strong></div>
          {payOn && v.fees.payNow > 0 && <ParentPayButton token={token} amount={v.fees.payNow} />}
          {v.fees.installments.filter((i) => i.status === 'scheduled').map((i) => <div key={i.dueDate + i.amount} style={row}><span>Due {day(i.dueDate)}</span><span>{inr(i.amount)}</span></div>)}
          {!!v.fees.receipts.length && <>
            <h3 style={{ margin: '6px 0 0', fontSize: 14 }}>Receipts</h3>
            {v.fees.receipts.map((r) => <div key={r.receiptNo} style={row}><span>{day(r.paidAt)} · {r.online ? 'Online' : 'At the branch'}{r.cancelled ? ' · Cancelled' : ''}</span><span>{r.cancelled ? <s>{inr(r.amount)}</s> : inr(r.amount)}</span></div>)}
          </>}
        </section>

        <section style={card}>
          <h2 style={{ margin: 0, fontSize: 17 }}>Attendance{pct != null ? ` · ${v.attendance.present} of ${v.attendance.total} classes` : ''}</h2>
          {!v.attendance.recent.length ? <p style={{ margin: 0, color: 'var(--muted)' }}>No classes marked yet.</p> : v.attendance.recent.map((a) => (
            <div key={a.date + a.batch} style={row}><span>{day(a.date)} · {a.batch}</span><strong style={{ color: a.present ? '#047857' : '#b91c1c' }}>{a.present ? 'Present' : 'Absent'}</strong></div>
          ))}
        </section>

        <section style={card}>
          <h2 style={{ margin: 0, fontSize: 17 }}>Marks{v.result ? ` · overall ${v.result.pct}%, grade ${v.result.grade}` : ''}</h2>
          {v.result && <p style={{ margin: 0, color: v.result.passed ? '#047857' : '#b45309' }}>{v.result.label}{v.result.passed ? '' : ': below the pass mark so far'}</p>}
          {!v.marks.length ? <p style={{ margin: 0, color: 'var(--muted)' }}>No marks yet.</p> : v.marks.map((m, i) => (
            <div key={i} style={row}><span>{m.title}<small style={{ display: 'block', color: 'var(--muted)' }}>{day(m.date)}</small></span><strong>{m.score != null && m.maxScore ? `${m.score} / ${m.maxScore}` : m.kind === 'capstone' ? 'Project' : '—'}</strong></div>
          ))}
        </section>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>This page is private to you: please do not forward it. Questions? Call the {v.student.branch} office.</p>
      </div>
    </main>
  )
}
