// What the product does, said once: the institute's own home page (/support) and the platform's marketing site both
// show these.
import { BadgeCheck, Briefcase, CalendarCheck, ChartColumn, ClipboardList, FileCheck2, Fingerprint, LifeBuoy, Lock, Megaphone, Mic, Palette, PhoneCall, QrCode, ShieldCheck, UserPlus, Wallet } from 'lucide-react'

export const JOURNEY = [
  { icon: PhoneCall, title: 'Call or lead', text: 'Walk-in, phone or website form' },
  { icon: ClipboardList, title: 'Enquiry', text: 'Follow-ups until they decide' },
  { icon: UserPlus, title: 'Registration', text: 'Course, fee plan, ID card' },
  { icon: Wallet, title: 'Fees', text: 'Instalments and QR receipts' },
  { icon: CalendarCheck, title: 'Classes', text: 'Batches, attendance, tests' },
  { icon: FileCheck2, title: 'Certificate', text: 'Issued, e-mailed, verifiable' },
]

export const FEATURES = [
  { icon: PhoneCall, title: 'Leads that do not slip', text: 'Every call, walk-in and website form lands in one list, is shared out to telecallers and comes back on its follow-up date. Overdue ones go up to the branch manager.', big: true },
  { icon: Wallet, title: 'Fees without surprises', text: 'Fee plans and instalments, approved discounts and changes, reminders before the due date, and a numbered receipt with a QR code for every payment.', big: true },
  { icon: CalendarCheck, title: 'Classes & attendance', text: 'Batches, trainers, daily attendance, syllabus progress, tests and notes.' },
  { icon: BadgeCheck, title: 'Certificates', text: 'Course and project certificates, from request to e-mailed PDF.' },
  { icon: Mic, title: 'Seminars & workshops', text: 'Sign-up link and QR, optional quiz, certificates by e-mail.' },
  { icon: Palette, title: 'Certificate designs', text: 'Design on a canvas from templates, pictures and the logo.' },
  { icon: Briefcase, title: 'Internship letters', text: 'Selection and completion letters on the right letterhead.' },
  { icon: Megaphone, title: 'Messages', text: 'Reminders, birthday wishes, announcements, bulk WhatsApp.' },
  { icon: LifeBuoy, title: 'Help desk', text: 'Students ask from their portal; staff answer and close.' },
  { icon: ChartColumn, title: 'Dashboard & reports', text: 'Any dates, any branch, every list exportable.' },
]

export const SECURITY = [
  { icon: Lock, title: 'Each branch sees its own', text: 'The database itself keeps branches and students apart, not just the screens.' },
  { icon: Fingerprint, title: 'Strong sign-in', text: 'Encrypted passwords, lockout on guessing, optional e-mail code at sign-in.' },
  { icon: QrCode, title: 'Documents you can check', text: 'Receipts and certificates carry codes that cannot be guessed or forged.' },
  { icon: ShieldCheck, title: 'Every change recorded', text: 'Who did what and when is kept, and payments can never be edited.' },
]

/** The questions institutes ask (FAQ page and the home page). */
export const siteFaq = (days: number, approval: boolean) => [
  { q: 'How does the free trial work?', a: `Sign up with your institute’s name and e-mail.${approval ? ' We check each new institute (usually within a working day); you can set up meanwhile.' : ''} You get every feature for ${days} days. At the end, pick a plan; until you do, your institute is paused (nothing is deleted) and opens again as soon as you pay.` },
  { q: 'Do I need to install anything?', a: 'No. It runs in the browser on a computer or phone, at your institute’s own web address (or your own domain on the Enterprise plan).' },
  { q: 'Can I bring my existing students and fees?', a: 'Yes. Import students, enquiries and staff from an Excel or Google Sheets file whenever you like; the import understands the usual column names, checks the file first and shows each row it could not take.' },
  { q: 'Is our data safe and private?', a: 'Each institute’s records are kept apart by the database itself. Passwords are stored encrypted, sign-ins can need an e-mailed code, and every change is recorded. Our team cannot see your students unless you ask for help, and then only for a limited time that you can see and end.' },
  { q: 'How do we pay?', a: 'Monthly or yearly, by UPI, card or net banking, with a GST invoice for every payment. Yearly plans cost ten months.' },
  { q: 'What happens if a payment fails?', a: 'We retry and remind you for 7 days. After that your institute is paused until the payment is made; nothing is deleted.' },
  { q: 'Can we cancel?', a: 'Any time, from Settings. You keep access until the end of the period you paid for and can download your data.' },
  { q: 'Do you support several branches?', a: 'Yes. Head office sees every branch; each branch sees its own. The number of branches depends on the plan.' },
]
