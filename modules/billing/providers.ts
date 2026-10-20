// How an institute pays the platform: a hosted payment page (Razorpay Payment Links), so no payment script runs in
// our pages. The provider confirms twice: the browser comes back with a signed callback, and a signed webhook
// arrives on its own; either one completes the payment (once). Without Razorpay keys, outside production (or with
// BILLING_FAKE=1), a fake provider stands in so development and the end-to-end run can pay.
import { createHmac, timingSafeEqual } from 'crypto'
import { serverSecret } from '@/lib/auth/secret'

export type PaymentLinkInput = { ref: string; amount: number /* paise */; description: string; customer: { name: string; email: string; contact?: string | null }; callbackUrl: string }
/** What a provider says was paid: our payment's id (ref) and the provider's own payment id. */
export type Paid = { ref: string; providerPaymentId: string }

export interface BillingProvider {
  name: 'razorpay' | 'fake'
  createPaymentLink(p: PaymentLinkInput): Promise<{ id: string; url: string }>
  /** The browser's return from the payment page: the payment, if the signature is right and it was paid. */
  verifyCallback(q: URLSearchParams): Paid | null
  /** A webhook: its id (for handling it once), and the payment, if the signature is right and it is a payment. */
  verifyWebhook(rawBody: string, headers: Headers): { eventId: string; type: string; paid: Paid | null; payload: unknown } | null
}

const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) }
const hmac = (key: string, data: string) => createHmac('sha256', key).update(data).digest('hex')

export function razorpay(keyId: string, keySecret: string, webhookSecret: string | null): BillingProvider {
  return {
    name: 'razorpay',
    async createPaymentLink(p) {
      const res = await fetch('https://api.razorpay.com/v1/payment_links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}` },
        body: JSON.stringify({
          amount: p.amount, currency: 'INR', reference_id: p.ref, description: p.description.slice(0, 2048),
          customer: { name: p.customer.name, email: p.customer.email, ...(p.customer.contact ? { contact: p.customer.contact } : {}) },
          notify: { sms: false, email: false }, reminder_enable: false, callback_url: p.callbackUrl, callback_method: 'get',
          expire_by: Math.floor(Date.now() / 1000) + 2 * 24 * 3600,
        }),
        signal: AbortSignal.timeout(15_000),
      })
      const body = (await res.json().catch(() => ({}))) as { id?: string; short_url?: string; error?: { description?: string } }
      if (!res.ok || !body.id || !body.short_url) throw new Error(`The payment page could not be opened: ${body.error?.description ?? res.status}`)
      return { id: body.id, url: body.short_url }
    },
    verifyCallback(q) {
      const [id, ref, status, pay, sig] = ['razorpay_payment_link_id', 'razorpay_payment_link_reference_id', 'razorpay_payment_link_status', 'razorpay_payment_id', 'razorpay_signature'].map((k) => q.get(k) ?? '')
      if (!id || !ref || !pay || !sig || !same(hmac(keySecret, `${id}|${ref}|${status}|${pay}`), sig)) return null
      return status === 'paid' ? { ref, providerPaymentId: pay } : null
    },
    verifyWebhook(rawBody, headers) {
      const sig = headers.get('x-razorpay-signature') ?? ''
      if (!webhookSecret || !sig || !same(hmac(webhookSecret, rawBody), sig)) return null
      let body: { event?: string; payload?: { payment_link?: { entity?: { reference_id?: string } }; payment?: { entity?: { id?: string } } } }
      try { body = JSON.parse(rawBody) } catch { return null }
      const eventId = headers.get('x-razorpay-event-id') ?? hmac(webhookSecret, rawBody).slice(0, 32)
      const ref = body.payload?.payment_link?.entity?.reference_id, pay = body.payload?.payment?.entity?.id
      return { eventId, type: body.event ?? 'unknown', paid: body.event === 'payment_link.paid' && ref && pay ? { ref, providerPaymentId: pay } : null, payload: body }
    },
  }
}

/** Stands in for the provider where no real one is set up (never in production unless BILLING_FAKE=1). */
export function fakeProvider(): BillingProvider {
  const key = () => serverSecret('AUTH_SECRET')
  return {
    name: 'fake',
    async createPaymentLink(p) {
      const id = `fake_${p.ref}`
      // our own page plays the payment page; the callback comes back signed like Razorpay's
      return { id, url: `/billing/fake-pay?ref=${encodeURIComponent(p.ref)}&amount=${p.amount}&back=${encodeURIComponent(p.callbackUrl)}&sig=${hmac(key(), `fake-link:${p.ref}:${p.amount}`)}` }
    },
    verifyCallback(q) {
      const ref = q.get('ref') ?? '', pay = q.get('payment') ?? '', sig = q.get('sig') ?? ''
      return ref && pay && same(hmac(key(), `fake-paid:${ref}:${pay}`), sig) ? { ref, providerPaymentId: pay } : null
    },
    verifyWebhook() { return null },
  }
}
/** The fake payment page's signatures (it is our own page). */
export const fakeLinkSig = (ref: string, amount: number) => hmac(serverSecret('AUTH_SECRET'), `fake-link:${ref}:${amount}`)
export const fakePaidSig = (ref: string, pay: string) => hmac(serverSecret('AUTH_SECRET'), `fake-paid:${ref}:${pay}`)

export const fakeAllowed = () => process.env.NODE_ENV !== 'production' || process.env.BILLING_FAKE === '1'

/** The provider this server uses, or null when online payment is not set up. */
export function billingProvider(): BillingProvider | null {
  const { RAZORPAY_KEY_ID: id, RAZORPAY_KEY_SECRET: secret, RAZORPAY_WEBHOOK_SECRET: hook } = process.env
  if (id && secret) return razorpay(id, secret, hook || null)
  return fakeAllowed() ? fakeProvider() : null
}
