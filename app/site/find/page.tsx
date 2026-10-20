import { FindForm } from '@/components/site/forms'
import { SitePage } from '@/components/site/shell'
import { PRODUCT } from '@/lib/product'

export const metadata = { title: `Find your institute | ${PRODUCT.name}` }

// Institutes sign in at their own address. Someone who does not remember it gets it by e-mail.
export default function Find() {
  return (
    <SitePage eyebrow="Sign in" title="Find your institute" intro="Each institute signs in at its own address. Enter your e-mail and we send you the sign-in link of every institute you belong to.">
      <FindForm />
    </SitePage>
  )
}
