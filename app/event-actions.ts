'use server'
// Seminars & workshops and Certificate Designs (modules/events/service.ts): thin server actions, as in app/actions.ts.
// The public sign-up (joinEventAction) needs no sign-in: it is limited per address and checks everything itself.
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { getActor } from '@/lib/auth/current'
import { appOrigin } from '@/lib/app-url'
import { clientIpFrom } from '@/lib/client-ip'
import { withTenant } from '@/lib/db/withTenant'
import { userMessage } from '@/lib/errors'
import { log } from '@/lib/log'
import { providerFor } from '@/lib/notify/providers'
import { underLimit } from '@/lib/redis'
import { requireRequestOrg } from '@/lib/tenant/request'
import {
  archiveDesign, createEvent, quizTicket, eventCertificateMail, fetchDesignImage, issueParticipantCertificate, joinEvent, markMailed, setEventOpen, updateEvent,
  type EventInput, type JoinInput, type JoinResult,
} from '@/modules/events/service'

type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string }
async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (e) {
    return { ok: false, error: userMessage(e, 'Something went wrong. Please try again.', 'action.error') }
  }
}

/** E-mails a participant their certificate, after the response (best effort: the page shows it anyway). */
async function mailLater(orgId: string, participantId: string) {
  const origin = await appOrigin(orgId)
  after(async () => {
    try {
      const m = await eventCertificateMail(orgId, participantId, origin)
      if (!m) return
      const mail = await providerFor(orgId, 'email', m.branchId)
      if (!mail) return markMailed(orgId, participantId, 'E-mail is not set up (Settings → E-mail)')
      const r = await mail.send({ channel: 'email', to: m.to, template: 'event_certificate', subject: m.subject, body: m.body })
      await markMailed(orgId, participantId, r.ok ? null : r.error)
    } catch (e) {
      log.warn('event.mail_failed', { participantId, error: e instanceof Error ? e.message : String(e) })
      await markMailed(orgId, participantId, 'Sending failed').catch(() => {})
    }
  })
}

// ---- Certificate Designs -----------------------------------------------------------------------------------------
// (saving goes through /api/cert-designs: a design with pictures is bigger than a server action takes)

export async function archiveDesignAction(id: string) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => archiveDesign(tx, actor, id)))
  if (res.ok) revalidatePath('/certificate-designs')
  return res
}

/** A picture from a link, as a data: URL for the editor. */
export async function fetchDesignImageAction(link: string) {
  const { actor } = await getActor()
  if (!(await underLimit(`design-image:${actor.userId}`, 60, 3600))) return { ok: false as const, error: 'Too many pictures fetched: try again in an hour' }
  return run(() => fetchDesignImage(actor, link))
}

// ---- Events --------------------------------------------------------------------------------------------------------

export async function saveEventAction(id: string | null, input: EventInput) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => (id ? (await updateEvent(tx, actor, id, input), id) : createEvent(tx, actor, input))))
  if (res.ok) revalidatePath('/events', 'layout')
  return res
}

export async function setEventOpenAction(id: string, open: boolean) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => setEventOpen(tx, actor, id, open)))
  if (res.ok) revalidatePath('/events', 'layout')
  return res
}

/** Issues the certificate when it is due but missing, and e-mails it (again). */
export async function resendEventCertificateAction(participantId: string) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => issueParticipantCertificate(tx, actor, participantId)))
  if (res.ok) { await mailLater(actor.orgId, participantId); revalidatePath('/events', 'layout') }
  return res
}

// ---- The public page /e/<token> ----------------------------------------------------------------------------------

/** Opening the quiz: its signed start time, so the server keeps the time limit. */
export async function startQuizAction(token: string): Promise<string> {
  return quizTicket(String(token).slice(0, 40))
}

export async function joinEventAction(token: string, input: JoinInput): Promise<ActionResult<JoinResult>> {
  const ip = clientIpFrom(await headers())
  // per connection (an IPv6 address counts by its /64, which one home or phone holds), per event, and for the whole site:
  // the page cannot be used to mail many addresses
  const who = ip && ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip ?? 'unknown'
  const busy = 'Too many sign-ups right now: please try again later'
  if (!(await underLimit(`event-join:${who}`, 20, 3600))) return { ok: false, error: 'Too many sign-ups from this connection: please try again later' }
  if (!(await underLimit(`event-join-event:${String(token).slice(0, 40)}`, 600, 3600))) return { ok: false, error: busy }
  const org = await requireRequestOrg() // the event is looked up in the institute whose address this is
  if (!(await underLimit(`event-join-all:${org.id}`, 2000, 3600))) return { ok: false, error: busy }
  const res = await run(() => joinEvent(org.id, String(token), input, ip))
  if (res.ok && res.data!.mail) await mailLater(org.id, res.data!.participantId)
  return res
}
