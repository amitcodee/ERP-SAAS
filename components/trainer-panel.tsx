'use client'
// My Classes: the trainer's own panel. Pick a batch, then: Today's class (who is present and which syllabus topics
// were taught, in one save), Syllabus (what is covered and when), Tests (title, date, total marks, then each
// student's marks and a photo of the answer sheet), Notes (links / files for the batch's students and other
// trainers), Calendar (every class held) and Students (attendance and average score).
import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen, Camera, CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardCheck, ExternalLink, FileText, Link2, NotebookPen, Plus, Trash2, Users } from 'lucide-react'
import {
  batchTeachingAction, createTestAction, deleteNoteAction, deleteTestAction, listNotesAction, loadRosterAction, saveClassAction, saveTestMarksAction,
  setTopicCoveredAction, teachingCalendarAction,
} from '@/app/actions'
import { Err, Modal } from '@/components/modal'
import { useNotify } from '@/components/panel-shell'
import { WEEKDAYS } from '@/components/timetable'
import type { RosterRow } from '@/modules/academics/service'
import type { BatchTopic, CalendarDay, NoteRow, TestRow } from '@/modules/teaching/service'

type Batch = { id: string; name: string; course: string | null; department: string; members: number; timing: string | null; otherBranch: string | null }
type Teaching = { courseId: string | null; syllabusFile: string | null; topics: BatchTopic[]; tests: TestRow[] }
const TABS = [['today', "Today's class", ClipboardCheck], ['syllabus', 'Syllabus', BookOpen], ['tests', 'Tests & marks', NotebookPen], ['notes', 'Notes', FileText], ['calendar', 'Calendar', CalendarDays], ['students', 'Students', Users]] as const
type Tab = (typeof TABS)[number][0]
const todayIso = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
const fmt = (d: string) => new Date(d.length > 10 ? d : `${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export function TrainerPanel({ batches, name }: { batches: Batch[]; name: string }) {
  const [batchId, setBatchId] = useState(batches[0]?.id ?? '')
  const [tab, setTab] = useState<Tab>('today')
  const [t, setT] = useState<Teaching | null>(null)
  const [roster, setRoster] = useState<RosterRow[]>([])
  const notify = useNotify()
  const batch = batches.find((b) => b.id === batchId)
  const reload = async () => {
    if (!batchId) return
    const [a, r] = await Promise.all([batchTeachingAction(batchId), loadRosterAction(batchId, todayIso())])
    if (a.ok) setT(a.data!); else notify(a.error)
    if (r.ok) setRoster(r.data!.rows)
  }
  useEffect(() => { setT(null); void reload() }, [batchId]) // eslint-disable-line react-hooks/exhaustive-deps
  const covered = t?.topics.filter((x) => x.coveredOn).length ?? 0

  return (
    <section className="page-container tp">
      <div className="page-heading"><div><p className="eyebrow">Teaching / My Classes</p><h1>My Classes</h1><p className="subheading">Hello {name.split(' ')[0]}: mark today&apos;s class, tick the syllabus, give marks and share notes.</p></div></div>
      {!batches.length ? <NoBatch /> : (
        <>
          <div className="tp-batches">
            {batches.map((b) => (
              <button key={b.id} type="button" className={`tp-batch${b.id === batchId ? ' on' : ''}`} onClick={() => setBatchId(b.id)}>
                <strong>{b.name}</strong><small>{b.course ?? b.department}</small>
                <span>{b.members} student{b.members === 1 ? '' : 's'}{b.timing ? ` · ${b.timing}` : ''}{b.otherBranch ? ` · ${b.otherBranch}` : ''}</span>
              </button>
            ))}
          </div>
          {batch && (
            <div className="panel tp-main">
              <div className="tp-head">
                <div><h2>{batch.name}</h2><small>{batch.course ?? batch.department}{t ? ` · syllabus ${covered}/${t.topics.length} topics done` : ''}</small></div>
                {t && t.topics.length > 0 && <div className="tp-prog"><i style={{ width: `${Math.round((covered / t.topics.length) * 100)}%` }} /></div>}
              </div>
              <div className="cd-tabs" role="tablist">
                {TABS.map(([k, l, I]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><I size={14} /> {l}</button>)}
              </div>
              <div className="tp-body">
                {!t ? <p className="section-hint">Loading…</p> : (
                  <>
                    {tab === 'today' && <TodayTab batchId={batchId} t={t} onSaved={(m) => { notify(m); void reload() }} />}
                    {tab === 'syllabus' && <SyllabusTab batchId={batchId} t={t} onChanged={reload} />}
                    {tab === 'tests' && <TestsTab batchId={batchId} t={t} roster={roster} onChanged={(m) => { if (m) notify(m); void reload() }} />}
                    {tab === 'notes' && <NotesTab batchId={batchId} batchName={batch.name} />}
                    {tab === 'calendar' && <CalendarTab />}
                    {tab === 'students' && <StudentsTab roster={roster} />}
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function TodayTab({ batchId, t, onSaved }: { batchId: string; t: Teaching; onSaved: (m: string) => void }) {
  const [date, setDate] = useState(todayIso())
  const [rows, setRows] = useState<RosterRow[] | null>(null)
  const [marks, setMarks] = useState<Record<string, boolean>>({})
  const [picked, setPicked] = useState<string[]>([])
  const [extra, setExtra] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  useEffect(() => {
    setRows(null)
    loadRosterAction(batchId, date).then((r) => {
      if (!r.ok) return setError(r.error)
      setRows(r.data!.rows)
      setMarks(Object.fromEntries(r.data!.rows.map((x) => [x.registrationId, x.present ?? true])))
    })
    setPicked(t.topics.filter((x) => x.coveredOn === date).map((x) => x.id))
  }, [batchId, date, t])
  const next = t.topics.filter((x) => !x.coveredOn || x.coveredOn === date)
  const present = rows?.filter((r) => marks[r.registrationId]).length ?? 0
  const save = () => start(async () => {
    setError('')
    const r = await saveClassAction(batchId, date, (rows ?? []).map((x) => ({ registrationId: x.registrationId, present: marks[x.registrationId] ?? true })), picked, extra || null)
    if (!r.ok) return setError(r.error)
    onSaved(`Class of ${fmt(date)} saved: ${present}/${rows?.length ?? 0} present${picked.length ? `, ${picked.length} topic${picked.length === 1 ? '' : 's'} ticked` : ''}`)
  })
  return (
    <div className="tp-today">
      <div className="tp-today-top">
        <label>Class date<input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} /></label>
        <div className="tp-count"><strong>{present}</strong>/{rows?.length ?? 0} present</div>
      </div>
      <div className="tp-cols">
        <div>
          <h3>1. Topic taught</h3>
          {!t.topics.length ? <p className="section-hint">This course has no syllabus yet. Type the topic below; the academic manager can add the syllabus on Courses.</p> : (
            <div className="tp-topics">
              {next.slice(0, 12).map((x) => (
                <label key={x.id} className={picked.includes(x.id) ? 'on' : ''}>
                  <input type="checkbox" checked={picked.includes(x.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, x.id] : picked.filter((p) => p !== x.id))} />
                  <span><strong>{x.title}</strong>{x.module && <small>{x.module}</small>}</span>
                </label>
              ))}
              {next.length === 0 && <p className="section-hint">Every syllabus topic is done. 🎉</p>}
            </div>
          )}
          <label className="tp-extra">Anything else taught (optional)<input value={extra} maxLength={200} placeholder="e.g. revision, doubt session, quiz" onChange={(e) => setExtra(e.target.value)} /></label>
        </div>
        <div>
          <h3>2. Attendance <button type="button" className="link-button" onClick={() => setMarks(Object.fromEntries((rows ?? []).map((x) => [x.registrationId, true])))}>all present</button></h3>
          {!rows ? <p className="section-hint">Loading…</p> : !rows.length ? <p className="section-hint">No students in this batch yet.</p> : (
            <div className="tp-roll">
              {rows.map((r) => (
                <button key={r.registrationId} type="button" className={marks[r.registrationId] ? 'p' : 'a'} onClick={() => setMarks({ ...marks, [r.registrationId]: !marks[r.registrationId] })}>
                  <span className="tp-init">{r.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
                  <span><strong>{r.name}</strong><small>{r.regNo} · {r.pct}% attendance</small></span>
                  <em>{marks[r.registrationId] ? 'Present' : 'Absent'}</em>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <Err msg={error} />
      <div className="modal-actions"><button type="button" className="button primary" disabled={pending || !rows} onClick={save}><Check size={15} /> {pending ? 'Saving…' : 'Save class'}</button></div>
    </div>
  )
}

function SyllabusTab({ batchId, t, onChanged }: { batchId: string; t: Teaching; onChanged: () => void }) {
  const [pending, start] = useTransition()
  if (!t.topics.length) return <p className="section-hint">This course has no syllabus yet. Head office, the branch manager or the academic manager sets it on Courses → Syllabus.</p>
  const toggle = (x: BatchTopic) => start(async () => { await setTopicCoveredAction(batchId, x.id, x.coveredOn ? null : todayIso()); onChanged() })
  return (
    <div className="tp-syl">
      {t.syllabusFile && t.courseId && <a className="filter-button" href={`/api/syllabus/${t.courseId}`} style={{ marginBottom: 10 }}><FileText size={14} /> {t.syllabusFile}</a>}
      {t.topics.map((x, i) => (
        <div key={x.id}>
          {(i === 0 || t.topics[i - 1].module !== x.module) && x.module && <h4>{x.module}</h4>}
          <div className={`tp-syl-row${x.coveredOn ? ' done' : ''}`}>
            <button type="button" disabled={pending} onClick={() => toggle(x)} aria-label={x.coveredOn ? 'Mark not done' : 'Mark done today'}>{x.coveredOn ? <Check size={13} /> : i + 1}</button>
            <span>{x.title}</span>
            <small>{x.coveredOn ? `Done ${fmt(x.coveredOn)}` : 'Not yet'}</small>
          </div>
        </div>
      ))}
    </div>
  )
}

function TestsTab({ batchId, t, roster, onChanged }: { batchId: string; t: Teaching; roster: RosterRow[]; onChanged: (m?: string) => void }) {
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(t.tests[0]?.id ?? null)
  const test = t.tests.find((x) => x.id === openId) ?? null
  return (
    <div>
      <div className="tp-tests-top">
        <div className="tp-chips">{t.tests.map((x) => <button key={x.id} type="button" className={x.id === openId ? 'on' : ''} onClick={() => setOpenId(x.id)}>{x.title}<small>{fmt(x.date)}</small></button>)}</div>
        <button type="button" className="button primary small" onClick={() => setAdding(true)}><Plus size={14} /> New test</button>
      </div>
      {!t.tests.length && <p className="section-hint">No test yet. Add one (title, date and total marks), then enter each student&apos;s marks.</p>}
      {test && <MarksSheet key={test.id} test={test} roster={roster} onChanged={onChanged} />}
      {adding && <NewTest batchId={batchId} onClose={() => setAdding(false)} onDone={(id) => { setAdding(false); setOpenId(id); onChanged('Test added: now enter the marks') }} />}
    </div>
  )
}

function MarksSheet({ test, roster, onChanged }: { test: TestRow; roster: RosterRow[]; onChanged: (m?: string) => void }) {
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(test.marks.map((m) => [m.registrationId, m.score == null ? '' : String(m.score)])))
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)
  const sheet = (rid: string) => test.marks.find((m) => m.registrationId === rid)?.sheetDocId ?? null
  const scores = roster.map((r) => Number(vals[r.registrationId])).filter((n, k) => vals[roster[k].registrationId] !== '' && !Number.isNaN(n))
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null
  const save = () => start(async () => {
    setError('')
    const rows = roster.map((r) => ({ registrationId: r.registrationId, score: vals[r.registrationId] === '' || vals[r.registrationId] == null ? null : Number(vals[r.registrationId]) }))
    const res = await saveTestMarksAction(test.id, rows)
    if (!res.ok) return setError(res.error)
    onChanged(`Marks saved for ${test.title}`)
  })
  const upload = async (rid: string, f: File) => {
    setBusy(rid)
    const fd = new FormData(); fd.set('what', 'sheet'); fd.set('testId', test.id); fd.set('registrationId', rid); fd.set('file', f)
    const r = await fetch('/api/teaching', { method: 'POST', body: fd }).then((x) => x.json()).catch(() => ({ ok: false, error: 'Upload failed' }))
    setBusy(null)
    if (!r.ok) return setError(r.error)
    onChanged('Answer sheet uploaded')
  }
  return (
    <div className="tp-sheet">
      <div className="tp-sheet-head"><strong>{test.title}</strong><span>{fmt(test.date)} · total {test.maxScore} marks{avg != null ? ` · class average ${avg}/${test.maxScore}` : ''}</span>
        <button type="button" className="link-button" onClick={() => start(async () => { const r = await deleteTestAction(test.id); if (!r.ok) return setError(r.error); onChanged('Test removed') })}><Trash2 size={13} /> remove test</button></div>
      <div className="table-scroll"><table>
        <thead><tr><th>Student</th><th>Marks obtained</th><th>%</th><th>Answer sheet</th></tr></thead>
        <tbody>{roster.map((r) => {
          const v = vals[r.registrationId] ?? ''
          const pct = v !== '' ? Math.round((Number(v) / test.maxScore) * 100) : null
          const doc = sheet(r.registrationId)
          return (
            <tr key={r.registrationId}>
              <td><strong>{r.name}</strong><small style={{ display: 'block' }}>{r.regNo}</small></td>
              <td><input className="tp-mark" inputMode="numeric" value={v} placeholder="—" onChange={(e) => setVals({ ...vals, [r.registrationId]: e.target.value.replace(/\D/g, '').slice(0, 4) })} aria-label={`Marks of ${r.name}`} /> <span className="section-hint">/ {test.maxScore}</span></td>
              <td>{pct == null ? '—' : <span className={`status-badge status-${pct >= 75 ? 'green' : pct >= 50 ? 'amber' : 'red'}`}><span className="status-dot" />{pct}%</span>}</td>
              <td><div className="row-actions">
                {doc && <a className="filter-button" href={`/documents/${doc}`} target="_blank" rel="noreferrer"><ExternalLink size={13} /> View</a>}
                <label className="filter-button" style={{ cursor: 'pointer' }}><Camera size={13} /> {busy === r.registrationId ? 'Uploading…' : doc ? 'Replace' : 'Photo'}<input type="file" accept="image/*,application/pdf" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(r.registrationId, f) }} /></label>
              </div></td>
            </tr>
          )
        })}</tbody>
      </table></div>
      <Err msg={error} />
      <div className="modal-actions"><button type="button" className="button primary" disabled={pending} onClick={save}><Check size={15} /> {pending ? 'Saving…' : 'Save marks'}</button></div>
    </div>
  )
}

function NewTest({ batchId, onClose, onDone }: { batchId: string; onClose: () => void; onDone: (id: string) => void }) {
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  return (
    <Modal title="New test" onClose={onClose}>
      <form onSubmit={(e) => {
        e.preventDefault(); const fd = new FormData(e.currentTarget)
        start(async () => { const r = await createTestAction(batchId, { title: String(fd.get('title') ?? ''), date: String(fd.get('date') ?? ''), maxScore: Number(fd.get('max')) }); if (!r.ok) return setError(r.error); onDone(r.data!.id) })
      }}>
        <div className="form-grid">
          <label style={{ gridColumn: '1 / -1' }}>Test title<span className="required-mark">*</span><input name="title" required placeholder="e.g. Unit test 1 — HTML & CSS" /></label>
          <label>Test date<span className="required-mark">*</span><input name="date" type="date" required defaultValue={todayIso()} /></label>
          <label>Total marks<span className="required-mark">*</span><input name="max" type="number" min={1} max={1000} required defaultValue={50} /></label>
        </div>
        <Err msg={error} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Adding…' : 'Add test'}</button></div>
      </form>
    </Modal>
  )
}

/** No batch yet: notes shared by other trainers (and their own) and the calendar still work. */
function NoBatch() {
  const [tab, setTab] = useState<'notes' | 'calendar'>('notes')
  return (
    <>
      <div className="panel hd-empty"><Users size={34} /><p>No batch is assigned to you yet. The academic manager or counselor puts you on a batch.</p></div>
      <div className="panel tp-main" style={{ marginTop: 14 }}>
        <div className="cd-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'notes'} className={tab === 'notes' ? 'on' : ''} onClick={() => setTab('notes')}><FileText size={14} /> Notes</button>
          <button type="button" role="tab" aria-selected={tab === 'calendar'} className={tab === 'calendar' ? 'on' : ''} onClick={() => setTab('calendar')}><CalendarDays size={14} /> Calendar</button>
        </div>
        <div className="tp-body">{tab === 'notes' ? <NotesTab batchId={null} batchName="" /> : <CalendarTab />}</div>
      </div>
    </>
  )
}

function NotesTab({ batchId, batchName }: { batchId: string | null; batchName: string }) {
  const [notes, setNotes] = useState<NoteRow[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [view, setView] = useState<'batch' | 'shared' | 'mine'>(batchId ? 'batch' : 'shared')
  const notify = useNotify()
  const load = () => listNotesAction(null).then((r) => setNotes(r.ok ? r.data! : []))
  useEffect(() => { void load() }, [batchId])
  const list = (notes ?? []).filter((n) => (view === 'batch' ? n.batchId === batchId : view === 'mine' ? n.mine : n.shareTrainers && !n.mine))
  return (
    <div>
      <div className="tp-tests-top">
        <div className="tp-chips">{batchId && <button type="button" className={view === 'batch' ? 'on' : ''} onClick={() => setView('batch')}>This batch</button>}<button type="button" className={view === 'shared' ? 'on' : ''} onClick={() => setView('shared')}>Shared by other trainers</button><button type="button" className={view === 'mine' ? 'on' : ''} onClick={() => setView('mine')}>Shared by me</button></div>
        <button type="button" className="button primary small" onClick={() => setAdding(true)}><Plus size={14} /> Share notes</button>
      </div>
      {notes === null ? <p className="section-hint">Loading…</p> : !list.length ? <p className="section-hint">{view === 'batch' ? 'No notes for this batch yet. Share a link (Google Drive, YouTube…) or a PDF.' : view === 'mine' ? 'You have not shared notes yet.' : 'No trainer has shared notes yet.'}</p> : (
        <div className="tp-notes">
          {list.map((n) => (
            <div key={n.id} className="tp-note">
              <span className="tp-note-ic">{n.url ? <Link2 size={17} /> : <FileText size={17} />}</span>
              <div>
                <strong>{n.title}</strong>
                {n.body && <p>{n.body}</p>}
                <small>{n.by ?? '—'} · {fmt(n.at)}{n.batch ? ` · ${n.batch}` : ''} · {[n.shareStudents && 'students', n.shareTrainers && 'trainers'].filter(Boolean).join(' & ') || 'only me'}</small>
                <div className="row-actions" style={{ marginTop: 6 }}>
                  {n.url && <a className="filter-button" href={n.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open link</a>}
                  {n.fileName && <a className="filter-button" href={`/api/notes/${n.id}`}><FileText size={13} /> {n.fileName}</a>}
                  {n.mine && <button type="button" className="filter-button" onClick={async () => { const r = await deleteNoteAction(n.id); notify(r.ok ? 'Note removed' : r.error); void load() }}><Trash2 size={13} /> Remove</button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {adding && <NewNote batchId={batchId} batchName={batchName} onClose={() => setAdding(false)} onDone={() => { setAdding(false); notify('Notes shared'); void load() }} />}
    </div>
  )
}

function NewNote({ batchId, batchName, onClose, onDone }: { batchId: string | null; batchName: string; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  return (
    <Modal title="Share notes" onClose={onClose}>
      <form onSubmit={(e) => {
        e.preventDefault(); const fd = new FormData(e.currentTarget)
        fd.set('what', 'note'); fd.set('batchId', batchId ?? ''); fd.set('shareStudents', batchId && fd.get('ss') ? '1' : ''); fd.set('shareTrainers', fd.get('st') ? '1' : '')
        if (!batchId && !fd.get('st')) return setError('Without a batch, notes can only be shared with trainers')
        start(async () => { const r = await fetch('/api/teaching', { method: 'POST', body: fd }).then((x) => x.json()).catch(() => ({ ok: false, error: 'Could not send' })); if (!r.ok) return setError(r.error); onDone() })
      }}>
        <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
          <label>Title<span className="required-mark">*</span><input name="title" required maxLength={150} placeholder="e.g. Flexbox cheat sheet" /></label>
          <label>Link (optional)<input name="url" type="url" placeholder="https://drive.google.com/…" /></label>
          <label className="full-label">Text (optional)<textarea name="body" rows={3} maxLength={5000} placeholder="What it is, what to read before the next class…" /></label>
          <label>File (optional, PDF or picture, up to 10 MB)<input name="file" type="file" accept="application/pdf,image/*" /></label>
          {batchId && <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input name="ss" type="checkbox" defaultChecked style={{ width: 'auto', margin: 0 }} /> Students of {batchName} see it in their portal</label>}
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input name="st" type="checkbox" defaultChecked={!batchId} style={{ width: 'auto', margin: 0 }} /> Share with all trainers (every branch)</label>
        </div>
        <Err msg={error} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Sharing…' : 'Share'}</button></div>
      </form>
    </Modal>
  )
}

function CalendarTab() {
  const [month, setMonth] = useState(todayIso().slice(0, 7))
  const [days, setDays] = useState<CalendarDay[] | null>(null)
  const [pick, setPick] = useState<string | null>(null)
  useEffect(() => { setDays(null); teachingCalendarAction(month).then((r) => setDays(r.ok ? r.data! : [])) }, [month])
  const [y, m] = month.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1)), count = new Date(Date.UTC(y, m, 0)).getUTCDate(), lead = (first.getUTCDay() + 6) % 7
  const shift = (d: number) => { const x = new Date(Date.UTC(y, m - 1 + d, 1)); setMonth(x.toISOString().slice(0, 7)); setPick(null) }
  const byDay = useMemo(() => { const map = new Map<string, CalendarDay[]>(); for (const d of days ?? []) map.set(d.date, [...(map.get(d.date) ?? []), d]); return map }, [days])
  const today = todayIso()
  return (
    <div className="tp-cal-wrap">
      <div className="tp-cal-head"><button type="button" className="filter-button icon-only" onClick={() => shift(-1)} aria-label="Earlier"><ChevronLeft size={15} /></button><strong>{first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</strong><button type="button" className="filter-button icon-only" onClick={() => shift(1)} aria-label="Later"><ChevronRight size={15} /></button></div>
      <div className="tp-cal">
        {WEEKDAYS.map((w) => <b key={w}>{w}</b>)}
        {Array.from({ length: lead }, (_, k) => <span key={`l${k}`} className="pad" />)}
        {Array.from({ length: count }, (_, k) => {
          const iso = `${month}-${String(k + 1).padStart(2, '0')}`
          const list = byDay.get(iso) ?? []
          return (
            <button key={iso} type="button" className={`${list.length ? 'has' : ''}${iso === today ? ' today' : ''}${pick === iso ? ' on' : ''}`} onClick={() => setPick(iso)} disabled={!list.length}>
              <em>{k + 1}</em>{list.slice(0, 2).map((d, i) => <small key={i} className={d.kind === 'class' ? '' : d.kind}>{d.kind === 'test' ? `Test · ${d.topic}` : d.batch}</small>)}{list.length > 2 && <small>+{list.length - 2}</small>}
            </button>
          )
        })}
      </div>
      {pick && (
        <div className="tp-cal-day">
          <h3>{fmt(pick)}</h3>
          {(byDay.get(pick) ?? []).map((d, i) => (
            <div key={i}>
              <strong>{d.kind === 'test' ? `Test: ${d.topic}` : d.batch}</strong>{d.kind === 'test' ? <span> · {d.batch}</span> : d.time && <span> · {d.time}</span>}
              {d.kind === 'class' && <><p>{d.topic ?? 'No topic recorded'}</p><small>{d.present}/{d.marked} present · {d.members} in batch</small></>}
              {d.kind === 'planned' && <><p>Class coming up</p><small>{d.members} in batch</small></>}
              {d.kind === 'test' && <><p>Out of {d.maxScore}</p><small>{d.graded}/{d.members} marked</small></>}
            </div>
          ))}
        </div>
      )}
      <p className="section-hint tp-cal-key"><small>Class held</small><small className="planned">Coming up</small><small className="test">Test</small></p>
      {days && !days.length && <p className="section-hint">No class or test this month.</p>}
    </div>
  )
}

function StudentsTab({ roster }: { roster: RosterRow[] }) {
  if (!roster.length) return <p className="section-hint">No students in this batch yet.</p>
  return (
    <div className="table-scroll"><table>
      <thead><tr><th>Student</th><th>Attendance</th><th>Average score</th><th>Capstone</th></tr></thead>
      <tbody>{roster.map((r) => (
        <tr key={r.registrationId}>
          <td><strong>{r.name}</strong><small style={{ display: 'block' }}>{r.regNo}</small></td>
          <td><span className={`status-badge status-${r.pct >= 80 ? 'green' : r.pct >= 60 ? 'amber' : 'red'}`}><span className="status-dot" />{r.pct}%</span></td>
          <td>{r.avgScore == null ? '—' : `${r.avgScore}% (${r.graded} graded)`}</td>
          <td>{r.capstoneApproved ? 'Approved' : r.capstoneId ? 'Submitted' : '—'}</td>
        </tr>
      ))}</tbody>
    </table></div>
  )
}
