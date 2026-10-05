# Phase 7B ledger — remaining editors, the registry move, the form kit, AC1 (closes phase 7)

Plan: `docs/superpowers/plans/2026-10-06-phase-7b-editors-retrofit.md` (tasks B1–B11). Spec: `docs/superpowers/specs/2026-10-01-admin-cms-design.md` §14.1 row 7. Research: `docs/superpowers/research/2026-10-05-phase-7-spikes/` (the outline wins over the spike reports). Plan 7A and its ledger (`2026-10-05-phase-7a-ledger.md`) come first; this ledger closes phase 7.

This is the draft B11 writes. The controller adds the commits on `main` and each task review's outcome when it runs the plan. Phase 7B adds no migration: nothing goes to Neon beyond 7A's 009.

Acceptance closed by 7B (spec §14.1 row 7; AC3 and AC4 closed in 7A):
- **AC1, every item of the content checklist edited in EN in the admin shows on the web within seconds.** `e2e/content-checklist.serial.spec.ts`: one step per item of the edit report's §1 map, less its locked (L) and phase-8 (P8) rows (79 steps in 9 tests), as the Editor (the shared inbox, R10, as the Admin); each guest check is polled for at most 5 s from the save; each item is put back through the History of its screen, except the two screens without one (the booking switch, phase 4, and the shared inbox, phase 5), which are saved back.
- **AC2, no guest text outside the registry or the database.** `test/guards/guest-text.guard.test.ts`: PENDING `{}` (B8); the seven language-switcher words are LOCKED until phase 8 (R35).
- **X1, every key, table and column has an editing screen.** `test/guards/editing-screens.guard.test.ts`: `NOT_BUILT` `[]` (B8).

Final gate (B11, twice on the last commit, plus a third E2E run with `TZ=UTC`):
- typecheck clean; lint exit 0 with 14 warnings.
- Unit and integration: 122 files, 1553 tests.
- `Applied 9 migration(s).`; build and check-prerender pass.
- Server DOM diff against the `c896b13` build: `/en` 12 lines, `/en/restaurants/taya-house` 10 (B7's four meta lines, L7-13), `/en/privacy` 0.
- E2E: 232 passed, 2 skipped (the opt-in BotID and RSC-race specs), each run.
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

## Closed in 7B

- **Plan 7A's "Carried to plan 7B" (every line):**
  - L7-2 (B1; a hidden destination's number is never another restaurant's larger-group phone, on the drawer or in the emails), L7-6 (B5), L7-7 (B3, B5), L7-10 (B1), L7-13 (B7), L7-14 for nav items (B4), L7-15 (B5), L7-17 (B11: `test/integration/fk-coverage.test.ts`, every foreign key with its ON DELETE action and the named test that drives it, or why no phase-7 path deletes its parent), L7-18 (B11, above).
  - The remaining screens `cuisines`, `destinations`, `experiences`, `booking`, `navigation`, `contact`, `seo` (B1–B7; `NOT_BUILT` `[]` at B8); PENDING `{}` (B8); a Vietnamese `label` on every key (B8).
  - The form-kit retrofit of the booking admin (B9) and of the auth, users and settings forms (B10).
  - AC1's checklist walk, the closing E2E runs, this ledger, and the DOM-diff base worktree removed (B11).
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

## Deferred, with the reason

- **To phase 10:**
  - A file of the wrong kind in a picker gets the "đã bị xóa" message (A6/A9): only a forged post reaches it, since the pickers list one kind.
  - The trash lists at most 20 files (A6): a restaurant site's 30-day trash rarely holds more; paging goes with the History pager (phase 10).
  - `SECTION_PARTS` typed `Record<string, …>` (A9): 7B added no section, which was the trigger; type hygiene.
  - The hero page names a deleted slide whose picture went to the trash "slide" (A9): cosmetic, and rare.
  - The advisory "MENU hidden" warning can be missing when the only highlight's picture is in the trash (A10): advisory only.
  - The sweep never retries the out-of-folder files of rows it purged in a run whose orphan pass then failed (fix-wave residual): storage only, and it needs the store to fail mid-run.
  - The inbox search results' lost conflict alert (above), with the router-level unsaved-changes guard.
- **Phase 8, 9, 10 lists of the 7A ledger:** unchanged.

## Needs a decision or a first-preview check

Unchanged from the 7A ledger (the real Blob service, sharp's memory, the owner's content, the lawyer's two points). Plan 7B's "Cần quyết định" risk 11 (the destination address edited on the destinations screen, not on contact) stands as ruled (R24) unless the owner asks otherwise.
