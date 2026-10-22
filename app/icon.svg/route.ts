// The browser tab's icon: the institute's initials in its colour (the platform's own on its site and console), so a
// tab says whose panel it is. A logo is too detailed at 16 px; the initials are what the panel's own mark shows.
import { DEFAULT_COLOR, orgBrand } from '@/lib/brand'
import { PRODUCT } from '@/lib/product'
import { requestOrg } from '@/lib/tenant/request'

export const dynamic = 'force-dynamic'

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)

export async function GET() {
  const org = await requestOrg().catch(() => null)
  const brand = org ? await orgBrand(org.id).catch(() => null) : null
  const color = brand?.color ?? DEFAULT_COLOR
  const initials = (brand?.initials ?? PRODUCT.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()) || '·'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${esc(color)}"/><text x="32" y="${initials.length > 1 ? 41 : 43}" font-family="Arial, Helvetica, sans-serif" font-size="${initials.length > 1 ? 26 : 32}" font-weight="700" fill="#fff" text-anchor="middle">${esc(initials)}</text></svg>`
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' } })
}
