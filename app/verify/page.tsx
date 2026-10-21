import { VerifyForm } from '@/components/verify-form'
import { VerifyShell } from '@/components/verify-shell'
import { makePuzzle } from '@/lib/verify-puzzle'
import { requireRequestOrg } from '@/lib/tenant/request'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Verify a certificate' }

// Public: anyone (an employer, a college) checks one of the institute's certificates by its number or the student's registration
// number, after a drawn sum. The result is the same page the certificate's QR code opens.
export default async function Page() {
  const org = await requireRequestOrg()
  return (
    <VerifyShell>
      <section className="vf-card"><VerifyForm first={makePuzzle()} institute={org.name} /></section>
    </VerifyShell>
  )
}
