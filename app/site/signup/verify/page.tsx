import { VerifyForm } from '@/components/site/forms'
import { SitePage } from '@/components/site/shell'

export const metadata = { title: 'Confirm your e-mail' }

export default function VerifySignup() {
  return <SitePage eyebrow="One more step" title="Check your e-mail" intro="We sent a 6-digit code. It works for 15 minutes."><VerifyForm /></SitePage>
}
