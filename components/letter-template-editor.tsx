'use client'
// Letter Templates (head office): the wording of the internship letters per company, with {{variables}} for the
// intern's details. Top: the company (techcadd, Syntax Developer…) and its letters. Left: the text, simple formatting
// buttons and every variable (click to insert). Right: the letter as it will print, on the company's letterhead with
// sample details. Issued letters keep the wording they had; a change applies to letters issued after it.
import { useMemo, useRef, useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Bold, Building2, Heading1, Heading2, List, ListOrdered, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { createLetterTemplateAction, deleteLetterTemplateAction, resetLetterTemplateAction, saveLetterTemplateAction } from '@/app/actions'
import { LetterSheet } from '@/components/letter-body'
import { useNotify } from '@/components/panel-shell'
import { fill } from '@/lib/letters/render'
import { LETTER_TITLE, SAMPLE, VARIABLES, type LetterKind } from '@/lib/letters/standard'
import type { LetterCompany, TemplateRef } from '@/modules/letters/service'
import { LetterCompanies } from '@/components/letter-companies'

const KNOWN = new Set(VARIABLES.map((v) => v.key))

export function LetterTemplateEditor({ kind, template, templates, companies, company, art }: {
  kind: LetterKind; template: TemplateRef & { body: string }; templates: TemplateRef[]
  companies: LetterCompany[]; company: LetterCompany; art: { letterhead: string; stamp: string | null }
}) {
  const { body, edited, updatedAt } = template
  const isStd = template.id === null
  const router = useRouter()
  const path = usePathname()
  const notify = useNotify()
  const [text, setText] = useState(body)
  const [find, setFind] = useState('')
  const [name, setName] = useState(template.name)
  const [newName, setNewName] = useState('')
  const [pending, start] = useTransition()
  const [managing, setManaging] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const dirty = text !== body || (!isStd && name !== template.name)
  const unknown = useMemo(() => [...new Set([...text.matchAll(/\{\{\s*([A-Za-z_]+)\s*\}\}/g)].map((m) => m[1]).filter((k) => !KNOWN.has(k)))], [text])
  const used = useMemo(() => new Set([...text.matchAll(/\{\{\s*([A-Za-z_]+)\s*\}\}/g)].map((m) => m[1])), [text])

  /** Puts text at the cursor (or wraps the selection) and keeps the cursor after it. */
  const insert = (before: string, after = '', linePrefix = false) => {
    const el = area.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b } = el
    let start = a
    if (linePrefix) start = text.lastIndexOf('\n', a - 1) + 1
    const next = linePrefix ? text.slice(0, start) + before + text.slice(start) : text.slice(0, a) + before + text.slice(a, b) + after + text.slice(b)
    setText(next)
    requestAnimationFrame(() => { el.focus(); const pos = linePrefix ? a + before.length : b + before.length + after.length; el.setSelectionRange(pos, pos) })
  }
  const open = (k: LetterKind, id: string | null, c = company.id) => { if (dirty && !confirm('Leave without saving your changes?')) return; router.push(`${path}?company=${c}&kind=${k}${id ? `&id=${id}` : ''}`) }
  const switchTo = (k: LetterKind) => open(k, null)

  return (
    <section className="page-container table-page col-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Documents / Letter Templates</p>
          <h1>Letter templates</h1>
          <p className="subheading">The wording of the internship letters, for each company interns are taken on by. Each <code>{'{{variable}}'}</code> is replaced by the intern&apos;s details when a letter is made. A change applies to letters issued after you save; letters already issued keep their wording.</p>
        </div>
        <button type="button" className="button secondary" onClick={() => setManaging(true)}><Building2 size={15} /> Companies</button>
      </div>

      <div className="te-templates" role="tablist" aria-label="Company">
        <span className="te-templates-label">Company:</span>
        {companies.filter((c) => c.isActive || c.id === company.id).map((c) => <button key={c.id} type="button" role="tab" aria-selected={c.id === company.id} className={c.id === company.id ? 'on' : ''} onClick={() => open(kind, null, c.id)}>{c.name}</button>)}
      </div>

      <div className="cd-tabs" role="tablist">
        {(Object.keys(LETTER_TITLE) as LetterKind[]).map((k) => <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => switchTo(k)}>{LETTER_TITLE[k]}</button>)}
      </div>

      <div className="te-templates">
        <span className="te-templates-label">Templates:</span>
        {templates.map((t) => <button key={t.id ?? 'std'} type="button" className={t.id === template.id ? 'on' : ''} onClick={() => open(kind, t.id)}>{t.name}{t.id === null && t.edited ? ' (edited)' : ''}</button>)}
        <form className="te-new" onSubmit={(e) => { e.preventDefault(); if (!newName.trim()) return; start(async () => { const r = await createLetterTemplateAction(kind, newName, company.id); if (!r.ok) return notify(r.error); setNewName(''); notify('Template made from the Standard wording — change it and save'); router.push(`${path}?company=${company.id}&kind=${kind}&id=${r.data}`) }) }}>
          <input value={newName} placeholder="New template, e.g. Web Development Intern" onChange={(e) => setNewName(e.target.value)} />
          <button type="submit" className="button secondary" disabled={pending || !newName.trim()}><Plus size={14} /> New</button>
        </form>
      </div>

      <div className="te-layout">
        <div className="panel te-edit">
          <div className="te-tools" role="toolbar" aria-label="Formatting">
            <button type="button" title="Title (# at the start of a line)" onClick={() => insert('# ', '', true)}><Heading1 size={15} /></button>
            <button type="button" title="Section heading (## at the start of a line)" onClick={() => insert('## ', '', true)}><Heading2 size={15} /></button>
            <button type="button" title="Bold (**text**)" onClick={() => insert('**', '**')}><Bold size={15} /></button>
            <button type="button" title="Numbered line (1. at the start)" onClick={() => insert('1. ', '', true)}><ListOrdered size={15} /></button>
            <button type="button" title="Bullet (- at the start)" onClick={() => insert('- ', '', true)}><List size={15} /></button>
            <span className="te-status">{isStd ? '' : `${template.name} · `}{edited ? `Edited${updatedAt ? ` ${new Date(updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}` : 'Standard wording'}{dirty ? ' · unsaved changes' : ''}</span>
          </div>
          {!isStd && <label className="te-name">Template name<input value={name} onChange={(e) => setName(e.target.value)} /></label>}
          <textarea ref={area} className="te-text" value={text} onChange={(e) => setText(e.target.value)} spellCheck aria-label="Letter text" />
          {unknown.length > 0 && <p className="te-warn">Not a variable: {unknown.map((k) => `{{${k}}}`).join(', ')}. Check the spelling against the list below.</p>}
          <div className="te-actions">
            {isStd
              ? <button type="button" className="button secondary" disabled={pending || (!edited && !dirty)} onClick={() => { if (!confirm('Go back to the built-in standard wording? Your changes to the Standard are removed.')) return; start(async () => { const r = await resetLetterTemplateAction(kind, company.id); if (!r.ok) return notify(r.error); notify('Back to the standard wording'); router.refresh() }) }}><RotateCcw size={14} /> Reset to standard</button>
              : <button type="button" className="button secondary wl-danger" disabled={pending} onClick={() => { if (!confirm(`Delete the template “${template.name}”? Students who use it get the Standard; letters already issued keep their wording.`)) return; start(async () => { const r = await deleteLetterTemplateAction(template.id!); if (!r.ok) return notify(r.error); notify('Template deleted'); router.push(`${path}?company=${company.id}&kind=${kind}`) }) }}><Trash2 size={14} /> Delete template</button>}
            <button type="button" className="button secondary" disabled={!dirty || pending} onClick={() => { setText(body); setName(template.name) }}>Undo changes</button>
            <button type="button" className="button primary" disabled={!dirty || pending || unknown.length > 0} onClick={() => start(async () => { const r = await saveLetterTemplateAction(kind, template.id, text, isStd ? undefined : name, company.id); if (!r.ok) return notify(r.error); notify('Template saved'); router.refresh() })}><Save size={14} /> {pending ? 'Saving…' : 'Save'}</button>
          </div>

          <div className="te-vars">
            <div className="te-vars-head"><strong>Variables</strong><span>Click one to put it where the cursor is.</span><input value={find} placeholder="Find…" onChange={(e) => setFind(e.target.value)} /></div>
            <ul>
              {VARIABLES.filter((v) => !find || `${v.key} ${v.label}`.toLowerCase().includes(find.toLowerCase())).map((v) => (
                <li key={v.key}><button type="button" className={used.has(v.key) ? 'used' : ''} title={`Example: ${v.example}`} onClick={() => insert(`{{${v.key}}}`)}><code>{`{{${v.key}}}`}</code><span>{v.label}</span></button></li>
              ))}
            </ul>
          </div>
        </div>

        <div className="te-preview">
          <p className="section-hint" style={{ margin: '0 0 8px' }}>Preview with sample details on {company.name}&apos;s letterhead — this is how the letter prints.{!company.hasLetterhead && !company.isDefault ? ' A plain letterhead until one is uploaded (Companies).' : ''}</p>
          <div className="te-paper"><LetterSheet text={fill(text, { ...SAMPLE, company: company.legalName, company_name: company.name, contact_phone: company.contactPhone || SAMPLE.contact_phone, contact_email: company.contactEmail || SAMPLE.contact_email })} refNo={SAMPLE.ref_no} date={SAMPLE.date} letterhead={art.letterhead} sign={art.stamp} /></div>
        </div>
      </div>
      {managing && <LetterCompanies companies={companies} onClose={() => setManaging(false)} />}
    </section>
  )
}
