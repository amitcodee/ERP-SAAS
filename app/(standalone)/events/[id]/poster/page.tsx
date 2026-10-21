export const dynamic = 'force-dynamic'
import { notFound } from 'next/navigation'
import { PrintButton } from '@/components/print-button'
import { appOrigin, qrSvg } from '@/lib/app-url'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { EVENT_KINDS, getEvent } from '@/modules/events/service'
import { BrandMark } from '@/components/brand-mark'
import { orgBrand } from '@/lib/brand'

export const metadata = { title: 'Event poster' }

// An A4 poster of an event with its QR code, to print and put up at the venue: scan, sign up, get the certificate.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const b = await requirePage('Seminars & Workshops')
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const [d, brand] = await Promise.all([withTenant(b.actor, (tx) => getEvent(tx, b.actor, id)), orgBrand(b.actor.orgId)])
  if (!d) notFound()
  const e = d.event
  const link = `${await appOrigin(b.actor.orgId)}/e/${e.token}`
  const when = new Date(e.startsAt).toLocaleString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
  return (
    <main style={{ background: '#e5e7eb', minHeight: '100vh', padding: '20px 12px', display: 'grid', justifyItems: 'center', alignContent: 'start', gap: 16, fontFamily: 'system-ui, sans-serif' }}>
      <style>{`
        @page { size: A4 portrait; margin: 0 }
        @media print { html, body { background: #fff !important } main { padding: 0 !important; background: #fff !important } .no-print { display: none !important } .poster { box-shadow: none !important } }
        .poster { width: 210mm; min-height: 297mm; max-width: 100%; background: #fff; box-shadow: 0 10px 40px #0003; box-sizing: border-box; padding: 18mm 16mm; display: grid; justify-items: center; align-content: start; gap: 6mm; text-align: center; color: #0f1437 }
        .poster .qr { width: 110mm; max-width: 80%; padding: 5mm; border: 1.2mm solid #0f1437; border-radius: 6mm }
        .poster .qr svg { width: 100%; height: auto; display: block }
      `}</style>
      <div className="no-print"><PrintButton label="Print poster" /></div>
      <div className="poster">
        <BrandMark brand={brand} height={90} />
        <div style={{ fontSize: '7mm', fontWeight: 800, letterSpacing: '0.2em', color: '#21a7a3', textTransform: 'uppercase' }}>{EVENT_KINDS[e.kind]}</div>
        <h1 style={{ margin: 0, fontSize: '13mm', lineHeight: 1.1, fontWeight: 800 }}>{e.title}</h1>
        <div style={{ fontSize: '5.5mm', color: '#374151' }}>{when}{e.venue ? <><br />{e.venue}</> : null}{e.speaker ? <><br />by {e.speaker}</> : null}</div>
        <div className="qr" dangerouslySetInnerHTML={{ __html: await qrSvg(link, '#0f1437') }} />
        <div style={{ fontSize: '7mm', fontWeight: 800 }}>Scan to sign up{e.hasQuiz ? ' & take the quiz' : ''}</div>
        {e.certificate && <div style={{ fontSize: '5mm', color: '#374151' }}>Your certificate comes to your e-mail{e.hasQuiz && e.certFor === 'passed' ? ` when you score ${e.passPercent}% or more` : ''}.</div>}
        <div style={{ fontSize: '4mm', color: '#6b7280', overflowWrap: 'anywhere' }}>{link}</div>
      </div>
    </main>
  )
}
