# Đợt 3: Đăng nhập và khung admin — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nhân viên đăng nhập bằng email và mật khẩu vào một khu admin tiếng Việt, render lúc request sau CSP có nonce; Admin mời người mới (gửi lại, thu hồi), đổi vai trò, khóa, xóa và xem nhật ký; Editor bị chặn khỏi phần của Admin; mọi thao tác ghi kèm đúng một dòng `audit_log` trong cùng transaction.

**Architecture:**
- **Better Auth 1.7.7** chạy trong app trên pool `pg` sẵn có. Một cấu hình duy nhất `createAuth(deps)` (`lib/server/auth/config.ts`) dùng chung cho app, CLI schema, script tạo Admin đầu tiên và test. Bảng `staff_*` đặt tên bằng `modelName`, cột snake_case bằng `fields`. Tài khoản chỉ sinh ra qua lời mời (hook `databaseHooks.user.create.before`). `hooks.before` cùng route `/api/auth/[...all]` chặn mọi lời gọi HTTP tới `/api/auth/admin/*`.
- **Lớp ghi:** mọi Server Action của admin đi `requirePermission` → zod → `withTransaction` (ghi + `insertAudit`) → `refresh()` → `ActionResult`. Đổi vai trò, khóa, xóa dùng SQL của chính mình trong một transaction có khóa hàng Admin, không gọi `auth.api.*` (phán quyết R1). Một bài test CI (oxc-parser) bắt buộc câu lệnh đầu tiên của mọi action (và route handler `/api/admin/*`) là `await requirePermission(…)`.
- **Khung admin:** `app/admin/layout.tsx` là root layout thứ hai (`instant = false` + `await connection()` trước `<html lang="vi">`), nên không route admin nào có static shell. `proxy.ts` chỉ kiểm cookie, tạo nonce 128 bit cho từng request và gắn CSP cùng các header bảo vệ. Đăng nhập và cả hai bước đặt lại mật khẩu là Server Action (`useActionState`) gọi router HTTP của Better Auth ngay trong process, nên giới hạn số lần thử lưu trong `auth_rate_limit` vẫn áp dụng.
- **Email:** `lib/server/email/send.ts` là cửa duy nhất tới Resend, theo `EMAIL_DELIVERY` (`log` mặc định, `redirect`, `live`); template react-email tiếng Việt. Email mời gửi sau COMMIT; lỗi ghi vào `staff_invitation.email_error`. Email đặt lại mật khẩu gửi sau câu trả lời 200 (`after()`), để thời gian trả lời không lộ địa chỉ nào là nhân viên.

**Tech Stack:** Next.js 16.3.7 (Turbopack, `cacheComponents`, `experimental.authInterrupts`), React 19.3, TypeScript 7.0.2, `pg` 8.23, Postgres 18, better-auth 1.7.7, zod 4.6.5, resend 6.31.0, react-email 6.11.0, Vitest 5, Playwright 1.63, oxlint 1.86, oxc-parser 0.152.0, jiti 2.7.0.

**Spec:** `docs/superpowers/specs/2026-10-01-admin-cms-design.md` — mục 14.1 dòng 3 (đợt 3); chi tiết ở §3 (quyết định 3, 7, 8), §5.2 "Nhân viên, quản trị", §7.1–7.4, §10.4, §11, §13.

**Căn cứ đã kiểm chứng:**
- `docs/superpowers/research/2026-10-02-phase-3-spikes/00-plan-outline.md` (dàn ý của lead, các xung đột C1–C12 và phán quyết R1–R15) cùng ba báo cáo spike `better-auth-core.md`, `admin-layout-csp-vi.md`, `auth-emails.md`.
- Mọi khối code dưới đây được lấy nguyên văn từ bản sao kiểm chứng `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p3-verify`, nhánh `p3-folded`. Kế hoạch đã được chạy đúng thứ tự Task 1→11 trong bản sao đó, mỗi task một commit, mỗi task xanh typecheck, lint, unit + tích hợp, build, check-prerender, E2E và visual ở ngưỡng 0. Các sửa đổi sau review (commit `b47a129` trên `main` của bản sao, chạy đủ cổng) được gộp vào task sở hữu từng file trên `p3-folded`; cây của Task 11 trên nhánh đó giống hệt cây của `b47a129`. Output "Expected: FAIL" trong các bước là output thật của lần chạy đó (đường dẫn tuyệt đối được rút gọn). SHA từng task và phạm vi kiểm của từng lần chạy nằm ở cuối kế hoạch.
- Sổ việc hoãn của đợt 2 (`docs/superpowers/ledgers/2026-10-01-phase-2-ledger.md`) không giao mục nào cho đợt 3. Phán quyết 7 của đợt 2 (route tĩnh hết hạn trả 500 thô khi DB sập) vẫn nằm im: đợt 3 không làm hết hạn tag nào của web khách.

## Global Constraints

**An toàn dữ liệu — đọc trước mọi lệnh:**
- `.env.local` đang trỏ vào **DB Neon dùng chung với production**.
- **Không bao giờ chạy** `npm run db:migrate`, `npm run db:psql`, `npm run dev`, `vercel env pull`.
- **Không bao giờ chạy `npx auth migrate`**, và không chạy bất kỳ lệnh `npx auth …` nào thiếu `--config scripts/auth-cli.config.ts`. CLI của Better Auth tự nạp `.env` và `.env.local` (`node_modules/auth/dist/index.mjs:37,1203`) vào mọi biến mà shell để `undefined` (`node_modules/c12/dist/index.mjs:24`), kể cả các biến `PG*`. File config đó đọc biến riêng `AUTH_CLI_DATABASE_URL`, từ chối mọi host khác localhost và xóa mọi biến `PG*` trước khi kết nối (Task 2). Lệnh `npx auth …` cũng mang tiền tố `PGHOST= PGUSER= PGPASSWORD= PGDATABASE=`.
- Từ Task 7, mọi lần ghi DB của E2E đi qua `db()` trong `e2e/staff-fixtures.ts`, hàm này từ chối mọi `DATABASE_URL` không phải DB cục bộ tên `*_test`/`*_ci`, kể cả khi `E2E_BASE_URL` làm `playwright.config.ts` bỏ qua phần kiểm của nó.
- Mọi lần build, `next start`, `next dev`, E2E và visual đều dùng **tiền tố env cục bộ**. Biến env của tiến trình thắng `.env.local`; bốn biến `PG*` phải để trống, nếu không Next nạp chúng từ `.env.local` và `pg` dùng cho phần còn thiếu của URL:

  ```bash
  CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test
  ```

- `next start` và E2E còn cần thêm biến auth và email. **`EMAIL_DELIVERY=log` phải đặt tường minh**, vì `next start` cũng đọc `.env.local`. Từ Task 7, `playwright.config.ts` từ chối bật server khi thiếu một trong ba biến dưới:

  ```bash
  BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson E2E_PORT=3210
  ```

- `next build` **không** cần biến `BETTER_AUTH_*`, `RESEND_*` hay `EMAIL_*`: Better Auth được tạo lười (`getAuth()`), và DAL gọi `headers()` trước mọi thứ.
- Chỉ được tạo, xóa hoặc ghi các DB cục bộ sau:
  - `furama_cuisine_test` (tích hợp; test tự tạo thêm `furama_cuisine_migrate_test`, `furama_cuisine_migrate004_test`, `furama_cuisine_migrate005_test`);
  - `furama_cuisine_e2e_test` (build, E2E, visual);
  - `furama_cuisine_cli_test` (Task 2, `npx auth check`);
  - `furama_cuisine_dev_test` (Task 11, `next dev` kiểm console).

  Tạo lại bằng `RESET_DATABASE_URL=postgres://localhost:5432/<tên> node scripts/reset-db.mjs` (script này từ chối host khác localhost và tên không kết thúc bằng `_test`/`_ci`). Xóa bằng `psql -h localhost -d postgres -c 'DROP DATABASE <tên>'` khi task nói vậy.
- Cổng: E2E `3210`, visual `3211`, `next dev` `3212` (khoảng 3200–3299 dành cho agent; CI dùng 3100). Trước khi bật server, `lsof -nP -iTCP:<cổng> -sTCP:LISTEN` phải không in gì. Xong thì dừng đúng server mình bật: `lsof -ti tcp:<cổng> | xargs kill`.
- Kế hoạch này **không chạy migration 005 lên Neon** và không tạo Admin trên Neon. README (Task 5, Task 11) ghi cách làm việc đó.

**Git:**
- Làm thẳng trên `main`, không tạo branch. Mỗi task một commit. **Không push.**
- `git add` từng file cụ thể, không dùng `git add -A`.
- Hai mục untracked không thuộc các commit này: chính file kế hoạch này (`docs/superpowers/plans/2026-10-02-phase-3-auth-admin-shell.md`) và thư mục `docs/superpowers/research/2026-10-02-phase-3-spikes/`.
- Mọi commit message kết thúc bằng dòng attribution mà phiên thực thi của bạn được cấu hình để thêm. Các khối commit dưới đây in dòng của phiên kiểm chứng (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); nếu phiên của bạn cấu hình một dòng khác, thay dòng cuối của mỗi message bằng dòng đó, không chép tên model của phiên khác.

**Next 16 và TypeScript 7:**
- Next.js 16.3.7 có thay đổi phá vỡ. Đọc tài liệu trong `node_modules/next/dist/docs/` trước khi dùng API Next (theo `AGENTS.md`). Kế hoạch trích dẫn theo dạng `file.md:dòng`.
- Từ Task 1, `npm run typecheck` là `next typegen && tsc --noEmit --incremental false`:
  - `next typegen` sinh lại `.next/types`. Khi `app/admin/layout.tsx` (root layout thứ hai) xuất hiện, `lang()` của `next/root-params` đổi thành `Promise<string | undefined>` (`next-root-params.md:286-313`), và `tsc` trần không thấy điều đó.
  - `--incremental false`: lúc kiểm chứng, TypeScript 7 với `tsconfig.tsbuildinfo` cũ báo **kết quả cũ** sau khi `next typegen` viết lại `.next/types/root-params.d.ts` (báo 0 lỗi khi thật ra có 5, và ngược lại). Chạy không cache chỉ mất khoảng 0,4 giây.
- Nếu đã chạy `next dev` rồi xóa hoặc đổi tên một trang, chạy `rm -rf .next/dev` trước typecheck và build: `tsconfig.json` có `include` `.next/dev/types/**`, và kiểu cũ trỏ tới trang không còn (`TS2307 Cannot find module '../../../app/admin/...'`).
- `next build` cũng typecheck cả file test (`tsconfig` gồm `**/*.ts`), nên một lỗi kiểu trong test làm hỏng build.
- Khai báo props của layout và page tường minh, không dùng `LayoutProps`/`PageProps` sinh tự động.
- Lint thoát 0. Trước đợt 3 có 18 cảnh báo; đợt 3 chỉ thêm đúng hai cảnh báo `import(no-named-as-default-member)` cho `import pg from 'pg'` (trong `scripts/create-admin.mjs` và `e2e/staff-fixtures.ts`, cùng kiểu với `scripts/migrate.mjs`). Kết thúc đợt: 20 cảnh báo.
- Comment trong code viết bằng tiếng Anh, giải thích "vì sao".

**Phiên bản** (cài đúng các bản này; `package.json` giữ dấu `^` như repo):

| Loại | Gói |
|---|---|
| dependencies | `better-auth@1.7.7`, `zod@4.6.5`, `resend@6.31.0`, `react-email@6.11.0` |
| devDependencies | `auth@1.7.7` (CLI của Better Auth; `@better-auth/cli` đã ngừng), `jiti@2.7.0`, `oxc-parser@0.152.0` |
| Kéo theo, để tham khảo | `@better-auth/core@1.7.7`, `@better-auth/kysely-adapter@1.7.7`, `better-call@1.4.0`, `kysely@0.29.6`, `@react-email/render@2.1.0` |
| Không đổi | `next@16.3.7`, `react@19.3.0`, `pg@8.23.0`, `typescript@7.0.2`, `vitest@5.0.3`, `@playwright/test@1.63.0`, `oxlint@1.86.0` |
| Runtime | Node 22.22.0 cục bộ, Node 24 trong CI; Postgres 18.3 cục bộ, 18 trong CI |

Không thêm `@react-email/components` (đã ngừng) hay `@react-email/render` vào `package.json`.

**Biến môi trường:**

| Ngữ cảnh | Giá trị chính xác |
|---|---|
| Unit + tích hợp | `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test`. Không có biến auth hay email: test truyền `secret: 'test-secret-0123456789abcdef0123456789abcdef'`, `baseURL: 'http://localhost:3000'`, `bootstrapAdminEmail: 'owner@furama.test'`, và `rateLimitEnabled: true` chỉ trong test giới hạn số lần thử. |
| CLI Better Auth | `PGHOST= PGUSER= PGPASSWORD= PGDATABASE= AUTH_CLI_DATABASE_URL=postgres://localhost:5432/furama_cuisine_cli_test npx auth check --config scripts/auth-cli.config.ts` |
| Build | tiền tố env cục bộ + `npm run build` |
| E2E | tiền tố env cục bộ + biến auth/email ở trên + `npm run test:e2e -- --retries=0` |
| Production | `BETTER_AUTH_SECRET` riêng (≥ 32 byte), `BETTER_AUTH_URL=https://<domain production>`, `EMAIL_DELIVERY=live`, `EMAIL_FROM='Furama Cuisine <no-reply@mail.furamavietnam.com>'`, `RESEND_API_KEY` (key production). Không có `BOOTSTRAP_ADMIN_EMAIL`, không có `EMAIL_LOG_FILE`. |
| Preview | `BETTER_AUTH_SECRET` riêng, `BETTER_AUTH_URL` = URL của preview đó, `EMAIL_DELIVERY=redirect`, `EMAIL_REDIRECT_TO=<hộp thư chung>`, `EMAIL_FROM`, `RESEND_API_KEY` (key riêng). |

**Tên và hằng số:**
- Bảng: `staff_user`, `staff_session`, `staff_account`, `staff_verification`, `auth_rate_limit`, `staff_invitation`, `audit_log`; view `audit_feed`. Index `staff_invitation_open_email_idx` giữ một lời mời mở cho mỗi email. File test tích hợp về nhân viên chạy `TRUNCATE staff_user, staff_invitation, audit_log, auth_rate_limit, staff_verification CASCADE` trong `beforeEach` (`staff_session`, `staff_account` đi theo `staff_user`).
- Cookie phiên: `better-auth.session_token` trên http, `__Secure-better-auth.session_token` khi `BETTER_AUTH_URL` là https; HttpOnly, SameSite=Lax, Path=/, Max-Age=604800. Không dùng `better-auth.session_data` (cookie cache tắt; proxy coi một jar chỉ có cookie này là chưa đăng nhập). Đăng nhập luôn gửi `rememberMe: true`. `NEXT_LOCALE` không đổi.
- Hành động audit (`entity_type` là `staff_user` hoặc `staff_invitation`): `staff.bootstrap`, `staff.invite`, `staff.invite_resend`, `staff.invite_revoke`, `staff.invite_accept`, `staff.role`, `staff.ban`, `staff.unban`, `staff.remove`. Token không bao giờ vào `audit_log`; `after` của lời mời là `{email, role, expires_at}`. DB chỉ giữ SHA-256 của token: `staff_invitation.token_hash`, và `staff_verification.identifier` của token đặt lại mật khẩu (`verification.storeIdentifier: 'hashed'`).
- `ActionResult`: `{ ok: true, data }` hoặc `{ ok: false, code, fieldErrors? }`. `code` thuộc `forbidden`, `invalid`, `db_error`, `already_staff`, `already_invited`, `not_found`, `last_admin`, `self`, `invalid_token`. `PermissionError('unauthenticated')` cũng thành `forbidden`.
- Hằng: hạn lời mời `'7 days'`; regex token `^[A-Za-z0-9_-]{43}$`; hạn token đặt lại mật khẩu 3600 giây (email ghi 60 phút); phiên 7 ngày, `updateAge` 1 ngày; mật khẩu 12–128 ký tự; `email_error` tối đa 300 ký tự; nhật ký 50 dòng một trang.
- Ma trận quyền (`lib/server/auth/permissions.ts`, Task 1). Quyền dùng trong đợt 3: trang `/admin/users` cần `user:list`, `/admin/audit` cần `audit:read`; action: `inviteStaff`/`resendInvite`/`revokeInvite` cần `user:create`, `changeStaffRole` cần `user:set-role`, `banStaffMember`/`unbanStaffMember` cần `user:ban`, `removeStaffMember` cần `user:delete`.

**Quy tắc code:**
- **Tạo lười:** `getAuth()` dựng Better Auth ở lần dùng đầu. Không gì tạo Better Auth hay đọc `BETTER_AUTH_*` lúc import.
- **DAL trước:** DAL `await headers()` trước `getAuth()`. Mọi trang admin export `instant = false` và gọi `verifySession()` hoặc `requirePagePermission()` trước khi đọc DB. Ngoại lệ: ba trang công khai đọc DB sau `await searchParams` (cũng là API lúc request, nên build dừng ở đó).
- **Action:** câu lệnh đầu tiên của mọi Server Action admin là `await requirePermission(…)`, đứng riêng hoặc là initializer duy nhất của một khai báo (`const actor = await requirePermission(…)`). Nó cũng có thể là câu đầu trong một `try` ở cấp cao nhất, khi `catch` của `try` đó kết thúc bằng `return` hoặc `throw` và không có `finally`. Sau đó là zod, rồi `withTransaction` (ghi + `insertAudit`), rồi `refresh()`. Trả `ActionResult`, không ném lỗi ra client. `redirect()` nằm ngoài `try`.
- **Không gọi `auth.api.*` khi đang giữ client của `withTransaction`:** không nguyên tử, và pool chỉ có 5 kết nối.
- **Không đăng nhập hay đặt lại mật khẩu qua `auth.api.*` từ action công khai:** dùng `callAuthEndpoint` để giới hạn số lần thử áp dụng. Lời gọi `auth.api.signInEmail` duy nhất nằm trong `acceptInvitation` (mật khẩu vừa đặt).
- **Endpoint của plugin admin** chỉ được dùng trong `lib/server/auth/staff.ts` và `scripts/create-admin.mjs`. Test CI lấy danh sách từ chính plugin (`Object.keys(admin({ ac, roles }).endpoints)`: 15 endpoint ở 1.7.7, gồm `adminUpdateUser`, `revokeUserSessions`, `userHasPermission`). Nó bắt cả lời gọi `api.x`/`api['x']` lẫn destructure `const { x } = auth.api`, và đọc cây cú pháp nên comment nhắc tên endpoint không tính.
- **Một cấu hình:** `nextCookies()` là plugin cuối. Chỉ có một `createAuth`, vì plugin admin sửa schema dùng chung lúc khởi tạo.
- **Không inline style trong admin:** không `style={…}` dưới `app/admin`, không import component của web khách (`components/**`), chưa dùng `next/image` (đợt 7 sẽ thêm hash CSP).
- **Locator E2E:** Cache Components giữ trang vừa rời ở trạng thái ẩn (`<Activity>`), nên dùng locator theo role (bỏ qua phần ẩn) hoặc `getByLabel(…, { exact: true })`. Thông báo lỗi tìm trong `form` hoặc `main`, vì route announcer của Next cũng là `role=alert`.
- **Ngày giờ:** qua `lib/admin/format.ts` (`VENUE_TZ`), không gọi `Date.now()` trong render; "hết hạn" do SQL tính.

**Cổng kiểm tra của mọi task** (bước cuối mỗi task viết lại đầy đủ, kèm con số mong đợi):

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

Visual luôn mong đợi `8 passed` ở `maxDiffPixelRatio: 0`. **Không bao giờ chạy `--update-snapshots`.** Visual đỏ thì mở `test-results/**/*-diff.png` và sửa code.


## Rulings — 15 điểm lệch spec đã được chấp nhận (không báo lại khi review)

Kế hoạch chấp nhận cả 15 phán quyết đề xuất trong dàn ý (mục 2). Không phán quyết nào trái với mục đích của spec; ba điểm (R1, R2, R10) đổi cách làm mà spec ghi, và lý do ghi ngay tại đó. Reviewer không nêu lại chúng như lỗi.

1. **R1. Đổi vai trò, khóa, mở khóa và xóa dùng SQL của chính mình, không gọi `auth.api.*` (lệch §7.1).**
   - Đã đo: `auth.api.setRole` commit trên kết nối Kysely riêng của Better Auth, ngoài transaction của ta (test "auth.api.setRole commits outside our transaction", Task 2: BEGIN → setRole → ROLLBACK, thay đổi vẫn còn). Gọi nó thì "đúng một dòng audit với đúng người" và "không hạ quyền Admin cuối cùng" (§7.1, §14.1) không thể nguyên tử.
   - Cách làm: một `withTransaction` khóa các hàng Admin (`FOR UPDATE ORDER BY id`), kiểm Admin cuối cùng, UPDATE hoặc DELETE (khóa thì xóa luôn `staff_session`), `insertAudit`, COMMIT. Đây đúng là phần ghi mà `setRole`/`banUser`/`removeUser` làm; phiên đọc vai trò mới ở request kế tiếp.
   - Nếu sai: một bản Better Auth sau thêm hiệu ứng phụ cho các endpoint đó mà ta không làm theo. Kiểm lại mỗi lần nâng Better Auth.
2. **R2. Danh sách action công khai gồm đúng 6 mục (spec: "hiện chỉ có `submitReservation`").** Chữ "hiện" của spec cho phép danh sách lớn lên; đăng nhập, đăng xuất, nhận lời mời và đặt lại mật khẩu không thể có phiên trước khi chạy.
   - `app/actions.ts#submitReservation`
   - `app/admin/(auth)/sign-in/actions.ts#signIn`
   - `app/admin/(shell)/actions.ts#signOut`
   - `app/admin/(auth)/reset-password/actions.ts#requestPasswordReset`
   - `app/admin/(auth)/reset-password/actions.ts#resetPassword`
   - `app/admin/(auth)/accept-invite/actions.ts#acceptInvitation`

   Mỗi mục ghi điều gì bảo vệ nó. Test còn kiểm rằng mỗi mục vẫn trỏ tới một export có thật, để đổi tên action không để lại lỗ hổng.
3. **R3. Đăng nhập, xin đặt lại và đặt lại mật khẩu là Server Action gọi router HTTP của Better Auth ngay trong process (`auth.handler`),** nên cả `useActionState` (§7.3) lẫn "giới hạn số lần thử lưu trong DB" (§7.1) đều đúng. Nhận lời mời gọi `auth.api.*` và không bị giới hạn, vì token 256 bit chính là thông tin xác thực.
4. **R4. Mọi `app/admin/**/page.tsx` cũng export `instant = false`** (spec §11 chỉ nhắc `app/admin/layout.tsx`). Thiếu nó thì `next dev` báo route chặn giữa các trang admin (`instant-navigation.md:568`). Một test guard bắt buộc điều này.
5. **R5. Trang admin trả HTTP 200 trên `next start`,** kể cả khi render chuyển hướng về đăng nhập, trang 403 hay trang 404: chúng đi trong RSC payload (`next/dist/build/templates/app-page-runtime.js:1211-1213, 1388-1440`). Chỉ 307 của proxy là status thật; `next dev` trả 403/404 thật. Test nghiệm thu kiểm giao diện và việc không có dữ liệu, không kiểm status; Server Action vẫn là ranh giới thật.
6. **R6. Dùng `experimental.authInterrupts: true` cho `forbidden()` và `(shell)/forbidden.tsx`** (spec không nhắc). Giữ URL, render trang 403 tiếng Việt trong khung, tự thêm noindex (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/forbidden.md:15`). Repo đã dùng `globalNotFound` cũng là experimental. Phương án dự phòng nếu cờ bị bỏ: `redirect('/admin?denied=1')` (spike p3-auth đã kiểm).
7. **R7. Schema Better Auth (§5.2):** cột snake_case qua `fields`; plugin admin thêm `staff_session.impersonated_by` (luôn NULL). CLI được ghim `auth@1.7.7` (devDependency) thay vì `npx auth@latest`, và chỉ chạy với `--config scripts/auth-cli.config.ts`. Không bao giờ `npx auth migrate`.
8. **R8. Phần thêm của §5.2:** `staff_invitation` "Gửi lại" xoay token tại chỗ; CHECK email chữ thường, vai trò, hash 64 hex, không vừa dùng vừa thu hồi; index một phần `staff_invitation_open_email_idx`. `audit_log` có `id` identity, `ip inet`, CHECK trên `action` (`create|update|delete|reorder|restore|settings|staff\.[a-z_]+`). `audit_feed` tạo ngay trên `audit_log`; đợt 4 sẽ `CREATE OR REPLACE` với đúng các cột theo đúng thứ tự.
9. **R9. Phần thêm của §10.4:** `EMAIL_LOG_FILE` (NDJSON, không bao giờ ghi khi `VERCEL_ENV` là `production` hoặc `preview`; trên hai deployment đó chế độ `log` cũng chỉ in tên miền người nhận và khóa idempotency); giá trị `EMAIL_DELIVERY` lạ thì ném lỗi (đóng an toàn); `redirect` thêm `[địa chỉ gốc]` vào tiêu đề; `url` reset của Better Auth bị bỏ qua; email reset lỗi chỉ được ghi log (không có cột cho nó, và hook không được lộ tài khoản có tồn tại hay không). Email reset gửi sau câu trả lời 200 (`advanced.backgroundTasks` với `after()` của Next), nên địa chỉ của nhân viên không trả lời chậm hơn địa chỉ lạ.
10. **R10. "Admin đầu tiên tạo bằng script" là `scripts/create-admin.mjs`** (jiti + `auth.api.createUser`), không phải `npx auth create-admin` (tự nạp `.env.local` và hỏi tương tác). `BOOTSTRAP_ADMIN_EMAIL` chỉ đặt trong shell chạy script. Kế hoạch làm chặt hơn dàn ý: app **không bao giờ** đọc biến này (`getAuth()` truyền `bootstrapAdminEmail: undefined`), nên dù ai đó đặt nó trên Vercel thì app vẫn không có đường bootstrap. Admin đầu tiên có `email_verified = true` như người được mời.
11. **R11. Hai file web khách đổi, và lệnh typecheck đổi** (xem Global Constraints): root layout thứ hai làm `lang()` thành `string | undefined`.
12. **R12. Ngoài §11:** thêm `X-Robots-Tag`, `Referrer-Policy: same-origin` (giữ URL có token khỏi site khác), `nosniff`, `Permissions-Policy`, `base-uri 'none'`; `app/admin/[...missing]` cho URL admin lạ một trang 404 tiếng Việt (status 200 theo R5).
13. **R13. Phạm vi:** khóa/mở khóa có làm (§7.3 cần câu "tài khoản bị khóa", §7.1 liệt kê). **Admin đặt mật khẩu cho người khác không làm**: đặt lại qua email đã đủ; nếu cần sau này thì là `(await auth.$context).password.hash` cộng SQL trong transaction. Trang Tổng quan chỉ có lời chào, ngày và các lời mời gửi email lỗi; các ô khác của §7.2 đến ở đợt 4, 5, 8.
14. **R14. Giới hạn số lần thử giữ mặc định của Better Auth:** `/sign-in*` 3 lần mỗi 10 giây, `/request-password-reset` 3 lần mỗi 60 giây, theo IP và đường dẫn; chỉ bật khi `NODE_ENV=production` (`next start`, Vercel), dev thì không. Chưa có giới hạn theo email ở đợt 3; xem lại ở đợt 10.
15. **R15. Bước `updateTag` của §7.4:** thao tác nhân viên không chạm tag cache nào, nên action gọi `refresh()` (`04-functions/refresh.md`). Không phải lệch spec thật; ghi ra để reviewer không báo thiếu `updateTag`.

**Ghi chú triển khai.** Các điểm sau không lệch spec; chúng điều chỉnh dàn ý theo những gì lần chạy kiểm chứng cho thấy. Mỗi điểm đã chạy thử trong `p3-verify`.
- `npm run typecheck` dùng `--incremental false` (lỗi cache của TypeScript 7, xem Global Constraints).
- Mục menu đi cùng trang của nó: Task 7 chỉ có "Tổng quan", Task 9 thêm "Nhân viên", Task 10 thêm "Nhật ký". `requirePagePermission`, `authInterrupts` và `forbidden.tsx` vào Task 9 cùng người dùng đầu tiên của chúng.
- Ca "điều hướng mềm trong khung" của Task 7 là đăng nhập → `/admin` (redirect của action là điều hướng mềm, nạp chunk mới của khung); Task 9 nối thêm cú bấm "Nhân viên".
- Biến môi trường E2E của CI vào Task 7 (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `EMAIL_DELIVERY`) và Task 8 (`EMAIL_LOG_FILE`), cùng lúc với thứ cần chúng, không đợi Task 11.
- `permissionResponse` (401/403 cho route handler) và việc kiểm header `Origin` của route handler admin (§7.1) không làm: đợt 3 không có route handler `/api/admin/*`. Route đầu tiên (upload, đợt 7) thêm cả hai cùng test; guard CI đã quét `app/api/admin/**/route.ts` từ Task 7. `ActionResult` không có `params` (chưa mã nào cần).
- `AuthDeps.sendResetPassword` nhận `{ user, token }` và tự dựng liên kết (`sendPasswordReset`), thay vì nhận liên kết dựng sẵn.
- `AuthDeps.backgroundTask` (tùy chọn) thành `advanced.backgroundTasks.handler`. Thiếu nó, Better Auth `await` việc gửi email reset (`node_modules/better-auth/dist/context/create-context.mjs:215-221`), nên thời gian trả lời cho biết địa chỉ nào là nhân viên. App truyền `(task) => after(task)`; test truyền một hàm bỏ qua promise. Kế hoạch dùng `after()` của Next (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md:6`, hỗ trợ trên Node server ở dòng 236-245, chạy trên `waitUntil` ở dòng 250) thay cho `waitUntil` của `@vercel/functions`. Trên Vercel hai cách là một cơ chế; ngoài Vercel, `getContext().waitUntil` của `@vercel/functions` không có, nên lời gọi đó không làm gì. Handler này cũng chạy phần dọn `auth_rate_limit` (`node_modules/better-auth/dist/api/rate-limiter/index.mjs:176`); phần đếm vẫn được `await`.
- Lời mời bị kẹt (`createUser` xong nhưng lệnh đánh dấu đã dùng lỗi) không bao giờ tạo lại được tài khoản. Mở lại link thì `acceptInvitation` trả `already_staff` và đặt `used_at`. `removeStaff` thu hồi mọi lời mời còn mở của địa chỉ đó trong cùng transaction xóa, không ghi thêm dòng audit (lời mời đó vốn không được phép còn mở).
- `auditActor()` trả cả `name`, để email mời ghi tên người mời. `staffDeps()` (pool, Better Auth, hàm gửi email mời) nằm trong `lib/server/auth/auth.ts`.
- Logic quét của test guard nằm trong `test/guards/server-actions.ts`, để test của guard có thể chạy nó trên mã nguồn giả (kiểm guard bắt được lỗi). Guard quét mọi file nguồn của repo (`.js/.mjs/.cjs/.ts/.mts/.cts/.jsx/.tsx`, trừ `*.test.*` và `*.d.ts`). Nó bỏ qua `node_modules`, mọi thư mục bắt đầu bằng `.`, và ở cấp cao nhất thì bỏ `e2e`, `test`, `docs`, `design-src`, `public`, `playwright-report`, `test-results`. Route admin là mọi `route.{js,jsx,ts,tsx}` dưới `app/api/admin/`, kể cả `app/api/admin/route.ts`, với đủ bảy method (cả `HEAD`, `OPTIONS`). Một `try` mở đầu bằng `await requirePermission(…)` không cần là câu lệnh cuối của hàm: khi `catch` luôn `return`/`throw` và không có `finally`, code sau `try` chỉ chạy khi việc kiểm đã qua (đúng mẫu "`redirect()` nằm ngoài `try`").
- Nhãn vai trò của lời mời được định dạng ở server: nếu component client import `lib/admin/nav.ts`, ma trận quyền của better-auth sẽ vào bundle của trình duyệt (đã kiểm: chunk chứa `impersonate-admins`).
- E2E: ba tài khoản seed (`owner@`, `editor@`, `banned@furama.test`) chỉ dùng để đăng nhập. Test nào đổi tài khoản thì tự tạo tài khoản riêng với email duy nhất theo lần chạy. Hai test phụ thuộc số Admin (Admin cuối cùng; đổi vai trò nghiệm thu) giữ advisory lock `e2e-admin-count` để worker song song không đổi số đó giữa chừng. Mỗi test có một `X-Forwarded-For` riêng.
- `scripts/check-prerender.mjs` báo lỗi khi manifest không có route admin nào, để luật 1b không bao giờ "xanh" vì không thấy gì.
- Lời nhắc mật khẩu của `create-admin.mjs` ghi vào một stream bỏ đi thay cho `rl._writeToOutput` (tránh cảnh báo lint `no-underscore-dangle`).


## Review Focus

Năm tình huống spec ngụ ý mà dễ làm hỏng nhất cho người dùng thật. Mỗi dòng có test gắn vào task sở hữu code.

1. **Phiên bị chiếm hoặc cookie sai phạm vi.**
   - Có thể hỏng: action đăng nhập chuyển cookie của khách vào request bên trong, hoặc chép cookie từ chỗ khác ngoài `Set-Cookie` của Better Auth; `toCookieOptions` làm mất HttpOnly, Secure hay SameSite; tên `__Secure-` dùng trên https mà proxy chỉ biết tên thường; tài khoản bị khóa hoặc bị xóa vẫn còn phiên; đặt lại mật khẩu để phiên cũ sống.
   - Test: `lib/server/auth/endpoint.test.ts` "POSTs JSON from the app’s own origin, forwarding only the client address and user agent" và "copies each Set-Cookie into the action’s response with its attributes" (Task 7); E2E `admin-sign-in.spec.ts` "the Admin signs in, lands on ?next=, and signs out" (HttpOnly, Lax, 7 ngày, đăng xuất xóa cookie) và "a forged session cookie passes the proxy, but the page sends the browser to sign-in" (Task 7); `proxy.test.ts` "passes with %s and sets the admin headers" (cả hai tên cookie) và "ignores cookies with other names" (jar chỉ có `session_data`) (Task 6); tích hợp `better-auth.test.ts` "reset: request → token → new password; old sessions are revoked" và "the next session read sees a changed role (no cookie cache)" (Task 2), `staff-auth.test.ts` "ban signs the member out everywhere, keeps them out, and logs it; unban logs too" và "removing staff deletes their sessions and logs the removal" (Task 4); E2E `admin-users.spec.ts` "ban ends the member’s session and keeps them out; unban lets them back" (Task 9).
2. **Token lời mời dùng lại hoặc hết hạn.**
   - Có thể hỏng: token được nhận sau `used_at`, `revoked_at` hay `expires_at`; "Gửi lại" để hash cũ còn hiệu lực; token thô (lời mời hay đặt lại mật khẩu) lọt vào DB, `audit_log`, log của Vercel (kể cả Preview) hay idempotency key; tạo tài khoản xong mà đánh dấu đã dùng thất bại để lại link dùng lại được sau khi người đó bị xóa.
   - Test: tích hợp `staff-auth.test.ts` "invite → accept → sign in, with one audit row per step and a single-use token" (chỉ lưu hash 64 hex, token không có trong `audit_log`), "resend issues a new token and kills the old one", "revoke closes the link and the account gate", "an expired invitation cannot be accepted, and the email can be invited again", "two racing accepts of one token create one account", "removing the member closes an invitation left open, so its link cannot recreate the account" và "reopening a link whose account exists answers already_staff and closes the invitation" (Task 4); `better-auth.test.ts` "reset: request → token → new password; old sessions are revoked" (token đặt lại mật khẩu không có trong `staff_verification`) (Task 2); `email.test.ts` "renders the invitation for the sink, keyed by the invitation and a hash of the token" và "on a Production or Preview deployment, logs neither the address nor the link, and writes no file" (Task 3); E2E `admin-invite-reset.spec.ts` "the invitee sets a name and password, is signed in as Editor, and the link is single-use" và "an expired or revoked invitation shows the invalid view" (cả token sai dạng) (Task 8); E2E `admin-users.spec.ts` "an Admin invites; resend replaces the link; revoke closes it" (Task 9).
3. **Mất Admin cuối cùng.**
   - Có thể hỏng: hạ quyền, khóa hoặc xóa để lại 0 Admin đang hoạt động; hai Admin hạ quyền nhau cùng lúc; đếm cả Admin đã bị khóa; thứ tự khóa khác nhau giữa các hàm gây deadlock.
   - Test: tích hợp `staff-auth.test.ts` "cannot demote, ban or remove the last Admin; a banned Admin does not count" và "two Admins demoting each other at once leave one Admin" (Task 4); E2E `admin-users.spec.ts` "the last Admin cannot demote themselves" (câu báo tiếng Việt, giữ khóa advisory `e2e-admin-count`) (Task 9).
4. **CSP làm hỏng hydration.**
   - Có thể hỏng: một trang admin bị prerender nên HTML không có nonce; `style=` inline, `next/image`, component của web khách hay script bên thứ ba lọt vào admin; `'unsafe-eval'`/`'unsafe-inline'` của dev lọt ra production; proxy thôi gắn CSP vào **request**.
   - Test: `scripts/check-prerender.mjs` luật 1b (mọi route `/admin` có `response:"empty"`, `htmlSize:0`) kèm một lần build âm (Task 6 Bước 19); `lib/admin/admin-pages.guard.test.ts` "every page.tsx exports instant = false", "the root layout blocks on connection() before rendering <html>" và "no inline style attributes" (Task 6); `lib/admin/csp.test.ts` "production: nonce + strict-dynamic for scripts, nonce for styles, nothing inline or eval" (Task 6); E2E `admin-security.spec.ts` "/admin/sign-in carries a nonce CSP, and every <script> has that nonce", "the nonce is new on every response" và "sign-in hydrates with no violation" (Task 6), "signing in moves into the shell without a document request or a violation" (Task 7; Task 9 thêm cú bấm "Nhân viên" vào chính test này), "the public reset and accept-invite pages hydrate with no violation" (Task 8); `next dev` sạch console trên mọi trang admin (Task 11 Bước 7).
5. **Editor tới được action chỉ dành cho Admin bằng POST thẳng.**
   - Có thể hỏng: action kiểm sai quyền, kiểm sau khi đã ghi, gọi `requirePermission` mà không `await` hay chỉ dưới một điều kiện, hoặc bắt `PermissionError` rồi chạy tiếp; một file `'use server'` mới quên kiểm, kể cả ở thư mục ngoài `app`/`lib`/`components`; endpoint plugin admin với tới được qua HTTP, được gọi phía server mà không theo quyền của người gọi, hoặc được gọi (hay destructure) ngoài hai file được phép, ví dụ `adminUpdateUser` đổi `role`/`banned` mà bỏ qua khóa Admin cuối cùng và dòng audit.
   - Test: `test/guards/require-permission.guard.test.ts` "every Server Action and /api/admin route handler checks requirePermission first, except the public list", "every public action on the list still exists (a renamed one would leave a stale exception)" và "the admin plugin’s endpoints are called only from lib/server/auth/staff.ts and scripts/create-admin.mjs" (Task 7), "every staff-screen action asks for a permission the Editor lacks" (Task 9); các ca "what it catches" của cùng file, trong đó "a check that is not awaited, or runs only under a condition", "a try whose catch lets a failed check fall through, or that has a finally", "scans every directory of app code, and every route under app/api/admin for every method" và "an admin plugin endpoint outside the two allowed files, called or destructured" (Task 7); lần chạy đột biến ở Task 7 Bước 13 và Task 9 Bước 12. Tích hợp `better-auth.test.ts` "rejects HTTP calls to /api/auth/admin/* even from a signed-in Admin with a valid Origin" và "still serves server-side auth.api.* calls, with the caller’s permissions" (Task 2). E2E `admin-acceptance.spec.ts` "3. the Editor is kept out of the Admin area, including a direct POST to an Admin-only action" (phát lại `next-action` của `changeStaffRole` bằng cookie Editor → `forbidden`, 0 dòng ghi; không cookie → 307; cookie giả → `forbidden`) và "4. a browser call to /api/auth/admin/* is rejected, even for an Admin", với hai lần chạy đột biến cho thấy spec đỏ khi bỏ `requirePermission` hoặc bỏ cả hai lớp chặn (Task 11).

## Rủi ro đã biết

Mỗi mục mang một nhãn: **Đã chấp nhận** (hệ quả của một phán quyết, hoặc đã có biện pháp) hoặc **Cần quyết định** (người dùng chọn chấp nhận hay mở việc ở đợt sau). Kế hoạch không thêm task cho các mục này; Task 11 bước cuối báo lại danh sách.

1. **Cần quyết định sau preview đầu tiên.** Preview trên Vercel và `BETTER_AUTH_URL`: liên kết trong email và quyết định dùng tên cookie `__Secure-` lấy từ một origin cố định. Đăng nhập và đặt lại mật khẩu gán `origin` = origin của baseURL, nên kiểm tra origin của Better Auth qua trên mọi host, còn kiểm tra Origin-với-Host của Server Action (Next) vẫn chặn CSRF. Cookie gắn theo host, nên một preview chạy được nếu `BETTER_AUTH_URL` là URL của chính preview đó. Chưa thử `baseURL.allowedHosts`.
2. **Đã chấp nhận (biện pháp: `scripts/auth-cli.config.ts`, README).** CLI của Better Auth tự nạp `.env.local`: mọi lệnh `npx auth …` thiếu `--config` có thể đọc DB Neon dùng chung; `auth migrate` sẽ ghi vào đó. Có `--config` thì config chỉ nhận host cục bộ và xóa các biến `PG*` mà CLI đã chép từ `.env.local`, nên không gửi user/mật khẩu Neon cho server cục bộ.
3. **Cần quyết định.** Giới hạn số lần thử chỉ có trong router HTTP và chỉ khi `NODE_ENV=production`. IP lấy từ một giá trị `X-Forwarded-For`: Vercel ghi đè header này, nhưng `next start` trần giữ giá trị của client (`next/dist/server/base-server.js:612`), nên nếu tự host không có proxy thì giới hạn bị lách. IPv6 bị gộp theo /64. Không có giới hạn theo email.
4. **Đã chấp nhận (R5).** Trang admin luôn trả 200 trên production; giám sát hay test nhìn status sẽ bị lừa.
5. **Đã chấp nhận (quy tắc "DAL trước").** Build chạy thân trang admin tới API lúc request đầu tiên; một truy vấn đặt trước `verifySession()` sẽ chạy lúc build với `DATABASE_URL` của build.
6. **Cần quyết định.** `database.validateSchema` của Better Auth soi DB mỗi lần khởi động lạnh; nếu migration 005 và `config.ts` lệch nhau, request đăng nhập lỗi. Độ trễ của việc này trên Neon lúc khởi động lạnh chưa đo.
7. **Đã chấp nhận.** `<Activity>` giữ trang admin vừa rời ở trạng thái ẩn; nó có thể hiện dữ liệu cũ (ví dụ ô vai trò sau khi người khác vừa đổi). Server vẫn kiểm.
8. **Cần quyết định.** Token nằm trong URL (`/admin/accept-invite?token=`, `/admin/reset-password?token=`) nên có trong log request của Vercel. Giảm nhẹ: dùng một lần, hết hạn sau 7 ngày / 1 giờ, `Referrer-Policy: same-origin`.
9. **Cần quyết định (đợt 7, đợt sau B).** Web khách và admin cùng origin: cookie admin được gửi kèm trang khách, và CSP của web khách có `'unsafe-inline'`. Một XSS trên web khách có thể gọi Server Action admin bằng cookie của nhân viên. Quy tắc: nội dung khách luôn được React escape; đợt 7 không bao giờ render HTML từ CMS dạng thô. Cách sửa tận gốc: subdomain riêng cho admin.
10. **Đã chấp nhận.** `nextCookies()` không làm mới phiên trong RSC; chỉ Server Action và route handler gia hạn cookie. Nhân viên chỉ xem mà không thao tác sẽ phải đăng nhập lại tối đa sau 7 ngày.
11. **Cần quyết định trước khi bật `EMAIL_DELIVERY=live`.** Chế độ live chỉ được thử với server giả (`RESEND_BASE_URL`); DNS domain (spec §15 mục 4–5) chưa làm; email reset lỗi chỉ có trong log; kích thước bundle do react-email kéo vào chưa đo. `email_error` giữ nguyên câu của Resend (có thể chứa địa chỉ), chỉ Admin thấy.
12. **Đã chấp nhận.** Hành vi nhỏ của upstream: `admin.createUser` không kiểm độ dài tối thiểu của mật khẩu (zod và script kiểm); cảnh báo int8 của `auth generate` là thẩm mỹ; bên thua khi hai người cùng nhận một lời mời về lý thuyết có thể nhận `db_error` thay cho `already_staff`.
13. **Cần quyết định.** Chưa kiểm trên Neon: `FOR UPDATE` qua URL pooled, transaction Kysely của Better Auth qua PgBouncer. Chưa kiểm trên Node 24 (CI) cho Better Auth và react-email; mọi lần chạy dùng Node 22.
14. **Đã chấp nhận.** `app/global-error.tsx` làm trang admin preload stylesheet 45 KB của web khách (không áp dụng). Có thể cho nó stylesheet riêng sau.
15. **Cần quyết định (theo dõi).** Trong khoảng 20 lần chạy toàn bộ E2E, spec khách `e2e/page-scope.spec.ts` "a card opens the restaurant page under the curtain" đỏ một lần lúc máy bận (log tấm màn có thêm một `false` ở đầu); 105 lần chạy riêng liền sau đều xanh. Spec này của đợt 2, đợt 3 không đụng tới. CI có `retries: 1`.

---

## Sơ đồ file

| File | Trách nhiệm | Task |
|---|---|---|
| `package.json`, `package-lock.json` | Thư viện mới; `typecheck` = `next typegen && tsc --noEmit --incremental false` | 1, 3, 5, 7 |
| `lib/server/auth/permissions.ts` (+ test) | Ma trận quyền §7.1, `roleCan` | 1 |
| `db/migrations/005_staff_auth_audit.sql`, `test/integration/migration-005.test.ts` | Bảng nhân viên, giới hạn thử, lời mời, nhật ký, view `audit_feed` | 1 |
| `lib/server/auth/signup-gate.ts`, `lib/server/auth/config.ts` | Cấu hình Better Auth duy nhất; cổng "chỉ khi có lời mời"; chặn `/admin/*` qua HTTP | 2 |
| `scripts/auth-cli.config.ts` | CLI Better Auth chỉ chạy trên DB cục bộ | 2 |
| `test/helpers/auth.ts`, `test/integration/better-auth.test.ts` | Better Auth trong test; các chứng minh ngày đầu §16 | 2 |
| `lib/server/email/**` | Cổng `EMAIL_DELIVERY`, Resend, template mời và đặt lại mật khẩu | 3 |
| `lib/server/audit.ts` | `withTransaction`, `insertAudit` | 4 |
| `lib/server/auth/staff.ts`, `test/integration/staff-auth.test.ts` | Mời, gửi lại, thu hồi, nhận; đổi vai trò, khóa, mở khóa, xóa | 4 |
| `scripts/create-admin.mjs`, `test/integration/create-admin.test.ts` | Admin đầu tiên | 5 |
| `lib/admin/csp.ts`, `lib/admin/paths.ts`, `proxy.ts` (+ test) | Nonce CSP, header bảo vệ, cổng cookie, `?next=` an toàn | 6 |
| `app/admin/layout.tsx`, `not-found.tsx`, `[...missing]/page.tsx`, `(auth)/layout.tsx`, `styles/admin.css` | Root layout admin render lúc request; 404 tiếng Việt | 6, 9, 10 |
| `app/(site)/[lang]/layout.tsx`, `(guarded)/layout.tsx` | `lang()` có thể là `undefined` | 6 |
| `scripts/check-prerender.mjs`, `lib/admin/admin-pages.guard.test.ts` | Không trang admin nào có static shell | 6 |
| `e2e/admin-security.spec.ts`, `e2e/csp.ts` | Header, nonce, hydration không vi phạm | 6, 7, 8, 9 |
| `lib/server/auth/auth.ts`, `app/api/auth/[...all]/route.ts` | `getAuth()` lười, `staffDeps()`; route Better Auth | 7, 8 |
| `lib/server/auth/endpoint.ts` (+ test) | Gọi router Better Auth trong process; chép `Set-Cookie` | 7 |
| `lib/server/dal/session.ts`, `lib/server/action-result.ts` (+ test) | DAL; dạng kết quả của action | 7, 9 |
| `lib/admin/{zod,auth-errors,format,nav}.ts` (+ test) | zod tiếng Việt, câu báo lỗi, ngày giờ vi-VN, menu theo vai trò | 7, 8, 9, 10 |
| `app/admin/(auth)/sign-in/*`, `app/admin/(shell)/{layout,NavLinks,actions,page,error}.tsx` | Đăng nhập; khung admin; đăng xuất | 7, 9 |
| `test/guards/require-permission.guard.test.ts`, `test/guards/server-actions.ts` | Guard CI cho Server Action | 7, 8, 9 |
| `e2e/staff-fixtures.ts`, `e2e/admin-sign-in.spec.ts`, `playwright.config.ts`, `.github/workflows/ci.yml` | Tài khoản seed, IP riêng mỗi test, E2E đăng nhập, env bắt buộc | 7, 8, 9 |
| `app/admin/(auth)/accept-invite/*`, `app/admin/(auth)/reset-password/*` | Nhận lời mời; đặt lại mật khẩu | 8 |
| `e2e/email-log.ts`, `e2e/admin-invite-reset.spec.ts` | Đọc link từ log email; E2E hai luồng công khai | 8 |
| `lib/server/auth/staff-queries.ts`, `app/admin/(shell)/users/*`, `app/admin/(shell)/forbidden.tsx`, `next.config.ts` | Màn Nhân viên; trang 403 | 9 |
| `e2e/admin-users.spec.ts` | E2E màn Nhân viên | 9 |
| `lib/server/audit-feed.ts`, `lib/admin/audit-labels.ts`, `app/admin/(shell)/audit/page.tsx` (+ test) | Màn Nhật ký | 10 |
| `e2e/admin-acceptance.spec.ts`, `README.md` | Nghiệm thu §14.1 dòng 3; tài liệu | 5, 11 |


---

### Task 1: Thư viện, lệnh typecheck, ma trận quyền và migration 005

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `lib/server/auth/permissions.ts`, `lib/server/auth/permissions.test.ts`
- Create: `db/migrations/005_staff_auth_audit.sql`, `test/integration/migration-005.test.ts`

**Interfaces:**
- Consumes: `resetDatabase`, `migrate`, `withClient`, `databaseUrl`, `TEST_DATABASE_URL` từ `test/helpers/db.ts` (đã có).
- Produces:
  - `lib/server/auth/permissions.ts`: `statement` (const), `ac`, `admin`, `editor`, `roles`, `STAFF_ROLES = ['admin', 'editor'] as const`, `type StaffRole = 'admin' | 'editor'`, `isStaffRole(value: unknown): value is StaffRole`, `type Permissions = { [resource]?: action[] }`, `roleCan(role: string | null | undefined, permissions: Permissions): boolean`. File này không import `server-only` (CLI, script và menu dùng nó).
  - Bảng `staff_user(id, name, email, email_verified, image, created_at, updated_at, role, banned, ban_reason, ban_expires)`, `staff_session`, `staff_account`, `staff_verification`, `auth_rate_limit(id, key, count, last_request)`, `staff_invitation(id bigint identity, email, role, token_hash, expires_at, used_at, revoked_at, invited_by, email_error, created_at)`, `audit_log(id bigint identity, at, actor_id, actor_email, action, entity_type, entity_id, locale, before, after, ip inet)`, view `audit_feed(source, id, at, actor_id, actor_label, action, entity_type, entity_id, locale, before, after)`.
  - `npm run typecheck` = `next typegen && tsc --noEmit --incremental false`.

- [ ] **Bước 1: Cài thư viện và đổi lệnh typecheck**

```bash
npm i better-auth@1.7.7 zod@4.6.5
npm i -D auth@1.7.7
```

Expected: `found 0 vulnerabilities` cả hai lần. Rồi sửa dòng `typecheck` trong `package.json`. Sau cả hai việc, `git diff package.json` phải đúng như sau:

```diff
diff --git a/package.json b/package.json
index 711f00c..cf3bf59 100644
--- a/package.json
+++ b/package.json
@@ -7,7 +7,7 @@
     "build": "next build",
     "start": "next start",
     "lint": "oxlint",
-    "typecheck": "tsc --noEmit",
+    "typecheck": "next typegen && tsc --noEmit --incremental false",
     "test": "TZ=UTC vitest run",
     "test:watch": "TZ=UTC vitest",
     "test:e2e": "playwright test",
@@ -17,11 +17,13 @@
   },
   "dependencies": {
     "@vercel/functions": "^3.9.9",
+    "better-auth": "^1.7.7",
     "libphonenumber-js": "^1.13.14",
     "next": "^16.3.7",
     "pg": "^8.23.0",
     "react": "^19.3.0",
-    "react-dom": "^19.3.0"
+    "react-dom": "^19.3.0",
+    "zod": "^4.6.5"
   },
   "devDependencies": {
     "@playwright/test": "^1.63.0",
@@ -29,6 +31,7 @@
     "@types/pg": "^8.23.1",
     "@types/react": "^19.3.0",
     "@types/react-dom": "^19.3.0",
+    "auth": "^1.7.7",
     "dotenv-cli": "^11.0.0",
     "oxlint": "^1.86.0",
     "typescript": "^7.0.2",
```

Run: `npm run typecheck`
Expected: `✓ Types generated successfully`, rồi `tsc` không in gì và thoát 0.

- [ ] **Bước 2: Viết test cho ma trận quyền**

Create `lib/server/auth/permissions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { roleCan, statement, type Permissions } from './permissions';

// Spec §7.1 permission matrix, row by row.
const BOTH: Permissions[] = [
  { content: ['read', 'update', 'ai'] }, // content, files, translations; AI helpers
  { content: ['restore'] }, // history and restore (§7.5)
  { reservations: ['read', 'update', 'create', 'note'] },
  { schedule: ['read', 'update'] }, // service periods, capacity, closures
  { reservations: ['configure'] }, // per-restaurant booking switch and overrides
];
const ADMIN_ONLY: Permissions[] = [
  { reservations: ['auto-confirm'] },
  { locales: ['update'] },
  { settings: ['update'] },
  { user: ['create'] },
  { user: ['list'] },
  { user: ['set-role'] },
  { user: ['ban'] },
  { user: ['delete'] },
  { audit: ['read'] },
  { reservations: ['purge-test'] },
];

describe('roleCan', () => {
  it.each(BOTH)('Editor and Admin may %j', (p) => {
    expect(roleCan('editor', p)).toBe(true);
    expect(roleCan('admin', p)).toBe(true);
  });

  it.each(ADMIN_ONLY)('only Admin may %j', (p) => {
    expect(roleCan('editor', p)).toBe(false);
    expect(roleCan('admin', p)).toBe(true);
  });

  it('grants impersonation and email changes to no role', () => {
    for (const role of ['admin', 'editor']) {
      expect(roleCan(role, { user: ['impersonate'] })).toBe(false);
      expect(roleCan(role, { user: ['impersonate-admins'] })).toBe(false);
      expect(roleCan(role, { user: ['set-email'] })).toBe(false);
    }
  });

  it('gives the Editor nothing on user, session, audit, settings or locales', () => {
    for (const action of statement.user) expect(roleCan('editor', { user: [action] })).toBe(false);
    for (const action of statement.session) expect(roleCan('editor', { session: [action] })).toBe(false);
    for (const action of statement.settings) expect(roleCan('editor', { settings: [action] })).toBe(false);
    for (const action of statement.locales) expect(roleCan('editor', { locales: [action] })).toBe(false);
    expect(roleCan('editor', { audit: ['read'] })).toBe(false);
  });

  it('denies unknown, empty and missing roles', () => {
    expect(roleCan('user', { content: ['read'] })).toBe(false);
    expect(roleCan('', { content: ['read'] })).toBe(false);
    expect(roleCan(null, { content: ['read'] })).toBe(false);
    expect(roleCan(undefined, { content: ['read'] })).toBe(false);
  });

  it('needs every requested action', () => {
    expect(roleCan('editor', { content: ['read'], settings: ['read'] })).toBe(false);
  });
});
```

- [ ] **Bước 3: Chạy test, phải đỏ**

Run: `npx vitest run lib/server/auth/permissions.test.ts`
Expected: FAIL

```
 FAIL  lib/server/auth/permissions.test.ts [ lib/server/auth/permissions.test.ts ]
Error: Cannot find module './permissions' imported from …/lib/server/auth/permissions.test.ts
```

- [ ] **Bước 4: Viết ma trận quyền**

Create `lib/server/auth/permissions.ts` (`schedule` thay cho `closures` của spike: nhóm này gồm giờ phục vụ, sức chứa và ngày đóng cửa):

```ts
import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements } from 'better-auth/plugins/admin/access';

/*
 * The permission matrix of spec §7.1. `user` and `session` are the admin
 * plugin's own resources (its auth.api.* endpoints check them); the rest are
 * ours. defaultStatements also lists user:impersonate, impersonate-admins and
 * set-email, which no role gets (spec §7.1).
 *
 * No server-only import: the schema CLI (scripts/auth-cli.config.ts), the
 * bootstrap script and the admin nav load this file too.
 */
export const statement = {
  ...defaultStatements,
  /** Content, files and translations; `ai` = use the AI helpers; `restore` = history (§7.5). */
  content: ['read', 'update', 'restore', 'ai'],
  /** Handle, create and annotate bookings; `configure` = per-restaurant booking switch and overrides. */
  reservations: ['read', 'update', 'create', 'note', 'configure', 'auto-confirm', 'purge-test'],
  /** Service periods, capacity and closures. */
  schedule: ['read', 'update'],
  locales: ['read', 'update'],
  /** Booking, notification and AI settings. */
  settings: ['read', 'update'],
  /** The site-wide audit log (/admin/audit). Per-record history is content:read. */
  audit: ['read'],
} as const;

export const ac = createAccessControl(statement);

const editorStatements = {
  content: ['read', 'update', 'restore', 'ai'],
  reservations: ['read', 'update', 'create', 'note', 'configure'],
  schedule: ['read', 'update'],
} as const;

export const editor = ac.newRole(editorStatements);

export const admin = ac.newRole({
  ...editorStatements,
  reservations: [...editorStatements.reservations, 'auto-confirm', 'purge-test'],
  locales: ['read', 'update'],
  settings: ['read', 'update'],
  audit: ['read'],
  user: ['create', 'list', 'get', 'update', 'set-role', 'ban', 'delete', 'set-password'],
  session: ['list', 'revoke', 'delete'],
});

export const roles = { admin, editor };

export const STAFF_ROLES = ['admin', 'editor'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(value: unknown): value is StaffRole {
  return value === 'admin' || value === 'editor';
}

type Statement = typeof statement;
/** e.g. `{ user: ['set-role'] }`, the shape auth.api.userHasPermission takes. */
export type Permissions = { [K in keyof Statement]?: Statement[K][number][] };

/**
 * The admin plugin's rule (comma-separated roles; a role that grants every
 * requested action wins) without a database call.
 */
export function roleCan(role: string | null | undefined, permissions: Permissions): boolean {
  if (!role) return false;
  return role.split(',').some((r) => {
    const grant = isStaffRole(r) ? roles[r] : undefined;
    return grant?.authorize(permissions).success === true;
  });
}
```

- [ ] **Bước 5: Chạy lại test**

Run: `npx vitest run lib/server/auth/permissions.test.ts`
Expected: PASS `Tests  19 passed (19)`

- [ ] **Bước 6: Viết test cho migration 005**

Test dùng DB riêng `furama_cuisine_migrate005_test`, như test của 003 và 004.

Create `test/integration/migration-005.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, databaseUrl, migrate, resetDatabase, withClient } from '../helpers/db';

const url = databaseUrl('furama_cuisine_migrate005_test');
const sql = (text: string, values: unknown[] = []) => withClient(url, (c) => c.query(text, values));

const HASH = 'a'.repeat(64);
const invite = (email: string, hash = HASH, extra = '') =>
  sql(
    `INSERT INTO staff_invitation (email, role, token_hash, expires_at${extra ? ', used_at, revoked_at' : ''})
     VALUES ($1, 'editor', $2, now() + interval '7 days'${extra})`,
    [email, hash],
  );

describe.skipIf(!TEST_DATABASE_URL)('migration 005: staff sign-in and the audit trail (database)', () => {
  beforeAll(() => resetDatabase(url));

  it('creates the seven tables and the audit_feed view', async () => {
    const { rows } = await sql(
      `SELECT table_name, table_type FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('staff_user', 'staff_session', 'staff_account', 'staff_verification',
                             'auth_rate_limit', 'staff_invitation', 'audit_log', 'audit_feed')
        ORDER BY table_name`,
    );
    expect(rows).toEqual([
      { table_name: 'audit_feed', table_type: 'VIEW' },
      { table_name: 'audit_log', table_type: 'BASE TABLE' },
      { table_name: 'auth_rate_limit', table_type: 'BASE TABLE' },
      { table_name: 'staff_account', table_type: 'BASE TABLE' },
      { table_name: 'staff_invitation', table_type: 'BASE TABLE' },
      { table_name: 'staff_session', table_type: 'BASE TABLE' },
      { table_name: 'staff_user', table_type: 'BASE TABLE' },
      { table_name: 'staff_verification', table_type: 'BASE TABLE' },
    ]);
  });

  it('allows only the admin and editor roles', async () => {
    await sql(
      `INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ('u1', 'A', 'a@furama.test', true, 'admin')`,
    );
    await expect(
      sql(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ('u2', 'O', 'o@furama.test', true, 'owner')`),
    ).rejects.toThrow(/staff_user_role_check/);
  });

  it('checks invitation emails, token hashes and closing', async () => {
    await expect(invite('Upper@furama.test')).rejects.toThrow(/staff_invitation_email_check/);
    await expect(invite('x@furama.test', 'not-a-hash')).rejects.toThrow(/staff_invitation_token_hash_check/);
    await expect(invite('y@furama.test', 'b'.repeat(64), ', now(), now()')).rejects.toThrow(/staff_invitation_closed_once/);
  });

  it('holds one open invitation per email; a revoked one frees the email', async () => {
    await invite('ed@furama.test', 'c'.repeat(64));
    await expect(invite('ed@furama.test', 'd'.repeat(64))).rejects.toThrow(/staff_invitation_open_email_idx/);
    await sql(`UPDATE staff_invitation SET revoked_at = now() WHERE email = 'ed@furama.test'`);
    await invite('ed@furama.test', 'd'.repeat(64));
    expect((await sql(`SELECT count(*)::int AS n FROM staff_invitation WHERE email = 'ed@furama.test'`)).rows[0].n).toBe(2);
  });

  it('accepts staff.* and the content actions in audit_log, nothing else', async () => {
    const insert = (action: string) =>
      sql(`INSERT INTO audit_log (action, entity_type, entity_id) VALUES ($1, 'staff_user', 'u1')`, [action]);
    await insert('staff.role');
    await insert('update');
    await expect(insert('login')).rejects.toThrow(/audit_log_action_check/);
    await expect(insert('staff.')).rejects.toThrow(/audit_log_action_check/);
    await expect(
      sql(`INSERT INTO audit_log (action, entity_type) VALUES ('update', '')`),
    ).rejects.toThrow(/audit_log_entity_type_check/);
  });

  it('exposes audit_log through audit_feed with the columns phase 4 will keep', async () => {
    const { rows } = await sql(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'audit_feed' ORDER BY ordinal_position`,
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      'source',
      'id',
      'at',
      'actor_id',
      'actor_label',
      'action',
      'entity_type',
      'entity_id',
      'locale',
      'before',
      'after',
    ]);
    const feed = await sql(`SELECT source, action FROM audit_feed WHERE action = 'staff.role'`);
    expect(feed.rows).toEqual([{ source: 'audit', action: 'staff.role' }]);
  });

  it('is safe to apply again', async () => {
    await sql(readFileSync('db/migrations/005_staff_auth_audit.sql', 'utf8'));
    expect((await sql('SELECT count(*)::int AS n FROM staff_user')).rows[0].n).toBe(1);
    expect((await sql('SELECT count(*)::int AS n FROM audit_log')).rows[0].n).toBe(2);
  });

  it('applies on top of a database that already has bookings and content', async () => {
    resetDatabase(url, '004_foundations_locales_strings_destinations.sql');
    await sql(
      `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164)
       VALUES ('FC-99998', 'taya-house', '2026-10-05', '19:00', 2, 'Guest', '0905 000 000', '+84905000000')`,
    );
    migrate(url);
    expect((await sql(`SELECT count(*)::int AS n FROM reservations WHERE reference = 'FC-99998'`)).rows[0].n).toBe(1);
    expect((await sql('SELECT count(*)::int AS n FROM staff_user')).rows[0].n).toBe(0);
  });
});
```

- [ ] **Bước 7: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/migration-005.test.ts`
Expected: FAIL `Tests  8 failed (8)`, mở đầu bằng:

```
     × creates the seven tables and the audit_feed view
     × allows only the admin and editor roles
     …
AssertionError: expected [] to deeply equal [ …(8) ]
error: relation "staff_user" does not exist
AssertionError: expected [Function] to throw error matching /staff_invitation_email_check/ but got 'relation "staff_invitation" does not …'
```

- [ ] **Bước 8: Viết migration 005**

Năm bảng Better Auth là output của `npx auth generate --config scripts/auth-cli.config.ts` (Task 2) trên một DB rỗng, sau khi đã khai `modelName`/`fields` và plugin admin, chỉ thêm `IF NOT EXISTS` và một CHECK cho `role`. Better Auth kiểm hình dạng này lúc khởi động (`database.validateSchema`), nên muốn đổi cột thì đổi `config.ts` rồi sinh lại, không sửa tay.

Create `db/migrations/005_staff_auth_audit.sql`:

```sql
-- Phase 3: staff sign-in and the audit trail (spec §5.2 "Nhân viên, quản trị", §7.1).
--
-- The five Better Auth tables are the output of
--   AUTH_CLI_DATABASE_URL=postgres://localhost:5432/<empty>_test \
--     npx auth generate --config scripts/auth-cli.config.ts --output <file>
-- (better-auth 1.7.7, after modelName/fields and the admin plugin were set in
-- lib/server/auth/config.ts), with IF NOT EXISTS added and one CHECK on role.
-- Better Auth validates this shape at start-up (database.validateSchema), so
-- change config.ts and regenerate rather than editing the columns here.

-- ── Better Auth ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_user (
  id             text        NOT NULL PRIMARY KEY,
  name           text        NOT NULL,
  email          text        NOT NULL UNIQUE,
  email_verified boolean     NOT NULL,
  image          text,
  created_at     timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- admin plugin
  role           text        CONSTRAINT staff_user_role_check CHECK (role IN ('admin', 'editor')),
  banned         boolean,
  ban_reason     text,
  ban_expires    timestamptz
);

CREATE TABLE IF NOT EXISTS staff_session (
  id              text        NOT NULL PRIMARY KEY,
  expires_at      timestamptz NOT NULL,
  token           text        NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      timestamptz NOT NULL,
  ip_address      text,
  user_agent      text,
  user_id         text        NOT NULL REFERENCES staff_user (id) ON DELETE CASCADE,
  -- admin plugin; stays NULL: no role may impersonate (spec §7.1)
  impersonated_by text
);

CREATE TABLE IF NOT EXISTS staff_account (
  id                       text        NOT NULL PRIMARY KEY,
  account_id               text        NOT NULL,
  provider_id              text        NOT NULL,
  user_id                  text        NOT NULL REFERENCES staff_user (id) ON DELETE CASCADE,
  access_token             text,
  refresh_token            text,
  id_token                 text,
  access_token_expires_at  timestamptz,
  refresh_token_expires_at timestamptz,
  scope                    text,
  password                 text,
  created_at               timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_verification (
  id         text        NOT NULL PRIMARY KEY,
  identifier text        NOT NULL,
  value      text        NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- rateLimit.storage = 'database': one row per "<ip>|<path>" key.
CREATE TABLE IF NOT EXISTS auth_rate_limit (
  id           text    NOT NULL PRIMARY KEY,
  key          text    NOT NULL UNIQUE,
  count        integer NOT NULL,
  last_request bigint  NOT NULL  -- epoch milliseconds
);

CREATE INDEX IF NOT EXISTS staff_session_user_id_idx ON staff_session (user_id);
CREATE INDEX IF NOT EXISTS staff_account_user_id_idx ON staff_account (user_id);
CREATE INDEX IF NOT EXISTS staff_verification_identifier_idx ON staff_verification (identifier);

-- ── staff_invitation ──────────────────────────────────────────────────────
-- App-owned invitations. Only the SHA-256 of the token is stored. "Gửi lại"
-- (resend) replaces token_hash and expires_at in place, so the old link dies.
CREATE TABLE IF NOT EXISTS staff_invitation (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       text        NOT NULL CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+$'),
  role        text        NOT NULL CHECK (role IN ('admin', 'editor')),
  token_hash  text        NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  revoked_at  timestamptz,
  invited_by  text,       -- staff_user.id; no FK, the history outlives the inviter (spec §5.1.6)
  email_error text,       -- last delivery failure; NULL once a send succeeds
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_invitation_closed_once CHECK (used_at IS NULL OR revoked_at IS NULL)
);

-- One open invitation per email. "Open" here ignores expiry (now() cannot sit
-- in an index predicate); createInvitation revokes an expired one first.
CREATE UNIQUE INDEX IF NOT EXISTS staff_invitation_open_email_idx
  ON staff_invitation (email) WHERE used_at IS NULL AND revoked_at IS NULL;

-- ── audit_log ─────────────────────────────────────────────────────────────
-- Written in the same transaction as the change it records (spec §7.4).
-- actor_* are snapshots without FKs, so the log survives a staff removal.
CREATE TABLE IF NOT EXISTS audit_log (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_id    text,
  actor_email text,
  action      text        NOT NULL
              CHECK (action ~ '^(create|update|delete|reorder|restore|settings|staff\.[a-z_]+)$'),
  entity_type text        NOT NULL CHECK (entity_type <> ''),
  entity_id   text,
  locale      text,
  before      jsonb,
  after       jsonb,
  ip          inet
);

CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity_type, entity_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_at_idx ON audit_log (at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor_id, at DESC);

-- ── audit_feed ────────────────────────────────────────────────────────────
-- The /admin/audit timeline. Phase 4 replaces this (CREATE OR REPLACE VIEW,
-- same columns in the same order) with a UNION ALL over reservation_events.
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
  FROM audit_log a;
```

- [ ] **Bước 9: Chạy lại test**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/migration-005.test.ts`
Expected: PASS `Tests  8 passed (8)`

- [ ] **Bước 10: Chạy cổng kiểm tra**

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

Expected:
- typecheck không có lỗi; lint thoát 0, 18 cảnh báo (như trước đợt 3);
- `Test Files  22 passed (22)`, `Tests  201 passed (201)`;
- `reset-db` in `Applied 5 migration(s).`;
- build thoát 0, bảng route không đổi (`○ /en`, `○ /en/restaurants/taya-house`);
- check-prerender in `Prerender check passed …` và `Font check passed …`;
- E2E `33 passed`; visual `8 passed`.

- [ ] **Bước 11: Commit**

```bash
git add package.json package-lock.json lib/server/auth/permissions.ts lib/server/auth/permissions.test.ts db/migrations/005_staff_auth_audit.sql test/integration/migration-005.test.ts
git commit -m "$(cat <<'EOF'
feat: add the staff permission matrix and migration 005 for sign-in and audit

Better Auth 1.7.7 and zod 4.6.5 join the dependencies, and the Better Auth
CLI (auth 1.7.7) the dev tools. lib/server/auth/permissions.ts is spec §7.1
as an access-control statement: the Editor gets content, bookings and the
schedule; the Admin also gets locales, settings, the audit log and the admin
plugin's user and session resources. No role may impersonate.

Migration 005 holds the four staff_* tables and auth_rate_limit as the CLI
generates them (snake_case through `fields`), plus the app-owned
staff_invitation (token hash only, one open invitation per email), audit_log
and the audit_feed view phase 4 will widen.

typecheck now runs `next typegen` first, because a second root layout
changes the generated next/root-params types and plain tsc never sees that,
and runs tsc without its incremental cache: TypeScript 7 keeps reporting the
old result after next typegen rewrites .next/types/root-params.d.ts.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 2: Cấu hình Better Auth và các chứng minh ngày đầu (chưa nối vào Next)

Ngày đầu của đợt 3 phải trả lời câu hỏi ở spec §16: `hooks.before` có chặn được `/api/auth/admin/*` từ trình duyệt mà server vẫn gọi được `auth.api.*` không. Task này trả lời bằng test tích hợp, trước khi có giao diện nào.

**Files:**
- Create: `lib/server/auth/signup-gate.ts`, `lib/server/auth/config.ts`
- Create: `scripts/auth-cli.config.ts`
- Create: `test/helpers/auth.ts`, `test/integration/better-auth.test.ts`

**Interfaces:**
- Consumes: `ac`, `roles`, `StaffRole` (Task 1); bảng của migration 005.
- Produces:
  - `lib/server/auth/signup-gate.ts`: `type Queryable`, `normalizeEmail(email: string): string`, `decideSignup(db: Queryable, email: string, bootstrapAdminEmail: string | undefined): Promise<{ ok: true; role: StaffRole; via: 'invitation' | 'bootstrap' } | { ok: false }>`.
  - `lib/server/auth/config.ts`: `ADMIN_ENDPOINT_BLOCKED = 'ADMIN_ENDPOINT_BLOCKED'`, `INVITATION_REQUIRED = 'INVITATION_REQUIRED'`, `type ResetEmail = { user: { email: string; name: string }; token: string }`, `type AuthDeps = { pool: Pool; secret: string | undefined; baseURL: string | undefined; bootstrapAdminEmail: string | undefined; sendResetPassword: (email: ResetEmail) => Promise<unknown>; rateLimitEnabled?: boolean; backgroundTask?: (task: Promise<unknown>) => void }`, `createAuth(deps: AuthDeps)`, `type Auth = ReturnType<typeof createAuth>`. Không import `server-only`.
  - `test/helpers/auth.ts`: `TEST_SECRET`, `TEST_BASE_URL`, `BOOTSTRAP_EMAIL = 'owner@furama.test'`, `PASSWORD = 'correct horse battery'`, `STAFF_TABLES`, `type SentReset`, `createTestAuth(pool, overrides?)`, `post(auth, path, body, headers?)`, `signInCookie(auth, email, password?, ip?)`, `createBootstrapAdmin(auth, email?)`, `inviteBySql(pool, email, role)` (trả token thô), `createStaffUser(auth, pool, email, role)`, `errorCode(promise)`.
  - `scripts/auth-cli.config.ts`: export `auth` cho CLI, chỉ trên `AUTH_CLI_DATABASE_URL` cục bộ, sau khi xóa mọi biến `PG*` của tiến trình.

- [ ] **Bước 1: Viết helper test và test tích hợp**

Create `test/helpers/auth.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { expect } from 'vitest';
import { createAuth, type Auth, type AuthDeps } from '@/lib/server/auth/config';
import type { StaffRole } from '@/lib/server/auth/permissions';

/*
 * Better Auth for integration tests: the app's own config (lib/server/auth/
 * config.ts) on the integration database, with fixed values instead of env.
 * Reset emails land in `sent` instead of going anywhere. Background work runs
 * unawaited, as after() runs it in the app.
 */

export const TEST_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
export const TEST_BASE_URL = 'http://localhost:3000';
export const BOOTSTRAP_EMAIL = 'owner@furama.test';
export const PASSWORD = 'correct horse battery';

/** Every staff table; session and account rows go with staff_user (CASCADE). */
export const STAFF_TABLES = 'staff_user, staff_invitation, audit_log, auth_rate_limit, staff_verification';

export type SentReset = { email: string; name: string; token: string };

export function createTestAuth(pool: Pool, overrides: Partial<AuthDeps> & { sent?: SentReset[] } = {}): Auth {
  const { sent, ...rest } = overrides;
  return createAuth({
    pool,
    secret: TEST_SECRET,
    baseURL: TEST_BASE_URL,
    bootstrapAdminEmail: BOOTSTRAP_EMAIL,
    sendResetPassword: async ({ user, token }) => {
      sent?.push({ email: user.email, name: user.name, token });
    },
    backgroundTask: (task) => {
      void task;
    },
    ...rest,
  });
}

/** A JSON POST to one of Better Auth's HTTP endpoints, the way a browser (or our Server Actions) reaches it. */
export function post(auth: Auth, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return auth.handler(
    new Request(`${TEST_BASE_URL}/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: TEST_BASE_URL, ...headers },
      body: JSON.stringify(body),
    }),
  );
}

/** Signs in over HTTP and returns the Cookie header for later calls. */
export async function signInCookie(auth: Auth, email: string, password = PASSWORD, ip = '198.51.100.1'): Promise<string> {
  const res = await post(auth, '/sign-in/email', { email, password }, { 'x-forwarded-for': ip });
  expect(res.status).toBe(200);
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

/** The first Admin, through the BOOTSTRAP_ADMIN_EMAIL exception (no Admin may exist yet). */
export async function createBootstrapAdmin(auth: Auth, email = BOOTSTRAP_EMAIL): Promise<{ id: string; email: string }> {
  const { user } = await auth.api.createUser({ body: { email, password: PASSWORD, name: 'Owner', role: 'admin' } });
  return { id: user.id, email: user.email };
}

/** An open invitation written straight into the table; returns the raw token. */
export async function inviteBySql(pool: Pool, email: string, role: StaffRole): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO staff_invitation (email, role, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '7 days')`,
    [email, role, createHash('sha256').update(token).digest('hex')],
  );
  return token;
}

/** A staff member created the way an accepted invitation creates one (the gate reads the invitation). */
export async function createStaffUser(auth: Auth, pool: Pool, email: string, role: StaffRole): Promise<{ id: string; email: string }> {
  await inviteBySql(pool, email, role);
  const { user } = await auth.api.createUser({ body: { email, password: PASSWORD, name: email } });
  await pool.query('UPDATE staff_invitation SET used_at = now() WHERE email = $1 AND used_at IS NULL', [email]);
  return { id: user.id, email: user.email };
}

/** The Better Auth error code of a rejected auth.api.* call, or undefined when it succeeded. */
export async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (err) {
    const body = (err as { body?: { code?: string } }).body;
    if (body?.code) return body.code;
    throw err;
  }
  return undefined;
}
```

Create `test/integration/better-auth.test.ts`:

```ts
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_ENDPOINT_BLOCKED, INVITATION_REQUIRED, type Auth } from '@/lib/server/auth/config';
import { TEST_DATABASE_URL } from '../helpers/db';
import {
  BOOTSTRAP_EMAIL,
  PASSWORD,
  STAFF_TABLES,
  TEST_BASE_URL,
  createBootstrapAdmin,
  createStaffUser,
  createTestAuth,
  errorCode,
  inviteBySql,
  post,
  signInCookie,
  type SentReset,
} from '../helpers/auth';

/*
 * The day-1 proofs of spec §16, on the real schema (migration 005), through
 * both doors: the HTTP router (auth.handler, what /api/auth/[...all] calls)
 * and the server-side auth.api.* calls the app makes.
 */

let pool: Pool;
let auth: Auth;
let sent: SentReset[];

const rows = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) =>
  (await pool.query<T>(text, values)).rows;

describe.skipIf(!TEST_DATABASE_URL)('Better Auth on migration 005', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 8 });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE ${STAFF_TABLES} CASCADE`);
    sent = [];
    auth = createTestAuth(pool, { sent });
  });

  describe('who may get an account', () => {
    it('keeps HTTP sign-up closed', async () => {
      const res = await post(auth, '/sign-up/email', { email: 'x@furama.test', password: PASSWORD, name: 'X' });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe('EMAIL_PASSWORD_SIGN_UP_DISABLED');
    });

    it('refuses createUser for an email without an invitation', async () => {
      expect(await errorCode(auth.api.createUser({ body: { email: 'stranger@furama.test', password: PASSWORD, name: 'S' } }))).toBe(
        INVITATION_REQUIRED,
      );
      expect(await rows('SELECT 1 FROM staff_user')).toHaveLength(0);
    });

    it('lets BOOTSTRAP_ADMIN_EMAIL in as Admin only while no Admin exists', async () => {
      const owner = await createBootstrapAdmin(auth);
      expect(await rows('SELECT role FROM staff_user WHERE id = $1', [owner.id])).toEqual([{ role: 'admin' }]);
      auth = createTestAuth(pool, { bootstrapAdminEmail: 'second@furama.test' });
      expect(await errorCode(createBootstrapAdmin(auth, 'second@furama.test'))).toBe(INVITATION_REQUIRED);
    });

    it('takes the role from the invitation, not from the caller', async () => {
      await createBootstrapAdmin(auth);
      await inviteBySql(pool, 'ed@furama.test', 'editor');
      const { user } = await auth.api.createUser({
        body: { email: 'ed@furama.test', password: PASSWORD, name: 'Ed', role: 'admin' },
      });
      expect(await rows('SELECT role FROM staff_user WHERE id = $1', [user.id])).toEqual([{ role: 'editor' }]);
    });

    it('ignores used, revoked and expired invitations', async () => {
      await inviteBySql(pool, 'used@furama.test', 'editor');
      await inviteBySql(pool, 'revoked@furama.test', 'editor');
      await inviteBySql(pool, 'expired@furama.test', 'editor');
      await pool.query(`UPDATE staff_invitation SET used_at = now() WHERE email = 'used@furama.test'`);
      await pool.query(`UPDATE staff_invitation SET revoked_at = now() WHERE email = 'revoked@furama.test'`);
      await pool.query(`UPDATE staff_invitation SET expires_at = now() - interval '1 second' WHERE email = 'expired@furama.test'`);
      for (const email of ['used@furama.test', 'revoked@furama.test', 'expired@furama.test']) {
        expect(await errorCode(auth.api.createUser({ body: { email, password: PASSWORD, name: 'X' } }))).toBe(INVITATION_REQUIRED);
      }
    });
  });

  describe('the admin plugin endpoints (spec §7.1, §16)', () => {
    it('rejects HTTP calls to /api/auth/admin/* even from a signed-in Admin with a valid Origin', async () => {
      const owner = await createBootstrapAdmin(auth);
      const cookie = await signInCookie(auth, owner.email);
      const setRole = await post(auth, '/admin/set-role', { userId: owner.id, role: 'editor' }, { cookie });
      expect(setRole.status).toBe(403);
      expect(((await setRole.json()) as { code: string }).code).toBe(ADMIN_ENDPOINT_BLOCKED);
      const list = await auth.handler(new Request(`${TEST_BASE_URL}/api/auth/admin/list-users`, { headers: { cookie } }));
      expect(list.status).toBe(403);
      const create = await post(auth, '/admin/create-user', { email: 'n@furama.test', password: PASSWORD, name: 'N' }, { cookie });
      expect(create.status).toBe(403);
      expect(await rows('SELECT email, role FROM staff_user')).toEqual([{ email: owner.email, role: 'admin' }]);
    });

    it('still serves server-side auth.api.* calls, with the caller’s permissions', async () => {
      const owner = await createBootstrapAdmin(auth);
      const editor = await createStaffUser(auth, pool, 'ed@furama.test', 'editor');
      const adminHeaders = new Headers({ cookie: await signInCookie(auth, owner.email) });
      const editorHeaders = new Headers({ cookie: await signInCookie(auth, editor.email) });

      const listed = await auth.api.listUsers({ headers: adminHeaders, query: {} });
      expect(listed.users.map((u) => u.email).sort()).toEqual(['ed@furama.test', BOOTSTRAP_EMAIL]);
      await auth.api.setRole({ headers: adminHeaders, body: { userId: editor.id, role: 'admin' } });
      expect(await rows('SELECT role FROM staff_user WHERE id = $1', [editor.id])).toEqual([{ role: 'admin' }]);
      await auth.api.setRole({ headers: adminHeaders, body: { userId: editor.id, role: 'editor' } });

      expect(await errorCode(auth.api.setRole({ headers: editorHeaders, body: { userId: owner.id, role: 'editor' } }))).toBe(
        'YOU_ARE_NOT_ALLOWED_TO_CHANGE_USERS_ROLE',
      );
      expect(await errorCode(auth.api.listUsers({ headers: editorHeaders, query: {} }))).toBe('YOU_ARE_NOT_ALLOWED_TO_LIST_USERS');
    });

    it('grants impersonation to no role', async () => {
      const owner = await createBootstrapAdmin(auth);
      const editor = await createStaffUser(auth, pool, 'ed@furama.test', 'editor');
      const adminHeaders = new Headers({ cookie: await signInCookie(auth, owner.email) });
      expect(await errorCode(auth.api.impersonateUser({ headers: adminHeaders, body: { userId: editor.id } }))).toBe(
        'YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS',
      );
    });

    it('auth.api.setRole commits outside our transaction (why role changes use our own SQL)', async () => {
      const owner = await createBootstrapAdmin(auth);
      const editor = await createStaffUser(auth, pool, 'ed@furama.test', 'editor');
      const adminHeaders = new Headers({ cookie: await signInCookie(auth, owner.email) });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT 1');
        await auth.api.setRole({ headers: adminHeaders, body: { userId: editor.id, role: 'admin' } });
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
      // Our ROLLBACK did not undo it, so an audit row in our transaction could never be atomic with it.
      expect(await rows('SELECT role FROM staff_user WHERE id = $1', [editor.id])).toEqual([{ role: 'admin' }]);
    });
  });

  describe('sessions', () => {
    it('the next session read sees a changed role (no cookie cache)', async () => {
      await createBootstrapAdmin(auth);
      const editor = await createStaffUser(auth, pool, 'ed@furama.test', 'editor');
      const headers = new Headers({ cookie: await signInCookie(auth, editor.email) });
      expect((await auth.api.getSession({ headers }))?.user.role).toBe('editor');
      await pool.query(`UPDATE staff_user SET role = 'admin' WHERE id = $1`, [editor.id]);
      expect((await auth.api.getSession({ headers }))?.user.role).toBe('admin');
    });

    it('a session lasts 7 days and the cookie is HttpOnly, SameSite=Lax', async () => {
      const owner = await createBootstrapAdmin(auth);
      const res = await post(auth, '/sign-in/email', { email: owner.email, password: PASSWORD });
      const cookie = res.headers.getSetCookie().find((c) => c.startsWith('better-auth.session_token='));
      expect(cookie).toMatch(/Max-Age=604800/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Lax/);
      expect(res.headers.getSetCookie().some((c) => c.startsWith('better-auth.session_data='))).toBe(false);
    });
  });

  describe('rate limit and password reset', () => {
    it('stores the sign-in rate limit in auth_rate_limit (HTTP only; auth.api.* is never limited)', async () => {
      const owner = await createBootstrapAdmin(auth);
      auth = createTestAuth(pool, { rateLimitEnabled: true });
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        const res = await post(auth, '/sign-in/email', { email: owner.email, password: 'wrong password!!' }, { 'x-forwarded-for': '198.51.100.7' });
        statuses.push(res.status);
      }
      expect(statuses).toEqual([401, 401, 401, 429]);
      expect(await rows('SELECT key, count FROM auth_rate_limit')).toEqual([{ key: '198.51.100.7|/sign-in/email', count: 3 }]);
      for (let i = 0; i < 4; i++) {
        expect(await errorCode(auth.api.signInEmail({ body: { email: owner.email, password: 'wrong password!!' } }))).toBe(
          'INVALID_EMAIL_OR_PASSWORD',
        );
      }
    });

    it('reset: request → token → new password; old sessions are revoked', async () => {
      const owner = await createBootstrapAdmin(auth);
      const oldSession = new Headers({ cookie: await signInCookie(auth, owner.email) });
      expect((await post(auth, '/request-password-reset', { email: owner.email })).status).toBe(200);
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      expect(sent[0]).toMatchObject({ email: owner.email, name: 'Owner' });
      // Stored as SHA-256 only (storeIdentifier: 'hashed'), like invitation tokens.
      expect(JSON.stringify(await rows('SELECT identifier FROM staff_verification'))).not.toContain(sent[0].token);

      const reset = await post(auth, '/reset-password', { token: sent[0].token, newPassword: 'a brand new passphrase' });
      expect(reset.status).toBe(200);
      expect(await auth.api.getSession({ headers: oldSession })).toBeNull();
      expect(await signInCookie(auth, owner.email, 'a brand new passphrase')).toMatch(/session_token=/);
      expect(await errorCode(auth.api.signInEmail({ body: { email: owner.email, password: PASSWORD } }))).toBe(
        'INVALID_EMAIL_OR_PASSWORD',
      );
    });

    it('answers before the reset email is sent, so a staff address is no slower than an unknown one', async () => {
      const owner = await createBootstrapAdmin(auth);
      let started = false;
      auth = createTestAuth(pool, {
        sendResetPassword: () => {
          started = true;
          return new Promise(() => {}); // a Resend call that never returns
        },
      });
      const answer = await Promise.race([
        post(auth, '/request-password-reset', { email: owner.email }).then((res) => res.status),
        new Promise((resolve) => setTimeout(() => resolve('still waiting for the email'), 500)),
      ]);
      expect(answer).toBe(200);
      expect(started).toBe(true);
    });

    it('an unknown email gets the same 200 and no email', async () => {
      await createBootstrapAdmin(auth);
      const res = await post(auth, '/request-password-reset', { email: 'nobody@furama.test' });
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 100));
      expect(sent).toHaveLength(0);
    });

    it('a failing reset sender is logged by its code only; the answer stays 200', async () => {
      const owner = await createBootstrapAdmin(auth);
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      auth = createTestAuth(pool, {
        sendResetPassword: async () => {
          throw Object.assign(new Error('Resend rejected the email: secret details'), { code: 'provider_error' });
        },
      });
      try {
        expect((await post(auth, '/request-password-reset', { email: owner.email })).status).toBe(200);
        await vi.waitFor(() => expect(logged).toHaveBeenCalledWith('[auth] reset email failed', { code: 'provider_error' }));
        expect(JSON.stringify(logged.mock.calls)).not.toContain('secret details');
      } finally {
        logged.mockRestore();
      }
    });
  });
});
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/better-auth.test.ts`
Expected: FAIL

```
 FAIL  test/integration/better-auth.test.ts [ test/integration/better-auth.test.ts ]
Error: Cannot find package '@/lib/server/auth/config' imported from …/test/integration/better-auth.test.ts
```

- [ ] **Bước 3: Viết cổng đăng ký**

Create `lib/server/auth/signup-gate.ts`:

```ts
import type { StaffRole } from './permissions';

/** Anything with pg's `query` (a Pool or a checked-out client). */
export type Queryable = {
  query<R extends Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
};

export type SignupDecision =
  | { ok: true; role: StaffRole; via: 'invitation' | 'bootstrap' }
  | { ok: false };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Who may get a staff_user row (spec §7.1): an email with an open invitation
 * (not used, not revoked, not expired) takes the invitation's role; the
 * BOOTSTRAP_ADMIN_EMAIL becomes Admin, but only while no Admin exists.
 * Everyone else is refused. Runs inside databaseHooks.user.create.before, so
 * every path that creates a user (admin createUser, the bootstrap script, a
 * future plugin) goes through it.
 */
export async function decideSignup(
  db: Queryable,
  email: string,
  bootstrapAdminEmail: string | undefined,
): Promise<SignupDecision> {
  const normalized = normalizeEmail(email);
  const { rows } = await db.query<{ role: StaffRole }>(
    `SELECT role FROM staff_invitation
      WHERE email = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC
      LIMIT 1`,
    [normalized],
  );
  if (rows[0]) return { ok: true, role: rows[0].role, via: 'invitation' };

  if (bootstrapAdminEmail && normalized === normalizeEmail(bootstrapAdminEmail)) {
    const admins = await db.query(
      `SELECT 1 FROM staff_user WHERE 'admin' = ANY (string_to_array(role, ',')) LIMIT 1`,
    );
    if (admins.rows.length === 0) return { ok: true, role: 'admin', via: 'bootstrap' };
  }
  return { ok: false };
}
```

- [ ] **Bước 4: Viết cấu hình Better Auth**

Better Auth trả cùng một câu 200 cho mọi email ở `/request-password-reset`. Với địa chỉ có tài khoản, trước khi trả lời nó gọi `sendResetPassword` qua `runInBackgroundOrAwait` (`node_modules/better-auth/dist/api/routes/password.mjs:82`). Hàm đó chỉ chạy ở nền khi có `advanced.backgroundTasks.handler`; thiếu handler thì nó `await` việc gửi (`node_modules/better-auth/dist/context/create-context.mjs:215-221`). Khi đó địa chỉ của nhân viên chờ hai lần render react-email cộng một lời gọi Resend, còn địa chỉ lạ trả lời sau một truy vấn, nên thời gian trả lời lộ tài khoản nào tồn tại. Vì vậy `AuthDeps.backgroundTask` thành handler đó: app truyền `after()` (Task 7), test truyền một hàm bỏ qua promise. Hook vẫn tự bắt lỗi và chỉ ghi `code` (message có thể chứa địa chỉ). `url` của Better Auth bị bỏ qua: email trỏ thẳng tới trang của ta (Task 3, Task 8).

Token đặt lại mật khẩu là bearer secret, nên `verification.storeIdentifier: 'hashed'` chỉ lưu SHA-256 của `reset-password:<token>` (`node_modules/better-auth/dist/db/verification-token-storage.mjs`), như `staff_invitation` chỉ lưu `token_hash`. Lời gọi tạo, tìm và tiêu token đều băm cùng cách (`node_modules/better-auth/dist/db/internal-adapter.mjs:702-789`), nên luồng đặt lại mật khẩu không đổi.

Create `lib/server/auth/config.ts`:

```ts
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { admin as adminPlugin } from 'better-auth/plugins/admin';
import type { Pool } from 'pg';
import { ac, roles } from './permissions';
import { decideSignup } from './signup-gate';

/*
 * The one Better Auth configuration, built from injected parts so the app
 * (lib/server/auth/auth.ts), the schema CLI (scripts/auth-cli.config.ts), the
 * bootstrap script and the integration tests share it. The admin plugin's
 * schema merge mutates module state, so there must never be a second config.
 * No `server-only` here: the CLI and the script cannot load a module that
 * imports it.
 */

export const ADMIN_ENDPOINT_BLOCKED = 'ADMIN_ENDPOINT_BLOCKED';
export const INVITATION_REQUIRED = 'INVITATION_REQUIRED';

const DAY = 24 * 60 * 60;

export type ResetEmail = { user: { email: string; name: string }; token: string };

export type AuthDeps = {
  pool: Pool;
  /** BETTER_AUTH_SECRET; Better Auth refuses to start in production without one. */
  secret: string | undefined;
  /** BETTER_AUTH_URL, e.g. http://localhost:3200: the origin of the app and of emailed links. */
  baseURL: string | undefined;
  bootstrapAdminEmail: string | undefined;
  /** Sends the reset email; builds its own /admin/reset-password link from `token`. */
  sendResetPassword: (email: ResetEmail) => Promise<unknown>;
  /** Defaults to Better Auth's own rule: on in production only. */
  rateLimitEnabled?: boolean;
  /**
   * Runs Better Auth's background work (the reset email, the rate-limit
   * cleanup) after the response; the app passes Next's after(). Without it
   * Better Auth awaits the send (better-auth/dist/context/create-context.mjs:
   * 215-221), so a real staff address would answer slower than an unknown one.
   */
  backgroundTask?: (task: Promise<unknown>) => void;
};

/** An error's `code` (EmailSendError has one), never its message: messages may carry addresses. */
function codeOf(err: unknown): string {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : 'unknown';
}

export function createAuth(deps: AuthDeps) {
  return betterAuth({
    appName: 'Furama Cuisine',
    secret: deps.secret,
    baseURL: deps.baseURL,
    database: deps.pool,
    telemetry: { enabled: false },

    // Spec §5.2: staff_* tables via modelName; snake_case columns like the rest of the schema.
    user: {
      modelName: 'staff_user',
      fields: { emailVerified: 'email_verified', createdAt: 'created_at', updatedAt: 'updated_at' },
    },
    session: {
      modelName: 'staff_session',
      expiresIn: 7 * DAY,
      updateAge: DAY,
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    account: {
      modelName: 'staff_account',
      fields: {
        accountId: 'account_id',
        providerId: 'provider_id',
        userId: 'user_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      modelName: 'staff_verification',
      // Reset tokens are bearer secrets: keep only SHA-256(identifier), as
      // staff_invitation keeps only token_hash. Lookups hash the same way.
      storeIdentifier: 'hashed',
      fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' },
    },

    // Counted per IP and path by the HTTP router only; auth.api.* calls are never limited.
    rateLimit: {
      enabled: deps.rateLimitEnabled,
      storage: 'database',
      modelName: 'auth_rate_limit',
      fields: { lastRequest: 'last_request' },
    },

    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60, // the email says 60 minutes
      // Better Auth answers 200 for any email; with deps.backgroundTask this
      // runs after that answer (runInBackgroundOrAwait), so a staff address
      // answers as fast as an unknown one. A throw here must neither change the
      // answer nor reveal whether the account exists. Its `url` (a redirect hop
      // through /api/auth/reset-password/:token) is ignored; the email links to
      // our page.
      sendResetPassword: async ({ user, token }) => {
        try {
          await deps.sendResetPassword({ user: { email: user.email, name: user.name }, token });
        } catch (err) {
          console.error('[auth] reset email failed', { code: codeOf(err) });
        }
      },
    },

    databaseHooks: {
      user: {
        create: {
          // Runs after the admin plugin's own hook, so it has the last word on `role`.
          before: async (user) => {
            const decision = await decideSignup(deps.pool, user.email, deps.bootstrapAdminEmail);
            if (!decision.ok) {
              throw new APIError('FORBIDDEN', {
                code: INVITATION_REQUIRED,
                message: 'This email has no open invitation.',
              });
            }
            return { data: { ...user, role: decision.role } };
          },
        },
      },
    },

    advanced: {
      backgroundTasks: deps.backgroundTask ? { handler: deps.backgroundTask } : undefined,
    },

    hooks: {
      // Spec §7.1: no browser may reach the admin plugin's endpoints. The HTTP
      // router passes `request`; a server-side auth.api.* call does not.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.request && ctx.path.startsWith('/admin/')) {
          throw new APIError('FORBIDDEN', {
            code: ADMIN_ENDPOINT_BLOCKED,
            message: 'Admin endpoints are server-only.',
          });
        }
      }),
    },

    plugins: [
      adminPlugin({
        ac,
        roles,
        defaultRole: 'editor',
        adminRoles: ['admin'],
        schema: {
          user: { fields: { banReason: 'ban_reason', banExpires: 'ban_expires' } },
          session: { fields: { impersonatedBy: 'impersonated_by' } },
        },
      }),
      nextCookies(), // must stay last
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
```

- [ ] **Bước 5: Chạy lại test**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/better-auth.test.ts`
Expected: PASS `Tests  16 passed (16)`. "answers before the reset email is sent, so a staff address is no slower than an unknown one" cho thấy email chạy sau câu trả lời. "reset: request → token → new password; old sessions are revoked" cho thấy `staff_verification` không chứa token thô. Bỏ `storeIdentifier` hay `advanced.backgroundTasks` thì đúng hai test đó đỏ (`Tests  2 failed | 14 passed (16)`: `expected '[{"identifier":"reset-password:…' not to contain '…'` và `expected 'still waiting for the email' to be 200`). Tên test là bằng chứng của §16: "rejects HTTP calls to /api/auth/admin/* even from a signed-in Admin with a valid Origin", "still serves server-side auth.api.* calls, with the caller’s permissions", "auth.api.setRole commits outside our transaction (why role changes use our own SQL)".

- [ ] **Bước 6: Cho CLI Better Auth một config chỉ chạy trên DB cục bộ**

Create `scripts/auth-cli.config.ts`:

```ts
/*
 * For the Better Auth CLI only:
 *   PGHOST= PGUSER= PGPASSWORD= PGDATABASE= \
 *   AUTH_CLI_DATABASE_URL=postgres://localhost:5432/<name>_test \
 *     npx auth check --config scripts/auth-cli.config.ts
 * (`generate` takes the same --config). The CLI introspects the database to
 * diff the schema, and it loads .env and .env.local by itself, which point at
 * the shared Neon database. So this file reads a variable of its own and
 * refuses anything but a local database. Never run `npx auth migrate`:
 * migrations are db/migrations/*.sql.
 */
import { Pool } from 'pg';
import { createAuth } from '../lib/server/auth/config';

const url = process.env.AUTH_CLI_DATABASE_URL;
if (!url) throw new Error('Set AUTH_CLI_DATABASE_URL to a local postgres://localhost:5432/<name>_test database.');
const parsed = new URL(url);
// pg lets a query string (?host=...) override the hostname, so none is allowed.
if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.search !== '') {
  throw new Error(`Refusing ${parsed.hostname}: the Better Auth CLI only runs against a local database.`);
}

// The CLI has already copied .env.local into process.env for every key the
// shell left unset (node_modules/c12/dist/index.mjs:24), and pg fills what the
// URL leaves out (user, password, sslmode) from PG* variables: drop them all,
// so no Neon credential is ever offered to the local server. (A local server
// that needs a user takes it in the URL: postgres://me@localhost:5432/….)
for (const key of Object.keys(process.env)) if (key.startsWith('PG')) delete process.env[key];

export const auth = createAuth({
  pool: new Pool({ connectionString: url }),
  secret: 'cli-only-secret-cli-only-secret-0000',
  baseURL: 'http://localhost:3000',
  bootstrapAdminEmail: undefined,
  sendResetPassword: async () => {},
});
```

- [ ] **Bước 7: Kiểm schema bằng CLI trên một DB cục bộ**

CLI tự chép `.env.local` vào mọi biến mà shell để `undefined` (`node_modules/c12/dist/index.mjs:24`), và `pg` lấy user, mật khẩu, `sslmode` còn thiếu trong URL từ các biến `PG*`. Config ở Bước 6 xóa chúng; tiền tố `PG*=` rỗng là lớp thứ hai (c12 không ghi đè biến đã đặt, kể cả chuỗi rỗng).

```bash
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_cli_test node scripts/reset-db.mjs
PGHOST= PGUSER= PGPASSWORD= PGDATABASE= AUTH_CLI_DATABASE_URL=postgres://localhost:5432/furama_cuisine_cli_test npx auth check --config scripts/auth-cli.config.ts
PGHOST= PGUSER= PGPASSWORD= PGDATABASE= AUTH_CLI_DATABASE_URL=postgres://db.example.invalid:5432/x_test npx auth check --config scripts/auth-cli.config.ts; echo "exit $?"
psql -h localhost -d postgres -c 'DROP DATABASE furama_cuisine_cli_test'
```

Expected:
- `reset-db` in `Applied 5 migration(s).`
- Lệnh thứ hai in `Schema check passed against the live database.` (có thể kèm cảnh báo `MODULE_TYPELESS_PACKAGE_JSON` của Node; bỏ qua). Lúc kiểm chứng, một `.env.local` giả có `PGUSER`, `PGPASSWORD`, `PGSSLMODE=require` làm lệnh này in `Could not validate the schema. Check the auth configuration and database connection.` (`exit 2`) khi config chưa xóa `PG*`, và in câu "passed" khi đã xóa.
- Lệnh thứ ba từ chối mà không kết nối: `Could not load the Better Auth configuration.` rồi `exit 2`.
- `DROP DATABASE`.

- [ ] **Bước 8: Chạy cổng kiểm tra**

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

Expected: typecheck sạch; lint 0 lỗi, 18 cảnh báo; `Test Files  23 passed (23)`, `Tests  217 passed (217)`; build thoát 0, bảng route không đổi (`○ /en`, `○ /en/restaurants/taya-house`); check-prerender in `Prerender check passed …` và `Font check passed …`; E2E `33 passed`; visual `8 passed`.

- [ ] **Bước 9: Commit**

```bash
git add lib/server/auth/signup-gate.ts lib/server/auth/config.ts scripts/auth-cli.config.ts test/helpers/auth.ts test/integration/better-auth.test.ts
git commit -m "$(cat <<'EOF'
feat: configure Better Auth for invitation-only staff accounts

lib/server/auth/config.ts is the one Better Auth configuration (the app, the
schema CLI, the bootstrap script and the tests all build it with createAuth):
staff_* tables with snake_case columns, email and password with sign-up
closed, 7-day sessions with no cookie cache, the rate limit stored in
auth_rate_limit, the admin plugin with our roles, and nextCookies() last.

databaseHooks.user.create.before admits only an email with an open
invitation (taking the invitation's role) or BOOTSTRAP_ADMIN_EMAIL while no
Admin exists. hooks.before turns away every HTTP call to /api/auth/admin/*;
server-side auth.api.* calls still work with the caller's permissions. The
integration tests prove both day-1 questions of spec §16, plus that
auth.api.setRole commits outside our transaction, which is why role changes
will use our own SQL.

Reset tokens are stored as SHA-256 only (storeIdentifier: 'hashed'). Given a
backgroundTask, Better Auth sends the reset email after its 200, so a staff
address answers as fast as an unknown one; a failing send is logged by its
code only and never changes that answer.

scripts/auth-cli.config.ts lets `npx auth check --config …` run against a
local database only: the CLI loads .env.local (the shared Neon DB) itself, so
the config also drops the PG* variables the CLI copied from there.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 3: Module email cho email mời và email đặt lại mật khẩu

Task này không phụ thuộc Better Auth; nó có thể chạy song song với Task 1–2, nhưng phải xong trước Task 4.

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `lib/server/email/types.ts`, `lib/server/email/send.ts`, `lib/server/email/auth-emails.ts`
- Create: `lib/server/email/templates/layout.tsx`, `lib/server/email/templates/staff-invitation.tsx`, `lib/server/email/templates/password-reset.tsx`
- Test: `lib/server/email/email.test.ts`, `lib/server/email/resend-import.guard.test.ts`

**Interfaces:**
- Consumes: không có.
- Produces:
  - `types.ts` (không `server-only`): `type EmailDeliveryMode = 'live' | 'redirect' | 'log'`, `type SendEmailInput`, `type DeliveredEmail`, `type SendEmailResult = { mode; id? }`, `type EmailErrorCode`, `class EmailSendError extends Error { code }`, `type EmailLogSink`, `type ResendLike`, `describeEmailError(error: unknown): string` (`"<code>: <message>"`, tối đa 300 ký tự).
  - `send.ts`: `consoleLogSink`, `renderEmail(element): Promise<{ html; text }>`, `createEmailSender(overrides?: Partial<EmailDeps>)`, `sendEmail` (bộ gửi mặc định, đọc env lúc gửi).
  - `auth-emails.ts`: `appOrigin(env?)`, `invitationUrl(token, origin?)`, `passwordResetUrl(token, origin?)`, `type StaffInvitationEmailArgs = { to; token; invitationId; role; inviterName }`, `sendStaffInvitation(args, send?)`, `sendPasswordReset({ user: { email, name? }, token }, send?)`. Khóa idempotency: `invite:{invitationId}:{sha256(token)[0..16]}` và `reset:{sha256(token)[0..16]}`.

- [ ] **Bước 1: Cài Resend và react-email**

```bash
npm i resend@6.31.0 react-email@6.11.0
```

Expected: `found 0 vulnerabilities`; `git diff package.json`:

```diff
diff --git a/package.json b/package.json
index cf3bf59..762038e 100644
--- a/package.json
+++ b/package.json
@@ -23,6 +23,8 @@
     "pg": "^8.23.0",
     "react": "^19.3.0",
     "react-dom": "^19.3.0",
+    "react-email": "^6.11.0",
+    "resend": "^6.31.0",
     "zod": "^4.6.5"
   },
   "devDependencies": {
```

- [ ] **Bước 2: Viết test**

Create `lib/server/email/email.test.ts`:

```ts
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invitationUrl, passwordResetUrl, sendPasswordReset, sendStaffInvitation } from './auth-emails';
import { consoleLogSink, createEmailSender, renderEmail, sendEmail } from './send';
import { PasswordResetEmail } from './templates/password-reset';
import { StaffInvitationEmail } from './templates/staff-invitation';
import { EmailSendError, describeEmailError, type DeliveredEmail, type ResendLike } from './types';

const URL_INVITE = 'https://admin.example.vn/admin/accept-invite?token=abc_DEF-123';
const sha16 = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

function fakeResend(result?: Awaited<ReturnType<ResendLike['emails']['send']>>) {
  const send = vi.fn<ResendLike['emails']['send']>(async () => result ?? { data: { id: 'em_1' }, error: null });
  return { send, client: { emails: { send } } satisfies ResendLike };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('templates', () => {
  it('invitation html + text carry the link, role, inviter and 7-day expiry in Vietnamese', async () => {
    const el = createElement(StaffInvitationEmail, { acceptUrl: URL_INVITE, role: 'editor', inviterName: 'Nguyễn Văn An' });
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
    const el = createElement(PasswordResetEmail, { resetUrl: 'https://x.vn/admin/reset-password?token=t1', userName: 'Lan' });
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
});

describe('delivery modes', () => {
  const content = { html: '<p>hi</p>', text: 'hi' };

  it('defaults to log when EMAIL_DELIVERY is unset and never touches Resend', async () => {
    const sink: DeliveredEmail[] = [];
    const createResend = vi.fn();
    const send = createEmailSender({ env: {}, createResend, logSink: (e) => void sink.push(e) });
    const r = await send({ to: 'a@b.vn', subject: 'S', ...content, idempotencyKey: 'k' });
    expect(r).toEqual({ mode: 'log' });
    expect(createResend).not.toHaveBeenCalled();
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

  it('rejects unknown modes instead of falling through to live', async () => {
    const send = createEmailSender({ env: { EMAIL_DELIVERY: 'Live x' }, logSink: () => {} });
    await expect(send({ to: 'a@b.vn', subject: 'S', ...content })).rejects.toMatchObject({ code: 'invalid_delivery_mode' });
  });

  it('redirect rewrites "to", keeps the original in the subject, and sends through Resend', async () => {
    const { send: resendSend, client } = fakeResend();
    const send = createEmailSender({
      env: { EMAIL_DELIVERY: 'redirect', EMAIL_REDIRECT_TO: 'qa@furama.test', RESEND_API_KEY: 're_x', EMAIL_FROM: 'Furama <no-reply@mail.furama.test>' },
      createResend: () => client,
    });
    const r = await send({ to: 'real@guest.vn', subject: 'Hello', ...content, idempotencyKey: 'k1' });
    expect(r).toEqual({ mode: 'redirect', id: 'em_1' });
    expect(resendSend).toHaveBeenCalledWith(
      { from: 'Furama <no-reply@mail.furama.test>', to: 'qa@furama.test', subject: '[real@guest.vn] Hello', html: '<p>hi</p>', text: 'hi' },
      { idempotencyKey: 'k1' },
    );
  });

  it('redirect without EMAIL_REDIRECT_TO throws', async () => {
    const send = createEmailSender({
      env: { EMAIL_DELIVERY: 'redirect', RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b' },
      createResend: () => fakeResend().client,
    });
    await expect(send({ to: 'a@b.vn', subject: 'S', ...content })).rejects.toMatchObject({ code: 'missing_redirect_to' });
  });

  it('live calls the Resend client with the real recipient', async () => {
    const { send: resendSend, client } = fakeResend();
    const createResend = vi.fn(() => client);
    const send = createEmailSender({ env: { EMAIL_DELIVERY: 'live', RESEND_API_KEY: 're_key', EMAIL_FROM: 'no-reply@mail.furama.test' }, createResend });
    const r = await send({ to: 'real@guest.vn', subject: 'Hello', ...content });
    expect(r).toEqual({ mode: 'live', id: 'em_1' });
    expect(createResend).toHaveBeenCalledWith('re_key');
    expect(resendSend).toHaveBeenCalledWith(
      { from: 'no-reply@mail.furama.test', to: 'real@guest.vn', subject: 'Hello', html: '<p>hi</p>', text: 'hi' },
      undefined,
    );
  });

  it('live without RESEND_API_KEY throws a clear error at send time, not at import', async () => {
    // Importing the module (above) with no key already succeeded; the default sender fails only when used.
    vi.stubEnv('EMAIL_DELIVERY', 'live');
    vi.stubEnv('RESEND_API_KEY', '');
    const err = await sendEmail({ to: 'a@b.vn', subject: 'S', ...content }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmailSendError);
    expect(err).toMatchObject({ code: 'missing_api_key', message: 'RESEND_API_KEY is required when EMAIL_DELIVERY=live' });
  });

  it('live without EMAIL_FROM throws', async () => {
    const send = createEmailSender({ env: { EMAIL_DELIVERY: 'live', RESEND_API_KEY: 're_x' }, createResend: () => fakeResend().client });
    await expect(send({ to: 'a@b.vn', subject: 'S', ...content })).rejects.toMatchObject({ code: 'missing_from' });
  });

  it('turns Resend {error} results and thrown errors into EmailSendError(provider_error)', async () => {
    const env = { EMAIL_DELIVERY: 'live', RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b' };
    const rejected = createEmailSender({ env, createResend: () => fakeResend({ data: null, error: { message: 'domain not verified' } }).client });
    await expect(rejected({ to: 'a@b.vn', subject: 'S', ...content })).rejects.toThrow(/domain not verified/);
    const boom = createEmailSender({
      env,
      createResend: () => ({
        emails: {
          send: async () => {
            throw new Error('ECONNRESET');
          },
        },
      }),
    });
    await expect(boom({ to: 'a@b.vn', subject: 'S', ...content })).rejects.toMatchObject({ code: 'provider_error' });
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
    expect(describeEmailError(new EmailSendError('provider_error', 'Resend rejected the email: rate limited'))).toBe(
      'provider_error: Resend rejected the email: rate limited',
    );
    expect(describeEmailError(new Error('socket hang up'))).toBe('unknown: socket hang up');
    expect(describeEmailError('x'.repeat(400))).toHaveLength(300);
  });
});
```

- [ ] **Bước 3: Chạy test, phải đỏ**

Run: `npx vitest run lib/server/email`
Expected: FAIL

```
 FAIL  lib/server/email/email.test.ts [ lib/server/email/email.test.ts ]
Error: Cannot find module './auth-emails' imported from …/lib/server/email/email.test.ts
```

- [ ] **Bước 4: Viết kiểu và bộ gửi**

Create `lib/server/email/types.ts`:

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
  /** Sent as Resend's Idempotency-Key (live and redirect only; Resend keeps keys for 24 hours). */
  idempotencyKey?: string;
};

/** What a sink / the provider actually received, after redirect and rendering. */
export type DeliveredEmail = {
  mode: EmailDeliveryMode;
  to: string;
  /** Original recipient; differs from `to` only in redirect mode. */
  originalTo: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey?: string;
};

export type SendEmailResult = { mode: EmailDeliveryMode; id?: string };

export type EmailErrorCode =
  | 'invalid_delivery_mode'
  | 'missing_api_key'
  | 'missing_from'
  | 'missing_redirect_to'
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

/** The slice of the Resend SDK we use; tests inject a fake. */
export type ResendLike = {
  emails: {
    send(
      payload: { from: string; to: string; subject: string; html: string; text: string },
      options?: { idempotencyKey?: string },
    ): Promise<{ data: { id: string } | null; error: { name?: string; message: string } | null }>;
  };
};

/** What goes in staff_invitation.email_error: "<code>: <message>", at most 300 characters, safe to show an Admin. */
export function describeEmailError(error: unknown): string {
  const text =
    error instanceof EmailSendError
      ? `${error.code}: ${error.message}`
      : `unknown: ${error instanceof Error ? error.message : String(error)}`;
  return text.slice(0, 300);
}
```

Create `lib/server/email/send.ts`. Env đọc lúc gửi, không lúc import, nên build không cần biến email nào. Chế độ `log` chỉ in tên miền người nhận và khóa idempotency trên deployment của Vercel (`VERCEL_ENV` là `production` hoặc `preview`): log ở đó nằm trên Vercel, và một Preview thiếu `EMAIL_DELIVERY` sẽ rơi về `log` trên bản sao dữ liệu nhân viên thật. Ngoài Vercel (dev, CI, `next start` của E2E) và dưới `vercel dev` (`VERCEL_ENV=development`, giá trị mà `vercel env pull` cũng ghi vào `.env.local`) nó in toàn bộ thư; `EMAIL_LOG_FILE` là cách E2E đọc link từ một tiến trình server khác. Nếu che cả `development`, một `.env.local` từng được `vercel env pull` sẽ làm E2E cục bộ mất file log.

```ts
import 'server-only';
import type { ReactElement } from 'react';
import { plainTextSelectors, render } from 'react-email';
import { Resend } from 'resend';
import {
  EmailSendError,
  type DeliveredEmail,
  type EmailDeliveryMode,
  type EmailLogSink,
  type ResendLike,
  type SendEmailInput,
  type SendEmailResult,
} from './types';

export type EmailDeps = {
  /** Read at send time, never at import time, so `next build` needs no email env. */
  env: Record<string, string | undefined>;
  createResend: (apiKey: string) => ResendLike;
  logSink: EmailLogSink;
};

/** Vercel deployments: their logs live on Vercel, and a Preview may run on a copy of production's staff. */
const DEPLOYED = new Set(['production', 'preview']);

/**
 * Default log sink. Invite and reset links are bearer tokens, so on a Vercel deployment
 * (VERCEL_ENV production or preview, e.g. a Preview missing EMAIL_DELIVERY) the log line carries
 * only the recipient domain and the idempotency key. Off Vercel (dev, CI, `next start` in E2E)
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
  createResend: (apiKey) => new Resend(apiKey) as unknown as ResendLike,
  logSink: consoleLogSink,
});

function resolveMode(raw: string | undefined): EmailDeliveryMode {
  const value = raw?.trim();
  if (!value) return 'log';
  if (value === 'live' || value === 'redirect' || value === 'log') return value;
  // Fail closed: a typo must never fall through to real delivery.
  throw new EmailSendError(
    'invalid_delivery_mode',
    `EMAIL_DELIVERY must be live, redirect or log (got "${value}")`,
  );
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

export function createEmailSender(overrides: Partial<EmailDeps> = {}) {
  return async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    const deps = { ...defaultDeps(), ...overrides };
    const mode = resolveMode(deps.env.EMAIL_DELIVERY);
    const { html, text } = await renderContent(input);

    let to = input.to;
    let subject = input.subject;
    if (mode === 'redirect') {
      const target = deps.env.EMAIL_REDIRECT_TO?.trim();
      if (!target) {
        throw new EmailSendError('missing_redirect_to', 'EMAIL_REDIRECT_TO is required when EMAIL_DELIVERY=redirect');
      }
      to = target;
      subject = `[${input.to}] ${input.subject}`;
    }

    const delivered: DeliveredEmail = {
      mode,
      to,
      originalTo: input.to,
      subject,
      html,
      text,
      idempotencyKey: input.idempotencyKey,
    };

    if (mode === 'log') {
      await deps.logSink(delivered);
      return { mode };
    }

    const apiKey = deps.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      throw new EmailSendError('missing_api_key', `RESEND_API_KEY is required when EMAIL_DELIVERY=${mode}`);
    }
    const from = deps.env.EMAIL_FROM?.trim();
    if (!from) {
      throw new EmailSendError('missing_from', `EMAIL_FROM is required when EMAIL_DELIVERY=${mode}`);
    }

    let result;
    try {
      result = await deps.createResend(apiKey).emails.send(
        { from, to, subject, html, text },
        input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
      );
    } catch (cause) {
      throw new EmailSendError('provider_error', `Resend request failed: ${String((cause as Error)?.message ?? cause)}`, { cause });
    }
    if (result.error || !result.data) {
      throw new EmailSendError('provider_error', `Resend rejected the email: ${result.error?.message ?? 'no id returned'}`);
    }
    return { mode, id: result.data.id };
  };
}

export const sendEmail = createEmailSender();
```

- [ ] **Bước 5: Viết template**

Mỗi đoạn có biến được viết thành một biểu thức template string: JSX trộn chữ với `{biến}` sinh `<!-- -->` giữa các node chữ, làm chuỗi trong email bị cắt.

Create `lib/server/email/templates/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Body, Container, Head, Hr, Html, Preview, Text } from 'react-email';

const brand = '#7a1f2b';

/** Shared shell for staff emails. Inline styles only: email clients ignore stylesheets. */
export function EmailLayout({ preview, children }: { preview: string; children: ReactNode }) {
  return (
    <Html lang="vi">
      <Head />
      <Preview>{preview}</Preview>
      <Body lang="vi" style={{ backgroundColor: '#f6f3ee', margin: 0, padding: '24px 0', fontFamily: 'Helvetica, Arial, sans-serif', color: '#2b2622' }}>
        <Container style={{ backgroundColor: '#ffffff', maxWidth: 520, margin: '0 auto', padding: '32px 28px', borderTop: `4px solid ${brand}` }}>
          <Text style={{ margin: '0 0 24px', fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', color: brand }}>
            Furama Cuisine
          </Text>
          {children}
          <Hr style={{ borderColor: '#e6e0d6', margin: '28px 0 12px' }} />
          <Text style={{ margin: 0, fontSize: 12, color: '#7a7268' }}>
            Đây là email tự động từ hệ thống quản trị Furama Cuisine. Vui lòng không trả lời email này.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const emailStyles = {
  heading: { fontSize: 22, margin: '0 0 16px', fontWeight: 600 } as const,
  paragraph: { fontSize: 15, lineHeight: '24px', margin: '0 0 16px' } as const,
  button: { backgroundColor: brand, color: '#ffffff', padding: '12px 24px', borderRadius: 4, fontSize: 15, textDecoration: 'none', display: 'inline-block' } as const,
  small: { fontSize: 13, lineHeight: '20px', color: '#7a7268', margin: '16px 0 0', wordBreak: 'break-all' } as const,
};
```

Create `lib/server/email/templates/staff-invitation.tsx`:

```tsx
import { Button, Heading, Link, Text } from 'react-email';
import { EmailLayout, emailStyles } from './layout';

export type StaffInvitationProps = {
  /** Full accept link, e.g. https://host/admin/accept-invite?token=… */
  acceptUrl: string;
  role: 'admin' | 'editor';
  inviterName: string;
  expiresInDays?: number;
};

export const roleLabelVi = { admin: 'Quản trị viên', editor: 'Biên tập viên' } as const;

export const staffInvitationSubject = 'Lời mời tham gia quản trị Furama Cuisine';

export function StaffInvitationEmail({ acceptUrl, role, inviterName, expiresInDays = 7 }: StaffInvitationProps) {
  const roleLabel = roleLabelVi[role];
  return (
    <EmailLayout preview={`${inviterName} mời bạn tham gia quản trị Furama Cuisine với vai trò ${roleLabel}`}>
      <Heading as="h1" style={emailStyles.heading}>Bạn được mời tham gia quản trị Furama Cuisine</Heading>
      <Text style={emailStyles.paragraph}>
        {`${inviterName} đã mời bạn vào khu vực quản trị Furama Cuisine với vai trò `}<strong>{roleLabel}</strong>.
      </Text>
      <Button href={acceptUrl} style={emailStyles.button}>Chấp nhận lời mời</Button>
      <Text style={emailStyles.small}>
        Nếu nút không hoạt động, hãy mở liên kết này: <Link href={acceptUrl}>{acceptUrl}</Link>
      </Text>
      <Text style={emailStyles.paragraph}>
        {`Liên kết có hiệu lực trong ${expiresInDays} ngày và chỉ dùng được một lần. Nếu bạn không mong đợi lời mời này, hãy bỏ qua email.`}
      </Text>
    </EmailLayout>
  );
}
```

Create `lib/server/email/templates/password-reset.tsx`:

```tsx
import { Button, Heading, Link, Text } from 'react-email';
import { EmailLayout, emailStyles } from './layout';

export type PasswordResetProps = {
  /** Full link to /admin/reset-password?token=… */
  resetUrl: string;
  userName?: string;
  expiresInMinutes?: number;
};

export const passwordResetSubject = 'Đặt lại mật khẩu quản trị Furama Cuisine';

export function PasswordResetEmail({ resetUrl, userName, expiresInMinutes = 60 }: PasswordResetProps) {
  return (
    <EmailLayout preview="Đặt lại mật khẩu quản trị Furama Cuisine">
      <Heading as="h1" style={emailStyles.heading}>Đặt lại mật khẩu</Heading>
      <Text style={emailStyles.paragraph}>
        {`${userName ? `Xin chào ${userName}, chúng` : 'Chúng'} tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản quản trị Furama Cuisine của bạn.`}
      </Text>
      <Button href={resetUrl} style={emailStyles.button}>Đặt mật khẩu mới</Button>
      <Text style={emailStyles.small}>
        Nếu nút không hoạt động, hãy mở liên kết này: <Link href={resetUrl}>{resetUrl}</Link>
      </Text>
      <Text style={emailStyles.paragraph}>
        {`Liên kết có hiệu lực trong ${expiresInMinutes} phút. Nếu bạn không yêu cầu, hãy bỏ qua email này; mật khẩu hiện tại vẫn giữ nguyên.`}
      </Text>
    </EmailLayout>
  );
}
```

- [ ] **Bước 6: Viết hai email của nhân viên**

Create `lib/server/email/auth-emails.ts`:

```ts
import 'server-only';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { sendEmail as defaultSend } from './send';
import { PasswordResetEmail, passwordResetSubject } from './templates/password-reset';
import { StaffInvitationEmail, staffInvitationSubject, type StaffInvitationProps } from './templates/staff-invitation';
import type { SendEmailInput, SendEmailResult } from './types';

/*
 * The two staff emails of phase 3 (spec §7.1, §10.4): they go straight to
 * Resend through sendEmail, not through the booking outbox. Links are built
 * from BETTER_AUTH_URL; the raw token appears only in the link, never in the
 * idempotency key (Resend stores keys) or a log line.
 */

type Send = (input: SendEmailInput) => Promise<SendEmailResult>;

export function appOrigin(env: Record<string, string | undefined> = process.env): string {
  return (env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export function invitationUrl(token: string, origin = appOrigin()): string {
  return `${origin}/admin/accept-invite?token=${encodeURIComponent(token)}`;
}

export function passwordResetUrl(token: string, origin = appOrigin()): string {
  return `${origin}/admin/reset-password?token=${encodeURIComponent(token)}`;
}

const tokenKey = (token: string) => createHash('sha256').update(token).digest('hex').slice(0, 16);

export type StaffInvitationEmailArgs = {
  to: string;
  token: string;
  invitationId: string;
  role: StaffInvitationProps['role'];
  inviterName: string;
};

/**
 * Keyed by the invitation and its token: "Gửi lại" mints a new token, so it is
 * a new Resend idempotency key, while a retry of the same send stays deduplicated.
 */
export function sendStaffInvitation(args: StaffInvitationEmailArgs, send: Send = defaultSend): Promise<SendEmailResult> {
  return send({
    to: args.to,
    subject: staffInvitationSubject,
    react: createElement(StaffInvitationEmail, {
      acceptUrl: invitationUrl(args.token),
      role: args.role,
      inviterName: args.inviterName,
    }),
    idempotencyKey: `invite:${args.invitationId}:${tokenKey(args.token)}`,
  });
}

/**
 * Better Auth's `url` points at ITS callback (/api/auth/reset-password/:token),
 * which redirects to a callbackURL. We build /admin/reset-password ourselves
 * from the token, so the admin screen owns the flow.
 */
export function sendPasswordReset(
  data: { user: { email: string; name?: string | null }; token: string },
  send: Send = defaultSend,
): Promise<SendEmailResult> {
  return send({
    to: data.user.email,
    subject: passwordResetSubject,
    react: createElement(PasswordResetEmail, {
      resetUrl: passwordResetUrl(data.token),
      userName: data.user.name ?? undefined,
    }),
    idempotencyKey: `reset:${tokenKey(data.token)}`,
  });
}
```

- [ ] **Bước 7: Chạy lại test**

Run: `npx vitest run lib/server/email`
Expected: PASS `Tests  16 passed (16)`

- [ ] **Bước 8: Viết guard "chỉ module email import Resend"**

Create `lib/server/email/resend-import.guard.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Every email goes through lib/server/email/send.ts, the only place that
 * honours EMAIL_DELIVERY (spec §10.4: log by default, redirect on previews,
 * live in production). A second `new Resend(...)` elsewhere would send real
 * mail from CI or a preview.
 */
const ROOT = join(__dirname, '..', '..', '..');
const SCAN = ['app', 'lib', 'components', 'db', 'scripts', 'proxy.ts'];
const ALLOWED = 'lib/server/email/';

function files(path: string): string[] {
  const full = join(ROOT, path);
  try {
    return readdirSync(full, { withFileTypes: true }).flatMap((e) => files(join(path, e.name)));
  } catch {
    return /\.(ts|tsx|mjs|js)$/.test(path) ? [full] : [];
  }
}

const IMPORTS_RESEND = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]resend(?:\/[^'"]*)?['"]/;

describe('resend imports', () => {
  it('only lib/server/email imports the Resend SDK', () => {
    const offenders = SCAN.flatMap(files)
      .map((f) => relative(ROOT, f))
      .filter((f) => !f.startsWith(ALLOWED) && IMPORTS_RESEND.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('recognises the import forms it is looking for', () => {
    for (const line of [`import { Resend } from 'resend';`, `const { Resend } = await import("resend")`, `require('resend')`]) {
      expect(IMPORTS_RESEND.test(line)).toBe(true);
    }
    expect(IMPORTS_RESEND.test(`import { sendEmail } from '@/lib/server/email/send';`)).toBe(false);
  });
});
```

- [ ] **Bước 9: Kiểm rằng guard bắt được lỗi, rồi chạy lại**

```bash
printf "import { Resend } from 'resend';\nexport const r = new Resend('x');\n" > lib/server/oops.ts
npx vitest run lib/server/email/resend-import.guard.test.ts
rm lib/server/oops.ts
npx vitest run lib/server/email
```

Expected: lần đầu FAIL

```
     × only lib/server/email imports the Resend SDK
- Expected
+ Received
+   "lib/server/oops.ts",
```

sau khi xóa file: PASS `Tests  18 passed (18)`. Kiểm `git status --short lib/server` không còn `oops.ts`.

- [ ] **Bước 10: Chạy cổng kiểm tra**

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

Expected: typecheck sạch; lint 0 lỗi, 18 cảnh báo (template có `style={…}` là đúng: email client bỏ qua stylesheet; luật cấm inline style chỉ áp cho `app/admin`); `Test Files  25 passed (25)`, `Tests  235 passed (235)`; build thoát 0, bảng route không đổi (`○ /en`, `○ /en/restaurants/taya-house`); check-prerender in `Prerender check passed …` và `Font check passed …`; E2E `33 passed`; visual `8 passed`.

- [ ] **Bước 11: Commit**

```bash
git add package.json package-lock.json lib/server/email
git commit -m "$(cat <<'EOF'
feat: send the staff invite and reset emails through one EMAIL_DELIVERY gate

lib/server/email/send.ts is the only door to Resend (a guard test fails on
any other `resend` import). EMAIL_DELIVERY is read at send time: unset means
log, redirect sends everything to EMAIL_REDIRECT_TO with the real address in
the subject, live sends for real, and anything else throws rather than fall
through to live mail. The idempotency key is Resend's second argument.

The log sink prints the whole message off Vercel (and under `vercel dev`) and
appends it to EMAIL_LOG_FILE as NDJSON, which is how E2E reads links out of
the server process; on a Production or Preview deployment it logs neither
the address nor the link. Keys are built from a SHA-256 of the token, never
the token.

The Vietnamese invitation and reset templates are react-email components;
plain text keeps headings as written. describeEmailError turns a failure into
the short "<code>: <message>" stored in staff_invitation.email_error.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 4: Ghi nhật ký trong cùng transaction, và nghiệp vụ nhân viên

**Files:**
- Create: `lib/server/audit.ts`, `lib/server/auth/staff.ts`
- Test: `test/integration/staff-auth.test.ts`

**Interfaces:**
- Consumes: `Auth`, `INVITATION_REQUIRED` (Task 2); `normalizeEmail` (Task 2); `StaffRole` (Task 1); `describeEmailError`, `EmailSendError` (Task 3); helper test của Task 2.
- Produces:
  - `lib/server/audit.ts`: `type AuditActor = { id: string; email: string; name?: string; ip?: string | null }`, `type AuditEntry = { action; entityType; entityId; locale?; before?; after? }`, `insertAudit(client: PoolClient, actor: AuditActor | null, entry: AuditEntry): Promise<void>`, `withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T>`.
  - `lib/server/auth/staff.ts`:
    - `type InviteEmail = { to; token; invitationId; role; inviterName }`, `type SendInvite = (email: InviteEmail) => Promise<unknown>`, `type StaffDeps = { pool: Pool; auth: Auth; sendInvite: SendInvite }`, `INVITE_TTL = '7 days'`, `hashToken(token)`, `newInviteToken()`;
    - `createInvitation(deps, actor, { email, role })` → `{ ok: true; id; emailSent } | { ok: false; code: 'already_staff' | 'already_invited' }`;
    - `resendInvitation(deps, actor, id)` → `{ ok: true; emailSent } | { ok: false; code: 'not_found' }`;
    - `revokeInvitation(deps, actor, id)` → `{ ok: true } | { ok: false; code: 'not_found' }`;
    - `findOpenInvitation(pool, token)` → `{ id; email; role } | null`;
    - `acceptInvitation(deps, { token, name, password }, ip?)` → `{ ok: true; userId; email } | { ok: false; code: 'invalid_token' | 'already_staff' }` (`already_staff` cũng đặt `used_at` cho lời mời đó);
    - `setStaffRole(pool, actor, { userId, role })` → `{ ok: true; changed } | { ok: false; code: 'not_found' | 'last_admin' }`;
    - `banStaff(pool, actor, userId)` → `{ ok: true; changed } | { ok: false; code: 'not_found' | 'last_admin' | 'self' }`;
    - `unbanStaff(pool, actor, userId)` → `{ ok: true; changed } | { ok: false; code: 'not_found' }`;
    - `removeStaff(pool, actor, userId)` → `{ ok: true } | { ok: false; code: 'not_found' | 'last_admin' | 'self' }` (thu hồi lời mời còn mở của địa chỉ đó trong cùng transaction).

- [ ] **Bước 1: Viết test tích hợp**

Create `test/integration/staff-auth.test.ts`:

```ts
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { insertAudit, withTransaction } from '@/lib/server/audit';
import { INVITATION_REQUIRED, type Auth } from '@/lib/server/auth/config';
import {
  acceptInvitation,
  banStaff,
  createInvitation,
  findOpenInvitation,
  removeStaff,
  resendInvitation,
  revokeInvitation,
  setStaffRole,
  unbanStaff,
  type SendInvite,
  type StaffDeps,
} from '@/lib/server/auth/staff';
import { EmailSendError } from '@/lib/server/email/types';
import { TEST_DATABASE_URL } from '../helpers/db';
import { PASSWORD, STAFF_TABLES, createBootstrapAdmin, createTestAuth, errorCode, signInCookie } from '../helpers/auth';

/*
 * Staff management (spec §7.1) on the real schema: invitations, accepting one,
 * role changes, ban and removal, each with its audit row in the same
 * transaction (spec §7.4), and the last-Admin rule.
 */

type Invite = Parameters<SendInvite>[0];

let pool: Pool;
let auth: Auth;
let invites: Invite[];
let failNext: Error | null;

function deps(): StaffDeps {
  return {
    pool,
    auth,
    sendInvite: async (args) => {
      if (failNext) {
        const err = failNext;
        failNext = null;
        throw err;
      }
      invites.push(args);
    },
  };
}

const rows = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) =>
  (await pool.query<T>(text, values)).rows;
const lastToken = () => invites.at(-1)!.token;

async function owner() {
  const user = await createBootstrapAdmin(auth);
  return { ...user, name: 'Owner', ip: '203.0.113.9' };
}

/** Invites and accepts in one go; returns the new staff member as an actor. */
async function onboard(actor: { id: string; email: string }, email: string, role: 'admin' | 'editor') {
  expect(await createInvitation(deps(), actor, { email, role })).toMatchObject({ ok: true });
  const accepted = await acceptInvitation(deps(), { token: lastToken(), name: email, password: PASSWORD });
  if (!accepted.ok) throw new Error(accepted.code);
  return { id: accepted.userId, email };
}

describe.skipIf(!TEST_DATABASE_URL)('staff management on migration 005', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 8 });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE ${STAFF_TABLES} CASCADE`);
    invites = [];
    failNext = null;
    auth = createTestAuth(pool);
  });

  describe('invitations', () => {
    it('invite → accept → sign in, with one audit row per step and a single-use token', async () => {
      const admin = await owner();
      const invited = await createInvitation(deps(), admin, { email: 'Ed@Furama.test', role: 'editor' });
      expect(invited).toMatchObject({ ok: true, emailSent: true });
      expect(invites[0]).toMatchObject({ to: 'ed@furama.test', role: 'editor', inviterName: 'Owner' });
      expect(invites[0].token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const [stored] = await rows<{ token_hash: string; email_error: string | null }>('SELECT token_hash, email_error FROM staff_invitation');
      expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.token_hash).not.toContain(invites[0].token);
      expect(stored.email_error).toBeNull();

      const accepted = await acceptInvitation(deps(), { token: lastToken(), name: 'Ed', password: PASSWORD }, '198.51.100.20');
      expect(accepted).toMatchObject({ ok: true, email: 'ed@furama.test' });
      expect(await rows('SELECT role, email_verified FROM staff_user WHERE email = $1', ['ed@furama.test'])).toEqual([
        { role: 'editor', email_verified: true },
      ]);
      expect(await signInCookie(auth, 'ed@furama.test')).toMatch(/session_token=/);

      expect(await acceptInvitation(deps(), { token: lastToken(), name: 'Ed', password: PASSWORD })).toEqual({
        ok: false,
        code: 'invalid_token',
      });
      expect(await rows('SELECT action, actor_id, host(ip) AS ip FROM audit_log ORDER BY id')).toEqual([
        { action: 'staff.invite', actor_id: admin.id, ip: '203.0.113.9' },
        { action: 'staff.invite_accept', actor_id: accepted.ok ? accepted.userId : null, ip: '198.51.100.20' },
      ]);
      // The token is in no audit row.
      expect(JSON.stringify(await rows('SELECT before, after FROM audit_log'))).not.toContain(invites[0].token);
    });

    it('a failed send keeps the invitation and records the error; a resend that works clears it', async () => {
      const admin = await owner();
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      failNext = new EmailSendError('provider_error', 'Resend rejected the email: rate limited');
      const invited = await createInvitation(deps(), admin, { email: 'ed@furama.test', role: 'editor' });
      expect(invited).toMatchObject({ ok: true, emailSent: false });
      expect(await rows('SELECT email_error FROM staff_invitation')).toEqual([
        { email_error: 'provider_error: Resend rejected the email: rate limited' },
      ]);
      expect(errors).toHaveBeenCalledWith('[staff] invite email failed', { id: invited.ok ? invited.id : '', code: 'provider_error' });
      errors.mockRestore();

      if (!invited.ok) throw new Error('unreachable');
      expect(await resendInvitation(deps(), admin, invited.id)).toEqual({ ok: true, emailSent: true });
      expect(await rows('SELECT email_error FROM staff_invitation')).toEqual([{ email_error: null }]);
    });

    it('refuses a second open invitation and an email that already has an account', async () => {
      const admin = await owner();
      await createInvitation(deps(), admin, { email: 'ed@furama.test', role: 'editor' });
      expect(await createInvitation(deps(), admin, { email: 'ED@furama.test', role: 'admin' })).toEqual({
        ok: false,
        code: 'already_invited',
      });
      expect(await createInvitation(deps(), admin, { email: admin.email, role: 'editor' })).toEqual({
        ok: false,
        code: 'already_staff',
      });
    });

    it('resend issues a new token and kills the old one', async () => {
      const admin = await owner();
      const invited = await createInvitation(deps(), admin, { email: 'ed@furama.test', role: 'editor' });
      if (!invited.ok) throw new Error('unreachable');
      const first = lastToken();
      expect(await resendInvitation(deps(), admin, invited.id)).toEqual({ ok: true, emailSent: true });
      const second = lastToken();
      expect(second).not.toBe(first);
      expect(await findOpenInvitation(pool, first)).toBeNull();
      expect(await findOpenInvitation(pool, second)).toMatchObject({ email: 'ed@furama.test', role: 'editor' });
      expect(await rows(`SELECT action FROM audit_log WHERE entity_type = 'staff_invitation' ORDER BY id`)).toEqual([
        { action: 'staff.invite' },
        { action: 'staff.invite_resend' },
      ]);
    });

    it('revoke closes the link and the account gate', async () => {
      const admin = await owner();
      const invited = await createInvitation(deps(), admin, { email: 'ed@furama.test', role: 'editor' });
      if (!invited.ok) throw new Error('unreachable');
      expect(await revokeInvitation(deps(), admin, invited.id)).toEqual({ ok: true });
      expect(await revokeInvitation(deps(), admin, invited.id)).toEqual({ ok: false, code: 'not_found' });
      expect(await acceptInvitation(deps(), { token: lastToken(), name: 'Ed', password: PASSWORD })).toEqual({
        ok: false,
        code: 'invalid_token',
      });
      expect(await errorCode(auth.api.createUser({ body: { email: 'ed@furama.test', password: PASSWORD, name: 'Ed' } }))).toBe(
        INVITATION_REQUIRED,
      );
      expect(await rows(`SELECT revoked_at IS NOT NULL AS revoked FROM staff_invitation`)).toEqual([{ revoked: true }]);
    });

    it('an expired invitation cannot be accepted, and the email can be invited again', async () => {
      const admin = await owner();
      await createInvitation(deps(), admin, { email: 'ed@furama.test', role: 'editor' });
      const stale = lastToken();
      await pool.query(`UPDATE staff_invitation SET expires_at = now() - interval '1 second'`);
      expect(await acceptInvitation(deps(), { token: stale, name: 'Ed', password: PASSWORD })).toEqual({
        ok: false,
        code: 'invalid_token',
      });
      expect(await createInvitation(deps(), admin, { email: 'ed@furama.test', role: 'admin' })).toMatchObject({ ok: true });
      expect(await rows('SELECT role, revoked_at IS NOT NULL AS revoked FROM staff_invitation ORDER BY id')).toEqual([
        { role: 'editor', revoked: true },
        { role: 'admin', revoked: false },
      ]);
    });

    it('rejects malformed tokens without a query', async () => {
      for (const token of ['', 'short', `${'a'.repeat(43)}=`, `${'a'.repeat(42)}!`]) {
        expect(await findOpenInvitation(pool, token)).toBeNull();
      }
    });

    it('two racing accepts of one token create one account', async () => {
      const admin = await owner();
      await createInvitation(deps(), admin, { email: 'ed@furama.test', role: 'editor' });
      const t = lastToken();
      const results = await Promise.allSettled([
        acceptInvitation(deps(), { token: t, name: 'A', password: PASSWORD }),
        acceptInvitation(deps(), { token: t, name: 'B', password: PASSWORD }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled' && r.value.ok)).toHaveLength(1);
      expect(await rows(`SELECT 1 FROM staff_user WHERE email = 'ed@furama.test'`)).toHaveLength(1);
    });

    // An account created while its invitation stayed open: what acceptInvitation
    // leaves behind when createUser succeeds and the "mark used" write fails.
    it('removing the member closes an invitation left open, so its link cannot recreate the account', async () => {
      const admin = await owner();
      await createInvitation(deps(), admin, { email: 'ed@furama.test', role: 'admin' });
      const stuck = lastToken();
      const { user } = await auth.api.createUser({ body: { email: 'ed@furama.test', password: PASSWORD, name: 'Ed' } });
      expect(await removeStaff(pool, admin, user.id)).toEqual({ ok: true });
      expect(await acceptInvitation(deps(), { token: stuck, name: 'Ed', password: PASSWORD })).toEqual({
        ok: false,
        code: 'invalid_token',
      });
      expect(await rows(`SELECT 1 FROM staff_user WHERE email = 'ed@furama.test'`)).toHaveLength(0);
    });

    it('reopening a link whose account exists answers already_staff and closes the invitation', async () => {
      const admin = await owner();
      await createInvitation(deps(), admin, { email: 'ed@furama.test', role: 'editor' });
      const stuck = lastToken();
      await auth.api.createUser({ body: { email: 'ed@furama.test', password: PASSWORD, name: 'Ed' } });
      expect(await acceptInvitation(deps(), { token: stuck, name: 'Ed', password: PASSWORD })).toEqual({
        ok: false,
        code: 'already_staff',
      });
      expect(await findOpenInvitation(pool, stuck)).toBeNull();
    });
  });

  describe('role changes and the last Admin', () => {
    it('a role change writes exactly one audit row, with the acting Admin', async () => {
      const admin = await owner();
      const editor = await onboard(admin, 'ed@furama.test', 'editor');
      await pool.query('DELETE FROM audit_log');

      expect(await setStaffRole(pool, admin, { userId: editor.id, role: 'admin' })).toEqual({ ok: true, changed: true });
      expect(
        await rows('SELECT actor_id, actor_email, action, entity_type, entity_id, before, after, host(ip) AS ip FROM audit_log'),
      ).toEqual([
        {
          actor_id: admin.id,
          actor_email: admin.email,
          action: 'staff.role',
          entity_type: 'staff_user',
          entity_id: editor.id,
          before: { role: 'editor' },
          after: { role: 'admin' },
          ip: '203.0.113.9',
        },
      ]);
      // Setting the same role again changes nothing and logs nothing.
      expect(await setStaffRole(pool, admin, { userId: editor.id, role: 'admin' })).toEqual({ ok: true, changed: false });
      expect(await rows('SELECT 1 FROM audit_log')).toHaveLength(1);
    });

    it('cannot demote, ban or remove the last Admin; a banned Admin does not count', async () => {
      const admin = await owner();
      expect(await setStaffRole(pool, admin, { userId: admin.id, role: 'editor' })).toEqual({ ok: false, code: 'last_admin' });
      expect(await removeStaff(pool, admin, admin.id)).toEqual({ ok: false, code: 'self' });
      expect(await banStaff(pool, admin, admin.id)).toEqual({ ok: false, code: 'self' });
      const other = await onboard(admin, 'second@furama.test', 'admin');
      await pool.query('UPDATE staff_user SET banned = true WHERE id = $1', [other.id]);
      expect(await setStaffRole(pool, admin, { userId: admin.id, role: 'editor' })).toEqual({ ok: false, code: 'last_admin' });
      expect(await removeStaff(pool, other, admin.id)).toEqual({ ok: false, code: 'last_admin' });
      expect(await banStaff(pool, other, admin.id)).toEqual({ ok: false, code: 'last_admin' });
      expect(await rows(`SELECT 1 FROM audit_log WHERE action IN ('staff.role', 'staff.remove', 'staff.ban')`)).toHaveLength(0);
    });

    it('two Admins demoting each other at once leave one Admin', async () => {
      const a = await owner();
      const b = await onboard(a, 'second@furama.test', 'admin');
      const results = await Promise.all([
        setStaffRole(pool, a, { userId: b.id, role: 'editor' }),
        setStaffRole(pool, b, { userId: a.id, role: 'editor' }),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, code: 'last_admin' }]);
      expect(await rows(`SELECT 1 FROM staff_user WHERE role = 'admin'`)).toHaveLength(1);
      expect(await rows(`SELECT 1 FROM audit_log WHERE action = 'staff.role'`)).toHaveLength(1);
    });

    it('a failed audit insert rolls the change back (same transaction)', async () => {
      const admin = await owner();
      const editor = await onboard(admin, 'ed@furama.test', 'editor');
      await expect(
        withTransaction(pool, async (c) => {
          await c.query(`UPDATE staff_user SET role = 'admin' WHERE id = $1`, [editor.id]);
          await insertAudit(c, admin, { action: 'not-an-action', entityType: 'staff_user', entityId: editor.id });
        }),
      ).rejects.toThrow(/audit_log_action_check/);
      expect(await rows('SELECT role FROM staff_user WHERE id = $1', [editor.id])).toEqual([{ role: 'editor' }]);
    });

    it('stores no IP that is not an address', async () => {
      const admin = await owner();
      await withTransaction(pool, (c) =>
        insertAudit(c, { ...admin, ip: 'not-an-ip' }, { action: 'staff.role', entityType: 'staff_user', entityId: admin.id }),
      );
      expect(await rows('SELECT ip FROM audit_log')).toEqual([{ ip: null }]);
    });
  });

  describe('ban, unban and removal', () => {
    it('ban signs the member out everywhere, keeps them out, and logs it; unban logs too', async () => {
      const admin = await owner();
      const editor = await onboard(admin, 'ed@furama.test', 'editor');
      const headers = new Headers({ cookie: await signInCookie(auth, editor.email) });

      expect(await banStaff(pool, admin, editor.id)).toEqual({ ok: true, changed: true });
      expect(await auth.api.getSession({ headers })).toBeNull();
      expect(await rows('SELECT 1 FROM staff_session WHERE user_id = $1', [editor.id])).toHaveLength(0);
      expect(await errorCode(auth.api.signInEmail({ body: { email: editor.email, password: PASSWORD } }))).toBe('BANNED_USER');
      expect(await banStaff(pool, admin, editor.id)).toEqual({ ok: true, changed: false });

      expect(await unbanStaff(pool, admin, editor.id)).toEqual({ ok: true, changed: true });
      expect(await signInCookie(auth, editor.email)).toMatch(/session_token=/);
      expect(await unbanStaff(pool, admin, editor.id)).toEqual({ ok: true, changed: false });
      expect(await rows(`SELECT action, before, after FROM audit_log WHERE action IN ('staff.ban', 'staff.unban') ORDER BY id`)).toEqual([
        { action: 'staff.ban', before: { banned: false }, after: { banned: true } },
        { action: 'staff.unban', before: { banned: true }, after: { banned: false } },
      ]);
      expect(await banStaff(pool, admin, 'nobody')).toEqual({ ok: false, code: 'not_found' });
    });

    it('removing staff deletes their sessions and logs the removal', async () => {
      const admin = await owner();
      const editor = await onboard(admin, 'ed@furama.test', 'editor');
      const headers = new Headers({ cookie: await signInCookie(auth, editor.email) });
      expect(await removeStaff(pool, admin, editor.id)).toEqual({ ok: true });
      expect(await auth.api.getSession({ headers })).toBeNull();
      expect(await rows(`SELECT actor_id, before->>'email' AS email FROM audit_log WHERE action = 'staff.remove'`)).toEqual([
        { actor_id: admin.id, email: 'ed@furama.test' },
      ]);
      expect(await removeStaff(pool, admin, editor.id)).toEqual({ ok: false, code: 'not_found' });
    });
  });
});
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/staff-auth.test.ts`
Expected: FAIL

```
 FAIL  test/integration/staff-auth.test.ts [ test/integration/staff-auth.test.ts ]
Error: Cannot find package '@/lib/server/audit' imported from …/test/integration/staff-auth.test.ts
```

- [ ] **Bước 3: Viết phần ghi nhật ký**

Create `lib/server/audit.ts`:

```ts
import 'server-only';
import { isIP } from 'node:net';
import type { Pool, PoolClient } from 'pg';

/*
 * The audit half of the save flow (spec §7.4): every admin write runs inside
 * withTransaction and calls insertAudit on the same client, so the change and
 * its audit row commit or roll back together.
 */

/** Who did it: a snapshot (no foreign key), so the log outlives a removed account. */
export type AuditActor = { id: string; email: string; name?: string; ip?: string | null };

export type AuditEntry = {
  action: string; // create | update | delete | reorder | restore | settings | staff.*
  entityType: string;
  entityId: string | null;
  locale?: string | null;
  before?: unknown;
  after?: unknown;
};

export async function insertAudit(client: PoolClient, actor: AuditActor | null, entry: AuditEntry): Promise<void> {
  const ip = actor?.ip && isIP(actor.ip) ? actor.ip : null;
  await client.query(
    `INSERT INTO audit_log (actor_id, actor_email, action, entity_type, entity_id, locale, before, after, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      actor?.id ?? null,
      actor?.email ?? null,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.locale ?? null,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      ip,
    ],
  );
}

export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Bước 4: Viết nghiệp vụ nhân viên**

Mỗi hàm đổi tài khoản khóa các hàng Admin trước (luôn theo thứ tự `id`), rồi mới khóa hàng đích, nên hai thao tác đồng thời không thể cùng thấy "vẫn còn Admin khác" và không deadlock. Khóa tài khoản xóa luôn `staff_session` của người đó, vì `getSession` không kiểm lại `banned`.

Create `lib/server/auth/staff.ts`:

```ts
import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { isAPIError } from 'better-auth/api';
import type { Pool, PoolClient } from 'pg';
import { insertAudit, withTransaction, type AuditActor } from '@/lib/server/audit';
import { describeEmailError } from '@/lib/server/email/types';
import { INVITATION_REQUIRED, type Auth } from './config';
import type { StaffRole } from './permissions';
import { normalizeEmail } from './signup-gate';

/*
 * Staff management (spec §7.1). Callers are Server Actions that already ran
 * requirePermission and zod; everything here takes its dependencies as
 * arguments so the integration tests drive it without Next.
 *
 * Role changes, bans and removals do NOT go through auth.api.setRole/banUser/
 * removeUser: those commit on Better Auth's own connection, outside our
 * transaction (test/integration/better-auth.test.ts proves it), so the audit
 * row and the last-Admin check could not commit atomically with them. The SQL
 * below is the write those endpoints make. Never call auth.api.* while holding
 * a client from withTransaction: it is not atomic and the pool has 5 slots.
 */

export type InviteEmail = { to: string; token: string; invitationId: string; role: StaffRole; inviterName: string };
export type SendInvite = (email: InviteEmail) => Promise<unknown>;
export type StaffDeps = { pool: Pool; auth: Auth; sendInvite: SendInvite };
type Fail<C extends string> = { ok: false; code: C };

export const INVITE_TTL = '7 days';
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 32 random bytes as base64url (43 characters); only the hash is stored. */
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

/** Sends after the commit; a failure is stored in email_error, never thrown (spec §7.1 step 5). */
async function deliverInvite(
  deps: StaffDeps,
  invitation: { id: string; email: string; role: StaffRole },
  token: string,
  actor: AuditActor,
): Promise<boolean> {
  try {
    await deps.sendInvite({
      to: invitation.email,
      token,
      invitationId: invitation.id,
      role: invitation.role,
      inviterName: actor.name ?? actor.email,
    });
    await deps.pool.query('UPDATE staff_invitation SET email_error = NULL WHERE id = $1', [invitation.id]);
    return true;
  } catch (err) {
    const emailError = describeEmailError(err);
    console.error('[staff] invite email failed', { id: invitation.id, code: emailError.split(':')[0] });
    await deps.pool.query('UPDATE staff_invitation SET email_error = $2 WHERE id = $1', [invitation.id, emailError]);
    return false;
  }
}

export async function createInvitation(
  deps: StaffDeps,
  actor: AuditActor,
  input: { email: string; role: StaffRole },
): Promise<{ ok: true; id: string; emailSent: boolean } | Fail<'already_staff' | 'already_invited'>> {
  const email = normalizeEmail(input.email);
  const { token, hash } = newInviteToken();

  const created = await withTransaction(deps.pool, async (c) => {
    const staff = await c.query('SELECT 1 FROM staff_user WHERE email = $1', [email]);
    if (staff.rowCount) return { ok: false as const, code: 'already_staff' as const };
    // An expired invitation still holds the one-open-per-email index; close it first.
    await c.query(
      `UPDATE staff_invitation SET revoked_at = now()
        WHERE email = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at <= now()`,
      [email],
    );
    const { rows } = await c.query<{ id: string; expires_at: Date }>(
      `INSERT INTO staff_invitation (email, role, token_hash, expires_at, invited_by)
       VALUES ($1, $2, $3, now() + $4::interval, $5)
       ON CONFLICT (email) WHERE used_at IS NULL AND revoked_at IS NULL DO NOTHING
       RETURNING id::text, expires_at`,
      [email, input.role, hash, INVITE_TTL, actor.id],
    );
    const row = rows[0];
    if (!row) return { ok: false as const, code: 'already_invited' as const };
    await insertAudit(c, actor, {
      action: 'staff.invite',
      entityType: 'staff_invitation',
      entityId: row.id,
      after: { email, role: input.role, expires_at: row.expires_at },
    });
    return { ok: true as const, id: row.id };
  });
  if (!created.ok) return created;

  const emailSent = await deliverInvite(deps, { id: created.id, email, role: input.role }, token, actor);
  return { ok: true, id: created.id, emailSent };
}

/** "Gửi lại": a new token and a fresh 7 days; the old link stops working. Revives an expired invitation. */
export async function resendInvitation(
  deps: StaffDeps,
  actor: AuditActor,
  id: string,
): Promise<{ ok: true; emailSent: boolean } | Fail<'not_found'>> {
  const { token, hash } = newInviteToken();
  const updated = await withTransaction(deps.pool, async (c) => {
    const { rows } = await c.query<{ email: string; role: StaffRole; expires_at: Date }>(
      `UPDATE staff_invitation
          SET token_hash = $2, expires_at = now() + $3::interval
        WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL
        RETURNING email, role, expires_at`,
      [id, hash, INVITE_TTL],
    );
    const row = rows[0];
    if (!row) return null;
    await insertAudit(c, actor, {
      action: 'staff.invite_resend',
      entityType: 'staff_invitation',
      entityId: id,
      after: { email: row.email, role: row.role, expires_at: row.expires_at },
    });
    return row;
  });
  if (!updated) return { ok: false, code: 'not_found' };
  return { ok: true, emailSent: await deliverInvite(deps, { id, email: updated.email, role: updated.role }, token, actor) };
}

export async function revokeInvitation(
  deps: StaffDeps,
  actor: AuditActor,
  id: string,
): Promise<{ ok: true } | Fail<'not_found'>> {
  return withTransaction(deps.pool, async (c) => {
    const { rows } = await c.query<{ email: string; role: StaffRole }>(
      `UPDATE staff_invitation SET revoked_at = now()
        WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL
        RETURNING email, role`,
      [id],
    );
    if (!rows[0]) return { ok: false as const, code: 'not_found' as const };
    await insertAudit(c, actor, {
      action: 'staff.invite_revoke',
      entityType: 'staff_invitation',
      entityId: id,
      before: rows[0],
    });
    return { ok: true as const };
  });
}

/** The invitation a token opens, for the accept page. Never says why a token is bad. */
export async function findOpenInvitation(
  pool: Pool,
  token: string,
): Promise<{ id: string; email: string; role: StaffRole } | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { rows } = await pool.query<{ id: string; email: string; role: StaffRole }>(
    `SELECT id::text, email, role FROM staff_invitation
      WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

/**
 * Creates the account (auth.api.createUser without headers: a trusted server
 * call, and the invitation gate in databaseHooks checks again), then marks the
 * invitation used together with its audit row. The caller signs the new member
 * in. Two racing accepts of one token: the unique email lets one createUser
 * through. If the "mark used" write fails after createUser, the link answers
 * already_staff from then on and closes the invitation, and removeStaff closes
 * it too, so it can never recreate a removed account.
 */
export async function acceptInvitation(
  deps: StaffDeps,
  input: { token: string; name: string; password: string },
  ip: string | null = null,
): Promise<{ ok: true; userId: string; email: string } | Fail<'invalid_token' | 'already_staff'>> {
  const invitation = await findOpenInvitation(deps.pool, input.token);
  if (!invitation) return { ok: false, code: 'invalid_token' };

  let user: { id: string; email: string };
  try {
    ({ user } = await deps.auth.api.createUser({
      // Opening the emailed link proves the address.
      body: {
        email: invitation.email,
        password: input.password,
        name: input.name,
        role: invitation.role,
        data: { emailVerified: true },
      },
    }));
  } catch (err) {
    if (isAPIError(err) && err.body?.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
      // The account exists, so this invitation is spent. (A racing winner's own
      // UPDATE then matches no row; it still writes its audit row.)
      await deps.pool.query(
        'UPDATE staff_invitation SET used_at = now() WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL',
        [invitation.id],
      );
      return { ok: false, code: 'already_staff' };
    }
    // Revoked or expired between the lookup and the insert.
    if (isAPIError(err) && err.body?.code === INVITATION_REQUIRED) return { ok: false, code: 'invalid_token' };
    throw err;
  }

  await withTransaction(deps.pool, async (c) => {
    await c.query('UPDATE staff_invitation SET used_at = now() WHERE id = $1 AND used_at IS NULL', [invitation.id]);
    await insertAudit(
      c,
      { id: user.id, email: user.email, ip },
      {
        action: 'staff.invite_accept',
        entityType: 'staff_user',
        entityId: user.id,
        after: { email: invitation.email, role: invitation.role, invitation_id: invitation.id },
      },
    );
  });
  return { ok: true, userId: user.id, email: invitation.email };
}

/**
 * Locks every Admin row, always in id order, so two concurrent demotions, bans
 * or removals cannot both see "another Admin remains". Every function below
 * takes this lock first, then the target row.
 */
async function lockAdmins(c: PoolClient): Promise<void> {
  await c.query(`SELECT id FROM staff_user WHERE role = 'admin' ORDER BY id FOR UPDATE`);
}

/** Admins other than `userId` who can still sign in. */
async function otherActiveAdmins(c: PoolClient, userId: string): Promise<number> {
  const { rows } = await c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM staff_user WHERE role = 'admin' AND id <> $1 AND banned IS NOT TRUE`,
    [userId],
  );
  return rows[0]?.n ?? 0;
}

type Target = { id: string; email: string; name: string; role: StaffRole; banned: boolean | null };

async function lockTarget(c: PoolClient, userId: string): Promise<Target | undefined> {
  await lockAdmins(c);
  const { rows } = await c.query<Target>(
    'SELECT id, email, name, role, banned FROM staff_user WHERE id = $1 FOR UPDATE',
    [userId],
  );
  return rows[0];
}

const isLastAdmin = async (c: PoolClient, target: Target) =>
  target.role === 'admin' && (await otherActiveAdmins(c, target.id)) === 0;

export async function setStaffRole(
  pool: Pool,
  actor: AuditActor,
  input: { userId: string; role: StaffRole },
): Promise<{ ok: true; changed: boolean } | Fail<'not_found' | 'last_admin'>> {
  return withTransaction(pool, async (c) => {
    const target = await lockTarget(c, input.userId);
    if (!target) return { ok: false as const, code: 'not_found' as const };
    if (target.role === input.role) return { ok: true as const, changed: false };
    if (await isLastAdmin(c, target)) return { ok: false as const, code: 'last_admin' as const };
    // The write auth.api.setRole makes; the next getSession reads it (no cookie cache).
    await c.query('UPDATE staff_user SET role = $2, updated_at = now() WHERE id = $1', [target.id, input.role]);
    await insertAudit(c, actor, {
      action: 'staff.role',
      entityType: 'staff_user',
      entityId: target.id,
      before: { role: target.role },
      after: { role: input.role },
    });
    return { ok: true as const, changed: true };
  });
}

/** "Khóa": the member can no longer sign in, and every session they hold ends now. */
export async function banStaff(
  pool: Pool,
  actor: AuditActor,
  userId: string,
): Promise<{ ok: true; changed: boolean } | Fail<'not_found' | 'last_admin' | 'self'>> {
  if (userId === actor.id) return { ok: false, code: 'self' };
  return withTransaction(pool, async (c) => {
    const target = await lockTarget(c, userId);
    if (!target) return { ok: false as const, code: 'not_found' as const };
    if (target.banned) return { ok: true as const, changed: false };
    if (await isLastAdmin(c, target)) return { ok: false as const, code: 'last_admin' as const };
    // The writes auth.api.banUser makes: getSession does not re-check `banned`, so the sessions must go.
    await c.query('UPDATE staff_user SET banned = true, updated_at = now() WHERE id = $1', [target.id]);
    await c.query('DELETE FROM staff_session WHERE user_id = $1', [target.id]);
    await insertAudit(c, actor, {
      action: 'staff.ban',
      entityType: 'staff_user',
      entityId: target.id,
      before: { banned: false },
      after: { banned: true },
    });
    return { ok: true as const, changed: true };
  });
}

/** "Mở khóa". */
export async function unbanStaff(
  pool: Pool,
  actor: AuditActor,
  userId: string,
): Promise<{ ok: true; changed: boolean } | Fail<'not_found'>> {
  return withTransaction(pool, async (c) => {
    const target = await lockTarget(c, userId);
    if (!target) return { ok: false as const, code: 'not_found' as const };
    if (!target.banned) return { ok: true as const, changed: false };
    await c.query(
      'UPDATE staff_user SET banned = false, ban_reason = NULL, ban_expires = NULL, updated_at = now() WHERE id = $1',
      [target.id],
    );
    await insertAudit(c, actor, {
      action: 'staff.unban',
      entityType: 'staff_user',
      entityId: target.id,
      before: { banned: true },
      after: { banned: false },
    });
    return { ok: true as const, changed: true };
  });
}

export async function removeStaff(
  pool: Pool,
  actor: AuditActor,
  userId: string,
): Promise<{ ok: true } | Fail<'not_found' | 'last_admin' | 'self'>> {
  if (userId === actor.id) return { ok: false, code: 'self' };
  return withTransaction(pool, async (c) => {
    const target = await lockTarget(c, userId);
    if (!target) return { ok: false as const, code: 'not_found' as const };
    if (await isLastAdmin(c, target)) return { ok: false as const, code: 'last_admin' as const };
    // An invitation still open for this address (its "mark used" write failed)
    // would let the old link recreate the account; the address needs a new invitation.
    await c.query(
      `UPDATE staff_invitation SET revoked_at = now()
        WHERE email = $1 AND used_at IS NULL AND revoked_at IS NULL`,
      [target.email],
    );
    // Sessions and accounts go with it (ON DELETE CASCADE), as in auth.api.removeUser.
    await c.query('DELETE FROM staff_user WHERE id = $1', [target.id]);
    await insertAudit(c, actor, {
      action: 'staff.remove',
      entityType: 'staff_user',
      entityId: target.id,
      before: { email: target.email, name: target.name, role: target.role },
    });
    return { ok: true as const };
  });
}
```

- [ ] **Bước 5: Chạy lại test**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/staff-auth.test.ts`
Expected: PASS `Tests  17 passed (17)`. Hai test "removing the member closes an invitation left open, so its link cannot recreate the account" và "reopening a link whose account exists answers already_staff and closes the invitation" dựng lại tình trạng mà `acceptInvitation` để lại khi `createUser` xong nhưng lệnh đánh dấu đã dùng lỗi (tạo tài khoản bằng `auth.api.createUser` mà không đánh dấu). Bỏ lệnh thu hồi trong `removeStaff` và lệnh đặt `used_at` trong nhánh `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` thì cả hai đỏ (`Tests  2 failed | 15 passed (17)`): link cũ tạo lại tài khoản (`{ ok: true, … }` thay cho `invalid_token`), và `findOpenInvitation` vẫn trả lời mời.

- [ ] **Bước 6: Chạy cổng kiểm tra**

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

Expected: typecheck sạch; lint 0 lỗi, 18 cảnh báo; `Test Files  26 passed (26)`, `Tests  252 passed (252)`; build thoát 0, bảng route không đổi (`○ /en`, `○ /en/restaurants/taya-house`); check-prerender in `Prerender check passed …` và `Font check passed …`; E2E `33 passed`; visual `8 passed`.

- [ ] **Bước 7: Commit**

```bash
git add lib/server/audit.ts lib/server/auth/staff.ts test/integration/staff-auth.test.ts
git commit -m "$(cat <<'EOF'
feat: invite, accept, ban and remove staff with an audit row in the same transaction

lib/server/audit.ts is the audit half of the save flow (spec §7.4):
withTransaction plus insertAudit on the same client, so a failed audit insert
rolls the change back. The actor is a snapshot (id, email, a validated ip).

lib/server/auth/staff.ts owns the invitation lifecycle: a 32-byte token whose
SHA-256 alone is stored, 7 days, one open invitation per email, "Gửi lại"
rotating the token in place and "Thu hồi" closing it. The email goes out after
COMMIT; a failure is stored in email_error and never undoes the invitation.
Accepting creates the account through auth.api.createUser (the invitation
gate checks again) and marks the link used with its audit row. A link whose
account already exists is closed when reopened, and removing a member revokes
any invitation still open for the address, so no link can recreate a removed
account.

Role changes, ban, unban and removal are our own SQL inside one transaction:
lock the Admin rows in id order, refuse to leave no active Admin, write, audit.
Ban also deletes the member's sessions, since getSession does not re-check it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 5: Script tạo Admin đầu tiên

Task này chỉ cần Task 2; có thể chạy song song với Task 3–4.

**Files:**
- Modify: `package.json`, `package-lock.json`, `README.md`
- Create: `scripts/create-admin.mjs`
- Test: `test/integration/create-admin.test.ts`

**Interfaces:**
- Consumes: `createAuth`, `INVITATION_REQUIRED` (Task 2), nạp qua jiti; helper `STAFF_TABLES`, `TEST_SECRET` (Task 2).
- Produces: `node scripts/create-admin.mjs` đọc `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_PASSWORD` (hoặc hỏi ẩn), `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`; thoát 0 với `Admin created: <email> (<id>)`, thoát 1 với `create-admin: <lý do>`. Không đọc file `.env` nào.

- [ ] **Bước 1: Cài jiti**

```bash
npm i -D jiti@2.7.0
```

Expected: `found 0 vulnerabilities`; `git diff package.json`:

```diff
diff --git a/package.json b/package.json
index 762038e..a632b99 100644
--- a/package.json
+++ b/package.json
@@ -35,6 +35,7 @@
     "@types/react-dom": "^19.3.0",
     "auth": "^1.7.7",
     "dotenv-cli": "^11.0.0",
+    "jiti": "^2.7.0",
     "oxlint": "^1.86.0",
     "typescript": "^7.0.2",
     "vitest": "^5.0.3"
```

- [ ] **Bước 2: Viết test chạy script như người vận hành chạy nó**

Script chạy trong một tiến trình riêng với env tường minh. `NODE_ENV=production` là chế độ khắt khe nhất của Better Auth. Kiểu `ProcessEnv` của Next bắt buộc có `NODE_ENV`, nên thiếu nó thì typecheck và build đều đỏ.

Create `test/integration/create-admin.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from '../helpers/db';
import { STAFF_TABLES, TEST_SECRET } from '../helpers/auth';

/*
 * scripts/create-admin.mjs, run the way an operator runs it: a separate node
 * process with an explicit environment (it reads no .env file).
 */

let pool: Pool;

function run(env: Record<string, string>) {
  const result = spawnSync(process.execPath, ['scripts/create-admin.mjs'], {
    encoding: 'utf8',
    env: {
      // What node, jiti's cache and pg's default user need; nothing else leaks in.
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      USER: process.env.USER ?? '',
      TMPDIR: process.env.TMPDIR ?? '',
      // As strict as it gets: Better Auth refuses weak setups in production.
      NODE_ENV: 'production',
      DATABASE_URL: TEST_DATABASE_URL ?? '',
      BETTER_AUTH_SECRET: TEST_SECRET,
      BETTER_AUTH_URL: 'http://localhost:3000',
      BOOTSTRAP_ADMIN_NAME: 'Chủ quán',
      BOOTSTRAP_ADMIN_PASSWORD: 'correct horse battery',
      ...env,
    },
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

describe.skipIf(!TEST_DATABASE_URL)('scripts/create-admin.mjs', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await pool.query(`TRUNCATE ${STAFF_TABLES} CASCADE`);
  });
  afterAll(async () => {
    await pool.query(`TRUNCATE ${STAFF_TABLES} CASCADE`);
    await pool.end();
  });

  it('creates the first Admin, verified, with a staff.bootstrap audit row', async () => {
    const { status, out } = run({ BOOTSTRAP_ADMIN_EMAIL: 'Owner@Furama.test' });
    expect(out).toContain('Admin created: owner@furama.test');
    expect(status).toBe(0);
    const { rows } = await pool.query(
      `SELECT u.name, u.role, u.email_verified, a.action, a.actor_id = u.id AS self
         FROM staff_user u JOIN audit_log a ON a.entity_id = u.id`,
    );
    expect(rows).toEqual([{ name: 'Chủ quán', role: 'admin', email_verified: true, action: 'staff.bootstrap', self: true }]);
  });

  it('refuses the same email again', () => {
    const { status, out } = run({ BOOTSTRAP_ADMIN_EMAIL: 'owner@furama.test' });
    expect(status).toBe(1);
    expect(out).toContain('refused: owner@furama.test already has an account.');
  });

  it('refuses a second Admin once one exists', async () => {
    const { status, out } = run({ BOOTSTRAP_ADMIN_EMAIL: 'second@furama.test' });
    expect(status).toBe(1);
    expect(out).toContain('refused: an Admin already exists, or the email is not BOOTSTRAP_ADMIN_EMAIL.');
    expect((await pool.query('SELECT count(*)::int AS n FROM staff_user')).rows[0].n).toBe(1);
  });

  it('refuses a password shorter than 12 characters before touching the database', () => {
    const { status, out } = run({ BOOTSTRAP_ADMIN_EMAIL: 'short@furama.test', BOOTSTRAP_ADMIN_PASSWORD: '11 chars ok' });
    expect(status).toBe(1);
    expect(out).toContain('The password must be 12–128 characters.');
    expect(out).not.toContain('Creating Admin');
  });

  it('refuses to run without BETTER_AUTH_SECRET', () => {
    const { status, out } = run({ BOOTSTRAP_ADMIN_EMAIL: 'x@furama.test', BETTER_AUTH_SECRET: '' });
    expect(status).toBe(1);
    expect(out).toContain('BETTER_AUTH_SECRET is not set.');
  });
});
```

- [ ] **Bước 3: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/create-admin.test.ts`
Expected: FAIL `Tests  5 failed (5)`:

```
     × creates the first Admin, verified, with a staff.bootstrap audit row
     × refuses the same email again
     × refuses a second Admin once one exists
     × refuses a password shorter than 12 characters before touching the database
     × refuses to run without BETTER_AUTH_SECRET
AssertionError: expected 'node:internal/modules/cjs/loader:1386…' to contain 'Admin created: owner@furama.test'
```

- [ ] **Bước 4: Viết script**

Create `scripts/create-admin.mjs`:

```js
#!/usr/bin/env node
/**
 * Creates the first Admin (spec §7.1), once.
 *
 *   BOOTSTRAP_ADMIN_EMAIL=owner@example.com BOOTSTRAP_ADMIN_NAME="Owner" \
 *   DATABASE_URL=… BETTER_AUTH_SECRET=… BETTER_AUTH_URL=… node scripts/create-admin.mjs
 *
 * The password comes from BOOTSTRAP_ADMIN_PASSWORD or a hidden prompt. The
 * script goes through auth.api.createUser, so the invitation gate in
 * databaseHooks decides: it admits BOOTSTRAP_ADMIN_EMAIL only while no Admin
 * exists, which makes a second run fail instead of creating another Admin.
 * It loads the shared config (lib/server/auth/config.ts) with jiti; nothing
 * here reads .env files: pass the environment explicitly (README, "Admin đầu
 * tiên"). BOOTSTRAP_ADMIN_EMAIL belongs in that one shell, never in Vercel.
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import pg from 'pg';

const root = fileURLToPath(new URL('..', import.meta.url));

function fail(message) {
  console.error(`create-admin: ${message}`);
  process.exit(1);
}

const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Admin';
const connectionString = process.env.DATABASE_URL;
if (!email) fail('BOOTSTRAP_ADMIN_EMAIL is not set.');
if (!connectionString) fail('DATABASE_URL is not set.');
if (!process.env.BETTER_AUTH_SECRET) fail('BETTER_AUTH_SECRET is not set.');

// Same TLS rule as db/client.ts: full verification except for local databases.
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) url.searchParams.set('sslmode', 'verify-full');

async function promptHidden(question) {
  // Echo the question, not the keystrokes: readline writes into a stream that drops everything.
  process.stdout.write(question);
  const muted = new Writable({ write: (_chunk, _encoding, done) => done() });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  const answer = await new Promise((resolve) => rl.question('', resolve));
  rl.close();
  process.stdout.write('\n');
  return answer;
}

const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? (await promptHidden(`Password for ${email}: `));
// auth.api.createUser only checks the maximum length; the minimum is ours (config.ts: 12).
if (password.length < 12 || password.length > 128) fail('The password must be 12–128 characters.');

const jiti = createJiti(import.meta.url, { alias: { '@/': root } });
const { createAuth, INVITATION_REQUIRED } = await jiti.import('../lib/server/auth/config.ts');

console.log(`Creating Admin ${email} on ${url.hostname}${url.pathname}`);
const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
const auth = createAuth({
  pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  bootstrapAdminEmail: email,
  sendResetPassword: async () => {},
});

try {
  // Verified like an accepted invitee: the operator vouches for the address.
  const { user } = await auth.api.createUser({ body: { email, password, name, role: 'admin', data: { emailVerified: true } } });
  await pool.query(
    `INSERT INTO audit_log (actor_id, actor_email, action, entity_type, entity_id, after)
     VALUES ($1, $2, 'staff.bootstrap', 'staff_user', $1, $3)`,
    [user.id, user.email, JSON.stringify({ email: user.email, role: 'admin' })],
  );
  console.log(`Admin created: ${user.email} (${user.id})`);
} catch (err) {
  const code = err?.body?.code;
  if (code === INVITATION_REQUIRED) fail('refused: an Admin already exists, or the email is not BOOTSTRAP_ADMIN_EMAIL.');
  if (code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') fail(`refused: ${email} already has an account.`);
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await pool.end();
}
```

- [ ] **Bước 5: Chạy lại test**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/create-admin.test.ts`
Expected: PASS `Tests  5 passed (5)`

Kiểm thêm đường hỏi mật khẩu (stdin không phải TTY vẫn đọc một dòng) trên bảng trống, rồi dọn bảng:

```bash
psql -h localhost -d furama_cuisine_test -qc "TRUNCATE staff_user, staff_invitation, audit_log, auth_rate_limit, staff_verification CASCADE"
echo 'correct horse battery' | env -i PATH=$PATH HOME=$HOME USER=$USER TMPDIR=$TMPDIR DATABASE_URL=postgres://localhost:5432/furama_cuisine_test BETTER_AUTH_SECRET=test-secret-0123456789abcdef0123456789abcdef BOOTSTRAP_ADMIN_EMAIL=prompt@furama.test node scripts/create-admin.mjs
psql -h localhost -d furama_cuisine_test -qc "TRUNCATE staff_user, staff_invitation, audit_log, auth_rate_limit, staff_verification CASCADE"
```

Expected: `Password for prompt@furama.test: ` (phím gõ không hiện), `Creating Admin prompt@furama.test on localhost/furama_cuisine_test`, `Admin created: prompt@furama.test (…)`.

- [ ] **Bước 6: Ghi cách tạo Admin đầu tiên vào README**

Sửa `README.md`: thêm mục "First Admin" ngay trước `## Routes`, đúng như diff:

````diff
diff --git a/README.md b/README.md
index 73f43e8..6b1f0d5 100644
--- a/README.md
+++ b/README.md
@@ -96,6 +96,24 @@ point at dev). Run
 `DATABASE_URL_UNPOOLED=<production direct URL> node scripts/migrate.mjs`
 deliberately, after the dev branch has been migrated and verified.
 
+### First Admin
+
+Staff accounts exist only by invitation (spec §7.1); the one exception is the
+first Admin, created once per environment by `scripts/create-admin.mjs`. It
+goes through the same invitation gate, which admits `BOOTSTRAP_ADMIN_EMAIL`
+only while no Admin exists, so a second run is refused. The script reads no
+`.env` file: give it the target environment's variables explicitly, and set
+`BOOTSTRAP_ADMIN_*` in that one shell only, never in Vercel.
+
+```bash
+BOOTSTRAP_ADMIN_EMAIL=owner@furamavietnam.com BOOTSTRAP_ADMIN_NAME='Chủ quán' \
+  npx dotenv -e <file with that branch's DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL> -- \
+  node scripts/create-admin.mjs
+```
+
+It asks for the password (12–128 characters) unless `BOOTSTRAP_ADMIN_PASSWORD`
+is set, and writes a `staff.bootstrap` row to `audit_log`.
+
 ## Routes
 
 | Route | Rendering | Notes |
````

- [ ] **Bước 7: Chạy cổng kiểm tra**

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

Expected: typecheck sạch; lint 0 lỗi, 19 cảnh báo (cảnh báo mới duy nhất: `scripts/create-admin.mjs … import(no-named-as-default-member): "pg" also has a named export "Pool"`, cùng kiểu `scripts/migrate.mjs`); `Test Files  27 passed (27)`, `Tests  257 passed (257)`; build thoát 0, bảng route không đổi (`○ /en`, `○ /en/restaurants/taya-house`); check-prerender in `Prerender check passed …` và `Font check passed …`; E2E `33 passed`; visual `8 passed`.

- [ ] **Bước 8: Commit**

```bash
git add package.json package-lock.json scripts/create-admin.mjs test/integration/create-admin.test.ts README.md
git commit -m "$(cat <<'EOF'
feat: add the script that creates the first Admin

scripts/create-admin.mjs loads the shared Better Auth config through jiti and
calls auth.api.createUser, so the invitation gate decides: it admits
BOOTSTRAP_ADMIN_EMAIL only while no Admin exists, and a second run is refused.
It reads no .env file (the CLI's habit of loading .env.local is exactly what
must not happen here), checks the 12-128 character password itself because
createUser checks only the maximum, marks the address verified like an
accepted invitee, and writes a staff.bootstrap audit row.

The integration test runs it as a separate process with an explicit
environment. README: how to run it once per environment.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 6: Root layout admin, CSP có nonce và cổng cookie trong proxy (chưa nối đăng nhập)

Task này chỉ cần Task 1 (`better-auth/cookies`); có thể chạy song song với Task 2–5, nhưng phải xong trước Task 7. Từ đây web khách có hai file đổi, nên visual ở ngưỡng 0 là bằng chứng chính rằng `/en` không đổi.

**Files:**
- Create: `lib/admin/csp.ts`, `lib/admin/csp.test.ts`, `lib/admin/paths.ts`, `lib/admin/paths.test.ts`
- Modify: `proxy.ts`; Create: `proxy.test.ts`; Modify: `lib/i18n/proxy-matcher.test.ts`
- Modify: `scripts/check-prerender.mjs`; Create: `lib/admin/admin-pages.guard.test.ts`
- Create: `app/admin/layout.tsx`, `app/admin/not-found.tsx`, `app/admin/[...missing]/page.tsx`, `app/admin/(auth)/layout.tsx`, `app/admin/(auth)/sign-in/page.tsx`, `styles/admin.css`
- Modify: `app/(site)/[lang]/layout.tsx`, `app/(site)/[lang]/(guarded)/layout.tsx`
- Create: `e2e/csp.ts`, `e2e/admin-security.spec.ts`

**Interfaces:**
- Consumes: `getSessionCookie` từ `better-auth/cookies`; `fontVariables` từ `lib/fonts`; `pickLocale`, `ENABLED_LOCALES`, `LOCALE_COOKIE`, `DEFAULT_LOCALE` từ `lib/i18n/locales`.
- Produces:
  - `lib/admin/csp.ts`: `createNonce(): string`, `type CspOptions = { dev: boolean; https: boolean }`, `adminContentSecurityPolicy(nonce: string, options: CspOptions): string`, `adminSecurityHeaders(csp: string): Record<string, string>`.
  - `lib/admin/paths.ts`: `ADMIN_HOME = '/admin'`, `ADMIN_SIGN_IN = '/admin/sign-in'`, `PUBLIC_ADMIN_PATHS`, `isAdminPath(pathname)`, `isPublicAdminPath(pathname)`, `safeAdminNext(value: unknown): string`.
  - `styles/admin.css`: các class `a-*` (khung, nút `a-btn`, ô nhập `a-field`, `a-alert`, `a-card`, `a-auth`, `a-table`); Task 9 và 10 thêm vào cuối file.
  - `e2e/csp.ts`: `watchCsp(page): Promise<string[]>`, `expectHydrated(page): Promise<void>`.

- [ ] **Bước 1: Viết test cho CSP**

Create `lib/admin/csp.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { adminContentSecurityPolicy, adminSecurityHeaders, createNonce } from './csp';

const directives = (csp: string) => Object.fromEntries(csp.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)]));

describe('createNonce', () => {
  it('is 128 random bits in the alphabet Next accepts', () => {
    const n = createNonce();
    expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(new Set(Array.from({ length: 50 }, createNonce)).size).toBe(50);
  });
});

describe('adminContentSecurityPolicy', () => {
  it('production: nonce + strict-dynamic for scripts, nonce for styles, nothing inline or eval', () => {
    const csp = adminContentSecurityPolicy('abc', { dev: false, https: true });
    const d = directives(csp);
    expect(d['script-src']).toEqual(["'self'", "'nonce-abc'", "'strict-dynamic'"]);
    expect(d['style-src']).toEqual(["'self'", "'nonce-abc'"]);
    expect(csp).not.toMatch(/unsafe-(inline|eval)/);
    expect(d['frame-ancestors']).toEqual(["'none'"]);
    expect(d['form-action']).toEqual(["'self'"]);
    expect(d['base-uri']).toEqual(["'none'"]);
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['img-src']).toEqual(["'self'", 'data:', 'blob:']);
    expect(d['upgrade-insecure-requests']).toEqual([]);
  });

  it('http (localhost) never asks the browser to upgrade requests', () => {
    expect(adminContentSecurityPolicy('abc', { dev: false, https: false })).not.toContain('upgrade-insecure-requests');
  });

  it('next dev: eval for React error overlays, inline styles for the dev overlay', () => {
    const d = directives(adminContentSecurityPolicy('abc', { dev: true, https: false }));
    expect(d['script-src']).toEqual(["'self'", "'nonce-abc'", "'strict-dynamic'", "'unsafe-eval'"]);
    expect(d['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it('is what Next parses the nonce from (script-src, first nonce)', () => {
    const csp = adminContentSecurityPolicy('Zm9v+/_-==', { dev: false, https: false });
    const directive = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith('script-src'))!;
    expect(directive.split(/\s+/).find((s) => /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/.test(s))).toBe("'nonce-Zm9v+/_-=='");
  });
});

describe('adminSecurityHeaders', () => {
  it('denies framing and indexing, keeps the referrer on the site', () => {
    expect(adminSecurityHeaders('x')).toEqual({
      'Content-Security-Policy': 'x',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
  });
});
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `npx vitest run lib/admin/csp.test.ts`
Expected: FAIL `Error: Cannot find module './csp' imported from …/lib/admin/csp.test.ts`

- [ ] **Bước 3: Viết CSP**

Next đọc nonce từ header `Content-Security-Policy` **của request** và gắn nó vào mọi `<script>` của mình (`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md:179-193`; `node_modules/next/dist/server/app-render/app-render.js:209-210` lấy từ `script-src`, nếu không có thì `default-src`).

Create `lib/admin/csp.ts`:

```ts
/*
 * Response headers for every /admin page (spec §11). proxy.ts builds them per
 * request: the nonce must be new for each response, which is why the admin
 * renders at request time (app/admin/layout.tsx) and the guest site, which is
 * prerendered, never gets this policy.
 *
 * Next.js reads the nonce back from the Content-Security-Policy *request*
 * header and puts it on its own <script> tags
 * (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md:179-193;
 * node_modules/next/dist/server/app-render/app-render.js:209-210 takes it from
 * script-src, else default-src).
 */

/** 128 random bits, base64. Next only accepts [A-Za-z0-9+/_-] and '=' padding. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export type CspOptions = {
  /** `next dev`: React needs eval for its error overlay; the dev overlay injects <style> tags. */
  dev: boolean;
  /** Only an https origin may tell the browser to upgrade subresources (it would break http://localhost). */
  https: boolean;
};

export function adminContentSecurityPolicy(nonce: string, { dev, https }: CspOptions): string {
  return [
    "default-src 'self'",
    // 'strict-dynamic': chunks that Next's nonced runtime loads are trusted too; 'self' is a CSP2 fallback.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Stylesheets are files (CSS modules, admin.css, next/font); no inline <style> and no style="" in admin markup.
    dev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/** Every header an admin page response carries, the CSP included. */
export function adminSecurityHeaders(csp: string): Record<string, string> {
  return {
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
    // Invite and reset links carry their token in the URL: never send it to another site.
    // (no-referrer would also do; Server Actions still get a real Origin under it in Chromium.)
    'Referrer-Policy': 'same-origin',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}
```

Run: `npx vitest run lib/admin/csp.test.ts`
Expected: PASS `Tests  6 passed (6)`

- [ ] **Bước 4: Viết test cho đường dẫn admin**

Create `lib/admin/paths.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isAdminPath, isPublicAdminPath, safeAdminNext } from './paths';

describe('isAdminPath / isPublicAdminPath', () => {
  it.each([
    ['/admin', true],
    ['/admin/users', true],
    ['/administrator', false],
    ['/en/admin', false],
  ])('%s → %s', (p, expected) => expect(isAdminPath(p)).toBe(expected));

  it('only the three auth pages are public, matched exactly', () => {
    expect(['/admin/sign-in', '/admin/accept-invite', '/admin/reset-password'].every(isPublicAdminPath)).toBe(true);
    expect(isPublicAdminPath('/admin')).toBe(false);
    expect(isPublicAdminPath('/admin/sign-in/x')).toBe(false);
  });
});

describe('safeAdminNext', () => {
  it.each([
    ['/admin/users', '/admin/users'],
    ['/admin/users?tab=moi', '/admin/users?tab=moi'],
    ['/admin/users?_rsc=1&tab=moi', '/admin/users?tab=moi'],
    ['/admin', '/admin'],
  ])('keeps %s', (input, out) => expect(safeAdminNext(input)).toBe(out));

  it.each([
    [undefined],
    [null],
    [''],
    ['admin/users'],
    ['//evil.example/admin'],
    ['/\\evil.example'],
    ['https://evil.example/admin'],
    ['/en'],
    ['/administrator'],
    ['/admin/sign-in'],
    ['/admin/../en'],
    ['/admin/%2e%2e/en'],
  ])('rejects %s → /admin', (input) => expect(safeAdminNext(input)).toBe('/admin'));
});
```

Run: `npx vitest run lib/admin/paths.test.ts`
Expected: FAIL `Error: Cannot find module './paths' imported from …/lib/admin/paths.test.ts`

- [ ] **Bước 5: Viết đường dẫn admin**

Create `lib/admin/paths.ts`:

```ts
/*
 * Admin URLs shared by proxy.ts (no server-only imports) and the sign-in action.
 */

export const ADMIN_HOME = '/admin';
export const ADMIN_SIGN_IN = '/admin/sign-in';

/** The only admin pages reachable without a session cookie (spec §6.1). */
export const PUBLIC_ADMIN_PATHS: readonly string[] = [ADMIN_SIGN_IN, '/admin/accept-invite', '/admin/reset-password'];

export function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_HOME || pathname.startsWith(`${ADMIN_HOME}/`);
}

export function isPublicAdminPath(pathname: string): boolean {
  return PUBLIC_ADMIN_PATHS.includes(pathname);
}

/**
 * Where to go after signing in. Only a path inside the admin is accepted, so
 * `?next=` cannot send a fresh session to another site (//evil.example,
 * https://…, /\evil) or loop back to a public page. Anything else → /admin.
 */
export function safeAdminNext(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return ADMIN_HOME;
  }
  const base = 'http://admin.invalid';
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return ADMIN_HOME;
  }
  if (url.origin !== base || !isAdminPath(url.pathname) || isPublicAdminPath(url.pathname)) return ADMIN_HOME;
  url.searchParams.delete('_rsc');
  return `${url.pathname}${url.search}`;
}
```

Run: `npx vitest run lib/admin/paths.test.ts`
Expected: PASS `Tests  21 passed (21)`

- [ ] **Bước 6: Viết test cho nhánh admin của proxy**

Create `proxy.test.ts` (ở gốc repo, cạnh `proxy.ts`):

```ts
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy } from '@/proxy';

const SESSION = 'better-auth.session_token';
const get = (path: string, init: { cookie?: string; headers?: Record<string, string> } = {}) =>
  proxy(
    new NextRequest(`http://localhost:3000${path}`, {
      headers: { ...(init.cookie ? { cookie: init.cookie } : {}), ...init.headers },
    }),
  );
const nonceOf = (csp: string | null) => /'nonce-([A-Za-z0-9+/_-]+={0,2})'/.exec(csp ?? '')?.[1];

describe('proxy: /admin without a session cookie', () => {
  it.each([
    ['/admin', '/admin/sign-in'],
    ['/admin/users', '/admin/sign-in?next=%2Fadmin%2Fusers'],
    ['/admin/users?tab=moi&x=1', '/admin/sign-in?next=%2Fadmin%2Fusers%3Ftab%3Dmoi%26x%3D1'],
    ['/admin?x=1', '/admin/sign-in?next=%2Fadmin%3Fx%3D1'],
    // The RSC request id of a client navigation is not part of where the user was going.
    ['/admin/users?_rsc=abc', '/admin/sign-in?next=%2Fadmin%2Fusers'],
  ])('%s → 307 %s', (path, location) => {
    const res = get(path);
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname + new URL(res.headers.get('location')!).search).toBe(location);
    expect(res.headers.get('content-security-policy')).toBeNull();
  });

  it.each(['/admin/sign-in', '/admin/accept-invite', '/admin/reset-password'])('%s is public', (path) => {
    const res = get(path);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(nonceOf(res.headers.get('content-security-policy'))).toBeTruthy();
  });

  it('a public page is matched exactly, not by prefix', () => {
    expect(get('/admin/sign-in-x').status).toBe(307);
    expect(get('/admin/reset-password/extra').status).toBe(307);
  });
});

describe('proxy: /admin with a session cookie', () => {
  it.each([SESSION, `__Secure-${SESSION}`])('passes with %s and sets the admin headers', (name) => {
    const res = get('/admin/users', { cookie: `${name}=abc.def` });
    expect(res.status).toBe(200);
    const csp = res.headers.get('content-security-policy');
    const nonce = nonceOf(csp);
    expect(nonce).toBeTruthy();
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.headers.get('referrer-policy')).toBe('same-origin');
    // Next reads the nonce back from the *request* header it forwards to the render.
    expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
  });

  it('makes a new nonce for every request', () => {
    const a = nonceOf(get('/admin', { cookie: `${SESSION}=x` }).headers.get('content-security-policy'));
    const b = nonceOf(get('/admin', { cookie: `${SESSION}=x` }).headers.get('content-security-policy'));
    expect(a).not.toBe(b);
  });

  it('ignores cookies with other names', () => {
    expect(get('/admin', { cookie: 'better-auth.session_data=x; other=y' }).status).toBe(307);
  });
});

describe('proxy: guest paths are untouched', () => {
  it('redirects an unprefixed path to a locale, with no admin headers', () => {
    const res = get('/restaurants?x=1', { headers: { 'accept-language': 'vi' } });
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/en/restaurants');
    expect(res.headers.get('vary')).toContain('Accept-Language');
    expect(res.headers.get('content-security-policy')).toBeNull();
    expect(res.headers.get('x-frame-options')).toBeNull();
  });
});
```

- [ ] **Bước 7: Chạy test, phải đỏ**

Run: `npx vitest run proxy.test.ts`
Expected: FAIL `Tests  13 failed | 1 passed (14)` (proxy hiện cho mọi `/admin` đi qua):

```
     × /admin → 307 /admin/sign-in
     × /admin/users → 307 /admin/sign-in?next=%2Fadmin%2Fusers
     …
     × ignores cookies with other names
AssertionError: expected 200 to be 307 // Object.is equality
AssertionError: expected undefined to be truthy
```

- [ ] **Bước 8: Thêm nhánh admin vào proxy**

Proxy chỉ đọc cookie, không bao giờ đọc DB (`node_modules/next/dist/docs/01-app/02-guides/authentication.md:1024-1033`, "optimistic checks"). Sửa `proxy.ts` đúng như diff:

```diff
diff --git a/proxy.ts b/proxy.ts
index c0881a7..bebdfd7 100644
--- a/proxy.ts
+++ b/proxy.ts
@@ -1,4 +1,7 @@
+import { getSessionCookie } from 'better-auth/cookies';
 import { NextResponse, type NextRequest } from 'next/server';
+import { adminContentSecurityPolicy, adminSecurityHeaders, createNonce } from '@/lib/admin/csp';
+import { ADMIN_SIGN_IN, isAdminPath, isPublicAdminPath } from '@/lib/admin/paths';
 import { ENABLED_LOCALES, LOCALE_COOKIE, pickLocale } from '@/lib/i18n/locales';
 
 /*
@@ -18,9 +21,8 @@ export const config = {
 
 export function proxy(request: NextRequest) {
   const { pathname } = request.nextUrl;
-  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
-    return NextResponse.next(); // phase 3: the session-cookie check
-  }
+  if (isAdminPath(pathname)) return adminProxy(request);
+
   const locale = pickLocale(
     request.cookies.get(LOCALE_COOKIE)?.value,
     request.headers.get('accept-language'),
@@ -33,3 +35,36 @@ export function proxy(request: NextRequest) {
   res.headers.append('Vary', 'Cookie, Accept-Language');
   return res;
 }
+
+/*
+ * /admin: an optimistic check only (authentication.md:1033 — the proxy reads
+ * the cookie, never the database). The cookie may be stale or forged, so every
+ * admin page and action still verifies the session itself.
+ */
+function adminProxy(request: NextRequest) {
+  const { pathname, search } = request.nextUrl;
+
+  // getSessionCookie knows Better Auth's names: better-auth.session_token, and
+  // __Secure-better-auth.session_token once the base URL is https.
+  if (!isPublicAdminPath(pathname) && !getSessionCookie(request)) {
+    const url = request.nextUrl.clone();
+    url.pathname = ADMIN_SIGN_IN;
+    url.search = '';
+    const next = new URLSearchParams(search);
+    next.delete('_rsc');
+    const query = next.toString();
+    if (pathname !== '/admin' || query) url.searchParams.set('next', `${pathname}${query ? `?${query}` : ''}`);
+    return NextResponse.redirect(url, 307);
+  }
+
+  const csp = adminContentSecurityPolicy(createNonce(), {
+    dev: process.env.NODE_ENV === 'development',
+    https: request.nextUrl.protocol === 'https:',
+  });
+  // Next takes the nonce from the request's CSP header and stamps it on its scripts.
+  const requestHeaders = new Headers(request.headers);
+  requestHeaders.set('Content-Security-Policy', csp);
+  const res = NextResponse.next({ request: { headers: requestHeaders } });
+  for (const [name, value] of Object.entries(adminSecurityHeaders(csp))) res.headers.set(name, value);
+  return res;
+}
```

Run: `npx vitest run proxy.test.ts`
Expected: PASS `Tests  14 passed (14)`

- [ ] **Bước 9: Ghim matcher cho các đường dẫn admin và `/api/auth`**

Matcher không đổi; các ca mới chỉ ghim hành vi. Sửa `lib/i18n/proxy-matcher.test.ts` đúng như diff:

```diff
diff --git a/lib/i18n/proxy-matcher.test.ts b/lib/i18n/proxy-matcher.test.ts
index 1ad29a6..e75617e 100644
--- a/lib/i18n/proxy-matcher.test.ts
+++ b/lib/i18n/proxy-matcher.test.ts
@@ -6,7 +6,20 @@ import { config } from '@/proxy';
 const m = (url: string) => matches({ config, url });
 
 describe('proxy matcher', () => {
-  it.each(['/', '/restaurants', '/restaurants/taya-house', '/anything', '/english', '/admin', '/admin/sign-in', '/admin/a/b'])(
+  it.each([
+    '/',
+    '/restaurants',
+    '/restaurants/taya-house',
+    '/anything',
+    '/english',
+    '/admin',
+    '/admin/sign-in',
+    '/admin/sign-in?next=%2Fadmin%2Fusers',
+    '/admin/accept-invite?token=abc',
+    '/admin/reset-password',
+    '/admin/users',
+    '/admin/a/b',
+  ])(
     'runs on %s',
     (u) => expect(m(u)).toBe(true),
   );
@@ -22,6 +35,9 @@ describe('proxy matcher', () => {
     '/pt-br/a',
     '/xx/nope',
     '/api/availability',
+    // Better Auth's HTTP endpoints never pass through the proxy (spec §7.1 blocks /api/auth/admin/* in the auth hooks instead).
+    '/api/auth/sign-in/email',
+    '/api/auth/admin/set-role',
     '/api',
     '/_next/static/a.js',
     '/_next/image',
```

Run: `npx vitest run lib/i18n/proxy-matcher.test.ts`
Expected: PASS `Tests  32 passed (32)`

- [ ] **Bước 10: Thêm luật 1b vào check-prerender**

Sửa `scripts/check-prerender.mjs` đúng như diff:

```diff
diff --git a/scripts/check-prerender.mjs b/scripts/check-prerender.mjs
index 3911662..ced4706 100644
--- a/scripts/check-prerender.mjs
+++ b/scripts/check-prerender.mjs
@@ -4,7 +4,9 @@
  *
  * 1. The guest pages must be fully prerendered with cacheLife('max') and carry
  *    every cache tag their data readers declare, or a write that refreshes one
- *    of those tags (spec §6.2) would never reach them.
+ *    of those tags (spec §6.2) would never reach them. The admin pages are the
+ *    opposite (1b): no static shell at all, since a shell built at build time
+ *    could not carry the per-request CSP nonce (spec §11).
  * 2. The web fonts must reach the pages as one family each. lib/fonts/index.ts
  *    loads every subset with its own localFont call and joins the calls into
  *    one family through `declarations`, which relies on the bundler naming a
@@ -74,6 +76,18 @@ for (const [route, file] of Object.entries(PAGES)) {
   }
 }
 
+/* 1b. The admin has no static shell: its scripts could not carry the per-request CSP nonce (spec §11). */
+const adminRoutes = [...Object.entries(manifest.routes), ...Object.entries(manifest.dynamicRoutes)].filter(
+  ([route]) => route === '/admin' || route.startsWith('/admin/'),
+);
+// Next records an empty, blocking entry for every admin route; finding none means the check sees nothing.
+if (adminRoutes.length === 0) problems.push('no /admin route in the prerender manifest');
+for (const [route, entry] of adminRoutes) {
+  if (entry.response !== 'empty' || entry.htmlSize !== 0) {
+    problems.push(`${route} has a static shell (response ${entry.response}, ${entry.htmlSize} bytes); admin pages must render at request time`);
+  }
+}
+
 /* 2. Fonts */
 const fontSummary = checkFonts();
 
@@ -82,6 +96,7 @@ if (problems.length) {
   process.exit(1);
 }
 console.log(`Prerender check passed: ${Object.keys(PAGES).join(', ')} (tags: ${TAGS.join(', ')}).`);
+console.log(`Admin check passed: ${adminRoutes.map(([route]) => route).join(', ')} have no static shell.`);
 console.log(`Font check passed: ${fontSummary}.`);
 
 function checkFonts() {
```

- [ ] **Bước 11: Viết guard cho các trang admin**

Create `lib/admin/admin-pages.guard.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The admin renders at request time (spec §11). app/admin/layout.tsx makes
 * that so with `instant = false` + `await connection()`, but Cache Components
 * still validates navigations *between* admin pages in next dev and reports
 * every session read as a blocking route (instant-navigation.md:568). Each
 * admin page therefore says `instant = false` itself, and no admin file may
 * use style="" (style={…}) markup: the admin CSP has no 'unsafe-inline'.
 */
const ADMIN = 'app/admin';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const all = files(ADMIN).filter((f) => /\.tsx?$/.test(f));

describe('admin pages', () => {
  it('every page.tsx exports instant = false', () => {
    const pages = all.filter((f) => f.endsWith('/page.tsx'));
    expect(pages.length).toBeGreaterThan(0);
    const missing = pages.filter((f) => !/^export const instant = false;$/m.test(readFileSync(f, 'utf8')));
    expect(missing.map((f) => relative('.', f))).toEqual([]);
  });

  it('the root layout blocks on connection() before rendering <html>', () => {
    const src = readFileSync(join(ADMIN, 'layout.tsx'), 'utf8');
    expect(src).toMatch(/^export const instant = false;$/m);
    // Code, not the comments that mention both: a statement of its own, before the <html …> element.
    const call = /^\s*await connection\(\);$/m.exec(src);
    const html = /<html\s/.exec(src);
    expect(call, 'no `await connection();` statement').not.toBeNull();
    expect(html, 'no <html …> element').not.toBeNull();
    expect(call!.index).toBeLessThan(html!.index);
  });

  it('no inline style attributes', () => {
    expect(all.filter((f) => /\bstyle=\{/.test(readFileSync(f, 'utf8')))).toEqual([]);
  });
});
```

Run: `npx vitest run lib/admin/admin-pages.guard.test.ts`
Expected: FAIL `Error: ENOENT: no such file or directory, scandir 'app/admin'`

- [ ] **Bước 12: Viết E2E bảo mật**

Create `e2e/csp.ts`:

```ts
import type { Page } from '@playwright/test';

/* Helpers for the admin specs: the admin CSP (spec §11) must never block the app's own code. */

/** Collects CSP violations two ways: the DOM event (installed before any page script) and Chrome's console report. */
export async function watchCsp(page: Page): Promise<string[]> {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(`console: ${m.text()}`);
  });
  await page.exposeFunction('reportCspViolation', (v: string) => violations.push(`event: ${v}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { reportCspViolation: (v: string) => void }).reportCspViolation(
        `${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`,
      );
    });
  });
  return violations;
}

/** React attached to the document, i.e. the nonced bootstrap scripts ran and hydrated it. */
export async function expectHydrated(page: Page) {
  await page.waitForFunction(() => Object.keys(document).some((k) => k.startsWith('__reactContainer$')));
}
```

Create `e2e/admin-security.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { expectHydrated, watchCsp } from './csp';

/*
 * Spec §11: every admin response carries a per-request nonce CSP plus
 * framing and indexing headers, Next stamps that nonce on every script, and
 * the page hydrates with no CSP violation. Guest pages stay prerendered and
 * get none of it. Spec §6.1: without a session cookie the proxy sends /admin/*
 * to the sign-in page, except the three public pages.
 */

const nonceOf = (csp: string | undefined) => /'nonce-([A-Za-z0-9+/_-]+={0,2})'/.exec(csp ?? '')?.[1];

test.describe('admin response headers', () => {
  test('/admin/sign-in carries a nonce CSP, and every <script> has that nonce', async ({ request }) => {
    const res = await request.get('/admin/sign-in');
    expect(res.status()).toBe(200);
    const h = res.headers();
    const csp = h['content-security-policy'];
    const nonce = nonceOf(csp);
    expect(nonce, `CSP: ${csp}`).toBeTruthy();
    expect(csp).toBe(
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
        `style-src 'self' 'nonce-${nonce}'`,
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
    );
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-robots-tag']).toBe('noindex, nofollow');
    expect(h['referrer-policy']).toBe('same-origin');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
    expect(h['cache-control']).toContain('private');
    expect(h['cache-control']).toContain('no-store');

    const html = await res.text();
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts.length).toBeGreaterThan(3);
    expect(scripts.filter((s) => !s.includes(` nonce="${nonce}"`))).toEqual([]);
    // style-src has no 'unsafe-inline': the markup must have no style="" and no un-nonced <style>.
    expect(html).not.toMatch(/\sstyle="/);
    expect([...html.matchAll(/<style\b[^>]*>/g)].filter((m) => !m[0].includes(`nonce="${nonce}"`))).toEqual([]);
    expect(html).toContain('<html lang="vi"');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow"/>');
  });

  test('the nonce is new on every response', async ({ request }) => {
    const a = nonceOf((await request.get('/admin/sign-in')).headers()['content-security-policy']);
    const b = nonceOf((await request.get('/admin/sign-in')).headers()['content-security-policy']);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });

  test('guest pages get no admin CSP and stay prerendered', async ({ request }) => {
    const res = await request.get('/en');
    expect(res.status()).toBe(200);
    const h = res.headers();
    expect(h['content-security-policy']).toBeUndefined();
    expect(h['x-robots-tag']).toBeUndefined();
    expect(h['x-nextjs-prerender']).toMatch(/^1(, 1)*$/); // next start sends it twice for prerendered pages
    expect(await res.text()).not.toContain(' nonce="');
  });
});

test.describe('proxy: session cookie gate', () => {
  test('signed out, /admin/* goes to sign-in and keeps where it was going', async ({ request }) => {
    const home = await request.get('/admin', { maxRedirects: 0 });
    expect(home.status()).toBe(307);
    expect(home.headers().location).toBe('/admin/sign-in');

    const users = await request.get('/admin/users?tab=moi', { maxRedirects: 0 });
    expect(users.status()).toBe(307);
    expect(users.headers().location).toBe(`/admin/sign-in?next=${encodeURIComponent('/admin/users?tab=moi')}`);
  });

  for (const path of ['/admin/sign-in', '/admin/accept-invite?token=x', '/admin/reset-password']) {
    test(`signed out, ${path} is not redirected`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(200);
      expect(nonceOf(res.headers()['content-security-policy'])).toBeTruthy();
    });
  }
});

test.describe('hydration under the CSP', () => {
  test('sign-in hydrates with no violation', async ({ page }) => {
    const violations = await watchCsp(page);
    await page.goto('/admin/sign-in');
    await expectHydrated(page);
    await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
    expect(violations).toEqual([]);
  });

  test('an unknown admin URL gets the Vietnamese not-found page, inside the admin document', async ({ page, context }) => {
    // Any session cookie passes the proxy; the catch-all route itself reads none.
    await context.addCookies([{ name: 'better-auth.session_token', value: 'x', url: test.info().project.use.baseURL! }]);
    const violations = await watchCsp(page);
    await page.goto('/admin/khong-co-trang-nay');
    await expect(page.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
    expect(violations).toEqual([]);
  });
});
```

- [ ] **Bước 13: Build khi chưa có `app/admin`, chạy check-prerender và E2E bảo mật: phải đỏ**

```bash
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
node scripts/check-prerender.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson E2E_PORT=3210 npx playwright test --retries=0 e2e/admin-security.spec.ts
```

Expected: build thoát 0; check-prerender FAIL

```
Prerender and font check failed:
- no /admin route in the prerender manifest
```

E2E FAIL `6 failed`, `3 passed` (nonce mới mỗi request, trang khách không có CSP và cổng 307 đã đúng nhờ proxy):

```
  ✘ admin response headers › /admin/sign-in carries a nonce CSP, and every <script> has that nonce
  ✘ proxy: session cookie gate › signed out, /admin/sign-in is not redirected
  ✘ proxy: session cookie gate › signed out, /admin/accept-invite?token=x is not redirected
  ✘ proxy: session cookie gate › signed out, /admin/reset-password is not redirected
  ✘ hydration under the CSP › sign-in hydrates with no violation
  ✘ hydration under the CSP › an unknown admin URL gets the Vietnamese not-found page, inside the admin document
    Expected: 200
    Received: 404
```

- [ ] **Bước 14: Viết root layout admin, stylesheet và các trang khung**

`await connection()` đứng trước `<html>`: prerender dừng ngay, không có static shell để gửi đi (shell dựng lúc build không mang được nonce của request). `instant = false` báo cho Cache Components rằng cây này được phép chặn (`instant.md`). Chỉ `instant = false` thì không đủ: lần build âm ở Bước 19 cho thấy trang không đọc dữ liệu request sẽ thành tĩnh.

Create `app/admin/layout.tsx`:

```tsx
import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import { fontVariables } from '@/lib/fonts';
import '@/styles/admin.css';

/*
 * The admin's root layout (the guest site has its own under app/(site)/[lang]).
 * Moving between the two is a full page load, by design (spec §6.1).
 *
 * Every admin page renders at request time (spec §11):
 * - `await connection()` comes before <html>, so the prerender stops at once
 *   and there is no static shell to ship. A static shell could not carry the
 *   per-request CSP nonce (content-security-policy.md:397).
 * - `instant = false` tells Cache Components this tree is allowed to block, so
 *   it does not ask for a static shell or flag the session reads below it
 *   (instant.md:66-88).
 *
 * Response codes: the build still records an empty shell for each admin route
 * (prerender-manifest: response "empty", compute "blocking"), and next start
 * sends that shell's status, 200, before the resumed render runs
 * (next/dist/build/templates/app-page-runtime.js:1211-1213, 1388-1440). So
 * redirect(), notFound() and forbidden() inside an admin page do not change the
 * status: they reach the browser in the RSC payload and act there. Only the
 * proxy's cookie check is a real 307.
 */
export const instant = false;

export const metadata: Metadata = {
  title: { template: '%s · Quản trị Furama Cuisine', default: 'Quản trị Furama Cuisine' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#14201c' };

export default async function AdminRootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  return (
    <html lang="vi" className={fontVariables}>
      <body className="admin">{children}</body>
    </html>
  );
}
```

Create `styles/admin.css`:

```css
/*
 * The admin's own stylesheet: loaded only by app/admin/layout.tsx, so none of
 * it reaches the guest site, and none of the guest layout (styles/*.css via
 * app/globals.css) reaches the admin. Colours echo the brand; the type is Be
 * Vietnam Pro (lib/fonts), which covers Vietnamese.
 *
 * CSP: style-src allows files and nonced <style> only, so admin markup must
 * not use style="" attributes. Put every rule here or in a CSS module.
 */
:root {
  --a-bg: #f5f3ee;
  --a-surface: #ffffff;
  --a-ink: #1f2522;
  --a-ink-soft: #56605b;
  --a-line: #e2ded4;
  --a-brand: #14201c;
  --a-brand-ink: #f7f2e8;
  --a-accent: #8a6b33;
  --a-focus: #2f6fd6;
  --a-danger: #a3261b;
  --a-danger-bg: #fbecea;
  --a-radius: 8px;
  --a-sidebar: 232px;
  --a-font: var(--font-be-vietnam), 'Be Vietnam Pro Fallback', system-ui, sans-serif;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
}

body.admin {
  background: var(--a-bg);
  color: var(--a-ink);
  font-family: var(--a-font);
  font-size: 15px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

.admin a {
  color: inherit;
}

.admin :focus-visible {
  outline: 2px solid var(--a-focus);
  outline-offset: 2px;
}

/* ---------- Shell: sidebar + header + main ---------- */

.a-shell {
  display: grid;
  grid-template-columns: var(--a-sidebar) 1fr;
  min-height: 100vh;
}

.a-sidebar {
  background: var(--a-brand);
  color: var(--a-brand-ink);
  padding: 20px 12px;
}

.a-brand {
  display: block;
  padding: 4px 12px 20px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-decoration: none;
}

.a-brand small {
  display: block;
  font-weight: 400;
  opacity: 0.7;
}

.a-nav ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.a-nav a {
  display: block;
  padding: 9px 12px;
  border-radius: 6px;
  text-decoration: none;
  opacity: 0.86;
}

.a-nav a:hover {
  background: rgba(247, 242, 232, 0.08);
  opacity: 1;
}

.a-nav a[aria-current='page'] {
  background: rgba(247, 242, 232, 0.14);
  opacity: 1;
  font-weight: 600;
}

.a-main-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.a-header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  height: 56px;
  padding: 0 24px;
  background: var(--a-surface);
  border-bottom: 1px solid var(--a-line);
}

.a-user {
  text-align: right;
  line-height: 1.25;
}

.a-user small {
  display: block;
  color: var(--a-ink-soft);
}

.a-main {
  padding: 28px 32px 48px;
  max-width: 1200px;
}

.a-main h1 {
  margin: 0 0 6px;
  font-size: 24px;
  font-weight: 600;
}

.a-lede {
  margin: 0 0 24px;
  color: var(--a-ink-soft);
}

/* ---------- Controls ---------- */

.a-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid var(--a-brand);
  border-radius: 6px;
  background: var(--a-brand);
  color: var(--a-brand-ink);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.a-btn:disabled {
  opacity: 0.6;
  cursor: progress;
}

.a-btn--ghost {
  background: transparent;
  color: var(--a-ink);
  border-color: var(--a-line);
}

.a-field {
  display: grid;
  gap: 6px;
  margin-bottom: 16px;
}

.a-field label {
  font-weight: 600;
}

.a-field input {
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--a-line);
  border-radius: 6px;
  background: var(--a-surface);
  color: var(--a-ink);
  font: inherit;
}

.a-field input[aria-invalid='true'] {
  border-color: var(--a-danger);
}

.a-field-error {
  margin: 0;
  color: var(--a-danger);
  font-size: 14px;
}

.a-alert {
  margin: 0 0 16px;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--a-danger-bg);
  color: var(--a-danger);
}

/* ---------- Auth pages (sign-in, accept-invite, reset-password) ---------- */

.a-auth {
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: 24px 16px;
}

.a-card {
  width: 100%;
  max-width: 400px;
  padding: 32px 28px;
  border: 1px solid var(--a-line);
  border-radius: var(--a-radius);
  background: var(--a-surface);
}

.a-card h1 {
  margin: 0 0 4px;
  font-size: 22px;
}

.a-card .a-lede {
  margin-bottom: 20px;
}

.a-card .a-btn {
  width: 100%;
}

.a-card-foot {
  margin: 16px 0 0;
  text-align: center;
  font-size: 14px;
}

/* ---------- Tables ---------- */

.a-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--a-surface);
  border: 1px solid var(--a-line);
  border-radius: var(--a-radius);
}

.a-table th,
.a-table td {
  padding: 10px 14px;
  border-bottom: 1px solid var(--a-line);
  text-align: left;
}

.a-table th {
  font-size: 13px;
  font-weight: 600;
  color: var(--a-ink-soft);
}

@media (max-width: 760px) {
  .a-shell {
    grid-template-columns: 1fr;
  }

  .a-sidebar {
    padding: 12px;
  }

  .a-nav ul {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .a-main {
    padding: 20px 16px 40px;
  }
}
```

Create `app/admin/(auth)/layout.tsx`:

```tsx
/* Sign-in, accept-invite and reset-password: one centred card, no navigation. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main className="a-auth">{children}</main>;
}
```

Create `app/admin/(auth)/sign-in/page.tsx` (thẻ tĩnh; Task 7 thêm form):

```tsx
import type { Metadata } from 'next';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Đăng nhập' };

export default function SignInPage() {
  return (
    <section className="a-card" aria-labelledby="sign-in-title">
      <h1 id="sign-in-title">Đăng nhập</h1>
      <p className="a-lede">Trang quản trị Furama Cuisine</p>
    </section>
  );
}
```

Create `app/admin/not-found.tsx`:

```tsx
import Link from 'next/link';

export default function AdminNotFound() {
  return (
    <main className="a-auth">
      <section className="a-card">
        <h1>Không tìm thấy trang</h1>
        <p className="a-lede">Đường dẫn này không có trong trang quản trị.</p>
        <Link className="a-btn" href="/admin">
          Về trang tổng quan
        </Link>
      </section>
    </main>
  );
}
```

Create `app/admin/[...missing]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

/*
 * Unknown /admin/* URLs: without this, they match no route and get the guest
 * site's English app/global-not-found.tsx. Here they get app/admin/not-found.tsx,
 * in Vietnamese, inside the admin's own document. (Its status is 200: see the
 * note on response codes in app/admin/layout.tsx.)
 */
export default function MissingAdminPage(): never {
  notFound();
}
```

Run: `npx vitest run lib/admin/admin-pages.guard.test.ts`
Expected: PASS `Tests  3 passed (3)`

- [ ] **Bước 15: Typecheck, phải đỏ ở hai layout của web khách**

Run: `npm run typecheck`
Expected: FAIL (root layout thứ hai làm `lang()` thành `Promise<string | undefined>`, `next-root-params.md:286-313`):

```
app/(site)/[lang]/(guarded)/layout.tsx(22,68): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
app/(site)/[lang]/(guarded)/layout.tsx(22,88): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
app/(site)/[lang]/(guarded)/layout.tsx(26,7): error TS2322: Type 'string | undefined' is not assignable to type 'string'.
app/(site)/[lang]/layout.tsx(56,33): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
app/(site)/[lang]/layout.tsx(56,49): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
```

- [ ] **Bước 16: Sửa hai layout của web khách**

Root layout của web khách không bao giờ ném lỗi (phán quyết 2 của đợt 2), nên nó rơi về `DEFAULT_LOCALE`; layout `(guarded)` coi `undefined` như ngôn ngữ không bật. Sửa đúng như diff:

```diff
diff --git a/app/(site)/[lang]/layout.tsx b/app/(site)/[lang]/layout.tsx
index 26a5527..02f1df9 100644
--- a/app/(site)/[lang]/layout.tsx
+++ b/app/(site)/[lang]/layout.tsx
@@ -47,7 +47,8 @@ const MOTION_BOOTSTRAP = `try{document.documentElement.dataset.motion=matchMedia
  * data reads live in (guarded)/layout.tsx.
  */
 export default async function SiteLayout({ children }: { children: React.ReactNode }) {
-  const code = await lang();
+  // string | undefined: app/admin has a root layout of its own with no [lang] (next-root-params.md:286-313).
+  const code = (await lang()) ?? DEFAULT_LOCALE;
 
   /* suppressHydrationWarning: the inline script below stamps data-motion onto
      <html> before React hydrates, so the server markup differs by design. */
```

```diff
diff --git a/app/(site)/[lang]/(guarded)/layout.tsx b/app/(site)/[lang]/(guarded)/layout.tsx
index f0f6668..e526408 100644
--- a/app/(site)/[lang]/(guarded)/layout.tsx
+++ b/app/(site)/[lang]/(guarded)/layout.tsx
@@ -18,7 +18,8 @@ import { Chrome } from '@/components/site/Chrome';
 export default async function GuardedLayout({ children }: { children: React.ReactNode }) {
   const locale = await lang();
   const enabled = await getEnabledLocales();
-  if (!enabled.some((l) => l.code === locale)) notFound();
+  // `locale` is string | undefined since app/admin added a second root layout (next-root-params.md:286-313).
+  if (!locale || !enabled.some((l) => l.code === locale)) notFound();
   const [restaurants, strings] = await Promise.all([getRestaurants(locale), getStrings(locale, CLIENT_KEYS)]);
 
   return (
```

Run: `npm run typecheck`
Expected: không lỗi.

- [ ] **Bước 17: Chạy cổng kiểm tra**

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

Expected:
- typecheck sạch; lint 0 lỗi, 19 cảnh báo; `Test Files  31 passed (31)`, `Tests  307 passed (307)`;
- bảng route của build có thêm:

  ```
  ├   /admin/[...missing]
  │ └ ◐ /admin/[...missing]
  ├ ƒ /admin/sign-in
  ```

  và `○ /en`, `○ /en/restaurants/taya-house` giữ nguyên;
- check-prerender in thêm `Admin check passed: /admin/sign-in, /admin/[...missing] have no static shell.`;
- E2E `42 passed`; visual `8 passed` (đây là bằng chứng hai layout khách không đổi gì người xem thấy).

- [ ] **Bước 18: Kiểm bằng tay header thật trên `next start`**

```bash
PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3211 EMAIL_DELIVERY=log npx next start -p 3211 &
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3211/ && break; sleep 1; done
curl -s -D - -o /dev/null http://localhost:3211/admin/sign-in | grep -iE 'content-security-policy|x-frame-options|cache-control'
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3211/admin
lsof -ti tcp:3211 | xargs kill
```

Expected: `content-security-policy: default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; style-src 'self' 'nonce-…'; …`, `x-frame-options: DENY`, `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`; dòng cuối `307 http://localhost:3211/admin/sign-in`.

- [ ] **Bước 19: Một lần build âm: bỏ `await connection()` thì cả guard lẫn check-prerender phải đỏ**

```bash
cp app/admin/layout.tsx "${TMPDIR:-/tmp}/admin-layout.bak"
sed -i '' 's/^  await connection();$//' app/admin/layout.tsx
npx vitest run lib/admin/admin-pages.guard.test.ts
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
node scripts/check-prerender.mjs
cp "${TMPDIR:-/tmp}/admin-layout.bak" app/admin/layout.tsx
git diff --stat app/admin/layout.tsx
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
node scripts/check-prerender.mjs
```

(Trên Linux dùng `sed -i` không có `''`.) Expected:
- guard FAIL `AssertionError: no \`await connection();\` statement: expected null not to be null`;
- build vẫn thoát 0, nhưng bảng route có `├ ○ /admin/sign-in` (tĩnh);
- check-prerender FAIL:

  ```
  Prerender and font check failed:
  - /admin/sign-in has a static shell (response complete, 11325 bytes); admin pages must render at request time
  - /admin/[...missing] has a static shell (response complete, 1185 bytes); admin pages must render at request time
  ```

  (số byte có thể khác chút ít);
- sau khi chép lại file: `git diff --stat` không in gì, build lại xanh và check-prerender in `Admin check passed …`.

- [ ] **Bước 20: Commit**

```bash
git add lib/admin proxy.ts proxy.test.ts lib/i18n/proxy-matcher.test.ts app/admin styles/admin.css 'app/(site)/[lang]/layout.tsx' 'app/(site)/[lang]/(guarded)/layout.tsx' scripts/check-prerender.mjs e2e/admin-security.spec.ts e2e/csp.ts
git commit -m "$(cat <<'EOF'
feat: render the admin at request time behind a nonce CSP and a cookie gate

app/admin/layout.tsx is the admin's own root layout (Vietnamese, noindex,
its own stylesheet). `export const instant = false` plus `await connection()`
before <html> leaves every admin route without a static shell, so each
response is rendered with the nonce proxy.ts makes for it; every admin page
also says `instant = false`, or next dev flags navigations between them.
check-prerender now fails if any admin route has a shell (verified once with
connection() removed: /admin/sign-in became static, 11325 bytes, and the
check exited 1), and a guard test holds the layout and page rules.

proxy.ts sends a cookie-less /admin/* request to /admin/sign-in (keeping
?next=, without _rsc), except the three public pages, and gives every admin
response a per-request nonce CSP with no unsafe-inline or eval, X-Frame-Options
DENY, X-Robots-Tag noindex, Referrer-Policy same-origin, nosniff and a
Permissions-Policy. Guest pages are untouched and stay prerendered.

Unknown /admin URLs get a Vietnamese not-found page through a catch-all.
The second root layout makes next/root-params `lang()` possibly undefined, so
the two guest layouts handle that.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 7: Nối Better Auth vào Next — route, DAL, đăng nhập, khung admin và guard CI

**Files:**
- Modify: `package.json`, `package-lock.json`, `playwright.config.ts`, `.github/workflows/ci.yml`, `e2e/admin-security.spec.ts`
- Create: `e2e/staff-fixtures.ts`, `e2e/admin-sign-in.spec.ts`
- Create: `lib/admin/zod.ts`, `lib/admin/format.ts`, `lib/admin/auth-errors.ts`, `lib/admin/nav.ts` (+ `format.test.ts`, `auth-errors.test.ts`, `nav.test.ts`)
- Create: `lib/server/auth/auth.ts`, `lib/server/dal/session.ts`, `lib/server/action-result.ts` (+ `action-result.test.ts`)
- Create: `lib/server/auth/endpoint.ts` (+ `endpoint.test.ts`)
- Create: `test/guards/server-actions.ts`, `test/guards/require-permission.guard.test.ts`
- Create: `app/admin/(auth)/sign-in/actions.ts`, `app/admin/(auth)/sign-in/SignInForm.tsx`; Modify: `app/admin/(auth)/sign-in/page.tsx`
- Create: `app/admin/(shell)/layout.tsx`, `NavLinks.tsx`, `actions.ts`, `page.tsx`, `error.tsx`
- Create: `app/api/auth/[...all]/route.ts`

**Interfaces:**
- Consumes: `createAuth`, `Auth`, `ADMIN_ENDPOINT_BLOCKED` (Task 2); `sendPasswordReset` (Task 3); `AuditActor` (Task 4); `ADMIN_SIGN_IN`, `ADMIN_HOME`, `safeAdminNext` (Task 6); `roleCan`, `isStaffRole`, `Permissions`, `StaffRole` (Task 1); `getPool` từ `db/client.ts`; `VENUE_TZ` từ `lib/venue-time.ts`.
- Produces:
  - `lib/server/auth/auth.ts`: `getAuth(): Auth` (lười; `bootstrapAdminEmail: undefined`; `backgroundTask: (task) => after(task)`). Task 8 thêm `staffDeps()`.
  - `lib/server/dal/session.ts`: `type StaffSession = { userId; email; name; role: StaffRole; ip: string | null }`, `class PermissionError { code: 'unauthenticated' | 'forbidden' }`, `getStaffSession()` (React `cache`), `verifySession()`, `requirePermission(permissions)`, `auditActor(staff): AuditActor`. Task 9 thêm `requirePagePermission`.
  - `lib/server/action-result.ts`: `type ActionCode`, `type ActionFailure`, `type ActionResult<T = null>`, `actionError(err): ActionFailure`.
  - `lib/server/auth/endpoint.ts`: ``callAuthEndpoint(path: `/${string}`, body: unknown): Promise<Response>``, `applySetCookies(res: Response): Promise<void>`.
  - `lib/admin/zod.ts`: `z` đã `z.config(z.locales.vi())`. `lib/admin/format.ts`: `formatDateTimeVi`, `formatLongDateVi`, `todayVi(now?)`. `lib/admin/auth-errors.ts`: `authErrorMessage(status, code?, retryAfterSeconds?)`, `actionErrorMessage(code: ActionCode)`. `lib/admin/nav.ts`: `type NavItem`, `ADMIN_NAV`, `navFor(role)`, `ROLE_LABELS`.
  - `test/guards/server-actions.ts`: `checksFirst(fn)`, `exportedFunctions(program)`, `checkActions(rel, source, publicActions)`, `scanRepo(root, publicActions)`, `publicActionsMissing(root, entries)`, `ADMIN_PLUGIN_ENDPOINTS` (đọc từ `admin({ ac, roles }).endpoints`), `adminPluginCallsIn(rel, source)`, `adminPluginCalls(root)`. Task 9 thêm `adminOnlyProblems`.
  - `e2e/staff-fixtures.ts`: `STAFF` (admin `owner@furama.test` / `correct horse battery`, editor `editor@furama.test` / `editor passphrase 1`, banned `banned@furama.test`), `type SeedStaff`, `db()` (từ chối mọi `DATABASE_URL` không phải DB cục bộ `*_test`/`*_ci`), `seedStaff(staff?)`, `uniqueIp(testInfo)`, `test` (mỗi context có `x-forwarded-for` riêng), `expect`, `newVisitor(browser, testInfo)`, `formAlert(page)`, `signIn(page, email, password)`, `signInAs(page, who)`.
  - Server Action công khai `signIn(prev, formData)` và `signOut()`.

- [ ] **Bước 1: Cài oxc-parser**

```bash
npm i -D oxc-parser@0.152.0
```

Expected: `found 0 vulnerabilities`; `git diff package.json`:

```diff
diff --git a/package.json b/package.json
index a632b99..3865f09 100644
--- a/package.json
+++ b/package.json
@@ -36,6 +36,7 @@
     "auth": "^1.7.7",
     "dotenv-cli": "^11.0.0",
     "jiti": "^2.7.0",
+    "oxc-parser": "^0.152.0",
     "oxlint": "^1.86.0",
     "typescript": "^7.0.2",
     "vitest": "^5.0.3"
```

- [ ] **Bước 2: Viết E2E trước: tài khoản seed, đặc tả đăng nhập, điều kiện của Playwright**

Create `e2e/staff-fixtures.ts`:

```ts
import { randomInt } from 'node:crypto';
import { test as base, expect, type Browser, type Page, type TestInfo } from '@playwright/test';
import { hashPassword } from 'better-auth/crypto';
import pg from 'pg';

/*
 * Staff for the admin specs, written straight into the local _test database
 * (db() below refuses any other). The rows match what Better Auth
 * writes for an email-and-password account: a staff_user, plus a staff_account
 * with provider_id 'credential' whose password is better-auth/crypto
 * hashPassword() (scrypt, what sign-in verifies against). Upserts, so a run
 * resets names, roles, bans and passwords. Specs must not change these three
 * accounts' roles or bans: other spec files use them at the same time.
 */
export const STAFF = {
  admin: {
    id: 'e2e-admin',
    name: 'Chủ quán E2E',
    email: 'owner@furama.test',
    password: 'correct horse battery',
    role: 'admin',
    banned: false,
  },
  editor: {
    id: 'e2e-editor',
    name: 'Biên tập viên E2E',
    email: 'editor@furama.test',
    password: 'editor passphrase 1',
    role: 'editor',
    banned: false,
  },
  banned: {
    id: 'e2e-banned',
    name: 'Tài khoản bị khóa',
    email: 'banned@furama.test',
    password: 'banned passphrase 1',
    role: 'editor',
    banned: true,
  },
} as const;

export type SeedStaff = { id: string; name: string; email: string; password: string; role: 'admin' | 'editor'; banned: boolean };

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/**
 * Every database access of the admin specs goes through here, so the local-only
 * rule sits here too: playwright.config.ts checks DATABASE_URL only when it
 * starts the server itself, not with E2E_BASE_URL. Same rule as
 * scripts/reset-db.mjs: a local host, no query string (pg lets ?host= override
 * the host), and a name ending in _test or _ci (CI's furama_cuisine_ci).
 */
export function db(): pg.Client {
  const raw = process.env.DATABASE_URL;
  let url: URL | undefined;
  try {
    url = raw ? new URL(raw) : undefined;
  } catch {
    url = undefined;
  }
  if (!url || !LOCAL_HOSTS.includes(url.hostname) || url.search !== '' || !/^[a-z0-9_]+_(test|ci)$/.test(url.pathname.slice(1))) {
    throw new Error(
      'Refusing to touch the database: the admin specs write staff accounts with known passwords. Set DATABASE_URL to postgres://localhost:5432/<name>_test (or _ci).',
    );
  }
  return new pg.Client({ connectionString: raw });
}

/** Upserts staff accounts (the three above unless told otherwise). */
export async function seedStaff(staff: readonly SeedStaff[] = Object.values(STAFF)): Promise<void> {
  const client = db();
  await client.connect();
  try {
    await client.query('BEGIN');
    // Spec files seed from parallel workers; one at a time, or two inserts race on the email key.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('e2e-seed-staff'))");
    for (const s of staff) {
      await client.query(
        `INSERT INTO staff_user (id, name, email, email_verified, role, banned)
         VALUES ($1, $2, $3, true, $4, $5)
         ON CONFLICT (id) DO UPDATE SET name = $2, email = $3, role = $4, banned = $5, updated_at = now()`,
        [s.id, s.name, s.email, s.role, s.banned],
      );
      await client.query(
        `INSERT INTO staff_account (id, account_id, provider_id, user_id, password, updated_at)
         VALUES ($1, $2, 'credential', $2, $3, now())
         ON CONFLICT (id) DO UPDATE SET password = $3, updated_at = now()`,
        [`${s.id}-credential`, s.id, await hashPassword(s.password)],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

/*
 * Better Auth rate-limits /sign-in* to 3 tries per 10 s per client address
 * (and /request-password-reset to 3 per 60 s), counted in auth_rate_limit.
 * next start keeps a client's X-Forwarded-For (next/dist/server/base-server.js:612)
 * and the sign-in action forwards it, so each test gets an address of its own
 * and parallel tests, or a rerun within 10 s, never share a bucket.
 */
const RUN = randomInt(1, 255);
let next = 0;

export function uniqueIp(testInfo: TestInfo): string {
  next += 1;
  return `10.${RUN}.${testInfo.parallelIndex % 256}.${(next % 254) + 1}`;
}

/** Every browser context of a test sends that test's own address. */
export const test = base.extend({
  // `provide`, not Playwright's usual `use`: oxlint reads `use(...)` as a React hook call.
  context: async ({ context }, provide, testInfo) => {
    await context.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp(testInfo) });
    await provide(context);
  },
});

export { expect };

/** A second browser for the same test (another person), with an address of its own. */
export async function newVisitor(browser: Browser, testInfo: TestInfo): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueIp(testInfo) } });
  return context.newPage();
}

/** The form's own message; Next's route announcer is a second, empty role=alert. */
export const formAlert = (page: Page) => page.locator('form').getByRole('alert');

/**
 * Fills and submits the sign-in form, then waits for the action's response.
 * The next fill must not start earlier: when an action settles, React resets
 * the form, which would wipe a password typed in the meantime.
 */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  const answered = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/admin/sign-in',
  );
  // exact: while pending the button reads "Đang đăng nhập…", which also contains "đăng nhập".
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await answered;
}

/** Opens the sign-in page and signs in; resolves on the admin overview. */
export async function signInAs(page: Page, who: { email: string; password: string }): Promise<void> {
  await page.goto('/admin/sign-in');
  await signIn(page, who.email, who.password);
  await expect(page).toHaveURL(/\/admin$/);
}
```

Create `e2e/admin-sign-in.spec.ts`:

```ts
import type { Page } from '@playwright/test';
import { STAFF, expect, formAlert, seedStaff, signIn, signInAs, test } from './staff-fixtures';

/*
 * Sign-in through the Server Action (useActionState), Better Auth's error
 * codes in Vietnamese, the 7-day HttpOnly cookie, sign-out, and the rate
 * limit stored in the database (spec §7.1, §7.3).
 */

test.beforeAll(() => seedStaff());

/** After a failed attempt: the action has settled and the form is ready again. */
const settled = (page: Page) =>
  expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeEnabled();

test('the Admin signs in, lands on ?next=, and signs out', async ({ page, context }) => {
  await page.goto('/admin?from=email');
  await expect(page).toHaveURL(`/admin/sign-in?next=${encodeURIComponent('/admin?from=email')}`);

  // Better Auth looks the address up in lower case.
  await signIn(page, 'Owner@Furama.test', STAFF.admin.password);
  await expect(page).toHaveURL(/\/admin\?from=email$/);
  await expect(page.getByTestId('staff-name')).toHaveText(STAFF.admin.name);
  const nav = page.getByRole('navigation', { name: 'Điều hướng quản trị' });
  await expect(nav.getByRole('link', { name: 'Tổng quan' })).toHaveAttribute('aria-current', 'page');
  // vi-VN on Vietnam's clock, e.g. "Thứ Sáu, 2 tháng 10, 2026".
  await expect(page.getByTestId('today')).toHaveText(/^(Thứ (Hai|Ba|Tư|Năm|Sáu|Bảy)|Chủ Nhật), \d{1,2} tháng \d{1,2}, \d{4}$/);

  const cookie = (await context.cookies()).find((c) => c.name === 'better-auth.session_token');
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Lax');
  expect(cookie?.path).toBe('/');
  // Max-Age 604800: about 7 days from now.
  expect(cookie!.expires * 1000 - Date.now()).toBeGreaterThan(6.9 * 24 * 3600 * 1000);

  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
  expect((await context.cookies()).find((c) => c.name === 'better-auth.session_token')).toBeUndefined();
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
});

test('a signed-in visit to /admin/sign-in goes straight to the admin', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  await expect(page.getByTestId('staff-name')).toHaveText(STAFF.editor.name);
  await page.goto('/admin/sign-in');
  await expect(page).toHaveURL(/\/admin$/);
});

test('?next= cannot leave the admin', async ({ page }) => {
  await page.goto(`/admin/sign-in?next=${encodeURIComponent('//evil.example/x')}`);
  await signIn(page, STAFF.admin.email, STAFF.admin.password);
  await expect(page).toHaveURL(/\/admin$/);
});

test('a wrong password: a Vietnamese message, the email kept', async ({ page }) => {
  await page.goto('/admin/sign-in');
  await signIn(page, STAFF.admin.email, 'sai mat khau hoan toan');
  await expect(formAlert(page)).toHaveText('Email hoặc mật khẩu không đúng.');
  await expect(page.getByRole('textbox', { name: 'Email' })).toHaveValue(STAFF.admin.email);
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
});

test('field errors come from zod, in Vietnamese', async ({ page }) => {
  await page.goto('/admin/sign-in');
  await signIn(page, 'khong-phai-email', '');
  await expect(page.getByText('Nhập email công việc, ví dụ ten@furamavietnam.com.')).toBeVisible();
  await expect(page.getByText('Nhập mật khẩu.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Email' })).toHaveAttribute('aria-invalid', 'true');
});

test('a banned account is told it is locked', async ({ page }) => {
  await page.goto('/admin/sign-in');
  await signIn(page, STAFF.banned.email, STAFF.banned.password);
  await expect(formAlert(page)).toHaveText('Tài khoản này đã bị khóa. Liên hệ Admin để được mở lại.');
});

test('the fourth try within 10 s is refused, even with the right password', async ({ page }) => {
  await page.goto('/admin/sign-in');
  for (let i = 0; i < 3; i++) {
    await signIn(page, STAFF.admin.email, `sai mat khau ${i}`);
    await expect(formAlert(page)).toHaveText('Email hoặc mật khẩu không đúng.');
    await settled(page);
  }
  await signIn(page, STAFF.admin.email, STAFF.admin.password);
  await expect(formAlert(page)).toHaveText(/^Bạn đã thử quá nhiều lần\. Vui lòng thử lại sau \d+ giây\.$/);
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
});

test('a forged session cookie passes the proxy, but the page sends the browser to sign-in', async ({ page, context }) => {
  await context.addCookies([{ name: 'better-auth.session_token', value: 'forged.token', url: test.info().project.use.baseURL! }]);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
  await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
});
```

Sửa `e2e/admin-security.spec.ts` đúng như diff (seed tài khoản, bấm nút để thấy câu báo của zod, và đăng nhập là một điều hướng mềm không vi phạm CSP):

```diff
diff --git a/e2e/admin-security.spec.ts b/e2e/admin-security.spec.ts
index 79e89c1..1d289b9 100644
--- a/e2e/admin-security.spec.ts
+++ b/e2e/admin-security.spec.ts
@@ -1,5 +1,5 @@
-import { expect, test } from '@playwright/test';
 import { expectHydrated, watchCsp } from './csp';
+import { STAFF, expect, seedStaff, signIn, test } from './staff-fixtures';
 
 /*
  * Spec §11: every admin response carries a per-request nonce CSP plus
@@ -9,6 +9,8 @@ import { expectHydrated, watchCsp } from './csp';
  * to the sign-in page, except the three public pages.
  */
 
+test.beforeAll(() => seedStaff());
+
 const nonceOf = (csp: string | undefined) => /'nonce-([A-Za-z0-9+/_-]+={0,2})'/.exec(csp ?? '')?.[1];
 
 test.describe('admin response headers', () => {
@@ -96,7 +98,26 @@ test.describe('hydration under the CSP', () => {
     const violations = await watchCsp(page);
     await page.goto('/admin/sign-in');
     await expectHydrated(page);
-    await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
+    // A client-side state update (useActionState) proves the client bundle runs.
+    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
+    await expect(page.getByText('Nhập email công việc, ví dụ ten@furamavietnam.com.')).toBeVisible();
+    expect(violations).toEqual([]);
+  });
+
+  test('signing in moves into the shell without a document request or a violation', async ({ page }) => {
+    const violations = await watchCsp(page);
+    await page.goto('/admin/sign-in');
+    await expectHydrated(page);
+    // The action's redirect is a soft navigation: the page keeps its first nonce,
+    // and the shell's new chunks load under 'strict-dynamic'.
+    let documents = 0;
+    page.on('request', (r) => {
+      if (r.resourceType() === 'document') documents++;
+    });
+    await signIn(page, STAFF.admin.email, STAFF.admin.password);
+    await expect(page).toHaveURL(/\/admin$/);
+    await expect(page.getByRole('heading', { name: 'Tổng quan' })).toBeVisible();
+    expect(documents).toBe(0);
     expect(violations).toEqual([]);
   });
```

Sửa `playwright.config.ts` đúng như diff (khi tự bật server, đòi `EMAIL_DELIVERY=log`, `BETTER_AUTH_SECRET` và `BETTER_AUTH_URL` bằng origin của server):

```diff
diff --git a/playwright.config.ts b/playwright.config.ts
index ef3df9f..b44225c 100644
--- a/playwright.config.ts
+++ b/playwright.config.ts
@@ -35,6 +35,17 @@ if (!external) {
       'Refusing to start the app: next start reads .env.local (the shared Neon database). Set DATABASE_URL to a local postgres://localhost:5432/<name>_test database, or set E2E_BASE_URL to a server you started with local env.',
     );
   }
+  // The admin specs sign in and read emailed links: the server needs its own auth
+  // settings, and must never send real mail (.env.local may say EMAIL_DELIVERY=live).
+  if (process.env.EMAIL_DELIVERY !== 'log') {
+    throw new Error('Refusing to start the app: set EMAIL_DELIVERY=log, so no test sends real mail (process env beats .env.local).');
+  }
+  if (!process.env.BETTER_AUTH_SECRET) {
+    throw new Error('Refusing to start the app: set BETTER_AUTH_SECRET (for example $(openssl rand -base64 32)).');
+  }
+  if (process.env.BETTER_AUTH_URL !== `http://localhost:${PORT}`) {
+    throw new Error(`Refusing to start the app: set BETTER_AUTH_URL=http://localhost:${PORT}, the server's own origin (links and Better Auth's origin check use it).`);
+  }
 }
 
 export default defineConfig({
```

- [ ] **Bước 3: Build code hiện tại và chạy hai đặc tả admin: phải đỏ**

```bash
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson E2E_PORT=3210 npx playwright test --retries=0 e2e/admin-sign-in.spec.ts e2e/admin-security.spec.ts
```

Expected: FAIL `10 failed`, `8 passed` (trang đăng nhập còn là thẻ tĩnh):

```
  ✘ e2e/admin-sign-in.spec.ts › the Admin signs in, lands on ?next=, and signs out
  ✘ e2e/admin-security.spec.ts › hydration under the CSP › sign-in hydrates with no violation
  ✘ e2e/admin-security.spec.ts › hydration under the CSP › signing in moves into the shell without a document request or a violation
  … (7 test còn lại của admin-sign-in.spec.ts)
    Error: locator.fill: Test timeout of 30000ms exceeded.
```

Kiểm thêm điều kiện mới của Playwright (không bật server):

```bash
CI=1 DATABASE_URL=postgres://localhost:5432/x_test npx playwright test --list 2>&1 | head -1
CI=1 DATABASE_URL=postgres://localhost:5432/x_test EMAIL_DELIVERY=log BETTER_AUTH_SECRET=x BETTER_AUTH_URL=http://localhost:3999 npx playwright test --list 2>&1 | head -1
```

Expected: `Error: Refusing to start the app: set EMAIL_DELIVERY=log, so no test sends real mail (process env beats .env.local).` rồi `Error: Refusing to start the app: set BETTER_AUTH_URL=http://localhost:3100, the server's own origin (links and Better Auth's origin check use it).`

Các kiểm đó nằm trong `if (!external)`, nên `E2E_BASE_URL` bỏ qua chúng. Mọi lần ghi DB của spec admin đi qua `db()` của `e2e/staff-fixtures.ts`, và chính `db()` từ chối DB không phải cục bộ (không bật server, không kết nối):

```bash
E2E_BASE_URL=http://localhost:1 DATABASE_URL=postgres://db.example.invalid/x npx playwright test e2e/admin-sign-in.spec.ts 2>&1 | grep -E 'Error:|failed|did not run'
```

Expected:

```
    Error: Refusing to touch the database: the admin specs write staff accounts with known passwords. Set DATABASE_URL to postgres://localhost:5432/<name>_test (or _ci).
  1 failed
  7 did not run
```

`DATABASE_URL='postgres://localhost:5432/furama_cuisine_test?host=db.example.invalid'` cũng bị từ chối với cùng câu (pg cho `?host=` ghi đè host).

- [ ] **Bước 4: Viết test cho zod tiếng Việt, ngày giờ, câu báo lỗi và menu**

Create `lib/admin/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatDateTimeVi, formatLongDateVi, todayVi } from './format';

// npm test runs with TZ=UTC, like Vercel: the formatting must still be Vietnam's clock.
describe('admin dates', () => {
  it('formats in vi-VN on Asia/Ho_Chi_Minh, across the UTC midnight', () => {
    expect(formatDateTimeVi('2026-10-01T17:30:00Z')).toBe('00:30 02/10/2026');
    expect(formatDateTimeVi('2026-10-01T16:59:00Z')).toBe('23:59 01/10/2026');
    expect(formatLongDateVi('2026-10-01T17:30:00Z')).toBe('Thứ Sáu, 2 tháng 10, 2026');
    expect(todayVi(new Date('2026-10-01T23:00:00Z'))).toBe('Thứ Sáu, 2 tháng 10, 2026');
  });
});
```

Create `lib/admin/auth-errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { actionErrorMessage, authErrorMessage } from './auth-errors';

describe('authErrorMessage', () => {
  it.each([
    [401, 'INVALID_EMAIL_OR_PASSWORD', 'Email hoặc mật khẩu không đúng.'],
    [403, 'BANNED_USER', 'Tài khoản này đã bị khóa. Liên hệ Admin để được mở lại.'],
    [400, 'INVALID_TOKEN', 'Liên kết không hợp lệ hoặc đã được dùng. Hãy yêu cầu một liên kết mới.'],
    [400, 'TOKEN_EXPIRED', 'Liên kết đã hết hạn. Hãy yêu cầu một liên kết mới.'],
    [400, 'PASSWORD_TOO_SHORT', 'Mật khẩu cần ít nhất 12 ký tự.'],
  ])('%i %s', (status, code, message) => expect(authErrorMessage(status, code)).toBe(message));

  it('429 from the rate limiter (no code) → too many attempts, with the wait when known', () => {
    expect(authErrorMessage(429, undefined, 7)).toBe('Bạn đã thử quá nhiều lần. Vui lòng thử lại sau 7 giây.');
    expect(authErrorMessage(429)).toBe('Bạn đã thử quá nhiều lần. Vui lòng đợi một lát rồi thử lại.');
  });

  it('unknown codes never show English', () => {
    expect(authErrorMessage(500, 'SOMETHING_NEW')).toBe('Không đăng nhập được. Vui lòng thử lại sau ít phút.');
    expect(authErrorMessage(500)).toBe('Không đăng nhập được. Vui lòng thử lại sau ít phút.');
  });
});

describe('actionErrorMessage', () => {
  it.each([
    ['forbidden', 'Bạn không có quyền thực hiện thao tác này.'],
    ['invalid', 'Dữ liệu chưa hợp lệ. Hãy kiểm tra các ô được đánh dấu.'],
    ['db_error', 'Không lưu được do lỗi hệ thống. Dữ liệu bạn nhập vẫn còn, hãy thử lại.'],
    ['already_staff', 'Email này đã có tài khoản nhân viên.'],
    ['already_invited', 'Email này đang có lời mời chưa dùng. Hãy bấm Gửi lại.'],
    ['not_found', 'Không tìm thấy mục này. Có thể người khác vừa thay đổi; hãy tải lại trang.'],
    ['last_admin', 'Không thể hạ quyền, khóa hoặc xóa Admin cuối cùng.'],
    ['self', 'Bạn không thể tự khóa hoặc tự xóa tài khoản của mình.'],
    ['invalid_token', 'Lời mời không hợp lệ, đã hết hạn hoặc đã bị thu hồi.'],
  ] as const)('%s', (code, message) => expect(actionErrorMessage(code)).toBe(message));
});
```

Create `lib/admin/nav.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { navFor } from './nav';

describe('navFor', () => {
  it('shows each role only what its permissions open', () => {
    expect(navFor('admin').map((i) => i.label)).toEqual(['Tổng quan']);
    expect(navFor('editor').map((i) => i.label)).toEqual(['Tổng quan']);
  });
});
```

Run: `npx vitest run lib/admin/format.test.ts lib/admin/auth-errors.test.ts lib/admin/nav.test.ts`
Expected: FAIL, ba file đều `Error: Cannot find module './format'` / `'./auth-errors'` / `'./nav'`.

- [ ] **Bước 5: Viết bốn module của `lib/admin`**

Create `lib/admin/zod.ts`:

```ts
import * as z from 'zod';

/*
 * Every admin schema imports `z` from here, so zod's built-in messages are in
 * Vietnamese wherever the schema runs (server action or browser). z.config is
 * global to the zod instance; importing it here once is enough. Fields people
 * type into still get their own message (spec §7.3): the built-in ones are
 * generic ("Quá nhỏ: mong đợi string có >=12 ký tự").
 */
z.config(z.locales.vi());

export { z };
```

Create `lib/admin/format.ts` (đặt `new Date()` trong helper để luật `react(purity)` của oxlint không bắt trang):

```ts
import { VENUE_TZ } from '@/lib/venue-time';

/*
 * Dates in the admin: Vietnamese, on Vietnam's clock whatever the server's TZ
 * (Vercel runs in UTC) — spec §7.3. Formatters are built once; Intl objects
 * are expensive to create.
 */
const dateTime = new Intl.DateTimeFormat('vi-VN', {
  timeZone: VENUE_TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const longDate = new Intl.DateTimeFormat('vi-VN', { timeZone: VENUE_TZ, dateStyle: 'full' });

type DateInput = Date | string | number;

/** "00:30 02/10/2026" */
export function formatDateTimeVi(value: DateInput): string {
  return dateTime.format(new Date(value));
}

/** "Thứ Sáu, 2 tháng 10, 2026" */
export function formatLongDateVi(value: DateInput): string {
  return longDate.format(new Date(value));
}

/** Today's date in Vietnam, written out. Admin pages render at request time, so "now" is the request's. */
export function todayVi(now: Date = new Date()): string {
  return longDate.format(now);
}
```

Create `lib/admin/auth-errors.ts`:

```ts
import type { ActionCode } from '@/lib/server/action-result';

/*
 * What staff read when something is refused (spec §7.3), never English.
 * authErrorMessage: Better Auth's error codes (@better-auth/core
 * BASE_ERROR_CODES and the admin plugin's ADMIN_ERROR_CODES, better-auth
 * 1.7.7). A 429 from the rate limiter carries no code, only the status and an
 * X-Retry-After header in seconds.
 * actionErrorMessage: the codes our admin Server Actions return (spec §7.4).
 * Client components import this file, so it imports types only.
 */
const AUTH_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Email hoặc mật khẩu không đúng.',
  INVALID_EMAIL: 'Email không hợp lệ.',
  INVALID_PASSWORD: 'Mật khẩu không đúng.',
  BANNED_USER: 'Tài khoản này đã bị khóa. Liên hệ Admin để được mở lại.',
  INVALID_TOKEN: 'Liên kết không hợp lệ hoặc đã được dùng. Hãy yêu cầu một liên kết mới.',
  TOKEN_EXPIRED: 'Liên kết đã hết hạn. Hãy yêu cầu một liên kết mới.',
  PASSWORD_TOO_SHORT: 'Mật khẩu cần ít nhất 12 ký tự.',
  PASSWORD_TOO_LONG: 'Mật khẩu quá dài (tối đa 128 ký tự).',
  SESSION_EXPIRED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  USER_NOT_FOUND: 'Không tìm thấy tài khoản.',
  CREDENTIAL_ACCOUNT_NOT_FOUND: 'Tài khoản này chưa có mật khẩu. Hãy dùng "Quên mật khẩu".',
};

const AUTH_FALLBACK = 'Không đăng nhập được. Vui lòng thử lại sau ít phút.';

export function authErrorMessage(status: number, code?: string | null, retryAfterSeconds?: number | null): string {
  if (status === 429) {
    return retryAfterSeconds && retryAfterSeconds > 0
      ? `Bạn đã thử quá nhiều lần. Vui lòng thử lại sau ${retryAfterSeconds} giây.`
      : 'Bạn đã thử quá nhiều lần. Vui lòng đợi một lát rồi thử lại.';
  }
  return (code && AUTH_MESSAGES[code]) || AUTH_FALLBACK;
}

const ACTION_MESSAGES: Record<ActionCode, string> = {
  forbidden: 'Bạn không có quyền thực hiện thao tác này.',
  invalid: 'Dữ liệu chưa hợp lệ. Hãy kiểm tra các ô được đánh dấu.',
  db_error: 'Không lưu được do lỗi hệ thống. Dữ liệu bạn nhập vẫn còn, hãy thử lại.',
  already_staff: 'Email này đã có tài khoản nhân viên.',
  already_invited: 'Email này đang có lời mời chưa dùng. Hãy bấm Gửi lại.',
  not_found: 'Không tìm thấy mục này. Có thể người khác vừa thay đổi; hãy tải lại trang.',
  last_admin: 'Không thể hạ quyền, khóa hoặc xóa Admin cuối cùng.',
  self: 'Bạn không thể tự khóa hoặc tự xóa tài khoản của mình.',
  invalid_token: 'Lời mời không hợp lệ, đã hết hạn hoặc đã bị thu hồi.',
};

export function actionErrorMessage(code: ActionCode): string {
  return ACTION_MESSAGES[code];
}
```

Create `lib/admin/nav.ts` (mỗi đợt thêm mục của mình khi có trang):

```ts
import { roleCan, type Permissions, type StaffRole } from '@/lib/server/auth/permissions';

export type NavItem = { href: string; label: string; permission?: Permissions };

/*
 * The sidebar, in order. An item with a permission is shown only to roles
 * that have it; the page behind it checks again on the server. Each phase
 * appends its screens here as it builds them (spec §7.2).
 */
export const ADMIN_NAV: readonly NavItem[] = [{ href: '/admin', label: 'Tổng quan' }];

export function navFor(role: StaffRole): NavItem[] {
  return ADMIN_NAV.filter((item) => !item.permission || roleCan(role, item.permission));
}

export const ROLE_LABELS: Record<StaffRole, string> = { admin: 'Admin', editor: 'Editor' };
```

Run: `npx vitest run lib/admin/format.test.ts lib/admin/auth-errors.test.ts lib/admin/nav.test.ts`
Expected: PASS `Tests  18 passed (18)`

- [ ] **Bước 6: Viết test cho dạng kết quả của action**

Create `lib/server/action-result.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from '@/lib/admin/zod';
import { actionError } from './action-result';
import { PermissionError } from './dal/session';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('actionError', () => {
  it('answers forbidden for a missing session and for a missing permission alike', () => {
    expect(actionError(new PermissionError('unauthenticated'))).toEqual({ ok: false, code: 'forbidden' });
    expect(actionError(new PermissionError('forbidden'))).toEqual({ ok: false, code: 'forbidden' });
  });

  it('turns a ZodError into invalid, with zod’s messages in Vietnamese', () => {
    const parsed = z.object({ email: z.email(), role: z.enum(['admin', 'editor']) }).safeParse({ email: 'x', role: 'owner' });
    const result = actionError(parsed.error);
    expect(result.code).toBe('invalid');
    expect(result.fieldErrors?.email).toEqual(['địa chỉ email không hợp lệ']);
    expect(result.fieldErrors?.role?.[0]).toMatch(/^Tùy chọn không hợp lệ/);
  });

  it('logs anything else by name only and answers db_error', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(actionError(new TypeError('secret detail owner@furama.test'))).toEqual({ ok: false, code: 'db_error' });
    expect(logged).toHaveBeenCalledWith('[admin] action failed', { code: 'db_error', name: 'TypeError' });
    expect(JSON.stringify(logged.mock.calls)).not.toContain('secret');
  });
});
```

Run: `npx vitest run lib/server/action-result.test.ts`
Expected: FAIL `Error: Cannot find module './action-result' imported from …/lib/server/action-result.test.ts`

- [ ] **Bước 7: Viết Better Auth của app, DAL và dạng kết quả**

`getAuth()` truyền `backgroundTask: (task) => after(task)`, nên email đặt lại mật khẩu chạy sau câu trả lời (Task 2, Bước 4). `after()` dùng được trong Server Action và route handler (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md:8`), là hai nơi duy nhất gọi `/request-password-reset`.

Create `lib/server/auth/auth.ts`:

```ts
import 'server-only';
import { after } from 'next/server';
import { getPool } from '@/db/client';
import { sendPasswordReset } from '@/lib/server/email/auth-emails';
import { createAuth, type Auth } from './config';

/*
 * The app's Better Auth instance. Built on first use, never at import time:
 * `next build` loads route modules while collecting page data and runs admin
 * pages up to their first request-time call, and getPool() throws without
 * DATABASE_URL. So the build needs no BETTER_AUTH_* variable.
 */
let instance: Auth | undefined;

export function getAuth(): Auth {
  instance ??= createAuth({
    pool: getPool(),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    // The bootstrap exception lives in scripts/create-admin.mjs only: the app
    // never admits an email without an invitation, whatever the environment holds.
    bootstrapAdminEmail: undefined,
    sendResetPassword: (email) => sendPasswordReset(email),
    // The reset email runs after the response, so its timing says nothing about
    // whether the address has an account. after() keeps a Vercel function alive
    // until it settles (next/dist/docs/01-app/03-api-reference/04-functions/after.md:250).
    backgroundTask: (task) => after(task),
  });
  return instance;
}
```

Create `lib/server/dal/session.ts`. `headers()` đứng trước `getAuth()`: lúc kiểm chứng của spike, đặt ngược lại khiến build tạo Better Auth và log `You are using the default secret`.

```ts
import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { ADMIN_SIGN_IN } from '@/lib/admin/paths';
import type { AuditActor } from '@/lib/server/audit';
import { getAuth } from '@/lib/server/auth/auth';
import { isStaffRole, roleCan, type Permissions, type StaffRole } from '@/lib/server/auth/permissions';

/*
 * The admin's data access layer (spec §4 dal/, §7.1 "Bảo vệ theo lớp";
 * node_modules/next/dist/docs/01-app/02-guides/authentication.md, "Creating a
 * Data Access Layer"). Every read goes to the database: the cookie cache is
 * off, so a role change, a ban or a removal applies on the next request.
 */

export type StaffSession = {
  userId: string;
  email: string;
  name: string;
  role: StaffRole;
  /** For audit_log.ip: the first X-Forwarded-For address (Vercel sets one, the client's). */
  ip: string | null;
};

export class PermissionError extends Error {
  constructor(readonly code: 'unauthenticated' | 'forbidden') {
    super(code);
    this.name = 'PermissionError';
  }
}

/** The signed-in staff member, or null. One lookup per request (React cache). */
export const getStaffSession = cache(async (): Promise<StaffSession | null> => {
  // headers() before anything else: `next build` runs admin pages up to their
  // first request-time call, and getAuth() before it would build Better Auth
  // (and the pool) at build time.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const { user } = session;
  if (user.banned || !isStaffRole(user.role)) return null;
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    ip: requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
  };
});

/** Pages: the staff member, or a redirect to sign-in. */
export async function verifySession(): Promise<StaffSession> {
  const staff = await getStaffSession();
  if (!staff) redirect(ADMIN_SIGN_IN);
  return staff;
}

/**
 * Server Actions and route handlers, as their first statement: the staff
 * member if their role grants every requested action, else a PermissionError
 * that actionError() turns into `{ ok: false, code: 'forbidden' }`.
 */
export async function requirePermission(permissions: Permissions): Promise<StaffSession> {
  const staff = await getStaffSession();
  if (!staff) throw new PermissionError('unauthenticated');
  if (!roleCan(staff.role, permissions)) throw new PermissionError('forbidden');
  return staff;
}

/** Who did it, for insertAudit and the invitation email. */
export function auditActor(staff: StaffSession): AuditActor {
  return { id: staff.userId, email: staff.email, name: staff.name, ip: staff.ip };
}
```

Create `lib/server/action-result.ts`:

```ts
import 'server-only';
import { z } from '@/lib/admin/zod';
import { PermissionError } from '@/lib/server/dal/session';

/*
 * What every admin Server Action returns (spec §7.4), and how a thrown error
 * becomes one. Actions never throw to the client: a PermissionError is
 * `forbidden` (unauthenticated included: the browser learns nothing more), a
 * ZodError is `invalid` with Vietnamese field messages, anything else is a
 * logged `db_error` whose message is never echoed.
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
  | 'invalid_token';

export type ActionFailure = { ok: false; code: ActionCode; fieldErrors?: Record<string, string[] | undefined> };
export type ActionResult<T = null> = { ok: true; data: T } | ActionFailure;

export function actionError(err: unknown): ActionFailure {
  if (err instanceof PermissionError) return { ok: false, code: 'forbidden' };
  if (err instanceof z.ZodError) return { ok: false, code: 'invalid', fieldErrors: z.flattenError(err).fieldErrors };
  console.error('[admin] action failed', { code: 'db_error', name: err instanceof Error ? err.name : typeof err });
  return { ok: false, code: 'db_error' };
}
```

Run: `npx vitest run lib/server/action-result.test.ts`
Expected: PASS `Tests  3 passed (3)`

- [ ] **Bước 8: Viết test cho lời gọi router Better Auth trong process**

Create `lib/server/auth/endpoint.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The Server Actions behind sign-in and reset call Better Auth's own HTTP
 * router in process, so its rate limit and origin check apply (spec §7.1, §7.3).
 * What they pass on is an allowlist: never the visitor's cookies.
 */

const handler = vi.fn<(request: Request) => Promise<Response>>();
const incoming = new Headers({
  cookie: 'better-auth.session_token=someone-else',
  'x-forwarded-for': '203.0.113.5',
  'x-real-ip': '203.0.113.5',
  'user-agent': 'UA/1',
  origin: 'https://evil.example',
  'x-other': 'x',
});
const jar = { set: vi.fn() };

vi.mock('next/headers', () => ({ headers: async () => incoming, cookies: async () => jar }));
vi.mock('./auth', () => ({
  getAuth: () => ({ handler, $context: Promise.resolve({ baseURL: 'http://localhost:3210/api/auth' }) }),
}));

const { applySetCookies, callAuthEndpoint } = await import('./endpoint');

beforeEach(() => {
  handler.mockReset();
  handler.mockResolvedValue(new Response('{}'));
  jar.set.mockReset();
});

describe('callAuthEndpoint', () => {
  it('POSTs JSON from the app’s own origin, forwarding only the client address and user agent', async () => {
    await callAuthEndpoint('/sign-in/email', { email: 'a@furama.test', password: 'x' });
    const request = handler.mock.calls[0][0];
    expect(request.method).toBe('POST');
    expect(request.url).toBe('http://localhost:3210/api/auth/sign-in/email');
    expect(Object.fromEntries(request.headers)).toEqual({
      'content-type': 'application/json',
      origin: 'http://localhost:3210',
      'x-forwarded-for': '203.0.113.5',
      'x-real-ip': '203.0.113.5',
      'user-agent': 'UA/1',
    });
    expect(await request.json()).toEqual({ email: 'a@furama.test', password: 'x' });
  });
});

describe('applySetCookies', () => {
  it('copies each Set-Cookie into the action’s response with its attributes', async () => {
    const res = new Response(null, {
      headers: [
        ['set-cookie', 'better-auth.session_token=abc.def; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax'],
        ['set-cookie', 'other=1; Path=/admin; Secure'],
      ],
    });
    await applySetCookies(res);
    expect(jar.set).toHaveBeenCalledWith(
      'better-auth.session_token',
      'abc.def',
      expect.objectContaining({ maxAge: 604800, path: '/', httpOnly: true, sameSite: 'lax' }),
    );
    expect(jar.set).toHaveBeenCalledWith('other', '1', expect.objectContaining({ path: '/admin', secure: true }));
  });
});
```

Run: `npx vitest run lib/server/auth/endpoint.test.ts`
Expected: FAIL `Error: Cannot find module '/lib/server/auth/endpoint' imported from …/lib/server/auth/endpoint.test.ts`

- [ ] **Bước 9: Viết `endpoint.ts`**

Giới hạn số lần thử chỉ chạy trong `onRequest` của router (`node_modules/better-auth/dist/api/index.mjs:172`), và `nextCookies()` bỏ qua lời gọi qua router (`node_modules/better-auth/dist/integrations/next-js.mjs:48,78`), nên action tự chép `Set-Cookie`. `origin` là origin của baseURL; CSRF của Server Action do Next chặn bằng so sánh Origin với Host (`node_modules/next/dist/docs/01-app/02-guides/server-actions.md:82`).

Create `lib/server/auth/endpoint.ts`:

```ts
import 'server-only';
import { parseSetCookieHeader, toCookieOptions } from 'better-auth/cookies';
import { cookies, headers } from 'next/headers';
import { getAuth } from './auth';

/*
 * Sign-in and both reset steps are Server Actions (useActionState, spec §7.3)
 * that call Better Auth's HTTP router in process instead of auth.api.*: only
 * the router applies the rate limit stored in auth_rate_limit (spec §7.1) and
 * the origin check (better-auth/dist/api/index.mjs:172). nextCookies() does
 * nothing for router calls, so the action copies Set-Cookie itself.
 */

/** What reaches Better Auth from the visitor's request: its address (rate limit, session) and user agent. Never cookies. */
const FORWARDED = ['x-forwarded-for', 'x-real-ip', 'user-agent'] as const;

export async function callAuthEndpoint(path: `/${string}`, body: unknown): Promise<Response> {
  const incoming = await headers();
  const auth = getAuth();
  const { baseURL } = await auth.$context; // e.g. http://localhost:3200/api/auth
  const forwarded = new Headers({ 'content-type': 'application/json', origin: new URL(baseURL).origin });
  for (const name of FORWARDED) {
    const value = incoming.get(name);
    if (value) forwarded.set(name, value);
  }
  return auth.handler(new Request(`${baseURL}${path}`, { method: 'POST', headers: forwarded, body: JSON.stringify(body) }));
}

/** Puts every cookie Better Auth set on `res` onto the Server Action's own response. */
export async function applySetCookies(res: Response): Promise<void> {
  const jar = await cookies();
  for (const header of res.headers.getSetCookie()) {
    for (const [name, attributes] of parseSetCookieHeader(header)) {
      jar.set(name, attributes.value, toCookieOptions(attributes));
    }
  }
}
```

Run: `npx vitest run lib/server/auth/endpoint.test.ts`
Expected: PASS `Tests  2 passed (2)`

- [ ] **Bước 10: Viết guard CI cho Server Action**

Create `test/guards/require-permission.guard.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adminPluginCalls, adminPluginCallsIn, checkActions, publicActionsMissing, scanRepo } from './server-actions';

/*
 * Spec §7.1 / §13 "Bảo vệ": every Server Action ('use server' export or inline
 * 'use server' function) and every /api/admin/* route handler checks
 * requirePermission as its first statement, so nothing runs before the check.
 * The exceptions are public on purpose, and each says what protects it.
 */
const PUBLIC_ACTIONS = new Map([
  ['app/actions.ts#submitReservation', 'zod, the slot and window checks, the per-table unique index (spec §7.1)'],
  ['app/admin/(auth)/sign-in/actions.ts#signIn', 'Better Auth checks the password, rate-limited per IP in auth_rate_limit'],
  ['app/admin/(shell)/actions.ts#signOut', 'ends only the session of the cookie it is sent with'],
]);

const ROOT = join(__dirname, '..', '..');

describe('requirePermission guard (the repository)', () => {
  it('every Server Action and /api/admin route handler checks requirePermission first, except the public list', () => {
    expect(scanRepo(ROOT, new Set(PUBLIC_ACTIONS.keys()))).toEqual([]);
  });

  it('every public action on the list still exists (a renamed one would leave a stale exception)', () => {
    expect(publicActionsMissing(ROOT, [...PUBLIC_ACTIONS.keys()])).toEqual([]);
  });

  it('the admin plugin’s endpoints are called only from lib/server/auth/staff.ts and scripts/create-admin.mjs', () => {
    expect(adminPluginCalls(ROOT)).toEqual([]);
  });
});

describe('requirePermission guard (what it catches)', () => {
  const none = new Set<string>();
  const check = (source: string, rel = 'app/x/actions.ts', allow = none) => checkActions(rel, source, allow);

  it('an exported action that never checks', () => {
    expect(check(`'use server';\nexport async function ok() { await requirePermission({ user: ['list'] }); }\nexport const bad = async () => {};`)).toEqual([
      'app/x/actions.ts#bad: does not start with await requirePermission()',
    ]);
  });

  it('a check that comes after a side effect', () => {
    expect(check(`'use server';\nexport async function late() { await db.query('DELETE'); await requirePermission({}); }`)).toEqual([
      'app/x/actions.ts#late: does not start with await requirePermission()',
    ]);
  });

  it('a check that is not awaited, or runs only under a condition', () => {
    const source = `'use server';
export async function a() { requirePermission({ user: ['ban'] }); await write(); }
export async function b(x) { if (x) await requirePermission({ user: ['ban'] }); await write(); }`;
    expect(check(source)).toEqual([
      'app/x/actions.ts#a: does not start with await requirePermission()',
      'app/x/actions.ts#b: does not start with await requirePermission()',
    ]);
  });

  it('accepts the check as the first statement of a top-level try', () => {
    expect(
      check(`'use server';\nexport async function a(x) {\n  try {\n    const actor = await requirePermission({ user: ['ban'] });\n    return actor;\n  } catch (e) { return e; }\n}`),
    ).toEqual([]);
  });

  it('a try whose catch lets a failed check fall through, or that has a finally', () => {
    const source = `'use server';
export async function a() {
  try { await requirePermission({ user: ['ban'] }); } catch {}
  await write();
}
export async function b() {
  try { await requirePermission({ user: ['ban'] }); } finally { await write(); }
}`;
    const fallsThrough = 'a failed requirePermission() can fall through its try (end the catch with return or throw; no finally)';
    expect(check(source)).toEqual([`app/x/actions.ts#a: ${fallsThrough}`, `app/x/actions.ts#b: ${fallsThrough}`]);
  });

  it('an export that is not a function declared in the file', () => {
    expect(check(`'use server';\nexport { other } from './elsewhere';\nexport const n = 1;`)).toEqual([
      'app/x/actions.ts#other: export the action as a function declared in this file',
      'app/x/actions.ts#n: export the action as a function declared in this file',
    ]);
  });

  it('an inline action without the check', () => {
    expect(check(`export function Page() { async function save() { 'use server'; await write(); } return save; }`, 'app/x/page.tsx')).toEqual([
      "app/x/page.tsx: inline 'use server' function save: does not start with await requirePermission()",
    ]);
  });

  it('a route handler under app/api/admin', () => {
    expect(check(`export async function POST(req) { return Response.json(await req.json()); }`, 'app/api/admin/x/route.ts')).toEqual([
      'app/api/admin/x/route.ts#POST: does not start with await requirePermission()',
    ]);
  });

  it('scans every directory of app code, and every route under app/api/admin for every method', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-'));
    const put = (rel: string, source: string) => {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), source);
    };
    const unchecked = `'use server';\nexport async function wipe() { await write(); }`;
    put('db/actions.ts', unchecked);
    put('actions.mjs', unchecked);
    put('app/api/admin/route.ts', 'export function HEAD() { return new Response(null); }\nexport function OPTIONS() { return new Response(null); }');
    for (const skipped of ['test/actions.ts', 'e2e/actions.ts', 'node_modules/x/actions.ts', '.claude/actions.ts', 'app/x/actions.test.ts']) {
      put(skipped, unchecked);
    }
    expect(scanRepo(root, none).sort()).toEqual([
      'actions.mjs#wipe: does not start with await requirePermission()',
      'app/api/admin/route.ts#HEAD: does not start with await requirePermission()',
      'app/api/admin/route.ts#OPTIONS: does not start with await requirePermission()',
      'db/actions.ts#wipe: does not start with await requirePermission()',
    ]);
  });

  it('an admin plugin endpoint outside the two allowed files, called or destructured', () => {
    const source = `export async function a(auth) {
  await auth.api.adminUpdateUser({ body: { userId: 'u', data: { role: 'admin' } } });
  const { setRole, getSession } = auth.api;
  const { api: { revokeUserSessions } } = auth;
  return [setRole, getSession, revokeUserSessions];
}`;
    expect(adminPluginCallsIn('app/x/actions.ts', source)).toEqual([
      'app/x/actions.ts: auth.api.adminUpdateUser',
      'app/x/actions.ts: auth.api.setRole',
      'app/x/actions.ts: auth.api.revokeUserSessions',
    ]);
    expect(adminPluginCallsIn('lib/server/auth/staff.ts', source)).toEqual([]);
  });

  it('the public list exempts exactly the named export', () => {
    const source = `'use server';\nexport async function signIn() {}\nexport async function other() {}`;
    expect(check(source, 'app/a/actions.ts', new Set(['app/a/actions.ts#signIn']))).toEqual([
      'app/a/actions.ts#other: does not start with await requirePermission()',
    ]);
  });
});
```

Run: `npx vitest run test/guards`
Expected: FAIL `Error: Cannot find module './server-actions' imported from …/test/guards/require-permission.guard.test.ts`

Create `test/guards/server-actions.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { admin } from 'better-auth/plugins/admin';
import { parseSync } from 'oxc-parser';
import { ac, roles } from '../../lib/server/auth/permissions';

/*
 * The scanner behind test/guards/require-permission.guard.test.ts. TypeScript
 * 7 has no JS compiler API, so it parses with oxc-parser (the parser behind
 * oxlint) and walks the ESTree.
 */

type Node = { type: string; [key: string]: unknown };

/** Top-level directories that hold no app code; dot-directories and node_modules are skipped everywhere. */
const NOT_APP_CODE = new Set(['e2e', 'test', 'docs', 'design-src', 'public', 'playwright-report', 'test-results']);
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const ADMIN_ROUTE = /^app\/api\/admin\/(?:.*\/)?route\.[jt]sx?$/;
const NOT_FIRST = 'does not start with await requirePermission()';
const FALLS_THROUGH = 'a failed requirePermission() can fall through its try (end the catch with return or throw; no finally)';

/** Every source file under `dir` except tests and type declarations. */
function files(dir: string, top = false): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) {
      const skip = e.name === 'node_modules' || e.name.startsWith('.') || (top && NOT_APP_CODE.has(e.name));
      return skip ? [] : files(path);
    }
    return SOURCE.test(e.name) && !/\.test\.[jt]sx?$/.test(e.name) && !/\.d\.[cm]?ts$/.test(e.name) ? [path] : [];
  });
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as Node).type === 'string';
}

function walk(node: unknown, visit: (n: Node) => void): void {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (!isNode(node)) return;
  visit(node);
  for (const [key, value] of Object.entries(node)) if (key !== 'parent') walk(value, visit);
}

const isFunction = (n: unknown): n is Node =>
  isNode(n) && ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(n.type);

/** Statements of a function body, directives ('use server') left out. */
function statements(fn: Node): Node[] {
  const body = fn.body as Node | null;
  if (!body || body.type !== 'BlockStatement') return [];
  return (body.body as Node[]).filter((s) => !(s.type === 'ExpressionStatement' && typeof s.directive === 'string'));
}

/** `await requirePermission(…)` as a statement, or as the one initializer of a declaration. */
function awaitsCheck(statement: Node | undefined): boolean {
  const awaited = (e: unknown): boolean => {
    if (!isNode(e) || e.type !== 'AwaitExpression' || !isNode(e.argument) || e.argument.type !== 'CallExpression') return false;
    const callee = e.argument.callee as Node;
    return callee.type === 'Identifier' && callee.name === 'requirePermission';
  };
  if (statement?.type === 'ExpressionStatement') return awaited(statement.expression);
  if (statement?.type === 'VariableDeclaration') {
    const declarations = statement.declarations as Node[];
    return declarations.length === 1 && awaited(declarations[0].init);
  }
  return false;
}

/**
 * Why a function does not check first, or null. Its first statement must await
 * requirePermission(…) (not call it without await, not under a condition), or
 * be a try that starts so. That try's catch must end in return or throw, so no
 * code after the try runs when the check fails, and it may have no finally,
 * which would run anyway.
 */
function firstStatementProblem(fn: Node): string | null {
  const [first] = statements(fn);
  if (first?.type !== 'TryStatement') return awaitsCheck(first) ? null : NOT_FIRST;
  if (!awaitsCheck(((first.block as Node).body as Node[])[0])) return NOT_FIRST;
  const handler = first.handler as Node | null;
  const last = handler ? ((handler.body as Node).body as Node[]).at(-1) : undefined;
  const exits = !handler || last?.type === 'ReturnStatement' || last?.type === 'ThrowStatement';
  return exits && !first.finalizer ? null : FALLS_THROUGH;
}

export function checksFirst(fn: Node): boolean {
  return firstStatementProblem(fn) === null;
}

function hasUseServer(fn: Node): boolean {
  const body = fn.body as Node | null;
  return (
    body?.type === 'BlockStatement' &&
    (body.body as Node[]).some((s) => s.type === 'ExpressionStatement' && s.directive === 'use server')
  );
}

/** name → function node for every exported binding of a module. */
export function exportedFunctions(program: Node): { name: string; fn: Node | null }[] {
  const locals = new Map<string, Node>();
  for (const s of program.body as Node[]) {
    const decl = s.type === 'ExportNamedDeclaration' ? (s.declaration as Node | null) : s;
    if (decl?.type === 'FunctionDeclaration' && decl.id) locals.set((decl.id as Node).name as string, decl);
    if (decl?.type === 'VariableDeclaration') {
      for (const d of decl.declarations as Node[]) if (isFunction(d.init)) locals.set((d.id as Node).name as string, d.init);
    }
  }
  const out: { name: string; fn: Node | null }[] = [];
  for (const s of program.body as Node[]) {
    if (s.type === 'ExportDefaultDeclaration') out.push({ name: 'default', fn: isFunction(s.declaration) ? s.declaration : null });
    if (s.type === 'ExportAllDeclaration') out.push({ name: '*', fn: null });
    if (s.type !== 'ExportNamedDeclaration' || s.exportKind === 'type') continue;
    const decl = s.declaration as Node | null;
    if (decl?.type === 'FunctionDeclaration') out.push({ name: (decl.id as Node).name as string, fn: decl });
    if (decl?.type === 'VariableDeclaration') {
      for (const d of decl.declarations as Node[]) out.push({ name: (d.id as Node).name as string, fn: isFunction(d.init) ? d.init : null });
    }
    for (const spec of (s.specifiers as Node[]) ?? []) {
      if (spec.exportKind === 'type') continue;
      const local = (spec.local as Node).name as string;
      out.push({ name: (spec.exported as Node).name as string, fn: s.source ? null : (locals.get(local) ?? null) });
    }
  }
  return out;
}

function parse(rel: string, source: string): Node {
  const { program, errors } = parseSync(rel, source);
  if (errors.length) throw new Error(`${rel}: parse error ${errors[0]?.message}`);
  return program as unknown as Node;
}

/** Problems in one source file (`rel` is relative to the repository root). */
export function checkActions(rel: string, source: string, publicActions: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const program = parse(rel, source);
  const fileLevel = (program.body as Node[]).some((s) => s.type === 'ExpressionStatement' && s.directive === 'use server');

  if (fileLevel) {
    for (const { name, fn } of exportedFunctions(program)) {
      if (publicActions.has(`${rel}#${name}`)) continue;
      const problem = fn ? firstStatementProblem(fn) : 'export the action as a function declared in this file';
      if (problem) problems.push(`${rel}#${name}: ${problem}`);
    }
  }
  walk(program, (n) => {
    const problem = isFunction(n) && hasUseServer(n) ? firstStatementProblem(n) : null;
    if (problem) {
      const name = ((n.id as Node | null)?.name as string | undefined) ?? 'anonymous';
      problems.push(`${rel}: inline 'use server' function ${name}: ${problem}`);
    }
  });
  if (ADMIN_ROUTE.test(rel)) {
    for (const { name, fn } of exportedFunctions(program)) {
      const problem = !HTTP_METHODS.has(name) ? null : fn ? firstStatementProblem(fn) : NOT_FIRST;
      if (problem) problems.push(`${rel}#${name}: ${problem}`);
    }
  }
  return problems;
}

/** Every source file of the repository that could hold app code, relative to `root`. */
const sourceFiles = (root: string) => files(root, true).map((f) => relative(root, f));

export function scanRepo(root: string, publicActions: ReadonlySet<string>): string[] {
  return sourceFiles(root).flatMap((rel) => {
    const source = readFileSync(join(root, rel), 'utf8');
    if (!source.includes('use server') && !ADMIN_ROUTE.test(rel)) return [];
    return checkActions(rel, source, publicActions);
  });
}

/** Allowlist entries ("file#export") that no longer name an exported function. */
export function publicActionsMissing(root: string, entries: readonly string[]): string[] {
  return entries.filter((entry) => {
    const [rel, name] = entry.split('#');
    let source: string;
    try {
      source = readFileSync(join(root, rel), 'utf8');
    } catch {
      return true;
    }
    return !exportedFunctions(parse(rel, source)).some((e) => e.name === name && e.fn);
  });
}

/*
 * The admin plugin's endpoints write staff accounts outside our transaction
 * and without our last-Admin check (lib/server/auth/staff.ts says why), so only
 * that file and the bootstrap script may call them. The list comes from the
 * plugin itself (15 endpoints in 1.7.7, adminUpdateUser among them), so an
 * upgrade that adds one is covered. Read from the syntax tree, so comments
 * that name an endpoint do not count.
 */
export const ADMIN_PLUGIN_ENDPOINTS: readonly string[] = Object.keys(admin({ ac, roles }).endpoints);
const ADMIN_PLUGIN_CALLERS = new Set(['lib/server/auth/staff.ts', 'scripts/create-admin.mjs']);

const isEndpoint = (name: unknown): name is string => typeof name === 'string' && ADMIN_PLUGIN_ENDPOINTS.includes(name);

const keyName = (property: Node): unknown => {
  const key = property.key as Node | undefined;
  return key?.type === 'Identifier' ? key.name : key?.type === 'Literal' ? key.value : undefined;
};

/** `x.api` or a bare `api`, through await, parentheses and TypeScript casts. */
function isApiObject(node: unknown): boolean {
  let n = node;
  while (isNode(n) && ['AwaitExpression', 'ParenthesizedExpression', 'TSAsExpression', 'TSNonNullExpression'].includes(n.type)) {
    n = n.type === 'AwaitExpression' ? n.argument : n.expression;
  }
  if (!isNode(n)) return false;
  if (n.type === 'Identifier') return n.name === 'api';
  return n.type === 'MemberExpression' && !n.computed && (n.property as Node).name === 'api';
}

/**
 * Endpoints read off an `.api` object: `auth.api.setRole`, `api['setRole']`,
 * `const { setRole } = auth.api` and `const { api: { setRole } } = auth`.
 */
function endpointUses(program: Node): string[] {
  const found: string[] = [];
  const take = (pattern: unknown) => {
    if (!isNode(pattern) || pattern.type !== 'ObjectPattern') return;
    for (const property of pattern.properties as Node[]) {
      const name = keyName(property);
      if (property.type === 'Property' && isEndpoint(name)) found.push(name);
    }
  };
  walk(program, (n) => {
    if (n.type === 'MemberExpression' && isApiObject(n.object)) {
      const property = n.property as Node;
      const name = n.computed ? (property.type === 'Literal' ? property.value : undefined) : property.name;
      if (isEndpoint(name)) found.push(name);
    }
    if (n.type === 'VariableDeclarator' && isApiObject(n.init)) take(n.id);
    if (n.type === 'AssignmentExpression' && isApiObject(n.right)) take(n.left);
    if (n.type === 'ObjectPattern') {
      for (const property of n.properties as Node[]) if (property.type === 'Property' && keyName(property) === 'api') take(property.value);
    }
  });
  return found;
}

export function adminPluginCallsIn(rel: string, source: string): string[] {
  if (ADMIN_PLUGIN_CALLERS.has(rel) || !ADMIN_PLUGIN_ENDPOINTS.some((name) => source.includes(name))) return [];
  return endpointUses(parse(rel, source)).map((name) => `${rel}: auth.api.${name}`);
}

export function adminPluginCalls(root: string): string[] {
  return sourceFiles(root).flatMap((rel) => adminPluginCallsIn(rel, readFileSync(join(root, rel), 'utf8')));
}
```

Run: `npx vitest run test/guards`
Expected: FAIL `Tests  1 failed | 13 passed (14)`: `× every public action on the list still exists (a renamed one would leave a stale exception)` — `signIn` và `signOut` chưa có. Hai bước sau tạo chúng.

- [ ] **Bước 11: Viết action và form đăng nhập**

Create `app/admin/(auth)/sign-in/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { authErrorMessage } from '@/lib/admin/auth-errors';
import { safeAdminNext } from '@/lib/admin/paths';
import { z } from '@/lib/admin/zod';
import { applySetCookies, callAuthEndpoint } from '@/lib/server/auth/endpoint';

export type SignInState = {
  email: string;
  message?: string;
  fieldErrors?: { email?: string[]; password?: string[] };
} | null;

const schema = z.object({
  email: z.email({ error: 'Nhập email công việc, ví dụ ten@furamavietnam.com.' }),
  password: z.string().min(1, { error: 'Nhập mật khẩu.' }),
});

/*
 * Public action (no session yet; on the CI guard's allowlist). It goes
 * through Better Auth's HTTP router (lib/server/auth/endpoint.ts), so the
 * attempt counts toward the rate limit in auth_rate_limit: 3 per 10 s per IP.
 */
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim();
  const parsed = schema.safeParse({ email, password: formData.get('password') ?? '' });
  if (!parsed.success) return { email, fieldErrors: z.flattenError(parsed.error).fieldErrors };

  let res: Response;
  try {
    // rememberMe: the 7-day session (spec §7.1), never a browser-session cookie.
    res = await callAuthEndpoint('/sign-in/email', { ...parsed.data, rememberMe: true });
  } catch (error) {
    console.error('[admin] sign-in failed', { name: error instanceof Error ? error.name : typeof error });
    return { email, message: authErrorMessage(500) };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    return { email, message: authErrorMessage(res.status, body?.code, Number(res.headers.get('x-retry-after')) || null) };
  }
  await applySetCookies(res);
  redirect(safeAdminNext(formData.get('next')));
}
```

Create `app/admin/(auth)/sign-in/SignInForm.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { signIn, type SignInState } from './actions';

export function SignInForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, null);
  const errors = state?.fieldErrors ?? {};

  return (
    <form action={action} noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {state?.message ? (
        <p className="a-alert" role="alert">
          {state.message}
        </p>
      ) : null}

      <div className="a-field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={state?.email ?? ''}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? 'email-error' : undefined}
        />
        {errors.email ? (
          <p className="a-field-error" id="email-error">
            {errors.email[0]}
          </p>
        ) : null}
      </div>

      <div className="a-field">
        <label htmlFor="password">Mật khẩu</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={errors.password ? 'password-error' : undefined}
        />
        {errors.password ? (
          <p className="a-field-error" id="password-error">
            {errors.password[0]}
          </p>
        ) : null}
      </div>

      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang đăng nhập…' : 'Đăng nhập'}
      </button>
    </form>
  );
}
```

Thay toàn bộ `app/admin/(auth)/sign-in/page.tsx` bằng:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { safeAdminNext } from '@/lib/admin/paths';
import { getStaffSession } from '@/lib/server/dal/session';
import { SignInForm } from './SignInForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Đăng nhập' };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  const target = typeof next === 'string' ? next : undefined;
  if (await getStaffSession()) redirect(safeAdminNext(target));

  return (
    <section className="a-card" aria-labelledby="sign-in-title">
      <h1 id="sign-in-title">Đăng nhập</h1>
      <p className="a-lede">Trang quản trị Furama Cuisine</p>
      <SignInForm next={target} />
      <p className="a-card-foot">
        <Link href="/admin/reset-password">Quên mật khẩu?</Link>
      </p>
    </section>
  );
}
```

- [ ] **Bước 12: Viết khung admin, đăng xuất, trang Tổng quan, ranh giới lỗi và route Better Auth**

Create `app/admin/(shell)/actions.ts`:

```ts
'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_SIGN_IN } from '@/lib/admin/paths';
import { getAuth } from '@/lib/server/auth/auth';

/* Public action (on the CI guard's allowlist): it ends only the session whose cookie it carries, if any. */
export async function signOut(): Promise<void> {
  try {
    await getAuth().api.signOut({ headers: await headers() }); // nextCookies() clears the cookies
  } catch {
    // No session, or it already expired: nothing to end.
  }
  redirect(ADMIN_SIGN_IN);
}
```

Create `app/admin/(shell)/NavLinks.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/* Marks the current page; the item list comes from the server, already filtered by role. */
export function NavLinks({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <ul>
      {items.map((item) => {
        const current = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
        return (
          <li key={item.href}>
            <Link href={item.href} aria-current={current ? 'page' : undefined}>
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
```

Create `app/admin/(shell)/layout.tsx`:

```tsx
import Link from 'next/link';
import { navFor, ROLE_LABELS } from '@/lib/admin/nav';
import { verifySession } from '@/lib/server/dal/session';
import { signOut } from './actions';
import { NavLinks } from './NavLinks';

/*
 * The signed-in frame. The session read here only shapes the UI (who is
 * signed in, which links to show); it is not the access check: layouts do not
 * re-run on client navigation (authentication.md:1350-1360), so every page
 * calls verifySession() or requirePagePermission() itself.
 */
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const staff = await verifySession();
  const items = navFor(staff.role).map(({ href, label }) => ({ href, label }));

  return (
    <div className="a-shell">
      <aside className="a-sidebar">
        <Link className="a-brand" href="/admin">
          Furama Cuisine
          <small>Quản trị</small>
        </Link>
        <nav className="a-nav" aria-label="Điều hướng quản trị">
          <NavLinks items={items} />
        </nav>
      </aside>
      <div className="a-main-col">
        <header className="a-header">
          <div className="a-user">
            <span data-testid="staff-name">{staff.name}</span>
            <small>
              {staff.email} · {ROLE_LABELS[staff.role]}
            </small>
          </div>
          <form action={signOut}>
            <button className="a-btn a-btn--ghost" type="submit">
              Đăng xuất
            </button>
          </form>
        </header>
        <main className="a-main">{children}</main>
      </div>
    </div>
  );
}
```

Create `app/admin/(shell)/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { todayVi } from '@/lib/admin/format';
import { verifySession } from '@/lib/server/dal/session';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Tổng quan' };

export default async function OverviewPage() {
  const staff = await verifySession();
  return (
    <>
      <h1>Tổng quan</h1>
      <p className="a-lede">
        Xin chào, {staff.name}. Hôm nay là <time data-testid="today">{todayVi()}</time>.
      </p>
    </>
  );
}
```

Create `app/admin/(shell)/error.tsx` (prop là `retry`, `error.md:27-30`):

```tsx
'use client';

import { useEffect } from 'react';

/*
 * An admin page failed to render (the database is down, a bug). It sits
 * inside the shell, so the menu and sign-out still work. Never show
 * error.message: production minifies it; the digest matches the server log.
 */
export default function AdminError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error('admin_render_failed', error.digest ?? error.message);
  }, [error]);

  return (
    <>
      <h1>Không tải được trang</h1>
      <p className="a-lede">
        {`Đã có lỗi khi tải trang này. Hãy thử lại; nếu vẫn lỗi, báo cho Admin${error.digest ? ` (mã lỗi ${error.digest})` : ''}.`}
      </p>
      <button className="a-btn" type="button" onClick={() => retry()}>
        Thử lại
      </button>
    </>
  );
}
```

Create `app/api/auth/[...all]/route.ts`:

```ts
import { getAuth } from '@/lib/server/auth/auth';
import { ADMIN_ENDPOINT_BLOCKED } from '@/lib/server/auth/config';

/*
 * Better Auth's HTTP endpoints. The admin plugin's /admin/* endpoints are
 * server-only (spec §7.1): hooks.before in lib/server/auth/config.ts refuses
 * them, and so does this check, which does not rely on Better Auth internals.
 * getAuth() is lazy, so `next build` needs no auth variables.
 */
async function handle(request: Request): Promise<Response> {
  if (new URL(request.url).pathname.startsWith('/api/auth/admin/')) {
    return Response.json({ code: ADMIN_ENDPOINT_BLOCKED }, { status: 403 });
  }
  return getAuth().handler(request);
}

export { handle as GET, handle as POST };
```

Run: `npx vitest run test/guards lib/admin && npm run typecheck`
Expected: PASS `Tests  62 passed (62)`; typecheck không lỗi.

- [ ] **Bước 13: Kiểm rằng guard bắt được action quên kiểm quyền và lời gọi endpoint plugin admin**

```bash
printf "'use server';\nimport { getAuth } from '@/lib/server/auth/auth';\nexport async function promote(userId: string) {\n  await getAuth().api.setRole({ body: { userId, role: 'admin' } });\n}\n" > 'app/admin/(shell)/oops.ts'
npx vitest run test/guards
rm 'app/admin/(shell)/oops.ts'
npx vitest run test/guards
```

Expected: lần đầu FAIL hai test:

```
     × every Server Action and /api/admin route handler checks requirePermission first, except the public list
+   "app/admin/(shell)/oops.ts#promote: does not start with await requirePermission()",
     × the admin plugin’s endpoints are called only from lib/server/auth/staff.ts and scripts/create-admin.mjs
+   "app/admin/(shell)/oops.ts: auth.api.setRole",
```

lần hai PASS `Tests  14 passed (14)`.

- [ ] **Bước 14: Cho bước E2E của CI biến auth và email**

Sửa `.github/workflows/ci.yml` đúng như diff:

```diff
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index 0a2f102..805a576 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -48,10 +48,14 @@ jobs:
       - name: Check the prerendered pages and the fonts
         run: node scripts/check-prerender.mjs
       - run: npx playwright install --with-deps chromium
+      - name: Make a session secret for this run
+        run: echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" >> "$GITHUB_ENV"
       - name: End-to-end
         run: npm run test:e2e
         env:
           DATABASE_URL: ${{ env.APP_DATABASE_URL }}
+          BETTER_AUTH_URL: http://localhost:3100
+          EMAIL_DELIVERY: log
       - uses: actions/upload-artifact@v7
         if: failure()
         with:
```

- [ ] **Bước 15: Chạy cổng kiểm tra**

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

Expected:
- typecheck sạch; lint 0 lỗi, 20 cảnh báo (mới: `e2e/staff-fixtures.ts … "pg" also has a named export "Client"`). Nếu lint báo `react-hooks(rules-of-hooks): React Hook "use" is called…` thì fixture đang đặt tên tham số là `use`; tên trong file trên là `provide`.
- `Test Files  37 passed (37)`, `Tests  344 passed (344)`;
- build có thêm `ƒ /admin` và `ƒ /api/auth/[...all]`; check-prerender in `Admin check passed: /admin, /admin/sign-in, /admin/[...missing] have no static shell.`;
- E2E `51 passed`; visual `8 passed`.

- [ ] **Bước 16: Kiểm console của `next dev` trên trang đăng nhập và Tổng quan**

`next dev` không có giới hạn số lần thử và dùng CSP dev (`'unsafe-eval'`), nên chỉ kiểm console ở đây, không chạy bộ E2E. Không có `CI=1`; vẫn có tiền tố env cục bộ.

```bash
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_dev_test node scripts/reset-db.mjs
rm -rf .next/dev
lsof -nP -iTCP:3212 -sTCP:LISTEN
PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_dev_test BETTER_AUTH_SECRET=dev-secret-0123456789abcdef0123456789abcdef BETTER_AUTH_URL=http://localhost:3212 EMAIL_DELIVERY=log npx next dev -p 3212 > "${TMPDIR:-/tmp}/furama-dev.log" 2>&1 &
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3212/admin/sign-in && break; sleep 1; done
PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_dev_test BETTER_AUTH_SECRET=dev-secret-0123456789abcdef0123456789abcdef BETTER_AUTH_URL=http://localhost:3212 BOOTSTRAP_ADMIN_EMAIL=owner@furama.test BOOTSTRAP_ADMIN_PASSWORD='correct horse battery' node scripts/create-admin.mjs
cat > devcheck.tmp.mjs <<'EOF'
// Opens admin pages on `next dev` and prints console errors and warnings. Not committed.
import { chromium } from '@playwright/test';
const base = process.env.BASE;
const pages = (process.env.PAGES ?? '/admin').split(',');
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text().slice(0, 300)}`);
});
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 300)}`));
await page.goto(`${base}/admin/sign-in`);
await page.waitForTimeout(1500);
await page.getByRole('textbox', { name: 'Email' }).fill(process.env.EMAIL);
await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.PASSWORD);
await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
await page.waitForURL(/\/admin(\?|$)/, { timeout: 30000 });
for (const p of pages) {
  logs.push(`--- ${p}`);
  await page.goto(`${base}${p}`);
  await page.waitForTimeout(2500);
}
for (const link of await page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link').all()) {
  logs.push(`--- click ${await link.textContent()}`);
  await link.click();
  await page.waitForTimeout(2000);
}
console.log(logs.join('\n'));
await browser.close();
EOF
BASE=http://localhost:3212 EMAIL=owner@furama.test PASSWORD='correct horse battery' PAGES=/admin/khong-co,/admin node devcheck.tmp.mjs
rm devcheck.tmp.mjs
grep -iE 'blocking|uncached|error' "${TMPDIR:-/tmp}/furama-dev.log"
lsof -ti tcp:3212 | xargs kill
```

Expected: `Admin created: owner@furama.test (…)`; script in

```
--- /admin/khong-co
error: Failed to load resource: the server responded with a status of 404 (Not Found)
--- /admin
--- click Tổng quan
```

(dòng 404 là đúng: `next dev` trả 404 thật cho URL lạ, R5); không có dòng nào khác. `grep` trên log dev không in gì. Giữ `furama_cuisine_dev_test` cho Task 11.

- [ ] **Bước 17: Commit**

```bash
git add .github/workflows/ci.yml package.json package-lock.json playwright.config.ts 'app/admin/(auth)/sign-in' 'app/admin/(shell)' 'app/api/auth' e2e/admin-security.spec.ts e2e/admin-sign-in.spec.ts e2e/staff-fixtures.ts lib/admin/auth-errors.ts lib/admin/auth-errors.test.ts lib/admin/format.ts lib/admin/format.test.ts lib/admin/nav.ts lib/admin/nav.test.ts lib/admin/zod.ts lib/server/action-result.ts lib/server/action-result.test.ts lib/server/auth/auth.ts lib/server/auth/endpoint.ts lib/server/auth/endpoint.test.ts lib/server/dal test/guards
git commit -m "$(cat <<'EOF'
feat: sign staff in to a Vietnamese admin shell, with the CI guard on Server Actions

Sign-in is a Server Action behind useActionState. It reaches Better Auth
through its HTTP router in process (lib/server/auth/endpoint.ts), so every
attempt counts toward the rate limit in auth_rate_limit; it forwards only the
client address and user agent, never cookies, and copies Better Auth's
Set-Cookie onto its own response. Errors are Better Auth's codes in
Vietnamese (a 429 says how many seconds to wait), zod speaks Vietnamese, and
?next= can only point inside the admin.

lib/server/dal/session.ts is the admin's DAL: getStaffSession (headers()
first, so the build never creates Better Auth), verifySession,
requirePermission and auditActor. Banned or role-less accounts count as
signed out. getAuth() builds Better Auth on first use, runs its background
work (the reset email) through after(), and never honours
BOOTSTRAP_ADMIN_EMAIL: only the bootstrap script does.
/api/auth/[...all] serves Better Auth and refuses /api/auth/admin/* itself.

The (shell) frame shows the role-filtered menu, the signed-in member and a
sign-out form; errors render a Vietnamese boundary inside it.

test/guards checks with oxc-parser that every Server Action and
/api/admin route handler, in any directory of app code and for every HTTP
method, starts with `await requirePermission(...)` (or with a top-level try
that does and whose catch returns or throws), that the public list (now
submitReservation, signIn, signOut) still names real exports, and that only
staff.ts and the bootstrap script use the admin plugin's endpoints, whose
list it reads from the plugin itself.

E2E seeds three staff accounts, gives every test its own client address, and
its database helper refuses anything but a local *_test or *_ci database.
Playwright now refuses to start a server without EMAIL_DELIVERY=log,
BETTER_AUTH_SECRET and BETTER_AUTH_URL; CI sets them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 8: Nhận lời mời và đặt lại mật khẩu

**Files:**
- Create: `app/admin/(auth)/accept-invite/page.tsx`, `AcceptForm.tsx`, `actions.ts`
- Create: `app/admin/(auth)/reset-password/page.tsx`, `RequestForm.tsx`, `ResetForm.tsx`, `actions.ts`
- Modify: `lib/server/auth/auth.ts`, `lib/admin/auth-errors.ts`, `lib/admin/auth-errors.test.ts`, `test/guards/require-permission.guard.test.ts`
- Create: `e2e/email-log.ts`, `e2e/admin-invite-reset.spec.ts`; Modify: `e2e/admin-security.spec.ts`, `e2e/staff-fixtures.ts`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `acceptInvitation`, `findOpenInvitation`, `StaffDeps` (Task 4); `sendStaffInvitation` (Task 3); `getAuth`, `callAuthEndpoint`, `actionError`, `ActionResult`, `actionErrorMessage`, `authErrorMessage`, `z`, `ADMIN_HOME`, `ADMIN_SIGN_IN` (Task 6–7); `seedStaff`, `newVisitor`, `formAlert`, `signIn`, `db`, `test` (Task 7).
- Produces:
  - `lib/server/auth/auth.ts`: `staffDeps(): StaffDeps`.
  - `authErrorMessage(status, code?, retryAfterSeconds?, fallback?)` (tham số thứ tư mới).
  - Server Action công khai `acceptInvitation(prev, formData)`, `requestPasswordReset(prev, formData)`, `resetPassword(prev, formData)`; kiểu `RequestResetState`, `ResetState`.
  - `e2e/email-log.ts`: `emailsTo(to)`, `nextLink(to, path, seen?)`.

- [ ] **Bước 1: Mở rộng test đơn vị: danh sách action công khai và câu báo dự phòng**

Sửa `test/guards/require-permission.guard.test.ts` đúng như diff:

```diff
diff --git a/test/guards/require-permission.guard.test.ts b/test/guards/require-permission.guard.test.ts
index e209045..de239b6 100644
--- a/test/guards/require-permission.guard.test.ts
+++ b/test/guards/require-permission.guard.test.ts
@@ -14,6 +14,9 @@ const PUBLIC_ACTIONS = new Map([
   ['app/actions.ts#submitReservation', 'zod, the slot and window checks, the per-table unique index (spec §7.1)'],
   ['app/admin/(auth)/sign-in/actions.ts#signIn', 'Better Auth checks the password, rate-limited per IP in auth_rate_limit'],
   ['app/admin/(shell)/actions.ts#signOut', 'ends only the session of the cookie it is sent with'],
+  ['app/admin/(auth)/accept-invite/actions.ts#acceptInvitation', 'the 256-bit, single-use, 7-day invitation token is the credential'],
+  ['app/admin/(auth)/reset-password/actions.ts#requestPasswordReset', 'same answer for every email; rate-limited per IP'],
+  ['app/admin/(auth)/reset-password/actions.ts#resetPassword', 'Better Auth checks the 1-hour reset token; rate-limited per IP'],
 ]);
 
 const ROOT = join(__dirname, '..', '..');
```

Sửa `lib/admin/auth-errors.test.ts` đúng như diff:

```diff
diff --git a/lib/admin/auth-errors.test.ts b/lib/admin/auth-errors.test.ts
index 77d4917..a5dfcea 100644
--- a/lib/admin/auth-errors.test.ts
+++ b/lib/admin/auth-errors.test.ts
@@ -15,6 +15,11 @@ describe('authErrorMessage', () => {
     expect(authErrorMessage(429)).toBe('Bạn đã thử quá nhiều lần. Vui lòng đợi một lát rồi thử lại.');
   });
 
+  it('a caller may name its own fallback', () => {
+    expect(authErrorMessage(500, 'SOMETHING_NEW', null, 'Không đổi được mật khẩu.')).toBe('Không đổi được mật khẩu.');
+    expect(authErrorMessage(400, 'INVALID_TOKEN', null, 'x')).toBe('Liên kết không hợp lệ hoặc đã được dùng. Hãy yêu cầu một liên kết mới.');
+  });
+
   it('unknown codes never show English', () => {
     expect(authErrorMessage(500, 'SOMETHING_NEW')).toBe('Không đăng nhập được. Vui lòng thử lại sau ít phút.');
     expect(authErrorMessage(500)).toBe('Không đăng nhập được. Vui lòng thử lại sau ít phút.');
```

Run: `npx vitest run test/guards lib/admin/auth-errors.test.ts`
Expected: FAIL `Tests  2 failed | 29 passed (31)`:

```
     × every public action on the list still exists (a renamed one would leave a stale exception)
     × a caller may name its own fallback
```

- [ ] **Bước 2: Cho `authErrorMessage` một câu dự phòng do người gọi chọn**

Sửa `lib/admin/auth-errors.ts` đúng như diff:

```diff
diff --git a/lib/admin/auth-errors.ts b/lib/admin/auth-errors.ts
index 8b93e1c..7aba299 100644
--- a/lib/admin/auth-errors.ts
+++ b/lib/admin/auth-errors.ts
@@ -25,13 +25,19 @@ const AUTH_MESSAGES: Record<string, string> = {
 
 const AUTH_FALLBACK = 'Không đăng nhập được. Vui lòng thử lại sau ít phút.';
 
-export function authErrorMessage(status: number, code?: string | null, retryAfterSeconds?: number | null): string {
+/** `fallback` is for a code we do not know; sign-in's own is the default. */
+export function authErrorMessage(
+  status: number,
+  code?: string | null,
+  retryAfterSeconds?: number | null,
+  fallback = AUTH_FALLBACK,
+): string {
   if (status === 429) {
     return retryAfterSeconds && retryAfterSeconds > 0
       ? `Bạn đã thử quá nhiều lần. Vui lòng thử lại sau ${retryAfterSeconds} giây.`
       : 'Bạn đã thử quá nhiều lần. Vui lòng đợi một lát rồi thử lại.';
   }
-  return (code && AUTH_MESSAGES[code]) || AUTH_FALLBACK;
+  return (code && AUTH_MESSAGES[code]) || fallback;
 }
 
 const ACTION_MESSAGES: Record<ActionCode, string> = {
```

Run: `npx vitest run lib/admin/auth-errors.test.ts`
Expected: PASS `Tests  17 passed (17)`. (Test của guard vẫn đỏ cho tới Bước 6.)

- [ ] **Bước 3: Viết E2E trước**

Create `e2e/email-log.ts`:

```ts
import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';

/*
 * The server under test runs with EMAIL_DELIVERY=log and EMAIL_LOG_FILE set,
 * so lib/server/email/send.ts appends every email it would send to that file
 * as one JSON line. This is how a spec reads an invitation or reset link.
 */

type LoggedEmail = { to: string; subject: string; text: string };

function file(): string {
  const path = process.env.EMAIL_LOG_FILE;
  if (!path) throw new Error('Set EMAIL_LOG_FILE (the server writes emails there) to run the admin email specs.');
  return path;
}

export function emailsTo(to: string): LoggedEmail[] {
  let raw: string;
  try {
    raw = readFileSync(file(), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LoggedEmail)
    .filter((e) => e.to === to);
}

/**
 * Waits for an email to `to` beyond the first `seen` ones and returns its
 * link to `path` (/admin/accept-invite or /admin/reset-password).
 */
export async function nextLink(to: string, path: string, seen = 0): Promise<string> {
  const pattern = new RegExp(`https?://[^\\s]+${path.replace(/\//g, '\\/')}\\?token=[A-Za-z0-9_%-]+`);
  let link: string | undefined;
  await expect
    .poll(
      () => {
        const fresh = emailsTo(to).slice(seen);
        link = fresh.at(-1)?.text.match(pattern)?.[0];
        return link;
      },
      { message: `an email to ${to} with a ${path} link`, timeout: 10_000 },
    )
    .toBeTruthy();
  return link!;
}
```

Create `e2e/admin-invite-reset.spec.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';
import { expectHydrated, watchCsp } from './csp';
import { emailsTo, nextLink } from './email-log';
import { db, expect, formAlert, newVisitor, seedStaff, signIn, test } from './staff-fixtures';

/*
 * The two public flows of spec §7.1/§7.2: accepting an invitation (the token
 * is the credential) and resetting a forgotten password through an emailed
 * link. Each test makes its own accounts and invitations, so files and reruns
 * never share one.
 */

const unique = () => `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;

/** An invitation written by SQL with a token the test knows; returns its accept URL path. */
async function invitation(email: string, opts: { expired?: boolean; revoked?: boolean } = {}): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const client = db();
  await client.connect();
  try {
    await client.query(
      `INSERT INTO staff_invitation (email, role, token_hash, expires_at, revoked_at)
       VALUES ($1, 'editor', $2, now() + $3::interval, $4)`,
      [email, createHash('sha256').update(token).digest('hex'), opts.expired ? '-1 minute' : '7 days', opts.revoked ? new Date() : null],
    );
  } finally {
    await client.end();
  }
  return `/admin/accept-invite?token=${token}`;
}

const INVALID = 'Lời mời không hợp lệ, đã hết hạn hoặc đã bị thu hồi. Hãy nhờ Admin gửi lại lời mời.';

test.describe('accepting an invitation', () => {
  test('the invitee sets a name and password, is signed in as Editor, and the link is single-use', async ({ page, browser }, testInfo) => {
    const email = `invitee-${unique()}@furama.test`;
    const link = await invitation(email);
    const violations = await watchCsp(page);
    await page.goto(link);
    await expectHydrated(page);
    await expect(page.getByText(email)).toBeVisible();
    await page.getByLabel('Họ tên').fill('Lê Thị An');
    await page.getByLabel('Mật khẩu').fill('an passphrase 2026');
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId('staff-name')).toHaveText('Lê Thị An');
    await expect(page.getByText(`${email} · Editor`)).toBeVisible();
    expect(violations).toEqual([]);

    const again = await newVisitor(browser, testInfo);
    await again.goto(link);
    await expect(again.getByRole('main').getByRole('alert')).toHaveText(INVALID);
    await expect(again.getByRole('button', { name: 'Tạo tài khoản' })).toHaveCount(0);
  });

  test('an expired or revoked invitation shows the invalid view', async ({ page }) => {
    for (const opts of [{ expired: true }, { revoked: true }]) {
      await page.goto(await invitation(`invitee-${unique()}@furama.test`, opts));
      await expect(page.getByRole('main').getByRole('alert')).toHaveText(INVALID);
    }
    await page.goto('/admin/accept-invite?token=not-a-token');
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(INVALID);
  });

  test('a short password is refused in Vietnamese and nothing is created', async ({ page }) => {
    const email = `invitee-${unique()}@furama.test`;
    await page.goto(await invitation(email));
    await page.getByLabel('Họ tên').fill('Ngắn');
    await page.getByLabel('Mật khẩu').fill('ngan qua');
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click();
    await expect(page.getByText('Mật khẩu cần ít nhất 12 ký tự.')).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/accept-invite\?token=/);
    const client = db();
    await client.connect();
    try {
      expect((await client.query('SELECT 1 FROM staff_user WHERE email = $1', [email])).rowCount).toBe(0);
    } finally {
      await client.end();
    }
  });
});

test.describe('resetting a forgotten password', () => {
  test('request → emailed link → new password; the old one stops working', async ({ page }) => {
    const id = unique();
    const member = { id: `e2e-reset-${id}`, name: 'Quên Mật Khẩu', email: `reset-${id}@furama.test`, password: 'old passphrase 2026', role: 'editor', banned: false } as const;
    await seedStaff([member]);

    await page.goto('/admin/sign-in');
    await page.getByRole('link', { name: 'Quên mật khẩu?' }).click();
    await expect(page).toHaveURL(/\/admin\/reset-password$/);
    // The sign-in page stays mounted but hidden (Activity); role queries skip hidden nodes.
    await page.getByRole('textbox', { name: 'Email' }).fill(member.email);
    await page.getByRole('button', { name: 'Gửi liên kết' }).click();
    await expect(page.getByRole('main').getByRole('status')).toHaveText(
      'Nếu email này có tài khoản, chúng tôi đã gửi liên kết đặt lại mật khẩu. Liên kết có hiệu lực trong 60 phút.',
    );

    const link = await nextLink(member.email, '/admin/reset-password');
    await page.goto(link);
    await page.getByLabel('Mật khẩu mới').fill('new passphrase 2026');
    await page.getByRole('button', { name: 'Đặt mật khẩu' }).click();
    await expect(page.getByRole('main').getByRole('status')).toHaveText('Đã đổi mật khẩu. Hãy đăng nhập bằng mật khẩu mới.');

    await page.getByRole('link', { name: 'Đăng nhập' }).click();
    await expect(page).toHaveURL(/\/admin\/sign-in$/);
    await signIn(page, member.email, member.password);
    await expect(formAlert(page)).toHaveText('Email hoặc mật khẩu không đúng.');
    await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeEnabled();
    await signIn(page, member.email, 'new passphrase 2026');
    await expect(page).toHaveURL(/\/admin$/);

    // The link worked once.
    await page.goto(link);
    await page.getByLabel('Mật khẩu mới').fill('another passphrase 2026');
    await page.getByRole('button', { name: 'Đặt mật khẩu' }).click();
    await expect(formAlert(page)).toHaveText('Liên kết không hợp lệ hoặc đã được dùng. Hãy yêu cầu một liên kết mới.');
  });

  test('an unknown email gets the same answer, and no email is sent', async ({ page }) => {
    const email = `nobody-${unique()}@furama.test`;
    await page.goto('/admin/reset-password');
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByRole('button', { name: 'Gửi liên kết' }).click();
    await expect(page.getByRole('main').getByRole('status')).toHaveText(
      'Nếu email này có tài khoản, chúng tôi đã gửi liên kết đặt lại mật khẩu. Liên kết có hiệu lực trong 60 phút.',
    );
    await page.waitForTimeout(500);
    expect(emailsTo(email)).toEqual([]);
  });
});
```

Sửa `e2e/admin-security.spec.ts` đúng như diff (hai trang công khai cũng hydrate không vi phạm):

```diff
diff --git a/e2e/admin-security.spec.ts b/e2e/admin-security.spec.ts
index 1d289b9..27f10b0 100644
--- a/e2e/admin-security.spec.ts
+++ b/e2e/admin-security.spec.ts
@@ -104,6 +104,15 @@ test.describe('hydration under the CSP', () => {
     expect(violations).toEqual([]);
   });
 
+  test('the public reset and accept-invite pages hydrate with no violation', async ({ page }) => {
+    const violations = await watchCsp(page);
+    for (const path of ['/admin/reset-password', '/admin/reset-password?token=x', '/admin/accept-invite?token=x']) {
+      await page.goto(path);
+      await expectHydrated(page);
+    }
+    expect(violations).toEqual([]);
+  });
+
   test('signing in moves into the shell without a document request or a violation', async ({ page }) => {
     const violations = await watchCsp(page);
     await page.goto('/admin/sign-in');
```

Sửa `e2e/staff-fixtures.ts` đúng như diff. Trang đặt lại mật khẩu vừa rời vẫn nằm ẩn trong document (`<Activity>`), và `getByLabel('Mật khẩu')` không có `exact` khớp cả thẻ `section` được gắn nhãn "Đặt lại mật khẩu" của nó (lỗi strict mode ở lần chạy kiểm chứng):

```diff
diff --git a/e2e/staff-fixtures.ts b/e2e/staff-fixtures.ts
index 7cf0246..9c35ce9 100644
--- a/e2e/staff-fixtures.ts
+++ b/e2e/staff-fixtures.ts
@@ -138,8 +138,10 @@ export const formAlert = (page: Page) => page.locator('form').getByRole('alert')
  * the form, which would wipe a password typed in the meantime.
  */
 export async function signIn(page: Page, email: string, password: string): Promise<void> {
+  // Cache Components keeps pages you left mounted but hidden (<Activity>): role
+  // queries skip them, and `exact` keeps "Mật khẩu" from matching "Đặt lại mật khẩu".
   await page.getByRole('textbox', { name: 'Email' }).fill(email);
-  await page.getByLabel('Mật khẩu').fill(password);
+  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
   const answered = page.waitForResponse(
     (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/admin/sign-in',
   );
```

- [ ] **Bước 4: Build code hiện tại và chạy đặc tả mới: phải đỏ**

```bash
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson E2E_PORT=3210 npx playwright test --retries=0 e2e/admin-invite-reset.spec.ts
```

Expected: build thoát 0 (test đơn vị đỏ không làm hỏng build); E2E FAIL `5 failed` (hai trang mới chưa có, URL rơi vào trang 404 của admin):

```
  ✘ accepting an invitation › the invitee sets a name and password, is signed in as Editor, and the link is single-use
  ✘ accepting an invitation › an expired or revoked invitation shows the invalid view
  ✘ accepting an invitation › a short password is refused in Vietnamese and nothing is created
  ✘ resetting a forgotten password › request → emailed link → new password; the old one stops working
  ✘ resetting a forgotten password › an unknown email gets the same answer, and no email is sent
```

- [ ] **Bước 5: Viết `staffDeps()` và trang nhận lời mời**

Sửa `lib/server/auth/auth.ts` đúng như diff:

```diff
diff --git a/lib/server/auth/auth.ts b/lib/server/auth/auth.ts
index 3ae46b8..71a59f7 100644
--- a/lib/server/auth/auth.ts
+++ b/lib/server/auth/auth.ts
@@ -1,8 +1,9 @@
 import 'server-only';
 import { after } from 'next/server';
 import { getPool } from '@/db/client';
-import { sendPasswordReset } from '@/lib/server/email/auth-emails';
+import { sendPasswordReset, sendStaffInvitation } from '@/lib/server/email/auth-emails';
 import { createAuth, type Auth } from './config';
+import type { StaffDeps } from './staff';
 
 /*
  * The app's Better Auth instance. Built on first use, never at import time:
@@ -28,3 +29,8 @@ export function getAuth(): Auth {
   });
   return instance;
 }
+
+/** What lib/server/auth/staff.ts needs at run time: the pool, Better Auth and the invitation email. */
+export function staffDeps(): StaffDeps {
+  return { pool: getPool(), auth: getAuth(), sendInvite: (email) => sendStaffInvitation(email) };
+}
```

Create `app/admin/(auth)/accept-invite/actions.ts`:

```ts
'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_HOME } from '@/lib/admin/paths';
import { z } from '@/lib/admin/zod';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { getAuth, staffDeps } from '@/lib/server/auth/auth';
import { acceptInvitation as accept } from '@/lib/server/auth/staff';

const AcceptInput = z.object({
  token: z.string(),
  name: z.string().trim().min(1, { error: 'Nhập họ tên.' }).max(100, { error: 'Họ tên tối đa 100 ký tự.' }),
  // admin createUser checks only the maximum; the minimum is ours (spec §7.1: 12–128).
  password: z
    .string()
    .min(12, { error: 'Mật khẩu cần ít nhất 12 ký tự.' })
    .max(128, { error: 'Mật khẩu tối đa 128 ký tự.' }),
});

/*
 * Public action (no session yet; on the CI guard's allowlist): the 256-bit,
 * single-use invitation token is the credential, and accept() checks it
 * again. Not rate-limited: guessing a token is hopeless.
 */
export async function acceptInvitation(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await createAccount(formData);
  // Outside any try: redirect() throws. Setting the cookie re-renders this page, where
  // the now-used invitation would show as invalid, so the action leaves it itself.
  if (result.ok) redirect(ADMIN_HOME);
  return result;
}

async function createAccount(formData: FormData): Promise<ActionResult> {
  try {
    const input = AcceptInput.parse({
      token: formData.get('token'),
      name: formData.get('name'),
      password: formData.get('password'),
    });
    const requestHeaders = await headers();
    const ip = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
    const result = await accept(staffDeps(), input, ip);
    if (!result.ok) return result;
    // The one auth.api sign-in in the app: the account was created a moment ago
    // with this password. nextCookies() puts the session cookie on this response.
    await getAuth().api.signInEmail({
      body: { email: result.email, password: input.password, rememberMe: true },
      headers: requestHeaders,
    });
    return { ok: true, data: null };
  } catch (err) {
    return actionError(err);
  }
}
```

Create `app/admin/(auth)/accept-invite/AcceptForm.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { actionErrorMessage } from '@/lib/admin/auth-errors';
import type { ActionResult } from '@/lib/server/action-result';
import { acceptInvitation } from './actions';

export function AcceptForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(acceptInvitation, null);
  const failed = state && !state.ok ? state : null;
  const errors = failed?.fieldErrors ?? {};

  return (
    <form action={action} noValidate>
      <input type="hidden" name="token" value={token} />
      <p className="a-lede">
        Tài khoản cho <strong>{email}</strong>
      </p>
      {failed && !failed.fieldErrors ? (
        <p className="a-alert" role="alert">
          {actionErrorMessage(failed.code)}
        </p>
      ) : null}

      <div className="a-field">
        <label htmlFor="name">Họ tên</label>
        <input
          id="name"
          name="name"
          autoComplete="name"
          required
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? 'name-error' : undefined}
        />
        {errors.name ? (
          <p className="a-field-error" id="name-error">
            {errors.name[0]}
          </p>
        ) : null}
      </div>

      <div className="a-field">
        <label htmlFor="password">Mật khẩu (12–128 ký tự)</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={errors.password ? 'password-error' : undefined}
        />
        {errors.password ? (
          <p className="a-field-error" id="password-error">
            {errors.password[0]}
          </p>
        ) : null}
      </div>

      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang tạo tài khoản…' : 'Tạo tài khoản'}
      </button>
    </form>
  );
}
```

Create `app/admin/(auth)/accept-invite/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { getPool } from '@/db/client';
import { findOpenInvitation } from '@/lib/server/auth/staff';
import { AcceptForm } from './AcceptForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Nhận lời mời' };

/*
 * Public (the proxy lets it through without a session). The database is read
 * only after `await searchParams`, a request-time API, so the build never runs it.
 */
export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  const invitation = typeof token === 'string' ? await findOpenInvitation(getPool(), token) : null;

  return (
    <section className="a-card" aria-labelledby="accept-title">
      <h1 id="accept-title">Nhận lời mời</h1>
      {invitation && typeof token === 'string' ? (
        <AcceptForm token={token} email={invitation.email} />
      ) : (
        <p className="a-alert" role="alert">
          Lời mời không hợp lệ, đã hết hạn hoặc đã bị thu hồi. Hãy nhờ Admin gửi lại lời mời.
        </p>
      )}
    </section>
  );
}
```

- [ ] **Bước 6: Viết trang đặt lại mật khẩu**

Email đặt lại mật khẩu chạy sau câu trả lời của `/request-password-reset` (`backgroundTask` = `after()`, Task 2 Bước 4 và Task 7 Bước 7), nên action trả "đã gửi" trước khi email tới `EMAIL_LOG_FILE`; `nextLink` của E2E chờ email tối đa 10 giây.

Create `app/admin/(auth)/reset-password/actions.ts`:

```ts
'use server';

import { authErrorMessage } from '@/lib/admin/auth-errors';
import { z } from '@/lib/admin/zod';
import { callAuthEndpoint } from '@/lib/server/auth/endpoint';

/*
 * Both steps are public actions (on the CI guard's allowlist) that go through
 * Better Auth's HTTP router (lib/server/auth/endpoint.ts), so its rate limit
 * applies: 3 requests per 60 s per IP on /request-password-reset. The email
 * itself is sent by config.ts's sendResetPassword after the answer (after(),
 * lib/server/auth/auth.ts), so a staff address answers as fast as any other.
 */

export type RequestResetState = { email: string; sent?: true; message?: string; fieldErrors?: { email?: string[] } } | null;
export type ResetState = { done?: true; message?: string; fieldErrors?: { password?: string[] } } | null;

const retryAfter = (res: Response) => Number(res.headers.get('x-retry-after')) || null;

export async function requestPasswordReset(_prev: RequestResetState, formData: FormData): Promise<RequestResetState> {
  const email = String(formData.get('email') ?? '').trim();
  const parsed = z
    .object({ email: z.email({ error: 'Nhập email công việc, ví dụ ten@furamavietnam.com.' }) })
    .safeParse({ email });
  if (!parsed.success) return { email, fieldErrors: z.flattenError(parsed.error).fieldErrors };

  let res: Response;
  try {
    res = await callAuthEndpoint('/request-password-reset', { email: parsed.data.email });
  } catch (error) {
    console.error('[admin] reset request failed', { name: error instanceof Error ? error.name : typeof error });
    return { email, message: 'Không gửi được yêu cầu. Vui lòng thử lại sau ít phút.' };
  }
  if (res.status === 429) return { email, message: authErrorMessage(429, null, retryAfter(res)) };
  if (!res.ok) return { email, message: 'Không gửi được yêu cầu. Vui lòng thử lại sau ít phút.' };
  // Better Auth answers 200 whether or not the address has an account, and so do we.
  return { email, sent: true };
}

export async function resetPassword(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const parsed = z
    .object({
      token: z.string().min(1),
      password: z
        .string()
        .min(12, { error: 'Mật khẩu cần ít nhất 12 ký tự.' })
        .max(128, { error: 'Mật khẩu tối đa 128 ký tự.' }),
    })
    .safeParse({ token: formData.get('token'), password: formData.get('password') });
  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error);
    return fieldErrors.password ? { fieldErrors: { password: fieldErrors.password } } : { message: authErrorMessage(400, 'INVALID_TOKEN') };
  }

  let res: Response;
  try {
    res = await callAuthEndpoint('/reset-password', { token: parsed.data.token, newPassword: parsed.data.password });
  } catch (error) {
    console.error('[admin] password reset failed', { name: error instanceof Error ? error.name : typeof error });
    return { message: 'Không đổi được mật khẩu. Vui lòng thử lại sau ít phút.' };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    return { message: authErrorMessage(res.status, body?.code, retryAfter(res), 'Không đổi được mật khẩu. Vui lòng thử lại sau ít phút.') };
  }
  // Better Auth also ended every session of this account (revokeSessionsOnPasswordReset).
  return { done: true };
}
```

Create `app/admin/(auth)/reset-password/RequestForm.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { requestPasswordReset, type RequestResetState } from './actions';

export function RequestForm() {
  const [state, action, pending] = useActionState<RequestResetState, FormData>(requestPasswordReset, null);
  const errors = state?.fieldErrors ?? {};

  if (state?.sent) {
    return (
      <p className="a-lede" role="status">
        Nếu email này có tài khoản, chúng tôi đã gửi liên kết đặt lại mật khẩu. Liên kết có hiệu lực trong 60 phút.
      </p>
    );
  }
  return (
    <form action={action} noValidate>
      <p className="a-lede">Nhập email đăng nhập. Chúng tôi sẽ gửi liên kết để đặt mật khẩu mới.</p>
      {state?.message ? (
        <p className="a-alert" role="alert">
          {state.message}
        </p>
      ) : null}
      <div className="a-field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={state?.email ?? ''}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? 'email-error' : undefined}
        />
        {errors.email ? (
          <p className="a-field-error" id="email-error">
            {errors.email[0]}
          </p>
        ) : null}
      </div>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang gửi…' : 'Gửi liên kết'}
      </button>
    </form>
  );
}
```

Create `app/admin/(auth)/reset-password/ResetForm.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { ADMIN_SIGN_IN } from '@/lib/admin/paths';
import { resetPassword, type ResetState } from './actions';

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(resetPassword, null);
  const errors = state?.fieldErrors ?? {};

  if (state?.done) {
    return (
      <>
        <p className="a-lede" role="status">
          Đã đổi mật khẩu. Hãy đăng nhập bằng mật khẩu mới.
        </p>
        <Link className="a-btn" href={ADMIN_SIGN_IN}>
          Đăng nhập
        </Link>
      </>
    );
  }
  return (
    <form action={action} noValidate>
      <input type="hidden" name="token" value={token} />
      {state?.message ? (
        <p className="a-alert" role="alert">
          {state.message}
        </p>
      ) : null}
      <div className="a-field">
        <label htmlFor="password">Mật khẩu mới (12–128 ký tự)</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={errors.password ? 'password-error' : undefined}
        />
        {errors.password ? (
          <p className="a-field-error" id="password-error">
            {errors.password[0]}
          </p>
        ) : null}
      </div>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang lưu…' : 'Đặt mật khẩu'}
      </button>
    </form>
  );
}
```

Create `app/admin/(auth)/reset-password/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { RequestForm } from './RequestForm';
import { ResetForm } from './ResetForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Đặt lại mật khẩu' };

/* Public. Without ?token= it asks for the email; with one (the emailed link) it sets the new password. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return (
    <section className="a-card" aria-labelledby="reset-title">
      <h1 id="reset-title">Đặt lại mật khẩu</h1>
      {typeof token === 'string' && token ? <ResetForm token={token} /> : <RequestForm />}
    </section>
  );
}
```

Run: `npm run typecheck && npx vitest run test/guards lib/admin`
Expected: typecheck sạch; PASS `Tests  63 passed (63)`.

- [ ] **Bước 7: Cho CI một file log email**

Sửa `.github/workflows/ci.yml` đúng như diff:

```diff
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index 805a576..9504d1a 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -56,6 +56,7 @@ jobs:
           DATABASE_URL: ${{ env.APP_DATABASE_URL }}
           BETTER_AUTH_URL: http://localhost:3100
           EMAIL_DELIVERY: log
+          EMAIL_LOG_FILE: ${{ runner.temp }}/emails.ndjson
       - uses: actions/upload-artifact@v7
         if: failure()
         with:
```

- [ ] **Bước 8: Chạy cổng kiểm tra**

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

Expected: typecheck sạch; lint 0 lỗi, 20 cảnh báo; `Test Files  37 passed (37)`, `Tests  345 passed (345)`; check-prerender in `Admin check passed: /admin, /admin/accept-invite, /admin/reset-password, /admin/sign-in, /admin/[...missing] have no static shell.`; E2E `57 passed`; visual `8 passed`.

- [ ] **Bước 9: Commit**

```bash
git add 'app/admin/(auth)/accept-invite' 'app/admin/(auth)/reset-password' lib/server/auth/auth.ts lib/admin/auth-errors.ts lib/admin/auth-errors.test.ts test/guards/require-permission.guard.test.ts e2e/email-log.ts e2e/admin-invite-reset.spec.ts e2e/admin-security.spec.ts e2e/staff-fixtures.ts .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
feat: accept an invitation and reset a forgotten password

/admin/accept-invite shows the invited address and asks for a name and a
12-128 character password; the action creates the account through
lib/server/auth/staff.ts, signs the new member in (the app's one auth.api
sign-in, with the password just set) and leaves for /admin itself, since the
used invitation would now render as invalid. A used, revoked, expired or
malformed token gets one Vietnamese answer that never says which.

/admin/reset-password asks for the email, then, from the emailed link, the
new password. Both steps go through Better Auth's router in process, so
/request-password-reset keeps its limit of 3 per minute per IP, every email
gets the same answer, and a reset ends the account's other sessions.

All three actions join the public list, each with what protects it. E2E reads
the emailed links from EMAIL_LOG_FILE (e2e/email-log.ts); CI sets it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 9: Màn Nhân viên `/admin/users`

**Files:**
- Modify: `e2e/staff-fixtures.ts`, `e2e/admin-security.spec.ts`; Create: `e2e/admin-users.spec.ts`
- Create: `lib/server/auth/staff-queries.ts`, `test/integration/staff-queries.test.ts`
- Modify: `test/guards/require-permission.guard.test.ts`, `test/guards/server-actions.ts`
- Modify: `lib/server/dal/session.ts`, `next.config.ts`; Create: `app/admin/(shell)/forbidden.tsx`
- Create: `app/admin/(shell)/users/actions.ts`, `InviteForm.tsx`, `InvitationList.tsx`, `StaffTable.tsx`, `page.tsx`
- Modify: `lib/admin/nav.ts`, `lib/admin/nav.test.ts`, `app/admin/(shell)/page.tsx`, `styles/admin.css`

**Interfaces:**
- Consumes: mọi hàm của `lib/server/auth/staff.ts` (Task 4); `staffDeps()` (Task 8); `requirePermission`, `auditActor`, `verifySession`, `actionError`, `ActionResult`, `actionErrorMessage`, `z`, `formatDateTimeVi`, `ROLE_LABELS`, `navFor` (Task 7); `STAFF_ROLES`, `roleCan` (Task 1); `nextLink` (Task 8); `seedStaff`, `signIn`, `signInAs`, `newVisitor`, `formAlert`, `db` (Task 7).
- Produces:
  - `lib/server/auth/staff-queries.ts`: `type StaffRow = { id; name; email; role; banned: boolean; created_at: Date }`, `type OpenInvitationRow = { id; email; role; expires_at: Date; expired: boolean; email_error: string | null }`, `listStaff(pool)`, `listOpenInvitations(pool)`.
  - `requirePagePermission(permissions): Promise<StaffSession>` trong `lib/server/dal/session.ts` (gọi `forbidden()`).
  - Server Action: `inviteStaff(prev, formData)`, `resendInvite(id)`, `revokeInvite(id)`, `changeStaffRole(userId, role)`, `banStaffMember(userId)`, `unbanStaffMember(userId)`, `removeStaffMember(userId)`.
  - `test/guards/server-actions.ts`: `adminOnlyProblems(root, rels, read?)`.
  - `e2e/staff-fixtures.ts`: `withAdminCountLock(fn)`, `one(sql, values?)`.
  - Menu có "Nhân viên" (`user:list`).

- [ ] **Bước 1: Viết E2E trước**

Sửa `e2e/staff-fixtures.ts` đúng như diff (khóa advisory cho các test phụ thuộc số Admin, và helper đọc một hàng):

```diff
diff --git a/e2e/staff-fixtures.ts b/e2e/staff-fixtures.ts
index 9c35ce9..fe8e8f8 100644
--- a/e2e/staff-fixtures.ts
+++ b/e2e/staff-fixtures.ts
@@ -156,3 +156,30 @@ export async function signInAs(page: Page, who: { email: string; password: strin
   await signIn(page, who.email, who.password);
   await expect(page).toHaveURL(/\/admin$/);
 }
+
+/**
+ * Runs `fn` while no other test in any worker changes how many Admins exist:
+ * the last-Admin check (spec §7.1) depends on that count, so the test that
+ * expects it and the tests that briefly add an Admin take this lock.
+ */
+export async function withAdminCountLock<T>(fn: () => Promise<T>): Promise<T> {
+  const client = db();
+  await client.connect();
+  try {
+    await client.query("SELECT pg_advisory_lock(hashtext('e2e-admin-count'))");
+    return await fn();
+  } finally {
+    await client.end(); // ends the session, which releases the lock even if fn threw
+  }
+}
+
+/** One row of a query, for assertions on what the database holds. */
+export async function one<T extends Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<T | undefined> {
+  const client = db();
+  await client.connect();
+  try {
+    return (await client.query<T>(sql, values)).rows[0];
+  } finally {
+    await client.end();
+  }
+}
```

Create `e2e/admin-users.spec.ts`:

```ts
import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { nextLink } from './email-log';
import { STAFF, expect, formAlert, newVisitor, one, seedStaff, signIn, signInAs, test, withAdminCountLock } from './staff-fixtures';

/*
 * The staff screen (spec §7.2 /admin/users): invite, resend, revoke, the
 * email-failure notice, the last-Admin rule, ban and removal, and the
 * Editor's 403. Accounts a test changes are its own; the seeded three are
 * only signed in with.
 */

test.beforeAll(() => seedStaff());

const unique = () => `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;

async function openUsers(page: Page) {
  await signInAs(page, STAFF.admin);
  await page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link', { name: 'Nhân viên' }).click();
  await expect(page.getByRole('heading', { name: 'Nhân viên', level: 1 })).toBeVisible();
}

const invitationItem = (page: Page, email: string) => page.getByRole('list', { name: 'Lời mời đang chờ' }).locator(`li[data-email="${email}"]`);
const staffRow = (page: Page, email: string) => page.getByRole('row').filter({ hasText: email });

async function invite(page: Page, email: string) {
  // Role queries: the sign-in page we came from is still mounted, hidden (<Activity>), with an Email field of its own.
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await page.getByRole('combobox', { name: 'Vai trò', exact: true }).selectOption('editor');
  await page.getByRole('button', { name: 'Gửi lời mời' }).click();
  await expect(page.getByRole('main').getByRole('status')).toHaveText('Đã gửi lời mời.');
  await expect(invitationItem(page, email)).toBeVisible();
}

test('an Admin invites; resend replaces the link; revoke closes it', async ({ page, browser }, testInfo) => {
  const email = `invitee-${unique()}@furama.test`;
  await openUsers(page);
  await invite(page, email);
  const first = await nextLink(email, '/admin/accept-invite');

  const item = invitationItem(page, email);
  await item.getByRole('button', { name: 'Gửi lại' }).click();
  await expect(item.getByRole('status')).toHaveText('Đã gửi lại.');
  const second = await nextLink(email, '/admin/accept-invite', 1);
  expect(second).not.toBe(first);

  const visitor = await newVisitor(browser, testInfo);
  await visitor.goto(first);
  await expect(visitor.getByRole('main').getByRole('alert')).toContainText('Lời mời không hợp lệ');
  await visitor.goto(second);
  await expect(visitor.getByRole('button', { name: 'Tạo tài khoản' })).toBeVisible();

  await item.getByRole('button', { name: 'Thu hồi' }).click();
  await expect(item).toHaveCount(0);
  expect(await one('SELECT revoked_at IS NOT NULL AS revoked FROM staff_invitation WHERE email = $1', [email])).toEqual({ revoked: true });
  await visitor.goto(second);
  await expect(visitor.getByRole('main').getByRole('alert')).toContainText('Lời mời không hợp lệ');
});

test('an invitation whose email failed says so, on the staff screen and the overview', async ({ page }) => {
  const email = `failed-${unique()}@furama.test`;
  await one(
    `INSERT INTO staff_invitation (email, role, token_hash, expires_at, email_error)
     VALUES ($1, 'editor', encode(sha256(convert_to($1, 'UTF8')), 'hex'), now() + interval '7 days', 'provider_error: Resend rejected the email: rate limited')`,
    [email],
  );
  await signInAs(page, STAFF.admin);
  await expect(page.getByRole('region', { name: 'Lời mời chưa gửi được email' }).getByText(email)).toBeVisible();
  await page.getByRole('link', { name: 'Mở trang Nhân viên để gửi lại' }).click();
  await expect(invitationItem(page, email).getByRole('alert')).toHaveText('Chưa gửi được email, bấm Gửi lại.');
});

test('the last Admin cannot demote themselves', async ({ page }) => {
  await openUsers(page);
  await withAdminCountLock(async () => {
    const row = staffRow(page, STAFF.admin.email);
    await row.getByRole('combobox').selectOption('editor');
    await expect(row.getByRole('alert')).toHaveText('Không thể hạ quyền, khóa hoặc xóa Admin cuối cùng.');
    await expect(row.getByRole('combobox')).toHaveValue('admin');
    expect(await one('SELECT role FROM staff_user WHERE email = $1', [STAFF.admin.email])).toEqual({ role: 'admin' });
  });
});

test('ban ends the member’s session and keeps them out; unban lets them back', async ({ page, browser }, testInfo) => {
  const id = unique();
  const member = { id: `e2e-ban-${id}`, name: 'Sẽ Bị Khóa', email: `ban-${id}@furama.test`, password: 'ban me passphrase', role: 'editor', banned: false } as const;
  await seedStaff([member]);
  const memberPage = await newVisitor(browser, testInfo);
  await signInAs(memberPage, member);

  await openUsers(page);
  const row = staffRow(page, member.email);
  await row.getByRole('button', { name: 'Khóa' }).click();
  await expect(row.getByRole('cell', { name: 'Đã khóa' })).toBeVisible();

  await memberPage.reload();
  await expect(memberPage).toHaveURL(/\/admin\/sign-in$/);
  await signIn(memberPage, member.email, member.password);
  await expect(formAlert(memberPage)).toHaveText('Tài khoản này đã bị khóa. Liên hệ Admin để được mở lại.');

  await row.getByRole('button', { name: 'Mở khóa' }).click();
  await expect(row.getByRole('cell', { name: 'Hoạt động' })).toBeVisible();
  await expect(memberPage.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeEnabled();
  await signIn(memberPage, member.email, member.password);
  await expect(memberPage).toHaveURL(/\/admin$/);
  expect(await one(`SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1 AND action IN ('staff.ban', 'staff.unban')`, [member.id])).toEqual({ n: 2 });
});

test('remove deletes the account, after a confirmation', async ({ page }) => {
  const id = unique();
  const member = { id: `e2e-remove-${id}`, name: 'Sẽ Bị Xóa', email: `remove-${id}@furama.test`, password: 'remove passphrase', role: 'editor', banned: false } as const;
  await seedStaff([member]);
  await openUsers(page);
  page.once('dialog', (dialog) => dialog.accept());
  await staffRow(page, member.email).getByRole('button', { name: 'Xóa' }).click();
  await expect(staffRow(page, member.email)).toHaveCount(0);
  expect(await one('SELECT 1 AS found FROM staff_user WHERE id = $1', [member.id])).toBeUndefined();
  expect(await one(`SELECT actor_email FROM audit_log WHERE entity_id = $1 AND action = 'staff.remove'`, [member.id])).toEqual({
    actor_email: STAFF.admin.email,
  });
});

test('an Editor has no Nhân viên link, and /admin/users shows the 403 view with no staff data', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  await expect(page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link')).toHaveText(['Tổng quan']);
  // Status 200, not 403: see app/admin/layout.tsx. What matters is what the response holds.
  const res = await page.goto('/admin/users');
  const body = (await res?.text()) ?? '';
  expect(body).not.toContain(STAFF.admin.email);
  expect(body).not.toContain(STAFF.banned.email);
  await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible();
  await expect(page.getByTestId('staff-name')).toHaveText(STAFF.editor.name); // still inside the shell
  await expect(page.getByRole('table')).toHaveCount(0);
});
```

Sửa `e2e/admin-security.spec.ts` đúng như diff (sau khi đăng nhập, bấm "Nhân viên" trong menu: một điều hướng mềm nữa, chunk riêng, vẫn 0 request document và 0 vi phạm). Cú bấm nằm trong `navigation`, vì trang Tổng quan có thể có link "Mở trang Nhân viên để gửi lại" do một spec khác tạo:

```diff
diff --git a/e2e/admin-security.spec.ts b/e2e/admin-security.spec.ts
index 27f10b0..3e90c5d 100644
--- a/e2e/admin-security.spec.ts
+++ b/e2e/admin-security.spec.ts
@@ -126,6 +126,11 @@ test.describe('hydration under the CSP', () => {
     await signIn(page, STAFF.admin.email, STAFF.admin.password);
     await expect(page).toHaveURL(/\/admin$/);
     await expect(page.getByRole('heading', { name: 'Tổng quan' })).toBeVisible();
+    await expectHydrated(page);
+    // A link inside the shell: another soft navigation with chunks of its own.
+    await page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link', { name: 'Nhân viên' }).click();
+    await expect(page.getByRole('heading', { name: 'Nhân viên', level: 1 })).toBeVisible();
+    await expect(page).toHaveURL(/\/admin\/users$/);
     expect(documents).toBe(0);
     expect(violations).toEqual([]);
   });
```

- [ ] **Bước 2: Build code hiện tại và chạy: phải đỏ**

```bash
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson E2E_PORT=3210 npx playwright test --retries=0 e2e/admin-users.spec.ts e2e/admin-security.spec.ts
```

Expected: FAIL `7 failed`, `10 passed`:

```
  ✘ e2e/admin-users.spec.ts › an Admin invites; resend replaces the link; revoke closes it
  ✘ e2e/admin-security.spec.ts › hydration under the CSP › signing in moves into the shell without a document request or a violation
  ✘ e2e/admin-users.spec.ts › an invitation whose email failed says so, on the staff screen and the overview
  ✘ e2e/admin-users.spec.ts › the last Admin cannot demote themselves
  ✘ e2e/admin-users.spec.ts › ban ends the member’s session and keeps them out; unban lets them back
  ✘ e2e/admin-users.spec.ts › remove deletes the account, after a confirmation
  ✘ e2e/admin-users.spec.ts › an Editor has no Nhân viên link, and /admin/users shows the 403 view with no staff data
```

- [ ] **Bước 3: Viết test cho truy vấn của màn Nhân viên**

Create `test/integration/staff-queries.test.ts`:

```ts
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listOpenInvitations, listStaff } from '@/lib/server/auth/staff-queries';
import { TEST_DATABASE_URL } from '../helpers/db';
import { STAFF_TABLES, createBootstrapAdmin, createStaffUser, createTestAuth } from '../helpers/auth';

/* What /admin/users and the overview read (spec §7.2). */

let pool: Pool;

const invite = (email: string, set = '') =>
  pool.query(
    `INSERT INTO staff_invitation (email, role, token_hash, expires_at, created_at)
     VALUES ($1, 'editor', md5($1) || md5($1), now() + interval '7 days', now() - (SELECT count(*) FROM staff_invitation) * interval '1 minute')`,
    [email],
  ).then(() => (set ? pool.query(`UPDATE staff_invitation SET ${set} WHERE email = $1`, [email]) : undefined));

describe.skipIf(!TEST_DATABASE_URL)('staff queries', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE ${STAFF_TABLES} CASCADE`);
  });

  it('lists staff oldest first, with role and ban', async () => {
    const auth = createTestAuth(pool);
    const owner = await createBootstrapAdmin(auth);
    const ed = await createStaffUser(auth, pool, 'ed@furama.test', 'editor');
    await pool.query('UPDATE staff_user SET banned = true WHERE id = $1', [ed.id]);
    const staff = await listStaff(pool);
    expect(staff.map(({ id, email, role, banned }) => ({ id, email, role, banned }))).toEqual([
      { id: owner.id, email: owner.email, role: 'admin', banned: false },
      { id: ed.id, email: 'ed@furama.test', role: 'editor', banned: true },
    ]);
    expect(staff[0].created_at).toBeInstanceOf(Date);
  });

  it('lists open invitations newest first, says which expired, and shows the last email error', async () => {
    await invite('open@furama.test');
    await invite('expired@furama.test', `expires_at = now() - interval '1 second'`);
    await invite('failed@furama.test', `email_error = 'provider_error: Resend rejected the email: rate limited'`);
    await invite('used@furama.test', 'used_at = now()');
    await invite('revoked@furama.test', 'revoked_at = now()');
    const open = await listOpenInvitations(pool);
    expect(open.map(({ email, expired, email_error }) => ({ email, expired, email_error }))).toEqual([
      { email: 'open@furama.test', expired: false, email_error: null },
      { email: 'expired@furama.test', expired: true, email_error: null },
      { email: 'failed@furama.test', expired: false, email_error: 'provider_error: Resend rejected the email: rate limited' },
    ]);
    expect(open[0].id).toMatch(/^\d+$/);
  });
});
```

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/staff-queries.test.ts`
Expected: FAIL `Error: Cannot find package '@/lib/server/auth/staff-queries' imported from …/test/integration/staff-queries.test.ts`

- [ ] **Bước 4: Viết truy vấn**

Create `lib/server/auth/staff-queries.ts`:

```ts
import 'server-only';
import type { Pool } from 'pg';
import type { StaffRole } from './permissions';

/*
 * Reads for /admin/users and the overview. Callers check user:list first.
 * "Expired" is decided by the database clock, not by Date.now() in a render.
 */

export type StaffRow = { id: string; name: string; email: string; role: StaffRole; banned: boolean; created_at: Date };

export type OpenInvitationRow = {
  id: string;
  email: string;
  role: StaffRole;
  expires_at: Date;
  expired: boolean;
  /** The last delivery failure ("<code>: <message>"), or null once a send worked. */
  email_error: string | null;
};

export async function listStaff(pool: Pool): Promise<StaffRow[]> {
  const { rows } = await pool.query<StaffRow>(
    `SELECT id, name, email, role, banned IS TRUE AS banned, created_at FROM staff_user ORDER BY created_at, id`,
  );
  return rows;
}

/** Invitations not used and not revoked, newest first; expired ones too, so they can be sent again. */
export async function listOpenInvitations(pool: Pool): Promise<OpenInvitationRow[]> {
  const { rows } = await pool.query<OpenInvitationRow>(
    `SELECT id::text, email, role, expires_at, expires_at <= now() AS expired, email_error
       FROM staff_invitation
      WHERE used_at IS NULL AND revoked_at IS NULL
      ORDER BY created_at DESC, id DESC`,
  );
  return rows;
}
```

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/staff-queries.test.ts`
Expected: PASS `Tests  2 passed (2)`

- [ ] **Bước 5: Mở rộng guard: mọi action của màn Nhân viên phải đòi quyền mà Editor không có**

Sửa `test/guards/require-permission.guard.test.ts` đúng như diff:

```diff
diff --git a/test/guards/require-permission.guard.test.ts b/test/guards/require-permission.guard.test.ts
index de239b6..934f8b7 100644
--- a/test/guards/require-permission.guard.test.ts
+++ b/test/guards/require-permission.guard.test.ts
@@ -2,7 +2,7 @@ import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
 import { tmpdir } from 'node:os';
 import { dirname, join } from 'node:path';
 import { describe, expect, it } from 'vitest';
-import { adminPluginCalls, adminPluginCallsIn, checkActions, publicActionsMissing, scanRepo } from './server-actions';
+import { adminOnlyProblems, adminPluginCalls, adminPluginCallsIn, checkActions, publicActionsMissing, scanRepo } from './server-actions';
 
 /*
  * Spec §7.1 / §13 "Bảo vệ": every Server Action ('use server' export or inline
@@ -33,8 +33,15 @@ describe('requirePermission guard (the repository)', () => {
   it('the admin plugin’s endpoints are called only from lib/server/auth/staff.ts and scripts/create-admin.mjs', () => {
     expect(adminPluginCalls(ROOT)).toEqual([]);
   });
+
+  it('every staff-screen action asks for a permission the Editor lacks', () => {
+    expect(adminOnlyProblems(ROOT, ADMIN_ONLY_ACTIONS)).toEqual([]);
+  });
 });
 
+/** Files whose every action is Admin-only (spec §7.1: staff, invitations). */
+const ADMIN_ONLY_ACTIONS = ['app/admin/(shell)/users/actions.ts'];
+
 describe('requirePermission guard (what it catches)', () => {
   const none = new Set<string>();
   const check = (source: string, rel = 'app/x/actions.ts', allow = none) => checkActions(rel, source, allow);
@@ -135,6 +142,17 @@ export async function b() {
     expect(adminPluginCallsIn('lib/server/auth/staff.ts', source)).toEqual([]);
   });
 
+  it('an Admin-only action whose permission an Editor also has, or that is not a literal', () => {
+    const source = `'use server';
+export async function a() { await requirePermission({ user: ['create'] }); }
+export async function b() { await requirePermission({ content: ['update'] }); }
+export async function c() { await requirePermission(PERMS); }`;
+    expect(adminOnlyProblems(ROOT, ['x.ts'], () => source)).toEqual([
+      'x.ts#b: an Editor passes requirePermission({"content":["update"]})',
+      'x.ts#c: requirePermission() must take an object literal',
+    ]);
+  });
+
   it('the public list exempts exactly the named export', () => {
     const source = `'use server';\nexport async function signIn() {}\nexport async function other() {}`;
     expect(check(source, 'app/a/actions.ts', new Set(['app/a/actions.ts#signIn']))).toEqual([
```

Run: `npx vitest run test/guards`
Expected: FAIL `Tests  2 failed | 14 passed (16)`, cả hai `TypeError: adminOnlyProblems is not a function`.

Sửa `test/guards/server-actions.ts` đúng như diff:

```diff
diff --git a/test/guards/server-actions.ts b/test/guards/server-actions.ts
index 7ec4805..76d2028 100644
--- a/test/guards/server-actions.ts
+++ b/test/guards/server-actions.ts
@@ -2,7 +2,7 @@ import { readdirSync, readFileSync } from 'node:fs';
 import { join, relative } from 'node:path';
 import { admin } from 'better-auth/plugins/admin';
 import { parseSync } from 'oxc-parser';
-import { ac, roles } from '../../lib/server/auth/permissions';
+import { ac, roleCan, roles, type Permissions } from '../../lib/server/auth/permissions';
 
 /*
  * The scanner behind test/guards/require-permission.guard.test.ts. TypeScript
@@ -258,3 +258,50 @@ export function adminPluginCalls(root: string): string[] {
   return sourceFiles(root).flatMap((rel) => adminPluginCallsIn(rel, readFileSync(join(root, rel), 'utf8')));
 }
 
+/** The first requirePermission(...) call inside a node. */
+function requirePermissionCall(node: unknown): Node | null {
+  let call: Node | null = null;
+  walk(node, (n) => {
+    const callee = n.type === 'CallExpression' ? (n.callee as Node) : null;
+    if (!call && callee?.type === 'Identifier' && callee.name === 'requirePermission') call = n;
+  });
+  return call;
+}
+
+/** `{ user: ['set-role'] }` as written in the source, or null if it is anything but a literal of string arrays. */
+function literalPermissions(arg: unknown): Permissions | null {
+  if (!isNode(arg) || arg.type !== 'ObjectExpression') return null;
+  const out: Record<string, string[]> = {};
+  for (const prop of arg.properties as Node[]) {
+    const key = prop.key as Node | undefined;
+    const value = prop.value as Node | undefined;
+    const name = key?.type === 'Identifier' ? key.name : key?.type === 'Literal' ? key.value : undefined;
+    if (prop.type !== 'Property' || typeof name !== 'string' || value?.type !== 'ArrayExpression') return null;
+    const actions = (value.elements as Node[]).map((e) => (e?.type === 'Literal' && typeof e.value === 'string' ? e.value : null));
+    if (actions.some((a) => a === null)) return null;
+    out[name] = actions as string[];
+  }
+  return out as Permissions;
+}
+
+/**
+ * Every action in these files must ask for a permission the Editor lacks,
+ * written as a literal so this check can read it: a typo or a shared
+ * permission would otherwise open an Admin-only action to Editors.
+ */
+export function adminOnlyProblems(
+  root: string,
+  rels: readonly string[],
+  read: (rel: string) => string = (rel) => readFileSync(join(root, rel), 'utf8'),
+): string[] {
+  return rels.flatMap((rel) =>
+    exportedFunctions(parse(rel, read(rel))).flatMap(({ name, fn }) => {
+      const [first] = fn ? statements(fn) : [];
+      const scope = first?.type === 'TryStatement' ? ((first.block as Node).body as Node[])[0] : first;
+      const permissions = literalPermissions((requirePermissionCall(scope)?.arguments as unknown[] | undefined)?.[0]);
+      if (!permissions) return [`${rel}#${name}: requirePermission() must take an object literal`];
+      if (roleCan('editor', permissions)) return [`${rel}#${name}: an Editor passes requirePermission(${JSON.stringify(permissions)})`];
+      return [];
+    }),
+  );
+}
```

Run: `npx vitest run test/guards`
Expected: FAIL `Tests  1 failed | 15 passed (16)`: `× every staff-screen action asks for a permission the Editor lacks`, `Error: ENOENT: no such file or directory, open '…/app/admin/(shell)/users/actions.ts'`. Các bước sau tạo file đó.

- [ ] **Bước 6: Trang 403 trong khung**

`forbidden()` cần `experimental.authInterrupts` (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/forbidden.md:17`). Sửa `next.config.ts` đúng như diff:

```diff
diff --git a/next.config.ts b/next.config.ts
index 08e7624..6fe751d 100644
--- a/next.config.ts
+++ b/next.config.ts
@@ -7,6 +7,8 @@ const nextConfig: NextConfig = {
   experimental: {
     // app/global-not-found.tsx: there is no app/layout.tsx to hold a 404 for unmatched URLs.
     globalNotFound: true,
+    // forbidden() for admin pages a role may not open (lib/server/dal/session.ts, app/admin/(shell)/forbidden.tsx).
+    authInterrupts: true,
   },
   async redirects() {
     return [
```

Sửa `lib/server/dal/session.ts` đúng như diff:

```diff
diff --git a/lib/server/dal/session.ts b/lib/server/dal/session.ts
index e250a18..24aa288 100644
--- a/lib/server/dal/session.ts
+++ b/lib/server/dal/session.ts
@@ -1,6 +1,6 @@
 import 'server-only';
 import { headers } from 'next/headers';
-import { redirect } from 'next/navigation';
+import { forbidden, redirect } from 'next/navigation';
 import { cache } from 'react';
 import { ADMIN_SIGN_IN } from '@/lib/admin/paths';
 import type { AuditActor } from '@/lib/server/audit';
@@ -56,6 +56,18 @@ export async function verifySession(): Promise<StaffSession> {
   return staff;
 }
 
+/**
+ * Pages for some roles only: the staff member, or the 403 view of the nearest
+ * forbidden.tsx (app/admin/(shell)/forbidden.tsx), with the URL kept. Under
+ * Cache Components the response status stays 200 on next start (the shell's
+ * status is sent before the render resumes); the page body still carries no data.
+ */
+export async function requirePagePermission(permissions: Permissions): Promise<StaffSession> {
+  const staff = await verifySession();
+  if (!roleCan(staff.role, permissions)) forbidden();
+  return staff;
+}
+
 /**
  * Server Actions and route handlers, as their first statement: the staff
  * member if their role grants every requested action, else a PermissionError
```

Create `app/admin/(shell)/forbidden.tsx`:

```tsx
import Link from 'next/link';

/* forbidden() from requirePagePermission(): inside the shell, the URL kept, no data of the page rendered. */
export default function Forbidden() {
  return (
    <>
      <h1>Không có quyền truy cập</h1>
      <p className="a-lede">Trang này chỉ dành cho Admin. Nếu bạn cần quyền này, hãy liên hệ Admin.</p>
      <Link className="a-btn a-btn--ghost" href="/admin">
        Về trang tổng quan
      </Link>
    </>
  );
}
```

- [ ] **Bước 7: Viết các action của màn Nhân viên**

Create `app/admin/(shell)/users/actions.ts`:

```ts
'use server';

import { refresh } from 'next/cache';
import { getPool } from '@/db/client';
import { z } from '@/lib/admin/zod';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { staffDeps } from '@/lib/server/auth/auth';
import { STAFF_ROLES } from '@/lib/server/auth/permissions';
import * as staff from '@/lib/server/auth/staff';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * The staff screen's actions, each in the order of spec §7.4:
 * requirePermission → zod → one transaction with its audit row (inside
 * lib/server/auth/staff.ts) → refresh() → an ActionResult. Staff writes touch
 * no cached tag, so refresh() re-renders the page instead of updateTag.
 * Every permission here is one the Editor lacks (test/guards checks it).
 */

const InvitationId = z.string().regex(/^\d{1,18}$/);
const UserId = z.string().min(1).max(64);

const InviteInput = z.object({
  email: z.email({ error: 'Nhập email công việc, ví dụ ten@furamavietnam.com.' }).max(254),
  role: z.enum(STAFF_ROLES, { error: 'Chọn vai trò.' }),
});

export async function inviteStaff(
  _prev: ActionResult<{ emailSent: boolean }> | null,
  formData: FormData,
): Promise<ActionResult<{ emailSent: boolean }>> {
  try {
    const actor = await requirePermission({ user: ['create'] });
    const input = InviteInput.parse({ email: formData.get('email'), role: formData.get('role') });
    const result = await staff.createInvitation(staffDeps(), auditActor(actor), input);
    if (!result.ok) return result;
    refresh();
    return { ok: true, data: { emailSent: result.emailSent } };
  } catch (err) {
    return actionError(err);
  }
}

export async function resendInvite(id: string): Promise<ActionResult<{ emailSent: boolean }>> {
  try {
    const actor = await requirePermission({ user: ['create'] });
    const result = await staff.resendInvitation(staffDeps(), auditActor(actor), InvitationId.parse(id));
    if (!result.ok) return result;
    refresh();
    return { ok: true, data: { emailSent: result.emailSent } };
  } catch (err) {
    return actionError(err);
  }
}

export async function revokeInvite(id: string): Promise<ActionResult> {
  try {
    const actor = await requirePermission({ user: ['create'] });
    const result = await staff.revokeInvitation(staffDeps(), auditActor(actor), InvitationId.parse(id));
    if (!result.ok) return result;
    refresh();
    return { ok: true, data: null };
  } catch (err) {
    return actionError(err);
  }
}

export async function changeStaffRole(userId: string, role: string): Promise<ActionResult<{ changed: boolean }>> {
  try {
    const actor = await requirePermission({ user: ['set-role'] });
    const input = z.object({ userId: UserId, role: z.enum(STAFF_ROLES) }).parse({ userId, role });
    const result = await staff.setStaffRole(getPool(), auditActor(actor), input);
    if (!result.ok) return result;
    refresh();
    return { ok: true, data: { changed: result.changed } };
  } catch (err) {
    return actionError(err);
  }
}

export async function banStaffMember(userId: string): Promise<ActionResult> {
  try {
    const actor = await requirePermission({ user: ['ban'] });
    const result = await staff.banStaff(getPool(), auditActor(actor), UserId.parse(userId));
    if (!result.ok) return result;
    refresh();
    return { ok: true, data: null };
  } catch (err) {
    return actionError(err);
  }
}

export async function unbanStaffMember(userId: string): Promise<ActionResult> {
  try {
    const actor = await requirePermission({ user: ['ban'] });
    const result = await staff.unbanStaff(getPool(), auditActor(actor), UserId.parse(userId));
    if (!result.ok) return result;
    refresh();
    return { ok: true, data: null };
  } catch (err) {
    return actionError(err);
  }
}

export async function removeStaffMember(userId: string): Promise<ActionResult> {
  try {
    const actor = await requirePermission({ user: ['delete'] });
    const result = await staff.removeStaff(getPool(), auditActor(actor), UserId.parse(userId));
    if (!result.ok) return result;
    refresh();
    return { ok: true, data: null };
  } catch (err) {
    return actionError(err);
  }
}
```

- [ ] **Bước 8: Viết giao diện màn Nhân viên**

Trình duyệt chỉ nhận những gì màn hình hiện: ngày giờ và nhãn vai trò được định dạng ở server. (Nếu component client import `lib/admin/nav.ts`, ma trận quyền của better-auth vào bundle của trình duyệt.)

Create `app/admin/(shell)/users/InviteForm.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { actionErrorMessage } from '@/lib/admin/auth-errors';
import type { ActionResult } from '@/lib/server/action-result';
import { inviteStaff } from './actions';

export function InviteForm() {
  const [state, action, pending] = useActionState<ActionResult<{ emailSent: boolean }> | null, FormData>(inviteStaff, null);
  const failed = state && !state.ok ? state : null;
  const errors = failed?.fieldErrors ?? {};

  return (
    <form className="a-inline-form" action={action} noValidate aria-labelledby="invite-title">
      <h2 id="invite-title">Mời nhân viên</h2>
      {state?.ok ? (
        <p className="a-notice" role="status">
          {state.data.emailSent ? 'Đã gửi lời mời.' : 'Đã tạo lời mời. Chưa gửi được email, bấm Gửi lại.'}
        </p>
      ) : null}
      {failed && !failed.fieldErrors ? (
        <p className="a-alert" role="alert">
          {actionErrorMessage(failed.code)}
        </p>
      ) : null}
      <div className="a-field">
        <label htmlFor="invite-email">Email</label>
        <input
          id="invite-email"
          name="email"
          type="email"
          required
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? 'invite-email-error' : undefined}
        />
        {errors.email ? (
          <p className="a-field-error" id="invite-email-error">
            {errors.email[0]}
          </p>
        ) : null}
      </div>
      <div className="a-field">
        <label htmlFor="invite-role">Vai trò</label>
        <select id="invite-role" name="role" defaultValue="editor">
          <option value="editor">Editor</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <button className="a-btn" type="submit" disabled={pending}>
        {pending ? 'Đang gửi…' : 'Gửi lời mời'}
      </button>
    </form>
  );
}
```

Create `app/admin/(shell)/users/InvitationList.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { actionErrorMessage } from '@/lib/admin/auth-errors';
import { resendInvite, revokeInvite } from './actions';

/* Labels arrive formatted from the server, so no permission code ships to the browser. */
export type InvitationItem = { id: string; email: string; roleLabel: string; expiresLabel: string; expired: boolean; emailFailed: boolean };

export function InvitationList({ invitations }: { invitations: InvitationItem[] }) {
  if (invitations.length === 0) return <p className="a-lede">Không có lời mời nào đang chờ.</p>;
  return (
    <ul className="a-list" aria-label="Lời mời đang chờ">
      {invitations.map((invitation) => (
        <Invitation key={invitation.id} invitation={invitation} />
      ))}
    </ul>
  );
}

function Invitation({ invitation }: { invitation: InvitationItem }) {
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  const resend = () =>
    startTransition(async () => {
      const result = await resendInvite(invitation.id);
      if (!result.ok) setMessage({ text: actionErrorMessage(result.code), error: true });
      else setMessage({ text: result.data.emailSent ? 'Đã gửi lại.' : 'Chưa gửi được email, bấm Gửi lại.', error: !result.data.emailSent });
    });
  const revoke = () =>
    startTransition(async () => {
      const result = await revokeInvite(invitation.id);
      // On success the refreshed list no longer has this row.
      if (!result.ok) setMessage({ text: actionErrorMessage(result.code), error: true });
    });

  return (
    <li className="a-list-item" data-email={invitation.email}>
      <div>
        <strong>{invitation.email}</strong> · {invitation.roleLabel} ·{' '}
        {invitation.expired ? 'đã hết hạn' : `hết hạn ${invitation.expiresLabel}`}
        {invitation.emailFailed && !message ? (
          <p className="a-field-error" role="alert">
            Chưa gửi được email, bấm Gửi lại.
          </p>
        ) : null}
        {message ? (
          <p className={message.error ? 'a-field-error' : 'a-notice'} role={message.error ? 'alert' : 'status'}>
            {message.text}
          </p>
        ) : null}
      </div>
      <div className="a-actions">
        <button className="a-btn a-btn--ghost" type="button" disabled={pending} onClick={resend}>
          Gửi lại
        </button>
        <button className="a-btn a-btn--ghost" type="button" disabled={pending} onClick={revoke}>
          Thu hồi
        </button>
      </div>
    </li>
  );
}
```

Create `app/admin/(shell)/users/StaffTable.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { actionErrorMessage } from '@/lib/admin/auth-errors';
import type { ActionResult } from '@/lib/server/action-result';
import type { StaffRole } from '@/lib/server/auth/permissions';
import { banStaffMember, changeStaffRole, removeStaffMember, unbanStaffMember } from './actions';

export type StaffItem = { id: string; name: string; email: string; role: StaffRole; banned: boolean; createdLabel: string; isSelf: boolean };

export function StaffTable({ staff }: { staff: StaffItem[] }) {
  return (
    <table className="a-table">
      <thead>
        <tr>
          <th scope="col">Họ tên</th>
          <th scope="col">Email</th>
          <th scope="col">Vai trò</th>
          <th scope="col">Trạng thái</th>
          <th scope="col">Ngày tạo</th>
          <th scope="col">Thao tác</th>
        </tr>
      </thead>
      <tbody>
        {staff.map((member) => (
          <StaffRow key={member.id} member={member} />
        ))}
      </tbody>
    </table>
  );
}

function StaffRow({ member }: { member: StaffItem }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<ActionResult<unknown>>, onFail?: () => void) =>
    startTransition(async () => {
      const result = await action();
      if (result.ok) setError(null);
      else {
        onFail?.();
        setError(actionErrorMessage(result.code));
      }
    });

  return (
    <tr data-email={member.email}>
      <td>
        {member.name}
        {member.isSelf ? ' (bạn)' : null}
      </td>
      <td>{member.email}</td>
      <td>
        <select
          aria-label={`Vai trò của ${member.email}`}
          defaultValue={member.role}
          disabled={pending}
          onChange={(event) => {
            const select = event.currentTarget;
            run(
              () => changeStaffRole(member.id, select.value),
              () => {
                select.value = member.role;
              },
            );
          }}
        >
          <option value="admin">Admin</option>
          <option value="editor">Editor</option>
        </select>
        {error ? (
          <p className="a-field-error" role="alert">
            {error}
          </p>
        ) : null}
      </td>
      <td>{member.banned ? 'Đã khóa' : 'Hoạt động'}</td>
      <td>{member.createdLabel}</td>
      <td className="a-actions">
        {member.isSelf ? null : (
          <>
            {member.banned ? (
              <button className="a-btn a-btn--ghost" type="button" disabled={pending} onClick={() => run(() => unbanStaffMember(member.id))}>
                Mở khóa
              </button>
            ) : (
              <button className="a-btn a-btn--ghost" type="button" disabled={pending} onClick={() => run(() => banStaffMember(member.id))}>
                Khóa
              </button>
            )}
            <button
              className="a-btn a-btn--ghost"
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Xóa tài khoản ${member.email}? Không hoàn tác được.`)) run(() => removeStaffMember(member.id));
              }}
            >
              Xóa
            </button>
          </>
        )}
      </td>
    </tr>
  );
}
```

Create `app/admin/(shell)/users/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { getPool } from '@/db/client';
import { formatDateTimeVi } from '@/lib/admin/format';
import { ROLE_LABELS } from '@/lib/admin/nav';
import { listOpenInvitations, listStaff } from '@/lib/server/auth/staff-queries';
import { requirePagePermission } from '@/lib/server/dal/session';
import { InvitationList, type InvitationItem } from './InvitationList';
import { InviteForm } from './InviteForm';
import { StaffTable, type StaffItem } from './StaffTable';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Nhân viên' };

export default async function UsersPage() {
  // Before any query: an Editor gets the 403 view and no staff data.
  const me = await requirePagePermission({ user: ['list'] });
  const pool = getPool();
  const [staffRows, invitationRows] = await Promise.all([listStaff(pool), listOpenInvitations(pool)]);

  // Only what the screen shows reaches the browser; dates and labels are formatted here (dates on Vietnam's clock).
  const staff: StaffItem[] = staffRows.map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email,
    role: s.role,
    banned: s.banned,
    createdLabel: formatDateTimeVi(s.created_at),
    isSelf: s.id === me.userId,
  }));
  const invitations: InvitationItem[] = invitationRows.map((i) => ({
    id: i.id,
    email: i.email,
    roleLabel: ROLE_LABELS[i.role],
    expiresLabel: formatDateTimeVi(i.expires_at),
    expired: i.expired,
    emailFailed: i.email_error !== null,
  }));

  return (
    <>
      <h1>Nhân viên</h1>
      <p className="a-lede">Mời người mới, đổi vai trò, khóa hoặc xóa tài khoản. Mọi thay đổi được ghi vào nhật ký.</p>
      <StaffTable staff={staff} />
      <h2>Lời mời đang chờ</h2>
      <InvitationList invitations={invitations} />
      <InviteForm />
    </>
  );
}
```

- [ ] **Bước 9: Thêm "Nhân viên" vào menu**

Sửa `lib/admin/nav.ts` và `lib/admin/nav.test.ts` đúng như diff:

```diff
diff --git a/lib/admin/nav.ts b/lib/admin/nav.ts
index 09b4581..e4dbcc3 100644
--- a/lib/admin/nav.ts
+++ b/lib/admin/nav.ts
@@ -7,7 +7,10 @@ export type NavItem = { href: string; label: string; permission?: Permissions };
  * that have it; the page behind it checks again on the server. Each phase
  * appends its screens here as it builds them (spec §7.2).
  */
-export const ADMIN_NAV: readonly NavItem[] = [{ href: '/admin', label: 'Tổng quan' }];
+export const ADMIN_NAV: readonly NavItem[] = [
+  { href: '/admin', label: 'Tổng quan' },
+  { href: '/admin/users', label: 'Nhân viên', permission: { user: ['list'] } },
+];
 
 export function navFor(role: StaffRole): NavItem[] {
   return ADMIN_NAV.filter((item) => !item.permission || roleCan(role, item.permission));
```

```diff
diff --git a/lib/admin/nav.test.ts b/lib/admin/nav.test.ts
index a795e55..40dc737 100644
--- a/lib/admin/nav.test.ts
+++ b/lib/admin/nav.test.ts
@@ -3,7 +3,7 @@ import { navFor } from './nav';
 
 describe('navFor', () => {
   it('shows each role only what its permissions open', () => {
-    expect(navFor('admin').map((i) => i.label)).toEqual(['Tổng quan']);
+    expect(navFor('admin').map((i) => i.label)).toEqual(['Tổng quan', 'Nhân viên']);
     expect(navFor('editor').map((i) => i.label)).toEqual(['Tổng quan']);
   });
 });
```

- [ ] **Bước 10: Tổng quan báo cho Admin các lời mời chưa gửi được email**

Thay toàn bộ `app/admin/(shell)/page.tsx` bằng:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { todayVi } from '@/lib/admin/format';
import { roleCan } from '@/lib/server/auth/permissions';
import { listOpenInvitations } from '@/lib/server/auth/staff-queries';
import { verifySession } from '@/lib/server/dal/session';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Tổng quan' };

/*
 * Phase 3 shows the greeting and, to Admins, invitations whose email failed
 * (spec §7.2 "email lỗi"). Bookings, translations and notification widgets
 * arrive with phases 4, 5 and 8.
 */
export default async function OverviewPage() {
  const staff = await verifySession();
  const failed = roleCan(staff.role, { user: ['list'] })
    ? (await listOpenInvitations(getPool())).filter((i) => i.email_error !== null)
    : [];

  return (
    <>
      <h1>Tổng quan</h1>
      <p className="a-lede">
        Xin chào, {staff.name}. Hôm nay là <time data-testid="today">{todayVi()}</time>.
      </p>
      {failed.length > 0 ? (
        <section aria-labelledby="failed-invitations">
          <h2 id="failed-invitations">Lời mời chưa gửi được email</h2>
          <ul className="a-list">
            {failed.map((i) => (
              <li className="a-list-item" key={i.id}>
                {i.email}
              </li>
            ))}
          </ul>
          <p>
            <Link href="/admin/users">Mở trang Nhân viên để gửi lại</Link>
          </p>
        </section>
      ) : null}
    </>
  );
}
```

- [ ] **Bước 11: Kiểu cho bảng, danh sách và form**

Sửa `styles/admin.css`: thêm vào cuối file, đúng như diff:

```diff
diff --git a/styles/admin.css b/styles/admin.css
index c40122b..d5b0bba 100644
--- a/styles/admin.css
+++ b/styles/admin.css
@@ -295,3 +295,71 @@ body.admin {
     padding: 20px 16px 40px;
   }
 }
+
+/* ---------- Staff screen and overview ---------- */
+
+.a-main h2 {
+  margin: 32px 0 12px;
+  font-size: 18px;
+  font-weight: 600;
+}
+
+.a-table select,
+.a-field select {
+  min-height: 36px;
+  padding: 0 8px;
+  border: 1px solid var(--a-line);
+  border-radius: 6px;
+  background: var(--a-surface);
+  color: var(--a-ink);
+  font: inherit;
+}
+
+.a-actions {
+  display: flex;
+  flex-wrap: wrap;
+  gap: 8px;
+}
+
+.a-actions .a-btn {
+  min-height: 34px;
+  padding: 0 12px;
+  font-weight: 500;
+}
+
+.a-list {
+  list-style: none;
+  margin: 0;
+  padding: 0;
+  border: 1px solid var(--a-line);
+  border-radius: var(--a-radius);
+  background: var(--a-surface);
+}
+
+.a-list-item {
+  display: flex;
+  align-items: center;
+  justify-content: space-between;
+  gap: 16px;
+  padding: 12px 14px;
+  border-bottom: 1px solid var(--a-line);
+}
+
+.a-list-item:last-child {
+  border-bottom: 0;
+}
+
+.a-notice {
+  margin: 4px 0 0;
+  color: var(--a-accent);
+  font-size: 14px;
+}
+
+.a-inline-form {
+  max-width: 420px;
+  margin-top: 32px;
+}
+
+.a-inline-form .a-btn {
+  margin-top: 4px;
+}
```

- [ ] **Bước 12: Chạy test đơn vị, rồi kiểm rằng guard bắt được quyền sai và kiểm muộn**

```bash
npm run typecheck
npx vitest run test/guards lib/admin
cp 'app/admin/(shell)/users/actions.ts' "${TMPDIR:-/tmp}/users-actions.bak"
python3 - <<'PY'
p = 'app/admin/(shell)/users/actions.ts'
s = open(p).read()
# revokeInvite asks for a permission the Editor has
old = "export async function revokeInvite(id: string): Promise<ActionResult> {\n  try {\n    const actor = await requirePermission({ user: ['create'] });"
assert old in s
s = s.replace(old, old.replace("{ user: ['create'] }", "{ content: ['update'] }"))
# banStaffMember writes before it checks
old = "    const actor = await requirePermission({ user: ['ban'] });\n    const result = await staff.banStaff(getPool(), auditActor(actor), UserId.parse(userId));"
assert old in s
s = s.replace(old, "    const result = await staff.banStaff(getPool(), { id: 'x', email: 'x' }, UserId.parse(userId));\n    await requirePermission({ user: ['ban'] });")
open(p, 'w').write(s)
PY
npx vitest run test/guards
cp "${TMPDIR:-/tmp}/users-actions.bak" 'app/admin/(shell)/users/actions.ts'
grep -c "requirePermission({ user: \['create'\] })" 'app/admin/(shell)/users/actions.ts'
npx vitest run test/guards
```

Expected: typecheck sạch; lần chạy đầu PASS `Tests  65 passed (65)`; bản đột biến FAIL:

```
     × every Server Action and /api/admin route handler checks requirePermission first, except the public list
+   "app/admin/(shell)/users/actions.ts#banStaffMember: does not start with await requirePermission()",
     × every staff-screen action asks for a permission the Editor lacks
+   "app/admin/(shell)/users/actions.ts#revokeInvite: an Editor passes requirePermission({\"content\":[\"update\"]})",
+   "app/admin/(shell)/users/actions.ts#banStaffMember: requirePermission() must take an object literal",
```

sau khi chép lại: `grep -c` in `3` (ba action lời mời lại đòi `user:create`), và PASS `Tests  16 passed (16)`.

- [ ] **Bước 13: Chạy cổng kiểm tra**

```bash
npm run typecheck
npm run lint
TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
node scripts/check-prerender.mjs
grep -l "impersonate-admins" .next/static/chunks/*.js
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson E2E_PORT=3210 npm run test:e2e -- --retries=0
lsof -nP -iTCP:3211 -sTCP:LISTEN
PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3211 EMAIL_DELIVERY=log npx next start -p 3211 &
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3211/ && break; sleep 1; done
VISUAL_BASE_URL=http://localhost:3211 npm run test:visual
lsof -ti tcp:3211 | xargs kill
```

Expected:
- typecheck sạch; lint 0 lỗi, 20 cảnh báo; `Test Files  38 passed (38)`, `Tests  349 passed (349)`;
- check-prerender in `Admin check passed: /admin, /admin/accept-invite, /admin/reset-password, /admin/sign-in, /admin/users, /admin/[...missing] have no static shell.`;
- `grep -l "impersonate-admins"` không in gì (ma trận quyền không vào bundle của trình duyệt);
- E2E `63 passed`. Chạy E2E lần nữa ngay sau, không reset DB: vẫn `63 passed` (các spec chạy lại được trên cùng DB);
- visual `8 passed`.

- [ ] **Bước 14: Commit**

```bash
git add 'app/admin/(shell)/page.tsx' 'app/admin/(shell)/forbidden.tsx' 'app/admin/(shell)/users' e2e/admin-security.spec.ts e2e/staff-fixtures.ts e2e/admin-users.spec.ts lib/admin/nav.ts lib/admin/nav.test.ts lib/server/dal/session.ts lib/server/auth/staff-queries.ts next.config.ts styles/admin.css test/guards test/integration/staff-queries.test.ts
git commit -m "$(cat <<'EOF'
feat: manage staff and invitations on /admin/users

The staff screen (Admin only) lists the team with a role select, Khóa / Mở
khóa and Xóa, the open invitations with Gửi lại / Thu hồi and, when the last
send failed, "Chưa gửi được email, bấm Gửi lại", and an invite form. Each
action runs requirePermission (user:create, set-role, ban or delete), zod, the
transaction in lib/server/auth/staff.ts with its audit row, then refresh();
refusals such as the last Admin come back in Vietnamese. The browser gets
only what the screen shows, with dates already formatted on Vietnam's clock.

An Editor sees no link to it, and opening it renders the shell's 403 view
(forbidden() with experimental.authInterrupts) with none of the page's data.
The overview tells Admins which invitations never reached their inbox.

The CI guard now also reads each staff action's permission literal and fails
if an Editor would pass it. E2E covers the whole screen; the tests that rely
on the number of Admins take a database lock so parallel workers cannot
change it underneath them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 10: Màn Nhật ký `/admin/audit`

**Files:**
- Create: `e2e/admin-audit.spec.ts`
- Create: `lib/admin/audit-labels.ts`, `lib/admin/audit-labels.test.ts`
- Create: `lib/server/audit-feed.ts`, `test/integration/audit-feed.test.ts`
- Create: `app/admin/(shell)/audit/page.tsx`
- Modify: `lib/admin/nav.ts`, `lib/admin/nav.test.ts`, `styles/admin.css`

**Interfaces:**
- Consumes: view `audit_feed` (Task 1); `requirePagePermission` (Task 9); `formatDateTimeVi` (Task 7); `one`, `seedStaff`, `signInAs`, `STAFF` (Task 7, 9).
- Produces:
  - `lib/admin/audit-labels.ts`: `auditActionLabel(action: string): string`, `auditEntityLabel(entityType: string): string`.
  - `lib/server/audit-feed.ts`: `AUDIT_PAGE_SIZE = 50`, `type AuditFeedRow`, `listAuditFeed(pool, page: number): Promise<{ rows: AuditFeedRow[]; hasNext: boolean }>`, `staffEmails(pool, ids): Promise<Map<string, string>>`.
  - Menu có "Nhật ký" (`audit:read`).

- [ ] **Bước 1: Viết E2E trước**

Create `e2e/admin-audit.spec.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/* /admin/audit (spec §7.2): Admin only, newest first, in Vietnamese. */

test.beforeAll(() => seedStaff());

test('the Admin reads a role change, with who did it and when', async ({ page }) => {
  const entity = `e2e-audit-${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  await one(
    `INSERT INTO audit_log (actor_id, actor_email, action, entity_type, entity_id, before, after)
     VALUES ($1, $2, 'staff.role', 'staff_user', $3, '{"role":"editor"}', '{"role":"admin"}')`,
    [STAFF.admin.id, STAFF.admin.email, entity],
  );
  await signInAs(page, STAFF.admin);
  await page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link', { name: 'Nhật ký' }).click();
  await expect(page.getByRole('heading', { name: 'Nhật ký', level: 1 })).toBeVisible();

  const row = page.getByRole('row').filter({ hasText: entity });
  await expect(row.getByRole('cell').nth(0)).toHaveText(/^\d{2}:\d{2} \d{2}\/\d{2}\/\d{4}$/);
  await expect(row.getByRole('cell').nth(1)).toHaveText(STAFF.admin.email);
  await expect(row.getByRole('cell').nth(2)).toHaveText('Đổi vai trò');
  await expect(row.getByRole('cell').nth(3)).toHaveText(`Nhân viên · ${entity}`);
  await row.getByText('Xem').click();
  await expect(row.locator('pre')).toContainText('"role": "admin"');
});

test('an Editor gets the 403 view and no audit rows', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  await expect(page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link', { name: 'Nhật ký' })).toHaveCount(0);
  const res = await page.goto('/admin/audit');
  expect(await res?.text()).not.toContain(STAFF.admin.email);
  await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
});
```

- [ ] **Bước 2: Build code hiện tại và chạy: phải đỏ**

```bash
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson E2E_PORT=3210 npx playwright test --retries=0 e2e/admin-audit.spec.ts
```

Expected: FAIL `2 failed` (chưa có trang, `/admin/audit` rơi vào trang 404 của admin):

```
  ✘ e2e/admin-audit.spec.ts › the Admin reads a role change, with who did it and when
  ✘ e2e/admin-audit.spec.ts › an Editor gets the 403 view and no audit rows
```

- [ ] **Bước 3: Viết test cho nhãn tiếng Việt**

Test đọc chính mã nguồn: mọi hành động `staff.*` mà code ghi đều phải có nhãn.

Create `lib/admin/audit-labels.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { auditActionLabel, auditEntityLabel } from './audit-labels';

describe('audit labels', () => {
  it('names every staff action the code writes, in Vietnamese', () => {
    const sources = ['lib/server/auth/staff.ts', 'scripts/create-admin.mjs'].map((f) => readFileSync(f, 'utf8')).join('\n');
    const written = [...new Set([...sources.matchAll(/'(staff\.[a-z_]+)'/g)].map((m) => m[1]))].sort();
    expect(written).toEqual([
      'staff.ban',
      'staff.bootstrap',
      'staff.invite',
      'staff.invite_accept',
      'staff.invite_resend',
      'staff.invite_revoke',
      'staff.remove',
      'staff.role',
      'staff.unban',
    ]);
    for (const action of written) expect(auditActionLabel(action)).not.toBe(action);
  });

  it('names the content actions of spec §5.2 and falls back to the raw action', () => {
    expect(['create', 'update', 'delete', 'reorder', 'restore', 'settings'].map(auditActionLabel)).toEqual([
      'Tạo mới',
      'Sửa',
      'Xóa',
      'Sắp xếp lại',
      'Khôi phục',
      'Đổi cài đặt',
    ]);
    expect(auditActionLabel('staff.something_new')).toBe('staff.something_new');
    expect(auditEntityLabel('staff_user')).toBe('Nhân viên');
    expect(auditEntityLabel('restaurant')).toBe('restaurant');
  });
});
```

Run: `npx vitest run lib/admin/audit-labels.test.ts`
Expected: FAIL `Error: Cannot find module './audit-labels' imported from …/lib/admin/audit-labels.test.ts`

- [ ] **Bước 4: Viết nhãn**

Create `lib/admin/audit-labels.ts`:

```ts
/*
 * Vietnamese names for audit_log.action and entity_type on /admin/audit.
 * The action list is spec §5.2's (create, update, delete, reorder, restore,
 * settings, staff.*); lib/admin/audit-labels.test.ts fails when the code
 * writes a staff action this file does not name.
 */
const ACTIONS: Record<string, string> = {
  create: 'Tạo mới',
  update: 'Sửa',
  delete: 'Xóa',
  reorder: 'Sắp xếp lại',
  restore: 'Khôi phục',
  settings: 'Đổi cài đặt',
  'staff.bootstrap': 'Tạo Admin đầu tiên',
  'staff.invite': 'Mời nhân viên',
  'staff.invite_resend': 'Gửi lại lời mời',
  'staff.invite_revoke': 'Thu hồi lời mời',
  'staff.invite_accept': 'Nhận lời mời',
  'staff.role': 'Đổi vai trò',
  'staff.ban': 'Khóa tài khoản',
  'staff.unban': 'Mở khóa tài khoản',
  'staff.remove': 'Xóa tài khoản',
};

const ENTITIES: Record<string, string> = {
  staff_user: 'Nhân viên',
  staff_invitation: 'Lời mời',
};

export function auditActionLabel(action: string): string {
  return ACTIONS[action] ?? action;
}

export function auditEntityLabel(entityType: string): string {
  return ENTITIES[entityType] ?? entityType;
}
```

Run: `npx vitest run lib/admin/audit-labels.test.ts`
Expected: PASS `Tests  2 passed (2)`

- [ ] **Bước 5: Viết test cho dòng thời gian**

Create `test/integration/audit-feed.test.ts`:

```ts
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AUDIT_PAGE_SIZE, listAuditFeed, staffEmails } from '@/lib/server/audit-feed';
import { TEST_DATABASE_URL } from '../helpers/db';
import { STAFF_TABLES, createBootstrapAdmin, createTestAuth } from '../helpers/auth';

/* /admin/audit reads audit_feed, newest first, 50 to a page (spec §5.2, §7.2). */

let pool: Pool;

describe.skipIf(!TEST_DATABASE_URL)('the audit feed', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE ${STAFF_TABLES} CASCADE`);
  });

  it('puts the newest first and breaks ties by id, numerically', async () => {
    await pool.query(
      `INSERT INTO audit_log (at, actor_email, action, entity_type, entity_id)
       VALUES (now() - interval '1 hour', 'a@furama.test', 'staff.invite', 'staff_invitation', 'old')`,
    );
    // Twelve rows from one statement share one `at`; the text ids must sort as numbers ("9" after "10").
    await pool.query(
      `INSERT INTO audit_log (at, actor_email, action, entity_type, entity_id)
       SELECT now(), 'a@furama.test', 'staff.role', 'staff_user', 'u' || g FROM generate_series(1, 12) AS g`,
    );
    const { rows, hasNext } = await listAuditFeed(pool, 1);
    expect(hasNext).toBe(false);
    expect(rows.map((r) => r.entity_id)).toEqual(['u12', 'u11', 'u10', 'u9', 'u8', 'u7', 'u6', 'u5', 'u4', 'u3', 'u2', 'u1', 'old']);
    expect(rows[0]).toMatchObject({ source: 'audit', actor_label: 'a@furama.test', action: 'staff.role', entity_type: 'staff_user' });
    expect(rows[0].at).toBeInstanceOf(Date);
  });

  it('pages by 50', async () => {
    await pool.query(
      `INSERT INTO audit_log (at, action, entity_type, entity_id)
       SELECT now() - g * interval '1 second', 'update', 'restaurant', 'r' || g FROM generate_series(1, 55) AS g`,
    );
    const first = await listAuditFeed(pool, 1);
    const second = await listAuditFeed(pool, 2);
    expect(AUDIT_PAGE_SIZE).toBe(50);
    expect(first.rows).toHaveLength(50);
    expect(first.hasNext).toBe(true);
    expect(second.rows.map((r) => r.entity_id)).toEqual(['r51', 'r52', 'r53', 'r54', 'r55']);
    expect(second.hasNext).toBe(false);
    expect((await listAuditFeed(pool, 99)).rows).toEqual([]);
  });

  it('looks up the email of staff the rows are about, skipping removed accounts', async () => {
    const owner = await createBootstrapAdmin(createTestAuth(pool));
    expect(await staffEmails(pool, [owner.id, 'removed-id'])).toEqual(new Map([[owner.id, owner.email]]));
    expect(await staffEmails(pool, [])).toEqual(new Map());
  });
});
```

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/audit-feed.test.ts`
Expected: FAIL `Error: Cannot find package '@/lib/server/audit-feed' imported from …/test/integration/audit-feed.test.ts`

- [ ] **Bước 6: Viết phần đọc dòng thời gian**

Create `lib/server/audit-feed.ts`:

```ts
import 'server-only';
import type { Pool } from 'pg';

/*
 * /admin/audit reads the audit_feed view (spec §5.2): audit_log now, joined by
 * reservation_events in phase 4 with the same columns. Newest first; rows
 * written in one transaction share `at`, so the tie-break is the source and
 * then the id as a number (ids are text in the view, hence the lpad).
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
};

/** One page (1-based) of the feed, and whether another page follows. */
export async function listAuditFeed(pool: Pool, page: number): Promise<{ rows: AuditFeedRow[]; hasNext: boolean }> {
  const { rows } = await pool.query<AuditFeedRow>(
    `SELECT source, id, at, actor_id, actor_label, action, entity_type, entity_id, locale, before, after
       FROM audit_feed
      ORDER BY at DESC, source DESC, lpad(id, 20, '0') DESC
      LIMIT $1 OFFSET $2`,
    [AUDIT_PAGE_SIZE + 1, (page - 1) * AUDIT_PAGE_SIZE],
  );
  return { rows: rows.slice(0, AUDIT_PAGE_SIZE), hasNext: rows.length > AUDIT_PAGE_SIZE };
}

/** id → email for the staff accounts that still exist; the feed shows the id of a removed one. */
export async function staffEmails(pool: Pool, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { rows } = await pool.query<{ id: string; email: string }>('SELECT id, email FROM staff_user WHERE id = ANY($1)', [
    [...new Set(ids)],
  ]);
  return new Map(rows.map((r) => [r.id, r.email]));
}
```

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/audit-feed.test.ts`
Expected: PASS `Tests  3 passed (3)`

- [ ] **Bước 7: Viết trang, kiểu và mục menu**

Create `app/admin/(shell)/audit/page.tsx`:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { auditActionLabel, auditEntityLabel } from '@/lib/admin/audit-labels';
import { formatDateTimeVi } from '@/lib/admin/format';
import { listAuditFeed, staffEmails } from '@/lib/server/audit-feed';
import { requirePagePermission } from '@/lib/server/dal/session';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Nhật ký' };

/** ?trang=2 → 2; anything else → 1. */
function pageNumber(value: string | string[] | undefined): number {
  const n = typeof value === 'string' && /^\d{1,4}$/.test(value) ? Number(value) : 1;
  return n >= 1 ? n : 1;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ trang?: string | string[] }> }) {
  // Before any query: an Editor gets the 403 view and no rows.
  await requirePagePermission({ audit: ['read'] });
  const page = pageNumber((await searchParams).trang);
  const pool = getPool();
  const { rows, hasNext } = await listAuditFeed(pool, page);
  const emails = await staffEmails(
    pool,
    rows.filter((r) => r.entity_type === 'staff_user' && r.entity_id).map((r) => r.entity_id as string),
  );

  return (
    <>
      <h1>Nhật ký</h1>
      <p className="a-lede">Ai đã làm gì, và lúc nào. Mới nhất ở trên.</p>
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
                <td>{`${auditEntityLabel(r.entity_type)} · ${(r.entity_id && emails.get(r.entity_id)) ?? r.entity_id ?? '—'}`}</td>
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
      <nav className="a-pager" aria-label="Phân trang">
        {page > 1 ? <Link href={page === 2 ? '/admin/audit' : `/admin/audit?trang=${page - 1}`}>← Mới hơn</Link> : null}
        {hasNext ? <Link href={`/admin/audit?trang=${page + 1}`}>Cũ hơn →</Link> : null}
      </nav>
    </>
  );
}
```

Sửa `styles/admin.css`: thêm vào cuối file, đúng như diff:

```diff
diff --git a/styles/admin.css b/styles/admin.css
index d5b0bba..4add557 100644
--- a/styles/admin.css
+++ b/styles/admin.css
@@ -363,3 +363,19 @@ body.admin {
 .a-inline-form .a-btn {
   margin-top: 4px;
 }
+
+/* ---------- Audit log ---------- */
+
+.a-pre {
+  max-width: 420px;
+  margin: 8px 0 0;
+  overflow-x: auto;
+  font-size: 12px;
+  white-space: pre-wrap;
+}
+
+.a-pager {
+  display: flex;
+  gap: 16px;
+  margin-top: 16px;
+}
```

Sửa `lib/admin/nav.ts` và `lib/admin/nav.test.ts` đúng như diff:

```diff
diff --git a/lib/admin/nav.ts b/lib/admin/nav.ts
index e4dbcc3..b8bbe35 100644
--- a/lib/admin/nav.ts
+++ b/lib/admin/nav.ts
@@ -10,6 +10,7 @@ export type NavItem = { href: string; label: string; permission?: Permissions };
 export const ADMIN_NAV: readonly NavItem[] = [
   { href: '/admin', label: 'Tổng quan' },
   { href: '/admin/users', label: 'Nhân viên', permission: { user: ['list'] } },
+  { href: '/admin/audit', label: 'Nhật ký', permission: { audit: ['read'] } },
 ];
 
 export function navFor(role: StaffRole): NavItem[] {
```

```diff
diff --git a/lib/admin/nav.test.ts b/lib/admin/nav.test.ts
index 40dc737..10283c1 100644
--- a/lib/admin/nav.test.ts
+++ b/lib/admin/nav.test.ts
@@ -3,7 +3,7 @@ import { navFor } from './nav';
 
 describe('navFor', () => {
   it('shows each role only what its permissions open', () => {
-    expect(navFor('admin').map((i) => i.label)).toEqual(['Tổng quan', 'Nhân viên']);
+    expect(navFor('admin').map((i) => i.label)).toEqual(['Tổng quan', 'Nhân viên', 'Nhật ký']);
     expect(navFor('editor').map((i) => i.label)).toEqual(['Tổng quan']);
   });
 });
```

Run: `npm run typecheck && npx vitest run lib/admin`
Expected: typecheck sạch; PASS `Tests  51 passed (51)`.

- [ ] **Bước 8: Chạy cổng kiểm tra**

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

Expected: typecheck sạch; lint 0 lỗi, 20 cảnh báo; `Test Files  40 passed (40)`, `Tests  354 passed (354)`; check-prerender in `Admin check passed: /admin, /admin/accept-invite, /admin/audit, /admin/reset-password, /admin/sign-in, /admin/users, /admin/[...missing] have no static shell.`; E2E `65 passed`; visual `8 passed`.

- [ ] **Bước 9: Commit**

```bash
git add 'app/admin/(shell)/audit' e2e/admin-audit.spec.ts lib/admin/audit-labels.ts lib/admin/audit-labels.test.ts lib/admin/nav.ts lib/admin/nav.test.ts lib/server/audit-feed.ts styles/admin.css test/integration/audit-feed.test.ts
git commit -m "$(cat <<'EOF'
feat: show the site-wide audit log on /admin/audit

The Admin-only Nhật ký page reads audit_feed, 50 rows a page (?trang=),
newest first; rows from one transaction share a time and fall back to their
id as a number. Each row shows the time on Vietnam's clock, who did it, the
action in Vietnamese, the staff member's current email when the account still
exists, and the before/after snapshot behind "Xem". An Editor gets the 403
view with no rows.

A unit test reads the staff actions the code writes and fails when one has no
Vietnamese label.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 11: Nghiệm thu §14.1 dòng 3, tài liệu, và lần kiểm cuối

**Files:**
- Create: `e2e/admin-acceptance.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: mọi thứ của Task 1–10; trong E2E: `nextLink` (Task 8), `STAFF`, `newVisitor`, `one`, `seedStaff`, `signIn`, `signInAs`, `test`, `withAdminCountLock` (Task 7, 9).
- Produces: không có gì mới cho code; README là tài liệu vận hành của đợt 3.

- [ ] **Bước 1: Viết đặc tả nghiệm thu**

Bốn tiêu chí của §14.1 dòng 3, đi qua giao diện, chạy tuần tự (test sau dùng kết quả của test trước). Các đếm `audit_log` chỉ tính hàng về người được mời hoặc do người đó làm, vì worker khác cũng đang ghi.

Create `e2e/admin-acceptance.spec.ts`:

```ts
import { randomBytes } from 'node:crypto';
import type { Page, Request } from '@playwright/test';
import { nextLink } from './email-log';
import { STAFF, expect, newVisitor, one, seedStaff, signIn, signInAs, test, withAdminCountLock } from './staff-fixtures';

/*
 * Phase 3 acceptance (spec §14.1, row 3), end to end through the UI:
 * 1. invite → accept → sign in;
 * 2. a role change writes exactly one audit row, with the right actor;
 * 3. the Editor is kept out of the Admin area: no link, no page, and a
 *    replayed Admin-only Server Action is refused with nothing written;
 * 4. a browser call to /api/auth/admin/* is rejected, even for an Admin.
 * Serial: each test builds on the one before.
 */
test.describe.configure({ mode: 'serial' });

test.beforeAll(() => seedStaff());

const invitee = {
  email: `accept-${Date.now().toString(36)}${randomBytes(2).toString('hex')}@furama.test`,
  name: 'Nhân Viên Mới',
  password: 'new staff passphrase',
};
let inviteeId: string;
let roleAction: Request;

/** Audit rows about the invitee or by them (other workers write rows of their own meanwhile). */
const auditCount = async () =>
  (await one<{ n: number }>('SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1 OR actor_id = $1', [inviteeId]))!.n;
const roleOf = async (id: string) => (await one<{ role: string }>('SELECT role FROM staff_user WHERE id = $1', [id]))?.role;

async function openUsers(page: Page) {
  await signInAs(page, STAFF.admin);
  await page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link', { name: 'Nhân viên' }).click();
  await expect(page.getByRole('heading', { name: 'Nhân viên', level: 1 })).toBeVisible();
}

test('1. invite → accept → sign in', async ({ page, browser }, testInfo) => {
  await openUsers(page);
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(invitee.email);
  await page.getByRole('combobox', { name: 'Vai trò', exact: true }).selectOption('editor');
  await page.getByRole('button', { name: 'Gửi lời mời' }).click();
  await expect(page.getByRole('main').getByRole('status')).toHaveText('Đã gửi lời mời.');

  const link = await nextLink(invitee.email, '/admin/accept-invite');
  const newcomer = await newVisitor(browser, testInfo);
  await newcomer.goto(link);
  await newcomer.getByLabel('Họ tên').fill(invitee.name);
  await newcomer.getByLabel('Mật khẩu').fill(invitee.password);
  await newcomer.getByRole('button', { name: 'Tạo tài khoản' }).click();
  await expect(newcomer).toHaveURL(/\/admin$/);
  await expect(newcomer.getByTestId('staff-name')).toHaveText(invitee.name);
  await expect(newcomer.getByText(`${invitee.email} · Editor`)).toBeVisible();

  // Signed out and back in with the password just chosen.
  await newcomer.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(newcomer).toHaveURL(/\/admin\/sign-in$/);
  await signIn(newcomer, invitee.email, invitee.password);
  await expect(newcomer).toHaveURL(/\/admin$/);

  inviteeId = (await one<{ id: string }>('SELECT id FROM staff_user WHERE email = $1', [invitee.email]))!.id;
  expect(await one('SELECT used_at IS NOT NULL AS used FROM staff_invitation WHERE email = $1', [invitee.email])).toEqual({ used: true });
});

test('2. a role change writes exactly one audit row, with the acting Admin', async ({ page }) => {
  await openUsers(page);
  const select = page.getByRole('row').filter({ hasText: invitee.email }).getByRole('combobox');
  await withAdminCountLock(async () => {
    const before = await auditCount();
    const actionRequest = page.waitForRequest((r) => r.method() === 'POST' && !!r.headers()['next-action']);
    await select.selectOption('admin');
    roleAction = await actionRequest;
    await expect.poll(() => roleOf(inviteeId)).toBe('admin');
    expect(await auditCount()).toBe(before + 1);
    const rows = await one<{ rows: unknown[] }>(
      `SELECT json_agg(json_build_object('actor_id', actor_id, 'actor_email', actor_email, 'action', action,
                                         'entity_id', entity_id, 'before', before, 'after', after)) AS rows
         FROM (SELECT * FROM audit_log WHERE entity_id = $1 ORDER BY id DESC LIMIT 1) last`,
      [inviteeId],
    );
    expect(rows!.rows).toEqual([
      {
        actor_id: STAFF.admin.id,
        actor_email: STAFF.admin.email,
        action: 'staff.role',
        entity_id: inviteeId,
        before: { role: 'editor' },
        after: { role: 'admin' },
      },
    ]);

    // Back to Editor: one more row.
    await select.selectOption('editor');
    await expect.poll(() => roleOf(inviteeId)).toBe('editor');
    expect(await auditCount()).toBe(before + 2);
  });
});

test('3. the Editor is kept out of the Admin area, including a direct POST to an Admin-only action', async ({ browser, playwright, baseURL }, testInfo) => {
  const editor = await newVisitor(browser, testInfo);
  await signInAs(editor, invitee);
  await expect(editor.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link')).toHaveText(['Tổng quan']);
  const res = await editor.goto('/admin/users');
  expect(await res?.text()).not.toContain(STAFF.admin.email);
  await expect(editor.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible();

  // The Admin's captured "change role" action, replayed with the Editor's cookie: "make me Admin".
  const before = await auditCount();
  const replay = {
    headers: {
      'next-action': roleAction.headers()['next-action'],
      'content-type': roleAction.headers()['content-type'],
      accept: 'text/x-component',
      origin: baseURL!,
    },
    data: JSON.stringify([inviteeId, 'admin']),
  };
  const path = new URL(roleAction.url()).pathname;
  const asEditor = await editor.request.post(path, replay);
  expect(asEditor.status()).toBe(200);
  expect(await asEditor.text()).toContain('"code":"forbidden"');

  const anonymous = await playwright.request.newContext({ baseURL });
  try {
    // Without a cookie the proxy turns it away before any action runs...
    expect((await anonymous.post(path, { ...replay, maxRedirects: 0 })).status()).toBe(307);
    // ...and with a forged one it reaches requirePermission, which refuses it.
    const forged = await anonymous.post(path, {
      ...replay,
      headers: { ...replay.headers, cookie: 'better-auth.session_token=forged.value' },
    });
    expect(await forged.text()).toContain('"code":"forbidden"');
  } finally {
    await anonymous.dispose();
  }

  expect(await roleOf(inviteeId)).toBe('editor');
  expect(await auditCount()).toBe(before);
});

test('4. a browser call to /api/auth/admin/* is rejected, even for an Admin', async ({ page }) => {
  await signInAs(page, STAFF.admin);
  const results = await page.evaluate(async (userId) => {
    const setRole = await fetch('/api/auth/admin/set-role', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, role: 'admin' }),
    });
    const listUsers = await fetch('/api/auth/admin/list-users');
    return { setRole: setRole.status, body: await setRole.json(), listUsers: listUsers.status };
  }, inviteeId);
  expect(results).toEqual({ setRole: 403, body: { code: 'ADMIN_ENDPOINT_BLOCKED' }, listUsers: 403 });
  expect(await roleOf(inviteeId)).toBe('editor');
});
```

- [ ] **Bước 2: Chạy đặc tả trên build của Task 10**

Đặc tả này ghim những gì Task 1–10 đã làm, nên nó xanh ngay; hai bước sau cho thấy nó đỏ được.

```bash
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson E2E_PORT=3210 npx playwright test --retries=0 e2e/admin-acceptance.spec.ts
```

Expected: PASS `4 passed`.

- [ ] **Bước 3: Đột biến 1 — action đổi vai trò không kiểm quyền: tiêu chí 3 phải đỏ**

```bash
cp 'app/admin/(shell)/users/actions.ts' "${TMPDIR:-/tmp}/users-actions.bak"
python3 - <<'PY'
p = 'app/admin/(shell)/users/actions.ts'
s = open(p).read()
old = "    const actor = await requirePermission({ user: ['set-role'] });"
assert old in s
s = s.replace(old, "    const actor = (await getStaffSession())!; // MUTANT: no permission check")
s = s.replace("import { auditActor, requirePermission } from '@/lib/server/dal/session';",
              "import { auditActor, getStaffSession, requirePermission } from '@/lib/server/dal/session';")
open(p, 'w').write(s)
PY
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson E2E_PORT=3210 npx playwright test --retries=0 e2e/admin-acceptance.spec.ts
cp "${TMPDIR:-/tmp}/users-actions.bak" 'app/admin/(shell)/users/actions.ts'
git status --short 'app/admin/(shell)/users/actions.ts'
```

Expected: FAIL `1 failed`, `2 passed` (tuần tự nên test 4 không chạy):

```
  ✓ 1. invite → accept → sign in
  ✓ 2. a role change writes exactly one audit row, with the acting Admin
  ✘ 3. the Editor is kept out of the Admin area, including a direct POST to an Admin-only action
    Error: expect(received).toContain(expected) // indexOf
    Expected substring: "\"code\":\"forbidden\""
    Received string:    "2:\"$Sreact.fragment\" …
```

`git status` cuối không in gì (file đã về như commit).

- [ ] **Bước 4: Đột biến 2 — bỏ cả hai lớp chặn `/api/auth/admin/*`: tiêu chí 4 phải đỏ**

Lần chạy trước để người được mời của nó thành Admin, nên reset DB trước.

```bash
cp 'app/api/auth/[...all]/route.ts' "${TMPDIR:-/tmp}/auth-route.bak"
cp lib/server/auth/config.ts "${TMPDIR:-/tmp}/auth-config.bak"
python3 - <<'PY'
for p, old in [
    ('app/api/auth/[...all]/route.ts', "startsWith('/api/auth/admin/')"),
    ('lib/server/auth/config.ts', "ctx.path.startsWith('/admin/')"),
]:
    s = open(p).read()
    assert old in s
    open(p, 'w').write(s.replace(old, old.replace("admin/')", "admin/MUTANT')")))
PY
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson E2E_PORT=3210 npx playwright test --retries=0 e2e/admin-acceptance.spec.ts
cp "${TMPDIR:-/tmp}/auth-route.bak" 'app/api/auth/[...all]/route.ts'
cp "${TMPDIR:-/tmp}/auth-config.bak" lib/server/auth/config.ts
git status --short app/api lib/server/auth
```

Expected: FAIL `1 failed`, `3 passed`; một Admin gọi được `set-role` từ trình duyệt:

```
  ✘ 4. a browser call to /api/auth/admin/* is rejected, even for an Admin
    - Expected  -  3
    + Received  + 15
        "body": Object {
    -     "code": "ADMIN_ENDPOINT_BLOCKED",
    +     "user": Object {
    +       "banExpires": null,
    …
```

`git status` cuối không in gì.

- [ ] **Bước 5: Viết tài liệu**

Sửa `README.md` đúng như diff (biến môi trường của admin theo từng môi trường, migration 005 trước khi deploy, quy tắc CLI, Resend, route admin và vì sao chúng trả 200, biến của E2E):

````diff
diff --git a/README.md b/README.md
index 6b1f0d5..927ab17 100644
--- a/README.md
+++ b/README.md
@@ -8,6 +8,8 @@ with reservations persisted in Neon Postgres.
 - **Next.js 16** (App Router, Turbopack) + **React 19** + TypeScript
 - **Neon Postgres** via the Vercel Marketplace, reached with `pg` (node-postgres)
   on Fluid Compute per Neon's own guidance
+- **Better Auth** for staff sign-in (invitation only, Admin and Editor roles)
+  and **Resend** with react-email for the staff emails
 - Plain CSS with design tokens — the design is built on fluid `clamp()` values
   throughout, so the tokens mirror them directly rather than round-tripping
   through a utility framework
@@ -26,19 +28,28 @@ data and would overwrite those lines.
 
 Apply migrations to the dev branch with `npm run db:migrate`.
 
+The admin (`/admin`) also needs `BETTER_AUTH_SECRET` and
+`BETTER_AUTH_URL=http://localhost:3000` in `.env.local`; leave
+`EMAIL_DELIVERY` unset there (log mode: invitation and reset links are
+printed to the terminal). Create your Admin with `scripts/create-admin.mjs`
+(see Deploying → First Admin).
+
 ## Testing
 
 | Command | What it runs |
 | --- | --- |
 | `npm test` | Unit tests (Vitest, process timezone pinned to UTC) |
 | `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test` | Unit and integration tests. The database is dropped and recreated on every run, and its name must end in `_test`. |
-| `npm run test:e2e` | Playwright against `next start` on port 3100 (or `E2E_PORT`). Set `CI` and a local `_test` `DATABASE_URL` (variables below), or `E2E_BASE_URL` for a server you started; without either it refuses to run, because `next dev` reads `.env.local`. Run `npx playwright install chromium` once first. |
+| `npm run test:e2e` | Playwright against `next start` on port 3100 (or `E2E_PORT`). Set `CI`, a local `_test` `DATABASE_URL`, `EMAIL_DELIVERY=log`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=http://localhost:<port>` and `EMAIL_LOG_FILE` (variables below), or `E2E_BASE_URL` for a server you started; otherwise it refuses to run, because `next dev` and `next start` read `.env.local`. Run `npx playwright install chromium` once first. |
 | `npm run test:visual` | Pixel-exact screenshots of the home and Tàya House pages, with and without JavaScript, against `e2e/__visual__/` (macOS baselines from before phase 2; CI skips them). Needs a running `next start`, see below. |
 | `npm run lint` | oxlint (typescript-eslint does not support TypeScript 7) |
 
 CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit, integration,
 build, the prerender and font check (`scripts/check-prerender.mjs`) and
-end-to-end tests against a Postgres 18 service container.
+end-to-end tests against a Postgres 18 service container. The build needs no
+auth or email variable; the end-to-end step gets a fresh `BETTER_AUTH_SECRET`
+per run, `EMAIL_DELIVERY=log` and an `EMAIL_LOG_FILE` the admin specs read
+invitation and reset links from.
 
 To run the production build locally against a throwaway database, keep
 `.env.local` out of it: process variables win over that file, and the blank
@@ -48,8 +59,11 @@ To run the production build locally against a throwaway database, keep
 RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
 CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
 node scripts/check-prerender.mjs
-CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run test:e2e
-PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npx next start -p 3201 &
+CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test \
+  BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3100 \
+  EMAIL_DELIVERY=log EMAIL_LOG_FILE=$TMPDIR/emails.ndjson npm run test:e2e
+PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test \
+  BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3201 EMAIL_DELIVERY=log npx next start -p 3201 &
 for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3201/ && break; sleep 1; done
 VISUAL_BASE_URL=http://localhost:3201 npm run test:visual
 kill %1   # stop the server (or: lsof -ti tcp:3201 | xargs kill)
@@ -57,7 +71,10 @@ kill %1   # stop the server (or: lsof -ti tcp:3201 | xargs kill)
 
 `E2E_BASE_URL=http://localhost:<port>` points the main Playwright suite at a
 server you started yourself (for example `next dev` with the same variables)
-instead of starting one. Never update the visual baselines to make a run
+instead of starting one. The admin specs still write their staff accounts
+(with known passwords) straight into `DATABASE_URL`, so `e2e/staff-fixtures.ts`
+refuses anything but a local database named `*_test` or `*_ci`, whichever way
+Playwright runs. Never update the visual baselines to make a run
 pass: open `test-results/**/*-diff.png` and fix the page.
 
 ## Deploying
@@ -96,6 +113,58 @@ point at dev). Run
 `DATABASE_URL_UNPOOLED=<production direct URL> node scripts/migrate.mjs`
 deliberately, after the dev branch has been migrated and verified.
 
+Migration 005 (the `staff_*` tables, `auth_rate_limit`, `staff_invitation`,
+`audit_log` and the `audit_feed` view) must be on an environment's Neon
+branch before that environment runs the phase-3 code: Better Auth checks its
+tables when it starts (`database.validateSchema`) and every admin page reads
+them. 005 only adds tables, so the guest site keeps working on a migrated
+database. Apply it with `node scripts/migrate.mjs` like the others.
+
+**Never run `npx auth migrate`** (or `generate`) without
+`--config scripts/auth-cli.config.ts`: the Better Auth CLI loads `.env` and
+`.env.local` by itself, which point at the shared database. That config reads
+`AUTH_CLI_DATABASE_URL`, refuses anything but a local database, and drops every
+`PG*` variable the CLI copied from `.env.local` before it connects (blank them
+in the shell too):
+
+```bash
+RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_cli_test node scripts/reset-db.mjs
+PGHOST= PGUSER= PGPASSWORD= PGDATABASE= AUTH_CLI_DATABASE_URL=postgres://localhost:5432/furama_cuisine_cli_test npx auth check --config scripts/auth-cli.config.ts
+```
+
+The staff tables' columns come from `lib/server/auth/config.ts`; change that
+file, regenerate with `npx auth generate --config scripts/auth-cli.config.ts`
+against an empty local database, and write the difference as a new migration.
+
+### Environment variables (admin)
+
+| Variable | Production | Preview | Local E2E / CI |
+| --- | --- | --- | --- |
+| `BETTER_AUTH_SECRET` | its own, 32+ random bytes | its own | a fresh `openssl rand -base64 32` |
+| `BETTER_AUTH_URL` | `https://<production domain>`, the origin of emailed links | the preview's own URL | `http://localhost:<port>` |
+| `EMAIL_DELIVERY` | `live` | `redirect` | `log` (also the default when unset) |
+| `EMAIL_REDIRECT_TO` | — | the team inbox that receives every preview email | — |
+| `EMAIL_FROM` | `Furama Cuisine <no-reply@mail.furamavietnam.com>` | same | — |
+| `RESEND_API_KEY` | the production key | a separate key | — |
+| `EMAIL_LOG_FILE` | never | never | a scratch file; log mode appends each email as one JSON line |
+| `BOOTSTRAP_ADMIN_EMAIL` | never (only in the shell that runs `scripts/create-admin.mjs`) | never | — |
+
+`EMAIL_DELIVERY` is read when an email is sent, never at build time; an
+unknown value throws instead of sending. On a Vercel deployment
+(`VERCEL_ENV=production` or `preview`) the log mode prints neither addresses
+nor links and writes no `EMAIL_LOG_FILE`.
+
+### Resend
+
+Invitation and reset emails go straight to Resend (spec §10.4), from a
+subdomain of furamavietnam.com verified in Resend: IT adds the MX, SPF, DKIM
+and DMARC records Resend lists for `mail.furamavietnam.com` (check first
+whether the root domain already has a DMARC record), then `EMAIL_FROM` uses
+that subdomain. Until it is verified, keep `EMAIL_DELIVERY=redirect` or `log`.
+A failed invitation email leaves the invitation in place and the staff
+screen says "Chưa gửi được email, bấm Gửi lại"; a failed reset email is only
+logged.
+
 ### First Admin
 
 Staff accounts exist only by invitation (spec §7.1); the one exception is the
@@ -123,6 +192,15 @@ is set, and writes a `staff.bootstrap` row to `audit_log`.
 | `/en/restaurants/[slug]` | Static for `taya-house`. Any other slug is a 404: the first visit is a soft 404 (status 200 with `noindex`), later visits get the cached 404, and without JavaScript the body is empty | Restaurant detail (Tàya House only until phase 6) |
 | `/taya-house` | Redirect | 308 to `/en/restaurants/taya-house` (`next.config.ts`) |
 | `/api/availability` | Dynamic | Booked covers per slot for one restaurant/day |
+| `/admin/sign-in`, `/admin/accept-invite`, `/admin/reset-password` | Request time, nonce CSP | The only admin pages open without a session cookie |
+| `/admin`, `/admin/users`, `/admin/audit` | Request time, nonce CSP | Overview; staff and invitations (Admin); audit log (Admin). Without a session cookie the proxy sends them to sign-in (307, `?next=` kept) |
+| `/api/auth/*` | Dynamic | Better Auth; `/api/auth/admin/*` is refused with 403 |
+
+Every admin page renders at request time (`app/admin/layout.tsx`: `instant =
+false` and `await connection()` before `<html>`), so each response carries the
+nonce `proxy.ts` made for it. On `next start` and Vercel an admin page answers
+200 even when it renders the sign-in redirect, the 403 view or the 404 view:
+those arrive in the page payload, not the status.
 
 The proxy skips `/api`, `/_next`, `/admin` (its own branch), any path with a dot
 (files such as `/icon.svg`) and any unprefixed top-level segment of 2–3 letters,
@@ -219,7 +297,7 @@ reference so future design revisions can be diffed against what was built.
 | -------------------- | ------------------------------ |
 | `npm run dev`        | Dev server                     |
 | `npm run build`      | Production build               |
-| `npm run typecheck`  | `tsc --noEmit`                 |
+| `npm run typecheck`  | `next typegen`, then `tsc` (no incremental cache) |
 | `npm run lint`       | oxlint                         |
 | `npm test`           | Vitest (unit, integration)     |
 | `npm run test:e2e`   | Playwright                     |
````

- [ ] **Bước 6: Chạy cổng kiểm tra, E2E ba lần liền không retry**

```bash
npm run typecheck
npm run lint
TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
node scripts/check-prerender.mjs
for i in 1 2 3; do CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson E2E_PORT=3210 npm run test:e2e -- --retries=0 2>&1 | grep -E '^\s+[0-9]+ (passed|failed|flaky)'; done
lsof -nP -iTCP:3211 -sTCP:LISTEN
PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3211 EMAIL_DELIVERY=log npx next start -p 3211 &
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3211/ && break; sleep 1; done
VISUAL_BASE_URL=http://localhost:3211 npm run test:visual
lsof -ti tcp:3211 | xargs kill
```

Expected: typecheck sạch; lint 0 lỗi, 20 cảnh báo; `Test Files  40 passed (40)`, `Tests  354 passed (354)`; check-prerender in ba dòng `… check passed`; ba dòng `69 passed` (mỗi lần bật server mới, cùng một DB, không reset giữa các lần); visual `8 passed`. Nếu một spec khách của đợt 2 đỏ một lần (Rủi ro 15), chạy riêng spec đó với `--repeat-each=5` và ghi lại kết quả; spec admin đỏ thì dừng và sửa.

- [ ] **Bước 7: Kiểm console của `next dev` trên mọi trang admin**

```bash
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_dev_test node scripts/reset-db.mjs
rm -rf .next/dev
lsof -nP -iTCP:3212 -sTCP:LISTEN
PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_dev_test BETTER_AUTH_SECRET=dev-secret-0123456789abcdef0123456789abcdef BETTER_AUTH_URL=http://localhost:3212 EMAIL_DELIVERY=log npx next dev -p 3212 > "${TMPDIR:-/tmp}/furama-dev.log" 2>&1 &
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3212/admin/sign-in && break; sleep 1; done
PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_dev_test BETTER_AUTH_SECRET=dev-secret-0123456789abcdef0123456789abcdef BETTER_AUTH_URL=http://localhost:3212 BOOTSTRAP_ADMIN_EMAIL=owner@furama.test BOOTSTRAP_ADMIN_PASSWORD='correct horse battery' node scripts/create-admin.mjs
cat > devcheck.tmp.mjs <<'EOF'
// Opens admin pages on `next dev` and prints console errors and warnings. Not committed.
import { chromium } from '@playwright/test';
const base = process.env.BASE;
const pages = (process.env.PAGES ?? '/admin').split(',');
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text().slice(0, 300)}`);
});
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 300)}`));
await page.goto(`${base}/admin/sign-in`);
await page.waitForTimeout(1500);
await page.getByRole('textbox', { name: 'Email' }).fill(process.env.EMAIL);
await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.PASSWORD);
await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
await page.waitForURL(/\/admin(\?|$)/, { timeout: 30000 });
for (const p of pages) {
  logs.push(`--- ${p}`);
  await page.goto(`${base}${p}`);
  await page.waitForTimeout(2500);
}
for (const link of await page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link').all()) {
  logs.push(`--- click ${await link.textContent()}`);
  await link.click();
  await page.waitForTimeout(2000);
}
console.log(logs.join('\n'));
await browser.close();
EOF
BASE=http://localhost:3212 EMAIL=owner@furama.test PASSWORD='correct horse battery' PAGES='/admin/users,/admin/audit,/admin/audit?trang=2,/admin/reset-password,/admin/reset-password?token=x,/admin/accept-invite?token=x,/admin/khong-co,/admin' node devcheck.tmp.mjs
rm devcheck.tmp.mjs
grep -iE 'blocking|uncached|error' "${TMPDIR:-/tmp}/furama-dev.log"
lsof -ti tcp:3212 | xargs kill
psql -h localhost -d postgres -c 'DROP DATABASE furama_cuisine_dev_test'
```

Expected: `Admin created: owner@furama.test (…)`; script in

```
--- /admin/users
--- /admin/audit
--- /admin/audit?trang=2
--- /admin/reset-password
--- /admin/reset-password?token=x
--- /admin/accept-invite?token=x
--- /admin/khong-co
error: Failed to load resource: the server responded with a status of 404 (Not Found)
--- /admin
--- click Tổng quan
--- click Nhân viên
--- click Nhật ký
```

(dòng 404 là đúng, R5); không có dòng nào khác. `grep` trên log dev không in gì. `DROP DATABASE`. Cuối cùng `lsof -nP -iTCP:3210-3212 -sTCP:LISTEN` không in gì.

- [ ] **Bước 8: Commit**

```bash
git add e2e/admin-acceptance.spec.ts README.md
git commit -m "$(cat <<'EOF'
test: pin the phase 3 acceptance criteria end to end; document the admin

e2e/admin-acceptance.spec.ts walks spec §14.1 row 3 through the UI: an Admin
invites, the invitee accepts from the emailed link and signs in; a role change
writes exactly one audit row with the acting Admin; the Editor has no link to
the Admin area, gets the 403 view, and a replay of the Admin's role action
with the Editor's cookie comes back forbidden with nothing written (no cookie:
307; a forged one: forbidden); and a browser call to /api/auth/admin/* is
refused even for an Admin. Removing requirePermission from the role action,
or both admin-endpoint blocks, makes it fail.

README: the admin's environment variables per environment, migration 005
before deploying, the rule never to run the Better Auth CLI without
scripts/auth-cli.config.ts, the Resend domain setup, the admin routes and why
they answer 200, and the E2E variables.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Bước 9: Báo lại cho người dùng**

Báo: kết quả ba lần E2E và visual; mục "Rủi ro đã biết" có nhãn **Cần quyết định** (1, 3, 6, 8, 9, 11, 13, 15); và các việc ngoài repo còn chờ (spec §15 mục 3–5: domain production, email Admin đầu tiên, DNS gửi mail cho Resend). Không chạy migration 005 hay `scripts/create-admin.mjs` lên Neon trong kế hoạch này.

---

## Bản kiểm chứng

Kế hoạch đã được chạy đúng thứ tự trong `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p3-verify` (gốc `6a93d7b`), mỗi task một commit và cổng kiểm tra của nó xanh. Sau review, các sửa đổi được làm thành một commit trên cùng của `main` trong bản sao (`b47a129`), rồi gộp vào task sở hữu từng file trên nhánh `p3-folded`. Mọi khối code, diff và commit message trong kế hoạch lấy từ nhánh đó.

| Task | SHA (`p3-folded`) | Unit + tích hợp | E2E | Visual | Chạy lại sau review |
|---|---|---|---|---|---|
| 1 | `c62f3ef` | 22 file, 201 test | 33 | 8/8 | không đổi |
| 2 | `9d30ec4` | 23 file, 217 test | 33 | 8/8 | typecheck, lint (18), unit + tích hợp |
| 3 | `1c65614` | 25 file, 235 test | 33 | 8/8 | typecheck, lint (18), unit + tích hợp |
| 4 | `a52944b` | 26 file, 252 test | 33 | 8/8 | typecheck, lint (18), unit + tích hợp |
| 5 | `b49de50` | 27 file, 257 test | 33 | 8/8 | typecheck, lint (19), unit + tích hợp |
| 6 | `99265fd` | 31 file, 307 test | 42 | 8/8 | typecheck, lint (19), unit + tích hợp |
| 7 | `9555ebb` | 37 file, 344 test | 51 | 8/8 | đủ cổng |
| 8 | `ce6db1f` | 37 file, 345 test | 57 | 8/8 | đủ cổng |
| 9 | `0cddb44` | 38 file, 349 test | 63 | 8/8 | đủ cổng |
| 10 | `4867dc2` | 40 file, 354 test | 65 | 8/8 | đủ cổng |
| 11 | `6933a36` | 40 file, 354 test | 69 (ba lần liền) | 8/8 | cây giống hệt `b47a129` (tree `88cd6a2`), chạy đủ cổng trên `b47a129` |

- Task 2–6: phần gộp vào chỉ chạm module mà app Next chưa import trước Task 7 (`config.ts`, `send.ts`, `staff.ts`, test, script CLI), nên build, E2E và visual của các commit gốc (`b717ce4`, `8d55c57`, `f202943`, `dfb386c`, `9ca7a6f`) vẫn đúng cho chúng; typecheck (cũng là phần typecheck của `next build`), lint và unit + tích hợp đã chạy lại trên từng commit gộp.
- Task 7–10: build, check-prerender, E2E (`--retries=0`) và visual chạy lại trên từng commit gộp, mỗi lần trên DB vừa reset.
- `b47a129`: typecheck, lint (20 cảnh báo), 40 file / 354 test, build, check-prerender, E2E `69 passed` ba lần liền, visual `8 passed`. Kiểm thêm: `npx auth check` với một `.env.local` giả chứa `PG*` (đỏ trước, xanh sau sửa), `db()` của E2E từ chối `postgres://db.example.invalid/x` và URL có `?host=`, `admin-invite-reset.spec.ts` trên một server tự bật mà log server không có dòng lỗi nào (`after()` chạy trong Server Action), và các số đếm trung gian của Task 7 Bước 10/12/13, Task 8 Bước 1/2/6, Task 9 Bước 5/12 trên commit gộp tương ứng. Bước 16 của Task 7 và Bước 7 của Task 11 (console của `next dev`) không chạy lại: các sửa đổi chỉ chạm mã server, test, script và README.
- Lịch sử của chuỗi gốc: Task 9 được sửa sau lần chạy đầu (nhãn vai trò định dạng ở server, để ma trận quyền không vào bundle của trình duyệt), rồi Task 10–11 được dựng lại trên nó và chạy lại cổng. Ở lần chạy lại của Task 10 gốc, spec khách `page-scope.spec.ts` đỏ một lần (Rủi ro 15; 64 xanh, spec đó xanh 105/105 khi chạy riêng). Bản build của Task 11 gốc cho 69/69 bốn lần liền.

Khi thực thi, có thể cherry-pick từng commit của `p3-folded` rồi đối chiếu với văn bản của task (như đợt 2), hoặc gõ lại từ kế hoạch; hai cách cho cùng một cây.
