import { notFound } from 'next/navigation'
import { requestHost } from '@/lib/tenant/request'

export const dynamic = 'force-dynamic'

// The platform's public site lives on the apex domain only (the proxy maps its paths onto /site/*).
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  if ((await requestHost()).kind !== 'apex') notFound()
  return children
}
