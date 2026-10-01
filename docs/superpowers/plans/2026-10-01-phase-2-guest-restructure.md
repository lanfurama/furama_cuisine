# Đợt 2: Tái cấu trúc web khách — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa web khách vào `app/(site)/[lang]` (chỉ `en`) với `proxy.ts`, trang chi tiết dùng chung `restaurants/[slug]`, chuyển hướng `/taya-house`, trang 404 và trang lỗi, Cache Components cùng Partial Prefetching, ba bảng nền tảng (`locales`, `content_strings`, `destinations`) và khung lớp đọc dữ liệu, mà `/en` vẫn giống hệt trang hiện tại đến từng pixel.

**Architecture:**
- Root layout `app/(site)/[lang]/layout.tsx` chỉ dựng document (font, `<html lang>`, motion). Nó không đọc DB và không gọi `notFound()`. Mọi trang nằm dưới route group `(guarded)`: layout của group này kiểm tra ngôn ngữ, đọc catalogue và chuỗi giao diện qua các hàm `'use cache'`, rồi bọc trang trong `SiteProvider` và `Chrome`.
- Mỗi trang tự bọc nội dung trong `<ViewMarker view restaurant>`. Component này render `<main data-view>` của trang và báo cho chrome biết trang nào đang hiện. Mọi truy vấn DOM của trang chỉ tìm trong `<main>` đó, vì Cache Components giữ trang cũ trong document ở trạng thái ẩn (`<Activity>`).
- Thứ tự task giữ cho mỗi commit đều xanh: chụp baseline trước (Task 1); làm phần dữ liệu (Task 2–4) và phần client trên route hiện tại (Task 5–7); bật Cache Components (Task 8); chuyển route (Task 9); cuối cùng nối DB cho locale và chuỗi giao diện (Task 10).

**Tech Stack:** Next.js 16.3.7 (Turbopack, `cacheComponents`, `partialPrefetching`, `next/root-params`), React 19.3, TypeScript 7.0.2, `pg`, Postgres 18, Vitest 5 (`vitest.config.mts`), Playwright 1.63, oxlint 1.86.

**Spec:** `docs/superpowers/specs/2026-10-01-admin-cms-design.md` — mục 14.1 dòng 2 (đợt 2); chi tiết ở 5.1, 5.2 "Nền tảng (đợt 2)", 6.1–6.5, 12, 13.

**Căn cứ đã kiểm chứng:**
- `docs/superpowers/research/2026-10-01-phase-2-spikes/00-plan-outline.md` (dàn ý của lead, các kiểm chứng V1–V3) và năm báo cáo spike cùng thư mục.
- Mọi khối code dưới đây lấy từ các bản sao spike đã chạy (`spike-cc`, `lead-verify`, `lead-t9`, `spike-proxy`, `spike-data`, `spike-visual` trong `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/`). Chỗ nào dàn ý ghi "unverified", hoặc là code mới, thì đã được chạy thử theo đúng thứ tự Task 1→10 trong bản sao `scratchpad/plan-verify`: mỗi task xanh typecheck, lint, unit + tích hợp, build, E2E và visual ở ngưỡng 0. Riêng visual được so với baseline chụp từ code trước đợt 2. Các bước kiểm chứng vẫn được giữ trong từng task.

## Global Constraints

**An toàn dữ liệu — đọc trước mọi lệnh:**
- `.env.local` đang trỏ vào **DB Neon dùng chung với production** (chưa có branch `dev`).
- **Không bao giờ chạy** `npm run db:migrate`, `npm run db:psql`, `npm run dev`, `vercel env pull`.
- **Không bao giờ chạy `npm run test:e2e` hay `npx playwright test` (cấu hình chính) khi thiếu tiền tố env cục bộ bên dưới, kể cả lần chạy có `E2E_BASE_URL`.**
  - Thiếu cả `CI` lẫn `E2E_BASE_URL`, cấu hình Playwright hiện tại tự bật `next dev`, mà `next dev` đọc `.env.local`.
  - Từ Task 8 Bước 5, `playwright.config.ts` ném lỗi thay vì bật `next dev`. Trước đó chỉ có tiền tố bảo vệ.
- `next dev` chỉ được chạy dưới dạng `npx next dev -p <cổng>` kèm tiền tố env cục bộ (không có `CI=1`). Task 8 và Task 11 cần nó để tìm lỗi hydration chỉ có ở dev.
- Mọi lần build, `next start`, E2E và visual đều dùng **tiền tố env cục bộ** dưới đây. Biến env của tiến trình thắng `.env.local`.
  - Bốn biến `PG*` phải để trống. Next nạp `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` từ `.env.local` vào `process.env`, và `pg` dùng chúng cho phần còn thiếu của URL. Đã kiểm bằng `@next/env` `loadEnvConfig`: để trống thì `pg` lấy user của hệ điều hành.

  ```bash
  CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test
  ```

- Chỉ được tạo, xóa hoặc ghi các DB cục bộ sau:
  - `furama_cuisine_test` (tích hợp);
  - `furama_cuisine_migrate_test` và `furama_cuisine_migrate004_test` (test migration tự tạo);
  - `furama_cuisine_e2e_test` (build, E2E, visual).

  Tạo lại bằng `RESET_DATABASE_URL=postgres://localhost:5432/<tên> node scripts/reset-db.mjs`. Script này từ chối host khác `localhost` và tên không kết thúc bằng `_test`/`_ci`. Không đụng DB nào khác trên server cục bộ.
- Test tích hợp: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test`.
- Kế hoạch này **không chạy migration 004 lên Neon**. Task 11 chỉ ghi chú việc đó vào README.

**Git:**
- Làm thẳng trên `main`, không tạo branch. Mỗi task một commit.
- Không push.
- `git add` từng file cụ thể, không dùng `git add -A`.
- Hai mục đang untracked và không thuộc các commit này: chính file kế hoạch này (`docs/superpowers/plans/2026-10-01-phase-2-guest-restructure.md`) và thư mục `docs/superpowers/research/2026-10-01-phase-2-spikes/`.
- Mọi commit message kết thúc bằng dòng:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

**Next 16 và TypeScript 7:**
- Next.js 16.3.7 có thay đổi phá vỡ. Đọc tài liệu trong `node_modules/next/dist/docs/` trước khi dùng API Next (theo `AGENTS.md`). Kế hoạch trích dẫn theo dạng `file.md:dòng`.
- `next/root-params` `lang()` chỉ dùng được trong Server Component. Server Action và Route Handler nhận locale tường minh. `app/actions.ts` giữ nguyên vị trí và vẫn gọi `listRestaurants()` không cache.
- **Không dùng các kiểu global sinh tự động `LayoutProps<…>`/`PageProps<…>`.** Chúng chỉ có sau khi build. CI chạy `typecheck` trước `build` trên checkout sạch, nên props được khai báo tường minh (ví dụ `{ params: Promise<{ lang: string; slug: string }> }`).
- **Thứ tự lệnh kiểm tra trong mọi task:**
  1. `npm run lint`
  2. unit + tích hợp
  3. reset DB E2E
  4. build
  5. `npm run typecheck` — chạy **sau** build, vì build sinh lại `.next/types` và `next-env.d.ts`
  6. (từ Task 8) `node scripts/check-prerender.mjs`
  7. E2E
  8. visual
- **Task 9 xóa `.next` trước khi build.** `.next/types` và `.next/dev/types` còn trỏ tới các file route cũ, và cả `tsc` lẫn `next build` đều đọc chúng.
- Lint thoát 0. Hiện có 20 cảnh báo cũ, không thêm lỗi mới.
- Comment trong code viết bằng tiếng Anh, giải thích "vì sao", giọng như code hiện có.

**Locale, proxy, cache (giá trị chính xác):**
- `DEFAULT_LOCALE = 'en'`, `LOCALE_COOKIE = 'NEXT_LOCALE'`. `ENABLED_LOCALES = ['en']` là hằng của proxy trong đợt 2; từ Task 10, guard đọc bảng `locales`.
- Regex mã ngôn ngữ (CHECK trong DB, `LOCALE_CODE_RE`, hình dạng trong matcher): `^[a-z]{2,3}(-[a-z0-9]{2,8})*$`.
- Matcher, giữ đúng từng ký tự:
  `matcher: ['/admin/:path*', '/((?!api(?:/|$)|_next(?:/|$)|admin(?:/|$)|[a-z]{2,3}(?:-[a-z0-9]{2,8})*(?:/|$)|.*\\..*).*)']`
- Proxy trả 307 kèm `Vary: Cookie, Accept-Language` và giữ query.
- `/taya-house` chuyển hướng bằng `next.config` `redirects()`: `{ source: '/taya-house', destination: '/en/restaurants/taya-house', permanent: true }` → 308, giữ query (redirects.md:43). Rule này chạy trước proxy (proxy.md, phần "Execution order").
- Tag cache: `lib/cache-tags.ts` khai báo đủ danh sách tag của spec §6.2. Đợt 2 chỉ gắn bốn tag: `restaurants`, `i18n:<code>`, `locales`, `content:ui`.
- `cacheLife('max')` → revalidate 2592000 giây, expire 31536000 giây.
- Hàm `'use cache'` (`lib/server/content/{restaurants,locales,strings}.ts`) **không bao giờ được Vitest import**, vì `cacheTag()` ném lỗi ngoài Next. Logic nằm trong `*.queries.ts` không cache và trong các hàm thuần.

**Dữ liệu seed (migration 004):**
- Seed locale:
  - `('en','en','English','EN','latin', is_default=true, is_enabled=true, 10)`
  - `('vi','vi','Tiếng Việt','VI','vietnamese', false, false, 20)`
- Seed destinations:

  | id | kind | phone_e164 | phone_display | map_url | show_in_footer | sort_order |
  |---|---|---|---|---|---|---|
  | `resort` | venue | `+842366519999` | `+84 236 651 9999` | `https://maps.google.com/?q=Furama+Resort+Danang` | true | 10 |
  | `dining-house` | venue | `+84859555759` | `0859 555 759` | NULL | true | 20 |
  | `mm` | venue | NULL | NULL | NULL | false | 30 |
  | `future` | teaser | NULL | NULL | NULL | false | 40 |

- Regex key nội dung: `^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$`. `CLIENT_KEYS` là 12 key `error.*`.

**Quy tắc code:**
- Component `async` chỉ ném lỗi phải khai báo `: Promise<React.ReactNode>`.
- Prop của error boundary là `retry` (error.md:27-30). Không hiển thị `error.message`, vì ở production nó đã bị rút gọn; dùng `digest`.
- Khoảng cách khi cuộn tới section giữ 75px (desktop) và 63px (dưới 1080px).
- Truy vấn DOM nội dung trang chỉ đi qua `useSite().pageRoot` hoặc `usePageRoot()`. Chỉ `[data-header]` và `animateSelector` (overlay) được tìm trên toàn document. Task 7 thêm test chặn mọi truy vấn toàn document mới.

**Visual:**
- `maxDiffPixelRatio: 0`, không mask (trừ `.hero-slides` ở bản no-JS).
- Desktop 1280×860; phone dùng profile iPhone 13 chạy trên Chromium.
- `reducedMotion: 'reduce'`, đồng hồ cố định `2026-10-05T03:00:00Z`, mock `/api/availability`, `sessionStorage['fc-intro-seen']='1'`, `stylePath: './e2e/visual.css'`.
- `snapshotPathTemplate: '{testDir}/__visual__/{projectName}/{arg}{ext}'`. Baseline chỉ chạy trên macOS và CI bỏ qua chúng.
- **Chỉ Task 1 được chạy `--update-snapshots`.** Từ Task 2 trở đi, visual đỏ thì sửa code: mở `test-results/**/*-diff.png` để xem khác ở đâu. Không bao giờ sửa baseline.
- Visual chạy với `next start` trên một cổng trống trong khoảng 3200–3299, mặc định 3201. Trước khi chạy, kiểm cổng bằng `lsof -nP -iTCP:3201 -sTCP:LISTEN`: lệnh phải không in gì. Xong thì dừng đúng server mình đã bật bằng `lsof -ti tcp:3201 | xargs kill`.
- Bật `next start` dưới nền xong thì đợi cổng nhận kết nối rồi mới chạy test, nếu không Playwright gặp `ECONNREFUSED`:

  ```bash
  for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3201/ && break; sleep 1; done
  ```

  Không dùng `curl -f`, vì từ Task 9 `/` trả 307. Mọi khối lệnh bật server bên dưới đều chép dòng này (đổi cổng nếu cần).
- Số ca visual mong đợi là `8 passed`. Nếu Task 1 Bước 7 phải dùng phương án dự phòng cho ảnh no-JS trên phone, mọi bước visual sau đó mong đợi `6 passed` cộng `2 skipped`.

## Rulings — 13 điểm lệch spec đã được chấp nhận (không báo lại khi review)

Controller đã chấp nhận cả 13 điểm lệch spec trong dàn ý (mục 2). Reviewer không nêu lại chúng như lỗi.

1. **Trang chi tiết `await params` ở đầu trang, không đặt trong `<Suspense>` (lệch §6.4), kèm `export const instant = false`.**
   - Lý do: đặt trong Suspense thì ngay cả slug đã prerender cũng gửi nội dung dưới dạng `<div hidden id="S:0">` cộng script `$RC`. Khi tắt JS, trang chi tiết trắng trơn.
   - Cái giá: slug không có trong `generateStaticParams` (từ đợt 6) sẽ render lúc request ở lần truy cập đầu, không có App Shell.
2. **Root layout không đọc DB; route group `(guarded)` giữ phần kiểm tra ngôn ngữ, đọc DB, `SiteProvider` và `Chrome` (lệch §6.1).**
   - Lý do: `notFound()` trong root layout ra trang 404 trần của Next, bị cache một năm. Lỗi DB trong root layout thì `error.tsx` không bắt được (error.md:96).
3. **Proxy dùng hằng `ENABLED_LOCALES = ['en']` trong đợt 2 (lệch §6.1).**
   - Bản đọc DB kiểu best-effort (TTL 60 giây, timeout ≤ 500 ms) đã kiểm chứng ở `spike-proxy`, nhưng để tới đợt 8.
4. **Matcher của proxy dựa trên hình dạng (lệch §6.1).**
   - Lý do: matcher phải là hằng lúc build (proxy.md:136), nên "đường dẫn có tiền tố ngôn ngữ" được hiểu là "segment đầu có dạng mã ngôn ngữ" `[a-z]{2,3}(-[a-z0-9]{2,8})*`.
   - Hệ quả: một trang cấp cao nhất không tiền tố, dài 2–3 chữ (`/faq`), sẽ không được chuyển hướng. CHECK trong DB giữ mã ngôn ngữ theo đúng regex đó.
5. **`ViewMarker` là wrapper sở hữu `<main data-view>` của trang, không phải thẻ tự đóng (lệch §6.3.8).**
   - `MobileBar` chuyển vào từng trang.
   - Việc ẩn header và thanh đặt bàn trên phone làm bằng CSS `html[data-view]`, có thêm `:has()` cho lần vẽ đầu và cho khách không bật JS.
   - `useScrollMotion` cũng chỉ tìm trong trang đang hiện; spec không nhắc tới nó.
6. **Bỏ hai cấu hình route segment.**
   - Xóa `export const revalidate = 3600` (layout) và `export const dynamic = 'force-dynamic'` (route availability). Cả hai báo lỗi build khi bật Cache Components (migrating-to-cache-components.md:76).
   - Thêm `instant = false` cho trang chi tiết.
7. **Khi DB lỗi, route tĩnh đã hết hạn trả trang 500 dạng chữ thô (lệch §12).**
   - `error.tsx` có số điện thoại chỉ hiện với lần render lúc request, khi có JS.
   - Đợt 2 chưa có chỗ nào làm hết hạn tag, nên khe hở này chưa xảy ra. Nó sẽ cần xem lại ở đợt 3 hoặc 6.
8. **Nhà hàng không có trang chi tiết: lần truy cập đầu là soft 404, các lần sau là 404 đã cache.**
   - Lần đầu trả 200 kèm `noindex`; các lần sau trả 404 lấy từ cache, giữ 30 ngày (loading.md:101-113). Chấp nhận.
9. **Slug ẩm thực được ánh xạ trong lớp đọc dữ liệu, không cần migration (lệch §6.3.2).**
   - Bữa ăn giữ key enum và có thêm bảng hiển thị `MEAL_LABELS`.
   - `site_settings.default_restaurant_id` (§6.3.1) tạm thời là hằng `DEFAULT_RESTAURANT_ID`, truyền vào `SiteProvider` qua prop.
10. **Phần thêm của migration 004 mà spec không ghi.**
    - `restaurants_destination_fk`;
    - CHECK `locales_default_enabled`;
    - partial unique index cho ngôn ngữ mặc định;
    - `card_image_id` chưa có khóa ngoại;
    - `email` và `map_url` của dining-house seed là NULL;
    - giá trị `script` (`latin`, `vietnamese`) là phỏng đoán.
11. **Registry chỉ dùng biến dạng `{name}`, không có thư viện ICU.** Có test cấm cú pháp ICU. Registry chỉ có 12 key `error.*`.
12. **Visual test chỉ chạy cục bộ trên macOS, cấu hình riêng, chỉ EN.**
    - File nằm ở `e2e/__visual__/{projectName}/{arg}{ext}`.
    - Ngôn ngữ dài nhất (§13) để tới đợt 8.
13. **Ngoài phạm vi đợt 2** (không phải lệch spec):
    - nhãn menu và `MENU_LABELS` (§6.3.6);
    - Intl và ICU (§6.3.4);
    - `CmsImage` (§6.3.7);
    - ô tìm kiếm khớp bản dịch (§6.3.9).

    Bộ chọn ngôn ngữ chỉ để trang trí (`lang: 'EN'|'VI'`) giữ nguyên.

**Ghi chú triển khai của kế hoạch này.** Các điểm sau không lệch spec; chúng điều chỉnh code spike cho khớp repo. Mỗi điểm đã chạy thử trong `plan-verify`.
- Props của layout và page khai báo tường minh, không dùng `LayoutProps`/`PageProps` (xem Global Constraints).
- Tiền tố env cục bộ để trống bốn biến `PG*`.
- `e2e/paths.ts` là nơi duy nhất giữ URL của trang khách. Lúc chuyển route, chỉ file này đổi; tên file snapshot giữ nguyên.
- `MobileBar` vào trang ngay từ Task 5, để bỏ được `'taya-house'` trong `components/` mà chưa cần `ViewMarker`.
- `(guarded)/not-found.tsx` bọc trong `<ViewMarker view="other">`. Nhờ vậy header và logo trên trang "không tìm thấy" vẫn đưa khách về trang chủ: nếu không có nó, `view` mặc định là `'home'` và các nút đó không làm gì.
- `app/global-not-found.tsx` nạp font qua `lib/fonts.ts`. Không có font thì trang hiện bằng font Times (V2).
- `scripts/check-prerender.mjs` ra đời ở Task 8, để có test đỏ trước cho Cache Components. Task 9 đổi route trong script; Task 10 thêm tag.
- `playwright.config.ts` nhận thêm `E2E_BASE_URL` để chạy E2E vào một `next dev` đã bật sẵn bằng env cục bộ, khi kiểm lỗi hydration chỉ có ở dev. Cùng lúc đó (Task 8), config ném lỗi khi thiếu cả `CI` lẫn `E2E_BASE_URL`, thay vì tự bật `next dev` đọc `.env.local`.
- Không thêm "timeout an toàn" cho tấm màn chuyển trang. Đường duy nhất có thể để màn không mở lại (điều hướng client tới trang không có `ViewMarker`) đã được `ViewMarker view="other"` ở trang not-found xử lý. Trang lỗi thì unmount luôn cả chrome.

## Review Focus

Năm tình huống mà spec ngụ ý nhưng dễ bị bỏ sót nhất. Mỗi dòng có test gắn vào task sở hữu code.

1. **Link cũ và link đã lưu: `/taya-house`, `/taya-house?utm=…`, `/taya-house/`, `/`, link sâu không có tiền tố.**
   - Khách phải tới đúng trang, giữ query.
   - Không được có chuỗi redirect sai, lẫn 307 với 308, hay vòng lặp proxy.
   - Test: `e2e/routing.spec.ts` kiểm status, `location`, query và dấu `/` cuối (Task 9); `lib/i18n/proxy-matcher.test.ts` kiểm rằng `/en…` không bao giờ đi qua proxy (Task 9).
2. **`Accept-Language: vi`, cookie `NEXT_LOCALE=vi` hoặc gõ thẳng `/vi` khi `vi` đang tắt.**
   - Hai trường hợp đầu phải về `/en`.
   - `/vi` phải là 404 thật, đúng giao diện site, có `noindex`; 404 đó phải mang tag `locales` để khi bật `vi` thì cache bị xóa.
   - Test: `lib/i18n/locales.test.ts` (`pickLocale`, Task 3); `routing.spec.ts` (Task 9: status, `noindex`, chữ `Page not found`, và một lần mở `/vi` trong trình duyệt để kiểm tiêu đề cùng font site); test `vi.meta` mang tag `locales` (Task 10).
3. **Trang bị `<Activity>` giấu đi.** Trang trước vẫn giữ DOM, id trùng và `data-intro-done`.
   - Header DESTINATIONS trên trang chi tiết phải về trang chủ và cuộn tới section.
   - Nút Back phải về `#restaurants`.
   - Hiệu ứng vào trang phải chạy lại ở lần ghé thứ hai.
   - Tấm màn phải phủ rồi mở.
   - Không còn lỗi hydration ở dev do parallax.
   - Test: `e2e/page-scope.spec.ts` gồm 6 ca và chặn lỗi React trên console (Task 7, chạy dưới Activity từ Task 8); test hydration cho cả hai trang (Task 7); `lib/page-scope.guard.test.ts` (Task 7); chạy `page-scope` trên `next dev` (Task 8, 11).
4. **DB sập khi đã bật Cache Components.**
   - Trang đã prerender hoặc đã cache vẫn chạy; `/api/availability` trả 503.
   - Lần render lúc request phải ra `[lang]/error.tsx` có số điện thoại, không phải `__next_error__` trống.
   - Test: kiểm tra có script ở Task 11, bước "DB sập" (công thức V2). Không có test CI, vì đợt 2 chưa có chỗ nào làm hết hạn tag.
5. **Bot, crawler, khách không bật JS.**
   - `/en/restaurants/<bất kỳ>` lần đầu là soft 404 có `noindex`.
   - Khách không có JS vẫn phải thấy đủ nội dung trang chi tiết (lý do của phán quyết 1). Trên phone, header và thanh đặt bàn phải ẩn ngay từ HTML server.
   - Test: `e2e/nojs.spec.ts` (Task 7, chạy trong CI); `routing.spec.ts` kiểm `noindex` (Task 9); `e2e/visual-nojs.spec.ts` so ở ngưỡng 0 (Task 1, chạy cục bộ).

## Rủi ro đã biết

Dàn ý (mục 6) ghi các rủi ro và thay đổi hành vi dưới đây. Controller đã duyệt 13 phán quyết nhưng chưa xem danh sách này, nên mỗi mục ghi một trong hai nhãn:
- **Đã chấp nhận:** hệ quả đã nêu của một phán quyết, hoặc kế hoạch đã có biện pháp cho nó.
- **Cần quyết định:** người dùng chọn chấp nhận, hoặc mở việc ở một đợt sau.

Kế hoạch không thêm task cho các mục này. Task 11 Bước 7 báo lại danh sách cho người dùng.

Thay đổi hành vi nhỏ (do `<Activity>` giữ trang cũ trong document):
1. **Cần quyết định.** Hiệu ứng hiện dần khi cuộn (`useReveal`) không chạy lại khi quay về một trang đang được giữ; phần đã hiện thì vẫn hiện. Hiệu ứng vào trang vẫn chạy lại (Review Focus 3).
2. **Cần quyết định.** Bộ lọc của Finder giữ nguyên lựa chọn khi khách sang trang chi tiết rồi quay lại.
3. **Cần quyết định.** `useIntro` chạy lại khi khách bật hoặc tắt chế độ giảm chuyển động của hệ điều hành.

Hiển thị:

4. **Cần quyết định.** Safari dưới 15.4 không có `:has()`. Trên phone, header và thanh đặt bàn của trang chi tiết hiện thoáng qua cho tới khi hydrate. Phán quyết 5 chọn cách ẩn bằng CSS nhưng không nêu cái giá này.
5. **Cần quyết định.** 404 của ngôn ngữ đang tắt (`/vi`, `/fr`, `/zz/restaurants/taya-house`): HTML server là khung `<html id="__next_error__">`, còn trang 404 đúng giao diện nằm trong RSC payload và chỉ hiện khi có JS.
   - Khách và bot không bật JS thấy trang trống, nhưng vẫn nhận status 404 và `noindex`.
   - Ca trình duyệt trong `routing.spec.ts` (Task 9) chỉ kiểm phần có JS.
   - Dàn ý chỉ ghi `/fr`. Lúc review kế hoạch, bản build Task 10 cho thấy `/vi` cũng vậy, kể cả bản 404 đã cache (`x-nextjs-cache: HIT`).
6. **Cần quyết định.** `<html lang>` của các trang 404 đó theo mã trong URL (`lang="vi"`, `lang="zz"`), dù nội dung là tiếng Anh. Xem chỗ khác V2 thứ tư ở đầu Task 9.
7. **Cần quyết định.** `/zz/restaurants/taya-house` trả 404 nhưng mang metadata của Tàya House, vì `generateMetadata` chạy trước guard.

Cache và dữ liệu:

8. **Cần quyết định.** Mỗi URL `/en/restaurants/<bất kỳ>` thêm một mục ISR: soft 404, rồi 404 đã cache 30 ngày (phán quyết 8). Bot dò URL ngẫu nhiên sẽ làm cache phình ra.
9. **Cần quyết định.** `cuisineSlug` ném lỗi khi gặp nhãn ẩm thực lạ trong DB. Một hàng sửa tay sẽ làm build hỏng, hoặc giữ trang cũ sau một lần làm mới `'max'`. Test tích hợp chỉ bảo vệ dữ liệu seed.
10. **Đã chấp nhận (phán quyết 1).** App Shell rỗng: shell `[lang]` và fallback `[slug]` dài 0 byte, vì `await lang()` và `await params` chạy ngoài Suspense. Ngôn ngữ hoặc slug bật sau lúc build sẽ render lúc request ở lần truy cập đầu (ảnh hưởng đợt 6 và 8).
11. **Đã chấp nhận (phán quyết 4).** Một trang cấp cao nhất không tiền tố, dài 2–3 chữ (`/faq`), không đi qua proxy và trả 404. Test matcher ở Task 9 ghi rõ giới hạn này.
12. **Đã chấp nhận (phán quyết 7).** Khi DB sập, route tĩnh đã hết hạn trả 500 dạng chữ thô. Đợt 2 chưa có chỗ nào làm hết hạn tag.

Môi trường và kiểm thử:

13. **Cần quyết định sau bản preview đầu tiên.** Mọi kiểm chứng chạy trên `next start` tự host.
    - Trên Vercel, mục cache `'use cache'` lúc runtime chỉ nằm trong bộ nhớ của từng instance (use-cache.md:251).
    - Cách CDN xử lý trang có tag, 404 đã cache và trang 500 thô thì chưa được kiểm.
14. **Đã chấp nhận (biện pháp: README ở Task 11).** Build cần migration 004 (Task 10). Build production hay preview sẽ hỏng cho tới khi branch Neon đích có 004. Hỏng như vậy là an toàn, vì bản deploy cũ vẫn chạy; README (Task 11) ghi "migrate trước khi deploy".
15. **Đã chấp nhận (quy tắc vận hành).** Mỗi lần nâng Next phải chạy lại visual, no-JS và `page-scope`. Ở 16.3.7, `usePathname` dưới một param lạ âm thầm tạo khung rỗng thay vì làm hỏng build.
16. **Cần quyết định, chỉ khi xảy ra.** Nếu Task 1 Bước 7 phải dùng phương án dự phòng, ảnh no-JS trên phone không còn được so pixel. Khi đó chỉ còn `e2e/nojs.spec.ts` kiểm các phần tử bị ẩn, nên tiêu chí "`/en` giống hệt" (§14.1) yếu đi cho khách phone không bật JS.

---

## Sơ đồ file

| File | Trách nhiệm | Task |
|---|---|---|
| `playwright.visual.config.ts`, `e2e/visual.spec.ts`, `e2e/visual-nojs.spec.ts`, `e2e/visual.css`, `e2e/__visual__/**` | Chụp và so ảnh trang khách ở ngưỡng 0 (chỉ chạy cục bộ) | 1 |
| `e2e/paths.ts` | URL của trang chủ và trang chi tiết cho mọi spec | 1, 9 |
| `playwright.config.ts` | Bỏ qua visual spec; thêm `E2E_BASE_URL`; từ chối tự bật `next dev` | 1, 8 |
| `db/migrations/004_foundations_locales_strings_destinations.sql`, `test/integration/migration-004.test.ts` | Bảng `locales`, `content_strings`, `destinations` | 2 |
| `lib/cache-tags.ts` | Tên tag cache | 3 |
| `lib/i18n/registry.ts`, `format.ts`, `resolve.ts` | Danh sách chuỗi, điền `{name}`, chọn bản hiển thị | 3 |
| `lib/i18n/locales.ts` | Hằng locale, `pickLocale`, `toBcp47`, `LOCALE_CODE_RE` | 3 |
| `lib/i18n/href.ts` | URL nội bộ có tiền tố ngôn ngữ | 3 |
| `lib/booking-errors.ts` | Câu lỗi đặt bàn lấy từ registry | 3 |
| `lib/server/content/locales.queries.ts`, `strings.queries.ts` | Hàm đọc DB không cache (Vitest test được) | 4 |
| `lib/data.ts` | `slug`, `hasDetailPage`, `DETAIL_PAGE_IDS`, `DEFAULT_RESTAURANT_ID`, `cuisineSlug`/`cuisineLabel`, `MEAL_LABELS`, `contactFor`, `DETAIL_SEO` | 5, 9 |
| `db/queries.ts` | `listRestaurants` điền slug và ánh xạ ẩm thực | 5 |
| `components/**` (Cuisines, Finder, Restaurants, SearchOverlay, BookingBar, ReserveDrawer, RestaurantCard, MoreRestaurants, TayaHero, MobileBar, Chrome) | Lọc theo key, bỏ code riêng cho Tàya | 5 |
| `lib/journey.ts`, `components/home/Hero.tsx`, `components/home/Destinations.tsx`, `styles/home.css` | Slide và chấm hành trình theo số lượng | 6 |
| `components/site/ViewMarker.tsx`, `SiteProvider.tsx`, `PageCurtain.tsx`, `IntroTrigger.tsx`, `Header.tsx`, `lib/motion.tsx`, `styles/{booking,layout}.css` | Trang tự đăng ký; truy vấn DOM trong trang | 7 |
| `e2e/page-scope.spec.ts`, `e2e/nojs.spec.ts`, `lib/page-scope.guard.test.ts` | Ghim hành vi khi có Activity và khi không có JS | 7 |
| `next.config.ts`, `lib/server/content/restaurants.ts`, `app/global-error.tsx`, `scripts/check-prerender.mjs`, `.github/workflows/ci.yml` | Cache Components | 8, 9, 10 |
| `app/(site)/[lang]/layout.tsx`, `(guarded)/layout.tsx`, `(guarded)/page.tsx`, `(guarded)/restaurants/[slug]/page.tsx`, `[lang]/{not-found,error}.tsx`, `(guarded)/not-found.tsx`, `app/global-not-found.tsx`, `lib/fonts.ts` | Cây route mới | 9 |
| `proxy.ts`, `lib/i18n/proxy-matcher.test.ts`, `e2e/routing.spec.ts` | Chuyển hướng theo ngôn ngữ | 9 |
| `lib/server/content/locales.ts`, `strings.ts` | Hàm đọc `'use cache'` cho locale và chuỗi | 10 |
| `README.md` | Ghi chú triển khai: migrate 004 trước khi deploy | 11 |

---

### Task 1: Chụp baseline của trang hôm nay (không đổi code app)

Task này phải là commit đầu tiên của đợt 2: nó chốt `/` và `/taya-house` trước khi bất cứ thứ gì dịch chuyển. Rig lấy từ `spike-visual`, chỉ đổi `maxDiffPixelRatio` từ `0.002` thành `0`. Ở mức 0, lead đã chạy 3/3 lần xanh mà không cần mask (V1). Bản no-JS lấy từ `spike-cc-out/visual/nojs.spec.ts`; bản này giữ mask `.hero-slides`, đúng như biến thể đã kiểm chứng.

**Files:**
- Create:
  - `e2e/paths.ts`
  - `playwright.visual.config.ts`
  - `e2e/visual.css`
  - `e2e/visual.spec.ts`
  - `e2e/visual-nojs.spec.ts`
  - `e2e/__visual__/desktop/{home,taya-house,nojs-home,nojs-taya-house}.png`
  - `e2e/__visual__/phone/{home,taya-house,nojs-home,nojs-taya-house}.png`
- Modify: `playwright.config.ts`, `package.json`

**Interfaces:**
- Consumes: không có.
- Produces:
  - `e2e/paths.ts` export `HOME_PATH: string`, `DETAIL_PATH: string` và `PAGES: { home: string; 'taya-house': string }`. Mọi spec sau này đọc URL từ đây. Task 9 chỉ đổi hai hằng này.
  - `npm run test:visual` chạy `playwright test -c playwright.visual.config.ts` vào một server có sẵn ở `VISUAL_BASE_URL`. Mặc định là `http://localhost:3100`.
  - Tám baseline trong `e2e/__visual__/{desktop,phone}/`. Từ giờ không ai được cập nhật chúng nữa.
  - `playwright.config.ts` bỏ qua mọi file `visual*.spec.ts`, nên `npm run test:e2e` và CI không chạy chúng.

- [ ] **Bước 1: Tạo `e2e/paths.ts`**

```ts
/**
 * Where the guest pages live. The phase-2 route move edits only this file:
 * every spec and the visual baselines read their URLs from here.
 */
export const HOME_PATH = '/';
export const DETAIL_PATH = '/taya-house';

/** Logical page -> URL. Snapshot names come from the key, never the URL. */
export const PAGES = {
  home: HOME_PATH,
  'taya-house': DETAIL_PATH,
} as const;
```

- [ ] **Bước 2: Tạo cấu hình và hai spec chụp ảnh**

Create `playwright.visual.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

/**
 * Visual-regression project. Runs against an already-running production build
 * (`next build && next start -p $PORT`), never `next dev` (dev overlay/indicators).
 * Local only: baselines are macOS renderings. See e2e/visual.spec.ts.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /\/visual[^/]*\.spec\.ts$/,
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
  // No OS suffix and no URL in the file name: files are named by logical page.
  snapshotPathTemplate: '{testDir}/__visual__/{projectName}/{arg}{ext}',
  expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0 } },
  use: { baseURL: process.env.VISUAL_BASE_URL ?? 'http://localhost:3100' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } },
    { name: 'phone', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
});
```

Create `e2e/visual.css`:

```css
/* Injected by toHaveScreenshot: freeze everything that moves on its own. */
*, *::before, *::after {
  transition: none !important;
  animation: none !important;
  scroll-behavior: auto !important;
  caret-color: transparent !important;
}
/* Hero Ken Burns: the 7s transition races the capture; pin the end state. */
.hero-slide-zoom { transform: scale(1) !important; }
/* Scroll-linked parallax is rAF-driven and lags the scroll back to 0; at scrollY=0 its true offset is none. */
[data-parallax] { transform: none !important; translate: none !important; }
```

Create `e2e/visual.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { PAGES } from './paths';

/**
 * Full-page screenshots of every guest page, compared pixel for pixel with the
 * baselines in e2e/__visual__/ (taken from the code before phase 2).
 * VISUAL_SUFFIX lets a run hit the same page under a different URL (used to
 * prove the comparison works across URLs: VISUAL_SUFFIX='?x=1').
 */
const SUFFIX = process.env.VISUAL_SUFFIX ?? '';

const FIXED_NOW = new Date('2026-10-05T03:00:00Z'); // 10:00 in Da Nang

async function prepare(page: Page) {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  await page.emulateMedia({ reducedMotion: 'reduce' }); // data-motion="off": no reveals, no hero timer
  await page.route('**/api/availability**', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      json: {
        today: '2026-10-05',
        now: FIXED_NOW.toISOString(),
        date: url.searchParams.get('date') ?? '2026-10-05',
        booked: {},
        capacity: {},
      },
    });
  });
}

async function settle(page: Page) {
  // Walk the page so every next/image lazy-loads, then return to the top.
  // behavior:'instant' because the site sets scroll-behavior: smooth.
  await page.evaluate(async () => {
    const height = document.documentElement.scrollHeight;
    const step = Math.max(window.innerHeight / 2, 300);
    for (let y = 0; y < height; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 80));
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    // let scroll-driven effects (header state, parallax) run their rAF before the shot
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  // Only images that are on-canvas count: carousel items scrolled out of view
  // horizontally and inactive hero slides stay lazy forever and are not in the shot.
  await page.waitForFunction(() =>
    [...document.images]
      .filter((i) => {
        const r = i.getBoundingClientRect();
        return r.width > 0 && r.right > 0 && r.left < window.innerWidth;
      })
      .every((i) => i.complete && i.naturalWidth > 0),
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
}

for (const [name, path] of Object.entries(PAGES)) {
  test(`@visual ${name}`, async ({ page }) => {
    await prepare(page);
    await page.goto(path + SUFFIX);
    await settle(page);
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true, stylePath: './e2e/visual.css' });
  });
}
```

Create `e2e/visual-nojs.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { PAGES } from './paths';

/**
 * The same pages with JavaScript off: what a crawler or a visitor without JS
 * gets from the server HTML alone. The hero slides are masked because their
 * CSS crossfade is not frozen without the page's scripts.
 */
test.use({ javaScriptEnabled: false, reducedMotion: 'reduce' });

for (const [name, path] of Object.entries(PAGES)) {
  test(`@visual no-JS ${name}`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot(`nojs-${name}.png`, {
      fullPage: true,
      mask: [page.locator('.hero-slides')],
    });
  });
}
```

- [ ] **Bước 3: Cho bộ E2E chính bỏ qua visual spec, và thêm script**

Trong `playwright.config.ts`, ngay dưới dòng `  testDir: './e2e',`, thêm:

```ts
  // Screenshot comparisons run separately (npm run test:visual): their baselines are macOS renderings.
  testIgnore: /\/visual[^/]*\.spec\.ts$/,
```

Trong `package.json`, ngay dưới dòng `"test:e2e": "playwright test",`, thêm:

```json
    "test:visual": "playwright test -c playwright.visual.config.ts",
```

- [ ] **Bước 4: Build code hiện tại trên DB cục bộ rồi chạy `next start`**

```bash
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
lsof -nP -iTCP:3201 -sTCP:LISTEN
```

Expected:
- `reset-db` in ra `Applied 3 migration(s).`
- Build có bảng route `○ / 1h 1y` và `○ /taya-house 1h 1y`.
- `lsof` không in gì. Nếu cổng 3201 bận, chọn một cổng trống khác trong 3200–3299 và dùng nó ở mọi lệnh bên dưới.

Chạy server dưới nền (giữ nó chạy cho Bước 5–8):

```bash
PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npx next start -p 3201
```

Đợi server nhận kết nối rồi mới sang Bước 5:

```bash
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3201/ && break; sleep 1; done
```

Nếu Playwright báo thiếu trình duyệt, chạy `npx playwright install chromium` một lần.

- [ ] **Bước 5: Chạy visual khi chưa có baseline**

Run: `VISUAL_BASE_URL=http://localhost:3201 npm run test:visual`

Expected: FAIL `8 failed`. Mỗi ca báo `A snapshot doesn't exist at …/e2e/__visual__/<desktop|phone>/<tên>.png, writing actual.`

- [ ] **Bước 6: Ghi baseline đúng một lần**

Run: `VISUAL_BASE_URL=http://localhost:3201 npm run test:visual -- --update-snapshots`

Expected: `8 passed`. Thư mục `e2e/__visual__/desktop/` và `e2e/__visual__/phone/` mỗi nơi có `home.png`, `taya-house.png`, `nojs-home.png`, `nojs-taya-house.png`, tổng khoảng 13 MB (`du -sh e2e/__visual__`).

- [ ] **Bước 7: Ba lần kiểm độ ổn định ở ngưỡng 0**

```bash
for i in 1 2 3; do VISUAL_BASE_URL=http://localhost:3201 npm run test:visual 2>&1 | grep -E "passed|failed|flaky|skipped"; done
```

Expected: ba dòng `8 passed`.

Nếu có lần nào đỏ:
- Mở `test-results/**/*-diff.png` để xem chỗ khác.
- Chỉ ảnh no-JS trên phone (`[phone] … no-JS`) đỏ, vì profile iPhone 13 chưa được spike kiểm khi tắt JS:
  1. Thêm `test.skip(test.info().project.name === 'phone', 'no-JS phone shots are not stable');` làm dòng đầu trong thân test của `e2e/visual-nojs.spec.ts`.
  2. Xóa `e2e/__visual__/phone/nojs-*.png`.
  3. Chạy lại Bước 7. Giờ mỗi lần in hai dòng `2 skipped` và `6 passed`.
  4. Từ đây, mọi bước visual của Task 5–11 mong đợi `6 passed` cộng `2 skipped` thay cho `8 passed`.
  5. Ghi lý do vào commit message, và báo lại ở Task 11 Bước 7 (mục 16 của "Rủi ro đã biết"): ảnh no-JS trên phone không còn được so pixel, chỉ còn `e2e/nojs.spec.ts` (Task 7) kiểm các phần tử bị ẩn trong CI.
- Ảnh khác đỏ: dừng và báo lại, không hạ ngưỡng.

- [ ] **Bước 8: Đối chứng âm (rig phải bắt được khác biệt)**

Trong `e2e/paths.ts`, tạm đổi `export const HOME_PATH = '/';` thành `export const HOME_PATH = '/taya-house';`.

Run: `VISUAL_BASE_URL=http://localhost:3201 npx playwright test -c playwright.visual.config.ts -g "@visual home" --project desktop`

Expected: FAIL `Expected an image 1280px by 5560px, received 1280px by 2508px. … pixels (ratio 0.51 of all image pixels) are different.`

Đổi dòng đó lại thành `export const HOME_PATH = '/';` rồi kiểm tra: `grep -n "HOME_PATH = '/';" e2e/paths.ts` phải in ra đúng một dòng. **Không** chạy `--update-snapshots` ở bước này.

Dừng server: `lsof -ti tcp:3201 | xargs kill`

- [ ] **Bước 9: Chạy toàn bộ kiểm tra**

```bash
npm run lint
TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test
npm run typecheck
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run test:e2e
```

Expected:
- lint thoát 0;
- `Tests  68 passed (68)` trong 11 file;
- typecheck không in lỗi;
- E2E `7 passed`. Visual spec không xuất hiện trong danh sách.

- [ ] **Bước 10: Commit**

```bash
git add e2e/paths.ts e2e/visual.css e2e/visual.spec.ts e2e/visual-nojs.spec.ts e2e/__visual__ playwright.visual.config.ts playwright.config.ts package.json
git commit -m "$(cat <<'EOF'
test: freeze the guest pages in pixel-exact screenshots before phase 2

Full-page shots of / and /taya-house on desktop and phone, with and without
JavaScript, compared at maxDiffPixelRatio 0. Snapshot names come from the
page key in e2e/paths.ts, so the phase-2 route move only edits that file and
a passing run means /en looks exactly like today's /. The baselines are macOS
renderings, so they run locally (npm run test:visual) and CI skips them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Migration 004 — `locales`, `content_strings`, `destinations`

**Files:**
- Create: `db/migrations/004_foundations_locales_strings_destinations.sql`, `test/integration/migration-004.test.ts`

**Interfaces:**
- Consumes: `resetDatabase`, `migrate`, `withClient`, `databaseUrl`, `TEST_DATABASE_URL` từ `test/helpers/db.ts` (đã có).
- Produces:
  - Bảng `locales(code PK, bcp47, native_name, short_label, script, is_default, is_enabled, serve_machine, sort_order, created_at, updated_at, updated_by)`.
  - Bảng `content_strings(key, locale → locales.code, value, status, origin, ai_model, source_hash, reviewed_by, reviewed_at, updated_at, updated_by)` có PK `(key, locale)`.
  - Bảng `destinations(id PK, kind, card_image_id, phone_e164, phone_display, email, map_url, show_in_footer, sort_order, is_published, created_at, updated_at, updated_by)`.
  - Ràng buộc `restaurants_destination_fk`.

- [ ] **Bước 1: Viết test migration**

Create `test/integration/migration-004.test.ts`. Test dùng DB riêng `furama_cuisine_migrate004_test`, vì test 003 đã dùng `furama_cuisine_migrate_test`.

```ts
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, databaseUrl, migrate, resetDatabase, withClient } from '../helpers/db';

const url = databaseUrl('furama_cuisine_migrate004_test');
const sql = (text: string, values: unknown[] = []) => withClient(url, (c) => c.query(text, values));

describe.skipIf(!TEST_DATABASE_URL)('migration 004: locales, content_strings, destinations (database)', () => {
  beforeAll(() => resetDatabase(url));

  it('seeds en (default, enabled) and vi (disabled)', async () => {
    const { rows } = await sql(
      'SELECT code, bcp47, is_default, is_enabled, serve_machine FROM locales ORDER BY sort_order',
    );
    expect(rows).toEqual([
      { code: 'en', bcp47: 'en', is_default: true, is_enabled: true, serve_machine: false },
      { code: 'vi', bcp47: 'vi', is_default: false, is_enabled: false, serve_machine: false },
    ]);
  });

  it('seeds the four destinations from lib/data.ts and starts content_strings empty', async () => {
    const { rows } = await sql(
      'SELECT id, kind, phone_e164, phone_display, show_in_footer FROM destinations ORDER BY sort_order',
    );
    expect(rows).toEqual([
      { id: 'resort', kind: 'venue', phone_e164: '+842366519999', phone_display: '+84 236 651 9999', show_in_footer: true },
      { id: 'dining-house', kind: 'venue', phone_e164: '+84859555759', phone_display: '0859 555 759', show_in_footer: true },
      { id: 'mm', kind: 'venue', phone_e164: null, phone_display: null, show_in_footer: false },
      { id: 'future', kind: 'teaser', phone_e164: null, phone_display: null, show_in_footer: false },
    ]);
    expect((await sql('SELECT count(*)::int AS n FROM content_strings')).rows[0].n).toBe(0);
  });

  it('every seeded restaurant points at a destination', async () => {
    const { rows } = await sql(
      `SELECT count(*)::int AS n FROM restaurants r LEFT JOIN destinations d ON d.id = r.destination WHERE d.id IS NULL`,
    );
    expect(rows[0].n).toBe(0);
    await expect(sql(`UPDATE restaurants SET destination = 'nowhere' WHERE id = 'taya-house'`)).rejects.toThrow(
      /restaurants_destination_fk/,
    );
  });

  it('allows only one default language', async () => {
    await expect(sql(`UPDATE locales SET is_default = true, is_enabled = true WHERE code = 'vi'`)).rejects.toThrow(
      /locales_single_default_idx/,
    );
  });

  it('never lets the default language be disabled', async () => {
    await expect(sql(`UPDATE locales SET is_enabled = false WHERE code = 'en'`)).rejects.toThrow(
      /locales_default_enabled/,
    );
  });

  it.each(['EN', 'e', 'zh_hans', 'zh-', '-en', 'en us', ''])('rejects the locale code %j', async (code) => {
    await expect(
      sql(`INSERT INTO locales (code, bcp47, native_name, short_label, script) VALUES ($1, 'en', 'x', 'X', 'latin')`, [code]),
    ).rejects.toThrow(/locales_code_check/);
  });

  it('accepts zh-hans and ko', async () => {
    await sql(
      `INSERT INTO locales (code, bcp47, native_name, short_label, script, sort_order)
       VALUES ('zh-hans', 'zh-Hans', '简体中文', '中文', 'han-sc', 30), ('ko', 'ko', '한국어', 'KO', 'hangul', 40)`,
    );
    expect((await sql('SELECT count(*)::int AS n FROM locales')).rows[0].n).toBe(4);
  });

  it('rejects malformed content keys, statuses and origins', async () => {
    const insert = (key: string, status = 'reviewed', origin = 'human') =>
      sql(`INSERT INTO content_strings (key, locale, value, status, origin) VALUES ($1, 'en', 'v', $2, $3)`, [
        key,
        status,
        origin,
      ]);
    await expect(insert('NoDots')).rejects.toThrow(/content_strings_key_check/);
    await expect(insert('Upper.case')).rejects.toThrow(/content_strings_key_check/);
    await expect(insert('error.full', 'draft')).rejects.toThrow(/content_strings_status_check/);
    await expect(insert('error.full', 'reviewed', 'robot')).rejects.toThrow(/content_strings_origin_check/);
    await insert('error.full');
  });

  it('rejects a row for an unknown locale, and keys are unique per locale', async () => {
    await expect(sql(`INSERT INTO content_strings (key, locale, value) VALUES ('error.full', 'xx', 'v')`)).rejects.toThrow(
      /content_strings_locale_fkey/,
    );
    await expect(sql(`INSERT INTO content_strings (key, locale, value) VALUES ('error.full', 'en', 'dup')`)).rejects.toThrow(
      /content_strings_pkey/,
    );
  });

  it('cascades a renamed or deleted locale into its strings', async () => {
    await sql(`INSERT INTO content_strings (key, locale, value) VALUES ('error.full', 'ko', '가득')`);
    await sql(`UPDATE locales SET code = 'kr', bcp47 = 'ko' WHERE code = 'ko'`);
    expect((await sql(`SELECT value FROM content_strings WHERE locale = 'kr'`)).rows).toEqual([{ value: '가득' }]);
    await sql(`DELETE FROM locales WHERE code = 'kr'`);
    expect((await sql(`SELECT count(*)::int AS n FROM content_strings WHERE locale = 'kr'`)).rows[0].n).toBe(0);
    // the English row is untouched
    expect((await sql(`SELECT count(*)::int AS n FROM content_strings WHERE locale = 'en'`)).rows[0].n).toBe(1);
  });

  it('checks destination ids, kinds, phones and the map URL', async () => {
    const insert = (cols: string, vals: string) => sql(`INSERT INTO destinations (id, kind${cols}) VALUES ${vals}`);
    await expect(insert('', `('Bad Id', 'venue')`)).rejects.toThrow(/destinations_id_check/);
    await expect(insert('', `('x1', 'hotel')`)).rejects.toThrow(/destinations_kind_check/);
    await expect(insert(', phone_e164, phone_display', `('x2', 'venue', '0905', '0905')`)).rejects.toThrow(
      /destinations_phone_e164_check/,
    );
    await expect(insert(', phone_e164', `('x3', 'venue', '+84905000000')`)).rejects.toThrow(/destinations_phone_pair/);
    await expect(insert(', map_url', `('x4', 'venue', 'http://maps.example')`)).rejects.toThrow(
      /destinations_map_url_check/,
    );
  });

  it('is safe to apply again: nothing is duplicated and an editor’s change survives', async () => {
    await sql(`UPDATE destinations SET phone_display = '+84 236 651 9999 (edited)' WHERE id = 'resort'`);
    await sql(readFileSync('db/migrations/004_foundations_locales_strings_destinations.sql', 'utf8'));
    expect((await sql('SELECT count(*)::int AS n FROM destinations')).rows[0].n).toBe(4);
    expect((await sql('SELECT count(*)::int AS n FROM locales WHERE code IN (\'en\',\'vi\')')).rows[0].n).toBe(2);
    expect((await sql(`SELECT phone_display FROM destinations WHERE id = 'resort'`)).rows[0].phone_display).toBe(
      '+84 236 651 9999 (edited)',
    );
  });

  it('applies on top of a database that already has bookings', async () => {
    resetDatabase(url, '003_reservations_phone_e164.sql');
    await sql(
      `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164)
       VALUES ('FC-99999', 'taya-house', '2026-10-05', '19:00', 2, 'Guest', '0905 000 000', '+84905000000')`,
    );
    migrate(url);
    expect((await sql(`SELECT count(*)::int AS n FROM reservations WHERE reference = 'FC-99999'`)).rows[0].n).toBe(1);
    expect((await sql('SELECT count(*)::int AS n FROM destinations')).rows[0].n).toBe(4);
  });
});
```

- [ ] **Bước 2: Chạy để thấy lỗi**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/migration-004.test.ts`

Expected: FAIL `Tests  19 failed (19)`, với lỗi như `error: relation "locales" does not exist` và `relation "destinations" does not exist`.

- [ ] **Bước 3: Viết migration**

Create `db/migrations/004_foundations_locales_strings_destinations.sql`:

```sql
-- Phase 2 foundations shared by the booking and content branches
-- (spec §5.1, §5.2 "Nền tảng"): the language list, translatable UI strings
-- and the destinations. Every statement is idempotent; every seed is
-- ON CONFLICT DO NOTHING so a re-run never overwrites what an editor changed.

-- ── locales ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS locales (
  -- Used in URLs: en, vi, zh-hans. Lower case; region/script subtags allowed.
  code          text PRIMARY KEY
                CHECK (code ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$'),
  bcp47         text        NOT NULL CHECK (bcp47 ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  native_name   text        NOT NULL CHECK (native_name <> ''),
  short_label   text        NOT NULL CHECK (short_label <> ''),
  -- Key into SCRIPT_FONTS in code. Not an enum here: the list lives in code.
  script        text        NOT NULL CHECK (script <> ''),
  is_default    boolean     NOT NULL DEFAULT false,
  is_enabled    boolean     NOT NULL DEFAULT false,
  -- Show machine-translated rows to guests for this locale.
  serve_machine boolean     NOT NULL DEFAULT false,
  sort_order    integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,
  -- The default language is always served.
  CONSTRAINT locales_default_enabled CHECK (NOT is_default OR is_enabled)
);

-- At most one default (the index is on a constant, so a second TRUE collides).
CREATE UNIQUE INDEX IF NOT EXISTS locales_single_default_idx
  ON locales ((true)) WHERE is_default;

INSERT INTO locales (code, bcp47, native_name, short_label, script, is_default, is_enabled, sort_order)
VALUES
  ('en', 'en', 'English',    'EN', 'latin',      true,  true,  10),
  ('vi', 'vi', 'Tiếng Việt', 'VI', 'vietnamese', false, false, 20)
ON CONFLICT DO NOTHING;

-- ── content_strings ────────────────────────────────────────────────────────
-- Which keys exist is decided by lib/i18n/registry.ts; this table only holds
-- overrides and translations. Empty at first: readers fall back to the registry.
CREATE TABLE IF NOT EXISTS content_strings (
  key         text        NOT NULL
              CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  locale      text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  value       text        NOT NULL,  -- ICU MessageFormat
  status      text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin      text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model    text,
  source_hash text,
  reviewed_by text,
  reviewed_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  PRIMARY KEY (key, locale)
);

-- Lookups are per locale (all overrides for one language).
CREATE INDEX IF NOT EXISTS content_strings_locale_idx ON content_strings (locale);

-- ── destinations ───────────────────────────────────────────────────────────
-- Non-translatable columns only; names, addresses and card copy join in
-- destination_i18n in phase 6. card_image_id has no FK yet: `media` does not
-- exist until phase 6, which adds the constraint.
CREATE TABLE IF NOT EXISTS destinations (
  id             text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
  kind           text        NOT NULL CHECK (kind IN ('venue', 'teaser')),
  card_image_id  uuid,
  phone_e164     text        CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  phone_display  text,
  email          text        CHECK (email ~ '^[^@\s]+@[^@\s]+$'),
  map_url        text        CHECK (map_url ~ '^https://'),
  show_in_footer boolean     NOT NULL DEFAULT false,
  sort_order     integer     NOT NULL DEFAULT 0,
  is_published   boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text,
  -- A phone number is shown as typed by staff; it needs the dialable form too.
  CONSTRAINT destinations_phone_pair CHECK ((phone_e164 IS NULL) = (phone_display IS NULL))
);

-- From lib/data.ts (DESTS, DESTINATION_CARDS, CONTACT) and the footer.
-- The footer lists the resort and the dining house only. The shared email
-- (CONTACT.email) belongs to site_settings in phase 6, so it is not copied here.
INSERT INTO destinations (id, kind, phone_e164, phone_display, map_url, show_in_footer, sort_order)
VALUES
  ('resort',       'venue',  '+842366519999', '+84 236 651 9999', 'https://maps.google.com/?q=Furama+Resort+Danang', true,  10),
  ('dining-house', 'venue',  '+84859555759',  '0859 555 759',     NULL,                                               true,  20),
  ('mm',           'venue',  NULL,            NULL,               NULL,                                               false, 30),
  ('future',       'teaser', NULL,            NULL,               NULL,                                               false, 40)
ON CONFLICT DO NOTHING;

-- restaurants.destination already holds these ids as text. Constrain it now so
-- a typo cannot create an orphan; phase 6 adds destination_id and phase 10
-- drops this column together with its constraint.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurants_destination_fk') THEN
    ALTER TABLE restaurants
      ADD CONSTRAINT restaurants_destination_fk
      FOREIGN KEY (destination) REFERENCES destinations (id) ON UPDATE CASCADE;
  END IF;
END $$;
```

- [ ] **Bước 4: Chạy để thấy pass**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/migration-004.test.ts`
Expected: PASS `Tests  19 passed (19)`.

- [ ] **Bước 5: Chạy toàn bộ kiểm tra**

```bash
npm run lint
TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
npm run typecheck
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run test:e2e
```

Expected:
- lint thoát 0;
- `Test Files  12 passed (12)`, `Tests  87 passed (87)`;
- `reset-db` in ra `✓ 004_foundations_locales_strings_destinations.sql` và `Applied 4 migration(s).`;
- build xanh;
- typecheck sạch;
- E2E `7 passed`.

Task này không đổi giao diện, nên chưa cần chạy visual.

- [ ] **Bước 6: Commit**

```bash
git add db/migrations/004_foundations_locales_strings_destinations.sql test/integration/migration-004.test.ts
git commit -m "$(cat <<'EOF'
feat: add the locales, content_strings and destinations tables

The foundations both later branches share (spec §5.2): en enabled and
default, vi off, an empty content_strings that falls back to the registry,
and the four destinations from lib/data.ts. Every seed is ON CONFLICT DO
NOTHING and the file re-runs safely. restaurants.destination now has a
foreign key so a typo cannot orphan a restaurant.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Lõi i18n thuần — tag cache, registry, locale, URL, câu lỗi

Mọi file trong task này là code thuần, không đụng DB, nên test được bằng Vitest:
- `cache-tags`, `registry`, `format`, `resolve` và `booking-errors` lấy nguyên từ `spike-data`. Riêng `lib/cache-tags.ts` khai báo đủ danh sách tag của spec §6.2 (bản spike chỉ có ba tag), dù đợt 2 chỉ dùng bốn tag.
- `pickLocale` lấy từ `spike-proxy`.
- `toBcp47`, `LOCALE_CODE_RE` và `href.ts` là code mới.

**Files:**
- Create:
  - `lib/cache-tags.ts`
  - `lib/i18n/format.ts`, `lib/i18n/registry.ts`, `lib/i18n/resolve.ts`, `lib/i18n/registry.test.ts`
  - `lib/i18n/locales.ts`, `lib/i18n/locales.test.ts`
  - `lib/i18n/href.ts`, `lib/i18n/href.test.ts`
- Modify: `lib/booking-errors.ts` (viết lại toàn bộ file), `lib/booking-errors.test.ts`

**Interfaces:**
- Consumes: không có.
- Produces:
  - `TAGS`: đủ danh sách tag của spec §6.2.
    - Hằng chuỗi: `contentHero` … `contentUi` (mười sáu tag `content:*`), `media`, `restaurants`, `locales`, `aiSettings`.
    - Hàm: `restaurant(id)` → `restaurant:<id>`, `bookingRules(restaurantId)` → `booking-rules:<id>`, `i18n(locale)` → `i18n:<code>`.
    - Đợt 2 chỉ dùng `restaurants`, `i18n`, `locales`, `contentUi`.
  - `REGISTRY` (12 key `error.*`, mỗi key kiểu `StringDef`) và `type StringKey`, `STRING_KEYS: StringKey[]`, `KEY_PATTERN`, `CLIENT_KEYS: StringKey[]`, `ADMIN_SCREENS`, `registryLocaleDefault(key, locale): string | undefined`.
  - `formatMessage(template: string, params?: Record<string, string | number>, locale?: string): string`, `usesIcuSyntax(template: string): boolean`.
  - `type StringRow = { key: string; locale: string; value: string }`, `resolveStrings<K extends StringKey>(rows, keys: readonly K[], locale: string, defaultLocale: string): Record<K, string>`.
  - `DEFAULT_LOCALE = 'en'`, `LOCALE_COOKIE = 'NEXT_LOCALE'`, `ENABLED_LOCALES: readonly string[]`, `LOCALE_CODE_RE: RegExp`, `toBcp47(code: string): string`, `pickLocale(cookie: string | undefined, acceptLanguage: string | null, enabled: readonly string[]): string`.
  - `localeHref(locale: string, path?: string): string`, `homeHref(locale: string): string`, `restaurantHref(locale: string, slug: string): string`.
  - `type ErrorKey = \`error.${BookingErrorCode}\``, `type ErrorStrings = Record<ErrorKey, string>`, `DEFAULT_ERROR_STRINGS: ErrorStrings`.
  - `bookingErrorMessage(code, params?, strings: ErrorStrings = DEFAULT_ERROR_STRINGS): string`. Ba chỗ gọi trong `SiteProvider` vẫn compile mà không phải sửa.

- [ ] **Bước 1: Viết test**

Create `lib/i18n/registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatMessage, usesIcuSyntax } from './format';
import { ADMIN_SCREENS, KEY_PATTERN, REGISTRY, STRING_KEYS, type StringDef } from './registry';
import { resolveStrings } from './resolve';

describe('registry', () => {
  it.each(STRING_KEYS)('%s is well formed', (key) => {
    const def: StringDef = REGISTRY[key];
    expect(key).toMatch(KEY_PATTERN);
    expect(def.en.length).toBeGreaterThan(0);
    expect(def.en.length).toBeLessThanOrEqual(def.maxLength);
    if (def.vi) expect(def.vi.length).toBeLessThanOrEqual(def.maxLength);
    expect(def.context.length).toBeGreaterThan(10);
    expect(ADMIN_SCREENS).toContain(def.screen);
    // Declared variables and placeholders in the text agree, in every language.
    for (const text of [def.en, def.vi].filter((t): t is string => !!t)) {
      const used = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(used).toEqual([...(def.vars ?? [])].sort());
      expect(usesIcuSyntax(text)).toBe(false); // phase 2 has no ICU parser
    }
  });
});

describe('formatMessage', () => {
  it('fills known variables and leaves unknown ones visible', () => {
    expect(formatMessage('{a} and {b}', { a: 'x' })).toBe('x and {b}');
    expect(formatMessage('{n} guests', { n: 4 })).toBe('4 guests');
  });
  it('flags ICU plural syntax', () => {
    expect(usesIcuSyntax('{n, plural, one {# guest} other {# guests}}')).toBe(true);
  });
});

describe('resolveStrings', () => {
  const keys = ['error.full', 'error.past'] as const;
  it('uses the default-language row, else the registry', () => {
    const out = resolveStrings([{ key: 'error.full', locale: 'en', value: 'Sold out.' }], keys, 'en', 'en');
    expect(out['error.full']).toBe('Sold out.');
    expect(out['error.past']).toContain('already started');
  });
  it('falls back per key: a missing vi row shows the English row, not an empty string', () => {
    const rows = [
      { key: 'error.full', locale: 'en', value: 'Sold out.' },
      { key: 'error.past', locale: 'vi', value: 'Đã qua giờ.' },
    ];
    const out = resolveStrings(rows, keys, 'vi', 'en');
    expect(out).toEqual({ 'error.full': 'Sold out.', 'error.past': 'Đã qua giờ.' });
  });
});
```

Create `lib/i18n/locales.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LOCALE_CODE_RE, pickLocale, toBcp47 } from './locales';

describe('pickLocale', () => {
  const en = ['en'];
  const multi = ['en', 'vi', 'zh-hans'];
  it('defaults to en', () => expect(pickLocale(undefined, null, en)).toBe('en'));
  it('ignores a cookie for a language that is not enabled', () => expect(pickLocale('vi', null, en)).toBe('en'));
  it('ignores Accept-Language for a language that is not enabled', () =>
    expect(pickLocale(undefined, 'vi-VN,vi;q=0.9', en)).toBe('en'));
  it('lets the cookie win over Accept-Language', () => expect(pickLocale('vi', 'en', multi)).toBe('vi'));
  it('uses q ordering and the primary subtag', () =>
    expect(pickLocale(undefined, 'fr;q=0.9, vi-VN;q=0.8, en;q=0.1', multi)).toBe('vi'));
  it('falls back when nothing enabled matches', () => expect(pickLocale(undefined, 'fr,de', multi)).toBe('en'));
});

describe('LOCALE_CODE_RE', () => {
  it.each(['en', 'vi', 'zh-hans', 'pt-br', 'es-419'])('accepts %s', (code) => expect(LOCALE_CODE_RE.test(code)).toBe(true));
  it.each(['EN', 'e', 'zh_hans', 'zh-', '-en', 'en us', '', 'english'])('rejects %j', (code) =>
    expect(LOCALE_CODE_RE.test(code)).toBe(false));
});

describe('toBcp47', () => {
  it.each([
    ['en', 'en'],
    ['vi', 'vi'],
    ['zh-hans', 'zh-Hans'],
    ['pt-br', 'pt-BR'],
    ['es-419', 'es-419'],
    ['zh-hans-cn', 'zh-Hans-CN'],
  ])('%s -> %s', (code, tag) => expect(toBcp47(code)).toBe(tag));
});
```

Create `lib/i18n/href.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { homeHref, localeHref, restaurantHref } from './href';

describe('guest URLs', () => {
  it('prefixes the locale and drops the trailing slash of the home page', () => {
    expect(homeHref('en')).toBe('/en');
    expect(localeHref('zh-hans', '/')).toBe('/zh-hans');
    expect(localeHref('vi', '/restaurants')).toBe('/vi/restaurants');
  });

  it('builds the detail page URL from the slug', () => {
    expect(restaurantHref('en', 'taya-house')).toBe('/en/restaurants/taya-house');
  });
});
```

Trong `lib/booking-errors.test.ts`, thay dòng import:

```ts
import { BOOKING_ERROR_CODES, bookingErrorMessage } from './booking-errors';
```

bằng:

```ts
import { BOOKING_ERROR_CODES, DEFAULT_ERROR_STRINGS, bookingErrorMessage } from './booking-errors';
```

và thêm vào cuối file:

```ts

describe('bookingErrorMessage with resolved strings', () => {
  it('uses the override the server resolved, and still fills {restaurant}', () => {
    const strings = { ...DEFAULT_ERROR_STRINGS, 'error.slot_unavailable': 'Bàn ở {restaurant} đã kín giờ này.' };
    expect(bookingErrorMessage('slot_unavailable', { restaurant: 'Tàya House' }, strings)).toBe(
      'Bàn ở Tàya House đã kín giờ này.',
    );
  });
});
```

- [ ] **Bước 2: Chạy để thấy lỗi**

Run: `npx vitest run lib/i18n lib/booking-errors.test.ts`
Expected: FAIL.
- Ba file trong `lib/i18n` báo `Error: Cannot find module './format'` (và `'./locales'`, `'./href'`).
- `booking-errors.test.ts` có 1 test đỏ: `Expected: "Bàn ở Tàya House đã kín giờ này."`, `Received: "Tàya House does not serve at that time."`. Hàm cũ bỏ qua tham số thứ ba.

- [ ] **Bước 3: Viết tag cache, registry, format, resolve**

Create `lib/cache-tags.ts`:

```ts
/**
 * Every cache tag of the site: the complete list of spec §6.2. A reader
 * declares the tags it depends on with cacheTag(...); a write refreshes them
 * with updateTag (in a Server Action) or revalidateTag(tag, 'max') (anywhere
 * else). Phase 2 only tags restaurants, i18n:<code>, locales and content:ui;
 * the rest are named now so later phases use these constants, never literals.
 */
export const TAGS = {
  contentHero: 'content:hero',
  contentFilm: 'content:film',
  contentFinder: 'content:finder',
  contentCuisines: 'content:cuisines',
  contentDestinations: 'content:destinations',
  contentExperiences: 'content:experiences',
  contentHeritage: 'content:heritage',
  contentStories: 'content:stories',
  /** Date-bound: its reader uses cacheLife('hours') and the daily cron expires it. */
  contentOffers: 'content:offers',
  contentBooking: 'content:booking',
  /** Which home sections are switched on. */
  contentSections: 'content:sections',
  contentNav: 'content:nav',
  /** site_settings, social_links and the footer. */
  contentContact: 'content:contact',
  contentSeo: 'content:seo',
  contentLegal: 'content:legal',
  /** UI strings: ui.*, form.*, error.*, search.*, common.* */
  contentUi: 'content:ui',
  /** Every reader that returns image alt text. */
  media: 'media',
  /** The restaurant catalogue. */
  restaurants: 'restaurants',
  restaurant: (id: string) => `restaurant:${id}`,
  bookingRules: (restaurantId: string) => `booking-rules:${restaurantId}`,
  /** Which languages exist and which are enabled. */
  locales: 'locales',
  aiSettings: 'ai-settings',
  /** Everything served in one language; refreshed when it is enabled or disabled. */
  i18n: (locale: string) => `i18n:${locale}`,
} as const;
```

Create `lib/i18n/format.ts`:

```ts
/**
 * Fills {name} placeholders. Phase 2 needs nothing more (the only variable is
 * {restaurant}), so there is no ICU parser yet. Plurals and selects arrive with
 * the first string that needs them; swap this body for intl-messageformat then
 * and no caller changes, because the signature already carries the locale.
 */
export type MessageParams = Record<string, string | number>;

export function formatMessage(template: string, params: MessageParams = {}, _locale = 'en'): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/** True when the text uses ICU syntax beyond {name} (plural, select, nested braces). */
export function usesIcuSyntax(template: string): boolean {
  return /\{\s*\w+\s*,/.test(template) || /\{[^{}]*\{/.test(template);
}
```

Create `lib/i18n/registry.ts`:

```ts
/**
 * The list of translatable guest-site strings (spec §5.1 item 2). The code
 * decides which keys exist; the content_strings table only overrides or
 * translates them, and a key with no row falls back to the default here.
 */

/** Admin screens that can edit strings (spec §7.2); a CI test checks every key names one. */
export const ADMIN_SCREENS = [
  'hero',
  'booking',
  'navigation',
  'contact',
  'seo',
  'legal',
  'emails',
  'ui-text',
] as const;
export type AdminScreen = (typeof ADMIN_SCREENS)[number];

export type StringDef = {
  /** English default; always present. */
  en: string;
  /** Vietnamese default; only for email.* and legal.* (spec §5.1). */
  vi?: string;
  /** Longest value an editor may save, counted in characters. */
  maxLength: number;
  /** Placeholder names the value may use, written {name}. */
  vars?: readonly string[];
  /** Where the text appears and what it must keep. Shown to translators and given to the AI. */
  context: string;
  /** The admin screen that edits this key. */
  screen: AdminScreen;
};

// `satisfies` keeps the literal key names, so StringKey is a real union.
export const REGISTRY = {
  'error.restaurant_unavailable': {
    en: 'That restaurant is no longer available.',
    maxLength: 140,
    context: 'Shown under the reservation form when the chosen restaurant stopped taking online bookings.',
    screen: 'ui-text',
  },
  'error.party_too_large': {
    en: 'Please choose between 1 and 12 guests.',
    maxLength: 140,
    context: 'Party size above the online limit. The numbers will become variables once the limit is configurable.',
    screen: 'ui-text',
  },
  'error.outside_window': {
    en: 'Please choose a date within the next two weeks.',
    maxLength: 140,
    context: 'The date is beyond the booking window.',
    screen: 'ui-text',
  },
  'error.slot_unavailable': {
    en: '{restaurant} does not serve at that time.',
    maxLength: 140,
    vars: ['restaurant'],
    context: 'The time is not in the restaurant’s service hours. {restaurant} is the restaurant name; keep it as is.',
    screen: 'ui-text',
  },
  'error.past': {
    en: 'That sitting has already started — please pick a later time.',
    maxLength: 140,
    context: 'The chosen sitting has started or ended.',
    screen: 'ui-text',
  },
  'error.invalid_name': {
    en: 'Please enter your name.',
    maxLength: 140,
    context: 'Name field is empty or invalid.',
    screen: 'ui-text',
  },
  'error.invalid_phone': {
    en: 'Please enter a valid phone number.',
    maxLength: 140,
    context: 'Phone field failed validation.',
    screen: 'ui-text',
  },
  'error.invalid_email': {
    en: 'Please check your email address.',
    maxLength: 140,
    context: 'Email field failed validation.',
    screen: 'ui-text',
  },
  'error.full': {
    en: 'That slot just filled up — please choose another time.',
    maxLength: 140,
    context: 'No covers left at the chosen time.',
    screen: 'ui-text',
  },
  'error.duplicate': {
    en: 'We already have a request for this table under your number.',
    maxLength: 140,
    context: 'The same phone number already has an active request for this restaurant, date and time.',
    screen: 'ui-text',
  },
  'error.unknown': {
    en: 'Something went wrong with your request. Please try again.',
    maxLength: 140,
    context: 'Any server error not covered by another code.',
    screen: 'ui-text',
  },
  'error.network': {
    en: 'We could not reach the reservations desk. Please try again.',
    maxLength: 140,
    context: 'The browser could not reach the server (client side only).',
    screen: 'ui-text',
  },
} as const satisfies Record<string, StringDef>;

export type StringKey = keyof typeof REGISTRY;

export const STRING_KEYS = Object.keys(REGISTRY) as StringKey[];

/** Same pattern as the CHECK on content_strings.key (migration 004). */
export const KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

/** Keys the browser needs at first paint; passed to SiteProvider. Grow this list per component that moves to t(). */
export const CLIENT_KEYS = STRING_KEYS.filter((k) => k.startsWith('error.')) as StringKey[];

/** The registry's own text for a language other than English; only `vi`, and only where declared. */
export function registryLocaleDefault(key: StringKey, locale: string): string | undefined {
  const def: StringDef = REGISTRY[key];
  return locale === 'vi' ? def.vi : undefined;
}
```

Create `lib/i18n/resolve.ts`:

```ts
import { REGISTRY, registryLocaleDefault, type StringKey } from './registry';

/** One content_strings row that is allowed to reach guests. */
export type StringRow = { key: string; locale: string; value: string };

/**
 * Picks the text for each key, spec §5.1 item 5. Each key falls back on its own:
 *   1. the row in `locale`
 *   2. the registry's text for that locale (only email.* / legal.* have one)
 *   3. the row in the default language
 *   4. the registry's English text
 * `rows` must already be filtered for visibility (see loadStringRows).
 */
export function resolveStrings<K extends StringKey>(
  rows: readonly StringRow[],
  keys: readonly K[],
  locale: string,
  defaultLocale: string,
): Record<K, string> {
  const at = new Map<string, string>();
  for (const r of rows) at.set(`${r.key}\u0000${r.locale}`, r.value);

  const out = {} as Record<K, string>;
  for (const key of keys) {
    out[key] =
      at.get(`${key}\u0000${locale}`) ??
      registryLocaleDefault(key, locale) ??
      at.get(`${key}\u0000${defaultLocale}`) ??
      REGISTRY[key].en;
  }
  return out;
}
```

- [ ] **Bước 4: Viết locale và URL**

Create `lib/i18n/locales.ts`:

```ts
/*
 * Locale constants and pure helpers, safe in the proxy, on the server and in
 * the browser. Which languages are enabled is the `locales` table's job; the
 * proxy still uses ENABLED_LOCALES until phase 8 (spec §6.1).
 */
export const DEFAULT_LOCALE = 'en';
export const LOCALE_COOKIE = 'NEXT_LOCALE';

/** Phase 2: only 'en' exists. Phase 8 swaps this for a best-effort read of the locales table. */
export const ENABLED_LOCALES: readonly string[] = ['en'];

/**
 * A URL locale code: en, vi, zh-hans, pt-br. The same shape as the CHECK on
 * locales.code (migration 004) and the locale segment the proxy matcher skips.
 */
export const LOCALE_CODE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/;

/**
 * The BCP 47 spelling of a URL code, for <html lang> in the root layout (which
 * reads no database): zh-hans -> zh-Hans, pt-br -> pt-BR, es-419 stays.
 */
export function toBcp47(code: string): string {
  return code
    .split('-')
    .map((part, i) => {
      if (i === 0 || !/^[a-z]+$/.test(part)) return part;
      if (part.length === 4) return part[0].toUpperCase() + part.slice(1); // script
      if (part.length === 2) return part.toUpperCase(); // region
      return part;
    })
    .join('-');
}

/** Pure: cookie, then Accept-Language (q-sorted, primary-subtag fallback), then default. */
export function pickLocale(
  cookie: string | undefined,
  acceptLanguage: string | null,
  enabled: readonly string[],
): string {
  const set = new Set(enabled.map((l) => l.toLowerCase()));
  const c = cookie?.toLowerCase();
  if (c && set.has(c)) return c;
  const ranked = (acceptLanguage ?? '')
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag: tag.toLowerCase(), q: q ? Number(q.slice(2)) : 1 };
    })
    .filter((x) => x.tag && x.tag !== '*' && x.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    if (set.has(tag)) return tag;
    const primary = tag.split('-')[0];
    if (set.has(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}
```

Create `lib/i18n/href.ts`:

```ts
/*
 * Internal guest URLs. Every link and router.push to a guest page goes through
 * these, so the locale prefix (spec §6.1) is never written by hand.
 */
export function localeHref(locale: string, path = '/'): string {
  return `/${locale}${path === '/' ? '' : path}`;
}

export function homeHref(locale: string): string {
  return localeHref(locale);
}

export function restaurantHref(locale: string, slug: string): string {
  return localeHref(locale, `/restaurants/${slug}`);
}
```

- [ ] **Bước 5: Chuyển câu lỗi đặt bàn sang registry**

Thay toàn bộ nội dung `lib/booking-errors.ts` bằng:

```ts
/**
 * What can go wrong with a table request. The server returns only these
 * codes; the browser turns them into copy. The copy lives in the content
 * registry (lib/i18n/registry.ts) as error.<code>, so the DB can override it.
 */
import { formatMessage } from '@/lib/i18n/format';
import { REGISTRY } from '@/lib/i18n/registry';

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

export type ErrorKey = `error.${BookingErrorCode}`;

export type ErrorStrings = Record<ErrorKey, string>;

/** English defaults straight from the registry (indexing REGISTRY by every code is the compile-time check that each code has a key); used when the server did not pass resolved strings. */
export const DEFAULT_ERROR_STRINGS = Object.fromEntries(
  BOOKING_ERROR_CODES.map((code) => [`error.${code}`, REGISTRY[`error.${code}`].en]),
) as ErrorStrings;

const DEFAULT_PARAMS: Record<string, string> = { restaurant: 'The restaurant' };

export function bookingErrorMessage(
  code: BookingErrorCode,
  params: Record<string, string> = {},
  strings: ErrorStrings = DEFAULT_ERROR_STRINGS,
): string {
  return formatMessage(strings[`error.${code}`], { ...DEFAULT_PARAMS, ...params });
}
```

- [ ] **Bước 6: Chạy để thấy pass**

Run: `npx vitest run lib/i18n lib/booking-errors.test.ts`
Expected: PASS `Test Files  4 passed (4)`, `Tests  47 passed (47)`.

- [ ] **Bước 7: Chạy toàn bộ kiểm tra**

```bash
npm run lint
TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
npm run typecheck
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run test:e2e
```

Expected:
- lint thoát 0 (vẫn 20 cảnh báo cũ);
- `Test Files  15 passed (15)`, `Tests  131 passed (131)`;
- build xanh;
- typecheck sạch;
- E2E `7 passed`. Test "submitting after the chosen sitting has closed…" vẫn thấy đúng câu `That sitting has already started — please pick a later time.`

- [ ] **Bước 8: Commit**

```bash
git add lib/cache-tags.ts lib/i18n/format.ts lib/i18n/registry.ts lib/i18n/resolve.ts lib/i18n/registry.test.ts lib/i18n/locales.ts lib/i18n/locales.test.ts lib/i18n/href.ts lib/i18n/href.test.ts lib/booking-errors.ts lib/booking-errors.test.ts
git commit -m "$(cat <<'EOF'
feat: add the string registry, locale helpers and cache tag names

The twelve booking error messages move into lib/i18n/registry.ts as
error.<code>, so the database can override them later; bookingErrorMessage
takes the resolved strings as an optional third argument. Pure locale
helpers (pickLocale, toBcp47, the locale code pattern) and URL builders
(homeHref, restaurantHref) are ready for the route move. lib/cache-tags.ts
names every cache tag of spec §6.2; phase 2 uses four of them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Hàm đọc locale và chuỗi giao diện, không cache

Hai file `*.queries.ts` lấy nguyên từ `spike-data`. Phần bọc `'use cache'` để tới Task 10, vì Vitest không import được `cacheTag()`.

**Files:**
- Create: `lib/server/content/locales.queries.ts`, `lib/server/content/strings.queries.ts`, `test/integration/content-strings.test.ts`

**Interfaces:**
- Consumes:
  - Task 2: các bảng `locales`, `content_strings`.
  - Task 3: `resolveStrings`, `StringRow`, `CLIENT_KEYS`, `REGISTRY`.
  - `query`, `getPool` từ `db/client.ts`.
- Produces:
  - `type SiteLocale = { code: string; bcp47: string; nativeName: string; shortLabel: string; script: string; isDefault: boolean; serveMachine: boolean }`.
  - `loadEnabledLocales(): Promise<SiteLocale[]>`: chỉ các ngôn ngữ đang bật, theo `sort_order`, rồi `code`.
  - `loadStringRows(locale: string, keys: readonly string[]): Promise<{ defaultLocale: string; rows: StringRow[] }>`: chỉ các hàng khách được xem (mục 5.1 ý 5).

- [ ] **Bước 1: Viết test tích hợp**

Create `test/integration/content-strings.test.ts`. Hàm `afterAll` đưa `locales` về trạng thái seed, để những lần build sau không thấy `vi` bị bật:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, query } from '@/db/client';
import { resolveStrings } from '@/lib/i18n/resolve';
import { CLIENT_KEYS, REGISTRY } from '@/lib/i18n/registry';
import { loadEnabledLocales } from '@/lib/server/content/locales.queries';
import { loadStringRows } from '@/lib/server/content/strings.queries';

/** The read layer, uncached: loaders hit the database, resolveStrings picks the text. */
async function read(locale: string, keys = ['error.full', 'error.past', 'error.network'] as const) {
  const { defaultLocale, rows } = await loadStringRows(locale, keys);
  return resolveStrings(rows, keys, locale, defaultLocale);
}

const put = (key: string, locale: string, value: string, status = 'reviewed') =>
  query(
    `INSERT INTO content_strings (key, locale, value, status, origin) VALUES ($1, $2, $3, $4, 'human')`,
    [key, locale, value, status],
  );

describe.skipIf(!process.env.TEST_DATABASE_URL)('content strings read layer (database)', () => {
  beforeEach(async () => {
    await query('DELETE FROM content_strings');
    await query(`UPDATE locales SET is_enabled = (code = 'en'), serve_machine = false`);
  });
  afterAll(async () => {
    await query('DELETE FROM content_strings');
    await query(`UPDATE locales SET is_enabled = (code = 'en'), serve_machine = false`);
    await getPool().end();
  });

  it('returns the registry defaults while content_strings is empty', async () => {
    const out = await read('en');
    expect(out['error.full']).toBe(REGISTRY['error.full'].en);
    expect(out['error.network']).toBe(REGISTRY['error.network'].en);
  });

  it('serves an English override at once', async () => {
    await put('error.full', 'en', 'Sold out for that time.');
    expect((await read('en'))['error.full']).toBe('Sold out for that time.');
  });

  it('shows reviewed vi rows, falls back to English per key, and hides machine rows by default', async () => {
    await put('error.full', 'en', 'Sold out.');
    await put('error.past', 'vi', 'Đã qua giờ.');
    await put('error.network', 'vi', 'Bản dịch máy', 'machine');
    const out = await read('vi');
    expect(out['error.past']).toBe('Đã qua giờ.');
    expect(out['error.full']).toBe('Sold out.');
    expect(out['error.network']).toBe(REGISTRY['error.network'].en);
  });

  it('shows machine rows once the language turns serve_machine on', async () => {
    await put('error.network', 'vi', 'Bản dịch máy', 'machine');
    await query(`UPDATE locales SET serve_machine = true WHERE code = 'vi'`);
    expect((await read('vi'))['error.network']).toBe('Bản dịch máy');
  });

  it('asks for the client keys in one query and returns every one', async () => {
    const { rows } = await loadStringRows('en', CLIENT_KEYS);
    expect(rows).toEqual([]);
    expect(Object.keys(resolveStrings(rows, CLIENT_KEYS, 'en', 'en')).sort()).toEqual([...CLIENT_KEYS].sort());
  });

  it('lists only enabled locales, in display order', async () => {
    expect((await loadEnabledLocales()).map((l) => l.code)).toEqual(['en']);
    await query(`UPDATE locales SET is_enabled = true WHERE code = 'vi'`);
    const locales = await loadEnabledLocales();
    expect(locales.map((l) => l.code)).toEqual(['en', 'vi']);
    expect(locales[0]).toMatchObject({ isDefault: true, bcp47: 'en', shortLabel: 'EN' });
  });
});
```

- [ ] **Bước 2: Chạy để thấy lỗi**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/content-strings.test.ts`
Expected: FAIL `Error: Cannot find package '@/lib/server/content/locales.queries' imported from …/test/integration/content-strings.test.ts`.

- [ ] **Bước 3: Viết hai hàm đọc**

Create `lib/server/content/locales.queries.ts`:

```ts
import 'server-only';
import { query } from '@/db/client';

export type SiteLocale = {
  code: string;
  bcp47: string;
  nativeName: string;
  shortLabel: string;
  script: string;
  isDefault: boolean;
  serveMachine: boolean;
};

type Row = {
  code: string;
  bcp47: string;
  native_name: string;
  short_label: string;
  script: string;
  is_default: boolean;
  serve_machine: boolean;
};

/** Enabled languages in display order. Uncached; lib/server/content/locales.ts wraps it. */
export async function loadEnabledLocales(): Promise<SiteLocale[]> {
  const rows = await query<Row>(
    `SELECT code, bcp47, native_name, short_label, script, is_default, serve_machine
       FROM locales
      WHERE is_enabled
      ORDER BY sort_order, code`,
  );
  return rows.map((r) => ({
    code: r.code,
    bcp47: r.bcp47,
    nativeName: r.native_name,
    shortLabel: r.short_label,
    script: r.script,
    isDefault: r.is_default,
    serveMachine: r.serve_machine,
  }));
}
```

Create `lib/server/content/strings.queries.ts`:

```ts
import 'server-only';
import { query } from '@/db/client';
import type { StringRow } from '@/lib/i18n/resolve';

/**
 * The rows a guest may see for `keys` in `locale`, plus the default language's
 * rows as fallback (spec §5.1 item 5): the default language always shows;
 * another language shows `reviewed` rows, or `machine` rows when that language
 * has serve_machine on. Uncached; lib/server/content/strings.ts wraps it.
 */
export async function loadStringRows(
  locale: string,
  keys: readonly string[],
): Promise<{ defaultLocale: string; rows: StringRow[] }> {
  const defaults = await query<{ code: string }>('SELECT code FROM locales WHERE is_default');
  const defaultLocale = defaults[0]?.code ?? 'en';
  if (keys.length === 0) return { defaultLocale, rows: [] };

  const rows = await query<StringRow>(
    `SELECT cs.key, cs.locale, cs.value
       FROM content_strings cs
       JOIN locales l ON l.code = cs.locale
      WHERE cs.key = ANY($1::text[])
        AND cs.locale IN ($2, $3)
        AND (cs.locale = $3
             OR cs.status = 'reviewed'
             OR (cs.status = 'machine' AND l.serve_machine))`,
    [keys, locale, defaultLocale],
  );
  return { defaultLocale, rows };
}
```

- [ ] **Bước 4: Chạy để thấy pass**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/content-strings.test.ts`
Expected: PASS `Tests  6 passed (6)`.

- [ ] **Bước 5: Chạy toàn bộ kiểm tra**

```bash
npm run lint
TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
npm run typecheck
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run test:e2e
```

Expected:
- lint thoát 0;
- `Test Files  16 passed (16)`, `Tests  137 passed (137)`;
- build xanh;
- typecheck sạch;
- E2E `7 passed`.

- [ ] **Bước 6: Commit**

```bash
git add lib/server/content/locales.queries.ts lib/server/content/strings.queries.ts test/integration/content-strings.test.ts
git commit -m "$(cat <<'EOF'
feat: read enabled locales and visible UI strings from the database

Uncached loaders behind the future 'use cache' readers: the default language
always shows, another language shows reviewed rows (machine rows only with
serve_machine), and each key falls back to English on its own. Vitest covers
them; the cached wrappers cannot run outside Next.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Dạng `Restaurant` mới, lọc theo key, bỏ code viết riêng cho Tàya (vẫn trên route hiện tại)

Spec §6.3 ý 1 và 2. Task này lấy hướng làm từ codebase-map §1–§3; dàn ý ghi phần này "unverified", và `plan-verify` đã chạy thử: 144 unit, 9 E2E, 8/8 ảnh ở ngưỡng 0. Route vẫn là `/` và `/taya-house`.

Có ba điểm cần biết trước khi sửa:
- `MobileBar` chuyển vào từng trang ngay bây giờ. Trang chi tiết truyền slug, nên chrome không cần biết đang ở trang nào.
- `SiteProvider` vẫn điều hướng tới `/taya-house` qua `navigate('detail')`; Task 7 thay phần này.
- Vị trí `fixed` của tab bar không đổi khi nó nằm trong `<main>`: không phần tử cha nào có `transform`. Spike-cc đã chứng minh ảnh giống hệt.

**Files:**
- Create: `lib/data.test.ts`, `e2e/filters.spec.ts`
- Modify:
  - `lib/data.ts`, `db/queries.ts`
  - `lib/booking.test.ts`, `lib/server/check-reservation.test.ts`, `test/integration/catalogue.test.ts`
  - `components/home/Cuisines.tsx`, `components/home/Finder.tsx`, `components/home/Restaurants.tsx`, `components/home/RestaurantCard.tsx`
  - `components/overlays/SearchOverlay.tsx`, `components/booking/BookingBar.tsx`, `components/overlays/ReserveDrawer.tsx`
  - `components/detail/MoreRestaurants.tsx`, `components/detail/TayaHero.tsx`
  - `components/site/MobileBar.tsx`, `components/site/Chrome.tsx`, `components/site/SiteProvider.tsx`
  - `app/layout.tsx`, `app/page.tsx`, `app/taya-house/page.tsx`

**Interfaces:**
- Consumes: Task 1: `HOME_PATH` từ `e2e/paths.ts`.
- Produces:
  - `Restaurant` có thêm `slug: string` (đợt 2: bằng `id`) và `hasDetailPage: boolean`. `cuisines` giờ chứa **slug** (`'steak-grill'`), không còn nhãn.
  - `DETAIL_PAGE_IDS: ReadonlySet<string>` (`{'taya-house'}`), `DEFAULT_RESTAURANT_ID = 'taya-house'`.
  - `cuisineSlug(label: string): string`: ném lỗi nếu gặp nhãn lạ. `cuisineLabel(slug: string): string`.
  - `MEAL_LABELS: Record<Meal, string>`.
  - `contactFor(dest: DestKey | undefined): { tel: string | null; map: string | null }`.
  - Component nhận slug:
    - `TayaHero({ slug }: { slug: string })`
    - `MoreRestaurants({ slug }: { slug: string })`: trả `null` khi cùng điểm đến không còn nhà hàng nào khác.
    - `MobileBar({ slug }: { slug?: string })`: render bên trong trang, không còn nằm trong `Chrome`.
  - `SiteProvider` có thêm prop bắt buộc `defaultRestaurantId: string`.
  - Bộ lọc `filter.cuisine` và `finder.cuisine` chứa slug. `filter.occasion` vẫn là key `Meal`.

- [ ] **Bước 1: Viết test**

Create `lib/data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CONTACT, CUISINES, MEALS, MEAL_LABELS, contactFor, cuisineLabel, cuisineSlug } from './data';

describe('cuisine keys', () => {
  it('turns every label into its slug and back', () => {
    for (const [label, slug] of CUISINES) {
      expect(cuisineSlug(label)).toBe(slug);
      expect(cuisineLabel(slug)).toBe(label);
    }
    expect(cuisineSlug('Steak & Grill')).toBe('steak-grill');
  });

  it('refuses a label it does not know, so a typo in the database cannot hide a restaurant', () => {
    expect(() => cuisineSlug('Steak and Grill')).toThrow(/Unknown cuisine label/);
  });

  it('shows an unknown slug as itself rather than nothing', () => {
    expect(cuisineLabel('fusion')).toBe('fusion');
  });
});

describe('meal labels', () => {
  it('has display text for every meal key', () => {
    for (const meal of MEALS) expect(MEAL_LABELS[meal]).toBe(meal);
  });
});

describe('contactFor', () => {
  it('gives the resort its phone and map, the dining house its phone only, and hides both elsewhere', () => {
    expect(contactFor('resort')).toEqual({ tel: CONTACT.resortPhone, map: CONTACT.map });
    expect(contactFor('dining-house')).toEqual({ tel: CONTACT.diningHousePhone, map: null });
    expect(contactFor('mm')).toEqual({ tel: null, map: null });
    expect(contactFor(undefined)).toEqual({ tel: null, map: null });
  });
});
```

Trong `test/integration/catalogue.test.ts`, thay dòng `import { listRestaurants } from '@/db/queries';` bằng:

```ts
import { listRestaurants } from '@/db/queries';
import { CUISINES } from '@/lib/data';
```

rồi thêm hai test ngay sau test `'serves the 12 seeded restaurants in design order'`, vẫn trong khối `describe`:

```ts

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
```

Create `e2e/filters.spec.ts`. Đây là test ghim hành vi hiện có: nó xanh cả trước lẫn sau khi đổi nhãn sang slug.

```ts
import { expect, test } from '@playwright/test';
import { HOME_PATH } from './paths';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

test('a cuisine chip filters the grid by its key and names the filter by its label', async ({ page }) => {
  await page.goto(HOME_PATH);
  await page.locator('.cuisine', { hasText: 'Steak & Grill' }).click();
  await expect(page.locator('#restaurant-grid .rcard:visible')).toHaveCount(1);
  await expect(page.locator('#restaurant-grid .rcard:visible')).toContainText('Steakhouse The Fan');
  await expect(page.locator('.filter-chip')).toContainText('Steak & Grill');
});

test('search matches a cuisine by its label', async ({ page }) => {
  await page.goto(HOME_PATH);
  await page.locator('.hdr-full .hdr-link', { hasText: 'SEARCH' }).click();
  await page.locator('.search-chip', { hasText: 'Café & Lounge' }).click();
  await expect(page.locator('.search-result')).toHaveCount(2);
  await expect(page.locator('.search-result-name')).toHaveText(['V-Senses Cafe', 'Hải Vân Lounge']);
});
```

- [ ] **Bước 2: Chạy để thấy lỗi**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/data.test.ts test/integration/catalogue.test.ts`
Expected: FAIL.
- `lib/data.test.ts`: 5 test đỏ với `TypeError: (0 , __vite_ssr_import_1__.cuisineSlug) is not a function`.
- `catalogue.test.ts`: hai test mới đỏ. Mảng `used.filter(...)` còn nhãn như `'International'`, và `r.slug` là `undefined`.

Run: `CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npx playwright test e2e/filters.spec.ts`
Expected: PASS `2 passed`. Lệnh này chạy trên bản build Task 4 để lại, tức code hiện tại; hai test này phải giữ xanh sau khi đổi.

- [ ] **Bước 3: Thêm dạng dữ liệu mới vào `lib/data.ts`**

Thay khối:

```ts
export type Restaurant = {
  id: string;
  name: string;
  type: string;
  cuisines: string[];
```

bằng:

```ts
export type Restaurant = {
  id: string;
  /** URL segment of /[lang]/restaurants/[slug]. Phase 2: the id. Phase 6: restaurants.slug. */
  slug: string;
  /** Phase 2: DETAIL_PAGE_IDS below. Phase 6: restaurants.has_detail_page. */
  hasDetailPage: boolean;
  name: string;
  type: string;
  /** Cuisine slugs (the second column of CUISINES), never labels. */
  cuisines: string[];
```

Thay khối:

```ts
/* The restaurant catalogue lives in Neon (see db/migrations/002_seed_restaurants.sql)
   and is loaded by db/queries.ts#listRestaurants. */
```

bằng:

```ts
/* The restaurant catalogue lives in Neon (see db/migrations/002_seed_restaurants.sql)
   and is loaded by db/queries.ts#listRestaurants. */

/** Restaurants with their own page. Phase 6 replaces this with restaurants.has_detail_page. */
export const DETAIL_PAGE_IDS: ReadonlySet<string> = new Set(['taya-house']);

/** The restaurant the booking bar starts on. Phase 6: site_settings.default_restaurant_id. */
export const DEFAULT_RESTAURANT_ID = 'taya-house';
```

Thay dòng chú thích trên `CUISINES`:

```ts
/** [label, asset slug] — order drives the cuisine rail and the search suggestions. */
```

bằng:

```ts
/** [label, slug] — order drives the cuisine rail and the search suggestions. The slug is the filter key and the image name. */
```

Ngay sau mảng `CUISINES` (sau dòng `];` kết thúc ở `['Café & Lounge', 'cafe-lounge'],`), thêm:

```ts

const SLUG_BY_LABEL = new Map(CUISINES.map(([label, slug]) => [label, slug]));
const LABEL_BY_SLUG = new Map(CUISINES.map(([label, slug]) => [slug, label]));

/**
 * restaurants.cuisines still holds English labels (until phase 6 adds
 * restaurant_cuisines). The read layer turns them into slugs here, and an
 * unknown label fails loudly instead of silently dropping out of every filter.
 */
export function cuisineSlug(label: string): string {
  const slug = SLUG_BY_LABEL.get(label);
  if (!slug) throw new Error(`Unknown cuisine label in restaurants.cuisines: ${label}`);
  return slug;
}

/** The display label for a cuisine slug (the slug itself if it is unknown). */
export function cuisineLabel(slug: string): string {
  return LABEL_BY_SLUG.get(slug) ?? slug;
}
```

Ngay sau dòng `export const MEALS: Meal[] = ['Breakfast', 'Lunch', 'Dinner', 'Drinks'];`, thêm:

```ts

/** Display text per meal. The Meal value itself is the key (spec §5.2 service_periods.meal); phase 7 moves the text to the registry. */
export const MEAL_LABELS: Record<Meal, string> = {
  Breakfast: 'Breakfast',
  Lunch: 'Lunch',
  Dinner: 'Dinner',
  Drinks: 'Drinks',
};
```

Ngay sau object `CONTACT` (sau dòng `};` theo sau `story: 'https://furamavietnam.com/the-resort/',`), thêm:

```ts

/**
 * CALL and MAP for a restaurant, by its destination (spec §6.4: a missing one
 * hides its button). Phase 6 reads the restaurant's own values first.
 */
export function contactFor(dest: DestKey | undefined): { tel: string | null; map: string | null } {
  if (dest === 'resort') return { tel: CONTACT.resortPhone, map: CONTACT.map };
  if (dest === 'dining-house') return { tel: CONTACT.diningHousePhone, map: null };
  return { tel: null, map: null };
}
```

- [ ] **Bước 4: Lớp đọc điền slug và ánh xạ ẩm thực (`db/queries.ts`)**

Thay dòng `import type { DestKey, Meal, Restaurant } from '@/lib/data';` bằng:

```ts
import { DETAIL_PAGE_IDS, cuisineSlug, type DestKey, type Meal, type Restaurant } from '@/lib/data';
```

Trong `listRestaurants`, thay:

```ts
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    dest: r.destination as DestKey,
    cuisines: r.cuisines,
```

bằng:

```ts
  return rows.map((r) => ({
    id: r.id,
    slug: r.id,
    hasDetailPage: DETAIL_PAGE_IDS.has(r.id),
    name: r.name,
    type: r.type,
    dest: r.destination as DestKey,
    cuisines: r.cuisines.map(cuisineSlug),
```

- [ ] **Bước 5: Cập nhật hai fixture `Restaurant` trong test**

Trong cả `lib/booking.test.ts` và `lib/server/check-reservation.test.ts`, thay:

```ts
const taya: Restaurant = {
  id: 'taya-house',
  name: 'Tàya House',
  type: 'Vietnamese · Cooking Class',
  cuisines: ['Vietnamese'],
```

bằng:

```ts
const taya: Restaurant = {
  id: 'taya-house',
  slug: 'taya-house',
  hasDetailPage: true,
  name: 'Tàya House',
  type: 'Vietnamese · Cooking Class',
  cuisines: ['vietnamese'],
```

- [ ] **Bước 6: Lọc và hiển thị theo key**

`components/home/Cuisines.tsx`, thay:

```tsx
              selected={filter.cuisine === label}
              onPick={() => pickCuisine(label)}
```

bằng:

```tsx
              selected={filter.cuisine === slug}
              onPick={() => pickCuisine(slug)}
```

`components/home/Finder.tsx`:
- Thay `import { CUISINES, DESTS, DEST_KEYS, MEALS } from '@/lib/data';` bằng `import { CUISINES, DESTS, DEST_KEYS, MEALS, MEAL_LABELS } from '@/lib/data';`
- Thay `  ...CUISINES.map(([label]) => ({ value: label, label })),` bằng `  ...CUISINES.map(([label, slug]) => ({ value: slug, label })),`
- Thay `  ...MEALS.map((m) => ({ value: m, label: m })),` bằng `  ...MEALS.map((m) => ({ value: m, label: MEAL_LABELS[m] })),`

`components/home/Restaurants.tsx`:
- Thay `import { DESTS, type DestKey } from '@/lib/data';` bằng `import { DESTS, MEAL_LABELS, cuisineLabel, type DestKey, type Meal } from '@/lib/data';`
- Thay `    chips.push({ label: filter.cuisine, clear: () => setFilter({ cuisine: 'all' }) });` bằng `    chips.push({ label: cuisineLabel(filter.cuisine), clear: () => setFilter({ cuisine: 'all' }) });`
- Thay `    chips.push({ label: filter.occasion, clear: () => setFilter({ occasion: 'all' }) });` bằng `    chips.push({ label: MEAL_LABELS[filter.occasion as Meal], clear: () => setFilter({ occasion: 'all' }) });`

`components/overlays/SearchOverlay.tsx`:
- Thay `import { CUISINES, DESTS, restaurantImage } from '@/lib/data';` bằng `import { CUISINES, DESTS, cuisineLabel, restaurantImage } from '@/lib/data';`
- Thay `        fold([r.name, r.type, r.cuisines.join(' '), DESTS[r.dest]].join(' ')).includes(q),` bằng `        fold([r.name, r.type, r.cuisines.map(cuisineLabel).join(' '), DESTS[r.dest]].join(' ')).includes(q),`
- Thay `                    {r.id === 'taya-house' ? 'View' : 'Reserve'} →` bằng `                    {r.hasDetailPage ? 'View' : 'Reserve'} →`

`components/booking/BookingBar.tsx`:
- Thay `import { DESTS, DEST_KEYS } from '@/lib/data';` bằng `import { DESTS, DEST_KEYS, MEAL_LABELS } from '@/lib/data';`
- Thay ``        note: taken ? 'Full' : left !== null && left <= 6 ? `${left} left` : g.meal,`` bằng ``        note: taken ? 'Full' : left !== null && left <= 6 ? `${left} left` : MEAL_LABELS[g.meal],``

`components/overlays/ReserveDrawer.tsx`:
- Thay `import { DESTS, DEST_KEYS } from '@/lib/data';` bằng `import { DESTS, DEST_KEYS, MEAL_LABELS } from '@/lib/data';`
- Thay `                  <div className="slotgroup-meal">{g.meal}</div>` bằng `                  <div className="slotgroup-meal">{MEAL_LABELS[g.meal]}</div>`

`components/home/RestaurantCard.tsx`: thay `  const isDetailLink = restaurant.id === 'taya-house';` bằng `  const isDetailLink = restaurant.hasDetailPage;`

- [ ] **Bước 7: Trang chi tiết nhận slug**

`components/detail/MoreRestaurants.tsx`. Thay dòng `import { useSite } from '@/components/site/SiteProvider';` bằng:

```tsx
import { DESTS } from '@/lib/data';
import { useSite } from '@/components/site/SiteProvider';
```

Thay:

```tsx
export function MoreRestaurants() {
  const { restaurants, clearFilters, scrollToId } = useSite();
  const title = useReveal<HTMLHeadingElement>('title');
  const link = useReveal<HTMLButtonElement>('fade');

  const others = restaurants.filter((r) => r.dest === 'resort' && r.id !== 'taya-house');
```

bằng:

```tsx
/** The other restaurants at the same destination; hidden when there are none (spec §6.4). */
export function MoreRestaurants({ slug }: { slug: string }) {
  const { restaurants, clearFilters, scrollToId } = useSite();
  const title = useReveal<HTMLHeadingElement>('title');
  const link = useReveal<HTMLButtonElement>('fade');

  const current = restaurants.find((r) => r.slug === slug);
  const others = current ? restaurants.filter((r) => r.dest === current.dest && r.id !== current.id) : [];
  if (!current || others.length === 0) return null;
```

Thay dòng `            More at Furama Resort Danang` bằng `            More at {DESTS[current.dest]}`.

`components/detail/TayaHero.tsx`. Thay `import { CONTACT } from '@/lib/data';` bằng `import { contactFor } from '@/lib/data';`, rồi thay:

```tsx
export function TayaHero() {
  const { goBackToRestaurants, openReserve, scrollToId } = useSite();
  const story = useReveal<HTMLParagraphElement>('up');
```

bằng:

```tsx
export function TayaHero({ slug }: { slug: string }) {
  const { restaurants, goBackToRestaurants, openReserve, scrollToId } = useSite();
  const story = useReveal<HTMLParagraphElement>('up');
  const restaurant = restaurants.find((r) => r.slug === slug);
  const contact = contactFor(restaurant?.dest);
```

và thay:

```tsx
                onClick={() => openReserve({ restaurant: 'taya-house' })}
              >
                RESERVE A TABLE<span className="arrow">→</span>
              </button>
              <a href={`tel:${CONTACT.resortPhone}`} className="taya-link">
                CALL
              </a>
              <a href={CONTACT.map} target="_blank" rel="noopener" className="taya-link">
                MAP
              </a>
```

bằng:

```tsx
                onClick={() => openReserve({ restaurant: restaurant?.id ?? slug })}
              >
                RESERVE A TABLE<span className="arrow">→</span>
              </button>
              {contact.tel && (
                <a href={`tel:${contact.tel}`} className="taya-link">
                  CALL
                </a>
              )}
              {contact.map && (
                <a href={contact.map} target="_blank" rel="noopener" className="taya-link">
                  MAP
                </a>
              )}
```

- [ ] **Bước 8: `MobileBar` vào trang, chrome thôi render nó**

`components/site/MobileBar.tsx`. Thay toàn bộ phần từ đầu file tới hết thẻ mở của nút RESERVE (`onClick` cũ gọi `setBooking({ restaurant: 'taya-house' })`):

```tsx
import { CONTACT } from '@/lib/data';
import { useSite } from '@/components/site/SiteProvider';

export function MobileBar() {
  const { view, tab, openReserve, scrollToId, setBooking, close } = useSite();

  if (view === 'detail') {
    return (
      <nav className="tabbar tabbar-detail" aria-label="Restaurant actions">
        <a href={`tel:${CONTACT.resortPhone}`}>CALL</a>
        <a href={CONTACT.map} target="_blank" rel="noopener">
          MAP
        </a>
        <button type="button" onClick={() => openMenuPdf(() => scrollToId('dishes'))}>
          MENU
        </button>
        <button
          type="button"
          className="tabbar-primary"
          onClick={() => {
            setBooking({ restaurant: 'taya-house' });
            openReserve({ restaurant: 'taya-house' });
          }}
        >
```

bằng (dòng `'use client';` ở đầu file giữ nguyên):

```tsx
import { CONTACT, contactFor } from '@/lib/data';
import { useSite } from '@/components/site/SiteProvider';

/**
 * The phone tab bar. Each page renders its own, so the right variant is in the
 * server HTML: the home page passes nothing, a restaurant page passes its slug.
 */
export function MobileBar({ slug }: { slug?: string }) {
  const { restaurants, tab, openReserve, scrollToId, setBooking, close } = useSite();

  if (slug) {
    const restaurant = restaurants.find((r) => r.slug === slug);
    const id = restaurant?.id ?? slug;
    const contact = contactFor(restaurant?.dest);
    // One column per button shown (spec §6.4): MENU and RESERVE always, CALL and MAP when known.
    const columns = 2 + (contact.tel ? 1 : 0) + (contact.map ? 1 : 0);
    return (
      <nav
        className="tabbar tabbar-detail"
        aria-label="Restaurant actions"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {contact.tel && <a href={`tel:${contact.tel}`}>CALL</a>}
        {contact.map && (
          <a href={contact.map} target="_blank" rel="noopener">
            MAP
          </a>
        )}
        <button type="button" onClick={() => openMenuPdf(() => scrollToId('dishes'))}>
          MENU
        </button>
        <button
          type="button"
          className="tabbar-primary"
          onClick={() => {
            setBooking({ restaurant: id });
            openReserve({ restaurant: id });
          }}
        >
```

`components/site/Chrome.tsx`:
- Xóa dòng `import { MobileBar } from '@/components/site/MobileBar';`
- Xóa dòng `      <MobileBar />` cùng dòng trống ngay sau nó.

- [ ] **Bước 9: `SiteProvider` nhận nhà hàng mặc định qua prop; các trang render `MobileBar`**

`components/site/SiteProvider.tsx`. Thay:

```tsx
export function SiteProvider({
  restaurants,
  children,
}: {
  restaurants: Restaurant[];
  children: React.ReactNode;
}) {
```

bằng:

```tsx
export function SiteProvider({
  restaurants,
  defaultRestaurantId,
  children,
}: {
  restaurants: Restaurant[];
  /** The restaurant the booking bar starts on (DEFAULT_RESTAURANT_ID until phase 6). */
  defaultRestaurantId: string;
  children: React.ReactNode;
}) {
```

Thay:

```tsx
  const [booking, setBookingState] = useState<Booking>({
    destination: 'resort',
    restaurant: 'taya-house',
    date: '',
    time: '19:00',
    guests: 2,
  });
```

bằng:

```tsx
  const [booking, setBookingState] = useState<Booking>(() => {
    const first = restaurants.find((r) => r.id === defaultRestaurantId) ?? restaurants[0];
    return { destination: first?.dest ?? 'resort', restaurant: first?.id ?? '', date: '', time: '19:00', guests: 2 };
  });
```

Trong `openRestaurant`, thay:

```tsx
      if (r.id === 'taya-house') {
        setBooking({ restaurant: 'taya-house' });
```

bằng:

```tsx
      if (r.hasDetailPage) {
        setBooking({ restaurant: r.id });
```

`app/layout.tsx`:
- Ngay sau dòng `import { listRestaurants } from '@/db/queries';`, thêm `import { DEFAULT_RESTAURANT_ID } from '@/lib/data';`
- Thay `          <SiteProvider restaurants={restaurants}>` bằng `          <SiteProvider restaurants={restaurants} defaultRestaurantId={DEFAULT_RESTAURANT_ID}>`

`app/page.tsx`:
- Ngay sau dòng `import { IntroTrigger } from '@/components/site/IntroTrigger';`, thêm `import { MobileBar } from '@/components/site/MobileBar';`
- Thay:

```tsx
      <Offers />
    </main>
```

bằng:

```tsx
      <Offers />
      <MobileBar />
    </main>
```

`app/taya-house/page.tsx`. Thay dòng `import { IntroTrigger } from '@/components/site/IntroTrigger';` bằng:

```tsx
import { IntroTrigger } from '@/components/site/IntroTrigger';
import { MobileBar } from '@/components/site/MobileBar';

/* This route becomes /[lang]/restaurants/[slug] in the route move; until then its slug is fixed. */
const SLUG = 'taya-house';
```

và thay:

```tsx
      <TayaHero />
      <TayaExperiences />
      <MoreRestaurants />
    </main>
```

bằng:

```tsx
      <TayaHero slug={SLUG} />
      <TayaExperiences />
      <MoreRestaurants slug={SLUG} />
      <MobileBar slug={SLUG} />
    </main>
```

- [ ] **Bước 10: Chạy để thấy pass, và kiểm không còn chỗ viết riêng cho Tàya**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/data.test.ts test/integration/catalogue.test.ts lib/booking.test.ts lib/server/check-reservation.test.ts`
Expected: PASS, không test nào đỏ.

Run: `grep -rn "taya-house" components lib/motion.tsx`
Expected: đúng một dòng, `components/site/SiteProvider.tsx:39:const DETAIL_PATH = '/taya-house';`. Đó là đường dẫn route cũ, Task 7 xóa nó.
Mẫu grep không có dấu nháy, để bắt mọi dạng: `'taya-house'`, `"taya-house"`, chuỗi template và `/taya-house`.

- [ ] **Bước 11: Chạy toàn bộ kiểm tra, có visual**

```bash
npm run lint
TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
npm run typecheck
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run test:e2e
lsof -nP -iTCP:3201 -sTCP:LISTEN
```

Expected:
- lint thoát 0;
- `Test Files  17 passed (17)`, `Tests  144 passed (144)`;
- build xanh, vẫn `○ / 1h 1y`;
- typecheck sạch;
- E2E `9 passed`;
- `lsof` không in gì.

Chạy server dưới nền: `PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npx next start -p 3201`

Đợi server nhận kết nối: `for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3201/ && break; sleep 1; done`

Run: `VISUAL_BASE_URL=http://localhost:3201 npm run test:visual`
Expected: `8 passed` (hoặc `6 passed` cộng `2 skipped` nếu Task 1 Bước 7 đã dùng phương án dự phòng). Nếu đỏ:
- Mở `test-results/**/*-diff.png`.
- Khác ở chip lọc hay tab bar thì so lại Bước 6–8. Hay gặp nhất: một chỗ còn dùng nhãn thay cho slug, hoặc tab bar thiếu nút CALL/MAP vì `restaurants.find` không thấy slug.
- Không sửa baseline.

Dừng server: `lsof -ti tcp:3201 | xargs kill`

- [ ] **Bước 12: Commit**

```bash
git add lib/data.ts lib/data.test.ts db/queries.ts lib/booking.test.ts lib/server/check-reservation.test.ts test/integration/catalogue.test.ts e2e/filters.spec.ts components/home/Cuisines.tsx components/home/Finder.tsx components/home/Restaurants.tsx components/home/RestaurantCard.tsx components/overlays/SearchOverlay.tsx components/booking/BookingBar.tsx components/overlays/ReserveDrawer.tsx components/detail/MoreRestaurants.tsx components/detail/TayaHero.tsx components/site/MobileBar.tsx components/site/Chrome.tsx components/site/SiteProvider.tsx app/layout.tsx app/page.tsx app/taya-house/page.tsx
git commit -m "$(cat <<'EOF'
refactor: key restaurants by slug and drop the Tàya House special cases

Restaurant gains slug and hasDetailPage (constants until phase 6), cuisines
are filtered by slug instead of their English label, meals keep their enum
key with a separate display map, and the default booking restaurant is a
prop. Components that named 'taya-house' now take a slug; the phone tab bar
renders inside each page, and CALL/MAP come from the destination and hide
when missing. Screenshots are unchanged at a zero-pixel threshold.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Slide hero và chấm hành trình tính theo số lượng thật

Spec §6.3 ý 3. Phần này dàn ý ghi "unverified"; visual ở ngưỡng 0 ghim nó, và đã chạy thử trong `plan-verify`.
- Slide hiện tại và bộ hẹn giờ autoplay chuyển từ `SiteProvider` vào `Hero`. Nhờ vậy autoplay tự dừng khi trang chủ bị ẩn.
- Vị trí đường hành trình và các chấm tính từ `DESTINATION_CARDS.length`. Với 4 thẻ, hàm cho đúng 12.5/37.5/62.5/87.5.

**Files:**
- Create: `lib/journey.ts`, `lib/journey.test.ts`
- Modify: `components/home/Hero.tsx`, `components/home/Destinations.tsx`, `styles/home.css:624-628`, `components/site/SiteProvider.tsx`, `e2e/smoke.spec.ts`

**Interfaces:**
- Consumes:
  - `HERO_SLIDES`, `DESTINATION_CARDS` từ `lib/data.ts`;
  - `readMotionLevel` từ `lib/motion.tsx`;
  - `HOME_PATH` từ `e2e/paths.ts`.
- Produces:
  - `journeyStops(count: number): { inset: number; stops: number[] }`.
  - `useSite()` **mất** `slide` và `goSlide`. Chỉ `Hero` từng dùng chúng.

- [ ] **Bước 1: Viết test**

Create `lib/journey.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { journeyStops } from './journey';

describe('journeyStops', () => {
  it('puts four dots exactly where the design had them', () => {
    expect(journeyStops(4)).toEqual({ inset: 12.5, stops: [12.5, 37.5, 62.5, 87.5] });
  });

  it('centres a dot over each card for the other allowed counts (2 to 5)', () => {
    expect(journeyStops(2)).toEqual({ inset: 25, stops: [25, 75] });
    expect(journeyStops(5)).toEqual({ inset: 10, stops: [10, 30, 50, 70, 90] });
    const three = journeyStops(3);
    expect(three.inset).toBeCloseTo(16.667, 3);
    expect(three.stops.map((s) => Math.round(s * 100) / 100)).toEqual([16.67, 50, 83.33]);
  });
});
```

Trong `e2e/smoke.spec.ts`, thay dòng `import { expect, test } from '@playwright/test';` bằng:

```ts
import { expect, test } from '@playwright/test';
import { HERO_SLIDES } from '../lib/data';
import { HOME_PATH } from './paths';
```

rồi thay test hiện có bằng hai test:

```ts
test('home page lists the restaurant catalogue', async ({ page }) => {
  await page.goto(HOME_PATH);
  await expect(page.locator('.rcard')).toHaveCount(12);
});

test('the hero has one dot per slide, and a dot shows its slide', async ({ page }) => {
  await page.goto(HOME_PATH);
  await expect(page.locator('.hero-dots .hero-dot')).toHaveCount(HERO_SLIDES.length);
  await page.locator('.hero-dot').nth(1).click();
  await expect(page.locator('.hero-slide').nth(1)).toHaveAttribute('data-active', 'true');
  await expect(page.locator('.hero-slide').nth(0)).toHaveAttribute('data-active', 'false');
});
```

- [ ] **Bước 2: Chạy để thấy lỗi**

Run: `npx vitest run lib/journey.test.ts`
Expected: FAIL `Error: Cannot find module './journey'`.

Test smoke mới ghim hành vi bấm chấm hiện có. Nó phải xanh cả trước lẫn sau khi chuyển slide vào `Hero`. Kiểm phần "trước" ngay bây giờ, trên bản build Task 5 còn trong `.next` (không build lại):

```bash
lsof -nP -iTCP:3100 -sTCP:LISTEN
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npx playwright test e2e/smoke.spec.ts --retries 0
```

Expected: `lsof` không in gì; Playwright `2 passed`. Nếu ca chấm hero đỏ ở đây thì lỗi nằm ở test, không phải ở phần chuyển slide: sửa test trước khi sang Bước 3.

- [ ] **Bước 3: Viết `lib/journey.ts` và dùng nó trong `Destinations`**

Create `lib/journey.ts`:

```ts
/**
 * Where the dotted journey line under "Our Destinations" puts its dots, as a
 * percentage of its width: one centred over each of `count` equal columns
 * (12.5, 37.5, 62.5, 87.5 for four cards), and the inset that makes the line
 * start and end on the outer dots.
 */
export function journeyStops(count: number): { inset: number; stops: number[] } {
  return {
    inset: 50 / count,
    stops: Array.from({ length: count }, (_, i) => ((2 * i + 1) * 50) / count),
  };
}
```

`components/home/Destinations.tsx`:
- Ngay sau dòng import `DESTINATION_CARDS`, thêm `import { journeyStops } from '@/lib/journey';`
- Ngay sau dòng `  const journey = useReveal<HTMLDivElement>('journey');`, thêm `  const { inset, stops } = journeyStops(DESTINATION_CARDS.length);`
- Thay:

```tsx
          <div data-jline="1" className="journey-line" />
          {[12.5, 37.5, 62.5, 87.5].map((left) => (
            <span key={left} data-jdot="1" className="journey-dot" style={{ left: `${left}%` }} />
          ))}
```

bằng:

```tsx
          <div data-jline="1" className="journey-line" style={{ left: `${inset}%`, right: `${inset}%` }} />
          {stops.map((left) => (
            <span key={left} data-jdot="1" className="journey-dot" style={{ left: `${left}%` }} />
          ))}
```

`styles/home.css`. Thay:

```css
.journey-line {
  position: absolute;
  left: 12.5%;
  right: 12.5%;
  top: 6px;
```

bằng:

```css
/* left and right come from the card count (components/home/Destinations.tsx). */
.journey-line {
  position: absolute;
  top: 6px;
```

- [ ] **Bước 4: Slide và autoplay chuyển vào `Hero`**

`components/home/Hero.tsx`. Thay phần import:

```tsx
'use client';

import { HERO_SLIDES } from '@/lib/data';
import { useSite } from '@/components/site/SiteProvider';
```

bằng:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { HERO_SLIDES } from '@/lib/data';
import { useSite } from '@/components/site/SiteProvider';
import { readMotionLevel } from '@/lib/motion';
```

Thay:

```tsx
export function Hero() {
  const { slide, goSlide, open, scrollToId } = useSite();
```

bằng:

```tsx
export function Hero() {
  const { open, overlay, scrollToId } = useSite();
  const [slide, setSlide] = useState(0);
  const count = HERO_SLIDES.length;

  /* Slideshow: desktop only, paused behind an overlay or a hidden tab. It lives
     in the hero, so it stops whenever the home page is not on screen. */
  useEffect(() => {
    if (overlay || count < 2 || !readMotionLevel()) return;
    const timer = window.setInterval(() => {
      if (document.hidden || window.innerWidth < 760) return;
      setSlide((s) => (s + 1) % count);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [count, overlay]);
```

Thay khối các chấm:

```tsx
          <div className="hero-dots" data-intro="6">
            {HERO_SLIDES.map((s, i) => (
              <button
                key={s.id}
                type="button"
                aria-label={`Slide ${i + 1}`}
                aria-current={i === slide}
                onClick={() => goSlide(i)}
                className="hero-dot"
              >
                <span data-active={i === slide} />
              </button>
            ))}
          </div>
```

bằng:

```tsx
          {count > 1 && (
            <div className="hero-dots" data-intro="6">
              {HERO_SLIDES.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  aria-label={`Slide ${i + 1}`}
                  aria-current={i === slide}
                  onClick={() => setSlide(i)}
                  className="hero-dot"
                >
                  <span data-active={i === slide} />
                </button>
              ))}
            </div>
          )}
```

`components/site/SiteProvider.tsx`, gỡ phần slide:
- Xóa dòng `import { readMotionLevel } from '@/lib/motion';`
- Trong `type SiteState`, xóa hai dòng `  slide: number;` và `  goSlide: (i: number) => void;` cùng dòng trống theo sau.
- Xóa dòng `  const [slide, setSlide] = useState(0);`
- Xóa dòng `  const goSlide = useCallback((i: number) => setSlide(i), []);`
- Xóa cả effect (kèm dòng trống theo sau):

```tsx
  /* Hero slideshow: desktop only, paused behind an overlay or a hidden tab. */
  useEffect(() => {
    if (view !== 'home' || overlay || !readMotionLevel()) return;
    const timer = window.setInterval(() => {
      if (document.hidden || window.innerWidth < 760) return;
      setSlide((s) => (s + 1) % 3);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [overlay, view]);
```

- Trong object `value`, xóa hai dòng `      slide,` và `      goSlide,`.
- Trong mảng deps của `useMemo`, thay `goBackToRestaurants, goHomeTop, goSlide, lang, matches,` bằng `goBackToRestaurants, goHomeTop, lang, matches,`, và thay `shownCount, slide, submit, tab,` bằng `shownCount, submit, tab,`.

- [ ] **Bước 5: Chạy để thấy pass**

Run: `npx vitest run lib/journey.test.ts`
Expected: PASS `Tests  2 passed (2)`.

Run: `grep -n "goSlide\|setSlide\|slide:\|slide," components/site/SiteProvider.tsx`
Expected: không in gì (exit 1).

- [ ] **Bước 6: Chạy toàn bộ kiểm tra, có visual**

```bash
npm run lint
TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
npm run typecheck
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run test:e2e
lsof -nP -iTCP:3201 -sTCP:LISTEN
```

Expected:
- lint thoát 0;
- `Test Files  18 passed (18)`, `Tests  146 passed (146)`;
- build xanh;
- typecheck sạch;
- E2E `10 passed`;
- `lsof` không in gì.

Chạy server dưới nền: `PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npx next start -p 3201`

Đợi server nhận kết nối: `for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3201/ && break; sleep 1; done`

Run: `VISUAL_BASE_URL=http://localhost:3201 npm run test:visual`
Expected: `8 passed` (hoặc `6 passed` cộng `2 skipped` nếu Task 1 Bước 7 đã dùng phương án dự phòng). Nếu ảnh desktop `home` đỏ ở dải "Our Destinations", kiểm tra:
- `.journey-line` có đúng `left: 12.5%; right: 12.5%` lúc chạy hay không (DevTools);
- dòng `left`/`right` trong `home.css` đã thật sự bị xóa.

Không sửa baseline.

Dừng server: `lsof -ti tcp:3201 | xargs kill`

- [ ] **Bước 7: Commit**

```bash
git add lib/journey.ts lib/journey.test.ts components/home/Hero.tsx components/home/Destinations.tsx styles/home.css components/site/SiteProvider.tsx e2e/smoke.spec.ts
git commit -m "$(cat <<'EOF'
refactor: size the hero slideshow and journey dots from the real counts

The slideshow wrapped at a hard-coded 3 and the journey dots sat at four
fixed percentages. The slide state and its autoplay now live in Hero and
wrap at HERO_SLIDES.length (dots only when there is more than one), and the
journey line and dots are computed from the number of destination cards,
which gives the same 12.5/37.5/62.5/87.5 for today's four.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `ViewMarker` và truy vấn DOM theo trang (route hiện tại, chưa bật Cache Components)

Spec §6.3 ý 8 và phán quyết 5. Code lấy nguyên từ `lead-verify` (bản spike-cc đã kiểm ở V2 và V3). Chỗ khác duy nhất: chưa có tiền tố ngôn ngữ, nên trang chủ là `'/'` và trang chi tiết là `` `/${r.slug}` ``. Task 9 thay hai giá trị này.

Từ đây trở đi:
- `SiteProvider` không còn đọc `usePathname()`.
- Mỗi trang tự đăng ký bằng `<ViewMarker>`.
- Mọi truy vấn DOM của trang chỉ tìm trong `<main>` của trang đang hiện.

Không có Activity, đổi trang vẫn remount như cũ. Bộ `page-scope.spec.ts` vì thế xanh cả trước lẫn sau, trừ ca cấu trúc. Đó là lưới an toàn cho Task 8. Test đỏ trước của task này là ca cấu trúc (`<main data-view>`) và test chặn truy vấn toàn document.

**Files:**
- Create: `components/site/ViewMarker.tsx`, `lib/page-scope.guard.test.ts`, `e2e/page-scope.spec.ts`, `e2e/nojs.spec.ts`
- Modify:
  - `components/site/SiteProvider.tsx`, `components/site/PageCurtain.tsx`, `components/site/IntroTrigger.tsx`
  - `components/site/Chrome.tsx`, `components/site/Header.tsx`, `components/site/MobileBar.tsx`
  - `lib/motion.tsx`, `styles/booking.css`, `styles/layout.css`
  - `app/page.tsx`, `app/taya-house/page.tsx`, `e2e/booking-dates.spec.ts`

**Interfaces:**
- Consumes:
  - Task 5: `Restaurant.slug`, `Restaurant.hasDetailPage`, `MobileBar({ slug })`;
  - Task 1: `HOME_PATH`, `DETAIL_PATH` từ `e2e/paths.ts`.
- Produces:
  - `type View = 'home' | 'detail'`. Task 9 thêm `'other'`.
  - `type PageView = { view: View; restaurant: string | null; root: HTMLElement }`. `restaurant` là slug của trang chi tiết.
  - `useSite()` có thêm `pageRoot: HTMLElement | null` và `showPage(page: PageView): () => void`, và **mất** `navigate`. `view` giờ có kiểu `View`, giá trị `'home'` cho tới khi trang đầu tiên đăng ký.
  - `<ViewMarker view: View restaurant?: string>{children}</ViewMarker>` render `<main data-view={view}>` và set `html[data-view]`.
  - `usePageRoot(): RefObject<HTMLElement | null> | null`.
  - `useIntro(active: boolean, baseDelay?: number, root?: RefObject<HTMLElement | null> | null)`.
  - `useScrollMotion(overlayOpen: boolean, page: HTMLElement | null)`.

- [ ] **Bước 1: Viết test chặn truy vấn toàn document**

Create `lib/page-scope.guard.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * With Cache Components the router keeps the page you left in the document,
 * hidden by <Activity>. A document-wide query can then find the hidden page's
 * element instead of the visible one (the header's DESTINATIONS link on the
 * restaurant page did nothing in the phase-2 spike). Page content is queried
 * inside the visible page's root (useSite().pageRoot, usePageRoot()); only
 * these chrome-level queries may search the whole document.
 */
const ALLOWED = [
  "lib/motion.tsx: querySelectorAll('[data-header]')", // the headers live in the chrome
  'lib/motion.tsx: querySelectorAll(selector)', // overlay entrances (animateSelector)
];

const QUERY =
  /document\.(getElementById|querySelectorAll|querySelector|getElementsByClassName|getElementsByTagName)(?:<[^>]*>)?\(([^)]*)\)/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('DOM queries', () => {
  it('search the visible page, not the whole document', () => {
    const found = ['app', 'components', 'lib'].flatMap((dir) =>
      sources(dir).flatMap((file) =>
        [...readFileSync(file, 'utf8').matchAll(QUERY)].map((m) => `${file}: ${m[1]}(${m[2]})`),
      ),
    );
    expect(found.filter((q) => !ALLOWED.includes(q))).toEqual([]);
  });
});
```

- [ ] **Bước 2: Viết test E2E cho chuyện chuyển trang và cho khách không bật JS**

Create `e2e/page-scope.spec.ts`. So với `lv/behaviour.spec.ts` của spike, có ba thay đổi:
- các lần chờ cố định được đổi thành `expect.poll`;
- thêm ca cấu trúc ở đầu file;
- sau mỗi test, kiểm tra không có lỗi React nào trên console.

```ts
import { expect, test, type Page } from '@playwright/test';
import { DETAIL_PATH, HOME_PATH } from './paths';

/*
 * Moving between the home page and a restaurant page. With Cache Components the
 * router keeps the page you left mounted but hidden (<Activity>): its DOM, its
 * ids and its data-intro-done flags stay in the document. Every case below broke
 * on that in the phase-2 spike, so each must hold with and without it.
 */
test.use({ reducedMotion: 'no-preference' });

let reactErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  reactErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /hydrat|did not match|#418|#423|#425/i.test(m.text())) reactErrors.push(m.text());
  });
  page.on('pageerror', (e) => reactErrors.push(e.message));
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

test.afterEach(() => {
  expect(reactErrors).toEqual([]);
});

type CurtainWindow = Window & { __curtain?: string[] };

/** Records every change of the page curtain's data-active from now on. */
async function recordCurtain(page: Page) {
  await page.evaluate(() => {
    const el = document.querySelector('.page-curtain');
    if (!el) throw new Error('no .page-curtain');
    const w = window as CurtainWindow;
    w.__curtain = [];
    new MutationObserver(() => w.__curtain?.push(el.getAttribute('data-active') ?? '')).observe(el, {
      attributes: true,
      attributeFilter: ['data-active'],
    });
  });
}

const curtainLog = (page: Page) => page.evaluate(() => (window as CurtainWindow).__curtain ?? []);

/** Distance from the visible copy of #id (hidden pages keep theirs) to the 75px header offset. */
const offsetFromHeader = (page: Page, id: string) =>
  page.evaluate((id) => {
    const shown = [...document.querySelectorAll<HTMLElement>(`[id="${id}"]`)].find(
      (e) => e.getClientRects().length > 0,
    );
    return shown ? Math.abs(Math.round(shown.getBoundingClientRect().top) - 75) : Infinity;
  }, id);

const tayaCard = (page: Page) => page.locator('.rcard:visible', { hasText: 'Tàya House' }).first();

async function openTaya(page: Page) {
  await tayaCard(page).click();
  await page.waitForURL((u) => u.pathname === DETAIL_PATH);
  await expect(page.locator('.taya-kicker:visible')).toHaveCSS('opacity', '1');
}

test('each page owns its <main data-view>, and the document says which page is showing', async ({ page }) => {
  await page.goto(HOME_PATH);
  await expect(page.locator('main[data-view="home"]')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('data-view', 'home');
  await openTaya(page);
  await expect(page.locator('main[data-view="detail"]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-view', 'detail');
});

test('a card opens the restaurant page under the curtain, at the top', async ({ page }) => {
  await page.goto(HOME_PATH);
  await recordCurtain(page);
  await openTaya(page);
  await expect.poll(() => curtainLog(page)).toEqual(['true', 'false']);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('the header on a restaurant page goes home and scrolls to the section', async ({ page }) => {
  await page.goto(HOME_PATH);
  await openTaya(page);
  await page.locator('.hdr-full .hdr-link', { hasText: 'DESTINATIONS' }).click();
  await page.waitForURL((u) => u.pathname === HOME_PATH, { timeout: 5000 });
  await expect.poll(() => offsetFromHeader(page, 'destinations'), { timeout: 5000 }).toBeLessThan(40);
});

test('back from a restaurant page lands on the restaurant list', async ({ page }) => {
  await page.goto(HOME_PATH);
  await openTaya(page);
  await page.locator('.taya-back:visible').click();
  await page.waitForURL((u) => u.pathname === HOME_PATH);
  await expect.poll(() => offsetFromHeader(page, 'restaurants'), { timeout: 5000 }).toBeLessThan(40);
  await expect(page.locator('.hero-kicker')).toHaveCSS('opacity', '1');
});

test('the logo on a restaurant page opened directly goes to the top of home', async ({ page }) => {
  await page.goto(DETAIL_PATH);
  await expect(page.locator('.taya-kicker')).toHaveCSS('opacity', '1');
  await page.locator('.hdr-full .hdr-logo').click();
  await page.waitForURL((u) => u.pathname === HOME_PATH);
  await expect(page.locator('.hero-kicker')).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('a second visit to the restaurant page plays its entrance again', async ({ page }) => {
  await page.goto(HOME_PATH);
  await openTaya(page);
  await page.locator('.taya-back:visible').click();
  await page.waitForURL((u) => u.pathname === HOME_PATH);
  await expect(page.locator('.page-curtain')).toHaveAttribute('data-active', 'false');
  await tayaCard(page).click();
  await page.waitForURL((u) => u.pathname === DETAIL_PATH);
  // An entrance means the kicker starts below full opacity right after the curtain lifts.
  const samples: number[] = [];
  for (let i = 0; i < 20; i++) {
    samples.push(Number(await page.locator('.taya-kicker:visible').evaluate((e) => getComputedStyle(e).opacity)));
    await page.waitForTimeout(50);
  }
  expect(samples.some((o) => o < 1)).toBe(true);
});
```

Create `e2e/nojs.spec.ts`. File này chạy trong CI; nó thay cho phần visual no-JS, vốn chỉ chạy cục bộ:

```ts
import { expect, test } from '@playwright/test';
import { DETAIL_PATH, HOME_PATH } from './paths';

/* What a visitor or a crawler without JavaScript gets: the server HTML alone. */
test.use({ javaScriptEnabled: false });

test('the home page lists every restaurant', async ({ page }) => {
  await page.goto(HOME_PATH);
  await expect(page.locator('.rcard')).toHaveCount(12);
});

test('the restaurant page is in the HTML itself, not streamed in by a script', async ({ page, request }) => {
  await page.goto(DETAIL_PATH);
  await expect(page.locator('.taya-kicker')).toBeVisible();
  const html = await (await request.get(DETAIL_PATH)).text();
  expect(html).toContain('taya-kicker');
  expect(html).not.toContain('hidden id="S:');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the restaurant page swaps the header and booking bar for its own tab bar', async ({ page }) => {
    await page.goto(HOME_PATH);
    await expect(page.locator('.hdr-compact')).toBeVisible();
    await expect(page.locator('.booking-slot')).toBeVisible();

    await page.goto(DETAIL_PATH);
    await expect(page.locator('.hdr-compact')).toBeHidden();
    await expect(page.locator('.booking-slot')).toBeHidden();
    await expect(page.locator('.tabbar-detail')).toBeVisible();
  });
});
```

Trong `e2e/booking-dates.spec.ts`:
- Ngay sau dòng `import { expect, test } from '@playwright/test';`, thêm `import { DETAIL_PATH, HOME_PATH } from './paths';`
- Thay cả năm chỗ `await page.goto('/');` bằng `await page.goto(HOME_PATH);`
- Trong `test.describe('hydration', …)`, thay test `'the home page hydrates without React errors'` bằng một vòng lặp chạy cho cả hai trang:

```ts
  for (const [name, path] of [
    ['home', HOME_PATH],
    ['restaurant', DETAIL_PATH],
  ] as const) {
    test(`the ${name} page hydrates without React errors`, async ({ page }) => {
      const problems: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') problems.push(m.text());
      });
      page.on('pageerror', (e) => problems.push(e.message));
      await page.clock.setFixedTime(new Date(Date.now() + 3 * 86_400_000));
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(problems.filter((p) => /hydrat|#418|#423|#425/i.test(p))).toEqual([]);
    });
  }
```

- [ ] **Bước 3: Chạy để thấy lỗi**

Run: `npx vitest run lib/page-scope.guard.test.ts`
Expected: FAIL. Mảng nhận được liệt kê 7 truy vấn:
- `components/site/SiteProvider.tsx: getElementById(id)` (2 lần), `getElementById('restaurants')`, `getElementById('destinations')`;
- `lib/motion.tsx: querySelectorAll('[data-intro]')`, `querySelectorAll('[data-parallax]')`, `querySelector('[data-hero-content]')`.

Chạy E2E trên bản build Task 6 để lại. **Không build lại ở bước này.**

Run: `CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npx playwright test e2e/page-scope.spec.ts e2e/nojs.spec.ts e2e/booking-dates.spec.ts --retries 0`

Expected: `1 failed, 14 passed`.
- Ca đỏ là `each page owns its <main data-view>…`, với `expect(locator).toHaveCount(expected) failed`, `Expected: 1`, `Received: 0`.
- Năm ca chuyển trang, ba ca no-JS và hai ca hydration xanh. Chúng ghim hành vi hiện có, nên phải giữ xanh.

- [ ] **Bước 4: Tạo `ViewMarker`**

Create `components/site/ViewMarker.tsx`:

```tsx
'use client';

import { createContext, useContext, useLayoutEffect, useRef, type RefObject } from 'react';
import { useSite, type View } from '@/components/site/SiteProvider';

const PageRootContext = createContext<RefObject<HTMLElement | null> | null>(null);

/** The <main> of the page this component sits in. */
export function usePageRoot(): RefObject<HTMLElement | null> | null {
  return useContext(PageRootContext);
}

/**
 * Each page's root. It tells the shared chrome which page is showing, instead
 * of the chrome reading usePathname() (which turns the whole layout into a
 * dynamic hole when a route param is unknown at build time).
 *
 * The registration lives in a layout effect on purpose: with Cache Components
 * the router keeps the previous page mounted but hidden in <Activity>, and
 * effects are torn down when a page hides and set up again when it shows. So
 * "the registered page" is always the visible one, and its <main> is the
 * container every DOM query should search.
 */
export function ViewMarker({
  view,
  restaurant,
  children,
}: {
  view: View;
  restaurant?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const { showPage } = useSite();

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    return showPage({ view, restaurant: restaurant ?? null, root });
  }, [showPage, view, restaurant]);

  return (
    <PageRootContext value={ref}>
      <main ref={ref} data-view={view}>
        {children}
      </main>
    </PageRootContext>
  );
}
```

- [ ] **Bước 5: `SiteProvider` biết trang nào đang hiện và chỉ tìm trong trang đó**

Trong `components/site/SiteProvider.tsx`, sửa theo thứ tự sau.

5a. Thay `import { usePathname, useRouter } from 'next/navigation';` bằng `import { useRouter } from 'next/navigation';`

5b. Thay:

```tsx
export type Overlay = 'drawer' | 'search' | 'menu' | 'film' | 'sheet';

const EMPTY_FORM: BookingForm = { name: '', phone: '', email: '', note: '' };
const DETAIL_PATH = '/taya-house';
```

bằng:

```tsx
export type Overlay = 'drawer' | 'search' | 'menu' | 'film' | 'sheet';
export type View = 'home' | 'detail';

/** The page currently on screen, as registered by its <ViewMarker>. `restaurant` is a detail page's slug. */
export type PageView = { view: View; restaurant: string | null; root: HTMLElement };

const EMPTY_FORM: BookingForm = { name: '', phone: '', email: '', note: '' };
```

5c. Thay:

```tsx
type SiteState = {
  restaurants: Restaurant[];
  view: 'home' | 'detail';
```

bằng:

```tsx
type SiteState = {
  restaurants: Restaurant[];
  /** Which page is showing; 'home' until the first <ViewMarker> registers. */
  view: View;
  /** The visible page's <main>; DOM queries search inside it. */
  pageRoot: HTMLElement | null;
  /** Called by <ViewMarker> when its page shows; returns the hide callback. */
  showPage: (page: PageView) => () => void;
```

5d. Thay:

```tsx
  openRestaurant: (r: Restaurant) => void;
  navigate: (view: 'home' | 'detail') => void;
};
```

bằng:

```tsx
  openRestaurant: (r: Restaurant) => void;
};
```

5e. Thay:

```tsx
  const router = useRouter();
  const pathname = usePathname();
  const view: 'home' | 'detail' = pathname === DETAIL_PATH ? 'detail' : 'home';
```

bằng:

```tsx
  const router = useRouter();
  /* Today's URLs; the route move under /[lang] (Task 9) swaps these for lib/i18n/href. */
  const home = '/';
  const [page, setPage] = useState<PageView | null>(null);
  const view: View = page?.view ?? 'home';
  /* Changes once per page shown; DOM-dependent effects key on it. */
  const pageRoot = page?.root ?? null;

  const showPage = useCallback((next: PageView) => {
    setPage(next);
    // Drives the view-specific chrome CSS (styles/layout.css, styles/booking.css).
    document.documentElement.dataset.view = next.view;
    return () => setPage((cur) => (cur === next ? null : cur));
  }, []);
```

5f. Thay toàn bộ khối từ `  const scrollTo = useCallback((id: string) => {` tới hết `goBackToRestaurants` (khối này gồm `scrollTo`, `scrollToId`, effect pending-scroll, `navigate`, `goHomeTop`, `goBackToRestaurants`):

```tsx
  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const offset = window.innerWidth < 1080 ? 63 : 75;
    window.scrollTo({
      top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - offset),
      behavior: 'smooth',
    });
  }, []);

  const scrollToId = useCallback(
    (id: string) => {
      setOverlay(null);
      setOpenDropdown(null);
      if (!document.getElementById(id) && view !== 'home') {
        pendingScroll.current = id;
        coverThen(() => router.push('/'));
        return;
      }
      window.setTimeout(() => scrollTo(id), 30);
    },
    [router, scrollTo, view],
  );

  /* A cross-view scroll target survives the route change and fires once the
     destination section is in the DOM. */
  useEffect(() => {
    const id = pendingScroll.current;
    if (!id) return;
    pendingScroll.current = null;
    const frame = requestAnimationFrame(() => scrollTo(id));
    return () => cancelAnimationFrame(frame);
  }, [pathname, scrollTo]);

  const navigate = useCallback(
    (next: 'home' | 'detail') => {
      if (next === view) return;
      setOverlay(null);
      setOpenDropdown(null);
      coverThen(() => router.push(next === 'detail' ? DETAIL_PATH : '/'));
    },
    [router, view],
  );

  const goHomeTop = useCallback(() => {
    setOverlay(null);
    if (view !== 'home') coverThen(() => router.push('/'));
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [router, view]);

  const goBackToRestaurants = useCallback(() => {
    pendingScroll.current = 'restaurants';
    setOverlay(null);
    coverThen(() => router.push('/'));
  }, [router]);
```

bằng:

```tsx
  /* Only the visible page counts: hidden <Activity> pages keep their sections in the DOM. */
  const findSection = useCallback(
    (id: string) => page?.root.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`) ?? null,
    [page],
  );

  const scrollTo = useCallback((id: string) => {
    const el = findSection(id);
    if (!el) return;
    const offset = window.innerWidth < 1080 ? 63 : 75;
    window.scrollTo({
      top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - offset),
      behavior: 'smooth',
    });
  }, [findSection]);

  const scrollToId = useCallback(
    (id: string) => {
      setOverlay(null);
      setOpenDropdown(null);
      if (!findSection(id) && view !== 'home') {
        pendingScroll.current = id;
        coverThen(() => router.push(home));
        return;
      }
      window.setTimeout(() => scrollTo(id), 30);
    },
    [findSection, home, router, scrollTo, view],
  );

  /* A cross-view scroll target survives the route change and fires once the
     destination page has registered. */
  useEffect(() => {
    const id = pendingScroll.current;
    if (!id || !pageRoot) return;
    pendingScroll.current = null;
    const frame = requestAnimationFrame(() => scrollTo(id));
    return () => cancelAnimationFrame(frame);
  }, [pageRoot, scrollTo]);

  const goHomeTop = useCallback(() => {
    setOverlay(null);
    if (view !== 'home') coverThen(() => router.push(home));
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [home, router, view]);

  const goBackToRestaurants = useCallback(() => {
    pendingScroll.current = 'restaurants';
    setOverlay(null);
    coverThen(() => router.push(home));
  }, [home, router]);
```

5g. Thay `openRestaurant`:

```tsx
  const openRestaurant = useCallback(
    (r: Restaurant) => {
      if (r.hasDetailPage) {
        setBooking({ restaurant: r.id });
        setOverlay(null);
        navigate('detail');
      } else {
        openReserve({ restaurant: r.id });
      }
    },
    [navigate, openReserve, setBooking],
  );
```

bằng:

```tsx
  const openRestaurant = useCallback(
    (r: Restaurant) => {
      if (!r.hasDetailPage) {
        openReserve({ restaurant: r.id });
        return;
      }
      setBooking({ restaurant: r.id });
      setOverlay(null);
      setOpenDropdown(null);
      if (page?.view === 'detail' && page.restaurant === r.slug) return;
      coverThen(() => router.push(`/${r.slug}`));
    },
    [openReserve, page, router, setBooking],
  );
```

5h. Trong effect "Header solidity, plus which pill the mobile bar highlights":
- thay hai dòng `const r = document.getElementById('restaurants');` và `const d = document.getElementById('destinations');` bằng:

```tsx
      const r = pageRoot?.querySelector('#restaurants');
      const d = pageRoot?.querySelector('#destinations');
```

- đổi deps của chính effect đó từ `}, [pathname]);` thành `}, [pageRoot]);`

5i. Thay:

```tsx
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
```

bằng:

```tsx
  /* Each page shown starts at the top (the pending-scroll effect above may then move it). */
  useEffect(() => {
    if (pageRoot) window.scrollTo(0, 0);
  }, [pageRoot]);
```

5j. Trong object `value`, ngay sau dòng `      view,` thêm hai dòng `      pageRoot,` và `      showPage,`, và xóa dòng `      navigate,`. Thay ba dòng cuối của mảng deps:

```tsx
      navigate, now, open, openDropdown, openReserve, openRestaurant, overlay, pending, pickCuisine,
      pickDestination, query, reference, restaurants, scrollToId, scrolled, serverError, setBooking,
      setFilter, setFinder, setFormField, shownCount, submit, tab, today, toggleDropdown, tried, view,
```

bằng:

```tsx
      now, open, openDropdown, openReserve, openRestaurant, overlay, pageRoot, pending, pickCuisine,
      pickDestination, query, reference, restaurants, scrollToId, scrolled, serverError, setBooking,
      setFilter, setFinder, setFormField, showPage, shownCount, submit, tab, today, toggleDropdown, tried,
      view,
```

- [ ] **Bước 6: Tấm màn, hiệu ứng vào trang và vòng rAF chỉ chạm vào trang đang hiện**

`components/site/PageCurtain.tsx`. Thay hai dòng import:

```tsx
import { usePathname } from 'next/navigation';
import { readMotionLevel } from '@/lib/motion';
```

bằng:

```tsx
import { readMotionLevel } from '@/lib/motion';
import { useSite } from '@/components/site/SiteProvider';
```

Thay:

```tsx
  const pathname = usePathname();
  const first = useRef(true);
```

bằng:

```tsx
  // The page on screen, from its <ViewMarker>: it changes once the new page has
  // actually rendered, so the curtain lifts onto content rather than a fallback.
  const { pageRoot } = useSite();
  const shown = useRef<HTMLElement | null>(null);
```

Thay:

```tsx
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    uncover();
  }, [pathname]);
```

bằng:

```tsx
  useEffect(() => {
    if (!pageRoot || pageRoot === shown.current) return;
    const first = shown.current === null;
    shown.current = pageRoot;
    if (!first) uncover();
  }, [pageRoot]);
```

`components/site/IntroTrigger.tsx`:
- ngay sau dòng `import { useIntro } from '@/lib/motion';`, thêm `import { usePageRoot } from '@/components/site/ViewMarker';`
- thay `  useIntro(true, 0);` bằng `  useIntro(true, 0, usePageRoot());`

`lib/motion.tsx`. Thay:

```tsx
export function useIntro(active: boolean, baseDelay = 0) {
  const motion = useMotion();

  useEffect(() => {
    if (!active) return;
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-intro]')).filter(
      (el) => !el.hasAttribute('data-intro-done'),
    );
    if (!els.length) return;
```

bằng:

```tsx
export function useIntro(active: boolean, baseDelay = 0, root?: RefObject<HTMLElement | null> | null) {
  const motion = useMotion();

  useEffect(() => {
    if (!active) return;
    const scope: ParentNode | null = root ? root.current : document;
    if (!scope) return;
    const all = Array.from(scope.querySelectorAll<HTMLElement>('[data-intro]'));
    const els = all.filter((el) => !el.hasAttribute('data-intro-done'));
    if (!els.length) return;
```

Thay:

```tsx
    return () => window.clearTimeout(timer);
  }, [active, baseDelay, motion]);
}

/** One rAF loop for everything scroll-driven: header auto-hide, parallax, hero fade. */
export function useScrollMotion(overlayOpen: boolean) {
  const motion = useMotion();
  const hidden = useRef(false);
  const lastY = useRef<number | null>(null);

  useEffect(() => {
    if (!motion) return;
```

bằng:

```tsx
    return () => {
      window.clearTimeout(timer);
      // A page hidden by <Activity> keeps its DOM; re-arm the entrance so it
      // plays again when the page is shown (its effects re-run then).
      if (root) all.forEach((el) => el.removeAttribute('data-intro-done'));
    };
  }, [active, baseDelay, motion, root]);
}

/**
 * One rAF loop for everything scroll-driven: header auto-hide, parallax, hero fade.
 * Parallax and the hero fade only touch `page` (the visible page's <main>): a page
 * hidden by <Activity>, or one still hydrating, is left alone.
 */
export function useScrollMotion(overlayOpen: boolean, page: HTMLElement | null) {
  const motion = useMotion();
  const hidden = useRef(false);
  const lastY = useRef<number | null>(null);

  useEffect(() => {
    if (!motion || !page) return;
```

Rồi:
- thay `      document.querySelectorAll<HTMLElement>('[data-parallax]').forEach((el) => {` bằng `      page.querySelectorAll<HTMLElement>('[data-parallax]').forEach((el) => {`;
- thay `      const hero = document.querySelector<HTMLElement>('[data-hero-content]');` bằng `      const hero = page.querySelector<HTMLElement>('[data-hero-content]');`;
- đổi deps cuối của `useScrollMotion` từ `  }, [motion, overlayOpen]);` thành `  }, [motion, overlayOpen, page]);`.

Dòng `document.querySelectorAll<HTMLElement>('[data-header]')` giữ nguyên, vì header thuộc chrome.

- [ ] **Bước 7: Chrome, Header, CSS ẩn trên phone, và các trang bọc trong `ViewMarker`**

`components/site/Chrome.tsx`. Thay:

```tsx
  const { overlay, view } = useSite();

  useScrollMotion(overlay !== null);
```

bằng:

```tsx
  const { overlay, pageRoot } = useSite();

  useScrollMotion(overlay !== null, pageRoot);
```

và thay:

```tsx
        {/* The phone detail view hands reservations to its bottom bar instead. */}
        <div className="booking-slot" data-view={view}>
```

bằng:

```tsx
        {/* The phone detail view hands reservations to its bottom bar instead (styles/booking.css). */}
        <div className="booking-slot">
```

`components/site/Header.tsx`:
- xóa dòng `    view,` trong phần destructure `useSite()`;
- xóa khối (kèm dòng trống theo sau):

```tsx
  // On a phone the detail view carries its own in-hero back button instead.
  const hideOnMobile = view === 'detail';
```

- xóa cả hai dòng `        data-hide-mobile={hideOnMobile}`, ở `hdr-full` và ở `hdr-compact`.

`components/site/MobileBar.tsx`, thay chú thích trên `MobileBar`:

```tsx
/**
 * The phone tab bar. Each page renders its own, so the right variant is in the
 * server HTML: the home page passes nothing, a restaurant page passes its slug.
 */
```

bằng:

```tsx
/**
 * The phone tab bar. Each page renders its own (inside its <ViewMarker>), so the
 * right variant is in the server HTML and a page hidden by <Activity> hides its
 * bar with it. The home page passes nothing, a restaurant page passes its slug.
 */
```

`styles/booking.css`. Thay:

```css
/* A phone on the restaurant view books from the bottom bar instead. */
@media (max-width: 759px) {
  .booking-slot[data-view='detail'] {
    display: none;
  }
}
```

bằng:

```css
/*
 * A phone on the restaurant view books from the bottom bar instead. <ViewMarker>
 * sets html[data-view] once hydrated; before that the server HTML holds exactly
 * one page, so :has() on its <main> decides.
 */
@media (max-width: 759px) {
  html[data-view='detail'] .booking-slot,
  html:not([data-view]):has(main[data-view='detail']) .booking-slot {
    display: none;
  }
}
```

`styles/layout.css`. Thay:

```css
/* The phone detail view supplies its own back affordance, so no header there. */
@media (max-width: 759px) {
  .hdr[data-hide-mobile='true'] {
    display: none;
  }
}
```

bằng:

```css
/* The phone detail view supplies its own back affordance, so no header there (see styles/booking.css for the selector). */
@media (max-width: 759px) {
  html[data-view='detail'] .hdr,
  html:not([data-view]):has(main[data-view='detail']) .hdr {
    display: none;
  }
}
```

`app/page.tsx`:
- ngay sau dòng `import { MobileBar } from '@/components/site/MobileBar';`, thêm `import { ViewMarker } from '@/components/site/ViewMarker';`
- thay thẻ mở `    <main>` bằng `    <ViewMarker view="home">`, thẻ đóng `    </main>` bằng `    </ViewMarker>`.

`app/taya-house/page.tsx`:
- ngay sau dòng `import { MobileBar } from '@/components/site/MobileBar';`, thêm `import { ViewMarker } from '@/components/site/ViewMarker';`
- thay `    <main>` bằng `    <ViewMarker view="detail" restaurant={SLUG}>`, `    </main>` bằng `    </ViewMarker>`.

- [ ] **Bước 8: Chạy để thấy pass**

Run: `npx vitest run lib/page-scope.guard.test.ts`
Expected: PASS `Tests  1 passed (1)`.

Run: `grep -rn "= usePathname\|data-hide-mobile\|DETAIL_PATH\|navigate(" components lib app`
Expected: không in gì (exit 1).

Run: `grep -rn "taya-house" components lib/motion.tsx`
Expected: không in gì (exit 1). Dòng `DETAIL_PATH` mà Task 5 Bước 10 còn thấy đã bị xóa.

- [ ] **Bước 9: Chạy toàn bộ kiểm tra, có visual**

```bash
npm run lint
TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
npm run typecheck
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run test:e2e
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npx playwright test e2e/page-scope.spec.ts --repeat-each 3 --retries 0
lsof -nP -iTCP:3201 -sTCP:LISTEN
```

Expected:
- lint thoát 0;
- `Test Files  19 passed (19)`, `Tests  147 passed (147)`;
- build xanh;
- typecheck sạch;
- E2E `20 passed`;
- `page-scope` lặp 3 lần `18 passed` (đây là phép kiểm độ ổn định của các `expect.poll`);
- `lsof` không in gì.

Nếu một ca `page-scope` chập chờn:
- Tăng `timeout` của `expect.poll` ở ca đó lên `10_000`.
- Nếu vẫn không ổn, quay lại các lần chờ cố định đã kiểm chứng trong `lv/behaviour.spec.ts`: `waitForTimeout(1200)` trước khi đọc log của tấm màn, `waitForTimeout(1500)` trước khi đo vị trí section.

Chạy server dưới nền: `PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npx next start -p 3201`

Đợi server nhận kết nối: `for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3201/ && break; sleep 1; done`

Run: `VISUAL_BASE_URL=http://localhost:3201 npm run test:visual`
Expected: `8 passed` (hoặc `6 passed` cộng `2 skipped` nếu Task 1 Bước 7 đã dùng phương án dự phòng). `<main>` của trang giờ do `ViewMarker` render, ảnh phải giống hệt. Nếu ảnh phone đỏ ở header hoặc thanh đặt bàn, kiểm tra hai bộ chọn `:has()` trong CSS.

Dừng server: `lsof -ti tcp:3201 | xargs kill`

- [ ] **Bước 10: Commit**

```bash
git add components/site/ViewMarker.tsx components/site/SiteProvider.tsx components/site/PageCurtain.tsx components/site/IntroTrigger.tsx components/site/Chrome.tsx components/site/Header.tsx components/site/MobileBar.tsx lib/motion.tsx styles/booking.css styles/layout.css app/page.tsx app/taya-house/page.tsx lib/page-scope.guard.test.ts e2e/page-scope.spec.ts e2e/nojs.spec.ts e2e/booking-dates.spec.ts
git commit -m "$(cat <<'EOF'
refactor: let each page register itself instead of reading the pathname

Every page now wraps its content in <ViewMarker view restaurant>, which
renders the page's <main data-view> and tells the chrome which page is
showing. SiteProvider and the curtain stop calling usePathname, and section
lookups, the intro replay and the parallax loop search only the visible
page. Cache Components keeps the previous page in the document, hidden, and
document-wide queries found its copy instead (the spike's dead DESTINATIONS
link). The phone header and booking-bar hides become CSS on html[data-view]
with a :has() fallback, so they are right before hydration and without JS.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Bật Cache Components và Partial Prefetching (route hiện tại)

V3 (`lead-t9`) đã chứng minh có thể bật Cache Components mà chưa chuyển route: build ra `○ / 30d 1y` và `○ /taya-house 30d 1y`, ảnh giống hệt, 5/5 ca chuyển trang xanh dưới Activity.

Task này làm các việc sau:
- Catalogue đi qua một hàm `'use cache'` gắn tag.
- Xóa hai cấu hình route segment (phán quyết 6).
- Thêm `app/global-error.tsx`, vì root layout vẫn còn đọc DB.
- Tạo `scripts/check-prerender.mjs`, chạy trong CI: script này ghim việc trang được prerender với `cacheLife('max')` và mang đủ tag.
- `playwright.config.ts` nhận `E2E_BASE_URL` (Bước 7 cần nó) và từ chối tự bật `next dev`, vì `next dev` đọc `.env.local` (DB dùng chung).

**Files:**
- Create: `lib/server/content/restaurants.ts`, `app/global-error.tsx`, `scripts/check-prerender.mjs`
- Modify: `next.config.ts`, `app/layout.tsx`, `app/api/availability/route.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes:
  - Task 3: `TAGS`, `DEFAULT_LOCALE`;
  - Task 5: `listRestaurants()` (điền `slug` và `hasDetailPage`);
  - Task 7: các trang tự đăng ký (bắt buộc khi có Activity).
- Produces:
  - `getRestaurants(locale: string): Promise<Restaurant[]>`: có `'use cache'`, `cacheLife('max')`, `cacheTag('restaurants', 'i18n:'+locale)`. Chỉ Server Component gọi hàm này; Vitest không import nó.
  - `node scripts/check-prerender.mjs`: thoát 1 kèm danh sách lỗi nếu trang khách không được prerender với 2592000/31536000 hoặc thiếu tag.
  - `<tiền tố env cục bộ> E2E_BASE_URL=<url> npx playwright test …`: chạy bộ E2E chính vào một server có sẵn, không bật `webServer`.
  - Cấu hình Playwright chính ném `Error: Refusing to start next dev…` khi thiếu cả `CI` lẫn `E2E_BASE_URL`. Có `CI` mà không có `E2E_BASE_URL` thì nó luôn bật `npm run start`.

- [ ] **Bước 1: Viết script kiểm prerender**

Create `scripts/check-prerender.mjs`:

```js
#!/usr/bin/env node
/**
 * Run after `next build`. The guest pages must be fully prerendered with
 * cacheLife('max') and carry every cache tag their data readers declare, or a
 * write that refreshes one of those tags (spec §6.2) would never reach them.
 * Exits 1 and lists the problems otherwise.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Route -> its file under .next/server/app (without the extension). */
const PAGES = {
  '/': 'index',
  '/taya-house': 'taya-house',
};
const TAGS = ['restaurants', 'i18n:en'];
const REVALIDATE = 2_592_000; // cacheLife('max'): 30 days
const EXPIRE = 31_536_000; // 1 year

const dir = join(process.cwd(), '.next');
const manifest = JSON.parse(readFileSync(join(dir, 'prerender-manifest.json'), 'utf8'));
const problems = [];

for (const [route, file] of Object.entries(PAGES)) {
  const entry = manifest.routes[route];
  if (!entry) {
    problems.push(`${route} is not prerendered`);
    continue;
  }
  if (entry.initialRevalidateSeconds !== REVALIDATE) {
    problems.push(`${route} revalidates after ${entry.initialRevalidateSeconds}s, expected ${REVALIDATE}s`);
  }
  if (entry.initialExpireSeconds !== EXPIRE) {
    problems.push(`${route} expires after ${entry.initialExpireSeconds}s, expected ${EXPIRE}s`);
  }
  const meta = JSON.parse(readFileSync(join(dir, 'server', 'app', `${file}.meta`), 'utf8'));
  const tags = String(meta.headers?.['x-next-cache-tags'] ?? '').split(',');
  for (const tag of TAGS) {
    if (!tags.includes(tag)) problems.push(`${route} is missing the cache tag ${tag}`);
  }
}

if (problems.length) {
  console.error(`Prerender check failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Prerender check passed: ${Object.keys(PAGES).join(', ')} (tags: ${TAGS.join(', ')}).`);
```

- [ ] **Bước 2: Chạy để thấy lỗi**

Chạy trên bản build Task 7 để lại.

Run: `node scripts/check-prerender.mjs`
Expected: FAIL (exit 1):

```
Prerender check failed:
- / revalidates after 3600s, expected 2592000s
- / is missing the cache tag restaurants
- / is missing the cache tag i18n:en
- /taya-house revalidates after 3600s, expected 2592000s
- /taya-house is missing the cache tag restaurants
- /taya-house is missing the cache tag i18n:en
```

- [ ] **Bước 3: Bật cờ và đưa catalogue qua `'use cache'`**

Thay toàn bộ `next.config.ts` bằng:

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
```

Create `lib/server/content/restaurants.ts`:

```ts
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { listRestaurants } from '@/db/queries';
import { TAGS } from '@/lib/cache-tags';
import type { Restaurant } from '@/lib/data';

/**
 * The guest-facing catalogue. Cached across requests and baked into the
 * prerendered pages; an admin save will expire it with updateTag('restaurants').
 * `locale` is unused until restaurant_i18n exists, but it is already part of
 * the cache key so every language gets its own entry.
 * Never import this from Vitest: cacheTag() throws outside Next.
 */
export async function getRestaurants(locale: string): Promise<Restaurant[]> {
  'use cache';
  cacheLife('max');
  cacheTag(TAGS.restaurants, TAGS.i18n(locale));
  return listRestaurants();
}
```

`app/layout.tsx`. Thay hai dòng:

```tsx
import { listRestaurants } from '@/db/queries';
import { DEFAULT_RESTAURANT_ID } from '@/lib/data';
```

bằng:

```tsx
import { DEFAULT_RESTAURANT_ID } from '@/lib/data';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import { getRestaurants } from '@/lib/server/content/restaurants';
```

Xóa khối (kèm dòng trống theo sau). Dưới Cache Components, `revalidate` là lỗi build; `cacheLife('max')` thay cho nó:

```tsx
/* The catalogue changes rarely; re-read it hourly instead of only on deploy. */
export const revalidate = 3600;
```

Thay `  const restaurants = await listRestaurants();` bằng `  const restaurants = await getRestaurants(DEFAULT_LOCALE);`.

`app/api/availability/route.ts`. Xóa dòng `export const dynamic = 'force-dynamic';` cùng dòng trống theo sau. Trong chú thích JSDoc của `GET`, thêm đoạn sau vào trước dòng ` */`:

```ts
 *
 * Under Cache Components a GET handler runs per request once it reads the
 * request (request.url below), so no `dynamic` export is needed or allowed.
```

- [ ] **Bước 4: Trang lỗi cuối cùng**

Create `app/global-error.tsx`:

```tsx
'use client';

import { CONTACT } from '@/lib/data';
import './globals.css';

/*
 * Last-resort error page. It replaces the whole document when the root layout
 * itself throws (an error.tsx only catches errors below its own layout), so it
 * brings its own <html>, styles and copy.
 */
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <title>Furama Cuisine</title>
        <main className="shell" style={{ padding: '160px 0 120px', textAlign: 'center' }}>
          <h1>We could not load this page.</h1>
          <p>
            Please try again, or call us to book:{' '}
            <a href={`tel:${CONTACT.resortPhone}`}>{CONTACT.resortPhoneLabel}</a>
          </p>
          <button type="button" className="btn-slab" onClick={() => retry()}>
            TRY AGAIN
          </button>
        </main>
      </body>
    </html>
  );
}
```

- [ ] **Bước 5: CI chạy script kiểm prerender; Playwright nhận server có sẵn và không tự bật `next dev`**

`.github/workflows/ci.yml`, ngay sau bước `Build` (sau dòng `DATABASE_URL: ${{ env.APP_DATABASE_URL }}` của bước đó), thêm:

```yaml
      - name: Check the prerendered pages
        run: node scripts/check-prerender.mjs
```

`playwright.config.ts`. Ngay sau dòng `const PORT = 3100;`, thêm:

```ts
/**
 * A server you started yourself (for example `next dev` against a local _test
 * database, to look for dev-only hydration errors). Skips the webServer below.
 */
const external = process.env.E2E_BASE_URL;

// Locally `next dev` reads .env.local (currently the shared Neon DB), so this
// config never starts it: use CI=1 with a local _test DATABASE_URL, or E2E_BASE_URL.
if (!process.env.CI && !external) {
  throw new Error(
    'Refusing to start next dev: it reads .env.local (the shared Neon DB). Use CI=1 with a local _test DATABASE_URL, or set E2E_BASE_URL.',
  );
}
```

Thay ``    baseURL: `http://localhost:${PORT}`,`` bằng ``    baseURL: external ?? `http://localhost:${PORT}`,``.

Thay khối `webServer` (khối cũ trích nguyên văn từ file hiện tại, kể cả chú thích đã cũ về "Neon dev branch"; khối mới bỏ chú thích đó):

```ts
  webServer: {
    // CI tests the production build; locally `next dev` reads .env.local (the Neon dev branch).
    command: process.env.CI ? `npm run start -- -p ${PORT}` : `npm run dev -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
```

bằng:

```ts
  webServer: external
    ? undefined
    : {
        // The production build, on whatever DATABASE_URL the caller set (a local _test one).
        command: `npm run start -- -p ${PORT}`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: false,
        timeout: 120_000,
      },
```

Kiểm chốt chặn. `--list` chỉ nạp config và không bật `webServer`, nên lệnh đầu an toàn kể cả khi chốt chặn hỏng:

```bash
env -u CI -u E2E_BASE_URL npx playwright test --list
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npx playwright test --list
```

Expected:
- lệnh đầu thoát 1, in `Error: Refusing to start next dev: it reads .env.local (the shared Neon DB). Use CI=1 with a local _test DATABASE_URL, or set E2E_BASE_URL.`;
- lệnh sau in `Total: 20 tests in 6 files`.

- [ ] **Bước 6: Build và chạy để thấy pass**

```bash
npm run lint
TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
npm run typecheck
node scripts/check-prerender.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run test:e2e
```

Expected:
- lint thoát 0;
- `Tests  147 passed (147)`;
- build in ra `- Cache Components enabled` và `- Partial Prefetching enabled`; trong bảng route, `○ /` và `○ /taya-house` có cột Revalidate `30d` và Expire `1y` (trước đây `1h`), còn `ƒ /api/availability` vẫn động;
- typecheck sạch;
- `Prerender check passed: /, /taya-house (tags: restaurants, i18n:en).`;
- E2E `20 passed`. Từ giờ `page-scope.spec.ts` chạy dưới Activity: trang trước vẫn nằm trong document ở trạng thái ẩn.

- [ ] **Bước 7: Kiểm lỗi hydration chỉ có ở dev**

Chạy `next dev` bằng env cục bộ (không phải `npm run dev`), dưới nền:

```bash
lsof -nP -iTCP:3202 -sTCP:LISTEN
PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npx next dev -p 3202
```

Đợi `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3202/` in ra `200`, rồi chạy:

```bash
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test E2E_BASE_URL=http://localhost:3202 npx playwright test e2e/page-scope.spec.ts e2e/booking-dates.spec.ts -g "page-scope|hydrates" --retries 0
```

Expected:
- `8 passed`: 6 ca `page-scope` và 2 ca hydration. Nếu lỗi hydration do parallax quay lại, ca `afterEach` của `page-scope` sẽ đỏ với `hydrated but some attributes …` — kiểm tra lại Bước 6 của Task 7.
- Log của `next dev` không có dòng `hydrat` hay `Error`.

Dừng server: `lsof -ti tcp:3202 | xargs kill`

- [ ] **Bước 8: Visual**

```bash
lsof -nP -iTCP:3201 -sTCP:LISTEN
PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npx next start -p 3201
```

(lệnh thứ hai chạy dưới nền), rồi đợi server nhận kết nối:

```bash
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3201/ && break; sleep 1; done
```

Run: `VISUAL_BASE_URL=http://localhost:3201 npm run test:visual`
Expected: `8 passed` (hoặc `6 passed` cộng `2 skipped` nếu Task 1 Bước 7 đã dùng phương án dự phòng).

Dừng server: `lsof -ti tcp:3201 | xargs kill`

- [ ] **Bước 9: Commit**

```bash
git add next.config.ts lib/server/content/restaurants.ts app/layout.tsx app/api/availability/route.ts app/global-error.tsx scripts/check-prerender.mjs .github/workflows/ci.yml playwright.config.ts
git commit -m "$(cat <<'EOF'
feat: turn on Cache Components and Partial Prefetching

The catalogue is read through getRestaurants(locale), a 'use cache' function
with cacheLife('max') and the restaurants and i18n:<locale> tags, so the
guest pages prerender for 30 days and a later admin save can refresh them.
The hourly revalidate export and the availability route's force-dynamic are
gone (both are build errors under Cache Components), global-error.tsx
covers a failing root layout, and CI checks the prerender manifest and tags
after every build. Playwright can target a server started by hand
(E2E_BASE_URL) and refuses to start next dev itself, since next dev reads
.env.local.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Chuyển route vào `app/(site)/[lang]`; proxy, chuyển hướng `/taya-house`, trang 404 và trang lỗi

Spec §6.1 và §6.4, phán quyết 1–4 và 8.

Cây file lấy từ `lead-verify` (V2). Bốn chỗ khác với V2:
- Proxy là bản đầy đủ của `spike-proxy`, chỉ dùng hằng; V2 dùng bản rút gọn.
- `global-not-found` nạp font qua `lib/fonts.ts`; ở V2 trang này hiện bằng font Times.
- `(guarded)/not-found.tsx` bọc trong `<ViewMarker view="other">`, để header và logo trên trang "không tìm thấy" vẫn đưa về trang chủ.
- `<html lang>` theo hình dạng của mã trong URL (`LOCALE_CODE_RE` + `toBcp47`), không theo `ENABLED_LOCALES` như V2. Nhờ vậy root layout vẫn không đọc DB sau khi Task 10 lấy danh sách ngôn ngữ từ DB.
  - Cái giá: trang 404 tiếng Anh của một mã đang tắt khai báo theo mã đó, ví dụ `/vi` ra `lang="vi"` và `/zz/…` ra `lang="zz"`.
  - Mục 6 của "Rủi ro đã biết" để người dùng quyết định. Nếu chỉ xét Task 9 thì có thể dùng `ENABLED_LOCALES.includes(code)`, nhưng Task 10 sẽ phải sửa lại dòng này.

Ảnh visual là phép nghiệm thu của cả đợt 2. `e2e/paths.ts` đổi sang `/en`, tên file baseline giữ nguyên; nếu visual xanh thì `/en` giống hệt `/` cũ đến từng pixel.

**Files:**
- Create:
  - `lib/fonts.ts`, `proxy.ts`, `lib/i18n/proxy-matcher.test.ts`, `e2e/routing.spec.ts`
  - `app/(site)/[lang]/(guarded)/layout.tsx`, `app/(site)/[lang]/(guarded)/not-found.tsx`
  - `app/(site)/[lang]/not-found.tsx`, `app/(site)/[lang]/error.tsx`, `app/global-not-found.tsx`
- Move:
  - `app/layout.tsx` → `app/(site)/[lang]/layout.tsx` (viết lại toàn bộ)
  - `app/page.tsx` → `app/(site)/[lang]/(guarded)/page.tsx` (nội dung giữ nguyên)
  - `app/taya-house/page.tsx` → `app/(site)/[lang]/(guarded)/restaurants/[slug]/page.tsx` (viết lại toàn bộ)
- Modify:
  - `next.config.ts`, `lib/data.ts`, `scripts/check-prerender.mjs`
  - `components/site/SiteProvider.tsx`, `components/site/Header.tsx`, `components/site/Footer.tsx`
  - `e2e/paths.ts`, `e2e/navigation.spec.ts`

**Interfaces:**
- Consumes:
  - Task 3: `DEFAULT_LOCALE`, `ENABLED_LOCALES`, `LOCALE_COOKIE`, `LOCALE_CODE_RE`, `toBcp47`, `pickLocale`, `homeHref`, `restaurantHref`;
  - Task 5: `DETAIL_PAGE_IDS`, `DEFAULT_RESTAURANT_ID`, `TayaHero({ slug })`, `MoreRestaurants({ slug })`, `MobileBar({ slug })`;
  - Task 7: `ViewMarker`, `View`;
  - Task 8: `getRestaurants(locale)`.
- Produces:
  - URL: `/en` (trang chủ), `/en/restaurants/[slug]` (chỉ `taya-house` được prerender; slug khác thì `notFound()`).
  - `/` và các đường dẫn không có tiền tố trả 307 về `/<locale>…`, có `Vary: Cookie, Accept-Language`, giữ query.
  - `/taya-house` trả 308 về `/en/restaurants/taya-house`, giữ query.
  - `proxy(request: NextRequest)` và `config.matcher`.
  - `fontVariables: string` từ `lib/fonts.ts`.
  - `DETAIL_SEO: Record<string, { title: string; description: string }>`.
  - `SiteProvider` có thêm prop bắt buộc `locale: string`; `useSite().locale` dùng được.
  - `View` có thêm `'other'`.
  - `e2e/paths.ts`: `HOME_PATH = '/en'`, `DETAIL_PATH = '/en/restaurants/taya-house'`.

- [ ] **Bước 1: Viết test matcher**

Create `lib/i18n/proxy-matcher.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
// Next 16.3.7 ships this name; the docs' unstable_doesProxyMatch does not exist yet (spec §13).
import { unstable_doesMiddlewareMatch as matches } from 'next/experimental/testing/server';
import { config } from '@/proxy';

const m = (url: string) => matches({ config, url });

describe('proxy matcher', () => {
  it.each(['/', '/restaurants', '/restaurants/taya-house', '/anything', '/english', '/admin', '/admin/sign-in', '/admin/a/b'])(
    'runs on %s',
    (u) => expect(m(u)).toBe(true),
  );

  // Locale-prefixed paths never reach the proxy, so a redirect to /en can never loop.
  it.each([
    '/en',
    '/en/',
    '/en/restaurants/taya-house',
    '/vi/x',
    '/zh-hans',
    '/zh-hans/restaurants',
    '/pt-br/a',
    '/xx/nope',
    '/api/availability',
    '/api',
    '/_next/static/a.js',
    '/_next/image',
    '/favicon.ico',
    '/icon.svg',
    '/sitemap.xml',
    '/robots.txt',
    '/images/a.png',
  ])('skips %s', (u) => expect(m(u)).toBe(false));

  // Known limit: a top-level unprefixed path of 2–3 letters looks like a locale code,
  // so the proxy skips it and it 404s. Real unprefixed top-level names need 4+ letters.
  it('treats a 2–3 letter first segment as a locale', () => expect(m('/faq/x')).toBe(false));
});
```

- [ ] **Bước 2: Chạy để thấy lỗi**

Run: `npx vitest run lib/i18n/proxy-matcher.test.ts`
Expected: FAIL `Error: Cannot find package '@/proxy' imported from …/lib/i18n/proxy-matcher.test.ts`.

**Không chạy `npm run build` cho tới Bước 13.** Lúc này build sẽ hỏng ở bước kiểm kiểu của chính file test trên (`TS2307: Cannot find module '@/proxy'`).

- [ ] **Bước 3: Viết test định tuyến, đổi URL trong spec**

Create `e2e/routing.spec.ts`:

```ts
import { expect, test, type APIRequestContext } from '@playwright/test';
import { DETAIL_PATH, HOME_PATH } from './paths';

/** One request without following redirects; `to` is the Location as path + query. */
async function hop(request: APIRequestContext, path: string, headers: Record<string, string> = {}) {
  const res = await request.get(path, { maxRedirects: 0, headers });
  const location = res.headers()['location'];
  const to = location ? new URL(location, 'http://localhost') : null;
  return { status: res.status(), to: to ? to.pathname + to.search : null, vary: res.headers()['vary'] ?? '' };
}

test.describe('old and unprefixed links', () => {
  test('/ goes to the default language with a temporary redirect that varies on cookie and language', async ({
    request,
  }) => {
    const r = await hop(request, '/');
    expect(r).toMatchObject({ status: 307, to: HOME_PATH });
    expect(r.vary).toMatch(/cookie/i);
    expect(r.vary).toMatch(/accept-language/i);
  });

  test('an unprefixed deep link keeps its path and query', async ({ request }) => {
    expect(await hop(request, '/x?y=1')).toMatchObject({ status: 307, to: '/en/x?y=1' });
  });

  test('a language that is not enabled, asked for by header or cookie, still lands on /en', async ({ request }) => {
    expect(await hop(request, '/', { 'accept-language': 'vi-VN,vi;q=0.9' })).toMatchObject({ status: 307, to: '/en' });
    expect(await hop(request, '/', { cookie: 'NEXT_LOCALE=vi' })).toMatchObject({ status: 307, to: '/en' });
  });

  test('the old Tàya House URL moved permanently and keeps its query', async ({ request }) => {
    expect(await hop(request, '/taya-house')).toMatchObject({ status: 308, to: DETAIL_PATH });
    expect(await hop(request, '/taya-house?utm_source=mail')).toMatchObject({
      status: 308,
      to: `${DETAIL_PATH}?utm_source=mail`,
    });
  });

  test('the old URL with a trailing slash still ends on the restaurant page', async ({ request }) => {
    const res = await request.get('/taya-house/');
    expect(res.status()).toBe(200);
    expect(new URL(res.url()).pathname).toBe(DETAIL_PATH);
  });

  test('guest pages, the API and files are served without a redirect', async ({ request }) => {
    expect((await hop(request, HOME_PATH)).status).toBe(200);
    expect((await hop(request, DETAIL_PATH)).status).toBe(200);
    expect((await hop(request, '/api/availability')).status).toBe(400); // the handler answered: no restaurant given
    expect((await hop(request, '/icon.svg')).status).toBe(200);
  });
});

test.describe('pages that do not exist', () => {
  test('a language that is not enabled is a real 404, in the site look, that search engines skip', async ({
    request,
    page,
  }) => {
    for (const path of ['/vi', '/fr', '/zz/restaurants/taya-house']) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(404);
      const html = await res.text();
      expect(html, path).toContain('noindex');
      expect(html, path).toContain('Page not found'); // Next's bare 404 says "This page could not be found."
    }
    // The server HTML of this 404 is a __next_error__ shell with the page in the RSC
    // payload, so the site look (ruling 2: not Next's bare 404) is checked in a browser.
    const res = await page.goto('/vi');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Be Vietnam Pro');
  });

  test('an unknown restaurant says so and is not indexed', async ({ request }) => {
    const res = await request.get('/en/restaurants/nope');
    // The first request streams its answer (200); later ones get the cached 404 (spec deviation 8).
    expect([200, 404]).toContain(res.status());
    const html = await res.text();
    expect(html).toContain('noindex');
    expect(html).toContain('Page not found');
  });

  test('a URL that matches no page gets the site 404 in the site fonts', async ({ page }) => {
    const res = await page.goto('/nothing/here');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Be Vietnam Pro');
  });

  test('the header on an unknown restaurant page still takes you home', async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
    await page.goto('/en/restaurants/nope');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.locator('.hdr-full .hdr-link', { hasText: 'DESTINATIONS' }).click();
    await page.waitForURL((u) => u.pathname === HOME_PATH);
    await expect(page.locator('#destinations')).toBeInViewport();
  });
});
```

Trong `e2e/paths.ts`, thay:

```ts
export const HOME_PATH = '/';
export const DETAIL_PATH = '/taya-house';
```

bằng:

```ts
export const HOME_PATH = '/en';
export const DETAIL_PATH = '/en/restaurants/taya-house';
```

Trong `e2e/navigation.spec.ts`:
- ngay sau dòng `import { expect, test } from '@playwright/test';`, thêm `import { DETAIL_PATH, HOME_PATH } from './paths';`
- thay `  await page.goto('/');` bằng `  await page.goto(HOME_PATH);`
- thay `  await page.waitForURL('**/taya-house');` bằng `  await page.waitForURL((url) => url.pathname === DETAIL_PATH);`
- thay `  await page.waitForURL((url) => url.pathname === '/');` bằng `  await page.waitForURL((url) => url.pathname === HOME_PATH);`

- [ ] **Bước 4: Chạy test định tuyến trên bản build Task 8 để thấy lỗi**

Không build lại. Playwright dùng bản build Task 8 đang có trong `.next`.

Run: `CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npx playwright test e2e/routing.spec.ts --retries 0`

Expected: `10 failed`.
- Chưa có proxy, chưa có `/en`, chưa có rule chuyển hướng.
- Ca `a language that is not enabled is a real 404, in the site look…` cũng đỏ, với `Expected substring: "Page not found"`. Trên route cũ, `/vi` là 404 có `noindex` nhưng hiện trang 404 trần của Next (`This page could not be found.`) bên trong chrome của site. Đây đúng là lỗi mà phán quyết 2 tránh.

- [ ] **Bước 5: Viết proxy**

Create `proxy.ts`. Chuỗi matcher phải giữ đúng từng ký tự như trong Global Constraints:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { ENABLED_LOCALES, LOCALE_COOKIE, pickLocale } from '@/lib/i18n/locales';

/*
 * Runs only on paths without a locale prefix, and on /admin. Guest pages under
 * /<locale>/… are cached and never pass through here (spec §6.1). A matcher must
 * be a build-time constant, so "has a locale prefix" means "starts with a
 * locale-shaped segment": 2–3 letters plus optional -subtags, the shape the
 * locales table allows. An unprefixed top-level page of 2–3 letters (/faq) is
 * therefore never redirected; give real top-level pages 4+ letters.
 */
export const config = {
  matcher: [
    '/admin/:path*',
    '/((?!api(?:/|$)|_next(?:/|$)|admin(?:/|$)|[a-z]{2,3}(?:-[a-z0-9]{2,8})*(?:/|$)|.*\\..*).*)',
  ],
};

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return NextResponse.next(); // phase 3: the session-cookie check
  }
  const locale = pickLocale(
    request.cookies.get(LOCALE_COOKIE)?.value,
    request.headers.get('accept-language'),
    ENABLED_LOCALES, // phase 8: the enabled locales from the database, best effort
  );
  const url = request.nextUrl.clone(); // keeps the query string
  url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
  // 307, not 308: the target depends on the cookie and Accept-Language, so no one may cache it as permanent.
  const res = NextResponse.redirect(url, 307);
  res.headers.append('Vary', 'Cookie, Accept-Language');
  return res;
}
```

Run: `npx vitest run lib/i18n/proxy-matcher.test.ts`
Expected: PASS `Tests  26 passed (26)`.

- [ ] **Bước 6: Font dùng chung**

Create `lib/fonts.ts`. Đây là code mới, theo font.md:944 ("Using a font definitions file"). Bước 13 kiểm nó bằng ảnh visual của trang và bằng test font của `/nothing/here`.

```ts
import { Be_Vietnam_Pro, Crimson_Pro } from 'next/font/google';

/*
 * The two site fonts, loaded once and shared ("Using a font definitions file",
 * node_modules/next/dist/docs/01-app/03-api-reference/02-components/font.md:944):
 * the guest root layout and app/global-not-found.tsx, which bypasses every
 * layout, both put these classes on <html>.
 */
const crimson = Crimson_Pro({
  subsets: ['latin', 'latin-ext'],
  weight: ['300', '400', '500', '600'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-crimson',
});

const beVietnam = Be_Vietnam_Pro({
  subsets: ['latin', 'latin-ext', 'vietnamese'],
  weight: ['300', '400', '500', '600'],
  display: 'swap',
  variable: '--font-be-vietnam',
});

/** Class names that define --font-crimson and --font-be-vietnam (used by styles/tokens.css). */
export const fontVariables = `${crimson.variable} ${beVietnam.variable}`;
```

- [ ] **Bước 7: Chuyển file route**

```bash
mkdir -p 'app/(site)/[lang]/(guarded)/restaurants/[slug]'
git mv app/layout.tsx 'app/(site)/[lang]/layout.tsx'
git mv app/page.tsx 'app/(site)/[lang]/(guarded)/page.tsx'
git mv app/taya-house/page.tsx 'app/(site)/[lang]/(guarded)/restaurants/[slug]/page.tsx'
rmdir app/taya-house
```

`git mv` chỉ chuyển file; thư mục `app/taya-house` rỗng còn lại, nên `rmdir` xóa nó.

Expected: `rmdir` không báo lỗi (thư mục đã rỗng); sau đó `ls app/taya-house` báo `No such file or directory`. `app/(site)/[lang]/(guarded)/page.tsx` giữ nguyên nội dung trang chủ.

- [ ] **Bước 8: Root layout không đọc DB, và layout `(guarded)`**

Thay toàn bộ `app/(site)/[lang]/layout.tsx` bằng:

```tsx
import type { Metadata, Viewport } from 'next';
import { lang } from 'next/root-params';
import { fontVariables } from '@/lib/fonts';
import { DEFAULT_LOCALE, ENABLED_LOCALES, LOCALE_CODE_RE, toBcp47 } from '@/lib/i18n/locales';
import { MotionProvider } from '@/lib/motion';
import '../../globals.css';

export const metadata: Metadata = {
  title: 'Furama Cuisine — Many Flavours. Many Destinations.',
  description:
    'From beachfront dining to vibrant city destinations – discover the restaurants, cuisines and people of Furama Cuisine in Da Nang.',
  openGraph: {
    title: 'Furama Cuisine',
    description: 'People · Culture · Great Food — dining across Furama’s Da Nang destinations.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#14201c',
};

/** Every enabled locale is prerendered; Cache Components needs at least one. */
export async function generateStaticParams() {
  return ENABLED_LOCALES.map((code) => ({ lang: code }));
}

/*
 * Sets [data-motion] before first paint so reveal elements can start hidden
 * without flashing, while a visitor without JS still gets everything visible.
 */
const MOTION_BOOTSTRAP = `try{document.documentElement.dataset.motion=matchMedia('(prefers-reduced-motion: reduce)').matches?'off':'on'}catch(e){}`;

/*
 * The guest root layout: the document, fonts and motion only. It reads no
 * database and never calls notFound(): neither an error nor a notFound() thrown
 * here has a layout to render into (error.md:96), so the language check and the
 * data reads live in (guarded)/layout.tsx.
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const code = await lang();

  /* suppressHydrationWarning: the inline script below stamps data-motion onto
     <html> before React hydrates, so the server markup differs by design. */
  return (
    <html
      lang={LOCALE_CODE_RE.test(code) ? toBcp47(code) : DEFAULT_LOCALE}
      className={fontVariables}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: MOTION_BOOTSTRAP }} />
      </head>
      <body>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
```

Create `app/(site)/[lang]/(guarded)/layout.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { lang } from 'next/root-params';
import { DEFAULT_RESTAURANT_ID } from '@/lib/data';
import { ENABLED_LOCALES } from '@/lib/i18n/locales';
import { getRestaurants } from '@/lib/server/content/restaurants';
import { SiteProvider } from '@/components/site/SiteProvider';
import { Chrome } from '@/components/site/Chrome';

/*
 * Every guest page sits below this layout. It checks the language, so notFound()
 * renders [lang]/not-found.tsx with a real 404, and reads the catalogue, so a
 * database failure renders [lang]/error.tsx. In the root layout neither could
 * be caught.
 */
export default async function GuardedLayout({ children }: { children: React.ReactNode }) {
  const locale = await lang();
  if (!ENABLED_LOCALES.includes(locale)) notFound();
  const restaurants = await getRestaurants(locale);

  return (
    <SiteProvider locale={locale} restaurants={restaurants} defaultRestaurantId={DEFAULT_RESTAURANT_ID}>
      <Chrome>{children}</Chrome>
    </SiteProvider>
  );
}
```

- [ ] **Bước 9: Trang chi tiết dùng chung**

Trong `lib/data.ts`, ngay sau dòng `export const DEFAULT_RESTAURANT_ID = 'taya-house';`, thêm:

```ts

/** <title> and description of each restaurant page. Phase 6: restaurant_i18n.seo_title / seo_description. */
export const DETAIL_SEO: Record<string, { title: string; description: string }> = {
  'taya-house': {
    title: 'Tàya House — Furama Cuisine',
    description:
      'A wellness dining home beneath the Lagoon Garden at Furama Resort Danang, with Vietnamese cooking classes led by Cơ Tu chef A Rất Thị Hép.',
  },
};
```

Thay toàn bộ `app/(site)/[lang]/(guarded)/restaurants/[slug]/page.tsx` bằng:
- `Object.hasOwn` chặn slug như `constructor`.
- `params` được `await` ở đầu trang, không đặt trong Suspense (phán quyết 1).

```tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TayaHero } from '@/components/detail/TayaHero';
import { TayaExperiences } from '@/components/detail/TayaExperiences';
import { MoreRestaurants } from '@/components/detail/MoreRestaurants';
import { IntroTrigger } from '@/components/site/IntroTrigger';
import { MobileBar } from '@/components/site/MobileBar';
import { ViewMarker } from '@/components/site/ViewMarker';
import { DETAIL_PAGE_IDS, DETAIL_SEO } from '@/lib/data';

type Props = { params: Promise<{ lang: string; slug: string }> };

export async function generateStaticParams() {
  return [...DETAIL_PAGE_IDS].map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return Object.hasOwn(DETAIL_SEO, slug) ? DETAIL_SEO[slug] : {};
}

/* The params read below blocks on purpose (see the comment on the page); this tells dev validation so. */
export const instant = false;

/*
 * params is awaited at the top, not inside <Suspense>. Inside a boundary even
 * the prerendered slugs ship their content as a streamed segment that only an
 * inline script reveals, so visitors without JS saw an empty page. The cost:
 * a slug missing from generateStaticParams gets no App Shell for this segment
 * and renders at request time on its first visit.
 */
export default async function RestaurantPage({ params }: Props) {
  const { slug } = await params;
  if (!DETAIL_PAGE_IDS.has(slug)) notFound();

  return (
    <ViewMarker view="detail" restaurant={slug}>
      <IntroTrigger />
      <TayaHero slug={slug} />
      <TayaExperiences />
      <MoreRestaurants slug={slug} />
      <MobileBar slug={slug} />
    </ViewMarker>
  );
}
```

- [ ] **Bước 10: Trang 404, trang lỗi, và cấu hình Next**

Create `app/(site)/[lang]/(guarded)/not-found.tsx`:

```tsx
import { ViewMarker } from '@/components/site/ViewMarker';
import { homeHref } from '@/lib/i18n/href';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';

/*
 * notFound() from a guest page (an unknown restaurant). It renders inside the
 * site chrome, and its <ViewMarker> tells the chrome that this is not the home
 * page, so the header links and the logo still navigate home.
 */
export default function PageNotFound() {
  return (
    <ViewMarker view="other">
      <section className="shell" style={{ padding: '160px 0 120px', textAlign: 'center' }}>
        <h1>Page not found</h1>
        <p>
          <a href={homeHref(DEFAULT_LOCALE)}>Back to Furama Cuisine</a>
        </p>
      </section>
    </ViewMarker>
  );
}
```

Create `app/(site)/[lang]/not-found.tsx`:

```tsx
import { homeHref } from '@/lib/i18n/href';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';

/** notFound() from (guarded)/layout.tsx: a language that is not enabled. No chrome: the guard stopped before it. */
export default function LanguageNotFound() {
  return (
    <main className="shell" style={{ padding: '160px 0 120px', textAlign: 'center' }}>
      <h1>Page not found</h1>
      <p>
        <a href={homeHref(DEFAULT_LOCALE)}>Back to Furama Cuisine</a>
      </p>
    </main>
  );
}
```

Create `app/(site)/[lang]/error.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { CONTACT } from '@/lib/data';

/*
 * A guest page failed to render, for example a request-time render while the
 * database is down. It sits above (guarded)/layout.tsx, so it also catches a
 * failed catalogue read. Never show error.message: in production it is a
 * minified React message; the digest matches the server log line.
 */
export default function SiteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error('page_render_failed', error.digest ?? error.message);
  }, [error]);

  return (
    <main className="shell" style={{ padding: '160px 0 120px', textAlign: 'center' }}>
      <h1>We could not load this page.</h1>
      <p>
        Please try again, or call us to book: <a href={`tel:${CONTACT.resortPhone}`}>{CONTACT.resortPhoneLabel}</a>
      </p>
      <button type="button" className="btn-slab" onClick={() => retry()}>
        TRY AGAIN
      </button>
    </main>
  );
}
```

Create `app/global-not-found.tsx`:

```tsx
import type { Metadata } from 'next';
import { fontVariables } from '@/lib/fonts';
import { homeHref } from '@/lib/i18n/href';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import './globals.css';

export const metadata: Metadata = {
  title: 'Page not found — Furama Cuisine',
};

/*
 * URLs that match no route. This page bypasses every layout, so it brings its
 * own document, styles and fonts (not-found.md:51); without the font classes
 * the page falls back to Times.
 */
export default function GlobalNotFound() {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <main className="shell" style={{ padding: '160px 0 120px', textAlign: 'center' }}>
          <h1>Page not found</h1>
          <p>
            <a href={homeHref(DEFAULT_LOCALE)}>Back to Furama Cuisine</a>
          </p>
        </main>
      </body>
    </html>
  );
}
```

Thay toàn bộ `next.config.ts` bằng:

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // app/global-not-found.tsx: there is no app/layout.tsx to hold a 404 for unmatched URLs.
    globalNotFound: true,
  },
  async redirects() {
    return [
      // The detail page moved under the locale prefix in phase 2 (308, query kept).
      { source: '/taya-house', destination: '/en/restaurants/taya-house', permanent: true },
    ];
  },
};

export default nextConfig;
```

- [ ] **Bước 11: Chrome dùng URL có tiền tố ngôn ngữ**

`components/site/SiteProvider.tsx`:
- ngay sau dòng `import { coverThen } from '@/components/site/PageCurtain';`, thêm `import { homeHref, restaurantHref } from '@/lib/i18n/href';`
- thay `export type View = 'home' | 'detail';` bằng:

```tsx
/** 'other': a page with no view of its own (an unknown restaurant), so the chrome's links go home. */
export type View = 'home' | 'detail' | 'other';
```

- thay:

```tsx
type SiteState = {
  restaurants: Restaurant[];
```

bằng:

```tsx
type SiteState = {
  /** The URL locale code (`en`). */
  locale: string;
  restaurants: Restaurant[];
```

- thay:

```tsx
export function SiteProvider({
  restaurants,
  defaultRestaurantId,
  children,
}: {
  restaurants: Restaurant[];
```

bằng:

```tsx
export function SiteProvider({
  locale,
  restaurants,
  defaultRestaurantId,
  children,
}: {
  locale: string;
  restaurants: Restaurant[];
```

- thay hai dòng:

```tsx
  /* Today's URLs; the route move under /[lang] (Task 9) swaps these for lib/i18n/href. */
  const home = '/';
```

bằng `  const home = homeHref(locale);`

- trong `openRestaurant`, thay:

```tsx
      coverThen(() => router.push(`/${r.slug}`));
    },
    [openReserve, page, router, setBooking],
```

bằng:

```tsx
      coverThen(() => router.push(restaurantHref(locale, r.slug)));
    },
    [locale, openReserve, page, router, setBooking],
```

- trong object `value`, thêm `      locale,` làm dòng đầu (ngay trước `      restaurants,`). Trong mảng deps, thay `goBackToRestaurants, goHomeTop, lang, matches,` bằng `goBackToRestaurants, goHomeTop, lang, locale, matches,`.

`components/site/Header.tsx`:
- ngay sau dòng `import { useSite } from '@/components/site/SiteProvider';`, thêm `import { homeHref } from '@/lib/i18n/href';`
- thêm `    locale,` làm dòng đầu trong phần destructure `useSite()` (ngay trước `    scrolled,`);
- thay cả hai chỗ `href="/"` bằng `href={homeHref(locale)}`.

`components/site/Footer.tsx`:
- ngay sau dòng `import { useSite } from '@/components/site/SiteProvider';`, thêm `import { homeHref } from '@/lib/i18n/href';`
- thay `  const { goHomeTop } = useSite();` bằng `  const { goHomeTop, locale } = useSite();`
- thay `          href="/"` bằng `          href={homeHref(locale)}`.

- [ ] **Bước 12: Script kiểm prerender theo route mới**

Trong `scripts/check-prerender.mjs`, thay:

```js
const PAGES = {
  '/': 'index',
  '/taya-house': 'taya-house',
};
```

bằng:

```js
const PAGES = {
  '/en': 'en',
  '/en/restaurants/taya-house': 'en/restaurants/taya-house',
};
```

- [ ] **Bước 13: Xóa `.next`, build, chạy toàn bộ kiểm tra**

`.next/types` và `.next/dev/types` còn trỏ tới `app/layout.tsx` và `app/page.tsx` cũ, nên phải xóa trước khi build:

```bash
rm -rf .next
npm run lint
TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
npm run typecheck
node scripts/check-prerender.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run test:e2e
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npx playwright test e2e/page-scope.spec.ts e2e/routing.spec.ts e2e/nojs.spec.ts e2e/navigation.spec.ts --repeat-each 3 --retries 0
grep -rn "taya-house" components lib/motion.tsx
```

Expected:
- lint thoát 0;
- `Test Files  20 passed (20)`, `Tests  173 passed (173)`;
- build xanh, bảng route có:

  ```
  ├   /[lang]
  │ ├ ◐ /[lang]
  │ └ ○ /en
  ├   /[lang]/restaurants/[slug]
  │ ├ ◐ /[lang]/restaurants/[slug]
  │ ├ ◐ /en/restaurants/[slug]
  │ └ ○ /en/restaurants/taya-house
  ├ ƒ /api/availability
  └ ○ /icon.svg
  ```

  và dòng `ƒ Proxy (Middleware)`;
- typecheck sạch;
- `Prerender check passed: /en, /en/restaurants/taya-house (tags: restaurants, i18n:en).`;
- E2E `30 passed`;
- lần chạy lặp `60 passed`;
- `grep` không in gì (exit 1): `components/` vẫn không có chỗ nào viết riêng cho Tàya (spec §6.3.1).

Nếu `/en` hoặc `/en/restaurants/taya-house` không còn `○`, dừng và báo lại kèm log build. Không chuyển `await params` vào Suspense, vì như thế sẽ làm hỏng khách không bật JS (phán quyết 1).

Nếu test `a URL that matches no page gets the site 404 in the site fonts` đỏ vì `fontFamily` là `Times`, thì `lib/fonts.ts` không được nạp vào `global-not-found`. Kiểm tra `className={fontVariables}` trên `<html>` của file đó.

- [ ] **Bước 14: Visual — nghiệm thu "/en giống hệt /"**

```bash
lsof -nP -iTCP:3201 -sTCP:LISTEN
PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npx next start -p 3201
```

(lệnh thứ hai chạy dưới nền), rồi đợi server nhận kết nối:

```bash
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3201/ && break; sleep 1; done
```

Run: `VISUAL_BASE_URL=http://localhost:3201 npm run test:visual`
Expected: `8 passed` (hoặc `6 passed` cộng `2 skipped` nếu Task 1 Bước 7 đã dùng phương án dự phòng). Các ảnh `/en` và `/en/restaurants/taya-house`, có JS và không JS, trên desktop và phone, khớp đến từng pixel với baseline chụp từ `/` và `/taya-house` ở Task 1.

Dừng server: `lsof -ti tcp:3201 | xargs kill`

- [ ] **Bước 15: Commit**

```bash
git add proxy.ts lib/fonts.ts lib/i18n/proxy-matcher.test.ts lib/data.ts next.config.ts scripts/check-prerender.mjs components/site/SiteProvider.tsx components/site/Header.tsx components/site/Footer.tsx e2e/paths.ts e2e/navigation.spec.ts e2e/routing.spec.ts app/global-not-found.tsx 'app/(site)'
git add -u app
git status --short
```

Expected: `git status --short` liệt kê:
- `R` cho `app/layout.tsx` và `app/page.tsx`;
- `D  app/taya-house/page.tsx` cùng `A  app/(site)/[lang]/(guarded)/restaurants/[slug]/page.tsx`: trang chi tiết bị viết lại toàn bộ, nên git không còn nhận ra đây là một lần đổi tên;
- `A` cho các file mới;
- `M` cho các file đã sửa;

và không còn file nào của task ở trạng thái `??`. Rồi:

```bash
git commit -m "$(cat <<'EOF'
feat: serve the guest site under /[lang] with a locale proxy

The guest pages move to app/(site)/[lang]: a root layout that reads no
database and never throws, and a (guarded) group that checks the language
and reads the catalogue, so a disabled language is a real branded 404 and a
database error reaches error.tsx. The Tàya House page becomes the shared
restaurants/[slug] page (params awaited outside Suspense so it still works
without JavaScript), /taya-house redirects permanently, and proxy.ts sends
unprefixed paths to the visitor's language (307, varying on cookie and
Accept-Language). /en matches the old / pixel for pixel.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Danh sách ngôn ngữ từ DB và chuỗi lỗi đặt bàn qua lớp đọc

Hai wrapper `'use cache'` lấy nguyên từ `spike-data` §7–§8. Spike chỉ chứng minh chúng khi gọi từ root layout. Ở đây chúng được gọi từ layout `(guarded)`; dàn ý ghi cách đặt này là **chưa kiểm chứng**.
- `plan-verify` đã chạy thử: `○ /en` và `○ /en/restaurants/taya-house` vẫn tĩnh, cả bốn tag có trên hai trang, 31/31 E2E, 8/8 ảnh.
- Bước 6 kiểm lại và ghi cách xử lý nếu không đạt.

Root layout chỉ đọc DB trong `generateStaticParams`, tức lúc build; khi render thì không. Vì vậy phán quyết 2 vẫn giữ. Proxy vẫn dùng hằng `ENABLED_LOCALES` (phán quyết 3).

**Files:**
- Create: `lib/server/content/locales.ts`, `lib/server/content/strings.ts`
- Modify: `app/(site)/[lang]/layout.tsx`, `app/(site)/[lang]/(guarded)/layout.tsx`, `components/site/SiteProvider.tsx`, `scripts/check-prerender.mjs`, `e2e/routing.spec.ts`

**Interfaces:**
- Consumes:
  - Task 3: `TAGS`, `CLIENT_KEYS`, `StringKey`, `resolveStrings`, `ErrorStrings`;
  - Task 4: `loadEnabledLocales`, `loadStringRows`, `SiteLocale`;
  - Task 9: layout `(guarded)`, prop `locale` của `SiteProvider`.
- Produces:
  - `getEnabledLocales(): Promise<SiteLocale[]>`: có `'use cache'`, `cacheLife('max')`, tag `locales`.
  - `getStrings<K extends StringKey>(locale: string, keys: readonly K[]): Promise<Record<K, string>>`: có `'use cache'`, `cacheLife('max')`, tag `content:ui` và `i18n:<locale>`. Luôn truyền một hằng ổn định (`CLIENT_KEYS`), vì `keys` là một phần của cache key.
  - `SiteProvider` có thêm prop bắt buộc `strings: ErrorStrings`. Ba lời gọi `bookingErrorMessage` truyền `strings`.
  - Trang khách mang thêm tag `locales` và `content:ui`. 404 đã cache của một ngôn ngữ đang tắt mang tag `locales`.

- [ ] **Bước 1: Viết test**

Trong `scripts/check-prerender.mjs`, thay `const TAGS = ['restaurants', 'i18n:en'];` bằng:

```js
const TAGS = ['restaurants', 'i18n:en', 'locales', 'content:ui'];
```

Trong `e2e/routing.spec.ts`, thay dòng import đầu tiên `import { expect, test, type APIRequestContext } from '@playwright/test';` bằng:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
```

rồi thêm test này ngay trước test `'an unknown restaurant says so and is not indexed'` (trong `test.describe('pages that do not exist', …)`):

```ts
  test('the cached 404 of a disabled language carries the locales tag, so enabling it clears the 404', async ({
    request,
  }) => {
    test.skip(!!process.env.E2E_BASE_URL, 'reads the cache of the production build that next start serves');
    expect((await request.get('/vi')).status()).toBe(404);
    expect((await request.get('/vi')).status()).toBe(404);
    const meta = join(process.cwd(), '.next', 'server', 'app', 'vi.meta');
    await expect.poll(() => existsSync(meta)).toBe(true);
    const tags = String(JSON.parse(readFileSync(meta, 'utf8')).headers['x-next-cache-tags']).split(',');
    expect(tags).toContain('locales');
  });
```

- [ ] **Bước 2: Chạy trên bản build Task 9 để thấy lỗi**

Không build lại.

Run: `node scripts/check-prerender.mjs`
Expected: FAIL:

```
Prerender check failed:
- /en is missing the cache tag locales
- /en is missing the cache tag content:ui
- /en/restaurants/taya-house is missing the cache tag locales
- /en/restaurants/taya-house is missing the cache tag content:ui
```

Run: `CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npx playwright test e2e/routing.spec.ts -g "locales tag" --retries 0`
Expected: FAIL. `expect(received).toContain(expected)`, `Expected value: "locales"`. Mảng tag của `vi.meta` chỉ có các tag `_N_T_/…`.

- [ ] **Bước 3: Hai hàm đọc `'use cache'`**

Create `lib/server/content/locales.ts`:

```ts
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { TAGS } from '@/lib/cache-tags';
import { loadEnabledLocales, type SiteLocale } from './locales.queries';

export type { SiteLocale };

/** Enabled languages. Feeds generateStaticParams, the language switcher and the sitemap. */
export async function getEnabledLocales(): Promise<SiteLocale[]> {
  'use cache';
  cacheLife('max');
  cacheTag(TAGS.locales);
  return loadEnabledLocales();
}
```

Create `lib/server/content/strings.ts`:

```ts
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { TAGS } from '@/lib/cache-tags';
import type { StringKey } from '@/lib/i18n/registry';
import { resolveStrings } from '@/lib/i18n/resolve';
import { loadStringRows } from './strings.queries';

/**
 * Resolved text for `keys` in `locale`: DB override, else registry default.
 * `locale` and `keys` are arguments, so they form the cache key. Callers get
 * the locale from `lang()` (next/root-params) in a Server Component, or pass it
 * explicitly from a Server Action, route handler or email sender.
 * Refreshed by the `content:ui` tag (and `i18n:<locale>`).
 */
export async function getStrings<K extends StringKey>(
  locale: string,
  keys: readonly K[],
): Promise<Record<K, string>> {
  'use cache';
  cacheLife('max');
  cacheTag(TAGS.contentUi, TAGS.i18n(locale));

  const { defaultLocale, rows } = await loadStringRows(locale, keys);
  return resolveStrings(rows, keys, locale, defaultLocale);
}
```

- [ ] **Bước 4: Root layout lấy danh sách ngôn ngữ lúc build; guard đọc bảng `locales` và chuỗi giao diện**

`app/(site)/[lang]/layout.tsx`. Thay hai dòng:

```tsx
import { DEFAULT_LOCALE, ENABLED_LOCALES, LOCALE_CODE_RE, toBcp47 } from '@/lib/i18n/locales';
import { MotionProvider } from '@/lib/motion';
```

bằng:

```tsx
import { DEFAULT_LOCALE, LOCALE_CODE_RE, toBcp47 } from '@/lib/i18n/locales';
import { MotionProvider } from '@/lib/motion';
import { getEnabledLocales } from '@/lib/server/content/locales';
```

và thay:

```tsx
/** Every enabled locale is prerendered; Cache Components needs at least one. */
export async function generateStaticParams() {
  return ENABLED_LOCALES.map((code) => ({ lang: code }));
}
```

bằng:

```tsx
/**
 * Every language enabled at build time is prerendered (the default one always:
 * Cache Components needs at least one). This runs at build only; rendering the
 * layout still reads no database.
 */
export async function generateStaticParams() {
  const codes = (await getEnabledLocales()).map((l) => l.code);
  return (codes.includes(DEFAULT_LOCALE) ? codes : [DEFAULT_LOCALE, ...codes]).map((code) => ({ lang: code }));
}
```

Thay toàn bộ `app/(site)/[lang]/(guarded)/layout.tsx` bằng:

```tsx
import { notFound } from 'next/navigation';
import { lang } from 'next/root-params';
import { DEFAULT_RESTAURANT_ID } from '@/lib/data';
import { CLIENT_KEYS } from '@/lib/i18n/registry';
import { getEnabledLocales } from '@/lib/server/content/locales';
import { getRestaurants } from '@/lib/server/content/restaurants';
import { getStrings } from '@/lib/server/content/strings';
import { SiteProvider } from '@/components/site/SiteProvider';
import { Chrome } from '@/components/site/Chrome';

/*
 * Every guest page sits below this layout. It checks the language against the
 * locales table, so notFound() renders [lang]/not-found.tsx with a real 404 (and
 * that cached 404 carries the `locales` tag, so enabling the language clears
 * it), and it reads the catalogue and the UI strings, so a database failure
 * renders [lang]/error.tsx. In the root layout neither could be caught.
 */
export default async function GuardedLayout({ children }: { children: React.ReactNode }) {
  const locale = await lang();
  const enabled = await getEnabledLocales();
  if (!enabled.some((l) => l.code === locale)) notFound();
  const [restaurants, strings] = await Promise.all([getRestaurants(locale), getStrings(locale, CLIENT_KEYS)]);

  return (
    <SiteProvider
      locale={locale}
      restaurants={restaurants}
      defaultRestaurantId={DEFAULT_RESTAURANT_ID}
      strings={strings}
    >
      <Chrome>{children}</Chrome>
    </SiteProvider>
  );
}
```

- [ ] **Bước 5: `SiteProvider` dùng chuỗi lỗi do server gửi xuống**

`components/site/SiteProvider.tsx`:
- thay `import { bookingErrorMessage } from '@/lib/booking-errors';` bằng `import { bookingErrorMessage, type ErrorStrings } from '@/lib/booking-errors';`
- thay:

```tsx
  defaultRestaurantId,
  children,
}: {
  locale: string;
  restaurants: Restaurant[];
  /** The restaurant the booking bar starts on (DEFAULT_RESTAURANT_ID until phase 6). */
  defaultRestaurantId: string;
  children: React.ReactNode;
}) {
```

bằng:

```tsx
  defaultRestaurantId,
  strings,
  children,
}: {
  locale: string;
  restaurants: Restaurant[];
  /** The restaurant the booking bar starts on (DEFAULT_RESTAURANT_ID until phase 6). */
  defaultRestaurantId: string;
  /** The error.* copy for this language, resolved on the server (DB override, else registry). */
  strings: ErrorStrings;
  children: React.ReactNode;
}) {
```

- thay `        setServerError(bookingErrorMessage(isSittingClosed(date, booking.time, at) ? 'past' : 'full'));` bằng `        setServerError(bookingErrorMessage(isSittingClosed(date, booking.time, at) ? 'past' : 'full', {}, strings));`
- thay `        setServerError(bookingErrorMessage(result.code, result.params));` bằng `        setServerError(bookingErrorMessage(result.code, result.params, strings));`
- thay:

```tsx
      .catch(() => setServerError(bookingErrorMessage('network')))
      .finally(() => setPending(false));
  }, [availability, booking, form, now, restaurants, valid]);
```

bằng:

```tsx
      .catch(() => setServerError(bookingErrorMessage('network', {}, strings)))
      .finally(() => setPending(false));
  }, [availability, booking, form, now, restaurants, strings, valid]);
```

- [ ] **Bước 6: Build, kiểm lại cách đặt wrapper trong guard (chưa kiểm chứng), chạy toàn bộ kiểm tra**

```bash
npm run lint
TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
npm run typecheck
node scripts/check-prerender.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run test:e2e
```

Expected:
- lint thoát 0;
- `Tests  173 passed (173)`;
- build xanh, vẫn `○ /en` và `○ /en/restaurants/taya-house`;
- typecheck sạch;
- `Prerender check passed: /en, /en/restaurants/taya-house (tags: restaurants, i18n:en, locales, content:ui).`;
- E2E `31 passed`. Test `submitting after the chosen sitting has closed…` vẫn thấy `That sitting has already started — please pick a later time.`, giờ đi qua đường `getStrings` → `SiteProvider` → `bookingErrorMessage`.

**Nếu không đạt** — tức `/en` hoặc trang chi tiết thành `◐`/`ƒ`, thiếu tag, hoặc build báo lỗi dữ liệu runtime trong `(guarded)/layout.tsx`:
1. Kiểm tra `getEnabledLocales()` và `getStrings()` được `await` trực tiếp trong layout, như Bước 4, chứ không nằm trong `<Suspense>` hay trong component con.
2. Nếu vẫn hỏng, dừng và báo lại kèm log build. Không chuyển các lần đọc DB về root layout (phán quyết 2) và không bỏ tag.

- [ ] **Bước 7: Visual**

```bash
lsof -nP -iTCP:3201 -sTCP:LISTEN
PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npx next start -p 3201
```

(lệnh thứ hai chạy dưới nền), rồi đợi server nhận kết nối:

```bash
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3201/ && break; sleep 1; done
```

Run: `VISUAL_BASE_URL=http://localhost:3201 npm run test:visual`
Expected: `8 passed` (hoặc `6 passed` cộng `2 skipped` nếu Task 1 Bước 7 đã dùng phương án dự phòng).

Dừng server: `lsof -ti tcp:3201 | xargs kill`

- [ ] **Bước 8: Commit**

```bash
git add lib/server/content/locales.ts lib/server/content/strings.ts 'app/(site)/[lang]/layout.tsx' 'app/(site)/[lang]/(guarded)/layout.tsx' components/site/SiteProvider.tsx scripts/check-prerender.mjs e2e/routing.spec.ts
git commit -m "$(cat <<'EOF'
feat: check languages against the locales table and serve UI strings from it

The (guarded) layout now asks the locales table (through a cached reader
tagged locales) whether the language is enabled, so the cached 404 of a
disabled language clears when it is switched on, and it hands SiteProvider
the error.* strings resolved from content_strings with the registry as
fallback. generateStaticParams prerenders every language enabled at build;
rendering the root layout still reads no database. The prerender check now
requires the locales and content:ui tags as well.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Nghiệm thu, kiểm tra DB sập, ghi chú triển khai trong README

Task này không đổi code app, chỉ sửa `README.md`. Phần còn lại là kiểm chứng toàn bộ đợt 2:
- Ba lần visual liên tiếp.
- Một lần chứng minh phép so khớp ảnh không phụ thuộc URL.
- Kiểm tra trên `next dev`.
- Kiểm tra khi DB sập theo công thức V2 (Review Focus 4). Bước này dùng một route tạm, **không bao giờ được commit**.

Migration 004 **không** được chạy lên Neon trong kế hoạch này. Bước 1 chỉ ghi vào README rằng phải migrate trước khi deploy.

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: mọi thứ của Task 1–10.
- Produces: README mô tả route mới, cách chạy build/E2E/visual cục bộ an toàn, và quy tắc "migrate 004 trước khi deploy".

- [ ] **Bước 1: Cập nhật README**

Trong `README.md`, mục `## Testing`, thay dòng:

```markdown
| `npm run test:e2e` | Playwright against `next dev` locally, `next start` in CI (port 3100). Run `npx playwright install chromium` once first. |
```

bằng hai dòng:

```markdown
| `npm run test:e2e` | Playwright against `next start` on port 3100. Set `CI` and a local `_test` `DATABASE_URL` (variables below), or `E2E_BASE_URL` for a server you started; without either it refuses to run, because `next dev` reads `.env.local`. Run `npx playwright install chromium` once first. |
| `npm run test:visual` | Pixel-exact screenshots of the home and Tàya House pages, with and without JavaScript, against `e2e/__visual__/` (macOS baselines from before phase 2; CI skips them). Needs a running `next start`, see below. |
```

Thay đoạn:

```markdown
CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit, integration,
build and end-to-end tests against a Postgres 18 service container.
```

bằng:

````markdown
CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit, integration,
build, the prerender check (`scripts/check-prerender.mjs`) and end-to-end
tests against a Postgres 18 service container.

To run the production build locally against a throwaway database, keep
`.env.local` out of it: process variables win over that file, and the blank
`PG*` variables stop Next from handing its user and password to `pg`.

```bash
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
node scripts/check-prerender.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run test:e2e
PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npx next start -p 3201 &
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3201/ && break; sleep 1; done
VISUAL_BASE_URL=http://localhost:3201 npm run test:visual
```

`E2E_BASE_URL=http://localhost:<port>` points the main Playwright suite at a
server you started yourself (for example `next dev` with the same variables)
instead of starting one. Never update the visual baselines to make a run
pass: open `test-results/**/*-diff.png` and fix the page.
````

Trong mục `## Deploying`, ngay trước đoạn bắt đầu bằng `Neon preview branches fork from production`, thêm:

```markdown
Migration 004 (`locales`, `content_strings`, `destinations` and the
`restaurants_destination_fk` constraint) must be on an environment's Neon
branch **before** that environment builds the phase-2 code: `next build`
reads the `locales` table (the guest layout's `generateStaticParams`) and
prerenders `/en` from the database, so a build against a branch without 004
fails. A failed build is safe (the previous deployment stays live), but
migrate first: apply 004 to a preview branch before its first phase-2
preview, and to production right before the production deploy, with the
`node scripts/migrate.mjs` command below. 004 only adds tables and a
constraint the current data already satisfies, so the code from before
phase 2 keeps working on a migrated database.

```

Trong mục `## Routes`, thay cả bảng cũ:

```markdown
| Route                | Rendering | Notes                                        |
| -------------------- | --------- | -------------------------------------------- |
| `/`                  | Static, ISR 1h | Home: hero, finder, cuisines, restaurants, destinations, experiences, heritage, stories, offers |
| `/taya-house`        | Static, ISR 1h | Tàya House restaurant detail                 |
| `/api/availability`  | Dynamic   | Booked covers per slot for one restaurant/day |
```

bằng:

```markdown
| Route | Rendering | Notes |
| --- | --- | --- |
| `/` and other unprefixed paths | Proxy (`proxy.ts`) | 307 to `/<locale>…` by the `NEXT_LOCALE` cookie, then `Accept-Language`, then `en` (only `en` is enabled in phase 2); the query is kept |
| `/en` | Static, `cacheLife('max')` | Home: hero, finder, cuisines, restaurants, destinations, experiences, heritage, stories, offers |
| `/en/restaurants/[slug]` | Static for `taya-house`; any other slug is a 404 | Restaurant detail (Tàya House only until phase 6) |
| `/taya-house` | Redirect | 308 to `/en/restaurants/taya-house` (`next.config.ts`) |
| `/api/availability` | Dynamic | Booked covers per slot for one restaurant/day |
```

Ngay sau đoạn bắt đầu bằng `The design toggled between these two views` trong cùng mục, thêm:

```markdown

Guest pages live in `app/(site)/[lang]`. The root layout there reads no
database and never throws; `(guarded)/layout.tsx` checks the language
against the `locales` table and reads the catalogue and UI strings, so a
disabled language gets the site's 404 and a database error gets
`[lang]/error.tsx`. Pages carry the cache tags `restaurants`, `i18n:<code>`,
`locales` and `content:ui`; `lib/cache-tags.ts` names every tag of the CMS
(spec §6.2), so later phases never spell a tag by hand. Each page wraps its
content in `<ViewMarker>`: with Cache Components the router keeps the page
you left mounted but hidden, so page DOM is only queried inside the visible
page's `<main>` (`lib/page-scope.guard.test.ts` enforces it).
```

Trong mục `## Database`, ngay sau đoạn đầu tiên (kết thúc bằng `Editing the catalogue means editing a migration.`), thêm:

```markdown

`locales`, `content_strings` and `destinations` (migration 004) are the
shared foundations of the CMS. Which UI strings exist is decided by
`lib/i18n/registry.ts`; `content_strings` only overrides or translates them,
and while it is empty the registry's English text is served. Guest pages
read through cached functions in `lib/server/content/` (`'use cache'`,
`cacheLife('max')`); their uncached loaders (`*.queries.ts`) are what the
integration tests exercise.
```

Trong bảng ở mục `## Scripts`, ngay sau dòng

```markdown
| `npm run test:e2e`   | Playwright                     |
```

thêm:

```markdown
| `npm run test:visual` | Screenshot comparison (local) |
```

- [ ] **Bước 2: Kiểm tra khi DB sập (công thức V2, route tạm không commit)**

Tạo route tạm để làm hết hạn tag. **Không `git add` file này.**

```bash
mkdir -p app/api/test-expire
cat > app/api/test-expire/route.ts <<'EOF'
import { revalidateTag } from 'next/cache';

// VERIFY-ONLY: expires the catalogue tag for the database-down check. Never commit.
export async function POST(request: Request) {
  const mode = new URL(request.url).searchParams.get('mode');
  revalidateTag('restaurants', mode === 'max' ? 'max' : { expire: 0 });
  return Response.json({ ok: true, mode });
}
EOF
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
lsof -nP -iTCP:3203 -sTCP:LISTEN
lsof -nP -iTCP:5999 -sTCP:LISTEN
```

Expected: build xanh; cả hai lệnh `lsof` không in gì. Cổng 5999 không có gì lắng nghe, nên mọi truy vấn DB đều bị từ chối.

Chạy server dưới nền, trỏ vào DB "chết":

```bash
PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5999/furama_cuisine_e2e_test npx next start -p 3203
```

Đợi server nhận kết nối: `for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3203/ && break; sleep 1; done`

Rồi chạy:

```bash
for p in /en /en/restaurants/taya-house "/api/availability?restaurant=taya-house"; do curl -s -o /dev/null -w "$p %{http_code} %header{x-nextjs-cache}\n" "http://localhost:3203$p"; done
curl -s -X POST "http://localhost:3203/api/test-expire?mode=max"; echo
for i in 1 2; do curl -s -o /dev/null -w "/en after max: %{http_code} %header{x-nextjs-cache}\n" http://localhost:3203/en; sleep 1; done
curl -s -X POST "http://localhost:3203/api/test-expire?mode=expire"; echo
curl -s -o /dev/null -w "/en after expire: %{http_code} %header{content-type}\n" http://localhost:3203/en
```

Expected (giống V2):

```
/en 200 HIT
/en/restaurants/taya-house 200 HIT
/api/availability?restaurant=taya-house 503
{"ok":true,"mode":"max"}
/en after max: 200 STALE
/en after max: 200 HIT
{"ok":true,"mode":"expire"}
/en after expire: 500 text/plain
```

(Dòng cuối có thể in thêm `; charset=utf-8` sau `text/plain`.)

`/en` trả 500 dạng chữ thô sau `{expire:0}`. Đây là khe hở đã chấp nhận ở phán quyết 7, chưa xảy ra được trong đợt 2.

Kiểm trong trình duyệt rằng một lần render lúc request hiện `[lang]/error.tsx` có số điện thoại. Tạo spec tạm `e2e/zz-dbdown.spec.ts` (**không commit**):

```ts
import { expect, test } from '@playwright/test';

test('a request-time render with the database down shows the error page with the phone number', async ({ page }) => {
  await page.goto('/en/restaurants/taya-house');
  await expect(page.getByRole('heading', { name: 'We could not load this page.' })).toBeVisible();
  await expect(page.getByRole('link', { name: '+84 236 651 9999' })).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Be Vietnam Pro');
});
```

Run: `CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test E2E_BASE_URL=http://localhost:3203 npx playwright test e2e/zz-dbdown.spec.ts --retries 0`
(Tiền tố chỉ để giữ quy tắc an toàn; server 3203 vẫn trỏ vào DB "chết" ở cổng 5999.)
Expected: `1 passed`.

Nếu trang hiện `We could not load this page.` nhưng không có font site, hoặc chỉ hiện `__next_error__` trống: ghi lại vào báo cáo cuối như một rủi ro còn mở. Không sửa code trong task này.

Dọn dẹp:

```bash
lsof -ti tcp:3203 | xargs kill
rm -rf app/api/test-expire e2e/zz-dbdown.spec.ts
git status --short
```

Expected: `git status --short` chỉ còn ` M README.md` và hai mục untracked: file kế hoạch này và thư mục research. Không có `app/api/test-expire` hay `e2e/zz-dbdown.spec.ts`.

- [ ] **Bước 3: Kiểm chứng toàn bộ trên bản build sạch**

Bản build ở Bước 2 có chứa route tạm, nên phải build lại:

```bash
npm run lint
TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
npm run typecheck
node scripts/check-prerender.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run test:e2e
```

Expected:
- lint thoát 0;
- `Test Files  20 passed (20)`, `Tests  173 passed (173)`;
- build xanh với `○ /en` và `○ /en/restaurants/taya-house`;
- typecheck sạch;
- `Prerender check passed: /en, /en/restaurants/taya-house (tags: restaurants, i18n:en, locales, content:ui).`;
- E2E `31 passed`.

- [ ] **Bước 4: Visual ba lần, cộng một lần đổi URL**

```bash
lsof -nP -iTCP:3201 -sTCP:LISTEN
PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npx next start -p 3201
```

(lệnh thứ hai chạy dưới nền), rồi:

```bash
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3201/ && break; sleep 1; done
for i in 1 2 3; do VISUAL_BASE_URL=http://localhost:3201 npm run test:visual 2>&1 | grep -E "passed|failed|flaky|skipped"; done
VISUAL_SUFFIX='?x=1' VISUAL_BASE_URL=http://localhost:3201 npm run test:visual 2>&1 | grep -E "passed|failed|skipped"
lsof -ti tcp:3201 | xargs kill
```

Expected: bốn lần `8 passed`; nếu Task 1 Bước 7 đã dùng phương án dự phòng thì mỗi lần là `2 skipped` và `6 passed`. Lần cuối cho thấy phép so khớp ảnh không phụ thuộc URL.

- [ ] **Bước 5: Kiểm trên `next dev`**

```bash
lsof -nP -iTCP:3202 -sTCP:LISTEN
PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npx next dev -p 3202
```

(lệnh thứ hai chạy dưới nền)

Đợi `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3202/en` in ra `200`, rồi chạy:

```bash
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test E2E_BASE_URL=http://localhost:3202 npx playwright test e2e/page-scope.spec.ts e2e/booking-dates.spec.ts -g "page-scope|hydrates" --retries 0
lsof -ti tcp:3202 | xargs kill
```

Expected:
- `8 passed`;
- log của `next dev` không có dòng `hydrat`, `encountered URL data during prerendering` hay `Error`. Dòng thứ hai đã được `instant = false` trên trang chi tiết dập đi.

- [ ] **Bước 6: Commit README**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: document the /[lang] routes, local test runs and migrating 004 first

The README now lists the guest routes after phase 2, explains how to build
and run the end-to-end and screenshot suites against a local database
without touching .env.local, and states that migration 004 must be applied
to an environment's Neon branch before that environment builds phase 2,
because the build reads the locales table.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Bước 7: Báo cáo**

Báo cho người dùng:
- kết quả từng lệnh ở Bước 3–5, gồm số test và bảng route;
- kết quả kiểm tra DB sập ở Bước 2;
- danh sách commit của đợt 2 (`git log --oneline -12`): 11 commit trên `main`, chưa push;
- danh sách "Rủi ro đã biết" ở đầu kế hoạch: nêu rõ các mục **cần quyết định** (1–9) để người dùng chọn chấp nhận hay mở việc ở đợt sau, và mục 13 cần kiểm ở bản preview;
- nếu Task 1 Bước 7 đã dùng phương án dự phòng cho ảnh no-JS trên phone: nói rõ điều đó, lý do, và mục 16 của "Rủi ro đã biết";
- **việc người dùng phải tự làm trước khi deploy:**
  1. Áp migration 004 lên branch Neon của môi trường đích bằng `DATABASE_URL_UNPOOLED=<URL direct của branch đó> node scripts/migrate.mjs`. Kế hoạch này không làm việc đó, vì `.env.local` đang trỏ vào DB dùng chung với production.
  2. Ở bản preview đầu tiên trên Vercel, kiểm tra: `x-vercel-cache`; `/` → `/en`; `/taya-house` → 308; `/vi` → 404. Mọi kiểm chứng trong kế hoạch này đều chạy trên `next start` tự host.
