import 'server-only'
// A verified certificate (modules/certificates/service verifyCertificate) as what the course completion and project
// completion designs print.
import { durationText } from '@/lib/cert-art'
import type { CourseCertInput } from '@/lib/cert-course'
import type { ProjectCertInput } from '@/lib/cert-project'
import type { Verification } from '@/modules/certificates/service'

/** "6 months" from the course length; without one, from the joining and end dates (whole months only). */
function duration(v: Extract<Verification, { found: true }>) {
  const weeks = v.durationWeeks
  if (weeks) return durationText(weeks, null)
  if (v.ended) {
    const months = Math.round((new Date(`${v.ended}T00:00:00Z`).getTime() - new Date(`${v.joined}T00:00:00Z`).getTime()) / (30.44 * 86400000))
    if (months >= 1) return `${months} month${months === 1 ? '' : 's'}`
  }
  return v.hours ? `${v.hours} hours` : null
}

export function courseCertInput(v: Extract<Verification, { found: true }>, verifyUrl: string): CourseCertInput {
  return {
    name: v.name, father: v.sheet.father, gender: v.sheet.gender, course: v.course, tools: v.modules, toolsLabel: v.toolsLabel,
    duration: duration(v), joined: v.joined, ended: v.ended, mode: v.sheet.mode, regNo: v.sheet.regNo, branch: v.branch,
    certNo: v.certNo, serial: v.sheet.serial, issuedAt: v.issuedAt, verifyUrl,
    signers: { authorised: v.sheet.authorised, head: v.sheet.head },
  }
}

/** The project certificate: the project as the trainer approved it (an older one without a named project: the course). */
export function projectCertInput(v: Extract<Verification, { found: true }>): ProjectCertInput {
  return {
    name: v.name, father: v.sheet.father, gender: v.sheet.gender, project: v.project?.title ?? v.course,
    tools: v.project?.tools.length ? v.project.tools : v.modules, joined: v.joined, ended: v.ended, issuedAt: v.issuedAt,
    regNo: v.sheet.regNo, branch: v.branch, head: v.sheet.head,
  }
}
