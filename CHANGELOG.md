# Changelog

Newest first. One entry per phase or task; the plan and its status live in `PLAN.md`.

## The public site redone in a clean business-software look, starting from sign-up (2026-10-26)

- Modelled on odoo.com's style (not its brand), in a yellow palette: white pages and light grey bands, big near-black
  Inter headings, a warm yellow brand colour (#ffc21a, near-black text on it; deep amber #a36500 for coloured words on
  white), teal only for small ticks and the handwritten notes, a yellow brush stroke under the words that matter,
  handwritten notes with a curved arrow (Caveat), yellow / light-grey buttons, a dark footer.
- **Sign-up** (also the code and "find my institute" pages): a plain top bar, a grey page, the steps (details → e-mail
  code → set up), a centred heading, the form in one white card in numbered sections (your institute, your login, plan
  after the trial), the full web address shown under the field as it is typed and checked, the password with Show /
  Hide and a strength meter, and under the card every app the trial opens as a tile grid.
- **Home**: a centred hero ("All your institute on one platform", "Start now – It's free" / "Talk to us", a handwritten
  note on the free trial), a grid of 18 colourful app tiles (`APPS` in components/site/content.ts), who it is for,
  alternating feature rows with screen pictures on soft colour panels, the feature grid, integrations, safety (dark),
  three steps, FAQ, a yellow closing band with a black button. The top bar: Apps, Pricing, Guides, Help, Contact, Sign in, "Try it free".
- Inner pages get a grey heading band; FAQ and guides are centred open/close lists; pricing and features restyled.
- Checked at 1440px and 390px (no sideways scroll, nothing clipped).

## The public site's new look (2026-10-24)

- The platform's public site (home, features, pricing, FAQ, sign-up and the rest) has a fresh, light look: a green
  offer line, Inter type, one green colour for every call to action with black outlined second buttons, a centred hero
  with a two-tone headline and a dashboard picture with floating cards, a strip of the kinds of institutes it is for,
  four alternating rows (enquiries, fees, classes, certificates) each with a small picture of the screen, the feature
  grid, "safe by design", three steps to start, the top questions and a green closing band; a dark footer.
  (`components/site/site-theme.ts`, scoped to the public site; an institute's own home page keeps its look.)
- More, after looking at other SaaS sites: a big scrolling word band under the hero; "Everything around your
  student" with the day's work in an orbit round a student; "Works with what you already use" (WhatsApp, Razorpay,
  Excel & Google Sheets, your own e-mail, SMS, webhooks for n8n / Zapier / Make, the read API, the website form: only
  what the product really connects to); Features opens with three tabs (before they join, while they study, after the
  course); Pricing gets a Monthly / Yearly switch, "Most popular", what every plan includes, the questions about
  paying and a closing band ("1 branch", not "1 branches").
- The FAQ's text lives in `components/site/content.ts` (shown on the home page too) and says students, enquiries and
  staff can be imported from a spreadsheet at any time.

## Phase 4 (3, the rest): a payment link the office sends (2026-10-24)

- **Fees → a student → Payment link** (whoever takes fees, when online payment is on): a payment page for the next
  installment or any part of the balance, copied, sent on WhatsApp (to the student's number) or e-mailed from the
  branch's mailbox. The payment is recorded with its receipt by itself, as for the portal's Pay online; whoever pays
  lands on a thank-you page naming the receipt. Migration 0123 (`fee_payment_links.via` may be `office`).
- Fix: the way back from a payment page with a question mark of its own now builds a correct address; a link sent in a
  message is always a full address (the test provider gave a relative one).
- e2e: switches online payment on, makes a ₹2,000 link from a student's fees and checks the WhatsApp message; the
  certificate-template colour check waits for the thumbnails to draw.
- Checks in `scripts/online-pay-test.ts`. Not done: a convenience fee on top.

## Phase 6 (part 11): customised courses at franchises; a new institute's brand checked end to end (2026-10-24)

- **Franchises → Course fees at franchises** has a "Customised course" line per department: the lowest and highest a
  franchise may charge for a course of its own (its own title, no course from the list) in that department. Checked
  like a course's range. Migration 0122.
- The browser test now sets a new institute's printed name and colour in Set Up and checks them on its panel, its
  sign-in page and its certificate templates.
- Checks in `scripts/franchise-test.ts`.

## Phase 6 (part 10): zones above branches (2026-10-24)

- **Branches → Zones** (head office, once there are two branches): name zones (regions), put branches in them, and
  give each zone its managers. A zonal manager keeps their own login and home branch and works in every branch of the
  zone with full access, as their role allows (picked from the sidebar like any shared branch). Taking a branch out,
  the manager off, or deleting the zone removes only what the zone gave; a branch head office had shared with them by
  hand keeps the access it had. Migration 0121 (`zones`, `zone_managers`, `branches.zone_id`, `user_branches.via_zone`).
- `scripts/zones-test.ts` (in `test:all`); e2e adds a zone and a branch to it.

## Phase 6 (part 9): big discounts approved by head office (2026-10-24)

- **Settings → Business rules → "Discount: above this % of the fee, head office approves it"** (100 = never, the
  default, so nothing changes until an institute sets it). A discount above it from anyone but head office is not
  given at once: it goes to head office as a request on Fees ("Above the discount limit: head office decides"), and
  accounts cannot decide it. Cutting the total fees that far is refused too (give it as a discount instead). Head
  office's own discounts are not held. Migration 0120.
- Checks in `scripts/fees-test.ts`; e2e sees the rule.

## Phase 6 (part 8): a batch's certificates at once (2026-10-24)

- **Issue Certificate → Batch** narrows the list (and Certificate Requests) to one batch's students; **Issue all ready
  (N)** issues every certificate shown that can be issued now, each with the usual checks (fees, attendance, capstone,
  a franchise's certificates by head office). One that fails is named with its reason and the rest are issued; each
  student is told by e-mail / WhatsApp as with a single issue.
- Checks in `scripts/certificate-test.ts`.

## Phase 6 (part 7): import from a spreadsheet, any time (2026-10-24)

- **Setup → Import** (also Set Up's "Existing students" step): students, enquiries or staff of a branch from an Excel /
  Google Sheets file saved as CSV, whenever it is needed, not only while setting up. A template per kind, the columns
  explained, the usual other names understood ("Mobile No.", "Admission date", "Fee paid"…). **Check the file** runs
  everything and saves nothing, listing what would be added, what is already in and each row turned down with its
  reason (downloadable); **Import** then adds them. Running a file again only adds what is new.
- Students: no old registration number needed any more (a row without one is matched on phone, department and
  admission date); the paid amount is an opening balance, the next installment a due. Staff: their roles by name, a
  login each, e-mailed after the import (or shown once when mail is not set up; held until a new branch is activated);
  head-office roles cannot be given by a file.
- Head office picks the branch; branch staff import into their own, and only the kinds they may add on screen.
- The Old System Import page lost the original institute's table names and number formats from its help text; it is
  "Old system import" in the menu.
- Checks in `scripts/import-test.ts`; an e2e step imports a staff list.

## Phase 6 (part 6): franchise certificates by head office, templates in the institute's colour (2026-10-24)

- **Certificates at a franchise are issued by head office**, in the institute's name: the partner's centre requests
  them as usual (fees cleared by the partner), head office issues them from Issue Certificate (the branch column says
  "Franchise: you issue"); the centre sees "Waiting for head office to issue". Head office can let a franchise issue its
  own (Franchises → terms → "Head office issues its certificates"). The database enforces it too: at such a franchise
  only head office may write a certificate. Migration 0119.
- **Certificate templates start in the institute's colour**: each template's main colour becomes the brand colour (Set
  Up), in the gallery, on the canvas and when a design is started; the logo was already the institute's. Two new
  templates: **Internship** (a course certificate for internships and training programmes, with both signatures) and
  **Merit — quiz toppers** (an event certificate with the score).
- Checks in `scripts/franchise-test.ts` and `scripts/course-design-test.ts` (the franchise test now runs with the
  server conditions); e2e sees the franchise's certificate terms and the new templates.

## Phase 6 (part 5): inviting franchise partners, franchise fee ranges (2026-10-22)

- **Invite the partner** (Franchises → the send icon): their login goes to the e-mail in the franchise's terms. A new
  partner gets a branch-manager login at their centre (e-mailed with a one-time password; while the branch is not
  active it goes out when it is activated); inviting again before they have signed in sends a fresh password, after
  that it leaves their password alone; a partner who already runs another centre gets this one added to their login
  with full access, so one login covers all their centres.
- **Course fees at franchises** (Franchises, head office): the lowest and highest total fee (after discounts, with GST)
  a franchise may charge per course. Checked when a franchise registers a student, changes a total fee or gives a
  discount, with the range in the message; the institute's own centres are not bound. Migration 0118.
- More checks in `scripts/franchise-test.ts`; the e2e franchise step sees the fee table.

## Phase 6 (part 4): features by plan, your own domain, "how is your institute run?" (2026-10-22)

- **Features follow the plan.** The feature packs are plan modules (Console → Plans ticks them; the pricing page lists
  what sets plans apart). A pack outside the plan is not in the menu and shows in Settings → Features as "Not in your
  <plan> plan" with a link to the plans. During the trial (and while waiting for approval) everything is open.
  Migration 0116 gives every existing plan every pack, so nothing changed for paying institutes.
- **Your own domain** (Settings → Your domain, plans with the custom-domain module): add e.g. erp.acme.in, make a CNAME
  to the institute's address and a TXT record with its token, press Verify (the server looks the record up). Verified:
  the institute answers on it and its links use it. Hosting must still route the domain and issue its certificate.
- **Set Up asks how the institute is run**: one centre, several of its own, or own centres and franchises (which
  switches Franchises on), each with what to do next.
- Fix: an enquiry's history kept steps saved together in the right order (migration 0117: `clock_timestamp()`); the
  timeline could show them either way round.
- `scripts/domain-test.ts`; plan checks in `scripts/features-test.ts`.

## Phase 6 (part 3): franchises (2026-10-22)

- **A branch can be a franchise** (Branches → Make a franchise, or Franchises): the partner's legal name, owner, phone,
  e-mail, the agreement's dates and the royalty: a percent of the fees the centre receives, or a fixed amount a month.
  Migration 0115 (branch columns, `royalty_payments`, the `franchise` permission area).
- **Its receipts are the partner's**: the page and the PDF print the partner's legal name, the centre and "a franchise
  of <institute>", with the centre's own GSTIN.
- **Fees & money → Franchises**: each franchise's fees received, royalty and payments for a month, the balance owed to
  date, a 12-month statement, royalty payments recorded by head office (deleted softly). A franchise's own branch
  manager sees their centre's statement only; other branches see nothing (RLS). The page joins the menu by itself with
  the first franchise (a feature pack, off for new institutes until then).
- `scripts/franchise-test.ts`; e2e: a branch made a franchise (71 steps).

## Phase 6 (part 2): course certificates in your own design (2026-10-22)

- **Course certificates in the institute's own design.** Certificate Designs is on every plan (it was tied to the paid
  events module). Designs can print a course certificate's details ({{course}}, {{duration}}, {{reg_no}},
  {{father}}, {{joined}}, {{ended}}, {{tools}}, the signatories' titles) and place both signatures of Settings →
  Certificates; a new "Course completion" starting design has them all. Settings → Certificates → Course certificate
  design picks it; the certificate page and its PDF (portrait or landscape) draw with it, else the built-in layout
  (also when the chosen design is archived). Certificates already issued follow: they are drawn when opened.
- While an institute waits for approval its owner can also prepare certificate designs.
- The platform's admins get an e-mail for every new institute (with "waiting for your approval").
- Fixes: a browser-tab icon for every institute (its initials in its colour; the old icons had gone with the rebrand,
  so every page asked for missing files); designs of an institute without a logo show a "Your logo" box instead of a
  broken image; certificate dates read "30 Sep 2026" (the en-IN locale now writes "Sept").
- `scripts/course-design-test.ts`.

## Phase 6 (part 1): approval, a short trial, closed until paid; a simpler menu (2026-10-22)

- **The platform approves new institutes.** Console → Settings: "Wait for my approval" and the trial's length
  (default 2 days). A new institute waits (status `pending`, migration 0114): its owner can sign in, finish Set Up,
  add branches, courses and staff and choose or pay a plan; nothing else runs, staff and students are told it is being
  set up, the admission form is closed. Console → Organisations lists those waiting; Approve starts the trial (or makes
  it active when already paid) and e-mails the owner.
- **Closed until paid.** A trial or plan that ends closes the institute: head office sees only Plan & billing and its
  account, everyone else that it is paused; paying opens it at once; nothing is deleted.
- **The platform activates by hand**: until a date (it then runs like a paid period: reminder, grace, closed) or with no
  end (never billed); close, block, reject, extend a trial. The site's wording follows the trial's length.
- **A simpler menu.** Plain groups (Overview, Admissions, Students & classes, Fees & money, Certificates, Events, Reports,
  Setup, Security & records) and names (Enquiries, Calls, Find an enquiry, Import). Settings → Features switches extra
  packs on and off (calling team, website leads, trainers' classes, help desk, expenses, internships, letters, events,
  WhatsApp campaigns, import); a new institute starts with the core and four packs; older institutes keep everything.
  Transfers and shared students appear once there is a second branch.
- **One branch: no picking.** Head office of an institute with one branch works in it directly.
- Fixes: a new institute's dashboard no longer warns about jobs that have not run yet (nor names the platform's hosting);
  development links use the server's own port; the home page title no longer repeats the institute's name.
- `scripts/approval-test.ts`, `scripts/features-test.ts`; e2e: waiting for approval, approval in the console (70 steps).
  `E2E_PORT` runs the browser test on another port. `docs/product-review.md`: what is missing, in order.

## Phase 4 (part 5): the online admission form (2026-10-22)

- A public admission form on each institute's address (/apply): name, mobile, the centre, the course, and e-mail,
  area and a question when the institute asks for them. Settings → Admission form switches it on, words it and gives
  the link (for ads, social posts, a QR code) and one line of code for the institute's own website
  (/apply/embed.js places /apply/embed in a frame that sizes itself; only that page may be framed by other sites).
- Each form sent arrives as a website lead and becomes a Lead of the centre chosen (Web Leads: "chosen on the form"),
  thanked as usual. The ad or post it came from (utm_source / medium / campaign, gclid, fbclid, referrer) is kept,
  shown in Web Leads and written in the lead's history; on a website it is remembered for the visit.
  `?branch=CODE` / `data-branch` picks the centre already.
- Against robots: limits per connection and per institute, a signed ticket (not within 3 seconds, not after 12 hours)
  and a hidden field. `scripts/apply-test.ts`; three e2e steps (Settings, /apply, embedded in another site).

## Phase 4 (part 4): expenses and profit (2026-10-21)

- Management → Expenses: record what a branch spends (date, head, amount, paid to, how, note), and see the profit:
  fees received (payments that stand) less expenses, this month and the five before, with the month's spending by
  head. Head office sees every branch or one; a branch only its own (RLS); students never.
- A new permission area, Expenses (see, record, delete): head office and branch managers everything, accountants see
  and record. A deleted expense leaves the totals but stays on record with who deleted it.
- Migration 0113 (expenses; the permission added to the saved roles). `scripts/expenses-test.ts`.

## Phase 4 (part 3): report cards (2026-10-21)

- A printable A4 report card per registration (/registrations/<id>/report-card): every marked test and assignment
  with its percent and grade, the overall result (total marks over total maximums) with grade and pass / not yet,
  the rank in the student's batch (ties share a rank), what is still to be marked, attendance and the capstone.
- Opened from Students (the document icon) and by the student from their portal (Grades → My report card); the
  parents' page shows the overall result and grade.
- Each institute sets its grade bands and pass mark in Settings → Report cards (lib/grades.ts; standard A+ to E,
  pass at 40%). `scripts/report-card-test.ts`.

## Phase 4 (part 2): parents' links (2026-10-21)

- A parent or guardian gets a private link (/p/<token>), made by the office from Students (the people icon) and sent
  by WhatsApp in one click: the student's attendance, fees with receipts and Pay online, and marks, read-only, with no
  account. Only a hash of the token is kept; a new link stops the old one; the office can stop it; links last a year;
  openings are rate-limited and noted (last opened). After paying, a parent comes back to /p/done.
- Migration 0112 (parent_links; fee_payment_links.via). `scripts/parent-test.ts`.

## Phase 4 (part 1): online fee payment and absence alerts (2026-10-21)

- Students pay what is due now (the next installment, or the balance) from the portal, into the institute's own
  Razorpay account (Settings → Online payments: keys, webhook address, recent payments). The signed return and the
  signed webhook each record the payment once, through `recordPayment`, as "Online" with a receipt; a payment that no
  longer fits (paid at the desk meanwhile) is kept for the office to decide, never dropped. `scripts/online-pay-test.ts`.
- Absence alerts: a student marked absent in today's class sends "absent from today's class" to the guardian's
  WhatsApp (else the student's). A new kind of message, off until switched on (its template must be approved first).
- Migrations 0110 (fee_payment_links) and 0111 (its org companion keys).
- `docs/competitive-review.md`: what other institute platforms offer, and the order of what comes next.

## Phase 3: the rebrand (2026-10-21)

- The code is neutral; an institute's identity is its data (`docs/rebrand-inventory.md`).

## Phase 0: the clone runs on its own (2026-10-19)

- Cloned from the techcadd panel (263 commits of history kept). No remote, and nothing copied from the original's
  secrets, `.env.local`, `deploy.env`, database or hosting.
- Dev database on its own port and name (`127.0.0.1:5655/saas_dev`); CI database `saas_ci`. The original's dev
  database listens on 5544 on the same machine.
- Migrations: each file now runs in its own transaction (`scripts/migrate-prod.mjs`, also behind `pnpm db:migrate`).
  On a fresh database, drizzle's single transaction failed at 0074, which used an enum value 0067 had added in the
  same transaction. Bookkeeping stays in `drizzle.__drizzle_migrations`.
- `pnpm typecheck` runs `next typegen` first, so a fresh checkout has the generated route types (`RouteContext`).
- Tests that leaned on the original's existing data now work on a fresh database:
  - `db:seed:demo` runs with the `react-server` condition, and payments are taken by the branch manager (accountants
    check fees, they do not take them);
  - the import test uses its own branch code instead of `HSP`, which migration 0023 already seeds;
  - the e2e checks the rebuilt landing page's wording.
- Baseline: `pnpm test:all` green; `pnpm test:e2e:full` passed all 56 steps on a production build.
- `PLAN.md`: phases 1–5 broken into tasks, the tenancy design, the risks, and the decisions waiting on the owner.

## Phase 1: multi-tenancy, part 1 (2026-10-19)

- **Organisations are the tenant.**
  - Migration 0094 adds `organisations`, plans, custom domains, platform users and settings, and support sessions.
  - Migration 0095 puts `org_id` on all 71 tenant tables. Existing rows belong to the "Sample Institute".
- **The database keeps institutes apart.**
  - A RESTRICTIVE policy on every tenant table means `org_id = app_org()` is ANDed with the existing branch rules.
    With no org set, nothing is visible.
  - Read-only guards refuse writes while an org is read-only.
  - Every foreign key has an `(org_id, col)` companion, so a row cannot point at another institute's row.
  - E-mails, branch codes and the registration, receipt and certificate numbers are unique per institute.
- **Code.**
  - `withTenant` sets the org.
  - `withSystem` is replaced by `withOrgSystem(orgId)` (one org, no user) and `withPlatform()` (platform tables only).
  - Sessions carry their org. The proxy and `getActor` sign out a session used on another institute's address.
  - Sign-in, reset links and two-step codes work inside the institute whose address they are on.
- **Settings and secrets are per institute.**
  - E-mail, WhatsApp, SMS, reminders and jobs settings are per institute. Secrets are sealed with a per-org key, and
    so are Aadhaar numbers.
  - WhatsApp and SMS no longer fall back to the server's environment. E-mail falls back to the platform's mailer.
- **Background jobs** run once per institute, in its own time zone, with their own run log and alerts.
- **Public pages** (certificate and receipt verification, events, the read API, website leads) look things up only in
  the institute whose address they are on.
- **Removed:** the unused "reset all data" module, which TRUNCATEd every table across every institute.
- **Development:** `DEFAULT_ORG_SLUG=sample` makes `localhost` the sample institute's workspace.
- **Tests:** `test:all` green (998 checks); e2e 56/56 on a production build.

## Phase 1: multi-tenancy, part 2 (2026-10-20)

- **Links carry the institute's own address.** `appOrigin(orgId)` gives the org's verified custom domain, else
  `https://<slug>.<ROOT_DOMAIN>`. It is used for links in e-mails (logins, reset links, certificates, help requests,
  escalations), receipts, QR codes, ID cards and event posters. The request's host is never used in production.
  Without `ROOT_DOMAIN`, the default org is at `APP_URL`, and in development the others are at `<slug>.localhost`.
- **Certificate hash v2** includes the org id, so a hash made for one institute never verifies as another's.
  Hashes from before organisations (v1) still verify, in the Sample Institute only.
- **The shared cache is per institute.** Every entry belongs to one org. A write empties only its org's entries; a
  platform write empties them all. Before this, the course and source lists (`catalogs`) and the head-office setup
  figures were one entry for every institute.
- **Website forms in Settings → Integrations.** Head office sees the address to post leads to and can show the
  institute's own secret. Each look goes in the audit log.
- **Tests:** `test:all` green (1005 checks).

## Phase 1: multi-tenancy, part 3: numbering (2026-10-20)

- **Number formats per institute** (Settings → Numbering, head office): enquiry, registration, receipt,
  certificate, support ticket, help request and event certificate. The screen previews the next number as you type;
  blank means the default, which is today's format.
  - Tokens: `{n}`, `{nnnn}` (one n per digit), `{yyyy}`/`{YYYY}`, `{yy}`/`{YY}`, `{FY}`, `{code}`/`{BRANCH}`. A
    year in the format restarts the count each year, `{FY}` each financial year.
  - Branch-counted numbers must name the branch; org-counted ones must not. Receipts must hold `{FY}` and end with
    the number, so they stay gapless per financial year.
  - A branch's own registration format (Branches) still comes first for that branch.
  - Each change goes in the audit log.
- **Per-institute counters.** Tickets, help requests and event certificates used global sequences, shared by every
  institute. Migration 0097 moves them to `org_sequences`, minted only by `app_org_seq()` in the transaction's own
  institute (never while it is read-only). The Sample Institute carries on its series; event certificate numbers now
  restart each year, as their format holds the year.
- The certificate search on `/verify` finds event certificates whatever their format.
- The reconciliation's receipt check reads the financial year from anywhere in the number.
- The e2e run now leaves the dev admin on the seed password, so `test:auth` passes after it.
- **Tests:** new `test:numbering` (29 checks); `test:all` green (1034 checks); e2e 56/56 on a production build.

## Phase 1: multi-tenancy, part 4: new institutes and the platform console (2026-10-20)

- **New institutes** (`modules/orgs/provision.ts`, and `pnpm org:create` from the command line). One transaction
  makes the org on a 14-day trial, its roles from the defaults, the standard lists (sources, payment and class
  modes, …), a first branch (MAIN) and the owner's head-office login with a temporary password.
- **Roles are per institute.** Changing or adding a role in one institute never touches another's, and a person can
  only hold their own institute's roles (tested). The head-office role is now called "Institute Admin"; migration
  0098 renames it where an institute had not renamed it.
- **The platform console** at `admin.<root>` (`admin.localhost` in development):
  - the platform's own team signs in there, with its own cookie (`pnpm platform:user` adds someone);
  - the institutes list shows status, plan and sizes only (branches, logins, active students, receipts this
    month, last sign-in), never a record;
  - suspend, make read-only or reactivate, with a reason that goes in the institute's own audit log;
  - `/platform/*` does not exist on an institute's address.
- **Support sessions.** A platform admin opens one with a reason, read-only or with changes, for at most an hour.
  A one-time link signs them in to the institute as its head office, marked as support. Every request checks that
  the session is still open, read-only is enforced by the database, and everything they do is in the institute's
  audit log with their name (`audit_logs.impersonator_id`, `support_session_id`, migration 0099). The institute's
  head office sees a banner and can end the session at once.
- The host cache moved to `lib/tenant/resolve.ts` (no request APIs), so scripts can provision institutes.
- Migration 0100 gives orgs from before organisations an owner (their first head-office login), and the seed sets
  it on a fresh database: a support session works as the owner.
- Console server actions redirect to the console's own routes: a server action's redirect renders without the
  proxy's rewrite, so `redirect('/')` showed the institute landing page on the platform host.
- **Tests:** new `test:orgs` (17 checks) and `test:platform` (24 checks); `test:all` green (1075 checks); e2e 59/59
  on a production build, with the console and a support session in the browser.

## Phase 1: multi-tenancy, part 5: the boundary, tested (2026-10-20)

- **`pnpm test:tenancy`** (26 checks), in three parts:
  - **The catalogue:** every table is tenant or platform; each tenant table has `org_id` NOT NULL DEFAULT
    `app_org()`, RLS on and forced, the restrictive org guard and the read-only guards. Every foreign key between
    tenant tables has its org companion. Unique keys lead with `org_id` or a row id, or are listed as global on
    purpose. No business sequence is shared. Every SECURITY DEFINER function filters by org or is listed with its
    reason, and every view runs as its caller. Each check was shown to fail on a deliberate breakage.
  - **The data:** a second institute, made the real way. Neither side sees the other's rows in any table or
    view. Updates and deletes across the line change nothing. A row stamped with, pointing at or moved to another
    institute is refused. A read-only institute cannot write but keeps its audit trail.
  - **The code:** every route and server action signs the caller in or is a listed public one. Raw database
    handles and the platform context appear only in audited files.
- **`test:security`** adds: hosts cannot be spoofed by look-alike names; a session never fits another institute's
  host or the console; sealed settings secrets and Aadhaar numbers do not open for another institute or purpose; an
  unverified custom domain resolves to nobody. The proxy's rule is now `sessionFitsHost()` in `lib/tenant/host.ts`.
- **`test:orgs`** adds: the database's permission check reads the institute's own role definition, even for a role
  key another institute has given more rights.
- **e2e** adds: the sample institute's session, receipt and certificate links do nothing on another institute's
  address (the session goes to the sign-in page, the certificate is not found).
- **Tests:** `test:all` green (1110 checks); e2e 60/60 on a production build.

## Phase 2: the public site and self sign-up (2026-10-20)

- **The public site** on the apex domain (`www.localhost` in development), mapped onto `/site/*` by the proxy and
  absent on every institute's address. Pages: home, features, pricing (read from the `plans` table), FAQ, contact,
  terms, privacy, refunds, live status and guides. The product name, contacts and legal name come from
  `PRODUCT_NAME`, `SUPPORT_EMAIL`, `SALES_PHONE`, `PLATFORM_LEGAL_NAME` and `PLATFORM_ADDRESS` (default "Institute
  SaaS"), so the public site carries no institute's branding. The terms, privacy and refund pages are templates
  that match how the service works, marked for a lawyer's review.
- **Self sign-up** (`modules/signup`):
  - The visitor gives the institute's name and web address (checked as they type), their name, e-mail, mobile, a
    password and the plan they will take.
  - A 6-digit code is e-mailed. It is kept only as an HMAC, works for 15 minutes, allows 5 tries and up to 3 codes
    per sign-up.
  - Once confirmed, the institute is made on a 14-day trial of that plan with the owner's chosen password, and a
    one-time link (10 minutes) signs them in on the institute's own address.
  - Abuse controls: rate limits per connection and per e-mail, throw-away mailboxes refused, look-alike addresses
    (banks, government, big brands, payment providers) refused, and an address waiting for its code is not offered
    to anyone else.
  - Migration 0101 adds `signups` (a platform table).
- **Find my institute:** a visitor gives an e-mail and gets the sign-in link of every institute they have a login
  at, with the same answer whether or not there is one. `platform_orgs_for_email()` (migration 0102) returns ids
  only, to the platform only.
- `appOrigin` also works for a production build on this machine (the e2e run): other institutes are then at
  `<slug>.localhost`. A real server still needs `ROOT_DOMAIN`.
- The institute home page and the public site share their stylesheet and content (`components/site`).
- **Fixed: redirects from route handlers now stay on the visitor's host.** `req.url` in a route handler carries the
  server's own address, so `new URL(path, req.url)` sent someone on an institute's subdomain to the default host.
  Sign-out, the paper-slip download, the support link and the welcome link now redirect with a relative `Location`
  (`lib/http.ts`).
- **Tests:** new `test:signup` (26 checks); e2e adds the public site and a full sign-up in the browser.

## Phase 2: Set Up, the onboarding of a new institute (2026-10-20)

- **Set Up** (Administration → Set Up, head office) has seven steps:
  - your institute (name as printed, tagline, colour, logo);
  - first branch;
  - courses;
  - fees;
  - staff;
  - e-mail;
  - existing students.
- A step is ticked when the institute has really done it, read from its data, so work done on another screen
  counts. Head office can also mark a step done or skip it. The state lives in `organisations.onboarding`
  (migration 0103); institutes from before sign-up are marked set up.
- **Filled in on the page:**
  - branding goes in `organisations.branding` and `legal_name`;
  - ready-made course lists (`lib/catalogues.ts`: computer centre, CAD, digital marketing, spoken English,
    IELTS/PTE, school tuition), added in one click and never twice;
  - the institute's usual GST, which the registration form now starts with, and extra ways to pay.
- **On their own screens:** the branch, staff, e-mail and import steps open the screen that does them.
- New owners land on Set Up after signing up. Head office sees a reminder on every page until each step is settled
  or the list is hidden.
- **Tests:** new `test:onboarding` (18 checks); e2e adds landing on Set Up and adding a course list; `test:all`
  green (1154 checks); e2e 63/63.

## Phase 2: plans, limits and billing (2026-10-20)

- **Plans and limits** (`lib/plan/limits.ts`):
  - The plan's limits on branches, staff logins, active students, stored files and SMS/WhatsApp messages a month
    are checked where things are added: a new branch, a staff login, a registration, an uploaded document, a bulk
    WhatsApp send. A refusal says what the plan allows, what is in use, and where to upgrade.
  - Usage is counted for the whole institute, whoever asks, by `org_usage()` (migration 0104).
  - Paid modules are closed outside the plans that have them: seminars and workshops, certificate designs, the read
    API and webhooks. Their pages leave the menu, and the services and the API refuse them. During the trial every
    module is open, while the plan's limits apply from the start.
- **Billing** (`modules/billing`, migration 0105: `subscriptions`, `coupons`, `platform_payments`,
  `platform_invoices`, `platform_counters`, `billing_events`, all platform tables):
  - Settings → Plan & billing (head office) shows the plan and status, usage against the limits, and lets head
    office pay monthly or yearly, with an optional code. Paying for the same plan carries on from the end of the
    paid period; another plan starts now, with the unused part of the current period credited. GST is shown.
  - Payment is on Razorpay's hosted page (Payment Links), so no payment script runs in our pages. It is confirmed
    by the signed return and by the signed webhook (`/api/webhooks/razorpay`); each event is handled once, and each
    payment completes once whichever arrives first.
  - A completed payment moves the paid period on, opens an institute billing had closed, and issues a GST tax
    invoice. Invoices are numbered without gaps per financial year (INV/2026-27/00001), never changed once issued,
    with CGST + SGST or IGST by the institute's state. They can be printed or saved as PDF.
  - Head office can stop renewal at the end of the period.
  - Without Razorpay keys, outside production (or with `BILLING_FAKE=1`, which the e2e run sets) a test payment
    page stands in.
- **Dunning** (hourly in the scheduler, one instance at a time): a trial over with nothing paid becomes read-only.
  An unpaid period becomes past due (7 days' grace), then read-only, then suspended after 30 more days. A cancelled
  plan becomes read-only at the end of its period. Owners are e-mailed a week before renewal and at each change.
- The e2e runner keeps the server's log in `.e2e-out/server.log`, and refuses to start if its port is already in
  use (it would otherwise test that other server).
- **Tests:** new `test:plans` (13 checks) and `test:billing` (32 checks); e2e adds paying for a plan through the
  test payment page; `test:all` green (1199 checks); e2e 64/64.

## Phase 2: the rest of the platform console (2026-10-20)

- **The business at a glance** on the console's home page: institutes by status, MRR (before GST), paying
  institutes, trials ending this week, sign-ups in 30 days, trial-to-paid conversion over 90 days, institutes lost
  in 30 days. Each institute's failing daily jobs over the last week are shown too (`platform_job_health()`, counts
  only).
- **Plans:** prices, limits and modules, edited in the console. A change applies to the next payment.
- **Codes:** a percentage or an amount off, for some plans, until a date or a number of uses; switched on or off.
- **One institute:** change its plan, extend its trial, switch feature flags (`organisations.features`). Each
  change goes in the institute's own audit log under the platform admin.
- **Notices to institutes** (`platform_announcements`, migration 0106): shown at the top of every panel page while
  they run, to everyone or to the institutes on some plans. They are ended, never deleted.
- Fixed: text arrays are sent to the database as JSON (drizzle spreads a JS array into separate parameters).
- **Tests:** new `test:console` (14 checks); e2e adds the console's metrics and plans; `test:all` green (1213
  checks); e2e 65/65.

