import { SitePage } from '@/components/site/shell'
import { PRODUCT } from '@/lib/product'

export const metadata = { title: 'Contact' }

export default function Contact() {
  return (
    <SitePage eyebrow="Contact" title="Talk to us" intro="Questions about plans, moving from your old software, or an Enterprise setup with your own domain: write to us and we answer within one working day.">
      <div className="site-prose">
        <p><strong>E-mail:</strong> <a href={`mailto:${PRODUCT.supportEmail}`}>{PRODUCT.supportEmail}</a></p>
        {PRODUCT.salesPhone && <p><strong>Phone:</strong> <a href={`tel:${PRODUCT.salesPhone.replace(/\s/g, '')}`}>{PRODUCT.salesPhone}</a></p>}
        {PRODUCT.address && <p><strong>Address:</strong> {PRODUCT.address}</p>}
        <p>Already a customer? Sign in to your institute and use Help, or e-mail us from the address on your account.</p>
      </div>
    </SitePage>
  )
}
