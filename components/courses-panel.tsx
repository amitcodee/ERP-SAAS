'use client'

import { useState, useTransition } from 'react'
import { BookOpen, Check, Pencil, Plus, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { deleteCourseAction } from '@/app/actions'
import { ChipInput, splitChips } from '@/components/chip-input'
import { DeleteButton } from '@/components/delete-button'
import { createCourseAction, decideCourseAction, updateCourseSkillsAction } from '@/app/actions'
import { Err, Modal } from '@/components/modal'
import { SyllabusEditor } from '@/components/syllabus-editor'
import type { SyllabusChangeRow } from '@/modules/teaching/service'
import { ListToolbar, SortTh } from '@/components/list-toolbar'
import { Pager } from '@/components/pager'
import { useLocalList } from '@/components/use-local-list'
import type { Catalogs } from '@/modules/catalog/service'

export type CourseRow = {
  id: string; title: string; department: string; baseFee: number; durationWeeks: number | null; skills?: string | null
  /** pending: added by a branch admin, waiting for head office; only approved courses can be picked in forms */
  status: 'approved' | 'pending' | 'rejected'; requestedBranch: string | null; rejectionReason: string | null
  topics: number; syllabusFile: boolean
}

export function CoursesPanel({ rows, catalogs, canCreate, canEdit, isSuper, canSyllabus, syllabusChanges = [], notify }: {
  rows: CourseRow[]; catalogs: Catalogs; canCreate: boolean; canEdit: boolean; isSuper: boolean; canSyllabus: boolean; syllabusChanges?: SyllabusChangeRow[]; notify: (m: string) => void
}) {
  const [syllabusOf, setSyllabusOf] = useState<{ id: string; title: string; fresh?: boolean } | null>(null)
  const [rejecting, setRejecting] = useState<CourseRow | null>(null)
  const [reason, setReason] = useState('')
  const decide = (c: CourseRow, approve: boolean, why?: string) => start(async () => {
    const r = await decideCourseAction(c.id, approve, why)
    if (!r.ok) return notify(r.error)
    setRejecting(null); setReason(''); notify(approve ? `${c.title} approved: it can now be picked in forms` : `${c.title} turned down`); router.refresh()
  })
  const waiting = rows.filter((c) => c.status === 'pending').length
  const [adding, setAdding] = useState(false)
  const router = useRouter()
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const list = useLocalList(rows, {
    text: (c) => `${c.title} ${c.department}`,
    filters: { dept: (c, v) => c.department === v, fee: (c, v) => (v === 'u25' ? c.baseFee < 2500000 : v === '25to50' ? c.baseFee >= 2500000 && c.baseFee <= 5000000 : c.baseFee > 5000000) },
    sorts: { title: (c) => c.title, dept: (c) => c.department, fee: (c) => c.baseFee, weeks: (c) => c.durationWeeks },
  })
  const [skillsFor, setSkillsFor] = useState<CourseRow | null>(null)
  const [skillsText, setSkillsText] = useState('')
  const [newSkills, setNewSkills] = useState('')
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const fee = Number(fd.get('fee') ?? 0), weeks = String(fd.get('weeks') ?? '')
    start(async () => {
      const res = await createCourseAction({ departmentId: String(fd.get('dept') ?? ''), title: String(fd.get('title') ?? ''), baseFee: Math.round(fee * 100), durationWeeks: weeks ? Number(weeks) : null, skills: String(fd.get('skills') ?? '') })
      if (!res.ok) return setError(res.error)
      setAdding(false); notify(res.data?.pending ? 'Course added: it waits for head office to approve it before it can be used' : 'Course added'); router.refresh()
      // next step: the course's syllabus
      if (canSyllabus && res.data?.id) setSyllabusOf({ id: res.data.id, title: String(fd.get('title') ?? ''), fresh: true })
    })
  }
  return (
    <section className="page-container table-page">
      <div className="page-heading">
        <div><p className="eyebrow">Management / Courses</p><h1>Course catalogue</h1><p className="subheading">The single list every enquiry, registration and batch picks from.{isSuper ? (waiting ? ` ${waiting} course${waiting === 1 ? '' : 's'} added by branches wait${waiting === 1 ? 's' : ''} for your approval (at the top).` : '') : canCreate ? ' A course you add waits for head office to approve it before it can be used.' : ''}</p></div>
        <div className="heading-actions">{canCreate && <button className="button primary" onClick={() => { setNewSkills(''); setAdding(true) }}><Plus size={17} /> Add course</button>}</div>
      </div>
      {syllabusChanges.length > 0 && (
        <div className="panel fee-requests">
          <div className="panel-header"><div><h2>Syllabus changes waiting for approval · {syllabusChanges.length}</h2><span>Sent by branches. The syllabus is shared: once approved, the change reaches every branch&apos;s trainers and students.</span></div></div>
          <div className="table-scroll"><table style={{ minWidth: 0 }}>
            <thead><tr><th>Course</th><th>Sent by</th><th>What changes</th><th /></tr></thead>
            <tbody>{syllabusChanges.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.course}</strong></td>
                <td>{c.by ?? '—'}<small>{c.branch ?? 'Head office'} · {new Date(c.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</small></td>
                <td>{c.topics != null ? `Topics (${c.topics})` : ''}{c.topics != null && c.file ? ' · ' : ''}{c.file === 'replace' ? 'New syllabus file' : c.file === 'remove' ? 'Remove the file' : ''}</td>
                <td><button type="button" className="filter-button" onClick={() => setSyllabusOf({ id: c.courseId, title: c.course })}>Review</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
      <div className="panel table-panel">
        <ListToolbar list={list} exportList="courses" placeholder="Search courses…"
          filters={[
            { key: 'dept', label: 'Department', options: [...new Set(rows.map((c) => c.department))].sort().map((d) => ({ value: d, label: d })) },
            { key: 'fee', label: 'Fee', options: [{ value: 'u25', label: 'Under ₹25,000' }, { value: '25to50', label: '₹25,000 – ₹50,000' }, { value: 'o50', label: 'Over ₹50,000' }] },
          ]}
          sorts={[
            { key: 'title', label: 'Course A–Z', dir: 'asc' }, { key: 'dept', label: 'Department', dir: 'asc' },
            { key: 'fee', label: 'Fee, lowest', dir: 'asc' }, { key: 'fee', label: 'Fee, highest', dir: 'desc' }, { key: 'weeks', label: 'Duration, shortest', dir: 'asc' },
          ]} />
        <div className="table-scroll">
          <table>
            <thead><tr><SortTh list={list} k="title">Course</SortTh><SortTh list={list} k="dept">Department</SortTh><SortTh list={list} k="fee">Base fee</SortTh><SortTh list={list} k="weeks">Duration</SortTh><th>Syllabus</th><th>Skills / tools</th><th /></tr></thead>
            <tbody>
              {list.rows.map((c) => <tr key={c.id}><td><strong>{c.title}</strong>
                {c.status === 'pending' && <small style={{ display: 'block', marginTop: 3 }}><span className="status-badge status-amber"><span className="status-dot" />Waiting for approval</span>{c.requestedBranch ? ` · added by ${c.requestedBranch}` : ''}</small>}
                {c.status === 'rejected' && <small className="text-red" style={{ display: 'block', marginTop: 3 }}>Turned down{c.rejectionReason ? `: ${c.rejectionReason}` : ''}</small>}</td><td>{c.department}</td><td>₹{(c.baseFee / 100).toLocaleString('en-IN')}</td><td>{c.durationWeeks ? `${c.durationWeeks} weeks` : '—'}</td><td><button type="button" className="filter-button" onClick={() => setSyllabusOf({ id: c.id, title: c.title })} title={canSyllabus ? 'Set the topics trainers tick as they teach' : 'See the syllabus'}><BookOpen size={14} /> {c.topics ? `${c.topics} topic${c.topics === 1 ? '' : 's'}` : canSyllabus ? 'Set syllabus' : 'None yet'}{c.syllabusFile ? ' · PDF' : ''}</button></td><td className="cal-remark">{c.skills ? <span className="chip-list">{splitChips(c.skills).map((k) => <span key={k} className="chip">{k}</span>)}</span> : <span style={{ color: '#8b98aa' }}>Not set</span>}</td><td><div className="row-actions">
                {isSuper && c.status === 'pending' && <>
                  <button className="button primary small" disabled={pending} onClick={() => decide(c, true)}><Check size={14} /> Approve</button>
                  <button className="filter-button" disabled={pending} onClick={() => { setRejecting(c); setReason('') }}><X size={14} /> Turn down</button>
                </>}
                {canEdit && <><button className="filter-button icon-only" title="Skills / tools taught (for internship letters)" aria-label={`Skills of ${c.title}`} onClick={() => { setSkillsFor(c); setSkillsText(c.skills ?? '') }}><Pencil size={14} /></button><DeleteButton what={`Course ${c.title}`} run={() => deleteCourseAction(c.id)} onDone={() => router.refresh()} /></>}
              </div></td></tr>)}
              {!list.rows.length && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>{list.filtered ? 'No courses match these filters.' : 'No courses yet — a super admin can add them here.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={list.page} pages={list.pages} total={list.total} shown={list.rows.length} loading={false} setPage={list.setPage} noun="courses" />
      </div>
      {skillsFor && (
        <Modal title={`Skills / tools — ${skillsFor.title}`} onClose={() => setSkillsFor(null)}>
          <form onSubmit={(e) => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get('skills') ?? ''); start(async () => { const r = await updateCourseSkillsAction(skillsFor.id, v); if (!r.ok) return setError(r.error); setSkillsFor(null); notify('Skills saved') }) }}>
            <p className="section-hint">The tools and skills this course teaches. Internship letters use them for {'{{skills}}'} when the intern&apos;s own are not filled in.</p>
            <div className="chip-field"><span>Skills / tools <small>— type one, press Enter</small></span><ChipInput name="skills" label="Skills / tools" value={skillsText} onChange={setSkillsText} placeholder="e.g. Android Studio, then Enter" /></div>
            <Err msg={error} />
            <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setSkillsFor(null)}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Saving…' : 'Save'}</button></div>
          </form>
        </Modal>
      )}
      {syllabusOf && <SyllabusEditor courseId={syllabusOf.id} course={syllabusOf.title} fresh={syllabusOf.fresh} canEdit={canSyllabus} onClose={() => setSyllabusOf(null)} onSaved={(m) => { setSyllabusOf(null); notify(m); router.refresh() }} />}
      {rejecting && (
        <Modal title={`Turn down — ${rejecting.title}`} onClose={() => setRejecting(null)}>
          <form onSubmit={(e) => { e.preventDefault(); decide(rejecting, false, reason) }}>
            <p className="section-hint">{rejecting.requestedBranch ?? 'The branch'} sees this reason next to the course.</p>
            <label>Reason<span className="required-mark">*</span><textarea rows={3} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. We already have this course as Full Stack Web Development" /></label>
            <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setRejecting(null)}>Cancel</button><button className="button danger" disabled={pending || !reason.trim()}>{pending ? 'Saving…' : 'Turn down'}</button></div>
          </form>
        </Modal>
      )}
      {adding && (
        <Modal title="Add course" onClose={() => setAdding(false)}>
          <form onSubmit={submit}>
            <div className="form-grid">
              <label>Department<span className="required-mark">*</span><select name="dept" required defaultValue=""><option value="" disabled>Select department</option>{catalogs.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
              <label>Course title<span className="required-mark">*</span><input name="title" required /></label>
              <label>Base fee (₹)<span className="required-mark">*</span><input name="fee" type="number" min="0" step="1" required /></label>
              <label>Duration (weeks)<input name="weeks" type="number" min="1" /></label>
              <div className="chip-field" style={{ gridColumn: '1 / -1' }}><span>Skills / tools taught <small>— type one, press Enter</small></span><ChipInput name="skills" label="Skills / tools taught" value={newSkills} onChange={setNewSkills} placeholder="e.g. Android Studio, then Enter" /><small className="reg-note">Used for {'{{skills}}'} in internship letters.</small></div>
            </div>
            {!isSuper && <p className="section-hint" style={{ margin: '10px 0 0' }}>The course waits for head office to approve it; until then it cannot be picked in enquiries, registrations or batches.</p>}
            <Err msg={error} />
            <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setAdding(false)}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Saving…' : 'Add course'}</button></div>
          </form>
        </Modal>
      )}
    </section>
  )
}
