import { z } from 'zod'
import { occupationInput, personInput } from '../enquiries/validators'
import { cleanAadhaar, isValidAadhaar } from '../people/aadhaar'
import { feePlanInput } from '../fees/service'

const optUuid = z.string().uuid().optional().nullable()
const optText = z.string().trim().max(500).optional().nullable()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const profileInput = z.object({
  fatherName: optText,
  motherName: optText,
  gender: z.enum(['male', 'female', 'other']).optional().nullable(),
  dob: isoDate.optional().nullable(),
  altPhone: optText,
  guardianPhone: optText,
  email: z.string().email().optional().nullable(),
  address: optText,
  aadhaarNo: z.string().refine(isValidAadhaar, 'Enter a valid 12-digit Aadhaar number').transform(cleanAadhaar).optional().nullable(),
})

export const customCourseInput = z.object({
  title: z.string().trim().min(2, 'Enter the name of the customized course').max(120),
  durationWeeks: z.number().int().positive().max(520).optional().nullable(),
  feeMode: z.enum(['modules', 'total']),
  modules: z.array(z.object({ name: z.string().trim().min(1, 'Every module needs a name').max(120), fee: z.number().int().nonnegative().optional().nullable() })).min(1, 'Add at least one module').max(40),
})

export const createRegistrationInput = z
  .object({
    enquiryId: optUuid,
    person: personInput.optional(), // required only when there is no enquiry (walk-in registration)
    profile: profileInput.optional(),
    occupation: occupationInput.optional(),
    departmentId: optUuid,
    courseId: optUuid,
    customCourse: customCourseInput.optional().nullable(), // instead of courseId
    classModeId: optUuid,
    enrollmentDate: isoDate,
    joiningDate: isoDate.optional().nullable(),
    classMinutesPerDay: z.number().int().min(15).max(720).optional().nullable(),
    classDaysPerWeek: z.number().int().min(1).max(7).optional().nullable(),
    classStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().nullable(),
    courseHours: z.number().int().positive().max(20000).optional().nullable(),
    expectedEndDate: isoDate.optional().nullable(),
    totalFee: z.number().int().positive('Total fee is required').optional().nullable(),
    // The total in its parts (paise). Given together; they must add up to totalFee.
    listFee: z.number().int().positive().optional().nullable(), // the fee before the offer (with GST); never below totalFee
    courseFee: z.number().int().positive().optional().nullable(),
    gstAmount: z.number().int().nonnegative().optional().nullable(),
    feePlan: feePlanInput.optional().nullable(), // paid in full or in installments; without it the next installment is asked for with each payment
    kind: z.enum(['new', 'upgrade']).default('new'),
    previousRegistrationId: optUuid,
    projectCertificate: z.boolean().default(false), // a project certificate comes with the course certificate
    // internship letters the student needs, and the template for each (null = Standard)
    internshipOffer: z.boolean().default(false),
    internshipCompletion: z.boolean().default(false),
    offerTemplateId: z.string().uuid().nullable().optional(),
    completionTemplateId: z.string().uuid().nullable().optional(),
    letterCompanyId: z.string().uuid().nullable().optional(), // the company the letters come from (null: techcadd)
  })
  .refine((v) => v.enquiryId || v.person, { message: 'Pick an enquiry or enter the student details' })
  .refine((v) => (v.courseFee == null) === (v.gstAmount == null) && (v.courseFee == null || v.courseFee + v.gstAmount! === v.totalFee), { message: 'Course fee and GST must add up to the total fee' })
  .refine((v) => !(v.courseId && v.customCourse), { message: 'Choose a course from the list or a customized course, not both' })
  .refine((v) => !v.joiningDate || v.joiningDate >= v.enrollmentDate, { message: 'The joining date cannot be before the registration date' })
  .refine((v) => v.listFee == null || v.totalFee == null || v.listFee >= v.totalFee, { message: 'The offer fee cannot be more than the total fees' })
export type CreateRegistrationInput = z.input<typeof createRegistrationInput>

export const regTransitionInput = z.object({
  registrationId: z.string().uuid(),
  to: z.enum(['active', 'on_hold', 'discontinued']),
  note: optText,
})
export type RegTransitionInput = z.infer<typeof regTransitionInput>

/** Back-dating: the dates of a registration, corrected afterwards (e.g. so that a certificate can be made earlier). */
export const regDatesInput = z.object({
  registrationId: z.string().uuid(),
  enrollmentDate: isoDate,
  joiningDate: isoDate.optional().nullable(),
  expectedEndDate: isoDate.optional().nullable(),
  note: z.string().trim().min(3, 'Say why the dates are changed').max(300),
})
  .refine((v) => !v.joiningDate || v.joiningDate >= v.enrollmentDate, { message: 'The joining date cannot be before the registration date' })
  .refine((v) => !v.expectedEndDate || v.expectedEndDate >= (v.joiningDate ?? v.enrollmentDate), { message: 'The finish date cannot be before the joining date' })
export type RegDatesInput = z.infer<typeof regDatesInput>
