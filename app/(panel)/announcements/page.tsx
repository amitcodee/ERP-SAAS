export const dynamic = 'force-dynamic'
import { AnnouncementsPanel } from '@/components/announcements-panel'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { canPostAnnouncements, listAnnouncements } from '@/modules/support/service'
import { announcementTemplates } from '@/modules/templates/service'

// Announcements: the notice board on the student portal, with the ended ones too (for those who post).
export default async function Page() {
  const b = await requirePage('Announcements')
  const { rows, templates } = await withTenant(b.actor, async (tx) => ({
    rows: await listAnnouncements(tx, b.actor, true),
    templates: canPostAnnouncements(b.actor) ? (await announcementTemplates(tx, b.actor.branchId)).map((t) => ({ title: t.title, body: t.body })) : [],
  }))
  return <AnnouncementsPanel rows={rows} canPost={canPostAnnouncements(b.actor)} isSuper={b.isSuper} actingBranchId={b.actor.branchId} templates={templates}
    branches={b.branches.map((x) => ({ id: x.id, code: x.code, name: x.name }))} />
}
