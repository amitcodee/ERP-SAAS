# Product review: the institute SaaS, as a new customer meets it

Written 2026-10-22 after signing up as new institutes ("Sunrise Computer Academy", "PM Academy") and using the panel
as their owner, reading the code behind each screen, and comparing with what the owner asked for:

> Anyone signs up, sets up their brand, institute, branches, staff and franchises, makes their own certificate
> templates, and every small and big institute can use it. I approve each institute; the trial is 2 days; after it
> the account closes until they pay, or I activate it myself. Features follow the plan; the trial shows everything.

Status keys: **done** (built and tested this round), **next** (planned, in order), **later**.

## 1. Signing up and staying open

| What | State |
|---|---|
| Self sign-up on the public site, e-mailed code, own address | was there |
| The platform approves each new institute (Console → Settings → "Wait for my approval"; Organisations → "Waiting for your approval") | **done** |
| While waiting: owner signs in, finishes Set Up, branches, courses, staff, chooses and pays a plan; nothing else runs; staff and students see "being set up"; the public admission form is closed | **done** |
| Trial length set by the platform (default 2 days), starting when approved | **done** |
| Trial or plan over: closed until paid (owner sees only Plan & billing; staff and students see "paused"); paying opens it at once; nothing is deleted | **done** |
| The platform activates an institute by hand: until a date (bank transfer, cash) or with no end (partners), closes, blocks, rejects, extends a trial | **done** |
| The owner gets an e-mail when approved | **done** |
| The platform gets an e-mail when someone signs up | next |
| The site's trial wording follows the platform's setting (home, pricing, sign-up, FAQ) | **done** |

## 2. Simple for a small institute

| Finding | State |
|---|---|
| 48 menu entries, several with internal names ("Random Call", "Enquiry Update", "Old System Import") and overlapping ones | **done**: plain groups (Overview, Admissions, Students & classes, Fees & money, Certificates, Events, Reports, Setup, Security & records) and plain names (Enquiries, Calls, Find an enquiry, Import) |
| Every feature on for everyone | **done**: Settings → Features switches packs on and off (calling team, website leads, trainers' classes, help desk, expenses, internships, letters, events, WhatsApp campaigns, old-system import). New institutes start with the core and four packs; older institutes keep everything |
| One-branch owner landed on "All branches (view only)" and had to pick a branch to work | **done**: an institute with one branch works in it directly |
| Transfers and shared students shown with one branch | **done**: hidden until there is a second branch |
| Dashboard warned new institutes about background jobs and named the platform's hosting (Coolify) | **done** (fixed earlier today) |
| Settings has 16 tabs | later: group them (Your institute · Money · Messages · Advanced) |

## 3. Features follow the plan

The plans today gate five paid modules (events, API, custom domain, white label, SSO); the trial opens everything.
**Next:** the feature packs above become part of each plan in the console's plan editor, so a plan decides which packs
an institute may switch on. A pack outside the plan shows in Settings → Features with "On <plan>" and an upgrade
button instead of a switch; during the trial every pack is available. Staff logins, branches and active students are
already limited per plan.

## 4. Own centres and franchises

Nothing exists for franchises yet. **Next**, as in PLAN.md Phase 6 step 2: a branch is own or franchise; a franchise
partner login sees only its centres; its receipts carry the partner's legal name and GSTIN; the royalty (percent of
fees or a fixed fee) is worked out monthly with what is paid and due; head office sets course fee ranges and approves
certificates; partners are invited by e-mail.

## 5. Their own brand

Name, legal name, colour, logo and accreditations are set in Set Up and used on receipts, certificates, ID cards, the
portal and e-mails. **Next:** their own domain from Settings (the database supports it; there is no screen), and a
gallery of starting certificate designs.

## 6. Big institutes

Zones above branches, bulk import at any time (today only in Set Up), bulk certificate issue, approval rules for big
discounts: **later**, after franchises.
