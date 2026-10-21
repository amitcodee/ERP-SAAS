import type { Metadata, Viewport } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'
import { connection } from 'next/server'
import { SelectPopups } from '@/components/select-popup'
import { PRODUCT } from '@/lib/product'
import { requestOrg } from '@/lib/tenant/request'
import { BrandProvider, NEUTRAL_BRAND } from '@/components/brand-context'
import { orgBrand } from '@/lib/brand'

const sans = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })

// Titles carry the name of the institute whose address this is (the platform's own name on its site and console).
export async function generateMetadata(): Promise<Metadata> {
  const org = await requestOrg().catch(() => null)
  const name = org?.name ?? PRODUCT.name
  return { ...META, title: { default: name, template: `%s | ${name}` } }
}

const META: Metadata = {
  description: 'Admissions, fees, classes and certificates for institutes.',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const org = await requestOrg().catch(() => null)
  const brand = org ? await orgBrand(org.id) : NEUTRAL_BRAND
  // every page is rendered per request, so Next.js can put this request's CSP nonce (proxy.ts) on its scripts
  await connection()
  return (
    // the institute's colour drives the palette (--navy and its shades, globals.css)
    <html lang="en" className={sans.variable} style={{ '--navy': brand.color } as React.CSSProperties}>
      <body className="antialiased">
        {/* on an institute's address, every client component can read its brand (useBrand) */}
        <BrandProvider brand={brand}>{children}</BrandProvider>
        <SelectPopups />
      </body>
    </html>
  )
}
