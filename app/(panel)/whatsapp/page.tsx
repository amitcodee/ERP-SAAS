export const dynamic = 'force-dynamic'
import { sql } from 'drizzle-orm'
import { BulkWhatsApp } from '@/components/bulk-whatsapp'
import { getConfig } from '@/lib/config/store'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { listBroadcasts, listCampaigns, MAX_RECIPIENTS } from '@/modules/notifications/broadcasts'

// Bulk WhatsApp: pick a campaign (listed by head office in Settings → WhatsApp campaigns), pick the students or leads
// (branch, course, status, fee, lead category, dates), see who it goes to and how it reads, send. Below, what was sent.
// ?category=<id> opens it on that lead category (from Lead Categories).
export default async function Page({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const b = await requirePage('Bulk WhatsApp')
  const { category } = await searchParams
  const wa = await getConfig(b.actor.orgId, 'whatsapp')
  const data = await withTenant(b.actor, async (tx) => ({
    campaigns: await listCampaigns(tx, { activeOnly: true }),
    broadcasts: await listBroadcasts(tx, b.actor),
    departments: (await tx.execute<{ id: string; name: string }>(sql`select id, name from departments where is_active and status = 'approved' order by name`)).rows,
    courses: (await tx.execute<{ id: string; title: string; department_id: string }>(sql`select id, title, department_id from courses where is_active and status = 'approved' order by title`)).rows,
    categories: (await tx.execute<{ id: string; name: string }>(sql`select id, name from lead_categories where is_active order by sort_order, name`)).rows,
  }))
  return (
    <BulkWhatsApp
      {...data}
      branches={b.isSuper && !b.actor.branchId ? b.branches.map((x) => ({ id: x.id, name: x.name })) : null}
      branchName={b.user.branchName}
      canSend={b.ok('create', 'broadcast')}
      isSuper={b.isSuper}
      whatsappOn={!!wa.config.enabled && (wa.config.provider === 'meta' ? !!wa.secrets.token : !!wa.secrets.apiKey)}
      max={MAX_RECIPIENTS}
      category={category ?? null}
    />
  )
}
