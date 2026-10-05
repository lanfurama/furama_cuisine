# Phase 7B ledger — remaining editors, the registry move, the form kit, AC1 (closes phase 7)

Plan: `docs/superpowers/plans/2026-10-06-phase-7b-editors-retrofit.md` (tasks B1–B11). Spec: `docs/superpowers/specs/2026-10-01-admin-cms-design.md` §14.1 row 7. Research: `docs/superpowers/research/2026-10-05-phase-7-spikes/` (the outline wins over the spike reports). Plan 7A and its ledger (`2026-10-05-phase-7a-ledger.md`) come first; this ledger closes phase 7.

This is the draft B11 writes. The controller adds the commits on `main` and each task review's outcome when it runs the plan. Phase 7B adds no migration: nothing goes to Neon beyond 7A's 009.

Acceptance closed by 7B (spec §14.1 row 7; AC3 and AC4 closed in 7A):
- **AC1, every item of the content checklist edited in EN in the admin shows on the web within seconds.** `e2e/content-checklist.serial.spec.ts`: one step per item of the edit report's §1 map, less its locked (L) and phase-8 (P8) rows (79 steps in 9 tests), as the Editor (the shared inbox, R10, as the Admin); each guest check is polled for at most 5 s from the save; each item is put back through the History of its screen, and the guest check runs again until the change is gone (final fix wave F16), except the two screens without one (the booking switch, phase 4, and the shared inbox, phase 5), which are saved back.
- **AC2, no guest text outside the registry or the database.** `test/guards/guest-text.guard.test.ts`: PENDING `{}` (B8); the seven language-switcher words are LOCKED until phase 8 (R35). From the final fix wave (F18) it also reads the booking emails (`lib/server/email/templates/{booking,layout}.tsx`, `lib/server/email/booking`, less the admin's `sample.ts`); the layout's wordmark and the staff emails' footer are LOCKED with their reasons.
- **X1, every key, table and column has an editing screen.** `test/guards/editing-screens.guard.test.ts`: `NOT_BUILT` `[]` (B8).

Final gate (after the final review fix wave, below; B11 measured 122 files / 1553 tests and 232 E2E passed before it):
- typecheck clean; lint exit 0 with 14 warnings.
- Unit and integration: 123 files, 1564 tests.
- `Applied 9 migration(s).`; build and check-prerender pass.
- Server DOM diff against the `c896b13` build: `/en` 12 lines, `/en/restaurants/taya-house` 10 (B7's four meta lines, L7-13), `/en/privacy` 0; line for line B11's log.
- E2E: 235 passed, 2 skipped (the opt-in BotID and RSC-race specs); the wave adds three tests (F9, F12, F13).
- Visual: 8 passed at ratio 0; no baseline changed.

## L7-18: the RSC-404 race at phase 7's save rates

`e2e/rsc-race.spec.ts` (opt-in, `RSC_RACE=1`): a guest goes home → Tàya House → home by client navigation while the Editor saves, in turn, an offer hidden and shown (content:offers) and the hero's slide pace (site_settings, content:contact), both on every guest page (D2). Measured locally on the B10 build (`next start`, Next 16.3.7):
- a save every 3 s (an editor working fast): 120 navigations, 60 saves, **1** navigation ended in a full page load, with **1** RSC 404;
- a save every second (164 saves): 120 navigations, **1** full load, **1** RSC 404.

The guest still lands on the right page with the right content (`fetch-server-response.js` falls back to a full load). Accepted, as R15 of plan 6: about one navigation in 120 during sustained saving, none without saves (phase 6's measurement). Re-measure on Next ≥ 16.4 (phase 10, unchanged).

## Rulings

- R1–R23 (outline §2) stand as the owner accepted them for 7A; plan 7B adds R24–R45 (its "Rulings"), each with its "Nếu sai".
- Implementation notes recorded in plan 7B Part 3:
  - The inbox's "Xác nhận" on a search's results (a page reached through the search action's redirect) loses a conflict's alert to Next's re-navigation after the next action; on the inbox tabs the alert shows with "Tải lại" (B9 test). The row always shows the booking as it now is. Accepted; phase 10 looks at it with the router.
  - A booking whose sitting has started offers no "Báo khách" (the sender would skip the email, F5), and its notice says why no email went (B9).
  - The inbox keeps the last five searches, fewer when long Vietnamese searches would pass the cookie's 3.5 KB budget (B9).
  - Text typed while an editor's save is in flight stays only when the page then holds the very version that save wrote (each save answers its token; the strings form joins one per key); after a colleague's save in between, or a create, the fields remount on the newer record and that typing is dropped, never posted under a token the fields do not show (B10, plan 7B review).
  - Plan risk 12 says B7 and B8 add no client key. B8 does: `error.restaurant_fallback` is a client key, so `CLIENT_KEYS` is 150, a few bytes more on every page's payload.

## Closed in 7B

- **Plan 7A's "Carried to plan 7B" (every line):**
  - L7-2 (B1; a hidden destination's number is never another restaurant's larger-group phone, on the drawer or in the emails), L7-6 (B5), L7-7 (B3, B5), L7-10 (B1), L7-13 (B7), L7-14 for nav items (B4), L7-15 (B5), L7-17 (B11: `test/integration/fk-coverage.test.ts`, every foreign key with its ON DELETE action and the named test that drives it, or why no phase-7 path deletes its parent), L7-18 (B11, above).
  - The remaining screens `cuisines`, `destinations`, `experiences`, `booking`, `navigation`, `contact`, `seo` (B1–B7; `NOT_BUILT` `[]` at B8); PENDING `{}` (B8); a Vietnamese `label` on every key (B8).
  - The form-kit retrofit of the booking admin (B9) and of the auth, users and settings forms (B10).
  - AC1's checklist walk, the closing E2E runs and this ledger (B11). The DOM-diff base (`p7a-tmp/fc-dom` in the session scratchpad) is not removed: it stays the gate's base through the final fix wave, and the `p7a-tmp/fc-base` worktree belongs to the p7a-verify clone's `.git`, not to this repository's. Remove both after the merge.
  - From the final 7A review, LATER 7B:
    - UX-9, Enter on the emails screen, `guestEventKeys()` (B8).
    - UX-5, a restore's outcome: one line per History panel, also "Đã xóa gần đây" and the hero's deleted slides (B10).
    - UX-10: "Xóa file" asks first; the file screen on `useSaveState`/`SaveBar`; "← Nội dung" on every content screen (a guard test); "Nội dung | Giờ và sức chứa" on both restaurant screens (B9); a strings conflict on a key reset to its default names who reset it (B10).
    - `conflictBy` names the newest History row's author for a list's item and order, a file (R19's alt follow), a restaurant and a string (B10). The booking-config save keeps the restaurant row's `updated_by`: every write that moves that shared token (R16) sets it, so the name is right — no change needed.
    - `useSaveState` keeps text typed while a save is in flight, on the version that save wrote (fields keyed on `fieldsKey`; the save state is a tested reducer, `lib/admin/save-state.ts`) (B10).
    - The warn colours as `--a-warn*` tokens (B9, a guard test).
    - Pickers and sections: two slides on one picture are named apart; `ImagePicker`'s fieldset drops `aria-invalid`; "Ẩn" on the restaurants list asks first; "Đặt bàn online" says a hidden or archived restaurant, or one at a hidden destination, takes no booking (B10).
    - Fix-wave residuals: the offers switch parses `PublishForm` (B10); "Tải lại" after `not_allowed` remounts the fields (B10); the README's media-sweep row, its BotID command's Blob variables, the move script's usage (`DATABASE_URL_UNPOOLED`) and `lib/legal.test.ts`'s title and comment (B11).
- **Phase-3 ledger, phase 7:** InviteForm and AcceptForm keep what was typed; the invite form's "created but not sent" alert is tested (`inviteOutcome`); ResetForm's invalid link offers a new one; the staff table's actions cell and error placement (B10). The admin-pages guard items closed in 7A (A1).
- **Phase-4 ledger, phase 7:** NoteForm keeps typed text (TransitionPanel since phase 5); EditReservationForm keys on its values; the ADM-3 leave guard; QuickConfirm's "Tải lại" and stale alert; `aria-invalid` and per-row period errors; unique names in the periods editor; number inputs (a cleared covers field stays empty); a non-overlapping "Thêm ca"; the overbooking wording; closure titles with meals; one inline-form class (B9). The drawer's three residuals (B6).
- **Phase-5 ledger, phase 7:** admin F5 (five searches), T6.6, T6.9, T7.4–T7.6, T12.4, T12.5, `useId` for the booking, auth and settings forms, the past-sitting panel (B9, B10); T5.1, T5.3, T5.5, T8.1, T8.2, T8.4 and the `bodySizeLimit` scoping closed in 7A.
- **Phase-6 ledger, phase 7:** L7-1 … L7-18 all closed (7A: L7-1, 3, 4, 5, 8, 9, 11, 12, 14 for slides and highlights, 16; 7B: the rest).

## Final review fix wave

The whole-branch review of 7a9a364..d3f898e, fixed in four commits (one per group); its LATER items are under "Deferred" below.

- `33bb9a2` fix: keep a destination with restaurants from becoming a teaser, … (group 1):
  - F1: a destination that restaurants, closures or recipients point at cannot become a teaser, on a save, a restore or the switch.
  - F2: a restaurant sits only at a venue, on create, save and restore (SEC-5).
  - F3: an emptied seeded destination can be deleted: the phase-1 `restaurants.destination` column that still names it is cleared first.
  - F4: `all` (the guest filters' "everything") cannot be a cuisine or destination id.
  - F5: a hidden or draft default restaurant never reaches the guest payload.
  - F6: the cuisine hide warning counts only the restaurants guests see.
- `adba51f` fix: name the colleague who changed a list's order, … (group 2):
  - F7: a stale reorder names whoever changed the order last.
  - F8: a restaurant save that created highlights remounts the fields.
  - F9: an unsaved list order asks before the page is left.
- `dc64585` fix: say why a navigation restore is refused, … (group 3):
  - F10: a refused navigation restore says what to do; the label warning reads its number from `LENGTHS`.
  - F11: "Không gửi email cho khách: đã qua giờ hẹn" shows only after a change that would have emailed the guest (the server's transition table decides).
  - F12, F13: the contact and destinations screens fit a 375 px phone.
  - F14: the contact screen previews the footer's venue line with the footer's own rule.
- `test: make AC1's portrait row and every restore prove what guests get, …` (group 4):
  - F15: AC1 row 72 reads the portrait itself (`.taya-portrait`, the file's own alt), not a file name the teaser card already carries.
  - F16: every AC1 table row checks that the guest no longer gets the change after its restore; row 36's booking switch is always put back.
  - F17: closed contexts, a truthful test title and truthful repair comments (the strings' cache), and the FK matrix's header names the media schema test.
  - F18: the guest-text guard reads the booking emails.
  - F19: the privacy header sits above the privacy keys again, and `generateMetadata` above the layout's own comment (comments and order only).
  - F20: README's preview cache check, and this ledger.

## Deferred, with the reason

- **To phase 8 (from the final review):**
  - A History label for `social_links.visible_locales` (B5 review): not editable until phase 8 (R39, L8-6), whose locales screen adds it.
  - An empty `og:image:alt` for a decorative share image (B7 review): harmless; changing it now would move the Tàya DOM-diff lines. It goes with phase 8's SEO pass.
  - canonical, hreflang, `sitemap.ts`, `robots.ts`: already phase 8 (spec §14.1 row 8); a reminder only.
- **To phase 10:**
  - A file of the wrong kind in a picker gets the "đã bị xóa" message (A6/A9): only a forged post reaches it, since the pickers list one kind.
  - The trash lists at most 20 files (A6): a restaurant site's 30-day trash rarely holds more; paging goes with the History pager (phase 10).
  - `SECTION_PARTS` typed `Record<string, …>` (A9): 7B added no section, which was the trigger; type hygiene.
  - The hero page names a deleted slide whose picture went to the trash "slide" (A9): cosmetic, and rare.
  - The advisory "MENU hidden" warning can be missing when the only highlight's picture is in the trash (A10): advisory only.
  - The sweep never retries the out-of-folder files of rows it purged in a run whose orphan pass then failed (fix-wave residual): storage only, and it needs the store to fail mid-run.
  - The inbox search results' lost conflict alert (above), with the router-level unsaved-changes guard.
  - From the final review (each is admin polish, cosmetic, rare, or predates 7B):
    - A restaurant's own screens do not say its destination is hidden (UX-7): the booking screen shows online booking on, and "Xem trên web" opens a 404. Risk 1 accepts it; the restaurants list says it since B10.
    - The Sections switch does not say that a section's menu item goes with it (UX-8); the Navigation screen does.
    - The Stories History cannot tell its two `href` fields apart (B3): cosmetic; restore is unaffected.
    - The Stories admin list shows a raw ISO date (B3): admin-only.
    - A story with neither category nor date renders an empty kicker line (B3): a guest edge case; check the visual and DOM diff when it is fixed.
    - `saveSettings` has no rule or FK catch, unlike `restoreSettings` (B6): both groups' `validate` cover their columns today.
    - `SiteProvider.getJson` has no timeout (B6): "Try again" recovers, and the hang predates 7B.
    - The restaurant page reads its strings before the detail and the share image (B7): one round trip on a cold cache.
    - A restore that revives a trashed file expires only its editor's tag, not `media` (B7): other pages showing the file keep it "missing" until `media` expires; the pattern is 7A's.
    - The periods editor's row errors stay tied to row positions (B9) until the next save.
    - `.a-inline-form .a-btn { margin-top: 4px }` may move the closures and recipients delete buttons 4 px (B9): no visual test covers those screens; the mobile and polish pass.
    - The restore outcome repeats the verb, and StringsHistory reads "lúc Tiêu đề, 08:15" (B10): pinned by `content-kit.serial` today.
    - `RestoreOutcome` inserts its `role="status"` already filled (B10), so some screen readers skip it.
    - The restore outcome never clears (B10), and a restore that changed nothing still says "Đã khôi phục" (B10).
    - Admin wording: ItemList's "Không lưu được thay đổi này:" also leads a refused delete; the meal select reads "Bữa của ca 1"; many `booking.*` keys sit ungrouped on the Đặt bàn screen.
    - Focus does not move to the first invalid field after a refused save: the project-wide convention; the a11y pass.
    - At 375 px the periods table (835 px) and the staff table (665 px) overflow the page: both predate 7B; the mobile pass.
    - The retrofitted auth forms (`method="post"` + `onSubmit`) do nothing before hydration: the 7A form-kit pattern, nothing leaks; restore progressive enhancement if slow networks matter.
    - An unknown restaurant slug answers 200 with the home page's description and og: tags; with the database down some pages hang over 20 s and `/vi` answers 500: identical on 7a9a364; spec §12.
- **Phase 8, 9, 10 lists of the 7A ledger:** unchanged.

## Needs a decision or a first-preview check

Unchanged from the 7A ledger (the real Blob service, sharp's memory, the owner's content, the lawyer's two points). Plan 7B's "Cần quyết định" risk 11 (the destination address edited on the destinations screen, not on contact) stands as ruled (R24) unless the owner asks otherwise.
