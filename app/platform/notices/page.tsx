import { EndNotice, NoticeForm } from '@/components/platform-console'
import { requirePlatform } from '@/lib/platform/current'
import { listAllPlans, listAnnouncements } from '@/modules/platform/console'

// Notices shown to institutes (a maintenance window, a new feature): to everyone or to some plans, until they end.
export default async function Page() {
  await requirePlatform()
  const [items, plans] = await Promise.all([listAnnouncements(), listAllPlans()])
  return (
    <section className="page-container">
      <div className="page-heading"><div><p className="eyebrow">Platform</p><h1>Notices to institutes</h1><p className="subheading">Shown at the top of every institute’s panel while they run.</p></div></div>
      <NoticeForm plans={plans.map((p) => p.key)} />
      <div className="panel table-scroll"><table>
        <thead><tr><th>Notice</th><th>For</th><th>From</th><th>Until</th><th /></tr></thead>
        <tbody>
          {items.map((a) => <tr key={a.id}><td><strong>{a.title}</strong><small>{a.body}</small></td><td>{a.plans.join(', ') || 'everyone'}</td><td>{new Date(a.starts_at).toLocaleString('en-IN')}</td><td>{a.ends_at ? new Date(a.ends_at).toLocaleString('en-IN') : '—'}</td><td>{a.live && <EndNotice id={a.id} />}</td></tr>)}
          {!items.length && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 20, color: '#8b98aa' }}>No notices yet.</td></tr>}
        </tbody>
      </table></div>
    </section>
  )
}
