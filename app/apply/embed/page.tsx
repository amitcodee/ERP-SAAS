import { ApplyView, type ApplyParams } from '../apply-view'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Apply for admission', robots: { index: false } }

// The same form inside the institute's own website (an iframe that /apply/embed.js places). This page alone may be
// framed by other sites (next.config.mjs and proxy.ts).
export default async function Page({ searchParams }: { searchParams: Promise<ApplyParams> }) {
  return <ApplyView params={await searchParams} embed />
}
