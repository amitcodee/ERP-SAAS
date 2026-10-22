// What an institute may use while it waits for the platform's approval or is closed until paid (modules/platform/rules.ts,
// modules/billing/dunning.ts). Waiting: head office can finish Set Up and choose a plan, nothing else. Closed (trial or
// plan over): head office sees only Plan & billing and its own account; everyone else is told it is paused.
// The database stays the guard for writes (a closed institute is read-only); this decides what the screens show.
export type Gate = 'pending' | 'closed'

const PENDING_OK = ['/setup', '/settings', '/account', '/branches', '/users', '/courses', '/course-categories', '/roles', '/certificate-designs', '/billing']
const CLOSED_OK = ['/settings', '/account', '/billing']

const under = (path: string, roots: string[]) => roots.some((r) => path === r || path.startsWith(`${r}/`))

/** The gate in front of `path`, or null when it may be shown. */
export function gateFor(status: string, path: string, isHeadOffice: boolean): Gate | null {
  if (status === 'pending') return isHeadOffice && under(path, PENDING_OK) ? null : 'pending'
  if (status === 'read_only') return isHeadOffice && under(path, CLOSED_OK) ? null : 'closed'
  return null
}
