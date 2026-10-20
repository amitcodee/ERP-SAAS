import { headers } from 'next/headers'

/**
 * Whether this request reached the panel over HTTPS. Sign-in cookies are Secure only then: on a plain-http address
 * (e.g. the server's sslip.io one) a Secure cookie is dropped by the browser and sign-in just reloads the login page.
 * Behind the proxy the scheme is in x-forwarded-proto; without it, production is assumed to be HTTPS.
 */
export async function httpsRequest(): Promise<boolean> {
  const proto = (await headers()).get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
  return proto ? proto === 'https' : process.env.NODE_ENV === 'production'
}
