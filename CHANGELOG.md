# Changelog

Newest first. One entry per phase or task; the plan and its status live in `PLAN.md`.

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

