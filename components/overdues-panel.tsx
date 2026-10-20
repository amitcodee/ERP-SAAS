'use client'
// Overdues: two tabs (leads past their follow-up date, fees past their installment date). Each item climbs on its own:
// with its owner -> the branch manager -> head office, by the days set in Settings -> Rules. Following the lead up
// (a new date) or taking the payment clears it. Filters live in the address, so a view can be bookmarked.
import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { AlarmClock, IndianRupee, PhoneCall, Search } from 'lucide-react'
import type { Level, Overdues } from '@/modules/overdues/service'

const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN')
const day = (k: string) => new Date(`${k}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const LEVEL: Record<Level, { label: string; tone: string }> = {
  0: { label: 'With the owner', tone: 'amber' },
  1: { label: 'Branch manager', tone: 'red' },
  2: { label: 'Head office', tone: 'violet' },
}
type Filters = { tab: string; level: string; age: string; kind: string; mine: string; branch: string; q: string }

export function OverduesPanel({ data: d, filters, branches, showBranch, role }: { data: Overdues; filters: Filters; branches: { id: string; name: string }[]; showBranch: boolean; role: 'headOffice' | 'manager' | null }) {
  const router = useRouter()
  const path = usePathname()
  const [q, setQ] = useState(filters.q)
  const go = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch }
    router.push(`${path}?${new URLSearchParams(Object.entries(next).filter(([, v]) => v))}`)
  }
  const t = d.thresholds
  const leads = d.tab === 'leads'
  const c = leads ? d.counts.leads : d.counts.fees
  const mine = role
  const levels: [string, string, number][] = [['', 'All overdue', c.all], ['head_office', 'With head office', c.headOffice], ['manager', 'With the branch manager', c.manager], ['owner', 'Not escalated yet', c.owner]]
  const rule = leads
    ? `A lead goes to the branch manager ${t.leadManager} day${t.leadManager === 1 ? '' : 's'} after its follow-up date, and to head office after ${t.leadHeadOffice}.`
    : `A fee goes to the branch manager ${t.feeManager} day${t.feeManager === 1 ? '' : 's'} after its installment date, and to head office after ${t.feeHeadOffice}.`
  const cols = leads ? (showBranch ? 9 : 8) : (showBranch ? 9 : 8)

  return (
    <section className="page-container table-page col-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Overview / Overdues</p>
          <h1>Overdues</h1>
          <p className="subheading">Leads past their follow-up date and fees past their installment date. They go up on their own: to the branch manager, then to head office, who also get them by e-mail every morning. Following the lead up or taking the payment clears it.</p>
        </div>
      </div>

      <div className="cd-tabs" role="tablist" aria-label="Overdues">
        {d.can.leads && <button type="button" role="tab" aria-selected={leads} className={leads ? 'on' : ''} onClick={() => go({ tab: 'leads', level: filters.level, kind: '' })}><PhoneCall size={14} /> Leads<b>{d.counts.leads.all}</b></button>}
        {d.can.fees && <button type="button" role="tab" aria-selected={!leads} className={!leads ? 'on' : ''} onClick={() => go({ tab: 'fees', level: filters.level, kind: '' })}><IndianRupee size={14} /> Fees<b>{d.counts.fees.all}</b></button>}
      </div>

      <div className="table-summary">
        <div><strong className="text-violet">{c.headOffice}</strong><span>With head office</span></div>
        <div><strong className="text-red">{c.manager}</strong><span>With the branch manager</span></div>
        <div><strong className="text-amber">{c.owner}</strong><span>Not escalated yet</span></div>
        {leads ? <div><strong>{c.all}</strong><span>Overdue leads</span></div> : <div><strong className="text-red">{inr(d.counts.fees.amount)}</strong><span>Overdue amount</span></div>}
      </div>
      {mine && (mine === 'headOffice' ? c.headOffice : c.manager + c.headOffice) > 0 && (
        <p className="fee-note" role="status"><AlarmClock size={14} style={{ verticalAlign: '-2px' }} /> {mine === 'headOffice' ? c.headOffice : c.manager + c.headOffice} {leads ? 'lead' : 'fee'}{(mine === 'headOffice' ? c.headOffice : c.manager + c.headOffice) === 1 ? ' has' : 's have'} reached you. <button type="button" className="link-button" onClick={() => go({ level: mine === 'headOffice' ? 'head_office' : 'manager' })}>Show them</button></p>
      )}

      <div className="panel col-filters">
        <div className="col-presets" role="group" aria-label="Escalation">{levels.map(([v, l, n]) => <button key={l} type="button" className={filters.level === v ? 'on' : ''} onClick={() => go({ level: v })}>{l} · {n}</button>)}</div>
        <div className="col-controls">
          <form onSubmit={(e) => { e.preventDefault(); go({ q }) }}><label>Search<span className="cd-search"><Search size={15} /><input value={q} placeholder={leads ? 'Name or phone' : 'Name, phone or registration no.'} onChange={(e) => setQ(e.target.value)} /></span></label></form>
          <label>Overdue by<select value={filters.age} onChange={(e) => go({ age: e.target.value })}><option value="">Any time</option><option value="1-7">1–7 days</option><option value="8-30">8–30 days</option><option value="31-90">31–90 days</option><option value="90+">Over 90 days</option></select></label>
          {leads && <label>Lead<select value={filters.kind} onChange={(e) => go({ kind: e.target.value })}><option value="">Enquiries and calls</option><option value="enquiry">Enquiries</option><option value="call">Random calls</option></select></label>}
          <label>Whose<select value={filters.mine} onChange={(e) => go({ mine: e.target.value })}><option value="">Everyone&apos;s</option><option value="1">{leads ? 'Mine (assigned to me)' : 'Mine (I admitted)'}</option></select></label>
          {showBranch && <label>Branch<select value={filters.branch} onChange={(e) => go({ branch: e.target.value })}><option value="">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
        </div>
      </div>

      <div className="panel table-panel">
        <div className="panel-header"><div><h2>{leads ? 'Overdue leads' : 'Overdue fees'}</h2><span>{(leads ? d.leads.length : d.fees.length) < d.total ? `Showing ${leads ? d.leads.length : d.fees.length} of ${d.total}, oldest first. Filter to narrow.` : `${d.total} ${leads ? 'lead' : 'student'}${d.total === 1 ? '' : 's'}, highest escalation and oldest first.`} {rule}</span></div></div>
        <div className="table-scroll"><table>
          {leads ? (
            <thead><tr><th>Lead</th><th>Course</th>{showBranch && <th>Branch</th>}<th>Status</th><th>Follow-up was</th><th>Overdue</th><th>Owner</th><th>Escalated to</th><th /></tr></thead>
          ) : (
            <thead><tr><th>Student</th><th>Course</th>{showBranch && <th>Branch</th>}<th>Overdue</th><th>Balance</th><th>Oldest due</th><th>Overdue for</th><th>Admitted by</th><th>Escalated to</th></tr></thead>
          )}
          <tbody>
            {leads && d.leads.map((r) => (
              <tr key={`${r.kind}-${r.id}`}>
                <td><strong>{r.kind === 'enquiry' ? <Link href={`/lead-cycle/${r.id}`} className="lead-name-link">{r.name}</Link> : r.name}</strong><small>{r.phone}{r.kind === 'call' ? ' · random call' : ''}</small></td>
                <td>{r.course ?? '—'}</td>
                {showBranch && <td>{r.branch}</td>}
                <td>{r.status.replace(/_/g, ' ')}{r.interestPct != null && <small>{r.interestPct}% interested</small>}</td>
                <td>{day(r.dueOn)}</td>
                <td><strong className={r.level ? 'text-red' : 'text-amber'}>{r.days} day{r.days === 1 ? '' : 's'}</strong></td>
                <td>{r.owner ?? '—'}</td>
                <td><span className={`status-badge status-${LEVEL[r.level].tone}`}><span className="status-dot" />{LEVEL[r.level].label}</span></td>
                <td><Link className="filter-button" href={r.kind === 'enquiry' ? '/enquiries/update' : '/calls'} title={r.kind === 'enquiry' ? 'Follow it up in Enquiry Update' : 'Follow it up in Random Call'}>Follow up</Link></td>
              </tr>
            ))}
            {!leads && d.fees.map((r) => (
              <tr key={r.registrationId}>
                <td><strong><Link href={`/fees/${r.registrationId}`} className="lead-name-link">{r.name}</Link></strong><small>{r.regNo} · {r.phone}</small></td>
                <td>{r.course ?? '—'}</td>
                {showBranch && <td>{r.branch}</td>}
                <td><strong className="text-red">{inr(r.overdue)}</strong><small>{r.installments} installment{r.installments === 1 ? '' : 's'}</small></td>
                <td>{inr(r.balance)}</td>
                <td>{day(r.oldestDue)}</td>
                <td><strong className={r.level ? 'text-red' : 'text-amber'}>{r.days} day{r.days === 1 ? '' : 's'}</strong></td>
                <td>{r.owner ?? '—'}</td>
                <td><span className={`status-badge status-${LEVEL[r.level].tone}`}><span className="status-dot" />{LEVEL[r.level].label}</span></td>
              </tr>
            ))}
            {!(leads ? d.leads.length : d.fees.length) && <tr><td colSpan={cols} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>{filters.level || filters.age || filters.q || filters.kind || filters.mine || filters.branch ? 'Nothing matches these filters.' : leads ? 'No lead is past its follow-up date.' : 'No fee is past its due date.'}</td></tr>}
          </tbody>
        </table></div>
      </div>
    </section>
  )
}
