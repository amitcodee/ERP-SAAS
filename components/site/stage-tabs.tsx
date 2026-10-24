'use client'
// The home page's "a student's whole stay" section: three tabs (before they join, while they study, after the course),
// each with what the product does then and a small picture of the screen.
import { useState } from 'react'
import { BadgeCheck, Check, MessageCircle, QrCode } from 'lucide-react'

const STAGES = [
  {
    key: 'before', label: 'Before they join',
    title: 'Turn enquiries into admissions',
    points: ['Leads from calls, walk-ins, your website form and ads in one list', 'Counsellors get their own leads and a follow-up date for each', 'Admission in one step: course, fee plan, registration number and ID card'],
    picture: (
      <div className="sx-card">
        <h4>New enquiry <em>Website form</em></h4>
        <div className="sx-line"><i className="dot" /><span>Priya Nair · Digital Marketing</span><b>Today</b></div>
        <div className="sx-bubble">Hi Priya! Thanks for asking about Digital Marketing. Our weekend batch starts 2 Nov. Shall we book your visit?<small>Sent on WhatsApp ✓✓</small></div>
        <div className="sx-line"><i className="dot o" /><span>Follow-up</span><b>Tomorrow 11 am</b></div>
      </div>
    ),
  },
  {
    key: 'during', label: 'While they study',
    title: 'Keep every class and every fee on track',
    points: ['Batches with their trainer, timing and attendance in a tap', 'Instalments with reminders before the due date, receipts with a QR code', 'Tests, report cards and a private page for parents'],
    picture: (
      <div className="sx-card">
        <h4>Simran Kaur <em>Web Development</em></h4>
        <div className="sx-line"><i className="dot" /><span>Attendance this month</span><b>94%</b></div>
        <div className="sx-line"><i className="dot" /><span>Fees paid</span><b>₹27,000 of ₹36,000</b></div>
        <div className="sx-line"><i className="dot o" /><span>Next instalment</span><b>₹9,000 · 10 Nov</b></div>
        <div className="sx-line"><i className="dot" /><span>Last test</span><b>A · rank 3</b></div>
      </div>
    ),
  },
  {
    key: 'after', label: 'After the course',
    title: 'Certificates they are proud to share',
    points: ['Certificates in your own design, issued a whole batch at once', 'Anyone can check a certificate by its QR code', 'Internship letters, alumni and the next course on offer'],
    picture: (
      <div className="sx-card">
        <div className="sx-cert"><small>CERTIFICATE OF COMPLETION</small><i>Simran Kaur</i><small>Advanced Diploma in Web Development</small><b><QrCode size={34} /></b></div>
        <div className="sx-line"><BadgeCheck size={16} color="#0a9a50" /><span>Verified by an employer</span><b>just now</b></div>
      </div>
    ),
  },
] as const

export function StageTabs() {
  const [on, setOn] = useState<(typeof STAGES)[number]['key']>('before')
  const s = STAGES.find((x) => x.key === on)!
  return (
    <div className="sx-tabs">
      <div className="sx-tab-row" role="tablist" aria-label="A student’s stay">
        {STAGES.map((x) => <button key={x.key} type="button" role="tab" aria-selected={x.key === on} className={x.key === on ? 'on' : ''} onClick={() => setOn(x.key)}>{x.label}</button>)}
      </div>
      <div className="sx-tab-body" role="tabpanel">
        <div className="sx-row-text">
          <h3>{s.title}</h3>
          <ul className="sx-list">{s.points.map((p) => <li key={p}><span className="i"><Check size={16} /></span><div><b style={{ fontWeight: 500 }}>{p}</b></div></li>)}</ul>
        </div>
        <div className="sx-panel" aria-hidden="true">{s.picture}<span className="sx-tag"><MessageCircle size={15} /> {s.label}</span></div>
      </div>
    </div>
  )
}
