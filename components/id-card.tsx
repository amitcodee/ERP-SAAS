import { Dancing_Script } from 'next/font/google'
import { BadgeCheck, BookOpen, Briefcase, CalendarDays, GraduationCap, Hash, Lightbulb, MapPin, UserRound, Users } from 'lucide-react'
import { PrintButton } from '@/components/print-button'
import { CARD } from '@/lib/id-card'

export type IdCardData = { name: string; course: string; regNo: string; enrolledOn: string; validUntil: string; campus: string; photoUrl: string | null }

// the handwriting of "Transform Your Career"
const script = Dancing_Script({ subsets: ['latin'], weight: '700', display: 'swap' })

const BLUE = '#2f49c9', NAVY = '#1c2f8f', DEEP = '#16246e', INK = '#141a33', MUTED = '#6b7394'
const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
const PROMISE_ICONS = [GraduationCap, Lightbulb, Users, Briefcase]

/** The student membership card, front and back, at its real size (85.6 × 54 mm, a bank-card blank). */
export function IdCard({ v, verifyQr, followQr, backHref }: { v: IdCardData; verifyQr: string; followQr: string; backHref: string }) {
  const rows: [typeof UserRound, string, string][] = [
    [UserRound, 'Student Name', v.name], [BookOpen, 'Course', v.course], [Hash, 'Enrollment No.', v.regNo],
    [CalendarDays, 'Date of Enrollment', day(v.enrolledOn)], [BadgeCheck, 'Valid Until', day(v.validUntil)],
  ]
  return (
    <main className="idc-page">
      <style>{`
        @page { size: 85.6mm 54mm; margin: 0 }
        .idc-page { min-height: 100vh; padding: 24px 12px 48px; background: #e9ebf5; display: grid; justify-items: center; align-content: start; gap: 18px; font-family: Inter, 'Segoe UI', Arial, sans-serif; }
        .idc-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: center; }
        .idc-bar a.back { padding: 10px 18px; border-radius: 8px; background: #fff; color: ${NAVY}; border: 1px solid ${NAVY}; font-weight: 600; font-size: 14px; text-decoration: none; }
        .idc-hint { margin: 0; color: ${MUTED}; font-size: 13px; text-align: center; max-width: 520px; }
        .idc-zoom { zoom: 1.9; display: grid; gap: 6mm; }
        /* The card is drawn at twice its size and scaled back to half: the browser will not draw text under 6px, and at
           the real size most of the card's small print is under that, so the print would not match the screen. */
        .idc-sheet { width: 85.6mm; height: 54mm; border-radius: 3mm; overflow: hidden; box-shadow: 0 6px 24px #0b103033; }
        .idc { zoom: 2; transform: scale(.5); transform-origin: 0 0; width: 85.6mm; height: 54mm; background: #fff; color: ${INK}; display: flex; flex-direction: column; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .idc-head { flex: none; background: linear-gradient(120deg, ${DEEP}, ${NAVY}); color: #fff; }
        .idc-logo { display: block; width: auto; filter: brightness(0) invert(1); }
        /* Front: the logo in the middle of a tall band, the three words under it */
        .idc-front .idc-head { height: 13.6mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .5mm; }
        .idc-front .idc-logo { height: 7.4mm; }
        .idc-tag { font-size: 1.3mm; line-height: 1; letter-spacing: .55mm; font-weight: 600; opacity: .92; white-space: nowrap; }
        .idc-tag i { opacity: .55; font-style: normal; margin: 0 1.1mm; }
        .idc-body { flex: 1; min-height: 0; display: flex; overflow: hidden; }
        .idc-main { flex: 1; min-width: 0; padding: 2mm 2mm 0 4mm; }
        .idc-title { margin: 0; font-size: 3.6mm; font-weight: 800; letter-spacing: -.06mm; line-height: 1; white-space: nowrap; }
        .idc-sub { display: flex; align-items: center; gap: 1.4mm; margin: 1.1mm 0 1.3mm; color: ${BLUE}; font-size: 1.3mm; line-height: 1; font-weight: 700; letter-spacing: .5mm; }
        .idc-sub::after { content: ''; width: 6mm; height: .2mm; background: ${BLUE}; opacity: .6; }
        .idc-row { display: grid; grid-template-columns: 3.6mm 14.6mm 1mm minmax(0, 1fr); align-items: center; gap: 1.5mm; height: 3.6mm; margin-bottom: 1.5mm; font-size: 1.75mm; line-height: 1.12; }
        .idc-row span.ic { width: 3.6mm; height: 3.6mm; border-radius: 50%; background: ${BLUE}; box-shadow: inset 0 0 0 .35mm ${BLUE}, inset 0 0 0 .6mm #ffffff66; color: #fff; display: grid; place-items: center; }
        .idc-row span.ic svg { width: 1.9mm; height: 1.9mm; }
        .idc-row dt { color: #8a90a8; font-size: 1.55mm; white-space: nowrap; }
        .idc-row > span:nth-child(3) { color: #8a90a8; }
        .idc-row dd { margin: 0; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        /* a long name or course takes a second line instead of being cut */
        .idc-row.long dd { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; white-space: normal; overflow-wrap: anywhere; }
        /* The photo sits right under the band, against the edge of the card */
        .idc-side { flex: none; width: 26mm; margin-right: 1.2mm; display: flex; flex-direction: column; align-items: center; }
        .idc-photo { flex: none; width: 26mm; height: 24.4mm; background: #eef0f8; display: grid; place-items: center; color: #b3b9d3; overflow: hidden; }
        .idc-photo img { width: 100%; height: 100%; object-fit: cover; object-position: center top; }
        .idc-script { margin-top: .5mm; color: ${BLUE}; font-size: 2.25mm; line-height: 1.15; white-space: nowrap; }
        .idc-campus { display: flex; align-items: center; gap: .7mm; margin-top: .3mm; padding: .55mm 2mm; border-radius: 3mm; background: ${BLUE}; color: #fff; font-size: 1.4mm; line-height: 1.15; font-weight: 700; letter-spacing: .15mm; text-transform: uppercase; text-align: center; max-width: 100%; }
        .idc-campus svg { flex: none; width: 1.5mm; height: 1.5mm; }
        .idc-foot { flex: none; height: 6.8mm; background: linear-gradient(120deg, ${DEEP}, ${NAVY}); color: #fff; display: flex; align-items: center; justify-content: space-between; gap: 1.5mm; padding: 0 3mm; }
        .idc-foot div { display: flex; align-items: center; gap: 1.1mm; font-size: 1.15mm; font-weight: 700; letter-spacing: .15mm; text-transform: uppercase; line-height: 1.2; }
        .idc-foot div i { flex: none; width: 3.2mm; height: 3.2mm; border: .2mm solid #ffffff80; border-radius: 50%; display: grid; place-items: center; }
        .idc-foot svg { width: 1.8mm; height: 1.8mm; }
        .idc-foot div span { max-width: 11mm; }
        .idc-foot p { margin: 0; max-width: 13mm; font-size: 1.15mm; line-height: 1.25; opacity: .85; text-align: right; }
        /* Back: the logo on the left, the card's number on the right */
        .idc-rear .idc-head { height: 10mm; display: flex; align-items: center; justify-content: space-between; gap: 3mm; padding: 0 4.5mm 0 4mm; }
        .idc-rear .idc-logo { height: 6.8mm; }
        .idc-head .num { text-align: right; white-space: nowrap; }
        .idc-head .num small { display: block; margin-bottom: .5mm; font-size: 1.1mm; letter-spacing: .4mm; opacity: .75; font-weight: 600; }
        .idc-head .num strong { font-size: 2.3mm; line-height: 1; letter-spacing: .5mm; font-weight: 700; }
        .idc-rear .idc-body { gap: 3mm; padding: 2.4mm 4mm 1.4mm; }
        .idc-h { margin: 0 0 1.2mm; color: ${BLUE}; font-size: 1.5mm; line-height: 1.2; font-weight: 800; letter-spacing: .4mm; }
        .idc-h.bar { padding-left: 1.2mm; border-left: .4mm solid ${BLUE}; }
        .idc-terms { margin: 0; padding: 0; list-style: none; font-size: 1.4mm; line-height: 1.42; color: #2d3554; }
        .idc-terms li { position: relative; padding-left: 1.8mm; margin-bottom: .55mm; }
        .idc-terms li::before { content: ''; position: absolute; left: .2mm; top: .62mm; width: .6mm; height: .6mm; border-radius: 50%; background: ${BLUE}; }
        .idc-contact { margin-top: 1.1mm; font-size: 1.4mm; line-height: 1.42; color: #2d3554; }
        .idc-contact::before { content: ''; display: block; width: 14mm; height: .2mm; margin-bottom: 1mm; background: ${BLUE}; opacity: .55; }
        .idc-contact .idc-h { margin-bottom: .7mm; }
        .idc-qrs { flex: none; width: 15mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .9mm; }
        .idc-qr { width: 13.8mm; height: 13.8mm; padding: .8mm; border: .3mm solid ${BLUE}; border-radius: 1.3mm; background: #fff; }
        .idc-qr svg { width: 100%; height: 100%; display: block; }
        .idc-qrs small { margin-bottom: .6mm; color: ${NAVY}; font-size: 1.15mm; line-height: 1; font-weight: 800; letter-spacing: .3mm; white-space: nowrap; }
        .idc-camp { flex: none; height: 4.2mm; background: linear-gradient(120deg, ${DEEP}, ${NAVY}); color: #fff; display: flex; align-items: center; justify-content: center; gap: 1.6mm; font-size: 1.4mm; white-space: pre; }
        .idc-camp b { letter-spacing: .4mm; font-size: 1.15mm; opacity: .8; }
        @media (max-width: 720px) { .idc-zoom { zoom: 1.05; } }
        @media print {
          html, body { background: #fff !important; }
          .idc-page { padding: 0; background: #fff; display: block; min-height: 0; }
          .no-print, .idc-hint { display: none !important; }
          .idc-zoom { zoom: 1; display: block; }
          .idc-sheet { box-shadow: none; border-radius: 0; break-after: page; page-break-after: always; }
        }
      `}</style>
      <div className="idc-bar no-print"><PrintButton label="Print the ID card" /><a className="back" href={backHref}>{backHref.startsWith("/?") ? "Back to my portal" : "Back to registrations"}</a></div>
      <p className="idc-hint">Printed at the real card size (85.6 × 54 mm): the front on page 1, the back on page 2. In the print window choose the card printer, no margins, and keep &quot;Background graphics&quot; on.</p>
      <div className="idc-zoom">
        <div className="idc-sheet">
          <section className="idc idc-front" aria-label="Front of the card">
            <header className="idc-head">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="idc-logo" src="/tce.webp" alt="techcadd" />
              <div className="idc-tag">{CARD.tagline.map((t, i) => <span key={t}>{i > 0 && <i>|</i>}{t}</span>)}</div>
            </header>
            <div className="idc-body">
              <div className="idc-main">
                <h1 className="idc-title">Student Membership Card</h1>
                <div className="idc-sub">STUDENT MEMBER</div>
                <dl style={{ margin: 0 }}>
                  {rows.map(([Icon, k, val]) => <div className={k === 'Student Name' || k === 'Course' ? 'idc-row long' : 'idc-row'} key={k}><span className="ic"><Icon /></span><dt>{k}</dt><span>:</span><dd>{val}</dd></div>)}
                </dl>
              </div>
              <div className="idc-side">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <div className="idc-photo">{v.photoUrl ? <img src={v.photoUrl} alt={v.name} /> : <UserRound style={{ width: '10mm', height: '10mm' }} />}</div>
                <div className={`idc-script ${script.className}`}>Transform Your Career</div>
                <div className="idc-campus"><MapPin />{v.campus} Campus</div>
              </div>
            </div>
            <footer className="idc-foot">
              {CARD.promises.map((p, i) => { const Icon = PROMISE_ICONS[i]; return <div key={p}><i><Icon /></i><span>{p}</span></div> })}
              <p>Together, we build your future.</p>
            </footer>
          </section>
        </div>

        <div className="idc-sheet">
          <section className="idc idc-rear" aria-label="Back of the card">
            <header className="idc-head">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="idc-logo" src="/tce.webp" alt="techcadd" />
              <div className="num"><small>STUDENT MEMBERSHIP CARD</small><strong>{v.regNo}</strong></div>
            </header>
            <div className="idc-body">
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 className="idc-h bar">TERMS &amp; CONDITIONS</h2>
                <ul className="idc-terms">{CARD.terms.map((t) => <li key={t}>{t}</li>)}</ul>
                <div className="idc-contact">
                  <h2 className="idc-h">CONTACT US</h2>
                  {CARD.office}<br />Call : {CARD.phone}<br />Website : {CARD.website}
                </div>
              </div>
              <div className="idc-qrs">
                <div className="idc-qr" dangerouslySetInnerHTML={{ __html: verifyQr }} />
                <small>SCAN TO VERIFY</small>
                <div className="idc-qr" dangerouslySetInnerHTML={{ __html: followQr }} />
                <small>FOLLOW US</small>
              </div>
            </div>
            <footer className="idc-camp"><b>CAMPUSES :</b>{CARD.campuses.join('  |  ')}</footer>
          </section>
        </div>
      </div>
    </main>
  )
}
