'use client'
// Announcements: the notice board students see on their portal home. Head office posts to every branch or to one;
// a branch manager to their own branch. Pinned ones stay on top; an end date takes one down by itself.
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Megaphone, Pin, PinOff, Plus } from 'lucide-react'
import { pinAnnouncementAction, postAnnouncementAction, removeAnnouncementAction } from '@/app/actions'
import { DeleteButton } from '@/components/delete-button'
import { Err, Modal } from '@/components/modal'
import { useNotify } from '@/components/panel-shell'
import type { Announcement } from '@/modules/support/service'
import { todayIST } from '@/lib/ist'

const day = (d: string) => new Date(d.length > 10 ? d : `${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export function AnnouncementsPanel({ rows, canPost, isSuper, branches, actingBranchId, templates = [] }: {
  rows: Announcement[]; canPost: boolean; isSuper: boolean; branches: { id: string; code: string; name: string }[]; actingBranchId: string | null
  /** ready-made announcements (Message templates) to start from */
  templates?: { title: string; body: string }[]
}) {
  const router = useRouter()
  const notify = useNotify()
  const [adding, setAdding] = useState(false)
  const [pending, start] = useTransition()
  const today = todayIST()
  const pin = (a: Announcement) => start(async () => { const r = await pinAnnouncementAction(a.id, !a.pinned); notify(r.ok ? (a.pinned ? 'Unpinned' : 'Pinned to the top') : r.error); router.refresh() })
  return (
    <section className="page-container table-page">
      <div className="page-heading">
        <div><p className="eyebrow">Students &amp; classes / Announcements</p><h1>Announcements</h1><p className="subheading">The notice board on every student&apos;s portal home: holidays, exams, events, fee dates.{isSuper ? ' Post to every branch or to one.' : ' What you post shows to the students of your branch.'}</p></div>
        <div className="heading-actions">{canPost && <button className="button primary" onClick={() => setAdding(true)}><Plus size={17} /> New announcement</button>}</div>
      </div>
      <div className="an-list">
        {rows.map((a) => {
          const ended = !!a.endsOn && a.endsOn < today
          return (
            <article key={a.id} className={`panel an-card${a.pinned ? ' pinned' : ''}${ended ? ' ended' : ''}`}>
              <div className="an-head">
                <div><h2>{a.pinned && <Pin size={14} />} {a.title}</h2>
                  <small>{a.branch ?? 'All branches'} · {day(a.createdAt)}{a.by ? ` · ${a.by}` : ''}{a.endsOn ? ` · ${ended ? 'ended' : 'shown until'} ${day(a.endsOn)}` : ''}</small></div>
                {canPost && (isSuper || a.branch) && <div className="row-actions">
                  <button type="button" className="filter-button icon-only" disabled={pending} title={a.pinned ? 'Unpin' : 'Pin to the top'} aria-label={a.pinned ? 'Unpin' : 'Pin'} onClick={() => pin(a)}>{a.pinned ? <PinOff size={14} /> : <Pin size={14} />}</button>
                  <DeleteButton what={`Announcement “${a.title}”`} run={() => removeAnnouncementAction(a.id)} onDone={() => router.refresh()} />
                </div>}
              </div>
              <p className="an-body">{a.body}</p>
            </article>
          )
        })}
        {!rows.length && <div className="panel hd-empty"><Megaphone size={34} /><p>No announcements yet.{canPost ? ' Post one and every student sees it on their portal.' : ''}</p></div>}
      </div>
      {adding && <AddForm isSuper={isSuper} branches={branches} actingBranchId={actingBranchId} templates={templates} onClose={() => setAdding(false)} onDone={() => { setAdding(false); notify('Announcement posted'); router.refresh() }} />}
    </section>
  )
}

function AddForm({ isSuper, branches, actingBranchId, templates, onClose, onDone }: { isSuper: boolean; branches: { id: string; code: string; name: string }[]; actingBranchId: string | null; templates: { title: string; body: string }[]; onClose: () => void; onDone: () => void }) {
  const formRef = useRef<HTMLFormElement>(null)
  /** puts a ready-made announcement in the title and message, to finish off */
  const applyTemplate = (i: number) => {
    const t = templates[i], f = formRef.current
    if (!t || !f) return
    ;(f.elements.namedItem('title') as HTMLInputElement).value = t.title
    ;(f.elements.namedItem('body') as HTMLTextAreaElement).value = t.body
  }
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    start(async () => {
      const r = await postAnnouncementAction({
        title: String(fd.get('title') ?? ''), body: String(fd.get('body') ?? ''), pinned: fd.get('pinned') === 'on',
        endsOn: String(fd.get('endsOn') ?? '') || null, branchId: isSuper ? String(fd.get('branch') ?? '') || null : undefined,
      })
      if (!r.ok) return setError(r.error)
      onDone()
    })
  }
  return (
    <Modal title="New announcement" onClose={onClose}>
      <form ref={formRef} onSubmit={submit}>
        <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
          {templates.length > 0 && <label>Start from a template<select defaultValue="" onChange={(e) => e.target.value !== '' && applyTemplate(Number(e.target.value))}><option value="">— Write from scratch —</option>{templates.map((t, i) => <option key={i} value={i}>{t.title}</option>)}</select><small className="reg-note">Fills the title and message; change the [bracketed] parts before posting. Edit these in Message templates.</small></label>}
          <label>Title<span className="required-mark">*</span><input name="title" required maxLength={150} placeholder="e.g. Diwali holidays: 31 Oct – 3 Nov" /></label>
          <label className="full-label">Message<span className="required-mark">*</span><textarea name="body" rows={5} required maxLength={5000} placeholder="What students should know" /></label>
          {isSuper && <label>Shown to<select name="branch" defaultValue={actingBranchId ?? ''}><option value="">Every branch</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}</select></label>}
          <label>Show until (optional)<input name="endsOn" type="date" /></label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input name="pinned" type="checkbox" style={{ width: 'auto', margin: 0 }} /> Pin to the top</label>
        </div>
        <Err msg={error} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Posting…' : 'Post announcement'}</button></div>
      </form>
    </Modal>
  )
}
