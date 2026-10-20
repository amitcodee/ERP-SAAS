// What sign-up refuses: throw-away mailboxes (an institute's owner must be reachable), and web addresses that would
// pass for someone else (banks, government, the big brands, payment providers) or for the platform itself.

export const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', 'grr.la', '10minutemail.com', '10minutemail.net',
  'tempmail.com', 'temp-mail.org', 'temp-mail.io', 'tempmailo.com', 'tempail.com', 'throwawaymail.com', 'yopmail.com', 'yopmail.net',
  'trashmail.com', 'trashmail.de', 'getnada.com', 'nada.email', 'maildrop.cc', 'dispostable.com', 'fakeinbox.com', 'mintemail.com',
  'mohmal.com', 'emailondeck.com', 'mailnesia.com', 'mytemp.email', 'tmpmail.org', 'tmpmail.net', 'burnermail.io', 'spamgourmet.com',
  'mailcatch.com', 'inboxkitten.com', 'mailpoof.com', 'moakt.com', 'luxusmail.org', 'emailfake.com', 'fakemail.net', 'discard.email',
  'harakirimail.com', 'mail.tm', 'linshiyouxiang.net', 'tempr.email', 'byom.de', 'mvrht.net', 'example.com', 'example.org', 'test.com',
])

/** Words a web address may not be or start with (beyond the reserved subdomains in lib/tenant/host.ts). */
export const BLOCKED_SLUG_WORDS = [
  'google', 'gmail', 'microsoft', 'apple', 'amazon', 'facebook', 'instagram', 'whatsapp', 'youtube', 'paytm', 'phonepe', 'razorpay',
  'stripe', 'paypal', 'sbi', 'hdfc', 'icici', 'bank', 'rbi', 'gov', 'govt', 'police', 'cbse', 'ugc', 'aicte', 'nptel', 'support',
  'security', 'billing', 'invoice', 'payment', 'password', 'verify', 'official', 'secure', 'administrator', 'superuser',
]

export const isDisposable = (email: string) => DISPOSABLE_DOMAINS.has(email.split('@')[1]?.toLowerCase() ?? '')
export const slugBlocked = (slug: string) => BLOCKED_SLUG_WORDS.some((w) => slug === w || slug.startsWith(`${w}-`) || slug.startsWith(w) && slug.length <= w.length + 2)
