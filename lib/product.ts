// The platform's own name and contacts, for the public site, e-mails from the platform and the console. Set by the
// owner in the environment until a name is chosen (PLAN.md: decisions for the owner).
const root = process.env.ROOT_DOMAIN?.toLowerCase()

export const PRODUCT = {
  name: process.env.PRODUCT_NAME || 'Institute SaaS',
  supportEmail: process.env.SUPPORT_EMAIL || (root ? `support@${root}` : 'support@example.com'),
  salesPhone: process.env.SALES_PHONE || '',
  legalName: process.env.PLATFORM_LEGAL_NAME || process.env.PRODUCT_NAME || 'Institute SaaS',
  address: process.env.PLATFORM_ADDRESS || '',
}

/** How an institute's address looks, for the sign-up form: acme.<root> (acme.localhost:3000 in development). */
export const addressSuffix = () => (root ? `.${root}` : `.localhost:${process.env.PORT || '3000'}`)
