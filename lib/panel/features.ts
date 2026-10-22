// Features an institute switches on or off (Settings → Features), so the menu shows only what it uses. The core
// (leads, enquiries, admissions, fees, students, classes, courses, certificates, reports, staff, branches, settings)
// is always there; each pack below adds its pages. Switching a pack off hides its pages from the menu; nothing is
// deleted and permissions still decide who may open what. New institutes start with the packs marked `starts`; an
// institute made before this (no saved choice) keeps everything on.
import type { ModuleKey } from './modules'

export type FeatureKey = 'calling' | 'webleads' | 'helpdesk' | 'teaching' | 'internships' | 'letters' | 'events' | 'whatsapp' | 'expenses' | 'import'

export const FEATURES: { key: FeatureKey; label: string; about: string; modules: ModuleKey[]; starts: boolean }[] = [
  { key: 'webleads', label: 'Website & online form leads', about: 'Leads from your website and the online admission form, with the ad they came from.', modules: ['Web Leads'], starts: true },
  { key: 'calling', label: 'Calling team', about: 'Telecallers: walk-in and phone calls, leads handed out to callers, lead categories, a calendar and leaderboards.', modules: ['Random Call', 'My Leads', 'Lead Distribution', 'Lead Categories', 'Enquiry Update', 'Calendar', 'Leaderboards'], starts: false },
  { key: 'teaching', label: 'Trainers’ classes', about: 'Trainers mark attendance, tick the syllabus, give marks and help students with projects.', modules: ['My Classes', 'Project Help'], starts: true },
  { key: 'helpdesk', label: 'Student help desk & notices', about: 'Students ask questions from their portal; you answer them and post notices.', modules: ['Help Desk', 'My Tickets', 'Announcements'], starts: true },
  { key: 'expenses', label: 'Expenses & profit', about: 'What each branch spends, and the profit against fees received.', modules: ['Expenses'], starts: true },
  { key: 'internships', label: 'Internships', about: 'Students’ internship requests and completion letters.', modules: ['Internship Requests', 'Internship Complete'], starts: false },
  { key: 'letters', label: 'Letters', about: 'Offer, experience and other letters printed on your letterhead.', modules: ['Letter Templates'], starts: false },
  { key: 'events', label: 'Seminars & workshops', about: 'Events with a sign-up link and QR code, a quiz and e-mailed certificates.', modules: ['Seminars & Workshops'], starts: false },
  { key: 'whatsapp', label: 'WhatsApp campaigns', about: 'Send a WhatsApp campaign to students or leads, and edit the words of the messages the panel sends.', modules: ['Bulk WhatsApp', 'Message Templates'], starts: false },
  { key: 'import', label: 'Import from an old system', about: 'Bring a branch’s students and payments over from phpMyAdmin exports.', modules: ['Old System Import'], starts: false },
]

/** The packs a new institute starts without. */
export const NEW_ORG_OFF: FeatureKey[] = FEATURES.filter((f) => !f.starts).map((f) => f.key)

/** The menu pages hidden by the packs switched off. */
export function hiddenModules(off: string[]): Set<ModuleKey> {
  return new Set(FEATURES.filter((f) => off.includes(f.key)).flatMap((f) => f.modules))
}
