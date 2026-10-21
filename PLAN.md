# Institute SaaS: plan

A multi-tenant SaaS for coaching institutes, computer centres and training academies, grown from a clone of the
single-company "techcadd panel". The original (`D:\Techcadd-prpject-web-app\techcadd-panel`) runs a real institute
and is never edited, migrated or deployed from here. This clone has no git remote, its own database and its own
secrets.

Status keys: `[ ]` to do · `[~]` in progress · `[x]` done. Every phase ends with: typecheck, all suites green, a
`CHANGELOG.md` entry, a commit.

---

## Phase 0: the clone runs on its own

- [x] Clone the original without its remote. No `.env.local`, `deploy.env` or secrets copied.
- [x] Dev database moved to its own port and name (`127.0.0.1:5655/saas_dev`, CI `saas_ci`). The original's dev
      Postgres listens on 5544 on this machine, so the copied default would have pointed this clone at it.
- [x] Fresh `.env.local` with newly generated `AUTH_SECRET`, `CERT_SECRET` and `CRON_SECRET`.
- [x] Migrator: each migration file runs in its own transaction (`scripts/migrate-prod.mjs`, also used by
      `pnpm db:migrate`). Drizzle's migrator put all 94 files in one transaction, and a fresh database failed at
      0074: it used the enum value that 0067 added before 0067 had committed. The bookkeeping table stays drizzle's own.
- [x] Baseline: `pnpm test:all` green, and `pnpm test:e2e:full` passed all 56 steps (tests that leaned on the original's
      existing data fixed).
- [ ] Create the new GitHub repository (needs the owner: see "Decisions for the owner").

## Phase 1: multi-tenancy (nothing else starts until this is right)

### Design

**Hierarchy.** Platform → organisation (the tenant: one institute) → branches → staff and students.

**The boundary lives in the database.** Every tenant table gets `org_id uuid NOT NULL DEFAULT app_org()`, which
references `organisations`. The default means existing insert code needs no change: a row is stamped with the org
of the transaction it is written in, and an insert outside any org fails on NOT NULL. Every tenant table also gets
one RESTRICTIVE policy:

```sql
CREATE POLICY org_guard ON <t> AS RESTRICTIVE FOR ALL
  USING (org_id = app_org()) WITH CHECK (org_id = app_org());
```

PostgreSQL ANDs restrictive policies with the permissive ones. So the existing 258 branch policies stay as they are,
and in effect become `org_id = app_org() AND (existing branch rule)`. `app_org()` is NULL when no org is set, and then
no rows are visible. There is no bypass flag: even "system" work names an org.

**Cross-org references.** A foreign-key check ignores RLS. A row of org A could point at a row of org B if someone
knew its UUID (for example a `batch_id` sent in a form). So every foreign key between tenant tables gets a companion
composite key, `(org_id, col) → parent(org_id, id)`, with the same ON DELETE action (`SET NULL (col)` keeps
`org_id`). The parents get `UNIQUE (org_id, id)`. A DO block in the migration generates these from `pg_constraint`,
which covers all 221 keys. They are named `*_orgfk` / `*_org_id_uq`. `test:schema` skips that naming convention,
and `test:tenancy` checks that every key has its companion.

**Uniqueness is per org.** The unique indexes on business keys get `org_id` as their first column: user e-mail,
branch code, `reg_no`, `receipt_no`, `cert_no`, `enquiry_no`, ticket number, course and department names, lookups,
lead categories, letter companies, WhatsApp campaigns and the rest. The keys that must stay globally unique are
`api_keys.key_hash`, `certificates.verification_hash`, `events.token`, `event_participants.hash` and
`notifications.dedupe_key`. A public link carries one of these, and the host's org must still match it.

**Global sequences become per-org counters.** `support_ticket_seq`, `help_request_seq` and `event_cert_seq` move
into `org_sequences (org_id, kind, period)` (migration 0097), minted only through `app_org_seq()`. Branch counters
stay in `number_sequences`.

**Database context.** `withTenant(actor)` also sets `app.org_id` and `app.read_only`. These functions replace
`withSystem` (64 call sites):
- `withOrgSystem(orgId, fn)`: background and pre-auth work inside one org, with head-office visibility in that org
  only.
- `withPlatform(fn)`: platform tables only. Tenant tables show nothing, because `app_org()` is NULL.
- `ownerDb` remains only for TRUNCATE and purge, and those now filter by org.

Jobs loop over the active orgs through `withPlatform`, then run each org through `withOrgSystem`.

**Read-only orgs.** Restrictive policies on INSERT, UPDATE and DELETE check `NOT app_read_only()`. One mechanism
then covers two things: a dunning org (Phase 2) and a read-only support session.

**Platform tables (no `org_id`):**
- `organisations`
- `org_domains`
- `plans`
- `platform_users`
- `platform_config`
- `support_sessions` (also readable by the org it concerns)
- `ip_geo` (a cache)
- the drizzle bookkeeping table

Everything else is tenant data, including `app_config` (now per-org e-mail, WhatsApp, SMS, reminder and job
settings), `roles`, `lookups`, `login_attempts`, `login_locks`, `ip_rules`, `revoked_sessions` and `job_runs`.

**Roles.** The `super_admin` key stays, kind `super`, shown as **"Institute Admin (head office)"**. It is the org's
head office and nothing more: `app.is_super` now only means "every branch of this org". Renaming the key would touch
about 208 sites for no gain. The org owner is `organisations.owner_user_id`. Roles are per org (`PRIMARY KEY (org_id,
key)`) and are seeded from `DEFAULT_ROLES` when an org is created. Permissions stay `resource:action`.

**Platform admins** are separate people in `platform_users`:
- They sign in at `admin.<root>` with their own cookie and JWT audience.
- They have no tenant actor, so they can never read a student by default.
- Support access goes through `support_sessions`: a reason, a read-only or write mode, at most 60 minutes, ended by
  either side.
- It is shown to the org's admins and written to their audit log (`audit_logs.impersonator_id`).

**Resolving the org of a request** (`lib/tenant/host.ts`), checked in this order:
1. `<slug>.<ROOT_DOMAIN>`.
2. A verified row in `org_domains`.
3. In development, `<slug>.localhost`.

The proxy resolves the host. The session JWT carries `org`, and a session is accepted only on its own org's host.
The apex domain serves the marketing site (Phase 2) and a "find my institute" page that e-mails the workspace links.
Public routes (`/verify`, `/e/<token>`, receipt verification) resolve the org from the host and look tokens up inside
that org only. Certificate hashes include `org_id`.

**Secrets per org.**
- `seal`/`unseal` derive the key from `AUTH_SECRET`, the purpose and the org id. One org's ciphertext cannot be
  opened as another's.
- SMTP, WhatsApp, SMS, payment-gateway and webhook secrets live in the org's `app_config`.
- The env variables only describe the platform's own fallback mailer.

### Tasks

1. [x] **1.1 Migration `0094_organisations`**:
   - Create `organisations` (name, slug, status `trial|active|past_due|read_only|suspended|cancelled`, plan_key,
     trial_ends_at, branding jsonb, locale, timezone, currency, country, gstin, pan, legal_name, address,
     numbering jsonb, owner_user_id, created_at), `org_domains`, `platform_users`, `platform_config`,
     `support_sessions` and `plans`.
   - Add the functions `app_org()`, `app_read_only()`, `app_is_platform()` and `resolve_org(host)`, the last a
     SECURITY DEFINER that returns only the id and status.
   - Create the "Sample Institute" org that the backfill uses.
2. [x] **1.2 Migration `0095_org_id_everywhere`**: for every tenant table, generated with an audited list:
   - add `org_id`, backfill it to the sample org, set NOT NULL and the DEFAULT, and add an index;
   - add the RESTRICTIVE `org_guard` and the read-only write guards;
   - add the composite foreign keys and the per-org unique indexes;
   - `roles` PK `(org_id, key)` with `user_roles` following it; `number_sequences` re-keyed; `app_config` PK
     `(org_id, key)`;
   - replace the global sequences;
   - make the views (`v_*`) `security_invoker` so RLS applies through them.
3. [x] **1.3 Drizzle schema**: `org_id` on every table, the new tables, a `test:schema` convention for the generated
   constraints, and green.
4. [x] **1.4 DB context**:
   - `Actor.orgId`, plus `applyTenant` setting `app.org_id` and `app.read_only`;
   - `withOrgSystem`, `withPlatform`, removal of `withSystem`, and migration of its 64 call sites;
   - `ownerDb` purge and reset filter by org.
5. [x] **1.5 Auth and session**:
   - `org` in the JWT;
   - login, 2FA, reset and lockout scoped to the request's org; `getActor` checks that the session org matches the
     host org;
   - `lib/email-taken.ts` checks per org;
   - the acting-branch cookie must be a branch of the org (RLS already enforces this).
6. [x] **1.6 Host resolution**: `lib/tenant/host.ts`, the proxy, an `orgFromRequest()` helper, `ROOT_DOMAIN` and
   `PLATFORM_HOST` in `.env.example`, and per-org `appOrigin(org)` for links in e-mails and QR codes.
7. [x] **1.7 Public routes**:
   - `/verify` search, `/verify/[hash]`, the receipt verification, `/e/[token]`, `/e/c/[hash]`, the PDFs, the
     web-lead webhook (org from the key or host) and `/api/v1` (the API key names the org);
   - certificate hash v2 with `org_id`, while v1 hashes still verify in the sample org.
8. [x] **1.8 Jobs**:
   - the scheduler and `/api/jobs/*` loop over the active orgs;
   - per-org advisory lock keys, per-org `job_runs` and per-org alert e-mail;
   - webhook and message delivery per org.
9. [x] **1.9 Per-org settings and secrets**:
   - `lib/config/store.ts` keyed by org, with the cache keyed by org;
   - `lib/secret-box.ts` takes an org id;
   - providers built per org;
   - `lib/cache.ts` keys prefixed with the org id.
10. [x] **1.10 Per-org numbering**:
    - `organisations.numbering` holds the formats for enquiry, registration (a branch may still override),
      receipt, certificate, ticket, help request and event certificate; head office edits them in Settings →
      Numbering;
    - one renderer (`lib/number-format.ts`) with the tokens `{BRANCH}`/`{code}`, `{YYYY}`/`{yyyy}`, `{yy}`, `{FY}`,
      `{n}` and `{nnnn}`;
    - org-wide counters in `org_sequences`, minted only by `app_org_seq()`; the global sequences are gone.
11. [x] **1.11 Roles per org**: seed on org creation (`modules/orgs/provision.ts`), and the Roles screen shows the
    org's roles. `pnpm org:create` makes an institute from the command line.
12. [x] **1.12 Platform admin core**:
    - `platform_users` login at the platform host (`pnpm platform:user` adds one);
    - an organisations list (search, status, sizes only) with suspend, read-only and reactivate;
    - support sessions with an audit trail, and a banner in the org's panel while one is open.
    (The rest of the console is in Phase 2.)
13. [x] **1.13 `pnpm test:tenancy`**:
    - **Catalogue checks**: every table is either tenant or on the platform allow-list; a tenant table has `org_id`
      NOT NULL with the default, RLS enabled and forced, the restrictive `org_guard` and the write guards; every
      foreign key into a tenant table has its org companion; unique indexes lead with `org_id` unless on the global
      allow-list; no sequence is shared.
    - **Data checks**: two orgs fully seeded through the services. For every table, org A's head office sees none of
      B's rows; UPDATE and DELETE of B's ids change 0 rows; an INSERT stamped with B's org fails; an INSERT that
      points at B's parent ids fails; a read-only org cannot write.
    - **Code checks**: every server action and route file authenticates through `getActor` or a named public
      resolver. A static scan finds no raw `db` or `pool` and no `withPlatform` that touches tenant tables.
    - **HTTP checks** (in e2e): a session from org A on org B's host is refused, and B's receipt, document,
      certificate, event and API URLs answer 404 to A.
14. [x] **1.14** Extend `db:test` (RLS), `test:rbac` (roles per org, no grant across orgs) and `test:security`
    (host spoofing, session replay across orgs, secret-box across orgs). Update the e2e for subdomain hosts.

### Risks

- **A missed `withSystem` call site.** It would run with no org and see nothing. That fails loudly, not open. The
  static scan in `test:tenancy` lists the stragglers.
- **The migration that changes `roles` and `user_roles`.** It touches the RLS helper functions (`app_has_perm`
  reads `roles`), so each helper must also filter by `app_org()`.
- **Views.** `v_dues`, `v_fee_balance` and the others run as their owner unless they are `security_invoker`. Without
  it the views could leak across orgs. Test them explicitly.
- **SECURITY DEFINER functions** (`app_my_leads`, `app_own_students`, `branch_options`, …) skip RLS. Each one needs
  an explicit `org_id = app_org()`. Audit them all.
- **Custom domains** need a TLS certificate per domain. Coolify/Traefik can issue them on demand. Domain
  verification uses a DNS TXT record.
- **Cookies across subdomains.** The session cookie stays host-only (no `Domain=`), so one org's cookie is never sent
  to another org.

## Phase 2: sign-up, onboarding, plans and billing

1. [x] Marketing site on the apex domain: home, features, pricing (reads `plans`), FAQ, contact, terms, privacy,
   refund policy, status, and a docs/blog index. Built from the current `/support` landing page.
2. [x] Self sign-up:
   - institute name, owner name, e-mail and mobile, then an e-mail OTP;
   - the org is provisioned (roles, settings defaults, sample lookups) on a 14-day trial;
   - the owner lands on `<slug>.<root>`.
   - Abuse controls: rate limits, a disposable-mail block-list, a slug block-list.
3. [x] Onboarding wizard with resumable steps stored on the org:
   1. branding;
   2. first branch and its number formats;
   3. departments and courses from template catalogues (`lib/catalogues/*.ts`: computer, CAD, digital marketing,
      spoken English, IELTS, school tuition);
   4. fee modes and GST;
   5. invite staff;
   6. e-mail sender;
   7. CSV import with column mapping (generalised from `modules/import/oldsystem.ts`). **Still to do:** Set Up links to
      the existing import for now;
   8. a "you're ready" checklist.
4. [x] Plans and limits:
   - `plans` holds limits for branches, seats, active students, storage, monthly messages and a module list;
   - `lib/plan/limits.ts` has `assertWithinLimit(tx, org, 'branches')` in the services, plus upgrade prompts;
   - module gating joins `lib/panel/modules.ts`;
   - add-ons and credit packs. **Still to do.**
5. [x] Billing (Razorpay Payment Links; card/UPI mandates for automatic renewal and Stripe are still to do):
   - `modules/billing` with providers behind one interface: Razorpay (Subscriptions with UPI/card mandates, Orders)
     and Stripe;
   - `subscriptions`, `invoices` (GST tax invoice, gapless platform series), `payments_platform` and `coupons`;
   - webhooks verified by signature, idempotent by event id;
   - proration and monthly/yearly plans;
   - dunning: grace period (7 days) → `read_only` → `suspended`;
   - an invoice history page.
6. [x] Platform console (global message templates are still to do):
   - organisations, including usage and health;
   - MRR, churn and trial conversion;
   - plans and coupons;
   - announcements to orgs, feature flags per org, global message templates, system jobs and alerts.

## Phase 3: nothing techcadd-specific

The inventory (138 places in 9 groups) was made on 2026-10-19. Its notes are kept in `docs/rebrand-inventory.md`
(written at the start of Phase 3).
1. [ ] Branding per org (`organisations.branding`: logo, colours, legal name, tagline, accreditations image,
   signature):
   - the CSS variables come from the org;
   - the e-mail layout, receipt, ID card, verify pages and login are themed.
2. [ ] Course and project certificates are drawn by the canvas designer. The current layouts become two built-in
   neutral templates.
3. [ ] Letters:
   - companies, letterhead and stamp become org data;
   - the standard letter texts lose their fixed details;
   - the HR contact comes from the org.
4. [ ] WhatsApp template names, e-mail subjects and sign-offs come from the org's name. Hard-coded `techcadd`
   prefixes and regex strips go.
5. [ ] ID-card terms, campuses and contacts, plus the receipt policy wording, become org settings with neutral
   defaults.
6. [ ] Seeds:
   - the branch, letter-company and lookup inserts in migrations 0023, 0024 and 0089 are scoped to the sample org
     only;
   - the demo seed becomes "Sample Institute";
   - webhook headers become `X-Signature`/`X-Event`.
7. [ ] Tests that assert techcadd values are updated to the neutral defaults.

## Phase 4: new features (in this order, each with a `scripts/<area>-test.ts` and e2e steps)

1. Online admission form and lead capture (hosted and embeddable, UTM capture).
2. Lead integrations:
   - Meta Lead Ads, Google Ads lead forms;
   - JustDial / Sulekha mail parsing;
   - Exotel / Knowlarity missed calls;
   - duplicate merge across sources.
3. Online fee payment:
   - [x] a Razorpay Payment Link on the amount due now, from the student portal (the institute's own account);
   - [x] auto-reconciliation into the ledger and receipt (return and webhook, recorded once);
   - [ ] a payment link the office sends by WhatsApp / e-mail; optional partial payments and a convenience fee.
4. Parent / guardian portal.
5. Exams and results:
   - the exam schedule, marks entry, grade rules and report-card PDFs;
   - online MCQ tests using the events quiz engine;
   - rank lists.
6. LMS:
   - content by syllabus topic (YouTube, Vimeo, Bunny, PDFs and links) and progress;
   - assignments and submissions, with trainer feedback.
7. Timetable and rooms with clash detection, and class reminders.
8. Live classes (Meet / Zoom links; attendance from the join list where the API allows).
9. HR lite:
   - staff attendance (web and mobile, with a geo-fence);
   - leave;
   - salary sheet export.
10. Expenses and petty cash, with a P&L-lite report.
11. Inventory lite (kits, books, ID-card stock).
12. Placement cell (companies, drives, applications, offers, a report).
13. Alumni and referrals (codes, rewards given as discounts).
14. Communication centre:
    - a two-way WhatsApp inbox (Meta Cloud API) and saved replies;
    - campaign analytics, opt-outs and scheduled sends.
15. Analytics:
    - the funnel, cohort retention, collection forecast and a branch league table;
    - opt-in AI lead scoring (`claude-haiku-5-5` for classification, `claude-sonnet-5-5` for next best action), with
      minimal personal data.
16. Accounting export (Tally XML, Zoho / QuickBooks CSV, GST B2C summary).
17. PWA:
    - installable;
    - offline attendance queue;
    - push notifications.
18. i18n: English, Hindi and Punjabi catalogues, with per-org date and number formats.
19. Public API v2 per org, with OpenAPI docs, an API-key UI and a webhook catalogue.

## Phase 5: production readiness

- **Security:**
  - org-level 2FA enforcement;
  - Google and Microsoft SSO (Enterprise);
  - IP allow-lists per org;
  - a security review with cross-org access first;
  - `pnpm audit` and gitleaks in CI.
- **DPDP:**
  - consent text on public forms;
  - data export per student and per org;
  - deletion requests and a retention policy;
  - a processor agreement;
  - Aadhaar masked in the UI.
- **Files:**
  - R2 (S3 API) with signed URLs;
  - per-org quotas;
  - ClamAV scanning;
  - moving files out of the `bytea` columns.
- **Scale:**
  - BullMQ jobs, per org and idempotent;
  - pagination everywhere;
  - an `EXPLAIN` review of the indexes, which all start with `org_id`;
  - org-keyed caching.
- **Ops:**
  - the Dockerfile with staging and production;
  - migrations on deploy;
  - health checks and structured logs;
  - Sentry, uptime checks, daily backups with a restore test;
  - a status page and a changelog visible to orgs.
- **Docs:**
  - admin, staff and student guides;
  - the API docs;
  - a "migrating from your old software" guide;
  - `HANDOVER.md`.

## Decisions for the owner (defaults used until told otherwise)

| Question | Default |
|---|---|
| Product name and root domain | `ROOT_DOMAIN` env. Copy says "Institute SaaS" until a name is chosen. |
| New GitHub repository | Not created. Commits stay local until a repo URL is given. |
| Hosting | Coolify (same stack as the original), with a separate app, database and Redis. |
| Billing provider first | Razorpay. Stripe is behind the same interface. |
| Platform's GST details for invoices | Placeholders in `platform_config`. |

## Progress notes (Phase 1)

**Done in the first tenancy commit:**
- 0094: organisations and the platform tables.
- 0095: `org_id`, the RESTRICTIVE `org_guard`, the read-only guards, 221 org companion foreign keys, per-org unique
  keys, and the SECURITY DEFINER helpers filtered by org.
- 0096: `ip_geo` becomes a platform cache.
- `withSystem` is gone. Its replacements are `withOrgSystem(orgId)` and `withPlatform()`, plus `txOrg(tx)` for
  services that only have a transaction.
- Sessions carry their org. The proxy and `getActor` refuse a session on another org's host.
- Settings, secrets (sealed per org), providers and Aadhaar numbers are per org.
- Jobs run per org, in the org's own time zone.
- Public pages, the read API and the website-lead webhook resolve the org from the host.
- The data-reset module was removed: it TRUNCATEd every table, which would wipe every institute.

**Done in the second tenancy commit (closes 1.6, 1.7 and 1.9):**
- `appOrigin(orgId)`: the org's verified custom domain, else `<slug>.<ROOT_DOMAIN>`, for every link in e-mails, receipts
  and QR codes.
- Certificate hash v2 with `org_id`; v1 hashes verify in the sample org only.
- `lib/cache.ts`: every entry belongs to one org, and a write empties only its org.
- Settings → Integrations shows the website-form address and the org's secret (audited).

**Done in the third tenancy commit (1.10):**
- Settings → Numbering: the org's formats for all seven kinds of number, with a live preview; blank means default.
- Receipts must hold the branch and `{FY}` and end with the number, so they stay gapless per financial year.
- Tickets, help requests and event certificates count per org (`org_sequences`); the Sample Institute carries on
  its old series.

**Done in the fourth tenancy commit (1.11, 1.12):**
- `provisionOrg`: one transaction makes the org, its roles (from `DEFAULT_ROLES`), the standard lists, a first branch
  and the owner's head-office login (a temporary password). The head-office role is now called "Institute Admin".
- The platform console at `admin.<root>`: its own cookie and token audience; `/platform/*` is 404 on every
  institute's address.
- Support sessions: reason, read or write, at most 60 minutes, one open per org. A one-time link (5 minutes) signs
  the platform admin in as the org's owner, marked as support; `getActor` checks the session is open on every
  request; read-only is enforced by the database; audit rows carry `impersonator_id` and `support_session_id`.
  The org's head office sees a banner and can end it.

**Done in the fifth tenancy commit (1.13, 1.14): Phase 1 is complete.**
- `pnpm test:tenancy`: the catalogue (tenant/platform classification, `org_id`, RLS forced, the org guard and
  read-only guards, the org companion of every foreign key, unique keys, sequences, SECURITY DEFINER functions,
  views), the data (another institute seen from each side in every table and view; cross-org writes refused), and
  the code (every route and server action signs the caller in or is a named public one; raw DB handles and
  `withPlatform` only in audited files). Each catalogue check was shown to fail on a deliberate breakage.
- `test:security`: host spoofing, a session never fits another institute's host or the console, sealed secrets and
  Aadhaar across institutes, unverified custom domains.
- `test:orgs`: the database's permission check reads the institute's own role definition.
- e2e: a session, receipt and certificate of one institute do nothing on another's address.

**Next:** Phase 2 (sign-up, onboarding, plans and billing), once the owner has looked at the decisions below.
