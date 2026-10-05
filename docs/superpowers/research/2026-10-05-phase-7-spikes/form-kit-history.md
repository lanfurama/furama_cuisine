# Phase 7 spike: the shared admin form kit, the content save flow and History/restore

> Spike report, key `form-kit-history` (clone `p7-kit`, DB tag `p7kit`, ports 3220–3229). Topic: the shared admin form kit, the content save flow (spec §7.4) and History/restore (spec §7.5), built and proven on two editors: offers (a list) and one restaurant (an aggregate).
>
> Where this report and `00-plan-outline.md` disagree, **the outline wins** (its §0 lists every conflict). In particular, the outline:
> - puts the kit's nav entry under one "Nội dung" item (`/admin/content`, the index from the `editors-registry` spike), not an "Ưu đãi" item;
> - audits a file's alt under entity `media` (the whole file snapshot: row + `media_i18n`), so R19's alt follow writes a `media` row, not `media_i18n`;
> - adds `assertLiveMedia` (from `media-blob`) to every saver and makes restore un-delete a trashed file the snapshot points at;
> - forbids the guest `CmsImage`/`<Image>` anywhere under `app/admin`: the kit's `getImageProps` + `<img>` thumbnail becomes the one admin thumbnail component;
> - adopts this spike's content-hash token, restore semantics and `makeListEditor` factoring.

## Where everything is

**Clone:** `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p7-kit`, on HEAD c896b13. Nothing is committed.

**Full patch:** `…/scratchpad/p7kit-logs/p7-kit.patch`. It covers 42 files (+4344 / −11) and holds the full content of every file below.

**Logs:** `…/scratchpad/p7kit-logs/`:
- `final-unit.log`
- `final-e2e.log`
- `final-visual.log`
- `final-build.log`
- `final-prerender.log`
- `final-lint.log`
- `e2e-m1.log` (mutation run)
- `e2e-latency.json`

The original repo is untouched (`git status` is clean at c896b13). No packages were added. The DBs `furama_cuisine_*p7kit_test` were dropped, and nothing is listening on 3220–3229.

## Gate results (final run, after every change)

| Gate | Result | Baseline at c896b13 |
|---|---|---|
| typecheck (`next typegen && tsc`) | clean | clean |
| lint | exit 0, **19 warnings**, 0 errors | 19 |
| unit + integration (`TEST_DB_TAG=p7kit`) | **87 files, 1072 tests passed** | 83 files, 1039 tests |
| `npm run build` + `scripts/check-prerender.mjs` | pass; the new admin routes have no static shell | pass |
| E2E full (`--retries=0`, port 3220) | **171 passed, 1 skipped** (botid): 168 existing + 3 new | — |
| visual (`next start` on 3221) | **8 passed at ratio 0** | 8 |

- **New E2E specs:** each was also run twice in a row on the same DB, and both runs passed (they can be re-run).
- **Guest latency:** measured from the admin's save response to the guest's next `/en` load showing the change. Values were **140, 89, 86, 89 ms** for edit, restore, delete and undelete (`guest-latency-ms` annotation). The spec asserts each is under 5000 ms.
- **Guest DOM:** no guest file changed. The diff touches only `app/admin`, `lib/admin`, `lib/server`, `styles/admin.css`, tests and e2e. The visual run is 8/8 at ratio 0.

### Mutation runs (do the tests catch regressions?)
- **M1 — offers actions skip `updateTag`:** caught. The E2E ACCEPTANCE test failed because the guest page stayed stale for 10 s.
- **M2 — `writeItem` skips the `*_i18n` rows:** caught. 10 of 12 integration tests failed.
- **M3 — no token check in `lockedItem`:** caught by the "page older than someone else's save" test.
  - The restore conflict test does not catch M3, because restore has its own token check.
- **M4 — R19 off:** caught by the rename test.

## Architecture (files in the clone)

### Server: generic and reusable
**`lib/server/content-admin/snapshot.ts`** is the core shared by every content editor.

`ItemDef = { entityType, table, idType: 'bigint'|'text', columns, i18n: { table, fk, columns }, tables: ContentTable[] }`. Every SQL identifier comes from these constants, never from input. A stored snapshot reaches SQL only as the jsonb argument of `jsonb_populate_record`.

- **`ItemSnapshot`** is `{ v:1, row, i18n: I18nRow[], meta? }`. `audit_log.before/after` store it.
- **`meta`** (`restored_from`, `unlinked_reservations`) is never written back and is not part of the token.
- **`readItem` / `readItems`** use `to_jsonb(m)` plus `jsonb_agg(to_jsonb(t) ORDER BY locale)`.
- **`snapshotToken(s)`** is the first 32 hex characters of the sha256 of the canonical (key-sorted) JSON, without `meta`. It returns `'deleted'` when the item is gone.
- **`lockList(client, key)`** takes `pg_advisory_xact_lock(hashtext('content:'+key))`. Every write of a list takes it.
- **`readOrder` / `orderToken` / `writeOrder`** handle the order: tokens are the ids in order, and `sort_order` is written as 10, 20, ….
- **`writeItem(client, def, snapshot, actorId)`** does the restore write:

```ts
if (exists) UPDATE t m SET (cols) = (SELECT r.cols FROM jsonb_populate_record(m, $2::jsonb) r), updated_at = now(), updated_by = $3 WHERE m.id = $1
else INSERT INTO t (id, created_at, updated_at, updated_by, cols) OVERRIDING SYSTEM VALUE
     SELECT r.id, coalesce(r.created_at, now()), now(), $2, r.cols FROM jsonb_populate_record(NULL::t, $1::jsonb) r
then writeI18nRows: DELETE all i18n of the id; INSERT … FROM jsonb_populate_recordset(NULL::t_i18n, $2) r WHERE r.locale IN (SELECT code FROM locales)
```

- **`upsertTranslation(client, def, id, locale, values, actorId)`** is the form save of one language. It upserts the row with `status='reviewed'`, `origin='human'`, `ai_model=NULL`, `reviewed_by/at` and `updated_by/at` (spec §5.1 item 4). Other languages are not touched.
- **`isForeignKeyViolation` (23503)** maps to the new code `missing_reference`.
- **`uniqueViolation` (23505)** maps to a field error, for example on the slug.

**`lib/server/content-admin/history.ts`:**
- **`listHistory(db, entityType, entityId|null, limit=30)`** reads `audit_log` newest first, with the actor shown as `coalesce(staff_user.name, actor_email, 'Hệ thống')`. Reorders are the rows with `entity_id IS NULL`.
- **`getAuditRow`** reads one row for a restore.
- **`listDeleted(db, entityType, table)`** returns each item's latest `delete` row whose id no longer exists.

**`lib/server/content-admin/media-options.ts`:** `listMediaOptions(db, 'image'|'pdf')` returns live media with the EN alt. The `MediaOption` type lives in `lib/admin/media-option.ts`, so client components can import it.

### Server: per editor
**`lib/server/content-admin/offers.ts`** defines `OFFER: ItemDef`. Its functions:
- `listOffersAdmin`: each item carries a guest state (`shown`, `hidden`, `upcoming`, `ended`, `restaurant_hidden`, `untitled`), its own token, and the list token.
- `getOfferEditor`, `createOffer`, `updateOffer`, `setOfferPublished`.
- `reorderOffers`: refuses unless the posted list has exactly the same id set as the list now.
- `deleteOffer`: records the booking ids its `ON DELETE SET NULL` unlinks in `before.meta.unlinked_reservations` (L7-12, R5).
- `restoreOffer({ id, auditId, side, token })`:
  - checks the audit row's `entity_type` and `entity_id` against the id, and that the snapshot is valid;
  - checks the token (`'deleted'` for a deleted offer);
  - re-applies today's rules: an EN title is required, and at most 6 offers may be shown;
  - calls `writeItem` and writes an audit row with action `restore` and `meta.restored_from`.
- `restoreOfferOrder`: ids still in the list take their old places; items added since follow them.

**`lib/server/content-admin/restaurants.ts`** defines `RESTAURANT` and `HIGHLIGHT` (both ItemDefs). The snapshot is `RestaurantSnapshot = ItemSnapshot & { cuisines, highlights: ItemSnapshot[] }`.
- It holds only the content columns. The phase-4 booking columns are never in it, so a restore cannot undo a booking change.
- `saveRestaurantContent` writes one transaction, in this order:
  1. the row;
  2. `upsertTranslation` for EN;
  3. the cuisines, replaced in order;
  4. the highlights: delete the ones left out, update or insert the rest, then their EN i18n;
  5. R19 `followCardAlt`, which writes its own `media_i18n` audit row;
  6. one `restaurants` audit row.
- `restoreRestaurant` restores the whole aggregate. A highlight that was deleted comes back under its id with `OVERRIDING SYSTEM VALUE`. It applies the same rules and R19.
- Rules shared by save and restore (`ruleErrors`):
  - a detail page needs `detail_image_id` and an EN story;
  - at most 5 highlights shown;
  - the slug is unique;
  - an uploaded menu PDF and a menu link cannot both be set;
  - every cuisine must still exist.
- It returns `{ altChanged, visibilityChanged }`, which the action turns into extra tags.

### Pure and shared (client-safe)
**`lib/admin/content-rules.ts`:**
- `LIMITS` holds every §6.5 limit: hero 1–5, destinations 2–5, stories ≤4, offers ≤6 (multiple of 3), experiences 1–5, cuisines ≤10, highlights ≤5 (warn below 2), nav ≤6, socials ≤6.
- `LENGTHS`: nav label warns over 14 and refuses over 18; restaurant name warns over 24.
- `charCount` counts code points, like Postgres `char_length`.
- Also: `checkLength`, `limitError`, `limitWarnings`, `navLabelError`, `detailPageErrors`, `detailPageWarnings` (hidden CALL/MAP/MENU, fewer than 2 highlights, long name), and `followRename` (R19).

**`lib/admin/content-schemas.ts`:**
- `readForm(fd)` folds inputs named `field.locale` into `{ field: { locale: v } }`, the data shape phase 8 needs.
- Schemas: `translatable(max, requiredMsg?)`, `OfferForm`, `RestaurantForm` (posts JSON for cuisines and highlights, checks each highlight with its number, and derives `phoneE164` via `toE164`), `RecordRef`, `RestoreForm`, `OrderForm`, `Token`.
- A checkbox must be `z.literal('on').optional()`. A `z.union([literal, undefined])` key is required in zod 4, so an unticked box failed the form; a unit test found this.

**`lib/admin/history.ts`:**
- `changedFields(before, after, labels)` lists the changed fields. It skips bookkeeping columns, adds a ` (vi)` suffix for other languages, and reports child lists as `list:<key>`.
- `restoreOffers(rows, currentToken, tokenOf)` decides which versions a row offers back:
  - never the current version;
  - a `delete` row offers "Khôi phục mục đã xóa" (its before);
  - any other row offers "Khôi phục phiên bản này" (its after) and "Khôi phục bản trước lần này" (its before).
  - So the newest row undoes the last change, and the oldest reaches the seed version.

### Form kit: `app/admin/(shell)/_kit/`
- **`useSaveState(action, token)`** is the holder for code rule 9. The page keys the fields on the token, so a save, a restore or "Tải lại" redraws them while the holder keeps "Đã lưu". A refused save keeps the token, so what staff typed stays.
  - A failure shows only while the token it arrived with is still current: after "Tải lại", a stale conflict message is hidden (fixes the phase-4 QuickConfirm item).
  - `dirty`/`markDirty` drive a `beforeunload` guard.
  - Core logic, verbatim:

```ts
const [seen, setSeen] = useState({ state, arrivedWith: token, token, dirty: false });
let current = seen;
if (seen.state !== state) current = { state, arrivedWith: token, token, dirty: state?.ok ? false : seen.dirty };
else if (seen.token !== token) current = { ...seen, token, dirty: false };
if (current !== seen) setSeen(current);
const visible = state !== null && !state.ok && current.arrivedWith !== token ? null : state;
```

- **`SaveBar`** sticks to the bottom of the form. It shows the outcome (reusing `_ui/FormMessage`, so a conflict reads "Vừa được {tên} thay đổi lúc {giờ}" with a Tải lại button), "Có thay đổi chưa lưu", "Sửa lần cuối bởi … lúc …", "Xem trên web" (new tab) and the submit button.
- **`TranslatableField`**:
  - `values: Record<locale, string|null>`; `locales` defaults to `EN_ONLY`, and becomes tabs with `role=tablist` plus status badges (Máy dịch / Đã duyệt / EN đã đổi) when there is more than one.
  - Posts `name.locale`; uncontrolled, or controlled through `onChange` inside lists.
  - Shows a counter `n/max` with warn/error levels and `warnAt` (nav 14), plus a warning when a translation runs over 1.3× its EN.
  - The label is clean (`getByLabel(…, {exact:true})` works).
  - `aria-describedby` links the hint, counter and error; it sets `aria-invalid` and `aria-required`; ids come from `useId`.
- **`TextField`:** the same counter and error wiring for plain columns.
- **`ImagePicker`:**
  - A fieldset with a legend. Choices are native radios inside a `<details>` grid; the current file shows its thumbnail, file name and EN alt (or "Ảnh trang trí").
  - A file a row still uses after it left the library stays selected (posted from a hidden input) with a warning.
  - Upload is a pointer to the media library (the media-blob spike).
  - Thumbnails use `getImageProps` + `<img>`, with the style prop dropped and `// oxlint-disable-next-line nextjs/no-img-element -- …`. `<Image>` injects `style="color:transparent"`, which the admin CSP (`style-src 'self' 'nonce-…'`) blocks: the E2E `watchCsp` caught 560 violations.
- **`SortableList<T>`:**
  - Controlled through `onMove(from, to)`; `moved(list, from, to)` is a helper.
  - Each item has ↑/↓ buttons, labelled "Chuyển “X” lên/xuống", as the keyboard and single-pointer alternative (WCAG 2.5.7). Focus stays on the button, and a polite live region says "Đã chuyển … tới vị trí N trên M".
  - HTML5 drag and drop works from a grip on an inner div. The handlers cannot sit on the `<li>`: oxlint `jsx-a11y/no-noninteractive-element-interactions` refuses that with an error.
  - `LimitNote` shows "Đang hiện n/max mục" plus warnings.
- **`HistoryPanel`** (server component):
  - Props: `headingId` (must be unique on the page), entries, `currentToken`, `recordId`, field labels, the `restore` action, optional `describe` and `tokenOf` (`orderToken` for a list's order).
  - It marks "Đây là phiên bản hiện tại".
  - **`RestoreButton`** (client) asks for a `confirm` on the button. The form has no `onSubmit`, which follows the phase-4 ruling for function actions.

### Pages and actions
**`app/admin/(shell)/content/offers/`:**
- **`page.tsx`:** the list, "Thêm ưu đãi", "Đã xóa gần đây", and the order's history ("Lịch sử thứ tự").
- **`OfferList.tsx`:** the reorder holder sits outside the list keyed by the list token (rule 9). Each row has show/hide and delete forms with that offer's token.
- **`new/page.tsx`** and **`[id]/page.tsx`:** the form, `DeleteOffer`, and History. A deleted offer keeps its page, with its History and restore.
- **`OfferForm.tsx`** and **`actions.ts`** (7 actions).

**`app/admin/(shell)/restaurants/[id]/`:**
- **`page.tsx`:** the content editor, its warnings, a subnav to `/booking`, and History.
- **`RestaurantForm.tsx`:** cuisines and highlights are SortableLists posted as JSON; highlights have ImagePicker, TranslatableField, a Hiện checkbox, Xóa, and "Thêm".
- **`actions.ts`.**

**Action shape** (passes `test/guards/require-permission.guard.test.ts`):

```ts
try { const staff = await requirePermission({ content: ['update'] /* restore: ['restore'] */ });
  const input = Schema.parse(readForm(formData));
  const result = await saveX(getPool(), auditActor(staff), …);   // BEGIN → lock → token → rules → write row + *_i18n → insertAudit(before, after) → COMMIT
  if (!result.ok) return result;
  for (const tag of tagsForSave(DEF.tables, restaurantId?)) updateTag(tag);   // + 'media' when R19 moved an alt, + booking-rules:<id> when visibility changed
  return result;
} catch (err) { return actionError(err); }
```

### Other changes
- **New ActionCodes:** `limit` (message "Tối đa {max} mục được hiện…") and `missing_reference`.
- **Admin nav:** an "Ưu đãi" item (`content:read`) after "Nhà hàng".
- **Restaurants list:** a "Nội dung" link on each row.
- **`styles/admin.css`:** about 250 lines for the kit (`a-savebar`, `a-picker*`, `a-sortable*`, `a-history*`, `a-counter*`, `a-visually-hidden`, …).
- **Guard:** a `CONTENT_ACTIONS` matrix (9 actions, all allowed to Editor; restore needs `content:restore`) runs alongside `BOOKING_ACTIONS`.

## Tests added
- **`lib/admin/content-rules.test.ts`** (7): limits, nav 14/18, detail-page errors and warnings, R19.
- **`lib/admin/history.test.ts`** (7): `changedFields` and `restoreOffers`, including the deleted and restored cases.
- **`lib/admin/content-schemas.test.ts`** (5): `readForm` folding, offer normalisation and errors, code-point lengths, restaurant highlight messages with their number, the E.164 phone.
- **`test/integration/content-editors.test.ts`** (12, on the real DB):
  - **offers:** the ACCEPTANCE flow (edit → restore before → delete with a linked booking, which keeps its note and loses its link → `listDeleted` → restore under the same id and place, booking not relinked → a second restore of the same row is a conflict); a stale save conflict naming the other editor; a stale restore conflict; the limit of 6 across create, show and restore; list states; reorder with the old order saved, stale and missing-id conflicts, and restoring the order; restores refused without an EN title, with a missing restaurant (`missing_reference`), or with another record's audit row (`not_found`);
  - **restaurant:** rename shows on the card and R19 moves the alt, with a `media_i18n` audit row, and restore puts both back; R19 leaves a hand-written alt; detail-page, highlight-limit and slug rules, with no audit row written on refusal; highlights removed, added, reordered and hidden, then restored with the original ids and i18n; a booking-rules save in between is not a conflict, a content save is.
- **`e2e/content-offers.serial.spec.ts`** (2, run as the Editor):
  - ACCEPTANCE: edit → newest History row "Khôi phục bản trước lần này" → delete → "Đã xóa gần đây" → "Khôi phục mục đã xóa"; the guest titles are checked after each step, with latency measured;
  - keyboard reorder (Enter on ↑, focus kept, announcement) → "Lưu thứ tự" → guest order changes → order History restore.
- **`e2e/content-restaurant.serial.spec.ts`** (1):
  - a refused save keeps the typed name; the story error is in `aria-describedby` and `aria-invalid` is set;
  - after the save, the detail h1 and the home card img alt show the new name;
  - History restore brings both back;
  - the picker thumbnails load; `watchCsp` reports none and `expectHydrated` passes.

## Proposal: how the editors share the kit

**Generic server.** About 7 list editors are an `ItemDef` plus about 40 lines of mapping and rules once `offers.ts` is factored into `makeListEditor(def, { listKey, limit: LimitKey, toRow(input), validate(state) })`. It would provide create, update, setPublished, reorder, delete, restore and restoreOrder. Lists without i18n (`social_links`, `sections`, `site_settings`) need `i18n` to become optional in `ItemDef`.

| Editor (spec §7.2) | Server pattern | TranslatableField | ImagePicker | SortableList + LimitNote | SaveBar / useSaveState | HistoryPanel |
|---|---|---|---|---|---|---|
| content/offers | list (done) | title, schedule, venue | — | ✓ ≤6 | ✓ | item + order |
| content/experiences | list | title, blurb | — | ✓ 1–5 | ✓ | item + order |
| content/stories | list | category, title, href | ✓ | ✓ ≤4 | ✓ | item + order |
| content/hero (slides + `hero.*` strings + autoplay) | list + strings + site_settings | slide alt via media; `hero.*` | ✓ (+mobile crop on slide 1 only) | ✓ 1–5 | ✓ | item + order + string |
| content/cuisines | list (text id) | label | ✓ | ✓ ≤10 | ✓ | item + order |
| content/destinations | list (text id) + D1/L7-2 warning | name, card titles/blurbs, address | ✓ | ✓ 2–5, ≤1 teaser | ✓ | item + order |
| content/navigation | list | label (warn 14, refuse 18) | — | ✓ ≤6 | ✓ | item + order |
| content/contact (socials, email, footer strings) | list without i18n + site_settings + strings | footer strings | — | ✓ ≤6 | ✓ | ✓ |
| content/sections | singleton rows by `key` | — | ✓ | — (toggles; restaurants locked on) | ✓ | per section |
| content/heritage, booking, seo, legal, emails, ui-text | **strings form**: one TranslatableField per registry key of that `screen` (max/vars from the registry, ICU/placeholder check §7.4), entity `content_strings` + key | ✓ | seo: og image | — | ✓ | per key |
| restaurants/[id] | aggregate (done) | 8 fields + highlight title/detail | card/detail/og + highlights | cuisines, highlights ≤5 | ✓ | aggregate |
| media (media-blob spike) | `media` + `media_i18n` alt (history entity) | alt per language | upload source | — | ✓ | alt |

So:
- **SaveBar, useSaveState and HistoryPanel/RestoreButton:** every screen, about 14.
- **TranslatableField:** about 13 screens.
- **SortableList/LimitNote:** 9 lists plus 2 inside the restaurant.
- **ImagePicker:** 7 screens.
- **TextField:** 4 screens.
- The strings form is one generic component that covers 6 screens.

## Errors hit, and their fixes

| # | Error | Cause | Fix |
|---|---|---|---|
| 1 | `cp -cR` into `scratchpad/p7-kit` nested the copy as `p7-kit/furama_cuisine` (including a copy of `.env.local`) | A clone named `p7-kit` already existed from an earlier attempt (clean, at HEAD c896b13, with a green unit baseline), so `cp` copied the repo into it as a subfolder. | Deleted the nested `p7-kit/furama_cuisine` (and its `.env.local` copy) without reading it, then reused the existing clean clone. Its `.next` and `.env.local` were removed. |
| 2 | Integration test: `restoreOffer` returned `not_found` instead of `limit` | The test helper ran `SELECT id::text … ORDER BY id`; the ORDER BY used the text alias, so ids sorted as text ('10' before '9') and `.at(-1)` was not the delete row. | Changed the helper to `SELECT a.id::text AS id … FROM audit_log a ORDER BY a.id`. |
| 3 | TS2345: `(snapshot: { meta?: Row } \| null) => string` not assignable to `(s: Snap) => string` | TypeScript's weak-type check: the history `Snap` type shares no property with `{ meta?: Row }`. | `snapshotToken(snapshot: object \| null)`, with the snapshot cast to read meta. |
| 4 | oxlint error `jsx-a11y(no-noninteractive-element-interactions)` on the SortableList `<li>` | The drag-and-drop handlers were on the `<li>` element. | Moved the handlers to an inner div (`.a-sortable-drop`). Lint is back to exit 0 with 19 warnings. |
| 5 | zod: hasDetailPage 'expected nonoptional, received undefined' (an unticked checkbox failed the form) | In zod 4, `z.union([z.literal('on'), z.undefined()])` does not make the object key optional, and an unticked checkbox is not posted at all. | Changed the checkbox schema to `z.literal('on').optional().transform(v => v === 'on')`. The content-schemas unit test caught it before any browser run. |
| 6 | E2E: the reorder form's 'Đã lưu thứ tự.' status disappeared after a save | Code rule 9 was broken: the reorder `useActionState` lived inside the list that the page keys on the list token, so a successful reorder remounted it and dropped its state. | `OfferList` now holds the action state; an inner `OfferOrder` is keyed by `listToken` and holds only the local order. |
| 7 | E2E History steps failed on a second run against the same DB (5 history rows found where 1 was expected) | History builds up across runs; the spec counted rows and relied on the oldest row's 'before' button. | `restoreOffers` now offers 'Khôi phục bản trước lần này' on every row (so the newest row undoes the last change). The E2E clicks inside the first listitem and counts rows relative to before. Two runs in a row now pass. |
| 8 | 560 admin CSP violations: 'Applying inline style violates … style-src' | `next/image` `<Image>` injects `style="color:transparent"`, and the admin CSP has no `'unsafe-inline'` for styles. | ImagePicker thumbnails use `getImageProps()` with style dropped, rendered as `<img>` under an `oxlint-disable-next-line nextjs/no-img-element` comment that gives the reason. `watchCsp` now records `[]` and the warning count stays 19. |
| 9 | Existing E2E admin-users and admin-acceptance failed on the nav link list | The new 'Ưu đãi' nav item (`content:read`) is shown to both roles. | Updated both expected arrays and `lib/admin/nav.test.ts` to include 'Ưu đãi'. |
| 10 | Mutation M3 did not apply on the first attempt (12/12 tests passed) | The python replace string had the wrong indentation. | Re-ran with an assert that the target text is present. The mutation then made the conflict test fail. |
| 11 | `psql -l` / dropdb loop: 'database "bcmac" does not exist' | psql was run without `-d`. | Used `psql -d postgres`; all 9 `*_p7kit_test` databases were dropped. |

## Package versions

- `next@16.3.7` (installed; `updateTag` at `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/updateTag.md:6-16`; action re-render at `01-app/02-guides/server-actions.md:144-148`; `getImageProps` at `01-app/03-api-reference/02-components/image.md:1009`)
- `react@19.3.0`
- `typescript@7.0.2`
- `zod@4.6.5` (`z.config(z.locales.vi())`; a `z.union([literal, undefined])` object key is NOT optional)
- `pg@8.23.0`
- `vitest@5.0.3`
- `@playwright/test@1.63.0`
- `oxlint@1.86.0` (plugins typescript, react, nextjs, jsx-a11y, import; disable syntax: `// oxlint-disable-next-line nextjs/no-img-element -- reason`)
- `libphonenumber-js` (existing, via `lib/phone.ts` `toE164`)
- No packages added or removed; no network use except the local npm install already in the clone.

## Recommended task breakdown (spike's proposal; the outline's §3 supersedes it)

Phase 7 plan, in proposed order. Each task follows the phase-6 gate: typecheck, lint at 19 warnings, unit and integration, build, check-prerender, E2E, visual 8/8 at ratio 0.

T1. Kit foundation (from this spike):
- `lib/server/content-admin/snapshot.ts` and `history.ts`;
- `lib/admin/content-rules.ts`, `content-schemas.ts`, `history.ts` and `media-option.ts`;
- the ActionCodes `limit` and `missing_reference`;
- `app/admin/(shell)/_kit/*` and the admin.css block;
- the `CONTENT_ACTIONS` guard matrix.
Also factor `offers.ts` into a generic `makeListEditor(def, opts)`, make `ItemDef.i18n` optional, and add unit tests.

T2. Offers editor, plus R4 (the offers lede date from the owner) and R9/L7-11 (offers in the admin booking screens and the staff.new email). Reuse the content-offers E2E and integration tests from this spike.

T3. Restaurant content editor:
- from this spike;
- add a menu PDF picker once media lands;
- L7-3: a single SQL predicate for "has a page";
- L7-4 and L7-5;
- L7-13: SEO fallbacks.

T4. Lists with media:
- stories (L7-7);
- experiences (owner's links);
- cuisines;
- destinations (D1/L7-2: `is_published` joins in 4 loaders plus `bookingEnabled`, and the destination save expires booking-rules tags);
- hero slides (1–5; mobile crop on slide 1 only; L7-1 F-A E2E; L7-16).

T5. Navigation and contact/socials (L7-15 `SOCIAL_LABELS` by enum; nav 14/18) and the sections toggles (restaurants stays locked on; film URL is YouTube or Vimeo only).

T6. Registry migration of section copy and UI microcopy (R2): keys with screen, vars and context; `ADMIN_SCREENS` adds cuisines, destinations, experiences, heritage, stories, offers and restaurants; `CLIENT_KEYS`; a generic StringsForm per screen with ICU and placeholder validation (§7.4); `content_strings` tags by prefix; T8.1/T8.2 legal versioning; T5.1/T5.3/T5.5 email screen; the CI guard 'no guest-visible text outside the registry or DB'.

T7. Media library and Blob (spike media-blob):
- upload tokens issued only after the session and permission checks;
- `registerMedia` and `blur_data_url`;
- alt editing (`media_i18n` history);
- refuse to delete a file in use;
- the media-sweep cron;
- move static files to Blob with CmsImage for the plain `<img>` tags (R3) and re-taken baselines;
- `remotePatterns` plus SearchOverlay escaping (L7-8).

T8. Form-kit retrofit of older forms:
- NoteForm and TransitionPanel keep typed values;
- EditReservationForm's key;
- the ADM-3 unsaved guard;
- QuickConfirm gets Tải lại;
- `useId` for duplicate ids;
- T6.6 aria links;
- T7.4–T7.6;
- inbox search (admin F5, T12.4, T12.5).

T9. Acceptance:
- walk the content-inventory §2.1–2.19 checklist with an E2E per editor;
- L7-17 FK coverage;
- L7-18: race measurement at real save rates;
- the phase ledger.

## Risks and open questions

1. The token is a hash of the content, not `updated_at` (spec §7.3 says 'so sánh updated_at'). This avoids false conflicts with the booking screens, which share `restaurants.updated_at` (R16): the integration test shows a booking-rules save in between is not a conflict. The other direction is still coarse: a content save bumps `restaurants.updated_at`, so a booking form open elsewhere gets 'Vừa được … thay đổi'. Decide whether to accept this or give the booking screens a content-independent token too.
2. Phase 8: the token covers every `*_i18n` row, so a VI translator's save makes an open EN editor stale (and the reverse). Proposal: phase 8 hashes the main row plus only the locales the form shows.
3. Snapshot schema drift: if a later migration adds a NOT NULL column without a DEFAULT, restoring a DELETED item from an older snapshot (`jsonb_populate_record(NULL::t, …)`) inserts NULL and fails. Restoring an existing item is safe because missing keys keep today's values. Rule to adopt: every content column added after phase 7 has a DEFAULT, or restore merges the snapshot onto column defaults.
4. Media sweep vs History: a version can point at a media row the sweep later hard-deletes. Restore then fails cleanly with `missing_reference` (FK), but that version can never be restored. Decide with the media-blob spike: either the sweep also keeps files referenced by audit snapshots for N days, or accept the loss.
5. Restore keeps each `*_i18n` row's `status`, `origin`, `ai_model` and `source_hash` from the snapshot rather than marking it 'reviewed', because restoring is not typing. This deviates from the literal §5.1.4 'mọi lần lưu từ form admin đều ghi reviewed'; confirm.
6. L7-12 / R5: deleting an offer unlinks its bookings through `ON DELETE SET NULL`. The trigger bumps their version without a `reservation_event`; the spike records the ids in the delete row's `before.meta.unlinked_reservations`. Open: also write a `reservation_event` (type 'edited'?) for each? Staff editing such a booking at that moment hit a conflict, as today.
7. §6.5 limits count only published items (hidden drafts allowed): offers at most 6 shown, highlights at most 5 shown, with a hard cap of 10 highlights in total. Confirm the owner wants hidden drafts.
8. `beforeunload` guards only reload, close and external navigation; a client-side Link inside the admin leaves without asking. A full guard needs a router-level confirm (not available in Next 16 without patching). Also, Playwright dismisses `beforeunload` dialogs by default, so specs must save before navigating away.
9. D2/L7-18 not measured here: every offers or hero save expires every guest page (the guarded layout reads offers). Guest latency after a save was 86–140 ms locally; the R15 RSC-404 race at real save rates was not measured.
10. Advisory lock per list (`content:<list>`) serializes all writes to that list, which is fine at this scale. The restaurant aggregate uses `FOR UPDATE` on the restaurant row.
11. `listHistory` returns the 30 newest rows with no pager, and order history describes versions by ids, not titles.
12. The admin cannot use `next/image` `<Image>` anywhere (its inline style breaks the admin CSP). The kit uses `getImageProps` + `<img>` with a lint-disable comment; Blob URLs will need `images.remotePatterns` (L7-8) for the optimizer.
13. Not covered by this spike:
    - ICU/placeholder validation for `content_strings` (§7.4); belongs to the strings form, T6;
    - TranslatableField's 'Dịch từ EN' (phase 9);
    - the media upload in ImagePicker (stubbed; spike media-blob);
    - the menu PDF picker;
    - the 'no guest text outside registry/DB' CI guard;
    - the F-A hero E2E (L7-1).

## Spec deviations (the spike's list; rulings in the outline §2)

1. §7.3 SaveBar 'so sánh updated_at' is implemented as a hash of the edited content (row + every `*_i18n` row; for a restaurant, its content columns + i18n + cuisines + highlights). Who and when still come from `updated_by`/`updated_at`. Reason: `restaurants.updated_at` is shared with the booking screens (R16).
2. §7.5 restore keeps the snapshot's translation status/origin instead of writing 'reviewed' (see risks).
3. §6.5 'Offers 0–6' and 'highlights 0–5' are enforced on published items only; highlights have a hard cap of 10 in total. Fewer than the minimum, or not a multiple of 3, only warns.
4. `audit_log.entity_type` uses table names ('offers', 'restaurants', 'media_i18n'), like the existing 'service_periods' and 'site_settings'. A list's reorder (and the restore of an order) is entity_type '<table>' with entity_id NULL.
5. R19's alt change gets its own audit row (entity `media_i18n`, entity_id = media id, locale 'en') beside the restaurant's row, rather than living inside the restaurant snapshot. A restaurant restore re-applies R19 instead.
6. New ActionCodes 'limit' and 'missing_reference', beyond §7.4's admin list (conflict, db_error, forbidden, invalid).
7. The admin form kit avoids `next/image` `<Image>` (inline style vs the admin CSP): thumbnails use `getImageProps` + `<img>` with an oxlint disable, so the 'no new `<img>`' rule now has an admin-only exception.
8. ImagePicker has no upload (pointer to the media library) and no per-language alt editing: alt is edited on the file (spec §7.3 lists both in ImagePicker; deferred to the media-blob spike or the media screen).
9. The offers editor lives at `/admin/content/offers`. The restaurant content editor is `/admin/restaurants/[id]`, with the phase-4 booking screen as a subnav tab, as §7.2 says.
10. TranslatableField shows EN only, with no tabs (per §7.3/§8 until phase 8). The data shape and posted names (`field.locale`) are already per locale.

## User steps

- None needed to use this spike. The work sits in the clone (`…/scratchpad/p7-kit`) and the patch (`…/scratchpad/p7kit-logs/p7-kit.patch`); nothing was committed or pushed, and the original repo is untouched.
- Owner decisions for phase 7 (already open in the phase-6 ledger): the end dates of the offers and the Offers lede's 'valid until …' wording (R4); the Experiences link targets; the film URL.
- Owner decision: should deleting an offer write a `reservation_event` on each booking it unlinks (L7-12)? The spike records the booking ids in the delete's audit row.
- Owner (other spike): create the two Vercel Blob stores (Production; Preview/Dev) in the Vercel dashboard before the media upload lands.
