'use client'
// Certificate Designs: start a new design (from a ready-made template, a blank page or a picture) and the designs so
// far as small previews, each opening on the canvas. Head office's designs are offered to every branch.
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Eye, Pencil, Plus, Trash2 } from 'lucide-react'
import { archiveDesignAction } from '@/app/event-actions'
import { DesignSvg } from '@/components/cert-design-svg'
import { useNotify } from '@/components/panel-shell'
import { PRESETS, SAMPLE_VALUES } from '@/lib/cert-design'
import type { DesignRow } from '@/modules/events/service'

export function DesignsPanel({ designs, canEdit, branchName, isHeadOffice }: { designs: DesignRow[]; canEdit: boolean; branchName: string; isHeadOffice: boolean }) {
  const router = useRouter()
  const notify = useNotify()
  const [pending, start] = useTransition()
  const [error, setError] = useState('')
  const remove = (d: DesignRow) => {
    if (!confirm(`Remove “${d.name}” from the list?${d.usedBy ? ` ${d.usedBy} event(s) use it and keep printing it.` : ''}`)) return
    start(async () => {
      const r = await archiveDesignAction(d.id)
      if (!r.ok) return setError(r.error)
      notify('Design removed'); router.refresh()
    })
  }
  const mine = designs.filter((d) => d.branchId), shared = designs.filter((d) => !d.branchId)
  const card = (d: DesignRow) => (
    <div key={d.id} className="dp-card">
      <Link href={`/certificate-designs/${d.id}`} className="dp-thumb" aria-label={`Open ${d.name}`}>
        <DesignSvg design={d.design} values={SAMPLE_VALUES} style={{ width: '100%', display: 'block' }} />
      </Link>
      <div className="dp-meta">
        <strong>{d.name}</strong>
        <small>{d.branch ?? 'Head office · every branch'}{d.usedBy ? ` · used by ${d.usedBy} event${d.usedBy > 1 ? 's' : ''}` : ''}</small>
      </div>
      <div className="dp-actions">
        <Link className="button secondary" href={`/certificate-designs/${d.id}`}><Pencil size={13} /> {d.editable ? 'Edit' : 'Open'}</Link>
        <a className="button secondary" href={`/certificate-designs/${d.id}/preview`} target="_blank" rel="noreferrer"><Eye size={13} /> Preview</a>
        {d.editable && <button type="button" className="button secondary" aria-label={`Remove ${d.name}`} disabled={pending} onClick={() => remove(d)}><Trash2 size={13} /></button>}
      </div>
    </div>
  )
  return (
    <section className="page-container">
      <style>{CSS}</style>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Certificates / Certificate designs</p>
          <h1>Certificate Designs</h1>
          <p className="subheading">Design the certificates seminars, workshops and other events give out. Start from a template, a blank page, or a certificate picture (yours, or one from the internet) and put the participant’s details on it. Each person’s name, score and certificate number are filled in for them.</p>
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}

      {canEdit && <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-header"><div><h2><Plus size={16} /> New design</h2><span>{isHeadOffice ? 'Made at head office: offered to every branch.' : `For ${branchName}.`} Pick a starting point; everything can be changed on the canvas.</span></div></div>
        <div className="dp-grid">
          {PRESETS.map((p) => (
            <Link key={p.key} href={`/certificate-designs/new?start=${p.key}`} className="dp-card dp-new">
              <span className="dp-thumb"><DesignSvg design={p.make()} values={SAMPLE_VALUES} style={{ width: '100%', display: 'block' }} /></span>
              <span className="dp-meta"><strong>{p.name}</strong><small>{p.about}</small></span>
            </Link>
          ))}
          <Link href="/certificate-designs/new?start=blank" className="dp-card dp-new dp-blank"><span className="dp-thumb dp-empty">Blank landscape</span><span className="dp-meta"><strong>Blank page</strong><small>A4 landscape, nothing on it. Upload a certificate picture as the page, or build it up.</small></span></Link>
          <Link href="/certificate-designs/new?start=portrait" className="dp-card dp-new dp-blank"><span className="dp-thumb dp-empty dp-tall">Blank portrait</span><span className="dp-meta"><strong>Blank portrait</strong><small>A4 portrait.</small></span></Link>
        </div>
      </div>}

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-header"><div><h2>{isHeadOffice ? 'Branch designs' : 'This branch’s designs'}</h2><span>{mine.length ? `${mine.length} design${mine.length > 1 ? 's' : ''}` : 'None yet'}</span></div></div>
        {mine.length ? <div className="dp-grid">{mine.map(card)}</div> : <p className="section-hint">No designs yet{canEdit ? ': start one above.' : '.'}</p>}
      </div>
      <div className="panel">
        <div className="panel-header"><div><h2>Head office designs</h2><span>Offered to every branch{isHeadOffice ? '' : ': open one and save a copy to change it for your branch'}.</span></div></div>
        {shared.length ? <div className="dp-grid">{shared.map(card)}</div> : <p className="section-hint">None yet.</p>}
      </div>
    </section>
  )
}

const CSS = `
.dp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
.dp-card { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--line); border-radius: 14px; background: #fff; color: inherit; text-decoration: none; align-content: start; }
.dp-new:hover { border-color: #a5b4fc; box-shadow: 0 8px 24px -12px #4f46e566; }
.dp-thumb { display: block; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 6px #0f143722; background: #fff; }
.dp-thumb svg { max-height: 200px; }
.dp-empty { display: grid; place-items: center; aspect-ratio: 297 / 210; color: var(--faint); font-size: 12px; font-weight: 700; border: 2px dashed var(--line); box-shadow: none; }
.dp-tall { aspect-ratio: auto; height: 100%; min-height: 120px; }
.dp-meta { display: grid; gap: 2px; }
.dp-meta strong { color: var(--ink); font-size: 13.5px; }
.dp-meta small { color: var(--muted); font-size: 11.5px; line-height: 1.4; }
.dp-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.dp-actions .button { height: 32px; padding: 0 12px; font-size: 12px; }
`
