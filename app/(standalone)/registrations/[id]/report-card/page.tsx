export const dynamic = 'force-dynamic'
import { notFound } from 'next/navigation'
import { BrandMark } from '@/components/brand-mark'
import { PrintButton } from '@/components/print-button'
import { getActor } from '@/lib/auth/current'
import { orgBrand } from '@/lib/brand'
import { getConfig } from '@/lib/config/store'
import { withOrgSystem, withTenant } from '@/lib/db/withTenant'
import { requirePage } from '@/lib/panel/base'
import { reportCardIn } from '@/modules/academics/report-card'
import { ownsRegistration } from '@/modules/portal/study'

export const metadata = { title: 'Report card' }

const day = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const pc = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`

// The report card of one registration, A4, to print or save as PDF: opened by the office from Students, and by the
// student from their portal (their own only). Marks, overall result and grade, rank in the batch, attendance, project.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const { actor: me } = await getActor()
  const grades = (await getConfig(me.orgId, 'grades')).config
  let card
  if (me.role === 'student') {
    // their own registration only (the student rule shows no other); then read it as the office would
    if (!(await withTenant(me, (tx) => ownsRegistration(tx, id)))) notFound()
    card = await withOrgSystem(me.orgId, (tx) => reportCardIn(tx, id, grades))
  } else {
    const { actor } = await requirePage('Students')
    card = await withTenant(actor, (tx) => reportCardIn(tx, id, grades))
  }
  if (!card) notFound()
  const brand = await orgBrand(me.orgId)
  const s = card.student, o = card.overall
  const cell: React.CSSProperties = { padding: '2.2mm 2.5mm', borderBottom: '0.3mm solid #e3e6f0', textAlign: 'left', fontSize: '3.4mm' }
  const box: React.CSSProperties = { border: '0.3mm solid #d6dbea', borderRadius: '2.5mm', padding: '3mm', display: 'grid', gap: '1mm' }
  return (
    <main style={{ background: '#e5e7eb', minHeight: '100vh', padding: '20px 12px', display: 'grid', justifyItems: 'center', alignContent: 'start', gap: 16, fontFamily: 'system-ui, sans-serif' }}>
      <style>{`
        @page { size: A4 portrait; margin: 0 }
        @media print { html, body { background: #fff !important } main { padding: 0 !important; background: #fff !important } .no-print { display: none !important } .sheet { box-shadow: none !important } }
        .sheet { width: 210mm; min-height: 297mm; max-width: 100%; background: #fff; box-shadow: 0 10px 40px #0003; box-sizing: border-box; padding: 14mm 14mm 12mm; color: #0f1437; display: grid; align-content: start; gap: 5mm }
        .sheet table { width: 100%; min-width: 0; border-collapse: collapse }
      `}</style>
      <div className="no-print"><PrintButton /></div>
      <div className="sheet">
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6mm', borderBottom: `0.8mm solid ${brand.color}`, paddingBottom: '4mm' }}>
          <div><BrandMark brand={brand} height={44} />{brand.legalName !== brand.name && <div style={{ fontSize: '3mm', color: '#4b5263', marginTop: '1.5mm' }}>{brand.legalName}</div>}</div>
          <div style={{ textAlign: 'right' }}><div style={{ fontSize: '6mm', fontWeight: 800, letterSpacing: '0.04em', color: brand.color }}>REPORT CARD</div><div style={{ fontSize: '3.2mm', color: '#4b5263' }}>Issued {day(new Date().toISOString())}</div></div>
        </header>

        <section style={{ display: 'flex', gap: '5mm', alignItems: 'flex-start' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {s.photoId && <img src={`/documents/${s.photoId}`} alt="" style={{ width: '24mm', height: '30mm', objectFit: 'cover', borderRadius: '2mm', border: '0.3mm solid #d6dbea' }} />}
          <table style={{ flex: 1 }}><tbody>
            {([['Student', s.name], ['Father’s name', s.father ?? '—'], ['Registration no.', s.regNo], ['Course', s.course ?? '—'], ['Branch', s.branch], ['Course period', `${day(s.enrolledOn)} to ${day(s.endsOn)}`]] as [string, string][]).map(([k, v]) => (
              <tr key={k}><th style={{ ...cell, width: '38mm', color: '#4b5263', fontWeight: 500 }}>{k}</th><td style={{ ...cell, fontWeight: 600 }}>{v}</td></tr>
            ))}
          </tbody></table>
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '3mm' }}>
          <div style={box}><small style={{ color: '#4b5263' }}>Overall</small><strong style={{ fontSize: '6mm' }}>{o ? pc(o.pct) : '—'}</strong><small>{o ? `${o.score} / ${o.max} marks` : 'No marks yet'}</small></div>
          <div style={box}><small style={{ color: '#4b5263' }}>Grade</small><strong style={{ fontSize: '6mm', color: brand.color }}>{o?.grade ?? '—'}</strong><small>{o?.label ?? ''}</small></div>
          <div style={box}><small style={{ color: '#4b5263' }}>Result</small><strong style={{ fontSize: '6mm', color: o ? (o.passed ? '#047857' : '#b91c1c') : undefined }}>{o ? (o.passed ? 'Pass' : 'Not yet') : '—'}</strong><small>Pass mark {card.passPct}%</small></div>
          <div style={box}><small style={{ color: '#4b5263' }}>Rank in batch</small><strong style={{ fontSize: '6mm' }}>{card.rank ? `${card.rank.rank} / ${card.rank.of}` : '—'}</strong><small>{card.rank?.batch ?? ''}</small></div>
        </section>

        <section>
          <h2 style={{ margin: '0 0 2mm', fontSize: '4.2mm' }}>Tests and assignments</h2>
          {!card.marks.length ? <p style={{ margin: 0, fontSize: '3.4mm', color: '#4b5263' }}>No marks yet.</p> : (
            <table>
              <thead><tr>{['Date', 'Test / assignment', 'Marks', '%', 'Grade'].map((h) => <th key={h} style={{ ...cell, background: '#f3f4fc', fontWeight: 600, textAlign: h === 'Test / assignment' || h === 'Date' ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
              <tbody>{card.marks.map((m, i) => (
                <tr key={i}><td style={cell}>{day(m.date)}</td><td style={cell}>{m.title}{m.kind === 'assignment' ? ' (assignment)' : ''}</td><td style={{ ...cell, textAlign: 'right' }}>{m.score} / {m.maxScore}</td><td style={{ ...cell, textAlign: 'right' }}>{pc(m.pct)}</td><td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{m.grade}</td></tr>
              ))}</tbody>
            </table>
          )}
          {card.pending > 0 && <p style={{ margin: '2mm 0 0', fontSize: '3mm', color: '#4b5263' }}>{card.pending} more still to be marked.</p>}
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3mm' }}>
          <div style={box}><small style={{ color: '#4b5263' }}>Attendance</small><strong>{card.attendance.pct != null ? `${pc(card.attendance.pct)} · ${card.attendance.present} of ${card.attendance.total} classes` : 'No classes marked yet'}</strong></div>
          <div style={box}><small style={{ color: '#4b5263' }}>Capstone project</small><strong>{card.capstone ? `${card.capstone.title} · ${card.capstone.approved ? 'Approved' : 'Under review'}` : 'Not submitted yet'}</strong></div>
        </section>

        <footer style={{ marginTop: 'auto', display: 'grid', gap: '6mm' }}>
          <div style={{ fontSize: '2.8mm', color: '#4b5263' }}>Grades: {[...grades.bands].sort((a, b) => b.min - a.min).map((b) => `${b.grade} ${b.min}%+`).join(' · ')}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '3.2mm' }}>
            <div style={{ borderTop: '0.3mm solid #0f1437', paddingTop: '1.5mm', width: '55mm', textAlign: 'center' }}>Trainer</div>
            <div style={{ borderTop: '0.3mm solid #0f1437', paddingTop: '1.5mm', width: '55mm', textAlign: 'center' }}>Branch head</div>
          </div>
        </footer>
      </div>
    </main>
  )
}
