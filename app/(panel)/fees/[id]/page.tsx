export const dynamic = 'force-dynamic'
import { notFound, redirect } from 'next/navigation'
import { Screen } from '@/components/screen'
import { withTenant } from '@/lib/db/withTenant'
import { loadPanelBase } from '@/lib/panel/base'
import { cachedCatalogs } from '@/modules/catalog/service'
import { mayFixFees, studentFees } from '@/modules/fees/service'

// One student's fees on a page of its own (opened from the registrations table and the fees table).
// Whoever collects fees (admissions) works them here; accounts checks them and raises remarks for them to fix.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const b = await loadPanelBase()
  if (b.mustChange || b.session.role === 'student') redirect('/')
  const accounts = b.modules.includes('Fees')
  if (!accounts && !b.modules.includes('Registration')) redirect('/dashboard')
  const { id } = await params
  const d = await withTenant(b.actor, async (tx) => ({ fees: await studentFees(tx, b.actor, id), catalogs: await cachedCatalogs(tx, b.actor.orgId) }))
  if (!d.fees) notFound()
  return <Screen name="studentFees" props={{
    d: d.fees, paymentModes: d.catalogs.paymentModes, backHref: accounts ? '/fees' : '/registrations',
    canCollect: b.ok('create', 'fee'), canEdit: b.ok('update', 'fee'), canRemark: b.ok('clear', 'fee'), canFix: mayFixFees(b.actor), canDiscount: b.ok('create', 'fee') || b.ok('update', 'fee') || b.ok('approve', 'fee'), canReverse: b.ok('approve', 'fee'),
    canRequest: b.ok('update', 'registration') || b.ok('create', 'registration'),
  }} />
}
