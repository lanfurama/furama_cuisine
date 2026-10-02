# Đợt 5: Email và chống spam → mốc ra mắt A — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mỗi thay đổi đặt bàn cần báo tin sẽ ghi email vào `email_outbox` ngay trong transaction của nó, rồi gửi qua SMTP truyền thống (nodemailer) sau COMMIT, từ cron 5 phút một lần và từ nút "Gửi lại", ít nhất một lần, có thử lại và nhật ký; nhân viên chọn ai nhận "đặt bàn mới", hộp thư chung nhận khi không ai khớp, "Gửi email thử" kiểm đường gửi; khách được hỏi đồng ý chính sách, còn bot và một số điện thoại spam bị chặn trước khi chạm DB.

**Architecture:**
- **Dữ liệu:** migration `007_email_and_consent.sql` (một transaction, chỉ mở rộng): `site_settings` tạo sớm với một cột `email` (đợt 6 thêm cột bằng `ALTER … ADD COLUMN IF NOT EXISTS`), `notification_recipients`, `email_outbox` (khóa `outbox:<id>` sinh STORED, lease, số lần gửi, Message-ID), và cặp cột đồng ý `reservations.consent_version`/`consented_at`. `reservation_events` giữ nguyên CHECK của 006: lịch sử email chỉ nằm ở `email_outbox` (R2).
- **Gửi:** một cổng duy nhất `lib/server/email/send.ts` (`EMAIL_DELIVERY` log/redirect/live) trên SMTP: 587 bắt buộc STARTTLS hoặc 465 TLS, mỗi email một kết nối, timeout từng bước và trần 30 s. Không có idempotency key nên gửi **ít nhất một lần** (R1): bộ gửi `drainOutbox` giữ một hàng bằng `FOR UPDATE SKIP LOCKED` + lease 120 s + Message-ID cố định, đọc lại đặt bàn, gửi khi không giữ kết nối DB, đánh dấu có rào `attempts`.
- **Kích hoạt:** `drainAfterCommit(ids)` = `after()` sau COMMIT của mọi lần ghi đặt bàn (10 hàng / 25 s); `GET /api/cron/outbox` mỗi 5 phút (`vercel.json`, `CRON_SECRET`); "Gửi lại" trong admin.
- **Nội dung:** template React Email đọc key registry `email.<sự kiện>.<trường>` EN và VI, render lúc gửi từ đặt bàn đã đọc lại; ngôn ngữ theo R10, Reply-To theo R11.
- **Admin:** ô "Báo khách"/"Gửi email xác nhận" (R8); `/admin/settings/notifications` (người nhận, hộp thư chung, "Gửi email thử", chỉ Admin); `/admin/reservations/emails` (nhật ký, "Gửi lại"); email của từng đặt bàn; hai số đếm ở Tổng quan.
- **Khách (Phần B):** trang chính sách `/[lang]/privacy`, ô đồng ý, honeypot, giới hạn theo số điện thoại dưới khóa riêng, BotID; ô tìm hộp thư rời khỏi URL (SEC-2).

**Tech Stack:** Next.js 16.3.7 (Turbopack, `cacheComponents`, `after()`), React 19.3, TypeScript 7.0.2, `pg` 8.23 (pool 5), Postgres 18, zod 4.6.5, react-email 6.11.0, **nodemailer 10.0.13** (mới; kiểu của chính nó), better-auth 1.7.7, Vitest 5, Playwright 1.63, oxlint 1.86. Dev mới: `smtp-server` 3.19.16, `@types/smtp-server` 3.5.13. Bỏ `resend`. Phần B thêm `botid@1.5.11`.

**Spec:** `docs/superpowers/specs/2026-10-01-admin-cms-design.md` — §14.1 dòng 5 (nghiệm thu: có đặt bàn mới thì nhân viên nhận email; xác nhận thì khách nhận email; email lỗi được gửi lại; không có người nhận thì gửi về email chung; bot bị chặn), cùng §5.2, §7.1–7.4, §10.2–10.4 (đã sửa cho SMTP ở `47ad5ee`), §11, §12, §13.

**Căn cứ đã kiểm chứng:**
- `docs/superpowers/research/2026-10-02-phase-5-spikes/00-plan-outline.md` (dàn ý của lead: sự kiện F1–F13, xung đột C1–C16, quyết định D1–D18 và A1–A5, phán quyết R1–R23, ràng buộc §4, review focus §5, rủi ro §6, runbook §7) cùng ba báo cáo spike `outbox-core.md`, `templates-screens.md`, `anti-spam-consent.md`. Chỗ báo cáo và dàn ý khác nhau, dàn ý thắng; chỗ kế hoạch này khác dàn ý, lý do nằm ở "Ghi chú triển khai".
- **Cả hai phần (Task 1–13):** mọi khối code được sinh từ các commit của nhánh `p5-folded` trong bản sao kiểm chứng `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p5-verify` (bản sao APFS của repo, gốc `0733094`, đã xóa `.next` và `.env.local`). Task 1→13 đã chạy đúng thứ tự trên nhánh `main` của bản sao đó (Phần A Task 1–7, rồi Phần B Task 8–13 trên commit của Task 7), mỗi task một commit. Đợt review kế hoạch sau đó đưa ra chín điểm (mục "Đợt sửa sau review" ở "Ghi chú triển khai"); các sửa về code chạy thành một commit trên `main` ở đó, rồi `p5-folded` dựng lại từ `0733094`, gộp mỗi sửa vào task sở hữu file, mỗi task vẫn một commit với cùng message; cây của commit cuối `p5-folded` trùng từng byte với `main` đã sửa (`git diff --stat main p5-folded` rỗng). Mỗi commit của `p5-folded` xanh typecheck, lint, unit + tích hợp, build, check-prerender, E2E (`--retries=0`) và visual ở ngưỡng 0. Output "Expected: FAIL" là output thật (đường dẫn tuyệt đối rút gọn thành `…`). SHA và số đếm từng task, cùng cổng cuối và các lần chạy đột biến, nằm ở "Bản kiểm chứng".
- Phần B lấy code từ báo cáo `anti-spam-consent.md` (spike guard; bản sao `p5-guard` và `p5-guard.patch` còn trong scratchpad) và dựng lại trên drawer của nhóm A. Phần không có code spike nào, viết mới khi chạy: các đường lỗi của drawer và thanh đặt bàn (Task 10), bộ nghiệm thu A3/A4 và các đột biến của nó (Task 13), runbook và mục migration 007 của README (Task 13).
- Các spike chạy trên `04e0692`, **trước** đợt sửa cuối của đợt 4. Kế hoạch dựng lại mọi thay đổi trên `main` hôm nay: `max(254, {abort:true})` của F1 trong `lib/server/booking/input.ts`, khóa `booking.done_requested`/`booking.done_confirmed` của F2 (email EN dùng đúng chữ đó), `TargetPicker`/`NewReservationForm` của F9, đồng bộ lại theo form của F10, guard của F13/F14 trong `lib/admin/admin-pages.guard.test.ts` (form có `onSubmit` phải `method="post"`; form có action là hàm không có `onSubmit`), bản đồ dữ liệu E2E của README.
- Sổ việc hoãn: đợt 3 (`docs/superpowers/ledgers/2026-10-02-phase-3-ledger.md`, mục "Phase 5") giao năm việc email, cả năm nằm ở Task 2 (`appOrigin()` fail-closed, cast của Resend, thời hạn trong template lấy từ hằng thật, tách gửi khỏi ghi sổ trong `deliverInvite`) và Task 5 (đo dung lượng react-email). Đợt 4 (`docs/superpowers/ledgers/2026-10-02-phase-4-ledger.md`, mục "Phase 5" và phán quyết SEC-2) giao: chữ email trùng màn hình xong (Task 5), nhãn guard của audit đọc CHECK của 006 (thành vô nghĩa theo R2), và các việc của form khách, availability, SEC-2 (Phần B: Task 10, 12).
- Tài liệu Next được trích theo `node_modules/next/dist/docs/<file>.md:dòng`: `after()` dùng được trong Server Function (`01-app/03-api-reference/04-functions/after.md:8`), chạy tới `maxDuration` của route (`after.md:50`), chạy cả khi action ném lỗi hay redirect (`after.md:54`), dùng `waitUntil` trên serverless (`after.md:247-260`); handler `GET` đọc `request.headers` là động (`01-app/01-getting-started/15-route-handlers.md:124`); `maxDuration` là segment option (`01-app/03-api-reference/03-file-conventions/02-route-segment-config/index.md:13`); `cookies().set` chỉ trong Server Function hay Route Handler (`04-functions/cookies.md:6,74,81-87`).

## Global Constraints

**An toàn dữ liệu — đọc trước mọi lệnh:**
- `.env.local` đang trỏ vào **DB Neon dùng chung với production**.
- **Không bao giờ chạy** `npm run db:migrate`, `npm run db:psql`, `npm run dev`, `vercel env pull`. Không bao giờ chạy `npx auth …` thiếu `--config scripts/auth-cli.config.ts`. Không kết nối Neon, Vercel, máy chủ SMTP thật hay dịch vụ ngoài nào. **Không bao giờ gửi email thật.**
- Lần ra mạng duy nhất được phép là registry npm: các lệnh cài gói của Task 2 Bước 1 và Task 11 Bước 1 khi cache npm của máy thiếu gói (chúng chạy `--offline` trước), và các lần `npm audit` bắt buộc sau Task 2, sau Task 11 và ở cổng cuối.
- Mọi lần ghi DB của E2E đi qua `db()`/`one()` trong `e2e/staff-fixtures.ts` (từ chối mọi DB không phải DB cục bộ tên `*_test`/`*_ci`).
- Mọi lần build, `next start`, E2E và visual đều dùng **tiền tố env cục bộ**. Biến của tiến trình thắng `.env.local`, kể cả khi rỗng (`@next/env` chỉ lấy giá trị của file cho khóa chưa có trong môi trường), nên tiền tố để trống mọi khóa mà `.env.local` của repo thật có thể chứa và làm đổi hành vi: bốn biến `PG*`; `VERCEL_ENV` (bộ gửi và hàng đợi sẽ thôi là `development`, `isBotRequest` sẽ gọi `checkBotId` thật tới api.vercel.com); `NEXT_PUBLIC_VERCEL_ENV` (inline lúc build: bật `initBotId`); `VERCEL_OIDC_TOKEN`; `EMAIL_FROM` (đổi Message-ID); `EMAIL_REDIRECT_TO`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`; `BOTID_DEV_BYPASS` (sẽ từ chối mọi đặt bàn). Code coi giá trị rỗng như chưa đặt (`DEPLOYED.has('')`, `botIdEnabled('', …)`, `senderDomain('')` ra false/null; chế độ log không đọc `SMTP_*`), nên số đếm không đổi:

  ```bash
  CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test
  ```

- `next start` và E2E còn cần biến auth, email và cron; **`EMAIL_DELIVERY=log` đặt tường minh**. Từ đợt 5 tiền tố có thêm `CRON_SECRET` (ngẫu nhiên mỗi lần chạy, ít nhất 16 ký tự; spec E2E của cron đọc nó từ môi trường của Playwright):

  ```bash
  BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson CRON_SECRET=$(openssl rand -hex 16) E2E_PORT=3210
  ```

- **Không bao giờ đặt** `SMTP_*`, `EMAIL_REDIRECT_TO`, `VERCEL_ENV` hay `NEXT_PUBLIC_VERCEL_ENV` cho một server cục bộ (tiền tố trên để trống chúng). Test chỉ chạm SMTP qua `test/helpers/smtp-sink.ts` (máy SMTP giả chạy trong tiến trình, `127.0.0.1`, cổng do hệ điều hành chọn); nới TLS chỉ qua `transportOverrides` của test, không bao giờ qua env. `BOTID_DEV_BYPASS=BAD-BOT` chỉ cho một lần chạy riêng `e2e/botid.spec.ts` (Phần B): lệnh đó thay `BOTID_DEV_BYPASS=` của tiền tố bằng `BOTID_DEV_BYPASS=BAD-BOT`. `withBotId` (Phần B) thêm rewrite tới api.vercel.com vào cả build cục bộ: không bao giờ request tiền tố `/149e9513-…` trên `next start`.
- Chỉ được tạo, reset hoặc xóa các DB cục bộ sau: `furama_cuisine_test` (tích hợp; test tự tạo thêm `furama_cuisine_migrate_test`, `…migrate004_test`, `…migrate005_test`, `…migrate006_test`, và từ Task 1 `furama_cuisine_migrate007_test`) và `furama_cuisine_e2e_test` (build, E2E, visual). `TEST_DB_TAG=x` đổi tên các DB migrate thành `…_x_test`, để hai bản checkout chạy cùng một Postgres. Tạo lại bằng `RESET_DATABASE_URL=postgres://localhost:5432/<tên> node scripts/reset-db.mjs` (script từ chối host khác localhost và tên không kết thúc bằng `_test`/`_ci`).
- Cổng: E2E `3210`, visual `3211` (khoảng 3200–3299 dành cho agent; CI dùng 3100). Trước khi bật server, `lsof -nP -iTCP:<cổng> -sTCP:LISTEN` phải không in gì; xong thì `lsof -ti tcp:<cổng> | xargs kill`.
- Kế hoạch này **không chạy migration 007 lên Neon**. README (Task 13, Phần B) ghi các truy vấn kiểm tra trước và sau (dàn ý §7 bước 9); việc chạy là của controller trong cửa sổ deploy đợt 5.
- **zsh:** không bắt đầu một đối số bằng `=`; đặt glob trong nháy (`--include='*.ts'`); đặt đường dẫn có ngoặc trong nháy kép (`"app/admin/(shell)/…"`); zsh không tách từ của biến, nên lặp qua danh sách bằng `… | while read -r x; do …; done`.

**Git:**
- Làm thẳng trên `main`, không tạo branch. Mỗi task một commit. **Không push.** `git add` từng file cụ thể (`git rm` cho file xóa), không dùng `git add -A`.
- Hai mục untracked không thuộc các commit này: chính file kế hoạch này và thư mục `docs/superpowers/research/2026-10-02-phase-5-spikes/`; controller commit chúng.
- Mọi commit message kết thúc bằng dòng attribution mà phiên thực thi của bạn được cấu hình để thêm. Các khối commit dưới đây in dòng của phiên kiểm chứng (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); nếu phiên của bạn cấu hình dòng khác, thay dòng cuối bằng dòng đó.

**Next 16 và TypeScript 7** (giữ nguyên quy ước đợt 3 và 4, thêm của đợt 5):
- Đọc tài liệu trong `node_modules/next/dist/docs/` trước khi dùng API Next (theo `AGENTS.md`), trích theo `file.md:dòng`.
- `npm run typecheck` = `next typegen && tsc --noEmit --incremental false`. `next build` cũng typecheck file test (`tsconfig` gồm `**/*.ts`): một lỗi kiểu trong test, hoặc một test import module chưa có, làm hỏng build.
- Mọi `app/admin/**/page.tsx` export `instant = false` và gọi `verifySession()`/`requirePagePermission()` trước khi đọc DB. Không `style=` dưới `app/admin`, không component của web khách, chưa dùng `next/image`.
- **Action:** câu lệnh đầu tiên là `await requirePermission(…)` (đứng riêng, là initializer duy nhất, hoặc câu đầu trong một `try` cấp cao nhất có `catch` kết thúc bằng `return`/`throw`). Sau đó zod, rồi transaction, rồi `updateTag`/`refresh()`/`drainAfterCommit`, rồi `ActionResult`. `redirect()` được nằm trong `try` (phán quyết R13 của đợt 4). Bài test CI `test/guards/require-permission.guard.test.ts` giữ bảng quyền từng action.
- Form gửi bằng `onSubmit` (`submitKeepingValues`) phải có `method="post"`; form có action là hàm không có `onSubmit` (confirm đặt ở nút submit, như `DeleteClosure`). `lib/admin/admin-pages.guard.test.ts` bắt cả hai.
- **`after()` chỉ sau COMMIT**, không bao giờ trên đường còn có thể rollback, và trước `redirect()` (`after.md:54`: nó chạy cả khi action ném lỗi hay redirect). Test gọi action trực tiếp trong Vitest phải mock `after` của `next/server` bằng một collector `vi.hoisted` (không thì lỗi E468 "after was called outside a request scope").
- Route cron chỉ export `GET` và `maxDuration`; helper nằm ở `lib/server/cron.ts`; route đọc `request.headers` (động) và trả `cache-control: no-store`.
- Cài đặt email, `CRON_SECRET` và `BETTER_AUTH_URL` đọc lúc gọi, không bao giờ lúc import: `next build` không cần biến nào trong số đó.
- `cookies().set` chỉ trong action tìm kiếm của SEC-2; `instrumentation-client.ts` chỉ làm việc đồng bộ (Phần B).
- Locator E2E: theo role, hoặc `getByLabel(…, { exact: true })`. Thông báo trạng thái tìm trong dialog, `main` hoặc hàng của bảng (route announcer của Next cũng là một live region).
- Comment trong code viết bằng tiếng Anh, giải thích "vì sao". Lint thoát 0 với **19 cảnh báo** (mốc `0733094`); không task nào được thêm cảnh báo.

**Phiên bản:**
- Thêm: `nodemailer@^10.0.13` (Task 2 cài đúng bản `10.0.13` bằng `--offline`; npm vẫn ghi `^10.0.13` vào `package.json`, còn lock ghim bản đã kiểm; kiểu đi kèm gói; **không** cài `@types/nodemailer` — `@types/smtp-server` tự kéo bản 8 theo, và import của ta vẫn lấy kiểu của chính nodemailer). Dev: `smtp-server@^3.19.16`, `@types/smtp-server@^3.5.13` (cài đúng `3.19.16`/`3.5.13`). Phần B: `botid@1.5.11` (đúng bản).
- Bỏ: `resend`. Không thêm: `@vercel/config` (R19), `mailparser`, `@types/nodemailer`.
- Không đổi: `next@16.3.7`, `react@19.3.0`, `typescript@7.0.2`, `pg@8.23.0`, `zod@4.6.5`, `react-email@6.11.0`, `better-auth@1.7.7`, `vitest@5.0.3`, `@playwright/test@1.63.0`, `oxlint@1.86.0`, `@vercel/functions@3.9.9`. Node 22.22 cục bộ, 24 trên Vercel và CI; Postgres 18.3 cục bộ.
- `npm audit` phải ra 0 sau Task 2 (và sau Task 11 của Phần B).

**Tên trong migration `007_email_and_consent.sql`** (một transaction, chỉ mở rộng, chạy lại an toàn):
- **`site_settings`**: `id boolean PK DEFAULT true` + CHECK `site_settings_single_row`; `email text NOT NULL` CHECK `email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254`; `updated_at`, `updated_by`. Seed `(true, 'fb@furamavietnam.com') ON CONFLICT DO NOTHING`. Đợt 6 thêm cột bằng `ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS …`, không bao giờ `CREATE TABLE`.
- **`notification_recipients`**: `id` identity; `scope` ∈ {all, destination, restaurant}; `destination_id` → `destinations`, `restaurant_id` → `restaurants` (cả hai CASCADE); `email` (cùng CHECK); `events text[] DEFAULT ARRAY['staff.new']` CHECK `notification_recipients_events_check` (`cardinality >= 1 AND events <@ ARRAY['staff.new']`); `locale` → `locales` DEFAULT `'vi'`; `active`; `created_at/by`, `updated_at/by`; CHECK `notification_recipients_scope_target`; UNIQUE INDEX `notification_recipients_target_email_idx (scope, coalesce(destination_id,''), coalesce(restaurant_id,''), lower(email))`.
- **`email_outbox`**: `id` identity; `env` ∈ {production, preview, development}; `event` ∈ {staff.new, guest.ack, guest.confirmed, guest.declined, guest.cancelled} (= `EMAIL_EVENTS` của `lib/email/events.ts`); `audience` ∈ {staff, guest}; `reservation_id bigint NOT NULL` → `reservations` ON DELETE CASCADE; `reservation_event_id` → `reservation_events` ON DELETE SET NULL; `to_email` CHECK `~ '^[^@\s]+@[^@\s]+$' AND length <= 254`; `locale` → `locales`; `fallback`; `idempotency_key text GENERATED ALWAYS AS ('outbox:' || id::text) STORED` CONSTRAINT `email_outbox_idempotency_key_key UNIQUE`; `status` ∈ {queued, sending, sent, skipped, failed} (= `EMAIL_STATUSES`); `attempts smallint 0..7`; `next_attempt_at`; `locked_until`; `last_error ≤ 300`; `message_id ≤ 300`; `provider_id ≤ 300`; `sent_at`; `created_at`, `updated_at`. CHECK `email_outbox_audience_event`, `email_outbox_sending_leased`, `email_outbox_sent_at`. Index `email_outbox_due_idx (env, next_attempt_at, id) WHERE status IN ('queued','sending')`, `email_outbox_reservation_idx (reservation_id, id)`, `email_outbox_log_idx (created_at DESC, id DESC)`, `email_outbox_failed_idx (created_at DESC, id DESC) WHERE status = 'failed'`.
- **`reservations`**: `consent_version text`, `consented_at timestamptz`, CHECK `reservations_consent_check` = cả hai NULL, hoặc `consent_version IS NOT NULL AND consented_at IS NOT NULL AND length(consent_version) BETWEEN 1 AND 40` (vế thứ hai phải tự nêu `IS NOT NULL`: CHECK ra NULL thì qua).
- Thực thể audit: `notification_recipient` (create/update/delete), `site_settings` (`settings`), `email_outbox` (`update`, "Gửi lại").
- Khóa advisory: `booking:<nhà hàng>:<ngày>` (không đổi), `guest-phone:<e164>:<ngày>` (Phần B).

**Biến môi trường:**

| Biến | Production | Preview | Cục bộ / CI |
|---|---|---|---|
| `EMAIL_DELIVERY` | `live` | `redirect` | `log` (tường minh) |
| `EMAIL_REDIRECT_TO` | — | hộp thư của Admin | — |
| `EMAIL_FROM` | `Furama Cuisine <no-reply@…>`, địa chỉ tài khoản SMTP được phép gửi | như Production | không đặt (log) |
| `SMTP_HOST` / `SMTP_PORT` (mặc định 587) / `SMTP_SECURE` (`true`\|`false`; không đặt → chỉ `true` ở 465) / `SMTP_USER` + `SMTP_PASSWORD` (có cả hai hoặc không có cả hai) | đặt | đặt | **không bao giờ** |
| `CRON_SECRET` | ≥ 16 ký tự (`openssl rand -hex 32`) | tùy (cron chỉ chạy ở Production) | ngẫu nhiên mỗi lần chạy (E2E, CI) |
| `BETTER_AUTH_URL` | origin production (bắt buộc ngoài chế độ log, R23) | origin của preview | `http://localhost:<cổng>` |
| `BOTID_DEV_BYPASS` | **không bao giờ** | **không bao giờ** | chỉ lần chạy riêng `botid.spec.ts` |
| `VERCEL_ENV`, `NEXT_PUBLIC_VERCEL_ENV` | nền tảng đặt | nền tảng đặt | không đặt |
| `RESEND_API_KEY` | xóa | xóa | — |

`vercel.json`: `{"$schema":"https://openapi.vercel.sh/vercel.json","crons":[{"path":"/api/cron/outbox","schedule":"*/5 * * * *"}]}`.

**Hằng số:** `RETRY_DELAYS_MINUTES = [1, 5, 15, 60, 360, 720]`; `MAX_ATTEMPTS = 7` (mọi lần gửi trong 1161 phút ≈ 19,4 giờ); `LEASE_SECONDS = 120`; `SEND_TIMEOUT_MS = 30_000`; `SMTP_TIMEOUTS = { dnsTimeout 5_000, connectionTimeout 10_000, greetingTimeout 10_000, socketTimeout 20_000 }`; drain mặc định 50 hàng / 20 s; `after()` 10 / 25 s; cron 500 / 240 s, `maxDuration 300`; `CRON_SECRET` ≥ 16; `INVITE_TTL_DAYS = 7`, `RESET_TOKEN_SECONDS = 3600`; nhật ký email 50 dòng, lỗi cắt còn 90 ký tự trong danh sách; Message-ID `<outbox-{id}.{12 hex}@{tên miền EMAIL_FROM}>`; mã mẫu `FC-0000TEST`; locale của hàng dự phòng `vi`. Phần B: `PHONE_DAY_LIMIT = 3`, `lock_timeout '5s'` của khóa số điện thoại, `PRIVACY_POLICY_VERSION = '2026-10-02'`, `INBOX_SEARCH_COOKIE = 'fc_inbox_search'` 30 phút.

**Ma trận quyền** (thêm vào của đợt 4, file dưới `app/admin/(shell)/`):

| Trang hoặc action | Quyền | Editor |
|---|---|---|
| trang `reservations/emails` | `reservations:read` | ✓ |
| `reservations/emails/actions.ts#resendEmail` | `reservations:update` | ✓ |
| `reservations/actions.ts#searchReservations` (Phần B) | `reservations:read` | ✓ |
| trang `settings/notifications` | `settings:read` | ✗ |
| `settings/notifications/actions.ts#{addRecipient,editRecipient,removeRecipient,saveInbox,sendTest}` | `settings:update` | ✗ (file trong `ADMIN_ONLY_ACTIONS`) |

Danh sách action công khai giữ **6** mục; Phần B sửa lời giải thích của `submitReservation` (zod, đồng ý, honeypot, BotID, giới hạn theo số điện thoại). `GET /api/cron/outbox` không nằm dưới `/api/admin/*`: nó được giữ bằng `CRON_SECRET`.

**Mã lỗi:**
- `EmailErrorCode`: `invalid_delivery_mode`, `missing_smtp_config` (thay `missing_api_key`), `missing_from`, `missing_redirect_to`, `missing_app_url` (mới, R23), `not_delivered`, `rejected` (mới: 5xx ở `RCPT TO`), `provider_error` (mọi lỗi khác trên đường tới máy SMTP).
- `ActionCode` admin: thêm `email_failed {error}` (Task 6), `not_resendable` (Task 7).
- Cron: 401 `{error:'unauthorized'}`; 500 `{error:'drain_failed'}`.
- Lỗi lưu: `"<code>: <message>"`, ≤ 300 ký tự, địa chỉ email → `<redacted>`; bỏ qua `skipped: <lý do>`; thu hồi `lease_expired: …`.
- Khách (Phần B, trước `unknown` trong `BOOKING_ERROR_CODES`): `consent_required`; `too_many_requests {limit, phone}`; `bot_blocked {phone}`.

**Quy tắc code (đợt 5):**
1. Hàng outbox chỉ được ghi trong `lib/server/email/outbox.ts`, trên client của transaction, trước COMMIT.
2. Không I/O SMTP khi đang giữ một client của pool hay trong transaction; bộ gửi dùng câu lệnh autocommit.
3. Mọi lần đánh dấu sau khi giữ hàng đều có rào: `WHERE id = $1 AND attempts = $2 AND status = 'sending'`.
4. Một `reachesSql` (`lib/server/email/recipients.ts`), một `outboxEnv` (`lib/server/email/env.ts`), một `EVENT_STATUSES` (`lib/email/events.ts`).
5. Log và lỗi lưu chỉ mang id, sự kiện, mã lỗi, số lần gửi; không bao giờ địa chỉ, tên, số điện thoại, token hay mật khẩu SMTP (`[outbox]`, `[cron:outbox]`, `[email]`, `[staff]`, Phần B thêm `[booking]`, `[botid]`). Một test kiểm không có `@` trong dòng `[outbox]`.
6. SQL nằm trong template literal của JS không chứa dấu `\`: dùng `[:space:]` (trong template literal, `\s` mất dấu `\` và thành chữ `s`).
7. Chỉ `lib/server/email/` import `nodemailer`; `smtp-server` chỉ dưới `test/`; `resend` không ở đâu cả (guard test).
8. Thứ tự khóa (Phần B): khóa số điện thoại của khách, rồi khóa ngày đặt bàn; đường của nhân viên chỉ lấy khóa ngày; `pg_advisory_xact_lock` giữ một chỗ gọi.
9. Chữ khách thấy lấy từ registry (`email.*`, `legal.*`, `error.*`, `booking.*`); key mới khai `screen`, `vars`, `context`.
10. Email không bao giờ nạp `reservation_notes`; email cho khách không bao giờ có link admin, số điện thoại hay ghi chú của khách.

**Bản đồ dữ liệu E2E** (thêm vào bản đồ của đợt 4; mỗi cặp nhà hàng × ngày là riêng, vì các file chạy song song):

| Spec | Nhà hàng | Ngày hoặc trạng thái | Dọn |
|---|---|---|---|
| `admin-reservations`, ô email (Task 3) | taya-house | +3 (`seedReservation()` mặc định); trang "Tạo đặt bàn" hôm nay, không ghi gì | không |
| `booking-email` (Task 4, 5; Task 13), khách đặt | cafe-indochine | ngày mở cuối của cửa sổ | không |
| `booking-email`, xác nhận | `seedReservation()` mặc định (taya-house +3) | như đợt 4 | không |
| `booking-email`, A3 thử lại (Task 13) | taya-house +3 (`seedReservation({ status: 'confirmed' })`), một hàng `guest.confirmed` gieo thẳng | `queued`, attempts 1, đến hạn | không |
| `booking-v2`, đường lỗi của drawer (Task 10) | availability giả | REQUEST BOOKING không gửi gì (hoặc POST bị hủy) | không |
| `admin-emails`, nhật ký và "Gửi lại" (Task 7) | hai-van-lounge | +40 (gieo thẳng, email `failed`) | không |
| `admin-emails`, người nhận (Task 6) | hura-izakaya (phạm vi nhà hàng) | địa chỉ mới mỗi lần | xóa trong `finally` |
| `guest-guard` (Task 9), theo số điện thoại | pho-cuon | hôm nay + 13, ba đặt bàn web gieo sẵn cho một số mới | không |
| `guest-guard`, đồng ý/honeypot | drawer mặc định | không đặt gì | không |
| `botid` (Task 11, chạy riêng) | drawer mặc định | không đặt gì | không |

Luật: không spec chạy song song nào được thêm người nhận phạm vi `all` hay `destination` (nó sẽ lấy mất email nhân viên đang về hộp thư chung của `booking-email`); trường hợp đó để ở test tích hợp hoặc một file `*.serial.spec.ts`.

**Cổng kiểm tra của mọi task** (bước cuối mỗi task ghi con số mong đợi):

```bash
npm run typecheck
npm run lint
TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
node scripts/check-prerender.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson CRON_SECRET=$(openssl rand -hex 16) E2E_PORT=3210 npm run test:e2e -- --retries=0
lsof -nP -iTCP:3211 -sTCP:LISTEN
PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3211 EMAIL_DELIVERY=log npx next start -p 3211 &
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3211/ && break; sleep 1; done
VISUAL_BASE_URL=http://localhost:3211 npm run test:visual
lsof -ti tcp:3211 | xargs kill
```

Mốc tại `0733094`: unit + tích hợp 53 file, 601 test; E2E `118 passed` (117 `desktop` + 1 `desktop-serial`); visual `8 passed`; lint thoát 0 với 19 cảnh báo. oxlint 1.86 không in dòng tổng; đếm cảnh báo bằng `npm run lint 2>&1 | grep -c ': warning '`. Visual luôn mong đợi `8 passed` ở `maxDiffPixelRatio: 0`. **Không bao giờ chạy `--update-snapshots`**: Phần A không đổi trang khách; Phần B che link mới ở chân trang bằng `e2e/visual-added.css` (R17). Visual đỏ thì mở `test-results/**/*-diff.png` và sửa code. Một lần E2E toàn bộ mất khoảng 45–50 giây với `--retries=0`.

| Sau task | Unit + tích hợp | E2E | Visual | Lint |
|---|---|---|---|---|
| mốc `0733094` | 53 file, 601 test | 118 | 8 | 19 |
| 1 | 55 file, 617 test | 118 | 8 | 19 |
| 2 | 56 file, 640 test | 118 | 8 | 19 |
| 3 | 57 file, 649 test | 119 | 8 | 19 |
| 4 | 58 file, 671 test | 122 | 8 | 19 |
| 5 | 60 file, 729 test | 122 | 8 | 19 |
| 6 | 62 file, 743 test | 124 | 8 | 19 |
| 7 | 62 file, 749 test | 127 | 8 | 19 |
| 8 | 63 file, 769 test | 128 | 8 | 19 |
| 9 | 63 file, 803 test | 131 | 8 | 19 |
| 10 | 63 file, 809 test | 133 | 8 | 19 |
| 11 | 65 file, 838 test | 133 + 1 skipped | 8 | 19 |
| 12 | 66 file, 848 test | 133 + 1 skipped | 8 | 19 |
| 13 | 66 file, 848 test | 134 + 1 skipped | 8 | 19 |

Từ Task 11, `e2e/botid.spec.ts` báo `1 skipped` trong mọi lần E2E thường (nó chỉ chạy khi server có `BOTID_DEV_BYPASS=BAD-BOT`, Task 11 Bước 4).


## Rulings — 23 điểm lệch spec đã được chấp nhận (không báo lại khi review)

Chủ dự án đã bảo làm theo các đề xuất của dàn ý; sửa đổi spec §2.0 (SMTP thay Resend) đã áp dụng ở `47ad5ee`. Kế hoạch chấp nhận cả 23 phán quyết của dàn ý (mục 2.1) như dưới đây. Mỗi mục ghi điều sẽ xảy ra nếu phán quyết sai. Reviewer không nêu lại chúng như lỗi.

1. **R1. SMTP, gửi ít nhất một lần.** nodemailer thay Resend cho mọi email. SMTP không có idempotency key, nên giao thức là giữ hàng → lease → gửi → đánh dấu có rào, với Message-ID lưu lại. Khe trùng: function chết sau khi máy chủ trả 250 và trước khi đánh dấu; trần 30 s hết giờ trong lúc máy chủ vẫn nhận DATA (đã chứng minh với sink); đánh dấu `sent` lỗi (C14 thu hẹp khe này). **Nếu sai** (muốn đúng một lần): chỉ nhà cung cấp có API idempotency làm được; outbox giữ nguyên, đổi lại transport.
2. **R2. Lịch sử email chỉ nằm ở `email_outbox`.** CHECK của `reservation_events` giữ như 006; lần gửi không vào `/admin/audit` qua `audit_feed`. Trang đặt bàn liệt kê hàng `email_outbox` cạnh dòng thời gian. "Gửi lại" ghi một hàng `audit_log` (`action 'update'`, `entity_type 'email_outbox'`, `entity_id` = id outbox, `before {status, attempts}`, `after {status:'queued'}`, không địa chỉ), nhãn "Email" trong `audit-labels.ts`. Hai việc hoãn của đợt 4 ("guard nhãn audit đọc CHECK của 006", "đặt nhãn sự kiện email của khách/hệ thống") thành vô nghĩa. **Nếu sai:** một migration sau thay CHECK và backfill từ `email_outbox`; guard khi đó đọc constraint sống.
3. **R3. Kho email chung là `site_settings`, tạo sớm ở 007** chỉ với `email`, seed `fb@furamavietnam.com` (`CONTACT.email`). Đợt 6 phải `ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS …`, không bao giờ `CREATE TABLE`. Sửa "Hộp thư chung" cũng sẽ đổi email ở chân trang từ đợt 6/7; màn hình nói rõ. **Nếu sai:** đợt 6 đổi tên hoặc dời một cột.
4. **R4. Người nhận.** Phạm vi nhà hàng ∪ điểm đến (`restaurants.destination`) ∪ tất cả; hàng đang bật có `events` chứa `staff.new`; `DISTINCT ON (lower(email))`, cách viết và ngôn ngữ của phạm vi hẹp nhất thắng; `events` CHECK `<@ ARRAY['staff.new']`; ngôn ngữ mặc định `vi`; hàng dự phòng dùng `vi`. **`staff.new` chỉ cho đặt bàn web** (nhân viên không tự báo cho mình); lời mở đầu nói "đã tự động xác nhận" khi tự xác nhận. **Nếu sai:** một lời gọi trong `outboxEffects.afterCreate`.
5. **R5. Message-ID** `<outbox-{id}.{12 hex}@{tên miền EMAIL_FROM}>`, cố định ở lần giữ hàng đầu tiên biết tên miền, mọi lần thử lại và "Gửi lại" dùng lại. Phần ngẫu nhiên giữ cho branch Preview và DB của dev không sinh ra một ID hộp thư đã thấy (Gmail có thể bỏ bản thứ hai). Mời/đặt lại mật khẩu: `<invite-{id}-{sha16}@domain>` / `<reset-…>`, không bao giờ chứa token. **Nếu sai:** thẩm mỹ; một định dạng header.
6. **R6. Ngữ nghĩa giữ hàng và thử lại.** Số lần gửi tính lúc giữ hàng (một lần gửi làm chết function vẫn tốn một lần); lease 120 s; hàng `sending` hết lease ở lần thứ 7 bị thu hồi thành `failed` (`lease_expired`); 5xx ở `RCPT TO` → `rejected`, hỏng ngay; mọi lỗi khác (đăng nhập, TLS, 4xx, 5xx sau DATA như hết hạn mức của nhà cung cấp, timeout, cấu hình, `not_delivered`) thử lại theo thang. "Gửi lại" trên hàng `failed` đặt số lần về 0 (lịch ≈19,4 giờ mới). **Nếu sai:** một thư bị từ chối vì spam được thử thêm 6 lần trong 19 giờ (5xx ở DATA); đổi một điều kiện.
7. **R7. Bỏ qua khi không còn khớp.** Chỉ gửi khi đặt bàn đang: `staff.new` requested/confirmed/seated; `guest.ack` requested; `guest.confirmed` confirmed; `guest.declined` declined; `guest.cancelled` cancelled. Cũng bỏ qua: đặt bàn đã mất hoặc đã ẩn danh; email khách đã đổi từ lúc vào hàng. Địa chỉ sửa lại không được gửi tự động, và "Gửi lại" từ chối hàng bị bỏ qua, nên nhân viên xác nhận qua điện thoại. `last_error` nói vì sao (`skipped: the booking is now cancelled`). **Nếu sai:** sửa `EVENT_STATUSES`, hoặc cho "Gửi lại" đưa một hàng khách bị bỏ qua vào hàng gửi tới địa chỉ hiện tại.
8. **R8. Lựa chọn email phía nhân viên** (chữ của spec §10.3, làm cụ thể):
   - Đặt qua điện thoại: hiện "Gửi email xác nhận", **mặc định bật**; đưa `guest.confirmed` vào hàng khi được tick và đặt bàn có email.
   - Khách vãng lai: ẩn ô; khách vãng lai không bao giờ nhận `guest.confirmed` (lệch: dòng spec cho phép khi tick; khách đã ngồi bàn).
   - Hủy (một đặt bàn, và hủy hàng loạt từ danh sách bị ảnh hưởng của ngày đóng cửa): "Báo khách qua email" **mặc định bật**.
   - Từ chối: luôn gửi email (spec), kèm lý do.
   - Khi email sẽ mang lý do, ô lý do ghi "Lý do này sẽ được gửi cho khách."
   - **Nếu sai:** mỗi mặc định là một thuộc tính; email cho khách vãng lai là một điều kiện cộng `EVENT_STATUSES['guest.confirmed']` thêm `seated`.
9. **R9. "Gửi email thử" gửi thẳng**, không qua outbox: đặt bàn mẫu (`FC-0000TEST`, không dữ liệu khách) theo mẫu và ngôn ngữ chọn, qua cùng cổng và transport, chờ kết quả; Admin thấy "Đã gửi … (live|redirect|log)" hoặc gợi ý tiếng Việt (`email_failed`). Không lưu gì; dòng log chỉ mang mã lỗi. Spec liệt kê nó là một nút kích hoạt bộ gửi; gửi thẳng kiểm đúng điều cần kiểm trên deployment (ra được SMTP, tài khoản, căn chỉnh DNS, render) mà không để lại một hàng thử trong số email lỗi hay một lịch thử lại 19 giờ. **Nếu sai:** thêm lại `staff.test` (`reservation_id` cho phép NULL, LEFT JOIN trong nhật ký, loại khỏi Tổng quan) bằng một migration sau.
10. **R10. Ngôn ngữ email của khách.** `reservations.locale` khi ngôn ngữ đó đang bật **hoặc** registry có chữ riêng cho mọi key email đó đọc (đúng với `vi`); ngược lại là ngôn ngữ mặc định (`en`). Vậy một đặt bàn qua điện thoại bằng tiếng Việt nhận email tiếng Việt ở mốc A, như spec §1/§3, còn một ngôn ngữ chưa có chữ không bao giờ nhận chữ Anh lẫn ngày tháng nước ngoài. Email nhân viên luôn theo ngôn ngữ của người nhận. **Nếu sai:** một điều kiện trong `resolveEmailLocale`.
11. **R11. Reply-To:** `staff.new` → email của khách (nhân viên trả lời thẳng khách); email cho khách → `site_settings.email`. Chế độ redirect bỏ Reply-To (R22). **Nếu sai:** hai dòng; xác nhận với đội nhà hàng.
12. **R12. Riêng tư của nhật ký email:** danh sách che địa chỉ khách (`l•••@gmail.com`), địa chỉ nhân viên hiện đủ; trang đặt bàn hiện đủ địa chỉ (nó vốn hiện thông tin khách); `last_error` được xóa địa chỉ lúc ghi và lúc hiện; URL chỉ có `tab` và `sau`. **Nếu sai:** thẩm mỹ.
13. **R13. Email khách chỉ một `@`.** Siết mẫu email khách thành `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` ở cả hai phía, vẫn sau `max(254)` dừng sớm (F1 của đợt sửa cuối) — việc của Task 9 (Phần B). Chắc chắn thêm: hàng đợi chỉ chèn hàng khách khi địa chỉ khớp `^[^@[:space:]]+@[^@[:space:]]+$` (Task 3), nên một địa chỉ lạ đã lưu không bao giờ làm hỏng đặt bàn. **Nếu sai:** khách có phần trước `@` trong ngoặc kép chứa `@` (thực tế không có) nhận `invalid_email`.
14. **R14. Giới hạn theo số điện thoại:** tối đa `PHONE_DAY_LIMIT = 3` đặt bàn **web** `requested` hoặc `confirmed` cho một `phone_e164` trong một `reserved_on`, mọi nhà hàng. Kiểm trong transaction đặt bàn dưới `lockGuestPhoneDay` (khóa `guest-phone:<e164>:<ngày>`, chờ tối đa 5 s) lấy **trước** `lockBookingDay`, nên `too_many_requests` thắng các mã quy tắc và một loạt từ một số chờ trên khóa của riêng nó. Câu báo cho số điện thoại của điểm đến. **Nếu sai:** một truy vấn và một khóa.
15. **R15. Honeypot:** báo `bot_blocked` thấy được ("We could not accept this request online. Please call us on {phone} to book."), không bao giờ giả thành công: một lần trình duyệt tự điền nhầm không được trông như đã đặt. Mọi giá trị khác `undefined`/`null`/`''` đều tính. **Nếu sai:** trả `ok` giả cho riêng `by: 'honeypot'`.
16. **R16. BotID trên Server Action.** Client: `initBotId` từ `instrumentation-client.ts` chỉ khi `NEXT_PUBLIC_VERCEL_ENV ∈ {production, preview}` và đường dẫn không phải `/admin`; nó vá `fetch`, mà client action của Next gọi lúc gọi. Server: `checkBotId()` chỉ khi `VERCEL_ENV ∈ {production, preview}`; **bot đã xác minh bị từ chối**; **lỗi, hoặc không có phán quyết sau `BOTID_TIMEOUT_MS = 3_000` ms, thì cho qua** (log `[botid] check failed`; fetch của `checkBotId` tới Vercel trong botid 1.5.11 không có hạn riêng, nên thiếu hạn này một API Vercel treo sẽ giữ mọi lần đặt bàn tới `maxDuration`); ngoài Vercel chỉ `BOTID_DEV_BYPASS=BAD-BOT` bật nó (test). Không có job CI cho `botid.spec.ts` chạy riêng; tích hợp + test đơn vị trên wrapper thật phủ CI. Deep Analysis do người dùng chọn. **Nếu sai:** chặn khi lỗi là một `return true`; cho một loại bot đã xác minh là một điều kiện.
17. **R17. Bản ghi đồng ý và chữ chính sách:** `reservations.consent_version` (= `PRIVACY_POLICY_VERSION '2026-10-02'`) + `consented_at`, CHECK theo cặp, trình ẩn danh giữ lại. Key thông báo và ô đồng ý `booking.privacy_notice`, `booking.consent` (screen `legal`, tiền tố `booking.` để tới client); `legal.link` vào `ClientKey`; key trang `legal.*`. **Chỉ EN** cho tới khi có chữ VI đã qua luật sư (registry cho phép VI với `legal.*`). Phiên bản được ghim bằng test hash chữ EN. Link ở chân trang được ẩn trong spec visual bằng `e2e/visual-added.css` (không bao giờ `--update-snapshots`). **Nếu sai:** chụp lại 8 baseline một lần với diff đã duyệt.
18. **R18. SEC-2 làm ngay:** `searchReservations` (`reservations:read`) cất `q` trong cookie `fc_inbox_search` (httpOnly, `sameSite strict`, path `/admin/reservations`, 30 phút, `secure` trừ khi `BETTER_AUTH_URL` là http) và chuyển tới `?tim=<8 hex>`; phân trang `?tim=&sau=`; lần tìm của tab khác làm hết hạn lần trước; proxy bỏ `q` khỏi `next`. **Nếu sai:** cookie vẫn giữ dữ liệu cá nhân trên trình duyệt của nhân viên 30 phút; thêm một action xóa.
19. **R19. Cấu hình cron:** `vercel.json` (không phụ thuộc gói, có JSON schema), không phải `vercel.ts` (F8: `@vercel/config` 0.7.2 kéo zod 3, 3 lỗi audit mức cao, và dạng `export const config` được tài liệu hóa lặng lẽ làm mất cron). Chỉ `GET`; `CRON_SECRET` ngắn hơn 16 ký tự → mọi lần gọi 401. **Nếu sai:** chuyển sang `vercel.ts` với `export default`.
20. **R20. `after()` gửi gì:** các id nó vừa đưa vào hàng, rồi các hàng đến hạn khác của env, tối đa 10 hàng / 25 s; chỉ lên lịch khi COMMIT thành công; hủy hàng loạt lên lịch trong `finally` khi có gì đã vào hàng. "Gửi lại" gửi id của nó trước. **Nếu sai:** ngân sách là hằng số.
21. **R21. Tổng quan:** "N email lỗi" đếm hàng `failed` của env hiện tại; "Nhà hàng chưa có người nhận thông báo" liệt kê các nhà hàng `booking_enabled` mà không người nhận nào đang bật với tới (chúng vẫn gửi về hộp thư chung). **Nếu sai:** một mệnh đề WHERE.
22. **R22. Preview và email nhân viên** (rủi ro 1 của sổ đợt 3): Preview dùng `EMAIL_DELIVERY=redirect` tới một hộp thư chỉ Admin đọc. Link đặt lại mật khẩu của các hàng nhân viên được fork về đó, nhưng một lần đặt lại trên Preview chỉ đổi bản của branch Preview, không bao giờ production. Code giữ điều đó, không chỉ cấu hình: `resolveMode` từ chối `live` khi `VERCEL_ENV` là `preview` hoặc `development` (`invalid_delivery_mode`, không mở kết nối SMTP; hàng outbox thử lại rồi `failed`, "Gửi email thử" báo lý do, câu chế độ gửi nói "không hợp lệ"), và redirect bỏ Reply-To, nên trả lời từ hộp thư chuyển hướng không tới khách thật lẫn hộp thư chung của production. **Nếu sai:** đặt Preview là `log` và chấp nhận lời mời hỏng ở đó (`not_delivered`).
23. **R23. `appOrigin()` chặn khi thiếu cấu hình:** nó ném `EmailSendError('missing_app_url')` mới khi `BETTER_AUTH_URL` không đặt mà chế độ là live/redirect hoặc `VERCEL_ENV` là production/preview; chế độ log ngoài Vercel giữ mặc định localhost cho dev và test. Link nhân viên trong `staff.new`, lời mời và đặt lại mật khẩu đều dùng nó. **Nếu sai:** một điều kiện.

**Ghi chú triển khai (Phần A).** Các điểm sau không lệch spec; chúng điều chỉnh dàn ý theo những gì lần chạy Phần A cho thấy. Mỗi điểm đã chạy trong `p5-verify`.
- **Mỗi thứ đến cùng task đầu tiên dùng nó.** `lib/server/email/booking/load.ts` (`loadBookingEmailData`, cả `anonymized`) và việc export `groupPhoneSql` khỏi `lib/server/booking/rules.ts` đến ở Task 4, không phải Task 5: bộ gửi cần đọc lại đặt bàn để bỏ qua email không còn khớp ngay từ đầu, và số điện thoại của điểm đến nằm trong cùng truy vấn. `sample.ts` (đặt bàn mẫu) đến ở Task 6 cùng "Gửi email thử", người dùng đầu tiên của nó. `e2e/admin-emails.spec.ts` bắt đầu ở Task 6 với hai test của màn "Thông báo email" (403 của Editor; Admin thêm người nhận và gửi email thử); Task 7 thêm ba test của nhật ký và Tổng quan (dàn ý để cả bốn ở Task 7).
- **Task 3 có một test E2E** (`admin-reservations.spec.ts` "the guest emails staff choose (R8) …"): ô "Báo khách" bật sẵn và câu "Lý do này sẽ được gửi cho khách." hiện/ẩn theo ô, ô "Gửi email xác nhận" ẩn khi chọn khách vãng lai. Dàn ý chỉ nêu test tích hợp; phần giao diện của R8 cần một test chạy thật.
- **Trạng thái của ô "Báo khách" theo kết quả action.** `TransitionPanel` dùng `action={action}`, mà React đặt lại form sau mỗi lần action (ô tick lại về bật); ô vì vậy không điều khiển (uncontrolled), và state của câu nhắc lý do đi theo đối tượng kết quả của `useActionState` (đổi là về bật). `AffectedList` làm tương tự theo khóa của form.
- **Đột biến M4 của dàn ý không đỏ với test của spike.** Bỏ `SKIP LOCKED` (chỉ còn `FOR UPDATE`) để test "hai bộ gửi cùng lúc" xanh trên `main` hôm nay: trong READ COMMITTED, bộ gửi thứ hai chờ lệnh giữ hàng (rất ngắn) của bộ thứ nhất, kiểm lại hàng, thấy nó đã `sending` và lấy hàng kế. `SKIP LOCKED` là để không chờ, không phải để đúng. Task 4 thêm test "a row locked elsewhere does not stall the drain: it sends the others now (SKIP LOCKED)" (một transaction khác giữ khóa hàng; bộ gửi phải gửi hàng còn lại trong 2 s); M4 làm đúng test đó đỏ.
- **C14 trong bộ gửi:** chỉ phần đọc lại, render và gửi nằm trong `try`; đánh dấu `sent` nằm ngoài, thử lại một lần, hỏng lần hai thì log `code=mark_failed`, đếm vào `lost`, và để hàng `sending` cho lease. `DrainReport.lost` vì vậy là "các hàng bộ gửi này không ghi được kết cục": bị rào loại, hoặc đánh dấu `sent` hỏng hai lần. Đột biến "chỉ thử một lần" làm test của C14 đỏ.
- **`drainOutbox` không còn `alsoDue`:** nó chỉ tồn tại cho `staff.test` của spike, mà R9 bỏ.
- **`requeueEmail` là một transaction `SELECT … FOR UPDATE` → `UPDATE` → `insertAudit`**, không phải câu CTE một lệnh của spike: hàng `audit_log` của R2 cần `before {status, attempts}`, và quyết định vẫn nằm trên hàng đã khóa (C9). Test "decides on the row as it is once locked …" giữ một lần giữ hàng chưa commit trong lúc "Gửi lại" chờ; bỏ `FOR UPDATE` thì test đỏ.
- **`sendTestEmail` tự tính `appOrigin()` trong `try`**, nên thiếu `BETTER_AUTH_URL` (R23) báo `email_failed` kèm gợi ý "Chưa đặt BETTER_AUTH_URL …", thay vì `db_error`. `emailFailureHint` đọc định dạng lỗi của outbox-core (`rejected: …`, `provider_error: SMTP EAUTH …`).
- **`deliveryModeNotice` không in lại giá trị sai của `EMAIL_DELIVERY`**: màn hình chỉ nói chế độ (Editor cũng xem nhật ký).
- **`renderSampleEmail` đặt Reply-To theo R11** như email thật (mẫu `staff.new` trả lời về địa chỉ mẫu `khach.mau@example.com`, mẫu cho khách về hộp thư chung); ở chế độ redirect cổng gửi bỏ nó như mọi email (R22), nên Reply-To của email thử chỉ thấy được ở chế độ live.
- **`Checkbox` (zod) dùng chung:** Task 3 thêm nó vào `lib/admin/booking-schemas.ts` cho ba ô email và đổi bốn chỗ `z.preprocess((v) => v === 'on', …)` cũ sang nó; `RecipientForm` (Task 6) dùng lại.
- **Phần việc hoãn của đợt 3 nằm ở Task 2:** `INVITE_TTL_DAYS`/`RESET_TOKEN_SECONDS` (file mới `lib/server/auth/lifetimes.ts`, không `server-only` vì `config.ts` được CLI nạp) thay các số viết cứng trong template; `deliverInvite` chỉ để lời gửi trong `try`, ghi sổ sau đó hỏng thì log `[staff] invite bookkeeping failed` mà vẫn báo đã gửi.
- **Đo react-email (việc hoãn của đợt 3, Task 5):** `npm ls --omit=dev` cho thấy `react-email@6.11.0` kéo `esbuild@0.28.2`, `socket.io@4.8.4`, `tailwindcss@4.3.3` vào `dependencies`; nhưng file trace của function (`.next/server/app/api/cron/outbox/route.js.nft.json`) không chứa gói nào trong ba gói đó: 166 file, tổng 2,9 MB (node_modules 2,3 MB: `next` 1,5, `prettier` 0,3). Chunk server chứa bộ render khoảng 355 KB. Xa giới hạn 250 MB của function: không cần làm gì (rủi ro 21 đóng).
- **Cài gói bằng `--offline`, đúng bản:** lần chạy kiểm chứng cài từ cache npm của máy (nodemailer, smtp-server, @types/smtp-server đã có trong cache từ các spike). Task 2 Bước 1 ghi đúng các lệnh đã chạy lại (`npm uninstall --offline resend`, `npm install --offline nodemailer@10.0.13`, `npm install --offline -D smtp-server@3.19.16 @types/smtp-server@3.5.13`): trên commit của Task 1 (cùng `package.json`/lock với `0733094`) chúng cho `package.json` và `package-lock.json` trùng từng byte với commit của Task 2 (npm vẫn ghi `^10.0.13` … vào `package.json`; lock ghim bản đã kiểm). Một khoảng `^` không `--offline` sẽ lấy bản mới nhất ngày chạy và lock có thể lệch. Chỉ khi cache thiếu gói (`ENOTCACHED`) mới chạy lại lệnh đó không `--offline`.

**Ghi chú triển khai (Phần B).** Như trên: không lệch spec, chỉ điều chỉnh dàn ý theo lần chạy Phần B trong `p5-verify`.
- **Task 8 tạo `e2e/guest-guard.spec.ts`** với test trang chính sách từ chân trang (dàn ý để mọi test của file ở Task 9); Task 9 viết lại file với ba test của form, Task 11 thêm kiểm `x-is-human`. Comment của `e2e/visual-added.css` trỏ tới spec này (spike ghi nhầm `e2e/privacy.spec.ts`). Test hash của `lib/legal.test.ts` có thêm một test: chưa key nào khách đồng ý có bản `vi` (R17).
- **Bước 1 đến theo từng lớp:** Task 9 đặt honeypot vào bước 1 và sửa lời giải thích của `submitReservation` trong danh sách action công khai thành "the honeypot first, then zod with consent, the per-phone daily limit, …"; Task 11 thêm BotID vào cả hai. Test tích hợp BotID (`BOTID_DEV_BYPASS=BAD-BOT`) nằm trong nhóm "step 1" từ Task 11.
- **R13 ở hai lớp:** `GUEST_EMAIL` (`lib/booking.ts`) là một mẫu cho `validate` và zod. Test R13 của Task 3 (`email-outbox.test.ts`) giờ kiểm form từ chối địa chỉ hai `@`, rồi đưa thẳng giá trị đó vào `createWebReservation` (một giá trị đã lưu từ trước) để chứng minh bộ lọc của hàng đợi vẫn giữ đặt bàn. Comment của `queueGuestEmail` được sửa theo ở Task 13.
- **Cuộc đua theo số điện thoại không có khóa:** cả sáu giao dịch thành công (`got 6`), không phải "5 trên 6" như spike; ba lần chạy đều vậy. Task 9 thêm test "comes before the rule checks: a fifth request for a closed sitting still hears about the limit" (R14: `too_many_requests` thắng các mã quy tắc).
- **Đường lỗi của drawer (Task 10) không có code spike**, viết mới: `getJson` phân biệt 404 (`gone`); `loadFailed.code`; loại `network` của ghi chú chân drawer bỏ đi, thay bằng `failureNudge` (focus tới Thử lại, nút có `aria-describedby` là thông báo); khôi phục focus sau Thử lại thành công; vùng `status` của thanh đặt bàn. Hai test của nhóm A đổi kỳ vọng (không còn alert thứ hai ở chân drawer) và đổi tên theo đó.
- **`npm install --offline --save-exact botid@1.5.11`** ở Task 11, như các gói của Task 2: trên `package.json`/lock của Task 10 nó cho đúng hai file của commit Task 11; `npm audit` sau Task 11 ra 0. Spec BotID chạy riêng một lần trên build của Task 11 (`1 passed`) và một lần trên build của Task 10 (`1 failed`, RED).
- **Bộ nghiệm thu của Task 13 xanh ngay khi viết** (hành vi có từ Task 4–11); bằng chứng là mười đột biến ở Task 13 Bước 6. Đột biến "bỏ `honeypotFilled`" của dàn ý không làm E2E đỏ vì lớp zod (R15), chỉ làm test tích hợp đỏ; E2E đỏ khi bỏ cả hai lớp. A3 trong E2E không kiểm Message-ID: chế độ log không có `EMAIL_FROM`, nên không có tên miền và hàng không mang Message-ID (Task 4 kiểm nó trên dây).
- **Tiêu đề test của honeypot:** sau lần chạy đầu, các case `honeypotFilled` của `input.test.ts` được đổi thứ tự cột để tiêu đề in `a URL → true` thay vì cả đối tượng; commit của Task 9 được sửa lại và Task 10–13 được đặt lại lên nó (chỉ file test đó khác). Cổng kiểm tra của Task 9–12 chạy lại trên các SHA mới, cùng số đếm; RED của Task 9 ở trên là lần chạy lại với file test cuối trên code của Task 8.

**Đợt sửa sau review.** Review kế hoạch (hai góc: spec-bảo mật, khả thi) đưa ra chín điểm; cả chín được áp dụng, mỗi cái vào task sở hữu file. Phần code chạy thành một commit trên `main` của `p5-verify` (cổng đầy đủ xanh: `66` file, `848` test; E2E `134 passed`, `1 skipped`; visual `8 passed`), rồi được gộp vào `p5-folded` (xem "Bản kiểm chứng").
- **`live` chỉ ở Production (Task 2, 6, 13):** `resolveMode(raw, vercelEnv)` (export từ `send.ts`) ném `invalid_delivery_mode` cho `live` khi `VERCEL_ENV` là `preview`/`development`, trước mọi kết nối SMTP; `deliveryModeNotice` dùng chính hàm đó nên màn hình nói "không hợp lệ"; runbook bước 4 bảo chỉ tick Production. Test mới: `email.test.ts` "live on a Preview deployment is refused and opens no SMTP connection", `mode.test.ts` "live on a Preview or under `vercel dev` is not live …". Gợi ý `invalid_delivery_mode` có sẵn của `emailFailureHint` giữ nguyên; chi tiết lỗi in sau nó nói "EMAIL_DELIVERY=live is for Production only …".
- **BotID có hạn 3 s (Task 11):** `BOTID_TIMEOUT_MS = 3_000`; `Promise.race` với một bộ hẹn giờ, `clearTimeout` trong `finally`; quá hạn thì nhánh `catch` sẵn có log `[botid] check failed, request let through` (`name: 'TimeoutError'`) và cho qua (R16). Test mới `bot.test.ts` "fails open when BotID does not answer within 3 s" (fake timers; trên code cũ nó hết 5 s và đỏ).
- **Redirect bỏ Reply-To (Task 2):** test redirect của `smtp.test.ts` và `email.test.ts` đưa `replyTo` vào và kiểm nó không tới máy SMTP (đổi tên theo).
- **Host SMTP không vào lỗi lưu (Task 2, 4):** `smtpError(cause, host)` thay host cấu hình, `address`/`hostname` của lỗi kết nối (cả IPv6) và mọi địa chỉ IPv4 còn lại bằng `<smtp-host>` (chỉ tên có dấu chấm hoặc hai chấm, để một host trần như `mail` không ăn mất chữ). Test mới `email.test.ts` "a stored SMTP error names neither the SMTP host nor its address …"; test tích hợp "an SMTP server that is down …" (Task 4) kiểm thêm không có `127.0.0.1`. Phương án (a) của review được chọn thay vì sửa chữ của Review Focus 4.
- **Runbook (Task 13):** bước 5 thêm `BETTER_AUTH_URL` của Preview (thiếu nó mọi email có link ra `missing_app_url`); bước 11 kiểm hàng `staff.new` "Đã gửi" và một lời mời tới hộp thư chuyển hướng với link tới origin của preview; Bước 8 ghi rủi ro 1 của sổ đợt 3 đóng bằng kiểm đó. Dàn ý §7 (thư mục nghiên cứu, ngoài các commit của kế hoạch) không sửa ở đây: README là runbook chủ dự án theo.
- **Lệnh và quy tắc (không đổi code):** đột biến của Task 13 Bước 6 chạy trên DB và cổng được phép, xóa cả `.env.local` của bản sao; tiền tố env cục bộ để trống các khóa đợt 5 đọc; lệnh `grep` của Review Focus 1 đệ quy và đúng số chỗ gọi; Task 2 và Task 11 cài `--offline` đúng bản, và Global Constraints ghi registry npm là lần ra mạng duy nhất được phép.

## Review Focus

Năm tình huống spec ngụ ý mà dễ làm hỏng nhất cho người dùng thật. Mỗi dòng có test gắn vào task sở hữu code; mọi tên test là tên thật trong các commit của `p5-verify`.

1. **Gửi trùng hoặc mất email khi đồng thời và thử lại.**
   - Có thể hỏng: lệnh giữ hàng thiếu `FOR UPDATE SKIP LOCKED` hoặc thiếu điều kiện lease (`status='queued' OR (status='sending' AND locked_until < now())`); một lần đánh dấu không có rào `attempts`; số lần gửi không tính lúc giữ; thu hồi không chỉ ở `attempts >= 7`; "Gửi lại" quyết định trên một lần đọc cũ thay vì hàng đã khóa, hoặc nhận hàng `sending`; đánh dấu `sent` hỏng sau khi gửi lại lên lịch gửi lại (C14); `after()`, cron và "Gửi lại" cùng chạm một hàng. Mất: hàng không bao giờ tới trạng thái cuối (thu hồi), hàng ở env không bộ gửi nào lấy, một đường ghi quên `drainAfterCommit` (hủy hàng loạt trong `finally`), một hàm hàng đợi lặng lẽ không chèn gì (bộ lọc địa chỉ chỉ được bỏ địa chỉ sai).
   - Test: `test/integration/email-outbox.test.ts` "two drains at once never send the same row twice", "a row locked elsewhere does not stall the drain: it sends the others now (SKIP LOCKED)", "a crash between the send and \"sent\": the lease holds it, then the next drain sends it again with the same Message-ID", "the \"sent\" mark failing after a send is not a send failure: tried once more, and never scheduled for a retry (C14)", "a drain whose lease ran out mid-send cannot overwrite the newer claim (fenced by attempts)", "a claim that died on its 7th attempt is marked failed once its lease ends", "retries after 1 m, 5 m, 15 m, 1 h, 6 h and 12 h with the same Message-ID, then marks it failed after the 7th attempt", "drains only its own env: a Preview never sends production rows, and the reverse" (Task 4; đột biến M1, M2, M4, M5 và C14 ở Task 4 Bước 8, mỗi cái làm đúng test của nó đỏ); "an address the outbox would refuse (two @) never fails the booking: it books, without a guest email (R13)" (cả địa chỉ `sassy.susan@ses.example.com` mà một mẫu `\s` hỏng sẽ bỏ sót; Task 3); `test/integration/submit-reservation.test.ts` "queues staff.new and guest.ack in the booking transaction, and sends them only after the response (spec §10.2 steps 6–7)" và "a refused booking schedules no drain" (Task 4); `test/integration/email-screens.test.ts` "decides on the row as it is once locked: a claim that lands first wins, and the requeue is refused" (Task 7; bỏ `FOR UPDATE` thì đỏ); `e2e/booking-email.spec.ts` (Task 4, 5) và `e2e/admin-emails.spec.ts` "an Editor finds a failed email … and sends it again" (Task 7). Reviewer: `grep -rn "drainAfterCommit(" app | grep -v import` ra đúng 5 lời gọi: `app/actions.ts` (khách), ba lần ghi của nhân viên trong `app/admin/(shell)/reservations/actions.ts` (`changeStatus`, `createReservation` trước `redirect()`, `cancelReservations` trong `finally`), và `reservations/emails/actions.ts` ("Gửi lại"). `updateReservation` và `addNote` không gọi nó (spec §10.3 chỉ gửi email khi tạo đặt bàn hoặc chuyển trạng thái).
2. **Email tới nhầm người, hoặc lộ dữ liệu cá nhân.**
   - Có thể hỏng: chế độ redirect không đổi mọi người nhận, hoặc giữ Reply-To thật (trả lời từ hộp thư chuyển hướng tới khách của dữ liệu fork); `live` chạy được trên Preview (dữ liệu fork từ production, R22); một truy vấn của bộ gửi hay của admin thiếu lọc `env`; email khách vẫn đi khi địa chỉ đã đổi; hợp người nhận sai hoặc không bỏ trùng; email khách trả lời về địa chỉ một nhân viên; địa chỉ, tên hay số điện thoại lọt vào log, `last_error`, `provider_id`, Message-ID, URL (chỉ được `tab`/`sau`/`tim`) hay câu trả lời của cron; `deliveryModeNotice` in cài đặt; ghi chú nội bộ được render; `status_reason` tới khách ngoài từ chối/hủy; nhật ký email không che địa chỉ khách.
   - Test: `lib/server/email/smtp.test.ts` "redirect: the team inbox gets it, the real address only in the subject, and no Reply-To" và `email.test.ts` "redirect rewrites \"to\", keeps the original in the subject, drops the Reply-To, …", "live on a Preview deployment is refused and opens no SMTP connection" (Task 2); `email-outbox.test.ts` "a web booking queues staff.new for the restaurant, destination and all recipients (deduplicated), and guest.ack" (Task 3), "skips a guest email whose address changed since it was queued, and one whose booking was anonymised", "logs ids, events, codes and attempts, never an address", và Reply-To trên dây trong "sends each row over SMTP once …" (Task 4, 5); `email.test.ts` `describeEmailError`/`redactEmails` (Task 2); `lib/server/email/booking/render.test.ts` "guest emails: their own words, the restaurant’s number as a tel: link, no admin link, no guest contact details" và "declined and cancelled quote the reason; the request and confirmation never show one" (Task 5); `email-screens.test.ts` "never carries internal notes; the guest’s own request reaches staff only", "the destination’s phone, and replies to the guest (staff) or the shared inbox (guest) (R11)" (Task 5); `lib/server/email/mode.test.ts` (cả "live on a Preview or under `vercel dev` is not live …", Task 6); `admin-emails.spec.ts` (địa chỉ khách che `k•••@guest.test` trong nhật ký, Task 7). Reviewer: mọi `FROM email_outbox` trong `lib/server/email/drain.ts` và `outbox-log.ts` có `env = $…`; không file nào dưới `app/admin` in `toEmail` của khách ra nhật ký mà không qua `maskEmail`.
3. **Đặt bàn hỏng vì email hỏng.**
   - Có thể hỏng: SQL hàng đợi trong transaction đặt bàn ném lỗi vì dữ liệu khách gửi (địa chỉ qua được zod nhưng không qua CHECK của outbox, locale lệch FK, không người nhận → không hàng nào nhưng lỗi); sau COMMIT, một thứ gì của email biến thành công thành thất bại (`drainAfterCommit` phải chỉ lên lịch, `drainQuietly` không bao giờ ném, lỗi cấu hình SMTP chỉ lộ lúc gửi); `next build` hay lúc khởi động đọc biến SMTP.
   - Test: `email-outbox.test.ts` "a hook that fails rolls back the booking change and its rows together" (chứng minh sự ràng buộc), "an address the outbox would refuse (two @) …", "no recipient for the restaurant: staff.new goes to the general email (site_settings), in Vietnamese, marked fallback" (Task 3), "an SMTP server that is down: the booking stands, the row waits for the next attempt" (Task 4); `email.test.ts` "live without SMTP settings throws a clear error at send time, not at import" và nhóm `appOrigin` (Task 2); build của mọi task chạy không có biến SMTP nào.
4. **Lộ cron hoặc bí mật.**
   - Có thể hỏng: `cronAuthorized` so không hằng thời gian, hoặc nhận secret thiếu/ngắn; bí mật, host/user/mật khẩu SMTP hay địa chỉ redirect lọt vào câu trả lời, log hay trang admin (lỗi lưu `last_error` mà Editor đọc trong nhật ký email thay host cấu hình, địa chỉ của lỗi kết nối và mọi IPv4 bằng `<smtp-host>`; lỗi của nodemailer không mang mật khẩu, còn một user dạng email bị xóa như mọi địa chỉ); thiếu `no-store`; route bị prerender; `SMTP_PASSWORD` bị trim hoặc in trong lỗi `missing_smtp_config`.
   - Test: `test/integration/cron-outbox.test.ts` "wants exactly \"Bearer <CRON_SECRET>\", and a secret of 16+ characters", "answers 401 without the secret, with a wrong one, and when CRON_SECRET is not set; sends nothing and says nothing more", "with the secret, drains the due rows of its env and reports only the counts", "a drain that cannot run answers 500 with a code only" (Task 4); `smtp.test.ts` "a wrong password is a provider_error (retried: someone may fix the env)" (mật khẩu không có trong lỗi) và `email.test.ts` "a stored SMTP error names neither the SMTP host nor its address (Editors read it in the email log)" (Task 2); `email-outbox.test.ts` "an SMTP server that is down …" (không có `127.0.0.1` trong `last_error`, Task 4); luật 1c của `scripts/check-prerender.mjs` cho `/api/cron/outbox` (Task 4); `booking-email.spec.ts` "spec §13: the cron endpoint answers 401 without its secret, and drains with it" (Task 4, đổi tên ở Task 13). Đột biến "`cronAuthorized` luôn trả true" (Task 13 Bước 6) làm 2 test tích hợp và test E2E này đỏ.
5. **Bot hoặc một số điện thoại làm ngập đặt bàn.**
   - Có thể hỏng: thứ tự trong `submitReservation` sai (đúng là honeypot → BotID → zod (đồng ý) → transaction (khóa số điện thoại → đếm → khóa ngày → quy tắc → INSERT → outbox) → COMMIT → `after()`); đếm theo số điện thoại không nằm dưới khóa riêng; đảo thứ tự khóa; thiếu `lock_timeout` với pool 5; BotID cho qua mà không log, hoặc một API BotID treo giữ mọi lần đặt bàn tới `maxDuration` (fetch của `checkBotId` không có hạn riêng); danh sách bảo vệ của client bỏ sót một đường của khách hoặc chạm `/admin`; proxy chuyển hướng tiền tố của BotID; câu trả lời rẻ 400/404 của availability chạy sau truy vấn.
   - Test: `test/integration/submit-reservation.test.ts` nhóm "step 1: bots are refused before anything is read or written" ("a filled honeypot answers bot_blocked, and the log names only the check", "comes before zod: a bot gets bot_blocked, never a hint about which field was wrong", Task 9; "BotID’s verdict (its development bypass set to BAD-BOT) answers bot_blocked", Task 11) và nhóm "step 5: at most three active web requests per phone number per date" ("holds when one number books six restaurants at once (the guest-phone lock; the booking-day locks differ)", "a number waiting on its own lock holds up no one else at that restaurant and date", "comes before the rule checks: a fifth request for a closed sitting still hears about the limit", Task 9; gỡ khóa số điện thoại thì 2 đỏ); `lib/server/booking/input.test.ts` `honeypotFilled` (Task 9); `lib/server/guard/bot.test.ts` "fails open when BotID cannot answer, and logs no request data", "fails open when BotID does not answer within 3 s", `lib/botid.test.ts` (wrapper thật; danh sách `/api/*` ngây thơ thì 4 đỏ), `lib/i18n/proxy-matcher.test.ts` "proxy matcher and BotID" (Task 11); sáu test "answers … without touching the database" của `availability.test.ts` (Task 10); `e2e/guest-guard.spec.ts` "the honeypot is invisible to people and screen readers, out of the tab order, and a filled one is refused" và "a fourth request for one day from one number gets the limit and the restaurant’s own number to call" (Task 9); `e2e/botid.spec.ts` chạy riêng (Task 11). Các đột biến A5 ở Task 13 Bước 6.

## Rủi ro đã biết

Mỗi mục mang một nhãn: **Đã chấp nhận** (hệ quả của một phán quyết, hoặc đã có biện pháp) hoặc **Cần quyết định** (người dùng chọn). Kế hoạch không thêm task cho các mục này; Task 13 (Phần B) báo lại danh sách và ghi sổ.

1. **Đã chấp nhận (R1).** Có thể có bản trùng (chết sau 250, trần 30 s hết trong lúc DATA, đánh dấu hỏng). Mọi bản cùng một Message-ID; Gmail thường, không phải luôn, gộp chúng.
2. **Cần quyết định (preview đầu tiên).** Vercel Functions ra được cổng 587/465 hay không chưa kiểm (cổng 25 bị chặn). Kiểm bằng "Gửi email thử" ở chế độ redirect.
3. **Cần quyết định (khi biết nhà cung cấp).** Giới hạn của nhà cung cấp: Microsoft 365 cần bật "Authenticated SMTP" cho từng hộp thư và giới hạn người nhận mỗi ngày (5xx hết hạn mức ở DATA được thử lại, R6); Google Workspace cần app password và có giới hạn mỗi ngày. Mỗi đặt bàn web gửi 1 email khách + N email nhân viên.
4. **Cần quyết định (người dùng, IT Furama).** Khả năng tới hộp thư: `EMAIL_FROM` phải là người gửi được phép; SPF, DKIM cho tên miền gửi, DMARC căn chỉnh (bắt đầu `p=none`).
5. **Đã chấp nhận.** Vercel Cron chỉ chạy ở Production. Trên Preview, một email lỗi chờ `after()` của một lần ghi sau, hoặc "Gửi lại".
6. **Đã chấp nhận.** Một lần cron có thể chồng lần khác hoặc một lần `after()`; giữ hàng + lease làm việc đó an toàn.
7. **Cần quyết định (preview đầu tiên, Phần B).** BotID cần "Automatically expose System Environment Variables" (cổng phía client) và OIDC (phía server). Nếu tắt, client lặng lẽ bỏ qua hoặc server cho qua với `[botid] check failed`.
8. **Cần quyết định (Phần B).** BotID cho qua khi lỗi hoặc không trả lời trong 3 s (R16) và từ chối bot đã xác minh, kể cả tác tử AI đặt bàn. Deep Analysis tính tiền theo lần kiểm (giá chưa kiểm khi offline).
9. **Đã chấp nhận (đợt 10).** CSP tĩnh của web khách phải cho phép script của BotID (cùng origin qua rewrite; Deep Analysis có thể cần wasm/eval).
10. **Cần quyết định (người dùng, luật sư; Phần B).** Chữ chính sách là bản nháp EN (Luật 91/2025/QH15): danh tính bên kiểm soát, bên xử lý (Vercel, Neon, nhà cung cấp SMTP), câu 24 tháng; chữ VI cần cung cấp. Phiên bản đổi theo mỗi lần sửa chữ (test hash).
11. **Đã chấp nhận.** Chuỗi ICU ghim trên Node 22 (`Thứ Hai, 5 tháng 10, 2026`, `7:00 PM`, `Th 2, 5 thg 10, 2026`) có thể lệch một ký tự trên Node 24 của CI; nếu đỏ thì nới thành kiểm "chứa".
12. **Đã chấp nhận.** Chi phí dựng lại: các spike có trước đợt sửa cuối; cả hai phần đã dựng lại trên `0733094` (Task 3 trên `NewReservationForm`/`TargetPicker` của F9; Task 9 và 10 trên `SiteProvider`/`ReserveDrawer` của nhóm A; Task 12 trên test tìm kiếm chạy lại được của F18).
13. **Đã chấp nhận (R22).** Preview fork nhân viên và người nhận của production; chế độ redirect là bắt buộc ở đó (bộ gửi từ chối `live` khi `VERCEL_ENV` là `preview`/`development`, và redirect bỏ Reply-To); đặt lại mật khẩu trên Preview chỉ đổi branch Preview. Preview cần `BETTER_AUTH_URL` của chính nó (runbook bước 5), nếu không mọi email có link ra `missing_app_url`.
14. **Đã chấp nhận (hợp đồng đợt 10).** Trình ẩn danh ghi đè `email_outbox.to_email` bằng một giá trị thay thế qua được CHECK (`anonymized@invalid`, đã thử ở Task 1); `last_error`, `provider_id`, `message_id` không chứa dữ liệu cá nhân; cột đồng ý được giữ.
15. **Đã chấp nhận (hợp đồng đợt 6).** `site_settings` đã có; đợt 6 sửa nó bằng `ALTER`.
16. **Đã chấp nhận (Phần B).** Một lần khách gửi lấy hai khóa advisory và một truy vấn đếm; với pool 5, một loạt yêu cầu xếp hàng, và hết thời gian chờ thì khách thấy `error.network`.
17. **Đã chấp nhận (Phần B).** Cookie tìm kiếm giữ dữ liệu cá nhân của khách trên trình duyệt nhân viên tối đa 30 phút (httpOnly, giới hạn path).
18. **Đã chấp nhận (R8).** `status_reason` gõ bằng tiếng Việt có thể tới nguyên văn một email tiếng Anh; ô lý do cảnh báo nhân viên.
19. **Đã chấp nhận.** Người nhận có ngôn ngữ khác en/vi nhận chữ tiếng Anh với định dạng ngày của ngôn ngữ đó (`email-screens.test.ts` ghim `lang="ko"` khi `ko` bật).
20. **Đã chấp nhận (Phần B).** Rewrite của `withBotId` có trong build cục bộ; một request tay tới tiền tố BotID trên `next start` sẽ tới api.vercel.com.
21. **Đã chấp nhận (đo ở Task 5).** react-email để công cụ CLI (esbuild, socket.io, tailwindcss) trong `dependencies`, nhưng không gói nào trong ba gói đó được trace vào function: route cron 2,9 MB, chunk render khoảng 355 KB. Không cần làm gì.
22. **Đã chấp nhận (Phần B).** Một tab mở trước khi đợt 5 deploy không gửi đồng ý và nhận `consent_required`; site chưa từng deploy.
23. **Đã chấp nhận.** Tải E2E tăng: Phần A thêm 9 test (118 → 127), Phần B thêm 7 (127 → 134, cộng `1 skipped`), khoảng 48 s một lần chạy với `--retries=0`; E2E BotID chặn chỉ chạy riêng, không ở CI.
24. **Đã chấp nhận.** "Gửi lại" không `refresh()` (để câu "Đã đưa vào hàng gửi" không mất khi hàng rời tab "Lỗi"): kết quả hiện ở lần tải trang sau; câu thông báo nói vậy.
25. **Đã chấp nhận (Phần B).** `botid/client/core` (khoảng 6 KB) vào bundle client của mọi trang, kể cả nơi nó không bao giờ chạy: cổng là kiểm lúc chạy trên biến được inline.
26. **Đã chấp nhận (R14).** Một số vẫn giữ được 3 yêu cầu web đang hoạt động cho mỗi ngày của cửa sổ đặt bàn; đổi số thì vượt được giới hạn. BotID là lớp chặn chính; giới hạn chỉ chặn một số làm ngập một ngày.
27. **Đã chấp nhận (Task 10).** Khi ngày hoặc giờ không tải được, REQUEST BOOKING không còn thêm alert ở chân drawer: nó đưa focus (và cuộn) tới thông báo và nút Thử lại của nó. Trên điện thoại, thông báo vì vậy luôn được cuộn vào tầm nhìn; nếu chủ dự án muốn thêm một dòng ở chân drawer, nó phải là `status`, không phải `alert` thứ hai.

---

## Sơ đồ file

Task 1–13 đã chạy kiểm chứng; mỗi dòng là file thật của commit `p5-folded` trong "Bản kiểm chứng".

| File | Trách nhiệm | Task |
|---|---|---|
| `db/migrations/007_email_and_consent.sql`, `test/integration/migration-007.test.ts` | `site_settings` sớm, `notification_recipients`, `email_outbox`, cột đồng ý của `reservations` | 1 |
| `lib/email/events.ts` (+ test) | Tên sự kiện, trạng thái, nhãn tiếng Việt, `maskEmail`, `EVENT_STATUSES` (dùng cả hai phía) | 1 |
| `package.json`, `package-lock.json` | −`resend`; +`nodemailer`; dev +`smtp-server`, `@types/smtp-server` | 2 |
| `lib/server/email/{types,smtp,send}.ts` | Cổng `EMAIL_DELIVERY` trên SMTP: cấu hình lúc gửi, `resolveMode` (`live` chỉ ở Production), redirect không Reply-To, timeout, Message-ID, phân loại lỗi (không địa chỉ, không host SMTP), Reply-To | 2 |
| `lib/server/email/auth-emails.ts`, `templates/{password-reset,staff-invitation}.tsx`, `lib/server/auth/{lifetimes,config,staff}.ts` | Email nhân viên qua SMTP; `appOrigin()` chặn khi thiếu cấu hình; thời hạn từ hằng thật; tách gửi khỏi ghi sổ | 2 |
| `lib/admin/auth-errors.ts` (+ test) | Bản đồ lỗi email (2); `email_failed` + `emailFailureHint` (6); `not_resendable` (7) | 2, 6, 7 |
| `test/helpers/smtp-sink.ts`, `lib/server/email/{smtp,email}.test.ts`, `lib/server/email/mail-transport.guard.test.ts` (thay `resend-import.guard.test.ts`) | Máy SMTP giả trong tiến trình; test trên dây và đơn vị; guard import | 2 |
| `test/integration/staff-auth.test.ts` | Lời mời đã gửi vẫn là đã gửi khi ghi sổ hỏng | 2 |
| `README.md` | Biến SMTP, mục "Email (SMTP)": `live` chỉ ở Production, redirect, lỗi không host (2); bản đồ dữ liệu E2E của đợt 5, lần chạy BotID riêng, migration 007 (kiểm trước/sau), outbox, chống bot, route, runbook của chủ dự án (13) | 2, 13 |
| `lib/server/email/{env,recipients,outbox}.ts` | `outboxEnv`; `reachesSql` (3) + CRUD người nhận, hộp thư chung, `restaurantsWithoutRecipient` (6); ghi hàng outbox, `outboxEffects` (3; comment R13 ở 13) | 3, 6, 13 |
| `lib/server/booking/create.ts` | Sự kiện `created` trả id; hàng outbox trong transaction; `outboxIds` (3); `phoneDayFull` dưới khóa số điện thoại, cột đồng ý (9) | 3, 9 |
| `lib/admin/booking-schemas.ts` (+ test) | `Checkbox`; `notifyGuest` trên ba form | 3 |
| `app/admin/(shell)/reservations/actions.ts` | `outboxEffects` + `notifyGuest` (3); `drainAfterCommit` (4); `searchReservations` (12) | 3, 4, 12 |
| `app/admin/(shell)/reservations/[id]/TransitionPanel.tsx`, `_ui/AffectedList.tsx`, `reservations/new/NewReservationForm.tsx` | Ô "Báo khách"/"Gửi email xác nhận" và câu nhắc lý do (R8) | 3 |
| `test/integration/email-outbox.test.ts` | Nửa hàng đợi (3), nửa bộ gửi, lỗi lưu không có host SMTP (4), chủ đề thật (5); helper tick ô đồng ý, R13 hai lớp (9) | 3, 4, 5, 9 |
| `e2e/admin-reservations.spec.ts` | Ô email của R8 (3); tìm kiếm SEC-2 (12) | 3, 12 |
| `lib/server/email/{drain,after-commit}.ts`, `lib/server/cron.ts`, `app/api/cron/outbox/route.ts`, `vercel.json` | Bộ gửi ít nhất một lần; `after()`; cron mỗi 5 phút | 4 |
| `lib/server/email/booking/load.ts`, `lib/server/booking/rules.ts` | Đọc lại đặt bàn cho email (cả số của điểm đến, `groupPhoneSql`) | 4 |
| `lib/server/email/booking/render.ts` | Bộ render tối thiểu (4); template thật từ registry, ngôn ngữ R10, Reply-To R11 (5) | 4, 5 |
| `app/actions.ts` | `drainAfterCommit` sau COMMIT (4); bước 1 honeypot rồi BotID (9, 11) | 4, 9, 11 |
| `scripts/check-prerender.mjs` | `/api/cron/outbox` không prerender (4); `/en/privacy` prerender (8) | 4, 8 |
| `.github/workflows/ci.yml` | `CRON_SECRET` mỗi lần chạy | 4 |
| `test/integration/{cron-outbox,submit-reservation}.test.ts` | Route cron; collector `after()` (4); đồng ý, honeypot, BotID, giới hạn số điện thoại (9, 11) | 4, 9, 11 |
| `e2e/booking-email.spec.ts` | Email sau đặt bàn và xác nhận, cron 401/200 (4); chủ đề thật (5); tick ô đồng ý (9); bộ nghiệm thu A1–A4 (13) | 4, 5, 9, 13 |
| `lib/i18n/registry.ts` | `email.common.*`, `email.guest.*`, `email.staff.new.*` EN/VI (5); `legal.*`, `booking.privacy_notice`, `booking.consent`, `legal.link` (8); `error.*` mới (9) | 5, 8, 9 |
| `lib/server/content/strings.queries.ts` | `loadStringRows(locale, keys, db?)` cho bộ gửi | 5 |
| `lib/server/email/booking/format.ts`, `templates/{booking,layout}.tsx`, `lib/server/email/booking/render.test.ts` | Ngày giờ theo ngôn ngữ; template React Email; test render | 5 |
| `test/integration/email-screens.test.ts` | Render từ hàng (5); người nhận, hộp thư chung, email thử (6); nhật ký, "Gửi lại", Tổng quan (7) | 5, 6, 7 |
| `lib/server/email/{mode,test-email}.ts`, `lib/server/email/booking/sample.ts`, `lib/admin/notification-schemas.ts` (+ test) | Câu chế độ gửi (theo `resolveMode`); "Gửi email thử"; đặt bàn mẫu; zod của các màn email | 6, 7 |
| `app/admin/(shell)/settings/notifications/{page,actions,RecipientForm,SharedInboxForm,TestEmailForm}.tsx` | "Thông báo email" (chỉ Admin) | 6 |
| `lib/admin/{nav,audit-labels}.ts` (+ test), `lib/server/action-result.ts`, `lib/server/booking/config.ts` | Mục menu; nhãn thực thể audit; mã action mới; export `conflictBy`/`Conflict` | 6, 7 |
| `test/guards/require-permission.guard.test.ts` | Hàng quyền của 5 action thông báo và `ADMIN_ONLY_ACTIONS` (6); `resendEmail` (7); lời giải thích action công khai (9, 11); `searchReservations` (12) | 6, 7, 9, 11, 12 |
| `e2e/admin-emails.spec.ts` | 403 của Editor, người nhận, email thử (6); nhật ký, "Gửi lại", Tổng quan (7) | 6, 7 |
| `lib/server/email/outbox-log.ts` | Nhật ký keyset, email của một đặt bàn, `requeueEmail` + audit, `emailOverview` | 7 |
| `app/admin/(shell)/reservations/emails/{page,actions}.tsx`, `reservations/_ui/{ResendEmail,EmailStatusBadge,SectionNav}.tsx`, `reservations/[id]/page.tsx`, `app/admin/(shell)/page.tsx`, `styles/admin.css` | Nhật ký email, "Gửi lại", mục Email của đặt bàn, hai số ở Tổng quan, CSS | 7 |
| `lib/legal.ts` (+ test hash), `lib/server/content/legal.ts`, `app/(site)/[lang]/(guarded)/privacy/page.tsx`, `styles/legal.css`, `app/globals.css` | Phiên bản chính sách, các mục, trang `/[lang]/privacy` (tag `content:legal`) | 8 |
| `components/site/Footer.tsx`, `e2e/visual-added.css`, `e2e/visual{,-nojs}.spec.ts`, `scripts/check-prerender.mjs` | Link chân trang, ẩn trong spec visual; `/en/privacy` phải prerender với `content:legal` | 8 |
| `e2e/guest-guard.spec.ts` | Trang chính sách (8); đồng ý, honeypot, giới hạn theo số điện thoại (9); không `x-is-human` ngoài Vercel (11) | 8, 9, 11 |
| `lib/booking.ts` (+ test), `lib/booking/rules.ts`, `lib/booking-errors.ts` (+ test) | `GUEST_EMAIL` một `@` (R13); `PHONE_DAY_LIMIT`; ba mã lỗi và `DEFAULT_PARAMS.limit` | 9 |
| `lib/server/booking/{input,lock}.ts` (+ `input.test.ts`) | `consent`, `honeypot`, `honeypotFilled`, `consentVersion`; `lockGuestPhoneDay` và hàm khóa chung | 9 |
| `components/overlays/{Honeypot,ReserveDrawer}.tsx`, `components/site/SiteProvider.tsx`, `styles/overlays.css` | Ô honeypot, khối đồng ý, `errorParams` (9); đường lỗi: 404, một alert, `failureNudge`, focus sau Thử lại (10) | 9, 10 |
| `test/integration/{booking-config,reservation-lifecycle}.test.ts` | Helper dựng đặt bàn web tick ô đồng ý | 9 |
| `e2e/{booking-v2,booking-dates,booking-acceptance,admin-booking-settings}.spec.ts` | Tick ô đồng ý (9); đường lỗi của drawer và thanh đặt bàn (`booking-v2`, 10) | 9, 10 |
| `app/api/availability/route.ts`, `test/integration/availability.test.ts` | Câu trả lời rẻ 400/404 trước mọi truy vấn | 10 |
| `components/booking/BookingBar.tsx`, `styles/booking.css` | Thanh đặt bàn nói vì sao không có ngày/giờ | 10 |
| `package.json`, `package-lock.json` (Phần B), `next.config.ts`, `proxy.ts` (+ `lib/i18n/proxy-matcher.test.ts`) | `botid@1.5.11`; `withBotId`; matcher bỏ qua tiền tố BotID | 11 |
| `lib/botid.ts` (+ test), `instrumentation-client.ts`, `lib/server/guard/bot.ts` (+ test), `e2e/botid.spec.ts` | BotID hai nửa (server cho qua khi lỗi hoặc sau 3 s); spec chặn chạy riêng | 11 |
| `lib/server/booking/inbox-search.ts` (+ test), `app/admin/(shell)/reservations/{actions,page}.tsx`, `proxy.ts` (+ `proxy.test.ts`), `e2e/admin-reservations.spec.ts` | SEC-2: tìm bằng POST, cookie, `?tim=`; proxy bỏ `q` | 12 |
| `docs/superpowers/ledgers/…phase-5-ledger.md` (controller) | Việc hoãn mang sang đợt 6, 7, 8, 10 | 13 |

---

## PHẦN A: outbox, SMTP, template và các màn email

### Task 1: Migration 007 và tên các sự kiện email

Mọi thứ của đợt 5 đứng trên migration này, nên nó đến trước và đến một mình, cùng file tên sự kiện mà CHECK của migration phải khớp. Không code nào đọc các bảng mới ở task này; app chạy y như trước trên DB đã migrate.

**Files:**
- Create: `lib/email/events.ts`, `lib/email/events.test.ts`, `db/migrations/007_email_and_consent.sql`, `test/integration/migration-007.test.ts`

**Interfaces:**
- Consumes: `resetDatabase(url, until?)`, `migrate(url)`, `withClient(url, fn)`, `databaseUrl(name)`, `TEST_DATABASE_URL` từ `test/helpers/db.ts` (đợt 4: `TEST_DB_TAG` đổi `furama_cuisine_migrate007_test` thành `…_<tag>_test`); `RESERVATION_STATUSES`, `ReservationStatus` từ `lib/booking/rules.ts`.
- Produces:
  - Mọi bảng, cột, CHECK và index ở mục "Tên trong migration" của Global Constraints; seed `site_settings.email = 'fb@furamavietnam.com'`.
  - `lib/email/events.ts` (không `server-only`, client dùng được): `STAFF_EMAIL_EVENTS = ['staff.new']`, `GUEST_EMAIL_EVENTS = ['guest.ack','guest.confirmed','guest.declined','guest.cancelled']`, `EMAIL_EVENTS`; kiểu `EmailEvent`, `StaffEmailEventName`, `GuestEmailEventName`, `EmailAudience = 'staff' | 'guest'`; `isEmailEvent(v): v is EmailEvent`; `audienceOf(e): EmailAudience`; `EMAIL_EVENT_LABELS: Record<EmailEvent, string>`; `EMAIL_STATUSES = ['queued','sending','sent','skipped','failed']`, `EmailStatus`, `EMAIL_STATUS_LABELS`; `maskEmail(address): string`; `EVENT_STATUSES: Record<EmailEvent, readonly ReservationStatus[]>` (R7).

- [ ] **Bước 1: Viết test cho tên sự kiện**

Create `lib/email/events.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { RESERVATION_STATUSES } from '@/lib/booking/rules';
import {
  EMAIL_EVENTS,
  EMAIL_EVENT_LABELS,
  EMAIL_STATUSES,
  EMAIL_STATUS_LABELS,
  EVENT_STATUSES,
  GUEST_EMAIL_EVENTS,
  STAFF_EMAIL_EVENTS,
  audienceOf,
  isEmailEvent,
  maskEmail,
} from './events';

describe('booking email events (spec §10.4)', () => {
  it('one set of names: staff.new and the four guest emails', () => {
    expect(EMAIL_EVENTS).toEqual(['staff.new', 'guest.ack', 'guest.confirmed', 'guest.declined', 'guest.cancelled']);
    expect([...STAFF_EMAIL_EVENTS, ...GUEST_EMAIL_EVENTS]).toEqual([...EMAIL_EVENTS]);
    expect(EMAIL_EVENTS.map(audienceOf)).toEqual(['staff', 'guest', 'guest', 'guest', 'guest']);
    expect(isEmailEvent('guest.ack')).toBe(true);
    expect(isEmailEvent('staff.test')).toBe(false);
    expect(isEmailEvent(42)).toBe(false);
  });

  it('every event and status has a Vietnamese label', () => {
    expect(Object.keys(EMAIL_EVENT_LABELS)).toEqual([...EMAIL_EVENTS]);
    expect(EMAIL_STATUSES).toEqual(['queued', 'sending', 'sent', 'skipped', 'failed']);
    expect(Object.keys(EMAIL_STATUS_LABELS)).toEqual([...EMAIL_STATUSES]);
    expect(EMAIL_STATUS_LABELS.sending).toBe('Đang gửi');
  });

  it('sends an email only while the booking still says what it says (R7)', () => {
    expect(EVENT_STATUSES).toEqual({
      'staff.new': ['requested', 'confirmed', 'seated'],
      'guest.ack': ['requested'],
      // A walk-in never gets one (R8): seated is not a confirmation.
      'guest.confirmed': ['confirmed'],
      'guest.declined': ['declined'],
      'guest.cancelled': ['cancelled'],
    });
    for (const statuses of Object.values(EVENT_STATUSES)) {
      for (const s of statuses) expect(RESERVATION_STATUSES).toContain(s);
    }
  });

  it('masks a guest address down to its first letter and domain', () => {
    expect(maskEmail('lan.nguyen@gmail.com')).toBe('l•••@gmail.com');
    expect(maskEmail('a@b.vn')).toBe('a•••@b.vn');
    expect(maskEmail('odd@home@example.com')).toBe('o•••@example.com');
    expect(maskEmail('nobody')).toBe('•••');
    expect(maskEmail('@x.vn')).toBe('•••');
  });
});
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `npx vitest run lib/email/events.test.ts`
Expected: FAIL `Test Files  1 failed (1)`, `Tests  no tests`:

```
 FAIL  lib/email/events.test.ts [ lib/email/events.test.ts ]
Error: Cannot find module './events' imported from …/lib/email/events.test.ts
 ❯ lib/email/events.test.ts:3:1
```

- [ ] **Bước 3: Viết `lib/email/events.ts`**

`EVENT_STATUSES` là quy tắc bỏ qua của R7: `guest.confirmed` chỉ khi `confirmed` (khách vãng lai không bao giờ nhận, R8), khác spike templates (cho cả `seated`).

Create `lib/email/events.ts`:

```ts
import type { ReservationStatus } from '@/lib/booking/rules';

/*
 * The booking email events of spec §10.4: one set of names for
 * email_outbox.event, notification_recipients.events[] and the registry keys
 * email.<event>.<field>. No server-only import: the admin's client components
 * show the labels too. Migration 007's CHECKs list the same names and
 * statuses; test/integration/migration-007.test.ts holds the two together.
 */
export const STAFF_EMAIL_EVENTS = ['staff.new'] as const;
export const GUEST_EMAIL_EVENTS = ['guest.ack', 'guest.confirmed', 'guest.declined', 'guest.cancelled'] as const;
export const EMAIL_EVENTS = [...STAFF_EMAIL_EVENTS, ...GUEST_EMAIL_EVENTS] as const;

export type StaffEmailEventName = (typeof STAFF_EMAIL_EVENTS)[number];
export type GuestEmailEventName = (typeof GUEST_EMAIL_EVENTS)[number];
export type EmailEvent = (typeof EMAIL_EVENTS)[number];
export type EmailAudience = 'staff' | 'guest';

export function isEmailEvent(value: unknown): value is EmailEvent {
  return typeof value === 'string' && (EMAIL_EVENTS as readonly string[]).includes(value);
}

export const audienceOf = (event: EmailEvent): EmailAudience => (event.startsWith('staff.') ? 'staff' : 'guest');

/** Admin labels (Vietnamese, spec §7.3). */
export const EMAIL_EVENT_LABELS: Record<EmailEvent, string> = {
  'staff.new': 'Báo nhân viên: đặt bàn mới',
  'guest.ack': 'Khách: đã nhận yêu cầu',
  'guest.confirmed': 'Khách: đã xác nhận',
  'guest.declined': 'Khách: bị từ chối',
  'guest.cancelled': 'Khách: đã hủy',
};

/** email_outbox.status. 'sending' is a claimed row under its lease (lib/server/email/drain.ts). */
export const EMAIL_STATUSES = ['queued', 'sending', 'sent', 'skipped', 'failed'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const EMAIL_STATUS_LABELS: Record<EmailStatus, string> = {
  queued: 'Đang chờ gửi',
  sending: 'Đang gửi',
  sent: 'Đã gửi',
  skipped: 'Bỏ qua',
  failed: 'Lỗi',
};

/** "lan.nguyen@gmail.com" → "l•••@gmail.com": enough to tell two guests apart on a list, not to copy the address. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf('@');
  if (at <= 0) return '•••';
  return `${address[0]}•••${address.slice(at)}`;
}

/**
 * The booking statuses under which an event's email is still true when the
 * sender picks the row up (spec §10.4: "đọc lại đặt bàn … không còn khớp thì
 * đánh dấu skipped", R7). A request confirmed before its guest.ack went out
 * skips the ack; a confirmation still queued when staff cancel is never sent.
 * guest.confirmed is for confirmed bookings only: a walk-in is already at the
 * table (R8).
 */
export const EVENT_STATUSES: Record<EmailEvent, readonly ReservationStatus[]> = {
  'staff.new': ['requested', 'confirmed', 'seated'],
  'guest.ack': ['requested'],
  'guest.confirmed': ['confirmed'],
  'guest.declined': ['declined'],
  'guest.cancelled': ['cancelled'],
};
```

Run: `npx vitest run lib/email/events.test.ts`
Expected: PASS `Tests  4 passed (4)`

- [ ] **Bước 4: Viết test cho migration 007**

Phần đầu dựng một DB ở trạng thái 006 có một đặt bàn và sự kiện `created` của nó rồi migrate; phần sau kiểm từng ràng buộc theo tên, kể cả CHECK của sự kiện và trạng thái so với `lib/email/events.ts`, CHECK của 006 không đổi (R2), khóa sinh STORED, và bẫy NULL của CHECK đồng ý.

Create `test/integration/migration-007.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMAIL_EVENTS, EMAIL_STATUSES } from '@/lib/email/events';
import { TEST_DATABASE_URL, databaseUrl, migrate, resetDatabase, withClient } from '../helpers/db';

/*
 * Migration 007 (phase 5): the early site_settings row, notification_recipients,
 * email_outbox, and the consent columns of reservations. reservation_events
 * keeps 006's CHECK: email history lives in email_outbox (R2).
 */

const url = databaseUrl('furama_cuisine_migrate007_test');
const sql = (text: string, values: unknown[] = []) => withClient(url, (c) => c.query(text, values));
const one = async (text: string, values: unknown[] = []) => (await sql(text, values)).rows[0];
const checkDef = async (name: string) => (await one(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1`, [name]))?.def;

/** A phase-4 booking with its created event, as 006 leaves the tables. */
async function booking(): Promise<{ id: string; event: string }> {
  const r = await one(
    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, email, source)
     VALUES ('FC-' || upper(substr(md5(random()::text), 1, 8)), 'taya-house', '2026-10-06', '19:00', 'Dinner', 2, 'G', '0905 111 111',
             '+849051' || lpad((floor(random() * 1e5))::int::text, 5, '0'), 'g@example.com', 'web')
     RETURNING id::text`,
  );
  const e = await one(`INSERT INTO reservation_events (reservation_id, actor_kind, type, to_status) VALUES ($1, 'guest', 'created', 'requested') RETURNING id::text`, [r.id]);
  return { id: r.id, event: e.id };
}

const row = (over: Record<string, unknown>) => {
  const cols = Object.keys(over);
  return sql(`INSERT INTO email_outbox (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, Object.values(over));
};

describe.skipIf(!TEST_DATABASE_URL)('migration 007: email outbox, recipients, site settings, consent (database)', () => {
  describe('on a database at 006 that already has bookings', () => {
    let existing: { id: string; event: string };
    beforeAll(async () => {
      resetDatabase(url, '006_booking_v2.sql');
      existing = await booking();
      migrate(url);
    });

    it('adds the three tables, seeds the general email, and leaves the bookings and their events as they were', async () => {
      expect(await one(`SELECT count(*)::int AS r, (SELECT count(*)::int FROM reservation_events) AS e FROM reservations`)).toEqual({ r: 1, e: 1 });
      expect(await one(`SELECT count(*)::int AS o, (SELECT count(*)::int FROM notification_recipients) AS n FROM email_outbox`)).toEqual({ o: 0, n: 0 });
      expect((await sql(`SELECT id, email FROM site_settings`)).rows).toEqual([{ id: true, email: 'fb@furamavietnam.com' }]);
      // An older booking carries no consent: neither column, which the pair CHECK allows.
      expect(await one(`SELECT consent_version, consented_at FROM reservations`)).toEqual({ consent_version: null, consented_at: null });
    });

    it('keeps 006’s reservation_events type CHECK: email history lives in email_outbox', async () => {
      expect(await checkDef('reservation_events_type_check')).toBe(
        `CHECK ((type = ANY (ARRAY['created'::text, 'status_changed'::text, 'edited'::text, 'note_added'::text])))`,
      );
    });

    it('knows exactly the events and statuses of lib/email/events.ts', async () => {
      const list = (values: readonly string[]) => values.map((v) => `'${v}'::text`).join(', ');
      expect(await checkDef('email_outbox_event_check')).toBe(`CHECK ((event = ANY (ARRAY[${list(EMAIL_EVENTS)}])))`);
      expect(await checkDef('email_outbox_status_check')).toBe(`CHECK ((status = ANY (ARRAY[${list(EMAIL_STATUSES)}])))`);
    });

    it('derives the idempotency key from the id (STORED, UNIQUE), and starts a row queued with no attempts, due now', async () => {
      const { rows } = await row({
        env: 'production', event: 'guest.ack', audience: 'guest', reservation_id: existing.id, reservation_event_id: existing.event,
        to_email: 'g@example.com', locale: 'en',
      });
      expect(rows[0]).toMatchObject({ idempotency_key: `outbox:${rows[0].id}`, status: 'queued', attempts: 0, fallback: false, locked_until: null, sent_at: null, message_id: null });
      expect(Math.abs(Date.now() - rows[0].next_attempt_at.getTime())).toBeLessThan(60_000);
      await expect(sql(`UPDATE email_outbox SET idempotency_key = 'x'`)).rejects.toThrow(/can only be updated to DEFAULT/);
      expect(await one(`SELECT attgenerated FROM pg_attribute WHERE attrelid = 'email_outbox'::regclass AND attname = 'idempotency_key'`)).toEqual({ attgenerated: 's' });
      expect((await one(`SELECT indexdef FROM pg_indexes WHERE indexname = 'email_outbox_idempotency_key_key'`)).indexdef).toMatch(/UNIQUE INDEX/);
    });

    it('is safe to apply again', async () => {
      await sql(readFileSync('db/migrations/007_email_and_consent.sql', 'utf8'));
      expect(await one(`SELECT (SELECT count(*)::int FROM site_settings) AS s, (SELECT count(*)::int FROM email_outbox) AS o`)).toEqual({ s: 1, o: 1 });
      expect(await checkDef('reservations_consent_check')).toMatch(/consent_version IS NOT NULL/);
    });
  });

  describe('constraints', () => {
    let b: { id: string; event: string };
    const base = () => ({ env: 'development', event: 'staff.new', audience: 'staff', reservation_id: b.id, to_email: 'lan@furama.test', locale: 'vi' });
    beforeAll(async () => {
      resetDatabase(url);
      b = await booking();
    });

    it('knows the envs, the events, the statuses, and matches the audience to the event', async () => {
      await expect(row({ ...base(), env: 'staging' })).rejects.toThrow(/email_outbox_env_check/);
      await expect(row({ ...base(), event: 'guest.edited', audience: 'guest' })).rejects.toThrow(/email_outbox_event_check/);
      await expect(row({ ...base(), event: 'staff.test' })).rejects.toThrow(/email_outbox_event_check/);
      await expect(row({ ...base(), status: 'bounced' })).rejects.toThrow(/email_outbox_status_check/);
      await expect(row({ ...base(), audience: 'guest' })).rejects.toThrow(/email_outbox_audience_event/);
      await expect(row({ ...base(), event: 'guest.ack', audience: 'staff' })).rejects.toThrow(/email_outbox_audience_event/);
      await expect(row({ ...base(), locale: 'xx' })).rejects.toThrow(/email_outbox_locale_fkey/);
    });

    it('every row belongs to a booking; one @ in the address; at most 7 attempts; a sending row has a lease; sent and sent_at go together', async () => {
      await expect(row({ ...base(), reservation_id: null })).rejects.toThrow(/null value in column "reservation_id"/);
      await expect(row({ ...base(), to_email: 'not an address' })).rejects.toThrow(/email_outbox_to_email_check/);
      await expect(row({ ...base(), to_email: 'a@home@example.com' })).rejects.toThrow(/email_outbox_to_email_check/);
      await expect(row({ ...base(), to_email: `${'a'.repeat(250)}@x.vn` })).rejects.toThrow(/email_outbox_to_email_check/);
      await expect(row({ ...base(), attempts: 8 })).rejects.toThrow(/email_outbox_attempts_check/);
      await expect(row({ ...base(), status: 'sending' })).rejects.toThrow(/email_outbox_sending_leased/);
      await expect(row({ ...base(), status: 'sent' })).rejects.toThrow(/email_outbox_sent_at/);
      await expect(row({ ...base(), sent_at: new Date() })).rejects.toThrow(/email_outbox_sent_at/);
      await expect(row({ ...base(), last_error: 'x'.repeat(301) })).rejects.toThrow(/email_outbox_last_error_check/);
      // The phase-10 anonymiser's placeholder still passes.
      await row({ ...base(), to_email: 'anonymized@invalid' });
    });

    it('goes with its booking, and outlives its timeline event', async () => {
      const own = await booking();
      await row({ ...base(), reservation_id: own.id, reservation_event_id: own.event });
      await sql(`DELETE FROM reservation_events WHERE id = $1`, [own.event]);
      expect((await one(`SELECT reservation_event_id FROM email_outbox WHERE reservation_id = $1`, [own.id])).reservation_event_id).toBeNull();
      await sql(`DELETE FROM reservations WHERE id = $1`, [own.id]);
      expect((await one(`SELECT count(*)::int AS n FROM email_outbox WHERE reservation_id = $1`, [own.id])).n).toBe(0);
    });

    it('recipients: scope matches its target, staff events only, one row per address and target (any case)', async () => {
      const add = (over: Record<string, unknown>) => {
        const r = { scope: 'all', email: 'lan@furama.test', ...over };
        const cols = Object.keys(r);
        return sql(`INSERT INTO notification_recipients (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, Object.values(r));
      };
      const { rows } = await add({});
      expect(rows[0]).toMatchObject({ events: ['staff.new'], locale: 'vi', active: true });
      await expect(add({ email: 'LAN@Furama.test' })).rejects.toThrow(/notification_recipients_target_email_idx/);
      await add({ scope: 'restaurant', restaurant_id: 'taya-house' }); // the same address, another target
      await expect(add({ scope: 'restaurant' })).rejects.toThrow(/notification_recipients_scope_target/);
      await expect(add({ scope: 'all', destination_id: 'resort', email: 'x@furama.test' })).rejects.toThrow(/notification_recipients_scope_target/);
      await expect(add({ email: 'y@furama.test', events: ['guest.ack'] })).rejects.toThrow(/notification_recipients_events_check/);
      await expect(add({ email: 'z@furama.test', events: [] })).rejects.toThrow(/notification_recipients_events_check/);
      await expect(add({ email: 'two@at@furama.test' })).rejects.toThrow(/notification_recipients_email_check/);
      await expect(add({ scope: 'destination', destination_id: 'atlantis', email: 'w@furama.test' })).rejects.toThrow(/notification_recipients_destination_id_fkey/);
      // A restaurant that goes takes its recipients with it.
      await sql(`INSERT INTO notification_recipients (scope, restaurant_id, email) VALUES ('restaurant', 'the-fan', 'fan@furama.test')`);
      await sql(`DELETE FROM restaurants WHERE id = 'the-fan'`);
      expect((await one(`SELECT count(*)::int AS n FROM notification_recipients WHERE restaurant_id = 'the-fan'`)).n).toBe(0);
    });

    it('site_settings stays one row with a real address', async () => {
      await expect(sql(`INSERT INTO site_settings (id, email) VALUES (false, 'a@b.vn')`)).rejects.toThrow(/site_settings_single_row/);
      await expect(sql(`INSERT INTO site_settings (id, email) VALUES (true, 'a@b.vn')`)).rejects.toThrow(/site_settings_pkey/);
      await expect(sql(`UPDATE site_settings SET email = 'nobody'`)).rejects.toThrow(/site_settings_email_check/);
      await expect(sql(`UPDATE site_settings SET email = NULL`)).rejects.toThrow(/null value in column "email"/);
    });

    it('keeps the consent version and its time together (a NULL version cannot slip through)', async () => {
      const insert = (version: string | null, at: string | null) =>
        sql(
          `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source, consent_version, consented_at)
           VALUES ('FC-' || upper(substr(md5(random()::text), 1, 8)), 'taya-house', '2026-10-07', '19:00', 'Dinner', 2, 'G', 'x',
                   '+849052' || lpad((floor(random() * 1e5))::int::text, 5, '0'), 'web', $1, $2)`,
          [version, at],
        );
      await expect(insert('2026-10-02', null)).rejects.toThrow(/reservations_consent_check/);
      await expect(insert(null, '2026-10-02T00:00:00Z')).rejects.toThrow(/reservations_consent_check/);
      await expect(insert('', '2026-10-02T00:00:00Z')).rejects.toThrow(/reservations_consent_check/);
      await expect(insert('x'.repeat(41), '2026-10-02T00:00:00Z')).rejects.toThrow(/reservations_consent_check/);
      await insert('2026-10-02', '2026-10-02T00:00:00Z');
      await insert(null, null); // a staff-entered or older booking
    });

    it('has the drain index on due rows, the booking index and the log indexes', async () => {
      const { rows } = await sql(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'email_outbox' ORDER BY indexname`);
      const defs = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
      expect(Object.keys(defs)).toEqual([
        'email_outbox_due_idx',
        'email_outbox_failed_idx',
        'email_outbox_idempotency_key_key',
        'email_outbox_log_idx',
        'email_outbox_pkey',
        'email_outbox_reservation_idx',
      ]);
      expect(defs.email_outbox_due_idx).toMatch(/\(env, next_attempt_at, id\) WHERE \(status = ANY \(ARRAY\['queued'::text, 'sending'::text\]\)\)/);
      expect(defs.email_outbox_reservation_idx).toMatch(/\(reservation_id, id\)/);
      expect(defs.email_outbox_log_idx).toMatch(/\(created_at DESC, id DESC\)/);
      expect(defs.email_outbox_failed_idx).toMatch(/WHERE \(status = 'failed'::text\)/);
    });
  });
});
```

- [ ] **Bước 5: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/migration-007.test.ts`
Expected: FAIL `Tests  11 failed | 1 passed (12)` (test xanh là "keeps 006’s reservation_events type CHECK", đúng từ trước), trong đó:

```
       × adds the three tables, seeds the general email, and leaves the bookings and their events as they were 10ms
       × knows exactly the events and statuses of lib/email/events.ts 4ms
       × derives the idempotency key from the id (STORED, UNIQUE), and starts a row queued with no attempts, due now 3ms
       × is safe to apply again 0ms
       …
       × keeps the consent version and its time together (a NULL version cannot slip through) 3ms
       × has the drain index on due rows, the booking index and the log indexes 5ms
 FAIL  … > adds the three tables, seeds the general email, and leaves the bookings and their events as they were
error: relation "email_outbox" does not exist
 FAIL  … > knows exactly the events and statuses of lib/email/events.ts
AssertionError: expected undefined to be 'CHECK ((event = ANY (ARRAY[\'staff.ne…' // Object.is equality
 FAIL  … > is safe to apply again
Error: ENOENT: no such file or directory, open 'db/migrations/007_email_and_consent.sql'
 FAIL  … > keeps the consent version and its time together (a NULL version cannot slip through)
AssertionError: expected [Function] to throw error matching /reservations_consent_check/ but got 'column "consent_version" of relation …'
```

- [ ] **Bước 6: Viết migration 007**

Một file, một transaction, chỉ thêm (dàn ý C1: phần outbox của spike outbox-core cộng khối đồng ý của spike guard; bỏ `staff.test`, `created_by` và `email_outbox_test_only_unbooked` theo R9; `reservation_id` NOT NULL). Mọi lệnh có `IF NOT EXISTS`, `ON CONFLICT DO NOTHING` hoặc `DROP … IF EXISTS` trước khi tạo lại, nên chạy lại không đổi gì. Khóa sinh phải ghi `STORED`: Postgres 18 mặc định cột sinh là VIRTUAL, và cột VIRTUAL không mang được UNIQUE.

Create `db/migrations/007_email_and_consent.sql`:

```sql
-- Phase 5: booking email over SMTP (spec §5.2, §10.4) and the guest's privacy
-- consent (spec §11).
--
-- Expand only, one transaction, safe to re-run: three new tables, their
-- indexes, and two nullable columns on reservations. Nothing else in 001–006
-- changes. In particular reservation_events keeps 006's type CHECK: email
-- history lives in email_outbox (one row per recipient, with its status and
-- attempts), and the booking page reads it beside the timeline. A send is not
-- a change to the booking, so it stays out of reservation_events and out of
-- /admin/audit.

-- ── site_settings (early, phase 6 extends it) ─────────────────────────────
-- Spec §5.2 lists site_settings under phase 6; phase 5 needs one of its
-- columns now: the general email, where staff.new goes when no
-- notification_recipients row matches (§10.4), and where a guest's reply to a
-- booking email lands. One row, so the footer's general email (phase 6/7) and
-- the fallback are the same address. PHASE 6: add the other columns with
-- ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS …, never CREATE TABLE.
CREATE TABLE IF NOT EXISTS site_settings (
  id         boolean     PRIMARY KEY DEFAULT true CONSTRAINT site_settings_single_row CHECK (id),
  email      text        NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

-- CONTACT.email of lib/data.ts, the address the guest site already shows.
INSERT INTO site_settings (id, email) VALUES (true, 'fb@furamavietnam.com') ON CONFLICT DO NOTHING;

-- ── notification_recipients ───────────────────────────────────────────────
-- Who hears about new bookings. A booking reaches the union of the active rows
-- for its restaurant, its destination and 'all', deduplicated by address
-- (lib/server/email/recipients.ts holds the one predicate).
CREATE TABLE IF NOT EXISTS notification_recipients (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope          text        NOT NULL CHECK (scope IN ('all', 'destination', 'restaurant')),
  destination_id text        REFERENCES destinations (id) ON UPDATE CASCADE ON DELETE CASCADE,
  restaurant_id  text        REFERENCES restaurants (id) ON UPDATE CASCADE ON DELETE CASCADE,
  email          text        NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254),
  -- Staff events only; a later phase that adds one replaces this CHECK.
  events         text[]      NOT NULL DEFAULT ARRAY['staff.new']
                 CONSTRAINT notification_recipients_events_check
                 CHECK (cardinality(events) >= 1 AND events <@ ARRAY['staff.new']),
  locale         text        NOT NULL DEFAULT 'vi' REFERENCES locales (code) ON UPDATE CASCADE,
  active         boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text,
  CONSTRAINT notification_recipients_scope_target CHECK (
    (scope = 'all'         AND destination_id IS NULL     AND restaurant_id IS NULL) OR
    (scope = 'destination' AND destination_id IS NOT NULL AND restaurant_id IS NULL) OR
    (scope = 'restaurant'  AND restaurant_id IS NOT NULL  AND destination_id IS NULL)
  )
);

-- One row per address and target, whatever its case; the same address may sit on several targets.
CREATE UNIQUE INDEX IF NOT EXISTS notification_recipients_target_email_idx
  ON notification_recipients (scope, coalesce(destination_id, ''), coalesce(restaurant_id, ''), lower(email));

-- ── email_outbox ──────────────────────────────────────────────────────────
-- One row per email and recipient, written in the transaction of the booking
-- change that causes it (§10.4), drained after COMMIT by after(), by the cron
-- and by "Gửi lại". SMTP has no idempotency key, so delivery is at least
-- once: a row is claimed with a lease (status 'sending', locked_until) before
-- the send and marked sent right after; a crash in between re-sends it once
-- the lease ends, with the same Message-ID (message_id, fixed at the first
-- claim) so the copy is recognisable. "Gửi email thử" sends directly and
-- writes no row, so every row belongs to a booking.
CREATE TABLE IF NOT EXISTS email_outbox (
  id                   bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- VERCEL_ENV of the writer ('development' off Vercel). A sender drains only its own env's rows,
  -- so a Preview branch forked from production never sends production's queue.
  env                  text        NOT NULL CHECK (env IN ('production', 'preview', 'development')),
  -- lib/email/events.ts EMAIL_EVENTS.
  event                text        NOT NULL CHECK (event IN ('staff.new', 'guest.ack', 'guest.confirmed', 'guest.declined', 'guest.cancelled')),
  audience             text        NOT NULL CHECK (audience IN ('staff', 'guest')),
  reservation_id       bigint      NOT NULL REFERENCES reservations (id) ON DELETE CASCADE,
  -- The timeline event that queued it (created / status_changed).
  reservation_event_id bigint      REFERENCES reservation_events (id) ON DELETE SET NULL,
  -- One @ (the guest form is looser; the queue filters first). Phase 10's anonymiser
  -- overwrites it with a placeholder that still passes, e.g. 'anonymized@invalid'.
  to_email             text        NOT NULL CHECK (to_email ~ '^[^@\s]+@[^@\s]+$' AND length(to_email) <= 254),
  locale               text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE,
  -- staff.new sent to site_settings.email because no recipient matched.
  fallback             boolean     NOT NULL DEFAULT false,
  -- Spec §5.2's key. STORED: Postgres 18 makes a generated column VIRTUAL by default, which cannot be UNIQUE.
  idempotency_key      text        GENERATED ALWAYS AS ('outbox:' || id::text) STORED
                       CONSTRAINT email_outbox_idempotency_key_key UNIQUE,
  -- lib/email/events.ts EMAIL_STATUSES.
  status               text        NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued', 'sending', 'sent', 'skipped', 'failed')),
  -- Claims so far; a claim counts before the send, so a send that crashes the function still uses one up.
  attempts             smallint    NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 7),
  next_attempt_at      timestamptz NOT NULL DEFAULT now(),
  locked_until         timestamptz,
  -- "<code>: <message>", e-mail addresses removed, as describeEmailError writes it.
  last_error           text        CHECK (length(last_error) <= 300),
  -- The <…> Message-ID header, fixed at the first claim and reused by every later attempt.
  message_id           text        CHECK (length(message_id) <= 300),
  -- The SMTP server's reply to the message ("250 2.0.0 Ok: queued as …"), or the mode in log mode.
  provider_id          text        CHECK (length(provider_id) <= 300),
  sent_at              timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_outbox_audience_event CHECK ((audience = 'guest') = (event LIKE 'guest.%')),
  CONSTRAINT email_outbox_sending_leased CHECK (status <> 'sending' OR locked_until IS NOT NULL),
  CONSTRAINT email_outbox_sent_at CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);

-- The drain: due rows of one env, oldest first.
CREATE INDEX IF NOT EXISTS email_outbox_due_idx
  ON email_outbox (env, next_attempt_at, id) WHERE status IN ('queued', 'sending');
-- The booking page's email list.
CREATE INDEX IF NOT EXISTS email_outbox_reservation_idx ON email_outbox (reservation_id, id);
-- The email log (newest first) and the overview's failed count.
CREATE INDEX IF NOT EXISTS email_outbox_log_idx ON email_outbox (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS email_outbox_failed_idx ON email_outbox (created_at DESC, id DESC) WHERE status = 'failed';

-- ── reservations: the guest's consent (spec §11) ──────────────────────────
-- Which version of the privacy policy a web guest agreed to (lib/legal.ts)
-- and when. Every web booking from phase 5 on carries both; staff-entered
-- bookings and older rows carry neither, which is why no CHECK ties them to
-- source = 'web'. Neither column is personal data: the phase-10 anonymiser
-- keeps them. The second branch names consent_version IS NOT NULL itself: a
-- CHECK that evaluates to NULL passes, so length(NULL) alone would let a
-- version-less row with a time through.
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS consent_version text,
  ADD COLUMN IF NOT EXISTS consented_at    timestamptz;

ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_consent_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_consent_check
  CHECK ((consent_version IS NULL AND consented_at IS NULL)
      OR (consent_version IS NOT NULL AND consented_at IS NOT NULL AND length(consent_version) BETWEEN 1 AND 40));
```

- [ ] **Bước 7: Chạy lại test**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/email/events.test.ts test/integration/migration-007.test.ts`
Expected: PASS `Test Files  2 passed (2)`, `Tests  16 passed (16)`

- [ ] **Bước 8: Kiểm rằng test bắt được bẫy NULL của CHECK đồng ý**

Trong `db/migrations/007_email_and_consent.sql`, đổi vế thứ hai của `reservations_consent_check` thành dạng đầu tiên của spike guard, `OR (consented_at IS NOT NULL AND length(consent_version) BETWEEN 1 AND 40));` (bỏ `consent_version IS NOT NULL AND`), chạy lệnh `vitest run test/integration/migration-007.test.ts` ở Bước 5. Expected: `Tests  2 failed | 10 passed (12)`:

```
       × is safe to apply again 14ms
       × keeps the consent version and its time together (a NULL version cannot slip through) 17ms
AssertionError: expected 'CHECK ((((consent_version IS NULL) AN…' to match /consent_version IS NOT NULL/
AssertionError: promise resolved "Result{ command: 'INSERT', …(9) }" instead of rejecting
```

(`length(NULL)` là NULL, và một CHECK ra NULL thì qua.) Trả file về như Bước 6; `git diff` của file phải rỗng so với Bước 6.

- [ ] **Bước 9: Chạy cổng kiểm tra**

Chạy đủ khối lệnh ở "Cổng kiểm tra của mọi task" (Global Constraints).

Expected:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo;
- `Test Files  55 passed (55)`, `Tests  617 passed (617)`;
- `reset-db` in `Applied 7 migration(s).`;
- build thoát 0; check-prerender in `Prerender check passed …`, `Admin check passed …`, `Uncached check passed: /api/availability …`, `Font check passed …`;
- E2E `118 passed`; visual `8 passed`.

- [ ] **Bước 10: Commit**

```bash
git add db/migrations/007_email_and_consent.sql lib/email/events.test.ts lib/email/events.ts test/integration/migration-007.test.ts
git commit -m "$(cat <<'EOF'
feat: add migration 007 for the email outbox, notification recipients and consent

Migration 007 creates what phase 5's email needs (spec §5.2, §10.4): the
one-row site_settings table early, with only the general email (seeded
fb@furamavietnam.com; phase 6 adds its other columns with ADD COLUMN IF NOT
EXISTS), notification_recipients (scope restaurant, destination or all,
staff events only, one row per address and target in any case), and
email_outbox: one row per email and recipient, every row tied to a booking,
a STORED generated idempotency key outbox:<id>, the lease and attempt
columns of an at-least-once SMTP sender, and the indexes of the drain, the
booking page and the email log. reservations gains consent_version and
consented_at with a pair CHECK that a NULL version cannot slip through.
reservation_events keeps 006's CHECK: email history lives in email_outbox.

lib/email/events.ts names the five events, the statuses, their Vietnamese
labels and the booking statuses under which each email is still true; the
migration test holds the SQL CHECKs to the same lists.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: SMTP thay Resend cho mọi email, cùng các việc email hoãn của đợt 3

Chủ dự án chọn SMTP truyền thống (spec §10.4 đã sửa). Task này đổi transport dưới cổng `EMAIL_DELIVERY` cho hai email nhân viên của đợt 3 (mời, đặt lại mật khẩu); outbox của Task 3–4 dùng cùng cổng. Năm việc của sổ đợt 3 đi cùng: `appOrigin()` chặn khi thiếu cấu hình (R23), cast `as unknown as` của Resend đi theo Resend, thời hạn trong template lấy từ hằng thật, `deliverInvite` tách lời gửi khỏi việc ghi sổ, và (ở Task 5) đo react-email.

**Files:**
- Create: `lib/server/email/smtp.ts`, `lib/server/auth/lifetimes.ts`, `test/helpers/smtp-sink.ts`, `lib/server/email/smtp.test.ts`, `lib/server/email/mail-transport.guard.test.ts`
- Modify: `package.json`, `package-lock.json`, `lib/server/email/types.ts`, `lib/server/email/send.ts`, `lib/server/email/auth-emails.ts`, `lib/server/email/templates/password-reset.tsx`, `lib/server/email/templates/staff-invitation.tsx`, `lib/server/auth/staff.ts`, `lib/server/auth/config.ts`, `lib/admin/auth-errors.ts`, `lib/admin/auth-errors.test.ts`, `lib/server/email/email.test.ts`, `test/integration/staff-auth.test.ts`, `README.md`
- Delete: `lib/server/email/resend-import.guard.test.ts`

**Interfaces:**
- Consumes: `renderEmail`, `consoleLogSink`, `createEmailSender`, `sendEmail` của đợt 3 (`lib/server/email/send.ts`); `describeEmailError`, `emailErrorCode`, `EmailSendError` (`types.ts`); `INVITE_TTL` (`lib/server/auth/staff.ts`).
- Produces:
  - `types.ts`: `EmailErrorCode` = `'invalid_delivery_mode' | 'missing_smtp_config' | 'missing_from' | 'missing_redirect_to' | 'missing_app_url' | 'not_delivered' | 'rejected' | 'provider_error'`; `SendEmailInput` có thêm `messageId?: string`, `replyTo?: string`; `DeliveredEmail` có thêm `messageId?`, `replyTo?`; `SendEmailResult = { mode; id?: string /* câu trả lời SMTP, đã xóa địa chỉ */; messageId?: string }`; `TransportMessage`; `MailTransport = { sendMail(m): Promise<{ messageId; response }>; close(): void }`; `redactEmails(text)`; `describeEmailError` nay xóa địa chỉ.
  - `smtp.ts`: `SmtpConfig`, `smtpConfigFromEnv(env)` (ném `missing_smtp_config`), `SMTP_TIMEOUTS`, `smtpTransportOptions(config)`, `createSmtpTransport(options): MailTransport`.
  - `send.ts`: `EmailDeps = { env; createTransport; logSink; sendTimeoutMs; transportOverrides? }`, `SEND_TIMEOUT_MS = 30_000`, `resolveMode(raw, vercelEnv): EmailDeliveryMode` (ném `invalid_delivery_mode` khi sai chính tả, và khi `live` mà `VERCEL_ENV` là `preview`/`development`; Task 6 dùng), `senderDomain(from): string | null`, `messageIdFor(key, domain)`, `Mailer = { send(input): Promise<SendEmailResult>; close(): void }`, `openMailer(overrides?): Mailer` (bộ gửi cho một lô, Task 4 dùng), `createEmailSender(overrides?)`, `sendEmail`.
  - `auth-emails.ts`: `appOrigin(env = process.env)` ném `EmailSendError('missing_app_url')` khi thiếu `BETTER_AUTH_URL` ngoài chế độ log hoặc trên Vercel (R23).
  - `lifetimes.ts`: `INVITE_TTL_DAYS = 7`, `RESET_TOKEN_SECONDS = 3600`; `staff.ts` `INVITE_TTL` (chuỗi `${INVITE_TTL_DAYS} days`).
  - `test/helpers/smtp-sink.ts`: `startSmtpSink(options?: SinkOptions): Promise<SmtpSink>` (`secure`, `noStartTls`, `login`, `refuseRecipient`, `failData`, `holdDataMs`; `received`, `seen`, `attempts`, `clientOverrides`, `env(extra?)`, `close()`; mỗi thư có `from`, `to`, `raw`, `messageId`, `subject` (đã giải mã RFC 2047), `replyTo`, `secure`, `user`), `startSilentServer()`.

- [ ] **Bước 1: Đổi gói**

Cài đúng bản đã kiểm, từ cache npm của máy (`--offline`); chỉ khi một lệnh báo `ENOTCACHED` mới chạy lại đúng lệnh đó không có `--offline` (registry npm là lần ra mạng duy nhất được phép, Global Constraints):

```bash
npm uninstall --offline resend
npm install --offline nodemailer@10.0.13
npm install --offline -D smtp-server@3.19.16 @types/smtp-server@3.5.13
npm audit
```

Expected: `npm audit` in `found 0 vulnerabilities`; `npm ls nodemailer smtp-server @types/smtp-server` cho `nodemailer@10.0.13`, `smtp-server@3.19.16` (với `nodemailer@10.0.13 deduped`) và `@types/smtp-server@3.5.13`; `package-lock.json` trùng từng byte với lock của commit Task 2 (đã kiểm trên commit của Task 1). Không cài `@types/nodemailer`: nodemailer 10 có file `.d.ts` cạnh JS của nó (map `exports` không có điều kiện `types`, TypeScript lấy file kề bên); `@types/smtp-server` kéo `@types/nodemailer@8.0.2` theo như một gói kiểu, và typecheck vẫn xanh. npm vẫn ghi khoảng `^` vào `package.json`, nên nó đổi đúng như diff sau:

```diff
diff --git a/package.json b/package.json
index 3865f09..59b8250 100644
--- a/package.json
+++ b/package.json
@@ -20,11 +20,11 @@
     "better-auth": "^1.7.7",
     "libphonenumber-js": "^1.13.14",
     "next": "^16.3.7",
+    "nodemailer": "^10.0.13",
     "pg": "^8.23.0",
     "react": "^19.3.0",
     "react-dom": "^19.3.0",
     "react-email": "^6.11.0",
-    "resend": "^6.31.0",
     "zod": "^4.6.5"
   },
   "devDependencies": {
@@ -33,11 +33,13 @@
     "@types/pg": "^8.23.1",
     "@types/react": "^19.3.0",
     "@types/react-dom": "^19.3.0",
+    "@types/smtp-server": "^3.5.13",
     "auth": "^1.7.7",
     "dotenv-cli": "^11.0.0",
     "jiti": "^2.7.0",
     "oxc-parser": "^0.152.0",
     "oxlint": "^1.86.0",
+    "smtp-server": "^3.19.16",
     "typescript": "^7.0.2",
     "vitest": "^5.0.3"
   }
```

- [ ] **Bước 2: Viết máy SMTP giả cho test**

Test chạm SMTP chỉ qua đây: một `smtp-server` trong tiến trình, `127.0.0.1`, cổng do hệ điều hành chọn (không bao giờ khoảng 32xx của agent), chứng chỉ localhost có sẵn của `smtp-server`, `logger: false`. `clientOverrides` (bỏ kiểm chứng chỉ tự ký) chỉ tới transport qua `EmailDeps.transportOverrides`, không bao giờ qua env.

Create `test/helpers/smtp-sink.ts`:

```ts
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { SMTPServer, type SMTPServerOptions } from 'smtp-server';

/*
 * A local, in-process SMTP server for tests: never a real one. It listens on
 * 127.0.0.1 on a port the OS picks, speaks STARTTLS (587-style) or TLS from
 * the first byte (465-style) with smtp-server's built-in localhost
 * certificate, can require a login, refuse a recipient, fail or stall a
 * message, and records what it accepted, raw, as the wire carried it.
 */

export type ReceivedMail = {
  from: string;
  to: string[];
  raw: string;
  /** The Message-ID header as sent. */
  messageId: string | null;
  subject: string | null;
  replyTo: string | null;
  /** Whether the session was encrypted when the message arrived. */
  secure: boolean;
  user: string | null;
};

export type SinkOptions = {
  /** TLS from the first byte (port 465 style); otherwise plain + STARTTLS. */
  secure?: boolean;
  /** Do not offer STARTTLS (to prove requireTLS refuses to go on in clear). */
  noStartTls?: boolean;
  /** Require this login. */
  login?: { user: string; pass: string };
  /** Answer RCPT TO for this address with this SMTP code (e.g. 550, 451). */
  refuseRecipient?: (address: string) => number | null;
  /** Fail the message after DATA with this code; called per message, so it can fail only some. */
  failData?: (index: number) => number | null;
  /** Hold the reply to DATA this long (a slow server). */
  holdDataMs?: number;
};

export type SmtpSink = {
  port: number;
  /** Messages the sink accepted (250 after DATA). */
  received: ReceivedMail[];
  /** Every message whose DATA arrived, accepted or refused. */
  seen: ReceivedMail[];
  /** seen.length */
  attempts: number;
  /** Transport options for the client side: this sink's self-signed certificate, short timeouts. */
  clientOverrides: { tls: { rejectUnauthorized: false; minVersion: 'TLSv1.2' } };
  /** The env a test hands the mailer to send here. */
  env(extra?: Record<string, string>): Record<string, string>;
  close(): Promise<void>;
};

/** RFC 2047 encoded words (=?UTF-8?Q?…?= / =?UTF-8?B?…?=), as nodemailer writes a non-ASCII subject. */
function decodeWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?UTF-8\?([QB])\?([^?]*)\?=/gi, (_, enc: string, text: string) =>
      enc.toUpperCase() === 'B'
        ? Buffer.from(text, 'base64').toString('utf8')
        : Buffer.from(text.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8'),
    );
}

const header = (raw: string, name: string): string | null => {
  const head = raw.split(/\r?\n\r?\n/)[0];
  const match = head.match(new RegExp(`^${name}:[ \\t]*(.*(?:\\r?\\n[ \\t].*)*)`, 'im'));
  return match ? decodeWords(match[1].replace(/\r?\n[ \t]+/g, ' ').trim()) : null;
};

const smtpError = (code: number, message: string) => Object.assign(new Error(message), { responseCode: code });

export async function startSmtpSink(options: SinkOptions = {}): Promise<SmtpSink> {
  const received: ReceivedMail[] = [];
  const seen: ReceivedMail[] = [];
  const config: SMTPServerOptions = {
    secure: options.secure ?? false,
    logger: false,
    disabledCommands: options.noStartTls ? ['STARTTLS'] : [],
    authOptional: !options.login,
    // Only after STARTTLS (or on 465): the client must never log in in clear.
    allowInsecureAuth: false,
    onAuth(auth, _session, callback) {
      if (options.login && auth.username === options.login.user && auth.password === options.login.pass) {
        return callback(null, { user: auth.username });
      }
      return callback(smtpError(535, 'Authentication failed'));
    },
    onRcptTo(address, _session, callback) {
      const code = options.refuseRecipient?.(address.address) ?? null;
      if (code) return callback(smtpError(code, code >= 500 ? `${address.address}: Recipient address rejected` : 'Try again later'));
      return callback();
    },
    onData(stream, session, callback) {
      const index = seen.length;
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const mail: ReceivedMail = {
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
          to: session.envelope.rcptTo.map((r) => r.address),
          raw,
          messageId: header(raw, 'Message-ID'),
          subject: header(raw, 'Subject'),
          replyTo: header(raw, 'Reply-To'),
          secure: session.secure,
          user: typeof session.user === 'string' ? session.user : null,
        };
        seen.push(mail);
        const finish = () => {
          const code = options.failData?.(index) ?? null;
          if (code) return callback(smtpError(code, code >= 500 ? 'Message rejected' : 'Temporary failure, try again'));
          received.push(mail);
          return callback(null, `Ok: queued as SINK${index}`);
        };
        if (options.holdDataMs) setTimeout(finish, options.holdDataMs);
        else finish();
      });
    },
  };
  const server = new SMTPServer(config);
  await new Promise<void>((resolve, reject) => {
    server.server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.server.address() as AddressInfo).port;

  return {
    port,
    received,
    seen,
    get attempts() {
      return seen.length;
    },
    clientOverrides: { tls: { rejectUnauthorized: false, minVersion: 'TLSv1.2' } },
    env: (extra = {}) => ({
      EMAIL_DELIVERY: 'live',
      EMAIL_FROM: 'Furama Cuisine <no-reply@mail.furama.test>',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(port),
      SMTP_SECURE: options.secure ? 'true' : 'false',
      ...(options.login ? { SMTP_USER: options.login.user, SMTP_PASSWORD: options.login.pass } : {}),
      ...extra,
    }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A TCP server that accepts connections and never says a word: no SMTP greeting, ever. */
export async function startSilentServer(): Promise<{ port: number; close(): Promise<void> }> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
```

- [ ] **Bước 3: Viết test trên dây (máy SMTP giả)**

Create `lib/server/email/smtp.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { startSilentServer, startSmtpSink, type SmtpSink } from '@/test/helpers/smtp-sink';
import { sendStaffInvitation } from './auth-emails';
import { createEmailSender, openMailer, type EmailDeps } from './send';
import { describeEmailError } from './types';

/*
 * The real nodemailer transport against a local in-process SMTP server
 * (test/helpers/smtp-sink.ts): what goes over the wire, TLS, login, refusals
 * and slow or silent servers. No database, no real mail server.
 */

const content = { html: '<p>hi</p>', text: 'hi' };
let sinks: { close(): Promise<void> }[] = [];
const track = <T extends { close(): Promise<void> }>(s: T) => (sinks.push(s), s);
afterEach(async () => {
  await Promise.all(sinks.map((s) => s.close()));
  sinks = [];
});

const senderFor = (sink: SmtpSink, deps: Partial<EmailDeps> = {}, env: Record<string, string> = {}) =>
  createEmailSender({ env: sink.env(env), transportOverrides: sink.clientOverrides, ...deps });

describe('SMTP on the wire (local sink)', () => {
  it('587 style: upgrades with STARTTLS, logs in, and carries the Message-ID made from the key', async () => {
    const sink = track(await startSmtpSink({ login: { user: 'mailer', pass: 's3cret pass' } }));
    const sent = await sendStaffInvitation(
      { to: 'new.staff@furama.test', token: 'tok', invitationId: '41', role: 'editor', inviterName: 'Lan' },
      senderFor(sink),
    );
    expect(sent).toMatchObject({ mode: 'live', id: '250 Ok: queued as SINK0' });
    expect(sink.received).toHaveLength(1);
    const mail = sink.received[0];
    expect(mail).toMatchObject({ from: 'no-reply@mail.furama.test', to: ['new.staff@furama.test'], secure: true, user: 'mailer' });
    expect(mail.messageId).toMatch(/^<invite-41-[0-9a-f]{16}@mail\.furama\.test>$/);
    expect(sent.messageId).toBe(mail.messageId);
    expect(mail.raw).toMatch(/^From: Furama Cuisine <no-reply@mail\.furama\.test>$/m);
    // The token is only in the body's link, never in a header.
    expect(mail.raw.split(/\r?\n\r?\n/)[0]).not.toContain('tok');
  });

  it('carries a Vietnamese subject, html and text as alternatives, and the Reply-To it was given', async () => {
    const sink = track(await startSmtpSink());
    await senderFor(sink)({
      to: 'khach@guest.vn',
      subject: 'Đặt bàn của bạn đã được xác nhận (FC-7K3QH9XA)',
      html: '<p>Xin chào Nguyễn Thị Ánh</p>',
      text: 'Xin chào Nguyễn Thị Ánh',
      replyTo: 'fb@furama.test',
      idempotencyKey: 'outbox:42',
    });
    const mail = sink.received[0];
    expect(mail.subject).toBe('Đặt bàn của bạn đã được xác nhận (FC-7K3QH9XA)');
    expect(mail.replyTo).toBe('fb@furama.test');
    expect(mail.messageId).toBe('<outbox-42@mail.furama.test>');
    expect(mail.raw).toMatch(/^Content-Type: multipart\/alternative;/m);
    expect(mail.raw).toMatch(/^Content-Type: text\/plain; charset=utf-8$/m);
    expect(mail.raw).toMatch(/^Content-Type: text\/html; charset=utf-8$/m);
  });

  it('465 style: TLS from the first byte', async () => {
    const sink = track(await startSmtpSink({ secure: true }));
    await senderFor(sink)({ to: 'a@furama.test', subject: 'S', ...content, idempotencyKey: 'outbox:9' });
    expect(sink.received[0]).toMatchObject({ secure: true, messageId: '<outbox-9@mail.furama.test>' });
  });

  it('redirect: the team inbox gets it, the real address only in the subject, and no Reply-To', async () => {
    const sink = track(await startSmtpSink());
    await senderFor(sink, {}, { EMAIL_DELIVERY: 'redirect', EMAIL_REDIRECT_TO: 'qa@furama.test' })({
      to: 'gm@furama.test',
      subject: 'Booking',
      ...content,
      replyTo: 'guest@example.com',
    });
    expect(sink.received[0].to).toEqual(['qa@furama.test']);
    expect(sink.received[0].subject).toBe('[gm@furama.test] Booking');
    // staff.new replies to the guest (R11); from the redirect inbox, a reply must not reach a guest of the forked data.
    expect(sink.received[0].replyTo).toBeNull();
  });

  it('refuses to go on in clear when the server offers no STARTTLS: nothing is sent, no password crosses', async () => {
    const sink = track(await startSmtpSink({ noStartTls: true, login: { user: 'mailer', pass: 'pw' } }));
    const err = await senderFor(sink)({ to: 'a@furama.test', subject: 'S', ...content }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'provider_error' });
    expect(describeEmailError(err)).toMatch(/^provider_error: SMTP ETLS/);
    expect(sink.attempts).toBe(0);
  });

  it('a wrong password is a provider_error (retried: someone may fix the env)', async () => {
    const sink = track(await startSmtpSink({ login: { user: 'mailer', pass: 'right' } }));
    const err = await senderFor(sink, {}, { SMTP_PASSWORD: 'wrong' })({ to: 'a@furama.test', subject: 'S', ...content }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'provider_error' });
    expect(describeEmailError(err)).toMatch(/^provider_error: SMTP EAUTH at AUTH PLAIN: Invalid login: 535/);
    expect(describeEmailError(err)).not.toContain('wrong');
  });

  it('a recipient refused with 550 is rejected for good; 451 is a provider_error; the address never reaches the error', async () => {
    const sink = track(await startSmtpSink({ refuseRecipient: (a) => (a.startsWith('gone') ? 550 : a.startsWith('busy') ? 451 : null) }));
    const gone = await senderFor(sink)({ to: 'gone@guest.vn', subject: 'S', ...content }).catch((e: unknown) => e);
    expect(gone).toMatchObject({ code: 'rejected' });
    expect(describeEmailError(gone)).not.toContain('gone@guest.vn');
    const busy = await senderFor(sink)({ to: 'busy@guest.vn', subject: 'S', ...content }).catch((e: unknown) => e);
    expect(busy).toMatchObject({ code: 'provider_error' });
    expect(sink.received).toEqual([]);
  });

  it('a server that never greets: the greeting timeout ends the send, not the function limit', async () => {
    const silent = track(await startSilentServer());
    const send = createEmailSender({
      env: { EMAIL_DELIVERY: 'live', EMAIL_FROM: 'no-reply@mail.furama.test', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(silent.port) },
      transportOverrides: { greetingTimeout: 300 },
    });
    const started = Date.now();
    const err = await send({ to: 'a@furama.test', subject: 'S', ...content }).catch((e: unknown) => e);
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(describeEmailError(err)).toMatch(/^provider_error: SMTP ETIMEDOUT at CONN: Greeting never received/);
  });

  it('a server slow to answer DATA: the send gives up at its cap, yet the server may still deliver (why delivery is at least once)', async () => {
    const sink = track(await startSmtpSink({ holdDataMs: 800 }));
    const err = await senderFor(sink, { sendTimeoutMs: 200 })({ to: 'a@furama.test', subject: 'S', ...content, idempotencyKey: 'outbox:5' }).catch(
      (e: unknown) => e,
    );
    expect(describeEmailError(err)).toBe('provider_error: SMTP ETIMEDOUT: no answer within 200 ms');
    // The client stopped waiting, but the message had already crossed: the server accepts it afterwards.
    await new Promise((r) => setTimeout(r, 1_000));
    expect(sink.received.map((m) => m.messageId)).toEqual(['<outbox-5@mail.furama.test>']);
  });

  it('one mailer sends a batch, each message on its own connection, and closes once', async () => {
    const sink = track(await startSmtpSink());
    const mailer = openMailer({ env: sink.env(), transportOverrides: sink.clientOverrides });
    try {
      for (const id of [1, 2, 3]) await mailer.send({ to: `s${id}@furama.test`, subject: `S${id}`, ...content, idempotencyKey: `outbox:${id}` });
    } finally {
      mailer.close();
    }
    expect(sink.received.map((m) => m.messageId)).toEqual(['<outbox-1@mail.furama.test>', '<outbox-2@mail.furama.test>', '<outbox-3@mail.furama.test>']);
  });
});
```

- [ ] **Bước 4: Viết lại test đơn vị của cổng email**

Transport giả (không mạng) thay client Resend giả. Giữ các test template, chế độ log và bộ ghi log của đợt 3; thêm cấu hình SMTP đọc lúc gửi, `missing_from`, `live` bị từ chối trên Preview và dưới `vercel dev` (không mở kết nối SMTP), redirect bỏ Reply-To, phân loại `RCPT TO` 5xx với lỗi khác, lỗi lưu không mang host hay địa chỉ IP của máy SMTP, trần 30 s, `senderDomain`/`messageIdFor`, xóa địa chỉ, Reply-To, `appOrigin` chặn khi thiếu cấu hình, và thời hạn trong email lấy từ hằng thật.

Replace the whole of `lib/server/email/email.test.ts` with:

```ts
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INVITE_TTL } from '@/lib/server/auth/staff';
import { INVITE_TTL_DAYS, RESET_TOKEN_SECONDS } from '@/lib/server/auth/lifetimes';
import { appOrigin, invitationUrl, passwordResetUrl, sendPasswordReset, sendStaffInvitation } from './auth-emails';
import { consoleLogSink, createEmailSender, messageIdFor, renderEmail, sendEmail, senderDomain } from './send';
import { PasswordResetEmail } from './templates/password-reset';
import { StaffInvitationEmail } from './templates/staff-invitation';
import { EmailSendError, describeEmailError, emailErrorCode, redactEmails, type DeliveredEmail, type MailTransport } from './types';

const URL_INVITE = 'https://admin.example.vn/admin/accept-invite?token=abc_DEF-123';
const sha16 = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** A transport that records what it was handed; no network. */
function fakeTransport(result: { messageId: string; response: string } | Error = { messageId: '<m@x>', response: '250 2.0.0 Ok: queued as AB12' }) {
  const sendMail = vi.fn<MailTransport['sendMail']>(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const close = vi.fn();
  return { sendMail, close, transport: { sendMail, close } satisfies MailTransport };
}

const SMTP_ENV = { SMTP_HOST: 'smtp.furama.test', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASSWORD: 'p w' };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('templates', () => {
  it('invitation html + text carry the link, role, inviter and 7-day expiry in Vietnamese', async () => {
    const el = createElement(StaffInvitationEmail, { acceptUrl: URL_INVITE, role: 'editor', inviterName: 'Nguyễn Văn An', expiresInDays: 7 });
    const { html, text } = await renderEmail(el);
    for (const out of [html, text]) {
      expect(out).toContain(URL_INVITE);
      expect(out).toContain('Biên tập viên');
      expect(out).toContain('Nguyễn Văn An');
      expect(out).toContain('7 ngày');
    }
    expect(html).toContain('lang="vi"');
    expect(text).toContain('Chấp nhận lời mời');
    expect(text).not.toContain('<');
  });

  it('reset html + text carry the link and keep the heading as written', async () => {
    const el = createElement(PasswordResetEmail, { resetUrl: 'https://x.vn/admin/reset-password?token=t1', userName: 'Lan', expiresInMinutes: 60 });
    const { html, text } = await renderEmail(el);
    for (const out of [html, text]) {
      expect(out).toContain('https://x.vn/admin/reset-password?token=t1');
      expect(out).toContain('Đặt lại mật khẩu');
      expect(out).toContain('60 phút');
    }
    expect(text).toContain('Xin chào Lan');
  });

  it('builds app links from BETTER_AUTH_URL and url-encodes tokens', () => {
    expect(invitationUrl('a b', 'http://h:3200')).toBe('http://h:3200/admin/accept-invite?token=a%20b');
    expect(passwordResetUrl('tok', 'http://h:3200')).toBe('http://h:3200/admin/reset-password?token=tok');
  });

  it('states the lifetimes the server enforces, not numbers of its own', async () => {
    const logged: DeliveredEmail[] = [];
    const send = createEmailSender({ env: {}, logSink: (e) => void logged.push(e) });
    await sendStaffInvitation({ to: 'n@f.vn', token: 'tok', invitationId: 'i1', role: 'editor', inviterName: 'An' }, send);
    await sendPasswordReset({ user: { email: 'u@f.vn', name: 'Lan' }, token: 'tok123' }, send);
    expect(logged[0].text).toContain(`Liên kết có hiệu lực trong ${INVITE_TTL_DAYS} ngày`);
    expect(logged[1].text).toContain(`Liên kết có hiệu lực trong ${RESET_TOKEN_SECONDS / 60} phút`);
    // staff_invitation.expires_at is now() + INVITE_TTL; Better Auth's resetPasswordTokenExpiresIn is RESET_TOKEN_SECONDS.
    expect(INVITE_TTL).toBe(`${INVITE_TTL_DAYS} days`);
  });
});

describe('appOrigin: where emailed links point (R23)', () => {
  it('is BETTER_AUTH_URL without its trailing slash', () => {
    expect(appOrigin({ BETTER_AUTH_URL: 'https://cuisine.furamavietnam.com/' })).toBe('https://cuisine.furamavietnam.com');
  });

  it('falls back to localhost only in log mode off Vercel (dev, tests)', () => {
    expect(appOrigin({})).toBe('http://localhost:3000');
    expect(appOrigin({ EMAIL_DELIVERY: 'log', VERCEL_ENV: 'development' })).toBe('http://localhost:3000');
  });

  it('fails closed when an email could reach someone, or on a Vercel deployment', () => {
    for (const env of [{ EMAIL_DELIVERY: 'live' }, { EMAIL_DELIVERY: 'redirect' }, { VERCEL_ENV: 'production' }, { VERCEL_ENV: 'preview', EMAIL_DELIVERY: 'log' }]) {
      const err = (() => {
        try {
          return appOrigin(env);
        } catch (e) {
          return e;
        }
      })();
      expect(err).toBeInstanceOf(EmailSendError);
      expect(err).toMatchObject({ code: 'missing_app_url' });
    }
  });
});

describe('delivery modes', () => {
  const content = { html: '<p>hi</p>', text: 'hi' };

  it('defaults to log when EMAIL_DELIVERY is unset and never opens an SMTP connection', async () => {
    const sink: DeliveredEmail[] = [];
    const createTransport = vi.fn();
    const send = createEmailSender({ env: {}, createTransport, logSink: (e) => void sink.push(e) });
    const r = await send({ to: 'a@b.vn', subject: 'S', ...content, idempotencyKey: 'k' });
    expect(r).toEqual({ mode: 'log' });
    expect(createTransport).not.toHaveBeenCalled();
    expect(sink).toHaveLength(1);
    expect(sink[0]).toMatchObject({ to: 'a@b.vn', originalTo: 'a@b.vn', subject: 'S', text: 'hi', idempotencyKey: 'k' });
  });

  it('renders the invitation for the sink, keyed by the invitation and a hash of the token', async () => {
    const sink: DeliveredEmail[] = [];
    const send = createEmailSender({ env: {}, logSink: (e) => void sink.push(e) });
    await sendStaffInvitation({ to: 'n@f.vn', token: 'tok', invitationId: 'i1', role: 'admin', inviterName: 'An' }, send);
    expect(sink[0].text).toContain('/admin/accept-invite?token=tok');
    expect(sink[0].html).toContain('Quản trị viên');
    expect(sink[0].idempotencyKey).toBe(`invite:i1:${sha16('tok')}`);
    expect(sink[0].idempotencyKey).not.toContain('tok:');
  });

  it('log mode on a Production or Preview deployment fails with not_delivered after logging only the redacted line', async () => {
    for (const vercelEnv of ['production', 'preview']) {
      // The default sender: process.env and the real console sink, as on Vercel with EMAIL_DELIVERY unset.
      const dir = mkdtempSync(join(tmpdir(), 'email-log-'));
      vi.stubEnv('VERCEL_ENV', vercelEnv);
      vi.stubEnv('EMAIL_DELIVERY', '');
      vi.stubEnv('EMAIL_LOG_FILE', join(dir, 'emails.ndjson'));
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      const err = await sendEmail({ to: 'lan@furama.test', subject: 'S', html: '<p>x</p>', text: 'token=SECRET', idempotencyKey: 'invite:1:abcd' }).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(EmailSendError);
      expect(err).toMatchObject({ code: 'not_delivered' });
      expect(describeEmailError(err)).toMatch(new RegExp(`^not_delivered: EMAIL_DELIVERY is log \\(or unset\\) on a Vercel ${vercelEnv} deployment`));
      expect(describeEmailError(err)).not.toContain('SECRET');
      expect(info.mock.calls).toEqual([['[email:log] to=*@furama.test key=invite:1:abcd']]);
      expect(() => readFileSync(join(dir, 'emails.ndjson'))).toThrow(/ENOENT/);
      info.mockRestore();
    }
  });

  it('log mode reads VERCEL_ENV from its env: an injected sink still receives the email first', async () => {
    const sink: DeliveredEmail[] = [];
    const send = createEmailSender({ env: { EMAIL_DELIVERY: 'log', VERCEL_ENV: 'preview' }, logSink: (e) => void sink.push(e) });
    await expect(send({ to: 'a@b.vn', subject: 'S', ...content })).rejects.toMatchObject({ code: 'not_delivered' });
    expect(sink).toHaveLength(1);
    // `vercel dev` (VERCEL_ENV=development) still counts as delivered: the full text is in the terminal.
    const dev = createEmailSender({ env: { VERCEL_ENV: 'development' }, logSink: () => {} });
    await expect(dev({ to: 'a@b.vn', subject: 'S', ...content })).resolves.toEqual({ mode: 'log' });
  });

  it('rejects unknown modes instead of falling through to live', async () => {
    const send = createEmailSender({ env: { EMAIL_DELIVERY: 'Live x' }, logSink: () => {} });
    await expect(send({ to: 'a@b.vn', subject: 'S', ...content })).rejects.toMatchObject({ code: 'invalid_delivery_mode' });
  });

  it('redirect rewrites "to", keeps the original in the subject, drops the Reply-To, and sends over SMTP with a Message-ID from the key', async () => {
    const { sendMail, close, transport } = fakeTransport();
    const createTransport = vi.fn(() => transport);
    const send = createEmailSender({
      env: { EMAIL_DELIVERY: 'redirect', EMAIL_REDIRECT_TO: 'qa@furama.test', EMAIL_FROM: 'Furama <no-reply@mail.furama.test>', ...SMTP_ENV },
      createTransport,
    });
    // As staff.new carries it (R11): the guest's address, which a reply from the redirect inbox must not reach.
    const r = await send({ to: 'real@guest.vn', subject: 'Hello', ...content, idempotencyKey: 'invite:7:ab12', replyTo: 'guest@example.com' });
    expect(r).toEqual({ mode: 'redirect', id: '250 2.0.0 Ok: queued as AB12', messageId: '<m@x>' });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'Furama <no-reply@mail.furama.test>',
      to: 'qa@furama.test',
      subject: '[real@guest.vn] Hello',
      html: '<p>hi</p>',
      text: 'hi',
      messageId: '<invite-7-ab12@mail.furama.test>',
    });
    expect(sendMail.mock.calls[0][0]).not.toHaveProperty('replyTo');
    // One message, one connection: the transport is released after the send.
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('live on a Preview deployment is refused and opens no SMTP connection', async () => {
    // A Preview runs on a fork of production's guests and staff; `vercel dev` is a developer's machine.
    for (const VERCEL_ENV of ['preview', 'development']) {
      const createTransport = vi.fn(() => fakeTransport().transport);
      const send = createEmailSender({ env: { EMAIL_DELIVERY: 'live', EMAIL_FROM: 'no-reply@mail.furama.test', VERCEL_ENV, ...SMTP_ENV }, createTransport });
      const err = await send({ to: 'real@guest.vn', subject: 'S', ...content }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EmailSendError);
      expect(describeEmailError(err)).toBe(`invalid_delivery_mode: EMAIL_DELIVERY=live is for Production only (VERCEL_ENV is ${VERCEL_ENV}); use redirect here`);
      expect(createTransport).not.toHaveBeenCalled();
    }
    // Production sends live; a Preview sends through redirect.
    const createTransport = vi.fn(() => fakeTransport().transport);
    const env = { EMAIL_FROM: 'no-reply@mail.furama.test', EMAIL_REDIRECT_TO: 'qa@furama.test', ...SMTP_ENV };
    await expect(createEmailSender({ env: { ...env, EMAIL_DELIVERY: 'live', VERCEL_ENV: 'production' }, createTransport })({ to: 'real@guest.vn', subject: 'S', ...content })).resolves.toMatchObject({ mode: 'live' });
    await expect(createEmailSender({ env: { ...env, EMAIL_DELIVERY: 'redirect', VERCEL_ENV: 'preview' }, createTransport })({ to: 'real@guest.vn', subject: 'S', ...content })).resolves.toMatchObject({ mode: 'redirect' });
    expect(createTransport).toHaveBeenCalledTimes(2);
  });

  it('hands Reply-To to the transport and to the log, only when there is one', async () => {
    const { sendMail, transport } = fakeTransport();
    const env = { EMAIL_DELIVERY: 'live', EMAIL_FROM: 'no-reply@mail.furama.test', ...SMTP_ENV };
    await createEmailSender({ env, createTransport: () => transport })({ to: 'g@guest.vn', subject: 'S', ...content, replyTo: 'fb@furama.test' });
    expect(sendMail.mock.calls[0][0]).toMatchObject({ to: 'g@guest.vn', replyTo: 'fb@furama.test' });
    await createEmailSender({ env, createTransport: () => transport })({ to: 'g@guest.vn', subject: 'S', ...content });
    expect(sendMail.mock.calls[1][0]).not.toHaveProperty('replyTo');
    const logged: DeliveredEmail[] = [];
    await createEmailSender({ env: {}, logSink: (e) => void logged.push(e) })({ to: 'g@guest.vn', subject: 'S', ...content, replyTo: 'fb@furama.test' });
    expect(logged[0].replyTo).toBe('fb@furama.test');
  });

  it('redirect without EMAIL_REDIRECT_TO throws', async () => {
    const send = createEmailSender({ env: { EMAIL_DELIVERY: 'redirect', EMAIL_FROM: 'a@b.vn', ...SMTP_ENV }, createTransport: () => fakeTransport().transport });
    await expect(send({ to: 'a@b.vn', subject: 'S', ...content })).rejects.toMatchObject({ code: 'missing_redirect_to' });
  });

  it('live builds the SMTP options from the env: STARTTLS required on 587, TLS from the first byte on 465, short timeouts', async () => {
    const createTransport = vi.fn((_options: unknown) => fakeTransport().transport);
    const live = (env: Record<string, string>) =>
      createEmailSender({ env: { EMAIL_DELIVERY: 'live', EMAIL_FROM: 'no-reply@mail.furama.test', ...env }, createTransport })({
        to: 'real@guest.vn',
        subject: 'Hello',
        ...content,
      });
    await live(SMTP_ENV);
    expect(createTransport.mock.calls[0][0]).toEqual({
      host: 'smtp.furama.test',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'u', pass: 'p w' },
      dnsTimeout: 5_000,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      tls: { minVersion: 'TLSv1.2' },
    });
    await live({ SMTP_HOST: 'smtp.furama.test', SMTP_PORT: '465' });
    expect(createTransport.mock.calls[1][0]).toMatchObject({ port: 465, secure: true, requireTLS: false, auth: undefined });
    await live({ SMTP_HOST: 'smtp.furama.test', SMTP_PORT: '2525', SMTP_SECURE: 'true' });
    expect(createTransport.mock.calls[2][0]).toMatchObject({ port: 2525, secure: true });
  });

  it('live without SMTP settings throws a clear error at send time, not at import', async () => {
    // Importing the module (above) with no SMTP env already succeeded; the default sender fails only when used.
    vi.stubEnv('EMAIL_DELIVERY', 'live');
    vi.stubEnv('EMAIL_FROM', 'no-reply@mail.furama.test');
    vi.stubEnv('SMTP_HOST', '');
    const err = await sendEmail({ to: 'a@b.vn', subject: 'S', ...content }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmailSendError);
    expect(err).toMatchObject({ code: 'missing_smtp_config', message: 'SMTP_HOST is required when EMAIL_DELIVERY is live or redirect' });
    const bad = (env: Record<string, string>) =>
      createEmailSender({ env: { EMAIL_DELIVERY: 'live', EMAIL_FROM: 'a@b.vn', SMTP_HOST: 'h', ...env }, createTransport: () => fakeTransport().transport })({
        to: 'a@b.vn',
        subject: 'S',
        ...content,
      });
    await expect(bad({ SMTP_PORT: '58x' })).rejects.toMatchObject({ code: 'missing_smtp_config' });
    await expect(bad({ SMTP_SECURE: 'yes' })).rejects.toMatchObject({ code: 'missing_smtp_config' });
    await expect(bad({ SMTP_USER: 'u' })).rejects.toMatchObject({ code: 'missing_smtp_config', message: 'SMTP_USER and SMTP_PASSWORD must be set together' });
  });

  it('live without EMAIL_FROM (or without an address in it) throws', async () => {
    const send = (from?: string) =>
      createEmailSender({ env: { EMAIL_DELIVERY: 'live', ...SMTP_ENV, ...(from ? { EMAIL_FROM: from } : {}) }, createTransport: () => fakeTransport().transport })({
        to: 'a@b.vn',
        subject: 'S',
        ...content,
      });
    await expect(send()).rejects.toMatchObject({ code: 'missing_from' });
    await expect(send('Furama Cuisine')).rejects.toMatchObject({ code: 'missing_from' });
  });

  it('a refused recipient (5xx at RCPT TO) is rejected for good; anything else is a provider_error, without the address', async () => {
    const env = { EMAIL_DELIVERY: 'live', EMAIL_FROM: 'a@b.vn', ...SMTP_ENV };
    const failing = (error: Error) => createEmailSender({ env, createTransport: () => fakeTransport(error).transport });
    const rcpt = Object.assign(new Error('Can\'t send mail - all recipients were rejected: 550 5.1.1 <real@guest.vn>: unknown'), {
      code: 'EENVELOPE',
      command: 'RCPT TO',
      responseCode: 550,
    });
    const err = await failing(rcpt)({ to: 'real@guest.vn', subject: 'S', ...content }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'rejected' });
    expect(describeEmailError(err)).toBe("rejected: SMTP EENVELOPE at RCPT TO: Can't send mail - all recipients were rejected: 550 5.1.1 <<redacted>>: unknown");
    const busy = Object.assign(new Error('451 Try again later'), { code: 'EENVELOPE', command: 'RCPT TO', responseCode: 451 });
    await expect(failing(busy)({ to: 'a@b.vn', subject: 'S', ...content })).rejects.toMatchObject({ code: 'provider_error' });
    const auth = Object.assign(new Error('Invalid login: 535 Authentication failed'), { code: 'EAUTH', command: 'AUTH PLAIN', responseCode: 535 });
    await expect(failing(auth)({ to: 'a@b.vn', subject: 'S', ...content })).rejects.toMatchObject({ code: 'provider_error' });
    await expect(failing(new Error('ECONNRESET'))({ to: 'a@b.vn', subject: 'S', ...content })).rejects.toMatchObject({ code: 'provider_error' });
  });

  it('a stored SMTP error names neither the SMTP host nor its address (Editors read it in the email log)', async () => {
    const env = { EMAIL_DELIVERY: 'live', EMAIL_FROM: 'a@b.vn', ...SMTP_ENV };
    const stored = (error: Error) =>
      createEmailSender({ env, createTransport: () => fakeTransport(error).transport })({ to: 'a@b.vn', subject: 'S', ...content }).catch((e: unknown) =>
        describeEmailError(e),
      );
    const dns = Object.assign(new Error('getaddrinfo ENOTFOUND smtp.furama.test'), { code: 'EDNS', command: 'CONN', hostname: 'smtp.furama.test' });
    expect(await stored(dns)).toBe('provider_error: SMTP EDNS at CONN: getaddrinfo ENOTFOUND <smtp-host>');
    const refused = Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:587'), { code: 'ESOCKET', command: 'CONN', address: '10.1.2.3', port: 587 });
    expect(await stored(refused)).toBe('provider_error: SMTP ESOCKET at CONN: connect ECONNREFUSED <smtp-host>:587');
    const v6 = Object.assign(new Error('connect ETIMEDOUT 2001:db8::25:465'), { code: 'ESOCKET', command: 'CONN', address: '2001:db8::25', port: 465 });
    expect(await stored(v6)).toBe('provider_error: SMTP ESOCKET at CONN: connect ETIMEDOUT <smtp-host>:465');
    // An IPv4 address only in the text goes too.
    expect(await stored(Object.assign(new Error('Connection closed by 192.0.2.7'), { code: 'ECONNECTION' }))).toBe(
      'provider_error: SMTP ECONNECTION: Connection closed by <smtp-host>',
    );
  });

  it('gives up on a send that does not finish within the cap', async () => {
    const hanging: MailTransport = { sendMail: () => new Promise(() => {}), close: () => {} };
    const send = createEmailSender({ env: { EMAIL_DELIVERY: 'live', EMAIL_FROM: 'a@b.vn', ...SMTP_ENV }, createTransport: () => hanging, sendTimeoutMs: 50 });
    await expect(send({ to: 'a@b.vn', subject: 'S', ...content })).rejects.toMatchObject({
      code: 'provider_error',
      message: 'SMTP ETIMEDOUT: no answer within 50 ms',
    });
  });

  it('derives the Message-ID domain from EMAIL_FROM and keeps only safe characters of the key', () => {
    expect(senderDomain('Furama Cuisine <no-reply@Mail.FuramaVietnam.com>')).toBe('mail.furamavietnam.com');
    expect(senderDomain('no-reply@mail.furama.test')).toBe('mail.furama.test');
    expect(senderDomain('Furama')).toBeNull();
    expect(senderDomain(undefined)).toBeNull();
    expect(messageIdFor('outbox:12', 'mail.furama.test')).toBe('<outbox-12@mail.furama.test>');
    expect(messageIdFor('reset:ab/cd ef', 'd.vn')).toBe('<reset-ab-cd-ef@d.vn>');
  });

  it('password reset ignores Better Auth’s url and links to /admin/reset-password', async () => {
    const sink: DeliveredEmail[] = [];
    const send = createEmailSender({ env: {}, logSink: (e) => void sink.push(e) });
    await sendPasswordReset({ user: { email: 'u@f.vn', name: 'Lan' }, token: 'tok123' }, send);
    expect(sink[0].text).toContain('/admin/reset-password?token=tok123');
    expect(sink[0].idempotencyKey).toBe(`reset:${sha16('tok123')}`);
  });
});

describe('the log sink', () => {
  const email: DeliveredEmail = {
    mode: 'log',
    to: 'lan@furama.test',
    originalTo: 'lan@furama.test',
    subject: 'S',
    html: '<p>x</p>',
    text: 'Open http://h/admin/accept-invite?token=SECRET',
    idempotencyKey: 'invite:1:abcd',
  };

  it('off Vercel and under `vercel dev`, prints the full message and appends it to EMAIL_LOG_FILE', async () => {
    for (const vercelEnv of ['', 'development']) {
      const file = join(mkdtempSync(join(tmpdir(), 'email-log-')), 'emails.ndjson');
      vi.stubEnv('VERCEL_ENV', vercelEnv);
      vi.stubEnv('EMAIL_LOG_FILE', file);
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      await consoleLogSink(email);
      expect(info.mock.calls[0][0]).toContain('token=SECRET');
      expect(JSON.parse(readFileSync(file, 'utf8').trim())).toMatchObject({ to: 'lan@furama.test', text: email.text });
      info.mockRestore();
    }
  });

  it('on a Production or Preview deployment, logs neither the address nor the link, and writes no file', async () => {
    for (const vercelEnv of ['production', 'preview']) {
      const dir = mkdtempSync(join(tmpdir(), 'email-log-'));
      vi.stubEnv('VERCEL_ENV', vercelEnv);
      vi.stubEnv('EMAIL_LOG_FILE', join(dir, 'emails.ndjson'));
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      await consoleLogSink(email);
      expect(info.mock.calls).toEqual([['[email:log] to=*@furama.test key=invite:1:abcd']]);
      expect(() => readFileSync(join(dir, 'emails.ndjson'))).toThrow(/ENOENT/);
      info.mockRestore();
    }
  });
});

describe('describeEmailError', () => {
  it('keeps the code and message of an EmailSendError, short and token-free, for staff_invitation.email_error', () => {
    expect(describeEmailError(new EmailSendError('provider_error', 'SMTP EAUTH at AUTH PLAIN: Invalid login: 535 Authentication failed'))).toBe(
      'provider_error: SMTP EAUTH at AUTH PLAIN: Invalid login: 535 Authentication failed',
    );
    expect(redactEmails('550 5.1.1 <An.Nguyen+x@guest.vn>: no such user; cc lan@furama.test')).toBe('550 5.1.1 <<redacted>>: no such user; cc <redacted>');
    expect(describeEmailError(new Error('socket hang up'))).toBe('unknown: socket hang up');
    expect(describeEmailError('x'.repeat(400))).toHaveLength(300);
  });

  it('emailErrorCode reads the code back from a stored email_error', () => {
    expect(emailErrorCode(describeEmailError(new EmailSendError('not_delivered', 'EMAIL_DELIVERY is log: x')))).toBe('not_delivered');
    expect(emailErrorCode('unknown: socket hang up')).toBe('unknown');
    expect(emailErrorCode(null)).toBeNull();
  });
});
```

- [ ] **Bước 5: Thay guard import**

Xóa `lib/server/email/resend-import.guard.test.ts` (`rm`; bước Commit `git rm` nó). Create `lib/server/email/mail-transport.guard.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Every email goes through lib/server/email/send.ts, the only place that
 * honours EMAIL_DELIVERY (spec §10.4: log by default, redirect on previews,
 * live in production). A second nodemailer transport elsewhere would send real
 * mail from CI or a preview. smtp-server (the local sink of the tests) stays
 * under test/; Resend is gone (user decision: SMTP).
 */
const ROOT = join(__dirname, '..', '..', '..');
const SCAN = ['app', 'lib', 'components', 'db', 'scripts', 'e2e', 'proxy.ts'];
const ALLOWED = 'lib/server/email/';

function files(path: string): string[] {
  const full = join(ROOT, path);
  try {
    return readdirSync(full, { withFileTypes: true }).flatMap((e) => files(join(path, e.name)));
  } catch {
    return /\.(ts|tsx|mjs|js)$/.test(path) ? [full] : [];
  }
}

const importOf = (name: string) => new RegExp(`(?:from\\s+|import\\s*\\(\\s*|require\\s*\\(\\s*)['"]${name}(?:/[^'"]*)?['"]`);
const NODEMAILER = importOf('nodemailer');
const SMTP_SERVER = importOf('smtp-server');
const RESEND = importOf('resend');

// This file names the packages in its own examples.
const sources = () => SCAN.flatMap(files).map((f) => relative(ROOT, f)).filter((f) => f !== relative(ROOT, __filename));
const importing = (pattern: RegExp, list: string[]) => list.filter((f) => pattern.test(readFileSync(join(ROOT, f), 'utf8')));

describe('mail transport imports', () => {
  it('only lib/server/email imports nodemailer', () => {
    expect(importing(NODEMAILER, sources().filter((f) => !f.startsWith(ALLOWED)))).toEqual([]);
  });

  it('nothing outside test/ imports smtp-server, and nothing imports resend', () => {
    expect(importing(SMTP_SERVER, sources())).toEqual([]);
    expect(importing(RESEND, sources())).toEqual([]);
  });

  it('recognises the import forms it is looking for', () => {
    for (const line of [
      `import nodemailer from 'nodemailer';`,
      `import type { SMTPTransportOptions } from 'nodemailer/lib/smtp-transport';`,
      `const m = await import("nodemailer")`,
      `require('nodemailer')`,
    ]) {
      expect(NODEMAILER.test(line)).toBe(true);
    }
    expect(NODEMAILER.test(`import { sendEmail } from '@/lib/server/email/send';`)).toBe(false);
    expect(SMTP_SERVER.test(`import { SMTPServer } from 'smtp-server';`)).toBe(true);
  });
});
```

- [ ] **Bước 6: Sửa test của bản đồ lỗi và của lời mời**

`EMAIL_SETUP_ERRORS` là một `Record<EmailErrorCode, boolean>`, nên mã mới phải được xếp loại. Sửa `lib/admin/auth-errors.test.ts`:

```diff
diff --git a/lib/admin/auth-errors.test.ts b/lib/admin/auth-errors.test.ts
index 017d083..def9fb6 100644
--- a/lib/admin/auth-errors.test.ts
+++ b/lib/admin/auth-errors.test.ts
@@ -61,7 +61,9 @@ describe('inviteEmailFailedMessage', () => {
   const setup = 'Chưa gửi được email: chưa cấu hình gửi email trên môi trường này. Báo bộ phận kỹ thuật, rồi bấm Gửi lại.';
   it.each([
     ['not_delivered', setup],
-    ['missing_api_key', setup],
+    ['missing_smtp_config', setup],
+    ['missing_app_url', setup],
+    ['rejected', 'Chưa gửi được email, bấm Gửi lại.'],
     ['invalid_delivery_mode', setup],
     ['provider_error', 'Chưa gửi được email, bấm Gửi lại.'],
     ['unknown', 'Chưa gửi được email, bấm Gửi lại.'],
```

Thêm vào `test/integration/staff-auth.test.ts` test "email đã đi thì vẫn là đã gửi khi ghi sổ hỏng" (một `Proxy` của pool làm hỏng đúng câu `UPDATE … email_error = NULL`), và đổi câu lỗi mẫu sang SMTP:

```diff
diff --git a/test/integration/staff-auth.test.ts b/test/integration/staff-auth.test.ts
index f72e110..786fed9 100644
--- a/test/integration/staff-auth.test.ts
+++ b/test/integration/staff-auth.test.ts
@@ -115,11 +115,11 @@ describe.skipIf(!TEST_DATABASE_URL)('staff management on migration 005', () => {
     it('a failed send keeps the invitation and records the error; a resend that works clears it', async () => {
       const admin = await owner();
       const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
-      failNext = new EmailSendError('provider_error', 'Resend rejected the email: rate limited');
+      failNext = new EmailSendError('provider_error', 'SMTP EAUTH at AUTH PLAIN: Invalid login: 535 Authentication failed');
       const invited = await createInvitation(deps(), admin, { email: 'ed@furama.test', role: 'editor' });
       expect(invited).toMatchObject({ ok: true, emailSent: false, emailError: 'provider_error' });
       expect(await rows('SELECT email_error FROM staff_invitation')).toEqual([
-        { email_error: 'provider_error: Resend rejected the email: rate limited' },
+        { email_error: 'provider_error: SMTP EAUTH at AUTH PLAIN: Invalid login: 535 Authentication failed' },
       ]);
       expect(errors).toHaveBeenCalledWith('[staff] invite email failed', { id: invited.ok ? invited.id : '', code: 'provider_error' });
       errors.mockRestore();
@@ -129,6 +129,27 @@ describe.skipIf(!TEST_DATABASE_URL)('staff management on migration 005', () => {
       expect(await rows('SELECT email_error FROM staff_invitation')).toEqual([{ email_error: null }]);
     });
 
+    it('an email that went out stays sent when recording it fails afterwards (the send and the bookkeeping are apart)', async () => {
+      const admin = await owner();
+      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
+      // A database that fails only the bookkeeping write after a successful send.
+      const flaky = new Proxy(pool, {
+        get: (target, prop, receiver) =>
+          prop === 'query'
+            ? (text: unknown, values?: unknown) =>
+                typeof text === 'string' && text.startsWith('UPDATE staff_invitation SET email_error = NULL')
+                  ? Promise.reject(Object.assign(new Error('connection terminated'), { code: '57P01' }))
+                  : target.query(text as string, values as unknown[])
+            : Reflect.get(target, prop, receiver),
+      });
+      const invited = await createInvitation({ ...deps(), pool: flaky }, admin, { email: 'ed@furama.test', role: 'editor' });
+      expect(invited).toMatchObject({ ok: true, emailSent: true });
+      expect(invites).toHaveLength(1);
+      expect(errors).toHaveBeenCalledWith('[staff] invite bookkeeping failed', { id: invited.ok ? invited.id : '', code: '57P01' });
+      expect(errors).not.toHaveBeenCalledWith('[staff] invite email failed', expect.anything());
+      errors.mockRestore();
+    });
+
     it('log mode on a Vercel deployment is not a sent invitation: email_error records not_delivered', async () => {
       const admin = await owner();
       const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
```

- [ ] **Bước 7: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/server/email lib/admin/auth-errors.test.ts test/integration/staff-auth.test.ts`
Expected: FAIL `Test Files  5 failed (5)`, `Tests  3 failed | 35 passed (38)`:

```
 ❯ test/integration/staff-auth.test.ts (0 test)
 ❯ lib/server/email/email.test.ts (0 test)
 ❯ lib/server/email/smtp.test.ts (0 test)
 ❯ lib/admin/auth-errors.test.ts (35 tests | 2 failed) 7ms
     × missing_smtp_config 3ms
     × missing_app_url 1ms
 ❯ lib/server/email/mail-transport.guard.test.ts (3 tests | 1 failed) 35ms
     × nothing outside test/ imports smtp-server, and nothing imports resend 20ms
 FAIL  lib/server/email/smtp.test.ts [ lib/server/email/smtp.test.ts ]
Error: Cannot find package 'resend' imported from …/lib/server/email/send.ts
 FAIL  lib/server/email/email.test.ts [ lib/server/email/email.test.ts ]
Error: Cannot find package '@/lib/server/auth/lifetimes' imported from …/lib/server/email/email.test.ts
 FAIL  lib/admin/auth-errors.test.ts > inviteEmailFailedMessage > missing_smtp_config
AssertionError: expected 'Chưa gửi được email, bấm Gửi lại.' to be 'Chưa gửi được email: chưa cấu hình gử…' // Object.is equality
 FAIL  lib/server/email/mail-transport.guard.test.ts > mail transport imports > nothing outside test/ imports smtp-server, and nothing imports resend
AssertionError: expected [ 'lib/server/email/send.ts' ] to deeply equal []
```

- [ ] **Bước 8: Viết kiểu và kết nối SMTP**

Replace the whole of `lib/server/email/types.ts` with:

```ts
import type { ReactElement } from 'react';

export type EmailDeliveryMode = 'live' | 'redirect' | 'log';

/** Content is either a React Email element (rendered to html + text here) or ready-made html + text. */
export type EmailContent =
  | { react: ReactElement; html?: undefined; text?: undefined }
  | { react?: undefined; html: string; text: string };

export type SendEmailInput = EmailContent & {
  to: string;
  subject: string;
  /**
   * What makes a repeat of this send recognisable. SMTP has no idempotency key, so it becomes
   * the Message-ID header (`<invite-12-ab34@sending-domain>`) unless `messageId` is given.
   */
  idempotencyKey?: string;
  /** A ready Message-ID, `<…@…>`; the outbox passes the one it fixed at the first attempt. */
  messageId?: string;
  /** Where a reply goes: the guest for staff.new, the shared inbox for guest emails (R11). */
  replyTo?: string;
};

/** What a sink / the SMTP server actually received, after redirect and rendering. */
export type DeliveredEmail = {
  mode: EmailDeliveryMode;
  to: string;
  /** Original recipient; differs from `to` only in redirect mode. */
  originalTo: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey?: string;
  messageId?: string;
  replyTo?: string;
};

/** `id`: the SMTP server's reply to the message ("250 2.0.0 Ok: queued as …"); none in log mode. */
export type SendEmailResult = { mode: EmailDeliveryMode; id?: string; messageId?: string };

export type EmailErrorCode =
  | 'invalid_delivery_mode'
  /** EMAIL_DELIVERY is live or redirect but SMTP_HOST, SMTP_PORT or the SMTP_USER/SMTP_PASSWORD pair is missing or wrong. */
  | 'missing_smtp_config'
  | 'missing_from'
  | 'missing_redirect_to'
  /** BETTER_AUTH_URL is unset where an emailed link could reach someone (live, redirect, or a Vercel deployment). */
  | 'missing_app_url'
  /** Log mode on a Vercel Production or Preview deployment: logged without its link, so it reached no one. */
  | 'not_delivered'
  /** The SMTP server refused the recipient for good (5xx at RCPT TO): retrying cannot help. */
  | 'rejected'
  /** Anything else on the way to the SMTP server: network, TLS, auth, 4xx, a timeout. Retried. */
  | 'provider_error';

/** Thrown by sendEmail. The invite flow stores describeEmailError(err) in staff_invitation.email_error. */
export class EmailSendError extends Error {
  readonly code: EmailErrorCode;
  constructor(code: EmailErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EmailSendError';
    this.code = code;
  }
}

export type EmailLogSink = (email: DeliveredEmail) => void | Promise<void>;

/** The message we hand the transport (nodemailer's SendMailOptions, narrowed to what we use). */
export type TransportMessage = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  messageId?: string;
  replyTo?: string;
};

/** The slice of a nodemailer transporter we use; tests inject a fake or the real one aimed at a local sink. */
export type MailTransport = {
  sendMail(message: TransportMessage): Promise<{ messageId: string; response: string }>;
  close(): void;
};

/** Addresses in an SMTP reply ("550 5.1.1 <guest@x.vn>: unknown") never reach a stored error or a log line. */
export function redactEmails(text: string): string {
  return text.replace(/[^\s<>()"',;:]+@[^\s<>()"',;:]+/g, '<redacted>');
}

/** What goes in staff_invitation.email_error and email_outbox.last_error: "<code>: <message>", at most 300 characters, no addresses. */
export function describeEmailError(error: unknown): string {
  const text =
    error instanceof EmailSendError
      ? `${error.code}: ${error.message}`
      : `unknown: ${error instanceof Error ? error.message : String(error)}`;
  return redactEmails(text).slice(0, 300);
}

/** The code at the front of a stored email_error (an EmailErrorCode or "unknown"), or null when there is none. */
export function emailErrorCode(stored: string | null): string | null {
  return stored === null ? null : stored.split(':')[0];
}
```

Create `lib/server/email/smtp.ts` (không pool: mỗi email một kết nối, nên một instance Fluid bị treo giữa hai lần gọi không giữ socket chết; `requireTLS` bật khi không `secure`, nên cổng 587 không bao giờ đi tiếp khi chưa mã hóa; import có tên `createTransport`, không `nodemailer.createTransport`, để oxlint không thêm cảnh báo):

```ts
import 'server-only';
import { createTransport } from 'nodemailer';
import type { SMTPTransportOptions } from 'nodemailer/lib/smtp-transport';
import { EmailSendError, type MailTransport } from './types';

/*
 * The SMTP connection (user decision: no Resend; a traditional SMTP account).
 * Settings come from the environment when a message is sent, never at import
 * or build time:
 *
 *   SMTP_HOST      the provider's submission host
 *   SMTP_PORT      587 (STARTTLS, the default) or 465 (TLS from the first byte)
 *   SMTP_SECURE    "true" for implicit TLS, "false" for STARTTLS; unset: true only on port 465
 *   SMTP_USER      login, together with SMTP_PASSWORD (both or neither)
 *   SMTP_PASSWORD
 *
 * Port 25 is not an option: Vercel functions are generally blocked from it.
 */

export type SmtpConfig = {
  host: string;
  port: number;
  /** true: TLS from the first byte (465). false: plain connect, then a mandatory STARTTLS upgrade (587). */
  secure: boolean;
  auth?: { user: string; pass: string };
};

const missing = (message: string) => new EmailSendError('missing_smtp_config', message);

export function smtpConfigFromEnv(env: Record<string, string | undefined>): SmtpConfig {
  const host = env.SMTP_HOST?.trim();
  if (!host) throw missing('SMTP_HOST is required when EMAIL_DELIVERY is live or redirect');

  const rawPort = env.SMTP_PORT?.trim() || '587';
  const port = Number(rawPort);
  if (!/^\d{1,5}$/.test(rawPort) || port < 1 || port > 65535) throw missing(`SMTP_PORT must be a port number (got "${rawPort}")`);

  const rawSecure = env.SMTP_SECURE?.trim().toLowerCase();
  if (rawSecure && rawSecure !== 'true' && rawSecure !== 'false') throw missing(`SMTP_SECURE must be true or false (got "${rawSecure}")`);
  const secure = rawSecure ? rawSecure === 'true' : port === 465;

  const user = env.SMTP_USER?.trim();
  // A password is taken as typed: spaces may be part of it.
  const pass = env.SMTP_PASSWORD;
  if (Boolean(user) !== Boolean(pass)) throw missing('SMTP_USER and SMTP_PASSWORD must be set together');

  return { host, port, secure, ...(user && pass ? { auth: { user, pass } } : {}) };
}

/**
 * Sized for a serverless function, where nodemailer's defaults (2 minutes to
 * connect, 10 minutes of socket inactivity) would outlive the invocation.
 * Each limit applies to one step; send.ts also caps a whole send.
 */
export const SMTP_TIMEOUTS = {
  dnsTimeout: 5_000,
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
} as const;

export function smtpTransportOptions(config: SmtpConfig): SMTPTransportOptions {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    // Without TLS on 587 the password and the guest's details would cross the network in clear: refuse instead.
    requireTLS: !config.secure,
    auth: config.auth,
    ...SMTP_TIMEOUTS,
    tls: { minVersion: 'TLSv1.2' },
  };
}

/**
 * Not pooled: each message opens its own connection and closes it when the
 * server has answered. Booking email is a few messages per drain, and a
 * Fluid Compute instance that is suspended between invocations then never
 * holds a half-dead SMTP socket.
 */
export function createSmtpTransport(options: SMTPTransportOptions): MailTransport {
  const transporter = createTransport(options);
  return {
    sendMail: async (message) => {
      const info = await transporter.sendMail(message);
      return { messageId: info.messageId, response: info.response };
    },
    close: () => transporter.close(),
  };
}
```

- [ ] **Bước 9: Viết lại cổng gửi**

Hành vi của `log` giữ nguyên của đợt 3; `redirect` vẫn đổi người nhận và ghi địa chỉ thật vào tiêu đề, nay bỏ Reply-To (dữ liệu của Preview là bản fork: trả lời từ hộp thư chuyển hướng không được tới khách thật hay hộp thư chung của production, R22). `resolveMode` ném `invalid_delivery_mode` cho `live` khi `VERCEL_ENV` là `preview` hoặc `development` (spec §10.4: live chỉ ở Production), trước mọi kết nối. `live`/`redirect` đọc `EMAIL_FROM` (phải có một địa chỉ, cũng cho tên miền của Message-ID) và cấu hình SMTP lúc gửi. Một lỗi SMTP thành `rejected` chỉ khi mã 5xx ở lệnh `RCPT` (R6); 5xx ở DATA (một hạn mức của nhà cung cấp) là `provider_error`, được thử lại. Lỗi lưu xóa địa chỉ email, rồi thay host cấu hình, `address`/`hostname` của lỗi kết nối và mọi IPv4 bằng `<smtp-host>` (Editor đọc `last_error` trong nhật ký email).

Replace the whole of `lib/server/email/send.ts` with:

```ts
import 'server-only';
import type { ReactElement } from 'react';
import { plainTextSelectors, render } from 'react-email';
import type { SMTPTransportOptions } from 'nodemailer/lib/smtp-transport';
import { createSmtpTransport, smtpConfigFromEnv, smtpTransportOptions } from './smtp';
import {
  EmailSendError,
  redactEmails,
  type DeliveredEmail,
  type EmailDeliveryMode,
  type EmailLogSink,
  type MailTransport,
  type SendEmailInput,
  type SendEmailResult,
} from './types';

/*
 * The one place that sends email (spec §10.4's EMAIL_DELIVERY gate, for the
 * staff emails and the booking outbox alike):
 *   log      (default) print it, and append it to EMAIL_LOG_FILE off Vercel;
 *   redirect send it over SMTP to EMAIL_REDIRECT_TO, the real address in the subject, no Reply-To;
 *   live     send it over SMTP to the real address: Production only (refused on a Preview and under `vercel dev`).
 * test/guards keep nodemailer imports inside lib/server/email/.
 */

export type EmailDeps = {
  /** Read at send time, never at import time, so `next build` needs no email env. */
  env: Record<string, string | undefined>;
  createTransport: (options: SMTPTransportOptions) => MailTransport;
  logSink: EmailLogSink;
  /** A cap on one whole send (connect, TLS, login, DATA), above the per-step SMTP timeouts. */
  sendTimeoutMs: number;
  /** Tests only: a local sink's self-signed certificate, shorter timeouts. Never read from the environment. */
  transportOverrides?: Partial<SMTPTransportOptions>;
};

export const SEND_TIMEOUT_MS = 30_000;

/** Vercel deployments: their logs live on Vercel, and a Preview may run on a copy of production's staff. */
const DEPLOYED = new Set(['production', 'preview']);

/**
 * Default log sink. Invite and reset links are bearer tokens, so on a Vercel deployment
 * (VERCEL_ENV production or preview, e.g. a Preview missing EMAIL_DELIVERY) the log line carries
 * only the recipient domain and the idempotency key (and the sender then fails the send with
 * not_delivered, since nobody can act on it). Off Vercel (dev, CI, `next start` in E2E)
 * and under `vercel dev` (VERCEL_ENV=development, which `vercel env pull` also writes into
 * .env.local) it prints the full text so a developer can click the link, and EMAIL_LOG_FILE
 * appends the full message as NDJSON, which is how Playwright reads the invite link out of a
 * separate server process.
 */
export const consoleLogSink: EmailLogSink = async (email) => {
  if (DEPLOYED.has(process.env.VERCEL_ENV ?? '')) {
    const domain = email.to.split('@')[1] ?? 'unknown';
    console.info(`[email:log] to=*@${domain} key=${email.idempotencyKey ?? '-'}`);
    return;
  }
  console.info(`[email:log] to=${email.to}\nsubject: ${email.subject}\n${email.text}`);
  const file = process.env.EMAIL_LOG_FILE;
  if (file) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(file, `${JSON.stringify(email)}\n`);
  }
};

const defaultDeps = (): EmailDeps => ({
  env: process.env,
  createTransport: createSmtpTransport,
  logSink: consoleLogSink,
  sendTimeoutMs: SEND_TIMEOUT_MS,
});

/**
 * Where live is refused (spec §10.4: live only in Production). A Preview runs on a branch forked
 * from production, with its real guests, staff and recipients; `vercel dev` (VERCEL_ENV=development)
 * is a developer's machine. Both use redirect.
 */
const LIVE_REFUSED = new Set(['preview', 'development']);

/**
 * The delivery mode, checked at send time. Fails closed: a typo never falls through to real
 * delivery, and live where it is refused throws instead of emailing the people of forked data, so
 * an outbox row retries and then fails, and "Gửi email thử" says why. mode.ts shows staff this
 * same verdict.
 */
export function resolveMode(raw: string | undefined, vercelEnv: string | undefined): EmailDeliveryMode {
  const value = raw?.trim();
  if (!value) return 'log';
  if (value !== 'live' && value !== 'redirect' && value !== 'log') {
    throw new EmailSendError('invalid_delivery_mode', `EMAIL_DELIVERY must be live, redirect or log (got "${value}")`);
  }
  if (value === 'live' && LIVE_REFUSED.has(vercelEnv ?? '')) {
    throw new EmailSendError('invalid_delivery_mode', `EMAIL_DELIVERY=live is for Production only (VERCEL_ENV is ${vercelEnv}); use redirect here`);
  }
  return value;
}

/** The domain of EMAIL_FROM ("Furama Cuisine <no-reply@mail.furamavietnam.com>" → mail.furamavietnam.com). */
export function senderDomain(from: string | undefined): string | null {
  const match = from?.trim().match(/@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)>?$/);
  return match ? match[1].toLowerCase() : null;
}

/** A Message-ID made from an idempotency key: `invite:12:ab34` → `<invite-12-ab34@domain>`. */
export function messageIdFor(key: string, domain: string): string {
  return `<${key.replace(/[^A-Za-z0-9.-]+/g, '-')}@${domain}>`;
}

export async function renderEmail(element: ReactElement): Promise<{ html: string; text: string }> {
  const [html, text] = await Promise.all([
    render(element),
    // html-to-text upper-cases headings by default; keep Vietnamese headings as written.
    render(element, {
      plainText: true,
      htmlToTextOptions: { selectors: [{ selector: 'h1', options: { uppercase: false } }, ...plainTextSelectors] },
    }),
  ]);
  return { html, text };
}

async function renderContent(input: SendEmailInput): Promise<{ html: string; text: string }> {
  return input.react ? renderEmail(input.react) : { html: input.html, text: input.text };
}

/** Rejects after `ms`, so one stuck server cannot hold a drain until the function's own limit. */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`no answer within ${ms} ms`), { code: 'ETIMEDOUT' })), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

type SmtpFailure = { message?: string; code?: string; command?: string; responseCode?: number; address?: unknown; hostname?: unknown };

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

/**
 * Where the SMTP server is stays out of a stored error, like the addresses: Editors read
 * last_error in the email log. The configured host and the address or host name a connection
 * error carries (IPv6 included) become <smtp-host>, then any IPv4 address left in the text. Only
 * names with a dot or a colon are replaced, so a bare host such as "mail" never eats a word.
 */
function scrubHost(text: string, names: unknown[]): string {
  let out = text;
  for (const name of names) {
    if (typeof name === 'string' && /[.:]/.test(name)) out = out.split(name).join('<smtp-host>');
  }
  return out.replace(IPV4, '<smtp-host>');
}

/** A refused recipient (5xx at RCPT TO) is final; anything else (network, TLS, login, 4xx, timeout) may pass later. */
function smtpError(cause: unknown, host: string): EmailSendError {
  const e = (cause ?? {}) as SmtpFailure;
  const where = [e.code, e.command].filter(Boolean).join(' at ');
  const message = scrubHost(redactEmails(`SMTP ${where ? `${where}: ` : ''}${e.message ?? String(cause)}`), [host, e.address, e.hostname]);
  const permanent = typeof e.responseCode === 'number' && e.responseCode >= 500 && e.responseCode < 600 && /^RCPT/i.test(e.command ?? '');
  return new EmailSendError(permanent ? 'rejected' : 'provider_error', message, { cause });
}

export type Mailer = {
  send(input: SendEmailInput): Promise<SendEmailResult>;
  /** Releases the transport; the drain calls it once, after its last message. */
  close(): void;
};

/**
 * One sender for a batch: the drain opens it once, sends each claimed row,
 * then closes it. The SMTP settings are read and checked at the first live or
 * redirect send, so log mode never needs them.
 */
export function openMailer(overrides: Partial<EmailDeps> = {}): Mailer {
  const deps = { ...defaultDeps(), ...overrides };
  let transport: MailTransport | null = null;
  /** The configured SMTP host, kept out of stored errors (scrubHost). */
  let host = '';

  return {
    async send(input) {
      const mode = resolveMode(deps.env.EMAIL_DELIVERY, deps.env.VERCEL_ENV);
      const { html, text } = await renderContent(input);

      let to = input.to;
      let subject = input.subject;
      let replyTo = input.replyTo;
      if (mode === 'redirect') {
        const target = deps.env.EMAIL_REDIRECT_TO?.trim();
        if (!target) throw new EmailSendError('missing_redirect_to', 'EMAIL_REDIRECT_TO is required when EMAIL_DELIVERY=redirect');
        to = target;
        subject = `[${input.to}] ${input.subject}`;
        // A redirected email comes from forked data (a Preview, a dev database). Answering it from the
        // redirect inbox must reach neither the real guest (staff.new replies to the guest, R11) nor
        // production's shared inbox, so it carries no Reply-To.
        replyTo = undefined;
      }

      const from = deps.env.EMAIL_FROM?.trim();
      const domain = senderDomain(from);
      const messageId = input.messageId ?? (input.idempotencyKey && domain ? messageIdFor(input.idempotencyKey, domain) : undefined);
      const delivered: DeliveredEmail = {
        mode,
        to,
        originalTo: input.to,
        subject,
        html,
        text,
        idempotencyKey: input.idempotencyKey,
        messageId,
        ...(replyTo ? { replyTo } : {}),
      };

      if (mode === 'log') {
        await deps.logSink(delivered);
        // On a Production or Preview deployment the sink keeps only the recipient's domain and the
        // key, so the link is gone and nobody received anything. Report that as a failure: the
        // invitation then records email_error and the outbox retries, instead of "sent" for an
        // email nobody can recover.
        const vercelEnv = deps.env.VERCEL_ENV ?? '';
        if (DEPLOYED.has(vercelEnv)) {
          throw new EmailSendError(
            'not_delivered',
            `EMAIL_DELIVERY is log (or unset) on a Vercel ${vercelEnv} deployment: the email was only logged, without its link, and reached no one. Set EMAIL_DELIVERY to live or redirect.`,
          );
        }
        return { mode, messageId };
      }

      if (!from || !domain) {
        throw new EmailSendError('missing_from', `EMAIL_FROM with a sender address is required when EMAIL_DELIVERY=${mode}`);
      }
      if (!transport) {
        const config = smtpConfigFromEnv(deps.env);
        host = config.host;
        transport = deps.createTransport({ ...smtpTransportOptions(config), ...deps.transportOverrides });
      }

      let info;
      try {
        info = await withDeadline(
          transport.sendMail({ from, to, subject, html, text, messageId, ...(replyTo ? { replyTo } : {}) }),
          deps.sendTimeoutMs,
        );
      } catch (cause) {
        throw smtpError(cause, host);
      }
      return { mode, id: redactEmails(info.response).slice(0, 300), messageId: info.messageId };
    },
    close() {
      transport?.close();
      transport = null;
    },
  };
}

/** A sender for one message at a time (staff invitation and password reset). */
export function createEmailSender(overrides: Partial<EmailDeps> = {}) {
  return async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    const mailer = openMailer(overrides);
    try {
      return await mailer.send(input);
    } finally {
      mailer.close();
    }
  };
}

export const sendEmail = createEmailSender();
```

- [ ] **Bước 10: Thời hạn thật, `appOrigin()` chặn khi thiếu cấu hình, tách gửi khỏi ghi sổ**

Create `lib/server/auth/lifetimes.ts` (không `server-only`: `config.ts` được CLI auth và script bootstrap nạp):

```ts
/*
 * How long the staff links work. One constant each, read both by the code
 * that enforces the lifetime and by the email that states it, so the two
 * cannot drift apart (phase-3 ledger). No server-only import: config.ts is
 * also loaded by the auth CLI and the bootstrap script.
 */

/** Spec §7.1: an invitation link works for 7 days (staff_invitation.expires_at). */
export const INVITE_TTL_DAYS = 7;

/** A password-reset link works for an hour (Better Auth's resetPasswordTokenExpiresIn). */
export const RESET_TOKEN_SECONDS = 60 * 60;
```

Sửa `lib/server/auth/config.ts`:

```diff
diff --git a/lib/server/auth/config.ts b/lib/server/auth/config.ts
index 286244a..55b0441 100644
--- a/lib/server/auth/config.ts
+++ b/lib/server/auth/config.ts
@@ -3,6 +3,7 @@ import { APIError, createAuthMiddleware } from 'better-auth/api';
 import { nextCookies } from 'better-auth/next-js';
 import { admin as adminPlugin } from 'better-auth/plugins/admin';
 import type { Pool } from 'pg';
+import { RESET_TOKEN_SECONDS } from './lifetimes';
 import { ac, roles } from './permissions';
 import { decideSignup } from './signup-gate';
 
@@ -111,7 +112,7 @@ export function createAuth(deps: AuthDeps) {
       minPasswordLength: 12,
       maxPasswordLength: 128,
       revokeSessionsOnPasswordReset: true,
-      resetPasswordTokenExpiresIn: 60 * 60, // the email says 60 minutes
+      resetPasswordTokenExpiresIn: RESET_TOKEN_SECONDS, // the reset email states the same lifetime
       // Better Auth answers 200 for any email; with deps.backgroundTask this
       // runs after that answer (runInBackgroundOrAwait), so a staff address
       // answers as fast as an unknown one. A throw here must neither change the
```

Sửa `lib/server/auth/staff.ts` (chỉ lời gửi nằm trong `try`; câu `UPDATE` xóa lỗi cũ chạy sau, hỏng thì log mà vẫn báo đã gửi):

```diff
diff --git a/lib/server/auth/staff.ts b/lib/server/auth/staff.ts
index 14c4582..daf471a 100644
--- a/lib/server/auth/staff.ts
+++ b/lib/server/auth/staff.ts
@@ -5,6 +5,7 @@ import type { Pool, PoolClient } from 'pg';
 import { insertAudit, withTransaction, type AuditActor } from '@/lib/server/audit';
 import { describeEmailError, emailErrorCode } from '@/lib/server/email/types';
 import { INVITATION_REQUIRED, type Auth } from './config';
+import { INVITE_TTL_DAYS } from './lifetimes';
 import type { StaffRole } from './permissions';
 import { normalizeEmail } from './signup-gate';
 
@@ -32,7 +33,8 @@ type Fail<C extends string> = { ok: false; code: C };
  */
 export type InviteDelivery = { emailSent: true } | { emailSent: false; emailError: string };
 
-export const INVITE_TTL = '7 days';
+/** The SQL interval of staff_invitation.expires_at; the invitation email states the same days. */
+export const INVITE_TTL = `${INVITE_TTL_DAYS} days`;
 const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
 
 export function hashToken(token: string): string {
@@ -45,7 +47,11 @@ export function newInviteToken(): { token: string; hash: string } {
   return { token, hash: hashToken(token) };
 }
 
-/** Sends after the commit; a failure is stored in email_error, never thrown (spec §7.1 step 5). */
+/**
+ * Sends after the commit; a failure is stored in email_error, never thrown (spec §7.1 step 5).
+ * Only the send sits in the try: once the email has gone out, a database error while clearing
+ * an earlier email_error is logged, not reported as "Chưa gửi được email" (phase-3 ledger).
+ */
 async function deliverInvite(
   deps: StaffDeps,
   invitation: { id: string; email: string; role: StaffRole },
@@ -60,8 +66,6 @@ async function deliverInvite(
       role: invitation.role,
       inviterName: actor.name ?? actor.email,
     });
-    await deps.pool.query('UPDATE staff_invitation SET email_error = NULL WHERE id = $1', [invitation.id]);
-    return { emailSent: true };
   } catch (err) {
     const stored = describeEmailError(err);
     const code = emailErrorCode(stored) ?? 'unknown';
@@ -69,6 +73,12 @@ async function deliverInvite(
     await deps.pool.query('UPDATE staff_invitation SET email_error = $2 WHERE id = $1', [invitation.id, stored]);
     return { emailSent: false, emailError: code };
   }
+  try {
+    await deps.pool.query('UPDATE staff_invitation SET email_error = NULL WHERE id = $1', [invitation.id]);
+  } catch (err) {
+    console.error('[staff] invite bookkeeping failed', { id: invitation.id, code: (err as { code?: string } | null)?.code ?? 'unknown' });
+  }
+  return { emailSent: true };
 }
 
 export async function createInvitation(
```

Sửa `lib/server/email/auth-emails.ts`:

```diff
diff --git a/lib/server/email/auth-emails.ts b/lib/server/email/auth-emails.ts
index f0fa2d5..7a5a8e1 100644
--- a/lib/server/email/auth-emails.ts
+++ b/lib/server/email/auth-emails.ts
@@ -1,22 +1,39 @@
 import 'server-only';
 import { createHash } from 'node:crypto';
 import { createElement } from 'react';
+import { INVITE_TTL_DAYS, RESET_TOKEN_SECONDS } from '@/lib/server/auth/lifetimes';
 import { sendEmail as defaultSend } from './send';
 import { PasswordResetEmail, passwordResetSubject } from './templates/password-reset';
 import { StaffInvitationEmail, staffInvitationSubject, type StaffInvitationProps } from './templates/staff-invitation';
-import type { SendEmailInput, SendEmailResult } from './types';
+import { EmailSendError, type SendEmailInput, type SendEmailResult } from './types';
 
 /*
  * The two staff emails of phase 3 (spec §7.1, §10.4): they go straight to
- * Resend through sendEmail, not through the booking outbox. Links are built
+ * SMTP through sendEmail, not through the booking outbox. Links are built
  * from BETTER_AUTH_URL; the raw token appears only in the link, never in the
- * idempotency key (Resend stores keys) or a log line.
+ * idempotency key (it becomes the Message-ID header, which every mail server
+ * on the way stores) or a log line.
  */
 
 type Send = (input: SendEmailInput) => Promise<SendEmailResult>;
 
+const DEPLOYED = new Set(['production', 'preview']);
+
+/**
+ * The origin of every emailed link (invite, reset, and the booking link in
+ * staff.new). It fails closed (R23): without BETTER_AUTH_URL a live or
+ * redirected email, or any email on a Vercel deployment, would carry a
+ * localhost link that works for nobody. Only log mode off Vercel (dev, tests)
+ * keeps the localhost default.
+ */
 export function appOrigin(env: Record<string, string | undefined> = process.env): string {
-  return (env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '');
+  const url = env.BETTER_AUTH_URL?.trim();
+  if (url) return url.replace(/\/$/, '');
+  const mode = env.EMAIL_DELIVERY?.trim() || 'log';
+  if (mode !== 'log' || DEPLOYED.has(env.VERCEL_ENV ?? '')) {
+    throw new EmailSendError('missing_app_url', 'BETTER_AUTH_URL is required for emailed links outside log mode and on Vercel deployments');
+  }
+  return 'http://localhost:3000';
 }
 
 export function invitationUrl(token: string, origin = appOrigin()): string {
@@ -39,7 +56,7 @@ export type StaffInvitationEmailArgs = {
 
 /**
  * Keyed by the invitation and its token: "Gửi lại" mints a new token, so it is
- * a new Resend idempotency key, while a retry of the same send stays deduplicated.
+ * a new Message-ID, while a retry of the same send repeats the same one.
  */
 export function sendStaffInvitation(args: StaffInvitationEmailArgs, send: Send = defaultSend): Promise<SendEmailResult> {
   return send({
@@ -49,6 +66,7 @@ export function sendStaffInvitation(args: StaffInvitationEmailArgs, send: Send =
       acceptUrl: invitationUrl(args.token),
       role: args.role,
       inviterName: args.inviterName,
+      expiresInDays: INVITE_TTL_DAYS,
     }),
     idempotencyKey: `invite:${args.invitationId}:${tokenKey(args.token)}`,
   });
@@ -69,6 +87,7 @@ export function sendPasswordReset(
     react: createElement(PasswordResetEmail, {
       resetUrl: passwordResetUrl(data.token),
       userName: data.user.name ?? undefined,
+      expiresInMinutes: RESET_TOKEN_SECONDS / 60,
     }),
     idempotencyKey: `reset:${tokenKey(data.token)}`,
   });
```

Sửa hai template (prop thời hạn thành bắt buộc, không còn số viết cứng):

```diff
diff --git a/lib/server/email/templates/password-reset.tsx b/lib/server/email/templates/password-reset.tsx
index 4941b7e..76b7950 100644
--- a/lib/server/email/templates/password-reset.tsx
+++ b/lib/server/email/templates/password-reset.tsx
@@ -5,12 +5,13 @@ export type PasswordResetProps = {
   /** Full link to /admin/reset-password?token=… */
   resetUrl: string;
   userName?: string;
-  expiresInMinutes?: number;
+  /** From RESET_TOKEN_SECONDS (lib/server/auth/lifetimes.ts), the lifetime Better Auth enforces. */
+  expiresInMinutes: number;
 };
 
 export const passwordResetSubject = 'Đặt lại mật khẩu quản trị Furama Cuisine';
 
-export function PasswordResetEmail({ resetUrl, userName, expiresInMinutes = 60 }: PasswordResetProps) {
+export function PasswordResetEmail({ resetUrl, userName, expiresInMinutes }: PasswordResetProps) {
   return (
     <EmailLayout preview="Đặt lại mật khẩu quản trị Furama Cuisine">
       <Heading as="h1" style={emailStyles.heading}>Đặt lại mật khẩu</Heading>
```

```diff
diff --git a/lib/server/email/templates/staff-invitation.tsx b/lib/server/email/templates/staff-invitation.tsx
index cf78f07..700bfe2 100644
--- a/lib/server/email/templates/staff-invitation.tsx
+++ b/lib/server/email/templates/staff-invitation.tsx
@@ -6,14 +6,15 @@ export type StaffInvitationProps = {
   acceptUrl: string;
   role: 'admin' | 'editor';
   inviterName: string;
-  expiresInDays?: number;
+  /** From INVITE_TTL_DAYS (lib/server/auth/lifetimes.ts), the lifetime staff_invitation enforces. */
+  expiresInDays: number;
 };
 
 export const roleLabelVi = { admin: 'Quản trị viên', editor: 'Biên tập viên' } as const;
 
 export const staffInvitationSubject = 'Lời mời tham gia quản trị Furama Cuisine';
 
-export function StaffInvitationEmail({ acceptUrl, role, inviterName, expiresInDays = 7 }: StaffInvitationProps) {
+export function StaffInvitationEmail({ acceptUrl, role, inviterName, expiresInDays }: StaffInvitationProps) {
   const roleLabel = roleLabelVi[role];
   return (
     <EmailLayout preview={`${inviterName} mời bạn tham gia quản trị Furama Cuisine với vai trò ${roleLabel}`}>
```

Sửa `lib/admin/auth-errors.ts`:

```diff
diff --git a/lib/admin/auth-errors.ts b/lib/admin/auth-errors.ts
index 78b2df7..d9bca70 100644
--- a/lib/admin/auth-errors.ts
+++ b/lib/admin/auth-errors.ts
@@ -81,10 +81,13 @@ export function actionErrorMessage(code: ActionCode, params?: Record<string, str
  */
 const EMAIL_SETUP_ERRORS: Record<EmailErrorCode, boolean> = {
   invalid_delivery_mode: true,
-  missing_api_key: true,
+  missing_smtp_config: true,
   missing_from: true,
   missing_redirect_to: true,
+  missing_app_url: true,
   not_delivered: true,
+  // The recipient's server refused the address for good; the setup is fine.
+  rejected: false,
   provider_error: false,
 };
 
```

- [ ] **Bước 11: Chạy lại test**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/server/email lib/admin/auth-errors.test.ts test/integration/staff-auth.test.ts`
Expected: PASS `Test Files  5 passed (5)`, `Tests  97 passed (97)`

Run: `npm run typecheck && npm run lint 2>&1 | grep -c ': warning '`
Expected: typecheck không lỗi; `19`.

- [ ] **Bước 12: Kiểm rằng test bắt được việc bỏ STARTTLS bắt buộc (M6)**

Trong `lib/server/email/smtp.ts` đổi `requireTLS: !config.secure,` thành `requireTLS: false,`, chạy `npx vitest run lib/server/email/smtp.test.ts lib/server/email/email.test.ts`. Expected: `Tests  2 failed | 36 passed (38)`:

```
     × live builds the SMTP options from the env: STARTTLS required on 587, TLS from the first byte on 465, short timeouts 4ms
     × refuses to go on in clear when the server offers no STARTTLS: nothing is sent, no password crosses 120ms
AssertionError: expected { host: 'smtp.furama.test', …(9) } to deeply equal { host: 'smtp.furama.test', …(9) }
AssertionError: expected { mode: 'live', …(2) } to match object { code: 'provider_error' }
```

Trả dòng đó về `requireTLS: !config.secure,`.

- [ ] **Bước 13: README: biến SMTP và mục "Email (SMTP)"**

```diff
diff --git a/README.md b/README.md
index c89c689..365b9fc 100644
--- a/README.md
+++ b/README.md
@@ -9,7 +9,7 @@ with reservations persisted in Neon Postgres.
 - **Neon Postgres** via the Vercel Marketplace, reached with `pg` (node-postgres)
   on Fluid Compute per Neon's own guidance
 - **Better Auth** for staff sign-in (invitation only, Admin and Editor roles)
-  and **Resend** with react-email for the staff emails
+  and **SMTP** (nodemailer) with react-email for every email
 - Plain CSS with design tokens — the design is built on fluid `clamp()` values
   throughout, so the tokens mirror them directly rather than round-tripping
   through a utility framework
@@ -271,33 +271,68 @@ against an empty local database, and write the difference as a new migration.
 | Variable | Production | Preview | Local E2E / CI |
 | --- | --- | --- | --- |
 | `BETTER_AUTH_SECRET` | its own, 32+ random bytes | its own | a fresh `openssl rand -base64 32` |
-| `BETTER_AUTH_URL` | `https://<production domain>`, the origin of emailed links | the preview's own URL | `http://localhost:<port>` |
-| `EMAIL_DELIVERY` | `live` | `redirect` | `log` (also the default when unset) |
-| `EMAIL_REDIRECT_TO` | — | the team inbox that receives every preview email | — |
-| `EMAIL_FROM` | `Furama Cuisine <no-reply@mail.furamavietnam.com>` | same | — |
-| `RESEND_API_KEY` | the production key | a separate key | — |
+| `BETTER_AUTH_URL` | `https://<production domain>`, the origin of emailed links (required outside log mode) | the preview's own URL | `http://localhost:<port>` |
+| `EMAIL_DELIVERY` | `live` (Production only: the sender refuses it on a Preview and under `vercel dev`) | `redirect` | `log` (also the default when unset) |
+| `EMAIL_REDIRECT_TO` | — | the Admin's inbox, which receives every preview email | — |
+| `EMAIL_FROM` | `Furama Cuisine <no-reply@…>`, an address the SMTP login may send as | same | unset (log mode) |
+| `SMTP_HOST` | the provider's submission host | same | never set |
+| `SMTP_PORT` | `587` (STARTTLS, the default) or `465` (TLS) | same | never set |
+| `SMTP_SECURE` | only if the port rule does not fit: `true` (TLS from the first byte) or `false` (STARTTLS); unset means `true` on 465 only | same | never set |
+| `SMTP_USER`, `SMTP_PASSWORD` | the login (both or neither) | a separate login if the provider allows | never set |
+| `CRON_SECRET` | 16+ characters (`openssl rand -hex 32`); arrives with the outbox cron | optional | a fresh random value per E2E run |
 | `EMAIL_LOG_FILE` | never | never | a scratch file; log mode appends each email as one JSON line |
 | `BOOTSTRAP_ADMIN_EMAIL` | never (only in the shell that runs `scripts/create-admin.mjs`) | never | — |
 
-`EMAIL_DELIVERY` is read when an email is sent, never at build time; an
-unknown value throws instead of sending. On a Vercel deployment
-(`VERCEL_ENV=production` or `preview`) the log mode prints neither addresses
-nor links and writes no `EMAIL_LOG_FILE`, so the email reached no one: the
-send fails with `not_delivered`, and the staff screen says email is not set
-up on that environment instead of "Đã gửi lời mời.".
-
-### Resend
-
-Invitation and reset emails go straight to Resend (spec §10.4), from a
-subdomain of furamavietnam.com verified in Resend: IT adds the MX, SPF, DKIM
-and DMARC records Resend lists for `mail.furamavietnam.com` (check first
-whether the root domain already has a DMARC record), then `EMAIL_FROM` uses
-that subdomain. Until it is verified, keep `EMAIL_DELIVERY=redirect` (on a
-deployment, `log` sends nothing and every invitation is marked unsent).
-A failed invitation email leaves the invitation in place and the staff
-screen says "Chưa gửi được email, bấm Gửi lại" (or, for a setup problem such
-as `not_delivered` or a missing key, that email is not set up on this
-environment); a failed reset email is only logged.
+`EMAIL_DELIVERY` and the `SMTP_*` settings are read when an email is sent,
+never at build time; an unknown value throws instead of sending, and so does
+`live` where `VERCEL_ENV` is `preview` or `development`: a Preview runs on data
+forked from production, so only redirect may send there.
+`RESEND_API_KEY` is no longer read: remove it from every environment.
+
+On a Vercel deployment (`VERCEL_ENV=production` or `preview`) the log mode
+prints neither addresses nor links and writes no `EMAIL_LOG_FILE`, so the
+email reached no one: the send fails with `not_delivered`, and the staff
+screen says email is not set up on that environment instead of "Đã gửi lời
+mời.".
+
+### Email (SMTP)
+
+Every email goes through one gate, `lib/server/email/send.ts` (spec §10.4),
+and from there over a traditional SMTP account with nodemailer: port 587 with
+a mandatory STARTTLS upgrade (the client refuses to go on in clear), or 465
+with TLS from the first byte; TLS 1.2 or newer; each message on its own
+connection; per-step timeouts and a 30-second cap on a whole send. Only
+`lib/server/email/` may import nodemailer (a guard test checks it).
+
+- **Message-ID.** SMTP has no idempotency key. A staff email's Message-ID is
+  made from its key (`<invite-<id>-<hash>@<EMAIL_FROM domain>>`, never the
+  token), so a retry of the same send is recognisably the same message.
+- **Errors.** A recipient the server refuses for good (5xx at `RCPT TO`) is
+  `rejected`; anything else on the way (network, TLS, login, 4xx, a 5xx after
+  the message such as a sending quota, a timeout) is `provider_error`.
+  Addresses are removed from every stored error and log line, and the SMTP
+  server's host and IP address from every stored error (Editors read them in
+  the email log).
+- **Redirect.** `EMAIL_DELIVERY=redirect` sends every email to
+  `EMAIL_REDIRECT_TO`, with the real address in the subject and no Reply-To,
+  so answering a redirected email reaches neither a guest of the forked data
+  nor production's shared inbox.
+- **Links.** Emailed links use `BETTER_AUTH_URL`. Without it, a live or
+  redirected email, or any email on a Vercel deployment, fails with
+  `missing_app_url` instead of carrying a localhost link.
+- **Deliverability** (IT Furama): `EMAIL_FROM` must be an address the SMTP
+  login may send as; SPF must include the provider, DKIM must sign for the
+  From domain, and DMARC must align (check first whether the root domain
+  already has a DMARC record; start at `p=none`). Until that is done keep
+  `EMAIL_DELIVERY=redirect` (on a deployment, `log` sends nothing and every
+  invitation is marked unsent).
+
+A failed invitation email leaves the invitation in place and the staff screen
+says "Chưa gửi được email, bấm Gửi lại" (or, for a setup problem such as
+`not_delivered`, `missing_smtp_config` or `missing_app_url`, that email is not
+set up on this environment); a failed reset email is only logged. Tests reach
+SMTP only through `test/helpers/smtp-sink.ts`, an in-process server on
+`127.0.0.1`.
 
 ### First Admin
 
```

- [ ] **Bước 14: Chạy cổng kiểm tra**

Expected:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo;
- `Test Files  56 passed (56)`, `Tests  640 passed (640)`;
- `Applied 7 migration(s).`; build thoát 0 (Turbopack gói nodemailer vào chunk server, không cảnh báo, không cần `serverExternalPackages`); check-prerender như Task 1;
- E2E `118 passed` (lời mời và đặt lại mật khẩu của `admin-invite-reset.spec.ts` vẫn đọc link từ `EMAIL_LOG_FILE`); visual `8 passed`.

- [ ] **Bước 15: Commit**

```bash
git rm lib/server/email/resend-import.guard.test.ts
git add README.md lib/admin/auth-errors.test.ts lib/admin/auth-errors.ts lib/server/auth/config.ts lib/server/auth/lifetimes.ts lib/server/auth/staff.ts lib/server/email/auth-emails.ts lib/server/email/email.test.ts lib/server/email/mail-transport.guard.test.ts lib/server/email/send.ts lib/server/email/smtp.test.ts lib/server/email/smtp.ts lib/server/email/templates/password-reset.tsx lib/server/email/templates/staff-invitation.tsx lib/server/email/types.ts package-lock.json package.json test/helpers/smtp-sink.ts test/integration/staff-auth.test.ts
git commit -m "$(cat <<'EOF'
feat: send every email over SMTP instead of Resend

The project owner chose a traditional SMTP account over Resend (spec §10.4 as
amended). nodemailer replaces the Resend SDK behind the one EMAIL_DELIVERY
gate, for the staff invite and reset emails now and the booking outbox next:
587 with a mandatory STARTTLS upgrade or 465 with TLS, TLS 1.2+, one
connection per message, per-step timeouts and a 30-second cap on a send.
SMTP settings are read at send time, never at build. SMTP has no
idempotency key, so a send's key becomes its Message-ID; a recipient refused
with a 5xx at RCPT TO is `rejected`, anything else `provider_error`, and no
address survives into a stored error. Reply-To passes through.

Phase 3's deferred email items: appOrigin() fails closed with
missing_app_url outside log mode and on Vercel deployments instead of
emailing localhost links; deliverInvite keeps only the send in its try, so
a database hiccup after a sent invitation is logged, not reported as an
email failure; the invite and reset emails state INVITE_TTL_DAYS and
RESET_TOKEN_SECONDS, the lifetimes the server enforces; the Resend cast
goes with Resend.

Tests reach SMTP only through an in-process sink on 127.0.0.1. A guard keeps
nodemailer inside lib/server/email/, smtp-server inside test/, and resend
out. README: the SMTP variables and an Email (SMTP) section.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Hàng outbox trong transaction của thay đổi, và các ô email của nhân viên

Mỗi thay đổi đặt bàn cần báo tin ghi hàng `email_outbox` trên client của chính transaction của nó (spec §10.3–10.4, quy tắc code 1): email tồn tại đúng khi thay đổi tồn tại. Một hàng mỗi người nhận. Chưa gì được gửi: các hàng nằm `queued` cho tới Task 4. Màn admin có thêm ba ô của R8.

**Files:**
- Create: `lib/server/email/env.ts`, `lib/server/email/recipients.ts`, `lib/server/email/outbox.ts`, `test/integration/email-outbox.test.ts`
- Modify: `lib/server/booking/create.ts`, `lib/admin/booking-schemas.ts`, `lib/admin/booking-schemas.test.ts`, `app/admin/(shell)/reservations/actions.ts`, `app/admin/(shell)/reservations/[id]/TransitionPanel.tsx`, `app/admin/(shell)/_ui/AffectedList.tsx`, `app/admin/(shell)/reservations/new/NewReservationForm.tsx`, `e2e/admin-reservations.spec.ts`

**Interfaces:**
- Consumes: `ReservationEffects` (`afterTransition(client, { reservationId, transition, eventId, notifyGuest })`, `afterCreate(client, { reservationId, status, eventId, notifyGuest })`), `transitionReservation(pool, actor, input, { now?, effects? })`, `createStaffReservation(pool, actor, input, { now?, effects?, makeReference? })` của đợt 4 (`lib/server/booking/reservations.ts`); `Transition.guestEmail` (`lib/reservations/lifecycle.ts`); `GuestEmailEventName` (Task 1).
- Produces:
  - `lib/server/email/env.ts`: `type OutboxEnv = 'production' | 'preview' | 'development'`; `outboxEnv(env = process.env): OutboxEnv`.
  - `lib/server/email/recipients.ts`: `reachesSql(n, restaurantIdExpr, destinationExpr): string` (Task 6 thêm CRUD vào file này).
  - `lib/server/email/outbox.ts`: `queueGuestEmail(client, { reservationId, eventId, env, event, ackSetting? }): Promise<string[]>`; `queueStaffNew(client, { reservationId, eventId, env }): Promise<string[]>`; `queueWebBookingEmails(client, { reservationId, eventId, env, status }): Promise<string[]>`; `outboxEffects(env = outboxEnv()): Required<ReservationEffects> & { queued: string[] }`.
  - `lib/server/booking/create.ts`: `CreateOutcome` ok có thêm `outboxIds: string[]`.
  - `lib/admin/booking-schemas.ts`: `Checkbox` (zod: `'on'` → `true`, không có → `false`); `notifyGuest: boolean` trên `TransitionForm`, `NewReservationForm`, `CancelManyForm`.

- [ ] **Bước 1: Viết test tích hợp của hàng đợi**

Test gọi thẳng `createWebReservation`, `transitionReservation` và `createStaffReservation` trên pool riêng (8 kết nối), ghim từng câu của spec §10.3 và R4/R8/R13. Một bộ lọc địa chỉ viết `\s` trong template literal sẽ bỏ sót mọi địa chỉ có chữ `s` (lỗi spike outbox-core gặp), nên test đặt bàn với `sassy.susan@ses.example.com`.

Create `test/integration/email-outbox.test.ts`:

```ts
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebReservation } from '@/lib/server/booking/create';
import { parseReservationInput } from '@/lib/server/booking/input';
import { createStaffReservation, transitionReservation, type ReservationActor, type StaffBookingInput } from '@/lib/server/booking/reservations';
import { outboxEnv } from '@/lib/server/email/env';
import { outboxEffects } from '@/lib/server/email/outbox';
import { TEST_DATABASE_URL } from '../helpers/db';

/*
 * Spec §10.3–10.4 in the database: which change queues which email to whom,
 * written in the change's own transaction (one row per recipient). Nothing
 * here sends; the drain's half of this file arrives with the drain.
 */

let pool: Pool;
const LAN: ReservationActor = { id: 'staff-lan', label: 'Lan (lan@furama.test)' };
// Friday 2 Oct 2026, 10:00 in Vietnam. Tàya House (destination resort): Dinner 18:00–21:00.
const NOW = new Date('2026-10-02T10:00:00+07:00');
let phoneSeq = 0;
const nextPhone = () => `0905 ${String(200000 + ++phoneSeq).slice(0, 3)} ${String(200000 + phoneSeq).slice(3)}`;

async function guestBooking(over: Record<string, unknown> = {}) {
  const parsed = parseReservationInput({
    restaurant: 'taya-house', date: '2026-10-05', time: '19:00', guests: 2, name: 'Khách Web',
    phone: nextPhone(), email: 'guest@example.com', note: '', locale: 'en', ...over,
  });
  if (!parsed.ok) throw new Error(parsed.code);
  const result = await createWebReservation(parsed.value, { now: NOW, pool });
  if (!result.ok) throw new Error(result.code);
  return result;
}

const staffBooking = (over: Partial<StaffBookingInput> = {}): StaffBookingInput => ({
  restaurantId: 'taya-house', date: '2026-10-05', time: '19:30', guests: 2, name: 'Trần Văn Bình', phone: '0905 111 222',
  phoneE164: '+84905111222', email: 'binh@example.com', note: null, locale: 'vi', source: 'phone', overCapacityReason: null,
  notifyGuest: true, ...over,
});

type Row = { id: string; event: string; audience: string; to_email: string; locale: string; fallback: boolean; status: string; attempts: number };
const outbox = async (where = 'true', values: unknown[] = []): Promise<Row[]> =>
  (await pool.query(`SELECT id::text, event, audience, to_email, locale, fallback, status, attempts FROM email_outbox WHERE ${where} ORDER BY id`, values)).rows;
const recipient = (over: Record<string, unknown>) => {
  const r = { scope: 'all', email: 'all@furama.test', ...over };
  const cols = Object.keys(r);
  return pool.query(`INSERT INTO notification_recipients (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(r));
};

describe.skipIf(!TEST_DATABASE_URL)('email outbox (database)', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 8 });
  });
  afterAll(async () => {
    // Leave no recipient behind: the next file's bookings would email them instead of the general inbox.
    await pool.query('TRUNCATE email_outbox, notification_recipients');
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE reservations, reservation_events, reservation_notes, closures, email_outbox, notification_recipients CASCADE');
    await pool.query('UPDATE restaurants SET booking_enabled = true, window_days = NULL, lead_minutes = NULL, max_party = NULL, auto_confirm = NULL');
    await pool.query('UPDATE booking_settings SET window_days = 14, lead_minutes = 30, same_day_cutoff = NULL, max_party = 12, auto_confirm = false, guest_ack_email = true');
    await pool.query(`UPDATE site_settings SET email = 'fb@furamavietnam.com'`);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('queueing, in the transaction of the change', () => {
    it('a web booking queues staff.new for the restaurant, destination and all recipients (deduplicated), and guest.ack', async () => {
      await recipient({ scope: 'restaurant', restaurant_id: 'taya-house', email: 'taya@furama.test', locale: 'en' });
      await recipient({ scope: 'destination', destination_id: 'resort', email: 'Resort@Furama.test' });
      await recipient({ scope: 'all', email: 'resort@furama.test', locale: 'en' }); // the same inbox as above, another case
      await recipient({ scope: 'all', email: 'gm@furama.test' });
      await recipient({ scope: 'destination', destination_id: 'mm', email: 'mm@furama.test' }); // another destination
      await recipient({ scope: 'restaurant', restaurant_id: 'the-fan', email: 'fan@furama.test' }); // another restaurant
      await recipient({ scope: 'all', email: 'off@furama.test', active: false });

      const result = await guestBooking();
      const rows = await outbox();
      expect(rows.map(({ event, audience, to_email, locale, fallback, status, attempts }) => ({ event, audience, to_email, locale, fallback, status, attempts }))).toEqual([
        { event: 'staff.new', audience: 'staff', to_email: 'gm@furama.test', locale: 'vi', fallback: false, status: 'queued', attempts: 0 },
        // The destination row wins over the 'all' row for the same inbox: its spelling, its language.
        { event: 'staff.new', audience: 'staff', to_email: 'Resort@Furama.test', locale: 'vi', fallback: false, status: 'queued', attempts: 0 },
        { event: 'staff.new', audience: 'staff', to_email: 'taya@furama.test', locale: 'en', fallback: false, status: 'queued', attempts: 0 },
        { event: 'guest.ack', audience: 'guest', to_email: 'guest@example.com', locale: 'en', fallback: false, status: 'queued', attempts: 0 },
      ]);
      expect(result.outboxIds).toEqual(rows.map((r) => r.id));
      // Every row points at the booking and the created event of the same transaction, in this env.
      const links = await pool.query(
        `SELECT DISTINCT o.env, o.reservation_id::text AS r, e.type FROM email_outbox o JOIN reservation_events e ON e.id = o.reservation_event_id`,
      );
      expect(links.rows).toEqual([{ env: 'development', r: result.id, type: 'created' }]);
    });

    it('no recipient for the restaurant: staff.new goes to the general email (site_settings), in Vietnamese, marked fallback', async () => {
      await recipient({ scope: 'restaurant', restaurant_id: 'the-fan', email: 'fan@furama.test' });
      await pool.query(`UPDATE site_settings SET email = 'contact@furama.test'`);
      await guestBooking({ email: '' });
      expect(await outbox()).toMatchObject([{ event: 'staff.new', to_email: 'contact@furama.test', locale: 'vi', fallback: true }]);
    });

    it('guest.ack only while guest_ack_email is on; an auto-confirmed booking gets guest.confirmed instead; no address, no guest row', async () => {
      await pool.query('UPDATE booking_settings SET guest_ack_email = false');
      await guestBooking();
      expect((await outbox(`audience = 'guest'`)).length).toBe(0);
      await pool.query(`UPDATE booking_settings SET guest_ack_email = true; UPDATE restaurants SET auto_confirm = true WHERE id = 'taya-house'`);
      await guestBooking({ time: '19:30', locale: 'vi' });
      expect(await outbox(`audience = 'guest'`)).toMatchObject([{ event: 'guest.confirmed', locale: 'en' }]); // vi is not enabled: the booking is in en
      await guestBooking({ time: '20:00', email: '' });
      expect((await outbox(`audience = 'guest'`)).length).toBe(1);
    });

    it('an address the outbox would refuse (two @) never fails the booking: it books, without a guest email (R13)', async () => {
      const odd = await guestBooking({ email: 'an@home@example.com' });
      expect(odd.ok).toBe(true);
      expect((await outbox()).map((r) => r.event)).toEqual(['staff.new']);
      // A plain address full of letters a broken pattern could trip on ("s" for \s) is queued.
      await guestBooking({ time: '19:30', email: 'sassy.susan@ses.example.com' });
      expect(await outbox(`audience = 'guest'`)).toMatchObject([{ to_email: 'sassy.susan@ses.example.com' }]);
    });

    it('a refused booking (duplicate) queues nothing', async () => {
      await guestBooking({ phone: '0905 777 777' });
      const parsed = parseReservationInput({ restaurant: 'taya-house', date: '2026-10-05', time: '19:00', guests: 2, name: 'Khách Web', phone: '0905 777 777', email: 'x@example.com', note: '', locale: 'en' });
      if (!parsed.ok) throw new Error(parsed.code);
      expect(await createWebReservation(parsed.value, { now: NOW, pool })).toEqual({ ok: false, code: 'duplicate' });
      expect((await outbox()).map((r) => r.to_email)).toEqual(['fb@furamavietnam.com', 'guest@example.com']);
    });

    it('transitions (spec §10.3): confirm and decline always email the guest; cancel only with "Báo khách"; seated never', async () => {
      const move = async (id: string, to: string, notifyGuest: boolean, reason: string | null = null) => {
        const { rows } = await pool.query('SELECT version FROM reservations WHERE id = $1', [id]);
        const effects = outboxEffects('development');
        const result = await transitionReservation(pool, LAN, { id, version: rows[0].version, to: to as never, reason, notifyGuest }, { now: NOW, effects });
        expect(result.ok).toBe(true);
        return effects.queued;
      };
      const a = await guestBooking();
      const b = await guestBooking({ time: '19:30' });
      const c = await guestBooking({ time: '20:00' });
      await pool.query('DELETE FROM email_outbox');

      const confirmed = await move(a.id, 'confirmed', false);
      expect(await outbox()).toMatchObject([{ id: confirmed[0], event: 'guest.confirmed', to_email: 'guest@example.com' }]);
      expect(await move(b.id, 'declined', false, 'Kín bàn')).toHaveLength(1);
      expect(await move(c.id, 'cancelled', false, 'Khách gọi hủy')).toEqual([]);
      expect(await move(a.id, 'cancelled', true, 'Khách gọi hủy')).toHaveLength(1);
      expect((await outbox()).map((r) => r.event)).toEqual(['guest.confirmed', 'guest.declined', 'guest.cancelled']);
      // "Đã đến" sends nothing.
      const d = await guestBooking({ time: '18:00' });
      await pool.query('DELETE FROM email_outbox WHERE reservation_id = $1', [d.id]);
      await move(d.id, 'confirmed', false);
      await pool.query(`UPDATE reservations SET reserved_on = '2026-10-02', reserved_at = '10:30' WHERE id = $1`, [d.id]);
      expect(await move(d.id, 'seated', true)).toEqual([]);
    });

    it('staff bookings (R8): a phone booking with "Gửi email xác nhận" gets guest.confirmed; unticked, or a walk-in, nothing', async () => {
      const make = async (over: Partial<StaffBookingInput>) => {
        const effects = outboxEffects('development');
        const result = await createStaffReservation(pool, LAN, staffBooking(over), { now: NOW, effects });
        expect(result.ok).toBe(true);
        return effects.queued;
      };
      expect(await make({})).toHaveLength(1);
      expect(await make({ time: '20:00', phone: '0905 111 223', phoneE164: '+84905111223', notifyGuest: false })).toEqual([]);
      expect(await make({ source: 'walk_in', date: '2026-10-02', time: '12:00', phone: '0905 111 224', phoneE164: '+84905111224' })).toEqual([]);
      // staff.new is for web bookings only (R4): staff do not tell themselves.
      expect(await outbox()).toMatchObject([{ event: 'guest.confirmed', to_email: 'binh@example.com', locale: 'vi' }]);
    });

    it('a hook that fails rolls back the booking change and its rows together', async () => {
      const a = await guestBooking();
      await pool.query('DELETE FROM email_outbox');
      const { rows } = await pool.query('SELECT version FROM reservations WHERE id = $1', [a.id]);
      const effects = outboxEffects('development');
      const failing = {
        ...effects,
        afterTransition: async (...args: Parameters<typeof effects.afterTransition>) => {
          await effects.afterTransition(...args);
          throw new Error('boom after the outbox insert');
        },
      };
      await expect(
        transitionReservation(pool, LAN, { id: a.id, version: rows[0].version, to: 'confirmed', reason: null, notifyGuest: false }, { now: NOW, effects: failing }),
      ).rejects.toThrow('boom');
      expect(effects.queued).toHaveLength(1); // an id that was never committed: the drain will not find it
      expect(await outbox()).toEqual([]);
      expect((await pool.query('SELECT status FROM reservations WHERE id = $1', [a.id])).rows[0].status).toBe('requested');
    });

    it('writes the env of the process: VERCEL_ENV, development off Vercel', async () => {
      expect(outboxEnv({})).toBe('development');
      expect(outboxEnv({ VERCEL_ENV: 'development' })).toBe('development');
      expect(outboxEnv({ VERCEL_ENV: 'preview' })).toBe('preview');
      expect(outboxEnv({ VERCEL_ENV: 'production' })).toBe('production');
      vi.stubEnv('VERCEL_ENV', 'preview');
      try {
        await guestBooking({ email: '' });
        const effects = outboxEffects();
        await createStaffReservation(pool, LAN, staffBooking({ time: '20:30', phone: '0905 111 225', phoneE164: '+84905111225' }), { now: NOW, effects });
      } finally {
        vi.unstubAllEnvs();
      }
      expect((await pool.query(`SELECT DISTINCT env FROM email_outbox`)).rows).toEqual([{ env: 'preview' }]);
    });
  });
});
```

Sửa `lib/admin/booking-schemas.test.ts`:

```diff
diff --git a/lib/admin/booking-schemas.test.ts b/lib/admin/booking-schemas.test.ts
index e1ea3ec..b889c78 100644
--- a/lib/admin/booking-schemas.test.ts
+++ b/lib/admin/booking-schemas.test.ts
@@ -20,8 +20,11 @@ describe('booking form schemas', () => {
       version: 3,
       to: 'confirmed',
       reason: null,
+      notifyGuest: false,
     });
     expect(TransitionForm.parse({ id: '12', version: '3', to: 'cancelled', reason: '  Khách hủy  ' }).reason).toBe('Khách hủy');
+    // "Báo khách": a ticked checkbox posts "on"; an unticked one posts nothing.
+    expect(TransitionForm.parse({ id: '12', version: '3', to: 'cancelled', reason: 'x', notifyGuest: 'on' }).notifyGuest).toBe(true);
     expect(TransitionForm.safeParse({ id: '12', version: '0', to: 'eaten', reason: '' }).success).toBe(false);
   });
 
@@ -55,7 +58,10 @@ describe('booking form schemas', () => {
       guests: 30,
       email: null,
       overCapacityReason: 'Đã gọi bếp',
+      notifyGuest: false,
     });
+    // "Gửi email xác nhận" (R8): on by default in the form, so a phone booking usually posts "on".
+    expect(NewReservationForm.parse({ ...base, notifyGuest: 'on' }).notifyGuest).toBe(true);
     expect(NewReservationForm.safeParse({ ...base, restaurant: 'x;drop', source: 'web', locale: '' }).error?.flatten().fieldErrors).toEqual({
       restaurant: [expect.any(String)],
       source: ['Chọn nguồn đặt bàn.'],
@@ -99,7 +105,8 @@ describe('booking form schemas', () => {
   });
 
   it('a batch cancel: ticked id:version pairs and a reason', () => {
-    expect(CancelManyForm.parse({ items: ['12:3', '7:1'], reason: ' Đóng cửa ' })).toEqual({ items: ['12:3', '7:1'], reason: 'Đóng cửa' });
+    expect(CancelManyForm.parse({ items: ['12:3', '7:1'], reason: ' Đóng cửa ' })).toEqual({ items: ['12:3', '7:1'], reason: 'Đóng cửa', notifyGuest: false });
+    expect(CancelManyForm.parse({ items: ['12:3'], reason: 'x', notifyGuest: 'on' }).notifyGuest).toBe(true);
     expect(CancelManyForm.safeParse({ items: [], reason: '' }).error?.flatten().fieldErrors).toEqual({
       items: ['Chọn ít nhất một đặt bàn.'],
       reason: ['Nhập lý do hủy.'],
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/email-outbox.test.ts lib/admin/booking-schemas.test.ts`
Expected: FAIL `Test Files  2 failed (2)`, `Tests  3 failed | 8 passed (11)`:

```
 ❯ test/integration/email-outbox.test.ts (0 test)
 ❯ lib/admin/booking-schemas.test.ts (11 tests | 3 failed) 17ms
     × reads a field the form did not render (undefined, not "") as blank: the inbox "Xác nhận" sends no reason 5ms
     × a staff booking: the source, the guest’s language, and the restaurant as an id 2ms
     × a batch cancel: ticked id:version pairs and a reason 1ms
 FAIL  test/integration/email-outbox.test.ts [ test/integration/email-outbox.test.ts ]
Error: Cannot find package '@/lib/server/email/env' imported from …/test/integration/email-outbox.test.ts
 FAIL  lib/admin/booking-schemas.test.ts > booking form schemas > reads a field the form did not render (undefined, not "") as blank: the inbox "Xác nhận" sends no reason
AssertionError: expected { id: '12', version: 3, …(2) } to deeply equal { id: '12', version: 3, …(3) }
```

- [ ] **Bước 3: Viết E2E của các ô email**

Thêm vào `e2e/admin-reservations.spec.ts` một test: "Báo khách" bật sẵn, câu nhắc lý do hiện khi ô bật và ẩn khi bỏ; hủy với ô bật đưa `guest.cancelled` vào hàng; trang "Tạo đặt bàn" của Tàya House hôm nay (không ghi gì) ẩn "Gửi email xác nhận" khi chọn khách vãng lai. Test không kiểm `status` của hàng outbox: từ Task 4 `after()` gửi nó ngay.

```diff
diff --git a/e2e/admin-reservations.spec.ts b/e2e/admin-reservations.spec.ts
index ee94118..55b3346 100644
--- a/e2e/admin-reservations.spec.ts
+++ b/e2e/admin-reservations.spec.ts
@@ -10,7 +10,7 @@ import { STAFF, expect, newVisitor, one, seedStaff, signInAs, test } from './sta
  * no-show work, with the time windows and the version conflict of §10.3;
  * the inbox search; an edit re-checked against capacity; a phone booking
  * past capacity; a phone booking at the restaurant and date the picker
- * shows; the printable day sheet. The admin CSP stays clean (no inline
+ * shows; the printable day sheet; the guest-email checkboxes of phase 5. The admin CSP stays clean (no inline
  * styles). Tàya House at +3, +4, +6 (one booking outside the hours) and
  * yesterday, V-Senses Cafe at +8, ChaoShan Hotpot at +7, Café Indochine at
  * +6: dates no other spec books there. The tests that count covers (Tàya
@@ -66,6 +66,37 @@ test('cancel needs a reason; the reason is kept and shown', async ({ page }) =>
   expect(await reservationRow(r.id)).toMatchObject({ status: 'cancelled', status_reason: 'Khách gọi báo hủy' });
 });
 
+test('the guest emails staff choose (R8): "Báo khách" is on for a cancel and says the reason goes out; "Gửi email xác nhận" is for a phone booking only', async ({ page }) => {
+  const r = await seedReservation({ status: 'confirmed' });
+  const guest = `cancel-${r.id}@example.com`;
+  await one(`UPDATE reservations SET email = $2 WHERE id = $1`, [r.id, guest]);
+  await signInAs(page, STAFF.editor);
+  await page.goto(`/admin/reservations/${r.id}`);
+  await expectHydrated(page);
+  const notify = main(page).getByRole('checkbox', { name: 'Báo khách qua email khi hủy' });
+  const hint = main(page).getByText('Lý do này sẽ được gửi cho khách.');
+  await expect(notify).toBeChecked();
+  await expect(hint).toBeVisible();
+  await notify.uncheck();
+  await expect(hint).toBeHidden();
+  await notify.check();
+  await page.getByLabel('Lý do (bắt buộc khi hủy hoặc từ chối)', { exact: true }).fill('Nhà hàng có tiệc riêng');
+  await main(page).getByRole('button', { name: 'Hủy', exact: true }).click();
+  await expect(page.getByRole('heading', { level: 1 })).toContainText('Đã hủy');
+  expect(await one(`SELECT event, to_email FROM email_outbox WHERE reservation_id = $1`, [r.id])).toEqual({ event: 'guest.cancelled', to_email: guest });
+
+  // Nothing is booked below: the form only shows or hides the box.
+  await page.goto('/admin/reservations/new?nha_hang=taya-house');
+  await expectHydrated(page);
+  const form = page.getByRole('form', { name: 'Đặt bàn mới' });
+  const confirmEmail = form.getByRole('checkbox', { name: 'Gửi email xác nhận cho khách (khi có email)' });
+  await expect(confirmEmail).toBeChecked();
+  await form.getByRole('radio', { name: 'Khách vãng lai (đã đến)' }).check();
+  await expect(confirmEmail).toBeHidden();
+  await form.getByRole('radio', { name: 'Điện thoại (đã xác nhận)' }).check();
+  await expect(confirmEmail).toBeChecked();
+});
+
 test('no-show only once the sitting is 15 minutes past; the correction only on the same service day', async ({ page }) => {
   const future = await seedReservation({ status: 'confirmed', date: venueDay(3) });
   const past = await seedReservation({ status: 'confirmed', date: venueDay(-1), time: '19:00' });
```

- [ ] **Bước 4: Build code hiện tại và chạy test E2E mới: phải đỏ**

Cất tạm các file ngoài `e2e/` của bước 1 (test tích hợp import module chưa có, mà `next build` typecheck cả test), build, rồi chạy `e2e/admin-reservations.spec.ts --project=desktop -g "guest emails staff choose"`.

Expected: `1 failed`:

```
  ✘  1 [desktop] › e2e/admin-reservations.spec.ts:69:5 › the guest emails staff choose (R8): "Báo khách" is on for a cancel and says the reason goes out; "Gửi email xác nhận" is for a phone booking only (5.7s)
    Error: expect(locator).toBeChecked() failed
    Locator: getByRole('main').getByRole('checkbox', { name: 'Báo khách qua email khi hủy' })
    Error: element(s) not found
```

Lấy lại các file đã cất.

- [ ] **Bước 5: Viết env, điều kiện người nhận và hàng đợi**

Create `lib/server/email/env.ts`:

```ts
import 'server-only';

/*
 * The environment an outbox row belongs to (spec §10.4: "Cột env lấy từ
 * VERCEL_ENV; không có thì là development"). The writer stamps it, every
 * sender and every admin read filters on it, so a Preview branch forked from
 * production never sends or shows production's queue. The one helper for the
 * queue, the drain, the email log and the overview (code rule 4).
 */
export type OutboxEnv = 'production' | 'preview' | 'development';

export function outboxEnv(env: Record<string, string | undefined> = process.env): OutboxEnv {
  const value = env.VERCEL_ENV;
  return value === 'production' || value === 'preview' ? value : 'development';
}
```

Create `lib/server/email/recipients.ts` (một định nghĩa duy nhất của "người nhận này với tới đặt bàn này", C7; Task 6 thêm CRUD và danh sách nhà hàng chưa có người nhận):

```ts
import 'server-only';

/**
 * SQL: notification_recipients row `n` reaches a booking at the restaurant
 * whose id and destination are the given SQL expressions: a row for that
 * restaurant, for its destination (restaurants.destination), or for 'all'
 * (spec §10.4, R4). The one definition: the queue (outbox.ts queueStaffNew)
 * and the overview's "Nhà hàng chưa có người nhận thông báo" both use it, so
 * they can never disagree about who hears about a booking. Callers add
 * `n.active AND 'staff.new' = ANY (n.events)`.
 */
export const reachesSql = (n: string, restaurantId: string, destination: string): string =>
  `(${n}.scope = 'all' OR (${n}.scope = 'destination' AND ${n}.destination_id = ${destination})` +
  ` OR (${n}.scope = 'restaurant' AND ${n}.restaurant_id = ${restaurantId}))`;
```

Create `lib/server/email/outbox.ts`. `queueStaffNew` là một câu `INSERT … SELECT` duy nhất: hợp ba phạm vi, `DISTINCT ON (lower(email))` với phạm vi hẹp nhất thắng, và nhánh `UNION ALL` tới `site_settings` khi không ai khớp, nên không có người nhận không bao giờ là "không hàng nào" hay lỗi. Hàng khách chỉ được chèn khi địa chỉ khớp CHECK của outbox (R13).

```ts
import 'server-only';
import type { PoolClient } from 'pg';
import type { GuestEmailEventName } from '@/lib/email/events';
import type { ReservationEffects } from '@/lib/server/booking/reservations';
import { outboxEnv, type OutboxEnv } from './env';
import { reachesSql } from './recipients';

/*
 * Writing email_outbox rows (spec §10.4): always on the client of the
 * transaction that changes the booking, so the email exists exactly when the
 * change does (code rule 1: only this file writes outbox rows). One row per
 * recipient. Nothing here sends; drain.ts does, after COMMIT.
 *
 * Nothing a guest can send may make these inserts fail, or the booking would
 * fail with them (spec §12): the guest address is filtered before the CHECK,
 * locales come from rows that already passed their FK, and no recipient means
 * one fallback row, never an error. SQL in these template literals spells
 * whitespace [:space:]: a backslash class would lose its backslash.
 */

type Queue = { reservationId: string; eventId: string; env: OutboxEnv };

/**
 * One guest row, to the address and in the language stored on the booking;
 * none when the booking has no email, or one email_outbox would refuse (the
 * guest form lets "a@b@c.vn" through; R13). `ackSetting`: only while "Cài đặt
 * đặt bàn" keeps guest_ack_email on, read in the same transaction.
 */
export async function queueGuestEmail(
  client: PoolClient,
  { reservationId, eventId, env, event, ackSetting = false }: Queue & { event: GuestEmailEventName; ackSetting?: boolean },
): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO email_outbox (env, event, audience, reservation_id, reservation_event_id, to_email, locale)
     SELECT $1, $2, 'guest', r.id, $4, r.email, r.locale
       FROM reservations r
      WHERE r.id = $3 AND r.email ~ '^[^@[:space:]]+@[^@[:space:]]+$' AND length(r.email) <= 254
        AND (NOT $5 OR (SELECT guest_ack_email FROM booking_settings))
     RETURNING id::text`,
    [env, event, reservationId, eventId, ackSetting],
  );
  return rows.map((r) => r.id);
}

/**
 * staff.new to the union of the active recipients of the booking's
 * restaurant, its destination and 'all', one row per address (case-folded;
 * the most specific scope's spelling and language win). When nobody matches,
 * one row to site_settings.email in Vietnamese, marked fallback (the overview
 * names the restaurants that have no recipient).
 */
export async function queueStaffNew(client: PoolClient, { reservationId, eventId, env }: Queue): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    `WITH booking AS (
       SELECT r.id, r.restaurant_id, rest.destination
         FROM reservations r JOIN restaurants rest ON rest.id = r.restaurant_id
        WHERE r.id = $2
     ),
     matched AS (
       SELECT DISTINCT ON (lower(n.email)) n.email, n.locale
         FROM notification_recipients n, booking b
        WHERE n.active AND 'staff.new' = ANY (n.events) AND ${reachesSql('n', 'b.restaurant_id', 'b.destination')}
        ORDER BY lower(n.email), CASE n.scope WHEN 'restaurant' THEN 0 WHEN 'destination' THEN 1 ELSE 2 END, n.id
     ),
     chosen AS (
       SELECT email, locale, false AS fallback FROM matched
       UNION ALL
       SELECT s.email, 'vi', true FROM site_settings s WHERE NOT EXISTS (SELECT 1 FROM matched)
     )
     INSERT INTO email_outbox (env, event, audience, reservation_id, reservation_event_id, to_email, locale, fallback)
     SELECT $1, 'staff.new', 'staff', b.id, $3, c.email, c.locale, c.fallback
       FROM chosen c, booking b
     RETURNING id::text`,
    [env, reservationId, eventId],
  );
  return rows.map((r) => r.id);
}

/**
 * A guest's booking from the web form (spec §10.2 step 6, §10.3 first row):
 * staff.new, then guest.confirmed when auto-confirmed, or guest.ack when the
 * request waits and guest_ack_email is on.
 */
export async function queueWebBookingEmails(client: PoolClient, queue: Queue & { status: 'requested' | 'confirmed' }): Promise<string[]> {
  const staff = await queueStaffNew(client, queue);
  const guest =
    queue.status === 'confirmed'
      ? await queueGuestEmail(client, { ...queue, event: 'guest.confirmed' })
      : await queueGuestEmail(client, { ...queue, event: 'guest.ack', ackSetting: true });
  return [...staff, ...guest];
}

/**
 * The phase-4 hooks (lib/server/booking/reservations.ts) made to queue email
 * (spec §10.3, R8). `queued` collects the new row ids for the drain: read it
 * only after the call resolved ok; a rolled-back transaction leaves ids that
 * no longer exist, which the drain simply does not find. staff.new is for web
 * bookings only (R4): staff do not tell themselves.
 */
export function outboxEffects(env: OutboxEnv = outboxEnv()): Required<ReservationEffects> & { queued: string[] } {
  const queued: string[] = [];
  return {
    queued,
    async afterTransition(client, { reservationId, transition, eventId, notifyGuest }) {
      const guest = transition.guestEmail;
      if (!guest || (guest.when === 'if_notify' && !notifyGuest)) return;
      queued.push(...(await queueGuestEmail(client, { reservationId, eventId, env, event: guest.event })));
    },
    async afterCreate(client, { reservationId, status, eventId, notifyGuest }) {
      // "Gửi email xác nhận" is for a phone booking (confirmed); a walk-in is already at the table (R8).
      if (!notifyGuest || status !== 'confirmed') return;
      queued.push(...(await queueGuestEmail(client, { reservationId, eventId, env, event: 'guest.confirmed' })));
    },
  };
}
```

- [ ] **Bước 6: Đặt bàn của khách ghi hàng outbox trong transaction của nó**

Sửa `lib/server/booking/create.ts`:

```diff
diff --git a/lib/server/booking/create.ts b/lib/server/booking/create.ts
index 2ae6b6c..a813171 100644
--- a/lib/server/booking/create.ts
+++ b/lib/server/booking/create.ts
@@ -4,6 +4,8 @@ import { getPool } from '@/db/client';
 import { resolveDay } from '@/lib/booking/resolve-day';
 import { slotVerdict } from '@/lib/booking/slot-code';
 import type { BookingErrorCode } from '@/lib/booking-errors';
+import { outboxEnv } from '@/lib/server/email/env';
+import { queueWebBookingEmails } from '@/lib/server/email/outbox';
 import { newReference } from '@/lib/server/reference';
 import { venueNow, type IsoDate } from '@/lib/venue-time';
 import type { ReservationRequest } from './input';
@@ -13,12 +15,13 @@ import { loadBookedCovers, loadRestaurantRules } from './rules';
 /*
  * Step 6 of submitReservation (spec §10.2): one transaction that takes the
  * booking-day lock, re-reads the rules and the covers, re-runs resolveDay,
- * and inserts the booking with its 'created' event. The outbox rows of step 6
- * and after() of step 7 arrive in phase 5.
+ * and inserts the booking with its 'created' event and its email_outbox rows
+ * (staff.new, then guest.ack or guest.confirmed). Nothing is sent here; the
+ * action drains `outboxIds` once this has committed (step 7).
  */
 
 export type CreateOutcome =
-  | { ok: true; id: string; reference: string; date: IsoDate; status: 'requested' | 'confirmed' }
+  | { ok: true; id: string; reference: string; date: IsoDate; status: 'requested' | 'confirmed'; outboxIds: string[] }
   | { ok: false; code: BookingErrorCode; params?: Record<string, string> };
 
 export type CreateOptions = {
@@ -113,9 +116,10 @@ async function insertInTransaction(client: PoolClient, input: ReservationRequest
     ],
   );
   const id = rows[0].id;
-  await client.query(`INSERT INTO reservation_events (reservation_id, actor_kind, type, to_status) VALUES ($1, 'guest', 'created', $2)`, [
-    id,
-    status,
-  ]);
-  return { ok: true, id, reference, date: input.date, status };
+  const event = await client.query<{ id: string }>(
+    `INSERT INTO reservation_events (reservation_id, actor_kind, type, to_status) VALUES ($1, 'guest', 'created', $2) RETURNING id::text`,
+    [id, status],
+  );
+  const outboxIds = await queueWebBookingEmails(client, { reservationId: id, eventId: event.rows[0].id, env: outboxEnv(), status });
+  return { ok: true, id, reference, date: input.date, status, outboxIds };
 }
```

- [ ] **Bước 7: Ô "Báo khách" và "Gửi email xác nhận"**

`Checkbox` dùng chung thay bốn chỗ `z.preprocess((v) => v === 'on', z.boolean())` cũ. Sửa `lib/admin/booking-schemas.ts`:

```diff
diff --git a/lib/admin/booking-schemas.ts b/lib/admin/booking-schemas.ts
index 0d7c520..ceeaf36 100644
--- a/lib/admin/booking-schemas.ts
+++ b/lib/admin/booking-schemas.ts
@@ -26,11 +26,16 @@ export const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'Ch
 /** A reason staff write: at most 500 characters (reservation_events.reason); blank = none. */
 export const Reason = z.preprocess(blankToNull, z.string().trim().max(500, { error: 'Lý do tối đa 500 ký tự.' }).nullable());
 
+/** An HTML checkbox: "on" when ticked, no entry at all when not. */
+export const Checkbox = z.preprocess((v) => v === 'on', z.boolean());
+
 export const TransitionForm = z.object({
   id: Id,
   version: Version,
   to: z.enum(RESERVATION_STATUSES),
   reason: Reason,
+  /** "Báo khách qua email khi hủy" (spec §10.3, R8); confirm and decline always email a guest who gave an address. */
+  notifyGuest: Checkbox,
 });
 
 /** The guest's details as staff type them; the limits are the guest form's (lib/server/booking/input.ts). */
@@ -62,6 +67,8 @@ export const NewReservationForm = z.object({
   time: Time,
   source: z.enum(['phone', 'walk_in'], { error: 'Chọn nguồn đặt bàn.' }),
   locale: z.string().regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/, { error: 'Chọn ngôn ngữ của khách.' }),
+  /** "Gửi email xác nhận" (spec §10.3, R8): a phone booking with an email; a walk-in never gets one. */
+  notifyGuest: Checkbox,
   ...GuestFields,
 });
 
@@ -72,6 +79,8 @@ export const CancelManyForm = z.object({
     .min(1, { error: 'Chọn ít nhất một đặt bàn.' })
     .max(200),
   reason: z.string().trim().min(1, { error: 'Nhập lý do hủy.' }).max(500, { error: 'Lý do tối đa 500 ký tự.' }),
+  /** "Báo khách qua email" under an affected list (R8): on by default, like a single cancel. */
+  notifyGuest: Checkbox,
 });
 
 /** A per-restaurant override: blank follows "Cài đặt đặt bàn"; the bounds are migration 006's. */
@@ -89,7 +98,7 @@ const override = (min: number, max: number, label: string) =>
 export const RulesForm = z.object({
   restaurant: RestaurantId,
   token: Token,
-  bookingEnabled: z.preprocess((v) => v === 'on', z.boolean()),
+  bookingEnabled: Checkbox,
   windowDays: override(1, 90, 'Số ngày đặt trước'),
   leadMinutes: override(0, 1440, 'Đặt trước tối thiểu (phút)'),
   maxParty: override(1, 50, 'Số khách tối đa'),
@@ -157,8 +166,8 @@ export const SettingsForm = z.object({
   leadMinutes: bounded(0, 1440, 'Từ 0 đến 1440 phút.', 'Nhập số phút (0 nếu không cần đặt trước).'),
   sameDayCutoff: z.preprocess(blankToNull, Time.nullable()),
   maxParty: bounded(1, 50, 'Từ 1 đến 50 khách.', 'Nhập số khách (từ 1 đến 50).'),
-  autoConfirm: z.preprocess((v) => v === 'on', z.boolean()),
-  guestAckEmail: z.preprocess((v) => v === 'on', z.boolean()),
+  autoConfirm: Checkbox,
+  guestAckEmail: Checkbox,
   piiRetentionMonths: bounded(1, 120, 'Từ 1 đến 120 tháng.', 'Nhập số tháng (từ 1 đến 120).'),
 });
 
@@ -171,7 +180,7 @@ export const ClosureForm = z
     startsOn: IsoDay,
     endsOn: IsoDay,
     meals: z.array(Meal).max(4),
-    showReason: z.preprocess((v) => v === 'on', z.boolean()),
+    showReason: Checkbox,
     reasonEn: z.preprocess(blankToNull, z.string().trim().max(160, { error: 'Tối đa 160 ký tự.' }).nullable()),
     reasonVi: z.preprocess(blankToNull, z.string().trim().max(160, { error: 'Tối đa 160 ký tự.' }).nullable()),
     internalNote: z.preprocess(blankToNull, z.string().trim().max(2000, { error: 'Tối đa 2000 ký tự.' }).nullable()),
```

Action truyền `notifyGuest` và `outboxEffects()` (chưa gửi; Task 4 thêm `drainAfterCommit`). Sửa `app/admin/(shell)/reservations/actions.ts`:

```diff
diff --git a/app/admin/(shell)/reservations/actions.ts b/app/admin/(shell)/reservations/actions.ts
index dbe8346..886f919 100644
--- a/app/admin/(shell)/reservations/actions.ts
+++ b/app/admin/(shell)/reservations/actions.ts
@@ -8,6 +8,7 @@ import type { ReservationStatus } from '@/lib/booking/rules';
 import { toE164 } from '@/lib/phone';
 import { actionError, type ActionResult } from '@/lib/server/action-result';
 import { listLocales } from '@/lib/server/booking/queries';
+import { outboxEffects } from '@/lib/server/email/outbox';
 import {
   addReservationNote,
   createStaffReservation,
@@ -22,8 +23,8 @@ import { requirePermission } from '@/lib/server/dal/session';
  * transaction (the change and its reservation_events row, never audit_log) →
  * refresh() → ActionResult. Editor and Admin alike (spec §7.1). Reservations
  * are never cached, so there is no tag to expire; refresh() re-renders the
- * page in the same response. No email yet: notifyGuest stays false until
- * phase 5 adds the checkbox and the outbox.
+ * page in the same response. A change that emails the guest queues its
+ * email_outbox rows in the same transaction (outboxEffects, spec §10.3–10.4).
  */
 
 const field = (formData: FormData, name: string) => formData.get(name) ?? undefined;
@@ -39,8 +40,10 @@ export async function changeStatus(
       version: field(formData, 'version'),
       to: field(formData, 'to'),
       reason: field(formData, 'reason'),
+      notifyGuest: field(formData, 'notifyGuest'),
     });
-    const result = await transitionReservation(getPool(), staffActor(staff), { ...input, notifyGuest: false });
+    const effects = outboxEffects();
+    const result = await transitionReservation(getPool(), staffActor(staff), input, { effects });
     if (!result.ok) return result;
     refresh();
     return { ok: true, data: { status: result.data.status } };
@@ -85,21 +88,27 @@ export async function createReservation(_prev: ActionResult | null, formData: Fo
     if (!(await listLocales(pool)).some((l) => l.code === input.locale)) {
       return { ok: false, code: 'invalid', fieldErrors: { locale: ['Chọn ngôn ngữ của khách.'] } };
     }
-    const result = await createStaffReservation(pool, staffActor(staff), {
-      restaurantId: input.restaurant,
-      date: input.date,
-      time: input.time,
-      guests: input.guests,
-      name: input.name,
-      phone: input.phone,
-      phoneE164: toE164(input.phone)!,
-      email: input.email,
-      note: input.note,
-      locale: input.locale,
-      source: input.source,
-      overCapacityReason: input.overCapacityReason,
-      notifyGuest: false,
-    });
+    const effects = outboxEffects();
+    const result = await createStaffReservation(
+      pool,
+      staffActor(staff),
+      {
+        restaurantId: input.restaurant,
+        date: input.date,
+        time: input.time,
+        guests: input.guests,
+        name: input.name,
+        phone: input.phone,
+        phoneE164: toE164(input.phone)!,
+        email: input.email,
+        note: input.note,
+        locale: input.locale,
+        source: input.source,
+        overCapacityReason: input.overCapacityReason,
+        notifyGuest: input.notifyGuest,
+      },
+      { effects },
+    );
     if (!result.ok) return result;
     // redirect() throws NEXT_REDIRECT, which actionError() rethrows (unstable_rethrow): it may sit in the try (R13).
     redirect(`/admin/reservations/${result.data.id}`);
@@ -119,13 +128,19 @@ export type CancelManyResult = { cancelled: number; skipped: number };
 export async function cancelReservations(_prev: ActionResult<CancelManyResult> | null, formData: FormData): Promise<ActionResult<CancelManyResult>> {
   try {
     const staff = await requirePermission({ reservations: ['update'] });
-    const input = CancelManyForm.parse({ items: formData.getAll('item'), reason: field(formData, 'reason') });
+    const input = CancelManyForm.parse({ items: formData.getAll('item'), reason: field(formData, 'reason'), notifyGuest: field(formData, 'notifyGuest') });
     const pool = getPool();
     const actor = staffActor(staff);
+    const effects = outboxEffects();
     let cancelled = 0;
     for (const item of input.items) {
       const [id, version] = item.split(':');
-      const result = await transitionReservation(pool, actor, { id, version: Number(version), to: 'cancelled', reason: input.reason, notifyGuest: false });
+      const result = await transitionReservation(
+        pool,
+        actor,
+        { id, version: Number(version), to: 'cancelled', reason: input.reason, notifyGuest: input.notifyGuest },
+        { effects },
+      );
       if (result.ok) cancelled += 1;
     }
     refresh();
```

`TransitionPanel` dùng `action={action}`, mà React đặt lại form sau mỗi lần action (ô tick lại bật): ô vì vậy không điều khiển, và state của câu nhắc đi theo đối tượng kết quả của `useActionState`. Từ chối luôn gửi email, nên câu nhắc vẫn hiện (dạng "Lý do từ chối …") khi ô hủy bị bỏ. Sửa `app/admin/(shell)/reservations/[id]/TransitionPanel.tsx`:

```diff
diff --git a/app/admin/(shell)/reservations/[id]/TransitionPanel.tsx b/app/admin/(shell)/reservations/[id]/TransitionPanel.tsx
index ca36115..7c52c1d 100644
--- a/app/admin/(shell)/reservations/[id]/TransitionPanel.tsx
+++ b/app/admin/(shell)/reservations/[id]/TransitionPanel.tsx
@@ -1,6 +1,6 @@
 'use client';
 
-import { useActionState } from 'react';
+import { useActionState, useState } from 'react';
 import type { ReservationStatus } from '@/lib/booking/rules';
 import type { ActionResult } from '@/lib/server/action-result';
 import { FieldError, FormMessage } from '../../_ui/FormMessage';
@@ -13,11 +13,23 @@ export type TransitionOption = { to: ReservationStatus; label: string; reasonReq
  * FormData with the clicked button, so its name/value reaches the action.
  * The version is the one this page was drawn with: a stale one comes back
  * as "Vừa được … thay đổi". The server checks the windows and reasons again.
+ *
+ * Guest email (spec §10.3, R8): confirming and declining always email a guest
+ * who gave an address; a cancel does when "Báo khách qua email khi hủy" stays
+ * ticked (on by default). The reason field says when its text will reach the
+ * guest: staff often type it in Vietnamese for an English email.
  */
 export function TransitionPanel({ id, version, options }: { id: string; version: number; options: TransitionOption[] }) {
   const [state, action, pending] = useActionState<ActionResult<{ status: ReservationStatus }> | null, FormData>(changeStatus, null);
+  // The box is uncontrolled (the action's form reset ticks it again); its state follows it back to on with each result.
+  const [notifyAt, setNotifyAt] = useState<{ state: typeof state; on: boolean }>({ state, on: true });
+  const notify = notifyAt.state === state ? notifyAt.on : true;
   if (options.length === 0) return <p className="a-muted">Đặt bàn đã kết thúc; không còn thao tác nào.</p>;
   const needsReason = options.some((o) => o.reasonRequired);
+  const canCancel = options.some((o) => o.to === 'cancelled');
+  const canDecline = options.some((o) => o.to === 'declined');
+  const reasonHint =
+    canCancel && notify ? 'Lý do này sẽ được gửi cho khách.' : canDecline ? 'Lý do từ chối sẽ được gửi cho khách.' : null;
   return (
     <form className="a-transitions" action={action}>
       <input type="hidden" name="id" value={id} />
@@ -25,9 +37,25 @@ export function TransitionPanel({ id, version, options }: { id: string; version:
       <FormMessage state={state} success="Đã cập nhật trạng thái." />
       <div className="a-field">
         <label htmlFor="res-transition-reason">{needsReason ? 'Lý do (bắt buộc khi hủy hoặc từ chối)' : 'Lý do (không bắt buộc)'}</label>
-        <input id="res-transition-reason" name="reason" maxLength={500} aria-describedby="res-transition-reason-error" />
+        <input
+          id="res-transition-reason"
+          name="reason"
+          maxLength={500}
+          aria-describedby={reasonHint ? 'res-transition-reason-hint res-transition-reason-error' : 'res-transition-reason-error'}
+        />
+        {reasonHint ? (
+          <small className="a-sub" id="res-transition-reason-hint">
+            {reasonHint}
+          </small>
+        ) : null}
         <FieldError state={state} name="reason" id="res-transition-reason-error" />
       </div>
+      {canCancel ? (
+        <label className="a-check">
+          <input type="checkbox" name="notifyGuest" defaultChecked onChange={(e) => setNotifyAt({ state, on: e.target.checked })} />
+          Báo khách qua email khi hủy
+        </label>
+      ) : null}
       <div className="a-actions">
         {options.map((o) => (
           <span className="a-action" key={o.to}>
```

Sửa `app/admin/(shell)/_ui/AffectedList.tsx` (form được key theo danh sách; state của câu nhắc theo cùng khóa):

```diff
diff --git a/app/admin/(shell)/_ui/AffectedList.tsx b/app/admin/(shell)/_ui/AffectedList.tsx
index b6fee00..9cbf9a3 100644
--- a/app/admin/(shell)/_ui/AffectedList.tsx
+++ b/app/admin/(shell)/_ui/AffectedList.tsx
@@ -1,7 +1,7 @@
 'use client';
 
 import Link from 'next/link';
-import { useActionState, useId } from 'react';
+import { useActionState, useId, useState } from 'react';
 import { submitKeepingValues } from '@/lib/admin/form';
 import type { ActionResult } from '@/lib/server/action-result';
 import { cancelReservations, type CancelManyResult } from '../reservations/actions';
@@ -24,11 +24,17 @@ export type AffectedItem = {
 /*
  * Bookings that new hours, a new capacity or a closure leave out (spec §10.1).
  * Nothing is ticked at first, and nothing is cancelled unless staff tick it,
- * write a reason and press the button: never automatic.
+ * write a reason and press the button: never automatic. "Báo khách qua email"
+ * is on by default, as for a single cancel (R8): each guest who gave an
+ * address gets guest.cancelled with the reason.
  */
 export function AffectedList({ items, title }: { items: AffectedItem[]; title: string }) {
   const [state, action, pending] = useActionState<ActionResult<CancelManyResult> | null, FormData>(cancelReservations, null);
   const uid = useId();
+  const formKey = items.map((i) => `${i.id}:${i.version}`).join();
+  // The box remounts ticked with the form (its key); the hint's state follows it back to on.
+  const [notifyAt, setNotifyAt] = useState({ formKey, on: true });
+  const notify = notifyAt.formKey === formKey ? notifyAt.on : true;
   const done = state?.ok ? state.data : null;
   const notice = done ? (
     <p className="a-notice" role="status">
@@ -49,7 +55,7 @@ export function AffectedList({ items, title }: { items: AffectedItem[]; title: s
     // action={action} would reset them. The key clears them once a cancel changes the list (refresh()): a
     // booking skipped because it changed comes back with a new version and must not stay ticked. The hook
     // state lives above the form, so the outcome notice survives. method="post": never a GET before hydration.
-    <form className="a-affected" method="post" onSubmit={submitKeepingValues(action)} key={items.map((i) => `${i.id}:${i.version}`).join()} aria-label={title}>
+    <form className="a-affected" method="post" onSubmit={submitKeepingValues(action)} key={formKey} aria-label={title}>
       <p className="a-warn">{`${items.length} đặt bàn bị ảnh hưởng. Hệ thống không tự hủy: chọn những đặt bàn cần hủy, ghi lý do rồi bấm Hủy.`}</p>
       <table className="a-table a-table--compact">
         <thead>
@@ -83,8 +89,22 @@ export function AffectedList({ items, title }: { items: AffectedItem[]; title: s
       </table>
       <div className="a-field">
         <label htmlFor={`${uid}-reason`}>Lý do hủy</label>
-        <input id={`${uid}-reason`} name="reason" maxLength={500} aria-describedby={`${uid}-reason-error`} />
+        <input
+          id={`${uid}-reason`}
+          name="reason"
+          maxLength={500}
+          aria-describedby={notify ? `${uid}-reason-hint ${uid}-reason-error` : `${uid}-reason-error`}
+        />
+        {notify ? (
+          <small className="a-sub" id={`${uid}-reason-hint`}>
+            Lý do này sẽ được gửi cho khách.
+          </small>
+        ) : null}
         <FieldError state={state} name="reason" id={`${uid}-reason-error`} />
+        <label className="a-check">
+          <input type="checkbox" name="notifyGuest" defaultChecked onChange={(e) => setNotifyAt({ formKey, on: e.target.checked })} />
+          Báo khách qua email
+        </label>
         <FieldError state={state} name="items" id={`${uid}-items-error`} />
       </div>
       {notice ?? <FormMessage state={state && !state.ok ? state : null} />}
```

Sửa `app/admin/(shell)/reservations/new/NewReservationForm.tsx` (dựng trên form của F9; trang key form theo nhà hàng và ngày, nên state `walkIn` về mặc định ở mỗi lần chọn mới):

```diff
diff --git a/app/admin/(shell)/reservations/new/NewReservationForm.tsx b/app/admin/(shell)/reservations/new/NewReservationForm.tsx
index 4073a2b..858fea6 100644
--- a/app/admin/(shell)/reservations/new/NewReservationForm.tsx
+++ b/app/admin/(shell)/reservations/new/NewReservationForm.tsx
@@ -14,6 +14,9 @@ export type SlotOption = { time: string; label: string };
  * Posts to the target the page was rendered for (the hidden restaurant and
  * date), which the line at the top names. The page keys this form on that
  * target, so a new pick remounts it with the new times.
+ *
+ * "Gửi email xác nhận" (spec §10.3, R8) is on by default for a phone booking
+ * and hidden for a walk-in, who is already at the table.
  */
 export function NewReservationForm(props: {
   restaurantId: string;
@@ -28,6 +31,7 @@ export function NewReservationForm(props: {
   const [state, action, pending] = useActionState<ActionResult | null, FormData>(createReservation, null);
   const picked = usePickedTarget();
   const [refused, setRefused] = useState(false);
+  const [walkIn, setWalkIn] = useState(false);
   const err = (name: string) => `res-new-${name}-error`;
   // The picker no longer shows this form's target: its times are the old target's, so posting would book there.
   const stale = !!picked && (picked.restaurant !== props.restaurantId || picked.date !== props.date);
@@ -55,11 +59,11 @@ export function NewReservationForm(props: {
       <fieldset className="a-field a-field--wide">
         <legend>Nguồn</legend>
         <label className="a-check">
-          <input type="radio" name="source" value="phone" defaultChecked />
+          <input type="radio" name="source" value="phone" defaultChecked onChange={() => setWalkIn(false)} />
           Điện thoại (đã xác nhận)
         </label>
         <label className="a-check">
-          <input type="radio" name="source" value="walk_in" disabled={!props.walkInAllowed} />
+          <input type="radio" name="source" value="walk_in" disabled={!props.walkInAllowed} onChange={() => setWalkIn(true)} />
           Khách vãng lai (đã đến)
         </label>
       </fieldset>
@@ -93,6 +97,12 @@ export function NewReservationForm(props: {
         <label htmlFor="res-new-email">Email (không bắt buộc)</label>
         <input id="res-new-email" name="email" type="email" aria-describedby={err('email')} />
         <FieldError state={state} name="email" id={err('email')} />
+        {walkIn ? null : (
+          <label className="a-check">
+            <input type="checkbox" name="notifyGuest" defaultChecked />
+            Gửi email xác nhận cho khách (khi có email)
+          </label>
+        )}
       </div>
       <div className="a-field">
         <label htmlFor="res-new-locale">Ngôn ngữ của khách</label>
```

- [ ] **Bước 8: Chạy lại test**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/email-outbox.test.ts lib/admin/booking-schemas.test.ts`
Expected: PASS `Test Files  2 passed (2)`, `Tests  20 passed (20)`

- [ ] **Bước 9: Chạy cổng kiểm tra**

Expected:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo;
- `Test Files  57 passed (57)`, `Tests  649 passed (649)`;
- `Applied 7 migration(s).`; build và check-prerender như Task 1;
- E2E `119 passed`; visual `8 passed`.

- [ ] **Bước 10: Commit**

```bash
git add "app/admin/(shell)/_ui/AffectedList.tsx" "app/admin/(shell)/reservations/[id]/TransitionPanel.tsx" "app/admin/(shell)/reservations/actions.ts" "app/admin/(shell)/reservations/new/NewReservationForm.tsx" e2e/admin-reservations.spec.ts lib/admin/booking-schemas.test.ts lib/admin/booking-schemas.ts lib/server/booking/create.ts lib/server/email/env.ts lib/server/email/outbox.ts lib/server/email/recipients.ts test/integration/email-outbox.test.ts
git commit -m "$(cat <<'EOF'
feat: queue booking emails in the transaction of the change, and let staff choose the guest emails

Every booking change that emails someone now writes its email_outbox rows on
the client of its own transaction (spec §10.3–10.4), so an email exists
exactly when the change does; nothing sends yet. A web booking queues
staff.new for the union of its restaurant's, its destination's and the
'all' recipients, one row per address with the most specific scope's
spelling and language, or one row to site_settings.email (Vietnamese,
fallback) when nobody matches; then guest.confirmed when auto-confirmed, or
guest.ack while guest_ack_email is on. Transitions follow their guestEmail:
confirm and decline always, cancel with "Báo khách". A phone booking with
"Gửi email xác nhận" gets guest.confirmed; a walk-in never does. staff.new is
for web bookings only. A guest address email_outbox would refuse is not
queued, so an email can never fail a booking.

The rows carry the writer's env (VERCEL_ENV, else development), so a Preview
never sends production's queue. The admin gains the checkboxes of R8:
"Báo khách qua email khi hủy" and the bulk "Báo khách qua email", both on by
default with a note that the reason reaches the guest, and "Gửi email xác
nhận", on by default and hidden for a walk-in.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Bộ gửi và các nút kích hoạt nó

Bộ gửi của outbox (spec §10.4, R1, R5, R6, R7, R20): giữ từng hàng một, đọc lại đặt bàn, gửi khi không giữ kết nối DB, đánh dấu có rào. Ba nút kích hoạt: `after()` sau mỗi lần ghi đặt bàn đã COMMIT, cron mỗi 5 phút, và (Task 7) "Gửi lại". Thân email ở task này cố ý tối thiểu (chủ đề `<sự kiện> <mã>`); Task 5 thay bằng template của registry sau cùng một lời gọi `renderOutboxEmail`.

**Files:**
- Create: `lib/server/email/booking/load.ts`, `lib/server/email/booking/render.ts`, `lib/server/email/drain.ts`, `lib/server/email/after-commit.ts`, `lib/server/cron.ts`, `app/api/cron/outbox/route.ts`, `vercel.json`, `test/integration/cron-outbox.test.ts`, `e2e/booking-email.spec.ts`
- Modify: `lib/server/booking/rules.ts`, `app/actions.ts`, `app/admin/(shell)/reservations/actions.ts`, `scripts/check-prerender.mjs`, `.github/workflows/ci.yml`, `test/integration/email-outbox.test.ts`, `test/integration/submit-reservation.test.ts`

**Interfaces:**
- Consumes: `openMailer`, `senderDomain`, `EmailDeps` (Task 2); `EmailSendError`, `describeEmailError`, `SendEmailResult` (Task 2); `outboxEnv` (Task 3); `EVENT_STATUSES`, `EmailEvent` (Task 1); `CreateOutcome.outboxIds`, `outboxEffects().queued` (Task 3); `startSmtpSink` (Task 2).
- Produces:
  - `lib/server/booking/rules.ts`: `groupPhoneSql(restaurantAlias): string` (export; loader của đợt 4 dùng lại).
  - `lib/server/email/booking/load.ts`: `type BookingEmailData = { reservationId; reference; restaurantName; date: IsoDate; time; guests; status: ReservationStatus; statusReason; guestName; phone; email; note; groupPhone: GroupPhone | null; anonymized: boolean }`; `loadBookingEmailData(db, reservationId): Promise<BookingEmailData | null>`.
  - `lib/server/email/booking/render.ts`: `type RenderedEmail = { subject; html; text; replyTo? }`; `renderOutboxEmail(db, row: { event; locale }, data): Promise<RenderedEmail>` (Task 5 viết lại thân hàm, giữ chữ ký, thêm `locale` vào kết quả).
  - `lib/server/email/drain.ts`: `RETRY_DELAYS_MINUTES`, `MAX_ATTEMPTS = 7`, `LEASE_SECONDS = 120`; `type DrainOptions = { ids?; limit?; budgetMs?; pool?; env?; mailer?: Partial<EmailDeps> }`; `type DrainReport = { claimed; sent; skipped; retried; failed; lost }`; `type ClaimedRow`; `drainOutbox(options?): Promise<DrainReport>`; `drainQuietly(options): Promise<void>` (không bao giờ ném).
  - `lib/server/email/after-commit.ts`: `drainAfterCommit(ids: readonly string[]): void`.
  - `lib/server/cron.ts`: `cronAuthorized(header: string | null, secret: string | undefined): boolean`.
  - `app/api/cron/outbox/route.ts`: `GET`, `maxDuration = 300`.

- [ ] **Bước 1: Viết test của bộ gửi**

Thêm nửa bộ gửi vào `test/integration/email-outbox.test.ts`: Message-ID trên dây bằng giá trị đã lưu, chỉ env của mình, thang thử lại `[1,5,15,60,360,720]` với một Message-ID qua 7 lần gửi, 5xx sau DATA được thử lại, 550 ở `RCPT TO` hỏng ngay, bỏ qua khi không còn khớp (trạng thái, địa chỉ đổi, đã ẩn danh), hai bộ gửi cùng lúc, hàng bị khóa ở nơi khác không làm bộ gửi chờ (`SKIP LOCKED`), chết giữa lúc gửi và đánh dấu, đánh dấu `sent` hỏng một lần và hai lần (C14), rào `attempts`, thu hồi ở lần thứ 7, chế độ log (và log trên Preview thì `not_delivered`, thử lại), máy SMTP sập thì đặt bàn vẫn còn, không địa chỉ nào trong dòng `[outbox]`.

```diff
diff --git a/test/integration/email-outbox.test.ts b/test/integration/email-outbox.test.ts
index 654c7ba..f4e0867 100644
--- a/test/integration/email-outbox.test.ts
+++ b/test/integration/email-outbox.test.ts
@@ -3,14 +3,17 @@ import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi }
 import { createWebReservation } from '@/lib/server/booking/create';
 import { parseReservationInput } from '@/lib/server/booking/input';
 import { createStaffReservation, transitionReservation, type ReservationActor, type StaffBookingInput } from '@/lib/server/booking/reservations';
+import { LEASE_SECONDS, RETRY_DELAYS_MINUTES, drainOutbox, type DrainOptions } from '@/lib/server/email/drain';
 import { outboxEnv } from '@/lib/server/email/env';
 import { outboxEffects } from '@/lib/server/email/outbox';
 import { TEST_DATABASE_URL } from '../helpers/db';
+import { startSmtpSink, type SinkOptions, type SmtpSink } from '../helpers/smtp-sink';
 
 /*
- * Spec §10.3–10.4 in the database: which change queues which email to whom,
- * written in the change's own transaction (one row per recipient). Nothing
- * here sends; the drain's half of this file arrives with the drain.
+ * Spec §10.3–10.4 in the database, over SMTP to a local sink: which change
+ * queues which email to whom (rows written in the change's own transaction),
+ * and the drain (lease, Message-ID, skip, retries, failure, concurrency, a
+ * crash between the send and its bookkeeping).
  */
 
 let pool: Pool;
@@ -40,13 +43,32 @@ const staffBooking = (over: Partial<StaffBookingInput> = {}): StaffBookingInput
 type Row = { id: string; event: string; audience: string; to_email: string; locale: string; fallback: boolean; status: string; attempts: number };
 const outbox = async (where = 'true', values: unknown[] = []): Promise<Row[]> =>
   (await pool.query(`SELECT id::text, event, audience, to_email, locale, fallback, status, attempts FROM email_outbox WHERE ${where} ORDER BY id`, values)).rows;
+const full = async (id: string) =>
+  (
+    await pool.query(
+      `SELECT *, extract(epoch FROM next_attempt_at - now()) / 60 AS wait_min, locked_until > now() AS leased FROM email_outbox WHERE id = $1`,
+      [id],
+    )
+  ).rows[0];
 const recipient = (over: Record<string, unknown>) => {
   const r = { scope: 'all', email: 'all@furama.test', ...over };
   const cols = Object.keys(r);
   return pool.query(`INSERT INTO notification_recipients (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(r));
 };
 
-describe.skipIf(!TEST_DATABASE_URL)('email outbox (database)', () => {
+/** Pretends the clock moved on: every waiting row is due now. */
+const makeDue = () => pool.query(`UPDATE email_outbox SET next_attempt_at = now() WHERE status = 'queued'`);
+
+let sinks: SmtpSink[] = [];
+async function sink(options: SinkOptions = {}) {
+  const s = await startSmtpSink(options);
+  sinks.push(s);
+  return s;
+}
+const drainTo = (s: SmtpSink, options: DrainOptions = {}) =>
+  drainOutbox({ pool, env: s.env(), mailer: { transportOverrides: s.clientOverrides }, ...options });
+
+describe.skipIf(!TEST_DATABASE_URL)('email outbox (database + local SMTP sink)', () => {
   beforeAll(() => {
     pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 8 });
   });
@@ -60,9 +82,14 @@ describe.skipIf(!TEST_DATABASE_URL)('email outbox (database)', () => {
     await pool.query('UPDATE restaurants SET booking_enabled = true, window_days = NULL, lead_minutes = NULL, max_party = NULL, auto_confirm = NULL');
     await pool.query('UPDATE booking_settings SET window_days = 14, lead_minutes = 30, same_day_cutoff = NULL, max_party = 12, auto_confirm = false, guest_ack_email = true');
     await pool.query(`UPDATE site_settings SET email = 'fb@furamavietnam.com'`);
+    vi.spyOn(console, 'info').mockImplementation(() => {});
+    vi.spyOn(console, 'warn').mockImplementation(() => {});
+    vi.spyOn(console, 'error').mockImplementation(() => {});
   });
-  afterEach(() => {
+  afterEach(async () => {
     vi.restoreAllMocks();
+    await Promise.all(sinks.map((s) => s.close()));
+    sinks = [];
   });
 
   describe('queueing, in the transaction of the change', () => {
@@ -204,4 +231,270 @@ describe.skipIf(!TEST_DATABASE_URL)('email outbox (database)', () => {
       expect((await pool.query(`SELECT DISTINCT env FROM email_outbox`)).rows).toEqual([{ env: 'preview' }]);
     });
   });
+  describe('the drain', () => {
+    it('sends each row over SMTP once, records the reply, and puts the Message-ID it fixed on the wire', async () => {
+      const s = await sink();
+      await recipient({ scope: 'all', email: 'gm@furama.test' });
+      const booking = await guestBooking();
+      const report = await drainTo(s, { ids: booking.outboxIds });
+      expect(report).toEqual({ claimed: 2, sent: 2, skipped: 0, retried: 0, failed: 0, lost: 0 });
+
+      const rows = await pool.query(`SELECT id::text, status, attempts, message_id, provider_id, sent_at IS NOT NULL AS sent, locked_until FROM email_outbox ORDER BY id`);
+      for (const row of rows.rows) {
+        expect(row).toMatchObject({ status: 'sent', attempts: 1, sent: true, locked_until: null });
+        expect(row.message_id).toMatch(new RegExp(`^<outbox-${row.id}\\.[0-9a-f]{12}@mail\\.furama\\.test>$`));
+        expect(row.provider_id).toMatch(/^250 Ok: queued as SINK\d$/);
+      }
+      expect(s.received.map((m) => [m.to[0], m.messageId])).toEqual(rows.rows.map((r, i) => [['gm@furama.test', 'guest@example.com'][i], r.message_id]));
+      expect(s.received.map((m) => m.subject)).toEqual([`staff.new ${booking.reference}`, `guest.ack ${booking.reference}`]);
+      // Nothing left: a second drain claims nothing.
+      expect(await drainTo(s)).toMatchObject({ claimed: 0 });
+      expect(s.received).toHaveLength(2);
+    });
+
+    it('drains only its own env: a Preview never sends production rows, and the reverse', async () => {
+      const s = await sink();
+      await guestBooking();
+      await pool.query(`UPDATE email_outbox SET env = 'production'`);
+      expect(await drainTo(s, { env: s.env({ VERCEL_ENV: 'preview' }) })).toMatchObject({ claimed: 0 });
+      expect(await drainTo(s)).toMatchObject({ claimed: 0 }); // development
+      expect(await drainTo(s, { env: s.env({ VERCEL_ENV: 'production' }) })).toMatchObject({ claimed: 2, sent: 2 });
+    });
+
+    it('retries after 1 m, 5 m, 15 m, 1 h, 6 h and 12 h with the same Message-ID, then marks it failed after the 7th attempt', async () => {
+      const s = await sink({ failData: () => 451 });
+      await guestBooking({ email: '' }); // one row: staff.new to the general email
+      const [{ id }] = await outbox();
+      const waits: number[] = [];
+      for (let attempt = 1; attempt <= 7; attempt++) {
+        const report = await drainTo(s);
+        expect(report.claimed).toBe(1);
+        const row = await full(id);
+        expect(row.attempts).toBe(attempt);
+        if (attempt < 7) {
+          expect(row).toMatchObject({ status: 'queued', locked_until: null, last_error: 'provider_error: SMTP EMESSAGE at DATA: Message failed: 451 Temporary failure, try again' });
+          waits.push(Math.round(Number(row.wait_min)));
+          // Not due yet: another drain leaves it alone.
+          expect(await drainTo(s)).toMatchObject({ claimed: 0 });
+          await makeDue();
+        } else {
+          expect(row).toMatchObject({ status: 'failed', locked_until: null, sent_at: null });
+        }
+      }
+      expect(waits).toEqual([...RETRY_DELAYS_MINUTES]);
+      expect(s.seen).toHaveLength(7);
+      expect(new Set(s.seen.map((m) => m.messageId)).size).toBe(1);
+      // Every attempt within a day: 1+5+15+60+360+720 = 1161 minutes, about 19.4 h.
+      expect(RETRY_DELAYS_MINUTES.reduce((a, b) => a + b, 0)).toBe(1161);
+      // Failed is final: no drain picks it up again ("Gửi lại" comes with the email log).
+      expect(await drainTo(s)).toMatchObject({ claimed: 0 });
+    });
+
+    it('a 5xx after the message (a provider quota, say) is retried, not final', async () => {
+      const s = await sink({ failData: (i) => (i === 0 ? 554 : null) });
+      await guestBooking({ email: '' });
+      const [{ id }] = await outbox();
+      expect(await drainTo(s)).toMatchObject({ claimed: 1, retried: 1, failed: 0 });
+      expect((await full(id)).last_error).toBe('provider_error: SMTP EMESSAGE at DATA: Message failed: 554 Message rejected');
+      await makeDue();
+      expect(await drainTo(s)).toMatchObject({ claimed: 1, sent: 1 });
+    });
+
+    it('a recipient refused for good (550) fails at once, without retries', async () => {
+      const s = await sink({ refuseRecipient: (a) => (a === 'gone@example.com' ? 550 : null) });
+      await guestBooking({ email: 'gone@example.com' });
+      const report = await drainTo(s);
+      expect(report).toMatchObject({ claimed: 2, sent: 1, failed: 1, retried: 0 });
+      const failed = (await outbox(`status = 'failed'`))[0];
+      expect(await full(failed.id)).toMatchObject({ attempts: 1, last_error: expect.stringMatching(/^rejected: SMTP EENVELOPE at RCPT TO: .*550 <redacted>/) });
+      expect((await full(failed.id)).last_error).not.toContain('gone@example.com');
+    });
+
+    it('skips an email that no longer matches the booking: a confirmation cancelled before it went, an ack after the confirm', async () => {
+      const s = await sink();
+      const a = await guestBooking();
+      const version = async () => (await pool.query('SELECT version FROM reservations WHERE id = $1', [a.id])).rows[0].version;
+      await transitionReservation(pool, LAN, { id: a.id, version: await version(), to: 'confirmed', reason: null, notifyGuest: false }, { now: NOW, effects: outboxEffects('development') });
+      await transitionReservation(pool, LAN, { id: a.id, version: await version(), to: 'cancelled', reason: 'Khách đổi ý', notifyGuest: true }, { now: NOW, effects: outboxEffects('development') });
+      const report = await drainTo(s);
+      expect(report).toMatchObject({ claimed: 4, sent: 1, skipped: 3 });
+      expect((await pool.query(`SELECT event, status, last_error FROM email_outbox ORDER BY id`)).rows).toEqual([
+        // The staff were the ones who cancelled it: a "new booking" note about it is moot.
+        { event: 'staff.new', status: 'skipped', last_error: 'skipped: the booking is now cancelled' },
+        { event: 'guest.ack', status: 'skipped', last_error: 'skipped: the booking is now cancelled' },
+        { event: 'guest.confirmed', status: 'skipped', last_error: 'skipped: the booking is now cancelled' },
+        { event: 'guest.cancelled', status: 'sent', last_error: null },
+      ]);
+      expect(s.received.map((m) => m.subject)).toEqual([`guest.cancelled ${a.reference}`]);
+    });
+
+    it('skips a guest email whose address changed since it was queued, and one whose booking was anonymised', async () => {
+      const s = await sink();
+      const a = await guestBooking();
+      const b = await guestBooking({ time: '19:30' });
+      await pool.query(`UPDATE reservations SET email = 'fixed@example.com' WHERE id = $1`, [a.id]);
+      await pool.query(`UPDATE reservations SET anonymized_at = now() WHERE id = $1`, [b.id]);
+      expect(await drainTo(s)).toMatchObject({ claimed: 4, sent: 1, skipped: 3 });
+      expect((await pool.query(`SELECT reservation_id::text AS r, event, status, last_error FROM email_outbox ORDER BY id`)).rows).toEqual([
+        { r: a.id, event: 'staff.new', status: 'sent', last_error: null },
+        { r: a.id, event: 'guest.ack', status: 'skipped', last_error: 'skipped: the guest email changed' },
+        { r: b.id, event: 'staff.new', status: 'skipped', last_error: 'skipped: the booking was anonymised' },
+        { r: b.id, event: 'guest.ack', status: 'skipped', last_error: 'skipped: the booking was anonymised' },
+      ]);
+    });
+
+    it('two drains at once never send the same row twice', async () => {
+      const s = await sink({ holdDataMs: 30 });
+      for (let i = 0; i < 6; i++) await guestBooking({ time: ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30'][i] });
+      const rows = await outbox();
+      expect(rows).toHaveLength(12);
+      const other = new Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
+      try {
+        const [one, two] = await Promise.all([drainTo(s), drainTo(s, { pool: other })]);
+        expect(one.sent + two.sent).toBe(12);
+        expect(one.claimed).toBeGreaterThan(0);
+        expect(two.claimed).toBeGreaterThan(0);
+      } finally {
+        await other.end();
+      }
+      expect(s.received).toHaveLength(12);
+      expect(new Set(s.received.map((m) => m.messageId)).size).toBe(12);
+      expect((await outbox(`status <> 'sent' OR attempts <> 1`)).length).toBe(0);
+    });
+
+    it('a row locked elsewhere does not stall the drain: it sends the others now (SKIP LOCKED)', async () => {
+      const s = await sink();
+      await guestBooking({ email: '' });
+      await guestBooking({ email: '', time: '19:30' });
+      const [first, second] = await outbox();
+      const holder = await pool.connect();
+      try {
+        await holder.query('BEGIN');
+        await holder.query('SELECT 1 FROM email_outbox WHERE id = $1 FOR UPDATE', [first.id]);
+        const report = await Promise.race([drainTo(s), new Promise((done) => setTimeout(() => done('stalled'), 2_000))]);
+        expect(report).toMatchObject({ claimed: 1, sent: 1 });
+        expect(await full(second.id)).toMatchObject({ status: 'sent' });
+      } finally {
+        await holder.query('ROLLBACK');
+        holder.release();
+      }
+      expect(await drainTo(s)).toMatchObject({ claimed: 1, sent: 1 });
+      expect(s.received).toHaveLength(2);
+    });
+
+    it('a crash between the send and "sent": the lease holds it, then the next drain sends it again with the same Message-ID', async () => {
+      const s = await sink();
+      await guestBooking({ email: '' });
+      const [{ id }] = await outbox();
+      // A pool whose UPDATE … 'sent' never returns: the function died right after the server said 250.
+      const dying = {
+        query: (text: string, values?: unknown[]) => (text.includes("status = 'sent'") ? new Promise(() => {}) : pool.query(text, values)),
+      } as unknown as Pool;
+      void drainTo(s, { pool: dying });
+      await vi.waitFor(() => expect(s.received).toHaveLength(1));
+      expect(await full(id)).toMatchObject({ status: 'sending', attempts: 1, leased: true });
+
+      // Within the lease nobody touches it: no second copy.
+      expect(await drainTo(s)).toMatchObject({ claimed: 0 });
+      // The lease (LEASE_SECONDS) runs out: the next cron sends it again, recognisably the same message.
+      expect(LEASE_SECONDS).toBe(120);
+      await pool.query(`UPDATE email_outbox SET locked_until = now() - interval '1 second' WHERE id = $1`, [id]);
+      expect(await drainTo(s)).toMatchObject({ claimed: 1, sent: 1 });
+      expect(await full(id)).toMatchObject({ status: 'sent', attempts: 2 });
+      expect(s.received).toHaveLength(2);
+      expect(s.received[1].messageId).toBe(s.received[0].messageId);
+    });
+
+    it('the "sent" mark failing after a send is not a send failure: tried once more, and never scheduled for a retry (C14)', async () => {
+      const s = await sink();
+      await guestBooking({ email: '' });
+      await guestBooking({ email: '', time: '19:30' });
+      const [first, second] = await outbox();
+      // The first 'sent' mark of each row hits a database error; the second one works for the first row only.
+      let failures = 0;
+      const flaky = {
+        query: (text: string, values?: unknown[]) => {
+          if (text.includes("status = 'sent'") && ((values?.[0] === first.id && failures++ === 0) || values?.[0] === second.id)) {
+            return Promise.reject(Object.assign(new Error('connection terminated'), { code: '57P01' }));
+          }
+          return pool.query(text, values);
+        },
+      } as unknown as Pool;
+      const errors = vi.mocked(console.error);
+      expect(await drainTo(s, { pool: flaky })).toEqual({ claimed: 2, sent: 1, skipped: 0, retried: 0, failed: 0, lost: 1 });
+      expect(s.received).toHaveLength(2);
+      expect(await full(first.id)).toMatchObject({ status: 'sent', attempts: 1, last_error: null });
+      // Still under its lease, not queued for a retry: a later drain re-sends it only once the lease is over.
+      expect(await full(second.id)).toMatchObject({ status: 'sending', attempts: 1, leased: true, last_error: null });
+      expect(errors).toHaveBeenCalledWith(`[outbox] sent but not recorded id=${second.id} event=staff.new attempt=1 code=mark_failed`, { pg: '57P01' });
+    });
+
+    it('a drain whose lease ran out mid-send cannot overwrite the newer claim (fenced by attempts)', async () => {
+      // Both sends wait 600 ms for the server; the first then fails with 451, the second is accepted.
+      const s = await sink({ holdDataMs: 600, failData: (i) => (i === 0 ? 451 : null) });
+      await guestBooking({ email: '' });
+      const [{ id }] = await outbox();
+      const slow = drainTo(s);
+      await vi.waitFor(() => expect(s.attempts).toBe(1));
+      // While the first drain still waits for the server, its lease is taken as expired and another drain claims the row.
+      await pool.query(`UPDATE email_outbox SET locked_until = now() - interval '1 second' WHERE id = $1`, [id]);
+      const fast = drainTo(s);
+      await vi.waitFor(() => expect(s.attempts).toBe(2));
+      // The first drain's failure comes back while the second send is in flight: it must not requeue the row.
+      expect(await slow).toMatchObject({ claimed: 1, retried: 0, lost: 1 });
+      expect(await fast).toMatchObject({ claimed: 1, sent: 1, lost: 0 });
+      expect(await full(id)).toMatchObject({ status: 'sent', attempts: 2, last_error: null });
+      expect(s.received).toHaveLength(1);
+      expect(new Set(s.seen.map((m) => m.messageId)).size).toBe(1);
+    });
+
+    it('a claim that died on its 7th attempt is marked failed once its lease ends', async () => {
+      const s = await sink();
+      await guestBooking({ email: '' });
+      const [{ id }] = await outbox();
+      await pool.query(`UPDATE email_outbox SET status = 'sending', attempts = 7, locked_until = now() - interval '1 second' WHERE id = $1`, [id]);
+      expect(await drainTo(s)).toMatchObject({ claimed: 0, failed: 1 });
+      expect(await full(id)).toMatchObject({ status: 'failed', last_error: 'lease_expired: the last attempt never reported back' });
+      expect(s.attempts).toBe(0);
+    });
+
+    it('log mode marks rows sent without SMTP; log mode on a Vercel deployment is a failure that retries', async () => {
+      await guestBooking({ email: '' });
+      const [{ id }] = await outbox();
+      const logged: unknown[] = [];
+      const logSink = (e: unknown) => void logged.push(e);
+      expect(await drainOutbox({ pool, env: { VERCEL_ENV: 'preview', EMAIL_DELIVERY: 'log' }, mailer: { logSink } })).toMatchObject({ claimed: 0 });
+      await pool.query(`UPDATE email_outbox SET env = 'preview'`);
+      expect(await drainOutbox({ pool, env: { VERCEL_ENV: 'preview', EMAIL_DELIVERY: 'log' }, mailer: { logSink } })).toMatchObject({ retried: 1 });
+      expect((await full(id)).last_error).toMatch(/^not_delivered: /);
+      await pool.query(`UPDATE email_outbox SET env = 'development', next_attempt_at = now()`);
+      expect(await drainOutbox({ pool, env: {}, mailer: { logSink } })).toMatchObject({ sent: 1 });
+      expect(await full(id)).toMatchObject({ status: 'sent', provider_id: 'log', attempts: 2 });
+      expect(logged).toHaveLength(2);
+    });
+
+    it('an SMTP server that is down: the booking stands, the row waits for the next attempt', async () => {
+      const s = await sink();
+      await s.close();
+      sinks = [];
+      const booking = await guestBooking({ email: '' });
+      const report = await drainOutbox({ pool, env: s.env(), mailer: { transportOverrides: s.clientOverrides } });
+      expect(report).toMatchObject({ claimed: 1, retried: 1 });
+      const lastError = (await full(booking.outboxIds[0])).last_error;
+      expect(lastError).toMatch(/^provider_error: SMTP ESOCKET at CONN: connect ECONNREFUSED/);
+      // Where the SMTP server is stays out of the error, as addresses do: Editors read it in the email log.
+      expect(lastError).not.toContain('127.0.0.1');
+      expect(lastError).toContain('<smtp-host>');
+      expect((await pool.query('SELECT count(*)::int AS n FROM reservations')).rows[0].n).toBe(1);
+    });
+
+    it('logs ids, events, codes and attempts, never an address', async () => {
+      const s = await sink({ refuseRecipient: (a) => (a === 'gone@example.com' ? 550 : null) });
+      await guestBooking({ email: 'gone@example.com' });
+      await drainTo(s);
+      const lines = [vi.mocked(console.info), vi.mocked(console.warn), vi.mocked(console.error)].flatMap((m) => m.mock.calls.map((c) => c.join(' ')));
+      expect(lines.filter((l) => l.startsWith('[outbox]'))).toHaveLength(2);
+      expect(lines.filter((l) => l.startsWith('[outbox]') && l.includes('@'))).toEqual([]);
+    });
+  });
 });
```

Create `test/integration/cron-outbox.test.ts`:

```ts
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/cron/outbox/route';
import { getPool } from '@/db/client';
import { cronAuthorized } from '@/lib/server/cron';

/* /api/cron/outbox (spec §10.4, §12): Vercel Cron's bearer secret or 401; with it, one drain of this env's due rows. */

const SECRET = 'cron-secret-0123456789abcdef';
const call = (authorization?: string) =>
  GET(new Request('http://localhost/api/cron/outbox', { headers: authorization ? { authorization } : {} }));
const sql = (text: string, values: unknown[] = []) => getPool().query(text, values);

/** One booking and three outbox rows: due in this env, due later, due in production. */
async function seed() {
  const { rows } = await sql(
    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source)
     VALUES ('FC-CRON0001', 'taya-house', '2026-10-05', '19:00', 'Dinner', 2, 'G', '0905 000 000', '+84905000000', 'web') RETURNING id`,
  );
  await sql(
    `INSERT INTO email_outbox (env, event, audience, reservation_id, to_email, locale, next_attempt_at)
     VALUES ('development', 'staff.new', 'staff', $1, 'a@furama.test', 'vi', now()),
            ('development', 'staff.new', 'staff', $1, 'b@furama.test', 'vi', now() + interval '5 minutes'),
            ('production',  'staff.new', 'staff', $1, 'c@furama.test', 'vi', now())`,
    [rows[0].id],
  );
}

describe('cronAuthorized', () => {
  it('wants exactly "Bearer <CRON_SECRET>", and a secret of 16+ characters', () => {
    expect(cronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(cronAuthorized(SECRET, SECRET)).toBe(false);
    expect(cronAuthorized(`Bearer ${SECRET} `, SECRET)).toBe(false);
    expect(cronAuthorized(`bearer ${SECRET}`, SECRET)).toBe(false);
    expect(cronAuthorized(null, SECRET)).toBe(false);
    expect(cronAuthorized('Bearer undefined', undefined)).toBe(false);
    expect(cronAuthorized('Bearer ', '')).toBe(false);
    expect(cronAuthorized('Bearer short', 'short')).toBe(false);
    expect(cronAuthorized('Bearer 123456789012345', '123456789012345')).toBe(false);
    expect(cronAuthorized('Bearer 1234567890123456', '1234567890123456')).toBe(true);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('GET /api/cron/outbox (database)', () => {
  beforeEach(async () => {
    await sql('TRUNCATE reservations, reservation_events, email_outbox CASCADE');
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await sql('TRUNCATE reservations, reservation_events, email_outbox CASCADE');
    await getPool().end();
  });

  it('answers 401 without the secret, with a wrong one, and when CRON_SECRET is not set; sends nothing and says nothing more', async () => {
    await seed();
    vi.stubEnv('CRON_SECRET', SECRET);
    for (const header of [undefined, 'Bearer wrong-secret-0123456789', SECRET]) {
      const res = await call(header);
      expect(res.status).toBe(401);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ error: 'unauthorized' });
    }
    vi.stubEnv('CRON_SECRET', '');
    expect((await call('Bearer ')).status).toBe(401);
    expect((await sql(`SELECT status FROM email_outbox ORDER BY id`)).rows).toEqual([{ status: 'queued' }, { status: 'queued' }, { status: 'queued' }]);
  });

  it('with the secret, drains the due rows of its env and reports only the counts', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    vi.stubEnv('EMAIL_DELIVERY', 'log');
    await seed();
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ claimed: 1, sent: 1, skipped: 0, retried: 0, failed: 0, lost: 0 });
    expect((await sql(`SELECT to_email, status FROM email_outbox ORDER BY id`)).rows).toEqual([
      { to_email: 'a@furama.test', status: 'sent' },
      { to_email: 'b@furama.test', status: 'queued' },
      { to_email: 'c@furama.test', status: 'queued' },
    ]);
  });

  it('a drain that cannot run answers 500 with a code only', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    vi.stubEnv('EMAIL_DELIVERY', 'Live x');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await seed();
    // An unknown EMAIL_DELIVERY fails each send, not the drain: the row is retried later.
    expect(await (await call(`Bearer ${SECRET}`)).json()).toMatchObject({ claimed: 1, retried: 1 });
    await sql(`ALTER TABLE email_outbox RENAME TO email_outbox_gone`);
    try {
      const res = await call(`Bearer ${SECRET}`);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'drain_failed' });
      expect(errors).toHaveBeenCalledWith('[cron:outbox] drain failed code=42P01');
    } finally {
      await sql(`ALTER TABLE email_outbox_gone RENAME TO email_outbox`);
    }
  });
});
```

`after()` của `next/server` ném E468 ngoài phạm vi request, mà file này gọi action trực tiếp: một collector `vi.hoisted` thay nó, và test chạy task đã thu để thấy điều phản hồi sẽ kích hoạt. Sửa `test/integration/submit-reservation.test.ts`:

```diff
diff --git a/test/integration/submit-reservation.test.ts b/test/integration/submit-reservation.test.ts
index 6473f9f..9f15a64 100644
--- a/test/integration/submit-reservation.test.ts
+++ b/test/integration/submit-reservation.test.ts
@@ -1,4 +1,16 @@
 import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
+
+/*
+ * next/server's after() throws outside a request scope (E468), and these
+ * tests call the action directly: collect the callbacks instead, and run them
+ * where a test wants to see what the response would have triggered.
+ */
+const afterTasks = vi.hoisted(() => [] as (() => unknown)[]);
+vi.mock('next/server', async (importOriginal) => ({
+  ...(await importOriginal<typeof import('next/server')>()),
+  after: (task: () => unknown) => void afterTasks.push(task),
+}));
+
 import { submitReservation } from '@/app/actions';
 import { getPool } from '@/db/client';
 import { createWebReservation } from '@/lib/server/booking/create';
@@ -36,6 +48,9 @@ async function warmPool(n: number) {
 
 describe.skipIf(!process.env.TEST_DATABASE_URL)('submitReservation v2 (database)', () => {
   beforeEach(async () => {
+    afterTasks.length = 0;
+    // Recipients survive DELETE FROM reservations; another file may leave one behind. Outbox rows go with their booking.
+    await sql('DELETE FROM notification_recipients');
     await sql('DELETE FROM reservations');
     await sql('DELETE FROM closures');
     await sql('UPDATE restaurants SET booking_enabled = true, max_party = NULL, auto_confirm = NULL, lead_minutes = NULL, window_days = NULL');
@@ -67,6 +82,35 @@ describe.skipIf(!process.env.TEST_DATABASE_URL)('submitReservation v2 (database)
     expect(events.rows).toEqual([{ actor_kind: 'guest', actor_id: null, type: 'created', from_status: null, to_status: 'requested' }]);
   });
 
+  it('queues staff.new and guest.ack in the booking transaction, and sends them only after the response (spec §10.2 steps 6–7)', async () => {
+    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
+    const result = await submitReservation({ ...request, email: 'an@example.com', locale: 'en' });
+    expect(result.ok).toBe(true);
+    const queued = await sql(`SELECT event, to_email, status FROM email_outbox ORDER BY id`);
+    expect(queued.rows).toEqual([
+      { event: 'staff.new', to_email: 'fb@furamavietnam.com', status: 'queued' },
+      { event: 'guest.ack', to_email: 'an@example.com', status: 'queued' },
+    ]);
+    // after() got one task; running it is what Vercel's waitUntil does once the response is out.
+    expect(afterTasks).toHaveLength(1);
+    vi.useRealTimers();
+    await afterTasks[0]();
+    expect((await sql(`SELECT status, provider_id FROM email_outbox ORDER BY id`)).rows).toEqual([
+      { status: 'sent', provider_id: 'log' },
+      { status: 'sent', provider_id: 'log' },
+    ]);
+    expect(info.mock.calls.some(([line]) => String(line).startsWith('[outbox] sent id='))).toBe(true);
+    // The drain's own log lines carry ids and events, never an address.
+    expect(info.mock.calls.filter(([line]) => String(line).startsWith('[outbox]')).some(([line]) => String(line).includes('@'))).toBe(false);
+    info.mockRestore();
+  });
+
+  it('a refused booking schedules no drain', async () => {
+    expect(await submitReservation({ ...request, guests: 99 })).toMatchObject({ ok: false });
+    expect(await submitReservation({ ...request, name: '' })).toMatchObject({ ok: false });
+    expect(afterTasks).toHaveLength(0);
+  });
+
   it('falls back to the default language for an unknown or disabled locale', async () => {
     await submitReservation({ ...request, locale: 'vi' }); // vi exists but is disabled
     await submitReservation({ ...request, time: '19:30', locale: 'zz' });
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/email-outbox.test.ts test/integration/cron-outbox.test.ts test/integration/submit-reservation.test.ts`
Expected: FAIL `Test Files  3 failed (3)`, `Tests  1 failed | 15 passed (16)`:

```
 ❯ test/integration/submit-reservation.test.ts (16 tests | 1 failed) 618ms
     × queues staff.new and guest.ack in the booking transaction, and sends them only after the response (spec §10.2 steps 6–7) 14ms
 ❯ test/integration/email-outbox.test.ts (0 test)
 ❯ test/integration/cron-outbox.test.ts (0 test)
 FAIL  test/integration/cron-outbox.test.ts [ test/integration/cron-outbox.test.ts ]
Error: Cannot find package '@/app/api/cron/outbox/route' imported from …/test/integration/cron-outbox.test.ts
 FAIL  test/integration/email-outbox.test.ts [ test/integration/email-outbox.test.ts ]
Error: Cannot find package '@/lib/server/email/drain' imported from …/test/integration/email-outbox.test.ts
 FAIL  test/integration/submit-reservation.test.ts > submitReservation v2 (database) > queues staff.new and guest.ack in the booking transaction, and sends them only after the response (spec §10.2 steps 6–7)
AssertionError: expected [] to have a length of 1 but got +0
```

- [ ] **Bước 3: Viết E2E và chạy nó trên build hiện tại: phải đỏ**

Khách đặt Café Indochine vào ngày mở cuối từ thẻ của nó (bản đồ dữ liệu E2E); không ai được liệt kê, nên `staff.new` về hộp thư chung. Chủ đề chỉ được so theo mã đặt bàn cho tới Task 5.

Create `e2e/booking-email.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { HOME_PATH } from './paths';
import { seedReservation } from './reservation-fixtures';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * Phase 5 in a real `next start` (EMAIL_DELIVERY=log, so every email lands in
 * EMAIL_LOG_FILE): a new booking emails the staff (the general inbox when no
 * recipient is listed) and the guest, sent by after() once the action has
 * answered; confirming emails the guest; the cron endpoint wants its secret.
 * The guest books Café Indochine on its last open day, which no other spec
 * books. No spec running beside this one may add an 'all' or 'destination'
 * recipient: it would take the staff email away from the general inbox.
 */

type Logged = { to: string; subject: string; text: string };
function logged(): Logged[] {
  const file = process.env.EMAIL_LOG_FILE;
  if (!file) throw new Error('Set EMAIL_LOG_FILE (the server writes emails there) to run the booking email specs.');
  try {
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Logged);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
/** [to, subject] of every logged email about one booking. */
const about = (reference: string) => logged().filter((e) => e.subject.includes(reference)).map((e) => [e.to, e.subject]);

test.use({ reducedMotion: 'reduce' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

async function bookCafeIndochine(page: Page, guest: string): Promise<string> {
  await page.goto(HOME_PATH);
  await page.locator('.rcard:visible', { hasText: 'Café Indochine' }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  // The last day of the window is never past its sittings.
  await drawer.locator('.daystrip .day[data-state="open"]').last().click();
  await drawer.locator('.slot:not([disabled])').first().click();
  await drawer.getByLabel('Full name *', { exact: true }).fill('Nguyễn Minh Anh');
  const digits = String(Date.now()).slice(-6);
  await drawer.getByLabel('Phone *', { exact: true }).fill(`0906 ${digits.slice(0, 3)} ${digits.slice(3)}`);
  await drawer.getByLabel('Email', { exact: true }).fill(guest);
  await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
  await expect(drawer.locator('.drawer-ref')).toHaveText(/^FC-[0-9A-HJKMNP-TV-Z]{8}$/);
  return (await drawer.locator('.drawer-ref').textContent()) ?? '';
}

test('a guest booking emails the staff (the general inbox: nobody is listed) and the guest, after the response', async ({ page }) => {
  const guest = `guest-${Date.now()}@example.com`;
  const reference = await bookCafeIndochine(page, guest);
  await expect.poll(() => about(reference)).toEqual([
    ['fb@furamavietnam.com', `staff.new ${reference}`],
    [guest, `guest.ack ${reference}`],
  ]);
  const rows = await one<{ statuses: string[]; events: string[]; fallback: boolean[] }>(
    `SELECT array_agg(o.status ORDER BY o.id) AS statuses, array_agg(o.event ORDER BY o.id) AS events, array_agg(o.fallback ORDER BY o.id) AS fallback
       FROM email_outbox o JOIN reservations r ON r.id = o.reservation_id WHERE r.reference = $1`,
    [reference],
  );
  expect(rows).toEqual({ statuses: ['sent', 'sent'], events: ['staff.new', 'guest.ack'], fallback: [true, false] });
});

test('confirming in the admin emails the guest', async ({ page }) => {
  await seedStaff();
  const r = await seedReservation();
  const guest = `confirm-${r.id}@example.com`;
  await one(`UPDATE reservations SET email = $2 WHERE id = $1`, [r.id, guest]);
  await signInAs(page, STAFF.editor);
  await page.goto(`/admin/reservations/${r.id}`);
  await page.getByRole('main').getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByRole('main').getByRole('status')).toHaveText('Đã cập nhật trạng thái.');
  await expect.poll(() => about(r.reference)).toEqual([[guest, `guest.confirmed ${r.reference}`]]);
  expect(await one(`SELECT status, attempts FROM email_outbox WHERE reservation_id = $1`, [r.id])).toEqual({ status: 'sent', attempts: 1 });
});

test('the cron endpoint answers 401 without its secret, and drains with it', async ({ request }) => {
  expect((await request.get('/api/cron/outbox')).status()).toBe(401);
  expect((await request.get('/api/cron/outbox', { headers: { authorization: 'Bearer not-the-secret-at-all' } })).status()).toBe(401);
  const res = await request.get('/api/cron/outbox', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toBe('no-store');
  expect(await res.json()).toMatchObject({ claimed: expect.any(Number), failed: 0 });
});
```

Cất tạm các file ngoài `e2e/` của bước 1, build, chạy `e2e/booking-email.spec.ts --project=desktop` (với `CRON_SECRET` trong tiền tố). Expected: `3 failed`:

```
  ✘  1 [desktop] › e2e/booking-email.spec.ts:56:5 › a guest booking emails the staff (the general inbox: nobody is listed) and the guest, after the response (6.3s)
  ✘  2 [desktop] › e2e/booking-email.spec.ts:71:5 › confirming in the admin emails the guest (5.8s)
  ✘  3 [desktop] › e2e/booking-email.spec.ts:84:5 › the cron endpoint answers 401 without its secret, and drains with it (89ms)
    Error: expect(received).toEqual(expected) // deep equality
    -     "staff.new FC-81SMPM9Y",
    -     "guest.ack FC-81SMPM9Y",
    + Array []
    - Timeout 5000ms exceeded while waiting on the predicate
    Error: expect(received).toBe(expected) // Object.is equality
    Expected: 401
    Received: 404
```

Lấy lại các file đã cất.

- [ ] **Bước 4: Đọc lại đặt bàn cho email, và bộ render tối thiểu**

Sửa `lib/server/booking/rules.ts` (một định nghĩa của số điện thoại nhóm, cho loader và cho email):

```diff
diff --git a/lib/server/booking/rules.ts b/lib/server/booking/rules.ts
index 58e8848..be6b3c8 100644
--- a/lib/server/booking/rules.ts
+++ b/lib/server/booking/rules.ts
@@ -18,6 +18,17 @@ export type Db = Pool | PoolClient;
 
 export type LoadedRules = { rules: BookingRules; groupPhone: GroupPhone | null };
 
+/**
+ * SQL: the number guests call about the restaurant aliased `restaurant`: its
+ * destination's, else the first destination that has one (phase-4 R11). The
+ * booking emails print the same number (lib/server/email/booking/load.ts).
+ */
+export const groupPhoneSql = (restaurant: string) => `(SELECT json_build_object('display', d.phone_display, 'tel', d.phone_e164)
+               FROM destinations d
+              WHERE d.phone_e164 IS NOT NULL
+              ORDER BY (d.id = ${restaurant}.destination) DESC, d.sort_order, d.id
+              LIMIT 1)`;
+
 type RulesRow = {
   id: string;
   name: string;
@@ -48,11 +59,7 @@ export async function loadBookingRules(db: Db, restaurantIds: readonly string[],
             to_char(s.same_day_cutoff, 'HH24:MI')         AS same_day_cutoff,
             COALESCE(r.max_party, s.max_party)::int       AS max_party,
             COALESCE(r.auto_confirm, s.auto_confirm)      AS auto_confirm,
-            (SELECT json_build_object('display', d.phone_display, 'tel', d.phone_e164)
-               FROM destinations d
-              WHERE d.phone_e164 IS NOT NULL
-              ORDER BY (d.id = r.destination) DESC, d.sort_order, d.id
-              LIMIT 1) AS group_phone,
+            ${groupPhoneSql('r')} AS group_phone,
             COALESCE((
               SELECT json_agg(json_build_object(
                        'id', p.id::text, 'meal', p.meal, 'weekdays', p.weekdays,
```

Create `lib/server/email/booking/load.ts` (không bao giờ đọc `reservation_notes`, quy tắc code 10):

```ts
import 'server-only';
import type { Pool, PoolClient } from 'pg';
import type { GroupPhone, ReservationStatus } from '@/lib/booking/rules';
import { groupPhoneSql } from '@/lib/server/booking/rules';
import type { IsoDate } from '@/lib/venue-time';

/*
 * The reservation as a booking email shows it, read when the email is sent
 * (spec §10.4: the sender re-reads the booking): the drain decides from it
 * whether the email still holds (R7), and the renderer prints it, so an edit
 * made after the email was queued shows, and email_outbox holds no guest text
 * but the address. Internal notes (reservation_notes) are never loaded here
 * (code rule 10).
 */

export type BookingEmailData = {
  reservationId: string;
  reference: string;
  restaurantName: string;
  date: IsoDate;
  time: string;
  guests: number;
  status: ReservationStatus;
  /** The decline or cancellation reason staff typed; a guest reads it verbatim. */
  statusReason: string | null;
  guestName: string;
  phone: string;
  email: string | null;
  /** The guest's own request from the form. */
  note: string | null;
  /** The destination's number, which guests call (lib/server/booking/rules.ts groupPhoneSql). */
  groupPhone: GroupPhone | null;
  /** Phase 10's anonymiser ran: nothing is sent about it any more. */
  anonymized: boolean;
};

type DataRow = {
  id: string;
  reference: string;
  restaurant_name: string;
  date: string;
  time: string;
  guests: number;
  status: ReservationStatus;
  status_reason: string | null;
  guest_name: string;
  phone: string;
  email: string | null;
  note: string | null;
  group_phone: GroupPhone | null;
  anonymized: boolean;
};

/** The booking, or null when it no longer exists. Dates leave SQL through to_char (phase-4 code rule 3). */
export async function loadBookingEmailData(db: Pool | PoolClient, reservationId: string): Promise<BookingEmailData | null> {
  const { rows } = await db.query<DataRow>(
    `SELECT r.id::text, r.reference, t.name AS restaurant_name, to_char(r.reserved_on, 'YYYY-MM-DD') AS date,
            r.reserved_at AS time, r.guests, r.status, r.status_reason, r.guest_name, r.phone, r.email, r.note,
            ${groupPhoneSql('t')} AS group_phone, r.anonymized_at IS NOT NULL AS anonymized
       FROM reservations r JOIN restaurants t ON t.id = r.restaurant_id
      WHERE r.id = $1`,
    [reservationId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    reservationId: r.id,
    reference: r.reference,
    restaurantName: r.restaurant_name,
    date: r.date,
    time: r.time,
    guests: r.guests,
    status: r.status,
    statusReason: r.status_reason,
    guestName: r.guest_name,
    phone: r.phone,
    email: r.email,
    note: r.note,
    groupPhone: r.group_phone,
    anonymized: r.anonymized,
  };
}
```

Create `lib/server/email/booking/render.ts` (thân tạm; Task 5 thay):

```ts
import 'server-only';
import type { Pool, PoolClient } from 'pg';
import type { EmailEvent } from '@/lib/email/events';
import type { BookingEmailData } from './load';

/*
 * The email of one outbox row, ready for the mailer. Deliberately minimal
 * until the registry templates arrive (phase 5, Task 5): the event and the
 * reference as the subject, plain facts as the body, nothing personal.
 */

export type RenderedEmail = { subject: string; html: string; text: string; replyTo?: string };

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function renderOutboxEmail(
  _db: Pool | PoolClient,
  row: { event: EmailEvent; locale: string },
  data: BookingEmailData,
): Promise<RenderedEmail> {
  const subject = `${row.event} ${data.reference}`;
  const text = `${subject}: ${data.restaurantName}, ${data.date} ${data.time}, ${data.guests}`;
  return { subject, text, html: `<p>${escapeHtml(text)}</p>` };
}
```

- [ ] **Bước 5: Viết bộ gửi**

Mỗi lần giữ là một câu lệnh autocommit: CTE `FOR UPDATE SKIP LOCKED LIMIT 1` rồi `UPDATE` đặt `sending`, `attempts + 1`, `locked_until = now() + 120 s` và Message-ID (chỉ lần đầu biết tên miền; `gen_random_uuid()` cho 12 ký tự hex). Mọi lần đánh dấu sau đó có `WHERE id = $1 AND attempts = $2 AND status = 'sending'`. Chỉ phần đọc lại, render và gửi nằm trong `try`; một lỗi sau khi máy SMTP đã nhận thư không phải lỗi gửi (C14).

Create `lib/server/email/drain.ts`:

```ts
import 'server-only';
import type { Pool } from 'pg';
import { getPool } from '@/db/client';
import { EVENT_STATUSES, type EmailEvent } from '@/lib/email/events';
import { loadBookingEmailData, type BookingEmailData } from './booking/load';
import { renderOutboxEmail } from './booking/render';
import { outboxEnv } from './env';
import { openMailer, senderDomain, type EmailDeps, type Mailer } from './send';
import { EmailSendError, describeEmailError, type SendEmailResult } from './types';

/*
 * The outbox sender (spec §10.4). Called by after() once a booking change has
 * committed, by the cron every 5 minutes, and by "Gửi lại".
 *
 * SMTP has no idempotency key, so delivery is AT LEAST ONCE (R1):
 *   1. claim one due row: FOR UPDATE SKIP LOCKED, then status 'sending', a
 *      lease (locked_until), attempts + 1, and a Message-ID fixed for good;
 *   2. re-read the booking: an event that no longer matches its status is
 *      marked skipped, never sent (R7);
 *   3. send over SMTP, holding no database connection meanwhile;
 *   4. mark it sent, or schedule the next attempt, fenced by `attempts` so a
 *      drain whose lease ran out cannot overwrite a newer claim.
 * A crash between 3 and 4 leaves the row 'sending' until the lease ends; the
 * next drain sends it again with the same Message-ID. Two drains never claim
 * the same row while its lease holds. Rows are claimed one at a time, so the
 * lease only has to cover one send. Every statement is autocommitted (code
 * rule 2). Log lines carry ids, events, codes and attempts, never an address.
 */

/** Wait after failed attempt n (1-based): 1 m, 5 m, 15 m, 1 h, 6 h, 12 h. Attempt 7 failing marks the row failed. */
export const RETRY_DELAYS_MINUTES = [1, 5, 15, 60, 360, 720] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MINUTES.length + 1;
/** Longer than one send can take (send.ts caps it at 30 s), short enough that a crashed claim is picked up by the next cron. */
export const LEASE_SECONDS = 120;

export type DrainOptions = {
  /** Rows to send first (the ids a write just queued); then any other due row of this env. */
  ids?: readonly string[];
  /** At most this many claims in one drain. */
  limit?: number;
  /** Stop claiming once this much time has passed; a claim already made is finished. */
  budgetMs?: number;
  pool?: Pool;
  env?: Record<string, string | undefined>;
  /** Tests: the mailer's transport, sink and timeouts. */
  mailer?: Partial<EmailDeps>;
};

/**
 * `lost`: claims whose outcome this drain could not record: a newer claim took
 * the row over (the fence), or the 'sent' mark failed twice (the lease then
 * hands the row to a later drain, which sends it again with its Message-ID).
 */
export type DrainReport = { claimed: number; sent: number; skipped: number; retried: number; failed: number; lost: number };

export type ClaimedRow = {
  id: string;
  event: EmailEvent;
  reservation_id: string;
  to_email: string;
  locale: string;
  attempts: number;
  idempotency_key: string;
  message_id: string | null;
};

async function claimOne(pool: Pool, env: string, ids: readonly string[] | null, domain: string | null): Promise<ClaimedRow | null> {
  const { rows } = await pool.query<ClaimedRow>(
    `WITH next AS (
       SELECT id FROM email_outbox
        WHERE env = $1
          AND (status = 'queued' OR (status = 'sending' AND locked_until < now()))
          AND attempts < $5
          AND next_attempt_at <= now()
          AND ($2::bigint[] IS NULL OR id = ANY ($2::bigint[]))
        ORDER BY next_attempt_at, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE email_outbox o
        SET status = 'sending',
            attempts = o.attempts + 1,
            locked_until = now() + make_interval(secs => $3),
            -- Fixed at the first claim that knows the sending domain (R5); a random part keeps two
            -- databases (a Preview branch, two developers) from ever minting the same Message-ID.
            message_id = coalesce(o.message_id,
              CASE WHEN $4::text IS NOT NULL
                   THEN '<outbox-' || o.id || '.' || left(replace(gen_random_uuid()::text, '-', ''), 12) || '@' || $4 || '>' END),
            updated_at = now()
       FROM next
      WHERE o.id = next.id
      RETURNING o.id::text, o.event, o.reservation_id::text, o.to_email, o.locale, o.attempts, o.idempotency_key, o.message_id`,
    [env, ids, LEASE_SECONDS, domain, MAX_ATTEMPTS],
  );
  return rows[0] ?? null;
}

/** A claim whose function died on its last attempt: nothing will report back, so it ends here (R6). */
async function reapExhausted(pool: Pool, env: string): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE email_outbox
        SET status = 'failed', locked_until = NULL, updated_at = now(),
            last_error = coalesce(last_error, 'lease_expired: the last attempt never reported back')
      WHERE env = $1 AND status = 'sending' AND locked_until < now() AND attempts >= $2`,
    [env, MAX_ATTEMPTS],
  );
  return rowCount ?? 0;
}

/** Why a claimed row must not be sent any more (R7), or null when it still holds. */
function staleReason(row: ClaimedRow, booking: BookingEmailData | null): string | null {
  if (!booking) return 'skipped: the booking no longer exists';
  if (booking.anonymized) return 'skipped: the booking was anonymised';
  if (!EVENT_STATUSES[row.event].includes(booking.status)) return `skipped: the booking is now ${booking.status}`;
  // A guest email goes only to the address the booking still has; a corrected one is not emailed automatically.
  if (row.event.startsWith('guest.') && booking.email?.trim().toLowerCase() !== row.to_email.trim().toLowerCase()) {
    return 'skipped: the guest email changed';
  }
  return null;
}

/** Every mark after a claim is fenced (code rule 3): a drain whose lease ran out must not overwrite the newer claim. */
async function mark(pool: Pool, row: ClaimedRow, sql: string, values: unknown[]): Promise<boolean> {
  const { rowCount } = await pool.query(`${sql} WHERE id = $1 AND attempts = $2 AND status = 'sending'`, [row.id, row.attempts, ...values]);
  return rowCount === 1;
}

export async function drainOutbox(options: DrainOptions = {}): Promise<DrainReport> {
  const pool = options.pool ?? getPool();
  const env = options.env ?? process.env;
  const own = outboxEnv(env);
  const domain = senderDomain(env.EMAIL_FROM);
  const limit = options.limit ?? 50;
  const budgetMs = options.budgetMs ?? 20_000;
  const started = Date.now();
  const report: DrainReport = { claimed: 0, sent: 0, skipped: 0, retried: 0, failed: 0, lost: 0 };

  report.failed += await reapExhausted(pool, own);
  const mailer = openMailer({ env, ...options.mailer });
  try {
    const phases: (readonly string[] | null)[] = options.ids?.length ? [options.ids, null] : [null];
    for (const ids of phases) {
      while (report.claimed < limit && Date.now() - started < budgetMs) {
        const row = await claimOne(pool, own, ids, domain);
        if (!row) break;
        report.claimed += 1;
        await deliver(pool, mailer, row, report);
      }
    }
  } finally {
    mailer.close();
  }
  return report;
}

async function deliver(pool: Pool, mailer: Mailer, row: ClaimedRow, report: DrainReport): Promise<void> {
  const tag = `id=${row.id} event=${row.event} attempt=${row.attempts}`;
  let result: SendEmailResult;
  try {
    const booking = await loadBookingEmailData(pool, row.reservation_id);
    const stale = staleReason(row, booking);
    if (stale) {
      if (await mark(pool, row, `UPDATE email_outbox SET status = 'skipped', locked_until = NULL, last_error = $3, updated_at = now()`, [stale])) {
        report.skipped += 1;
        console.info(`[outbox] skipped ${tag} (${stale.slice('skipped: '.length)})`);
      } else report.lost += 1;
      return;
    }
    const email = await renderOutboxEmail(pool, row, booking!);
    result = await mailer.send({
      to: row.to_email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      replyTo: email.replyTo,
      idempotencyKey: row.idempotency_key,
      messageId: row.message_id ?? undefined,
    });
  } catch (error) {
    await scheduleRetry(pool, row, error, report, tag);
    return;
  }
  // The SMTP server has the message: from here on nothing may schedule a second send (C14).
  await markSent(pool, row, result, report, tag);
}

async function scheduleRetry(pool: Pool, row: ClaimedRow, error: unknown, report: DrainReport, tag: string): Promise<void> {
  // A recipient refused for good fails at once (R6); everything else waits for the next step of the ladder.
  const final = (error instanceof EmailSendError && error.code === 'rejected') || row.attempts >= MAX_ATTEMPTS;
  const delay = RETRY_DELAYS_MINUTES[Math.min(row.attempts, RETRY_DELAYS_MINUTES.length) - 1];
  const ok = await mark(
    pool,
    row,
    `UPDATE email_outbox
        SET status = CASE WHEN $4 THEN 'failed' ELSE 'queued' END,
            next_attempt_at = CASE WHEN $4 THEN next_attempt_at ELSE now() + make_interval(mins => $5) END,
            locked_until = NULL, last_error = $3, updated_at = now()`,
    [describeEmailError(error), final, delay],
  );
  const code = error instanceof EmailSendError ? error.code : 'unknown';
  if (!ok) report.lost += 1;
  else if (final) {
    report.failed += 1;
    console.error(`[outbox] failed ${tag} code=${code}`);
  } else {
    report.retried += 1;
    console.warn(`[outbox] retry ${tag} code=${code} in=${delay}m`);
  }
}

/**
 * Records a send the server accepted. A database error here is not a send
 * failure: the mark is tried once more, and if it still fails the row stays
 * 'sending' (logged as mark_failed). Its lease then runs out and a later drain
 * sends it again with the same Message-ID, a duplicate R1 accepts, instead of
 * a retry being scheduled for an email that already went out.
 */
async function markSent(pool: Pool, row: ClaimedRow, result: SendEmailResult, report: DrainReport, tag: string): Promise<void> {
  const sql = `UPDATE email_outbox SET status = 'sent', sent_at = now(), provider_id = $3, locked_until = NULL, last_error = NULL, updated_at = now()`;
  for (let attempt = 1; ; attempt++) {
    try {
      if (await mark(pool, row, sql, [result.id ?? result.mode])) {
        report.sent += 1;
        console.info(`[outbox] sent ${tag}`);
      } else report.lost += 1;
      return;
    } catch (error) {
      if (attempt === 2) {
        report.lost += 1;
        console.error(`[outbox] sent but not recorded ${tag} code=mark_failed`, { pg: (error as { code?: string } | null)?.code ?? 'unknown' });
        return;
      }
    }
  }
}

/** For after(): never throws (a drain that cannot run is retried by the cron), logs no personal data. */
export async function drainQuietly(options: DrainOptions): Promise<void> {
  try {
    await drainOutbox(options);
  } catch (error) {
    const code = (error as { code?: string } | null)?.code ?? 'unknown';
    console.error(`[outbox] drain failed code=${code}`);
  }
}
```

- [ ] **Bước 6: `after()` sau COMMIT, route cron, `vercel.json`**

Create `lib/server/email/after-commit.ts`:

```ts
import 'server-only';
import { after } from 'next/server';
import { drainQuietly } from './drain';

/**
 * spec §10.2 step 7 and §10.4 (R20): once a write has committed, send what it
 * queued first, then whatever else is due in this env (a retry under the
 * cron's 5 minutes goes out with the next write), at most 10 rows in 25 s.
 * after() keeps the function alive past the response (Vercel's waitUntil:
 * node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md:50,
 * 247-260) and runs even when the action threw or redirected (after.md:54),
 * so callers schedule it only after COMMIT, once the ids exist, and before
 * redirect(). It never throws: drainQuietly logs a code and the cron retries.
 */
export function drainAfterCommit(ids: readonly string[]): void {
  after(() => drainQuietly({ ids: [...ids], limit: 10, budgetMs: 25_000 }));
}
```

Create `lib/server/cron.ts` (so trên digest SHA-256 nên hai vế luôn dài bằng nhau cho `timingSafeEqual`; secret dưới 16 ký tự không cho gì qua):

```ts
import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when the project has
 * CRON_SECRET. Compared in constant time over SHA-256 digests (equal lengths,
 * whatever was sent); no secret, or one shorter than 16 characters,
 * authorises nothing (spec §12: a cron call without it is 401). Kept out of
 * the route file, which exports only its handler and segment config.
 */
export function cronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header ?? ''), digest(`Bearer ${secret}`));
}
```

Create `app/api/cron/outbox/route.ts`:

```ts
import { cronAuthorized } from '@/lib/server/cron';
import { drainOutbox } from '@/lib/server/email/drain';

/*
 * Vercel Cron, every 5 minutes (vercel.json; production deployments only):
 * sends what after() could not, and every retry that has come due (spec
 * §10.4). Without `Authorization: Bearer $CRON_SECRET` it is 401 (spec §12).
 * Reading request.headers keeps the handler out of prerendering
 * (node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md:124).
 * The answer is counts or an error code: no address, no secret.
 */

/** Seconds; the drain stops claiming at 240 s, so a send already claimed still has a minute to finish. */
export const maxDuration = 300;

const NO_STORE = { 'cache-control': 'no-store' };

export async function GET(request: Request): Promise<Response> {
  if (!cronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }
  try {
    const report = await drainOutbox({ budgetMs: 240_000, limit: 500 });
    return Response.json(report, { headers: NO_STORE });
  } catch (error) {
    console.error(`[cron:outbox] drain failed code=${(error as { code?: string } | null)?.code ?? 'unknown'}`);
    return Response.json({ error: 'drain_failed' }, { status: 500, headers: NO_STORE });
  }
}
```

Create `vercel.json` (R19: không `vercel.ts`; dạng `export const config` của `@vercel/config` biên dịch thành `{"config":{"crons":…}}` và lặng lẽ không đăng ký cron):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [{ "path": "/api/cron/outbox", "schedule": "*/5 * * * *" }]
}
```

- [ ] **Bước 7: Lên lịch gửi sau mỗi lần ghi đặt bàn**

Sửa `app/actions.ts` (bước 7 của spec §10.2; chỉ khi kết quả ok, nghĩa là đã COMMIT):

```diff
diff --git a/app/actions.ts b/app/actions.ts
index 9b84d45..5150505 100644
--- a/app/actions.ts
+++ b/app/actions.ts
@@ -3,6 +3,7 @@
 import type { BookingErrorCode } from '@/lib/booking-errors';
 import { createWebReservation } from '@/lib/server/booking/create';
 import { parseReservationInput } from '@/lib/server/booking/input';
+import { drainAfterCommit } from '@/lib/server/email/after-commit';
 import type { IsoDate } from '@/lib/venue-time';
 
 export type ReservationResult =
@@ -10,8 +11,8 @@ export type ReservationResult =
   | { ok: false; code: BookingErrorCode; params?: Record<string, string> };
 
 /**
- * Books a table (spec §10.2, steps 2, 3, 4, 6 and 7; BotID, the honeypot, the
- * phone limit and the outbox arrive in phase 5). Everything the client claimed
+ * Books a table (spec §10.2, steps 2, 3, 4, 6 and 7; BotID, the honeypot and
+ * the phone limit come with phase 5's anti-spam work). Everything the client claimed
  * is parsed with zod, then re-checked against the venue's clock and the live
  * rules inside one locked transaction. Failures come back as codes; the
  * browser turns them into copy. A database error throws, so the guest sees
@@ -22,5 +23,7 @@ export async function submitReservation(input: unknown): Promise<ReservationResu
   if (!parsed.ok) return parsed;
   const result = await createWebReservation(parsed.value);
   if (!result.ok) return result;
+  // Step 7: the booking has committed; its emails go out after the response (a failed send never fails the booking, spec §12).
+  drainAfterCommit(result.outboxIds);
   return { ok: true, data: { reference: result.reference, date: result.date, status: result.status } };
 }
```

Sửa `app/admin/(shell)/reservations/actions.ts` (`createReservation` lên lịch trước `redirect()`; hủy hàng loạt lên lịch trong `finally`, vì mỗi lần hủy commit riêng và một lỗi giữa chừng vẫn phải gửi email của những lần đã commit, R20):

```diff
diff --git a/app/admin/(shell)/reservations/actions.ts b/app/admin/(shell)/reservations/actions.ts
index 886f919..daeff30 100644
--- a/app/admin/(shell)/reservations/actions.ts
+++ b/app/admin/(shell)/reservations/actions.ts
@@ -8,6 +8,7 @@ import type { ReservationStatus } from '@/lib/booking/rules';
 import { toE164 } from '@/lib/phone';
 import { actionError, type ActionResult } from '@/lib/server/action-result';
 import { listLocales } from '@/lib/server/booking/queries';
+import { drainAfterCommit } from '@/lib/server/email/after-commit';
 import { outboxEffects } from '@/lib/server/email/outbox';
 import {
   addReservationNote,
@@ -24,7 +25,8 @@ import { requirePermission } from '@/lib/server/dal/session';
  * refresh() → ActionResult. Editor and Admin alike (spec §7.1). Reservations
  * are never cached, so there is no tag to expire; refresh() re-renders the
  * page in the same response. A change that emails the guest queues its
- * email_outbox rows in the same transaction (outboxEffects, spec §10.3–10.4).
+ * email_outbox rows in the same transaction (outboxEffects, spec §10.3–10.4),
+ * and drainAfterCommit sends them once it has committed (R20).
  */
 
 const field = (formData: FormData, name: string) => formData.get(name) ?? undefined;
@@ -45,6 +47,7 @@ export async function changeStatus(
     const effects = outboxEffects();
     const result = await transitionReservation(getPool(), staffActor(staff), input, { effects });
     if (!result.ok) return result;
+    drainAfterCommit(effects.queued);
     refresh();
     return { ok: true, data: { status: result.data.status } };
   } catch (err) {
@@ -110,6 +113,8 @@ export async function createReservation(_prev: ActionResult | null, formData: Fo
       { effects },
     );
     if (!result.ok) return result;
+    // Before redirect(), which throws: after() is only scheduled once the booking has committed.
+    drainAfterCommit(effects.queued);
     // redirect() throws NEXT_REDIRECT, which actionError() rethrows (unstable_rethrow): it may sit in the try (R13).
     redirect(`/admin/reservations/${result.data.id}`);
   } catch (err) {
@@ -133,15 +138,20 @@ export async function cancelReservations(_prev: ActionResult<CancelManyResult> |
     const actor = staffActor(staff);
     const effects = outboxEffects();
     let cancelled = 0;
-    for (const item of input.items) {
-      const [id, version] = item.split(':');
-      const result = await transitionReservation(
-        pool,
-        actor,
-        { id, version: Number(version), to: 'cancelled', reason: input.reason, notifyGuest: input.notifyGuest },
-        { effects },
-      );
-      if (result.ok) cancelled += 1;
+    try {
+      for (const item of input.items) {
+        const [id, version] = item.split(':');
+        const result = await transitionReservation(
+          pool,
+          actor,
+          { id, version: Number(version), to: 'cancelled', reason: input.reason, notifyGuest: input.notifyGuest },
+          { effects },
+        );
+        if (result.ok) cancelled += 1;
+      }
+    } finally {
+      // Each cancel commits on its own: a throw halfway still sends the emails of those that did (R20).
+      if (effects.queued.length > 0) drainAfterCommit(effects.queued);
     }
     refresh();
     return { ok: true, data: { cancelled, skipped: input.items.length - cancelled } };
```

Sửa `scripts/check-prerender.mjs` (luật 1c: route cron phải được build như route handler và không bao giờ prerender; một lần chạy lúc build là mọi lần gửi nó từng làm):

```diff
diff --git a/scripts/check-prerender.mjs b/scripts/check-prerender.mjs
index e3281df..3084095 100644
--- a/scripts/check-prerender.mjs
+++ b/scripts/check-prerender.mjs
@@ -92,12 +92,14 @@ for (const [route, entry] of adminRoutes) {
 /*
  * 1c. Availability is never cached (spec §6.2): a GET handler that stops
  * reading the request is prerendered at build time, and every guest would get
- * the build's slots. The route must not be in the prerender manifest at all.
+ * the build's slots. The outbox cron (spec §10.4) likewise: prerendered, its
+ * one build-time run would be all the sending it ever did. Neither route may
+ * be in the prerender manifest at all.
  * It must also be in the build as a route handler: a moved or renamed route
  * is missing from the prerender manifest too, so that test alone would pass
  * on a build without it.
  */
-const UNCACHED = ['/api/availability'];
+const UNCACHED = ['/api/availability', '/api/cron/outbox'];
 const appPaths = JSON.parse(readFileSync(join(dir, 'server', 'app-paths-manifest.json'), 'utf8'));
 for (const route of UNCACHED) {
   if (!appPaths[`${route}/route`]) {
```

Sửa `.github/workflows/ci.yml` (spec cron của E2E đọc `CRON_SECRET` từ môi trường; `webServer` của Playwright thừa kế nó):

```diff
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index 9504d1a..2b7263b 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -48,8 +48,10 @@ jobs:
       - name: Check the prerendered pages and the fonts
         run: node scripts/check-prerender.mjs
       - run: npx playwright install --with-deps chromium
-      - name: Make a session secret for this run
-        run: echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" >> "$GITHUB_ENV"
+      - name: Make a session secret and a cron secret for this run
+        run: |
+          echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" >> "$GITHUB_ENV"
+          echo "CRON_SECRET=$(openssl rand -hex 16)" >> "$GITHUB_ENV"
       - name: End-to-end
         run: npm run test:e2e
         env:
```

- [ ] **Bước 8: Chạy lại test, rồi kiểm rằng chúng bắt được từng guard**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/email-outbox.test.ts test/integration/cron-outbox.test.ts test/integration/submit-reservation.test.ts`
Expected: PASS `Test Files  3 passed (3)`, `Tests  45 passed (45)`

Làm lần lượt từng đột biến dưới đây trong `lib/server/email/drain.ts`, chạy `npx vitest run test/integration/email-outbox.test.ts test/integration/cron-outbox.test.ts` (cùng `TEST_DATABASE_URL`), ghi số test đỏ, rồi **trả file về như cũ** trước đột biến kế tiếp (`git diff` của file phải rỗng khi xong). Mỗi đột biến làm đúng các test này đỏ, các test khác xanh (29 test):

| Đột biến | Test đỏ |
|---|---|
| M1: lệnh giữ bỏ qua lease: `AND status IN ('queued', 'sending')` | 4 đỏ: "two drains at once …", "a crash between the send and \"sent\" …", "the \"sent\" mark failing …(C14)", "a drain whose lease ran out mid-send …" |
| M2: bỏ rào `attempts` (`WHERE id = $1 AND $2::int IS NOT NULL AND status = 'sending'`) | 1 đỏ: "a drain whose lease ran out mid-send cannot overwrite the newer claim (fenced by attempts)" |
| M3: bỏ kiểm còn khớp (`const stale = booking ? null : staleReason(row, booking);`) | 2 đỏ: "skips an email that no longer matches the booking …", "skips a guest email whose address changed …" |
| M4: `FOR UPDATE` không `SKIP LOCKED` | 1 đỏ: "a row locked elsewhere does not stall the drain: it sends the others now (SKIP LOCKED)" |
| M5: bỏ lọc env của lệnh giữ (`WHERE $1::text IS NOT NULL`) | 4 đỏ: "drains only its own env …", "log mode marks rows sent without SMTP …", và hai test cron "with the secret, drains the due rows of its env …", "a drain that cannot run answers 500 with a code only" |
| C14: đánh dấu `sent` chỉ thử một lần (`if (attempt === 1) {`) | 1 đỏ: "the \"sent\" mark failing after a send is not a send failure …" |

- [ ] **Bước 9: Chạy cổng kiểm tra**

Expected:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo;
- `Test Files  58 passed (58)`, `Tests  671 passed (671)`;
- `Applied 7 migration(s).`; build thoát 0 và liệt kê `ƒ /api/cron/outbox`; `.next/server/functions-config-manifest.json` có `"/api/cron/outbox": { "maxDuration": 300 }`; check-prerender in `Uncached check passed: /api/availability, /api/cron/outbox built as a route handler, not prerendered.`;
- E2E `122 passed`; visual `8 passed`.

- [ ] **Bước 10: Commit**

```bash
git add .github/workflows/ci.yml app/actions.ts "app/admin/(shell)/reservations/actions.ts" app/api/cron/outbox/route.ts e2e/booking-email.spec.ts lib/server/booking/rules.ts lib/server/cron.ts lib/server/email/after-commit.ts lib/server/email/booking/load.ts lib/server/email/booking/render.ts lib/server/email/drain.ts scripts/check-prerender.mjs test/integration/cron-outbox.test.ts test/integration/email-outbox.test.ts test/integration/submit-reservation.test.ts vercel.json
git commit -m "$(cat <<'EOF'
feat: send the outbox after commit, from a cron every five minutes, at least once

drainOutbox is the outbox's sender (spec §10.4). SMTP has no idempotency
key, so delivery is at least once: it claims one due row of its own env at
a time (FOR UPDATE SKIP LOCKED, a 120-second lease, attempts counted at the
claim, a Message-ID <outbox-<id>.<12 hex>@<domain> fixed at the first claim),
re-reads the booking and skips an email that no longer holds (another
status, an anonymised booking, a changed guest address), sends without
holding a database connection, and records the outcome with marks fenced on
the claim's attempt. Failures wait 1, 5, 15, 60, 360 and 720 minutes, seven
attempts in about 19.4 hours, then the row is failed; a recipient refused at
RCPT TO fails at once; a claim that died on its last attempt is reaped. A
database error after the server accepted the message is not a send failure:
the sent mark is tried once more, then the row is left to its lease.

Every booking write schedules drainAfterCommit after it commits (the guest
submit, a status change, a staff booking before its redirect, and a bulk
cancel in a finally): after() drains the ids it queued, then other due
rows, at most 10 in 25 s. GET /api/cron/outbox (maxDuration 300, no-store,
dynamic) drains up to 500 rows in 240 s, behind Authorization: Bearer
$CRON_SECRET of 16+ characters compared in constant time; vercel.json runs
it every five minutes. check-prerender keeps it out of prerendering; CI
makes a CRON_SECRET per run. The email body is minimal until the registry
templates arrive.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Template EN/VI lấy chữ từ registry

Năm email đặt bàn (spec §10.4) đọc chữ từ key `email.<sự kiện>.<trường>` và `email.common.*`, EN và VI, màn "emails"; bản ghi `content_strings` ghi đè đúng như web khách (đợt 7 sửa được trong `/admin/content/emails`). Bộ gửi đọc đặt bàn một lần (Task 4), rồi `renderOutboxEmail` chọn ngôn ngữ (R10), nạp chữ, dựng và render (C8). Reply-To theo R11. Task này cũng đo dung lượng react-email (việc hoãn của đợt 3).

**Files:**
- Create: `lib/server/email/booking/format.ts`, `lib/server/email/templates/booking.tsx`, `lib/server/email/booking/render.test.ts`, `test/integration/email-screens.test.ts`
- Modify: `lib/i18n/registry.ts`, `lib/server/content/strings.queries.ts`, `lib/server/email/send.ts`, `lib/server/email/templates/layout.tsx`, `lib/server/email/booking/render.ts`, `test/integration/email-outbox.test.ts`, `e2e/booking-email.spec.ts`

**Interfaces:**
- Consumes: `BookingEmailData`, `loadBookingEmailData` (Task 4); `renderEmail` (Task 2); `appOrigin` (Task 2); `resolveStrings`, `registryLocaleDefault`, `formatMessage`, `StringKey` (đợt 2); `audienceOf`, `EmailEvent`, `EmailAudience` (Task 1).
- Produces:
  - `lib/server/content/strings.queries.ts`: `loadStringRows(locale, keys, db?: Pool | PoolClient)`.
  - `lib/server/email/booking/format.ts`: `formatEmailDate(date, bcp47)`, `formatEmailShortDate(date, bcp47)`, `formatEmailTime(time, bcp47)`.
  - `lib/server/email/templates/booking.tsx`: `BookingEmail`, `type BookingEmailProps`; `layout.tsx`: `EmailLayout({ preview, children, lang?, footer? })`, `emailStyles` có thêm `detailsTable`, `detailsLabel`, `detailsValue`, `quote`.
  - `lib/server/email/booking/render.ts`: `type EmailKey`, `type EmailLocale = { code; bcp47 }`, `emailKeys(event)`, `buildBookingEmail(event, data, strings, locale, { adminOrigin }): { subject; preview; element }` (thuần), `resolveEmailLocale(db, requested, audience, event)`, `loadEmailStrings(db, event, locale)`, `sharedInbox(db)`, `type RenderedEmail = { subject; html; text; replyTo?; locale }`, `renderOutboxEmail(db, row, data)` (chữ ký của Task 4).

- [ ] **Bước 1: Viết test render**

Test đơn vị dựng email từ chữ của registry (không DB): 10 tổ hợp sự kiện × ngôn ngữ, bảng chữ thường thẳng hàng, nội dung của khách khác của nhân viên, lý do chỉ ở từ chối/hủy, lời mở đầu trùng màn hình xong của F2 (không còn `skipIf`: F2 đã ở `main`), chủ đề nhân viên, escape, link nhân viên một lần trong chữ thường.

Create `lib/server/email/booking/render.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EMAIL_EVENTS, GUEST_EMAIL_EVENTS, type EmailEvent } from '@/lib/email/events';
import { REGISTRY, type StringDef } from '@/lib/i18n/registry';
import { resolveStrings } from '@/lib/i18n/resolve';
import { renderEmail } from '../send';
import { formatEmailDate, formatEmailShortDate, formatEmailTime } from './format';
import type { BookingEmailData } from './load';
import { buildBookingEmail, emailKeys, type EmailKey } from './render';

const EN = { code: 'en', bcp47: 'en' };
const VI = { code: 'vi', bcp47: 'vi' }; // locales.bcp47 as seeded (migration 004)
const ORIGIN = 'https://admin.furama.test';

const booking: BookingEmailData = {
  reservationId: '42',
  reference: 'FC-7K3QH9XA',
  restaurantName: 'Tàya House',
  date: '2026-10-05',
  time: '19:00',
  guests: 4,
  status: 'requested',
  statusReason: 'Nhà hàng có tiệc riêng tối hôm đó.',
  guestName: 'Nguyễn Thị Ánh',
  phone: '0905 123 456',
  email: 'anh.nguyen@guest.vn',
  note: 'Bàn gần cửa sổ.',
  groupPhone: { display: '+84 236 651 9999', tel: '+842366519999' },
  anonymized: false,
};

/** The registry's own text for an event, as resolveStrings gives it with no content_strings rows. */
const registryStrings = (event: EmailEvent, locale: string) => resolveStrings([], emailKeys(event), locale, 'en') as Record<EmailKey, string>;

async function render(event: EmailEvent, locale = EN, data: BookingEmailData = booking) {
  const built = buildBookingEmail(event, data, registryStrings(event, locale.code), locale, { adminOrigin: ORIGIN });
  return { subject: built.subject, ...(await renderEmail(built.element)) };
}

describe('registry: email.* keys', () => {
  it('every key an email reads exists, in English and Vietnamese, on the emails screen', () => {
    for (const event of EMAIL_EVENTS) {
      for (const key of emailKeys(event)) {
        const def: StringDef = REGISTRY[key];
        expect(def, key).toBeDefined();
        expect(def.vi, `${key} has no Vietnamese`).toBeTruthy();
        expect(def.screen).toBe('emails');
      }
    }
  });

  // The guest's done screen (phase 4, F2) and the email must say the same thing for each status.
  it('the request and confirmation emails open with the done screen’s words', () => {
    expect(REGISTRY['email.guest.ack.intro'].en).toBe(REGISTRY['booking.done_requested'].en);
    expect(REGISTRY['email.guest.confirmed.intro'].en).toBe(REGISTRY['booking.done_confirmed'].en);
  });
});

describe('dates and times in the email’s language, on Da Nang’s calendar whatever the server zone', () => {
  it('formats the sitting for English and Vietnamese', () => {
    expect(formatEmailDate('2026-10-05', 'en')).toBe('Monday, October 5, 2026');
    expect(formatEmailDate('2026-10-05', 'vi')).toBe('Thứ Hai, 5 tháng 10, 2026');
    expect(formatEmailShortDate('2026-10-05', 'en')).toBe('Mon, Oct 5, 2026');
    expect(formatEmailTime('19:00', 'en')).toBe('7:00 PM');
    expect(formatEmailTime('19:00', 'vi')).toBe('19:00');
    expect(formatEmailTime('00:30', 'vi')).toBe('00:30');
  });

  it('falls back to English formatting for a tag Intl rejects, instead of failing the send', () => {
    expect(formatEmailDate('2026-10-05', 'not a tag!')).toBe('Monday, October 5, 2026');
  });
});

describe('booking emails', () => {
  it.each(EMAIL_EVENTS.flatMap((event) => [EN, VI].map((locale) => [event, locale.code, locale] as const)))(
    '%s in %s: subject, html and text carry the booking, every placeholder filled',
    async (event, _code, locale) => {
      const { subject, html, text } = await render(event, locale);
      expect(subject).toContain('FC-7K3QH9XA');
      for (const out of [html, text]) {
        expect(out).toContain('FC-7K3QH9XA');
        expect(out).toContain('Tàya House');
        expect(out).toContain(locale === EN ? 'Monday, October 5, 2026' : 'Thứ Hai, 5 tháng 10, 2026');
        expect(out).toContain(locale === EN ? '7:00 PM (Da Nang time, GMT+7)' : '19:00 (giờ Đà Nẵng, GMT+7)');
      }
      for (const out of [subject, text]) expect(out).not.toMatch(/\{\w+\}/);
      expect(html).toContain(`lang="${locale.bcp47}"`);
      expect(text).not.toMatch(/<[a-z]/i);
    },
  );

  it('the plain-text part lists the details as aligned label/value lines', async () => {
    const { text } = await render('guest.confirmed');
    expect(text).toMatch(/^Reference\s{2,}FC-7K3QH9XA$/m);
    expect(text).toMatch(/^Guests\s{2,}4$/m);
  });

  it('guest emails: their own words, the restaurant’s number as a tel: link, no admin link, no guest contact details', async () => {
    for (const event of GUEST_EMAIL_EVENTS) {
      const { html, text } = await render(event);
      expect(html).toContain('href="tel:+842366519999"');
      expect(text).toContain('Please call us on +84 236 651 9999.');
      expect(html).not.toContain('/admin/');
      for (const out of [html, text]) {
        expect(out).not.toContain('0905 123 456');
        expect(out).not.toContain('Bàn gần cửa sổ.');
      }
    }
  });

  it('declined and cancelled quote the reason; the request and confirmation never show one', async () => {
    for (const [event, shows] of [
      ['guest.declined', true],
      ['guest.cancelled', true],
      ['guest.ack', false],
      ['guest.confirmed', false],
    ] as const) {
      const { text } = await render(event);
      expect(text.includes('Nhà hàng có tiệc riêng tối hôm đó.'), event).toBe(shows);
    }
    const { text } = await render('guest.cancelled', EN, { ...booking, statusReason: '  ' });
    expect(text).not.toContain('Reason');
  });

  it('the request and confirmation open with the same words as the done screen of the form', async () => {
    expect((await render('guest.ack')).text).toContain('Your table request at Tàya House has been received. Our team will contact you shortly to confirm.');
    expect((await render('guest.confirmed')).text).toContain('Your table at Tàya House is confirmed. We look forward to welcoming you.');
  });

  it('staff.new: Vietnamese, the guest’s details and own request, a link to the booking, whether staff must act', async () => {
    const { subject, html, text } = await render('staff.new', VI);
    expect(subject).toBe('Đặt bàn mới FC-7K3QH9XA: Tàya House, Th 2, 5 thg 10, 2026 19:00, 4 khách');
    for (const out of [html, text]) {
      expect(out).toContain('Nguyễn Thị Ánh');
      expect(out).toContain('0905 123 456');
      expect(out).toContain('anh.nguyen@guest.vn');
      expect(out).toContain('Bàn gần cửa sổ.');
      expect(out).toContain(`${ORIGIN}/admin/reservations/42`);
    }
    expect(text).toContain('Vui lòng xác nhận hoặc từ chối');
    // The staff email shows no decline reason: it has none to show.
    expect(text).not.toContain('Nhà hàng có tiệc riêng');
    const auto = await render('staff.new', VI, { ...booking, status: 'confirmed', email: null, note: null });
    expect(auto.text).toContain('Đặt bàn đã được tự động xác nhận.');
    expect(auto.text).not.toContain('Yêu cầu của khách');
    expect(auto.text).not.toMatch(/^Email\s/m);
  });

  it('staff.new in English says "party of", so one guest still reads right', async () => {
    const { subject } = await render('staff.new', EN, { ...booking, guests: 1 });
    expect(subject).toBe('New booking FC-7K3QH9XA: Tàya House, Mon, Oct 5, 2026 7:00 PM, party of 1');
  });

  it('escapes what a guest typed: their text cannot become markup', async () => {
    const { html } = await render('staff.new', VI, { ...booking, guestName: '<img src=x onerror=alert(1)>', note: '<a href="https://evil">click</a>' });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<a href="https://evil"');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('without a destination phone the contact line is left out, not printed with an empty number', async () => {
    const { text } = await render('guest.confirmed', EN, { ...booking, groupPhone: null });
    expect(text).not.toContain('Please call us');
  });
});

describe('the staff link', () => {
  it('appears once in the plain text (the button), and twice in the html (button and fallback link)', async () => {
    const { html, text } = await render('staff.new', VI);
    expect(text.split(`${ORIGIN}/admin/reservations/42`)).toHaveLength(2);
    expect(html.split(`href="${ORIGIN}/admin/reservations/42"`)).toHaveLength(3);
  });
});
```

Test tích hợp render từ hàng DB như bộ gửi làm: R10 (vi tắt mà có chữ riêng thì vẫn tiếng Việt; `ko` không chữ riêng, tắt thì về mặc định, bật thì là `ko`), ghi đè `content_strings`, không ghi chú nội bộ, số của điểm đến, Reply-To.

Create `test/integration/email-screens.test.ts`:

```ts
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EmailEvent } from '@/lib/email/events';
import { loadBookingEmailData } from '@/lib/server/email/booking/load';
import { renderOutboxEmail } from '@/lib/server/email/booking/render';
import { TEST_DATABASE_URL } from '../helpers/db';

/*
 * Phase 5's booking emails against the database: rendering a booking's email
 * from its row as the drain does (the language rule R10, content_strings
 * overrides, no internal notes, the destination's phone, Reply-To). Never a
 * real SMTP server.
 */

let pool: Pool;

async function seedReservation(over: { status?: string; email?: string | null; locale?: string; restaurant?: string; statusReason?: string | null } = {}) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164, email, status, status_reason, meal, source, locale, note)
     VALUES ('FC-' || upper(substr(md5(random()::text), 1, 8)), $1, '2026-10-05', '19:00', 4, 'Nguyễn Thị Ánh', '0905 123 456',
             '+849052' || lpad((floor(random() * 1e5))::int::text, 5, '0'), $2, $3, $4, 'Dinner', 'web', $5, 'Bàn gần cửa sổ.')
     RETURNING id::text`,
    [over.restaurant ?? 'taya-house', over.email === undefined ? 'anh.nguyen@guest.vn' : over.email, over.status ?? 'requested', over.statusReason ?? null, over.locale ?? 'en'],
  );
  return rows[0].id;
}

/** What the drain renders for an outbox row of `event` in `locale` about booking `id`. */
async function render(event: EmailEvent, id: string, locale: string) {
  const data = await loadBookingEmailData(pool, id);
  if (!data) throw new Error(`no booking ${id}`);
  return renderOutboxEmail(pool, { event, locale }, data);
}

describe.skipIf(!TEST_DATABASE_URL)('email screens and templates (database)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });
  afterAll(async () => {
    await pool.query(`UPDATE site_settings SET email = 'fb@furamavietnam.com'`);
    await pool.query(`DELETE FROM content_strings WHERE key LIKE 'email.%'`);
    await pool.query(`DELETE FROM locales WHERE code = 'ko'`);
    await pool.query(`UPDATE locales SET is_enabled = (code = 'en')`);
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE reservations, reservation_events, reservation_notes, email_outbox, notification_recipients, audit_log CASCADE');
    await pool.query(`DELETE FROM content_strings WHERE key LIKE 'email.%'`);
    await pool.query(`DELETE FROM locales WHERE code = 'ko'`);
    await pool.query(`UPDATE locales SET is_enabled = (code = 'en')`);
    await pool.query(`UPDATE site_settings SET email = 'fb@furamavietnam.com'`);
  });

  describe('rendering from the reservation row', () => {
    it('a guest email speaks the booking’s language when it is on, or when the registry has its copy (vi); else the default (R10)', async () => {
      // vi is off on the site (migration 004), yet the registry has every email key in Vietnamese: a phone booking in vi reads Vietnamese.
      const vi = await seedReservation({ locale: 'vi', status: 'confirmed' });
      const off = await render('guest.confirmed', vi, 'vi');
      expect(off).toMatchObject({ locale: 'vi', subject: expect.stringMatching(/^Đặt bàn của bạn đã được xác nhận \(FC-/) });
      expect(off.html).toContain('lang="vi"');
      expect(off.text).toContain('Thứ Hai, 5 tháng 10, 2026');
      // A language with no copy of its own, switched off: the default language, not English copy with Korean dates.
      await pool.query(`INSERT INTO locales (code, bcp47, native_name, short_label, script, sort_order) VALUES ('ko', 'ko', '한국어', 'KO', 'hangul', 90)`);
      const ko = await seedReservation({ locale: 'ko', status: 'confirmed' });
      const fallback = await render('guest.confirmed', ko, 'ko');
      expect(fallback).toMatchObject({ locale: 'en', subject: expect.stringMatching(/^Your table is confirmed \(FC-/) });
      expect(fallback.text).toContain('Monday, October 5, 2026');
      // Switched on, it is the guest's language: English copy per key, its own date format (Known risk 19).
      await pool.query(`UPDATE locales SET is_enabled = true WHERE code = 'ko'`);
      const on = await render('guest.confirmed', ko, 'ko');
      expect(on.locale).toBe('ko');
      expect(on.html).toContain('lang="ko"');
      // Staff keep the recipient's language, on the site or not.
      const staff = await render('staff.new', vi, 'vi');
      expect(staff).toMatchObject({ locale: 'vi', subject: expect.stringMatching(/^Đặt bàn mới FC-/) });
    });

    it('content_strings override the registry: the default language always, another one once reviewed', async () => {
      const id = await seedReservation({ status: 'confirmed' });
      await pool.query(
        `INSERT INTO content_strings (key, locale, value, status, origin) VALUES
           ('email.guest.confirmed.heading', 'en', 'See you soon', 'reviewed', 'human'),
           ('email.staff.new.heading', 'vi', 'Đơn mới (máy dịch)', 'machine', 'ai')`,
      );
      expect((await render('guest.confirmed', id, 'en')).text).toContain('See you soon');
      // An unreviewed machine row for vi (serve_machine off) does not reach the email; the registry's Vietnamese does.
      const staff = await render('staff.new', id, 'vi');
      expect(staff.text).toContain('Có đặt bàn online mới');
      expect(staff.text).not.toContain('máy dịch');
    });

    it('never carries internal notes; the guest’s own request reaches staff only', async () => {
      const id = await seedReservation({ status: 'cancelled', statusReason: 'Bếp đóng cửa sửa chữa.' });
      await pool.query(`INSERT INTO reservation_notes (reservation_id, author_id, author_label, body) VALUES ($1, 'admin-1', 'Lan', 'Khách VIP, nợ tiền lần trước')`, [id]);
      for (const event of ['staff.new', 'guest.cancelled'] as const) {
        const email = await render(event, id, 'en');
        expect(email.html).not.toContain('Khách VIP');
        expect(email.text).not.toContain('Khách VIP');
      }
      const guest = await render('guest.cancelled', id, 'en');
      expect(guest.text).toContain('Bếp đóng cửa sửa chữa.');
      expect(guest.text).not.toContain('Bàn gần cửa sổ.');
      expect(guest.text).not.toContain('0905 123 456');
      expect(guest.html).not.toContain('/admin/');
      const staff = await render('staff.new', id, 'en');
      expect(staff.text).toContain('Bàn gần cửa sổ.');
      expect(staff.text).toContain(`http://localhost:3000/admin/reservations/${id}`);
    });

    it('the destination’s phone, and replies to the guest (staff) or the shared inbox (guest) (R11)', async () => {
      const resort = await seedReservation({ status: 'confirmed', restaurant: 'taya-house' });
      const house = await seedReservation({ status: 'confirmed', restaurant: 'pho-cuon' });
      expect((await render('guest.confirmed', resort, 'en')).text).toContain('+84 236 651 9999');
      await pool.query(`UPDATE site_settings SET email = 'contact@furama.test'`);
      const g = await render('guest.confirmed', house, 'en');
      expect(g.text).toContain('0859 555 759');
      expect(g.replyTo).toBe('contact@furama.test');
      expect((await render('staff.new', house, 'vi')).replyTo).toBe('anh.nguyen@guest.vn');
      const noEmail = await seedReservation({ email: null });
      expect((await render('staff.new', noEmail, 'vi')).replyTo).toBeUndefined();
    });
  });
});
```

Chủ đề thật trong test bộ gửi (cả Reply-To trên dây):

```diff
diff --git a/test/integration/email-outbox.test.ts b/test/integration/email-outbox.test.ts
index f4e0867..146bf6e 100644
--- a/test/integration/email-outbox.test.ts
+++ b/test/integration/email-outbox.test.ts
@@ -246,7 +246,12 @@ describe.skipIf(!TEST_DATABASE_URL)('email outbox (database + local SMTP sink)',
         expect(row.provider_id).toMatch(/^250 Ok: queued as SINK\d$/);
       }
       expect(s.received.map((m) => [m.to[0], m.messageId])).toEqual(rows.rows.map((r, i) => [['gm@furama.test', 'guest@example.com'][i], r.message_id]));
-      expect(s.received.map((m) => m.subject)).toEqual([`staff.new ${booking.reference}`, `guest.ack ${booking.reference}`]);
+      expect(s.received.map((m) => m.subject)).toEqual([
+        `Đặt bàn mới ${booking.reference}: Tàya House, Th 2, 5 thg 10, 2026 19:00, 2 khách`,
+        `We have received your table request (${booking.reference})`,
+      ]);
+      // Staff reply to the guest; the guest replies to the shared inbox (R11).
+      expect(s.received.map((m) => m.replyTo)).toEqual(['guest@example.com', 'fb@furamavietnam.com']);
       // Nothing left: a second drain claims nothing.
       expect(await drainTo(s)).toMatchObject({ claimed: 0 });
       expect(s.received).toHaveLength(2);
@@ -325,7 +330,7 @@ describe.skipIf(!TEST_DATABASE_URL)('email outbox (database + local SMTP sink)',
         { event: 'guest.confirmed', status: 'skipped', last_error: 'skipped: the booking is now cancelled' },
         { event: 'guest.cancelled', status: 'sent', last_error: null },
       ]);
-      expect(s.received.map((m) => m.subject)).toEqual([`guest.cancelled ${a.reference}`]);
+      expect(s.received.map((m) => m.subject)).toEqual([`Your reservation has been cancelled (${a.reference})`]);
     });
 
     it('skips a guest email whose address changed since it was queued, and one whose booking was anonymised', async () => {
```

Chủ đề thật trong E2E (chủ đề nhân viên có ngày ngắn và giờ theo ngôn ngữ, nên so bằng mẫu):

```diff
diff --git a/e2e/booking-email.spec.ts b/e2e/booking-email.spec.ts
index cf20313..d4680a4 100644
--- a/e2e/booking-email.spec.ts
+++ b/e2e/booking-email.spec.ts
@@ -57,9 +57,11 @@ test('a guest booking emails the staff (the general inbox: nobody is listed) and
   const guest = `guest-${Date.now()}@example.com`;
   const reference = await bookCafeIndochine(page, guest);
   await expect.poll(() => about(reference)).toEqual([
-    ['fb@furamavietnam.com', `staff.new ${reference}`],
-    [guest, `guest.ack ${reference}`],
+    ['fb@furamavietnam.com', expect.stringMatching(new RegExp(`^Đặt bàn mới ${reference}: Café Indochine, .+ \\d{2}:\\d{2}, 2 khách$`))],
+    [guest, `We have received your table request (${reference})`],
   ]);
+  const ack = logged().find((e) => e.to === guest && e.subject.includes(reference));
+  expect(ack?.text).toContain('Your table request at Café Indochine has been received. Our team will contact you shortly to confirm.');
   const rows = await one<{ statuses: string[]; events: string[]; fallback: boolean[] }>(
     `SELECT array_agg(o.status ORDER BY o.id) AS statuses, array_agg(o.event ORDER BY o.id) AS events, array_agg(o.fallback ORDER BY o.id) AS fallback
        FROM email_outbox o JOIN reservations r ON r.id = o.reservation_id WHERE r.reference = $1`,
@@ -77,7 +79,7 @@ test('confirming in the admin emails the guest', async ({ page }) => {
   await page.goto(`/admin/reservations/${r.id}`);
   await page.getByRole('main').getByRole('button', { name: 'Xác nhận', exact: true }).click();
   await expect(page.getByRole('main').getByRole('status')).toHaveText('Đã cập nhật trạng thái.');
-  await expect.poll(() => about(r.reference)).toEqual([[guest, `guest.confirmed ${r.reference}`]]);
+  await expect.poll(() => about(r.reference)).toEqual([[guest, `Your table is confirmed (${r.reference})`]]);
   expect(await one(`SELECT status, attempts FROM email_outbox WHERE reservation_id = $1`, [r.id])).toEqual({ status: 'sent', attempts: 1 });
 });
 
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/server/email/booking/render.test.ts test/integration/email-screens.test.ts test/integration/email-outbox.test.ts`
Expected: FAIL `Test Files  3 failed (3)`, `Tests  6 failed | 23 passed (29)`:

```
 ❯ test/integration/email-outbox.test.ts (25 tests | 2 failed) 6006ms
       × sends each row over SMTP once, records the reply, and puts the Message-ID it fixed on the wire 307ms
       × skips an email that no longer matches the booking: a confirmation cancelled before it went, an ack after the confirm 183ms
 ❯ lib/server/email/booking/render.test.ts (0 test)
 ❯ test/integration/email-screens.test.ts (4 tests | 4 failed) 122ms
 FAIL  lib/server/email/booking/render.test.ts [ lib/server/email/booking/render.test.ts ]
Error: Cannot find module './format' imported from …/lib/server/email/booking/render.test.ts
 FAIL  … > sends each row over SMTP once, records the reply, and puts the Message-ID it fixed on the wire
AssertionError: expected [ 'staff.new FC-6PA14T5R', …(1) ] to deeply equal [ …(2) ]
 FAIL  … > a guest email speaks the booking’s language when it is on, or when the registry has its copy (vi); else the default (R10)
AssertionError: expected { …(3) } to match object { locale: 'vi', …(1) }
 FAIL  … > content_strings override the registry: the default language always, another one once reviewed
AssertionError: expected 'guest.confirmed FC-29F9AF25: Tàya Hou…' to contain 'See you soon'
```

Build code hiện tại với `e2e/booking-email.spec.ts` mới (cất tạm các file ngoài `e2e/`), chạy nó: `2 failed`, `1 passed` (spec cron không đổi):

```
  ✘  1 [desktop] › e2e/booking-email.spec.ts:56:5 › a guest booking emails the staff (the general inbox: nobody is listed) and the guest, after the response (6.4s)
  ✘  2 [desktop] › e2e/booking-email.spec.ts:73:5 › confirming in the admin emails the guest (5.8s)
    -     StringMatching /^Đặt bàn mới FC-RB8TDWXZ: Café Indochine, .+ \d{2}:\d{2}, 2 khách$/,
    +     "staff.new FC-RB8TDWXZ",
    -     "We have received your table request (FC-RB8TDWXZ)",
    +     "guest.ack FC-RB8TDWXZ",
    -     "Your table is confirmed (FC-XNCPH45X)",
    +     "guest.confirmed FC-XNCPH45X",
```

Lấy lại các file đã cất.

- [ ] **Bước 3: Chữ của email trong registry**

31 key, mỗi key có EN và VI, `screen: 'emails'`, `vars` và `context`. `email.guest.ack.intro`/`email.guest.confirmed.intro` (EN) bằng đúng `booking.done_requested`/`booking.done_confirmed` của F2 (test ghim). Chủ đề nhân viên EN nói "party of {guests}" để một khách vẫn đúng ngữ pháp. Sửa `lib/i18n/registry.ts`:

```diff
diff --git a/lib/i18n/registry.ts b/lib/i18n/registry.ts
index af74488..0dd0839 100644
--- a/lib/i18n/registry.ts
+++ b/lib/i18n/registry.ts
@@ -203,6 +203,239 @@ export const REGISTRY = {
       'Reservation form, a button under error.network when the dates or the times could not be loaded (server error or no connection); it asks the server again.',
     screen: 'booking',
   },
+  // ── Booking emails (spec §10.4): email.<event>.<field>, shared labels under email.common. ──
+  // Rendered in the reservation's language for guests and the recipient's for staff
+  // (lib/server/email/booking/render.ts). Phase 7 edits them in /admin/content/emails.
+  'email.common.label_reference': {
+    en: 'Reference',
+    vi: 'Mã đặt bàn',
+    maxLength: 40,
+    context: 'Booking emails, label of the booking reference (FC-7K3QH9XA) in the details table.',
+    screen: 'emails',
+  },
+  'email.common.label_restaurant': {
+    en: 'Restaurant',
+    vi: 'Nhà hàng',
+    maxLength: 40,
+    context: 'Booking emails, label of the restaurant name in the details table.',
+    screen: 'emails',
+  },
+  'email.common.label_date': {
+    en: 'Date',
+    vi: 'Ngày',
+    maxLength: 40,
+    context: 'Booking emails, label of the date in the details table (the date itself is formatted for the language).',
+    screen: 'emails',
+  },
+  'email.common.label_time': {
+    en: 'Time',
+    vi: 'Giờ',
+    maxLength: 40,
+    context: 'Booking emails, label of the time in the details table.',
+    screen: 'emails',
+  },
+  'email.common.time_value': {
+    en: '{time} (Da Nang time, GMT+7)',
+    vi: '{time} (giờ Đà Nẵng, GMT+7)',
+    maxLength: 60,
+    vars: ['time'],
+    context: 'Booking emails, the time of the sitting. {time} is formatted for the language (7:00 PM, 19:00); keep it. Guests may read the email in another timezone.',
+    screen: 'emails',
+  },
+  'email.common.label_guests': {
+    en: 'Guests',
+    vi: 'Số khách',
+    maxLength: 40,
+    context: 'Booking emails, label of the party size in the details table (a number follows).',
+    screen: 'emails',
+  },
+  'email.common.label_reason': {
+    en: 'Reason',
+    vi: 'Lý do',
+    maxLength: 40,
+    context: 'Decline and cancellation emails, label of the reason staff gave (their text follows as typed).',
+    screen: 'emails',
+  },
+  'email.common.contact': {
+    en: 'Questions or changes? Please call us on {phone}.',
+    vi: 'Cần hỏi thêm hoặc thay đổi? Vui lòng gọi cho chúng tôi theo số {phone}.',
+    maxLength: 160,
+    vars: ['phone'],
+    context: 'Guest booking emails, under the details. {phone} is the restaurant’s (its destination’s) number; keep it.',
+    screen: 'emails',
+  },
+  'email.common.footer_guest': {
+    en: 'You are receiving this email because a table was booked with this address at Furama Cuisine.',
+    vi: 'Bạn nhận được email này vì có một đặt bàn tại Furama Cuisine dùng địa chỉ email này.',
+    maxLength: 200,
+    context: 'Guest booking emails, small print at the bottom.',
+    screen: 'emails',
+  },
+  'email.common.footer_staff': {
+    en: 'Automatic notification from the Furama Cuisine booking system.',
+    vi: 'Thông báo tự động từ hệ thống đặt bàn Furama Cuisine.',
+    maxLength: 200,
+    context: 'Staff notification emails, small print at the bottom.',
+    screen: 'emails',
+  },
+  'email.guest.ack.subject': {
+    en: 'We have received your table request ({reference})',
+    vi: 'Chúng tôi đã nhận yêu cầu đặt bàn của bạn ({reference})',
+    maxLength: 120,
+    vars: ['reference'],
+    context: 'Subject of the email a guest gets right after booking online, while the request waits for staff. {reference} is the booking reference; keep it.',
+    screen: 'emails',
+  },
+  'email.guest.ack.heading': {
+    en: 'Request received',
+    vi: 'Đã nhận yêu cầu đặt bàn',
+    maxLength: 80,
+    context: 'Heading of the "request received" email.',
+    screen: 'emails',
+  },
+  'email.guest.ack.intro': {
+    en: 'Your table request at {restaurant} has been received. Our team will contact you shortly to confirm.',
+    vi: 'Yêu cầu đặt bàn của bạn tại {restaurant} đã được tiếp nhận. Đội ngũ của chúng tôi sẽ sớm liên hệ để xác nhận.',
+    maxLength: 300,
+    vars: ['restaurant'],
+    context:
+      'First paragraph of the "request received" email. Must say the same as the reservation form’s done screen for a request (booking.done_requested). {restaurant} is the restaurant name; keep it.',
+    screen: 'emails',
+  },
+  'email.guest.confirmed.subject': {
+    en: 'Your table is confirmed ({reference})',
+    vi: 'Đặt bàn của bạn đã được xác nhận ({reference})',
+    maxLength: 120,
+    vars: ['reference'],
+    context: 'Subject of the email a guest gets when the booking is confirmed (by staff, automatically, or a phone booking). {reference}: keep it.',
+    screen: 'emails',
+  },
+  'email.guest.confirmed.heading': {
+    en: 'Table confirmed',
+    vi: 'Đã xác nhận đặt bàn',
+    maxLength: 80,
+    context: 'Heading of the confirmation email.',
+    screen: 'emails',
+  },
+  'email.guest.confirmed.intro': {
+    en: 'Your table at {restaurant} is confirmed. We look forward to welcoming you.',
+    vi: 'Bàn của bạn tại {restaurant} đã được xác nhận. Chúng tôi rất mong được đón tiếp bạn.',
+    maxLength: 300,
+    vars: ['restaurant'],
+    context:
+      'First paragraph of the confirmation email. Must say the same as the reservation form’s done screen for a confirmed booking (booking.done_confirmed). {restaurant}: keep it.',
+    screen: 'emails',
+  },
+  'email.guest.declined.subject': {
+    en: 'We could not confirm your table request ({reference})',
+    vi: 'Chúng tôi chưa thể nhận yêu cầu đặt bàn của bạn ({reference})',
+    maxLength: 120,
+    vars: ['reference'],
+    context: 'Subject of the email a guest gets when staff decline the request. {reference}: keep it.',
+    screen: 'emails',
+  },
+  'email.guest.declined.heading': {
+    en: 'Request not confirmed',
+    vi: 'Yêu cầu chưa được xác nhận',
+    maxLength: 80,
+    context: 'Heading of the decline email.',
+    screen: 'emails',
+  },
+  'email.guest.declined.intro': {
+    en: 'We are sorry, but we cannot confirm your table request at {restaurant}.',
+    vi: 'Rất tiếc, chúng tôi không thể xác nhận yêu cầu đặt bàn của bạn tại {restaurant}.',
+    maxLength: 300,
+    vars: ['restaurant'],
+    context: 'First paragraph of the decline email; the reason staff gave follows. {restaurant}: keep it.',
+    screen: 'emails',
+  },
+  'email.guest.cancelled.subject': {
+    en: 'Your reservation has been cancelled ({reference})',
+    vi: 'Đặt bàn của bạn đã được hủy ({reference})',
+    maxLength: 120,
+    vars: ['reference'],
+    context: 'Subject of the email a guest gets when staff cancel the booking and tick "notify the guest". {reference}: keep it.',
+    screen: 'emails',
+  },
+  'email.guest.cancelled.heading': {
+    en: 'Reservation cancelled',
+    vi: 'Đặt bàn đã được hủy',
+    maxLength: 80,
+    context: 'Heading of the cancellation email.',
+    screen: 'emails',
+  },
+  'email.guest.cancelled.intro': {
+    en: 'Your reservation at {restaurant} has been cancelled.',
+    vi: 'Đặt bàn của bạn tại {restaurant} đã được hủy.',
+    maxLength: 300,
+    vars: ['restaurant'],
+    context: 'First paragraph of the cancellation email; the reason staff gave follows. {restaurant}: keep it.',
+    screen: 'emails',
+  },
+  'email.staff.new.subject': {
+    en: 'New booking {reference}: {restaurant}, {date} {time}, party of {guests}',
+    vi: 'Đặt bàn mới {reference}: {restaurant}, {date} {time}, {guests} khách',
+    maxLength: 160,
+    vars: ['reference', 'restaurant', 'date', 'time', 'guests'],
+    context: 'Subject of the staff notification for a new online booking. Keep every placeholder; {date} is short (Mon, 5 Oct 2026), {guests} a number.',
+    screen: 'emails',
+  },
+  'email.staff.new.heading': {
+    en: 'New online booking',
+    vi: 'Có đặt bàn online mới',
+    maxLength: 80,
+    context: 'Heading of the staff notification for a new online booking.',
+    screen: 'emails',
+  },
+  'email.staff.new.intro_requested': {
+    en: 'A guest has requested a table. Please confirm or decline it in the admin.',
+    vi: 'Khách vừa gửi yêu cầu đặt bàn. Vui lòng xác nhận hoặc từ chối trong trang quản trị.',
+    maxLength: 300,
+    context: 'Staff notification, when the booking waits for staff (auto-confirm off).',
+    screen: 'emails',
+  },
+  'email.staff.new.intro_confirmed': {
+    en: 'A guest has booked a table. It was confirmed automatically.',
+    vi: 'Khách vừa đặt bàn. Đặt bàn đã được tự động xác nhận.',
+    maxLength: 300,
+    context: 'Staff notification, when auto-confirm already confirmed the booking.',
+    screen: 'emails',
+  },
+  'email.staff.new.label_guest': {
+    en: 'Guest',
+    vi: 'Khách',
+    maxLength: 40,
+    context: 'Staff notification, label of the guest’s name.',
+    screen: 'emails',
+  },
+  'email.staff.new.label_phone': {
+    en: 'Phone',
+    vi: 'Điện thoại',
+    maxLength: 40,
+    context: 'Staff notification, label of the guest’s phone number.',
+    screen: 'emails',
+  },
+  'email.staff.new.label_email': {
+    en: 'Email',
+    vi: 'Email',
+    maxLength: 40,
+    context: 'Staff notification, label of the guest’s email address.',
+    screen: 'emails',
+  },
+  'email.staff.new.label_note': {
+    en: 'Guest’s request',
+    vi: 'Yêu cầu của khách',
+    maxLength: 40,
+    context: 'Staff notification, label of the note the guest typed in the form (never staff notes).',
+    screen: 'emails',
+  },
+  'email.staff.new.button': {
+    en: 'Open the booking',
+    vi: 'Mở đặt bàn',
+    maxLength: 40,
+    context: 'Staff notification, button linking to the booking in the admin.',
+    screen: 'emails',
+  },
 } as const satisfies Record<string, StringDef>;
 
 export type StringKey = keyof typeof REGISTRY;
```

- [ ] **Bước 4: Bộ đọc chữ nhận một pool hay client**

`getStrings` dùng `'use cache'`/`cacheTag`, mà bộ gửi chạy trong `after()`, cron và Vitest, ngoài mọi phạm vi cache của Next. Sửa `lib/server/content/strings.queries.ts`:

```diff
diff --git a/lib/server/content/strings.queries.ts b/lib/server/content/strings.queries.ts
index ce1045f..7450d3a 100644
--- a/lib/server/content/strings.queries.ts
+++ b/lib/server/content/strings.queries.ts
@@ -1,22 +1,29 @@
 import 'server-only';
+import type { Pool, PoolClient } from 'pg';
 import { query } from '@/db/client';
 import type { StringRow } from '@/lib/i18n/resolve';
 
+type Run = <T extends Record<string, unknown>>(text: string, values?: unknown[]) => Promise<T[]>;
+
 /**
  * The rows a guest may see for `keys` in `locale`, plus the default language's
  * rows as fallback (spec §5.1 item 5): the default language always shows;
  * another language shows `reviewed` rows, or `machine` rows when that language
  * has serve_machine on. Uncached; lib/server/content/strings.ts wraps it.
+ * `db` lets the email sender read on its own pool or client: it runs in
+ * after() and the cron route, outside any Next cache scope.
  */
 export async function loadStringRows(
   locale: string,
   keys: readonly string[],
+  db?: Pool | PoolClient,
 ): Promise<{ defaultLocale: string; rows: StringRow[] }> {
-  const defaults = await query<{ code: string }>('SELECT code FROM locales WHERE is_default');
+  const run: Run = db ? async (text, values) => (await db.query(text, values)).rows : query;
+  const defaults = await run<{ code: string }>('SELECT code FROM locales WHERE is_default');
   const defaultLocale = defaults[0]?.code ?? 'en';
   if (keys.length === 0) return { defaultLocale, rows: [] };
 
-  const rows = await query<StringRow>(
+  const rows = await run<StringRow>(
     `SELECT cs.key, cs.locale, cs.value
        FROM content_strings cs
        JOIN locales l ON l.code = cs.locale
```

- [ ] **Bước 5: Định dạng, layout, template**

Create `lib/server/email/booking/format.ts` (ngày giờ của đặt bàn đã là lịch và đồng hồ Đà Nẵng, nên được định dạng như thời điểm UTC: không múi giờ nào của server hay người đọc làm lệch được; `timeStyle: 'short'` cho "7:00 PM" ở en và "19:00"/"00:30" ở vi):

```ts
import type { IsoDate } from '@/lib/venue-time';

/*
 * Dates and times in booking emails, in the email's language. reserved_on and
 * reserved_at are already Da Nang's calendar date and wall-clock time, so they
 * are formatted as UTC instants: no server or reader timezone can shift them
 * (the same trick as lib/admin/format.ts formatIsoDayVi). The template says
 * "Da Nang time" next to the time (email.common.time_value).
 */

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(bcp47: string, kind: 'long' | 'short' | 'time'): Intl.DateTimeFormat {
  const key = `${bcp47}|${kind}`;
  let f = cache.get(key);
  if (!f) {
    const options: Intl.DateTimeFormatOptions =
      kind === 'long'
        ? { timeZone: 'UTC', dateStyle: 'full' }
        : kind === 'short'
          ? { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }
          : // The language's own clock: "7:00 PM" in English, "19:00" (two-digit hour) in Vietnamese.
            { timeZone: 'UTC', timeStyle: 'short' };
    try {
      f = new Intl.DateTimeFormat(bcp47, options);
    } catch {
      // A tag Intl does not know (a hand-added locale): English formatting beats a crash in the sender.
      f = new Intl.DateTimeFormat('en', options);
    }
    cache.set(key, f);
  }
  return f;
}

/** "Monday, October 5, 2026" / "Thứ Hai, 5 tháng 10, 2026". */
export function formatEmailDate(date: IsoDate, bcp47: string): string {
  return formatter(bcp47, 'long').format(new Date(`${date}T00:00:00Z`));
}

/** "Mon, Oct 5, 2026" / "Th 2, 5 thg 10, 2026": for subjects. */
export function formatEmailShortDate(date: IsoDate, bcp47: string): string {
  return formatter(bcp47, 'short').format(new Date(`${date}T00:00:00Z`));
}

/** "7:00 PM" / "19:00". */
export function formatEmailTime(time: string, bcp47: string): string {
  return formatter(bcp47, 'time').format(new Date(`2000-01-01T${time}:00Z`));
}
```

Sửa `lib/server/email/templates/layout.tsx` (thêm `lang` và `footer`; hai email nhân viên giữ mặc định tiếng Việt):

```diff
diff --git a/lib/server/email/templates/layout.tsx b/lib/server/email/templates/layout.tsx
index 50bf0c2..eef1ee7 100644
--- a/lib/server/email/templates/layout.tsx
+++ b/lib/server/email/templates/layout.tsx
@@ -3,22 +3,26 @@ import { Body, Container, Head, Hr, Html, Preview, Text } from 'react-email';
 
 const brand = '#7a1f2b';
 
-/** Shared shell for staff emails. Inline styles only: email clients ignore stylesheets. */
-export function EmailLayout({ preview, children }: { preview: string; children: ReactNode }) {
+const STAFF_FOOTER = 'Đây là email tự động từ hệ thống quản trị Furama Cuisine. Vui lòng không trả lời email này.';
+
+/**
+ * Shared shell for every email. Inline styles only: email clients ignore stylesheets.
+ * The staff account emails (invite, reset) take the Vietnamese defaults; booking emails
+ * pass the email's language (BCP 47) and their footer from the registry.
+ */
+export function EmailLayout({ preview, children, lang = 'vi', footer = STAFF_FOOTER }: { preview: string; children: ReactNode; lang?: string; footer?: string }) {
   return (
-    <Html lang="vi">
+    <Html lang={lang}>
       <Head />
       <Preview>{preview}</Preview>
-      <Body lang="vi" style={{ backgroundColor: '#f6f3ee', margin: 0, padding: '24px 0', fontFamily: 'Helvetica, Arial, sans-serif', color: '#2b2622' }}>
+      <Body lang={lang} style={{ backgroundColor: '#f6f3ee', margin: 0, padding: '24px 0', fontFamily: 'Helvetica, Arial, sans-serif', color: '#2b2622' }}>
         <Container style={{ backgroundColor: '#ffffff', maxWidth: 520, margin: '0 auto', padding: '32px 28px', borderTop: `4px solid ${brand}` }}>
           <Text style={{ margin: '0 0 24px', fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', color: brand }}>
             Furama Cuisine
           </Text>
           {children}
           <Hr style={{ borderColor: '#e6e0d6', margin: '28px 0 12px' }} />
-          <Text style={{ margin: 0, fontSize: 12, color: '#7a7268' }}>
-            Đây là email tự động từ hệ thống quản trị Furama Cuisine. Vui lòng không trả lời email này.
-          </Text>
+          <Text style={{ margin: 0, fontSize: 12, color: '#7a7268' }}>{footer}</Text>
         </Container>
       </Body>
     </Html>
@@ -30,4 +34,8 @@ export const emailStyles = {
   paragraph: { fontSize: 15, lineHeight: '24px', margin: '0 0 16px' } as const,
   button: { backgroundColor: brand, color: '#ffffff', padding: '12px 24px', borderRadius: 4, fontSize: 15, textDecoration: 'none', display: 'inline-block' } as const,
   small: { fontSize: 13, lineHeight: '20px', color: '#7a7268', margin: '16px 0 0', wordBreak: 'break-all' } as const,
+  detailsTable: { width: '100%', borderCollapse: 'collapse', margin: '8px 0 20px', fontSize: 15, lineHeight: '22px' } as const,
+  detailsLabel: { padding: '6px 16px 6px 0', color: '#7a7268', verticalAlign: 'top', whiteSpace: 'nowrap', width: '1%' } as const,
+  detailsValue: { padding: '6px 0', fontWeight: 600, verticalAlign: 'top' } as const,
+  quote: { fontSize: 15, lineHeight: '22px', margin: '0 0 16px', padding: '10px 14px', backgroundColor: '#f6f3ee', borderLeft: `3px solid ${brand}`, whiteSpace: 'pre-line' } as const,
 };
```

Create `lib/server/email/templates/booking.tsx` (bảng chi tiết mang `data-text-format="dataTable"` để phần chữ thường in "Nhãn   giá trị" thẳng hàng; link dự phòng của nút mang `data-skip-in-text`, nên URL chỉ một lần trong chữ thường):

```tsx
import { Button, Heading, Link, Text } from 'react-email';
import { EmailLayout, emailStyles } from './layout';

/*
 * The one layout of every booking email (spec §10.4: staff.new, guest.ack,
 * guest.confirmed, guest.declined, guest.cancelled). It only lays out text it
 * is given: lib/server/email/booking/render.ts picks the registry strings for
 * the event and the language, and the booking's details. It never receives
 * internal notes (reservation_notes); the guest's own request reaches staff only.
 */

export type BookingEmailProps = {
  /** BCP 47 tag of the email's language (Html lang). */
  lang: string;
  preview: string;
  heading: string;
  intro: string;
  /** Label/value rows: reference, restaurant, date, time, guests (staff: guest, phone, email). */
  details: readonly { label: string; value: string }[];
  /** Free text quoted under its label: the decline or cancellation reason, the guest's request. */
  quotes?: readonly { label: string; text: string }[];
  /** Staff: open the booking in the admin. */
  button?: { label: string; href: string } | null;
  /** Guests: "Questions or changes? Please call us on …". */
  contact?: { text: string; tel: string; phone: string } | null;
  footer: string;
};

export function BookingEmail({ lang, preview, heading, intro, details, quotes = [], button = null, contact = null, footer }: BookingEmailProps) {
  return (
    <EmailLayout lang={lang} preview={preview} footer={footer}>
      <Heading as="h1" style={emailStyles.heading}>
        {heading}
      </Heading>
      <Text style={emailStyles.paragraph}>{intro}</Text>
      {/* data-text-format: react-email's plain-text pass keeps the rows as aligned "Label  value" lines. */}
      <table role="presentation" data-text-format="dataTable" style={emailStyles.detailsTable}>
        <tbody>
          {details.map((row) => (
            <tr key={row.label}>
              <td style={emailStyles.detailsLabel}>{row.label}</td>
              <td style={emailStyles.detailsValue}>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {quotes.map((q) => (
        <div key={q.label}>
          <Text style={{ ...emailStyles.paragraph, margin: '0 0 4px', fontWeight: 600 }}>{q.label}</Text>
          <Text style={emailStyles.quote}>{q.text}</Text>
        </div>
      ))}
      {button ? (
        <>
          <Button href={button.href} style={emailStyles.button}>
            {button.label}
          </Button>
          {/* For clients that drop the button; the plain-text part already prints the button's link. */}
          <Text style={emailStyles.small} data-skip-in-text="true">
            <Link href={button.href}>{button.href}</Link>
          </Text>
        </>
      ) : null}
      {contact ? (
        <Text style={emailStyles.paragraph}>
          {splitAround(contact.text, contact.phone).map((part, i) =>
            part === null ? (
              <Link key={i} href={`tel:${contact.tel}`}>
                {contact.phone}
              </Link>
            ) : (
              part
            ),
          )}
        </Text>
      ) : null}
    </EmailLayout>
  );
}

/** "Call us on +84 236 …." → ["Call us on ", null, "."]: the number becomes a tel: link where it stands. */
function splitAround(text: string, needle: string): (string | null)[] {
  const at = text.indexOf(needle);
  if (!needle || at < 0) return [text];
  return [text.slice(0, at), null, text.slice(at + needle.length)].filter((p) => p !== '');
}
```

Sửa `lib/server/email/send.ts` (số điện thoại là chữ của chính link: "call us on +84 236 651 9999", không có thêm "tel:+84…"; thiếu `format` thì html-to-text ném "no specified format"):

```diff
diff --git a/lib/server/email/send.ts b/lib/server/email/send.ts
index 9f30216..92de13c 100644
--- a/lib/server/email/send.ts
+++ b/lib/server/email/send.ts
@@ -109,10 +109,17 @@ export function messageIdFor(key: string, domain: string): string {
 export async function renderEmail(element: ReactElement): Promise<{ html: string; text: string }> {
   const [html, text] = await Promise.all([
     render(element),
-    // html-to-text upper-cases headings by default; keep Vietnamese headings as written.
     render(element, {
       plainText: true,
-      htmlToTextOptions: { selectors: [{ selector: 'h1', options: { uppercase: false } }, ...plainTextSelectors] },
+      htmlToTextOptions: {
+        selectors: [
+          // html-to-text upper-cases headings by default; keep Vietnamese headings as written.
+          { selector: 'h1', options: { uppercase: false } },
+          ...plainTextSelectors,
+          // A phone number is its own link text: "call us on +84 236 651 9999", not "… tel:+842366519999".
+          { selector: 'a[href^="tel:"]', format: 'anchor', options: { ignoreHref: true } },
+        ],
+      },
     }),
   ]);
   return { html, text };
```

- [ ] **Bước 6: Render từ registry**

Replace the whole of `lib/server/email/booking/render.ts` with:

```ts
import 'server-only';
import { createElement, type ReactElement } from 'react';
import type { Pool, PoolClient } from 'pg';
import { audienceOf, type EmailAudience, type EmailEvent } from '@/lib/email/events';
import { formatMessage } from '@/lib/i18n/format';
import { registryLocaleDefault, type StringKey } from '@/lib/i18n/registry';
import { resolveStrings } from '@/lib/i18n/resolve';
import { loadStringRows } from '@/lib/server/content/strings.queries';
import { appOrigin } from '../auth-emails';
import { renderEmail } from '../send';
import { BookingEmail, type BookingEmailProps } from '../templates/booking';
import { formatEmailDate, formatEmailShortDate, formatEmailTime } from './format';
import type { BookingEmailData } from './load';

/*
 * Booking emails (spec §10.4), rendered at send time from the reservation as
 * it is then (lib/server/email/booking/load.ts): an edit made between the
 * change and the send shows, and nothing personal is copied into
 * email_outbox. Copy comes from the registry keys email.<event>.<field> and
 * email.common.*, overridden by content_strings rows (phase 7) exactly as the
 * guest site resolves them.
 *
 * Language (R10): a guest email uses the reservation's locale while that
 * language is enabled on the site, or while the registry has its own text for
 * every key the email reads (Vietnamese does); otherwise the default language,
 * so a guest never reads English copy with foreign dates. A staff email uses
 * the recipient's locale, enabled or not.
 *
 * Who sees what (code rule 10): guest emails carry the destination's phone and
 * never the admin link, the guest's phone or their note; staff.new carries the
 * guest's details and own request and a link to the booking. Internal notes
 * are never loaded.
 */

type Db = Pool | PoolClient;
export type EmailKey = Extract<StringKey, `email.${string}`>;
export type EmailLocale = { code: string; bcp47: string };

const COMMON_KEYS = [
  'email.common.label_reference',
  'email.common.label_restaurant',
  'email.common.label_date',
  'email.common.label_time',
  'email.common.time_value',
  'email.common.label_guests',
] as const satisfies readonly EmailKey[];

const EVENT_KEYS = {
  'staff.new': [
    'email.staff.new.subject',
    'email.staff.new.heading',
    'email.staff.new.intro_requested',
    'email.staff.new.intro_confirmed',
    'email.staff.new.label_guest',
    'email.staff.new.label_phone',
    'email.staff.new.label_email',
    'email.staff.new.label_note',
    'email.staff.new.button',
    'email.common.footer_staff',
  ],
  'guest.ack': ['email.guest.ack.subject', 'email.guest.ack.heading', 'email.guest.ack.intro', 'email.common.contact', 'email.common.footer_guest'],
  'guest.confirmed': [
    'email.guest.confirmed.subject',
    'email.guest.confirmed.heading',
    'email.guest.confirmed.intro',
    'email.common.contact',
    'email.common.footer_guest',
  ],
  'guest.declined': [
    'email.guest.declined.subject',
    'email.guest.declined.heading',
    'email.guest.declined.intro',
    'email.common.label_reason',
    'email.common.contact',
    'email.common.footer_guest',
  ],
  'guest.cancelled': [
    'email.guest.cancelled.subject',
    'email.guest.cancelled.heading',
    'email.guest.cancelled.intro',
    'email.common.label_reason',
    'email.common.contact',
    'email.common.footer_guest',
  ],
} as const satisfies Record<EmailEvent, readonly EmailKey[]>;

/** Every registry key one event's email reads. */
export function emailKeys(event: EmailEvent): EmailKey[] {
  return [...COMMON_KEYS, ...EVENT_KEYS[event]];
}

export type BuiltEmail = { subject: string; preview: string; element: ReactElement<BookingEmailProps> };

/**
 * Pure: the subject and the React element of one event's email, from resolved
 * strings. `adminOrigin` builds the staff email's link to the booking.
 */
export function buildBookingEmail(
  event: EmailEvent,
  data: BookingEmailData,
  strings: Readonly<Record<EmailKey, string>>,
  locale: EmailLocale,
  options: { adminOrigin: string },
): BuiltEmail {
  const t = (key: EmailKey, params?: Record<string, string | number>) => formatMessage(strings[key], params, locale.code);
  const time = formatEmailTime(data.time, locale.bcp47);
  const details = [
    { label: t('email.common.label_reference'), value: data.reference },
    { label: t('email.common.label_restaurant'), value: data.restaurantName },
    { label: t('email.common.label_date'), value: formatEmailDate(data.date, locale.bcp47) },
    { label: t('email.common.label_time'), value: t('email.common.time_value', { time }) },
    { label: t('email.common.label_guests'), value: String(data.guests) },
  ];

  if (event === 'staff.new') {
    // R4: auto-confirmed bookings say so; staff need not act on them.
    const intro = t(data.status === 'requested' ? 'email.staff.new.intro_requested' : 'email.staff.new.intro_confirmed');
    const href = `${options.adminOrigin}/admin/reservations/${data.reservationId}`;
    const subject = t('email.staff.new.subject', {
      reference: data.reference,
      restaurant: data.restaurantName,
      date: formatEmailShortDate(data.date, locale.bcp47),
      time,
      guests: data.guests,
    });
    const props: BookingEmailProps = {
      lang: locale.bcp47,
      preview: subject,
      heading: t('email.staff.new.heading'),
      intro,
      details: [
        ...details,
        { label: t('email.staff.new.label_guest'), value: data.guestName },
        { label: t('email.staff.new.label_phone'), value: data.phone },
        ...(data.email ? [{ label: t('email.staff.new.label_email'), value: data.email }] : []),
      ],
      quotes: data.note ? [{ label: t('email.staff.new.label_note'), text: data.note }] : [],
      button: { label: t('email.staff.new.button'), href },
      footer: t('email.common.footer_staff'),
    };
    return { subject, preview: subject, element: createElement(BookingEmail, props) };
  }

  const keys = {
    'guest.ack': ['email.guest.ack.subject', 'email.guest.ack.heading', 'email.guest.ack.intro'],
    'guest.confirmed': ['email.guest.confirmed.subject', 'email.guest.confirmed.heading', 'email.guest.confirmed.intro'],
    'guest.declined': ['email.guest.declined.subject', 'email.guest.declined.heading', 'email.guest.declined.intro'],
    'guest.cancelled': ['email.guest.cancelled.subject', 'email.guest.cancelled.heading', 'email.guest.cancelled.intro'],
  } as const satisfies Record<Exclude<EmailEvent, 'staff.new'>, readonly [EmailKey, EmailKey, EmailKey]>;
  const [subjectKey, headingKey, introKey] = keys[event];
  const subject = t(subjectKey, { reference: data.reference });
  const intro = t(introKey, { restaurant: data.restaurantName });
  // status_reason reaches the guest only on a decline or a cancellation (R8).
  const reason = (event === 'guest.declined' || event === 'guest.cancelled') && data.statusReason?.trim() ? data.statusReason.trim() : null;
  const props: BookingEmailProps = {
    lang: locale.bcp47,
    preview: intro,
    heading: t(headingKey),
    intro,
    details,
    quotes: reason ? [{ label: t('email.common.label_reason'), text: reason }] : [],
    contact: data.groupPhone
      ? { text: t('email.common.contact', { phone: data.groupPhone.display }), phone: data.groupPhone.display, tel: data.groupPhone.tel }
      : null,
    footer: t('email.common.footer_guest'),
  };
  return { subject, preview: intro, element: createElement(BookingEmail, props) };
}

// ── language, strings, reply-to ─────────────────────────────────────────────

/** The language an email goes out in (R10, see the header), with its BCP 47 tag for Intl and <html lang>. */
export async function resolveEmailLocale(db: Db, requested: string, audience: EmailAudience, event: EmailEvent): Promise<EmailLocale> {
  const { rows } = await db.query<{ code: string; bcp47: string; is_enabled: boolean; is_default: boolean }>(
    'SELECT code, bcp47, is_enabled, is_default FROM locales WHERE code = $1 OR is_default',
    [requested],
  );
  const asked = rows.find((r) => r.code === requested);
  const fallback = rows.find((r) => r.is_default) ?? { code: 'en', bcp47: 'en' };
  const ownCopy = (code: string) => emailKeys(event).every((key) => registryLocaleDefault(key, code) !== undefined);
  const usable = asked && (audience === 'staff' || asked.is_enabled || ownCopy(asked.code));
  const picked = usable ? asked : fallback;
  return { code: picked.code, bcp47: picked.bcp47 };
}

/** The strings of one event's email in `locale`, with the site's visibility rules; uncached (no Next cache in after() or the cron). */
export async function loadEmailStrings(db: Db, event: EmailEvent, locale: string): Promise<Record<EmailKey, string>> {
  const keys = emailKeys(event);
  const { defaultLocale, rows } = await loadStringRows(locale, keys, db);
  return resolveStrings(rows, keys, locale, defaultLocale) as Record<EmailKey, string>;
}

/** Where a guest's reply lands: the shared inbox (site_settings.email). */
export async function sharedInbox(db: Db): Promise<string | null> {
  const { rows } = await db.query<{ email: string }>('SELECT email FROM site_settings WHERE id');
  return rows[0]?.email ?? null;
}

export type RenderedEmail = { subject: string; html: string; text: string; replyTo?: string; locale: string };

/**
 * One outbox row's email, ready for the mailer, from the booking the drain
 * just re-read. Reply-To (R11): staff reply straight to the guest; a guest's
 * reply goes to the shared inbox, never to a staff member's address.
 */
export async function renderOutboxEmail(db: Db, row: { event: EmailEvent; locale: string }, data: BookingEmailData): Promise<RenderedEmail> {
  const audience = audienceOf(row.event);
  const locale = await resolveEmailLocale(db, row.locale, audience, row.event);
  const strings = await loadEmailStrings(db, row.event, locale.code);
  // Only staff.new links to the admin; appOrigin() fails closed without BETTER_AUTH_URL outside log mode (R23).
  const built = buildBookingEmail(row.event, data, strings, locale, { adminOrigin: audience === 'staff' ? appOrigin() : '' });
  const { html, text } = await renderEmail(built.element);
  const replyTo = audience === 'staff' ? (data.email ?? undefined) : ((await sharedInbox(db)) ?? undefined);
  return { subject: built.subject, html, text, replyTo, locale: locale.code };
}
```

- [ ] **Bước 7: Chạy lại test**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/server/email/booking/render.test.ts test/integration/email-screens.test.ts test/integration/email-outbox.test.ts`
Expected: PASS `Test Files  3 passed (3)`, `Tests  52 passed (52)`

- [ ] **Bước 8: Đo dung lượng react-email (việc hoãn của đợt 3)**

Sau build của bước 9:

```bash
npm ls --omit=dev tailwindcss esbuild socket.io
node -e "const j=require('./.next/server/app/api/cron/outbox/route.js.nft.json');const fs=require('fs'),p=require('path');let t=0;for(const f of j.files){try{t+=fs.statSync(p.resolve('.next/server/app/api/cron/outbox',f)).size}catch{}}console.log(j.files.length,'files',(t/1e6).toFixed(1),'MB',j.files.filter(f=>/esbuild|socket\.io|tailwind/.test(f)).length,'cli files')"
```

Expected: `react-email@6.11.0` kéo `esbuild@0.28.2`, `socket.io@4.8.4`, `tailwindcss@4.3.3` vào `dependencies`, nhưng trace của function không chứa file nào của chúng: `166 files 2.9 MB 0 cli files` (đã đo: `next` 1,5 MB, `prettier` 0,3 MB; chunk server của bộ render khoảng 355 KB). Xa giới hạn 250 MB: không làm gì (rủi ro 21). Task 13 ghi số vào sổ.

- [ ] **Bước 9: Chạy cổng kiểm tra**

Expected:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo;
- `Test Files  60 passed (60)`, `Tests  729 passed (729)` (`registry.test.ts` kiểm từng key mới);
- `Applied 7 migration(s).`; build và check-prerender như Task 4;
- E2E `122 passed`; visual `8 passed`.

- [ ] **Bước 10: Commit**

```bash
git add e2e/booking-email.spec.ts lib/i18n/registry.ts lib/server/content/strings.queries.ts lib/server/email/booking/format.ts lib/server/email/booking/render.test.ts lib/server/email/booking/render.ts lib/server/email/send.ts lib/server/email/templates/booking.tsx lib/server/email/templates/layout.tsx test/integration/email-outbox.test.ts test/integration/email-screens.test.ts
git commit -m "$(cat <<'EOF'
feat: write the booking emails in English and Vietnamese from the registry

The five booking emails (spec §10.4) now read their copy from registry keys
email.<event>.<field> and email.common.*, English and Vietnamese, on the
"emails" screen, overridden by content_strings rows exactly as the guest
site resolves them, and are rendered at send time from the booking the
drain has just re-read. One React Email layout lays out a heading, an
intro, a details table that stays aligned in the plain-text part, quoted
text, a button and the restaurant's phone as a tel: link. Dates and times
are Da Nang's calendar and clock in the email's language.

Guest emails carry the destination's number and never the admin link, the
guest's phone or their note; the decline and cancel emails quote the reason;
the request and confirmation intros are the done screen's words. staff.new
carries the guest's details and own request, says whether staff must act,
and links to the booking. Internal notes are never loaded. A guest email is
in the booking's language while that language is on or the registry has its
own copy (Vietnamese does), else the default; staff read their own
language. Reply-To: staff reply to the guest, guests to the shared inbox.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: "Thông báo email": người nhận, hộp thư chung, "Gửi email thử"

`/admin/settings/notifications` (chỉ Admin, spec §7.1, §7.2): người nhận `staff.new` (một nhà hàng, một điểm đến hoặc tất cả, ngôn ngữ, bật/tắt), hộp thư chung `site_settings.email` (R3), các nhà hàng đang rơi về hộp thư chung (đọc bằng đúng điều kiện của hàng đợi, C7), và "Gửi email thử" gửi thẳng (R9). Mọi lần lưu là một transaction có hàng `audit_log` và token đồng thời (spec §7.4). Menu có thêm "Thông báo email".

**Files:**
- Create: `lib/admin/notification-schemas.ts`, `lib/admin/notification-schemas.test.ts`, `lib/server/email/mode.ts`, `lib/server/email/mode.test.ts`, `lib/server/email/booking/sample.ts`, `lib/server/email/test-email.ts`, `app/admin/(shell)/settings/notifications/page.tsx`, `app/admin/(shell)/settings/notifications/actions.ts`, `app/admin/(shell)/settings/notifications/RecipientForm.tsx`, `app/admin/(shell)/settings/notifications/SharedInboxForm.tsx`, `app/admin/(shell)/settings/notifications/TestEmailForm.tsx`, `e2e/admin-emails.spec.ts`
- Modify: `lib/server/email/recipients.ts`, `lib/server/booking/config.ts`, `lib/server/action-result.ts`, `lib/admin/auth-errors.ts`, `lib/admin/auth-errors.test.ts`, `lib/admin/nav.ts`, `lib/admin/nav.test.ts`, `lib/admin/audit-labels.ts`, `lib/admin/audit-labels.test.ts`, `test/guards/require-permission.guard.test.ts`, `test/integration/email-screens.test.ts`

**Interfaces:**
- Consumes: `reachesSql` (Task 3); `queueStaffNew` (Task 3, test so hàng đợi với danh sách); `buildBookingEmail`, `loadEmailStrings`, `resolveEmailLocale`, `sharedInbox` (Task 5); `BookingEmailData` (Task 4); `createEmailSender`, `sendEmail`, `renderEmail`, `resolveMode` (Task 2); `appOrigin` (Task 2); `insertAudit`, `withTransaction`, `AuditActor` (đợt 3); `US` (đợt 4, `lib/server/booking/config.ts`); `Checkbox`, `Id`, `RestaurantId`, `Token` (`lib/admin/booking-schemas.ts`); `listLocales`, `listRestaurantOptions` (đợt 4).
- Produces:
  - `lib/server/booking/config.ts`: export `conflictBy(client, staffId, at)` và `type Conflict`.
  - `lib/server/email/recipients.ts`: `restaurantsWithoutRecipient(db): Promise<{ id; name }[]>`; `type RecipientScope`, `type RecipientInput`, `type Recipient`; `listRecipients(db)`, `createRecipient(pool, actor, input)` → `{ ok, data: { id } } | duplicate`, `updateRecipient(pool, actor, input & { id, token })` → `ok | not_found | conflict | duplicate`, `deleteRecipient(pool, actor, { id, token })`, `getSharedInbox(db): { email; token }`, `saveSharedInbox(pool, actor, { email, token })`.
  - `lib/admin/notification-schemas.ts`: `EmailAddress`, `LocaleCode`, `RecipientForm`, `RecipientTarget`, `SharedInboxForm`, `TestEmailForm` (Task 7 thêm `RequeueForm`).
  - `lib/server/email/mode.ts`: `deliveryModeNotice(env = process.env): string` (chỉ chế độ; phán quyết là của `resolveMode` (Task 2), nên `live` trên Preview hay dưới `vercel dev` là "không hợp lệ").
  - `lib/server/email/booking/sample.ts`: `sampleBooking(now?)`, `TEST_SUBJECT_PREFIX = '[Email thử] '`, `renderSampleEmail(pool, event, locale, { adminOrigin, now? })`.
  - `lib/server/email/test-email.ts`: `type TestEmailResult`; `sendTestEmail(pool, { to, event, locale }, { adminOrigin?, send?, env? } = {})`.
  - `lib/server/action-result.ts`: `ActionCode` thêm `'email_failed'`; `lib/admin/auth-errors.ts`: `emailFailureHint(stored): string`, `actionErrorMessage('email_failed', { error })`.
  - `lib/admin/audit-labels.ts`: thực thể `notification_recipient` "Người nhận thông báo", `site_settings` "Cài đặt chung".

- [ ] **Bước 1: Viết test đơn vị**

Create `lib/admin/notification-schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { RecipientForm, SharedInboxForm, TestEmailForm } from './notification-schemas';

/* The "Thông báo email" actions' inputs (spec §7.3): FormData strings in, typed values or Vietnamese field errors out. */
describe('notification form schemas', () => {
  it('a recipient: the address trimmed, the target its scope needs, staff events only', () => {
    const base = { scope: 'restaurant', restaurantId: 'hura-izakaya', destinationId: '', email: '  bep@furama.test ', events: ['staff.new'], locale: 'vi', active: 'on' };
    expect(RecipientForm.parse(base)).toEqual({
      scope: 'restaurant',
      restaurantId: 'hura-izakaya',
      destinationId: null,
      email: 'bep@furama.test',
      events: ['staff.new'],
      locale: 'vi',
      active: true,
    });
    expect(RecipientForm.parse({ ...base, active: undefined }).active).toBe(false);
    expect(RecipientForm.safeParse({ ...base, restaurantId: '', email: 'a@b@c', events: [] }).error?.flatten().fieldErrors).toEqual({
      email: ['Email không hợp lệ.'],
      events: ['Chọn ít nhất một loại thông báo.'],
      restaurantId: ['Chọn nhà hàng.'],
    });
    expect(RecipientForm.safeParse({ ...base, scope: 'destination', restaurantId: '' }).error?.flatten().fieldErrors).toEqual({ destinationId: ['Chọn điểm đến.'] });
    expect(RecipientForm.safeParse({ ...base, events: ['guest.ack'] }).success).toBe(false);
    expect(RecipientForm.safeParse({ ...base, email: `${'a'.repeat(250)}@x.vn` }).error?.flatten().fieldErrors).toEqual({ email: ['Email tối đa 254 ký tự.'] });
  });

  it('the shared inbox and the test email', () => {
    expect(SharedInboxForm.parse({ email: ' fb@furamavietnam.com ', token: '1759400000000000' })).toEqual({ email: 'fb@furamavietnam.com', token: '1759400000000000' });
    expect(SharedInboxForm.safeParse({ email: '', token: '1' }).error?.flatten().fieldErrors).toEqual({ email: ['Nhập email.'] });
    expect(TestEmailForm.parse({ to: 'it@furama.test', event: 'guest.declined', locale: 'en' })).toEqual({ to: 'it@furama.test', event: 'guest.declined', locale: 'en' });
    expect(TestEmailForm.safeParse({ to: 'it@furama.test', event: 'staff.test', locale: 'en' }).error?.flatten().fieldErrors).toEqual({ event: ['Chọn loại email.'] });
  });
});
```

Create `lib/server/email/mode.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deliveryModeNotice } from './mode';

describe('deliveryModeNotice', () => {
  it('names the mode staff should know about, and nothing of the settings behind it', () => {
    expect(deliveryModeNotice({})).toBe('Chế độ gửi: chỉ ghi log — không email nào được gửi đi từ môi trường này.');
    expect(deliveryModeNotice({ EMAIL_DELIVERY: 'live', SMTP_HOST: 'smtp.secret.test', SMTP_PASSWORD: 'pw' })).toBe(
      'Chế độ gửi: thật (live) — email tới đúng người nhận.',
    );
    const redirect = deliveryModeNotice({ EMAIL_DELIVERY: 'redirect', EMAIL_REDIRECT_TO: 'boss@furama.test' });
    expect(redirect).toBe('Chế độ gửi: chuyển hướng (redirect) — mọi email về hộp thư thử nghiệm, không tới khách.');
    expect(redirect).not.toContain('@');
    expect(deliveryModeNotice({ EMAIL_DELIVERY: 'Live x' })).toBe('Chế độ gửi không hợp lệ: không email nào được gửi.');
  });

  it('live on a Preview or under `vercel dev` is not live: the sender refuses it there, and so does the notice', () => {
    for (const VERCEL_ENV of ['preview', 'development']) {
      expect(deliveryModeNotice({ EMAIL_DELIVERY: 'live', VERCEL_ENV })).toBe(
        'Chế độ gửi không hợp lệ: thật (live) chỉ dùng ở Production — không email nào được gửi từ môi trường này.',
      );
    }
    expect(deliveryModeNotice({ EMAIL_DELIVERY: 'live', VERCEL_ENV: 'production' })).toBe('Chế độ gửi: thật (live) — email tới đúng người nhận.');
    expect(deliveryModeNotice({ EMAIL_DELIVERY: 'redirect', VERCEL_ENV: 'preview' })).toBe(
      'Chế độ gửi: chuyển hướng (redirect) — mọi email về hộp thư thử nghiệm, không tới khách.',
    );
  });
});
```

Sửa `lib/admin/auth-errors.test.ts`:

```diff
diff --git a/lib/admin/auth-errors.test.ts b/lib/admin/auth-errors.test.ts
index def9fb6..08c99b7 100644
--- a/lib/admin/auth-errors.test.ts
+++ b/lib/admin/auth-errors.test.ts
@@ -1,5 +1,5 @@
 import { describe, expect, it } from 'vitest';
-import { actionErrorMessage, authErrorMessage, inviteEmailFailedMessage } from './auth-errors';
+import { actionErrorMessage, authErrorMessage, emailFailureHint, inviteEmailFailedMessage } from './auth-errors';
 
 describe('authErrorMessage', () => {
   it.each([
@@ -57,6 +57,37 @@ describe('actionErrorMessage', () => {
   });
 });
 
+describe('"Gửi email thử" failures (R9)', () => {
+  it('says what to fix for each kind of failure, and quotes the stored error', () => {
+    expect(emailFailureHint('missing_smtp_config: SMTP_HOST is required when EMAIL_DELIVERY is live or redirect')).toBe(
+      'Chưa cấu hình SMTP (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD) trên môi trường này.',
+    );
+    expect(emailFailureHint('missing_from: EMAIL_FROM with a sender address is required when EMAIL_DELIVERY=live')).toBe('Chưa đặt địa chỉ gửi (EMAIL_FROM).');
+    expect(emailFailureHint('missing_redirect_to: EMAIL_REDIRECT_TO is required')).toBe('Chế độ redirect cần EMAIL_REDIRECT_TO.');
+    expect(emailFailureHint('missing_app_url: BETTER_AUTH_URL is required')).toBe('Chưa đặt BETTER_AUTH_URL (địa chỉ của trang quản trị) cho các liên kết trong email.');
+    expect(emailFailureHint('not_delivered: EMAIL_DELIVERY is log (or unset) on a Vercel preview deployment')).toBe('Môi trường này chưa bật gửi email (EMAIL_DELIVERY).');
+    expect(emailFailureHint('provider_error: SMTP EAUTH at AUTH PLAIN: Invalid login: 535 Authentication failed')).toBe(
+      'Máy chủ SMTP từ chối tài khoản đăng nhập: kiểm tra SMTP_USER và SMTP_PASSWORD.',
+    );
+    for (const stored of [
+      'provider_error: SMTP ESOCKET at CONN: connect ECONNREFUSED 127.0.0.1:587',
+      'provider_error: SMTP ETIMEDOUT at CONN: Greeting never received',
+      'provider_error: SMTP ETLS at STARTTLS: Error upgrading connection with STARTTLS',
+    ]) {
+      expect(emailFailureHint(stored)).toBe('Không kết nối được máy chủ SMTP: kiểm tra SMTP_HOST, SMTP_PORT và SMTP_SECURE.');
+    }
+    expect(emailFailureHint("rejected: SMTP EENVELOPE at RCPT TO: Can't send mail - all recipients were rejected: 550 <redacted>")).toBe(
+      'Máy chủ SMTP từ chối địa chỉ người nhận.',
+    );
+    expect(emailFailureHint('provider_error: SMTP EMESSAGE at DATA: Message failed: 554 Message rejected')).toBe('Kiểm tra cấu hình gửi email rồi thử lại.');
+    const stored = 'provider_error: SMTP EAUTH at AUTH PLAIN: Invalid login: 535 Authentication failed';
+    expect(actionErrorMessage('email_failed', { error: stored })).toBe(
+      `Không gửi được email thử. Máy chủ SMTP từ chối tài khoản đăng nhập: kiểm tra SMTP_USER và SMTP_PASSWORD. (${stored})`,
+    );
+    expect(actionErrorMessage('email_failed')).toBe('Không gửi được email thử.');
+  });
+});
+
 describe('inviteEmailFailedMessage', () => {
   const setup = 'Chưa gửi được email: chưa cấu hình gửi email trên môi trường này. Báo bộ phận kỹ thuật, rồi bấm Gửi lại.';
   it.each([
```

Sửa `lib/admin/nav.test.ts`:

```diff
diff --git a/lib/admin/nav.test.ts b/lib/admin/nav.test.ts
index 510c977..fd746d2 100644
--- a/lib/admin/nav.test.ts
+++ b/lib/admin/nav.test.ts
@@ -3,7 +3,7 @@ import { navFor } from './nav';
 
 describe('navFor', () => {
   it('shows each role only what its permissions open', () => {
-    expect(navFor('admin').map((i) => i.label)).toEqual(['Tổng quan', 'Đặt bàn', 'Nhà hàng', 'Cài đặt đặt bàn', 'Nhân viên', 'Nhật ký']);
+    expect(navFor('admin').map((i) => i.label)).toEqual(['Tổng quan', 'Đặt bàn', 'Nhà hàng', 'Cài đặt đặt bàn', 'Thông báo email', 'Nhân viên', 'Nhật ký']);
     expect(navFor('editor').map((i) => i.label)).toEqual(['Tổng quan', 'Đặt bàn', 'Nhà hàng']);
   });
 });
```

Sửa `lib/admin/audit-labels.test.ts`:

```diff
diff --git a/lib/admin/audit-labels.test.ts b/lib/admin/audit-labels.test.ts
index 97cd0e9..c8a3e06 100644
--- a/lib/admin/audit-labels.test.ts
+++ b/lib/admin/audit-labels.test.ts
@@ -53,6 +53,13 @@ describe('audit labels', () => {
     ]);
   });
 
+  it('names every entity the email settings write to audit_log', () => {
+    const source = readFileSync('lib/server/email/recipients.ts', 'utf8');
+    const entities = [...new Set([...source.matchAll(/entityType: '([a-z_]+)'/g)].map((m) => m[1]))].sort();
+    expect(entities).toEqual(['notification_recipient', 'site_settings']);
+    expect(entities.map(auditEntityLabel)).toEqual(['Người nhận thông báo', 'Cài đặt chung']);
+  });
+
   it('names every configuration entity the booking screens write to audit_log', () => {
     const config = readFileSync('lib/server/booking/config.ts', 'utf8');
     const entities = [...new Set([...config.matchAll(/entityType: '([a-z_]+)'/g)].map((m) => m[1]))];
```

Thêm năm action vào bảng quyền của guard, và file vào `ADMIN_ONLY_ACTIONS`. Sửa `test/guards/require-permission.guard.test.ts`:

```diff
diff --git a/test/guards/require-permission.guard.test.ts b/test/guards/require-permission.guard.test.ts
index 39e5b4d..3750825 100644
--- a/test/guards/require-permission.guard.test.ts
+++ b/test/guards/require-permission.guard.test.ts
@@ -40,10 +40,11 @@ describe('requirePermission guard (the repository)', () => {
   });
 });
 
-/** Files whose every action is Admin-only (spec §7.1: staff, invitations; booking settings; auto_confirm). */
+/** Files whose every action is Admin-only (spec §7.1: staff, invitations; booking and notification settings; auto_confirm). */
 const ADMIN_ONLY_ACTIONS = [
   'app/admin/(shell)/users/actions.ts',
   'app/admin/(shell)/settings/booking/actions.ts',
+  'app/admin/(shell)/settings/notifications/actions.ts',
   'app/admin/(shell)/restaurants/[id]/booking/auto-confirm-actions.ts',
 ];
 
@@ -76,6 +77,14 @@ const BOOKING_ACTIONS: Record<string, Record<string, { permission: object; edito
   'app/admin/(shell)/settings/booking/actions.ts': {
     saveSettings: { permission: { settings: ['update'] }, editor: false },
   },
+  // Phase 5: "Cài đặt … thông báo" is Admin only (spec §7.1); "Gửi email thử" sends to any address typed.
+  'app/admin/(shell)/settings/notifications/actions.ts': {
+    addRecipient: { permission: { settings: ['update'] }, editor: false },
+    editRecipient: { permission: { settings: ['update'] }, editor: false },
+    removeRecipient: { permission: { settings: ['update'] }, editor: false },
+    saveInbox: { permission: { settings: ['update'] }, editor: false },
+    sendTest: { permission: { settings: ['update'] }, editor: false },
+  },
 };
 
 describe('booking actions follow the permission matrix (spec §7.1)', () => {
```

- [ ] **Bước 2: Viết test tích hợp**

Ai nhận `staff.new` (hợp ba phạm vi, bỏ trùng không phân biệt hoa thường, ngôn ngữ của phạm vi hẹp nhất; không ai thì hộp thư chung bằng tiếng Việt), danh sách nhà hàng rơi về hộp thư chung khớp với hàng đợi cho **mọi** nhà hàng (C7), CRUD với audit và xung đột, trùng theo hoa thường, hộp thư chung, và "Gửi email thử" qua máy SMTP giả (live, redirect, sai mật khẩu; không lưu gì, log chỉ mang mã). Đổi tên biến `vi` của Task 5 thành `viBooking`: file nay import `vi` của Vitest. Sửa `test/integration/email-screens.test.ts`:

```diff
diff --git a/test/integration/email-screens.test.ts b/test/integration/email-screens.test.ts
index bc27e23..501f1e4 100644
--- a/test/integration/email-screens.test.ts
+++ b/test/integration/email-screens.test.ts
@@ -1,18 +1,70 @@
 import { Pool } from 'pg';
-import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
+import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
 import type { EmailEvent } from '@/lib/email/events';
 import { loadBookingEmailData } from '@/lib/server/email/booking/load';
 import { renderOutboxEmail } from '@/lib/server/email/booking/render';
+import { queueStaffNew } from '@/lib/server/email/outbox';
+import {
+  createRecipient,
+  deleteRecipient,
+  getSharedInbox,
+  listRecipients,
+  restaurantsWithoutRecipient,
+  saveSharedInbox,
+  updateRecipient,
+  type RecipientInput,
+} from '@/lib/server/email/recipients';
+import { createEmailSender } from '@/lib/server/email/send';
+import { sendTestEmail } from '@/lib/server/email/test-email';
 import { TEST_DATABASE_URL } from '../helpers/db';
+import { startSmtpSink, type SmtpSink } from '../helpers/smtp-sink';
 
 /*
- * Phase 5's booking emails against the database: rendering a booking's email
- * from its row as the drain does (the language rule R10, content_strings
- * overrides, no internal notes, the destination's phone, Reply-To). Never a
- * real SMTP server.
+ * Phase 5's booking emails and email screens against the database: rendering
+ * a booking's email from its row as the drain does (the language rule R10,
+ * content_strings overrides, no internal notes, the destination's phone,
+ * Reply-To); who hears about a booking; the recipients and shared-inbox saves
+ * with their audit rows; "Gửi email thử" over a local SMTP sink. Never a real
+ * SMTP server.
  */
 
 let pool: Pool;
+let sink: SmtpSink;
+const ADMIN = { id: 'admin-1', email: 'owner@furama.test', name: 'Chủ quán' };
+const ORIGIN = 'https://admin.furama.test';
+
+const recipient = (over: Partial<RecipientInput> = {}): RecipientInput => ({
+  scope: 'all',
+  destinationId: null,
+  restaurantId: null,
+  email: 'lan@furama.test',
+  events: ['staff.new'],
+  locale: 'vi',
+  active: true,
+  ...over,
+});
+
+/** The staff.new rows a web booking at `restaurant` would queue now, as [address, language, fallback]. */
+async function wouldQueue(restaurant: string): Promise<[string, string, boolean][]> {
+  const id = await seedReservation({ restaurant });
+  const client = await pool.connect();
+  try {
+    await client.query('BEGIN');
+    const event = await client.query<{ id: string }>(
+      `INSERT INTO reservation_events (reservation_id, actor_kind, type, to_status) VALUES ($1, 'guest', 'created', 'requested') RETURNING id::text`,
+      [id],
+    );
+    await queueStaffNew(client, { reservationId: id, eventId: event.rows[0].id, env: 'development' });
+    const { rows } = await client.query<{ to_email: string; locale: string; fallback: boolean }>(
+      `SELECT to_email, locale, fallback FROM email_outbox WHERE reservation_id = $1 ORDER BY lower(to_email)`,
+      [id],
+    );
+    return rows.map((r) => [r.to_email, r.locale, r.fallback]);
+  } finally {
+    await client.query('ROLLBACK');
+    client.release();
+  }
+}
 
 async function seedReservation(over: { status?: string; email?: string | null; locale?: string; restaurant?: string; statusReason?: string | null } = {}) {
   const { rows } = await pool.query<{ id: string }>(
@@ -35,8 +87,10 @@ async function render(event: EmailEvent, id: string, locale: string) {
 describe.skipIf(!TEST_DATABASE_URL)('email screens and templates (database)', () => {
   beforeAll(async () => {
     pool = new Pool({ connectionString: TEST_DATABASE_URL });
+    sink = await startSmtpSink({ login: { user: 'mailer', pass: 'sink-password' } });
   });
   afterAll(async () => {
+    await sink.close();
     await pool.query(`UPDATE site_settings SET email = 'fb@furamavietnam.com'`);
     await pool.query(`DELETE FROM content_strings WHERE key LIKE 'email.%'`);
     await pool.query(`DELETE FROM locales WHERE code = 'ko'`);
@@ -54,8 +108,8 @@ describe.skipIf(!TEST_DATABASE_URL)('email screens and templates (database)', ()
   describe('rendering from the reservation row', () => {
     it('a guest email speaks the booking’s language when it is on, or when the registry has its copy (vi); else the default (R10)', async () => {
       // vi is off on the site (migration 004), yet the registry has every email key in Vietnamese: a phone booking in vi reads Vietnamese.
-      const vi = await seedReservation({ locale: 'vi', status: 'confirmed' });
-      const off = await render('guest.confirmed', vi, 'vi');
+      const viBooking = await seedReservation({ locale: 'vi', status: 'confirmed' });
+      const off = await render('guest.confirmed', viBooking, 'vi');
       expect(off).toMatchObject({ locale: 'vi', subject: expect.stringMatching(/^Đặt bàn của bạn đã được xác nhận \(FC-/) });
       expect(off.html).toContain('lang="vi"');
       expect(off.text).toContain('Thứ Hai, 5 tháng 10, 2026');
@@ -71,7 +125,7 @@ describe.skipIf(!TEST_DATABASE_URL)('email screens and templates (database)', ()
       expect(on.locale).toBe('ko');
       expect(on.html).toContain('lang="ko"');
       // Staff keep the recipient's language, on the site or not.
-      const staff = await render('staff.new', vi, 'vi');
+      const staff = await render('staff.new', viBooking, 'vi');
       expect(staff).toMatchObject({ locale: 'vi', subject: expect.stringMatching(/^Đặt bàn mới FC-/) });
     });
 
@@ -120,4 +174,123 @@ describe.skipIf(!TEST_DATABASE_URL)('email screens and templates (database)', ()
       expect((await render('staff.new', noEmail, 'vi')).replyTo).toBeUndefined();
     });
   });
+  describe('who gets staff.new (spec §10.4)', () => {
+    it('merges all, the destination and the restaurant, one row per address, the most specific language', async () => {
+      await createRecipient(pool, ADMIN, recipient({ email: 'gm@furama.test' }));
+      await createRecipient(pool, ADMIN, recipient({ scope: 'destination', destinationId: 'resort', email: 'fb.resort@furama.test' }));
+      await createRecipient(pool, ADMIN, recipient({ scope: 'restaurant', restaurantId: 'taya-house', email: 'taya@furama.test', locale: 'en' }));
+      // The same address again, on the restaurant, in English: one email, in English.
+      await createRecipient(pool, ADMIN, recipient({ scope: 'restaurant', restaurantId: 'taya-house', email: 'GM@furama.test', locale: 'en' }));
+      await createRecipient(pool, ADMIN, recipient({ scope: 'restaurant', restaurantId: 'pho-cuon', email: 'pho@furama.test' }));
+      await createRecipient(pool, ADMIN, recipient({ scope: 'restaurant', restaurantId: 'taya-house', email: 'off@furama.test', active: false }));
+      expect(await wouldQueue('taya-house')).toEqual([
+        ['fb.resort@furama.test', 'vi', false],
+        ['GM@furama.test', 'en', false],
+        ['taya@furama.test', 'en', false],
+      ]);
+      expect(await wouldQueue('pho-cuon')).toEqual([
+        ['gm@furama.test', 'vi', false],
+        ['pho@furama.test', 'vi', false],
+      ]);
+    });
+
+    it('nobody matches: the shared inbox, in Vietnamese, as a fallback; the restaurants in that case are the ones listed (R21)', async () => {
+      await createRecipient(pool, ADMIN, recipient({ scope: 'restaurant', restaurantId: 'taya-house', email: 'taya@furama.test' }));
+      expect(await wouldQueue('pho-cuon')).toEqual([['fb@furamavietnam.com', 'vi', true]]);
+      const missing = (await restaurantsWithoutRecipient(pool)).map((r) => r.id);
+      expect(missing).not.toContain('taya-house');
+      expect(missing).toContain('pho-cuon');
+      // The list and the queue agree for every restaurant.
+      for (const { id } of await pool.query<{ id: string }>(`SELECT id FROM restaurants WHERE booking_enabled`).then((r) => r.rows)) {
+        expect((await wouldQueue(id))[0][2], id).toBe(missing.includes(id));
+      }
+      await pool.query(`UPDATE restaurants SET booking_enabled = false WHERE id = 'pho-cuon'`);
+      try {
+        expect((await restaurantsWithoutRecipient(pool)).map((r) => r.id)).not.toContain('pho-cuon');
+      } finally {
+        await pool.query(`UPDATE restaurants SET booking_enabled = true WHERE id = 'pho-cuon'`);
+      }
+      await createRecipient(pool, ADMIN, recipient({ scope: 'all', email: 'gm@furama.test' }));
+      expect(await restaurantsWithoutRecipient(pool)).toEqual([]);
+    });
+  });
+
+  describe('saving recipients and the shared inbox', () => {
+    it('create, update and delete each write one audit row; a save on a stale token is a conflict', async () => {
+      const created = await createRecipient(pool, ADMIN, recipient());
+      expect(created.ok).toBe(true);
+      const [row] = await listRecipients(pool);
+      expect(row).toMatchObject({ scope: 'all', email: 'lan@furama.test', events: ['staff.new'], locale: 'vi', active: true, restaurantName: null });
+      const updated = await updateRecipient(pool, ADMIN, { ...recipient({ locale: 'en', active: false }), id: row.id, token: row.token });
+      expect(updated).toEqual({ ok: true, data: null });
+      const stale = await updateRecipient(pool, ADMIN, { ...recipient(), id: row.id, token: row.token });
+      expect(stale).toMatchObject({ ok: false, code: 'conflict', params: { by: 'người khác' } });
+      const [after] = await listRecipients(pool);
+      expect(after).toMatchObject({ locale: 'en', active: false });
+      expect(await deleteRecipient(pool, ADMIN, { id: row.id, token: row.token })).toMatchObject({ ok: false, code: 'conflict' });
+      expect(await deleteRecipient(pool, ADMIN, { id: row.id, token: after.token })).toEqual({ ok: true, data: null });
+      expect(await deleteRecipient(pool, ADMIN, { id: row.id, token: after.token })).toEqual({ ok: false, code: 'not_found' });
+      const { rows } = await pool.query<{ action: string; entity_type: string; before: unknown; after: unknown }>(
+        `SELECT action, entity_type, before, after FROM audit_log ORDER BY id`,
+      );
+      expect(rows.map((r) => [r.action, r.entity_type])).toEqual([
+        ['create', 'notification_recipient'],
+        ['update', 'notification_recipient'],
+        ['delete', 'notification_recipient'],
+      ]);
+      expect(rows[1]).toMatchObject({ before: { locale: 'vi', active: true }, after: { locale: 'en', active: false } });
+    });
+
+    it('the same address twice on one target is refused, whatever its case; another target is another row', async () => {
+      await createRecipient(pool, ADMIN, recipient({ email: 'lan@furama.test' }));
+      expect(await createRecipient(pool, ADMIN, recipient({ email: 'LAN@furama.test' }))).toEqual({ ok: false, code: 'duplicate' });
+      expect((await createRecipient(pool, ADMIN, recipient({ scope: 'restaurant', restaurantId: 'taya-house', email: 'lan@furama.test' }))).ok).toBe(true);
+      const [all, taya] = await listRecipients(pool);
+      expect(await updateRecipient(pool, ADMIN, { ...recipient({ email: 'Lan@Furama.test' }), id: taya.id, token: taya.token })).toEqual({ ok: false, code: 'duplicate' });
+      expect(all.restaurantName).toBeNull();
+      expect(taya.restaurantName).toBe('Tàya House');
+    });
+
+    it('the shared inbox saves with its token and audits the change', async () => {
+      const before = await getSharedInbox(pool);
+      expect(before.email).toBe('fb@furamavietnam.com');
+      expect(await saveSharedInbox(pool, ADMIN, { email: 'datban@furama.test', token: before.token })).toEqual({ ok: true, data: null });
+      expect(await saveSharedInbox(pool, ADMIN, { email: 'x@furama.test', token: before.token })).toMatchObject({ code: 'conflict' });
+      expect((await getSharedInbox(pool)).email).toBe('datban@furama.test');
+      const { rows } = await pool.query(`SELECT action, entity_type, before, after FROM audit_log`);
+      expect(rows).toEqual([{ action: 'settings', entity_type: 'site_settings', before: { email: 'fb@furamavietnam.com' }, after: { email: 'datban@furama.test' } }]);
+    });
+  });
+
+  describe('"Gửi email thử" (R9)', () => {
+    it('sends the sample booking’s email in the language asked for, marked as a test, through the same gate, and stores nothing', async () => {
+      const before = sink.received.length;
+      const send = createEmailSender({ env: sink.env(), transportOverrides: sink.clientOverrides });
+      const result = await sendTestEmail(pool, { to: 'it@furama.test', event: 'staff.new', locale: 'vi' }, { adminOrigin: ORIGIN, send });
+      expect(result).toEqual({ ok: true, data: { mode: 'live', to: 'it@furama.test' } });
+      const [got] = sink.received.slice(before);
+      expect(got.to).toEqual(['it@furama.test']);
+      expect(got.subject).toMatch(/^\[Email thử\] Đặt bàn mới FC-0000TEST: Tàya House, .+ 19:00, 4 khách$/);
+      expect(got.replyTo).toBe('khach.mau@example.com');
+      // The body is the sample booking's: its reference and phone, never a real guest's.
+      expect(got.raw.split(/\r?\n\r?\n/).slice(1).join('\n')).toContain('0905 000 000');
+      // No booking was read or written, and no outbox row.
+      expect((await pool.query('SELECT (SELECT count(*)::int FROM email_outbox) + (SELECT count(*)::int FROM reservations) AS n')).rows[0].n).toBe(0);
+    });
+
+    it('redirect mode says where it really went; a refused login answers email_failed with an address-free error, logging only the code', async () => {
+      const redirect = createEmailSender({ env: sink.env({ EMAIL_DELIVERY: 'redirect', EMAIL_REDIRECT_TO: 'qa@furama.test' }), transportOverrides: sink.clientOverrides });
+      expect(
+        await sendTestEmail(pool, { to: 'it@furama.test', event: 'guest.confirmed', locale: 'en' }, { adminOrigin: ORIGIN, send: redirect, env: { EMAIL_REDIRECT_TO: 'qa@furama.test' } }),
+      ).toEqual({ ok: true, data: { mode: 'redirect', to: 'qa@furama.test' } });
+      expect(sink.received.at(-1)?.subject).toMatch(/^\[it@furama\.test\] \[Email thử\] Your table is confirmed \(FC-0000TEST\)$/);
+      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
+      const badAuth = createEmailSender({ env: sink.env({ SMTP_PASSWORD: 'wrong' }), transportOverrides: sink.clientOverrides });
+      const failed = await sendTestEmail(pool, { to: 'it@furama.test', event: 'guest.ack', locale: 'en' }, { adminOrigin: ORIGIN, send: badAuth });
+      expect(failed).toMatchObject({ ok: false, code: 'email_failed', params: { error: expect.stringMatching(/^provider_error: SMTP EAUTH at AUTH PLAIN: Invalid login: 535/) } });
+      expect(JSON.stringify(failed)).not.toContain('@');
+      expect(errors.mock.calls).toEqual([['[email] test send failed', { code: 'provider_error' }]]);
+      errors.mockRestore();
+    });
+  });
 });
```

- [ ] **Bước 3: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/admin/notification-schemas.test.ts lib/server/email/mode.test.ts test/integration/email-screens.test.ts lib/admin/nav.test.ts lib/admin/audit-labels.test.ts lib/admin/auth-errors.test.ts test/guards/require-permission.guard.test.ts`
Expected: FAIL `Test Files  7 failed (7)`, `Tests  5 failed | 62 passed (67)`:

```
 ❯ test/integration/email-screens.test.ts (0 test)
 ❯ test/guards/require-permission.guard.test.ts (24 tests | 2 failed) 39ms
     × every staff-screen action asks for a permission the Editor lacks 3ms
     × app/admin/(shell)/settings/notifications/actions.ts 0ms
 ❯ lib/admin/auth-errors.test.ts (36 tests | 1 failed) 5ms
     × says what to fix for each kind of failure, and quotes the stored error 1ms
 ❯ lib/admin/audit-labels.test.ts (6 tests | 1 failed) 6ms
     × names every entity the email settings write to audit_log 3ms
 ❯ lib/admin/notification-schemas.test.ts (0 test)
 ❯ lib/server/email/mode.test.ts (0 test)
 ❯ lib/admin/nav.test.ts (1 test | 1 failed) 4ms
     × shows each role only what its permissions open 4ms
 FAIL  test/integration/email-screens.test.ts [ test/integration/email-screens.test.ts ]
Error: Cannot find package '@/lib/server/email/test-email' imported from …/test/integration/email-screens.test.ts
 FAIL  lib/admin/auth-errors.test.ts > "Gửi email thử" failures (R9) > says what to fix for each kind of failure, and quotes the stored error
TypeError: emailFailureHint is not a function
 FAIL  test/guards/require-permission.guard.test.ts > booking actions follow the permission matrix (spec §7.1) > app/admin/(shell)/settings/notifications/actions.ts
Error: ENOENT: no such file or directory, open '…/app/admin/(shell)/settings/notifications/actions.ts'
```

- [ ] **Bước 4: Viết E2E và chạy nó trên build hiện tại: phải đỏ**

Create `e2e/admin-emails.spec.ts` (Task 7 thêm ba test). Người nhận mới nằm ở Hura Izakaya (phạm vi nhà hàng, không chạm hộp thư chung của `booking-email`), địa chỉ mới mỗi lần, xóa trong `finally`:

```ts
import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expectHydrated, watchCsp } from './csp';
import { emailsTo } from './email-log';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * Phase 5 email screens (spec §7.2): the Admin's "Thông báo email"
 * (recipients, the restaurants left to the shared inbox, "Gửi email thử").
 * The server runs EMAIL_DELIVERY=log, so a "sent" email is a line in
 * EMAIL_LOG_FILE. Data: recipients on Hura Izakaya under a fresh address,
 * removed afterwards. No spec running beside this one may add an 'all' or a
 * 'destination' recipient: booking-email expects the general inbox.
 */

test.beforeAll(() => seedStaff());
test.use({ reducedMotion: 'reduce' });

const main = (page: Page) => page.getByRole('main');
const nav = (page: Page) => page.getByRole('navigation', { name: 'Điều hướng quản trị' });
const unique = () => randomBytes(3).toString('hex');

test('an Editor has no notification settings: no menu item, and the 403 view', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  await expect(nav(page).getByRole('link', { name: 'Thông báo email' })).toHaveCount(0);
  const res = await page.goto('/admin/settings/notifications');
  expect(await res?.text()).not.toContain('Hộp thư chung');
  await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible();
});

test('the Admin adds a recipient, sees which restaurants still go to the shared inbox, and sends a test email', async ({ page }) => {
  const address = `bep.${unique()}@furama.test`;
  const violations = await watchCsp(page);
  try {
    await signInAs(page, STAFF.admin);
    await nav(page).getByRole('link', { name: 'Thông báo email' }).click();
    await expect(page.getByRole('heading', { name: 'Thông báo email', level: 1 })).toBeVisible();
    await expectHydrated(page);
    await expect(main(page).getByTestId('delivery-mode')).toContainText('chỉ ghi log');

    const add = page.getByRole('form', { name: 'Thêm người nhận' });
    await add.getByLabel('Email người nhận', { exact: true }).fill(address);
    await add.getByLabel('Nhận thông báo của', { exact: true }).selectOption('restaurant');
    await add.getByLabel('Nhà hàng', { exact: true }).selectOption('hura-izakaya');
    await add.getByRole('button', { name: 'Thêm người nhận' }).click();
    await expect(add.getByRole('status')).toHaveText('Đã thêm người nhận.');
    await expect(main(page).getByRole('region', { name: `${address} · Nhà hàng: Hura Izakaya` })).toBeVisible();
    expect(await one(`SELECT scope, restaurant_id, locale, events, active FROM notification_recipients WHERE email = $1`, [address])).toEqual({
      scope: 'restaurant',
      restaurant_id: 'hura-izakaya',
      locale: 'vi',
      events: ['staff.new'],
      active: true,
    });
    // The same address on the same restaurant again: refused at the field.
    await add.getByLabel('Email người nhận', { exact: true }).fill(address.toUpperCase());
    await add.getByLabel('Nhận thông báo của', { exact: true }).selectOption('restaurant');
    await add.getByLabel('Nhà hàng', { exact: true }).selectOption('hura-izakaya');
    await add.getByRole('button', { name: 'Thêm người nhận' }).click();
    await expect(add.getByText('Địa chỉ này đã nhận thông báo cho cùng phạm vi.')).toBeVisible();

    // Hura Izakaya now has someone; it leaves the list of restaurants that fall back to the shared inbox.
    const uncovered = main(page).getByRole('list', { name: 'Nhà hàng chưa có người nhận' });
    await expect(uncovered.getByText('Café Indochine', { exact: true })).toBeVisible();
    await expect(uncovered.getByText('Hura Izakaya', { exact: true })).toHaveCount(0);

    const trial = page.getByRole('form', { name: 'Gửi email thử' });
    const to = `thu.${unique()}@furama.test`;
    await trial.getByLabel('Gửi tới', { exact: true }).fill(to);
    await trial.getByRole('button', { name: 'Gửi email thử' }).click();
    await expect(trial.getByRole('status')).toContainText('chỉ ghi log');
    await expect.poll(() => emailsTo(to).length).toBe(1);
    const [email] = emailsTo(to);
    expect(email.subject).toMatch(/^\[Email thử\] Đặt bàn mới FC-0000TEST: Tàya House, .* 19:00, 4 khách$/);
    expect(email.text).toContain('Nguyễn Thị Mẫu');
    expect(violations).toEqual([]);
  } finally {
    await one(`DELETE FROM notification_recipients WHERE lower(email) = lower($1)`, [address]);
  }
});
```

Cất tạm các file ngoài `e2e/`, build, chạy `e2e/admin-emails.spec.ts --project=desktop`. Expected: `2 failed`:

```
  ✘  1 [desktop] › e2e/admin-emails.spec.ts:23:5 › an Editor has no notification settings: no menu item, and the 403 view (5.6s)
  ✘  2 [desktop] › e2e/admin-emails.spec.ts:31:5 › the Admin adds a recipient, sees which restaurants still go to the shared inbox, and sends a test email (30.1s)
    Error: expect(locator).toBeVisible() failed
    Locator: getByRole('heading', { name: 'Không có quyền truy cập' })
    Error: element(s) not found
    Error: locator.click: Test timeout of 30000ms exceeded.
      - waiting for getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link', { name: 'Thông báo email' })
```

(Trang chưa có thì `/admin/settings/notifications` là trang "không tìm thấy" của admin, không phải 403.) Lấy lại các file đã cất.

- [ ] **Bước 5: Người nhận, hộp thư chung, schema**

Sửa `lib/server/booking/config.ts` (dùng chung token đồng thời và câu báo xung đột):

```diff
diff --git a/lib/server/booking/config.ts b/lib/server/booking/config.ts
index 6eada59..b5a9bba 100644
--- a/lib/server/booking/config.ts
+++ b/lib/server/booking/config.ts
@@ -22,12 +22,12 @@ import type { Db } from './rules';
 /** A timestamptz column as the concurrency token. */
 export const US = (column: string) => `(extract(epoch FROM ${column}) * 1000000)::bigint::text`;
 
-type Conflict = { ok: false; code: 'conflict'; params: { by: string; at: string } };
+export type Conflict = { ok: false; code: 'conflict'; params: { by: string; at: string } };
 type NotFound = { ok: false; code: 'not_found' };
 type Invalid = { ok: false; code: 'invalid'; fieldErrors: Record<string, string[]> };
 
 /** "Vừa được {tên} thay đổi lúc {giờ}": updated_by holds the staff id (spec §5.1.6). */
-async function conflictBy(client: PoolClient, staffId: string | null, at: Date): Promise<Conflict> {
+export async function conflictBy(client: PoolClient, staffId: string | null, at: Date): Promise<Conflict> {
   const { rows } = staffId ? await client.query<{ name: string }>('SELECT name FROM staff_user WHERE id = $1', [staffId]) : { rows: [] };
   return { ok: false, code: 'conflict', params: { by: rows[0]?.name ?? 'người khác', at: formatDateTimeVi(at) } };
 }
```

Replace the whole of `lib/server/email/recipients.ts` with (giữ `reachesSql` của Task 3; `restaurantsWithoutRecipient` dùng đúng điều kiện đó):

```ts
import 'server-only';
import type { Pool, PoolClient } from 'pg';
import type { StaffEmailEventName } from '@/lib/email/events';
import { insertAudit, withTransaction, type AuditActor } from '@/lib/server/audit';
import { US, conflictBy, type Conflict } from '@/lib/server/booking/config';

/*
 * Who receives staff notifications (spec §5.2 notification_recipients, §10.4),
 * and the shared inbox that receives them when nobody matches
 * (site_settings.email). Admin only (spec §7.1 "Cài đặt … thông báo"):
 * settings:read / settings:update. Saves follow spec §7.4: one transaction
 * with its audit_log row, optimistic concurrency on updated_at (the token).
 */

type Db = Pool | PoolClient;
type NotFound = { ok: false; code: 'not_found' };
/** The same address on the same target already exists (notification_recipients_target_email_idx). */
type Duplicate = { ok: false; code: 'duplicate' };

/**
 * SQL: notification_recipients row `n` reaches a booking at the restaurant
 * whose id and destination are the given SQL expressions: a row for that
 * restaurant, for its destination (restaurants.destination), or for 'all'
 * (spec §10.4, R4). The one definition: the queue (outbox.ts queueStaffNew)
 * and the overview's "Nhà hàng chưa có người nhận thông báo" both use it, so
 * they can never disagree about who hears about a booking. Callers add
 * `n.active AND 'staff.new' = ANY (n.events)`.
 */
export const reachesSql = (n: string, restaurantId: string, destination: string): string =>
  `(${n}.scope = 'all' OR (${n}.scope = 'destination' AND ${n}.destination_id = ${destination})` +
  ` OR (${n}.scope = 'restaurant' AND ${n}.restaurant_id = ${restaurantId}))`;

/** Restaurants taking online bookings that no active staff.new recipient reaches: their staff.new goes to the shared inbox (R21). */
export async function restaurantsWithoutRecipient(db: Db): Promise<{ id: string; name: string }[]> {
  const { rows } = await db.query<{ id: string; name: string }>(
    `SELECT r.id, r.name FROM restaurants r
      WHERE r.booking_enabled
        AND NOT EXISTS (SELECT 1 FROM notification_recipients n
                         WHERE n.active AND 'staff.new' = ANY (n.events) AND ${reachesSql('n', 'r.id', 'r.destination')})
      ORDER BY r.sort_order, r.id`,
  );
  return rows;
}

// ── the recipients ─────────────────────────────────────────────────────────

export type RecipientScope = 'all' | 'destination' | 'restaurant';

export type RecipientInput = {
  scope: RecipientScope;
  destinationId: string | null;
  restaurantId: string | null;
  email: string;
  events: StaffEmailEventName[];
  locale: string;
  active: boolean;
};

export type Recipient = RecipientInput & { id: string; token: string; restaurantName: string | null };

const COLUMNS = `n.id::text, n.scope, n.destination_id AS "destinationId", n.restaurant_id AS "restaurantId", n.email, n.events,
  n.locale, n.active, t.name AS "restaurantName", ${US('n.updated_at')} AS token`;

/** Every recipient: the widest scope first, then by target and address. */
export async function listRecipients(db: Db): Promise<Recipient[]> {
  const { rows } = await db.query<Recipient>(
    `SELECT ${COLUMNS}
       FROM notification_recipients n LEFT JOIN restaurants t ON t.id = n.restaurant_id
      ORDER BY CASE n.scope WHEN 'all' THEN 0 WHEN 'destination' THEN 1 ELSE 2 END,
               n.destination_id NULLS FIRST, t.sort_order NULLS FIRST, lower(n.email), n.id`,
  );
  return rows;
}

/** The row as audit_log keeps it: the same keys before and after, no token. */
async function snapshot(client: PoolClient, id: string): Promise<RecipientInput | null> {
  const { rows } = await client.query<Recipient>(
    `SELECT ${COLUMNS} FROM notification_recipients n LEFT JOIN restaurants t ON t.id = n.restaurant_id WHERE n.id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { id: _id, token: _token, restaurantName: _name, ...rest } = rows[0];
  return rest;
}

const isDuplicate = (err: unknown) => (err as { constraint?: string } | null)?.constraint === 'notification_recipients_target_email_idx';

export async function createRecipient(pool: Pool, actor: AuditActor, input: RecipientInput): Promise<{ ok: true; data: { id: string } } | Duplicate> {
  try {
    return await withTransaction(pool, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO notification_recipients (scope, destination_id, restaurant_id, email, events, locale, active, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $8) RETURNING id::text`,
        [input.scope, input.destinationId, input.restaurantId, input.email, input.events, input.locale, input.active, actor.id],
      );
      const id = rows[0].id;
      await insertAudit(client, actor, { action: 'create', entityType: 'notification_recipient', entityId: id, after: await snapshot(client, id) });
      return { ok: true, data: { id } } as const;
    });
  } catch (err) {
    if (isDuplicate(err)) return { ok: false, code: 'duplicate' };
    throw err;
  }
}

async function lockRecipient(client: PoolClient, id: string, token: string): Promise<NotFound | Conflict | null> {
  const { rows } = await client.query<{ token: string; updated_by: string | null; updated_at: Date }>(
    `SELECT ${US('updated_at')} AS token, updated_by, updated_at FROM notification_recipients WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!rows[0]) return { ok: false, code: 'not_found' };
  if (rows[0].token !== token) return conflictBy(client, rows[0].updated_by, rows[0].updated_at);
  return null;
}

export async function updateRecipient(
  pool: Pool,
  actor: AuditActor,
  input: RecipientInput & { id: string; token: string },
): Promise<{ ok: true; data: null } | NotFound | Conflict | Duplicate> {
  try {
    return await withTransaction(pool, async (client) => {
      const locked = await lockRecipient(client, input.id, input.token);
      if (locked) return locked;
      const before = await snapshot(client, input.id);
      await client.query(
        `UPDATE notification_recipients
            SET scope = $2, destination_id = $3, restaurant_id = $4, email = $5, events = $6::text[], locale = $7, active = $8,
                updated_at = now(), updated_by = $9
          WHERE id = $1`,
        [input.id, input.scope, input.destinationId, input.restaurantId, input.email, input.events, input.locale, input.active, actor.id],
      );
      await insertAudit(client, actor, {
        action: 'update',
        entityType: 'notification_recipient',
        entityId: input.id,
        before,
        after: await snapshot(client, input.id),
      });
      return { ok: true, data: null } as const;
    });
  } catch (err) {
    if (isDuplicate(err)) return { ok: false, code: 'duplicate' };
    throw err;
  }
}

export async function deleteRecipient(pool: Pool, actor: AuditActor, input: { id: string; token: string }): Promise<{ ok: true; data: null } | NotFound | Conflict> {
  return withTransaction(pool, async (client) => {
    const locked = await lockRecipient(client, input.id, input.token);
    if (locked) return locked;
    const before = await snapshot(client, input.id);
    await client.query('DELETE FROM notification_recipients WHERE id = $1', [input.id]);
    await insertAudit(client, actor, { action: 'delete', entityType: 'notification_recipient', entityId: input.id, before });
    return { ok: true, data: null } as const;
  });
}

// ── the shared inbox (site_settings.email) ─────────────────────────────────

export async function getSharedInbox(db: Db): Promise<{ email: string; token: string }> {
  const { rows } = await db.query<{ email: string; token: string }>(`SELECT email, ${US('updated_at')} AS token FROM site_settings WHERE id`);
  return rows[0];
}

/** R3: the same address is the general email of the site footer from phase 6/7; the screen says so. */
export async function saveSharedInbox(pool: Pool, actor: AuditActor, input: { email: string; token: string }): Promise<{ ok: true; data: null } | Conflict> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ email: string; token: string; updated_by: string | null; updated_at: Date }>(
      `SELECT email, ${US('updated_at')} AS token, updated_by, updated_at FROM site_settings WHERE id FOR UPDATE`,
    );
    if (rows[0].token !== input.token) return conflictBy(client, rows[0].updated_by, rows[0].updated_at);
    await client.query('UPDATE site_settings SET email = $1, updated_at = now(), updated_by = $2 WHERE id', [input.email, actor.id]);
    await insertAudit(client, actor, {
      action: 'settings',
      entityType: 'site_settings',
      entityId: null,
      before: { email: rows[0].email },
      after: { email: input.email },
    });
    return { ok: true, data: null } as const;
  });
}
```

Create `lib/admin/notification-schemas.ts`:

```ts
import { EMAIL_EVENTS, STAFF_EMAIL_EVENTS } from '@/lib/email/events';
import { Checkbox, Id, RestaurantId, Token } from './booking-schemas';
import { z } from './zod';

/*
 * Input schemas of the email screens' Server Actions (spec §7.3: Vietnamese
 * messages for the fields people type into). FormData strings; a blank
 * optional field, or one the form did not render, becomes null.
 */
const blankToNull = (v: unknown) => (v === undefined || (typeof v === 'string' && v.trim() === '') ? null : v);

/** An address staff type: trimmed (z.email alone does not trim), at most 254 characters (RFC 5321), one @. */
export const EmailAddress = z
  .string({ error: 'Nhập email.' })
  .trim()
  .min(1, { error: 'Nhập email.' })
  .max(254, { error: 'Email tối đa 254 ký tự.' })
  .pipe(z.email({ error: 'Email không hợp lệ.' }));

export const LocaleCode = z.string().regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/, { error: 'Chọn ngôn ngữ.' });

export const RecipientForm = z
  .object({
    scope: z.enum(['all', 'destination', 'restaurant'], { error: 'Chọn phạm vi.' }),
    destinationId: z.preprocess(blankToNull, z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).nullable()),
    restaurantId: z.preprocess(blankToNull, RestaurantId.nullable()),
    email: EmailAddress,
    events: z.array(z.enum(STAFF_EMAIL_EVENTS)).min(1, { error: 'Chọn ít nhất một loại thông báo.' }),
    locale: LocaleCode,
    active: Checkbox,
  })
  .refine((r) => r.scope !== 'restaurant' || r.restaurantId, { error: 'Chọn nhà hàng.', path: ['restaurantId'] })
  .refine((r) => r.scope !== 'destination' || r.destinationId, { error: 'Chọn điểm đến.', path: ['destinationId'] });

/** The row an edit or a delete is about, and the token the page saw. */
export const RecipientTarget = z.object({ id: Id, token: Token });

export const SharedInboxForm = z.object({ email: EmailAddress, token: Token });

export const TestEmailForm = z.object({
  to: EmailAddress,
  event: z.enum(EMAIL_EVENTS, { error: 'Chọn loại email.' }),
  locale: LocaleCode,
});
```

- [ ] **Bước 6: Chế độ gửi, đặt bàn mẫu, "Gửi email thử"**

Create `lib/server/email/mode.ts` (phán quyết lấy từ `resolveMode` của cổng gửi, nên màn hình không bao giờ nói "live" ở nơi bộ gửi từ chối gửi, như trên Preview; câu chỉ nêu chế độ, không cài đặt nào):

```ts
import 'server-only';
import { resolveMode } from './send';

/*
 * The email gate as staff should understand it (spec §10.4 "Cổng môi
 * trường"), read at request time for the email screens. The mode only: never
 * an SMTP setting, never the redirect address, never the raw variable
 * (Editors see the email log too). The verdict is the sender's own
 * (resolveMode), so the screen never says "live" where the sender refuses to
 * send, as on a Preview.
 */
export function deliveryModeNotice(env: Record<string, string | undefined> = process.env): string {
  let mode;
  try {
    mode = resolveMode(env.EMAIL_DELIVERY, env.VERCEL_ENV);
  } catch {
    return env.EMAIL_DELIVERY?.trim() === 'live'
      ? 'Chế độ gửi không hợp lệ: thật (live) chỉ dùng ở Production — không email nào được gửi từ môi trường này.'
      : 'Chế độ gửi không hợp lệ: không email nào được gửi.';
  }
  if (mode === 'live') return 'Chế độ gửi: thật (live) — email tới đúng người nhận.';
  if (mode === 'redirect') return 'Chế độ gửi: chuyển hướng (redirect) — mọi email về hộp thư thử nghiệm, không tới khách.';
  return 'Chế độ gửi: chỉ ghi log — không email nào được gửi đi từ môi trường này.';
}
```

Create `lib/server/email/booking/sample.ts` (một đặt bàn bịa: không dữ liệu khách nào bị gửi tới địa chỉ Admin gõ; link nhân viên trỏ `/admin/reservations/0`; Reply-To theo R11 như email thật):

```ts
import 'server-only';
import type { Pool } from 'pg';
import { audienceOf, type EmailEvent } from '@/lib/email/events';
import { addDays, venueNow } from '@/lib/venue-time';
import { renderEmail } from '../send';
import type { BookingEmailData } from './load';
import { buildBookingEmail, loadEmailStrings, resolveEmailLocale, sharedInbox } from './render';

/*
 * "Gửi email thử" (spec §10.4, R9) and, from phase 7, /admin/content/emails
 * "xem trước với dữ liệu mẫu": a made-up booking, so no guest's data is ever
 * sent to the address an Admin types. Nothing here is written to the
 * database, and the staff link points at /admin/reservations/0, which
 * answers "not found".
 */
export function sampleBooking(now: Date = new Date()): BookingEmailData {
  return {
    reservationId: '0',
    reference: 'FC-0000TEST',
    restaurantName: 'Tàya House',
    date: addDays(venueNow(now).date, 3),
    time: '19:00',
    guests: 4,
    status: 'requested',
    statusReason: 'Nhà hàng có tiệc riêng tối hôm đó. / The restaurant is booked for a private event that evening.',
    guestName: 'Nguyễn Thị Mẫu',
    phone: '0905 000 000',
    email: 'khach.mau@example.com',
    note: 'Bàn gần cửa sổ, có một ghế trẻ em.',
    groupPhone: { display: '+84 236 651 9999', tel: '+842366519999' },
    anonymized: false,
  };
}

export const TEST_SUBJECT_PREFIX = '[Email thử] ';

/**
 * The sample booking's `event` email in `locale`, as a recipient with that
 * language would get it (the staff rule: shown even while the language is
 * off on the site), its subject marked as a test, its Reply-To as R11 sets it.
 */
export async function renderSampleEmail(
  pool: Pool,
  event: EmailEvent,
  locale: string,
  options: { adminOrigin: string; now?: Date },
): Promise<{ subject: string; html: string; text: string; replyTo?: string; locale: string }> {
  const sample = sampleBooking(options.now);
  const resolved = await resolveEmailLocale(pool, locale, 'staff', event);
  const strings = await loadEmailStrings(pool, event, resolved.code);
  const built = buildBookingEmail(event, sample, strings, resolved, { adminOrigin: options.adminOrigin });
  const { html, text } = await renderEmail(built.element);
  const replyTo = audienceOf(event) === 'staff' ? (sample.email ?? undefined) : ((await sharedInbox(pool)) ?? undefined);
  return { subject: `${TEST_SUBJECT_PREFIX}${built.subject}`, html, text, replyTo, locale: resolved.code };
}
```

Create `lib/server/email/test-email.ts` (`appOrigin()` trong `try`: thiếu `BETTER_AUTH_URL` cũng thành `email_failed` có gợi ý):

```ts
import 'server-only';
import type { Pool } from 'pg';
import type { EmailEvent } from '@/lib/email/events';
import { appOrigin } from './auth-emails';
import { renderSampleEmail } from './booking/sample';
import { sendEmail as defaultSend } from './send';
import { describeEmailError, emailErrorCode, type EmailDeliveryMode, type SendEmailInput, type SendEmailResult } from './types';

/*
 * "Gửi email thử" (spec §10.4, R9): the sample booking's email, sent now
 * through the same gate and SMTP transport as the outbox, and awaited, so the
 * Admin learns at once whether this environment can send (SMTP reach, login,
 * DNS alignment, rendering). It does not go through email_outbox: a test has
 * no booking, must not be retried for a day, and must not count as a failed
 * booking email on the overview. Nothing is stored; the log line carries only
 * the error code.
 */

export type TestEmailResult =
  | { ok: true; data: { mode: EmailDeliveryMode; to: string } }
  | { ok: false; code: 'email_failed'; params: { error: string } };

export async function sendTestEmail(
  pool: Pool,
  input: { to: string; event: EmailEvent; locale: string },
  options: { adminOrigin?: string; send?: (input: SendEmailInput) => Promise<SendEmailResult>; env?: Record<string, string | undefined> } = {},
): Promise<TestEmailResult> {
  try {
    // Inside the try: a missing BETTER_AUTH_URL (R23) is reported like any other setup error.
    const adminOrigin = options.adminOrigin ?? appOrigin();
    const email = await renderSampleEmail(pool, input.event, input.locale, { adminOrigin });
    const result = await (options.send ?? defaultSend)({
      to: input.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      replyTo: email.replyTo,
      // A fresh Message-ID per click: two tests are two emails.
      idempotencyKey: `test:${Date.now().toString(36)}`,
    });
    // Redirect mode delivers to EMAIL_REDIRECT_TO; say so instead of claiming the typed address got it.
    const env = options.env ?? process.env;
    const to = result.mode === 'redirect' ? (env.EMAIL_REDIRECT_TO?.trim() ?? input.to) : input.to;
    return { ok: true, data: { mode: result.mode, to } };
  } catch (err) {
    const error = describeEmailError(err);
    console.error('[email] test send failed', { code: emailErrorCode(error) });
    return { ok: false, code: 'email_failed', params: { error } };
  }
}
```

Sửa `lib/server/action-result.ts`:

```diff
diff --git a/lib/server/action-result.ts b/lib/server/action-result.ts
index b253fe6..e24f12d 100644
--- a/lib/server/action-result.ts
+++ b/lib/server/action-result.ts
@@ -37,7 +37,10 @@ export type ActionCode =
   /** The time is not a slot of that day's services. */
   | 'slot_unavailable'
   /** Same restaurant, date, time and phone as an active booking (reservations_dedupe_v2_idx). */
-  | 'duplicate';
+  | 'duplicate'
+  // Email (spec §10.4).
+  /** "Gửi email thử" did not go out; params.error is describeEmailError's "<code>: <message>" (no address). */
+  | 'email_failed';
 
 export type ActionFailure = {
   ok: false;
```

Sửa `lib/admin/auth-errors.ts` (`emailFailureHint` đọc định dạng lỗi của Task 2):

```diff
diff --git a/lib/admin/auth-errors.ts b/lib/admin/auth-errors.ts
index d9bca70..df2eafa 100644
--- a/lib/admin/auth-errors.ts
+++ b/lib/admin/auth-errors.ts
@@ -60,6 +60,7 @@ const ACTION_MESSAGES: Record<ActionCode, string> = {
   closed: 'Nhà hàng đóng cửa vào bữa này trong ngày đã chọn.',
   slot_unavailable: 'Giờ này không nằm trong ca phục vụ của ngày đã chọn.',
   duplicate: 'Số điện thoại này đã có một đặt bàn đang hoạt động cùng nhà hàng, ngày và giờ.',
+  email_failed: 'Không gửi được email thử.',
 };
 
 /** `params` fills in the codes that carry details: who saved first and when, the covers left. */
@@ -70,9 +71,30 @@ export function actionErrorMessage(code: ActionCode, params?: Record<string, str
   if (code === 'full' && params?.left !== undefined) {
     return `Khung giờ này chỉ còn ${params.left} chỗ. Muốn vẫn nhận, hãy ghi lý do vượt sức chứa.`;
   }
+  if (code === 'email_failed' && params?.error) {
+    return `Không gửi được email thử. ${emailFailureHint(params.error)} (${params.error})`;
+  }
   return ACTION_MESSAGES[code];
 }
 
+/**
+ * What an Admin can do about a stored email error ("<code>: <message>",
+ * describeEmailError; no address in it): the setup errors name the variables
+ * to set, an SMTP refusal says whose side to check (R9).
+ */
+export function emailFailureHint(stored: string): string {
+  const code = stored.split(':')[0];
+  if (code === 'missing_smtp_config') return 'Chưa cấu hình SMTP (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD) trên môi trường này.';
+  if (code === 'missing_from') return 'Chưa đặt địa chỉ gửi (EMAIL_FROM).';
+  if (code === 'missing_redirect_to') return 'Chế độ redirect cần EMAIL_REDIRECT_TO.';
+  if (code === 'missing_app_url') return 'Chưa đặt BETTER_AUTH_URL (địa chỉ của trang quản trị) cho các liên kết trong email.';
+  if (code === 'not_delivered' || code === 'invalid_delivery_mode') return 'Môi trường này chưa bật gửi email (EMAIL_DELIVERY).';
+  if (code === 'rejected') return 'Máy chủ SMTP từ chối địa chỉ người nhận.';
+  if (/SMTP EAUTH/.test(stored)) return 'Máy chủ SMTP từ chối tài khoản đăng nhập: kiểm tra SMTP_USER và SMTP_PASSWORD.';
+  if (/SMTP (ECONNECTION|ETIMEDOUT|ESOCKET|EDNS|ETLS)/.test(stored)) return 'Không kết nối được máy chủ SMTP: kiểm tra SMTP_HOST, SMTP_PORT và SMTP_SECURE.';
+  return 'Kiểm tra cấu hình gửi email rồi thử lại.';
+}
+
 /*
  * true: this environment cannot send email at all until someone fixes its
  * setup, so "Gửi lại" alone will not help. not_delivered is log mode on a
```

Sửa `lib/admin/nav.ts`:

```diff
diff --git a/lib/admin/nav.ts b/lib/admin/nav.ts
index 7be2026..08dffd5 100644
--- a/lib/admin/nav.ts
+++ b/lib/admin/nav.ts
@@ -12,6 +12,7 @@ export const ADMIN_NAV: readonly NavItem[] = [
   { href: '/admin/reservations', label: 'Đặt bàn', permission: { reservations: ['read'] } },
   { href: '/admin/restaurants', label: 'Nhà hàng', permission: { schedule: ['read'] } },
   { href: '/admin/settings/booking', label: 'Cài đặt đặt bàn', permission: { settings: ['read'] } },
+  { href: '/admin/settings/notifications', label: 'Thông báo email', permission: { settings: ['read'] } },
   { href: '/admin/users', label: 'Nhân viên', permission: { user: ['list'] } },
   { href: '/admin/audit', label: 'Nhật ký', permission: { audit: ['read'] } },
 ];
```

Sửa `lib/admin/audit-labels.ts`:

```diff
diff --git a/lib/admin/audit-labels.ts b/lib/admin/audit-labels.ts
index e228e34..ab1e252 100644
--- a/lib/admin/audit-labels.ts
+++ b/lib/admin/audit-labels.ts
@@ -37,6 +37,9 @@ const ENTITIES: Record<string, string> = {
   restaurant_booking: 'Quy tắc đặt bàn',
   booking_settings: 'Cài đặt đặt bàn',
   closure: 'Ngày đóng cửa',
+  // Email settings (phase 5): a staff.new recipient, the shared inbox (site_settings.email).
+  notification_recipient: 'Người nhận thông báo',
+  site_settings: 'Cài đặt chung',
 };
 
 export function auditActionLabel(action: string): string {
```

- [ ] **Bước 7: Màn "Thông báo email"**

Create `app/admin/(shell)/settings/notifications/actions.ts` (mọi action `settings:update`; `refresh()` vì không có gì được cache: hàng đợi đọc người nhận sống):

```ts
'use server';

import { refresh } from 'next/cache';
import { getPool } from '@/db/client';
import { RecipientForm, RecipientTarget, SharedInboxForm, TestEmailForm } from '@/lib/admin/notification-schemas';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { auditActor, requirePermission } from '@/lib/server/dal/session';
import { createRecipient, deleteRecipient, saveSharedInbox, updateRecipient, type RecipientInput } from '@/lib/server/email/recipients';
import { sendTestEmail } from '@/lib/server/email/test-email';
import type { EmailDeliveryMode } from '@/lib/server/email/types';

/*
 * "Thông báo email" (spec §7.1: Admin only, settings:update; the CI guard
 * holds this whole file to a permission the Editor lacks). Recipients and the
 * shared inbox save in one transaction with their audit_log row (spec §7.4).
 * Nothing here is cached: the queue reads recipients live when it writes
 * staff.new, so there is no tag to expire; refresh() redraws this page.
 */

const DUPLICATE = { email: ['Địa chỉ này đã nhận thông báo cho cùng phạm vi.'] };

function recipientInput(formData: FormData): RecipientInput {
  const r = RecipientForm.parse({ ...Object.fromEntries(formData), events: formData.getAll('events') });
  return {
    scope: r.scope,
    destinationId: r.scope === 'destination' ? r.destinationId : null,
    restaurantId: r.scope === 'restaurant' ? r.restaurantId : null,
    email: r.email,
    events: r.events,
    locale: r.locale,
    active: r.active,
  };
}

export async function addRecipient(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const staff = await requirePermission({ settings: ['update'] });
    const result = await createRecipient(getPool(), auditActor(staff), recipientInput(formData));
    if (!result.ok) return { ok: false, code: 'invalid', fieldErrors: DUPLICATE };
    refresh();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function editRecipient(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ settings: ['update'] });
    const target = RecipientTarget.parse({ id: formData.get('id'), token: formData.get('token') });
    const result = await updateRecipient(getPool(), auditActor(staff), { ...recipientInput(formData), ...target });
    if (!result.ok) return result.code === 'duplicate' ? { ok: false, code: 'invalid', fieldErrors: DUPLICATE } : result;
    refresh();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function removeRecipient(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ settings: ['update'] });
    const target = RecipientTarget.parse({ id: formData.get('id'), token: formData.get('token') });
    const result = await deleteRecipient(getPool(), auditActor(staff), target);
    if (!result.ok) return result;
    refresh();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

export async function saveInbox(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const staff = await requirePermission({ settings: ['update'] });
    const input = SharedInboxForm.parse(Object.fromEntries(formData));
    const result = await saveSharedInbox(getPool(), auditActor(staff), input);
    if (!result.ok) return result;
    refresh();
    return result;
  } catch (err) {
    return actionError(err);
  }
}

/**
 * "Gửi email thử" (R9): the sample booking's email, sent and awaited, so the Admin sees at once
 * whether this environment can send. settings:update, not :read: it sends mail to any address typed.
 */
export async function sendTest(
  _prev: ActionResult<{ mode: EmailDeliveryMode; to: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ mode: EmailDeliveryMode; to: string }>> {
  try {
    await requirePermission({ settings: ['update'] });
    const input = TestEmailForm.parse(Object.fromEntries(formData));
    return await sendTestEmail(getPool(), input);
  } catch (err) {
    return actionError(err);
  }
}
```

Create `app/admin/(shell)/settings/notifications/RecipientForm.tsx` (như `ClosureEditor`, quy tắc code 9 của đợt 4: state của action ở trên, các ô remount theo token hoặc theo số lần thêm thành công; `method="post"` với `submitKeepingValues`; nút Xóa đặt confirm ở chính nó, vì form có action là hàm không được có `onSubmit`):

```tsx
'use client';

import { useActionState, useId, useState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import { STAFF_EMAIL_EVENTS } from '@/lib/email/events';
import type { ActionResult } from '@/lib/server/action-result';
import { FieldError, FormMessage } from '../../_ui/FormMessage';
import { addRecipient, editRecipient, removeRecipient } from './actions';

export type RecipientValues = {
  id: string;
  token: string;
  scope: 'all' | 'destination' | 'restaurant';
  destinationId: string | null;
  restaurantId: string | null;
  email: string;
  events: string[];
  locale: string;
  active: boolean;
};

export type RecipientOptions = {
  restaurants: { id: string; name: string }[];
  destinations: { id: string; name: string }[];
  locales: { code: string; name: string }[];
};

const STAFF_EVENT_LABELS: Record<(typeof STAFF_EMAIL_EVENTS)[number], string> = { 'staff.new': 'Đặt bàn online mới' };

/*
 * Add (values = null) or edit one recipient. Like ClosureEditor (code rule 9): the action's state
 * lives here and the fields remount on the row's token, or after each successful add, so they never
 * post a stale target beside a newer token, and the message survives the remount.
 */
export function RecipientEditor({ options, values }: { options: RecipientOptions; values: RecipientValues | null }) {
  const [state, action, pending] = useActionState<ActionResult<unknown> | null, FormData>(
    (prev, formData) => (values ? editRecipient(prev as ActionResult | null, formData) : addRecipient(prev as ActionResult<{ id: string }> | null, formData)),
    null,
  );
  const [added, setAdded] = useState(0);
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok && !values) setAdded((n) => n + 1);
  }
  const uid = useId();
  return (
    <RecipientFields
      key={values ? `token-${values.token}` : `added-${added}`}
      uid={uid}
      options={options}
      values={values}
      state={state}
      action={action}
      pending={pending}
    />
  );
}

function RecipientFields({
  uid,
  options,
  values,
  state,
  action,
  pending,
}: {
  uid: string;
  options: RecipientOptions;
  values: RecipientValues | null;
  state: ActionResult<unknown> | null;
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  const [scope, setScope] = useState(values?.scope ?? 'restaurant');
  const id = (name: string) => `${uid}-${name}`;
  return (
    <form method="post" className="a-grid-form" onSubmit={submitKeepingValues(action)} noValidate aria-label={values ? `Sửa người nhận ${values.email}` : 'Thêm người nhận'}>
      {values ? (
        <>
          <input type="hidden" name="id" value={values.id} />
          <input type="hidden" name="token" value={values.token} />
        </>
      ) : null}
      <FormMessage state={state} success={values ? 'Đã lưu.' : 'Đã thêm người nhận.'} />
      <div className="a-field">
        <label htmlFor={id('email')}>Email người nhận</label>
        <input id={id('email')} name="email" type="email" autoComplete="off" maxLength={254} defaultValue={values?.email} aria-describedby={id('email-error')} />
        <FieldError state={state} name="email" id={id('email-error')} />
      </div>
      <div className="a-field">
        <label htmlFor={id('scope')}>Nhận thông báo của</label>
        <select id={id('scope')} name="scope" value={scope} onChange={(e) => setScope(e.currentTarget.value as RecipientValues['scope'])}>
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
        <label htmlFor={id('locale')}>Ngôn ngữ của email</label>
        <select id={id('locale')} name="locale" defaultValue={values?.locale ?? 'vi'}>
          {options.locales.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="a-field a-field--wide">
        <legend>Loại thông báo</legend>
        {STAFF_EMAIL_EVENTS.map((event) => (
          <label className="a-check" key={event}>
            <input type="checkbox" name="events" value={event} defaultChecked={values ? values.events.includes(event) : true} />
            {STAFF_EVENT_LABELS[event]}
          </label>
        ))}
        <FieldError state={state} name="events" id={id('events-error')} />
      </fieldset>
      <label className="a-check a-field--wide">
        <input type="checkbox" name="active" defaultChecked={values?.active ?? true} />
        Đang nhận thông báo
      </label>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang lưu…' : values ? 'Lưu' : 'Thêm người nhận'}
      </button>
    </form>
  );
}

export function DeleteRecipient({ values }: { values: RecipientValues }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(removeRecipient, null);
  // The confirm sits on the button, as in DeleteClosure: a form with a function action takes no onSubmit.
  return (
    <form className="a-inline" action={action}>
      <input type="hidden" name="id" value={values.id} />
      <input type="hidden" name="token" value={values.token} />
      <button
        className="a-btn a-btn--ghost a-btn--small"
        type="submit"
        disabled={pending}
        aria-label={`Xóa người nhận ${values.email}`}
        onClick={(e) => {
          if (!window.confirm(`Xóa ${values.email} khỏi danh sách nhận thông báo?`)) e.preventDefault();
        }}
      >
        Xóa
      </button>
      <FormMessage state={state && !state.ok ? state : null} />
    </form>
  );
}
```

Create `app/admin/(shell)/settings/notifications/SharedInboxForm.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import { FieldError, FormMessage } from '../../_ui/FormMessage';
import { saveInbox } from './actions';

/* site_settings.email: where staff.new goes when nobody else matches, and where a guest's reply lands. */
export function SharedInboxForm({ email, token }: { email: string; token: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveInbox, null);
  return (
    <form method="post" className="a-grid-form" onSubmit={submitKeepingValues(action)} key={token} noValidate aria-label="Hộp thư chung">
      <input type="hidden" name="token" value={token} />
      <FormMessage state={state} success="Đã lưu." />
      <div className="a-field">
        <label htmlFor="notify-inbox-email">Email hộp thư chung</label>
        <input id="notify-inbox-email" name="email" type="email" autoComplete="off" maxLength={254} defaultValue={email} aria-describedby="notify-inbox-email-error" />
        <FieldError state={state} name="email" id="notify-inbox-email-error" />
      </div>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang lưu…' : 'Lưu hộp thư chung'}
      </button>
    </form>
  );
}
```

Create `app/admin/(shell)/settings/notifications/TestEmailForm.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import { EMAIL_EVENTS, EMAIL_EVENT_LABELS } from '@/lib/email/events';
import type { ActionResult } from '@/lib/server/action-result';
import type { EmailDeliveryMode } from '@/lib/server/email/types';
import { FieldError, FormMessage } from '../../_ui/FormMessage';
import { sendTest } from './actions';

const SENT: Record<EmailDeliveryMode, (to: string) => string> = {
  live: (to) => `Đã gửi email thử tới ${to}. Kiểm tra hộp thư (và thư rác).`,
  redirect: (to) => `Đã gửi email thử, chuyển hướng tới hộp thư thử nghiệm ${to} (môi trường này không gửi tới địa chỉ thật).`,
  log: () => 'Môi trường này chỉ ghi log: email thử đã được ghi vào log máy chủ, không gửi đi.',
};

/* "Gửi email thử" (spec §10.4): the sample booking's email in the chosen language, through the same gate as real emails. */
export function TestEmailForm({ defaultTo, locales }: { defaultTo: string; locales: { code: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ActionResult<{ mode: EmailDeliveryMode; to: string }> | null, FormData>(sendTest, null);
  return (
    <form method="post" className="a-grid-form" onSubmit={submitKeepingValues(action)} noValidate aria-label="Gửi email thử">
      {state?.ok ? (
        <p className="a-notice a-field--wide" role="status">
          {SENT[state.data.mode](state.data.to)}
        </p>
      ) : (
        <FormMessage state={state} />
      )}
      <div className="a-field">
        <label htmlFor="notify-test-to">Gửi tới</label>
        <input id="notify-test-to" name="to" type="email" autoComplete="off" maxLength={254} defaultValue={defaultTo} aria-describedby="notify-test-to-error" />
        <FieldError state={state} name="to" id="notify-test-to-error" />
      </div>
      <div className="a-field">
        <label htmlFor="notify-test-event">Mẫu email</label>
        <select id="notify-test-event" name="event" defaultValue="staff.new">
          {EMAIL_EVENTS.map((e) => (
            <option key={e} value={e}>
              {EMAIL_EVENT_LABELS[e]}
            </option>
          ))}
        </select>
      </div>
      <div className="a-field">
        <label htmlFor="notify-test-locale">Ngôn ngữ</label>
        <select id="notify-test-locale" name="locale" defaultValue="vi">
          {locales.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang gửi…' : 'Gửi email thử'}
      </button>
    </form>
  );
}
```

Create `app/admin/(shell)/settings/notifications/page.tsx` (gọi `requirePagePermission` trước mọi truy vấn; câu chế độ gửi, không cài đặt nào phía sau nó):

```tsx
import type { Metadata } from 'next';
import { getPool } from '@/db/client';
import { DESTS, type DestKey } from '@/lib/data';
import { listLocales, listRestaurantOptions } from '@/lib/server/booking/queries';
import { requirePagePermission } from '@/lib/server/dal/session';
import { deliveryModeNotice } from '@/lib/server/email/mode';
import { getSharedInbox, listRecipients, restaurantsWithoutRecipient } from '@/lib/server/email/recipients';
import { DeleteRecipient, RecipientEditor, type RecipientOptions, type RecipientValues } from './RecipientForm';
import { SharedInboxForm } from './SharedInboxForm';
import { TestEmailForm } from './TestEmailForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Thông báo email' };

const SCOPE_LABELS = { all: 'Tất cả nhà hàng', destination: 'Điểm đến', restaurant: 'Nhà hàng' } as const;

/*
 * Spec §7.2 /admin/settings/notifications (Admin only, §7.1): who receives
 * "đặt bàn mới" (notification_recipients), the shared inbox that receives it
 * when nobody does (site_settings.email), the restaurants in that case (R21),
 * and "Gửi email thử" (R9).
 */
export default async function NotificationsPage() {
  // Before any query: an Editor gets the 403 view.
  const staff = await requirePagePermission({ settings: ['read'] });
  const pool = getPool();
  const [recipients, inbox, uncovered, restaurants, locales] = await Promise.all([
    listRecipients(pool),
    getSharedInbox(pool),
    restaurantsWithoutRecipient(pool),
    listRestaurantOptions(pool),
    listLocales(pool),
  ]);
  const options: RecipientOptions = {
    restaurants,
    destinations: Object.entries(DESTS).map(([id, name]) => ({ id, name })),
    locales: locales.map((l) => ({ code: l.code, name: l.name })),
  };

  return (
    <>
      <h1>Thông báo email</h1>
      <p className="a-lede">Ai nhận email khi khách đặt bàn online, và thử gửi email từ môi trường này.</p>
      <p className="a-muted" data-testid="delivery-mode">
        {deliveryModeNotice()}
      </p>

      <section aria-labelledby="notify-recipients-title">
        <h2 id="notify-recipients-title">Người nhận “đặt bàn mới”</h2>
        <p className="a-muted">
          Mỗi đặt bàn online gửi tới mọi người nhận khớp với nhà hàng đó (tất cả nhà hàng, điểm đến của nhà hàng, hoặc chính nhà hàng),
          mỗi địa chỉ một email.
        </p>
        {recipients.length === 0 ? <p className="a-lede">Chưa có người nhận nào.</p> : null}
        {recipients.map((r) => {
          const where =
            r.scope === 'all'
              ? SCOPE_LABELS.all
              : r.scope === 'destination'
                ? `${SCOPE_LABELS.destination}: ${DESTS[r.destinationId as DestKey] ?? r.destinationId}`
                : `${SCOPE_LABELS.restaurant}: ${r.restaurantName ?? r.restaurantId}`;
          const values: RecipientValues = {
            id: r.id,
            token: r.token,
            scope: r.scope,
            destinationId: r.destinationId,
            restaurantId: r.restaurantId,
            email: r.email,
            events: r.events,
            locale: r.locale,
            active: r.active,
          };
          return (
            <section className="a-card-row" key={r.id} aria-label={`${r.email} · ${where}`}>
              <h3>
                {r.email}
                {r.active ? null : <span className="a-tag">Đang tắt</span>}
              </h3>
              <p>{`${where} · ${r.locale}`}</p>
              <details>
                <summary>Sửa</summary>
                <RecipientEditor options={options} values={values} />
              </details>
              <DeleteRecipient values={values} />
            </section>
          );
        })}
        <h3>Thêm người nhận</h3>
        <RecipientEditor options={options} values={null} />
      </section>

      <section aria-labelledby="notify-inbox-title">
        <h2 id="notify-inbox-title">Hộp thư chung</h2>
        <p className="a-muted">
          Nhận email “đặt bàn mới” của những nhà hàng chưa có người nhận, và là địa chỉ khách trả lời khi họ bấm Reply. Từ đợt 6 đây cũng là email
          chung hiện ở chân trang web.
        </p>
        <SharedInboxForm email={inbox.email} token={inbox.token} />
      </section>

      <section aria-labelledby="notify-uncovered-title">
        <h2 id="notify-uncovered-title">Nhà hàng chưa có người nhận</h2>
        {uncovered.length === 0 ? (
          <p className="a-muted">Nhà hàng nào nhận đặt bàn online cũng có người nhận thông báo.</p>
        ) : (
          <>
            <p className="a-warn" role="note">{`Email “đặt bàn mới” của các nhà hàng này đang về hộp thư chung (${inbox.email}).`}</p>
            <ul className="a-list" aria-label="Nhà hàng chưa có người nhận">
              {uncovered.map((r) => (
                <li className="a-list-item" key={r.id}>
                  {r.name}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="notify-test-title">
        <h2 id="notify-test-title">Gửi email thử</h2>
        <p className="a-muted">Gửi một mẫu email với đặt bàn giả (không dùng dữ liệu khách), qua đúng đường gửi của email thật.</p>
        <TestEmailForm defaultTo={staff.email} locales={options.locales} />
      </section>
    </>
  );
}
```

- [ ] **Bước 8: Chạy lại test, rồi kiểm guard**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/admin/notification-schemas.test.ts lib/server/email/mode.test.ts test/integration/email-screens.test.ts lib/admin/nav.test.ts lib/admin/audit-labels.test.ts lib/admin/auth-errors.test.ts test/guards/require-permission.guard.test.ts`
Expected: PASS `Test Files  7 passed (7)`, `Tests  82 passed (82)`

Đột biến: trong `sendTest` đổi `requirePermission({ settings: ['update'] })` thành `requirePermission({ reservations: ['update'] })`, chạy `npx vitest run test/guards/require-permission.guard.test.ts`. Expected: `Tests  2 failed | 22 passed (24)`:

```
     × every staff-screen action asks for a permission the Editor lacks 5ms
     × app/admin/(shell)/settings/notifications/actions.ts 1ms
AssertionError: expected [ Array(1) ] to deeply equal []
AssertionError: sendTest: expected { reservations: [ 'update' ] } to deeply equal { settings: [ 'update' ] }
```

Trả dòng đó về như cũ.

- [ ] **Bước 9: Chạy cổng kiểm tra**

Expected:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo;
- `Test Files  62 passed (62)`, `Tests  743 passed (743)`;
- `Applied 7 migration(s).`; build thoát 0; check-prerender báo thêm `/admin/settings/notifications` trong "Admin check passed: … have no static shell.";
- E2E `124 passed`; visual `8 passed`.

- [ ] **Bước 10: Commit**

```bash
git add "app/admin/(shell)/settings/notifications/RecipientForm.tsx" "app/admin/(shell)/settings/notifications/SharedInboxForm.tsx" "app/admin/(shell)/settings/notifications/TestEmailForm.tsx" "app/admin/(shell)/settings/notifications/actions.ts" "app/admin/(shell)/settings/notifications/page.tsx" e2e/admin-emails.spec.ts lib/admin/audit-labels.test.ts lib/admin/audit-labels.ts lib/admin/auth-errors.test.ts lib/admin/auth-errors.ts lib/admin/nav.test.ts lib/admin/nav.ts lib/admin/notification-schemas.test.ts lib/admin/notification-schemas.ts lib/server/action-result.ts lib/server/booking/config.ts lib/server/email/booking/sample.ts lib/server/email/mode.test.ts lib/server/email/mode.ts lib/server/email/recipients.ts lib/server/email/test-email.ts test/guards/require-permission.guard.test.ts test/integration/email-screens.test.ts
git commit -m "$(cat <<'EOF'
feat: let the Admin choose who hears about new bookings, set the shared inbox, and send a test email

/admin/settings/notifications (Admin only, spec §7.1, §7.2): the recipients
of staff.new, each for one restaurant, one destination or all, with its
language and an on/off switch, one row per address and target whatever its
case; the shared inbox (site_settings.email) that gets staff.new when nobody
does and the guests' replies; the restaurants that fall back to it, read
with the same predicate the queue uses; and "Gửi email thử". Every save is
one transaction with its audit_log row and a concurrency token, and the menu
gains "Thông báo email".

"Gửi email thử" (R9) renders a made-up booking's email (FC-0000TEST, no guest
data) in the template and language chosen and sends it now through the same
gate and SMTP transport, awaited, storing nothing: the Admin sees the mode
it went out in, or a Vietnamese hint naming what to fix (SMTP settings,
login, connection, a refused address, EMAIL_FROM, BETTER_AUTH_URL). The
screen states the delivery mode, never a setting behind it. The CI guard
holds every action of the screen to settings:update.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Nhật ký email, "Gửi lại", email của từng đặt bàn, số đếm ở Tổng quan

`/admin/reservations/emails` (Editor và Admin, spec §7.2): email đặt bàn của env này, mới nhất trước, keyset 50 dòng, tab theo trạng thái, địa chỉ khách che (R12), URL chỉ có `tab` và `sau`. "Gửi lại" (C9, R2, R20) quyết định trên hàng đã khóa, ghi một hàng `audit_log`, rồi gửi sau phản hồi. Trang đặt bàn liệt kê email của nó cạnh dòng thời gian. Tổng quan có "N email lỗi" cho ai đọc đặt bàn và "Nhà hàng chưa có người nhận thông báo" cho Admin (R21).

**Files:**
- Create: `lib/server/email/outbox-log.ts`, `app/admin/(shell)/reservations/emails/page.tsx`, `app/admin/(shell)/reservations/emails/actions.ts`, `app/admin/(shell)/reservations/_ui/ResendEmail.tsx`, `app/admin/(shell)/reservations/_ui/EmailStatusBadge.tsx`
- Modify: `app/admin/(shell)/reservations/_ui/SectionNav.tsx`, `app/admin/(shell)/reservations/[id]/page.tsx`, `app/admin/(shell)/page.tsx`, `styles/admin.css`, `lib/server/action-result.ts`, `lib/admin/auth-errors.ts`, `lib/admin/auth-errors.test.ts`, `lib/admin/audit-labels.ts`, `lib/admin/audit-labels.test.ts`, `lib/admin/notification-schemas.ts`, `test/guards/require-permission.guard.test.ts`, `test/integration/email-screens.test.ts`, `e2e/admin-emails.spec.ts`

**Interfaces:**
- Consumes: `drainAfterCommit`, `MAX_ATTEMPTS`, `RETRY_DELAYS_MINUTES` (Task 4); `outboxEnv`, `OutboxEnv` (Task 3); `restaurantsWithoutRecipient` (Task 6); `deliveryModeNotice` (Task 6); `EMAIL_EVENT_LABELS`, `EMAIL_STATUS_LABELS`, `maskEmail`, `EmailStatus` (Task 1); `redactEmails` (Task 2); `insertAudit`, `withTransaction`, `auditActor` (đợt 3); `formatDateTimeVi`, `SectionNav` (đợt 4).
- Produces:
  - `lib/server/email/outbox-log.ts`: `EMAIL_LOG_PAGE_SIZE = 50`, `EMAIL_LOG_TABS = ['all','failed','queued','sent','skipped']`, `type EmailLogTab`, `type EmailLogRow`; `listEmailLog(db, { env, tab, after? }): Promise<{ rows; next: string | null }>`; `listReservationEmails(db, reservationId, env)`; `emailOverview(db, env): Promise<{ failed: number; unrouted: { id; name }[] }>` (C11); `resendable(status): boolean`; `type RequeueResult`; `requeueEmail(pool, actor, { id, env })`.
  - `ActionCode` thêm `'not_resendable'`; `RequeueForm` (zod) trong `lib/admin/notification-schemas.ts`; thực thể audit `email_outbox` "Email".

- [ ] **Bước 1: Viết test**

Nhật ký (chỉ env của mình, mới nhất trước, keyset, tab "Đang chờ" gồm hàng `sending`, con trỏ rác bị bỏ qua), Tổng quan (đếm lỗi theo env; danh sách nhà hàng là của Task 6), "Gửi lại" (hàng `failed` về 0 lần, hàng đang chờ đến hạn ngay, mỗi lần một hàng audit không địa chỉ, không đụng `reservation_events`; từ chối `sent`, `skipped`, `sending` và env khác; và cuộc đua: một lần giữ hàng chưa commit thắng, "Gửi lại" bị từ chối). Sửa `test/integration/email-screens.test.ts`:

```diff
diff --git a/test/integration/email-screens.test.ts b/test/integration/email-screens.test.ts
index 501f1e4..154311f 100644
--- a/test/integration/email-screens.test.ts
+++ b/test/integration/email-screens.test.ts
@@ -3,7 +3,9 @@ import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vites
 import type { EmailEvent } from '@/lib/email/events';
 import { loadBookingEmailData } from '@/lib/server/email/booking/load';
 import { renderOutboxEmail } from '@/lib/server/email/booking/render';
+import { MAX_ATTEMPTS } from '@/lib/server/email/drain';
 import { queueStaffNew } from '@/lib/server/email/outbox';
+import { EMAIL_LOG_PAGE_SIZE, emailOverview, listEmailLog, listReservationEmails, requeueEmail } from '@/lib/server/email/outbox-log';
 import {
   createRecipient,
   deleteRecipient,
@@ -77,6 +79,40 @@ async function seedReservation(over: { status?: string; email?: string | null; l
   return rows[0].id;
 }
 
+/** An outbox row about booking `reservationId`, as a sender would have left it. */
+async function queue(
+  reservationId: string,
+  over: { event?: string; to?: string; env?: string; status?: string; attempts?: number; locale?: string; lockedFor?: string; createdAt?: string } = {},
+) {
+  const event = over.event ?? 'guest.confirmed';
+  const { rows } = await pool.query<{ id: string }>(
+    `INSERT INTO email_outbox (env, event, audience, reservation_id, to_email, locale, status, attempts, locked_until, sent_at, created_at)
+     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + $9::interval, CASE WHEN $7 = 'sent' THEN now() END, coalesce($10::timestamptz, now()))
+     RETURNING id::text`,
+    [
+      over.env ?? 'development',
+      event,
+      event.startsWith('staff.') ? 'staff' : 'guest',
+      reservationId,
+      over.to ?? 'anh.nguyen@guest.vn',
+      over.locale ?? 'en',
+      over.status ?? 'queued',
+      over.attempts ?? 0,
+      over.lockedFor ?? null,
+      over.createdAt ?? null,
+    ],
+  );
+  return rows[0].id;
+}
+
+const outbox = async (id: string) =>
+  (
+    await pool.query<{ status: string; attempts: number; locked_until: Date | null; next_in_minutes: number }>(
+      `SELECT status, attempts, locked_until, round(extract(epoch FROM next_attempt_at - now()) / 60)::int AS next_in_minutes FROM email_outbox WHERE id = $1`,
+      [id],
+    )
+  ).rows[0];
+
 /** What the drain renders for an outbox row of `event` in `locale` about booking `id`. */
 async function render(event: EmailEvent, id: string, locale: string) {
   const data = await loadBookingEmailData(pool, id);
@@ -293,4 +329,94 @@ describe.skipIf(!TEST_DATABASE_URL)('email screens and templates (database)', ()
       errors.mockRestore();
     });
   });
+
+  describe('the email log', () => {
+    it('lists this env only, newest first, by status, 50 a page with a keyset cursor', async () => {
+      const id = await seedReservation();
+      const mine: string[] = [];
+      for (let i = 0; i < EMAIL_LOG_PAGE_SIZE + 2; i += 1) {
+        mine.push(await queue(id, { createdAt: `2026-10-01T00:${String(i).padStart(2, '0')}:00Z`, status: i % 2 ? 'failed' : 'sent' }));
+      }
+      await queue(id, { env: 'production', status: 'failed' });
+      const held = await queue(id, { status: 'sending', lockedFor: '1 minute' });
+      const first = await listEmailLog(pool, { env: 'development', tab: 'all' });
+      expect(first.rows).toHaveLength(EMAIL_LOG_PAGE_SIZE);
+      expect(first.rows[0].id).toBe(held);
+      const second = await listEmailLog(pool, { env: 'development', tab: 'all', after: first.next });
+      expect(second.rows.map((r) => r.id)).toEqual([mine[2], mine[1], mine[0]]);
+      expect(second.next).toBeNull();
+      expect((await listEmailLog(pool, { env: 'development', tab: 'failed' })).rows.every((r) => r.status === 'failed')).toBe(true);
+      // "Đang chờ" shows the rows a sender holds too.
+      expect((await listEmailLog(pool, { env: 'development', tab: 'queued' })).rows.map((r) => [r.id, r.status])).toEqual([[held, 'sending']]);
+      // A cursor that is not one is ignored, not an error.
+      expect((await listEmailLog(pool, { env: 'development', tab: 'all', after: "1'; DROP TABLE x" })).rows).toHaveLength(EMAIL_LOG_PAGE_SIZE);
+      expect((await listReservationEmails(pool, id, 'production')).map((r) => r.status)).toEqual(['failed']);
+      expect(first.rows[1]).toMatchObject({ reservationId: id, restaurantName: 'Tàya House', event: 'guest.confirmed', audience: 'guest', toEmail: 'anh.nguyen@guest.vn' });
+    });
+
+    it('the overview counts this env’s failed emails and names the restaurants that fall back to the shared inbox (R21)', async () => {
+      const id = await seedReservation();
+      await queue(id, { status: 'failed' });
+      await queue(id, { status: 'failed', env: 'production' });
+      await queue(id, { status: 'sent' });
+      const overview = await emailOverview(pool, 'development');
+      expect(overview.failed).toBe(1);
+      expect(overview.unrouted).toEqual(await restaurantsWithoutRecipient(pool));
+      expect(overview.unrouted.map((r) => r.id)).toContain('taya-house');
+      expect((await emailOverview(pool, 'production')).failed).toBe(1);
+      await createRecipient(pool, ADMIN, recipient({ scope: 'all', email: 'gm@furama.test' }));
+      expect(await emailOverview(pool, 'development')).toEqual({ failed: 1, unrouted: [] });
+    });
+  });
+
+  describe('"Gửi lại" (C9, R2)', () => {
+    it('puts a failed email back in the queue with fresh attempts, due now; a waiting one is just due now; each writes one audit row', async () => {
+      const id = await seedReservation({ status: 'confirmed' });
+      const failed = await queue(id, { status: 'failed', attempts: MAX_ATTEMPTS });
+      expect(await requeueEmail(pool, ADMIN, { id: failed, env: 'development' })).toEqual({ ok: true, data: { id: failed, reservationId: id } });
+      expect(await outbox(failed)).toMatchObject({ status: 'queued', attempts: 0, locked_until: null, next_in_minutes: 0 });
+      const waiting = await queue(id, { attempts: 2 });
+      await pool.query(`UPDATE email_outbox SET next_attempt_at = now() + interval '15 minutes' WHERE id = $1`, [waiting]);
+      expect((await requeueEmail(pool, ADMIN, { id: waiting, env: 'development' })).ok).toBe(true);
+      expect(await outbox(waiting)).toMatchObject({ status: 'queued', attempts: 2, next_in_minutes: 0 });
+      // The booking's timeline is untouched (R2); audit_log has the who and the what, no address.
+      expect((await pool.query('SELECT count(*)::int AS n FROM reservation_events')).rows[0].n).toBe(0);
+      const audit = (await pool.query(`SELECT actor_id, action, entity_type, entity_id, before, after FROM audit_log ORDER BY id`)).rows;
+      expect(audit).toEqual([
+        { actor_id: 'admin-1', action: 'update', entity_type: 'email_outbox', entity_id: failed, before: { status: 'failed', attempts: 7 }, after: { status: 'queued' } },
+        { actor_id: 'admin-1', action: 'update', entity_type: 'email_outbox', entity_id: waiting, before: { status: 'queued', attempts: 2 }, after: { status: 'queued' } },
+      ]);
+      expect(JSON.stringify(audit)).not.toContain('@guest.vn');
+    });
+
+    it('refuses a sent or skipped email, one a sender holds, and another env’s row', async () => {
+      const id = await seedReservation({ status: 'confirmed' });
+      const sent = await queue(id, { status: 'sent' });
+      const skipped = await queue(id, { status: 'skipped' });
+      const held = await queue(id, { status: 'sending', lockedFor: '1 minute' });
+      const prod = await queue(id, { status: 'failed', env: 'production' });
+      for (const target of [sent, skipped, held]) expect(await requeueEmail(pool, ADMIN, { id: target, env: 'development' })).toEqual({ ok: false, code: 'not_allowed' });
+      expect(await requeueEmail(pool, ADMIN, { id: prod, env: 'development' })).toEqual({ ok: false, code: 'not_found' });
+      expect(await outbox(held)).toMatchObject({ status: 'sending', locked_until: expect.any(Date) });
+      expect((await pool.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n).toBe(0);
+    });
+
+    it('decides on the row as it is once locked: a claim that lands first wins, and the requeue is refused', async () => {
+      const id = await seedReservation({ status: 'confirmed' });
+      const row = await queue(id, { status: 'failed', attempts: MAX_ATTEMPTS });
+      const sender = await pool.connect();
+      try {
+        // A sender's claim, not yet committed, holds the row.
+        await sender.query('BEGIN');
+        await sender.query(`UPDATE email_outbox SET status = 'sending', attempts = 1, locked_until = now() + interval '2 minutes' WHERE id = $1`, [row]);
+        const requeue = requeueEmail(pool, ADMIN, { id: row, env: 'development' });
+        await new Promise((done) => setTimeout(done, 200));
+        await sender.query('COMMIT');
+        expect(await requeue).toEqual({ ok: false, code: 'not_allowed' });
+      } finally {
+        sender.release();
+      }
+      expect(await outbox(row)).toMatchObject({ status: 'sending', attempts: 1 });
+    });
+  });
 });
```

Sửa `lib/admin/audit-labels.test.ts`:

```diff
diff --git a/lib/admin/audit-labels.test.ts b/lib/admin/audit-labels.test.ts
index c8a3e06..c9f66e6 100644
--- a/lib/admin/audit-labels.test.ts
+++ b/lib/admin/audit-labels.test.ts
@@ -53,11 +53,11 @@ describe('audit labels', () => {
     ]);
   });
 
-  it('names every entity the email settings write to audit_log', () => {
-    const source = readFileSync('lib/server/email/recipients.ts', 'utf8');
+  it('names every entity the email screens write to audit_log', () => {
+    const source = ['lib/server/email/recipients.ts', 'lib/server/email/outbox-log.ts'].map((f) => readFileSync(f, 'utf8')).join('\n');
     const entities = [...new Set([...source.matchAll(/entityType: '([a-z_]+)'/g)].map((m) => m[1]))].sort();
-    expect(entities).toEqual(['notification_recipient', 'site_settings']);
-    expect(entities.map(auditEntityLabel)).toEqual(['Người nhận thông báo', 'Cài đặt chung']);
+    expect(entities).toEqual(['email_outbox', 'notification_recipient', 'site_settings']);
+    expect(entities.map(auditEntityLabel)).toEqual(['Email', 'Người nhận thông báo', 'Cài đặt chung']);
   });
 
   it('names every configuration entity the booking screens write to audit_log', () => {
```

Sửa `lib/admin/auth-errors.test.ts`:

```diff
diff --git a/lib/admin/auth-errors.test.ts b/lib/admin/auth-errors.test.ts
index 08c99b7..c5d2c13 100644
--- a/lib/admin/auth-errors.test.ts
+++ b/lib/admin/auth-errors.test.ts
@@ -85,6 +85,7 @@ describe('"Gửi email thử" failures (R9)', () => {
       `Không gửi được email thử. Máy chủ SMTP từ chối tài khoản đăng nhập: kiểm tra SMTP_USER và SMTP_PASSWORD. (${stored})`,
     );
     expect(actionErrorMessage('email_failed')).toBe('Không gửi được email thử.');
+    expect(actionErrorMessage('not_resendable')).toBe('Email này đã gửi, đã bỏ qua hoặc đang được gửi, nên không gửi lại được. Hãy tải lại trang.');
   });
 });
 
```

Sửa `test/guards/require-permission.guard.test.ts` (`resendEmail` là action đặt bàn của cả hai vai trò):

```diff
diff --git a/test/guards/require-permission.guard.test.ts b/test/guards/require-permission.guard.test.ts
index 3750825..34c7a84 100644
--- a/test/guards/require-permission.guard.test.ts
+++ b/test/guards/require-permission.guard.test.ts
@@ -77,7 +77,11 @@ const BOOKING_ACTIONS: Record<string, Record<string, { permission: object; edito
   'app/admin/(shell)/settings/booking/actions.ts': {
     saveSettings: { permission: { settings: ['update'] }, editor: false },
   },
-  // Phase 5: "Cài đặt … thông báo" is Admin only (spec §7.1); "Gửi email thử" sends to any address typed.
+  // Phase 5: "Gửi lại" is a booking action for both roles; "Cài đặt … thông báo" is Admin only (spec §7.1),
+  // and "Gửi email thử" sends to any address typed.
+  'app/admin/(shell)/reservations/emails/actions.ts': {
+    resendEmail: { permission: { reservations: ['update'] }, editor: true },
+  },
   'app/admin/(shell)/settings/notifications/actions.ts': {
     addRecipient: { permission: { settings: ['update'] }, editor: false },
     editRecipient: { permission: { settings: ['update'] }, editor: false },
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/email-screens.test.ts lib/admin/audit-labels.test.ts lib/admin/auth-errors.test.ts test/guards/require-permission.guard.test.ts`
Expected: FAIL `Test Files  4 failed (4)`, `Tests  3 failed | 64 passed (67)`:

```
 ❯ test/integration/email-screens.test.ts (0 test)
 ❯ test/guards/require-permission.guard.test.ts (25 tests | 1 failed) 59ms
     × app/admin/(shell)/reservations/emails/actions.ts 4ms
 ❯ lib/admin/auth-errors.test.ts (36 tests | 1 failed) 7ms
     × says what to fix for each kind of failure, and quotes the stored error 3ms
 ❯ lib/admin/audit-labels.test.ts (6 tests | 1 failed) 5ms
     × names every entity the email screens write to audit_log 2ms
 FAIL  test/integration/email-screens.test.ts [ test/integration/email-screens.test.ts ]
Error: Cannot find package '@/lib/server/email/outbox-log' imported from …/test/integration/email-screens.test.ts
 FAIL  … > booking actions follow the permission matrix (spec §7.1) > app/admin/(shell)/reservations/emails/actions.ts
Error: ENOENT: no such file or directory, open '…/app/admin/(shell)/reservations/emails/actions.ts'
 FAIL  lib/admin/audit-labels.test.ts > audit labels > names every entity the email screens write to audit_log
Error: ENOENT: no such file or directory, open 'lib/server/email/outbox-log.ts'
```

- [ ] **Bước 3: Viết E2E và chạy nó trên build hiện tại: phải đỏ**

Một email `guest.confirmed` gieo thẳng ở trạng thái `failed` sau 7 lần, trên một đặt bàn đã xác nhận ở Hải Vân Lounge +40 (bản đồ dữ liệu E2E). Sửa `e2e/admin-emails.spec.ts`:

```diff
diff --git a/e2e/admin-emails.spec.ts b/e2e/admin-emails.spec.ts
index 94c8844..3bf8658 100644
--- a/e2e/admin-emails.spec.ts
+++ b/e2e/admin-emails.spec.ts
@@ -2,15 +2,18 @@ import { randomBytes } from 'node:crypto';
 import type { Page } from '@playwright/test';
 import { expectHydrated, watchCsp } from './csp';
 import { emailsTo } from './email-log';
+import { seedReservation, venueDay } from './reservation-fixtures';
 import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';
 
 /*
- * Phase 5 email screens (spec §7.2): the Admin's "Thông báo email"
- * (recipients, the restaurants left to the shared inbox, "Gửi email thử").
- * The server runs EMAIL_DELIVERY=log, so a "sent" email is a line in
- * EMAIL_LOG_FILE. Data: recipients on Hura Izakaya under a fresh address,
- * removed afterwards. No spec running beside this one may add an 'all' or a
- * 'destination' recipient: booking-email expects the general inbox.
+ * Phase 5 email screens (spec §7.2): the email log with "Gửi lại", the
+ * booking's own emails, the overview's counts, and the Admin's "Thông báo
+ * email" (recipients, the restaurants left to the shared inbox, "Gửi email
+ * thử"). The server runs EMAIL_DELIVERY=log, so a "sent" email is a line in
+ * EMAIL_LOG_FILE. Data: Hải Vân Lounge +40 (no other spec books that far),
+ * recipients on Hura Izakaya under a fresh address, removed afterwards. No
+ * spec running beside this one may add an 'all' or a 'destination'
+ * recipient: booking-email expects the general inbox.
  */
 
 test.beforeAll(() => seedStaff());
@@ -20,6 +23,82 @@ const main = (page: Page) => page.getByRole('main');
 const nav = (page: Page) => page.getByRole('navigation', { name: 'Điều hướng quản trị' });
 const unique = () => randomBytes(3).toString('hex');
 
+/** A guest.confirmed email for a fresh confirmed booking, as the sender left it: failed after 7 sends. */
+async function failedEmail(to: string): Promise<{ reservationId: string; reference: string; outboxId: string }> {
+  const r = await seedReservation({ restaurant: 'hai-van-lounge', date: venueDay(40), status: 'confirmed', meal: 'Dinner' });
+  await one(`UPDATE reservations SET email = $2 WHERE id = $1`, [r.id, to]);
+  const row = await one<{ id: string }>(
+    `INSERT INTO email_outbox (env, event, audience, reservation_id, to_email, locale, status, attempts, last_error)
+     VALUES ('development', 'guest.confirmed', 'guest', $1, $2, 'en', 'failed', 7, 'provider_error: SMTP ETIMEDOUT at CONN: Greeting never received')
+     RETURNING id::text`,
+    [r.id, to],
+  );
+  return { reservationId: r.id, reference: r.reference, outboxId: row!.id };
+}
+
+test('an Editor finds a failed email on the overview and the log, masked, and sends it again', async ({ page }) => {
+  const guest = `khach.${unique()}@guest.test`;
+  const { reservationId, reference, outboxId } = await failedEmail(guest);
+  const violations = await watchCsp(page);
+  await signInAs(page, STAFF.editor);
+  await expect(main(page).getByTestId('failed-emails')).toContainText('email lỗi');
+  // Not the Admin's: no "chưa có người nhận" section.
+  await expect(main(page).getByTestId('uncovered-restaurants')).toHaveCount(0);
+
+  await page.goto('/admin/reservations/emails?tab=failed');
+  await expectHydrated(page);
+  await expect(main(page).getByTestId('delivery-mode')).toContainText('chỉ ghi log');
+  await expect(main(page).getByText('sau 1 phút, 5 phút, 15 phút, 1 giờ, 6 giờ, 12 giờ')).toBeVisible();
+  const row = main(page).getByRole('row').filter({ hasText: reference });
+  await expect(row).toContainText('Khách: đã xác nhận');
+  await expect(row).toContainText(`k•••@guest.test`);
+  await expect(row).not.toContainText(guest);
+  await expect(row).toContainText('7 lần gửi');
+  await expect(row).toContainText('SMTP ETIMEDOUT');
+
+  await row.getByRole('button', { name: `Gửi lại Khách: đã xác nhận ${reference}` }).click();
+  await expect(row.getByRole('status')).toContainText('Đã đưa vào hàng gửi');
+  // The send runs in after(): the row turns sent once the response is out.
+  await expect.poll(async () => (await one<{ status: string }>(`SELECT status FROM email_outbox WHERE id = $1`, [outboxId]))?.status, { timeout: 10_000 }).toBe('sent');
+  const [email] = emailsTo(guest);
+  expect(email.subject).toBe(`Your table is confirmed (${reference})`);
+  expect(email.text).toContain('Your table at Hải Vân Lounge is confirmed.');
+  expect(await one(`SELECT actor_id, before, after FROM audit_log WHERE entity_type = 'email_outbox' AND entity_id = $1`, [outboxId])).toEqual({
+    actor_id: STAFF.editor.id,
+    before: { status: 'failed', attempts: 7 },
+    after: { status: 'queued' },
+  });
+
+  // The booking shows its email, in full, sent on the first fresh attempt.
+  await page.goto(`/admin/reservations/${reservationId}`);
+  const emails = main(page).getByRole('table', { name: 'Email của đặt bàn' });
+  await expect(emails.getByRole('row').filter({ hasText: guest })).toContainText('Đã gửi');
+  await expect(emails.getByRole('row').filter({ hasText: guest })).toContainText('1 lần gửi');
+  expect(violations).toEqual([]);
+});
+
+test('"Gửi lại" is refused for an email that was sent meanwhile', async ({ page }) => {
+  const guest = `khach.${unique()}@guest.test`;
+  const { reference, outboxId } = await failedEmail(guest);
+  await signInAs(page, STAFF.editor);
+  await page.goto('/admin/reservations/emails?tab=failed');
+  await expectHydrated(page);
+  const row = main(page).getByRole('row').filter({ hasText: reference });
+  // Meanwhile the cron sent it.
+  await one(`UPDATE email_outbox SET status = 'sent', sent_at = now() WHERE id = $1`, [outboxId]);
+  await row.getByRole('button', { name: /^Gửi lại/ }).click();
+  await expect(row.getByRole('alert')).toContainText('không gửi lại được');
+});
+
+test('the Admin’s overview names the restaurants whose new-booking email goes to the shared inbox', async ({ page }) => {
+  await signInAs(page, STAFF.admin);
+  const uncovered = main(page).getByTestId('uncovered-restaurants');
+  await expect(uncovered).toContainText('Café Indochine');
+  await expect(uncovered).toContainText('hộp thư chung');
+  await main(page).getByRole('link', { name: 'Mở Thông báo email để thêm người nhận' }).click();
+  await expect(page.getByRole('heading', { name: 'Thông báo email', level: 1 })).toBeVisible();
+});
+
 test('an Editor has no notification settings: no menu item, and the 403 view', async ({ page }) => {
   await signInAs(page, STAFF.editor);
   await expect(nav(page).getByRole('link', { name: 'Thông báo email' })).toHaveCount(0);
```

Cất tạm các file ngoài `e2e/`, build, chạy `e2e/admin-emails.spec.ts --project=desktop -g "Editor finds a failed email|refused for an email|overview names"`. Expected: `3 failed`:

```
  ✘  1 [desktop] › e2e/admin-emails.spec.ts:39:5 › an Editor finds a failed email on the overview and the log, masked, and sends it again (5.7s)
  ✘  2 [desktop] › e2e/admin-emails.spec.ts:80:5 › "Gửi lại" is refused for an email that was sent meanwhile (30.1s)
  ✘  3 [desktop] › e2e/admin-emails.spec.ts:93:5 › the Admin’s overview names the restaurants whose new-booking email goes to the shared inbox (5.4s)
    Locator: getByRole('main').getByTestId('failed-emails')
    Error: element(s) not found
      - waiting for getByRole('main').getByRole('row').filter({ hasText: 'FC-8KREZQXK' }).getByRole('button', { name: /^Gửi lại/ })
    Locator: getByRole('main').getByTestId('uncovered-restaurants')
    Error: element(s) not found
```

Lấy lại các file đã cất.

- [ ] **Bước 4: Viết các truy vấn của nhật ký và "Gửi lại"**

Create `lib/server/email/outbox-log.ts` (`requeueEmail` là `SELECT … FOR UPDATE` → `UPDATE` → `insertAudit` trong một transaction: quyết định nằm trên hàng đã khóa, và hàng audit cần `before {status, attempts}`):

```ts
import 'server-only';
import type { Pool, PoolClient } from 'pg';
import type { EmailAudience, EmailEvent, EmailStatus } from '@/lib/email/events';
import { insertAudit, withTransaction, type AuditActor } from '@/lib/server/audit';
import type { OutboxEnv } from './env';
import { restaurantsWithoutRecipient } from './recipients';

/*
 * What staff see of email_outbox (spec §7.2 /admin/reservations/emails, the
 * booking's own emails, the overview), and the one write they make on it,
 * "Gửi lại". Every read and the write are limited to this deployment's env: a
 * Preview's branch carries production's rows, and must neither show them as
 * its own nor send them. Email history lives here only (R2): no
 * reservation_events row, ever.
 *
 * created_at travels as microseconds since the epoch in the cursor (exact; a
 * JS Date keeps only milliseconds), like the reservations inbox.
 */

type Db = Pool | PoolClient;

export const EMAIL_LOG_PAGE_SIZE = 50;
export const EMAIL_LOG_TABS = ['all', 'failed', 'queued', 'sent', 'skipped'] as const;
export type EmailLogTab = (typeof EMAIL_LOG_TABS)[number];

export type EmailLogRow = {
  id: string;
  event: EmailEvent;
  audience: EmailAudience;
  reservationId: string;
  reference: string;
  restaurantName: string;
  toEmail: string;
  locale: string;
  status: EmailStatus;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
  cursor: string;
};

const COLUMNS = `o.id::text, o.event, o.audience, o.reservation_id::text AS "reservationId", r.reference, t.name AS "restaurantName",
  o.to_email AS "toEmail", o.locale, o.status, o.attempts::int,
  o.next_attempt_at AS "nextAttemptAt", o.last_error AS "lastError", o.sent_at AS "sentAt", o.created_at AS "createdAt",
  (extract(epoch FROM o.created_at) * 1000000)::bigint::text || '_' || o.id::text AS cursor`;

const FROM = `email_outbox o JOIN reservations r ON r.id = o.reservation_id JOIN restaurants t ON t.id = r.restaurant_id`;
const CURSOR = /^(\d{1,17})_(\d{1,18})$/;

/** The statuses one tab shows: "Đang chờ" includes a row a sender holds right now. */
const TAB_STATUSES: Record<Exclude<EmailLogTab, 'all'>, EmailStatus[]> = {
  failed: ['failed'],
  queued: ['queued', 'sending'],
  sent: ['sent'],
  skipped: ['skipped'],
};

/** One page of the log, newest first; `tab` filters by status, `after` is the previous page's cursor. */
export async function listEmailLog(
  db: Db,
  options: { env: OutboxEnv; tab: EmailLogTab; after?: string | null },
): Promise<{ rows: EmailLogRow[]; next: string | null }> {
  const values: unknown[] = [options.env];
  const where = ['o.env = $1'];
  if (options.tab !== 'all') where.push(`o.status = ANY ($${values.push(TAB_STATUSES[options.tab])}::text[])`);
  const m = CURSOR.exec(options.after ?? '');
  if (m) {
    where.push(
      `(o.created_at, o.id) < (timestamptz 'epoch' + $${values.push(m[1])}::bigint * interval '1 microsecond', $${values.push(m[2])}::bigint)`,
    );
  }
  const { rows } = await db.query<EmailLogRow>(
    `SELECT ${COLUMNS} FROM ${FROM} WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC, o.id DESC LIMIT ${EMAIL_LOG_PAGE_SIZE + 1}`,
    values,
  );
  const page = rows.slice(0, EMAIL_LOG_PAGE_SIZE);
  return { rows: page, next: rows.length > EMAIL_LOG_PAGE_SIZE ? page[page.length - 1].cursor : null };
}

/** The emails of one booking, oldest first (the booking's page). */
export async function listReservationEmails(db: Db, reservationId: string, env: OutboxEnv): Promise<EmailLogRow[]> {
  const { rows } = await db.query<EmailLogRow>(`SELECT ${COLUMNS} FROM ${FROM} WHERE o.reservation_id = $1 AND o.env = $2 ORDER BY o.created_at, o.id`, [
    reservationId,
    env,
  ]);
  return rows;
}

/**
 * The overview's email block (spec §7.2, §10.4 "hiện trên Tổng quan", §12,
 * R21): this env's emails that used up their attempts, and the restaurants
 * taking bookings whose staff.new goes to the shared inbox.
 */
export async function emailOverview(db: Db, env: OutboxEnv): Promise<{ failed: number; unrouted: { id: string; name: string }[] }> {
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM email_outbox WHERE env = $1 AND status = 'failed'`, [env]);
  return { failed: rows[0].n, unrouted: await restaurantsWithoutRecipient(db) };
}

/** A row "Gửi lại" may touch: one that failed for good, or one waiting for its next attempt. */
export const resendable = (status: EmailStatus) => status === 'failed' || status === 'queued';

export type RequeueResult =
  | { ok: true; data: { id: string; reservationId: string } }
  | { ok: false; code: 'not_found' }
  /** Sent or skipped (nothing to resend), or a sender holds it right now. */
  | { ok: false; code: 'not_allowed' };

/**
 * "Gửi lại" (C9, R2, R6): a failed row goes back to the queue with fresh
 * attempts (a new ≈19.4-hour schedule; it reached no one, so the same
 * Message-ID); a waiting row is simply due now. The decision is made on the
 * row locked FOR UPDATE, never on an earlier read, so a row a sender claimed
 * meanwhile ('sending') is refused, not pulled out from under it. Sent and
 * skipped rows are refused: sending those again would be a new email. One
 * audit_log row in the same transaction, with no address in it; the caller
 * drains the row after COMMIT.
 */
export async function requeueEmail(pool: Pool, actor: AuditActor, input: { id: string; env: OutboxEnv }): Promise<RequeueResult> {
  return withTransaction(pool, async (client): Promise<RequeueResult> => {
    const { rows } = await client.query<{ status: EmailStatus; attempts: number; reservation_id: string }>(
      `SELECT status, attempts::int, reservation_id::text FROM email_outbox WHERE id = $1 AND env = $2 FOR UPDATE`,
      [input.id, input.env],
    );
    const row = rows[0];
    if (!row) return { ok: false, code: 'not_found' };
    if (!resendable(row.status)) return { ok: false, code: 'not_allowed' };
    await client.query(
      `UPDATE email_outbox
          SET status = 'queued', next_attempt_at = now(), locked_until = NULL, updated_at = now(),
              attempts = CASE WHEN status = 'failed' THEN 0 ELSE attempts END
        WHERE id = $1`,
      [input.id],
    );
    await insertAudit(client, actor, {
      action: 'update',
      entityType: 'email_outbox',
      entityId: input.id,
      before: { status: row.status, attempts: row.attempts },
      after: { status: 'queued' },
    });
    return { ok: true, data: { id: input.id, reservationId: row.reservation_id } };
  });
}
```

Sửa `lib/server/action-result.ts`:

```diff
diff --git a/lib/server/action-result.ts b/lib/server/action-result.ts
index e24f12d..2c0894f 100644
--- a/lib/server/action-result.ts
+++ b/lib/server/action-result.ts
@@ -39,6 +39,8 @@ export type ActionCode =
   /** Same restaurant, date, time and phone as an active booking (reservations_dedupe_v2_idx). */
   | 'duplicate'
   // Email (spec §10.4).
+  /** "Gửi lại" on an email that was sent, skipped, or is being sent right now. */
+  | 'not_resendable'
   /** "Gửi email thử" did not go out; params.error is describeEmailError's "<code>: <message>" (no address). */
   | 'email_failed';
 
```

Sửa `lib/admin/auth-errors.ts`:

```diff
diff --git a/lib/admin/auth-errors.ts b/lib/admin/auth-errors.ts
index df2eafa..3907afb 100644
--- a/lib/admin/auth-errors.ts
+++ b/lib/admin/auth-errors.ts
@@ -60,6 +60,7 @@ const ACTION_MESSAGES: Record<ActionCode, string> = {
   closed: 'Nhà hàng đóng cửa vào bữa này trong ngày đã chọn.',
   slot_unavailable: 'Giờ này không nằm trong ca phục vụ của ngày đã chọn.',
   duplicate: 'Số điện thoại này đã có một đặt bàn đang hoạt động cùng nhà hàng, ngày và giờ.',
+  not_resendable: 'Email này đã gửi, đã bỏ qua hoặc đang được gửi, nên không gửi lại được. Hãy tải lại trang.',
   email_failed: 'Không gửi được email thử.',
 };
 
```

Sửa `lib/admin/audit-labels.ts`:

```diff
diff --git a/lib/admin/audit-labels.ts b/lib/admin/audit-labels.ts
index ab1e252..f363f2b 100644
--- a/lib/admin/audit-labels.ts
+++ b/lib/admin/audit-labels.ts
@@ -37,9 +37,10 @@ const ENTITIES: Record<string, string> = {
   restaurant_booking: 'Quy tắc đặt bàn',
   booking_settings: 'Cài đặt đặt bàn',
   closure: 'Ngày đóng cửa',
-  // Email settings (phase 5): a staff.new recipient, the shared inbox (site_settings.email).
+  // Email (phase 5): a staff.new recipient, the shared inbox (site_settings.email), "Gửi lại" on one email (R2).
   notification_recipient: 'Người nhận thông báo',
   site_settings: 'Cài đặt chung',
+  email_outbox: 'Email',
 };
 
 export function auditActionLabel(action: string): string {
```

Sửa `lib/admin/notification-schemas.ts`:

```diff
diff --git a/lib/admin/notification-schemas.ts b/lib/admin/notification-schemas.ts
index cf9810c..5957d2a 100644
--- a/lib/admin/notification-schemas.ts
+++ b/lib/admin/notification-schemas.ts
@@ -42,3 +42,6 @@ export const TestEmailForm = z.object({
   event: z.enum(EMAIL_EVENTS, { error: 'Chọn loại email.' }),
   locale: LocaleCode,
 });
+
+/** "Gửi lại": the email_outbox row. */
+export const RequeueForm = z.object({ id: Id });
```

- [ ] **Bước 5: Action "Gửi lại" và các thành phần**

Create `app/admin/(shell)/reservations/emails/actions.ts` (không `refresh()`: trên tab "Lỗi", vẽ lại sẽ bỏ hàng, và câu thông báo của nó, trước khi lần gửi kịp chạy):

```ts
'use server';

import { getPool } from '@/db/client';
import { RequeueForm } from '@/lib/admin/notification-schemas';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { auditActor, requirePermission } from '@/lib/server/dal/session';
import { drainAfterCommit } from '@/lib/server/email/after-commit';
import { outboxEnv } from '@/lib/server/email/env';
import { requeueEmail } from '@/lib/server/email/outbox-log';

/*
 * "Gửi lại" (spec §7.2 /admin/reservations/emails, §10.4 "Kích hoạt bộ gửi"):
 * Editor and Admin, reservations:update, like every other booking action. The
 * row is requeued in one transaction with its audit_log row (R2); the send
 * itself runs after the response (drainAfterCommit: after() is allowed in
 * Server Functions,
 * node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md:8),
 * this row first (R20). A send cut short with the function is retried by the
 * cron once its lease ends.
 */
export async function resendEmail(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const staff = await requirePermission({ reservations: ['update'] });
    const { id } = RequeueForm.parse({ id: formData.get('id') });
    const result = await requeueEmail(getPool(), auditActor(staff), { id, env: outboxEnv() });
    if (!result.ok) return result.code === 'not_allowed' ? { ok: false, code: 'not_resendable' } : result;
    drainAfterCommit([id]);
    // No refresh(): the row keeps its notice ("on its way"); a redraw now would still show it queued,
    // and on the "Lỗi" tab would drop the row, notice and all, before the send has even run.
    return { ok: true, data: { id } };
  } catch (err) {
    return actionError(err);
  }
}
```

Create `app/admin/(shell)/reservations/_ui/ResendEmail.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { actionErrorMessage } from '@/lib/admin/auth-errors';
import type { ActionResult } from '@/lib/server/action-result';
import { resendEmail } from '../emails/actions';

/*
 * "Gửi lại" for one failed or waiting email. The send runs after the
 * response, so the notice says it is on its way; the row shows the outcome on
 * the next load.
 */
export function ResendEmail({ id, label }: { id: string; label: string }) {
  const [state, action, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(resendEmail, null);
  return (
    <form className="a-resend" action={action}>
      <input type="hidden" name="id" value={id} />
      <button className="a-btn a-btn--small a-btn--ghost" type="submit" disabled={pending} aria-label={`Gửi lại ${label}`}>
        {pending ? 'Đang gửi lại…' : 'Gửi lại'}
      </button>
      {state?.ok ? (
        <p className="a-sub" role="status">
          Đã đưa vào hàng gửi. Tải lại trang sau vài giây để xem kết quả.
        </p>
      ) : null}
      {state && !state.ok ? (
        <p className="a-field-error" role="alert">
          {actionErrorMessage(state.code, state.params)}
        </p>
      ) : null}
    </form>
  );
}
```

Create `app/admin/(shell)/reservations/_ui/EmailStatusBadge.tsx`:

```tsx
import { EMAIL_STATUS_LABELS, type EmailStatus } from '@/lib/email/events';

/* An email's status as a coloured label (admin.css .a-status--email-<status>); "Đang gửi" while a sender holds it. */
export function EmailStatusBadge({ status }: { status: EmailStatus }) {
  return <span className={`a-status a-status--email-${status}`}>{EMAIL_STATUS_LABELS[status]}</span>;
}
```

- [ ] **Bước 6: Trang nhật ký, mục Email của đặt bàn, Tổng quan, CSS**

Create `app/admin/(shell)/reservations/emails/page.tsx` (câu dẫn lấy lịch thử lại từ `RETRY_DELAYS_MINUTES`, không viết cứng):

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { formatDateTimeVi } from '@/lib/admin/format';
import { EMAIL_EVENT_LABELS, maskEmail } from '@/lib/email/events';
import { roleCan } from '@/lib/server/auth/permissions';
import { requirePagePermission } from '@/lib/server/dal/session';
import { MAX_ATTEMPTS, RETRY_DELAYS_MINUTES } from '@/lib/server/email/drain';
import { outboxEnv } from '@/lib/server/email/env';
import { deliveryModeNotice } from '@/lib/server/email/mode';
import { EMAIL_LOG_TABS, listEmailLog, resendable, type EmailLogTab } from '@/lib/server/email/outbox-log';
import { redactEmails } from '@/lib/server/email/types';
import { EmailStatusBadge } from '../_ui/EmailStatusBadge';
import { ResendEmail } from '../_ui/ResendEmail';
import { SectionNav } from '../_ui/SectionNav';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Nhật ký email' };

const TAB_LABELS: Record<EmailLogTab, string> = { all: 'Tất cả', failed: 'Lỗi', queued: 'Đang chờ', sent: 'Đã gửi', skipped: 'Bỏ qua' };

type Search = { tab?: string | string[]; sau?: string | string[] };
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
/** The list shows the start of an error; the booking's page shows all of it. */
const clip = (text: string, max = 90) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
/** 1 → "1 phút", 60 → "1 giờ": the retry ladder in words, from the drain's own constant. */
const wait = (minutes: number) => (minutes % 60 === 0 ? `${minutes / 60} giờ` : `${minutes} phút`);

/*
 * Spec §7.2 "Nhật ký email, gửi lại": this deployment's booking emails, newest
 * first. A guest's address shows masked (l•••@gmail.com, R12): the list is for
 * spotting failures, and the full address is one click away on the booking,
 * which staff open anyway to act. Staff addresses show in full. The URL holds
 * only the tab and the cursor, never an address (phase-4 SEC-2).
 */
export default async function EmailLogPage({ searchParams }: { searchParams: Promise<Search> }) {
  const staff = await requirePagePermission({ reservations: ['read'] });
  const params = await searchParams;
  const tab = (EMAIL_LOG_TABS as readonly string[]).includes(one(params.tab) ?? '') ? (one(params.tab) as EmailLogTab) : 'all';
  const after = one(params.sau);
  const { rows, next } = await listEmailLog(getPool(), { env: outboxEnv(), tab, after });
  const canResend = roleCan(staff.role, { reservations: ['update'] });
  const href = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ ...(tab !== 'all' ? { tab } : {}), ...extra }).toString();
    return q ? `/admin/reservations/emails?${q}` : '/admin/reservations/emails';
  };

  return (
    <>
      <SectionNav current="/admin/reservations/emails" />
      <h1>Nhật ký email</h1>
      <p className="a-lede">
        {`Email lỗi được gửi lại tự động tối đa ${MAX_ATTEMPTS} lần (sau ${RETRY_DELAYS_MINUTES.map(wait).join(', ')}); hết lượt thì báo “Lỗi” ở đây và trên Tổng quan.`}
      </p>
      <p className="a-muted" data-testid="delivery-mode">
        {deliveryModeNotice()}
      </p>
      <nav className="a-tabs" aria-label="Lọc email">
        {EMAIL_LOG_TABS.map((t) => (
          <Link key={t} href={t === 'all' ? '/admin/reservations/emails' : `/admin/reservations/emails?tab=${t}`} aria-current={t === tab ? 'page' : undefined}>
            {TAB_LABELS[t]}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="a-lede">Không có email nào.</p>
      ) : (
        <div className="a-table-scroll">
          <table className="a-table">
            <thead>
              <tr>
                <th scope="col">Email · tạo lúc</th>
                <th scope="col">Người nhận</th>
                <th scope="col">Đặt bàn</th>
                <th scope="col">Trạng thái</th>
                <th scope="col">Lỗi gần nhất</th>
                <th scope="col">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {EMAIL_EVENT_LABELS[r.event]}
                    <small className="a-sub">{formatDateTimeVi(r.createdAt)}</small>
                  </td>
                  <td>
                    {r.audience === 'guest' ? maskEmail(r.toEmail) : r.toEmail}
                    <small className="a-sub">{r.locale}</small>
                  </td>
                  <td className="a-ref">
                    <Link href={`/admin/reservations/${r.reservationId}`}>{r.reference}</Link>
                    <small className="a-sub">{r.restaurantName}</small>
                  </td>
                  <td>
                    <EmailStatusBadge status={r.status} />
                    {r.status === 'sent' && r.sentAt ? <small className="a-sub">{formatDateTimeVi(r.sentAt)}</small> : null}
                    {r.status === 'queued' && r.attempts > 0 ? <small className="a-sub">{`Lần tới: ${formatDateTimeVi(r.nextAttemptAt)}`}</small> : null}
                    <small className="a-sub">{`${r.attempts} lần gửi`}</small>
                  </td>
                  <td>{r.lastError ? <span className="a-error-text">{clip(redactEmails(r.lastError))}</span> : '—'}</td>
                  <td>{canResend && resendable(r.status) ? <ResendEmail id={r.id} label={`${EMAIL_EVENT_LABELS[r.event]} ${r.reference}`} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next || after ? (
        <nav className="a-pager" aria-label="Phân trang">
          {after ? <Link href={href({})}>← Trang đầu</Link> : null}
          {next ? <Link href={href({ sau: next })}>Trang sau →</Link> : null}
        </nav>
      ) : null}
    </>
  );
}
```

Sửa `app/admin/(shell)/reservations/_ui/SectionNav.tsx`:

```diff
diff --git a/app/admin/(shell)/reservations/_ui/SectionNav.tsx b/app/admin/(shell)/reservations/_ui/SectionNav.tsx
index 58978b2..57a90c4 100644
--- a/app/admin/(shell)/reservations/_ui/SectionNav.tsx
+++ b/app/admin/(shell)/reservations/_ui/SectionNav.tsx
@@ -5,6 +5,7 @@ const LINKS = [
   { href: '/admin/reservations/new', label: 'Tạo đặt bàn' },
   { href: '/admin/reservations/day', label: 'Theo ngày' },
   { href: '/admin/reservations/closures', label: 'Ngày đóng cửa' },
+  { href: '/admin/reservations/emails', label: 'Email' },
 ] as const;
 
 /* The reservations section's own links (spec §7.2), above each of its pages; hidden when printing. */
```

Sửa `app/admin/(shell)/reservations/[id]/page.tsx` (địa chỉ đầy đủ ở đây, R12; lỗi không cắt):

```diff
diff --git a/app/admin/(shell)/reservations/[id]/page.tsx b/app/admin/(shell)/reservations/[id]/page.tsx
index a1843ea..8c20523 100644
--- a/app/admin/(shell)/reservations/[id]/page.tsx
+++ b/app/admin/(shell)/reservations/[id]/page.tsx
@@ -6,10 +6,17 @@ import { formatDateTimeVi, formatIsoDayVi } from '@/lib/admin/format';
 import { seatings } from '@/lib/booking/resolve-day';
 import { HOLDING_STATUSES } from '@/lib/booking/rules';
 import { fromMinutes } from '@/lib/venue-time';
+import { EMAIL_EVENT_LABELS } from '@/lib/email/events';
 import { SOURCE_LABELS, STATUS_LABELS, availableTransitions, opensAtMinutes } from '@/lib/reservations/lifecycle';
+import { roleCan } from '@/lib/server/auth/permissions';
 import { getReservation, listEvents, listNotes } from '@/lib/server/booking/queries';
 import { loadRestaurantRules } from '@/lib/server/booking/rules';
 import { requirePagePermission } from '@/lib/server/dal/session';
+import { outboxEnv } from '@/lib/server/email/env';
+import { listReservationEmails, resendable } from '@/lib/server/email/outbox-log';
+import { redactEmails } from '@/lib/server/email/types';
+import { EmailStatusBadge } from '../_ui/EmailStatusBadge';
+import { ResendEmail } from '../_ui/ResendEmail';
 import { SectionNav } from '../_ui/SectionNav';
 import { StatusBadge } from '../_ui/StatusBadge';
 import { EditReservationForm } from './EditReservationForm';
@@ -53,16 +60,18 @@ function describeChanges(changes: Record<string, unknown> | null): string | null
 }
 
 export default async function ReservationPage({ params }: { params: Promise<{ id: string }> }) {
-  await requirePagePermission({ reservations: ['read'] });
+  const staff = await requirePagePermission({ reservations: ['read'] });
   const { id } = await params;
   const pool = getPool();
   const reservation = await getReservation(pool, id);
   if (!reservation) notFound();
-  const [events, notes, loaded] = await Promise.all([
+  const [events, notes, loaded, emails] = await Promise.all([
     listEvents(pool, id),
     listNotes(pool, [id]),
     loadRestaurantRules(pool, reservation.restaurantId, 'vi', reservation.date),
+    listReservationEmails(pool, id, outboxEnv()),
   ]);
+  const canResend = roleCan(staff.role, { reservations: ['update'] });
 
   // The page renders at request time (after the session read), so the windows are this request's.
   const options: TransitionOption[] = availableTransitions(reservation.status, reservation.date, reservation.time).map(({ transition: t, window }) => {
@@ -163,6 +172,49 @@ export default async function ReservationPage({ params }: { params: Promise<{ id
         <NoteForm id={reservation.id} />
       </section>
 
+      {/* The booking's emails (R2): history lives in email_outbox, beside the timeline; the full address shows here (R12). */}
+      <section aria-labelledby="res-emails-title">
+        <h2 id="res-emails-title">Email</h2>
+        {emails.length === 0 ? (
+          <p className="a-muted">Chưa có email nào cho đặt bàn này.</p>
+        ) : (
+          <div className="a-table-scroll">
+            <table className="a-table a-table--compact" aria-label="Email của đặt bàn">
+              <thead>
+                <tr>
+                  <th scope="col">Loại</th>
+                  <th scope="col">Người nhận</th>
+                  <th scope="col">Trạng thái</th>
+                  <th scope="col">Lỗi gần nhất</th>
+                  <th scope="col">Thao tác</th>
+                </tr>
+              </thead>
+              <tbody>
+                {emails.map((m) => (
+                  <tr key={m.id}>
+                    <td>
+                      {EMAIL_EVENT_LABELS[m.event]}
+                      <small className="a-sub">{formatDateTimeVi(m.createdAt)}</small>
+                    </td>
+                    <td>
+                      {m.toEmail}
+                      <small className="a-sub">{m.locale}</small>
+                    </td>
+                    <td>
+                      <EmailStatusBadge status={m.status} />
+                      {m.sentAt ? <small className="a-sub">{formatDateTimeVi(m.sentAt)}</small> : null}
+                      <small className="a-sub">{`${m.attempts} lần gửi`}</small>
+                    </td>
+                    <td>{m.lastError ? <span className="a-error-text">{redactEmails(m.lastError)}</span> : '—'}</td>
+                    <td>{canResend && resendable(m.status) ? <ResendEmail id={m.id} label={EMAIL_EVENT_LABELS[m.event]} /> : null}</td>
+                  </tr>
+                ))}
+              </tbody>
+            </table>
+          </div>
+        )}
+      </section>
+
       <section aria-labelledby="res-timeline-title">
         <h2 id="res-timeline-title">Dòng thời gian</h2>
         <ol className="a-timeline" aria-label="Dòng thời gian">
```

Sửa `app/admin/(shell)/page.tsx`:

```diff
diff --git a/app/admin/(shell)/page.tsx b/app/admin/(shell)/page.tsx
index 7d4e8c3..283db4b 100644
--- a/app/admin/(shell)/page.tsx
+++ b/app/admin/(shell)/page.tsx
@@ -6,6 +6,8 @@ import { roleCan } from '@/lib/server/auth/permissions';
 import { listOpenInvitations } from '@/lib/server/auth/staff-queries';
 import { overviewCounts } from '@/lib/server/booking/queries';
 import { verifySession } from '@/lib/server/dal/session';
+import { outboxEnv } from '@/lib/server/email/env';
+import { emailOverview } from '@/lib/server/email/outbox-log';
 import { venueNow } from '@/lib/venue-time';
 
 // Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
@@ -15,9 +17,11 @@ export const metadata: Metadata = { title: 'Tổng quan' };
 
 /*
  * The greeting; bookings waiting for staff and today's bookings (spec §7.2
- * "đặt bàn chờ xử lý"), for roles that read bookings; to Admins, invitations
- * whose email failed ("email lỗi"). Translation and notification widgets
- * arrive with phases 5 and 8.
+ * "đặt bàn chờ xử lý"), with the booking emails of this environment that used
+ * up their attempts ("email lỗi", §10.4, §12), for roles that read bookings;
+ * to Admins, invitations whose email failed, and the restaurants whose "đặt
+ * bàn mới" goes to the shared inbox ("nhà hàng chưa có người nhận thông báo",
+ * R21). Translation widgets arrive with phase 8.
  */
 export default async function OverviewPage() {
   const staff = await verifySession();
@@ -25,6 +29,8 @@ export default async function OverviewPage() {
   const failed = roleCan(staff.role, { user: ['list'] }) ? (await listOpenInvitations(pool)).filter((i) => i.email_error !== null) : [];
   // Today is Da Nang's date, whatever the server's timezone.
   const bookings = roleCan(staff.role, { reservations: ['read'] }) ? await overviewCounts(pool, venueNow().date) : null;
+  const emails = bookings ? await emailOverview(pool, outboxEnv()) : null;
+  const unrouted = emails && roleCan(staff.role, { settings: ['read'] }) ? emails.unrouted : [];
 
   return (
     <>
@@ -46,9 +52,25 @@ export default async function OverviewPage() {
                 <strong>{bookings.today}</strong> đặt bàn hôm nay · {bookings.todayCovers} khách
               </Link>
             </li>
+            <li>
+              <Link href="/admin/reservations/emails?tab=failed" data-testid="failed-emails">
+                <strong>{emails?.failed ?? 0}</strong> email lỗi
+              </Link>
+            </li>
           </ul>
         </section>
       ) : null}
+      {unrouted.length > 0 ? (
+        <section aria-labelledby="overview-unrouted">
+          <h2 id="overview-unrouted">Nhà hàng chưa có người nhận thông báo</h2>
+          <p className="a-warn" data-testid="uncovered-restaurants">
+            {`${unrouted.length} nhà hàng: ${unrouted.map((r) => r.name).join(', ')}. Email đặt bàn mới của các nhà hàng này đang về hộp thư chung.`}
+          </p>
+          <p>
+            <Link href="/admin/settings/notifications">Mở Thông báo email để thêm người nhận</Link>
+          </p>
+        </section>
+      ) : null}
       {failed.length > 0 ? (
         <section aria-labelledby="failed-invitations">
           <h2 id="failed-invitations">Lời mời chưa gửi được email</h2>
```

Sửa `styles/admin.css` (bảng rộng cuộn trong khung của nó trên điện thoại thay vì làm rộng trang):

```diff
diff --git a/styles/admin.css b/styles/admin.css
index 40ee093..01edb29 100644
--- a/styles/admin.css
+++ b/styles/admin.css
@@ -784,3 +784,29 @@ fieldset.a-field legend {
   display: inline-block;
   margin: 8px 0;
 }
+
+/* Email statuses (email_outbox.status; "sending" = claimed by a sender right now). */
+.a-status--email-queued,
+.a-status--email-sending { background: #fff4d6; color: #7a5300; }
+.a-status--email-sent { background: #e3f1e6; color: #1d5a2c; }
+.a-status--email-failed { background: #fbe3e1; color: #8a1f17; }
+.a-status--email-skipped { background: #ecebe7; color: #56605b; }
+
+/* A stored SMTP error: long and technical. Wide enough to read, broken only between words when it can. */
+.a-error-text {
+  display: block;
+  min-width: 20ch;
+  max-width: 40ch;
+  overflow-wrap: break-word;
+  font-size: 13px;
+  color: var(--a-ink-soft);
+}
+
+/* A wide table scrolls inside its own box on a phone instead of widening the page. */
+.a-table-scroll {
+  overflow-x: auto;
+}
+
+.a-resend .a-btn {
+  white-space: nowrap;
+}
```

- [ ] **Bước 7: Chạy lại test, rồi kiểm khóa của "Gửi lại"**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/email-screens.test.ts lib/admin/audit-labels.test.ts lib/admin/auth-errors.test.ts test/guards/require-permission.guard.test.ts`
Expected: PASS `Test Files  4 passed (4)`, `Tests  83 passed (83)`

Đột biến: trong `requeueEmail` bỏ `FOR UPDATE` khỏi câu `SELECT` (quyết định trên một lần đọc trước khóa), chạy `npx vitest run test/integration/email-screens.test.ts`. Expected: `Tests  1 failed | 15 passed (16)`:

```
       × decides on the row as it is once locked: a claim that lands first wins, and the requeue is refused 248ms
AssertionError: expected { ok: true, data: { id: '82', …(1) } } to deeply equal { ok: false, code: 'not_allowed' }
```

Trả `FOR UPDATE` về.

- [ ] **Bước 8: Chạy cổng kiểm tra**

Expected:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo;
- `Test Files  62 passed (62)`, `Tests  749 passed (749)`;
- `Applied 7 migration(s).`; build thoát 0; check-prerender báo thêm `/admin/reservations/emails` trong "Admin check passed: …";
- E2E `127 passed`; visual `8 passed`.

- [ ] **Bước 9: Commit**

```bash
git add "app/admin/(shell)/page.tsx" "app/admin/(shell)/reservations/[id]/page.tsx" "app/admin/(shell)/reservations/_ui/EmailStatusBadge.tsx" "app/admin/(shell)/reservations/_ui/ResendEmail.tsx" "app/admin/(shell)/reservations/_ui/SectionNav.tsx" "app/admin/(shell)/reservations/emails/actions.ts" "app/admin/(shell)/reservations/emails/page.tsx" e2e/admin-emails.spec.ts lib/admin/audit-labels.test.ts lib/admin/audit-labels.ts lib/admin/auth-errors.test.ts lib/admin/auth-errors.ts lib/admin/notification-schemas.ts lib/server/action-result.ts lib/server/email/outbox-log.ts styles/admin.css test/guards/require-permission.guard.test.ts test/integration/email-screens.test.ts
git commit -m "$(cat <<'EOF'
feat: show the email log, send a failed email again, and count failed emails on the overview

/admin/reservations/emails (spec §7.2, Editor and Admin) lists this
environment's booking emails, newest first, 50 a page with a keyset cursor
and tabs by status; a guest's address shows masked (l•••@gmail.com), the
stored error is redacted and clipped, and the URL holds only the tab and the
cursor. Its lede states the retry ladder from the drain's own constant, and
the page states the delivery mode. The booking's page lists its own emails
beside the timeline, in full.

"Gửi lại" decides on the row it has locked: a failed email goes back to the
queue with fresh attempts and the same Message-ID, a waiting one becomes due
now, and an email that was sent, skipped or is being sent is refused. It
writes one audit_log row (entity email_outbox, no address) in the same
transaction and drains the row after the response, without a refresh that
would drop its notice. The overview counts this environment's failed emails
for everyone who reads bookings, and names for the Admin the restaurants
whose new-booking email goes to the shared inbox.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

Phần A xong ở đây. Phần B (Task 8–13: trang chính sách, đồng ý, honeypot và giới hạn theo số điện thoại, đường lỗi của drawer, BotID, SEC-2, nghiệm thu và runbook) tiếp ngay dưới, bắt đầu từ commit của Task 7.

---

## PHẦN B: trang chính sách, đồng ý, chống spam, BotID, SEC-2 và nghiệm thu

Phần B chạy tiếp trên commit của Task 7, cùng bản sao `p5-verify`, cùng luật: RED thật trước code, cổng kiểm tra của task xanh, mỗi task một commit. Bốn task đầu (8–11) chạm trang khách; mọi thay đổi thấy được trên trang khách đều nằm ngoài 8 baseline visual hoặc bị `e2e/visual-added.css` che (R17), nên visual vẫn `8 passed` ở ngưỡng 0 qua cả phần này.

### Task 8: Trang chính sách bảo mật và chữ của phần đồng ý

Spec §11 (Luật 91/2025/QH15): khách phải thấy thông báo ngay chỗ nhập thông tin và mở được trang chính sách. Task này viết chữ (registry `legal.*`, cùng `booking.privacy_notice` và `booking.consent` mà Task 9 đặt vào drawer), hằng phiên bản `PRIVACY_POLICY_VERSION` được ghim bằng hash của chữ EN (R17), trang `/[lang]/privacy` prerender như mọi trang khách, và link ở chân trang. Link chân trang nằm trong cả 8 baseline full-page, nên `e2e/visual-added.css` ẩn nó trong cả hai spec visual (không bao giờ `--update-snapshots`); `e2e/guest-guard.spec.ts` là nơi kiểm nó.

**Files:**
- Create: `lib/legal.ts`, `lib/legal.test.ts`, `lib/server/content/legal.ts`, `app/(site)/[lang]/(guarded)/privacy/page.tsx`, `styles/legal.css`, `e2e/visual-added.css`, `e2e/guest-guard.spec.ts`
- Modify: `lib/i18n/registry.ts`, `app/globals.css`, `components/site/Footer.tsx`, `e2e/visual.spec.ts`, `e2e/visual-nojs.spec.ts`, `scripts/check-prerender.mjs`

**Interfaces:**
- Consumes: `localeHref(locale, path)` (`lib/i18n/href.ts`); `loadStringRows(locale, keys, db?)` (Task 5) và `resolveStrings` (`lib/i18n/resolve.ts`); `TAGS.contentLegal`, `TAGS.i18n(locale)` (`lib/cache-tags.ts`); `ViewMarker`, `useSite().strings` (`ClientStrings`); `CONTACT.email` (`lib/data.ts`); `DEFAULT_LOCALE`, `toBcp47` (`lib/i18n/locales.ts`).
- Produces:
  - `lib/legal.ts`: `PRIVACY_POLICY_VERSION: IsoDate = '2026-10-02'`; `PRIVACY_SECTIONS` (5 cặp `[heading, body]`); `PRIVACY_KEYS` (mọi key trang đọc); `privacyHref(locale): string` (`/<locale>/privacy`).
  - `lib/server/content/legal.ts`: `getPrivacyStrings(locale)` (`'use cache'`, `cacheLife('max')`, tag `content:legal` + `i18n:<locale>`).
  - Registry: `booking.privacy_notice`, `booking.consent` (screen `legal`, tiền tố `booking.` nên tới client); `legal.link` (thêm vào `ClientKey` và `CLIENT_KEYS`: drawer và chân trang dùng); `legal.title`, `legal.updated {date}`, `legal.intro`, `legal.{collect,use,share,keep,rights}_{heading,body}` (`legal.rights_body` có `{email}`). Chỉ EN.
  - Class `.footer-legal` (ẩn trong spec visual); `e2e/guest-guard.spec.ts` (Task 9 và 11 viết thêm vào).

- [ ] **Bước 1: Viết test ghim phiên bản chính sách**

Hash phủ mọi chữ khách đồng ý khi tick ô: trang, câu thông báo và nhãn ô. Sửa chữ mà không dời phiên bản thì CI đỏ. Test cuối giữ R17: chưa key nào khách đồng ý có bản `vi`.

Create `lib/legal.test.ts`:

```ts
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { REGISTRY, type StringKey } from '@/lib/i18n/registry';
import { PRIVACY_KEYS, PRIVACY_POLICY_VERSION, privacyHref } from './legal';

/** Everything a guest agrees to when ticking the box: the page and the drawer's notice and label. */
const AGREED_KEYS: readonly StringKey[] = [...PRIVACY_KEYS, 'booking.privacy_notice', 'booking.consent'];

/*
 * reservations.consent_version must name the text the guest saw. When this
 * test fails, the policy text changed: move PRIVACY_POLICY_VERSION to today's
 * date and record the new pair below, in the same commit.
 */
const RECORDED = { version: '2026-10-02', sha256: 'e4cc25f651459137b706db6b8d538d7c69404d4af0e1eccea41fff8c51dfc5e9' };

describe('privacy policy version', () => {
  it('moves whenever the English text of the policy, the notice or the consent label changes', () => {
    const text = JSON.stringify(AGREED_KEYS.map((k) => [k, REGISTRY[k].en]));
    expect({ version: PRIVACY_POLICY_VERSION, sha256: createHash('sha256').update(text).digest('hex') }).toEqual(RECORDED);
  });

  it('is a calendar date, so the page can show it', () => {
    expect(PRIVACY_POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('lives under the locale prefix', () => {
    expect(privacyHref('en')).toBe('/en/privacy');
    expect(privacyHref('zh-hans')).toBe('/zh-hans/privacy');
  });

  it('is English only until a reviewed Vietnamese text exists (R17): no key the guest agrees to has a vi default', () => {
    expect(AGREED_KEYS.filter((k) => 'vi' in REGISTRY[k])).toEqual([]);
  });
});
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `npx vitest run lib/legal.test.ts`
Expected: FAIL `Test Files  1 failed (1)`, `Tests  no tests`:

```
 FAIL  lib/legal.test.ts [ lib/legal.test.ts ]
Error: Cannot find module './legal' imported from …/lib/legal.test.ts
```

- [ ] **Bước 3: Viết E2E và chạy nó trên build hiện tại: phải đỏ**

Create `e2e/guest-guard.spec.ts` (bản của Task 8: chỉ trang chính sách; Task 9 viết lại file với các test đồng ý, honeypot, giới hạn theo số điện thoại):

```ts
import { HOME_PATH } from './paths';
import { expect, test } from './staff-fixtures';

/*
 * Phase 5's guard on the guest side (spec §11): the privacy policy page and
 * the footer link to it. The footer link is hidden from the visual specs by
 * e2e/visual-added.css, so this spec is what checks it.
 */

test.use({ reducedMotion: 'reduce' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

test('the privacy policy page, from the footer', async ({ page }) => {
  await page.goto(HOME_PATH);
  await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy policy' }).click();
  await expect(page).toHaveURL(/\/en\/privacy$/);
  await expect(page).toHaveTitle('Privacy policy — Furama Cuisine');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy policy');
  await expect(page.getByText('Last updated 2 October 2026')).toBeVisible();
  // Scoped to main: the chrome's booking bar has a heading of its own on every guest page.
  await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText([
    'What we collect',
    'How we use it',
    'Who sees it',
    'How long we keep it',
    'Your rights',
  ]);
  await expect(page.getByRole('main').getByRole('link', { name: 'fb@furamavietnam.com' })).toHaveAttribute('href', 'mailto:fb@furamavietnam.com');
});
```

Cất tạm các file ngoài `e2e/`, build, chạy `e2e/guest-guard.spec.ts --project=desktop`. Expected: `1 failed`:

```
  ✘  1 [desktop] › e2e/guest-guard.spec.ts:15:5 › the privacy policy page, from the footer (30.1s)
    Error: locator.click: Test timeout of 30000ms exceeded.
      - waiting for getByRole('contentinfo').getByRole('link', { name: 'Privacy policy' })
```

Lấy lại các file đã cất.

- [ ] **Bước 4: Viết hằng chính sách và chữ trong registry**

Create `lib/legal.ts`:

```ts
import { localeHref } from '@/lib/i18n/href';
import type { StringKey } from '@/lib/i18n/registry';
import type { IsoDate } from '@/lib/venue-time';

/*
 * The guest privacy policy (spec §11): its page, its version and the keys it
 * is written in. A web booking stores the version the guest agreed to
 * (reservations.consent_version), so the version must change whenever the
 * policy's meaning does. lib/legal.test.ts pins a hash of the English text to
 * this version: editing a legal.* default fails CI until the version moves.
 * From phase 7 editors change the text in the database, and the version
 * becomes the time of that save instead of this constant.
 */
export const PRIVACY_POLICY_VERSION: IsoDate = '2026-10-02';

/** The sections of the policy page, in order: [heading, body]. */
export const PRIVACY_SECTIONS = [
  ['legal.collect_heading', 'legal.collect_body'],
  ['legal.use_heading', 'legal.use_body'],
  ['legal.share_heading', 'legal.share_body'],
  ['legal.keep_heading', 'legal.keep_body'],
  ['legal.rights_heading', 'legal.rights_body'],
] as const satisfies readonly (readonly [StringKey, StringKey])[];

/** Every key the policy page reads. */
export const PRIVACY_KEYS = ['legal.title', 'legal.updated', 'legal.intro', ...PRIVACY_SECTIONS.flat()] as const satisfies readonly StringKey[];

export function privacyHref(locale: string): string {
  return localeHref(locale, '/privacy');
}
```

Sửa `lib/i18n/registry.ts` (chữ chính sách là bản nháp EN; luật sư duyệt và cung cấp chữ VI là việc của người dùng, rủi ro 10):

```diff
diff --git a/lib/i18n/registry.ts b/lib/i18n/registry.ts
index 0dd0839..3484152 100644
--- a/lib/i18n/registry.ts
+++ b/lib/i18n/registry.ts
@@ -203,6 +203,109 @@ export const REGISTRY = {
       'Reservation form, a button under error.network when the dates or the times could not be loaded (server error or no connection); it asks the server again.',
     screen: 'booking',
   },
+  // ── The privacy notice and consent (spec §11, Law 91/2025/QH15). English only until a reviewed ──
+  // Vietnamese text exists (R17); lib/legal.test.ts pins a hash of these texts to PRIVACY_POLICY_VERSION.
+  // booking.* so they reach the reservation form; legal.link reaches the browser too (form and footer).
+  'booking.privacy_notice': {
+    en: 'We use your name, phone number and email only to arrange this booking and to contact you about it.',
+    maxLength: 240,
+    context:
+      'Reservation form, above the consent checkbox: the short privacy notice at the point of collection (spec §11, Law 91/2025/QH15). Must stay true to legal.* on the policy page.',
+    screen: 'legal',
+  },
+  'booking.consent': {
+    en: 'I agree to Furama Cuisine using my details as described in the privacy policy.',
+    maxLength: 160,
+    context:
+      'Reservation form, the label of the required consent checkbox. The policy link sits next to it (legal.link), not inside the label.',
+    screen: 'legal',
+  },
+  'legal.link': {
+    en: 'Privacy policy',
+    maxLength: 40,
+    context: 'Link to the privacy policy page, in the reservation form next to the consent box and in the site footer.',
+    screen: 'legal',
+  },
+  'legal.title': {
+    en: 'Privacy policy',
+    maxLength: 60,
+    context: 'Privacy policy page: the heading and the browser tab title.',
+    screen: 'legal',
+  },
+  'legal.updated': {
+    en: 'Last updated {date}',
+    maxLength: 60,
+    vars: ['date'],
+    context: 'Privacy policy page, under the heading. {date} is the policy version’s date, formatted; keep it.',
+    screen: 'legal',
+  },
+  'legal.intro': {
+    en: 'Furama Cuisine is the dining brand of Furama Resort Danang and Furama Dining House. This policy explains what we do with the details you give us when you request a table online.',
+    maxLength: 600,
+    context: 'Privacy policy page, the opening paragraph: who is responsible for the data.',
+    screen: 'legal',
+  },
+  'legal.collect_heading': {
+    en: 'What we collect',
+    maxLength: 80,
+    context: 'Privacy policy page, a section heading.',
+    screen: 'legal',
+  },
+  'legal.collect_body': {
+    en: 'Your name and phone number; your email address and any special request, if you give them; the restaurant, date, time and party size you chose; and the time you sent the request and agreed to this policy.',
+    maxLength: 1200,
+    context: 'Privacy policy page, the body of “What we collect”. Must match the fields of the reservation form.',
+    screen: 'legal',
+  },
+  'legal.use_heading': {
+    en: 'How we use it',
+    maxLength: 80,
+    context: 'Privacy policy page, a section heading.',
+    screen: 'legal',
+  },
+  'legal.use_body': {
+    en: 'Only to arrange your booking: to hold your table, to confirm, change or cancel it with you by phone or email, and to welcome you on the day. We do not use your details for marketing and we do not sell them.',
+    maxLength: 1200,
+    context: 'Privacy policy page, the body of “How we use it”.',
+    screen: 'legal',
+  },
+  'legal.share_heading': {
+    en: 'Who sees it',
+    maxLength: 80,
+    context: 'Privacy policy page, a section heading.',
+    screen: 'legal',
+  },
+  'legal.share_body': {
+    en: 'Our reservations staff. The companies that host this website and its database and send our emails process your details on our behalf and only on our instructions.',
+    maxLength: 1200,
+    context: 'Privacy policy page, the body of “Who sees it”: staff and processors (hosting, database, email).',
+    screen: 'legal',
+  },
+  'legal.keep_heading': {
+    en: 'How long we keep it',
+    maxLength: 80,
+    context: 'Privacy policy page, a section heading.',
+    screen: 'legal',
+  },
+  'legal.keep_body': {
+    en: 'We keep your contact details for up to 24 months after the date of your booking, then remove them. We keep only the date, time, party size and restaurant, without your name or contact details, for our statistics.',
+    maxLength: 1200,
+    context: 'Privacy policy page, the body of “How long we keep it”. The months must match the retention setting (booking_settings.pii_retention_months).',
+    screen: 'legal',
+  },
+  'legal.rights_heading': {
+    en: 'Your rights',
+    maxLength: 80,
+    context: 'Privacy policy page, a section heading.',
+    screen: 'legal',
+  },
+  'legal.rights_body': {
+    en: 'You may ask to see, correct or delete your details, or withdraw your consent, at any time. Write to {email} or call the restaurant. Withdrawing consent does not affect a booking already handled.',
+    maxLength: 1200,
+    vars: ['email'],
+    context: 'Privacy policy page, the body of “Your rights”. {email} is the contact address, shown as a link; keep it.',
+    screen: 'legal',
+  },
   // ── Booking emails (spec §10.4): email.<event>.<field>, shared labels under email.common. ──
   // Rendered in the reservation's language for guests and the recipient's for staff
   // (lib/server/email/booking/render.ts). Phase 7 edits them in /admin/content/emails.
@@ -445,11 +548,13 @@ export const STRING_KEYS = Object.keys(REGISTRY) as StringKey[];
 /** Same pattern as the CHECK on content_strings.key (migration 004). */
 export const KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
 
-/** Keys the browser needs: the reservation form's copy and its error messages. */
-export type ClientKey = Extract<StringKey, `error.${string}` | `booking.${string}`>;
+/** Keys the browser needs: the reservation form's copy and its error messages, and the policy link (form and footer). */
+export type ClientKey = Extract<StringKey, `error.${string}` | `booking.${string}` | 'legal.link'>;
 
 /** Keys the browser needs at first paint; passed to SiteProvider. Grow this list per component that moves to t(). */
-export const CLIENT_KEYS = STRING_KEYS.filter((k): k is ClientKey => k.startsWith('error.') || k.startsWith('booking.'));
+export const CLIENT_KEYS = STRING_KEYS.filter(
+  (k): k is ClientKey => k.startsWith('error.') || k.startsWith('booking.') || k === 'legal.link',
+);
 
 /** The registry's own text for a language other than English; only `vi`, and only where declared. */
 export function registryLocaleDefault(key: StringKey, locale: string): string | undefined {
```

Run: `npx vitest run lib/legal.test.ts lib/i18n/registry.test.ts`
Expected: PASS `Test Files  2 passed (2)`, `Tests  81 passed (81)` (hash `e4cc25f6…c5e9`, bằng hash spike guard đã ghi, vì chữ giữ nguyên).

- [ ] **Bước 5: Trang chính sách**

Trang đọc `lang()` như mọi trang khách và chỉ đọc chữ qua bộ đọc riêng có tag `content:legal` (spec §6.2: trình sửa `legal.*` của đợt 7 làm mới trang này mà không đụng chữ UI khác). Ngày "Last updated" định dạng theo UTC (ngày lịch, không để múi giờ máy chủ dời) và `en-GB` cho `en` (ngày trước tháng, như drawer).

Create `lib/server/content/legal.ts`:

```ts
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { TAGS } from '@/lib/cache-tags';
import { resolveStrings } from '@/lib/i18n/resolve';
import { PRIVACY_KEYS } from '@/lib/legal';
import { loadStringRows } from './strings.queries';

/**
 * The privacy policy's text in `locale` (DB override, else registry). Tagged
 * content:legal (spec §6.2), so the phase-7 editor that saves legal.* refreshes
 * this page without touching the rest of the UI strings; i18n:<locale> as for
 * every reader of one language.
 */
export async function getPrivacyStrings(locale: string) {
  'use cache';
  cacheLife('max');
  cacheTag(TAGS.contentLegal, TAGS.i18n(locale));

  const { defaultLocale, rows } = await loadStringRows(locale, PRIVACY_KEYS);
  return resolveStrings(rows, PRIVACY_KEYS, locale, defaultLocale);
}
```

Create `app/(site)/[lang]/(guarded)/privacy/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { lang } from 'next/root-params';
import { ViewMarker } from '@/components/site/ViewMarker';
import { CONTACT } from '@/lib/data';
import { formatMessage } from '@/lib/i18n/format';
import { DEFAULT_LOCALE, toBcp47 } from '@/lib/i18n/locales';
import { PRIVACY_POLICY_VERSION, PRIVACY_SECTIONS } from '@/lib/legal';
import { getPrivacyStrings } from '@/lib/server/content/legal';

/*
 * The guest privacy policy (spec §11, Law 91/2025/QH15), linked from the
 * reserve drawer's consent box and the footer. Text from legal.* (registry
 * now, content_strings from phase 7). Prerendered and cached like every guest
 * page: the (guarded) layout has already checked the language.
 */

async function strings() {
  return getPrivacyStrings((await lang()) ?? DEFAULT_LOCALE);
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await strings();
  return { title: `${t['legal.title']} — Furama Cuisine`, description: t['legal.intro'] };
}

/** A body whose {email} becomes a mailto link. */
function WithEmail({ template }: { template: string }) {
  const parts = template.split('{email}');
  if (parts.length < 2) return <>{template}</>;
  return (
    <>
      {parts[0]}
      <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
      {parts.slice(1).join(CONTACT.email)}
    </>
  );
}

export default async function PrivacyPage() {
  const locale = (await lang()) ?? DEFAULT_LOCALE;
  const t = await getPrivacyStrings(locale);
  // A calendar date: format it in UTC so the server's zone cannot move it. English reads day first, as the
  // booking form does ("Thu, 1 Oct"); other languages take their own order (phase 8).
  const updated = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : toBcp47(locale), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${PRIVACY_POLICY_VERSION}T00:00:00Z`));

  return (
    <ViewMarker view="other">
      <article className="shell legal">
        <h1>{t['legal.title']}</h1>
        <p className="legal-updated">{formatMessage(t['legal.updated'], { date: updated })}</p>
        <p>{t['legal.intro']}</p>
        {PRIVACY_SECTIONS.map(([heading, body]) => (
          <section key={heading}>
            <h2>{t[heading]}</h2>
            <p>
              <WithEmail template={t[body]} />
            </p>
          </section>
        ))}
      </article>
    </ViewMarker>
  );
}
```

Create `styles/legal.css`:

```css
/* The privacy policy page (app/(site)/[lang]/(guarded)/privacy). */

.legal {
  max-width: 720px;
  padding-top: clamp(120px, 14vw, 160px);
  padding-bottom: clamp(72px, 9vw, 120px);
  color: var(--ink);
}

.legal h1 {
  margin: 0;
  font-family: var(--serif);
  font-weight: 400;
  font-size: clamp(34px, 4.4vw, 52px);
  line-height: 1.1;
}

.legal-updated {
  margin: 12px 0 32px;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-soft);
}

.legal h2 {
  margin: 36px 0 10px;
  font-family: var(--serif);
  font-weight: 400;
  font-size: clamp(22px, 2.4vw, 28px);
}

.legal p {
  margin: 0;
  font-size: 15px;
  line-height: 1.75;
}

.legal a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}
```

Sửa `app/globals.css`:

```diff
diff --git a/app/globals.css b/app/globals.css
index 0ad866f..6ef9946 100644
--- a/app/globals.css
+++ b/app/globals.css
@@ -7,3 +7,4 @@
 @import '../styles/detail.css';
 @import '../styles/booking.css';
 @import '../styles/overlays.css';
+@import '../styles/legal.css';
```

- [ ] **Bước 6: Link ở chân trang, che nó khỏi spec visual, và kiểm prerender của trang**

Sửa `components/site/Footer.tsx`:

```diff
diff --git a/components/site/Footer.tsx b/components/site/Footer.tsx
index 8100684..90ceb1d 100644
--- a/components/site/Footer.tsx
+++ b/components/site/Footer.tsx
@@ -1,12 +1,14 @@
 'use client';
 
+import Link from 'next/link';
 import { CONTACT, SOCIALS } from '@/lib/data';
+import { privacyHref } from '@/lib/legal';
 import { useSite } from '@/components/site/SiteProvider';
 import { homeHref } from '@/lib/i18n/href';
 import { useReveal } from '@/lib/motion';
 
 export function Footer() {
-  const { goHomeTop, locale } = useSite();
+  const { goHomeTop, locale, strings } = useSite();
   const reveal = useReveal<HTMLDivElement>('fade');
 
   return (
@@ -50,6 +52,10 @@ export function Footer() {
           <a href={`mailto:${CONTACT.email}`} className="footer-strong">
             {CONTACT.email}
           </a>
+          {/* e2e/visual-added.css hides this link, so the pre-phase-5 baselines still compare pixel for pixel. */}
+          <Link href={privacyHref(locale)} className="footer-strong footer-legal">
+            {strings['legal.link']}
+          </Link>
         </div>
       </div>
 
```

Create `e2e/visual-added.css` (`display:none` để phần tử không chiếm chỗ: mọi thứ khác vẫn so từng pixel):

```css
/*
 * Elements added after the baselines were taken (e2e/__visual__/), hidden from
 * both visual specs so everything else still compares pixel for pixel. Each
 * takes no space when hidden; each has a functional E2E of its own.
 */
/* Phase 5: the footer's privacy-policy link (e2e/guest-guard.spec.ts). */
.footer-legal { display: none !important; }
```

Sửa `e2e/visual.spec.ts`:

```diff
diff --git a/e2e/visual.spec.ts b/e2e/visual.spec.ts
index 9e396d7..37e6e95 100644
--- a/e2e/visual.spec.ts
+++ b/e2e/visual.spec.ts
@@ -52,6 +52,6 @@ for (const [name, path] of Object.entries(PAGES)) {
     await prepare(page);
     await page.goto(path + SUFFIX);
     await settle(page);
-    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true, stylePath: './e2e/visual.css' });
+    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true, stylePath: ['./e2e/visual.css', './e2e/visual-added.css'] });
   });
 }
```

Sửa `e2e/visual-nojs.spec.ts` (spec này trước đây không có `stylePath`):

```diff
diff --git a/e2e/visual-nojs.spec.ts b/e2e/visual-nojs.spec.ts
index dd415d6..6c70115 100644
--- a/e2e/visual-nojs.spec.ts
+++ b/e2e/visual-nojs.spec.ts
@@ -16,6 +16,7 @@ for (const [name, path] of Object.entries(PAGES)) {
     await expect(page).toHaveScreenshot(`nojs-${name}.png`, {
       fullPage: true,
       mask: [page.locator('.hero-slides')],
+      stylePath: './e2e/visual-added.css',
     });
   });
 }
```

Sửa `scripts/check-prerender.mjs` (`/en/privacy` phải prerender đủ, `cacheLife('max')`, mang tag của layout cộng `content:legal`):

```diff
diff --git a/scripts/check-prerender.mjs b/scripts/check-prerender.mjs
index 3084095..adbc728 100644
--- a/scripts/check-prerender.mjs
+++ b/scripts/check-prerender.mjs
@@ -25,8 +25,11 @@ import { dirname, join, relative, sep } from 'node:path';
 const PAGES = {
   '/en': 'en',
   '/en/restaurants/taya-house': 'en/restaurants/taya-house',
+  '/en/privacy': 'en/privacy',
 };
 const TAGS = ['restaurants', 'i18n:en', 'locales', 'content:ui'];
+/** Tags a page carries beyond the layout's: the privacy policy's own reader (lib/server/content/legal.ts). */
+const PAGE_TAGS = { '/en/privacy': ['content:legal'] };
 const REVALIDATE = 2_592_000; // cacheLife('max'): 30 days
 const EXPIRE = 31_536_000; // 1 year
 
@@ -72,7 +75,7 @@ for (const [route, file] of Object.entries(PAGES)) {
   const meta = JSON.parse(readFileSync(join(dir, 'server', 'app', `${file}.meta`), 'utf8'));
   if (meta.postponed) problems.push(`${route} is only partially prerendered`);
   const tags = String(meta.headers?.['x-next-cache-tags'] ?? '').split(',');
-  for (const tag of TAGS) {
+  for (const tag of [...TAGS, ...(PAGE_TAGS[route] ?? [])]) {
     if (!tags.includes(tag)) problems.push(`${route} is missing the cache tag ${tag}`);
   }
 }
@@ -115,7 +118,9 @@ if (problems.length) {
   console.error(`Prerender and font check failed:\n- ${problems.join('\n- ')}`);
   process.exit(1);
 }
-console.log(`Prerender check passed: ${Object.keys(PAGES).join(', ')} (tags: ${TAGS.join(', ')}).`);
+console.log(
+  `Prerender check passed: ${Object.keys(PAGES).join(', ')} (tags: ${TAGS.join(', ')}; ${Object.entries(PAGE_TAGS).map(([route, tags]) => `${route} also ${tags.join(', ')}`).join('; ')}).`,
+);
 console.log(`Admin check passed: ${adminRoutes.map(([route]) => route).join(', ')} have no static shell.`);
 console.log(`Uncached check passed: ${UNCACHED.join(', ')} built as a route handler, not prerendered.`);
 console.log(`Font check passed: ${fontSummary}.`);
```

- [ ] **Bước 7: Kiểm rằng mặt nạ là cần thiết**

Sau khi build ở cổng kiểm tra (Bước 8), bỏ tạm dòng `stylePath: './e2e/visual-added.css',` khỏi `e2e/visual-nojs.spec.ts` và chạy visual (server ở 3211 như khối lệnh cổng kiểm tra). Expected: `4 failed`, `4 passed`; mỗi spec no-JS (home, taya-house, desktop và phone) lệch đúng link mới:

```
  ✘  1 [desktop] › e2e/visual-nojs.spec.ts:12:7 › @visual no-JS home (3.6s)
  ✘  2 [desktop] › e2e/visual-nojs.spec.ts:12:7 › @visual no-JS taya-house (2.2s)
  ✘  5 [phone] › e2e/visual-nojs.spec.ts:12:7 › @visual no-JS home (3.0s)
  ✘  6 [phone] › e2e/visual-nojs.spec.ts:12:7 › @visual no-JS taya-house (1.4s)
      132 pixels (ratio 0.01 of all image pixels) are different.
```

Trả dòng đó về; `git diff` của file phải giống Bước 6. Xóa `test-results/`.

- [ ] **Bước 8: Chạy cổng kiểm tra**

Expected:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo;
- `Test Files  63 passed (63)`, `Tests  769 passed (769)` (thêm `lib/legal.test.ts` 4 test, và 16 key mới qua test "is well formed" của registry);
- `Applied 7 migration(s).`; build thoát 0 và liệt kê `○ /en/privacy`; check-prerender in `Prerender check passed: /en, /en/restaurants/taya-house, /en/privacy (tags: restaurants, i18n:en, locales, content:ui; /en/privacy also content:legal).`;
- E2E `128 passed`; visual `8 passed`.

- [ ] **Bước 9: Commit**

```bash
git add "app/(site)/[lang]/(guarded)/privacy/page.tsx" app/globals.css components/site/Footer.tsx e2e/guest-guard.spec.ts e2e/visual-added.css e2e/visual-nojs.spec.ts e2e/visual.spec.ts lib/i18n/registry.ts lib/legal.test.ts lib/legal.ts lib/server/content/legal.ts scripts/check-prerender.mjs styles/legal.css
git commit -m "$(cat <<'EOF'
feat: add the privacy policy page and the consent copy, linked from the footer

/[lang]/privacy (spec §11, Law 91/2025/QH15) states who holds a guest's
details, what is collected, what it is used for, who sees it, how long it is
kept and how to ask for it back. Its text is the registry's legal.* keys,
read through a reader tagged content:legal so the phase-7 editor can refresh
it alone, and the page is prerendered like every guest page. The drawer's
notice and consent label are written now too (booking.privacy_notice,
booking.consent), English only until a reviewed Vietnamese text exists.

PRIVACY_POLICY_VERSION names the text a guest agrees to; a test pins it to a
hash of the English policy, notice and label, so editing any of them fails
CI until the version moves. The footer links the page on every guest page.
The link is hidden from the visual specs by e2e/visual-added.css, so the
baselines keep comparing pixel for pixel, and check-prerender now holds
/en/privacy to a full prerender with its content:legal tag.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```
---

### Task 9: Đồng ý, honeypot và giới hạn theo số điện thoại (server và drawer cùng lúc)

Ba lớp chặn của form khách, server và drawer trong cùng một task vì drawer cũ sẽ không gửi được đặt bàn nào khi server đòi `consent`:
- **Đồng ý** (spec §11, R17): ô bắt buộc dưới thông báo; zod `consent: z.literal(true)` → `consent_required`; đặt bàn lưu `consent_version` (= `PRIVACY_POLICY_VERSION`) và `consented_at`.
- **Honeypot** (spec §10.2 bước 1, R15): một ô "website" ngoài màn hình, `aria-hidden`, ngoài thứ tự Tab; có giá trị bất kỳ thì bước 1 của `submitReservation` từ chối trước khi đọc gì khác, bằng `bot_blocked` thấy được (kèm số gọi), không bao giờ giả thành công. zod `honeypot: z.literal('').optional()` là lớp thứ hai.
- **Giới hạn theo số điện thoại** (spec §10.2 bước 5, R14): tối đa `PHONE_DAY_LIMIT = 3` đặt bàn web `requested`/`confirmed` cho một `phone_e164` trong một `reserved_on`, mọi nhà hàng, đếm dưới khóa advisory `guest-phone:<e164>:<ngày>` lấy **trước** khóa ngày đặt bàn (quy tắc code 8). Khóa ngày theo từng nhà hàng nên không tuần tự hóa được một số đặt sáu nhà hàng cùng lúc; khóa riêng thì được.
- **R13**: email khách đúng một `@` ở cả hai phía (`GUEST_EMAIL` dùng chung cho `validate` và zod), vẫn sau `max(254, {abort:true})` của F1.

Câu từ chối `too_many_requests` và `bot_blocked` cần `{phone}`; server không gửi, nên drawer lấy số của điểm đến từ lịch của nhà hàng đang chọn (`errorParams`), còn `{limit}` lấy từ `DEFAULT_PARAMS`. Mọi E2E đặt bàn thật phải tick ô.

**Files:**
- Create: `components/overlays/Honeypot.tsx`
- Modify: `lib/booking.ts`, `lib/booking.test.ts`, `lib/booking/rules.ts`, `lib/booking-errors.ts`, `lib/booking-errors.test.ts`, `lib/i18n/registry.ts`, `lib/server/booking/input.ts`, `lib/server/booking/input.test.ts`, `lib/server/booking/lock.ts`, `lib/server/booking/create.ts`, `app/actions.ts`, `components/overlays/ReserveDrawer.tsx`, `components/site/SiteProvider.tsx`, `styles/overlays.css`, `test/integration/submit-reservation.test.ts`, `test/integration/email-outbox.test.ts`, `test/integration/booking-config.test.ts`, `test/integration/reservation-lifecycle.test.ts`, `test/guards/require-permission.guard.test.ts`, `e2e/guest-guard.spec.ts`, `e2e/booking-v2.spec.ts`, `e2e/booking-dates.spec.ts`, `e2e/booking-acceptance.spec.ts`, `e2e/admin-booking-settings.spec.ts`, `e2e/booking-email.spec.ts`

**Interfaces:**
- Consumes: `PRIVACY_POLICY_VERSION`, `privacyHref` (Task 8); registry `booking.privacy_notice`, `booking.consent`, `legal.link` (Task 8); cột `reservations.consent_version`/`consented_at` và `reservations_consent_check` (Task 1); `UPCOMING_STATUSES` (`lib/reservations/lifecycle.ts`); `calendarFor(calendar, restaurant)` (`lib/booking/client.ts`); `drainAfterCommit` (Task 4).
- Produces:
  - `lib/booking.ts`: `GUEST_EMAIL` (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`).
  - `lib/booking/rules.ts`: `PHONE_DAY_LIMIT = 3`.
  - `lib/server/booking/input.ts`: schema có `consent`, `honeypot`; `ReservationRequest.consentVersion: string`; `honeypotFilled(input: unknown): boolean`.
  - `lib/server/booking/lock.ts`: `lockGuestPhoneDay(client, phoneE164, date, options?)`; `lockBookingDay` giữ chữ ký và khóa `booking:<nhà hàng>:<ngày>` cũ; `pg_advisory_xact_lock` vẫn một chỗ gọi.
  - `BOOKING_ERROR_CODES` thêm `consent_required`, `too_many_requests`, `bot_blocked` (trước `unknown`); registry `error.consent_required`, `error.too_many_requests {limit, phone}`, `error.bot_blocked {phone}`.
  - `useSite()`: `consent`, `setConsent`, `honeypot`, `setHoneypot`; `errors.consent`.
  - Log `[booking] refused as a bot { by: 'honeypot' }` (không dữ liệu khách). Task 11 thêm `'botid'`.

- [ ] **Bước 1: Viết test**

`honeypotFilled` coi mọi giá trị khác `undefined`/`null`/`''` là bot, kể cả khoảng trắng và kiểu không phải chuỗi. Sửa `lib/server/booking/input.test.ts`:

```diff
diff --git a/lib/server/booking/input.test.ts b/lib/server/booking/input.test.ts
index b821948..599a223 100644
--- a/lib/server/booking/input.test.ts
+++ b/lib/server/booking/input.test.ts
@@ -1,5 +1,6 @@
 import { describe, expect, it } from 'vitest';
-import { parseReservationInput } from './input';
+import { PRIVACY_POLICY_VERSION } from '@/lib/legal';
+import { honeypotFilled, parseReservationInput } from './input';
 
 const valid = {
   restaurant: 'taya-house',
@@ -10,6 +11,8 @@ const valid = {
   phone: '0905 000 000',
   email: '',
   note: ' window seat ',
+  consent: true,
+  honeypot: '',
 };
 
 describe('parseReservationInput', () => {
@@ -27,6 +30,7 @@ describe('parseReservationInput', () => {
         email: null,
         note: 'window seat',
         locale: 'en',
+        consentVersion: PRIVACY_POLICY_VERSION,
       },
     });
   });
@@ -42,8 +46,14 @@ describe('parseReservationInput', () => {
     [{ phone: '12 34' }, 'invalid_phone'],
     [{ phone: '0000 0000 00' }, 'invalid_phone'],
     [{ email: 'a@b' }, 'invalid_email'],
+    // One "@" only (R13): the outbox could never send to it.
+    [{ email: 'a@b@c.vn' }, 'invalid_email'],
+    [{ email: 'an@home@example.com' }, 'invalid_email'],
     [{ note: 'x'.repeat(1001) }, 'unknown'],
     [{ locale: 'x'.repeat(36) }, 'unknown'],
+    [{ consent: false }, 'consent_required'],
+    [{ consent: undefined }, 'consent_required'],
+    [{ consent: 'true' }, 'consent_required'],
   ])('%j → %s', (over, code) => {
     expect(parseReservationInput({ ...valid, ...over })).toEqual({ ok: false, code });
   });
@@ -75,3 +85,36 @@ describe('parseReservationInput', () => {
     expect(ms).toBeLessThan(250);
   });
 });
+
+describe('consent (spec §11)', () => {
+  it('books only with the box ticked, and stamps the policy version this server shows', () => {
+    const { consent: _consent, ...unticked } = valid;
+    expect(parseReservationInput(unticked)).toEqual({ ok: false, code: 'consent_required' });
+    expect(parseReservationInput(valid)).toMatchObject({ ok: true, value: { consentVersion: PRIVACY_POLICY_VERSION } });
+  });
+
+  it('a field above the box still comes first (form order)', () => {
+    expect(parseReservationInput({ ...valid, phone: '12', consent: false })).toEqual({ ok: false, code: 'invalid_phone' });
+  });
+});
+
+describe('honeypotFilled (step 1)', () => {
+  it.each([
+    ['a URL', true, { ...valid, honeypot: 'http://spam.example' }],
+    ['a space', true, { ...valid, honeypot: ' ' }],
+    ['a number', true, { ...valid, honeypot: 0 }],
+    ['false', true, { ...valid, honeypot: false }],
+    ['empty', false, { ...valid, honeypot: '' }],
+    ['undefined', false, { ...valid, honeypot: undefined }],
+    ['null', false, { ...valid, honeypot: null }],
+    ['no field at all', false, (({ honeypot: _h, ...rest }) => rest)(valid)],
+    ['no object', false, null],
+    ['a string body', false, 'honeypot'],
+  ])('%s → %s', (_label, filled, input) => {
+    expect(honeypotFilled(input)).toBe(filled);
+  });
+
+  it('zod still refuses a filled one, should step 1 ever be skipped', () => {
+    expect(parseReservationInput({ ...valid, honeypot: 'x' })).toEqual({ ok: false, code: 'bot_blocked' });
+  });
+});
```

Sửa `lib/booking.test.ts` (form của `FIELD_MAX` giờ phải tick ô):

```diff
diff --git a/lib/booking.test.ts b/lib/booking.test.ts
index 9c9ae71..6979636 100644
--- a/lib/booking.test.ts
+++ b/lib/booking.test.ts
@@ -14,10 +14,15 @@ describe('validate', () => {
     expect(validate({ name: 'An', phone: '0905 000 000', email: '', note: '' })).toEqual({ name: true, phone: true, email: true });
     expect(validate({ name: ' A ', phone: '1234 567', email: 'a@b', note: '' })).toEqual({ name: false, phone: false, email: false });
   });
+
+  it('wants one "@" in an email, as the server does (R13)', () => {
+    expect(validate({ name: 'An', phone: '0905 000 000', email: 'a@b@c.vn', note: '' }).email).toBe(false);
+    expect(validate({ name: 'An', phone: '0905 000 000', email: 'an.nguyen@example.com.vn', note: '' }).email).toBe(true);
+  });
 });
 
 describe('FIELD_MAX', () => {
-  const form = { restaurant: 'taya-house', date: '2026-10-05', time: '19:00', guests: 2, name: 'An', phone: '0905 000 000', email: '', note: '' };
+  const form = { restaurant: 'taya-house', date: '2026-10-05', time: '19:00', guests: 2, name: 'An', phone: '0905 000 000', email: '', note: '', consent: true };
   // A valid value of exactly `n` characters for each field.
   const ofLength: Record<keyof BookingForm, (n: number) => string> = {
     name: (n) => 'a'.repeat(n),
```

Sửa `lib/booking-errors.test.ts`:

```diff
diff --git a/lib/booking-errors.test.ts b/lib/booking-errors.test.ts
index 39b17c4..fc3eefd 100644
--- a/lib/booking-errors.test.ts
+++ b/lib/booking-errors.test.ts
@@ -25,6 +25,14 @@ describe('bookingErrorMessage', () => {
     expect(bookingErrorMessage('party_too_large')).toBe('For more than 12 guests, please call us on +84 236 651 9999.');
   });
 
+  it('names the per-phone limit and the number to call, never accuses a refused bot (spec §10.2 steps 1 and 5)', () => {
+    expect(bookingErrorMessage('too_many_requests', { phone: '0859 555 759' })).toBe(
+      'This number already has 3 table requests for that day. To book more, please call us on 0859 555 759.',
+    );
+    expect(bookingErrorMessage('bot_blocked')).toBe('We could not accept this request online. Please call us on +84 236 651 9999 to book.');
+    expect(bookingErrorMessage('consent_required')).toBe('Please tick the box to agree to how we use your details.');
+  });
+
   it('says the restaurant is closed at that time (a whole day, or one meal), and that a sitting can no longer be booked for either clock rule', () => {
     expect(bookingErrorMessage('closed')).toBe('The restaurant is closed at that time — please choose another time or day.');
     expect(bookingErrorMessage('past')).toBe('That time can no longer be booked online — please choose a later time or another day.');
```

Bước 1 (honeypot), đồng ý, và bước 5 trong DB, gồm cuộc đua sáu nhà hàng từ một số, và một số đang chờ khóa của nó không giữ chân số khác ở cùng nhà hàng, ngày và giờ. Sửa `test/integration/submit-reservation.test.ts`:

```diff
diff --git a/test/integration/submit-reservation.test.ts b/test/integration/submit-reservation.test.ts
index 9f15a64..f6c8204 100644
--- a/test/integration/submit-reservation.test.ts
+++ b/test/integration/submit-reservation.test.ts
@@ -13,6 +13,7 @@ vi.mock('next/server', async (importOriginal) => ({
 
 import { submitReservation } from '@/app/actions';
 import { getPool } from '@/db/client';
+import { PRIVACY_POLICY_VERSION } from '@/lib/legal';
 import { createWebReservation } from '@/lib/server/booking/create';
 import { parseReservationInput, type ReservationRequest } from '@/lib/server/booking/input';
 
@@ -25,6 +26,8 @@ const request = {
   phone: '0905 000 000',
   email: '',
   note: '',
+  consent: true,
+  honeypot: '',
 };
 
 const sql = (text: string, values: unknown[] = []) => getPool().query(text, values);
@@ -275,4 +278,134 @@ describe.skipIf(!process.env.TEST_DATABASE_URL)('submitReservation v2 (database)
     );
     expect((await sql('SELECT count(*)::int AS n FROM reservation_events')).rows[0].n).toBe(2);
   });
+
+  describe('step 1: bots are refused before anything is read or written', () => {
+    const count = async () => (await sql('SELECT count(*)::int AS n FROM reservations')).rows[0].n;
+
+    it('a filled honeypot answers bot_blocked, and the log names only the check', async () => {
+      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
+      try {
+        expect(await submitReservation({ ...request, honeypot: 'https://cheap-pills.example' })).toEqual({ ok: false, code: 'bot_blocked' });
+        expect(warn).toHaveBeenCalledWith('[booking] refused as a bot', { by: 'honeypot' });
+        expect(JSON.stringify(warn.mock.calls)).not.toContain('0905');
+      } finally {
+        warn.mockRestore();
+      }
+      expect(await count()).toBe(0);
+      expect(afterTasks).toHaveLength(0);
+    });
+
+    it('comes before zod: a bot gets bot_blocked, never a hint about which field was wrong', async () => {
+      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
+      expect(await submitReservation({ honeypot: 'x', name: 'A' })).toEqual({ ok: false, code: 'bot_blocked' });
+      warn.mockRestore();
+    });
+  });
+
+  describe('consent (spec §11)', () => {
+    it('without the box ticked nothing is booked', async () => {
+      expect(await submitReservation({ ...request, consent: false })).toEqual({ ok: false, code: 'consent_required' });
+      const { consent: _c, ...unticked } = request;
+      expect(await submitReservation(unticked)).toEqual({ ok: false, code: 'consent_required' });
+      expect((await sql('SELECT count(*)::int AS n FROM reservations')).rows[0].n).toBe(0);
+    });
+
+    it('the booking keeps which policy the guest agreed to, and when', async () => {
+      await submitReservation(request);
+      // Fake timers move Date only: the database's now() is the real time.
+      const { rows } = await sql(`SELECT consent_version, consented_at > now() - interval '1 minute' AS recent FROM reservations`);
+      expect(rows).toEqual([{ consent_version: PRIVACY_POLICY_VERSION, recent: true }]);
+    });
+
+    it('the database keeps the version and the time together (reservations_consent_check)', async () => {
+      const insert = (version: string | null, at: string | null) =>
+        sql(
+          `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source, consent_version, consented_at)
+           VALUES ('FC-CONSENT1', 'taya-house', '2026-10-02', '19:00', 'Dinner', 2, 'G', 'x', '+84905123123', 'web', $1, $2)`,
+          [version, at],
+        );
+      await expect(insert('2026-10-02', null)).rejects.toMatchObject({ code: '23514', constraint: 'reservations_consent_check' });
+      await expect(insert(null, '2026-10-02T00:00:00Z')).rejects.toMatchObject({ code: '23514' });
+      await expect(insert('', '2026-10-02T00:00:00Z')).rejects.toMatchObject({ code: '23514' });
+      await insert(null, null); // a staff-entered or older booking
+    });
+  });
+
+  describe('step 5: at most three active web requests per phone number per date', () => {
+    const DINNERS = ['taya-house', 'the-fan', 'don-ciprianis', 'danaksara', 'pho-cuon', 'hura-izakaya'];
+    const at = (restaurant: string, over: Partial<typeof request> = {}) => submitReservation({ ...request, restaurant, ...over });
+
+    it('the fourth, at any restaurant, answers too_many_requests; another date, or another number, still books', async () => {
+      for (const r of DINNERS.slice(0, 3)) expect(await at(r)).toMatchObject({ ok: true });
+      // The same number written another way is the same number (phone_e164).
+      expect(await at(DINNERS[3], { phone: '+84 905 000 000' })).toEqual({ ok: false, code: 'too_many_requests' });
+      expect(await at(DINNERS[3], { time: '12:00' })).toEqual({ ok: false, code: 'too_many_requests' }); // lunch, same date
+      expect(await at(DINNERS[3], { date: '2026-10-03' })).toMatchObject({ ok: true });
+      expect(await at(DINNERS[3], { phone: '0905 000 001' })).toMatchObject({ ok: true });
+    });
+
+    it('comes before the rule checks: a fifth request for a closed sitting still hears about the limit', async () => {
+      for (const r of DINNERS.slice(0, 3)) await at(r);
+      expect(await at(DINNERS[3], { time: '15:00' })).toEqual({ ok: false, code: 'too_many_requests' });
+    });
+
+    it('cancelling one frees a place', async () => {
+      for (const r of DINNERS.slice(0, 3)) await at(r);
+      await sql(`UPDATE reservations SET status = 'cancelled', cancelled_at = now() WHERE restaurant_id = $1`, [DINNERS[0]]);
+      expect(await at(DINNERS[3])).toMatchObject({ ok: true });
+    });
+
+    it('counts only requested and confirmed web bookings of that date and number', async () => {
+      const seed = (i: number, over: { status?: string; source?: string; day?: string; e164?: string }) =>
+        sql(
+          `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source, status, consent_version, consented_at)
+           VALUES ($1, 'yum-food-village', $2, $3, 'Dinner', 2, 'G', 'x', $4, $5, $6, CASE WHEN $5 = 'web' THEN 'v' END, CASE WHEN $5 = 'web' THEN now() END)`,
+          [`FC-LIMIT00${i}`, over.day ?? '2026-10-02', `18:${String(i * 5).padStart(2, '0')}`, over.e164 ?? '+84905000000', over.source ?? 'web', over.status ?? 'requested'],
+        );
+      await seed(1, { status: 'cancelled' });
+      await seed(2, { status: 'declined' });
+      await seed(3, { status: 'seated' });
+      await seed(4, { status: 'no_show' });
+      await seed(5, { source: 'phone', status: 'confirmed' }); // staff-entered: not a web request
+      await seed(6, { day: '2026-10-03' });
+      await seed(7, { e164: '+84905000009' });
+      await seed(8, { status: 'confirmed' }); // this one counts
+      expect(await at(DINNERS[0])).toMatchObject({ ok: true });
+      expect(await at(DINNERS[1])).toMatchObject({ ok: true });
+      expect(await at(DINNERS[2])).toEqual({ ok: false, code: 'too_many_requests' });
+    });
+
+    it('holds when one number books six restaurants at once (the guest-phone lock; the booking-day locks differ)', async () => {
+      await warmPool(5);
+      const results = await Promise.all(DINNERS.map((r) => at(r)));
+      expect(results.filter((r) => r.ok)).toHaveLength(3);
+      expect(results.filter((r) => !r.ok).map((r) => (r.ok ? '' : r.code))).toEqual(Array(3).fill('too_many_requests'));
+      const { rows } = await sql(`SELECT count(*)::int AS n FROM reservations WHERE phone_e164 = '+84905000000'`);
+      expect(rows[0].n).toBe(3);
+    });
+
+    it('a number waiting on its own lock holds up no one else at that restaurant and date', async () => {
+      // Another instance holds the guest-phone lock of +84905000000 for 2 Oct (same key format as lock.ts).
+      const { Pool } = await import('pg');
+      const other = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
+      const holder = await other.connect();
+      try {
+        await holder.query('BEGIN');
+        await holder.query(`SELECT pg_advisory_xact_lock(hashtextextended('guest-phone:' || $1 || ':' || $2, 0))`, ['+84905000000', '2026-10-02']);
+        let settled = false;
+        const waiting = submitReservation(request).finally(() => {
+          settled = true;
+        });
+        // A different number, same restaurant, same date and time: not held up.
+        expect(await submitReservation({ ...request, phone: '0905 000 002' })).toMatchObject({ ok: true });
+        await new Promise((resolve) => setTimeout(resolve, 300));
+        expect(settled).toBe(false);
+        await holder.query('COMMIT');
+        expect(await waiting).toMatchObject({ ok: true });
+      } finally {
+        holder.release();
+        await other.end();
+      }
+    });
+  });
 });
```

Các helper khác dựng đặt bàn qua `parseReservationInput` phải tick ô. Test R13 của Task 3 giờ chứng minh hai lớp: form từ chối địa chỉ hai `@`, và bộ lọc của hàng đợi vẫn giữ đặt bàn khi một địa chỉ như vậy tới được nó (giá trị lưu từ trước, đưa thẳng vào `createWebReservation`). Sửa `test/integration/email-outbox.test.ts`:

```diff
diff --git a/test/integration/email-outbox.test.ts b/test/integration/email-outbox.test.ts
index 146bf6e..c2d4d57 100644
--- a/test/integration/email-outbox.test.ts
+++ b/test/integration/email-outbox.test.ts
@@ -1,7 +1,7 @@
 import { Pool } from 'pg';
 import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
 import { createWebReservation } from '@/lib/server/booking/create';
-import { parseReservationInput } from '@/lib/server/booking/input';
+import { parseReservationInput, type ReservationRequest } from '@/lib/server/booking/input';
 import { createStaffReservation, transitionReservation, type ReservationActor, type StaffBookingInput } from '@/lib/server/booking/reservations';
 import { LEASE_SECONDS, RETRY_DELAYS_MINUTES, drainOutbox, type DrainOptions } from '@/lib/server/email/drain';
 import { outboxEnv } from '@/lib/server/email/env';
@@ -23,13 +23,14 @@ const NOW = new Date('2026-10-02T10:00:00+07:00');
 let phoneSeq = 0;
 const nextPhone = () => `0905 ${String(200000 + ++phoneSeq).slice(0, 3)} ${String(200000 + phoneSeq).slice(3)}`;
 
-async function guestBooking(over: Record<string, unknown> = {}) {
+async function guestBooking(over: Record<string, unknown> = {}, stored: Partial<ReservationRequest> = {}) {
   const parsed = parseReservationInput({
     restaurant: 'taya-house', date: '2026-10-05', time: '19:00', guests: 2, name: 'Khách Web',
-    phone: nextPhone(), email: 'guest@example.com', note: '', locale: 'en', ...over,
+    phone: nextPhone(), email: 'guest@example.com', note: '', locale: 'en', consent: true, ...over,
   });
   if (!parsed.ok) throw new Error(parsed.code);
-  const result = await createWebReservation(parsed.value, { now: NOW, pool });
+  // `stored` stands for a value the form no longer lets through but an older row may hold.
+  const result = await createWebReservation({ ...parsed.value, ...stored }, { now: NOW, pool });
   if (!result.ok) throw new Error(result.code);
   return result;
 }
@@ -138,7 +139,9 @@ describe.skipIf(!TEST_DATABASE_URL)('email outbox (database + local SMTP sink)',
     });
 
     it('an address the outbox would refuse (two @) never fails the booking: it books, without a guest email (R13)', async () => {
-      const odd = await guestBooking({ email: 'an@home@example.com' });
+      // The form refuses it now (input.ts); the queue's own filter is the second line, for whatever reaches it.
+      expect(parseReservationInput({ restaurant: 'taya-house', date: '2026-10-05', time: '19:00', guests: 2, name: 'Khách Web', phone: nextPhone(), email: 'an@home@example.com', note: '', consent: true })).toEqual({ ok: false, code: 'invalid_email' });
+      const odd = await guestBooking({}, { email: 'an@home@example.com' });
       expect(odd.ok).toBe(true);
       expect((await outbox()).map((r) => r.event)).toEqual(['staff.new']);
       // A plain address full of letters a broken pattern could trip on ("s" for \s) is queued.
@@ -148,7 +151,7 @@ describe.skipIf(!TEST_DATABASE_URL)('email outbox (database + local SMTP sink)',
 
     it('a refused booking (duplicate) queues nothing', async () => {
       await guestBooking({ phone: '0905 777 777' });
-      const parsed = parseReservationInput({ restaurant: 'taya-house', date: '2026-10-05', time: '19:00', guests: 2, name: 'Khách Web', phone: '0905 777 777', email: 'x@example.com', note: '', locale: 'en' });
+      const parsed = parseReservationInput({ restaurant: 'taya-house', date: '2026-10-05', time: '19:00', guests: 2, name: 'Khách Web', phone: '0905 777 777', email: 'x@example.com', note: '', locale: 'en', consent: true });
       if (!parsed.ok) throw new Error(parsed.code);
       expect(await createWebReservation(parsed.value, { now: NOW, pool })).toEqual({ ok: false, code: 'duplicate' });
       expect((await outbox()).map((r) => r.to_email)).toEqual(['fb@furamavietnam.com', 'guest@example.com']);
```

Sửa `test/integration/booking-config.test.ts`:

```diff
diff --git a/test/integration/booking-config.test.ts b/test/integration/booking-config.test.ts
index f787c30..d109700 100644
--- a/test/integration/booking-config.test.ts
+++ b/test/integration/booking-config.test.ts
@@ -225,11 +225,11 @@ describe.skipIf(!TEST_DATABASE_URL)('booking configuration (database)', () => {
       expect(await saveAutoConfirm(pool, ACTOR, { restaurantId: 'danaksara', token: 'stale', autoConfirm: true })).toMatchObject({ ok: false, code: 'conflict' });
       expect(await saveAutoConfirm(pool, ACTOR, { restaurantId: 'danaksara', token: r!.token, autoConfirm: true })).toEqual({ ok: true, data: null });
       expect(await getRestaurantBooking(pool, 'danaksara')).toMatchObject({ autoConfirm: true });
-      const parsed = parseReservationInput({ restaurant: 'danaksara', date: '2026-10-05', time: '19:00', guests: 2, name: 'Khách Web', phone: '0905 444 555', email: '', note: '', locale: 'en' });
+      const parsed = parseReservationInput({ restaurant: 'danaksara', date: '2026-10-05', time: '19:00', guests: 2, name: 'Khách Web', phone: '0905 444 555', email: '', note: '', locale: 'en', consent: true });
       if (!parsed.ok) throw new Error(parsed.code);
       expect(await createWebReservation(parsed.value, { now: NOW, pool })).toMatchObject({ ok: true, status: 'confirmed' });
       // Elsewhere the default (off) still holds.
-      const other = parseReservationInput({ restaurant: 'don-ciprianis', date: '2026-10-05', time: '19:00', guests: 2, name: 'Khách Web', phone: '0905 444 555', email: '', note: '', locale: 'en' });
+      const other = parseReservationInput({ restaurant: 'don-ciprianis', date: '2026-10-05', time: '19:00', guests: 2, name: 'Khách Web', phone: '0905 444 555', email: '', note: '', locale: 'en', consent: true });
       if (!other.ok) throw new Error(other.code);
       expect(await createWebReservation(other.value, { now: NOW, pool })).toMatchObject({ ok: true, status: 'requested' });
       expect((await audit()).map((a) => [a.entity_type, a.entity_id, a.before, a.after])).toEqual([
```

Sửa `test/integration/reservation-lifecycle.test.ts`:

```diff
diff --git a/test/integration/reservation-lifecycle.test.ts b/test/integration/reservation-lifecycle.test.ts
index a65a273..931fd29 100644
--- a/test/integration/reservation-lifecycle.test.ts
+++ b/test/integration/reservation-lifecycle.test.ts
@@ -94,6 +94,7 @@ function guestRequest(guests: number): ReservationRequest {
     email: '',
     note: '',
     locale: 'en',
+    consent: true,
   });
   if (!parsed.ok) throw new Error(parsed.code);
   return parsed.value;
```

Sửa lời giải thích của action công khai trong `test/guards/require-permission.guard.test.ts` (danh sách vẫn 6 mục; Task 11 thêm BotID vào câu này):

```diff
diff --git a/test/guards/require-permission.guard.test.ts b/test/guards/require-permission.guard.test.ts
index 34c7a84..ea44307 100644
--- a/test/guards/require-permission.guard.test.ts
+++ b/test/guards/require-permission.guard.test.ts
@@ -12,7 +12,10 @@ import { actionPermissions, adminOnlyProblems, adminPluginCalls, adminPluginCall
  * The exceptions are public on purpose, and each says what protects it.
  */
 const PUBLIC_ACTIONS = new Map([
-  ['app/actions.ts#submitReservation', 'zod, the slot and window checks, the per-table unique index (spec §7.1)'],
+  [
+    'app/actions.ts#submitReservation',
+    'the honeypot first, then zod with consent, the per-phone daily limit, the slot and window checks, the per-table unique index (spec §7.1, §10.2)',
+  ],
   ['app/admin/(auth)/sign-in/actions.ts#signIn', 'Better Auth checks the password, rate-limited per IP in auth_rate_limit'],
   ['app/admin/(shell)/actions.ts#signOut', 'ends only the session of the cookie it is sent with'],
   ['app/admin/(auth)/accept-invite/actions.ts#acceptInvitation', 'the 256-bit, single-use, 7-day invitation token is the credential'],
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/server/booking/input.test.ts lib/booking.test.ts lib/booking-errors.test.ts test/integration/submit-reservation.test.ts test/integration/email-outbox.test.ts test/integration/booking-config.test.ts test/integration/reservation-lifecycle.test.ts`
Expected: FAIL `Test Files  5 failed | 2 passed (7)`, `Tests  30 failed | 115 passed (145)` (test "the database keeps the version and the time together" đã xanh: CHECK có từ Task 1):

```
 ❯ test/integration/email-outbox.test.ts (25 tests | 1 failed) 5899ms
       × an address the outbox would refuse (two @) never fails the booking: it books, without a guest email (R13) 17ms
 ❯ test/integration/submit-reservation.test.ts (27 tests | 9 failed) 915ms
       × a filled honeypot answers bot_blocked, and the log names only the check 9ms
       × comes before zod: a bot gets bot_blocked, never a hint about which field was wrong 2ms
       × without the box ticked nothing is booked 5ms
       × the booking keeps which policy the guest agreed to, and when 5ms
       × the fourth, at any restaurant, answers too_many_requests; another date, or another number, still books 13ms
       × comes before the rule checks: a fifth request for a closed sitting still hears about the limit 10ms
       × counts only requested and confirmed web bookings of that date and number 12ms
       × holds when one number books six restaurants at once (the guest-phone lock; the booking-day locks differ) 18ms
       × a number waiting on its own lock holds up no one else at that restaurant and date 314ms
 ❯ lib/server/booking/input.test.ts (37 tests | 18 failed) 21ms
     × {"email":"a@b@c.vn"} → invalid_email 1ms
     × {"consent":false} → consent_required 1ms
     × a URL → true 0ms
     …
 ❯ lib/booking.test.ts (7 tests | 1 failed) 10ms
     × wants one "@" in an email, as the server does (R13) 3ms
 ❯ lib/booking-errors.test.ts (7 tests | 1 failed) 4ms
     × names the per-phone limit and the number to call, never accuses a refused bot (spec §10.2 steps 1 and 5) 2ms
TypeError: Cannot read properties of undefined (reading 'replace')
TypeError: honeypotFilled is not a function
AssertionError: expected { ok: true, value: { …(10) } } to deeply equal { ok: false, code: 'invalid_email' }
AssertionError: expected { ok: true, data: { …(3) } } to deeply equal { ok: false, code: 'consent_required' }
AssertionError: expected [ { ok: true, data: { …(3) } }, …(5) ] to have a length of 3 but got 6
```

- [ ] **Bước 3: Viết E2E và chạy nó trên build hiện tại: phải đỏ**

`e2e/guest-guard.spec.ts` thêm ba test: không gửi gì khi chưa tick (và link chính sách mở tab mới, form giữ nguyên); honeypot không có trong cây trợ năng, không trên màn hình, Tab bỏ qua nó, và điền nó thì bị từ chối, 0 hàng; lần thứ tư trong ngày của một số nhận câu giới hạn với số của Dining House (Phố Cuốn, hôm nay + 13, ba đặt bàn web gieo sẵn cho một số mới; bản đồ dữ liệu E2E). Viết lại `e2e/guest-guard.spec.ts`:

```ts
import type { Page } from '@playwright/test';
import { GROUP_PHONE, mockAvailability } from './availability-mock';
import { HOME_PATH } from './paths';
import { newReference } from './reservation-fixtures';
import { expect, one, test } from './staff-fixtures';

/*
 * Phase 5's guard on the guest form (spec §10.2 steps 1 and 5, §11): the
 * privacy notice, the consent box and the policy page; the honeypot; the
 * per-phone limit's message. The footer link to the policy is hidden from the
 * visual specs by e2e/visual-added.css, so this spec is what checks it.
 * Pho Cuon's last open day (today + 13) is this spec's own: no other spec
 * books there.
 */

const CONSENT = 'I agree to Furama Cuisine using my details as described in the privacy policy.';
/* 10:00 on Friday 2 Oct in Da Nang. */
const NOW = new Date('2026-10-02T03:00:00Z');

test.use({ reducedMotion: 'reduce' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

/** The drawer on mocked availability, a slot chosen and the details typed in. */
async function filledDrawer(page: Page, phone = '0905 000 000') {
  await page.clock.setFixedTime(NOW);
  await mockAvailability(page, { today: () => '2026-10-02', now: () => NOW.toISOString() });
  await page.goto(HOME_PATH);
  await page.getByRole('button', { name: 'RESERVE', exact: true }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  await drawer.locator('.daystrip .day[data-state="open"]').nth(3).click();
  await drawer.locator('.slot:not([disabled])').first().click();
  await drawer.getByLabel('Full name *', { exact: true }).fill('Nguyễn Minh Anh');
  await drawer.getByLabel('Phone *', { exact: true }).fill(phone);
  return drawer;
}

/** Server Action POSTs the page sends from now on. */
function actionPosts(page: Page) {
  const posts: { headers: Record<string, string> }[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.headers()['next-action']) posts.push({ headers: r.headers() });
  });
  return posts;
}

test('nothing is sent until the consent box is ticked; the notice links the policy in a new tab', async ({ page }) => {
  const drawer = await filledDrawer(page);
  const posts = actionPosts(page);
  const box = drawer.getByRole('checkbox', { name: CONSENT });
  await expect(box).not.toBeChecked();
  await expect(box).toHaveAccessibleDescription(/only to arrange this booking/);

  await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
  await expect(drawer.getByText('Please tick the box to agree to how we use your details.')).toBeVisible();
  await expect(box).toHaveAttribute('aria-invalid', 'true');
  expect(posts).toHaveLength(0);

  await box.check();
  await expect(drawer.getByText('Please tick the box to agree to how we use your details.')).toHaveCount(0);

  const link = drawer.getByRole('link', { name: 'Privacy policy' });
  await expect(link).toHaveAttribute('href', '/en/privacy');
  const [policy] = await Promise.all([page.waitForEvent('popup'), link.click()]);
  await expect(policy.getByRole('heading', { level: 1 })).toHaveText('Privacy policy');
  // The form keeps what was typed: the policy opened beside it.
  await expect(drawer.getByLabel('Full name *', { exact: true })).toHaveValue('Nguyễn Minh Anh');
  await expect(box).toBeChecked();
});

test('the honeypot is invisible to people and screen readers, out of the tab order, and a filled one is refused', async ({ page }) => {
  const digits = String(Date.now()).slice(-6);
  const phone = `0905 ${digits.slice(0, 3)} ${digits.slice(3)}`;
  const drawer = await filledDrawer(page, phone);
  await drawer.getByRole('checkbox', { name: CONSENT }).check();

  // Not in the accessibility tree, not on screen, not reached by Tab.
  await expect(drawer.getByRole('textbox', { name: 'Website' })).toHaveCount(0);
  expect(await drawer.ariaSnapshot()).not.toContain('Website');
  const trap = drawer.locator('input[name="website"]');
  await expect(trap).not.toBeInViewport();
  await drawer.getByLabel('Special requests', { exact: true }).focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name)).not.toBe('website');
  await expect(drawer.getByRole('link', { name: 'Privacy policy' })).toBeFocused();

  // A script that fills every field it finds.
  const posts = actionPosts(page);
  await trap.fill('https://spam.example', { force: true });
  await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
  // Never a fake success (R15): the guest is told, with the restaurant's number to call.
  await expect(drawer.getByRole('alert')).toHaveText(`We could not accept this request online. Please call us on ${GROUP_PHONE.display} to book.`);
  expect(posts).toHaveLength(1);
  expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM reservations WHERE phone_e164 = $1`, [`+84905${digits}`]))!.n).toBe(0);
});

test('a fourth request for one day from one number gets the limit and the restaurant’s own number to call', async ({ page }) => {
  // Pho Cuon (Dining House) on its last open day: three active web requests for one number are already in.
  const digits = String(Date.now()).slice(-6);
  const phone = `0906 ${digits.slice(0, 3)} ${digits.slice(3)}`;
  const e164 = `+84906${digits}`;
  const date = (await one<{ d: string }>(`SELECT to_char((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + 13, 'YYYY-MM-DD') AS d`))!.d;
  for (const [i, time] of ['18:00', '18:30', '20:00'].entries()) {
    await one(
      `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source, status, consent_version, consented_at)
       VALUES ($1, 'pho-cuon', $2::date, $3, 'Dinner', 2, 'Khách E2E', $4, $5, 'web', $6, '2026-10-02', now())`,
      [newReference(), date, time, phone, e164, i === 0 ? 'confirmed' : 'requested'],
    );
  }
  await page.goto(HOME_PATH);
  await page.locator('.rcard:visible', { hasText: 'Phố Cuốn' }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  await drawer.locator('.daystrip .day[data-state="open"]').last().click();
  await drawer.locator('.slot:not([disabled])').last().click();
  await drawer.getByLabel('Full name *', { exact: true }).fill('Khách Thứ Tư');
  await drawer.getByLabel('Phone *', { exact: true }).fill(phone);
  await drawer.getByRole('checkbox', { name: CONSENT }).check();
  await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
  await expect(drawer.getByRole('alert')).toHaveText(
    'This number already has 3 table requests for that day. To book more, please call us on 0859 555 759.',
  );
  expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM reservations WHERE phone_e164 = $1`, [e164]))!.n).toBe(3);
});

test('the privacy policy page, from the footer', async ({ page }) => {
  await page.goto(HOME_PATH);
  await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy policy' }).click();
  await expect(page).toHaveURL(/\/en\/privacy$/);
  await expect(page).toHaveTitle('Privacy policy — Furama Cuisine');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy policy');
  await expect(page.getByText('Last updated 2 October 2026')).toBeVisible();
  // Scoped to main: the chrome's booking bar has a heading of its own on every guest page.
  await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText([
    'What we collect',
    'How we use it',
    'Who sees it',
    'How long we keep it',
    'Your rights',
  ]);
  await expect(page.getByRole('main').getByRole('link', { name: 'fb@furamavietnam.com' })).toHaveAttribute('href', 'mailto:fb@furamavietnam.com');
});
```

Mọi E2E đặt bàn thật tick ô (`fillDetails` của `booking-v2` tick luôn, nên các test đường lỗi của nó vẫn tới được phần kiểm availability):

```diff
diff --git a/e2e/booking-v2.spec.ts b/e2e/booking-v2.spec.ts
index 9a1c215..2629b20 100644
--- a/e2e/booking-v2.spec.ts
+++ b/e2e/booking-v2.spec.ts
@@ -226,6 +226,7 @@ async function abortServerActions(page: Page) {
 async function fillDetails(drawer: Locator) {
   await drawer.getByLabel('Full name *', { exact: true }).fill('Nguyễn Minh Anh');
   await drawer.getByLabel('Phone *', { exact: true }).fill('0905 000 000');
+  await drawer.getByRole('checkbox', { name: 'I agree to Furama Cuisine using my details as described in the privacy policy.' }).check();
 }
 
 test('when the dates cannot load, the guest is told, REQUEST BOOKING says so, and Try again recovers', async ({ page }) => {
@@ -242,8 +243,7 @@ test('when the dates cannot load, the guest is told, REQUEST BOOKING says so, an
   await expect(drawer.locator('.daystrip')).toHaveCount(0);
 
   // Valid details and no date to book: the button answers rather than doing nothing.
-  await drawer.getByLabel('Full name *', { exact: true }).fill('Nguyễn Minh Anh');
-  await drawer.getByLabel('Phone *', { exact: true }).fill('0905 000 000');
+  await fillDetails(drawer);
   await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
   await expect(foot(drawer).getByRole('alert')).toHaveText(NETWORK);
 
@@ -376,6 +376,7 @@ test('books a table against the real availability API', async ({ page }) => {
   await drawer.getByLabel('Full name *', { exact: true }).fill('Nguyễn Minh Anh');
   const digits = String(Date.now()).slice(-6);
   await drawer.getByLabel('Phone *', { exact: true }).fill(`0905 ${digits.slice(0, 3)} ${digits.slice(3)}`);
+  await drawer.getByRole('checkbox', { name: 'I agree to Furama Cuisine using my details as described in the privacy policy.' }).check();
   await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
 
   await expect(drawer.locator('.drawer-ref')).toHaveText(/^FC-[0-9A-HJKMNP-TV-Z]{8}$/);
```

```diff
diff --git a/e2e/booking-dates.spec.ts b/e2e/booking-dates.spec.ts
index 72740ec..fa7a20b 100644
--- a/e2e/booking-dates.spec.ts
+++ b/e2e/booking-dates.spec.ts
@@ -115,6 +115,7 @@ test('submitting after the chosen sitting has closed explains why and moves the
   await page.locator('.slot', { hasText: '19:00' }).first().click();
   await page.getByLabel('Full name *').fill('Nguyễn Minh Anh');
   await page.getByLabel('Phone *').fill('0905 000 000');
+  await page.getByRole('checkbox', { name: 'I agree to Furama Cuisine using my details as described in the privacy policy.' }).check();
 
   serverNow = new Date('2026-10-02T11:45:00Z');
   await page.clock.setFixedTime(serverNow);
```

```diff
diff --git a/e2e/booking-acceptance.spec.ts b/e2e/booking-acceptance.spec.ts
index 88edcfd..75d4b78 100644
--- a/e2e/booking-acceptance.spec.ts
+++ b/e2e/booking-acceptance.spec.ts
@@ -70,6 +70,7 @@ test('A1. concurrent bookings never exceed capacity: eight replays of a guest’
   const digits = String(Date.now()).slice(-5);
   const phone = `0907 ${digits.slice(0, 3)} ${digits.slice(3)}0`; // ten digits, the last one 0
   await drawer.getByLabel('Phone *', { exact: true }).fill(phone);
+  await drawer.getByRole('checkbox', { name: 'I agree to Furama Cuisine using my details as described in the privacy policy.' }).check();
   const sent = guest.waitForRequest((r) => r.method() === 'POST' && !!r.headers()['next-action']);
   await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
   const request = await sent;
```

```diff
diff --git a/e2e/admin-booking-settings.spec.ts b/e2e/admin-booking-settings.spec.ts
index 9362789..1e64f23 100644
--- a/e2e/admin-booking-settings.spec.ts
+++ b/e2e/admin-booking-settings.spec.ts
@@ -105,6 +105,7 @@ test('the Admin turns auto-confirm on for one restaurant: a guest’s booking th
     await drawer.getByLabel('Full name *', { exact: true }).fill('Khách Tự Xác Nhận');
     const digits = String(Date.now()).slice(-6);
     await drawer.getByLabel('Phone *', { exact: true }).fill(`0906 ${digits.slice(0, 3)} ${digits.slice(3)}`);
+    await drawer.getByRole('checkbox', { name: 'I agree to Furama Cuisine using my details as described in the privacy policy.' }).check();
     await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
     const reference = (await drawer.locator('.drawer-ref').textContent()) ?? '';
     expect(reference).toMatch(/^FC-[0-9A-HJKMNP-TV-Z]{8}$/);
```

```diff
diff --git a/e2e/booking-email.spec.ts b/e2e/booking-email.spec.ts
index d4680a4..51f8c55 100644
--- a/e2e/booking-email.spec.ts
+++ b/e2e/booking-email.spec.ts
@@ -48,6 +48,7 @@ async function bookCafeIndochine(page: Page, guest: string): Promise<string> {
   const digits = String(Date.now()).slice(-6);
   await drawer.getByLabel('Phone *', { exact: true }).fill(`0906 ${digits.slice(0, 3)} ${digits.slice(3)}`);
   await drawer.getByLabel('Email', { exact: true }).fill(guest);
+  await drawer.getByRole('checkbox', { name: 'I agree to Furama Cuisine using my details as described in the privacy policy.' }).check();
   await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
   await expect(drawer.locator('.drawer-ref')).toHaveText(/^FC-[0-9A-HJKMNP-TV-Z]{8}$/);
   return (await drawer.locator('.drawer-ref').textContent()) ?? '';
```

Cất tạm các file ngoài `e2e/`, build, chạy `e2e/guest-guard.spec.ts --project=desktop`. Expected: `3 failed`, `1 passed` (trang chính sách của Task 8):

```
  ✘  1 [desktop] › e2e/guest-guard.spec.ts:49:5 › nothing is sent until the consent box is ticked; the notice links the policy in a new tab (5.6s)
  ✘  2 [desktop] › e2e/guest-guard.spec.ts:73:5 › the honeypot is invisible to people and screen readers, out of the tab order, and a filled one is refused (30.2s)
  ✘  3 [desktop] › e2e/guest-guard.spec.ts:99:5 › a fourth request for one day from one number gets the limit and the restaurant’s own number to call (30.2s)
  ✓  4 [desktop] › e2e/guest-guard.spec.ts:128:5 › the privacy policy page, from the footer (305ms)
    Error: expect(locator).not.toBeChecked() failed
    Error: element(s) not found
      - waiting for getByRole('dialog', { name: 'Reserve a table' }).getByRole('checkbox', { name: 'I agree to Furama Cuisine using my details as described in the privacy policy.' })
```

Lấy lại các file đã cất.

- [ ] **Bước 4: Hằng, mẫu email, mã lỗi và chữ**

Sửa `lib/booking.ts` (một mẫu cho cả hai phía, R13):

```diff
diff --git a/lib/booking.ts b/lib/booking.ts
index bb059a1..d60c80d 100644
--- a/lib/booking.ts
+++ b/lib/booking.ts
@@ -31,11 +31,18 @@ export const fmtDay = (d: IsoDate) => formatDay(d).label;
 export const findRestaurant = (restaurants: Restaurant[], id: string) =>
   restaurants.find((r) => r.id === id);
 
+/**
+ * One "@" in an email (R13), as lib/server/booking/input.ts checks it: the
+ * outbox stores only such an address, so a guest is never told a booking went
+ * through with an address no email can reach.
+ */
+export const GUEST_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
+
 export function validate(form: BookingForm) {
   return {
     name: form.name.trim().length >= 2,
     phone: form.phone.replace(/\D/g, '').length >= 8,
-    email: !form.email.trim() || /^\S+@\S+\.\S+$/.test(form.email.trim()),
+    email: !form.email.trim() || GUEST_EMAIL.test(form.email.trim()),
   };
 }
 
```

Sửa `lib/booking/rules.ts`:

```diff
diff --git a/lib/booking/rules.ts b/lib/booking/rules.ts
index d47f7b2..95890e0 100644
--- a/lib/booking/rules.ts
+++ b/lib/booking/rules.ts
@@ -15,6 +15,13 @@ export const HOLDING_STATUSES = ['requested', 'confirmed', 'seated'] as const;
 export const RESERVATION_STATUSES = ['requested', 'confirmed', 'seated', 'no_show', 'cancelled', 'declined'] as const;
 export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
 
+/**
+ * Spec §10.2 step 5 (R14): the active (requested or confirmed) web requests
+ * one phone number may hold for one date, across every restaurant. The guest
+ * form's error.too_many_requests names it as {limit}.
+ */
+export const PHONE_DAY_LIMIT = 3;
+
 /** The gaps between seatings a service period may use (migration 006's CHECK on interval_min). */
 export const SLOT_INTERVALS = [15, 20, 30, 45, 60, 90, 120] as const;
 
```

Sửa `lib/booking-errors.ts` (`DEFAULT_ERROR_STRINGS` đánh chỉ mục registry theo từng mã lúc biên dịch: một mã thiếu key là lỗi kiểu):

```diff
diff --git a/lib/booking-errors.ts b/lib/booking-errors.ts
index d44154c..d0ee8fb 100644
--- a/lib/booking-errors.ts
+++ b/lib/booking-errors.ts
@@ -3,6 +3,7 @@
  * codes; the browser turns them into copy. The copy lives in the content
  * registry (lib/i18n/registry.ts) as error.<code>, so the DB can override it.
  */
+import { PHONE_DAY_LIMIT } from '@/lib/booking/rules';
 import { CONTACT } from '@/lib/data';
 import { formatMessage } from '@/lib/i18n/format';
 import { REGISTRY } from '@/lib/i18n/registry';
@@ -19,6 +20,9 @@ export const BOOKING_ERROR_CODES = [
   'full',
   'closed',
   'duplicate',
+  'consent_required',
+  'too_many_requests',
+  'bot_blocked',
   'unknown',
   'network',
 ] as const;
@@ -34,8 +38,17 @@ export const DEFAULT_ERROR_STRINGS = Object.fromEntries(
   BOOKING_ERROR_CODES.map((code) => [`error.${code}`, REGISTRY[`error.${code}`].en]),
 ) as ErrorStrings;
 
-/** Used when a message arrives without its params (the server always sends them for slot_unavailable and party_too_large). */
-const DEFAULT_PARAMS: Record<string, string> = { restaurant: 'The restaurant', max: '12', phone: CONTACT.resortPhoneLabel };
+/**
+ * Used when a message arrives without its params (the server always sends them
+ * for slot_unavailable and party_too_large). The drawer passes the chosen
+ * restaurant's group phone ahead of these, so {phone} names the right desk.
+ */
+const DEFAULT_PARAMS: Record<string, string> = {
+  restaurant: 'The restaurant',
+  max: '12',
+  limit: String(PHONE_DAY_LIMIT),
+  phone: CONTACT.resortPhoneLabel,
+};
 
 export function bookingErrorMessage(
   code: BookingErrorCode,
```

Sửa `lib/i18n/registry.ts` (`bot_blocked` không bao giờ buộc tội, luôn cho số gọi):

```diff
diff --git a/lib/i18n/registry.ts b/lib/i18n/registry.ts
index 3484152..bf920e8 100644
--- a/lib/i18n/registry.ts
+++ b/lib/i18n/registry.ts
@@ -106,6 +106,29 @@ export const REGISTRY = {
       'A closure, or a day without service, covers the chosen date, or only the chosen meal while another meal that day still takes bookings. Must read right for both.',
     screen: 'ui-text',
   },
+  'error.consent_required': {
+    en: 'Please tick the box to agree to how we use your details.',
+    maxLength: 140,
+    context:
+      'Under the consent checkbox of the reservation form, when the guest sends the request without ticking it (spec §11). Names the box, not the law.',
+    screen: 'ui-text',
+  },
+  'error.too_many_requests': {
+    en: 'This number already has {limit} table requests for that day. To book more, please call us on {phone}.',
+    maxLength: 160,
+    vars: ['limit', 'phone'],
+    context:
+      'One phone number already holds the most active online requests allowed for that date, across all restaurants (spec §10.2 step 5). {limit} is that number, {phone} the restaurant’s number; keep both.',
+    screen: 'ui-text',
+  },
+  'error.bot_blocked': {
+    en: 'We could not accept this request online. Please call us on {phone} to book.',
+    maxLength: 140,
+    vars: ['phone'],
+    context:
+      'The request looked automated (bot protection) and was refused. A real guest may see it: never accuse, always give the phone. {phone} is the restaurant’s number; keep it.',
+    screen: 'ui-text',
+  },
   'error.unknown': {
     en: 'Something went wrong with your request. Please try again.',
     maxLength: 140,
```

- [ ] **Bước 5: Parser, khóa theo số điện thoại, INSERT**

Sửa `lib/server/booking/input.ts` (`consent` đứng sau `note` trong `FIELD_CODES`, nên một ô phía trên vẫn báo trước: thứ tự của form):

```diff
diff --git a/lib/server/booking/input.ts b/lib/server/booking/input.ts
index 5c580c4..d0d1f34 100644
--- a/lib/server/booking/input.ts
+++ b/lib/server/booking/input.ts
@@ -1,12 +1,14 @@
 import 'server-only';
 import * as z from 'zod';
+import { GUEST_EMAIL } from '@/lib/booking';
 import type { BookingErrorCode } from '@/lib/booking-errors';
+import { PRIVACY_POLICY_VERSION } from '@/lib/legal';
 import { toE164 } from '@/lib/phone';
 import { isValidIsoDate, type IsoDate } from '@/lib/venue-time';
 
 /*
  * Step 2 of submitReservation (spec §10.2): the shape of what the reserve
- * drawer sends. It arrives over the wire, so nothing is trusted; a field that
+ * drawer sends, the consent box included (spec §11). It arrives over the wire, so nothing is trusted; a field that
  * fails maps to the error code the guest form already knows. Rules that need
  * the database (window, lead time, max_party, capacity) run later, in the
  * transaction, through resolveDay.
@@ -34,15 +36,19 @@ const schema = z.object({
     .trim()
     .max(40, { abort: true })
     .refine((p) => p.length <= 40 && p.replace(/\D/g, '').length >= 8),
-  // The guest form's own check (lib/booking.ts validate), so the two agree.
+  // The guest form's own check (lib/booking.ts validate), so the two agree: one "@" (R13).
   email: z
     .string()
     .trim()
     .max(254, { abort: true })
-    .refine((e) => e === '' || (e.length <= 254 && /^\S+@\S+\.\S+$/.test(e))),
+    .refine((e) => e === '' || (e.length <= 254 && GUEST_EMAIL.test(e))),
   note: z.string().trim().max(1000),
   /** The URL locale the guest booked in; unknown or disabled codes fall back to the default. */
   locale: z.string().max(35).optional(),
+  /** The privacy consent box (spec §11): only a ticked box books. */
+  consent: z.literal(true),
+  /** The drawer's hidden field; step 1 (honeypotFilled) has already refused anything but empty. */
+  honeypot: z.literal('').optional(),
 });
 
 /** First failing field → the code the drawer shows. Order follows the form, top to bottom. */
@@ -55,7 +61,9 @@ const FIELD_CODES: [field: string, code: BookingErrorCode][] = [
   ['phone', 'invalid_phone'],
   ['email', 'invalid_email'],
   ['note', 'unknown'],
+  ['consent', 'consent_required'],
   ['locale', 'unknown'],
+  ['honeypot', 'bot_blocked'],
 ];
 
 export type ReservationRequest = {
@@ -71,6 +79,8 @@ export type ReservationRequest = {
   email: string | null;
   note: string | null;
   locale: string;
+  /** The privacy policy version the guest agreed to (lib/legal.ts), stored on the booking. */
+  consentVersion: string;
 };
 
 export type ParseResult = { ok: true; value: ReservationRequest } | { ok: false; code: BookingErrorCode };
@@ -98,6 +108,20 @@ export function parseReservationInput(input: unknown): ParseResult {
       email: v.email || null,
       note: v.note || null,
       locale: v.locale ?? 'en',
+      // The version this server shows; the box links to that page.
+      consentVersion: PRIVACY_POLICY_VERSION,
     },
   };
 }
+
+/**
+ * Step 1 of submitReservation, before zod: the drawer's hidden field
+ * (components/overlays/Honeypot.tsx) came back with something in it. People
+ * never see or reach it, so any value at all (even spaces) means a script
+ * filled every field it found.
+ */
+export function honeypotFilled(input: unknown): boolean {
+  if (typeof input !== 'object' || input === null || !('honeypot' in input)) return false;
+  const value = (input as { honeypot: unknown }).honeypot;
+  return value !== undefined && value !== null && value !== '';
+}
```

Viết lại `lib/server/booking/lock.ts` (một hàm khóa chung; khóa ngày giữ đúng chuỗi khóa cũ, nên các test và đường của nhân viên đợt 4 không đổi):

```ts
import 'server-only';
import type { PoolClient } from 'pg';
import type { IsoDate } from '@/lib/venue-time';

/*
 * The transaction-scoped advisory locks of the booking paths, and the only
 * place that calls pg_advisory_xact_lock. Both are released at COMMIT or
 * ROLLBACK and both give up after lock_timeout with 55P03, which reaches the
 * guest as error.network: a stuck holder must not queue a whole day (and the
 * pool's 5 connections) forever.
 *
 * Lock order, so two transactions can never wait on each other in a circle:
 * a guest submit takes its phone lock first, then the booking-day lock; every
 * other path takes the booking-day lock only. At most one lock of each kind
 * per transaction.
 */

type LockOptions = { timeout?: string };

async function advisoryLock(client: PoolClient, key: string, { timeout = '5s' }: LockOptions): Promise<void> {
  // set_config(…, true) is SET LOCAL with a bind parameter.
  await client.query(`SELECT set_config('lock_timeout', $1, true)`, [timeout]);
  // hashtextextended → bigint, the key space of pg_advisory_xact_lock.
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [key]);
}

/**
 * The one booking-day lock (spec §10.2 step 6). Every write that takes covers
 * (guest submit, staff create, an edit that moves or grows a booking) calls
 * this first, on the client of its transaction, and only then reads the rules
 * and the covers. One key for every path, or guest and staff writes would
 * never wait for each other.
 */
export function lockBookingDay(client: PoolClient, restaurantId: string, date: IsoDate, options: LockOptions = {}): Promise<void> {
  return advisoryLock(client, `booking:${restaurantId}:${date}`, options);
}

/**
 * The guest phone limit's lock (spec §10.2 step 5, R14): one guest number on
 * one date, across every restaurant. The booking-day lock cannot serialise
 * the count, because the same number may book two restaurants at once.
 */
export function lockGuestPhoneDay(client: PoolClient, phoneE164: string, date: IsoDate, options: LockOptions = {}): Promise<void> {
  return advisoryLock(client, `guest-phone:${phoneE164}:${date}`, options);
}
```

Sửa `lib/server/booking/create.ts` (đếm dưới khóa số điện thoại, trước khóa ngày; `reservations_phone_idx (phone_e164, reserved_on)` của 006 phục vụ câu đếm):

```diff
diff --git a/lib/server/booking/create.ts b/lib/server/booking/create.ts
index a813171..0ed6e05 100644
--- a/lib/server/booking/create.ts
+++ b/lib/server/booking/create.ts
@@ -2,22 +2,26 @@ import 'server-only';
 import type { Pool, PoolClient } from 'pg';
 import { getPool } from '@/db/client';
 import { resolveDay } from '@/lib/booking/resolve-day';
+import { PHONE_DAY_LIMIT } from '@/lib/booking/rules';
 import { slotVerdict } from '@/lib/booking/slot-code';
 import type { BookingErrorCode } from '@/lib/booking-errors';
+import { UPCOMING_STATUSES } from '@/lib/reservations/lifecycle';
 import { outboxEnv } from '@/lib/server/email/env';
 import { queueWebBookingEmails } from '@/lib/server/email/outbox';
 import { newReference } from '@/lib/server/reference';
 import { venueNow, type IsoDate } from '@/lib/venue-time';
 import type { ReservationRequest } from './input';
-import { lockBookingDay } from './lock';
+import { lockBookingDay, lockGuestPhoneDay } from './lock';
 import { loadBookedCovers, loadRestaurantRules } from './rules';
 
 /*
- * Step 6 of submitReservation (spec §10.2): one transaction that takes the
- * booking-day lock, re-reads the rules and the covers, re-runs resolveDay,
- * and inserts the booking with its 'created' event and its email_outbox rows
- * (staff.new, then guest.ack or guest.confirmed). Nothing is sent here; the
- * action drains `outboxIds` once this has committed (step 7).
+ * Steps 5 and 6 of submitReservation (spec §10.2): one transaction that
+ * counts the number's active requests for the date under the guest-phone
+ * lock, then takes the booking-day lock, re-reads the rules and the covers,
+ * re-runs resolveDay, and inserts the booking (with the policy version the
+ * guest agreed to), its 'created' event and its email_outbox rows (staff.new,
+ * then guest.ack or guest.confirmed). Nothing is sent here; the action drains
+ * `outboxIds` once this has committed (step 7).
  */
 
 export type CreateOutcome =
@@ -73,8 +77,27 @@ async function insertOnce(pool: Pool, input: ReservationRequest, now: Date, refe
   }
 }
 
+/**
+ * Step 5 (R14): the active web requests this number already holds for this
+ * date, at any restaurant. Counted under the number's own lock, because the
+ * booking-day lock is per restaurant and the same number can book two
+ * restaurants at once. Taken before the booking-day lock (lock order in
+ * lock.ts), so a burst from one number queues on its own key and is refused
+ * without holding up the restaurant's day.
+ */
+async function phoneDayFull(client: PoolClient, input: ReservationRequest): Promise<boolean> {
+  await lockGuestPhoneDay(client, input.phoneE164, input.date);
+  const { rows } = await client.query<{ n: number }>(
+    `SELECT count(*)::int AS n FROM reservations
+      WHERE phone_e164 = $1 AND reserved_on = $2::date AND source = 'web' AND status = ANY($3::text[])`,
+    [input.phoneE164, input.date, UPCOMING_STATUSES],
+  );
+  return rows[0].n >= PHONE_DAY_LIMIT;
+}
+
 async function insertInTransaction(client: PoolClient, input: ReservationRequest, now: Date, reference: string): Promise<CreateOutcome> {
-  // The lock first: the rules and the covers read below must be the ones the insert is decided on.
+  if (await phoneDayFull(client, input)) return { ok: false, code: 'too_many_requests' };
+  // Then the booking-day lock: the rules and the covers read below must be the ones the insert is decided on.
   await lockBookingDay(client, input.restaurantId, input.date);
   const loaded = await loadRestaurantRules(client, input.restaurantId, input.locale, venueNow(now).date);
   if (!loaded) return { ok: false, code: 'restaurant_unavailable' };
@@ -93,11 +116,12 @@ async function insertInTransaction(client: PoolClient, input: ReservationRequest
   const { rows } = await client.query<{ id: string }>(
     `INSERT INTO reservations
        (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164,
-        email, note, status, confirmed_at, source, locale)
+        email, note, status, confirmed_at, source, locale, consent_version, consented_at)
      VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12,
              CASE WHEN $12 = 'confirmed' THEN now() END, 'web',
              COALESCE((SELECT code FROM locales WHERE code = $13 AND is_enabled),
-                      (SELECT code FROM locales WHERE is_default)))
+                      (SELECT code FROM locales WHERE is_default)),
+             $14, now())
      RETURNING id::text`,
     [
       reference,
@@ -113,6 +137,7 @@ async function insertInTransaction(client: PoolClient, input: ReservationRequest
       input.note,
       status,
       input.locale,
+      input.consentVersion,
     ],
   );
   const id = rows[0].id;
```

Sửa `app/actions.ts` (bước 1 trước zod: một bot nhận `bot_blocked`, không bao giờ một gợi ý ô nào sai):

```diff
diff --git a/app/actions.ts b/app/actions.ts
index 5150505..f76e345 100644
--- a/app/actions.ts
+++ b/app/actions.ts
@@ -2,7 +2,7 @@
 
 import type { BookingErrorCode } from '@/lib/booking-errors';
 import { createWebReservation } from '@/lib/server/booking/create';
-import { parseReservationInput } from '@/lib/server/booking/input';
+import { honeypotFilled, parseReservationInput } from '@/lib/server/booking/input';
 import { drainAfterCommit } from '@/lib/server/email/after-commit';
 import type { IsoDate } from '@/lib/venue-time';
 
@@ -11,14 +11,20 @@ export type ReservationResult =
   | { ok: false; code: BookingErrorCode; params?: Record<string, string> };
 
 /**
- * Books a table (spec §10.2, steps 2, 3, 4, 6 and 7; BotID, the honeypot and
- * the phone limit come with phase 5's anti-spam work). Everything the client claimed
- * is parsed with zod, then re-checked against the venue's clock and the live
- * rules inside one locked transaction. Failures come back as codes; the
- * browser turns them into copy. A database error throws, so the guest sees
- * error.network (spec §12).
+ * Books a table (spec §10.2). Step 1 refuses a bot before anything else runs:
+ * the honeypot (free; BotID joins it in phase 5's BotID task). Then zod
+ * (step 2, consent included), and one locked transaction for the per-phone
+ * limit, the clock and rule checks, the insert and its outbox rows (steps
+ * 3–6), and after() once it has committed (step 7). Failures come back as
+ * codes; the browser turns them into copy. A database error throws, so the
+ * guest sees error.network (spec §12).
  */
 export async function submitReservation(input: unknown): Promise<ReservationResult> {
+  if (honeypotFilled(input)) {
+    // No guest data in the log (spec §12): only which check refused.
+    console.warn('[booking] refused as a bot', { by: 'honeypot' });
+    return { ok: false, code: 'bot_blocked' };
+  }
   const parsed = parseReservationInput(input);
   if (!parsed.ok) return parsed;
   const result = await createWebReservation(parsed.value);
```

- [ ] **Bước 6: Drawer**

Create `components/overlays/Honeypot.tsx`:

```tsx
'use client';

/**
 * The reserve drawer's trap for scripts that fill every field they find
 * (spec §10.2 step 1). People never meet it:
 * - off-screen, not display:none (some scripts skip hidden inputs), and
 *   aria-hidden so screen readers skip it;
 * - out of the tab order (tabIndex -1; axe accepts a focusable element under
 *   aria-hidden only then);
 * - named "website" with autocomplete off and the password managers' opt-out
 *   attributes, so neither browser autofill nor a password manager fills it:
 *   a false positive would refuse a real guest (error.bot_blocked, which at
 *   least gives the phone number, R15).
 * Anything typed here is sent as `honeypot`; the server refuses the request
 * before reading anything else (honeypotFilled).
 */
export function Honeypot({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="hp" aria-hidden="true">
      <label>
        Website
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          data-1p-ignore=""
          data-lpignore="true"
          data-bwignore=""
          data-form-type="other"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    </div>
  );
}
```

Sửa `components/site/SiteProvider.tsx` (ô đồng ý là điều kiện gửi như tên và số điện thoại; cả hai giá trị về mặc định khi đóng màn hình xong; `errorParams` điền `{phone}` bằng số của nhà hàng đang chọn):

```diff
diff --git a/components/site/SiteProvider.tsx b/components/site/SiteProvider.tsx
index 7fb0aa2..c47645f 100644
--- a/components/site/SiteProvider.tsx
+++ b/components/site/SiteProvider.tsx
@@ -139,6 +139,12 @@ type SiteState = {
   booked: Booked | null;
   form: BookingForm;
   setFormField: (key: keyof BookingForm, value: string) => void;
+  /** The privacy consent box (spec §11); the request is not sent without it. */
+  consent: boolean;
+  setConsent: (value: boolean) => void;
+  /** The hidden honeypot field's value (components/overlays/Honeypot.tsx); people leave it empty. */
+  honeypot: string;
+  setHoneypot: (value: string) => void;
   tried: boolean;
   done: boolean;
   pending: boolean;
@@ -147,7 +153,7 @@ type SiteState = {
   serverError: string | null;
   /** REQUEST BOOKING is waiting for the dates, which are on their way (the footer's status says so). */
   footLoading: boolean;
-  errors: { name: boolean; phone: boolean; email: boolean };
+  errors: { name: boolean; phone: boolean; email: boolean; consent: boolean };
   submit: () => void;
 
   overlay: Overlay | null;
@@ -231,6 +237,8 @@ export function SiteProvider({
   const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
   const [board, setBoard] = useState<DayResponse | null>(null);
   const [form, setForm] = useState<BookingForm>(EMPTY_FORM);
+  const [consent, setConsent] = useState(false);
+  const [honeypot, setHoneypot] = useState('');
   const [tried, setTried] = useState(false);
   const [done, setDone] = useState(false);
   const [pending, setPending] = useState(false);
@@ -505,6 +513,8 @@ export function SiteProvider({
       setTried(false);
       setServerError(null);
       setForm(EMPTY_FORM);
+      setConsent(false);
+      setHoneypot('');
     }
   }, [done]);
 
@@ -526,9 +536,14 @@ export function SiteProvider({
 
   const valid = useMemo(() => validate(form), [form]);
   const errors = useMemo(
-    () => ({ name: tried && !valid.name, phone: tried && !valid.phone, email: tried && !valid.email }),
-    [tried, valid],
+    () => ({ name: tried && !valid.name, phone: tried && !valid.phone, email: tried && !valid.email, consent: tried && !consent }),
+    [tried, valid, consent],
   );
+  /* The chosen restaurant's group phone fills {phone} in a refusal the server sends without one (bot_blocked, too_many_requests). */
+  const errorParams = useCallback((restaurant: string, params: Record<string, string> = {}) => {
+    const phone = calendarFor(latest.current.calendar, restaurant)?.groupPhone;
+    return phone ? { phone: phone.display, ...params } : params;
+  }, []);
 
   const submit = useCallback(() => {
     setServerError(null);
@@ -536,7 +551,7 @@ export function SiteProvider({
     const { restaurant, date } = booking;
     const at = now();
     const ctx = context(at);
-    if (!(valid.name && valid.phone && valid.email)) {
+    if (!(valid.name && valid.phone && valid.email && consent)) {
       setTried(true);
       return;
     }
@@ -595,6 +610,8 @@ export function SiteProvider({
       email: form.email,
       note: form.note,
       locale,
+      consent,
+      honeypot,
     })
       .then((result) => {
         if (result.ok) {
@@ -604,7 +621,7 @@ export function SiteProvider({
           setDone(true);
           return;
         }
-        setServerError(bookingErrorMessage(result.code, result.params, strings));
+        setServerError(bookingErrorMessage(result.code, errorParams(booking.restaurant, result.params), strings));
         setTried(true);
         // Ask again so a lost race (or a new closure) shows up at once; the
         // answers move the time off a slot that has just filled.
@@ -613,7 +630,7 @@ export function SiteProvider({
       })
       .catch(() => setServerError(bookingErrorMessage('network', {}, strings)))
       .finally(() => setPending(false));
-  }, [booking, context, failed, form, loadBoard, loadCalendar, locale, now, restaurants, strings, valid]);
+  }, [booking, consent, context, errorParams, failed, form, honeypot, loadBoard, loadCalendar, locale, now, restaurants, strings, valid]);
 
   const setFormField = useCallback((key: keyof BookingForm, value: string) => {
     setForm((f) => ({ ...f, [key]: value }));
@@ -765,6 +782,10 @@ export function SiteProvider({
       booked,
       form,
       setFormField,
+      consent,
+      setConsent,
+      honeypot,
+      setHoneypot,
       tried,
       done,
       pending,
@@ -792,8 +813,8 @@ export function SiteProvider({
     }),
     [
       applyFinder, booked, booking, bookable, chosenBoard, clearFilters, close, closeDrawer, closeDropdown,
-      confirmedDate, dateMoved, days, done, errors, filter, finder, footError, footLoading, form, goBackToRestaurants,
-      goHomeTop, groupPhone, lang, loadFailed, locale, matches, maxParty, now, open, openDropdown, openReserve,
+      confirmedDate, consent, dateMoved, days, done, errors, filter, finder, footError, footLoading, form, goBackToRestaurants,
+      goHomeTop, groupPhone, honeypot, lang, loadFailed, locale, matches, maxParty, now, open, openDropdown, openReserve,
       openRestaurant, overlay, pageRoot, pending, pickCuisine, pickDestination, query, reference, restaurants,
       retryAvailability, scrollToId, scrolled, setBooking, setFilter, setFinder, setFormField, showPage, shownCount,
       strings, submit, tab, today, toggleDropdown, tried, view,
```

Sửa `components/overlays/ReserveDrawer.tsx` (honeypot cuối `.drawer-fields`; thông báo, link chính sách `target="_blank"` để form giữ nguyên, rồi ô có `aria-describedby` trỏ vào thông báo):

```diff
diff --git a/components/overlays/ReserveDrawer.tsx b/components/overlays/ReserveDrawer.tsx
index 9cb7a5a..979e562 100644
--- a/components/overlays/ReserveDrawer.tsx
+++ b/components/overlays/ReserveDrawer.tsx
@@ -11,6 +11,8 @@ import { formatDay, type IsoDate } from '@/lib/venue-time';
 import { useSite, type ClientStrings } from '@/components/site/SiteProvider';
 import { Dropdown, type Option } from '@/components/ui/Dropdown';
 import { animateSelector, useOpenAnimation } from '@/lib/motion';
+import { privacyHref } from '@/lib/legal';
+import { Honeypot } from '@/components/overlays/Honeypot';
 
 /** A message with {phone} turned into a tel: link (any other placeholder is filled as text). */
 function WithPhone({ template, params, phone }: { template: string; params: MessageParams; phone: GroupPhone }) {
@@ -165,6 +167,11 @@ export function ReserveDrawer() {
     booked,
     form,
     setFormField,
+    consent,
+    setConsent,
+    honeypot,
+    setHoneypot,
+    locale,
     errors,
     serverError,
     footLoading,
@@ -448,6 +455,29 @@ export function ReserveDrawer() {
                       maxLength={FIELD_MAX.note}
                     />
                   </label>
+                  <Honeypot value={honeypot} onChange={setHoneypot} />
+                </div>
+
+                {/* Spec §11: the notice at the point of collection, the policy one tap away (a new tab keeps this form), and a box only a person ticks. */}
+                <div className="drawer-consent">
+                  <p className="drawer-privacy" id="drawer-privacy">
+                    {strings['booking.privacy_notice']}{' '}
+                    <a href={privacyHref(locale)} target="_blank" rel="noopener">
+                      {strings['legal.link']}
+                    </a>
+                  </p>
+                  <label className="consent">
+                    <input
+                      type="checkbox"
+                      checked={consent}
+                      onChange={(e) => setConsent(e.target.checked)}
+                      aria-describedby="drawer-privacy"
+                      aria-invalid={errors.consent}
+                      data-invalid={errors.consent}
+                    />
+                    <span>{strings['booking.consent']}</span>
+                  </label>
+                  {errors.consent && <span className="field-error">{strings['error.consent_required']}</span>}
                 </div>
               </div>
             </div>
```

Sửa `styles/overlays.css` (honeypot ngoài màn hình chứ không `display:none`: vài script bỏ qua ô ẩn; cả nhãn bật ô, nên vùng chạm là cả dòng):

```diff
diff --git a/styles/overlays.css b/styles/overlays.css
index 7b5ddb6..1cea33a 100644
--- a/styles/overlays.css
+++ b/styles/overlays.css
@@ -390,6 +390,59 @@
   color: var(--error);
 }
 
+/* The honeypot (components/overlays/Honeypot.tsx): in the DOM for scripts, off-screen for people. */
+.hp {
+  position: absolute;
+  left: -10000px;
+  top: auto;
+  width: 1px;
+  height: 1px;
+  overflow: hidden;
+}
+
+.drawer-consent {
+  margin-top: 18px;
+  display: grid;
+  gap: 10px;
+}
+
+.drawer-privacy {
+  margin: 0;
+  font-size: 12px;
+  line-height: 1.6;
+  color: var(--ink-soft);
+}
+
+.drawer-privacy a {
+  color: var(--ink);
+  text-decoration: underline;
+  text-underline-offset: 2px;
+}
+
+.consent {
+  display: flex;
+  align-items: flex-start;
+  gap: 10px;
+  font-size: 13px;
+  line-height: 1.5;
+  color: var(--ink);
+  cursor: pointer;
+}
+
+/* The whole label toggles the box, so the tap target is the full row, not the 20px square. */
+.consent input {
+  flex: 0 0 auto;
+  width: 20px;
+  height: 20px;
+  margin: 1px 0 0;
+  accent-color: var(--green);
+}
+
+.consent input[data-invalid='true'] {
+  outline: 1px solid var(--error);
+  outline-offset: 2px;
+}
+
 .drawer-foot {
   flex: 0 0 auto;
   display: flex;
```

- [ ] **Bước 7: Chạy lại test, rồi kiểm rằng cuộc đua cần khóa số điện thoại**

Run: lệnh ở Bước 2.
Expected: PASS `Test Files  7 passed (7)`, `Tests  145 passed (145)`

Đột biến: trong `phoneDayFull` của `lib/server/booking/create.ts`, thay dòng `await lockGuestPhoneDay(client, input.phoneE164, input.date);` bằng một comment, chạy `npx vitest run test/integration/submit-reservation.test.ts -t "step 5"` (cùng `TEST_DATABASE_URL`) ba lần. Expected mỗi lần: `Tests  2 failed | 4 passed | 21 skipped (27)`:

```
       × holds when one number books six restaurants at once (the guest-phone lock; the booking-day locks differ) 31ms
       × a number waiting on its own lock holds up no one else at that restaurant and date 320ms
AssertionError: expected [ { ok: true, data: { …(3) } }, …(5) ] to have a length of 3 but got 6
AssertionError: expected true to be false // Object.is equality
```

(Không khóa, cả sáu giao dịch đếm thấy 0 rồi cùng chèn.) Trả dòng đó về; `git diff` của file phải giống Bước 5.

- [ ] **Bước 8: Chạy cổng kiểm tra**

Expected:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo;
- `Test Files  63 passed (63)`, `Tests  803 passed (803)`;
- `Applied 7 migration(s).`; build thoát 0; check-prerender như Task 8;
- E2E `131 passed`; visual `8 passed` (drawer không có trong baseline nào).

`grep -rn "pg_advisory" lib app` phải chỉ ra `lib/server/booking/lock.ts`.

- [ ] **Bước 9: Commit**

```bash
git add app/actions.ts components/overlays/Honeypot.tsx components/overlays/ReserveDrawer.tsx components/site/SiteProvider.tsx e2e/admin-booking-settings.spec.ts e2e/booking-acceptance.spec.ts e2e/booking-dates.spec.ts e2e/booking-email.spec.ts e2e/booking-v2.spec.ts e2e/guest-guard.spec.ts lib/booking-errors.test.ts lib/booking-errors.ts lib/booking.test.ts lib/booking.ts lib/booking/rules.ts lib/i18n/registry.ts lib/server/booking/create.ts lib/server/booking/input.test.ts lib/server/booking/input.ts lib/server/booking/lock.ts styles/overlays.css test/guards/require-permission.guard.test.ts test/integration/booking-config.test.ts test/integration/email-outbox.test.ts test/integration/reservation-lifecycle.test.ts test/integration/submit-reservation.test.ts
git commit -m "$(cat <<'EOF'
feat: ask the guest's consent, trap form-filling scripts, and cap one number at three requests a day

The reserve drawer now shows the privacy notice with a link to the policy
(it opens beside the form, which keeps what was typed) and a consent box;
nothing is sent until it is ticked, and the server refuses an unticked
request with consent_required (spec §11). A booking stores the policy version
the guest agreed to and when (reservations.consent_version, consented_at).

Step 1 of submitReservation (spec §10.2) refuses a filled honeypot, an
off-screen field no person sees or tabs to, before anything else is read:
the guest is told bot_blocked with the restaurant's number to call, never a
fake success (R15). Step 5 allows at most three requested or confirmed web
bookings per phone number per date across all restaurants (R14), counted
under a guest-phone advisory lock taken before the booking-day lock, so a
burst from one number queues on its own key; six restaurants booked at once
from one number give exactly three bookings. The refusals name the chosen
restaurant's own number. A guest email now needs exactly one "@" on both
sides (R13), matching what the outbox can store.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```
---

### Task 10: Đường lỗi của drawer và câu trả lời rẻ của availability (việc hoãn T5, T6 của đợt 4)

Bốn việc hoãn của sổ đợt 4 (mục "Phase 5"), làm trên drawer của đợt sửa cuối (nhóm A) và của Task 9:
- **404 `restaurant_unavailable`** (Admin tắt đặt bàn online trong lúc drawer mở): trước đây hiện `error.network` với một nút Thử lại không bao giờ giúp được. Giờ `getJson` phân biệt 404 (`gone`), và chỗ của ngày hoặc giờ nói "That restaurant is no longer available." không có Thử lại.
- **Một alert, không phải hai:** bấm REQUEST BOOKING khi ngày hoặc giờ chưa tải được từng thêm một alert thứ hai cùng chữ ở chân drawer (cùng lúc với alert ở chỗ ngày/giờ). Giờ thông báo chỉ nói một lần, ở chỗ của nó; REQUEST BOOKING chuyển focus tới nút Thử lại của thông báo (nút được thông báo mô tả, `aria-describedby`), hỏi lại lịch nếu là lịch, và không gửi gì. Loại `network` của ghi chú chân drawer bỏ đi; chỉ còn ghi chú "đang tải" (role `status`).
- **Focus ở lại trong dialog:** Thử lại thành công thì nút tự gỡ, và một nút bị gỡ khi đang giữ focus đẩy focus về `<body>`, ra ngoài dialog `aria-modal`. Giờ focus chuyển tới thứ vừa tới: ngày đang chọn, hoặc giờ đang chọn.
- **Thanh đặt bàn** (BookingBar) từng nằm trống khi lịch không tải được; giờ nó nói vì sao, trong một vùng `role="status"` luôn có mặt và rỗng khi không có gì (không chiếm chỗ: visual vẫn 8/8 ở ngưỡng 0).
- **`/api/availability`** trả lời trước mọi truy vấn: khoảng `from`–`to` cho đủ mà ngược hoặc quá dài → 400 `invalid_range`; id nhà hàng không thể tồn tại (sai dạng slug, như `RestaurantId` của `lib/admin/booking-schemas.ts`) → 404. Một luồng request rác không tốn một chuyến DB nào.

Spike guard không có code cho phần drawer (chỉ có route): phần đó viết mới ở task này.

**Files:**
- Modify: `app/api/availability/route.ts`, `test/integration/availability.test.ts`, `components/site/SiteProvider.tsx`, `components/overlays/ReserveDrawer.tsx`, `components/booking/BookingBar.tsx`, `styles/booking.css`, `e2e/booking-v2.spec.ts`

**Interfaces:**
- Consumes: `MAX_RANGE_DAYS`, `AvailabilityErrorCode` (`lib/booking/api.ts`); `daysBetween` (`lib/venue-time.ts`); `useSite()` của nhóm A (`loadFailed`, `retryAvailability`, `footLoading`, `serverError`); registry `error.network`, `error.restaurant_unavailable`, `booking.retry`.
- Produces:
  - `SiteProvider`: `export type LoadFailure = 'network' | 'restaurant_unavailable'`; `loadFailed: { at: 'dates' | 'times'; count: number; code: LoadFailure } | null`; `failureNudge: number` (tăng mỗi lần REQUEST BOOKING dừng vì một lỗi drawer đang hiện); `serverError` giờ chỉ là lỗi của lần gửi (không còn `error.network` của availability).
  - `ReserveDrawer`: `LoadFailed` nhận `code`; Thử lại chỉ có khi `code === 'network'`; phần tử `.load-failed` có `tabIndex={-1}`.
  - `BookingBar`: `<div role="status">` dưới panel, `<p className="booking-note">` khi `loadFailed`.

- [ ] **Bước 1: Viết test cho các câu trả lời rẻ**

Sáu request, mỗi cái phải được trả lời mà `getPool().query` không bị gọi lần nào. Sửa `test/integration/availability.test.ts`:

```diff
diff --git a/test/integration/availability.test.ts b/test/integration/availability.test.ts
index 703d0ba..c578ecf 100644
--- a/test/integration/availability.test.ts
+++ b/test/integration/availability.test.ts
@@ -207,4 +207,23 @@ describe.skipIf(!process.env.TEST_DATABASE_URL)('GET /api/availability v2 (datab
     expect(res.headers.get('cache-control')).toBe('no-store');
     expect(await res.json()).toEqual({ error });
   });
+
+  // Phase-4 deferral T5: the cheap answers come first, so a stream of junk requests costs no database round trip.
+  it.each([
+    ['restaurant=taya-house&from=2026-10-05&to=2026-10-04', 400],
+    ['restaurant=taya-house&from=2026-10-01&to=2027-10-01', 400],
+    // A bad range is a 400 even for a restaurant that does not exist: the range is checked first.
+    ['restaurant=nowhere&from=2026-10-01&to=2027-10-01', 400],
+    [`restaurant=${'x'.repeat(65)}`, 404],
+    ['restaurant=%3Cscript%3E', 404],
+    ['restaurant=Taya-House', 404],
+  ])('answers %j (%i) without touching the database', async (query, status) => {
+    const spy = vi.spyOn(getPool(), 'query');
+    try {
+      expect((await get(query)).status).toBe(status);
+      expect(spy).not.toHaveBeenCalled();
+    } finally {
+      spy.mockRestore();
+    }
+  });
 });
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/availability.test.ts`
Expected: FAIL `Test Files  1 failed (1)`, `Tests  6 failed | 22 passed (28)`:

```
 ❯ test/integration/availability.test.ts (28 tests | 6 failed) 209ms
     × answers "restaurant=taya-house&from=2026-10-05&to=2026-10-04" (400) without touching the database 9ms
     × answers "restaurant=taya-house&from=2026-10-01&to=2027-10-01" (400) without touching the database 6ms
     × answers "restaurant=nowhere&from=2026-10-01&to=2027-10-01" (400) without touching the database 7ms
     × answers "restaurant=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" (404) without touching the database 5ms
     × answers "restaurant=%3Cscript%3E" (404) without touching the database 3ms
     × answers "restaurant=Taya-House" (404) without touching the database 5ms
AssertionError: expected "query" to not be called at all, but actually been called 1 times
AssertionError: expected 404 to be 400 // Object.is equality
```

- [ ] **Bước 3: Viết E2E và chạy nó trên build hiện tại: phải đỏ**

Hai test mới (thanh đặt bàn nói khi lịch hỏng; một nhà hàng ngừng nhận đặt bàn nói vậy, không Thử lại, không gửi gì) và ba test của nhóm A đổi kỳ vọng (một alert và focus tới Thử lại thay vì alert thứ hai ở chân drawer; focus sau Thử lại thành công). Mọi test dùng availability giả, không ghi gì. Sửa `e2e/booking-v2.spec.ts`:

```diff
diff --git a/e2e/booking-v2.spec.ts b/e2e/booking-v2.spec.ts
index 2629b20..732f233 100644
--- a/e2e/booking-v2.spec.ts
+++ b/e2e/booking-v2.spec.ts
@@ -185,6 +185,7 @@ test('the details stop at the lengths the server accepts', async ({ page }) => {
 });
 
 const NETWORK = 'We could not reach the reservations desk. Please try again.';
+const GONE = 'That restaurant is no longer available.';
 
 /** Puts a failing answer in front of the mock while `failing()` says so; registered last, it runs first. */
 async function failAvailability(page: Page, failing: (url: URL) => boolean, answer: (route: Route) => Promise<void>) {
@@ -229,7 +230,7 @@ async function fillDetails(drawer: Locator) {
   await drawer.getByRole('checkbox', { name: 'I agree to Furama Cuisine using my details as described in the privacy policy.' }).check();
 }
 
-test('when the dates cannot load, the guest is told, REQUEST BOOKING says so, and Try again recovers', async ({ page }) => {
+test('when the dates cannot load, the guest is told once: REQUEST BOOKING points at Try again, which recovers and keeps the focus in the dialog', async ({ page }) => {
   let failing = true;
   await page.clock.setFixedTime(NOW);
   await mockAvailability(page, clock);
@@ -242,22 +243,55 @@ test('when the dates cannot load, the guest is told, REQUEST BOOKING says so, an
   await expect(drawer.getByRole('alert')).toHaveText(NETWORK);
   await expect(drawer.locator('.daystrip')).toHaveCount(0);
 
-  // Valid details and no date to book: the button answers rather than doing nothing.
+  // Valid details and no date to book: the button answers by taking the guest to the one way
+  // forward, the Try again under the message, rather than repeating the message in the footer.
   await fillDetails(drawer);
   await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
-  await expect(foot(drawer).getByRole('alert')).toHaveText(NETWORK);
+  const retry = drawer.getByRole('button', { name: 'Try again' });
+  await expect(retry).toBeFocused();
+  await expect(retry).toHaveAccessibleDescription(NETWORK);
+  await expect(drawer.getByRole('alert')).toHaveCount(1);
+  await expect(foot(drawer).getByRole('alert')).toHaveCount(0);
 
   failing = false;
-  await drawer.getByRole('button', { name: 'Try again' }).click();
+  await retry.click();
   await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
   await expect(drawer.locator('.day[aria-pressed="true"] .day-num')).toHaveText('2');
   await expect(drawer.locator('.slot:not([disabled])')).toHaveCount(12);
+  await expect(retry).toHaveCount(0);
+  await expect(drawer.getByRole('alert')).toHaveCount(0);
+  // The button that had the focus is gone: the focus moves to the chosen day, not to <body> behind the modal.
+  await expect(drawer.locator('.day[aria-pressed="true"]')).toBeFocused();
+});
+
+test('when the dates cannot load, the booking bar says so too', async ({ page }) => {
+  await page.clock.setFixedTime(NOW);
+  await mockAvailability(page, clock);
+  await failAvailability(page, isCalendar, (route) => route.fulfill({ status: 503, json: { error: 'unavailable' } }));
+  await page.goto(HOME_PATH);
+  await expect(said(page.locator('#reserve'))).toHaveText(NETWORK);
+});
+
+test('a restaurant that stopped taking bookings says so, with no futile Try again, and nothing is sent', async ({ page }) => {
+  await page.clock.setFixedTime(NOW);
+  await mockAvailability(page, clock);
+  // What /api/availability answers once the Admin switches the restaurant's online booking off.
+  await failAvailability(page, isCalendar, (route) => route.fulfill({ status: 404, json: { error: 'restaurant_unavailable' } }));
+  const posts = await abortServerActions(page);
+  await page.goto(HOME_PATH);
+  await expect(said(page.locator('#reserve'))).toHaveText(GONE);
+  await reserveButton(page).click();
+  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
+
+  await expect(drawer.getByRole('alert')).toHaveText(GONE);
   await expect(drawer.getByRole('button', { name: 'Try again' })).toHaveCount(0);
-  // The footer's message was about those dates: it goes once they arrive.
-  await expect(foot(drawer).getByRole('alert')).toHaveCount(0);
+  await fillDetails(drawer);
+  await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
+  await expect(drawer.getByRole('alert')).toHaveCount(1);
+  expect(posts.count).toBe(0);
 });
 
-test('when the times cannot load, the guest is told instead of waiting forever, and Try again recovers', async ({ page }) => {
+test('when the times cannot load, the guest is told instead of waiting forever, and Try again recovers with the focus on the chosen time', async ({ page }) => {
   let failing = true;
   await page.clock.setFixedTime(NOW);
   await mockAvailability(page, clock);
@@ -275,6 +309,7 @@ test('when the times cannot load, the guest is told instead of waiting forever,
   await drawer.getByRole('button', { name: 'Try again' }).click();
   await expect(drawer.locator('.slot:not([disabled])')).toHaveCount(12);
   await expect(drawer.getByRole('alert')).toHaveCount(0);
+  await expect(drawer.getByRole('button', { name: '19:00 — 16 covers left' })).toBeFocused();
 });
 
 test('while the dates are on their way the drawer says so, and REQUEST BOOKING waits for them instead of failing', async ({ page }) => {
@@ -304,7 +339,7 @@ test('while the dates are on their way the drawer says so, and REQUEST BOOKING w
   expect(posts.count).toBe(0);
 });
 
-test('when the chosen day’s times did not load, REQUEST BOOKING says so and sends nothing', async ({ page }) => {
+test('when the chosen day’s times did not load, REQUEST BOOKING points at Try again and sends nothing', async ({ page }) => {
   await page.clock.setFixedTime(NOW);
   await mockAvailability(page, clock);
   await failAvailability(page, (url) => url.searchParams.has('date'), (route) => route.fulfill({ status: 500, json: { error: 'unavailable' } }));
@@ -318,7 +353,8 @@ test('when the chosen day’s times did not load, REQUEST BOOKING says so and se
   await expect(drawer.getByRole('button', { name: 'Try again' })).toBeVisible();
   await fillDetails(drawer);
   await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
-  await expect(foot(drawer).getByRole('alert')).toHaveText(NETWORK);
+  await expect(drawer.getByRole('button', { name: 'Try again' })).toBeFocused();
+  await expect(drawer.getByRole('alert')).toHaveText(NETWORK);
   // No time the guest never saw (the default 19:00) goes to the server.
   expect(posts.count).toBe(0);
 });
```

Cất tạm các file ngoài `e2e/`, build, chạy `e2e/booking-v2.spec.ts --project=desktop -g "cannot load|stopped taking|did not load"`. Expected: `5 failed`:

```
  ✘  1 [desktop] › e2e/booking-v2.spec.ts:233:5 › when the dates cannot load, the guest is told once: REQUEST BOOKING points at Try again, which recovers and keeps the focus in the dialog (5.6s)
  ✘  2 [desktop] › e2e/booking-v2.spec.ts:267:5 › when the dates cannot load, the booking bar says so too (5.2s)
  ✘  3 [desktop] › e2e/booking-v2.spec.ts:275:5 › a restaurant that stopped taking bookings says so, with no futile Try again, and nothing is sent (5.2s)
  ✘  4 [desktop] › e2e/booking-v2.spec.ts:294:5 › when the times cannot load, the guest is told instead of waiting forever, and Try again recovers with the focus on the chosen time (5.4s)
  ✘  5 [desktop] › e2e/booking-v2.spec.ts:342:5 › when the chosen day’s times did not load, REQUEST BOOKING points at Try again and sends nothing (5.5s)
    Error: expect(locator).toBeFocused() failed
    Expected: focused
    Received: inactive
      - waiting for getByRole('dialog', { name: 'Reserve a table' }).getByRole('button', { name: 'Try again' })
    Error: element(s) not found
      - waiting for locator('#reserve').getByRole('status').filter({ hasText: /\S/ })
      - waiting for getByRole('dialog', { name: 'Reserve a table' }).getByRole('button', { name: '19:00 — 16 covers left' })
```

Lấy lại các file đã cất.

- [ ] **Bước 4: Câu trả lời rẻ của availability**

Sửa `app/api/availability/route.ts` (khoảng mở một đầu vẫn cần cửa sổ của nhà hàng, nên vẫn kiểm sau khi đọc luật):

```diff
diff --git a/app/api/availability/route.ts b/app/api/availability/route.ts
index 060e9cd..69a3265 100644
--- a/app/api/availability/route.ts
+++ b/app/api/availability/route.ts
@@ -18,6 +18,8 @@ import { addDays, daysBetween, isValidIsoDate, venueNow } from '@/lib/venue-time
 const NO_STORE = { 'cache-control': 'no-store' };
 const fail = (status: number, error: AvailabilityErrorCode) => NextResponse.json({ error }, { status, headers: NO_STORE });
 const GUESTS = /^[1-9][0-9]?$/;
+/** The shape of restaurants.id (a slug, as lib/admin/booking-schemas.ts RestaurantId checks it); anything else cannot exist. */
+const RESTAURANT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
 
 export async function GET(request: Request) {
   const params = new URL(request.url).searchParams;
@@ -35,6 +37,13 @@ export async function GET(request: Request) {
   const guestsParam = params.get('guests');
   if (guestsParam !== null && !(GUESTS.test(guestsParam) && Number(guestsParam) <= 50)) return fail(400, 'invalid_guests');
   const guests = guestsParam === null ? 1 : Number(guestsParam);
+  // The cheap answers come before any query (anti-spam, phase-4 deferral T5): a range given in
+  // full is checked here; only a range open at one end needs the restaurant's window, below.
+  if (from !== null && to !== null) {
+    const span = daysBetween(from, to);
+    if (span < 0 || span >= MAX_RANGE_DAYS) return fail(400, 'invalid_range');
+  }
+  if (!RESTAURANT_ID.test(restaurant)) return fail(404, 'restaurant_unavailable');
 
   const now = new Date();
   const today = venueNow(now).date;
```

Run: lệnh ở Bước 2. Expected: PASS `Test Files  1 passed (1)`, `Tests  28 passed (28)`

- [ ] **Bước 5: Trạng thái lỗi của SiteProvider**

`Failed` nhớ thêm `gone` cho lịch và cho ngày; `loadFailed` mang `code`. REQUEST BOOKING dừng trên một lỗi đang hiện thì tăng `failureNudge` (và hỏi lại lịch, trừ khi nhà hàng đã `gone`) thay vì đặt một ghi chú `network` ở chân drawer. Sửa `components/site/SiteProvider.tsx`:

```diff
diff --git a/components/site/SiteProvider.tsx b/components/site/SiteProvider.tsx
index c47645f..d31c63a 100644
--- a/components/site/SiteProvider.tsx
+++ b/components/site/SiteProvider.tsx
@@ -45,11 +45,12 @@ const EMPTY_FORM: BookingForm = { name: '', phone: '', email: '', note: '' };
 
 export type ClientStrings = Record<ClientKey, string>;
 
-type Fetched<T> = { ok: true; data: T } | { ok: false };
+/** `gone`: a 404, the restaurant takes no online bookings (any more); asking again cannot help. */
+type Fetched<T> = { ok: true; data: T } | { ok: false; gone: boolean };
 
 async function getJson<T>(url: string): Promise<Fetched<T>> {
   const r = await fetch(url);
-  return r.ok ? { ok: true, data: (await r.json()) as T } : { ok: false };
+  return r.ok ? { ok: true, data: (await r.json()) as T } : { ok: false, gone: r.status === 404 };
 }
 
 const NO_DAYS: DayInfo[] = [];
@@ -60,15 +61,23 @@ export type Booked = { status: 'requested' | 'confirmed'; time: string; guests:
 /**
  * Availability that did not arrive (an HTTP error, or no network), and what it
  * was for: the calendar's restaurant, the board's restaurant and date.
+ * `gone`: the answer was a 404 (the restaurant stopped taking bookings).
  */
-type Failed = { calendar: string | null; board: { restaurant: string; date: IsoDate } | null; count: number };
+type Failed = {
+  calendar: { restaurant: string; gone: boolean } | null;
+  board: { restaurant: string; date: IsoDate; gone: boolean } | null;
+  count: number;
+};
+
+/** Why availability is missing, as the drawer and the booking bar say it (error.<code>). */
+export type LoadFailure = 'network' | 'restaurant_unavailable';
 
 /**
- * A footer message about an answer still to come, from a REQUEST BOOKING
- * pressed before it: 'loading' while it is on its way, 'network' when it
- * failed. `date` is '' for the calendar, else the board's date.
+ * A footer status about the dates still to come, from a REQUEST BOOKING
+ * pressed before they arrived. A failure is said once, where the dates or
+ * times would be, beside its Try again; the footer never repeats it.
  */
-type WaitNote = { kind: 'loading' | 'network'; restaurant: string; date: IsoDate | '' };
+type WaitNote = { restaurant: string };
 
 /* The two forms of GET /api/availability (lib/booking/api.ts). */
 const calendarUrl = (restaurant: string, locale: string) =>
@@ -119,10 +128,17 @@ type SiteState = {
    * network): 'dates' when there is no calendar for this restaurant, else
    * 'times' when there is no board for the chosen day; null otherwise.
    * `count` changes on every failure, so a repeated one can be read out again.
+   * `code` says why: 'restaurant_unavailable' (a 404) offers no Try again.
    */
-  loadFailed: { at: 'dates' | 'times'; count: number } | null;
+  loadFailed: { at: 'dates' | 'times'; count: number; code: LoadFailure } | null;
   /** Asks again for the chosen restaurant's calendar and day (the drawer's Try again). */
   retryAvailability: () => void;
+  /**
+   * Changes each time REQUEST BOOKING stops on a failure the drawer already
+   * shows (loadFailed): the drawer moves the focus to that message's Try again
+   * instead of saying the same thing twice.
+   */
+  failureNudge: number;
   /**
    * The chosen date a calendar's answer replaced (another restaurant does not
    * take it, or fresh availability greyed it), so the drawer can say so; null
@@ -248,6 +264,7 @@ export function SiteProvider({
      the choice is still the one it is about (footNote below), so it neither
      outlives the answer nor shows during a switch to another restaurant. */
   const [waitNote, setWaitNote] = useState<WaitNote | null>(null);
+  const [failureNudge, setFailureNudge] = useState(0);
   const [clockOffset, setClockOffset] = useState(0);
   const [confirmedDate, setConfirmedDate] = useState<IsoDate | ''>('');
   const [booked, setBooked] = useState<Booked | null>(null);
@@ -281,21 +298,19 @@ export function SiteProvider({
      the current choice (loadFailed): one restaurant's or day's failure says
      nothing about another, even while the other's answer is on its way. */
   const [failed, setFailed] = useState<Failed>({ calendar: null, board: null, count: 0 });
-  const settleCalendar = useCallback((restaurant: string, ok: boolean) => {
+  const settleCalendar = useCallback((restaurant: string, ok: boolean, gone = false) => {
     setFailed((f) =>
-      ok ? (f.calendar === null ? f : { ...f, calendar: null }) : { ...f, calendar: restaurant, count: f.count + 1 },
+      ok ? (f.calendar === null ? f : { ...f, calendar: null }) : { ...f, calendar: { restaurant, gone }, count: f.count + 1 },
     );
   }, []);
-  const settleBoard = useCallback((restaurant: string, date: IsoDate, ok: boolean) => {
+  const settleBoard = useCallback((restaurant: string, date: IsoDate, ok: boolean, gone = false) => {
     setFailed((f) =>
-      ok ? (f.board === null ? f : { ...f, board: null }) : { ...f, board: { restaurant, date }, count: f.count + 1 },
+      ok ? (f.board === null ? f : { ...f, board: null }) : { ...f, board: { restaurant, date, gone }, count: f.count + 1 },
     );
   }, []);
-  /* An answer arrived: the footer message about it goes. A 'network' one stays
-     when the answer failed again; a 'loading' one goes either way (a failure
-     shows where the dates or times would be, with its Try again). */
-  const answered = useCallback((restaurant: string, date: IsoDate | '', ok: boolean) => {
-    setWaitNote((n) => (n && n.restaurant === restaurant && n.date === date && (ok || n.kind === 'loading') ? null : n));
+  /* The dates answered (or failed, which shows where they would be, with its Try again): the footer's wait note goes. */
+  const answered = useCallback((restaurant: string) => {
+    setWaitNote((n) => (n && n.restaurant === restaurant ? null : n));
   }, []);
 
   const now = useCallback(() => new Date(Date.now() + clockOffset), [clockOffset]);
@@ -331,8 +346,8 @@ export function SiteProvider({
       getJson<CalendarResponse>(calendarUrl(restaurant, locale))
         .then((res) => {
           if (seq !== calendarSeq.current) return;
-          settleCalendar(restaurant, res.ok);
-          answered(restaurant, '', res.ok);
+          settleCalendar(restaurant, res.ok, !res.ok && res.gone);
+          answered(restaurant);
           if (!res.ok) return;
           const data = res.data;
           const serverNow = new Date(data.now);
@@ -349,7 +364,7 @@ export function SiteProvider({
         .catch(() => {
           if (seq !== calendarSeq.current) return;
           settleCalendar(restaurant, false);
-          answered(restaurant, '', false);
+          answered(restaurant);
         });
     },
     [answered, context, locale, settleCalendar],
@@ -364,7 +379,7 @@ export function SiteProvider({
       getJson<DayResponse>(dayUrl(restaurant, date, locale))
         .then((res) => {
           if (seq !== boardSeq.current) return;
-          settleBoard(restaurant, date, res.ok);
+          settleBoard(restaurant, date, res.ok, !res.ok && res.gone);
           if (!res.ok) return;
           const data = res.data;
           // The date left the window (a tab open past midnight): the calendar's answer moves it.
@@ -372,7 +387,6 @@ export function SiteProvider({
             loadCalendar(restaurant);
             return;
           }
-          answered(restaurant, date, true);
           const serverNow = new Date(data.now);
           setClockOffset(serverNow.getTime() - Date.now());
           setBoard(data);
@@ -382,7 +396,7 @@ export function SiteProvider({
           if (seq === boardSeq.current) settleBoard(restaurant, date, false);
         });
     },
-    [answered, context, loadCalendar, locale, settleBoard],
+    [context, loadCalendar, locale, settleBoard],
   );
 
   useEffect(() => {
@@ -556,12 +570,16 @@ export function SiteProvider({
       return;
     }
     if (restaurant && !calendarFor(ctx.calendar, restaurant)) {
-      // No dates for this restaurant yet, so nothing to book: they failed (say
-      // so, and ask again), or they are on their way (say so and wait; asking
-      // again would only restart the request every click). Its answer clears it.
+      // No dates for this restaurant yet, so nothing to book. They failed: the
+      // drawer already says so, so point the guest at it (one alert, not two)
+      // and ask again, unless the restaurant has stopped taking bookings. Or
+      // they are on their way: say so and wait (asking again would only
+      // restart the request every click); their answer clears the note.
       setTried(true);
-      setWaitNote({ kind: failed.calendar === restaurant ? 'network' : 'loading', restaurant, date: '' });
-      if (failed.calendar === restaurant) loadCalendar(restaurant);
+      if (failed.calendar?.restaurant === restaurant) {
+        setFailureNudge((n) => n + 1);
+        if (!failed.calendar.gone) loadCalendar(restaurant);
+      } else setWaitNote({ restaurant });
       return;
     }
     if (!date) {
@@ -571,8 +589,9 @@ export function SiteProvider({
     const day = boardFor(ctx.board, restaurant, date);
     if (!day && failed.board?.restaurant === restaurant && failed.board.date === date) {
       // The guest never saw this day's times: sending would book the default time unseen.
+      // The drawer says why beside its Try again; take the guest there.
       setTried(true);
-      setWaitNote({ kind: 'network', restaurant, date });
+      setFailureNudge((n) => n + 1);
       return;
     }
     // Without the day's board (still on its way) the server alone decides.
@@ -731,20 +750,17 @@ export function SiteProvider({
      and only for what is chosen now: the dates (no calendar for this
      restaurant), else the chosen day's times. */
   const loadFailed = useMemo<SiteState['loadFailed']>(() => {
-    if (failed.calendar === booking.restaurant && !chosenCalendar) return { at: 'dates', count: failed.count };
+    const code = (gone: boolean): LoadFailure => (gone ? 'restaurant_unavailable' : 'network');
+    const dates = failed.calendar;
+    if (dates?.restaurant === booking.restaurant && !chosenCalendar) return { at: 'dates', count: failed.count, code: code(dates.gone) };
     const day = failed.board;
     if (day && day.restaurant === booking.restaurant && day.date === booking.date && !chosenBoard) {
-      return { at: 'times', count: failed.count };
+      return { at: 'times', count: failed.count, code: code(day.gone) };
     }
     return null;
   }, [booking.date, booking.restaurant, chosenBoard, chosenCalendar, failed]);
-  /* The footer's note, while the choice is still the one it is about. */
-  const footNote =
-    waitNote && waitNote.restaurant === booking.restaurant && (!waitNote.date || waitNote.date === booking.date)
-      ? waitNote
-      : null;
-  const footError = serverError ?? (footNote?.kind === 'network' ? strings['error.network'] : null);
-  const footLoading = footNote?.kind === 'loading';
+  /* The footer's wait note, while the restaurant is still the one it is about. */
+  const footLoading = waitNote !== null && waitNote.restaurant === booking.restaurant;
 
   const value = useMemo<SiteState>(
     () => ({
@@ -775,6 +791,7 @@ export function SiteProvider({
       board: chosenBoard,
       loadFailed,
       retryAvailability,
+      failureNudge,
       dateMoved,
       now,
       strings,
@@ -790,7 +807,7 @@ export function SiteProvider({
       done,
       pending,
       reference,
-      serverError: footError,
+      serverError,
       footLoading,
       errors,
       submit,
@@ -813,10 +830,10 @@ export function SiteProvider({
     }),
     [
       applyFinder, booked, booking, bookable, chosenBoard, clearFilters, close, closeDrawer, closeDropdown,
-      confirmedDate, consent, dateMoved, days, done, errors, filter, finder, footError, footLoading, form, goBackToRestaurants,
+      confirmedDate, consent, dateMoved, days, done, errors, failureNudge, filter, finder, footLoading, form, goBackToRestaurants,
       goHomeTop, groupPhone, honeypot, lang, loadFailed, locale, matches, maxParty, now, open, openDropdown, openReserve,
       openRestaurant, overlay, pageRoot, pending, pickCuisine, pickDestination, query, reference, restaurants,
-      retryAvailability, scrollToId, scrolled, setBooking, setFilter, setFinder, setFormField, showPage, shownCount,
+      retryAvailability, scrollToId, scrolled, serverError, setBooking, setFilter, setFinder, setFormField, showPage, shownCount,
       strings, submit, tab, today, toggleDropdown, tried, view,
     ],
   );
```

- [ ] **Bước 6: Drawer và thanh đặt bàn**

Hiệu ứng khôi phục focus chạy sau mỗi lần render (không danh sách phụ thuộc: mục tiêu xuất hiện cùng câu trả lời, và khi không có Thử lại nào đang chờ thì nó chỉ đọc một ref); nó không giành focus nếu focus còn ở trong drawer. Sửa `components/overlays/ReserveDrawer.tsx`:

```diff
diff --git a/components/overlays/ReserveDrawer.tsx b/components/overlays/ReserveDrawer.tsx
index 979e562..003c7cf 100644
--- a/components/overlays/ReserveDrawer.tsx
+++ b/components/overlays/ReserveDrawer.tsx
@@ -1,6 +1,6 @@
 'use client';
 
-import { useId, useLayoutEffect, useRef, useState } from 'react';
+import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
 import { DESTS, DEST_KEYS, MEAL_LABELS } from '@/lib/data';
 import { FIELD_MAX, findRestaurant, fmtDay, guestLabel } from '@/lib/booking';
 import { dayReason, movedReason, slotOpen, type DateMove } from '@/lib/booking/client';
@@ -8,7 +8,7 @@ import type { DayInfo } from '@/lib/booking/api';
 import type { GroupPhone } from '@/lib/booking/rules';
 import { formatMessage, type MessageParams } from '@/lib/i18n/format';
 import { formatDay, type IsoDate } from '@/lib/venue-time';
-import { useSite, type ClientStrings } from '@/components/site/SiteProvider';
+import { useSite, type ClientStrings, type LoadFailure } from '@/components/site/SiteProvider';
 import { Dropdown, type Option } from '@/components/ui/Dropdown';
 import { animateSelector, useOpenAnimation } from '@/lib/motion';
 import { privacyHref } from '@/lib/legal';
@@ -27,17 +27,36 @@ function WithPhone({ template, params, phone }: { template: string; params: Mess
   );
 }
 
-/** Availability that did not arrive: the network message and a way to ask again. */
-function LoadFailed({ count, strings, onRetry }: { count: number; strings: ClientStrings; onRetry: () => void }) {
+/**
+ * Availability that did not arrive: why, and a way to ask again when asking
+ * again can help. A 404 (the restaurant stopped taking online bookings) gets
+ * its own message and no Try again. The message describes the button, so a
+ * guest sent here by REQUEST BOOKING hears why. tabIndex -1: REQUEST BOOKING
+ * moves the focus here when there is no button to land on.
+ */
+function LoadFailed({
+  count,
+  code,
+  strings,
+  onRetry,
+}: {
+  count: number;
+  code: LoadFailure;
+  strings: ClientStrings;
+  onRetry: () => void;
+}) {
+  const messageId = useId();
   return (
-    <div className="load-failed">
+    <div className="load-failed" tabIndex={-1}>
       {/* A new alert per failure, so a Try again that fails again is read out again. */}
-      <div key={count} className="drawer-error" role="alert">
-        {strings['error.network']}
+      <div key={count} id={messageId} className="drawer-error" role="alert">
+        {strings[`error.${code}`]}
       </div>
-      <button type="button" className="load-retry" onClick={onRetry}>
-        {strings['booking.retry']}
-      </button>
+      {code === 'network' && (
+        <button type="button" className="load-retry" aria-describedby={messageId} onClick={onRetry}>
+          {strings['booking.retry']}
+        </button>
+      )}
     </div>
   );
 }
@@ -160,6 +179,7 @@ export function ReserveDrawer() {
     board,
     loadFailed,
     retryAvailability,
+    failureNudge,
     dateMoved,
     now,
     strings,
@@ -183,6 +203,37 @@ export function ReserveDrawer() {
 
   const open = overlay === 'drawer';
   const hintId = useId();
+  const drawerRef = useRef<HTMLElement>(null);
+
+  /* Try again removes itself once the answer arrives, and a removed button
+     drops the focus to <body>, outside this modal dialog. The focus moves to
+     what arrived instead: the chosen day, or the chosen time. Checked after
+     every render (no dependency list): the target appears with the answer,
+     and the check is a ref read until a Try again is pending. */
+  const retriedAt = useRef<'dates' | 'times' | null>(null);
+  const retry = () => {
+    retriedAt.current = loadFailed?.at ?? null;
+    retryAvailability();
+  };
+  useLayoutEffect(() => {
+    const at = retriedAt.current;
+    const root = drawerRef.current;
+    if (!at || !root || loadFailed?.at === at) return; // still failing: the button is still there
+    const target =
+      at === 'dates'
+        ? root.querySelector<HTMLElement>('.daystrip .day[aria-pressed="true"]')
+        : (root.querySelector<HTMLElement>('.slot[data-selected="true"]') ?? root.querySelector<HTMLElement>('.slot:not([disabled])'));
+    if (!target) return; // the times are still on their way
+    retriedAt.current = null;
+    if (!root.contains(document.activeElement)) target.focus();
+  });
+
+  /* REQUEST BOOKING stopped on a failure shown above: take the guest to it (its Try again, or the message). */
+  useEffect(() => {
+    if (!failureNudge) return;
+    const failure = drawerRef.current?.querySelector<HTMLElement>('.load-failed');
+    (failure?.querySelector<HTMLElement>('.load-retry') ?? failure)?.focus();
+  }, [failureNudge]);
 
   useOpenAnimation(open, (animate) => {
     animate('[data-anim="drawer"]', [{ transform: 'translateX(100%)' }, { transform: 'none' }], 800);
@@ -222,7 +273,7 @@ export function ReserveDrawer() {
         onClick={closeDrawer}
       />
 
-      <aside data-anim="drawer" className="drawer">
+      <aside ref={drawerRef} data-anim="drawer" className="drawer">
         <div className="drawer-head">
           <div className="drawer-head-copy">
             <div className="drawer-kicker">RESERVE A TABLE</div>
@@ -295,7 +346,7 @@ export function ReserveDrawer() {
 
               <div className="drawer-label">DATE</div>
               {loadFailed?.at === 'dates' ? (
-                <LoadFailed count={loadFailed.count} strings={strings} onRetry={retryAvailability} />
+                <LoadFailed count={loadFailed.count} code={loadFailed.code} strings={strings} onRetry={retry} />
               ) : (
                 <DayStrip
                   days={days}
@@ -353,7 +404,7 @@ export function ReserveDrawer() {
               <div className="drawer-label">TIME</div>
               {loadFailed
                 ? loadFailed.at === 'times' && (
-                    <LoadFailed count={loadFailed.count} strings={strings} onRetry={retryAvailability} />
+                    <LoadFailed count={loadFailed.count} code={loadFailed.code} strings={strings} onRetry={retry} />
                   )
                 : !board && booking.date && <div className="slot-loading">{strings['booking.loading']}</div>}
               {board?.state === 'closed' && <div className="drawer-error">{strings['error.closed']}</div>}
```

Sửa `components/booking/BookingBar.tsx` (vùng `status` nằm ngoài lưới `.booking-panel`, nên khi rỗng nó không thêm khoảng `gap` nào):

```diff
diff --git a/components/booking/BookingBar.tsx b/components/booking/BookingBar.tsx
index 285fde1..f4e4653 100644
--- a/components/booking/BookingBar.tsx
+++ b/components/booking/BookingBar.tsx
@@ -9,7 +9,7 @@ import { useReveal } from '@/lib/motion';
 
 /** The wide "Where would you like to dine?" bar above the footer. */
 export function BookingBar() {
-  const { bookable, booking, setBooking, board, openReserve, days, maxParty, now, strings } = useSite();
+  const { bookable, booking, setBooking, board, openReserve, days, maxParty, now, strings, loadFailed } = useSite();
   const title = useReveal<HTMLHeadingElement>('title');
   const panel = useReveal<HTMLDivElement>('up');
 
@@ -108,6 +108,9 @@ export function BookingBar() {
             FIND A TABLE<span className="arrow">→</span>
           </button>
         </div>
+        {/* Without its dates or times the bar would just sit empty: say why (FIND A TABLE asks again).
+            Always mounted and empty otherwise, so it takes no space and is read out when it fills. */}
+        <div role="status">{loadFailed && <p className="booking-note">{strings[`error.${loadFailed.code}`]}</p>}</div>
       </div>
     </section>
   );
```

Sửa `styles/booking.css`:

```diff
diff --git a/styles/booking.css b/styles/booking.css
index d4d559d..a972474 100644
--- a/styles/booking.css
+++ b/styles/booking.css
@@ -68,6 +68,15 @@
   padding: 0 28px;
 }
 
+/* Why the bar has no dates or times (BookingBar). */
+.booking-note {
+  margin: 16px 0 0;
+  text-align: center;
+  font-size: 14px;
+  line-height: 1.5;
+  color: var(--on-dark);
+}
+
 @media (min-width: 760px) {
   .booking-fields {
     grid-template-columns: repeat(3, minmax(0, 1fr));
```

- [ ] **Bước 7: Chạy cổng kiểm tra**

Expected:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo (hiệu ứng không danh sách phụ thuộc là để không thêm cảnh báo `exhaustive-effect-dependencies`; bỏ `answered` khỏi phụ thuộc của `loadBoard` vì nó không còn dùng);
- `Test Files  63 passed (63)`, `Tests  809 passed (809)`;
- `Applied 7 migration(s).`; build thoát 0; check-prerender như Task 8;
- E2E `133 passed`; visual `8 passed`.

- [ ] **Bước 8: Commit**

```bash
git add app/api/availability/route.ts components/booking/BookingBar.tsx components/overlays/ReserveDrawer.tsx components/site/SiteProvider.tsx e2e/booking-v2.spec.ts styles/booking.css test/integration/availability.test.ts
git commit -m "$(cat <<'EOF'
fix: say why availability is missing once, keep the focus in the drawer, and answer junk availability requests without a query

The phase-4 deferrals of the guest form's error paths (T5, T6). A 404 from
/api/availability (the restaurant stopped taking online bookings while the
page was open) now reads "That restaurant is no longer available." with no
Try again, which could never help. REQUEST BOOKING pressed while the dates or
times are missing no longer repeats the message as a second alert in the
footer: it moves the focus to the message's Try again, which the message
describes, and asks for the dates again. A Try again that succeeds removes
itself; the focus then moves to the chosen day or time instead of falling to
<body> behind the modal. The booking bar, which sat empty when the calendar
failed, says why.

/api/availability answers a range given in full that is backwards or too
long (400 invalid_range) and a restaurant id that cannot exist (404) before
it reads anything from the database.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```
---

### Task 11: BotID

Lớp thứ hai của bước 1 (spec §10.2, R16), sau honeypot: Vercel BotID. Hai nửa, cả hai chỉ có trên một deployment Vercel (`VERCEL_ENV`/`NEXT_PUBLIC_VERCEL_ENV` là `production` hoặc `preview`):
- **Trình duyệt:** `instrumentation-client.ts` chạy trước hydration (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation-client.md:117-127`; chỉ code đồng bộ chắc chắn xong trước) và gọi `initBotId({ protect: [{ path: '/*', method: 'POST' }] })` trên trang khách. BotID bọc `window.fetch`; Server Action là một POST tới URL của chính trang (`01-app/03-api-reference/03-file-conventions/proxy.md:249`) mà client action của Next gửi bằng `fetch` toàn cục lúc gọi (`next/dist/client/components/router-reducer/reducers/server-action-reducer.js:74` → `segment-cache/fetch.js:28`), nên mỗi lần đặt bàn mang câu trả lời thử thách `x-is-human`. Trang admin không bao giờ cài nó.
- **Server:** `isBotRequest()` gọi `checkBotId()` và từ chối cả bot đã xác minh; BotID không trả lời được (OIDC tắt, Vercel lỗi) hoặc chưa trả lời sau `BOTID_TIMEOUT_MS = 3_000` ms (fetch của `checkBotId` tới api.vercel.com trong botid 1.5.11 không có `AbortSignal` hay hạn nào) thì cho qua và log `[botid] check failed` không dữ liệu request. Ngoài Vercel không hỏi ai; `BOTID_DEV_BYPASS=BAD-BOT` dùng chế độ bypass của chính BotID để gọi mọi người là bot (test). Deployment bỏ qua biến đó.
- `withBotId` thêm rewrite của script và API của BotID dưới `/149e9513-01fa-4fb0-aad4-566afd725d1b/…` tới api.vercel.com. Proxy chạy trước rewrite (`proxy.md:236-247`), và matcher hiện tại sẽ 307 các đường không có dấu chấm của BotID sang `/en/149e9513-…`: matcher bỏ qua tiền tố đó.

**Files:**
- Create: `lib/botid.ts`, `lib/botid.test.ts`, `instrumentation-client.ts`, `lib/server/guard/bot.ts`, `lib/server/guard/bot.test.ts`, `e2e/botid.spec.ts`
- Modify: `package.json`, `package-lock.json`, `next.config.ts`, `proxy.ts`, `lib/i18n/proxy-matcher.test.ts`, `app/actions.ts`, `test/integration/submit-reservation.test.ts`, `test/guards/require-permission.guard.test.ts`, `e2e/guest-guard.spec.ts`

**Interfaces:**
- Consumes: `honeypotFilled` (Task 9); `botid@1.5.11`: `initBotId` (`botid/client/core`), `checkBotId` (`botid/server`), `withBotId` (`botid/next/config`).
- Produces:
  - `lib/botid.ts`: `BOTID_PROTECT = [{ path: '/*', method: 'POST' }]`; `botIdEnabled(vercelEnv: string | undefined, pathname: string): boolean`.
  - `lib/server/guard/bot.ts`: `type BotCheck = typeof checkBotId`; `BOTID_TIMEOUT_MS = 3_000`; `isBotRequest(env = process.env, check: BotCheck = checkBotId): Promise<boolean>`.
  - `submitReservation` bước 1: honeypot, rồi BotID; log `[booking] refused as a bot { by: 'honeypot' | 'botid' }`.

- [ ] **Bước 1: Cài gói**

Như Task 2: từ cache npm của máy, chỉ bỏ `--offline` khi lệnh báo `ENOTCACHED`:

```bash
npm install --offline --save-exact botid@1.5.11
npm audit
```

Expected: `package.json` có `"botid": "1.5.11"` (đúng bản, không `^`); `package.json` và `package-lock.json` trùng từng byte với hai file của commit Task 11 (đã kiểm trên hai file của Task 10); `found 0 vulnerabilities`. Gói không có dependency nào; peer `next` và `react` là tùy chọn.

- [ ] **Bước 2: Viết test**

Wrapper BotID thật (`initBotId` của gói) chạy trên một trình duyệt tối thiểu với một câu trả lời thử thách có sẵn: điều được kiểm là của ta, `BOTID_PROTECT` làm wrapper gắn `x-is-human` lên POST của Server Action tới mọi trang khách và không gắn lên gì khác. Create `lib/botid.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BOTID_PROTECT, botIdEnabled } from './botid';

describe('botIdEnabled', () => {
  it.each([
    ['production', '/en', true],
    ['preview', '/en/restaurants/taya-house', true],
    ['preview', '/vi/privacy', true],
    ['production', '/admin', false],
    ['production', '/admin/reservations', false],
    ['development', '/en', false], // vercel dev / vercel env pull
    [undefined, '/en', false], // local, CI, E2E: nobody can answer the challenge
  ])('%s %s → %s', (env, path, on) => {
    expect(botIdEnabled(env, path)).toBe(on);
  });

  it('a guest path that merely starts with "admin" is still a guest path', () => {
    expect(botIdEnabled('production', '/administration')).toBe(true);
  });
});

/*
 * The real initBotId from botid/client/core, run against a minimal browser:
 * the challenge script counts as loaded and window.V_C already holds an
 * answer, which is what Vercel's c.js pushes. What is checked is ours: that
 * BOTID_PROTECT makes the wrapper put x-is-human on a Server Action's POST to
 * any guest page, and on nothing else.
 */
describe('BOTID_PROTECT under the real BotID fetch wrapper', () => {
  const sent: { url: string; method: string; headers: Headers }[] = [];
  const original = { window: globalThis.window, document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch };

  beforeAll(async () => {
    const fakeWindow = {
      V_C: [{ b: 1, v: 'challenge-answer', e: 'e', d: 0 }],
      location: new URL('https://cuisine.example/en'),
      addEventListener: () => {},
      fetch: async (input: string | URL, init: RequestInit = {}) => {
        sent.push({ url: String(input), method: init.method ?? 'GET', headers: new Headers(init.headers) });
        return new Response('ok');
      },
    };
    Object.assign(globalThis, {
      window: fakeWindow,
      location: fakeWindow.location,
      // Every <script src> counts as present, so getChallenge does not wait for a load.
      document: { querySelector: () => ({}), hidden: false, addEventListener: () => {} },
      // BotID patches XMLHttpRequest too; these tests only use fetch.
      XMLHttpRequest: class {
        open() {}
        send() {}
      },
    });
    const { initBotId } = await import('botid/client/core');
    initBotId({ protect: BOTID_PROTECT });
  });

  afterAll(() => {
    Object.assign(globalThis, original);
    vi.resetModules();
  });

  /** What Next's action client does (segment-cache/fetch.js:28): the global fetch, at call time, to the page's URL. */
  const callAction = (url: string) =>
    window.fetch(url, { method: 'POST', headers: { accept: 'text/x-component', 'next-action': 'abc123' }, body: '[]' });

  it.each(['/en', '/en/restaurants/taya-house', '/vi/privacy', '/zh-hans/restaurants/don-ciprianis?x=1'])(
    'a Server Action posted to %s carries the challenge answer',
    async (url) => {
      sent.length = 0;
      await callAction(url);
      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0].headers.get('x-is-human')!)).toMatchObject({ v: 'challenge-answer' });
      expect(sent[0].headers.get('x-path')).toBe(new URL(url, 'https://cuisine.example').pathname);
      expect(sent[0].headers.get('x-method')).toBe('POST');
      // Next's own headers survive the wrapper.
      expect(sent[0].headers.get('next-action')).toBe('abc123');
    },
  );

  it('the availability GETs and another site are left alone', async () => {
    sent.length = 0;
    await window.fetch('/api/availability?restaurant=taya-house&lang=en');
    await window.fetch('https://other.example/en', { method: 'POST' });
    expect(sent.map((s) => s.headers.has('x-is-human'))).toEqual([false, false]);
  });
});
```

Create `lib/server/guard/bot.test.ts` (gồm `checkBotId` thật trên một "deployment" không có token OIDC: nó ném, nên đường cho qua là đường thật sự chạy; và một `check` không bao giờ xong dưới fake timers: sau đúng 3 s đặt bàn đi tiếp):

```ts
import { checkBotId } from 'botid/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOTID_TIMEOUT_MS, isBotRequest, type BotCheck } from './bot';

type Verdict = Awaited<ReturnType<BotCheck>>;
const verdict = (isBot: boolean, extra: Partial<Verdict> = {}): Verdict =>
  ({ isHuman: !isBot, isBot, isVerifiedBot: false, bypassed: false, ...extra }) as Verdict;

afterEach(() => vi.restoreAllMocks());

describe('isBotRequest off Vercel (local, CI, E2E)', () => {
  it('asks nobody and lets everyone through', async () => {
    const check = vi.fn<BotCheck>();
    expect(await isBotRequest({}, check)).toBe(false);
    expect(await isBotRequest({ VERCEL_ENV: 'development' }, check)).toBe(false); // vercel dev / vercel env pull
    expect(check).not.toHaveBeenCalled();
  });

  it('BOTID_DEV_BYPASS=BAD-BOT blocks through BotID’s own development bypass (the real package, no network)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // BotID notes the missing x-is-human header
    expect(await isBotRequest({ BOTID_DEV_BYPASS: 'BAD-BOT' })).toBe(true);
    // Any other value is the default: human.
    expect(await isBotRequest({ BOTID_DEV_BYPASS: 'HUMAN' })).toBe(false);
  });

  it('the bypass passes isDevelopment, so it works under next start (NODE_ENV=production) too', async () => {
    const check = vi.fn<BotCheck>(async () => verdict(true));
    await isBotRequest({ BOTID_DEV_BYPASS: 'BAD-BOT' }, check);
    expect(check).toHaveBeenCalledWith({ developmentOptions: { isDevelopment: true, bypass: 'BAD-BOT' } });
  });
});

describe('isBotRequest on a Vercel deployment', () => {
  it.each(['production', 'preview'])('%s: asks BotID with no options and follows its verdict', async (VERCEL_ENV) => {
    const check = vi.fn<BotCheck>(async () => verdict(true));
    expect(await isBotRequest({ VERCEL_ENV }, check)).toBe(true);
    expect(check).toHaveBeenCalledWith();
    check.mockResolvedValueOnce(verdict(false));
    expect(await isBotRequest({ VERCEL_ENV }, check)).toBe(false);
  });

  it('ignores BOTID_DEV_BYPASS', async () => {
    const check = vi.fn<BotCheck>(async () => verdict(false));
    expect(await isBotRequest({ VERCEL_ENV: 'production', BOTID_DEV_BYPASS: 'BAD-BOT' }, check)).toBe(false);
    expect(check).toHaveBeenCalledWith();
  });

  it('refuses a verified bot too: booking is for people', async () => {
    const check = vi.fn<BotCheck>(async () => verdict(true, { isVerifiedBot: true }));
    expect(await isBotRequest({ VERCEL_ENV: 'production' }, check)).toBe(true);
  });

  it('fails open when BotID cannot answer, and logs no request data', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    // What checkBotId throws when the project has OIDC switched off.
    const check = vi.fn<BotCheck>(async () => {
      throw new Error("The 'x-vercel-oidc-token' header is missing from the request.");
    });
    expect(await isBotRequest({ VERCEL_ENV: 'production' }, check)).toBe(false);
    expect(log).toHaveBeenCalledWith('[botid] check failed, request let through', {
      name: 'Error',
      message: "The 'x-vercel-oidc-token' header is missing from the request.",
    });
  });

  it('fails open when BotID does not answer within 3 s', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // checkBotId's fetch to Vercel has no deadline of its own: a hanging API never settles.
      const check = vi.fn<BotCheck>(() => new Promise<Verdict>(() => {}));
      let settled = false;
      const pending = isBotRequest({ VERCEL_ENV: 'production' }, check).finally(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(BOTID_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toBe(false);
      expect(BOTID_TIMEOUT_MS).toBe(3_000);
      expect(log).toHaveBeenCalledWith('[botid] check failed, request let through', { name: 'TimeoutError', message: 'no verdict within 3000 ms' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('the real checkBotId, deployed but with no OIDC token, throws (so the fail-open path is the one that runs)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const saved = process.env.VERCEL_OIDC_TOKEN;
    delete process.env.VERCEL_OIDC_TOKEN;
    try {
      await expect(checkBotId({ developmentOptions: { isDevelopment: false } })).rejects.toThrow(/x-vercel-oidc-token/);
    } finally {
      if (saved !== undefined) process.env.VERCEL_OIDC_TOKEN = saved;
    }
  });
});
```

Sửa `lib/i18n/proxy-matcher.test.ts`:

```diff
diff --git a/lib/i18n/proxy-matcher.test.ts b/lib/i18n/proxy-matcher.test.ts
index e75617e..d13339a 100644
--- a/lib/i18n/proxy-matcher.test.ts
+++ b/lib/i18n/proxy-matcher.test.ts
@@ -52,3 +52,16 @@ describe('proxy matcher', () => {
   // so the proxy skips it and it 404s. Real unprefixed top-level names need 4+ letters.
   it('treats a 2–3 letter first segment as a locale', () => expect(m('/faq/x')).toBe(false));
 });
+
+// BotID's challenge script and API (botid/next/config rewrites them to Vercel). The proxy runs
+// before rewrites (proxy.md:236-247), so matching here would send them to /en/149e9513-….
+describe('proxy matcher and BotID', () => {
+  it.each([
+    '/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3/a-4-a/c.js?i=0&v=3&h=x',
+    '/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3/p.js',
+    '/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3/tl',
+    '/149e9513-01fa-4fb0-aad4-566afd725d1b',
+  ])('skips %s', (u) => expect(m(u)).toBe(false));
+
+  it('still runs on an unprefixed path that merely starts with digits', () => expect(m('/149e9513')).toBe(true));
+});
```

Sửa `test/integration/submit-reservation.test.ts` (bypass `BAD-BOT` qua chính `checkBotId`, không mock):

```diff
diff --git a/test/integration/submit-reservation.test.ts b/test/integration/submit-reservation.test.ts
index f6c8204..36212bc 100644
--- a/test/integration/submit-reservation.test.ts
+++ b/test/integration/submit-reservation.test.ts
@@ -300,6 +300,24 @@ describe.skipIf(!process.env.TEST_DATABASE_URL)('submitReservation v2 (database)
       expect(await submitReservation({ honeypot: 'x', name: 'A' })).toEqual({ ok: false, code: 'bot_blocked' });
       warn.mockRestore();
     });
+
+    it('BotID’s verdict (its development bypass set to BAD-BOT) answers bot_blocked', async () => {
+      vi.stubEnv('BOTID_DEV_BYPASS', 'BAD-BOT');
+      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
+      const error = vi.spyOn(console, 'error').mockImplementation(() => {}); // BotID: no x-is-human header off Vercel
+      try {
+        expect(await submitReservation(request)).toEqual({ ok: false, code: 'bot_blocked' });
+        expect(warn).toHaveBeenCalledWith('[booking] refused as a bot', { by: 'botid' });
+      } finally {
+        vi.unstubAllEnvs();
+        warn.mockRestore();
+        error.mockRestore();
+      }
+      expect(await count()).toBe(0);
+      expect(afterTasks).toHaveLength(0);
+      // Off Vercel and without the bypass, the same request books.
+      expect(await submitReservation(request)).toMatchObject({ ok: true });
+    });
   });
 
   describe('consent (spec §11)', () => {
```

Sửa `test/guards/require-permission.guard.test.ts`:

```diff
diff --git a/test/guards/require-permission.guard.test.ts b/test/guards/require-permission.guard.test.ts
index ea44307..8905622 100644
--- a/test/guards/require-permission.guard.test.ts
+++ b/test/guards/require-permission.guard.test.ts
@@ -14,7 +14,7 @@ import { actionPermissions, adminOnlyProblems, adminPluginCalls, adminPluginCall
 const PUBLIC_ACTIONS = new Map([
   [
     'app/actions.ts#submitReservation',
-    'the honeypot first, then zod with consent, the per-phone daily limit, the slot and window checks, the per-table unique index (spec §7.1, §10.2)',
+    'honeypot and BotID first, then zod with consent, the per-phone daily limit, the slot and window checks, the per-table unique index (spec §7.1, §10.2)',
   ],
   ['app/admin/(auth)/sign-in/actions.ts#signIn', 'Better Auth checks the password, rate-limited per IP in auth_rate_limit'],
   ['app/admin/(shell)/actions.ts#signOut', 'ends only the session of the cookie it is sent with'],
```

- [ ] **Bước 3: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/botid.test.ts lib/server/guard/bot.test.ts lib/i18n/proxy-matcher.test.ts test/integration/submit-reservation.test.ts`
Expected: FAIL `Test Files  4 failed (4)`, `Tests  3 failed | 62 passed (65)` (hai đường có dấu chấm, `…/c.js` và `…/p.js`, vốn đã được matcher bỏ qua):

```
 ❯ test/integration/submit-reservation.test.ts (28 tests | 1 failed) 1282ms
       × BotID’s verdict (its development bypass set to BAD-BOT) answers bot_blocked 24ms
 ❯ lib/server/guard/bot.test.ts (0 test)
 ❯ lib/botid.test.ts (0 test)
 ❯ lib/i18n/proxy-matcher.test.ts (37 tests | 2 failed) 10ms
     × skips /149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3/tl 2ms
     × skips /149e9513-01fa-4fb0-aad4-566afd725d1b 0ms
Error: Cannot find module './botid' imported from …/lib/botid.test.ts
Error: Cannot find module './bot' imported from …/lib/server/guard/bot.test.ts
AssertionError: expected true to be false // Object.is equality
AssertionError: expected { ok: true, data: { …(3) } } to deeply equal { ok: false, code: 'bot_blocked' }
```

- [ ] **Bước 4: Viết E2E, và chạy spec BotID riêng trên build hiện tại: phải đỏ**

Test honeypot của `e2e/guest-guard.spec.ts` kiểm thêm rằng ngoài Vercel action không mang `x-is-human` (client không cài BotID). Sửa `e2e/guest-guard.spec.ts`:

```diff
diff --git a/e2e/guest-guard.spec.ts b/e2e/guest-guard.spec.ts
index 760496b..f6db266 100644
--- a/e2e/guest-guard.spec.ts
+++ b/e2e/guest-guard.spec.ts
@@ -9,6 +9,9 @@ import { expect, one, test } from './staff-fixtures';
  * privacy notice, the consent box and the policy page; the honeypot; the
  * per-phone limit's message. The footer link to the policy is hidden from the
  * visual specs by e2e/visual-added.css, so this spec is what checks it.
+ * BotID is off outside Vercel: the honeypot test checks the built client sends
+ * no challenge header here, and e2e/botid.spec.ts walks the blocked path in a
+ * run of its own (BOTID_DEV_BYPASS=BAD-BOT).
  * Pho Cuon's last open day (today + 13) is this spec's own: no other spec
  * books there.
  */
@@ -93,6 +96,8 @@ test('the honeypot is invisible to people and screen readers, out of the tab ord
   // Never a fake success (R15): the guest is told, with the restaurant's number to call.
   await expect(drawer.getByRole('alert')).toHaveText(`We could not accept this request online. Please call us on ${GROUP_PHONE.display} to book.`);
   expect(posts).toHaveLength(1);
+  // Off Vercel, BotID is not installed (lib/botid.ts botIdEnabled): no challenge rides on the action.
+  expect(posts[0].headers['x-is-human']).toBeUndefined();
   expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM reservations WHERE phone_e164 = $1`, [`+84905${digits}`]))!.n).toBe(0);
 });
 
```

Create `e2e/botid.spec.ts` (bị `test.skip` trừ khi server chạy với `BOTID_DEV_BYPASS=BAD-BOT`; mọi đặt bàn trên server đó bị từ chối, nên nó chạy riêng):

```ts
import { HOME_PATH } from './paths';
import { expect, one, test } from './staff-fixtures';

/*
 * BotID's blocked path through a real server (spec §10.2 step 1). Off Vercel
 * nobody can judge a request, so this runs only when the server was started
 * with BOTID_DEV_BYPASS=BAD-BOT (lib/server/guard/bot.ts), which makes BotID's
 * own development bypass call every caller a bot. Every booking on that
 * server is refused, so it is a run of its own, never beside the other specs:
 *   BOTID_DEV_BYPASS=BAD-BOT <the E2E env prefix> npx playwright test e2e/botid.spec.ts --project=desktop
 */
test.skip(process.env.BOTID_DEV_BYPASS !== 'BAD-BOT', 'needs a server started with BOTID_DEV_BYPASS=BAD-BOT');
test.use({ reducedMotion: 'reduce' });

test('a request BotID calls a bot is refused with the number to call, and nothing is stored', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  await page.goto(HOME_PATH);
  await page.getByRole('button', { name: 'RESERVE', exact: true }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  await drawer.locator('.daystrip .day[data-state="open"]').last().click();
  await drawer.locator('.slot:not([disabled])').first().click();
  await drawer.getByLabel('Full name *', { exact: true }).fill('Nguyễn Minh Anh');
  const digits = String(Date.now()).slice(-6);
  await drawer.getByLabel('Phone *', { exact: true }).fill(`0907 ${digits.slice(0, 3)} ${digits.slice(3)}`);
  await drawer.getByRole('checkbox', { name: 'I agree to Furama Cuisine using my details as described in the privacy policy.' }).check();
  await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
  await expect(drawer.getByRole('alert')).toHaveText('We could not accept this request online. Please call us on +84 236 651 9999 to book.');
  expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM reservations WHERE phone_e164 = $1`, [`+84907${digits}`]))!.n).toBe(0);
});
```

Cất tạm các file ngoài `e2e/`, build (lệnh build của cổng kiểm tra), chạy riêng spec BotID với biến bypass trong tiền tố (`webServer` của Playwright thừa kế env; tiền tố là tiền tố cục bộ của Global Constraints với `BOTID_DEV_BYPASS=BAD-BOT` thay cho `BOTID_DEV_BYPASS=`):

```bash
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS=BAD-BOT DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson CRON_SECRET=$(openssl rand -hex 16) E2E_PORT=3210 npx playwright test e2e/botid.spec.ts --project=desktop --retries=0
```

Expected: `1 failed` (chưa có BotID: đặt bàn đi qua):

```
  ✘  1 [desktop] › e2e/botid.spec.ts:15:5 › a request BotID calls a bot is refused with the number to call, and nothing is stored (6.3s)
    Error: expect(locator).toHaveText(expected) failed
    Expected: "We could not accept this request online. Please call us on +84 236 651 9999 to book."
    Error: element(s) not found
      - waiting for getByRole('dialog', { name: 'Reserve a table' }).getByRole('alert')
```

Lấy lại các file đã cất. (Đặt bàn vừa ghi nằm trong DB e2e cục bộ; cổng kiểm tra reset DB.)

- [ ] **Bước 5: Nửa trình duyệt**

Create `lib/botid.ts`:

```ts
/*
 * Vercel BotID, browser half (spec §10.2 step 1). instrumentation-client.ts
 * calls initBotId with this list before hydration; BotID then wraps
 * window.fetch, and every same-origin request matching an entry waits for a
 * challenge answer and carries it as x-is-human. submitReservation's
 * checkBotId (lib/server/guard/bot.ts) sends that answer to Vercel.
 *
 * A Server Action is not a route of its own: the browser POSTs it to the URL
 * of the page it runs on (proxy.md:249), and Next's action client calls the
 * global fetch at that moment (next/dist/client/components/segment-cache/
 * fetch.js:28), so the wrapper sees it. The drawer opens on every guest page
 * in every language, so the entry is every POST; the guest site sends no
 * other POST. Admin pages never install BotID (botIdEnabled), so their
 * actions are untouched.
 */
export const BOTID_PROTECT = [{ path: '/*', method: 'POST' }];

/** VERCEL_ENV of a Vercel deployment, as NEXT_PUBLIC_VERCEL_ENV inlines it at build. */
const DEPLOYED = new Set(['production', 'preview']);

/**
 * Only a Vercel deployment can answer BotID's challenge (its script is a
 * rewrite to Vercel added by withBotId in next.config.ts), and only guest
 * pages book. Off Vercel the wrapper would wait on a script that never loads
 * and the booking would fail, so local, CI and E2E runs leave fetch alone.
 */
export function botIdEnabled(vercelEnv: string | undefined, pathname: string): boolean {
  return DEPLOYED.has(vercelEnv ?? '') && pathname !== '/admin' && !pathname.startsWith('/admin/');
}
```

Create `instrumentation-client.ts` (ở gốc repo; điều kiện `NEXT_PUBLIC_VERCEL_ENV` được inline lúc build, nên cục bộ nó là `undefined` và không có gì được cài):

```ts
import { initBotId } from 'botid/client/core';
import { BOTID_PROTECT, botIdEnabled } from '@/lib/botid';

/*
 * Runs in every page's browser bundle, after the HTML loads and before
 * hydration (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
 * instrumentation-client.md:117-127), so BotID wraps fetch before the reserve
 * drawer can send anything. Synchronous on purpose: async work here is not
 * awaited (same file, :127).
 */
if (botIdEnabled(process.env.NEXT_PUBLIC_VERCEL_ENV, window.location.pathname)) {
  initBotId({ protect: BOTID_PROTECT });
}
```

Sửa `next.config.ts`:

```diff
diff --git a/next.config.ts b/next.config.ts
index 6fe751d..12f619e 100644
--- a/next.config.ts
+++ b/next.config.ts
@@ -1,3 +1,4 @@
+import { withBotId } from 'botid/next/config';
 import type { NextConfig } from 'next';
 
 const nextConfig: NextConfig = {
@@ -18,4 +19,7 @@ const nextConfig: NextConfig = {
   },
 };
 
-export default nextConfig;
+// BotID (spec §10.2 step 1): rewrites its challenge script and API under
+// /149e9513-01fa-4fb0-aad4-566afd725d1b/… to Vercel. Requested only where
+// instrumentation-client.ts installs BotID, i.e. on a Vercel deployment.
+export default withBotId(nextConfig);
```

Sửa `proxy.ts`:

```diff
diff --git a/proxy.ts b/proxy.ts
index bebdfd7..65285fb 100644
--- a/proxy.ts
+++ b/proxy.ts
@@ -11,11 +11,14 @@ import { ENABLED_LOCALES, LOCALE_COOKIE, pickLocale } from '@/lib/i18n/locales';
  * locale-shaped segment": 2–3 letters plus optional -subtags, the shape the
  * locales table allows. An unprefixed top-level page of 2–3 letters (/faq) is
  * therefore never redirected; give real top-level pages 4+ letters.
+ * BotID's paths (/149e9513-…/, rewritten to Vercel by withBotId in
+ * next.config.ts) are skipped too: the proxy runs before rewrites
+ * (proxy.md:236-247), so it would send them to /en/149e9513-… instead.
  */
 export const config = {
   matcher: [
     '/admin/:path*',
-    '/((?!api(?:/|$)|_next(?:/|$)|admin(?:/|$)|[a-z]{2,3}(?:-[a-z0-9]{2,8})*(?:/|$)|.*\\..*).*)',
+    '/((?!api(?:/|$)|_next(?:/|$)|admin(?:/|$)|149e9513-01fa-4fb0-aad4-566afd725d1b(?:/|$)|[a-z]{2,3}(?:-[a-z0-9]{2,8})*(?:/|$)|.*\\..*).*)',
   ],
 };
 
```

- [ ] **Bước 6: Nửa server và bước 1**

Create `lib/server/guard/bot.ts` (cùng tập `DEPLOYED = {production, preview}` như `lib/server/email/send.ts`, không bao giờ `VERCEL === '1'`: `vercel env pull` ghi `VERCEL_ENV=development`; `Promise.race` với một bộ hẹn giờ `BOTID_TIMEOUT_MS`, `clearTimeout` trong `finally`, nên quá hạn đi vào cùng nhánh `catch` cho qua):

```ts
import 'server-only';
import { checkBotId } from 'botid/server';

/*
 * Step 1 of submitReservation (spec §10.2): Vercel BotID.
 *
 * In the browser, instrumentation-client.ts makes BotID's script answer a
 * challenge and attach the answer (x-is-human) to the Server Action's POST.
 * Here, checkBotId sends that answer and the deployment's OIDC token to
 * Vercel and gets a verdict back. Both halves exist only on a Vercel
 * deployment, so off Vercel (local, CI, E2E under `next start`) there is
 * nobody to ask and every caller counts as human. BOTID_DEV_BYPASS=BAD-BOT
 * turns that into "every caller is a bot", through BotID's own development
 * bypass (developmentOptions), which is how tests walk the blocked path in a
 * real server. A deployment ignores the variable.
 */

/** VERCEL_ENV of a Vercel deployment. `vercel dev` and `vercel env pull` say 'development': not one. */
const DEPLOYED = new Set(['production', 'preview']);

export type BotCheck = typeof checkBotId;

/**
 * How long a booking waits for BotID's verdict. checkBotId's fetch to Vercel has no deadline of
 * its own (botid 1.5.11), so a slow or hanging BotID API would otherwise hold every guest's submit
 * until the function's maxDuration.
 */
export const BOTID_TIMEOUT_MS = 3_000;

/**
 * True when the request should be refused as a bot. A verified bot (a search
 * crawler, an AI agent acting for someone) is refused too: booking is for
 * people, and the refusal gives the phone number (error.bot_blocked).
 *
 * Fails open: when BotID cannot answer (Vercel's API down, OIDC switched off
 * in the project) or has not answered within BOTID_TIMEOUT_MS, the booking
 * goes ahead and the failure is logged. The honeypot, consent and the
 * per-phone limit still stand, and a guest who cannot book costs more than a
 * bot that gets through for a while.
 */
export async function isBotRequest(
  env: Record<string, string | undefined> = process.env,
  check: BotCheck = checkBotId,
): Promise<boolean> {
  if (!DEPLOYED.has(env.VERCEL_ENV ?? '')) {
    if (env.BOTID_DEV_BYPASS !== 'BAD-BOT') return false;
    const verdict = await check({ developmentOptions: { isDevelopment: true, bypass: 'BAD-BOT' } });
    return verdict.isBot;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const verdict = await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Object.assign(new Error(`no verdict within ${BOTID_TIMEOUT_MS} ms`), { name: 'TimeoutError' })),
          BOTID_TIMEOUT_MS,
        );
      }),
    ]);
    return verdict.isBot;
  } catch (err) {
    // BotID's own messages name configuration, never the guest.
    console.error('[botid] check failed, request let through', {
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : undefined,
    });
    return false;
  } finally {
    clearTimeout(timer);
  }
}
```

Sửa `app/actions.ts` (honeypot trước vì miễn phí; BotID là một lời gọi tới Vercel):

```diff
diff --git a/app/actions.ts b/app/actions.ts
index f76e345..97ac51f 100644
--- a/app/actions.ts
+++ b/app/actions.ts
@@ -4,6 +4,7 @@ import type { BookingErrorCode } from '@/lib/booking-errors';
 import { createWebReservation } from '@/lib/server/booking/create';
 import { honeypotFilled, parseReservationInput } from '@/lib/server/booking/input';
 import { drainAfterCommit } from '@/lib/server/email/after-commit';
+import { isBotRequest } from '@/lib/server/guard/bot';
 import type { IsoDate } from '@/lib/venue-time';
 
 export type ReservationResult =
@@ -12,17 +13,18 @@ export type ReservationResult =
 
 /**
  * Books a table (spec §10.2). Step 1 refuses a bot before anything else runs:
- * the honeypot (free; BotID joins it in phase 5's BotID task). Then zod
- * (step 2, consent included), and one locked transaction for the per-phone
- * limit, the clock and rule checks, the insert and its outbox rows (steps
- * 3–6), and after() once it has committed (step 7). Failures come back as
- * codes; the browser turns them into copy. A database error throws, so the
- * guest sees error.network (spec §12).
+ * the honeypot first (free), then BotID (a call to Vercel, on a deployment
+ * only). Then zod (step 2, consent included), and one locked transaction for
+ * the per-phone limit, the clock and rule checks, the insert and its outbox
+ * rows (steps 3–6), and after() once it has committed (step 7). Failures come
+ * back as codes; the browser turns them into copy. A database error throws,
+ * so the guest sees error.network (spec §12).
  */
 export async function submitReservation(input: unknown): Promise<ReservationResult> {
-  if (honeypotFilled(input)) {
+  const blockedBy = honeypotFilled(input) ? 'honeypot' : (await isBotRequest()) ? 'botid' : null;
+  if (blockedBy) {
     // No guest data in the log (spec §12): only which check refused.
-    console.warn('[booking] refused as a bot', { by: 'honeypot' });
+    console.warn('[booking] refused as a bot', { by: blockedBy });
     return { ok: false, code: 'bot_blocked' };
   }
   const parsed = parseReservationInput(input);
```

- [ ] **Bước 7: Chạy lại test, rồi kiểm danh sách bảo vệ**

Run: lệnh ở Bước 3.
Expected: PASS `Test Files  4 passed (4)`, `Tests  88 passed (88)`

Đột biến: trong `lib/botid.ts` đổi `BOTID_PROTECT` thành `[{ path: '/api/*', method: 'POST' }]` (danh sách "ngây thơ" chỉ bảo vệ API), chạy `npx vitest run lib/botid.test.ts`. Expected: `Tests  4 failed | 9 passed (13)`:

```
     × a Server Action posted to /en carries the challenge answer 13ms
     × a Server Action posted to /en/restaurants/taya-house carries the challenge answer 1ms
     × a Server Action posted to /vi/privacy carries the challenge answer 1ms
     × a Server Action posted to /zh-hans/restaurants/don-ciprianis?x=1 carries the challenge answer 0ms
AssertionError: expected null to match object { v: 'challenge-answer' }
```

Trả `BOTID_PROTECT` về `[{ path: '/*', method: 'POST' }]`.

- [ ] **Bước 8: Chạy cổng kiểm tra, rồi spec BotID riêng**

Expected:
- typecheck không lỗi (kiểu của `botid` biên dịch dưới TypeScript 7.0.2); lint thoát 0, 19 cảnh báo;
- `Test Files  65 passed (65)`, `Tests  838 passed (838)`;
- `Applied 7 migration(s).`; build thoát 0; `.next/routes-manifest.json` có các rewrite `149e9513-…` của `withBotId`; check-prerender như Task 8;
- E2E `133 passed`, `1 skipped` (`botid.spec.ts` khi không có bypass); visual `8 passed`;
- `npm audit`: `found 0 vulnerabilities`.

Sau đó, trên cùng build, chạy lệnh ở Bước 4 (DB e2e vừa dùng ở cổng là được: test chỉ đếm hàng của một số mới). Expected: `1 passed`; log server có `[booking] refused as a bot { by: 'botid' }`, và dòng "Possible misconfiguration of Vercel BotId" (`checkBotId` in nó khi thiếu `x-is-human`, luôn đúng ngoài Vercel; vô hại). Test honeypot của `guest-guard` đã cho thấy client không cài BotID cục bộ (action không mang `x-is-human`), nên trang không tải script nào dưới `/149e9513-…`.

- [ ] **Bước 9: Commit**

```bash
git add app/actions.ts e2e/botid.spec.ts e2e/guest-guard.spec.ts instrumentation-client.ts lib/botid.test.ts lib/botid.ts lib/i18n/proxy-matcher.test.ts lib/server/guard/bot.test.ts lib/server/guard/bot.ts next.config.ts package-lock.json package.json proxy.ts test/guards/require-permission.guard.test.ts test/integration/submit-reservation.test.ts
git commit -m "$(cat <<'EOF'
feat: refuse bookings Vercel BotID calls bots, on deployments only

Step 1 of submitReservation (spec §10.2) now asks BotID after the honeypot.
On a Vercel deployment (VERCEL_ENV production or preview) the browser half,
installed from instrumentation-client.ts before hydration, wraps fetch so a
Server Action posted to any guest page carries BotID's challenge answer, and
checkBotId sends it to Vercel for a verdict; verified bots are refused too,
and the guest sees bot_blocked with the restaurant's number (R16). When
BotID cannot answer (OIDC off, Vercel down) the booking goes ahead and the
failure is logged without request data: the honeypot, consent and the
per-phone limit still stand. Admin pages never install it.

Off Vercel (local, CI, E2E) nothing is installed and nobody is asked;
BOTID_DEV_BYPASS=BAD-BOT makes BotID's own development bypass refuse every
caller, which the integration test and the opt-in e2e/botid.spec.ts use.
withBotId adds the rewrites of BotID's script and API, and the proxy matcher
now skips that prefix, which it would otherwise have sent to /en/149e9513-….
botid is pinned at 1.5.11.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```
---

### Task 12: SEC-2, ô tìm của hộp thư rời khỏi URL

Phán quyết SEC-2 của đợt 4 (dời từ đợt 10 về đợt 5, R18): ô tìm của `/admin/reservations` gửi GET, nên số điện thoại, tên hay email của khách nằm trong query string, tức trong request log của Vercel, lịch sử trình duyệt và link `next` của trang đăng nhập. Giờ ô tìm POST tới `searchReservations` (`reservations:read`); action cất chữ trong cookie `fc_inbox_search` (httpOnly, `sameSite: 'strict'`, path `/admin/reservations`, 30 phút, `secure` trừ khi `BETTER_AUTH_URL` là http) dưới một id ngẫu nhiên 8 hex và chuyển tới `?tim=<id>`. Tải lại và phân trang (`?tim=&sau=`) giữ kết quả; một lần tìm ở tab khác thay cookie, và tab này nói lần tìm đã hết hạn thay vì hiện kết quả của tab kia. Proxy bỏ `q` cũ khỏi `next` của trang đăng nhập. `cookies().set` chỉ được trong Server Function hay Route Handler (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md:6,74,81-87`), nên chữ được cất trong action, không phải trong trang.

**Files:**
- Create: `lib/server/booking/inbox-search.ts`, `lib/server/booking/inbox-search.test.ts`
- Modify: `app/admin/(shell)/reservations/actions.ts`, `app/admin/(shell)/reservations/page.tsx`, `proxy.ts`, `proxy.test.ts`, `test/guards/require-permission.guard.test.ts`, `e2e/admin-reservations.spec.ts`

**Interfaces:**
- Consumes: `listInbox(pool, { tab, q, after, today })` (đợt 4: `q` vẫn là chuỗi tìm, giờ đọc từ cookie); `requirePermission`, `requirePagePermission`.
- Produces:
  - `lib/server/booking/inbox-search.ts`: `INBOX_SEARCH_COOKIE = 'fc_inbox_search'`, `INBOX_SEARCH_MAX_AGE = 1800`; `searchText(raw: FormDataEntryValue | null): string | null` (cắt khoảng trắng, tối đa 100 ký tự, ít nhất 2); `encodeSearch({ id, q }): string`; `decodeSearch(id, cookie): { q } | 'expired' | null`; `saveInboxSearch(q): Promise<string>` (chỉ trong Server Action); `readInboxSearch(id): Promise<{ q } | 'expired' | null>`.
  - `app/admin/(shell)/reservations/actions.ts#searchReservations(formData): Promise<void>` (redirect).
  - URL của hộp thư chỉ còn `tab`, `tim`, `sau`.

- [ ] **Bước 1: Viết test**

Create `lib/server/booking/inbox-search.test.ts` (một id do tay viết, một cookie lạ, JSON hỏng, cookie của tab khác: đều là "hết hạn", không bao giờ kết quả của lần tìm khác):

```ts
import { describe, expect, it } from 'vitest';
import { decodeSearch, encodeSearch, searchText } from './inbox-search';

describe('inbox search kept off the URL', () => {
  it('reads what staff typed: trimmed, at most 100 characters, nothing below 2', () => {
    expect(searchText('  0905 123 456 ')).toBe('0905 123 456');
    expect(searchText('x'.repeat(150))).toHaveLength(100);
    expect(searchText('a')).toBeNull();
    expect(searchText('')).toBeNull();
    expect(searchText(null)).toBeNull();
  });

  it('finds the search the URL id names, Vietnamese and quotes included', () => {
    const cookie = encodeSearch({ id: '0a1b2c3d', q: 'Nguyễn "Ánh"' });
    expect(decodeSearch('0a1b2c3d', cookie)).toEqual({ q: 'Nguyễn "Ánh"' });
  });

  it('no id in the URL: no search', () => {
    expect(decodeSearch(undefined, encodeSearch({ id: '0a1b2c3d', q: 'abc' }))).toBeNull();
  });

  it.each([
    ['another tab searched since', 'ffffffff', encodeSearch({ id: '0a1b2c3d', q: 'abc' })],
    ['the cookie expired', '0a1b2c3d', undefined],
    ['a hand-made id', '../../x', encodeSearch({ id: '../../x', q: 'abc' })],
    ['a cookie this code did not write', '0a1b2c3d', '{"id":"0a1b2c3d"}'],
    ['not JSON', '0a1b2c3d', 'q=abc'],
  ])('%s: expired, never another search’s results', (_, id, cookie) => {
    expect(decodeSearch(id, cookie)).toBe('expired');
  });
});
```

Sửa `proxy.test.ts`:

```diff
diff --git a/proxy.test.ts b/proxy.test.ts
index 6854a7e..58aea7c 100644
--- a/proxy.test.ts
+++ b/proxy.test.ts
@@ -19,6 +19,9 @@ describe('proxy: /admin without a session cookie', () => {
     ['/admin?x=1', '/admin/sign-in?next=%2Fadmin%3Fx%3D1'],
     // The RSC request id of a client navigation is not part of where the user was going.
     ['/admin/users?_rsc=abc', '/admin/sign-in?next=%2Fadmin%2Fusers'],
+    // Nor is an old inbox search: guest data stays out of URLs (phase-4 ruling SEC-2).
+    ['/admin/reservations?q=0905123456&tab=all', '/admin/sign-in?next=%2Fadmin%2Freservations%3Ftab%3Dall'],
+    ['/admin/reservations?q=Nguyen', '/admin/sign-in?next=%2Fadmin%2Freservations'],
   ])('%s → 307 %s', (path, location) => {
     const res = get(path);
     expect(res.status).toBe(307);
```

Sửa `test/guards/require-permission.guard.test.ts` (Editor tìm được, như đọc hộp thư):

```diff
diff --git a/test/guards/require-permission.guard.test.ts b/test/guards/require-permission.guard.test.ts
index 8905622..99a1b29 100644
--- a/test/guards/require-permission.guard.test.ts
+++ b/test/guards/require-permission.guard.test.ts
@@ -64,6 +64,7 @@ const BOOKING_ACTIONS: Record<string, Record<string, { permission: object; edito
     addNote: { permission: { reservations: ['note'] }, editor: true },
     createReservation: { permission: { reservations: ['create'] }, editor: true },
     cancelReservations: { permission: { reservations: ['update'] }, editor: true },
+    searchReservations: { permission: { reservations: ['read'] }, editor: true },
   },
   'app/admin/(shell)/reservations/closures/actions.ts': {
     addClosure: { permission: { schedule: ['update'] }, editor: true },
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `npx vitest run lib/server/booking/inbox-search.test.ts proxy.test.ts test/guards/require-permission.guard.test.ts`
Expected: FAIL `Test Files  3 failed (3)`, `Tests  3 failed | 38 passed (41)`:

```
 ❯ test/guards/require-permission.guard.test.ts (25 tests | 1 failed) 45ms
     × app/admin/(shell)/reservations/actions.ts 4ms
 ❯ proxy.test.ts (16 tests | 2 failed) 12ms
     × /admin/reservations?q=0905123456&tab=all → 307 /admin/sign-in?next=%2Fadmin%2Freservations%3Ftab%3Dall 3ms
     × /admin/reservations?q=Nguyen → 307 /admin/sign-in?next=%2Fadmin%2Freservations 1ms
 ❯ lib/server/booking/inbox-search.test.ts (0 test)
Error: Cannot find module './inbox-search' imported from …/lib/server/booking/inbox-search.test.ts
AssertionError: expected '/admin/sign-in?next=%2Fadmin%2Freserv…' to be '/admin/sign-in?next=%2Fadmin%2Freserv…' // Object.is equality
AssertionError: expected [ 'addNote', …(4) ] to deeply equal [ 'addNote', …(5) ]
```

- [ ] **Bước 3: Viết E2E và chạy nó trên build hiện tại: phải đỏ**

Test tìm kiếm của đợt 4 (V-Senses Cafe +8; file chạy lại được trên cùng DB nhờ F18) giờ gõ số điện thoại vào ô thay vì mở URL `?q=`: URL chỉ có `?tim=<8 hex>`, khác lần tìm trước, không chứa số; tải lại giữ kết quả và giá trị ô; `document.cookie` không thấy `fc_inbox_search` (httpOnly); tab thứ hai tìm thì tab đầu nói đã hết hạn và hiện lại các tab lọc. Lede được chờ trước khi kiểm URL, để kiểm trang của lần tìm thứ hai chứ không phải trang cũ. Sửa `e2e/admin-reservations.spec.ts`:

```diff
diff --git a/e2e/admin-reservations.spec.ts b/e2e/admin-reservations.spec.ts
index 55b3346..b9bd308 100644
--- a/e2e/admin-reservations.spec.ts
+++ b/e2e/admin-reservations.spec.ts
@@ -146,19 +146,44 @@ test('the inbox finds a booking by reference or phone, and confirms it from the
   const r = await seedReservation({ restaurant: 'v-senses-cafe', date: venueDay(8) });
   await signInAs(page, STAFF.editor);
   await page.goto('/admin/reservations');
-  await page.getByLabel('Tìm theo mã, số điện thoại, tên hoặc email', { exact: true }).fill(r.reference.toLowerCase().replace('-', ''));
+  const box = page.getByLabel('Tìm theo mã, số điện thoại, tên hoặc email', { exact: true });
+  await box.fill(r.reference.toLowerCase().replace('-', ''));
   await page.getByRole('button', { name: 'Tìm', exact: true }).click();
   await expect(page.getByRole('row').filter({ hasText: r.reference })).toBeVisible();
   await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
 
+  // Phase-4 ruling SEC-2: the guest's number never reaches the URL (request logs, history, the sign-in `next`).
   const local = `0${r.phone.slice(3, 6)} ${r.phone.slice(6, 9)} ${r.phone.slice(9)}`;
-  await page.goto(`/admin/reservations?q=${encodeURIComponent(local)}`);
+  const first = page.url();
+  await box.fill(local);
+  await page.getByRole('button', { name: 'Tìm', exact: true }).click();
+  // The lede first: the URL check below must see the second search's page, not the first one's.
+  await expect(page.getByText(`Kết quả cho “${local}” trong mọi đặt bàn.`)).toBeVisible();
+  await expect(page.getByRole('row').filter({ hasText: r.reference })).toBeVisible();
+  await expect(page).toHaveURL(/\/admin\/reservations\?tim=[0-9a-f]{8}$/);
+  expect(page.url()).not.toBe(first);
+  expect(page.url()).not.toContain(r.phone.slice(-6));
+  // A reload keeps the results: the text waits in an httpOnly cookie under that id.
+  await page.reload();
   await expect(page.getByRole('row').filter({ hasText: r.reference })).toBeVisible();
+  await expect(box).toHaveValue(local);
+  expect(await page.evaluate(() => document.cookie)).not.toContain('fc_inbox_search');
 
   // A requested booking can be confirmed right from the results.
   await page.getByRole('button', { name: `Xác nhận ${r.reference}` }).click();
   await expect(page.getByRole('row').filter({ hasText: r.reference })).toContainText('Đã xác nhận');
   expect((await reservationRow(r.id)).status).toBe('confirmed');
+
+  // A search in another tab replaces the cookie: this tab says so rather than showing the other tab's results.
+  const other = await page.context().newPage();
+  await other.goto('/admin/reservations');
+  await other.getByLabel('Tìm theo mã, số điện thoại, tên hoặc email', { exact: true }).fill('Không ai tên này');
+  await other.getByRole('button', { name: 'Tìm', exact: true }).click();
+  await expect(other.getByText('Kết quả cho “Không ai tên này” trong mọi đặt bàn.')).toBeVisible();
+  await page.reload();
+  await expect(main(page).getByRole('status')).toHaveText('Kết quả tìm kiếm đã hết hạn. Hãy tìm lại.');
+  await expect(page.getByRole('navigation', { name: 'Lọc đặt bàn' })).toBeVisible();
+  await other.close();
 });
 
 test('an edit into a full slot is refused with the covers left, keeps what was typed, then saves with a reason', async ({ page }) => {
```

Cất tạm các file ngoài `e2e/`, build, chạy `e2e/admin-reservations.spec.ts --project=desktop -g "the inbox finds"`. Expected: `1 failed`:

```
  ✘  1 [desktop] › e2e/admin-reservations.spec.ts:145:5 › the inbox finds a booking by reference or phone, and confirms it from the list (6.0s)
    Error: expect(page).toHaveURL(expected) failed
    Expected pattern: /\/admin\/reservations\?tim=[0-9a-f]{8}$/
    Received string:  "http://localhost:3258/admin/reservations?q=0986+519+929"
```

Lấy lại các file đã cất.

- [ ] **Bước 4: Cookie của lần tìm**

Create `lib/server/booking/inbox-search.ts`:

```ts
import 'server-only';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';

/*
 * The inbox search box without the guest in the URL (phase-4 ruling SEC-2).
 * A search is a phone number, a name or an email; in a GET query string it
 * would sit in Vercel's request logs, the browser history and the sign-in
 * page's `next` link. So the box POSTs to searchReservations, which keeps the
 * text in a short-lived httpOnly cookie under a random id, and the page URL
 * carries only that id (?tim=…). Tabs, keyset paging (?sau=) and reload keep
 * working; a second tab's search replaces the cookie, and the first tab then
 * says its search has expired instead of showing the other tab's results.
 */

export const INBOX_SEARCH_COOKIE = 'fc_inbox_search';
/** Long enough to work through results, short enough not to linger on a shared PC. */
export const INBOX_SEARCH_MAX_AGE = 30 * 60;
const ID = /^[0-9a-f]{8}$/;

export type SavedSearch = { id: string; q: string };

/** What staff typed, as listInbox reads it (parseSearch keeps 100 characters). Null when there is nothing to search. */
export function searchText(raw: FormDataEntryValue | null): string | null {
  const q = typeof raw === 'string' ? raw.trim().slice(0, 100) : '';
  return q.length >= 2 ? q : null;
}

export function encodeSearch(search: SavedSearch): string {
  return JSON.stringify([search.id, search.q]);
}

/**
 * The search the URL's id points at: `{ q }` when the cookie holds that id,
 * 'expired' when it does not (another search replaced it, or 30 minutes
 * passed), null when the URL names no search.
 */
export function decodeSearch(id: string | undefined, cookie: string | undefined): { q: string } | 'expired' | null {
  if (id === undefined) return null;
  if (!ID.test(id) || !cookie) return 'expired';
  try {
    const value: unknown = JSON.parse(cookie);
    if (Array.isArray(value) && value.length === 2 && value[0] === id && typeof value[1] === 'string') {
      const q = searchText(value[1]);
      if (q) return { q };
    }
  } catch {
    // A cookie this code did not write: same as none.
  }
  return 'expired';
}

/** Stores `q` and returns the id the URL carries. Server Actions only (cookies().set). */
export async function saveInboxSearch(q: string): Promise<string> {
  const id = randomBytes(4).toString('hex');
  (await cookies()).set(INBOX_SEARCH_COOKIE, encodeSearch({ id, q }), {
    httpOnly: true,
    sameSite: 'strict',
    // Plain http only where the app itself runs on it (local, E2E).
    secure: !(process.env.BETTER_AUTH_URL ?? '').startsWith('http://'),
    path: '/admin/reservations',
    maxAge: INBOX_SEARCH_MAX_AGE,
  });
  return id;
}

export async function readInboxSearch(id: string | undefined): Promise<{ q: string } | 'expired' | null> {
  return decodeSearch(id, (await cookies()).get(INBOX_SEARCH_COOKIE)?.value);
}
```

- [ ] **Bước 5: Action, trang, proxy**

Sửa `app/admin/(shell)/reservations/actions.ts` (`requirePermission` là câu đầu tiên, như mọi action; `redirect()` sau khi cookie đã đặt):

```diff
diff --git a/app/admin/(shell)/reservations/actions.ts b/app/admin/(shell)/reservations/actions.ts
index daeff30..48a76af 100644
--- a/app/admin/(shell)/reservations/actions.ts
+++ b/app/admin/(shell)/reservations/actions.ts
@@ -7,6 +7,7 @@ import { CancelManyForm, EditForm, NewReservationForm, NoteForm, TransitionForm
 import type { ReservationStatus } from '@/lib/booking/rules';
 import { toE164 } from '@/lib/phone';
 import { actionError, type ActionResult } from '@/lib/server/action-result';
+import { saveInboxSearch, searchText } from '@/lib/server/booking/inbox-search';
 import { listLocales } from '@/lib/server/booking/queries';
 import { drainAfterCommit } from '@/lib/server/email/after-commit';
 import { outboxEffects } from '@/lib/server/email/outbox';
@@ -159,3 +160,14 @@ export async function cancelReservations(_prev: ActionResult<CancelManyResult> |
     return actionError(err);
   }
 }
+
+/**
+ * The inbox search box (spec §7.2). A POST, so the guest's phone, name or
+ * email never reaches the URL (phase-4 ruling SEC-2, R18): the text waits in a
+ * short-lived httpOnly cookie and the inbox URL carries only its id.
+ */
+export async function searchReservations(formData: FormData): Promise<void> {
+  await requirePermission({ reservations: ['read'] });
+  const q = searchText(formData.get('q'));
+  redirect(q ? `/admin/reservations?tim=${await saveInboxSearch(q)}` : '/admin/reservations');
+}
```

Sửa `app/admin/(shell)/reservations/page.tsx` (form có action là hàm, không `onSubmit`: guard của F13/F14 nhận nó; "Xóa tìm kiếm" vẫn là link, cookie tự hết hạn sau 30 phút):

```diff
diff --git a/app/admin/(shell)/reservations/page.tsx b/app/admin/(shell)/reservations/page.tsx
index 63f2e57..63c4667 100644
--- a/app/admin/(shell)/reservations/page.tsx
+++ b/app/admin/(shell)/reservations/page.tsx
@@ -3,10 +3,12 @@ import Link from 'next/link';
 import { getPool } from '@/db/client';
 import { formatDateTimeVi, formatIsoDayVi } from '@/lib/admin/format';
 import { SOURCE_LABELS } from '@/lib/reservations/lifecycle';
+import { readInboxSearch } from '@/lib/server/booking/inbox-search';
 import { INBOX_TABS, listInbox, type InboxTab } from '@/lib/server/booking/queries';
 import { requirePagePermission } from '@/lib/server/dal/session';
 import { venueNow } from '@/lib/venue-time';
 import { QuickConfirm } from './QuickConfirm';
+import { searchReservations } from './actions';
 import { SectionNav } from './_ui/SectionNav';
 import { StatusBadge } from './_ui/StatusBadge';
 
@@ -17,26 +19,29 @@ export const metadata: Metadata = { title: 'Đặt bàn' };
 
 const TAB_LABELS: Record<InboxTab, string> = { pending: 'Cần xử lý', today: 'Hôm nay', upcoming: 'Sắp tới', all: 'Tất cả' };
 
-type Search = { tab?: string | string[]; q?: string | string[]; sau?: string | string[] };
+/* `tim` is the id of a search kept in a cookie (lib/server/booking/inbox-search.ts); the text itself never rides in the URL. */
+type Search = { tab?: string | string[]; tim?: string | string[]; sau?: string | string[] };
 const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
 
 export default async function ReservationsPage({ searchParams }: { searchParams: Promise<Search> }) {
   await requirePagePermission({ reservations: ['read'] });
   const params = await searchParams;
   const tab = (INBOX_TABS as readonly string[]).includes(one(params.tab) ?? '') ? (one(params.tab) as InboxTab) : 'pending';
-  const q = one(params.q)?.trim() ?? '';
+  const searchId = one(params.tim);
+  const saved = await readInboxSearch(searchId);
+  const q = saved && saved !== 'expired' ? saved.q : '';
   const after = one(params.sau);
   // "Hôm nay" is Da Nang's date, whatever the server's timezone.
   const { rows, next, searched } = await listInbox(getPool(), { tab, q, after, today: venueNow().date });
   const shownTab: InboxTab = searched ? 'all' : tab;
   const query = (extra: Record<string, string>) =>
-    new URLSearchParams({ ...(shownTab !== 'pending' ? { tab: shownTab } : {}), ...(q ? { q } : {}), ...extra }).toString();
+    new URLSearchParams({ ...(searched && searchId ? { tim: searchId } : shownTab !== 'pending' ? { tab: shownTab } : {}), ...extra }).toString();
 
   return (
     <>
       <SectionNav current="/admin/reservations" />
       <h1>Đặt bàn</h1>
-      <form className="a-search" role="search" action="/admin/reservations">
+      <form className="a-search" role="search" action={searchReservations}>
         <label htmlFor="inbox-q">Tìm theo mã, số điện thoại, tên hoặc email</label>
         <div className="a-search-row">
           <input id="inbox-q" name="q" type="search" defaultValue={q} placeholder="FC-7K3QH9XA, 0905…, Nguyễn…" />
@@ -45,6 +50,11 @@ export default async function ReservationsPage({ searchParams }: { searchParams:
           </button>
         </div>
       </form>
+      {saved === 'expired' ? (
+        <p className="a-lede" role="status">
+          Kết quả tìm kiếm đã hết hạn. Hãy tìm lại.
+        </p>
+      ) : null}
       {searched ? (
         <p className="a-lede">
           {`Kết quả cho “${q}” trong mọi đặt bàn. `}
```

Sửa `proxy.ts`:

```diff
diff --git a/proxy.ts b/proxy.ts
index 65285fb..9e9e772 100644
--- a/proxy.ts
+++ b/proxy.ts
@@ -55,6 +55,9 @@ function adminProxy(request: NextRequest) {
     url.search = '';
     const next = new URLSearchParams(search);
     next.delete('_rsc');
+    // An old inbox link may still carry a search (?q=, before phase 5 kept it in a cookie):
+    // a guest's phone or name must not ride on into the sign-in URL (phase-4 ruling SEC-2).
+    next.delete('q');
     const query = next.toString();
     if (pathname !== '/admin' || query) url.searchParams.set('next', `${pathname}${query ? `?${query}` : ''}`);
     return NextResponse.redirect(url, 307);
```

- [ ] **Bước 6: Chạy lại test**

Run: lệnh ở Bước 2. Expected: PASS `Test Files  3 passed (3)`, `Tests  49 passed (49)`

Run: `npx vitest run lib/admin/admin-pages.guard.test.ts`. Expected: PASS `Tests  9 passed (9)` (trang hộp thư vẫn gọi `requirePagePermission` trước khi đọc DB; form tìm kiếm không có `onSubmit`).

- [ ] **Bước 7: Chạy cổng kiểm tra**

Expected:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo;
- `Test Files  66 passed (66)`, `Tests  848 passed (848)`;
- `Applied 7 migration(s).`; build thoát 0; check-prerender như Task 8 (`/admin/reservations` vẫn không có static shell);
- E2E `133 passed`, `1 skipped`; visual `8 passed`.

`grep -rn "reservations?q=" app lib components e2e` không ra gì.

- [ ] **Bước 8: Commit**

```bash
git add "app/admin/(shell)/reservations/actions.ts" "app/admin/(shell)/reservations/page.tsx" e2e/admin-reservations.spec.ts lib/server/booking/inbox-search.test.ts lib/server/booking/inbox-search.ts proxy.test.ts proxy.ts test/guards/require-permission.guard.test.ts
git commit -m "$(cat <<'EOF'
fix: keep the inbox search out of the URL

The inbox search box (spec §7.2) held a guest's phone, name or email in the
GET query string, where it reached Vercel's request logs, the browser
history and the sign-in page's `next` link (phase-4 ruling SEC-2, moved to
phase 5 so it lands before launch A). The box now posts to
searchReservations (reservations:read), which keeps the text in a 30-minute
httpOnly, SameSite=Strict cookie scoped to /admin/reservations under a
random id, and redirects to ?tim=<id>. A reload and the pager (?tim=&sau=)
keep the results; a search in another tab replaces the cookie, and this tab
then says its search has expired instead of showing another search's
results. The proxy also drops a leftover ?q= from the sign-in `next`.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```
---

### Task 13: Nghiệm thu, các lần chạy đột biến, runbook trong README

Spec §14.1 dòng 5 có năm tiêu chí nghiệm thu; bốn cái đầu thấy được trong trình duyệt và email, nên `e2e/booking-email.spec.ts` gom chúng thành một bộ có nhãn: A1 (đặt bàn mới gửi email cho nhân viên, sau phản hồi), A2 (xác nhận gửi email cho khách), A3 (email lỗi được gửi lại: lần cron kế tiếp gửi một hàng đã hỏng ở lần đầu; "Gửi lại" vẫn ở `admin-emails`), A4 (không người nhận thì về email chung, và Tổng quan của Admin nêu tên nhà hàng), cùng test 401 của cron (spec §13). A5 (bot bị chặn) nằm ở `guest-guard`, spec BotID chạy riêng và test tích hợp. Các test này mô tả hành vi đã có từ Task 4–11, nên chúng xanh ngay trên code hiện tại: bằng chứng chúng bắt được lỗi là các lần chạy đột biến ở Bước 6, mỗi lần một build, mỗi lần làm đúng test của nó đỏ.

README nhận bản đồ dữ liệu E2E của đợt 5, lần chạy BotID riêng, migration 007 (kiểm trước và sau, đã chạy thử trên một DB cục bộ ở trạng thái 006), phần outbox, phần chống bot (BotID cho qua khi lỗi hoặc sau 3 s), route và biến môi trường mới, và runbook của chủ dự án (dàn ý §7, cộng ba điểm của review: bước 4 chỉ tick Production cho `EMAIL_DELIVERY=live`; bước 5 đặt `BETTER_AUTH_URL` của Preview; bước 11 kiểm hàng `staff.new` và một lời mời trên preview đầu tiên). Việc chạy 007 trên Neon là của controller.

**Files:**
- Modify: `e2e/booking-email.spec.ts`, `README.md`, `lib/server/email/outbox.ts` (một comment đã cũ từ Task 9)

**Interfaces:**
- Consumes: mọi thứ của Task 1–12; `seedReservation`, `seedStaff`, `signInAs`, `STAFF`, `one` (fixture E2E); `data-testid="uncovered-restaurants"` của Tổng quan (Task 7).
- Produces: không có API mới. Danh sách việc hoãn cho sổ của controller (Bước 8).

- [ ] **Bước 1: Viết bộ nghiệm thu**

A3 gieo thẳng một hàng `guest.confirmed` như bộ gửi để lại sau một lỗi nhà cung cấp ở lần đầu (`queued`, `attempts` 1, đến hạn, `last_error` có mã) trên một đặt bàn đã xác nhận (`seedReservation()` mặc định, Tàya House +3), gọi cron có secret, rồi chờ hàng thành `sent` ở lần thứ hai. Ở chế độ log không có `EMAIL_FROM`, nên không có tên miền và hàng không mang Message-ID: test không kiểm Message-ID (test tích hợp của Task 4 kiểm nó trên dây). Một `after()` của spec khác có thể gửi hàng trước cron (R20: nó gửi cả các hàng đến hạn khác của env); kết quả vẫn là `sent` ở lần thứ hai. Sửa `e2e/booking-email.spec.ts`:

```diff
diff --git a/e2e/booking-email.spec.ts b/e2e/booking-email.spec.ts
index 51f8c55..3557cb3 100644
--- a/e2e/booking-email.spec.ts
+++ b/e2e/booking-email.spec.ts
@@ -5,13 +5,18 @@ import { seedReservation } from './reservation-fixtures';
 import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';
 
 /*
- * Phase 5 in a real `next start` (EMAIL_DELIVERY=log, so every email lands in
- * EMAIL_LOG_FILE): a new booking emails the staff (the general inbox when no
- * recipient is listed) and the guest, sent by after() once the action has
- * answered; confirming emails the guest; the cron endpoint wants its secret.
- * The guest books Café Indochine on its last open day, which no other spec
- * books. No spec running beside this one may add an 'all' or 'destination'
- * recipient: it would take the staff email away from the general inbox.
+ * Phase 5's acceptance (spec §14.1 row 5) in a real `next start`
+ * (EMAIL_DELIVERY=log, so every email lands in EMAIL_LOG_FILE):
+ *   A1 a new booking emails the staff, sent by after() once the action has answered;
+ *   A2 confirming emails the guest;
+ *   A3 a failed email is retried (the cron sends it again; "Gửi lại" is in admin-emails);
+ *   A4 with no recipient it goes to the general email, and the overview names the restaurant;
+ *   spec §13: the cron endpoint answers 401 without its secret.
+ * A5 (bots are blocked) is guest-guard.spec.ts, the opt-in botid.spec.ts and
+ * the integration tests. The guest books Café Indochine on its last open day,
+ * which no other spec books. No spec running beside this one may add an 'all'
+ * or 'destination' recipient: it would take the staff email away from the
+ * general inbox.
  */
 
 type Logged = { to: string; subject: string; text: string };
@@ -54,7 +59,7 @@ async function bookCafeIndochine(page: Page, guest: string): Promise<string> {
   return (await drawer.locator('.drawer-ref').textContent()) ?? '';
 }
 
-test('a guest booking emails the staff (the general inbox: nobody is listed) and the guest, after the response', async ({ page }) => {
+test('A1, A4. a guest booking emails the staff (the general inbox: nobody is listed) and the guest, after the response', async ({ page }) => {
   const guest = `guest-${Date.now()}@example.com`;
   const reference = await bookCafeIndochine(page, guest);
   await expect.poll(() => about(reference)).toEqual([
@@ -69,9 +74,14 @@ test('a guest booking emails the staff (the general inbox: nobody is listed) and
     [reference],
   );
   expect(rows).toEqual({ statuses: ['sent', 'sent'], events: ['staff.new', 'guest.ack'], fallback: [true, false] });
+
+  // A4: the Admin's overview names the restaurant whose new-booking email went to the shared inbox.
+  await seedStaff();
+  await signInAs(page, STAFF.admin);
+  await expect(page.getByRole('main').getByTestId('uncovered-restaurants')).toContainText('Café Indochine');
 });
 
-test('confirming in the admin emails the guest', async ({ page }) => {
+test('A2. confirming in the admin emails the guest', async ({ page }) => {
   await seedStaff();
   const r = await seedReservation();
   const guest = `confirm-${r.id}@example.com`;
@@ -84,7 +94,27 @@ test('confirming in the admin emails the guest', async ({ page }) => {
   expect(await one(`SELECT status, attempts FROM email_outbox WHERE reservation_id = $1`, [r.id])).toEqual({ status: 'sent', attempts: 1 });
 });
 
-test('the cron endpoint answers 401 without its secret, and drains with it', async ({ request }) => {
+test('A3. a failed email is retried: the next cron run sends a row whose first attempt failed', async ({ request }) => {
+  const r = await seedReservation({ status: 'confirmed' });
+  const guest = `retry-${r.id}@example.com`;
+  await one(`UPDATE reservations SET email = $2 WHERE id = $1`, [r.id, guest]);
+  // As the sender leaves a row after a provider error on its first attempt: queued again, and due.
+  const row = await one<{ id: string }>(
+    `INSERT INTO email_outbox (env, event, audience, reservation_id, to_email, locale, status, attempts, next_attempt_at, last_error)
+     VALUES ('development', 'guest.confirmed', 'guest', $1, $2, 'en', 'queued', 1, now() - interval '1 minute',
+             'provider_error: SMTP ETIMEDOUT at CONN: Greeting never received')
+     RETURNING id::text`,
+    [r.id, guest],
+  );
+  const res = await request.get('/api/cron/outbox', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
+  expect(res.status()).toBe(200);
+  await expect
+    .poll(() => one(`SELECT status, attempts, last_error FROM email_outbox WHERE id = $1`, [row!.id]))
+    .toEqual({ status: 'sent', attempts: 2, last_error: null });
+  expect(about(r.reference)).toEqual([[guest, `Your table is confirmed (${r.reference})`]]);
+});
+
+test('spec §13: the cron endpoint answers 401 without its secret, and drains with it', async ({ request }) => {
   expect((await request.get('/api/cron/outbox')).status()).toBe(401);
   expect((await request.get('/api/cron/outbox', { headers: { authorization: 'Bearer not-the-secret-at-all' } })).status()).toBe(401);
   const res = await request.get('/api/cron/outbox', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
```

- [ ] **Bước 2: Chạy bộ nghiệm thu trên build hiện tại**

Build và chạy `e2e/booking-email.spec.ts --project=desktop`. Expected: `4 passed` (hành vi đã có; Bước 6 cho thấy mỗi test đỏ khi hành vi của nó hỏng).

- [ ] **Bước 3: Sửa comment cũ, viết README**

Sửa `lib/server/email/outbox.ts` (từ Task 9 form khách từ chối địa chỉ hai `@`; bộ lọc ở đây vẫn cần cho giá trị lưu từ trước):

```diff
diff --git a/lib/server/email/outbox.ts b/lib/server/email/outbox.ts
index 650ea9b..e53d302 100644
--- a/lib/server/email/outbox.ts
+++ b/lib/server/email/outbox.ts
@@ -23,7 +23,8 @@ type Queue = { reservationId: string; eventId: string; env: OutboxEnv };
 /**
  * One guest row, to the address and in the language stored on the booking;
  * none when the booking has no email, or one email_outbox would refuse (the
- * guest form lets "a@b@c.vn" through; R13). `ackSetting`: only while "Cài đặt
+ * guest form refuses "a@b@c.vn" since phase 5, R13, but an older row may hold
+ * one, and it must never fail the change). `ackSetting`: only while "Cài đặt
  * đặt bàn" keeps guest_ack_email on, read in the same transaction.
  */
 export async function queueGuestEmail(
```

Sửa `README.md`:

````diff
diff --git a/README.md b/README.md
index 365b9fc..8f931bd 100644
--- a/README.md
+++ b/README.md
@@ -9,7 +9,10 @@ with reservations persisted in Neon Postgres.
 - **Neon Postgres** via the Vercel Marketplace, reached with `pg` (node-postgres)
   on Fluid Compute per Neon's own guidance
 - **Better Auth** for staff sign-in (invitation only, Admin and Editor roles)
-  and **SMTP** (nodemailer) with react-email for every email
+  and **SMTP** (nodemailer) with react-email for every email, booking emails
+  through an outbox sent after commit and by a Vercel Cron
+- **Vercel BotID**, a honeypot and a per-phone limit in front of the public
+  booking action
 - Plain CSS with design tokens — the design is built on fluid `clamp()` values
   throughout, so the tokens mirror them directly rather than round-tripping
   through a utility framework
@@ -40,7 +43,7 @@ printed to the terminal). Create your Admin with `scripts/create-admin.mjs`
 | --- | --- |
 | `npm test` | Unit tests (Vitest, process timezone pinned to UTC) |
 | `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test` | Unit and integration tests. The database is dropped and recreated on every run, and its name must end in `_test`. |
-| `npm run test:e2e` | Playwright against `next start` on port 3100 (or `E2E_PORT`). Set `CI`, a local `_test` `DATABASE_URL`, `EMAIL_DELIVERY=log`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=http://localhost:<port>` and `EMAIL_LOG_FILE` (variables below), or `E2E_BASE_URL` for a server you started; otherwise it refuses to run, because `next dev` and `next start` read `.env.local`. Run `npx playwright install chromium` once first. |
+| `npm run test:e2e` | Playwright against `next start` on port 3100 (or `E2E_PORT`). Set `CI`, a local `_test` `DATABASE_URL`, `EMAIL_DELIVERY=log`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=http://localhost:<port>`, `EMAIL_LOG_FILE` and `CRON_SECRET` (variables below), or `E2E_BASE_URL` for a server you started; otherwise it refuses to run, because `next dev` and `next start` read `.env.local`. Run `npx playwright install chromium` once first. |
 | `npm run test:visual` | Pixel-exact screenshots of the home and Tàya House pages, with and without JavaScript, against `e2e/__visual__/` (macOS baselines from before phase 2; CI skips them). Needs a running `next start`, see below. |
 | `npm run lint` | oxlint (typescript-eslint does not support TypeScript 7) |
 
@@ -48,8 +51,8 @@ CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit, integration,
 build, the prerender and font check (`scripts/check-prerender.mjs`) and
 end-to-end tests against a Postgres 18 service container. The build needs no
 auth or email variable; the end-to-end step gets a fresh `BETTER_AUTH_SECRET`
-per run, `EMAIL_DELIVERY=log` and an `EMAIL_LOG_FILE` the admin specs read
-invitation and reset links from.
+and `CRON_SECRET` per run, `EMAIL_DELIVERY=log` and an `EMAIL_LOG_FILE` the
+specs read invitation and reset links and booking emails from.
 
 To run the production build locally against a throwaway database, keep
 `.env.local` out of it: process variables win over that file, and the blank
@@ -61,7 +64,7 @@ CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5
 node scripts/check-prerender.mjs
 CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test \
   BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3100 \
-  EMAIL_DELIVERY=log EMAIL_LOG_FILE=$TMPDIR/emails.ndjson npm run test:e2e
+  EMAIL_DELIVERY=log EMAIL_LOG_FILE=$TMPDIR/emails.ndjson CRON_SECRET=$(openssl rand -hex 16) npm run test:e2e
 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test \
   BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3201 EMAIL_DELIVERY=log npx next start -p 3201 &
 for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3201/ && break; sleep 1; done
@@ -87,9 +90,16 @@ its own restaurant and dates, and puts back the rules it changes:
 | `admin-closures` | Phố Cuốn; the MM Supercenter (Yum Food Village, ChaoShan Hotpot) | +5; a destination closure at +11; closure edits at +60 and +61 |
 | `booking-acceptance` | Yum Food Village | +3, +4, +12, +13, yesterday; dinner hours, covers and `max_party` |
 | `booking-switch.serial` | Tàya House, Hải Vân Lounge | online booking off, then on again |
+| `booking-email` | Café Indochine, Tàya House | the last open day (a guest booking: its staff email goes to the shared inbox); +3 (`seedReservation()`: a booking to confirm, and a confirmed one with an email row due for its second attempt) |
+| `admin-emails` | Hải Vân Lounge, Hura Izakaya | +40 (failed emails written straight into `email_outbox`); a restaurant recipient under a fresh address, deleted afterwards |
+| `guest-guard` | Phố Cuốn | today + 13 (three web requests seeded for a fresh number); the other tests book nothing |
 
 The other specs write no booking, closure or rule (the guest specs that
-submit mock the availability API and abort the Server Action POST).
+submit mock the availability API and abort the Server Action POST, or are
+refused before anything is written). No spec that runs beside the others may
+add a notification recipient for `all` or a destination: it would take
+`booking-email`'s staff email away from the shared inbox. Keep such cases in
+the integration tests or a `*.serial.spec.ts`.
 Before the tests that count covers, `admin-reservations.spec.ts` empties the
 days it owns (Tàya House +4 and +6, ChaoShan Hotpot +7), so it passes again
 on a database it has already run on; never book those days from another spec.
@@ -97,6 +107,26 @@ on a database it has already run on; never book those days from another spec.
 `booking-acceptance.spec.ts` checks every phase-4 acceptance criterion of the
 spec (§14.1 row 4) through the screens. Its tests share Yum Food Village's
 rules and run in order, so never run that file with `--repeat-each`.
+`booking-email.spec.ts` checks phase 5's (§14.1 row 5): a new booking emails
+staff (A1), confirming emails the guest (A2), a failed email is retried by
+the cron (A3), and with no recipient the staff email goes to the shared inbox
+(A4); bots are blocked (A5) in `guest-guard.spec.ts`, the integration tests
+and the BotID run below.
+
+`e2e/botid.spec.ts` walks BotID's blocked path. Off Vercel nobody can judge a
+request, so it is skipped unless the server runs with `BOTID_DEV_BYPASS=BAD-BOT`
+(BotID's own development bypass then calls every caller a bot), and every
+booking on that server is refused, so it runs on its own, after the main run:
+
+```bash
+CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test \
+  BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3100 \
+  EMAIL_DELIVERY=log EMAIL_LOG_FILE=$TMPDIR/emails.ndjson CRON_SECRET=$(openssl rand -hex 16) \
+  BOTID_DEV_BYPASS=BAD-BOT npx playwright test e2e/botid.spec.ts --project=desktop
+```
+
+CI does not run it; `lib/server/guard/bot.test.ts`, `lib/botid.test.ts` (the
+real BotID fetch wrapper) and the integration test cover the same path.
 
 `E2E_BASE_URL=http://localhost:<port>` points the main Playwright suite at a
 server you started yourself (for example `next dev` with the same variables)
@@ -266,6 +296,51 @@ The staff tables' columns come from `lib/server/auth/config.ts`; change that
 file, regenerate with `npx auth generate --config scripts/auth-cli.config.ts`
 against an empty local database, and write the difference as a new migration.
 
+### Migration 007 (phase 5: email and consent)
+
+`007_email_and_consent.sql` adds `site_settings` (one row, the shared inbox
+`email`, seeded `fb@furamavietnam.com`), `notification_recipients`,
+`email_outbox`, and the pair `reservations.consent_version` /
+`consented_at` with its CHECK. It only adds: the phase-4 code keeps working
+on a 007 database, and `next build` reads none of it. The phase-5 code does
+not work without it: a guest's submit writes `consent_version` and queues
+`email_outbox` rows in its transaction, so every booking fails until 007 is
+on that environment's branch. Apply 007 first, then deploy phase 5
+(production: right before the production deploy; a preview branch forked
+before 007 reached production: before using that preview).
+
+`site_settings` is created early with one column (spec §5.2 lists it under
+phase 6): phase 6 must add its other columns with `ALTER TABLE site_settings
+ADD COLUMN IF NOT EXISTS …`, never `CREATE TABLE`.
+
+Before applying 007 to a Neon branch, on that branch's own URL (read-only):
+
+```sql
+-- 1. Exactly 001–006 applied, 007 not yet.
+SELECT name FROM _migrations ORDER BY name;
+-- 2. None of 007's tables exists yet: three NULLs.
+SELECT to_regclass('site_settings'), to_regclass('notification_recipients'), to_regclass('email_outbox');
+-- 3. Postgres 13 or newer (the sender uses gen_random_uuid() for Message-IDs): t.
+SELECT current_setting('server_version_num')::int >= 130000;
+-- 4. The consent columns do not exist yet: no row.
+SELECT column_name FROM information_schema.columns
+ WHERE table_name = 'reservations' AND column_name IN ('consent_version', 'consented_at');
+```
+
+Then apply it with `DATABASE_URL_UNPOOLED=<the branch's direct URL> node
+scripts/migrate.mjs`, and check:
+
+```sql
+SELECT email FROM site_settings;                                       -- fb@furamavietnam.com
+SELECT attgenerated FROM pg_attribute
+ WHERE attrelid = 'email_outbox'::regclass AND attname = 'idempotency_key';  -- s (STORED)
+SELECT count(*) FROM notification_recipients;                          -- 0 until the Admin adds them
+SELECT conname FROM pg_constraint WHERE conname = 'reservations_consent_check';  -- one row
+```
+
+Until recipients are added, every new booking's staff email goes to the
+shared inbox, and the overview lists the restaurants that do so.
+
 ### Environment variables (admin)
 
 | Variable | Production | Preview | Local E2E / CI |
@@ -279,7 +354,9 @@ against an empty local database, and write the difference as a new migration.
 | `SMTP_PORT` | `587` (STARTTLS, the default) or `465` (TLS) | same | never set |
 | `SMTP_SECURE` | only if the port rule does not fit: `true` (TLS from the first byte) or `false` (STARTTLS); unset means `true` on 465 only | same | never set |
 | `SMTP_USER`, `SMTP_PASSWORD` | the login (both or neither) | a separate login if the provider allows | never set |
-| `CRON_SECRET` | 16+ characters (`openssl rand -hex 32`); arrives with the outbox cron | optional | a fresh random value per E2E run |
+| `CRON_SECRET` | 16+ characters (`openssl rand -hex 32`); Vercel Cron sends it to `/api/cron/outbox`, and a missing or shorter one answers every call 401 | optional (crons run on Production only) | a fresh random value per E2E run |
+| `BOTID_DEV_BYPASS` | **never** | **never** | only for the opt-in `e2e/botid.spec.ts` run (`BAD-BOT`); a deployment ignores it |
+| `VERCEL_ENV`, `NEXT_PUBLIC_VERCEL_ENV` | set by Vercel | set by Vercel | never set: they turn on BotID and the deployment rules of the email gate |
 | `EMAIL_LOG_FILE` | never | never | a scratch file; log mode appends each email as one JSON line |
 | `BOOTSTRAP_ADMIN_EMAIL` | never (only in the shell that runs `scripts/create-admin.mjs`) | never | — |
 
@@ -334,6 +411,111 @@ set up on this environment); a failed reset email is only logged. Tests reach
 SMTP only through `test/helpers/smtp-sink.ts`, an in-process server on
 `127.0.0.1`.
 
+**Booking emails** (spec §10.3–10.4) go through an outbox:
+
+- **Queued with the change.** A booking change that emails someone writes its
+  `email_outbox` rows in its own transaction (`lib/server/email/outbox.ts`),
+  one row per recipient: `staff.new` to the active recipients of the
+  restaurant, its destination and "all" (deduplicated), or to the shared inbox
+  (`site_settings.email`) when nobody matches; the guest's email in the
+  booking's language. A failed email never fails the booking.
+- **Sent after commit, at least once.** `after()` sends the new rows once the
+  response is out (at most 10 rows or 25 s), and `GET /api/cron/outbox` runs
+  every 5 minutes (`vercel.json`, Production only) for whatever is due. SMTP
+  has no idempotency key, so a row is claimed with a 120-second lease and
+  sent with a Message-ID fixed at its first claim
+  (`<outbox-<id>.<12 hex>@<EMAIL_FROM domain>>`); if a function dies between
+  the server's acceptance and the `sent` mark, the next run sends it again
+  with the same Message-ID, and the recipient may get two identical copies.
+- **Retries.** After a failure the row waits 1, 5, 15, 60, 360 and 720
+  minutes (seven attempts within about 19.4 hours), then it is `failed` and the
+  overview counts it. A recipient refused for good (5xx at `RCPT TO`) fails at
+  once. "Gửi lại" in `/admin/reservations/emails` puts a failed email back with
+  a fresh schedule.
+- **Skipped, not sent,** when the booking no longer matches the email (a
+  confirmation for a booking cancelled meanwhile), was anonymised, or the
+  guest's address changed since it was queued; `last_error` says why.
+- **Environments.** Each row records its environment (`VERCEL_ENV`), and a
+  sender only sends its own: a Preview never sends production's rows.
+
+### Bot protection
+
+The public booking action (`app/actions.ts#submitReservation`) refuses, in
+this order and before anything is written: a filled honeypot (an off-screen
+field no person sees), then a request Vercel BotID calls a bot (verified bots
+included), with "We could not accept this request online. Please call us on
+… to book."; then a request without the privacy consent; then, inside the
+booking transaction, a fourth requested or confirmed web booking for one phone
+number on one date, across all restaurants. BotID runs only on a Vercel
+deployment (`VERCEL_ENV` production or preview): the browser half installs
+from `instrumentation-client.ts` on guest pages, the server half asks Vercel,
+and when Vercel cannot answer, or has not answered within 3 seconds, the
+booking goes ahead and the function log says `[botid] check failed`. `next.config.ts` (`withBotId`) adds rewrites under
+`/149e9513-01fa-4fb0-aad4-566afd725d1b/` to Vercel in every build, the local
+one too: never request that prefix on a local `next start`.
+
+### Before launch A: what the owner sets up
+
+Email, the cron and BotID need these steps once; until they are done, keep
+Production on `EMAIL_DELIVERY=redirect` and nothing reaches a guest.
+
+1. **SMTP account:** host, port 587 (STARTTLS) or 465 (TLS), username, and a
+   password or app password. Microsoft 365: enable "Authenticated SMTP" for
+   that mailbox (and mind its daily recipient limit). Google Workspace: an app
+   password.
+2. **`EMAIL_FROM`:** for example `Furama Cuisine <no-reply@mail.furamavietnam.com>`,
+   an address or alias the login may send as.
+3. **DNS at the mail provider (IT Furama):** SPF includes the provider, DKIM
+   signs for the From domain, DMARC aligned (check the root domain first;
+   start at `p=none`).
+4. **Vercel → Environment Variables, Production:** `EMAIL_DELIVERY=live`,
+   `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`
+   (`SMTP_SECURE` only if the port rule does not fit), `CRON_SECRET`
+   (`openssl rand -hex 32`), `BETTER_AUTH_URL` = the production origin. Add
+   `EMAIL_DELIVERY=live` with only Production ticked: the dashboard ticks
+   every environment by default (the sender refuses live on a Preview anyway,
+   and its emails then fail with `invalid_delivery_mode`).
+5. **Preview:** `EMAIL_DELIVERY=redirect`, `EMAIL_REDIRECT_TO=<the Admin's
+   inbox>`, `EMAIL_FROM`, `SMTP_*` (a separate login if possible), and
+   `BETTER_AUTH_URL=<the preview's branch URL>` (set for that Git branch, and
+   open the preview at that URL: every emailed link, from `staff.new`'s
+   booking link to invitations and resets, needs it, and fails with
+   `missing_app_url` without it). Preview branches fork production's staff
+   and recipients, so redirect is mandatory there; a password reset on a
+   Preview changes only that branch. Remove `RESEND_API_KEY` from every
+   environment.
+6. **Cron:** after the first Production deploy, Project → Settings → Cron
+   Jobs shows `/api/cron/outbox` every 5 minutes (Vercel Pro).
+7. **BotID:** turn on "Automatically expose System Environment Variables"
+   (the browser half needs `NEXT_PUBLIC_VERCEL_ENV` at build) and OIDC
+   Federation (the server half needs its token); decide on Deep Analysis
+   (billed per check: read the current price on vercel.com/docs/botid);
+   never set `BOTID_DEV_BYPASS`.
+8. **Recipients:** in `/admin/settings/notifications`, add the notification
+   emails per restaurant or destination (spec §15 item 15), and confirm
+   `fb@furamavietnam.com` as the shared inbox (the fallback, and where guests'
+   replies go).
+9. **Migration 007** on Neon, with the checks above, in the phase-5 deploy
+   window.
+10. **First preview:** "Gửi email thử" in `/admin/settings/notifications`
+    arrives at the redirect inbox (that proves port 587/465 is reachable from
+    Vercel Functions, the login, and SPF/DKIM passing in the headers).
+11. **First preview:** book a table from a browser: the staff and guest
+    emails arrive (redirected), the function logs show no `[botid] check
+    failed`, and the BotID traffic view shows the check. In
+    `/admin/reservations/emails` the `staff.new` row is "Đã gửi", not
+    `missing_app_url`; an invitation from `/admin/users` arrives at the
+    redirect inbox with a link to the preview's origin, and the link opens
+    the invitation.
+
+Decisions the owner gives (the build's defaults in brackets): "Báo khách qua
+email" on a cancel, also from a closure [on]; Vietnamese email for a booking
+made in Vietnamese [yes]; guests' replies to the shared inbox and staff
+replies to the guest [yes]; the per-phone limit [3 active web requests per
+number per booking date]; BotID failing open and refusing verified bots [yes];
+the privacy policy's wording and its Vietnamese text (a lawyer's review under
+Law 91/2025/QH15) [an English draft]; which inbox Previews redirect to.
+
 ### First Admin
 
 Staff accounts exist only by invitation (spec §7.1); the one exception is the
@@ -365,13 +547,17 @@ bootstrapping production is what you mean to do.
 | `/en` | Static, `cacheLife('max')` | Home: hero, finder, cuisines, restaurants, destinations, experiences, heritage, stories, offers |
 | `/en/restaurants/[slug]` | Static for `taya-house`. Any other slug is a 404: the first visit is a soft 404 (status 200 with `noindex`), later visits get the cached 404, and without JavaScript the body is empty | Restaurant detail (Tàya House only until phase 6) |
 | `/taya-house` | Redirect | 308 to `/en/restaurants/taya-house` (`next.config.ts`) |
-| `/api/availability` | Dynamic, `no-store` | `?restaurant=&lang=[&from=&to=]`: each day's state (open, full, past, closed, too_large, outside) and public closure reason, with the clock, the party limit and the number to call; `?restaurant=&date=&lang=[&guests=]`: one day's services and slots with the covers left. 404 for an unknown restaurant or one with online booking off. `scripts/check-prerender.mjs` fails if it is ever prerendered, or missing from the build |
+| `/en/privacy` | Static, `cacheLife('max')`, tag `content:legal` | The privacy policy (`legal.*`), linked from the footer and the reserve drawer's consent box |
+| `/api/availability` | Dynamic, `no-store` | `?restaurant=&lang=[&from=&to=]`: each day's state (open, full, past, closed, too_large, outside) and public closure reason, with the clock, the party limit and the number to call; `?restaurant=&date=&lang=[&guests=]`: one day's services and slots with the covers left. 404 for an unknown restaurant or one with online booking off; a range given in full that is backwards or too long (400) and an id that cannot exist (404) are answered before any query. `scripts/check-prerender.mjs` fails if it is ever prerendered, or missing from the build |
+| `/api/cron/outbox` | Dynamic, `no-store`, `maxDuration` 300 | Vercel Cron, every 5 minutes: sends the due outbox rows of its environment (at most 500 or 240 s) and answers only the counts. 401 without `Authorization: Bearer $CRON_SECRET` |
 | `/admin/sign-in`, `/admin/accept-invite`, `/admin/reset-password` | Request time, nonce CSP | The only admin pages open without a session cookie |
 | `/admin`, `/admin/users`, `/admin/audit` | Request time, nonce CSP | Overview (with pending and today's bookings); staff and invitations (Admin); audit log of `audit_log` and booking events, paged with `?truoc=`/`?sau=` (Admin). Without a session cookie the proxy sends them to sign-in (307, `?next=` kept) |
-| `/admin/reservations`, `/admin/reservations/[id]`, `/admin/reservations/day` | Request time, nonce CSP | Inbox (Cần xử lý · Hôm nay · Sắp tới · Tất cả, search by reference, phone, name or email); a booking (status changes, edit, internal notes, timeline); the printable day sheet. `reservations:read` |
+| `/admin/reservations`, `/admin/reservations/[id]`, `/admin/reservations/day` | Request time, nonce CSP | Inbox (Cần xử lý · Hôm nay · Sắp tới · Tất cả, search by reference, phone, name or email: the search posts, its text waits 30 minutes in an httpOnly cookie and the URL carries only `?tim=<id>`); a booking (status changes, edit, internal notes, timeline, its emails); the printable day sheet. `reservations:read` |
+| `/admin/reservations/emails` | Request time, nonce CSP | The email log of this environment (tabs by status, guest addresses masked) and "Gửi lại". `reservations:read`; "Gửi lại" `reservations:update` |
 | `/admin/reservations/new` | Request time, nonce CSP | Phone bookings and walk-ins. `reservations:create` |
 | `/admin/reservations/closures`, `/admin/restaurants`, `/admin/restaurants/[id]/booking` | Request time, nonce CSP | Closures with the bookings each covers; the restaurants; "Giờ và sức chứa" (switch, overrides, service periods, slot preview, affected bookings; auto-confirm for Admins). `schedule:read` |
 | `/admin/settings/booking` | Request time, nonce CSP | Booking defaults. Admin (`settings:read`) |
+| `/admin/settings/notifications` | Request time, nonce CSP | Who hears about new bookings, the shared inbox, the restaurants that fall back to it, "Gửi email thử". Admin (`settings:read`; every save `settings:update`) |
 | `/api/auth/*` | Dynamic | Better Auth; `/api/auth/admin/*` is refused with 403 |
 
 Every admin page renders at request time (`app/admin/layout.tsx`: `instant =
@@ -444,6 +630,15 @@ Guarantees:
   date (`lib/server/booking/lock.ts`) and only then reads the rules and the
   covers, in the same transaction: concurrent requests for the last seats
   cannot both win
+- a guest's submit first takes a lock per phone number and date, counts that
+  number's requested and confirmed web bookings for the date (at most 3,
+  across restaurants), and only then takes the booking-day lock; staff paths
+  take the booking-day lock only, so the two never wait on each other in a
+  circle
+- a web booking stores the privacy policy version the guest agreed to and
+  when (`consent_version`, `consented_at`)
+- the emails a change sends are `email_outbox` rows written in the change's
+  own transaction (see Email (SMTP))
 - covers are held by `requested`, `confirmed` and `seated` bookings only
 - a partial unique index (`reservations_dedupe_v2_idx`) rejects a second
   `requested` or `confirmed` booking at the same restaurant, date, time and
````

Kiểm các truy vấn của mục "Migration 007" trên DB e2e cục bộ (không bao giờ Neon; cổng kiểm tra ở Bước 4 reset nó lại): `RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs --until 006_booking_v2.sql`, chạy bốn truy vấn kiểm trước bằng `psql postgres://localhost:5432/furama_cuisine_e2e_test -X`, `DATABASE_URL_UNPOOLED=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/migrate.mjs`, rồi bốn truy vấn kiểm sau. Expected: `Applied 6 migration(s).`; trước: sáu dòng `001_init.sql` … `006_booking_v2.sql`, ba cột rỗng, `t`, `(0 rows)`; `Applied 1 migration(s).`; sau: `fb@furamavietnam.com`, `s`, `0`, `reservations_consent_check`.

- [ ] **Bước 4: Chạy cổng kiểm tra**

Expected:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo;
- `Test Files  66 passed (66)`, `Tests  848 passed (848)`;
- `Applied 7 migration(s).`; build thoát 0; check-prerender như Task 8;
- E2E `134 passed`, `1 skipped`; visual `8 passed`.

- [ ] **Bước 5: Commit**

```bash
git add README.md e2e/booking-email.spec.ts lib/server/email/outbox.ts
git commit -m "$(cat <<'EOF'
test: check phase 5's acceptance end to end, and write the owner's runbook for email, the cron and BotID

booking-email.spec.ts now walks every acceptance criterion of spec §14.1
row 5 that a browser can see: a guest booking emails the staff (A1), sent
after the response; confirming emails the guest (A2); an email whose first
attempt failed is sent by the next cron run (A3); with nobody listed the
staff email goes to the shared inbox, and the Admin's overview names the
restaurant (A4); and the cron endpoint answers 401 without its secret.
Bots being blocked (A5) is guest-guard, the opt-in BotID spec and the
integration tests.

The README gains the phase-5 E2E data map and the opt-in BotID run, the
migration-007 pre-flight and post-check queries (verified on a local 006
database), the outbox's at-least-once delivery, retries and skips, the bot
protection order, the new routes and environment variables, and the
owner's steps before launch A: the SMTP account and EMAIL_FROM, SPF, DKIM
and DMARC, the Production and Preview variables, CRON_SECRET, BotID's
project settings, the notification recipients, and the first-preview checks.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Bước 6: Chạy các đột biến của nghiệm thu**

Chạy các đột biến lần lượt, khi không server hay lần test nào khác đang chạy, mỗi đột biến trong một bản sao tạm của repo ở commit vừa tạo, không bao giờ trong cây làm việc. Bản sao bỏ `.next` và `.env.local` (file đó giữ URL Neon dùng chung và các bí mật; không để bản sao của nó nằm trong thư mục tạm):

```bash
M="${TMPDIR:-/tmp}/fc-mut"
cp -cR "$PWD" "$M" && rm -rf "$M/.next" "$M/.env.local"
cd "$M"
```

Sửa đúng một chỗ trong `$M` như bảng dưới, rồi:
- **Đột biến tích hợp:** `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run <file của cột "Chạy">`.
- **Đột biến E2E:** `RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs`, rồi dòng build của cổng kiểm tra không đổi (cùng tiền tố), rồi dòng E2E của cổng kiểm tra không đổi (cùng DB, cổng `3210`, cùng tiền tố có `CRON_SECRET`) chỉ thay `npm run test:e2e -- --retries=0` bằng `npm run test:e2e -- e2e/<spec>.spec.ts --project=desktop --retries=0`, rồi `lsof -ti tcp:3210 | xargs kill`.
- Sau mỗi đột biến: `cd - && rm -rf "${TMPDIR:-/tmp}/fc-mut"`. Không đột biến nào dùng DB hay cổng ngoài danh sách của Global Constraints; Bước 7 reset lại cả hai DB.

| Tiêu chí | Đột biến (một sửa, đúng như ghi) | Chạy | Kết quả |
|---|---|---|---|
| A1 | `lib/server/email/outbox.ts` `queueWebBookingEmails`: `const staff = await queueStaffNew(client, queue);` → `const staff: string[] = [];` | E2E `booking-email` | `1 failed`, `3 passed`: "A1, A4. a guest booking emails the staff …" (`- "fb@furamavietnam.com"`, `+ Received + 0`) |
| A2 | `outboxEffects().afterTransition` trả về ngay ở dòng đầu (`if (reservationId) return;`) | E2E `booking-email` | `1 failed`, `3 passed`: "A2. confirming in the admin emails the guest" |
| A3 (thang) | `lib/server/email/drain.ts` `scheduleRetry`: `CASE WHEN $4 THEN 'failed'` → `CASE WHEN $4 OR true THEN 'failed'` (lỗi nào cũng thành `failed` ngay) | tích hợp `email-outbox` + `cron-outbox` | `Tests  3 failed | 26 passed (29)`: "retries after 1 m, 5 m, 15 m, 1 h, 6 h and 12 h …", "a 5xx after the message (a provider quota, say) is retried, not final", "log mode marks rows sent without SMTP; log mode on a Vercel deployment is a failure that retries" |
| A3 (giữ hàng) | `claimOne`: `AND attempts < $5` → `AND attempts < $5 AND attempts = 0` (không bao giờ giữ lại một hàng đã thử) | E2E `booking-email` | `1 failed`, `3 passed`: "A3. a failed email is retried …" (`- "attempts": 2, - "status": "sent"`) |
| A4 | `queueStaffNew`: bỏ nhánh `UNION ALL SELECT s.email, 'vi', true FROM site_settings s WHERE NOT EXISTS (SELECT 1 FROM matched)` | E2E `booking-email` | `1 failed`, `3 passed`: "A1, A4. …" (không có dòng nào tới `fb@furamavietnam.com`) |
| A5 (honeypot) | `app/actions.ts`: bỏ `honeypotFilled(input)` khỏi bước 1 (`honeypotFilled.length < 0 ? 'honeypot' : …`) | tích hợp `submit-reservation`; E2E `guest-guard` | tích hợp `Tests  2 failed | 26 passed (28)`: "a filled honeypot answers bot_blocked, and the log names only the check", "comes before zod: …". E2E `4 passed`: zod `honeypot: z.literal('')` vẫn trả `bot_blocked` (lớp thứ hai, R15) |
| A5 (cả hai lớp) | như trên, và `input.ts`: `honeypot: z.literal('').optional()` → `honeypot: z.unknown()` | E2E `guest-guard` | `1 failed`, `3 passed`: "the honeypot is invisible … and a filled one is refused" (không có alert: đặt bàn đi qua) |
| A5 (BotID) | `app/actions.ts`: bỏ `await isBotRequest()` khỏi bước 1 (`isBotRequest.length < 0 ? 'botid' : null`) | tích hợp `submit-reservation` | `Tests  1 failed | 27 passed (28)`: "BotID’s verdict (its development bypass set to BAD-BOT) answers bot_blocked" |
| A5 (số điện thoại) | `phoneDayFull`: `await lockGuestPhoneDay(…)` → `void lockGuestPhoneDay;` | tích hợp `submit-reservation` | `Tests  2 failed | 26 passed (28)`: cuộc đua sáu nhà hàng (`got 6`), "a number waiting on its own lock …" |
| §13 cron | `lib/server/cron.ts` `cronAuthorized`: thêm `if (header !== '') return true;` ở đầu | tích hợp `cron-outbox`; E2E `booking-email` | tích hợp `Tests  2 failed | 2 passed (4)`; E2E `1 failed`, `3 passed`: "spec §13: the cron endpoint answers 401 without its secret …" (`Expected: 401`, `Received: 200`) |

Dàn ý ghi "bỏ `honeypotFilled` → E2E đỏ"; lần chạy cho thấy E2E vẫn xanh vì lớp zod, nên bỏ honeypot ở bước 1 được bắt bằng test tích hợp (nó kiểm log `by: 'honeypot'` và thứ tự trước zod), còn E2E bắt khi cả hai lớp mất.

- [ ] **Bước 7: Cổng cuối, hai lần, và một lần E2E với `TZ=UTC`**

Trên commit của Bước 5, chạy đủ khối "Cổng kiểm tra của mọi task" hai lần (mỗi lần reset DB e2e và build lại), rồi reset DB e2e và chạy E2E thêm một lần với `TZ=UTC` đứng đầu tiền tố (server của Playwright thừa kế nó). Sau đó: spec BotID riêng (lệnh của Task 11 Bước 4) trên build cuối, `npm audit`, và các kiểm bằng `grep`.

Expected mỗi lần:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo; `Test Files  66 passed (66)`, `Tests  848 passed (848)`;
- `Applied 7 migration(s).`; build thoát 0 (`○ /en/privacy`, `ƒ /api/cron/outbox`); check-prerender đạt;
- E2E `134 passed`, `1 skipped` (`--retries=0`); visual `8 passed` ở `maxDiffPixelRatio: 0`;
- lần `TZ=UTC`: `134 passed`, `1 skipped`;
- spec BotID riêng: `1 passed`; `npm audit`: `found 0 vulnerabilities`;
- `grep -rn "pg_advisory" lib app` chỉ ra `lib/server/booking/lock.ts`; `grep -rln "from 'nodemailer'" app lib components` chỉ ra file dưới `lib/server/email/`; `grep -rn "style={" "app/admin"` không ra gì (không thuộc tính `style` nào dưới admin); `grep -rn "reservations?q=" app lib components e2e` không ra gì; `grep -rn "drainAfterCommit(" app | grep -v import` ra đúng 5 lời gọi (Review Focus 1).

Dừng mọi server (`lsof -ti tcp:3210 | xargs kill`, cổng 3211 cũng vậy) khi xong.

- [ ] **Bước 8: Bàn giao cho controller**

Không commit gì ở bước này. Controller ghi sổ đợt 5 (`docs/superpowers/ledgers/…phase-5-ledger.md`) với các việc mang sang đợt sau:
- **Đợt 6:** thêm cột vào `site_settings` bằng `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, không `CREATE TABLE` (R3); "Hộp thư chung" sẽ đổi cả email ở chân trang.
- **Đợt 7:** sửa được `email.*` và `legal.*` trong admin (phiên bản chính sách khi đó lấy từ lần lưu, không từ hash; test hash chuyển sang luồng lưu); giới hạn `serverActions.bodySizeLimit` cho riêng action tải ảnh; các việc của bộ form còn treo từ sổ đợt 4 (REQUEST BOOKING khi lịch đang được hỏi lại vẫn khởi động lại request; vùng `status` của dải ngày gỡ ra trên đường lịch hỏng; nút "−" ở 1 khách vẫn dùng `disabled`).
- **Đợt 8:** chữ VI của chính sách và thông báo đồng ý (sau luật sư); `locale ?? 'en'`; ngày "Last updated" theo `toBcp47` cho mọi ngôn ngữ.
- **Đợt 10:** trình ẩn danh ghi đè `email_outbox.to_email` bằng `anonymized@invalid` và giữ cột đồng ý; CSP tĩnh của web khách cho phép script của BotID (Deep Analysis có thể cần wasm/eval); thời hạn lưu gắn `legal.keep_body` với `booking_settings.pii_retention_months`.
- Các rủi ro "Cần quyết định" của danh sách rủi ro (2, 3, 4, 7, 8, 10) là câu hỏi cho chủ dự án, cùng các quyết định ở cuối runbook của README.
- **Sổ đợt 3, rủi ro 1** (Preview `BETTER_AUTH_URL`, "kiểm trên preview Vercel đầu tiên"): runbook bước 5 đặt nó, bước 11 kiểm nó (hàng `staff.new` trong `/admin/reservations/emails` là "Đã gửi", không `missing_app_url`; một lời mời từ `/admin/users` tới hộp thư chuyển hướng với link tới origin của preview, và link mở được lời mời). Controller ghi mục đó đóng bằng kiểm 11 khi kiểm đó đạt trên preview đầu tiên.
---

## Bản kiểm chứng

Task 1–13 đã chạy trong `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p5-verify` (bản sao APFS của repo, gốc `0733094`, đã xóa `.next` và `.env.local`), qua ba bước:

1. **Lần chạy đầu, nhánh `main`:** đúng thứ tự, mỗi task một commit (`ccf2add` … `2232844`), RED thật trước code, cổng kiểm tra của task xanh.
2. **Đợt sửa sau review:** chín điểm của review kế hoạch ("Ghi chú triển khai", mục "Đợt sửa sau review"). Phần code là một commit `e12932b` trên `main`, chạy đủ cổng với tiền tố env cục bộ mới: typecheck không lỗi; lint 19 cảnh báo; `66` file, `848` test; `Applied 7 migration(s).`; build và check-prerender đạt; E2E `134 passed`, `1 skipped`; visual `8 passed`.
3. **Nhánh `p5-folded`, nguồn của kế hoạch:** dựng lại từ `0733094`, mỗi sửa gộp vào task sở hữu file, cùng message. Task 1 là chính `ccf2add` (đợt sửa không chạm nó); Task 2, 4, 6, 11, 13 nhận sửa của mình; các task còn lại là cherry-pick, và `git range-diff 0733094..2232844 0733094..p5-folded` cho patch của Task 3, 5, 7, 8, 9, 10, 12 trùng y lần chạy đầu. `git diff --stat main p5-folded` rỗng: cây của `04c7192` trùng từng byte với `e12932b`.

Mọi khối code, diff, lệnh `git add` và commit message của kế hoạch được sinh từ các commit của `p5-folded` (`git show <sha>:<file>`, `git show <sha> -- <file>`, `git log -1 --format=%B <sha>`), nên gõ lại từ kế hoạch hay cherry-pick từng commit cho cùng một cây.

| Task | SHA (`p5-folded`) | Lần chạy đầu | Unit + tích hợp | E2E | Visual | Lint (cảnh báo) | RED đã thấy |
|---|---|---|---|---|---|---|---|
| mốc | `0733094` | — | 53 file, 601 test | 118 | 8/8 | 19 | — |
| 1 | `ccf2add` | `ccf2add` | 55 file, 617 test | 118 | 8/8 | 19 | `events.test.ts` không import được; `migration-007.test.ts` 11 đỏ, 1 xanh (12); bẫy NULL của CHECK đồng ý: 2 đỏ |
| 2 | `a5c46ca` | `c9c0eb0` | 56 file, 640 test | 118 | 8/8 | 19 | 3 đỏ, 35 xanh, 3 suite không import được (chạy lại trên `p5-folded`: như cũ); M6 (`requireTLS: false`): 2 đỏ, 36 xanh (38) |
| 3 | `2402c21` | `153e2ad` | 57 file, 649 test | 119 | 8/8 | 19 | 3 đỏ, 8 xanh, 1 suite không import được; E2E trên build Task 2: 1 đỏ |
| 4 | `3af7551` | `f8bf9f4` | 58 file, 671 test | 122 | 8/8 | 19 | 1 đỏ, 15 xanh, 2 suite không import được; M1 4 đỏ, M2 1, M3 2, M4 1, M5 4, C14 1 (trên 29 test; chạy lại trên `3af7551`: như cũ); E2E trên build Task 3: 3 đỏ |
| 5 | `bce0125` | `9f2f99d` | 60 file, 729 test | 122 | 8/8 | 19 | 6 đỏ, 23 xanh, 1 suite không import được; E2E trên build Task 4: 2 đỏ, 1 xanh |
| 6 | `cfa732b` | `ddac649` | 62 file, 743 test | 124 | 8/8 | 19 | 5 đỏ, 62 xanh, 3 suite không import được (chạy lại trên `p5-folded`: như cũ); `sendTest` với quyền của Editor: guard 2 đỏ; E2E trên build Task 5: 2 đỏ |
| 7 | `298059c` | `9253aac` | 62 file, 749 test | 127 | 8/8 | 19 | 3 đỏ, 64 xanh, 1 suite không import được; bỏ `FOR UPDATE` của "Gửi lại": 1 đỏ; E2E trên build Task 6: 3 đỏ |
| 8 | `e2bff5e` | `f368413` | 63 file, 769 test | 128 | 8/8 | 19 | `legal.test.ts` không import được; E2E trên build Task 7: 1 đỏ; bỏ mặt nạ khỏi spec visual no-JS: 4 đỏ (132 px mỗi ảnh) |
| 9 | `16cf30b` | `57dbcdf` | 63 file, 803 test | 131 | 8/8 | 19 | 30 đỏ, 115 xanh (5 trên 7 file); bỏ khóa số điện thoại: 2 đỏ, ba lần chạy như nhau; E2E trên build Task 8: 3 đỏ, 1 xanh |
| 10 | `721cca3` | `8a9d471` | 63 file, 809 test | 133 | 8/8 | 19 | `availability.test.ts` 6 đỏ, 22 xanh; E2E trên build Task 9: 5 đỏ |
| 11 | `25d44f3` | `2c56866` | 65 file, 838 test | 133 + 1 skipped | 8/8 | 19 | 3 đỏ, 62 xanh, 2 suite không import được (chạy lại trên `p5-folded`: như cũ); `BOTID_PROTECT` chỉ `/api/*`: 4 đỏ; `botid.spec.ts` (`BAD-BOT`) trên build Task 10: 1 đỏ, trên build Task 11 của lần chạy đầu và trên build cuối của `p5-folded`: 1 xanh |
| 12 | `789a525` | `5e1f933` | 66 file, 848 test | 133 + 1 skipped | 8/8 | 19 | 3 đỏ, 38 xanh, 1 suite không import được; E2E trên build Task 11: 1 đỏ |
| 13 | `04c7192` | `2232844` | 66 file, 848 test | 134 + 1 skipped | 8/8 | 19 | bộ nghiệm thu xanh khi viết (hành vi có sẵn); 10 đột biến (chạy lại trên `04c7192`: như cũ), mỗi cái làm đúng test của nó đỏ, trừ A5 honeypot một lớp ở E2E (lớp zod giữ nó; test tích hợp đỏ) |

- **Mỗi commit của `p5-folded` từ Task 2 tới Task 13** chạy đủ khối "Cổng kiểm tra của mọi task" với tiền tố env cục bộ mới (các khóa đợt 5 để trống): typecheck không lỗi; lint thoát 0 với 19 cảnh báo; unit + tích hợp; `Applied 7 migration(s).`; build thoát 0; check-prerender đạt; E2E `--retries=0`; visual `8 passed` ở `maxDiffPixelRatio: 0`. Số ở bảng là của các lần đó, cả với các task mà patch không đổi (cây của chúng mang `send.ts`, `mode.ts`, `bot.ts` đã sửa của task trước). Task 1 là `ccf2add` không đổi: typecheck, lint (19), unit + tích hợp (`55` file, `617` test) chạy lại trong một bản sao riêng với `node_modules` của chính commit đó (`npm ci --offline`, vì nó còn import `resend`); build, E2E và visual của nó là của lần chạy đầu, cùng SHA.
- **Số đếm của lệnh test riêng mỗi task** (bước "Chạy lại test") đo trên chính commit `p5-folded`: Task 1 `16`, Task 2 `97`, Task 3 `20`, Task 4 `45`, Task 5 `52`, Task 6 `82`, Task 7 `83`, Task 8 `81`, Task 9 `145`, Task 10 `28`, Task 11 `88`, Task 12 `49` (cùng `admin-pages.guard.test.ts` `9`).
- **RED chạy lại** trên trạng thái RED của `p5-folded` (file test và gói của task trên code của task trước) cho ba task mà đợt sửa thêm test: Task 2 `Tests  3 failed | 35 passed (38)`, Task 6 `Tests  5 failed | 62 passed (67)`, Task 11 `Tests  3 failed | 62 passed (65)`, cùng các test đỏ và lỗi import như output trong kế hoạch: test mới nằm trong suite chưa import được ở RED. Task 4 chỉ thêm kiểm vào một test có sẵn của `email-outbox.test.ts`, suite báo `(0 test)` ở RED của nó. M6 của Task 2 chạy lại trên `a5c46ca`: `Tests  2 failed | 36 passed (38)`, output như ở Bước 12.
- **Đột biến:** M1–M5 và C14 của Task 4 chạy lại trên `3af7551`; mười đột biến của Task 13 chạy lại trên `04c7192` theo đúng thủ tục mới của Task 13 Bước 6 (một bản sao APFS bỏ `.next` và `.env.local` cho mỗi đột biến, lần lượt, rồi xóa), chỉ đổi tên DB và cổng thành của lần kiểm chứng (dưới); kết quả trùng các bảng của Task 4 Bước 8 và Task 13 Bước 6. Các đột biến còn lại (Task 6 guard của `sendTest`, Task 7 `FOR UPDATE` của "Gửi lại", Task 8 mặt nạ visual, Task 9 khóa số điện thoại, Task 11 `BOTID_PROTECT`) là của lần chạy đầu: đợt sửa không chạm file bị đột biến hay file test của chúng.
- **Cổng cuối, hai lần trên cùng một cây:** một lần trên `e12932b` (bước 2) và một lần trên `04c7192` (vòng ở trên), mỗi lần reset DB và build lại: typecheck không lỗi; lint thoát 0 với 19 cảnh báo; `Test Files  66 passed (66)`, `Tests  848 passed (848)`; `Applied 7 migration(s).`; build thoát 0 (`○ /en/privacy`, `ƒ /api/cron/outbox`; `.next/routes-manifest.json` có các rewrite `149e9513-…` của `withBotId`); check-prerender đạt (`/en`, `/en/restaurants/taya-house`, `/en/privacy` với `content:legal`; 17 trang admin không có static shell; `/api/availability` và `/api/cron/outbox` không prerender; font); E2E `134 passed`, `1 skipped` (`--retries=0`, gồm project `desktop-serial`); visual `8 passed`. Rồi trên build của `04c7192`: một lần E2E với `TZ=UTC`, DB vừa reset: `134 passed`, `1 skipped`; `e2e/botid.spec.ts` với `BOTID_DEV_BYPASS=BAD-BOT`: `1 passed`.
- **Kiểm thêm ở cổng cuối:** `grep -rn "pg_advisory" lib app` chỉ ra `lib/server/booking/lock.ts`; `grep -rln "from 'nodemailer'\|from \"nodemailer\"" app lib components` chỉ ra `lib/server/email/smtp.ts` và guard test của nó; `grep -rn "style={" app/admin` không ra gì; `grep -rn "reservations?q=" app lib components e2e` không ra gì; `grep -rn "drainAfterCommit(" app | grep -v import` ra đúng 5 lời gọi; mọi câu đọc `email_outbox` trong `drain.ts` và `outbox-log.ts` có điều kiện `env`.
- **Gói và `npm audit`:** `package.json`/`package-lock.json` của mọi commit `p5-folded` trùng lần chạy đầu (đợt sửa không chạm chúng). Các lệnh cài `--offline` đúng bản của Task 2 Bước 1 (trên commit Task 1) và Task 11 Bước 1 (trên hai file của Task 10) cho hai file trùng từng byte với `a5c46ca` và `25d44f3`. `npm audit` là của lần chạy đầu: `found 0 vulnerabilities` sau Task 2, sau Task 11 và ở cổng cuối; đợt sửa không ra mạng nên không chạy lại nó.
- **Tên DB và cổng của lần kiểm chứng:** giống khối "Cổng kiểm tra của mọi task", trừ tên DB và cổng, để không đụng agent khác dùng chung Postgres: `furama_cuisine_p5v_test` (`TEST_DB_TAG=p5v`) và `furama_cuisine_p5v_e2e_test`, cổng E2E `3256`, visual `3257`; mỗi lần chạy có `CRON_SECRET=$(openssl rand -hex 16)`. Bản sao của Task 1: `furama_cuisine_p5f1_test` (`TEST_DB_TAG=p5f1`). Đột biến: tích hợp với `furama_cuisine_p5vm_test` (`TEST_DB_TAG=p5vm`), E2E với `furama_cuisine_p5v_e2e_test` và cổng `3256`. Lần chạy đầu còn dùng: `p5v-red` (E2E trên build của task trước, DB `furama_cuisine_p5v_red_e2e_test`, cổng `3258`), worktree đo lệnh test riêng (`furama_cuisine_p5vw_test`), bản sao đột biến (`furama_cuisine_p5v_mut_e2e_test`, cổng `3259`), DB dựng tới 006 cho các truy vấn kiểm của migration 007 (`furama_cuisine_p5v_pre_test`). Mọi DB đó đã xóa, không server nào còn chạy khi xong; `furama_cuisine_test`/`furama_cuisine_e2e_test` không bị đụng.
- **Lần chạy đầu đã sửa commit Task 9 một lần:** tiêu đề các case `honeypotFilled` của `input.test.ts` được đổi thứ tự cột (`a URL → true`), Task 10–13 đặt lại lên nó; RED của Task 9 trong kế hoạch là lần chạy lại với file test cuối trên code của Task 8.
- Mọi lần E2E chạy `--retries=0`; visual `8 passed` ở cả 13 task; không baseline nào đổi, không lần nào dùng `--update-snapshots` (link chính sách ở chân trang bị `e2e/visual-added.css` che; thanh đặt bàn chỉ thêm một vùng `status` rỗng).
- Không gì chạm Neon, Vercel, máy SMTP thật hay dịch vụ ngoài: SMTP chỉ là máy giả trong tiến trình trên `127.0.0.1`; BotID chỉ chạy bằng bypass phát triển của chính gói; gói được cài bằng `npm install --offline` từ cache npm của máy. Lệnh ra mạng duy nhất của cả hai lần là `npm audit` của lần chạy đầu. Các truy vấn kiểm trước/sau của migration 007 trong README chạy trên một DB cục bộ dựng tới 006, không bao giờ trên Neon.
