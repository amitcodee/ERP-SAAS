export const dynamic = 'force-dynamic'
import { notFound, redirect } from 'next/navigation'
import { LeadCyclePanel } from '@/components/lead-cycle'
import { loadPanelBase } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { leadCycle } from '@/modules/enquiries/cycle'

// The lead cycle of one lead: everything that happened to it, start to end (opened from a student's name).
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const b = await loadPanelBase()
  if (b.mustChange || b.session.role === 'student') redirect('/')
  if (!['Leads', 'Enquiry', 'Enquiry Update', 'My Leads'].some((k) => b.modules.includes(k as never))) redirect('/dashboard')
  const { id } = await params
  const data = await withTenant(b.actor, (tx) => leadCycle(tx, b.actor, id))
  if (!data) notFound()
  return <LeadCyclePanel data={data} />
}
