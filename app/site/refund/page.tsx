import { SitePage } from '@/components/site/shell'
import { PRODUCT } from '@/lib/product'

export const metadata = { title: `Refund policy | ${PRODUCT.name}` }

// A starting text. It must be reviewed by the owner's lawyer before launch.
export default function Refund() {
  return (
    <SitePage eyebrow="Legal" title="Cancellation and refund policy">
      <div className="site-prose">
        <p className="site-note">Template: to be reviewed by a lawyer before the service is offered to the public.</p>
        <h2>Free trial</h2>
        <p>The trial costs nothing and needs no card. If you do not choose a plan, nothing is charged.</p>
        <h2>Monthly plans</h2>
        <p>Cancel any time from Settings; the service continues to the end of the month you paid for. Months already started are not refunded.</p>
        <h2>Yearly plans</h2>
        <p>Cancel within 14 days of a yearly payment for a full refund. After that, the service continues to the end of the paid year and the rest of the year is not refunded.</p>
        <h2>Upgrades and downgrades</h2>
        <p>An upgrade takes effect at once; you pay only the difference for the rest of the period. A downgrade takes effect at the next renewal.</p>
        <h2>Payment errors</h2>
        <p>A payment taken twice, or taken after you cancelled, is refunded in full within 7 working days of you telling us.</p>
        <p>Refunds go back to the method you paid with. Write to <a href={`mailto:${PRODUCT.supportEmail}`}>{PRODUCT.supportEmail}</a>.</p>
      </div>
    </SitePage>
  )
}
