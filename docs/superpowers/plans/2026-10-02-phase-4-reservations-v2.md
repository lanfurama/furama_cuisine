# Đợt 4: Đặt bàn v2 — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đặt bàn chạy trên quy tắc trong DB (ca phục vụ, ngày đóng cửa, quy tắc chung và theo nhà hàng) qua một engine thuần dùng chung; khách thấy ngày đóng cửa màu xám và giới hạn số khách do server cấp; mọi lần ghi giữ chỗ đi qua một khóa ngày đặt bàn duy nhất nên không bao giờ vượt sức chứa; nhân viên xác nhận, hủy, đánh dấu đến/không đến, tạo mới, xem theo ngày, sửa giờ và sức chứa, quản lý ngày đóng cửa và cài đặt đặt bàn trong admin tiếng Việt.

**Architecture:**
- **Dữ liệu:** migration `006_booking_v2.sql` (một transaction, chỉ mở rộng) thêm `booking_settings`, cột ghi đè và công tắc `booking_enabled` trên `restaurants`, `service_periods` (seed đúng hành vi hiện tại: `SLOTS` × `restaurants.meals` × `slot_capacity`), `closures` → `closure_i18n`, các cột v2 của `reservations`, `reservation_events`, `reservation_notes`, và view `audit_feed` = `audit_log` ∪ `reservation_events`. Trigger `reservations_before_write` giữ `version`, `updated_at`, `search_text`; `fold_search()` là bản SQL của `fold()`.
- **Engine:** `lib/booking/resolve-day.ts` thuần và chạy cả hai phía. `planDay` (spec §10.1 bước 1–3, không đồng hồ) cho mọi đường của nhân viên; `resolveDay` (thêm bước 4: đóng cửa, lead time, cutoff, số khách, sức chứa, cửa sổ, công tắc) cho khách; `clockBlock` là riêng phần đồng hồ, form khách dùng lại. Quy tắc đọc sống (`loadBookingRules`, một round trip), **không cache** (spec §6.2).
- **Ghi:** mọi lần ghi lấy chỗ gọi `lockBookingDay` (advisory lock `booking:<nhà hàng>:<ngày>`, `lock_timeout` 5 s) rồi mới đọc quy tắc và số chỗ trong cùng transaction. Ghi đặt bàn vào `reservation_events`, ghi cấu hình vào `audit_log` (spec §7.4).
- **Khách:** `/api/availability` có hai dạng (lịch và một ngày), luôn `no-store`; `SiteProvider` hỏi lịch trước rồi bảng giờ của ngày, chỉ câu trả lời mới nhất được dùng.
- **Admin (Phần B):** vòng đời trạng thái một map TypeScript có cửa sổ thời gian và `version`; hộp thư, chi tiết, tạo mới, theo ngày, ngày đóng cửa, "Giờ và sức chứa", "Cài đặt đặt bàn"; lưu ca và quy tắc của nhà hàng gọi `updateTag('restaurants')` và `updateTag('booking-rules:<id>')`, lưu cài đặt, tự xác nhận và ngày đóng cửa gọi `updateTag('booking-rules:<id>')` của mọi nhà hàng chịu ảnh hưởng. Ghi đặt bàn chỉ vào `reservation_events`.

**Tech Stack:** Next.js 16.3.7 (Turbopack, `cacheComponents`, `partialPrefetching`, `experimental.authInterrupts`), React 19.3, TypeScript 7.0.2, `pg` 8.23, Postgres 18 (pg_trgm), zod 4.6.5, better-auth 1.7.7, libphonenumber-js, Vitest 5, Playwright 1.63, oxlint 1.86, oxc-parser 0.152.0. Không thêm thư viện nào.

**Spec:** `docs/superpowers/specs/2026-10-01-admin-cms-design.md` — mục 14.1 dòng 4 (đợt 4); chi tiết ở §5.2 "Đặt bàn (đợt 4)", §6.2–6.3, §7.1 (các dòng đặt bàn, ngày đóng cửa, cài đặt), §7.2, §7.4, §10.1–10.3, §11–§13, §16. `notification_recipients` và `email_outbox` thuộc đợt 5.

**Căn cứ đã kiểm chứng:**
- `docs/superpowers/research/2026-10-02-phase-4-spikes/00-plan-outline.md` (dàn ý của lead: sự kiện F1–F13, xung đột C1–C18, phán quyết R1–R16) cùng ba báo cáo spike `booking-engine.md`, `guest-booking-ui.md`, `reservations-admin.md`. Chỗ báo cáo và dàn ý khác nhau, dàn ý thắng; chỗ kế hoạch này khác dàn ý, lý do nằm ở "Ghi chú triển khai".
- **Phần A (Task 1–6):** mọi khối code được lấy nguyên văn từ bản sao kiểm chứng `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p4-verify`, nhánh `p4-folded`, gốc `3c04ace` (cách nhánh đó được dựng: gạch đầu dòng "Sửa sau review" bên dưới). Phần A đã được chạy đúng thứ tự Task 1→6 trong bản sao đó, mỗi task một commit, mỗi task xanh typecheck, lint, unit + tích hợp, build, check-prerender, E2E (`--retries=0`) và visual ở ngưỡng 0. Output "Expected: FAIL" là output thật của lần chạy đó (đường dẫn tuyệt đối rút gọn thành `…`). SHA và số đếm từng task nằm ở "Bản kiểm chứng".
- **Phần B (Task 7–14):** cùng cách làm, trong cùng bản sao, chạy tiếp ngay trên commit cuối của Phần A (`d000870`), đúng thứ tự Task 7→14, mỗi task một commit và một lần cổng kiểm tra xanh. Code của Phần B lấy từ spike admin (`p4-admin`, commit `e274649`) rồi viết lại trên engine, loader và khóa của Phần A (dàn ý C2–C4); những chỗ khác dàn ý nằm ở "Ghi chú triển khai (Phần B)". Mỗi task chạy test mới trước khi có code (RED thật), mỗi test đồng thời hay "guard" được chạy thêm một lần với guard bị gỡ; Task 14 gỡ lần lượt guard của từng tiêu chí nghiệm thu (6 lần build).
- **Sửa sau review:** ba phát hiện của vòng review kế hoạch được sửa thành một commit thêm trên `main` của `p4-verify` (`74967cb`), chạy đủ cổng (`Tests  572 passed (572)`, E2E `101 passed`, visual `8 passed`), rồi gộp vào task sở hữu file trên nhánh `p4-folded` (dựng lại từ `3c04ace`, một commit mỗi task, cùng commit message): `conflict()` chỉ nêu người của sự kiện đổi hàng (`status_changed`, `edited`), không phải người thêm ghi chú (Task 8); đặt qua điện thoại cho một giờ đã qua của hôm nay bị từ chối ở ô Giờ (R8, Task 8); view `audit_feed` gọi sự kiện không nhãn của khách là `'Khách'`, nên `/admin/audit` không ghi đặt bàn web là của "Hệ thống" (Task 1, test của nó ở Task 1 và Task 7). `git diff --stat main p4-folded` rỗng. Mọi SHA, khối code, diff và số đếm trong kế hoạch là của `p4-folded`; mỗi commit của `p4-folded` đã chạy lại đủ cổng.
- Sổ việc hoãn của đợt 3 (`docs/superpowers/ledgers/2026-10-02-phase-3-ledger.md`, mục "Phase 4") giao bốn việc, cả bốn nằm ở Task 7 (Phần B): `unstable_rethrow` đầu `actionError` trước action đầu tiên của đợt 4, tách `clientIp()`, `/admin/audit` phân trang keyset, và hiện email cho thực thể `staff_invitation`. Sổ của đợt 2 (`2026-10-01-phase-2-ledger.md`) có hai mục dính đặt bàn: E2E còn thiếu cho nhãn View/Reserve của SearchOverlay (Task 11, spec `desktop-serial`), và M3 "đường đặt bàn chịu được nhãn ẩm thực lạ" — Task 4 giải quyết tận gốc vì đường đặt bàn không còn đọc catalogue.
- Tài liệu Next được trích theo `node_modules/next/dist/docs/<file>.md:dòng`.

## Global Constraints

**An toàn dữ liệu — đọc trước mọi lệnh:**
- `.env.local` đang trỏ vào **DB Neon dùng chung với production**.
- **Không bao giờ chạy** `npm run db:migrate`, `npm run db:psql`, `npm run dev`, `vercel env pull`. Không bao giờ chạy `npx auth …` thiếu `--config scripts/auth-cli.config.ts`. Không kết nối Neon.
- Mọi lần ghi DB của E2E đi qua `db()`/`one()` trong `e2e/staff-fixtures.ts` (từ chối mọi DB không phải DB cục bộ tên `*_test`/`*_ci`).
- Mọi lần build, `next start`, E2E và visual đều dùng **tiền tố env cục bộ** (biến của tiến trình thắng `.env.local`; bốn biến `PG*` phải để trống):

  ```bash
  CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test
  ```

- `next start` và E2E còn cần biến auth và email; **`EMAIL_DELIVERY=log` đặt tường minh**:

  ```bash
  BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson E2E_PORT=3210
  ```

- Chỉ được tạo, reset hoặc xóa các DB cục bộ sau: `furama_cuisine_test` (tích hợp; test tự tạo thêm `furama_cuisine_migrate_test`, `furama_cuisine_migrate004_test`, `furama_cuisine_migrate005_test`, `furama_cuisine_migrate006_test`) và `furama_cuisine_e2e_test` (build, E2E, visual). Từ Task 1, `TEST_DB_TAG=x` đổi tên các DB migrate thành `…_x_test`, để hai bản checkout chạy cùng một Postgres. Tạo lại bằng `RESET_DATABASE_URL=postgres://localhost:5432/<tên> node scripts/reset-db.mjs` (script từ chối host khác localhost và tên không kết thúc bằng `_test`/`_ci`).
- Cổng: E2E `3210`, visual `3211` (khoảng 3200–3299 dành cho agent; CI dùng 3100). Trước khi bật server, `lsof -nP -iTCP:<cổng> -sTCP:LISTEN` phải không in gì; xong thì `lsof -ti tcp:<cổng> | xargs kill`.
- Kế hoạch này **không chạy migration 006 lên Neon**. README (Task 14) ghi các truy vấn kiểm tra trước (pre-flight) và việc kiểm advisory lock trên một branch Neon, đều là bước của người dùng.
- **zsh:** không bắt đầu một đối số bằng `=`; đặt glob trong nháy (`--include='*.ts'`); zsh không tách từ của biến, nên lặp qua danh sách bằng `… | while read -r x; do …; done`.

**Git:**
- Làm thẳng trên `main`, không tạo branch. Mỗi task một commit. **Không push.** `git add` từng file cụ thể (`git rm` cho file xóa), không dùng `git add -A`.
- Hai mục untracked không thuộc các commit này: chính file kế hoạch này và thư mục `docs/superpowers/research/2026-10-02-phase-4-spikes/`.
- Mọi commit message kết thúc bằng dòng attribution mà phiên thực thi của bạn được cấu hình để thêm. Các khối commit dưới đây in dòng của phiên kiểm chứng (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); nếu phiên của bạn cấu hình dòng khác, thay dòng cuối bằng dòng đó.

**Next 16 và TypeScript 7** (giữ nguyên quy ước đợt 3, thêm của đợt 4):
- Đọc tài liệu trong `node_modules/next/dist/docs/` trước khi dùng API Next (theo `AGENTS.md`), trích theo `file.md:dòng`.
- `npm run typecheck` = `next typegen && tsc --noEmit --incremental false`. `next build` cũng typecheck file test (`tsconfig` gồm `**/*.ts`): một lỗi kiểu trong test, hoặc một test import module chưa có, làm hỏng build.
- Mọi `app/admin/**/page.tsx` export `instant = false` và gọi `verifySession()`/`requirePagePermission()` trước khi đọc DB. Không `style=` dưới `app/admin`, không component của web khách, chưa dùng `next/image`.
- **Action:** câu lệnh đầu tiên là `await requirePermission(…)` (đứng riêng, là initializer duy nhất, hoặc câu đầu trong một `try` cấp cao nhất có `catch` kết thúc bằng `return`/`throw`). Sau đó zod, rồi transaction, rồi `updateTag`/`refresh()`, rồi `ActionResult`. Từ đợt 4, `redirect()` **được** nằm trong `try` (R13), vì `actionError` gọi `unstable_rethrow` trước tiên.
- `updateTag` chỉ gọi trong Server Action (`01-app/03-api-reference/04-functions/updateTag.md:12`), sau COMMIT. Action đặt bàn gọi `refresh()`.
- **Không `'use cache'`** trên bất cứ thứ gì đọc quy tắc đặt bàn, số chỗ đã giữ hay đặt bàn (R2). Route `/api/availability` đọc `request.url` và trả `cache-control: no-store`; không dùng `connection()`.
- Locator E2E: theo role, hoặc `getByLabel(…, { exact: true })`. Thông báo trạng thái tìm trong dialog hoặc `main` (route announcer của Next cũng là một live region). Bấm vào ô ngày `aria-disabled` cần `{ force: true }` (Playwright coi `aria-disabled` là chưa bật; cú chạm thật vẫn tới vì nút không `disabled`).
- Comment trong code viết bằng tiếng Anh, giải thích "vì sao". Lint thoát 0; trước đợt 4 có 20 cảnh báo, Task 6 bớt một (19).

**Phiên bản** (không cài gì mới): `next@16.3.7`, `react@19.3.0`, `typescript@7.0.2`, `pg@8.23.0`, `zod@4.6.5`, `better-auth@1.7.7`, `libphonenumber-js@^1.13.14`, `vitest@5.0.3`, `@playwright/test@1.63.0`, `oxlint@1.86.0`, `oxc-parser@0.152.0`. Node 22.22.0 cục bộ (24 trong CI); Postgres 18.3 cục bộ với pg_trgm 1.6.

**Tên trong migration `006_booking_v2.sql`:**
- `booking_settings` (một hàng): `id boolean PK DEFAULT true` + CHECK `booking_settings_single_row`; `window_days` 1–90 (14), `lead_minutes` 0–1440 (30), `same_day_cutoff time` (NULL = không có; phút chẵn), `max_party` 1–50 (12), `auto_confirm` (false), `guest_ack_email` (true), `pii_retention_months` 1–120 (24), `updated_at`, `updated_by`.
- `restaurants` thêm: `booking_enabled boolean NOT NULL DEFAULT true`; ghi đè `window_days`, `lead_minutes`, `max_party`, `auto_confirm` (NULL = theo mặc định chung); `updated_at`, `updated_by`.
- `service_periods`: `id`, `restaurant_id` (FK, ON UPDATE/DELETE CASCADE), `meal`, `weekdays smallint[]` (ISO 1–7), `first_seating`, `last_seating` (`time`), `interval_min` ∈ {15, 20, 30, 45, 60, 90, 120}, `covers_per_slot` 0–1000, `active`, `sort_order`, `created_at`, `updated_at`, `updated_by`; CHECK `service_periods_order`, `service_periods_grid`, `service_periods_weekdays_check`. Seed: Breakfast 10, Lunch 20, Drinks 30, Dinner 40.
- `closures` (`scope` all/destination/restaurant, `destination_id`, `restaurant_id`, `starts_on`/`ends_on` gồm cả hai đầu, `meals text[]` NULL = cả ngày, `show_reason` DEFAULT true, `internal_note` ≤ 2000, `created_*`, `updated_*`); CHECK `closures_dates`, `closures_scope_target`, `closures_meals_check`. `closure_i18n` PK `(closure_id, locale)`, `public_reason` khác rỗng ≤ 160 (hàng chỉ tồn tại khi có lý do), cùng các cột bản dịch.
- `reservations` thêm: `meal NOT NULL`, `locale NOT NULL DEFAULT 'en'` (FK), `source NOT NULL` **không default** (`web|phone|walk_in|staff|legacy`), `offer_id bigint`, `over_capacity`, `status_reason` ≤ 500, `confirmed_at`, `cancelled_at`, `search_text`, `is_test`, `anonymized_at`, `version ≥ 1`, `updated_at NOT NULL`, `updated_by`. CHECK `reservations_status_check` (6 trạng thái), `reservations_guests_check` (1–50), `reservations_reserved_at_check`, `reservations_meal_check`. `reserved_at` vẫn là `text`; so trong SQL bằng `reserved_at::time`.
- `reservation_events`: `actor_kind` guest/staff/system, `actor_id`, `actor_label`, `type` ∈ {created, status_changed, edited, note_added} (CHECK `reservation_events_type_check`; đợt 5 thay CHECK này khi thêm sự kiện email), `from_status`, `to_status`, `changes jsonb`, `reason` ≤ 500; CHECK `reservation_events_staff_actor`, `_created_status`, `_transition`. `reservation_notes`: `author_id`, `author_label`, `body` không trắng ≤ 2000.
- Hàm `fold_search(text)`, `reservation_search_text(guest_name, email, phone, phone_e164, reference)` (IMMUTABLE); trigger `reservations_before_write` (BEFORE INSERT OR UPDATE).
- Index: `service_periods_restaurant_idx`, `closures_dates_idx`, `reservations_load_idx (restaurant_id, reserved_on, reserved_at) INCLUDE (guests) WHERE status IN ('requested','confirmed','seated')` (thay `reservations_slot_idx`), `reservations_inbox_idx`, `reservations_created_idx`, `reservations_pending_idx`, `reservations_day_idx`, `reservations_phone_idx`, `reservations_search_trgm_idx` (GIN trigram), `reservation_events_reservation_idx`, `reservation_events_at_idx`, `reservation_notes_reservation_idx`. `reservations_dedupe_v2_idx` giữ nguyên.
- `audit_feed`: `source, id, at, actor_id, actor_label, action, entity_type, entity_id, locale, before, after`, đúng thứ tự của 005. Dòng đặt bàn: `source 'reservation'`, `action 'reservation.<type>'`, `entity_type 'reservation'`, `actor_label` = nhãn của sự kiện, hoặc `'Khách'` cho sự kiện của khách không có nhãn (sự kiện hệ thống không nhãn vẫn `NULL`, trang hiện "Hệ thống"), `before {status}`, `after` = `jsonb_strip_nulls({status, changes, reason})`.
- Thực thể audit của cấu hình (Phần B): `service_periods` (id = nhà hàng), `restaurant_booking`, `booking_settings` (action `settings`), `closure`.

**Hằng số:** mặc định window 14, lead 30, max party 12, cutoff NULL; tối đa 20 ca mỗi nhà hàng (zod); `HOLDING_STATUSES = ['requested', 'confirmed', 'seated']`; `UPCOMING_STATUSES = ['requested', 'confirmed']`; `STAFF_SOURCES = { phone: 'confirmed', walk_in: 'seated' }`; cửa sổ vòng đời: `seated` từ 60 phút trước giờ ngồi, `no_show` từ 15 phút sau, sửa nhầm trong cùng ngày phục vụ, `SERVICE_DAY_ROLLOVER_MINUTES = 240`; `MAX_RANGE_DAYS = 92`; `lock_timeout '5s'`; `REFERENCE_ATTEMPTS = 3`; hộp thư 30 dòng một trang, nhật ký 50; lý do ≤ 500, ghi chú ≤ 2000, lý do đóng cửa công khai ≤ 160; mã tham chiếu `^FC-[0-9A-HJKMNP-TV-Z]{8}$` (ô tìm vẫn nhận mã cũ `FC-\d{5}`).

**Ma trận quyền** (file dưới `app/admin/(shell)/`, Phần B):

| Trang hoặc action | Quyền | Editor |
|---|---|---|
| trang `reservations`, `reservations/[id]`, `reservations/day` | `reservations:read` | ✓ |
| trang `reservations/new`; action `createReservation` | `reservations:create` | ✓ |
| action `changeStatus`, `updateReservation`, `cancelReservations` | `reservations:update` | ✓ |
| action `addNote` | `reservations:note` | ✓ |
| trang `reservations/closures`, `restaurants`, `restaurants/[id]/booking` | `schedule:read` | ✓ |
| action `addClosure`, `editClosure`, `removeClosure`, `savePeriods` | `schedule:update` | ✓ |
| action `saveRules` (công tắc và ghi đè) | `reservations:configure` | ✓ |
| `restaurants/[id]/booking/auto-confirm-actions.ts#saveAutoConfirmSetting` | `reservations:auto-confirm` | ✗ (file chỉ Admin) |
| trang `settings/booking`; `settings/booking/actions.ts#saveSettings` | `settings:read` / `settings:update` | ✗ (file chỉ Admin) |

`submitReservation` vẫn nằm trong danh sách công khai 6 mục. `reservations:purge-test` chưa dùng ở đợt 4.

**Mã lỗi:**
- Khách (`BOOKING_ERROR_CODES`, key `error.<code>`): `restaurant_unavailable`, `party_too_large {max, phone}`, `outside_window`, `slot_unavailable {restaurant}`, `past` (lead hoặc cutoff), `invalid_name`, `invalid_phone`, `invalid_email`, `full`, **`closed`** (mới), `duplicate`, `unknown`, `network` (chỉ client). Đợt 5 thêm `consent_required`, `too_many_requests`, `bot_blocked`.
- API: 400 `restaurant_required`, `invalid_date`, `invalid_range`, `invalid_guests`; 404 `restaurant_unavailable`; 503 `unavailable`.
- `ActionCode` admin (Phần B): của đợt 3 cộng `conflict {by, at}`, `not_allowed`, `too_early`, `too_late`, `full {left}`, `closed`, `slot_unavailable`, `duplicate`; `ActionFailure` có thêm `params?: Record<string, string>`.

**Quy tắc code:**
1. **Một khóa:** mọi lần ghi lấy chỗ (khách đặt, nhân viên tạo, sửa làm dời hoặc tăng một đặt bàn) gọi `lockBookingDay` trước khi đọc quy tắc hay số chỗ; quy tắc, số chỗ và INSERT/UPDATE nằm trong cùng transaction. Mỗi transaction tối đa một khóa ngày đặt bàn. `grep -n pg_advisory` chỉ ra đúng một chỗ gọi (`lib/server/booking/lock.ts`).
2. Kiểm cho khách dùng `resolveDay`; đường của nhân viên, xem trước, bảng theo ngày và danh sách bị ảnh hưởng dùng `planDay`. `HOLDING_STATUSES` chỉ lấy từ `lib/booking/rules.ts`, kể cả tham số SQL.
3. **Ngày:** cột `date` rời SQL bằng `to_char(col, 'YYYY-MM-DD')`, không bao giờ thành `Date` của JS (node-pg đọc nó là nửa đêm giờ máy) hay `::text` (theo DateStyle của phiên). Cột `time` rời SQL bằng `to_char(col, 'HH24:MI')`. "Hôm nay" là `venueNow().date` truyền làm tham số, hoặc `(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`; không bao giờ `CURRENT_DATE`.
4. **Trigger sở hữu** `version`, `updated_at`, `search_text` của `reservations`. SQL của app chỉ đặt `updated_by` và bỏ qua UPDATE không đổi gì, vì mọi UPDATE đều tăng `version`.
5. Ghi đặt bàn vào `reservation_events`, ghi cấu hình vào `audit_log`, trong cùng transaction với thay đổi.
6. `fold` (JS) ≡ `fold_search` (SQL); ô tìm gập chuỗi bằng `fold_search($1)`. Test của Task 1 ghim hai hàm vào nhau.
7. Key registry mới khai `screen` và `vars`; chữ EN giữ đủ biến.
8. node-pg: không chạy truy vấn chồng nhau trên một `PoolClient` (trong transaction chạy lần lượt).
9. Form cấu hình đồng bộ lại theo token mới mà không remount component giữ kết quả `useActionState`: `key={token}` trên `<form>`, hoặc chỉnh state ngay trong render.

**Bản đồ dữ liệu E2E** (mỗi spec có cặp nhà hàng × ngày riêng, vì các file chạy song song; spec nào đổi quy tắc thì trả lại trong `finally`). Bảng này là bản chốt sau khi chạy Phần B; README (Task 14) chép lại nó:

| Spec | Nhà hàng | Ngày hoặc trạng thái | Dọn |
|---|---|---|---|
| `booking-v2` (Task 6), đặt thật | taya-house | ngày mở cuối của cửa sổ | không |
| `booking-v2`, ngày đóng cửa trong DB | don-ciprianis | hôm nay + 9 | xóa closure |
| `booking-v2`, `max_party` trong DB | the-fan | `max_party = 8` | về NULL |
| `admin-audit` (Task 7, 9) | taya-house | 2025-12-31 (đã qua), dòng nhật ký năm 2001 | xóa dòng nhật ký |
| `admin-reservations` (Task 9, 10) | taya-house | +3, +4, +6, hôm qua | không |
| `admin-reservations`, tìm kiếm (Task 9) | v-senses-cafe | +8 | không |
| `admin-reservations`, tạo mới (Task 10) | chaoshan-hotpot | +7 | không |
| `admin-booking-config` (Task 11) | thai-siam-kitchen | ca Dinner; khách +2, +3 | trả ca, xóa dòng audit |
| `admin-booking-config`, max party (Task 11) | hura-izakaya | ghi đè 8 | về NULL |
| `booking-switch.serial` (Task 11, project `desktop-serial`) | taya-house, hai-van-lounge | `booking_enabled` | bật lại |
| `admin-booking-settings` (Task 12) | danaksara | `auto_confirm`; ngày mở cuối | về NULL |
| `admin-closures` (Task 13) | pho-cuon | +5 | xóa closure |
| `admin-closures`, theo điểm đến (Task 13) | mm (yum-food-village) | +11 | xóa closure |
| `booking-acceptance` (Task 14) | yum-food-village | +3, +4, +12, +13, hôm qua; ca Dinner, `max_party` | trả ca, về NULL, xóa closure |

**Cổng kiểm tra của mọi task** (bước cuối mỗi task ghi con số mong đợi):

```bash
npm run typecheck
npm run lint
TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
node scripts/check-prerender.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson E2E_PORT=3210 npm run test:e2e -- --retries=0
lsof -nP -iTCP:3211 -sTCP:LISTEN
PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3211 EMAIL_DELIVERY=log npx next start -p 3211 &
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3211/ && break; sleep 1; done
VISUAL_BASE_URL=http://localhost:3211 npm run test:visual
lsof -ti tcp:3211 | xargs kill
```

Mốc tại `3c04ace`: unit + tích hợp 41 file, 375 test; E2E `70 passed`; visual `8 passed`; lint thoát 0 với 20 cảnh báo. Từ Task 11, `playwright.config.ts` có hai project: `desktop` (mọi spec, song song) và `desktop-serial` (các file `*.serial.spec.ts`, chạy sau khi `desktop` xong); lệnh E2E ở trên chạy cả hai, và con số "passed" là tổng của hai project. Chỉ định một file `*.serial.spec.ts` cũng chạy lại toàn bộ `desktop` trước (`dependencies`); thêm `--project=desktop-serial --no-deps` để chạy riêng nó. oxlint 1.86 không in dòng tổng; đếm cảnh báo bằng `npm run lint 2>&1 | grep -c ': warning '`. Visual luôn mong đợi `8 passed` ở `maxDiffPixelRatio: 0`. **Không bao giờ chạy `--update-snapshots`.** Visual đỏ thì mở `test-results/**/*-diff.png` và sửa code.


## Rulings — 16 điểm lệch spec đã được chấp nhận (không báo lại khi review)

Kế hoạch chấp nhận cả 16 phán quyết đề xuất trong dàn ý (mục 2). Mỗi mục ghi điều sẽ xảy ra nếu phán quyết sai. Reviewer không nêu lại chúng như lỗi.

1. **R1. Migration 006 đi cùng code đợt 4** (spec §5.1.7 "mở rộng trước, thu gọn sau"). 006 chỉ thêm, nhưng `reservations.meal` NOT NULL và `source` không có default, nên INSERT của đợt 3 hỏng trên DB đã migrate. Site chưa từng deploy (`README.md:86-91`), nên README ghi: chạy 006 ngay trước (hoặc cùng) lần deploy đầu của đợt 4, như với 003. Trong kế hoạch, Task 1 bắc cầu INSERT cũ cho tới khi Task 4 thay nó. **Nếu sai** (có gì đó được deploy trước đợt 4): chạy 006 trong cửa sổ deploy, hoặc tạm cho `source` default `'web'`.
2. **R2. Quy tắc đặt bàn và availability không bao giờ cache; các lần lưu vẫn gọi `updateTag('restaurants')` và `updateTag('booking-rules:<id>')`.** Spec §6.2 ghi "Không cache: đặt bàn, availability", §10.1 đòi cả hai tag. Ở đợt 4 không gì đọc dưới `booking-rules:<id>`; `restaurants` phủ catalogue (`bookingEnabled`, `meals`). Một bộ đọc `'use cache'` chạy đúng trong một process (spike engine đã đo), nhưng bị loại vì entry "typically don't persist across requests" trên serverless (`01-app/03-api-reference/01-directives/use-cache.md:247-252`), việc làm mới mặc định chỉ ở instance gọi (`01-app/02-guides/how-revalidation-works.md:55-57`), và action vẫn phải đọc lại quy tắc dưới khóa. **Nếu sai:** thêm một truy vấn mỗi lần hỏi availability. Bộ đọc cache nào sau này nhúng dữ liệu quy tắc phải gắn tag `booking-rules:<id>`.
3. **R3. Lead time và cutoff trong ngày.** Một slot đặt được khi `minutesUntil > lead_minutes` trên đồng hồ Đà Nẵng đã cắt xuống phút. Dưới phép cắt, "> lead" chính là "còn ít nhất lead_minutes": lúc 18:30:59, `minutesUntil(19:00)` là 30 nhưng chỉ còn 29 phút 1 giây. Cũng bằng hành vi đợt 1. Hôm nay đóng khi đồng hồ ở hoặc qua `same_day_cutoff`, báo mã `past` (bảng mã của spec không có mã riêng); cutoff chỉ có ở mức chung. `error.past` được viết lại để đúng cho cả hai nguyên nhân (Task 4). **Nếu sai:** lệch một phút ở biên.
4. **R4. Hợp đồng API.**
   - Lịch: `GET /api/availability?restaurant=&lang=[&from=&to=]` → `{restaurant, today, now, maxParty, groupPhone: {display, tel} | null, days: [{date, state, reason?}]}`; `from`/`to` mặc định là cửa sổ; độ dài tối đa 92 ngày.
   - Một ngày: `?restaurant=&date=&lang=[&guests=]` → `{restaurant, today, now, date, state, reason?, maxParty, leadMinutes, sameDayCutoff, periods: [{meal, closed, reason?, slots: [{time, left, bookable, block?}]}]}`; ca bị đóng có `slots: []`; `guests` mặc định 1.
   - Trạng thái ngày: `open | full | past | closed | too_large | outside | unavailable`; lý do chặn slot: `closed | lead | cutoff | party | full`.
   - HTTP: 400 `{error}` (`restaurant_required`, `invalid_date`, `invalid_range`, `invalid_guests`); 404 `restaurant_unavailable` cho nhà hàng lạ hoặc đã tắt đặt bàn; 200 với `state: 'outside'` cho ngày hợp lệ ngoài cửa sổ; 503 `unavailable`; luôn `cache-control: no-store`. `lang` sai hoặc đang tắt thì dùng ngôn ngữ mặc định.
   - `now` là một thời điểm ISO (lệch so với `nowMinutes` của spec, đã ghi ở §10.2 từ đợt 1). Client gửi hai request (lịch, rồi ngày), không bao giờ gửi `guests`, và tự đóng slot bằng `leadMinutes`/`sameDayCutoff` của server cùng độ lệch đồng hồ (`clockBlock`). Một câu trả lời ngày có `state: 'outside'` làm client nạp lại lịch. **Nếu sai:** sửa một client, trước đợt 5.
5. **R5. Trạng thái ngày tính cho nhóm một người; ngày `full` và `past` cũng xám như ngày đóng cửa.** Đợt 1 cho chọn ngày hết chỗ rồi mới báo "No tables left". Lý do hiện ra là lý do đóng cửa công khai, nếu không thì `booking.day_closed`, `booking.day_full` hoặc `booking.day_past`. **Nếu sai:** sửa CSS và `reconcileBooking`.
6. **R6. Một giờ ngồi thuộc một ca** (spec không nói). Sức chứa tính theo (nhà hàng, ngày, `reserved_at`) như đợt 1. Admin từ chối lưu hai ca đang bật cùng có một giờ trong một ngày trong tuần chung ("Hai ca trùng giờ: Dinner và Drinks cùng có giờ 21:00."); `planDay` khử trùng theo thứ tự làm lớp chặn thứ hai. Không nhà hàng nào hiện có cả Dinner lẫn Drinks. **Nếu sai:** tính sức chứa theo (bữa, giờ), chạm index, loader và engine.
7. **R7. Những gì §5.2 để ngỏ, migration 006 chốt:** trigger `reservations_before_write` giữ `search_text`, `version`, `updated_at` (app SQL không đặt); `meal` NOT NULL, dữ liệu cũ lấy bữa từ ca seed phục vụ giờ đó, rồi theo giờ trong ngày; `source` không default, dữ liệu cũ là `'legacy'`, `is_test = true`, có sự kiện `created` với `actor_kind 'system'`; các CHECK ở "Tên trong migration"; `closures.show_reason` mặc định true; `restaurants.updated_at/updated_by` thêm ngay (cũng có trong danh sách của đợt 6; `IF NOT EXISTS`); index thêm `reservations_created_idx` cho tab "Tất cả". **Nếu sai:** mỗi mục là một migration nhỏ.
8. **R8. Nhân viên tạo hoặc sửa được vượt sức chứa khi ghi lý do** (spec: đặt bàn do nhân viên tạo được phép vượt sức chứa nếu ghi lý do). Lý do nằm trên sự kiện `created`/`edited`; không CHECK nào buộc `over_capacity` với `source` (một lần sửa đặt bàn web có thể vượt). Đường của nhân viên dùng `planDay`: bỏ qua cửa sổ, lead, cutoff, `max_party` và `booking_enabled`, nhưng không bao giờ bỏ qua ngày đóng cửa hay giờ không có trong ca. Khách vãng lai chỉ trong ngày phục vụ; đặt qua điện thoại không được ở quá khứ (ngày đã qua báo ở ô Ngày, giờ đã qua của hôm nay báo ở ô Giờ); sửa chỉ áp dụng cho trạng thái đang giữ chỗ. **Nếu sai:** thêm "bỏ qua ngày đóng cửa, có lý do" sau.
9. **R9. Chi tiết vòng đời spec để ngỏ:** "cùng ngày phục vụ" là ngày ở Đà Nẵng với mốc chuyển 04:00 (`serviceDay()`); từ chối và hủy đều bắt buộc lý do (`status_reason`); `seated` không có giới hạn trên; `no_show → seated` giữ lại chỗ mà không kiểm sức chứa (khách đã có mặt); ghi chú thêm sự kiện `note_added` chỉ chứa `{note_id}`.
10. **R10. Phần của đợt 5 bị bỏ ra:** không có ô "Báo khách" hay "Gửi email xác nhận"; nút hàng loạt ghi "Hủy các đặt bàn đã chọn", chạy từng đặt bàn và bỏ qua đặt bàn đã đổi từ lúc danh sách hiện ra. Mọi input mang `notifyGuest: false`; mỗi chuyển trạng thái khai `guestEmail`; hook `ReservationEffects` chạy trong transaction. Bước 1 (BotID, honeypot), 5 (giới hạn theo số điện thoại), phần outbox của bước 6 và `after(drainOutbox)` của bước 7 trong `submitReservation` thuộc đợt 5.
11. **R11. Mã lỗi và chữ cho khách.** Thêm `closed` vào `BOOKING_ERROR_CODES` cùng `error.closed`. `error.party_too_large` = "For more than {max} guests, please call us on {phone}." với vars `['max', 'phone']`; số gọi là của điểm đến, nếu không có thì của điểm đến đầu tiên có số (`restaurants.phone_*` đến ở đợt 6). `submitReservation` nhận `unknown` (zod) và trả thêm `data.status`. Hết thời gian chờ khóa (55P03) được ném ra, nên khách thấy `error.network`; không thêm mã.
12. **R12. Cơ chế đồng thời** (spec không nói): `lock_timeout` 5 s rồi `pg_advisory_xact_lock(hashtextextended('booking:' || nhà hàng || ':' || ngày, 0))` — pool chỉ có 5 kết nối, một người giữ khóa bị kẹt không được chặn cả ngày mãi. Lưu quy tắc không lấy khóa ngày; một lần lưu đua với một lần đặt có thể để một slot vượt sức chứa mới, danh sách bị ảnh hưởng hiện nó là `over_capacity`. Mỗi transaction tối đa một khóa: dời ngày chỉ khóa ngày đích, vì nhả chỗ không cần khóa.
13. **R13. `redirect()` nằm trong `try`** (đổi quy ước "redirect() nằm ngoài try" của đợt 3). Guard đòi `await requirePermission(…)` là câu lệnh đầu tiên, nên `let id;` trước `try` bị từ chối; `actionError` gọi `unstable_rethrow` trước tiên (`01-app/03-api-reference/04-functions/unstable_rethrow.md:62`), nên `NEXT_REDIRECT` đi qua.
14. **R14. `booking_enabled = false` ẩn gì trên web khách** (spec nêu RESERVE và danh sách trong form): thêm nút RESERVE A TABLE ở hero Tàya; RESERVE của thanh tab trang chi tiết (lưới mất một cột); "VIEW OFFER" của nhà hàng đó; nhãn "Reserve a table" của thẻ (thẻ không có trang riêng thành không bấm được, `aria-disabled`); nhãn "Reserve" của kết quả tìm kiếm. Nút RESERVE chung vẫn còn và mở drawer trên một nhà hàng đặt được (`DEFAULT_RESTAURANT_ID` nếu đặt được, nếu không thì nhà hàng đặt được đầu tiên).
15. **R15. Hình dạng `audit_feed` và phân trang `/admin/audit`:** dòng đặt bàn như "Tên trong migration"; phân trang keyset (`?truoc=`/`?sau=`, 50 dòng); liên kết `?trang=` cũ về trang mới nhất. Từ nay 006 sở hữu view; `migration-005.test.ts` dừng ở 005.
16. **R16. Phạm vi màn admin:** `/admin/restaurants` chỉ là danh sách dẫn tới "Giờ và sức chứa" (nội dung nhà hàng là của đợt 6); ô tìm của hộp thư bỏ qua tab đang chọn, tìm mọi đặt bàn, mới nhất trước; "Hôm nay" theo ngày Đà Nẵng; một token đồng thời mỗi nhà hàng (`restaurants.updated_at` đến micro giây) giữ cả form quy tắc lẫn trình sửa ca; ghi cấu hình vào `audit_log`, ghi đặt bàn (kể cả hủy hàng loạt từ một ngày đóng cửa) chỉ vào `reservation_events`; menu: Đặt bàn (`reservations:read`), Nhà hàng (`schedule:read`), Cài đặt đặt bàn (`settings:read`, Admin).

**Ghi chú triển khai.** Các điểm sau không lệch spec; chúng điều chỉnh dàn ý theo những gì lần chạy Phần A cho thấy. Mỗi điểm đã chạy trong `p4-verify`.
- **`slot-code.ts` vào Task 4, không phải Task 2.** Nó trả mã `closed`, mà mã này (và key `error.closed`, `DEFAULT_ERROR_STRINGS` đánh chỉ mục registry theo từng mã lúc biên dịch) đến cùng `submitReservation` v2. Task 2 vì vậy là engine thuần không phụ thuộc mã lỗi.
- **`fold_search()` dịch cả chữ hoa có dấu.** Dưới collation `C`, `lower()` để nguyên chữ không phải ASCII (đã thử: `lower('ĐỨC' COLLATE "C")` = `ĐỨC`), và tham số của hàm SQL mang collation của lời gọi. Collation của DB Neon không do ta chọn, nên danh sách `translate` gồm cả chữ hoa và thường của Latin-1, Latin Extended-A, ơ/ư và khối tiếng Việt (257 chữ, sinh từ `fold()` của JS). Test của Task 1 chạy toàn bộ 257 chữ dưới `COLLATE "C"`.
- **`reservation_search_text`** gồm tên đã gập, email thường, mã tham chiếu chữ thường, chữ số của `phone_e164`, dạng nội địa `0…` của số +84, và chữ số khách gõ chỉ khi chúng khác hai dạng kia.
- **Test seed (Task 2) tự dựng quy tắc từ SQL thô** (`restaurants.meals`, `slot_capacity`, `service_periods`), không qua loader của Task 3, `listRestaurants` (Task 5 đổi `meals`) hay helper đợt 1 (Task 6 xóa). Quy tắc đợt 1 viết lại ngay trong test.
- **Tên loader:** `loadBookingRules(db, ids, locale, from)` trả `Map<id, LoadedRules>` với `LoadedRules = { rules, groupPhone }`; bản một nhà hàng là `loadRestaurantRules`. `lockBookingDay` đặt `lock_timeout` bằng `set_config('lock_timeout', $1, true)` (tương đương `SET LOCAL`, nhưng có tham số).
- **Task 4 bỏ chế độ `lenient` của `listRestaurants`:** nó chỉ tồn tại cho đường đặt bàn (mục M3 của sổ đợt 2), mà đường đặt bàn v2 không đọc catalogue. Test "still books a valid restaurant, logging the label" của `submit-reservation.test.ts` bỏ theo.
- **Task 4 viết lại `error.past`** ("That time can no longer be booked online — please choose a later time or another day.") để đúng cho cả lead lẫn cutoff (R3); `e2e/booking-dates.spec.ts` và `registry.test.ts` đổi theo. `DEFAULT_PARAMS` của `bookingErrorMessage` có `max: '12'` và `phone` = `CONTACT.resortPhoneLabel`.
- **Task 5 bỏ `Restaurant.slotCapacity`:** sức chứa giờ là của từng ca; chỉ test seed còn đọc cột `slot_capacity`.
- **Luật 1c của `check-prerender`** đã được thử âm: một handler `GET` trả hằng số (không I/O) bị prerender và luật báo `/api/availability is prerendered; it must run per request`. Một handler bỏ đọc `request.url` nhưng vẫn truy vấn DB thì vẫn chạy lúc request (`01-app/01-getting-started/15-route-handlers.md:124`: truy vấn DB dừng prerender), nên hồi quy đó vô hại; `'use cache'` trên loader chỉ review bắt được (Review Focus 3).
- **API Task 5:** `lang` sai hoặc đang tắt rơi về mặc định thay vì 400 (R4); lý do đóng cửa theo ngôn ngữ chỉ được dùng khi ngôn ngữ đó đang bật (`locales.is_enabled`), khác spike engine (dàn ý C3).
- **Task 6 không đụng `openRestaurant`** hay các nút RESERVE riêng: đó là R14, thuộc Task 11. Từ Task 6, `openReserve` với một nhà hàng đã tắt đặt bàn giữ nhà hàng hiện tại (`reconcileBooking`).
- **E2E `booking-v2.spec.ts`** dùng `test`/`expect`/`one` của `e2e/staff-fixtures.ts` để ghi DB, và import `addDays`, `formatDay`, `venueNow` theo đường tương đối `../lib/venue-time` (như `smoke.spec.ts` import `../lib/data`).
- **Mock E2E** (`e2e/availability-mock.ts`) trả ngày ngoài cửa sổ là `state: 'outside'` (như server) thay vì 400 của spike khách.

**Ghi chú triển khai (Phần B).** Cũng không lệch spec; đây là chỗ Phần B khác dàn ý (mục 3) hoặc spike admin, và vì sao. Mỗi điểm đã chạy trong `p4-verify`.
- **Mỗi thứ đến cùng task đầu tiên dùng nó.** `FormMessage` (ở `app/admin/(shell)/_ui/`, dùng chung cho đặt bàn, nhà hàng, cài đặt) và `lib/admin/form.ts` đến ở Task 9, không phải Task 7. `lib/admin/booking-schemas.ts` lớn dần: Task 9 có các "nguyên tử" và schema của chi tiết, Task 10–13 thêm schema của màn mình, mỗi schema kèm test. `AffectedList` (ở `app/admin/(shell)/_ui/`) và action `cancelReservations` đến ở Task 11 (danh sách đầu tiên là của "Giờ và sức chứa"); Task 13 dùng lại. CSS admin thêm theo từng màn.
- **`findPlannedSlot(plan, time)`** (Task 8, trong `lib/booking/resolve-day.ts`): một cách duy nhất để đường của nhân viên, bảng theo ngày và danh sách bị ảnh hưởng biết một giờ thuộc ca nào, sức chứa bao nhiêu. `SLOT_INTERVALS` nằm ở `lib/booking/rules.ts` (Task 11), dùng chung cho zod và trình sửa ca.
- **Đường của nhân viên đọc quy tắc bằng `loadRestaurantRules(…, 'vi', date)`**: lý do đóng cửa không hiện ở đó, và ngôn ngữ đang tắt rơi về mặc định. `editReservation` không nhận `now` (sửa của nhân viên không xét đồng hồ).
- **Xung đột cấu hình có cả `at`**: `conflictBy` lấy `updated_at` của hàng, nên câu báo là "Vừa được Lan thay đổi lúc 10:05 02/10/2026" thay vì không có giờ như spike.
- **Bản chụp audit của ngày đóng cửa** dùng cùng một dạng (camelCase, đọc lại từ DB) cho `before` và `after`; spike ghi input ở `after` và snake_case ở `before`.
- **Lưu "Cài đặt đặt bàn"** chỉ làm hết hạn `booking-rules:<id>` của mọi nhà hàng, không làm hết hạn `restaurants`: catalogue không chứa giá trị mặc định nào. Spike làm cả hai.
- **`listLocales` liệt kê mọi ngôn ngữ, kể cả đang tắt**: `vi` mặc định đang tắt (migration 004) mà nhân viên vẫn cần ghi khách nói tiếng Việt. Xem rủi ro 21.
- **Giới hạn ô của nhân viên theo form khách**: tên ≤ 120, yêu cầu của khách ≤ 1000 (spike: 100 và 500), để sửa một đặt bàn web không bị chính giới hạn admin chặn.
- **`overviewCounts` và `daySheet` đếm chỗ bằng `HOLDING_STATUSES`** (tham số SQL hoặc lọc JS), không viết tay danh sách trạng thái (quy tắc code 2).
- **Hai test xuyên đường của Task 8 tạm dừng một transaction thật**: phía nhân viên qua hook `afterCreate`, phía khách qua một pool bọc dừng trước `INSERT INTO reservation_events`. Thả cổng nằm trong `finally`: lần chạy đầu với khóa bị gỡ treo transaction và làm 7 test sau hết giờ.
- **`booking-config.test.ts` trả seed về trong `afterAll`**: lần chạy đầu để `taya-house` tắt đặt bàn và làm hỏng `catalogue.test.ts` chạy sau nó.
- **`desktop-serial` (C13) đã kiểm**: project phụ thuộc chạy sau `desktop`; nếu `desktop` có test đỏ thì nó "did not run". Đối chứng âm: bỏ `updateTag` khỏi `saveRules` thì spec công tắc đỏ (`VIEW OFFER` còn 3 thay vì 1).
- **Nghiệm thu A1 giữ `LOCK TABLE reservations IN SHARE MODE`** trong lúc phát lại 8 request: qua một server `next start`, 8 POST gần như không chồng lên nhau, và lần chạy thử không cổng với khóa bị gỡ vẫn xanh (đã thấy). Có cổng, 5 request (bằng pool 5 kết nối của `db/client.ts`) đứng trong transaction cùng lúc; khóa ngày đặt bàn là thứ duy nhất ngăn cả năm đọc "còn 4 chỗ".
- **Nhật ký E2E (Task 7)** tự chèn 60 dòng năm 2001 và một dòng "bây giờ", rồi đi bằng con trỏ dựng tay, nên không phụ thuộc DB rỗng hay đầy.

## Review Focus

Năm tình huống spec ngụ ý mà dễ làm hỏng nhất cho người dùng thật. Mỗi dòng có test gắn vào task sở hữu code; tên test là tên thật trong các commit của `p4-verify`.

1. **Vượt sức chứa khi đặt song song.**
   - Có thể hỏng: hai khóa khác khóa (khách `booking:`, nhân viên một khóa khác) nên không bao giờ chờ nhau; đọc quy tắc hay số chỗ trước khi khóa rồi dùng để quyết định; đếm chỗ bằng `<> 'cancelled'` thay vì `HOLDING_STATUSES` (để `no_show`, `declined` giữ chỗ) hoặc bỏ sót `seated`; sửa tăng số khách mà không khóa; hai khóa trong một transaction (nguy cơ deadlock); đếm theo bữa trong khi sức chứa theo giờ; nhận vượt sức chứa không có lý do; pool 5 kết nối cạn vì người chờ khóa không có `lock_timeout`.
   - Test: `test/integration/submit-reservation.test.ts` "never seats more than the slot holds when many guests race for the last covers", "waits for another instance holding the (restaurant, date) lock, then re-reads the covers" (khóa giữ bằng SQL thô cùng khóa `booking:<id>:<ngày>`, nên ghim cả định dạng khóa) và "counts requested, confirmed and seated covers, not cancelled, declined or no-show ones" (Task 4; lần chạy đột biến bỏ khóa ở Task 4 Bước 9: 7 nhóm lọt vào thay vì 3); `test/integration/booking-rules.test.ts` "serialises one restaurant-day, and gives up after lock_timeout with 55P03" và "counts covers per date and time over the holding statuses only" (Task 3). Phần B: `reservation-lifecycle.test.ts` "concurrent bookings never exceed capacity (the booking-day lock)", "a staff booking waits while a guest’s submit holds the restaurant-day, then counts the guest’s covers" và "a guest’s submit waits while a staff booking holds the restaurant-day, then answers full" (Task 8; gỡ khóa khỏi `createStaffReservation`: cả hai test xuyên đường đỏ ở mọi lần chạy, và 8/8 nhóm lọt ở mọi lần trừ một trong chín lần chạy trên `p4-folded`, khi cuộc đua xanh vì may); `booking-acceptance.spec.ts` "A1. concurrent bookings never exceed capacity…" (Task 14; gỡ khóa khỏi đường của khách: 5 trong 8 request được nhận).
2. **Biên ngày giờ Đà Nẵng và cutoff.**
   - Có thể hỏng: `CURRENT_DATE`, `new Date().getDate()` hay một cột `date` bị node-pg đọc thành nửa đêm giờ máy, làm lệch một ngày trên UTC của Vercel; cửa sổ tính theo đồng hồ thiết bị; lead `>=` thay vì `>`; cutoff áp cho ngày mai; `serviceDay` thiếu mốc 04:00; tab "Hôm nay" hay trang Tổng quan dùng ngày của server; ngày trong E2E tính theo múi giờ của máy chạy test.
   - Test: `lib/booking/resolve-day.test.ts` "moves the window at Da Nang's midnight, not the server's", "needs more than lead_minutes on the clock minute: 18:29 books 19:00, 18:30 does not", "counts across Da Nang midnight", "stops same-day booking from the cut-off minute", "leaves tomorrow alone", và hai test của `clockBlock` (Task 2, cùng sáu đột biến biên ở Bước 7); `test/integration/booking-seed.test.ts` "agrees with phase 1 on the 14-day window, across Da Nang midnight" (Task 2); `booking-rules.test.ts` "picks the closures that reach the restaurant and have not ended before `from`" (ngày rời SQL là chuỗi `YYYY-MM-DD` dưới `TZ=UTC`, Task 3); `submit-reservation.test.ts` "stores the Da Nang date, the meal, the source, both phone forms and a created event" (01:00 ở Đà Nẵng, server UTC) và "closes a sitting by Da Nang time: lead time and same-day cut-off" (Task 4); `availability.test.ts` "marks today’s sittings inside the lead time, and today’s sittings after the cut-off" (Task 5); `booking-v2.spec.ts` dùng `venueNow`/`addDays` cho ngày đóng cửa (Task 6). Phần B: `lifecycle.test.ts` "puts the service day on Vietnam’s clock, whatever the server’s zone" (17:30Z/21:00Z, Task 8); `reservation-inbox.test.ts` "tabs: …" (ngày rời SQL là `YYYY-MM-DD` dưới `TZ=UTC`) và `format.test.ts` "formats a calendar date as itself, whatever the server timezone" (Task 9); lần E2E toàn bộ với `TZ=UTC` trên tiến trình `next start` (Task 14). Reviewer: `grep -nE "CURRENT_DATE|(reserved_on|starts_on|ends_on)(::text)? AS"` trên `lib/` và `app/` không ra gì.
3. **Availability cũ sau khi sửa quy tắc.**
   - Có thể hỏng: ai đó thêm `'use cache'` vào loader hay route; route mất `no-store` hoặc thôi đọc `request.url` và bị prerender; lưu ca hay công tắc quên `updateTag('restaurants')` nên `meals`/`bookingEnabled` của catalogue giữ giá trị cũ; client giữ bảng giờ của nhà hàng hay ngày khác (không kiểm `restaurant` được trả lại), hoặc không hỏi lại sau khi server từ chối; form xem trước của admin key theo `updated_at` và mất trạng thái "Đã lưu".
   - Test: `availability.test.ts` "shows an Editor’s new dinner hours and covers on the very next request" và kiểm `cache-control: no-store` ở mọi câu trả lời, kể cả 400/404 (Task 5); luật 1c của `scripts/check-prerender.mjs` cùng lần build âm ở Task 5 Bước 9; `catalogue.test.ts` "derives meals from the active service periods, in the canonical meal order (spec §6.3)" (Task 5); `lib/booking/client.test.ts` "ignores a board for another date" và "ignores a calendar for another restaurant" (Task 6); `booking-v2.spec.ts` "a closure written to the database greys the day on the next calendar fetch" (Task 6). Phần B: `admin-booking-config.spec.ts` "an Editor moves the last dinner seating to 22:00 with 8 covers; the preview and the guest see it at once" và `booking-switch.serial.spec.ts` (Task 11; đối chứng âm: bỏ `updateTag` khỏi `saveRules` thì công tắc đỏ, bỏ khỏi cả hai action thì bản xem trước đỏ); `booking-acceptance.spec.ts` "A4…" (Task 14; một bộ nhớ đệm câu trả lời ngày trong route làm nó đỏ). Reviewer: không có `'use cache'` dưới `lib/server/booking/` hay `app/api/availability/`; mọi action cấu hình gọi cả hai `updateTag` sau COMMIT.
4. **Đua chuyển trạng thái và cửa sổ thời gian.**
   - Có thể hỏng: UPDATE chuyển trạng thái thiếu `version` hay `status = ANY(from)`, người ghi sau thắng; cửa sổ chỉ kiểm trên giao diện; `from` không lọc theo cửa sổ lúc ghi; câu báo xung đột nêu sai người; `version` tăng hai lần (app và trigger) hoặc không tăng; sửa nhầm sau ngày phục vụ; `seated → confirmed` đụng index chống trùng và hiện `db_error` thay vì `duplicate`; hủy hàng loạt dùng version cũ; hook hiệu ứng chạy ngoài transaction.
   - Test: `migration-006.test.ts` "bumps version once per update and touches updated_at, whatever the SQL sets" (Task 1); `submit-reservation.test.ts` "turns the second of two simultaneous identical requests into duplicate" (Task 4). Phần B: `reservation-lifecycle.test.ts` "two people acting at once: exactly one wins, the other gets the conflict naming the winner", "a stale version is a conflict that names who changed it first", "a note added after the change does not take the blame for the conflict", "\"Đã đến\" from 60 minutes before the sitting; no-show only 15 minutes after", "corrections (no-show → seated, seated → confirmed) only on the same service day", "answers duplicate when a correction puts a booking back beside an active one with the same phone", "runs the phase-5 hook inside the transaction, with the transition’s guest email" (Task 8); `admin-reservations.spec.ts` "two people at once: the second sees who changed it first, and nothing is overwritten" (Task 9); `admin-closures.spec.ts` "a dinner closure lists the dinner bookings, not lunch, and cancels only the ticked one that has not changed" (Task 13); `booking-acceptance.spec.ts` "A3…" (Task 14; mở cửa sổ no-show thì đỏ). Reviewer: mọi `UPDATE reservations` trong app có `version = $n` trong WHERE; không SQL nào của app gán `version` hay `search_text`.
5. **Ngày đóng cửa liệt kê sai đặt bàn bị ảnh hưởng.**
   - Có thể hỏng: phạm vi điểm đến so sai cột; ngày cuối bị loại; đóng một bữa mà liệt kê mọi bữa; danh sách gồm đặt bàn đã hủy, bị từ chối, không đến hay đã bắt đầu, hoặc thiếu `requested`; đặt bàn nằm dưới hai ngày đóng cửa chỉ hiện một lần; đóng `all` chỉ kiểm một nhà hàng; sửa ngày đóng cửa chỉ làm hết hạn tag của phạm vi mới; danh sách tính trước COMMIT; tự hủy bất cứ gì.
   - Test: `resolve-day.test.ts` "includes both ends of the date range", "matches scope all, the restaurant’s destination, or the restaurant itself", "closes only the listed meals; the others stay bookable" cùng hai đột biến (ngày cuối, phạm vi điểm đến) ở Task 2 Bước 7; `booking-rules.test.ts` "picks the closures that reach the restaurant and have not ended before `from`" (Task 3). Phần B: `booking-config.test.ts` "lists exactly the bookings a closure covers: its scope, both end dates, its meals" và "never lists cancelled, declined, seated or no-show bookings, nor a sitting that has started" (Task 13); "lists the upcoming bookings the new hours leave out, and cancels none of them", "lists the bookings of a slot that now holds more covers than its new capacity", "lists the bookings a closure takes out, with the closure that does it" (Task 11); `admin-closures.spec.ts` (Task 13); `booking-acceptance.spec.ts` "A2…" và "A6…" (Task 14; bỏ ngày đóng cửa khỏi loader, hoặc bỏ loại `outside_hours`, thì đỏ). Reviewer: `findAffected` dùng `closureApplies` của engine (một chỗ cài đặt); action ngày đóng cửa gắn tag `restaurantsInScope(cũ) ∪ restaurantsInScope(mới)`.

## Rủi ro đã biết

Mỗi mục mang một nhãn: **Đã chấp nhận** (hệ quả của một phán quyết, hoặc đã có biện pháp) hoặc **Cần quyết định** (người dùng chọn chấp nhận hay mở việc ở đợt sau). Kế hoạch không thêm task cho các mục này; Task 14 bước cuối báo lại danh sách.

1. **Cần quyết định (trước khi 006 lên Neon).** pg_trgm trên Neon PG18 chưa kiểm (nghiên cứu đánh giá "likely"; agent không được chạm Neon). Nếu `CREATE EXTENSION` lỗi, cả 006 rollback. Truy vấn chỉ đọc nên chạy trước: `SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name = 'pg_trgm'`; `SELECT count(*) FROM reservations WHERE reserved_at !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`; `SELECT count(*), min(created_at), max(created_at) FROM reservations`; `SELECT key, locale, value FROM content_strings WHERE key IN ('error.party_too_large', 'error.past')` (một bản ghi đè cũ sẽ làm mất `{max}`/`{phone}` hay chữ mới).
2. **Cần quyết định.** `pg_advisory_xact_lock` và `lock_timeout` qua URL pooled (transaction mode) của Neon chưa kiểm. Spec §13 đòi một lần kiểm trên branch Neon (bước của người dùng). Dự phòng (spec §16): `SELECT … FOR UPDATE` trên một hàng khóa theo (nhà hàng, ngày).
3. **Cần quyết định.** Phán quyết 7 của đợt 2 thành với tới được: sau `updateTag('restaurants')`, một request của khách lúc DB sập nhận 500 thô thay vì `error.tsx`. Xác suất thấp (một lần lưu admin cần DB sống ngay trước đó). Xem lại cùng đợt 10.
4. **Cần quyết định (kiểm ở preview đầu tiên).** `updateTag('restaurants')` có tới mọi instance Vercel đang giữ catalogue `'use cache'` không ("local by default"). Khách trên instance khác có thể thấy trạng thái RESERVE/`meals` cũ. Availability không cache, và action kiểm lại.
5. **Đã chấp nhận (R1).** 006 và code đợt 4 đi cùng nhau. Một tab mở từ trước đợt 4 sẽ vỡ khi API đổi dạng (spike khách đã thấy); site chưa từng deploy nên không có tab nào như vậy.
6. **Đã chấp nhận.** Pool 5 kết nối với `lock_timeout` 5 s: một loạt đặt dồn vào một nhà hàng-ngày phải xếp hàng; transaction đang chờ giữ chỗ trong pool nên request khác trên instance đó cũng chờ. Hết giờ chờ, khách thấy `error.network`.
7. **Đã chấp nhận.** Hai request availability mỗi lần mở trang và mỗi lần đổi nhà hàng (R4).
8. **Cần quyết định (sản phẩm).** Thẻ không có trang riêng của nhà hàng đã tắt đặt bàn online thành không bấm được. Nếu mọi nhà hàng đều tắt, nút RESERVE chung mở một drawer rỗng. Một hành động "Gọi để đặt bàn" có thể thay cả hai.
9. **Cần quyết định (nhà hàng).** Ngày phục vụ kết thúc lúc 04:00 (R9). Nhân viên không đặt được trong một ca đã đóng (R8). Hủy hàng loạt chạy từng đặt bàn, không tất cả hoặc không gì (R10).
10. **Đã chấp nhận.** Dữ liệu cũ `is_test` vẫn giữ chỗ cho tới khi xóa; giao diện xóa (`reservations:purge-test`) là việc "xóa dữ liệu test" của đợt 10.
11. **Đã chấp nhận.** FK `reservations.locale` là NO ACTION: ngôn ngữ đã có đặt bàn chỉ tắt được, không xóa được (đợt 8). `offer_id` là `bigint`, nên `offers.id` của đợt 6 phải cùng kiểu để thêm FK.
12. **Đã chấp nhận.** Nhà hàng tạo sau (đợt 6) chưa có ca nên đóng cửa mọi ngày; luồng tạo của đợt 6 nên seed ca mặc định. Ca không vượt qua nửa đêm.
13. **Đã chấp nhận.** Dữ liệu cá nhân: `search_text` và `changes` của sự kiện `edited` chứa tên, số điện thoại, email. Trình ẩn danh của đợt 10 đặt `anonymized_at` (trigger khi đó xóa `search_text`) và gỡ khóa cá nhân khỏi `changes`.
14. **Đã chấp nhận.** Index trigram được dùng từ khoảng 200k dòng (5,8 ms); dưới đó planner chọn seq scan (4 ms). Không có tìm gần đúng. Keyset của `/admin/audit` dựa vào Merge Append của planner (0,05 ms ở 200k), không có index tổ hợp.
15. **Đã chấp nhận.** `guest_ack_email` và `pii_retention_months` sửa được nhưng chỉ có tác dụng từ đợt 5 và 10; `auto_confirm` có tác dụng ngay.
16. **Cần quyết định (theo dõi).** Tải E2E: Phần B thêm 25 test (E2E từ 76 lên 101). Rủi ro #15 của đợt 3 (spec khách `page-scope.spec.ts:71` "a card opens the restaurant page under the curtain") gặp lại một lần trong 13 lần chạy E2E toàn bộ của Phần B (lần `TZ=UTC` đầu của Task 14, load average khoảng 5–6); chạy lại: `101 passed`. CI có `retries: 1`. Project `desktop-serial` đã kiểm ở Task 11; một test đỏ trong `desktop` làm nó "did not run", nên một lần đỏ của `page-scope` cũng che kết quả của spec công tắc.
17. **Đã chấp nhận.** `restaurants.slot_capacity`, `restaurants.meals` và `SLOTS` ở lại tới đợt 10. Sau Task 6 chỉ test seed đọc chúng; `meals` của catalogue lấy từ ca.
18. **Đã chấp nhận.** Giờ hiện trên trình sửa ca theo locale của trình duyệt (Chrome en-US hiện AM/PM). Chỉ là thẩm mỹ.
19. **Đã chấp nhận.** Chữ tiếng Anh viết cứng trong giao diện đặt bàn ("Today", "Tomorrow", "Full", "N left", nhãn aria) chuyển vào registry ở đợt 7; đợt 4 chỉ thêm chữ mới.
20. **Đã chấp nhận (Task 1).** `fold_search()` gập Latin-1, Latin Extended-A, ơ/ư và khối tiếng Việt cả hai dạng chữ; chữ khác (Kirin, CJK…) chỉ qua `lower()`, mà dưới collation `C` thì không đổi. Tìm theo tên chữ khác vẫn khớp nếu gõ đúng hoa thường. Xem lại ở đợt 8.
21. **Đã chấp nhận (Task 10).** Nhân viên chọn ngôn ngữ của khách trong mọi `locales`, kể cả ngôn ngữ đang tắt trên web (`vi` lúc này). Từ đợt 5, email cho khách theo `reservations.locale`; đợt 5 hoặc 8 quyết có cho gửi email bằng ngôn ngữ chưa bật hay không.
22. **Đã chấp nhận (Task 14).** Test A1 giữ `LOCK TABLE reservations IN SHARE MODE` tối đa khoảng 4 giây trong lúc cả bộ E2E chạy: INSERT của spec khác phải đợi ngần ấy (dưới `lock_timeout` 5 s của khóa ngày đặt bàn). Ngưỡng "5 người chờ" của nó bằng `max` của pool (`db/client.ts`); đổi pool thì đổi ngưỡng. File nghiệm thu không chạy được với `--repeat-each` (các lần lặp chạy song song trên cùng quy tắc của Yum Food Village).
23. **Đã chấp nhận (Task 11).** Câu báo xung đột cấu hình nêu `staff_user.name` của `updated_by`; tài khoản đã xóa hiện "người khác".

---

## Sơ đồ file

Cả hai phần đã chạy kiểm chứng; mỗi dòng là file thật của commit trong "Bản kiểm chứng". Chỗ Phần B khác dàn ý (vị trí `FormMessage`, `AffectedList`, task của `form.ts`) có lý do ở "Ghi chú triển khai (Phần B)".

| File | Trách nhiệm | Task |
|---|---|---|
| `db/migrations/006_booking_v2.sql`, `test/integration/migration-006.test.ts` | Bảng, cột, hàm, trigger, index, view `audit_feed` của đợt 4 | 1 |
| `test/helpers/db.ts` | `TEST_DB_TAG` đổi tên DB của test migrate | 1 |
| `test/integration/migration-005.test.ts`, `audit-feed.test.ts` | 005 chạy riêng; feed gộp sự kiện đặt bàn | 1, 7 |
| `db/queries.ts` | Cầu nối INSERT đợt 1 (Task 1, xóa ở Task 4); catalogue: `bookingEnabled`, `meals` từ ca (Task 5) | 1, 4, 5 |
| `lib/venue-time.ts` (+ test) | `isoWeekday`, `fromMinutes` | 2 |
| `lib/booking/rules.ts` | Kiểu quy tắc, `HOLDING_STATUSES`, `RESERVATION_STATUSES`, `GroupPhone` (dùng cả hai phía) | 2, 3 |
| `lib/booking/resolve-day.ts` (+ test) | `seatings`, `closureApplies`, `planDay`, `clockBlock`, `resolveDay`, `findSlot`, `resolveRange` | 2 |
| `test/integration/booking-seed.test.ts` | Seed = hành vi đợt 1, hơn 5000 phán quyết slot | 2 |
| `lib/server/booking/rules.ts`, `lib/server/booking/lock.ts`, `test/integration/booking-rules.test.ts` | Loader quy tắc sống, số chỗ đã giữ; khóa ngày đặt bàn duy nhất | 3 |
| `lib/booking/slot-code.ts` (+ test) | Ngày + giờ → mã lỗi của khách | 4 |
| `lib/server/booking/input.ts` (+ test), `lib/server/booking/create.ts`, `app/actions.ts` | `submitReservation` v2: zod, E.164, một transaction có khóa | 4 |
| `lib/booking-errors.ts`, `lib/i18n/registry.ts` (+ test) | Mã `closed`; `{max}`, `{phone}`; `error.past` mới; key `booking.*`, `ClientKey` | 4, 6 |
| `test/integration/submit-reservation.test.ts` | Đặt bàn của khách: ngày, mã, khóa, đua, trùng, mã tham chiếu | 4 |
| `lib/server/check-reservation.ts` (+ test), `test/integration/reservations.test.ts` | Xóa (ca của chúng được chuyển sang) | 4 |
| `lib/booking/api.ts`, `app/api/availability/route.ts`, `test/integration/availability.test.ts` | Hợp đồng và route availability v2 | 5, 6 |
| `lib/data.ts`, `test/integration/catalogue.test.ts` | `Restaurant.bookingEnabled`; bỏ `slotCapacity` | 5 |
| `scripts/check-prerender.mjs` | Luật 1c: `/api/availability` không bao giờ prerender | 5 |
| `lib/booking/client.ts` (+ test) | Quy tắc của form khách trên câu trả lời của server | 6 |
| `components/site/SiteProvider.tsx`, `components/overlays/ReserveDrawer.tsx`, `components/booking/BookingBar.tsx`, `components/ui/Dropdown.tsx`, `styles/overlays.css` | Form khách v2: lịch, bảng giờ, ngày xám, giới hạn số khách | 6 |
| `lib/booking.ts` (+ test) | Chỉ còn kiểu form và helper hiển thị; bỏ helper availability đợt 1 | 6 |
| `e2e/availability-mock.ts`, `e2e/booking-v2.spec.ts`, `e2e/booking-dates.spec.ts`, `e2e/visual.spec.ts` | Mock v2; E2E form khách | 4, 6 |
| `lib/server/action-result.ts` (+ test), `lib/server/client-ip.ts` (+ test), `lib/server/dal/session.ts`, `app/admin/(auth)/accept-invite/actions.ts` | `unstable_rethrow`, `params`, mã mới; `clientIp()` | 7 |
| `lib/admin/auth-errors.ts` (+ test), `lib/admin/audit-labels.ts` (+ test) | Câu báo `{by}`/`{at}`/`{left}`; nhãn `reservation.*` và thực thể cấu hình | 7, 11 |
| `lib/server/audit-feed.ts`, `app/admin/(shell)/audit/page.tsx`, `test/integration/audit-feed.test.ts`, `e2e/admin-audit.spec.ts` | Nhật ký keyset (`?truoc=`/`?sau=`), nhãn thực thể, liên kết tới đặt bàn | 7, 9 |
| `lib/reservations/lifecycle.ts` (+ test) | Bảng chuyển trạng thái, cửa sổ, `serviceDay`, nhãn | 8 |
| `lib/server/booking/reservations.ts`, `test/integration/reservation-lifecycle.test.ts` | Chuyển, tạo, sửa, ghi chú của nhân viên; hook `ReservationEffects` | 8 |
| `lib/booking/resolve-day.ts` (+ test), `lib/server/booking/rules.ts`, `test/integration/booking-rules.test.ts` | `findPlannedSlot`; `loadBookedCovers(…, excludeId)` | 8 |
| `lib/server/booking/queries.ts`, `test/integration/reservation-inbox.test.ts` | Hộp thư, chi tiết, dòng thời gian, ghi chú, tổng quan (9); bảng theo ngày, danh sách nhà hàng và ngôn ngữ (10) | 9, 10 |
| `lib/reservations/search.ts` (+ test) | Đọc ô tìm kiếm: mã, số điện thoại, chữ | 9 |
| `lib/admin/booking-schemas.ts` (+ test) | zod của mọi action đặt bàn, thêm dần theo màn | 9–13 |
| `lib/admin/form.ts`, `app/admin/(shell)/_ui/FormMessage.tsx` | Gửi form không xóa giá trị; câu báo chung và theo ô | 9 |
| `lib/admin/{format,nav}.ts` (+ test), `app/admin/(shell)/page.tsx` | `formatIsoDayVi`; mục menu Đặt bàn (9), Nhà hàng (11), Cài đặt đặt bàn (12); số đếm ở Tổng quan | 9, 11, 12 |
| `app/admin/(shell)/reservations/{page,QuickConfirm,actions}.tsx`, `reservations/_ui/{SectionNav,StatusBadge}.tsx`, `reservations/[id]/{page,TransitionPanel,EditReservationForm,NoteForm}.tsx` | Hộp thư và chi tiết; action `changeStatus`, `updateReservation`, `addNote` (9), `createReservation` (10), `cancelReservations` (11) | 9–11 |
| `app/admin/(shell)/reservations/new/{page,NewReservationForm}.tsx`, `reservations/day/{page,PrintButton}.tsx` | Tạo đặt bàn, bảng theo ngày (bản in) | 10 |
| `lib/server/booking/config.ts` | Đọc cho màn sửa; lưu ca và quy tắc (11), cài đặt và tự xác nhận (12), ngày đóng cửa (13) | 11–13 |
| `lib/server/booking/affected.ts`, `test/integration/booking-config.test.ts` | Đặt bàn bị ảnh hưởng: chế độ quy tắc (11), chế độ ngày đóng cửa (13); test cấu hình | 11–13 |
| `app/admin/(shell)/_ui/AffectedList.tsx` | Danh sách bị ảnh hưởng, hủy hàng loạt | 11 |
| `app/admin/(shell)/restaurants/page.tsx`, `restaurants/[id]/booking/{page,RulesForm,PeriodsEditor,actions}.tsx` | "Giờ và sức chứa" | 11 |
| `components/detail/TayaHero.tsx`, `components/site/{MobileBar,SiteProvider}.tsx`, `components/home/{Offers,RestaurantCard}.tsx`, `components/overlays/SearchOverlay.tsx` | Ẩn RESERVE khi tắt đặt bàn (R14) | 11 |
| `lib/booking/rules.ts` | `SLOT_INTERVALS` | 11 |
| `playwright.config.ts`, `e2e/booking-switch.serial.spec.ts` | Project `desktop-serial`; spec công tắc | 11 |
| `e2e/reservation-fixtures.ts`, `e2e/admin-reservations.spec.ts` | Đặt bàn mẫu cho E2E; hộp thư, chi tiết, tạo mới, bảng theo ngày | 9, 10 |
| `e2e/admin-booking-config.spec.ts` | Giờ và sức chứa, ghi đè số khách, danh sách bị ảnh hưởng | 11 |
| `app/admin/(shell)/settings/booking/{page,SettingsForm,actions}.tsx`, `restaurants/[id]/booking/{AutoConfirmForm,auto-confirm-actions}.tsx`, `e2e/admin-booking-settings.spec.ts` | "Cài đặt đặt bàn" và tự xác nhận theo nhà hàng (chỉ Admin) | 12 |
| `app/admin/(shell)/reservations/closures/{page,ClosureForm,actions}.tsx`, `e2e/admin-closures.spec.ts` | Ngày đóng cửa | 13 |
| `styles/admin.css` | CSS của các màn đặt bàn, thêm theo màn | 9–11, 13 |
| `test/guards/require-permission.guard.test.ts`, `test/guards/server-actions.ts` | Bảng `BOOKING_ACTIONS`; `ADMIN_ONLY_ACTIONS` thêm hai file (12) | 9–13 |
| `e2e/admin-acceptance.spec.ts`, `e2e/admin-users.spec.ts` | Menu của Editor thêm Đặt bàn (9), Nhà hàng (11) | 9, 11 |
| `e2e/booking-acceptance.spec.ts`, `README.md` | Nghiệm thu §14.1 dòng 4; tài liệu vận hành | 14 |

---

## PHẦN A: dữ liệu, engine, API và form khách

### Task 1: Migration 006 và cầu nối cho INSERT của đợt 1

Mọi thứ của đợt 4 đứng trên migration này, nên nó đến trước và đến một mình. Code đợt 1 vẫn chạy trên DB đã migrate nhờ một cầu nối nhỏ trong `db/queries.ts`, Task 4 xóa nó.

**Files:**
- Create: `db/migrations/006_booking_v2.sql`, `test/integration/migration-006.test.ts`
- Modify: `test/helpers/db.ts`, `db/queries.ts`, `test/integration/migration-005.test.ts`, `test/integration/audit-feed.test.ts`, `test/integration/availability.test.ts`

**Interfaces:**
- Consumes: `resetDatabase(url, until?)`, `migrate(url)`, `withClient(url, fn)`, `databaseUrl(name)`, `TEST_DATABASE_URL` từ `test/helpers/db.ts`; `fold(x: string): string` từ `lib/booking.ts`; `listAuditFeed(pool, page)` từ `lib/server/audit-feed.ts` (đợt 3).
- Produces:
  - Mọi bảng, cột, CHECK, index và view ở mục "Tên trong migration" của Global Constraints.
  - Hàm SQL `fold_search(value text) → text` và `reservation_search_text(guest_name, email, phone, phone_e164, reference) → text` (IMMUTABLE); trigger `reservations_before_write` đặt `search_text` ở mọi INSERT/UPDATE và `version = OLD.version + 1`, `updated_at = now()` ở mọi UPDATE.
  - `databaseUrl(name)`: với `TEST_DB_TAG=x` (chỉ `[a-z0-9]+`), `furama_cuisine_migrate006_test` thành `furama_cuisine_migrate006_x_test`.
  - Từ Task 1, mọi INSERT vào `reservations` phải nêu `meal` và `source` (không có default).

- [ ] **Bước 1: Cho helper của test một tag tên DB**

Hai bản checkout chạy test migrate trên cùng một Postgres sẽ giẫm lên nhau ở `furama_cuisine_migrate*_test`. `TEST_DB_TAG` đổi tên các DB đó. Sửa `test/helpers/db.ts` đúng như diff sau:

```diff
diff --git a/test/helpers/db.ts b/test/helpers/db.ts
index 4619a02..c99f3fe 100644
--- a/test/helpers/db.ts
+++ b/test/helpers/db.ts
@@ -3,10 +3,15 @@ import pg from 'pg';
 
 export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
 
-/** The integration server's URL, pointed at another database name. */
+/**
+ * The integration server's URL, pointed at another database name.
+ * TEST_DB_TAG=x renames furama_cuisine_migrate_test to furama_cuisine_migrate_x_test,
+ * so two checkouts can run the suite on one Postgres at the same time.
+ */
 export function databaseUrl(name: string): string {
   const url = new URL(TEST_DATABASE_URL ?? 'postgres://localhost:5432/postgres');
-  url.pathname = `/${name}`;
+  const tag = process.env.TEST_DB_TAG;
+  url.pathname = `/${tag && /^[a-z0-9]+$/.test(tag) ? name.replace(/_test$/, `_${tag}_test`) : name}`;
   return url.toString();
 }
 
```

- [ ] **Bước 2: Viết test cho migration 006**

Test dùng DB riêng `furama_cuisine_migrate006_test`. Phần đầu dựng một DB ở trạng thái 005 có ba đặt bàn đợt 1 rồi migrate; phần sau kiểm từng ràng buộc theo tên, trigger, và `fold_search` so với `fold()` của JS, kể cả dưới collation `C`.

Create `test/integration/migration-006.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { fold } from '@/lib/booking';
import { TEST_DATABASE_URL, databaseUrl, migrate, resetDatabase, withClient } from '../helpers/db';

const url = databaseUrl('furama_cuisine_migrate006_test');
const sql = (text: string, values: unknown[] = []) => withClient(url, (c) => c.query(text, values));
const one = async (text: string, values: unknown[] = []) => (await sql(text, values)).rows[0];

/** A phase-1 booking, written the way the phase-1 action wrote it (no v2 columns). */
const legacy = (reference: string, restaurant: string, at: string, status: string, phone = '0905 000 000', e164 = '+84905000000') =>
  sql(
    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164, email, status)
     VALUES ($1, $2, '2026-10-05', $3, 2, 'Nguyễn Văn An', $4, $5, 'An@Example.com', $6)`,
    [reference, restaurant, at, phone, e164, status],
  );

/** A v2 booking with only the columns that have no default. */
const v2 = (over: Record<string, unknown> = {}) => {
  const row = {
    reference: `FC-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    restaurant_id: 'taya-house',
    reserved_on: '2026-10-06',
    reserved_at: '19:00',
    meal: 'Dinner',
    guests: 2,
    guest_name: 'Guest',
    phone: '0905 111 111',
    phone_e164: '+84905111111',
    source: 'web',
    ...over,
  };
  const cols = Object.keys(row);
  return sql(
    `INSERT INTO reservations (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id, version`,
    Object.values(row),
  );
};

/** Latin-1, Latin Extended-A, ơ/ư and the Vietnamese block: the letters fold_search translates. */
const BLOCKS: [number, number][] = [[0xc0, 0x17f], [0x1a0, 0x1b0], [0x1ea0, 0x1ef9]];

/** Names a guest might type: Vietnamese, upper case, and other Latin accents. */
const NAMES = ['Nguyễn Thị Ánh ĐỨC', 'Trần Văn Ơn', 'Lê Đức Ưng', 'PHẠM THỊ HỒNG NHUNG', 'José Muñoz', 'Zoë Brontë', 'Łukasz Dvořák', 'plain ascii 42'];

describe.skipIf(!TEST_DATABASE_URL)('migration 006: booking v2 (database)', () => {
  describe('on a database that already has phase-1 bookings', () => {
    beforeAll(async () => {
      resetDatabase(url, '005_staff_auth_audit.sql');
      await legacy('FC-12345', 'taya-house', '19:00', 'confirmed');
      await legacy('FC-AAAAAAAA', 'cafe-indochine', '07:00', 'cancelled', '0905 000 001', '+84905000001');
      await legacy('FC-BBBBBBBB', 'hai-van-lounge', '18:00', 'requested', '+1 415 555 0100', '+14155550100');
      migrate(url);
    });

    it('keeps every row, its status and reference, and marks it legacy test data', async () => {
      const { rows } = await sql(
        `SELECT reference, status, meal, source, locale, is_test, version, updated_at = created_at AS same_time
           FROM reservations ORDER BY id`,
      );
      expect(rows).toEqual([
        { reference: 'FC-12345', status: 'confirmed', meal: 'Dinner', source: 'legacy', locale: 'en', is_test: true, version: 1, same_time: true },
        { reference: 'FC-AAAAAAAA', status: 'cancelled', meal: 'Breakfast', source: 'legacy', locale: 'en', is_test: true, version: 1, same_time: true },
        { reference: 'FC-BBBBBBBB', status: 'requested', meal: 'Drinks', source: 'legacy', locale: 'en', is_test: true, version: 1, same_time: true },
      ]);
    });

    it('writes search_text and one system created event for each old row', async () => {
      const { rows: text } = await sql(`SELECT reference, search_text FROM reservations ORDER BY id`);
      expect(text).toEqual([
        { reference: 'FC-12345', search_text: 'nguyen van an an@example.com fc-12345 84905000000 0905000000' },
        { reference: 'FC-AAAAAAAA', search_text: 'nguyen van an an@example.com fc-aaaaaaaa 84905000001 0905000001' },
        { reference: 'FC-BBBBBBBB', search_text: 'nguyen van an an@example.com fc-bbbbbbbb 14155550100' },
      ]);
      const { rows } = await sql(
        `SELECT r.reference, e.actor_kind, e.actor_label, e.type, e.to_status
           FROM reservation_events e JOIN reservations r ON r.id = e.reservation_id ORDER BY r.id`,
      );
      expect(rows).toEqual([
        { reference: 'FC-12345', actor_kind: 'system', actor_label: 'migration 006', type: 'created', to_status: 'confirmed' },
        { reference: 'FC-AAAAAAAA', actor_kind: 'system', actor_label: 'migration 006', type: 'created', to_status: 'cancelled' },
        { reference: 'FC-BBBBBBBB', actor_kind: 'system', actor_label: 'migration 006', type: 'created', to_status: 'requested' },
      ]);
    });

    it('seeds one period per restaurant meal from SLOTS, at slot_capacity covers', async () => {
      const { rows } = await sql(
        `SELECT meal, to_char(first_seating, 'HH24:MI') AS first, to_char(last_seating, 'HH24:MI') AS last,
                interval_min, covers_per_slot, weekdays, sort_order
           FROM service_periods WHERE restaurant_id = 'cafe-indochine' ORDER BY sort_order`,
      );
      expect(rows).toEqual([
        { meal: 'Breakfast', first: '06:30', last: '09:30', interval_min: 30, covers_per_slot: 40, weekdays: [1, 2, 3, 4, 5, 6, 7], sort_order: 10 },
        { meal: 'Lunch', first: '11:30', last: '13:30', interval_min: 30, covers_per_slot: 40, weekdays: [1, 2, 3, 4, 5, 6, 7], sort_order: 20 },
        { meal: 'Dinner', first: '18:00', last: '21:00', interval_min: 30, covers_per_slot: 40, weekdays: [1, 2, 3, 4, 5, 6, 7], sort_order: 40 },
      ]);
      const mismatched = await sql(
        `SELECT r.id FROM restaurants r
          WHERE r.meals::text[] IS DISTINCT FROM ARRAY(
                  SELECT p.meal FROM service_periods p WHERE p.restaurant_id = r.id
                   ORDER BY array_position(r.meals::text[], p.meal))`,
      );
      expect(mismatched.rows).toEqual([]);
      expect(await one(`SELECT count(*)::int AS periods, (SELECT sum(cardinality(meals))::int FROM restaurants) AS meals FROM service_periods`)).toEqual({
        periods: 25,
        meals: 25,
      });
    });

    it('creates the single booking_settings row with the spec defaults', async () => {
      expect(await one('SELECT window_days, lead_minutes, same_day_cutoff, max_party, auto_confirm, guest_ack_email, pii_retention_months FROM booking_settings')).toEqual({
        window_days: 14, lead_minutes: 30, same_day_cutoff: null, max_party: 12, auto_confirm: false, guest_ack_email: true, pii_retention_months: 24,
      });
      await expect(sql('INSERT INTO booking_settings (id) VALUES (false)')).rejects.toThrow(/booking_settings_single_row/);
      await expect(sql('INSERT INTO booking_settings (id) VALUES (true)')).rejects.toThrow(/booking_settings_pkey/);
    });

    it('turns booking on everywhere, with no overrides', async () => {
      expect(
        await one(`SELECT bool_and(booking_enabled) AS on, count(window_days) + count(lead_minutes) + count(max_party) + count(auto_confirm) AS overrides FROM restaurants`),
      ).toEqual({ on: true, overrides: '0' });
    });

    it('lists the old reservations in audit_feed with the same columns as before', async () => {
      const { rows } = await sql(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'audit_feed' ORDER BY ordinal_position`,
      );
      expect(rows.map((r) => r.column_name)).toEqual([
        'source', 'id', 'at', 'actor_id', 'actor_label', 'action', 'entity_type', 'entity_id', 'locale', 'before', 'after',
      ]);
      const feed = await sql(`SELECT action, entity_type, before, after FROM audit_feed WHERE source = 'reservation' ORDER BY id::bigint LIMIT 1`);
      expect(feed.rows).toEqual([
        { action: 'reservation.created', entity_type: 'reservation', before: null, after: { status: 'confirmed', reason: 'phase-1 booking' } },
      ]);
    });

    it('is safe to apply again', async () => {
      await sql(readFileSync('db/migrations/006_booking_v2.sql', 'utf8'));
      expect(await one(`SELECT (SELECT count(*)::int FROM service_periods) AS p, (SELECT count(*)::int FROM reservation_events) AS e,
                               (SELECT count(*)::int FROM booking_settings) AS s, (SELECT max(version) FROM reservations) AS v`)).toEqual({
        p: 25, e: 3, s: 1, v: 1,
      });
    });
  });

  describe('constraints, the trigger and search folding', () => {
    beforeAll(() => resetDatabase(url));

    it('accepts the six statuses only, and 1–50 guests', async () => {
      const statuses = ['requested', 'confirmed', 'seated', 'no_show', 'cancelled', 'declined'];
      for (const [i, status] of statuses.entries()) await v2({ status, phone_e164: `+8490511000${i}`, reserved_on: '2026-10-07' });
      expect((await one(`SELECT count(DISTINCT status)::int AS n FROM reservations`)).n).toBe(6);
      await expect(v2({ status: 'arrived' })).rejects.toThrow(/reservations_status_check/);
      await expect(v2({ guests: 51 })).rejects.toThrow(/reservations_guests_check/);
      await expect(v2({ guests: 0 })).rejects.toThrow(/reservations_guests_check/);
      await v2({ guests: 50, phone_e164: '+84905999999' });
    });

    it('requires HH:MM times, a known meal, a named source and a known locale', async () => {
      await expect(v2({ reserved_at: '7:00' })).rejects.toThrow(/reservations_reserved_at_check/);
      await expect(v2({ reserved_at: '24:00' })).rejects.toThrow(/reservations_reserved_at_check/);
      await expect(v2({ meal: 'Brunch' })).rejects.toThrow(/reservations_meal_check/);
      await expect(v2({ meal: null })).rejects.toThrow(/null value in column "meal"/);
      await expect(v2({ source: 'email' })).rejects.toThrow(/reservations_source_check/);
      await expect(v2({ locale: 'xx' })).rejects.toThrow(/reservations_locale_fkey/);
      // No default: an insert that forgets the source fails loudly.
      await expect(
        sql(`INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164)
             VALUES ('FC-NOSOURCE', 'taya-house', '2026-10-06', '19:00', 'Dinner', 2, 'G', '0905 111 112', '+84905111112')`),
      ).rejects.toThrow(/null value in column "source"/);
    });

    it('bumps version once per update and touches updated_at, whatever the SQL sets', async () => {
      const { rows } = await v2({ phone_e164: '+84905333333' });
      expect(rows[0].version).toBe(1);
      await sql(`UPDATE reservations SET status = 'confirmed' WHERE id = $1`, [rows[0].id]);
      // A write that tries to set version or search_text itself is overruled.
      await sql(`UPDATE reservations SET guests = 3, version = 99, search_text = 'x' WHERE id = $1`, [rows[0].id]);
      expect(await one(`SELECT version, updated_at > created_at AS touched, search_text FROM reservations WHERE id = $1`, [rows[0].id])).toMatchObject({
        version: 3,
        touched: true,
        search_text: expect.stringMatching(/^guest /),
      });
    });

    it('keeps search_text on insert and update, and drops it once the row is anonymised', async () => {
      const { rows } = await v2({ guest_name: 'Nguyễn Thị Ánh', email: 'Anh@Example.com', phone: '0905 444 555', phone_e164: '+84905444555', reference: 'FC-SEARCH01' });
      const text = async () => (await one(`SELECT search_text FROM reservations WHERE id = $1`, [rows[0].id])).search_text;
      expect(await text()).toBe('nguyen thi anh anh@example.com fc-search01 84905444555 0905444555');
      await sql(`UPDATE reservations SET guest_name = 'Lê Đức' WHERE id = $1`, [rows[0].id]);
      expect(await text()).toMatch(/^le duc /);
      await sql(`UPDATE reservations SET anonymized_at = now() WHERE id = $1`, [rows[0].id]);
      expect(await text()).toBeNull();
    });

    it('folds in SQL exactly as fold() does in the browser, whatever the collation', async () => {
      const { rows } = await sql(`SELECT fold_search(n) AS f FROM unnest($1::text[]) AS n`, [NAMES]);
      expect(rows.map((r) => r.f)).toEqual(NAMES.map(fold));
      expect(fold('Nguyễn Thị Ánh ĐỨC')).toBe('nguyen thi anh duc');
      // Every letter the browser folds to a plain a–z folds the same in SQL, even under
      // the C collation, where lower() leaves non-ASCII letters alone.
      const letters = BLOCKS.flatMap(([from, to]) => Array.from({ length: to - from + 1 }, (_, i) => String.fromCodePoint(from + i))).filter(
        (ch) => fold(ch) !== ch && /^[a-z]$/.test(fold(ch)),
      );
      expect(letters).toHaveLength(257);
      const sqlFold = (await one(`SELECT fold_search($1 COLLATE "C") AS f`, [letters.join('')])).f;
      expect(sqlFold).toBe(letters.map(fold).join(''));
    });

    it('still rejects a second active request for the same table and number', async () => {
      await v2({ reserved_on: '2026-10-08', phone_e164: '+84905444444' });
      await expect(v2({ reserved_on: '2026-10-08', phone_e164: '+84905444444' })).rejects.toThrow(/reservations_dedupe_v2_idx/);
    });

    it('checks service periods: weekdays 1–7, last ≥ first, on the interval grid', async () => {
      const period = (over: Record<string, unknown>) => {
        const row = { restaurant_id: 'taya-house', meal: 'Dinner', first_seating: '18:00', last_seating: '21:00', interval_min: 30, covers_per_slot: 10, ...over };
        const cols = Object.keys(row);
        return sql(`INSERT INTO service_periods (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(row));
      };
      await period({ weekdays: [6, 7] });
      await expect(period({ weekdays: [0] })).rejects.toThrow(/service_periods_weekdays_check/);
      await expect(period({ weekdays: [] })).rejects.toThrow(/service_periods_weekdays_check/);
      await expect(period({ last_seating: '17:30' })).rejects.toThrow(/service_periods_order/);
      await expect(period({ last_seating: '20:45' })).rejects.toThrow(/service_periods_grid/);
      await expect(period({ first_seating: '18:00:30' })).rejects.toThrow(/service_periods_grid/);
      // 150 minutes is a multiple of 25, so only the interval CHECK can fail.
      await expect(period({ interval_min: 25, last_seating: '20:30' })).rejects.toThrow(/service_periods_interval_min_check/);
      await expect(period({ meal: 'Supper' })).rejects.toThrow(/service_periods_meal_check/);
      await expect(period({ covers_per_slot: 1001 })).rejects.toThrow(/service_periods_covers_per_slot_check/);
    });

    it('checks closures: scope matches its target, dates in order, meals known, reasons short', async () => {
      const closure = (over: Record<string, unknown>) => {
        const row = { scope: 'all', starts_on: '2026-12-24', ends_on: '2026-12-25', ...over };
        const cols = Object.keys(row);
        return sql(`INSERT INTO closures (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id, show_reason`, Object.values(row));
      };
      const { rows } = await closure({});
      expect(rows[0].show_reason).toBe(true);
      await closure({ scope: 'destination', destination_id: 'resort', meals: ['Dinner'] });
      await closure({ scope: 'restaurant', restaurant_id: 'taya-house' });
      await expect(closure({ scope: 'all', restaurant_id: 'taya-house' })).rejects.toThrow(/closures_scope_target/);
      await expect(closure({ scope: 'restaurant' })).rejects.toThrow(/closures_scope_target/);
      await expect(closure({ scope: 'destination', destination_id: 'resort', restaurant_id: 'taya-house' })).rejects.toThrow(/closures_scope_target/);
      await expect(closure({ starts_on: '2026-12-26' })).rejects.toThrow(/closures_dates/);
      await expect(closure({ meals: [] })).rejects.toThrow(/closures_meals_check/);
      await expect(closure({ meals: ['Tea'] })).rejects.toThrow(/closures_meals_check/);
      await expect(closure({ internal_note: 'x'.repeat(2001) })).rejects.toThrow(/closures_internal_note_check/);
      const reason = (locale: string, text: string) =>
        sql(`INSERT INTO closure_i18n (closure_id, locale, public_reason) VALUES ($1, $2, $3)`, [rows[0].id, locale, text]);
      await expect(reason('en', '')).rejects.toThrow(/closure_i18n_public_reason_check/);
      await expect(reason('en', 'x'.repeat(161))).rejects.toThrow(/closure_i18n_public_reason_check/);
      await reason('en', 'Christmas');
      await expect(reason('xx', 'Noël')).rejects.toThrow(/closure_i18n_locale_fkey/);
      await sql('DELETE FROM closures WHERE id = $1', [rows[0].id]);
      expect((await one('SELECT count(*)::int AS n FROM closure_i18n')).n).toBe(0);
    });

    it('checks events and notes: staff need an id, a status change needs two different ends', async () => {
      const { rows } = await v2({ phone_e164: '+84905555555' });
      const event = (over: Record<string, unknown>) => {
        const row = { reservation_id: rows[0].id, actor_kind: 'staff', actor_id: 'u1', type: 'status_changed', from_status: 'requested', to_status: 'confirmed', ...over };
        const cols = Object.keys(row);
        return sql(`INSERT INTO reservation_events (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(row));
      };
      await event({});
      await expect(event({ actor_id: null })).rejects.toThrow(/reservation_events_staff_actor/);
      await expect(event({ from_status: null })).rejects.toThrow(/reservation_events_transition/);
      await expect(event({ to_status: 'requested' })).rejects.toThrow(/reservation_events_transition/);
      await expect(event({ type: 'created', from_status: null, to_status: null })).rejects.toThrow(/reservation_events_created_status/);
      await expect(event({ type: 'email_sent' })).rejects.toThrow(/reservation_events_type_check/);
      await expect(event({ reason: 'x'.repeat(501) })).rejects.toThrow(/reservation_events_reason_check/);
      const note = (body: string) =>
        sql(`INSERT INTO reservation_notes (reservation_id, author_id, author_label, body) VALUES ($1, 'u1', 'A', $2)`, [rows[0].id, body]);
      await expect(note('  ')).rejects.toThrow(/reservation_notes_body_check/);
      await expect(note('x'.repeat(2001))).rejects.toThrow(/reservation_notes_body_check/);
      await note('Window table, please.');
    });

    it('has pg_trgm, the trigram index on search_text, and the load index on holding statuses', async () => {
      expect((await one(`SELECT extversion FROM pg_extension WHERE extname = 'pg_trgm'`)).extversion).toMatch(/^1\./);
      expect((await one(`SELECT indexdef FROM pg_indexes WHERE indexname = 'reservations_search_trgm_idx'`)).indexdef).toContain('gin_trgm_ops');
      expect((await one(`SELECT indexdef FROM pg_indexes WHERE indexname = 'reservations_load_idx'`)).indexdef).toMatch(
        /INCLUDE \(guests\) WHERE \(status = ANY \(ARRAY\['requested'::text, 'confirmed'::text, 'seated'::text\]\)\)/,
      );
      expect((await sql(`SELECT 1 FROM pg_indexes WHERE indexname = 'reservations_slot_idx'`)).rowCount).toBe(0);
    });
  });

  it('stops, and changes nothing, when an old row has a malformed time', async () => {
    resetDatabase(url, '005_staff_auth_audit.sql');
    await legacy('FC-77777', 'taya-house', '7pm', 'requested');
    expect(() => migrate(url)).toThrow();
    expect((await sql(`SELECT 1 FROM information_schema.tables WHERE table_name = 'service_periods'`)).rowCount).toBe(0);
    expect((await one(`SELECT count(*)::int AS n FROM _migrations WHERE name = '006_booking_v2.sql'`)).n).toBe(0);
  });
});
```

- [ ] **Bước 3: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/migration-006.test.ts`
Expected: FAIL `Tests  18 failed (18)`, trong đó:

```
       × keeps every row, its status and reference, and marks it legacy test data 9ms
       × writes search_text and one system created event for each old row 6ms
       × seeds one period per restaurant meal from SLOTS, at slot_capacity covers 9ms
       …
     × stops, and changes nothing, when an old row has a malformed time 302ms
 FAIL  … > keeps every row, its status and reference, and marks it legacy test data
error: column "meal" does not exist
 FAIL  … > writes search_text and one system created event for each old row
error: column "search_text" does not exist
 FAIL  … > seeds one period per restaurant meal from SLOTS, at slot_capacity covers
error: relation "service_periods" does not exist
 FAIL  … > stops, and changes nothing, when an old row has a malformed time
AssertionError: expected [Function] to throw an error
```

- [ ] **Bước 4: Viết migration 006**

Thứ tự trong file có lý do: seed ca phục vụ trước khi backfill `meal` của dữ liệu cũ (bữa lấy từ ca seed phục vụ giờ đó); backfill `search_text` của dữ liệu cũ **trước** khi tạo trigger, nên các hàng đợt 1 giữ `version = 1` và `updated_at = created_at`; `source` thêm với default `'legacy'` (gắn nhãn hàng cũ không cần UPDATE) rồi bỏ default ngay. Mọi seed có `ON CONFLICT DO NOTHING` hoặc `NOT EXISTS`, nên chạy lại không ghi đè thay đổi của nhân viên.

Create `db/migrations/006_booking_v2.sql`:

```sql
-- Phase 4: booking v2 (spec §5.2 "Đặt bàn (đợt 4)", §7.4, §10).
--
-- Expand only: every existing column and row stays. Safe on a database that
-- already holds phase-1 bookings: they become source 'legacy' and is_test,
-- with their meal backfilled and a 'created' event from the system. Re-running
-- the file changes nothing apart from re-validating the named CHECKs.
-- notification_recipients and email_outbox belong to phase 5.
--
-- From here on this file owns the audit_feed view (re-running 005 would drop
-- its reservation branch), so test/integration/migration-005.test.ts stops at 005.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── booking_settings ──────────────────────────────────────────────────────
-- One row: the defaults every restaurant inherits (the restaurant columns
-- below override them when not NULL).
CREATE TABLE IF NOT EXISTS booking_settings (
  id                   boolean     PRIMARY KEY DEFAULT true CONSTRAINT booking_settings_single_row CHECK (id),
  window_days          smallint    NOT NULL DEFAULT 14 CHECK (window_days BETWEEN 1 AND 90),
  lead_minutes         smallint    NOT NULL DEFAULT 30 CHECK (lead_minutes BETWEEN 0 AND 1440),
  -- NULL: no cut-off. '17:00': from 17:00 Da Nang time, no online booking for the same day.
  same_day_cutoff      time        CHECK (extract(second FROM same_day_cutoff) = 0),
  max_party            smallint    NOT NULL DEFAULT 12 CHECK (max_party BETWEEN 1 AND 50),
  auto_confirm         boolean     NOT NULL DEFAULT false,
  guest_ack_email      boolean     NOT NULL DEFAULT true,   -- read from phase 5
  pii_retention_months smallint    NOT NULL DEFAULT 24 CHECK (pii_retention_months BETWEEN 1 AND 120),  -- read from phase 10
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text
);

INSERT INTO booking_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- ── restaurants: the booking switch and per-restaurant overrides ──────────
-- NULL = inherit booking_settings. same_day_cutoff is global only (spec §5.2).
-- updated_at/updated_by are also in the phase-6 column list; IF NOT EXISTS
-- keeps whichever migration runs second harmless.
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS booking_enabled boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS window_days     smallint    CHECK (window_days BETWEEN 1 AND 90),
  ADD COLUMN IF NOT EXISTS lead_minutes    smallint    CHECK (lead_minutes BETWEEN 0 AND 1440),
  ADD COLUMN IF NOT EXISTS max_party       smallint    CHECK (max_party BETWEEN 1 AND 50),
  ADD COLUMN IF NOT EXISTS auto_confirm    boolean,
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by      text;

-- ── service_periods ───────────────────────────────────────────────────────
-- The weekly template. Slots run first_seating, + interval_min, … last_seating.
-- A service may not cross midnight (last_seating >= first_seating).
CREATE TABLE IF NOT EXISTS service_periods (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurant_id   text        NOT NULL REFERENCES restaurants (id) ON UPDATE CASCADE ON DELETE CASCADE,
  meal            text        NOT NULL CHECK (meal IN ('Breakfast', 'Lunch', 'Dinner', 'Drinks')),
  -- ISO weekdays: 1 = Monday … 7 = Sunday.
  weekdays        smallint[]  NOT NULL DEFAULT '{1,2,3,4,5,6,7}'
                  CONSTRAINT service_periods_weekdays_check
                  CHECK (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]),
  first_seating   time        NOT NULL,
  last_seating    time        NOT NULL,
  interval_min    smallint    NOT NULL DEFAULT 30 CHECK (interval_min IN (15, 20, 30, 45, 60, 90, 120)),
  covers_per_slot integer     NOT NULL CHECK (covers_per_slot BETWEEN 0 AND 1000),
  active          boolean     NOT NULL DEFAULT true,
  sort_order      integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text,
  CONSTRAINT service_periods_order CHECK (last_seating >= first_seating),
  -- Whole minutes, and last_seating is itself a slot.
  CONSTRAINT service_periods_grid CHECK (
    extract(second FROM first_seating) = 0
    AND extract(second FROM last_seating) = 0
    AND (extract(epoch FROM last_seating - first_seating)::integer / 60) % interval_min = 0
  )
);

CREATE INDEX IF NOT EXISTS service_periods_restaurant_idx ON service_periods (restaurant_id, sort_order);

-- Seed: today's behaviour exactly, i.e. the global SLOTS of lib/data.ts for
-- each meal in restaurants.meals, every weekday, slot_capacity covers per slot
-- (test/integration/booking-seed.test.ts compares the two for every restaurant
-- and weekday). Skips a restaurant that already has periods.
INSERT INTO service_periods (restaurant_id, meal, first_seating, last_seating, interval_min, covers_per_slot, sort_order)
SELECT r.id, s.meal, s.first_seating, s.last_seating, s.interval_min, r.slot_capacity, s.sort_order
  FROM restaurants r
  CROSS JOIN LATERAL unnest(r.meals) AS m(meal)
  JOIN (VALUES ('Breakfast', time '06:30', time '09:30', 30, 10),
               ('Lunch',     time '11:30', time '13:30', 30, 20),
               ('Drinks',    time '17:00', time '22:00', 60, 30),
               ('Dinner',    time '18:00', time '21:00', 30, 40))
       AS s(meal, first_seating, last_seating, interval_min, sort_order)
    ON s.meal = m.meal
 WHERE NOT EXISTS (SELECT 1 FROM service_periods p WHERE p.restaurant_id = r.id);

-- ── closures → closure_i18n ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS closures (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope          text        NOT NULL CHECK (scope IN ('all', 'destination', 'restaurant')),
  destination_id text        REFERENCES destinations (id) ON UPDATE CASCADE ON DELETE CASCADE,
  restaurant_id  text        REFERENCES restaurants (id) ON UPDATE CASCADE ON DELETE CASCADE,
  -- Inclusive on both ends.
  starts_on      date        NOT NULL,
  ends_on        date        NOT NULL,
  -- NULL: the whole day. Otherwise only these services close.
  meals          text[]      CONSTRAINT closures_meals_check
                 CHECK (meals IS NULL OR (cardinality(meals) BETWEEN 1 AND 4
                        AND meals <@ ARRAY['Breakfast', 'Lunch', 'Dinner', 'Drinks'])),
  show_reason    boolean     NOT NULL DEFAULT true,
  internal_note  text        CHECK (length(internal_note) <= 2000),  -- never sent to guests
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text,
  CONSTRAINT closures_dates CHECK (starts_on <= ends_on),
  CONSTRAINT closures_scope_target CHECK (
    (scope = 'all'         AND destination_id IS NULL     AND restaurant_id IS NULL) OR
    (scope = 'destination' AND destination_id IS NOT NULL AND restaurant_id IS NULL) OR
    (scope = 'restaurant'  AND restaurant_id IS NOT NULL  AND destination_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS closures_dates_idx ON closures (ends_on, starts_on);

-- The guest-facing reason, per language; a row exists only when a reason was
-- typed. Same translation columns as content_strings (spec §5.1).
CREATE TABLE IF NOT EXISTS closure_i18n (
  closure_id    bigint      NOT NULL REFERENCES closures (id) ON DELETE CASCADE,
  locale        text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  public_reason text        NOT NULL CHECK (public_reason <> '' AND length(public_reason) <= 160),
  status        text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin        text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model      text,
  source_hash   text,
  reviewed_by   text,
  reviewed_at   timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,
  PRIMARY KEY (closure_id, locale)
);

-- ── search folding ────────────────────────────────────────────────────────
-- Lower case without accents, the SQL twin of fold() in lib/booking.ts
-- (test/integration/migration-006.test.ts pins the two together). Upper-case
-- letters are in the list too: lower() leaves non-ASCII letters alone under a
-- C collation, and the database's collation is not ours to choose.
CREATE OR REPLACE FUNCTION fold_search(value text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT
AS $$
  SELECT translate(lower(value),
    'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿ'
    || 'ĀāĂăĄąĆćĈĉĊċČčĎďĐđĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽž'
    || 'ƠơƯư'
    || 'ẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬửỮữỰựỲỳỴỵỶỷỸỹ',
    'aaaaaaceeeeiiiinooooouuuuyaaaaaaceeeeiiiinooooouuuuyy'
    || 'aaaaaaccccccccddddeeeeeeeeeegggggggghhiiiiiiiiijjkkllllllnnnnnnoooooorrrrrrssssssssttttuuuuuuuuuuuuwwyyyzzzzzz'
    || 'oouu'
    || 'aaaaaaaaaaaaaaaaaaaaaaaaeeeeeeeeeeeeeeeeiiiioooooooooooooooooooooooouuuuuuuuuuuuuuyyyyyyyy')
$$;

-- What the inbox search matches (spec §5.2 search_text): the folded name,
-- email, reference, the phone's digits and its Vietnamese national form, and
-- the typed phone's digits when they say something new.
CREATE OR REPLACE FUNCTION reservation_search_text(guest_name text, email text, phone text, phone_e164 text, reference text)
  RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT concat_ws(' ',
    fold_search(guest_name),
    lower(email),
    lower(reference),
    substr(phone_e164, 2),
    CASE WHEN phone_e164 LIKE '+84%' THEN '0' || substr(phone_e164, 4) END,
    NULLIF(NULLIF(NULLIF(regexp_replace(phone, '\D', '', 'g'), ''), substr(phone_e164, 2)),
           CASE WHEN phone_e164 LIKE '+84%' THEN '0' || substr(phone_e164, 4) END))
$$;

-- ── reservations: the v2 columns ──────────────────────────────────────────
-- reserved_at stays text; compare it in SQL as reserved_at::time. Check the old
-- rows before adding the CHECK, so a bad row stops the migration with a message.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM reservations WHERE reserved_at !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$';
  IF n > 0 THEN
    RAISE EXCEPTION '% booking(s) have a reserved_at that is not HH:MM; correct them, then migrate again', n;
  END IF;
END $$;

ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_reserved_at_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_reserved_at_check
  CHECK (reserved_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- The phase-1 statuses keep their names; three are new.
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_status_check
  CHECK (status IN ('requested', 'confirmed', 'seated', 'no_show', 'cancelled', 'declined'));

-- The real limit is max_party; this is only a sanity bound.
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_guests_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_guests_check CHECK (guests BETWEEN 1 AND 50);

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS meal          text,
  ADD COLUMN IF NOT EXISTS locale        text        NOT NULL DEFAULT 'en'
                                         REFERENCES locales (code) ON UPDATE CASCADE,
  -- Rows that exist now are phase-1 bookings: 'legacy'. The default is dropped
  -- just below, so every new row names its source.
  ADD COLUMN IF NOT EXISTS source        text        NOT NULL DEFAULT 'legacy'
                                         CHECK (source IN ('web', 'phone', 'walk_in', 'staff', 'legacy')),
  -- The FK to offers arrives with the offers table (phase 6).
  ADD COLUMN IF NOT EXISTS offer_id      bigint,
  -- Staff may book past capacity with a reason, which goes on the event (spec §10.3).
  ADD COLUMN IF NOT EXISTS over_capacity boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status_reason text        CHECK (length(status_reason) <= 500),
  ADD COLUMN IF NOT EXISTS confirmed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at  timestamptz,
  -- Kept by the reservations_before_write trigger; NULL once anonymised.
  ADD COLUMN IF NOT EXISTS search_text   text,
  ADD COLUMN IF NOT EXISTS is_test       boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz,
  -- Optimistic concurrency: the trigger bumps it on every UPDATE.
  ADD COLUMN IF NOT EXISTS version       integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  ADD COLUMN IF NOT EXISTS updated_at    timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by    text;

ALTER TABLE reservations ALTER COLUMN source DROP DEFAULT;

-- Backfill the phase-1 rows. The meal is the restaurant's period that serves
-- the time (just seeded from the same SLOTS the booking was made against).
UPDATE reservations r
   SET meal = COALESCE(
         (SELECT p.meal FROM service_periods p
           WHERE p.restaurant_id = r.restaurant_id
             AND r.reserved_at::time BETWEEN p.first_seating AND p.last_seating
           ORDER BY p.sort_order, p.first_seating
           LIMIT 1),
         CASE WHEN r.reserved_at < '11:00' THEN 'Breakfast'
              WHEN r.reserved_at < '17:00' THEN 'Lunch'
              ELSE 'Dinner' END)
 WHERE r.meal IS NULL;

-- Before the trigger exists, so the old rows keep version 1.
UPDATE reservations
   SET search_text = reservation_search_text(guest_name, email, phone, phone_e164, reference),
       -- Every booking made before launch is test data (spec §11): purge before launch A.
       is_test = true
 WHERE source = 'legacy' AND search_text IS NULL AND anonymized_at IS NULL;

UPDATE reservations SET updated_at = created_at WHERE updated_at IS NULL;

ALTER TABLE reservations
  ALTER COLUMN meal SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_meal_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_meal_check
  CHECK (meal IN ('Breakfast', 'Lunch', 'Dinner', 'Drinks'));

-- search_text, version and updated_at belong to the database, so no write path
-- can forget them: every UPDATE bumps the version (spec §10.3), and an
-- anonymised row keeps no search text (spec §11). App SQL never sets them.
CREATE OR REPLACE FUNCTION reservations_before_write() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_text := CASE WHEN NEW.anonymized_at IS NULL THEN
    reservation_search_text(NEW.guest_name, NEW.email, NEW.phone, NEW.phone_e164, NEW.reference)
  END;
  IF TG_OP = 'UPDATE' THEN
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS reservations_before_write ON reservations;
CREATE TRIGGER reservations_before_write
  BEFORE INSERT OR UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION reservations_before_write();

-- ── reservations: indexes ─────────────────────────────────────────────────
-- reservations_dedupe_v2_idx (migration 003) stays as it is.
-- Covers held per slot: the availability read and the capacity check. Holding
-- statuses are requested, confirmed and seated (spec §10.3).
DROP INDEX IF EXISTS reservations_slot_idx;
CREATE INDEX IF NOT EXISTS reservations_load_idx
  ON reservations (restaurant_id, reserved_on, reserved_at) INCLUDE (guests)
  WHERE status IN ('requested', 'confirmed', 'seated');
CREATE INDEX IF NOT EXISTS reservations_inbox_idx ON reservations (status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS reservations_created_idx ON reservations (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS reservations_pending_idx
  ON reservations (reserved_on, reserved_at, id) WHERE status = 'requested';
CREATE INDEX IF NOT EXISTS reservations_day_idx ON reservations (reserved_on, restaurant_id, reserved_at);
CREATE INDEX IF NOT EXISTS reservations_phone_idx ON reservations (phone_e164, reserved_on);
CREATE INDEX IF NOT EXISTS reservations_search_trgm_idx ON reservations USING gin (search_text gin_trgm_ops);

-- ── reservation_events, reservation_notes ─────────────────────────────────
-- The booking timeline. Booking writes go here INSTEAD of audit_log (spec §7.4).
-- actor_* are snapshots without FKs, like audit_log. Phase 5 replaces
-- reservation_events_type_check when it adds the email events.
CREATE TABLE IF NOT EXISTS reservation_events (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id bigint      NOT NULL REFERENCES reservations (id) ON DELETE CASCADE,
  at             timestamptz NOT NULL DEFAULT now(),
  actor_kind     text        NOT NULL CHECK (actor_kind IN ('guest', 'staff', 'system')),
  actor_id       text,
  actor_label    text,
  type           text        NOT NULL CHECK (type IN ('created', 'status_changed', 'edited', 'note_added')),
  from_status    text        CHECK (from_status IN ('requested', 'confirmed', 'seated', 'no_show', 'cancelled', 'declined')),
  to_status      text        CHECK (to_status IN ('requested', 'confirmed', 'seated', 'no_show', 'cancelled', 'declined')),
  changes        jsonb,      -- {"guests": [2, 4]}; phase 10 strips personal keys when anonymising
  reason         text        CHECK (length(reason) <= 500),
  CONSTRAINT reservation_events_staff_actor CHECK (actor_kind <> 'staff' OR actor_id IS NOT NULL),
  CONSTRAINT reservation_events_created_status CHECK (type <> 'created' OR to_status IS NOT NULL),
  CONSTRAINT reservation_events_transition CHECK (
    type <> 'status_changed' OR (from_status IS NOT NULL AND to_status IS NOT NULL AND from_status <> to_status)
  )
);

CREATE INDEX IF NOT EXISTS reservation_events_reservation_idx ON reservation_events (reservation_id, at, id);
CREATE INDEX IF NOT EXISTS reservation_events_at_idx ON reservation_events (at DESC, id DESC);

-- Internal staff notes: never shown or sent to the guest.
CREATE TABLE IF NOT EXISTS reservation_notes (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id bigint      NOT NULL REFERENCES reservations (id) ON DELETE CASCADE,
  author_id      text        NOT NULL,
  author_label   text        NOT NULL,
  body           text        NOT NULL CHECK (btrim(body) <> '' AND length(body) <= 2000),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reservation_notes_reservation_idx ON reservation_notes (reservation_id, created_at);

-- The phase-1 rows get their 'created' event, once. A migration is not a guest.
INSERT INTO reservation_events (reservation_id, at, actor_kind, actor_label, type, to_status, reason)
SELECT r.id, r.created_at, 'system', 'migration 006', 'created', r.status, 'phase-1 booking'
  FROM reservations r
 WHERE r.source = 'legacy'
   AND NOT EXISTS (SELECT 1 FROM reservation_events e WHERE e.reservation_id = r.id);

-- ── audit_feed ────────────────────────────────────────────────────────────
-- Exactly the columns of migration 005, in its order (CREATE OR REPLACE VIEW
-- may only append, and /admin/audit reads these); reservation events join the
-- feed. `id` is the numeric id as text in both branches. A guest's event has no
-- label: the feed calls it 'Khách', so /admin/audit does not show it as the
-- system's.
CREATE OR REPLACE VIEW audit_feed AS
SELECT 'audit'::text   AS source,
       a.id::text      AS id,
       a.at,
       a.actor_id,
       a.actor_email   AS actor_label,
       a.action,
       a.entity_type,
       a.entity_id,
       a.locale,
       a.before,
       a.after
  FROM audit_log a
UNION ALL
SELECT 'reservation'::text,
       e.id::text,
       e.at,
       e.actor_id,
       COALESCE(e.actor_label, CASE e.actor_kind WHEN 'guest' THEN 'Khách' END),
       'reservation.' || e.type,
       'reservation'::text,
       e.reservation_id::text,
       NULL::text,
       CASE WHEN e.from_status IS NOT NULL THEN jsonb_build_object('status', e.from_status) END,
       jsonb_strip_nulls(jsonb_build_object('status', e.to_status, 'changes', e.changes, 'reason', e.reason))
  FROM reservation_events e;
```

- [ ] **Bước 5: Chạy lại test**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/migration-006.test.ts`
Expected: PASS `Tests  18 passed (18)`

- [ ] **Bước 6: Bắc cầu INSERT của đợt 1 và sửa ba test cũ**

`createReservation` của đợt 1 giờ phải nêu `source`, `meal` và ghi sự kiện `created`. Bữa lấy từ ca đang bật phục vụ giờ đó; `$4` là `text` ở cột và `$4::text::time` trong truy vấn con, nếu không Postgres báo "inconsistent types deduced for parameter $4". Task 4 xóa cả hàm này.

Sửa `db/queries.ts` đúng như diff sau:

```diff
diff --git a/db/queries.ts b/db/queries.ts
index a51d7ec..2751831 100644
--- a/db/queries.ts
+++ b/db/queries.ts
@@ -152,10 +152,19 @@ async function insertReservation(input: NewReservation, reference: string): Prom
       return { ok: false, reason: 'full' };
     }
 
-    await client.query(
+    // Bridge until submitReservation v2 (phase 4, Task 4) replaces this path:
+    // migration 006 needs the source, the meal (the active period that serves
+    // this time) and a 'created' event. $4 is text for the column and the time
+    // in the subselect, so Postgres deduces one type for it.
+    const inserted = await client.query<{ id: string }>(
       `INSERT INTO reservations
-         (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164, email, note)
-       VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10)`,
+         (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164, email, note, source, meal)
+       VALUES ($1, $2, $3::date, $4::text, $5, $6, $7, $8, $9, $10, 'web',
+               (SELECT meal FROM service_periods
+                 WHERE restaurant_id = $2 AND active AND $4::text::time BETWEEN first_seating AND last_seating
+                   AND extract(isodow FROM $3::date)::smallint = ANY (weekdays)
+                 ORDER BY sort_order LIMIT 1))
+       RETURNING id::text`,
       [
         reference,
         input.restaurantId,
@@ -169,6 +178,10 @@ async function insertReservation(input: NewReservation, reference: string): Prom
         input.note || null,
       ],
     );
+    await client.query(
+      `INSERT INTO reservation_events (reservation_id, actor_kind, type, to_status) VALUES ($1, 'guest', 'created', 'requested')`,
+      [inserted.rows[0].id],
+    );
 
     await client.query('COMMIT');
     return { ok: true, reference };
```

`migration-005.test.ts` chỉ migrate tới 005: từ nay 006 sở hữu view `audit_feed`, và chạy lại 005 trên 006 sẽ bỏ nhánh đặt bàn của view.

```diff
diff --git a/test/integration/migration-005.test.ts b/test/integration/migration-005.test.ts
index 53da1ed..990bcfa 100644
--- a/test/integration/migration-005.test.ts
+++ b/test/integration/migration-005.test.ts
@@ -14,7 +14,9 @@ const invite = (email: string, hash = HASH, extra = '') =>
   );
 
 describe.skipIf(!TEST_DATABASE_URL)('migration 005: staff sign-in and the audit trail (database)', () => {
-  beforeAll(() => resetDatabase(url));
+  // Migration 005 on its own: 006 owns audit_feed from then on, and re-running
+  // 005 on top of 006 would drop the view's reservation branch.
+  beforeAll(() => resetDatabase(url, '005_staff_auth_audit.sql'));
 
   it('creates the seven tables and the audit_feed view', async () => {
     const { rows } = await sql(
```

`audit-feed.test.ts` dọn cả `reservations` (các file khác để lại đặt bàn, mà feed giờ hiện chúng) và thêm một test cho phép hợp trong view, qua chính bộ đọc của `/admin/audit` (sự kiện `created` của khách không có nhãn, view gọi nó là `'Khách'`):

```diff
diff --git a/test/integration/audit-feed.test.ts b/test/integration/audit-feed.test.ts
index 872bc94..d91ae10 100644
--- a/test/integration/audit-feed.test.ts
+++ b/test/integration/audit-feed.test.ts
@@ -16,7 +16,8 @@ describe.skipIf(!TEST_DATABASE_URL)('the audit feed', () => {
     await pool.end();
   });
   beforeEach(async () => {
-    await pool.query(`TRUNCATE ${STAFF_TABLES} CASCADE`);
+    // Since migration 006 the feed also shows reservation_events, and other files leave bookings behind.
+    await pool.query(`TRUNCATE ${STAFF_TABLES}, reservations CASCADE`);
   });
 
   it('puts the newest first and breaks ties by id, numerically', async () => {
@@ -51,6 +52,35 @@ describe.skipIf(!TEST_DATABASE_URL)('the audit feed', () => {
     expect((await listAuditFeed(pool, 99)).rows).toEqual([]);
   });
 
+  it('merges reservation events into the same timeline', async () => {
+    await pool.query(
+      `INSERT INTO audit_log (at, actor_email, action, entity_type, entity_id)
+       VALUES (now() - interval '2 minutes', 'a@furama.test', 'update', 'restaurant', 'taya-house')`,
+    );
+    const { rows } = await pool.query(
+      `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source)
+       VALUES ('FC-FEED0001', 'taya-house', '2026-10-05', '19:00', 'Dinner', 2, 'An', 'x', '+84905000000', 'web') RETURNING id`,
+    );
+    await pool.query(
+      `INSERT INTO reservation_events (reservation_id, at, actor_kind, type, to_status)
+       VALUES ($1, now() - interval '3 hours', 'guest', 'created', 'requested')`,
+      [rows[0].id],
+    );
+    await pool.query(
+      `INSERT INTO reservation_events (reservation_id, at, actor_kind, actor_id, actor_label, type, from_status, to_status, changes)
+       VALUES ($1, now() - interval '1 minute', 'staff', 'u1', 'ed@furama.test', 'status_changed', 'requested', 'confirmed', '{"note": ["a", "b"]}')`,
+      [rows[0].id],
+    );
+    const feed = await listAuditFeed(pool, 1);
+    expect(feed.rows.map((r) => [r.source, r.action, r.entity_type, r.entity_id, r.actor_label])).toEqual([
+      ['reservation', 'reservation.status_changed', 'reservation', String(rows[0].id), 'ed@furama.test'],
+      ['audit', 'update', 'restaurant', 'taya-house', 'a@furama.test'],
+      ['reservation', 'reservation.created', 'reservation', String(rows[0].id), 'Khách'],
+    ]);
+    expect(feed.rows[0]).toMatchObject({ before: { status: 'requested' }, after: { status: 'confirmed', changes: { note: ['a', 'b'] } } });
+    expect(feed.rows[2]).toMatchObject({ before: null, after: { status: 'requested' } });
+  });
+
   it('looks up the email of staff the rows are about, skipping removed accounts', async () => {
     const owner = await createBootstrapAdmin(createTestAuth(pool));
     expect(await staffEmails(pool, [owner.id, 'removed-id'])).toEqual(new Map([[owner.id, owner.email]]));
```

Fixture SQL thô của `availability.test.ts` nêu `meal` và `source`:

```diff
diff --git a/test/integration/availability.test.ts b/test/integration/availability.test.ts
index ed36328..c6a8921 100644
--- a/test/integration/availability.test.ts
+++ b/test/integration/availability.test.ts
@@ -27,8 +27,8 @@ describe.skipIf(!process.env.TEST_DATABASE_URL)('GET /api/availability (database
 
   it('sums the covers booked on the requested date', async () => {
     await getPool().query(
-      `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164)
-       VALUES ('FC-AAAAAAAA', 'taya-house', '2026-10-03', '19:00', 4, 'An', '0905000000', '+84905000000')`,
+      `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source)
+       VALUES ('FC-AAAAAAAA', 'taya-house', '2026-10-03', '19:00', 'Dinner', 4, 'An', '0905000000', '+84905000000', 'web')`,
     );
     const body = await (await get('restaurant=taya-house&date=2026-10-03')).json();
     expect(body.booked).toEqual({ '19:00': 4 });
```

- [ ] **Bước 7: Chạy các test vừa đổi**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/migration-005.test.ts test/integration/audit-feed.test.ts test/integration/availability.test.ts test/integration/reservations.test.ts test/integration/submit-reservation.test.ts`
Expected: PASS, cả năm file xanh (`reservations.test.ts` và `submit-reservation.test.ts` chạy qua cầu nối).

- [ ] **Bước 8: Chạy cổng kiểm tra**

Chạy đủ khối lệnh ở "Cổng kiểm tra của mọi task" (Global Constraints).

Expected:
- typecheck không lỗi; lint thoát 0, 20 cảnh báo;
- `Test Files  42 passed (42)`, `Tests  394 passed (394)`;
- `reset-db` in `Applied 6 migration(s).`;
- build thoát 0; check-prerender in `Prerender check passed …`, `Admin check passed …`, `Font check passed …`;
- E2E `70 passed`; visual `8 passed`.

- [ ] **Bước 9: Commit**

```bash
git add db/migrations/006_booking_v2.sql test/integration/migration-006.test.ts test/integration/migration-005.test.ts test/integration/audit-feed.test.ts test/integration/availability.test.ts test/helpers/db.ts db/queries.ts
git commit -m "$(cat <<'EOF'
feat: add migration 006 for booking rules, service periods, closures and the reservation timeline

Migration 006 is spec §5.2 "Đặt bàn (đợt 4)": one booking_settings row,
per-restaurant overrides and the booking switch, service_periods seeded to
today's behaviour (SLOTS × restaurants.meals × slot_capacity), closures with
a translated public reason, the v2 reservation columns, reservation_events
and reservation_notes, and audit_feed as audit_log ∪ reservation_events with
the columns migration 005 gave it.

A BEFORE INSERT OR UPDATE trigger owns version, updated_at and search_text,
so no write path can forget them; fold_search() is the SQL twin of fold(),
pinned by a test that also runs it under the C collation. Phase-1 rows
become source 'legacy' and is_test, keep version 1, and get a 'created'
event from the system. source has no default: every insert names it.

The phase-1 guest insert names its source, meal and 'created' event until
submitReservation v2 replaces it. TEST_DB_TAG renames the migration test
databases so two checkouts can share one Postgres.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 2: Engine thuần — `planDay`, `clockBlock`, `resolveDay`

Spec §10.1 thành các hàm thuần chạy cả ở server lẫn trình duyệt. Không đọc DB, không đọc đồng hồ ngầm: mọi hàm nhận quy tắc, ngày, thời điểm và số chỗ đã giữ làm tham số.

**Files:**
- Create: `lib/booking/rules.ts`, `lib/booking/resolve-day.ts`, `lib/booking/resolve-day.test.ts`, `test/integration/booking-seed.test.ts`
- Modify: `lib/venue-time.ts`, `lib/venue-time.test.ts`

**Interfaces:**
- Consumes: `venueNow`, `addDays`, `daysBetween`, `toMinutes`, `minutesUntil`, `type IsoDate` từ `lib/venue-time.ts`; `SLOTS`, `type Meal` từ `lib/data.ts`; các bảng của Task 1 (`booking_settings`, `service_periods`).
- Produces:
  - `lib/venue-time.ts`: `isoWeekday(d: IsoDate): number` (1 = thứ Hai … 7 = Chủ nhật), `fromMinutes(m: number): string` (`1140 → '19:00'`).
  - `lib/booking/rules.ts` (không `server-only`): `HOLDING_STATUSES = ['requested', 'confirmed', 'seated'] as const`, `RESERVATION_STATUSES` (6 trạng thái), `type ReservationStatus`, `type PeriodRule = { id; meal; weekdays: number[]; firstSeating; lastSeating; intervalMin; coversPerSlot; sortOrder; active? }`, `type ClosureRule = { id; scope: 'all' | 'destination' | 'restaurant'; destinationId; restaurantId; startsOn; endsOn; meals: Meal[] | null; publicReason: string | null }`, `type BookingRules = { restaurantId; restaurantName; destinationId; bookingEnabled; windowDays; leadMinutes; sameDayCutoff: string | null; maxParty; autoConfirm; periods; closures }`, `type BookedCovers = Record<string, number>`, `type SlotBlock = 'closed' | 'lead' | 'cutoff' | 'party' | 'full'`, `type ResolvedSlot = { time; capacity; booked; left; bookable; block? }`, `type ResolvedPeriod = { periodId; meal; closed; reason; slots }`, `type DayState = 'open' | 'full' | 'past' | 'closed' | 'too_large' | 'outside' | 'unavailable'`, `type ResolvedDay = { date; state; reason; periods }`.
  - `lib/booking/resolve-day.ts`: `seatings(period): string[]`; `closureApplies(c, rules, date): boolean` (cả hai đầu); `type PlannedPeriod = { periodId; meal; closed; reason; slots: { time; capacity }[] }`; `planDay(rules, date): { periods: PlannedPeriod[]; wholeDayReason: string | null }`; `clockBlock(date, time, now, rules: Pick<BookingRules, 'leadMinutes' | 'sameDayCutoff'>): 'lead' | 'cutoff' | null`; `resolveDay(rules, date, now, booked = {}, guests = 1): ResolvedDay`; `findSlot(day, time): { period; slot } | null`; `resolveRange(rules, from, to, now, bookedByDate): { date; state; reason? }[]`.

- [ ] **Bước 1: Viết test**

Thêm vào `lib/venue-time.test.ts`:

```diff
diff --git a/lib/venue-time.test.ts b/lib/venue-time.test.ts
index f75761d..886a2e5 100644
--- a/lib/venue-time.test.ts
+++ b/lib/venue-time.test.ts
@@ -3,7 +3,9 @@ import {
   addDays,
   daysBetween,
   formatDay,
+  fromMinutes,
   isValidIsoDate,
+  isoWeekday,
   minutesUntil,
   toMinutes,
   venueNow,
@@ -43,8 +45,17 @@ describe('calendar maths', () => {
     expect(isValidIsoDate(20261002)).toBe(false);
   });
 
-  it('reads HH:MM as minutes after midnight', () => {
+  it('reads HH:MM as minutes after midnight, and writes them back', () => {
     expect(toMinutes('19:30')).toBe(1170);
+    expect(fromMinutes(1170)).toBe('19:30');
+    expect(fromMinutes(390)).toBe('06:30');
+    expect(fromMinutes(0)).toBe('00:00');
+  });
+
+  it('numbers ISO weekdays Monday 1 to Sunday 7, from the calendar date alone', () => {
+    expect(isoWeekday('2026-10-05')).toBe(1);
+    expect(isoWeekday('2026-10-01')).toBe(4);
+    expect(isoWeekday('2026-10-04')).toBe(7);
   });
 });
 
```

Create `lib/booking/resolve-day.test.ts`. Runner chạy với `TZ=UTC` (`npm test`), nên `at('2026-10-01T18:29')` là giờ treo tường ở Đà Nẵng:

```ts
import { describe, expect, it } from 'vitest';
import { clockBlock, findSlot, planDay, resolveDay, resolveRange, seatings } from './resolve-day';
import type { BookingRules, ClosureRule, PeriodRule } from './rules';

// 2026-10-01 is a Thursday. The runner is pinned to UTC (npm test sets TZ=UTC);
// Da Nang is UTC+7, so these instants are Da Nang wall-clock times.
const at = (danang: string) => new Date(`${danang}:00+07:00`);

const period = (over: Partial<PeriodRule> = {}): PeriodRule => ({
  id: 'p-dinner',
  meal: 'Dinner',
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  firstSeating: '18:00',
  lastSeating: '21:00',
  intervalMin: 30,
  coversPerSlot: 16,
  sortOrder: 40,
  ...over,
});

const LUNCH = period({ id: 'p-lunch', meal: 'Lunch', firstSeating: '11:30', lastSeating: '13:30', sortOrder: 20 });
const BREAKFAST = period({ id: 'p-bf', meal: 'Breakfast', firstSeating: '06:30', lastSeating: '09:30', sortOrder: 10 });

const rules = (over: Partial<BookingRules> = {}): BookingRules => ({
  restaurantId: 'taya-house',
  restaurantName: 'Tàya House',
  destinationId: 'resort',
  bookingEnabled: true,
  windowDays: 14,
  leadMinutes: 30,
  sameDayCutoff: null,
  maxParty: 12,
  autoConfirm: false,
  periods: [LUNCH, period()],
  closures: [],
  ...over,
});

const closure = (over: Partial<ClosureRule> = {}): ClosureRule => ({
  id: 'c1',
  scope: 'restaurant',
  destinationId: null,
  restaurantId: 'taya-house',
  startsOn: '2026-10-05',
  endsOn: '2026-10-05',
  meals: null,
  publicReason: 'Private event',
  ...over,
});

const NOON_OCT_1 = at('2026-10-01T12:00');
const times = (day: ReturnType<typeof resolveDay>) => day.periods.flatMap((p) => p.slots.map((s) => s.time));

describe('seatings', () => {
  it('runs from the first to the last seating by the interval', () => {
    expect(seatings(period())).toEqual(['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00']);
    expect(seatings({ firstSeating: '17:00', lastSeating: '22:00', intervalMin: 60 })).toEqual([
      '17:00', '18:00', '19:00', '20:00', '21:00', '22:00',
    ]);
    expect(seatings({ firstSeating: '23:30', lastSeating: '23:59', intervalMin: 15 })).toEqual(['23:30', '23:45']);
  });
});

describe('planDay (staff paths: no clock, no window, no booking switch)', () => {
  it('lists the services of any date, even one past the window or with booking off', () => {
    const plan = planDay(rules({ bookingEnabled: false, windowDays: 1 }), '2026-12-01');
    expect(plan.periods.map((p) => [p.meal, p.closed, p.slots.length])).toEqual([
      ['Lunch', false, 5],
      ['Dinner', false, 7],
    ]);
    expect(plan.periods[1].slots[0]).toEqual({ time: '18:00', capacity: 16 });
  });

  it('marks the services a closure takes out, with the whole-day reason', () => {
    const plan = planDay(rules({ closures: [closure()] }), '2026-10-05');
    expect(plan.wholeDayReason).toBe('Private event');
    expect(plan.periods.map((p) => [p.meal, p.closed])).toEqual([
      ['Lunch', true],
      ['Dinner', true],
    ]);
  });
});

describe('resolveDay: periods', () => {
  it('lists each active period of that weekday with covers_per_slot per slot', () => {
    const day = resolveDay(rules(), '2026-10-05', NOON_OCT_1);
    expect(day.state).toBe('open');
    expect(day.periods.map((p) => p.meal)).toEqual(['Lunch', 'Dinner']);
    expect(day.periods[1].slots[0]).toEqual({ time: '18:00', capacity: 16, booked: 0, left: 16, bookable: true });
  });

  it('serves a period only on its weekdays', () => {
    const weekdaysOnly = rules({ periods: [period({ weekdays: [1, 2, 3, 4, 5] })] });
    expect(resolveDay(weekdaysOnly, '2026-10-05', NOON_OCT_1).state).toBe('open'); // Monday
    expect(resolveDay(weekdaysOnly, '2026-10-03', NOON_OCT_1)).toEqual({
      date: '2026-10-03', state: 'closed', reason: null, periods: [],
    }); // Saturday
  });

  it('ignores inactive periods', () => {
    const day = resolveDay(rules({ periods: [LUNCH, period({ active: false })] }), '2026-10-05', NOON_OCT_1);
    expect(day.periods.map((p) => p.meal)).toEqual(['Lunch']);
  });

  it('orders periods by sort order, then first seating', () => {
    const day = resolveDay(rules({ periods: [period(), BREAKFAST, LUNCH] }), '2026-10-05', NOON_OCT_1);
    expect(day.periods.map((p) => p.meal)).toEqual(['Breakfast', 'Lunch', 'Dinner']);
  });

  it('keeps a time once when two periods overlap: the first by sort order owns it', () => {
    const drinks = period({ id: 'p-drinks', meal: 'Drinks', firstSeating: '17:00', lastSeating: '22:00', intervalMin: 60, sortOrder: 30, coversPerSlot: 24 });
    const day = resolveDay(rules({ periods: [period(), drinks] }), '2026-10-05', NOON_OCT_1);
    expect(times(day)).toEqual(['17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '18:30', '19:30', '20:30']);
    expect(findSlot(day, '19:00')?.period.meal).toBe('Drinks');
  });
});

describe('resolveDay: closures', () => {
  it('closes the whole day and shows the public reason', () => {
    const day = resolveDay(rules({ closures: [closure()] }), '2026-10-05', NOON_OCT_1);
    expect(day.state).toBe('closed');
    expect(day.reason).toBe('Private event');
    expect(day.periods.every((p) => p.closed && p.slots.every((s) => s.block === 'closed'))).toBe(true);
  });

  it('includes both ends of the date range', () => {
    const c = closure({ startsOn: '2026-10-05', endsOn: '2026-10-07' });
    const state = (d: string) => resolveDay(rules({ closures: [c] }), d, NOON_OCT_1).state;
    expect([state('2026-10-04'), state('2026-10-05'), state('2026-10-07'), state('2026-10-08')]).toEqual([
      'open', 'closed', 'closed', 'open',
    ]);
  });

  it('matches scope all, the restaurant’s destination, or the restaurant itself', () => {
    const state = (c: ClosureRule) => resolveDay(rules({ closures: [c] }), '2026-10-05', NOON_OCT_1).state;
    expect(state(closure({ scope: 'all', restaurantId: null }))).toBe('closed');
    expect(state(closure({ scope: 'destination', restaurantId: null, destinationId: 'resort' }))).toBe('closed');
    expect(state(closure({ scope: 'destination', restaurantId: null, destinationId: 'dining-house' }))).toBe('open');
    expect(state(closure({ restaurantId: 'pho-cuon' }))).toBe('open');
  });

  it('closes only the listed meals; the others stay bookable', () => {
    const day = resolveDay(rules({ closures: [closure({ meals: ['Dinner'], publicReason: 'Wedding' })] }), '2026-10-05', NOON_OCT_1);
    expect(day.state).toBe('open');
    expect(day.periods.map((p) => [p.meal, p.closed, p.reason])).toEqual([
      ['Lunch', false, null],
      ['Dinner', true, 'Wedding'],
    ]);
    expect(findSlot(day, '19:00')?.slot).toMatchObject({ bookable: false, block: 'closed' });
    expect(findSlot(day, '12:00')?.slot.bookable).toBe(true);
  });

  it('closes the day when closures take out every service it has', () => {
    const day = resolveDay(rules({ closures: [closure({ meals: ['Lunch', 'Dinner'] })] }), '2026-10-05', NOON_OCT_1);
    expect(day).toMatchObject({ state: 'closed', reason: 'Private event' });
  });

  it('closes without a reason when the closure hides it', () => {
    const day = resolveDay(rules({ closures: [closure({ publicReason: null })] }), '2026-10-05', NOON_OCT_1);
    expect(day).toMatchObject({ state: 'closed', reason: null });
  });
});

describe('resolveDay: window', () => {
  it('offers today through today + window_days − 1', () => {
    const state = (d: string) => resolveDay(rules(), d, NOON_OCT_1).state;
    expect(state('2026-09-30')).toBe('outside');
    expect(state('2026-10-01')).toBe('open');
    expect(state('2026-10-14')).toBe('open');
    expect(state('2026-10-15')).toBe('outside');
    expect(resolveDay(rules({ windowDays: 1 }), '2026-10-02', NOON_OCT_1).state).toBe('outside');
  });

  it("moves the window at Da Nang's midnight, not the server's", () => {
    const before = new Date('2026-10-01T16:59:00Z'); // 23:59 on 1 Oct in Da Nang
    const after = new Date('2026-10-01T17:00:00Z'); //  00:00 on 2 Oct in Da Nang
    expect(resolveDay(rules(), '2026-10-15', before).state).toBe('outside');
    expect(resolveDay(rules(), '2026-10-15', after).state).toBe('open');
    expect(resolveDay(rules(), '2026-10-01', after).state).toBe('outside');
  });
});

describe('resolveDay: lead time', () => {
  const dinnerAt = (now: Date, lead = 30) => findSlot(resolveDay(rules({ leadMinutes: lead }), '2026-10-01', now), '19:00')?.slot;

  it('needs more than lead_minutes on the clock minute: 18:29 books 19:00, 18:30 does not', () => {
    expect(dinnerAt(at('2026-10-01T18:29'))).toMatchObject({ bookable: true });
    expect(dinnerAt(at('2026-10-01T18:30'))).toMatchObject({ bookable: false, block: 'lead' });
    // 18:30:59 is still minute 18:30 (29 min 1 s left).
    expect(dinnerAt(new Date('2026-10-01T18:30:59+07:00'))).toMatchObject({ block: 'lead' });
  });

  it('with no lead time closes a sitting when it starts', () => {
    expect(dinnerAt(at('2026-10-01T18:59'), 0)).toMatchObject({ bookable: true });
    expect(dinnerAt(at('2026-10-01T19:00'), 0)).toMatchObject({ block: 'lead' });
  });

  it('counts across Da Nang midnight', () => {
    // 23:45 on 1 Oct; breakfast 06:30 on 2 Oct is 405 minutes away.
    const late = at('2026-10-01T23:45');
    const slot = (lead: number) =>
      findSlot(resolveDay(rules({ leadMinutes: lead, periods: [BREAKFAST] }), '2026-10-02', late), '06:30')?.slot;
    expect(slot(404)).toMatchObject({ bookable: true });
    expect(slot(405)).toMatchObject({ block: 'lead' });
  });

  it('reports past once every remaining sitting today is inside the lead time', () => {
    expect(resolveDay(rules(), '2026-10-01', at('2026-10-01T20:30')).state).toBe('past');
    expect(resolveDay(rules(), '2026-10-01', at('2026-10-01T20:29')).state).toBe('open');
  });
});

describe('clockBlock (the guest form closes sittings with the same rule)', () => {
  const r = { leadMinutes: 30, sameDayCutoff: '17:00' };

  it('blocks inside the lead time first, then from the same-day cut-off', () => {
    expect(clockBlock('2026-10-01', '19:00', at('2026-10-01T16:59'), r)).toBeNull();
    expect(clockBlock('2026-10-01', '19:00', at('2026-10-01T17:00'), r)).toBe('cutoff');
    expect(clockBlock('2026-10-01', '17:20', at('2026-10-01T17:00'), r)).toBe('lead');
    expect(clockBlock('2026-10-01', '19:00', at('2026-10-01T18:30'), { leadMinutes: 30, sameDayCutoff: null })).toBe('lead');
  });

  it('applies the cut-off to today only', () => {
    expect(clockBlock('2026-10-02', '12:00', at('2026-10-01T23:00'), r)).toBeNull();
  });
});

describe('resolveDay: same-day cut-off', () => {
  const r = rules({ sameDayCutoff: '17:00' });

  it('stops same-day booking from the cut-off minute', () => {
    expect(resolveDay(r, '2026-10-01', at('2026-10-01T16:59')).state).toBe('open');
    const day = resolveDay(r, '2026-10-01', at('2026-10-01T17:00'));
    expect(day.state).toBe('past');
    expect(findSlot(day, '20:00')?.slot.block).toBe('cutoff');
  });

  it('leaves tomorrow alone', () => {
    expect(resolveDay(r, '2026-10-02', at('2026-10-01T23:00')).state).toBe('open');
  });
});

describe('resolveDay: capacity and party size', () => {
  it('books a slot while booked + party ≤ covers_per_slot', () => {
    const day = (guests: number) => resolveDay(rules(), '2026-10-05', NOON_OCT_1, { '19:00': 14 }, guests);
    expect(findSlot(day(2), '19:00')?.slot).toEqual({ time: '19:00', capacity: 16, booked: 14, left: 2, bookable: true });
    expect(findSlot(day(3), '19:00')?.slot).toMatchObject({ left: 2, bookable: false, block: 'full' });
  });

  it('never reports negative covers left (staff may book over capacity)', () => {
    const day = resolveDay(rules(), '2026-10-05', NOON_OCT_1, { '19:00': 20 });
    expect(findSlot(day, '19:00')?.slot).toMatchObject({ booked: 20, left: 0, block: 'full' });
  });

  it('is full when no remaining sitting has room', () => {
    const booked = Object.fromEntries(times(resolveDay(rules(), '2026-10-05', NOON_OCT_1)).map((t) => [t, 16]));
    expect(resolveDay(rules(), '2026-10-05', NOON_OCT_1, booked).state).toBe('full');
  });

  it('is full, not past, when the sittings left today are taken', () => {
    const day = resolveDay(rules(), '2026-10-01', at('2026-10-01T20:00'), { '21:00': 16 });
    expect(day.state).toBe('full');
  });

  it('refuses a party above max_party', () => {
    expect(resolveDay(rules({ maxParty: 8 }), '2026-10-05', NOON_OCT_1, {}, 8).state).toBe('open');
    const day = resolveDay(rules({ maxParty: 8 }), '2026-10-05', NOON_OCT_1, {}, 9);
    expect(day.state).toBe('too_large');
    expect(findSlot(day, '19:00')?.slot.block).toBe('party');
  });

  it('is unavailable when online booking is off', () => {
    expect(resolveDay(rules({ bookingEnabled: false }), '2026-10-05', NOON_OCT_1)).toEqual({
      date: '2026-10-05', state: 'unavailable', reason: null, periods: [],
    });
  });
});

describe('resolveRange', () => {
  it('gives one state per date, with the closure reason when shown', () => {
    const r = rules({ closures: [closure()], windowDays: 5 });
    expect(resolveRange(r, '2026-10-01', '2026-10-06', at('2026-10-01T20:45'), { '2026-10-02': {} })).toEqual([
      { date: '2026-10-01', state: 'past' },
      { date: '2026-10-02', state: 'open' },
      { date: '2026-10-03', state: 'open' },
      { date: '2026-10-04', state: 'open' },
      { date: '2026-10-05', state: 'closed', reason: 'Private event' },
      { date: '2026-10-06', state: 'outside' },
    ]);
  });
});
```

Create `test/integration/booking-seed.test.ts`. Quy tắc đợt 1 (cửa sổ 14 ngày, đóng 30 phút trước giờ ngồi, `slot_capacity` mỗi slot) được viết lại trong test và đọc từ cột thô của `restaurants`, nên test vẫn đúng sau khi Task 5 đổi `meals` của catalogue và Task 6 xóa helper đợt 1:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import { findSlot, resolveDay } from '@/lib/booking/resolve-day';
import type { BookingRules, PeriodRule } from '@/lib/booking/rules';
import { SLOTS, type Meal } from '@/lib/data';
import { addDays, daysBetween, isoWeekday, minutesUntil, type IsoDate } from '@/lib/venue-time';

/*
 * Spec §10.1: migration 006 seeds service periods that reproduce the phase-1
 * behaviour exactly (global SLOTS × restaurants.meals × slot_capacity). The
 * phase-1 rule is written out here, from the raw restaurants columns, so the
 * comparison survives the removal of the phase-1 helpers (Task 6) and the
 * catalogue's switch to meals from periods (Task 5).
 */

/** Phase 1 (lib/booking.ts at 3c04ace): window 14 days, a sitting closes 30 minutes before, covers per slot. */
const PHASE1 = {
  inWindow: (date: IsoDate, today: IsoDate) => daysBetween(today, date) >= 0 && daysBetween(today, date) < 14,
  bookable: (date: IsoDate, time: string, guests: number, booked: Record<string, number>, capacity: number, now: Date) =>
    minutesUntil(date, time, now) > 30 && (booked[time] ?? 0) + guests <= capacity,
};

type Row = { id: string; name: string; destination: string; meals: Meal[]; slot_capacity: number; periods: PeriodRule[] };

const at = (danang: string) => new Date(`${danang}:00+07:00`);
const TODAY = '2026-10-01'; // a Thursday

describe.skipIf(!process.env.TEST_DATABASE_URL)('seeded service periods = phase-1 slots (database)', () => {
  let restaurants: Row[];
  const rules = new Map<string, BookingRules>();

  beforeAll(async () => {
    const settings = (await getPool().query('SELECT window_days, lead_minutes, same_day_cutoff, max_party FROM booking_settings')).rows[0];
    expect(settings).toEqual({ window_days: 14, lead_minutes: 30, same_day_cutoff: null, max_party: 12 });
    ({ rows: restaurants } = await getPool().query<Row>(
      `SELECT r.id, r.name, r.destination, r.meals, r.slot_capacity,
              COALESCE(json_agg(json_build_object(
                         'id', p.id::text, 'meal', p.meal, 'weekdays', p.weekdays,
                         'firstSeating', to_char(p.first_seating, 'HH24:MI'), 'lastSeating', to_char(p.last_seating, 'HH24:MI'),
                         'intervalMin', p.interval_min, 'coversPerSlot', p.covers_per_slot, 'sortOrder', p.sort_order)
                       ORDER BY p.sort_order) FILTER (WHERE p.id IS NOT NULL), '[]') AS periods
         FROM restaurants r LEFT JOIN service_periods p ON p.restaurant_id = r.id AND p.active
        GROUP BY r.id ORDER BY r.sort_order`,
    ));
    for (const r of restaurants) {
      rules.set(r.id, {
        restaurantId: r.id,
        restaurantName: r.name,
        destinationId: r.destination,
        bookingEnabled: true,
        windowDays: settings.window_days,
        leadMinutes: settings.lead_minutes,
        sameDayCutoff: null,
        maxParty: settings.max_party,
        autoConfirm: false,
        periods: r.periods,
        closures: [],
      });
    }
  });
  afterAll(() => getPool().end());

  it('seeds periods for all twelve restaurants', () => {
    expect(restaurants).toHaveLength(12);
    expect(restaurants.every((r) => r.periods.length === r.meals.length)).toBe(true);
  });

  it('offers the same meals, times and covers on every weekday', () => {
    const noon = at(`${TODAY}T12:00`);
    for (const r of restaurants) {
      const before = r.meals.flatMap((meal) => SLOTS[meal].map((t) => [meal, t, r.slot_capacity]));
      for (let i = 4; i < 11; i++) {
        const date = addDays(TODAY, i); // 5–11 Oct: Monday to Sunday
        const day = resolveDay(rules.get(r.id)!, date, noon);
        const after = day.periods.flatMap((p) => p.slots.map((s) => [p.meal, s.time, s.capacity]));
        expect({ restaurant: r.id, weekday: isoWeekday(date), slots: after }).toEqual({
          restaurant: r.id,
          weekday: isoWeekday(date),
          slots: before,
        });
      }
    }
  });

  it('agrees with phase 1 on which slots a party can book, sitting by sitting', () => {
    // Clock instants around the 30-minute lead of every service, a partly booked
    // board, and parties of 1, 4 and 12.
    const clocks = ['06:00', '06:59', '07:00', '11:00', '11:59', '13:00', '17:29', '17:30', '18:29', '18:30', '20:30', '21:31', '23:59'];
    const board = { '07:00': 39, '12:00': 15, '18:00': 10, '19:00': 16, '20:00': 59, '21:00': 1 };
    let compared = 0;
    for (const r of restaurants) {
      for (const clock of clocks) {
        const now = at(`${TODAY}T${clock}`);
        for (const date of [TODAY, addDays(TODAY, 1)]) {
          for (const guests of [1, 4, 12]) {
            const day = resolveDay(rules.get(r.id)!, date, now, board, guests);
            for (const meal of r.meals) {
              for (const time of SLOTS[meal]) {
                const before = PHASE1.bookable(date, time, guests, board, r.slot_capacity, now);
                expect({ r: r.id, clock, date, guests, time, bookable: findSlot(day, time)?.slot.bookable }).toEqual({
                  r: r.id, clock, date, guests, time, bookable: before,
                });
                compared++;
              }
            }
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(5000);
  });

  it('agrees with phase 1 on the 14-day window, across Da Nang midnight', () => {
    for (const instant of ['2026-10-01T16:59:00Z', '2026-10-01T17:00:00Z']) {
      const now = new Date(instant);
      const today = instant.startsWith('2026-10-01T16') ? '2026-10-01' : '2026-10-02';
      for (let i = -2; i < 17; i++) {
        const date = addDays('2026-10-01', i);
        const open = resolveDay(rules.get('taya-house')!, date, now).state !== 'outside';
        expect({ instant, date, open }).toEqual({ instant, date, open: PHASE1.inWindow(date, today) });
      }
    }
  });
});
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/booking/resolve-day.test.ts lib/venue-time.test.ts test/integration/booking-seed.test.ts`
Expected: FAIL `Test Files  3 failed (3)`, `Tests  2 failed | 7 passed (9)`:

```
 FAIL  lib/booking/resolve-day.test.ts [ lib/booking/resolve-day.test.ts ]
Error: Cannot find module './resolve-day' imported from …/lib/booking/resolve-day.test.ts
 FAIL  test/integration/booking-seed.test.ts [ test/integration/booking-seed.test.ts ]
Error: Cannot find package '@/lib/booking/resolve-day' imported from …/test/integration/booking-seed.test.ts
 FAIL  lib/venue-time.test.ts > calendar maths > reads HH:MM as minutes after midnight, and writes them back
TypeError: fromMinutes is not a function
 FAIL  lib/venue-time.test.ts > calendar maths > numbers ISO weekdays Monday 1 to Sunday 7, from the calendar date alone
TypeError: isoWeekday is not a function
```

- [ ] **Bước 3: Thêm `isoWeekday` và `fromMinutes`**

Sửa `lib/venue-time.ts` đúng như diff sau:

```diff
diff --git a/lib/venue-time.ts b/lib/venue-time.ts
index e98a5f9..18edea3 100644
--- a/lib/venue-time.ts
+++ b/lib/venue-time.ts
@@ -46,8 +46,15 @@ export function isValidIsoDate(s: unknown): s is IsoDate {
   );
 }
 
+/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday (spec §5.2 service_periods.weekdays). */
+export const isoWeekday = (d: IsoDate): number => new Date(utcMidnight(d)).getUTCDay() || 7;
+
 export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
 
+/** 1140 → "19:00". */
+export const fromMinutes = (m: number) =>
+  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
+
 /** Minutes from the venue's "now" until `hhmm` on `date`; negative once it has passed. */
 export function minutesUntil(date: IsoDate, hhmm: string, now: Date = new Date()): number {
   const v = venueNow(now);
```

- [ ] **Bước 4: Viết kiểu quy tắc**

`lib/booking/` là thư mục nằm cạnh file `lib/booking.ts`; `@/lib/booking` vẫn trỏ tới file (tsc và Turbopack đều vậy). **Không bao giờ thêm `lib/booking/index.ts`.**

Create `lib/booking/rules.ts`:

```ts
import type { Meal } from '@/lib/data';
import type { IsoDate } from '@/lib/venue-time';

/*
 * The booking rules of one restaurant, as resolveDay reads them (spec §10.1).
 * No server-only import: the admin's slot preview runs the same engine in the
 * browser. The server loads these from the database in
 * lib/server/booking/rules.ts (booking_settings merged with the restaurant's
 * overrides, its active service periods, the closures that reach it).
 */

/** Statuses that hold covers (spec §10.3). One list for SQL, the engine and the admin. */
export const HOLDING_STATUSES = ['requested', 'confirmed', 'seated'] as const;

export const RESERVATION_STATUSES = ['requested', 'confirmed', 'seated', 'no_show', 'cancelled', 'declined'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export type PeriodRule = {
  id: string;
  meal: Meal;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  weekdays: number[];
  /** "HH:MM", Da Nang time. */
  firstSeating: string;
  lastSeating: string;
  intervalMin: number;
  coversPerSlot: number;
  sortOrder: number;
  /** Absent means active: the loader only returns active periods; the admin preview passes drafts. */
  active?: boolean;
};

export type ClosureRule = {
  id: string;
  scope: 'all' | 'destination' | 'restaurant';
  destinationId: string | null;
  restaurantId: string | null;
  startsOn: IsoDate;
  endsOn: IsoDate;
  /** null: the whole day. */
  meals: Meal[] | null;
  /** Already resolved for the guest's language, and null when show_reason is off. */
  publicReason: string | null;
};

export type BookingRules = {
  restaurantId: string;
  restaurantName: string;
  destinationId: string;
  bookingEnabled: boolean;
  windowDays: number;
  leadMinutes: number;
  /** "HH:MM" or null (no same-day cut-off). */
  sameDayCutoff: string | null;
  maxParty: number;
  autoConfirm: boolean;
  periods: PeriodRule[];
  closures: ClosureRule[];
};

/** Covers held per "HH:MM" on one date. */
export type BookedCovers = Record<string, number>;

/** Why a slot cannot take this party. */
export type SlotBlock = 'closed' | 'lead' | 'cutoff' | 'party' | 'full';

export type ResolvedSlot = {
  time: string;
  capacity: number;
  booked: number;
  /** Covers still free (never negative: staff bookings may go over). */
  left: number;
  bookable: boolean;
  block?: SlotBlock;
};

export type ResolvedPeriod = {
  periodId: string;
  meal: Meal;
  /** A closure takes out this meal on this date; its slots carry block 'closed'. */
  closed: boolean;
  reason: string | null;
  slots: ResolvedSlot[];
};

/**
 * - unavailable: online booking is off for the restaurant
 * - outside: before today or past the booking window
 * - closed: no service that weekday, or closures take out every service
 * - too_large: the party is larger than max_party
 * - past: every remaining sitting is inside the lead time or the same-day cut-off
 * - full: sittings remain, none with room for the party
 * - open: at least one bookable slot
 */
export type DayState = 'open' | 'full' | 'past' | 'closed' | 'too_large' | 'outside' | 'unavailable';

export type ResolvedDay = {
  date: IsoDate;
  state: DayState;
  /** The public closure reason, when a closure caused 'closed' and shows its reason. */
  reason: string | null;
  periods: ResolvedPeriod[];
};
```

- [ ] **Bước 5: Viết engine**

Thứ tự chặn một slot: đóng cửa → lead → cutoff (đều qua `clockBlock`) → số khách → sức chứa. Trạng thái ngày: không còn slot nào ở ca mở → `closed`; nhóm quá `max_party` → `too_large`; mọi slot còn lại bị đồng hồ chặn → `past`; còn ít nhất một slot đặt được → `open`, nếu không → `full`.

Create `lib/booking/resolve-day.ts`:

```ts
import { addDays, daysBetween, fromMinutes, isoWeekday, toMinutes, venueNow, type IsoDate } from '@/lib/venue-time';
import type {
  BookedCovers,
  BookingRules,
  ClosureRule,
  DayState,
  PeriodRule,
  ResolvedDay,
  ResolvedPeriod,
  ResolvedSlot,
  SlotBlock,
} from './rules';

/*
 * resolveDay (spec §10.1): what one restaurant offers on one date, for a party
 * of `guests`, at the instant `now`. Pure and isomorphic: the guest API and
 * submitReservation (inside its transaction) call it with rules and booked
 * covers they loaded themselves. Staff paths (new booking, edit, preview, day
 * sheet, affected lists) call the clock-free planDay instead: staff may book
 * past the window, on a restaurant whose online booking is off.
 */

/** The seatings of one period: first, first + interval, … up to last. */
export function seatings(period: Pick<PeriodRule, 'firstSeating' | 'lastSeating' | 'intervalMin'>): string[] {
  const first = toMinutes(period.firstSeating);
  const last = toMinutes(period.lastSeating);
  const out: string[] = [];
  if (period.intervalMin <= 0) return out;
  for (let m = first; m <= last; m += period.intervalMin) out.push(fromMinutes(m));
  return out;
}

/** True when the closure reaches this restaurant on this date (both ends inclusive). */
export function closureApplies(c: ClosureRule, rules: Pick<BookingRules, 'restaurantId' | 'destinationId'>, date: IsoDate): boolean {
  if (date < c.startsOn || date > c.endsOn) return false;
  if (c.scope === 'all') return true;
  if (c.scope === 'destination') return c.destinationId === rules.destinationId;
  return c.restaurantId === rules.restaurantId;
}

const byOrder = (a: PeriodRule, b: PeriodRule) =>
  a.sortOrder - b.sortOrder || toMinutes(a.firstSeating) - toMinutes(b.firstSeating);

/** One service on one date, before the clock, the bookings or the party size are applied. */
export type PlannedPeriod = {
  periodId: string;
  meal: PeriodRule['meal'];
  closed: boolean;
  reason: string | null;
  slots: { time: string; capacity: number }[];
};

/**
 * Steps 1–3 of spec §10.1 for one date: the active periods of its weekday,
 * closures applied, slots generated. Clock-free, so the admin uses it to
 * preview a schedule and to find the bookings an edit or a closure leaves out.
 */
export function planDay(
  rules: Pick<BookingRules, 'restaurantId' | 'destinationId' | 'periods' | 'closures'>,
  date: IsoDate,
): { periods: PlannedPeriod[]; wholeDayReason: string | null } {
  const weekday = isoWeekday(date);
  const closures = rules.closures.filter((c) => closureApplies(c, rules, date));
  const wholeDay = closures.filter((c) => c.meals === null);
  // Two periods that share a time (an admin save rejects this) would double the
  // slot, and capacity is keyed by time; the first by sort order keeps it.
  const seen = new Set<string>();
  const periods = rules.periods
    .filter((p) => p.active !== false && p.weekdays.includes(weekday))
    .sort(byOrder)
    .map((p) => {
      const closure = wholeDay[0] ?? closures.find((c) => c.meals?.includes(p.meal));
      const slots = seatings(p)
        .filter((time) => !seen.has(time) && Boolean(seen.add(time)))
        .map((time) => ({ time, capacity: p.coversPerSlot }));
      return { periodId: p.id, meal: p.meal, closed: Boolean(closure), reason: closure?.publicReason ?? null, slots };
    });
  return { periods, wholeDayReason: wholeDay.find((c) => c.publicReason)?.publicReason ?? null };
}

/**
 * Whether the clock alone closes a sitting (spec §10.1 step 4, first two
 * rules). Lead: venueNow truncates to the minute, so "minutes left > lead" is
 * "at least lead minutes left" (at 18:30:59, 19:00 is 30 minutes away on the
 * clock but only 29 min 1 s remain). Cut-off: today only, from the cut-off
 * minute. The guest form calls this with the server's rules and clock offset.
 */
export function clockBlock(
  date: IsoDate,
  time: string,
  now: Date,
  rules: Pick<BookingRules, 'leadMinutes' | 'sameDayCutoff'>,
): 'lead' | 'cutoff' | null {
  const clock = venueNow(now);
  const offset = daysBetween(clock.date, date);
  if (offset * 1440 + toMinutes(time) - clock.minutes <= rules.leadMinutes) return 'lead';
  if (offset === 0 && rules.sameDayCutoff !== null && clock.minutes >= toMinutes(rules.sameDayCutoff)) return 'cutoff';
  return null;
}

export function resolveDay(
  rules: BookingRules,
  date: IsoDate,
  now: Date,
  booked: BookedCovers = {},
  guests = 1,
): ResolvedDay {
  if (!rules.bookingEnabled) return { date, state: 'unavailable', reason: null, periods: [] };

  const offset = daysBetween(venueNow(now).date, date);
  if (offset < 0 || offset >= rules.windowDays) return { date, state: 'outside', reason: null, periods: [] };

  const tooLarge = guests > rules.maxParty;
  const plan = planDay(rules, date);

  const periods: ResolvedPeriod[] = plan.periods.map((p) => ({
    ...p,
    slots: p.slots.map(({ time, capacity }): ResolvedSlot => {
      const taken = booked[time] ?? 0;
      const block: SlotBlock | undefined = p.closed
        ? 'closed'
        : (clockBlock(date, time, now, rules) ?? (tooLarge ? 'party' : taken + guests > capacity ? 'full' : undefined));
      return { time, capacity, booked: taken, left: Math.max(0, capacity - taken), bookable: block === undefined, ...(block ? { block } : {}) };
    }),
  }));

  const closedReason = periods.find((p) => p.closed && p.reason)?.reason ?? plan.wholeDayReason;
  return { date, ...dayState(periods, tooLarge, closedReason), periods };
}

function dayState(periods: ResolvedPeriod[], tooLarge: boolean, closedReason: string | null): { state: DayState; reason: string | null } {
  const open = periods.filter((p) => !p.closed).flatMap((p) => p.slots);
  if (open.length === 0) return { state: 'closed', reason: closedReason };
  if (tooLarge) return { state: 'too_large', reason: null };
  if (open.every((s) => s.block === 'lead' || s.block === 'cutoff')) return { state: 'past', reason: null };
  return { state: open.some((s) => s.bookable) ? 'open' : 'full', reason: null };
}

/** The period and slot a time belongs to on a resolved day, if any. */
export function findSlot(day: ResolvedDay, time: string): { period: ResolvedPeriod; slot: ResolvedSlot } | null {
  for (const period of day.periods) {
    const slot = period.slots.find((s) => s.time === time);
    if (slot) return { period, slot };
  }
  return null;
}

/** Day states for a calendar strip: from..to inclusive, a party of one. */
export function resolveRange(
  rules: BookingRules,
  from: IsoDate,
  to: IsoDate,
  now: Date,
  bookedByDate: Record<IsoDate, BookedCovers>,
): { date: IsoDate; state: DayState; reason?: string }[] {
  const out: { date: IsoDate; state: DayState; reason?: string }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const day = resolveDay(rules, d, now, bookedByDate[d] ?? {});
    out.push(day.reason ? { date: d, state: day.state, reason: day.reason } : { date: d, state: day.state });
  }
  return out;
}
```

- [ ] **Bước 6: Chạy lại test**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/booking/resolve-day.test.ts lib/venue-time.test.ts test/integration/booking-seed.test.ts`
Expected: PASS `Tests  44 passed (44)` (31 + 9 + 4)

- [ ] **Bước 7: Kiểm rằng test bắt được từng biên**

Làm lần lượt từng đột biến dưới đây, chạy lại lệnh của Bước 6, ghi số test đỏ, rồi **trả code về như cũ** trước đột biến kế tiếp (`git diff` phải sạch ở cả hai file khi xong). `global-setup` dựng lại DB test ở mỗi lần chạy, nên đột biến seed phải sửa chính file migration, không sửa DB.

| File | Đột biến (cũ → mới) | Mong đợi |
|---|---|---|
| `lib/booking/resolve-day.ts` | lead: `clock.minutes <= rules.leadMinutes` → `clock.minutes < rules.leadMinutes` | `Tests  7 failed` |
| `lib/booking/resolve-day.ts` | cutoff: `clock.minutes >= toMinutes(rules.sameDayCutoff)` → `>` | `Tests  2 failed` |
| `lib/booking/resolve-day.ts` | cửa sổ: `offset >= rules.windowDays` → `offset > rules.windowDays` | `Tests  4 failed` |
| `lib/booking/resolve-day.ts` | sức chứa: `taken + guests > capacity` → `taken + guests >= capacity` | `Tests  2 failed` |
| `lib/booking/resolve-day.ts` | ngày cuối: `date > c.endsOn` → `date >= c.endsOn` | `Tests  8 failed` |
| `lib/booking/resolve-day.ts` | phạm vi điểm đến: `return c.destinationId === rules.destinationId;` → `return c.destinationId !== null;` | `Tests  1 failed` |
| `db/migrations/006_booking_v2.sql` | seed Dinner: `time '21:00', 30, 40` → `time '20:30', 30, 40` | `Tests  2 failed` |
| `db/migrations/006_booking_v2.sql` | seed sức chứa: `r.slot_capacity, s.sort_order` → `r.slot_capacity + 1, s.sort_order` | `Tests  2 failed` |
| `db/migrations/006_booking_v2.sql` | seed thứ tự Lunch: `time '13:30', 30, 20` → `time '13:30', 30, 50` | `Tests  1 failed` |

- [ ] **Bước 8: Chạy cổng kiểm tra**

Chạy đủ khối lệnh ở "Cổng kiểm tra của mọi task".

Expected: typecheck không lỗi; lint thoát 0, 20 cảnh báo; `Test Files  44 passed (44)`, `Tests  430 passed (430)`; `Applied 6 migration(s).`; build và check-prerender như Task 1; E2E `70 passed`; visual `8 passed`.

- [ ] **Bước 9: Commit**

```bash
git add lib/venue-time.ts lib/venue-time.test.ts lib/booking/rules.ts lib/booking/resolve-day.ts lib/booking/resolve-day.test.ts test/integration/booking-seed.test.ts
git commit -m "$(cat <<'EOF'
feat: add the pure availability engine (resolveDay, planDay, clockBlock)

lib/booking/resolve-day.ts is spec §10.1 as pure, isomorphic functions.
planDay takes one date through steps 1–3 (the weekday's active periods,
closures, slots) without a clock, for the staff paths that may book past
the window or on a restaurant whose online booking is off. resolveDay adds
step 4 for guests: closed, lead, cut-off, party size, capacity, the window
and the booking switch. clockBlock is the clock half on its own, so the
guest form closes sittings with the server's own rule.

A slot is bookable while more than lead_minutes remain on the
minute-truncated Da Nang clock (phase 1's rule, and the exact reading of
"at least lead minutes" under truncation); the cut-off closes today only.

The seed test runs the phase-1 rule, written out from the raw restaurants
columns, against resolveDay over the seeded periods: more than 5000 slot
verdicts on every restaurant and weekday agree.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 3: Loader quy tắc sống và khóa ngày đặt bàn

Server đọc quy tắc của một hay nhiều nhà hàng trong một round trip, đếm chỗ đang giữ, và có đúng một hàm khóa ngày đặt bàn mà mọi đường ghi (khách ở Task 4, nhân viên ở Task 8) đều gọi.

**Files:**
- Create: `lib/server/booking/rules.ts`, `lib/server/booking/lock.ts`, `test/integration/booking-rules.test.ts`
- Modify: `lib/booking/rules.ts`

**Interfaces:**
- Consumes: `HOLDING_STATUSES`, `BookingRules`, `BookedCovers` từ `lib/booking/rules.ts` (Task 2); `getPool()` từ `db/client.ts`; bảng của Task 1.
- Produces:
  - `lib/booking/rules.ts`: `type GroupPhone = { display: string; tel: string }`.
  - `lib/server/booking/rules.ts` (`server-only`): `type Db = Pool | PoolClient`; `type LoadedRules = { rules: BookingRules; groupPhone: GroupPhone | null }`; `loadBookingRules(db: Db, restaurantIds: readonly string[], locale: string, from: IsoDate): Promise<Map<string, LoadedRules>>` (id lạ không có trong Map; thứ tự theo `restaurants.sort_order`); `loadRestaurantRules(db, restaurantId, locale, from): Promise<LoadedRules | null>`; `loadBookedCovers(db, restaurantId, from, to): Promise<Record<IsoDate, BookedCovers>>`.
  - `lib/server/booking/lock.ts` (`server-only`): `lockBookingDay(client: PoolClient, restaurantId: string, date: IsoDate, { timeout = '5s' }?: { timeout?: string }): Promise<void>`. Khóa là `pg_advisory_xact_lock(hashtextextended('booking:' || restaurantId || ':' || date, 0))`; hết giờ chờ thì Postgres ném lỗi mã `55P03`.

- [ ] **Bước 1: Viết test tích hợp**

Create `test/integration/booking-rules.test.ts`:

```ts
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import { lockBookingDay } from '@/lib/server/booking/lock';
import { loadBookedCovers, loadBookingRules, loadRestaurantRules } from '@/lib/server/booking/rules';

/* The live rule loaders (spec §10.1): booking_settings merged with the restaurant's overrides, its active periods, the closures that reach it. */

const sql = (text: string, values: unknown[] = []) => getPool().query(text, values);

const book = (restaurant: string, date: string, time: string, guests: number, status: string, phone: string) =>
  sql(
    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source, status)
     VALUES ('FC-' || substr(md5(random()::text), 1, 8), $1, $2, $3, 'Dinner', $4, 'An', $5, $5, 'web', $6)`,
    [restaurant, date, time, guests, phone, status],
  );

const closure = async (scope: string, target: { destination?: string; restaurant?: string }, from: string, to: string, meals: string[] | null = null) => {
  const { rows } = await sql(
    `INSERT INTO closures (scope, destination_id, restaurant_id, starts_on, ends_on, meals) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [scope, target.destination ?? null, target.restaurant ?? null, from, to, meals],
  );
  return rows[0].id as string;
};

describe.skipIf(!process.env.TEST_DATABASE_URL)('booking rule loaders (database)', () => {
  beforeEach(async () => {
    await sql('DELETE FROM reservations');
    await sql('DELETE FROM closures');
    await sql(`UPDATE locales SET is_enabled = false, serve_machine = false WHERE code = 'vi'`);
    await sql('UPDATE booking_settings SET window_days = 14, lead_minutes = 30, same_day_cutoff = NULL, max_party = 12, auto_confirm = false');
    await sql('UPDATE restaurants SET booking_enabled = true, window_days = NULL, lead_minutes = NULL, max_party = NULL, auto_confirm = NULL');
    await sql(`UPDATE service_periods SET active = true WHERE restaurant_id = 'taya-house'`);
  });
  afterAll(() => getPool().end());

  it('inherits booking_settings, and a restaurant override wins', async () => {
    await sql(`UPDATE booking_settings SET same_day_cutoff = '17:00', auto_confirm = true`);
    await sql(`UPDATE restaurants SET max_party = 8, lead_minutes = 60, auto_confirm = false, booking_enabled = false WHERE id = 'the-fan'`);
    const loaded = await loadBookingRules(getPool(), ['taya-house', 'the-fan', 'nowhere'], 'en', '2026-10-01');
    expect([...loaded.keys()]).toEqual(['taya-house', 'the-fan']);
    const pick = (id: string) => {
      const r = loaded.get(id)!.rules;
      return [r.bookingEnabled, r.windowDays, r.leadMinutes, r.sameDayCutoff, r.maxParty, r.autoConfirm];
    };
    expect(pick('taya-house')).toEqual([true, 14, 30, '17:00', 12, true]);
    // The cut-off is global only (spec §5.2 lists no per-restaurant override).
    expect(pick('the-fan')).toEqual([false, 14, 60, '17:00', 8, false]);
  });

  it('loads the active periods in sort order, times as HH:MM', async () => {
    const taya = (await loadRestaurantRules(getPool(), 'taya-house', 'en', '2026-10-01'))!.rules;
    expect(taya).toMatchObject({ restaurantId: 'taya-house', restaurantName: 'Tàya House', destinationId: 'resort' });
    expect(taya.periods.map((p) => [p.meal, p.weekdays, p.firstSeating, p.lastSeating, p.intervalMin, p.coversPerSlot, p.sortOrder])).toEqual([
      ['Lunch', [1, 2, 3, 4, 5, 6, 7], '11:30', '13:30', 30, 16, 20],
      ['Dinner', [1, 2, 3, 4, 5, 6, 7], '18:00', '21:00', 30, 16, 40],
    ]);
    await sql(`UPDATE service_periods SET active = false WHERE restaurant_id = 'taya-house' AND meal = 'Lunch'`);
    const after = (await loadRestaurantRules(getPool(), 'taya-house', 'en', '2026-10-01'))!.rules;
    expect(after.periods.map((p) => p.meal)).toEqual(['Dinner']);
    expect(await loadRestaurantRules(getPool(), 'nowhere', 'en', '2026-10-01')).toBeNull();
  });

  it('picks the closures that reach the restaurant and have not ended before `from`', async () => {
    await closure('all', {}, '2026-12-24', '2026-12-25');
    await closure('destination', { destination: 'resort' }, '2026-10-05', '2026-10-05', ['Dinner']);
    await closure('destination', { destination: 'dining-house' }, '2026-10-06', '2026-10-06');
    await closure('restaurant', { restaurant: 'taya-house' }, '2026-09-28', '2026-09-30');
    await closure('restaurant', { restaurant: 'taya-house' }, '2026-09-28', '2026-10-01');
    await closure('restaurant', { restaurant: 'pho-cuon' }, '2026-10-07', '2026-10-07');
    const taya = (await loadRestaurantRules(getPool(), 'taya-house', 'en', '2026-10-01'))!.rules;
    expect(taya.closures.map((c) => [c.scope, c.startsOn, c.endsOn, c.meals])).toEqual([
      ['restaurant', '2026-09-28', '2026-10-01', null],
      ['destination', '2026-10-05', '2026-10-05', ['Dinner']],
      ['all', '2026-12-24', '2026-12-25', null],
    ]);
    // A staff action on yesterday still sees yesterday's closures.
    const earlier = (await loadRestaurantRules(getPool(), 'taya-house', 'en', '2026-09-30'))!.rules;
    expect(earlier.closures).toHaveLength(4);
  });

  it('serves the reason in the guest’s language only when that language is on, else the default', async () => {
    const id = await closure('restaurant', { restaurant: 'taya-house' }, '2026-10-04', '2026-10-04');
    await sql(`INSERT INTO closure_i18n (closure_id, locale, public_reason) VALUES ($1, 'en', 'Private event'), ($1, 'vi', 'Sự kiện riêng')`, [id]);
    const reason = async (locale: string) => (await loadRestaurantRules(getPool(), 'taya-house', locale, '2026-10-01'))!.rules.closures[0].publicReason;
    // vi is off for the site: English, even though the vi row is reviewed.
    expect(await reason('vi')).toBe('Private event');
    await sql(`UPDATE locales SET is_enabled = true WHERE code = 'vi'`);
    expect(await reason('vi')).toBe('Sự kiện riêng');
    // A machine translation is served only with serve_machine on.
    await sql(`UPDATE closure_i18n SET status = 'machine' WHERE locale = 'vi'`);
    expect(await reason('vi')).toBe('Private event');
    await sql(`UPDATE locales SET serve_machine = true WHERE code = 'vi'`);
    expect(await reason('vi')).toBe('Sự kiện riêng');
    expect(await reason('xx')).toBe('Private event');
    // show_reason off: no reason in any language.
    await sql('UPDATE closures SET show_reason = false');
    expect(await reason('vi')).toBeNull();
  });

  it('gives each restaurant a group phone: its destination’s, else the first destination that has one', async () => {
    const loaded = await loadBookingRules(getPool(), ['taya-house', 'the-fan', 'yum-food-village'], 'en', '2026-10-01');
    expect(Object.fromEntries([...loaded].map(([id, l]) => [id, l.groupPhone]))).toEqual({
      'taya-house': { display: '+84 236 651 9999', tel: '+842366519999' },
      'the-fan': { display: '0859 555 759', tel: '+84859555759' },
      'yum-food-village': { display: '+84 236 651 9999', tel: '+842366519999' },
    });
  });

  it('counts covers per date and time over the holding statuses only', async () => {
    await book('taya-house', '2026-10-05', '19:00', 2, 'requested', '+84905000001');
    await book('taya-house', '2026-10-05', '19:00', 3, 'confirmed', '+84905000002');
    await book('taya-house', '2026-10-05', '19:00', 4, 'seated', '+84905000003');
    await book('taya-house', '2026-10-05', '19:00', 5, 'no_show', '+84905000004');
    await book('taya-house', '2026-10-05', '19:00', 6, 'cancelled', '+84905000005');
    await book('taya-house', '2026-10-05', '19:00', 7, 'declined', '+84905000006');
    await book('taya-house', '2026-10-06', '12:00', 2, 'requested', '+84905000007');
    await book('taya-house', '2026-10-08', '12:00', 2, 'requested', '+84905000008');
    await book('the-fan', '2026-10-05', '19:00', 2, 'requested', '+84905000009');
    expect(await loadBookedCovers(getPool(), 'taya-house', '2026-10-05', '2026-10-07')).toEqual({
      '2026-10-05': { '19:00': 9 },
      '2026-10-06': { '12:00': 2 },
    });
  });

  it('serialises one restaurant-day, and gives up after lock_timeout with 55P03', async () => {
    const other = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
    const holder = await getPool().connect();
    const waiter = await other.connect();
    try {
      await holder.query('BEGIN');
      await lockBookingDay(holder, 'taya-house', '2026-10-05');
      await waiter.query('BEGIN');
      // Another date of the same restaurant is a different lock.
      await lockBookingDay(waiter, 'taya-house', '2026-10-06', { timeout: '1s' });
      const started = Date.now();
      await expect(lockBookingDay(waiter, 'taya-house', '2026-10-05', { timeout: '1s' })).rejects.toMatchObject({ code: '55P03' });
      expect(Date.now() - started).toBeGreaterThanOrEqual(900);
      await waiter.query('ROLLBACK');
      await holder.query('COMMIT');
      // Released at COMMIT.
      await waiter.query('BEGIN');
      await lockBookingDay(waiter, 'taya-house', '2026-10-05', { timeout: '1s' });
      await waiter.query('COMMIT');
    } finally {
      holder.release();
      waiter.release();
      await other.end();
    }
  });
});
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/booking-rules.test.ts`
Expected: FAIL `Test Files  1 failed (1)`, `Tests  no tests`:

```
 FAIL  test/integration/booking-rules.test.ts [ test/integration/booking-rules.test.ts ]
Error: Cannot find package '@/lib/server/booking/lock' imported from …/test/integration/booking-rules.test.ts
```

- [ ] **Bước 3: Thêm kiểu số điện thoại cho nhóm lớn**

Sửa `lib/booking/rules.ts` đúng như diff sau:

```diff
diff --git a/lib/booking/rules.ts b/lib/booking/rules.ts
index b00022f..a368add 100644
--- a/lib/booking/rules.ts
+++ b/lib/booking/rules.ts
@@ -58,6 +58,9 @@ export type BookingRules = {
   closures: ClosureRule[];
 };
 
+/** The number guests call for a larger group (spec §10.2): a destination's phone until phase 6 adds restaurants.phone_*. */
+export type GroupPhone = { display: string; tel: string };
+
 /** Covers held per "HH:MM" on one date. */
 export type BookedCovers = Record<string, number>;
 
```

- [ ] **Bước 4: Viết khóa ngày đặt bàn**

Create `lib/server/booking/lock.ts`:

```ts
import 'server-only';
import type { PoolClient } from 'pg';
import type { IsoDate } from '@/lib/venue-time';

/*
 * The one booking-day lock (spec §10.2 step 6). Every write that takes covers
 * (guest submit, staff create, an edit that moves or grows a booking) calls
 * this first, on the client of its transaction, and only then reads the rules
 * and the covers. One key for every path, or guest and staff writes would
 * never wait for each other. At most one booking-day lock per transaction.
 */
export async function lockBookingDay(
  client: PoolClient,
  restaurantId: string,
  date: IsoDate,
  { timeout = '5s' }: { timeout?: string } = {},
): Promise<void> {
  // A stuck holder must not queue a whole day (and the pool's 5 connections)
  // forever: give up with 55P03, which reaches the guest as error.network.
  // set_config(…, true) is SET LOCAL with a bind parameter.
  await client.query(`SELECT set_config('lock_timeout', $1, true)`, [timeout]);
  // hashtextextended → bigint, the key space of pg_advisory_xact_lock; released at COMMIT or ROLLBACK.
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('booking:' || $1 || ':' || $2, 0))`, [restaurantId, date]);
}
```

- [ ] **Bước 5: Viết loader**

Một truy vấn cho mọi nhà hàng: quy tắc hiệu lực (`COALESCE` ghi đè với `booking_settings`), số gọi cho nhóm lớn, các ca đang bật (`json_agg`), các ngày đóng cửa với lý do theo ngôn ngữ. Lý do theo ngôn ngữ chỉ dùng khi ngôn ngữ đó đang bật (`l.is_enabled`): hàng `reviewed`, hoặc hàng `machine` khi `serve_machine`; nếu không thì hàng của ngôn ngữ mặc định.

Create `lib/server/booking/rules.ts`:

```ts
import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { HOLDING_STATUSES, type BookedCovers, type BookingRules, type GroupPhone } from '@/lib/booking/rules';
import type { IsoDate } from '@/lib/venue-time';

/*
 * The booking rules as resolveDay and planDay read them, loaded live. Nothing
 * here is cached (spec §6.2 "Không cache: đặt bàn, availability"): a 'use
 * cache' entry does not persist on serverless and is revalidated per instance
 * (node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache.md:247-252),
 * and submitReservation must re-read the rules under its lock anyway.
 *
 * Dates leave SQL through to_char: node-pg turns a `date` into a JS Date at
 * local midnight, which shifts the day on a UTC server.
 */

export type Db = Pool | PoolClient;

export type LoadedRules = { rules: BookingRules; groupPhone: GroupPhone | null };

type RulesRow = {
  id: string;
  name: string;
  destination: string;
  booking_enabled: boolean;
  window_days: number;
  lead_minutes: number;
  same_day_cutoff: string | null;
  max_party: number;
  auto_confirm: boolean;
  group_phone: GroupPhone | null;
  periods: BookingRules['periods'];
  closures: BookingRules['closures'];
};

/**
 * One round trip for any number of restaurants. `from` is the earliest date of
 * interest: closures that ended before it are left out. The closure reason is
 * the guest's language when that language is on (a reviewed row, or a machine
 * row with serve_machine), else the default language's; NULL when the closure
 * hides its reason. Unknown ids are simply missing from the map.
 */
export async function loadBookingRules(db: Db, restaurantIds: readonly string[], locale: string, from: IsoDate): Promise<Map<string, LoadedRules>> {
  const { rows } = await db.query<RulesRow>(
    `SELECT r.id, r.name, r.destination, r.booking_enabled,
            COALESCE(r.window_days, s.window_days)::int   AS window_days,
            COALESCE(r.lead_minutes, s.lead_minutes)::int AS lead_minutes,
            to_char(s.same_day_cutoff, 'HH24:MI')         AS same_day_cutoff,
            COALESCE(r.max_party, s.max_party)::int       AS max_party,
            COALESCE(r.auto_confirm, s.auto_confirm)      AS auto_confirm,
            (SELECT json_build_object('display', d.phone_display, 'tel', d.phone_e164)
               FROM destinations d
              WHERE d.phone_e164 IS NOT NULL
              ORDER BY (d.id = r.destination) DESC, d.sort_order, d.id
              LIMIT 1) AS group_phone,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'id', p.id::text, 'meal', p.meal, 'weekdays', p.weekdays,
                       'firstSeating', to_char(p.first_seating, 'HH24:MI'),
                       'lastSeating', to_char(p.last_seating, 'HH24:MI'),
                       'intervalMin', p.interval_min, 'coversPerSlot', p.covers_per_slot,
                       'sortOrder', p.sort_order)
                     ORDER BY p.sort_order, p.first_seating, p.id)
                FROM service_periods p
               WHERE p.restaurant_id = r.id AND p.active), '[]') AS periods,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'id', c.id::text, 'scope', c.scope,
                       'destinationId', c.destination_id, 'restaurantId', c.restaurant_id,
                       'startsOn', to_char(c.starts_on, 'YYYY-MM-DD'), 'endsOn', to_char(c.ends_on, 'YYYY-MM-DD'),
                       'meals', c.meals,
                       'publicReason', CASE WHEN c.show_reason THEN COALESCE(t.public_reason, d.public_reason) END)
                     ORDER BY c.starts_on, c.id)
                FROM closures c
                LEFT JOIN locales l ON l.code = $2 AND l.is_enabled
                LEFT JOIN closure_i18n t
                       ON t.closure_id = c.id AND t.locale = l.code AND (t.status = 'reviewed' OR l.serve_machine)
                LEFT JOIN closure_i18n d
                       ON d.closure_id = c.id AND d.locale = (SELECT code FROM locales WHERE is_default)
               WHERE c.ends_on >= $3::date
                 AND (c.scope = 'all'
                      OR (c.scope = 'destination' AND c.destination_id = r.destination)
                      OR (c.scope = 'restaurant' AND c.restaurant_id = r.id))), '[]') AS closures
       FROM restaurants r
      CROSS JOIN booking_settings s
      WHERE r.id = ANY ($1::text[])
      ORDER BY r.sort_order`,
    [restaurantIds, locale, from],
  );
  return new Map(
    rows.map((r) => [
      r.id,
      {
        rules: {
          restaurantId: r.id,
          restaurantName: r.name,
          destinationId: r.destination,
          bookingEnabled: r.booking_enabled,
          windowDays: r.window_days,
          leadMinutes: r.lead_minutes,
          sameDayCutoff: r.same_day_cutoff,
          maxParty: r.max_party,
          autoConfirm: r.auto_confirm,
          periods: r.periods,
          closures: r.closures,
        },
        groupPhone: r.group_phone,
      },
    ]),
  );
}

/** loadBookingRules for one restaurant; null when it does not exist. */
export async function loadRestaurantRules(db: Db, restaurantId: string, locale: string, from: IsoDate): Promise<LoadedRules | null> {
  return (await loadBookingRules(db, [restaurantId], locale, from)).get(restaurantId) ?? null;
}

/** Covers held per date and "HH:MM" for one restaurant, from..to inclusive (holding statuses only). */
export async function loadBookedCovers(db: Db, restaurantId: string, from: IsoDate, to: IsoDate): Promise<Record<IsoDate, BookedCovers>> {
  const { rows } = await db.query<{ day: string; reserved_at: string; covers: number }>(
    `SELECT to_char(reserved_on, 'YYYY-MM-DD') AS day, reserved_at, SUM(guests)::int AS covers
       FROM reservations
      WHERE restaurant_id = $1 AND reserved_on BETWEEN $2::date AND $3::date AND status = ANY ($4::text[])
      GROUP BY reserved_on, reserved_at`,
    [restaurantId, from, to, HOLDING_STATUSES],
  );
  const out: Record<IsoDate, BookedCovers> = {};
  for (const row of rows) (out[row.day] ??= {})[row.reserved_at] = row.covers;
  return out;
}
```

- [ ] **Bước 6: Chạy lại test**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/booking-rules.test.ts`
Expected: PASS `Tests  7 passed (7)`

- [ ] **Bước 7: Kiểm rằng test bắt được lỗi của loader**

Làm lần lượt, chạy lại lệnh của Bước 6, rồi trả `lib/server/booking/rules.ts` về như cũ:

| Đột biến (cũ → mới) | Mong đợi |
|---|---|
| `ON l.code = $2 AND l.is_enabled` → `ON l.code = $2` | `1 failed`: "serves the reason in the guest’s language only when that language is on, else the default" |
| `AND status = ANY ($4::text[])` → `AND status <> 'cancelled' AND $4::text[] IS NOT NULL` | `1 failed`: "counts covers per date and time over the holding statuses only" |
| `WHERE c.ends_on >= $3::date` → `WHERE c.starts_on >= $3::date` | `1 failed`: "picks the closures that reach the restaurant and have not ended before `from`" |

- [ ] **Bước 8: Chạy cổng kiểm tra**

Chạy đủ khối lệnh ở "Cổng kiểm tra của mọi task".

Expected: typecheck không lỗi; lint thoát 0, 20 cảnh báo; `Test Files  45 passed (45)`, `Tests  437 passed (437)`; `Applied 6 migration(s).`; build và check-prerender như Task 1; E2E `70 passed`; visual `8 passed`.

- [ ] **Bước 9: Commit**

```bash
git add lib/booking/rules.ts lib/server/booking/rules.ts lib/server/booking/lock.ts test/integration/booking-rules.test.ts
git commit -m "$(cat <<'EOF'
feat: load booking rules live and add the one booking-day lock

loadBookingRules reads any number of restaurants in one round trip:
booking_settings merged with each restaurant's overrides, its active
periods, the closures that reach it from a given date on, the closure
reason in the guest's language when that language is on (reviewed, or
machine with serve_machine), else the default's, and a group phone (the
destination's, else the first destination that has one). loadBookedCovers
counts the holding statuses only. Nothing is cached: spec §6.2, and the
action re-reads the rules under its lock anyway.

lockBookingDay is the single advisory lock every covers-taking write calls
first, keyed 'booking:<restaurant>:<date>', with a 5 s lock_timeout so a
stuck holder cannot queue a whole day on a pool of five.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 4: `submitReservation` v2 dưới khóa ngày đặt bàn

Spec §10.2 bước 2, 3, 4, 6 và 7 (không có outbox): zod trên một input `unknown`, E.164, rồi một transaction: `lockBookingDay` → đọc quy tắc và số chỗ → `resolveDay` → INSERT đặt bàn và sự kiện `created`. Đường đặt bàn của đợt 1 (kể cả cầu nối của Task 1) bị xóa.

**Files:**
- Create: `lib/booking/slot-code.ts`, `lib/booking/slot-code.test.ts`, `lib/server/booking/input.ts`, `lib/server/booking/input.test.ts`, `lib/server/booking/create.ts`
- Modify: `app/actions.ts`, `db/queries.ts`, `lib/booking-errors.ts`, `lib/booking-errors.test.ts`, `lib/i18n/registry.ts`, `lib/i18n/registry.test.ts`, `test/integration/submit-reservation.test.ts`, `e2e/booking-dates.spec.ts`
- Delete: `lib/server/check-reservation.ts`, `lib/server/check-reservation.test.ts`, `test/integration/reservations.test.ts` (các ca của chúng chuyển sang `submit-reservation.test.ts` và `input.test.ts`)

**Interfaces:**
- Consumes: `resolveDay`, `findSlot` (Task 2); `loadRestaurantRules`, `loadBookedCovers`, `lockBookingDay` (Task 3); `toE164` (`lib/phone.ts`); `newReference` (`lib/server/reference.ts`); `CONTACT` (`lib/data.ts`).
- Produces:
  - `BOOKING_ERROR_CODES` có thêm `'closed'` (sau `'full'`); key `error.closed`; `error.party_too_large` với vars `['max', 'phone']`; `error.past` mới.
  - `lib/booking/slot-code.ts`: `type SlotVerdict = { ok: true; period: ResolvedPeriod } | { ok: false; code: BookingErrorCode }`; `slotVerdict(day: ResolvedDay, time: string): SlotVerdict`.
  - `lib/server/booking/input.ts`: `type ReservationRequest = { restaurantId; date; time; guests; name; phone; phoneE164; email: string | null; note: string | null; locale: string }`; `type ParseResult`; `parseReservationInput(input: unknown): ParseResult`.
  - `lib/server/booking/create.ts`: `type CreateOutcome = { ok: true; id; reference; date; status: 'requested' | 'confirmed' } | { ok: false; code; params? }`; `type CreateOptions = { now?: Date; makeReference?: () => string; pool?: Pool }`; `createWebReservation(input: ReservationRequest, options?: CreateOptions): Promise<CreateOutcome>`.
  - `app/actions.ts`: `type ReservationResult = { ok: true; data: { reference; date; status } } | { ok: false; code; params? }`; `submitReservation(input: unknown): Promise<ReservationResult>`. Vẫn trong danh sách action công khai của guard.
  - `db/queries.ts`: `listRestaurants(): Promise<Restaurant[]>` không còn tham số; `createReservation`, `NewReservation`, `CreateResult` biến mất.

- [ ] **Bước 1: Viết test đơn vị cho mã lỗi và input**

Create `lib/booking/slot-code.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { slotVerdict } from './slot-code';
import type { ResolvedDay } from './rules';

const day = (over: Partial<ResolvedDay> = {}): ResolvedDay => ({
  date: '2026-10-05',
  state: 'open',
  reason: null,
  periods: [
    {
      periodId: '1',
      meal: 'Dinner',
      closed: false,
      reason: null,
      slots: [
        { time: '18:00', capacity: 16, booked: 0, left: 16, bookable: true },
        { time: '18:30', capacity: 16, booked: 16, left: 0, bookable: false, block: 'full' },
        { time: '19:00', capacity: 16, booked: 0, left: 16, bookable: false, block: 'lead' },
        { time: '19:30', capacity: 16, booked: 0, left: 16, bookable: false, block: 'cutoff' },
        { time: '20:00', capacity: 16, booked: 0, left: 16, bookable: false, block: 'closed' },
      ],
    },
  ],
  ...over,
});

const code = (d: ResolvedDay, time: string) => {
  const v = slotVerdict(d, time);
  return v.ok ? `ok:${v.period.meal}` : v.code;
};

describe('slotVerdict', () => {
  it('maps a slot to the guest error codes', () => {
    expect(['18:00', '18:30', '19:00', '19:30', '20:00', '15:00'].map((t) => code(day(), t))).toEqual([
      'ok:Dinner', 'full', 'past', 'past', 'closed', 'slot_unavailable',
    ]);
  });

  it('lets the day state speak first', () => {
    expect(code(day({ state: 'unavailable' }), '18:00')).toBe('restaurant_unavailable');
    expect(code(day({ state: 'outside' }), '18:00')).toBe('outside_window');
    expect(code(day({ state: 'too_large' }), '18:00')).toBe('party_too_large');
  });

  it('answers closed for any time on a day with no service', () => {
    expect(code(day({ state: 'closed', periods: [] }), '18:00')).toBe('closed');
  });
});
```

Create `lib/server/booking/input.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseReservationInput } from './input';

const valid = {
  restaurant: 'taya-house',
  date: '2026-10-05',
  time: '19:00',
  guests: 2,
  name: '  Nguyễn Minh Anh ',
  phone: '0905 000 000',
  email: '',
  note: ' window seat ',
};

describe('parseReservationInput', () => {
  it('trims, normalises the phone and defaults the locale', () => {
    expect(parseReservationInput(valid)).toEqual({
      ok: true,
      value: {
        restaurantId: 'taya-house',
        date: '2026-10-05',
        time: '19:00',
        guests: 2,
        name: 'Nguyễn Minh Anh',
        phone: '0905 000 000',
        phoneE164: '+84905000000',
        email: null,
        note: 'window seat',
        locale: 'en',
      },
    });
  });

  it.each([
    [{ restaurant: '' }, 'restaurant_unavailable'],
    [{ date: '2026-02-30' }, 'outside_window'],
    [{ date: '05/10/2026' }, 'outside_window'],
    [{ time: '19:5' }, 'slot_unavailable'],
    [{ guests: '2' }, 'unknown'],
    [{ guests: 0 }, 'unknown'],
    [{ name: 'A' }, 'invalid_name'],
    [{ phone: '12 34' }, 'invalid_phone'],
    [{ phone: '0000 0000 00' }, 'invalid_phone'],
    [{ email: 'a@b' }, 'invalid_email'],
    [{ note: 'x'.repeat(1001) }, 'unknown'],
    [{ locale: 'x'.repeat(36) }, 'unknown'],
  ])('%j → %s', (over, code) => {
    expect(parseReservationInput({ ...valid, ...over })).toEqual({ ok: false, code });
  });

  it('reports the first bad field in form order', () => {
    expect(parseReservationInput({ ...valid, name: '', phone: '', email: 'x' })).toEqual({ ok: false, code: 'invalid_name' });
  });

  it('leaves a large party to max_party (no upper bound here)', () => {
    expect(parseReservationInput({ ...valid, guests: 40 })).toMatchObject({ ok: true, value: { guests: 40 } });
  });

  it('refuses anything that is not the form object', () => {
    expect(parseReservationInput(null)).toEqual({ ok: false, code: 'unknown' });
    expect(parseReservationInput('taya-house')).toEqual({ ok: false, code: 'unknown' });
  });
});
```

- [ ] **Bước 2: Viết test tích hợp cho `submitReservation`**

Viết lại toàn bộ `test/integration/submit-reservation.test.ts`. Hai test về đồng thời là RED của task này: cuộc đua 12 nhóm cho 6 chỗ cuối, và một pool thứ hai (đóng vai instance khác) giữ đúng khóa `booking:taya-house:2026-10-02` bằng SQL thô.

```ts
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { submitReservation } from '@/app/actions';
import { getPool } from '@/db/client';
import { createWebReservation } from '@/lib/server/booking/create';
import { parseReservationInput, type ReservationRequest } from '@/lib/server/booking/input';

const request = {
  restaurant: 'taya-house',
  date: '2026-10-02',
  time: '19:00',
  guests: 2,
  name: 'Nguyễn Minh Anh',
  phone: '0905 000 000',
  email: '',
  note: '',
};

const sql = (text: string, values: unknown[] = []) => getPool().query(text, values);
const phone = (i: number) => `0905 ${String(100000 + i).slice(0, 3)} ${String(100000 + i).slice(3)}`;
/** The group phone party_too_large carries: the resort's, Tàya's destination. */
const RESORT_PHONE = '+84 236 651 9999';

/** A parsed request, for calling createWebReservation directly. */
function parsed(over: Partial<typeof request> = {}): ReservationRequest {
  const result = parseReservationInput({ ...request, ...over });
  if (!result.ok) throw new Error(result.code);
  return result.value;
}

/** Opens `n` pool connections and runs a query on each, so parallel calls start together. */
async function warmPool(n: number) {
  const clients = await Promise.all(Array.from({ length: n }, () => getPool().connect()));
  await Promise.all(clients.map((c) => c.query('SELECT (SELECT count(*) FROM restaurants), (SELECT count(*) FROM reservations)')));
  clients.forEach((c) => c.release());
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('submitReservation v2 (database)', () => {
  beforeEach(async () => {
    await sql('DELETE FROM reservations');
    await sql('DELETE FROM closures');
    await sql('UPDATE restaurants SET booking_enabled = true, max_party = NULL, auto_confirm = NULL, lead_minutes = NULL, window_days = NULL');
    await sql('UPDATE booking_settings SET window_days = 14, lead_minutes = 30, max_party = 12, auto_confirm = false, same_day_cutoff = NULL');
    await sql(`UPDATE locales SET is_enabled = false, serve_machine = false WHERE code = 'vi'`);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T18:00:00Z')); // 01:00 on 2 Oct in Da Nang, server on UTC
  });
  afterEach(() => vi.useRealTimers());
  afterAll(() => getPool().end());

  it('stores the Da Nang date, the meal, the source, both phone forms and a created event', async () => {
    const result = await submitReservation({ ...request, email: 'An@Example.com', locale: 'en' });
    expect(result).toMatchObject({ ok: true, data: { date: '2026-10-02', status: 'requested' } });
    const reference = result.ok ? result.data.reference : '';
    expect(reference).toMatch(/^FC-[0-9A-HJKMNP-TV-Z]{8}$/);
    const { rows } = await sql(
      `SELECT to_char(reserved_on, 'YYYY-MM-DD') AS day, meal, source, locale, status, phone, phone_e164, search_text, version, is_test, confirmed_at
         FROM reservations`,
    );
    expect(rows).toEqual([
      {
        day: '2026-10-02', meal: 'Dinner', source: 'web', locale: 'en', status: 'requested', phone: '0905 000 000', phone_e164: '+84905000000',
        search_text: `nguyen minh anh an@example.com ${reference.toLowerCase()} 84905000000 0905000000`,
        version: 1, is_test: false, confirmed_at: null,
      },
    ]);
    const events = await sql(`SELECT actor_kind, actor_id, type, from_status, to_status FROM reservation_events`);
    expect(events.rows).toEqual([{ actor_kind: 'guest', actor_id: null, type: 'created', from_status: null, to_status: 'requested' }]);
  });

  it('falls back to the default language for an unknown or disabled locale', async () => {
    await submitReservation({ ...request, locale: 'vi' }); // vi exists but is disabled
    await submitReservation({ ...request, time: '19:30', locale: 'zz' });
    expect((await sql('SELECT DISTINCT locale FROM reservations')).rows).toEqual([{ locale: 'en' }]);
  });

  it('confirms at once under auto_confirm, globally or per restaurant', async () => {
    await sql(`UPDATE restaurants SET auto_confirm = true WHERE id = 'taya-house'`);
    expect(await submitReservation(request)).toMatchObject({ ok: true, data: { status: 'confirmed' } });
    await sql(`UPDATE restaurants SET auto_confirm = false WHERE id = 'taya-house'`);
    await sql(`UPDATE booking_settings SET auto_confirm = true`);
    expect(await submitReservation({ ...request, time: '19:30' })).toMatchObject({ ok: true, data: { status: 'requested' } });
    const { rows } = await sql(`SELECT status, confirmed_at IS NOT NULL AS stamped FROM reservations ORDER BY id`);
    expect(rows).toEqual([{ status: 'confirmed', stamped: true }, { status: 'requested', stamped: false }]);
    expect((await sql(`SELECT to_status FROM reservation_events ORDER BY id`)).rows.map((r) => r.to_status)).toEqual(['confirmed', 'requested']);
  });

  it('answers with codes, never English copy', async () => {
    expect(await submitReservation({ ...request, guests: 40 })).toEqual({ ok: false, code: 'party_too_large', params: { max: '12', phone: RESORT_PHONE } });
    expect(await submitReservation({ ...request, date: '2026-10-16' })).toEqual({ ok: false, code: 'outside_window' });
    expect(await submitReservation({ ...request, date: '2026-10-01' })).toEqual({ ok: false, code: 'outside_window' });
    expect(await submitReservation({ ...request, time: '15:00' })).toEqual({
      ok: false, code: 'slot_unavailable', params: { restaurant: 'Tàya House' },
    });
    expect(await submitReservation({ ...request, restaurant: 'nowhere' })).toEqual({ ok: false, code: 'restaurant_unavailable' });
    await submitReservation(request);
    expect(await submitReservation({ ...request, phone: '+84 905 000 000' })).toEqual({ ok: false, code: 'duplicate' });
  });

  it('maps bad input to the field codes', async () => {
    const code = async (over: Record<string, unknown>) => {
      const r = await submitReservation({ ...request, ...over });
      return r.ok ? 'ok' : r.code;
    };
    expect(await code({ name: 'A' })).toBe('invalid_name');
    expect(await code({ phone: '1234' })).toBe('invalid_phone');
    expect(await code({ phone: '0000 0000 00' })).toBe('invalid_phone'); // eight digits, not a number
    expect(await code({ email: 'not-an-email' })).toBe('invalid_email');
    expect(await code({ date: '2026-02-30' })).toBe('outside_window');
    expect(await code({ time: '7pm' })).toBe('slot_unavailable');
    expect(await code({ guests: 0 })).toBe('unknown');
    expect(await code({ guests: 2.5 })).toBe('unknown');
    expect(await code({ note: 'x'.repeat(1001) })).toBe('unknown');
    expect(await submitReservation(null)).toEqual({ ok: false, code: 'unknown' });
    expect((await sql('SELECT count(*)::int AS n FROM reservations')).rows[0].n).toBe(0);
  });

  it('blocks a ninth guest when max_party is 8', async () => {
    await sql(`UPDATE restaurants SET max_party = 8 WHERE id = 'taya-house'`);
    expect(await submitReservation({ ...request, guests: 9 })).toEqual({ ok: false, code: 'party_too_large', params: { max: '8', phone: RESORT_PHONE } });
    // A Dining House restaurant names its own destination's number.
    await sql(`UPDATE restaurants SET max_party = 8 WHERE id = 'the-fan'`);
    expect(await submitReservation({ ...request, restaurant: 'the-fan', guests: 9 })).toEqual({
      ok: false, code: 'party_too_large', params: { max: '8', phone: '0859 555 759' },
    });
    expect(await submitReservation({ ...request, guests: 8 })).toMatchObject({ ok: true });
  });

  it('refuses a restaurant whose online booking is off', async () => {
    await sql(`UPDATE restaurants SET booking_enabled = false WHERE id = 'taya-house'`);
    expect(await submitReservation(request)).toEqual({ ok: false, code: 'restaurant_unavailable' });
  });

  it('refuses a closed service and keeps the others open', async () => {
    await sql(
      `INSERT INTO closures (scope, destination_id, starts_on, ends_on, meals) VALUES ('destination', 'resort', '2026-10-02', '2026-10-02', '{Dinner}')`,
    );
    expect(await submitReservation(request)).toEqual({ ok: false, code: 'closed' });
    expect(await submitReservation({ ...request, time: '12:00' })).toMatchObject({ ok: true });
    await sql(`INSERT INTO closures (scope, starts_on, ends_on) VALUES ('all', '2026-10-03', '2026-10-03')`);
    expect(await submitReservation({ ...request, date: '2026-10-03', time: '12:00' })).toEqual({ ok: false, code: 'closed' });
  });

  it('closes a sitting by Da Nang time: lead time and same-day cut-off', async () => {
    vi.setSystemTime(new Date('2026-10-02T12:00:00Z')); // 19:00 in Da Nang
    expect(await submitReservation({ ...request, time: '19:30' })).toEqual({ ok: false, code: 'past' });
    expect(await submitReservation({ ...request, time: '20:00' })).toMatchObject({ ok: true });
    await sql(`UPDATE booking_settings SET same_day_cutoff = '18:00'`);
    expect(await submitReservation({ ...request, time: '20:30' })).toEqual({ ok: false, code: 'past' });
    expect(await submitReservation({ ...request, date: '2026-10-03', time: '20:30' })).toMatchObject({ ok: true });
  });

  it('counts requested, confirmed and seated covers, not cancelled, declined or no-show ones', async () => {
    const insert = (status: string, guests: number, i: number) =>
      sql(
        `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source, status)
         VALUES ($1, 'taya-house', '2026-10-02', '19:00', 'Dinner', $2, 'G', 'x', $3, 'phone', $4)`,
        [`FC-TEST000${i}`, guests, `+8490500010${i}`, status],
      );
    await insert('requested', 4, 1);
    await insert('confirmed', 4, 2);
    await insert('seated', 4, 3);
    await insert('cancelled', 12, 4);
    await insert('declined', 12, 5);
    await insert('no_show', 12, 6);
    expect(await submitReservation({ ...request, guests: 5 })).toEqual({ ok: false, code: 'full' });
    expect(await submitReservation({ ...request, guests: 4 })).toMatchObject({ ok: true });
  });

  it('never seats more than the slot holds when many guests race for the last covers', async () => {
    // 16 covers at 19:00; 10 held. Twelve parties of two race for the last 6.
    await sql(
      `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source)
       VALUES ('FC-HELD0001', 'taya-house', '2026-10-02', '19:00', 'Dinner', 10, 'Held', 'x', '+84905999999', 'web')`,
    );
    await warmPool(5);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => submitReservation({ ...request, phone: phone(i) })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results.filter((r) => !r.ok).map((r) => (r.ok ? '' : r.code))).toEqual(Array(9).fill('full'));
    const { rows } = await sql(
      `SELECT sum(guests)::int AS covers FROM reservations WHERE reserved_at = '19:00' AND status IN ('requested', 'confirmed', 'seated')`,
    );
    expect(rows[0].covers).toBe(16);
  });

  it('waits for another instance holding the (restaurant, date) lock, then re-reads the covers', async () => {
    // A second pool plays a second server instance. It takes the same advisory
    // lock, fills the slot and commits; the guest's request must queue behind
    // it and then see the slot full. Another date is not held up.
    const { Pool } = await import('pg');
    const other = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
    const holder = await other.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT pg_advisory_xact_lock(hashtextextended('booking:' || $1 || ':' || $2, 0))`, ['taya-house', '2026-10-02']);
      let settled = false;
      const pending = submitReservation(request).finally(() => {
        settled = true;
      });
      expect(await submitReservation({ ...request, date: '2026-10-03' })).toMatchObject({ ok: true });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      await holder.query(
        `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source)
         VALUES ('FC-OTHER001', 'taya-house', '2026-10-02', '19:00', 'Dinner', 15, 'Other', 'x', '+84905888888', 'phone')`,
      );
      await holder.query('COMMIT');
      expect(await pending).toEqual({ ok: false, code: 'full' });
    } finally {
      holder.release();
      await other.end();
    }
  });

  it('turns the second of two simultaneous identical requests into duplicate', async () => {
    await warmPool(2);
    const [a, b] = await Promise.all([submitReservation(request), submitReservation({ ...request, phone: '+84905000000' })]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)).toEqual({ ok: false, code: 'duplicate' });
  });

  it('draws a new reference when the first one is already taken, three times at most', async () => {
    await createWebReservation(parsed(), { makeReference: () => 'FC-AAAAAAAA' });
    const queue = ['FC-AAAAAAAA', 'FC-BBBBBBBB'];
    expect(await createWebReservation(parsed({ phone: phone(1) }), { makeReference: () => queue.shift() ?? 'FC-CCCCCCCC' })).toMatchObject({
      ok: true, reference: 'FC-BBBBBBBB',
    });
    await expect(createWebReservation(parsed({ phone: phone(2) }), { makeReference: () => 'FC-AAAAAAAA' })).rejects.toThrow(
      /reservations_reference_key/,
    );
    expect((await sql('SELECT count(*)::int AS n FROM reservation_events')).rows[0].n).toBe(2);
  });
});
```

- [ ] **Bước 3: Đổi test của chữ báo lỗi**

```diff
diff --git a/lib/booking-errors.test.ts b/lib/booking-errors.test.ts
index 74d183a..d6bd5d6 100644
--- a/lib/booking-errors.test.ts
+++ b/lib/booking-errors.test.ts
@@ -17,6 +17,18 @@ describe('bookingErrorMessage', () => {
   it('falls back to a generic subject when the restaurant is not given', () => {
     expect(bookingErrorMessage('slot_unavailable')).toBe('The restaurant does not serve at that time.');
   });
+
+  it('gives the party limit and the number to call, with defaults when the server sent none', () => {
+    expect(bookingErrorMessage('party_too_large', { max: '8', phone: '0859 555 759' })).toBe(
+      'For more than 8 guests, please call us on 0859 555 759.',
+    );
+    expect(bookingErrorMessage('party_too_large')).toBe('For more than 12 guests, please call us on +84 236 651 9999.');
+  });
+
+  it('says the restaurant is closed, and that a sitting can no longer be booked for either clock rule', () => {
+    expect(bookingErrorMessage('closed')).toBe('The restaurant is closed on that date — please choose another day.');
+    expect(bookingErrorMessage('past')).toBe('That time can no longer be booked online — please choose a later time or another day.');
+  });
 });
 
 describe('bookingErrorMessage with resolved strings', () => {
```

```diff
diff --git a/lib/i18n/registry.test.ts b/lib/i18n/registry.test.ts
index 48b3ade..2a70802 100644
--- a/lib/i18n/registry.test.ts
+++ b/lib/i18n/registry.test.ts
@@ -36,7 +36,7 @@ describe('resolveStrings', () => {
   it('uses the default-language row, else the registry', () => {
     const out = resolveStrings([{ key: 'error.full', locale: 'en', value: 'Sold out.' }], keys, 'en', 'en');
     expect(out['error.full']).toBe('Sold out.');
-    expect(out['error.past']).toContain('already started');
+    expect(out['error.past']).toContain('can no longer be booked online');
   });
   it('falls back per key: a missing vi row shows the English row, not an empty string', () => {
     const rows = [
```

`error.past` mới cũng là chữ mà E2E đợt 1 chờ khi giờ ngồi đã đóng trong lúc khách điền form:

```diff
diff --git a/e2e/booking-dates.spec.ts b/e2e/booking-dates.spec.ts
index 63eef43..f0d1b85 100644
--- a/e2e/booking-dates.spec.ts
+++ b/e2e/booking-dates.spec.ts
@@ -142,7 +142,7 @@ test('submitting after the chosen sitting has closed explains why and moves the
   await page.getByRole('button', { name: 'REQUEST BOOKING' }).click();
 
   await expect(page.locator('.drawer-error[role="alert"]')).toHaveText(
-    'That sitting has already started — please pick a later time.',
+    'That time can no longer be booked online — please choose a later time or another day.',
   );
   await expect(page.locator('.drawer-done')).toHaveCount(0);
   expect(reachedServer).toBe(false);
```

- [ ] **Bước 4: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/server/booking/input.test.ts lib/booking/slot-code.test.ts test/integration/submit-reservation.test.ts lib/booking-errors.test.ts lib/i18n/registry.test.ts`
Expected: FAIL `Test Files  5 failed (5)`, `Tests  3 failed | 19 passed (22)`:

```
 FAIL  test/integration/submit-reservation.test.ts [ test/integration/submit-reservation.test.ts ]
Error: Cannot find package '@/lib/server/booking/create' imported from …/test/integration/submit-reservation.test.ts
 FAIL  lib/booking/slot-code.test.ts [ lib/booking/slot-code.test.ts ]
Error: Cannot find module './slot-code' imported from …/lib/booking/slot-code.test.ts
 FAIL  lib/server/booking/input.test.ts [ lib/server/booking/input.test.ts ]
Error: Cannot find module './input' imported from …/lib/server/booking/input.test.ts
 FAIL  lib/booking-errors.test.ts > bookingErrorMessage > gives the party limit and the number to call, with defaults when the server sent none
AssertionError: expected 'Please choose between 1 and 12 guests.' to be 'For more than 8 guests, please call u…' // Object.is equality
 FAIL  lib/booking-errors.test.ts > bookingErrorMessage > says the restaurant is closed, and that a sitting can no longer be booked for either clock rule
TypeError: Cannot read properties of undefined (reading 'replace')
 FAIL  lib/i18n/registry.test.ts > resolveStrings > uses the default-language row, else the registry
AssertionError: expected 'That sitting has already started — pl…' to contain 'can no longer be booked online'
```

- [ ] **Bước 5: Thêm mã `closed` và chữ mới**

`DEFAULT_PARAMS` lấp `{max}` và `{phone}` khi một câu báo đến mà không có tham số (server luôn gửi chúng cho `party_too_large`).

```diff
diff --git a/lib/booking-errors.ts b/lib/booking-errors.ts
index 96d196c..d44154c 100644
--- a/lib/booking-errors.ts
+++ b/lib/booking-errors.ts
@@ -3,6 +3,7 @@
  * codes; the browser turns them into copy. The copy lives in the content
  * registry (lib/i18n/registry.ts) as error.<code>, so the DB can override it.
  */
+import { CONTACT } from '@/lib/data';
 import { formatMessage } from '@/lib/i18n/format';
 import { REGISTRY } from '@/lib/i18n/registry';
 
@@ -16,6 +17,7 @@ export const BOOKING_ERROR_CODES = [
   'invalid_phone',
   'invalid_email',
   'full',
+  'closed',
   'duplicate',
   'unknown',
   'network',
@@ -32,7 +34,8 @@ export const DEFAULT_ERROR_STRINGS = Object.fromEntries(
   BOOKING_ERROR_CODES.map((code) => [`error.${code}`, REGISTRY[`error.${code}`].en]),
 ) as ErrorStrings;
 
-const DEFAULT_PARAMS: Record<string, string> = { restaurant: 'The restaurant' };
+/** Used when a message arrives without its params (the server always sends them for slot_unavailable and party_too_large). */
+const DEFAULT_PARAMS: Record<string, string> = { restaurant: 'The restaurant', max: '12', phone: CONTACT.resortPhoneLabel };
 
 export function bookingErrorMessage(
   code: BookingErrorCode,
```

```diff
diff --git a/lib/i18n/registry.ts b/lib/i18n/registry.ts
index e3deccb..ba079a4 100644
--- a/lib/i18n/registry.ts
+++ b/lib/i18n/registry.ts
@@ -41,9 +41,11 @@ export const REGISTRY = {
     screen: 'ui-text',
   },
   'error.party_too_large': {
-    en: 'Please choose between 1 and 12 guests.',
+    en: 'For more than {max} guests, please call us on {phone}.',
     maxLength: 140,
-    context: 'Party size above the online limit. The numbers will become variables once the limit is configurable.',
+    vars: ['max', 'phone'],
+    context:
+      'Party size above the online limit. {max} is the largest party bookable online (booking rules), {phone} the restaurant’s number for larger groups; keep both as is.',
     screen: 'ui-text',
   },
   'error.outside_window': {
@@ -60,9 +62,10 @@ export const REGISTRY = {
     screen: 'ui-text',
   },
   'error.past': {
-    en: 'That sitting has already started — please pick a later time.',
+    en: 'That time can no longer be booked online — please choose a later time or another day.',
     maxLength: 140,
-    context: 'The chosen sitting has started or ended.',
+    context:
+      'The chosen sitting is too close to book online (the lead time before it), or online booking for today has closed (the same-day cut-off). Must read right for both.',
     screen: 'ui-text',
   },
   'error.invalid_name': {
@@ -95,6 +98,12 @@ export const REGISTRY = {
     context: 'The same phone number already has an active request for this restaurant, date and time.',
     screen: 'ui-text',
   },
+  'error.closed': {
+    en: 'The restaurant is closed on that date — please choose another day.',
+    maxLength: 140,
+    context: 'A closure, or a day without service, covers the chosen date or meal.',
+    screen: 'ui-text',
+  },
   'error.unknown': {
     en: 'Something went wrong with your request. Please try again.',
     maxLength: 140,
```

- [ ] **Bước 6: Viết ánh xạ mã lỗi và phần đọc input**

Create `lib/booking/slot-code.ts`:

```ts
import type { BookingErrorCode } from '@/lib/booking-errors';
import { findSlot } from './resolve-day';
import type { DayState, ResolvedDay, ResolvedPeriod, SlotBlock } from './rules';

/*
 * Whether a party can have `time` on a resolved day, and if not, why, as the
 * guest error codes of spec §10.2. submitReservation answers with these.
 */

const DAY_CODES: Partial<Record<DayState, BookingErrorCode>> = {
  unavailable: 'restaurant_unavailable',
  outside: 'outside_window',
  too_large: 'party_too_large',
};

const SLOT_CODES: Record<SlotBlock, BookingErrorCode> = {
  closed: 'closed',
  lead: 'past',
  cutoff: 'past',
  party: 'party_too_large',
  full: 'full',
};

export type SlotVerdict =
  | { ok: true; period: ResolvedPeriod }
  | { ok: false; code: BookingErrorCode };

export function slotVerdict(day: ResolvedDay, time: string): SlotVerdict {
  const dayCode = DAY_CODES[day.state];
  if (dayCode) return { ok: false, code: dayCode };
  const hit = findSlot(day, time);
  if (!hit) return { ok: false, code: day.state === 'closed' ? 'closed' : 'slot_unavailable' };
  if (hit.slot.block) return { ok: false, code: SLOT_CODES[hit.slot.block] };
  return { ok: true, period: hit.period };
}
```

Create `lib/server/booking/input.ts`:

```ts
import 'server-only';
import * as z from 'zod';
import type { BookingErrorCode } from '@/lib/booking-errors';
import { toE164 } from '@/lib/phone';
import { isValidIsoDate, type IsoDate } from '@/lib/venue-time';

/*
 * Step 2 of submitReservation (spec §10.2): the shape of what the reserve
 * drawer sends. It arrives over the wire, so nothing is trusted; a field that
 * fails maps to the error code the guest form already knows. Rules that need
 * the database (window, lead time, max_party, capacity) run later, in the
 * transaction, through resolveDay.
 */

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

const schema = z.object({
  restaurant: z.string().min(1).max(64),
  date: z.string().refine(isValidIsoDate),
  time: z.string().regex(HHMM),
  // No upper bound here: max_party decides, and answers party_too_large.
  guests: z.number().int().min(1),
  name: z.string().trim().min(2).max(120),
  phone: z
    .string()
    .trim()
    .max(40)
    .refine((p) => p.replace(/\D/g, '').length >= 8),
  email: z
    .string()
    .trim()
    .max(254)
    .refine((e) => e === '' || /^\S+@\S+\.\S+$/.test(e)),
  note: z.string().trim().max(1000),
  /** The URL locale the guest booked in; unknown or disabled codes fall back to the default. */
  locale: z.string().max(35).optional(),
});

/** First failing field → the code the drawer shows. Order follows the form, top to bottom. */
const FIELD_CODES: [field: string, code: BookingErrorCode][] = [
  ['restaurant', 'restaurant_unavailable'],
  ['date', 'outside_window'],
  ['time', 'slot_unavailable'],
  ['guests', 'unknown'],
  ['name', 'invalid_name'],
  ['phone', 'invalid_phone'],
  ['email', 'invalid_email'],
  ['note', 'unknown'],
  ['locale', 'unknown'],
];

export type ReservationRequest = {
  restaurantId: string;
  date: IsoDate;
  time: string;
  guests: number;
  name: string;
  /** As the guest typed it. */
  phone: string;
  /** Canonical form; the duplicate check keys on it. */
  phoneE164: string;
  email: string | null;
  note: string | null;
  locale: string;
};

export type ParseResult = { ok: true; value: ReservationRequest } | { ok: false; code: BookingErrorCode };

export function parseReservationInput(input: unknown): ParseResult {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const failed = new Set(parsed.error.issues.map((i) => String(i.path[0])));
    return { ok: false, code: FIELD_CODES.find(([field]) => failed.has(field))?.[1] ?? 'unknown' };
  }
  const v = parsed.data;
  // Step 4: E.164, Vietnamese numbers by default.
  const phoneE164 = toE164(v.phone);
  if (!phoneE164) return { ok: false, code: 'invalid_phone' };
  return {
    ok: true,
    value: {
      restaurantId: v.restaurant,
      date: v.date,
      time: v.time,
      guests: v.guests,
      name: v.name,
      phone: v.phone,
      phoneE164,
      email: v.email || null,
      note: v.note || null,
      locale: v.locale ?? 'en',
    },
  };
}
```

- [ ] **Bước 7: Viết phần ghi có khóa và action; xóa đường đặt bàn cũ**

Create `lib/server/booking/create.ts`. Khóa đứng đầu transaction; quy tắc và số chỗ đọc sau nó trên cùng client. INSERT không đặt `search_text`, `version`, `updated_at` (trigger làm). `reservations_dedupe_v2_idx` → `duplicate`; `reservations_reference_key` → bốc lại mã, tối đa 3 lần.

```ts
import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { getPool } from '@/db/client';
import { resolveDay } from '@/lib/booking/resolve-day';
import { slotVerdict } from '@/lib/booking/slot-code';
import type { BookingErrorCode } from '@/lib/booking-errors';
import { newReference } from '@/lib/server/reference';
import { venueNow, type IsoDate } from '@/lib/venue-time';
import type { ReservationRequest } from './input';
import { lockBookingDay } from './lock';
import { loadBookedCovers, loadRestaurantRules } from './rules';

/*
 * Step 6 of submitReservation (spec §10.2): one transaction that takes the
 * booking-day lock, re-reads the rules and the covers, re-runs resolveDay,
 * and inserts the booking with its 'created' event. The outbox rows of step 6
 * and after() of step 7 arrive in phase 5.
 */

export type CreateOutcome =
  | { ok: true; id: string; reference: string; date: IsoDate; status: 'requested' | 'confirmed' }
  | { ok: false; code: BookingErrorCode; params?: Record<string, string> };

export type CreateOptions = {
  now?: Date;
  makeReference?: () => string;
  /** Tests pass a second pool to play a second server instance. */
  pool?: Pool;
};

const REFERENCE_ATTEMPTS = 3;

/** The unique constraint a Postgres error violated, if it is one. */
function violatedConstraint(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { code?: string; constraint?: string };
  return e.code === '23505' ? (e.constraint ?? null) : null;
}

/** Books a table from the guest form. A reference that collides is redrawn, three times at most. */
export async function createWebReservation(
  input: ReservationRequest,
  { now = new Date(), makeReference = newReference, pool = getPool() }: CreateOptions = {},
): Promise<CreateOutcome> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await insertOnce(pool, input, now, makeReference());
    } catch (err) {
      const constraint = violatedConstraint(err);
      // The partial unique index rejects a second active request for the same table and number.
      if (constraint === 'reservations_dedupe_v2_idx') return { ok: false, code: 'duplicate' };
      if (constraint === 'reservations_reference_key' && attempt < REFERENCE_ATTEMPTS) continue;
      throw err;
    }
  }
}

async function insertOnce(pool: Pool, input: ReservationRequest, now: Date, reference: string): Promise<CreateOutcome> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const outcome = await insertInTransaction(client, input, now, reference);
    await client.query(outcome.ok ? 'COMMIT' : 'ROLLBACK');
    return outcome;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function insertInTransaction(client: PoolClient, input: ReservationRequest, now: Date, reference: string): Promise<CreateOutcome> {
  // The lock first: the rules and the covers read below must be the ones the insert is decided on.
  await lockBookingDay(client, input.restaurantId, input.date);
  const loaded = await loadRestaurantRules(client, input.restaurantId, input.locale, venueNow(now).date);
  if (!loaded) return { ok: false, code: 'restaurant_unavailable' };
  const { rules, groupPhone } = loaded;
  const booked = (await loadBookedCovers(client, input.restaurantId, input.date, input.date))[input.date] ?? {};
  const verdict = slotVerdict(resolveDay(rules, input.date, now, booked, input.guests), input.time);
  if (!verdict.ok) {
    if (verdict.code === 'slot_unavailable') return { ...verdict, params: { restaurant: rules.restaurantName } };
    if (verdict.code === 'party_too_large') {
      return { ...verdict, params: { max: String(rules.maxParty), ...(groupPhone ? { phone: groupPhone.display } : {}) } };
    }
    return verdict;
  }
  const status = rules.autoConfirm ? 'confirmed' : 'requested';
  // search_text, version and updated_at come from the reservations_before_write trigger.
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO reservations
       (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164,
        email, note, status, confirmed_at, source, locale)
     VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             CASE WHEN $12 = 'confirmed' THEN now() END, 'web',
             COALESCE((SELECT code FROM locales WHERE code = $13 AND is_enabled),
                      (SELECT code FROM locales WHERE is_default)))
     RETURNING id::text`,
    [
      reference,
      input.restaurantId,
      input.date,
      input.time,
      verdict.period.meal,
      input.guests,
      input.name,
      input.phone,
      input.phoneE164,
      input.email,
      input.note,
      status,
      input.locale,
    ],
  );
  const id = rows[0].id;
  await client.query(`INSERT INTO reservation_events (reservation_id, actor_kind, type, to_status) VALUES ($1, 'guest', 'created', $2)`, [
    id,
    status,
  ]);
  return { ok: true, id, reference, date: input.date, status };
}
```

Viết lại toàn bộ `app/actions.ts`:

```ts
'use server';

import type { BookingErrorCode } from '@/lib/booking-errors';
import { createWebReservation } from '@/lib/server/booking/create';
import { parseReservationInput } from '@/lib/server/booking/input';
import type { IsoDate } from '@/lib/venue-time';

export type ReservationResult =
  | { ok: true; data: { reference: string; date: IsoDate; status: 'requested' | 'confirmed' } }
  | { ok: false; code: BookingErrorCode; params?: Record<string, string> };

/**
 * Books a table (spec §10.2, steps 2, 3, 4, 6 and 7; BotID, the honeypot, the
 * phone limit and the outbox arrive in phase 5). Everything the client claimed
 * is parsed with zod, then re-checked against the venue's clock and the live
 * rules inside one locked transaction. Failures come back as codes; the
 * browser turns them into copy. A database error throws, so the guest sees
 * error.network (spec §12).
 */
export async function submitReservation(input: unknown): Promise<ReservationResult> {
  const parsed = parseReservationInput(input);
  if (!parsed.ok) return parsed;
  const result = await createWebReservation(parsed.value);
  if (!result.ok) return result;
  return { ok: true, data: { reference: result.reference, date: result.date, status: result.status } };
}
```

Xóa `createReservation` (cả cầu nối của Task 1) và chế độ `lenient` khỏi `db/queries.ts`: đường đặt bàn không còn đọc catalogue, nên nhãn ẩm thực lạ không còn chạm tới nó (mục M3 của sổ đợt 2). Diff đúng như sau:

```diff
diff --git a/db/queries.ts b/db/queries.ts
index 2751831..8f37574 100644
--- a/db/queries.ts
+++ b/db/queries.ts
@@ -1,7 +1,6 @@
 import 'server-only';
-import { getPool, query } from './client';
+import { query } from './client';
 import { DETAIL_PAGE_IDS, cuisineSlug, type DestKey, type Meal, type Restaurant } from '@/lib/data';
-import { newReference } from '@/lib/server/reference';
 
 type RestaurantRow = {
   id: string;
@@ -15,11 +14,10 @@ type RestaurantRow = {
 
 /**
  * The restaurant catalogue, ordered as the design lays it out. An unknown
- * cuisine label throws (the cached guest read must fail loudly); with
- * `lenient` it is logged and skipped, for the booking path, which only needs
- * ids, meals and capacity and must not die over a filter label.
+ * cuisine label throws: the cached guest read must fail loudly. (The booking
+ * path reads lib/server/booking/rules.ts, never this.)
  */
-export async function listRestaurants(options: { lenient?: boolean } = {}): Promise<Restaurant[]> {
+export async function listRestaurants(): Promise<Restaurant[]> {
   const rows = await query<RestaurantRow>(
     `SELECT id, name, type, destination, cuisines, meals, slot_capacity
        FROM restaurants
@@ -32,15 +30,7 @@ export async function listRestaurants(options: { lenient?: boolean } = {}): Prom
     name: r.name,
     type: r.type,
     dest: r.destination as DestKey,
-    cuisines: r.cuisines.flatMap((label) => {
-      try {
-        return [cuisineSlug(label)];
-      } catch (error) {
-        if (!options.lenient) throw error;
-        console.error('unknown_cuisine_label', label);
-        return [];
-      }
-    }),
+    cuisines: r.cuisines.map(cuisineSlug),
     meals: r.meals as Meal[],
     slotCapacity: r.slot_capacity,
   }));
@@ -70,127 +60,3 @@ export async function slotCapacity(restaurantId: string): Promise<number> {
   );
   return rows[0]?.slot_capacity ?? 0;
 }
-
-export type NewReservation = {
-  restaurantId: string;
-  isoDate: string;
-  time: string;
-  guests: number;
-  name: string;
-  /** As the guest typed it. */
-  phone: string;
-  /** Canonical form; the duplicate check keys on this. */
-  phoneE164: string;
-  email?: string;
-  note?: string;
-};
-
-export type CreateResult =
-  | { ok: true; reference: string }
-  | { ok: false; reason: 'full' | 'duplicate' | 'unknown-restaurant' };
-
-const REFERENCE_ATTEMPTS = 3;
-
-/** The unique constraint a Postgres error violated, if it is one. */
-function violatedConstraint(err: unknown): string | null {
-  if (typeof err !== 'object' || err === null) return null;
-  const e = err as { code?: string; constraint?: string };
-  return e.code === '23505' ? (e.constraint ?? null) : null;
-}
-
-/**
- * Books a table if the slot still has room. A reference that collides with an
- * existing one is redrawn, up to three times.
- */
-export async function createReservation(
-  input: NewReservation,
-  makeReference: () => string = newReference,
-): Promise<CreateResult> {
-  for (let attempt = 1; ; attempt++) {
-    try {
-      return await insertReservation(input, makeReference());
-    } catch (err) {
-      if (violatedConstraint(err) === 'reservations_reference_key' && attempt < REFERENCE_ATTEMPTS) continue;
-      throw err;
-    }
-  }
-}
-
-/**
- * The capacity check and the insert share one transaction and take a row lock
- * on the restaurant, so two simultaneous requests for the last seats cannot
- * both succeed.
- */
-async function insertReservation(input: NewReservation, reference: string): Promise<CreateResult> {
-  const client = await getPool().connect();
-
-  try {
-    await client.query('BEGIN');
-
-    const restaurant = await client.query<{ slot_capacity: number }>(
-      'SELECT slot_capacity FROM restaurants WHERE id = $1 FOR UPDATE',
-      [input.restaurantId],
-    );
-    if (!restaurant.rowCount) {
-      await client.query('ROLLBACK');
-      return { ok: false, reason: 'unknown-restaurant' };
-    }
-
-    const booked = await client.query<{ covers: string }>(
-      `SELECT COALESCE(SUM(guests), 0)::text AS covers
-         FROM reservations
-        WHERE restaurant_id = $1
-          AND reserved_on = $2::date
-          AND reserved_at = $3
-          AND status <> 'cancelled'`,
-      [input.restaurantId, input.isoDate, input.time],
-    );
-
-    const taken = Number(booked.rows[0]?.covers ?? 0);
-    if (taken + input.guests > restaurant.rows[0].slot_capacity) {
-      await client.query('ROLLBACK');
-      return { ok: false, reason: 'full' };
-    }
-
-    // Bridge until submitReservation v2 (phase 4, Task 4) replaces this path:
-    // migration 006 needs the source, the meal (the active period that serves
-    // this time) and a 'created' event. $4 is text for the column and the time
-    // in the subselect, so Postgres deduces one type for it.
-    const inserted = await client.query<{ id: string }>(
-      `INSERT INTO reservations
-         (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164, email, note, source, meal)
-       VALUES ($1, $2, $3::date, $4::text, $5, $6, $7, $8, $9, $10, 'web',
-               (SELECT meal FROM service_periods
-                 WHERE restaurant_id = $2 AND active AND $4::text::time BETWEEN first_seating AND last_seating
-                   AND extract(isodow FROM $3::date)::smallint = ANY (weekdays)
-                 ORDER BY sort_order LIMIT 1))
-       RETURNING id::text`,
-      [
-        reference,
-        input.restaurantId,
-        input.isoDate,
-        input.time,
-        input.guests,
-        input.name,
-        input.phone,
-        input.phoneE164,
-        input.email || null,
-        input.note || null,
-      ],
-    );
-    await client.query(
-      `INSERT INTO reservation_events (reservation_id, actor_kind, type, to_status) VALUES ($1, 'guest', 'created', 'requested')`,
-      [inserted.rows[0].id],
-    );
-
-    await client.query('COMMIT');
-    return { ok: true, reference };
-  } catch (err) {
-    await client.query('ROLLBACK');
-    // The partial unique index rejects a second request for the same table and number.
-    if (violatedConstraint(err) === 'reservations_dedupe_v2_idx') return { ok: false, reason: 'duplicate' };
-    throw err;
-  } finally {
-    client.release();
-  }
-}
```

```bash
git rm lib/server/check-reservation.ts lib/server/check-reservation.test.ts test/integration/reservations.test.ts
```

- [ ] **Bước 8: Chạy lại test**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/server/booking/input.test.ts lib/booking/slot-code.test.ts test/integration/submit-reservation.test.ts lib/booking-errors.test.ts lib/i18n/registry.test.ts`
Expected: PASS `Test Files  5 passed (5)`, `Tests  56 passed (56)`

- [ ] **Bước 9: Kiểm rằng hai test đồng thời đỏ khi bỏ khóa**

Xóa dòng `await lockBookingDay(client, input.restaurantId, input.date);` trong `lib/server/booking/create.ts`, chạy `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/submit-reservation.test.ts` **ba lần**. Expected mỗi lần: `Tests  2 failed | 12 passed (14)`:

```
     × never seats more than the slot holds when many guests race for the last covers
     × waits for another instance holding the (restaurant, date) lock, then re-reads the covers
AssertionError: expected [ { ok: true, data: { …(3) } }, …(6) ] to have a length of 3 but got 7
AssertionError: expected true to be false // Object.is equality
```

Trả dòng đó về, chạy lại ba lần: `Tests  14 passed (14)` cả ba.

- [ ] **Bước 10: Chạy cổng kiểm tra**

Chạy đủ khối lệnh ở "Cổng kiểm tra của mọi task". Client đợt 1 vẫn chạy (nó gửi input cũ không có `locale`, và hiện `closed` cùng `{max}`/`{phone}` qua `bookingErrorMessage`).

Expected: typecheck không lỗi; lint thoát 0, 20 cảnh báo; `Test Files  45 passed (45)`, `Tests  445 passed (445)`; `Applied 6 migration(s).`; build và check-prerender như Task 1; E2E `70 passed`; visual `8 passed`.

- [ ] **Bước 11: Commit**

```bash
git add app/actions.ts db/queries.ts lib/booking-errors.ts lib/booking-errors.test.ts lib/i18n/registry.ts lib/i18n/registry.test.ts lib/booking/slot-code.ts lib/booking/slot-code.test.ts lib/server/booking/input.ts lib/server/booking/input.test.ts lib/server/booking/create.ts test/integration/submit-reservation.test.ts e2e/booking-dates.spec.ts
git commit -m "$(cat <<'EOF'
feat: book guest tables under the booking-day lock with the live rules

submitReservation v2 is spec §10.2 steps 2, 3, 4, 6 and 7 without the
outbox: zod over an unknown input, E.164, then one transaction that takes
lockBookingDay, re-reads the rules and the held covers, runs resolveDay
and inserts the booking (source 'web', the meal of its slot, the guest's
locale when it is on, confirmed under auto_confirm) with its 'created'
event. A colliding reference is redrawn three times; the dedupe index
still answers duplicate. With the lock removed, a 12-way race for six
covers books seven parties.

New guest code `closed`; party_too_large now names the limit and the
number to call ({max}, {phone}), and error.past reads right for both the
lead time and the same-day cut-off. checkReservation, the phase-1 insert
and its bridge are gone, and with them listRestaurants' lenient mode: the
booking path no longer reads the catalogue.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

(`git rm` ở Bước 7 đã đưa ba file bị xóa vào commit.)


---

### Task 5: API availability v2 và catalogue của khách

Route trả hai dạng của R4 từ quy tắc sống. Để E2E của client đợt 1 vẫn xanh, dạng một ngày tạm mang thêm hai trường cũ `booked` và `capacity`; Task 6 bỏ chúng cùng lúc chuyển client. Catalogue có `bookingEnabled`, và `meals` lấy từ các ca đang bật (spec §6.3 mục 2).

**Files:**
- Create: `lib/booking/api.ts`
- Modify: `app/api/availability/route.ts` (viết lại), `test/integration/availability.test.ts` (viết lại), `test/integration/catalogue.test.ts` (viết lại), `db/queries.ts`, `lib/data.ts`, `lib/booking.test.ts`, `scripts/check-prerender.mjs`

**Interfaces:**
- Consumes: `resolveDay`, `resolveRange` (Task 2); `loadRestaurantRules`, `loadBookedCovers` (Task 3); `GroupPhone`, `DayState`, `SlotBlock` (`lib/booking/rules.ts`); `DEFAULT_LOCALE`, `LOCALE_CODE_RE` (`lib/i18n/locales.ts`); `MEALS` (`lib/data.ts`).
- Produces:
  - `lib/booking/api.ts` (dùng chung route và client): `MAX_RANGE_DAYS = 92`; `type DayInfo = { date; state: DayState; reason? }`; `type CalendarResponse = { restaurant; today; now; maxParty; groupPhone: GroupPhone | null; days: DayInfo[] }`; `type SlotInfo = { time; left; bookable; block? }`; `type PeriodInfo = { meal; closed; reason?; slots: SlotInfo[] }`; `type DayResponse = { restaurant; today; now; date; state; reason?; maxParty; leadMinutes; sameDayCutoff: string | null; periods: PeriodInfo[] }`; `type AvailabilityErrorCode`; `type AvailabilityError = { error: AvailabilityErrorCode }`.
  - `GET /api/availability` theo R4 (Task 5 còn kèm `booked`, `capacity` ở dạng một ngày).
  - `Restaurant` (`lib/data.ts`): thêm `bookingEnabled: boolean`; `meals` = các bữa của ca đang bật theo thứ tự `MEALS`; **bỏ** `slotCapacity`.
  - `scripts/check-prerender.mjs`: luật 1c, in `Uncached check passed: /api/availability not prerendered.`.

- [ ] **Bước 1: Viết test cho API v2**

Viết lại toàn bộ `test/integration/availability.test.ts`. Test cuối của nhóm "one day" ghim hai trường tạm cho client đợt 1; Task 6 thay nó.

```ts
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/availability/route';
import { getPool } from '@/db/client';
import type { CalendarResponse, DayResponse } from '@/lib/booking/api';

/* GET /api/availability v2 (spec §10.2; the contract is ruling R4 of the phase-4 plan). */

const get = (query: string) => GET(new Request(`http://test/api/availability?${query}`));
const json = async (query: string) => (await get(query)).json();
const calendar = async (query: string) => (await json(query)) as CalendarResponse;
const day = async (query: string) => (await json(query)) as DayResponse;
const sql = (text: string, values: unknown[] = []) => getPool().query(text, values);

const book = (date: string, time: string, guests: number, status = 'requested', phone = '+84905000000') =>
  sql(
    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source, status)
     VALUES ('FC-' || substr(md5(random()::text), 1, 8), 'taya-house', $1, $2, 'Dinner', $3, 'An', '0905000000', $4, 'web', $5)`,
    [date, time, guests, phone, status],
  );

describe.skipIf(!process.env.TEST_DATABASE_URL)('GET /api/availability v2 (database)', () => {
  beforeEach(async () => {
    await sql('DELETE FROM reservations');
    await sql('DELETE FROM closures');
    await sql(`UPDATE locales SET is_enabled = false, serve_machine = false WHERE code = 'vi'`);
    await sql('UPDATE booking_settings SET window_days = 14, lead_minutes = 30, max_party = 12, same_day_cutoff = NULL');
    await sql('UPDATE restaurants SET booking_enabled = true, max_party = NULL, window_days = NULL, lead_minutes = NULL');
    // Restore the seeded Tàya dinner (a test below edits it).
    await sql(
      `UPDATE service_periods SET first_seating = '18:00', last_seating = '21:00', covers_per_slot = 16, active = true
        WHERE restaurant_id = 'taya-house' AND meal = 'Dinner'`,
    );
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T18:00:00Z')); // 01:00 on 2 Oct in Da Nang
  });
  afterEach(() => vi.useRealTimers());
  afterAll(() => getPool().end());

  describe('the calendar (?restaurant=&lang=[&from=&to=])', () => {
    it("covers the booking window from Da Nang's today, with the clock, the party limit and the number to call", async () => {
      const res = await get('restaurant=taya-house&lang=en');
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = (await res.json()) as CalendarResponse;
      expect(body).toMatchObject({
        restaurant: 'taya-house',
        today: '2026-10-02',
        now: '2026-10-01T18:00:00.000Z',
        maxParty: 12,
        groupPhone: { display: '+84 236 651 9999', tel: '+842366519999' },
      });
      expect(body.days).toHaveLength(14);
      expect(body.days[0]).toEqual({ date: '2026-10-02', state: 'open' });
      expect(body.days[13]).toEqual({ date: '2026-10-15', state: 'open' });
    });

    it('gives a destination without a phone the first number there is', async () => {
      expect((await calendar('restaurant=yum-food-village')).groupPhone).toEqual({ display: '+84 236 651 9999', tel: '+842366519999' });
      expect((await calendar('restaurant=the-fan')).groupPhone).toEqual({ display: '0859 555 759', tel: '+84859555759' });
    });

    it('greys out closed days with the reason in the guest’s language when that language is on', async () => {
      const { rows } = await sql(
        `INSERT INTO closures (scope, restaurant_id, starts_on, ends_on) VALUES ('restaurant', 'taya-house', '2026-10-04', '2026-10-05') RETURNING id`,
      );
      await sql(`INSERT INTO closure_i18n (closure_id, locale, public_reason) VALUES ($1, 'en', 'Private event'), ($1, 'vi', 'Sự kiện riêng')`, [rows[0].id]);
      expect((await calendar('restaurant=taya-house&from=2026-10-03&to=2026-10-06')).days).toEqual([
        { date: '2026-10-03', state: 'open' },
        { date: '2026-10-04', state: 'closed', reason: 'Private event' },
        { date: '2026-10-05', state: 'closed', reason: 'Private event' },
        { date: '2026-10-06', state: 'open' },
      ]);
      // vi is off for the site, and an invalid lang is ignored: English.
      expect((await calendar('restaurant=taya-house&from=2026-10-04&to=2026-10-04&lang=vi')).days[0].reason).toBe('Private event');
      expect((await calendar('restaurant=taya-house&from=2026-10-04&to=2026-10-04&lang=../etc')).days[0].reason).toBe('Private event');
      await sql(`UPDATE locales SET is_enabled = true WHERE code = 'vi'`);
      expect((await calendar('restaurant=taya-house&from=2026-10-04&to=2026-10-04&lang=vi')).days[0].reason).toBe('Sự kiện riêng');
      // show_reason off: closed, no reason.
      await sql('UPDATE closures SET show_reason = false');
      expect((await calendar('restaurant=taya-house&from=2026-10-04&to=2026-10-04')).days[0]).toEqual({ date: '2026-10-04', state: 'closed' });
    });

    it('says full when every sitting of a day is taken, and past once today’s sittings have closed', async () => {
      for (const t of ['11:30', '12:00', '12:30', '13:00', '13:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00']) {
        await book('2026-10-03', t, 16);
      }
      expect((await calendar('restaurant=taya-house&from=2026-10-03&to=2026-10-03')).days).toEqual([{ date: '2026-10-03', state: 'full' }]);
      vi.setSystemTime(new Date('2026-10-02T14:00:00Z')); // 21:00 in Da Nang
      expect((await calendar('restaurant=taya-house&from=2026-10-02&to=2026-10-02')).days).toEqual([{ date: '2026-10-02', state: 'past' }]);
    });

    it('follows a per-restaurant window and max party, and marks dates past the window outside', async () => {
      await sql(`UPDATE restaurants SET window_days = 3, max_party = 8 WHERE id = 'taya-house'`);
      const body = await calendar('restaurant=taya-house');
      expect(body.maxParty).toBe(8);
      expect(body.days.map((d) => d.state)).toEqual(['open', 'open', 'open']);
      expect((await calendar('restaurant=taya-house&from=2026-10-04&to=2026-10-05')).days[1]).toEqual({ date: '2026-10-05', state: 'outside' });
    });
  });

  describe('one day (?restaurant=&date=&lang=[&guests=])', () => {
    it('lists the services and slots with the covers left, the clock rules and the party limit', async () => {
      await book('2026-10-03', '19:00', 4);
      await book('2026-10-03', '19:00', 9, 'cancelled', '+84905000001');
      const body = await day('restaurant=taya-house&date=2026-10-03');
      expect(body).toMatchObject({
        restaurant: 'taya-house',
        today: '2026-10-02',
        now: '2026-10-01T18:00:00.000Z',
        date: '2026-10-03',
        state: 'open',
        maxParty: 12,
        leadMinutes: 30,
        sameDayCutoff: null,
      });
      expect(body.periods.map((p) => [p.meal, p.closed])).toEqual([
        ['Lunch', false],
        ['Dinner', false],
      ]);
      expect(body.periods[1].slots.slice(0, 3)).toEqual([
        { time: '18:00', left: 16, bookable: true },
        { time: '18:30', left: 16, bookable: true },
        { time: '19:00', left: 12, bookable: true },
      ]);
    });

    it('answers for the party asked about (one guest by default)', async () => {
      await book('2026-10-03', '19:00', 5);
      expect((await day('restaurant=taya-house&date=2026-10-03&guests=12')).periods[1].slots[2]).toEqual({
        time: '19:00', left: 11, bookable: false, block: 'full',
      });
      await sql(`UPDATE restaurants SET max_party = 8 WHERE id = 'taya-house'`);
      expect((await day('restaurant=taya-house&date=2026-10-03&guests=9')).state).toBe('too_large');
    });

    it('marks today’s sittings inside the lead time, and today’s sittings after the cut-off', async () => {
      vi.setSystemTime(new Date('2026-10-02T12:00:00Z')); // 19:00 in Da Nang
      const slots = (await day('restaurant=taya-house&date=2026-10-02')).periods[1].slots;
      expect(slots.find((s) => s.time === '19:30')).toEqual({ time: '19:30', left: 16, bookable: false, block: 'lead' });
      expect(slots.find((s) => s.time === '20:00')).toEqual({ time: '20:00', left: 16, bookable: true });
      await sql(`UPDATE booking_settings SET same_day_cutoff = '18:00'`);
      const cut = await day('restaurant=taya-house&date=2026-10-02');
      expect(cut).toMatchObject({ state: 'past', sameDayCutoff: '18:00' });
      expect(cut.periods[1].slots.find((s) => s.time === '20:00')).toEqual({ time: '20:00', left: 16, bookable: false, block: 'cutoff' });
    });

    it('shows an Editor’s new dinner hours and covers on the very next request', async () => {
      const before = await day('restaurant=taya-house&date=2026-10-03');
      expect(before.periods[1].slots.map((s) => s.time)).toEqual(['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00']);
      await sql(
        `UPDATE service_periods SET first_seating = '17:30', last_seating = '22:00', covers_per_slot = 20
          WHERE restaurant_id = 'taya-house' AND meal = 'Dinner'`,
      );
      const after = await day('restaurant=taya-house&date=2026-10-03');
      expect(after.periods[1].slots.map((s) => s.time)).toEqual([
        '17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00',
      ]);
      expect(after.periods[1].slots[0]).toEqual({ time: '17:30', left: 20, bookable: true });
    });

    it('keeps a closed meal’s heading and reason, with no slots', async () => {
      const { rows } = await sql(
        `INSERT INTO closures (scope, destination_id, starts_on, ends_on, meals) VALUES ('destination', 'resort', '2026-10-03', '2026-10-03', '{Dinner}') RETURNING id`,
      );
      await sql(`INSERT INTO closure_i18n (closure_id, locale, public_reason) VALUES ($1, 'en', 'Wedding')`, [rows[0].id]);
      const body = await day('restaurant=taya-house&date=2026-10-03');
      expect(body.state).toBe('open');
      expect(body.periods[1]).toEqual({ meal: 'Dinner', closed: true, reason: 'Wedding', slots: [] });
    });

    it('answers a date outside the window with state outside, not an error', async () => {
      const res = await get('restaurant=taya-house&date=2026-10-01');
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ date: '2026-10-01', state: 'outside', periods: [] });
    });

    it('still carries the phase-1 fields until the guest form moves to v2 (Task 6 removes them)', async () => {
      await book('2026-10-03', '19:00', 4);
      expect(await json('restaurant=taya-house&date=2026-10-03')).toMatchObject({ booked: { '19:00': 4 }, capacity: 16 });
    });
  });

  it('answers 404 for an unknown restaurant and for one whose online booking is off', async () => {
    await sql(`UPDATE restaurants SET booking_enabled = false WHERE id = 'hai-van-lounge'`);
    for (const query of ['restaurant=nowhere', 'restaurant=hai-van-lounge', 'restaurant=hai-van-lounge&date=2026-10-03']) {
      const res = await get(query);
      expect(res.status).toBe(404);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ error: 'restaurant_unavailable' });
    }
  });

  it.each([
    ['date=2026-10-02', 'restaurant_required'],
    ['restaurant=taya-house&date=tomorrow', 'invalid_date'],
    ['restaurant=taya-house&date=2026-02-30', 'invalid_date'],
    ['restaurant=taya-house&from=soon', 'invalid_date'],
    ['restaurant=taya-house&from=2026-10-05&to=2026-10-04', 'invalid_range'],
    ['restaurant=taya-house&from=2026-10-01&to=2027-10-01', 'invalid_range'],
    ['restaurant=taya-house&date=2026-10-03&guests=0', 'invalid_guests'],
    ['restaurant=taya-house&date=2026-10-03&guests=two', 'invalid_guests'],
    ['restaurant=taya-house&date=2026-10-03&guests=51', 'invalid_guests'],
  ])('answers %j with 400 %s', async (query, error) => {
    const res = await get(query);
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ error });
  });
});
```

- [ ] **Bước 2: Viết test cho catalogue**

Viết lại toàn bộ `test/integration/catalogue.test.ts`:

```ts
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import { listRestaurants } from '@/db/queries';
import { CUISINES } from '@/lib/data';

const sql = (text: string, values: unknown[] = []) => getPool().query(text, values);

describe.skipIf(!process.env.TEST_DATABASE_URL)('restaurant catalogue (database)', () => {
  afterEach(async () => {
    await sql('UPDATE restaurants SET booking_enabled = true');
    await sql('UPDATE service_periods SET active = true');
    await sql(`DELETE FROM service_periods WHERE restaurant_id = 'hura-izakaya' AND meal = 'Breakfast'`);
  });
  afterAll(() => getPool().end());

  it('serves the 12 seeded restaurants in design order', async () => {
    const restaurants = await listRestaurants();
    expect(restaurants).toHaveLength(12);
    expect(restaurants[0].id).toBe('cafe-indochine');
    expect(restaurants.find((r) => r.id === 'taya-house')).toMatchObject({ meals: ['Lunch', 'Dinner'], bookingEnabled: true });
  });

  it('keys cuisines by slug, so every label in the database has one', async () => {
    const slugs = new Set(CUISINES.map(([, slug]) => slug));
    const used = (await listRestaurants()).flatMap((r) => r.cuisines);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((c) => !slugs.has(c))).toEqual([]);
  });

  it('uses the id as slug and gives only Tàya House a detail page', async () => {
    const restaurants = await listRestaurants();
    expect(restaurants.every((r) => r.slug === r.id)).toBe(true);
    expect(restaurants.filter((r) => r.hasDetailPage).map((r) => r.id)).toEqual(['taya-house']);
  });

  it('carries the booking switch', async () => {
    await sql(`UPDATE restaurants SET booking_enabled = false WHERE id = 'hai-van-lounge'`);
    const off = (await listRestaurants()).filter((r) => !r.bookingEnabled).map((r) => r.id);
    expect(off).toEqual(['hai-van-lounge']);
  });

  it('derives meals from the active service periods, in the canonical meal order (spec §6.3)', async () => {
    // Seeded periods reproduce restaurants.meals exactly.
    const { rows } = await sql('SELECT id, meals FROM restaurants ORDER BY sort_order');
    expect((await listRestaurants()).map((r) => [r.id, r.meals])).toEqual(rows.map((r) => [r.id, r.meals]));
    await sql(`UPDATE service_periods SET active = false WHERE restaurant_id = 'taya-house' AND meal = 'Lunch'`);
    await sql(
      `INSERT INTO service_periods (restaurant_id, meal, first_seating, last_seating, covers_per_slot, sort_order)
       VALUES ('hura-izakaya', 'Breakfast', '07:00', '09:00', 10, 50)`,
    );
    const meals = Object.fromEntries((await listRestaurants()).map((r) => [r.id, r.meals]));
    expect(meals['taya-house']).toEqual(['Dinner']);
    expect(meals['hura-izakaya']).toEqual(['Breakfast', 'Dinner']);
  });
});
```

Fixture của `lib/booking.test.ts` theo kiểu `Restaurant` mới (build typecheck cả test):

```diff
diff --git a/lib/booking.test.ts b/lib/booking.test.ts
index fa93e9b..dd293af 100644
--- a/lib/booking.test.ts
+++ b/lib/booking.test.ts
@@ -28,7 +28,7 @@ const taya: Restaurant = {
   cuisines: ['vietnamese'],
   dest: 'resort',
   meals: ['Lunch', 'Dinner'],
-  slotCapacity: 16,
+  bookingEnabled: true,
 };
 
 describe('booking window', () => {
```

- [ ] **Bước 3: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/availability.test.ts test/integration/catalogue.test.ts`
Expected: FAIL `Test Files  2 failed (2)`, `Tests  24 failed | 3 passed (27)` (ba test xanh: hai test catalogue cũ và test trường tạm, mà route đợt 1 vốn đã trả), trong đó:

```
 FAIL  … > the calendar (?restaurant=&lang=[&from=&to=]) > covers the booking window from Da Nang's today, with the clock, the party limit and the number to call
AssertionError: expected { today: '2026-10-02', …(4) } to match object { restaurant: 'taya-house', …(4) }
 FAIL  … > the calendar (?restaurant=&lang=[&from=&to=]) > gives a destination without a phone the first number there is
AssertionError: expected undefined to deeply equal { display: '+84 236 651 9999', …(1) }
 FAIL  … > one day (?restaurant=&date=&lang=[&guests=]) > answers for the party asked about (one guest by default)
TypeError: Cannot read properties of undefined (reading '1')
 FAIL  test/integration/catalogue.test.ts > restaurant catalogue (database) > serves the 12 seeded restaurants in design order
AssertionError: expected { id: 'taya-house', …(8) } to match object { meals: [ 'Lunch', 'Dinner' ], …(1) }
 FAIL  test/integration/catalogue.test.ts > restaurant catalogue (database) > carries the booking switch
AssertionError: expected [ 'cafe-indochine', …(11) ] to deeply equal [ 'hai-van-lounge' ]
 FAIL  test/integration/catalogue.test.ts > restaurant catalogue (database) > derives meals from the active service periods, in the canonical meal order (spec §6.3)
AssertionError: expected [ 'Lunch', 'Dinner' ] to deeply equal [ 'Dinner' ]
```

- [ ] **Bước 4: Viết hợp đồng API**

Create `lib/booking/api.ts`:

```ts
import type { Meal } from '@/lib/data';
import type { IsoDate } from '@/lib/venue-time';
import type { DayState, GroupPhone, SlotBlock } from './rules';

/*
 * The contract of GET /api/availability (spec §10.2; ruling R4 of the phase-4
 * plan), shared by the route and the guest form. Both forms echo the
 * restaurant, so the browser can drop an answer meant for another one, and
 * carry the server's clock: `now` is an ISO instant (the phase-1 deviation
 * from nowMinutes noted in spec §10.2).
 */

/** The longest from..to span the calendar form answers. */
export const MAX_RANGE_DAYS = 92;

/** One date of the strip, for a party of one. `reason` is the public closure reason. */
export type DayInfo = { date: IsoDate; state: DayState; reason?: string };

/** ?restaurant=&lang=[&from=&to=]: from and to default to the booking window. */
export type CalendarResponse = {
  restaurant: string;
  today: IsoDate;
  now: string;
  maxParty: number;
  groupPhone: GroupPhone | null;
  days: DayInfo[];
};

export type SlotInfo = { time: string; left: number; bookable: boolean; block?: SlotBlock };

/** A closed period keeps its heading and reason, with no slots. */
export type PeriodInfo = { meal: Meal; closed: boolean; reason?: string; slots: SlotInfo[] };

/** ?restaurant=&date=&lang=[&guests=]: guests defaults to 1. */
export type DayResponse = {
  restaurant: string;
  today: IsoDate;
  now: string;
  date: IsoDate;
  state: DayState;
  reason?: string;
  maxParty: number;
  /** The clock rules, so the open form closes sittings itself (clockBlock). */
  leadMinutes: number;
  sameDayCutoff: string | null;
  periods: PeriodInfo[];
};

/** 400: restaurant_required, invalid_date, invalid_range, invalid_guests; 404: restaurant_unavailable; 503: unavailable. */
export type AvailabilityErrorCode =
  | 'restaurant_required'
  | 'invalid_date'
  | 'invalid_range'
  | 'invalid_guests'
  | 'restaurant_unavailable'
  | 'unavailable';

export type AvailabilityError = { error: AvailabilityErrorCode };
```

- [ ] **Bước 5: Viết route v2**

Route đọc `request.url`, nên chạy theo từng request dưới Cache Components (`01-app/01-getting-started/15-route-handlers.md:87-124`); mọi câu trả lời, kể cả lỗi, mang `cache-control: no-store`. Kiểm tham số trước khi chạm DB; nhà hàng lạ hoặc đã tắt đặt bàn là 404; lỗi DB là 503 và chỉ ghi tên lỗi vào log.

Viết lại toàn bộ `app/api/availability/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getPool } from '@/db/client';
import { MAX_RANGE_DAYS, type AvailabilityErrorCode, type CalendarResponse, type DayResponse } from '@/lib/booking/api';
import { resolveDay, resolveRange } from '@/lib/booking/resolve-day';
import { DEFAULT_LOCALE, LOCALE_CODE_RE } from '@/lib/i18n/locales';
import { loadBookedCovers, loadRestaurantRules } from '@/lib/server/booking/rules';
import { addDays, daysBetween, isValidIsoDate, venueNow } from '@/lib/venue-time';

/**
 * Availability v2 (spec §10.2): the calendar of one restaurant, or one day's
 * services and slots. Never cached (spec §6.2): under Cache Components a GET
 * handler runs per request once it reads the request (request.url below;
 * node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md:87-124),
 * and every answer says no-store. scripts/check-prerender.mjs fails the build
 * check if this route ever lands in the prerender manifest.
 */

const NO_STORE = { 'cache-control': 'no-store' };
const fail = (status: number, error: AvailabilityErrorCode) => NextResponse.json({ error }, { status, headers: NO_STORE });
const GUESTS = /^[1-9][0-9]?$/;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const restaurant = params.get('restaurant');
  if (!restaurant) return fail(400, 'restaurant_required');
  // An invalid code falls back here; a disabled one falls back in the loader.
  const lang = params.get('lang');
  const locale = lang && LOCALE_CODE_RE.test(lang) ? lang : DEFAULT_LOCALE;

  const date = params.get('date');
  if (date !== null && !isValidIsoDate(date)) return fail(400, 'invalid_date');
  const from = params.get('from');
  const to = params.get('to');
  if ((from !== null && !isValidIsoDate(from)) || (to !== null && !isValidIsoDate(to))) return fail(400, 'invalid_date');
  const guestsParam = params.get('guests');
  if (guestsParam !== null && !(GUESTS.test(guestsParam) && Number(guestsParam) <= 50)) return fail(400, 'invalid_guests');
  const guests = guestsParam === null ? 1 : Number(guestsParam);

  const now = new Date();
  const today = venueNow(now).date;
  try {
    const pool = getPool();
    const loaded = await loadRestaurantRules(pool, restaurant, locale, today);
    if (!loaded || !loaded.rules.bookingEnabled) return fail(404, 'restaurant_unavailable');
    const { rules, groupPhone } = loaded;

    if (date !== null) {
      const booked = (await loadBookedCovers(pool, restaurant, date, date))[date] ?? {};
      const resolved = resolveDay(rules, date, now, booked, guests);
      const body: DayResponse = {
        restaurant,
        today,
        now: now.toISOString(),
        date,
        state: resolved.state,
        ...(resolved.reason ? { reason: resolved.reason } : {}),
        maxParty: rules.maxParty,
        leadMinutes: rules.leadMinutes,
        sameDayCutoff: rules.sameDayCutoff,
        periods: resolved.periods.map((p) => ({
          meal: p.meal,
          closed: p.closed,
          ...(p.reason ? { reason: p.reason } : {}),
          slots: p.closed ? [] : p.slots.map((s) => ({ time: s.time, left: s.left, bookable: s.bookable, ...(s.block ? { block: s.block } : {}) })),
        })),
      };
      // Transitional, until the guest form reads v2 (phase 4, Task 6): the phase-1 client reads booked and capacity.
      const phase1 = { booked, capacity: Math.max(0, ...rules.periods.map((p) => p.coversPerSlot)) };
      return NextResponse.json({ ...body, ...phase1 }, { headers: NO_STORE });
    }

    const start = from ?? today;
    const end = to ?? addDays(today, rules.windowDays - 1);
    const span = daysBetween(start, end);
    if (span < 0 || span >= MAX_RANGE_DAYS) return fail(400, 'invalid_range');
    const booked = await loadBookedCovers(pool, restaurant, start, end);
    const body: CalendarResponse = {
      restaurant,
      today,
      now: now.toISOString(),
      maxParty: rules.maxParty,
      groupPhone,
      days: resolveRange(rules, start, end, now, booked),
    };
    return NextResponse.json(body, { headers: NO_STORE });
  } catch (err) {
    console.error('availability_failed', { name: err instanceof Error ? err.name : typeof err });
    return fail(503, 'unavailable');
  }
}
```

- [ ] **Bước 6: Catalogue: công tắc và bữa từ ca**

```diff
diff --git a/lib/data.ts b/lib/data.ts
index 65cebdf..59b11d4 100644
--- a/lib/data.ts
+++ b/lib/data.ts
@@ -12,9 +12,10 @@ export type Restaurant = {
   /** Cuisine slugs (the second column of CUISINES), never labels. */
   cuisines: string[];
   dest: DestKey;
+  /** The meals of its active service periods (spec §6.3 item 2), in MEALS order; drives the Occasion filter. */
   meals: Meal[];
-  /** Covers bookable per time slot; drives real availability. */
-  slotCapacity: number;
+  /** restaurants.booking_enabled: off hides its RESERVE entry points and drops it from the reservation form. */
+  bookingEnabled: boolean;
 };
 
 /* The restaurant catalogue lives in Neon (see db/migrations/002_seed_restaurants.sql)
```

`bookedCovers` và `slotCapacity` (route đợt 1) bị xóa; `meals` lấy từ `service_periods` theo thứ tự `MEALS`. Catalogue vẫn cache dưới tag `restaurants`, mà các lần lưu ca (Task 11) làm hết hạn.

```diff
diff --git a/db/queries.ts b/db/queries.ts
index 8f37574..a15a871 100644
--- a/db/queries.ts
+++ b/db/queries.ts
@@ -1,6 +1,6 @@
 import 'server-only';
 import { query } from './client';
-import { DETAIL_PAGE_IDS, cuisineSlug, type DestKey, type Meal, type Restaurant } from '@/lib/data';
+import { DETAIL_PAGE_IDS, MEALS, cuisineSlug, type DestKey, type Meal, type Restaurant } from '@/lib/data';
 
 type RestaurantRow = {
   id: string;
@@ -9,7 +9,7 @@ type RestaurantRow = {
   destination: string;
   cuisines: string[];
   meals: string[];
-  slot_capacity: number;
+  booking_enabled: boolean;
 };
 
 /**
@@ -18,10 +18,19 @@ type RestaurantRow = {
  * path reads lib/server/booking/rules.ts, never this.)
  */
 export async function listRestaurants(): Promise<Restaurant[]> {
+  // meals: the meals of the active service periods, in MEALS order (spec §6.3
+  // item 2); restaurants.meals is only the phase-1 seed source now. Period saves
+  // expire the 'restaurants' tag this catalogue is cached under.
   const rows = await query<RestaurantRow>(
-    `SELECT id, name, type, destination, cuisines, meals, slot_capacity
-       FROM restaurants
-      ORDER BY sort_order`,
+    `SELECT r.id, r.name, r.type, r.destination, r.cuisines, r.booking_enabled,
+            ARRAY(SELECT m.meal
+                    FROM unnest($1::text[]) WITH ORDINALITY AS m(meal, n)
+                   WHERE EXISTS (SELECT 1 FROM service_periods p
+                                  WHERE p.restaurant_id = r.id AND p.active AND p.meal = m.meal)
+                   ORDER BY m.n) AS meals
+       FROM restaurants r
+      ORDER BY r.sort_order`,
+    [MEALS],
   );
   return rows.map((r) => ({
     id: r.id,
@@ -32,31 +41,6 @@ export async function listRestaurants(): Promise<Restaurant[]> {
     dest: r.destination as DestKey,
     cuisines: r.cuisines.map(cuisineSlug),
     meals: r.meals as Meal[],
-    slotCapacity: r.slot_capacity,
+    bookingEnabled: r.booking_enabled,
   }));
 }
-
-/** Covers already booked per time slot for one restaurant on one date. */
-export async function bookedCovers(
-  restaurantId: string,
-  isoDate: string,
-): Promise<Record<string, number>> {
-  const rows = await query<{ reserved_at: string; covers: string }>(
-    `SELECT reserved_at, SUM(guests)::text AS covers
-       FROM reservations
-      WHERE restaurant_id = $1
-        AND reserved_on = $2::date
-        AND status <> 'cancelled'
-      GROUP BY reserved_at`,
-    [restaurantId, isoDate],
-  );
-  return Object.fromEntries(rows.map((r) => [r.reserved_at, Number(r.covers)]));
-}
-
-export async function slotCapacity(restaurantId: string): Promise<number> {
-  const rows = await query<{ slot_capacity: number }>(
-    'SELECT slot_capacity FROM restaurants WHERE id = $1',
-    [restaurantId],
-  );
-  return rows[0]?.slot_capacity ?? 0;
-}
```

- [ ] **Bước 7: Chạy lại test**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/availability.test.ts test/integration/catalogue.test.ts`
Expected: PASS `Test Files  2 passed (2)`, `Tests  27 passed (27)`

- [ ] **Bước 8: Thêm luật 1c vào check-prerender**

```diff
diff --git a/scripts/check-prerender.mjs b/scripts/check-prerender.mjs
index ced4706..807ead8 100644
--- a/scripts/check-prerender.mjs
+++ b/scripts/check-prerender.mjs
@@ -6,7 +6,8 @@
  *    every cache tag their data readers declare, or a write that refreshes one
  *    of those tags (spec §6.2) would never reach them. The admin pages are the
  *    opposite (1b): no static shell at all, since a shell built at build time
- *    could not carry the per-request CSP nonce (spec §11).
+ *    could not carry the per-request CSP nonce (spec §11). /api/availability
+ *    (1c) must not be prerendered either.
  * 2. The web fonts must reach the pages as one family each. lib/fonts/index.ts
  *    loads every subset with its own localFont call and joins the calls into
  *    one family through `declarations`, which relies on the bundler naming a
@@ -88,6 +89,16 @@ for (const [route, entry] of adminRoutes) {
   }
 }
 
+/*
+ * 1c. Availability is never cached (spec §6.2): a GET handler that stops
+ * reading the request is prerendered at build time, and every guest would get
+ * the build's slots. The route must not be in the manifest at all.
+ */
+const UNCACHED = ['/api/availability'];
+for (const route of UNCACHED) {
+  if (manifest.routes[route] || manifest.dynamicRoutes[route]) problems.push(`${route} is prerendered; it must run per request`);
+}
+
 /* 2. Fonts */
 const fontSummary = checkFonts();
 
@@ -97,6 +108,7 @@ if (problems.length) {
 }
 console.log(`Prerender check passed: ${Object.keys(PAGES).join(', ')} (tags: ${TAGS.join(', ')}).`);
 console.log(`Admin check passed: ${adminRoutes.map(([route]) => route).join(', ')} have no static shell.`);
+console.log(`Uncached check passed: ${UNCACHED.join(', ')} not prerendered.`);
 console.log(`Font check passed: ${fontSummary}.`);
 
 function checkFonts() {
```

- [ ] **Bước 9: Một lần build âm: route tĩnh thì luật 1c phải đỏ**

Tạm thay toàn bộ `app/api/availability/route.ts` bằng một handler không I/O:

```ts
export async function GET(request: Request) {
  void request;
  return Response.json({ days: [] });
}
```

Run:

```bash
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
node scripts/check-prerender.mjs
```

Expected: bảng route của build in `├ ○ /api/availability`; check-prerender thoát 1:

```
Prerender and font check failed:
- /api/availability is prerendered; it must run per request
```

Trả route về bản của Bước 5 (`git diff app/api/availability/route.ts` phải giống hệt diff của Bước 5 so với HEAD). Không cần thử phương án "bỏ đọc `request.url` nhưng vẫn truy vấn DB": lúc kiểm chứng route đó vẫn là `ƒ` (truy vấn DB dừng prerender, `15-route-handlers.md:124`).

- [ ] **Bước 10: Chạy cổng kiểm tra**

Chạy đủ khối lệnh ở "Cổng kiểm tra của mọi task". E2E của client đợt 1 chạy nhờ hai trường tạm.

Expected: typecheck không lỗi; lint thoát 0, 20 cảnh báo; `Test Files  45 passed (45)`, `Tests  463 passed (463)`; `Applied 6 migration(s).`; build thoát 0 (bảng route vẫn `ƒ /api/availability`); check-prerender in thêm `Uncached check passed: /api/availability not prerendered.`; E2E `70 passed`; visual `8 passed`.

- [ ] **Bước 11: Commit**

```bash
git add app/api/availability/route.ts lib/booking/api.ts db/queries.ts lib/data.ts lib/booking.test.ts scripts/check-prerender.mjs test/integration/availability.test.ts test/integration/catalogue.test.ts
git commit -m "$(cat <<'EOF'
feat: answer availability v2 from the live rules, and derive the catalogue's meals from periods

GET /api/availability now has the two forms of spec §10.2 on the shared
contract in lib/booking/api.ts: the calendar (?restaurant=&lang=[&from=&to=])
gives each day's state and public closure reason with the clock, the party
limit and the number to call; one day (?restaurant=&date=&lang=[&guests=])
gives the services and slots with the covers left and the clock rules. An
unknown restaurant or one with booking off is 404, a date past the window
is state 'outside', bad input is 400 with a code, and every answer is
no-store. The day form still carries the phase-1 booked/capacity fields
until the guest form moves to v2.

The catalogue gains bookingEnabled, and its meals now come from the active
service periods (spec §6.3), under the 'restaurants' tag period saves will
expire; slotCapacity leaves it. check-prerender fails if the availability
route is ever prerendered (checked with a static handler).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 6: Form đặt bàn của khách v2 — slot từ server, ngày đóng cửa màu xám

Form khách không còn tự biết cửa sổ, lead time, giới hạn số khách hay danh sách giờ: mọi thứ đến từ `/api/availability`. HTML do server render không đổi một byte (visual ở ngưỡng 0, không đổi baseline). Phần ẩn nút RESERVE khi tắt đặt bàn (R14) là của Task 11.

**Files:**
- Create: `lib/booking/client.ts`, `lib/booking/client.test.ts`, `e2e/availability-mock.ts`, `e2e/booking-v2.spec.ts`
- Modify: `components/site/SiteProvider.tsx`, `components/overlays/ReserveDrawer.tsx`, `components/booking/BookingBar.tsx`, `components/ui/Dropdown.tsx`, `styles/overlays.css` (chỉ selector mới), `lib/i18n/registry.ts`, `lib/booking.ts` (viết lại), `lib/booking.test.ts` (viết lại), `app/api/availability/route.ts`, `test/integration/availability.test.ts`, `e2e/booking-dates.spec.ts`, `e2e/visual.spec.ts`

**Interfaces:**
- Consumes: `CalendarResponse`, `DayResponse`, `DayInfo`, `PeriodInfo`, `SlotInfo` (`lib/booking/api.ts`, Task 5); `clockBlock` (Task 2); `GroupPhone` (Task 3); `submitReservation` nhận `locale` (Task 4); `Restaurant.bookingEnabled` (Task 5); `one()`, `test`, `expect` của `e2e/staff-fixtures.ts`.
- Produces:
  - `lib/booking/client.ts`: `type BookingContext = { restaurants: Restaurant[]; calendar: CalendarResponse | null; board: DayResponse | null; now: Date }`; `dayReason(d: DayInfo, words): string`; `bookableRestaurants(restaurants)`; `calendarFor(calendar, restaurant)`; `boardFor(board, restaurant, date)`; `firstOpenDay(days)`; `slotOpen(board, period, slot, guests, now): boolean`; `openTimes(board, guests, now)`; `nearestOpenTime(board, time, guests, now)`; `reconcileBooking(current: Booking, patch: Partial<Booking>, ctx: BookingContext): Booking`; `bookingOpen(ctx, b): boolean | null` (`null` = chưa có bảng giờ, để server quyết).
  - `SiteProvider`: export `type ClientStrings = Record<ClientKey, string>`; `SiteState` bỏ `availability`, `dayList`, thêm `bookable: Restaurant[]`, `days: DayInfo[]`, `maxParty: number | null`, `groupPhone: GroupPhone | null`, `board: DayResponse | null`, `strings: ClientStrings`; `today` lấy từ lịch của server.
  - `lib/i18n/registry.ts`: key `booking.day_closed`, `booking.day_full`, `booking.day_past`, `booking.day_note` (`{date}`, `{reason}`), `booking.meal_closed`, `booking.no_dates` (`{phone}`), `booking.loading` (screen `booking`); `type ClientKey = Extract<StringKey, 'error.*' | 'booking.*'>`; `CLIENT_KEYS` gồm cả hai tiền tố.
  - `lib/booking.ts` chỉ còn `BookingForm`, `Booking`, `fmtDay`, `findRestaurant`, `validate`, `guestLabel`, `fold`. `SLOTS` vẫn ở `lib/data.ts` tới đợt 10.
  - `e2e/availability-mock.ts`: `type MockDay`, `type MockOptions = { today; now; maxParty?; windowDays?; days?; mealClosures? }`, `GROUP_PHONE`, `mockAvailability(page, options)`.
  - Dạng một ngày của API không còn `booked`/`capacity`.

- [ ] **Bước 1: Viết E2E trước: mock v2 và đặc tả form**

Create `e2e/availability-mock.ts`:

```ts
import type { Page } from '@playwright/test';

/**
 * Answers GET /api/availability in the v2 shapes (lib/booking/api.ts) without
 * a database, so a spec can pin the server's clock and the booking rules.
 * Every day is open with Lunch and Dinner at 16 covers unless the options say
 * otherwise. Values are read per request, so a spec can move the server's
 * clock between calls. A date outside the window answers state 'outside', as
 * the server does.
 */
export type MockDay = { state: 'closed' | 'full' | 'past'; reason?: string };
export type MockOptions = {
  today: () => string;
  now: () => string;
  maxParty?: number;
  windowDays?: number;
  /** Days that take no bookings, by date. */
  days?: Record<string, MockDay>;
  /** Meals closed on a date: date → meal → public reason (null for none). */
  mealClosures?: Record<string, Record<string, string | null>>;
};

const MEALS = {
  Lunch: ['11:30', '12:00', '12:30', '13:00', '13:30'],
  Dinner: ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00'],
};

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const GROUP_PHONE = { display: '+84 236 651 9999', tel: '+842366519999' };

export async function mockAvailability(page: Page, options: MockOptions) {
  await page.route('**/api/availability**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    const restaurant = params.get('restaurant') ?? '';
    const date = params.get('date');
    const today = options.today();
    const now = options.now();
    const maxParty = options.maxParty ?? 12;
    const windowDays = options.windowDays ?? 14;
    const dates = Array.from({ length: windowDays }, (_, i) => addDays(today, i));

    if (date === null) {
      return route.fulfill({
        json: {
          restaurant,
          today,
          now,
          maxParty,
          groupPhone: GROUP_PHONE,
          days: dates.map((d) => ({ date: d, state: 'open', ...options.days?.[d] })),
        },
      });
    }
    const clock = { restaurant, today, now, date, maxParty, leadMinutes: 30, sameDayCutoff: null };
    if (!dates.includes(date)) return route.fulfill({ json: { ...clock, state: 'outside', periods: [] } });

    const closedDay = options.days?.[date];
    const closedMeals = options.mealClosures?.[date] ?? {};
    return route.fulfill({
      json: {
        ...clock,
        state: closedDay?.state ?? 'open',
        ...(closedDay?.reason ? { reason: closedDay.reason } : {}),
        periods:
          closedDay?.state === 'closed'
            ? []
            : Object.entries(MEALS).map(([meal, times]) =>
                meal in closedMeals
                  ? { meal, closed: true, ...(closedMeals[meal] ? { reason: closedMeals[meal] } : {}), slots: [] }
                  : {
                      meal,
                      closed: false,
                      slots: times.map((time) =>
                        closedDay?.state === 'full' ? { time, left: 0, bookable: false, block: 'full' } : { time, left: 16, bookable: true },
                      ),
                    },
              ),
      },
    });
  });
}
```

Create `e2e/booking-v2.spec.ts`. Ba test đầu ghim server bằng mock; ba test cuối đi qua API và DB thật (`one()` từ chối mọi DB không phải DB cục bộ `_test`) và dùng cặp nhà hàng × ngày riêng của bản đồ dữ liệu E2E:

```ts
import type { Page } from '@playwright/test';
import { addDays, formatDay, venueNow } from '../lib/venue-time';
import { GROUP_PHONE, mockAvailability, type MockOptions } from './availability-mock';
import { HOME_PATH } from './paths';
import { expect, one, test } from './staff-fixtures';

/*
 * The guest form on server availability (spec §10.2, phase-4 acceptance
 * "closed days greyed out for guests" and "max_party = 8 blocks 9 guests").
 * The first tests pin the server with a mock; the last three go to the real
 * API and database (one() refuses any database but a local _test one).
 */

/* 10:00 on Friday 2 Oct in Da Nang. */
const NOW = new Date('2026-10-02T03:00:00Z');
const clock = { today: () => '2026-10-02', now: () => NOW.toISOString() };

test.use({ reducedMotion: 'reduce' }); // no reveal animation on the booking bar
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

async function openDrawer(page: Page, options: Partial<MockOptions> = {}) {
  await page.clock.setFixedTime(NOW);
  await mockAvailability(page, { ...clock, ...options });
  await page.goto(HOME_PATH);
  await page.getByRole('button', { name: 'RESERVE', exact: true }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  return drawer;
}

/** The booking bar's dropdowns, in order: destination, restaurant, date, time, guests. */
const barField = (page: Page, i: number) => page.locator('#reserve .dd').nth(i);

test('a closed day is greyed out, cannot be chosen, and says why', async ({ page }) => {
  const drawer = await openDrawer(page, {
    days: {
      '2026-10-04': { state: 'closed', reason: 'Closed for a private event' },
      '2026-10-05': { state: 'closed' },
      '2026-10-06': { state: 'full' },
    },
  });

  const closed = drawer.getByRole('button', { name: 'Sun, 4 Oct: Closed for a private event' });
  await expect(closed).toHaveAttribute('aria-disabled', 'true');
  await expect(closed).toHaveAttribute('data-state', 'closed');
  await expect(closed.locator('.day-num')).toHaveCSS('text-decoration-line', 'line-through');

  // Playwright waits for aria-disabled elements to become enabled; a guest's tap still lands (it is not `disabled`).
  await closed.click({ force: true });
  await expect(closed).toHaveAttribute('aria-pressed', 'false');
  await expect(drawer.locator('.day[aria-pressed="true"] .day-num')).toHaveText('2');
  await expect(drawer.getByRole('status')).toHaveText('Sun, 4 Oct: Closed for a private event');

  // Without a public reason, and when full, the generic words from the registry.
  await expect(drawer.getByRole('button', { name: 'Mon, 5 Oct: Closed' })).toHaveAttribute('aria-disabled', 'true');
  await expect(drawer.getByRole('button', { name: 'Tue, 6 Oct: Fully booked' })).toHaveAttribute('data-state', 'full');

  // An open day still selects.
  await drawer.locator('.day[data-state="open"]', { hasText: '7' }).click();
  await expect(drawer.locator('.day[aria-pressed="true"] .day-num')).toHaveText('7');
  await expect(drawer.getByRole('status')).toHaveCount(0);

  // The booking bar's date list greys the same days and shows the reason on hover.
  await page.keyboard.press('Escape');
  await barField(page, 2).locator('.dd-trigger').click();
  const option = page.getByRole('option', { name: /Sun, 4 Oct/ });
  await expect(option).toHaveAttribute('aria-disabled', 'true');
  await expect(option).toHaveAttribute('title', 'Closed for a private event');
  await expect(option.locator('.dd-note')).toHaveText('Closed');
  await option.click({ force: true });
  await expect(barField(page, 2).locator('.dd-value-text')).toHaveText('Wed, 7 Oct');
});

test('a closure of one meal keeps the rest of the day bookable', async ({ page }) => {
  const drawer = await openDrawer(page, { mealClosures: { '2026-10-02': { Lunch: 'Staff training' } } });

  const lunch = drawer.locator('.slotgroup', { hasText: 'Lunch' });
  await expect(lunch.locator('.slotgroup-note')).toHaveText('Not available on this date.Staff training');
  await expect(lunch.locator('.slot')).toHaveCount(0);
  await expect(drawer.locator('.slotgroup', { hasText: 'Dinner' }).locator('.slot:not([disabled])')).toHaveCount(7);
});

test('the party limit comes from the server: max_party 8 blocks a ninth guest and says whom to call', async ({ page }) => {
  const drawer = await openDrawer(page, { maxParty: 8 });

  const more = drawer.getByRole('button', { name: 'More guests' });
  for (let i = 2; i < 8; i++) await more.click();
  await expect(drawer.locator('.guests-value')).toHaveText('8 guests');
  await expect(more).toBeDisabled();
  await expect(drawer.locator('.guests-hint')).toHaveText(
    `For more than 8 guests, please call us on ${GROUP_PHONE.display}.`,
  );
  await expect(drawer.locator('.guests-hint a')).toHaveAttribute('href', `tel:${GROUP_PHONE.tel}`);

  await drawer.getByRole('button', { name: 'Fewer guests' }).click();
  await expect(drawer.locator('.guests-hint')).toHaveCount(0);

  // The booking bar offers 1…8 and nothing above.
  await page.keyboard.press('Escape');
  await barField(page, 4).locator('.dd-trigger').click();
  const options = page.getByRole('listbox', { name: 'Guests' }).getByRole('option');
  await expect(options).toHaveCount(8);
  await expect(options.last()).toHaveText(/8 guests/);
});

test('books a table against the real availability API', async ({ page }) => {
  await page.goto(HOME_PATH);
  await page.getByRole('button', { name: 'RESERVE', exact: true }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  await expect(drawer.locator('.daystrip .day').first().locator('.day-wd')).toHaveText('Today');

  // The last day of the window is never past its sittings.
  await drawer.locator('.daystrip .day[data-state="open"]').last().click();
  await drawer.locator('.slot:not([disabled])').first().click();
  await drawer.getByLabel('Full name *', { exact: true }).fill('Nguyễn Minh Anh');
  const digits = String(Date.now()).slice(-6);
  await drawer.getByLabel('Phone *', { exact: true }).fill(`0905 ${digits.slice(0, 3)} ${digits.slice(3)}`);
  await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();

  await expect(drawer.locator('.drawer-ref')).toHaveText(/^FC-[0-9A-HJKMNP-TV-Z]{8}$/);
});

/** Opens the drawer from a home-page card (a restaurant without its own page only reserves). */
async function openFromCard(page: Page, name: string) {
  await page.goto(HOME_PATH);
  await page.locator('.rcard:visible', { hasText: name }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  return drawer;
}

test('a closure written to the database greys the day on the next calendar fetch', async ({ page }) => {
  const date = addDays(venueNow().date, 9);
  const closure = await one<{ id: string }>(
    `INSERT INTO closures (scope, restaurant_id, starts_on, ends_on, created_by) VALUES ('restaurant', 'don-ciprianis', $1, $1, 'e2e') RETURNING id::text`,
    [date],
  );
  try {
    await one(`INSERT INTO closure_i18n (closure_id, locale, public_reason) VALUES ($1, 'en', 'Closed for a wine dinner')`, [closure!.id]);
    const drawer = await openFromCard(page, 'Don Cipriani');
    const chip = drawer.locator('.daystrip .day[aria-disabled="true"]');
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveAttribute('data-state', 'closed');
    await expect(chip).toHaveAttribute('aria-label', `${formatDay(date).label}: Closed for a wine dinner`);
  } finally {
    await one('DELETE FROM closures WHERE id = $1', [closure!.id]);
  }
});

test('a max_party of 8 in the database stops the stepper at 8 and names the destination’s number', async ({ page }) => {
  await one(`UPDATE restaurants SET max_party = 8 WHERE id = 'the-fan'`);
  try {
    const drawer = await openFromCard(page, 'Steakhouse The Fan');
    const more = drawer.getByRole('button', { name: 'More guests' });
    for (let i = 2; i < 8; i++) await more.click();
    await expect(drawer.locator('.guests-value')).toHaveText('8 guests');
    await expect(more).toBeDisabled();
    await expect(drawer.locator('.guests-hint')).toHaveText('For more than 8 guests, please call us on 0859 555 759.');
    await expect(drawer.locator('.guests-hint a')).toHaveAttribute('href', 'tel:+84859555759');
  } finally {
    await one(`UPDATE restaurants SET max_party = NULL WHERE id = 'the-fan'`);
  }
});
```

- [ ] **Bước 2: Build code hiện tại và chạy đặc tả mới: phải đỏ**

```bash
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson E2E_PORT=3210 npm run test:e2e -- --retries=0 e2e/booking-v2.spec.ts
```

Expected: build thoát 0; E2E `6 failed`:

```
  ✘  1 [desktop] › e2e/booking-v2.spec.ts:36:5 › a closed day is greyed out, cannot be chosen, and says why (30.1s)
  ✘  2 [desktop] › e2e/booking-v2.spec.ts:76:5 › a closure of one meal keeps the rest of the day bookable (30.1s)
  ✘  3 [desktop] › e2e/booking-v2.spec.ts:85:5 › the party limit comes from the server: max_party 8 blocks a ninth guest and says whom to call (30.1s)
  ✘  4 [desktop] › e2e/booking-v2.spec.ts:108:5 › books a table against the real availability API (30.1s)
  ✘  5 [desktop] › e2e/booking-v2.spec.ts:135:5 › a closure written to the database greys the day on the next calendar fetch (5.4s)
  ✘  6 [desktop] › e2e/booking-v2.spec.ts:153:5 › a max_party of 8 in the database stops the stepper at 8 and names the destination’s number (5.6s)
```

Ba test đầu dừng ở `waiting for getByRole('button', { name: 'RESERVE', exact: true }).first()`: client đợt 1 đọc `data.booked[time]` trên một câu trả lời v2, ném lỗi lúc render, và `[lang]/error.tsx` thay cả trang. Test 4 chờ `.daystrip .day[data-state="open"]`; test 5 `Expected: 1, Received: 0` ô ngày `aria-disabled`; test 6 nút "More guests" `Expected: disabled, Received: enabled`.

- [ ] **Bước 3: Viết test cho quy tắc của form**

Create `lib/booking/client.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Booking } from '@/lib/booking';
import type { Restaurant } from '@/lib/data';
import { bookableRestaurants, bookingOpen, dayReason, reconcileBooking, type BookingContext } from './client';
import type { CalendarResponse, DayResponse } from './api';

const restaurant = (id: string, dest: Restaurant['dest'], bookingEnabled = true): Restaurant => ({
  id,
  slug: id,
  hasDetailPage: false,
  name: id,
  type: '',
  cuisines: [],
  dest,
  meals: ['Dinner'],
  bookingEnabled,
});

const all = [
  restaurant('taya-house', 'resort'),
  restaurant('hai-van-lounge', 'resort', false),
  restaurant('the-fan', 'dining-house', false),
  restaurant('pho-cuon', 'dining-house'),
];
const restaurants = bookableRestaurants(all);
const at10 = new Date('2026-10-02T03:00:00Z'); // 10:00 on 2 Oct in Da Nang

const calendar: CalendarResponse = {
  restaurant: 'taya-house',
  today: '2026-10-02',
  now: at10.toISOString(),
  maxParty: 8,
  groupPhone: { display: '+84 236 651 9999', tel: '+842366519999' },
  days: [
    { date: '2026-10-02', state: 'open' },
    { date: '2026-10-03', state: 'closed', reason: 'Private event' },
    { date: '2026-10-04', state: 'open' },
  ],
};

const board: DayResponse = {
  restaurant: 'taya-house',
  today: '2026-10-02',
  now: at10.toISOString(),
  date: '2026-10-02',
  state: 'open',
  maxParty: 8,
  leadMinutes: 30,
  sameDayCutoff: null,
  periods: [
    {
      meal: 'Dinner',
      closed: false,
      slots: [
        { time: '18:00', left: 16, bookable: true },
        { time: '19:00', left: 2, bookable: true },
        { time: '20:00', left: 16, bookable: true },
      ],
    },
  ],
};

const booking: Booking = { destination: 'resort', restaurant: 'taya-house', date: '2026-10-02', time: '19:00', guests: 2 };
const ctx = (over: Partial<BookingContext> = {}): BookingContext => ({ restaurants, calendar, board, now: at10, ...over });

describe('reconcileBooking', () => {
  it('never chooses a restaurant that does not book online', () => {
    expect(reconcileBooking(booking, { restaurant: 'hai-van-lounge' }, ctx()).restaurant).toBe('taya-house');
  });

  it('picks the first bookable restaurant of a destination', () => {
    const next = reconcileBooking(booking, { destination: 'dining-house' }, ctx({ calendar: null, board: null }));
    expect(next).toMatchObject({ restaurant: 'pho-cuon', destination: 'dining-house' });
  });

  it('clamps the party to maxParty', () => {
    expect(reconcileBooking(booking, { guests: 9 }, ctx({ board: null })).guests).toBe(8);
  });

  it('refuses a date that is not open and keeps the current one', () => {
    expect(reconcileBooking(booking, { date: '2026-10-03' }, ctx({ board: null })).date).toBe('2026-10-02');
  });

  it('moves a date the calendar no longer offers to the first open day', () => {
    const stale = { ...booking, date: '2026-10-01' };
    expect(reconcileBooking(stale, {}, ctx({ board: null })).date).toBe('2026-10-02');
  });

  it('slides the time to the nearest slot with room for the party', () => {
    expect(reconcileBooking(booking, { guests: 4 }, ctx()).time).toBe('18:00');
  });

  it('ignores a board for another date', () => {
    const next = reconcileBooking({ ...booking, date: '2026-10-04' }, { guests: 4 }, ctx());
    expect(next.time).toBe('19:00');
  });
});

describe('reconcileBooking and stale answers', () => {
  it('ignores a calendar for another restaurant', () => {
    const other = { ...calendar, restaurant: 'pho-cuon' };
    expect(reconcileBooking(booking, { guests: 9, date: '2026-10-03' }, ctx({ calendar: other, board: null }))).toMatchObject({
      guests: 9,
      date: '2026-10-03',
    });
  });

  it('leaves the time alone when a meal is closed and nothing else is open', () => {
    const closedDinner: DayResponse = { ...board, periods: [{ meal: 'Dinner', closed: true, reason: 'Wedding', slots: [] }] };
    expect(reconcileBooking(booking, {}, ctx({ board: closedDinner })).time).toBe('19:00');
  });
});

describe('bookingOpen', () => {
  it('is null without a board for the chosen day: the server decides', () => {
    expect(bookingOpen(ctx({ board: null }), booking)).toBeNull();
  });

  it('is false when the party no longer fits, or the clock closed the sitting by the board’s own rules', () => {
    expect(bookingOpen(ctx(), { ...booking, guests: 3 })).toBe(false);
    // 18:45: inside the 30-minute lead.
    expect(bookingOpen(ctx({ now: new Date('2026-10-02T11:45:00Z') }), booking)).toBe(false);
    // 17:00 with a 17:00 same-day cut-off from the server.
    expect(bookingOpen(ctx({ board: { ...board, sameDayCutoff: '17:00' }, now: new Date('2026-10-02T10:00:00Z') }), booking)).toBe(false);
    expect(bookingOpen(ctx(), booking)).toBe(true);
  });
});

describe('dayReason', () => {
  const words = { 'booking.day_closed': 'Closed', 'booking.day_full': 'Fully booked', 'booking.day_past': 'Too late' };
  it('prefers the public reason, else names the state', () => {
    expect(dayReason({ date: '2026-10-03', state: 'closed', reason: 'Private event' }, words)).toBe('Private event');
    expect(dayReason({ date: '2026-10-03', state: 'closed' }, words)).toBe('Closed');
    expect(dayReason({ date: '2026-10-03', state: 'full' }, words)).toBe('Fully booked');
  });
});
```

- [ ] **Bước 4: Chạy test, phải đỏ**

Run: `npx vitest run lib/booking/client.test.ts`
Expected: FAIL

```
 FAIL  lib/booking/client.test.ts [ lib/booking/client.test.ts ]
Error: Cannot find module './client' imported from …/lib/booking/client.test.ts
      Tests  no tests
```

- [ ] **Bước 5: Viết quy tắc của form**

Create `lib/booking/client.ts`:

```ts
/**
 * The reservation form's rules in the browser, on top of what
 * /api/availability last said. Nothing here knows a slot list, a capacity,
 * a window or a party limit of its own: those all arrive from the server.
 */
import type { Booking } from '@/lib/booking';
import type { Restaurant } from '@/lib/data';
import { toMinutes, type IsoDate } from '@/lib/venue-time';
import type { CalendarResponse, DayInfo, DayResponse, PeriodInfo, SlotInfo } from './api';
import { clockBlock } from './resolve-day';

/** What the form knows right now. `restaurants` holds only those taking online bookings. */
export type BookingContext = {
  restaurants: Restaurant[];
  calendar: CalendarResponse | null;
  board: DayResponse | null;
  now: Date;
};

type DayWords = Record<'booking.day_closed' | 'booking.day_full' | 'booking.day_past', string>;

/** Why a day takes no bookings: its public reason, else the word for its state (registry booking.day_*). */
export function dayReason(d: DayInfo, words: DayWords): string {
  if (d.reason) return d.reason;
  if (d.state === 'full') return words['booking.day_full'];
  if (d.state === 'past') return words['booking.day_past'];
  return words['booking.day_closed'];
}

/** Restaurants guests can book online (restaurants.booking_enabled). */
export const bookableRestaurants = (restaurants: Restaurant[]) => restaurants.filter((r) => r.bookingEnabled);

/** The calendar, if it answers for this restaurant. */
export const calendarFor = (calendar: CalendarResponse | null, restaurant: string) =>
  calendar && calendar.restaurant === restaurant ? calendar : null;

/** The slot board, if it answers for this restaurant and date. */
export const boardFor = (board: DayResponse | null, restaurant: string, date: IsoDate | '') =>
  board && board.restaurant === restaurant && board.date === date ? board : null;

export const firstOpenDay = (days: DayInfo[]): IsoDate | '' => days.find((d) => d.state === 'open')?.date ?? '';

/** A slot the party can take now: open by the server, still open by the clock (the server's own rules), and with room. */
export function slotOpen(
  board: DayResponse,
  period: PeriodInfo,
  slot: SlotInfo,
  guests: number,
  now: Date,
): boolean {
  return (
    !period.closed &&
    slot.bookable &&
    slot.left >= guests &&
    guests <= board.maxParty &&
    clockBlock(board.date, slot.time, now, board) === null
  );
}

export function openTimes(board: DayResponse, guests: number, now: Date): string[] {
  return board.periods.flatMap((p) => p.slots.filter((s) => slotOpen(board, p, s, guests, now)).map((s) => s.time));
}

/** Keep the chosen time when it is still open; otherwise the nearest open one; otherwise leave it. */
export function nearestOpenTime(board: DayResponse, time: string, guests: number, now: Date): string {
  const open = openTimes(board, guests, now);
  if (!open.length || open.includes(time)) return time;
  const m = toMinutes(time);
  return open.reduce((a, x) => (Math.abs(toMinutes(x) - m) < Math.abs(toMinutes(a) - m) ? x : a), open[0]);
}

/**
 * Applies a change to the booking and keeps the rest consistent:
 * - a destination picks its first bookable restaurant; a restaurant implies its destination;
 * - a restaurant that does not book online is never chosen;
 * - with this restaurant's calendar: the party is clamped to maxParty, and a
 *   date that is not open (a closure, full, past, or outside the window) is
 *   refused, falling back to the first open day;
 * - with this day's board: the time slides to the nearest open slot.
 * Without the matching calendar or board those fields are left for the
 * server's answer to settle.
 */
export function reconcileBooking(current: Booking, patch: Partial<Booking>, ctx: BookingContext): Booking {
  const next = { ...current, ...patch };
  const { restaurants } = ctx;

  if (patch.destination && patch.destination !== current.destination && !patch.restaurant) {
    const first = restaurants.find((r) => r.dest === patch.destination);
    if (first) next.restaurant = first.id;
  }
  if (!restaurants.some((r) => r.id === next.restaurant)) {
    next.restaurant = restaurants.some((r) => r.id === current.restaurant)
      ? current.restaurant
      : (restaurants[0]?.id ?? '');
  }
  const r = restaurants.find((x) => x.id === next.restaurant);
  if (r) next.destination = r.dest;

  const calendar = calendarFor(ctx.calendar, next.restaurant);
  if (calendar) {
    next.guests = Math.max(1, Math.min(next.guests, calendar.maxParty));
    const isOpen = (d: IsoDate | '') => calendar.days.some((x) => x.date === d && x.state === 'open');
    if (!isOpen(next.date)) next.date = isOpen(current.date) ? current.date : firstOpenDay(calendar.days);
  }

  const board = boardFor(ctx.board, next.restaurant, next.date);
  if (board) next.time = nearestOpenTime(board, next.time, next.guests, ctx.now);
  return next;
}

/** The client gate before submitting: only with a board for this exact restaurant and date. */
export function bookingOpen(ctx: BookingContext, b: Booking): boolean | null {
  const board = boardFor(ctx.board, b.restaurant, b.date);
  if (!board) return null; // unknown: let the server decide
  return board.periods.some((p) => p.slots.some((s) => s.time === b.time && slotOpen(board, p, s, b.guests, ctx.now)));
}
```

- [ ] **Bước 6: Thêm chữ của form vào registry**

```diff
diff --git a/lib/i18n/registry.ts b/lib/i18n/registry.ts
index ba079a4..1c90563 100644
--- a/lib/i18n/registry.ts
+++ b/lib/i18n/registry.ts
@@ -116,6 +116,51 @@ export const REGISTRY = {
     context: 'The browser could not reach the server (client side only).',
     screen: 'ui-text',
   },
+  'booking.day_closed': {
+    en: 'Closed',
+    maxLength: 40,
+    context: 'Reservation form, on a date that takes no bookings when the closure has no public reason. Short: it also fits a dropdown note.',
+    screen: 'booking',
+  },
+  'booking.day_full': {
+    en: 'Fully booked',
+    maxLength: 40,
+    context: 'Reservation form, on a date with no tables left at any time. Short: it also fits a dropdown note.',
+    screen: 'booking',
+  },
+  'booking.day_past': {
+    en: 'No more tables today',
+    maxLength: 40,
+    context: 'Reservation form, on today once every sitting has closed to online booking.',
+    screen: 'booking',
+  },
+  'booking.day_note': {
+    en: '{date}: {reason}',
+    maxLength: 60,
+    vars: ['date', 'reason'],
+    context:
+      'Line under the date strip after a guest taps a date that takes no bookings, and that date’s spoken name. {date} is the formatted date, {reason} the public closure reason or one of booking.day_*; keep both.',
+    screen: 'booking',
+  },
+  'booking.meal_closed': {
+    en: 'Not available on this date.',
+    maxLength: 80,
+    context: 'Under a meal heading (Lunch, Dinner…) when a closure takes out that meal only. The public reason, if any, follows on its own line.',
+    screen: 'booking',
+  },
+  'booking.no_dates': {
+    en: 'No dates are open for online booking. Please call us on {phone}.',
+    maxLength: 140,
+    vars: ['phone'],
+    context: 'Reservation form, when no date in the booking window takes bookings. {phone} is the restaurant’s number; keep it.',
+    screen: 'booking',
+  },
+  'booking.loading': {
+    en: 'Checking tables…',
+    maxLength: 40,
+    context: 'Reservation form, in place of the time slots while they load.',
+    screen: 'booking',
+  },
 } as const satisfies Record<string, StringDef>;
 
 export type StringKey = keyof typeof REGISTRY;
@@ -125,8 +170,11 @@ export const STRING_KEYS = Object.keys(REGISTRY) as StringKey[];
 /** Same pattern as the CHECK on content_strings.key (migration 004). */
 export const KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
 
+/** Keys the browser needs: the reservation form's copy and its error messages. */
+export type ClientKey = Extract<StringKey, `error.${string}` | `booking.${string}`>;
+
 /** Keys the browser needs at first paint; passed to SiteProvider. Grow this list per component that moves to t(). */
-export const CLIENT_KEYS = STRING_KEYS.filter((k) => k.startsWith('error.')) as StringKey[];
+export const CLIENT_KEYS = STRING_KEYS.filter((k): k is ClientKey => k.startsWith('error.') || k.startsWith('booking.'));
 
 /** The registry's own text for a language other than English; only `vi`, and only where declared. */
 export function registryLocaleDefault(key: StringKey, locale: string): string | undefined {
```

- [ ] **Bước 7: Chuyển `SiteProvider` sang lịch và bảng giờ của server**

Hai loader `loadCalendar`/`loadBoard` thay effect cũ; mỗi loại giữ một số thứ tự (`useRef`), chỉ câu trả lời mới nhất được dùng, nên đổi nhà hàng nhanh không để câu trả lời chậm của nhà hàng trước đè lên. Effect và handler (`openReserve`, gửi lỗi) gọi loader trực tiếp, không qua state "nonce" (cách đó thêm ba cảnh báo lint ở spike). Câu trả lời ngày có `state: 'outside'` (tab mở qua nửa đêm) nạp lại lịch. Gửi đặt bàn kèm `locale`. Sửa `components/site/SiteProvider.tsx` đúng như diff sau:

```diff
diff --git a/components/site/SiteProvider.tsx b/components/site/SiteProvider.tsx
index 05deb52..697206f 100644
--- a/components/site/SiteProvider.tsx
+++ b/components/site/SiteProvider.tsx
@@ -11,22 +11,21 @@ import {
   useState,
 } from 'react';
 import type { DestKey, Restaurant } from '@/lib/data';
+import { findRestaurant, validate, type Booking, type BookingForm } from '@/lib/booking';
 import {
-  NO_AVAILABILITY,
-  bookingDates,
-  defaultDate,
-  findRestaurant,
-  isSittingClosed,
-  reconcile,
-  slotBookable,
-  validate,
-  type Availability,
-  type AvailabilityResponse,
-  type Booking,
-  type BookingForm,
-} from '@/lib/booking';
-import { bookingErrorMessage, type ErrorStrings } from '@/lib/booking-errors';
-import { venueNow, type IsoDate } from '@/lib/venue-time';
+  boardFor,
+  bookableRestaurants,
+  bookingOpen,
+  calendarFor,
+  reconcileBooking,
+  type BookingContext,
+} from '@/lib/booking/client';
+import type { CalendarResponse, DayInfo, DayResponse } from '@/lib/booking/api';
+import { clockBlock } from '@/lib/booking/resolve-day';
+import type { GroupPhone } from '@/lib/booking/rules';
+import { bookingErrorMessage } from '@/lib/booking-errors';
+import type { ClientKey } from '@/lib/i18n/registry';
+import type { IsoDate } from '@/lib/venue-time';
 import { submitReservation } from '@/app/actions';
 import { coverThen } from '@/components/site/PageCurtain';
 import { homeHref, restaurantHref } from '@/lib/i18n/href';
@@ -42,20 +41,23 @@ export type PageView = { view: View; restaurant: string | null; root: HTMLElemen
 
 const EMPTY_FORM: BookingForm = { name: '', phone: '', email: '', note: '' };
 
-function loadAvailability(
-  restaurant: string,
-  date: IsoDate,
-  signal?: AbortSignal,
-): Promise<AvailabilityResponse | null> {
-  const base = `/api/availability?restaurant=${encodeURIComponent(restaurant)}`;
-  return fetch(`${base}&date=${date}`, { signal }).then((r) => {
-    if (r.ok) return r.json() as Promise<AvailabilityResponse>;
-    // 400 means the date left the server's window (stale tab or clock): ask for the server's today instead.
-    if (r.status !== 400) return null;
-    return fetch(base, { signal }).then((r2) => (r2.ok ? (r2.json() as Promise<AvailabilityResponse>) : null));
-  });
+export type ClientStrings = Record<ClientKey, string>;
+
+type Fetched<T> = { ok: true; data: T } | { ok: false };
+
+async function getJson<T>(url: string): Promise<Fetched<T>> {
+  const r = await fetch(url);
+  return r.ok ? { ok: true, data: (await r.json()) as T } : { ok: false };
 }
 
+const NO_DAYS: DayInfo[] = [];
+
+/* The two forms of GET /api/availability (lib/booking/api.ts). */
+const calendarUrl = (restaurant: string, locale: string) =>
+  `/api/availability?restaurant=${encodeURIComponent(restaurant)}&lang=${encodeURIComponent(locale)}`;
+const dayUrl = (restaurant: string, date: IsoDate, locale: string) =>
+  `${calendarUrl(restaurant, locale)}&date=${date}`;
+
 type SiteState = {
   /** The URL locale code (`en`). */
   locale: string;
@@ -82,13 +84,22 @@ type SiteState = {
 
   booking: Booking;
   setBooking: (patch: Partial<Booking>) => void;
-  availability: Availability;
-  /** Da Nang's today once known in the browser; null during the server render. */
+  /** Restaurants that take bookings online (booking_enabled): the form's list and every RESERVE button. */
+  bookable: Restaurant[];
+  /** Da Nang's today by the server's clock; null until /api/availability has answered (and during the server render). */
   today: IsoDate | null;
-  /** The bookable dates, today first; empty until `today` is known. */
-  dayList: IsoDate[];
+  /** The booking window as the server sees it, today first; empty until it has answered. */
+  days: DayInfo[];
+  /** The online party limit for the chosen restaurant; null until known. */
+  maxParty: number | null;
+  /** Who to call for a larger group; null until known. */
+  groupPhone: GroupPhone | null;
+  /** The slots for the chosen restaurant and date; null while they load. */
+  board: DayResponse | null;
   /** The server's clock, as last reported by /api/availability. */
   now: () => Date;
+  /** The reservation form's copy and error messages for this language. */
+  strings: ClientStrings;
   /** The date the server stored for the last confirmed request. */
   confirmedDate: IsoDate | '';
   form: BookingForm;
@@ -142,8 +153,8 @@ export function SiteProvider({
   restaurants: Restaurant[];
   /** The restaurant the booking bar starts on (DEFAULT_RESTAURANT_ID until phase 6). */
   defaultRestaurantId: string;
-  /** The error.* copy for this language, resolved on the server (DB override, else registry). */
-  strings: ErrorStrings;
+  /** The booking.* and error.* copy for this language, resolved on the server (DB override, else registry). */
+  strings: ClientStrings;
   children: React.ReactNode;
 }) {
   const router = useRouter();
@@ -173,18 +184,20 @@ export function SiteProvider({
     occasion: 'all',
     destination: 'all',
   });
+  const bookable = useMemo(() => bookableRestaurants(restaurants), [restaurants]);
   const [booking, setBookingState] = useState<Booking>(() => {
-    const first = restaurants.find((r) => r.id === defaultRestaurantId) ?? restaurants[0];
+    // Spec §5.2 site_settings.default_restaurant_id: the first bookable restaurant when that one is not.
+    const first = bookable.find((r) => r.id === defaultRestaurantId) ?? bookable[0];
     return { destination: first?.dest ?? 'resort', restaurant: first?.id ?? '', date: '', time: '19:00', guests: 2 };
   });
-  const [availability, setAvailability] = useState<Availability>(NO_AVAILABILITY);
+  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
+  const [board, setBoard] = useState<DayResponse | null>(null);
   const [form, setForm] = useState<BookingForm>(EMPTY_FORM);
   const [tried, setTried] = useState(false);
   const [done, setDone] = useState(false);
   const [pending, setPending] = useState(false);
   const [reference, setReference] = useState('');
   const [serverError, setServerError] = useState<string | null>(null);
-  const [today, setToday] = useState<IsoDate | null>(null);
   const [clockOffset, setClockOffset] = useState(0);
   const [confirmedDate, setConfirmedDate] = useState<IsoDate | ''>('');
   const [overlay, setOverlay] = useState<Overlay | null>(null);
@@ -192,70 +205,87 @@ export function SiteProvider({
   const [lang, setLang] = useState<'EN' | 'VI'>('EN');
   const [openDropdown, setOpenDropdown] = useState<string | null>(null);
   const pendingScroll = useRef<string | null>(null);
-  const availabilityRef = useRef(availability);
-  availabilityRef.current = availability;
+  /* The latest booking and answers, for callbacks that must not re-create on every change. */
+  const latest = useRef({ booking, calendar, board });
+  latest.current = { booking, calendar, board };
+  /* Only the newest request of each kind may land: a slow answer for the
+     previous restaurant or date must not overwrite the current one. */
+  const calendarSeq = useRef(0);
+  const boardSeq = useRef(0);
 
   const now = useCallback(() => new Date(Date.now() + clockOffset), [clockOffset]);
 
-  /* "Today" is Da Nang's date, resolved after hydration so the server render
-     carries no date at all. The availability response then corrects it with
-     the server's clock. */
-  useEffect(() => {
-    const venueToday = venueNow().date;
-    setToday((t) => t ?? venueToday); // never overwrite a server-provided today
-    setBookingState((b) =>
-      b.date
-        ? b
-        : reconcile(restaurants, b, { date: defaultDate(restaurants, b.restaurant, venueToday) }, NO_AVAILABILITY),
-    );
-  }, [restaurants]);
+  const context = useCallback(
+    (at: Date, over: Partial<BookingContext> = {}): BookingContext => ({
+      restaurants: bookable,
+      calendar: latest.current.calendar,
+      board: latest.current.board,
+      now: at,
+      ...over,
+    }),
+    [bookable],
+  );
 
   const setBooking = useCallback(
     (patch: Partial<Booking>) => {
-      setBookingState((b) => reconcile(restaurants, b, patch, availabilityRef.current, now()));
+      setBookingState((b) => reconcileBooking(b, patch, context(now())));
+    },
+    [context, now],
+  );
+
+  /* The calendar: which days of the window take bookings, the party limit,
+     and the server's today and clock. Nothing date-related renders before it
+     answers, so the server render carries no date at all (hydration #418).
+     Its answer picks the first open day when the chosen one is not. */
+  const loadCalendar = useCallback(
+    (restaurant: string) => {
+      const seq = ++calendarSeq.current;
+      getJson<CalendarResponse>(calendarUrl(restaurant, locale))
+        .then((res) => {
+          if (seq !== calendarSeq.current || !res.ok) return;
+          const data = res.data;
+          const serverNow = new Date(data.now);
+          setClockOffset(serverNow.getTime() - Date.now());
+          setCalendar(data);
+          setBookingState((b) => reconcileBooking(b, {}, context(serverNow, { calendar: data })));
+        })
+        .catch(() => {});
     },
-    [now, restaurants],
+    [context, locale],
+  );
+
+  /* The slots of one day, with the covers left. A slot that filled or closed
+     while the drawer was open slides the time to the nearest open one. Not
+     keyed on the party size: the browser checks the party against `left`. */
+  const loadBoard = useCallback(
+    (restaurant: string, date: IsoDate) => {
+      const seq = ++boardSeq.current;
+      getJson<DayResponse>(dayUrl(restaurant, date, locale))
+        .then((res) => {
+          if (seq !== boardSeq.current || !res.ok) return;
+          const data = res.data;
+          // The date left the window (a tab open past midnight): the calendar's answer moves it.
+          if (data.state === 'outside') {
+            loadCalendar(restaurant);
+            return;
+          }
+          const serverNow = new Date(data.now);
+          setClockOffset(serverNow.getTime() - Date.now());
+          setBoard(data);
+          setBookingState((b) => reconcileBooking(b, {}, context(serverNow, { board: data })));
+        })
+        .catch(() => {});
+    },
+    [context, loadCalendar, locale],
   );
 
-  /* Pull live slot pressure whenever the restaurant or date changes. The
-     response carries the server's clock, which becomes the authority for
-     "today" and for which sittings have closed. */
   useEffect(() => {
-    const date = booking.date;
-    if (!date) return;
-    let cancelled = false;
-    const controller = new AbortController();
-
-    loadAvailability(booking.restaurant, date, controller.signal)
-      .then((data) => {
-        if (cancelled || !data) return;
-        const serverNow = new Date(data.now);
-        const board: Availability = { booked: data.booked, capacity: data.capacity };
-        setClockOffset(serverNow.getTime() - Date.now());
-        setToday(data.today);
-        setAvailability(board);
-        // A date the server considers past moves to the first bookable day (the
-        // moved date re-triggers this effect and fetches its own board); a slot that filled
-        // while the drawer was open slides to the nearest free one.
-        setBookingState((b) =>
-          reconcile(
-            restaurants,
-            b,
-            b.date && b.date < data.today
-              ? { date: defaultDate(restaurants, b.restaurant, data.today, serverNow) }
-              : {},
-            board,
-            serverNow,
-          ),
-        );
-      })
-      .catch(() => {});
+    if (booking.restaurant) loadCalendar(booking.restaurant);
+  }, [booking.restaurant, loadCalendar]);
 
-    return () => {
-      cancelled = true;
-      controller.abort();
-    };
-  }, [booking.restaurant, booking.date, restaurants]);
+  useEffect(() => {
+    if (booking.restaurant && booking.date) loadBoard(booking.restaurant, booking.date);
+  }, [booking.restaurant, booking.date, loadBoard]);
 
   const setFinder = useCallback((patch: Partial<Finder>) => {
     setFinderState((f) => ({ ...f, ...patch }));
@@ -345,24 +375,20 @@ export function SiteProvider({
 
   const openReserve = useCallback(
     (preset?: Partial<Booking>, note?: string) => {
-      // Refresh "today" from the server-adjusted clock: the tab may have been open past midnight.
-      const venueToday = venueNow(now()).date;
-      setToday(venueToday);
       setOverlay('drawer');
       setOpenDropdown(null);
       setDone(false);
       setTried(false);
       setServerError(null);
       if (note) setForm((f) => (f.note ? f : { ...f, note }));
-      setBookingState((b) => {
-        const patch: Partial<Booking> = { ...preset };
-        if (b.date && b.date < venueToday) {
-          patch.date = defaultDate(restaurants, patch.restaurant ?? b.restaurant, venueToday, now());
-        }
-        return reconcile(restaurants, b, patch, availabilityRef.current, now());
-      });
+      // A restaurant that does not book online is ignored here (reconcileBooking keeps the current one).
+      const next = reconcileBooking(latest.current.booking, { ...preset }, context(now()));
+      setBookingState(next);
+      // Ask again: the tab may have been open past midnight, or a closure or a booking changed the picture.
+      if (next.restaurant) loadCalendar(next.restaurant);
+      if (next.restaurant && next.date) loadBoard(next.restaurant, next.date);
     },
-    [now, restaurants],
+    [context, loadBoard, loadCalendar, now],
   );
 
   const closeDrawer = useCallback(() => {
@@ -400,14 +426,17 @@ export function SiteProvider({
     setServerError(null);
     const date = booking.date;
     const fieldsValid = valid.name && valid.phone && valid.email;
-    if (!(date && fieldsValid && slotBookable(restaurants, booking, availability, now()))) {
+    const at = now();
+    // null: no board for this restaurant and date yet, so the server alone decides.
+    if (!(date && fieldsValid && bookingOpen(context(at), booking) !== false)) {
       setTried(true);
       if (date && fieldsValid) {
         // The form is fine, so the slot is the problem (it closed or filled
         // while the drawer sat open): say so and slide to the nearest open one.
-        const at = now();
-        setServerError(bookingErrorMessage(isSittingClosed(date, booking.time, at) ? 'past' : 'full', {}, strings));
-        setBookingState((b) => reconcile(restaurants, b, {}, availability, at));
+        const day = boardFor(latest.current.board, booking.restaurant, date);
+        const past = day ? clockBlock(date, booking.time, at, day) !== null : false;
+        setServerError(bookingErrorMessage(past ? 'past' : 'full', {}, strings));
+        setBookingState((b) => reconcileBooking(b, {}, context(at)));
       }
       return;
     }
@@ -422,6 +451,7 @@ export function SiteProvider({
       phone: form.phone,
       email: form.email,
       note: form.note,
+      locale,
     })
       .then((result) => {
         if (result.ok) {
@@ -432,20 +462,14 @@ export function SiteProvider({
         }
         setServerError(bookingErrorMessage(result.code, result.params, strings));
         setTried(true);
-        // Re-read the slot board so a lost race shows up immediately, and move
-        // the chosen time off a slot that has just filled.
-        return loadAvailability(booking.restaurant, date)
-          .then((data) => {
-            if (!data) return;
-            const board: Availability = { booked: data.booked, capacity: data.capacity };
-            setAvailability(board);
-            setBookingState((b) => reconcile(restaurants, b, {}, board, new Date(data.now)));
-          })
-          .catch(() => {});
+        // Ask again so a lost race (or a new closure) shows up at once; the
+        // answers move the time off a slot that has just filled.
+        loadCalendar(booking.restaurant);
+        loadBoard(booking.restaurant, date);
       })
       .catch(() => setServerError(bookingErrorMessage('network', {}, strings)))
       .finally(() => setPending(false));
-  }, [availability, booking, form, now, restaurants, strings, valid]);
+  }, [booking, context, form, loadBoard, loadCalendar, locale, now, strings, valid]);
 
   const setFormField = useCallback((key: keyof BookingForm, value: string) => {
     setForm((f) => ({ ...f, [key]: value }));
@@ -535,7 +559,13 @@ export function SiteProvider({
     if (pageRoot) window.scrollTo(0, 0);
   }, [pageRoot]);
 
-  const dayList = useMemo(() => (today ? bookingDates(today) : []), [today]);
+  const chosenCalendar = calendarFor(calendar, booking.restaurant);
+  const maxParty = chosenCalendar?.maxParty ?? null;
+  const groupPhone = chosenCalendar?.groupPhone ?? null;
+  const chosenBoard = boardFor(board, booking.restaurant, booking.date);
+  /* The last calendar answered, even for the previous restaurant, so the strip does not blink on a switch. */
+  const days = calendar?.days ?? NO_DAYS;
+  const today = calendar?.today ?? null;
 
   const value = useMemo<SiteState>(
     () => ({
@@ -558,10 +588,14 @@ export function SiteProvider({
       pickDestination,
       booking,
       setBooking,
-      availability,
+      bookable,
       today,
-      dayList,
+      days,
+      maxParty,
+      groupPhone,
+      board: chosenBoard,
       now,
+      strings,
       confirmedDate,
       form,
       setFormField,
@@ -590,12 +624,12 @@ export function SiteProvider({
       openRestaurant,
     }),
     [
-      applyFinder, availability, booking, clearFilters, close, closeDrawer, closeDropdown, confirmedDate,
-      dayList, done, errors, filter, finder, form, goBackToRestaurants, goHomeTop, lang, locale, matches,
-      now, open, openDropdown, openReserve, openRestaurant, overlay, pageRoot, pending, pickCuisine,
-      pickDestination, query, reference, restaurants, scrollToId, scrolled, serverError, setBooking,
-      setFilter, setFinder, setFormField, showPage, shownCount, submit, tab, today, toggleDropdown, tried,
-      view,
+      applyFinder, booking, bookable, chosenBoard, clearFilters, close, closeDrawer, closeDropdown,
+      confirmedDate, days, done, errors, filter, finder, form, goBackToRestaurants, goHomeTop, groupPhone,
+      lang, locale, matches, maxParty, now, open, openDropdown, openReserve, openRestaurant, overlay,
+      pageRoot, pending, pickCuisine, pickDestination, query, reference, restaurants, scrollToId, scrolled,
+      serverError, setBooking, setFilter, setFinder, setFormField, showPage, shownCount, strings, submit,
+      tab, today, toggleDropdown, tried, view,
     ],
   );
 
```

- [ ] **Bước 8: Drawer, thanh đặt bàn, dropdown và CSS**

`DayStrip` là component con chỉ mount khi drawer mở, nên ghi chú "ngày này đóng vì…" về rỗng mỗi lần mở mà không cần set-state trong effect. Ô ngày không mở có `aria-disabled` (vẫn focus được, lý do nằm trong tên đọc lên), `data-state`, và một `<p role="status">` khi bấm. `+` khóa khi chưa biết `maxParty` hoặc đã chạm nó; tới giới hạn thì hiện `error.party_too_large` với `{phone}` thành liên kết `tel:`.

```diff
diff --git a/components/overlays/ReserveDrawer.tsx b/components/overlays/ReserveDrawer.tsx
index d1c335f..724ef31 100644
--- a/components/overlays/ReserveDrawer.tsx
+++ b/components/overlays/ReserveDrawer.tsx
@@ -1,30 +1,114 @@
 'use client';
 
+import { useState } from 'react';
 import { DESTS, DEST_KEYS, MEAL_LABELS } from '@/lib/data';
-import {
-  MAX_GUESTS,
-  findRestaurant,
-  fmtDay,
-  guestLabel,
-  seatsLeft,
-  slotsFor,
-  unavailable,
-} from '@/lib/booking';
-import { formatDay } from '@/lib/venue-time';
-import { useSite } from '@/components/site/SiteProvider';
+import { findRestaurant, fmtDay, guestLabel } from '@/lib/booking';
+import { dayReason, slotOpen } from '@/lib/booking/client';
+import type { DayInfo } from '@/lib/booking/api';
+import type { GroupPhone } from '@/lib/booking/rules';
+import { formatMessage, type MessageParams } from '@/lib/i18n/format';
+import { formatDay, type IsoDate } from '@/lib/venue-time';
+import { useSite, type ClientStrings } from '@/components/site/SiteProvider';
 import { Dropdown, type Option } from '@/components/ui/Dropdown';
 import { animateSelector, useOpenAnimation } from '@/lib/motion';
 
+/** A message with {phone} turned into a tel: link (any other placeholder is filled as text). */
+function WithPhone({ template, params, phone }: { template: string; params: MessageParams; phone: GroupPhone }) {
+  const parts = template.split('{phone}');
+  if (parts.length < 2 || !phone.tel) return <>{formatMessage(template, { ...params, phone: phone.display })}</>;
+  return (
+    <>
+      {formatMessage(parts[0], params)}
+      <a href={`tel:${phone.tel}`}>{phone.display}</a>
+      {formatMessage(parts.slice(1).join(phone.display), params)}
+    </>
+  );
+}
+
+/**
+ * The booking window as the server sent it. A day that takes no bookings is
+ * greyed out and cannot be chosen; tapping it shows why. Mounted only while
+ * the drawer shows, so the note starts empty on every open.
+ */
+function DayStrip({
+  days,
+  selected,
+  onPick,
+  strings,
+  groupPhone,
+}: {
+  days: DayInfo[];
+  selected: IsoDate | '';
+  onPick: (date: IsoDate) => void;
+  strings: ClientStrings;
+  groupPhone: GroupPhone | null;
+}) {
+  /* The unavailable day a guest last tapped. */
+  const [note, setNote] = useState<DayInfo | null>(null);
+  const noDates = days.length > 0 && !days.some((d) => d.state === 'open');
+
+  return (
+    <>
+      <div className="daystrip">
+        {days.map((d, i) => {
+          const day = formatDay(d.date);
+          const open = d.state === 'open';
+          const isSelected = open && d.date === selected;
+          return (
+            <button
+              type="button"
+              key={d.date}
+              className="day"
+              data-selected={isSelected}
+              data-state={d.state}
+              aria-pressed={isSelected}
+              // Still focusable, so the reason in its name is read out; a tap shows it below.
+              aria-disabled={open ? undefined : true}
+              aria-label={
+                open
+                  ? undefined
+                  : formatMessage(strings['booking.day_note'], { date: day.label, reason: dayReason(d, strings) })
+              }
+              onClick={() => {
+                setNote(open ? null : d);
+                if (open) onPick(d.date);
+              }}
+            >
+              <span className="day-wd">{i === 0 ? 'Today' : day.weekday}</span>
+              <span className="day-num">{day.day}</span>
+              <span className="day-mo">{day.month}</span>
+            </button>
+          );
+        })}
+      </div>
+      {note && (
+        <p className="day-note" role="status">
+          {formatMessage(strings['booking.day_note'], { date: fmtDay(note.date), reason: dayReason(note, strings) })}
+        </p>
+      )}
+      {noDates && groupPhone && (
+        <p className="day-note">
+          <WithPhone template={strings['booking.no_dates']} params={{}} phone={groupPhone} />
+        </p>
+      )}
+    </>
+  );
+}
+
 export function ReserveDrawer() {
   const {
     restaurants,
+    bookable,
     overlay,
     closeDrawer,
     booking,
     setBooking,
-    availability,
-    dayList,
+    days,
+    maxParty,
+    groupPhone,
+    board,
     now,
+    strings,
     confirmedDate,
     form,
     setFormField,
@@ -45,15 +129,17 @@ export function ReserveDrawer() {
 
   if (!open) return null;
 
-  const restaurant = findRestaurant(restaurants, booking.restaurant) ?? restaurants[0];
+  const restaurant = findRestaurant(bookable, booking.restaurant) ?? findRestaurant(restaurants, booking.restaurant);
   const at = now();
-  const groups = slotsFor(restaurants, booking.restaurant);
-  const anyAvailable = groups.some((g) =>
-    g.times.some((t) => !unavailable(booking.date, t, booking.guests, availability, at)),
-  );
+  const anyAvailable =
+    board?.periods.some((p) => p.slots.some((s) => slotOpen(board, p, s, booking.guests, at))) ?? true;
+  const atLimit = maxParty !== null && booking.guests >= maxParty;
 
-  const destinationOptions: Option<string>[] = DEST_KEYS.map((k) => ({ value: k, label: DESTS[k] }));
-  const restaurantOptions: Option<string>[] = restaurants
+  // Only places and restaurants that take bookings online (booking_enabled).
+  const destinationOptions: Option<string>[] = DEST_KEYS.filter((k) => bookable.some((r) => r.dest === k)).map(
+    (k) => ({ value: k, label: DESTS[k] }),
+  );
+  const restaurantOptions: Option<string>[] = bookable
     .filter((r) => r.dest === booking.destination)
     .map((r) => ({ value: r.id, label: r.name }));
 
@@ -140,25 +226,13 @@ export function ReserveDrawer() {
               </div>
 
               <div className="drawer-label">DATE</div>
-              <div className="daystrip">
-                {dayList.map((d, i) => {
-                  const day = formatDay(d);
-                  return (
-                    <button
-                      type="button"
-                      key={d}
-                      className="day"
-                      data-selected={d === booking.date}
-                      aria-pressed={d === booking.date}
-                      onClick={() => setBooking({ date: d })}
-                    >
-                      <span className="day-wd">{i === 0 ? 'Today' : day.weekday}</span>
-                      <span className="day-num">{day.day}</span>
-                      <span className="day-mo">{day.month}</span>
-                    </button>
-                  );
-                })}
-              </div>
+              <DayStrip
+                days={days}
+                selected={booking.date}
+                onPick={(date) => setBooking({ date })}
+                strings={strings}
+                groupPhone={groupPhone}
+              />
 
               <div className="guests">
                 <div>
@@ -177,47 +251,59 @@ export function ReserveDrawer() {
                   <button
                     type="button"
                     aria-label="More guests"
-                    disabled={booking.guests >= MAX_GUESTS}
-                    onClick={() => setBooking({ guests: Math.min(MAX_GUESTS, booking.guests + 1) })}
+                    // The limit comes from the server (booking rules); until it answers, no growing.
+                    disabled={maxParty === null || atLimit}
+                    onClick={() => setBooking({ guests: booking.guests + 1 })}
                   >
                     +
                   </button>
                 </div>
               </div>
+              {atLimit && groupPhone && (
+                <p className="guests-hint">
+                  <WithPhone
+                    template={strings['error.party_too_large']}
+                    params={{ max: maxParty }}
+                    phone={groupPhone}
+                  />
+                </p>
+              )}
 
               <div className="drawer-label">TIME</div>
-              {groups.map((g) => (
-                <div key={g.meal} className="slotgroup">
-                  <div className="slotgroup-meal">{MEAL_LABELS[g.meal]}</div>
-                  <div className="slotgrid">
-                    {g.times.map((t) => {
-                      const taken = unavailable(booking.date, t, booking.guests, availability, at);
-                      const left = seatsLeft(t, availability);
-                      return (
-                        <button
-                          type="button"
-                          key={t}
-                          className="slot"
-                          data-selected={!taken && t === booking.time}
-                          data-taken={taken}
-                          disabled={taken}
-                          aria-label={
-                            taken
-                              ? `${t} — fully booked`
-                              : left !== null
-                                ? `${t} — ${left} covers left`
-                                : t
-                          }
-                          onClick={() => setBooking({ time: t })}
-                        >
-                          {t}
-                        </button>
-                      );
-                    })}
-                  </div>
+              {!board && booking.date && <div className="slot-loading">{strings['booking.loading']}</div>}
+              {board?.state === 'closed' && <div className="drawer-error">{strings['error.closed']}</div>}
+              {board?.periods.map((p) => (
+                <div key={p.meal} className="slotgroup" data-closed={p.closed || undefined}>
+                  <div className="slotgroup-meal">{MEAL_LABELS[p.meal]}</div>
+                  {p.closed ? (
+                    <div className="slotgroup-note">
+                      <span>{strings['booking.meal_closed']}</span>
+                      {p.reason && <span className="slotgroup-reason">{p.reason}</span>}
+                    </div>
+                  ) : (
+                    <div className="slotgrid">
+                      {p.slots.map((s) => {
+                        const taken = !slotOpen(board, p, s, booking.guests, at);
+                        return (
+                          <button
+                            type="button"
+                            key={s.time}
+                            className="slot"
+                            data-selected={!taken && s.time === booking.time}
+                            data-taken={taken}
+                            disabled={taken}
+                            aria-label={taken ? `${s.time} — fully booked` : `${s.time} — ${s.left} covers left`}
+                            onClick={() => setBooking({ time: s.time })}
+                          >
+                            {s.time}
+                          </button>
+                        );
+                      })}
+                    </div>
+                  )}
                 </div>
               ))}
-              {!anyAvailable && (
+              {!anyAvailable && board?.state !== 'closed' && (
                 <div className="drawer-error">
                   No tables left on this date — please choose another day.
                 </div>
```

Trước khi server trả lời (và trong HTML của server), ô Giờ và ô Số khách của thanh đặt bàn chỉ có một lựa chọn là giá trị đang chọn, nên HTML server vẫn là "Date — / Time 19:00 / Guests 2 guests" như trước:

```diff
diff --git a/components/booking/BookingBar.tsx b/components/booking/BookingBar.tsx
index c0766b0..285fde1 100644
--- a/components/booking/BookingBar.tsx
+++ b/components/booking/BookingBar.tsx
@@ -1,52 +1,62 @@
 'use client';
 
 import { DESTS, DEST_KEYS, MEAL_LABELS } from '@/lib/data';
-import { MAX_GUESTS, fmtDay, guestLabel, seatsLeft, slotsFor, unavailable } from '@/lib/booking';
+import { fmtDay, guestLabel } from '@/lib/booking';
+import { dayReason, slotOpen } from '@/lib/booking/client';
 import { useSite } from '@/components/site/SiteProvider';
 import { Dropdown, type Option } from '@/components/ui/Dropdown';
 import { useReveal } from '@/lib/motion';
 
 /** The wide "Where would you like to dine?" bar above the footer. */
 export function BookingBar() {
-  const { restaurants, booking, setBooking, availability, openReserve, dayList, now } = useSite();
+  const { bookable, booking, setBooking, board, openReserve, days, maxParty, now, strings } = useSite();
   const title = useReveal<HTMLHeadingElement>('title');
   const panel = useReveal<HTMLDivElement>('up');
 
-  // No date during the server render, so no clock read either.
-  const at = booking.date ? now() : undefined;
+  // No board during the server render, so no clock read either.
+  const at = board ? now() : undefined;
 
-  const destinationOptions: Option<string>[] = DEST_KEYS.map((k) => ({
-    value: k,
-    label: DESTS[k],
-  }));
+  // Only places and restaurants that take bookings online (booking_enabled).
+  const destinationOptions: Option<string>[] = DEST_KEYS.filter((k) => bookable.some((r) => r.dest === k)).map(
+    (k) => ({ value: k, label: DESTS[k] }),
+  );
 
-  const restaurantOptions: Option<string>[] = restaurants
+  const restaurantOptions: Option<string>[] = bookable
     .filter((r) => r.dest === booking.destination)
     .map((r) => ({ value: r.id, label: r.name }));
 
-  const dayOptions: Option<string>[] = dayList.map((d, i) => ({
-    value: d,
-    label: fmtDay(d),
-    note: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : undefined,
-  }));
+  const dayOptions: Option<string>[] = days.map((d, i) => {
+    const open = d.state === 'open';
+    return {
+      value: d.date,
+      label: fmtDay(d.date),
+      note: open ? (i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : undefined) : dayReason({ ...d, reason: undefined }, strings),
+      hint: open ? undefined : dayReason(d, strings),
+      disabled: !open,
+    };
+  });
 
-  const timeOptions: Option<string>[] = slotsFor(restaurants, booking.restaurant).flatMap((g) =>
-    g.times.map((t) => {
-      const taken = unavailable(booking.date, t, booking.guests, availability, at);
-      const left = seatsLeft(t, availability);
-      return {
-        value: t,
-        label: t,
-        note: taken ? 'Full' : left !== null && left <= 6 ? `${left} left` : MEAL_LABELS[g.meal],
-        disabled: taken,
-      };
-    }),
-  );
+  /* Until the day's slots arrive (and in the server HTML), the field shows the chosen time as it is. */
+  const timeOptions: Option<string>[] =
+    board && at
+      ? board.periods.flatMap((p) =>
+          p.slots.map((s) => {
+            const taken = !slotOpen(board, p, s, booking.guests, at);
+            return {
+              value: s.time,
+              label: s.time,
+              note: taken ? 'Full' : s.left <= 6 ? `${s.left} left` : MEAL_LABELS[p.meal],
+              disabled: taken,
+            };
+          }),
+        )
+      : [{ value: booking.time, label: booking.time }];
 
-  const guestOptions: Option<number>[] = Array.from({ length: MAX_GUESTS }, (_, i) => ({
-    value: i + 1,
-    label: guestLabel(i + 1),
-  }));
+  /* Likewise the party: 1…maxParty once the server has said, the chosen size before. */
+  const guestOptions: Option<number>[] =
+    maxParty !== null
+      ? Array.from({ length: maxParty }, (_, i) => ({ value: i + 1, label: guestLabel(i + 1) }))
+      : [{ value: booking.guests, label: guestLabel(booking.guests) }];
 
   return (
     <section id="reserve" className="booking">
```

```diff
diff --git a/components/ui/Dropdown.tsx b/components/ui/Dropdown.tsx
index 86ddab0..1bb00f4 100644
--- a/components/ui/Dropdown.tsx
+++ b/components/ui/Dropdown.tsx
@@ -6,6 +6,8 @@ export type Option<T extends string | number> = {
   value: T;
   label: string;
   note?: string;
+  /** Longer text for a disabled option (a closure's public reason): its tooltip and accessible description. */
+  hint?: string;
   disabled?: boolean;
 };
 
@@ -60,6 +62,7 @@ export function Dropdown<T extends string | number>({
                 role="option"
                 aria-selected={selected}
                 aria-disabled={o.disabled}
+                title={o.hint}
                 className="dd-option"
                 data-selected={selected}
                 data-disabled={o.disabled}
```

Chỉ thêm selector mới:

```diff
diff --git a/styles/overlays.css b/styles/overlays.css
index f025494..a3cb33f 100644
--- a/styles/overlays.css
+++ b/styles/overlays.css
@@ -163,6 +163,41 @@
   font-variant-numeric: lining-nums;
 }
 
+/* A day that takes no bookings (closed, full, or past its last sitting):
+   the struck-through look of a taken slot. It stays focusable so its reason
+   is read out; a tap shows the reason under the strip. */
+.day:is([data-state='closed'], [data-state='full'], [data-state='past']) {
+  border-color: var(--disabled-line);
+  background: rgba(255, 255, 255, 0);
+  color: var(--disabled-time);
+  cursor: not-allowed;
+}
+
+.day:is([data-state='closed'], [data-state='full'], [data-state='past']) .day-wd,
+.day:is([data-state='closed'], [data-state='full'], [data-state='past']) .day-mo {
+  color: var(--disabled-time);
+}
+
+.day:is([data-state='closed'], [data-state='full'], [data-state='past']) .day-num {
+  text-decoration: line-through;
+  text-decoration-thickness: 1px;
+}
+
+.day-note,
+.guests-hint {
+  margin-top: 10px;
+  font-size: 12px;
+  line-height: 1.5;
+  color: var(--ink-soft);
+}
+
+.day-note a,
+.guests-hint a {
+  color: var(--green);
+  text-decoration: underline;
+  text-underline-offset: 2px;
+}
+
 .guests {
   margin-top: 22px;
   display: flex;
@@ -249,6 +284,24 @@
   cursor: not-allowed;
 }
 
+.slot-loading,
+.slotgroup-note {
+  margin-top: 8px;
+  font-size: 12px;
+  line-height: 1.5;
+  color: var(--ink-soft);
+}
+
+.slotgroup-note {
+  display: flex;
+  flex-direction: column;
+  gap: 2px;
+}
+
+.slotgroup-reason {
+  color: var(--disabled-time);
+}
+
 .drawer-error {
   margin-top: 12px;
   font-size: 12px;
```

- [ ] **Bước 9: Thu gọn `lib/booking.ts`**

Không module `'use client'` nào còn import `SLOTS`, `MAX_GUESTS`, `BOOKING_WINDOW_DAYS` hay `LEAD_MINUTES`; các helper availability của đợt 1 không còn ai dùng. Viết lại toàn bộ `lib/booking.ts`:

```ts
import type { Restaurant } from './data';
import { formatDay, type IsoDate } from './venue-time';

/*
 * The reservation form's own shapes and helpers. Availability (the window,
 * the lead time, the party limit, the slots and their covers) comes from the
 * server: GET /api/availability, read by lib/booking/client.ts.
 */

export type BookingForm = { name: string; phone: string; email: string; note: string };

export type Booking = {
  destination: string;
  restaurant: string;
  /** Da Nang calendar date; empty until the server's calendar has answered. */
  date: IsoDate | '';
  time: string;
  guests: number;
};

/** "Thu, 1 Oct". */
export const fmtDay = (d: IsoDate) => formatDay(d).label;

export const findRestaurant = (restaurants: Restaurant[], id: string) =>
  restaurants.find((r) => r.id === id);

export function validate(form: BookingForm) {
  return {
    name: form.name.trim().length >= 2,
    phone: form.phone.replace(/\D/g, '').length >= 8,
    email: !form.email.trim() || /^\S+@\S+\.\S+$/.test(form.email.trim()),
  };
}

export const guestLabel = (n: number) => `${n} ${n === 1 ? 'guest' : 'guests'}`;

/** Accent- and đ-insensitive fold, so "pho cuon" matches "Phố Cuốn". The SQL twin is fold_search() (migration 006). */
export const fold = (x: string) =>
  String(x)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');
```

Viết lại toàn bộ `lib/booking.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fold, validate } from './booking';

describe('fold', () => {
  it('ignores accents and đ so guests can search without Vietnamese input', () => {
    expect(fold('Phố Cuốn')).toBe('pho cuon');
    expect(fold('Đà Nẵng')).toBe('da nang');
  });
});

describe('validate', () => {
  it('needs a name of two letters, eight phone digits, and an email only when one is typed', () => {
    expect(validate({ name: 'An', phone: '0905 000 000', email: '', note: '' })).toEqual({ name: true, phone: true, email: true });
    expect(validate({ name: ' A ', phone: '1234 567', email: 'a@b', note: '' })).toEqual({ name: false, phone: false, email: false });
  });
});
```

- [ ] **Bước 10: API bỏ hai trường tạm**

```diff
diff --git a/app/api/availability/route.ts b/app/api/availability/route.ts
index ecab8ef..060e9cd 100644
--- a/app/api/availability/route.ts
+++ b/app/api/availability/route.ts
@@ -64,9 +64,7 @@ export async function GET(request: Request) {
           slots: p.closed ? [] : p.slots.map((s) => ({ time: s.time, left: s.left, bookable: s.bookable, ...(s.block ? { block: s.block } : {}) })),
         })),
       };
-      // Transitional, until the guest form reads v2 (phase 4, Task 6): the phase-1 client reads booked and capacity.
-      const phase1 = { booked, capacity: Math.max(0, ...rules.periods.map((p) => p.coversPerSlot)) };
-      return NextResponse.json({ ...body, ...phase1 }, { headers: NO_STORE });
+      return NextResponse.json(body, { headers: NO_STORE });
     }
 
     const start = from ?? today;
```

```diff
diff --git a/test/integration/availability.test.ts b/test/integration/availability.test.ts
index 8648eb8..703d0ba 100644
--- a/test/integration/availability.test.ts
+++ b/test/integration/availability.test.ts
@@ -174,9 +174,10 @@ describe.skipIf(!process.env.TEST_DATABASE_URL)('GET /api/availability v2 (datab
       expect(await res.json()).toMatchObject({ date: '2026-10-01', state: 'outside', periods: [] });
     });
 
-    it('still carries the phase-1 fields until the guest form moves to v2 (Task 6 removes them)', async () => {
-      await book('2026-10-03', '19:00', 4);
-      expect(await json('restaurant=taya-house&date=2026-10-03')).toMatchObject({ booked: { '19:00': 4 }, capacity: 16 });
+    it('answers exactly the v2 fields, nothing of the phase-1 shape', async () => {
+      expect(Object.keys(await json('restaurant=taya-house&date=2026-10-03')).sort()).toEqual(
+        ['date', 'leadMinutes', 'maxParty', 'now', 'periods', 'restaurant', 'sameDayCutoff', 'state', 'today'],
+      );
     });
   });
 
```

- [ ] **Bước 11: Chuyển mock của hai đặc tả cũ sang v2**

`booking-dates.spec.ts` giữ nguyên mọi khẳng định; chỉ mock đổi. Ca "đồng hồ thiết bị chậm một ngày" không còn đi vòng qua 400: lịch đến trước và bắt đầu ở 2 Oct.

```diff
diff --git a/e2e/booking-dates.spec.ts b/e2e/booking-dates.spec.ts
index f0d1b85..72740ec 100644
--- a/e2e/booking-dates.spec.ts
+++ b/e2e/booking-dates.spec.ts
@@ -1,4 +1,5 @@
 import { expect, test } from '@playwright/test';
+import { mockAvailability } from './availability-mock';
 import { serveImagesFromPublic } from './images';
 import { DETAIL_PATH, HOME_PATH } from './paths';
 
@@ -39,11 +40,7 @@ test.describe('a guest whose phone is set to Honolulu time', () => {
   test('sees Da Nang dates in the reserve drawer', async ({ page }) => {
     // 18:00 UTC on 1 Oct: still 1 Oct in Honolulu (08:00), already 2 Oct in Da Nang (01:00).
     await page.clock.setFixedTime(new Date('2026-10-01T18:00:00Z'));
-    await page.route('**/api/availability**', (route) =>
-      route.fulfill({
-        json: { today: '2026-10-02', now: '2026-10-01T18:00:00.000Z', date: '2026-10-02', booked: {}, capacity: 16 },
-      }),
-    );
+    await mockAvailability(page, { today: () => '2026-10-02', now: () => '2026-10-01T18:00:00.000Z' });
 
     await page.goto(HOME_PATH);
     await page.getByRole('button', { name: 'RESERVE', exact: true }).first().click();
@@ -58,15 +55,8 @@ test.describe('a guest whose phone is set to Honolulu time', () => {
 test("a guest whose device clock is a day behind still books from Da Nang's today", async ({ page }) => {
   // 10:00 on 1 Oct in Da Nang: the browser thinks today is 1 Oct, the server says 2 Oct.
   await page.clock.setFixedTime(new Date('2026-10-01T03:00:00Z'));
-  await page.route('**/api/availability**', (route) => {
-    const date = new URL(route.request().url()).searchParams.get('date');
-    if (date === '2026-10-01') {
-      return route.fulfill({ status: 400, json: { error: 'date out of range' } });
-    }
-    return route.fulfill({
-      json: { today: '2026-10-02', now: '2026-10-02T03:00:00.000Z', date: date ?? '2026-10-02', booked: {}, capacity: 16 },
-    });
-  });
+  // The calendar comes first and starts at 2 Oct; a stray day request for 1 Oct would answer state 'outside', as the server does.
+  await mockAvailability(page, { today: () => '2026-10-02', now: () => '2026-10-02T03:00:00.000Z' });
 
   await page.goto(HOME_PATH);
   await page.getByRole('button', { name: 'RESERVE', exact: true }).first().click();
@@ -84,13 +74,7 @@ test('reopening the drawer the next day moves Today forward', async ({ page }) =
   let serverNow = new Date('2026-10-01T03:00:00Z');
   let serverToday = '2026-10-01';
   await page.clock.setFixedTime(serverNow);
-  await page.route('**/api/availability**', (route) => {
-    const date = new URL(route.request().url()).searchParams.get('date');
-    if (date && date < serverToday) return route.fulfill({ status: 400, json: { error: 'date out of range' } });
-    return route.fulfill({
-      json: { today: serverToday, now: serverNow.toISOString(), date: date ?? serverToday, booked: {}, capacity: 16 },
-    });
-  });
+  await mockAvailability(page, { today: () => serverToday, now: () => serverNow.toISOString() });
 
   await page.goto(HOME_PATH);
   const reserve = page.getByRole('button', { name: 'RESERVE', exact: true }).first();
@@ -113,12 +97,7 @@ test('submitting after the chosen sitting has closed explains why and moves the
   // runs on to 18:45 while the guest fills in the form.
   let serverNow = new Date('2026-10-02T03:00:00Z');
   await page.clock.setFixedTime(serverNow);
-  await page.route('**/api/availability**', (route) => {
-    const date = new URL(route.request().url()).searchParams.get('date');
-    return route.fulfill({
-      json: { today: '2026-10-02', now: serverNow.toISOString(), date: date ?? '2026-10-02', booked: {}, capacity: 16 },
-    });
-  });
+  await mockAvailability(page, { today: () => '2026-10-02', now: () => serverNow.toISOString() });
   // The client gate must stop this; if it ever lets the request through, abort it.
   let reachedServer = false;
   page.on('request', (r) => {
```

Visual phải dùng mock v2 (client mới vỡ trên dạng cũ). Baseline không đổi:

```diff
diff --git a/e2e/visual.spec.ts b/e2e/visual.spec.ts
index 17de47b..9e396d7 100644
--- a/e2e/visual.spec.ts
+++ b/e2e/visual.spec.ts
@@ -1,4 +1,5 @@
 import { expect, test, type Page } from '@playwright/test';
+import { mockAvailability } from './availability-mock';
 import { PAGES } from './paths';
 
 /**
@@ -15,18 +16,7 @@ async function prepare(page: Page) {
   await page.clock.setFixedTime(FIXED_NOW);
   await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
   await page.emulateMedia({ reducedMotion: 'reduce' }); // data-motion="off": no reveals, no hero timer
-  await page.route('**/api/availability**', async (route) => {
-    const url = new URL(route.request().url());
-    await route.fulfill({
-      json: {
-        today: '2026-10-05',
-        now: FIXED_NOW.toISOString(),
-        date: url.searchParams.get('date') ?? '2026-10-05',
-        booked: {},
-        capacity: {},
-      },
-    });
-  });
+  await mockAvailability(page, { today: () => '2026-10-05', now: () => FIXED_NOW.toISOString() });
 }
 
 async function settle(page: Page) {
```

- [ ] **Bước 12: Chạy test đơn vị và typecheck**

Run: `npx vitest run lib/booking/client.test.ts lib/booking.test.ts lib/i18n/registry.test.ts && npm run typecheck`
Expected: PASS `Tests  38 passed (38)` (12 của `client.test.ts`); typecheck không lỗi.

- [ ] **Bước 13: Chạy cổng kiểm tra**

Chạy đủ khối lệnh ở "Cổng kiểm tra của mọi task", rồi chạy thêm hai đặc tả đặt bàn ba lần liền:

```bash
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson E2E_PORT=3210 npm run test:e2e -- --retries=0 --repeat-each=3 e2e/booking-v2.spec.ts e2e/booking-dates.spec.ts
```

Expected:
- typecheck không lỗi; lint thoát 0, **19** cảnh báo (bỏ effect set-state lúc mount của `SiteProvider` bớt một cảnh báo);
- `Test Files  46 passed (46)`, `Tests  474 passed (474)`;
- `Applied 6 migration(s).`; build thoát 0; check-prerender như Task 5;
- E2E `76 passed`; lần lặp `36 passed`;
- visual `8 passed`, và `git status` không có file nào dưới `e2e/__visual__/`.

- [ ] **Bước 14: Commit**

```bash
git add app/api/availability/route.ts components/booking/BookingBar.tsx components/overlays/ReserveDrawer.tsx components/site/SiteProvider.tsx components/ui/Dropdown.tsx e2e/booking-dates.spec.ts e2e/visual.spec.ts e2e/availability-mock.ts e2e/booking-v2.spec.ts lib/booking.test.ts lib/booking.ts lib/i18n/registry.ts styles/overlays.css test/integration/availability.test.ts lib/booking/client.ts lib/booking/client.test.ts
git commit -m "$(cat <<'EOF'
feat: run the guest booking form on server availability, with closed days greyed out

The reservation form no longer knows a window, a lead time, a party limit
or a slot list of its own. SiteProvider asks the calendar first (which days
take bookings, the server's today and clock, the party limit, the number to
call), then the chosen day's board; each loader lets only its newest answer
land, and a day answer marked 'outside' (a tab open past midnight) reloads
the calendar. lib/booking/client.ts holds the browser rules on top of those
answers, closing sittings with the server's own clockBlock rule.

A day that takes no bookings is greyed out in the drawer's strip and the
bar's date list, stays focusable, and says why (the public closure reason,
else Closed / Fully booked / No more tables today); a closed meal keeps its
heading with a note. The stepper and the bar stop at maxParty, with the
party_too_large hint and a tel: link. Only restaurants that book online are
listed. Before the server answers, the bar shows the chosen time and party
as they are, so the server HTML and the visual baselines are unchanged.

The phase-1 helpers and constants leave lib/booking.ts, and the API drops
the fields that kept the old client working.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

## PHẦN B: vòng đời, màn admin, cài đặt, nhật ký, nghiệm thu

Phần B chạy tiếp ngay trên commit cuối của Phần A (`d000870`). Mỗi task viết test trước, chạy cho đỏ, rồi mới viết code; mỗi task kết thúc bằng khối "Cổng kiểm tra của mọi task", và con số ở bước đó là con số đã đo trong `p4-verify`. Bước "build code hiện tại và chạy đặc tả mới" dùng ba lệnh đầu của khối cổng (reset DB, build, E2E) với đường dẫn spec đặt cuối lệnh E2E; với một spec trong project `desktop` thì thêm `--project=desktop` để không kéo project `desktop-serial` theo.

### Task 7: Nền của admin đặt bàn và bốn việc hoãn của đợt 3

Bốn việc sổ đợt 3 giao cho đợt 4, làm trước action đầu tiên của đợt 4: `actionError` để `redirect()`/`notFound()`/`forbidden()` đi qua (`unstable_rethrow`), một `clientIp()` duy nhất, `/admin/audit` phân trang keyset, và tên thật cho thực thể `staff_invitation`. Cùng lúc `ActionFailure` có `params` và các mã của đặt bàn, kèm câu tiếng Việt.

**Files:**
- Create: `lib/server/client-ip.ts`, `lib/server/client-ip.test.ts`
- Modify: `lib/server/action-result.ts`, `lib/server/action-result.test.ts`, `lib/admin/auth-errors.ts`, `lib/admin/auth-errors.test.ts`, `lib/server/dal/session.ts`, `app/admin/(auth)/accept-invite/actions.ts`, `lib/server/audit-feed.ts`, `app/admin/(shell)/audit/page.tsx`, `lib/admin/audit-labels.ts`, `lib/admin/audit-labels.test.ts`, `test/integration/audit-feed.test.ts`, `e2e/admin-audit.spec.ts`

**Interfaces:**
- Consumes: view `audit_feed` của migration 006 (Task 1: 11 cột của 005, nhánh `reservation`); `STAFF_TABLES`, `createBootstrapAdmin`, `createTestAuth`, `inviteBySql` (`test/helpers/auth.ts`); `one`, `STAFF`, `signInAs` (`e2e/staff-fixtures.ts`).
- Produces:
  - `lib/server/action-result.ts`: `ActionCode` thêm `'conflict' | 'not_allowed' | 'too_early' | 'too_late' | 'full' | 'closed' | 'slot_unavailable' | 'duplicate'`; `type ActionFailure = { ok: false; code: ActionCode; params?: Record<string, string>; fieldErrors?: Record<string, string[] | undefined> }`; `actionError(err)` gọi `unstable_rethrow(err)` trước tiên.
  - `lib/admin/auth-errors.ts`: `actionErrorMessage(code: ActionCode, params?: Record<string, string>): string` (`conflict` dùng `{by}`, `{at}`; `full` dùng `{left}`).
  - `lib/server/client-ip.ts`: `clientIp(headers: Pick<Headers, 'get'>): string | null`.
  - `lib/server/audit-feed.ts`: `AUDIT_PAGE_SIZE = 50`; `AuditFeedRow` có thêm `cursor: string`; `type AuditPage = { rows: AuditFeedRow[]; older: string | null; newer: string | null }`; `isAuditCursor(value: unknown): value is string`; `listAuditFeed(pool, options?: { before?: string | null; after?: string | null }): Promise<AuditPage>`; `entityLabels(pool, rows): Promise<Map<string, string>>` (khóa `<entity_type>:<entity_id>`). `staffEmails` bị bỏ.
  - `/admin/audit` đọc `?truoc=<cursor>` (cũ hơn) và `?sau=<cursor>` (mới hơn); liên kết "← Mới hơn", "Mới nhất", "Cũ hơn →".
  - `lib/admin/audit-labels.ts`: nhãn `reservation.created|status_changed|edited|note_added` và thực thể `reservation`, `service_periods`, `restaurant_booking`, `booking_settings`, `closure`.

- [ ] **Bước 1: Viết test cho `actionError`, câu báo và `clientIp`**

`forbidden()` chỉ chạy khi Next bật `experimental.authInterrupts`, mà Next đọc cờ đó từ biến môi trường `__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS`; Vitest không đặt nó, nên test đặt bằng `vi.stubEnv`.

```diff
diff --git a/lib/server/action-result.test.ts b/lib/server/action-result.test.ts
index ac9c6f2..b3f255d 100644
--- a/lib/server/action-result.test.ts
+++ b/lib/server/action-result.test.ts
@@ -5,6 +5,7 @@ import { PermissionError } from './dal/session';
 
 afterEach(() => {
   vi.restoreAllMocks();
+  vi.unstubAllEnvs();
 });
 
 describe('actionError', () => {
@@ -28,3 +29,23 @@ describe('actionError', () => {
     expect(JSON.stringify(logged.mock.calls)).not.toContain('secret');
   });
 });
+
+describe('actionError and Next’s control flow (unstable_rethrow)', () => {
+  it('rethrows redirect(), notFound() and forbidden() instead of turning them into db_error', async () => {
+    const { forbidden, notFound, redirect } = await import('next/navigation');
+    // next.config.ts sets experimental.authInterrupts, which Next exposes to forbidden() as this variable.
+    vi.stubEnv('__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS', '1');
+    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
+    for (const interrupt of [() => redirect('/admin/reservations/1'), () => notFound(), () => forbidden()]) {
+      let thrown: unknown;
+      try {
+        interrupt();
+      } catch (err) {
+        thrown = err;
+      }
+      expect(thrown).toBeDefined();
+      expect(() => actionError(thrown)).toThrow(thrown as Error);
+    }
+    expect(logged).not.toHaveBeenCalled();
+  });
+});
```

```diff
diff --git a/lib/admin/auth-errors.test.ts b/lib/admin/auth-errors.test.ts
index 68e666b..017d083 100644
--- a/lib/admin/auth-errors.test.ts
+++ b/lib/admin/auth-errors.test.ts
@@ -37,7 +37,24 @@ describe('actionErrorMessage', () => {
     ['last_admin', 'Không thể hạ quyền, khóa hoặc xóa Admin cuối cùng.'],
     ['self', 'Bạn không thể tự khóa hoặc tự xóa tài khoản của mình.'],
     ['invalid_token', 'Lời mời không hợp lệ, đã hết hạn hoặc đã bị thu hồi.'],
+    ['conflict', 'Vừa có người khác thay đổi mục này. Hãy tải lại trang rồi làm lại.'],
+    ['not_allowed', 'Không thể chuyển sang trạng thái này từ trạng thái hiện tại. Hãy tải lại trang.'],
+    ['too_early', 'Chưa đến lúc thực hiện thao tác này.'],
+    ['too_late', 'Đã quá thời gian cho phép (chỉ sửa được trong ngày phục vụ).'],
+    ['full', 'Khung giờ này đã hết chỗ. Muốn vẫn nhận, hãy ghi lý do vượt sức chứa.'],
+    ['closed', 'Nhà hàng đóng cửa vào bữa này trong ngày đã chọn.'],
+    ['slot_unavailable', 'Giờ này không nằm trong ca phục vụ của ngày đã chọn.'],
+    ['duplicate', 'Số điện thoại này đã có một đặt bàn đang hoạt động cùng nhà hàng, ngày và giờ.'],
   ] as const)('%s', (code, message) => expect(actionErrorMessage(code)).toBe(message));
+
+  it('says who saved first, and how many covers are left, when the action sends them', () => {
+    expect(actionErrorMessage('conflict', { by: 'Lan (lan@furama.test)', at: '19:05 02/10/2026' })).toBe(
+      'Vừa được Lan (lan@furama.test) thay đổi lúc 19:05 02/10/2026. Hãy tải lại trang rồi làm lại.',
+    );
+    expect(actionErrorMessage('conflict', { by: 'Lan', at: '' })).toBe('Vừa được Lan thay đổi. Hãy tải lại trang rồi làm lại.');
+    expect(actionErrorMessage('full', { left: '3' })).toBe('Khung giờ này chỉ còn 3 chỗ. Muốn vẫn nhận, hãy ghi lý do vượt sức chứa.');
+    expect(actionErrorMessage('full', { left: '0' })).toBe('Khung giờ này chỉ còn 0 chỗ. Muốn vẫn nhận, hãy ghi lý do vượt sức chứa.');
+  });
 });
 
 describe('inviteEmailFailedMessage', () => {
```

Create `lib/server/client-ip.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { clientIp } from './client-ip';

describe('clientIp', () => {
  const ip = (value?: string) => clientIp(new Headers(value === undefined ? {} : { 'x-forwarded-for': value }));

  it('takes the first X-Forwarded-For address, trimmed', () => {
    expect(ip('203.0.113.9, 10.0.0.1')).toBe('203.0.113.9');
    expect(ip('  2001:db8::1 ')).toBe('2001:db8::1');
  });

  it('is null without the header, or when the first entry is not an address inet accepts', () => {
    expect(ip()).toBeNull();
    expect(ip('')).toBeNull();
    expect(ip('unknown, 203.0.113.9')).toBeNull();
    // isIP() accepts an IPv6 zone id; Postgres inet does not, and the audit insert would roll the action back.
    expect(ip('fe80::1%lo0')).toBeNull();
  });
});
```

- [ ] **Bước 2: Viết test cho nhật ký keyset và nhãn**

Viết lại toàn bộ `test/integration/audit-feed.test.ts`. Test "never skips or repeats rows that share a millisecond" là lý do con trỏ giữ micro giây:

```ts
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AUDIT_PAGE_SIZE, entityLabels, isAuditCursor, listAuditFeed } from '@/lib/server/audit-feed';
import { TEST_DATABASE_URL } from '../helpers/db';
import { STAFF_TABLES, createBootstrapAdmin, createTestAuth, inviteBySql } from '../helpers/auth';

/*
 * /admin/audit reads audit_feed: audit_log ∪ reservation_events, newest first,
 * 50 to a page, keyset paging (spec §5.2, §7.2, §7.4; phase-3 ledger "Phase 4").
 */

let pool: Pool;

async function reservation(reference = 'FC-FEED0001'): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source)
     VALUES ($1, 'taya-house', '2026-10-05', '19:00', 'Dinner', 2, 'An', '0905000000', '+84905000000', 'web') RETURNING id::text`,
    [reference],
  );
  return rows[0].id;
}

describe.skipIf(!TEST_DATABASE_URL)('the audit feed', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    // The feed also shows reservation_events, and other files leave bookings behind.
    await pool.query(`TRUNCATE ${STAFF_TABLES}, reservations CASCADE`);
  });

  it('puts the newest first and breaks ties by source, then id as a number', async () => {
    await pool.query(
      `INSERT INTO audit_log (at, actor_email, action, entity_type, entity_id)
       VALUES (now() - interval '1 hour', 'a@furama.test', 'staff.invite', 'staff_invitation', 'old')`,
    );
    // Twelve rows from one statement share one `at`; the ids must sort as numbers ("9" after "10").
    await pool.query(
      `INSERT INTO audit_log (at, actor_email, action, entity_type, entity_id)
       SELECT now(), 'a@furama.test', 'staff.role', 'staff_user', 'u' || g FROM generate_series(1, 12) AS g`,
    );
    const { rows, older, newer } = await listAuditFeed(pool);
    expect([older, newer]).toEqual([null, null]);
    expect(rows.map((r) => r.entity_id)).toEqual(['u12', 'u11', 'u10', 'u9', 'u8', 'u7', 'u6', 'u5', 'u4', 'u3', 'u2', 'u1', 'old']);
    expect(rows[0]).toMatchObject({ source: 'audit', actor_label: 'a@furama.test', action: 'staff.role', entity_type: 'staff_user' });
    expect(rows[0].at).toBeInstanceOf(Date);
    expect(isAuditCursor(rows[0].cursor)).toBe(true);
  });

  it('merges reservation events into the same timeline, as reservation.<type>', async () => {
    await pool.query(
      `INSERT INTO audit_log (at, actor_email, action, entity_type, entity_id)
       VALUES (now() - interval '2 minutes', 'a@furama.test', 'update', 'closure', '7')`,
    );
    const id = await reservation();
    await pool.query(
      `INSERT INTO reservation_events (reservation_id, at, actor_kind, type, to_status)
       VALUES ($1, now() - interval '3 hours', 'guest', 'created', 'requested')`,
      [id],
    );
    await pool.query(
      `INSERT INTO reservation_events (reservation_id, at, actor_kind, actor_id, actor_label, type, from_status, to_status, reason)
       VALUES ($1, now() - interval '1 minute', 'staff', 'u1', 'Lan (lan@furama.test)', 'status_changed', 'requested', 'cancelled', 'Khách báo hủy')`,
      [id],
    );
    const { rows } = await listAuditFeed(pool);
    expect(rows.map((r) => [r.source, r.action, r.entity_type, r.entity_id, r.actor_label])).toEqual([
      ['reservation', 'reservation.status_changed', 'reservation', id, 'Lan (lan@furama.test)'],
      ['audit', 'update', 'closure', '7', 'a@furama.test'],
      ['reservation', 'reservation.created', 'reservation', id, 'Khách'],
    ]);
    expect(rows[0]).toMatchObject({ actor_id: 'u1', before: { status: 'requested' }, after: { status: 'cancelled', reason: 'Khách báo hủy' } });
    expect(rows[2]).toMatchObject({ before: null, after: { status: 'requested' } });
  });

  it('pages by 50 with keyset cursors, older and back newer', async () => {
    await pool.query(
      `INSERT INTO audit_log (at, action, entity_type, entity_id)
       SELECT now() - g * interval '1 second', 'update', 'restaurant', 'r' || g FROM generate_series(1, 55) AS g`,
    );
    const first = await listAuditFeed(pool);
    expect(AUDIT_PAGE_SIZE).toBe(50);
    expect(first.rows).toHaveLength(50);
    expect(first.newer).toBeNull();
    const second = await listAuditFeed(pool, { before: first.older });
    expect(second.rows.map((r) => r.entity_id)).toEqual(['r51', 'r52', 'r53', 'r54', 'r55']);
    expect(second.older).toBeNull();
    const back = await listAuditFeed(pool, { after: second.newer });
    expect(back.rows.map((r) => r.entity_id)).toEqual(first.rows.map((r) => r.entity_id));
    expect(back.newer).toBeNull();
  });

  it('never skips or repeats rows that share a millisecond (the cursor keeps microseconds)', async () => {
    // 65 rows, 1 µs apart: all inside one millisecond, which is all a JS Date would keep.
    await pool.query(
      `INSERT INTO audit_log (at, action, entity_type, entity_id)
       SELECT timestamptz '2026-10-02 10:00:00.000100+07' - g * interval '1 microsecond', 'update', 'restaurant', 'r' || g
         FROM generate_series(1, 65) AS g`,
    );
    const first = await listAuditFeed(pool);
    const second = await listAuditFeed(pool, { before: first.older });
    expect([...first.rows, ...second.rows].map((r) => r.entity_id)).toEqual(Array.from({ length: 65 }, (_, i) => `r${i + 1}`));
    const back = await listAuditFeed(pool, { after: second.newer });
    expect(back.rows.map((r) => r.entity_id)).toEqual(first.rows.map((r) => r.entity_id));
  });

  it('reads a malformed cursor as the newest page', async () => {
    await pool.query(`INSERT INTO audit_log (action, entity_type, entity_id) VALUES ('update', 'restaurant', 'x')`);
    expect(isAuditCursor("1_audit_1' OR 1=1")).toBe(false);
    expect((await listAuditFeed(pool, { before: "1_audit_1' OR 1=1" })).rows.map((r) => r.entity_id)).toEqual(['x']);
    expect((await listAuditFeed(pool, { after: '2' })).rows.map((r) => r.entity_id)).toEqual(['x']);
  });

  it('labels staff and invitations by email and bookings by reference', async () => {
    const owner = await createBootstrapAdmin(createTestAuth(pool));
    await inviteBySql(pool, 'moi@furama.test', 'editor');
    const { rows: invitation } = await pool.query<{ id: string }>(`SELECT id::text FROM staff_invitation WHERE email = 'moi@furama.test'`);
    const id = await reservation('FC-7K3QH9XA');
    const labels = await entityLabels(pool, [
      { entity_type: 'staff_user', entity_id: owner.id },
      { entity_type: 'staff_user', entity_id: 'removed-id' },
      { entity_type: 'staff_invitation', entity_id: invitation[0].id },
      { entity_type: 'reservation', entity_id: id },
      { entity_type: 'reservation', entity_id: 'not-a-number' },
    ]);
    expect(labels).toEqual(
      new Map([
        [`staff_user:${owner.id}`, owner.email],
        [`staff_invitation:${invitation[0].id}`, 'moi@furama.test'],
        [`reservation:${id}`, 'FC-7K3QH9XA'],
      ]),
    );
    expect(await entityLabels(pool, [])).toEqual(new Map());
  });
});
```

`audit-labels.test.ts` đọc CHECK của `reservation_events.type` trong migration 006, nên một loại sự kiện mới (đợt 5) không thể thiếu nhãn:

```diff
diff --git a/lib/admin/audit-labels.test.ts b/lib/admin/audit-labels.test.ts
index 2a66fed..2b7fd93 100644
--- a/lib/admin/audit-labels.test.ts
+++ b/lib/admin/audit-labels.test.ts
@@ -33,4 +33,23 @@ describe('audit labels', () => {
     expect(auditEntityLabel('staff_user')).toBe('Nhân viên');
     expect(auditEntityLabel('restaurant')).toBe('restaurant');
   });
+
+  it('names every reservation event type of migration 006, as audit_feed shows it (reservation.<type>)', () => {
+    const migration = readFileSync('db/migrations/006_booking_v2.sql', 'utf8');
+    const check = /type\s+text\s+NOT NULL CHECK \(type IN \(([^)]*)\)\)/.exec(migration)?.[1] ?? '';
+    const types = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
+    expect(types).toEqual(['created', 'status_changed', 'edited', 'note_added']);
+    for (const type of types) expect(auditActionLabel(`reservation.${type}`)).not.toBe(`reservation.${type}`);
+    expect(auditActionLabel('reservation.status_changed')).toBe('Đổi trạng thái đặt bàn');
+  });
+
+  it('names the booking entities: the reservation, and the configuration phase 4 writes to audit_log', () => {
+    expect(['reservation', 'service_periods', 'restaurant_booking', 'booking_settings', 'closure'].map(auditEntityLabel)).toEqual([
+      'Đặt bàn',
+      'Ca phục vụ',
+      'Quy tắc đặt bàn',
+      'Cài đặt đặt bàn',
+      'Ngày đóng cửa',
+    ]);
+  });
 });
```

- [ ] **Bước 3: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/server/action-result.test.ts lib/admin/auth-errors.test.ts lib/server/client-ip.test.ts lib/admin/audit-labels.test.ts test/integration/audit-feed.test.ts`
Expected: FAIL `Test Files  5 failed (5)`, `Tests  18 failed | 29 passed (47)`:

```
 FAIL  lib/server/client-ip.test.ts [ lib/server/client-ip.test.ts ]
Error: Cannot find module './client-ip' imported from …/lib/server/client-ip.test.ts
 FAIL  lib/admin/audit-labels.test.ts > audit labels > names every reservation event type of migration 006, as audit_feed shows it (reservation.<type>)
AssertionError: expected 'reservation.created' not to be 'reservation.created' // Object.is equality
 FAIL  lib/admin/audit-labels.test.ts > audit labels > names the booking entities: the reservation, and the configuration phase 4 writes to audit_log
AssertionError: expected [ 'reservation', …(4) ] to deeply equal [ 'Đặt bàn', 'Ca phục vụ', …(3) ]
 FAIL  lib/admin/auth-errors.test.ts > actionErrorMessage > conflict
AssertionError: expected undefined to be 'Vừa có người khác thay đổi mục này. H…' // Object.is equality
 …(the same for not_allowed, too_early, too_late, full, closed, slot_unavailable, duplicate)
 FAIL  lib/admin/auth-errors.test.ts > actionErrorMessage > says who saved first, and how many covers are left, when the action sends them
AssertionError: expected undefined to be 'Vừa được Lan (lan@furama.test) thay đ…' // Object.is equality
 FAIL  lib/server/action-result.test.ts > actionError and Next’s control flow (unstable_rethrow) > rethrows redirect(), notFound() and forbidden() instead of turning them into db_error
AssertionError: expected function to throw an error, but it didn't
 FAIL  test/integration/audit-feed.test.ts > the audit feed > puts the newest first and breaks ties by source, then id as a number
error: invalid input syntax for type bigint: "NaN"
 …(merges reservation events…, pages by 50…, never skips or repeats…: the same error)
 FAIL  test/integration/audit-feed.test.ts > the audit feed > reads a malformed cursor as the newest page
TypeError: isAuditCursor is not a function
 FAIL  test/integration/audit-feed.test.ts > the audit feed > labels staff and invitations by email and bookings by reference
TypeError: entityLabels is not a function
```

- [ ] **Bước 4: Viết E2E của `/admin/audit`**

Test phân trang tự chèn 60 dòng năm 2001 (cũ hơn mọi dòng khác) và một dòng "bây giờ", rồi mở trang bằng một con trỏ dựng tay ngay sau dòng mới nhất của năm 2001, nên không phụ thuộc DB rỗng hay đầy, và xóa dòng của mình trong `finally`. Đặt bàn mẫu dùng ngày đã qua và trạng thái `confirmed`, nên không lọt vào tab hay cửa sổ của spec khác.

```diff
diff --git a/e2e/admin-audit.spec.ts b/e2e/admin-audit.spec.ts
index 617c674..171ae19 100644
--- a/e2e/admin-audit.spec.ts
+++ b/e2e/admin-audit.spec.ts
@@ -1,7 +1,7 @@
 import { randomBytes } from 'node:crypto';
 import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';
 
-/* /admin/audit (spec §7.2): Admin only, newest first, in Vietnamese. */
+/* /admin/audit (spec §7.2, §7.4): Admin only, newest first, in Vietnamese, booking events included, keyset pages. */
 
 test.beforeAll(() => seedStaff());
 
@@ -25,6 +25,82 @@ test('the Admin reads a role change, with who did it and when', async ({ page })
   await expect(row.locator('pre')).toContainText('"role": "admin"');
 });
 
+test('a booking event shows the booking’s reference, and an invitation its email', async ({ page }) => {
+  const tag = randomBytes(4).toString('hex').toUpperCase().replace(/[ILOU]/g, '7');
+  const reference = `FC-E2E${tag.slice(0, 5)}`;
+  const booking = await one<{ id: string }>(
+    // A past date and a settled status: no booking window or inbox tab of another spec sees it.
+    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, status, source)
+     VALUES ($1, 'taya-house', '2025-12-31', '19:00', 'Dinner', 2, 'Khách E2E', '0905000000', '+849050' || $2, 'confirmed', 'web') RETURNING id::text`,
+    [reference, String(Date.now()).slice(-5)],
+  );
+  await one(
+    `INSERT INTO reservation_events (reservation_id, actor_kind, actor_id, actor_label, type, from_status, to_status)
+     VALUES ($1, 'staff', $2, $3, 'status_changed', 'requested', 'confirmed')`,
+    [booking!.id, STAFF.editor.id, `${STAFF.editor.name} (${STAFF.editor.email})`],
+  );
+  const email = `moi-${tag.toLowerCase()}@furama.test`;
+  const invitation = await one<{ id: string }>(
+    `INSERT INTO staff_invitation (email, role, token_hash, expires_at) VALUES ($1, 'editor', $2, now() + interval '7 days') RETURNING id::text`,
+    [email, randomBytes(32).toString('hex')],
+  );
+  await one(`INSERT INTO audit_log (actor_email, action, entity_type, entity_id) VALUES ($1, 'staff.invite', 'staff_invitation', $2)`, [
+    STAFF.admin.email,
+    invitation!.id,
+  ]);
+  await signInAs(page, STAFF.admin);
+  await page.goto('/admin/audit');
+  const event = page.getByRole('row').filter({ hasText: reference });
+  await expect(event.getByRole('cell').nth(1)).toHaveText(`${STAFF.editor.name} (${STAFF.editor.email})`);
+  await expect(event.getByRole('cell').nth(2)).toHaveText('Đổi trạng thái đặt bàn');
+  await expect(event.getByRole('cell').nth(3)).toHaveText(`Đặt bàn · ${reference}`);
+  await expect(page.getByRole('row').filter({ hasText: email }).getByRole('cell').nth(3)).toHaveText(`Lời mời · ${email}`);
+});
+
+test('the Admin pages back and forth through older entries', async ({ page }) => {
+  const tag = `e2e-page-${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
+  // Sixty entries from 2001, older than anything else in the log (the pages read below hold only these),
+  // and one from now, so the newest page is never the 2001 one.
+  await one(
+    `INSERT INTO audit_log (at, actor_email, action, entity_type, entity_id)
+     SELECT timestamptz '2001-01-01 00:00:00+00' + g * interval '1 second', $1, 'update', 'restaurant', $2 || '-' || lpad(g::text, 2, '0')
+       FROM generate_series(1, 60) AS g
+     UNION ALL SELECT now(), $1, 'update', 'restaurant', $2 || '-now'`,
+    [STAFF.admin.email, tag],
+  );
+  try {
+    await signInAs(page, STAFF.admin);
+    // A cursor just after the newest of them (00:01:00 → 00:01:01, in microseconds since the epoch).
+    await page.goto(`/admin/audit?truoc=${Date.UTC(2001, 0, 1, 0, 1, 1) * 1000}_audit_0`);
+    const pager = page.getByRole('navigation', { name: 'Phân trang' });
+    const ours = page.getByRole('row').filter({ hasText: tag });
+    await expect(ours).toHaveCount(50);
+    await expect(ours.first().getByRole('cell').nth(3)).toHaveText(`restaurant · ${tag}-60`);
+    await expect(ours.last().getByRole('cell').nth(3)).toHaveText(`restaurant · ${tag}-11`);
+
+    await pager.getByRole('link', { name: 'Cũ hơn →' }).click();
+    await expect(ours).toHaveCount(10);
+    await expect(ours.first().getByRole('cell').nth(3)).toHaveText(`restaurant · ${tag}-10`);
+    await expect(pager.getByRole('link', { name: 'Cũ hơn →' })).toHaveCount(0);
+
+    await pager.getByRole('link', { name: '← Mới hơn' }).click();
+    await expect(ours).toHaveCount(50);
+    await expect(ours.first().getByRole('cell').nth(3)).toHaveText(`restaurant · ${tag}-60`);
+    await pager.getByRole('link', { name: 'Mới nhất' }).click();
+    await expect(page).toHaveURL(/\/admin\/audit$/);
+    await expect(page.getByRole('row').filter({ hasText: `${tag}-now` })).toBeVisible();
+    await expect(pager.getByRole('link', { name: '← Mới hơn' })).toHaveCount(0);
+
+    // A page link from phase 3 (?trang=) lands on the newest page.
+    await page.goto('/admin/audit?trang=2');
+    await expect(page.getByRole('heading', { name: 'Nhật ký', level: 1 })).toBeVisible();
+    await expect(page.getByRole('row').filter({ hasText: `${tag}-now` })).toBeVisible();
+    await expect(pager.getByRole('link', { name: 'Mới nhất' })).toHaveCount(0);
+  } finally {
+    await one(`DELETE FROM audit_log WHERE entity_id LIKE $1`, [`${tag}-%`]);
+  }
+});
+
 test('an Editor gets the 403 view and no audit rows', async ({ page }) => {
   await signInAs(page, STAFF.editor);
   await expect(page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link', { name: 'Nhật ký' })).toHaveCount(0);
```

- [ ] **Bước 5: Viết `actionError`, câu báo và `clientIp`**

Viết lại toàn bộ `lib/server/action-result.ts`:

```ts
import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { z } from '@/lib/admin/zod';
import { PermissionError } from '@/lib/server/dal/session';

/*
 * What every admin Server Action returns (spec §7.4, §6.3.5), and how a thrown
 * error becomes one. Actions never throw to the client: a PermissionError is
 * `forbidden` (unauthenticated included: the browser learns nothing more), a
 * ZodError is `invalid` with Vietnamese field messages, anything else is a
 * logged `db_error` whose message is never echoed. Next's own control-flow
 * throws (redirect(), notFound(), forbidden()) pass straight through, so an
 * action may call redirect() inside its try.
 */
export type ActionCode =
  | 'forbidden'
  | 'invalid'
  | 'db_error'
  | 'already_staff'
  | 'already_invited'
  | 'not_found'
  | 'last_admin'
  | 'self'
  | 'invalid_token'
  // Reservations and booking configuration (spec §10.2, §10.3, §12).
  /** Someone else saved first (version / updated_at); params.by and params.at say who and when. */
  | 'conflict'
  /** No transition from the current status to the requested one. */
  | 'not_allowed'
  /** Outside the transition's time window (seated from 60 min before, no-show 15 min after, corrections same service day). */
  | 'too_early'
  | 'too_late'
  /** The slot has no room; params.left says how many covers remain. Staff may still book with a reason. */
  | 'full'
  /** A closure takes out that service on that date. */
  | 'closed'
  /** The time is not a slot of that day's services. */
  | 'slot_unavailable'
  /** Same restaurant, date, time and phone as an active booking (reservations_dedupe_v2_idx). */
  | 'duplicate';

export type ActionFailure = {
  ok: false;
  code: ActionCode;
  params?: Record<string, string>;
  fieldErrors?: Record<string, string[] | undefined>;
};
export type ActionResult<T = null> = { ok: true; data: T } | ActionFailure;

export function actionError(err: unknown): ActionFailure {
  // First (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/unstable_rethrow.md:62):
  // redirect(), notFound() and forbidden() are not failures.
  unstable_rethrow(err);
  if (err instanceof PermissionError) return { ok: false, code: 'forbidden' };
  if (err instanceof z.ZodError) return { ok: false, code: 'invalid', fieldErrors: z.flattenError(err).fieldErrors };
  console.error('[admin] action failed', { code: 'db_error', name: err instanceof Error ? err.name : typeof err });
  return { ok: false, code: 'db_error' };
}
```

```diff
diff --git a/lib/admin/auth-errors.ts b/lib/admin/auth-errors.ts
index 6be5fac..78b2df7 100644
--- a/lib/admin/auth-errors.ts
+++ b/lib/admin/auth-errors.ts
@@ -52,9 +52,24 @@ const ACTION_MESSAGES: Record<ActionCode, string> = {
   last_admin: 'Không thể hạ quyền, khóa hoặc xóa Admin cuối cùng.',
   self: 'Bạn không thể tự khóa hoặc tự xóa tài khoản của mình.',
   invalid_token: 'Lời mời không hợp lệ, đã hết hạn hoặc đã bị thu hồi.',
+  conflict: 'Vừa có người khác thay đổi mục này. Hãy tải lại trang rồi làm lại.',
+  not_allowed: 'Không thể chuyển sang trạng thái này từ trạng thái hiện tại. Hãy tải lại trang.',
+  too_early: 'Chưa đến lúc thực hiện thao tác này.',
+  too_late: 'Đã quá thời gian cho phép (chỉ sửa được trong ngày phục vụ).',
+  full: 'Khung giờ này đã hết chỗ. Muốn vẫn nhận, hãy ghi lý do vượt sức chứa.',
+  closed: 'Nhà hàng đóng cửa vào bữa này trong ngày đã chọn.',
+  slot_unavailable: 'Giờ này không nằm trong ca phục vụ của ngày đã chọn.',
+  duplicate: 'Số điện thoại này đã có một đặt bàn đang hoạt động cùng nhà hàng, ngày và giờ.',
 };
 
-export function actionErrorMessage(code: ActionCode): string {
+/** `params` fills in the codes that carry details: who saved first and when, the covers left. */
+export function actionErrorMessage(code: ActionCode, params?: Record<string, string>): string {
+  if (code === 'conflict' && params?.by) {
+    return `Vừa được ${params.by} thay đổi${params.at ? ` lúc ${params.at}` : ''}. Hãy tải lại trang rồi làm lại.`;
+  }
+  if (code === 'full' && params?.left !== undefined) {
+    return `Khung giờ này chỉ còn ${params.left} chỗ. Muốn vẫn nhận, hãy ghi lý do vượt sức chứa.`;
+  }
   return ACTION_MESSAGES[code];
 }
 
```

Create `lib/server/client-ip.ts`:

```ts
import { isIP } from 'node:net';

/*
 * The client's address for audit_log.ip and Better Auth's per-IP limits: the
 * first X-Forwarded-For entry. Vercel sets that header itself (the client's
 * address first), so it is trustworthy there; self-hosted, a proxy must do the
 * same (phase 3, risk 3). Only a real IPv4/IPv6 address comes back: Postgres
 * inet rejects anything else (an IPv6 zone id such as 'fe80::1%lo0' passes
 * isIP but not inet), and a rejected insert would roll back the action.
 */
export function clientIp(headers: Pick<Headers, 'get'>): string | null {
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (!first || first.includes('%') || isIP(first) === 0) return null;
  return first;
}
```

DAL và action nhận lời mời dùng nó thay bản tự viết của mình:

```diff
diff --git a/lib/server/dal/session.ts b/lib/server/dal/session.ts
index a1c3866..77011cf 100644
--- a/lib/server/dal/session.ts
+++ b/lib/server/dal/session.ts
@@ -6,6 +6,7 @@ import { cache } from 'react';
 import { ADMIN_SIGN_IN } from '@/lib/admin/paths';
 import type { AuditActor } from '@/lib/server/audit';
 import { getAuth } from '@/lib/server/auth/auth';
+import { clientIp } from '@/lib/server/client-ip';
 import { isStaffRole, roleCan, type Permissions, type StaffRole } from '@/lib/server/auth/permissions';
 
 /*
@@ -20,7 +21,7 @@ export type StaffSession = {
   email: string;
   name: string;
   role: StaffRole;
-  /** For audit_log.ip: the first X-Forwarded-For address (Vercel sets one, the client's). */
+  /** For audit_log.ip: see clientIp(). */
   ip: string | null;
 };
 
@@ -52,7 +53,7 @@ export const getStaffSession = cache(async (): Promise<StaffSession | null> => {
     email: user.email,
     name: user.name,
     role: user.role,
-    ip: requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
+    ip: clientIp(requestHeaders),
   };
 });
 
```

```diff
diff --git a/app/admin/(auth)/accept-invite/actions.ts b/app/admin/(auth)/accept-invite/actions.ts
index 5a2f90c..0b41099 100644
--- a/app/admin/(auth)/accept-invite/actions.ts
+++ b/app/admin/(auth)/accept-invite/actions.ts
@@ -7,6 +7,7 @@ import { z } from '@/lib/admin/zod';
 import { actionError, type ActionResult } from '@/lib/server/action-result';
 import { getAuth, staffDeps } from '@/lib/server/auth/auth';
 import { acceptInvitation as accept } from '@/lib/server/auth/staff';
+import { clientIp } from '@/lib/server/client-ip';
 
 const AcceptInput = z.object({
   token: z.string(),
@@ -39,8 +40,7 @@ async function createAccount(formData: FormData): Promise<ActionResult> {
       password: formData.get('password'),
     });
     const requestHeaders = await headers();
-    const ip = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
-    const result = await accept(staffDeps(), input, ip);
+    const result = await accept(staffDeps(), input, clientIp(requestHeaders));
     if (!result.ok) return result;
     // The one auth.api sign-in in the app: the account was created a moment ago
     // with this password. nextCookies() puts the session cookie on this response.
```

- [ ] **Bước 6: Viết nhật ký keyset, nhãn thực thể và trang**

Khóa sắp xếp là `(at, source, id::bigint)`: các dòng của một transaction có cùng `at`, nên nguồn rồi id (dạng số) phá thế hòa. Con trỏ `<µs>_<source>_<id>` phải khớp một regex trước khi chạm SQL; con trỏ sai cho trang mới nhất. EXPLAIN của spike admin ở 100k dòng mỗi bảng: Merge Append trên `audit_log_at_idx` và `reservation_events_at_idx`, 0,05 ms (rủi ro 14). Viết lại toàn bộ `lib/server/audit-feed.ts`:

```ts
import 'server-only';
import type { Pool } from 'pg';

/*
 * /admin/audit reads the audit_feed view (spec §5.2, §7.4): audit_log and
 * reservation_events on one timeline, newest first. Keyset paging on
 * (at, source, id::bigint): rows written in one transaction share `at`, so
 * the source and then the numeric id break the tie. The cursor carries `at` in
 * microseconds since the epoch, exactly: a JS Date keeps only milliseconds and
 * would skip or repeat rows that share one.
 */

export const AUDIT_PAGE_SIZE = 50;

export type AuditFeedRow = {
  source: string;
  id: string;
  at: Date;
  actor_id: string | null;
  actor_label: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  locale: string | null;
  before: unknown;
  after: unknown;
  /** This row's position, `<µs>_<source>_<id>`, for the links to the next page. */
  cursor: string;
};

export type AuditPage = {
  rows: AuditFeedRow[];
  /** Cursor for the page of older rows, or null at the end. */
  older: string | null;
  /** Cursor for the page of newer rows, or null on the newest page. */
  newer: string | null;
};

const CURSOR = /^(\d{1,17})_(audit|reservation)_(\d{1,18})$/;

export function isAuditCursor(value: unknown): value is string {
  return typeof value === 'string' && CURSOR.test(value);
}

const SELECT = `SELECT source, id, at, actor_id, actor_label, action, entity_type, entity_id, locale, before, after,
       (extract(epoch FROM at) * 1000000)::bigint::text || '_' || source || '_' || id AS cursor
  FROM audit_feed`;
const KEY = `(at, source, id::bigint)`;
const AT = (p: string) => `timestamptz 'epoch' + ${p}::bigint * interval '1 microsecond'`;

/**
 * One page. `before`: the rows older than that cursor (the "Cũ hơn" link);
 * `after`: the rows newer than it ("Mới hơn"); neither, or a malformed
 * cursor: the newest page.
 */
export async function listAuditFeed(pool: Pool, options: { before?: string | null; after?: string | null } = {}): Promise<AuditPage> {
  const before = options.before ? CURSOR.exec(options.before) : null;
  const after = !before && options.after ? CURSOR.exec(options.after) : null;
  const limit = AUDIT_PAGE_SIZE + 1;

  if (after) {
    // Read upwards from the cursor, then show newest first like every other page.
    const { rows } = await pool.query<AuditFeedRow>(
      `${SELECT} WHERE ${KEY} > (${AT('$1')}, $2, $3::bigint) ORDER BY at, source, id::bigint LIMIT ${limit}`,
      [after[1], after[2], after[3]],
    );
    const page = rows.slice(0, AUDIT_PAGE_SIZE).reverse();
    return { rows: page, older: page.at(-1)?.cursor ?? null, newer: rows.length > AUDIT_PAGE_SIZE ? page[0].cursor : null };
  }

  const { rows } = before
    ? await pool.query<AuditFeedRow>(
        `${SELECT} WHERE ${KEY} < (${AT('$1')}, $2, $3::bigint) ORDER BY at DESC, source DESC, id::bigint DESC LIMIT ${limit}`,
        [before[1], before[2], before[3]],
      )
    : await pool.query<AuditFeedRow>(`${SELECT} ORDER BY at DESC, source DESC, id::bigint DESC LIMIT ${limit}`);
  const page = rows.slice(0, AUDIT_PAGE_SIZE);
  return {
    rows: page,
    older: rows.length > AUDIT_PAGE_SIZE ? page[page.length - 1].cursor : null,
    newer: before && page.length > 0 ? page[0].cursor : null,
  };
}

/**
 * What to show for each row's entity instead of a raw id: a staff member's
 * or an invitation's email, a booking's reference. A removed account keeps
 * its id (the log outlives the account).
 */
export async function entityLabels(
  pool: Pool,
  rows: readonly Pick<AuditFeedRow, 'entity_type' | 'entity_id'>[],
): Promise<Map<string, string>> {
  const ids = (type: string) => [...new Set(rows.filter((r) => r.entity_type === type && r.entity_id).map((r) => r.entity_id as string))];
  const numeric = (list: string[]) => list.filter((id) => /^\d{1,18}$/.test(id));
  const staff = ids('staff_user');
  const invitations = numeric(ids('staff_invitation'));
  const reservations = numeric(ids('reservation'));
  if (staff.length + invitations.length + reservations.length === 0) return new Map();
  const { rows: labels } = await pool.query<{ key: string; label: string }>(
    `SELECT 'staff_user:' || id AS key, email AS label FROM staff_user WHERE id = ANY($1::text[])
     UNION ALL SELECT 'staff_invitation:' || id, email FROM staff_invitation WHERE id = ANY($2::bigint[])
     UNION ALL SELECT 'reservation:' || id, reference FROM reservations WHERE id = ANY($3::bigint[])`,
    [staff, invitations, reservations],
  );
  return new Map(labels.map((l) => [l.key, l.label]));
}
```

Viết lại toàn bộ `app/admin/(shell)/audit/page.tsx` (liên kết `?trang=` cũ rơi về trang mới nhất; khối `<nav>` rỗng của trang duy nhất không còn):

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { auditActionLabel, auditEntityLabel } from '@/lib/admin/audit-labels';
import { formatDateTimeVi } from '@/lib/admin/format';
import { entityLabels, isAuditCursor, listAuditFeed } from '@/lib/server/audit-feed';
import { requirePagePermission } from '@/lib/server/dal/session';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Nhật ký' };

type Search = { truoc?: string | string[]; sau?: string | string[] };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  // Before any query: an Editor gets the 403 view and no rows.
  await requirePagePermission({ audit: ['read'] });
  const { truoc, sau } = await searchParams;
  const pool = getPool();
  // ?truoc=<cursor>: older than that row; ?sau=<cursor>: newer. Anything else (a phase-3 ?trang= link
  // included) reads as the newest page.
  const { rows, older, newer } = await listAuditFeed(pool, {
    before: isAuditCursor(truoc) ? truoc : null,
    after: isAuditCursor(sau) ? sau : null,
  });
  const labels = await entityLabels(pool, rows);

  return (
    <>
      <h1>Nhật ký</h1>
      <p className="a-lede">Ai đã làm gì, và lúc nào, kể cả thao tác trên đặt bàn. Mới nhất ở trên.</p>
      {rows.length === 0 ? (
        <p className="a-lede">Chưa có mục nào.</p>
      ) : (
        <table className="a-table">
          <thead>
            <tr>
              <th scope="col">Thời gian</th>
              <th scope="col">Người thực hiện</th>
              <th scope="col">Thao tác</th>
              <th scope="col">Đối tượng</th>
              <th scope="col">Chi tiết</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.source}:${r.id}`}>
                <td>{formatDateTimeVi(r.at)}</td>
                <td>{r.actor_label ?? 'Hệ thống'}</td>
                <td>{auditActionLabel(r.action)}</td>
                <td>{`${auditEntityLabel(r.entity_type)} · ${(r.entity_id && labels.get(`${r.entity_type}:${r.entity_id}`)) ?? r.entity_id ?? '—'}`}</td>
                <td>
                  {r.before === null && r.after === null ? (
                    '—'
                  ) : (
                    <details>
                      <summary>Xem</summary>
                      <pre className="a-pre">{JSON.stringify({ trước: r.before, sau: r.after }, null, 2)}</pre>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {newer || older ? (
        <nav className="a-pager" aria-label="Phân trang">
          {newer ? <Link href={`/admin/audit?sau=${newer}`}>← Mới hơn</Link> : null}
          {newer ? <Link href="/admin/audit">Mới nhất</Link> : null}
          {older ? <Link href={`/admin/audit?truoc=${older}`}>Cũ hơn →</Link> : null}
        </nav>
      ) : null}
    </>
  );
}
```

```diff
diff --git a/lib/admin/audit-labels.ts b/lib/admin/audit-labels.ts
index d80c1eb..e228e34 100644
--- a/lib/admin/audit-labels.ts
+++ b/lib/admin/audit-labels.ts
@@ -1,8 +1,9 @@
 /*
- * Vietnamese names for audit_log.action and entity_type on /admin/audit.
+ * Vietnamese names for audit_feed.action and entity_type on /admin/audit.
  * The action list is spec §5.2's (create, update, delete, reorder, restore,
- * settings, staff.*); lib/admin/audit-labels.test.ts fails when the code
- * writes a staff action this file does not name.
+ * settings, staff.*) plus reservation.<type> from reservation_events (§7.4);
+ * lib/admin/audit-labels.test.ts fails when the code writes a staff action,
+ * or migration 006 allows an event type, that this file does not name.
  */
 const ACTIONS: Record<string, string> = {
   create: 'Tạo mới',
@@ -20,11 +21,22 @@ const ACTIONS: Record<string, string> = {
   'staff.ban': 'Khóa tài khoản',
   'staff.unban': 'Mở khóa tài khoản',
   'staff.remove': 'Xóa tài khoản',
+  // reservation_events through audit_feed: 'reservation.' || type.
+  'reservation.created': 'Tạo đặt bàn',
+  'reservation.status_changed': 'Đổi trạng thái đặt bàn',
+  'reservation.edited': 'Sửa đặt bàn',
+  'reservation.note_added': 'Thêm ghi chú nội bộ',
 };
 
 const ENTITIES: Record<string, string> = {
   staff_user: 'Nhân viên',
   staff_invitation: 'Lời mời',
+  reservation: 'Đặt bàn',
+  // Booking configuration (audit_log): the periods of one restaurant, its switch and overrides, the defaults, a closure.
+  service_periods: 'Ca phục vụ',
+  restaurant_booking: 'Quy tắc đặt bàn',
+  booking_settings: 'Cài đặt đặt bàn',
+  closure: 'Ngày đóng cửa',
 };
 
 export function auditActionLabel(action: string): string {
```

- [ ] **Bước 7: Chạy lại test**

Run: lệnh ở Bước 3.
Expected: PASS `Test Files  5 passed (5)`, `Tests  49 passed (49)`

- [ ] **Bước 8: Kiểm hai guard của task: phải đỏ khi bị gỡ**

Lần lượt, và trả file về sau mỗi lần:
1. Trong `lib/server/action-result.ts`, xóa dòng `unstable_rethrow(err);`. Run: `npx vitest run lib/server/action-result.test.ts`. Expected: `Tests  1 failed | 3 passed (4)`, với `× rethrows redirect(), notFound() and forbidden() instead of turning them into db_error`.
2. Trong `lib/server/audit-feed.ts`, đổi `(extract(epoch FROM at) * 1000000)::bigint::text` thành `(extract(epoch FROM date_trunc('milliseconds', at)) * 1000000)::bigint::text` (con trỏ chỉ còn mili giây). Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/audit-feed.test.ts`. Expected: `Tests  2 failed | 4 passed (6)`:

```
     × pages by 50 with keyset cursors, older and back newer
     × never skips or repeats rows that share a millisecond (the cursor keeps microseconds)
```

- [ ] **Bước 9: Chạy cổng kiểm tra**

Expected: typecheck không lỗi; lint thoát 0, 19 cảnh báo; `Test Files  47 passed (47)`, `Tests  490 passed (490)`; `Applied 6 migration(s).`; build thoát 0; check-prerender như Task 5; E2E `78 passed`; visual `8 passed`.

- [ ] **Bước 10: Commit**

```bash
git add lib/server/action-result.ts lib/server/action-result.test.ts lib/admin/auth-errors.ts lib/admin/auth-errors.test.ts lib/server/client-ip.ts lib/server/client-ip.test.ts lib/server/dal/session.ts "app/admin/(auth)/accept-invite/actions.ts" lib/server/audit-feed.ts "app/admin/(shell)/audit/page.tsx" lib/admin/audit-labels.ts lib/admin/audit-labels.test.ts test/integration/audit-feed.test.ts e2e/admin-audit.spec.ts
git commit -m "$(cat <<'EOF'
feat: let Next's redirects through actionError, extract clientIp, and page the audit log by keyset

The phase-3 items owed to phase 4, before its first action. actionError
calls unstable_rethrow first, so redirect(), notFound() and forbidden()
inside an action's try are no longer turned into db_error; an action may
now redirect from inside its try. ActionFailure gains params, with the new
codes conflict {by, at}, not_allowed, too_early, too_late, full {left},
closed, slot_unavailable and duplicate, and their Vietnamese messages.

clientIp() is the one place that reads X-Forwarded-For (the DAL and
accept-invite used their own copies) and returns only an address inet
accepts.

/admin/audit reads audit_log and the reservation timeline as one feed,
paged by keyset (?truoc=, ?sau=) on (at, source, id) with a microsecond
cursor: rows that share a millisecond are neither skipped nor repeated,
which a millisecond cursor was shown to do. A phase-3 ?trang= link lands on
the newest page. Invitations show their email, bookings their reference,
and reservation events and the booking configuration entities have
Vietnamese labels.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 8: Vòng đời đặt bàn và các lần ghi của nhân viên (chưa có giao diện)

Spec §10.3 thành một map TypeScript có cửa sổ thời gian, và mọi lần ghi của nhân viên lên một đặt bàn: chuyển trạng thái (version lạc quan, câu báo xung đột nêu người thắng), tạo qua điện thoại hoặc khách vãng lai, sửa (dời hay tăng số khách thì kiểm lại sức chứa), ghi chú nội bộ. Mỗi lần ghi là một transaction cùng một hàng `reservation_events`, không bao giờ `audit_log` (§7.4). Tạo và sửa lấy chỗ đi qua đúng `lockBookingDay` của khách (Task 3), rồi mới đọc quy tắc và số chỗ; slot của nhân viên lấy từ `planDay` (R8).

**Files:**
- Create: `lib/reservations/lifecycle.ts`, `lib/reservations/lifecycle.test.ts`, `lib/server/booking/reservations.ts`, `test/integration/reservation-lifecycle.test.ts`
- Modify: `lib/booking/resolve-day.ts`, `lib/booking/resolve-day.test.ts`, `lib/server/booking/rules.ts`, `test/integration/booking-rules.test.ts`

**Interfaces:**
- Consumes: `planDay`, `PlannedPeriod` (Task 2); `HOLDING_STATUSES`, `RESERVATION_STATUSES`, `ReservationStatus` (`lib/booking/rules.ts`); `loadRestaurantRules`, `loadBookedCovers`, `lockBookingDay` (Task 3); `createWebReservation`, `parseReservationInput` (Task 4, trong test xuyên đường); `withTransaction` (`lib/server/audit.ts`); `formatDateTimeVi` (`lib/admin/format.ts`); `newReference` (`lib/server/reference.ts`).
- Produces:
  - `lib/booking/resolve-day.ts`: `findPlannedSlot(plan: { periods: PlannedPeriod[] }, time: string): { period: PlannedPeriod; capacity: number } | null`.
  - `lib/server/booking/rules.ts`: `loadBookedCovers(db, restaurantId, from, to, excludeId: string | null = null)`.
  - `lib/reservations/lifecycle.ts`: `UPCOMING_STATUSES` (`['requested', 'confirmed']`), `STATUS_LABELS`, `type TimeWindow`, `type Transition = { from; to; window; reason: 'required' | 'optional'; guestEmail: { event; when: 'always' | 'if_notify' } | null; label }`, `TRANSITIONS`, `findTransition(from, to)`, `transitionsFrom(from)`, `sourcesOf(to)`, `STAFF_SOURCES`, `type StaffSource = 'phone' | 'walk_in'`, `SOURCE_LABELS`, `SERVICE_DAY_ROLLOVER_MINUTES = 240`, `serviceDay(now?)`, `type WindowCheck`, `checkWindow(t, date, time, now?)`, `opensAtMinutes(t, time): number | null`, `availableTransitions(status, date, time, now?)`.
  - `lib/server/booking/reservations.ts`: `type ReservationActor = { id: string; label: string }`; `staffActor(staff: { userId; name; email })`; `type ReservationEffects = { afterTransition?(client, { reservationId, transition, eventId, notifyGuest }); afterCreate?(client, { reservationId, status, eventId, notifyGuest }) }`; `transitionReservation(pool, actor, { id, version, to, reason, notifyGuest }, { now?, effects? })`; `createStaffReservation(pool, actor, StaffBookingInput, { now?, effects?, makeReference? })` → `{ ok: true; data: { id; reference } }` hoặc `closed | slot_unavailable | full {left} | invalid | not_found | duplicate`; `editReservation(pool, actor, EditInput)` → `{ ok: true; data: { version; changed } }` hoặc `conflict | not_allowed | closed | slot_unavailable | full | duplicate | not_found`; `addReservationNote(pool, actor, { id, body })` → `{ ok: true; data: { noteId } } | not_found`.

- [ ] **Bước 1: Viết test của map vòng đời**

Create `lib/reservations/lifecycle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { RESERVATION_STATUSES } from '@/lib/booking/rules';
import {
  STAFF_SOURCES,
  TRANSITIONS,
  UPCOMING_STATUSES,
  availableTransitions,
  checkWindow,
  findTransition,
  opensAtMinutes,
  serviceDay,
  sourcesOf,
  transitionsFrom,
} from './lifecycle';

/* Spec §10.3: the transition table, its time windows, and the service day. npm test runs on UTC, like Vercel. */

// A Vietnam wall-clock time as an instant.
const at = (vn: string) => new Date(`${vn}+07:00`);
const edge = (from: Parameters<typeof findTransition>[0], to: Parameters<typeof findTransition>[1]) => {
  const t = findTransition(from, to);
  if (!t) throw new Error(`no ${from} → ${to}`);
  return t;
};

describe('the transition map', () => {
  it('is exactly the table of spec §10.3', () => {
    expect(TRANSITIONS.map((t) => `${t.from}→${t.to}`)).toEqual([
      'requested→confirmed',
      'requested→declined',
      'requested→cancelled',
      'confirmed→cancelled',
      'confirmed→seated',
      'confirmed→no_show',
      'no_show→seated',
      'seated→confirmed',
    ]);
  });

  it('has no way out of cancelled or declined, and no edge twice', () => {
    expect(transitionsFrom('cancelled')).toEqual([]);
    expect(transitionsFrom('declined')).toEqual([]);
    const keys = TRANSITIONS.map((t) => `${t.from}→${t.to}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of TRANSITIONS) expect(RESERVATION_STATUSES).toContain(t.to);
  });

  it('asks for a reason to decline or cancel, and only then', () => {
    expect(TRANSITIONS.filter((t) => t.reason === 'required').map((t) => t.to)).toEqual(['declined', 'cancelled', 'cancelled']);
  });

  it('names the guest email phase 5 will queue', () => {
    expect(edge('requested', 'confirmed').guestEmail).toEqual({ event: 'guest.confirmed', when: 'always' });
    expect(edge('requested', 'declined').guestEmail).toEqual({ event: 'guest.declined', when: 'always' });
    expect(edge('confirmed', 'cancelled').guestEmail).toEqual({ event: 'guest.cancelled', when: 'if_notify' });
    expect(edge('confirmed', 'no_show').guestEmail).toBeNull();
  });

  it('lists the sources of a target status, for the UPDATE … status = ANY($from)', () => {
    expect(sourcesOf('seated')).toEqual(['confirmed', 'no_show']);
    expect(sourcesOf('cancelled')).toEqual(['requested', 'confirmed']);
  });

  it('starts staff bookings confirmed (phone) or seated (walk-in); upcoming means requested or confirmed', () => {
    expect(STAFF_SOURCES).toEqual({ phone: 'confirmed', walk_in: 'seated' });
    expect(UPCOMING_STATUSES).toEqual(['requested', 'confirmed']);
  });
});

describe('time windows', () => {
  it('"Đã đến" opens 60 minutes before the sitting, with no end', () => {
    const seat = edge('confirmed', 'seated');
    expect(checkWindow(seat, '2026-10-02', '19:00', at('2026-10-02T17:59'))).toEqual({ ok: false, code: 'too_early' });
    expect(checkWindow(seat, '2026-10-02', '19:00', at('2026-10-02T18:00'))).toEqual({ ok: true });
    expect(checkWindow(seat, '2026-10-02', '19:00', at('2026-10-03T22:00'))).toEqual({ ok: true });
  });

  it('no-show only once 15 minutes have passed', () => {
    const noShow = edge('confirmed', 'no_show');
    expect(checkWindow(noShow, '2026-10-02', '19:00', at('2026-10-02T19:14'))).toEqual({ ok: false, code: 'too_early' });
    expect(checkWindow(noShow, '2026-10-02', '19:00', at('2026-10-02T19:15'))).toEqual({ ok: true });
    expect(checkWindow(noShow, '2026-10-01', '19:00', at('2026-10-02T09:00'))).toEqual({ ok: true });
  });

  it('corrections only on the same service day, which runs until 04:00 the next morning', () => {
    const undo = edge('no_show', 'seated');
    expect(checkWindow(undo, '2026-10-02', '21:00', at('2026-10-02T23:30'))).toEqual({ ok: true });
    expect(checkWindow(undo, '2026-10-02', '21:00', at('2026-10-03T03:59'))).toEqual({ ok: true });
    expect(checkWindow(undo, '2026-10-02', '21:00', at('2026-10-03T04:00'))).toEqual({ ok: false, code: 'too_late' });
    expect(checkWindow(edge('seated', 'confirmed'), '2026-10-03', '12:00', at('2026-10-02T12:00'))).toEqual({ ok: false, code: 'too_early' });
  });

  it('puts the service day on Vietnam’s clock, whatever the server’s zone', () => {
    // 2026-10-02T17:30Z is 00:30 on 3 Oct in Vietnam: still the service day of 2 Oct.
    expect(serviceDay(new Date('2026-10-02T17:30:00Z'))).toBe('2026-10-02');
    // 2026-10-02T21:00Z is 04:00 on 3 Oct in Vietnam: a new service day.
    expect(serviceDay(new Date('2026-10-02T21:00:00Z'))).toBe('2026-10-03');
  });

  it('gives the minute a window opens, for the hint beside a disabled button', () => {
    expect(opensAtMinutes(edge('confirmed', 'seated'), '19:00')).toBe(18 * 60);
    expect(opensAtMinutes(edge('confirmed', 'no_show'), '19:00')).toBe(19 * 60 + 15);
    expect(opensAtMinutes(edge('no_show', 'seated'), '19:00')).toBeNull();
  });

  it('lists what a booking offers now, each with its window', () => {
    expect(availableTransitions('confirmed', '2026-10-02', '19:00', at('2026-10-02T18:30')).map((o) => [o.transition.to, o.window.ok])).toEqual([
      ['cancelled', true],
      ['seated', true],
      ['no_show', false],
    ]);
    expect(availableTransitions('declined', '2026-10-02', '19:00', at('2026-10-02T18:30'))).toEqual([]);
  });
});
```

- [ ] **Bước 2: Viết test cho slot đã lên kế hoạch và số chỗ trừ chính nó**

```diff
diff --git a/lib/booking/resolve-day.test.ts b/lib/booking/resolve-day.test.ts
index d1a8115..52e1b0c 100644
--- a/lib/booking/resolve-day.test.ts
+++ b/lib/booking/resolve-day.test.ts
@@ -1,5 +1,5 @@
 import { describe, expect, it } from 'vitest';
-import { clockBlock, findSlot, planDay, resolveDay, resolveRange, seatings } from './resolve-day';
+import { clockBlock, findPlannedSlot, findSlot, planDay, resolveDay, resolveRange, seatings } from './resolve-day';
 import type { BookingRules, ClosureRule, PeriodRule } from './rules';
 
 // 2026-10-01 is a Thursday. The runner is pinned to UTC (npm test sets TZ=UTC);
@@ -79,6 +79,14 @@ describe('planDay (staff paths: no clock, no window, no booking switch)', () =>
       ['Dinner', true],
     ]);
   });
+
+  it('finds the service and capacity of a time, closed or not; nothing for a time off the grid', () => {
+    const plan = planDay(rules({ closures: [closure({ meals: ['Dinner'] })] }), '2026-10-05');
+    expect(findPlannedSlot(plan, '12:00')).toMatchObject({ period: { meal: 'Lunch', closed: false }, capacity: 16 });
+    expect(findPlannedSlot(plan, '19:00')).toMatchObject({ period: { meal: 'Dinner', closed: true }, capacity: 16 });
+    expect(findPlannedSlot(plan, '19:15')).toBeNull();
+    expect(findPlannedSlot(planDay(rules({ periods: [] }), '2026-10-05'), '19:00')).toBeNull();
+  });
 });
 
 describe('resolveDay: periods', () => {
```

```diff
diff --git a/test/integration/booking-rules.test.ts b/test/integration/booking-rules.test.ts
index e411a27..dcdceaa 100644
--- a/test/integration/booking-rules.test.ts
+++ b/test/integration/booking-rules.test.ts
@@ -121,6 +121,9 @@ describe.skipIf(!process.env.TEST_DATABASE_URL)('booking rule loaders (database)
       '2026-10-05': { '19:00': 9 },
       '2026-10-06': { '12:00': 2 },
     });
+    // An edit re-checks its slot without counting itself.
+    const { rows } = await sql(`SELECT id::text FROM reservations WHERE phone_e164 = '+84905000003'`);
+    expect(await loadBookedCovers(getPool(), 'taya-house', '2026-10-05', '2026-10-05', rows[0].id)).toEqual({ '2026-10-05': { '19:00': 5 } });
   });
 
   it('serialises one restaurant-day, and gives up after lock_timeout with 55P03', async () => {
```

- [ ] **Bước 3: Viết test tích hợp của các lần ghi**

Create `test/integration/reservation-lifecycle.test.ts`. Hai test của khối "one lock for guest and staff writes" giữ một transaction thật ở giữa chừng: phía nhân viên qua hook `afterCreate`, phía khách qua một pool bọc dừng ngay trước `INSERT INTO reservation_events` (lúc đó đặt bàn của khách đã chèn mà chưa commit, khóa đang giữ). Thả cổng nằm trong `finally`: một transaction bị treo sẽ giữ khóa sang test sau.

```ts
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebReservation } from '@/lib/server/booking/create';
import { parseReservationInput, type ReservationRequest } from '@/lib/server/booking/input';
import {
  addReservationNote,
  createStaffReservation,
  editReservation,
  transitionReservation,
  type ReservationActor,
  type StaffBookingInput,
} from '@/lib/server/booking/reservations';
import { TEST_DATABASE_URL } from '../helpers/db';

/*
 * Spec §10.3 in the database: one transaction per change with its
 * reservation_events row (never audit_log, §7.4), optimistic locking on
 * version, "who changed it" on a conflict, the time windows, staff bookings
 * that may pass capacity only with a reason, edits re-checked against
 * capacity, and the one booking-day lock shared with the guest's submit.
 */

let pool: Pool;
const LAN: ReservationActor = { id: 'staff-lan', label: 'Lan (lan@furama.test)' };
const MAI: ReservationActor = { id: 'staff-mai', label: 'Mai (mai@furama.test)' };
// Friday 2 Oct 2026, 10:00 in Vietnam. Tàya House: Lunch 11:30–13:30 and Dinner 18:00–21:00, 16 covers a slot (seed).
const NOW = new Date('2026-10-02T10:00:00+07:00');
const at = (vn: string) => new Date(`${vn}+07:00`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Seed = { status?: string; date?: string; time?: string; guests?: number; phone?: string; restaurant?: string; source?: string };

async function seed(over: Seed = {}): Promise<{ id: string; version: number }> {
  const phone = over.phone ?? `+849050${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`;
  const { rows } = await pool.query<{ id: string; version: number }>(
    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164, status, meal, source)
     VALUES ('FC-' || upper(substr(md5(random()::text), 1, 8)), $1, $2::date, $3, $4, 'Nguyễn Minh Anh', $5, $5, $6,
             CASE WHEN $3 < '15:00' THEN 'Lunch' ELSE 'Dinner' END, $7)
     RETURNING id::text, version`,
    [over.restaurant ?? 'taya-house', over.date ?? '2026-10-05', over.time ?? '19:00', over.guests ?? 2, phone, over.status ?? 'requested', over.source ?? 'web'],
  );
  return rows[0];
}

const row = async (id: string) =>
  (
    await pool.query(
      `SELECT status, version, status_reason, confirmed_at IS NOT NULL AS confirmed, cancelled_at IS NOT NULL AS cancelled,
              over_capacity, updated_by, to_char(reserved_on, 'YYYY-MM-DD') AS date, reserved_at AS time, guests, meal, source
         FROM reservations WHERE id = $1`,
      [id],
    )
  ).rows[0];

const events = async (id: string) =>
  (
    await pool.query(
      `SELECT actor_kind, actor_id, actor_label, type, from_status, to_status, changes, reason
         FROM reservation_events WHERE reservation_id = $1 ORDER BY id`,
      [id],
    )
  ).rows;

const move = (id: string, version: number, to: string, reason: string | null = null, now = NOW) =>
  transitionReservation(pool, LAN, { id, version, to: to as never, reason, notifyGuest: false }, { now });

const booking = (over: Partial<StaffBookingInput> = {}): StaffBookingInput => ({
  restaurantId: 'taya-house',
  date: '2026-10-05',
  time: '19:00',
  guests: 2,
  name: 'Trần Văn Bình',
  phone: '0905 111 222',
  phoneE164: '+84905111222',
  email: null,
  note: null,
  locale: 'vi',
  source: 'phone',
  overCapacityReason: null,
  notifyGuest: false,
  ...over,
});

/** What the guest's drawer would send for 19:00 on 5 Oct at Tàya House, parsed as submitReservation parses it. */
function guestRequest(guests: number): ReservationRequest {
  const parsed = parseReservationInput({
    restaurant: 'taya-house',
    date: '2026-10-05',
    time: '19:00',
    guests,
    name: 'Khách Web',
    phone: '0905 444 555',
    email: '',
    note: '',
    locale: 'en',
  });
  if (!parsed.ok) throw new Error(parsed.code);
  return parsed.value;
}

/** A pool whose transactions stop just before writing their event, until let go: a guest's submit caught holding its lock. */
function pausingPool(base: Pool) {
  let letGo!: () => void;
  const gate = new Promise<void>((resolve) => (letGo = resolve));
  let reached!: () => void;
  const paused = new Promise<void>((resolve) => (reached = resolve));
  const paused$ = {
    connect: async () => {
      const client = await base.connect();
      return {
        query: async (text: string, values?: unknown[]) => {
          if (text.startsWith('INSERT INTO reservation_events')) {
            reached();
            await gate;
          }
          return client.query(text, values);
        },
        release: () => client.release(),
      };
    },
  } as unknown as Pool;
  return { pool: paused$, paused, letGo };
}

describe.skipIf(!TEST_DATABASE_URL)('reservation lifecycle (database)', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 6 });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE reservations, reservation_events, reservation_notes, closures, audit_log CASCADE');
    await pool.query('UPDATE restaurants SET booking_enabled = true, window_days = NULL, lead_minutes = NULL, max_party = NULL, auto_confirm = NULL');
    await pool.query('UPDATE booking_settings SET window_days = 14, lead_minutes = 30, same_day_cutoff = NULL, max_party = 12, auto_confirm = false');
    await pool.query(`UPDATE service_periods SET active = true WHERE restaurant_id = 'taya-house'`);
  });

  describe('transitions', () => {
    it('confirms: one UPDATE (version bumped by the trigger) and one event, in the same transaction', async () => {
      const r = await seed();
      expect(await move(r.id, r.version, 'confirmed')).toEqual({ ok: true, data: { status: 'confirmed', version: r.version + 1 } });
      expect(await row(r.id)).toMatchObject({ status: 'confirmed', version: r.version + 1, confirmed: true, updated_by: LAN.id });
      expect(await events(r.id)).toEqual([
        { actor_kind: 'staff', actor_id: LAN.id, actor_label: LAN.label, type: 'status_changed', from_status: 'requested', to_status: 'confirmed', changes: null, reason: null },
      ]);
    });

    it('cancels and declines only with a reason, which the booking keeps for the guest email', async () => {
      const a = await seed();
      expect(await move(a.id, a.version, 'cancelled')).toEqual({ ok: false, code: 'invalid', fieldErrors: { reason: ['Nhập lý do.'] } });
      expect(await move(a.id, a.version, 'cancelled', 'Khách gọi báo hủy')).toMatchObject({ ok: true });
      expect(await row(a.id)).toMatchObject({ status: 'cancelled', status_reason: 'Khách gọi báo hủy', cancelled: true });
      const b = await seed();
      expect(await move(b.id, b.version, 'declined', 'Hết bàn ngoài trời')).toMatchObject({ ok: true });
      expect((await events(b.id))[0]).toMatchObject({ to_status: 'declined', reason: 'Hết bàn ngoài trời' });
    });

    it('refuses transitions that are not in the map, and leaves no trace', async () => {
      const r = await seed({ status: 'cancelled' });
      expect(await move(r.id, r.version, 'confirmed')).toEqual({ ok: false, code: 'not_allowed' });
      const s = await seed();
      expect(await move(s.id, s.version, 'no_show')).toEqual({ ok: false, code: 'not_allowed' });
      expect(await move('999999', 1, 'confirmed')).toEqual({ ok: false, code: 'not_found' });
      expect(await events(r.id)).toEqual([]);
      expect((await row(s.id)).version).toBe(s.version);
    });

    it('a stale version is a conflict that names who changed it first', async () => {
      const r = await seed();
      await transitionReservation(pool, MAI, { id: r.id, version: r.version, to: 'confirmed', reason: null, notifyGuest: false }, { now: NOW });
      const stale = await move(r.id, r.version, 'cancelled', 'Trùng');
      expect(stale).toMatchObject({ ok: false, code: 'conflict', params: { by: MAI.label } });
      expect((stale as unknown as { params: { at: string } }).params.at).toMatch(/^\d{2}:\d{2} \d{2}\/\d{2}\/\d{4}$/);
      expect(await row(r.id)).toMatchObject({ status: 'confirmed' });
    });

    it('a note added after the change does not take the blame for the conflict', async () => {
      const HOA: ReservationActor = { id: 'staff-hoa', label: 'Hoa (hoa@furama.test)' };
      const r = await seed();
      await transitionReservation(pool, MAI, { id: r.id, version: r.version, to: 'confirmed', reason: null, notifyGuest: false }, { now: NOW });
      await addReservationNote(pool, HOA, { id: r.id, body: 'Khách dị ứng tôm' });
      expect(await move(r.id, r.version, 'cancelled', 'Trùng')).toMatchObject({ ok: false, code: 'conflict', params: { by: MAI.label } });
    });

    it('two people acting at once: exactly one wins, the other gets the conflict naming the winner', async () => {
      const r = await seed();
      const [a, b] = await Promise.all([
        transitionReservation(pool, LAN, { id: r.id, version: r.version, to: 'confirmed', reason: null, notifyGuest: false }, { now: NOW }),
        transitionReservation(pool, MAI, { id: r.id, version: r.version, to: 'declined', reason: 'Kín chỗ', notifyGuest: false }, { now: NOW }),
      ]);
      expect([a.ok, b.ok].sort()).toEqual([false, true]);
      const loser = (a.ok ? b : a) as unknown as { code: string; params: { by: string } };
      expect(loser.code).toBe('conflict');
      expect(loser.params.by).toBe(a.ok ? LAN.label : MAI.label);
      expect(await events(r.id)).toHaveLength(1);
    });

    it('"Đã đến" from 60 minutes before the sitting; no-show only 15 minutes after', async () => {
      const r = await seed({ status: 'confirmed', date: '2026-10-02', time: '19:00' });
      expect(await move(r.id, r.version, 'seated', null, at('2026-10-02T17:59'))).toEqual({ ok: false, code: 'too_early' });
      expect(await move(r.id, r.version, 'no_show', null, at('2026-10-02T19:14'))).toEqual({ ok: false, code: 'too_early' });
      expect(await move(r.id, r.version, 'no_show', null, at('2026-10-02T19:15'))).toMatchObject({ ok: true, data: { status: 'no_show' } });
      const s = await seed({ status: 'confirmed', date: '2026-10-02', time: '19:00' });
      expect(await move(s.id, s.version, 'seated', null, at('2026-10-02T18:00'))).toMatchObject({ ok: true, data: { status: 'seated' } });
    });

    it('corrections (no-show → seated, seated → confirmed) only on the same service day', async () => {
      const r = await seed({ status: 'no_show', date: '2026-10-02', time: '21:00' });
      expect(await move(r.id, r.version, 'seated', null, at('2026-10-03T04:00'))).toEqual({ ok: false, code: 'too_late' });
      const ok = await move(r.id, r.version, 'seated', 'Khách đến muộn', at('2026-10-03T00:30'));
      expect(ok).toMatchObject({ ok: true, data: { status: 'seated' } });
      const v = (ok as { data: { version: number } }).data.version;
      expect(await move(r.id, v, 'confirmed', null, at('2026-10-03T01:00'))).toMatchObject({ ok: true, data: { status: 'confirmed' } });
      expect((await events(r.id)).map((e) => `${e.from_status}→${e.to_status}`)).toEqual(['no_show→seated', 'seated→confirmed']);
    });

    it('answers duplicate when a correction puts a booking back beside an active one with the same phone', async () => {
      const seated = await seed({ status: 'seated', date: '2026-10-02', phone: '+84905777888' });
      // Seated is outside reservations_dedupe_v2_idx, so a second active booking with that phone could be made.
      await seed({ status: 'confirmed', date: '2026-10-02', phone: '+84905777888' });
      expect(await move(seated.id, seated.version, 'confirmed', null, at('2026-10-02T20:00'))).toEqual({ ok: false, code: 'duplicate' });
      expect(await row(seated.id)).toMatchObject({ status: 'seated', version: seated.version });
      expect(await events(seated.id)).toEqual([]);
    });

    it('runs the phase-5 hook inside the transaction, with the transition’s guest email', async () => {
      const r = await seed();
      const afterTransition = vi.fn(async (client: PoolClient, change: { reservationId: string }) => {
        // Same transaction: the hook sees the new status before COMMIT.
        const { rows } = await client.query('SELECT status FROM reservations WHERE id = $1', [change.reservationId]);
        expect(rows[0].status).toBe('confirmed');
      });
      await transitionReservation(pool, LAN, { id: r.id, version: r.version, to: 'confirmed', reason: null, notifyGuest: true }, { now: NOW, effects: { afterTransition } });
      expect(afterTransition).toHaveBeenCalledTimes(1);
      expect(afterTransition.mock.calls[0][1]).toMatchObject({
        reservationId: r.id,
        notifyGuest: true,
        transition: { from: 'requested', to: 'confirmed', guestEmail: { event: 'guest.confirmed', when: 'always' } },
      });

      // A hook that throws rolls the whole change back (an outbox row is never lost or orphaned).
      const s = await seed();
      await expect(
        transitionReservation(pool, LAN, { id: s.id, version: s.version, to: 'confirmed', reason: null, notifyGuest: false }, {
          now: NOW,
          effects: { afterTransition: async () => Promise.reject(new Error('outbox down')) },
        }),
      ).rejects.toThrow('outbox down');
      expect(await row(s.id)).toMatchObject({ status: 'requested', version: s.version });
      expect(await events(s.id)).toEqual([]);
    });
  });

  describe('staff bookings', () => {
    it('a phone booking is confirmed, a walk-in seated; each starts its timeline with created', async () => {
      const phone = await createStaffReservation(pool, LAN, booking(), { now: NOW });
      expect(phone).toMatchObject({ ok: true, data: { reference: expect.stringMatching(/^FC-[0-9A-HJKMNP-TV-Z]{8}$/) } });
      const id = (phone as { data: { id: string } }).data.id;
      expect(await row(id)).toMatchObject({ status: 'confirmed', confirmed: true, meal: 'Dinner', over_capacity: false, source: 'phone' });
      expect(await events(id)).toEqual([
        { actor_kind: 'staff', actor_id: LAN.id, actor_label: LAN.label, type: 'created', from_status: null, to_status: 'confirmed', changes: { source: 'phone' }, reason: null },
      ]);
      const walkIn = await createStaffReservation(pool, LAN, booking({ source: 'walk_in', date: '2026-10-02', time: '12:00' }), { now: NOW });
      expect(await row((walkIn as { data: { id: string } }).data.id)).toMatchObject({ status: 'seated', meal: 'Lunch', source: 'walk_in' });
    });

    it('a walk-in is for the service day only; a phone booking not in the past', async () => {
      expect(await createStaffReservation(pool, LAN, booking({ source: 'walk_in' }), { now: NOW })).toMatchObject({
        ok: false,
        code: 'invalid',
        fieldErrors: { date: ['Khách vãng lai chỉ tạo cho hôm nay.'] },
      });
      expect(await createStaffReservation(pool, LAN, booking({ date: '2026-10-01' }), { now: NOW })).toMatchObject({
        ok: false,
        code: 'invalid',
        fieldErrors: { date: ['Ngày đã qua.'] },
      });
      expect(await createStaffReservation(pool, LAN, booking({ date: '2026-10-02', time: '12:00' }), { now: at('2026-10-02T20:00') })).toMatchObject({
        ok: false,
        code: 'invalid',
        fieldErrors: { time: ['Giờ này đã qua. Khách đang có mặt thì tạo khách vãng lai.'] },
      });
    });

    it('books past the online window, with online booking off and above max_party: those rules are the guest’s', async () => {
      await pool.query(`UPDATE restaurants SET booking_enabled = false, window_days = 1, max_party = 2 WHERE id = 'taya-house'`);
      const result = await createStaffReservation(pool, LAN, booking({ date: '2026-11-20', guests: 6 }), { now: NOW });
      expect(result).toMatchObject({ ok: true });
      expect(await row((result as { data: { id: string } }).data.id)).toMatchObject({ date: '2026-11-20', guests: 6, status: 'confirmed' });
    });

    it('past a slot’s capacity only with a reason, which is kept on the created event', async () => {
      await seed({ status: 'confirmed', guests: 15 });
      expect(await createStaffReservation(pool, LAN, booking(), { now: NOW })).toEqual({ ok: false, code: 'full', params: { left: '1' } });
      const over = await createStaffReservation(pool, LAN, booking({ overCapacityReason: 'Khách quen, kê thêm bàn' }), { now: NOW });
      const id = (over as { data: { id: string } }).data.id;
      expect(await row(id)).toMatchObject({ over_capacity: true });
      expect((await events(id))[0]).toMatchObject({ changes: { source: 'phone', over_capacity: true }, reason: 'Khách quen, kê thêm bàn' });
    });

    it('not on a closed service, nor at a time that is not a slot', async () => {
      await pool.query(
        `INSERT INTO closures (scope, restaurant_id, starts_on, ends_on, meals) VALUES ('restaurant', 'taya-house', '2026-10-05', '2026-10-05', '{Dinner}')`,
      );
      expect(await createStaffReservation(pool, LAN, booking(), { now: NOW })).toEqual({ ok: false, code: 'closed' });
      expect(await createStaffReservation(pool, LAN, booking({ time: '12:15' }), { now: NOW })).toEqual({ ok: false, code: 'slot_unavailable' });
      expect(await createStaffReservation(pool, LAN, booking({ time: '12:00' }), { now: NOW })).toMatchObject({ ok: true });
    });

    it('a duplicate phone at the same table and time is refused', async () => {
      await createStaffReservation(pool, LAN, booking(), { now: NOW });
      expect(await createStaffReservation(pool, LAN, booking({ phone: '+84 905 111 222' }), { now: NOW })).toEqual({ ok: false, code: 'duplicate' });
    });

    it('concurrent bookings never exceed capacity (the booking-day lock)', async () => {
      // 16 covers at 19:00; eight parties of 3 race for them: five fit (15 covers).
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          createStaffReservation(pool, i % 2 ? LAN : MAI, booking({ guests: 3, phone: `0905 222 33${i}`, phoneE164: `+8490522233${i}` }), { now: NOW }),
        ),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(5);
      expect(results.filter((r) => !r.ok).map((r) => (r as { code: string }).code)).toEqual(['full', 'full', 'full']);
      const { rows } = await pool.query(`SELECT sum(guests)::int AS covers FROM reservations WHERE reserved_at = '19:00'`);
      expect(rows[0].covers).toBe(15);
    });

    it('redraws a reference that collides', async () => {
      const first = await createStaffReservation(pool, LAN, booking(), { now: NOW, makeReference: () => 'FC-AAAAAAAA' });
      expect(first).toMatchObject({ ok: true });
      const queue = ['FC-AAAAAAAA', 'FC-BBBBBBBB'];
      const second = await createStaffReservation(pool, LAN, booking({ phone: '0905 999 000', phoneE164: '+84905999000' }), {
        now: NOW,
        makeReference: () => queue.shift() ?? 'FC-CCCCCCCC',
      });
      expect(second).toMatchObject({ ok: true, data: { reference: 'FC-BBBBBBBB' } });
    });
  });

  describe('one lock for guest and staff writes', () => {
    it('a staff booking waits while a guest’s submit holds the restaurant-day, then counts the guest’s covers', async () => {
      await seed({ status: 'confirmed', guests: 14 }); // 19:00 on 5 Oct: 2 of 16 covers left
      const guest = pausingPool(pool);
      const submitted = createWebReservation(guestRequest(2), { now: NOW, pool: guest.pool });
      await guest.paused; // the guest holds the lock; its 2 covers are inserted, not committed
      let settled = false;
      const staff = createStaffReservation(pool, LAN, booking({ guests: 1 }), { now: NOW }).finally(() => {
        settled = true;
      });
      try {
        await sleep(300);
        expect(settled).toBe(false);
      } finally {
        // Always let go: a stuck transaction would hold its locks into the next test.
        guest.letGo();
      }
      expect(await submitted).toMatchObject({ ok: true, status: 'requested' });
      expect(await staff).toEqual({ ok: false, code: 'full', params: { left: '0' } });
    });

    it('a guest’s submit waits while a staff booking holds the restaurant-day, then answers full', async () => {
      await seed({ status: 'confirmed', guests: 13 }); // 3 left
      let letGo!: () => void;
      const gate = new Promise<void>((resolve) => (letGo = resolve));
      let reached!: () => void;
      const inside = new Promise<void>((resolve) => (reached = resolve));
      const staff = createStaffReservation(pool, LAN, booking({ guests: 2 }), {
        now: NOW,
        effects: {
          afterCreate: async () => {
            reached();
            await gate;
          },
        },
      });
      await inside; // the staff booking holds the lock, its 2 covers inserted
      let settled = false;
      const guest = createWebReservation(guestRequest(2), { now: NOW, pool }).finally(() => {
        settled = true;
      });
      try {
        await sleep(300);
        expect(settled).toBe(false);
      } finally {
        letGo();
      }
      expect(await staff).toMatchObject({ ok: true });
      expect(await guest).toEqual({ ok: false, code: 'full' });
      const { rows } = await pool.query(`SELECT sum(guests)::int AS covers FROM reservations WHERE reserved_at = '19:00'`);
      expect(rows[0].covers).toBe(15);
    });
  });

  describe('edits', () => {
    const edit = (id: string, version: number, over: Record<string, unknown> = {}) =>
      editReservation(
        pool,
        LAN,
        {
          id,
          version,
          date: '2026-10-05',
          time: '19:00',
          guests: 2,
          name: 'Nguyễn Minh Anh',
          phone: '+84905000001',
          phoneE164: '+84905000001',
          email: null,
          note: null,
          overCapacityReason: null,
          ...over,
        },
      );

    it('records only what changed, as [before, after]', async () => {
      const r = await seed({ phone: '+84905000001' });
      const result = await edit(r.id, r.version, { time: '19:30', guests: 4, note: 'Ghế em bé' });
      expect(result).toEqual({ ok: true, data: { version: r.version + 1, changed: true } });
      expect((await events(r.id))[0]).toMatchObject({
        type: 'edited',
        changes: { time: ['19:00', '19:30'], guests: [2, 4], note: [null, 'Ghế em bé'] },
      });
      // The same values again: no UPDATE (each one would bump the version), no event.
      expect(await edit(r.id, r.version + 1, { time: '19:30', guests: 4, note: 'Ghế em bé' })).toEqual({
        ok: true,
        data: { version: r.version + 1, changed: false },
      });
      expect(await events(r.id)).toHaveLength(1);
    });

    it('re-checks capacity when the party grows or moves, not counting itself', async () => {
      const r = await seed({ phone: '+84905000001', guests: 10 });
      await seed({ status: 'confirmed', guests: 6 }); // 19:00 is now full (16)
      expect(await edit(r.id, r.version, { guests: 9 })).toMatchObject({ ok: true }); // smaller: no check
      const v = (await row(r.id)).version;
      // 16 covers less the other party's 6: ten left for this one, which now wants eleven.
      expect(await edit(r.id, v, { guests: 11 })).toEqual({ ok: false, code: 'full', params: { left: '10' } });
      expect(await edit(r.id, v, { guests: 11, overCapacityReason: 'Bàn ghép' })).toMatchObject({ ok: true });
      expect(await row(r.id)).toMatchObject({ guests: 11, over_capacity: true });
      expect(await edit(r.id, v, { time: '20:00' })).toMatchObject({ ok: false, code: 'conflict' });
    });

    it('a guest’s web booking edited past capacity with a reason: over capacity, the reason on the edited event', async () => {
      const r = await seed({ phone: '+84905000001', source: 'web' });
      await seed({ status: 'confirmed', guests: 14 });
      expect(await edit(r.id, r.version, { guests: 4 })).toEqual({ ok: false, code: 'full', params: { left: '2' } });
      expect(await edit(r.id, r.version, { guests: 4, overCapacityReason: 'Khách gọi thêm người' })).toMatchObject({ ok: true });
      expect(await row(r.id)).toMatchObject({ guests: 4, over_capacity: true, source: 'web' });
      expect((await events(r.id))[0]).toMatchObject({
        type: 'edited',
        changes: { guests: [2, 4], over_capacity: [false, true] },
        reason: 'Khách gọi thêm người',
      });
    });

    it('moves a booking to another day only into an open slot', async () => {
      const r = await seed({ phone: '+84905000001' });
      await pool.query(
        `INSERT INTO closures (scope, restaurant_id, starts_on, ends_on, meals) VALUES ('restaurant', 'taya-house', '2026-10-06', '2026-10-06', NULL)`,
      );
      expect(await edit(r.id, r.version, { date: '2026-10-06' })).toEqual({ ok: false, code: 'closed' });
      expect(await edit(r.id, r.version, { date: '2026-10-07', time: '19:10' })).toEqual({ ok: false, code: 'slot_unavailable' });
      expect(await edit(r.id, r.version, { date: '2026-10-07', time: '12:00' })).toMatchObject({ ok: true });
      expect(await row(r.id)).toMatchObject({ date: '2026-10-07', time: '12:00', meal: 'Lunch' });
    });

    it('not for a booking that no longer holds seats', async () => {
      const r = await seed({ status: 'cancelled', phone: '+84905000001' });
      expect(await edit(r.id, r.version, { guests: 3 })).toEqual({ ok: false, code: 'not_allowed' });
    });
  });

  it('a note is internal: its own table, and the timeline only says one was added', async () => {
    const r = await seed();
    const note = await addReservationNote(pool, LAN, { id: r.id, body: 'Khách dị ứng tôm' });
    expect(note).toMatchObject({ ok: true });
    const { rows } = await pool.query('SELECT author_id, author_label, body FROM reservation_notes WHERE reservation_id = $1', [r.id]);
    expect(rows).toEqual([{ author_id: LAN.id, author_label: LAN.label, body: 'Khách dị ứng tôm' }]);
    const [event] = await events(r.id);
    expect(event).toMatchObject({ type: 'note_added', changes: { note_id: (note as { data: { noteId: string } }).data.noteId } });
    expect(JSON.stringify(event)).not.toContain('tôm');
    expect((await row(r.id)).version).toBe(r.version); // a note does not touch the booking
    expect(await addReservationNote(pool, LAN, { id: '999999', body: 'x' })).toEqual({ ok: false, code: 'not_found' });
  });

  it('writes the timeline instead of audit_log (spec §7.4)', async () => {
    const created = await createStaffReservation(pool, LAN, booking(), { now: NOW });
    const id = (created as { data: { id: string } }).data.id;
    await editReservation(
      pool,
      LAN,
      { id, version: 1, date: '2026-10-05', time: '19:30', guests: 2, name: 'Trần Văn Bình', phone: '0905 111 222', phoneE164: '+84905111222', email: null, note: null, overCapacityReason: null },
    );
    await move(id, 2, 'cancelled', 'Khách hủy');
    await addReservationNote(pool, LAN, { id, body: 'Đã gọi lại' });
    expect((await events(id)).map((e) => e.type)).toEqual(['created', 'edited', 'status_changed', 'note_added']);
    expect((await pool.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n).toBe(0);
  });
});
```

- [ ] **Bước 4: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/reservations/lifecycle.test.ts lib/booking/resolve-day.test.ts test/integration/booking-rules.test.ts test/integration/reservation-lifecycle.test.ts`
Expected: FAIL `Test Files  4 failed (4)`, `Tests  2 failed | 37 passed (39)`:

```
 FAIL  lib/reservations/lifecycle.test.ts [ lib/reservations/lifecycle.test.ts ]
Error: Cannot find module './lifecycle' imported from …/lib/reservations/lifecycle.test.ts
 FAIL  test/integration/reservation-lifecycle.test.ts [ test/integration/reservation-lifecycle.test.ts ]
Error: Cannot find package '@/lib/server/booking/reservations' imported from …/test/integration/reservation-lifecycle.test.ts
 FAIL  lib/booking/resolve-day.test.ts > planDay (staff paths: no clock, no window, no booking switch) > finds the service and capacity of a time, closed or not; nothing for a time off the grid
TypeError: findPlannedSlot is not a function
 FAIL  test/integration/booking-rules.test.ts > booking rule loaders (database) > counts covers per date and time over the holding statuses only
AssertionError: expected { '2026-10-05': { '19:00': 9 } } to deeply equal { '2026-10-05': { '19:00': 5 } }
```

- [ ] **Bước 5: Viết `findPlannedSlot` và `excludeId`**

```diff
diff --git a/lib/booking/resolve-day.ts b/lib/booking/resolve-day.ts
index 0b4f1d8..6bda0d3 100644
--- a/lib/booking/resolve-day.ts
+++ b/lib/booking/resolve-day.ts
@@ -78,6 +78,15 @@ export function planDay(
   return { periods, wholeDayReason: wholeDay.find((c) => c.publicReason)?.publicReason ?? null };
 }
 
+/** The service and capacity a time belongs to on a planned day, closed or not; null for a time off the grid. */
+export function findPlannedSlot(plan: { periods: PlannedPeriod[] }, time: string): { period: PlannedPeriod; capacity: number } | null {
+  for (const period of plan.periods) {
+    const slot = period.slots.find((s) => s.time === time);
+    if (slot) return { period, capacity: slot.capacity };
+  }
+  return null;
+}
+
 /**
  * Whether the clock alone closes a sitting (spec §10.1 step 4, first two
  * rules). Lead: venueNow truncates to the minute, so "minutes left > lead" is
```

```diff
diff --git a/lib/server/booking/rules.ts b/lib/server/booking/rules.ts
index e77fac5..58e8848 100644
--- a/lib/server/booking/rules.ts
+++ b/lib/server/booking/rules.ts
@@ -115,14 +115,25 @@ export async function loadRestaurantRules(db: Db, restaurantId: string, locale:
   return (await loadBookingRules(db, [restaurantId], locale, from)).get(restaurantId) ?? null;
 }
 
-/** Covers held per date and "HH:MM" for one restaurant, from..to inclusive (holding statuses only). */
-export async function loadBookedCovers(db: Db, restaurantId: string, from: IsoDate, to: IsoDate): Promise<Record<IsoDate, BookedCovers>> {
+/**
+ * Covers held per date and "HH:MM" for one restaurant, from..to inclusive
+ * (holding statuses only). `excludeId` leaves one booking out: an edit
+ * re-checks a slot without counting itself.
+ */
+export async function loadBookedCovers(
+  db: Db,
+  restaurantId: string,
+  from: IsoDate,
+  to: IsoDate,
+  excludeId: string | null = null,
+): Promise<Record<IsoDate, BookedCovers>> {
   const { rows } = await db.query<{ day: string; reserved_at: string; covers: number }>(
     `SELECT to_char(reserved_on, 'YYYY-MM-DD') AS day, reserved_at, SUM(guests)::int AS covers
        FROM reservations
       WHERE restaurant_id = $1 AND reserved_on BETWEEN $2::date AND $3::date AND status = ANY ($4::text[])
+        AND ($5::bigint IS NULL OR id <> $5::bigint)
       GROUP BY reserved_on, reserved_at`,
-    [restaurantId, from, to, HOLDING_STATUSES],
+    [restaurantId, from, to, HOLDING_STATUSES, excludeId],
   );
   const out: Record<IsoDate, BookedCovers> = {};
   for (const row of rows) (out[row.day] ??= {})[row.reserved_at] = row.covers;
```

- [ ] **Bước 6: Viết map vòng đời**

`HOLDING_STATUSES` và `RESERVATION_STATUSES` vẫn chỉ nằm ở `lib/booking/rules.ts` (dàn ý C18); file này không export lại chúng. Create `lib/reservations/lifecycle.ts`:

```ts
import type { ReservationStatus } from '@/lib/booking/rules';
import { addDays, minutesUntil, venueNow, type IsoDate } from '@/lib/venue-time';

/*
 * The reservation lifecycle of spec §10.3, in one map. The data layer
 * (lib/server/booking/reservations.ts) enforces it; the admin screens read it
 * to show only the buttons that can work. No server-only import: client
 * components use the labels too. The statuses themselves, and which of them
 * hold covers, live in lib/booking/rules.ts.
 */

/** Still to come and still expected: what "affected by a closure or new hours" looks at. */
export const UPCOMING_STATUSES = ['requested', 'confirmed'] as const satisfies readonly ReservationStatus[];

export const STATUS_LABELS: Record<ReservationStatus, string> = {
  requested: 'Chờ xác nhận',
  confirmed: 'Đã xác nhận',
  seated: 'Đã đến',
  no_show: 'Không đến',
  cancelled: 'Đã hủy',
  declined: 'Đã từ chối',
};

/** The guest emails of spec §10.4 a transition may trigger. Phase 5 queues them; phase 4 only names them. */
export type GuestEmailEvent = 'guest.confirmed' | 'guest.declined' | 'guest.cancelled';

/** When a transition may run, relative to the sitting (reserved_on + reserved_at, Vietnam time). */
export type TimeWindow =
  | { kind: 'any' }
  /** From `minutes` before the sitting onward ("Đã đến" from 60 minutes before). */
  | { kind: 'from_before'; minutes: number }
  /** Only once `minutes` have passed since the sitting (no-show 15 minutes after). */
  | { kind: 'after'; minutes: number }
  /** Corrections: only while the service day of the sitting lasts (see serviceDay). */
  | { kind: 'same_service_day' };

export type Transition = {
  from: ReservationStatus;
  to: ReservationStatus;
  window: TimeWindow;
  /** Decline and cancel carry a reason (stored in status_reason; the guest reads it from phase 5). */
  reason: 'required' | 'optional';
  /**
   * The guest email this transition queues in its own transaction from phase 5:
   * `always` (when the guest gave an email) or only when staff tick "Báo khách".
   */
  guestEmail: { event: GuestEmailEvent; when: 'always' | 'if_notify' } | null;
  /** Button text on the detail screen. */
  label: string;
};

const ANY: TimeWindow = { kind: 'any' };
const CORRECTION: TimeWindow = { kind: 'same_service_day' };
const CANCEL = { reason: 'required', guestEmail: { event: 'guest.cancelled', when: 'if_notify' }, label: 'Hủy' } as const;

/** Every allowed change. Who: Editor and Admin alike (permission reservations:update). */
export const TRANSITIONS: readonly Transition[] = [
  { from: 'requested', to: 'confirmed', window: ANY, reason: 'optional', guestEmail: { event: 'guest.confirmed', when: 'always' }, label: 'Xác nhận' },
  { from: 'requested', to: 'declined', window: ANY, reason: 'required', guestEmail: { event: 'guest.declined', when: 'always' }, label: 'Từ chối' },
  { from: 'requested', to: 'cancelled', window: ANY, ...CANCEL },
  { from: 'confirmed', to: 'cancelled', window: ANY, ...CANCEL },
  { from: 'confirmed', to: 'seated', window: { kind: 'from_before', minutes: 60 }, reason: 'optional', guestEmail: null, label: 'Đã đến' },
  { from: 'confirmed', to: 'no_show', window: { kind: 'after', minutes: 15 }, reason: 'optional', guestEmail: null, label: 'Không đến' },
  // The guest is physically there: seats are held again without a capacity check (R9).
  { from: 'no_show', to: 'seated', window: CORRECTION, reason: 'optional', guestEmail: null, label: 'Sửa: khách đã đến' },
  { from: 'seated', to: 'confirmed', window: CORRECTION, reason: 'optional', guestEmail: null, label: 'Sửa: chưa đến' },
];

export function findTransition(from: ReservationStatus, to: ReservationStatus): Transition | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export function transitionsFrom(from: ReservationStatus): Transition[] {
  return TRANSITIONS.filter((t) => t.from === from);
}

/** Every status that may move to `to` (the `status = ANY($from)` of the UPDATE). */
export function sourcesOf(to: ReservationStatus): ReservationStatus[] {
  return TRANSITIONS.filter((t) => t.to === to).map((t) => t.from);
}

/** Bookings made by staff start further along (spec §10.3): a phone booking is confirmed, a walk-in already seated. */
export const STAFF_SOURCES = { phone: 'confirmed', walk_in: 'seated' } as const satisfies Record<string, ReservationStatus>;
export type StaffSource = keyof typeof STAFF_SOURCES;

export const SOURCE_LABELS: Record<string, string> = {
  web: 'Web',
  phone: 'Điện thoại',
  walk_in: 'Khách vãng lai',
  staff: 'Nhân viên',
  legacy: 'Dữ liệu cũ',
};

/** A service day runs until 04:00 the next morning, so a late-night correction still counts for its evening. */
export const SERVICE_DAY_ROLLOVER_MINUTES = 4 * 60;

/** The service day an instant falls in, as YYYY-MM-DD (Vietnam time, 04:00 rollover). */
export function serviceDay(now: Date = new Date()): IsoDate {
  const v = venueNow(now);
  return v.minutes < SERVICE_DAY_ROLLOVER_MINUTES ? addDays(v.date, -1) : v.date;
}

export type WindowCheck = { ok: true } | { ok: false; code: 'too_early' | 'too_late' };

/** Whether `t` may run now for a sitting at `time` on `date`. */
export function checkWindow(t: Transition, date: IsoDate, time: string, now: Date = new Date()): WindowCheck {
  const until = minutesUntil(date, time, now);
  switch (t.window.kind) {
    case 'any':
      return { ok: true };
    case 'from_before':
      return until <= t.window.minutes ? { ok: true } : { ok: false, code: 'too_early' };
    case 'after':
      return until <= -t.window.minutes ? { ok: true } : { ok: false, code: 'too_early' };
    case 'same_service_day': {
      const today = serviceDay(now);
      if (date === today) return { ok: true };
      return date > today ? { ok: false, code: 'too_early' } : { ok: false, code: 'too_late' };
    }
  }
}

/**
 * The minute of the sitting's day (Vietnam time) a windowed transition opens,
 * for the "Từ 18:00" hint; null for a window without such a start.
 */
export function opensAtMinutes(t: Transition, time: string): number | null {
  const sitting = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  if (t.window.kind === 'from_before') return sitting - t.window.minutes;
  if (t.window.kind === 'after') return sitting + t.window.minutes;
  return null;
}

/**
 * The transitions a booking offers right now, each with whether its window is
 * open. A server page calls it without `now` (React's purity rule keeps
 * `new Date()` out of component bodies).
 */
export function availableTransitions(
  status: ReservationStatus,
  date: IsoDate,
  time: string,
  now: Date = new Date(),
): { transition: Transition; window: WindowCheck }[] {
  return transitionsFrom(status).map((transition) => ({ transition, window: checkWindow(transition, date, time, now) }));
}
```

- [ ] **Bước 7: Viết các lần ghi của nhân viên**

Những điểm reviewer cần thấy: UPDATE chuyển trạng thái ghim cả `version` lẫn `status = ANY(<nguồn có cửa sổ đang mở>)`, nên hai người bấm cùng lúc thì đúng một người thắng và câu báo nêu người đó (sự kiện đổi hàng mới nhất: `status_changed` hoặc `edited`; ghi chú không UPDATE hàng, sự kiện email của đợt 5 cũng vậy, nên không bao giờ bị nêu tên); đặt qua điện thoại cho một giờ đã qua của hôm nay bị từ chối ở ô `time` (R8: khách đang có mặt thì tạo khách vãng lai); trigger tăng `version`, SQL không gán nó; sửa không đổi gì thì không UPDATE (mỗi UPDATE tăng version); `reservations_dedupe_v2_idx` thành `duplicate` (sửa `seated → confirmed` có thể đưa hàng trở lại dưới index); hook chạy trong transaction, sau hàng sự kiện. Create `lib/server/booking/reservations.ts`:

```ts
import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { formatDateTimeVi } from '@/lib/admin/format';
import { findPlannedSlot, planDay } from '@/lib/booking/resolve-day';
import { HOLDING_STATUSES, type ReservationStatus } from '@/lib/booking/rules';
import type { Meal } from '@/lib/data';
import {
  STAFF_SOURCES,
  checkWindow,
  findTransition,
  serviceDay,
  sourcesOf,
  type StaffSource,
  type Transition,
} from '@/lib/reservations/lifecycle';
import { withTransaction } from '@/lib/server/audit';
import { newReference } from '@/lib/server/reference';
import { minutesUntil, venueNow, type IsoDate } from '@/lib/venue-time';
import { lockBookingDay } from './lock';
import { loadBookedCovers, loadRestaurantRules } from './rules';

/*
 * Every staff write to a reservation (spec §10.3, §7.4): one transaction that
 * changes the row, appends its reservation_events row (instead of audit_log)
 * and runs the effects hook. Optimistic concurrency on reservations.version,
 * which the reservations_before_write trigger bumps on every UPDATE.
 *
 * A write that takes covers (a staff booking, an edit that moves or grows a
 * booking) calls lockBookingDay first, the same lock as the guest's submit,
 * and only then reads the rules and the covers. Staff slots come from the
 * clock-free planDay: staff may book past the online window, on a restaurant
 * whose online booking is off, above max_party, but never into a closed
 * service or at a time that is not a slot (R8).
 *
 * Phase 5 (email): the hooks run inside the same transaction, after the event
 * row; `notifyGuest` is already part of every input (false until phase 5 adds
 * the checkbox and the outbox effects).
 */

/** Who acted, as reservation_events stores it: a snapshot, no FK (spec §5.1.6). */
export type ReservationActor = { id: string; label: string };

export function staffActor(staff: { userId: string; name: string; email: string }): ReservationActor {
  return { id: staff.userId, label: `${staff.name} (${staff.email})` };
}

export type ReservationEffects = {
  /** After a status change and its event; same transaction. Phase 5 queues transition.guestEmail here. */
  afterTransition?: (
    client: PoolClient,
    change: { reservationId: string; transition: Transition; eventId: string; notifyGuest: boolean },
  ) => Promise<void>;
  /** After a staff booking and its `created` event; same transaction. Phase 5 queues guest.confirmed here. */
  afterCreate?: (
    client: PoolClient,
    created: { reservationId: string; status: ReservationStatus; eventId: string; notifyGuest: boolean },
  ) => Promise<void>;
};

export type Failure<C extends string> = { ok: false; code: C; params?: Record<string, string>; fieldErrors?: Record<string, string[]> };
export type Conflict = Failure<'conflict'>;

/**
 * "Vừa được {người} thay đổi lúc {giờ}" (spec §10.3): the newest event that came with an UPDATE of the row
 * (the ones that bump version) says who got there first. A note changes no row, nor will phase 5's email events.
 */
async function conflict(client: PoolClient, reservationId: string): Promise<Conflict> {
  const { rows } = await client.query<{ actor_label: string | null; at: Date }>(
    `SELECT actor_label, at FROM reservation_events
      WHERE reservation_id = $1 AND type IN ('status_changed', 'edited')
      ORDER BY at DESC, id DESC LIMIT 1`,
    [reservationId],
  );
  const last = rows[0];
  return { ok: false, code: 'conflict', params: { by: last?.actor_label ?? 'người khác', at: last ? formatDateTimeVi(last.at) : '' } };
}

type EventType = 'created' | 'status_changed' | 'edited' | 'note_added';

async function insertEvent(
  client: PoolClient,
  actor: ReservationActor,
  event: { reservationId: string; type: EventType; from?: string | null; to?: string | null; changes?: unknown; reason?: string | null },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO reservation_events (reservation_id, actor_kind, actor_id, actor_label, type, from_status, to_status, changes, reason)
     VALUES ($1, 'staff', $2, $3, $4, $5, $6, $7, $8)
     RETURNING id::text`,
    [
      event.reservationId,
      actor.id,
      actor.label,
      event.type,
      event.from ?? null,
      event.to ?? null,
      event.changes === undefined ? null : JSON.stringify(event.changes),
      event.reason ?? null,
    ],
  );
  return rows[0].id;
}

/** The unique constraint a Postgres error violated, if it is one. */
function constraintOf(err: unknown): string | null {
  const e = err as { code?: string; constraint?: string } | null;
  return e?.code === '23505' ? (e.constraint ?? null) : null;
}

// ── status transitions ──────────────────────────────────────────────────────

export type TransitionInput = { id: string; version: number; to: ReservationStatus; reason: string | null; notifyGuest: boolean };
export type TransitionResult =
  | { ok: true; data: { status: ReservationStatus; version: number } }
  | Conflict
  | Failure<'not_found' | 'not_allowed' | 'too_early' | 'too_late' | 'invalid' | 'duplicate'>;

type Current = { status: ReservationStatus; version: number; date: IsoDate; time: string };

export async function transitionReservation(
  pool: Pool,
  actor: ReservationActor,
  input: TransitionInput,
  options: { now?: Date; effects?: ReservationEffects } = {},
): Promise<TransitionResult> {
  const now = options.now ?? new Date();
  try {
    return await withTransaction(pool, async (client): Promise<TransitionResult> => {
      const { rows } = await client.query<Current>(
        `SELECT status, version, to_char(reserved_on, 'YYYY-MM-DD') AS date, reserved_at AS time FROM reservations WHERE id = $1`,
        [input.id],
      );
      const current = rows[0];
      if (!current) return { ok: false, code: 'not_found' };
      if (current.version !== input.version) return conflict(client, input.id);

      const transition = findTransition(current.status, input.to);
      if (!transition) return { ok: false, code: 'not_allowed' };
      const window = checkWindow(transition, current.date, current.time, now);
      if (!window.ok) return { ok: false, code: window.code };
      if (transition.reason === 'required' && !input.reason) {
        return { ok: false, code: 'invalid', fieldErrors: { reason: ['Nhập lý do.'] } };
      }

      // The sources whose window is open now; the version pins the row checked above.
      const from = sourcesOf(input.to).filter((s) => checkWindow(findTransition(s, input.to)!, current.date, current.time, now).ok);
      const updated = await client.query<{ status: ReservationStatus; version: number }>(
        `UPDATE reservations
            SET status = $3,
                status_reason = CASE WHEN $3 IN ('cancelled', 'declined') THEN $4 ELSE status_reason END,
                confirmed_at = CASE WHEN $3 = 'confirmed' THEN coalesce(confirmed_at, now()) ELSE confirmed_at END,
                cancelled_at = CASE WHEN $3 = 'cancelled' THEN now() ELSE cancelled_at END,
                updated_by = $5
          WHERE id = $1 AND version = $2 AND status = ANY ($6::text[])
          RETURNING status, version`,
        [input.id, input.version, input.to, input.reason, actor.id, from],
      );
      if (updated.rowCount === 0) return conflict(client, input.id);

      const eventId = await insertEvent(client, actor, {
        reservationId: input.id,
        type: 'status_changed',
        from: current.status,
        to: input.to,
        reason: input.reason,
      });
      await options.effects?.afterTransition?.(client, { reservationId: input.id, transition, eventId, notifyGuest: input.notifyGuest });
      return { ok: true, data: updated.rows[0] };
    });
  } catch (err) {
    // seated → confirmed puts a row back under the dedupe index.
    if (constraintOf(err) === 'reservations_dedupe_v2_idx') return { ok: false, code: 'duplicate' };
    throw err;
  }
}

// ── the slot check of staff bookings and edits ──────────────────────────────

/** Staff paths never show a closure's public reason; the default language stands in when this one is off. */
const STAFF_LOCALE = 'vi';

export type BookingCheckFailure = Failure<'not_found' | 'closed' | 'slot_unavailable' | 'full' | 'invalid'>;
type SlotCheck = { ok: true; meal: Meal; over: boolean } | BookingCheckFailure;

/**
 * Under the booking-day lock: the time must be a slot of an open service that
 * day; past its capacity only with a reason. `excludeId`: an edit does not
 * count its own covers.
 */
async function checkSlot(
  client: PoolClient,
  slot: { restaurantId: string; date: IsoDate; time: string; guests: number; overCapacityReason: string | null },
  excludeId: string | null = null,
): Promise<SlotCheck> {
  const loaded = await loadRestaurantRules(client, slot.restaurantId, STAFF_LOCALE, slot.date);
  if (!loaded) return { ok: false, code: 'not_found' };
  const hit = findPlannedSlot(planDay(loaded.rules, slot.date), slot.time);
  if (!hit) return { ok: false, code: 'slot_unavailable' };
  if (hit.period.closed) return { ok: false, code: 'closed' };
  const booked = (await loadBookedCovers(client, slot.restaurantId, slot.date, slot.date, excludeId))[slot.date]?.[slot.time] ?? 0;
  const over = booked + slot.guests > hit.capacity;
  if (over && !slot.overCapacityReason) return { ok: false, code: 'full', params: { left: String(Math.max(0, hit.capacity - booked)) } };
  return { ok: true, meal: hit.period.meal, over };
}

// ── staff bookings (phone, walk-in) ─────────────────────────────────────────

export type StaffBookingInput = {
  restaurantId: string;
  date: IsoDate;
  time: string;
  guests: number;
  name: string;
  phone: string;
  phoneE164: string;
  email: string | null;
  note: string | null;
  locale: string;
  source: StaffSource;
  /** Required to book past a slot's capacity (spec §10.3: over_capacity with a reason). */
  overCapacityReason: string | null;
  notifyGuest: boolean;
};

export type StaffBookingResult = { ok: true; data: { id: string; reference: string } } | BookingCheckFailure | Failure<'duplicate'>;

const REFERENCE_ATTEMPTS = 3;

export async function createStaffReservation(
  pool: Pool,
  actor: ReservationActor,
  input: StaffBookingInput,
  options: { now?: Date; effects?: ReservationEffects; makeReference?: () => string } = {},
): Promise<StaffBookingResult> {
  const now = options.now ?? new Date();
  const makeReference = options.makeReference ?? newReference;
  // A walk-in is seated now, so it belongs to this service day; a phone booking is for a sitting still to come.
  if (input.source === 'walk_in' && input.date !== serviceDay(now)) {
    return { ok: false, code: 'invalid', fieldErrors: { date: ['Khách vãng lai chỉ tạo cho hôm nay.'] } };
  }
  if (input.source === 'phone' && input.date < venueNow(now).date) {
    return { ok: false, code: 'invalid', fieldErrors: { date: ['Ngày đã qua.'] } };
  }
  if (input.source === 'phone' && minutesUntil(input.date, input.time, now) < 0) {
    return { ok: false, code: 'invalid', fieldErrors: { time: ['Giờ này đã qua. Khách đang có mặt thì tạo khách vãng lai.'] } };
  }
  const status = STAFF_SOURCES[input.source];

  for (let attempt = 1; ; attempt++) {
    try {
      return await withTransaction(pool, async (client): Promise<StaffBookingResult> => {
        // The lock first: the rules and the covers read below must be the ones the insert is decided on.
        await lockBookingDay(client, input.restaurantId, input.date);
        const slot = await checkSlot(client, input);
        if (!slot.ok) return slot;

        // search_text, version and updated_at come from the reservations_before_write trigger.
        const { rows } = await client.query<{ id: string; reference: string }>(
          `INSERT INTO reservations
             (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164, email, note,
              status, meal, locale, source, over_capacity, confirmed_at, updated_by)
           VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                   CASE WHEN $11 IN ('confirmed', 'seated') THEN now() END, $16)
           RETURNING id::text, reference`,
          [
            makeReference(),
            input.restaurantId,
            input.date,
            input.time,
            input.guests,
            input.name,
            input.phone,
            input.phoneE164,
            input.email,
            input.note,
            status,
            slot.meal,
            input.locale,
            input.source,
            slot.over,
            actor.id,
          ],
        );
        const created = rows[0];
        const eventId = await insertEvent(client, actor, {
          reservationId: created.id,
          type: 'created',
          to: status,
          changes: { source: input.source, ...(slot.over ? { over_capacity: true } : {}) },
          reason: slot.over ? input.overCapacityReason : null,
        });
        await options.effects?.afterCreate?.(client, { reservationId: created.id, status, eventId, notifyGuest: input.notifyGuest });
        return { ok: true, data: created };
      });
    } catch (err) {
      const constraint = constraintOf(err);
      if (constraint === 'reservations_reference_key' && attempt < REFERENCE_ATTEMPTS) continue;
      if (constraint === 'reservations_dedupe_v2_idx') return { ok: false, code: 'duplicate' };
      throw err;
    }
  }
}

// ── edits (date, time, party, guest details) ────────────────────────────────

export type EditInput = {
  id: string;
  version: number;
  date: IsoDate;
  time: string;
  guests: number;
  name: string;
  phone: string;
  phoneE164: string;
  email: string | null;
  note: string | null;
  overCapacityReason: string | null;
};

export type EditResult =
  | { ok: true; data: { version: number; changed: boolean } }
  | Conflict
  | BookingCheckFailure
  | Failure<'not_allowed' | 'duplicate'>;

type EditableRow = {
  restaurant_id: string;
  status: ReservationStatus;
  version: number;
  date: IsoDate;
  time: string;
  guests: number;
  name: string;
  phone: string;
  phone_e164: string;
  email: string | null;
  note: string | null;
  over_capacity: boolean;
};

/** Staff edits ignore the clock (R8), so unlike the other writes this one takes no `now`. */
export async function editReservation(pool: Pool, actor: ReservationActor, input: EditInput): Promise<EditResult> {
  try {
    return await withTransaction(pool, async (client): Promise<EditResult> => {
      const { rows } = await client.query<EditableRow>(
        `SELECT restaurant_id, status, version, to_char(reserved_on, 'YYYY-MM-DD') AS date, reserved_at AS time, guests,
                guest_name AS name, phone, phone_e164, email, note, over_capacity
           FROM reservations WHERE id = $1`,
        [input.id],
      );
      const before = rows[0];
      if (!before) return { ok: false, code: 'not_found' };
      if (before.version !== input.version) return conflict(client, input.id);
      if (!(HOLDING_STATUSES as readonly string[]).includes(before.status)) return { ok: false, code: 'not_allowed' };

      const after = {
        date: input.date,
        time: input.time,
        guests: input.guests,
        name: input.name,
        phone: input.phone,
        phone_e164: input.phoneE164,
        email: input.email,
        note: input.note,
      };
      const changes: Record<string, [unknown, unknown]> = {};
      for (const [key, value] of Object.entries(after)) {
        const old = before[key as keyof typeof after];
        if (old !== value) changes[key] = [old, value];
      }
      // Every UPDATE bumps the version (the trigger), so an unchanged form writes nothing.
      if (Object.keys(changes).length === 0) return { ok: true, data: { version: before.version, changed: false } };

      // A smaller party at the same slot frees covers: only a move or a larger party is re-checked,
      // under the lock of the target day (one booking-day lock per transaction; freeing needs none).
      const moved = input.date !== before.date || input.time !== before.time;
      let meal: Meal | null = null;
      let over = before.over_capacity;
      if (moved || input.guests > before.guests) {
        await lockBookingDay(client, before.restaurant_id, input.date);
        const slot = await checkSlot(client, { ...input, restaurantId: before.restaurant_id }, input.id);
        if (!slot.ok) return slot;
        meal = slot.meal;
        over = slot.over;
      }

      const updated = await client.query<{ version: number }>(
        `UPDATE reservations
            SET reserved_on = $3::date, reserved_at = $4, guests = $5, guest_name = $6, phone = $7, phone_e164 = $8,
                email = $9, note = $10, meal = coalesce($11, meal), over_capacity = $12, updated_by = $13
          WHERE id = $1 AND version = $2
          RETURNING version`,
        [input.id, input.version, input.date, input.time, input.guests, input.name, input.phone, input.phoneE164, input.email, input.note, meal, over, actor.id],
      );
      if (updated.rowCount === 0) return conflict(client, input.id);
      await insertEvent(client, actor, {
        reservationId: input.id,
        type: 'edited',
        changes: { ...changes, ...(over !== before.over_capacity ? { over_capacity: [before.over_capacity, over] } : {}) },
        reason: over && meal ? input.overCapacityReason : null,
      });
      return { ok: true, data: { version: updated.rows[0].version, changed: true } };
    });
  } catch (err) {
    if (constraintOf(err) === 'reservations_dedupe_v2_idx') return { ok: false, code: 'duplicate' };
    throw err;
  }
}

// ── internal notes ──────────────────────────────────────────────────────────

export async function addReservationNote(
  pool: Pool,
  actor: ReservationActor,
  input: { id: string; body: string },
): Promise<{ ok: true; data: { noteId: string } } | Failure<'not_found'>> {
  return withTransaction(pool, async (client) => {
    const exists = await client.query('SELECT 1 FROM reservations WHERE id = $1', [input.id]);
    if (exists.rowCount === 0) return { ok: false, code: 'not_found' } as const;
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO reservation_notes (reservation_id, author_id, author_label, body) VALUES ($1, $2, $3, $4) RETURNING id::text`,
      [input.id, actor.id, actor.label, input.body],
    );
    // The timeline records that a note was added, never its text (notes stay internal; the anonymiser deletes them).
    await insertEvent(client, actor, { reservationId: input.id, type: 'note_added', changes: { note_id: rows[0].id } });
    return { ok: true, data: { noteId: rows[0].id } } as const;
  });
}
```

- [ ] **Bước 8: Chạy lại test**

Run: lệnh ở Bước 4.
Expected: PASS `Test Files  4 passed (4)`, `Tests  78 passed (78)`

- [ ] **Bước 9: Kiểm rằng khóa là thứ giữ sức chứa: gỡ nó khỏi `createStaffReservation`**

Trong `createStaffReservation`, xóa dòng `await lockBookingDay(client, input.restaurantId, input.date);`, chạy `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/reservation-lifecycle.test.ts` **ba lần**. Expected mỗi lần: `Tests  3 failed | 24 passed (27)`:

```
       × concurrent bookings never exceed capacity (the booking-day lock)
       × a staff booking waits while a guest’s submit holds the restaurant-day, then counts the guest’s covers
       × a guest’s submit waits while a staff booking holds the restaurant-day, then answers full
AssertionError: expected [ { ok: true, …(1) }, …(7) ] to have a length of 5 but got 8
AssertionError: expected true to be false // Object.is equality
AssertionError: expected true to be false // Object.is equality
```

Cả 8 nhóm 3 khách lọt vào 16 chỗ, và không đường nào chờ đường kia. Hai test xuyên đường đỏ ở mọi lần; test đua là một cuộc đua thật, nên không có khóa nó vẫn có thể xanh vì may (lần kiểm chứng trên `p4-folded`: 1 trong 9 lần chạy, load average khoảng 5, ra `2 failed | 25 passed (27)`). Gặp lần đó thì chạy thêm, đừng coi là khóa thừa. Trả dòng đó về; chạy lại: `Tests  27 passed (27)`.

- [ ] **Bước 10: Chạy cổng kiểm tra**

Task này không có màn mới: E2E không đổi.

Expected: typecheck không lỗi; lint thoát 0, 19 cảnh báo; `Test Files  49 passed (49)`, `Tests  530 passed (530)`; `Applied 6 migration(s).`; build thoát 0; check-prerender như Task 5; E2E `78 passed`; visual `8 passed`.

- [ ] **Bước 11: Commit**

```bash
git add lib/reservations/lifecycle.ts lib/reservations/lifecycle.test.ts lib/booking/resolve-day.ts lib/booking/resolve-day.test.ts lib/server/booking/rules.ts test/integration/booking-rules.test.ts lib/server/booking/reservations.ts test/integration/reservation-lifecycle.test.ts
git commit -m "$(cat <<'EOF'
feat: add the reservation lifecycle and the staff writes, under the guest's booking-day lock

lib/reservations/lifecycle.ts is spec §10.3 as one map: the eight
transitions, their reasons and the guest email each will queue in phase 5,
and their time windows (seated from 60 minutes before, no-show 15 minutes
after, corrections within the service day, which runs until 04:00).

lib/server/booking/reservations.ts holds every staff write, each one
transaction with its reservation_events row and nothing in audit_log. A
transition is an UPDATE pinned to the version the page saw and to the
statuses whose window is open; losing a race answers conflict with who got
there first. Staff bookings and edits that move or grow a booking take the
same lockBookingDay as the guest's submit, then check the slot on planDay:
past the online window, with online booking off or above max_party is
fine, a closed service or an off-grid time is not, and past capacity needs
a reason that lands on the event. An effects hook runs inside each
transaction for phase 5's outbox.

Without the lock, eight staff parties of three all book sixteen covers,
and neither path waits for the other.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 9: Hộp thư và màn chi tiết đặt bàn

`/admin/reservations` (Editor và Admin, `reservations:read`): bốn tab, ô tìm kiếm trên mọi đặt bàn, phân trang keyset 30 dòng, nút "Xác nhận" ngay trên dòng. `/admin/reservations/[id]`: thông tin, nút chuyển trạng thái (tắt ngoài cửa sổ, kèm giờ mở), ô lý do, form sửa, ghi chú nội bộ, dòng thời gian. Ba action đầu tiên của đợt 4 (`changeStatus`, `updateReservation`, `addNote`), nên cũng đến đây: `FormMessage`, `submitKeepingValues`, các "nguyên tử" zod, mục menu "Đặt bàn", số đếm ở Tổng quan, và bảng `BOOKING_ACTIONS` của guard CI.

**Files:**
- Create: `lib/reservations/search.ts`, `lib/reservations/search.test.ts`, `lib/server/booking/queries.ts`, `test/integration/reservation-inbox.test.ts`, `lib/admin/booking-schemas.ts`, `lib/admin/booking-schemas.test.ts`, `lib/admin/form.ts`, `app/admin/(shell)/_ui/FormMessage.tsx`, `app/admin/(shell)/reservations/actions.ts`, `app/admin/(shell)/reservations/page.tsx`, `app/admin/(shell)/reservations/QuickConfirm.tsx`, `app/admin/(shell)/reservations/_ui/SectionNav.tsx`, `app/admin/(shell)/reservations/_ui/StatusBadge.tsx`, `app/admin/(shell)/reservations/[id]/page.tsx`, `app/admin/(shell)/reservations/[id]/TransitionPanel.tsx`, `app/admin/(shell)/reservations/[id]/EditReservationForm.tsx`, `app/admin/(shell)/reservations/[id]/NoteForm.tsx`, `e2e/reservation-fixtures.ts`, `e2e/admin-reservations.spec.ts`
- Modify: `lib/admin/format.ts`, `lib/admin/format.test.ts`, `lib/admin/nav.ts`, `lib/admin/nav.test.ts`, `app/admin/(shell)/page.tsx`, `app/admin/(shell)/audit/page.tsx`, `styles/admin.css`, `test/guards/require-permission.guard.test.ts`, `test/guards/server-actions.ts`, `e2e/admin-acceptance.spec.ts`, `e2e/admin-users.spec.ts`, `e2e/admin-audit.spec.ts`

**Interfaces:**
- Consumes: `transitionReservation`, `editReservation`, `addReservationNote`, `staffActor` (Task 8); `availableTransitions`, `opensAtMinutes`, `STATUS_LABELS`, `SOURCE_LABELS`, `serviceDay` (Task 8); `seatings` (Task 2); `loadRestaurantRules` (Task 3); `HOLDING_STATUSES`, `RESERVATION_STATUSES` (`lib/booking/rules.ts`); `actionError`, `ActionResult`, `actionErrorMessage` (Task 7); `toE164` (`lib/phone.ts`); `fromMinutes`, `venueNow` (`lib/venue-time.ts`); `requirePermission`, `requirePagePermission` (đợt 3).
- Produces:
  - `lib/reservations/search.ts`: `type SearchQuery = { kind: 'reference' | 'phone' | 'text'; value: string }`; `normalizeReference(input): string | null`; `parseSearch(raw): SearchQuery | null`; `escapeLike(value)`.
  - `lib/server/booking/queries.ts`: `INBOX_PAGE_SIZE = 30`; `INBOX_TABS = ['pending', 'today', 'upcoming', 'all']`; `type InboxRow`; `listInbox(pool, { tab, q?, after?, today }): Promise<{ rows; next: string | null; searched: boolean }>`; `type ReservationDetail`; `getReservation(pool, id)`; `type ReservationEvent`; `listEvents(pool, reservationId)` (mới nhất trước); `type ReservationNote`; `listNotes(pool, ids): Promise<Map<string, ReservationNote[]>>`; `overviewCounts(pool, today): Promise<{ pending; today; todayCovers }>`.
  - `lib/admin/booking-schemas.ts`: `Id`, `Version`, `IsoDay`, `Time`, `Reason`, `GuestFields`, `TransitionForm`, `EditForm`, `NoteForm` (Task 10–13 thêm vào file này).
  - `lib/admin/form.ts`: `submitKeepingValues(dispatch: (formData: FormData) => void): (event: FormEvent<HTMLFormElement>) => void`.
  - `app/admin/(shell)/_ui/FormMessage.tsx`: `FormMessage({ state, success? })`, `FieldError({ state, name, id })`.
  - `app/admin/(shell)/reservations/actions.ts`: `changeStatus`, `updateReservation`, `addNote` (Task 10, 11 thêm `createReservation`, `cancelReservations`).
  - `app/admin/(shell)/reservations/_ui/SectionNav.tsx`: `SectionNav({ current })` (Task 10, 13 thêm liên kết).
  - `lib/admin/format.ts`: `formatIsoDayVi(date: string): string` ("Th 2, 05/10/2026").
  - `test/guards/server-actions.ts`: `actionPermissions(root, rel, read?): Record<string, Permissions | null>` (`adminOnlyProblems` dùng nó).
  - `e2e/reservation-fixtures.ts`: `venueDay(days)`, `serviceDayNow()`, `newReference()`, `seedReservation({ restaurant?, date?, time?, guests?, status?, name?, meal? })`, `reservationRow(id)`.

- [ ] **Bước 1: Viết test đơn vị và tích hợp**

Create `lib/reservations/search.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { escapeLike, normalizeReference, parseSearch } from './search';

describe('inbox search', () => {
  it('reads new and legacy references however they are typed', () => {
    expect(normalizeReference('FC-7K3QH9XA')).toBe('FC-7K3QH9XA');
    expect(normalizeReference('fc7k3qh9xa')).toBe('FC-7K3QH9XA');
    expect(normalizeReference(' fc-7k3q h9xa ')).toBe('FC-7K3QH9XA');
    expect(normalizeReference('FC-0I1LO000')).toBe('FC-01110000'); // O → 0, I/L → 1, as read over the phone
    expect(normalizeReference('FC-12345')).toBe('FC-12345');
    expect(normalizeReference('fc 12345')).toBe('FC-12345');
    expect(normalizeReference('FC-1234')).toBeNull();
    expect(normalizeReference('FC-UUUUUUUU')).toBeNull(); // U is not Crockford
    expect(normalizeReference('12345')).toBeNull();
  });

  it('turns a phone into E.164, local or international', () => {
    expect(parseSearch('0905 000 000')).toEqual({ kind: 'phone', value: '+84905000000' });
    expect(parseSearch('+84 905 000 000')).toEqual({ kind: 'phone', value: '+84905000000' });
  });

  it('searches names and emails as text, and partial digits as digits', () => {
    expect(parseSearch('Nguyễn Minh')).toEqual({ kind: 'text', value: 'Nguyễn Minh' });
    expect(parseSearch('anh@example.com')).toEqual({ kind: 'text', value: 'anh@example.com' });
    expect(parseSearch('50 00')).toEqual({ kind: 'text', value: '5000' });
    expect(parseSearch('fc-12345')).toEqual({ kind: 'reference', value: 'FC-12345' });
    expect(parseSearch(' a ')).toBeNull();
    expect(parseSearch(undefined)).toBeNull();
  });

  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});
```

Create `lib/admin/booking-schemas.test.ts`. Ca đầu là lỗi spike admin gặp trong E2E: một ô form không render thì không có trong FormData, nên đến zod là `undefined`, không phải `''`:

```ts
import { describe, expect, it } from 'vitest';
import { EditForm, NoteForm, TransitionForm } from './booking-schemas';

/* The booking screens' action inputs (spec §7.3): FormData strings in, typed values or Vietnamese field errors out. */
describe('booking form schemas', () => {
  it('reads a field the form did not render (undefined, not "") as blank: the inbox "Xác nhận" sends no reason', () => {
    expect(TransitionForm.parse({ id: '12', version: '3', to: 'confirmed', reason: undefined })).toEqual({
      id: '12',
      version: 3,
      to: 'confirmed',
      reason: null,
    });
    expect(TransitionForm.parse({ id: '12', version: '3', to: 'cancelled', reason: '  Khách hủy  ' }).reason).toBe('Khách hủy');
    expect(TransitionForm.safeParse({ id: '12', version: '0', to: 'eaten', reason: '' }).success).toBe(false);
  });

  it('an edit: numbers from strings, blanks to null, Vietnamese messages for what staff typed', () => {
    const base = { id: '7', version: '2', date: '2026-10-05', time: '19:00', guests: '4', name: 'Lan', phone: '0905 000 000' };
    expect(EditForm.parse({ ...base, email: '', note: '  ', overCapacityReason: undefined })).toMatchObject({
      guests: 4,
      email: null,
      note: null,
      overCapacityReason: null,
    });
    expect(EditForm.safeParse({ ...base, date: '2026-02-30', time: '7pm', guests: '0', phone: '123', email: 'x' }).error?.flatten().fieldErrors).toEqual({
      date: ['Chọn một ngày hợp lệ.'],
      time: ['Chọn giờ (HH:MM).'],
      guests: ['Ít nhất 1 khách.'],
      phone: ['Số điện thoại không hợp lệ.'],
      email: ['Email không hợp lệ.'],
    });
  });

  it('a note is not blank and at most 2000 characters', () => {
    expect(NoteForm.safeParse({ id: '7', body: '   ' }).error?.flatten().fieldErrors).toEqual({ body: ['Nhập nội dung ghi chú.'] });
    expect(NoteForm.safeParse({ id: '7', body: 'x'.repeat(2001) }).error?.flatten().fieldErrors).toEqual({ body: ['Ghi chú tối đa 2000 ký tự.'] });
  });
});
```

```diff
diff --git a/lib/admin/format.test.ts b/lib/admin/format.test.ts
index 2766ecd..523a1b5 100644
--- a/lib/admin/format.test.ts
+++ b/lib/admin/format.test.ts
@@ -1,5 +1,5 @@
 import { describe, expect, it } from 'vitest';
-import { formatDateTimeVi, formatLongDateVi, todayVi } from './format';
+import { formatDateTimeVi, formatIsoDayVi, formatLongDateVi, todayVi } from './format';
 
 // npm test runs with TZ=UTC, like Vercel: the formatting must still be Vietnam's clock.
 describe('admin dates', () => {
@@ -9,4 +9,9 @@ describe('admin dates', () => {
     expect(formatLongDateVi('2026-10-01T17:30:00Z')).toBe('Thứ Sáu, 2 tháng 10, 2026');
     expect(todayVi(new Date('2026-10-01T23:00:00Z'))).toBe('Thứ Sáu, 2 tháng 10, 2026');
   });
+
+  it('formats a calendar date as itself, whatever the server timezone', () => {
+    expect(formatIsoDayVi('2026-10-05')).toBe('Th 2, 05/10/2026');
+    expect(formatIsoDayVi('2026-10-04')).toBe('CN, 04/10/2026');
+  });
 });
```

```diff
diff --git a/lib/admin/nav.test.ts b/lib/admin/nav.test.ts
index 10283c1..7e5ad25 100644
--- a/lib/admin/nav.test.ts
+++ b/lib/admin/nav.test.ts
@@ -3,7 +3,7 @@ import { navFor } from './nav';
 
 describe('navFor', () => {
   it('shows each role only what its permissions open', () => {
-    expect(navFor('admin').map((i) => i.label)).toEqual(['Tổng quan', 'Nhân viên', 'Nhật ký']);
-    expect(navFor('editor').map((i) => i.label)).toEqual(['Tổng quan']);
+    expect(navFor('admin').map((i) => i.label)).toEqual(['Tổng quan', 'Đặt bàn', 'Nhân viên', 'Nhật ký']);
+    expect(navFor('editor').map((i) => i.label)).toEqual(['Tổng quan', 'Đặt bàn']);
   });
 });
```

Create `test/integration/reservation-inbox.test.ts`:

```ts
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { INBOX_PAGE_SIZE, getReservation, listEvents, listInbox, listNotes, overviewCounts } from '@/lib/server/booking/queries';
import { TEST_DATABASE_URL } from '../helpers/db';

/*
 * Spec §7.2 /admin/reservations: the tabs, search by reference, phone, name or
 * email (search_text, folded like fold_search), keyset paging; the detail
 * reads; the overview counts. Dates leave SQL as YYYY-MM-DD (npm test runs on UTC).
 */

let pool: Pool;
const TODAY = '2026-10-02';

type Seed = {
  reference?: string;
  name?: string;
  email?: string | null;
  phone?: string;
  date?: string;
  time?: string;
  status?: string;
  guests?: number;
  restaurant?: string;
  createdAt?: string;
};

async function seed(over: Seed = {}): Promise<string> {
  const phone = over.phone ?? `+849052${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164, email, status, meal, source, created_at)
     VALUES (coalesce($1, 'FC-' || upper(substr(md5(random()::text), 1, 8))), $2, $3::date, $4, $5, $6, $7, $7, $8, $9, 'Dinner', 'web',
             coalesce($10::timestamptz, now()))
     RETURNING id::text`,
    [
      over.reference ?? null,
      over.restaurant ?? 'taya-house',
      over.date ?? '2026-10-05',
      over.time ?? '19:00',
      over.guests ?? 2,
      over.name ?? 'Khách',
      phone,
      over.email ?? null,
      over.status ?? 'requested',
      over.createdAt ?? null,
    ],
  );
  return rows[0].id;
}

const ids = (r: { rows: { id: string }[] }) => r.rows.map((x) => x.id);

describe.skipIf(!TEST_DATABASE_URL)('reservation inbox (database)', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE reservations, reservation_events, reservation_notes CASCADE');
  });

  it('tabs: Cần xử lý (requested, soonest first) · Hôm nay · Sắp tới · Tất cả (newest first)', async () => {
    const later = await seed({ date: '2026-10-06', status: 'requested', createdAt: '2026-10-01T01:00Z' });
    const sooner = await seed({ date: '2026-10-03', status: 'requested', createdAt: '2026-10-01T02:00Z' });
    const today = await seed({ date: TODAY, time: '12:00', status: 'confirmed', createdAt: '2026-10-01T03:00Z' });
    const todayCancelled = await seed({ date: TODAY, time: '19:00', status: 'cancelled', createdAt: '2026-10-01T04:00Z' });
    const upcomingConfirmed = await seed({ date: '2026-10-04', status: 'confirmed', createdAt: '2026-10-01T05:00Z' });
    expect(ids(await listInbox(pool, { tab: 'pending', today: TODAY }))).toEqual([sooner, later]);
    expect(ids(await listInbox(pool, { tab: 'today', today: TODAY }))).toEqual([today, todayCancelled]);
    expect(ids(await listInbox(pool, { tab: 'upcoming', today: TODAY }))).toEqual([sooner, upcomingConfirmed, later]);
    expect(ids(await listInbox(pool, { tab: 'all', today: TODAY }))).toEqual([upcomingConfirmed, todayCancelled, today, sooner, later]);
    const [row] = (await listInbox(pool, { tab: 'today', today: TODAY })).rows;
    expect(row).toMatchObject({ date: TODAY, time: '12:00', restaurantName: 'Tàya House', status: 'confirmed', version: 1, source: 'web' });
  });

  it('finds by new and legacy reference, typed loosely', async () => {
    const fresh = await seed({ reference: 'FC-7K3QH9XA' });
    const legacy = await seed({ reference: 'FC-12345' });
    expect(ids(await listInbox(pool, { tab: 'pending', q: 'fc7k3qh9xa', today: TODAY }))).toEqual([fresh]);
    expect(ids(await listInbox(pool, { tab: 'pending', q: 'FC 12345', today: TODAY }))).toEqual([legacy]);
  });

  it('finds by phone in any format, by a few digits, by name without accents, by email; never by a wildcard', async () => {
    const anh = await seed({ name: 'Nguyễn Minh Ánh', phone: '+84905123456', email: 'Anh.Nguyen@Example.com' });
    const binh = await seed({ name: 'TRẦN VĂN BÌNH', phone: '+84912000999' });
    const search = async (q: string) => ids(await listInbox(pool, { tab: 'today', q, today: TODAY }));
    expect(await search('0905 123 456')).toEqual([anh]);
    expect(await search('+84 905-123-456')).toEqual([anh]);
    expect(await search('3456')).toEqual([anh]);
    expect(await search('nguyen minh anh')).toEqual([anh]);
    expect(await search('Bình')).toEqual([binh]);
    expect(await search('anh.nguyen@example')).toEqual([anh]);
    expect(await search('100%')).toEqual([]); // a LIKE wildcard is a character, not "anything"
    // A search ignores the tab: neither booking is today.
    expect((await listInbox(pool, { tab: 'today', q: 'tran', today: TODAY })).searched).toBe(true);
  });

  it('pages with keyset cursors, without repeats or gaps, in both orders', async () => {
    const total = INBOX_PAGE_SIZE * 2 + 5;
    // Many rows on one sitting (ties broken by id), and created_at values that share a millisecond.
    await pool.query(
      `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164, status, meal, source, created_at)
       SELECT 'FC-' || lpad(g::text, 5, '0'), 'taya-house', '2026-10-05', CASE WHEN g % 2 = 0 THEN '19:00' ELSE '18:30' END, 1, 'Khách ' || g,
              '+8490530' || lpad(g::text, 4, '0'), '+8490530' || lpad(g::text, 4, '0'), 'requested', 'Dinner', 'web',
              timestamptz '2026-10-01 10:00:00.000500+00' - g * interval '1 microsecond'
         FROM generate_series(1, $1) AS g`,
      [total],
    );
    for (const tab of ['pending', 'all'] as const) {
      const seen: string[] = [];
      let after: string | null = null;
      for (let page = 0; page < 5; page++) {
        const result: Awaited<ReturnType<typeof listInbox>> = await listInbox(pool, { tab, after, today: TODAY });
        seen.push(...result.rows.map((r) => r.reference));
        after = result.next;
        if (!after) break;
      }
      expect(seen).toHaveLength(total);
      expect(new Set(seen).size).toBe(total);
    }
    const first = await listInbox(pool, { tab: 'pending', today: TODAY });
    expect(first.rows.slice(0, 2).map((r) => r.time)).toEqual(['18:30', '18:30']);
  });

  it('reads one booking with its timeline (newest first) and its internal notes', async () => {
    const id = await seed({ name: 'Lan', email: 'lan@example.com' });
    await pool.query(
      `INSERT INTO reservation_events (reservation_id, at, actor_kind, type, to_status) VALUES ($1, now() - interval '1 hour', 'guest', 'created', 'requested')`,
      [id],
    );
    await pool.query(
      `INSERT INTO reservation_events (reservation_id, actor_kind, actor_id, actor_label, type, from_status, to_status)
       VALUES ($1, 'staff', 'u1', 'Mai (mai@furama.test)', 'status_changed', 'requested', 'confirmed')`,
      [id],
    );
    await pool.query(`INSERT INTO reservation_notes (reservation_id, author_id, author_label, body) VALUES ($1, 'u1', 'Mai', 'Bàn gần cửa sổ')`, [id]);
    expect(await getReservation(pool, id)).toMatchObject({ id, name: 'Lan', email: 'lan@example.com', date: '2026-10-05', meal: 'Dinner', locale: 'en' });
    expect(await getReservation(pool, '999999')).toBeNull();
    expect(await getReservation(pool, 'abc')).toBeNull();
    expect((await listEvents(pool, id)).map((e) => [e.type, e.actorLabel])).toEqual([
      ['status_changed', 'Mai (mai@furama.test)'],
      ['created', null],
    ]);
    expect((await listNotes(pool, [id])).get(id)?.map((n) => n.body)).toEqual(['Bàn gần cửa sổ']);
    expect(await listNotes(pool, [])).toEqual(new Map());
  });

  it('overview: pending requests, and today’s bookings and covers that hold seats', async () => {
    await seed({ status: 'requested' });
    await seed({ date: TODAY, guests: 4, status: 'confirmed' });
    await seed({ date: TODAY, guests: 2, status: 'requested' });
    await seed({ date: TODAY, guests: 3, status: 'seated' });
    await seed({ date: TODAY, guests: 9, status: 'cancelled' });
    await seed({ date: TODAY, guests: 5, status: 'no_show' });
    expect(await overviewCounts(pool, TODAY)).toEqual({ pending: 2, today: 3, todayCovers: 9 });
  });
});
```

Guard CI ghim quyền chính xác của từng action đặt bàn (bảng sẽ lớn dần tới Task 13):

```diff
diff --git a/test/guards/require-permission.guard.test.ts b/test/guards/require-permission.guard.test.ts
index 3591e7d..859dda6 100644
--- a/test/guards/require-permission.guard.test.ts
+++ b/test/guards/require-permission.guard.test.ts
@@ -2,7 +2,8 @@ import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
 import { tmpdir } from 'node:os';
 import { dirname, join } from 'node:path';
 import { describe, expect, it } from 'vitest';
-import { adminOnlyProblems, adminPluginCalls, adminPluginCallsIn, checkActions, publicActionsMissing, scanRepo } from './server-actions';
+import { roleCan } from '../../lib/server/auth/permissions';
+import { actionPermissions, adminOnlyProblems, adminPluginCalls, adminPluginCallsIn, checkActions, publicActionsMissing, scanRepo } from './server-actions';
 
 /*
  * Spec §7.1 / §13 "Bảo vệ": every Server Action ('use server' export or inline
@@ -42,6 +43,34 @@ describe('requirePermission guard (the repository)', () => {
 /** Files whose every action is Admin-only (spec §7.1: staff, invitations). */
 const ADMIN_ONLY_ACTIONS = ['app/admin/(shell)/users/actions.ts'];
 
+/*
+ * Spec §7.1's matrix for the booking screens, action by action: the exact
+ * permission each one asks for, and whether an Editor has it. A swapped
+ * permission (an Editor locked out of a booking screen, or let into an
+ * Admin-only one) fails here, and so does an action added without a row.
+ */
+const BOOKING_ACTIONS: Record<string, Record<string, { permission: object; editor: boolean }>> = {
+  'app/admin/(shell)/reservations/actions.ts': {
+    changeStatus: { permission: { reservations: ['update'] }, editor: true },
+    updateReservation: { permission: { reservations: ['update'] }, editor: true },
+    addNote: { permission: { reservations: ['note'] }, editor: true },
+  },
+};
+
+describe('booking actions follow the permission matrix (spec §7.1)', () => {
+  for (const [rel, actions] of Object.entries(BOOKING_ACTIONS)) {
+    it(rel, () => {
+      const found = actionPermissions(ROOT, rel);
+      expect(Object.keys(found).sort()).toEqual(Object.keys(actions).sort());
+      for (const [name, { permission, editor }] of Object.entries(actions)) {
+        expect(found[name], name).toEqual(permission);
+        expect(roleCan('editor', permission), `${name}: Editor`).toBe(editor);
+        expect(roleCan('admin', permission), `${name}: Admin`).toBe(true);
+      }
+    });
+  }
+});
+
 describe('requirePermission guard (what it catches)', () => {
   const none = new Set<string>();
   const check = (source: string, rel = 'app/x/actions.ts', allow = none) => checkActions(rel, source, allow);
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/reservations/search.test.ts lib/admin/booking-schemas.test.ts lib/admin/format.test.ts lib/admin/nav.test.ts test/integration/reservation-inbox.test.ts test/guards/require-permission.guard.test.ts`
Expected: FAIL `Test Files  6 failed (6)`, `Tests  3 failed | 19 passed (22)`:

```
 FAIL  test/integration/reservation-inbox.test.ts [ test/integration/reservation-inbox.test.ts ]
Error: Cannot find package '@/lib/server/booking/queries' imported from …/test/integration/reservation-inbox.test.ts
 FAIL  lib/admin/booking-schemas.test.ts [ lib/admin/booking-schemas.test.ts ]
Error: Cannot find module './booking-schemas' imported from …/lib/admin/booking-schemas.test.ts
 FAIL  lib/reservations/search.test.ts [ lib/reservations/search.test.ts ]
Error: Cannot find module './search' imported from …/lib/reservations/search.test.ts
 FAIL  test/guards/require-permission.guard.test.ts > booking actions follow the permission matrix (spec §7.1) > app/admin/(shell)/reservations/actions.ts
TypeError: actionPermissions is not a function
 FAIL  lib/admin/format.test.ts > admin dates > formats a calendar date as itself, whatever the server timezone
TypeError: formatIsoDayVi is not a function
 FAIL  lib/admin/nav.test.ts > navFor > shows each role only what its permissions open
AssertionError: expected [ 'Tổng quan', 'Nhân viên', 'Nhật ký' ] to deeply equal [ 'Tổng quan', 'Đặt bàn', …(2) ]
```

- [ ] **Bước 3: Viết E2E**

Create `e2e/reservation-fixtures.ts` (import tương đối như các spec khác; `serviceDayNow` dùng chính `serviceDay` của Task 8):

```ts
import { randomBytes, randomInt } from 'node:crypto';
import { serviceDay } from '../lib/reservations/lifecycle';
import { addDays, venueNow } from '../lib/venue-time';
import { db } from './staff-fixtures';

/*
 * Bookings for the admin specs, written straight into the local _test
 * database through db() (which refuses anything else). Each booking gets a
 * fresh reference and phone, so parallel specs never meet on the unique
 * indexes. Dates are Da Nang's, whatever the runner's timezone.
 */

/** Da Nang's calendar date, `days` from today. */
export const venueDay = (days = 0) => addDays(venueNow().date, days);

/** The service day now (it runs until 04:00 the next morning). */
export const serviceDayNow = () => serviceDay();

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const newReference = () => `FC-${Array.from({ length: 8 }, () => CROCKFORD[randomInt(32)]).join('')}`;

export type SeededReservation = { id: string; reference: string; phone: string };

export async function seedReservation(
  over: { restaurant?: string; date?: string; time?: string; guests?: number; status?: string; name?: string; meal?: string } = {},
): Promise<SeededReservation> {
  const reference = newReference();
  const phone = `+849${String(randomInt(10_000_000, 99_999_999))}`;
  const client = db();
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164, status, meal, source)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7, $7, $8, $9, 'web') RETURNING id::text`,
      [
        reference,
        over.restaurant ?? 'taya-house',
        over.date ?? venueDay(3),
        over.time ?? '19:00',
        over.guests ?? 2,
        over.name ?? `Khách E2E ${randomBytes(2).toString('hex')}`,
        phone,
        over.status ?? 'requested',
        over.meal ?? 'Dinner',
      ],
    );
    return { id: rows[0].id, reference, phone };
  } finally {
    await client.end();
  }
}

export async function reservationRow(
  id: string,
): Promise<{ status: string; status_reason: string | null; version: number; reserved_at: string; guests: number; over_capacity: boolean }> {
  const client = db();
  await client.connect();
  try {
    return (await client.query('SELECT status, status_reason, version, reserved_at, guests, over_capacity FROM reservations WHERE id = $1', [id])).rows[0];
  } finally {
    await client.end();
  }
}
```

Create `e2e/admin-reservations.spec.ts`:

```ts
import type { Page } from '@playwright/test';
import { expectHydrated, watchCsp } from './csp';
import { reservationRow, seedReservation, serviceDayNow, venueDay } from './reservation-fixtures';
import { STAFF, expect, newVisitor, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * Spec §14.1 phase 4, the inbox and the detail screen: confirm, cancel and
 * no-show work, with the time windows and the version conflict of §10.3;
 * the inbox search; an edit re-checked against capacity. The admin CSP stays
 * clean (no inline styles). Tàya House at +3, +4 and yesterday, V-Senses Cafe
 * at +8: dates no other spec books there.
 */

test.beforeAll(() => seedStaff());

const main = (page: Page) => page.getByRole('main');

test('an Editor confirms a request; the timeline names who did it', async ({ page }) => {
  const r = await seedReservation();
  const violations = await watchCsp(page);
  await signInAs(page, STAFF.editor);
  await expect(page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link', { name: 'Đặt bàn' })).toBeVisible();
  await expect(main(page).getByTestId('pending-count')).toContainText('chờ xác nhận');
  await page.goto(`/admin/reservations/${r.id}`);
  await expectHydrated(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`Đặt bàn ${r.reference}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Chờ xác nhận');

  await main(page).getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(main(page).getByRole('status')).toHaveText('Đã cập nhật trạng thái.');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Đã xác nhận');
  const timeline = page.getByRole('list', { name: 'Dòng thời gian' });
  await expect(timeline.getByRole('listitem').first()).toContainText('Chờ xác nhận → Đã xác nhận');
  await expect(timeline.getByRole('listitem').first()).toContainText(`${STAFF.editor.name} (${STAFF.editor.email})`);
  expect(await reservationRow(r.id)).toMatchObject({ status: 'confirmed', version: 2 });
  expect(violations).toEqual([]);
});

test('cancel needs a reason; the reason is kept and shown', async ({ page }) => {
  const r = await seedReservation({ status: 'confirmed' });
  await signInAs(page, STAFF.editor);
  await page.goto(`/admin/reservations/${r.id}`);
  await main(page).getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(main(page).getByText('Nhập lý do.')).toBeVisible();
  expect((await reservationRow(r.id)).status).toBe('confirmed');

  await page.getByLabel('Lý do (bắt buộc khi hủy hoặc từ chối)', { exact: true }).fill('Khách gọi báo hủy');
  await main(page).getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Đã hủy');
  await expect(page.getByRole('list', { name: 'Dòng thời gian' }).getByRole('listitem').first()).toContainText('Lý do: Khách gọi báo hủy');
  await expect(main(page).getByText('Đặt bàn đã kết thúc; không còn thao tác nào.')).toBeVisible();
  expect(await reservationRow(r.id)).toMatchObject({ status: 'cancelled', status_reason: 'Khách gọi báo hủy' });
});

test('no-show only once the sitting is 15 minutes past; the correction only on the same service day', async ({ page }) => {
  const future = await seedReservation({ status: 'confirmed', date: venueDay(3) });
  const past = await seedReservation({ status: 'confirmed', date: venueDay(-1), time: '19:00' });
  await signInAs(page, STAFF.editor);

  await page.goto(`/admin/reservations/${future.id}`);
  await expect(main(page).getByRole('button', { name: 'Không đến', exact: true })).toBeDisabled();
  await expect(main(page).getByRole('button', { name: 'Đã đến', exact: true })).toBeDisabled();
  await expect(main(page).getByText(/^Từ 19:15 ngày /)).toBeVisible();
  await expect(main(page).getByText(/^Từ 18:00 ngày /)).toBeVisible();

  await page.goto(`/admin/reservations/${past.id}`);
  await main(page).getByRole('button', { name: 'Không đến', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Không đến');
  expect((await reservationRow(past.id)).status).toBe('no_show');
  // Yesterday's sitting is correctable only while yesterday's service day lasts (until 04:00).
  const correction = main(page).getByRole('button', { name: 'Sửa: khách đã đến', exact: true });
  if (serviceDayNow() === venueDay(-1)) await expect(correction).toBeEnabled();
  else {
    await expect(correction).toBeDisabled();
    await expect(main(page).getByText('Chỉ sửa được trong ngày phục vụ.')).toBeVisible();
  }
});

test('two people at once: the second sees who changed it first, and nothing is overwritten', async ({ page, browser }, testInfo) => {
  const r = await seedReservation();
  const other = await newVisitor(browser, testInfo);
  await signInAs(page, STAFF.editor);
  await signInAs(other, STAFF.admin);
  await page.goto(`/admin/reservations/${r.id}`);
  await other.goto(`/admin/reservations/${r.id}`);

  await other.getByRole('main').getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(other.getByRole('heading', { level: 1 })).toContainText('Đã xác nhận');

  await page.getByLabel('Lý do (bắt buộc khi hủy hoặc từ chối)', { exact: true }).fill('Trùng lịch');
  await main(page).getByRole('button', { name: 'Từ chối', exact: true }).click();
  const alert = main(page).getByRole('alert');
  await expect(alert).toContainText(`Vừa được ${STAFF.admin.name} (${STAFF.admin.email}) thay đổi lúc`);
  expect((await reservationRow(r.id)).status).toBe('confirmed');
  await alert.getByRole('button', { name: 'Tải lại' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Đã xác nhận');
  await other.context().close();
});

test('the inbox finds a booking by reference or phone, and confirms it from the list', async ({ page }) => {
  const r = await seedReservation({ restaurant: 'v-senses-cafe', date: venueDay(8) });
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/reservations');
  await page.getByLabel('Tìm theo mã, số điện thoại, tên hoặc email', { exact: true }).fill(r.reference.toLowerCase().replace('-', ''));
  await page.getByRole('button', { name: 'Tìm', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: r.reference })).toBeVisible();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);

  const local = `0${r.phone.slice(3, 6)} ${r.phone.slice(6, 9)} ${r.phone.slice(9)}`;
  await page.goto(`/admin/reservations?q=${encodeURIComponent(local)}`);
  await expect(page.getByRole('row').filter({ hasText: r.reference })).toBeVisible();

  // A requested booking can be confirmed right from the results.
  await page.getByRole('button', { name: `Xác nhận ${r.reference}` }).click();
  await expect(page.getByRole('row').filter({ hasText: r.reference })).toContainText('Đã xác nhận');
  expect((await reservationRow(r.id)).status).toBe('confirmed');
});

test('an edit into a full slot is refused with the covers left, keeps what was typed, then saves with a reason', async ({ page }) => {
  const date = venueDay(4);
  await seedReservation({ date, time: '19:30', guests: 15, status: 'confirmed' });
  const r = await seedReservation({ date, time: '19:00', guests: 2 });
  await signInAs(page, STAFF.editor);
  await page.goto(`/admin/reservations/${r.id}`);
  await expectHydrated(page);
  const form = page.getByRole('form', { name: 'Sửa đặt bàn' });
  await form.getByLabel('Giờ', { exact: true }).selectOption('19:30');
  await form.getByLabel('Yêu cầu của khách', { exact: true }).fill('Ghế em bé');
  await form.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(form.getByRole('alert')).toHaveText('Khung giờ này chỉ còn 1 chỗ. Muốn vẫn nhận, hãy ghi lý do vượt sức chứa.');
  await expect(form.getByLabel('Giờ', { exact: true })).toHaveValue('19:30');
  await expect(form.getByLabel('Yêu cầu của khách', { exact: true })).toHaveValue('Ghế em bé');
  expect(await reservationRow(r.id)).toMatchObject({ reserved_at: '19:00', version: 1 });

  await form.getByLabel('Lý do vượt sức chứa (chỉ khi khung giờ đã hết chỗ)', { exact: true }).fill('Khách quen, kê thêm ghế');
  await form.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(form.getByRole('status')).toHaveText('Đã lưu.');
  await expect(page.getByTestId('sitting')).toContainText('19:30');
  const latest = page.getByRole('list', { name: 'Dòng thời gian' }).getByRole('listitem').first();
  await expect(latest).toContainText('Giờ: 19:00 → 19:30');
  await expect(latest).toContainText('Lý do: Khách quen, kê thêm ghế');
  expect(await reservationRow(r.id)).toMatchObject({ reserved_at: '19:30', over_capacity: true, version: 2 });
});
```

Menu của Editor ở hai spec đợt 3 có thêm "Đặt bàn"; dòng đặt bàn ở nhật ký thành liên kết:

```diff
diff --git a/e2e/admin-acceptance.spec.ts b/e2e/admin-acceptance.spec.ts
index eed718a..3ba981b 100644
--- a/e2e/admin-acceptance.spec.ts
+++ b/e2e/admin-acceptance.spec.ts
@@ -102,7 +102,8 @@ test('2. a role change writes exactly one audit row, with the acting Admin', asy
 test('3. the Editor is kept out of the Admin area, including a direct POST to an Admin-only action', async ({ browser, playwright, baseURL }, testInfo) => {
   const editor = await newVisitor(browser, testInfo);
   await signInAs(editor, invitee);
-  await expect(editor.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link')).toHaveText(['Tổng quan']);
+  // Phase 4 opens the booking screens to Editors (spec §7.1); the Admin area stays closed.
+  await expect(editor.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link')).toHaveText(['Tổng quan', 'Đặt bàn']);
   const res = await editor.goto('/admin/users');
   expect(await res?.text()).not.toContain(STAFF.admin.email);
   await expect(editor.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible();
```

```diff
diff --git a/e2e/admin-users.spec.ts b/e2e/admin-users.spec.ts
index abb83a7..4791a4c 100644
--- a/e2e/admin-users.spec.ts
+++ b/e2e/admin-users.spec.ts
@@ -155,7 +155,8 @@ test('remove deletes the account, after a confirmation', async ({ page }) => {
 
 test('an Editor has no Nhân viên link, and /admin/users shows the 403 view with no staff data', async ({ page }) => {
   await signInAs(page, STAFF.editor);
-  await expect(page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link')).toHaveText(['Tổng quan']);
+  // Phase 4 opens the booking screens to Editors (spec §7.1); the Admin area stays closed.
+  await expect(page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link')).toHaveText(['Tổng quan', 'Đặt bàn']);
   // Status 200, not 403: see app/admin/layout.tsx. What matters is what the response holds.
   const res = await page.goto('/admin/users');
   const body = (await res?.text()) ?? '';
```

```diff
diff --git a/e2e/admin-audit.spec.ts b/e2e/admin-audit.spec.ts
index 171ae19..2f7c002 100644
--- a/e2e/admin-audit.spec.ts
+++ b/e2e/admin-audit.spec.ts
@@ -55,6 +55,10 @@ test('a booking event shows the booking’s reference, and an invitation its ema
   await expect(event.getByRole('cell').nth(2)).toHaveText('Đổi trạng thái đặt bàn');
   await expect(event.getByRole('cell').nth(3)).toHaveText(`Đặt bàn · ${reference}`);
   await expect(page.getByRole('row').filter({ hasText: email }).getByRole('cell').nth(3)).toHaveText(`Lời mời · ${email}`);
+  // The booking's row opens the booking.
+  await event.getByRole('link', { name: `Đặt bàn · ${reference}` }).click();
+  await expect(page).toHaveURL(new RegExp(`/admin/reservations/${booking!.id}$`));
+  await expect(page.getByRole('heading', { level: 1 })).toContainText(`Đặt bàn ${reference}`);
 });
 
 test('the Admin pages back and forth through older entries', async ({ page }) => {
```

- [ ] **Bước 4: Build code hiện tại và chạy các đặc tả đổi: phải đỏ**

Chỉ giữ các file `e2e/` của bước 3 (test đơn vị của bước 1 import module chưa có, mà `next build` typecheck cả test, nên tạm cất chúng), build, rồi chạy `e2e/admin-reservations.spec.ts e2e/admin-audit.spec.ts e2e/admin-acceptance.spec.ts e2e/admin-users.spec.ts`.

Expected: `9 failed`, `1 did not run`, `11 passed`:

```
  ✘  [desktop] › e2e/admin-reservations.spec.ts › an Editor confirms a request; the timeline names who did it
  ✘  [desktop] › e2e/admin-reservations.spec.ts › cancel needs a reason; the reason is kept and shown
  ✘  [desktop] › e2e/admin-reservations.spec.ts › no-show only once the sitting is 15 minutes past; the correction only on the same service day
  ✘  [desktop] › e2e/admin-reservations.spec.ts › two people at once: the second sees who changed it first, and nothing is overwritten
  ✘  [desktop] › e2e/admin-reservations.spec.ts › the inbox finds a booking by reference or phone, and confirms it from the list
  ✘  [desktop] › e2e/admin-reservations.spec.ts › an edit into a full slot is refused with the covers left, keeps what was typed, then saves with a reason
  ✘  [desktop] › e2e/admin-audit.spec.ts › a booking event shows the booking’s reference, and an invitation its email
  ✘  [desktop] › e2e/admin-acceptance.spec.ts › 3. the Editor is kept out of the Admin area, including a direct POST to an Admin-only action
  ✘  [desktop] › e2e/admin-users.spec.ts › an Editor has no Nhân viên link, and /admin/users shows the 403 view with no staff data
```

Test đầu: `Locator: getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link', { name: 'Đặt bàn' })`, `Error: element(s) not found`; các test chi tiết hết giờ chờ nút; hai test menu `Expected - 1 / Received + 0` ("Đặt bàn" chưa có). "4. a browser call to /api/auth/admin/*" không chạy vì file `admin-acceptance` chạy nối tiếp. Lấy lại các file đã cất.

- [ ] **Bước 5: Viết tìm kiếm và các truy vấn đọc**

Create `lib/reservations/search.ts`:

```ts
import { toE164 } from '@/lib/phone';

/*
 * What staff typed in the inbox search box (spec §7.2: mã, SĐT, tên, email).
 * A reference or a phone is an exact lookup on its own index; anything else
 * is a substring of reservations.search_text (trigram index), folded by the
 * same SQL function that built the column (fold_search).
 */
export type SearchQuery = { kind: 'reference'; value: string } | { kind: 'phone'; value: string } | { kind: 'text'; value: string };

const CROCKFORD_8 = /^[0-9A-HJKMNP-TV-Z]{8}$/;
const LEGACY_5 = /^\d{5}$/;
const PHONE_CHARS = /^[+\d\s().-]+$/;

/**
 * FC-XXXXXXXX (Crockford base32) or a phase-1 FC-12345, whatever the case,
 * with or without the dash; O reads as 0 and I/L as 1, as spoken over the
 * phone. Only when it starts with "FC": five bare digits are more likely part
 * of a phone number.
 */
export function normalizeReference(input: string): string | null {
  const compact = input.trim().toUpperCase().replace(/[\s-]/g, '');
  if (!compact.startsWith('FC')) return null;
  const body = compact.slice(2).replace(/O/g, '0').replace(/[IL]/g, '1');
  return LEGACY_5.test(body) || CROCKFORD_8.test(body) ? `FC-${body}` : null;
}

export function parseSearch(raw: string | null | undefined): SearchQuery | null {
  const q = (raw ?? '').trim().slice(0, 100);
  if (q.length < 2) return null;
  const reference = normalizeReference(q);
  if (reference) return { kind: 'reference', value: reference };
  if (PHONE_CHARS.test(q) && q.replace(/\D/g, '').length >= 8) {
    const phone = toE164(q);
    if (phone) return { kind: 'phone', value: phone };
  }
  // Digits only: search_text holds the phone's digits, so "3456" finds a number ending in 3456.
  return { kind: 'text', value: PHONE_CHARS.test(q) ? q.replace(/\D/g, '') : q };
}

/** Escapes LIKE's wildcards, so "50%" matches those characters, not everything. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
```

Ngày rời SQL bằng `to_char`; con trỏ của tab theo giờ ngồi là `YYYY-MM-DD_HH:MM_id`, của tab "Tất cả" là `<µs>_<id>`. Ô tìm dùng `fold_search($1)` của migration 006 (quy tắc code 6). Create `lib/server/booking/queries.ts`:

```ts
import 'server-only';
import type { Pool } from 'pg';
import { HOLDING_STATUSES, type ReservationStatus } from '@/lib/booking/rules';
import type { Meal } from '@/lib/data';
import { escapeLike, parseSearch } from '@/lib/reservations/search';
import type { IsoDate } from '@/lib/venue-time';

/*
 * The admin's reservation reads. Keyset pagination (no OFFSET): the cursor
 * holds the sort key of the last row shown. Dates leave SQL through to_char
 * (node-pg would turn a `date` into a JS Date at the server's midnight), and
 * created_at travels as microseconds since the epoch (exact; a JS Date keeps
 * only milliseconds and would skip or repeat rows that share one).
 */

export const INBOX_PAGE_SIZE = 30;
export const INBOX_TABS = ['pending', 'today', 'upcoming', 'all'] as const;
export type InboxTab = (typeof INBOX_TABS)[number];

export type InboxRow = {
  id: string;
  reference: string;
  restaurantId: string;
  restaurantName: string;
  date: IsoDate;
  time: string;
  guests: number;
  name: string;
  phone: string;
  email: string | null;
  status: ReservationStatus;
  source: string;
  version: number;
  overCapacity: boolean;
  isTest: boolean;
  createdAt: Date;
  /** The row's sort key, opaque to the page. */
  cursor: string;
};

const SITTING_CURSOR = /^(\d{4}-\d{2}-\d{2})_(\d{2}:\d{2})_(\d{1,18})$/;
const CREATED_CURSOR = /^(\d{1,17})_(\d{1,18})$/;

const COLUMNS = `r.id::text, r.reference, r.restaurant_id AS "restaurantId", t.name AS "restaurantName",
  to_char(r.reserved_on, 'YYYY-MM-DD') AS date, r.reserved_at AS time, r.guests, r.guest_name AS name, r.phone, r.email,
  r.status, r.source, r.version, r.over_capacity AS "overCapacity", r.is_test AS "isTest", r.created_at AS "createdAt"`;

/**
 * One page of a tab, or of a search. Cần xử lý: requested, soonest sitting
 * first. Hôm nay: every booking of `today` (Da Nang's date). Sắp tới:
 * requested or confirmed after today. Tất cả: newest first. A search looks
 * through every booking, newest first, whatever the tab.
 */
export async function listInbox(
  pool: Pool,
  options: { tab: InboxTab; q?: string | null; after?: string | null; today: IsoDate },
): Promise<{ rows: InboxRow[]; next: string | null; searched: boolean }> {
  const search = parseSearch(options.q);
  const tab: InboxTab = search ? 'all' : options.tab;
  const bySitting = tab !== 'all';
  const where: string[] = [];
  const values: unknown[] = [];
  const param = (v: unknown) => `$${values.push(v)}`;

  if (tab === 'pending') where.push(`r.status = 'requested'`);
  if (tab === 'today') where.push(`r.reserved_on = ${param(options.today)}::date`);
  if (tab === 'upcoming') where.push(`r.reserved_on > ${param(options.today)}::date`, `r.status IN ('requested', 'confirmed')`);

  if (search?.kind === 'reference') where.push(`r.reference = ${param(search.value)}`);
  if (search?.kind === 'phone') where.push(`r.phone_e164 = ${param(search.value)}`);
  if (search?.kind === 'text') where.push(`r.search_text LIKE '%' || fold_search(${param(escapeLike(search.value))}) || '%'`);

  const cursor = options.after ?? '';
  if (bySitting) {
    const m = SITTING_CURSOR.exec(cursor);
    if (m) where.push(`(r.reserved_on, r.reserved_at, r.id) > (${param(m[1])}::date, ${param(m[2])}, ${param(m[3])}::bigint)`);
  } else {
    const m = CREATED_CURSOR.exec(cursor);
    if (m) {
      where.push(`(r.created_at, r.id) < (timestamptz 'epoch' + ${param(m[1])}::bigint * interval '1 microsecond', ${param(m[2])}::bigint)`);
    }
  }

  const order = bySitting ? 'r.reserved_on, r.reserved_at, r.id' : 'r.created_at DESC, r.id DESC';
  const key = bySitting
    ? `to_char(r.reserved_on, 'YYYY-MM-DD') || '_' || r.reserved_at || '_' || r.id::text`
    : `(extract(epoch FROM r.created_at) * 1000000)::bigint::text || '_' || r.id::text`;
  const { rows } = await pool.query<InboxRow>(
    `SELECT ${COLUMNS}, ${key} AS cursor
       FROM reservations r JOIN restaurants t ON t.id = r.restaurant_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${order}
      LIMIT ${INBOX_PAGE_SIZE + 1}`,
    values,
  );
  const page = rows.slice(0, INBOX_PAGE_SIZE);
  return { rows: page, next: rows.length > INBOX_PAGE_SIZE ? page[page.length - 1].cursor : null, searched: search !== null };
}

export type ReservationDetail = Omit<InboxRow, 'cursor'> & {
  meal: Meal;
  note: string | null;
  locale: string;
  statusReason: string | null;
};

export async function getReservation(pool: Pool, id: string): Promise<ReservationDetail | null> {
  if (!/^\d{1,18}$/.test(id)) return null;
  const { rows } = await pool.query<ReservationDetail>(
    `SELECT ${COLUMNS}, r.meal, r.note, r.locale, r.status_reason AS "statusReason"
       FROM reservations r JOIN restaurants t ON t.id = r.restaurant_id
      WHERE r.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export type ReservationEvent = {
  id: string;
  at: Date;
  actorKind: string;
  actorLabel: string | null;
  type: string;
  fromStatus: ReservationStatus | null;
  toStatus: ReservationStatus | null;
  changes: Record<string, unknown> | null;
  reason: string | null;
};

/** The timeline of one booking, newest first. */
export async function listEvents(pool: Pool, reservationId: string): Promise<ReservationEvent[]> {
  const { rows } = await pool.query<ReservationEvent>(
    `SELECT id::text, at, actor_kind AS "actorKind", actor_label AS "actorLabel", type,
            from_status AS "fromStatus", to_status AS "toStatus", changes, reason
       FROM reservation_events WHERE reservation_id = $1 ORDER BY at DESC, id DESC`,
    [reservationId],
  );
  return rows;
}

export type ReservationNote = { id: string; authorLabel: string; body: string; createdAt: Date };

/** Internal notes, oldest first, for several bookings at once (the detail page, the day sheet). */
export async function listNotes(pool: Pool, reservationIds: readonly string[]): Promise<Map<string, ReservationNote[]>> {
  const out = new Map<string, ReservationNote[]>();
  if (reservationIds.length === 0) return out;
  const { rows } = await pool.query<ReservationNote & { reservationId: string }>(
    `SELECT id::text, reservation_id::text AS "reservationId", author_label AS "authorLabel", body, created_at AS "createdAt"
       FROM reservation_notes WHERE reservation_id = ANY ($1::bigint[]) ORDER BY created_at, id`,
    [[...reservationIds]],
  );
  for (const { reservationId, ...note } of rows) out.set(reservationId, [...(out.get(reservationId) ?? []), note]);
  return out;
}

/** /admin: requests waiting for staff (any date), and today's bookings and covers that hold seats. */
export async function overviewCounts(pool: Pool, today: IsoDate): Promise<{ pending: number; today: number; todayCovers: number }> {
  const { rows } = await pool.query<{ pending: number; today: number; todayCovers: number }>(
    `SELECT (SELECT count(*)::int FROM reservations WHERE status = 'requested') AS pending,
            count(*)::int AS today,
            coalesce(sum(guests), 0)::int AS "todayCovers"
       FROM reservations
      WHERE reserved_on = $1::date AND status = ANY ($2::text[])`,
    [today, HOLDING_STATUSES],
  );
  return rows[0];
}
```

- [ ] **Bước 6: Viết schema, helper form, câu báo dùng chung, ngày và menu**

Create `lib/admin/booking-schemas.ts`:

```ts
import { RESERVATION_STATUSES } from '@/lib/booking/rules';
import { toE164 } from '@/lib/phone';
import { isValidIsoDate } from '@/lib/venue-time';
import { z } from './zod';

/*
 * Input schemas of the booking screens' Server Actions (spec §7.3:
 * Vietnamese messages for every field people type into). Everything arrives
 * as FormData strings; an empty optional field, or one the form did not
 * render, becomes null.
 */

// A field the form did not render has no FormData entry: undefined counts as blank too.
const blankToNull = (v: unknown) => (v === undefined || (typeof v === 'string' && v.trim() === '') ? null : v);

export const Id = z.string().regex(/^\d{1,18}$/);
export const Version = z.coerce.number().int().min(1);
export const IsoDay = z.string().refine(isValidIsoDate, { error: 'Chọn một ngày hợp lệ.' });
export const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'Chọn giờ (HH:MM).' });

/** A reason staff write: at most 500 characters (reservation_events.reason); blank = none. */
export const Reason = z.preprocess(blankToNull, z.string().trim().max(500, { error: 'Lý do tối đa 500 ký tự.' }).nullable());

export const TransitionForm = z.object({
  id: Id,
  version: Version,
  to: z.enum(RESERVATION_STATUSES),
  reason: Reason,
});

/** The guest's details as staff type them; the limits are the guest form's (lib/server/booking/input.ts). */
export const GuestFields = {
  guests: z.coerce.number({ error: 'Nhập số khách.' }).int().min(1, { error: 'Ít nhất 1 khách.' }).max(50, { error: 'Tối đa 50 khách.' }),
  name: z.string().trim().min(2, { error: 'Nhập tên khách (ít nhất 2 ký tự).' }).max(120, { error: 'Tên tối đa 120 ký tự.' }),
  phone: z
    .string()
    .trim()
    .min(1, { error: 'Nhập số điện thoại.' })
    .max(40, { error: 'Số điện thoại không hợp lệ.' })
    .refine((v) => toE164(v) !== null, { error: 'Số điện thoại không hợp lệ.' }),
  email: z.preprocess(blankToNull, z.email({ error: 'Email không hợp lệ.' }).max(254).nullable()),
  note: z.preprocess(blankToNull, z.string().trim().max(1000, { error: 'Yêu cầu tối đa 1000 ký tự.' }).nullable()),
  overCapacityReason: Reason,
};

export const EditForm = z.object({ id: Id, version: Version, date: IsoDay, time: Time, ...GuestFields });

export const NoteForm = z.object({
  id: Id,
  body: z.string().trim().min(1, { error: 'Nhập nội dung ghi chú.' }).max(2000, { error: 'Ghi chú tối đa 2000 ký tự.' }),
});
```

Create `lib/admin/form.ts`:

```ts
import { startTransition, type FormEvent } from 'react';

/*
 * `<form action={dispatch}>` resets every uncontrolled field once the action
 * settles, whatever it returned, so a refused form loses what staff typed
 * (phase-3 ledger, phase 7 "echo submitted values back on failure"). Long
 * forms submit through this instead: the same useActionState dispatcher (so
 * `pending` and the returned state work as usual), the same FormData (with
 * the clicked button's name and value), and no reset. Client components only.
 */
export function submitKeepingValues(dispatch: (formData: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter instanceof HTMLElement ? submitter : null);
    startTransition(() => dispatch(formData));
  };
}
```

Create `app/admin/(shell)/_ui/FormMessage.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { actionErrorMessage } from '@/lib/admin/auth-errors';
import type { ActionResult } from '@/lib/server/action-result';

/*
 * The outcome of a form's last submit: the error, with a reload button when
 * someone else changed the record first (spec §12 "Hai người sửa cùng lúc"),
 * or a short success notice. A failure always shows its general line,
 * `invalid` included, so a field error is never silent, even for a field the
 * form does not show; the field messages render next to their fields.
 */
export function FormMessage({ state, success }: { state: ActionResult<unknown> | null; success?: string }) {
  const router = useRouter();
  if (!state) return null;
  if (state.ok) {
    return success ? (
      <p className="a-notice" role="status">
        {success}
      </p>
    ) : null;
  }
  return (
    <div className="a-alert" role="alert">
      {actionErrorMessage(state.code, state.params)}
      {state.code === 'conflict' || state.code === 'not_allowed' ? (
        <button className="a-btn a-btn--ghost a-btn--small" type="button" onClick={() => router.refresh()}>
          Tải lại
        </button>
      ) : null}
    </div>
  );
}

/** The first error of one field, linked to its input by `id` (aria-describedby). */
export function FieldError({ state, name, id }: { state: ActionResult<unknown> | null; name: string; id: string }) {
  const message = state && !state.ok ? state.fieldErrors?.[name]?.[0] : undefined;
  return message ? (
    <p className="a-field-error" id={id}>
      {message}
    </p>
  ) : null;
}
```

```diff
diff --git a/lib/admin/format.ts b/lib/admin/format.ts
index b2526a0..007f7dd 100644
--- a/lib/admin/format.ts
+++ b/lib/admin/format.ts
@@ -32,3 +32,11 @@ export function formatLongDateVi(value: DateInput): string {
 export function todayVi(now: Date = new Date()): string {
   return longDate.format(now);
 }
+
+// A calendar date (YYYY-MM-DD) is already Vietnam's: format it in UTC, so no server timezone shifts it.
+const isoDay = new Intl.DateTimeFormat('vi-VN', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
+
+/** "Th 2, 05/10/2026" (ICU vi-VN: Th 2 … Th 7, CN) for a booking's reserved_on. */
+export function formatIsoDayVi(date: string): string {
+  return isoDay.format(new Date(`${date}T00:00:00Z`));
+}
```

```diff
diff --git a/lib/admin/nav.ts b/lib/admin/nav.ts
index b8bbe35..2e710b9 100644
--- a/lib/admin/nav.ts
+++ b/lib/admin/nav.ts
@@ -9,6 +9,7 @@ export type NavItem = { href: string; label: string; permission?: Permissions };
  */
 export const ADMIN_NAV: readonly NavItem[] = [
   { href: '/admin', label: 'Tổng quan' },
+  { href: '/admin/reservations', label: 'Đặt bàn', permission: { reservations: ['read'] } },
   { href: '/admin/users', label: 'Nhân viên', permission: { user: ['list'] } },
   { href: '/admin/audit', label: 'Nhật ký', permission: { audit: ['read'] } },
 ];
```

- [ ] **Bước 7: Viết ba action**

Mỗi action: `requirePermission` là câu đầu trong `try`, zod, một hàm của Task 8, `refresh()` (đặt bàn không cache nên không có tag), rồi `ActionResult`. Create `app/admin/(shell)/reservations/actions.ts`:

```ts
'use server';

import { refresh } from 'next/cache';
import { getPool } from '@/db/client';
import { EditForm, NoteForm, TransitionForm } from '@/lib/admin/booking-schemas';
import type { ReservationStatus } from '@/lib/booking/rules';
import { toE164 } from '@/lib/phone';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { addReservationNote, editReservation, staffActor, transitionReservation } from '@/lib/server/booking/reservations';
import { requirePermission } from '@/lib/server/dal/session';

/*
 * Reservation actions (spec §7.4 for bookings): requirePermission → zod → one
 * transaction (the change and its reservation_events row, never audit_log) →
 * refresh() → ActionResult. Editor and Admin alike (spec §7.1). Reservations
 * are never cached, so there is no tag to expire; refresh() re-renders the
 * page in the same response. No email yet: notifyGuest stays false until
 * phase 5 adds the checkbox and the outbox.
 */

const field = (formData: FormData, name: string) => formData.get(name) ?? undefined;

export async function changeStatus(
  _prev: ActionResult<{ status: ReservationStatus }> | null,
  formData: FormData,
): Promise<ActionResult<{ status: ReservationStatus }>> {
  try {
    const staff = await requirePermission({ reservations: ['update'] });
    const input = TransitionForm.parse({
      id: field(formData, 'id'),
      version: field(formData, 'version'),
      to: field(formData, 'to'),
      reason: field(formData, 'reason'),
    });
    const result = await transitionReservation(getPool(), staffActor(staff), { ...input, notifyGuest: false });
    if (!result.ok) return result;
    refresh();
    return { ok: true, data: { status: result.data.status } };
  } catch (err) {
    return actionError(err);
  }
}

export async function updateReservation(_prev: ActionResult<{ changed: boolean }> | null, formData: FormData): Promise<ActionResult<{ changed: boolean }>> {
  try {
    const staff = await requirePermission({ reservations: ['update'] });
    const input = EditForm.parse(Object.fromEntries(formData));
    // EditForm already refused a phone toE164 cannot read.
    const result = await editReservation(getPool(), staffActor(staff), { ...input, phoneE164: toE164(input.phone)! });
    if (!result.ok) return result;
    refresh();
    return { ok: true, data: { changed: result.data.changed } };
  } catch (err) {
    return actionError(err);
  }
}

export async function addNote(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ reservations: ['note'] });
    const input = NoteForm.parse({ id: field(formData, 'id'), body: field(formData, 'body') });
    const result = await addReservationNote(getPool(), staffActor(staff), input);
    if (!result.ok) return result;
    refresh();
    return { ok: true, data: null };
  } catch (err) {
    return actionError(err);
  }
}
```

`actionPermissions` đọc literal quyền của câu đầu mỗi action; `adminOnlyProblems` dùng lại nó:

```diff
diff --git a/test/guards/server-actions.ts b/test/guards/server-actions.ts
index 6b440ac..0d49874 100644
--- a/test/guards/server-actions.ts
+++ b/test/guards/server-actions.ts
@@ -292,6 +292,24 @@ function literalPermissions(arg: unknown): Permissions | null {
   return out as Permissions;
 }
 
+/**
+ * Each exported action of a file → the permission literal its first
+ * requirePermission() asks for (null when that is not a plain literal).
+ */
+export function actionPermissions(
+  root: string,
+  rel: string,
+  read: (rel: string) => string = (r) => readFileSync(join(root, r), 'utf8'),
+): Record<string, Permissions | null> {
+  return Object.fromEntries(
+    exportedFunctions(parse(rel, read(rel))).map(({ name, fn }) => {
+      const [first] = fn ? statements(fn) : [];
+      const scope = first?.type === 'TryStatement' ? ((first.block as Node).body as Node[])[0] : first;
+      return [name, literalPermissions((requirePermissionCall(scope)?.arguments as unknown[] | undefined)?.[0])];
+    }),
+  );
+}
+
 /**
  * Every action in these files must ask for a permission the Editor lacks,
  * written as a literal so this check can read it: a typo or a shared
@@ -303,10 +321,7 @@ export function adminOnlyProblems(
   read: (rel: string) => string = (rel) => readFileSync(join(root, rel), 'utf8'),
 ): string[] {
   return rels.flatMap((rel) =>
-    exportedFunctions(parse(rel, read(rel))).flatMap(({ name, fn }) => {
-      const [first] = fn ? statements(fn) : [];
-      const scope = first?.type === 'TryStatement' ? ((first.block as Node).body as Node[])[0] : first;
-      const permissions = literalPermissions((requirePermissionCall(scope)?.arguments as unknown[] | undefined)?.[0]);
+    Object.entries(actionPermissions(root, rel, read)).flatMap(([name, permissions]) => {
       if (!permissions) return [`${rel}#${name}: ${NOT_LITERAL}`];
       if (roleCan('editor', permissions)) return [`${rel}#${name}: an Editor passes requirePermission(${JSON.stringify(permissions)})`];
       return [];
```

- [ ] **Bước 8: Viết hộp thư**

Create `app/admin/(shell)/reservations/_ui/SectionNav.tsx`:

```tsx
import Link from 'next/link';

const LINKS = [{ href: '/admin/reservations', label: 'Hộp thư' }] as const;

/* The reservations section's own links (spec §7.2), above each of its pages; hidden when printing. */
export function SectionNav({ current }: { current: (typeof LINKS)[number]['href'] }) {
  return (
    <nav className="a-subnav a-noprint" aria-label="Đặt bàn">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={l.href === current ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
```

Create `app/admin/(shell)/reservations/_ui/StatusBadge.tsx`:

```tsx
import type { ReservationStatus } from '@/lib/booking/rules';
import { STATUS_LABELS } from '@/lib/reservations/lifecycle';

/* The status as a coloured label; the colour comes from admin.css (.a-status--<status>), never style="". */
export function StatusBadge({ status }: { status: ReservationStatus }) {
  return <span className={`a-status a-status--${status}`}>{STATUS_LABELS[status]}</span>;
}
```

Create `app/admin/(shell)/reservations/QuickConfirm.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { actionErrorMessage } from '@/lib/admin/auth-errors';
import type { ReservationStatus } from '@/lib/booking/rules';
import type { ActionResult } from '@/lib/server/action-result';
import { changeStatus } from './actions';

/* "Xác nhận" straight from the inbox; the version turns a stale row into a conflict, never a silent overwrite. */
export function QuickConfirm({ id, version, reference }: { id: string; version: number; reference: string }) {
  const [state, action, pending] = useActionState<ActionResult<{ status: ReservationStatus }> | null, FormData>(changeStatus, null);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <button className="a-btn a-btn--small" type="submit" name="to" value="confirmed" disabled={pending} aria-label={`Xác nhận ${reference}`}>
        Xác nhận
      </button>
      {state && !state.ok ? (
        <p className="a-field-error" role="alert">
          {actionErrorMessage(state.code, state.params)}
        </p>
      ) : null}
    </form>
  );
}
```

Create `app/admin/(shell)/reservations/page.tsx` ("Hôm nay" là ngày Đà Nẵng, `venueNow().date`):

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { formatDateTimeVi, formatIsoDayVi } from '@/lib/admin/format';
import { SOURCE_LABELS } from '@/lib/reservations/lifecycle';
import { INBOX_TABS, listInbox, type InboxTab } from '@/lib/server/booking/queries';
import { requirePagePermission } from '@/lib/server/dal/session';
import { venueNow } from '@/lib/venue-time';
import { QuickConfirm } from './QuickConfirm';
import { SectionNav } from './_ui/SectionNav';
import { StatusBadge } from './_ui/StatusBadge';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Đặt bàn' };

const TAB_LABELS: Record<InboxTab, string> = { pending: 'Cần xử lý', today: 'Hôm nay', upcoming: 'Sắp tới', all: 'Tất cả' };

type Search = { tab?: string | string[]; q?: string | string[]; sau?: string | string[] };
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function ReservationsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePagePermission({ reservations: ['read'] });
  const params = await searchParams;
  const tab = (INBOX_TABS as readonly string[]).includes(one(params.tab) ?? '') ? (one(params.tab) as InboxTab) : 'pending';
  const q = one(params.q)?.trim() ?? '';
  const after = one(params.sau);
  // "Hôm nay" is Da Nang's date, whatever the server's timezone.
  const { rows, next, searched } = await listInbox(getPool(), { tab, q, after, today: venueNow().date });
  const shownTab: InboxTab = searched ? 'all' : tab;
  const query = (extra: Record<string, string>) =>
    new URLSearchParams({ ...(shownTab !== 'pending' ? { tab: shownTab } : {}), ...(q ? { q } : {}), ...extra }).toString();

  return (
    <>
      <SectionNav current="/admin/reservations" />
      <h1>Đặt bàn</h1>
      <form className="a-search" role="search" action="/admin/reservations">
        <label htmlFor="inbox-q">Tìm theo mã, số điện thoại, tên hoặc email</label>
        <div className="a-search-row">
          <input id="inbox-q" name="q" type="search" defaultValue={q} placeholder="FC-7K3QH9XA, 0905…, Nguyễn…" />
          <button className="a-btn" type="submit">
            Tìm
          </button>
        </div>
      </form>
      {searched ? (
        <p className="a-lede">
          {`Kết quả cho “${q}” trong mọi đặt bàn. `}
          <Link href="/admin/reservations">Xóa tìm kiếm</Link>
        </p>
      ) : (
        <nav className="a-tabs" aria-label="Lọc đặt bàn">
          {INBOX_TABS.map((t) => (
            <Link key={t} href={t === 'pending' ? '/admin/reservations' : `/admin/reservations?tab=${t}`} aria-current={t === tab ? 'page' : undefined}>
              {TAB_LABELS[t]}
            </Link>
          ))}
        </nav>
      )}
      {rows.length === 0 ? (
        <p className="a-lede">Không có đặt bàn nào.</p>
      ) : (
        <table className="a-table">
          <thead>
            <tr>
              <th scope="col">Mã</th>
              <th scope="col">Khách</th>
              <th scope="col">Nhà hàng</th>
              <th scope="col">Ngày giờ</th>
              <th scope="col">Số khách</th>
              <th scope="col">Trạng thái</th>
              <th scope="col">Nguồn · tạo lúc</th>
              <th scope="col">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="a-ref">
                  <Link href={`/admin/reservations/${r.id}`}>{r.reference}</Link>
                  {r.isTest ? <span className="a-tag">Test</span> : null}
                </td>
                <td>
                  {r.name}
                  <small className="a-sub">{r.phone}</small>
                </td>
                <td>{r.restaurantName}</td>
                <td>{`${formatIsoDayVi(r.date)} ${r.time}`}</td>
                <td>
                  {r.guests}
                  {r.overCapacity ? <span className="a-tag a-tag--warn">Vượt sức chứa</span> : null}
                </td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td>
                  {SOURCE_LABELS[r.source] ?? r.source}
                  <small className="a-sub">{formatDateTimeVi(r.createdAt)}</small>
                </td>
                <td>{r.status === 'requested' ? <QuickConfirm id={r.id} version={r.version} reference={r.reference} /> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {next || after ? (
        <nav className="a-pager" aria-label="Phân trang">
          {after ? <Link href={`/admin/reservations?${query({})}`}>← Trang đầu</Link> : null}
          {next ? <Link href={`/admin/reservations?${query({ sau: next })}`}>Trang sau →</Link> : null}
        </nav>
      ) : null}
    </>
  );
}
```

- [ ] **Bước 9: Viết màn chi tiết**

Trang tính cửa sổ lúc request (`availableTransitions` không nhận `now`: quy tắc purity của React cấm `new Date()` trong thân component). Danh sách giờ của form sửa là mọi giờ của các ca đang bật, cộng giờ hiện tại của đặt bàn. Create `app/admin/(shell)/reservations/[id]/page.tsx`:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPool } from '@/db/client';
import { formatDateTimeVi, formatIsoDayVi } from '@/lib/admin/format';
import { seatings } from '@/lib/booking/resolve-day';
import { HOLDING_STATUSES } from '@/lib/booking/rules';
import { fromMinutes } from '@/lib/venue-time';
import { SOURCE_LABELS, STATUS_LABELS, availableTransitions, opensAtMinutes } from '@/lib/reservations/lifecycle';
import { getReservation, listEvents, listNotes } from '@/lib/server/booking/queries';
import { loadRestaurantRules } from '@/lib/server/booking/rules';
import { requirePagePermission } from '@/lib/server/dal/session';
import { SectionNav } from '../_ui/SectionNav';
import { StatusBadge } from '../_ui/StatusBadge';
import { EditReservationForm } from './EditReservationForm';
import { NoteForm } from './NoteForm';
import { TransitionPanel, type TransitionOption } from './TransitionPanel';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Chi tiết đặt bàn' };

const EVENT_LABELS: Record<string, string> = {
  created: 'Tạo đặt bàn',
  status_changed: 'Đổi trạng thái',
  edited: 'Sửa đặt bàn',
  note_added: 'Thêm ghi chú nội bộ',
};

const FIELD_LABELS: Record<string, string> = {
  date: 'Ngày',
  time: 'Giờ',
  guests: 'Số khách',
  name: 'Tên',
  phone: 'Điện thoại',
  email: 'Email',
  note: 'Yêu cầu của khách',
  over_capacity: 'Vượt sức chứa',
};

/** "Giờ: 19:00 → 19:30 · Số khách: 2 → 4" from an edited event's changes. */
function describeChanges(changes: Record<string, unknown> | null): string | null {
  if (!changes) return null;
  const parts = Object.entries(changes)
    .filter(([key, value]) => key in FIELD_LABELS && Array.isArray(value))
    .map(([key, value]) => {
      const [before, after] = value as unknown[];
      const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : v === true ? 'có' : v === false ? 'không' : String(v));
      return `${FIELD_LABELS[key]}: ${show(before)} → ${show(after)}`;
    });
  return parts.length ? parts.join(' · ') : null;
}

export default async function ReservationPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission({ reservations: ['read'] });
  const { id } = await params;
  const pool = getPool();
  const reservation = await getReservation(pool, id);
  if (!reservation) notFound();
  const [events, notes, loaded] = await Promise.all([
    listEvents(pool, id),
    listNotes(pool, [id]),
    loadRestaurantRules(pool, reservation.restaurantId, 'vi', reservation.date),
  ]);

  // The page renders at request time (after the session read), so the windows are this request's.
  const options: TransitionOption[] = availableTransitions(reservation.status, reservation.date, reservation.time).map(({ transition: t, window }) => {
    const opens = opensAtMinutes(t, reservation.time);
    let hint: string | null = null;
    if (!window.ok) {
      hint =
        window.code === 'too_late'
          ? 'Chỉ sửa được trong ngày phục vụ.'
          : opens !== null
            ? `Từ ${fromMinutes(opens)} ngày ${formatIsoDayVi(reservation.date)}.`
            : 'Chỉ trong ngày phục vụ.';
    }
    return { to: t.to, label: t.label, reasonRequired: t.reason === 'required', enabled: window.ok, hint };
  });
  // Every slot time of the restaurant's services; the booking's own time stays even if the hours moved.
  const times = [...new Set([...(loaded?.rules.periods ?? []).flatMap((p) => seatings(p)), reservation.time])].sort();
  const editable = (HOLDING_STATUSES as readonly string[]).includes(reservation.status);
  const ownNotes = notes.get(reservation.id) ?? [];

  return (
    <>
      <SectionNav current="/admin/reservations" />
      <p className="a-crumbs">
        <Link href="/admin/reservations">← Hộp thư</Link>
      </p>
      <h1>
        {`Đặt bàn ${reservation.reference} `}
        <StatusBadge status={reservation.status} />
      </h1>
      <dl className="a-facts">
        <dt>Nhà hàng</dt>
        <dd>{reservation.restaurantName}</dd>
        <dt>Ngày giờ</dt>
        <dd data-testid="sitting">{`${formatIsoDayVi(reservation.date)} ${reservation.time} · ${reservation.meal}`}</dd>
        <dt>Số khách</dt>
        <dd>
          {reservation.guests}
          {reservation.overCapacity ? <span className="a-tag a-tag--warn">Vượt sức chứa</span> : null}
        </dd>
        <dt>Khách</dt>
        <dd>
          {reservation.name} · <a href={`tel:${reservation.phone.replace(/[^\d+]/g, '')}`}>{reservation.phone}</a>
          {reservation.email ? ` · ${reservation.email}` : null}
        </dd>
        <dt>Yêu cầu của khách</dt>
        <dd>{reservation.note ?? '—'}</dd>
        <dt>Nguồn · ngôn ngữ</dt>
        <dd>{`${SOURCE_LABELS[reservation.source] ?? reservation.source} · ${reservation.locale}`}</dd>
        <dt>Tạo lúc</dt>
        <dd>{formatDateTimeVi(reservation.createdAt)}</dd>
        {reservation.statusReason ? (
          <>
            <dt>Lý do</dt>
            <dd>{reservation.statusReason}</dd>
          </>
        ) : null}
      </dl>

      <section aria-labelledby="res-status-title">
        <h2 id="res-status-title">Trạng thái</h2>
        <TransitionPanel id={reservation.id} version={reservation.version} options={options} />
      </section>

      {editable ? (
        <section aria-labelledby="res-edit-title">
          <h2 id="res-edit-title">Sửa đặt bàn</h2>
          <EditReservationForm
            reservation={{
              id: reservation.id,
              version: reservation.version,
              date: reservation.date,
              time: reservation.time,
              guests: reservation.guests,
              name: reservation.name,
              phone: reservation.phone,
              email: reservation.email ?? '',
              note: reservation.note ?? '',
            }}
            times={times}
          />
        </section>
      ) : null}

      <section aria-labelledby="res-notes-title">
        <h2 id="res-notes-title">Ghi chú nội bộ</h2>
        <p className="a-muted">Chỉ nhân viên thấy; không bao giờ gửi cho khách.</p>
        {ownNotes.length ? (
          <ul className="a-list" aria-label="Ghi chú nội bộ">
            {ownNotes.map((n) => (
              <li className="a-list-item a-list-item--stack" key={n.id}>
                <span>{n.body}</span>
                <small className="a-sub">{`${n.authorLabel} · ${formatDateTimeVi(n.createdAt)}`}</small>
              </li>
            ))}
          </ul>
        ) : null}
        <NoteForm id={reservation.id} />
      </section>

      <section aria-labelledby="res-timeline-title">
        <h2 id="res-timeline-title">Dòng thời gian</h2>
        <ol className="a-timeline" aria-label="Dòng thời gian">
          {events.map((e) => {
            const changes = e.type === 'edited' ? describeChanges(e.changes) : null;
            return (
              <li key={e.id}>
                <time>{formatDateTimeVi(e.at)}</time>
                <strong>{EVENT_LABELS[e.type] ?? e.type}</strong>
                {e.type === 'status_changed' || e.type === 'created'
                  ? ` ${e.fromStatus ? `${STATUS_LABELS[e.fromStatus]} → ` : ''}${e.toStatus ? STATUS_LABELS[e.toStatus] : ''}`
                  : null}
                {changes ? <span className="a-sub">{changes}</span> : null}
                {e.reason ? <span className="a-sub">{`Lý do: ${e.reason}`}</span> : null}
                <span className="a-sub">{e.actorLabel ?? (e.actorKind === 'guest' ? 'Khách' : 'Hệ thống')}</span>
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}
```

Một form, mỗi chuyển trạng thái một nút `name="to"`; React dựng FormData kèm nút được bấm. Create `app/admin/(shell)/reservations/[id]/TransitionPanel.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import type { ReservationStatus } from '@/lib/booking/rules';
import type { ActionResult } from '@/lib/server/action-result';
import { FieldError, FormMessage } from '../../_ui/FormMessage';
import { changeStatus } from '../actions';

export type TransitionOption = { to: ReservationStatus; label: string; reasonRequired: boolean; enabled: boolean; hint: string | null };

/*
 * One form, one button per transition the status allows; React builds the
 * FormData with the clicked button, so its name/value reaches the action.
 * The version is the one this page was drawn with: a stale one comes back
 * as "Vừa được … thay đổi". The server checks the windows and reasons again.
 */
export function TransitionPanel({ id, version, options }: { id: string; version: number; options: TransitionOption[] }) {
  const [state, action, pending] = useActionState<ActionResult<{ status: ReservationStatus }> | null, FormData>(changeStatus, null);
  if (options.length === 0) return <p className="a-muted">Đặt bàn đã kết thúc; không còn thao tác nào.</p>;
  const needsReason = options.some((o) => o.reasonRequired);
  return (
    <form className="a-transitions" action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <FormMessage state={state} success="Đã cập nhật trạng thái." />
      <div className="a-field">
        <label htmlFor="res-transition-reason">{needsReason ? 'Lý do (bắt buộc khi hủy hoặc từ chối)' : 'Lý do (không bắt buộc)'}</label>
        <input id="res-transition-reason" name="reason" maxLength={500} aria-describedby="res-transition-reason-error" />
        <FieldError state={state} name="reason" id="res-transition-reason-error" />
      </div>
      <div className="a-actions">
        {options.map((o) => (
          <span className="a-action" key={o.to}>
            <button
              className={`a-btn${o.to === 'cancelled' || o.to === 'declined' || o.to === 'no_show' ? ' a-btn--danger' : ''}`}
              type="submit"
              name="to"
              value={o.to}
              disabled={pending || !o.enabled}
            >
              {o.label}
            </button>
            {o.hint ? <small className="a-sub">{o.hint}</small> : null}
          </span>
        ))}
      </div>
    </form>
  );
}
```

Form sửa gửi bằng `submitKeepingValues` (bị từ chối thì giữ chữ đã gõ) và `key={r.version}` trên `<form>` (lưu xong thì ô hiện giá trị mới, còn state của `useActionState` ở component cha vẫn giữ "Đã lưu."). Create `app/admin/(shell)/reservations/[id]/EditReservationForm.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import { FieldError, FormMessage } from '../../_ui/FormMessage';
import { updateReservation } from '../actions';

type Editable = { id: string; version: number; date: string; time: string; guests: number; name: string; phone: string; email: string; note: string };

/* Date, time, party and the guest's details; a move or a larger party is re-checked against capacity. */
export function EditReservationForm({ reservation: r, times }: { reservation: Editable; times: string[] }) {
  const [state, action, pending] = useActionState<ActionResult<{ changed: boolean }> | null, FormData>(updateReservation, null);
  const err = (name: string) => `res-edit-${name}-error`;
  return (
    // No reset on submit: a refused edit (full, conflict) keeps what was typed. A saved one re-renders with
    // the new version, and the key gives the inputs their saved values; the hook state above the form stays.
    <form className="a-grid-form" onSubmit={submitKeepingValues(action)} key={r.version} noValidate aria-label="Sửa đặt bàn">
      <input type="hidden" name="id" value={r.id} />
      <input type="hidden" name="version" value={r.version} />
      <FormMessage state={state} success={state?.ok && !state.data.changed ? 'Không có gì thay đổi.' : 'Đã lưu.'} />
      <div className="a-field">
        <label htmlFor="res-edit-date">Ngày</label>
        <input id="res-edit-date" name="date" type="date" defaultValue={r.date} aria-describedby={err('date')} />
        <FieldError state={state} name="date" id={err('date')} />
      </div>
      <div className="a-field">
        <label htmlFor="res-edit-time">Giờ</label>
        <select id="res-edit-time" name="time" defaultValue={r.time} aria-describedby={err('time')}>
          {times.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <FieldError state={state} name="time" id={err('time')} />
      </div>
      <div className="a-field">
        <label htmlFor="res-edit-guests">Số khách</label>
        <input id="res-edit-guests" name="guests" type="number" min={1} max={50} defaultValue={r.guests} aria-describedby={err('guests')} />
        <FieldError state={state} name="guests" id={err('guests')} />
      </div>
      <div className="a-field">
        <label htmlFor="res-edit-name">Tên khách</label>
        <input id="res-edit-name" name="name" defaultValue={r.name} aria-describedby={err('name')} />
        <FieldError state={state} name="name" id={err('name')} />
      </div>
      <div className="a-field">
        <label htmlFor="res-edit-phone">Điện thoại</label>
        <input id="res-edit-phone" name="phone" type="tel" defaultValue={r.phone} aria-describedby={err('phone')} />
        <FieldError state={state} name="phone" id={err('phone')} />
      </div>
      <div className="a-field">
        <label htmlFor="res-edit-email">Email</label>
        <input id="res-edit-email" name="email" type="email" defaultValue={r.email} aria-describedby={err('email')} />
        <FieldError state={state} name="email" id={err('email')} />
      </div>
      <div className="a-field a-field--wide">
        <label htmlFor="res-edit-note">Yêu cầu của khách</label>
        <textarea id="res-edit-note" name="note" rows={2} defaultValue={r.note} maxLength={1000} aria-describedby={err('note')} />
        <FieldError state={state} name="note" id={err('note')} />
      </div>
      <div className="a-field a-field--wide">
        <label htmlFor="res-edit-over">Lý do vượt sức chứa (chỉ khi khung giờ đã hết chỗ)</label>
        <input id="res-edit-over" name="overCapacityReason" maxLength={500} aria-describedby={err('overCapacityReason')} />
        <FieldError state={state} name="overCapacityReason" id={err('overCapacityReason')} />
      </div>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang lưu…' : 'Lưu thay đổi'}
      </button>
    </form>
  );
}
```

Create `app/admin/(shell)/reservations/[id]/NoteForm.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import type { ActionResult } from '@/lib/server/action-result';
import { FieldError, FormMessage } from '../../_ui/FormMessage';
import { addNote } from '../actions';

export function NoteForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addNote, null);
  return (
    <form className="a-inline-form" action={action} aria-label="Thêm ghi chú nội bộ">
      <input type="hidden" name="id" value={id} />
      <FormMessage state={state} />
      <div className="a-field">
        <label htmlFor="res-note-body">Thêm ghi chú</label>
        <textarea id="res-note-body" name="body" rows={2} maxLength={2000} aria-describedby="res-note-body-error" />
        <FieldError state={state} name="body" id="res-note-body-error" />
      </div>
      <button className="a-btn a-btn--ghost" type="submit" disabled={pending}>
        {pending ? 'Đang lưu…' : 'Lưu ghi chú'}
      </button>
    </form>
  );
}
```

- [ ] **Bước 10: Tổng quan, liên kết ở nhật ký, CSS**

```diff
diff --git a/app/admin/(shell)/page.tsx b/app/admin/(shell)/page.tsx
index 948ca05..7d4e8c3 100644
--- a/app/admin/(shell)/page.tsx
+++ b/app/admin/(shell)/page.tsx
@@ -4,7 +4,9 @@ import { getPool } from '@/db/client';
 import { todayVi } from '@/lib/admin/format';
 import { roleCan } from '@/lib/server/auth/permissions';
 import { listOpenInvitations } from '@/lib/server/auth/staff-queries';
+import { overviewCounts } from '@/lib/server/booking/queries';
 import { verifySession } from '@/lib/server/dal/session';
+import { venueNow } from '@/lib/venue-time';
 
 // Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
 export const instant = false;
@@ -12,15 +14,17 @@ export const instant = false;
 export const metadata: Metadata = { title: 'Tổng quan' };
 
 /*
- * Phase 3 shows the greeting and, to Admins, invitations whose email failed
- * (spec §7.2 "email lỗi"). Bookings, translations and notification widgets
- * arrive with phases 4, 5 and 8.
+ * The greeting; bookings waiting for staff and today's bookings (spec §7.2
+ * "đặt bàn chờ xử lý"), for roles that read bookings; to Admins, invitations
+ * whose email failed ("email lỗi"). Translation and notification widgets
+ * arrive with phases 5 and 8.
  */
 export default async function OverviewPage() {
   const staff = await verifySession();
-  const failed = roleCan(staff.role, { user: ['list'] })
-    ? (await listOpenInvitations(getPool())).filter((i) => i.email_error !== null)
-    : [];
+  const pool = getPool();
+  const failed = roleCan(staff.role, { user: ['list'] }) ? (await listOpenInvitations(pool)).filter((i) => i.email_error !== null) : [];
+  // Today is Da Nang's date, whatever the server's timezone.
+  const bookings = roleCan(staff.role, { reservations: ['read'] }) ? await overviewCounts(pool, venueNow().date) : null;
 
   return (
     <>
@@ -28,6 +32,23 @@ export default async function OverviewPage() {
       <p className="a-lede">
         Xin chào, {staff.name}. Hôm nay là <time data-testid="today">{todayVi()}</time>.
       </p>
+      {bookings ? (
+        <section aria-labelledby="overview-bookings">
+          <h2 id="overview-bookings">Đặt bàn</h2>
+          <ul className="a-stats">
+            <li>
+              <Link href="/admin/reservations" data-testid="pending-count">
+                <strong>{bookings.pending}</strong> chờ xác nhận
+              </Link>
+            </li>
+            <li>
+              <Link href="/admin/reservations?tab=today" data-testid="today-count">
+                <strong>{bookings.today}</strong> đặt bàn hôm nay · {bookings.todayCovers} khách
+              </Link>
+            </li>
+          </ul>
+        </section>
+      ) : null}
       {failed.length > 0 ? (
         <section aria-labelledby="failed-invitations">
           <h2 id="failed-invitations">Lời mời chưa gửi được email</h2>
```

```diff
diff --git a/app/admin/(shell)/audit/page.tsx b/app/admin/(shell)/audit/page.tsx
index 2a2a9f5..4bf5684 100644
--- a/app/admin/(shell)/audit/page.tsx
+++ b/app/admin/(shell)/audit/page.tsx
@@ -44,24 +44,29 @@ export default async function AuditPage({ searchParams }: { searchParams: Promis
             </tr>
           </thead>
           <tbody>
-            {rows.map((r) => (
-              <tr key={`${r.source}:${r.id}`}>
-                <td>{formatDateTimeVi(r.at)}</td>
-                <td>{r.actor_label ?? 'Hệ thống'}</td>
-                <td>{auditActionLabel(r.action)}</td>
-                <td>{`${auditEntityLabel(r.entity_type)} · ${(r.entity_id && labels.get(`${r.entity_type}:${r.entity_id}`)) ?? r.entity_id ?? '—'}`}</td>
-                <td>
-                  {r.before === null && r.after === null ? (
-                    '—'
-                  ) : (
-                    <details>
-                      <summary>Xem</summary>
-                      <pre className="a-pre">{JSON.stringify({ trước: r.before, sau: r.after }, null, 2)}</pre>
-                    </details>
-                  )}
-                </td>
-              </tr>
-            ))}
+            {rows.map((r) => {
+              const entity = `${auditEntityLabel(r.entity_type)} · ${(r.entity_id && labels.get(`${r.entity_type}:${r.entity_id}`)) ?? r.entity_id ?? '—'}`;
+              return (
+                <tr key={`${r.source}:${r.id}`}>
+                  <td>{formatDateTimeVi(r.at)}</td>
+                  <td>{r.actor_label ?? 'Hệ thống'}</td>
+                  <td>{auditActionLabel(r.action)}</td>
+                  <td>
+                    {r.entity_type === 'reservation' && r.entity_id ? <Link href={`/admin/reservations/${r.entity_id}`}>{entity}</Link> : entity}
+                  </td>
+                  <td>
+                    {r.before === null && r.after === null ? (
+                      '—'
+                    ) : (
+                      <details>
+                        <summary>Xem</summary>
+                        <pre className="a-pre">{JSON.stringify({ trước: r.before, sau: r.after }, null, 2)}</pre>
+                      </details>
+                    )}
+                  </td>
+                </tr>
+              );
+            })}
           </tbody>
         </table>
       )}
```

Không `style=` dưới `app/admin` (CSP không có `'unsafe-inline'`); mọi màu và bố cục ở `styles/admin.css`:

```diff
diff --git a/styles/admin.css b/styles/admin.css
index 4add557..ee2780e 100644
--- a/styles/admin.css
+++ b/styles/admin.css
@@ -379,3 +379,235 @@ body.admin {
   gap: 16px;
   margin-top: 16px;
 }
+
+/* ---------- Reservations (phase 4) ---------- */
+
+.a-muted {
+  margin: 0 0 12px;
+  color: var(--a-ink-soft);
+}
+
+.a-sub {
+  display: block;
+  color: var(--a-ink-soft);
+  font-size: 13px;
+}
+
+.a-crumbs {
+  margin: 0 0 8px;
+  font-size: 14px;
+}
+
+.a-subnav,
+.a-tabs {
+  display: flex;
+  flex-wrap: wrap;
+  gap: 4px;
+  margin: 0 0 20px;
+  border-bottom: 1px solid var(--a-line);
+}
+
+.a-subnav a,
+.a-tabs a {
+  padding: 8px 12px;
+  border-bottom: 2px solid transparent;
+  color: var(--a-ink-soft);
+  text-decoration: none;
+}
+
+.a-subnav a[aria-current='page'],
+.a-tabs a[aria-current='page'] {
+  border-bottom-color: var(--a-brand);
+  color: var(--a-ink);
+  font-weight: 600;
+}
+
+.a-search {
+  display: grid;
+  gap: 6px;
+  max-width: 560px;
+  margin: 0 0 16px;
+}
+
+.a-search label {
+  font-weight: 600;
+}
+
+.a-search-row {
+  display: flex;
+  gap: 8px;
+}
+
+.a-search-row input {
+  flex: 1;
+  min-height: 40px;
+  padding: 0 12px;
+  border: 1px solid var(--a-line);
+  border-radius: 6px;
+  font: inherit;
+}
+
+.a-status {
+  display: inline-block;
+  padding: 2px 8px;
+  border-radius: 999px;
+  font-size: 13px;
+  font-weight: 600;
+  white-space: nowrap;
+  vertical-align: middle;
+}
+
+.a-status--requested { background: #fff4d6; color: #7a5300; }
+.a-status--confirmed { background: #e3f1e6; color: #1d5a2c; }
+.a-status--seated { background: #e2ecfa; color: #1f4a8a; }
+.a-status--no_show { background: #f1e4f5; color: #6b2a7d; }
+.a-status--cancelled,
+.a-status--declined { background: #ecebe7; color: #56605b; }
+
+.a-tag {
+  display: inline-block;
+  margin-left: 6px;
+  padding: 0 6px;
+  border: 1px solid var(--a-line);
+  border-radius: 4px;
+  font-size: 12px;
+  color: var(--a-ink-soft);
+}
+
+.a-tag--warn {
+  border-color: #e3b04b;
+  color: #7a5300;
+}
+
+.a-warn {
+  margin: 0 0 12px;
+  padding: 10px 12px;
+  border-radius: 6px;
+  background: #fff4d6;
+  color: #5c3f00;
+}
+
+.a-btn--small {
+  min-height: 32px;
+  padding: 0 10px;
+  font-size: 14px;
+}
+
+.a-btn--danger {
+  border-color: var(--a-danger);
+  background: var(--a-danger);
+  color: #fff;
+}
+
+.a-alert .a-btn {
+  margin-left: 12px;
+}
+
+.a-ref {
+  white-space: nowrap;
+}
+
+.a-facts {
+  display: grid;
+  grid-template-columns: max-content 1fr;
+  gap: 6px 20px;
+  margin: 16px 0 8px;
+  padding: 16px 20px;
+  border: 1px solid var(--a-line);
+  border-radius: var(--a-radius);
+  background: var(--a-surface);
+}
+
+.a-facts dt {
+  color: var(--a-ink-soft);
+}
+
+.a-facts dd {
+  margin: 0;
+}
+
+.a-transitions .a-actions {
+  align-items: flex-start;
+}
+
+.a-action {
+  display: inline-grid;
+  gap: 2px;
+  max-width: 180px;
+}
+
+.a-grid-form {
+  display: grid;
+  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
+  gap: 0 16px;
+  align-items: start;
+  max-width: 920px;
+}
+
+.a-grid-form > .a-notice,
+.a-grid-form > .a-alert,
+.a-grid-form > h2,
+.a-field--wide {
+  grid-column: 1 / -1;
+}
+
+.a-grid-form > .a-btn {
+  justify-self: start;
+}
+
+.a-field select,
+.a-field textarea {
+  padding: 8px 12px;
+  border: 1px solid var(--a-line);
+  border-radius: 6px;
+  background: var(--a-surface);
+  color: var(--a-ink);
+  font: inherit;
+}
+
+.a-list-item--stack {
+  display: grid;
+  justify-content: start;
+  gap: 2px;
+}
+
+.a-timeline {
+  list-style: none;
+  margin: 0;
+  padding: 0;
+  border-left: 2px solid var(--a-line);
+}
+
+.a-timeline li {
+  margin: 0 0 12px;
+  padding-left: 14px;
+}
+
+.a-timeline time {
+  margin-right: 8px;
+  color: var(--a-ink-soft);
+  font-size: 13px;
+}
+
+.a-stats {
+  display: flex;
+  flex-wrap: wrap;
+  gap: 12px;
+  margin: 0;
+  padding: 0;
+  list-style: none;
+}
+
+.a-stats a {
+  display: block;
+  padding: 14px 18px;
+  border: 1px solid var(--a-line);
+  border-radius: var(--a-radius);
+  background: var(--a-surface);
+  text-decoration: none;
+}
+
+.a-stats strong {
+  margin-right: 4px;
+  font-size: 22px;
+}
```

- [ ] **Bước 11: Chạy lại test**

Run: lệnh ở Bước 2.
Expected: PASS `Test Files  6 passed (6)`, `Tests  35 passed (35)`

- [ ] **Bước 12: Chạy cổng kiểm tra**

Expected: typecheck không lỗi; lint thoát 0, 19 cảnh báo; `Test Files  52 passed (52)`, `Tests  545 passed (545)`; `Applied 6 migration(s).`; build thoát 0; check-prerender báo thêm `/admin/reservations` và `/admin/reservations/[id]` trong "Admin check passed: … have no static shell."; E2E `84 passed`; visual `8 passed`.

- [ ] **Bước 13: Commit**

```bash
git add lib/reservations/search.ts lib/reservations/search.test.ts lib/server/booking/queries.ts lib/admin/booking-schemas.ts lib/admin/booking-schemas.test.ts lib/admin/form.ts lib/admin/format.ts lib/admin/format.test.ts lib/admin/nav.ts lib/admin/nav.test.ts test/guards/require-permission.guard.test.ts test/guards/server-actions.ts test/integration/reservation-inbox.test.ts "app/admin/(shell)/_ui/FormMessage.tsx" "app/admin/(shell)/reservations/actions.ts" "app/admin/(shell)/reservations/page.tsx" "app/admin/(shell)/reservations/QuickConfirm.tsx" "app/admin/(shell)/reservations/_ui/SectionNav.tsx" "app/admin/(shell)/reservations/_ui/StatusBadge.tsx" "app/admin/(shell)/reservations/[id]/page.tsx" "app/admin/(shell)/reservations/[id]/TransitionPanel.tsx" "app/admin/(shell)/reservations/[id]/EditReservationForm.tsx" "app/admin/(shell)/reservations/[id]/NoteForm.tsx" "app/admin/(shell)/page.tsx" "app/admin/(shell)/audit/page.tsx" styles/admin.css e2e/reservation-fixtures.ts e2e/admin-reservations.spec.ts e2e/admin-acceptance.spec.ts e2e/admin-users.spec.ts e2e/admin-audit.spec.ts
git commit -m "$(cat <<'EOF'
feat: add the reservations inbox and detail screen, with confirm, cancel, no-show, edit and notes

/admin/reservations (Editor and Admin, reservations:read) lists bookings
under Cần xử lý, Hôm nay (Da Nang's date), Sắp tới and Tất cả, keyset-paged
by 30, and searches every booking by reference however it is typed, by
phone in any format, or by name or email without accents (search_text and
fold_search). A request can be confirmed straight from the list.

/admin/reservations/[id] shows the booking, one button per transition its
status allows (disabled outside its window, with when it opens), a reason
field required for cancel and decline, the edit form, internal notes and
the timeline. A stale page answers "Vừa được … thay đổi lúc …" with a
reload button and overwrites nothing. An edit into a full slot is refused
with the covers left and keeps what was typed; with a reason it saves as
over capacity.

The overview counts pending requests and today's bookings; the audit log
links each booking event to its booking. The nav gains Đặt bàn, and the CI
guard now pins each booking action's exact permission.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 10: Tạo đặt bàn của nhân viên và bảng theo ngày

`/admin/reservations/new` (`reservations:create`): chọn nhà hàng và ngày bằng một form GET, thấy các giờ mở của ngày đó với số chỗ còn (planDay cộng số chỗ đang giữ; ca đóng được nêu), rồi đặt qua điện thoại (`confirmed`) hoặc khách vãng lai (`seated`, chỉ trong ngày phục vụ), bằng ngôn ngữ của khách. Action `createReservation` kiểm lại dưới khóa ngày đặt bàn; vượt sức chứa thì báo số chỗ còn và giữ chữ đã gõ; có lý do thì nhận và đánh dấu vượt sức chứa; thành công thì `redirect()` ngay trong `try` (R13). `/admin/reservations/day` (`reservations:read`) là bảng của quầy đón khách, in được.

**Files:**
- Create: `app/admin/(shell)/reservations/new/page.tsx`, `app/admin/(shell)/reservations/new/NewReservationForm.tsx`, `app/admin/(shell)/reservations/day/page.tsx`, `app/admin/(shell)/reservations/day/PrintButton.tsx`
- Modify: `lib/server/booking/queries.ts`, `test/integration/reservation-inbox.test.ts`, `lib/admin/booking-schemas.ts`, `lib/admin/booking-schemas.test.ts`, `app/admin/(shell)/reservations/actions.ts`, `app/admin/(shell)/reservations/_ui/SectionNav.tsx`, `styles/admin.css`, `test/guards/require-permission.guard.test.ts`, `e2e/admin-reservations.spec.ts`

**Interfaces:**
- Consumes: `createStaffReservation`, `staffActor` (Task 8); `serviceDay` (Task 8); `planDay`, `findPlannedSlot`, `PlannedPeriod` (Task 2, 8); `loadBookingRules`, `loadRestaurantRules`, `loadBookedCovers` (Task 3); `GuestFields`, `IsoDay`, `Time` (Task 9); `listNotes`, `InboxRow` (Task 9); `submitKeepingValues`, `FormMessage`, `FieldError`, `SectionNav`, `StatusBadge` (Task 9).
- Produces:
  - `lib/server/booking/queries.ts`: `listRestaurantOptions(pool): Promise<{ id; name }[]>`; `listLocales(pool): Promise<{ code; name; isDefault }[]>` (mọi ngôn ngữ, kể cả đang tắt); `type SheetRow`; `type DaySheetRestaurant = { id; name; periods: (Omit<PlannedPeriod, 'slots'> & { slots: { time; capacity; booked }[] })[]; reservations: SheetRow[]; outside: SheetRow[] }`; `daySheet(pool, date, restaurantId?)`.
  - `lib/admin/booking-schemas.ts`: `RestaurantId`, `NewReservationForm`.
  - `app/admin/(shell)/reservations/actions.ts`: `createReservation(_prev, formData)` (`reservations:create`).

- [ ] **Bước 1: Viết test**

```diff
diff --git a/lib/admin/booking-schemas.test.ts b/lib/admin/booking-schemas.test.ts
index 88adfa1..c043583 100644
--- a/lib/admin/booking-schemas.test.ts
+++ b/lib/admin/booking-schemas.test.ts
@@ -1,5 +1,5 @@
 import { describe, expect, it } from 'vitest';
-import { EditForm, NoteForm, TransitionForm } from './booking-schemas';
+import { EditForm, NewReservationForm, NoteForm, TransitionForm } from './booking-schemas';
 
 /* The booking screens' action inputs (spec §7.3): FormData strings in, typed values or Vietnamese field errors out. */
 describe('booking form schemas', () => {
@@ -35,4 +35,20 @@ describe('booking form schemas', () => {
     expect(NoteForm.safeParse({ id: '7', body: '   ' }).error?.flatten().fieldErrors).toEqual({ body: ['Nhập nội dung ghi chú.'] });
     expect(NoteForm.safeParse({ id: '7', body: 'x'.repeat(2001) }).error?.flatten().fieldErrors).toEqual({ body: ['Ghi chú tối đa 2000 ký tự.'] });
   });
+
+  it('a staff booking: the source, the guest’s language, and the restaurant as an id', () => {
+    const base = { restaurant: 'chaoshan-hotpot', date: '2026-10-09', time: '19:00', source: 'phone', locale: 'vi', guests: '30', name: 'Đoàn khách', phone: '0912 345 678' };
+    expect(NewReservationForm.parse({ ...base, email: '', note: '', overCapacityReason: 'Đã gọi bếp' })).toMatchObject({
+      restaurant: 'chaoshan-hotpot',
+      source: 'phone',
+      guests: 30,
+      email: null,
+      overCapacityReason: 'Đã gọi bếp',
+    });
+    expect(NewReservationForm.safeParse({ ...base, restaurant: 'x;drop', source: 'web', locale: '' }).error?.flatten().fieldErrors).toEqual({
+      restaurant: [expect.any(String)],
+      source: ['Chọn nguồn đặt bàn.'],
+      locale: ['Chọn ngôn ngữ của khách.'],
+    });
+  });
 });
```

`daySheet` đếm chỗ theo `HOLDING_STATUSES` (no-show vẫn có dòng, nhưng không giữ chỗ) và liệt kê đặt bàn mà giờ không còn trong ca hiện tại:

```diff
diff --git a/test/integration/reservation-inbox.test.ts b/test/integration/reservation-inbox.test.ts
index 882fa05..ed24940 100644
--- a/test/integration/reservation-inbox.test.ts
+++ b/test/integration/reservation-inbox.test.ts
@@ -1,6 +1,6 @@
 import { Pool } from 'pg';
 import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
-import { INBOX_PAGE_SIZE, getReservation, listEvents, listInbox, listNotes, overviewCounts } from '@/lib/server/booking/queries';
+import { INBOX_PAGE_SIZE, daySheet, getReservation, listEvents, listInbox, listLocales, listNotes, overviewCounts } from '@/lib/server/booking/queries';
 import { TEST_DATABASE_URL } from '../helpers/db';
 
 /*
@@ -58,7 +58,8 @@ describe.skipIf(!TEST_DATABASE_URL)('reservation inbox (database)', () => {
     await pool.end();
   });
   beforeEach(async () => {
-    await pool.query('TRUNCATE reservations, reservation_events, reservation_notes CASCADE');
+    await pool.query('TRUNCATE reservations, reservation_events, reservation_notes, closures CASCADE');
+    await pool.query(`UPDATE service_periods SET active = true WHERE restaurant_id = 'taya-house'`);
   });
 
   it('tabs: Cần xử lý (requested, soonest first) · Hôm nay · Sắp tới · Tất cả (newest first)', async () => {
@@ -156,4 +157,36 @@ describe.skipIf(!TEST_DATABASE_URL)('reservation inbox (database)', () => {
     await seed({ date: TODAY, guests: 5, status: 'no_show' });
     expect(await overviewCounts(pool, TODAY)).toEqual({ pending: 2, today: 3, todayCovers: 9 });
   });
+
+  it('the day sheet: each service’s slots with the covers held, the bookings that still count, and those outside the hours', async () => {
+    await seed({ time: '19:00', guests: 4, status: 'confirmed' });
+    await seed({ time: '19:00', guests: 3, status: 'seated' });
+    await seed({ time: '19:00', guests: 5, status: 'no_show' });
+    await seed({ time: '19:00', guests: 6, status: 'cancelled' });
+    // Booked when dinner ran later: 21:30 is no longer a slot.
+    const late = await seed({ time: '21:30', guests: 2, status: 'confirmed' });
+    await pool.query(`INSERT INTO closures (scope, restaurant_id, starts_on, ends_on, meals) VALUES ('restaurant', 'taya-house', '2026-10-05', '2026-10-05', '{Lunch}')`);
+    const [taya] = await daySheet(pool, '2026-10-05', 'taya-house');
+    expect(taya.name).toBe('Tàya House');
+    expect(taya.reservations.map((r) => [r.time, r.status])).toEqual([
+      ['19:00', 'confirmed'],
+      ['19:00', 'seated'],
+      ['19:00', 'no_show'],
+      ['21:30', 'confirmed'],
+    ]);
+    expect(taya.periods.map((p) => [p.meal, p.closed])).toEqual([
+      ['Lunch', true],
+      ['Dinner', false],
+    ]);
+    expect(taya.periods[1].slots.find((s) => s.time === '19:00')).toEqual({ time: '19:00', capacity: 16, booked: 7 });
+    expect(taya.outside.map((r) => r.id)).toEqual([late]);
+    expect((await daySheet(pool, '2026-10-05')).map((r) => r.id)).toContain('hai-van-lounge');
+  });
+
+  it('lists every language a guest may speak, enabled or not, the default marked', async () => {
+    expect(await listLocales(pool)).toEqual([
+      { code: 'en', name: 'English', isDefault: true },
+      { code: 'vi', name: 'Tiếng Việt', isDefault: false },
+    ]);
+  });
 });
```

```diff
diff --git a/test/guards/require-permission.guard.test.ts b/test/guards/require-permission.guard.test.ts
index 859dda6..f9d2efb 100644
--- a/test/guards/require-permission.guard.test.ts
+++ b/test/guards/require-permission.guard.test.ts
@@ -54,6 +54,7 @@ const BOOKING_ACTIONS: Record<string, Record<string, { permission: object; edito
     changeStatus: { permission: { reservations: ['update'] }, editor: true },
     updateReservation: { permission: { reservations: ['update'] }, editor: true },
     addNote: { permission: { reservations: ['note'] }, editor: true },
+    createReservation: { permission: { reservations: ['create'] }, editor: true },
   },
 };
 
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/admin/booking-schemas.test.ts test/integration/reservation-inbox.test.ts test/guards/require-permission.guard.test.ts`
Expected: FAIL `Test Files  3 failed (3)`, `Tests  4 failed | 27 passed (31)`:

```
 FAIL  lib/admin/booking-schemas.test.ts > booking form schemas > a staff booking: the source, the guest’s language, and the restaurant as an id
TypeError: Cannot read properties of undefined (reading 'parse')
 FAIL  test/guards/require-permission.guard.test.ts > booking actions follow the permission matrix (spec §7.1) > app/admin/(shell)/reservations/actions.ts
AssertionError: expected [ 'addNote', 'changeStatus', …(1) ] to deeply equal [ 'addNote', 'changeStatus', …(2) ]
 FAIL  test/integration/reservation-inbox.test.ts > reservation inbox (database) > the day sheet: each service’s slots with the covers held, the bookings that still count, and those outside the hours
TypeError: daySheet is not a function
 FAIL  test/integration/reservation-inbox.test.ts > reservation inbox (database) > lists every language a guest may speak, enabled or not, the default marked
TypeError: listLocales is not a function
```

- [ ] **Bước 3: Viết E2E**

ChaoShan Hotpot (28 chỗ một khung) +7 cho đặt qua điện thoại 30 khách; Tàya House +6 cho bảng theo ngày:

```diff
diff --git a/e2e/admin-reservations.spec.ts b/e2e/admin-reservations.spec.ts
index 095213e..bf42a03 100644
--- a/e2e/admin-reservations.spec.ts
+++ b/e2e/admin-reservations.spec.ts
@@ -1,14 +1,15 @@
 import type { Page } from '@playwright/test';
 import { expectHydrated, watchCsp } from './csp';
 import { reservationRow, seedReservation, serviceDayNow, venueDay } from './reservation-fixtures';
-import { STAFF, expect, newVisitor, seedStaff, signInAs, test } from './staff-fixtures';
+import { STAFF, expect, newVisitor, one, seedStaff, signInAs, test } from './staff-fixtures';
 
 /*
  * Spec §14.1 phase 4, the inbox and the detail screen: confirm, cancel and
  * no-show work, with the time windows and the version conflict of §10.3;
- * the inbox search; an edit re-checked against capacity. The admin CSP stays
- * clean (no inline styles). Tàya House at +3, +4 and yesterday, V-Senses Cafe
- * at +8: dates no other spec books there.
+ * the inbox search; an edit re-checked against capacity; a phone booking
+ * past capacity; the printable day sheet. The admin CSP stays clean (no
+ * inline styles). Tàya House at +3, +4, +6 and yesterday, V-Senses Cafe at
+ * +8, ChaoShan Hotpot at +7: dates no other spec books there.
  */
 
 test.beforeAll(() => seedStaff());
@@ -141,3 +142,58 @@ test('an edit into a full slot is refused with the covers left, keeps what was t
   await expect(latest).toContainText('Lý do: Khách quen, kê thêm ghế');
   expect(await reservationRow(r.id)).toMatchObject({ reserved_at: '19:30', over_capacity: true, version: 2 });
 });
+
+test('a phone booking past capacity needs a reason; the form keeps what was typed, then opens the new booking', async ({ page }) => {
+  // ChaoShan Hotpot dinner, seven days out: 28 covers a slot, and no other spec books it.
+  const date = venueDay(7);
+  await signInAs(page, STAFF.editor);
+  await page.goto(`/admin/reservations/new?nha_hang=chaoshan-hotpot&ngay=${date}`);
+  await expectHydrated(page);
+  const form = page.getByRole('form', { name: 'Đặt bàn mới' });
+  await expect(form.getByRole('radio', { name: 'Khách vãng lai (đã đến)' })).toBeDisabled();
+  await form.getByLabel('Giờ', { exact: true }).selectOption('19:00');
+  await form.getByLabel('Số khách', { exact: true }).fill('30');
+  await form.getByLabel('Tên khách', { exact: true }).fill('Đoàn khách E2E');
+  const digits = String(Date.now()).slice(-6);
+  await form.getByLabel('Điện thoại', { exact: true }).fill(`0912 ${digits.slice(0, 3)} ${digits.slice(3)}`);
+  await form.getByLabel('Ngôn ngữ của khách', { exact: true }).selectOption('vi');
+  await form.getByRole('button', { name: 'Tạo đặt bàn' }).click();
+  await expect(form.getByRole('alert')).toContainText('Khung giờ này chỉ còn');
+  // Refused, not reset: what was typed is still there.
+  await expect(form.getByLabel('Tên khách', { exact: true })).toHaveValue('Đoàn khách E2E');
+  await expect(form.getByLabel('Số khách', { exact: true })).toHaveValue('30');
+
+  await form.getByLabel('Lý do vượt sức chứa (chỉ khi khung giờ đã hết chỗ)', { exact: true }).fill('Đoàn công ty, đã gọi bếp');
+  await form.getByRole('button', { name: 'Tạo đặt bàn' }).click();
+  // redirect() inside the action's try: actionError lets it through (unstable_rethrow).
+  await expect(page).toHaveURL(/\/admin\/reservations\/\d+$/);
+  await expect(page.getByRole('heading', { level: 1 })).toContainText('Đã xác nhận');
+  await expect(page.getByTestId('sitting')).toContainText('19:00 · Dinner');
+  const created = page.getByRole('list', { name: 'Dòng thời gian' }).getByRole('listitem').first();
+  await expect(created).toContainText('Tạo đặt bàn');
+  await expect(created).toContainText('Lý do: Đoàn công ty, đã gọi bếp');
+  const id = new URL(page.url()).pathname.split('/').pop();
+  expect(await one(`SELECT source, status, over_capacity, locale, guests FROM reservations WHERE id = $1`, [id])).toEqual({
+    source: 'phone',
+    status: 'confirmed',
+    over_capacity: true,
+    locale: 'vi',
+    guests: 30,
+  });
+});
+
+test('the day sheet lists each service with its load, and prints without the admin chrome', async ({ page }) => {
+  const date = venueDay(6);
+  const r = await seedReservation({ date, status: 'confirmed', guests: 4 });
+  await signInAs(page, STAFF.editor);
+  await page.goto(`/admin/reservations/day?ngay=${date}&nha_hang=taya-house`);
+  const sheet = page.getByRole('region', { name: 'Tàya House' });
+  const row = sheet.getByRole('row').filter({ hasText: r.reference });
+  await expect(row).toContainText('19:00');
+  await expect(row).toContainText('4/16');
+  await expect(page.getByRole('button', { name: 'In bảng' })).toBeVisible();
+  await page.emulateMedia({ media: 'print' });
+  await expect(page.getByRole('navigation', { name: 'Điều hướng quản trị' })).toBeHidden();
+  await expect(page.getByRole('button', { name: 'In bảng' })).toBeHidden();
+  await expect(row).toBeVisible();
+});
```

- [ ] **Bước 4: Build code hiện tại và chạy đặc tả: phải đỏ**

Cất tạm các file ngoài `e2e/`, build, chạy `e2e/admin-reservations.spec.ts --project=desktop`.

Expected: `2 failed`, `6 passed`:

```
  ✘  [desktop] › e2e/admin-reservations.spec.ts › a phone booking past capacity needs a reason; the form keeps what was typed, then opens the new booking
  ✘  [desktop] › e2e/admin-reservations.spec.ts › the day sheet lists each service with its load, and prints without the admin chrome
    Locator: getByRole('form', { name: 'Đặt bàn mới' }).getByRole('radio', { name: 'Khách vãng lai (đã đến)' })
    Error: element(s) not found
    Locator: getByRole('region', { name: 'Tàya House' }).getByRole('row').filter({ hasText: 'FC-…' })
    Error: element(s) not found
```

Lấy lại các file đã cất.

- [ ] **Bước 5: Viết truy vấn, schema và action**

```diff
diff --git a/lib/server/booking/queries.ts b/lib/server/booking/queries.ts
index 6113d6f..cb45c4b 100644
--- a/lib/server/booking/queries.ts
+++ b/lib/server/booking/queries.ts
@@ -1,9 +1,11 @@
 import 'server-only';
 import type { Pool } from 'pg';
+import { findPlannedSlot, planDay, type PlannedPeriod } from '@/lib/booking/resolve-day';
 import { HOLDING_STATUSES, type ReservationStatus } from '@/lib/booking/rules';
 import type { Meal } from '@/lib/data';
 import { escapeLike, parseSearch } from '@/lib/reservations/search';
 import type { IsoDate } from '@/lib/venue-time';
+import { loadBookingRules } from './rules';
 
 /*
  * The admin's reservation reads. Keyset pagination (no OFFSET): the cursor
@@ -165,3 +167,65 @@ export async function overviewCounts(pool: Pool, today: IsoDate): Promise<{ pend
   );
   return rows[0];
 }
+
+/** Every restaurant, for the pickers of the new-booking and day-sheet screens. */
+export async function listRestaurantOptions(pool: Pool): Promise<{ id: string; name: string }[]> {
+  const { rows } = await pool.query<{ id: string; name: string }>('SELECT id, name FROM restaurants ORDER BY sort_order, id');
+  return rows;
+}
+
+/** The languages a guest may speak, enabled on the site or not: staff record the guest's, the email follows it from phase 5. */
+export async function listLocales(pool: Pool): Promise<{ code: string; name: string; isDefault: boolean }[]> {
+  const { rows } = await pool.query<{ code: string; name: string; isDefault: boolean }>(
+    `SELECT code, native_name AS name, is_default AS "isDefault" FROM locales ORDER BY sort_order, code`,
+  );
+  return rows;
+}
+
+// ── the day sheet (spec §7.2 "Bảng theo ngày", printable) ───────────────────
+
+export type SheetRow = Omit<InboxRow, 'cursor'> & { meal: Meal; note: string | null };
+
+export type DaySheetRestaurant = {
+  id: string;
+  name: string;
+  /** The day's services from planDay, each slot with the covers held now. */
+  periods: (Omit<PlannedPeriod, 'slots'> & { slots: { time: string; capacity: number; booked: number }[] })[];
+  /** Bookings that still count (not cancelled or declined), by time. */
+  reservations: SheetRow[];
+  /** Those whose time is no longer a slot of the day (the hours changed after they were made). */
+  outside: SheetRow[];
+};
+
+/** Every restaurant (or one) on a date: its services and slots with the covers held, and its bookings. */
+export async function daySheet(pool: Pool, date: IsoDate, restaurantId?: string | null): Promise<DaySheetRestaurant[]> {
+  const restaurants = (await listRestaurantOptions(pool)).filter((r) => !restaurantId || r.id === restaurantId);
+  const ids = restaurants.map((r) => r.id);
+  const [rules, bookings] = await Promise.all([
+    loadBookingRules(pool, ids, 'vi', date),
+    pool.query<SheetRow>(
+      `SELECT ${COLUMNS}, r.meal, r.note
+         FROM reservations r JOIN restaurants t ON t.id = r.restaurant_id
+        WHERE r.reserved_on = $1::date AND r.restaurant_id = ANY ($2::text[]) AND r.status NOT IN ('cancelled', 'declined')
+        ORDER BY r.reserved_at, r.id`,
+      [date, ids],
+    ),
+  ]);
+  return restaurants.flatMap((r) => {
+    const loaded = rules.get(r.id);
+    if (!loaded) return [];
+    const plan = planDay(loaded.rules, date);
+    const mine = bookings.rows.filter((b) => b.restaurantId === r.id);
+    const booked: Record<string, number> = {};
+    for (const b of mine) if ((HOLDING_STATUSES as readonly string[]).includes(b.status)) booked[b.time] = (booked[b.time] ?? 0) + b.guests;
+    return [
+      {
+        id: r.id,
+        name: r.name,
+        periods: plan.periods.map((p) => ({ ...p, slots: p.slots.map((s) => ({ ...s, booked: booked[s.time] ?? 0 })) })),
+        reservations: mine,
+        outside: mine.filter((b) => !findPlannedSlot(plan, b.time)),
+      },
+    ];
+  });
+}
```

```diff
diff --git a/lib/admin/booking-schemas.ts b/lib/admin/booking-schemas.ts
index 160f903..e191d09 100644
--- a/lib/admin/booking-schemas.ts
+++ b/lib/admin/booking-schemas.ts
@@ -14,6 +14,7 @@ import { z } from './zod';
 const blankToNull = (v: unknown) => (v === undefined || (typeof v === 'string' && v.trim() === '') ? null : v);
 
 export const Id = z.string().regex(/^\d{1,18}$/);
+export const RestaurantId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
 export const Version = z.coerce.number().int().min(1);
 export const IsoDay = z.string().refine(isValidIsoDate, { error: 'Chọn một ngày hợp lệ.' });
 export const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'Chọn giờ (HH:MM).' });
@@ -49,3 +50,13 @@ export const NoteForm = z.object({
   id: Id,
   body: z.string().trim().min(1, { error: 'Nhập nội dung ghi chú.' }).max(2000, { error: 'Ghi chú tối đa 2000 ký tự.' }),
 });
+
+/** A phone booking (confirmed) or a walk-in (seated) made by staff; the action checks the language exists. */
+export const NewReservationForm = z.object({
+  restaurant: RestaurantId,
+  date: IsoDay,
+  time: Time,
+  source: z.enum(['phone', 'walk_in'], { error: 'Chọn nguồn đặt bàn.' }),
+  locale: z.string().regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/, { error: 'Chọn ngôn ngữ của khách.' }),
+  ...GuestFields,
+});
```

`createReservation` kiểm ngôn ngữ có trong `locales` (FK), rồi gọi `createStaffReservation`; `redirect()` ném `NEXT_REDIRECT`, và `actionError` ném lại nó nhờ `unstable_rethrow` (Task 7), nên nó nằm được trong `try` mà guard CI vẫn thấy `requirePermission` là câu đầu:

```diff
diff --git a/app/admin/(shell)/reservations/actions.ts b/app/admin/(shell)/reservations/actions.ts
index f49932d..ab1bddf 100644
--- a/app/admin/(shell)/reservations/actions.ts
+++ b/app/admin/(shell)/reservations/actions.ts
@@ -1,12 +1,20 @@
 'use server';
 
 import { refresh } from 'next/cache';
+import { redirect } from 'next/navigation';
 import { getPool } from '@/db/client';
-import { EditForm, NoteForm, TransitionForm } from '@/lib/admin/booking-schemas';
+import { EditForm, NewReservationForm, NoteForm, TransitionForm } from '@/lib/admin/booking-schemas';
 import type { ReservationStatus } from '@/lib/booking/rules';
 import { toE164 } from '@/lib/phone';
 import { actionError, type ActionResult } from '@/lib/server/action-result';
-import { addReservationNote, editReservation, staffActor, transitionReservation } from '@/lib/server/booking/reservations';
+import { listLocales } from '@/lib/server/booking/queries';
+import {
+  addReservationNote,
+  createStaffReservation,
+  editReservation,
+  staffActor,
+  transitionReservation,
+} from '@/lib/server/booking/reservations';
 import { requirePermission } from '@/lib/server/dal/session';
 
 /*
@@ -67,3 +75,35 @@ export async function addNote(_prev: ActionResult | null, formData: FormData): P
     return actionError(err);
   }
 }
+
+/** A phone booking or a walk-in; on success, the new booking's page. */
+export async function createReservation(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
+  try {
+    const staff = await requirePermission({ reservations: ['create'] });
+    const input = NewReservationForm.parse(Object.fromEntries(formData));
+    const pool = getPool();
+    if (!(await listLocales(pool)).some((l) => l.code === input.locale)) {
+      return { ok: false, code: 'invalid', fieldErrors: { locale: ['Chọn ngôn ngữ của khách.'] } };
+    }
+    const result = await createStaffReservation(pool, staffActor(staff), {
+      restaurantId: input.restaurant,
+      date: input.date,
+      time: input.time,
+      guests: input.guests,
+      name: input.name,
+      phone: input.phone,
+      phoneE164: toE164(input.phone)!,
+      email: input.email,
+      note: input.note,
+      locale: input.locale,
+      source: input.source,
+      overCapacityReason: input.overCapacityReason,
+      notifyGuest: false,
+    });
+    if (!result.ok) return result;
+    // redirect() throws NEXT_REDIRECT, which actionError() rethrows (unstable_rethrow): it may sit in the try (R13).
+    redirect(`/admin/reservations/${result.data.id}`);
+  } catch (err) {
+    return actionError(err);
+  }
+}
```

```diff
diff --git a/app/admin/(shell)/reservations/_ui/SectionNav.tsx b/app/admin/(shell)/reservations/_ui/SectionNav.tsx
index 37a513b..41a9bd6 100644
--- a/app/admin/(shell)/reservations/_ui/SectionNav.tsx
+++ b/app/admin/(shell)/reservations/_ui/SectionNav.tsx
@@ -1,6 +1,10 @@
 import Link from 'next/link';
 
-const LINKS = [{ href: '/admin/reservations', label: 'Hộp thư' }] as const;
+const LINKS = [
+  { href: '/admin/reservations', label: 'Hộp thư' },
+  { href: '/admin/reservations/new', label: 'Tạo đặt bàn' },
+  { href: '/admin/reservations/day', label: 'Theo ngày' },
+] as const;
 
 /* The reservations section's own links (spec §7.2), above each of its pages; hidden when printing. */
 export function SectionNav({ current }: { current: (typeof LINKS)[number]['href'] }) {
```

- [ ] **Bước 6: Viết màn tạo đặt bàn**

Create `app/admin/(shell)/reservations/new/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { getPool } from '@/db/client';
import { formatIsoDayVi } from '@/lib/admin/format';
import { planDay } from '@/lib/booking/resolve-day';
import { serviceDay } from '@/lib/reservations/lifecycle';
import { listLocales, listRestaurantOptions } from '@/lib/server/booking/queries';
import { loadBookedCovers, loadRestaurantRules } from '@/lib/server/booking/rules';
import { requirePagePermission } from '@/lib/server/dal/session';
import { isValidIsoDate } from '@/lib/venue-time';
import { SectionNav } from '../_ui/SectionNav';
import { NewReservationForm, type SlotOption } from './NewReservationForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Tạo đặt bàn' };

type Search = { nha_hang?: string | string[]; ngay?: string | string[] };
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

/*
 * Two steps on one page: a GET form picks the restaurant and the date, so the
 * slot list is the server's planDay for that day (closures included) with the
 * covers held now; the booking form then posts the rest to createReservation,
 * which checks again under the booking-day lock.
 */
export default async function NewReservationPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePagePermission({ reservations: ['create'] });
  const params = await searchParams;
  const pool = getPool();
  const [restaurants, locales] = await Promise.all([listRestaurantOptions(pool), listLocales(pool)]);
  const today = serviceDay();
  const restaurantId = restaurants.some((r) => r.id === one(params.nha_hang)) ? one(params.nha_hang)! : restaurants[0]?.id;
  const date = isValidIsoDate(one(params.ngay)) ? one(params.ngay)! : today;
  const loaded = restaurantId ? await loadRestaurantRules(pool, restaurantId, 'vi', date) : null;
  const booked = restaurantId ? ((await loadBookedCovers(pool, restaurantId, date, date))[date] ?? {}) : {};
  const plan = loaded ? planDay(loaded.rules, date) : null;

  const slots: SlotOption[] = (plan?.periods ?? [])
    .filter((p) => !p.closed)
    .flatMap((p) =>
      p.slots.map((s) => {
        const left = s.capacity - (booked[s.time] ?? 0);
        return { time: s.time, label: `${s.time} · ${p.meal} · ${left > 0 ? `còn ${left}/${s.capacity}` : 'hết chỗ'}` };
      }),
    );
  const closedMeals = (plan?.periods ?? []).filter((p) => p.closed).map((p) => p.meal);
  const defaultLocale = locales.find((l) => l.isDefault)?.code ?? 'en';

  return (
    <>
      <SectionNav current="/admin/reservations/new" />
      <h1>Tạo đặt bàn</h1>
      <p className="a-lede">Đặt qua điện thoại (đã xác nhận) hoặc khách vãng lai (đã đến, chỉ trong hôm nay).</p>
      <form className="a-filter" action="/admin/reservations/new">
        <div className="a-field">
          <label htmlFor="res-new-pick-restaurant">Nhà hàng</label>
          <select id="res-new-pick-restaurant" name="nha_hang" defaultValue={restaurantId}>
            {restaurants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div className="a-field">
          <label htmlFor="res-new-pick-date">Ngày</label>
          <input id="res-new-pick-date" name="ngay" type="date" defaultValue={date} min={today} />
        </div>
        <button className="a-btn a-btn--ghost" type="submit">
          Xem giờ trống
        </button>
      </form>
      {loaded ? (
        <>
          <h2>{`${loaded.rules.restaurantName} · ${formatIsoDayVi(date)}`}</h2>
          {closedMeals.length ? <p className="a-warn">{`Đóng cửa ngày này: ${closedMeals.join(', ')}.`}</p> : null}
          {slots.length === 0 ? (
            <p className="a-lede">Ngày này nhà hàng không có ca nào mở.</p>
          ) : (
            <NewReservationForm
              key={`${restaurantId}|${date}`}
              restaurantId={loaded.rules.restaurantId}
              date={date}
              walkInAllowed={date === today}
              slots={slots}
              locales={locales.map((l) => ({ code: l.code, name: l.name }))}
              defaultLocale={defaultLocale}
            />
          )}
        </>
      ) : null}
    </>
  );
}
```

Create `app/admin/(shell)/reservations/new/NewReservationForm.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import { FieldError, FormMessage } from '../../_ui/FormMessage';
import { createReservation } from '../actions';

export type SlotOption = { time: string; label: string };

export function NewReservationForm(props: {
  restaurantId: string;
  date: string;
  walkInAllowed: boolean;
  slots: SlotOption[];
  locales: { code: string; name: string }[];
  defaultLocale: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createReservation, null);
  const err = (name: string) => `res-new-${name}-error`;
  return (
    <form className="a-grid-form" onSubmit={submitKeepingValues(action)} noValidate aria-label="Đặt bàn mới">
      <input type="hidden" name="restaurant" value={props.restaurantId} />
      <input type="hidden" name="date" value={props.date} />
      <FormMessage state={state} />
      <fieldset className="a-field a-field--wide">
        <legend>Nguồn</legend>
        <label className="a-check">
          <input type="radio" name="source" value="phone" defaultChecked />
          Điện thoại (đã xác nhận)
        </label>
        <label className="a-check">
          <input type="radio" name="source" value="walk_in" disabled={!props.walkInAllowed} />
          Khách vãng lai (đã đến)
        </label>
        <FieldError state={state} name="date" id={err('date')} />
      </fieldset>
      <div className="a-field">
        <label htmlFor="res-new-time">Giờ</label>
        <select id="res-new-time" name="time" aria-describedby={err('time')}>
          {props.slots.map((s) => (
            <option key={s.time} value={s.time}>
              {s.label}
            </option>
          ))}
        </select>
        <FieldError state={state} name="time" id={err('time')} />
      </div>
      <div className="a-field">
        <label htmlFor="res-new-guests">Số khách</label>
        <input id="res-new-guests" name="guests" type="number" min={1} max={50} defaultValue={2} aria-describedby={err('guests')} />
        <FieldError state={state} name="guests" id={err('guests')} />
      </div>
      <div className="a-field">
        <label htmlFor="res-new-name">Tên khách</label>
        <input id="res-new-name" name="name" aria-describedby={err('name')} />
        <FieldError state={state} name="name" id={err('name')} />
      </div>
      <div className="a-field">
        <label htmlFor="res-new-phone">Điện thoại</label>
        <input id="res-new-phone" name="phone" type="tel" aria-describedby={err('phone')} />
        <FieldError state={state} name="phone" id={err('phone')} />
      </div>
      <div className="a-field">
        <label htmlFor="res-new-email">Email (không bắt buộc)</label>
        <input id="res-new-email" name="email" type="email" aria-describedby={err('email')} />
        <FieldError state={state} name="email" id={err('email')} />
      </div>
      <div className="a-field">
        <label htmlFor="res-new-locale">Ngôn ngữ của khách</label>
        <select id="res-new-locale" name="locale" defaultValue={props.defaultLocale} aria-describedby={err('locale')}>
          {props.locales.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
        <FieldError state={state} name="locale" id={err('locale')} />
      </div>
      <div className="a-field a-field--wide">
        <label htmlFor="res-new-note">Yêu cầu của khách</label>
        <textarea id="res-new-note" name="note" rows={2} maxLength={1000} aria-describedby={err('note')} />
        <FieldError state={state} name="note" id={err('note')} />
      </div>
      <div className="a-field a-field--wide">
        <label htmlFor="res-new-over">Lý do vượt sức chứa (chỉ khi khung giờ đã hết chỗ)</label>
        <input id="res-new-over" name="overCapacityReason" maxLength={500} aria-describedby={err('overCapacityReason')} />
        <FieldError state={state} name="overCapacityReason" id={err('overCapacityReason')} />
      </div>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang tạo…' : 'Tạo đặt bàn'}
      </button>
    </form>
  );
}
```

- [ ] **Bước 7: Viết bảng theo ngày và bản in**

Create `app/admin/(shell)/reservations/day/PrintButton.tsx` (`onclick=""` viết thẳng sẽ vỡ CSP):

```tsx
'use client';

/* window.print() needs a click handler: an inline onclick="" would break the admin CSP (no 'unsafe-inline'). */
export function PrintButton() {
  return (
    <button className="a-btn" type="button" onClick={() => window.print()}>
      In bảng
    </button>
  );
}
```

Create `app/admin/(shell)/reservations/day/page.tsx` (giờ in trên mọi dòng, vì bản in được đọc từng dòng; tải của khung giờ chỉ ở dòng đầu):

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { formatLongDateVi } from '@/lib/admin/format';
import { serviceDay } from '@/lib/reservations/lifecycle';
import { daySheet, listNotes, listRestaurantOptions } from '@/lib/server/booking/queries';
import { requirePagePermission } from '@/lib/server/dal/session';
import { addDays, isValidIsoDate } from '@/lib/venue-time';
import { SectionNav } from '../_ui/SectionNav';
import { StatusBadge } from '../_ui/StatusBadge';
import { PrintButton } from './PrintButton';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Bảng đặt bàn theo ngày' };

type Search = { ngay?: string | string[]; nha_hang?: string | string[] };
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

/*
 * The host stand's sheet (spec §7.2): per restaurant and service, each slot's
 * covers against its capacity, each booking with the guest's request and the
 * staff notes, and the bookings whose time the current hours no longer have.
 * styles/admin.css @media print drops the shell and the filters.
 */
export default async function DaySheetPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePagePermission({ reservations: ['read'] });
  const params = await searchParams;
  const pool = getPool();
  const date = isValidIsoDate(one(params.ngay)) ? one(params.ngay)! : serviceDay();
  const restaurants = await listRestaurantOptions(pool);
  const restaurantId = restaurants.some((r) => r.id === one(params.nha_hang)) ? one(params.nha_hang)! : null;
  // Without a filter, only the restaurants that have bookings that day.
  const sheet = (await daySheet(pool, date, restaurantId)).filter((r) => restaurantId || r.reservations.length > 0);
  const notes = await listNotes(pool, sheet.flatMap((r) => r.reservations.map((x) => x.id)));
  const link = (d: string) => `/admin/reservations/day?${new URLSearchParams({ ngay: d, ...(restaurantId ? { nha_hang: restaurantId } : {}) })}`;

  return (
    <>
      <SectionNav current="/admin/reservations/day" />
      <h1>{`Đặt bàn ngày ${formatLongDateVi(`${date}T12:00:00+07:00`)}`}</h1>
      <form className="a-filter a-noprint" action="/admin/reservations/day">
        <div className="a-field">
          <label htmlFor="res-day-date">Ngày</label>
          <input id="res-day-date" name="ngay" type="date" defaultValue={date} />
        </div>
        <div className="a-field">
          <label htmlFor="res-day-restaurant">Nhà hàng</label>
          <select id="res-day-restaurant" name="nha_hang" defaultValue={restaurantId ?? ''}>
            <option value="">Tất cả (có đặt bàn)</option>
            {restaurants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <button className="a-btn a-btn--ghost" type="submit">
          Xem
        </button>
        <Link className="a-btn a-btn--ghost" href={link(addDays(date, -1))}>
          ← Hôm trước
        </Link>
        <Link className="a-btn a-btn--ghost" href={link(addDays(date, 1))}>
          Hôm sau →
        </Link>
        <PrintButton />
      </form>
      {sheet.length === 0 ? <p className="a-lede">Không có đặt bàn nào trong ngày.</p> : null}
      {sheet.map((r) => (
        <section className="a-sheet" key={r.id} aria-label={r.name}>
          <h2>{`${r.name} · ${r.periods.flatMap((p) => p.slots).reduce((n, s) => n + s.booked, 0)} khách`}</h2>
          {r.periods.map((period) => {
            const bookings = r.reservations.filter((x) => period.slots.some((s) => s.time === x.time));
            return (
              <div key={period.periodId} className="a-sheet-service">
                <h3>{`${period.meal}${period.closed ? ' · đóng cửa' : ''}`}</h3>
                {bookings.length === 0 ? (
                  <p className="a-muted">Chưa có đặt bàn.</p>
                ) : (
                  <table className="a-table a-table--compact">
                    <thead>
                      <tr>
                        <th scope="col">Giờ</th>
                        <th scope="col">Chỗ</th>
                        <th scope="col">Mã</th>
                        <th scope="col">Khách</th>
                        <th scope="col">Số khách</th>
                        <th scope="col">Trạng thái</th>
                        <th scope="col">Ghi chú</th>
                      </tr>
                    </thead>
                    <tbody>
                      {period.slots.flatMap((slot) =>
                        bookings
                          .filter((x) => x.time === slot.time)
                          .map((x, i) => (
                            <tr key={x.id}>
                              {/* The time on every row (a printed sheet is read line by line); the slot's load once. */}
                              <td>{slot.time}</td>
                              <td>{i === 0 ? `${slot.booked}/${slot.capacity}` : ''}</td>
                              <td>
                                <Link href={`/admin/reservations/${x.id}`}>{x.reference}</Link>
                              </td>
                              <td>{`${x.name} · ${x.phone}`}</td>
                              <td>{x.guests}</td>
                              <td>
                                <StatusBadge status={x.status} />
                              </td>
                              <td>
                                {x.note ? <span>{`Khách: ${x.note}`}</span> : null}
                                {(notes.get(x.id) ?? []).map((n) => (
                                  <span className="a-sub" key={n.id}>{`Nội bộ: ${n.body}`}</span>
                                ))}
                              </td>
                            </tr>
                          )),
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
          {r.outside.length ? (
            <p className="a-warn">{`Ngoài giờ phục vụ hiện tại: ${r.outside.map((x) => `${x.time} ${x.reference} (${x.guests})`).join(', ')}`}</p>
          ) : null}
        </section>
      ))}
    </>
  );
}
```

`@media print` bỏ thanh bên, đầu trang, bộ lọc và menu con:

```diff
diff --git a/styles/admin.css b/styles/admin.css
index ee2780e..00e6f6c 100644
--- a/styles/admin.css
+++ b/styles/admin.css
@@ -611,3 +611,109 @@ body.admin {
   margin-right: 4px;
   font-size: 22px;
 }
+
+.a-filter {
+  display: flex;
+  flex-wrap: wrap;
+  align-items: flex-end;
+  gap: 12px;
+  margin: 0 0 20px;
+}
+
+.a-filter .a-field {
+  margin-bottom: 0;
+}
+
+fieldset.a-field {
+  display: flex;
+  flex-wrap: wrap;
+  align-items: center;
+  margin: 0 0 16px;
+  padding: 0;
+  border: 0;
+}
+
+fieldset.a-field legend {
+  margin-bottom: 6px;
+  font-weight: 600;
+}
+
+.a-check,
+.a-field .a-check {
+  display: inline-flex;
+  align-items: center;
+  gap: 6px;
+  margin: 0 16px 8px 0;
+  font-weight: 400;
+}
+
+/* Text inputs are 44px tall; a checkbox or a radio is not a text input. */
+.a-field input[type='checkbox'],
+.a-field input[type='radio'],
+.a-check input {
+  min-height: 0;
+  margin: 0;
+  padding: 0;
+}
+
+.a-table--compact th,
+.a-table--compact td {
+  padding: 6px 10px;
+  vertical-align: top;
+}
+
+.a-sheet {
+  margin: 0 0 28px;
+}
+
+.a-sheet h3 {
+  margin: 16px 0 8px;
+  font-size: 15px;
+}
+
+/* The day sheet on paper (spec §7.2): the sheet only, black on white, a restaurant never split. */
+@media print {
+  body.admin {
+    background: #fff;
+    font-size: 11pt;
+  }
+
+  .a-shell {
+    display: block;
+  }
+
+  .a-sidebar,
+  .a-header,
+  .a-noprint,
+  .a-subnav {
+    display: none;
+  }
+
+  .a-main {
+    max-width: none;
+    padding: 0;
+  }
+
+  .a-table {
+    border-color: #999;
+  }
+
+  .a-table th,
+  .a-table td {
+    border-bottom-color: #bbb;
+  }
+
+  .a-status {
+    padding: 0;
+    background: none;
+    color: #000;
+  }
+
+  .a-sheet {
+    break-inside: avoid;
+  }
+
+  .admin a {
+    text-decoration: none;
+  }
+}
```

- [ ] **Bước 8: Chạy lại test**

Run: lệnh ở Bước 2.
Expected: PASS `Test Files  3 passed (3)`, `Tests  31 passed (31)`

- [ ] **Bước 9: Chạy cổng kiểm tra**

Expected: typecheck không lỗi; lint thoát 0, 19 cảnh báo; `Test Files  52 passed (52)`, `Tests  548 passed (548)`; `Applied 6 migration(s).`; build thoát 0; check-prerender thêm `/admin/reservations/day` và `/admin/reservations/new`; E2E `86 passed`; visual `8 passed`.

- [ ] **Bước 10: Commit**

```bash
git add "app/admin/(shell)/reservations/_ui/SectionNav.tsx" "app/admin/(shell)/reservations/actions.ts" "app/admin/(shell)/reservations/new/page.tsx" "app/admin/(shell)/reservations/new/NewReservationForm.tsx" "app/admin/(shell)/reservations/day/page.tsx" "app/admin/(shell)/reservations/day/PrintButton.tsx" e2e/admin-reservations.spec.ts lib/admin/booking-schemas.ts lib/admin/booking-schemas.test.ts lib/server/booking/queries.ts styles/admin.css test/guards/require-permission.guard.test.ts test/integration/reservation-inbox.test.ts
git commit -m "$(cat <<'EOF'
feat: let staff take phone bookings and walk-ins, and print the day's sheet

/admin/reservations/new (reservations:create) picks a restaurant and a date,
lists that day's open slots with the covers left (planDay plus the covers
held now; closed services named), and books by phone (confirmed) or as a
walk-in (seated, the service day only), in the guest's language. The action
re-checks under the booking-day lock; past capacity it answers with the
covers left and keeps what was typed, and with a reason it books as over
capacity. On success it redirects from inside its try, which
unstable_rethrow lets through.

/admin/reservations/day is the host stand's sheet: per restaurant and
service, each slot's covers against capacity, each booking with the
guest's request and the staff notes, and the bookings whose time the
current hours no longer have. Printing drops the shell and the filters.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 11: "Giờ và sức chứa", công tắc đặt bàn online, và ẩn RESERVE

`/admin/restaurants` (danh sách tối giản, R16) dẫn tới `/admin/restaurants/[id]/booking` (Editor và Admin, `schedule:read`): form quy tắc (công tắc `booking_enabled`, ghi đè cửa sổ, lead time, số khách; `reservations:configure`), trình sửa ca (một danh sách, một token, luật trùng giờ, zod lưới khoảng cách; `schedule:update`), danh sách đặt bàn sắp tới không còn khớp (hủy chỉ khi tích), và xem trước giờ đặt theo ngày. Mỗi lần lưu ghi `audit_log` và gọi `updateTag('restaurants')` cùng `updateTag('booking-rules:<id>')` sau COMMIT. Web khách bỏ mọi lối RESERVE của nhà hàng đã tắt (R14). Spec công tắc chạy trong project mới `desktop-serial`.

**Files:**
- Create: `lib/server/booking/config.ts`, `lib/server/booking/affected.ts`, `test/integration/booking-config.test.ts`, `app/admin/(shell)/_ui/AffectedList.tsx`, `app/admin/(shell)/restaurants/page.tsx`, `app/admin/(shell)/restaurants/[id]/booking/page.tsx`, `app/admin/(shell)/restaurants/[id]/booking/RulesForm.tsx`, `app/admin/(shell)/restaurants/[id]/booking/PeriodsEditor.tsx`, `app/admin/(shell)/restaurants/[id]/booking/actions.ts`, `e2e/admin-booking-config.spec.ts`, `e2e/booking-switch.serial.spec.ts`
- Modify: `lib/booking/rules.ts`, `lib/admin/booking-schemas.ts`, `lib/admin/booking-schemas.test.ts`, `lib/admin/nav.ts`, `lib/admin/nav.test.ts`, `lib/admin/audit-labels.test.ts`, `app/admin/(shell)/reservations/actions.ts`, `styles/admin.css`, `test/guards/require-permission.guard.test.ts`, `playwright.config.ts`, `components/detail/TayaHero.tsx`, `components/site/MobileBar.tsx`, `components/home/Offers.tsx`, `components/home/RestaurantCard.tsx`, `components/overlays/SearchOverlay.tsx`, `components/site/SiteProvider.tsx`, `e2e/admin-acceptance.spec.ts`, `e2e/admin-users.spec.ts`

**Interfaces:**
- Consumes: `planDay`, `closureApplies`, `seatings`, `findPlannedSlot` (Task 2, 8); `loadBookingRules`, `loadRestaurantRules`, `loadBookedCovers`, `Db` (Task 3); `UPCOMING_STATUSES`, `STATUS_LABELS` (Task 8); `transitionReservation`, `staffActor` (Task 8); `insertAudit`, `withTransaction` (đợt 3); `auditActor` (DAL); `TAGS.restaurants`, `TAGS.bookingRules(id)` (`lib/cache-tags.ts`); `FormMessage`, `FieldError`, `submitKeepingValues`, `Id`, `Time`, `RestaurantId` (Task 9, 10); `bookable` của `useSite()` (Task 6); `Restaurant.bookingEnabled` (Task 5).
- Produces:
  - `lib/booking/rules.ts`: `SLOT_INTERVALS = [15, 20, 30, 45, 60, 90, 120] as const`.
  - `lib/server/booking/config.ts`: `US(column)` (token µs); `type BookingSettings` (+ `token`), `getBookingSettings(db)`; `type RestaurantBooking` (`id, name, destinationId, bookingEnabled, windowDays|null, leadMinutes|null, maxParty|null, autoConfirm|null, token`), `listRestaurantBookings(db)`, `getRestaurantBooking(db, id)`; `type StoredPeriod = PeriodRule & { active: boolean }`, `loadPeriods(db, restaurantId)` (cả ca đang tắt); `type PeriodInput`; `overlappingPeriods(periods): string | null`; `saveServicePeriods(pool, actor, { restaurantId, token, periods })`; `type RulesInput`; `saveRestaurantRules(pool, actor, RulesInput)`. Xung đột trả `{ code: 'conflict', params: { by, at } }`.
  - `lib/server/booking/affected.ts`: `type AffectedKind = 'closed' | 'outside_hours' | 'over_capacity'`; `type AffectedReservation`; `findAffected(pool, { restaurantIds?, from?, to?, now? })` (Task 13 thêm `closureId`).
  - `lib/admin/booking-schemas.ts`: `Token`, `Meal`, `CancelManyForm`, `RulesForm`, `PeriodForm`, `PeriodsForm`.
  - `app/admin/(shell)/reservations/actions.ts`: `type CancelManyResult = { cancelled; skipped }`, `cancelReservations` (`reservations:update`).
  - `app/admin/(shell)/_ui/AffectedList.tsx`: `type AffectedItem`, `AffectedList({ items, title })`.
  - `app/admin/(shell)/restaurants/[id]/booking/actions.ts`: `savePeriods`, `saveRules`.
  - `playwright.config.ts`: project `desktop` (bỏ qua `*.serial.spec.ts`) và `desktop-serial` (`testMatch` `*.serial.spec.ts`, `dependencies: ['desktop']`).

- [ ] **Bước 1: Viết test**

Zod chặn trước lỗi CHECK `service_periods_grid` (giờ cuối phải nằm trên lưới khoảng cách) và giới hạn cửa sổ 1–90 như DB:

```diff
diff --git a/lib/admin/booking-schemas.test.ts b/lib/admin/booking-schemas.test.ts
index c043583..6bb6516 100644
--- a/lib/admin/booking-schemas.test.ts
+++ b/lib/admin/booking-schemas.test.ts
@@ -1,5 +1,5 @@
 import { describe, expect, it } from 'vitest';
-import { EditForm, NewReservationForm, NoteForm, TransitionForm } from './booking-schemas';
+import { CancelManyForm, EditForm, NewReservationForm, NoteForm, PeriodsForm, RulesForm, TransitionForm } from './booking-schemas';
 
 /* The booking screens' action inputs (spec §7.3): FormData strings in, typed values or Vietnamese field errors out. */
 describe('booking form schemas', () => {
@@ -51,4 +51,47 @@ describe('booking form schemas', () => {
       locale: ['Chọn ngôn ngữ của khách.'],
     });
   });
+
+  it('overrides: a blank one follows the defaults; the switch is a checkbox; the window is 1–90 days like the database', () => {
+    expect(RulesForm.parse({ restaurant: 'taya-house', token: '1759400000000000', windowDays: '', leadMinutes: '60', maxParty: '8' })).toEqual({
+      restaurant: 'taya-house',
+      token: '1759400000000000',
+      bookingEnabled: false,
+      windowDays: null,
+      leadMinutes: 60,
+      maxParty: 8,
+    });
+    expect(RulesForm.parse({ restaurant: 'taya-house', token: '1', bookingEnabled: 'on', windowDays: '90' })).toMatchObject({ bookingEnabled: true, windowDays: 90 });
+    expect(RulesForm.safeParse({ restaurant: 'taya-house', token: '1', windowDays: '91', maxParty: '51' }).error?.flatten().fieldErrors).toEqual({
+      windowDays: ['Số ngày đặt trước: từ 1 đến 90.'],
+      maxParty: ['Số khách tối đa: từ 1 đến 50.'],
+    });
+  });
+
+  it('service periods arrive as one JSON field, on the grid of their interval', () => {
+    const period = { id: null, meal: 'Dinner', weekdays: [1, 2], firstSeating: '18:00', lastSeating: '22:00', intervalMin: 30, coversPerSlot: 8, active: true };
+    expect(PeriodsForm.parse({ restaurant: 'thai-siam-kitchen', token: '1', periods: JSON.stringify([period]) }).periods).toEqual([period]);
+    const bad = [
+      { ...period, lastSeating: '17:00' },
+      { ...period, intervalMin: 25 },
+      // 18:00 + 45-minute steps never lands on 22:00 (the database CHECK service_periods_grid).
+      { ...period, intervalMin: 45 },
+      { ...period, weekdays: [] },
+    ];
+    expect(bad.map((p) => PeriodsForm.safeParse({ restaurant: 'x', token: '1', periods: JSON.stringify([p]) }).error?.issues.map((i) => i.message))).toEqual([
+      ['Giờ nhận khách cuối phải từ giờ đầu trở đi.'],
+      ['Chọn khoảng cách giữa các giờ.'],
+      ['Giờ cuối phải cách giờ đầu một số lần đúng bằng khoảng cách (ví dụ 18:00 → 21:00 với 30 phút).'],
+      ['Chọn ít nhất một ngày trong tuần.'],
+    ]);
+    expect(PeriodsForm.safeParse({ restaurant: 'x', token: '1', periods: 'not json' }).success).toBe(false);
+  });
+
+  it('a batch cancel: ticked id:version pairs and a reason', () => {
+    expect(CancelManyForm.parse({ items: ['12:3', '7:1'], reason: ' Đóng cửa ' })).toEqual({ items: ['12:3', '7:1'], reason: 'Đóng cửa' });
+    expect(CancelManyForm.safeParse({ items: [], reason: '' }).error?.flatten().fieldErrors).toEqual({
+      items: ['Chọn ít nhất một đặt bàn.'],
+      reason: ['Nhập lý do hủy.'],
+    });
+  });
 });
```

Create `test/integration/booking-config.test.ts`. `afterAll` trả seed về: lần chạy đầu để `taya-house` tắt đặt bàn và làm hỏng `catalogue.test.ts` chạy sau:

```ts
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { planDay } from '@/lib/booking/resolve-day';
import type { AuditActor } from '@/lib/server/audit';
import { findAffected } from '@/lib/server/booking/affected';
import {
  getRestaurantBooking,
  loadPeriods,
  overlappingPeriods,
  saveRestaurantRules,
  saveServicePeriods,
  type PeriodInput,
} from '@/lib/server/booking/config';
import { loadRestaurantRules } from '@/lib/server/booking/rules';
import { TEST_DATABASE_URL } from '../helpers/db';

/*
 * Spec §10.1: hours, capacity and the booking rules as staff edit them, each
 * save with its audit_log row and a concurrency token naming who saved
 * first; the bookings the new rules leave out are listed, never cancelled.
 */

let pool: Pool;
const ACTOR: AuditActor = { id: 'staff-lan', email: 'lan@furama.test', name: 'Lan' };
// Friday 2 Oct 2026, 10:00 in Vietnam.
const NOW = new Date('2026-10-02T10:00:00+07:00');

async function seed(over: { date?: string; time?: string; guests?: number; status?: string; restaurant?: string } = {}) {
  const phone = `+849051${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164, status, meal, source)
     VALUES ('FC-' || upper(substr(md5(random()::text), 1, 8)), $1, $2::date, $3, $4, 'Khách', $5, $5, $6,
             CASE WHEN $3 < '15:00' THEN 'Lunch' ELSE 'Dinner' END, 'web')
     RETURNING id::text`,
    [over.restaurant ?? 'taya-house', over.date ?? '2026-10-05', over.time ?? '19:00', over.guests ?? 2, phone, over.status ?? 'confirmed'],
  );
  return rows[0].id;
}

const audit = async () => (await pool.query('SELECT actor_id, action, entity_type, entity_id, before, after FROM audit_log ORDER BY id')).rows;
const periodsOf = () => loadPeriods(pool, 'taya-house');
const asInput = (list: Awaited<ReturnType<typeof periodsOf>>): PeriodInput[] => list.map(({ sortOrder: _sortOrder, ...p }) => p);
const token = async () => (await getRestaurantBooking(pool, 'taya-house'))!.token;
const dinnerTimes = async () =>
  planDay((await loadRestaurantRules(pool, 'taya-house', 'en', '2026-10-05'))!.rules, '2026-10-05')
    .periods.find((p) => p.meal === 'Dinner')!
    .slots.map((s) => `${s.time}/${s.capacity}`);

/** Migration 006's seed for Tàya House (Lunch and Dinner, 16 covers a slot), and every restaurant on its defaults. */
async function resetTaya() {
  await pool.query(`DELETE FROM service_periods WHERE restaurant_id = 'taya-house'`);
  await pool.query(
    `INSERT INTO service_periods (restaurant_id, meal, first_seating, last_seating, interval_min, covers_per_slot, sort_order)
     VALUES ('taya-house', 'Lunch', '11:30', '13:30', 30, 16, 20), ('taya-house', 'Dinner', '18:00', '21:00', 30, 16, 40)`,
  );
  await pool.query(`UPDATE restaurants SET booking_enabled = true, window_days = NULL, lead_minutes = NULL, max_party = NULL, auto_confirm = NULL`);
}

describe.skipIf(!TEST_DATABASE_URL)('booking configuration (database)', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });
  afterAll(async () => {
    // The next files read the catalogue and the rules as seeded.
    await resetTaya();
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE reservations, reservation_events, closures, audit_log CASCADE');
    await resetTaya();
    await pool.query(`DELETE FROM staff_user WHERE id = 'staff-lan'`);
  });

  describe('service periods', () => {
    it('an Editor shortens dinner and halves its capacity: the very next read has the new slots, and the audit row both lists', async () => {
      const before = await periodsOf();
      const input = asInput(before).map((p) => (p.meal === 'Dinner' ? { ...p, lastSeating: '20:00', coversPerSlot: 8 } : p));
      expect(await saveServicePeriods(pool, ACTOR, { restaurantId: 'taya-house', token: await token(), periods: input })).toEqual({ ok: true, data: null });
      expect(await dinnerTimes()).toEqual(['18:00/8', '18:30/8', '19:00/8', '19:30/8', '20:00/8']);
      const [row] = await audit();
      expect(row).toMatchObject({ actor_id: ACTOR.id, action: 'update', entity_type: 'service_periods', entity_id: 'taya-house' });
      expect(row.before.find((p: { meal: string }) => p.meal === 'Dinner')).toMatchObject({ lastSeating: '21:00', coversPerSlot: 16 });
      expect(row.after.find((p: { meal: string }) => p.meal === 'Dinner')).toMatchObject({ lastSeating: '20:00', coversPerSlot: 8 });
    });

    it('adds, removes and switches off periods in one save; the list keeps its order', async () => {
      const lunchOnly = asInput(await periodsOf()).filter((p) => p.meal === 'Lunch');
      const breakfast: PeriodInput = { id: null, meal: 'Breakfast', weekdays: [6, 7], firstSeating: '07:00', lastSeating: '09:00', intervalMin: 60, coversPerSlot: 10, active: true };
      const drinks: PeriodInput = { id: null, meal: 'Drinks', weekdays: [5], firstSeating: '20:00', lastSeating: '22:00', intervalMin: 60, coversPerSlot: 30, active: false };
      expect(await saveServicePeriods(pool, ACTOR, { restaurantId: 'taya-house', token: await token(), periods: [breakfast, ...lunchOnly, drinks] })).toMatchObject({ ok: true });
      expect((await periodsOf()).map((p) => [p.meal, p.weekdays, p.active, p.sortOrder])).toEqual([
        ['Breakfast', [6, 7], true, 10],
        ['Lunch', [1, 2, 3, 4, 5, 6, 7], true, 20],
        ['Drinks', [5], false, 30],
      ]);
      // The guest's rules see the active ones only.
      expect((await loadRestaurantRules(pool, 'taya-house', 'en', '2026-10-05'))!.rules.periods.map((p) => p.meal)).toEqual(['Breakfast', 'Lunch']);
    });

    it('a page saved from a stale token is a conflict naming who saved, and when', async () => {
      await pool.query(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ('staff-lan', 'Lan', 'lan@furama.test', true, 'editor')`);
      const stale = await token();
      const input = asInput(await periodsOf());
      expect(await saveServicePeriods(pool, ACTOR, { restaurantId: 'taya-house', token: stale, periods: input })).toMatchObject({ ok: true });
      const second = await saveServicePeriods(pool, ACTOR, { restaurantId: 'taya-house', token: stale, periods: input });
      expect(second).toMatchObject({ ok: false, code: 'conflict', params: { by: 'Lan' } });
      expect((second as { params: { at: string } }).params.at).toMatch(/^\d{2}:\d{2} \d{2}\/\d{2}\/\d{4}$/);
      // The rules form shares the token: a period save makes its page stale too.
      expect(await saveRestaurantRules(pool, ACTOR, { restaurantId: 'taya-house', token: stale, bookingEnabled: true, windowDays: null, leadMinutes: null, maxParty: null })).toMatchObject({
        ok: false,
        code: 'conflict',
      });
      expect(await audit()).toHaveLength(1);
      expect(await saveServicePeriods(pool, ACTOR, { restaurantId: 'nowhere', token: stale, periods: input })).toEqual({ ok: false, code: 'not_found' });
    });

    it('refuses two services that share a time on a shared weekday (capacity is per time)', async () => {
      const base: Omit<PeriodInput, 'meal' | 'firstSeating' | 'lastSeating'> = { id: null, weekdays: [1, 2, 3], intervalMin: 60, coversPerSlot: 10, active: true };
      const dinner = { ...base, meal: 'Dinner' as const, firstSeating: '18:00', lastSeating: '21:00' };
      const drinks = { ...base, meal: 'Drinks' as const, firstSeating: '21:00', lastSeating: '23:00' };
      expect(overlappingPeriods([dinner, drinks])).toBe('Dinner và Drinks cùng có giờ 21:00.');
      expect(overlappingPeriods([dinner, { ...drinks, weekdays: [4, 5] }])).toBeNull();
      expect(overlappingPeriods([dinner, { ...drinks, active: false }])).toBeNull();
      expect(await saveServicePeriods(pool, ACTOR, { restaurantId: 'taya-house', token: await token(), periods: [dinner, drinks] })).toEqual({
        ok: false,
        code: 'invalid',
        fieldErrors: { periods: ['Hai ca trùng giờ: Dinner và Drinks cùng có giờ 21:00.'] },
      });
    });
  });

  describe('affected bookings (rules)', () => {
    it('lists the upcoming bookings the new hours leave out, and cancels none of them', async () => {
      const late = await seed({ time: '21:00' });
      const lateRequest = await seed({ time: '21:00', status: 'requested' });
      const fine = await seed({ time: '19:00' });
      await seed({ time: '21:00', status: 'cancelled' });
      await seed({ time: '21:00', status: 'seated' });
      await seed({ time: '21:00', date: '2026-10-01' }); // already past
      const input = asInput(await periodsOf()).map((p) => (p.meal === 'Dinner' ? { ...p, lastSeating: '20:00' } : p));
      await saveServicePeriods(pool, ACTOR, { restaurantId: 'taya-house', token: await token(), periods: input });
      const affected = await findAffected(pool, { restaurantIds: ['taya-house'], now: NOW });
      expect(affected.map((a) => [a.id, a.kind])).toEqual([
        [late, 'outside_hours'],
        [lateRequest, 'outside_hours'],
      ]);
      expect(affected[0]).toMatchObject({ restaurantName: 'Tàya House', date: '2026-10-05', time: '21:00', status: 'confirmed', version: 1 });
      const { rows } = await pool.query(`SELECT status FROM reservations WHERE id = ANY ($1::bigint[]) ORDER BY id`, [[late, lateRequest, fine]]);
      expect(rows.map((x) => x.status)).toEqual(['confirmed', 'requested', 'confirmed']);
    });

    it('lists the bookings of a slot that now holds more covers than its new capacity', async () => {
      const a = await seed({ guests: 6 });
      const b = await seed({ guests: 4, status: 'requested' });
      await seed({ guests: 3, status: 'seated' }); // holds covers, but is the service's to settle
      const input = asInput(await periodsOf()).map((p) => (p.meal === 'Dinner' ? { ...p, coversPerSlot: 8 } : p));
      await saveServicePeriods(pool, ACTOR, { restaurantId: 'taya-house', token: await token(), periods: input });
      expect((await findAffected(pool, { now: NOW })).map((x) => [x.id, x.kind])).toEqual([
        [a, 'over_capacity'],
        [b, 'over_capacity'],
      ]);
    });

    it('lists the bookings a closure takes out, with the closure that does it', async () => {
      const dinner = await seed({ time: '19:00' });
      await seed({ time: '12:00' });
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO closures (scope, restaurant_id, starts_on, ends_on, meals) VALUES ('restaurant', 'taya-house', '2026-10-05', '2026-10-05', '{Dinner}') RETURNING id::text`,
      );
      expect((await findAffected(pool, { restaurantIds: ['taya-house'], now: NOW })).map((x) => [x.id, x.kind, x.closureId])).toEqual([[dinner, 'closed', rows[0].id]]);
    });
  });

  describe('rules', () => {
    it('saves the switch and the overrides (null follows the defaults), with an audit row', async () => {
      const r = await getRestaurantBooking(pool, 'taya-house');
      expect(r).toMatchObject({ bookingEnabled: true, windowDays: null, leadMinutes: null, maxParty: null, autoConfirm: null });
      expect(await saveRestaurantRules(pool, ACTOR, { restaurantId: 'taya-house', token: r!.token, bookingEnabled: false, windowDays: null, leadMinutes: 60, maxParty: 8 })).toEqual({
        ok: true,
        data: null,
      });
      expect(await getRestaurantBooking(pool, 'taya-house')).toMatchObject({ bookingEnabled: false, windowDays: null, leadMinutes: 60, maxParty: 8 });
      // The guest's rules: max_party 8, lead 60, the window still the default 14, online booking off.
      expect((await loadRestaurantRules(pool, 'taya-house', 'en', '2026-10-05'))!.rules).toMatchObject({ bookingEnabled: false, maxParty: 8, leadMinutes: 60, windowDays: 14 });
      expect((await audit()).map((a) => [a.entity_type, a.entity_id, a.before, a.after])).toEqual([
        [
          'restaurant_booking',
          'taya-house',
          { booking_enabled: true, window_days: null, lead_minutes: null, max_party: null },
          { booking_enabled: false, window_days: null, lead_minutes: 60, max_party: 8 },
        ],
      ]);
    });
  });
});
```

```diff
diff --git a/lib/admin/audit-labels.test.ts b/lib/admin/audit-labels.test.ts
index 2b7fd93..97cd0e9 100644
--- a/lib/admin/audit-labels.test.ts
+++ b/lib/admin/audit-labels.test.ts
@@ -52,4 +52,11 @@ describe('audit labels', () => {
       'Ngày đóng cửa',
     ]);
   });
+
+  it('names every configuration entity the booking screens write to audit_log', () => {
+    const config = readFileSync('lib/server/booking/config.ts', 'utf8');
+    const entities = [...new Set([...config.matchAll(/entityType: '([a-z_]+)'/g)].map((m) => m[1]))];
+    expect(entities).toContain('service_periods');
+    for (const entity of entities) expect(auditEntityLabel(entity)).not.toBe(entity);
+  });
 });
```

```diff
diff --git a/lib/admin/nav.test.ts b/lib/admin/nav.test.ts
index 7e5ad25..99061ff 100644
--- a/lib/admin/nav.test.ts
+++ b/lib/admin/nav.test.ts
@@ -3,7 +3,7 @@ import { navFor } from './nav';
 
 describe('navFor', () => {
   it('shows each role only what its permissions open', () => {
-    expect(navFor('admin').map((i) => i.label)).toEqual(['Tổng quan', 'Đặt bàn', 'Nhân viên', 'Nhật ký']);
-    expect(navFor('editor').map((i) => i.label)).toEqual(['Tổng quan', 'Đặt bàn']);
+    expect(navFor('admin').map((i) => i.label)).toEqual(['Tổng quan', 'Đặt bàn', 'Nhà hàng', 'Nhân viên', 'Nhật ký']);
+    expect(navFor('editor').map((i) => i.label)).toEqual(['Tổng quan', 'Đặt bàn', 'Nhà hàng']);
   });
 });
```

```diff
diff --git a/test/guards/require-permission.guard.test.ts b/test/guards/require-permission.guard.test.ts
index f9d2efb..a3f864c 100644
--- a/test/guards/require-permission.guard.test.ts
+++ b/test/guards/require-permission.guard.test.ts
@@ -55,6 +55,11 @@ const BOOKING_ACTIONS: Record<string, Record<string, { permission: object; edito
     updateReservation: { permission: { reservations: ['update'] }, editor: true },
     addNote: { permission: { reservations: ['note'] }, editor: true },
     createReservation: { permission: { reservations: ['create'] }, editor: true },
+    cancelReservations: { permission: { reservations: ['update'] }, editor: true },
+  },
+  'app/admin/(shell)/restaurants/[id]/booking/actions.ts': {
+    savePeriods: { permission: { schedule: ['update'] }, editor: true },
+    saveRules: { permission: { reservations: ['configure'] }, editor: true },
   },
 };
 
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/admin/booking-schemas.test.ts test/integration/booking-config.test.ts test/guards/require-permission.guard.test.ts lib/admin/nav.test.ts lib/admin/audit-labels.test.ts`
Expected: FAIL `Test Files  5 failed (5)`, `Tests  7 failed | 26 passed (33)`:

```
 FAIL  test/integration/booking-config.test.ts [ test/integration/booking-config.test.ts ]
Error: Cannot find package '@/lib/server/booking/affected' imported from …/test/integration/booking-config.test.ts
 FAIL  lib/admin/audit-labels.test.ts > audit labels > names every configuration entity the booking screens write to audit_log
Error: ENOENT: no such file or directory, open 'lib/server/booking/config.ts'
 FAIL  lib/admin/booking-schemas.test.ts > booking form schemas > overrides: a blank one follows the defaults; the switch is a checkbox; the window is 1–90 days like the database
TypeError: Cannot read properties of undefined (reading 'parse')
 FAIL  lib/admin/booking-schemas.test.ts > booking form schemas > service periods arrive as one JSON field, on the grid of their interval
 FAIL  lib/admin/booking-schemas.test.ts > booking form schemas > a batch cancel: ticked id:version pairs and a reason
 FAIL  lib/admin/nav.test.ts > navFor > shows each role only what its permissions open
AssertionError: expected [ 'Tổng quan', 'Đặt bàn', …(2) ] to deeply equal [ 'Tổng quan', 'Đặt bàn', …(3) ]
 FAIL  test/guards/require-permission.guard.test.ts > booking actions follow the permission matrix (spec §7.1) > app/admin/(shell)/reservations/actions.ts
AssertionError: expected [ 'addNote', 'changeStatus', …(2) ] to deeply equal [ 'addNote', …(4) ]
 FAIL  test/guards/require-permission.guard.test.ts > booking actions follow the permission matrix (spec §7.1) > app/admin/(shell)/restaurants/[id]/booking/actions.ts
Error: ENOENT: no such file or directory, open '…/app/admin/(shell)/restaurants/[id]/booking/actions.ts'
```

- [ ] **Bước 3: Viết E2E và project `desktop-serial`**

Create `e2e/admin-booking-config.spec.ts` (ca Dinner của Thai Siam Kitchen và quy tắc của Hura Izakaya: không spec nào khác đọc; mỗi test trả lại trong `finally`):

```ts
import type { Page } from '@playwright/test';
import { expectHydrated, watchCsp } from './csp';
import { HOME_PATH } from './paths';
import { reservationRow, seedReservation, venueDay } from './reservation-fixtures';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * "Giờ và sức chứa" (spec §10.1, §14.1 phase 4): an Editor changes the dinner
 * hours and capacity, the preview shows them in the same response and a guest
 * sees the new slots at once; a max_party override stops the guest's stepper;
 * the bookings new hours leave out are listed, and cancelled only when
 * ticked. Thai Siam Kitchen's periods and Hura Izakaya's rules: no other spec
 * reads them. Each test puts back what it changed.
 */

test.beforeAll(() => seedStaff());
test.use({ reducedMotion: 'reduce' }); // no reveal animation on the guest's booking bar

const SEED_DINNER = `UPDATE service_periods SET last_seating = '21:00', covers_per_slot = 22 WHERE restaurant_id = 'thai-siam-kitchen' AND meal = 'Dinner'`;
const CLEAR_AUDIT = `DELETE FROM audit_log WHERE entity_id IN ('thai-siam-kitchen', 'hura-izakaya')`;

/** The guest opens the drawer from a home-page card (a restaurant without its own page only reserves). */
async function openGuestDrawer(page: Page, name: string) {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  await page.goto(HOME_PATH);
  await page.locator('.rcard:visible', { hasText: name }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  return drawer;
}

test('an Editor moves the last dinner seating to 22:00 with 8 covers; the preview and the guest see it at once', async ({ page }) => {
  try {
    const violations = await watchCsp(page);
    await signInAs(page, STAFF.editor);
    await page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link', { name: 'Nhà hàng' }).click();
    await page.getByRole('row').filter({ hasText: 'Thai Siam Kitchen' }).getByRole('link', { name: 'Giờ và sức chứa' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Giờ và sức chứa · Thai Siam Kitchen');
    await page.goto(`/admin/restaurants/thai-siam-kitchen/booking?ngay=${venueDay(2)}`);
    await expectHydrated(page);
    const preview = page.getByLabel('Giờ đặt trong ngày', { exact: true });
    await expect(preview.getByText('21:00 · 22/22')).toBeVisible();
    await expect(preview.getByText(/^22:00/)).toHaveCount(0);

    const editor = page.getByRole('form', { name: 'Ca phục vụ' });
    await editor.getByLabel('Giờ cuối của ca Dinner', { exact: true }).fill('22:00');
    await editor.getByLabel('Sức chứa của ca Dinner', { exact: true }).fill('8');
    await editor.getByRole('button', { name: 'Lưu ca phục vụ' }).click();
    await expect(editor.getByRole('status')).toHaveText('Đã lưu ca phục vụ.');
    // updateTag re-rendered this page in the same response: the preview already has the new hours.
    await expect(preview.getByText('22:00 · 8/8')).toBeVisible();
    expect(
      await one(`SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'service_periods' AND entity_id = 'thai-siam-kitchen' AND actor_id = $1`, [
        STAFF.editor.id,
      ]),
    ).toEqual({ n: 1 });
    expect(violations).toEqual([]);

    // The guest, two days out: the new last sitting with its 8 covers.
    const drawer = await openGuestDrawer(page, 'Thai Siam Kitchen');
    await drawer.locator('.daystrip .day').nth(2).click();
    await expect(drawer.getByRole('button', { name: '22:00 — 8 covers left' })).toBeVisible();
  } finally {
    await one(SEED_DINNER);
    await one(CLEAR_AUDIT);
  }
});

test('a max_party override of 8 stops the guest’s stepper at 8, with the number to call', async ({ page }) => {
  try {
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/restaurants/hura-izakaya/booking');
    await expectHydrated(page);
    const rules = page.getByRole('form', { name: 'Quy tắc đặt bàn' });
    const maxParty = rules.getByLabel('Số khách tối đa', { exact: true });
    await expect(maxParty).toHaveAttribute('placeholder', '12 (mặc định)');
    await maxParty.fill('8');
    await rules.getByRole('button', { name: 'Lưu quy tắc' }).click();
    await expect(page.getByRole('form', { name: 'Quy tắc đặt bàn' }).getByRole('status')).toHaveText('Đã lưu.');
    await expect(page.getByRole('form', { name: 'Quy tắc đặt bàn' }).getByLabel('Số khách tối đa', { exact: true })).toHaveValue('8');

    const drawer = await openGuestDrawer(page, 'Hura Izakaya');
    const more = drawer.getByRole('button', { name: 'More guests' });
    for (let i = 2; i < 8; i++) await more.click();
    await expect(drawer.locator('.guests-value')).toHaveText('8 guests');
    await expect(more).toBeDisabled();
    await expect(drawer.locator('.guests-hint')).toHaveText('For more than 8 guests, please call us on 0859 555 759.');
  } finally {
    await one(`UPDATE restaurants SET max_party = NULL WHERE id = 'hura-izakaya'`);
    await one(CLEAR_AUDIT);
  }
});

test('shorter dinner hours list the bookings they leave out, and only the ticked one is cancelled', async ({ page }) => {
  const date = venueDay(3);
  const late = await seedReservation({ restaurant: 'thai-siam-kitchen', date, time: '21:00' });
  const early = await seedReservation({ restaurant: 'thai-siam-kitchen', date, time: '19:00', status: 'confirmed' });
  try {
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/restaurants/thai-siam-kitchen/booking');
    await expectHydrated(page);
    const editor = page.getByRole('form', { name: 'Ca phục vụ' });
    await editor.getByLabel('Giờ cuối của ca Dinner', { exact: true }).fill('20:00');
    await editor.getByRole('button', { name: 'Lưu ca phục vụ' }).click();
    await expect(editor.getByRole('status')).toHaveText('Đã lưu ca phục vụ.');

    const section = page.getByRole('region', { name: 'Đặt bàn sắp tới không còn khớp' });
    const list = section.getByRole('form', { name: 'Đặt bàn sắp tới không còn khớp giờ hoặc sức chứa' });
    await expect(list.getByRole('row').filter({ hasText: late.reference })).toContainText('Ngoài giờ phục vụ mới');
    await expect(list.getByRole('row').filter({ hasText: early.reference })).toHaveCount(0);
    // Listed, never cancelled on its own.
    expect((await reservationRow(late.id)).status).toBe('requested');

    await list.getByRole('checkbox', { name: `Chọn ${late.reference}` }).check();
    await list.getByLabel('Lý do hủy', { exact: true }).fill('Nhà hàng đóng bếp sớm');
    await list.getByRole('button', { name: 'Hủy các đặt bàn đã chọn' }).click();
    await expect(section.getByRole('status')).toHaveText('Đã hủy 1 đặt bàn.');
    await expect(section.getByRole('row').filter({ hasText: late.reference })).toHaveCount(0);
    expect(await reservationRow(late.id)).toMatchObject({ status: 'cancelled', status_reason: 'Nhà hàng đóng bếp sớm' });
    expect((await reservationRow(early.id)).status).toBe('confirmed');
    // The cancellation is a reservation event, the hours an audit row (spec §7.4).
    expect(await one(`SELECT count(*)::int AS n FROM reservation_events WHERE reservation_id = $1 AND to_status = 'cancelled'`, [late.id])).toEqual({ n: 1 });
  } finally {
    await one(SEED_DINNER);
    await one(CLEAR_AUDIT);
  }
});
```

Create `e2e/booking-switch.serial.spec.ts` (tắt Tàya House, nhà hàng mặc định có trang riêng duy nhất, và Hải Vân Lounge, một thẻ chỉ có đặt bàn; thanh tab của điện thoại kiểm bằng một context 390 px riêng; đây cũng là E2E còn thiếu của nhãn View/Reserve ở SearchOverlay, sổ đợt 2):

```ts
import type { Browser, Page } from '@playwright/test';
import { DETAIL_PATH, HOME_PATH } from './paths';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * restaurants.booking_enabled (spec §5.2; ruling R14). It switches off Tàya
 * House (the default restaurant, with the only detail page) and Hải Vân
 * Lounge (a card that only reserves), which every guest page reads, so this
 * file runs in the desktop-serial project, after every other spec. The admin
 * save expires the cached catalogue with updateTag('restaurants'); without it
 * the guest pages below would keep their RESERVE buttons.
 */

test.beforeAll(() => seedStaff());
test.afterAll(async () => {
  // Whatever happened above, leave both restaurants bookable in the database.
  await one(`UPDATE restaurants SET booking_enabled = true WHERE id IN ('taya-house', 'hai-van-lounge')`);
});

async function setOnline(page: Page, id: string, on: boolean) {
  await page.goto(`/admin/restaurants/${id}/booking`);
  const rules = page.getByRole('form', { name: 'Quy tắc đặt bàn' });
  await rules.getByRole('checkbox', { name: /^Nhận đặt bàn online/ }).setChecked(on);
  await rules.getByRole('button', { name: 'Lưu quy tắc' }).click();
  await expect(page.getByRole('form', { name: 'Quy tắc đặt bàn' }).getByRole('status')).toHaveText('Đã lưu.');
}

/** A guest with no staff cookie, past the intro. */
async function guest(browser: Browser, viewport = { width: 1280, height: 860 }) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

test('switching online booking off hides every RESERVE of that restaurant; on again brings them back', async ({ page, browser }) => {
  await signInAs(page, STAFF.editor);
  await setOnline(page, 'taya-house', false);
  await setOnline(page, 'hai-van-lounge', false);

  const home = await guest(browser);
  await home.goto(HOME_PATH);
  // Two of the three offers are theirs: only Café Indochine's keeps its button.
  await expect(home.getByRole('button', { name: /VIEW OFFER/ })).toHaveCount(1);
  // Hải Vân Lounge has no page, so its card only reserved: now it does nothing.
  const card = home.locator('.rcard', { hasText: 'Hải Vân Lounge' }).first();
  await expect(card.locator('.rcard-tag')).toHaveCount(0);
  await expect(card).toHaveAttribute('aria-disabled', 'true');
  // Search names no action for it; V-Senses Cafe still reserves (phase-2 ledger: the View/Reserve label).
  await home.locator('.hdr-full .hdr-link', { hasText: 'SEARCH' }).click();
  await home.locator('.search-chip', { hasText: 'Café & Lounge' }).click();
  await expect(home.locator('.search-result', { hasText: 'Hải Vân Lounge' }).locator('.search-result-action')).toHaveCount(0);
  await expect(home.locator('.search-result', { hasText: 'V-Senses Cafe' }).locator('.search-result-action')).toHaveText('Reserve →');
  await home.keyboard.press('Escape');
  // The generic RESERVE opens on the first bookable restaurant, and the list leaves both out.
  await home.getByRole('button', { name: 'RESERVE', exact: true }).first().click();
  const drawer = home.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.drawer-name')).toHaveText('Café Indochine');
  await drawer.locator('.dd').nth(1).locator('.dd-trigger').click();
  const names = await drawer.getByRole('listbox', { name: 'Restaurant' }).getByRole('option').allTextContents();
  expect(names.join('|')).not.toMatch(/Tàya House|Hải Vân Lounge/);
  expect(names).toHaveLength(4); // the resort's others: Café Indochine, Don Cipriani’s, Danaksara, V-Senses Cafe

  const detail = await guest(browser);
  await detail.goto(DETAIL_PATH);
  await expect(detail.locator('.taya-kicker')).toBeVisible();
  await expect(detail.getByRole('button', { name: /RESERVE A TABLE/ })).toHaveCount(0);

  const phone = await guest(browser, { width: 390, height: 844 });
  await phone.goto(DETAIL_PATH);
  const bar = phone.getByRole('navigation', { name: 'Restaurant actions' });
  await expect(bar.getByRole('button', { name: 'RESERVE' })).toHaveCount(0);
  await expect(bar).toHaveAttribute('style', /repeat\(3, minmax\(0, 1fr\)\)/); // CALL, MAP, MENU

  await setOnline(page, 'taya-house', true);
  await setOnline(page, 'hai-van-lounge', true);
  await detail.reload();
  await expect(detail.getByRole('button', { name: /RESERVE A TABLE/ })).toBeVisible();
  await home.reload();
  await expect(home.getByRole('button', { name: /VIEW OFFER/ })).toHaveCount(3);
  await expect(home.locator('.rcard', { hasText: 'Hải Vân Lounge' }).first().locator('.rcard-tag')).toHaveText('Reserve a table →');
  for (const p of [home, detail, phone]) await p.context().close();
});
```

`testIgnore` của một project thay `testIgnore` chung, nên mẫu `visual` được lặp lại:

```diff
diff --git a/playwright.config.ts b/playwright.config.ts
index b44225c..e4e3c92 100644
--- a/playwright.config.ts
+++ b/playwright.config.ts
@@ -60,7 +60,20 @@ export default defineConfig({
     trace: 'retain-on-failure',
   },
   projects: [
-    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } },
+    // A project's testIgnore replaces the top-level one, so the visual pattern is repeated here.
+    {
+      name: 'desktop',
+      testIgnore: [/\/visual[^/]*\.spec\.ts$/, /\.serial\.spec\.ts$/],
+      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } },
+    },
+    // Specs that change what every guest page reads (a restaurant's booking switch) run
+    // after all the others (spec files otherwise run in parallel workers).
+    {
+      name: 'desktop-serial',
+      testMatch: /\.serial\.spec\.ts$/,
+      dependencies: ['desktop'],
+      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } },
+    },
   ],
   webServer: external
     ? undefined
```

Menu của Editor thêm "Nhà hàng":

```diff
diff --git a/e2e/admin-acceptance.spec.ts b/e2e/admin-acceptance.spec.ts
index 3ba981b..932ab23 100644
--- a/e2e/admin-acceptance.spec.ts
+++ b/e2e/admin-acceptance.spec.ts
@@ -103,7 +103,7 @@ test('3. the Editor is kept out of the Admin area, including a direct POST to an
   const editor = await newVisitor(browser, testInfo);
   await signInAs(editor, invitee);
   // Phase 4 opens the booking screens to Editors (spec §7.1); the Admin area stays closed.
-  await expect(editor.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link')).toHaveText(['Tổng quan', 'Đặt bàn']);
+  await expect(editor.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link')).toHaveText(['Tổng quan', 'Đặt bàn', 'Nhà hàng']);
   const res = await editor.goto('/admin/users');
   expect(await res?.text()).not.toContain(STAFF.admin.email);
   await expect(editor.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible();
```

```diff
diff --git a/e2e/admin-users.spec.ts b/e2e/admin-users.spec.ts
index 4791a4c..b1dfb02 100644
--- a/e2e/admin-users.spec.ts
+++ b/e2e/admin-users.spec.ts
@@ -156,7 +156,7 @@ test('remove deletes the account, after a confirmation', async ({ page }) => {
 test('an Editor has no Nhân viên link, and /admin/users shows the 403 view with no staff data', async ({ page }) => {
   await signInAs(page, STAFF.editor);
   // Phase 4 opens the booking screens to Editors (spec §7.1); the Admin area stays closed.
-  await expect(page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link')).toHaveText(['Tổng quan', 'Đặt bàn']);
+  await expect(page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link')).toHaveText(['Tổng quan', 'Đặt bàn', 'Nhà hàng']);
   // Status 200, not 403: see app/admin/layout.tsx. What matters is what the response holds.
   const res = await page.goto('/admin/users');
   const body = (await res?.text()) ?? '';
```

- [ ] **Bước 4: Viết phần đọc và ghi cấu hình**

```diff
diff --git a/lib/booking/rules.ts b/lib/booking/rules.ts
index a368add..d47f7b2 100644
--- a/lib/booking/rules.ts
+++ b/lib/booking/rules.ts
@@ -15,6 +15,9 @@ export const HOLDING_STATUSES = ['requested', 'confirmed', 'seated'] as const;
 export const RESERVATION_STATUSES = ['requested', 'confirmed', 'seated', 'no_show', 'cancelled', 'declined'] as const;
 export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
 
+/** The gaps between seatings a service period may use (migration 006's CHECK on interval_min). */
+export const SLOT_INTERVALS = [15, 20, 30, 45, 60, 90, 120] as const;
+
 export type PeriodRule = {
   id: string;
   meal: Meal;
```

Token là `updated_at` tính bằng micro giây (chính xác; `Date` của JS chỉ giữ mili giây). Một token cho mỗi nhà hàng giữ cả form quy tắc lẫn trình sửa ca (R16). Create `lib/server/booking/config.ts`:

```ts
import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { formatDateTimeVi } from '@/lib/admin/format';
import { seatings } from '@/lib/booking/resolve-day';
import type { PeriodRule } from '@/lib/booking/rules';
import { insertAudit, withTransaction, type AuditActor } from '@/lib/server/audit';
import type { Db } from './rules';

/*
 * Booking configuration as staff edit it (spec §7.4 save flow): one
 * transaction with its audit_log row, optimistic concurrency on updated_at.
 * The token is updated_at in microseconds since the epoch, as text: exact,
 * where a JS Date keeps only milliseconds. One token per restaurant
 * (restaurants.updated_at) guards both its rules form and its periods editor
 * (R16). The Server Action expires the cache tags afterwards: 'restaurants'
 * and 'booking-rules:<id>' (spec §10.1). The guest-facing reads are in
 * rules.ts; these are the edit screens' own.
 */

/** A timestamptz column as the concurrency token. */
export const US = (column: string) => `(extract(epoch FROM ${column}) * 1000000)::bigint::text`;

type Conflict = { ok: false; code: 'conflict'; params: { by: string; at: string } };
type NotFound = { ok: false; code: 'not_found' };
type Invalid = { ok: false; code: 'invalid'; fieldErrors: Record<string, string[]> };

/** "Vừa được {tên} thay đổi lúc {giờ}": updated_by holds the staff id (spec §5.1.6). */
async function conflictBy(client: PoolClient, staffId: string | null, at: Date): Promise<Conflict> {
  const { rows } = staffId ? await client.query<{ name: string }>('SELECT name FROM staff_user WHERE id = $1', [staffId]) : { rows: [] };
  return { ok: false, code: 'conflict', params: { by: rows[0]?.name ?? 'người khác', at: formatDateTimeVi(at) } };
}

/** Locks the restaurant's row for the save and checks the page's token. */
async function lockRestaurant(client: PoolClient, id: string, token: string): Promise<NotFound | Conflict | null> {
  const { rows } = await client.query<{ token: string; updated_by: string | null; updated_at: Date }>(
    `SELECT ${US('updated_at')} AS token, updated_by, updated_at FROM restaurants WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!rows[0]) return { ok: false, code: 'not_found' };
  if (rows[0].token !== token) return conflictBy(client, rows[0].updated_by, rows[0].updated_at);
  return null;
}

// ── reads for the edit screens ──────────────────────────────────────────────

export type BookingSettings = {
  windowDays: number;
  leadMinutes: number;
  /** "HH:MM" or null. */
  sameDayCutoff: string | null;
  maxParty: number;
  autoConfirm: boolean;
  guestAckEmail: boolean;
  piiRetentionMonths: number;
  token: string;
};

export async function getBookingSettings(db: Db): Promise<BookingSettings> {
  const { rows } = await db.query<BookingSettings>(
    `SELECT window_days AS "windowDays", lead_minutes AS "leadMinutes", to_char(same_day_cutoff, 'HH24:MI') AS "sameDayCutoff",
            max_party AS "maxParty", auto_confirm AS "autoConfirm", guest_ack_email AS "guestAckEmail",
            pii_retention_months AS "piiRetentionMonths", ${US('updated_at')} AS token
       FROM booking_settings`,
  );
  if (!rows[0]) throw new Error('booking_settings has no row (migration 006 seeds it)');
  return rows[0];
}

export type RestaurantBooking = {
  id: string;
  name: string;
  destinationId: string;
  bookingEnabled: boolean;
  /** Overrides; null follows booking_settings. */
  windowDays: number | null;
  leadMinutes: number | null;
  maxParty: number | null;
  autoConfirm: boolean | null;
  token: string;
};

const RESTAURANT_COLUMNS = `id, name, destination AS "destinationId", booking_enabled AS "bookingEnabled",
  window_days AS "windowDays", lead_minutes AS "leadMinutes", max_party AS "maxParty",
  auto_confirm AS "autoConfirm", ${US('updated_at')} AS token`;

export async function listRestaurantBookings(db: Db): Promise<RestaurantBooking[]> {
  const { rows } = await db.query<RestaurantBooking>(`SELECT ${RESTAURANT_COLUMNS} FROM restaurants ORDER BY sort_order, id`);
  return rows;
}

export async function getRestaurantBooking(db: Db, id: string): Promise<RestaurantBooking | null> {
  const { rows } = await db.query<RestaurantBooking>(`SELECT ${RESTAURANT_COLUMNS} FROM restaurants WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/** Every period of one restaurant, switched off ones included, as the editor lists them. */
export type StoredPeriod = PeriodRule & { active: boolean };

export async function loadPeriods(db: Db, restaurantId: string): Promise<StoredPeriod[]> {
  const { rows } = await db.query<StoredPeriod>(
    `SELECT id::text, meal, weekdays::int[] AS weekdays,
            to_char(first_seating, 'HH24:MI') AS "firstSeating", to_char(last_seating, 'HH24:MI') AS "lastSeating",
            interval_min AS "intervalMin", covers_per_slot AS "coversPerSlot", active, sort_order AS "sortOrder"
       FROM service_periods
      WHERE restaurant_id = $1
      ORDER BY sort_order, first_seating, id`,
    [restaurantId],
  );
  return rows;
}

// ── service periods (schedule:update) ───────────────────────────────────────

export type PeriodInput = Omit<StoredPeriod, 'id' | 'sortOrder'> & { id: string | null };

/**
 * Within one restaurant a time belongs to one service on any weekday they
 * share (R6): capacity is kept per time, so a booking's slot must map to one
 * capacity and one meal. The first clash, or null.
 */
export function overlappingPeriods(periods: readonly PeriodInput[]): string | null {
  const active = periods.filter((p) => p.active);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const [a, b] = [active[i], active[j]];
      if (!a.weekdays.some((d) => b.weekdays.includes(d))) continue;
      const times = new Set(seatings(b));
      const shared = seatings(a).find((t) => times.has(t));
      if (shared) return `${a.meal} và ${b.meal} cùng có giờ ${shared}.`;
    }
  }
  return null;
}

/** Saves the whole list: periods left out are deleted, the rest updated or added, in the order given. */
export async function saveServicePeriods(
  pool: Pool,
  actor: AuditActor,
  input: { restaurantId: string; token: string; periods: PeriodInput[] },
): Promise<{ ok: true; data: null } | NotFound | Conflict | Invalid> {
  const overlap = overlappingPeriods(input.periods);
  if (overlap) return { ok: false, code: 'invalid', fieldErrors: { periods: [`Hai ca trùng giờ: ${overlap}`] } };
  return withTransaction(pool, async (client) => {
    const locked = await lockRestaurant(client, input.restaurantId, input.token);
    if (locked) return locked;
    const before = await loadPeriods(client, input.restaurantId);
    const known = new Set(before.map((p) => p.id));
    // An id this restaurant does not have: the page is older than a save that removed it.
    if (input.periods.some((p) => p.id !== null && !known.has(p.id))) {
      return { ok: false, code: 'conflict', params: { by: 'người khác', at: '' } } as const;
    }

    const keep = input.periods.flatMap((p) => (p.id ? [p.id] : []));
    await client.query('DELETE FROM service_periods WHERE restaurant_id = $1 AND NOT (id = ANY ($2::bigint[]))', [input.restaurantId, keep]);
    for (const [index, p] of input.periods.entries()) {
      const values = [p.meal, p.weekdays, p.firstSeating, p.lastSeating, p.intervalMin, p.coversPerSlot, p.active, (index + 1) * 10, actor.id];
      if (p.id) {
        await client.query(
          `UPDATE service_periods
              SET meal = $1, weekdays = $2::smallint[], first_seating = $3::time, last_seating = $4::time, interval_min = $5,
                  covers_per_slot = $6, active = $7, sort_order = $8, updated_by = $9, updated_at = now()
            WHERE id = $10 AND restaurant_id = $11`,
          [...values, p.id, input.restaurantId],
        );
      } else {
        await client.query(
          `INSERT INTO service_periods (meal, weekdays, first_seating, last_seating, interval_min, covers_per_slot, active, sort_order, updated_by, restaurant_id)
           VALUES ($1, $2::smallint[], $3::time, $4::time, $5, $6, $7, $8, $9, $10)`,
          [...values, input.restaurantId],
        );
      }
    }
    // The restaurant's token moves, so the rules form open elsewhere goes stale too.
    await client.query('UPDATE restaurants SET updated_at = now(), updated_by = $2 WHERE id = $1', [input.restaurantId, actor.id]);
    await insertAudit(client, actor, {
      action: 'update',
      entityType: 'service_periods',
      entityId: input.restaurantId,
      before,
      after: await loadPeriods(client, input.restaurantId),
    });
    return { ok: true, data: null } as const;
  });
}

// ── the booking switch and the overrides (reservations:configure) ───────────

export type RulesInput = {
  restaurantId: string;
  token: string;
  bookingEnabled: boolean;
  windowDays: number | null;
  leadMinutes: number | null;
  maxParty: number | null;
};

const rulesSnapshot = (r: RestaurantBooking | null) =>
  r && { booking_enabled: r.bookingEnabled, window_days: r.windowDays, lead_minutes: r.leadMinutes, max_party: r.maxParty };

export async function saveRestaurantRules(pool: Pool, actor: AuditActor, input: RulesInput): Promise<{ ok: true; data: null } | NotFound | Conflict> {
  return withTransaction(pool, async (client) => {
    const locked = await lockRestaurant(client, input.restaurantId, input.token);
    if (locked) return locked;
    const before = await getRestaurantBooking(client, input.restaurantId);
    await client.query(
      `UPDATE restaurants SET booking_enabled = $2, window_days = $3, lead_minutes = $4, max_party = $5, updated_at = now(), updated_by = $6
        WHERE id = $1`,
      [input.restaurantId, input.bookingEnabled, input.windowDays, input.leadMinutes, input.maxParty, actor.id],
    );
    await insertAudit(client, actor, {
      action: 'update',
      entityType: 'restaurant_booking',
      entityId: input.restaurantId,
      before: rulesSnapshot(before),
      after: rulesSnapshot(await getRestaurantBooking(client, input.restaurantId)),
    });
    return { ok: true, data: null } as const;
  });
}
```

Danh sách bị ảnh hưởng dùng `planDay`, `findPlannedSlot` và `closureApplies` của engine; số chỗ tính trên mọi trạng thái giữ chỗ, nhưng chỉ liệt kê `requested`/`confirmed` chưa tới giờ ngồi. Create `lib/server/booking/affected.ts`:

```ts
import 'server-only';
import type { Pool } from 'pg';
import { closureApplies, findPlannedSlot, planDay, type PlannedPeriod } from '@/lib/booking/resolve-day';
import type { BookingRules, ReservationStatus } from '@/lib/booking/rules';
import { UPCOMING_STATUSES } from '@/lib/reservations/lifecycle';
import { minutesUntil, venueNow, type IsoDate } from '@/lib/venue-time';
import { loadBookedCovers, loadBookingRules } from './rules';

/*
 * "Affected reservations" (spec §10.1): upcoming bookings (requested or
 * confirmed, sitting not started) that the rules as they are now leave out:
 * a closure takes out their service, the hours no longer include their time,
 * or their slot holds more covers (every holding status counts) than its new
 * capacity. Worked out with the engine's planDay and closureApplies, never
 * stored, and never acted on: staff tick and cancel.
 */

export type AffectedKind = 'closed' | 'outside_hours' | 'over_capacity';

export type AffectedReservation = {
  id: string;
  reference: string;
  restaurantId: string;
  restaurantName: string;
  date: IsoDate;
  time: string;
  guests: number;
  name: string;
  phone: string;
  status: ReservationStatus;
  version: number;
  kind: AffectedKind;
  /** For `closed`: the closure that takes the sitting out. */
  closureId: string | null;
};

type Row = Omit<AffectedReservation, 'kind' | 'closureId'>;

/** Staff screens never show a closure's public reason, so any language reads the same rules. */
const STAFF_LOCALE = 'vi';

/** The upcoming bookings in range whose sitting has not started yet. */
async function upcoming(pool: Pool, options: { restaurantIds?: readonly string[]; from: IsoDate; to?: IsoDate; now: Date }): Promise<Row[]> {
  const { rows } = await pool.query<Row>(
    `SELECT r.id::text, r.reference, r.restaurant_id AS "restaurantId", t.name AS "restaurantName",
            to_char(r.reserved_on, 'YYYY-MM-DD') AS date, r.reserved_at AS time, r.guests, r.guest_name AS name, r.phone,
            r.status, r.version
       FROM reservations r JOIN restaurants t ON t.id = r.restaurant_id
      WHERE r.status = ANY ($1::text[]) AND r.reserved_on >= $2::date
        AND ($3::date IS NULL OR r.reserved_on <= $3::date)
        AND ($4::text[] IS NULL OR r.restaurant_id = ANY ($4::text[]))
      ORDER BY r.reserved_on, r.reserved_at, r.id`,
    [UPCOMING_STATUSES, options.from, options.to ?? null, options.restaurantIds ? [...options.restaurantIds] : null],
  );
  // A sitting that has started is the service's to settle (seated, no-show), not a schedule problem.
  return rows.filter((r) => minutesUntil(r.date, r.time, options.now) >= 0);
}

/** One day's plan per restaurant and date, worked out once. */
function planner(rules: Map<string, { rules: BookingRules }>) {
  const plans = new Map<string, { periods: PlannedPeriod[] }>();
  return (restaurantId: string, date: IsoDate) => {
    const key = `${restaurantId}|${date}`;
    let plan = plans.get(key);
    if (!plan) {
      const loaded = rules.get(restaurantId);
      plan = loaded ? planDay(loaded.rules, date) : { periods: [] };
      plans.set(key, plan);
    }
    return plan;
  };
}

/** Every upcoming booking (of these restaurants, from..to) the current rules leave out. */
export async function findAffected(
  pool: Pool,
  options: { restaurantIds?: readonly string[]; from?: IsoDate; to?: IsoDate; now?: Date } = {},
): Promise<AffectedReservation[]> {
  const now = options.now ?? new Date();
  const from = options.from ?? venueNow(now).date;
  const rows = await upcoming(pool, { ...options, from, now });
  if (rows.length === 0) return [];

  const restaurantIds = [...new Set(rows.map((r) => r.restaurantId))];
  const last = rows[rows.length - 1].date;
  const [rules, covers] = await Promise.all([
    loadBookingRules(pool, restaurantIds, STAFF_LOCALE, from),
    Promise.all(restaurantIds.map(async (id) => [id, await loadBookedCovers(pool, id, from, last)] as const)),
  ]);
  const held = new Map(covers);
  const planOf = planner(rules);

  return rows.flatMap((row): AffectedReservation[] => {
    const loaded = rules.get(row.restaurantId);
    const hit = findPlannedSlot(planOf(row.restaurantId, row.date), row.time);
    if (!loaded || !hit) return [{ ...row, kind: 'outside_hours', closureId: null }];
    if (hit.period.closed) {
      // The closure planDay applied: a whole-day one first, else one of this meal.
      const reaching = loaded.rules.closures.filter((c) => closureApplies(c, loaded.rules, row.date));
      const closure = reaching.find((c) => c.meals === null) ?? reaching.find((c) => c.meals?.includes(hit.period.meal));
      return [{ ...row, kind: 'closed', closureId: closure?.id ?? null }];
    }
    const booked = held.get(row.restaurantId)?.[row.date]?.[row.time] ?? 0;
    return booked > hit.capacity ? [{ ...row, kind: 'over_capacity', closureId: null }] : [];
  });
}
```

```diff
diff --git a/lib/admin/booking-schemas.ts b/lib/admin/booking-schemas.ts
index e191d09..79578e4 100644
--- a/lib/admin/booking-schemas.ts
+++ b/lib/admin/booking-schemas.ts
@@ -1,6 +1,7 @@
-import { RESERVATION_STATUSES } from '@/lib/booking/rules';
+import { RESERVATION_STATUSES, SLOT_INTERVALS } from '@/lib/booking/rules';
+import { MEALS } from '@/lib/data';
 import { toE164 } from '@/lib/phone';
-import { isValidIsoDate } from '@/lib/venue-time';
+import { isValidIsoDate, toMinutes } from '@/lib/venue-time';
 import { z } from './zod';
 
 /*
@@ -15,6 +16,9 @@ const blankToNull = (v: unknown) => (v === undefined || (typeof v === 'string' &
 
 export const Id = z.string().regex(/^\d{1,18}$/);
 export const RestaurantId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
+/** A concurrency token: updated_at in microseconds since the epoch, as the page saw it. */
+export const Token = z.string().regex(/^\d{1,17}$/);
+export const Meal = z.enum(MEALS as [string, ...string[]]);
 export const Version = z.coerce.number().int().min(1);
 export const IsoDay = z.string().refine(isValidIsoDate, { error: 'Chọn một ngày hợp lệ.' });
 export const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'Chọn giờ (HH:MM).' });
@@ -60,3 +64,67 @@ export const NewReservationForm = z.object({
   locale: z.string().regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/, { error: 'Chọn ngôn ngữ của khách.' }),
   ...GuestFields,
 });
+
+/** "id:version" pairs ticked in an affected list, and why they are cancelled. */
+export const CancelManyForm = z.object({
+  items: z
+    .array(z.string().regex(/^\d{1,18}:\d{1,9}$/))
+    .min(1, { error: 'Chọn ít nhất một đặt bàn.' })
+    .max(200),
+  reason: z.string().trim().min(1, { error: 'Nhập lý do hủy.' }).max(500, { error: 'Lý do tối đa 500 ký tự.' }),
+});
+
+/** A per-restaurant override: blank follows "Cài đặt đặt bàn"; the bounds are migration 006's. */
+const override = (min: number, max: number, label: string) =>
+  z.preprocess(
+    blankToNull,
+    z.coerce
+      .number({ error: `${label}: nhập số.` })
+      .int({ error: `${label}: nhập số nguyên.` })
+      .min(min, { error: `${label}: từ ${min} đến ${max}.` })
+      .max(max, { error: `${label}: từ ${min} đến ${max}.` })
+      .nullable(),
+  );
+
+export const RulesForm = z.object({
+  restaurant: RestaurantId,
+  token: Token,
+  bookingEnabled: z.preprocess((v) => v === 'on', z.boolean()),
+  windowDays: override(1, 90, 'Số ngày đặt trước'),
+  leadMinutes: override(0, 1440, 'Đặt trước tối thiểu (phút)'),
+  maxParty: override(1, 50, 'Số khách tối đa'),
+});
+
+export const PeriodForm = z
+  .object({
+    id: z.preprocess(blankToNull, Id.nullable()),
+    meal: Meal,
+    weekdays: z.array(z.number().int().min(1).max(7)).min(1, { error: 'Chọn ít nhất một ngày trong tuần.' }).max(7),
+    firstSeating: Time,
+    lastSeating: Time,
+    intervalMin: z.number().refine((n) => (SLOT_INTERVALS as readonly number[]).includes(n), { error: 'Chọn khoảng cách giữa các giờ.' }),
+    coversPerSlot: z.number().int().min(0, { error: 'Sức chứa không âm.' }).max(1000, { error: 'Sức chứa tối đa 1000.' }),
+    active: z.boolean(),
+  })
+  .refine((p) => p.lastSeating >= p.firstSeating, { error: 'Giờ nhận khách cuối phải từ giờ đầu trở đi.', path: ['lastSeating'] })
+  // Without this the database's CHECK service_periods_grid would refuse the save as a db_error.
+  .refine(
+    (p) =>
+      p.lastSeating < p.firstSeating ||
+      !(SLOT_INTERVALS as readonly number[]).includes(p.intervalMin) ||
+      (toMinutes(p.lastSeating) - toMinutes(p.firstSeating)) % p.intervalMin === 0,
+    { error: 'Giờ cuối phải cách giờ đầu một số lần đúng bằng khoảng cách (ví dụ 18:00 → 21:00 với 30 phút).', path: ['lastSeating'] },
+  );
+
+/** The periods editor posts its whole list as one JSON field. At most 20 periods a restaurant. */
+export const PeriodsForm = z.object({
+  restaurant: RestaurantId,
+  token: Token,
+  periods: z.preprocess((v) => {
+    try {
+      return typeof v === 'string' ? JSON.parse(v) : v;
+    } catch {
+      return null;
+    }
+  }, z.array(PeriodForm).max(20, { error: 'Tối đa 20 ca phục vụ.' })),
+});
```

- [ ] **Bước 5: Chạy lại test**

Run: lệnh ở Bước 2.
Expected: PASS `Test Files  5 passed (5)`, `Tests  41 passed (41)`

- [ ] **Bước 6: Viết hủy hàng loạt và danh sách bị ảnh hưởng**

Mỗi đặt bàn được tích là một `transitionReservation` riêng (transaction và sự kiện riêng); đặt bàn đã đổi `version` từ lúc trang vẽ thì bị bỏ qua và đếm, không bao giờ ép:

```diff
diff --git a/app/admin/(shell)/reservations/actions.ts b/app/admin/(shell)/reservations/actions.ts
index ab1bddf..dbe8346 100644
--- a/app/admin/(shell)/reservations/actions.ts
+++ b/app/admin/(shell)/reservations/actions.ts
@@ -3,7 +3,7 @@
 import { refresh } from 'next/cache';
 import { redirect } from 'next/navigation';
 import { getPool } from '@/db/client';
-import { EditForm, NewReservationForm, NoteForm, TransitionForm } from '@/lib/admin/booking-schemas';
+import { CancelManyForm, EditForm, NewReservationForm, NoteForm, TransitionForm } from '@/lib/admin/booking-schemas';
 import type { ReservationStatus } from '@/lib/booking/rules';
 import { toE164 } from '@/lib/phone';
 import { actionError, type ActionResult } from '@/lib/server/action-result';
@@ -107,3 +107,30 @@ export async function createReservation(_prev: ActionResult | null, formData: Fo
     return actionError(err);
   }
 }
+
+export type CancelManyResult = { cancelled: number; skipped: number };
+
+/**
+ * "Hủy các đặt bàn đã chọn" under an affected list (spec §10.1): only what
+ * staff ticked, never automatic. Each booking is its own transition (its own
+ * transaction and event); one that changed since the list was drawn (its
+ * version) is skipped and counted, never forced.
+ */
+export async function cancelReservations(_prev: ActionResult<CancelManyResult> | null, formData: FormData): Promise<ActionResult<CancelManyResult>> {
+  try {
+    const staff = await requirePermission({ reservations: ['update'] });
+    const input = CancelManyForm.parse({ items: formData.getAll('item'), reason: field(formData, 'reason') });
+    const pool = getPool();
+    const actor = staffActor(staff);
+    let cancelled = 0;
+    for (const item of input.items) {
+      const [id, version] = item.split(':');
+      const result = await transitionReservation(pool, actor, { id, version: Number(version), to: 'cancelled', reason: input.reason, notifyGuest: false });
+      if (result.ok) cancelled += 1;
+    }
+    refresh();
+    return { ok: true, data: { cancelled, skipped: input.items.length - cancelled } };
+  } catch (err) {
+    return actionError(err);
+  }
+}
```

Create `app/admin/(shell)/_ui/AffectedList.tsx` (câu báo kết quả nằm ngoài nhánh danh sách rỗng, vì `refresh()` làm danh sách rỗng ngay sau khi hủy; spike gặp lỗi này trên DB mới):

```tsx
'use client';

import Link from 'next/link';
import { useActionState, useId } from 'react';
import type { ActionResult } from '@/lib/server/action-result';
import { cancelReservations, type CancelManyResult } from '../reservations/actions';
import { FieldError, FormMessage } from './FormMessage';

export type AffectedItem = {
  id: string;
  version: number;
  reference: string;
  restaurantName: string;
  dayLabel: string;
  time: string;
  guests: number;
  name: string;
  statusLabel: string;
  /** Why it is listed, in Vietnamese. */
  why: string;
};

/*
 * Bookings that new hours, a new capacity or a closure leave out (spec §10.1).
 * Nothing is ticked at first, and nothing is cancelled unless staff tick it,
 * write a reason and press the button: never automatic.
 */
export function AffectedList({ items, title }: { items: AffectedItem[]; title: string }) {
  const [state, action, pending] = useActionState<ActionResult<CancelManyResult> | null, FormData>(cancelReservations, null);
  const uid = useId();
  const done = state?.ok ? state.data : null;
  const notice = done ? (
    <p className="a-notice" role="status">
      {`Đã hủy ${done.cancelled} đặt bàn${done.skipped ? `; ${done.skipped} đặt bàn vừa thay đổi nên chưa hủy, hãy xem lại` : ''}.`}
    </p>
  ) : null;
  // The cancel re-renders the page (refresh()): once nothing is left the list goes, and the outcome stays.
  if (items.length === 0) {
    return (
      <div className="a-affected" role="group" aria-label={title}>
        {notice}
        <p className="a-muted">Không có đặt bàn nào bị ảnh hưởng.</p>
      </div>
    );
  }
  return (
    <form className="a-affected" action={action} aria-label={title}>
      <p className="a-warn">{`${items.length} đặt bàn bị ảnh hưởng. Hệ thống không tự hủy: chọn những đặt bàn cần hủy, ghi lý do rồi bấm Hủy.`}</p>
      <table className="a-table a-table--compact">
        <thead>
          <tr>
            <th scope="col">Chọn</th>
            <th scope="col">Mã</th>
            <th scope="col">Nhà hàng</th>
            <th scope="col">Ngày giờ</th>
            <th scope="col">Khách</th>
            <th scope="col">Trạng thái</th>
            <th scope="col">Lý do</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <input type="checkbox" name="item" value={`${item.id}:${item.version}`} aria-label={`Chọn ${item.reference}`} />
              </td>
              <td className="a-ref">
                <Link href={`/admin/reservations/${item.id}`}>{item.reference}</Link>
              </td>
              <td>{item.restaurantName}</td>
              <td>{`${item.dayLabel} ${item.time}`}</td>
              <td>{`${item.name} · ${item.guests}`}</td>
              <td>{item.statusLabel}</td>
              <td>{item.why}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="a-field">
        <label htmlFor={`${uid}-reason`}>Lý do hủy</label>
        <input id={`${uid}-reason`} name="reason" maxLength={500} aria-describedby={`${uid}-reason-error`} />
        <FieldError state={state} name="reason" id={`${uid}-reason-error`} />
        <FieldError state={state} name="items" id={`${uid}-items-error`} />
      </div>
      {notice ?? <FormMessage state={state && !state.ok ? state : null} />}
      <button className="a-btn a-btn--danger" type="submit" disabled={pending}>
        {pending ? 'Đang hủy…' : 'Hủy các đặt bàn đã chọn'}
      </button>
    </form>
  );
}
```

- [ ] **Bước 7: Viết hai action và các màn**

Create `app/admin/(shell)/restaurants/[id]/booking/actions.ts` (`updateTag` sau COMMIT; nó cũng render lại trang này trong cùng response, `node_modules/next/dist/docs/01-app/02-guides/server-actions.md:144-148`):

```ts
'use server';

import { updateTag } from 'next/cache';
import { getPool } from '@/db/client';
import { PeriodsForm, RulesForm } from '@/lib/admin/booking-schemas';
import { TAGS } from '@/lib/cache-tags';
import type { Meal } from '@/lib/data';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { saveRestaurantRules, saveServicePeriods } from '@/lib/server/booking/config';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * "Giờ và sức chứa" (spec §7.2, §10.1), Editor and Admin: the service periods
 * (schedule:update), and the booking switch with its overrides
 * (reservations:configure). After the commit every save expires the guest's
 * view of the restaurant: 'restaurants' (the cached catalogue: its meals and
 * bookingEnabled) and 'booking-rules:<id>' (spec §10.1; nothing reads under
 * it yet, R2). updateTag also re-renders this page in the same response
 * (node_modules/next/dist/docs/01-app/02-guides/server-actions.md:144-148).
 */

function expire(restaurantId: string) {
  updateTag(TAGS.restaurants);
  updateTag(TAGS.bookingRules(restaurantId));
}

export async function savePeriods(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ schedule: ['update'] });
    const input = PeriodsForm.parse({ restaurant: formData.get('restaurant'), token: formData.get('token'), periods: formData.get('periods') });
    const result = await saveServicePeriods(getPool(), auditActor(staff), {
      restaurantId: input.restaurant,
      token: input.token,
      periods: input.periods.map((p) => ({ ...p, meal: p.meal as Meal, weekdays: [...new Set(p.weekdays)].sort((a, b) => a - b) })),
    });
    if (!result.ok) return result;
    expire(input.restaurant);
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function saveRules(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ reservations: ['configure'] });
    const input = RulesForm.parse(Object.fromEntries(formData));
    const result = await saveRestaurantRules(getPool(), auditActor(staff), { ...input, restaurantId: input.restaurant });
    if (!result.ok) return result;
    expire(input.restaurant);
    return result;
  } catch (err) {
    return actionError(err);
  }
}
```

Create `app/admin/(shell)/restaurants/page.tsx`:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { DESTS, type DestKey } from '@/lib/data';
import { getBookingSettings, listRestaurantBookings } from '@/lib/server/booking/config';
import { requirePagePermission } from '@/lib/server/dal/session';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Nhà hàng' };

/* Phase 4 keeps this list to each restaurant's booking screen (R16); content editing arrives with phase 6. */
export default async function RestaurantsPage() {
  await requirePagePermission({ schedule: ['read'] });
  const pool = getPool();
  const [restaurants, settings] = await Promise.all([listRestaurantBookings(pool), getBookingSettings(pool)]);
  return (
    <>
      <h1>Nhà hàng</h1>
      <p className="a-lede">Giờ phục vụ, sức chứa và quy tắc đặt bàn của từng nhà hàng.</p>
      <table className="a-table">
        <thead>
          <tr>
            <th scope="col">Nhà hàng</th>
            <th scope="col">Điểm đến</th>
            <th scope="col">Đặt bàn online</th>
            <th scope="col">Khách tối đa</th>
            <th scope="col">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {restaurants.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{DESTS[r.destinationId as DestKey] ?? r.destinationId}</td>
              <td>{r.bookingEnabled ? 'Bật' : 'Tắt'}</td>
              <td>{r.maxParty ?? `${settings.maxParty} (mặc định)`}</td>
              <td>
                <Link href={`/admin/restaurants/${r.id}/booking`}>Giờ và sức chứa</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
```

Create `app/admin/(shell)/restaurants/[id]/booking/RulesForm.tsx` (`key={r.token}` trên `<form>`: lưu ở đây hay ở trình sửa ca đều đổi token):

```tsx
'use client';

import { useActionState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import { FieldError, FormMessage } from '../../../_ui/FormMessage';
import { saveRules } from './actions';

type Rules = { id: string; token: string; bookingEnabled: boolean; windowDays: number | null; leadMinutes: number | null; maxParty: number | null };
type Defaults = { windowDays: number; leadMinutes: number; maxParty: number };

/* The booking switch and the overrides; a blank override follows "Cài đặt đặt bàn". */
export function RulesForm({ restaurant: r, defaults }: { restaurant: Rules; defaults: Defaults }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveRules, null);
  const err = (name: string) => `booking-rules-${name}-error`;
  return (
    // key: a save (here or in the periods editor) moves the token; the inputs take the saved values, the hook state stays.
    <form className="a-grid-form" onSubmit={submitKeepingValues(action)} key={r.token} noValidate aria-label="Quy tắc đặt bàn">
      <input type="hidden" name="restaurant" value={r.id} />
      <input type="hidden" name="token" value={r.token} />
      <FormMessage state={state} success="Đã lưu." />
      <label className="a-check a-field--wide">
        <input type="checkbox" name="bookingEnabled" defaultChecked={r.bookingEnabled} />
        Nhận đặt bàn online (tắt thì ẩn nút RESERVE và bỏ nhà hàng khỏi form đặt bàn của khách)
      </label>
      <div className="a-field">
        <label htmlFor="booking-rules-window">Số ngày đặt trước</label>
        <input
          id="booking-rules-window"
          name="windowDays"
          type="number"
          min={1}
          max={90}
          defaultValue={r.windowDays ?? ''}
          placeholder={`${defaults.windowDays} (mặc định)`}
          aria-describedby={err('windowDays')}
        />
        <FieldError state={state} name="windowDays" id={err('windowDays')} />
      </div>
      <div className="a-field">
        <label htmlFor="booking-rules-lead">Đặt trước tối thiểu (phút)</label>
        <input
          id="booking-rules-lead"
          name="leadMinutes"
          type="number"
          min={0}
          max={1440}
          defaultValue={r.leadMinutes ?? ''}
          placeholder={`${defaults.leadMinutes} (mặc định)`}
          aria-describedby={err('leadMinutes')}
        />
        <FieldError state={state} name="leadMinutes" id={err('leadMinutes')} />
      </div>
      <div className="a-field">
        <label htmlFor="booking-rules-party">Số khách tối đa</label>
        <input
          id="booking-rules-party"
          name="maxParty"
          type="number"
          min={1}
          max={50}
          defaultValue={r.maxParty ?? ''}
          placeholder={`${defaults.maxParty} (mặc định)`}
          aria-describedby={err('maxParty')}
        />
        <FieldError state={state} name="maxParty" id={err('maxParty')} />
      </div>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang lưu…' : 'Lưu quy tắc'}
      </button>
    </form>
  );
}
```

Create `app/admin/(shell)/restaurants/[id]/booking/PeriodsEditor.tsx` (danh sách là state của client, gửi thành một ô JSON; token mới thì lấy lại danh sách ngay trong render, để không mất trạng thái "Đã lưu ca phục vụ."):

```tsx
'use client';

import { useActionState, useState } from 'react';
import { SLOT_INTERVALS } from '@/lib/booking/rules';
import type { ActionResult } from '@/lib/server/action-result';
import { FieldError, FormMessage } from '../../../_ui/FormMessage';
import { savePeriods } from './actions';

export type PeriodRow = {
  id: string | null;
  meal: string;
  weekdays: number[];
  firstSeating: string;
  lastSeating: string;
  intervalMin: number;
  coversPerSlot: number;
  active: boolean;
};

const WEEKDAYS: [number, string][] = [
  [1, 'T2'],
  [2, 'T3'],
  [3, 'T4'],
  [4, 'T5'],
  [5, 'T6'],
  [6, 'T7'],
  [7, 'CN'],
];

/*
 * The list is client state; the form posts it as one JSON field, which the
 * action parses with zod (PeriodsForm). A save replaces the restaurant's
 * periods in one transaction, guarded by the page's token.
 */
export function PeriodsEditor({ restaurantId, token, meals, periods }: { restaurantId: string; token: string; meals: string[]; periods: PeriodRow[] }) {
  const [rows, setRows] = useState<PeriodRow[]>(periods);
  const [shownToken, setShownToken] = useState(token);
  // A save re-renders the page with a new token: take the saved rows (new ids included) during
  // render, not in an effect, and keep the action's "Đã lưu" state (a key would remount and lose it).
  if (token !== shownToken) {
    setShownToken(token);
    setRows(periods);
  }
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(savePeriods, null);
  const update = (i: number, patch: Partial<PeriodRow>) => setRows((list) => list.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  // zod reports a period's field as periods.<i>.<field>; show those beside the list.
  const rowErrors = Object.entries(state && !state.ok ? (state.fieldErrors ?? {}) : {}).filter(([key]) => key !== 'periods');

  return (
    <form action={action} aria-label="Ca phục vụ">
      <input type="hidden" name="restaurant" value={restaurantId} />
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="periods" value={JSON.stringify(rows)} />
      <FormMessage state={state} success="Đã lưu ca phục vụ." />
      <FieldError state={state} name="periods" id="booking-periods-error" />
      {rowErrors.length ? (
        <p className="a-field-error" role="alert">
          {rowErrors.map(([, m]) => m?.[0]).join(' ')}
        </p>
      ) : null}
      <table className="a-table a-table--compact a-periods">
        <thead>
          <tr>
            <th scope="col">Bữa</th>
            <th scope="col">Ngày trong tuần</th>
            <th scope="col">Giờ đầu</th>
            <th scope="col">Giờ cuối</th>
            <th scope="col">Cách nhau</th>
            <th scope="col">Khách mỗi khung giờ</th>
            <th scope="col">Bật</th>
            <th scope="col">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? `new-${i}`}>
              <td>
                <select aria-label={`Bữa của ca ${i + 1}`} value={row.meal} onChange={(e) => update(i, { meal: e.currentTarget.value })}>
                  {meals.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                {WEEKDAYS.map(([d, label]) => (
                  <label className="a-check a-check--day" key={d}>
                    <input
                      type="checkbox"
                      checked={row.weekdays.includes(d)}
                      onChange={(e) =>
                        update(i, { weekdays: e.currentTarget.checked ? [...row.weekdays, d].sort((a, b) => a - b) : row.weekdays.filter((x) => x !== d) })
                      }
                    />
                    {label}
                  </label>
                ))}
              </td>
              <td>
                <input
                  aria-label={`Giờ đầu của ca ${row.meal}`}
                  type="time"
                  step={300}
                  value={row.firstSeating}
                  onChange={(e) => update(i, { firstSeating: e.currentTarget.value })}
                />
              </td>
              <td>
                <input
                  aria-label={`Giờ cuối của ca ${row.meal}`}
                  type="time"
                  step={300}
                  value={row.lastSeating}
                  onChange={(e) => update(i, { lastSeating: e.currentTarget.value })}
                />
              </td>
              <td>
                <select aria-label={`Khoảng cách của ca ${row.meal}`} value={row.intervalMin} onChange={(e) => update(i, { intervalMin: Number(e.currentTarget.value) })}>
                  {SLOT_INTERVALS.map((n) => (
                    <option key={n} value={n}>{`${n} phút`}</option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  aria-label={`Sức chứa của ca ${row.meal}`}
                  type="number"
                  min={0}
                  max={1000}
                  value={row.coversPerSlot}
                  onChange={(e) => update(i, { coversPerSlot: e.currentTarget.valueAsNumber || 0 })}
                />
              </td>
              <td>
                <input aria-label={`Bật ca ${row.meal}`} type="checkbox" checked={row.active} onChange={(e) => update(i, { active: e.currentTarget.checked })} />
              </td>
              <td>
                <button className="a-btn a-btn--ghost a-btn--small" type="button" onClick={() => setRows((list) => list.filter((_, j) => j !== i))}>
                  Xóa
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="a-actions">
        <button
          className="a-btn a-btn--ghost"
          type="button"
          onClick={() =>
            setRows((list) => [
              ...list,
              { id: null, meal: meals[0], weekdays: [1, 2, 3, 4, 5, 6, 7], firstSeating: '18:00', lastSeating: '21:00', intervalMin: 30, coversPerSlot: 20, active: true },
            ])
          }
        >
          Thêm ca
        </button>
        <button className="a-btn" type="submit" disabled={pending}>
          {pending ? 'Đang lưu…' : 'Lưu ca phục vụ'}
        </button>
      </div>
    </form>
  );
}
```

Create `app/admin/(shell)/restaurants/[id]/booking/page.tsx` (bản xem trước là `planDay` cộng số chỗ đang giữ, góc nhìn của nhân viên):

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPool } from '@/db/client';
import { formatIsoDayVi } from '@/lib/admin/format';
import { planDay } from '@/lib/booking/resolve-day';
import { MEALS } from '@/lib/data';
import { STATUS_LABELS } from '@/lib/reservations/lifecycle';
import { findAffected, type AffectedKind } from '@/lib/server/booking/affected';
import { getBookingSettings, getRestaurantBooking, loadPeriods } from '@/lib/server/booking/config';
import { loadBookedCovers, loadRestaurantRules } from '@/lib/server/booking/rules';
import { requirePagePermission } from '@/lib/server/dal/session';
import { isValidIsoDate, venueNow } from '@/lib/venue-time';
import { AffectedList } from '../../../_ui/AffectedList';
import { PeriodsEditor } from './PeriodsEditor';
import { RulesForm } from './RulesForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Giờ và sức chứa' };

const WHY: Record<AffectedKind, string> = {
  closed: 'Rơi vào ngày đóng cửa',
  outside_hours: 'Ngoài giờ phục vụ mới',
  over_capacity: 'Khung giờ vượt sức chứa mới',
};

export default async function RestaurantBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ngay?: string | string[] }>;
}) {
  await requirePagePermission({ schedule: ['read'] });
  const [{ id }, { ngay }] = await Promise.all([params, searchParams]);
  const pool = getPool();
  const restaurant = await getRestaurantBooking(pool, id);
  if (!restaurant) notFound();
  const previewDate = typeof ngay === 'string' && isValidIsoDate(ngay) ? ngay : venueNow().date;
  const [settings, periods, loaded, booked, affected] = await Promise.all([
    getBookingSettings(pool),
    loadPeriods(pool, id),
    loadRestaurantRules(pool, id, 'vi', previewDate),
    loadBookedCovers(pool, id, previewDate, previewDate),
    findAffected(pool, { restaurantIds: [id] }),
  ]);
  // The preview is the staff view of the day (planDay: no clock, no window, no switch) with the covers held now.
  const preview = loaded ? planDay(loaded.rules, previewDate) : { periods: [] };
  const held = booked[previewDate] ?? {};

  return (
    <>
      <p className="a-crumbs">
        <Link href="/admin/restaurants">← Nhà hàng</Link>
      </p>
      <h1>{`Giờ và sức chứa · ${restaurant.name}`}</h1>
      <p className="a-lede">Lưu xong, khách thấy giờ và chỗ mới ở lần mở form tiếp theo.</p>

      <section aria-labelledby="booking-rules-title">
        <h2 id="booking-rules-title">Đặt bàn online</h2>
        <RulesForm
          restaurant={{
            id: restaurant.id,
            token: restaurant.token,
            bookingEnabled: restaurant.bookingEnabled,
            windowDays: restaurant.windowDays,
            leadMinutes: restaurant.leadMinutes,
            maxParty: restaurant.maxParty,
          }}
          defaults={{ windowDays: settings.windowDays, leadMinutes: settings.leadMinutes, maxParty: settings.maxParty }}
        />
      </section>

      <section aria-labelledby="booking-periods-title">
        <h2 id="booking-periods-title">Ca phục vụ</h2>
        <PeriodsEditor
          restaurantId={restaurant.id}
          token={restaurant.token}
          meals={[...MEALS]}
          periods={periods.map(({ sortOrder: _sortOrder, ...p }) => p)}
        />
      </section>

      <section aria-labelledby="booking-affected-title">
        <h2 id="booking-affected-title">Đặt bàn sắp tới không còn khớp</h2>
        <AffectedList
          title="Đặt bàn sắp tới không còn khớp giờ hoặc sức chứa"
          items={affected.map((a) => ({
            id: a.id,
            version: a.version,
            reference: a.reference,
            restaurantName: a.restaurantName,
            dayLabel: formatIsoDayVi(a.date),
            time: a.time,
            guests: a.guests,
            name: a.name,
            statusLabel: STATUS_LABELS[a.status],
            why: WHY[a.kind],
          }))}
        />
      </section>

      <section aria-labelledby="booking-preview-title">
        <h2 id="booking-preview-title">Xem trước giờ đặt</h2>
        <form className="a-filter" action={`/admin/restaurants/${id}/booking`}>
          <div className="a-field">
            <label htmlFor="booking-preview-date">Ngày</label>
            <input id="booking-preview-date" name="ngay" type="date" defaultValue={previewDate} />
          </div>
          <button className="a-btn a-btn--ghost" type="submit">
            Xem
          </button>
        </form>
        <p className="a-muted">{`${formatIsoDayVi(previewDate)}${restaurant.bookingEnabled ? '' : ' · đặt bàn online đang tắt'}`}</p>
        <div className="a-preview" role="group" aria-label="Giờ đặt trong ngày">
          {preview.periods.map((p) => (
            <div key={p.periodId}>
              <h3>{`${p.meal}${p.closed ? ' · đóng cửa' : ''}`}</h3>
              <ul className="a-chips">
                {p.slots.map((slot) => {
                  const left = Math.max(0, slot.capacity - (held[slot.time] ?? 0));
                  return (
                    <li key={slot.time} className={!p.closed && left > 0 ? 'a-chip' : 'a-chip a-chip--off'}>
                      {`${slot.time} · ${left}/${slot.capacity}`}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {preview.periods.length === 0 ? <p className="a-muted">Không có ca nào vào thứ này.</p> : null}
        </div>
      </section>
    </>
  );
}
```

```diff
diff --git a/lib/admin/nav.ts b/lib/admin/nav.ts
index 2e710b9..3fc9dcb 100644
--- a/lib/admin/nav.ts
+++ b/lib/admin/nav.ts
@@ -10,6 +10,7 @@ export type NavItem = { href: string; label: string; permission?: Permissions };
 export const ADMIN_NAV: readonly NavItem[] = [
   { href: '/admin', label: 'Tổng quan' },
   { href: '/admin/reservations', label: 'Đặt bàn', permission: { reservations: ['read'] } },
+  { href: '/admin/restaurants', label: 'Nhà hàng', permission: { schedule: ['read'] } },
   { href: '/admin/users', label: 'Nhân viên', permission: { user: ['list'] } },
   { href: '/admin/audit', label: 'Nhật ký', permission: { audit: ['read'] } },
 ];
```

```diff
diff --git a/styles/admin.css b/styles/admin.css
index 00e6f6c..09ec7f3 100644
--- a/styles/admin.css
+++ b/styles/admin.css
@@ -717,3 +717,47 @@ fieldset.a-field legend {
     text-decoration: none;
   }
 }
+
+.a-check--day {
+  margin-right: 8px;
+  font-size: 13px;
+}
+
+.a-periods input[type='time'],
+.a-periods input[type='number'] {
+  min-height: 34px;
+  padding: 0 6px;
+  border: 1px solid var(--a-line);
+  border-radius: 6px;
+  font: inherit;
+}
+
+.a-periods input[type='number'] {
+  width: 80px;
+}
+
+.a-chips {
+  display: flex;
+  flex-wrap: wrap;
+  gap: 6px;
+  margin: 0 0 12px;
+  padding: 0;
+  list-style: none;
+}
+
+.a-chip {
+  padding: 4px 10px;
+  border: 1px solid var(--a-brand);
+  border-radius: 999px;
+  font-size: 13px;
+}
+
+.a-chip--off {
+  border-color: var(--a-line);
+  color: var(--a-ink-soft);
+  text-decoration: line-through;
+}
+
+.a-affected .a-table {
+  margin-bottom: 12px;
+}
```

- [ ] **Bước 8: Ẩn RESERVE của nhà hàng đã tắt đặt bàn (R14)**

Nút RESERVE chung vẫn còn và mở drawer trên nhà hàng đặt được (Task 6). Thẻ không có trang riêng mà tắt đặt bàn thì không còn hành động: `openRestaurant` không mở drawer cho nó.

```diff
diff --git a/components/detail/TayaHero.tsx b/components/detail/TayaHero.tsx
index 787ea5a..b57c0f3 100644
--- a/components/detail/TayaHero.tsx
+++ b/components/detail/TayaHero.tsx
@@ -47,13 +47,16 @@ export function TayaHero({ slug }: { slug: string }) {
             </p>
 
             <div className="taya-actions" data-intro="5">
-              <button
-                type="button"
-                className="btn-slab taya-reserve"
-                onClick={() => openReserve({ restaurant: restaurant?.id ?? slug })}
-              >
-                RESERVE A TABLE<span className="arrow">→</span>
-              </button>
+              {/* restaurants.booking_enabled off: no RESERVE (spec §5.2). */}
+              {restaurant?.bookingEnabled && (
+                <button
+                  type="button"
+                  className="btn-slab taya-reserve"
+                  onClick={() => openReserve({ restaurant: restaurant.id })}
+                >
+                  RESERVE A TABLE<span className="arrow">→</span>
+                </button>
+              )}
               {contact.tel && (
                 <a href={`tel:${contact.tel}`} className="taya-link">
                   CALL
```

```diff
diff --git a/components/site/MobileBar.tsx b/components/site/MobileBar.tsx
index 7959141..65fd639 100644
--- a/components/site/MobileBar.tsx
+++ b/components/site/MobileBar.tsx
@@ -15,8 +15,9 @@ export function MobileBar({ slug }: { slug?: string }) {
     const restaurant = restaurants.find((r) => r.slug === slug);
     const id = restaurant?.id ?? slug;
     const contact = contactFor(restaurant?.dest);
-    // One column per button shown (spec §6.4): MENU and RESERVE always, CALL and MAP when known.
-    const columns = 2 + (contact.tel ? 1 : 0) + (contact.map ? 1 : 0);
+    const canReserve = restaurant?.bookingEnabled ?? false;
+    // One column per button shown (spec §6.4): MENU always; RESERVE when it books online; CALL and MAP when known.
+    const columns = 1 + (canReserve ? 1 : 0) + (contact.tel ? 1 : 0) + (contact.map ? 1 : 0);
     return (
       <nav
         className="tabbar tabbar-detail"
@@ -32,16 +33,18 @@ export function MobileBar({ slug }: { slug?: string }) {
         <button type="button" onClick={() => openMenuPdf(() => scrollToId('dishes'))}>
           MENU
         </button>
-        <button
-          type="button"
-          className="tabbar-primary"
-          onClick={() => {
-            setBooking({ restaurant: id });
-            openReserve({ restaurant: id });
-          }}
-        >
-          RESERVE
-        </button>
+        {canReserve && (
+          <button
+            type="button"
+            className="tabbar-primary"
+            onClick={() => {
+              setBooking({ restaurant: id });
+              openReserve({ restaurant: id });
+            }}
+          >
+            RESERVE
+          </button>
+        )}
       </nav>
     );
   }
```

```diff
diff --git a/components/home/Offers.tsx b/components/home/Offers.tsx
index 5ca1cac..1b99b89 100644
--- a/components/home/Offers.tsx
+++ b/components/home/Offers.tsx
@@ -32,21 +32,25 @@ export function Offers() {
 }
 
 function OfferCard({ offer }: { offer: Offer }) {
-  const { openReserve } = useSite();
+  const { bookable, openReserve } = useSite();
   const ref = useReveal<HTMLDivElement>('up');
+  // An offer's only action is reserving at its restaurant: none while that restaurant books offline.
+  const canReserve = bookable.some((r) => r.id === offer.restaurant);
 
   return (
     <div ref={ref} data-reveal="up" className="offer">
       <div className="offer-venue">{offer.venue}</div>
       <div className="offer-title">{offer.title}</div>
       <div className="offer-detail">{offer.detail}</div>
-      <button
-        type="button"
-        className="offer-cta"
-        onClick={() => openReserve({ restaurant: offer.restaurant }, offer.note)}
-      >
-        VIEW OFFER<span>→</span>
-      </button>
+      {canReserve && (
+        <button
+          type="button"
+          className="offer-cta"
+          onClick={() => openReserve({ restaurant: offer.restaurant }, offer.note)}
+        >
+          VIEW OFFER<span>→</span>
+        </button>
+      )}
     </div>
   );
 }
```

```diff
diff --git a/components/home/RestaurantCard.tsx b/components/home/RestaurantCard.tsx
index beb18d7..d727be2 100644
--- a/components/home/RestaurantCard.tsx
+++ b/components/home/RestaurantCard.tsx
@@ -12,7 +12,8 @@ import { useReveal } from '@/lib/motion';
 export function RestaurantCard({ restaurant, hidden }: { restaurant: Restaurant; hidden?: boolean }) {
   const { openRestaurant } = useSite();
   const ref = useReveal<HTMLButtonElement>('card');
-  const isDetailLink = restaurant.hasDetailPage;
+  // A card without a page only reserves: with online booking off it has no action (R14).
+  const tag = restaurant.hasDetailPage ? 'View restaurant' : restaurant.bookingEnabled ? 'Reserve a table' : null;
 
   return (
     <button
@@ -21,6 +22,7 @@ export function RestaurantCard({ restaurant, hidden }: { restaurant: Restaurant;
       type="button"
       className="rcard"
       hidden={hidden}
+      aria-disabled={tag ? undefined : true}
       onClick={() => openRestaurant(restaurant)}
     >
       <span className="rcard-frame frame" data-reveal-img="1">
@@ -33,7 +35,7 @@ export function RestaurantCard({ restaurant, hidden }: { restaurant: Restaurant;
             className="rcard-img"
           />
         </span>
-        <span className="rcard-tag">{isDetailLink ? 'View restaurant' : 'Reserve a table'} →</span>
+        {tag && <span className="rcard-tag">{tag} →</span>}
       </span>
       <span className="rcard-name">{restaurant.name}</span>
       <span className="rcard-type">{restaurant.type}</span>
```

```diff
diff --git a/components/overlays/SearchOverlay.tsx b/components/overlays/SearchOverlay.tsx
index 01156af..35189cb 100644
--- a/components/overlays/SearchOverlay.tsx
+++ b/components/overlays/SearchOverlay.tsx
@@ -91,9 +91,11 @@ export function SearchOverlay() {
                     <span className="search-result-name">{r.name}</span>
                     <span className="search-result-meta">{`${r.type} · ${DESTS[r.dest]}`}</span>
                   </span>
-                  <span className="search-result-action">
-                    {r.hasDetailPage ? 'View' : 'Reserve'} →
-                  </span>
+                  {(r.hasDetailPage || r.bookingEnabled) && (
+                    <span className="search-result-action">
+                      {r.hasDetailPage ? 'View' : 'Reserve'} →
+                    </span>
+                  )}
                 </button>
               ))}
             </div>
```

```diff
diff --git a/components/site/SiteProvider.tsx b/components/site/SiteProvider.tsx
index 697206f..138d6c0 100644
--- a/components/site/SiteProvider.tsx
+++ b/components/site/SiteProvider.tsx
@@ -404,7 +404,8 @@ export function SiteProvider({
   const openRestaurant = useCallback(
     (r: Restaurant) => {
       if (!r.hasDetailPage) {
-        openReserve({ restaurant: r.id });
+        // Its only action is reserving; with online booking off there is none (R14).
+        if (r.bookingEnabled) openReserve({ restaurant: r.id });
         return;
       }
       setBooking({ restaurant: r.id });
```

- [ ] **Bước 9: Chạy cổng kiểm tra**

Expected: typecheck không lỗi; lint thoát 0, 19 cảnh báo; `Test Files  53 passed (53)`, `Tests  561 passed (561)`; `Applied 6 migration(s).`; build thoát 0; check-prerender thêm `/admin/restaurants` và `/admin/restaurants/[id]/booking`; E2E `90 passed` (dòng cuối là `[desktop-serial] › e2e/booking-switch.serial.spec.ts …`); visual `8 passed` (mọi nhà hàng đang bật, nên HTML khách không đổi).

- [ ] **Bước 10: Đối chứng âm: `updateTag` là thứ đưa thay đổi tới khách**

Mỗi lần: sửa, build lại, chạy, rồi trả file về.
1. Trong `actions.ts` của "Giờ và sức chứa", cho `expire()` không làm gì (bỏ hai `updateTag`). Chạy `e2e/admin-booking-config.spec.ts e2e/booking-switch.serial.spec.ts` (vì `dependencies`, Playwright chạy cả project `desktop` trước). Expected: `2 failed`, `1 did not run` (spec công tắc, vì `desktop` đỏ), `87 passed`:

```
  ✘  [desktop] › e2e/admin-booking-config.spec.ts › an Editor moves the last dinner seating to 22:00 with 8 covers; the preview and the guest see it at once
    Locator: getByLabel('Giờ đặt trong ngày', { exact: true }).getByText('22:00 · 8/8')
    Error: element(s) not found
  ✘  [desktop] › e2e/admin-booking-config.spec.ts › shorter dinner hours list the bookings they leave out, and only the ticked one is cancelled
    Expected substring: "Ngoài giờ phục vụ mới"
    Error: element(s) not found
```

Không có `updateTag`, response của action không render lại trang: bản xem trước và danh sách bị ảnh hưởng giữ trạng thái cũ.
2. Chỉ bỏ `expire(input.restaurant);` trong `saveRules`. Chạy `-- --retries=0 --project=desktop-serial --no-deps`. Expected: `1 failed`:

```
  ✘  1 [desktop-serial] › e2e/booking-switch.serial.spec.ts:35:5 › switching online booking off hides every RESERVE of that restaurant; on again brings them back
    Error: expect(locator).toHaveCount(expected) failed
    Locator:  getByRole('button', { name: /VIEW OFFER/ })
    Expected: 1
    Received: 3
```

Catalogue `'use cache'` của trang khách vẫn còn bản cũ: cả ba ưu đãi giữ nút. Trả file về, build lại, và chạy lại cổng ở Bước 9.

- [ ] **Bước 11: Commit**

```bash
git add lib/booking/rules.ts lib/admin/booking-schemas.ts lib/admin/booking-schemas.test.ts lib/admin/nav.ts lib/admin/nav.test.ts lib/admin/audit-labels.test.ts lib/server/booking/config.ts lib/server/booking/affected.ts test/integration/booking-config.test.ts test/guards/require-permission.guard.test.ts "app/admin/(shell)/reservations/actions.ts" "app/admin/(shell)/_ui/AffectedList.tsx" "app/admin/(shell)/restaurants/page.tsx" "app/admin/(shell)/restaurants/[id]/booking/page.tsx" "app/admin/(shell)/restaurants/[id]/booking/RulesForm.tsx" "app/admin/(shell)/restaurants/[id]/booking/PeriodsEditor.tsx" "app/admin/(shell)/restaurants/[id]/booking/actions.ts" styles/admin.css components/detail/TayaHero.tsx components/site/MobileBar.tsx components/home/Offers.tsx components/home/RestaurantCard.tsx components/overlays/SearchOverlay.tsx components/site/SiteProvider.tsx playwright.config.ts e2e/admin-booking-config.spec.ts e2e/booking-switch.serial.spec.ts e2e/admin-acceptance.spec.ts e2e/admin-users.spec.ts
git commit -m "$(cat <<'EOF'
feat: let staff set each restaurant's hours, capacity and booking switch, and hide RESERVE where it is off

/admin/restaurants lists the restaurants; /admin/restaurants/[id]/booking
("Giờ và sức chứa", Editor and Admin) edits the booking switch and the
overrides of window, lead time and party size (reservations:configure),
and the service periods as one list (schedule:update): weekdays, first and
last seating on the interval's grid, covers per slot, on or off, with two
services refused when they share a time on a shared weekday. One token per
restaurant guards both forms and names who saved first. Each save writes
its audit_log row and expires 'restaurants' and 'booking-rules:<id>', which
also re-renders the page: the slot preview shows the new hours at once, and
the guest's form, which reads availability live, has them on its next
open. Without updateTag the guest pages kept every RESERVE of a restaurant
switched off.

The upcoming bookings the new rules leave out (outside the hours, over the
new capacity, or under a closure) are listed under the forms and are
cancelled only when ticked, each as its own transition.

With online booking off, the guest site drops that restaurant's RESERVE
entry points: the detail page's button and tab-bar column, its offer, the
reserve-only card's tag (the card is aria-disabled) and its search label.
The switch spec runs in a desktop-serial project, after every other spec.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 12: "Cài đặt đặt bàn" và tự xác nhận theo nhà hàng (chỉ Admin)

`/admin/settings/booking` (`settings:read`/`settings:update`) sửa giá trị mặc định mọi nhà hàng thừa hưởng. Trên "Giờ và sức chứa", Admin còn có ô `auto_confirm` của nhà hàng (`reservations:auto-confirm`); Editor không thấy ô đó, và action của nó từ chối Editor. Hai action nằm trong hai file mà guard CI giữ ở quyền Editor không có (`ADMIN_ONLY_ACTIONS`).

**Files:**
- Create: `app/admin/(shell)/settings/booking/page.tsx`, `app/admin/(shell)/settings/booking/SettingsForm.tsx`, `app/admin/(shell)/settings/booking/actions.ts`, `app/admin/(shell)/restaurants/[id]/booking/AutoConfirmForm.tsx`, `app/admin/(shell)/restaurants/[id]/booking/auto-confirm-actions.ts`, `e2e/admin-booking-settings.spec.ts`
- Modify: `lib/server/booking/config.ts`, `lib/admin/booking-schemas.ts`, `lib/admin/booking-schemas.test.ts`, `lib/admin/nav.ts`, `lib/admin/nav.test.ts`, `app/admin/(shell)/restaurants/[id]/booking/page.tsx`, `test/guards/require-permission.guard.test.ts`, `test/integration/booking-config.test.ts`

**Interfaces:**
- Consumes: `getBookingSettings`, `BookingSettings`, `getRestaurantBooking`, `listRestaurantBookings`, `US` (Task 11); `createWebReservation`, `parseReservationInput` (Task 4, trong test); `roleCan` (đợt 3); `Token`, `RestaurantId`, `Time` (Task 9–11).
- Produces:
  - `lib/server/booking/config.ts`: `saveAutoConfirm(pool, actor, { restaurantId, token, autoConfirm: boolean | null })`; `saveBookingSettings(pool, actor, input: BookingSettings)`; cả hai trả `conflict {by, at}` khi token cũ.
  - `lib/admin/booking-schemas.ts`: `AutoConfirmForm` (`inherit | on | off` → `null | true | false`), `SettingsForm`.
  - `app/admin/(shell)/settings/booking/actions.ts`: `saveSettings` (`settings:update`); `app/admin/(shell)/restaurants/[id]/booking/auto-confirm-actions.ts`: `saveAutoConfirmSetting` (`reservations:auto-confirm`).

- [ ] **Bước 1: Viết test**

```diff
diff --git a/lib/admin/booking-schemas.test.ts b/lib/admin/booking-schemas.test.ts
index 6bb6516..eaa2056 100644
--- a/lib/admin/booking-schemas.test.ts
+++ b/lib/admin/booking-schemas.test.ts
@@ -1,5 +1,5 @@
 import { describe, expect, it } from 'vitest';
-import { CancelManyForm, EditForm, NewReservationForm, NoteForm, PeriodsForm, RulesForm, TransitionForm } from './booking-schemas';
+import { AutoConfirmForm, CancelManyForm, EditForm, NewReservationForm, NoteForm, PeriodsForm, RulesForm, SettingsForm, TransitionForm } from './booking-schemas';
 
 /* The booking screens' action inputs (spec §7.3): FormData strings in, typed values or Vietnamese field errors out. */
 describe('booking form schemas', () => {
@@ -94,4 +94,31 @@ describe('booking form schemas', () => {
       reason: ['Nhập lý do hủy.'],
     });
   });
+
+  it('booking settings: every default inside the database’s bounds, a blank cut-off for none, checkboxes as on/off', () => {
+    const base = { token: '1', windowDays: '14', leadMinutes: '30', sameDayCutoff: '', maxParty: '12', piiRetentionMonths: '24' };
+    expect(SettingsForm.parse({ ...base, autoConfirm: 'on' })).toEqual({
+      token: '1',
+      windowDays: 14,
+      leadMinutes: 30,
+      sameDayCutoff: null,
+      maxParty: 12,
+      autoConfirm: true,
+      guestAckEmail: false,
+      piiRetentionMonths: 24,
+    });
+    expect(SettingsForm.safeParse({ ...base, windowDays: '91', leadMinutes: '-1', sameDayCutoff: '25:00', maxParty: '0', piiRetentionMonths: '121' }).error?.flatten().fieldErrors).toEqual({
+      windowDays: ['Từ 1 đến 90 ngày.'],
+      leadMinutes: ['Từ 0 đến 1440 phút.'],
+      sameDayCutoff: ['Chọn giờ (HH:MM).'],
+      maxParty: ['Từ 1 đến 50 khách.'],
+      piiRetentionMonths: ['Từ 1 đến 120 tháng.'],
+    });
+  });
+
+  it('auto-confirm per restaurant: follow the default, on, or off', () => {
+    const base = { restaurant: 'danaksara', token: '1' };
+    expect(['inherit', 'on', 'off'].map((autoConfirm) => AutoConfirmForm.parse({ ...base, autoConfirm }).autoConfirm)).toEqual([null, true, false]);
+    expect(AutoConfirmForm.safeParse({ ...base, autoConfirm: 'yes' }).success).toBe(false);
+  });
 });
```

```diff
diff --git a/lib/admin/nav.test.ts b/lib/admin/nav.test.ts
index 99061ff..510c977 100644
--- a/lib/admin/nav.test.ts
+++ b/lib/admin/nav.test.ts
@@ -3,7 +3,7 @@ import { navFor } from './nav';
 
 describe('navFor', () => {
   it('shows each role only what its permissions open', () => {
-    expect(navFor('admin').map((i) => i.label)).toEqual(['Tổng quan', 'Đặt bàn', 'Nhà hàng', 'Nhân viên', 'Nhật ký']);
+    expect(navFor('admin').map((i) => i.label)).toEqual(['Tổng quan', 'Đặt bàn', 'Nhà hàng', 'Cài đặt đặt bàn', 'Nhân viên', 'Nhật ký']);
     expect(navFor('editor').map((i) => i.label)).toEqual(['Tổng quan', 'Đặt bàn', 'Nhà hàng']);
   });
 });
```

`ADMIN_ONLY_ACTIONS` thêm hai file, và bảng `BOOKING_ACTIONS` có đủ mọi action của đợt 4:

```diff
diff --git a/test/guards/require-permission.guard.test.ts b/test/guards/require-permission.guard.test.ts
index a3f864c..4ee9fe2 100644
--- a/test/guards/require-permission.guard.test.ts
+++ b/test/guards/require-permission.guard.test.ts
@@ -40,8 +40,12 @@ describe('requirePermission guard (the repository)', () => {
   });
 });
 
-/** Files whose every action is Admin-only (spec §7.1: staff, invitations). */
-const ADMIN_ONLY_ACTIONS = ['app/admin/(shell)/users/actions.ts'];
+/** Files whose every action is Admin-only (spec §7.1: staff, invitations; booking settings; auto_confirm). */
+const ADMIN_ONLY_ACTIONS = [
+  'app/admin/(shell)/users/actions.ts',
+  'app/admin/(shell)/settings/booking/actions.ts',
+  'app/admin/(shell)/restaurants/[id]/booking/auto-confirm-actions.ts',
+];
 
 /*
  * Spec §7.1's matrix for the booking screens, action by action: the exact
@@ -61,6 +65,12 @@ const BOOKING_ACTIONS: Record<string, Record<string, { permission: object; edito
     savePeriods: { permission: { schedule: ['update'] }, editor: true },
     saveRules: { permission: { reservations: ['configure'] }, editor: true },
   },
+  'app/admin/(shell)/restaurants/[id]/booking/auto-confirm-actions.ts': {
+    saveAutoConfirmSetting: { permission: { reservations: ['auto-confirm'] }, editor: false },
+  },
+  'app/admin/(shell)/settings/booking/actions.ts': {
+    saveSettings: { permission: { settings: ['update'] }, editor: false },
+  },
 };
 
 describe('booking actions follow the permission matrix (spec §7.1)', () => {
```

Test `auto_confirm` đặt một bàn qua đường của khách (`createWebReservation`) để thấy nó thành `confirmed` ngay:

```diff
diff --git a/test/integration/booking-config.test.ts b/test/integration/booking-config.test.ts
index b3dc9e0..6b27a98 100644
--- a/test/integration/booking-config.test.ts
+++ b/test/integration/booking-config.test.ts
@@ -4,13 +4,18 @@ import { planDay } from '@/lib/booking/resolve-day';
 import type { AuditActor } from '@/lib/server/audit';
 import { findAffected } from '@/lib/server/booking/affected';
 import {
+  getBookingSettings,
   getRestaurantBooking,
   loadPeriods,
   overlappingPeriods,
+  saveAutoConfirm,
+  saveBookingSettings,
   saveRestaurantRules,
   saveServicePeriods,
   type PeriodInput,
 } from '@/lib/server/booking/config';
+import { createWebReservation } from '@/lib/server/booking/create';
+import { parseReservationInput } from '@/lib/server/booking/input';
 import { loadRestaurantRules } from '@/lib/server/booking/rules';
 import { TEST_DATABASE_URL } from '../helpers/db';
 
@@ -54,6 +59,7 @@ async function resetTaya() {
      VALUES ('taya-house', 'Lunch', '11:30', '13:30', 30, 16, 20), ('taya-house', 'Dinner', '18:00', '21:00', 30, 16, 40)`,
   );
   await pool.query(`UPDATE restaurants SET booking_enabled = true, window_days = NULL, lead_minutes = NULL, max_party = NULL, auto_confirm = NULL`);
+  await pool.query(`UPDATE booking_settings SET window_days = 14, lead_minutes = 30, same_day_cutoff = NULL, max_party = 12, auto_confirm = false`);
 }
 
 describe.skipIf(!TEST_DATABASE_URL)('booking configuration (database)', () => {
@@ -192,4 +198,37 @@ describe.skipIf(!TEST_DATABASE_URL)('booking configuration (database)', () => {
       ]);
     });
   });
+
+  describe('settings and auto-confirm (Admin)', () => {
+    it('saves the defaults every restaurant inherits, with a token and a settings audit row', async () => {
+      const s = await getBookingSettings(pool);
+      expect(s).toMatchObject({ windowDays: 14, leadMinutes: 30, sameDayCutoff: null, maxParty: 12, autoConfirm: false, guestAckEmail: true, piiRetentionMonths: 24 });
+      expect(await saveBookingSettings(pool, ACTOR, { ...s, maxParty: 8, sameDayCutoff: '17:00' })).toEqual({ ok: true, data: null });
+      expect(await getBookingSettings(pool)).toMatchObject({ maxParty: 8, sameDayCutoff: '17:00' });
+      // Every restaurant without its own override now takes parties of up to 8, and closes today at 17:00.
+      expect((await loadRestaurantRules(pool, 'danaksara', 'en', '2026-10-05'))!.rules).toMatchObject({ maxParty: 8, sameDayCutoff: '17:00' });
+      expect(await saveBookingSettings(pool, ACTOR, s)).toMatchObject({ ok: false, code: 'conflict' });
+      const [row] = await audit();
+      expect(row).toMatchObject({ action: 'settings', entity_type: 'booking_settings', entity_id: null });
+      expect(row.after).toMatchObject({ maxParty: 8, sameDayCutoff: '17:00' });
+      expect(row.after).not.toHaveProperty('token');
+    });
+
+    it('auto-confirm per restaurant: a guest’s booking there is confirmed at once', async () => {
+      const r = await getRestaurantBooking(pool, 'danaksara');
+      expect(await saveAutoConfirm(pool, ACTOR, { restaurantId: 'danaksara', token: 'stale', autoConfirm: true })).toMatchObject({ ok: false, code: 'conflict' });
+      expect(await saveAutoConfirm(pool, ACTOR, { restaurantId: 'danaksara', token: r!.token, autoConfirm: true })).toEqual({ ok: true, data: null });
+      expect(await getRestaurantBooking(pool, 'danaksara')).toMatchObject({ autoConfirm: true });
+      const parsed = parseReservationInput({ restaurant: 'danaksara', date: '2026-10-05', time: '19:00', guests: 2, name: 'Khách Web', phone: '0905 444 555', email: '', note: '', locale: 'en' });
+      if (!parsed.ok) throw new Error(parsed.code);
+      expect(await createWebReservation(parsed.value, { now: NOW, pool })).toMatchObject({ ok: true, status: 'confirmed' });
+      // Elsewhere the default (off) still holds.
+      const other = parseReservationInput({ restaurant: 'don-ciprianis', date: '2026-10-05', time: '19:00', guests: 2, name: 'Khách Web', phone: '0905 444 555', email: '', note: '', locale: 'en' });
+      if (!other.ok) throw new Error(other.code);
+      expect(await createWebReservation(other.value, { now: NOW, pool })).toMatchObject({ ok: true, status: 'requested' });
+      expect((await audit()).map((a) => [a.entity_type, a.entity_id, a.before, a.after])).toEqual([
+        ['restaurant_booking', 'danaksara', { auto_confirm: null }, { auto_confirm: true }],
+      ]);
+    });
+  });
 });
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/admin/booking-schemas.test.ts lib/admin/nav.test.ts test/guards/require-permission.guard.test.ts test/integration/booking-config.test.ts`
Expected: FAIL `Test Files  4 failed (4)`, `Tests  8 failed | 34 passed (42)`:

```
 FAIL  lib/admin/booking-schemas.test.ts > booking form schemas > booking settings: every default inside the database’s bounds, a blank cut-off for none, checkboxes as on/off
TypeError: Cannot read properties of undefined (reading 'parse')
 FAIL  lib/admin/booking-schemas.test.ts > booking form schemas > auto-confirm per restaurant: follow the default, on, or off
 FAIL  lib/admin/nav.test.ts > navFor > shows each role only what its permissions open
AssertionError: expected [ 'Tổng quan', 'Đặt bàn', …(3) ] to deeply equal [ 'Tổng quan', 'Đặt bàn', …(4) ]
 FAIL  test/integration/booking-config.test.ts > booking configuration (database) > settings and auto-confirm (Admin) > saves the defaults every restaurant inherits, with a token and a settings audit row
TypeError: saveBookingSettings is not a function
 FAIL  test/integration/booking-config.test.ts > booking configuration (database) > settings and auto-confirm (Admin) > auto-confirm per restaurant: a guest’s booking there is confirmed at once
TypeError: saveAutoConfirm is not a function
 FAIL  test/guards/require-permission.guard.test.ts > requirePermission guard (the repository) > every staff-screen action asks for a permission the Editor lacks
Error: ENOENT: no such file or directory, open '…/app/admin/(shell)/settings/booking/actions.ts'
 FAIL  test/guards/require-permission.guard.test.ts > booking actions follow the permission matrix (spec §7.1) > app/admin/(shell)/restaurants/[id]/booking/auto-confirm-actions.ts
Error: ENOENT: no such file or directory, open '…/app/admin/(shell)/restaurants/[id]/booking/auto-confirm-actions.ts'
 FAIL  test/guards/require-permission.guard.test.ts > booking actions follow the permission matrix (spec §7.1) > app/admin/(shell)/settings/booking/actions.ts
```

- [ ] **Bước 3: Viết E2E**

POST phát lại là action thật của Admin (bắt bằng `waitForRequest`) gửi kèm cookie của Editor (spec §13). Test cuối bật `auto_confirm` cho Danaksara rồi đặt bàn như một khách:

```ts
import type { Page } from '@playwright/test';
import { expectHydrated } from './csp';
import { HOME_PATH } from './paths';
import { STAFF, expect, newVisitor, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * "Cài đặt đặt bàn" and auto_confirm per restaurant are the Admin's (spec
 * §7.1): an Editor gets the 403 view and no auto-confirm control, and the
 * Admin's own action, replayed with an Editor's cookie, is refused and
 * writes nothing. Danaksara's auto_confirm: no other spec books it.
 */

test.beforeAll(() => seedStaff());
test.use({ reducedMotion: 'reduce' });

const nav = (page: Page) => page.getByRole('navigation', { name: 'Điều hướng quản trị' });
const settingsAudits = async () => (await one<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'booking_settings'`))!.n;

test('an Editor gets the 403 view on booking settings and never sees auto-confirm', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  await expect(nav(page).getByRole('link', { name: 'Đặt bàn' })).toBeVisible();
  await expect(nav(page).getByRole('link', { name: 'Cài đặt đặt bàn' })).toHaveCount(0);
  const res = await page.goto('/admin/settings/booking');
  expect(await res?.text()).not.toContain('Giữ dữ liệu khách');
  await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Cài đặt đặt bàn' })).toHaveCount(0);

  await page.goto('/admin/restaurants/danaksara/booking');
  await expect(page.getByRole('form', { name: 'Quy tắc đặt bàn' })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Tự động xác nhận' })).toHaveCount(0);
});

test('the Admin saves booking settings; the same POST from an Editor is refused and writes nothing', async ({ page, browser, baseURL }, testInfo) => {
  await signInAs(page, STAFF.admin);
  await nav(page).getByRole('link', { name: 'Cài đặt đặt bàn' }).click();
  await expect(page.getByRole('heading', { name: 'Cài đặt đặt bàn', level: 1 })).toBeVisible();
  await expectHydrated(page);
  const form = page.getByRole('form', { name: 'Cài đặt đặt bàn' });
  await expect(form.getByLabel('Số khách tối đa', { exact: true })).toHaveValue('12');
  // Save the values as they are: other specs run on these defaults.
  const before = await settingsAudits();
  const saving = page.waitForRequest((r) => r.method() === 'POST' && !!r.headers()['next-action']);
  await form.getByRole('button', { name: 'Lưu cài đặt' }).click();
  const request = await saving;
  await expect(page.getByRole('form', { name: 'Cài đặt đặt bàn' }).getByRole('status')).toHaveText('Đã lưu.');
  expect(await settingsAudits()).toBe(before + 1);

  // The Admin's captured action, replayed with an Editor's cookie (spec §13).
  const editor = await newVisitor(browser, testInfo);
  await signInAs(editor, STAFF.editor);
  const replay = await editor.request.post(new URL(request.url()).pathname, {
    headers: {
      'next-action': request.headers()['next-action'],
      'content-type': request.headers()['content-type'],
      accept: 'text/x-component',
      origin: baseURL!,
    },
    data: request.postDataBuffer()!,
  });
  expect(replay.status()).toBe(200);
  expect(await replay.text()).toContain('"code":"forbidden"');
  expect(await settingsAudits()).toBe(before + 1);
  await editor.context().close();
});

test('the Admin turns auto-confirm on for one restaurant: a guest’s booking there is confirmed at once', async ({ page }) => {
  try {
    await signInAs(page, STAFF.admin);
    await page.goto('/admin/restaurants/danaksara/booking');
    await expectHydrated(page);
    const form = page.getByRole('form', { name: 'Tự động xác nhận' });
    await form.getByLabel('Tự động xác nhận đặt bàn online (chỉ Admin)', { exact: true }).selectOption('on');
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByRole('form', { name: 'Tự động xác nhận' }).getByRole('status')).toHaveText('Đã lưu.');

    await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
    await page.goto(HOME_PATH);
    await page.locator('.rcard:visible', { hasText: 'Danaksara' }).first().click();
    const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
    await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
    await drawer.locator('.daystrip .day[data-state="open"]').last().click();
    await drawer.locator('.slot:not([disabled])').first().click();
    await drawer.getByLabel('Full name *', { exact: true }).fill('Khách Tự Xác Nhận');
    const digits = String(Date.now()).slice(-6);
    await drawer.getByLabel('Phone *', { exact: true }).fill(`0906 ${digits.slice(0, 3)} ${digits.slice(3)}`);
    await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
    const reference = (await drawer.locator('.drawer-ref').textContent()) ?? '';
    expect(reference).toMatch(/^FC-[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(await one(`SELECT status, source FROM reservations WHERE reference = $1`, [reference])).toEqual({ status: 'confirmed', source: 'web' });
  } finally {
    await one(`UPDATE restaurants SET auto_confirm = NULL WHERE id = 'danaksara'`);
  }
});
```

- [ ] **Bước 4: Build code hiện tại và chạy đặc tả: phải đỏ**

Cất tạm các file ngoài `e2e/`, build, chạy `e2e/admin-booking-settings.spec.ts --project=desktop`. Expected: `3 failed`:

```
  ✘  1 [desktop] › e2e/admin-booking-settings.spec.ts:19:5 › an Editor gets the 403 view on booking settings and never sees auto-confirm
  ✘  2 [desktop] › e2e/admin-booking-settings.spec.ts:33:5 › the Admin saves booking settings; the same POST from an Editor is refused and writes nothing
  ✘  3 [desktop] › e2e/admin-booking-settings.spec.ts:66:5 › the Admin turns auto-confirm on for one restaurant: a guest’s booking there is confirmed at once
    Locator: getByRole('heading', { name: 'Không có quyền truy cập' })
    Error: element(s) not found
    Error: locator.click: Test timeout of 30000ms exceeded.
    Error: locator.selectOption: Test timeout of 30000ms exceeded.
```

`/admin/settings/booking` chưa có nên là trang 404 của admin, không phải 403. Lấy lại các file đã cất.

- [ ] **Bước 5: Viết phần ghi, schema và hai action**

Lưu cài đặt chỉ làm hết hạn `booking-rules:<id>` của mọi nhà hàng: catalogue (`restaurants`) không chứa giá trị mặc định nào.

```diff
diff --git a/lib/server/booking/config.ts b/lib/server/booking/config.ts
index 7e100e1..993a45b 100644
--- a/lib/server/booking/config.ts
+++ b/lib/server/booking/config.ts
@@ -217,3 +217,52 @@ export async function saveRestaurantRules(pool: Pool, actor: AuditActor, input:
     return { ok: true, data: null } as const;
   });
 }
+
+// ── auto_confirm per restaurant (Admin: reservations:auto-confirm) ──────────
+
+/** null follows booking_settings.auto_confirm. */
+export async function saveAutoConfirm(
+  pool: Pool,
+  actor: AuditActor,
+  input: { restaurantId: string; token: string; autoConfirm: boolean | null },
+): Promise<{ ok: true; data: null } | NotFound | Conflict> {
+  return withTransaction(pool, async (client) => {
+    const locked = await lockRestaurant(client, input.restaurantId, input.token);
+    if (locked) return locked;
+    const before = await getRestaurantBooking(client, input.restaurantId);
+    await client.query('UPDATE restaurants SET auto_confirm = $2, updated_at = now(), updated_by = $3 WHERE id = $1', [
+      input.restaurantId,
+      input.autoConfirm,
+      actor.id,
+    ]);
+    await insertAudit(client, actor, {
+      action: 'update',
+      entityType: 'restaurant_booking',
+      entityId: input.restaurantId,
+      before: { auto_confirm: before?.autoConfirm ?? null },
+      after: { auto_confirm: input.autoConfirm },
+    });
+    return { ok: true, data: null } as const;
+  });
+}
+
+// ── booking_settings (Admin: settings:update) ───────────────────────────────
+
+export async function saveBookingSettings(pool: Pool, actor: AuditActor, input: BookingSettings): Promise<{ ok: true; data: null } | Conflict> {
+  return withTransaction(pool, async (client) => {
+    const { rows } = await client.query<{ token: string; updated_by: string | null; updated_at: Date }>(
+      `SELECT ${US('updated_at')} AS token, updated_by, updated_at FROM booking_settings FOR UPDATE`,
+    );
+    if (rows[0]?.token !== input.token) return conflictBy(client, rows[0]?.updated_by ?? null, rows[0]?.updated_at ?? new Date());
+    const { token: _before, ...before } = await getBookingSettings(client);
+    await client.query(
+      `UPDATE booking_settings
+          SET window_days = $1, lead_minutes = $2, same_day_cutoff = $3::time, max_party = $4, auto_confirm = $5,
+              guest_ack_email = $6, pii_retention_months = $7, updated_at = now(), updated_by = $8`,
+      [input.windowDays, input.leadMinutes, input.sameDayCutoff, input.maxParty, input.autoConfirm, input.guestAckEmail, input.piiRetentionMonths, actor.id],
+    );
+    const { token: _after, ...after } = await getBookingSettings(client);
+    await insertAudit(client, actor, { action: 'settings', entityType: 'booking_settings', entityId: null, before, after });
+    return { ok: true, data: null } as const;
+  });
+}
```

```diff
diff --git a/lib/admin/booking-schemas.ts b/lib/admin/booking-schemas.ts
index 79578e4..51966b3 100644
--- a/lib/admin/booking-schemas.ts
+++ b/lib/admin/booking-schemas.ts
@@ -128,3 +128,24 @@ export const PeriodsForm = z.object({
     }
   }, z.array(PeriodForm).max(20, { error: 'Tối đa 20 ca phục vụ.' })),
 });
+
+/** auto_confirm per restaurant (Admin): follow "Cài đặt đặt bàn" (null), on or off. */
+export const AutoConfirmForm = z.object({
+  restaurant: RestaurantId,
+  token: Token,
+  autoConfirm: z.enum(['inherit', 'on', 'off']).transform((v) => (v === 'inherit' ? null : v === 'on')),
+});
+
+const bounded = (min: number, max: number, message: string) => z.coerce.number({ error: message }).int({ error: message }).min(min, { error: message }).max(max, { error: message });
+
+/** "Cài đặt đặt bàn" (Admin): the defaults every restaurant inherits; the bounds are migration 006's. */
+export const SettingsForm = z.object({
+  token: Token,
+  windowDays: bounded(1, 90, 'Từ 1 đến 90 ngày.'),
+  leadMinutes: bounded(0, 1440, 'Từ 0 đến 1440 phút.'),
+  sameDayCutoff: z.preprocess(blankToNull, Time.nullable()),
+  maxParty: bounded(1, 50, 'Từ 1 đến 50 khách.'),
+  autoConfirm: z.preprocess((v) => v === 'on', z.boolean()),
+  guestAckEmail: z.preprocess((v) => v === 'on', z.boolean()),
+  piiRetentionMonths: bounded(1, 120, 'Từ 1 đến 120 tháng.'),
+});
```

Create `app/admin/(shell)/settings/booking/actions.ts`:

```ts
'use server';

import { updateTag } from 'next/cache';
import { getPool } from '@/db/client';
import { SettingsForm } from '@/lib/admin/booking-schemas';
import { TAGS } from '@/lib/cache-tags';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { listRestaurantBookings, saveBookingSettings } from '@/lib/server/booking/config';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * "Cài đặt đặt bàn" (spec §7.1: Admin only, settings:update; the CI guard
 * holds this whole file to a permission the Editor lacks). The defaults reach
 * every restaurant without an override, so every booking-rules tag expires;
 * the catalogue ('restaurants') carries none of them.
 */
export async function saveSettings(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ settings: ['update'] });
    const input = SettingsForm.parse(Object.fromEntries(formData));
    const pool = getPool();
    const result = await saveBookingSettings(pool, auditActor(staff), input);
    if (!result.ok) return result;
    for (const r of await listRestaurantBookings(pool)) updateTag(TAGS.bookingRules(r.id));
    return result;
  } catch (err) {
    return actionError(err);
  }
}
```

Create `app/admin/(shell)/restaurants/[id]/booking/auto-confirm-actions.ts` (một file riêng, vì guard kiểm "chỉ Admin" theo file):

```ts
'use server';

import { updateTag } from 'next/cache';
import { getPool } from '@/db/client';
import { AutoConfirmForm } from '@/lib/admin/booking-schemas';
import { TAGS } from '@/lib/cache-tags';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { saveAutoConfirm } from '@/lib/server/booking/config';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * auto_confirm per restaurant: Admin only (spec §7.1). A file of its own, so
 * the CI guard holds every action in it to a permission the Editor lacks
 * (test/guards/require-permission.guard.test.ts, ADMIN_ONLY_ACTIONS).
 */
export async function saveAutoConfirmSetting(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ reservations: ['auto-confirm'] });
    const input = AutoConfirmForm.parse(Object.fromEntries(formData));
    const result = await saveAutoConfirm(getPool(), auditActor(staff), { restaurantId: input.restaurant, token: input.token, autoConfirm: input.autoConfirm });
    if (!result.ok) return result;
    // The catalogue does not carry auto_confirm; only this restaurant's rules changed (spec §10.1).
    updateTag(TAGS.bookingRules(input.restaurant));
    return result;
  } catch (err) {
    return actionError(err);
  }
}
```

- [ ] **Bước 6: Viết các màn**

Create `app/admin/(shell)/settings/booking/page.tsx` (`requirePagePermission` trước mọi truy vấn: Editor nhận màn 403):

```tsx
import type { Metadata } from 'next';
import { getPool } from '@/db/client';
import { getBookingSettings } from '@/lib/server/booking/config';
import { requirePagePermission } from '@/lib/server/dal/session';
import { SettingsForm } from './SettingsForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Cài đặt đặt bàn' };

export default async function BookingSettingsPage() {
  // Before any query: an Editor gets the 403 view.
  await requirePagePermission({ settings: ['read'] });
  const settings = await getBookingSettings(getPool());
  return (
    <>
      <h1>Cài đặt đặt bàn</h1>
      <p className="a-lede">Mặc định cho mọi nhà hàng; từng nhà hàng có thể ghi đè trong “Giờ và sức chứa”.</p>
      <SettingsForm settings={settings} />
    </>
  );
}
```

Create `app/admin/(shell)/settings/booking/SettingsForm.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import type { BookingSettings } from '@/lib/server/booking/config';
import { FieldError, FormMessage } from '../../_ui/FormMessage';
import { saveSettings } from './actions';

export function SettingsForm({ settings: s }: { settings: BookingSettings }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveSettings, null);
  const err = (name: string) => `settings-booking-${name}-error`;
  return (
    <form className="a-grid-form" onSubmit={submitKeepingValues(action)} key={s.token} noValidate aria-label="Cài đặt đặt bàn">
      <input type="hidden" name="token" value={s.token} />
      <FormMessage state={state} success="Đã lưu." />
      <div className="a-field">
        <label htmlFor="settings-booking-window">Số ngày đặt trước (tính cả hôm nay)</label>
        <input id="settings-booking-window" name="windowDays" type="number" min={1} max={90} defaultValue={s.windowDays} aria-describedby={err('windowDays')} />
        <FieldError state={state} name="windowDays" id={err('windowDays')} />
      </div>
      <div className="a-field">
        <label htmlFor="settings-booking-lead">Đặt trước tối thiểu (phút)</label>
        <input id="settings-booking-lead" name="leadMinutes" type="number" min={0} max={1440} defaultValue={s.leadMinutes} aria-describedby={err('leadMinutes')} />
        <FieldError state={state} name="leadMinutes" id={err('leadMinutes')} />
      </div>
      <div className="a-field">
        <label htmlFor="settings-booking-cutoff">Ngừng nhận đặt bàn trong ngày từ (để trống: không giới hạn)</label>
        <input id="settings-booking-cutoff" name="sameDayCutoff" type="time" defaultValue={s.sameDayCutoff ?? ''} aria-describedby={err('sameDayCutoff')} />
        <FieldError state={state} name="sameDayCutoff" id={err('sameDayCutoff')} />
      </div>
      <div className="a-field">
        <label htmlFor="settings-booking-party">Số khách tối đa</label>
        <input id="settings-booking-party" name="maxParty" type="number" min={1} max={50} defaultValue={s.maxParty} aria-describedby={err('maxParty')} />
        <FieldError state={state} name="maxParty" id={err('maxParty')} />
      </div>
      <div className="a-field">
        <label htmlFor="settings-booking-pii">Giữ dữ liệu khách (tháng)</label>
        <input
          id="settings-booking-pii"
          name="piiRetentionMonths"
          type="number"
          min={1}
          max={120}
          defaultValue={s.piiRetentionMonths}
          aria-describedby={err('piiRetentionMonths')}
        />
        <FieldError state={state} name="piiRetentionMonths" id={err('piiRetentionMonths')} />
      </div>
      <label className="a-check a-field--wide">
        <input type="checkbox" name="autoConfirm" defaultChecked={s.autoConfirm} />
        Tự động xác nhận đặt bàn online
      </label>
      <label className="a-check a-field--wide">
        <input type="checkbox" name="guestAckEmail" defaultChecked={s.guestAckEmail} />
        Gửi email “đã nhận yêu cầu” cho khách (từ đợt 5)
      </label>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang lưu…' : 'Lưu cài đặt'}
      </button>
    </form>
  );
}
```

Create `app/admin/(shell)/restaurants/[id]/booking/AutoConfirmForm.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import type { ActionResult } from '@/lib/server/action-result';
import { FormMessage } from '../../../_ui/FormMessage';
import { saveAutoConfirmSetting } from './auto-confirm-actions';

/* Admin only: the page renders it only for a role with reservations:auto-confirm, and the action checks again. */
export function AutoConfirmForm({ restaurantId, token, value, defaultValue }: { restaurantId: string; token: string; value: boolean | null; defaultValue: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveAutoConfirmSetting, null);
  return (
    <form className="a-inline-form" action={action} key={token} aria-label="Tự động xác nhận">
      <input type="hidden" name="restaurant" value={restaurantId} />
      <input type="hidden" name="token" value={token} />
      <FormMessage state={state} success="Đã lưu." />
      <div className="a-field">
        <label htmlFor="booking-auto-confirm">Tự động xác nhận đặt bàn online (chỉ Admin)</label>
        <select id="booking-auto-confirm" name="autoConfirm" defaultValue={value === null ? 'inherit' : value ? 'on' : 'off'}>
          <option value="inherit">{`Theo cài đặt chung (${defaultValue ? 'bật' : 'tắt'})`}</option>
          <option value="on">Bật</option>
          <option value="off">Tắt</option>
        </select>
      </div>
      <button className="a-btn a-btn--ghost" type="submit" disabled={pending}>
        Lưu
      </button>
    </form>
  );
}
```

Trang chỉ render ô này khi `roleCan(staff.role, { reservations: ['auto-confirm'] })`:

```diff
diff --git a/app/admin/(shell)/restaurants/[id]/booking/page.tsx b/app/admin/(shell)/restaurants/[id]/booking/page.tsx
index 0e4ca20..e8b0feb 100644
--- a/app/admin/(shell)/restaurants/[id]/booking/page.tsx
+++ b/app/admin/(shell)/restaurants/[id]/booking/page.tsx
@@ -6,12 +6,14 @@ import { formatIsoDayVi } from '@/lib/admin/format';
 import { planDay } from '@/lib/booking/resolve-day';
 import { MEALS } from '@/lib/data';
 import { STATUS_LABELS } from '@/lib/reservations/lifecycle';
+import { roleCan } from '@/lib/server/auth/permissions';
 import { findAffected, type AffectedKind } from '@/lib/server/booking/affected';
 import { getBookingSettings, getRestaurantBooking, loadPeriods } from '@/lib/server/booking/config';
 import { loadBookedCovers, loadRestaurantRules } from '@/lib/server/booking/rules';
 import { requirePagePermission } from '@/lib/server/dal/session';
 import { isValidIsoDate, venueNow } from '@/lib/venue-time';
 import { AffectedList } from '../../../_ui/AffectedList';
+import { AutoConfirmForm } from './AutoConfirmForm';
 import { PeriodsEditor } from './PeriodsEditor';
 import { RulesForm } from './RulesForm';
 
@@ -33,7 +35,7 @@ export default async function RestaurantBookingPage({
   params: Promise<{ id: string }>;
   searchParams: Promise<{ ngay?: string | string[] }>;
 }) {
-  await requirePagePermission({ schedule: ['read'] });
+  const staff = await requirePagePermission({ schedule: ['read'] });
   const [{ id }, { ngay }] = await Promise.all([params, searchParams]);
   const pool = getPool();
   const restaurant = await getRestaurantBooking(pool, id);
@@ -71,6 +73,10 @@ export default async function RestaurantBookingPage({
           }}
           defaults={{ windowDays: settings.windowDays, leadMinutes: settings.leadMinutes, maxParty: settings.maxParty }}
         />
+        {/* Admin only (spec §7.1): an Editor never gets the control, and the action refuses them anyway. */}
+        {roleCan(staff.role, { reservations: ['auto-confirm'] }) ? (
+          <AutoConfirmForm restaurantId={restaurant.id} token={restaurant.token} value={restaurant.autoConfirm} defaultValue={settings.autoConfirm} />
+        ) : null}
       </section>
 
       <section aria-labelledby="booking-periods-title">
```

```diff
diff --git a/lib/admin/nav.ts b/lib/admin/nav.ts
index 3fc9dcb..7be2026 100644
--- a/lib/admin/nav.ts
+++ b/lib/admin/nav.ts
@@ -11,6 +11,7 @@ export const ADMIN_NAV: readonly NavItem[] = [
   { href: '/admin', label: 'Tổng quan' },
   { href: '/admin/reservations', label: 'Đặt bàn', permission: { reservations: ['read'] } },
   { href: '/admin/restaurants', label: 'Nhà hàng', permission: { schedule: ['read'] } },
+  { href: '/admin/settings/booking', label: 'Cài đặt đặt bàn', permission: { settings: ['read'] } },
   { href: '/admin/users', label: 'Nhân viên', permission: { user: ['list'] } },
   { href: '/admin/audit', label: 'Nhật ký', permission: { audit: ['read'] } },
 ];
```

- [ ] **Bước 7: Chạy lại test**

Run: lệnh ở Bước 2.
Expected: PASS `Test Files  4 passed (4)`, `Tests  42 passed (42)`

- [ ] **Bước 8: Kiểm rằng guard bắt một quyền bị đổi**

Trong `auto-confirm-actions.ts`, đổi `requirePermission({ reservations: ['auto-confirm'] })` thành `requirePermission({ reservations: ['configure'] })`. Run: `npx vitest run test/guards/require-permission.guard.test.ts`. Expected: `Tests  2 failed | 20 passed (22)`:

```
     × every staff-screen action asks for a permission the Editor lacks
     × app/admin/(shell)/restaurants/[id]/booking/auto-confirm-actions.ts
AssertionError: expected [ Array(1) ] to deeply equal []
AssertionError: saveAutoConfirmSetting: expected { reservations: [ 'configure' ] } to deeply equal { reservations: [ 'auto-confirm' ] }
```

Trả về: `Tests  22 passed (22)`.

- [ ] **Bước 9: Chạy cổng kiểm tra**

Expected: typecheck không lỗi; lint thoát 0, 19 cảnh báo; `Test Files  53 passed (53)`, `Tests  567 passed (567)`; `Applied 6 migration(s).`; build thoát 0; check-prerender thêm `/admin/settings/booking`; E2E `93 passed`; visual `8 passed`.

- [ ] **Bước 10: Commit**

```bash
git add "app/admin/(shell)/restaurants/[id]/booking/page.tsx" "app/admin/(shell)/restaurants/[id]/booking/AutoConfirmForm.tsx" "app/admin/(shell)/restaurants/[id]/booking/auto-confirm-actions.ts" "app/admin/(shell)/settings/booking/page.tsx" "app/admin/(shell)/settings/booking/SettingsForm.tsx" "app/admin/(shell)/settings/booking/actions.ts" lib/admin/booking-schemas.ts lib/admin/booking-schemas.test.ts lib/admin/nav.ts lib/admin/nav.test.ts lib/server/booking/config.ts test/guards/require-permission.guard.test.ts test/integration/booking-config.test.ts e2e/admin-booking-settings.spec.ts
git commit -m "$(cat <<'EOF'
feat: add the Admin's booking settings and per-restaurant auto-confirm

/admin/settings/booking (settings:read and settings:update) edits the
defaults every restaurant inherits: window, lead time, same-day cut-off,
party size, auto-confirm, the acknowledgement email (acts from phase 5) and
how long guest data is kept (from phase 10). The save is token-guarded,
writes a 'settings' audit row and expires every booking-rules tag.

On "Giờ và sức chứa" an Admin also sets auto_confirm for that restaurant
(follow the default, on or off; reservations:auto-confirm); a guest's
booking there is then confirmed at once. An Editor gets the 403 view on the
settings, never sees the auto-confirm control, and the Admin's own POST
replayed with an Editor's cookie answers forbidden and writes nothing.

Both actions live in files the CI guard holds to an Admin-only permission;
giving auto-confirm an Editor's permission fails two guard tests.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 13: Ngày đóng cửa, mỗi cái kèm danh sách đặt bàn bị ảnh hưởng

`/admin/reservations/closures` (Editor và Admin, `schedule:update`): thêm, sửa, xóa ngày đóng cửa (một nhà hàng, một điểm đến hoặc tất cả; khoảng ngày gồm hai đầu; vài bữa hoặc cả ngày; lý do công khai EN và VI, hiện hay ẩn; ghi chú nội bộ). Mỗi lần ghi có token, một dòng `audit_log` và làm hết hạn `booking-rules:<id>` của mọi nhà hàng trong phạm vi cũ và mới. Mỗi ngày đóng cửa liệt kê đặt bàn sắp tới nó che (chế độ ngày đóng cửa của `findAffected`); không gì bị hủy cho tới khi nhân viên tích và ghi lý do.

**Files:**
- Create: `app/admin/(shell)/reservations/closures/page.tsx`, `app/admin/(shell)/reservations/closures/ClosureForm.tsx`, `app/admin/(shell)/reservations/closures/actions.ts`, `e2e/admin-closures.spec.ts`
- Modify: `lib/server/booking/config.ts`, `lib/server/booking/affected.ts`, `lib/admin/booking-schemas.ts`, `lib/admin/booking-schemas.test.ts`, `app/admin/(shell)/reservations/_ui/SectionNav.tsx`, `styles/admin.css`, `test/guards/require-permission.guard.test.ts`, `test/integration/booking-config.test.ts`

**Interfaces:**
- Consumes: `closureApplies`, `findPlannedSlot`, `planDay` (Task 2, 8); `ClosureRule` (`lib/booking/rules.ts`); `loadBookingRules` (Task 3); `AffectedList`, `cancelReservations` (Task 11); `listRestaurantOptions` (Task 10); `US`, `conflictBy`, `Db` (Task 11, trong `config.ts`); `Id`, `Token`, `Meal`, `IsoDay`, `RestaurantId` (Task 9–11); `TAGS.bookingRules` (`lib/cache-tags.ts`); `DESTS`, `MEALS` (`lib/data.ts`).
- Produces:
  - `lib/server/booking/config.ts`: `type ClosureScope`; `type ClosureInput` (`publicReason: Record<locale, string>`); `type ClosureView = ClosureInput & { id; token }`; `listClosures(db, from)`; `createClosure(pool, actor, input)` → `{ ok: true; data: { id } }`; `updateClosure(pool, actor, input & { id; token })`; `deleteClosure(pool, actor, { id, token })`; `restaurantsInScope(db, scope): Promise<string[]>`.
  - `lib/server/booking/affected.ts`: `findAffected(pool, { closureId, now? })` (chế độ ngày đóng cửa).
  - `lib/admin/booking-schemas.ts`: `ClosureForm`.
  - `app/admin/(shell)/reservations/closures/actions.ts`: `addClosure`, `editClosure`, `removeClosure` (`schedule:update`).

- [ ] **Bước 1: Viết test**

Ca đầu của schema là lỗi spike gặp: phạm vi "nhà hàng" không render ô điểm đến, nên `destinationId` đến zod là `undefined`:

```diff
diff --git a/lib/admin/booking-schemas.test.ts b/lib/admin/booking-schemas.test.ts
index eaa2056..1f2546d 100644
--- a/lib/admin/booking-schemas.test.ts
+++ b/lib/admin/booking-schemas.test.ts
@@ -1,5 +1,16 @@
 import { describe, expect, it } from 'vitest';
-import { AutoConfirmForm, CancelManyForm, EditForm, NewReservationForm, NoteForm, PeriodsForm, RulesForm, SettingsForm, TransitionForm } from './booking-schemas';
+import {
+  AutoConfirmForm,
+  CancelManyForm,
+  ClosureForm,
+  EditForm,
+  NewReservationForm,
+  NoteForm,
+  PeriodsForm,
+  RulesForm,
+  SettingsForm,
+  TransitionForm,
+} from './booking-schemas';
 
 /* The booking screens' action inputs (spec §7.3): FormData strings in, typed values or Vietnamese field errors out. */
 describe('booking form schemas', () => {
@@ -121,4 +132,33 @@ describe('booking form schemas', () => {
     expect(['inherit', 'on', 'off'].map((autoConfirm) => AutoConfirmForm.parse({ ...base, autoConfirm }).autoConfirm)).toEqual([null, true, false]);
     expect(AutoConfirmForm.safeParse({ ...base, autoConfirm: 'yes' }).success).toBe(false);
   });
+
+  it('a closure: the target its scope needs, no meal ticked for the whole day, reasons within the database’s limits', () => {
+    // Found by the spike's E2E: the destination select is not rendered for scope 'restaurant', so it arrives undefined.
+    expect(
+      ClosureForm.parse({ scope: 'restaurant', restaurantId: 'pho-cuon', startsOn: '2026-10-07', endsOn: '2026-10-07', meals: [], reasonEn: '', reasonVi: '', internalNote: '' }),
+    ).toEqual({
+      scope: 'restaurant',
+      destinationId: null,
+      restaurantId: 'pho-cuon',
+      startsOn: '2026-10-07',
+      endsOn: '2026-10-07',
+      meals: [],
+      showReason: false,
+      reasonEn: null,
+      reasonVi: null,
+      internalNote: null,
+    });
+    expect(
+      ClosureForm.safeParse({ scope: 'destination', startsOn: '2026-10-07', endsOn: '2026-10-06', meals: ['Brunch'], reasonEn: 'x'.repeat(161) }).error?.flatten()
+        .fieldErrors,
+    ).toEqual({
+      meals: [expect.any(String)],
+      reasonEn: ['Tối đa 160 ký tự.'],
+    });
+    expect(ClosureForm.safeParse({ scope: 'destination', startsOn: '2026-10-07', endsOn: '2026-10-06', meals: [] }).error?.flatten().fieldErrors).toEqual({
+      endsOn: ['Ngày kết thúc phải từ ngày bắt đầu trở đi.'],
+      destinationId: ['Chọn điểm đến.'],
+    });
+  });
 });
```

```diff
diff --git a/test/guards/require-permission.guard.test.ts b/test/guards/require-permission.guard.test.ts
index 4ee9fe2..39e5b4d 100644
--- a/test/guards/require-permission.guard.test.ts
+++ b/test/guards/require-permission.guard.test.ts
@@ -61,6 +61,11 @@ const BOOKING_ACTIONS: Record<string, Record<string, { permission: object; edito
     createReservation: { permission: { reservations: ['create'] }, editor: true },
     cancelReservations: { permission: { reservations: ['update'] }, editor: true },
   },
+  'app/admin/(shell)/reservations/closures/actions.ts': {
+    addClosure: { permission: { schedule: ['update'] }, editor: true },
+    editClosure: { permission: { schedule: ['update'] }, editor: true },
+    removeClosure: { permission: { schedule: ['update'] }, editor: true },
+  },
   'app/admin/(shell)/restaurants/[id]/booking/actions.ts': {
     savePeriods: { permission: { schedule: ['update'] }, editor: true },
     saveRules: { permission: { reservations: ['configure'] }, editor: true },
```

Ba test của khối "closures": ghi và đọc lại kèm audit; đúng những đặt bàn một ngày đóng cửa che (phạm vi, hai đầu khoảng ngày, bữa; đặt bàn dưới hai ngày đóng cửa có trong cả hai danh sách; phạm vi `all`); và không bao giờ liệt kê trạng thái không chờ khách hay giờ ngồi đã bắt đầu:

```diff
diff --git a/test/integration/booking-config.test.ts b/test/integration/booking-config.test.ts
index 6b27a98..f787c30 100644
--- a/test/integration/booking-config.test.ts
+++ b/test/integration/booking-config.test.ts
@@ -4,14 +4,20 @@ import { planDay } from '@/lib/booking/resolve-day';
 import type { AuditActor } from '@/lib/server/audit';
 import { findAffected } from '@/lib/server/booking/affected';
 import {
+  createClosure,
+  deleteClosure,
   getBookingSettings,
   getRestaurantBooking,
+  listClosures,
   loadPeriods,
   overlappingPeriods,
+  restaurantsInScope,
   saveAutoConfirm,
   saveBookingSettings,
   saveRestaurantRules,
   saveServicePeriods,
+  updateClosure,
+  type ClosureInput,
   type PeriodInput,
 } from '@/lib/server/booking/config';
 import { createWebReservation } from '@/lib/server/booking/create';
@@ -231,4 +237,101 @@ describe.skipIf(!TEST_DATABASE_URL)('booking configuration (database)', () => {
       ]);
     });
   });
+
+  describe('closures', () => {
+    const closure = (over: Partial<ClosureInput> = {}): ClosureInput => ({
+      scope: 'restaurant',
+      destinationId: null,
+      restaurantId: 'taya-house',
+      startsOn: '2026-10-05',
+      endsOn: '2026-10-06',
+      meals: null,
+      showReason: true,
+      publicReason: { en: 'Private event', vi: 'Sự kiện riêng' },
+      internalNote: 'Tiệc cưới',
+      ...over,
+    });
+    const idOf = (result: unknown) => (result as { data: { id: string } }).data.id;
+
+    it('creates, reads back with its reasons, updates and deletes, each with an audit row', async () => {
+      const id = idOf(await createClosure(pool, ACTOR, closure()));
+      let [view] = await listClosures(pool, '2026-10-02');
+      expect(view).toMatchObject({
+        id,
+        scope: 'restaurant',
+        restaurantId: 'taya-house',
+        startsOn: '2026-10-05',
+        endsOn: '2026-10-06',
+        meals: null,
+        showReason: true,
+        publicReason: { en: 'Private event', vi: 'Sự kiện riêng' },
+        internalNote: 'Tiệc cưới',
+      });
+      // A typed reason is reviewed, by a human (spec §5.1.4); the guest reads it in their language.
+      expect((await pool.query(`SELECT locale, status, origin, reviewed_by FROM closure_i18n WHERE closure_id = $1 ORDER BY locale`, [id])).rows).toEqual([
+        { locale: 'en', status: 'reviewed', origin: 'human', reviewed_by: ACTOR.id },
+        { locale: 'vi', status: 'reviewed', origin: 'human', reviewed_by: ACTOR.id },
+      ]);
+      expect(await updateClosure(pool, ACTOR, { ...closure({ meals: ['Dinner'], publicReason: { en: 'Closed for dinner' } }), id, token: view.token })).toEqual({
+        ok: true,
+        data: null,
+      });
+      [view] = await listClosures(pool, '2026-10-02');
+      expect(view).toMatchObject({ meals: ['Dinner'], publicReason: { en: 'Closed for dinner' } });
+      expect(await updateClosure(pool, ACTOR, { ...closure(), id, token: 'stale' })).toMatchObject({ ok: false, code: 'conflict' });
+      expect(await deleteClosure(pool, ACTOR, { id, token: 'stale' })).toMatchObject({ ok: false, code: 'conflict' });
+      expect(await deleteClosure(pool, ACTOR, { id, token: view.token })).toEqual({ ok: true, data: null });
+      expect(await deleteClosure(pool, ACTOR, { id, token: view.token })).toEqual({ ok: false, code: 'not_found' });
+      expect(await listClosures(pool, '2026-10-02')).toEqual([]);
+      expect((await audit()).map((a) => `${a.action}:${a.entity_type}:${a.entity_id === id}`)).toEqual([
+        'create:closure:true',
+        'update:closure:true',
+        'delete:closure:true',
+      ]);
+      // A closure that ended before `from` is not listed.
+      await createClosure(pool, ACTOR, closure({ startsOn: '2026-09-20', endsOn: '2026-09-21' }));
+      expect(await listClosures(pool, '2026-10-02')).toEqual([]);
+    });
+
+    it('lists exactly the bookings a closure covers: its scope, both end dates, its meals', async () => {
+      const dinner5 = await seed({ date: '2026-10-05', time: '19:00' });
+      const lunch5 = await seed({ date: '2026-10-05', time: '12:00' });
+      const dinner7 = await seed({ date: '2026-10-07', time: '19:00' });
+      const elsewhere = await seed({ date: '2026-10-05', time: '19:00', restaurant: 'pho-cuon' });
+      const dinner8 = await seed({ date: '2026-10-08', time: '19:00' });
+
+      const meal = idOf(await createClosure(pool, ACTOR, closure({ meals: ['Dinner'] })));
+      expect((await findAffected(pool, { closureId: meal, now: NOW })).map((a) => a.id)).toEqual([dinner5]);
+
+      // The resort: Tàya House is there, Phố Cuốn (the Dining House) is not; the 7th is the last day.
+      const resort = idOf(await createClosure(pool, ACTOR, closure({ scope: 'destination', destinationId: 'resort', restaurantId: null, endsOn: '2026-10-07' })));
+      const covered = await findAffected(pool, { closureId: resort, now: NOW });
+      expect(covered.map((a) => a.id)).toEqual([lunch5, dinner5, dinner7]);
+      expect(covered.every((a) => a.kind === 'closed' && a.closureId === resort)).toBe(true);
+      expect(covered.map((a) => a.id)).not.toContain(elsewhere);
+      expect(covered.map((a) => a.id)).not.toContain(dinner8);
+      // Dinner on the 5th is under both closures, so both lists show it.
+      expect((await findAffected(pool, { closureId: meal, now: NOW })).map((a) => a.id)).toEqual([dinner5]);
+
+      const all = idOf(await createClosure(pool, ACTOR, closure({ scope: 'all', restaurantId: null, startsOn: '2026-10-05', endsOn: '2026-10-05' })));
+      expect((await findAffected(pool, { closureId: all, now: NOW })).map((a) => a.id).sort()).toEqual([dinner5, lunch5, elsewhere].sort());
+
+      expect(await restaurantsInScope(pool, { scope: 'destination', destinationId: 'resort', restaurantId: null })).toEqual(
+        expect.arrayContaining(['taya-house', 'cafe-indochine', 'hai-van-lounge']),
+      );
+      expect(await restaurantsInScope(pool, { scope: 'restaurant', destinationId: null, restaurantId: 'pho-cuon' })).toEqual(['pho-cuon']);
+      expect(await restaurantsInScope(pool, { scope: 'all', destinationId: null, restaurantId: null })).toHaveLength(12);
+      // Listed, never cancelled.
+      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM reservations WHERE status = 'confirmed'`);
+      expect(rows[0].n).toBe(5);
+    });
+
+    it('never lists cancelled, declined, seated or no-show bookings, nor a sitting that has started', async () => {
+      const requested = await seed({ date: '2026-10-02', time: '19:00', status: 'requested' });
+      for (const status of ['cancelled', 'declined', 'seated', 'no_show']) await seed({ date: '2026-10-02', time: '19:00', status });
+      await seed({ date: '2026-10-02', time: '12:00' }); // 12:00 has started at 13:00
+      const id = idOf(await createClosure(pool, ACTOR, closure({ startsOn: '2026-10-02', endsOn: '2026-10-02' })));
+      expect((await findAffected(pool, { closureId: id, now: new Date('2026-10-02T13:00:00+07:00') })).map((a) => a.id)).toEqual([requested]);
+    });
+  });
 });
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/admin/booking-schemas.test.ts test/guards/require-permission.guard.test.ts test/integration/booking-config.test.ts`
Expected: FAIL `Test Files  3 failed (3)`, `Tests  5 failed | 41 passed (46)`:

```
 FAIL  lib/admin/booking-schemas.test.ts > booking form schemas > a closure: the target its scope needs, no meal ticked for the whole day, reasons within the database’s limits
TypeError: Cannot read properties of undefined (reading 'parse')
 FAIL  test/guards/require-permission.guard.test.ts > booking actions follow the permission matrix (spec §7.1) > app/admin/(shell)/reservations/closures/actions.ts
Error: ENOENT: no such file or directory, open '…/app/admin/(shell)/reservations/closures/actions.ts'
 FAIL  test/integration/booking-config.test.ts > booking configuration (database) > closures > creates, reads back with its reasons, updates and deletes, each with an audit row
TypeError: createClosure is not a function
 FAIL  test/integration/booking-config.test.ts > booking configuration (database) > closures > lists exactly the bookings a closure covers: its scope, both end dates, its meals
 FAIL  test/integration/booking-config.test.ts > booking configuration (database) > closures > never lists cancelled, declined, seated or no-show bookings, nor a sitting that has started
```

- [ ] **Bước 3: Viết E2E**

Test đầu tích hai đặt bàn, rồi đổi một cái trong DB trước khi bấm Hủy: cái đó phải được bỏ qua và đếm. Test thứ hai là A2 qua admin: khách thấy ngày xám với lý do công khai, rồi thấy nó mở lại khi ngày đóng cửa bị xóa.

```ts
import type { Page } from '@playwright/test';
import { formatDay } from '../lib/venue-time';
import { expectHydrated, watchCsp } from './csp';
import { HOME_PATH } from './paths';
import { reservationRow, seedReservation, venueDay } from './reservation-fixtures';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * Closures (spec §10.1, §14.1 phase 4): a closure made in the admin lists the
 * bookings it takes out and cancels only what staff tick, skipping one that
 * changed since the page was drawn; the guest sees the day greyed out with
 * the public reason. Phố Cuốn at +5 and the MM Supercenter (Yum Food Village,
 * ChaoShan Hotpot) at +11: dates no other spec books there. Each test deletes
 * its closure.
 */

test.beforeAll(() => seedStaff());
test.use({ reducedMotion: 'reduce' });

/** Fills the "Thêm ngày đóng cửa" form; the internal note names the closure's card afterwards. */
async function addClosure(
  page: Page,
  c: { scope: 'restaurant' | 'destination'; target: string; from: string; to: string; meals?: string[]; reasonEn?: string; note: string },
) {
  const add = page.getByRole('form', { name: 'Thêm ngày đóng cửa' });
  await add.getByLabel('Phạm vi', { exact: true }).selectOption(c.scope);
  await add.getByLabel(c.scope === 'restaurant' ? 'Nhà hàng' : 'Điểm đến', { exact: true }).selectOption(c.target);
  await add.getByLabel('Từ ngày', { exact: true }).fill(c.from);
  await add.getByLabel('Đến ngày', { exact: true }).fill(c.to);
  for (const meal of c.meals ?? []) await add.getByRole('checkbox', { name: meal, exact: true }).check();
  if (c.reasonEn) await add.getByLabel('Lý do cho khách (EN)', { exact: true }).fill(c.reasonEn);
  await add.getByLabel('Ghi chú nội bộ (khách không thấy)', { exact: true }).fill(c.note);
  await add.getByRole('button', { name: 'Thêm ngày đóng cửa' }).click();
  await expect(add.getByRole('status')).toHaveText('Đã thêm ngày đóng cửa.');
  return page.getByRole('region').filter({ hasText: c.note });
}

test('a dinner closure lists the dinner bookings, not lunch, and cancels only the ticked one that has not changed', async ({ page }) => {
  // Phố Cuốn, five days out.
  const date = venueDay(5);
  const dinner = await seedReservation({ restaurant: 'pho-cuon', date, time: '19:00' });
  const changed = await seedReservation({ restaurant: 'pho-cuon', date, time: '19:30', status: 'confirmed' });
  const lunch = await seedReservation({ restaurant: 'pho-cuon', date, time: '12:00', meal: 'Lunch', status: 'confirmed' });
  const note = `E2E dinner ${Date.now().toString(36)}`;
  try {
    const violations = await watchCsp(page);
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/reservations/closures');
    await expectHydrated(page);
    const card = await addClosure(page, { scope: 'restaurant', target: 'pho-cuon', from: date, to: date, meals: ['Dinner'], note });

    const affected = card.getByRole('form', { name: /^Đặt bàn bị ảnh hưởng/ });
    await expect(affected.getByRole('row').filter({ hasText: dinner.reference })).toBeVisible();
    await expect(affected.getByRole('row').filter({ hasText: changed.reference })).toBeVisible();
    // A dinner closure leaves lunch alone, and lists without cancelling.
    await expect(affected.getByRole('row').filter({ hasText: lunch.reference })).toHaveCount(0);
    expect((await reservationRow(dinner.id)).status).toBe('requested');

    await affected.getByRole('checkbox', { name: `Chọn ${dinner.reference}` }).check();
    await affected.getByRole('checkbox', { name: `Chọn ${changed.reference}` }).check();
    // Someone else changes the second booking after the list was drawn.
    await one(`UPDATE reservations SET note = 'Đổi ý' WHERE id = $1`, [changed.id]);
    await affected.getByLabel('Lý do hủy', { exact: true }).fill('Nhà hàng đóng cửa ca tối');
    await affected.getByRole('button', { name: 'Hủy các đặt bàn đã chọn' }).click();
    // The page re-renders: the cancelled booking leaves the list, the outcome stays on screen.
    await expect(card.getByRole('status')).toHaveText('Đã hủy 1 đặt bàn; 1 đặt bàn vừa thay đổi nên chưa hủy, hãy xem lại.');
    await expect(card.getByRole('row').filter({ hasText: dinner.reference })).toHaveCount(0);
    expect(await reservationRow(dinner.id)).toMatchObject({ status: 'cancelled', status_reason: 'Nhà hàng đóng cửa ca tối' });
    expect((await reservationRow(changed.id)).status).toBe('confirmed');
    expect((await reservationRow(lunch.id)).status).toBe('confirmed');
    // The closure is in the audit log; the cancellation is a reservation event only (spec §7.4).
    expect(await one(`SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'closure' AND after->>'internalNote' = $1`, [note])).toEqual({ n: 1 });
    expect(await one(`SELECT count(*)::int AS n FROM reservation_events WHERE reservation_id = $1 AND to_status = 'cancelled'`, [dinner.id])).toEqual({ n: 1 });
    expect(await one(`SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'reservation'`)).toEqual({ n: 0 });
    expect(violations).toEqual([]);
  } finally {
    await one(`DELETE FROM closures WHERE internal_note = $1`, [note]);
  }
});

test('a closure of a destination greys the day out for its restaurants’ guests, with the public reason, until it is deleted', async ({ page }) => {
  const date = venueDay(11);
  const note = `E2E festival ${Date.now().toString(36)}`;
  try {
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/reservations/closures');
    await expectHydrated(page);
    const card = await addClosure(page, { scope: 'destination', target: 'mm', from: date, to: date, reasonEn: 'Closed for the lantern festival', note });
    await expect(card).toContainText('Cả ngày');

    // The guest: Yum Food Village is at the MM Supercenter.
    await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
    await page.goto(HOME_PATH);
    await page.locator('.rcard:visible', { hasText: 'Yum Food Village' }).first().click();
    const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
    const chip = drawer.locator('.daystrip .day').nth(11);
    await expect(chip).toHaveAttribute('aria-disabled', 'true');
    await expect(chip).toHaveAttribute('data-state', 'closed');
    await expect(chip).toHaveAttribute('aria-label', `${formatDay(date).label}: Closed for the lantern festival`);

    // Deleted (after a confirmation), the day is bookable again.
    await page.goto('/admin/reservations/closures');
    await expectHydrated(page);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('region').filter({ hasText: note }).getByRole('button', { name: 'Xóa ngày đóng cửa' }).click();
    await expect(page.getByRole('region').filter({ hasText: note })).toHaveCount(0);
    await page.goto(HOME_PATH);
    await page.locator('.rcard:visible', { hasText: 'Yum Food Village' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Reserve a table' }).locator('.daystrip .day').nth(11)).toHaveAttribute('data-state', 'open');
    expect(await one(`SELECT array_agg(action ORDER BY id) AS actions FROM audit_log WHERE entity_type = 'closure' AND (after->>'internalNote' = $1 OR before->>'internalNote' = $1)`, [note])).toEqual({
      actions: ['create', 'delete'],
    });
  } finally {
    await one(`DELETE FROM closures WHERE internal_note = $1`, [note]);
  }
});
```

- [ ] **Bước 4: Build code hiện tại và chạy đặc tả: phải đỏ**

Cất tạm các file ngoài `e2e/`, build, chạy `e2e/admin-closures.spec.ts --project=desktop`. Expected: `2 failed`, cả hai `Error: locator.selectOption: Test timeout of 30000ms exceeded.` (trang chưa có form "Thêm ngày đóng cửa"). Lấy lại các file đã cất.

- [ ] **Bước 5: Viết phần ghi và chế độ ngày đóng cửa**

Bản chụp audit đọc lại từ DB với cùng các khóa ở `before` và `after`. Lý do khách gõ ở admin là `reviewed`, `origin 'human'` (spec §5.1.4):

```diff
diff --git a/lib/server/booking/config.ts b/lib/server/booking/config.ts
index 993a45b..6eada59 100644
--- a/lib/server/booking/config.ts
+++ b/lib/server/booking/config.ts
@@ -3,6 +3,8 @@ import type { Pool, PoolClient } from 'pg';
 import { formatDateTimeVi } from '@/lib/admin/format';
 import { seatings } from '@/lib/booking/resolve-day';
 import type { PeriodRule } from '@/lib/booking/rules';
+import type { Meal } from '@/lib/data';
+import type { IsoDate } from '@/lib/venue-time';
 import { insertAudit, withTransaction, type AuditActor } from '@/lib/server/audit';
 import type { Db } from './rules';
 
@@ -266,3 +268,127 @@ export async function saveBookingSettings(pool: Pool, actor: AuditActor, input:
     return { ok: true, data: null } as const;
   });
 }
+
+// ── closures (schedule:update) ──────────────────────────────────────────────
+
+export type ClosureScope = { scope: 'all' | 'destination' | 'restaurant'; destinationId: string | null; restaurantId: string | null };
+
+export type ClosureInput = ClosureScope & {
+  startsOn: IsoDate;
+  endsOn: IsoDate;
+  /** null: the whole day. */
+  meals: Meal[] | null;
+  showReason: boolean;
+  /** locale → the guest-facing reason (closure_i18n.public_reason); a blank one is left out. */
+  publicReason: Record<string, string>;
+  internalNote: string | null;
+};
+
+export type ClosureView = ClosureInput & { id: string; token: string };
+
+const CLOSURE_COLUMNS = `c.id::text, c.scope, c.destination_id AS "destinationId", c.restaurant_id AS "restaurantId",
+  to_char(c.starts_on, 'YYYY-MM-DD') AS "startsOn", to_char(c.ends_on, 'YYYY-MM-DD') AS "endsOn", c.meals,
+  c.show_reason AS "showReason", c.internal_note AS "internalNote",
+  coalesce((SELECT jsonb_object_agg(i.locale, i.public_reason) FROM closure_i18n i WHERE i.closure_id = c.id), '{}'::jsonb) AS "publicReason",
+  ${US('c.updated_at')} AS token`;
+
+/** The closures that have not ended before `from`, soonest first. */
+export async function listClosures(db: Db, from: IsoDate): Promise<ClosureView[]> {
+  const { rows } = await db.query<ClosureView>(`SELECT ${CLOSURE_COLUMNS} FROM closures c WHERE c.ends_on >= $1::date ORDER BY c.starts_on, c.id`, [from]);
+  return rows;
+}
+
+type LockedClosure = ClosureView & { updatedBy: string | null; updatedAt: Date };
+
+async function lockClosure(client: PoolClient, id: string): Promise<LockedClosure | null> {
+  const { rows } = await client.query<LockedClosure>(
+    `SELECT ${CLOSURE_COLUMNS}, c.updated_by AS "updatedBy", c.updated_at AS "updatedAt" FROM closures c WHERE c.id = $1 FOR UPDATE`,
+    [id],
+  );
+  return rows[0] ?? null;
+}
+
+/** The closure as audit_log keeps it: the same keys before and after. */
+async function closureSnapshot(client: PoolClient, id: string): Promise<ClosureInput | null> {
+  const { rows } = await client.query<ClosureView>(`SELECT ${CLOSURE_COLUMNS} FROM closures c WHERE c.id = $1`, [id]);
+  if (!rows[0]) return null;
+  const { id: _id, token: _token, ...snapshot } = rows[0];
+  return snapshot;
+}
+
+async function writeReasons(client: PoolClient, actorId: string, closureId: string, reasons: Record<string, string>) {
+  await client.query('DELETE FROM closure_i18n WHERE closure_id = $1', [closureId]);
+  for (const [locale, reason] of Object.entries(reasons)) {
+    if (!reason) continue;
+    // Typed in an admin form: reviewed, by a human (spec §5.1.4).
+    await client.query(
+      `INSERT INTO closure_i18n (closure_id, locale, public_reason, status, origin, reviewed_by, reviewed_at, updated_by)
+       VALUES ($1, $2, $3, 'reviewed', 'human', $4, now(), $4)`,
+      [closureId, locale, reason, actorId],
+    );
+  }
+}
+
+export async function createClosure(pool: Pool, actor: AuditActor, input: ClosureInput): Promise<{ ok: true; data: { id: string } }> {
+  return withTransaction(pool, async (client) => {
+    const { rows } = await client.query<{ id: string }>(
+      `INSERT INTO closures (scope, destination_id, restaurant_id, starts_on, ends_on, meals, show_reason, internal_note, created_by, updated_by)
+       VALUES ($1, $2, $3, $4::date, $5::date, $6::text[], $7, $8, $9, $9)
+       RETURNING id::text`,
+      [input.scope, input.destinationId, input.restaurantId, input.startsOn, input.endsOn, input.meals, input.showReason, input.internalNote, actor.id],
+    );
+    const id = rows[0].id;
+    await writeReasons(client, actor.id, id, input.publicReason);
+    await insertAudit(client, actor, { action: 'create', entityType: 'closure', entityId: id, after: await closureSnapshot(client, id) });
+    return { ok: true, data: { id } } as const;
+  });
+}
+
+export async function updateClosure(
+  pool: Pool,
+  actor: AuditActor,
+  input: ClosureInput & { id: string; token: string },
+): Promise<{ ok: true; data: null } | NotFound | Conflict> {
+  return withTransaction(pool, async (client) => {
+    const locked = await lockClosure(client, input.id);
+    if (!locked) return { ok: false, code: 'not_found' } as const;
+    if (locked.token !== input.token) return conflictBy(client, locked.updatedBy, locked.updatedAt);
+    const before = await closureSnapshot(client, input.id);
+    await client.query(
+      `UPDATE closures SET scope = $2, destination_id = $3, restaurant_id = $4, starts_on = $5::date, ends_on = $6::date,
+              meals = $7::text[], show_reason = $8, internal_note = $9, updated_at = now(), updated_by = $10
+        WHERE id = $1`,
+      [input.id, input.scope, input.destinationId, input.restaurantId, input.startsOn, input.endsOn, input.meals, input.showReason, input.internalNote, actor.id],
+    );
+    await writeReasons(client, actor.id, input.id, input.publicReason);
+    await insertAudit(client, actor, { action: 'update', entityType: 'closure', entityId: input.id, before, after: await closureSnapshot(client, input.id) });
+    return { ok: true, data: null } as const;
+  });
+}
+
+export async function deleteClosure(
+  pool: Pool,
+  actor: AuditActor,
+  input: { id: string; token: string },
+): Promise<{ ok: true; data: null } | NotFound | Conflict> {
+  return withTransaction(pool, async (client) => {
+    const locked = await lockClosure(client, input.id);
+    if (!locked) return { ok: false, code: 'not_found' } as const;
+    if (locked.token !== input.token) return conflictBy(client, locked.updatedBy, locked.updatedAt);
+    const before = await closureSnapshot(client, input.id);
+    await client.query('DELETE FROM closures WHERE id = $1', [input.id]);
+    await insertAudit(client, actor, { action: 'delete', entityType: 'closure', entityId: input.id, before });
+    return { ok: true, data: null } as const;
+  });
+}
+
+/** The restaurants a closure's scope reaches, for their booking-rules:<id> tags. */
+export async function restaurantsInScope(db: Db, scope: ClosureScope): Promise<string[]> {
+  const { rows } = await db.query<{ id: string }>(
+    `SELECT id FROM restaurants
+      WHERE $1 = 'all' OR ($1 = 'destination' AND destination = $2) OR ($1 = 'restaurant' AND id = $3)
+      ORDER BY sort_order, id`,
+    [scope.scope, scope.destinationId, scope.restaurantId],
+  );
+  return rows.map((r) => r.id);
+}
```

Chế độ ngày đóng cửa dùng `closureApplies` của engine (một chỗ cài đặt, Review Focus 5) và bữa của slot theo `planDay` hiện tại:

```diff
diff --git a/lib/server/booking/affected.ts b/lib/server/booking/affected.ts
index 983fc0b..7696b96 100644
--- a/lib/server/booking/affected.ts
+++ b/lib/server/booking/affected.ts
@@ -1,7 +1,8 @@
 import 'server-only';
 import type { Pool } from 'pg';
 import { closureApplies, findPlannedSlot, planDay, type PlannedPeriod } from '@/lib/booking/resolve-day';
-import type { BookingRules, ReservationStatus } from '@/lib/booking/rules';
+import type { BookingRules, ClosureRule, ReservationStatus } from '@/lib/booking/rules';
+import type { Meal } from '@/lib/data';
 import { UPCOMING_STATUSES } from '@/lib/reservations/lifecycle';
 import { minutesUntil, venueNow, type IsoDate } from '@/lib/venue-time';
 import { loadBookedCovers, loadBookingRules } from './rules';
@@ -34,7 +35,7 @@ export type AffectedReservation = {
   closureId: string | null;
 };
 
-type Row = Omit<AffectedReservation, 'kind' | 'closureId'>;
+type Row = Omit<AffectedReservation, 'kind' | 'closureId'> & { meal: Meal };
 
 /** Staff screens never show a closure's public reason, so any language reads the same rules. */
 const STAFF_LOCALE = 'vi';
@@ -44,7 +45,7 @@ async function upcoming(pool: Pool, options: { restaurantIds?: readonly string[]
   const { rows } = await pool.query<Row>(
     `SELECT r.id::text, r.reference, r.restaurant_id AS "restaurantId", t.name AS "restaurantName",
             to_char(r.reserved_on, 'YYYY-MM-DD') AS date, r.reserved_at AS time, r.guests, r.guest_name AS name, r.phone,
-            r.status, r.version
+            r.status, r.version, r.meal
        FROM reservations r JOIN restaurants t ON t.id = r.restaurant_id
       WHERE r.status = ANY ($1::text[]) AND r.reserved_on >= $2::date
         AND ($3::date IS NULL OR r.reserved_on <= $3::date)
@@ -71,12 +72,19 @@ function planner(rules: Map<string, { rules: BookingRules }>) {
   };
 }
 
-/** Every upcoming booking (of these restaurants, from..to) the current rules leave out. */
+const affected = ({ meal: _meal, ...row }: Row, kind: AffectedKind, closureId: string | null): AffectedReservation => ({ ...row, kind, closureId });
+
+/**
+ * Rules mode: every upcoming booking (of these restaurants, from..to) the
+ * current rules leave out. Closure mode (`closureId`): every upcoming booking
+ * that one closure takes out, even one another closure also covers.
+ */
 export async function findAffected(
   pool: Pool,
-  options: { restaurantIds?: readonly string[]; from?: IsoDate; to?: IsoDate; now?: Date } = {},
+  options: { restaurantIds?: readonly string[]; from?: IsoDate; to?: IsoDate; closureId?: string; now?: Date } = {},
 ): Promise<AffectedReservation[]> {
   const now = options.now ?? new Date();
+  if (options.closureId) return closureAffected(pool, options.closureId, now);
   const from = options.from ?? venueNow(now).date;
   const rows = await upcoming(pool, { ...options, from, now });
   if (rows.length === 0) return [];
@@ -93,14 +101,39 @@ export async function findAffected(
   return rows.flatMap((row): AffectedReservation[] => {
     const loaded = rules.get(row.restaurantId);
     const hit = findPlannedSlot(planOf(row.restaurantId, row.date), row.time);
-    if (!loaded || !hit) return [{ ...row, kind: 'outside_hours', closureId: null }];
+    if (!loaded || !hit) return [affected(row, 'outside_hours', null)];
     if (hit.period.closed) {
       // The closure planDay applied: a whole-day one first, else one of this meal.
       const reaching = loaded.rules.closures.filter((c) => closureApplies(c, loaded.rules, row.date));
       const closure = reaching.find((c) => c.meals === null) ?? reaching.find((c) => c.meals?.includes(hit.period.meal));
-      return [{ ...row, kind: 'closed', closureId: closure?.id ?? null }];
+      return [affected(row, 'closed', closure?.id ?? null)];
     }
     const booked = held.get(row.restaurantId)?.[row.date]?.[row.time] ?? 0;
-    return booked > hit.capacity ? [{ ...row, kind: 'over_capacity', closureId: null }] : [];
+    return booked > hit.capacity ? [affected(row, 'over_capacity', null)] : [];
+  });
+}
+
+/** One closure's list: its scope (closureApplies, the engine's own rule), its dates, and the meal of each booking's slot. */
+async function closureAffected(pool: Pool, closureId: string, now: Date): Promise<AffectedReservation[]> {
+  const { rows: found } = await pool.query<ClosureRule>(
+    `SELECT id::text, scope, destination_id AS "destinationId", restaurant_id AS "restaurantId",
+            to_char(starts_on, 'YYYY-MM-DD') AS "startsOn", to_char(ends_on, 'YYYY-MM-DD') AS "endsOn", meals, NULL AS "publicReason"
+       FROM closures WHERE id = $1`,
+    [closureId],
+  );
+  const closure = found[0];
+  if (!closure) return [];
+  const today = venueNow(now).date;
+  const from = closure.startsOn > today ? closure.startsOn : today;
+  const rows = await upcoming(pool, { from, to: closure.endsOn, now });
+  if (rows.length === 0) return [];
+  const rules = await loadBookingRules(pool, [...new Set(rows.map((r) => r.restaurantId))], STAFF_LOCALE, from);
+  const planOf = planner(rules);
+  return rows.flatMap((row) => {
+    const loaded = rules.get(row.restaurantId);
+    if (!loaded || !closureApplies(closure, loaded.rules, row.date)) return [];
+    // The meal of the slot as the day is planned now; the booking's own meal for a time the hours no longer have.
+    const meal = findPlannedSlot(planOf(row.restaurantId, row.date), row.time)?.period.meal ?? row.meal;
+    return closure.meals === null || closure.meals.includes(meal) ? [affected(row, 'closed', closure.id)] : [];
   });
 }
```

```diff
diff --git a/lib/admin/booking-schemas.ts b/lib/admin/booking-schemas.ts
index 51966b3..8ca7b90 100644
--- a/lib/admin/booking-schemas.ts
+++ b/lib/admin/booking-schemas.ts
@@ -149,3 +149,21 @@ export const SettingsForm = z.object({
   guestAckEmail: z.preprocess((v) => v === 'on', z.boolean()),
   piiRetentionMonths: bounded(1, 120, 'Từ 1 đến 120 tháng.'),
 });
+
+/** A closure (spec §10.1): no meal ticked closes the whole day; the guest-facing reasons go to closure_i18n. */
+export const ClosureForm = z
+  .object({
+    scope: z.enum(['all', 'destination', 'restaurant'], { error: 'Chọn phạm vi.' }),
+    destinationId: z.preprocess(blankToNull, z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).nullable()),
+    restaurantId: z.preprocess(blankToNull, RestaurantId.nullable()),
+    startsOn: IsoDay,
+    endsOn: IsoDay,
+    meals: z.array(Meal).max(4),
+    showReason: z.preprocess((v) => v === 'on', z.boolean()),
+    reasonEn: z.preprocess(blankToNull, z.string().trim().max(160, { error: 'Tối đa 160 ký tự.' }).nullable()),
+    reasonVi: z.preprocess(blankToNull, z.string().trim().max(160, { error: 'Tối đa 160 ký tự.' }).nullable()),
+    internalNote: z.preprocess(blankToNull, z.string().trim().max(2000, { error: 'Tối đa 2000 ký tự.' }).nullable()),
+  })
+  .refine((c) => c.endsOn >= c.startsOn, { error: 'Ngày kết thúc phải từ ngày bắt đầu trở đi.', path: ['endsOn'] })
+  .refine((c) => c.scope !== 'restaurant' || c.restaurantId, { error: 'Chọn nhà hàng.', path: ['restaurantId'] })
+  .refine((c) => c.scope !== 'destination' || c.destinationId, { error: 'Chọn điểm đến.', path: ['destinationId'] });
```

- [ ] **Bước 6: Viết action và màn**

Create `app/admin/(shell)/reservations/closures/actions.ts` (phạm vi lúc trang vẽ đi kèm form, để sửa hay xóa làm hết hạn cả nhà hàng của phạm vi cũ):

```ts
'use server';

import { refresh, updateTag } from 'next/cache';
import { getPool } from '@/db/client';
import { ClosureForm, Id, Token } from '@/lib/admin/booking-schemas';
import { z } from '@/lib/admin/zod';
import { TAGS } from '@/lib/cache-tags';
import type { Meal } from '@/lib/data';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { createClosure, deleteClosure, restaurantsInScope, updateClosure, type ClosureInput, type ClosureScope } from '@/lib/server/booking/config';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * Closures (spec §10.1; §7.1: Editor and Admin, schedule:update): one
 * transaction with its audit_log row, then the booking-rules tag of every
 * restaurant the closure reaches, before an edit and after it. Bookings
 * already made are never touched here: the page lists them, and staff choose.
 */

function closureInput(formData: FormData): ClosureInput {
  const c = ClosureForm.parse({ ...Object.fromEntries(formData), meals: formData.getAll('meals') });
  return {
    scope: c.scope,
    destinationId: c.scope === 'destination' ? c.destinationId : null,
    restaurantId: c.scope === 'restaurant' ? c.restaurantId : null,
    startsOn: c.startsOn,
    endsOn: c.endsOn,
    // No meal ticked: the whole day.
    meals: c.meals.length ? (c.meals as Meal[]) : null,
    showReason: c.showReason,
    publicReason: { ...(c.reasonEn ? { en: c.reasonEn } : {}), ...(c.reasonVi ? { vi: c.reasonVi } : {}) },
    internalNote: c.internalNote,
  };
}

/** The scope the closure had when the page was drawn: an edit changes those restaurants' rules too. */
const Was = z.object({
  scope: z.enum(['all', 'destination', 'restaurant']),
  destinationId: z.string().max(64).nullable(),
  restaurantId: z.string().max(64).nullable(),
});
const was = (formData: FormData): ClosureScope =>
  Was.parse({ scope: formData.get('was_scope'), destinationId: formData.get('was_destination') || null, restaurantId: formData.get('was_restaurant') || null });

const Target = z.object({ id: Id, token: Token });

/** Expires booking-rules:<id> of every restaurant the scopes reach, and re-renders this page (admin data is never cached). */
async function expireRules(scopes: ClosureScope[]) {
  const pool = getPool();
  const ids = new Set((await Promise.all(scopes.map((s) => restaurantsInScope(pool, s)))).flat());
  for (const id of ids) updateTag(TAGS.bookingRules(id));
  refresh();
}

export async function addClosure(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const staff = await requirePermission({ schedule: ['update'] });
    const input = closureInput(formData);
    const result = await createClosure(getPool(), auditActor(staff), input);
    await expireRules([input]);
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function editClosure(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ schedule: ['update'] });
    const input = closureInput(formData);
    const target = Target.parse({ id: formData.get('id'), token: formData.get('token') });
    const before = was(formData);
    const result = await updateClosure(getPool(), auditActor(staff), { ...input, ...target });
    if (!result.ok) return result;
    await expireRules([before, input]);
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function removeClosure(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ schedule: ['update'] });
    const target = Target.parse({ id: formData.get('id'), token: formData.get('token') });
    const before = was(formData);
    const result = await deleteClosure(getPool(), auditActor(staff), target);
    if (!result.ok) return result;
    await expireRules([before]);
    return result;
  } catch (err) {
    return actionError(err);
  }
}
```

Create `app/admin/(shell)/reservations/closures/ClosureForm.tsx` (nhiều form trên một trang, nên id lấy từ `useId`):

```tsx
'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import { FieldError, FormMessage } from '../../_ui/FormMessage';
import { addClosure, editClosure, removeClosure } from './actions';

export type ClosureValues = {
  id: string;
  token: string;
  scope: 'all' | 'destination' | 'restaurant';
  destinationId: string | null;
  restaurantId: string | null;
  startsOn: string;
  endsOn: string;
  meals: string[];
  showReason: boolean;
  reasonEn: string;
  reasonVi: string;
  internalNote: string;
};

type Options = { restaurants: { id: string; name: string }[]; destinations: { id: string; name: string }[]; meals: string[] };

/** The closure's scope when the page was drawn, so the action can expire those restaurants' rules too. */
function WasScope({ values }: { values: ClosureValues }) {
  return (
    <>
      <input type="hidden" name="id" value={values.id} />
      <input type="hidden" name="token" value={values.token} />
      <input type="hidden" name="was_scope" value={values.scope} />
      <input type="hidden" name="was_destination" value={values.destinationId ?? ''} />
      <input type="hidden" name="was_restaurant" value={values.restaurantId ?? ''} />
    </>
  );
}

/* Add (values = null) or edit one closure. Several render on the page, so their ids come from useId. */
export function ClosureEditor({ options, values }: { options: Options; values: ClosureValues | null }) {
  const [state, action, pending] = useActionState<ActionResult<unknown> | null, FormData>(
    (prev, formData) => (values ? editClosure(prev as ActionResult | null, formData) : addClosure(prev as ActionResult<{ id: string }> | null, formData)),
    null,
  );
  const [scope, setScope] = useState(values?.scope ?? 'restaurant');
  const uid = useId();
  const form = useRef<HTMLFormElement>(null);
  // The add form starts blank again once a closure is saved (it submits without React's reset).
  useEffect(() => {
    if (!values && state?.ok) form.current?.reset();
  }, [state, values]);
  const id = (name: string) => `${uid}-${name}`;
  return (
    <form ref={form} className="a-grid-form" onSubmit={submitKeepingValues(action)} noValidate aria-label={values ? 'Sửa ngày đóng cửa' : 'Thêm ngày đóng cửa'}>
      {values ? <WasScope values={values} /> : <h2 className="a-field--wide">Thêm ngày đóng cửa</h2>}
      <FormMessage state={state} success={values ? 'Đã lưu.' : 'Đã thêm ngày đóng cửa.'} />
      <div className="a-field">
        <label htmlFor={id('scope')}>Phạm vi</label>
        <select id={id('scope')} name="scope" value={scope} onChange={(e) => setScope(e.currentTarget.value as ClosureValues['scope'])}>
          <option value="restaurant">Một nhà hàng</option>
          <option value="destination">Một điểm đến</option>
          <option value="all">Tất cả nhà hàng</option>
        </select>
      </div>
      {scope === 'restaurant' ? (
        <div className="a-field">
          <label htmlFor={id('restaurant')}>Nhà hàng</label>
          <select id={id('restaurant')} name="restaurantId" defaultValue={values?.restaurantId ?? ''} aria-describedby={id('restaurant-error')}>
            <option value="">Chọn nhà hàng</option>
            {options.restaurants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <FieldError state={state} name="restaurantId" id={id('restaurant-error')} />
        </div>
      ) : null}
      {scope === 'destination' ? (
        <div className="a-field">
          <label htmlFor={id('destination')}>Điểm đến</label>
          <select id={id('destination')} name="destinationId" defaultValue={values?.destinationId ?? ''} aria-describedby={id('destination-error')}>
            <option value="">Chọn điểm đến</option>
            {options.destinations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <FieldError state={state} name="destinationId" id={id('destination-error')} />
        </div>
      ) : null}
      <div className="a-field">
        <label htmlFor={id('starts')}>Từ ngày</label>
        <input id={id('starts')} name="startsOn" type="date" defaultValue={values?.startsOn} aria-describedby={id('starts-error')} />
        <FieldError state={state} name="startsOn" id={id('starts-error')} />
      </div>
      <div className="a-field">
        <label htmlFor={id('ends')}>Đến ngày</label>
        <input id={id('ends')} name="endsOn" type="date" defaultValue={values?.endsOn} aria-describedby={id('ends-error')} />
        <FieldError state={state} name="endsOn" id={id('ends-error')} />
      </div>
      <fieldset className="a-field a-field--wide">
        <legend>Bữa đóng cửa (không chọn: cả ngày)</legend>
        {options.meals.map((m) => (
          <label className="a-check" key={m}>
            <input type="checkbox" name="meals" value={m} defaultChecked={values?.meals.includes(m)} />
            {m}
          </label>
        ))}
      </fieldset>
      <div className="a-field">
        <label htmlFor={id('reason-en')}>Lý do cho khách (EN)</label>
        <input id={id('reason-en')} name="reasonEn" maxLength={160} defaultValue={values?.reasonEn} aria-describedby={id('reason-en-error')} />
        <FieldError state={state} name="reasonEn" id={id('reason-en-error')} />
      </div>
      <div className="a-field">
        <label htmlFor={id('reason-vi')}>Lý do cho khách (VI)</label>
        <input id={id('reason-vi')} name="reasonVi" maxLength={160} defaultValue={values?.reasonVi} aria-describedby={id('reason-vi-error')} />
        <FieldError state={state} name="reasonVi" id={id('reason-vi-error')} />
      </div>
      <label className="a-check a-field--wide">
        <input type="checkbox" name="showReason" defaultChecked={values?.showReason ?? true} />
        Hiện lý do cho khách
      </label>
      <div className="a-field a-field--wide">
        <label htmlFor={id('note')}>Ghi chú nội bộ (khách không thấy)</label>
        <input id={id('note')} name="internalNote" maxLength={2000} defaultValue={values?.internalNote} aria-describedby={id('note-error')} />
        <FieldError state={state} name="internalNote" id={id('note-error')} />
      </div>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang lưu…' : values ? 'Lưu' : 'Thêm ngày đóng cửa'}
      </button>
    </form>
  );
}

export function DeleteClosure({ values }: { values: ClosureValues }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(removeClosure, null);
  return (
    <form
      className="a-inline"
      action={action}
      onSubmit={(e) => {
        if (!window.confirm('Xóa ngày đóng cửa này? Khách sẽ đặt được bàn lại vào những ngày đó.')) e.preventDefault();
      }}
    >
      <WasScope values={values} />
      <button className="a-btn a-btn--ghost a-btn--small" type="submit" disabled={pending}>
        Xóa ngày đóng cửa
      </button>
      <FormMessage state={state && !state.ok ? state : null} />
    </form>
  );
}
```

Create `app/admin/(shell)/reservations/closures/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { getPool } from '@/db/client';
import { formatIsoDayVi } from '@/lib/admin/format';
import { DESTS, MEALS, type DestKey } from '@/lib/data';
import { STATUS_LABELS } from '@/lib/reservations/lifecycle';
import { findAffected } from '@/lib/server/booking/affected';
import { listClosures } from '@/lib/server/booking/config';
import { listRestaurantOptions } from '@/lib/server/booking/queries';
import { requirePagePermission } from '@/lib/server/dal/session';
import { venueNow } from '@/lib/venue-time';
import { AffectedList } from '../../_ui/AffectedList';
import { SectionNav } from '../_ui/SectionNav';
import { ClosureEditor, DeleteClosure, type ClosureValues } from './ClosureForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Ngày đóng cửa' };

const SCOPE_LABELS = { all: 'Tất cả nhà hàng', destination: 'Điểm đến', restaurant: 'Nhà hàng' } as const;

export default async function ClosuresPage() {
  await requirePagePermission({ schedule: ['read'] });
  const pool = getPool();
  const [closures, restaurants] = await Promise.all([listClosures(pool, venueNow().date), listRestaurantOptions(pool)]);
  // Each closure's own list (spec §10.1): never acted on automatically.
  const affected = await Promise.all(closures.map((c) => findAffected(pool, { closureId: c.id })));
  const restaurantName = new Map(restaurants.map((r) => [r.id, r.name]));
  const options = {
    restaurants,
    destinations: Object.entries(DESTS).map(([id, name]) => ({ id, name })),
    meals: [...MEALS],
  };

  return (
    <>
      <SectionNav current="/admin/reservations/closures" />
      <h1>Ngày đóng cửa</h1>
      <p className="a-lede">Khách không đặt được bàn vào những ngày, bữa đã đóng. Đặt bàn đã có không bị hủy tự động.</p>
      <ClosureEditor options={options} values={null} />
      {closures.length === 0 ? <p className="a-lede">Chưa có ngày đóng cửa nào sắp tới.</p> : null}
      {closures.map((c, i) => {
        const where =
          c.scope === 'all'
            ? SCOPE_LABELS.all
            : c.scope === 'destination'
              ? `${SCOPE_LABELS.destination}: ${DESTS[c.destinationId as DestKey] ?? c.destinationId}`
              : `${SCOPE_LABELS.restaurant}: ${restaurantName.get(c.restaurantId ?? '') ?? c.restaurantId}`;
        const values: ClosureValues = {
          id: c.id,
          token: c.token,
          scope: c.scope,
          destinationId: c.destinationId,
          restaurantId: c.restaurantId,
          startsOn: c.startsOn,
          endsOn: c.endsOn,
          meals: c.meals ?? [],
          showReason: c.showReason,
          reasonEn: c.publicReason.en ?? '',
          reasonVi: c.publicReason.vi ?? '',
          internalNote: c.internalNote ?? '',
        };
        const title = `${where} · ${formatIsoDayVi(c.startsOn)}${c.endsOn !== c.startsOn ? ` – ${formatIsoDayVi(c.endsOn)}` : ''}`;
        return (
          <section className="a-card-row" key={c.id} aria-label={title}>
            <h2>{title}</h2>
            <p>
              {c.meals ? `Bữa: ${c.meals.join(', ')}` : 'Cả ngày'}
              {c.publicReason.en ? ` · Lý do cho khách: ${c.publicReason.en}${c.showReason ? '' : ' (đang ẩn)'}` : ''}
              {c.internalNote ? ` · Ghi chú nội bộ: ${c.internalNote}` : ''}
            </p>
            <details>
              <summary>Sửa</summary>
              <ClosureEditor options={options} values={values} />
            </details>
            <DeleteClosure values={values} />
            <h3>Đặt bàn bị ảnh hưởng</h3>
            <AffectedList
              title={`Đặt bàn bị ảnh hưởng bởi ${title}`}
              items={affected[i].map((a) => ({
                id: a.id,
                version: a.version,
                reference: a.reference,
                restaurantName: a.restaurantName,
                dayLabel: formatIsoDayVi(a.date),
                time: a.time,
                guests: a.guests,
                name: a.name,
                statusLabel: STATUS_LABELS[a.status],
                why: 'Nằm trong ngày đóng cửa',
              }))}
            />
          </section>
        );
      })}
    </>
  );
}
```

```diff
diff --git a/app/admin/(shell)/reservations/_ui/SectionNav.tsx b/app/admin/(shell)/reservations/_ui/SectionNav.tsx
index 41a9bd6..58978b2 100644
--- a/app/admin/(shell)/reservations/_ui/SectionNav.tsx
+++ b/app/admin/(shell)/reservations/_ui/SectionNav.tsx
@@ -4,6 +4,7 @@ const LINKS = [
   { href: '/admin/reservations', label: 'Hộp thư' },
   { href: '/admin/reservations/new', label: 'Tạo đặt bàn' },
   { href: '/admin/reservations/day', label: 'Theo ngày' },
+  { href: '/admin/reservations/closures', label: 'Ngày đóng cửa' },
 ] as const;
 
 /* The reservations section's own links (spec §7.2), above each of its pages; hidden when printing. */
```

```diff
diff --git a/styles/admin.css b/styles/admin.css
index 09ec7f3..9fda275 100644
--- a/styles/admin.css
+++ b/styles/admin.css
@@ -761,3 +761,20 @@ fieldset.a-field legend {
 .a-affected .a-table {
   margin-bottom: 12px;
 }
+
+.a-card-row {
+  margin: 0 0 24px;
+  padding: 16px 20px;
+  border: 1px solid var(--a-line);
+  border-radius: var(--a-radius);
+  background: var(--a-surface);
+}
+
+.a-card-row h2 {
+  margin-top: 0;
+}
+
+.a-inline {
+  display: inline-block;
+  margin: 8px 0;
+}
```

- [ ] **Bước 7: Chạy lại test**

Run: lệnh ở Bước 2.
Expected: PASS `Test Files  3 passed (3)`, `Tests  46 passed (46)`

- [ ] **Bước 8: Chạy cổng kiểm tra**

Expected: typecheck không lỗi; lint thoát 0, 19 cảnh báo; `Test Files  53 passed (53)`, `Tests  572 passed (572)`; `Applied 6 migration(s).`; build thoát 0; check-prerender thêm `/admin/reservations/closures`; E2E `95 passed`; visual `8 passed`.

- [ ] **Bước 9: Commit**

```bash
git add "app/admin/(shell)/reservations/_ui/SectionNav.tsx" "app/admin/(shell)/reservations/closures/page.tsx" "app/admin/(shell)/reservations/closures/ClosureForm.tsx" "app/admin/(shell)/reservations/closures/actions.ts" lib/admin/booking-schemas.ts lib/admin/booking-schemas.test.ts lib/server/booking/affected.ts lib/server/booking/config.ts styles/admin.css test/guards/require-permission.guard.test.ts test/integration/booking-config.test.ts e2e/admin-closures.spec.ts
git commit -m "$(cat <<'EOF'
feat: add closures, each listing the bookings it takes out for staff to cancel

/admin/reservations/closures (Editor and Admin, schedule:update) adds,
edits and deletes closures: one restaurant, one destination or every
restaurant, inclusive dates, chosen meals or the whole day, a public
reason in English and Vietnamese (reviewed, by a human) shown or hidden,
and an internal note. Each write is token-guarded, writes its 'closure'
audit row with the same keys before and after, and expires the
booking-rules tag of every restaurant in the old and the new scope.

Each closure lists the upcoming bookings it covers, decided with the
engine's closureApplies and the meal of each slot as planned: its scope,
both end dates, its meals; a booking under two closures is in both lists;
cancelled, declined, seated, no-show or started sittings never are.
Nothing is cancelled until staff tick and give a reason; a booking that
changed since the page was drawn is skipped and counted. The guest's day
goes grey with the public reason on the next calendar fetch.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 14: Nghiệm thu đợt 4, tài liệu vận hành, cổng cuối

Một spec đi qua đúng màn hình khách và nhân viên dùng cho từng tiêu chí nghiệm thu của spec §14.1 dòng 4 (A1–A6), mỗi test được chạy thêm một lần với guard nó dựa vào bị gỡ (sáu lần build). README ghi cách đưa migration 006 lên Neon an toàn (sau 005, cùng code đợt 4, kiểm trước và sau), cách kiểm khóa ngày đặt bàn qua URL pooled của Neon, các route và màn mới, và bản đồ dữ liệu E2E. Cổng cuối chạy hai lần, cộng một lần E2E với `TZ=UTC` trên tiến trình `next start` (múi giờ của Vercel).

**Files:**
- Create: `e2e/booking-acceptance.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: mọi màn và action của Task 6–13; `seedReservation`, `reservationRow`, `venueDay` (Task 9); `db`, `one`, `STAFF`, `signInAs`, `seedStaff` (`e2e/staff-fixtures.ts`); `formatDay` (`lib/venue-time.ts`); `expectHydrated` (`e2e/csp.ts`).
- Produces: `e2e/booking-acceptance.spec.ts`; các mục "Migration 006 (phase 4: booking v2)" và bản đồ dữ liệu E2E trong README.

- [ ] **Bước 1: Viết spec nghiệm thu**

Yum Food Village (MM Supercenter, Lunch và Dinner, 60 chỗ một khung) ở những ngày không spec nào khác đặt ở đó. Các test của file chạy nối tiếp trong một worker và trả lại quy tắc chúng đổi; vì cùng đổi quy tắc của Yum, file này không chạy với `--repeat-each` (các lần lặp chạy song song).

A1 phát lại 8 lần chính Server Action mà form khách vừa gửi (đổi số điện thoại, vì index chống trùng sẽ từ chối lần lặp). Qua một `next start`, 8 POST gần như không chồng nhau: lần chạy thử đầu không có cổng vẫn xanh khi khóa bị gỡ. Nên test giữ `LOCK TABLE reservations IN SHARE MODE` cho tới khi có 5 người chờ khóa (pool của app có 5 kết nối, `db/client.ts`): khi đó 5 request đã ở trong transaction cùng lúc, và chỉ khóa ngày đặt bàn ngăn cả năm cùng đọc "còn 4 chỗ".

Create `e2e/booking-acceptance.spec.ts`:

```ts
import type { Browser, Page } from '@playwright/test';
import { formatDay } from '../lib/venue-time';
import { expectHydrated } from './csp';
import { HOME_PATH } from './paths';
import { reservationRow, seedReservation, venueDay } from './reservation-fixtures';
import { STAFF, db, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * Spec §14.1, phase 4 ("Đặt bàn v2"), each acceptance criterion end to end
 * through the screens a guest and the staff use:
 *   A1 concurrent bookings never exceed capacity;
 *   A2 closed days are greyed out for guests;
 *   A3 confirm, cancel and no-show work correctly;
 *   A4 an Editor changes the dinner hours and capacity, and the guest sees the new slots at once;
 *   A5 max_party = 8 makes the form block 9 guests;
 *   A6 the bookings a change leaves out are listed (and never cancelled on their own).
 * Yum Food Village (MM Supercenter, Lunch and Dinner, 60 covers a slot) at
 * dates no other spec books there. The tests of this file run in order, in
 * one worker, and each puts back the rules it changed; they share Yum's
 * rules, so this file is never run with --repeat-each (repeats would run in
 * parallel workers).
 */

test.beforeAll(() => seedStaff());
test.use({ reducedMotion: 'reduce' }); // no reveal animation on the booking bar

const YUM = 'yum-food-village';
const SEED_DINNER = `UPDATE service_periods SET last_seating = '21:00', covers_per_slot = 60 WHERE restaurant_id = '${YUM}' AND meal = 'Dinner'`;
const CLEAR_AUDIT = `DELETE FROM audit_log WHERE entity_id = '${YUM}'`;

/** A guest in a browser of their own (no staff cookie), past the intro. */
async function guestPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

/** The guest opens Yum Food Village's drawer from its card (it has no page of its own) and picks the day `days` out. */
async function openYum(page: Page, days: number) {
  await page.goto(HOME_PATH);
  await page.locator('.rcard:visible', { hasText: 'Yum Food Village' }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  const day = drawer.locator('.daystrip .day').nth(days);
  return { drawer, day };
}

const heldCovers = async (date: string, time: string) =>
  (
    await one<{ covers: number }>(
      `SELECT coalesce(sum(guests), 0)::int AS covers FROM reservations
        WHERE restaurant_id = $1 AND reserved_on = $2 AND reserved_at = $3 AND status IN ('requested', 'confirmed', 'seated')`,
      [YUM, date, time],
    )
  )!.covers;

test('A1. concurrent bookings never exceed capacity: eight replays of a guest’s request for the last four covers book two', async ({ browser }) => {
  const date = venueDay(12);
  // A slot filled by an earlier run on this database would leave nothing to race for.
  await one(`DELETE FROM reservations WHERE restaurant_id = $1 AND reserved_on = $2 AND reserved_at = '19:00'`, [YUM, date]);
  // 54 of the 60 covers at 19:00 are held: six left.
  await seedReservation({ restaurant: YUM, date, time: '19:00', guests: 50, status: 'confirmed' });
  await seedReservation({ restaurant: YUM, date, time: '19:00', guests: 4 });

  const guest = await guestPage(browser);
  const { drawer, day } = await openYum(guest, 12);
  await day.click();
  await drawer.getByRole('button', { name: '19:00 — 6 covers left' }).click();
  await drawer.getByLabel('Full name *', { exact: true }).fill('Khách Đua');
  const digits = String(Date.now()).slice(-5);
  const phone = `0907 ${digits.slice(0, 3)} ${digits.slice(3)}0`; // ten digits, the last one 0
  await drawer.getByLabel('Phone *', { exact: true }).fill(phone);
  const sent = guest.waitForRequest((r) => r.method() === 'POST' && !!r.headers()['next-action']);
  await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
  const request = await sent;
  await expect(drawer.locator('.drawer-ref')).toHaveText(/^FC-[0-9A-HJKMNP-TV-Z]{8}$/);
  expect(await heldCovers(date, '19:00')).toBe(56); // two guests: four covers left

  // The same Server Action eight times at once, each from another phone (the dedupe index would refuse a repeat).
  // Through one server the requests barely overlap, so the test holds every INSERT INTO reservations
  // back until all eight are inside their transactions: then only the booking-day lock stands
  // between them and eight readings of "four covers left".
  const body = request.postData()!;
  expect(body).toContain(phone);
  const gate = db();
  await gate.connect();
  await gate.query('BEGIN');
  await gate.query('LOCK TABLE reservations IN SHARE MODE');
  const replies = Promise.all(
    Array.from({ length: 8 }, async (_, i) => {
      const res = await guest.request.post(new URL(request.url()).pathname, {
        headers: {
          'next-action': request.headers()['next-action'],
          'content-type': request.headers()['content-type'],
          accept: 'text/x-component',
        },
        data: body.replace(phone, `${phone.slice(0, -1)}${i + 1}`),
      });
      return res.text();
    }),
  );
  try {
    // The app's pool has five connections (db/client.ts): five requests are in their transactions, the
    // other three wait for a connection. Five lock waiters: one at its INSERT and four at the
    // booking-day lock (without that lock, all five at the INSERT, each having read "four left").
    await expect
      .poll(async () => (await one<{ n: number }>(`SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted`))!.n, { timeout: 4000 })
      .toBeGreaterThanOrEqual(5);
  } finally {
    await gate.query('COMMIT');
    await gate.end();
  }
  const answers = await replies;
  expect(answers.filter((a) => a.includes('"ok":true'))).toHaveLength(2);
  expect(answers.filter((a) => a.includes('"code":"full"'))).toHaveLength(6);
  expect(await heldCovers(date, '19:00')).toBe(60);
  await guest.context().close();
});

test('A2. a day closed in the admin is greyed out for guests, with its public reason', async ({ page, browser }) => {
  const date = venueDay(13);
  const note = `E2E A2 ${Date.now().toString(36)}`;
  try {
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/reservations/closures');
    await expectHydrated(page);
    const add = page.getByRole('form', { name: 'Thêm ngày đóng cửa' });
    await add.getByLabel('Phạm vi', { exact: true }).selectOption('restaurant');
    await add.getByLabel('Nhà hàng', { exact: true }).selectOption(YUM);
    await add.getByLabel('Từ ngày', { exact: true }).fill(date);
    await add.getByLabel('Đến ngày', { exact: true }).fill(date);
    await add.getByLabel('Lý do cho khách (EN)', { exact: true }).fill('Closed for a private banquet');
    await add.getByLabel('Ghi chú nội bộ (khách không thấy)', { exact: true }).fill(note);
    await add.getByRole('button', { name: 'Thêm ngày đóng cửa' }).click();
    await expect(add.getByRole('status')).toHaveText('Đã thêm ngày đóng cửa.');

    const guest = await guestPage(browser);
    const { drawer, day } = await openYum(guest, 13);
    await expect(day).toHaveAttribute('data-state', 'closed');
    await expect(day).toHaveAttribute('aria-disabled', 'true');
    await expect(day).toHaveAttribute('aria-label', `${formatDay(date).label}: Closed for a private banquet`);
    await expect(day.locator('.day-num')).toHaveCSS('text-decoration-line', 'line-through');
    // A tap says why, and selects nothing.
    await day.click({ force: true });
    await expect(day).toHaveAttribute('aria-pressed', 'false');
    await expect(drawer.getByRole('status')).toHaveText(`${formatDay(date).label}: Closed for a private banquet`);
    await guest.context().close();
  } finally {
    await one(`DELETE FROM closures WHERE internal_note = $1`, [note]);
  }
});

test('A3. confirm, cancel and no-show work, each when it may and with what it needs', async ({ page }) => {
  const date = venueDay(12);
  const request = await seedReservation({ restaurant: YUM, date, time: '20:00' });
  const toCancel = await seedReservation({ restaurant: YUM, date, time: '20:30', status: 'confirmed' });
  const future = await seedReservation({ restaurant: YUM, date, time: '21:00', status: 'confirmed' });
  const past = await seedReservation({ restaurant: YUM, date: venueDay(-1), time: '19:00', status: 'confirmed' });
  await signInAs(page, STAFF.editor);
  const main = page.getByRole('main');

  await page.goto(`/admin/reservations/${request.id}`);
  await main.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Đã xác nhận');
  expect(await reservationRow(request.id)).toMatchObject({ status: 'confirmed', version: 2 });

  await page.goto(`/admin/reservations/${toCancel.id}`);
  await main.getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(main.getByText('Nhập lý do.')).toBeVisible();
  await page.getByLabel('Lý do (bắt buộc khi hủy hoặc từ chối)', { exact: true }).fill('Khách đổi kế hoạch');
  await main.getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Đã hủy');
  expect(await reservationRow(toCancel.id)).toMatchObject({ status: 'cancelled', status_reason: 'Khách đổi kế hoạch' });

  // Twelve days out, no-show cannot be marked yet; it opens 15 minutes after the sitting.
  await page.goto(`/admin/reservations/${future.id}`);
  await expect(main.getByRole('button', { name: 'Không đến', exact: true })).toBeDisabled();
  await expect(main.getByText(/^Từ 21:15 ngày /)).toBeVisible();

  await page.goto(`/admin/reservations/${past.id}`);
  await main.getByRole('button', { name: 'Không đến', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Không đến');
  expect((await reservationRow(past.id)).status).toBe('no_show');
  // Every change is on the booking's timeline, not in audit_log (spec §7.4).
  expect(await one(`SELECT count(*)::int AS n FROM reservation_events WHERE reservation_id = ANY ($1::bigint[]) AND type = 'status_changed'`, [[request.id, toCancel.id, past.id]])).toEqual({
    n: 3,
  });
});

test('A4. an Editor moves the last dinner seating to 22:00 with 10 covers; the guest, who saw 21:00 last, sees the new slots at once', async ({ page, browser }) => {
  try {
    const guest = await guestPage(browser);
    const before = await openYum(guest, 3);
    await before.day.click();
    await expect(before.drawer.getByRole('button', { name: '21:00 — 60 covers left' })).toBeVisible();
    await expect(before.drawer.getByRole('button', { name: /^22:00/ })).toHaveCount(0);

    await signInAs(page, STAFF.editor);
    await page.goto(`/admin/restaurants/${YUM}/booking?ngay=${venueDay(3)}`);
    await expectHydrated(page);
    const periods = page.getByRole('form', { name: 'Ca phục vụ' });
    await periods.getByLabel('Giờ cuối của ca Dinner', { exact: true }).fill('22:00');
    await periods.getByLabel('Sức chứa của ca Dinner', { exact: true }).fill('10');
    await periods.getByRole('button', { name: 'Lưu ca phục vụ' }).click();
    await expect(periods.getByRole('status')).toHaveText('Đã lưu ca phục vụ.');
    await expect(page.getByLabel('Giờ đặt trong ngày', { exact: true }).getByText('22:00 · 10/10')).toBeVisible();

    const after = await openYum(guest, 3);
    await after.day.click();
    await expect(after.drawer.getByRole('button', { name: '22:00 — 10 covers left' })).toBeVisible();
    await expect(after.drawer.getByRole('button', { name: '21:00 — 10 covers left' })).toBeVisible();
    await guest.context().close();
  } finally {
    await one(SEED_DINNER);
    await one(CLEAR_AUDIT);
  }
});

test('A5. max_party = 8 makes the guest form stop at 8 and turn a ninth guest into a phone call', async ({ page, browser }) => {
  try {
    await signInAs(page, STAFF.editor);
    await page.goto(`/admin/restaurants/${YUM}/booking`);
    await expectHydrated(page);
    const rules = page.getByRole('form', { name: 'Quy tắc đặt bàn' });
    await rules.getByLabel('Số khách tối đa', { exact: true }).fill('8');
    await rules.getByRole('button', { name: 'Lưu quy tắc' }).click();
    await expect(page.getByRole('form', { name: 'Quy tắc đặt bàn' }).getByRole('status')).toHaveText('Đã lưu.');

    const guest = await guestPage(browser);
    const { drawer } = await openYum(guest, 0);
    const more = drawer.getByRole('button', { name: 'More guests' });
    for (let i = 2; i < 8; i++) await more.click();
    await expect(drawer.locator('.guests-value')).toHaveText('8 guests');
    await expect(more).toBeDisabled();
    // The MM Supercenter has no number of its own: the first destination that has one.
    await expect(drawer.locator('.guests-hint')).toHaveText('For more than 8 guests, please call us on +84 236 651 9999.');
    await expect(drawer.locator('.guests-hint a')).toHaveAttribute('href', 'tel:+842366519999');
    await guest.context().close();
  } finally {
    await one(`UPDATE restaurants SET max_party = NULL WHERE id = $1`, [YUM]);
    await one(CLEAR_AUDIT);
  }
});

test('A6. the bookings shorter hours leave out are listed, and none is cancelled until staff choose', async ({ page }) => {
  const date = venueDay(4);
  const late = await seedReservation({ restaurant: YUM, date, time: '21:00' });
  const fine = await seedReservation({ restaurant: YUM, date, time: '19:00', status: 'confirmed' });
  try {
    await signInAs(page, STAFF.editor);
    await page.goto(`/admin/restaurants/${YUM}/booking`);
    await expectHydrated(page);
    const periods = page.getByRole('form', { name: 'Ca phục vụ' });
    await periods.getByLabel('Giờ cuối của ca Dinner', { exact: true }).fill('20:00');
    await periods.getByRole('button', { name: 'Lưu ca phục vụ' }).click();
    await expect(periods.getByRole('status')).toHaveText('Đã lưu ca phục vụ.');

    const list = page.getByRole('form', { name: 'Đặt bàn sắp tới không còn khớp giờ hoặc sức chứa' });
    await expect(list.getByRole('row').filter({ hasText: late.reference })).toContainText('Ngoài giờ phục vụ mới');
    await expect(list.getByRole('row').filter({ hasText: fine.reference })).toHaveCount(0);
    expect((await reservationRow(late.id)).status).toBe('requested');
    expect((await reservationRow(fine.id)).status).toBe('confirmed');
  } finally {
    await one(SEED_DINNER);
    await one(CLEAR_AUDIT);
  }
});
```

- [ ] **Bước 2: Chạy spec trên code hiện tại: phải xanh, hai lần trên cùng DB**

Đây là spec kiểm những gì Task 4–13 đã làm, nên RED của nó là Bước 3. Build, rồi chạy `e2e/booking-acceptance.spec.ts --project=desktop` hai lần liền (A1 tự dọn khung 19:00 của mình trước khi chạy). Expected mỗi lần: `6 passed`.

- [ ] **Bước 3: Gỡ từng guard một: mỗi lần đúng test của nó đỏ**

Với mỗi dòng dưới đây: sửa đúng chỗ đó, build, chạy `e2e/booking-acceptance.spec.ts --project=desktop`, rồi trả file về.

| # | Guard bị gỡ | Sửa | Kết quả (`1 failed`, `5 passed`) |
|---|---|---|---|
| A1 | khóa ngày đặt bàn của khách | `lib/server/booking/create.ts`: xóa `await lockBookingDay(client, input.restaurantId, input.date);` | A1: `Expected length: 2`, `Received length: 5` (5 trong 8 request được nhận: 66 khách trên 60 chỗ) |
| A2 | ngày đóng cửa trong quy tắc | `lib/server/booking/rules.ts`: `WHERE c.ends_on >= $3::date` → `WHERE false AND c.ends_on >= $3::date` | A2: `Locator: … .daystrip .day').nth(13)`, `Expected: "closed"`, `Received: "open"` |
| A3 | cửa sổ của no-show | `lib/reservations/lifecycle.ts`: `return until <= -t.window.minutes ? { ok: true } : { ok: false, code: 'too_early' };` → `return { ok: true };` | A3: `getByRole('main').getByRole('button', { name: 'Không đến', exact: true })`, `Expected: disabled`, `Received: enabled` |
| A4 | availability không cache | `app/api/availability/route.ts`: một `Map` cấp module giữ câu trả lời ngày theo nhà hàng, ngày, số khách và ngôn ngữ, trả lại khi có | A4: `getByRole('button', { name: '22:00 — 10 covers left' })`, `Error: element(s) not found` |
| A5 | `maxParty` từ server | `app/api/availability/route.ts`: cả hai `maxParty: rules.maxParty,` → `maxParty: 12,` | A5: `getByRole('button', { name: 'More guests' })`, `Expected: disabled`, `Received: enabled` |
| A6 | loại `outside_hours` | `lib/server/booking/affected.ts`: `if (!loaded \|\| !hit) return [affected(row, 'outside_hours', null)];` → `if (!loaded \|\| !hit) return [];` | A6: `Expected substring: "Ngoài giờ phục vụ mới"`, `Error: element(s) not found` |

Mỗi lần, năm test kia xanh. Sau lần cuối, build lại code thật.

- [ ] **Bước 4: Viết tài liệu vận hành**

Các truy vấn kiểm trước và sau trong README đã được chạy trên một DB cục bộ dừng ở 005 (`RESET_DATABASE_URL=… node scripts/reset-db.mjs --until 005_staff_auth_audit.sql`, thêm một đặt bàn đợt 1, rồi `node scripts/migrate.mjs`): trước `pg_trgm 1.6` có sẵn, 0 hàng `reserved_at` sai, 0 nhà hàng có bữa lạ; sau `25` ca, một hàng `booking_settings` (14, 30, NULL, 12, f, t, 24), `0` hàng thiếu `meal` hay `search_text`, đặt bàn cũ thành `legacy | t`. Sửa `README.md` đúng như diff sau:

````diff
diff --git a/README.md b/README.md
index 761c062..bc53f08 100644
--- a/README.md
+++ b/README.md
@@ -69,6 +69,28 @@ VISUAL_BASE_URL=http://localhost:3201 npm run test:visual
 kill %1   # stop the server (or: lsof -ti tcp:3201 | xargs kill)
 ```
 
+Playwright runs two projects. `desktop` holds every spec file, in parallel
+workers; `desktop-serial` holds the `*.serial.spec.ts` files and runs after
+`desktop` has finished (`dependencies`), because they change what every guest
+page reads (a restaurant's online-booking switch). Running one serial file
+also runs the whole `desktop` project first; add `--project=desktop-serial
+--no-deps` to run it alone. Spec files run at the same time, so each one books
+its own restaurant and dates, and puts back the rules it changes:
+
+| Spec | Restaurant | Dates or rules |
+| --- | --- | --- |
+| `booking-v2` | Tàya House, Don Cipriani’s, Steakhouse The Fan | the last open day; a closure at +9; `max_party` 8 |
+| `admin-reservations` | Tàya House, V-Senses Cafe, ChaoShan Hotpot | +3, +4, +6, yesterday; +8; +7 |
+| `admin-booking-config` | Thai Siam Kitchen, Hura Izakaya | dinner hours and covers (+2, +3); `max_party` 8 |
+| `admin-booking-settings` | Danaksara | `auto_confirm`; the last open day |
+| `admin-closures` | Phố Cuốn; the MM Supercenter (Yum Food Village, ChaoShan Hotpot) | +5; a destination closure at +11 |
+| `booking-acceptance` | Yum Food Village | +3, +4, +12, +13, yesterday; dinner hours, covers and `max_party` |
+| `booking-switch.serial` | Tàya House, Hải Vân Lounge | online booking off, then on again |
+
+`booking-acceptance.spec.ts` checks every phase-4 acceptance criterion of the
+spec (§14.1 row 4) through the screens. Its tests share Yum Food Village's
+rules and run in order, so never run that file with `--repeat-each`.
+
 `E2E_BASE_URL=http://localhost:<port>` points the main Playwright suite at a
 server you started yourself (for example `next dev` with the same variables)
 instead of starting one. The admin specs still write their staff accounts
@@ -120,6 +142,84 @@ tables when it starts (`database.validateSchema`) and every admin page reads
 them. 005 only adds tables, so the guest site keeps working on a migrated
 database. Apply it with `node scripts/migrate.mjs` like the others.
 
+### Migration 006 (phase 4: booking v2)
+
+`006_booking_v2.sql` adds `booking_settings`, the restaurants' booking
+switch and overrides, `service_periods` (seeded to behave exactly as before:
+the old slots of each restaurant's meals, `slot_capacity` covers each),
+`closures` and `closure_i18n`, the v2 columns of `reservations`,
+`reservation_events`, `reservation_notes` and the `pg_trgm` search index, and
+it redefines `audit_feed` to show booking events. It only adds, but the
+phase-4 code needs it and the older code cannot write a booking on it
+(`reservations.meal` is NOT NULL and `source` has no default): apply 006 to an
+environment immediately before, or together with, its first phase-4 deploy,
+as with 003. The site has never been deployed, so no live traffic breaks.
+
+006 must run after 005 (it replaces 005's `audit_feed` view and reads
+`audit_log`, `locales` and `destinations`). `scripts/migrate.mjs` applies the
+files in name order and skips the ones `_migrations` lists, so it runs 005
+first if that is missing; never apply 006 by hand with `psql -f`. It runs in
+one transaction: if any statement fails (for example `CREATE EXTENSION
+pg_trgm`), nothing of it stays.
+
+Before applying 006 to a Neon branch, run these read-only checks on that
+branch (`npm run db:psql` reads `.env.local`, so open psql on the branch's own
+URL instead):
+
+```sql
+-- 1. Exactly 001–005 applied, 006 not yet.
+SELECT name FROM _migrations ORDER BY name;
+-- 2. pg_trgm is available (an empty result means 006 would roll back).
+SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name = 'pg_trgm';
+-- 3. Every reserved_at is HH:MM (006 stops with a message otherwise; correct the rows first).
+SELECT id, reserved_at FROM reservations WHERE reserved_at !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$';
+-- 4. How many bookings become source 'legacy', is_test (they keep holding covers until purged).
+SELECT count(*), min(created_at), max(created_at) FROM reservations;
+-- 5. Every meal is one 006 knows (a restaurant with another would get no service period: closed every day).
+SELECT id, meals FROM restaurants WHERE NOT meals <@ ARRAY['Breakfast', 'Lunch', 'Dinner', 'Drinks'];
+-- 6. An override of these strings must keep the new {max}/{phone} (party_too_large) and read right for both causes (past).
+SELECT key, locale, value FROM content_strings WHERE key IN ('error.party_too_large', 'error.past', 'error.closed');
+```
+
+Then apply it with `DATABASE_URL_UNPOOLED=<the branch's direct URL> node
+scripts/migrate.mjs`, and check:
+
+```sql
+SELECT count(*) FROM service_periods;                        -- one per (restaurant, meal): 25 on the seed data
+SELECT * FROM booking_settings;                              -- one row: 14, 30, NULL, 12, false, true, 24
+SELECT count(*) FROM reservations WHERE meal IS NULL OR (search_text IS NULL AND anonymized_at IS NULL);  -- 0
+SELECT source, is_test, count(*) FROM reservations GROUP BY 1, 2;
+```
+
+The booking-day lock (`pg_advisory_xact_lock` with `SET LOCAL lock_timeout`
+inside a transaction, `lib/server/booking/lock.ts`) has only been tested on a
+direct Postgres connection. The app uses Neon's **pooled** URL, so check it
+once on a Neon branch before the first phase-4 deploy (spec §13). In two psql
+sessions on that branch's pooled URL:
+
+```sql
+-- session 1
+BEGIN;
+SELECT pg_advisory_xact_lock(hashtextextended('booking:taya-house:2030-01-01', 0));
+-- session 2: waits about 2 seconds, then fails with 55P03 (lock_timeout)
+BEGIN;
+SELECT set_config('lock_timeout', '2s', true);
+SELECT pg_advisory_xact_lock(hashtextextended('booking:taya-house:2030-01-01', 0));
+ROLLBACK;
+-- session 1
+COMMIT;
+```
+
+If session 2 does not wait, the pooler does not keep the transaction on one
+server connection and two guests could both take the last covers: stop and
+switch to the fallback of spec §16 (a lock row per restaurant and date,
+`SELECT … FOR UPDATE`).
+
+On the first preview after phase 4, check that a save under "Giờ và sức
+chứa" reaches the guest pages: switch a restaurant's online booking off, then
+open the home page a few times; every response should drop its RESERVE (the
+catalogue is cached per instance and `updateTag('restaurants')` expires it).
+
 **Never run `npx auth migrate`** (or `generate`) without
 `--config scripts/auth-cli.config.ts`: the Better Auth CLI loads `.env` and
 `.env.local` by itself, which point at the shared database. That config reads
@@ -200,9 +300,13 @@ bootstrapping production is what you mean to do.
 | `/en` | Static, `cacheLife('max')` | Home: hero, finder, cuisines, restaurants, destinations, experiences, heritage, stories, offers |
 | `/en/restaurants/[slug]` | Static for `taya-house`. Any other slug is a 404: the first visit is a soft 404 (status 200 with `noindex`), later visits get the cached 404, and without JavaScript the body is empty | Restaurant detail (Tàya House only until phase 6) |
 | `/taya-house` | Redirect | 308 to `/en/restaurants/taya-house` (`next.config.ts`) |
-| `/api/availability` | Dynamic | Booked covers per slot for one restaurant/day |
+| `/api/availability` | Dynamic, `no-store` | `?restaurant=&lang=[&from=&to=]`: each day's state (open, full, past, closed, too_large, outside) and public closure reason, with the clock, the party limit and the number to call; `?restaurant=&date=&lang=[&guests=]`: one day's services and slots with the covers left. 404 for an unknown restaurant or one with online booking off. `scripts/check-prerender.mjs` fails if it is ever prerendered |
 | `/admin/sign-in`, `/admin/accept-invite`, `/admin/reset-password` | Request time, nonce CSP | The only admin pages open without a session cookie |
-| `/admin`, `/admin/users`, `/admin/audit` | Request time, nonce CSP | Overview; staff and invitations (Admin); audit log (Admin). Without a session cookie the proxy sends them to sign-in (307, `?next=` kept) |
+| `/admin`, `/admin/users`, `/admin/audit` | Request time, nonce CSP | Overview (with pending and today's bookings); staff and invitations (Admin); audit log of `audit_log` and booking events, paged with `?truoc=`/`?sau=` (Admin). Without a session cookie the proxy sends them to sign-in (307, `?next=` kept) |
+| `/admin/reservations`, `/admin/reservations/[id]`, `/admin/reservations/day` | Request time, nonce CSP | Inbox (Cần xử lý · Hôm nay · Sắp tới · Tất cả, search by reference, phone, name or email); a booking (status changes, edit, internal notes, timeline); the printable day sheet. `reservations:read` |
+| `/admin/reservations/new` | Request time, nonce CSP | Phone bookings and walk-ins. `reservations:create` |
+| `/admin/reservations/closures`, `/admin/restaurants`, `/admin/restaurants/[id]/booking` | Request time, nonce CSP | Closures with the bookings each covers; the restaurants; "Giờ và sức chứa" (switch, overrides, service periods, slot preview, affected bookings; auto-confirm for Admins). `schedule:read` |
+| `/admin/settings/booking` | Request time, nonce CSP | Booking defaults. Admin (`settings:read`) |
 | `/api/auth/*` | Dynamic | Better Auth; `/api/auth/admin/*` is refused with 403 |
 
 Every admin page renders at request time (`app/admin/layout.tsx`: `instant =
@@ -251,21 +355,35 @@ read through cached functions in `lib/server/content/` (`'use cache'`,
 `cacheLife('max')`); their uncached loaders (`*.queries.ts`) are what the
 integration tests exercise.
 
-`reservations` records table requests. Availability is **derived from booked
-covers** against each restaurant's `slot_capacity`, replacing the design's
-placeholder hash-based availability. A slot closes when it has passed (plus 30
-minutes' lead time) or when the party would exceed the remaining covers.
-
-Guarantees in the schema:
-
-- capacity is re-checked inside the insert's transaction under `SELECT … FOR
-  UPDATE`, so two simultaneous requests for the last seats cannot both win
-- a partial unique index rejects a double submit of the same table
-- `guests` is bounded 1–12 and `restaurant_id` is a foreign key
-
-`app/actions.ts` re-validates every field, the slot's existence on that
-restaurant, the booking window and the lead time server-side — the client's
-checks are only there for immediate feedback.
+`reservations` records bookings (migration 006, phase 4). What a restaurant
+offers comes from the database, never from the code: `service_periods` (the
+weekly template: meal, weekdays, first and last seating, interval, covers per
+slot), `closures` (a restaurant, a destination or all, inclusive dates, some
+meals or the whole day, a public reason per language in `closure_i18n`) and
+`booking_settings` with each restaurant's overrides and `booking_enabled`.
+`lib/booking/resolve-day.ts` turns them into a day: `planDay` (the services
+and slots) for staff screens, and `resolveDay` (plus the window, the lead
+time, the same-day cut-off, the party limit and the covers held) for guests.
+Nothing that reads them is cached.
+
+Guarantees:
+
+- every write that takes covers (a guest's submit, a staff booking, an edit
+  that moves or grows a booking) takes one advisory lock per restaurant and
+  date (`lib/server/booking/lock.ts`) and only then reads the rules and the
+  covers, in the same transaction: concurrent requests for the last seats
+  cannot both win
+- covers are held by `requested`, `confirmed` and `seated` bookings only
+- a partial unique index rejects a second active booking of the same table,
+  time and phone
+- `version` (bumped by the `reservations_before_write` trigger on every
+  update) makes a stale admin page a conflict that names who changed it
+- every booking change is a `reservation_events` row (the timeline), never
+  an `audit_log` row; configuration changes are `audit_log` rows; the
+  `audit_feed` view shows both
+
+`app/actions.ts` (`submitReservation`) re-validates everything server-side;
+the guest form's checks are only there for immediate feedback.
 
 Migrations use the unpooled connection (DDL needs a direct session); the app
 uses the pooled one. Both pin `sslmode=verify-full`; local throwaway databases
````

- [ ] **Bước 5: Chạy cổng cuối hai lần, rồi E2E với `TZ=UTC`**

Chạy đủ khối lệnh ở "Cổng kiểm tra của mọi task" hai lần (mỗi lần reset DB và build lại). Rồi, với DB vừa reset:

```bash
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
TZ=UTC CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson E2E_PORT=3210 npm run test:e2e -- --retries=0
```

(`webServer` của Playwright thừa hưởng `TZ`, nên `next start` chạy trên UTC như Vercel.)

Expected, mỗi lần cổng: typecheck không lỗi; lint thoát 0, 19 cảnh báo; `Test Files  53 passed (53)`, `Tests  572 passed (572)`; `Applied 6 migration(s).`; build thoát 0; check-prerender: "Admin check passed: /admin, /admin/accept-invite, /admin/audit, /admin/reservations, /admin/reservations/closures, /admin/reservations/day, /admin/reservations/new, /admin/reset-password, /admin/restaurants, /admin/settings/booking, /admin/sign-in, /admin/users, /admin/reservations/[id], /admin/restaurants/[id]/booking, /admin/[...missing] have no static shell.", "Uncached check passed: /api/availability not prerendered."; E2E `101 passed`; visual `8 passed`. Lần `TZ=UTC`: `101 passed`.

Nếu một lần chỉ đỏ ở `e2e/page-scope.spec.ts:71` "a card opens the restaurant page under the curtain" (rủi ro #15 của đợt 3; spec `desktop-serial` khi đó "did not run"), chạy lại cả bộ: lần `TZ=UTC` đầu của lần kiểm chứng gặp đúng điều này (`1 failed`, `1 did not run`, `99 passed`, load average khoảng 5–6), lần chạy lại `101 passed`.

- [ ] **Bước 6: Các kiểm tra của reviewer**

```bash
grep -rn pg_advisory lib app db/queries.ts
grep -rnE "CURRENT_DATE|(reserved_on|starts_on|ends_on)(::text)? AS" lib app db/queries.ts
grep -rn "use cache" lib/server/booking app/api/availability
grep -rn -A3 "UPDATE reservations" lib app
grep -rnE "version =|search_text =" lib app
```

Expected: `pg_advisory` chỉ ở `lib/server/booking/lock.ts`; dòng thứ hai và ba không in gì; hai `UPDATE reservations` (chuyển trạng thái, sửa) đều có `version = $2` trong `WHERE`; dòng cuối chỉ in hai `WHERE` đó, không SQL nào gán `version` hay `search_text`.

- [ ] **Bước 7: Commit**

```bash
git add e2e/booking-acceptance.spec.ts README.md
git commit -m "$(cat <<'EOF'
test: pin phase 4's acceptance criteria end to end, and document migration 006

e2e/booking-acceptance.spec.ts walks spec §14.1 row 4 through the screens,
on Yum Food Village: eight replays of a guest's booking for the last four
covers, held back at the INSERT until all are inside their transactions,
book exactly two (A1); a closure made in the admin greys the guest's day
with its reason (A2); confirm, cancel with a reason, and no-show only once
the sitting is past (A3); an Editor's new dinner hours and covers reach a
guest who had the old ones on screen (A4); a max_party override of 8 stops
the guest's stepper at 8 (A5); shorter hours list the bookings they leave
out and cancel none (A6). Each test was run once with the guard it relies
on removed, and failed.

The README now says how to apply migration 006 (after 005, with the phase-4
code, never by hand), the read-only checks to run on a Neon branch before
it and after it, how to check the booking-day lock through Neon's pooled
URL, the new routes, how booking data is kept, and which restaurant and
dates each E2E spec owns.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Bước 8: Báo lại rủi ro**

Báo cho người dùng các mục **Cần quyết định** của "Rủi ro đã biết": 1 (pg_trgm và các truy vấn kiểm trước trên Neon), 2 (khóa ngày đặt bàn qua URL pooled, bước kiểm có trong README), 3, 4 (`updateTag` tới mọi instance, kiểm ở preview đầu), 8, 9 và 16; cùng các bước của người dùng: chạy kiểm trước rồi `node scripts/migrate.mjs` trên một branch Neon, kiểm khóa trên branch đó, và chỉ đưa 006 lên production ngay trước lần deploy đầu của đợt 4.


---

## Bản kiểm chứng

Cả 14 task đã được chạy đúng thứ tự trong `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p4-verify` (bản sao APFS của repo, gốc `3c04ace`, đã xóa `.next` và `.env.local`). Lần đầu trên nhánh `main`: mỗi task một commit, RED thật trước code, cổng kiểm tra của task xanh. Vòng review kế hoạch để lại ba phát hiện; chúng được sửa thành một commit thêm trên `main` (`74967cb`) và chạy đủ cổng. Rồi nhánh `p4-folded` được dựng lại từ `3c04ace`, mỗi task một commit với cùng commit message, mỗi phần sửa gộp vào task sở hữu file. `git diff --stat main p4-folded` rỗng: cây của Task 14 trên `p4-folded` giống hệt `main` sau sửa. Mọi khối code, diff và commit message của kế hoạch được sinh từ các commit `p4-folded` dưới đây (`git show <sha>:<file>`, `git show <sha> -- <file>`, `git log -1 --format=%B <sha>`). Mỗi commit `p4-folded` đã chạy lại đủ cổng: typecheck, lint, unit + tích hợp, reset DB, build, check-prerender, E2E (`--retries=0`) và visual ở ngưỡng 0. Lý do: commit nào cũng mang view mới của migration 006, và từ Task 8 thêm `reservations.ts` mới, nên app code của commit nào cũng khác commit nó thay. Cột "RED đã thấy" là của lần chạy trên `main`, trừ Task 7 và Task 8: hai task này được đo lại trên `p4-folded` (xem dưới bảng).

| Task | SHA (`p4-folded`) | Commit cũ trên `main` | Unit + tích hợp | E2E | Visual | Lint (cảnh báo) | RED đã thấy |
|---|---|---|---|---|---|---|---|
| 1 | `6977208` | `2670d41` | 42 file, 394 test | 70 | 8/8 | 20 | `migration-006.test.ts` 18/18 đỏ khi chưa có migration |
| 2 | `2709ef7` | `ff18066` | 44 file, 430 test | 70 | 8/8 | 20 | 2 suite không import được + 2 test `venue-time`; 6 đột biến engine và 3 đột biến seed đều bị bắt |
| 3 | `08fcc86` | `be16d25` | 45 file, 437 test | 70 | 8/8 | 20 | suite không import được; 3 đột biến loader đều bị bắt |
| 4 | `7297879` | `b6cf315` | 45 file, 445 test | 70 | 8/8 | 20 | 3 test đỏ, 19 xanh, 3 suite không import được; bỏ khóa: 2 test đỏ ở cả 3 lần chạy (7 nhóm lọt thay vì 3) |
| 5 | `a6d82a5` | `84bc0cf` | 45 file, 463 test | 70 | 8/8 | 20 | 24 đỏ, 3 xanh (27); build âm: luật 1c đỏ với route tĩnh |
| 6 | `d000870` | `4025022` | 46 file, 474 test | 76 (lần ba; hai lần đầu `75 passed`, `1 failed` ở `page-scope.spec.ts:71`) | 8/8 | 19 | `booking-v2.spec.ts` 6/6 đỏ trên build của Task 5; `client.test.ts` không import được |
| 7 | `e234ffa` | `d8ae013` | 47 file, 490 test | 78 | 8/8 | 19 | 18 đỏ, 29 xanh (47); bỏ `unstable_rethrow`: 1 đỏ; con trỏ mili giây: 2 đỏ |
| 8 | `d44e894` | `276f865` | 49 file, 530 test | 78 | 8/8 | 19 | 2 đỏ, 37 xanh, 2 suite không import được; bỏ khóa khỏi `createStaffReservation`: hai test xuyên đường đỏ ở cả 9 lần chạy, test đua đỏ ở 8 lần (8/8 nhóm lọt) và xanh vì may ở 1 lần |
| 9 | `0acc643` | `e9453e8` | 52 file, 545 test | 84 | 8/8 | 19 | 3 đỏ, 19 xanh, 3 suite không import được; E2E trên build Task 8: 9 đỏ, 1 không chạy |
| 10 | `6e7b002` | `9bcd5aa` | 52 file, 548 test | 86 | 8/8 | 19 | 4 đỏ, 27 xanh; E2E trên build Task 9: 2 đỏ |
| 11 | `e0967d1` | `2faae58` | 53 file, 561 test | 90 | 8/8 | 19 | 7 đỏ, 26 xanh, 1 suite không import được; bỏ `updateTag` ở hai action: 2 đỏ; chỉ ở `saveRules`: spec công tắc đỏ (`VIEW OFFER` 3 thay vì 1) |
| 12 | `d37d871` | `f77fdb2` | 53 file, 567 test | 93 | 8/8 | 19 | 8 đỏ, 34 xanh; E2E trên build Task 11: 3 đỏ; đổi quyền auto-confirm: guard 2 đỏ |
| 13 | `55474a5` | `cf86ecd` | 53 file, 572 test | 95 | 8/8 | 19 | 5 đỏ, 41 xanh; E2E trên build Task 12: 2 đỏ |
| 14 | `598f814` | `dbdcd92` | 53 file, 572 test | 101 | 8/8 | 19 | gỡ lần lượt 6 guard: mỗi lần đúng test A1…A6 của nó đỏ, 5 test kia xanh |

**Ba phát hiện của review và chỗ chúng được gộp vào:**

| Phát hiện | Sửa | Task nhận | Đỏ trước khi sửa (trên `main`, `dbdcd92`) |
|---|---|---|---|
| Câu báo xung đột nêu người của sự kiện mới nhất bất kỳ: ghi chú thêm sau lần đổi bị nêu tên thay người đã đổi (và từ đợt 5, sự kiện email) | `conflict()` chỉ đọc sự kiện `status_changed`/`edited`; test mới "a note added after the change does not take the blame for the conflict" | 8 | test mới đỏ: `params.by` là Hoa thay vì Mai |
| Đặt qua điện thoại cho một giờ đã qua của hôm nay được tạo `confirmed` (R8 nói không được ở quá khứ) | `minutesUntil(date, time, now) < 0` → `invalid`, lỗi ở ô `time`; thêm một `expect` vào "a walk-in is for the service day only; a phone booking not in the past" | 8 | test đỏ: `{ ok: true, … }` thay vì `invalid` |
| `/admin/audit` ghi mọi đặt bàn web là của "Hệ thống" (sự kiện `created` của khách không có nhãn) | view `audit_feed`: `COALESCE(e.actor_label, CASE e.actor_kind WHEN 'guest' THEN 'Khách' END)`; test của view đổi `null` thành `'Khách'` | 1 (test ở Task 1 và bản viết lại ở Task 7) | "merges reservation events into the same timeline, as reservation.<type>" đỏ với view cũ |

Hai test của Task 8 chạy cùng `audit-feed.test.ts` trên `reservations.ts` cũ: `Tests  2 failed | 31 passed (33)`; với view cũ: `Tests  1 failed | 32 passed (33)`.

**Cổng cuối trên cây đã sửa, chạy hai lần**, mỗi lần reset DB và build lại: một lần trên `main` + `74967cb`, một lần trên Task 14 của `p4-folded` (cùng một cây). Cả hai lần: typecheck không lỗi; lint thoát 0 với 19 cảnh báo; `Test Files  53 passed (53)`, `Tests  572 passed (572)`; `Applied 6 migration(s).`; build thoát 0; check-prerender đạt (15 trang admin không có static shell, `/api/availability` không prerender, font); E2E `101 passed` (`--retries=0`, gồm project `desktop-serial`); visual `8 passed` ở `maxDiffPixelRatio: 0`. E2E với `TZ=UTC` trên `next start`, trên Task 14 của `p4-folded`, DB vừa reset: `101 passed`. Trước vòng sửa, cổng cuối trên `main` cũ (`dbdcd92`) cũng đã chạy hai lần (`571 passed`, E2E `101 passed`). Ở đó lần `TZ=UTC` đầu ra `99 passed`, `1 failed` (`page-scope.spec.ts:71`, rủi ro #15 của đợt 3), `1 did not run` (spec công tắc, vì `desktop` đỏ); chạy lại `101 passed`.

- Lệnh của lần kiểm chứng giống khối "Cổng kiểm tra của mọi task", trừ tên DB và cổng, để không đụng agent khác dùng chung Postgres. Phần A dùng `furama_cuisine_p4va_test` (cùng `TEST_DB_TAG=p4va`) và `furama_cuisine_p4va_e2e_test`, cổng E2E `3250`, visual `3251`. Phần B dùng `furama_cuisine_p4vb_test` (`TEST_DB_TAG=p4vb`) và `furama_cuisine_p4vb_e2e_test`, cổng `3252` và `3253`. Vòng sửa và gộp dùng `furama_cuisine_p4vf_test` (`TEST_DB_TAG=p4vf`) và `furama_cuisine_p4vf_e2e_test`, cổng `3270` và `3271`. Các DB đó đã xóa và không server nào còn chạy khi xong. `furama_cuisine_test`/`furama_cuisine_e2e_test` không bị đụng.
- Mọi lần E2E chạy `--retries=0`. Task 6 chạy thêm `booking-v2.spec.ts` và `booking-dates.spec.ts` với `--repeat-each=3`: `36 passed`. Phần B chạy E2E toàn bộ 13 lần; flake `page-scope.spec.ts:71` xuất hiện một lần (lần `TZ=UTC` đầu, load average khoảng 5–6). Spec nghiệm thu không chạy được với `--repeat-each` (các lần lặp chạy song song trên cùng quy tắc của Yum Food Village; đã thấy, rủi ro 22).
- Vòng gộp chạy E2E toàn bộ 18 lần: `main` sau sửa, 14 commit `p4-folded`, hai lần chạy lại Task 6, và `TZ=UTC` trên Task 14. Thêm một lần trên `4025022` cũ để đối chứng. Flake `page-scope.spec.ts:71` gặp ở hai lần chạy liền nhau của Task 6 trên `p4-folded`, load average khoảng 5–9 do agent khác chạy song song. Cả hai lần cùng một lỗi: nhật ký màn che bắt đầu bằng `'false'`, tức `['false', 'true', 'false']` thay vì `['true', 'false']`. Spec đó chạy riêng với `--repeat-each=3` thì `21 passed`. Ngay sau đó, `4025022` cũ và `d000870` mỗi bên `76 passed`. Task 6 chỉ khác commit cũ ở view `audit_feed` và một test của nó, nên không chạm trang khách.
- Visual `8 passed` ở cả 14 task trên `main` và trên `p4-folded`; không baseline nào đổi, không lần nào dùng `--update-snapshots`.
- Số đếm của lệnh test riêng mỗi task (bước "Chạy lại test") được đo trên chính commit đó, trong một worktree tạm của `p4-verify`. Riêng các lệnh có file bị gộp sửa thì đo lại trên `p4-folded`. Task 1 Bước 7: năm file xanh, `Tests  26 passed (26)`. Task 7 Bước 3: `Tests  18 failed | 29 passed (47)`, cùng output như trong task. Task 7 Bước 7: `49 passed`. Task 8 Bước 4: `Tests  2 failed | 37 passed (39)`, cùng output. Task 8 Bước 8: `78 passed`. Task 8 Bước 9: 9 lần chạy không khóa, 8 lần `3 failed | 24 passed (27)`, 1 lần `2 failed | 25 passed (27)`; trả khóa về thì `27 passed`. Lệnh của các task khác chạy những file không đổi giữa `main` và `p4-folded`.
- Kiểm thêm sau Task 14 (Bước 6), trên `main` cũ và lại trên `p4-folded`. `grep -rn pg_advisory` chỉ ra `lib/server/booking/lock.ts`. Không có `CURRENT_DATE`, và không cột ngày nào rời SQL bằng `::text`. Không có `'use cache'` dưới `lib/server/booking/` hay `app/api/availability/`. Hai `UPDATE reservations` của app đều có `version = $2` trong `WHERE`, và không SQL nào của app gán `version` hay `search_text`.
- Các truy vấn kiểm trước và sau của README (mục "Migration 006") đã chạy trên một DB cục bộ dừng ở 005 có một đặt bàn đợt 1; DB đó đã xóa. Vòng sửa chỉ đổi view `audit_feed` của 006, và không truy vấn nào trong đó đọc view này. Bước kiểm khóa qua URL pooled của Neon là bước của người dùng (rủi ro 2): agent không được chạm Neon.

Khi thực thi, có thể cherry-pick từng commit của nhánh `p4-folded` trong `p4-verify` rồi đối chiếu với văn bản của task (như đợt 2 và đợt 3), hoặc gõ lại từ kế hoạch; hai cách cho cùng một cây.
