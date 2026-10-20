'use client'
// Shown to branch staff whose branch has no mail server of its own yet, on every page but Settings, until it is set
// up: nothing can be added or changed in the branch before that. "Later" only closes it until the next page. Only
// the branch manager can set it up (Settings → Branch e-mail); everyone else is told to ask them.
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Mail } from 'lucide-react'
import { Modal } from '@/components/modal'

export function BranchEmailPrompt({ branchName, canSetUp }: { branchName: string; canSetUp: boolean }) {
  const pathname = usePathname()
  const [closedOn, setClosedOn] = useState<string | null>(null)
  if (closedOn === pathname || pathname.startsWith('/settings')) return null
  const later = () => setClosedOn(pathname)
  return (
    <Modal title="Set up the branch e-mail first" onClose={later}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Mail size={22} style={{ flexShrink: 0, marginTop: 2 }} />
        <div className="section-hint" style={{ margin: 0, fontSize: 13 }}>
          <p style={{ margin: '0 0 8px' }}><b>{branchName}</b> does not have its own mail server yet. Its e-mails (student logins, staff logins, fee reminders) must go out from the branch’s own address.</p>
          <p style={{ margin: 0 }}><b>Until it is set up, nothing can be added or changed in this branch</b> — no leads, registrations, payments or other entries.{' '}
            {canSetUp ? 'Add the branch’s SMTP details (Gmail, Outlook, Zoho, Hostinger…) to start.' : 'Ask your branch manager to set it up under Settings → Branch e-mail.'}</p>
        </div>
      </div>
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={later}>{canSetUp ? 'Later' : 'OK'}</button>
        {canSetUp && <Link href="/settings?tab=branch-email" className="button primary">Set up now</Link>}
      </div>
    </Modal>
  )
}
