import { Check } from 'lucide-react'
import { FEATURES } from '@/components/site/content'
import { SitePage } from '@/components/site/shell'
import { StageTabs } from '@/components/site/stage-tabs'

export const metadata = { title: 'Features' }

const AREAS = [
  { title: 'Admissions', items: ['Random calls, walk-ins and website forms in one lead list', 'Lead distribution to telecallers, follow-up dates, overdue escalation', 'Enquiry to registration in one step, with the fee plan', 'Registration numbers and ID cards in your own format'] },
  { title: 'Fees', items: ['Fee plans with instalments, discounts and approvals', 'Numbered receipts with a QR code, gapless per financial year', 'Reminders by SMS, WhatsApp or e-mail before and after the due date', 'Daily reconciliation of payments, ledger and receipts'] },
  { title: 'Teaching', items: ['Batches, trainers, timetables and daily attendance', 'Syllabus progress, notes and tests', 'Project help between students and trainers', 'Student portal on phone and computer'] },
  { title: 'Certificates & letters', items: ['Course and project certificates, from request to e-mailed PDF', 'Anyone can verify a certificate by QR or number', 'Internship selection and completion letters', 'A canvas designer for event certificates'] },
  { title: 'Branches & people', items: ['Head office sees every branch; each branch its own', 'Roles and permissions you can change', 'Student transfers and shared students between branches', 'Sign-in security: lockout, e-mail codes, IP rules'] },
  { title: 'Reports & integrations', items: ['Dashboard, graphs, leaderboards and a calendar', 'Every list exportable to Excel, CSV or PDF', 'Webhooks for n8n, Zapier and Make', 'A read API for Power BI and Excel'] },
]

export default function Features() {
  return (
    <SitePage eyebrow="Features" title="Everything an institute runs on" intro="The core is in every plan; a few extras (events, the API, your own domain) come with the larger plans.">
      <StageTabs />
      <div className="sx-head" style={{ margin: '72px auto 32px' }}><h2>Everything in it</h2></div>
      <div className="lp-bento" style={{ marginBottom: 40 }}>{FEATURES.map((f) => <div key={f.title} className={`lp-feat${f.big ? ' big' : ''}`}><span className="lp-ico lp-ico-sm"><f.icon size={18} /></span><h3>{f.title}</h3><p>{f.text}</p></div>)}</div>
      <div className="lp-aud">
        {AREAS.map((a) => <div key={a.title} className="lp-aud-card"><h3>{a.title}</h3><ul>{a.items.map((x) => <li key={x}><Check size={15} />{x}</li>)}</ul></div>)}
      </div>
    </SitePage>
  )
}
