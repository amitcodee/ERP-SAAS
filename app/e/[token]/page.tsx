import { notFound } from 'next/navigation'
import { EventSignup } from '@/components/event-signup'
import { publicEvent } from '@/modules/events/service'
import { requireRequestOrg } from '@/lib/tenant/request'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sign up | techcadd', robots: { index: false } }

// The public page of a seminar / workshop, from its link or QR code: sign up, quiz, certificate. No sign-in.
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const e = await publicEvent((await requireRequestOrg()).id, (await params).token)
  if (!e) notFound()
  return <EventSignup e={e} />
}
