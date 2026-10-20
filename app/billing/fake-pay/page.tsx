import { notFound } from 'next/navigation'
import { fakeAllowed, fakeLinkSig, fakePaidSig } from '@/modules/billing/providers'

export const dynamic = 'force-dynamic'

// Stands in for the provider's payment page where no real one is set up (development, the end-to-end run). Never
// shown in production unless BILLING_FAKE=1. Like a real provider it sends the browser back with a full page load
// and a signed answer (a plain form, not a server action: the return route is not a page).
export default async function FakePay({ searchParams }: { searchParams: Promise<{ ref?: string; amount?: string; back?: string; sig?: string }> }) {
  if (!fakeAllowed()) notFound()
  const { ref = '', amount = '0', back = '', sig = '' } = await searchParams
  if (sig !== fakeLinkSig(ref, Number(amount))) notFound()
  const back_ = new URL(back, 'http://x')
  if (back_.pathname !== '/billing/return') notFound()
  const payment = `fakepay_${Date.now().toString(36)}`
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <form method="get" action="/billing/return" className="panel" style={{ display: 'grid', gap: 12, width: 'min(380px, 100%)', background: '#fff', borderRadius: 16 }}>
        <p style={{ margin: 0, padding: '6px 10px', borderRadius: 8, background: '#fff7e6', color: '#5c3b00', fontSize: 13 }}>Test payment page: no money moves.</p>
        <h1 style={{ margin: 0, fontSize: 22 }}>Pay ₹{(Number(amount) / 100).toLocaleString('en-IN')}</h1>
        <input type="hidden" name="ref" value={ref} />
        <input type="hidden" name="payment" value={payment} />
        <input type="hidden" name="sig" value={fakePaidSig(ref, payment)} />
        <button className="button primary">Pay (test)</button>
      </form>
    </main>
  )
}
