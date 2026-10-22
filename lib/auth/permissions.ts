// SSOT for "who may do what". Roles are DATA (table `roles`, edited by a super admin on the Roles & permissions
// screen); this file defines the catalog of permissions and the DEFAULT roles that seed that table.
// Every server action checks can()/assertCan() against the actor's live permissions; the UI only hides.

export const RESOURCES = [
  'branch', 'user', 'role', 'catalog', 'setting',
  'call', 'enquiry', 'lead', 'weblead', 'registration', 'fee', 'receipt',
  'batch', 'attendance', 'assessment', 'teaching', 'certificate', 'internship', 'report', 'audit',
  'helpdesk', 'template', 'overdue', 'branchmail', 'recycle', 'broadcast', 'event', 'certdesign', 'expense', 'franchise',
] as const
export type Resource = (typeof RESOURCES)[number]
export const ACTIONS = ['read', 'create', 'update', 'approve', 'delete', 'clear', 'assign'] as const
export type Action = (typeof ACTIONS)[number]
export type Perm = `${Resource}:${Action}`

/** What each area means and which actions make sense for it (drives the permission grid). */
export const CATALOG: Record<Resource, { label: string; actions: Partial<Record<Action, string>> }> = {
  branch: { label: 'Branches', actions: { read: 'See', create: 'Add', update: 'Edit', delete: 'Delete' } },
  user: { label: 'Users & staff', actions: { read: 'See', create: 'Add', update: 'Edit / deactivate / reset password' } },
  role: { label: 'Roles & permissions', actions: { read: 'See', update: 'Create & edit roles' } },
  catalog: { label: 'Courses & lists', actions: { read: 'See', create: 'Add courses & categories', update: 'Edit' } },
  setting: { label: 'Settings & rules', actions: { read: 'See', update: 'Edit' } },
  call: { label: 'Random calls', actions: { read: 'See', create: 'Log calls', update: 'Edit / follow up', delete: 'Delete' } },
  enquiry: { label: 'Enquiries', actions: { read: 'See', create: 'Add', update: 'Edit / follow up', approve: 'Approve', delete: 'Delete leads' } },
  lead: { label: 'Lead distribution', actions: { read: 'Work own lead queue', assign: 'Assign leads to telecallers' } },
  weblead: { label: 'Website leads', actions: { read: 'See website leads', assign: 'Send website leads to a branch' } },
  registration: { label: 'Admissions', actions: { read: 'See students', create: 'Admit / register', update: 'Edit / hold / discontinue / documents', approve: 'Re-activate discontinued', delete: 'Delete (to the Recycle Bin)' } },
  fee: { label: 'Fees', actions: { read: 'See fees & dues', create: 'Take payments / give discounts', update: 'Change total fees / plans, approve fee requests', clear: 'Check fees / raise remarks', approve: 'Reverse payments / refunds' } },
  receipt: { label: 'Receipts', actions: { read: 'See / print' } },
  batch: { label: 'Batches', actions: { read: 'See', create: 'Add batches', update: 'Edit / add students' } },
  attendance: { label: 'Attendance', actions: { read: 'See', create: 'Mark' } },
  assessment: { label: 'Grades & capstone', actions: { read: 'See', create: 'Add grades', update: 'Approve capstone' } },
  teaching: { label: 'Teaching', actions: { read: 'My Classes & Project Help (is a trainer)', create: 'Teach: syllabus, tests, notes, help', approve: 'Approve syllabus changes' } },
  certificate: { label: 'Certificates', actions: { read: 'See', create: 'Request', clear: 'Clear fees (accounts)', approve: 'Issue / reject', delete: 'Revoke issued certificates' } },
  internship: { label: 'Internship letters', actions: { read: 'See', create: 'Add interns / ask for completion', approve: 'Issue letters / cancel' } },
  report: { label: 'Dashboard & reports', actions: { read: 'See' } },
  audit: { label: 'Audit log', actions: { read: 'See' } },
  helpdesk: { label: 'Help desk & tickets', actions: { read: 'See the Help Desk', update: 'Answer, assign & close tickets' } },
  template: { label: 'Message templates', actions: { read: 'See', update: 'Edit the e-mail wording' } },
  overdue: { label: 'Overdue escalations', actions: { read: 'Receive escalations (branch manager level)' } },
  branchmail: { label: 'Branch e-mail', actions: { update: 'Set up the branch’s own e-mail' } },
  recycle: { label: 'Recycle Bin', actions: { read: 'See deleted items', update: 'Restore', delete: 'Delete for good' } },
  broadcast: { label: 'Bulk WhatsApp', actions: { read: 'See bulk messages sent', create: 'Send bulk WhatsApp' } },
  event: { label: 'Seminars & workshops', actions: { read: 'See events & who joined', create: 'Create events (quiz, certificate)', update: 'Edit / open / close events, resend certificates' } },
  certdesign: { label: 'Certificate designs', actions: { read: 'See the designs', update: 'Design certificates on the canvas' } },
  expense: { label: 'Expenses', actions: { read: 'See expenses & profit', create: 'Record expenses', delete: 'Delete expenses' } },
  franchise: { label: 'Franchises', actions: { read: 'See franchise terms & royalty', update: 'Set franchise terms', create: 'Record royalty payments', delete: 'Delete royalty payments' } },
}
export const ALL_PERMS: Perm[] = RESOURCES.flatMap((r) => (Object.keys(CATALOG[r].actions) as Action[]).map((a) => `${r}:${a}` as Perm))

/** Plain-words explanation of each area and each tick (the "i" buttons on the Roles & permissions screen). */
// How Roles & Permissions groups the areas. Every resource must sit in exactly one group (pnpm test:unit checks it),
// or it could not be ticked.
export const PERM_GROUPS: { title: string; hint: string; areas: Resource[] }[] = [
  { title: 'Leads & admissions', hint: 'From the first call to an admitted student', areas: ['call', 'enquiry', 'lead', 'weblead', 'registration'] },
  { title: 'Money', hint: 'Fees coming in, expenses going out, franchise royalty', areas: ['fee', 'receipt', 'expense', 'franchise'] },
  { title: 'Academics', hint: 'Classes, teaching, grades and certificates', areas: ['batch', 'attendance', 'assessment', 'teaching', 'certificate', 'internship'] },
  { title: 'Students & messages', hint: 'Help desk, e-mail wording, the branch mailbox and bulk WhatsApp', areas: ['helpdesk', 'template', 'branchmail', 'broadcast'] },
  { title: 'Events', hint: 'Seminars, workshops and webinars: sign-up link, quiz and e-mailed certificates', areas: ['event', 'certdesign'] },
  { title: 'Administration', hint: 'People, branches and how the panel is set up', areas: ['branch', 'user', 'role', 'catalog', 'setting', 'recycle'] },
  { title: 'Oversight', hint: 'Numbers, escalations and history', areas: ['report', 'overdue', 'audit'] },
]

export const PERM_HELP: Record<Resource, { about: string; actions: Partial<Record<Action, string>> }> = {
  branch: { about: 'The institute branches (centres) and their details.', actions: { read: 'Open the branch list and see branch details.', create: 'Set up a new branch.', update: 'Change a branch’s details.', delete: 'Remove a branch.' } },
  user: { about: 'The staff logins of the branch and the roles each person holds.', actions: { read: 'See the list of staff and their roles.', create: 'Add a new staff member and give them a login.', update: 'Edit a staff member, switch their login off, or reset their password.' } },
  role: { about: 'This screen: the roles and what each one may do.', actions: { read: 'Open this screen and see every role.', update: 'Create, rename and delete roles, and change their ticks.' } },
  catalog: { about: 'Courses, departments and the pick-lists used in forms (sources, class modes and so on).', actions: { read: 'See courses and lists. Needed to fill most forms.', create: 'Add new courses and course categories. Those a branch adds wait for head office to approve them.', update: 'Edit courses and lists.' } },
  setting: { about: 'Branch settings and the rules the panel follows.', actions: { read: 'See the settings.', update: 'Change the settings and rules.' } },
  call: { about: 'Phone calls from people who are not yet an enquiry.', actions: { read: 'See the call log.', create: 'Log a new call.', update: 'Edit a logged call and record follow-up calls.', delete: 'Delete a call that was logged by mistake.' } },
  enquiry: { about: 'People who asked about a course, and the follow-ups with them.', actions: { read: 'See enquiries.', create: 'Add a new enquiry.', update: 'Edit an enquiry and record follow-ups.', approve: 'Approve enquiries that need a manager’s approval.', delete: 'Delete a lead that has not visited yet.' } },
  lead: { about: 'Sharing enquiries out to telecallers, and each telecaller’s own queue.', actions: { read: 'Work the leads assigned to this person (My Leads).', assign: 'Hand leads out to telecallers.' } },
  weblead: { about: 'Forms sent on the institute websites. A website set on a branch sends its leads to that branch; the rest wait for head office.', actions: { read: 'Open Web Leads and see the website leads of this branch (head office: of every website).', assign: 'Send a website lead that has no branch yet to a branch (head office).' } },
  registration: { about: 'Admitted students and their admission records.', actions: { read: 'See students and their admission details.', create: 'Admit / register a new student.', update: 'Edit an admission, put it on hold, discontinue it, or manage documents.', approve: 'Re-activate a student who was discontinued.', delete: 'Delete a registration with no payment (it waits 30 days in the Recycle Bin).' } },
  fee: { about: 'Student fees, dues, payments and discounts.', actions: { read: 'See what each student has paid and still owes.', create: 'Take payments, give discounts (no fixed limit, with a reason) and fix what accounts remarks on. A change of total fees or plan is asked for with a request.', update: 'Change a student’s total fees or payment plan, give discounts, and approve or reject fee-change requests.', clear: 'Check the fees taken (accounts) and raise a remark on anything wrong, for whoever collects fees to fix.', approve: 'Reverse a wrong payment or record a refund.' } },
  receipt: { about: 'Payment receipts.', actions: { read: 'See and print receipts.' } },
  batch: { about: 'Batches (class groups) and their class days.', actions: { read: 'See batches.', create: 'Create new batches.', update: 'Edit a batch and add students to it.' } },
  attendance: { about: 'Daily student attendance.', actions: { read: 'See attendance.', create: 'Mark attendance.' } },
  assessment: { about: 'Student grades and the capstone project.', actions: { read: 'See grades.', create: 'Enter grades.', update: 'Approve the capstone project.' } },
  teaching: { about: 'Classes, the syllabus, tests, notes and students’ project help.', actions: { read: 'Open My Classes and Project Help, and count as a trainer: shown in the trainer lists of batches and asked for project help.', create: 'Tick the syllabus topics taught, give tests and marks, share notes and offer project help.', approve: 'Approve the syllabus changes branches send (head office).' } },
  certificate: { about: 'Course and project certificates. Order: request, accounts clears the fees, then it is issued.', actions: { read: 'See certificates and requests.', create: 'Request a certificate for a student.', clear: 'Confirm the student’s fees are cleared (accounts). Someone who can both request and clear (a branch manager) skips the accounts step for their own requests.', approve: 'Issue or reject a course or project certificate.', delete: 'Revoke a certificate already issued.' } },
  internship: { about: 'Internship selection letters and completion certificates, on the letterhead.', actions: { read: 'See interns and their letters.', create: 'Add an intern (or set one up from a registration) and ask for the completion certificate.', approve: 'Issue the selection letter and the completion certificate, or cancel an internship.' } },
  report: { about: 'The dashboard numbers and the reports.', actions: { read: 'See the dashboard and reports.' } },
  audit: { about: 'The record of who did what, and when.', actions: { read: 'See the audit log.' } },
  helpdesk: { about: 'Students’ questions from the portal, and the staff’s internal tickets to the branch manager.', actions: { read: 'Open the Help Desk.', update: 'Answer, assign and close tickets, and see the branch’s internal tickets.' } },
  template: { about: 'The wording of the e-mails the panel sends (birthday, certificate, help desk…) and the ready-made announcements.', actions: { read: 'Open Message Templates.', update: 'Change the wording for this branch (head office: for every branch).' } },
  overdue: { about: 'Leads and fees past their date go up to the branch manager, then to head office.', actions: { read: 'Receive what is escalated to the branch manager: counts on the dashboard and bell, and the morning e-mail.' } },
  branchmail: { about: 'The branch’s own mail server, so its e-mails go out from the branch’s address.', actions: { update: 'Set up and change the branch e-mail.' } },
  recycle: { about: 'Deleted records wait here for 30 days. Head office sees every branch; others see their own branch’s.', actions: { read: 'Open the Recycle Bin.', update: 'Restore a deleted record.', delete: 'Delete a record for good before the 30 days.' } },
  event: { about: 'Seminars, workshops, webinars and other events. Each has a public link and QR code where people sign up, take the quiz (when the event has one) and get their certificate by e-mail.', actions: { read: 'Open Seminars & Workshops and see each event’s sign-ups, quiz scores and certificates.', create: 'Create an event: its details, an optional quiz and the certificate design.', update: 'Change an event, open or close its sign-ups, and resend a certificate e-mail.' } },
  certdesign: { about: 'Certificate designs made on the canvas (from a ready-made template, a blank page or a picture), used by events. Head office’s designs are offered to every branch.', actions: { read: 'See the designs and preview them.', update: 'Create and edit designs on the canvas (a branch: its own; head office: every one).' } },
  broadcast: { about: 'WhatsApp campaigns (made in AiSensy, listed by head office in Settings) sent to many students or leads at once.', actions: { read: 'Open Bulk WhatsApp and see what was sent from this branch.', create: 'Send a campaign to students or leads of this branch (head office: of every branch).' } },
  expense: { about: 'What the branch spends (rent, salaries, bills, marketing…), and the profit after fees received.', actions: { read: 'Open Expenses and see the spending and the profit.', create: 'Record an expense.', delete: 'Delete an expense recorded by mistake (it stays in the log).' } },
  franchise: { about: 'Centres run by franchise partners: their terms and the royalty they owe on the fees they receive.', actions: { read: 'See the franchise terms and the royalty statement (a franchise’s own staff: their centre’s).', update: 'Make a centre a franchise and set its partner and royalty.', create: 'Record a royalty payment from a partner.', delete: 'Delete a royalty payment recorded by mistake (it stays in the log).' } },
}

/** Rule: nobody can act on an area they cannot see. Any tick in an area brings that area's "See" with it. */
export function withRequired(perms: readonly string[]): string[] {
  return [...new Set(perms.flatMap((perm) => [`${perm.split(':')[0]}:read`, perm]))]
}

/** super = every permission, all branches. student = the student portal only. staff = what the role lists, in their branch. */
export type RoleKind = 'super' | 'staff' | 'student'
export type RoleDef = { key: string; name: string; description: string; kind: RoleKind; locked: boolean; perms: Perm[] }

const p = (r: Resource, ...a: Action[]) => a.map((x) => `${r}:${x}` as Perm)
/** Shared by every branch (the branch list, roles, courses, global rules), so only head office holds these. */
const HEAD_OFFICE: Perm[] = [...p('branch', 'read', 'create', 'update', 'delete'), ...p('role', 'read', 'update'), ...p('catalog', 'update'), ...p('setting', 'update'), ...p('weblead', 'assign'),
  ...p('teaching', 'approve'), ...p('certificate', 'delete'), ...p('recycle', 'read', 'update', 'delete'), ...p('franchise', 'update', 'create', 'delete')]
/** A branch manager runs the branch but does not teach (is not listed as a trainer). */
const NOT_MANAGER: Perm[] = [...HEAD_OFFICE, ...p('teaching', 'read')]
export const DEFAULT_ROLES: RoleDef[] = [
  { key: 'super_admin', name: 'Institute Admin', kind: 'super', locked: true, description: 'Head office of the institute. Everything, in every branch.', perms: ALL_PERMS },
  { key: 'branch_manager', name: 'Branch Manager', kind: 'staff', locked: false, description: 'Branch head: everything a super admin can do, inside their own branch.', perms: ALL_PERMS.filter((x) => !NOT_MANAGER.includes(x)) },
  { key: 'academic_manager', name: 'Academic Manager', kind: 'staff', locked: false, description: 'Courses, batches, trainers, attendance, grades; requests certificates.', perms: [
    ...p('catalog', 'read', 'create', 'update'), ...p('registration', 'read'), ...p('batch', 'read', 'create', 'update'), ...p('attendance', 'read', 'create'),
    ...p('assessment', 'read', 'create', 'update'), ...p('teaching', 'read', 'create'), ...p('certificate', 'read', 'create'), ...p('internship', 'read', 'create'), ...p('report', 'read'),
    ...p('event', 'read', 'create', 'update'), ...p('certdesign', 'read')] },
  { key: 'counselor', name: 'Counselor', kind: 'staff', locked: false, description: 'Enquiries and admissions; collects fee payments and asks accounts for fee changes; requests certificates and internship letters.', perms: [
    ...p('catalog', 'read'), ...p('call', 'read', 'create', 'update'), ...p('enquiry', 'read', 'create', 'update'), ...p('registration', 'read', 'create', 'update'), ...p('fee', 'read', 'create'), ...p('receipt', 'read'),
    ...p('batch', 'read'), ...p('attendance', 'read'), ...p('certificate', 'read', 'create'), ...p('internship', 'read', 'create')] },
  { key: 'telecaller', name: 'Telecaller', kind: 'staff', locked: false, description: 'Calls the leads assigned to them (from any branch) and records the outcome.', perms: [
    ...p('catalog', 'read'), ...p('call', 'read', 'create', 'update'), ...p('enquiry', 'read', 'create', 'update'), ...p('lead', 'read')] },
  { key: 'accountant', name: 'Accountant', kind: 'staff', locked: false, description: 'Checks the fees admissions collects (remarks to fix), approves fee changes and discounts; clears fees and issues course and project certificates.', perms: [
    ...p('catalog', 'read'), ...p('enquiry', 'read'), ...p('registration', 'read'), ...p('fee', 'read', 'update', 'clear'), ...p('receipt', 'read'),
    ...p('certificate', 'read', 'clear', 'approve'), ...p('report', 'read'), ...p('expense', 'read', 'create')] },
  { key: 'hr', name: 'HR', kind: 'staff', locked: false, description: 'Interns: adds them and issues internship selection letters and completion certificates.', perms: [
    ...p('catalog', 'read'), ...p('registration', 'read'), ...p('internship', 'read', 'create', 'approve')] },
  { key: 'trainer', name: 'Trainer', kind: 'staff', locked: false, description: 'Their own batches: attendance, grades and capstone sign-off.', perms: [
    ...p('catalog', 'read'), ...p('registration', 'read'), ...p('batch', 'read'), ...p('attendance', 'read', 'create'), ...p('assessment', 'read', 'create', 'update'), ...p('teaching', 'read', 'create'), ...p('certificate', 'read'), ...p('internship', 'read')] },
  { key: 'support', name: 'Support Team', kind: 'staff', locked: false, description: 'Read-only view of students, fees, receipts and certificates to answer questions.', perms: [
    ...p('catalog', 'read'), ...p('enquiry', 'read'), ...p('registration', 'read'), ...p('fee', 'read'), ...p('receipt', 'read'),
    ...p('batch', 'read'), ...p('attendance', 'read'), ...p('certificate', 'read'), ...p('internship', 'read')] },
  { key: 'helpdesk', name: 'Student Help Desk', kind: 'staff', locked: false, description: 'Helps enrolled students: their fees, receipts, attendance and certificate requests.', perms: [
    ...p('catalog', 'read'), ...p('registration', 'read'), ...p('fee', 'read'), ...p('receipt', 'read'), ...p('batch', 'read'), ...p('attendance', 'read'),
    ...p('certificate', 'read', 'create'), ...p('internship', 'read', 'create')] },
  { key: 'front_desk', name: 'Front Desk', kind: 'staff', locked: false, description: 'Walk-ins: logs calls and enquiries.', perms: [
    ...p('catalog', 'read'), ...p('call', 'read', 'create', 'update'), ...p('enquiry', 'read', 'create', 'update')] },
  { key: 'student', name: 'Student', kind: 'student', locked: true, description: 'Student portal: own fees, receipts, classes and certificate.', perms: [
    ...p('fee', 'read'), ...p('receipt', 'read'), ...p('attendance', 'read'), ...p('certificate', 'read', 'create')] },
]
export const DEFAULT_ROLE = Object.fromEntries(DEFAULT_ROLES.map((r) => [r.key, r])) as Record<string, RoleDef>

/** Who is asking: an actor with live permissions (loaded from the roles table), or bare role key(s) -> default roles. */
export type Subject = string | readonly string[] | { role: string; roles?: readonly string[]; perms?: readonly string[]; ownOnly?: boolean }

/** Areas that run a branch (its staff, roles, settings). Someone working in a branch for their own work only just sees them. */
const BRANCH_ADMIN: readonly string[] = ['user', 'role', 'branch', 'setting', 'branchmail', 'template', 'helpdesk', 'recycle']

function permSet(s: Subject): Set<string> {
  if (typeof s === 'object' && !Array.isArray(s) && 'role' in s) {
    const all = s.perms ? new Set(s.perms) : permSet(s.roles ?? [s.role])
    if (s.ownOnly) for (const perm of all) if (BRANCH_ADMIN.includes(perm.split(':')[0]) && !perm.endsWith(':read')) all.delete(perm)
    return all
  }
  const keys = typeof s === 'string' ? [s] : (s as readonly string[])
  return new Set(keys.flatMap((k) => DEFAULT_ROLE[k]?.perms ?? []))
}

export function can(who: Subject, action: Action, resource: Resource): boolean {
  return permSet(who).has(`${resource}:${action}`)
}

export function assertCan(who: Subject, action: Action, resource: Resource): void {
  if (!can(who, action, resource)) throw new Error(`Forbidden: ${action} ${resource}`)
}

/** Permissions that manage people, money approvals or the system itself (as opposed to day-to-day work). */
export const isManagementPerm = (perm: string) => {
  const [res, act] = perm.split(':')
  return ['user', 'role', 'branch', 'setting', 'branchmail', 'template', 'helpdesk', 'recycle'].includes(res) || ['approve', 'assign', 'clear', 'delete'].includes(act)
}

/**
 * No privilege escalation. A super admin may give any role. Anyone else (a branch head) may give a staff role only if
 * that role cannot itself create users, and every management permission in it is one they hold themselves.
 * Day-to-day permissions (e.g. marking attendance) do not count, so a branch head can still add trainers.
 */
export function mayGrant(granter: { isSuper: boolean; perms: readonly string[] }, role: { kind: string; permissions: readonly string[] }): boolean {
  if (granter.isSuper) return role.kind !== 'student'
  if (role.kind !== 'staff' || role.permissions.includes('user:create')) return false
  const own = new Set(granter.perms)
  return role.permissions.filter(isManagementPerm).every((p) => own.has(p))
}
