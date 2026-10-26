import { onboardingRules } from '@/modules/platform/rules'
import Link from 'next/link'
import { ArrowRight, BadgeCheck, BarChart3, Building2, Check, CreditCard, FileSpreadsheet, GraduationCap, Languages, Laptop, Mail, Megaphone, MessageCircle, QrCode, School, Users, Webhook } from 'lucide-react'
import { APPS, FEATURES, SECURITY, siteFaq } from '@/components/site/content'
import { HandNote, SiteShell } from '@/components/site/shell'
import { PRODUCT } from '@/lib/product'

export const metadata = { title: { absolute: `${PRODUCT.name} | Institute management for coaching and training institutes` } }

// The platform's home page (the apex domain): what it is, who it is for, a free trial. The look is SITE_THEME's.
export const dynamic = 'force-dynamic'

const KINDS = [
  { icon: School, label: 'Coaching institutes' }, { icon: Laptop, label: 'Computer centres' }, { icon: Languages, label: 'Spoken English & IELTS' },
  { icon: GraduationCap, label: 'Skill & training academies' }, { icon: Building2, label: 'Chains with branches' }, { icon: Users, label: 'Franchise networks' },
]

/** What it connects to today (each one is in the product). */
const INTEGRATIONS = [
  { icon: MessageCircle, name: 'WhatsApp', text: 'Reminders and campaigns through AiSensy or the WhatsApp Cloud API' },
  { icon: CreditCard, name: 'Razorpay', text: 'Fees paid online by UPI, card or net banking, receipts made by themselves' },
  { icon: FileSpreadsheet, name: 'Excel & Google Sheets', text: 'Import students, enquiries and staff; export any list' },
  { icon: Mail, name: 'Your own e-mail', text: 'Receipts, reminders and logins from your Gmail or mail server' },
  { icon: Megaphone, name: 'SMS (MSG91)', text: 'Fee reminders by text message' },
  { icon: Webhook, name: 'n8n, Zapier & Make', text: 'Webhooks on new enquiries, admissions, payments and certificates' },
  { icon: BarChart3, name: 'Power BI & Excel', text: 'A read API for your own reports' },
  { icon: Laptop, name: 'Website form', text: 'An admission form for your own website, one line of code' },
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
          <h1>All your institute on <span className="hl">one platform.</span></h1>
          <p className="lead">Simple, quick to learn, <b>and priced for institutes!</b></p>
          <div className="sx-hero-cta">
            <Link href="/signup" className="lp-btn lp-btn-lg sx-btn-brand">Start now – It’s free</Link>
            <Link href="/contact" className="lp-btn lp-btn-lg sx-btn-line">Talk to us</Link>
          </div>
          <div className="sx-hero-note"><HandNote>{trialDays} days free, every app, no card needed</HandNote></div>
        </div>
      </section>

      <section className="sx-apps-band">
        <div className="lp-wrap">
          <div className="sx-head"><h2>Imagine every tool your institute needs, <span className="g">in one place</span></h2><p>From the first enquiry to the certificate, each app hands over to the next, so nothing is typed twice.</p></div>
          <div className="sx-apps">{APPS.map((a) => <Link key={a.label} href="/features" className="sx-app"><span><a.icon color={a.color} strokeWidth={1.8} /></span>{a.label}</Link>)}</div>
          <p className="sx-apps-more"><HandNote>Start with a few, switch more on as you grow</HandNote></p>
        </div>
      </section>

      <section className="lp-sec">
        <div className="lp-wrap">
          <div className="sx-head"><span className="sx-eyebrow">Made for institutes that teach</span><h2>Level up the way your <span className="hl">institute runs</span></h2></div>
          <div className="sx-chips">{KINDS.map((k) => <span key={k.label}><k.icon size={17} /> {k.label}</span>)}</div>
        </div>
      </section>

      <section className="lp-sec" style={{ paddingTop: 0 }}>
        <div className="lp-wrap">
          <div className="sx-rows">
            {ROWS.map((r, i) => (
              <div key={r.title} className={`sx-row${i % 2 ? ' flip' : ''}`}>
                <div className="sx-row-text">
                  <h3>{r.title}</h3>
                  <p>{r.text}</p>
                  <ul className="sx-list">{r.points.map(([b, t]) => <li key={b}><span className="i"><Check size={14} /></span><div><b>{b}</b><small>{t}</small></div></li>)}</ul>
                  <Link href="/signup" className="lp-btn sx-btn-brand">Start for free</Link>
                </div>
                <div className="sx-panel" aria-hidden="true">{r.panel}<span className="sx-tag"><BadgeCheck size={15} /> {r.tag}</span></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-sec lp-soft">
        <div className="lp-wrap">
          <div className="sx-head"><h2>Packed with what an institute <span className="g">runs on</span></h2><p>The core is in every plan; switch extras on as you need them.</p></div>
          <div className="sx-grid">{FEATURES.slice(0, 9).map((f, i) => <div key={f.title}><span className={`lp-ico lp-ico-sm${i % 2 ? ' teal' : ''}`}><f.icon size={18} /></span><h3>{f.title}</h3><p>{f.text}</p></div>)}</div>
          <p style={{ marginTop: 40, textAlign: 'center' }}><Link href="/features" className="lp-btn sx-btn-line">See every app <ArrowRight size={16} /></Link></p>
        </div>
      </section>

      <section className="lp-sec">
        <div className="lp-wrap">
          <div className="sx-head"><span className="sx-eyebrow">Integrations</span><h2>Works with what you <span className="hl">already use</span></h2><p>Bring your old lists in, take payments online and send reports wherever you like.</p></div>
          <div className="sx-integ">{INTEGRATIONS.map((x, i) => <div key={x.name}><span className={`lp-ico lp-ico-sm${i % 2 ? '' : ' teal'}`}><x.icon size={18} /></span><b>{x.name}</b><small>{x.text}</small></div>)}</div>
        </div>
      </section>

      <section className="lp-sec sx-dark">
        <div className="lp-wrap">
          <div className="sx-head"><h2>Your students’ records <span className="g">stay yours</span></h2><p>Every institute’s data is kept apart by the database itself, not just by the screens.</p></div>
          <div className="sx-safe">{SECURITY.map((x) => <div key={x.title}><span className="lp-ico lp-ico-sm"><x.icon size={18} /></span><h3>{x.title}</h3><p>{x.text}</p></div>)}</div>
        </div>
      </section>

      <section className="lp-sec lp-soft">
        <div className="lp-wrap">
          <div className="sx-head"><h2>Up and running <span className="hl">this afternoon</span></h2><p>No installation, no training days.</p></div>
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
          <p style={{ marginTop: 24, textAlign: 'center' }}><Link href="/faq" className="lp-more">More answers <ArrowRight size={15} /></Link></p>
        </div>
      </section>

      <section className="lp-sec" style={{ paddingTop: 0 }}>
        <div className="lp-wrap">
          <div className="sx-band">
            <h2>Grow your institute with <span className="mk">{PRODUCT.name}</span></h2>
            <p>Set up your branches, courses and fees in an afternoon. Free for {trialDays} days{approval ? ' once approved' : ''}, then pick a plan.</p>
            <div className="sx-cta"><Link href="/signup" className="lp-btn lp-btn-lg sx-btn-white">Start now – It’s free</Link><Link href="/contact" className="lp-btn lp-btn-lg lp-btn-ghost">Talk to us</Link></div>
          </div>
        </div>
      </section>
    </SiteShell>
  )
}
