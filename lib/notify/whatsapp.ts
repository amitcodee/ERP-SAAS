// The WhatsApp messages the panel sends, in one place: what each is, which outbox templates it covers, the AiSensy API
// campaign that sends it, and the approved WhatsApp template behind that campaign (its exact wording, as submitted in
// AiSensy → Manage → Template Message). The provider, the event hooks, Settings → WhatsApp & SMS and the tests all
// read this list; nothing else names a campaign or a parameter.
// Fee reminders: the wording lives in Settings → Reminders and fills {{1}}, so it can change without a new approval.

export type WaMessage = {
  label: string
  /** When it goes out, in a few words (shown in Settings). */
  when: string
  /** Outbox templates (notifications.template) sent with this message. */
  covers: readonly string[]
  /** The AiSensy API campaign's name, as created under Campaigns → API (can be changed in Settings). */
  campaign: string
  /** The WhatsApp template the campaign sends. */
  template: { name: string; category: 'UTILITY' | 'MARKETING'; language: 'en'; body: string }
  /** What fills {{1}}, {{2}}… in order. */
  params: readonly string[]
  /** Sent on an event: not sent at all when it has waited longer than this (WhatsApp off, AiSensy down). */
  maxAgeHours?: number
}

export const WA_MESSAGES = {
  fee_reminder: {
    label: 'Fee reminders',
    when: 'Before, on and after an installment’s due date (Settings → Reminders)',
    covers: ['fee_due_soon', 'fee_due_today', 'fee_overdue', 'settings_test'],
    campaign: 'techcadd_installment_reminder',
    template: {
      name: 'techcadd_installment_reminder', category: 'UTILITY', language: 'en',
      body: 'Fee reminder from techcadd\n\n{{1}}\n\nIf you have already paid, please ignore this message. For any help, reply here or visit your branch office.',
    },
    params: ['text'],
  },
  enquiry_thanks: {
    label: 'Thank you for your enquiry',
    when: 'A new lead (added in the panel or from the website) or a random call is saved',
    covers: ['enquiry_thanks'],
    campaign: 'techcadd_enquiry_thanks',
    template: {
      name: 'techcadd_enquiry_thanks', category: 'UTILITY', language: 'en',
      body: 'Hello {{1}},\n\nThank you for choosing techcadd {{2}}! We have received your enquiry and our counsellor will get in touch with you shortly.\n\nFor any questions, simply reply to this message.',
    },
    params: ['first_name', 'branch'],
    maxAgeHours: 48,
  },
  visit_thanks: {
    label: 'Thank you for visiting',
    when: 'A walk-in enquiry is saved, a lead is marked visited, or a call is made into an enquiry',
    covers: ['visit_thanks'],
    campaign: 'techcadd_visit_thanks',
    template: {
      name: 'techcadd_visit_thanks', category: 'UTILITY', language: 'en',
      body: 'Hello {{1}},\n\nThank you for visiting techcadd {{2}}. It was great meeting you! If you have any questions about courses, fees or batch timings, just reply to this message and our team will help you.',
    },
    params: ['first_name', 'branch'],
    maxAgeHours: 48,
  },
  registration: {
    label: 'Registration confirmed',
    when: 'A student is registered (the login itself goes by e-mail after the first payment)',
    covers: ['registration_confirmed'],
    // Meta refused a wording pointing to login details in the e-mail (INCORRECT_CATEGORY): keep to this one
    campaign: 'techcadd_registration_done',
    template: {
      name: 'techcadd_registration_done', category: 'UTILITY', language: 'en',
      body: 'Hello {{1}},\n\nCongratulations! Your registration at techcadd {{2}} is confirmed.\n\nRegistration no: {{3}}\nCourse: {{4}}\n\nYour student panel login will be sent to you after your first fee payment. Welcome to techcadd!',
    },
    params: ['first_name', 'branch', 'reg_no', 'course'],
    maxAgeHours: 72,
  },
  certificate: {
    label: 'Certificate issued',
    when: 'A certificate request is approved',
    covers: ['certificate_issued'],
    campaign: 'techcadd_certificate_issued',
    template: {
      name: 'techcadd_certificate_issued', category: 'UTILITY', language: 'en',
      body: 'Hello {{1}},\n\nCongratulations! Your techcadd certificate for {{2}} has been issued.\n\nCertificate no: {{3}}\nView / download: {{4}}\n\nWe wish you all the best for your career ahead.',
    },
    params: ['first_name', 'course', 'cert_no', 'link'],
    maxAgeHours: 168,
  },
} as const satisfies Record<string, WaMessage>

export type WaMessageKey = keyof typeof WA_MESSAGES
export const WA_KEYS = Object.keys(WA_MESSAGES) as WaMessageKey[]
/** The messages sent on an event (each can be switched off in Settings). */
export type WaEventKey = Exclude<WaMessageKey, 'fee_reminder'>
export const WA_EVENT_KEYS = WA_KEYS.filter((k): k is WaEventKey => k !== 'fee_reminder')

/** The message an outbox template goes out as, or null when the panel has no WhatsApp message for it. */
export function waMessageFor(template: string): WaMessageKey | null {
  return WA_KEYS.find((k) => (WA_MESSAGES[k].covers as readonly string[]).includes(template)) ?? null
}

/**
 * Template parameters as WhatsApp takes them, in the message's order: one line each (no new lines or tabs, no runs
 * of spaces) and never empty, or the message is refused.
 */
export function waParams(key: WaMessageKey, vars: Record<string, string | null | undefined>): string[] {
  return (WA_MESSAGES[key].params as readonly string[]).map((p) => (vars[p] ?? '').replace(/\s+/g, ' ').trim().slice(0, 900) || '-')
}

/** The message as the student reads it (kept in the outbox log). */
export function waText(key: WaMessageKey, params: string[]): string {
  return WA_MESSAGES[key].template.body.replace(/\{\{(\d+)\}\}/g, (m, i: string) => params[Number(i) - 1] ?? m)
}

/** The branch as the messages name it: "techcadd Mohali" → "Mohali". */
export const branchWord = (name: string) => name.replace(/^techcadd\s*/i, '').trim()

// ---- Bulk WhatsApp: campaigns made in AiSensy (Campaigns → API) and listed in Settings → WhatsApp campaigns, sent
// from the Bulk WhatsApp page to students or leads. What can fill a campaign's {{1}}, {{2}}… is listed here.

/** A campaign's parameter: a detail of each person, or `text`, typed once when sending (the same for everyone). */
export const WA_FIELDS = {
  first_name: { label: 'First name', sample: 'Aman' },
  full_name: { label: 'Full name', sample: 'Aman Gill' },
  branch: { label: 'Branch (e.g. Mohali)', sample: 'Mohali' },
  course: { label: 'Course', sample: 'AutoCAD' },
  reg_no: { label: 'Registration no (students)', sample: 'TCD/4002/118' },
  balance: { label: 'Fee still due, ₹ (students)', sample: '₹12,000' },
  text: { label: 'Typed when sending', sample: '…' },
} as const
export type WaField = keyof typeof WA_FIELDS
export const WA_FIELD_KEYS = Object.keys(WA_FIELDS) as WaField[]
/** {{n}} of a campaign: what fills it, and for `text` what to ask when sending. */
export type WaCampaignParam = { field: WaField; label?: string }

/** Who a campaign is meant for (the Bulk WhatsApp page offers it for those). */
export const WA_AUDIENCES = { any: 'Students and leads', students: 'Students', leads: 'Leads' } as const
export type WaAudience = keyof typeof WA_AUDIENCES

/** The message as the person reads it, from the template text kept with the campaign (when one was pasted). */
export function campaignText(body: string | null | undefined, params: string[], campaign: string) {
  return body?.trim() ? body.replace(/\{\{(\d+)\}\}/g, (m, i: string) => params[Number(i) - 1] ?? m) : `[${campaign}] ${params.join(' · ')}`
}
