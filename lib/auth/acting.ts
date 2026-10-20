// Which branch a request works in, from the person's LIVE state (never the sign-in session, which can be hours old):
// a move by head office, a branch taken away or a share removed applies on the very next click.
import type { WorkBranch } from '@/modules/auth/account'

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * - super admin: no home branch; acts inside the branch picked in the switcher (cookie), or none (all branches);
 * - staff: their home branch now, or another of THEIR branches picked in the switcher; null = no branch left (sign out).
 * `ownOnly`: working in a second branch shared for their own work only.
 */
export function actingBranch(live: { homeBranchId: string | null; branches: WorkBranch[] }, role: string, picked: string | undefined): { branchId: string | null; ownOnly: boolean } {
  if (role === 'super_admin') return { branchId: picked && UUID.test(picked) ? picked : null, ownOnly: false }
  if (!live.homeBranchId) return { branchId: null, ownOnly: false }
  const other = picked && picked !== live.homeBranchId ? live.branches.find((b) => b.id === picked) : undefined
  return other ? { branchId: other.id, ownOnly: other.access !== 'full' } : { branchId: live.homeBranchId, ownOnly: false }
}
