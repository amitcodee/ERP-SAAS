import { z } from 'zod'
import { isValidPhone } from '../people/phone'

const uuid = z.string().uuid()
const optUuid = z.string().uuid().optional().nullable()
const optText = z.string().trim().max(500).optional().nullable()
const paise = z.number().int().nonnegative().optional().nullable()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const occupationInput = z.object({
  typeId: uuid,
  schoolOrCollege: optText,
  qualification: optText,
  semester: optText,
  jobRole: optText,
  company: optText,
  skills: optText,
  country: optText,
})

export const personInput = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: optText,
  phone: z.string().refine(isValidPhone, 'Enter a 10-digit phone number'),
  altPhone: optText,
  email: z.string().email().optional().nullable(),
})

/** Lead details: interested or not (with a percentage when yes), the call, the location, the branch they want. */
export const leadInput = z.object({
  interested: z.boolean().optional().nullable(), // null = not asked yet
  interestPct: z.number().int().min(0).max(100).optional().nullable(),
  visited: z.boolean().default(false), // came to the branch
  callDone: z.boolean().default(false),
  callAt: z.string().datetime({ offset: true }).optional().nullable(), // date + time of the call; defaults to now when the call is done
  callRemark: optText,
  location: z.string().trim().max(200).optional().nullable(),
  interestedBranchId: optUuid,
  categoryId: optUuid, // lead category
}).refine((l) => l.interested !== true || l.interestPct != null, 'Enter how interested the lead is (percentage)')
export type LeadInput = z.input<typeof leadInput>

/** The basics of a lead, edited after it was added (a website form brings only a name, a phone and maybe a course). */
export const leadBasicsInput = z.object({
  person: personInput.omit({ email: true }),
  sourceId: optUuid,
  departmentId: optUuid,
  courseId: optUuid,
  classModeId: optUuid,
  courseFee: paise,
  proposedFee: paise,
})

export const updateLeadInput = z.object({ enquiryId: uuid, lead: leadInput, basics: leadBasicsInput.optional() })
export type UpdateLeadInput = z.input<typeof updateLeadInput>

export const createEnquiryInput = z.object({
  person: personInput,
  lead: leadInput.optional(),
  occupation: occupationInput.optional(),
  sourceId: optUuid,
  departmentId: optUuid,
  courseId: optUuid,
  classModeId: optUuid,
  courseFee: paise, // the course's actual (full) fee
  proposedFee: paise, // the discounted / proposed fee
  actualFee: paise,
  demoBy: optUuid,
  assignedTo: optUuid,
  expectedJoinDate: isoDate.optional().nullable(),
  followUpDate: isoDate.optional().nullable(),
  remarks: optText,
})
export type CreateEnquiryInput = z.infer<typeof createEnquiryInput>

export const transitionInput = z.object({
  enquiryId: uuid,
  to: z.enum(['contacted', 'follow_up', 'demo', 'joined', 'not_joined', 'dead']),
  followUpDate: isoDate.optional().nullable(),
  notJoinedReasonId: optUuid,
  note: optText,
})
export type TransitionInput = z.infer<typeof transitionInput>

/** Lead details of a random call. */
const callLead = {
  callRemark: optText, // what the caller said
  interested: z.boolean().optional().nullable(),
  interestPct: z.number().int().min(0).max(100).optional().nullable(),
  expectedVisitDate: isoDate.optional().nullable(), // status "Will visit"
  deadReason: optText, // status "Dead lead"
  categoryId: optUuid, // lead category
}

/** One follow-up call on a random call. */
export const followUpCallInput = z.object({
  callId: uuid,
  calledAt: z.string().datetime({ offset: true }).optional().nullable(), // defaults to now
  status: z.string().trim().min(1, 'Choose the status after this call').max(100),
  remarks: optText, // your own remark
  nextFollowUp: isoDate.optional().nullable(),
  ...callLead,
})
export type FollowUpCallInput = z.infer<typeof followUpCallInput>

export const logCallInput = z.object({
  person: personInput,
  ...callLead,
  qualification: optText,
  collegeName: optText,
  departmentId: optUuid,
  courseId: optUuid,
  proposedFee: paise,
  status: optText,
  remarks: optText,
  followUpDate: isoDate.optional().nullable(),
})
export type LogCallInput = z.infer<typeof logCallInput>

/** Editing a logged call: what was discussed, not who called (the caller is a person record). */
export const updateCallInput = z.object({
  id: z.string().uuid(),
  ...callLead,
  departmentId: optUuid,
  courseId: optUuid,
  proposedFee: paise,
  status: optText,
  remarks: optText,
  followUpDate: isoDate.optional().nullable(),
})
export type UpdateCallInput = z.infer<typeof updateCallInput>

/** One follow-up call on a lead (an enquiry that has not visited yet). */
export const followUpLeadInput = z.object({
  enquiryId: uuid,
  calledAt: z.string().datetime({ offset: true }).optional().nullable(), // defaults to now
  nextFollowUp: isoDate,
  interested: z.boolean().optional().nullable(),
  interestPct: z.number().int().min(0).max(100).optional().nullable(),
  callRemark: optText, // what the person said
  categoryId: optUuid, // left out = keep the lead's category
}).refine((l) => l.interested !== true || l.interestPct != null, 'Enter how interested the lead is (percentage)')
export type FollowUpLeadInput = z.infer<typeof followUpLeadInput>
