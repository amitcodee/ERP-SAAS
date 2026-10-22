'use client'
// Decides on every navigation (the panel's frame stays mounted between pages, so the server cannot) whether the page
// may show while the institute waits for approval or is closed until paid (lib/tenant/gate.ts).
import { usePathname } from 'next/navigation'
import { AccountGate } from '@/components/account-gate'
import { gateFor } from '@/lib/tenant/gate'

export function GateFrame({ status, isHeadOffice, name, children }: { status: string; isHeadOffice: boolean; name: string; children: React.ReactNode }) {
  const gate = gateFor(status, usePathname() ?? '/', isHeadOffice)
  return gate ? <AccountGate gate={gate} isHeadOffice={isHeadOffice} name={name} /> : <>{children}</>
}
