# What other institute platforms do (October 2026)

A look at the platforms Indian coaching and training institutes use, to find what this system still lacks. Sources are
the vendors' own pages and review listings (so features are as advertised, not tested): Proctur, Classplus,
Teachmint, Edmingle, Meritto (admissions CRM), and the Techjockey / SoftwareSuggest coaching-software listings.

## What they all have

| Area | Typical offer | Here |
|---|---|---|
| Enquiries and CRM | Lead capture from forms and portals, follow-ups, counsellor assignment, source tracking | Yes: leads, web leads, random calls, lead distribution, categories, follow-up calendar |
| Fees | Instalments, receipts, reminders, **online payment (UPI, cards) with auto receipts** | Instalments, receipts, reminders; **online payment added now** (below) |
| Attendance | Batch attendance; biometric / RFID; **absence alerts to parents** | Batch attendance; **absence alerts added now** (WhatsApp to the guardian) |
| Exams | Test series, question bank, auto-grading, result analysis, report cards | Tests and marks per batch, **report cards with grades and rank added now**; quizzes for events; no online test series yet |
| Learning | LMS (videos, PDFs), assignments, live classes (Zoom / Meet) | Syllabus and notes; no live classes or assignments |
| Apps | Branded student and parent apps | Student web portal (works on phones); **parent link added now** (no app to install) |
| Communication | WhatsApp / SMS / e-mail alerts | Yes: e-mail, WhatsApp (AiSensy / Meta), SMS (MSG91), bulk WhatsApp |
| Certificates and ID cards | ID cards; certificates in some | Strong: designed certificates, QR verification, ID cards, letters |
| Reports | 50+ reports, financial dashboard | Reports, graphs, leaderboards, collections |
| Accounting | Expenses, P&L, GST reports | GST on fees; no expenses or P&L |
| Multi-branch | Central control of branches / franchises | Strong: branches, transfers, shared students, head office |

Admissions-focused CRMs (Meritto) add lead scoring, automatic routing to the counsellor most likely to convert,
WhatsApp nurture journeys, application forms with document checks and payment, and source attribution that cannot be
edited later.

## Where this system is ahead

Certificate design and public verification, internship letters, events with quizzes and certificates, the multi-branch
model (transfers, shared students), per-institute branding, row-level isolation between institutes, and an open API
with webhooks.

## What to add, in order (PLAN.md Phase 4)

1. **Online fee payment** — done in this round: students pay what is due now from the portal into the institute's
   own Razorpay account; the payment is recorded once, with a receipt, by the same path as a desk payment.
2. **Parent access and absence alerts** — done: the WhatsApp alert when a student misses today's class (off until
   switched on), and a private parent link (attendance, fees with Pay online, marks) the office sends by WhatsApp.
3. **Exams and report cards** — report cards done (grade rules per institute, overall result, batch rank, print /
   PDF). Still to come: online tests on the quiz engine with a question bank, and an exam schedule.
4. **Expenses and P&L-lite**: expenses by branch and head, against fee collections.
5. **Online admission form**: a hosted, embeddable form (with UTM capture) that makes a lead, optionally with an
   application fee through the same online payment.
6. **Lead scoring and routing**, then live-class links and assignments.

Each comes with a `scripts/<area>-test.ts`, as the rest of the system does.
