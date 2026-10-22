// The panel's pages: one URL each, and who may open them (by permission, so it follows a person's roles).
import type { Action, Resource } from '@/lib/auth/permissions'

type Ok = (a: Action, r: Resource) => boolean
export type ModuleKey =
  | 'Dashboard' | 'Overdues' | 'My Tickets' | 'My Classes' | 'Project Help' | 'Random Call' | 'Leads' | 'Web Leads' | 'Lead Categories' | 'Enquiry' | 'Registration' | 'Enquiry Update' | 'My Leads' | 'Lead Distribution' | 'Transfers' | 'Shared Students'
  | 'Fees' | 'Expenses' | 'Collection' | 'Students' | 'Courses' | 'Reports' | 'Graphs' | 'Leaderboards' | 'Calendar' | 'Certificate Requests' | 'Issue Certificate' | 'Internship Requests' | 'Internship Complete' | 'Letter Templates' | 'Seminars & Workshops' | 'Certificate Designs' | 'Course Categories' | 'Help Desk' | 'Announcements' | 'Message Templates' | 'Bulk WhatsApp' | 'Users & Staff' | 'Roles & Permissions' | 'Branches' | 'Logs' | 'Sign-in Security' | 'Recycle Bin' | 'Old System Import' | 'Settings' | 'Set Up'

/** The menu's groups, in order. */
export const GROUPS = ['Overview', 'Admissions', 'Students & classes', 'Fees & money', 'Certificates', 'Events', 'Reports', 'Setup', 'Security & records']

export const MODULES: { key: ModuleKey; path: string; group: string; allowed: (ok: Ok) => boolean; planModule?: string }[] = [
  { key: 'Dashboard', path: '/dashboard', group: 'Overview', allowed: () => true },
  // leads past their follow-up date and fees past their installment date, escalated to the branch manager and head office
  { key: 'Overdues', path: '/overdues', group: 'Overview', allowed: (ok) => ok('read', 'enquiry') || ok('read', 'call') || ok('read', 'fee') },
  { key: 'Calendar', path: '/calendar', group: 'Overview', allowed: (ok) => ok('read', 'call') || ok('read', 'enquiry') || ok('read', 'registration') || ok('read', 'fee') },
  // every staff member: internal tickets they raised (to the branch manager or head office) and tickets given to them
  { key: 'My Tickets', path: '/my-tickets', group: 'Overview', allowed: () => true },
  { key: 'Leads', path: '/leads', group: 'Admissions', allowed: (ok) => ok('read', 'enquiry') },
  { key: 'Web Leads', path: '/web-leads', group: 'Admissions', allowed: (ok) => ok('read', 'weblead') },
  { key: 'Random Call', path: '/calls', group: 'Admissions', allowed: (ok) => ok('read', 'call') },
  { key: 'My Leads', path: '/my-leads', group: 'Admissions', allowed: (ok) => ok('read', 'lead') },
  { key: 'Lead Distribution', path: '/lead-distribution', group: 'Admissions', allowed: (ok) => ok('assign', 'lead') },
  { key: 'Lead Categories', path: '/lead-categories', group: 'Admissions', allowed: (ok) => ok('read', 'enquiry') || ok('read', 'call') },
  { key: 'Enquiry', path: '/enquiries', group: 'Admissions', allowed: (ok) => ok('read', 'enquiry') },
  { key: 'Enquiry Update', path: '/enquiries/update', group: 'Admissions', allowed: (ok) => ok('read', 'enquiry') },
  { key: 'Registration', path: '/registrations', group: 'Admissions', allowed: (ok) => ok('read', 'registration') },
  // students moving between branches: asked by the branch they leave, accepted by the branch they go to
  { key: 'Transfers', path: '/transfers', group: 'Admissions', allowed: (ok) => ok('read', 'registration') },
  // students of one branch taking some classes in another: asked by their branch, accepted into a batch by the other
  { key: 'Shared Students', path: '/shared-students', group: 'Admissions', allowed: (ok) => ok('read', 'registration') || ok('update', 'batch') },
  { key: 'Students', path: '/students', group: 'Students & classes', allowed: (ok) => ok('read', 'certificate') || ok('read', 'batch') },
  // the trainer's own panel, and students' project / study help from every branch
  { key: 'My Classes', path: '/my-classes', group: 'Students & classes', allowed: (ok) => ok('read', 'teaching') },
  { key: 'Project Help', path: '/project-help', group: 'Students & classes', allowed: (ok) => ok('read', 'teaching') },
  // students' questions first, for head office (every branch's tickets) and branch managers only
  { key: 'Help Desk', path: '/help-desk', group: 'Students & classes', allowed: (ok) => ok('read', 'helpdesk') },
  // the student portal's help tickets, answered by the branch; and the notice board students see
  { key: 'Announcements', path: '/announcements', group: 'Students & classes', allowed: (ok) => ok('read', 'registration') },
  { key: 'Fees', path: '/fees', group: 'Fees & money', allowed: (ok) => ok('read', 'fee') },
  // Reports: the numbers, charts and the day-by-day calendar of the admissions work.
  { key: 'Collection', path: '/collection', group: 'Fees & money', allowed: (ok) => ok('read', 'fee') },
  // what the branch spends, and the profit: fees received less expenses, month by month
  { key: 'Expenses', path: '/expenses', group: 'Fees & money', allowed: (ok) => ok('read', 'expense') },
  // Documents: certificates, from the request to the certificate in the student's hand.
  { key: 'Certificate Requests', path: '/certificate-requests', group: 'Certificates', allowed: (ok) => ok('read', 'certificate') },
  { key: 'Issue Certificate', path: '/issue-certificate', group: 'Certificates', allowed: (ok) => ok('read', 'certificate') },
  { key: 'Certificate Designs', path: '/certificate-designs', group: 'Certificates', allowed: (ok) => ok('read', 'certdesign') }, // every plan
  { key: 'Internship Requests', path: '/internships', group: 'Certificates', allowed: (ok) => ok('read', 'internship') },
  { key: 'Internship Complete', path: '/internship-complete', group: 'Certificates', allowed: (ok) => ok('read', 'internship') },
  { key: 'Letter Templates', path: '/letter-templates', group: 'Certificates', allowed: (ok) => ok('update', 'setting') },
  // Events: seminars, workshops and webinars with a sign-up link / QR code, an optional quiz and e-mailed certificates
  { key: 'Seminars & Workshops', path: '/events', group: 'Events', allowed: (ok) => ok('read', 'event'), planModule: 'events' },
  { key: 'Reports', path: '/reports', group: 'Reports', allowed: (ok) => ok('read', 'report') },
  { key: 'Graphs', path: '/graphs', group: 'Reports', allowed: (ok) => ok('read', 'report') },
  // who leads the board: telecallers / counselors (conversion), trainers (index) and students (ranking)
  { key: 'Leaderboards', path: '/leaderboards', group: 'Reports', allowed: (ok) => ok('read', 'report') || ok('read', 'enquiry') || ok('read', 'lead') || ok('read', 'teaching') },
  // head office: the first steps of a new institute (modules/onboarding)
  { key: 'Set Up', path: '/setup', group: 'Setup', allowed: (ok) => ok('update', 'setting') && ok('create', 'branch') },
  { key: 'Courses', path: '/courses', group: 'Setup', allowed: (ok) => ok('read', 'catalog') },
  { key: 'Course Categories', path: '/course-categories', group: 'Setup', allowed: (ok) => ok('read', 'catalog') },
  { key: 'Users & Staff', path: '/users', group: 'Setup', allowed: (ok) => ok('read', 'user') },
  { key: 'Roles & Permissions', path: '/roles', group: 'Setup', allowed: (ok) => ok('read', 'role') },
  { key: 'Branches', path: '/branches', group: 'Setup', allowed: (ok) => ok('read', 'branch') },
  // the words of the birthday e-mail and card, help desk and trainer e-mails, ready-made announcements
  { key: 'Message Templates', path: '/message-templates', group: 'Setup', allowed: (ok) => ok('read', 'template') },
  // a WhatsApp campaign (made in AiSensy, listed in Settings) sent to students or leads picked by a filter
  { key: 'Bulk WhatsApp', path: '/whatsapp', group: 'Setup', allowed: (ok) => ok('read', 'broadcast') },
  { key: 'Settings', path: '/settings', group: 'Setup', allowed: () => true },
  { key: 'Logs', path: '/logs', group: 'Security & records', allowed: (ok) => ok('read', 'audit') },
  { key: 'Sign-in Security', path: '/login-logs', group: 'Security & records', allowed: (ok) => ok('update', 'setting') },
  { key: 'Recycle Bin', path: '/recycle-bin', group: 'Security & records', allowed: (ok) => ok('read', 'recycle') },
  // head office: a branch's students and payments from the institute's old system (phpMyAdmin CSV), re-runnable to sync
  { key: 'Old System Import', path: '/import-old', group: 'Security & records', allowed: (ok) => ok('create', 'branch') },
]
/** What the menu and the breadcrumb show, where it differs from the key. */
export const LABEL: Partial<Record<ModuleKey, string>> = { Enquiry: 'Enquiries', 'Enquiry Update': 'Find an enquiry', 'Random Call': 'Calls', Collection: 'Collections', 'Old System Import': 'Import' }
export const labelOf = (k: ModuleKey) => LABEL[k] ?? k
/** What each page is for, shown as a tooltip on the menu. */
export const ABOUT: Record<ModuleKey, string> = {
  Dashboard: 'Your day at a glance: today’s numbers, tasks and alerts.',
  'Set Up': 'The first steps of a new institute: branding, branch, courses, fees, staff, e-mail and your existing students.',
  Overdues: 'Leads past their follow-up date and fees past their installment date.',
  'Help Desk': 'Students’ questions from the portal: answer, assign and close tickets.',
  'My Tickets': 'Tickets you raised to your branch manager or head office, and tickets given to you.',
  'My Classes': 'Your batches: mark today’s class, tick the syllabus, give marks and share notes.',
  'Project Help': 'Students asking for project or study help: offer to help and follow up.',
  'Random Call': 'Log walk-in and phone calls, and follow them up.',
  Leads: 'People who contacted you (website, e-mail, other) but have not visited yet.',
  'Web Leads': 'Leads that came from the website and online forms.',
  'Lead Categories': 'The categories calls, leads and enquiries sit in, and who is in each.',
  'My Leads': 'The leads given to you to call and follow up.',
  'Lead Distribution': 'Share out new leads among the counselors and telecallers.',
  Enquiry: 'People who visited the branch: record and follow up their enquiry.',
  Registration: 'Enrol students from enquiries or directly, and set them active, on hold or discontinued.',
  'Enquiry Update': 'Find an enquiry by phone number and update its status.',
  Transfers: 'Move a student to another branch: ask, accept or reject.',
  'Shared Students': 'Students taking some classes in another branch.',
  'Certificate Requests': 'Certificate requests and what still blocks them (fees, attendance, capstone).',
  'Issue Certificate': 'Issue approved certificates and e-mail them to the students.',
  'Internship Requests': 'Students’ internship requests.',
  'Internship Complete': 'Internship letters for students who finished their internship.',
  'Letter Templates': 'The wording of certificates and letters that get printed.',
  'Seminars & Workshops': 'Seminars, workshops and webinars: a sign-up link and QR code, an optional quiz, and certificates by e-mail.',
  'Certificate Designs': 'Design certificates on a canvas: start from a template, a blank page or a picture.',
  Collection: 'Fee money collected: by day, mode and counselor.',
  Reports: 'Reports on admissions and fees, worked out live from the records.',
  Graphs: 'Charts of leads, admissions and fees over time.',
  Leaderboards: 'Who leads: counselors by conversion, trainers and students by score.',
  Calendar: 'Calls, follow-ups, visits and admissions day by day.',
  Fees: 'Each student’s fee plan, payments, receipts and discounts.',
  Expenses: 'What the branch spends (rent, salaries, bills…) and the profit: fees received less expenses.',
  Students: 'Students’ certificates, documents and portal login; batches and attendance.',
  Courses: 'The course list every enquiry, registration and batch picks from.',
  'Course Categories': 'Course categories and the head whose signature goes on their certificates.',
  Announcements: 'Notices shown on the students’ notice board.',
  'Message Templates': 'The words of the e-mails the panel sends (birthday, certificate, help…).',
  'Bulk WhatsApp': 'Send a WhatsApp campaign to students or leads: by branch, course, status or lead category.',
  'Users & Staff': 'Staff accounts: add people, set their role and branch.',
  'Roles & Permissions': 'What each role is allowed to see and do.',
  Branches: 'Create a branch and complete its setup.',
  Logs: 'Who did what and when, across the panel.',
  'Sign-in Security': 'Sign-in history, locked accounts and allowed IP addresses.',
  'Recycle Bin': 'Deleted records: restore them if removed by mistake.',
  'Old System Import': 'Bring a branch’s students and payments over from your old system (phpMyAdmin exports); run again to sync.',
  Settings: 'How the panel works for every branch: e-mail, messages, reminders and more.',
}
export const PATH = Object.fromEntries(MODULES.map((m) => [m.key, m.path])) as Record<ModuleKey, string>
export const moduleForPath = (p: string) => [...MODULES].sort((a, b) => b.path.length - a.path.length).find((m) => p === m.path || p.startsWith(m.path + '/'))?.key
