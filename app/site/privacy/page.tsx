import { SitePage } from '@/components/site/shell'
import { PRODUCT } from '@/lib/product'

export const metadata = { title: `Privacy policy | ${PRODUCT.name}` }

// A starting text that matches how the service handles data (DPDP Act 2023: the institute is the data fiduciary for
// its students' data, we are its processor). It must be reviewed by the owner's lawyer before launch.
export default function Privacy() {
  const n = PRODUCT.legalName
  return (
    <SitePage eyebrow="Legal" title="Privacy policy">
      <div className="site-prose">
        <p className="site-note">Template: to be reviewed by a lawyer before the service is offered to the public.</p>
        <h2>Who decides what happens to the data</h2>
        <p>Each institute decides what personal data of its students, parents and staff it keeps in {PRODUCT.name}, and why. For that data the institute is the data fiduciary and {n} processes it on the institute’s behalf, under the Digital Personal Data Protection Act, 2023. For the data of the people who sign up and pay (the institute’s owner and billing contacts), {n} is the data fiduciary.</p>
        <h2>What we keep</h2>
        <ul>
          <li>Account details: names, e-mail addresses, phone numbers and encrypted passwords.</li>
          <li>The institute’s records, as the institute enters them.</li>
          <li>Sign-in records (time, IP address, browser) to protect accounts.</li>
          <li>Billing details: what was paid and when. Card and bank details stay with the payment provider; we never see them.</li>
        </ul>
        <h2>How it is protected</h2>
        <ul>
          <li>Each institute’s data is kept apart by the database itself.</li>
          <li>Passwords are stored as one-way hashes; identity numbers such as Aadhaar are stored encrypted, shown masked.</li>
          <li>Every change is recorded in the institute’s audit log.</li>
          <li>Our staff see an institute’s records only in a support session the institute can see and end.</li>
          <li>Data is held in India and backed up daily.</li>
        </ul>
        <h2>Who else processes it</h2>
        <p>Only the services needed to run the service: hosting, e-mail delivery, SMS and WhatsApp delivery (when the institute switches them on) and payment processing. Each is bound to use the data only for that.</p>
        <h2>How long</h2>
        <p>While the institute uses the service, and for 30 days after it leaves (so it can export its data). Backups age out within 35 days after that.</p>
        <h2>Your rights</h2>
        <p>Students, parents and staff: ask your institute to see, correct or erase your data; it can do so in the service. Account holders: write to <a href={`mailto:${PRODUCT.supportEmail}`}>{PRODUCT.supportEmail}</a>.</p>
        <h2>Cookies</h2>
        <p>Only the cookies needed to keep you signed in. No advertising or tracking cookies.</p>
      </div>
    </SitePage>
  )
}
