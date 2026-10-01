# Đợt 0–1: Môi trường an toàn và sửa lỗi đặt bàn — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng nền kiểm thử và CI (đợt 0), rồi sửa tận gốc các lỗi đặt bàn (đợt 1): ngày giờ tính theo giờ Đà Nẵng ở cả client và server, số điện thoại chuẩn E.164, mã tham chiếu không trùng, server trả mã lỗi, hết lỗi hydration, và hero hiện lại sau khi chuyển trang.

**Architecture:**
- Module `lib/venue-time.ts` chạy được ở cả client và server; mọi phép tính ngày giờ đặt bàn đều đi qua `Intl` với `Asia/Ho_Chi_Minh`.
- Client và server trao đổi ngày dạng ISO (`YYYY-MM-DD`). Server là bên quyết định "hôm nay" và giờ hiện tại: `/api/availability` trả kèm `today` và `now`.
- Server Action kiểm tra lại toàn bộ đầu vào bằng một hàm thuần `checkReservation` và trả về **mã lỗi**, không trả câu tiếng Anh.
- Đồng thời bổ sung bộ kiểm thử 3 lớp: Vitest cho unit, Vitest + Postgres cục bộ cho tích hợp, Playwright cho E2E. CI chạy trên GitHub Actions.

**Tech Stack:** Next.js 16.3.7, React 19.3, TypeScript 7.0.2, `pg`, Postgres 18, Vitest 5, Playwright 1.63, oxlint 1.86, libphonenumber-js 1.13.

**Spec:** `docs/superpowers/specs/2026-10-01-admin-cms-design.md` — mục 3, 5.1 (ý 7–8), 10.2, 13 và 14.1 (đợt 0, đợt 1). Tài liệu nghiên cứu: `docs/superpowers/research/2026-10-01-admin-cms/reservations-domain.md`.

## Global Constraints

- Next.js 16 có thay đổi phá vỡ. Trước khi dùng bất kỳ API Next nào, đọc tài liệu trong `node_modules/next/dist/docs/` (theo `AGENTS.md`).
- TypeScript 7.0.2 **không có JS compiler API**. Không dùng công cụ cần `typescript` dạng thư viện JS (typescript-eslint, ts-jest, ts-node).
- Lint dùng **oxlint**, không dùng ESLint. Đây là điểm **lệch so với spec mục 13**: `typescript-eslint@8.71` yêu cầu peer `typescript >=4.8.4 <6.1.0`.
- Múi giờ nhà hàng: `Asia/Ho_Chi_Minh`. Logic đặt bàn không bao giờ dùng `getHours()`, `getDate()` hay `setHours()` của `Date` theo giờ máy.
- Cửa sổ đặt bàn gồm **14 ngày tính cả hôm nay** (hôm nay đến hôm nay + 13, giờ VN). Một suất ăn đóng khi còn **≤ 30 phút** là bắt đầu. Số khách từ 1 đến 12.
- Mã tham chiếu có dạng `FC-` + 8 ký tự Crockford base32 (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`), sinh bằng `node:crypto`.
- Server Action không bao giờ trả câu tiếng Anh. Chỉ trả `{ ok: true, data }` hoặc `{ ok: false, code, params? }`.
- **Không chạy migration vào DB production.** Kế hoạch này chỉ đụng tới DB test cục bộ (tên kết thúc bằng `_test`) và branch Neon `dev` (Task 11, sau khi người dùng xác nhận).
- Repo GitHub đang **public**: không commit `.env*`, khóa hay chuỗi kết nối.
- Mọi commit nằm trên branch `feat/phase-0-1`. **Không push.**
- Mọi seed trong migration dùng `ON CONFLICT DO NOTHING`.
- Comment trong code viết bằng tiếng Anh, giọng giống code hiện có (giải thích "vì sao", ngắn gọn).

## Review Focus

1. **Khách để điện thoại ở múi giờ khác** (Seoul, Paris, Honolulu) mở form đặt bàn quanh nửa đêm giờ VN. Họ phải thấy "Today" là ngày ở Đà Nẵng, và giờ đóng suất ăn cũng theo Đà Nẵng. Test nằm ở Task 9 (E2E `timezoneId: 'Pacific/Honolulu'`).
2. **Cùng một số điện thoại viết nhiều kiểu** (`0905 000 000`, `+84 905 000 000`, `84905000000`) và số nước ngoài (`+33 …`, `+82 …`). Các kiểu viết của cùng một số phải bị coi là trùng; số nước ngoài phải được nhận. Test ở Task 6 (unit) và Task 7 (tích hợp).
3. **Request bị sửa tay** (ngày không phải ISO, ngoài cửa sổ, giờ nhà hàng không phục vụ, số khách 0, 13 hoặc 2.5, thiếu trường). Server phải trả mã lỗi chứ không crash. Test ở Task 8 (unit) và Task 9 (API trả 400).
4. **Hai khách cùng đặt mấy chỗ cuối cùng.** Chỉ một người thành công. Người kia nhận `full`, bảng slot được làm mới, và giờ đang chọn tự chuyển sang slot gần nhất còn trống (bấm lần nữa không bị "im lặng"). Test ở Task 7 (tích hợp đồng thời) và Task 9 (unit `reconcile`).
5. **Dữ liệu cũ khi chạy migration**: mã `FC-12345` và số điện thoại thô phải còn nguyên. Nếu chuẩn hóa xong mà ra hai đặt bàn trùng, migration phải dừng với thông báo rõ ràng, không áp dụng dở dang. Test ở Task 7.

---

## Sơ đồ file

| File | Trách nhiệm | Task |
|---|---|---|
| `.oxlintrc.json` | Cấu hình lint | 2 |
| `vitest.config.ts`, `test/stubs/server-only.ts`, `test/setup-env.ts` | Khung chạy unit test | 2 |
| `test/global-setup.ts`, `test/helpers/db.ts` | Tạo lại DB test trước khi chạy test tích hợp | 3 |
| `scripts/reset-db.mjs` | Xóa và tạo lại DB `_test`/`_ci`, rồi chạy migration | 3 |
| `scripts/migrate.mjs` | Thêm `--until`; bỏ TLS khi kết nối DB cục bộ | 3 |
| `db/client.ts` | Bỏ TLS khi kết nối DB cục bộ | 3 |
| `playwright.config.ts`, `e2e/*.spec.ts` | Kiểm thử E2E | 4, 9, 10 |
| `.github/workflows/ci.yml` | CI | 4 |
| `lib/venue-time.ts` | Ngày giờ theo Đà Nẵng, dùng được ở client lẫn server | 5 |
| `lib/phone.ts` | Chuẩn hóa số điện thoại sang E.164 | 6 |
| `lib/booking-errors.ts` | Mã lỗi đặt bàn và câu EN tương ứng (tạm thời, đợt 2 chuyển vào registry) | 6 |
| `db/migrations/003_reservations_phone_e164.sql` | Thêm cột `phone_e164` và index chặn trùng mới | 7 |
| `lib/server/reference.ts` | Sinh mã tham chiếu | 7 |
| `db/queries.ts` | `createReservation`: ghi `phone_e164`, sinh lại mã khi trùng | 7 |
| `lib/booking.ts` | Quy tắc đặt bàn theo ngày ISO | 8, 9 |
| `lib/server/check-reservation.ts` | Kiểm tra lại đầu vào đặt bàn phía server (hàm thuần) | 8 |
| `app/actions.ts` | `submitReservation` trả mã lỗi | 7, 9 |
| `app/api/availability/route.ts` | Nhận `date` ISO, trả `today` và `now` | 9 |
| `components/site/SiteProvider.tsx`, `components/booking/BookingBar.tsx`, `components/overlays/ReserveDrawer.tsx` | Client chuyển sang ngày ISO và đồng hồ của server | 9 |
| `components/site/IntroTrigger.tsx`, `app/page.tsx`, `app/taya-house/page.tsx`, `components/site/Chrome.tsx` | Chạy lại animation intro sau mỗi lần chuyển trang | 10 |
| `README.md`, `.gitignore`, `package.json` | Tài liệu, scripts | 2, 4 |

---

# ĐỢT 0 — Môi trường an toàn

### Task 1: Tách môi trường Neon (người dùng tự làm)

Task này cần quyền vào Vercel và Neon Console, nên **người dùng tự làm**. Executor không làm được. Các task code từ 2 đến 10 không cần chờ Task 1. Riêng Task 11 (chạy migration lên Neon `dev`) phải chờ Task 1 xong.

**Files:** chỉ sửa `.env.local` trên máy người dùng (file này không được commit).

- [ ] **Bước 1: Tạo branch Neon `dev`.** Vào Vercel Dashboard → project `furama-cuisine` → Storage → `neon-violet-yacht` → "Open in Neon Console" → Branches → **New branch**. Đặt tên `dev`, parent là branch production (mặc định), giữ nguyên dữ liệu.
- [ ] **Bước 2: Trỏ `.env.local` sang `dev`.** Trong Neon Console, bấm Connect và chọn branch `dev`. Copy chuỗi **pooled** dán vào `DATABASE_URL`, chuỗi **direct** dán vào `DATABASE_URL_UNPOOLED`. Xóa các biến DB khác trong `.env.local` (`PG*`, `POSTGRES_*`) vì code không đọc chúng, để khỏi nhầm.
- [ ] **Bước 3: Kiểm tra `.env.local` không còn trỏ vào production.** Chạy lệnh sau (chỉ in hostname, không in mật khẩu):

```bash
node -e "const s=require('fs').readFileSync('.env.local','utf8');for(const k of ['DATABASE_URL','DATABASE_URL_UNPOOLED']){const v=s.match(new RegExp('^'+k+'=(.*)$','m'))[1].replace(/^\"|\"$/g,'');console.log(k, new URL(v).hostname)}"
```

Kết quả mong đợi: hai hostname có endpoint `ep-…` **giống** endpoint của branch `dev` và **khác** branch production (so trong Neon Console → Branches).

- [ ] **Bước 4: Bật branch riêng cho mỗi bản preview.** Vercel → Integrations → Neon → Manage → bật "Create a database branch for each Preview deployment".
- [ ] **Bước 5: Tắt đăng ký Neon Auth.** Neon Console → branch production → Auth → tắt cho phép đăng ký, hoặc tắt hẳn Neon Auth vì app chưa dùng.
- [ ] **Bước 6: Báo executor "Task 1 xong".** Từ giờ **không chạy `vercel env pull .env.local`** nữa: lệnh đó ghi đè `.env.local` bằng biến dùng chung, vốn đang trỏ vào dữ liệu production.

---

### Task 2: Lint (oxlint) và khung unit test (Vitest)

**Files:**
- Create: `.oxlintrc.json`, `vitest.config.ts`, `test/stubs/server-only.ts`, `test/setup-env.ts`, `lib/booking.test.ts`
- Modify: `package.json` (scripts, devDependencies), `.gitignore`

**Interfaces:**
- Consumes: không có.
- Produces:
  - `npm run lint` chạy oxlint, thoát 0 khi không có lỗi.
  - `npm test` = `TZ=UTC vitest run`. Mọi file `**/*.test.ts` (trừ `e2e/`) đều được chạy.
  - Alias `@/…` trỏ về gốc repo. `server-only` được thay bằng stub rỗng trong test.
  - `test/setup-env.ts` xóa `DATABASE_URL` khi không có `TEST_DATABASE_URL`, để test không bao giờ chạm tới Neon.

- [ ] **Bước 1: Tạo branch làm việc**

```bash
git switch -c feat/phase-0-1
```

- [ ] **Bước 2: Viết test đầu tiên (chưa chạy được vì chưa có Vitest)**

Create `lib/booking.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fold } from './booking';

describe('fold', () => {
  it('ignores accents and đ so guests can search without Vietnamese input', () => {
    expect(fold('Phố Cuốn')).toBe('pho cuon');
    expect(fold('Đà Nẵng')).toBe('da nang');
  });
});
```

- [ ] **Bước 3: Chạy để thấy lỗi**

Run: `npx --no-install vitest run`
Expected: FAIL. npx báo không tìm thấy `vitest`.

- [ ] **Bước 4: Cài công cụ và thêm scripts**

```bash
npm i -D vitest@^5.0.3 oxlint@^1.86.0
```

Trong `package.json`, thay khối `"scripts"` bằng:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "oxlint",
    "typecheck": "tsc --noEmit",
    "test": "TZ=UTC vitest run",
    "test:watch": "TZ=UTC vitest",
    "test:e2e": "playwright test",
    "db:migrate": "dotenv -e .env.local -- node scripts/migrate.mjs",
    "db:psql": "dotenv -e .env.local -- sh -c 'psql $DATABASE_URL_UNPOOLED'"
  },
```

- [ ] **Bước 5: Tạo cấu hình Vitest và các stub**

Create `vitest.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${root}/` },
      // `server-only` throws outside a React Server Components build; tests run plain Node.
      { find: /^server-only$/, replacement: `${root}/test/stubs/server-only.ts` },
    ],
  },
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**', 'e2e/**'],
    environment: 'node',
    setupFiles: ['./test/setup-env.ts'],
  },
});
```

Create `test/stubs/server-only.ts`:

```ts
// Stand-in for the `server-only` package under Vitest. See vitest.config.ts.
export {};
```

Create `test/setup-env.ts`:

```ts
/*
 * Tests must never reach a real database. Integration tests opt in with
 * TEST_DATABASE_URL (a local throwaway database, see scripts/reset-db.mjs);
 * without it, DATABASE_URL is cleared so nothing can fall back to Neon.
 */
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else {
  delete process.env.DATABASE_URL;
}
```

- [ ] **Bước 6: Chạy test để thấy pass**

Run: `npm test`
Expected: PASS, `1 passed` (fold).

- [ ] **Bước 7: Tạo cấu hình oxlint**

Create `.oxlintrc.json`. Cấu hình này đã chạy thử trên code hiện tại: **0 lỗi**, chỉ còn cảnh báo. Các rule đang để `warn` hoặc `off` là những rule mà các đợt sau sẽ xử lý (ảnh dùng `<img>` ở đợt 7; link nội bộ ở đợt 2; dialog tự viết ở đợt rà soát a11y).

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["typescript", "react", "nextjs", "jsx-a11y", "import"],
  "categories": { "correctness": "error", "suspicious": "warn" },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/exhaustive-deps": "warn",
    "react/react-in-jsx-scope": "off",
    "react/refs": "warn",
    "react/set-state-in-effect": "warn",
    "jsx-a11y/prefer-tag-over-role": "off",
    "nextjs/no-img-element": "warn",
    "nextjs/no-html-link-for-pages": "warn",
    "import/no-unassigned-import": "off"
  },
  "ignorePatterns": [
    ".next/**",
    "node_modules/**",
    "design-src/**",
    "docs/**",
    "next-env.d.ts",
    ".playwright-mcp/**",
    "playwright-report/**",
    "test-results/**"
  ]
}
```

- [ ] **Bước 8: Chạy lint và typecheck**

Run: `npm run lint && npm run typecheck`
Expected: oxlint in ra các cảnh báo, dòng tổng kết có `0 errors`, exit 0. `tsc` không in gì.

- [ ] **Bước 9: Bỏ qua thư mục kết quả test trong `.gitignore`**

Thêm vào cuối `.gitignore`:

```
playwright-report
test-results
```

- [ ] **Bước 10: Commit**

```bash
git add package.json package-lock.json .oxlintrc.json vitest.config.ts test/stubs/server-only.ts test/setup-env.ts lib/booking.test.ts .gitignore
git commit -m "chore: add oxlint and Vitest

next lint was removed in Next 16, and typescript-eslint does not support
TypeScript 7, so linting uses oxlint."
```

---

### Task 3: Hạ tầng test tích hợp với Postgres cục bộ

**Files:**
- Create: `scripts/reset-db.mjs`, `test/global-setup.ts`, `test/helpers/db.ts`, `test/integration/catalogue.test.ts`
- Modify: `scripts/migrate.mjs`, `db/client.ts:4-22`, `vitest.config.ts`

**Interfaces:**
- Consumes: Task 2 (`vitest.config.ts`, `test/setup-env.ts`).
- Produces:
  - `RESET_DATABASE_URL=<url> node scripts/reset-db.mjs [--until <file.sql>]` xóa và tạo lại DB, rồi chạy migration. Chỉ chấp nhận host cục bộ và tên DB kết thúc bằng `_test` hoặc `_ci`.
  - `node scripts/migrate.mjs --until <file.sql>` dừng sau file chỉ định (tính cả file đó).
  - `test/helpers/db.ts` xuất: `TEST_DATABASE_URL: string | undefined`, `databaseUrl(name: string): string`, `resetDatabase(url: string, until?: string): void`, `migrate(url: string): void`, `withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T>`.
  - Khi có `TEST_DATABASE_URL`, global setup tạo lại DB đó trước mỗi lần chạy test.

- [ ] **Bước 1: Viết test tích hợp đầu tiên**

Create `test/integration/catalogue.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import { listRestaurants } from '@/db/queries';

describe.skipIf(!process.env.TEST_DATABASE_URL)('restaurant catalogue (database)', () => {
  afterAll(() => getPool().end());

  it('serves the 12 seeded restaurants in design order', async () => {
    const restaurants = await listRestaurants();
    expect(restaurants).toHaveLength(12);
    expect(restaurants[0].id).toBe('cafe-indochine');
    expect(restaurants.find((r) => r.id === 'taya-house')?.slotCapacity).toBe(16);
  });
});
```

- [ ] **Bước 2: Chạy để thấy lỗi**

Máy dev đã có Postgres 18 (Homebrew) ở `localhost:5432`.

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test`
Expected: FAIL. Lỗi có thể là `database "furama_cuisine_test" does not exist`, hoặc lỗi SSL do `db/client.ts` ép `sslmode=verify-full`.

- [ ] **Bước 3: Bỏ TLS khi kết nối DB cục bộ trong `db/client.ts`**

Thay đoạn từ dòng 4 đến 22 của `db/client.ts` bằng:

```ts
/*
 * One pool per warm Fluid Compute instance. `attachDatabasePool` lets Vercel
 * drain it on shutdown so Neon does not accumulate idle connections. The pool
 * is created lazily, on the first query.
 */
let pool: Pool | null = null;

/** Throwaway databases for tests and CI run on this machine without TLS. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Neon hands out `sslmode=require`, which node-postgres currently treats as
 * `verify-full` but will downgrade in pg v9. Pinning it keeps full certificate
 * verification across that change (and silences the deprecation warning).
 */
function withVerifyFull(url: string): string {
  const parsed = new URL(url);
  if (LOCAL_HOSTS.has(parsed.hostname)) return url;
  if (parsed.searchParams.get('sslmode') !== 'verify-full') {
    parsed.searchParams.set('sslmode', 'verify-full');
  }
  return parsed.toString();
}
```

- [ ] **Bước 4: Thêm `--until` và bỏ TLS cho DB cục bộ trong `scripts/migrate.mjs`**

Thay đoạn từ dòng 15 đến 25 (từ `const connectionString` tới `url.searchParams.set(...)`) bằng:

```js
const connectionString =
  process.env.DATABASE_URL_UNPOOLED ?? process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL is not set. Run: vercel env pull .env.local --yes');
  process.exit(1);
}

// `--until 002_seed_restaurants.sql` stops after that file; tests use it to
// build a database as it was before a later migration.
const untilAt = process.argv.indexOf('--until');
const until = untilAt === -1 ? null : process.argv[untilAt + 1];
if (untilAt !== -1 && !until) {
  console.error('--until needs a migration file name.');
  process.exit(1);
}

// Pin full TLS verification for Neon (see db/client.ts); local throwaway
// databases have no TLS.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const url = new URL(connectionString);
if (!LOCAL_HOSTS.has(url.hostname)) url.searchParams.set('sslmode', 'verify-full');
```

Trong vòng lặp `for (const file of files) {`, thêm vào **ngay đầu** thân vòng lặp:

```js
    if (until && file > until) break;
```

- [ ] **Bước 5: Tạo `scripts/reset-db.mjs`**

```js
#!/usr/bin/env node
/**
 * Recreates a throwaway database and applies the migrations to it. Extra
 * arguments (e.g. `--until 002_seed_restaurants.sql`) go to migrate.mjs.
 *
 * Refuses anything but a local database whose name ends in _test or _ci, so it
 * can never be pointed at Neon by mistake.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const target = process.env.RESET_DATABASE_URL;
if (!target) {
  console.error('RESET_DATABASE_URL is not set.');
  process.exit(1);
}

const url = new URL(target);
const name = url.pathname.slice(1);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
  console.error(`Refusing to reset a database on ${url.hostname}: only local databases.`);
  process.exit(1);
}
if (!/^[a-z0-9_]+_(test|ci)$/.test(name)) {
  console.error(`Refusing to reset "${name}": the name must end in _test or _ci.`);
  process.exit(1);
}

const admin = new URL(url);
admin.pathname = '/postgres';
const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
try {
  await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${name}"`);
} finally {
  await client.end();
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, [join(root, 'scripts', 'migrate.mjs'), ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL_UNPOOLED: target },
});
```

- [ ] **Bước 6: Tạo global setup và helper**

Create `test/global-setup.ts`:

```ts
import { execFileSync } from 'node:child_process';

/** Rebuilds the integration database once per run. Without TEST_DATABASE_URL the integration tests skip. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  execFileSync(process.execPath, ['scripts/reset-db.mjs'], {
    stdio: 'inherit',
    env: { ...process.env, RESET_DATABASE_URL: url },
  });
}
```

Create `test/helpers/db.ts`:

```ts
import { execFileSync } from 'node:child_process';
import pg from 'pg';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** The integration server's URL, pointed at another database name. */
export function databaseUrl(name: string): string {
  const url = new URL(TEST_DATABASE_URL ?? 'postgres://localhost:5432/postgres');
  url.pathname = `/${name}`;
  return url.toString();
}

/** Recreates the database and applies migrations, optionally stopping after `until`. */
export function resetDatabase(url: string, until?: string): void {
  execFileSync(process.execPath, ['scripts/reset-db.mjs', ...(until ? ['--until', until] : [])], {
    stdio: 'inherit',
    env: { ...process.env, RESET_DATABASE_URL: url },
  });
}

/** Applies every pending migration. Throws when one fails. */
export function migrate(url: string): void {
  execFileSync(process.execPath, ['scripts/migrate.mjs'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL_UNPOOLED: url },
  });
}

export async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
```

Trong `vitest.config.ts`, thêm vào khối `test`. Hai dòng sau đặt ngay dưới `setupFiles`:

```ts
    globalSetup: ['./test/global-setup.ts'],
    // Integration tests share one database, so files run one at a time.
    fileParallelism: false,
```

- [ ] **Bước 7: Chạy để thấy pass**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test`
Expected: log in `✓ 001_init.sql`, `✓ 002_seed_restaurants.sql`, sau đó PASS 2 test (fold và catalogue).

Run: `npm test`
Expected: PASS 1 test; test catalogue bị skip.

- [ ] **Bước 8: Kiểm tra rào chắn an toàn của `reset-db.mjs`**

Run: `RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine node scripts/reset-db.mjs; echo "exit=$?"`
Expected: `Refusing to reset "furama_cuisine": the name must end in _test or _ci.` và `exit=1`.

Run: `RESET_DATABASE_URL=postgres://example.neon.tech/neondb_test node scripts/reset-db.mjs; echo "exit=$?"`
Expected: `Refusing to reset a database on example.neon.tech: only local databases.` và `exit=1`.

- [ ] **Bước 9: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck
git add scripts/reset-db.mjs scripts/migrate.mjs db/client.ts test/global-setup.ts test/helpers/db.ts test/integration/catalogue.test.ts vitest.config.ts
git commit -m "test: run integration tests against a throwaway local Postgres"
```

---

### Task 4: E2E (Playwright), CI và README

**Files:**
- Create: `playwright.config.ts`, `e2e/smoke.spec.ts`, `.github/workflows/ci.yml`
- Modify: `package.json` (devDependencies), `README.md` (Getting started, Scripts, thêm mục Testing)

**Interfaces:**
- Consumes: Task 2 (scripts), Task 3 (`scripts/reset-db.mjs`).
- Produces:
  - `npm run test:e2e`: trên máy dev chạy `next dev -p 3100` (đọc `.env.local`); trên CI chạy `next start -p 3100`.
  - Mọi E2E spec bỏ qua màn intro bằng `page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'))`.
  - Workflow `CI` chạy khi push lên `main` và khi có pull request.

- [ ] **Bước 1: Viết smoke test**

Create `e2e/smoke.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

test('home page lists the restaurant catalogue', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.rcard')).toHaveCount(12);
});
```

- [ ] **Bước 2: Chạy để thấy lỗi**

Run: `npx --no-install playwright test`
Expected: FAIL, npx không tìm thấy `playwright`.

- [ ] **Bước 3: Cài Playwright và tạo cấu hình**

```bash
npm i -D @playwright/test@^1.63.0
npx playwright install chromium
```

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } },
  ],
  webServer: {
    // CI tests the production build; locally `next dev` reads .env.local (the Neon dev branch).
    command: process.env.CI ? `npm run start -- -p ${PORT}` : `npm run dev -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Bước 4: Chạy để thấy pass**

Run: `npm run test:e2e`
Expected: PASS 1 test. Lệnh này cần `.env.local` có `DATABASE_URL` hợp lệ. Nếu Task 1 chưa xong thì `.env.local` vẫn trỏ production; test chỉ đọc dữ liệu nên vẫn an toàn.

- [ ] **Bước 5: Tạo workflow CI**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    services:
      postgres:
        image: postgres:18
        env:
          POSTGRES_PASSWORD: postgres
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      TEST_DATABASE_URL: postgres://postgres:postgres@localhost:5432/furama_cuisine_test
      APP_DATABASE_URL: postgres://postgres:postgres@localhost:5432/furama_cuisine_ci
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - name: Prepare the app database
        run: node scripts/reset-db.mjs
        env:
          RESET_DATABASE_URL: ${{ env.APP_DATABASE_URL }}
      - name: Build
        run: npm run build
        env:
          DATABASE_URL: ${{ env.APP_DATABASE_URL }}
      - run: npx playwright install --with-deps chromium
      - name: End-to-end
        run: npm run test:e2e
        env:
          DATABASE_URL: ${{ env.APP_DATABASE_URL }}
      - uses: actions/upload-artifact@v7
        if: failure()
        with:
          name: playwright-report
          path: playwright-report
          retention-days: 7
```

- [ ] **Bước 6: Cập nhật README**

Trong `README.md`, thay toàn bộ mục `## Getting started` bằng:

````md
## Getting started

```bash
npm install
npm run dev
```

`.env.local` must point at the Neon **`dev`** branch: `DATABASE_URL` holds the
pooled string and `DATABASE_URL_UNPOOLED` the direct one. Do not run
`vercel env pull .env.local`. The shared Vercel variables point at production
data and would overwrite those lines.

Apply migrations to the dev branch with `npm run db:migrate`.

## Testing

| Command | What it runs |
| --- | --- |
| `npm test` | Unit tests (Vitest, server clock pinned to UTC) |
| `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test` | Unit and integration tests. The database is dropped and recreated on every run, and its name must end in `_test`. |
| `npm run test:e2e` | Playwright against `next dev` on port 3100 |
| `npm run lint` | oxlint (typescript-eslint does not support TypeScript 7) |

CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit, integration,
build and end-to-end tests against a Postgres 18 service container.
````

Trong bảng `## Scripts`, thêm 3 dòng sau dòng `npm run typecheck`:

```md
| `npm run lint`       | oxlint                         |
| `npm test`           | Vitest (unit, integration)     |
| `npm run test:e2e`   | Playwright                     |
```

- [ ] **Bước 7: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck
git add playwright.config.ts e2e/smoke.spec.ts .github/workflows/ci.yml README.md package.json package-lock.json
git commit -m "test: add Playwright smoke test and CI workflow"
```

---

# ĐỢT 1 — Sửa lỗi đặt bàn và giao diện

### Task 5: `lib/venue-time.ts` — ngày giờ theo Đà Nẵng

**Files:**
- Create: `lib/venue-time.ts`, `lib/venue-time.test.ts`

**Interfaces:**
- Consumes: không có.
- Produces (mọi hàm đều thuần và chạy được ở cả client lẫn server):
  - `VENUE_TZ = 'Asia/Ho_Chi_Minh'`
  - `type IsoDate = string` (dạng `YYYY-MM-DD`)
  - `venueNow(now?: Date): { date: IsoDate; minutes: number }`
  - `addDays(d: IsoDate, n: number): IsoDate`
  - `daysBetween(from: IsoDate, to: IsoDate): number`
  - `isValidIsoDate(s: unknown): s is IsoDate`
  - `toMinutes(hhmm: string): number`
  - `minutesUntil(date: IsoDate, hhmm: string, now?: Date): number`
  - `formatDay(d: IsoDate): { weekday: string; day: string; month: string; label: string }`. Ví dụ `label` là `"Thu, 1 Oct"`, giống định dạng hiện tại.

- [ ] **Bước 1: Viết test**

Create `lib/venue-time.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  formatDay,
  isValidIsoDate,
  minutesUntil,
  toMinutes,
  venueNow,
} from './venue-time';

describe('venueNow', () => {
  it('reads the date and time in Da Nang, not on the machine running the code', () => {
    // 17:30 UTC on 1 Oct is 00:30 on 2 Oct in Da Nang (UTC+7). The test runner is pinned to UTC.
    expect(venueNow(new Date('2026-10-01T17:30:00Z'))).toEqual({ date: '2026-10-02', minutes: 30 });
  });

  it('rolls over at Da Nang midnight', () => {
    expect(venueNow(new Date('2026-10-01T16:59:00Z'))).toEqual({ date: '2026-10-01', minutes: 23 * 60 + 59 });
    expect(venueNow(new Date('2026-10-01T17:00:00Z'))).toEqual({ date: '2026-10-02', minutes: 0 });
  });
});

describe('calendar maths', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-10-02', -1)).toBe('2026-10-01');
  });

  it('counts whole days between dates', () => {
    expect(daysBetween('2026-10-02', '2026-10-15')).toBe(13);
    expect(daysBetween('2026-10-02', '2026-10-01')).toBe(-1);
  });

  it('accepts only real YYYY-MM-DD dates', () => {
    expect(isValidIsoDate('2026-10-02')).toBe(true);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2026-10-2')).toBe(false);
    expect(isValidIsoDate('tomorrow')).toBe(false);
    expect(isValidIsoDate(20261002)).toBe(false);
  });

  it('reads HH:MM as minutes after midnight', () => {
    expect(toMinutes('19:30')).toBe(1170);
  });
});

describe('minutesUntil', () => {
  const at = new Date('2026-10-02T12:00:00Z'); // 19:00 in Da Nang

  it('measures from Da Nang time', () => {
    expect(minutesUntil('2026-10-02', '19:30', at)).toBe(30);
    expect(minutesUntil('2026-10-02', '18:00', at)).toBe(-60);
    expect(minutesUntil('2026-10-03', '07:00', at)).toBe(12 * 60);
  });
});

describe('formatDay', () => {
  it('formats the same way whatever timezone the browser is in', () => {
    expect(formatDay('2026-10-01')).toEqual({ weekday: 'Thu', day: '1', month: 'Oct', label: 'Thu, 1 Oct' });
    expect(formatDay('2026-09-03').month).toBe('Sep');
  });
});
```

- [ ] **Bước 2: Chạy để thấy lỗi**

Run: `npm test -- lib/venue-time.test.ts`
Expected: FAIL, báo không resolve được import `./venue-time`.

- [ ] **Bước 3: Viết code**

Create `lib/venue-time.ts`:

```ts
/**
 * Calendar maths in the venue's timezone (Asia/Ho_Chi_Minh: UTC+7, no DST).
 * Runs in the browser and on the server alike, so both agree on "today" and
 * on how long until a sitting, whatever timezone either machine is set to.
 */
export const VENUE_TZ = 'Asia/Ho_Chi_Minh';

/** A calendar date as YYYY-MM-DD. */
export type IsoDate = string;

const clock = new Intl.DateTimeFormat('en-CA', {
  timeZone: VENUE_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23', // never "24:05" just after midnight
});

/** The venue's current date and minutes since its midnight. */
export function venueNow(now: Date = new Date()): { date: IsoDate; minutes: number } {
  const p = Object.fromEntries(clock.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

const DAY_MS = 86_400_000;
const utcMidnight = (d: IsoDate) => Date.parse(`${d}T00:00:00Z`);

export function addDays(d: IsoDate, n: number): IsoDate {
  return new Date(utcMidnight(d) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((utcMidnight(to) - utcMidnight(from)) / DAY_MS);
}

/** True for real calendar dates written as YYYY-MM-DD (rejects 2026-02-30). */
export function isValidIsoDate(s: unknown): s is IsoDate {
  return (
    typeof s === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(utcMidnight(s)) &&
    addDays(s, 0) === s
  );
}

export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Minutes from the venue's "now" until `hhmm` on `date`; negative once it has passed. */
export function minutesUntil(date: IsoDate, hhmm: string, now: Date = new Date()): number {
  const v = venueNow(now);
  return daysBetween(v.date, date) * 1440 + toMinutes(hhmm) - v.minutes;
}

const partOf = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options });
const WEEKDAY = partOf({ weekday: 'short' });
const MONTH = partOf({ month: 'short' });

/** Display pieces for a date ("Thu", "1", "Oct") and the joined "Thu, 1 Oct". */
export function formatDay(d: IsoDate) {
  const at = new Date(utcMidnight(d));
  const weekday = WEEKDAY.format(at);
  const month = MONTH.format(at);
  const day = String(at.getUTCDate());
  return { weekday, day, month, label: `${weekday}, ${day} ${month}` };
}
```

- [ ] **Bước 4: Chạy để thấy pass**

Run: `npm test -- lib/venue-time.test.ts`
Expected: PASS, 8 test.

- [ ] **Bước 5: Commit**

```bash
npm run lint && npm run typecheck
git add lib/venue-time.ts lib/venue-time.test.ts
git commit -m "feat: add Da Nang-time calendar helpers shared by client and server"
```

---

### Task 6: Chuẩn hóa số điện thoại và mã lỗi đặt bàn

**Files:**
- Create: `lib/phone.ts`, `lib/phone.test.ts`, `lib/booking-errors.ts`, `lib/booking-errors.test.ts`
- Modify: `package.json` (dependency `libphonenumber-js`)

**Interfaces:**
- Consumes: không có.
- Produces:
  - `toE164(raw: string): string | null`: số theo E.164, số nội địa hiểu là số Việt Nam; trả `null` khi số không hợp lệ.
  - `BOOKING_ERROR_CODES` (mảng `as const`) và `type BookingErrorCode`, gồm: `'restaurant_unavailable' | 'party_too_large' | 'outside_window' | 'slot_unavailable' | 'past' | 'invalid_name' | 'invalid_phone' | 'invalid_email' | 'full' | 'duplicate' | 'unknown' | 'network'`.
  - `bookingErrorMessage(code: BookingErrorCode, params?: Record<string, string>): string`.

- [ ] **Bước 1: Viết test**

Create `lib/phone.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toE164 } from './phone';

describe('toE164', () => {
  it.each([
    ['0905 000 000', '+84905000000'],
    ['+84 905 000 000', '+84905000000'],
    ['84905000000', '+84905000000'],
    ['0236 3847 333', '+842363847333'],
    ['+33 6 12 34 56 78', '+33612345678'],
    ['+82 10-1234-5678', '+821012345678'],
  ])('reads %j as %s', (raw, e164) => {
    expect(toE164(raw)).toBe(e164);
  });

  it.each(['12345', 'abc', ''])('rejects %j', (raw) => {
    expect(toE164(raw)).toBeNull();
  });
});
```

Create `lib/booking-errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BOOKING_ERROR_CODES, bookingErrorMessage } from './booking-errors';

describe('bookingErrorMessage', () => {
  it('has guest-facing copy for every code', () => {
    for (const code of BOOKING_ERROR_CODES) {
      expect(bookingErrorMessage(code).length).toBeGreaterThan(10);
    }
  });

  it('names the restaurant when it does not serve the chosen time', () => {
    expect(bookingErrorMessage('slot_unavailable', { restaurant: 'Tàya House' })).toBe(
      'Tàya House does not serve at that time.',
    );
  });

  it('falls back to a generic subject when the restaurant is not given', () => {
    expect(bookingErrorMessage('slot_unavailable')).toBe('The restaurant does not serve at that time.');
  });
});
```

- [ ] **Bước 2: Chạy để thấy lỗi**

Run: `npm test -- lib/phone.test.ts lib/booking-errors.test.ts`
Expected: FAIL, báo không resolve được `./phone` và `./booking-errors`.

- [ ] **Bước 3: Viết code**

```bash
npm i libphonenumber-js@^1.13.14
```

Create `lib/phone.ts`:

```ts
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

/**
 * A guest's phone in E.164 form ('+84905000000'). Numbers without a country
 * code are read as Vietnamese. Null when it is not a valid number.
 */
export function toE164(raw: string): string | null {
  const parsed = parsePhoneNumberFromString(raw.trim(), 'VN');
  return parsed?.isValid() ? parsed.number : null;
}
```

Create `lib/booking-errors.ts`:

```ts
/**
 * What can go wrong with a table request. The server returns only these
 * codes; the browser turns them into copy. The English copy lives here until
 * the content registry (lib/i18n/registry.ts) arrives in phase 2.
 */
export const BOOKING_ERROR_CODES = [
  'restaurant_unavailable',
  'party_too_large',
  'outside_window',
  'slot_unavailable',
  'past',
  'invalid_name',
  'invalid_phone',
  'invalid_email',
  'full',
  'duplicate',
  'unknown',
  'network',
] as const;

export type BookingErrorCode = (typeof BOOKING_ERROR_CODES)[number];

const MESSAGES: Record<BookingErrorCode, string> = {
  restaurant_unavailable: 'That restaurant is no longer available.',
  party_too_large: 'Please choose between 1 and 12 guests.',
  outside_window: 'Please choose a date within the next two weeks.',
  slot_unavailable: '{restaurant} does not serve at that time.',
  past: 'That sitting has already started — please pick a later time.',
  invalid_name: 'Please enter your name.',
  invalid_phone: 'Please enter a valid phone number.',
  invalid_email: 'Please check your email address.',
  full: 'That slot just filled up — please choose another time.',
  duplicate: 'We already have a request for this table under your number.',
  unknown: 'Something went wrong with your request. Please try again.',
  network: 'We could not reach the reservations desk. Please try again.',
};

const DEFAULT_PARAMS: Record<string, string> = { restaurant: 'The restaurant' };

export function bookingErrorMessage(code: BookingErrorCode, params: Record<string, string> = {}): string {
  return MESSAGES[code].replace(/\{(\w+)\}/g, (_, key: string) => params[key] ?? DEFAULT_PARAMS[key] ?? '');
}
```

- [ ] **Bước 4: Chạy để thấy pass**

Run: `npm test -- lib/phone.test.ts lib/booking-errors.test.ts`
Expected: PASS, 12 test.

- [ ] **Bước 5: Commit**

```bash
npm run lint && npm run typecheck
git add lib/phone.ts lib/phone.test.ts lib/booking-errors.ts lib/booking-errors.test.ts package.json package-lock.json
git commit -m "feat: normalise guest phones to E.164 and define booking error codes"
```

---

### Task 7: Tầng DB — cột `phone_e164`, index chặn trùng mới, mã tham chiếu không trùng

**Files:**
- Create: `db/migrations/003_reservations_phone_e164.sql`, `lib/server/reference.ts`, `lib/server/reference.test.ts`, `test/integration/migration-003.test.ts`, `test/integration/reservations.test.ts`
- Modify: `db/queries.ts` (từ dòng 1 tới dòng 3 và từ dòng 58 tới dòng 140), `app/actions.ts` (thêm `phoneE164`, bỏ `newReference`), `lib/booking.ts:142` (xóa `newReference`)

**Interfaces:**
- Consumes:
  - Task 3: `resetDatabase`, `migrate`, `withClient`, `databaseUrl`, `TEST_DATABASE_URL`.
  - Task 6: `toE164`.
- Produces:
  - `newReference(): string` và `REFERENCE_PATTERN: RegExp` trong `lib/server/reference.ts` (server-only).
  - `NewReservation = { restaurantId; isoDate; time; guests; name; phone; phoneE164; email?; note? }`. Không còn trường `reference`.
  - `createReservation(input: NewReservation, makeReference?: () => string): Promise<CreateResult>`.
  - `CreateResult` giữ nguyên dạng: `{ ok: true; reference } | { ok: false; reason: 'full' | 'duplicate' | 'unknown-restaurant' }`.
  - DB có cột `reservations.phone_e164 text NOT NULL` và index `reservations_dedupe_v2_idx`.

- [ ] **Bước 1: Viết test cho mã tham chiếu**

Create `lib/server/reference.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { REFERENCE_PATTERN, newReference } from './reference';

describe('newReference', () => {
  it('is FC- plus eight Crockford base32 characters', () => {
    for (let i = 0; i < 200; i++) expect(newReference()).toMatch(REFERENCE_PATTERN);
  });

  it('never uses letters that read like digits over the phone', () => {
    const sample = Array.from({ length: 500 }, () => newReference().slice(3)).join('');
    expect(sample).not.toMatch(/[ILOU]/);
  });
});
```

- [ ] **Bước 2: Viết test cho migration**

Create `test/integration/migration-003.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, databaseUrl, migrate, resetDatabase, withClient } from '../helpers/db';

const url = databaseUrl('furama_cuisine_migrate_test');

const insertLegacy = (rows: [reference: string, phone: string][]) =>
  withClient(url, (c) =>
    c.query(
      `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone)
       SELECT r, 'taya-house', '2026-10-05', '19:00', 2, 'Guest', p
         FROM unnest($1::text[], $2::text[]) AS t(r, p)`,
      [rows.map((r) => r[0]), rows.map((r) => r[1])],
    ),
  );

describe.skipIf(!TEST_DATABASE_URL)('migration 003: normalised phones (database)', () => {
  it('backfills E.164 phones on existing bookings and keeps their references', async () => {
    resetDatabase(url, '002_seed_restaurants.sql');
    await insertLegacy([
      ['FC-12345', '0905 000 000'],
      ['FC-23456', '84 912 345 678'],
    ]);

    migrate(url);

    const { rows } = await withClient(url, (c) =>
      c.query('SELECT reference, phone, phone_e164 FROM reservations ORDER BY reference'),
    );
    expect(rows).toEqual([
      { reference: 'FC-12345', phone: '0905 000 000', phone_e164: '+84905000000' },
      { reference: 'FC-23456', phone: '84 912 345 678', phone_e164: '+84912345678' },
    ]);
  });

  it('stops, and changes nothing, when two active bookings share a phone once normalised', async () => {
    resetDatabase(url, '002_seed_restaurants.sql');
    await insertLegacy([
      ['FC-11111', '0905 000 000'],
      ['FC-22222', '+84 905 000 000'],
    ]);

    expect(() => migrate(url)).toThrow();

    const column = await withClient(url, (c) =>
      c.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'reservations' AND column_name = 'phone_e164'`,
      ),
    );
    expect(column.rowCount).toBe(0);
  });
});
```

- [ ] **Bước 3: Viết test cho `createReservation`**

Create `test/integration/reservations.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import { createReservation, type NewReservation } from '@/db/queries';

const booking = (over: Partial<NewReservation> = {}): NewReservation => ({
  restaurantId: 'taya-house',
  isoDate: '2026-10-05',
  time: '19:00',
  guests: 2,
  name: 'Nguyễn Minh Anh',
  phone: '0905 000 000',
  phoneE164: '+84905000000',
  ...over,
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('createReservation (database)', () => {
  beforeEach(async () => {
    await getPool().query('DELETE FROM reservations');
  });
  afterAll(() => getPool().end());

  it('stores the normalised phone next to what the guest typed', async () => {
    expect((await createReservation(booking())).ok).toBe(true);
    const { rows } = await getPool().query('SELECT phone, phone_e164 FROM reservations');
    expect(rows).toEqual([{ phone: '0905 000 000', phone_e164: '+84905000000' }]);
  });

  it('treats the same number written differently as a duplicate', async () => {
    await createReservation(booking());
    expect(await createReservation(booking({ phone: '+84 905 000 000' }))).toEqual({
      ok: false,
      reason: 'duplicate',
    });
  });

  it('lets only one of two simultaneous requests take the last seats', async () => {
    // Tàya House seats 16 per slot, so 10 + 10 cannot both fit.
    const [a, b] = await Promise.all([
      createReservation(booking({ guests: 10, phone: '0905 000 001', phoneE164: '+84905000001' })),
      createReservation(booking({ guests: 10, phone: '0905 000 002', phoneE164: '+84905000002' })),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)).toEqual({ ok: false, reason: 'full' });
  });

  it('draws a new reference when the first one is already taken', async () => {
    await createReservation(booking(), () => 'FC-AAAAAAAA');
    const queue = ['FC-AAAAAAAA', 'FC-BBBBBBBB'];
    const result = await createReservation(
      booking({ phone: '0905 000 003', phoneE164: '+84905000003' }),
      () => queue.shift() ?? 'FC-CCCCCCCC',
    );
    expect(result).toEqual({ ok: true, reference: 'FC-BBBBBBBB' });
  });

  it('gives up after three colliding references instead of looping forever', async () => {
    await createReservation(booking(), () => 'FC-AAAAAAAA');
    await expect(
      createReservation(booking({ phone: '0905 000 004', phoneE164: '+84905000004' }), () => 'FC-AAAAAAAA'),
    ).rejects.toThrow();
  });
});
```

- [ ] **Bước 4: Chạy để thấy lỗi**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test`
Expected: FAIL.
- `reference.test.ts`: không resolve được `./reference`.
- `migration-003`: không có cột `phone_e164`.
- `reservations.test.ts`: lỗi type hoặc lỗi chạy do thiếu `phoneE164`.

- [ ] **Bước 5: Viết migration**

Create `db/migrations/003_reservations_phone_e164.sql`:

```sql
-- Normalised phone numbers for duplicate detection and lookup. `phone` keeps
-- what the guest typed; `phone_e164` is the canonical form the app writes
-- (libphonenumber, Vietnamese default region).

ALTER TABLE reservations ADD COLUMN IF NOT EXISTS phone_e164 text;

-- Rows written before this migration get a rough Vietnamese normalisation:
-- 84… → +84…, 0… → +84…, anything else gains a leading +.
UPDATE reservations
   SET phone_e164 = CASE
         WHEN p.d LIKE '84%' THEN '+' || p.d
         WHEN p.d LIKE '0%'  THEN '+84' || substr(p.d, 2)
         ELSE '+' || p.d
       END
  FROM (SELECT id AS rid, regexp_replace(phone, '\D', '', 'g') AS d FROM reservations) p
 WHERE reservations.id = p.rid
   AND reservations.phone_e164 IS NULL;

-- Two active bookings can collapse onto one key once phones are normalised.
-- Stop with a readable message rather than a bare unique violation.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM reservations
     WHERE status IN ('requested', 'confirmed')
     GROUP BY restaurant_id, reserved_on, reserved_at, phone_e164
    HAVING count(*) > 1
  ) dupes;
  IF n > 0 THEN
    RAISE EXCEPTION '% active booking group(s) share a phone once normalised; cancel the extras, then migrate again', n;
  END IF;
END $$;

ALTER TABLE reservations ALTER COLUMN phone_e164 SET NOT NULL;

-- Replaces the raw-phone index: one active request per table and number.
DROP INDEX IF EXISTS reservations_dedupe_idx;
CREATE UNIQUE INDEX IF NOT EXISTS reservations_dedupe_v2_idx
  ON reservations (restaurant_id, reserved_on, reserved_at, phone_e164)
  WHERE status IN ('requested', 'confirmed');
```

- [ ] **Bước 6: Viết module mã tham chiếu**

Create `lib/server/reference.ts`:

```ts
import 'server-only';
import { randomInt } from 'node:crypto';

/** Crockford base32: no I, L, O or U, so a reference survives being read over the phone. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const REFERENCE_PATTERN = /^FC-[0-9A-HJKMNP-TV-Z]{8}$/;

/** FC- plus 8 random characters: about 10^12 values, and not guessable in sequence. */
export function newReference(): string {
  let reference = 'FC-';
  for (let i = 0; i < 8; i++) reference += ALPHABET[randomInt(ALPHABET.length)];
  return reference;
}
```

- [ ] **Bước 7: Viết lại `createReservation`**

Trong `db/queries.ts`, thay hai dòng import đầu file (dòng 2 và dòng 3) bằng:

```ts
import { getPool, query } from './client';
import type { DestKey, Meal, Restaurant } from '@/lib/data';
import { newReference } from '@/lib/server/reference';
```

Thay toàn bộ đoạn từ `export type NewReservation = {` (dòng 58) tới cuối file bằng:

```ts
export type NewReservation = {
  restaurantId: string;
  isoDate: string;
  time: string;
  guests: number;
  name: string;
  /** As the guest typed it. */
  phone: string;
  /** Canonical form; the duplicate check keys on this. */
  phoneE164: string;
  email?: string;
  note?: string;
};

export type CreateResult =
  | { ok: true; reference: string }
  | { ok: false; reason: 'full' | 'duplicate' | 'unknown-restaurant' };

const REFERENCE_ATTEMPTS = 3;

/** The unique constraint a Postgres error violated, if it is one. */
function violatedConstraint(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { code?: string; constraint?: string };
  return e.code === '23505' ? (e.constraint ?? null) : null;
}

/**
 * Books a table if the slot still has room. A reference that collides with an
 * existing one is redrawn, up to three times.
 */
export async function createReservation(
  input: NewReservation,
  makeReference: () => string = newReference,
): Promise<CreateResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await insertReservation(input, makeReference());
    } catch (err) {
      if (violatedConstraint(err) === 'reservations_reference_key' && attempt < REFERENCE_ATTEMPTS) continue;
      throw err;
    }
  }
}

/**
 * The capacity check and the insert share one transaction and take a row lock
 * on the restaurant, so two simultaneous requests for the last seats cannot
 * both succeed.
 */
async function insertReservation(input: NewReservation, reference: string): Promise<CreateResult> {
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');

    const restaurant = await client.query<{ slot_capacity: number }>(
      'SELECT slot_capacity FROM restaurants WHERE id = $1 FOR UPDATE',
      [input.restaurantId],
    );
    if (!restaurant.rowCount) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'unknown-restaurant' };
    }

    const booked = await client.query<{ covers: string }>(
      `SELECT COALESCE(SUM(guests), 0)::text AS covers
         FROM reservations
        WHERE restaurant_id = $1
          AND reserved_on = $2::date
          AND reserved_at = $3
          AND status <> 'cancelled'`,
      [input.restaurantId, input.isoDate, input.time],
    );

    const taken = Number(booked.rows[0]?.covers ?? 0);
    if (taken + input.guests > restaurant.rows[0].slot_capacity) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'full' };
    }

    await client.query(
      `INSERT INTO reservations
         (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164, email, note)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10)`,
      [
        reference,
        input.restaurantId,
        input.isoDate,
        input.time,
        input.guests,
        input.name,
        input.phone,
        input.phoneE164,
        input.email || null,
        input.note || null,
      ],
    );

    await client.query('COMMIT');
    return { ok: true, reference };
  } catch (err) {
    await client.query('ROLLBACK');
    // The partial unique index rejects a second request for the same table and number.
    if (violatedConstraint(err) === 'reservations_dedupe_v2_idx') return { ok: false, reason: 'duplicate' };
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Bước 8: Cập nhật nơi gọi**

Trong `lib/booking.ts`, xóa dòng 142 (`export const newReference = …`).

Trong `app/actions.ts`:

Thay import ở dòng 5 bằng:

```ts
import { DAY_COUNT, days, isoDate, isPast, validate } from '@/lib/booking';
import { toE164 } from '@/lib/phone';
```

Thay dòng 59 (`if (!checks.phone) …`) bằng:

```ts
  const phoneE164 = toE164(input.phone);
  if (!checks.phone || !phoneE164) return { ok: false, error: 'Please enter a valid phone number.' };
```

Thay khối `createReservation({ … })` (từ dòng 63 đến dòng 73) bằng:

```ts
  const result = await createReservation({
    restaurantId: restaurant.id,
    isoDate: isoDate(date),
    time: input.time,
    guests,
    name: input.name.trim(),
    phone: input.phone.trim(),
    phoneE164,
    email: input.email.trim() || undefined,
    note: input.note.trim() || undefined,
  });
```

Task 9 sẽ viết lại `app/actions.ts`. Mục tiêu ở đây chỉ là để code vẫn build được.

- [ ] **Bước 9: Chạy để thấy pass**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test`
Expected: PASS toàn bộ: fold, venue-time, phone, booking-errors, reference, catalogue, migration-003 (2 test), reservations (5 test).

Run: `npm run typecheck && npm run lint`
Expected: không có lỗi.

- [ ] **Bước 10: Commit**

```bash
git add db/migrations/003_reservations_phone_e164.sql lib/server/reference.ts lib/server/reference.test.ts db/queries.ts app/actions.ts lib/booking.ts test/integration/migration-003.test.ts test/integration/reservations.test.ts
git commit -m "feat: dedupe bookings on E.164 phones and redraw colliding references"
```

---

### Task 8: Quy tắc đặt bàn theo ngày ISO và `checkReservation`

**Files:**
- Create: `lib/server/check-reservation.ts`, `lib/server/check-reservation.test.ts`
- Modify: `lib/booking.ts` (thêm hằng và hàm theo ngày ISO; các hàm cũ để nguyên cho tới Task 9), `lib/booking.test.ts`

**Interfaces:**
- Consumes:
  - Task 5: `venueNow`, `addDays`, `daysBetween`, `isValidIsoDate`, `minutesUntil`, `IsoDate`.
  - Task 6: `toE164`, `BookingErrorCode`.
- Produces:
  - Trong `lib/booking.ts`: hằng `BOOKING_WINDOW_DAYS = 14`, `LEAD_MINUTES = 30`, `MAX_GUESTS = 12`.
  - `bookingDates(today: IsoDate): IsoDate[]`
  - `inWindow(date: IsoDate, today: IsoDate): boolean`
  - `isSittingClosed(date: IsoDate, time: string, now?: Date): boolean`
  - `defaultDate(restaurants: Restaurant[], restaurantId: string, today: IsoDate, now?: Date): IsoDate`
  - Trong `lib/server/check-reservation.ts`: `type ReservationInput = { restaurant; date; time; guests; name; phone; email; note }`, `type CheckedReservation`, `type CheckResult`, và hàm `checkReservation(input, restaurants, now?): CheckResult`.

- [ ] **Bước 1: Viết test cho quy tắc ngày**

Thêm vào cuối `lib/booking.test.ts` (sửa dòng import đầu file như bên dưới):

```ts
import { describe, expect, it } from 'vitest';
import type { Restaurant } from './data';
import { bookingDates, defaultDate, fold, inWindow, isSittingClosed } from './booking';
```

```ts
const taya: Restaurant = {
  id: 'taya-house',
  name: 'Tàya House',
  type: 'Vietnamese · Cooking Class',
  cuisines: ['Vietnamese'],
  dest: 'resort',
  meals: ['Lunch', 'Dinner'],
  slotCapacity: 16,
};

describe('booking window', () => {
  it('offers 14 dates starting today', () => {
    const dates = bookingDates('2026-10-02');
    expect(dates).toHaveLength(14);
    expect(dates[0]).toBe('2026-10-02');
    expect(dates[13]).toBe('2026-10-15');
  });

  it('runs from today to 13 days after it', () => {
    expect(inWindow('2026-10-02', '2026-10-02')).toBe(true);
    expect(inWindow('2026-10-15', '2026-10-02')).toBe(true);
    expect(inWindow('2026-10-16', '2026-10-02')).toBe(false);
    expect(inWindow('2026-10-01', '2026-10-02')).toBe(false);
  });
});

describe('isSittingClosed', () => {
  const at = new Date('2026-10-02T12:00:00Z'); // 19:00 in Da Nang

  it('closes a sitting 30 minutes before it starts', () => {
    expect(isSittingClosed('2026-10-02', '19:30', at)).toBe(true);
    expect(isSittingClosed('2026-10-02', '20:00', at)).toBe(false);
  });

  it("leaves tomorrow's sittings open", () => {
    expect(isSittingClosed('2026-10-03', '07:00', at)).toBe(false);
  });
});

describe('defaultDate', () => {
  it('keeps today while a sitting is still open', () => {
    expect(defaultDate([taya], 'taya-house', '2026-10-02', new Date('2026-10-02T12:00:00Z'))).toBe('2026-10-02');
  });

  it('moves to tomorrow once the last sitting has closed', () => {
    // 20:45 in Da Nang: the 21:00 sitting is 15 minutes away, inside the 30-minute lead.
    expect(defaultDate([taya], 'taya-house', '2026-10-02', new Date('2026-10-02T13:45:00Z'))).toBe('2026-10-03');
  });
});
```

- [ ] **Bước 2: Viết test cho `checkReservation`**

Create `lib/server/check-reservation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Restaurant } from '@/lib/data';
import { checkReservation, type ReservationInput } from './check-reservation';

const taya: Restaurant = {
  id: 'taya-house',
  name: 'Tàya House',
  type: 'Vietnamese · Cooking Class',
  cuisines: ['Vietnamese'],
  dest: 'resort',
  meals: ['Lunch', 'Dinner'],
  slotCapacity: 16,
};

const input = (over: Partial<ReservationInput> = {}): ReservationInput => ({
  restaurant: 'taya-house',
  date: '2026-10-02',
  time: '19:00',
  guests: 2,
  name: 'Nguyễn Minh Anh',
  phone: '0905 000 000',
  email: '',
  note: '',
  ...over,
});

const at1am = new Date('2026-10-01T18:00:00Z'); // 01:00 on 2 Oct in Da Nang; still 1 Oct on a UTC server
const at7pm = new Date('2026-10-02T12:00:00Z'); // 19:00 on 2 Oct in Da Nang

const codeOf = (over: Partial<ReservationInput>, now = at1am) => {
  const result = checkReservation(input(over), [taya], now);
  return result.ok ? 'ok' : result.code;
};

describe('checkReservation: dates in Da Nang time', () => {
  it('books the date the guest picked, even between midnight and 07:00 in Da Nang', () => {
    const result = checkReservation(input(), [taya], at1am);
    expect(result).toMatchObject({ ok: true, value: { date: '2026-10-02', phoneE164: '+84905000000' } });
  });

  it('treats the UTC server date as yesterday, not today', () => {
    expect(codeOf({ date: '2026-10-01' })).toBe('outside_window');
  });

  it('accepts the last day of the window and refuses the day after', () => {
    expect(codeOf({ date: '2026-10-15' })).toBe('ok');
    expect(codeOf({ date: '2026-10-16' })).toBe('outside_window');
  });

  it('closes sittings by Da Nang time, 30 minutes ahead', () => {
    expect(codeOf({ time: '19:00' }, at7pm)).toBe('past');
    expect(codeOf({ time: '19:30' }, at7pm)).toBe('past');
    expect(codeOf({ time: '20:00' }, at7pm)).toBe('ok');
  });
});

describe('checkReservation: tampered or invalid input', () => {
  it.each([
    [{ restaurant: 'nowhere' }, 'restaurant_unavailable'],
    [{ guests: 13 }, 'party_too_large'],
    [{ guests: 0 }, 'unknown'],
    [{ guests: 2.5 }, 'unknown'],
    [{ date: 'tomorrow' }, 'outside_window'],
    [{ date: '2026-02-30' }, 'outside_window'],
    [{ time: '19:15' }, 'slot_unavailable'],
    [{ time: '08:00' }, 'slot_unavailable'],
    [{ name: ' a ' }, 'invalid_name'],
    [{ phone: '12345' }, 'invalid_phone'],
    [{ email: 'guest@' }, 'invalid_email'],
  ] as [Partial<ReservationInput>, string][])('%j → %s', (over, code) => {
    expect(codeOf(over)).toBe(code);
  });

  it('names the restaurant when it does not serve the time', () => {
    expect(checkReservation(input({ time: '08:00' }), [taya], at1am)).toEqual({
      ok: false,
      code: 'slot_unavailable',
      params: { restaurant: 'Tàya House' },
    });
  });

  it('accepts foreign numbers', () => {
    expect(checkReservation(input({ phone: '+33 6 12 34 56 78' }), [taya], at1am)).toMatchObject({
      ok: true,
      value: { phoneE164: '+33612345678' },
    });
  });

  it('trims what it stores and drops empty optional fields', () => {
    const result = checkReservation(input({ name: '  An  ', email: '  ', note: '  ' }), [taya], at1am);
    expect(result).toMatchObject({ ok: true, value: { name: 'An', email: undefined, note: undefined } });
  });
});
```

- [ ] **Bước 3: Chạy để thấy lỗi**

Run: `npm test -- lib/booking.test.ts lib/server/check-reservation.test.ts`
Expected: FAIL. `bookingDates` và các hàm mới chưa được export; `./check-reservation` chưa tồn tại.

- [ ] **Bước 4: Thêm quy tắc ngày vào `lib/booking.ts`**

Thay dòng 1 của `lib/booking.ts` bằng:

```ts
import { MO, SLOTS, WD, type Meal, type Restaurant } from './data';
import { addDays, daysBetween, minutesUntil, type IsoDate } from './venue-time';
```

Thêm đoạn sau ngay dưới khai báo `export const DAY_COUNT = 14;`:

```ts
/** Online booking window: today plus the next 13 days, in Da Nang time. */
export const BOOKING_WINDOW_DAYS = 14;
/** A sitting closes to online booking this many minutes before it starts. */
export const LEAD_MINUTES = 30;
export const MAX_GUESTS = 12;

/** The dates a guest can pick, starting with the venue's today. */
export function bookingDates(today: IsoDate): IsoDate[] {
  return Array.from({ length: BOOKING_WINDOW_DAYS }, (_, i) => addDays(today, i));
}

export function inWindow(date: IsoDate, today: IsoDate): boolean {
  const offset = daysBetween(today, date);
  return offset >= 0 && offset < BOOKING_WINDOW_DAYS;
}

/** True once a sitting is within LEAD_MINUTES of starting, in Da Nang time. */
export function isSittingClosed(date: IsoDate, time: string, now: Date = new Date()): boolean {
  return minutesUntil(date, time, now) <= LEAD_MINUTES;
}
```

Thêm đoạn sau ngay dưới hàm `slotsFor`:

```ts
/** Today, unless every sitting of the restaurant has already closed for today. */
export function defaultDate(
  restaurants: Restaurant[],
  restaurantId: string,
  today: IsoDate,
  now: Date = new Date(),
): IsoDate {
  const open = slotsFor(restaurants, restaurantId).some((g) =>
    g.times.some((t) => !isSittingClosed(today, t, now)),
  );
  return open ? today : addDays(today, 1);
}
```

- [ ] **Bước 5: Viết `checkReservation`**

Create `lib/server/check-reservation.ts`:

```ts
import 'server-only';
import type { Restaurant } from '@/lib/data';
import { MAX_GUESTS, inWindow, isSittingClosed, slotsFor, validate } from '@/lib/booking';
import type { BookingErrorCode } from '@/lib/booking-errors';
import { toE164 } from '@/lib/phone';
import { isValidIsoDate, venueNow, type IsoDate } from '@/lib/venue-time';

/** What the reserve drawer sends. It arrives over the wire, so nothing is trusted. */
export type ReservationInput = {
  restaurant: string;
  date: string;
  time: string;
  guests: number;
  name: string;
  phone: string;
  email: string;
  note: string;
};

export type CheckedReservation = {
  restaurant: Restaurant;
  date: IsoDate;
  time: string;
  guests: number;
  name: string;
  phone: string;
  phoneE164: string;
  email?: string;
  note?: string;
};

export type CheckResult =
  | { ok: true; value: CheckedReservation }
  | { ok: false; code: BookingErrorCode; params?: Record<string, string> };

/**
 * Re-checks everything the client claimed against the venue's clock: the
 * restaurant, the party size, the booking window, that the restaurant serves
 * that time, that the sitting has not closed, and the guest's details.
 */
export function checkReservation(
  input: ReservationInput,
  restaurants: Restaurant[],
  now: Date = new Date(),
): CheckResult {
  const restaurant = restaurants.find((r) => r.id === input.restaurant);
  if (!restaurant) return { ok: false, code: 'restaurant_unavailable' };

  const guests = Number(input.guests);
  if (!Number.isInteger(guests) || guests < 1) return { ok: false, code: 'unknown' };
  if (guests > MAX_GUESTS) return { ok: false, code: 'party_too_large' };

  const date = String(input.date);
  if (!isValidIsoDate(date) || !inWindow(date, venueNow(now).date)) {
    return { ok: false, code: 'outside_window' };
  }

  const time = String(input.time);
  const served = slotsFor(restaurants, restaurant.id).some((g) => g.times.includes(time));
  if (!served) return { ok: false, code: 'slot_unavailable', params: { restaurant: restaurant.name } };
  if (isSittingClosed(date, time, now)) return { ok: false, code: 'past' };

  const name = String(input.name ?? '').trim();
  const phone = String(input.phone ?? '').trim();
  const email = String(input.email ?? '').trim();
  const note = String(input.note ?? '').trim();
  const checks = validate({ name, phone, email, note });
  if (!checks.name) return { ok: false, code: 'invalid_name' };
  const phoneE164 = toE164(phone);
  if (!checks.phone || !phoneE164) return { ok: false, code: 'invalid_phone' };
  if (!checks.email) return { ok: false, code: 'invalid_email' };

  return {
    ok: true,
    value: {
      restaurant,
      date,
      time,
      guests,
      name,
      phone,
      phoneE164,
      email: email || undefined,
      note: note || undefined,
    },
  };
}
```

- [ ] **Bước 6: Chạy để thấy pass**

Run: `npm test -- lib/booking.test.ts lib/server/check-reservation.test.ts`
Expected: PASS. `booking.test.ts` có 7 test; `check-reservation.test.ts` có 18 test.

- [ ] **Bước 7: Commit**

```bash
npm run lint && npm run typecheck
git add lib/booking.ts lib/booking.test.ts lib/server/check-reservation.ts lib/server/check-reservation.test.ts
git commit -m "feat: check table requests against Da Nang time on the server"
```

---

### Task 9: Chuyển luồng đặt bàn sang ngày ISO và đồng hồ của server

Task này đổi giao kèo giữa client và server (`day` → `date`). Server và client phải đổi cùng lúc, nếu không app sẽ không build được.

**Files:**
- Modify:
  - `lib/booking.ts` (viết lại toàn bộ file)
  - `app/actions.ts` (viết lại toàn bộ file)
  - `app/api/availability/route.ts` (viết lại toàn bộ file)
  - `components/site/SiteProvider.tsx`
  - `components/booking/BookingBar.tsx`
  - `components/overlays/ReserveDrawer.tsx`
  - `lib/booking.test.ts`
- Create: `test/integration/availability.test.ts`, `test/integration/submit-reservation.test.ts`, `e2e/booking-dates.spec.ts`

**Interfaces:**
- Consumes:
  - Task 5: `formatDay`, `toMinutes`, `venueNow`, `IsoDate`.
  - Task 6: `bookingErrorMessage`, `BookingErrorCode`.
  - Task 7: `createReservation`, `NewReservation`.
  - Task 8: `checkReservation`, `ReservationInput`, `bookingDates`, `inWindow`, `isSittingClosed`, `defaultDate`, `MAX_GUESTS`.
- Produces:
  - `Booking.date: IsoDate | ''` thay cho `Booking.day`.
  - `type AvailabilityResponse = Availability & { today: IsoDate; now: string; date: IsoDate }`.
  - `GET /api/availability?restaurant=<id>[&date=YYYY-MM-DD]`: trả `AvailabilityResponse`, hoặc 400 khi thiếu `restaurant` hay ngày nằm ngoài cửa sổ.
  - `submitReservation(input: ReservationInput): Promise<{ ok: true; data: { reference: string; date: IsoDate } } | { ok: false; code: BookingErrorCode; params? }>`.
  - Context `useSite()` có thêm `today: IsoDate | null`, `dayList: IsoDate[]`, `now: () => Date`, `confirmedDate: IsoDate | ''`.
  - **Bị xóa khỏi `lib/booking.ts`:** `days`, `isoDate`, `DAY_COUNT`, `isPast`, `toMin`, và hàm `fmtDay` cũ nhận `Date`. Hàm `fmtDay` mới nhận `IsoDate`.
  - **Bị xóa khỏi `app/actions.ts`:** `fetchAvailability` (Server Action công khai này không còn cần).

- [ ] **Bước 1: Viết test unit cho bảng slot theo ngày ISO**

Trong `lib/booking.test.ts`, sửa dòng import thành:

```ts
import { describe, expect, it } from 'vitest';
import type { Restaurant } from './data';
import {
  NO_AVAILABILITY,
  bookingDates,
  defaultDate,
  fold,
  inWindow,
  isSittingClosed,
  reconcile,
  unavailable,
  type Booking,
} from './booking';
```

Thêm vào cuối file:

```ts
describe('the slot board', () => {
  const noon = new Date('2026-10-02T05:00:00Z'); // 12:00 in Da Nang
  const chosen: Booking = { destination: 'resort', restaurant: 'taya-house', date: '2026-10-02', time: '19:00', guests: 4 };

  it('treats every slot as closed until the date is known', () => {
    expect(unavailable('', '19:00', 2, NO_AVAILABILITY, noon)).toBe(true);
  });

  it('moves the chosen time to the nearest slot that still fits once it fills', () => {
    const board = { booked: { '19:00': 14 }, capacity: 16 };
    expect(reconcile([taya], chosen, {}, board, noon).time).toBe('18:30');
  });

  it('keeps the chosen time while the party still fits', () => {
    const board = { booked: { '19:00': 12 }, capacity: 16 };
    expect(reconcile([taya], chosen, {}, board, noon).time).toBe('19:00');
  });
});
```

- [ ] **Bước 2: Viết test tích hợp cho API và Server Action**

Create `test/integration/availability.test.ts`:

```ts
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/availability/route';
import { getPool } from '@/db/client';

const get = (query: string) => GET(new Request(`http://test/api/availability?${query}`));

describe.skipIf(!process.env.TEST_DATABASE_URL)('GET /api/availability (database)', () => {
  beforeEach(async () => {
    await getPool().query('DELETE FROM reservations');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T18:00:00Z')); // 01:00 on 2 Oct in Da Nang
  });
  afterEach(() => vi.useRealTimers());
  afterAll(() => getPool().end());

  it("defaults to Da Nang's today and reports the server clock", async () => {
    const res = await get('restaurant=taya-house');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      today: '2026-10-02',
      now: '2026-10-01T18:00:00.000Z',
      date: '2026-10-02',
      booked: {},
      capacity: 16,
    });
  });

  it('sums the covers booked on the requested date', async () => {
    await getPool().query(
      `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164)
       VALUES ('FC-AAAAAAAA', 'taya-house', '2026-10-03', '19:00', 4, 'An', '0905000000', '+84905000000')`,
    );
    const body = await (await get('restaurant=taya-house&date=2026-10-03')).json();
    expect(body.booked).toEqual({ '19:00': 4 });
  });

  it.each(['restaurant=taya-house&date=2026-10-01', 'restaurant=taya-house&date=2026-10-16', 'restaurant=taya-house&date=tomorrow', 'date=2026-10-02'])(
    'rejects %j with 400',
    async (query) => {
      expect((await get(query)).status).toBe(400);
    },
  );
});
```

Create `test/integration/submit-reservation.test.ts`:

```ts
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { submitReservation } from '@/app/actions';
import { getPool } from '@/db/client';

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

describe.skipIf(!process.env.TEST_DATABASE_URL)('submitReservation (database)', () => {
  beforeEach(async () => {
    await getPool().query('DELETE FROM reservations');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T18:00:00Z')); // 01:00 on 2 Oct in Da Nang, server on UTC
  });
  afterEach(() => vi.useRealTimers());
  afterAll(() => getPool().end());

  it('stores the date the guest picked, not the UTC server date', async () => {
    const result = await submitReservation(request);
    expect(result).toMatchObject({ ok: true, data: { date: '2026-10-02' } });
    const { rows } = await getPool().query('SELECT reserved_on::text AS day, phone_e164 FROM reservations');
    expect(rows).toEqual([{ day: '2026-10-02', phone_e164: '+84905000000' }]);
  });

  it('answers with codes, never English copy', async () => {
    expect(await submitReservation({ ...request, guests: 40 })).toEqual({ ok: false, code: 'party_too_large' });
    await submitReservation(request);
    expect(await submitReservation({ ...request, phone: '+84 905 000 000' })).toEqual({ ok: false, code: 'duplicate' });
  });
});
```

- [ ] **Bước 3: Viết test E2E**

Create `e2e/booking-dates.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

test('the home page hydrates without React errors', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(problems.filter((p) => /hydrat|#418|#423|#425/i.test(p))).toEqual([]);
});

test.describe('a guest whose phone is set to Honolulu time', () => {
  test.use({ timezoneId: 'Pacific/Honolulu' });

  test('sees Da Nang dates in the reserve drawer', async ({ page }) => {
    // 18:00 UTC on 1 Oct: still 1 Oct in Honolulu (08:00), already 2 Oct in Da Nang (01:00).
    await page.clock.setFixedTime(new Date('2026-10-01T18:00:00Z'));
    await page.route('**/api/availability**', (route) =>
      route.fulfill({
        json: { today: '2026-10-02', now: '2026-10-01T18:00:00.000Z', date: '2026-10-02', booked: {}, capacity: 16 },
      }),
    );

    await page.goto('/');
    await page.getByRole('button', { name: 'RESERVE', exact: true }).first().click();

    const first = page.locator('.daystrip .day').first();
    await expect(first.locator('.day-wd')).toHaveText('Today');
    await expect(first.locator('.day-num')).toHaveText('2');
    await expect(first.locator('.day-mo')).toHaveText('Oct');
  });
});
```

- [ ] **Bước 4: Chạy để thấy lỗi**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test`
Expected: FAIL.
- `booking.test.ts`: `Booking` chưa có `date`.
- `availability.test.ts`: API chưa có `today` và `now`, lại trả 400 khi thiếu `day`.
- `submit-reservation.test.ts`: action vẫn nhận `day`.

Run: `npm run test:e2e -- e2e/booking-dates.spec.ts`
Expected: FAIL. Test Honolulu thấy ngày `1` thay vì `2`. Test hydration có thể fail ở những giờ ngày VN khác ngày UTC.

- [ ] **Bước 5: Viết lại `lib/booking.ts`**

Thay toàn bộ nội dung `lib/booking.ts` bằng:

```ts
import { SLOTS, type Meal, type Restaurant } from './data';
import { addDays, daysBetween, formatDay, minutesUntil, toMinutes, type IsoDate } from './venue-time';

export type BookingForm = { name: string; phone: string; email: string; note: string };

export type Booking = {
  destination: string;
  restaurant: string;
  /** Da Nang calendar date; empty until the browser knows today. */
  date: IsoDate | '';
  time: string;
  guests: number;
};

/** Covers already booked per slot, plus the room each slot has. From Neon. */
export type Availability = { booked: Record<string, number>; capacity: number };

/** What GET /api/availability returns: the slot board plus the server's clock. */
export type AvailabilityResponse = Availability & { today: IsoDate; now: string; date: IsoDate };

export const NO_AVAILABILITY: Availability = { booked: {}, capacity: Number.POSITIVE_INFINITY };

/** Online booking window: today plus the next 13 days, in Da Nang time. */
export const BOOKING_WINDOW_DAYS = 14;
/** A sitting closes to online booking this many minutes before it starts. */
export const LEAD_MINUTES = 30;
export const MAX_GUESTS = 12;

/** The dates a guest can pick, starting with the venue's today. */
export function bookingDates(today: IsoDate): IsoDate[] {
  return Array.from({ length: BOOKING_WINDOW_DAYS }, (_, i) => addDays(today, i));
}

export function inWindow(date: IsoDate, today: IsoDate): boolean {
  const offset = daysBetween(today, date);
  return offset >= 0 && offset < BOOKING_WINDOW_DAYS;
}

/** "Thu, 1 Oct". */
export const fmtDay = (d: IsoDate) => formatDay(d).label;

export const findRestaurant = (restaurants: Restaurant[], id: string) =>
  restaurants.find((r) => r.id === id);

export function slotsFor(
  restaurants: Restaurant[],
  restaurantId: string,
): { meal: Meal; times: string[] }[] {
  const r = findRestaurant(restaurants, restaurantId);
  const meals: Meal[] = r ? r.meals : ['Dinner'];
  return meals.map((meal) => ({ meal, times: SLOTS[meal] }));
}

/** True once a sitting is within LEAD_MINUTES of starting, in Da Nang time. */
export function isSittingClosed(date: IsoDate, time: string, now: Date = new Date()): boolean {
  return minutesUntil(date, time, now) <= LEAD_MINUTES;
}

/** Today, unless every sitting of the restaurant has already closed for today. */
export function defaultDate(
  restaurants: Restaurant[],
  restaurantId: string,
  today: IsoDate,
  now: Date = new Date(),
): IsoDate {
  const open = slotsFor(restaurants, restaurantId).some((g) =>
    g.times.some((t) => !isSittingClosed(today, t, now)),
  );
  return open ? today : addDays(today, 1);
}

/** A slot is closed when its sitting has closed, or when the party would exceed its remaining covers. */
export function unavailable(
  date: IsoDate | '',
  time: string,
  guests: number,
  availability: Availability,
  now?: Date,
): boolean {
  if (!date || isSittingClosed(date, time, now)) return true;
  const taken = availability.booked[time] ?? 0;
  return taken + guests > availability.capacity;
}

export function seatsLeft(time: string, availability: Availability): number | null {
  if (!Number.isFinite(availability.capacity)) return null;
  return Math.max(0, availability.capacity - (availability.booked[time] ?? 0));
}

/** Keep the chosen time valid: fall back to the nearest open slot. */
export function normTime(
  restaurants: Restaurant[],
  b: Booking,
  availability: Availability,
  now?: Date,
): string {
  const open: string[] = [];
  for (const g of slotsFor(restaurants, b.restaurant)) {
    for (const t of g.times) if (!unavailable(b.date, t, b.guests, availability, now)) open.push(t);
  }
  if (!open.length || open.includes(b.time)) return b.time;
  const m = toMinutes(b.time);
  return open.reduce((a, x) => (Math.abs(toMinutes(x) - m) < Math.abs(toMinutes(a) - m) ? x : a), open[0]);
}

/**
 * Reconcile a patch against the rest of the booking: a restaurant implies its
 * destination, switching destination picks that venue's first restaurant, and
 * the chosen time is nudged to something still bookable.
 */
export function reconcile(
  restaurants: Restaurant[],
  current: Booking,
  patch: Partial<Booking>,
  availability: Availability = NO_AVAILABILITY,
  now?: Date,
): Booking {
  const next = { ...current, ...patch };

  if (patch.destination && patch.destination !== current.destination && !patch.restaurant) {
    const first = restaurants.find((r) => r.dest === patch.destination);
    if (first) next.restaurant = first.id;
  }

  const r = findRestaurant(restaurants, next.restaurant);
  if (r) next.destination = r.dest;

  next.time = normTime(restaurants, next, availability, now);
  return next;
}

export function validate(form: BookingForm) {
  return {
    name: form.name.trim().length >= 2,
    phone: form.phone.replace(/\D/g, '').length >= 8,
    email: !form.email.trim() || /^\S+@\S+\.\S+$/.test(form.email.trim()),
  };
}

export function slotBookable(
  restaurants: Restaurant[],
  b: Booking,
  availability: Availability,
  now?: Date,
): boolean {
  return (
    !unavailable(b.date, b.time, b.guests, availability, now) &&
    slotsFor(restaurants, b.restaurant).some((g) => g.times.includes(b.time))
  );
}

export const guestLabel = (n: number) => `${n} ${n === 1 ? 'guest' : 'guests'}`;

/** Accent- and đ-insensitive fold, so "pho cuon" matches "Phố Cuốn". */
export const fold = (x: string) =>
  String(x)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');
```

- [ ] **Bước 6: Viết lại `app/actions.ts`**

Thay toàn bộ nội dung bằng:

```ts
'use server';

import { createReservation, listRestaurants } from '@/db/queries';
import type { BookingErrorCode } from '@/lib/booking-errors';
import { checkReservation, type ReservationInput } from '@/lib/server/check-reservation';
import type { IsoDate } from '@/lib/venue-time';

export type ReservationResult =
  | { ok: true; data: { reference: string; date: IsoDate } }
  | { ok: false; code: BookingErrorCode; params?: Record<string, string> };

/**
 * Books a table. Everything the client claimed is re-checked against the
 * venue's clock (see checkReservation) before the capacity-guarded insert.
 * Failures come back as codes; the browser turns them into copy.
 */
export async function submitReservation(input: ReservationInput): Promise<ReservationResult> {
  const checked = checkReservation(input, await listRestaurants());
  if (!checked.ok) return checked;

  const v = checked.value;
  const result = await createReservation({
    restaurantId: v.restaurant.id,
    isoDate: v.date,
    time: v.time,
    guests: v.guests,
    name: v.name,
    phone: v.phone,
    phoneE164: v.phoneE164,
    email: v.email,
    note: v.note,
  });

  if (result.ok) return { ok: true, data: { reference: result.reference, date: v.date } };
  if (result.reason === 'full') return { ok: false, code: 'full' };
  if (result.reason === 'duplicate') return { ok: false, code: 'duplicate' };
  return { ok: false, code: 'restaurant_unavailable' };
}
```

- [ ] **Bước 7: Viết lại `app/api/availability/route.ts`**

Thay toàn bộ nội dung bằng:

```ts
import { NextResponse } from 'next/server';
import { bookedCovers, slotCapacity } from '@/db/queries';
import { inWindow, type AvailabilityResponse } from '@/lib/booking';
import { isValidIsoDate, venueNow } from '@/lib/venue-time';

export const dynamic = 'force-dynamic';

/**
 * Booked covers per slot for one restaurant on one date (Da Nang's today when
 * no date is given). It also reports the server's clock, which the browser
 * uses as the authority for "today" and for which sittings have closed.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const restaurant = params.get('restaurant');
  const now = new Date();
  const today = venueNow(now).date;
  const date = params.get('date') ?? today;

  if (!restaurant) {
    return NextResponse.json({ error: 'restaurant is required' }, { status: 400 });
  }
  if (!isValidIsoDate(date) || !inWindow(date, today)) {
    return NextResponse.json({ error: 'date out of range' }, { status: 400 });
  }

  try {
    const [booked, capacity] = await Promise.all([bookedCovers(restaurant, date), slotCapacity(restaurant)]);
    const body: AvailabilityResponse = { today, now: now.toISOString(), date, booked, capacity };
    return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('availability_failed', err);
    return NextResponse.json({ error: 'availability unavailable' }, { status: 503 });
  }
}
```

- [ ] **Bước 8: Cập nhật `components/site/SiteProvider.tsx`**

Thay khối import từ `@/lib/booking` (từ dòng 14 đến dòng 23) bằng:

```ts
import {
  NO_AVAILABILITY,
  bookingDates,
  defaultDate,
  findRestaurant,
  reconcile,
  slotBookable,
  validate,
  type Availability,
  type AvailabilityResponse,
  type Booking,
  type BookingForm,
} from '@/lib/booking';
import { bookingErrorMessage } from '@/lib/booking-errors';
import { venueNow, type IsoDate } from '@/lib/venue-time';
```

Ngay dưới dòng `const DETAIL_PATH = '/taya-house';`, thêm:

```ts
function loadAvailability(
  restaurant: string,
  date: IsoDate,
  signal?: AbortSignal,
): Promise<AvailabilityResponse | null> {
  return fetch(`/api/availability?restaurant=${encodeURIComponent(restaurant)}&date=${date}`, { signal }).then(
    (r) => (r.ok ? (r.json() as Promise<AvailabilityResponse>) : null),
  );
}
```

Trong `type SiteState`, ngay dưới dòng `availability: Availability;`, thêm:

```ts
  /** Da Nang's today once known in the browser; null during the server render. */
  today: IsoDate | null;
  /** The bookable dates, today first; empty until `today` is known. */
  dayList: IsoDate[];
  /** The server's clock, as last reported by /api/availability. */
  now: () => Date;
  /** The date the server stored for the last confirmed request. */
  confirmedDate: IsoDate | '';
```

Trong state khởi tạo của `booking`, thay `day: 0,` bằng `date: '',`.

Ngay dưới dòng `const [serverError, setServerError] = useState<string | null>(null);`, thêm:

```ts
  const [today, setToday] = useState<IsoDate | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [confirmedDate, setConfirmedDate] = useState<IsoDate | ''>('');
```

Thay đoạn từ comment `/* Default to tomorrow once the kitchens have closed for the night. …` tới hết `useEffect` lấy availability (từ dòng 146 đến dòng 182 của file gốc) bằng:

```ts
  const now = useCallback(() => new Date(Date.now() + clockOffset), [clockOffset]);

  /* "Today" is Da Nang's date, resolved after hydration so the server render
     carries no date at all. The availability response then corrects it with
     the server's clock. */
  useEffect(() => {
    const venueToday = venueNow().date;
    setToday(venueToday);
    setBookingState((b) =>
      b.date
        ? b
        : reconcile(restaurants, b, { date: defaultDate(restaurants, b.restaurant, venueToday) }, NO_AVAILABILITY),
    );
  }, [restaurants]);

  const setBooking = useCallback(
    (patch: Partial<Booking>) => {
      setBookingState((b) => reconcile(restaurants, b, patch, availabilityRef.current, now()));
    },
    [now, restaurants],
  );

  /* Pull live slot pressure whenever the restaurant or date changes. The
     response carries the server's clock, which becomes the authority for
     "today" and for which sittings have closed. */
  useEffect(() => {
    const date = booking.date;
    if (!date) return;
    let cancelled = false;
    const controller = new AbortController();

    loadAvailability(booking.restaurant, date, controller.signal)
      .then((data) => {
        if (cancelled || !data) return;
        const serverNow = new Date(data.now);
        const board: Availability = { booked: data.booked, capacity: data.capacity };
        setClockOffset(serverNow.getTime() - Date.now());
        setToday(data.today);
        setAvailability(board);
        // A date the server considers past moves to today; a slot that filled
        // while the drawer was open slides to the nearest free one.
        setBookingState((b) =>
          reconcile(restaurants, b, b.date && b.date < data.today ? { date: data.today } : {}, board, serverNow),
        );
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [booking.restaurant, booking.date, restaurants]);
```

Thay toàn bộ `const submit = useCallback(…)` (từ dòng 316 đến dòng 352 của file gốc) bằng:

```ts
  const submit = useCallback(() => {
    setServerError(null);
    const date = booking.date;
    if (!(date && valid.name && valid.phone && valid.email && slotBookable(restaurants, booking, availability, now()))) {
      setTried(true);
      return;
    }

    setPending(true);
    submitReservation({
      restaurant: booking.restaurant,
      date,
      time: booking.time,
      guests: booking.guests,
      name: form.name,
      phone: form.phone,
      email: form.email,
      note: form.note,
    })
      .then((result) => {
        if (result.ok) {
          setReference(result.data.reference);
          setConfirmedDate(result.data.date);
          setDone(true);
          return;
        }
        setServerError(bookingErrorMessage(result.code, result.params));
        setTried(true);
        // Re-read the slot board so a lost race shows up immediately, and move
        // the chosen time off a slot that has just filled.
        return loadAvailability(booking.restaurant, date)
          .then((data) => {
            if (!data) return;
            const board: Availability = { booked: data.booked, capacity: data.capacity };
            setAvailability(board);
            setBookingState((b) => reconcile(restaurants, b, {}, board, new Date(data.now)));
          })
          .catch(() => {});
      })
      .catch(() => setServerError(bookingErrorMessage('network')))
      .finally(() => setPending(false));
  }, [availability, booking, form, now, restaurants, valid]);
```

Ngay trên `const value = useMemo<SiteState>(`, thêm:

```ts
  const dayList = useMemo(() => (today ? bookingDates(today) : []), [today]);
```

Trong object `value`, ngay dưới dòng `availability,`, thêm:

```ts
      today,
      dayList,
      now,
      confirmedDate,
```

Trong mảng dependency của `useMemo`, thêm `confirmedDate`, `dayList`, `now`, `today`.

- [ ] **Bước 9: Cập nhật `components/booking/BookingBar.tsx`**

Thay dòng 4 bằng:

```ts
import { MAX_GUESTS, fmtDay, guestLabel, seatsLeft, slotsFor, unavailable } from '@/lib/booking';
```

Thay đoạn từ dòng 11 đến dòng 48 (từ `const { restaurants, … } = useSite();` tới hết `guestOptions`) bằng:

```tsx
  const { restaurants, booking, setBooking, availability, openReserve, dayList, now } = useSite();
  const title = useReveal<HTMLHeadingElement>('title');
  const panel = useReveal<HTMLDivElement>('up');

  // No date during the server render, so no clock read either.
  const at = booking.date ? now() : undefined;

  const destinationOptions: Option<string>[] = DEST_KEYS.map((k) => ({
    value: k,
    label: DESTS[k],
  }));

  const restaurantOptions: Option<string>[] = restaurants
    .filter((r) => r.dest === booking.destination)
    .map((r) => ({ value: r.id, label: r.name }));

  const dayOptions: Option<string>[] = dayList.map((d, i) => ({
    value: d,
    label: fmtDay(d),
    note: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : undefined,
  }));

  const timeOptions: Option<string>[] = slotsFor(restaurants, booking.restaurant).flatMap((g) =>
    g.times.map((t) => {
      const taken = unavailable(booking.date, t, booking.guests, availability, at);
      const left = seatsLeft(t, availability);
      return {
        value: t,
        label: t,
        note: taken ? 'Full' : left !== null && left <= 6 ? `${left} left` : g.meal,
        disabled: taken,
      };
    }),
  );

  const guestOptions: Option<number>[] = Array.from({ length: MAX_GUESTS }, (_, i) => ({
    value: i + 1,
    label: guestLabel(i + 1),
  }));
```

Thay khối `<Dropdown id="bDate" … />` bằng:

```tsx
            <Dropdown
              id="bDate"
              label="Date"
              value={booking.date}
              options={dayOptions}
              onPick={(date) => setBooking({ date })}
            />
```

- [ ] **Bước 10: Cập nhật `components/overlays/ReserveDrawer.tsx`**

Thay đoạn import từ dòng 3 đến dòng 13 bằng:

```ts
import { DESTS, DEST_KEYS } from '@/lib/data';
import {
  MAX_GUESTS,
  findRestaurant,
  fmtDay,
  guestLabel,
  seatsLeft,
  slotsFor,
  unavailable,
} from '@/lib/booking';
import { formatDay } from '@/lib/venue-time';
```

Trong khối destructure `useSite()`, thêm `dayList`, `now` và `confirmedDate`.

Thay đoạn từ dòng 46 đến dòng 50 (`const dayList = days();` cho tới hết `anyAvailable`) bằng:

```ts
  const at = now();
  const groups = slotsFor(restaurants, booking.restaurant);
  const anyAvailable = groups.some((g) =>
    g.times.some((t) => !unavailable(booking.date, t, booking.guests, availability, at)),
  );
```

Thay dòng 57 (`const summary = …`) bằng:

```ts
  const summary = [booking.date ? fmtDay(booking.date) : '', booking.time, guestLabel(booking.guests)]
    .filter(Boolean)
    .join(' · ');
```

Trong khung thành công, thay `<span>{fmtDay(dayList[booking.day])}</span>` bằng:

```tsx
                <span>{confirmedDate ? fmtDay(confirmedDate) : ''}</span>
```

Thay toàn bộ khối `{dayList.map((d, i) => ( … ))}` bên trong `<div className="daystrip">` bằng:

```tsx
                {dayList.map((d, i) => {
                  const day = formatDay(d);
                  return (
                    <button
                      type="button"
                      key={d}
                      className="day"
                      data-selected={d === booking.date}
                      aria-pressed={d === booking.date}
                      onClick={() => setBooking({ date: d })}
                    >
                      <span className="day-wd">{i === 0 ? 'Today' : day.weekday}</span>
                      <span className="day-num">{day.day}</span>
                      <span className="day-mo">{day.month}</span>
                    </button>
                  );
                })}
```

Trong nút "More guests", thay hai chỗ đang ghi số `12` (`disabled={booking.guests >= 12}` và `Math.min(12, …)`) bằng `MAX_GUESTS`.

Trong vòng lặp các slot, thay `unavailable(booking.day, t, booking.guests, availability)` bằng `unavailable(booking.date, t, booking.guests, availability, at)`.

- [ ] **Bước 11: Kiểm tra không còn chỗ nào dùng API cũ**

Run: `grep -rn -e "booking\.day" -e "days()" -e "isoDate(" -e "DAY_COUNT" -e "fetchAvailability" -e "isPast(" app components lib`
Expected: không có kết quả nào.

- [ ] **Bước 12: Chạy để thấy pass**

Run: `npm run typecheck && npm run lint`
Expected: không có lỗi.

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test`
Expected: PASS toàn bộ. Trong đó có `availability.test.ts` (6 test) và `submit-reservation.test.ts` (2 test).

Run: `npm run test:e2e`
Expected: PASS 3 test: smoke, hydration, Honolulu.

- [ ] **Bước 13: Commit**

```bash
git add lib/booking.ts lib/booking.test.ts app/actions.ts app/api/availability/route.ts components/site/SiteProvider.tsx components/booking/BookingBar.tsx components/overlays/ReserveDrawer.tsx test/integration/availability.test.ts test/integration/submit-reservation.test.ts e2e/booking-dates.spec.ts
git commit -m "fix: book in Da Nang time with ISO dates and the server's clock

Bookings made between 00:00 and 07:00 in Da Nang were stored a day early,
and the server's cutoff ran seven hours late, because both sides derived
the date from a day offset on their own clocks. The browser now sends an
ISO date, the server re-checks it in Asia/Ho_Chi_Minh, and the date only
renders after hydration (no more React #418)."
```

---

### Task 10: Chạy lại animation intro sau mỗi lần chuyển trang

**Files:**
- Create: `components/site/IntroTrigger.tsx`, `e2e/navigation.spec.ts`
- Modify: `components/site/Chrome.tsx` (dòng 15 và dòng 26), `app/page.tsx`, `app/taya-house/page.tsx`

**Interfaces:**
- Consumes: `useIntro(active: boolean, baseDelay?: number)` từ `lib/motion.tsx`; hàm này không đổi.
- Produces: `<IntroTrigger />`, một client component không render gì. Mỗi trang đặt một cái.

- [ ] **Bước 1: Viết test E2E**

Create `e2e/navigation.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

test('page entrances play again after client-side navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.hero-kicker')).toHaveCSS('opacity', '1');

  await page.locator('.rcard', { hasText: 'Tàya House' }).first().click();
  await page.waitForURL('**/taya-house');
  await expect(page.locator('.taya-kicker')).toHaveCSS('opacity', '1');

  await page.locator('.taya-back').click();
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.locator('.hero-kicker')).toHaveCSS('opacity', '1');
});
```

- [ ] **Bước 2: Chạy để thấy lỗi**

Run: `npm run test:e2e -- e2e/navigation.spec.ts`
Expected: FAIL tại `.taya-kicker`: opacity vẫn là `0` sau 5 giây, vì `useIntro` chỉ chạy một lần trong `Chrome`.

- [ ] **Bước 3: Viết code**

Create `components/site/IntroTrigger.tsx`:

```tsx
'use client';

import { useIntro } from '@/lib/motion';

/**
 * Plays the staggered [data-intro] entrance for the page it is rendered in.
 * It lives in each page rather than in the persistent Chrome, so the entrance
 * runs again after every client-side navigation.
 */
export function IntroTrigger() {
  useIntro(true, 0);
  return null;
}
```

Trong `components/site/Chrome.tsx`:
- Thay dòng 15 bằng `import { useScrollMotion } from '@/lib/motion';`.
- Xóa dòng 26 (`useIntro(true, 0);`).

Trong `app/page.tsx`:
- Thêm `import { IntroTrigger } from '@/components/site/IntroTrigger';` vào cuối nhóm import.
- Đặt `<IntroTrigger />` làm phần tử con đầu tiên của `<main>`.

Trong `app/taya-house/page.tsx`:
- Thêm `import { IntroTrigger } from '@/components/site/IntroTrigger';` vào cuối nhóm import.
- Đặt `<IntroTrigger />` làm phần tử con đầu tiên của `<main>`.

- [ ] **Bước 4: Chạy để thấy pass**

Run: `npm run test:e2e`
Expected: PASS cả 4 test.

- [ ] **Bước 5: Commit**

```bash
npm run lint && npm run typecheck
git add components/site/IntroTrigger.tsx components/site/Chrome.tsx app/page.tsx app/taya-house/page.tsx e2e/navigation.spec.ts
git commit -m "fix: replay page entrances after client-side navigation

useIntro ran once in the persistent Chrome, so the hero and Tàya House
headings stayed invisible after moving between the two pages."
```

---

### Task 11: Kiểm chứng toàn bộ và chạy migration lên Neon `dev`

**Files:** không sửa code.

**Interfaces:**
- Consumes: Task 1 phải xong (người dùng đã xác nhận). Các task 2–10 phải xong.
- Produces: branch Neon `dev` đã có migration 003; báo cáo kết quả.

- [ ] **Bước 1: Chạy toàn bộ kiểm tra**

```bash
npm run typecheck
npm run lint
TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test
npm run build
npm run test:e2e
```

Expected: mọi lệnh exit 0. `npm test` báo 66 test pass (50 unit, 16 tích hợp), 0 skip. `npm run test:e2e` báo 4 test pass. Build in ra các route `/`, `/taya-house` và `/api/availability`.

- [ ] **Bước 2: Dừng lại nếu Task 1 chưa xong**

Nếu người dùng chưa xác nhận Task 1 thì **dừng tại đây**. Báo người dùng rằng mọi việc đã xong trừ migration, và **không chạy `npm run db:migrate`**, vì lúc này `.env.local` vẫn trỏ vào production.

- [ ] **Bước 3: Kiểm tra lại đích của migration**

Chạy lệnh ở Task 1, Bước 3. Hostname của `DATABASE_URL_UNPOOLED` phải trùng endpoint branch `dev` mà người dùng đã xác nhận. Nếu không trùng thì dừng và hỏi người dùng.

- [ ] **Bước 4: Chạy migration lên `dev`**

Run: `npm run db:migrate`
Expected: hai file cũ báo `· 001_init.sql (already applied)` và `· 002_seed_restaurants.sql (already applied)`, file mới báo `✓ 003_reservations_phone_e164.sql`, cuối cùng là `Applied 1 migration(s).`

Nếu migration dừng với thông báo "share a phone once normalised", nghĩa là branch `dev` có đặt bàn test trùng số điện thoại. Hỏi người dùng có được hủy các dòng thừa hay không. Không tự xóa dữ liệu.

- [ ] **Bước 5: Thử bằng tay trên `dev`**

```bash
npm run dev
```

Mở `http://localhost:3000`, bấm RESERVE và chọn Tàya House, hôm nay, suất tối gần nhất còn trống, 2 khách, tên "Test Phase 1", số `0905 000 000`. Gửi đi.

Expected:
- Màn hình thành công có mã dạng `FC-XXXXXXXX` và đúng ngày đã chọn.
- Chạy `npm run db:psql`, rồi `SELECT reference, reserved_on, phone_e164 FROM reservations ORDER BY id DESC LIMIT 1;`: ngày khớp với ngày đã chọn, `phone_e164 = +84905000000`.
- Gửi lại đúng request đó: báo "We already have a request for this table under your number."

- [ ] **Bước 6: Báo cáo**

Báo cho người dùng:
- kết quả từng lệnh ở Bước 1;
- kết quả migration;
- kết quả thử bằng tay;
- danh sách commit trên `feat/phase-0-1` (`git log --oneline main..`).

**Không push.** Hỏi người dùng có muốn push branch và mở pull request không. Lưu ý repo đang public.
