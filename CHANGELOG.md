# Changelog

Newest first. One entry per phase or task; the plan and its status live in `PLAN.md`.

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

