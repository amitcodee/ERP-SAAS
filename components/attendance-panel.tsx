'use client'

import { AddButton } from '@/components/branch-gate'
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeftRight, Plus, UserCog, UserMinus } from 'lucide-react'
import { DayPicks } from '@/components/timetable'
import { DeleteButton } from '@/components/delete-button'
import { deleteBatchAction } from '@/app/actions'
import { addBatchMemberAction, removeBatchMemberAction, setBatchTrainerAction, addCapstoneAction, addGradeAction, findStudentsAction, approveCapstoneAction, cancelTrainerRequestAction, createBatchAction, decideTrainerRequestAction, loadRosterAction, otherBranchTrainersAction, requestTrainerAction, saveAttendanceAction } from '@/app/actions'
import { Err, Modal } from '@/components/modal'
import { Picker } from '@/components/picker'
import type { RosterRow } from '@/modules/academics/service'
import { namedProject } from '@/lib/project-title'
import type { Catalogs } from '@/modules/catalog/service'
import type { IncomingTrainerRequest, OutgoingTrainerRequest, TrainerOption } from '@/modules/academics/trainer-requests'
import { DateInput } from '@/components/date-input'
import { todayIST } from '@/lib/ist'

export type BatchRow = { id: string; name: string; department: string; course: string | null; trainer: string | null; trainerId?: string | null; timing: string | null; capacity: number | null; members: number
  /** A batch of another branch that this trainer teaches (that branch's name). */
  otherBranch?: string | null }
export type StudentOpt = { id: string; label: string }
export type TrainerOpt = { id: string; name: string }

const today = () => todayIST()

export function AttendancePanel({
  batches, catalogs, trainers, canCreateBatch, canAddMember = canCreateBatch, canMark, canApproveCapstone, needsBranch, notify, top, canAskTrainer = false, requestsOut = [], requestsIn = [],
}: {
  batches: BatchRow[]; catalogs: Catalogs; trainers: TrainerOpt[]
  canCreateBatch: boolean; /** put a student in the batch: the academic manager, or the counselor who admitted them */ canAddMember?: boolean; canMark: boolean; canApproveCapstone: boolean; needsBranch: boolean; notify: (m: string) => void
  /** Asking a trainer of another branch to take a batch (academic manager), the requests waiting, and those to answer (trainer). */
  canAskTrainer?: boolean; requestsOut?: OutgoingTrainerRequest[]; requestsIn?: IncomingTrainerRequest[]
  /** The Students page's tabs, shown above the heading. */
  top?: React.ReactNode
}) {
  const [pickedBatch, setPickedBatch] = useState(batches[0]?.id ?? '')
  // Always a real batch: falls back to the first one (e.g. right after the very first batch is created).
  const batchId = batches.some((b) => b.id === pickedBatch) ? pickedBatch : (batches[0]?.id ?? '')
  const [date, setDate] = useState(today())
  const [roster, setRoster] = useState<RosterRow[]>([])
  const [marks, setMarks] = useState<Record<string, boolean>>({})
  const [adding, setAdding] = useState(false)
  const [memberPick, setMemberPick] = useState('')
  const [grading, setGrading] = useState<RosterRow | null>(null)
  const [project, setProject] = useState<RosterRow | null>(null)
  const [pending, start] = useTransition()
  const [asking, setAsking] = useState(false)
  const router = useRouter()
  const batch = batches.find((b) => b.id === batchId)
  const waiting = requestsOut.find((r) => r.batchId === batchId)
  const decide = (id: string, accept: boolean) => start(async () => {
    const r = await decideTrainerRequestAction(id, accept, null)
    notify(r.ok ? (accept ? 'Accepted: the batch is now in your list' : 'Request declined') : r.error)
    if (r.ok) router.refresh()
  })

  async function refresh() {
    if (!batchId) return setRoster([])
    const res = await loadRosterAction(batchId, date)
    if (!res.ok || !res.data) return notify(res.ok ? 'Could not load roster' : res.error)
    setRoster(res.data.rows)
    setMarks(Object.fromEntries(res.data.rows.map((r) => [r.registrationId, r.present ?? true])))
  }
  useEffect(() => { void refresh() }, [batchId, date]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) =>
    start(async () => { const r = await fn(); notify(r.ok ? msg : (r as { error: string }).error); if (r.ok) await refresh() })

  return (
    <section className="page-container table-page">
      {top}
      <div className="page-heading">
        <div><p className="eyebrow">Management / Students</p><h1>Batches &amp; attendance</h1><p className="subheading">Attendance % feeds the certificate check automatically.</p></div>
        <div className="heading-actions">{canCreateBatch && <AddButton needsBranch={needsBranch} branches={catalogs.branches} onGo={() => setAdding(true)}><Plus size={17} /> New batch</AddButton>}</div>
      </div>
      {requestsIn.length > 0 && (
        <div className="panel trainer-asks">
          <h3><ArrowLeftRight size={16} /> Asked to teach a batch of another branch</h3>
          {requestsIn.map((r) => (
            <div key={r.id} className="trainer-ask">
              <div><strong>{r.from}</strong> asks you to teach <strong>{r.batch}</strong>{r.note && <small>“{r.note}”</small>}<small>Accept and the batch appears in your list: you mark its attendance and grades.</small></div>
              <div className="row-actions"><button type="button" className="filter-button" disabled={pending} onClick={() => decide(r.id, false)}>Decline</button><button type="button" className="button primary small" disabled={pending} onClick={() => decide(r.id, true)}>Accept</button></div>
            </div>
          ))}
        </div>
      )}
      {!batches.length ? (
        <div className="panel" style={{ padding: 28, textAlign: 'center', color: '#8b98aa' }}>No batches yet.</div>
      ) : (
        <div className="panel table-panel">
          <div className="table-toolbar" style={{ gap: 12, flexWrap: 'wrap' }}>
            <select value={batchId} onChange={(e) => setPickedBatch(e.target.value)} aria-label="Batch">{batches.map((b) => <option key={b.id} value={b.id}>{b.name} — {b.course ?? b.department} ({b.members}{b.capacity ? `/${b.capacity}` : ''}){b.otherBranch ? ` · ${b.otherBranch}` : ''}</option>)}</select>
            <DateInput type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Class date" />
            {batch && canCreateBatch && !batch.otherBranch
              ? <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b' }}><UserCog size={14} /> Trainer
                  <select value={batch.trainerId ?? ''} disabled={pending} aria-label="Trainer of this batch" onChange={(e) => { const id = e.target.value || null; start(async () => { const r = await setBatchTrainerAction(batch.id, id); notify(r.ok ? (id ? 'Trainer assigned: the batch is now in their My Classes' : 'Trainer removed') : r.error); if (r.ok) router.refresh() }) }}>
                    <option value="">No trainer</option>{trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>{batch.timing && <span style={{ color: '#8b98aa' }}>· {batch.timing}</span>}</label>
              : batch && <span style={{ fontSize: 11, color: '#8b98aa' }}>{batch.otherBranch ? `${batch.otherBranch} batch · ` : ''}{batch.trainer ? `Trainer: ${batch.trainer}` : 'No trainer'} {batch.timing ? `· ${batch.timing}` : ''}</span>}
            {batch && canAskTrainer && !batch.otherBranch && (waiting
              ? <span className="trainer-waiting">Waiting for {waiting.trainer} to accept <button type="button" className="filter-button" disabled={pending} onClick={() => start(async () => { const r = await cancelTrainerRequestAction(waiting.id); notify(r.ok ? 'Request cancelled' : r.error); if (r.ok) router.refresh() })}>Cancel</button></span>
              : <button type="button" className="filter-button" onClick={() => setAsking(true)} title="Ask a trainer of another branch to take this batch"><ArrowLeftRight size={14} /> Trainer from another branch</button>)}
            {batch && canCreateBatch && !batch.otherBranch && <DeleteButton what={`Batch ${batch.name}`} run={() => deleteBatchAction(batch.id)} onDone={() => router.refresh()} />}
          </div>
          {canAddMember && (
            <div style={{ display: 'flex', gap: 8, padding: '0 16px 12px' }}>
              <Picker ariaLabel="Add student" placeholder="Find a student to add…" search={findStudentsAction} onPick={(id) => setMemberPick(id)} />
              <button className="filter-button" disabled={!memberPick || pending} onClick={() => act(() => addBatchMemberAction(batchId, memberPick), 'Student added')}>Add</button>
            </div>
          )}
          <div className="table-scroll">
            <table>
              <thead><tr><th>Student</th><th>Attendance</th><th>Avg. score</th><th>Present on {date}</th><th>Capstone</th></tr></thead>
              <tbody>
                {roster.map((r) => (
                  <tr key={r.registrationId}>
                    <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div><strong>{r.name}</strong><span style={{ display: 'block' }}>{r.regNo}</span></div>
                      {canCreateBatch && !batch?.otherBranch && <button type="button" className="filter-button icon-only danger" disabled={pending} title="Take out of this batch (attendance and marks stay)" aria-label={`Remove ${r.name} from the batch`} onClick={() => act(() => removeBatchMemberAction(batchId, r.registrationId), `${r.name} taken out of the batch`)}><UserMinus size={14} /></button>}</div></td>
                    <td>{r.pct}%</td>
                    <td>{r.avgScore != null ? `${r.avgScore}%` : '—'}{r.graded > 0 && <small>{r.graded} graded</small>}{canMark && <button className="filter-button" style={{ marginLeft: 6 }} onClick={() => setGrading(r)}>Grade</button>}</td>
                    <td><input type="checkbox" disabled={!canMark} checked={marks[r.registrationId] ?? true} onChange={(e) => setMarks((m) => ({ ...m, [r.registrationId]: e.target.checked }))} aria-label={`Present: ${r.name}`} /></td>
                    <td>
                      {r.capstoneApproved ? <span className="status-badge status-green"><span className="status-dot" />Approved</span>
                        : r.capstoneId ? (canApproveCapstone ? <button className="filter-button" disabled={pending} onClick={() => setProject(r)}>Check &amp; approve</button> : 'Submitted')
                        : canMark ? <button className="filter-button" disabled={pending} onClick={() => setProject(r)}>Record submission</button> : '—'}
                      {r.capstoneId && namedProject(r.capstoneTitle) && <small style={{ display: 'block', maxWidth: 220 }} title={r.capstoneTools ?? undefined}>{r.capstoneTitle}</small>}
                    </td>
                  </tr>
                ))}
                {!roster.length && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>No students in this batch yet.</td></tr>}
              </tbody>
            </table>
          </div>
          {canMark && roster.length > 0 && (
            <div className="modal-actions" style={{ padding: 16 }}>
              <button className="button primary" disabled={pending} onClick={() => act(() => saveAttendanceAction(batchId, date, roster.map((r) => ({ registrationId: r.registrationId, present: marks[r.registrationId] ?? true }))), `Attendance saved for ${date}`)}>Save attendance</button>
            </div>
          )}
        </div>
      )}
      {project && <ProjectForm row={project} onClose={() => setProject(null)} onDone={(m) => { setProject(null); notify(m); void refresh() }} />}
      {grading && <GradeForm row={grading} onClose={() => setGrading(null)} onDone={(m) => { setGrading(null); notify(m); void refresh() }} />}
      {asking && batch && <AskTrainer batch={batch} onClose={() => setAsking(false)} onDone={(m) => { setAsking(false); notify(m); router.refresh() }} />}
      {adding && <BatchForm catalogs={catalogs} trainers={trainers} onClose={() => setAdding(false)} onDone={(m) => { setAdding(false); notify(m) }} />}
    </section>
  )
}

function BatchForm({ catalogs, trainers, onClose, onDone }: { catalogs: Catalogs; trainers: TrainerOpt[]; onClose: () => void; onDone: (m: string) => void }) {
  const [deptId, setDeptId] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const g = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? '').trim(); return v || null }
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    start(async () => {
      const days = fd.getAll('days').map(Number)
      const res = await createBatchAction({
        name: g(fd, 'name') ?? '', departmentId: deptId, courseId: g(fd, 'courseId'), trainerId: g(fd, 'trainerId'), timing: g(fd, 'timing'), startDate: g(fd, 'startDate'),
        capacity: g(fd, 'capacity') ? Number(g(fd, 'capacity')) : null, days: days.length ? days : null, startTime: g(fd, 'startTime'), endTime: g(fd, 'endTime'), room: g(fd, 'room'),
      })
      if (!res.ok) return setError(res.error)
      onDone('Batch created')
    })
  }
  return (
    <Modal title="New batch" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>Batch name<span className="required-mark">*</span><input name="name" required placeholder="e.g. CSE Morning" /></label>
          <label>Department<span className="required-mark">*</span><select value={deptId} onChange={(e) => setDeptId(e.target.value)} required><option value="" disabled>Select department</option>{catalogs.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label>Course<select name="courseId" defaultValue=""><option value="">—</option>{catalogs.courses.filter((c) => !deptId || c.departmentId === deptId).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
          <label>Trainer<select name="trainerId" defaultValue=""><option value="">{trainers.length ? '—' : 'No trainers yet'}</option>{trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <div style={{ gridColumn: '1 / -1' }}><span style={{ fontSize: 10, fontWeight: 600, color: '#58677c' }}>Class days (for the timetable)</span><DayPicks /></div>
          <label>Starts at<input name="startTime" type="time" /></label>
          <label>Ends at<input name="endTime" type="time" /></label>
          <label>Room<input name="room" placeholder="e.g. Lab 2" /></label>
          <label>Timing note<input name="timing" placeholder="optional, e.g. alternate Saturdays" /></label>
          <label>Start date<DateInput name="startDate" type="date" /></label>
          <label>Capacity<input name="capacity" type="number" min="1" /></label>
        </div>
        <Err msg={error} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Saving…' : 'Create batch'}</button></div>
      </form>
    </Modal>
  )
}

function GradeForm({ row, onClose, onDone }: { row: RosterRow; onClose: () => void; onDone: (m: string) => void }) {
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    start(async () => {
      const res = await addGradeAction(row.registrationId, String(fd.get('kind')) as 'assignment' | 'test', String(fd.get('title') ?? ''), Number(fd.get('score')), Number(fd.get('max')))
      if (!res.ok) return setError(res.error)
      onDone('Grade saved')
    })
  }
  return (
    <Modal title={`Grade — ${row.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>Type<select name="kind" defaultValue="assignment"><option value="assignment">Assignment</option><option value="test">Test</option></select></label>
          <label>Title<span className="required-mark">*</span><input name="title" required placeholder="e.g. Unit 2 test" /></label>
          <label>Marks obtained<span className="required-mark">*</span><input name="score" type="number" min="0" step="1" required /></label>
          <label>Out of<span className="required-mark">*</span><input name="max" type="number" min="1" step="1" required defaultValue={100} /></label>
        </div>
        <Err msg={error} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Saving…' : 'Save grade'}</button></div>
      </form>
    </Modal>
  )
}

/**
 * The capstone project: the title and tools the student gave in the portal, for the trainer to check, correct and approve
 * (they print on the project certificate); or, when the student handed it in without naming it, the trainer records it.
 */
function ProjectForm({ row, onClose, onDone }: { row: RosterRow; onClose: () => void; onDone: (m: string) => void }) {
  const named = namedProject(row.capstoneTitle)
  const [title, setTitle] = useState(named ?? '')
  const [tools, setTools] = useState(row.capstoneTools ?? '')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const approve = !!row.capstoneId
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    start(async () => {
      const res = approve ? await approveCapstoneAction(row.capstoneId!, { title, tools }) : await addCapstoneAction(row.registrationId, { title, tools })
      if (!res.ok) return setError(res.error)
      onDone(approve ? 'Project approved: it prints on the project certificate' : 'Project recorded')
    })
  }
  return (
    <Modal title={`${approve ? 'Check project' : 'Record project'} — ${row.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="subheading" style={{ margin: '0 0 12px' }}>
          {approve ? (named ? 'As the student named it. Correct the spelling if needed: once approved, the project certificate prints exactly this.' : 'The student has not named the project yet. Enter its real title: the project certificate prints it.')
            : 'For a project handed in without being named in the student portal.'}
        </p>
        <div className="form-grid">
          <label style={{ gridColumn: '1 / -1' }}>Project title<span className="required-mark">*</span><input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} placeholder="e.g. Student Management System" /></label>
          <label style={{ gridColumn: '1 / -1' }}>Tools used<input value={tools} onChange={(e) => setTools(e.target.value)} maxLength={300} placeholder="e.g. React, Node.js, MySQL (empty: the course's tools)" /></label>
        </div>
        <Err msg={error} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Saving…' : approve ? 'Approve project' : 'Record project'}</button></div>
      </form>
    </Modal>
  )
}

/** Ask a trainer of another branch to take this batch; they accept or decline in their own login. */
function AskTrainer({ batch, onClose, onDone }: { batch: BatchRow; onClose: () => void; onDone: (m: string) => void }) {
  const [list, setList] = useState<TrainerOption[] | null>(null)
  const [trainerId, setTrainerId] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  useEffect(() => { otherBranchTrainersAction().then((r) => (r.ok ? setList(r.data ?? []) : setError(r.error))) }, [])
  const branches = [...new Set((list ?? []).map((t) => t.branch))]
  return (
    <Modal title={`Trainer from another branch — ${batch.name}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await requestTrainerAction(batch.id, trainerId, note || null); if (!r.ok) return setError(r.error); onDone('Request sent: the trainer accepts it in their login') }) }}>
        <p className="section-hint" style={{ margin: '-8px 0 12px' }}>The trainer sees this request in their login. Once they accept, they become this batch’s trainer and mark its attendance and grades. Only this batch’s students are shown to them.</p>
        <div className="wl-form">
          <label className="wide">Trainer<span className="required-mark">*</span>
            <select required value={trainerId} onChange={(e) => setTrainerId(e.target.value)} disabled={!list}>
              <option value="">{list ? (list.length ? 'Choose a trainer…' : 'No trainers in other branches') : 'Loading…'}</option>
              {branches.map((b) => <optgroup key={b} label={b}>{list!.filter((t) => t.branch === b).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>)}
            </select>
          </label>
          <label className="wide">Note for the trainer<textarea rows={2} maxLength={300} placeholder="e.g. Weekend batch, 6 students, from 15 October" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        <Err msg={error} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending || !trainerId}>{pending ? 'Sending…' : 'Send request'}</button></div>
      </form>
    </Modal>
  )
}
