import { MailCheck } from 'lucide-react'
import { VerifyForm } from '@/components/site/forms'
import { SiteAuth } from '@/components/site/shell'

export const metadata = { title: 'Confirm your e-mail' }

export default function VerifySignup() {
  return (
    <SiteAuth>
      <div className="au-steps" aria-label="Steps"><span className="done"><b>✓</b> Your details</span><i /><span className="on"><b>2</b> E-mail code</span><i /><span><b>3</b> Set up</span></div>
      <h1>Check your <span className="hl">e-mail</span></h1>
      <p className="lead">We sent a 6-digit code to the e-mail you gave. It proves the institute is yours and works for 15 minutes.</p>
      <VerifyForm />
      <ul className="au-perks" style={{ marginTop: 24 }}><li><MailCheck size={16} /> Not there? Look in Spam or Promotions, or send a new code.</li></ul>
    </SiteAuth>
  )
}
