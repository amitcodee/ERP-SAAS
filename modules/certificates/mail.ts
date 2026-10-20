// The e-mail a student gets when their course certificate is issued: the words from Message templates (the
// branch's own, else head office's), with the links to view / download, the project certificate when there is one,
// and the public verification page. Read on the server's own connection (staff templates, the student's e-mail).
import { sql } from 'drizzle-orm'
import { withOrgSystem } from '@/lib/db/withTenant'
import { mailButton } from '@/lib/notify/layout'
import { fillTemplate, resolveTemplate } from '@/modules/templates/service'

export async function certificateIssuedMail(orgId: string, requestId: string, origin: string) {
  return withOrgSystem(orgId, async (tx) => {
    const [c] = (await tx.execute<{ email: string | null; first_name: string; course: string | null; cert_no: string; hash: string; branch_id: string; branch: string; project: boolean }>(sql`
      select p.email, p.first_name, coalesce(co.title, r.custom_course_title, d.name) as course, ce.cert_no, ce.verification_hash as hash, ce.branch_id, b.name as branch, r.project_certificate as project
      from certificates ce join registrations r on r.id = ce.registration_id join persons p on p.id = r.person_id join branches b on b.id = ce.branch_id
        left join courses co on co.id = r.course_id left join departments d on d.id = r.department_id
      where ce.request_id = ${requestId} and not ce.is_revoked`)).rows
    if (!c?.email || !c.email.includes('@')) return null
    const t = await resolveTemplate(tx, 'certificate_email', c.branch_id)
    const base = `${origin}/verify/${c.hash}`
    const vars = {
      first_name: c.first_name, course: c.course ?? 'your course', cert_no: c.cert_no, branch: c.branch,
      certificate_link: mailButton('View / download certificate', `${base}/certificate`),
      project_link: c.project ? mailButton('Project certificate', `${base}/certificate?kind=project`) : '',
      verify_link: mailButton('Verify certificate', base),
    }
    return { to: c.email, branchId: c.branch_id, subject: fillTemplate(t.subject, vars), body: fillTemplate(t.body, vars).replace(/\n{3,}/g, '\n\n') }
  })
}
