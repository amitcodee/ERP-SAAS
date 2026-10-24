import { onboardingRules } from '@/modules/platform/rules'
import Link from 'next/link'
import { ArrowRight, BadgeCheck, BellRing, Building2, CalendarCheck, Check, GraduationCap, IndianRupee, Languages, Laptop, Megaphone, QrCode, School, Sparkles, Users } from 'lucide-react'
import { FEATURES, SECURITY, siteFaq } from '@/components/site/content'
import { SiteShell } from '@/components/site/shell'
import { PRODUCT } from '@/lib/product'

export const metadata = { title: { absolute: `${PRODUCT.name} | Institute management for coaching and training institutes` } }

// The platform's home page (the apex domain): what it is, who it is for, a free trial. The look is SITE_THEME's.
export const dynamic = 'force-dynamic'

const KINDS = [
  { icon: School, label: 'Coaching institutes' }, { icon: Laptop, label: 'Computer centres' }, { icon: Languages, label: 'Spoken English & IELTS' },
  { icon: GraduationCap, label: 'Skill & training academies' }, { icon: Building2, label: 'Chains with branches' }, { icon: Users, label: 'Franchise networks' },
]

/** The four things an institute does all day, each with a small picture of the screen. */
const ROWS: { title: string; text: string; points: [string, string][]; panel: React.ReactNode; tag: string }[] = [
  {
    title: 'Every enquiry followed up, every seat filled',
    text: 'Calls, walk-ins and website forms land in one list, are shared out to your counsellors and come back on their follow-up date.',
    points: [['One list for every lead', 'Phone, walk-in, website form and ads, with their source'], ['Follow-ups that come back', 'Overdue ones go up to the branch manager'], ['Enquiry to admission in one step', 'Course, fee plan and ID card, nothing typed twice']],
    tag: 'Admission confirmed',
    panel: (
      <div className="sx-card">
        <h4>Today’s follow-ups <em>12 due</em></h4>
        <div className="sx-line"><i className="dot" /><span>Riya Sharma · Web design</span><b>Demo 4 pm</b></div>
        <div className="sx-line"><i className="dot o" /><span>Aman Gill · Tally</span><b>Call back</b></div>
        <div className="sx-line"><i className="dot" /><span>Neha Verma · IELTS</span><b>Joined ✓</b></div>
        <div className="sx-line"><i className="dot r" /><span>Karan Mehta · AutoCAD</span><b>2 days late</b></div>
      </div>
    ),
  },
  {
    title: 'Fees collected on time, with a receipt every time',
    text: 'Fee plans and instalments, reminders before the due date, and a numbered receipt with a QR code for every payment, at the desk or online.',
    points: [['Reminders on WhatsApp, SMS or e-mail', 'Before the due date and after it'], ['Pay online by link', 'Send a payment link; the receipt makes itself'], ['Discounts with approval', 'Big ones wait for head office']],
    tag: 'Paid online',
    panel: (
      <div className="sx-card">
        <div className="sx-bubble">Dear Simran, your ₹9,000 instalment is due on 10 Nov. Pay here: pay.link/…<small>10:02 ✓✓</small></div>
        <div className="sx-receipt"><small>Receipt RCP-MAIN-2026-0142</small><span className="amt">₹9,000</span><small>Paid online · balance ₹0</small></div>
      </div>
    ),
  },
  {
    title: 'Classes, attendance and results in one place',
    text: 'Batches with their trainer and timing, attendance marked in a tap, syllabus progress, tests and report cards for parents.',
    points: [['Attendance in seconds', 'From the trainer’s phone, every class'], ['Tests and report cards', 'Marks, grades and rank, ready to print'], ['A page for parents', 'Attendance, fees and marks on a private link']],
    tag: '92% attendance',
    panel: (
      <div className="sx-card">
        <h4>Web Design · Morning batch <em>Today</em></h4>
        <div className="sx-line"><i className="dot" /><span>Simran Kaur</span><b>Present</b></div>
        <div className="sx-line"><i className="dot" /><span>Aman Gill</span><b>Present</b></div>
        <div className="sx-line"><i className="dot o" /><span>Riya Sharma</span><b>Late</b></div>
        <div className="sx-line"><i className="dot r" /><span>Karan Mehta</span><b>Absent</b></div>
      </div>
    ),
  },
  {
    title: 'Certificates in your own design, verifiable by anyone',
    text: 'Design your certificates on a canvas in your colours, issue a whole batch at once, and let employers check any certificate by its QR code.',
    points: [['Templates in your colours', 'Course, internship, merit, workshop'], ['A batch at once', 'Every ready certificate issued in one click'], ['Checked by QR code', 'Genuine or revoked, in a second']],
    tag: 'Certificate verified',
    panel: (
      <div className="sx-card">
        <div className="sx-cert"><small>CERTIFICATE OF COMPLETION</small><i>Simran Kaur</i><small>Advanced Diploma in Web Development</small><b><QrCode size={34} /></b></div>
      </div>
    ),
  },
]

export default async function Home() {
  const { trialDays, approval } = await onboardingRules()
  const faq = siteFaq(trialDays, approval).slice(0, 6)
  return (
    <SiteShell>
      <section className="sx-hero">
        <div className="lp-wrap">
          <span className="sx-badge"><Sparkles size={15} /> — Institute management, from first call to certificate</span>
          <h1><span className="g">Fill every batch</span>and run your whole institute in one place</h1>
          <p className="lead">Leads, admissions, fees, classes and certificates for every branch, with reminders on WhatsApp and each person seeing just their part.</p>
          <div className="sx-cta">
            <Link href="/signup" className="lp-btn sx-btn-green">Start {trialDays}-day free trial <ArrowRight size={16} /></Link>
            <Link href="/pricing" className="lp-btn sx-btn-line">See pricing <ArrowRight size={16} /></Link>
          </div>
          <ul className="sx-ticks"><li><Check size={15} /> No card needed</li><li><Check size={15} /> Your own web address</li><li><Check size={15} /> Phone and computer</li></ul>

          <div className="sx-stage" aria-hidden="true">
            <div className="sx-arc" /><div className="sx-disc" />
            <div className="sx-board">
              <div className="sx-board-bar"><i /><i /><i /><span>Dashboard · this month</span></div>
              <div className="sx-board-body">
                <div className="sx-kpis"><div><small>Enquiries</small><b>248</b><em>▲ 18%</em></div><div><small>Admissions</small><b>61</b><em>▲ 12%</em></div><div><small>Collected</small><b>₹7.4L</b><em>▲ 22%</em></div></div>
                <div className="sx-bars">{[34, 52, 41, 66, 58, 82, 70, 90, 76, 96].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div>
              </div>
            </div>
            <div className="sx-float stat sx-f1"><span className="i"><IndianRupee size={18} /></span><b>₹1.2L</b><small>collected today</small></div>
            <div className="sx-float sx-f2"><span className="i"><BadgeCheck size={18} /></span><div><b>Certificate verified</b><small>Genuine · scanned just now</small></div></div>
            <div className="sx-float sx-f3"><span className="i"><BellRing size={18} /></span><div><b>Fee reminder sent</b><small>WhatsApp · 32 students</small></div></div>
            <div className="sx-float stat sx-f4"><span className="i"><CalendarCheck size={18} /></span><b>92%</b><small>attendance</small></div>
            <div className="sx-chat">Hi! Is the weekend batch for Tally still open?<small>11:24</small></div>
            <div className="sx-pill-ok"><span className="i"><Check size={18} /></span>Admission confirmed</div>
          </div>
        </div>
      </section>

      <section className="sx-for">
        <div className="lp-wrap">
          <h2>Made for institutes that teach</h2>
          <p>From a single room to a chain of franchises: start small, switch on more as you grow.</p>
          <div className="sx-chips">{KINDS.map((k) => <span key={k.label}><k.icon size={17} /> {k.label}</span>)}</div>
        </div>
      </section>

      <section className="lp-sec">
        <div className="lp-wrap">
          <div className="sx-head"><h2>Everything a student needs, <span className="g">start to finish</span></h2><p>Each step hands over to the next, so nothing is typed twice and nobody is forgotten.</p></div>
          <div className="sx-rows">
            {ROWS.map((r, i) => (
              <div key={r.title} className={`sx-row${i % 2 ? ' flip' : ''}`}>
                <div className="sx-row-text">
                  <h3>{r.title}</h3>
                  <p>{r.text}</p>
                  <ul className="sx-list">{r.points.map(([b, s]) => <li key={b}><span className="i"><Check size={16} /></span><div><b>{b}</b><small>{s}</small></div></li>)}</ul>
                  <Link href="/signup" className="lp-btn sx-btn-green">Start for free <ArrowRight size={16} /></Link>
                </div>
                <div className="sx-panel" aria-hidden="true">{r.panel}<span className="sx-tag"><BadgeCheck size={15} /> {r.tag}</span></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-sec lp-soft">
        <div className="lp-wrap">
          <div className="sx-head"><h2>Packed with what an institute runs on</h2><p>The core is in every plan; switch extras on as you need them.</p></div>
          <div className="sx-grid">{FEATURES.slice(0, 9).map((f) => <div key={f.title}><span className="lp-ico lp-ico-sm"><f.icon size={18} /></span><h3>{f.title}</h3><p>{f.text}</p></div>)}</div>
          <p style={{ marginTop: 28, textAlign: 'center' }}><Link href="/features" className="lp-btn sx-btn-line">See every feature <ArrowRight size={16} /></Link></p>
        </div>
      </section>

      <section className="lp-sec">
        <div className="lp-wrap">
          <div className="sx-head"><h2>Your students’ records <span className="g">stay yours</span></h2><p>Every institute’s data is kept apart by the database itself, not just by the screens.</p></div>
          <div className="sx-safe">{SECURITY.map((s) => <div key={s.title}><span className="lp-ico lp-ico-sm"><s.icon size={18} /></span><h3>{s.title}</h3><p>{s.text}</p></div>)}</div>
        </div>
      </section>

      <section className="lp-sec lp-soft">
        <div className="lp-wrap">
          <div className="sx-head"><h2>Up and running <span className="g">this afternoon</span></h2><p>No installation, no training days.</p></div>
          <div className="sx-steps">
            <div><span className="n">1</span><h3>Sign up</h3><p>Your institute’s name and e-mail. You get your own web address at once{approval ? ' and we approve you within a working day' : ''}.</p></div>
            <div><span className="n">2</span><h3>Set up</h3><p>Your logo and colour, branches, a ready-made course list, fees and staff, step by step.</p></div>
            <div><span className="n">3</span><h3>Bring your students</h3><p>Import them from Excel or Google Sheets, then take your first admission.</p></div>
          </div>
        </div>
      </section>

      <section className="lp-sec">
        <div className="lp-wrap">
          <div className="sx-head"><h2>Questions institutes ask</h2></div>
          <div className="lp-acc" style={{ maxWidth: 820, margin: '0 auto' }}>{faq.map((f) => <details key={f.q}><summary><span>{f.q}</span></summary><p>{f.a}</p></details>)}</div>
          <p style={{ marginTop: 20, textAlign: 'center' }}><Link href="/faq" className="lp-more">More answers <ArrowRight size={15} /></Link></p>
        </div>
      </section>

      <section className="lp-sec" style={{ paddingTop: 0 }}>
        <div className="lp-wrap">
          <div className="sx-band">
            <h2>Try it with your own institute</h2>
            <p>Set up your branches, courses and fees in an afternoon. Free for {trialDays} days{approval ? ' once approved' : ''}, then pick a plan.</p>
            <div className="sx-cta"><Link href="/signup" className="lp-btn sx-btn-white">Start free trial <ArrowRight size={16} /></Link><Link href="/contact" className="lp-btn lp-btn-ghost">Talk to us <Megaphone size={15} /></Link></div>
          </div>
        </div>
      </section>
    </SiteShell>
  )
}
