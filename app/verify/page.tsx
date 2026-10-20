import { VerifyForm } from '@/components/verify-form'
import { VerifyShell } from '@/components/verify-shell'
import { makePuzzle } from '@/lib/verify-puzzle'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Verify a certificate | techcadd' }

// Public: anyone (an employer, a college) checks a techcadd certificate by its number or the student's registration
// number, after a drawn sum. The result is the same page the certificate's QR code opens.
export default function Page() {
  return (
    <VerifyShell>
      <section className="vf-card"><VerifyForm first={makePuzzle()} /></section>
    </VerifyShell>
  )
}
