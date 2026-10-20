'use client'
// The lead cycle: one lead from the first contact to the certificate. A header with who it is, a bar of the stages
// reached, and every event on a timeline (oldest first) that can be filtered by kind and searched.
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Award, ClipboardCheck, FileText, Globe, History, IndianRupee, MapPin, Phone, PhoneCall, Search, UserPlus, Workflow } from 'lucide-react'
import type { CycleKind, LeadCycle } from '@/modules/enquiries/cycle'

const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN')
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
const day = (iso: string | null) => (iso ? new Date(iso.length > 10 ? iso : `${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '')

const KIND: Record<CycleKind, { label: string; icon: typeof Phone; tone: string }> = {
  web: { label: 'Website', icon: Globe, tone: 'teal' },
  call: { label: 'Calls', icon: PhoneCall, tone: 'blue' },
  followup: { label: 'Follow-ups', icon: Phone, tone: 'sky' },
  lead: { label: 'Lead', icon: UserPlus, tone: 'violet' },
  status: { label: 'Status changes', icon: Workflow, tone: 'indigo' },
  visit: { label: 'Visit / demo', icon: MapPin, tone: 'orange' },
  registration: { label: 'Registration', icon: FileText, tone: 'green' },
  payment: { label: 'Payments', icon: IndianRupee, tone: 'emerald' },
  certificate: { label: 'Certificate', icon: Award, tone: 'amber' },
  log: { label: 'System log', icon: History, tone: 'slate' },
}

export function LeadCyclePanel({ data: c }: { data: LeadCycle }) {
  const present = useMemo(() => (Object.keys(KIND) as CycleKind[]).filter((k) => c.events.some((e) => e.kind === k)), [c.events])
  const [off, setOff] = useState<Set<CycleKind>>(new Set(['log']))
  const [q, setQ] = useState('')
  const [newest, setNewest] = useState(false)
  const term = q.trim().toLowerCase()
  const shown = c.events.filter((e) => !off.has(e.kind) && (!term || `${e.title} ${e.text ?? ''} ${e.by ?? ''}`.toLowerCase().includes(term)))
  const list = newest ? [...shown].reverse() : shown
  const toggle = (k: CycleKind) => setOff((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const reached = c.stages.filter((s) => s.done).length
  const days = Math.max(0, Math.round((Date.now() - Date.parse(c.events[0]?.at ?? c.createdAt)) / 86400000))

  return (
    <section className="page-container table-page col-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow"><Link href="/enquiries/update" className="lc-back"><ArrowLeft size={13} /> Enquiry Update</Link> / Lead cycle</p>
          <h1>Lead cycle — {c.name}</h1>
          <p className="subheading">Everything that happened to this lead, from the first contact to the certificate, in the order it happened. {days ? `${days} day${days === 1 ? '' : 's'} since the first contact.` : ''}</p>
        </div>
      </div>

      <div className="panel lc-head">
        <dl>
          <div><dt>Lead ID</dt><dd className="id-text">{c.enquiryNo}</dd></div>
          {c.regNo && <div><dt>Student ID</dt><dd className="id-text">{c.regNo}</dd></div>}
          <div><dt>Name</dt><dd>{c.name}</dd></div>
          <div><dt>Phone</dt><dd><a href={`tel:${c.phone}`}>{c.phone}</a></dd></div>
          {c.email && <div><dt>E-mail</dt><dd>{c.email}</dd></div>}
          <div><dt>Course</dt><dd>{c.course ?? '—'}</dd></div>
          <div><dt>Source</dt><dd>{c.source ?? '—'}</dd></div>
          <div><dt>Branch</dt><dd>{c.branch}</dd></div>
          <div><dt>Status now</dt><dd>{c.status}</dd></div>
          <div><dt>Counsellor</dt><dd>{c.assignedTo ?? '—'}</dd></div>
          {c.nextFollowUp && <div><dt>Next follow-up</dt><dd>{day(c.nextFollowUp)}</dd></div>}
          {c.money && <div><dt>Fees</dt><dd>{inr(c.money.paid)} paid of {inr(c.money.total)}{c.money.balance > 0 ? <span className="text-red"> · {inr(c.money.balance)} due</span> : <span className="text-green"> · clear</span>}</dd></div>}
        </dl>
        <div className="lc-actions">
          <Link className="filter-button" href={`/enquiries/update?q=${encodeURIComponent(c.enquiryNo)}`}><ClipboardCheck size={14} /> Update this lead</Link>
          {c.registrationId && <Link className="filter-button" href={`/fees/${c.registrationId}`}><IndianRupee size={14} /> Fees</Link>}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><div><h2>Stages</h2><span>{reached} of {c.stages.length} reached. A filled step is done; the date is when it happened.</span></div></div>
        <ol className="lc-stages">
          {c.stages.map((s) => <li key={s.key} className={s.done ? 'done' : ''}><i /><strong>{s.label}</strong><span>{s.at ? day(s.at) : 'Not yet'}</span></li>)}
        </ol>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div><h2>Timeline</h2><span>{shown.length} of {c.events.length} events. Click a kind to hide or show it; the system log (every edit) is hidden until you turn it on.</span></div>
          <div className="reg-seg" role="radiogroup" aria-label="Order"><button type="button" className={!newest ? 'on' : ''} onClick={() => setNewest(false)}>Oldest first</button><button type="button" className={newest ? 'on' : ''} onClick={() => setNewest(true)}>Newest first</button></div>
        </div>
        <div className="lc-filters">
          {present.map((k) => { const K = KIND[k]; const n = c.events.filter((e) => e.kind === k).length; return (
            <button key={k} type="button" className={`lc-chip tone-${K.tone}${off.has(k) ? '' : ' on'}`} aria-pressed={!off.has(k)} onClick={() => toggle(k)}><K.icon size={13} /> {K.label} <b>{n}</b></button>
          ) })}
          <label className="cd-search lc-search"><Search size={15} /><input value={q} placeholder="Search the timeline" onChange={(e) => setQ(e.target.value)} /></label>
        </div>
        {list.length ? (
          <ol className="lc-timeline">
            {list.map((e, i) => { const K = KIND[e.kind]; return (
              <li key={i} className={`tone-${K.tone}`}>
                <span className="lc-dot"><K.icon size={14} /></span>
                <div>
                  <div className="lc-row"><strong>{e.title}</strong><time>{when(e.at)}</time></div>
                  {e.text && <p>{e.text}</p>}
                  <small>{K.label}{e.by ? ` · by ${e.by}` : ''}</small>
                </div>
              </li>
            ) })}
          </ol>
        ) : <p className="section-hint" style={{ margin: 0 }}>Nothing matches. Turn a kind back on or clear the search.</p>}
      </div>
    </section>
  )
}
