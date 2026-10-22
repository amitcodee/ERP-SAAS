'use server'
// Thin server actions: authenticate -> validate -> call the module service inside withTenant.
import { cookies, headers } from 'next/headers'
import { createCategory, decideCategory, setSignatureChoice, updateCategory, type CategoryInput } from '@/modules/catalog/categories'
import { cancelInternship, createInternship, createTemplate, deleteTemplate, issueCompletion, issueOffer, listTemplates, registrationLetters, requestCompletion, resetTemplate, saveCompany, saveTemplate, setRegistrationLetters, updateInternship, type CompanyInput, type InternInput } from '@/modules/letters/service'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { clientIpFrom } from '@/lib/client-ip'
import { ACTING_BRANCH_COOKIE, getActor } from '@/lib/auth/current'
import { withOrgSystem, withTenant, type Actor } from '@/lib/db/withTenant'
import { requireRequestOrg } from '@/lib/tenant/request'
import { audit } from '@/lib/audit'
import { webLeadsSecretFor } from '@/lib/tenant/web-leads-secret'
import { setNumbering } from '@/modules/settings/numbering'
import { endSupportByOrg } from '@/modules/platform/service'
import { checkoutInput, quoteFor, setCancelAtPeriodEnd, startCheckout } from '@/modules/billing/service'
import { applyCatalogue, brandingInput, feesInput, markStep, saveBranding, saveFees, type StepKey } from '@/modules/onboarding/service'
import { deleteBatch, deleteCourse, deleteRegistration, deleteUser, deleteWebLeadSoft, purgeItem, restoreItem, type Kind as RecycleKind } from '@/modules/ops/recycle'
import { z } from 'zod'
import { isDialCode } from '@/lib/countries'
import { branchEmailBlock, canManageBranchEmail, dropConfigCache, getConfig, saveBranchEmail, saveConfig } from '@/lib/config/store'
import { assertPublicHost } from '@/lib/net-guard'
import { providerFor } from '@/lib/notify/providers'
import { WA_EVENT_KEYS, WA_FIELDS, WA_KEYS, type WaEventKey, type WaMessageKey } from '@/lib/notify/whatsapp'
import { escapeHtml, plainText } from '@/lib/notify/layout'
import { orgBrand } from '@/lib/brand'
import { runNamedJob } from '@/lib/job-registry'
import { createWebhook, deleteWebhook, listDeliveries, testWebhook, updateWebhook, webhookSecret } from '@/modules/integrations/webhooks'
import { createApiKey, revokeApiKey } from '@/modules/integrations/api'
import { log } from '@/lib/log'
import { activateBranch, branchSetup, createBranch, regNumbering, resendLogin, roleNames, setHomeBranch, setRegNumbering, setStaffAccess, shareStaff, staffElsewhere, unshareStaff, updateBranch, type CreateBranchInput, type UpdateBranchInput } from '@/modules/branches/service'
import { mailLogins, type Mailed } from '@/modules/branches/welcome'
import { eq, sql, type SQL } from 'drizzle-orm'
import { completeIfDone, completionStatus, markCompleted } from '@/modules/registrations/completion'
import { certificateIssuedMail } from '@/modules/certificates/mail'
import { announceCertificate } from '@/modules/notifications/whatsapp-events'
import { broadcastFailures, listCampaigns, paramsFor, previewBroadcast, saveCampaign, sendBroadcast, type AudienceInput, type CampaignInput } from '@/modules/notifications/broadcasts'
import { acceptTransfer, assertTransferBranch, cancelTransfer, rejectTransfer, requestTransfer, transferPersonCheck } from '@/modules/registrations/transfer'
import { acceptShare, askShare, declineShare, endShare, type ShareAsk } from '@/modules/registrations/shares'
import { branchMatchDetails, branchMatches, type MatchQuery } from '@/modules/people/matches'
import { deleteAnnouncementTemplate, fillTemplate, resetTemplate as resetMessageTemplate, resolveTemplate, saveAnnouncementTemplate, saveTemplate as saveMessageTemplate } from '@/modules/templates/service'
import { askForHelp, batchTeaching, chooseHelper, closeHelp, courseSyllabus, createTest, decideSyllabusChange, deleteNote, deleteTest, helpMails, listNotes, offerHelp, saveSyllabus, saveTestMarks, setDayTopics, setSyllabusFile, setTopicCovered, studentHelp, teachingCalendar, withdrawOffer, type HelpInput, type TestInput, type TopicInput } from '@/modules/teaching/service'
import { assignTicket, closeTicket, escalateTicket, postAnnouncement, raiseInternalTicket, raiseTicket, rateTicket, removeAnnouncement, replyTicket, setAnnouncementPinned, setTicketPriority, ticketAssignees, ticketMessages, type AnnouncementInput, type InternalTicketInput, type RaiseTicketInput } from '@/modules/support/service'
import { branches } from '@/lib/db/schema'
import { appOrigin } from '@/lib/app-url'
import { openFeePayment, startFeePayment } from '@/modules/fees/online'
import { gradesProblem } from '@/lib/grades'
import { FEATURES } from '@/lib/panel/features'
import { addExpense, deleteExpense, type ExpenseInput } from '@/modules/expenses/service'
import { createParentLink, parentLinkState, parentView, revokeParentLink } from '@/modules/portal/parent'
import { callFollowUps, createEnquiry, deleteCall, deleteLead, enquiryTimeline, visitSummary, followUpCall, followUpLead, leadRecord, logCall, restoreDeleted, transitionEnquiry, updateCall, updateLead } from '@/modules/enquiries/service'
import type { CreateEnquiryInput, FollowUpCallInput, FollowUpLeadInput, LogCallInput, TransitionInput, UpdateCallInput, UpdateLeadInput } from '@/modules/enquiries/validators'
import { applyDiscount, listReceipts, recordPayment, reversePayment, type DiscountInput, type RecordPaymentInput, type ReversalInput } from '@/modules/fees/service'
import { studentFees, changeTotalFee, decideFeeChange, feeSchedule, fixFeeRemark, raiseFeeRemark, requestFeeChange, setFeePlan, type FeeChangeInput, type FeePlanInput, type FeeRemarkInput } from '@/modules/fees/service'
import type { RegDatesInput } from '@/modules/registrations/validators'
import { setMyAadhaar } from '@/modules/portal/service'
import { clearLock, listLoginLog, removeIpRule, setIpRule, type loginLogQuery } from '@/modules/auth/guard'
import { fillIpGeo } from '@/lib/ip-geo'
import { callForRegistration, registrationDetails, updateRegistrationDates, createRegistration, enquiryForRegistration, registrationForUpgrade, searchRegistrationSources, searchRegistrationsToUpgrade, transitionRegistration, type SourceFilter, registrationOptions, updateRegistrationOptions } from '@/modules/registrations/service'
import type { CreateRegistrationInput, RegTransitionInput } from '@/modules/registrations/validators'
import { assignWebLead, listWebLeads, editWebLead } from '@/modules/web-leads/service'
import { userMessage } from '@/lib/errors'

type LoginLogQuery = import('zod').input<typeof loginLogQuery>

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string }

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (e) {
    // business rules throw plain Errors (shown to the user); database/driver failures are logged and never shown as they are
    return { ok: false, error: userMessage(e, 'Something went wrong. Please try again.', 'action.error') }
  }
}

// Branch staff cannot add or change anything until their branch's own mail server is set up (lib/config/store.ts)
async function branchEmailGate(): Promise<{ ok: false; error: string } | null> {
  const error = await branchEmailBlock((await getActor()).actor)
  return error ? { ok: false, error } : null
}

/** Super admin: any branch (or none). Staff serving several branches: one of their own. */
export async function setActingBranchAction(branchId: string) {
  const { session, myBranches } = await getActor()
  if (session.role !== 'super_admin' && !myBranches.some((b) => b.id === branchId)) return
  const jar = await cookies()
  if (branchId) jar.set(ACTING_BRANCH_COOKIE, branchId, { httpOnly: true, sameSite: 'lax', path: '/', secure: await httpsRequest() })
  else jar.delete(ACTING_BRANCH_COOKIE)
  revalidatePath('/', 'layout')
}

// ---- Branches: create -> setup (details, counselor, accountant) -> activate -> logins mailed -------------
export type MailedLogin = Mailed

export async function createBranchAction(input: CreateBranchInput): Promise<ActionResult<{ id: string; code: string }>> {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => { const r = await createBranch(tx, actor, input); return { id: r.branch.id, code: r.branch.code } }))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function updateBranchAction(input: UpdateBranchInput) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => updateBranch(tx, actor, input)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

/** How a branch numbers its registrations (head office sets it). */
export async function regNumberingAction(branchId: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => regNumbering(tx, actor, branchId)))
}
export async function setRegNumberingAction(branchId: string, format: string | null, next: number | null) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => setRegNumbering(tx, actor, branchId, format, next)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function branchSetupAction(branchId: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => branchSetup(tx, actor, branchId)))
}

/** People holding this role in the other branches, to share one of them with this branch. */
export async function staffElsewhereAction(branchId: string, role: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => staffElsewhere(tx, actor, branchId, role)))
}

export async function shareStaffAction(branchId: string, userId: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => shareStaff(tx, actor, branchId, userId)))
}

/** Head office: a staff member's home branch moves to `branchId`; `keepOld` keeps the old one as an extra branch. */
export async function setHomeBranchAction(userId: string, branchId: string, keepOld: boolean) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => setHomeBranch(tx, actor, userId, branchId, keepOld)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

/** Head office: in a branch they are shared with, the person sees only their own work there, or all of it. */
export async function setStaffAccessAction(branchId: string, userId: string, access: 'own' | 'full') {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => setStaffAccess(tx, actor, branchId, userId, access)))
}

export async function unshareStaffAction(branchId: string, userId: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => unshareStaff(tx, actor, branchId, userId)))
}

/** Opens the branch and mails every login that has not been used yet. Passwords come back only for mails that failed. */
export async function activateBranchAction(branchId: string): Promise<ActionResult<Mailed[]>> {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => ({ ...(await activateBranch(tx, actor, branchId)), names: await roleNames(tx) })))
  if (!res.ok) return res
  revalidatePath('/', 'layout')
  return { ok: true, data: await mailLogins(actor.orgId, res.data!.branch, res.data!.logins, res.data!.names, await appOrigin(actor.orgId)) }
}

export async function resendLoginAction(userId: string): Promise<ActionResult<Mailed[]>> {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => ({ ...(await resendLogin(tx, actor, userId)), names: await roleNames(tx) })))
  if (!res.ok) return res
  return { ok: true, data: await mailLogins(actor.orgId, res.data!.branch, res.data!.logins, res.data!.names, await appOrigin(actor.orgId)) }
}

export async function createEnquiryAction(input: CreateEnquiryInput) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() =>
    withTenant(actor, async (tx) => {
      const r = await createEnquiry(tx, actor, input)
      return { enquiryNo: r.enquiry.enquiryNo, existingPerson: r.personWasExisting }
    }),
  )
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function logCallAction(input: LogCallInput) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => (await logCall(tx, actor, input)).call.id))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function updateLeadAction(input: UpdateLeadInput) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => updateLead(tx, actor, input)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function followUpCallAction(input: FollowUpCallInput) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => followUpCall(tx, actor, input)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function callFollowUpsAction(callId: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, async (tx) => (await callFollowUps(tx, actor, callId)).map((f) => ({ ...f, calledAt: f.calledAt.toISOString() }))))
}

export async function followUpLeadAction(input: FollowUpLeadInput) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => followUpLead(tx, actor, input)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function visitSummaryAction(from?: string, to?: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => visitSummary(tx, actor, { from, to })))
}

export async function enquiryTimelineAction(enquiryId: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, async (tx) => (await enquiryTimeline(tx, actor, enquiryId)).map((ev) => ({ ...ev, at: ev.at.toISOString() }))))
}

export async function leadRecordAction(kind: 'call' | 'enquiry', id: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => leadRecord(tx, actor, kind === 'call' ? 'call' : 'enquiry', id)))
}

export async function deleteLeadAction(enquiryId: string) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => deleteLead(tx, actor, enquiryId)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function deleteCallAction(callId: string) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => deleteCall(tx, actor, callId)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function updateCallAction(input: UpdateCallInput) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => updateCall(tx, actor, input)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function transitionEnquiryAction(input: TransitionInput) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => (await transitionEnquiry(tx, actor, input)).status))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function createRegistrationAction(input: CreateRegistrationInput) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => (await createRegistration(tx, actor, input)).regNo))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

/** Registers a student and returns the new registration's id too (the page then saves the photo against it). */
export async function registerStudentAction(input: CreateRegistrationInput) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => { const r = await createRegistration(tx, actor, input); return { id: r.id, regNo: r.regNo } }))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

/** Everything known about an enquiry, to show and to fill the registration form with. */
export async function enquiryForRegistrationAction(enquiryId: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => enquiryForRegistration(tx, actor, enquiryId)))
}

/** Students a new registration can start from (random calls, leads, visited enquiries), for the search on the registration page. */
export async function findRegistrationSourcesAction(q: string, filter: SourceFilter) {
  const { actor } = await getActor()
  const r = await run(() => withTenant(actor, (tx) => searchRegistrationSources(tx, actor, q, filter)))
  return r.ok ? r.data ?? [] : []
}

export async function callForRegistrationAction(callId: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => callForRegistration(tx, actor, callId)))
}

/** Older registrations (any status) an upgrade can continue from. */
export async function findRegistrationsToUpgradeAction(q: string) {
  const { actor } = await getActor()
  const r = await run(() => withTenant(actor, (tx) => searchRegistrationsToUpgrade(tx, actor, q)))
  return r.ok ? r.data ?? [] : []
}

export async function registrationForUpgradeAction(registrationId: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => registrationForUpgrade(tx, actor, registrationId)))
}

/** Message templates (head office: the default for all; a branch manager: their branch's own). */
export async function saveTemplateAction(input: { key: string; subject: string; body: string }) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => saveMessageTemplate(tx, actor, input as Parameters<typeof saveMessageTemplate>[2])))
  if (res.ok) revalidatePath('/message-templates')
  return res
}
export async function resetTemplateAction(key: string) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => resetMessageTemplate(tx, actor, key)))
  if (res.ok) revalidatePath('/message-templates')
  return res
}
export async function saveAnnouncementTemplateAction(input: { id?: string | null; title: string; body: string }) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => saveAnnouncementTemplate(tx, actor, input)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function deleteAnnouncementTemplateAction(id: string) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => deleteAnnouncementTemplate(tx, actor, id)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

/** The same person in other branches (mobile, e-mail, date of birth), while a call / lead / admission is typed in. */
export async function branchMatchesAction(q: MatchQuery) {
  const { actor } = await getActor()
  return run(() => branchMatches(actor, q))
}
/** "Use these details": one match in full (re-checked against what was typed; logged). */
export async function branchMatchDetailsAction(q: MatchQuery, personId: string) {
  const { actor } = await getActor()
  return run(() => branchMatchDetails(actor, q, personId))
}
/** The branch a student leaves asks to move them; the other branch accepts or turns it down. */
export async function requestTransferAction(input: { registrationId: string; toBranchId: string; reason: string }) {
  const { actor } = await getActor()
  const res = await run(async () => { await assertTransferBranch(actor.orgId, input.toBranchId); return withTenant(actor, async (tx) => (await requestTransfer(tx, actor, input)).id) })
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
/** Before accepting: is the student already on a record in this branch (same mobile), and is it really them? */
export async function transferPersonCheckAction(transferId: string) {
  const { actor } = await getActor()
  return run(() => transferPersonCheck(actor, transferId))
}
export async function acceptTransferAction(transferId: string, note: string | null, samePerson = false) {
  const { actor } = await getActor()
  const res = await run(() => acceptTransfer(actor, transferId, note, { samePerson }))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function rejectTransferAction(transferId: string, note: string) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => rejectTransfer(tx, actor, transferId, note)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function cancelTransferAction(transferId: string) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => cancelTransfer(tx, actor, transferId)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

/** Shared students: the home branch asks another branch to take its student for some classes; the host accepts into a batch. */
export async function askShareAction(input: ShareAsk) {
  const { actor } = await getActor()
  const res = await run(async () => { await assertTransferBranch(actor.orgId, input.toBranchId); return withTenant(actor, async (tx) => (await askShare(tx, actor, input)).id) })
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function acceptShareAction(shareId: string, batchId: string, note: string | null) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => acceptShare(tx, actor, shareId, batchId, note)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function declineShareAction(shareId: string, reason: string) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => declineShare(tx, actor, shareId, reason)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function endShareAction(shareId: string, reason: string) {
  const { actor } = await getActor()
  const res = await run(() => endShare(actor, shareId, reason))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

/** After a step that may finish a course (a class's topics, a certificate, a letter): completes the registrations whose
 * list is now done. On the server's own connection (a trainer may be from another branch); best effort. */
async function completeCoursesOf(actor: Actor, find: SQL) {
  try {
    await withOrgSystem(actor.orgId, async (tx) => completeIfDone(tx, actor, (await tx.execute<{ id: string | null }>(find)).rows.map((r) => r.id)))
  } catch (e) { log.warn('course.complete_failed', { error: e instanceof Error ? e.message : String(e) }) }
}
export async function completionStatusAction(registrationId: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => completionStatus(tx, actor, registrationId)))
}
/** A manager marks a course completed by hand. */
export async function markCompletedAction(input: { registrationId: string; note: string }) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => markCompleted(tx, actor, input)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function transitionRegistrationAction(input: RegTransitionInput) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => (await transitionRegistration(tx, actor, input)).status))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

/** Everything about one registration, for the details view. */
export async function registrationDetailsAction(registrationId: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => registrationDetails(tx, actor, registrationId)))
}

/** Back-dating: corrects a registration's dates. */
export async function updateRegistrationDatesAction(input: RegDatesInput) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => updateRegistrationDates(tx, actor, input)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

/** Admissions asks accounts to change a student's total fees. */
export async function requestFeeChangeAction(input: FeeChangeInput) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => (await requestFeeChange(tx, actor, input)).id))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

/** Accounts changes a student's total fees directly. */
export async function changeTotalFeeAction(input: FeeChangeInput) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => changeTotalFee(tx, actor, input)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function decideFeeChangeAction(input: { requestId: string; approve: boolean; note?: string | null }) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => decideFeeChange(tx, actor, input)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function setFeePlanAction(input: { registrationId: string; plan: FeePlanInput }) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => (await setFeePlan(tx, actor, input)).length))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

/** Accounts raises a remark on a student's fees (or one receipt) for admissions to fix. */
export async function raiseFeeRemarkAction(input: FeeRemarkInput) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => (await raiseFeeRemark(tx, actor, input)).id))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function fixFeeRemarkAction(input: { remarkId: string; note: string }) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => fixFeeRemark(tx, actor, input)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function feeScheduleAction(registrationId: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => feeSchedule(tx, actor, registrationId)))
}

export async function recordPaymentAction(input: RecordPaymentInput) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => {
    const r = await recordPayment(tx, actor, input)
    return { receiptNo: r.receipt.receiptNo, balanceAfter: r.balanceAfter }
  }))
  if (!res.ok) return res
  revalidatePath('/', 'layout')
  // the first (token) fee gives the student a portal login, e-mailed to them
  return { ...res, data: { ...res.data!, login: await loginAfterFirstPayment(actor, input.registrationId) } }
}

/** Branch manager / head office: reverses a wrong payment or records a refund (the receipt stays, marked cancelled). */
export async function reversePaymentAction(input: ReversalInput) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => reversePayment(tx, actor, input)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function applyDiscountAction(input: DiscountInput) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => (await applyDiscount(tx, actor, input)).balance))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

// ---- Academics & certificates ---------------------------------------------
import { cancelTrainerRequest, decideTrainerRequest, otherBranchTrainers, requestTrainer } from '@/modules/academics/trainer-requests'
import { addAssessment, addBatchMember, approveCapstone, batchRoster, projectInput, submitMyProject, type ProjectInput, createBatch, createSession, markAttendance, removeBatchMember, setBatchTrainer, studentAttendance, type CreateBatchInput } from '@/modules/academics/service'
import { approveCertificate, certificateWording, clearCertificateFees, rejectCertificate, requestCertificate, revokeCertificate, type CertWordingInput } from '@/modules/certificates/service'
import { addLeadCategory, createCourse, decideCourse, updateLeadCategory, type CreateCourseInput, updateCourseSkills } from '@/modules/catalog/service'

export async function createCourseAction(input: CreateCourseInput) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => { const c = await createCourse(tx, actor, input); return { id: c.id, pending: c.pending } }))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

/** Head office: approve a course a branch added, or turn it down with a reason. */
export async function decideCourseAction(id: string, approve: boolean, reason?: string) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => decideCourse(tx, actor, id, approve, reason)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function createBatchAction(input: CreateBatchInput) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => (await createBatch(tx, actor, input)).id))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function addBatchMemberAction(batchId: string, registrationId: string) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => addBatchMember(tx, actor, batchId, registrationId)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function setBatchTrainerAction(batchId: string, trainerId: string | null) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => setBatchTrainer(tx, actor, batchId, trainerId)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function removeBatchMemberAction(batchId: string, registrationId: string) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => removeBatchMember(tx, actor, batchId, registrationId)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function loadRosterAction(batchId: string, date: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => batchRoster(tx, actor, batchId, date)))
}

export async function saveAttendanceAction(batchId: string, date: string, marks: { registrationId: string; present: boolean }[]) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  return run(() =>
    withTenant(actor, async (tx) => {
      const s = await createSession(tx, actor, { batchId, sessionDate: date })
      await markAttendance(tx, actor, s.id, marks)
      return batchRoster(tx, actor, batchId, date)
    }),
  )
}

/** The trainer records a project the student handed in without naming it in the portal. */
export async function addCapstoneAction(registrationId: string, project: ProjectInput) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  return run(() => withTenant(actor, async (tx) => (await addAssessment(tx, actor, { registrationId, kind: 'capstone', ...projectInput.parse(project) })).id))
}

/** Approves the project with its title and tools as the trainer checked (and perhaps corrected) them. */
export async function approveCapstoneAction(assessmentId: string, checked?: ProjectInput) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => { await approveCapstone(tx, actor, assessmentId, checked) }))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function requestCertificateAction(registrationId: string, wording?: CertWordingInput) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => (await requestCertificate(tx, actor, registrationId, wording)).eligibility.reasons))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
/** What a certificate would print (course name, tools / modules), to start the request form from. */
export async function certificateWordingAction(registrationId: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => certificateWording(tx, z.string().uuid().parse(registrationId))))
}

export async function approveCertificateAction(requestId: string) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => (await approveCertificate(tx, actor, requestId)).certNo))
  if (res.ok) {
    await completeCoursesOf(actor, sql`select registration_id as id from certificate_requests where id = ${requestId}::uuid`)
    revalidatePath('/', 'layout')
    // the student is told by e-mail, after the response (best effort: the portal shows it anyway)
    const origin = await appOrigin(actor.orgId)
    after(async () => {
      try {
        const m = await certificateIssuedMail(actor.orgId, requestId, origin)
        const mail = m ? await providerFor(actor.orgId, 'email', m.branchId) : null
        if (m && mail) { const r = await mail.send({ channel: 'email', to: m.to, template: 'certificate_issued', subject: m.subject, body: m.body }); if (!r.ok) log.warn('certificate.mail_failed', { requestId, error: r.error }) }
      } catch (e) { log.warn('certificate.mail_failed', { requestId, error: e instanceof Error ? e.message : String(e) }) }
      await withOrgSystem(actor.orgId, (tx) => announceCertificate(tx, requestId, origin)).catch((e) => log.warn('certificate.whatsapp_failed', { requestId, error: String(e) }))
    })
  }
  return res
}

export async function clearCertificateFeesAction(requestId: string) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => clearCertificateFees(tx, actor, requestId)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function rejectCertificateAction(requestId: string, reason: string) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => rejectCertificate(tx, actor, requestId, reason)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function revokeCertificateAction(certificateId: string, reason: string) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => { await revokeCertificate(tx, actor, certificateId, reason) }))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

// ---- Calls, staff, settings ------------------------------------------------
import { promoteCall } from '@/modules/enquiries/service'
import { loginAfterFirstPayment } from '@/modules/users/student-login'
import { createStudentLogin, createUser, resetUserPassword, setUserActive, setUserRoles, type CreateUserInput } from '@/modules/users/service'
import { deleteRole, saveRole, type SaveRoleInput } from '@/modules/roles/service'
import { changeOwnPassword, checkOwnPasswordChange } from '@/modules/auth/account'
import { listLogs } from '@/modules/audit/service'
import { cookieOptions, SESSION_COOKIE, signSession } from '@/lib/auth/session'
import { httpsRequest } from '@/lib/auth/https-request'
import { updateRule } from '@/modules/settings/service'

export async function promoteCallAction(callId: string, departmentId: string | null, classModeId: string | null) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => (await promoteCall(tx, actor, callId, { departmentId, classModeId })).enquiryNo))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export type NewMember = { email: string; status: 'emailed' | 'pending_activation' | 'show'; tempPassword?: string; error?: string }

/**
 * Adds a team member (several roles allowed). In a branch still being set up nothing is sent yet: the login goes out
 * when the branch is activated. In an active branch (or head office) the login is e-mailed now; the one-time password
 * is shown on screen only if that mail cannot be sent.
 */
export async function createUserAction(input: CreateUserInput): Promise<ActionResult<NewMember>> {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => {
    const r = await createUser(tx, actor, input)
    const [b] = r.user.branchId ? await tx.select().from(branches).where(eq(branches.id, r.user.branchId)) : [null]
    return { r, b, names: await roleNames(tx), roles: r.roles }
  }))
  if (!res.ok) return res
  revalidatePath('/', 'layout')
  const { r, b, names, roles } = res.data!
  if (b && b.status !== 'active') return { ok: true, data: { email: r.user.email, status: 'pending_activation' } }
  const [m] = await mailLogins(actor.orgId, b, [{ userId: r.user.id, name: r.user.name, email: r.user.email, password: r.tempPassword, roles }], names, await appOrigin(actor.orgId))
  return { ok: true, data: m.emailed ? { email: m.email, status: 'emailed' } : { email: m.email, status: 'show', tempPassword: r.tempPassword, error: m.error } }
}

export async function setUserActiveAction(userId: string, active: boolean) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => { await setUserActive(tx, actor, userId, active) }))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function addLeadCategoryAction(name: string) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => addLeadCategory(tx, actor, name)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function updateLeadCategoryAction(input: { id: string; name?: string; isActive?: boolean }) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => updateLeadCategory(tx, actor, input)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function updateRuleAction(key: string, value: number) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => updateRule(tx, actor, key, value)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function loadReceiptsAction(registrationId: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, async (tx) => (await listReceipts(tx, actor, registrationId)).map((r) => ({ ...r, paidAt: r.paidAt.toISOString() }))))
}

export async function addGradeAction(registrationId: string, kind: 'assignment' | 'test', title: string, score: number, maxScore: number) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  return run(() => withTenant(actor, async (tx) => (await addAssessment(tx, actor, { registrationId, kind, title, score, maxScore })).id))
}

/** A student's portal login, e-mailed to them (like staff logins). The password comes back only if the mail fails. */
export async function createStudentLoginAction(registrationId: string, email: string | null): Promise<ActionResult<{ email: string; emailed: boolean; tempPassword?: string; error?: string }>> {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => {
    const r = await createStudentLogin(tx, actor, { registrationId, email })
    const [b] = r.user.branchId ? await tx.select().from(branches).where(eq(branches.id, r.user.branchId)) : [null]
    return { r, b, names: await roleNames(tx) }
  }))
  if (!res.ok) return res
  revalidatePath('/', 'layout')
  const { r, b, names } = res.data!
  const [m] = await mailLogins(actor.orgId, b, [{ userId: r.user.id, name: r.user.name, email: r.user.email, password: r.tempPassword, roles: ['student'] }], names, await appOrigin(actor.orgId))
  return { ok: true, data: m.emailed ? { email: m.email, emailed: true } : { email: m.email, emailed: false, tempPassword: r.tempPassword, error: m.error } }
}

export async function resetUserPasswordAction(userId: string) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  return run(() => withTenant(actor, async (tx) => resetUserPassword(tx, actor, userId)))
}

/**
 * Step 1 of a staff member changing their own password: the current password and the new one are checked, then a
 * 6-digit code is mailed to them. The password only changes in changePasswordAction, with that code.
 */
export async function startPasswordChangeAction(current: string, next: string): Promise<ActionResult<{ email: string }>> {
  const { session } = await getActor()
  const chk = await checkOwnPasswordChange(session.org, session.userId, current, next)
  if (!chk.ok) return chk
  if (!(await underLimit(`pwcode:send:${session.userId}`, 5, 15 * 60))) return { ok: false, error: 'Too many codes requested. Try again in 15 minutes.' }
  const code = newCode()
  if (!(await sendCode(session.org, { id: session.userId, email: chk.email, name: chk.name }, code, 'password'))) return { ok: false, error: 'We could not e-mail the code, so the password was not changed. Ask your administrator to check the mail settings.' }
  const jar = await cookies()
  jar.set(TWO_FACTOR_COOKIE, await signChallenge({ userId: session.userId, email: chk.email, purpose: 'password', code }), { ...twoFactorCookieOptions, secure: await httpsRequest() })
  return { ok: true, data: { email: maskEmail(chk.email) } }
}

/**
 * Own password change. Also the ONLY action a user with a forced change may perform. Re-issues the session so they stay signed in.
 * Staff must give the code mailed by startPasswordChangeAction. Not asked from a first sign-in with a temporary password
 * (that password just arrived by e-mail) or from students (their sign-in is not always a real mailbox).
 */
export async function changePasswordAction(current: string, next: string, code?: string): Promise<ActionResult> {
  const { session, mustChange } = await getActor({ allowMustChange: true })
  const ip = clientIpFrom(await headers()) ?? undefined
  const needsCode = !mustChange && session.role !== 'student'
  if (needsCode) {
    const c = await readChallenge((await cookies()).get(TWO_FACTOR_COOKIE)?.value, 'password')
    if (!c || c.userId !== session.userId) return { ok: false, error: 'This code has expired. Send a new one.' }
    if (!(await underLimit(`pwcode:try:${session.userId}`, 6, CODE_MINUTES * 60))) return { ok: false, error: 'Too many wrong codes. Try again in 10 minutes.' }
    if (!codeMatches(c, code ?? '')) return { ok: false, error: 'That code is not correct' }
    await clearLimit(`pwcode:try:${session.userId}`)
  }
  const r = await changeOwnPassword(session.org, session.userId, current, next, ip)
  if (!r.ok) return r
  // Every older session of this user is now void; this browser gets a fresh one for the new password version.
  const { iat: _iat, exp: _exp, ...rest } = session as typeof session & { iat?: number; exp?: number }
  const jar = await cookies()
  jar.set(SESSION_COOKIE, await signSession({ ...rest, pwv: r.pwv }), { ...cookieOptions, secure: await httpsRequest() })
  if (needsCode) jar.delete(TWO_FACTOR_COOKIE)
  revalidatePath('/', 'layout')
  return { ok: true }
}

// ---- My account: own profile and two-step sign-in ---------------------------------------------
import { loadProfile, setTwoFactor, updateOwnProfile } from '@/modules/auth/account'
import { CODE_MINUTES, codeMatches, maskEmail, newCode, readChallenge, sendCode, signChallenge, TWO_FACTOR_COOKIE, twoFactorCookieOptions } from '@/modules/auth/two-factor'
import { clearLimit, underLimit } from '@/lib/redis'

const ownIp = async () => clientIpFrom(await headers()) ?? undefined

export async function updateProfileAction(input: { name: string; phone: string }): Promise<ActionResult> {
  const { session } = await getActor()
  const r = await updateOwnProfile(session.org, session.userId, input, await ownIp())
  if (!r.ok) return r
  // The name shown around the panel comes from the session, so this browser gets one with the new name.
  const { iat: _iat, exp: _exp, ...rest } = session as typeof session & { iat?: number; exp?: number }
  const jar = await cookies()
  jar.set(SESSION_COOKIE, await signSession({ ...rest, name: r.name }), { ...cookieOptions, secure: await httpsRequest() })
  revalidatePath('/', 'layout')
  return { ok: true }
}

/** Step 1 of turning two-step sign-in on: mail a code to the person's own address, to prove the mailbox works. */
export async function startTwoFactorAction(): Promise<ActionResult> {
  const { session } = await getActor()
  const p = await loadProfile(session.org, session.userId)
  if (!p) return { ok: false, error: 'Account not available' }
  if (!(await underLimit(`2fa:send:${session.userId}`, 5, 15 * 60))) return { ok: false, error: 'Too many codes requested. Try again in 15 minutes.' }
  const code = newCode()
  if (!(await sendCode(session.org, { id: session.userId, email: p.email, name: p.name }, code, 'enable'))) return { ok: false, error: 'We could not e-mail the code, so two-step sign-in was not turned on. Ask your administrator to check the mail settings.' }
  const jar = await cookies()
  jar.set(TWO_FACTOR_COOKIE, await signChallenge({ userId: session.userId, email: p.email, purpose: 'enable', code }), { ...twoFactorCookieOptions, secure: await httpsRequest() })
  return { ok: true }
}

/** Step 2: the code from the e-mail switches it on. */
export async function confirmTwoFactorAction(code: string): Promise<ActionResult> {
  const { session } = await getActor()
  const jar = await cookies()
  const c = await readChallenge(jar.get(TWO_FACTOR_COOKIE)?.value, 'enable')
  if (!c || c.userId !== session.userId) return { ok: false, error: 'This code has expired. Send a new one.' }
  if (!(await underLimit(`2fa:try:${session.userId}`, 6, CODE_MINUTES * 60))) return { ok: false, error: 'Too many wrong codes. Try again in 10 minutes.' }
  if (!codeMatches(c, code)) return { ok: false, error: 'That code is not correct' }
  await clearLimit(`2fa:try:${session.userId}`)
  const r = await setTwoFactor(session.org, session.userId, true, { ip: await ownIp() })
  if (!r.ok) return r
  jar.delete(TWO_FACTOR_COOKIE)
  revalidatePath('/account')
  return { ok: true }
}

export async function disableTwoFactorAction(password: string): Promise<ActionResult> {
  const { session } = await getActor()
  if (!(await underLimit(`2fa:off:${session.userId}`, 8, 15 * 60))) return { ok: false, error: 'Too many attempts. Try again in 15 minutes.' }
  const r = await setTwoFactor(session.org, session.userId, false, { password, ip: await ownIp() })
  if (!r.ok) return r
  await clearLimit(`2fa:off:${session.userId}`)
  revalidatePath('/account')
  return { ok: true }
}

// ---- Top bar: search everything, and the bell --------------------------------------------------
import { can } from '@/lib/auth/permissions'
import { myAlerts, type Alert } from '@/modules/home/service'

export type SearchHit = { kind: 'Random call' | 'Lead' | 'Visited enquiry' | 'Registration'; title: string; sub: string; href: string }

/** People and records matching a name, phone or number, a few from each screen the person may open. Each opens its list, already searched. */
export async function globalSearchAction(text: string): Promise<SearchHit[]> {
  const q = text.trim().slice(0, 60)
  if (q.length < 2) return []
  const { actor } = await getActor()
  const to = (path: string, term: string) => `${path}?q=${encodeURIComponent(term)}`
  const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ')
  const r = await run(() => withTenant(actor, async (tx) => {
    const hits: SearchHit[] = []
    if (can(actor, 'read', 'call')) {
      for (const c of await listCallsPage(tx, actor, { q, limit: 4 }).then((x) => x.rows)) hits.push({ kind: 'Random call', title: c.name ?? 'Unknown caller', sub: join(c.phone, c.course ?? c.department, c.status), href: to('/calls', c.phone ?? c.name ?? q) })
    }
    if (can(actor, 'read', 'enquiry')) {
      for (const e of (await listEnquiries(tx, actor, { q, visited: false, limit: 4 })).rows) hits.push({ kind: 'Lead', title: e.name, sub: join(e.enquiryNo, e.phone, e.course ?? e.department), href: to('/leads', e.enquiryNo) })
      for (const e of (await listEnquiries(tx, actor, { q, visited: true, limit: 4 })).rows) hits.push({ kind: 'Visited enquiry', title: e.name, sub: join(e.enquiryNo, e.phone, e.course ?? e.department), href: to('/enquiries', e.enquiryNo) })
    }
    if (can(actor, 'read', 'registration')) {
      for (const g of (await listRegistrations(tx, actor, { q, limit: 4 })).rows) hits.push({ kind: 'Registration', title: g.name, sub: join(g.regNo, g.phone, g.course ?? g.department), href: to('/registrations', g.regNo) })
    }
    return hits
  }))
  return r.ok ? r.data ?? [] : []
}

/** What is waiting for the signed-in person right now (the bell). */
export async function myAlertsAction(): Promise<Alert[]> {
  const { actor } = await getActor()
  const r = await run(() => withTenant(actor, (tx) => myAlerts(tx, actor)))
  return r.ok ? r.data ?? [] : []
}

// ---- Server-side search & paging for the list screens (25 per page) --------------------------
import { certificatePage } from '@/modules/certificates/service'
import { listFeesPage } from '@/modules/fees/service'
import { listCallsPage, listEnquiries, searchConvertibleEnquiries } from '@/modules/enquiries/service'
import { listRegistrations, searchActiveRegistrations } from '@/modules/registrations/service'
import type { ListQuery } from '@/lib/list-query'

const PAGE = 25

// Each list action takes the screen's ListQuery (search, filters, date range, sort); the services whitelist every part of it.

/** scope: 'visited' = the Enquiries screen, 'leads' = the Leads screen (not visited yet), 'all' = Enquiry update. */
async function enquiryPage(scope: 'visited' | 'leads' | 'all', query: ListQuery, page: number) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, async (tx) => {
    const r = await listEnquiries(tx, actor, { query, visited: scope === 'all' ? undefined : scope === 'visited', limit: PAGE, offset: page * PAGE })
    return { total: r.total, rows: r.rows.map((x) => ({ ...x, createdAt: x.createdAt.toISOString(), nextFollowUp: x.nextFollowUp ?? null, callAt: x.callAt?.toISOString() ?? null })) }
  }))
}
export const queryLeadsAction = async (query: ListQuery, page: number) => enquiryPage('leads', query, page)
export const queryAllEnquiriesAction = async (query: ListQuery, page: number) => enquiryPage('all', query, page)

export async function queryEnquiriesAction(query: ListQuery, page: number) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, async (tx) => {
    const r = await listEnquiries(tx, actor, { query, visited: true, limit: PAGE, offset: page * PAGE })
    return { total: r.total, rows: r.rows.map((x) => ({ ...x, createdAt: x.createdAt.toISOString(), nextFollowUp: x.nextFollowUp ?? null, callAt: x.callAt?.toISOString() ?? null })) }
  }))
}

export async function queryRegistrationsAction(query: ListQuery, page: number) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, async (tx) => {
    const r = await listRegistrations(tx, actor, { query, limit: PAGE, offset: page * PAGE })
    return { total: r.total, rows: r.rows.map((x) => ({ ...x, enrollmentDate: String(x.enrollmentDate) })) }
  }))
}

export async function queryFeesAction(query: ListQuery, page: number) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => listFeesPage(tx, actor, { query, limit: PAGE, offset: page * PAGE })))
}

export async function queryStudentsAction(query: ListQuery, page: number) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => certificatePage(tx, actor, { query, limit: PAGE, offset: page * PAGE })))
}

export async function restoreDeletedAction(kind: 'call' | 'lead', id: string) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => restoreDeleted(tx, actor, kind === 'call' ? 'call' : 'lead', id)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function queryLogsAction(query: ListQuery, page: number) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => listLogs(tx, actor, { query, limit: PAGE, offset: page * PAGE })))
}

export async function queryCallsAction(query: ListQuery, page: number) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, async (tx) => {
    const r = await listCallsPage(tx, actor, { query, limit: PAGE, offset: page * PAGE })
    return { total: r.total, rows: r.rows.map((x) => ({ ...x, calledAt: x.calledAt.toISOString(), followUpDate: x.followUpDate ?? null })) }
  }))
}

export async function findEnquiriesToRegisterAction(q: string) {
  const { actor } = await getActor()
  const r = await run(() => withTenant(actor, (tx) => searchConvertibleEnquiries(tx, actor, q)))
  return r.ok ? r.data ?? [] : []
}

export async function findStudentsAction(q: string) {
  const { actor } = await getActor()
  const r = await run(() => withTenant(actor, (tx) => searchActiveRegistrations(tx, actor, q)))
  return r.ok ? r.data ?? [] : []
}

// ---- Registration documents (upload goes through POST /api/documents) ------------------------
import { deleteDocument, listDocuments } from '@/modules/documents/service'

export async function listDocumentsAction(registrationId: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => listDocuments(tx, actor, registrationId)))
}

export async function deleteDocumentAction(id: string) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => deleteDocument(tx, actor, id)))
}

// ---- Roles & permissions ---------------------------------------------------------------------
export async function setUserRolesAction(userId: string, roles: string[]) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => setUserRoles(tx, actor, userId, roles)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function saveRoleAction(input: SaveRoleInput) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => saveRole(tx, actor, input)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function deleteRoleAction(key: string) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => deleteRole(tx, actor, key)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

// ---- Lead distribution & "My leads" ------------------------------------------------------------
import { distributeLeads, leadPool, personLeads, poolList, type DistributeInput, type PoolInput } from '@/modules/leads/service'

export async function poolListAction(input: PoolInput) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => poolList(tx, actor, input)))
}

export async function personLeadsAction(userId: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => personLeads(tx, actor, userId)))
}

export async function leadPoolAction(input: PoolInput) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => leadPool(tx, actor, input)))
}

export async function distributeLeadsAction(input: DistributeInput) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => distributeLeads(tx, actor, input)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

export async function queryMyLeadsAction(query: ListQuery, page: number) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, async (tx) => {
    const r = await listEnquiries(tx, actor, { query, mine: true, limit: PAGE, offset: page * PAGE })
    return { total: r.total, rows: r.rows.map((x) => ({ ...x, createdAt: x.createdAt.toISOString(), nextFollowUp: x.nextFollowUp ?? null, callAt: x.callAt?.toISOString() ?? null })) }
  }))
}

/** Student portal: names their capstone project (title and tools) for the trainer to check. */
export async function submitMyProjectAction(registrationId: string, project: ProjectInput) {
  const { actor } = await getActor()
  const res = await run(async () => { await withTenant(actor, (tx) => submitMyProject(tx, actor, registrationId, project)) })
  if (res.ok) revalidatePath('/')
  return res
}

/** Student portal: the student adds their own Aadhaar number. */
export async function setMyAadhaarAction(aadhaar: string) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => setMyAadhaar(tx, actor, aadhaar)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

// ---- Website leads (forms from the institute websites) ----
export async function listWebLeadsAction(opts: { site?: string; state?: string; q?: string; offset?: number }) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => listWebLeads(tx, actor, { ...opts, limit: 50 })))
}

export async function editWebLeadAction(input: { id: string; name: string; phone?: string | null; email?: string | null; course?: string | null; location?: string | null; message?: string | null }) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => editWebLead(tx, actor, input)))
  if (res.ok) revalidatePath('/web-leads')
  return res
}

export async function deleteWebLeadAction(id: string) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => deleteWebLeadSoft(tx, actor, id)))
  if (res.ok) revalidatePath('/web-leads')
  return res
}

export async function assignWebLeadAction(id: string, branchId: string) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => assignWebLead(tx, actor, { id, branchId })))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

// ---- Internship letters (Documents)
export async function createInternshipAction(input: InternInput) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => (await createInternship(tx, actor, input)).refNo))
  if (res.ok) revalidatePath('/internships')
  return res
}
export async function updateInternshipAction(id: string, input: InternInput) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => updateInternship(tx, actor, id, input)))
  if (res.ok) revalidatePath('/internships')
  return res
}
export async function issueOfferAction(id: string) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => issueOffer(tx, actor, id)))
  if (res.ok) { await completeCoursesOf(actor, sql`select registration_id as id from internships where id = ${id}::uuid`); revalidatePath('/', 'layout') }
  return res
}
export async function requestCompletionAction(id: string, work: { domain?: string | null; skills?: string | null; project?: string | null }) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => requestCompletion(tx, actor, id, work)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function issueCompletionAction(id: string) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => issueCompletion(tx, actor, id)))
  if (res.ok) { await completeCoursesOf(actor, sql`select registration_id as id from internships where id = ${id}::uuid`); revalidatePath('/', 'layout') }
  return res
}
export async function cancelInternshipAction(id: string, reason: string) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => cancelInternship(tx, actor, id, reason)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function saveLetterTemplateAction(kind: string, id: string | null, body: string, name?: string, companyId?: string | null) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => saveTemplate(tx, actor, kind, id, body, name, companyId)))
  if (res.ok) revalidatePath('/letter-templates')
  return res
}
export async function resetLetterTemplateAction(kind: string, companyId?: string | null) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => resetTemplate(tx, actor, kind, companyId)))
  if (res.ok) revalidatePath('/letter-templates')
  return res
}
/** A letter company (Letter Templates → Companies): add (id null) or change its name, legal name, contact and on / off. */
export async function saveLetterCompanyAction(id: string | null, input: CompanyInput) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => saveCompany(tx, actor, id, input)))
  if (res.ok) { revalidatePath('/letter-templates'); revalidatePath('/internships') }
  return res
}

// ---- Course categories and certificate signatures
export async function createCategoryAction(input: CategoryInput) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => createCategory(tx, actor, input)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function updateCategoryAction(id: string, input: CategoryInput & { isActive?: boolean }) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => updateCategory(tx, actor, id, input)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function decideCategoryAction(id: string, approve: boolean, reason?: string) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => decideCategory(tx, actor, id, approve, reason)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function setSignatureChoiceAction(choice: string) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => setSignatureChoice(tx, actor, choice)))
  if (res.ok) revalidatePath('/settings')
  return res
}
export async function createLetterTemplateAction(kind: string, name: string, companyId?: string | null) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => createTemplate(tx, actor, kind, name, companyId)))
  if (res.ok) revalidatePath('/letter-templates')
  return res
}
export async function deleteLetterTemplateAction(id: string) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => deleteTemplate(tx, actor, id)))
  if (res.ok) revalidatePath('/letter-templates')
  return res
}
export async function setRegistrationLettersAction(registrationId: string, v: { offer: boolean; completion: boolean; offerTemplateId: string | null; completionTemplateId: string | null; companyId?: string | null }) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => setRegistrationLetters(tx, actor, registrationId, v)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function registrationLettersAction(registrationId: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, async (tx) => ({ letters: await registrationLetters(tx, registrationId), templates: await listTemplates(tx), options: await registrationOptions(tx, registrationId) })))
}
/** Edit registration: project certificate, mode of classes and internship letters, saved together. */
export async function saveRegistrationEditAction(registrationId: string, v: { projectCertificate: boolean; classModeId: string | null; offer: boolean; completion: boolean; offerTemplateId: string | null; completionTemplateId: string | null; companyId?: string | null }) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => {
    await updateRegistrationOptions(tx, actor, registrationId, { projectCertificate: v.projectCertificate, classModeId: v.classModeId })
    await setRegistrationLetters(tx, actor, registrationId, { offer: v.offer, completion: v.completion, offerTemplateId: v.offerTemplateId, completionTemplateId: v.completionTemplateId, companyId: v.companyId })
  }))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function updateCourseSkillsAction(id: string, skills: string) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => updateCourseSkills(tx, actor, id, skills)))
  if (res.ok) revalidatePath('/courses')
  return res
}

/** One student's attendance calendar for a month (YYYY-MM), as marked by their trainers. */
export async function studentHelpAction(registrationId: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => studentHelp(tx, actor, registrationId)))
}

export async function studentAttendanceAction(registrationId: string, month: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => studentAttendance(tx, actor, registrationId, month)))
}

// ---- a trainer of another branch for a batch: the academic manager asks, the trainer accepts or declines
export async function otherBranchTrainersAction() {
  const { actor } = await getActor()
  return run(() => otherBranchTrainers(actor))
}
export async function requestTrainerAction(batchId: string, trainerId: string, note: string | null) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => requestTrainer(tx, actor, { batchId, trainerId, note })))
  if (res.ok) revalidatePath('/students')
  return res
}
export async function cancelTrainerRequestAction(id: string) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => cancelTrainerRequest(tx, actor, id)))
  if (res.ok) revalidatePath('/students')
  return res
}
export async function decideTrainerRequestAction(id: string, accept: boolean, note: string | null) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => decideTrainerRequest(actor, id, accept, note))
  if (res.ok) revalidatePath('/students')
  return res
}

// ---- Settings (head office): e-mail, WhatsApp, SMS, reminders, scheduled jobs, webhooks and API keys
async function headOffice() {
  const { actor } = await getActor()
  if (actor.role !== 'super_admin') throw new Error('Only head office can change these settings')
  return actor
}
const settingsSaved = () => { dropConfigCache(); revalidatePath('/settings') }
async function auditSettings(actor: Actor, key: string) {
  await withOrgSystem(actor.orgId, (tx) => audit(tx, actor, { action: 'update', entity: 'settings', entityId: key }))
}

const optEmail = (msg: string) => z.union([z.literal(''), z.string().trim().email(msg)])
const emailSettings = z.object({
  enabled: z.boolean(), host: z.string().trim().min(3, 'Enter the mail server, e.g. smtp.gmail.com').max(200), port: z.number().int().min(1).max(65535),
  security: z.enum(['ssl', 'starttls', 'none']), user: z.string().trim().min(3, 'Enter the login (usually the e-mail address)').max(200),
  fromName: z.string().trim().max(80), fromAddress: optEmail('The sender address is not an e-mail'), replyTo: optEmail('Reply-to is not an e-mail'), alertEmail: optEmail('The alert address is not an e-mail'),
})
export async function saveEmailSettingsAction(config: z.input<typeof emailSettings>, password: string | null) {
  return run(async () => { const a = await headOffice(); await saveConfig(a.orgId, 'email', emailSettings.parse(config), { password: password ?? '' }, a.userId); await auditSettings(a, 'email'); settingsSaved() })
}
export async function testEmailAction(to: string) {
  return run(async () => {
    const a = await headOffice()
    const addr = z.string().trim().email('Enter the e-mail to send the test to').parse(to)
    const p = await providerFor(a.orgId, 'email')
    if (!p) throw new Error('E-mail is not set up or is switched off: save the settings first')
    const { name } = await orgBrand(a.orgId)
    const r = await p.send({ channel: 'email', to: addr, template: 'settings_test', body: `This is a test from the ${name} panel. E-mail is working.`, html: `<p>This is a test from the <b>${escapeHtml(name)}</b> panel.</p><p>E-mail is working.</p>` })
    if (!r.ok) throw new Error(r.error)
    return `Sent through ${p.name}`
  })
}

// A branch's own mail server (Settings → Branch e-mail): its branch manager, or head office working in that branch
async function branchEmailOwner() {
  const { actor } = await getActor()
  if (!canManageBranchEmail(actor)) throw new Error('Only the branch manager can set up the branch e-mail')
  return actor as Actor & { branchId: string }
}
export async function saveBranchEmailAction(config: z.input<typeof emailSettings>, password: string | null) {
  return run(async () => {
    const a = await branchEmailOwner()
    const c = emailSettings.parse({ ...config, alertEmail: '' })
    // a branch's mail server: a public one, on a mail port, with the password always sent encrypted
    if (![25, 465, 587, 2525].includes(c.port)) throw new Error('Use a mail port: 465 (SSL) or 587 (STARTTLS)')
    if (c.security === 'none') throw new Error('Choose SSL or STARTTLS: the mailbox password must not be sent unencrypted')
    await assertPublicHost(c.host)
    await saveBranchEmail(a.orgId, a.branchId, c, password, a.userId)
    await auditSettings(a, `email@${a.branchId}`)
    settingsSaved()
    revalidatePath('/', 'layout')
  })
}
export async function testBranchEmailAction(to: string) {
  return run(async () => {
    const a = await branchEmailOwner()
    const addr = z.string().trim().email('Enter the e-mail to send the test to').parse(to)
    const p = await providerFor(a.orgId, 'email', a.branchId)
    if (p?.name !== 'branch-smtp') throw new Error('The branch e-mail is not set up or is switched off: save the settings first')
    const { name } = await orgBrand(a.orgId)
    const r = await p.send({ channel: 'email', to: addr, template: 'settings_test', body: `This is a test from the ${name} panel. Your branch e-mail is working.`, html: `<p>This is a test from the <b>${escapeHtml(name)}</b> panel.</p><p>Your branch e-mail is working.</p>` })
    if (!r.ok) throw new Error(r.error)
    return 'Sent from the branch mailbox'
  })
}

// the country drop-down's dialling code (lib/countries.ts); "+91" or nothing also mean 91
const countryCode = z.string().nullish().transform((v) => (v ?? '').replace(/\D/g, '') || '91').refine(isDialCode, 'Pick the country of the mobile numbers')
const waSettings = z.object({
  enabled: z.boolean(), provider: z.enum(['aisensy', 'meta']), countryCode,
  campaigns: z.partialRecord(z.enum(WA_KEYS as [WaMessageKey, ...WaMessageKey[]]), z.string().trim().max(120)).default({}),
  off: z.array(z.enum(WA_EVENT_KEYS as [WaEventKey, ...WaEventKey[]])).max(20).default([]),
  on: z.array(z.enum(WA_EVENT_KEYS as [WaEventKey, ...WaEventKey[]])).max(20).default([]),
  phoneNumberId: z.string().trim().max(40).regex(/^\d*$/, 'The phone number ID is digits only'), businessAccountId: z.string().trim().max(40),
  apiVersion: z.string().trim().regex(/^v\d+\.\d+$/, 'The API version looks like v20.0'), reminderTemplate: z.string().trim().max(120),
  language: z.string().trim().min(2).max(10),
})
/**
 * Empty secrets keep the ones saved before. Switching WhatsApp on also adds it to the fee reminders' channels (once, on
 * that switch: unticking it later in Settings → Reminders stays unticked). Returns whether that happened.
 */
export async function saveWhatsappSettingsAction(config: z.input<typeof waSettings>, secrets: { token?: string | null; apiKey?: string | null }) {
  return run(async () => {
    const a = await headOffice()
    const v = waSettings.parse(config)
    const wasOn = (await getConfig(a.orgId, 'whatsapp')).config.enabled
    await saveConfig(a.orgId, 'whatsapp', v, { token: secrets.token ?? '', apiKey: secrets.apiKey ?? '' }, a.userId)
    await auditSettings(a, 'whatsapp')
    let reminders = false
    if (v.enabled && !wasOn) {
      const rem = (await getConfig(a.orgId, 'reminders')).config
      if (!rem.channels.includes('whatsapp')) {
        await saveConfig(a.orgId, 'reminders', { ...rem, channels: [...rem.channels, 'whatsapp'] }, {}, a.userId)
        await auditSettings(a, 'reminders')
        reminders = true
      }
    }
    settingsSaved()
    return reminders
  })
}
const smsSettings = z.object({ enabled: z.boolean(), provider: z.literal('msg91'), templateId: z.string().trim().max(80), senderId: z.string().trim().max(12), countryCode })
export async function saveSmsSettingsAction(config: z.input<typeof smsSettings>, authKey: string | null) {
  return run(async () => { const a = await headOffice(); await saveConfig(a.orgId, 'sms', smsSettings.parse(config), { authKey: authKey ?? '' }, a.userId); await auditSettings(a, 'sms'); settingsSaved() })
}
// ---- Online fee payments (modules/fees/online.ts): the institute's own Razorpay account, and the student's Pay online
const paymentsSettings = z.object({ enabled: z.boolean(), provider: z.literal('razorpay'), keyId: z.string().trim().max(60).refine((v) => !v || /^rzp_(live|test)_\w+$/.test(v), 'The Key ID starts with rzp_live_ or rzp_test_') })
export async function savePaymentsSettingsAction(config: z.input<typeof paymentsSettings>, keySecret: string | null, webhookSecret: string | null) {
  return run(async () => {
    const a = await headOffice()
    const c = paymentsSettings.parse(config)
    await saveConfig(a.orgId, 'payments', c, { keySecret: keySecret ?? '', webhookSecret: webhookSecret ?? '' }, a.userId)
    await auditSettings(a, 'payments'); settingsSaved()
  })
}
/** The student's Pay online: the address of the payment page to open (their own registration only). */
export async function startFeePaymentAction(registrationId: string) {
  return run(async () => {
    const { actor } = await getActor()
    const id = z.string().uuid().parse(registrationId)
    return startFeePayment(actor, id, await appOrigin(actor.orgId))
  })
}
// ---- Expenses (modules/expenses/service.ts)
export async function addExpenseAction(input: ExpenseInput) {
  return run(async () => { const { actor } = await getActor(); await withTenant(actor, (tx) => addExpense(tx, actor, input)); revalidatePath('/expenses') })
}
export async function deleteExpenseAction(id: string) {
  return run(async () => { const { actor } = await getActor(); await withTenant(actor, (tx) => deleteExpense(tx, actor, id)); revalidatePath('/expenses') })
}

// ---- Report-card grades (lib/grades.ts)
const gradesSettings = z.object({
  bands: z.array(z.object({ min: z.number().int().min(0).max(100), grade: z.string().trim().min(1).max(4), label: z.string().trim().max(40) })).min(1).max(12),
  passPct: z.number().int().min(0).max(100),
})
export async function saveGradesAction(config: z.input<typeof gradesSettings>) {
  return run(async () => {
    const a = await headOffice()
    const v = gradesSettings.parse(config)
    const why = gradesProblem(v)
    if (why) throw new Error(why)
    await saveConfig(a.orgId, 'grades', { ...v, bands: [...v.bands].sort((x, y) => y.min - x.min) }, {}, a.userId)
    await auditSettings(a, 'grades'); settingsSaved()
  })
}

// ---- The design course certificates are drawn with (modules/certificates/course-design.ts)
export async function saveCourseDesignAction(designId: string | null) {
  return run(async () => {
    const a = await headOffice()
    const id = designId === null ? null : z.string().uuid().parse(designId)
    if (id) {
      const [d] = await withOrgSystem(a.orgId, async (tx) => (await tx.execute(sql`select 1 from certificate_designs where id = ${id} and is_active`)).rows)
      if (!d) throw new Error('That design is not there any more')
    }
    await saveConfig(a.orgId, 'course_certificate', { designId: id }, {}, a.userId)
    await auditSettings(a, 'course_certificate'); settingsSaved()
  })
}

// ---- Feature packs on / off (lib/panel/features.ts)
export async function saveFeaturesAction(off: string[]) {
  return run(async () => {
    const a = await headOffice()
    const known = new Set(FEATURES.map((f) => f.key as string))
    await saveConfig(a.orgId, 'features', { off: [...new Set(z.array(z.string()).max(30).parse(off))].filter((k) => known.has(k)) }, {}, a.userId)
    await auditSettings(a, 'features'); settingsSaved()
  })
}

// ---- The public admission form (modules/web-leads/apply.ts)
const admissionFormSettings = z.object({
  enabled: z.boolean(),
  heading: z.string().trim().max(80),
  intro: z.string().trim().max(600),
  thanks: z.string().trim().max(300),
  askEmail: z.boolean(), askLocation: z.boolean(), askMessage: z.boolean(),
})
export async function saveAdmissionFormAction(config: z.input<typeof admissionFormSettings>) {
  return run(async () => {
    const a = await headOffice()
    const v = admissionFormSettings.parse(config)
    await saveConfig(a.orgId, 'admission_form', { ...v, heading: v.heading || 'Apply for admission', thanks: v.thanks || 'Thank you! Our team will call you shortly.' }, {}, a.userId)
    await auditSettings(a, 'admission_form'); settingsSaved()
  })
}

// ---- Parents' links (modules/portal/parent.ts): made by the office, opened by the parent with no account
export async function createParentLinkAction(registrationId: string) {
  return run(async () => {
    const { actor } = await getActor()
    const id = z.string().uuid().parse(registrationId)
    const made = await withTenant(actor, (tx) => createParentLink(tx, actor, id))
    return { url: `${await appOrigin(actor.orgId)}/p/${made.token}`, guardianPhone: made.guardianPhone, name: made.name }
  })
}
export async function revokeParentLinkAction(registrationId: string) {
  return run(async () => { const { actor } = await getActor(); await withTenant(actor, (tx) => revokeParentLink(tx, actor, z.string().uuid().parse(registrationId))) })
}
export async function parentLinkStateAction(registrationId: string) {
  return run(async () => { const { actor } = await getActor(); return withTenant(actor, (tx) => parentLinkState(tx, z.string().uuid().parse(registrationId))) })
}
/** A parent's Pay online, from their link: the link is the permission (the institute is the one of this address). */
export async function payAsParentAction(token: string) {
  return run(async () => {
    const org = await requireRequestOrg()
    const v = await parentView(org.id, String(token))
    if (!v) throw new Error('This link no longer works: ask the office for a new one')
    return openFeePayment(org.id, v.registrationId, v.createdBy, await appOrigin(org.id), 'parent')
  })
}
export async function testMessageAction(channel: 'whatsapp' | 'sms', to: string) {
  return run(async () => {
    const a = await headOffice()
    const phone = z.string().trim().regex(/^\+?[\d\s-]{10,16}$/, 'Enter a mobile number').parse(to)
    const p = await providerFor(a.orgId, channel)
    if (!p) throw new Error(`${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} is not set up or is switched off: save the settings first`)
    const { name } = await orgBrand(a.orgId)
    const r = await p.send({ channel, to: phone, template: 'settings_test', body: channel === 'whatsapp' ? `This is a test message from the ${name} panel: WhatsApp is working.` : `Test from ${name} panel` })
    if (!r.ok) throw new Error(r.error)
    return `Sent through ${p.name}`
  })
}

const reminderDays = z.array(z.number().int().min(1).max(120)).max(10)
const remindersSettings = z.object({
  channels: z.array(z.enum(['sms', 'whatsapp', 'email'])), daysBefore: reminderDays, onDueDay: z.boolean(), overdueDays: reminderDays,
  texts: z.object({ soon: z.string().trim().min(10).max(600), today: z.string().trim().min(10).max(600), overdue: z.string().trim().min(10).max(600) }),
})
export async function saveRemindersAction(config: z.input<typeof remindersSettings>) {
  return run(async () => {
    const a = await headOffice()
    const v = remindersSettings.parse(config)
    const uniq = (xs: number[]) => [...new Set(xs)].sort((x, y) => x - y)
    await saveConfig(a.orgId, 'reminders', { ...v, daysBefore: uniq(v.daysBefore), overdueDays: uniq(v.overdueDays) }, {}, a.userId)
    await auditSettings(a, 'reminders'); settingsSaved()
  })
}
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:00')
const jobsSettings = z.object({ scheduler: z.enum(['panel', 'external']), reminders: z.object({ enabled: z.boolean(), time: hhmm }), reconcile: z.object({ enabled: z.boolean(), time: hhmm }), purge: z.object({ enabled: z.boolean(), time: hhmm }), escalations: z.object({ enabled: z.boolean(), time: hhmm }).default({ enabled: true, time: '10:00' }) })
export async function saveJobsAction(config: z.input<typeof jobsSettings>) {
  return run(async () => { const a = await headOffice(); await saveConfig(a.orgId, 'jobs', jobsSettings.parse(config), {}, a.userId); await auditSettings(a, 'jobs'); settingsSaved() })
}
export async function runJobNowAction(job: 'reminders' | 'reconcile' | 'purge' | 'escalations') {
  return run(async () => {
    const a = await headOffice()
    const r = await runNamedJob(a.orgId, z.enum(['reminders', 'reconcile', 'purge', 'escalations']).parse(job))
    revalidatePath('/settings')
    if (r.error) throw new Error(r.error)
    return r.summary
  })
}

export async function createWebhookAction(v: { name: string; url: string; events: string[] }) {
  return run(async () => { const a = await headOffice(); const r = await withTenant(a, (tx) => createWebhook(tx, a.userId, v)); revalidatePath('/settings'); return r })
}
export async function updateWebhookAction(id: string, v: { name: string; url: string; events: string[]; isActive: boolean }) {
  return run(async () => { const a = await headOffice(); await withTenant(a, (tx) => updateWebhook(tx, id, v)); revalidatePath('/settings') })
}
export async function deleteWebhookAction(id: string) {
  return run(async () => { const a = await headOffice(); await withTenant(a, (tx) => deleteWebhook(tx, id)); revalidatePath('/settings') })
}
export async function testWebhookAction(id: string) {
  return run(async () => { const a = await headOffice(); const r = await withTenant(a, (tx) => testWebhook(tx, id)); revalidatePath('/settings'); return r })
}
export async function webhookSecretAction(id: string) {
  return run(async () => { const a = await headOffice(); return withTenant(a, (tx) => webhookSecret(tx, id)) })
}
/** Plan & billing: what a plan would cost now (credit, coupon, GST). Head office only. */
export async function billingQuoteAction(v: z.input<typeof checkoutInput>) {
  return run(async () => {
    const a = await headOffice()
    return quoteFor(a, v)
  })
}
/** Starts paying: the provider's page to send head office to. */
export async function billingCheckoutAction(v: z.input<typeof checkoutInput>) {
  return run(async () => { const a = await headOffice(); return (await startCheckout(a, v, `${await appOrigin(a.orgId)}/billing/return`)).url })
}
/** Stops (or resumes) renewing at the end of the paid period. */
export async function billingCancelAction(cancel: boolean) {
  return run(async () => { const a = await headOffice(); await setCancelAtPeriodEnd(a, cancel); revalidatePath('/settings') })
}
/** Set Up (modules/onboarding): head office only (each service checks it too). */
export async function setupStepAction(step: StepKey | 'dismiss', how: 'done' | 'skip' | 'undo') {
  return run(async () => { const a = await headOffice(); await withTenant(a, (tx) => markStep(tx, a, step, how)); revalidatePath('/', 'layout') })
}
export async function setupBrandingAction(v: z.input<typeof brandingInput>) {
  return run(async () => { const a = await headOffice(); await withTenant(a, (tx) => saveBranding(tx, a, v)); revalidatePath('/', 'layout') })
}
export async function setupCatalogueAction(key: string) {
  return run(async () => { const a = await headOffice(); const r = await withTenant(a, (tx) => applyCatalogue(tx, a, key)); revalidatePath('/', 'layout'); return r })
}
export async function setupFeesAction(v: z.input<typeof feesInput>) {
  return run(async () => { const a = await headOffice(); await withTenant(a, (tx) => saveFees(tx, a, v)); revalidatePath('/', 'layout') })
}
/** Head office ends the platform support session open in the institute (the banner's "End now"). */
export async function endSupportSessionAction(sessionId: string) {
  return run(async () => { const { actor } = await getActor(); await withTenant(actor, (tx) => endSupportByOrg(tx, actor, z.string().uuid().parse(sessionId))); revalidatePath('/', 'layout') })
}
/** The org's number formats (Settings → Numbering). Head office only. */
export async function saveNumberingAction(formats: Record<string, string | null>) {
  return run(async () => { const a = await headOffice(); await withTenant(a, (tx) => setNumbering(tx, a, formats)); revalidatePath('/settings') })
}
/** The org's website-lead secret, for its websites' servers (head office only; each look is in the audit log). */
export async function webLeadsSecretAction() {
  return run(async () => {
    const a = await headOffice()
    const secret = webLeadsSecretFor(a.orgId)
    if (!secret) throw new Error('Website forms are not switched on for this server yet (WEBLEADS_SECRET)')
    await withTenant(a, (tx) => audit(tx, a, { action: 'reveal_secret', entity: 'settings', entityId: 'web-leads' }))
    return secret
  })
}
export async function webhookDeliveriesAction(id: string) {
  return run(async () => { const a = await headOffice(); return withTenant(a, (tx) => listDeliveries(tx, id)) })
}
export async function createApiKeyAction(v: { name: string; scopes: string[]; branchId: string | null; expiresInDays: number }) {
  return run(async () => { const a = await headOffice(); const key = await withTenant(a, (tx) => createApiKey(tx, a.userId, v)); revalidatePath('/settings'); return key })
}
export async function revokeApiKeyAction(id: string) {
  return run(async () => { const a = await headOffice(); await withTenant(a, (tx) => revokeApiKey(tx, id)); revalidatePath('/settings') })
}

// ---- Sign-in security (head office): the sign-in log, running locks, blocked and trusted IPs
export async function loginLogAction(q: LoginLogQuery) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => listLoginLog(tx, actor, q)))
}
export async function setIpRuleAction(ip: string, kind: 'block' | 'allow', reason: string | null) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => setIpRule(tx, actor, { ip, kind, reason })))
  if (res.ok) { revalidatePath('/login-logs'); after(() => fillIpGeo(res.data)) }
  return res
}
export async function removeIpRuleAction(ip: string) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => removeIpRule(tx, actor, ip)))
  if (res.ok) revalidatePath('/login-logs')
  return res
}
export async function clearLockAction(key: string) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => clearLock(tx, actor, key)))
  if (res.ok) revalidatePath('/login-logs')
  return res
}

// ---- Recycle Bin: deleting keeps things 30 days (Administration → Recycle Bin), then the daily purge removes them
export async function deleteRegistrationAction(id: string) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => deleteRegistration(tx, actor, id)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function deleteCourseAction(id: string) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => deleteCourse(tx, actor, id)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function deleteBatchAction(id: string) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => deleteBatch(tx, actor, id)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function deleteUserAction(id: string) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => deleteUser(tx, actor, id)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function restoreItemAction(kind: RecycleKind, id: string) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => restoreItem(tx, actor, kind, id)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function purgeItemAction(kind: RecycleKind, id: string) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => purgeItem(actor, kind, id))
  if (res.ok) revalidatePath('/recycle-bin')
  return res
}

// ---- Student help desk (tickets) and announcements (modules/support/service.ts)
export async function raiseTicketAction(input: RaiseTicketInput) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => raiseTicket(tx, actor, input)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function ticketMessagesAction(ticketId: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => ticketMessages(tx, actor, ticketId)))
}
/** A reply in a ticket. When the branch answers, the student is also told by e-mail (best effort). */
export async function replyTicketAction(ticketId: string, body: string) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => replyTicket(tx, actor, ticketId, body)))
  if (!res.ok) return res
  revalidatePath('/', 'layout')
  const r = res.data!
  if (r.staff) {
    try {
      const { p, t, branch } = await withOrgSystem(actor.orgId, async (tx) => ({
        p: (await tx.execute<{ email: string | null; first_name: string }>(sql`select email, first_name from persons where id = ${r.personId}`)).rows[0],
        t: await resolveTemplate(tx, 'ticket_reply_email', r.branchId),
        branch: (await tx.execute<{ name: string }>(sql`select name from branches where id = ${r.branchId}`)).rows[0]?.name ?? (await orgBrand(actor.orgId)).name,
      }))
      const mail = p?.email ? await providerFor(actor.orgId, 'email', r.branchId) : null
      const vars = { first_name: p?.first_name, ticket_no: r.ticketNo, reply: body.trim(), branch }
      if (mail && p.email) await mail.send({ channel: 'email', to: p.email, template: 'ticket_reply', subject: fillTemplate(t.subject, vars), body: fillTemplate(t.body, vars) })
    } catch (e) { log.warn('ticket.reply_mail_failed', { error: e instanceof Error ? e.message : String(e) }) }
  }
  // an internal ticket answered: its raiser hears too
  if (r.requesterId) await mailStaff(actor.orgId, r.requesterId, r.branchId, `${(await orgBrand(actor.orgId)).name} — reply to your ticket ${r.ticketNo}`, `Your ticket ${r.ticketNo} has a reply:\n\n${body.trim()}\n\nOpen it in the panel: My Tickets.`)
  return { ok: true as const }
}
/** A short e-mail to a staff member (best effort: the panel shows everything anyway). */
async function mailStaff(orgId: string, userId: string, branchId: string | null, subject: string, text: string) {
  try {
    const [u] = (await withOrgSystem(orgId, (tx) => tx.execute<{ email: string; name: string }>(sql`select email, name from users where id = ${userId} and is_active`))).rows
    const mail = u?.email ? await providerFor(orgId, 'email', branchId) : null
    if (mail) await mail.send({ channel: 'email', to: u.email, template: 'ticket_staff', subject, body: plainText(`Dear ${u.name},\n\n${text}\n\n- ${(await orgBrand(orgId)).name}`) })
  } catch (e) { log.warn('ticket.staff_mail_failed', { error: e instanceof Error ? e.message : String(e) }) }
}
/** Staff raise an internal ticket (to their branch manager, or to head office). */
export async function raiseInternalTicketAction(input: InternalTicketInput) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => raiseInternalTicket(tx, actor, input)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function ticketAssigneesAction(ticketId: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => ticketAssignees(tx, actor, ticketId)))
}
export async function assignTicketAction(ticketId: string, userId: string | null) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => assignTicket(tx, actor, ticketId, userId)))
  if (res.ok) {
    revalidatePath('/', 'layout')
    if (res.data!.assignee && res.data!.assignee !== actor.userId) await mailStaff(actor.orgId, res.data!.assignee, actor.branchId, `${(await orgBrand(actor.orgId)).name} — ticket ${res.data!.ticketNo} is yours`, `Ticket ${res.data!.ticketNo} has been given to you. Open it in the panel: My Tickets.`)
  }
  return res
}
export async function setTicketPriorityAction(ticketId: string, priority: string) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => setTicketPriority(tx, actor, ticketId, priority)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function escalateTicketAction(ticketId: string, note: string) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => escalateTicket(tx, actor, ticketId, note)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function rateTicketAction(ticketId: string, rating: number, note: string | null) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => rateTicket(tx, actor, ticketId, rating, note)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function closeTicketAction(ticketId: string) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => closeTicket(tx, actor, ticketId)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function postAnnouncementAction(input: AnnouncementInput) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => postAnnouncement(tx, actor, input)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function pinAnnouncementAction(id: string, pinned: boolean) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => setAnnouncementPinned(tx, actor, id, pinned)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function removeAnnouncementAction(id: string) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => removeAnnouncement(tx, actor, id)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

// ---- Teaching: syllabus, the day's class, tests, notes, calendar, help from trainers (modules/teaching/service.ts)
export async function syllabusAction(courseId: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => courseSyllabus(tx, courseId, actor)))
}
/** Head office approves a syllabus change (it goes live for every branch) or turns it down; its author may withdraw it. */
export async function decideSyllabusChangeAction(changeId: string, approve: boolean, note: string | null) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => decideSyllabusChange(tx, actor, changeId, approve, note)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function saveSyllabusAction(courseId: string, topics: TopicInput[]) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => saveSyllabus(tx, actor, courseId, topics)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function removeSyllabusFileAction(courseId: string) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => setSyllabusFile(tx, actor, courseId, null)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function batchTeachingAction(batchId: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => batchTeaching(tx, actor, batchId)))
}
/** The day's class in one go: the topics taught (ticked off the syllabus) and who was present. */
export async function saveClassAction(batchId: string, date: string, marks: { registrationId: string; present: boolean }[], topicIds: string[], extra: string | null) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, async (tx) => {
    const sessionId = await setDayTopics(tx, actor, batchId, date, topicIds, extra)
    if (marks.length) await markAttendance(tx, actor, sessionId, marks)
    return batchRoster(tx, actor, batchId, date)
  }))
  if (res.ok && topicIds.length) await completeCoursesOf(actor, sql`select registration_id as id from batch_members where batch_id = ${batchId}::uuid`)
  return res
}
export async function setTopicCoveredAction(batchId: string, topicId: string, coveredOn: string | null) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => setTopicCovered(tx, actor, batchId, topicId, coveredOn)))
  if (res.ok && coveredOn) await completeCoursesOf(actor, sql`select registration_id as id from batch_members where batch_id = ${batchId}::uuid`)
  return res
}
export async function createTestAction(batchId: string, input: TestInput) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => createTest(tx, actor, batchId, input)))
}
export async function saveTestMarksAction(testId: string, rows: { registrationId: string; score: number | null }[]) {
  const gate = await branchEmailGate(); if (gate) return gate
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => saveTestMarks(tx, actor, testId, rows)))
}
export async function deleteTestAction(testId: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => deleteTest(tx, actor, testId)))
}
export async function listNotesAction(batchId: string | null) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => listNotes(tx, actor, batchId)))
}
export async function deleteNoteAction(id: string) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => deleteNote(tx, actor, id)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function teachingCalendarAction(month: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => teachingCalendar(tx, actor, month)))
}
export async function askHelpAction(input: HelpInput) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => askForHelp(tx, actor, input)))
  if (res.ok) { revalidatePath('/', 'layout'); await mailHelp(actor.orgId, res.data!.id, 'new') }
  return res
}
/** Tells trainers about a help request by e-mail, after the response (best effort: the panel shows it anyway). */
async function mailHelp(orgId: string, requestId: string, event: 'new' | 'chosen') {
  const origin = await appOrigin(orgId)
  after(async () => {
    try {
      const mails = await helpMails(orgId, requestId, event, origin)
      const mail = mails.length ? await providerFor(orgId, 'email', mails[0].branchId) : null
      if (!mail) return
      for (const m of mails) {
        const r = await mail.send({ channel: 'email', to: m.to, template: 'help_request', subject: m.subject, body: m.body })
        if (!r.ok) log.warn('help.mail_failed', { requestId, error: r.error })
      }
    } catch (e) { log.warn('help.mail_failed', { requestId, error: e instanceof Error ? e.message : String(e) }) }
  })
}
export async function offerHelpAction(requestId: string, message: string | null) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => offerHelp(tx, actor, requestId, message)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function withdrawOfferAction(requestId: string) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => withdrawOffer(tx, actor, requestId)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}
export async function chooseHelperAction(requestId: string, trainerId: string) {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => chooseHelper(tx, actor, requestId, trainerId)))
  if (res.ok) { revalidatePath('/', 'layout'); await mailHelp(actor.orgId, requestId, 'chosen') }
  return res
}
export async function closeHelpAction(requestId: string, outcome: 'done' | 'cancelled') {
  const { actor } = await getActor()
  const res = await run(() => withTenant(actor, (tx) => closeHelp(tx, actor, requestId, outcome)))
  if (res.ok) revalidatePath('/', 'layout')
  return res
}

// ---- Bulk WhatsApp (modules/notifications/broadcasts.ts) ----------------------------------------------------------
/** Settings → WhatsApp campaigns: adds (id null) or changes a campaign. Head office only. */
export async function saveWaCampaignAction(id: string | null, input: CampaignInput) {
  const res = await run(async () => { const a = await headOffice(); return withTenant(a, async (tx) => (await saveCampaign(tx, a, id, input)).id) })
  if (res.ok) { revalidatePath('/settings'); revalidatePath('/whatsapp') }
  return res
}
/** Sends one campaign to one number with sample details (and the typed values given), to check it in AiSensy. */
export async function testWaCampaignAction(id: string, to: string, texts: string[]) {
  return run(async () => {
    const { actor } = await getActor()
    if (!can(actor, 'create', 'broadcast')) throw new Error('Forbidden: create broadcast')
    const phone = z.string().trim().regex(/^\+?[\d\s-]{10,16}$/, 'Enter a mobile number').parse(to)
    const c = (await withTenant(actor, (tx) => listCampaigns(tx))).find((x) => x.id === id)
    if (!c) throw new Error('That campaign no longer exists')
    const p = await providerFor(actor.orgId, 'whatsapp')
    if (!p) throw new Error('WhatsApp is not set up or is switched off: Settings → WhatsApp & SMS')
    const sample = { person_id: '', branch_id: '', registration_id: null, phone, first_name: WA_FIELDS.first_name.sample, last_name: 'Gill', branch: WA_FIELDS.branch.sample, course: WA_FIELDS.course.sample, reg_no: WA_FIELDS.reg_no.sample, balance: 1200000 }
    const params = paramsFor(c, sample, c.params.filter((x) => x.field === 'text').map((x, i) => texts[i]?.trim() || x.label || 'test'), (await orgBrand(actor.orgId)).name)
    const r = await p.send({ channel: 'whatsapp', to: phone, template: 'broadcast', body: '', name: 'Aman Gill', params, campaign: c.campaign, media: c.mediaUrl ? { url: c.mediaUrl, filename: c.mediaName || 'file' } : null })
    if (!r.ok) throw new Error(r.error)
    return `Sent through ${p.name}`
  })
}
export async function previewBroadcastAction(campaignId: string, audience: AudienceInput, texts: string[]) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => previewBroadcast(tx, actor, campaignId, audience, texts)))
}
export async function sendBroadcastAction(campaignId: string, audience: AudienceInput, texts: string[]) {
  const { actor } = await getActor()
  const res = await run(async () => {
    if (!(await providerFor(actor.orgId, 'whatsapp'))) throw new Error('WhatsApp is not switched on yet (Settings → WhatsApp & SMS): nothing was sent')
    return withTenant(actor, (tx) => sendBroadcast(tx, actor, campaignId, audience, texts))
  })
  if (res.ok) revalidatePath('/whatsapp')
  return res
}
export async function broadcastFailuresAction(id: string) {
  const { actor } = await getActor()
  return run(() => withTenant(actor, (tx) => broadcastFailures(tx, actor, id)))
}
