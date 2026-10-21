import { BrandMark } from '@/components/brand-mark'
import { orgBrand } from '@/lib/brand'
import { requireRequestOrg } from '@/lib/tenant/request'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Payment', robots: { index: false, follow: false } }

// Where a parent comes back to after paying through their link (app/p/[token]). The link itself is not known here
// (only its hash is kept), so this page says how it went and sends them back to the message the link came in.
export default async function ParentPaid({ searchParams }: { searchParams: Promise<{ payment?: string; receipt?: string }> }) {
  const org = await requireRequestOrg()
  const brand = await orgBrand(org.id)
  const { payment, receipt } = await searchParams
  const ok = payment === 'paid' || payment === 'review'
  return (
    <main style={{ minHeight: '100vh', background: 'var(--page)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <section style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 18, padding: 24, maxWidth: 420, display: 'grid', gap: 12, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}><BrandMark brand={brand} height={36} /></div>
        <h1 style={{ margin: 0, fontSize: 20 }}>{ok ? 'Payment received. Thank you!' : 'The payment was not completed'}</h1>
        <p style={{ margin: 0, color: 'var(--muted)' }}>
          {payment === 'paid' ? `The receipt${receipt ? ` (${receipt})` : ''} is on the student's page: open the link you were sent again to see it.`
            : payment === 'review' ? 'The office will confirm it and add the receipt.'
            : 'If money was taken, it is confirmed within a few minutes. You can try again from the link you were sent.'}
        </p>
      </section>
    </main>
  )
}
