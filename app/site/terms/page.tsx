import { SitePage } from '@/components/site/shell'
import { PRODUCT } from '@/lib/product'

export const metadata = { title: `Terms of service | ${PRODUCT.name}` }

// A starting text that matches how the service works. It must be reviewed by the owner's lawyer before launch.
export default function Terms() {
  const n = PRODUCT.legalName
  return (
    <SitePage eyebrow="Legal" title="Terms of service">
      <div className="site-prose">
        <p className="site-note">Template: to be reviewed by a lawyer before the service is offered to the public.</p>
        <h2>1. The service</h2>
        <p>{n} (“we”) provides {PRODUCT.name}, an online system for running an educational institute (“the service”), to the institute that signs up (“you”). You choose who in your institute uses it and what each of them may do.</p>
        <h2>2. Your account</h2>
        <p>The person who signs up is the institute’s owner and is responsible for the accounts made under it. Keep passwords private. Tell us at once if you think someone has used your account without permission.</p>
        <h2>3. Your data</h2>
        <p>The records you put in (students, fees, staff and the rest) belong to you. We process them only to provide the service, as described in the <a href="/privacy">privacy policy</a>, which forms part of these terms. You are responsible for having the right to put personal data into the service and for telling the people concerned, as the law requires.</p>
        <h2>4. Trial, plans and payment</h2>
        <p>A new institute gets a free trial. After it, the service continues on the plan you choose, paid in advance monthly or yearly. Prices are shown on the <a href="/pricing">pricing page</a> and are subject to GST. If a payment fails we remind you for 7 days; after that your institute becomes read-only until it is paid, and is suspended if it stays unpaid for 30 days more. Refunds follow the <a href="/refund">refund policy</a>.</p>
        <h2>5. Acceptable use</h2>
        <p>Do not use the service to break the law, to send messages people have not agreed to receive, or to try to reach another institute’s data or disrupt the service. We may suspend an account that does.</p>
        <h2>6. Availability and support</h2>
        <p>We aim to keep the service available at all times and back it up every day, but cannot promise it will never be interrupted. Our team only sees your institute’s records when you ask for help, through a support session that is limited in time, shown to your head office and recorded in your audit log.</p>
        <h2>7. Ending</h2>
        <p>You may cancel at any time; the service continues to the end of the paid period. You can export your data before and for 30 days after the end, after which it is deleted.</p>
        <h2>8. Liability</h2>
        <p>Our total liability in any year is limited to what you paid us in that year. We are not liable for indirect losses.</p>
        <h2>9. Law</h2>
        <p>These terms are governed by the laws of India.</p>
        <p>Questions: <a href={`mailto:${PRODUCT.supportEmail}`}>{PRODUCT.supportEmail}</a></p>
      </div>
    </SitePage>
  )
}
