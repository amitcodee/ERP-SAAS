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

