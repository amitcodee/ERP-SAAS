import { SitePage } from '@/components/site/shell'

export const metadata = { title: 'FAQ' }

const FAQ = [
  { q: 'How does the free trial work?', a: 'Sign up with your institute’s name and e-mail. You get every feature for 14 days. At the end, pick a plan; if you do not, your institute becomes read-only (nothing is deleted) until you do.' },
  { q: 'Do I need to install anything?', a: 'No. It runs in the browser on a computer or phone, at your institute’s own web address (or your own domain on the Enterprise plan).' },
  { q: 'Can I bring my existing students and fees?', a: 'Yes. Import enquiries and registrations from a spreadsheet during setup; the import maps your columns and shows you each row it could not take.' },
  { q: 'Is our data safe and private?', a: 'Each institute’s records are kept apart by the database itself. Passwords are stored encrypted, sign-ins can need an e-mailed code, and every change is recorded. Our team cannot see your students unless you ask for help, and then only for a limited time that you can see and end.' },
  { q: 'How do we pay?', a: 'Monthly or yearly, by UPI, card or net banking, with a GST invoice for every payment. Yearly plans cost ten months.' },
  { q: 'What happens if a payment fails?', a: 'We retry and remind you for 7 days. After that your institute becomes read-only: everyone can still sign in and look, but nothing can be changed until the payment is made.' },
  { q: 'Can we cancel?', a: 'Any time, from Settings. You keep access until the end of the period you paid for and can download your data.' },
  { q: 'Do you support several branches?', a: 'Yes. Head office sees every branch; each branch sees its own. The number of branches depends on the plan.' },
]

export default function Faq() {
  return (
    <SitePage eyebrow="FAQ" title="Questions institutes ask us">
      <div className="lp-acc" style={{ maxWidth: 820 }}>
        {FAQ.map((f) => <details key={f.q}><summary><span>{f.q}</span></summary><p>{f.a}</p></details>)}
      </div>
    </SitePage>
  )
}
