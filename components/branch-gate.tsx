'use client'
// An "Add …" button that also works for head office in "All branches": every record belongs to one branch, so the
// admin is asked which branch first. That branch becomes their working branch (same as the sidebar switch).
import { useState, useTransition } from 'react'
import { setActingBranchAction } from '@/app/actions'
import { Modal } from '@/components/modal'

export function AddButton({ needsBranch, branches, onGo, children }: {
  needsBranch: boolean; branches: { id: string; code: string; name: string }[]; onGo: () => void; children: React.ReactNode
}) {
  const [asking, setAsking] = useState(false)
  const [branchId, setBranchId] = useState('')
  const [pending, start] = useTransition()
  const go = () => start(async () => {
    await setActingBranchAction(branchId)
    setAsking(false)
    onGo()
  })
  return (
    <>
      <button className="button primary" onClick={() => (needsBranch ? setAsking(true) : onGo())}>{children}</button>
      {asking && (
        <Modal title="Which branch is this for?" onClose={() => setAsking(false)}>
          <p className="section-hint" style={{ margin: '-8px 0 14px' }}>You are viewing all branches. Choose the branch to add this in; it becomes your working branch (you can switch back in the sidebar).</p>
          <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
            <label>Branch<span className="required-mark">*</span>
              <select value={branchId} autoFocus onChange={(e) => setBranchId(e.target.value)}>
                <option value="" disabled>Select branch</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
              </select>
            </label>
          </div>
          {!branches.length && <p className="section-hint" style={{ margin: '12px 0 0' }}>There is no branch yet. Create one under Branches first.</p>}
          <div className="modal-actions">
            <button type="button" className="button secondary" onClick={() => setAsking(false)}>Cancel</button>
            <button type="button" className="button primary" disabled={!branchId || pending} onClick={go}>{pending ? 'Opening…' : 'Continue'}</button>
          </div>
        </Modal>
      )}
    </>
  )
}
