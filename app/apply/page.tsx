import { ApplyView, type ApplyParams } from './apply-view'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Apply for admission' }

// The institute's admission form, on its own address: a link to share on social media, in ads, or as a QR code.
export default async function Page({ searchParams }: { searchParams: Promise<ApplyParams> }) {
  return <ApplyView params={await searchParams} embed={false} />
}
