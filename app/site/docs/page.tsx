import { SitePage } from '@/components/site/shell'
import { PRODUCT } from '@/lib/product'

export const metadata = { title: `Guides | ${PRODUCT.name}` }

const GUIDES = [
  { area: 'Getting started', items: [
    { title: 'Set up your institute', steps: ['Sign up and confirm your e-mail', 'Follow the setup steps: logo, first branch, courses, fees, staff', 'Import your students from a spreadsheet if you have them'] },
    { title: 'Invite your staff', steps: ['Open Users & Staff', 'Add each person with their branch and role', 'They get their sign-in by e-mail'] },
  ] },
  { area: 'Admissions', items: [
    { title: 'Take a new enquiry', steps: ['Open Visited Enquiry', 'Add the person, the course they want and a follow-up date', 'Record each follow-up in Enquiry Update'] },
    { title: 'Register a student', steps: ['Open Registration and pick the enquiry', 'Set the course, total fee and payment plan', 'Save: the registration number and ID card are ready'] },
  ] },
  { area: 'Fees', items: [
    { title: 'Collect a fee', steps: ['Open Fees and find the student', 'Record the payment: amount, mode and proof', 'Print or share the receipt'] },
    { title: 'Send fee reminders', steps: ['Settings → E-mail, WhatsApp & SMS: connect a channel', 'Settings → Reminders: choose when', 'They go out every morning'] },
  ] },
  { area: 'Classes and certificates', items: [
    { title: 'Mark today’s class', steps: ['Open My Classes and choose the batch', 'Tick the topics taught and who was present', 'Save'] },
    { title: 'Issue a certificate', steps: ['Request it once the course is complete', 'Accounts confirms the fees are cleared', 'Issue it: it is e-mailed with its verification link'] },
  ] },
]

export default function Docs() {
  return (
    <SitePage eyebrow="Guides" title="How to do the everyday things" intro="Short steps for each task. Inside the app, every screen also explains itself.">
      {GUIDES.map((g) => (
        <div key={g.area} style={{ marginBottom: 28 }}>
          <h3 className="lp-sub">{g.area}</h3>
          <div className="lp-acc" style={{ maxWidth: 820 }}>
            {g.items.map((i) => <details key={i.title}><summary><span>{i.title}</span></summary><ol>{i.steps.map((s) => <li key={s}>{s}</li>)}</ol></details>)}
          </div>
        </div>
      ))}
    </SitePage>
  )
}
