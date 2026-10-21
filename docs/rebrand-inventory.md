# Rebrand inventory (Phase 3)

Every place the code carried techcadd's name, look or details, by group, with where it goes. Made 2026-10-20 from
`grep -i "techcadd|tce-logo|tce.webp"` over `app components lib modules` (107 files; migrations left as history).
Status keys: `[ ]` to do · `[x]` done.

The rule: **the code is neutral; an institute's identity is its data.** Name, legal name, tagline, colour and logo
live in `organisations` (`name`, `legal_name`, `branding`), set in Set Up. The Sample Institute (the original
techcadd data) keeps techcadd's look through its own branding row, not through code.

## 1. Logo and colours (the frame of every screen)
- [x] `components/auth-shell.tsx`, `components/panel-shell.tsx`, `components/verify-shell.tsx`,
      `components/not-found-view.tsx`: `/tce.webp`, `/tce-logo.png` → the org's logo, else a neutral mark with its name.
- [x] Theme colour from `branding.color` (CSS variable on the panel and the public pages).

## 2. Names in screen text
- [x] `app/support/page.tsx` (the institute home page), `app/verify/*`, `app/e/*`, `components/*` copy that says
      "techcadd" → the org's name.
- [x] Page titles (`metadata`) "… | techcadd" → "… | <org name>".

## 3. E-mail and messages
- [x] `lib/notify/layout.ts`: the e-mail frame (logo, sign-off, footer) → the org's.
- [x] `lib/notify/providers.ts`, `modules/auth/*`, `modules/branches/welcome.ts`, `modules/notifications/*`,
      `modules/templates/service.ts`: subjects and sign-offs → the org's name.
- [x] `lib/notify/whatsapp.ts`: WhatsApp template names `techcadd_*` → neutral names; the org's own approved
      names come from its WhatsApp settings.

## 4. Documents
- [x] `lib/cert-course.ts`, `lib/cert-project.ts`, `lib/cert-design.ts`, `lib/cert-art.ts`, `lib/pdf.ts`: the
      course and project certificates → neutral layouts with the org's logo, name and (optional) accreditation image.
- [x] Receipts (`components/receipt-sheet.tsx`, `lib/pdf.ts`), the ID card (`lib/id-card.ts`,
      `components/id-card.tsx`): logo, terms, campuses and contacts → org settings with neutral defaults.
- [x] Letters (`modules/letters/service.ts`, `lib/letters/standard.ts`, `components/letter-companies.tsx`,
      `lib/db/schema/letters.ts`): techcadd's letterhead and stamp as fallbacks → none; the standard texts lose
      techcadd's details; the HR contact comes from the org.

## 5. Integrations
- [x] `modules/integrations/webhooks.ts`: `X-Techcadd-Event / -Delivery / -Signature`, `techcadd-webhooks/1` →
      `X-Event`, `X-Delivery`, `X-Signature`, a neutral user agent.
- [x] `modules/web-leads/service.ts`, `modules/import/oldsystem.ts`: techcadd's websites and old system named in
      code → described generically.

## 6. Seeds
- [x] `scripts/demo-seed.ts`: "Sample Institute" data without techcadd's details.
- [x] Migrations 0023, 0024, 0089 inserted techcadd's branches, letter companies and lookups: they ran before
      organisations existed, so on any database they belong to the Sample Institute only (0095 backfilled them).
      Nothing to change; new institutes start from `modules/orgs/provision.ts`.

## 7. Tests
- [x] Tests that assert techcadd's values are updated to the neutral defaults.

## 8. Assets
- [x] `public/tce.webp`, `public/tce-logo.png`, `public/letterhead.jpg`, `public/letters/stamp-signature.png`,
  `public/cert/accreditations.png` are techcadd's. They stop being used by code; the Sample Institute's branding
  carries its logo as data, and the files are removed at the end of the phase.

## Done (2026-10-21)
- Migrations: `0107_sample_branding` (the Sample Institute's legal name, tagline, colour, logo as PNG, accreditations)
  and `0108_neutral_names` (its WhatsApp campaign names, its ID-card contacts, its main letter company's letterhead and
  stamp as uploaded images; saved certificate designs draw `brand:logo` instead of `/tce-logo.png`).
- Set Up stores the logo (and the optional accreditations image) as PNG, converted in the browser, since receipts and
  certificates can only print PNG / JPEG; it also takes the contacts the ID card prints.
- Templates and fee reminders have `{{institute}}`; WhatsApp template bodies have `[Institute]`.
- Webhook headers are `X-Event`, `X-Delivery`, `X-Signature` (receivers checking `X-Techcadd-*` must change).
- Left as they are: the database role `techcadd_app` / login `techcadd_web` (infrastructure, not shown to anyone;
  renaming needs a coordinated database change), test fixtures and the old-system import's sample data.
