# Phase 7A ledger — content editors, media library and Blob

Plan: `docs/superpowers/plans/2026-10-05-phase-7a-editors-media.md` (tasks A1–A12). Spec: `docs/superpowers/specs/2026-10-01-admin-cms-design.md` §14.1 row 7. Research: `docs/superpowers/research/2026-10-05-phase-7-spikes/` (the outline wins over the three spike reports). Plan 7B (outline §3.2, B1–B11) starts from here.

This is the draft A12 writes. The controller adds the commits on `main`, each task review's outcome and the Neon record of migration 009 when it runs the plan and the runbook.

Acceptance closed by 7A (spec §14.1 row 7):
- **AC3, a file in use cannot be deleted.** `test/integration/media-library.test.ts` ("AC3: refuses to delete a file content shows, and lists where"; the two-connection race; `MEDIA_REFERENCES` equal to `pg_constraint`) and `e2e/admin-media.serial.spec.ts` ("AC3: … `chef.jpg` …", link "Section experiences"). Mutations M9 (no `FOR KEY SHARE`) and M10 (no usage check) turn them red.
- **AC4, edit then delete an offer, restore both times.** `test/integration/content-editors.test.ts` ("ACCEPTANCE: …") and `e2e/content-offers.serial.spec.ts` ("ACCEPTANCE: …", guest latency under 5 s at each step). Mutations M1 (no `updateTag`), M2 (no `*_i18n` write) and M3 (no token check) turn them red.
- AC1 (the checklist walk) and AC2 (no guest text outside the registry or the database: PENDING is 116 after 7A, `{}` at B8) close in 7B.

Final gate (A12, twice on the last commit, plus a third E2E run with `TZ=UTC`):
- typecheck clean; lint exit 0 with 14 warnings (19 until A8 turned five `<img>` into `CmsImage`).
- Unit and integration: 107 files, 1323 tests.
- `Applied 9 migration(s).`; build and check-prerender pass.
- Server DOM diff against a `c896b13` build: `/en` 12 lines, `/en/restaurants/taya-house` 2, `/en/privacy` 0 (A8's optimised images only).
- E2E: 188 passed, 1 skipped, each run.
- Visual: 8 passed at ratio 0; no baseline changed.

## Rulings

- The owner told the team to follow the outline's recommendations, so R1–R23 (outline §2) stand as proposed, including the four open questions: R7 (emails editable in EN only in phase 7), R8 (the database-less error pages keep locked text), R9 (deleting an offer writes one `reservation_event` `edited` per unlinked booking), R11 (social labels become `social.<platform>` keys with today's text, in 7B).
- Owner facts (2026-10-05): the Vercel Blob stores (two, in the owner's words) are created by the owner later (7A built and tested against the local fake only); the Dining House phone prints "0859 555 759"; TikTok `@furama.dining.hous` is correct; the offers' end dates, the Experiences links and the film URL are content the owner enters in the editors.
- Owner decision (2026-10-05, `dc9509f`): previews use the production database, with no Neon branch per preview. 7A's runbook follows it: 009 goes on production once, before the first phase-7A deploy, preview or production; the image move runs for production only; and the README recommends that Production and Preview share **one** Blob store (folders keep them apart), because each build lets next/image optimise one store's host, so a separate Preview store would leave every preview without production's pictures. The outline (§8) and the owner had two stores; one store waits for the owner's sign-off (below).
- Plan rulings recorded in the plan's implementation notes (Part 3):
  - The words every restaurant card and page shares (`restaurants.*`, `detail.*`) are edited once, on `/admin/restaurants`; spec §7.2 lists the "Our Restaurants" words on `/admin/restaurants/[id]`, but they belong to no one restaurant.
  - Spec §6.5's "slide 1 needs a phone crop" refuses any write (hide, delete, reorder, edit, restore) that would leave the first shown slide without one; hiding every slide is allowed (the home page then names itself with the hidden `<h1>`).
  - A restaurant draft (R22) may be saved without a card picture or a type; showing it needs both.

## Closed in 7A

- Phase-6 ledger: L7-1 (A9: the hero hidden by its section and by its slides, at 1280, 900 and 390 px, put back by History and by the save), L7-3 (A10: one "has a page" predicate), L7-4 (A11: `bookableSql`), L7-5 (A10: the restaurant's own number in its emails; the availability 404 for a hidden restaurant), L7-8 (A8), L7-9 (A1), L7-11 and L7-12 (A2, R9), L7-14 for hero slides and highlights (A9, A10), L7-16 (A9); D3 (the F-A E2E), R3 (`CmsImage` everywhere, A8) and R19 (the card's alt follows a rename, A10, audited as the file's `media` row).
- Phase-5 ledger: T5.1, T5.3, T5.5, T8.1, T8.2, T8.4 (A4); the `bodySizeLimit` scoping, closed as not feasible (one global option, C11).
- Phase-3 ledger: the admin-pages guard bans guest components and the default `next/image` import, and scans `.js`/`.jsx` (A1).

## Carried to plan 7B (outline §3.2)

- L7-2 (destination publish semantics, B1), L7-6 (`saveInbox` through `tagsForSave`, B5), L7-7 (stray separators, B3/B5), L7-10 (`listDestinationOptions` in the content layer, B1), L7-13 (SEO fallbacks, B7), L7-14 for nav items (B4), L7-15 (social labels, B5), L7-17 (FK coverage of every delete and restore path, B11), L7-18 (the RSC-404 race at real save rates, B11).
- The remaining screens: `cuisines`, `destinations`, `experiences`, `booking`, `navigation`, `contact`, `seo` (`NOT_BUILT` in `test/guards/editing-screens.guard.test.ts`, `[]` at B8); PENDING 116 → `{}` (B8); a Vietnamese `label` on every key (B8).
- The form-kit retrofit of the booking admin (phase-4 and phase-5 items, B9) and of the auth, users and settings forms (phase-3 items, B10).
- AC1's checklist walk (B11), three closing E2E runs, the phase-7 ledger, and removing the DOM-diff base worktree.

## Carried to later phases

As outline §7: phase 8 (TranslatableField tabs, per-locale tokens, the emails VI tab, per-locale menu PDFs and legal versions, L8-1 … L8-8), phase 9 (the AI translator and alt writer set `machine`/`ai`, L9-1), phase 10 (guest CSP with the film players and the blur placeholder, an optional `onUploadCompleted` route, a Preview/Dev sweep, the first-preview Blob checks hardened, a router-level unsaved-changes guard, a History pager, L10-1 … L10-7, dropping the phase-1 columns).

## Needs a decision or a first-preview check

- **First preview (the README's "First preview checks"):** the real Blob service (CORS, overwrite refusal, `x-content-type`, public access, which variables the store sets, the `Origin` check behind the final domain) and sharp's memory for a large photo in a function. A preview writes production's data, so each check puts back what it changes.
- **Owner, before the store is created:** one Blob store for Production and Preview (the README's recommendation, since previews share production's database), instead of the two the owner and the outline named. Two stores would need `blobImageHost` to allow both hosts, and no file uploaded on a preview used on production.
- **Owner content:** the offers' end dates and the Offers lede's date (`offers.lede`), the Experiences links, the film's YouTube or Vimeo link, high-resolution originals for about 17 thumbnail-sized images, the menu PDFs.
- **Owner or lawyer:** restoring old policy wording makes a new policy version (R21), not the old one back.

## Migration 009

Not applied to Neon yet. The controller applies it to production with the README's "Migration 009 (phase 7A: policy versions)" (pre-flight, apply, post-check), before the first phase-7A deploy, preview or production: previews use the production database, and the phase-7A build stops without 009 (`relation "legal_versions" does not exist` while it prerenders `/en/privacy`). Then the move of the phase-6 images to Blob, for production only, dry run first ("Media in Vercel Blob (phase 7A)"), and a redeploy.
