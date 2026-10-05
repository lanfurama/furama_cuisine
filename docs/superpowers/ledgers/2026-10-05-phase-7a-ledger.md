# Phase 7A ledger — content editors, media library and Blob

Plan: `docs/superpowers/plans/2026-10-05-phase-7a-editors-media.md` (tasks A1–A12). Spec: `docs/superpowers/specs/2026-10-01-admin-cms-design.md` §14.1 row 7. Research: `docs/superpowers/research/2026-10-05-phase-7-spikes/` (the outline wins over the three spike reports). Plan 7B (outline §3.2, B1–B11) starts from here.

This is the draft A12 writes. The controller adds the commits on `main`, each task review's outcome and the Neon record of migration 009 when it runs the plan and the runbook.

Acceptance closed by 7A (spec §14.1 row 7):
- **AC3, a file in use cannot be deleted.** `test/integration/media-library.test.ts` ("AC3: refuses to delete a file content shows, and lists where"; the two-connection race; `MEDIA_REFERENCES` equal to `pg_constraint`) and `e2e/admin-media.serial.spec.ts` ("AC3: … `chef.jpg` …", link "Section experiences"). Mutations M9 (no `FOR KEY SHARE`) and M10 (no usage check) turn them red.
- **AC4, edit then delete an offer, restore both times.** `test/integration/content-editors.test.ts` ("ACCEPTANCE: …") and `e2e/content-offers.serial.spec.ts` ("ACCEPTANCE: …", guest latency under 5 s at each step). Mutations M1 (no `updateTag`) and M2 (no `*_i18n` write) turn them red. M3 (no token check) turns red the conflict test of the same file ("a save from a page older than someone else’s save is a conflict naming them; nothing is written"), not the ACCEPTANCE tests.
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
- Owner facts (2026-10-05): the Vercel Blob stores (two, in the owner's words; **superseded** the same day by the one shared store below) are created by the owner later (7A built and tested against the local fake only); the Dining House phone prints "0859 555 759"; TikTok `@furama.dining.hous` is correct; the offers' end dates, the Experiences links and the film URL are content the owner enters in the editors.
- Owner decision (2026-10-05, `dc9509f`): previews use the production database, with no Neon branch per preview. 7A's runbook follows it: 009 goes on production once, before the first phase-7A deploy, preview or production; the image move runs for production only; and Production and Preview share **one** Blob store (folders keep them apart), because each build lets next/image optimise one store's host, so a separate Preview store would leave every preview without production's pictures.
- Owner decision (2026-10-05): **one Vercel Blob store, decided**, shared by every environment, with the folders `production/`, `preview/<branch>/` and `development/`; the `media-sweep` cron runs on Production only, over `production/` (README "Media in Vercel Blob (phase 7A)"). It supersedes the outline's two stores (§8) and, in the plan:
  - R15's "Nếu sai" ("only storage"): a preview folder holds production files, since a preview's upload is a production row that production pages can use. Production's sweep purges trashed rows from any folder and deletes their files (F10); only a preview folder's orphans stay, storage only.
  - Risk 3: preview folders are never swept automatically; they hold production files and are never deleted by hand.
  - Risk 29: decided, no longer "Cần quyết định".
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
- From the final 7A review (`final-deferred.md`, LATER phase 7B):
  - B8 (labels and the emails pass): UX-9, the ui-text screen labels its 16 `error.*` keys with raw key names (with risk 17: a Vietnamese `label` on every key); Enter on the emails screen runs "Xem trước", not the save (A4); `guestEventKeys()` repeats `GUEST_EMAILS`' event names (A4).
  - B9/B10 (the form-kit retrofit): UX-5, a restore's "Đã khôi phục." unmounts with its choice (one outcome line per History panel, also the hero's "Slide đã xóa gần đây"); UX-10, small differences between editors ("Xóa file" without a confirm, `MediaDetailsForm` off `useSaveState`/`SaveBar`, missing "← Nội dung" crumbs, no "Nội dung | Giờ và sức chứa" subnav, a strings conflict on a reset key naming "người khác"); `conflictBy` names whoever last bumped `updated_by` (booking-config save, reorder, R19's alt follow: name the newest audit row's actor); `useSaveState` drops edits typed while a save is in flight (narrower after F12); the warn colours as `--a-*` tokens (A2).
  - With the new pickers and sections: a file of the wrong kind gets the `MEDIA_GONE` message (A6, A9); the trash lists at most 20 rows (A6); two slides on one picture share an accessible name (A9); `aria-invalid` on `ImagePicker`'s `<fieldset>` (A9); `SECTION_PARTS` typed `Partial<Record<SectionKey, …>>` (A9); `fileOf` on the hero page calls a trashed deleted slide's picture "slide" (A9); the advisory "MENU hidden" warning can be missing (A10); "Ẩn" has no confirm while "Lưu trữ" has one, and the "Đặt bàn online" column says "Bật" for a hidden or archived restaurant (A11).
  - Residuals of the fix wave's re-review (all Minor):
    - the offers action still reads `fields.publish === '1'` instead of `PublishForm` (`content/offers/actions.ts:67`);
    - the README routes-table row for `/api/cron/media-sweep` still describes the old sweep: no deletion of purged rows' files from any folder, and a dry run that runs the purge;
    - the `scripts/move-assets-to-blob.mjs` usage comment shows `DATABASE_URL`, not `DATABASE_URL_UNPOOLED`;
    - the README botid prefix blanks fewer Blob variables than the other commands;
    - in `lib/legal.test.ts`, the title "moves whenever …" and the "pin that migration's pair in RECORDED" step contradict the new comment;
    - "Tải lại" after `not_allowed` clears `dirty` before the refresh;
    - out-of-folder files of rows purged in a run whose orphan pass then fails are never retried.

## Carried to later phases

As outline §7: phase 8 (TranslatableField tabs, per-locale tokens, the emails VI tab, per-locale menu PDFs and legal versions, L8-1 … L8-8), phase 9 (the AI translator and alt writer set `machine`/`ai`, L9-1), phase 10 (guest CSP with the film players and the blur placeholder, an optional `onUploadCompleted` route, a sweep of preview-folder orphans (R15), or the owner's option to have previews write into `production/`, the first-preview Blob checks hardened, a router-level unsaved-changes guard, a History pager, L10-1 … L10-7, dropping the phase-1 columns).

From the final 7A review (`final-deferred.md`, LATER), by phase:
- **Phase 8 (i18n):**
  - SEC-3 (= F7DAT-2), an accepted risk for the lawyer until then: `consent_version` stamps the version in force at INSERT, not the wording the guest was shown. The drawer will post the version it rendered, and `submitReservation` keeps it only if that `legal_versions` row exists (else the newest; the `COALESCE` fallback stays). The README's lawyer line records it.
  - `checkMessage` checks variable names, not types (A3); apostrophes are parsed with ICU quoting even for plain templates (A3); the dead `no_other` branch in `lib/i18n/icu.ts` (A3); `SearchOverlay`'s `search.none` omits `locale` (A3); the VI email preview validates unsaved EN text (A4).
- **Phase 10 (hardening):**
  - Guards and tests: a malformed reorder answers `conflict`, not `invalid` (A1); the admin-pages guard sees only static imports (A1); the content-tags guard misses an aliased `updateTag` import (A1); `content-offers.serial`'s `afterAll` repairs only offer 2 (A2); `lib/booking-errors.test.ts` tests a local copy (A3); `EVERY_CODE_HAS_A_KEY` as a type-only assertion (A3); `parseFilmUrl`'s `live/` form has no test (A5); `BlobNotConfiguredError` with a blank env has no end-to-end test (A5); `admin-media.serial`'s `outside` array is never cleared (A6); restore test gaps (A10).
  - Code: `HOME_KEYS` sends unused price templates to the client (A3); `loadStringRows` for the price templates runs after the offers query (A3); the email preview route's raw 500s (A4); `legal_versions` append-only by convention only (R21: a trigger or `REVOKE`) (A4); `downloadBlob` cancels no body on a non-OK answer and accepts any public Blob host (A5); registering a pathname whose row is in the trash (A6); the sweep has no time budget inside `maxDuration` (A7); Experiences `sizes` (A8, changes the DOM-diff baseline: needs a ruling); `Hero.tsx`'s `alt={slide.image.alt}` (A8); the guest-site CSP (A9, risk 21); a restore checks less than a save (A10); `listRestaurantsAdmin` computes tokens N+1 and `createRestaurant` has no `mapWriteError` (A11).
  - Preview folders: `preview/<branch>/` orphans are never swept (R15, storage only); phase 10 may add a sweep of preview-folder orphans that leaves files any `media` row names, or the owner may choose to have previews write into `production/` (one line in `blobEnvPrefix`; it changes the 2026-10-05 folder decision). Until then preview folders hold production files and are never deleted by hand.
  - Process (controller): the first CI run on Node 24 checks blob-redirect's undici-6 dispatcher against Node 24's fetch (A5).

## Needs a decision or a first-preview check

- **First preview (the README's "First preview checks"):** the real Blob service (CORS, overwrite refusal, `x-content-type`, public access, which variables the store sets, the `Origin` check behind the final domain) and sharp's memory for a large photo in a function. A preview writes production's data, so each check puts back what it changes.
- **Owner content:** the offers' end dates and the Offers lede's date (`offers.lede`), the Experiences links, the film's YouTube or Vimeo link, high-resolution originals for about 17 thumbnail-sized images, the menu PDFs.
- **Owner or lawyer:** restoring old policy wording makes a new policy version (R21), not the old one back.
- **Owner or lawyer (accepted risk until phase 8, SEC-3):** a booking records the policy version in force when it is saved, so a guest whose page stayed open across a change of the agreed text is recorded against the newer wording. Phase 8 fixes it (below).

## Final review fix wave

The whole-branch review of `bbe2b58..70edc5f` (security, data-history, admin-ux, guest-cache-ops) and the triaged task-review minors became 28 fix items in four commits (`.superpowers/sdd/2026-10-05-phase-7a-editors-media/final-fix-brief.md`; what was deferred or dropped is in `final-deferred.md`, and the LATER items are in the lists above):
- `1fe1282` G1 (F1–F8), history engine and save flows: `readOrder` ties by the numeric id and a restore no longer moves an item; item tokens ignore `updated_at`/`updated_by`/`sort_order`; a list restore that fails a CHECK or NOT NULL is `invalid`, not a 500; `saveStrings` checks every key before writing; a Preview cannot write agreed text (and so the policy version); the slide pace no longer bumps `site_settings.updated_at`; `restoreRestaurant` uses `versionOf`; duplicate cuisines and highlight ids, and an unknown hero `publish` value, are refused.
- `3a7e67f` G2 (F9–F11), media, sweep and booking: `registerMedia` refuses a file the store serves under another Content-Type; the sweep deletes the files of the rows it purges in any folder, and its dry run lists files only; a booking whose offer is deleted mid-insert is retried without the link.
- `244dfbb` G3 (F12–F20), form kit and editors: a colleague's save no longer remounts a dirty form (a stale notice instead); highlight edits survive an upload and a failed register frees the uploader; `SortableList` keeps focus; a refused restore says why; a string's `delete` row, the email preview's selects, an archived restaurant's screen, phone width (375 px) and an untitled offer's heading.
- G4 (F21–F28, the commit that records this section): the policy-text guard's advice (a changed agreed default needs a new `legal_versions` migration), four test guards (the runbook guard reads `.sql` only, `actionFiles` finds `'use server'` by AST, `email-screens` pins `BETTER_AUTH_URL`, ACCEPTANCE cleans up in `finally`), `effective_on` computed by the save, and the README, spec and this ledger brought to the 2026-10-05 decisions.

Gate numbers (`final-fix-report.md`): typecheck clean and lint exit 0 with 14 warnings at every group; unit and integration 107 files with 1333 tests (G1), 1336 (G2), 1338 (G3) and 1339 (G4); `Applied 9 migration(s).`, check-prerender and the server DOM diff byte-identical to the `70edc5f` reference (`/en` 12, Tàya 2, `/en/privacy` 0) at every build; E2E 188 + 1 skipped (G1), 194 + 1 skipped (G3, six new tests); visual 8 passed. The final three-run gate on the G4 commit is recorded in the report.

## Migration 009

Not applied to Neon yet. The controller applies it to production with the README's "Migration 009 (phase 7A: policy versions)" (pre-flight, apply, post-check), before the first phase-7A deploy, preview or production: previews use the production database, and the phase-7A build stops without 009 (`relation "legal_versions" does not exist` while it prerenders `/en/privacy`). Then the move of the phase-6 images to Blob, for production only, dry run first ("Media in Vercel Blob (phase 7A)"), and a redeploy.
