export const dynamic = 'force-dynamic'
import { notFound } from 'next/navigation'
import { Screen } from '@/components/screen'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { leadCategoryMembers } from '@/modules/catalog/service'

// One lead category: every random call, lead and visited enquiry that carries it.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const b = await requirePage('Lead Categories')
  const { id } = await params
  const d = await withTenant(b.actor, (tx) => leadCategoryMembers(tx, id))
  if (!d) notFound()
  return <Screen name="leadCategory" props={{ category: d.category, members: d.members, canBroadcast: b.ok('create', 'broadcast') }} />
}
