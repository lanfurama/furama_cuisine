# Phase 7 plan outline: Trình soạn nội dung và thư viện

Scope: spec `docs/superpowers/specs/2026-10-01-admin-cms-design.md` §14.1 row 7. The row asks for:
- the shared form kit;
- editors for every §7.2 screen;
- sorting, show/hide and layout limits;
- SEO, UI text, email content and the policy page;
- image and PDF upload;
- the film embed;
- moving the old images to Blob, plus the file-sweep cron;
- **History and restore**.

**Acceptance:**
- **AC1.** Walk the checklist generated from content-inventory §2.1–2.19. Each item except locked brand text, edited in EN in the admin, shows on the web within seconds.
- **AC2.** A CI test finds no guest-visible text outside the registry or the DB.
- **AC3.** A file in use cannot be deleted.
- **AC4.** Edit and then delete an offer; it can be restored both times.

Details are in §3, §5.1–5.2, §6.2, §6.3 item 7, §6.5, §7.1–7.5, §8, §11, §12 and §13. Editing other languages is phase 8: `TranslatableField` shows EN only.

Folder: `/Users/bcmac/Desktop/projects/Outside Projects/furama_cuisine/docs/superpowers/research/2026-10-05-phase-7-spikes/`. It holds this outline and three spike reports:
- **`form-kit-history.md`** (clone `p7-kit`, patch `p7kit-logs/p7-kit.patch`, 42 files): the generic snapshot, restore and history engine; `makeListEditor`; the `_kit` components; the offers editor with the AC4 flow; the restaurant aggregate editor with R19.
- **`media-blob.md`** (clone `p7-media`, patch `p7med-logs/p7-media-full.patch`, 58 files): `@vercel/blob` 2.8.0 presigned upload behind session and permission checks; `registerMedia` with sharp; soft delete refused while in use; `media-sweep`; `move-assets-to-blob.mjs`; CmsImage for every content image (R3, measured); the film embed. It also holds the local fake Blob server and an undici redirect that refuses every other host.
- **`editors-registry.md`** (clone `p7-edit`, patch `p7ed-work/p7-edit-spike.patch`, 55 files): the checklist map from §2.1–2.19 to screen and field; the registry move pattern (pixel-identical); ICU validation (`intl-messageformat`); the guest-text guard with LOCKED/PENDING lists; the editing-screens guard and its schema test; the strings editor; migration 009 `legal_versions`; the email preview route.

Clones and patches live under `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/`. Where a report and this outline disagree, **this outline wins**; §0 lists every conflict and how it was settled.

**Decision: phase 7 is TWO sequential plans.**
- **7A** (12 tasks) covers the engine, the kit, strings, media and Blob, and the high-risk editors. It closes AC3 and AC4.
- **7B** (11 tasks) covers the remaining editors, the end of the registry move, the form-kit retrofit of the older admin forms, and the acceptance walk. It closes AC1 and AC2.

The boundary is in §3.0.

## 0. What I checked myself, on top of the three reports

**State**
- In the main repo I wrote only this folder. I ran no build, test or server against it, created no database, and touched no port.
- `main` is at `c896b13`, clean. All three spikes are based on it.
- I made a throwaway local clone (`scratchpad/p7-merge`, deleted afterwards; no DB, no server) to test-apply the patches:
  - each patch passes `git apply --check` alone on `c896b13`;
  - applied in the order kit → media → edit with `--3way`, they conflict only in shared files, and every conflict is additive: `lib/admin/nav.ts`/`nav.test.ts`, `lib/server/action-result.ts`, `lib/admin/auth-errors.ts`, `styles/admin.css`, `test/guards/require-permission.guard.test.ts`, and the nav arrays in `e2e/admin-acceptance.spec.ts` and `e2e/admin-users.spec.ts`;
  - `components/home/Heritage.tsx` and `package.json` (changed by both media and edit) merged cleanly.
- I read:
  - spec §3, §5.1, §6.2–6.5, §7.1–7.5, §8, §11–§16;
  - the phase-6 ledger (L7-1…L7-18, D1–D3), the phase-6 outline and plan Global Constraints (lines 24–193);
  - the phase-7 sections of the phase-3, -4 and -5 ledgers;
  - content-inventory §2 headings;
  - `lib/cache-tags.ts`, `lib/cache-plan.ts` (`SAVE_TAGS`), `lib/i18n/registry.ts` (`ADMIN_SCREENS`), `lib/admin/nav.ts`, `lib/admin/admin-pages.guard.test.ts`, `lib/server/auth/permissions.ts`, `next.config.ts`, `vercel.json`, `playwright.config.ts`, `playwright.visual.config.ts`, `e2e/visual*.spec.ts`;
  - migrations 001, 005, 006 and 008 (media, audit_log, reservation_events, restaurants);
  - the Next docs cited below and the spikes' key files.

**Facts the decisions rest on**

| # | Fact | Where |
|---|---|---|
| F1 | `audit_log.action` allows only `create\|update\|delete\|reorder\|restore\|settings\|staff.*`. `entity_type` is free text and `entity_id` is text. The index is `(entity_type, entity_id, at DESC)`. | `005:102-117` |
| F2 | `media` is soft-deleted through `deleted_at`, with `UNIQUE (pathname)`. `blur_data_url` must match `^data:image/(jpeg\|png\|webp);base64,` and be ≤ 4000 chars. `bytes` ≤ 15 728 640. `media_blob_url` requires https. Every content FK to `media` is RESTRICT; RESTRICT raises SQLSTATE 23001. | `008:63-91`; media report error 4 |
| F3 | `SAVE_TAGS.content_strings = [content:ui, content:legal]`, commented "by key prefix (phase 7)". Spec §6.2 also names per-section tags, but ledger L7-6 rules that phase 7 follows `SAVE_TAGS`/`tagsForSave`. Since D2, every guest page carries `content:ui`. | `lib/cache-plan.ts:54-57`; phase-6 ledger L7-6, D2 |
| F4 | The email renderer reads strings uncached, so an `email.*` save needs no tag. | `lib/server/email/booking/render.ts:9,190` |
| F5 | `updateTag` runs in Server Actions only and expires at once. `bodySizeLimit` is one global option (default 1 MB) with no per-action scope. `getImageProps` exists. `remotePatterns` takes `*` as one label. | `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/updateTag.md:12,16`; `05-config/01-next-config-js/serverActions.md:59-75`; `02-components/image.md:533-611,1009` |
| F6 | Playwright's per-pixel `threshold` defaults to 0.2. The visual config sets only `maxDiffPixelRatio: 0`. `visual.spec` waits for every image to have `complete && naturalWidth`. `visual-nojs.spec` waits only for `networkidle` plus 300 ms. | `node_modules/playwright-core/lib/coreBundle.js:7897`; `playwright.visual.config.ts:17`; `e2e/visual.spec.ts:38-47`; `e2e/visual-nojs.spec.ts:13-15` |
| F7 | `<Image>` injects `style="color:transparent"`, which the admin nonce CSP blocks (560 violations measured). The admin guard bans `style={…}` but not `components/**` or `next/image` imports (a phase-3 ledger item). The media spike's library page imports the guest `CmsImage` (`media/page.tsx:4,64`), and its E2E never calls `watchCsp`. | kit report error 8; `admin-pages.guard.test.ts:70-71`; phase-3 ledger §Phase 7 |
| F8 | The admin nav has 7 items, and each spike adds a different one: "Ưu đãi", "Thư viện" and "Nội dung". Both roles have `content: read/update/restore/ai`. | `lib/admin/nav.ts`; `permissions.ts:16,31` |
| F9 | `reservation_events.type` is one of `created`, `status_changed`, `edited`, `note_added`. Spec §7.4 says booking-side effects are logged there, not in `audit_log`. | `006:309`; spec §7.4 |
| F10 | `restaurants.id` is a text PK, and `reservations.restaurant_id` references it with no action, so a restaurant is never deleted, only archived. `restaurants_published_card` requires `card_image_id` when published; `restaurants_detail_image` requires `detail_image_id` when the page is on. | `001:5-21`; `008:330-334` |
| F11 | `vercel.json` holds two crons; media adds `/api/cron/media-sweep` `35 18 * * *`. `playwright.config.ts` has a single `webServer`, and the media spike started its fake Blob server by hand. | `vercel.json`; `playwright.config.ts:80-84`; media patch file list |
| F12 | The edit spike's migration 009 has no migration test and no `db/checks/preflight-009.sql`/`postcheck-009.sql` (`db/checks` holds only 008's). | `ls db/checks`; edit patch |
| F13 | `@vercel/blob` 2.8.0 is real: `uploadPresigned` and `handleUploadPresigned` exist. `handleUploadPresigned` throws without a webhook key. Credential resolution falls back to an OIDC refresh through the Vercel API on a linked checkout. | media report §"@vercel/blob 2.8.0" |
| F14 | The registry ships to every guest page today, through `lib/booking-errors.ts` (`DEFAULT_ERROR_STRINGS`, used only by tests). | edit report §0 |
| F15 | Gate baseline at `c896b13`, agreed by all three spikes: unit + integration 83 files / 1039 tests; E2E 168 passed + 1 skipped (botid); visual 8 passed; lint exit 0 with 19 warnings; DOM diff 0 lines against a `c896b13` build. | three reports |

**Conflicts between the spikes, and the decision for each**

| # | Conflict | Decision | Evidence |
|---|---|---|---|
| C1 | Plan shape: one plan of 9 large tasks (kit), 7A/7B with 11 + 9 tasks (edit), media M1–M7. | **Two plans: 7A with 12 tasks, 7B with 11** (§3). Destinations moves to 7B (B1); legal, emails and strings history stay in 7A (A4), so 009 reaches Neon once, after 7A. | 13–16 days of work; a single SDD run handles about 10–14 tasks |
| C2 | Nav item: "Ưu đãi" (kit), "Thư viện" (media), "Nội dung" (edit). | **"Nội dung" → `/admin/content`** (index of every content screen, offers included) **and "Thư viện" → `/admin/media`**, both `content:read`, after "Nhà hàng". | F8 |
| C3 | Admin thumbnails: kit `getImageProps` + `<img>`; media uses the guest `CmsImage`. | **Kit's approach, as one `_kit/Thumb`.** The admin guard bans `components/**` imports and the default `next/image` import under `app/admin` (the named `getImageProps` stays allowed), and scans `.js`/`.jsx` (phase-3 item). `admin-media.serial` adds `watchCsp`. | F7 |
| C4 | R3: edit plans a baseline re-take; media measured none needed. | **No re-take.** `visual-nojs.spec` gets the same wait-for-images as `visual.spec` (a reviewed test change). If a task still sees a diff, it stops and reports; it never runs `--update-snapshots`. | F6; media report "R3 / visual baseline measurement" |
| C5 | Film poster, link and on/off: media puts them on `/admin/content/hero`; edit's `COLUMN_SCREENS` gives them to `sections`. | **Both screens, one writer.** `COLUMN_SCREENS` keeps `sections`. Both screens call the same `saveSection(key)` with the same token: the sections screen shows the film toggle, and the hero screen embeds the film part (spec §7.2). | spec §7.2 |
| C6 | Audit entity for alt text: kit uses `media_i18n` (R19); media uses `media` (row + i18n). | **`media`**: the snapshot holds the row plus its `media_i18n` rows, as for every ItemDef. R19 writes a `media` row. This satisfies spec §7.5's "media_i18n" history. | F1; consistency |
| C7 | Restoring a version that points at a trashed file: kit relies on the FK only; media proposes un-delete or refuse. | **The restore engine un-deletes a soft-deleted file in the same transaction** (with its own `media` audit row, action `restore`). A purged file gives `missing_reference`. Every saver calls `assertLiveMedia` (`FOR KEY SHARE`). | F2; media risk 7–8 |
| C8 | Conflict token: kit hashes the content; edit uses per-key `updated_at`; media's alt editor uses its own token. | **Hash token for every ItemDef entity** (lists, the restaurant aggregate, `sections`, `site_settings`, `media` with its alt). **Per-key `updated_at` for `content_strings`**: one row per key, nothing else shares it. | R2 |
| C9 | Strings form state: edit's own `useActionState` holder vs kit `useSaveState`. | **`StringsForm` uses `useSaveState` + `SaveBar`**, keyed on the joined tokens (rule 9). | one kit |
| C10 | ActionCodes. | **Union:** `limit`, `missing_reference`, `in_use` (+ `uses`), `blob_not_configured`. | R16 |
| C11 | `bodySizeLimit`: media sets `'2mb'` globally (spec §11); the phase-5 ledger asks to scope it to uploads. | **`'2mb'` global, as the spec says.** Scoping is impossible (F5), and files never pass through an action. The ledger item is closed as not feasible. | F5 |
| C12 | ImagePicker upload: kit only points to the library; spec §7.3 wants upload in the picker. | **The picker embeds the uploader** (A6). Alt text and the decorative flag are edited on the file's own screen, linked from the picker (R12). | spec §7.3 |
| C13 | Where `offers.*` and the price templates move: edit's A8 vs kit's T2. | **A3**, the strings task: the offers screen exists from A2. `loadOffers` reads its two price templates, and `LOADERS.offers` gains `content:ui` (pinned by `cache-plan.test`). | F3 |
| C14 | L7-12: kit records the unlinked booking ids only in `before.meta`. | **Also write one `reservation_event` `edited`** (actor staff, `changes.offer: [title, null]`) per unlinked booking in the same transaction (R9). | F9 |
| C15 | Media's spike E2E needs a hand-started fake. | **Wire it into `playwright.config.ts`**: a second `webServer` for `fake-blob-cli.mjs`, plus `webServer.env` for the app (A5). | F11 |
| C16 | 009 has no migration test or checks. | A4 adds `test/integration/migration-009.test.ts` (DB `furama_cuisine_migrate009_test`), `db/checks/preflight-009.sql` and `postcheck-009.sql`. | F12 |
| C17 | The `migration-008.test.ts` 10 s hook timed out once in two spikes. | A1 raises that file's hook timeout to 30 s (test infrastructure only). | edit error 12; media error 15 |

## 1. Verified decisions

Each deliverable and acceptance criterion of §14.1 row 7, with the approach, where it was verified, and the test that pins it.

| # | Item | Approach | Source | Pinned by |
|---|---|---|---|---|
| D1 | **Shared form kit** (§7.3) | `_kit/`: `useSaveState` (rule 9: holder above the token-keyed fields; a stale failure is hidden; dirty flag plus `beforeunload`), `SaveBar` (outcome, "Tải lại", last editor, "Xem trên web"), `TranslatableField` (EN only; posts `field.locale`; counter with warn/refuse levels; 1.3× warning; `useId`, `aria-invalid`/`describedby`), `TextField`, `SortableList` (↑/↓ buttons plus a drag grip; focus kept; live region), `LimitNote`, `ImagePicker` (+ uploader from A6), `Thumb`, `HistoryPanel`, `RestoreButton`; `readForm` folding; zod checkbox `z.literal('on').optional()` | kit §Form kit | `content-schemas.test`, `content-rules.test`, `history.test`; `content-offers.serial` and `content-restaurant.serial` (refused save keeps values; `aria-describedby`; `watchCsp` empty; `expectHydrated`) |
| D2 | **Save flow** (§7.4) | `requirePermission` → zod → BEGIN → lock (advisory `content:<list>`, or `FOR UPDATE` for the aggregate) → token → rules → write row + `*_i18n` (`upsertTranslation`: `reviewed`/`human`) → `assertLiveMedia` → `insertAudit(before, after)` → COMMIT → `updateTag(tagsForSave(…))` → `ActionResult` | kit; spec §7.4 | `require-permission` guard with the `CONTENT_ACTIONS` matrix; integration conflict tests; mutation M1 (no `updateTag`) → E2E red |
| D3 | **History and restore** (§7.5) | `ItemSnapshot {v:1,row,i18n,meta?}` in `audit_log.before/after`. `writeItem` uses `jsonb_populate_record`; a deleted item comes back under its id with `OVERRIDING SYSTEM VALUE`; the `*_i18n` rows are rewritten. Reorders are logged with `entity_id NULL` and restored by id order. Today's rules are re-applied; token check; action `restore` with `meta.restored_from`. `content_strings` restore runs per key (A4). A trashed file is un-deleted (C7). | kit §Server; edit §4 | `content-editors.test` (12); M2 (no i18n) → 10 red; M3 (no token) → red; A4 strings-restore integration; A6 restore-undelete integration |
| D4 | **Editors for every §7.2 screen** | ItemDef + `makeListEditor` for lists; the aggregate for the restaurant; `StringsPanel(screen)` for string screens; the `/admin/content` index | three reports | `editing-screens.guard` (every key's screen has a route and a page rendering `screen="…"`; `NOT_BUILT` shrinks to `[]` in B8); `editing-screens.test` (`COLUMN_SCREENS` = `information_schema`) |
| D5 | **Sorting, show/hide, layout limits** (§6.5) | `LIMITS`/`LENGTHS` in `lib/admin/content-rules.ts`, applied on save **and** restore; counts only published items (R4); nav label warns over 14 and refuses over 18; restaurant name warns over 24; slide 1 needs a mobile crop; restaurants section locked on | kit `content-rules` | `content-rules.test`; integration limit tests (6 offers across create, show and restore); per-editor E2E |
| D6 | **SEO** | `seo.*` keys (home title and description, OG title and description, `page_title{page}`, `not_found_title`) feed `generateMetadata`; `site_settings.og_image_id` through the picker; restaurant `seo_*` fields on `/admin/restaurants/[id]`, with fallbacks (L7-13) | edit §1 | B7 E2E (EN edit → `<title>`/`og:` on the next load); `check-prerender` tags |
| D7 | **UI text** | Registry move: page copy goes server → page props (`copyOf`); chrome copy goes through `CLIENT_PREFIXES`/`CLIENT_KEYS` → `useSite().strings`; ICU through `intl-messageformat` 12.1.2, only for templates with ICU syntax; every EN default is today's exact text; the registry comes off the client bundle | edit §2 | `registry.test` (`checkMessage` on every key, EN and VI); DOM diff 0 lines (R3 lines only after A8); visual 8/8; `content-strings.serial` |
| D8 | **Email content** | `/admin/content/emails`: `StringsPanel` grouped by event; preview at POST `/api/admin/emails/preview` (`requirePermission({content:['read']})`, Origin check, own CSP `frame-ancestors 'self'`, sandboxed iframe, unsaved text); EN only (R7); T5.1, T5.3, T5.5 and T8.4 folded in | edit §4 | `content-strings.serial` test 4 (200 + banner + CSP; dropped `{reference}` → 422); A4 integration (reviewed `vi` row beats the registry, T5.5) |
| D9 | **Policy page** | `/admin/content/legal`; migration 009 `legal_versions` (append-only; Da Nang date with `.n`; seeded at the pinned hash); `recordPolicyVersion` in the same transaction when `AGREED_KEYS` change; bookings store the newest version; the privacy page prints `effective_on` | edit §4 | `content-strings.serial` test 3; `migration-009.test` (C16); integration (restoring every default reproduces the seed hash); M7 → 2 red |
| D10 | **Image and PDF upload** (§11) | Browser `uploadPresigned` → `/api/admin/media/upload`: `requirePermission({content:['update']})` first, Origin check, strict pathname regex `<env>/media/<uuid v4>/<slug>.<ext>`; token scoped to that path, its type, 15 MB and 10 min, issued with explicit credentials → `registerMedia({pathname})` (`head`, download ≤ 15 MB from the Blob host only, sharp real-type check and EXIF-aware size, ≤ 16 px WebP blur, upsert by pathname, audit; a mismatched file is deleted at once). No `onUploadCompleted` (R13). | media §Design 1 | `media-upload.test` (real SDK → route → fake: wrong type, over 15 MB, overwrite and wrong path all refused; 401/403/bad origin; callback refused); `media-library.test`; `measure.test`; `admin-media.serial` (upload; disguised file refused and removed; `.gif` refused) |
| D11 | **Film embed** | `parseFilmUrl` (YouTube watch, youtu.be, embed, shorts and live; Vimeo with an unlisted hash) → `youtube-nocookie.com/embed/…` or `player.vimeo.com/video/…?dnt=1`; sandboxed iframe in `FilmModal`, else COMING SOON; the editor refuses a link that names no video; `film.*` keys | media §Design 8 | `media.test` (parser); `admin-media.serial` film test (moves to the A9 hero spec) |
| D12 | **Old images to Blob** | `scripts/move-assets-to-blob.mjs --prefix <env> [--apply]`: dry run by default; size check; `head` skip; `put` with `allowOverwrite:false`; one transaction repointing the same ids (`storage='blob'`, url, blur); one audit row per file; idempotent | media §move-assets | `move-assets.test` (child process against the fake: dry run changes nothing; `--apply` uploads 39 files byte for byte; a second run sends nothing; `loadSections` returns the Blob URL with `blur`) |
| D13 | **File-sweep cron** (§12) | `/api/cron/media-sweep` `35 18 * * *` UTC, `maxDuration` 300, `CRON_SECRET` or 401, `?dry=1`: (a) purge rows 30 days in the trash, keeping RESTRICT rows (23001/23503); (b) delete blobs under the environment's own folder that no media row names and that are older than 24 h; a DB error aborts before any delete; no Blob configured → `{skipped}` | media §Design 4 | `cron-media-sweep.test`; `media-library.test` (own folder only, 24 h grace, other environment untouched, purge keeps RESTRICT); `vercel-crons.guard`; `check-prerender` UNCACHED |
| D14 | **CmsImage everywhere** (§6.3 item 7, R3) | Hero (`cmsPictureProps`, art-directed `<picture>`), Experiences, Heritage (no `fill`), RestaurantHero and the FilmModal poster through `next/image`; `blur` only when set; `remotePatterns` pinned to the store host when the token is known at build; SearchOverlay thumbnail escaped or optimized (L7-8) | media §R3 | lint warnings 19 → 14; DOM diff /en 12 lines, Tàya 2, privacy 0; visual 8/8 at ratio 0 (C4); `restaurant-pages.serial` src assertion |
| AC1 | **Checklist walk** | A table-driven E2E over the edit report's §1 map (every non-L, non-P8 row): EN edit in the admin → the guest's next load shows it in under 5 s → restore through History | edit §1 | B11 `content-checklist.serial.spec.ts`, plus each editor task's own E2E as it lands |
| AC2 | **No guest text outside the registry or DB** | `test/guards/guest-text.guard.test.ts` (oxc walk of `GUEST_SOURCES`; LOCKED 30 with reasons; PENDING 161 → 0); the LOCKED database-less pages need ruling R8 | edit §3(a) | the guard's 3 tests, plus B8's assertion that PENDING is `{}`; M8 (inline `aria-label`) → red |
| AC3 | **A file in use cannot be deleted** | One transaction: `SELECT … FOR UPDATE`, then the usage query over `MEDIA_REFERENCES` (all 12 FK columns), refuse with `in_use` and the list of users; `assertLiveMedia` (`FOR KEY SHARE`) in every saver serialises with the delete; RESTRICT stays the final guard | media §Design 3 | `media-library.test` (`MEDIA_REFERENCES` = `pg_constraint`, all RESTRICT; in-use refusal; two-connection race; mutation without the lock → red); `admin-media.serial` (chef.jpg refused with a "Section experiences" link) |
| AC4 | **Edit then delete an offer; restore both times** | `restoreOffer` with `side`; a delete row offers "Khôi phục mục đã xóa"; the offer comes back under the same id and place; linked bookings are not relinked (R5 of phase 6) | kit | `content-editors.test` ACCEPTANCE; `content-offers.serial` ACCEPTANCE (guest titles after each step; latency 86–140 ms locally, asserted < 5000 ms); M1 → red |
| X1 | **Every key, table and column has an editing screen** (§7.2 last line, §13) | `EDIT_SCREENS`, `COLUMN_SCREENS` | edit §3(b) | `editing-screens.guard` (27 cases); `editing-screens.test`; M5, M6 → red |
| X2 | **Placeholder/ICU validation** (§7.4) | `checkMessage(text, def.vars)`: syntax, missing, unknown, plural without `other`; Vietnamese messages | edit §2 | `icu.test`; `content-strings-admin.test`; M3 → red; E2E test 2 |
| X3 | **Upload safety** (§11) | Token only after session and permission; Origin check; type from the extension **and** the real bytes; 15 MB enforced by the store and by `registerMedia`; per-path token; blob host check on download; every `@vercel/blob` import goes through `blob.ts` with explicit credentials (new guard, A5) | media | `media-upload.test`; new `blob-imports.guard.test.ts` |

## 2. Spec deviations that need a ruling

Each item gives the proposed ruling and the cost if it is wrong.

- **R1. Two plans (7A, 7B), not one.** Proposed: yes, with the boundary of §3.0.
  - If wrong: a merged plan of 23 tasks overruns one SDD run.
- **R2. The concurrency token is a content hash** (§7.3 says "so sánh `updated_at`"): the first 32 hex characters of the sha256 of the canonical snapshot, without `meta`. Who and when still come from `updated_by`/`updated_at`. `content_strings` keeps a per-key `updated_at`.
  - Reason: `restaurants.updated_at` is shared with the booking screens. A booking-rules save no longer conflicts with an open content form; a content save still makes an open booking form conflict (accepted).
  - If wrong: false conflicts between the booking and content screens.
- **R3. Restore keeps each `*_i18n` row's `status`, `origin`, `ai_model` and `source_hash` from the snapshot.** It does not write `reviewed` (§5.1.4 "mọi lần lưu từ form admin").
  - If wrong: a restored machine translation would be marked as reviewed by a person (phase 8/9 data).
- **R4. §6.5 limits count published items only.** Hidden drafts are allowed. Highlights have a hard cap of 10 in total. A count below the minimum, or offers not a multiple of 3, only warns.
  - If wrong: the owner meant every row; that is a one-line change in `LIMITS` usage.
- **R5. `audit_log.entity_type` uses table names.** A reorder is `<table>` with `entity_id NULL`. A file's history (row + alt) is entity `media`; R19's alt follow writes a `media` row. `content_strings` uses `entity_id = key`.
  - If wrong: history lookups change shape. Decide now, because rows accumulate from the first save.
- **R6. Strings expire only `content:ui` or `content:legal`** (policy keys, or a version bump); `email.*` expires nothing (F3, F4). There are no per-section tags for strings.
  - If wrong: nothing visible (D2), only finer invalidation lost.
- **R7. Emails are editable in EN only in phase 7.** Staff emails default to Vietnamese (spec §3 defaults), so staff wording stays uneditable until phase 8. Alternative: open a VI tab on the emails screen only.
  - Owner question; if the owner says yes, there is about one extra day in A4.
- **R8. The database-less pages (`[lang]/error.tsx`, `[lang]/not-found.tsx`, `global-error`, `global-not-found`) stay LOCKED text** (§12: they render without the DB). AC2 counts them as locked.
  - If wrong: a cached fallback copy of their strings is needed (phase 10).
- **R9. Deleting an offer writes one `reservation_event` `edited` per booking it unlinks**, in the same transaction (spec §7.4 routes booking-side effects there; F9). It also keeps the ids in `before.meta.unlinked_reservations`. Restore never relinks.
  - If wrong: drop the events. The cost is low either way; the owner decides (L7-12).
- **R10. `site_settings.email` is read-only on the contact screen**, and edited only in Admin's `/admin/settings/notifications` (§7.2 lists "Email chung" under contact, which is Editor). It is where `staff.new` falls back, so an Editor could otherwise redirect booking mail.
  - If wrong: an Editor cannot change the shared inbox; an Admin does.
- **R11. Social platform labels become registry keys `social.<platform>`** (L7-15), with EN defaults equal to today's text, so nothing changes on screen. The owner may instead rule them brand text (LOCKED).
  - If wrong: about 10 keys to delete.
- **R12. ImagePicker uploads inline (spec §7.3), but alt text per language and the decorative flag are edited on the file's own screen** (`/admin/media/[id]`), linked from the picker. An alt belongs to the file and is shared by every use, so editing it inside one picker would silently change other pages.
  - If wrong: an inline alt editor in the picker later.
- **R13. `onUploadCompleted` is not wired** (§11 "dự phòng"). An upload never registered is swept after 24 h (§12). `handleUploadPresigned` gets a documented placeholder webhook key; the callback event is refused.
  - If wrong: a session-less callback route outside `/api/admin` in phase 10.
- **R14. Media delete is soft, with a 30-day purge by the sweep.** Restore un-deletes a trashed file the snapshot needs (C7); a version pointing at a purged file can no longer be restored (`missing_reference`).
  - If wrong: keep audit-referenced files longer (a sweep predicate).
- **R15. Environment folders inside the stores** (`production`, `preview/<branch-slug>`, `development`). The sweep lists only its own folder, and only Production runs the cron (Vercel Cron); the Preview/Dev store is swept by hand or not at all.
  - If wrong: preview leftovers accumulate (cost: storage only).
- **R16. New ActionCodes:** `limit` (params.max), `missing_reference`, `in_use` (+ `uses[]`) and `blob_not_configured`, beyond §7.4's four.
  - If wrong: they fold into `invalid`/`conflict` with a lost message.
- **R17. Admin CSP `connect-src` adds the Blob API** (`https://vercel.com/api/blob/`) for the browser's presigned PUT. `img-src` is unchanged, because thumbnails go through `/_next/image`.
  - If wrong: uploads fail in the browser (caught by E2E).
- **R18. No `next/image` `<Image>` and no guest components in the admin.** Thumbnails use `getImageProps` + `<img>` (one documented `oxlint-disable-next-line` in `_kit/Thumb`).
  - If wrong: the CSP blocks inline styles, flooding the console and the `watchCsp` tests.
- **R19. R3 with no baseline re-take** (C4).
  - If wrong: one planned, reviewed re-take inside A8, run with the owner's sign-off.
- **R20. Saving a value equal to the registry default deletes the `content_strings` row** (audit action `delete`), so a later code default still reaches the site.
  - If wrong: rows pin old defaults.
- **R21. `legal_versions` (migration 009) is append-only.** The version is the Da Nang date with `.2`, `.3` … for later changes that day, written only when the hash of the agreed EN text changes. Restoring old wording makes a new version. The privacy page shows `effective_on`.
  - If wrong: a lawyer may want "version = saved timestamp" (phase-5 T8.2 wording); the change is in the format only.
- **R22. Restaurants are created and archived, never deleted (F10).** "Thêm nhà hàng" creates `id = slug` (immutable), with `is_published false`, `booking_enabled false` and no periods; publishing requires a card image (SQL) and an EN `type_label` (app).
  - If wrong: the owner never adds restaurants; this is about half a day in A11.
- **R23. Film fields are editable on both the hero and sections screens through one writer** (C5).
  - If wrong: drop one screen's form.

## 3. Tasks in execution order

### 3.0 Boundary between the plans
- **7A ends** with:
  - the engine, kit, strings infrastructure (all guards live), legal/emails, media, upload and Blob, CmsImage, the sweep and the move script;
  - the hero/sections, offers and restaurants editors.
  - AC3 and AC4 are proven, with the README runbook for 009 and the Blob move.
  - The guest-text PENDING list has shrunk by the keys of 7A's screens.
- **7B starts** from a deployed 7A (009 applied, stores created, move done or pending; nothing in 7B depends on the move). It builds every remaining §7.2 screen, empties PENDING and `NOT_BUILT`, retrofits the older admin forms, and walks AC1.

**Every task ends green on the full gate (§4.10):**
- typecheck;
- lint exit 0 at the warning count of §4.10;
- unit + integration;
- reset → build → check-prerender → DOM diff;
- E2E `--retries=0`;
- visual 8/8 at ratio 0.

Each task moves its own PENDING entries in the same commit, and the guard's "no stale entry" test enforces it. The drafter verifies each task's Expected line in a clone before writing it, as in phase 6.

### 3.1 Plan 7A: engine, kit, strings, media, high-risk editors (12 tasks)

**A1. Guards and the content-admin engine (server, no UI).**
- **Guards first:**
  - L7-9: harden the legacy-columns guard (case-insensitive keywords, comma joins, `.js`/`.mts`);
  - the admin-pages guard bans `components/**` and the default `next/image` import under `app/admin`, and scans `.js`/`.jsx`;
  - `migration-008.test` hook timeout raised to 30 s.
- **Engine** (kit spike):
  - `lib/server/content-admin/snapshot.ts` (`ItemDef` with optional `i18n`, `readItem`/`readItems`, `snapshotToken`, `lockList`, order helpers, `writeItem` with `OVERRIDING SYSTEM VALUE`, `upsertTranslation`, FK/unique mapping);
  - `history.ts` (`listHistory`, `getAuditRow`, `listDeleted`);
  - `makeListEditor(def, {listKey, limit, toRow, validate})` factored from `offers.ts`;
  - `lib/admin/content-rules.ts`, `content-schemas.ts`, `history.ts`, `media-option.ts`;
  - ActionCodes `limit` and `missing_reference` with their Vietnamese messages;
  - the `CONTENT_ACTIONS` matrix scaffold in `require-permission.guard`.
- **Tests:**
  - unit (rules, schemas, history);
  - integration of the engine on the `OFFER` def: write, restore, a deleted item restored under its id, order restore, token conflict, FK → `missing_reference`.
- No guest or admin page changes. E2E and visual unchanged.

**A2. Form kit UI, the `/admin/content` index, and the offers editor (AC4).**
- `_kit/*`: `useSaveState`, `SaveBar`, `TranslatableField`, `TextField`, `SortableList`, `LimitNote`, `ImagePicker` (library radios; uploader slot empty until A6), `Thumb`, `HistoryPanel`, `RestoreButton`; the kit block in `admin.css`.
- `/admin/content` index (static list of built screens) and the nav item "Nội dung" (A6 adds "Thư viện" with its page); the nav test and the two E2E nav arrays are updated in both tasks.
- Offers editor: `/admin/content/offers`, `new` and `[id]`, with list, reorder, show/hide, delete, "Đã xóa gần đây", item History and order History.
- R9 events on delete (L7-12).
- L7-11:
  - the offer is shown in the admin booking screens (inbox row, detail) and in `staff.new` (`email.staff.new.label_offer`);
  - the drawer's stale "Offer: A" note is replaced when the guest picks offer B;
  - a test of the inclusive `valid_from` boundary.
- **Tests:** `content-editors.test` (offers part); `content-offers.serial` (ACCEPTANCE plus keyboard reorder); E2E `watchCsp`.

**A3. Strings infrastructure, with the proof moves (edit spike §2–§4, kit-based form).**
- **Dependencies and libraries:**
  - `intl-messageformat@^12.1.2`;
  - `lib/i18n/icu.ts`; hybrid `formatMessage`.
- **Registry:**
  - `ADMIN_SCREENS` (15) and `StringDef.label`;
  - `CLIENT_PREFIXES`/`CLIENT_KEYS`, `sectionKeys`/`Copy`/`HOME_KEYS`, `keysForScreen`;
  - the registry comes off the client (`booking-errors`).
- **Save path:**
  - `strings-admin.ts` (`loadScreenStrings`, `validateValue`, `saveStrings`: per-key advisory lock, skip untouched fields, default ⇒ delete; `tagsForStrings`);
  - `content/actions.ts`;
  - `StringsPanel`/`StringsForm` on `useSaveState`/`SaveBar`;
  - screens `ui-text`, `stories` (copy only; the list comes in B3) and `heritage`.
- **Guards:**
  - `guest-text.guard` with LOCKED (R8 applied) and PENDING;
  - `editing-screens.guard` and `editing-screens.test` (`COLUMN_SCREENS`, `EDIT_SCREENS`, `NOT_BUILT`).
- **Proof moves:** `stories.*`, `heritage.*`, `search.*` (ICU plural), `meal.*` (`MEAL_LABELS` deleted), `finder.all_*/any_*`, plus **`offers.*`** (title, lede, cta, `price_plus_plus`, `price_net`, `note`) on the offers screen; `LOADERS.offers` gains `content:ui`.
- **Gate:** DOM diff 0 lines; visual 8/8; `content-strings.serial` tests 1–2.

**A4. Strings History and restore, legal versions, the emails screen.**
- Strings History per key and restore through §7.4. The token is `updated_at`; restore runs `validateValue` again. Restoring a default deletes the row.
- Migration `009_legal_versions.sql` (from the spike), with:
  - `test/integration/migration-009.test.ts` (fresh, re-run, seed hash, CHECK);
  - `db/checks/preflight-009.sql` and `postcheck-009.sql`;
  - `reset-db.mjs` running it;
  - `CONTENT_TABLES`/`SAVE_TAGS`/`LOADERS.policyVersion`.
- Policy versions:
  - `policy-version.ts` (`recordPolicyVersion` in the save and restore transactions; `AGREED_KEYS` in `lib/legal.ts`);
  - `create.ts` stores the newest version;
  - the privacy page shows `effective_on` (DOM identical).
- `/admin/content/legal`.
- `/admin/content/emails`, grouped by event (CSS `grid-column: 1/-1`), with the preview route (own CSP) and the `submitKeepingValues` `formaction` passthrough.
- Ledger items:
  - T5.1 (`staff.new` intro taken from the created event);
  - T5.3 (one guest email key list);
  - T5.5 (a reviewed `vi` row beats the registry);
  - T8.1 (tags via `tagsForStrings`);
  - T8.2 (versions);
  - T8.4 (`WithEmail` links every `{email}`).
- **Tests:** `content-strings.serial` tests 3–4; `content-strings-admin.test`.

**A5. Media foundations and the fake Blob in the gate.**
- **Dependencies:** `@vercel/blob@^2.8.0`, `sharp@^0.35.5` (direct), `undici@^6.29.0` (dev).
- **Libraries:**
  - `lib/media/rules.ts` and `film.ts`;
  - `lib/server/media/blob.ts` (explicit credentials only; `BlobNotConfiguredError`);
  - `measure.ts` (`limitInputPixels` set).
- **Test helpers:** `fake-blob.ts`, `fake-blob-cli.mjs`, `blob-redirect.mjs` (+ `.d.mts`).
- **Playwright wiring (C15):**
  - `webServer` becomes `[fake-blob, app]`;
  - the app's `env` adds the fake token, `VERCEL_BLOB_RETRIES=0`, `FAKE_BLOB_ORIGIN` and `NODE_OPTIONS=--import=<abs>/test/helpers/blob-redirect.mjs`;
  - a browser `context.route` fixture forwards the Blob hosts to the fake and aborts other external hosts.
- **`next.config.ts`:** `images.remotePatterns` (store host or wildcard) and `serverActions.bodySizeLimit: '2mb'`.
- **Admin CSP** `connect-src` (+ `csp.test`, the `admin-security` expectation).
- ActionCodes `in_use` (+ `uses`) and `blob_not_configured`.
- **New guard:** `@vercel/blob` may be imported only by `lib/server/media/blob.ts`, `scripts/move-assets-to-blob.mjs`, the client uploader and the upload route (`/client` subpath).
- **Tests:** `media.test`, `measure.test`.

**A6. Media library, upload, and the in-use refusal (AC3).**
- `lib/server/media/library.ts`:
  - `MEDIA_REFERENCES` (12, checked against `pg_constraint`);
  - `listMedia`, `usage`;
  - `assertLiveMedia` (`FOR KEY SHARE`);
  - soft delete with the refusal;
  - media as an ItemDef (entity `media`, R5), with alt and decorative under the hash token.
- `register.ts`; the upload route; media actions (delete redirects to `/admin/media?deleted=1`).
- Pages:
  - `/admin/media` (grid with `Thumb`, filter, uploader);
  - `/admin/media/[id]` (EN alt, decorative, usage list, History, delete, "Khôi phục mục đã xóa");
  - the nav item "Thư viện" (`content:read`).
- `ImagePicker` embeds the uploader (R12).
- `assertLiveMedia` wired into every saver built so far (offers has no media; the engine's restore un-deletes a trashed file, C7).
- **Tests:** `media-library.test`, `media-upload.test`, `admin-media.serial` (+ `watchCsp`), and the `CONTENT_ACTIONS` rows.

**A7. media-sweep cron and the move-to-Blob script.**
- `sweep.ts` and `/api/cron/media-sweep`:
  - `vercel.json` entry and `vercel-crons.guard`;
  - `check-prerender` UNCACHED;
  - `?dry=1`; `{skipped}` when not configured.
- `scripts/move-assets-to-blob.mjs`.
- **Tests:** `cron-media-sweep.test`, `move-assets.test`.
- README runbook sections: manual preview sweep, then the move (dry run → `--apply` per environment → redeploy).

**A8. CmsImage for every content image (R3, R19).**
- Hero (`cmsPictureProps`), Experiences, Heritage, RestaurantHero and the FilmModal poster; `mediaJson` `blur`; `preload` instead of `priority`.
- L7-8: the SearchOverlay thumbnail goes through the optimizer (or a CSS-escaped URL with a Blob pathname check).
- `visual-nojs.spec` waits for images like `visual.spec` (the reviewed test change).
- The `restaurant-pages.serial` src assertion is updated.
- **Gate:** lint **14** warnings from here; DOM diff /en 12, Tàya 2, privacy 0 (the new reference for every later task); visual 8/8 at ratio 0 on a cold `next start` (run once fresh, once warm, both 8/8). If either is not 8/8, stop for R19's fallback.

**A9. Sections, hero and film editors.**
- `/admin/content/sections`: toggles with restaurants locked on; images and links of experiences, heritage and film via `saveSection` (C5).
- `/admin/content/hero`:
  - slides as a list: 1–5, slide 1 needs a mobile crop, `image_mobile_id` only on slide 1;
  - `hero.*` keys (L7-16, together with the hidden home `<h1>`);
  - `site_settings.hero_autoplay_ms`;
  - the film part (poster, link, on/off) and the `film.*` keys (iframe title, COMING SOON, both aria labels).
- L7-1 E2E: hide the hero by section and, separately, by unpublishing every slide. At 1280, 900 and 390 px assert:
  - an opaque header at scrollY 0;
  - exactly one `h1`;
  - the first section at or below the header.

  Then restore through the save and History, and assert the transparent header and the Hero `h1` are back.
- The film E2E moves here from `admin-media.serial`.

**A10. Restaurant content editor `/admin/restaurants/[id]`.**
- The kit's aggregate (row, EN i18n, cuisines, highlights), with a subnav to `/booking`.
- Rules:
  - a page needs a portrait and an EN story;
  - highlights at most 5 shown and 10 in total;
  - slug unique;
  - a menu PDF (picker, kind `pdf`) or a menu link, not both;
  - the name warns over 24;
  - hidden-button warnings.
- R19 alt follow (audited as `media`).
- `detail.*` keys (MobileBar, RestaurantHero; `highlights_title{name}`, `more_title{destination}`).
- SEO fields `seo_title`/`seo_description`/`og_image_id`.
- Ledger items:
  - L7-3: one SQL predicate for "has a page" (live portrait) shared by `hasDetailPage`, `loadDetailSlugs` and `loadRestaurantDetail`, plus the Task 7 loader tests;
  - L7-5: the restaurant's own phone through `loadBookingEmailData`, and the `/api/availability` 404 for a hidden restaurant.
- **Tests:** `content-restaurant.serial`; integration from the kit spike.

**A11. Restaurants list `/admin/restaurants`.**
- "Thêm nhà hàng" (R22), publish/archive, reorder (SortableList, order History).
- `restaurants.*` keys: title, view all, `showing{shown,total}`, empty states, card labels.
- L7-4: `restaurantsWithoutRecipient` uses the computed `bookingEnabled`.
- An archived or unpublished restaurant disappears from the guest catalogue, the page and the booking API, and comes back on restore.
- **Tests:** integration and E2E.

**A12. 7A acceptance, README and handoff.**
- Three full E2E runs (one with `TZ=UTC`).
- AC3 and AC4 re-run on a fresh reset.
- Mutations stay red: no `updateTag`, no token, no i18n write, no in-use check, no `assertLiveMedia` lock.
- README:
  - "Migration 009 (phase 7A)": preflight → migrate → postcheck, dev → production;
  - the Blob store setup;
  - the move runbook;
  - the first-preview Blob checks.
- The 7A ledger draft; the deferred list carried to 7B.
- Remove the DOM-diff base worktree only at the end of 7B.

### 3.2 Plan 7B: remaining editors, end of the registry move, form retrofit, AC1 (11 tasks)

**B1. Destinations editor (L7-2, D1).**
- List with text id: 2–5, at most 1 teaser, phone pair, address and card text.
- `destinations.*` keys, including `count{count, plural}`.
- L7-2: `AND d.is_published` in `loadRestaurants`, `loadRestaurantDetail`, `loadDetailSlugs` (+ `content:destinations` tag), `loadOffers` (+ tag) and `bookingEnabled`.
- A destination save also expires the booking-rules tags of its restaurants (`tagsForSave`).
- A warning shows how many published restaurants a hide would remove.
- L7-10: `listDestinationOptions` moves into the content query layer.
- **Tests:** loader and booking tests.

**B2. Cuisines editor.**
- List with text id (soft max 10), picker.
- `cuisines.*` keys.
- L8-2 is left for phase 8.

**B3. Experiences and stories list editors.**
- Experiences: 1–5, link (https or `#section`); `experiences.*` keys.
- Stories: at most 4, picker, date, category.
- L7-7: no leading " · ", by joining only non-empty parts.
- The owner's Experiences links are entered as data.

**B4. Navigation editor and the chrome `ui.*`/`common.*` keys.**
- At most 6 items; labels warn over 14 and refuse over 18; an item hides with its section.
- Header, MenuOverlay and MobileBar keys (`ui.*`); `(guarded)/not-found` (`common.not_found/back_home`).
- `CLIENT_KEYS` grows: measure the payload, about +1.5 KB gzip expected.

**B5. Contact editor.**
- `social_links` list (at most 6, no i18n, `visible_locales` untouched); `social.*` (R11).
- `footer.tagline/member`; footer venue lines (L7-7: a venue needs a name).
- `site_settings.email` shown read-only (R10).
- L7-6: `saveInbox` goes through `tagsForSave`.

**B6. Booking screen and drawer copy.**
- `booking.*`, `finder.*`, `form.*`; the drawer copy; `booking.guests_count`, `slot_left{count}` and slot aria labels as ICU.
- `site_settings.default_occasion` and `default_restaurant_id`.
- The inline field errors reuse `error.invalid_*`.
- Guest drawer residuals from the phase-4 ruling:
  - the calendar retry no longer restarts on REQUEST BOOKING;
  - the strip live region stays mounted;
  - '−' at 1 guest uses `aria-disabled` and keeps focus.

**B7. SEO screen.**
- `seo.*` keys feed `generateMetadata` (home, `page_title{page}`, `not_found_title`).
- The OG image picker.
- L7-13: restaurant pages without their own description or OG image fall back to the SEO screen's values, never silently to the home page's.
- **Tests:** E2E on `<title>` and `og:`.

**B8. ui-text completion: PENDING and NOT_BUILT empty.**
- The rest of `ui.*`, `common.*`, `error.restaurant_fallback` and the restaurant filter copy.
- Every key has a Vietnamese `label` (made required in the type).
- Assert guest-text PENDING `{}` (AC2) and `NOT_BUILT` `[]` (X1).

**B9. Form-kit retrofit of the booking admin (phase-4 and phase-5 ledger items).**
- Phase 4:
  - NoteForm and TransitionPanel keep typed text;
  - EditReservationForm no longer keys on version;
  - the ADM-3 unsaved guard;
  - QuickConfirm gets "Tải lại" and a stale alert hides;
  - `aria-invalid` and per-row period errors;
  - duplicate names in the periods editor;
  - number inputs;
  - a non-overlapping default for "Thêm ca";
  - the overbooking wording;
  - closure titles show meals;
  - `.a-inline` merged.
- Phase 5:
  - T6.6 aria links; T6.9 locale names;
  - T7.4–T7.6 resend labels, link and disabled state;
  - T12.4 and T12.5;
  - admin F5 (last five searches);
  - `useId` for duplicate ids;
  - TransitionPanel for a past sitting.

**B10. Form-kit retrofit of the auth, users and settings forms (phase-3 items).**
- InviteForm and AcceptForm echo values on refusal.
- A test of the invite "created but not sent" alert.
- ResetForm's invalid-token link.
- The users table: `td.a-actions` flex, and error placement.

**B11. AC1 walk, closing measurements, README and ledger.**
- `content-checklist.serial.spec.ts`: one row per non-L, non-P8 item of the edit report's §1 map, run as the Editor. Each row does the EN edit, checks the guest shows it in under 5 s, then restores through History.
- L7-17: an FK coverage test for every delete and restore path.
- L7-18: the R15 RSC-404 race measured at real save rates (hero, offers and stories saves while guests navigate), with the result recorded.
- Three full E2E runs.
- README: editors guide pointers.
- The phase-7 ledger.
- Remove the DOM-diff base worktree.

## 4. Global constraints for the plans

### 4.1 Safety, environment, commands
- `.env.local` points at the **shared/production Neon DB**.
  - Never run `npm run db:migrate`, `npm run db:psql`, `npm run dev`, `vercel env pull`, `vercel link`, or any command that reaches Neon, Vercel (Blob included), an SMTP server or another external service.
  - The plans never apply 009 to Neon and never run the move script against a real store; the controller does both (§8).
  - The npm registry is the only network use, and only in A3 and A5 to install the named packages.
- No `.vercel/` directory may exist in the working tree. `@vercel/oidc` would mint a token through the Vercel API (F13).
- Every build, `next start`, E2E and visual run uses the phase-5/6 **EXTENDED** prefix, plus Blob blanks (process env beats `.env.local` even when empty):
  ```bash
  CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= BLOB_READ_WRITE_TOKEN= BLOB_STORE_ID= BLOB_WEBHOOK_PUBLIC_KEY= VERCEL_BLOB_API_URL= NEXT_PUBLIC_VERCEL_BLOB_API_URL= VERCEL_BLOB_CALLBACK_URL= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test
  ```
  For `next start` and E2E, add:
  ```bash
  BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson CRON_SECRET=$(openssl rand -hex 16) FAKE_BLOB_SECRET=$(openssl rand -hex 16) FAKE_BLOB_PORT=3212 E2E_PORT=3210
  ```
  - From A5, `playwright.config.ts` starts the fake (`node test/helpers/fake-blob-cli.mjs`) and passes these to the app only:
    - `BLOB_READ_WRITE_TOKEN=vercel_blob_rw_fakestore_${FAKE_BLOB_SECRET}`
    - `VERCEL_BLOB_RETRIES=0`
    - `FAKE_BLOB_ORIGIN=http://127.0.0.1:3212`
    - `NODE_OPTIONS=--import=<absolute repo>/test/helpers/blob-redirect.mjs`
  - The config refuses to start without `FAKE_BLOB_SECRET` (≥ 16 characters), like the `CRON_SECRET` check.
  - The build and the visual server run with the Blob variables blank. `remotePatterns` then falls back to the wildcard host, and no content image is a Blob URL locally.
- Local DBs only:
  - `furama_cuisine_test` (integration);
  - `furama_cuisine_e2e_test` (build, E2E, visual);
  - tests create `furama_cuisine_migrate009_test` (A4) plus the existing `…migrate004–008_test` and `…seed008_test`;
  - `TEST_DB_TAG=<x>` renames them to `…_<x>_test`;
  - reset with `RESET_DATABASE_URL=postgres://localhost:5432/<name> node scripts/reset-db.mjs`, which runs 001–009 from A4.
- Ports: E2E `3210`, visual `3211`, fake Blob `3212` (3200–3299 are for agents; CI uses 3100, and CI's fake uses 3102). Run `lsof -nP -iTCP:<port> -sTCP:LISTEN` before; it must print nothing. Run `lsof -ti tcp:<port> | xargs kill` after.
- zsh rules (phase 6): no argument starting with `=`; quoted globs; paths with brackets or parentheses in double quotes; SQL in heredocs.
- `next build` reads the 008/009 tables, so always reset the E2E DB before building.
- Empty the email log before every Playwright run: `rm -f "${TMPDIR:-/tmp}/furama-e2e-emails.ndjson"`.

### 4.2 Git
- On `main`, one commit per task, no push, `git add` named files only.
- Untracked and left for the controller: the plan files and this folder.
- Commit messages end with the session's attribution line.

### 4.3 Next 16 and TypeScript 7 (phase-6 rules, plus)
- Read `node_modules/next/dist/docs/` before using a Next API; cite `file.md:line`.
- `updateTag` only inside Server Actions. The cron, the sweep and any route handler use `revalidateTag(tag, 'max')`. The move script cannot revalidate, hence the redeploy.
- Cached loader rules are unchanged (`'use cache'`, `cacheLife`, `cacheTag(...LOADERS.x.tags, TAGS.i18n(locale))`). Never import a cached wrapper into Vitest.
- `requireEnabledLocale` comes first in every guest page. A page that adds `getStrings(locale, KEYS)` reads it in parallel **after** that call.
- Admin:
  - `instant = false`; `requirePagePermission` first; actions start with `requirePermission`; route handlers start with `requirePermission`, then the Origin check;
  - no guest components, no `<Image>` (R18);
  - forms with `onSubmit` say `method="post"`;
  - `useId` for every id;
  - code rule 9: the `useActionState` holder sits above the token-keyed fields.
- zod 4: a checkbox is `z.literal('on').optional()`. `z.config(z.locales.vi())` stays.
- TS 7 weak-type trap: type env parameters as `Record<string, string | undefined>`; `import sharp, { type Metadata } from 'sharp'`; `import { Client } from 'pg'` in `.mjs`.
- `@vercel/blob` imports follow the A5 guard; every call passes explicit credentials. No `onUploadProgress` (streamed bodies).
- SQL identifiers in the engine come only from `ItemDef` constants; snapshots reach SQL only as jsonb parameters. No backslashes in SQL template literals.
- Code comments in English, explaining why.

### 4.4 Versions
- **Added:**
  - `intl-messageformat@^12.1.2` (A3);
  - `@vercel/blob@^2.8.0`, `sharp@^0.35.5` (direct, already installed through next) and `undici@^6.29.0` (dev) in A5.
- **Unchanged:** `next@16.3.7`, `react@19.3.0`, `typescript@7.0.2`, `pg@8.23.0`, `zod@4.6.5`, `vitest@5.0.3`, `@playwright/test@1.63.0`, `oxlint@1.86.0`, `oxc-parser@0.152`.
- Node 22.22 locally, 24 on CI and Vercel; Postgres 18.3 locally.

### 4.5 Names
- **Migration:** `db/migrations/009_legal_versions.sql` (table `legal_versions(version PK, effective_on, text_sha256, created_at, created_by)`, seed `2026-10-03` / `f49aa3f5…10d2`), with `db/checks/preflight-009.sql` and `postcheck-009.sql`.
- **Admin routes:**
  - `/admin/content` and `/admin/content/{offers,offers/new,offers/[id],ui-text,stories,heritage,legal,emails,sections,hero,destinations,cuisines,experiences,navigation,contact,booking,seo}`;
  - `/admin/media`, `/admin/media/[id]`;
  - `/admin/restaurants`, `/admin/restaurants/[id]`.
- **API routes:** `/api/admin/media/upload`, `/api/admin/emails/preview`, `/api/cron/media-sweep`.
- **Libraries:**
  - `lib/server/content-admin/{snapshot,history,offers,restaurants,media-options}.ts` (+ one file per list);
  - `lib/admin/{content-rules,content-schemas,history,media-option,content-screens}.ts`;
  - `lib/i18n/icu.ts`;
  - `lib/server/content/{strings-admin,policy-version}.ts`;
  - `lib/media/{rules,film}.ts`;
  - `lib/server/media/{blob,measure,register,library,sweep}.ts`.
- **Test helpers:** `test/helpers/{fake-blob.ts,fake-blob-cli.mjs,blob-redirect.mjs,blob-redirect.d.mts}`.
- **Script:** `scripts/move-assets-to-blob.mjs`.
- **Kit:** `app/admin/(shell)/_kit/*`, `app/admin/(shell)/content/_ui/{StringsPanel,StringsForm}.tsx`.
- **Audit `entity_type`:** the table name. Reorder: `<table>` with `entity_id NULL`. Files: `media`. Strings: `content_strings` with key and locale `en`. Sections: `sections` with the section key. Policy versions: `legal_versions`.

### 4.6 Tags
- Writes go through `tagsForSave(tables, restaurantId)`, plus:
  - `media` when R19 moved an alt;
  - `booking-rules:<id>` when a restaurant's visibility changed;
  - from B1, the booking-rules tags of a destination's restaurants.
- Strings use `tagsForStrings` (R6). `LOADERS.offers` gains `content:ui` (A3), then `content:destinations` (B1); `LOADERS.detailSlugs` gains `content:destinations` (B1); `LOADERS.policyVersion` is `content:legal` (A4).
- `check-prerender`:
  - layout and page tags as in phase 6, plus `content:legal` on `/en` and the booking pages if `getPolicyVersion` reaches them (verify in A4);
  - `UNCACHED` += `/api/cron/media-sweep`, `/api/admin/media/upload`, `/api/admin/emails/preview`.

### 4.7 Constants
- **Uploads:**
  - `MAX_UPLOAD_BYTES = 15728640`; `UPLOAD_URL_TTL_MS = 600000`; types jpeg/png/webp/avif/pdf;
  - pathname `^<prefix>/media/<uuid v4>/<kebab slug>.(jpg|png|webp|avif|pdf)$`; moved files `<prefix>/assets/<file>`;
  - prefix: `production` when `VERCEL_ENV=production`, `preview/<slug of VERCEL_GIT_COMMIT_REF>` on previews, `development` otherwise;
  - blur ≤ 16 px WebP; sharp `limitInputPixels` 50 000 000.
- **Sweep:** grace 24 h, trash purge 30 days, cron `35 18 * * *`, `maxDuration = 300`.
- **Tokens and locks:**
  - snapshot `v: 1`; token = the first 32 hex characters of the sha256 of the canonical JSON without `meta`; `'deleted'` for a gone item;
  - advisory keys `hashtext('content:'||list)` and `hashtext('content_strings:'||key)`;
  - `sort_order` written as 10, 20, …; history limit 30.
- **Limits:**
  - `LIMITS`: hero 1–5, destinations 2–5 (teaser ≤ 1), stories ≤ 4, offers ≤ 6 (multiple of 3 advised), experiences 1–5, cuisines ≤ 10 (soft), highlights ≤ 5 shown and ≤ 10 total (warn below 2), nav ≤ 6, socials ≤ 6;
  - `LENGTHS`: nav 14 warn / 18 refuse; restaurant name 24 warn; translation 1.3× EN warn;
  - `charCount` counts code points.
- **Film:** `https://www.youtube-nocookie.com/embed/<id>?autoplay=1&rel=0` or `https://player.vimeo.com/video/<id>?autoplay=1&dnt=1[&h=<hash>]`.
- **Legal version:** `^\d{4}-\d{2}-\d{2}(\.\d{1,3})?$` (Da Nang date).
- Phase-6 constants unchanged.

### 4.8 Code rules (phase 7)
1. Every content write follows D2. No raw `updateTag(TAGS.x)` outside `tagsForSave`/`tagsForStrings` (a grep guard from A1, with phase 5's `saveInbox` allowlisted until B5 closes L7-6).
2. Every saver that sets a media id calls `assertLiveMedia` in its transaction.
3. A new guest-visible string goes into the registry with `screen`, `vars`, `context` and `label`, never inline. The guest-text guard enforces this, and PENDING only shrinks.
4. Every new content column has a DEFAULT, or is nullable, so a restore from an older snapshot cannot fail (snapshot drift, kit risk 3). A guard in `editing-screens.test` checks columns added after 009.
5. History restore re-applies today's rules and limits; it never trusts the snapshot.
6. Admin thumbnails only through `_kit/Thumb`.
7. Rules 1–7 of phase 6 still apply, except rule 6: new and moved strings now go into the registry.

### 4.9 E2E data map (serial specs run in `desktop-serial`, `workers: 1`; each restores through the UI in `finally`)

| Spec | Data | Restore |
|---|---|---|
| `content-offers.serial` (A2) | offer 1 title edited, restored, deleted, restored; offers order | History restore (same id); order History |
| `content-strings.serial` (A3, A4) | `stories.title`, `search.popular`, a legal key, an unsaved email subject | "Khôi phục mặc định"; extra `legal_versions` rows deleted first |
| `admin-media.serial` (A6) | a per-run PNG (base36 name); `chef.jpg` delete attempt | the soft-deleted upload stays in the trash (swept by nothing locally) |
| `content-hero.serial` (A9) | hero section hidden; then all slides unpublished; film link | save back plus History (R21) |
| `content-restaurant.serial` (A10) | taya-house name and highlights | History restore |
| `restaurants-list.serial` (A11) | a new restaurant `e2e-<base36>`; archive and restore | archived at the end (never deleted, F10) |
| B1–B7 per-editor specs | one row or key each | History restore |
| `content-checklist.serial` (B11) | every checklist row | History restore after each row |
| `restaurant-pages.serial` (A8 edit) | src assertion `/_next/image?url=%2Fassets%2Fr-the-fan.jpg&` | as phase 6 |

### 4.10 Gate and baselines
The gate commands are phase 6's (plan lines 150–165) with the §4.1 prefixes, plus the fake Blob through Playwright from A5.

Baseline at `c896b13`:

| Gate | Value |
|---|---|
| unit + integration | **83 files, 1039 tests** |
| E2E | **168 passed + 1 skipped** |
| visual | **8 passed** |
| lint | exit 0, **19 warnings** |
| DOM diff vs a `c896b13` build | **0 lines** |

The DOM-diff base is built once in A3, outside the repo (`${TMPDIR:-/tmp}/fc-base` at `c896b13`), with the phase-6 normaliser. Expected diff:
- 0 lines on the three pages until A7;
- from A8: exactly /en 12 lines, `/en/restaurants/taya-house` 2, `/en/privacy` 0.

Lint stays at 19 warnings until A8, then **14**.

Spike end points: kit 87/1072 and 171 + 1; media 89/1079 and 172 + 1; edit 88/1112 and 172 + 1. Estimates: end of 7A about 100 files / about 1200 tests and about 185 + 1 E2E; end of 7B about 110 files / about 1300 tests and about 205 + 1. The drafter fixes each task's exact Expected line from a verified clone.

Never run `--update-snapshots`. R19's fallback re-take is the only exception, and only with the owner's sign-off.

## 5. Review focus: five conditions most likely to bite

1. **An edit that does not reach guests, or reaches the wrong language.**
   - Every action calls `updateTag` for `tagsForSave`/`tagsForStrings` after COMMIT (mutation M1 must stay red in the offers, strings and hero specs).
   - Each loader's tags cover what it reads, especially the new `getStrings(HOME_KEYS)` on pages and `content:ui` on `LOADERS.offers`.
   - A form save writes only the `en` row with `reviewed`/`human` and never deletes other locales' rows. A restore rewrites all locales from the snapshot, filtered to existing locales.
   - `email.*` is uncached by design (F4).
   - `LOADERS.detailSlugs` and `offers` gain `content:destinations` in B1.
   - Check the guest latency assertion (< 5 s) in each editor's E2E.
2. **A restore that loses `*_i18n` rows or ids.**
   - `writeItem` must insert with `OVERRIDING SYSTEM VALUE` under the original id. It must rewrite every `*_i18n` row of the snapshot, not only EN (M2 red), and re-apply rules (limit, EN title, FK → `missing_reference`).
   - Order restore keeps new items after old ones.
   - The restaurant aggregate restores deleted highlights under their ids, and never touches booking columns.
   - A trashed file is un-deleted (C7).
   - `content_strings` restore re-validates ICU, and bumps the policy version when it should.
   - The snapshot-drift rule (§4.8 rule 4) holds.
3. **Deleting a file in use.**
   - `MEDIA_REFERENCES` equals `pg_constraint` (test).
   - The delete takes `FOR UPDATE` before the usage query.
   - Every saver calls `assertLiveMedia` (`FOR KEY SHARE`); grep every new saver, B1–B7 included.
   - The sweep's hard delete catches 23001 and 23503 and keeps the row.
   - The sweep lists only its own environment's folder and never runs with another environment's token.
   - Restore pointing at a purged file → `missing_reference`, never a dangling FK.
4. **An upload accepted without permission, or with a dangerous type or size.**
   - The upload route calls `requirePermission({content:['update']})` before reading the body, then the Origin check, then the strict pathname regex.
   - The token is scoped to that path, type, 15 MB and 10 min.
   - `registerMedia` trusts only the pathname: `head`, a host-checked download ≤ 15 MB, sharp's real type must equal the extension's (a mismatch deletes the blob), and a PDF is checked by signature.
   - The callback event is refused.
   - `@vercel/blob` is imported only where the guard allows, always with explicit credentials, so there is no OIDC refresh.
   - No SVG, GIF or HTML type anywhere.
   - The thumbnail goes through `/_next/image` (no raw Blob URL in `img-src`).
5. **A guest string left outside the registry.**
   - The guest-text guard runs on every task; PENDING only shrinks and is `{}` at B8.
   - LOCKED entries each carry a reason and match R8/R11.
   - Watch the blind spots: lone lowercase words in object maps, single letters, and new guest lib files outside `GUEST_SOURCES` (extend it in review).
   - Every moved default equals today's text exactly, casing included (DOM diff 0 or R3-only, visual 8/8).
   - ICU templates keep the phase-2 behaviour for plain `{name}`.
   - Registry text never reaches a client chunk (check `.next/static` once per plan).

## 6. Known risks

1. **The real Blob service is unverified** (by rule). Check on the first preview:
   - CORS on `https://vercel.com/api/blob` for our origin;
   - an overwrite refused without the allow-overwrite parameter;
   - `x-content-type` against `allowedContentTypes`;
   - public access; the `head`/`list` shapes;
   - whether connecting a store sets `BLOB_WEBHOOK_PUBLIC_KEY` or only `BLOB_STORE_ID` + OIDC (the `{storeId}` path is untested);
   - the Origin check behind a custom domain or Deployment Protection.
2. **sharp memory** on a 15 MB, 20 000 px upload in a Vercel function (with `limitInputPixels` set). Check the function's memory on the first preview.
3. **The Preview/Dev store is never swept automatically** (cron is Production only); local runs must never hold its token (README rule).
4. **Uploads on a preview vanish when its DB branch resets** (they become orphans in its folder and are swept after 24 h when swept).
5. **Token coupling:** a content save still makes an open booking form conflict (R2); in phase 8 a VI save makes an open EN form stale, because the hash covers every locale.
6. **D2 / L7-18:** every hero, offers or stories save expires every guest page; the R15 RSC-404 race at real save rates is measured only in B11.
7. **Bundle and payload:** `intl-messageformat` is about +10.5 KB gzip, offset by taking the registry off the client (net about +2.9 KB). `CLIENT_KEYS` grows to about 110 (about +1.5 KB gzip RSC per page). An optional `no-parser` alias is untested.
8. **`beforeunload` does not guard client navigation** inside the admin. Playwright dismisses `beforeunload`, so specs save before navigating.
9. **History has no pager** (30 rows), and the order history names versions by ids.
10. **Scanner blind spots** (risk 8 of the edit report); review must extend `GUEST_SOURCES`.
11. **After the move on a real DB,** `/assets/…` keyed SQL (E2E fixtures, a manual 008 re-run) no longer matches there; E2E is local-only. Re-running 008 by hand would add harmless duplicate static rows.
12. **Production image optimisation differs from local sharp;** the baselines are local, so they are unaffected.
13. **The `migration-008` hook flake** (mitigated in A1) and the soft-404 caching race R14 (`routing.spec`) can still flake once.
14. **Owner answers pending:** R7, R8, R9, R11; the offers' end dates and lede wording (phase-6 #9); the Experiences links; the film URL; high-resolution originals; menu PDFs.
15. **Legal:** restoring old wording creates a new policy version (R21); the owner or a lawyer confirms.

## 7. Deferred items

**Closed in phase 7:**
- Phase-6 L7-1 … L7-18, all assigned in §3: L7-1 A9; L7-2 B1; L7-3 A10; L7-4 A11; L7-5 A10; L7-6 B5; L7-7 B3/B5; L7-8 A8; L7-9 A1; L7-10 B1; L7-11 A2; L7-12 A2 (R9); L7-13 B7; L7-14 kit; L7-15 B5; L7-16 A9; L7-17 and L7-18 B11.
- Phase-6 D3 (F-A E2E), R3 (CmsImage) and R19 (alt follows rename).
- Phase-5 F5, T5.1, T5.3, T5.5, T6.6, T6.9, T7.4–T7.6, T8.1, T8.2, T8.4, T12.4, T12.5, duplicate ids, and the bodySizeLimit scoping (closed as not feasible, C11).
- Phase-4 form, drawer and CSS items (B6, B9).
- Phase-3 guard and form items (A1, B10).

**Carried to phase 8 (i18n):**
- `TranslatableField` tabs, status badges and the 1.3× check per locale; `StringsForm` posting per locale (`v:<key>` gains a locale).
- A per-locale token (hash only the shown locales).
- The emails VI tab (if R7 stays EN-only); per-locale menu PDFs in the UI; per-locale legal versions (T8.3).
- `social_links.visible_locales` on locale rename (L8-6).
- L8-1 … L8-8 unchanged.
- The translation coverage on the dashboard.
- Draft Mode preview of a disabled language.
- ICU plural rules checked per locale.

**Carried to phase 9 (Vertex AI):**
- "Dịch từ EN" in `TranslatableField`.
- The AI alt writer sets `status='machine'`, `origin='ai'` (L9-1), honouring R3's restore semantics.

**Carried to phase 10 (hardening):**
- Guest CSP:
  - `frame-src www.youtube-nocookie.com player.vimeo.com`;
  - `img-src` for the Blob host only if a raw Blob URL remains (none after A8);
  - `style-src` for the blur placeholder's inline background on Blob rows.
- An optional `onUploadCompleted` fallback route (R13).
- A scheduled or manual sweep for the Preview/Dev store.
- The first-preview Blob checks (risk 1) and the sharp memory check.
- A router-level unsaved-changes guard; a History pager.
- L10-1 … L10-7 unchanged.
- Dropping the phase-1 columns and `SLOTS`.

## 8. Owner and controller runbook

**Owner (Vercel dashboard), before A12's README is used:**
1. Storage → Create Database → **Blob**: create `furama-cuisine-production`, access **Public**, and connect it to **Production only**.
2. Create `furama-cuisine-preview`, access **Public**, and connect it to **Preview and Development only**.
3. Project → Settings → Environment Variables: report the **names** of the Blob variables in each environment (`BLOB_READ_WRITE_TOKEN`, and whether `BLOB_STORE_ID` or `BLOB_WEBHOOK_PUBLIC_KEY` appeared). Never send values.
4. Never pull the Preview/Dev Blob token into `.env.local` (no `vercel env pull`).
5. `CRON_SECRET` already exists; it also protects `/api/cron/media-sweep`.
6. Answer R7 (VI staff emails), R8 (locked fallback pages), R9 (offer-delete events), R11 (social labels), the offers' end dates and lede wording, the Experiences links and the film URL. Provide high-resolution originals for about 17 thumbnail-sized images, and the menu PDFs.

**Controller, after 7A merges** (the plans never do these):
1. **Migration 009 on Neon:**
   - `psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f db/checks/preflight-009.sql` → every row `ok`;
   - `node scripts/migrate.mjs` on the direct URL;
   - `postcheck-009.sql` → every row `ok`;
   - dev branch first if one exists. Expand-only; the seed is idempotent.
2. **Deploy 7A**, then the first-preview checks:
   - an upload end to end (CORS, type and size refusals, overwrite refusal);
   - a delete refused while in use;
   - the sweep dry run (`curl -H "Authorization: Bearer $CRON_SECRET" "<preview>/api/cron/media-sweep?dry=1"`);
   - an admin save reaching guests across instances;
   - the function memory of `registerMedia`.
3. **Move the old images to Blob** (Production):
   - `DATABASE_URL=<production direct URL> BLOB_READ_WRITE_TOKEN=<production token, from the dashboard, never written to a file> node scripts/move-assets-to-blob.mjs --prefix production` — a dry run; expect "39 static row(s); 39 file(s) to upload";
   - then the same command with `--apply`;
   - then **redeploy**, so cached pages pick up the Blob URLs and blur.
   - A preview is optional: `--prefix preview/<branch>` with the Preview/Dev token, against that preview's own Neon branch.
4. **Rollback:** the move is reversible only by restoring the media rows from their audit rows; the `/assets` files stay in the repo until phase 10, so a code rollback still renders. 009 stays.
