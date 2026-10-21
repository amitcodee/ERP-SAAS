import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AuthShell } from '@/components/auth-shell'
import { maskEmail, readChallenge, TWO_FACTOR_COOKIE } from '@/modules/auth/two-factor'
import { VerifyForm } from './verify-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Verify sign-in' }

// Second step of a two-step sign-in. Reached only with a pending sign-in (password already accepted).
export default async function VerifyPage() {
  const c = await readChallenge((await cookies()).get(TWO_FACTOR_COOKIE)?.value, 'login')
  if (!c) redirect('/login')
  return (
    <AuthShell tagline="One more step to keep your account safe.">
      <VerifyForm email={maskEmail(c.email)} />
    </AuthShell>
  )
}
