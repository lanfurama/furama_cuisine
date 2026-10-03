# Đợt 6: Chuyển nội dung vào DB — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mọi nội dung web khách (danh mục, chrome, các section trang chủ, trang chi tiết nhà hàng, ưu đãi) đọc từ các bảng nội dung của migration 008 qua loader có cache và tag, trang trông y hệt trước (8 ảnh baseline ở `maxDiffPixelRatio 0`), và bật `has_detail_page` cho một nhà hàng khác thì trang của nó chạy ngay, không cần deploy.

**Architecture:**
- **Dữ liệu (Task 1):** migration `008_content.sql` (một transaction, chỉ mở rộng, chạy lại an toàn) tạo 20 bảng nội dung và bản dịch, mở rộng `restaurants`, `destinations`, `site_settings`, `reservations`; seed y hệt nội dung web lúc kết thúc đợt 5, kiểm bằng một bản đông cứng (`test/fixtures/phase5-content.ts`) và bằng việc đo lại mọi file trong `public/assets`. Danh sách chỉ được seed khi bảng còn rỗng, bản dịch chỉ khi có hàng cha, nên chạy lại không làm sống lại hàng biên tập viên đã xóa.
- **Cột đợt 1 (Task 2):** mọi SQL của đặt bàn, email và admin chuyển sang `destination_id`; một guard test (Task 3) cấm app đọc `restaurants.type/destination/cuisines/meals/slot_capacity` (R10). Nhà hàng chưa đăng hoặc đã lưu trữ không nhận đặt bàn online.
- **Lớp đọc (Task 3):** `lib/server/content/*.queries.ts` (SQL không cache, có ngôn ngữ dự phòng theo từng trường trong `sql.ts`) và các wrapper `'use cache'` (`site.ts`, `home.ts`, `restaurants.ts`) gắn tag chỉ qua `lib/cache-plan.ts` (`LOADERS`, `SAVE_TAGS`, `tagsForSave`); một bộ đọc `site_settings` duy nhất (`loadSiteSettings`).
- **Web khách (Task 4–7):** layout `(guarded)` nạp danh mục, nội dung chrome và chữ giao diện rồi đưa cho `SiteProvider` (`site`, `destName`); header, menu, chân trang, thanh đặt bàn, film (Task 4); thanh ẩm thực, bộ lọc, tìm kiếm, drawer, thẻ nhà hàng (Task 5); hero, điểm đến, trải nghiệm, di sản, câu chuyện (Task 6); trang chi tiết dùng chung cho mọi nhà hàng `has_detail_page` (Task 7). Mỗi trang khách kiểm ngôn ngữ trước khi đọc gì (`requireEnabledLocale`, Task 6), vì layout và page render song song, và trang chủ hỏi `homeSections` section nào hiện. Ảnh vốn là `next/image` đi qua `CmsImage`; ảnh vốn là `<img>` giữ `<img>` (R3).
- **Phần B (Task 8–13):** ưu đãi từ DB theo ngày ở Đà Nẵng (`cacheLife('hours')`) và cron hằng ngày (`revalidateTag('content:offers','max')`, R7); `offerId` trên đặt bàn (R9, liên kết mềm); xóa các hằng nội dung của `lib/data.ts` (R1), admin đọc tên điểm đến từ DB; "Gọi để đặt bàn" (R20); nghiệm thu và 29 đột biến (một cái sống sót, sửa spec nghiệm thu); README với runbook migration 008, cổng cuối, và câu sửa spec §6.2, §12 cho controller.

**Tech Stack:** Next.js 16.3.7 (Turbopack, `cacheComponents`, `partialPrefetching`, `next/root-params`), React 19.3, TypeScript 7.0.2, `pg` 8.23 (pool 5), Postgres 18.3 cục bộ, zod 4.6.5, Vitest 5.0.3, Playwright 1.63 (`testProject.workers`), oxlint 1.86, `oxc-parser` (đã có, cho guard test). **Không thêm, không bỏ gói nào.**

**Spec:** `docs/superpowers/specs/2026-10-01-admin-cms-design.md` — §14.1 dòng 6 (nghiệm thu: web giống hệt bản trước, so ảnh chụp màn hình; bật `has_detail_page` cho một nhà hàng khác thì trang chạy), cùng §5.1, §5.2, §6.1–6.5, §8, §12, §13. Phán quyết R7 sửa §6.2 (cron ưu đãi dùng `'max'`) và R8 thêm một ghi chú vào §12; câu sửa nằm ở Task 13 Bước 6 cho controller.

**Căn cứ đã kiểm chứng:**
- `docs/superpowers/research/2026-10-03-phase-6-spikes/00-plan-outline.md` (dàn ý của lead: sự kiện F1–F14, xung đột C1–C22, quyết định D1–D12 và A1–A2, phán quyết R1–R22, 13 task, ràng buộc §4, review focus §5, rủi ro §6, việc hoãn §7, runbook §8) cùng ba báo cáo spike `schema-seed.md`, `read-path.md`, `detail-offers.md`. Chỗ báo cáo và dàn ý khác nhau, dàn ý thắng; chỗ kế hoạch này khác dàn ý, lý do nằm ở "Ghi chú triển khai".
- **Task 1–13:** mọi khối code được sinh từ các commit trên nhánh `p6-folded` của bản sao kiểm chứng `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p6-verify` (bản sao APFS của repo, gốc `4f67931`, đã xóa `.next` và `.env.local`): mười ba commit của lần chạy đầu với mỗi sửa của vòng review gộp vào task sở hữu file, cây của commit cuối giống hệt cây đã qua cổng đủ sau vòng review; mỗi task một commit, chạy đúng thứ tự (`git show <sha>:<file>`, `git show <sha> -- <file>`, `git log -1 --format=%B <sha>`), nên gõ lại từ kế hoạch hay cherry-pick từng commit cho cùng một cây. Mỗi commit xanh typecheck, lint (19 cảnh báo), unit + tích hợp, build, check-prerender, E2E (`--retries=0`) và visual 8/8 ở ngưỡng 0. Output "Expected: FAIL" là output thật (đường dẫn tuyệt đối rút gọn thành `…`). SHA và số đếm nằm ở "Bản kiểm chứng".
- Code lấy từ: Task 1 từ patch của spike schema (`p6sch-phase6-schema.patch`, 9 file) cộng C3/C7 của dàn ý; Task 2–6 từ commit `30ea85b` của spike read (`p6-read`), tách theo task và dựng lại trên `4f67931`; Task 5 lấy trường `search` gấp sẵn trên server và Task 7 lấy các component trang chi tiết, `_none`, sửa `openMenu` và spec nghiệm thu từ spike detail (`p6dt-out/p6-detail.patch`). Phần B: Task 8 lấy loader ưu đãi, cron và spec hết hạn của spike read (cron đổi sang `'max'` theo R7, nên spec chờ tới lần tải thứ hai); Task 9 lấy `offerId` mềm của spike read, thêm kiểm khung ngày trong subselect và bỏ mã lỗi (`.catch(undefined)`) theo R9; Task 11 lấy "Gọi để đặt bàn" và bản sửa `booking-switch.serial` của spike detail. Phần viết mới khi chạy (không có trong spike nào): guard test của cột đợt 1 (Task 3), `test/integration/destination-id.test.ts` (Task 2), `lib/content/options.ts` (Task 5), test loader của trang chi tiết theo bản đông cứng (Task 7), bản diff DOM so với một build của `4f67931` (Task 4); rồi ở Phần B: `listDestinationOptions` và test ghim danh sách export của `lib/data.ts` (Task 10), test registry của R20 và việc kiểm số được gọi qua request `tel:` (Task 11), cách viết một sửa cho mỗi đột biến M10 (báo cáo spike chỉ nêu tên) và bản sửa spec nghiệm thu mà đột biến M2 chỉ ra (Task 12), lần chạy thử runbook 008 của README (Task 13). Từ vòng review: ngôn ngữ dự phòng `'en'` khi Intl từ chối mã và việc guard bắt cột đợt 1 đứng trần (Task 3); `requireEnabledLocale`, guard `test/guards/guest-pages.guard.test.ts`, `lib/content/home-sections.ts` và test 404 của các đường dẫn mà crawler hỏi (Task 6).
- Tài liệu Next được trích theo `node_modules/next/dist/docs/01-app/<file>.md:dòng`: `dynamicParams` không dùng được với Cache Components (`03-api-reference/03-file-conventions/02-route-segment-config/dynamicParams.md:22`; `02-guides/migrating-to-cache-components.md:606-612`, gặp slug lạ thì `notFound()`); `generateStaticParams` trả mảng rỗng là lỗi build (`02-guides/migrating-to-cache-components.md:570`); `updateTag` làm hết hạn ngay, request sau chờ dữ liệu mới (`03-api-reference/04-functions/updateTag.md:16`); `revalidateTag(tag,'max')` phục vụ bản cũ trong lúc làm mới, `{ expire: 0 }` chặn (`03-api-reference/04-functions/revalidateTag.md:21-26`); `cacheLife('hours')` = stale 5 phút / revalidate 1 giờ / expire 1 ngày (`03-api-reference/04-functions/cacheLife.md:144`), `'max'` = 30 ngày / 1 năm (`cacheLife.md:147`), vẫn được prerender (`cacheLife.md:270`); không có cache handler điều phối thì revalidate theo yêu cầu chỉ tới instance nhận lời gọi (`02-guides/how-revalidation-works.md:74`); layout và page render song song (`01-getting-started/06-fetching-data.md:460`), nên `notFound()` của layout không chặn được lần đọc của page; `notFound()` dùng được trong `generateMetadata` (`03-api-reference/04-functions/generate-metadata.md:197`).

## Global Constraints

**An toàn dữ liệu — đọc trước mọi lệnh:**
- `.env.local` đang trỏ vào **DB Neon dùng chung với production**.
- **Không bao giờ chạy** `npm run db:migrate`, `npm run db:psql`, `npm run dev`, `vercel env pull`, hay lệnh nào chạm Neon, Vercel, máy chủ SMTP hay dịch vụ ngoài. Kế hoạch này **không chạy migration 008 lên Neon**: controller làm, theo runbook (dàn ý §8, README ở Task 13). Không có lần ra mạng nào (không gói mới).
- Mọi lần ghi DB của E2E đi qua `db()`/`one()` trong `e2e/staff-fixtures.ts` (từ chối mọi DB không phải DB cục bộ tên `*_test`/`*_ci`).
- Mọi lần build, `next start`, E2E và visual đều dùng **tiền tố env cục bộ** của đợt 5 (giữ nguyên; biến của tiến trình thắng `.env.local` kể cả khi rỗng):

  ```bash
  CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test
  ```

  `next start` và E2E còn cần (`CRON_SECRET` ngẫu nhiên mỗi lần, ít nhất 16 ký tự, phải tới cả môi trường của Playwright vì spec cron đọc nó; Phần B dùng):

  ```bash
  BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson CRON_SECRET=$(openssl rand -hex 16) E2E_PORT=3210
  ```

- **Không bao giờ đặt** `SMTP_*`, `EMAIL_REDIRECT_TO`, `VERCEL_ENV` hay `NEXT_PUBLIC_VERCEL_ENV` cho một server cục bộ.
- Chỉ được tạo, reset hoặc xóa các DB cục bộ: `furama_cuisine_test` (tích hợp; test tự tạo `furama_cuisine_migrate_test`, `…migrate004_test` … `…migrate007_test`, và từ Task 1 `furama_cuisine_migrate008_test`, `furama_cuisine_seed008_test`) và `furama_cuisine_e2e_test` (build, E2E, visual). `TEST_DB_TAG=x` đổi tên các DB đó thành `…_x_test`. Reset bằng `RESET_DATABASE_URL=postgres://localhost:5432/<tên> node scripts/reset-db.mjs` (script từ chối host khác localhost và tên không kết thúc bằng `_test`/`_ci`). `db/checks/*.sql` chỉ chạy trên một DB cục bộ dựng tới 007 (Task 1), không bao giờ trên Neon.
- Cổng: E2E `3210`, visual `3211` (khoảng 3200–3299 dành cho agent; CI dùng 3100). Trước khi bật server, `lsof -nP -iTCP:<cổng> -sTCP:LISTEN` phải không in gì; xong thì `lsof -ti tcp:<cổng> | xargs kill`.
- **`next build` đọc các bảng của 008:** luôn reset DB E2E (chạy mọi migration) trước khi build.
- **zsh:** không bắt đầu một đối số bằng `=`; đặt glob trong nháy (`--include='*.ts'`); đặt đường dẫn có ngoặc trong nháy kép (`"app/(site)/[lang]/(guarded)/page.tsx"`); zsh không tách từ của biến (chạy `psql` trực tiếp, SQL trong heredoc).

**Git:**
- Làm thẳng trên `main`, không tạo branch. Mỗi task một commit. **Không push.** `git add` từng file cụ thể (`git rm` cho file xóa, `git mv` cho hai file đổi tên ở Task 7), không dùng `git add -A`.
- Hai mục untracked không thuộc các commit này: chính file kế hoạch này và thư mục `docs/superpowers/research/2026-10-03-phase-6-spikes/`; controller commit chúng.
- Mọi commit message kết thúc bằng dòng attribution mà phiên thực thi của bạn được cấu hình để thêm. Các khối commit dưới đây in dòng của phiên kiểm chứng (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); nếu phiên của bạn cấu hình dòng khác, thay dòng cuối bằng dòng đó.

**Next 16 và TypeScript 7** (giữ quy ước đợt 3–5, thêm của đợt 6):
- Đọc tài liệu trong `node_modules/next/dist/docs/` trước khi dùng API Next (theo `AGENTS.md`), trích theo `file.md:dòng`.
- `npm run typecheck` = `next typegen && tsc --noEmit --incremental false`. `next build` cũng typecheck file test và spec E2E (`tsconfig` gồm `**/*.ts`): một test import module chưa có làm hỏng build. Vì vậy các bước "build code hiện tại và chạy E2E mới: phải đỏ" đến **trước** khi viết test đơn vị/tích hợp của task.
- **Loader có cache:** `server-only`, câu đầu là `'use cache'`, rồi `cacheLife('max')` (ưu đãi `'hours'`, Phần B), rồi `cacheTag(...LOADERS.<tên>.tags, TAGS.i18n(locale))` (trang chi tiết thêm `TAGS.restaurant(id)` sau truy vấn). Không bao giờ import wrapper có cache vào Vitest (`cacheTag()` ném lỗi ngoài Next): test hàm `*.queries.ts`.
- Chỉ Server Component dưới `app/(site)/[lang]` gọi `lang()`; mọi chỗ khác nhận locale làm tham số.
- Mọi trang khách (`page.tsx` dưới `app/(site)`) `await requireEnabledLocale(…)` (`lib/server/content/locales.ts`, Task 6) trước mọi lần đọc khác ngoài `lang()`/`params`. Layout `(guarded)` kiểm ngôn ngữ, nhưng layout và page render song song (`01-getting-started/06-fetching-data.md:460`), và một đường dẫn có dấu chấm (`/favicon.ico`, `/wp-login.php`) bỏ qua proxy nên tới `[lang]` với chính nó làm ngôn ngữ: trang đọc trước sẽ hỏi DB, và lỗi của trang (Intl ném `RangeError`) thắng 404 của layout. Guard `test/guards/guest-pages.guard.test.ts` giữ quy tắc này.
- `generateStaticParams` không bao giờ trả `[]` (dùng `['_none']`); không export `dynamicParams`; trang chi tiết giữ `instant = false` và `await params` ở đầu (quy tắc no-JS của đợt 2; câu "`params` được `await` bên trong `<Suspense>`" của spec §6.4 vẫn bị ghi đè như ở đợt 2).
- Ngày và giá được định dạng trong loader (server), không bao giờ trong client component.
- Không thêm chỗ `next/image` mới ngoài `CmsImage`, không thêm `<img>` mới; lint giữ 19 cảnh báo (cảnh báo `no-img-element` của `TayaHero` chuyển sang `RestaurantHero` ở Task 7).
- SQL trong template literal không chứa dấu `\` (dùng `[:space:]`).
- Quy tắc admin không đổi: mọi trang `instant = false`, action bắt đầu bằng `await requirePermission(…)`, rồi zod, transaction, `updateTag`/`refresh()`, `ActionResult`; không component của web khách. Guard CI `test/guards/require-permission.guard.test.ts` và `lib/admin/admin-pages.guard.test.ts` giữ chúng.
- Locator E2E: theo role, hoặc `getByLabel(…, { exact: true })`; thông báo trạng thái tìm trong dialog, `main`, form hoặc hàng của bảng.
- Comment trong code viết bằng tiếng Anh, giải thích "vì sao". Lint thoát 0 với **19 cảnh báo** (mốc `4f67931`); không task nào được thêm cảnh báo.

**Phiên bản:** không thêm, không bỏ gói. `next@16.3.7`, `react@19.3.0`, `typescript@7.0.2`, `pg@8.23.0`, `zod@4.6.5`, `vitest@5.0.3`, `@playwright/test@1.63.0`, `oxlint@1.86.0`, `oxc-parser@0.152`. Node 22.22 cục bộ, 24 trên CI và Vercel; Postgres 18.3 cục bộ. `scripts/measure-assets.mjs` import một file `.ts` qua type stripping của Node (Node ≥ 22.18), in kèm một cảnh báo vô hại `MODULE_TYPELESS_PACKAGE_JSON` ra stderr.

**Tên trong migration `008_content.sql`** (một transaction, chỉ mở rộng, chạy lại an toàn):
- **Bảng mới:** `media`, `media_i18n`, `destination_i18n`, `cuisines`, `cuisine_i18n`, `restaurant_i18n`, `restaurant_cuisines`, `restaurant_highlights`, `restaurant_highlight_i18n`, `sections`, `hero_slides`, `experiences`, `experience_i18n`, `stories`, `story_i18n`, `offers`, `offer_i18n`, `nav_items`, `nav_item_i18n`, `social_links`. Mọi bảng `*_i18n` có các cột của §5.1 mục 3 (`status` machine|reviewed, `origin` human|ai|seed, `ai_model`, `source_hash`, `reviewed_by/at`, `updated_at/by`), FK `locale` `ON UPDATE CASCADE ON DELETE CASCADE`, FK cha CASCADE; mọi cột chữ dịch được có `CHECK (btrim(x) <> '' AND char_length(x) <= N)` (NULL = dùng ngôn ngữ mặc định cho riêng trường đó).
- **Mở rộng:** `restaurants` (+ `slug`, `destination_id`, `card_image_id`, `detail_image_id`, `og_image_id`, `phone_e164`, `phone_display`, `map_url`, `has_detail_page`, `is_published`, `archived_at`; `type`/`destination` thôi NOT NULL), `destinations` (FK `destinations_card_image_id_fkey`), `site_settings` (+ `default_restaurant_id`, `default_occasion`, `og_image_id`, `hero_autoplay_ms`, thêm bằng `ADD COLUMN IF NOT EXISTS`, không bao giờ `CREATE`), `reservations` (FK `reservations_offer_id_fkey … ON DELETE SET NULL`, index `reservations_offer_idx`).
- **Ràng buộc:** `media_pathname_key`, `media_static_path`, `media_blob_url`, `media_dimensions`; `restaurants_slug_key` (unique index), `restaurants_phone_pair`, `restaurants_detail_image`, `restaurants_published_card`; `restaurant_i18n_one_menu`; `sections_restaurants_visible`, `sections_film_video`; `nav_items_target_section_key`; `offers_price_pair`, `offers_valid_range`; `offers.restaurant_id … ON DELETE RESTRICT` (R6). Index `restaurant_cuisines_cuisine_idx`, `restaurant_highlights_restaurant_idx`, `offers_restaurant_idx`.
- **Id seed cố định** (`OVERRIDING SYSTEM VALUE`): offers 1–3 (cafe-indochine, taya-house, hai-van-lounge), highlights 1–4, hero_slides 1–3, experiences 1–3, stories 1–4, nav_items 1–6, social_links 1–4; `sort_order` bước 10; sequence `<bảng>_id_seq` dời qua chúng bằng `setval(GREATEST(max, last_value))`.
- **Guard dừng 008:** một đặt bàn đã có `offer_id`; một nhãn `restaurants.cuisines` ngoài 8 ẩm thực; `restaurants_published_card` cho nhà hàng thiếu `public/assets/r-<id>.jpg`.

**Tag, loader và trang** (`lib/cache-plan.ts`; mọi loader theo ngôn ngữ thêm `i18n:<locale>`):

| Loader (`LOADERS`) | Đọc | Tag | Task |
|---|---|---|---|
| `locales`, `strings`, `legal` | `locales`, `content_strings` | `locales` / `content:ui` / `content:legal` | 3 (chuyển sang `LOADERS`) |
| `sections` | `sections`, `media(_i18n)` | `content:sections`, `media` | 3 |
| `settings` | `site_settings` | `content:contact` | 3 |
| `cuisines` | `cuisines(_i18n)`, `media(_i18n)` | `content:cuisines`, `media` | 3 |
| `destinations` | `destinations`, `destination_i18n`, `media(_i18n)` | `content:destinations`, `media` | 3 |
| `nav` | `nav_items(_i18n)`, `sections` | `content:nav`, `content:sections` | 3 |
| `socials` | `social_links` | `content:contact` | 3 |
| `restaurants` | `restaurants`, `restaurant_i18n`, `restaurant_cuisines`, `service_periods`, `media(_i18n)`, `cuisines(_i18n)`, `destinations`, `destination_i18n` | `restaurants`, `media`, `content:cuisines`, `content:destinations` | 3 |
| `heroSlides`, `experiences`, `stories` | bảng của chúng (+ `media(_i18n)`) | `content:hero`, `media` / `content:experiences` / `content:stories`, `media` | 6 |
| `detail` | `restaurants`, `restaurant_i18n`, `restaurant_highlights(_i18n)`, `destinations`, `destination_i18n`, `media(_i18n)` | `restaurants`, `content:destinations`, `media` + `restaurant:<id>` sau truy vấn | 7 |
| `detailSlugs` | `restaurants` | `restaurants` | 7 |
| `offers` | `offers(_i18n)`, `restaurants` | `content:offers`, `restaurants`; `cacheLife('hours')` | 8 (Phần B) |

- `scripts/check-prerender.mjs`, tag của layout sau Task 4: `restaurants, i18n:en, locales, content:ui, content:sections, content:cuisines, content:destinations, content:nav, content:contact, media`. `PAGE_TAGS`: `/en` + `content:hero, content:experiences, content:stories` (Task 6) + `content:offers` (Task 8); `/en/restaurants/taya-house` + `restaurant:taya-house` (Task 7); `/en/privacy` + `content:legal`. `LIFETIME` `/en` 3600/86400 từ Task 8; còn lại 2592000/31536000. `UNCACHED` += `/api/cron/daily` (Task 8).
- Ghi: Server Action gọi `updateTag` cho từng tag của `tagsForSave(bảng, restaurantId)` sau COMMIT; mọi chỗ khác `revalidateTag(tag, 'max')`.

**Hằng số:** `VENUE_TODAY = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`; `NO_PAGE_SLUG = '_none'`; metadata NOT_FOUND "Page not found — Furama Cuisine" + `robots.index false`; tiêu đề dự phòng của trang chi tiết `${name} — Furama Cuisine`; `FALLBACK_PHONE = { display: '+84 236 651 9999', tel: '+842366519999' }`; công thức ngày (en-US `formatToParts`, `${day} ${month} ${year}`, UTC); công thức giá (`${currency} ${Intl.NumberFormat(locale).format(n)}` + `++`/` net` + ` per guest`, khoảng trắng thường); dòng chi tiết ưu đãi `${giá} · ${lịch}`; nhãn nav ≤ 18 ký tự; cron `5 17 * * *`, `maxDuration = 60` (Phần B).

**Quy tắc code (đợt 6):**
1. Code web khách không import nội dung từ `lib/data.ts` sau task đã chuyển nguồn của nó; Task 10 (Phần B) xóa các hằng, `lib/data.ts` chỉ còn `Meal`, `MEALS`, `MEAL_LABELS`, `SLOTS`, `FALLBACK_PHONE`, `Restaurant` và các kiểu DTO.
2. Mọi SQL nội dung nằm trong `lib/server/content/*.queries.ts`; danh sách `ORDER BY sort_order, id`; lọc `is_published`, `archived_at IS NULL`, media `deleted_at IS NULL`, trang `has_detail_page`.
3. Không SQL nào của app đọc `restaurants.type/destination/cuisines/meals/slot_capacity` (guard test, từ Task 3).
4. Ngôn ngữ dự phòng chỉ qua `sql.ts` (`LOCALE_CTE`, `i18nJoin`, `tr`, `mediaJson`): hàng mặc định luôn; hàng khác khi `reviewed`, hoặc `machine` với `serve_machine`; theo từng trường; không lọc `locales.is_enabled` (R16).
5. Ảnh trang trí render `alt=""`; `CmsImage decorative` cho ảnh trang trí theo vai trò.
6. Chữ khách thấy mới do đợt 6 thêm vào registry (`screen`, `vars`, `context`); chữ section có sẵn giữ trong JSX (R2).
7. Comment trong code viết bằng tiếng Anh, giải thích "vì sao".

**Bản đồ dữ liệu E2E** (thêm vào của đợt 5; spec `*.serial.spec.ts` chạy ở project `desktop-serial`, `workers: 1` từ Task 4, R21):

| Spec | Dữ liệu | Trả lại |
|---|---|---|
| `shared-inbox.serial` (Task 4) | `site_settings.email` = `datban@furama.test`, lưu qua `/admin/settings/notifications` (Admin) | `finally`: lưu lại `fb@furamavietnam.com` qua cùng form |
| `filters` (Task 5) | chỉ đọc | — |
| `restaurant-page` (Task 7) | trang Tàya, chỉ đọc; URL tariff giả bằng `context.route` (text/plain) | — |
| `restaurant-pages.serial` (Task 7, 12) | the-fan: `detail_image_id` = `r-the-fan.jpg`, kicker, câu chuyện EN, 2 highlight, `has_detail_page`; rồi Editor lưu form quy tắc đặt bàn của the-fan (hết hạn `restaurants`) | `finally`: tắt trang (Task 7: kèm xóa highlight và chữ trang; từ Task 12 chỉ công tắc), lưu lại form quy tắc; từ Task 12, `afterAll` xóa highlight, chữ trang và chân dung |
| `offers-expiry.serial` (Task 8) | offer 3 (hai-van-lounge) `valid_until` = hôm qua (Đà Nẵng) | `finally`: `valid_until` NULL rồi gọi cron với secret |
| `offer-booking` (Task 9) | VIEW OFFER của offer 1 (cafe-indochine); POST bị hủy | — |
| `booking-switch.serial` (có sẵn; Task 11) | `booking_enabled` của taya-house, hai-van-lounge và yum-food-village tắt/bật; test mới tắt cả mười hai (mười một bằng SQL, the-fan qua form quy tắc) | lưu lại form quy tắc của từng nhà hàng; test mới: bật lại bằng SQL rồi lưu form của the-fan (hết hạn `restaurants`) |

**Cổng kiểm tra của mọi task** (bước cuối mỗi task ghi con số mong đợi):

```bash
npm run typecheck
npm run lint
TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
node scripts/check-prerender.mjs
rm -f "${TMPDIR:-/tmp}/furama-e2e-emails.ndjson"
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson CRON_SECRET=$(openssl rand -hex 16) E2E_PORT=3210 npm run test:e2e -- --retries=0
lsof -nP -iTCP:3211 -sTCP:LISTEN
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3211 EMAIL_DELIVERY=log CRON_SECRET=$(openssl rand -hex 16) npx next start -p 3211 &
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3211/en && break; sleep 1; done
VISUAL_BASE_URL=http://localhost:3211 npm run test:visual
lsof -ti tcp:3211 | xargs kill
```

Mốc tại `4f67931`: unit + tích hợp 68 file, 906 test; E2E `151 passed`, `1 skipped` (botid); visual `8 passed`; lint thoát 0 với 19 cảnh báo (`npm run lint 2>&1 | grep -c ': warning '`). Visual luôn mong đợi `8 passed` ở `maxDiffPixelRatio: 0`. **Không bao giờ chạy `--update-snapshots`**: một pixel đổi là lỗi cần sửa trong code (mở `test-results/**/*-diff.png`). Một lần E2E toàn bộ mất khoảng 55–65 giây với `--retries=0`.

**Log email trống trước mỗi lần E2E** (cổng kiểm tra, mọi lần chạy riêng file của các bước RED, các lần chạy đột biến): `rm -f "${TMPDIR:-/tmp}/furama-e2e-emails.ndjson"` ngay trước lệnh Playwright. Mỗi lần reset DB E2E làm id đặt bàn bắt đầu lại, và test F5 của `e2e/admin-closures.spec.ts` (dòng 209, đợt 5) kiểm rằng không email nào tới `started-<id>@example.com`: một email của lần chạy trước tới đúng địa chỉ đó làm cổng đỏ dù code đúng. `emailsTo()` đọc file thiếu là danh sách rỗng.

**Diff DOM phía server** (Task 4 trở đi, phán quyết R18): ngay sau `npm run build` (trước E2E: E2E sinh lại trang ISR trên đĩa với dữ liệu giữa chừng của spec serial), so `.next/server/app/{en,en/restaurants/taya-house,en/privacy}.html` với cùng ba file của một build `4f67931`, sau khi chuẩn hóa (bỏ `<script>`, `<link>`, dấu ngăn chữ của React `<!-- -->`, hash build, id `_R_…`, mỗi thẻ một dòng).

Bản gốc dựng **một lần**, ở Task 4, sau lệnh reset DB E2E của cổng kiểm tra (DB đã ở 008) và trước E2E, từ gốc repo. Worktree nằm **ngoài repo** (`${TMPDIR:-/tmp}/fc-base`, không bao giờ `.worktrees/` hay thư mục nào trong repo: `tsconfig` gồm `**/*.ts`, Vitest gồm `**/*.test.ts`, oxlint không bỏ qua nó, nên typecheck, `next build`, `npm test` và lint của repo sẽ đọc các file của `4f67931`). `node_modules` được chép bằng `cp -cR` (Turbopack từ chối `node_modules` là symlink ra ngoài thư mục). Không reset DB cho bản gốc: `reset-db.mjs` của `4f67931` chỉ biết tới 007, còn build của nó không đọc bảng nào của 008, nên build trên DB E2E đã ở 008 là đúng. Mỗi lệnh dưới đây tự đủ (đường dẫn tuyệt đối, không dựa vào biến hay thư mục của lệnh trước):

```bash
git worktree add --detach "${TMPDIR:-/tmp}/fc-base" 4f67931 && cp -cR node_modules "${TMPDIR:-/tmp}/fc-base/"
(cd "${TMPDIR:-/tmp}/fc-base" && CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build)
mkdir -p "${TMPDIR:-/tmp}/fc-dom/base/en/restaurants" && for f in en en/restaurants/taya-house en/privacy; do cp "${TMPDIR:-/tmp}/fc-base/.next/server/app/$f.html" "${TMPDIR:-/tmp}/fc-dom/base/$f.html"; done
```

Rồi ghi bộ chuẩn hóa vào `${TMPDIR:-/tmp}/fc-dom/normhtml.mjs`:

```js
// ${TMPDIR:-/tmp}/fc-dom/normhtml.mjs: node normhtml.mjs <file.html>
import { readFileSync } from 'node:fs';
let s = readFileSync(process.argv[2], 'utf8');
s = s
  .replace(/<script\b[\s\S]*?<\/script>/g, '')
  .replace(/<link[^>]*>/g, '')
  .replace(/<!-- -->/g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/_next\/static\/[^"' )]+/g, '/_next/static/X')
  .replace(/(id|for|aria-describedby|aria-labelledby|aria-controls)="_R_[^"]*"/g, '$1="R"')
  .replace(/></g, '>\n<');
process.stdout.write(s);
```

Ở mỗi task từ Task 4, ngay sau `npm run build` của cổng kiểm tra, từ gốc repo:

```bash
for f in en en/restaurants/taya-house en/privacy; do echo "== /$f"; diff <(node "${TMPDIR:-/tmp}/fc-dom/normhtml.mjs" "${TMPDIR:-/tmp}/fc-dom/base/$f.html") <(node "${TMPDIR:-/tmp}/fc-dom/normhtml.mjs" ".next/server/app/$f.html"); done
```

Task 13 Bước 5 gỡ worktree và thư mục `fc-dom` khi đợt xong. Kết quả đúng của mọi task từ Task 4: trên cả ba trang chỉ có hai khác biệt của R18 (6 dòng nhãn nav viết thường thay chữ hoa, và `tel:+84859555759` thay `tel:0859555759` ở chân trang), tức 14 dòng `<`/`>` mỗi trang.

| Sau task | Unit + tích hợp | E2E | Visual | Lint |
|---|---|---|---|---|
| mốc `4f67931` | 68 file, 906 test | 151 + 1 skipped | 8 | 19 |
| 1 | 71 file, 943 test | 151 + 1 skipped | 8 | 19 |
| 2 | 72 file, 950 test | 151 + 1 skipped | 8 | 19 |
| 3 | 76 file, 983 test | 151 + 1 skipped | 8 | 19 |
| 4 | 76 file, 984 test | 152 + 1 skipped | 8 | 19 |
| 5 | 77 file, 988 test | 154 + 1 skipped | 8 | 19 |
| 6 | 79 file, 999 test | 155 + 1 skipped | 8 | 19 |
| 7 | 79 file, 1003 test | 158 + 1 skipped | 8 | 19 |
| 8 | 80 file, 1011 test | 159 + 1 skipped | 8 | 19 |
| 9 | 80 file, 1021 test | 161 + 1 skipped | 8 | 19 |
| 10 | 80 file, 1018 test | 161 + 1 skipped | 8 | 19 |
| 11 | 80 file, 1022 test | 162 + 1 skipped | 8 | 19 |
| 12 | 80 file, 1022 test | 162 + 1 skipped | 8 | 19 |
| 13 | 80 file, 1022 test | 162 + 1 skipped | 8 | 19 |


## Rulings — 22 điểm lệch spec đã được chấp nhận (không báo lại khi review)

Chủ dự án đã bảo làm theo các đề xuất của dàn ý, kể cả nửa "Call {display} →" trên thẻ của R20. Kế hoạch chấp nhận cả 22 phán quyết (dàn ý §2) như dưới đây; riêng câu chữ của R20 ở kết quả tìm kiếm khác dàn ý (xem R20) và chờ controller duyệt (Task 13 Bước 6). Mỗi mục ghi điều sẽ xảy ra nếu phán quyết sai. Reviewer không nêu lại chúng như lỗi.

1. **R1. Xóa các hằng nội dung của `lib/data.ts` ngay ở đợt 6, không chờ đợt 10** (spec §14.1 dòng 10). Xóa mọi thứ có nhãn "6" ở báo cáo schema §3, kể cả `DESTS`/`DEST_KEYS` (ba trang admin đọc tên điểm đến ở ngôn ngữ mặc định từ DB) và `CONTACT` (trừ số dự phòng). Giữ `Meal`, `MEALS`, `MEAL_LABELS` (registry ở đợt 7), `SLOTS` (đợt 10, `booking-seed.test` đọc), các kiểu, và `FALLBACK_PHONE` (`{display '+84 236 651 9999', tel '+842366519999'}`, vĩnh viễn: `error.tsx`, `global-error.tsx` và `DEFAULT_PHONE` render không cần DB; một test ghim nó bằng số của điểm đến resort). Bản đông cứng giữ bằng chứng tương đương. Phần A chỉ đổi nguồn của từng thứ; Task 10 (Phần B) xóa hằng. **Nếu sai:** không gì khi chạy; một hằng khôi phục được từ git.
2. **R2. Chữ section và chữ giao diện giữ nguyên trong JSX ở đợt 6; key registry của chúng, các màn `ADMIN_SCREENS` thêm và `CLIENT_KEYS` đến ở đợt 7** (spec §14.1 dòng 7 sở hữu "chữ giao diện" và guard "không chữ khách nào nằm ngoài registry hay DB"). Đợt 6 chuyển nội dung của `lib/data.ts` và các hàng của §5.2. Ngoại lệ: chữ khách **mới** do đợt 6 thêm vào registry kèm `screen`, `vars`, `context` (`booking.all_offline`; nhãn gọi của R20; Phần B). **Nếu sai:** khoảng 120 key chuyển ở đợt 6 thay vì 7, mỗi lần đổi sang `t()` một rủi ro pixel, và chưa có màn nào để sửa chúng.
3. **R3. `CmsImage` bọc `next/image` chỉ nơi đã dùng `next/image`** (chip ẩm thực, thẻ nhà hàng, thẻ điểm đến, câu chuyện, điểm nổi bật; DOM giống từng byte). `<picture>` của hero, ảnh đầu bếp, di sản, chân dung nhà hàng và poster film giữ `<img>` thường với URL của media: bộ tối ưu sẽ mã hóa lại chúng. `CmsImage` có prop `decorative` (ảnh trang trí theo vai trò). Spec §6.3 mục 7 hoàn tất ở đợt 7 cùng việc chuyển file lên Blob và chụp lại baseline. **Nếu sai:** §6.3 mục 7 trễ một đợt; khách không thấy gì.
4. **R4. Ưu đãi được seed với `valid_from`/`valid_until` NULL**, dù lời dẫn của section ghi "valid until 31 December 2026". Seed ngày đó sẽ ẩn ưu đãi từ 2027-01-01 và làm đỏ visual và E2E từ hôm đó (không có đồng hồ đóng băng). Chủ dự án đặt ngày thật ở trình soạn đợt 7. **Nếu sai:** ba ưu đãi vẫn hiện sau 31/12/2026 tới khi có người đặt ngày; một câu UPDATE.
5. **R5. `reservations_offer_id_fkey … ON DELETE SET NULL`**, kèm index một phần và guard của 008 với giá trị có sẵn. Biên tập viên được xóa ưu đãi (spec §3 mục 1); đặt bàn giữ ngày, giờ, số khách và ghi chú "Offer: <tiêu đề>", chỉ mất liên kết. Khôi phục ở đợt 7 (§7.5) tạo lại ưu đãi đúng id nhưng không nối lại đặt bàn. **Nếu sai:** liên kết của ưu đãi đã xóa bị mất; đổi sang RESTRICT là thay một ràng buộc.
6. **R6. `offers.restaurant_id … ON DELETE RESTRICT`.** Ưu đãi sửa ở màn riêng (`content/offers`); xóa một nhà hàng không được lặng lẽ xóa ưu đãi (mỗi lần xóa phải vào `audit_log` để khôi phục). Nhà hàng được lưu trữ, không bị xóa, và nhà hàng có đặt bàn vốn không xóa được (F2). Các hàng riêng của nhà hàng (`restaurant_i18n`, `restaurant_cuisines`, `restaurant_highlights` + i18n) vẫn CASCADE: chúng sửa ở màn nhà hàng và thuộc ảnh chụp của nó. **Nếu sai:** đợt 7 xóa ưu đãi trước; đổi một ràng buộc.
7. **R7. Cron hằng ngày gọi `revalidateTag('content:offers', 'max')`, không phải `{ expire: 0 }`** (spec §6.2). Đo được (báo cáo read §5): với `expire:0` mà DB sập lúc 00:05, `/en` trả 500 dạng chữ thường cho mọi khách tới khi DB về; với `'max'` không bao giờ hỏng. Giá: khách đầu tiên sau 00:05 thấy ưu đãi hôm qua một lần (người sau thấy hôm nay); DB sập thì ưu đãi cũ tới lần revalidate hằng giờ sau khi DB về. Một ưu đãi hết hạn hiện một lần không tự gắn vào đặt bàn được (R9 kiểm khung ngày). Task 13 (Phần B) chứa câu sửa spec §6.2 cho controller: "Riêng cron ưu đãi hằng ngày dùng `'max'`: khách đầu tiên sau 00:05 có thể thấy bản cũ một lần, nhưng DB lỗi lúc đó không làm sập trang chủ". **Nếu sai:** một đối số.
8. **R8. Phán quyết 7 của đợt 2 (DB sập sau một lần hết hạn) với lần lưu admin: giữ `updateTag`, chấp nhận cửa sổ.** Cửa sổ cần DB hỏng giữa một lần lưu và lần ghé đầu tiên vào từng trang đã hết hạn; nó tự lành. Đo được: `/en` và `/en/privacy` trả 500 chữ thường; trang chi tiết stream `error.tsx` nhưng không bao giờ kết thúc response (Next 16.3.7). Chuyển sang đợt 10: làm ấm các trang bị ảnh hưởng trong `after()` sau commit; `export const maxDuration` ở trang chi tiết; kiểm cả hai ở preview đầu tiên. "error.tsx kèm số điện thoại" của spec §12 chỉ đúng với route có stream; ghi chú ở §12. **Nếu sai:** khách thấy 500 thô trong một lần DB sập bắt đầu ngay sau một lần lưu.
9. **R9. `offerId` là liên kết mềm** (Phần B, Task 9). Client: `openReserve(preset, offer?: {id, title})` giữ việc điền sẵn ghi chú; trạng thái đặt bàn nhớ `{offerId, restaurant}`; lần gửi chỉ mang `offerId` khi nhà hàng đang chọn vẫn là của ưu đãi. Server: zod `offerId` tùy chọn, số nguyên dương ≤ 2³¹−1, giá trị sai bị bỏ (`.catch(undefined)`), không bao giờ là mã lỗi; câu INSERT ghi `offer_id = (SELECT o.id FROM offers o WHERE o.id = $n AND o.restaurant_id = $restaurant AND o.is_published AND (o.valid_from IS NULL OR o.valid_from <= $date) AND (o.valid_until IS NULL OR o.valid_until >= $date))`. Không tag trong drawer, không `offer_unavailable`, không dòng email nhân viên, không dòng admin: những thứ đó ở đợt 7. **Nếu sai:** nhân viên chỉ thấy ưu đãi qua ghi chú tới đợt 7; từ chối chặt là một nhánh code và một key registry.
10. **R10. Mọi SQL rời các cột đợt 1 ở đợt 6; không trigger đồng bộ.** `rules.ts`, `config.ts`, `recipients.ts`, `outbox.ts`, `drain.ts` (`reachesSql(…, '<bí danh>.destination_id')`), danh sách nhà hàng của admin và danh mục đều chuyển; 008 bỏ NOT NULL của `type`/`destination` (giá trị giữ nguyên, nên quay lại code đợt 5 vẫn chạy). Guard test đỏ khi app đọc `type`, `destination`, `cuisines`, `meals` của `restaurants` hay `slot_capacity`. Đường đặt bàn của khách từ chối nhà hàng chưa đăng hoặc đã lưu trữ (`restaurant_unavailable`). **Nếu sai:** một bộ đọc bị sót hiện thành guard đỏ, không lặng lẽ mất.
11. **R11. Seed: id cố định (`OVERRIDING SYSTEM VALUE`) + `ON CONFLICT DO NOTHING` + chỉ seed danh sách khi bảng rỗng + bản dịch nối với hàng cha + `setval(GREATEST(max, last_value))`.** Chặt hơn §5.1 mục 7. **Nếu sai:** không gì (`migrate.mjs` không bao giờ chạy lại một file).
12. **R12. Ràng buộc DB ngoài chữ của spec:** `restaurants_detail_image` (trang cần chân dung; spec nghiệm thu đặt nó), `restaurants_published_card`, `nav_items` UNIQUE(target_section) và NOT IN (film, finder), các CHECK static/blob/kích thước của media, CHECK không trắng và độ dài cho chữ dịch được, link chỉ https, `offers_price_pair`/`offers_valid_range`, enum `social_links.platform` (facebook, instagram, youtube, tiktok, zalo, x, tripadvisor, wechat, kakao, line), và `sections` không có `sort_order`/`is_published` (không phải danh sách; spec §2: không page builder). **Nếu sai:** một migration sau nới một CHECK.
13. **R13. Slug ngẫu nhiên (phán quyết 8 của đợt 2): chấp nhận; giới hạn tần suất ở đợt 10.** Không dùng được `dynamicParams` (F7); `await connection()` làm tệ hơn. Mỗi slug ngẫu nhiên thêm khoảng 6 file / 92 KB vào cache ISR và một trang 404 cache 30 ngày (mang `restaurants`, nên mọi lần lưu danh mục xóa chúng). `generateStaticParams` trả `['_none']` khi chưa nhà hàng nào có trang. **Nếu sai:** cache phình dưới crawler tới quy tắc WAF của đợt 10.
14. **R14. M7 (tiêu đề soft-404) và M4 (vỏ no-JS rỗng cho nhà hàng lạ): chấp nhận, xem lại ở đợt 8** cùng việc 404 đa ngôn ngữ. `generateMetadata` trả "Page not found — Furama Cuisine" + noindex cho slug lạ và cho ngôn ngữ đang tắt (đóng sớm rủi ro 7 của đợt 2), nhưng HTML server của lần ghé đầu tiên vẫn mang tiêu đề trang chủ. noindex có mặt ở mọi nơi, kể cả với Googlebot. **Nếu sai:** thẩm mỹ.
15. **R15. Dư lượng của đợt 4 (RSC 404 `x-nextjs-postponed` của khách trong lúc `updateTag('restaurants')`): chấp nhận.** Tái hiện ở cả hai spike (1 lần tải lại cứng trên 50–80 lần điều hướng ở 6–8 lần hết hạn mỗi giây; 0 với `'max'`); client rơi về tải cả trang với nội dung đúng (`fetch-server-response.js:139-148`). Thử lại trên Next ≥16.4 và ở tần suất lưu thật của đợt 7. **Nếu sai:** khách đôi khi bị tải lại cả trang trong lúc admin lưu.
16. **R16. Loader không lọc `locales.is_enabled`.** Proxy và layout `(guarded)` chặn ngôn ngữ; Draft Mode của đợt 8 phải render được ngôn ngữ đang tắt (F6). Đóng điểm nhỏ của Task 4/10 đợt 2 ("loadStringRows thiếu is_enabled") là chủ ý. **Nếu sai:** một vị từ trong `LOCALE_CTE`.
17. **R17. `getSiteSettings()` không nhận locale** (spec §6.2 nói mọi bộ đọc nhận một locale): không gì trong `site_settings` được dịch, nên một entry phục vụ mọi ngôn ngữ. **Nếu sai:** một đối số.
18. **R18. Cho phép hai khác biệt DOM, pixel giống hệt:** nhãn nav của header lưu một lần theo chữ thường tự nhiên và viết hoa bằng `.hdr-nav .hdr-link { text-transform: uppercase }` (spec §6.3 mục 6; `MENU_LABELS` bỏ); link Dining House ở chân trang gọi `tel:+84859555759` (E.164 từ `destinations`) thay vì `tel:0859555759`. Chữ hiển thị "0859 555 759" giữ tới khi chủ dự án trả lời (spec §15 mục 14). **Nếu sai:** không gì; cả hai đúng ý spec.
19. **R19. Alt của thẻ nhà hàng = bản sao tên nhà hàng được seed.** Bộ đọc dùng alt của media. Trình soạn nhà hàng ở đợt 7 phải đổi alt EN của thẻ khi đổi tên mà alt còn bằng tên cũ. **Nếu sai:** alt cũ sau một lần đổi tên.
20. **R20. "Gọi để đặt bàn" (rủi ro 8 của đợt 4): làm câu báo của drawer khi mọi nhà hàng đặt online đều tắt ngay; hành động Call trên thẻ/tìm kiếm cũng làm** (chủ dự án đã đồng ý nửa thẻ). Luôn: không còn nhà hàng đặt được, RESERVE mở drawer với `booking.all_offline` ("Online booking is not available right now. Please call us on {phone} to book a table.", `DEFAULT_PHONE`) thay vì "Checking tables…" mãi. Thẻ của một nhà hàng không có trang mà đặt offline hiện "Call {display} →", và kết quả tìm kiếm của nó hiện "Call →" ngắn; cả hai gọi số của nhà hàng, không có thì của điểm đến; không có số nào thì vẫn trơ (GX-6). Phần B, Task 11. **Khác câu chữ dàn ý, chờ controller duyệt:** dàn ý (và câu chủ dự án đồng ý) ghi "Call {display} →" cho cả kết quả tìm kiếm. Đo trên build có số trong hàng tìm kiếm (Hải Vân Lounge, đặt online tắt): ở 390 px tên nhà hàng gãy ba dòng và dòng loại · điểm đến gãy năm dòng; ở 320 px hộp tên còn rộng 0 px và nhãn "Call +84 236 651 9999 →" (165 px, `white-space: nowrap`) đè lên cột chữ. Nên hàng tìm kiếm giữ "Call →" (key `booking.call_action`); nếu controller muốn đúng câu chữ, đổi sang `booking.call_tag` với `{ phone: r.phone.display }`, bỏ `booking.call_action` và test của nó, sửa `booking-switch.serial`, và sửa CSS của `.search-result-action` cho hàng hẹp. **Nếu sai:** bỏ nửa thẻ; nửa drawer là sửa lỗi.
21. **R21. Project Playwright `desktop-serial` chạy với `workers: 1`** (`testProject.workers`, 1.63; Task 4), và mọi spec serial đổi dữ liệu khách thấy trả lại nó qua một đường làm hết hạn cùng tag (một lần lưu hoặc cron), không bao giờ một câu UPDATE trần. **Nếu sai:** không gì.
22. **R22. Đóng việc chuyển giao của đợt 5 ở đợt 6:** một bộ đọc `site_settings` (T6.8; Task 3); `saveInbox` gọi `updateTag(TAGS.contentContact)` sau commit (spec §6.2 gán `site_settings` cho `content:contact`); `{email}` của trang chính sách từ `getSiteSettings()`; câu ở màn thông báo thành "Đây cũng là email chung hiện ở chân trang web và trong trang chính sách bảo mật; lưu xong, web khách đổi theo ngay." (T6.2; Task 4). **Nếu sai:** câu chữ.

**Ghi chú triển khai (Phần A).** Các điểm sau không lệch spec; chúng điều chỉnh dàn ý theo những gì lần chạy Phần A cho thấy. Mỗi điểm đã chạy trong `p6-verify`.
- **Task 1, C3 cho cả bản dịch.** Ngoài `WHERE NOT EXISTS (SELECT 1 FROM <bảng>)` ở tám danh sách (cuisines, highlights, hero_slides, experiences, stories, offers, nav_items, social_links), seed `destination_i18n`, `cuisine_i18n`, `restaurant_highlight_i18n`, `experience_i18n`, `story_i18n`, `offer_i18n`, `nav_item_i18n` đổi từ `VALUES` thẳng sang `SELECT … FROM (VALUES …) JOIN <bảng cha>`; seed `offers` còn nối `restaurants` (một nhà hàng đã xóa không nhận ưu đãi seed). Hai test mới của dàn ý ("xóa offer 3 rồi chạy lại vẫn 2", RESTRICT khi xóa nhà hàng có ưu đãi) nằm ở `migration-008.test.ts`; hai đột biến tương ứng (bỏ chặn bảng rỗng của offers, đổi RESTRICT về CASCADE) mỗi cái làm đúng test của nó đỏ (Bước 11). Test RESTRICT dùng một nhà hàng tạm `pop-in` (không đặt bàn, không ca phục vụ, không người nhận), để lần từ chối chỉ có thể đến từ `offers_restaurant_id_fkey` và test tự dọn được.
- **Task 2 có nhiều bộ đọc hơn dàn ý liệt kê.** Ngoài `rules.ts`, `config.ts`, `recipients.ts`, hai câu SQL của email cũng đọc `restaurants.destination`: `queueStaffNew` (`outbox.ts`, `rest.destination`) và `recipientStillWanted` của bộ gửi (`drain.ts`, `t.destination`). Cả năm chỗ chuyển; `test/integration/destination-id.test.ts` (mới) dời Tàya House sang Dining House chỉ ở `destination_id` và kiểm từng bộ đọc theo đó (ngày đóng cửa, số điện thoại nhóm, phạm vi ngày đóng cửa, danh sách nhà hàng của admin, hàng đợi `staff.new`, lần kiểm lại của bộ gửi, danh sách "chưa có người nhận"). `listRestaurantOptions` của admin chỉ đọc `id, name` và đã `ORDER BY sort_order, id`: không đổi.
- **Task 2, "đặt online được" là một cột tính.** `loadBookingRules` trả `bookingEnabled = booking_enabled AND is_published AND archived_at IS NULL`: API availability và lần gửi của khách đều dựa vào nó (qua `resolveDay`), còn đường của nhân viên dùng `planDay`, không đọc nó, nên nhân viên vẫn đặt được cho một nhà hàng ẩn. Màn quy tắc của admin vẫn đọc cờ thật (`config.ts`).
- **Task 2, test thứ tự hòa phải đỏ thật.** Câu `UPDATE … WHERE id IN (…)` một lần để ba hàng theo thứ tự cũ trong bảng, nên `ORDER BY sort_order` một mình vẫn cho đúng thứ tự và test xanh trên code cũ. Test cập nhật từng hàng theo thứ tự id ngược (mỗi UPDATE đưa hàng về cuối heap); trên code cũ nó đỏ với `['danaksara', 'cafe-indochine', 'taya-house']`.
- **Task 3, `LOADERS` lớn dần theo task.** `lib/cache-plan.test.ts` đòi mọi mục của `LOADERS` có một loader gọi `cacheTag(...LOADERS.<tên>.tags)`, nên Task 3 khai mười mục của nó (cả ba loader cũ `locales`, `strings`, `legal` chuyển sang `LOADERS`), Task 6 thêm `heroSlides`, `experiences`, `stories`, Task 7 thêm `detail`, `detailSlugs`, Task 8 thêm `offers`. `CONTENT_TABLES` và `SAVE_TAGS` đầy đủ ngay từ Task 3.
- **Task 3, loader danh mục mang thêm hai tag.** Trường `search` gấp nhãn ẩm thực và tên điểm đến, `phone` lấy số của điểm đến: `loadRestaurants` đọc `cuisines`, `cuisine_i18n`, `destinations`, `destination_i18n`, nên `LOADERS.restaurants.tags` có thêm `content:cuisines`, `content:destinations` (test của cache plan bắt buộc). `scripts/check-prerender.mjs` mong thêm ba tag này (cùng `media`) ngay ở Task 3; Task 4 thêm ba tag còn lại của layout.
- **Task 3, chữ tìm kiếm giống hệt bản cũ ở tiếng Anh.** Thứ tự là tên, loại, nhãn ẩm thực, tên điểm đến (như `SearchOverlay` ghép trước đợt 6), rồi các từ của ngôn ngữ mặc định khi chúng khác; không bỏ từ trùng (bỏ từ trùng sẽ làm truy vấn "1f vietnamese" của Phố Cuốn không còn khớp).
- **Task 3, `Destination.name` cho phép NULL.** Seed của schema để tên của điểm đến teaser ("Future Locations") là NULL; lọc `name IS NOT NULL` như spike read sẽ làm mất thẻ thứ tư của section Destinations. `destName()` trả `''` cho id lạ hay tên NULL; danh sách chọn điểm đến chỉ lấy `kind = 'venue'` có tên.
- **Task 3, `DestKey` thành `string`.** `Restaurant.dest` là `destination_id`; đổi kiểu ở đây giữ cho các component còn tra `DESTS[r.dest]` biên dịch được tới Task 5/7, và Task 10 xóa `DESTS`.
- **Task 3, mã ngôn ngữ mà Intl từ chối đọc như tiếng Anh** (vòng review). Một đường dẫn có dấu chấm (`/favicon.ico`, `/wp-login.php`, `/apple-touch-icon.png`) bỏ qua proxy và tới `[lang]` với chính nó làm ngôn ngữ; `new Intl.DateTimeFormat('favicon.ico')` ném `RangeError`. `formatStoryDate` và `formatPrice` đọc mã đó như `'en'` thay vì ném; trang kiểm ngôn ngữ trước khi đọc (Task 6), nên đây chỉ là lưới cuối cho loader. Guard của cột đợt 1 cũng bắt `type`, `cuisines`, `meals` đứng trần khi `restaurants` là bảng duy nhất của câu (`SELECT id, type FROM restaurants`); khi câu nối bảng khác, cột trần không gán được cho bảng nào và để cho quy tắc bí danh.
- **Task 3 làm `lib/content/format.ts` như dàn ý**, dù người dùng đầu tiên của `storyKicker` ở Task 6 và của `formatPrice`/`offerDetail` ở Task 8: test của nó chạy trên Node 24 của CI từ sớm. Công thức giá theo dàn ý §4.7 (`Intl.NumberFormat(locale)`, giữ phần lẻ: `USD 42.5 net per guest`), không phải `maximumFractionDigits: 0` của spike read. `VENUE_TODAY` nằm sẵn trong `sql.ts`.
- **Task 4, WATCH THE FILM theo section film** (chủ của section film là Task 4); FIND A RESTAURANT theo section finder ở Task 6 cùng các section khác.
- **Task 4, diff DOM so với một build của `4f67931`, chụp ngay sau build.** Chép HTML sau E2E thì sai: spec `shared-inbox.serial` làm ISR sinh lại `/en/privacy` với địa chỉ giữa chừng. Từ Task 4 tới Task 7 kết quả đúng là R18 và chỉ R18 (14 dòng mỗi trang).
- **Task 5, `lib/content/options.ts` (mới).** Ba danh sách chọn (ẩm thực, dịp, điểm đến) dùng chung cho Finder, FinderSheet, thanh đặt bàn và drawer (hai chỗ sau trước đây lặp cùng đoạn code). Unit test của nó là RED của task; hai test mới của `filters.spec.ts` (theo dàn ý) xanh ngay trên build Task 4 vì hành vi không đổi, chúng là lưới giữ hành vi khi đổi nguồn. Spec E2E viết và chạy trước unit test (Bước 1–2), như mọi task: `next build` typecheck cả file test, nên một `options.test.ts` import module chưa có sẽ làm hỏng build. Hành động "Call" ở kết quả tìm kiếm thuộc Task 11.
- **Task 6, trang khách kiểm ngôn ngữ trước khi đọc** (vòng review). Trang chủ của Task 6 đọc nội dung theo ngôn ngữ của URL song song với kiểm ngôn ngữ của layout; trên build đó `/favicon.ico`, `/wp-login.php`, `/apple-touch-icon.png`, `/.env` trả 500 (`RangeError: Incorrect locale information provided`, lỗi của trang thắng `notFound()` của layout) và mỗi đường dẫn như thế hỏi DB mỗi lần (render hỏng không được cache). `requireEnabledLocale(code)` (`lib/server/content/locales.ts`) gọi `notFound()` khi ngôn ngữ không bật; trang chủ và trang chính sách gọi nó trước mọi lần đọc (trang chính sách có cùng 500 tiềm ẩn từ đợt 5: `/favicon.ico/privacy`), trang chi tiết của Task 7 cũng vậy. Guard `test/guards/guest-pages.guard.test.ts` theo mẫu "every page awaits the session check before anything else" của admin; `e2e/routing.spec.ts` thêm một test 404 cho các đường dẫn đó (đỏ trên build Task 5 vì `/favicon.ico/privacy`). `lib/content/home-sections.ts` (`homeSections`) quyết section nào của trang chủ hiện (cờ `is_visible`, danh sách rỗng, `restaurants` luôn có) và trả lời cho nút film, nút finder, film và thanh đặt bàn; trước đó không test nào giữ hành vi của `sections.is_visible` phía khách.
- **Task 7, mô tả SEO.** Không có `seo_description` thì trang không khai `description` (lấy của layout); tiêu đề dự phòng là `${name} — Furama Cuisine`. Phần nổi bật ẩn ở mức trang khi không có; `RESERVE` theo `detail.bookingEnabled` của loader trang (cùng tag `restaurants` với danh mục). Highlight có ảnh đã xóa mềm hoặc thiếu tiêu đề ở cả hai ngôn ngữ bị bỏ.
- **E2E đỏ chạy trên build của task trước** (Task 4, Task 6, Task 7): spec mới viết trước test tích hợp của task, nên build không vướng import module chưa có. Lệnh dùng `--no-deps` để chỉ chạy các file đó, kể cả file `*.serial.spec.ts`.

**Ghi chú triển khai (Phần B).** Cũng không lệch spec; mỗi điểm đã chạy trong `p6-verify`.
- **Task 8, `'max'` thấy được ở E2E.** Sau cron, lần tải đầu có thể còn trang cũ (trang đang render lại phía sau), nên `offers-expiry.serial` tải lại tới khi thấy hai ưu đãi (tối đa 15 giây), và trong `finally` chờ tới khi thấy lại ba, để spec serial sau không thấy trạng thái giữa chừng. `check-prerender` có tuổi cache theo từng trang (`LIFETIME`) và in chúng. `loadOffers` đọc tên và cờ đăng của `restaurants`, nên `LOADERS.offers` mang thêm `restaurants`.
- **Task 9, liên kết mềm đúng nghĩa.** Spike read trả mã `unknown` cho một `offerId` sai; R9 bỏ nó (`.catch(undefined)`), nên trường này không có mục trong `FIELD_CODES`. Ưu đãi nhớ nhà hàng của chính nó (`preset.restaurant`), không nhà hàng drawer đang chọn; một RESERVE thường sau đó không xóa nó (ghi chú `Offer: …` cũng còn trong form), đóng drawer sau một đặt bàn xong thì xóa cả hai. `lib/booking/client.ts` không đổi: Server Action nhận `unknown`.
- **Task 10, `DestKey` đi theo `DESTS`.** Nó không là kiểu DTO nội dung mà là bí danh của `string` (Task 3), nên `lib/data.ts` chỉ còn `Meal` và `Restaurant` làm kiểu. Bộ đọc điểm đến của admin lấy mọi điểm đến `kind = 'venue'`, kể cả chưa đăng (nhân viên vẫn đóng cửa hay nhận email theo nó), theo tên ở ngôn ngữ mặc định. Khối 2 của test seed còn một chỗ đọc `DATA.CONTACT`, thay bằng số viết thẳng.
- **Task 11, hai nhãn gọi (khác câu chữ R20 của dàn ý, chờ controller duyệt).** Thẻ in "Call {display} →" như R20; hàng tìm kiếm in "Call →" ngắn (như spike detail), vì hàng hẹp trên điện thoại: với số trong hàng, ở 390 px tên gãy ba dòng, ở 320 px nhãn đè lên tên (đo ở vòng review, R20). Ba key `booking.all_offline`, `booking.call_tag`, `booking.call_action` (`screen: 'booking'`). Chạm thẻ gọi bằng `window.location.assign('tel:…')`; Chromium headless phát ra một request `tel:` (hỏng vì không có ứng dụng gọi), nên spec kiểm được đúng số.
- **Task 12, một đột biến sống sót.** M2 (loader trang chi tiết bỏ qua `has_detail_page`) đỏ ở test tích hợp nhưng xanh ở `restaurant-pages.serial`: kiểm 404 của spec đọc chữ response tìm "Page not found", mà payload RSC của mọi trang mang boundary not-found (chữ đó có trong HTML của `/en` và trang Tàya); và lúc tắt, spec gỡ cả chân dung. Spec giờ kiểm 404 trong trình duyệt và tắt trang chỉ bằng công tắc; M2 đỏ, M1 vẫn đỏ. Các đột biến M10 được viết lại thành một sửa mỗi cái (báo cáo schema chỉ nêu tên chúng).
- **Task 13, runbook chạy thử trước khi viết.** Các lệnh của README (pre-flight, `migrate.mjs`, post-check) chạy trên một DB cục bộ dựng tới 007, như Task 1 Bước 12. README không nhắc mã phán quyết. Spec §11 đặt việc ẩn danh của đợt 10 vào cùng route `/api/cron/daily`: ghi ở sổ (Task 13 Bước 6).

## Review Focus

Năm tình huống spec ngụ ý mà dễ làm hỏng nhất cho người dùng thật. Mỗi dòng có test gắn vào task sở hữu code; mọi tên test là tên thật trong các commit của `p6-verify`.

1. **Một pixel đổi hoặc một chữ biến mất trên web khách.**
   - Có thể hỏng: thiếu hàng bản dịch làm trường trống thay vì rơi về tiếng Anh; ngày câu chuyện in "9 Sept 2026" (en-GB) hay giá có U+00A0 (Intl currency); nhãn nav thiếu CSS viết hoa; ảnh trang trí mất `alt=""`; `<img>` bị đổi sang `next/image` (mã hóa lại); một section bị ẩn vì danh sách rỗng khi seed lệch, hay một section bị tắt vẫn hiện.
   - Test: visual 8/8 ở ngưỡng 0 ở mọi task (build mới, không bao giờ `--update-snapshots`); diff DOM chỉ R18 (Task 4–7, Global Constraints); `test/integration/content-loaders.test.ts` nhóm "the seed is the content of phase 5" (Task 3, 6, 7: mọi loader bằng bản đông cứng, kể cả "stories: picture, kicker rebuilt from the category and the date ("9 Sep 2026"), title and link") và nhóm "languages (spec §5.1 item 5)" ("shows a reviewed translation, and the default language for each field it lacks", "a story or an experience translated in part keeps the default language’s other fields"); `lib/content/format.test.ts` "writes English dates day first …" và "reads as the three seeded offers did, with a plain space after the currency (no U+00A0)" (Task 3, CI chạy trên Node 24); `test/integration/content-seed.test.ts` (Task 1); `content-loaders.test.ts` "offers: the three cards as the site drew them, the detail line rebuilt from the price and the schedule" (Task 8); `lib/content/home-sections.test.ts` "leaves out a section staff switched off, and keeps the others", "leaves out a list with nothing to show: no offer today, no slide", "always keeps the restaurants, whatever the row says", "answers the chrome too: film off hides WATCH THE FILM, finder off FIND A RESTAURANT, booking_bar off the bar" (Task 6). Đột biến M8 của Task 12 (bỏ CSS viết hoa → visual 3 đỏ) và đối chứng âm (sửa `experience_i18n` 1 → visual 4 đỏ).
2. **Cache cũ sau một thay đổi DB.**
   - Có thể hỏng: một loader gắn tag ngoài `LOADERS`; một bảng loader đọc mà lần lưu không làm hết hạn tag nào của loader; trang thiếu tag; `saveInbox` quên `updateTag`; 404 cache của slug chưa có trang không mang `restaurants`; khung ngày của ưu đãi thiếu `cacheLife('hours')` hoặc cron.
   - Test: `lib/cache-plan.test.ts` "expires, on a save to any table a loader reads, at least one of that loader’s tags" và "is what the loaders tag: every cached loader calls cacheTag(...LOADERS.<its name>.tags)" (Task 3, lớn theo Task 6, 7); `scripts/check-prerender.mjs` (tag của layout và `PAGE_TAGS`, Task 3, 4, 6, 7); `e2e/shared-inbox.serial.spec.ts` "saving the shared inbox changes the footer and the privacy policy at once" (Task 4; đỏ trên build Task 3); `e2e/restaurant-pages.serial.spec.ts` "switching has_detail_page on opens a working page for another restaurant, and off closes it again" (Task 7; đỏ trên build Task 6; Task 12 kiểm 404 trong trình duyệt); `e2e/offers-expiry.serial.spec.ts` "an offer past its valid_until stays until the daily cron, which takes it off the home page" và `content-loaders.test.ts` "shows an offer from its valid_from to its valid_until, both days included, by the date in Da Nang" (Task 8). Đột biến M1–M4 ở Task 12.
3. **DB sập làm sập web khách, hay một đường dẫn lạ trả 500.**
   - Có thể hỏng: một lần đọc DB mới lúc request trên trang đã cache (trang thành postponed); `error.tsx`/`global-error.tsx`/`DEFAULT_PHONE` hỏi DB; một loader ném lỗi khi thiếu một hàng tùy chọn; một trang đọc nội dung trước khi kiểm ngôn ngữ (layout và page render song song), nên `/favicon.ico` hay `/wp-login.php` hỏi DB với ngôn ngữ "favicon.ico" và Intl ném `RangeError`: 500 thay cho 404 của đợt 5.
   - Test: `scripts/check-prerender.mjs` (ba trang prerender đủ, không postponed; Task 3–7); `lib/data.test.ts` "FALLBACK_PHONE is a dialable E.164 number …" và `content-loaders.test.ts` "destinations: the four cards, the dropdown names and the footer lines" (ghim `FALLBACK_PHONE` bằng số của resort; Task 4); loader trả mảng rỗng hoặc null cho hàng tùy chọn thiếu (ảnh xóa mềm: `loadHeroSlides`, `loadRestaurantDetail` bỏ hàng), chỉ thiếu hàng `site_settings` mới ném lỗi (`getSiteSettings`). Phần dư đã chấp nhận là R8; cron dùng `'max'` (R7): `test/integration/cron-daily.test.ts` "with the secret, revalidates content:offers once with the max profile (R7), never { expire: 0 }" (Task 8); drawer khi mọi nhà hàng tắt nêu `DEFAULT_PHONE`, không hỏi DB (`booking-switch.serial` "with every restaurant booking offline, RESERVE opens on whom to call, not on a form that never loads", Task 11); `test/guards/guest-pages.guard.test.ts` "every page checks its language before it reads anything" (Task 6, giữ cả trang chi tiết của Task 7), `e2e/routing.spec.ts` "a file a crawler asks for is a 404, not a server error, though its name lands where a language goes" (Task 6, đỏ trên build Task 5) và `lib/content/format.test.ts` "reads as English instead of throwing: /favicon.ico reaches the loaders with "favicon.ico" as its language" (Task 3).
4. **Seed lệch khỏi `lib/data.ts`.**
   - Có thể hỏng: một ký tự (gạch ngang, nháy cong, dạng NFD), cờ trang trí, kích thước ảnh, ngày câu chuyện, chữ hoa của nav, thứ tự ẩm thực, occasion mặc định; một nhãn ẩm thực trên Neon ngoài 8 nhãn; thiếu ảnh `r-<id>.jpg`.
   - Test: `test/integration/content-seed.test.ts` (Task 1: khối 1 so bản đông cứng với `lib/data.ts` và chữ trong component — Task 4–7 xóa dần phần chữ component khi component đổi nguồn, Task 10 xóa phần còn lại; khối 2 so DB với bản đông cứng và đo lại mọi file); `migration-008.test.ts` "stops with the label when restaurants.cuisines holds one no cuisine has" (Task 1); `db/checks/preflight-008.sql` liệt kê 12 nhà hàng và 8 nhãn trước khi chạy trên Neon (Task 1).
5. **Trang nhà hàng 404 hoặc lộ dữ liệu chưa đăng.**
   - Có thể hỏng: loader trang chi tiết bỏ sót `has_detail_page`/`is_published`/`archived_at`; danh mục, highlight, câu chuyện, trải nghiệm, nav, mạng xã hội hiện hàng chưa đăng; hàng ngôn ngữ khác hiện khi chưa `reviewed`; API đặt bàn nhận nhà hàng ẩn; build hỏng khi chưa nhà hàng nào có trang.
   - Test: `content-loaders.test.ts` "none for a restaurant without has_detail_page, an unknown slug, an unpublished or an archived one" (Task 7), "an unpublished cuisine, destination, nav item or social link", "an unpublished slide, experience or story", "hides a machine translation until the language serves them" (Task 3, 6); `test/integration/catalogue.test.ts` "leaves out unpublished and archived restaurants" (Task 3); `submit-reservation.test.ts` "refuses a restaurant that is unpublished or archived, though its online booking is on (R10)" và `booking-rules.test.ts` "an unpublished or archived restaurant does not book online, whatever its switch says (R10)" (Task 2); `restaurant-pages.serial.spec.ts` (bật → trang, tắt chỉ công tắc → 404 trong trình duyệt; Task 7, 12); `content-loaders.test.ts` "an unpublished offer, and the offers of a restaurant that is unpublished or archived" (Task 8); `submit-reservation.test.ts` "books without it when the offer is another restaurant’s, unknown, unpublished, or not running on the booked date" (Task 9); `_none` (Task 7, xem `generateStaticParams`). Đột biến M2 và M7 ở Task 12.

## Rủi ro đã biết

Mỗi mục mang một nhãn: **Đã chấp nhận** (hệ quả của một phán quyết, hoặc đã có biện pháp) hoặc **Cần quyết định** (người dùng chọn). Kế hoạch không thêm task cho các mục này; Task 13 (Phần B) báo lại danh sách và ghi sổ.

1. **Cần quyết định (preview đầu tiên).** Vercel chưa kiểm: `updateTag`/`revalidateTag` tới mọi instance (F7; rủi ro 4 của đợt 4); 500 thô và stream không kết thúc của trang chi tiết khi DB sập (R8); header của 404 đã cache; việc đăng ký cron thứ hai. Danh sách kiểm ở runbook (dàn ý §8, README ở Task 13).
2. **Đã chấp nhận.** ICU của Node 24 (CI, Vercel) cho ngày câu chuyện: `lib/content/format.test.ts` ghim trên CI; visual chỉ chạy cục bộ trên Node 22.
3. **Đã chấp nhận.** Payload mỗi trang tăng khoảng 1,3–1,6 KB gzip (nội dung site trong `SiteProvider`); cắt sau (ví dụ bỏ kích thước media khỏi client).
4. **Đã chấp nhận (Phần B, R7).** `/en` revalidate mỗi giờ (ưu đãi `'hours'`): một lần sinh lại nền mỗi giờ mỗi instance; DB sập quá `expire` (1 ngày) thì trang hỏng.
5. **Đã chấp nhận.** Cửa sổ khóa của 008 trên Neon: ACCESS EXCLUSIVE trên `restaurants` và `site_settings`, SHARE ROW EXCLUSIVE trên `reservations` khoảng 80 ms cục bộ (một round trip); đặt bàn mới chờ ngắn. Chỉ chạy trong cửa sổ deploy.
6. **Đã chấp nhận.** Branch preview tách trước khi có 008 build hỏng (an toàn) tới khi được migrate (luật của README từ 004).
7. **Đã chấp nhận.** Bất biến giữa bảng không nằm trong SQL (không alt cho PDF hay file trang trí, media menu là PDF, `image_mobile_id` chỉ ở slide 1, ưu đãi cùng nhà hàng với đặt bàn): test seed giữ bây giờ, action lưu của đợt 7 giữ sau.
8. **Đã chấp nhận.** `social_links.visible_locales` không có FK; đổi mã ngôn ngữ (đợt 8) phải viết lại các mảng.
9. **Cần quyết định (chủ dự án, đợt 7).** Lời dẫn của Offers ghi cứng "valid until 31 December 2026" và sẽ lệch với `valid_until` (R4).
10. **Đã chấp nhận (R19).** Alt của thẻ là bản sao của tên.
11. **Đã chấp nhận (R13).** Cache phình vì slug ngẫu nhiên tới đợt 10.
12. **Đã chấp nhận (R15, R8).** Cuộc đua RSC 404 và cửa sổ 500 thô vẫn là hành vi upstream của Next 16.3.7.
13. **Cần quyết định (chủ dự án).** Câu trả lời còn chờ: số và cách in của Dining House, handle TikTok, ngày kết thúc ưu đãi, link của Experiences và URL film.
14. **Đã chấp nhận.** Trang chi tiết bật sau build render lúc request ở lần ghé đầu, không có App Shell (rủi ro 10 của đợt 2); response đầu tiên của slug lạ là 200 stream + noindex.
15. **Đã chấp nhận.** Gấp chữ tìm kiếm chỉ bỏ dấu Latin và đ; đợt 8 kiểm ko/zh.
16. **Đã chấp nhận (Task 3).** Danh mục mang thêm `content:cuisines` và `content:destinations`: đổi nhãn một ẩm thực hay tên một điểm đến cũng làm hết hạn danh mục (chữ tìm kiếm và số gọi phụ thuộc chúng). Đúng, chỉ tốn một lần sinh lại.
17. **Đã chấp nhận (Task 9, R9).** Một ưu đãi bị xóa đúng lúc giữa subselect và lần kiểm khóa ngoại của câu INSERT làm đặt bàn đó hỏng một lần (`error.network` kèm số điện thoại), thay vì đặt mà không có liên kết; khách gửi lại là được. Cần một biên tập viên xóa ưu đãi trong vài mili giây của một lần đặt.
18. **Đã chấp nhận (Task 11, R20).** Trên máy tính không có ứng dụng gọi, chạm thẻ "Call +84 … →" không thấy gì xảy ra; số đã in trên nhãn.
19. **Đã chấp nhận (Task 12).** Các kiểm `toContain('Page not found')` trên chữ response của `e2e/routing.spec.ts` (đợt 2) yếu như kiểm mà Task 12 sửa: payload RSC của mọi trang mang boundary not-found. Các test đó còn kiểm status hay `noindex`, nên vẫn đúng; việc 404 đa ngôn ngữ của đợt 8 kiểm heading trong trình duyệt (ghi ở sổ).
20. **Đã chấp nhận (Task 6).** `generateMetadata` của trang chính sách vẫn đọc `legal.*` cho ngôn ngữ của URL, trước khi trang kiểm ngôn ngữ, nên `/<đoạn lạ>/privacy` tốn một lần đọc DB và một entry cache dù trả 404. Crawler hỏi `/favicon.ico`, `/wp-login.php` ở gốc, nơi trang chủ không có `generateMetadata`; trang chi tiết đã kiểm ngôn ngữ trong `generateMetadata` của nó. Đợt 8 (404 đa ngôn ngữ) có thể gọi `requireEnabledLocale` ở đó (`notFound()` dùng được trong `generateMetadata`, `generate-metadata.md:197`).

---

## Sơ đồ file

Task 1–13 đã chạy kiểm chứng; mỗi dòng là file thật của commit trong "Bản kiểm chứng".

| File | Trách nhiệm | Task |
|---|---|---|
| `db/migrations/008_content.sql` | 20 bảng nội dung và bản dịch, mở rộng `restaurants`, `destinations`, `site_settings`, `reservations`; seed của web đợt 5; guard; sequence | 1 |
| `lib/media/image-size.ts` (+ test), `scripts/measure-assets.mjs` | Đọc kích thước JPEG/PNG không phụ thuộc, kiểm xoay EXIF; in khối VALUES của `media` | 1 |
| `test/fixtures/phase5-content.ts` | Bản đông cứng nội dung web ở cuối đợt 5 (12 hằng) | 1 |
| `test/integration/{migration-008,content-seed}.test.ts` | Nâng cấp từ 007, guard, chạy lại, ràng buộc; seed bằng bản đông cứng, đo lại file (khối 1 xóa dần ở Task 4–7, Task 10) | 1, 4–7, 10 |
| `db/checks/{preflight,postcheck}-008.sql` | Kiểm chỉ đọc cho cửa sổ Neon | 1 |
| `lib/server/booking/{rules,config}.ts`, `lib/booking/rules.ts` | Quy tắc đặt bàn và phạm vi ngày đóng cửa theo `destination_id`; số nhóm của nhà hàng trước; nhà hàng ẩn không đặt online | 2 |
| `lib/server/email/{recipients,outbox,drain}.ts`, `lib/server/email/booking/load.ts` | Người nhận theo `destination_id` (2); `getSharedInbox` qua `loadSiteSettings` (3); comment R3 (4) | 2, 3, 4 |
| `test/integration/{destination-id,booking-rules,submit-reservation}.test.ts` | Mọi bộ đọc theo `destination_id`; số nhóm, thứ tự hòa, nhà hàng ẩn (2); `offerId` (9) | 2, 9 |
| `lib/server/content/sql.ts` | `LOCALE_CTE`, `i18nJoin`, `tr`, `mediaJson`, `VENUE_TODAY` | 3 |
| `lib/cache-plan.ts` (+ test) | `CONTENT_TABLES`, `SAVE_TAGS`, `LOADERS`, `tagsForSave` | 3, 6, 7, 8 |
| `lib/content/{types,format}.ts` (+ `format.test.ts`) | DTO của nội dung (3, 6, 7, 8); công thức ngày và giá phía server, mã Intl từ chối đọc như `'en'` (3) | 3, 6, 7, 8 |
| `lib/content/home-sections.ts` (+ test) | `homeSections`: section nào của trang chủ hiện, cho trang và chrome | 6 |
| `lib/server/content/settings.queries.ts` | `loadSiteSettings(db?)`, bộ đọc `site_settings` duy nhất | 3 |
| `lib/server/content/restaurants.queries.ts`, `restaurants.ts` | Danh mục (3); `loadDetailSlugs`, `loadRestaurantDetail` và wrapper (7) | 3, 7 |
| `lib/server/content/site.queries.ts`, `site.ts` | Sections, ẩm thực, điểm đến, nav, mạng xã hội, cài đặt; `getSiteContent` | 3 |
| `lib/server/content/{legal,locales,strings}.ts` | Gắn tag qua `LOADERS` (3); `requireEnabledLocale` trong `locales.ts` (6) | 3, 6 |
| `lib/server/email/booking/render.ts` | Reply-To qua `loadSiteSettings` | 3 |
| `db/queries.ts` | Xóa | 3 |
| `lib/data.ts` (+ `data.test.ts`) | `Restaurant` thêm `image`, `phone`, `search`, `DestKey = string` (3); `FALLBACK_PHONE` (4); chỉ còn danh sách của §4.7 (10) | 3, 4, 10 |
| `test/guards/legacy-columns.guard.test.ts` | Không SQL nào đọc cột đợt 1 (R10), kể cả cột trần khi `restaurants` là bảng duy nhất | 3 |
| `test/guards/guest-pages.guard.test.ts`, `e2e/routing.spec.ts` | Mọi trang khách kiểm ngôn ngữ trước khi đọc; đường dẫn của crawler là 404 | 6 |
| `test/integration/{content-loaders,catalogue}.test.ts` | Loader bằng bản đông cứng, ngôn ngữ, hàng chưa đăng (3, 4, 6, 7, 8); danh mục từ bảng (3) | 3, 4, 6, 7, 8 |
| `lib/booking/client.test.ts` | Fixture `Restaurant` có `image`, `phone`, `search` | 3 |
| `scripts/check-prerender.mjs` | Tag của layout (3, 4); `PAGE_TAGS` (6, 7, 8); `LIFETIME`, `UNCACHED` (8) | 3, 4, 6, 7, 8 |
| `app/(site)/[lang]/(guarded)/layout.tsx`, `components/site/SiteProvider.tsx` | `getSiteContent`, `site`, `destName`, mặc định nhà hàng và dịp (4); `offerId` (9); bỏ `DestKey` (10); gọi số khi nhà hàng đặt offline (11) | 4, 9, 10, 11 |
| `components/site/{Header,Footer,Chrome}.tsx`, `components/overlays/{MenuOverlay,FilmModal}.tsx`, `styles/layout.css` | Nav, chân trang, thanh đặt bàn, film từ DB; CSS viết hoa nav (4); thanh đặt bàn và film hỏi `homeSections` (6) | 4, 6 |
| `app/(site)/[lang]/(guarded)/privacy/page.tsx`, `app/(site)/[lang]/error.tsx`, `app/global-error.tsx`, `lib/booking-errors.ts` | `{email}` từ `site_settings`; `FALLBACK_PHONE` (4); trang chính sách kiểm ngôn ngữ trước khi đọc (6) | 4, 6 |
| `app/admin/(shell)/settings/notifications/{actions.ts,page.tsx}` | `updateTag(content:contact)` sau lưu; câu T6.2 | 4 |
| `playwright.config.ts`, `e2e/shared-inbox.serial.spec.ts` | `desktop-serial` `workers: 1`; hộp thư chung đổi chân trang và trang chính sách | 4 |
| `components/ui/CmsImage.tsx`, `lib/content/options.ts` (+ test) | Ảnh nội dung qua `next/image`; danh sách chọn dùng chung | 5 |
| `components/home/{Cuisines,Finder,Restaurants,RestaurantCard}.tsx`, `components/overlays/{FinderSheet,SearchOverlay,ReserveDrawer}.tsx`, `components/booking/BookingBar.tsx`, `e2e/filters.spec.ts` | Người dùng danh mục đọc từ DB; tìm kiếm theo `r.search`; +2 test | 5 |
| `lib/server/content/home.queries.ts`, `home.ts` | Hero, trải nghiệm, câu chuyện (6); ưu đãi `'hours'` (8) | 6, 8 |
| `app/(site)/[lang]/(guarded)/page.tsx` | Trang chủ async, kiểm ngôn ngữ trước, bỏ section tắt hoặc rỗng qua `homeSections` (6); truyền ưu đãi (8) | 6, 8 |
| `components/home/{Hero,Destinations,Experiences,Heritage,Stories}.tsx` | Section trang chủ từ DB (Hero: nút film ở 4) | 4, 6 |
| `app/(site)/[lang]/(guarded)/restaurants/[slug]/page.tsx` | Trang chi tiết dùng chung, `_none`, metadata, kiểm ngôn ngữ trước khi đọc | 7 |
| `components/detail/{RestaurantHero,Highlights}.tsx` (`git mv` từ `TayaHero`, `TayaExperiences`), `MoreRestaurants.tsx`, `components/site/MobileBar.tsx` | Component trang chi tiết; `openMenu` sửa | 7 |
| `e2e/{restaurant-page,restaurant-pages.serial}.spec.ts`, `e2e/page-scope.spec.ts` | MENU mở PDF, trang không cuộn; nghiệm thu A2 trên The Fan; comment chỗ tiêm lỗi (7); 404 kiểm trong trình duyệt, tắt chỉ bằng công tắc (12) | 7, 12 |
| `components/home/Offers.tsx` | Thẻ ưu đãi từ props, CTA chỉ khi nhà hàng đặt online được (8); mở form kèm ưu đãi (9) | 8, 9 |
| `app/api/cron/daily/route.ts`, `vercel.json`, `test/integration/cron-daily.test.ts`, `e2e/offers-expiry.serial.spec.ts` | Cron 00:05 Đà Nẵng, `revalidateTag('content:offers','max')`; ưu đãi hết hạn rời trang | 8 |
| `lib/server/booking/{input,create}.ts` (+ `input.test.ts`), `e2e/offer-booking.spec.ts` | `offerId` mềm (R9): zod bỏ giá trị sai, INSERT kiểm nhà hàng, cờ đăng và khung ngày | 9 |
| `lib/server/booking/queries.ts` (`listDestinationOptions`), `test/integration/reservation-inbox.test.ts`, `app/admin/(shell)/{reservations/closures,restaurants,settings/notifications}/page.tsx` | Tên điểm đến của admin từ DB (bỏ `DESTS`) | 10 |
| `e2e/smoke.spec.ts` | Ba chấm hero, không đọc `HERO_SLIDES` | 10 |
| `lib/i18n/registry.ts` (+ test), `components/overlays/ReserveDrawer.tsx`, `components/home/RestaurantCard.tsx`, `components/overlays/SearchOverlay.tsx`, `e2e/booking-switch.serial.spec.ts` | `booking.all_offline`; "Call {display} →" trên thẻ, "Call →" trong tìm kiếm (R20) | 11 |
| `README.md` | `db/queries.ts` thôi được nhắc (10); runbook migration 008, cron, cache plan, trang kiểm ngôn ngữ, bảng nội dung, spec serial mới, việc của chủ dự án (13) | 10, 13 |

---

## PHẦN A: lược đồ, bộ đọc, chrome, danh mục, trang chủ, trang chi tiết

### Task 1: Migration 008, seed và các kiểm tra của nó

Mọi thứ của đợt 6 đứng trên migration này, nên nó đến trước và đến một mình. Không code app nào đọc các bảng mới ở task này: code đợt 5 chạy y như trước trên DB đã migrate (E2E 151 + 1 và visual 8/8 trên DB có 008), nên controller có thể chạy 008 lên Neon trước khi đợt 6 deploy.

**Files:**
- Create: `lib/media/image-size.ts`, `lib/media/image-size.test.ts`, `scripts/measure-assets.mjs`, `test/fixtures/phase5-content.ts`, `test/integration/migration-008.test.ts`, `test/integration/content-seed.test.ts`, `db/migrations/008_content.sql`, `db/checks/preflight-008.sql`, `db/checks/postcheck-008.sql`

**Interfaces:**
- Consumes: `resetDatabase(url, until?)`, `migrate(url)`, `withClient(url, fn)`, `databaseUrl(name)`, `TEST_DATABASE_URL` từ `test/helpers/db.ts`; các hằng của `lib/data.ts` (`CUISINES`, `DESTS`, `DESTINATION_CARDS`, `HERO_SLIDES`, `EXPERIENCES`, `STORIES`, `OFFERS`, `DETAIL_PAGE_IDS`, `DETAIL_SEO`, `CONTACT`, `contactFor`, `TAYA_EXPERIENCES`, `NAV_LINKS`, `SOCIALS`, `DEFAULT_RESTAURANT_ID`), chỉ ở khối 1 của `content-seed.test.ts`.
- Produces:
  - Mọi bảng, cột, ràng buộc, index và id seed ở "Tên trong migration `008_content.sql`" (Global Constraints).
  - `lib/media/image-size.ts` (không import gì, cú pháp xóa được kiểu): `type ImageSize = { contentType: 'image/jpeg' | 'image/png'; width: number; height: number }`; `imageSize(bytes: Uint8Array): ImageSize | null`; `jpegIsRotated(bytes: Uint8Array): boolean`.
  - `test/fixtures/phase5-content.ts`: `CUISINES_AT_8FE98F5`, `DESTINATIONS_AT_8FE98F5` (kể cả dòng chân trang, `name: null` cho `future`), `HERO_SLIDES_AT_8FE98F5`, `HERO_AUTOPLAY_MS_AT_8FE98F5`, `SECTIONS_AT_8FE98F5`, `EXPERIENCES_AT_8FE98F5`, `STORIES_AT_8FE98F5`, `OFFERS_AT_8FE98F5`, `DETAIL_PAGES_AT_8FE98F5`, `NAV_AT_8FE98F5`, `SOCIALS_AT_8FE98F5`, `SETTINGS_AT_8FE98F5` (tên giữ `8FE98F5`: code của `4f67931` giống hệt `8fe98f5`, commit sau chỉ thêm một file docs). Task 3, 6, 7 dùng chúng làm giá trị mong đợi của loader.

- [ ] **Bước 1: Viết test của bộ đọc kích thước ảnh**

Kích thước kiểm bằng `sips` cho bốn file thật; một PNG tổng hợp; PDF và header cụt trả `null`; EXIF orientation 6 là xoay, 1 thì không.

Create `lib/media/image-size.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { imageSize, jpegIsRotated } from './image-size';

const asset = (name: string) => new Uint8Array(readFileSync(`public/assets/${name}`));

/** A JPEG made of an EXIF segment (big-endian TIFF, one IFD entry: orientation) and a start of scan. */
function exifJpeg(orientation: number): Uint8Array {
  const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0];
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const length = body.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...body, 0xff, 0xda, 0, 2]);
}

describe('imageSize', () => {
  it('reads the size of the JPEG assets as macOS sips reports it (wide, tall, odd)', () => {
    expect(imageSize(asset('hero-beach.jpg'))).toEqual({ contentType: 'image/jpeg', width: 906, height: 515 });
    expect(imageSize(asset('dest-dining-house.jpg'))).toEqual({ contentType: 'image/jpeg', width: 616, height: 960 });
    expect(imageSize(asset('r-hai-van-lounge.jpg'))).toEqual({ contentType: 'image/jpeg', width: 126, height: 94 });
    expect(imageSize(asset('cuisine-hotpot.jpg'))).toEqual({ contentType: 'image/jpeg', width: 45, height: 45 });
  });

  it('reads a PNG header', () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    png.set([0, 0, 0x05, 0x00, 0, 0, 0x02, 0xd0], 16); // 1280 × 720
    expect(imageSize(png)).toEqual({ contentType: 'image/png', width: 1280, height: 720 });
  });

  it('gives up on anything else', () => {
    expect(imageSize(new TextEncoder().encode('%PDF-1.7 …'))).toBeNull();
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0x00]))).toBeNull();
  });
});

describe('jpegIsRotated', () => {
  it('sees an EXIF orientation that swaps the displayed size, and none in the assets', () => {
    expect(jpegIsRotated(exifJpeg(6))).toBe(true);
    expect(jpegIsRotated(exifJpeg(1))).toBe(false);
    expect(jpegIsRotated(asset('hero-beach.jpg'))).toBe(false);
  });
});
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `npx vitest run lib/media/image-size.test.ts`
Expected: FAIL `Test Files  1 failed (1)`, `Tests  no tests`:

```
 FAIL  lib/media/image-size.test.ts [ lib/media/image-size.test.ts ]
Error: Cannot find module './image-size' imported from …/lib/media/image-size.test.ts
 ❯ lib/media/image-size.test.ts:3:1
```

- [ ] **Bước 3: Viết `lib/media/image-size.ts`**

Không import và chỉ dùng cú pháp kiểu xóa được: `scripts/measure-assets.mjs` nạp thẳng file này qua type stripping của Node, còn `content-seed.test.ts` import nó, nên số trong migration và phép kiểm của test đến từ cùng một bộ đọc.

Create `lib/media/image-size.ts`:

```ts
/**
 * Reads an image's pixel size from its header, with no dependency, for the
 * files under public/assets (spec §5.2 media.width/height). Erasable syntax
 * only and no imports: scripts/measure-assets.mjs loads this file directly
 * through Node's type stripping, and the content-seed test imports it, so the
 * migration's numbers and the test's check come from the same reader.
 * JPEG and PNG only: that is every static asset today. Uploads (phase 7) are
 * measured by the upload path, not here.
 */

export type ImageSize = { contentType: 'image/jpeg' | 'image/png'; width: number; height: number };

export function imageSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // IHDR is always the first chunk: width and height at bytes 16 and 20.
    return { contentType: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes);
  return null;
}

/**
 * Walks the JPEG segments to the first start-of-frame marker (SOF0–SOF15,
 * except DHT C4, JPG C8 and DAC CC), which carries the height then the width.
 * Ignores EXIF orientation on purpose: the browser applies it, so a rotated
 * file would need its width and height swapped. None of the assets has one
 * (`sips -g orientation`); the test pins that.
 */
function jpegSize(bytes: Uint8Array): ImageSize | null {
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    // Fill bytes and markers without a length.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bytes[at + 5] << 8) | bytes[at + 6];
      const width = (bytes[at + 7] << 8) | bytes[at + 8];
      return width > 0 && height > 0 ? { contentType: 'image/jpeg', width, height } : null;
    }
    at += 2 + length;
  }
  return null;
}

/** True when a JPEG carries an EXIF orientation other than 1 (normal), which would swap the displayed size. */
export function jpegIsRotated(bytes: Uint8Array): boolean {
  let at = 2;
  while (at + 4 < bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1];
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (marker === 0xda) return false; // start of scan: no more metadata
    if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === 'Exif') {
      const tiff = at + 10;
      const little = bytes[tiff] === 0x49;
      const u16 = (o: number) => (little ? bytes[o] | (bytes[o + 1] << 8) : (bytes[o] << 8) | bytes[o + 1]);
      const u32 = (o: number) => (little ? u16(o) | (u16(o + 2) << 16) : (u16(o) << 16) | u16(o + 2));
      const ifd = tiff + u32(tiff + 4);
      const count = u16(ifd);
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (u16(entry) === 0x0112) return u16(entry + 8) !== 1;
      }
      return false;
    }
    at += 2 + length;
  }
  return false;
}
```

Run: `npx vitest run lib/media/image-size.test.ts`
Expected: PASS `Tests  4 passed (4)`

- [ ] **Bước 4: Viết bộ sinh hàng `media`**

Create `scripts/measure-assets.mjs`:

```js
#!/usr/bin/env node
/**
 * Prints the `media` seed rows of migration 008 for every file in
 * public/assets: path, type, pixel size and byte count, measured from the files
 * themselves. The migration's VALUES block is this output pasted verbatim, so
 * re-running the script after an asset changes shows the drift, and
 * test/integration/content-seed.test.ts re-measures every file against the
 * database. Reads nothing else and writes nothing.
 *
 *   node scripts/measure-assets.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Node strips the types of this .ts file itself (Node ≥ 22.18); it has no imports of its own.
import { imageSize, jpegIsRotated } from '../lib/media/image-size.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'public', 'assets');

const files = (await readdir(dir)).filter((f) => !f.startsWith('.')).sort();
const rows = [];
for (const file of files) {
  const bytes = new Uint8Array(await readFile(join(dir, file)));
  const size = imageSize(bytes);
  if (!size) throw new Error(`${file}: not a JPEG or PNG this script can measure`);
  if (size.contentType === 'image/jpeg' && jpegIsRotated(bytes)) {
    throw new Error(`${file}: EXIF orientation is set; store the displayed (rotated) size instead`);
  }
  rows.push(`    ('/assets/${file}', '${size.contentType}', ${size.width}, ${size.height}, ${bytes.length})`);
}
console.log(rows.join(',\n'));
```

Run: `node scripts/measure-assets.mjs > "${TMPDIR:-/tmp}/media-values.sql"; echo "exit $?"; wc -l < "${TMPDIR:-/tmp}/media-values.sql"; shasum -a 256 "${TMPDIR:-/tmp}/media-values.sql"`
Expected: `exit 0`, `39` dòng, sha256 `302055f0eba2337c335f121f1576d277b1768364738f9eb909def0fc5db76979`; dòng đầu `    ('/assets/chef.jpg', 'image/jpeg', 456, 378, 57833),`, dòng cuối `    ('/assets/taya-stay.jpg', 'image/jpeg', 960, 720, 159098)`. stderr có cảnh báo vô hại `[MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///…/lib/media/image-size.ts is not specified …`. Khối `VALUES` của `media` ở Bước 9 là đúng output này (Bước 10 so lại).

- [ ] **Bước 5: Viết bản đông cứng của nội dung đợt 5**

Bản chụp nội dung web lúc kết thúc đợt 5: `lib/data.ts` cộng chữ viết thẳng trong component. Đông cứng có chủ ý (cùng kiểu `PHASE1` của `booking-seed.test.ts`): bằng chứng phải sống qua việc xóa những thứ nó sao lại (Task 10).

Create `test/fixtures/phase5-content.ts`:

```ts
/**
 * The guest site's content as it stood at 8fe98f5 (end of phase 5), written
 * out once: lib/data.ts plus the copy that lived in the components. Migration
 * 008 must seed exactly this (test/integration/content-seed.test.ts compares the
 * database with it), and the phase-6 read path must render it unchanged (the
 * visual baselines). It is frozen on purpose, like PHASE1 in
 * booking-seed.test.ts: the comparison must survive the deletion of the
 * constants and component literals it was taken from.
 *
 * Only what moves into content tables is here. The restaurants' own columns
 * (name, type, destination, cuisines) were already in the database (002); the
 * test compares the new columns with those. Section copy and UI text become
 * registry keys, whose defaults are proven by the visual baselines.
 */

export const CUISINES_AT_8FE98F5: readonly (readonly [label: string, slug: string])[] = [
  ['Vietnamese', 'vietnamese'],
  ['Italian', 'italian'],
  ['Thai', 'thai'],
  ['Japanese', 'japanese'],
  ['Steak & Grill', 'steak-grill'],
  ['Hotpot', 'hotpot'],
  ['International', 'international'],
  ['Café & Lounge', 'cafe-lounge'],
];

/** The home cards in order, the dropdown name, and the footer line (null: not in the footer). */
export const DESTINATIONS_AT_8FE98F5 = [
  {
    id: 'resort',
    name: 'Furama Resort Danang',
    title: ['Furama', 'Resort Danang'],
    blurb: ['Iconic beachfront dining', 'since 1997'],
    image: '/assets/dest-resort.jpg',
    footer: 'Furama Resort Danang · 103–105 Võ Nguyên Giáp, Ngũ Hành Sơn, Đà Nẵng · +84 236 651 9999',
  },
  {
    id: 'dining-house',
    name: 'Furama Dining House',
    title: ['Furama', 'Dining House'],
    blurb: ['4 floors · 4 flavours', '1 night out'],
    image: '/assets/dest-dining-house.jpg',
    footer: 'Furama Dining House · 73 Trần Bạch Đằng, An Thượng · 0859 555 759',
  },
  {
    id: 'mm',
    name: 'Furama MM Supercenter',
    title: ['Furama MM', 'Supercenter'],
    blurb: ['Everyday dining', 'for everyone'],
    image: '/assets/dest-mm.jpg',
    footer: null,
  },
  {
    id: 'future',
    name: null,
    title: ['Future', 'Locations'],
    blurb: ['Bringing great food', 'to more places'],
    image: '/assets/dest-future.jpg',
    footer: null,
  },
] as const;

/** Hero.tsx: slide 1 has the phone crop and the only alt text. */
export const HERO_SLIDES_AT_8FE98F5 = [
  { image: '/assets/hero-beach.jpg', mobile: '/assets/hero-hall-m.jpg', alt: 'Dining at Furama Cuisine' },
  { image: '/assets/hero-taya.jpg', mobile: null, alt: '' },
  { image: '/assets/hero-indochine.jpg', mobile: null, alt: '' },
] as const;

/** SiteProvider.tsx: the slideshow's interval. */
export const HERO_AUTOPLAY_MS_AT_8FE98F5 = 7000;

/** The pictures and links of the home sections (Experiences.tsx, Heritage.tsx, FilmModal.tsx). */
export const SECTIONS_AT_8FE98F5 = {
  film: { image: '/assets/hero-beach.jpg', link: null },
  experiences: { image: '/assets/chef.jpg', alt: 'A Furama chef at work', link: null },
  heritage: { image: '/assets/heritage.jpg', alt: '', link: 'https://furamavietnam.com/the-resort/' },
} as const;

export const EXPERIENCES_AT_8FE98F5 = [
  { title: 'Culinary Experiences', blurb: 'Tàya House cooking classes · Seafood & Steak Buffet · Champa dance nights' },
  { title: 'Private Dining & Events', blurb: 'Weddings · Corporate · Celebrations · MICE dining' },
  { title: 'Furama Fabulous', blurb: 'Membership · Rewards · Dining privileges' },
] as const;

/** Stories.tsx draws every image with alt="". */
export const STORIES_AT_8FE98F5 = [
  {
    image: '/assets/story-dh-opening.jpg',
    kicker: 'Restaurant News · 9 Sep 2026',
    title: 'Grand opening: one house, four flavours in An Thượng',
    href: 'https://www.furamadining.com/diem-den/tin/furama-dining-house-grand-opening-mot-ngoi-nha-bon-huong-vi-giua-long-an-thuong',
  },
  {
    image: '/assets/story-the-fan.jpg',
    kicker: 'Restaurant News · 5 Sep 2026',
    title: 'Steakhouse The Fan, where fine food meets art',
    href: 'https://www.furamadining.com/diem-den/tin/steakhouse-the-fan-hanh-trinh-4-nha-hang-noi-am-thuc-va-nghe-thuat-gap-nhau',
  },
  {
    image: '/assets/story-thai-siam.jpg',
    kicker: 'Restaurant News · 3 Sep 2026',
    title: 'Thai Siam Kitchen, a bridge between Vietnam and Thailand',
    href: 'https://www.furamadining.com/diem-den/tin/thai-siam-kitchen-tu-mot-can-bep-thai-den-nhip-cau-am-thuc-va-van-hoa-viet-nam-thai-lan',
  },
  {
    image: '/assets/story-buffet-gala.jpg',
    kicker: 'Furama Resort Danang',
    title: 'Inside the Central Vietnam Seafood & Steak Buffet Gala',
    href: 'https://furamavietnam.com/a-premium-central-vietnam-seafood-steak-buffet-gala-a-culinary-masterpiece-at-furama-resort-danang/',
  },
] as const;

/** Offers.tsx: venue, title and detail on the card; the note pre-filled into the drawer. */
export const OFFERS_AT_8FE98F5 = [
  {
    venue: 'Café Indochine',
    title: 'Seafood & Steak Buffet Dinner',
    detail: 'VND 888,000++ per guest · Nightly 18:30–22:00',
    restaurant: 'cafe-indochine',
    note: 'Offer: Seafood & Steak Buffet Dinner',
  },
  {
    venue: 'Tàya House',
    title: 'Vietnamese Cooking Class',
    detail: 'VND 799,000++ per guest · Daily 11:00 or 14:00',
    restaurant: 'taya-house',
    note: 'Offer: Vietnamese Cooking Class',
  },
  {
    venue: 'Hải Vân Lounge',
    title: 'Afternoon Tea & Dessert Buffet',
    detail: 'VND 450,000 net per guest · ~30 pastries, 12+ teas',
    restaurant: 'hai-van-lounge',
    note: 'Offer: Afternoon Tea & Dessert Buffet',
  },
] as const;

/** The detail pages (TayaHero.tsx, TayaExperiences.tsx, DETAIL_SEO, contactFor, MobileBar's tariff PDF). */
export const DETAIL_PAGES_AT_8FE98F5 = {
  'taya-house': {
    kicker: 'A Wellness Dining Home · Furama Resort Danang',
    story:
      'Beneath the Lagoon Garden, the resort’s “Green Oasis in the Heart of the City” tells a journey from Mường Khụ, a land of stones, to Danang by the sea — with cooking classes led by Cơ Tu chef A Rất Thị Hép.',
    portrait: '/assets/taya-hero.jpg',
    portraitAlt: 'Tàya House',
    seo: {
      title: 'Tàya House — Furama Cuisine',
      description:
        'A wellness dining home beneath the Lagoon Garden at Furama Resort Danang, with Vietnamese cooking classes led by Cơ Tu chef A Rất Thị Hép.',
    },
    menuPdf: 'https://furamavietnam.com/wp-content/uploads/2026/03/Taya-CC-Tariff-A4-1-25.pdf',
    call: '+842366519999',
    map: 'https://maps.google.com/?q=Furama+Resort+Danang',
    highlights: [
      { image: '/assets/taya-class.jpg', alt: 'Cooking class photo', title: 'Vietnamese Cooking Class', detail: 'Daily at 11:00 or 14:00 · VND 799,000++ per guest' },
      { image: '/assets/taya-lounge.jpg', alt: 'Tàya House interior', title: 'Healthy Drinks & Snacks', detail: 'Served in the garden house, daily 10:00–22:00' },
      { image: '/assets/taya-garden.jpg', alt: 'Lagoon Garden', title: 'Private Gatherings', detail: 'Outdoor celebrations and intimate events among the palms' },
      { image: '/assets/taya-stay.jpg', alt: 'Cooking class & stay', title: 'Cooking Class & Stay', detail: 'From USD 420 · 2 nights for 2 guests' },
    ],
  },
} as const;

/** Header.tsx shows NAV_LINKS' capitals, MenuOverlay.tsx its own title case: one label, CSS uppercases the header. */
export const NAV_AT_8FE98F5 = [
  { target: 'restaurants', header: 'RESTAURANTS', menu: 'Restaurants' },
  { target: 'destinations', header: 'DESTINATIONS', menu: 'Destinations' },
  { target: 'experiences', header: 'EXPERIENCES', menu: 'Experiences' },
  { target: 'offers', header: 'OFFERS', menu: 'Offers' },
  { target: 'stories', header: 'STORIES', menu: 'Stories' },
  { target: 'heritage', header: 'ABOUT', menu: 'About' },
] as const;

/** Footer.tsx; the label is the platform's name in capitals. */
export const SOCIALS_AT_8FE98F5 = [
  { platform: 'facebook', label: 'FACEBOOK', href: 'https://www.facebook.com/furamaresort' },
  { platform: 'instagram', label: 'INSTAGRAM', href: 'https://www.instagram.com/furamaculinaryworld/' },
  { platform: 'youtube', label: 'YOUTUBE', href: 'https://www.youtube.com/user/furamaresortvietnam' },
  { platform: 'tiktok', label: 'TIKTOK', href: 'https://www.tiktok.com/@furama.dining.hous' },
] as const;

/** site_settings: the footer email, the booking bar's restaurant, the finder's occasion. */
export const SETTINGS_AT_8FE98F5 = {
  email: 'fb@furamavietnam.com',
  defaultRestaurantId: 'taya-house',
  defaultOccasion: 'Dinner',
} as const;
```

- [ ] **Bước 6: Viết test của migration 008**

Phần đầu dựng một DB ở 007 có một đặt bàn rồi migrate; rồi đếm, chạy lại sau các sửa của biên tập viên (kể cả xóa offer 3 và nav item 6: danh sách chỉ seed khi rỗng, C3), hai guard dừng migration, và từng ràng buộc theo tên (Postgres 18 báo `ON DELETE RESTRICT` là "violates RESTRICT setting of foreign key constraint <tên>"), kể cả RESTRICT của `offers.restaurant_id` (C7, trên một nhà hàng tạm `pop-in`).

Create `test/integration/migration-008.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, databaseUrl, migrate, resetDatabase, withClient } from '../helpers/db';

/*
 * Migration 008 (phase 6): the content tables, the restaurants' content
 * columns, the rest of site_settings, and the FK of reservations.offer_id.
 * What it seeds is checked against the content of 8fe98f5 by content-seed.test.ts;
 * this file checks the upgrade from 007, the guards, a re-run, and the constraints.
 */

const url = databaseUrl('furama_cuisine_migrate008_test');
const FILE = 'db/migrations/008_content.sql';
const sql = (text: string, values: unknown[] = []) => withClient(url, (c) => c.query(text, values));
const one = async (text: string, values: unknown[] = []) => (await sql(text, values)).rows[0];
const count = async (table: string) => (await one(`SELECT count(*)::int AS n FROM ${table}`)).n as number;
const media = async (pathname: string) => (await one(`SELECT id FROM media WHERE pathname = $1`, [pathname])).id as string;
const tableExists = async (name: string) => (await one(`SELECT to_regclass($1) IS NOT NULL AS ok`, [name])).ok as boolean;

/** A phase-5 web booking, as 007 leaves the tables. */
async function booking(restaurant = 'taya-house'): Promise<string> {
  const r = await one(
    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source)
     VALUES ('FC-' || upper(substr(md5(random()::text), 1, 8)), $1, '2026-10-06', '19:00', 'Dinner', 2, 'G', '0905 111 111',
             '+849051' || lpad((floor(random() * 1e5))::int::text, 5, '0'), 'web')
     RETURNING id::text`,
    [restaurant],
  );
  return r.id;
}

const SEEDED: Record<string, number> = {
  media: 39, media_i18n: 20, destination_i18n: 4, cuisines: 8, cuisine_i18n: 8, restaurant_i18n: 12,
  restaurant_cuisines: 15, restaurant_highlights: 4, restaurant_highlight_i18n: 4, sections: 11, hero_slides: 3,
  experiences: 3, experience_i18n: 3, stories: 4, story_i18n: 4, offers: 3, offer_i18n: 3, nav_items: 6,
  nav_item_i18n: 6, social_links: 4,
};
const counts = async () => Object.fromEntries(await Promise.all(Object.keys(SEEDED).map(async (t) => [t, await count(t)])));

describe.skipIf(!TEST_DATABASE_URL)('migration 008: content tables (database)', () => {
  describe('on a database at 007 that already has bookings', () => {
    let existing: string;
    beforeAll(async () => {
      resetDatabase(url, '007_email_and_consent.sql');
      existing = await booking();
      migrate(url);
    });

    it('seeds every table and leaves the bookings as they were, without an offer', async () => {
      expect(await counts()).toEqual(SEEDED);
      expect(await one(`SELECT count(*)::int AS n, count(offer_id)::int AS offers FROM reservations`)).toEqual({ n: 1, offers: 0 });
      expect(await one(`SELECT version FROM reservations WHERE id = $1`, [existing])).toEqual({ version: 1 });
    });

    it('gives every restaurant a slug, a destination_id and a card picture, and only Tàya House a page', async () => {
      expect(
        await one(`SELECT count(*) FILTER (WHERE slug = id AND destination_id = destination AND card_image_id IS NOT NULL)::int AS ok,
                          array_agg(id) FILTER (WHERE has_detail_page) AS pages
                     FROM restaurants`),
      ).toEqual({ ok: 12, pages: ['taya-house'] });
      // The phase-1 columns stay, no longer required (phase 10 drops them).
      expect(
        (await sql(`SELECT column_name, is_nullable FROM information_schema.columns
                     WHERE table_name = 'restaurants' AND column_name IN ('type', 'destination', 'slug', 'destination_id')
                     ORDER BY column_name`)).rows,
      ).toEqual([
        { column_name: 'destination', is_nullable: 'YES' },
        { column_name: 'destination_id', is_nullable: 'NO' },
        { column_name: 'slug', is_nullable: 'NO' },
        { column_name: 'type', is_nullable: 'YES' },
      ]);
    });

    it('ties reservations.offer_id to offers: unknown ids refused, a deleted offer leaves the booking without one', async () => {
      await expect(sql(`UPDATE reservations SET offer_id = 99 WHERE id = $1`, [existing])).rejects.toThrow(/reservations_offer_id_fkey/);
      const { id: offer } = await one(`INSERT INTO offers (restaurant_id) VALUES ('taya-house') RETURNING id`);
      await sql(`UPDATE reservations SET offer_id = $1 WHERE id = $2`, [offer, existing]);
      await sql(`DELETE FROM offers WHERE id = $1`, [offer]);
      expect(await one(`SELECT offer_id FROM reservations WHERE id = $1`, [existing])).toEqual({ offer_id: null });
    });

    it('moves every identity sequence past the seeded ids', async () => {
      for (const table of ['restaurant_highlights', 'hero_slides', 'experiences', 'stories', 'nav_items', 'social_links']) {
        const max = (await one(`SELECT max(id)::int AS m FROM ${table}`)).m as number;
        const { n } = await one(`SELECT nextval('${table}_id_seq')::int AS n`);
        expect({ table, next: n }).toEqual({ table, next: max + 1 });
      }
    });

    it('is safe to apply again: no row added, no edit undone, no sequence moved back', async () => {
      // Editors' changes the seed must not touch on a re-run.
      await sql(`UPDATE offer_i18n SET title = 'Edited' WHERE offer_id = 1`);
      await sql(`UPDATE restaurants SET has_detail_page = false WHERE id = 'taya-house'`);
      await sql(`UPDATE restaurant_i18n SET story = 'Edited story' WHERE restaurant_id = 'taya-house' AND locale = 'en'`);
      await sql(`UPDATE site_settings SET default_restaurant_id = NULL, default_occasion = NULL`);
      await sql(`UPDATE media SET is_decorative = false WHERE pathname = '/assets/heritage.jpg'`);
      // A link an editor removed stays removed (its label is unchanged, so only the guard keeps it out).
      await sql(`DELETE FROM restaurant_cuisines WHERE restaurant_id = 'v-senses-cafe' AND cuisine_id = 'cafe-lounge'`);
      // A renamed label no longer matches restaurants.cuisines: the unknown-label guard must not fire on a re-run.
      await sql(`UPDATE cuisine_i18n SET label = 'Thai food' WHERE cuisine_id = 'thai' AND locale = 'en'`);
      // The newest story is deleted: its id must not be handed out again.
      const story = async () =>
        (await one(`INSERT INTO stories (image_id, href) VALUES ($1, 'https://example.com/a') RETURNING id::int`, [await media('/assets/chef.jpg')])).id as number;
      await story();
      const deleted = await story();
      await sql(`DELETE FROM stories WHERE id = $1`, [deleted]);
      const before = { ...(await counts()), offers: await count('offers') };

      await sql(readFileSync(FILE, 'utf8'));

      expect({ ...(await counts()), offers: await count('offers') }).toEqual(before);
      expect(await one(`SELECT title FROM offer_i18n WHERE offer_id = 1`)).toEqual({ title: 'Edited' });
      expect(await one(`SELECT has_detail_page FROM restaurants WHERE id = 'taya-house'`)).toEqual({ has_detail_page: false });
      expect(await one(`SELECT story FROM restaurant_i18n WHERE restaurant_id = 'taya-house'`)).toEqual({ story: 'Edited story' });
      expect(await one(`SELECT default_restaurant_id, default_occasion FROM site_settings`)).toEqual({
        default_restaurant_id: null,
        default_occasion: null,
      });
      expect(await one(`SELECT is_decorative FROM media WHERE pathname = '/assets/heritage.jpg'`)).toEqual({ is_decorative: false });
      expect((await sql(`SELECT cuisine_id FROM restaurant_cuisines WHERE restaurant_id = 'v-senses-cafe'`)).rows).toEqual([{ cuisine_id: 'vietnamese' }]);
      const { n } = await one(`SELECT nextval('stories_id_seq')::int AS n`);
      expect(n).toBe(deleted + 1);
    });

    it('does not bring back a seeded row an editor deleted: a list is seeded only while it is empty', async () => {
      // Fixed ids with ON CONFLICT DO NOTHING alone would insert offer 3 and its translation again.
      await sql(`DELETE FROM offers WHERE id = 3`);
      await sql(`DELETE FROM nav_items WHERE id = 6`);

      await sql(readFileSync(FILE, 'utf8'));

      expect((await sql(`SELECT id::int FROM offers WHERE id <= 3 ORDER BY id`)).rows).toEqual([{ id: 1 }, { id: 2 }]);
      expect(await one(`SELECT count(*)::int AS n FROM offer_i18n WHERE offer_id = 3`)).toEqual({ n: 0 });
      expect(await one(`SELECT count(*)::int AS n FROM nav_items WHERE target_section = 'heritage'`)).toEqual({ n: 0 });
    });
  });

  describe('guards', () => {
    it('stops, changing nothing, when a booking already carries an offer_id', async () => {
      resetDatabase(url, '007_email_and_consent.sql');
      await sql(`UPDATE reservations SET offer_id = 2 WHERE id = $1`, [await booking()]);
      expect(() => migrate(url)).toThrow();
      expect(await tableExists('media')).toBe(false);
      expect(await one(`SELECT count(*)::int AS n FROM _migrations WHERE name = '008_content.sql'`)).toEqual({ n: 0 });
      await expect(sql(readFileSync(FILE, 'utf8'))).rejects.toThrow(/1 booking\(s\) already carry an offer_id/);
    });

    it('stops with the label when restaurants.cuisines holds one no cuisine has', async () => {
      resetDatabase(url, '007_email_and_consent.sql');
      await sql(`UPDATE restaurants SET cuisines = ARRAY['Vietnamese', 'Fusion'] WHERE id = 'danaksara'`);
      await expect(sql(readFileSync(FILE, 'utf8'))).rejects.toThrow(/label\(s\) with no cuisine: Fusion/);
      expect(await tableExists('cuisines')).toBe(false);
    });
  });

  describe('constraints', () => {
    beforeAll(() => resetDatabase(url));

    it('media: a static file is served from /assets at its own path; images have a size, PDFs none; one row per path', async () => {
      const add = (over: Record<string, unknown>) => {
        const r = { storage: 'static', url: '/assets/x.jpg', pathname: '/assets/x.jpg', content_type: 'image/jpeg', width: 10, height: 10, bytes: 100, ...over };
        const cols = Object.keys(r);
        return sql(`INSERT INTO media (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, Object.values(r));
      };
      await expect(add({ url: '/x.jpg', pathname: '/x.jpg' })).rejects.toThrow(/media_static_path/);
      await expect(add({ url: '/assets/y.jpg' })).rejects.toThrow(/media_static_path/);
      await expect(add({ width: null })).rejects.toThrow(/media_dimensions/);
      await expect(add({ content_type: 'application/pdf', url: '/assets/m.pdf', pathname: '/assets/m.pdf' })).rejects.toThrow(/media_dimensions/);
      await add({ content_type: 'application/pdf', url: '/assets/m.pdf', pathname: '/assets/m.pdf', width: null, height: null });
      await expect(add({ content_type: 'image/gif' })).rejects.toThrow(/media_content_type_check/);
      await expect(add({ bytes: 15 * 1024 * 1024 + 1 })).rejects.toThrow(/media_bytes_check/);
      await expect(add({ storage: 'blob', url: 'http://x/y.jpg', pathname: 'media/y.jpg' })).rejects.toThrow(/media_blob_url/);
      await add({ storage: 'blob', url: 'https://store.public.blob.vercel-storage.com/media/y.jpg', pathname: 'media/y.jpg' });
      await expect(add({ url: '/assets/chef.jpg', pathname: '/assets/chef.jpg' })).rejects.toThrow(/media_pathname_key/);
      await expect(sql(`INSERT INTO media_i18n (media_id, locale, alt) VALUES ($1, 'en', '  ')`, [await media('/assets/m.pdf')])).rejects.toThrow(
        /media_i18n_alt_check/,
      );
    });

    it('a file in use cannot be deleted (ON DELETE RESTRICT); an unused one can', async () => {
      // Postgres 18 words it "violates RESTRICT setting of foreign key constraint <name>".
      const uses: [string, string][] = [
        ['/assets/chef.jpg', 'sections_image_id_fkey'],
        ['/assets/r-the-fan.jpg', 'restaurants_card_image_id_fkey'],
        ['/assets/taya-hero.jpg', 'restaurants_detail_image_id_fkey'],
        ['/assets/cuisine-thai.jpg', 'cuisines_image_id_fkey'],
        ['/assets/dest-mm.jpg', 'destinations_card_image_id_fkey'],
        ['/assets/taya-class.jpg', 'restaurant_highlights_image_id_fkey'],
        ['/assets/hero-taya.jpg', 'hero_slides_image_id_fkey'],
        ['/assets/hero-hall-m.jpg', 'hero_slides_image_mobile_id_fkey'],
        ['/assets/story-the-fan.jpg', 'stories_image_id_fkey'],
      ];
      for (const [path, constraint] of uses) {
        await expect(sql(`DELETE FROM media WHERE pathname = $1`, [path])).rejects.toThrow(
          new RegExp(`violates RESTRICT setting of foreign key constraint "${constraint}"`),
        );
      }
      await sql(`DELETE FROM media WHERE pathname = '/assets/m.pdf'`);
    });

    it('restaurants: a page needs its portrait, a shown card its picture, a phone both forms, a unique slug', async () => {
      await expect(sql(`UPDATE restaurants SET has_detail_page = true WHERE id = 'the-fan'`)).rejects.toThrow(/restaurants_detail_image/);
      // Spec §14.1 row 6: switching a page on for another restaurant (with its portrait) is a plain update.
      await sql(`UPDATE restaurants SET has_detail_page = true, detail_image_id = $1 WHERE id = 'the-fan'`, [await media('/assets/r-the-fan.jpg')]);
      await expect(sql(`UPDATE restaurants SET card_image_id = NULL WHERE id = 'danaksara'`)).rejects.toThrow(/restaurants_published_card/);
      await sql(`UPDATE restaurants SET card_image_id = NULL, is_published = false WHERE id = 'danaksara'`);
      await expect(sql(`UPDATE restaurants SET phone_e164 = '+84236000000' WHERE id = 'pho-cuon'`)).rejects.toThrow(/restaurants_phone_pair/);
      await expect(sql(`UPDATE restaurants SET phone_e164 = '0236', phone_display = '0236' WHERE id = 'pho-cuon'`)).rejects.toThrow(/restaurants_phone_e164_check/);
      await expect(sql(`UPDATE restaurants SET slug = 'taya-house' WHERE id = 'pho-cuon'`)).rejects.toThrow(/restaurants_slug_key/);
      await expect(sql(`UPDATE restaurants SET slug = 'Phở Cuốn' WHERE id = 'pho-cuon'`)).rejects.toThrow(/restaurants_slug_check/);
      await expect(sql(`UPDATE restaurants SET destination_id = 'atlantis' WHERE id = 'pho-cuon'`)).rejects.toThrow(/restaurants_destination_id_fkey/);
      await expect(sql(`UPDATE restaurants SET map_url = 'http://maps.example' WHERE id = 'pho-cuon'`)).rejects.toThrow(/restaurants_map_url_check/);
      // A restaurant added from phase 7 on fills only the new columns.
      await sql(
        `INSERT INTO restaurants (id, name, slug, destination_id, card_image_id) VALUES ('new-place', 'New Place', 'new-place', 'mm', $1)`,
        [await media('/assets/r-the-fan.jpg')],
      );
    });

    it('restaurant_i18n: never blank, one menu (file or link), known locale', async () => {
      const set = (col: string, value: unknown) =>
        sql(`UPDATE restaurant_i18n SET ${col} = $1 WHERE restaurant_id = 'pho-cuon' AND locale = 'en'`, [value]);
      await expect(set('type_label', ' ')).rejects.toThrow(/restaurant_i18n_type_label_check/);
      await expect(set('story', 'x'.repeat(1501))).rejects.toThrow(/restaurant_i18n_story_check/);
      await expect(set('menu_pdf_url', 'http://x.pdf')).rejects.toThrow(/restaurant_i18n_menu_pdf_url_check/);
      await sql(`INSERT INTO media (storage, url, pathname, content_type, bytes) VALUES ('static', '/assets/menu.pdf', '/assets/menu.pdf', 'application/pdf', 10)`);
      await set('menu_pdf_media_id', await media('/assets/menu.pdf'));
      await expect(set('menu_pdf_url', 'https://x.pdf')).rejects.toThrow(/restaurant_i18n_one_menu/);
      await expect(sql(`INSERT INTO restaurant_i18n (restaurant_id, locale) VALUES ('pho-cuon', 'xx')`)).rejects.toThrow(/restaurant_i18n_locale_fkey/);
      // A Vietnamese row may hold only what is translated: the rest falls back to English per field.
      await sql(`INSERT INTO restaurant_i18n (restaurant_id, locale, type_label) VALUES ('pho-cuon', 'vi', 'Món Việt · Tầng 1')`);
    });

    it('cuisines: slug ids; a cuisine in use cannot go; a restaurant takes its links with it', async () => {
      await expect(sql(`INSERT INTO cuisines (id, image_id) VALUES ('Fusion Food', $1)`, [await media('/assets/chef.jpg')])).rejects.toThrow(/cuisines_id_check/);
      await expect(sql(`DELETE FROM cuisines WHERE id = 'thai'`)).rejects.toThrow(/restaurant_cuisines_cuisine_id_fkey/);
      await sql(`INSERT INTO restaurant_cuisines (restaurant_id, cuisine_id) VALUES ('new-place', 'hotpot')`);
      await sql(`DELETE FROM restaurants WHERE id = 'new-place'`);
      expect(await one(`SELECT count(*)::int AS n FROM restaurant_cuisines WHERE restaurant_id = 'new-place'`)).toEqual({ n: 0 });
      // A slug change follows into the links.
      await sql(`UPDATE cuisines SET id = 'japanese-izakaya' WHERE id = 'japanese'`);
      expect(await one(`SELECT cuisine_id FROM restaurant_cuisines WHERE restaurant_id = 'hura-izakaya'`)).toEqual({ cuisine_id: 'japanese-izakaya' });
    });

    it('sections: the fixed keys; restaurants always shown; the film plays YouTube or Vimeo only', async () => {
      await expect(sql(`INSERT INTO sections (key) VALUES ('blog')`)).rejects.toThrow(/sections_key_check/);
      await expect(sql(`UPDATE sections SET is_visible = false WHERE key = 'restaurants'`)).rejects.toThrow(/sections_restaurants_visible/);
      await sql(`UPDATE sections SET is_visible = false WHERE key = 'stories'`);
      await expect(sql(`UPDATE sections SET link_url = 'https://example.com/film.mp4' WHERE key = 'film'`)).rejects.toThrow(/sections_film_video/);
      await sql(`UPDATE sections SET link_url = 'https://www.youtube.com/watch?v=abc' WHERE key = 'film'`);
      await sql(`UPDATE sections SET link_url = 'https://vimeo.com/123' WHERE key = 'film'`);
      await expect(sql(`UPDATE sections SET link_url = 'javascript:alert(1)' WHERE key = 'heritage'`)).rejects.toThrow(/sections_link_url_check/);
    });

    it('navigation: labels of at most 18 characters, one item per section, never to the film or the finder', async () => {
      await expect(sql(`UPDATE nav_item_i18n SET label = $1 WHERE nav_item_id = 1`, ['Nhà hàng của chúng tôi'])).rejects.toThrow(
        /nav_item_i18n_label_check/,
      );
      await sql(`UPDATE nav_item_i18n SET label = $1 WHERE nav_item_id = 1`, ['x'.repeat(18)]);
      await expect(sql(`INSERT INTO nav_items (target_section) VALUES ('offers')`)).rejects.toThrow(/nav_items_target_section_key/);
      await expect(sql(`INSERT INTO nav_items (target_section) VALUES ('film')`)).rejects.toThrow(/nav_items_target_section_check/);
      await expect(sql(`INSERT INTO nav_items (target_section) VALUES ('blog')`)).rejects.toThrow(/nav_items_target_section_fkey/);
      await sql(`INSERT INTO nav_items (target_section) VALUES ('cuisines')`);
    });

    it('offers: a price has its basis, the dates run forward, a currency code', async () => {
      const add = (over: Record<string, unknown>) => {
        const r = { restaurant_id: 'taya-house', ...over };
        const cols = Object.keys(r);
        return sql(`INSERT INTO offers (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(r));
      };
      await expect(add({ price_amount: 100 })).rejects.toThrow(/offers_price_pair/);
      await expect(add({ price_basis: 'net' })).rejects.toThrow(/offers_price_pair/);
      await expect(add({ price_amount: 100, price_basis: 'gross' })).rejects.toThrow(/offers_price_basis_check/);
      await expect(add({ price_amount: -1, price_basis: 'net' })).rejects.toThrow(/offers_price_amount_check/);
      await expect(add({ currency: 'vnd' })).rejects.toThrow(/offers_currency_check/);
      await expect(add({ valid_from: '2026-12-31', valid_until: '2026-12-01' })).rejects.toThrow(/offers_valid_range/);
      await add({ valid_from: '2026-12-01', valid_until: '2026-12-01', price_amount: 42.5, price_basis: 'net', currency: 'USD' });
      await add({}); // no price: the card shows the schedule alone
    });

    it('offers: a restaurant that still has an offer cannot be deleted (ON DELETE RESTRICT)', async () => {
      await sql(
        `INSERT INTO restaurants (id, name, slug, destination_id, card_image_id) VALUES ('pop-in', 'Pop-in', 'pop-in', 'mm', $1)`,
        [await media('/assets/r-the-fan.jpg')],
      );
      const { id } = await one(`INSERT INTO offers (restaurant_id) VALUES ('pop-in') RETURNING id::int`);
      await expect(sql(`DELETE FROM restaurants WHERE id = 'pop-in'`)).rejects.toThrow(
        /violates RESTRICT setting of foreign key constraint "offers_restaurant_id_fkey"/,
      );
      // Its offers go first, one by one (each an audit_log row from phase 7), then the restaurant can.
      await sql(`DELETE FROM offers WHERE id = $1`, [id]);
      await sql(`DELETE FROM restaurants WHERE id = 'pop-in'`);
    });

    it('social links: known platforms, https, a non-empty language list or none', async () => {
      const add = (over: Record<string, unknown>) => {
        const r = { platform: 'zalo', href: 'https://zalo.me/furama', ...over };
        const cols = Object.keys(r);
        return sql(`INSERT INTO social_links (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(r));
      };
      await expect(add({ platform: 'myspace' })).rejects.toThrow(/social_links_platform_check/);
      await expect(add({ href: 'http://zalo.me' })).rejects.toThrow(/social_links_href_check/);
      await expect(add({ visible_locales: [] })).rejects.toThrow(/social_links_visible_locales_check/);
      await expect(add({ visible_locales: ['vi', null] })).rejects.toThrow(/social_links_visible_locales_check/);
      await add({ visible_locales: ['vi'] });
    });

    it('site_settings: a known occasion, a sane autoplay, and a removed default restaurant falls back to NULL', async () => {
      await expect(sql(`UPDATE site_settings SET default_occasion = 'Brunch'`)).rejects.toThrow(/site_settings_default_occasion_check/);
      await expect(sql(`UPDATE site_settings SET hero_autoplay_ms = 500`)).rejects.toThrow(/site_settings_hero_autoplay_ms_check/);
      await expect(sql(`UPDATE site_settings SET default_restaurant_id = 'atlantis'`)).rejects.toThrow(/site_settings_default_restaurant_id_fkey/);
      await sql(
        `INSERT INTO restaurants (id, name, slug, destination_id, card_image_id) VALUES ('pop-up', 'Pop-up', 'pop-up', 'resort', $1)`,
        [await media('/assets/r-the-fan.jpg')],
      );
      await sql(`UPDATE site_settings SET default_restaurant_id = 'pop-up'`);
      await sql(`DELETE FROM restaurants WHERE id = 'pop-up'`);
      expect(await one(`SELECT default_restaurant_id FROM site_settings`)).toEqual({ default_restaurant_id: null });
    });

    it('translations of a removed language go with it; a renamed language follows', async () => {
      await sql(`INSERT INTO offer_i18n (offer_id, locale, title) VALUES (1, 'vi', 'Buffet hải sản')`);
      await sql(`UPDATE locales SET code = 'vi-vn' WHERE code = 'vi'`);
      expect(await one(`SELECT locale FROM offer_i18n WHERE offer_id = 1 AND locale <> 'en'`)).toEqual({ locale: 'vi-vn' });
      await sql(`DELETE FROM locales WHERE code = 'vi-vn'`);
      expect(await one(`SELECT count(*)::int AS n FROM offer_i18n WHERE locale <> 'en'`)).toEqual({ n: 0 });
    });
  });
});
```

- [ ] **Bước 7: Viết test seed**

Khối 1 (không DB) so bản đông cứng với `lib/data.ts` và với chữ trong component (Task 4–7 xóa từng dòng chữ component khi component đó đổi nguồn; Task 10 xóa cả khối). Khối 2 dựng lại từ DB những gì khách đọc và so với bản đông cứng, kể cả công thức ngày `dayFirst` và giá `price` mà lớp đọc phải dùng; tập trang trí đúng bằng các ảnh vẽ với `alt=""`; mỗi hàng `media` là một file thật đo lại.

Create `test/integration/content-seed.test.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as DATA from '@/lib/data';
import { imageSize, jpegIsRotated } from '@/lib/media/image-size';
import {
  CUISINES_AT_8FE98F5,
  DESTINATIONS_AT_8FE98F5,
  DETAIL_PAGES_AT_8FE98F5,
  EXPERIENCES_AT_8FE98F5,
  HERO_AUTOPLAY_MS_AT_8FE98F5,
  HERO_SLIDES_AT_8FE98F5,
  NAV_AT_8FE98F5,
  OFFERS_AT_8FE98F5,
  SECTIONS_AT_8FE98F5,
  SETTINGS_AT_8FE98F5,
  SOCIALS_AT_8FE98F5,
  STORIES_AT_8FE98F5,
} from '../fixtures/phase5-content';
import { TEST_DATABASE_URL, databaseUrl, resetDatabase } from '../helpers/db';

/*
 * Spec §14.1 row 6: "the web is identical to before". Migration 008 must seed
 * exactly the content of 8fe98f5. Three links of one chain:
 *   1. the frozen snapshot (test/fixtures/phase5-content.ts) is what lib/data.ts
 *      and the components held — this block goes when phase 6 deletes them;
 *   2. the database holds the snapshot, rebuilt into the strings a guest reads;
 *   3. every media row is a real file in public/assets, measured.
 * Restaurants were already rows (002): their new columns are compared with
 * their phase-1 columns in the same database, which also holds on Neon.
 * A database of its own, freshly migrated: other files edit the shared one.
 */

const ASSETS = join(process.cwd(), 'public', 'assets');
const url = databaseUrl('furama_cuisine_seed008_test');
let pool: Pool;
const rows = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) =>
  (await pool.query<T>(text, values)).rows;

/** "9 Sep 2026": English day-first with a three-letter month. en-GB says "Sept" (seen on Node 22.22, ICU 77.1), so take en-US's parts. */
function dayFirst(iso: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
      .formatToParts(new Date(`${iso}T00:00:00Z`))
      .map((part) => [part.type, part.value]),
  );
  return `${p.day} ${p.month} ${p.year}`;
}

/** "VND 888,000++ per guest": the number alone through Intl (currency style would put U+00A0 after the code). */
function price(amount: string, currency: string, basis: string): string {
  return `${currency} ${new Intl.NumberFormat('en').format(Number(amount))}${basis === 'plus_plus' ? '++' : ' net'} per guest`;
}

const collapse = (s: string) => s.replace(/\s+/g, ' ');
const source = (path: string) => collapse(readFileSync(path, 'utf8'));

describe('the snapshot is the content of 8fe98f5 (delete with the constants and literals it mirrors)', () => {
  it('matches lib/data.ts', () => {
    expect(CUISINES_AT_8FE98F5).toEqual(DATA.CUISINES);
    expect(DESTINATIONS_AT_8FE98F5.filter((d) => d.name).map((d) => [d.id, d.name])).toEqual(Object.entries(DATA.DESTS));
    expect(
      DESTINATIONS_AT_8FE98F5.map((d) => ({ key: d.id, slot: d.image.slice(8, -4), title: d.title, blurb: d.blurb })),
    ).toEqual(DATA.DESTINATION_CARDS);
    expect(HERO_SLIDES_AT_8FE98F5.map((s) => s.image)).toEqual(DATA.HERO_SLIDES.map((s) => `/assets/${s.img}.jpg`));
    expect(EXPERIENCES_AT_8FE98F5).toEqual(DATA.EXPERIENCES);
    expect(STORIES_AT_8FE98F5).toEqual(
      DATA.STORIES.map(({ img, kicker, title, href }) => ({ image: `/assets/${img}.jpg`, kicker, title, href })),
    );
    expect(OFFERS_AT_8FE98F5).toEqual(DATA.OFFERS);
    expect(Object.keys(DETAIL_PAGES_AT_8FE98F5)).toEqual([...DATA.DETAIL_PAGE_IDS]);
    const taya = DETAIL_PAGES_AT_8FE98F5['taya-house'];
    expect(taya.seo).toEqual(DATA.DETAIL_SEO['taya-house']);
    expect(taya.menuPdf).toBe(DATA.CONTACT.tariffPdf);
    expect({ tel: taya.call, map: taya.map }).toEqual(DATA.contactFor('resort'));
    expect(taya.highlights).toEqual(
      DATA.TAYA_EXPERIENCES.map(({ img, alt, title, detail }) => ({ image: `/assets/${img}.jpg`, alt, title, detail })),
    );
    expect(NAV_AT_8FE98F5.map((n) => ({ label: n.header, target: n.target }))).toEqual(DATA.NAV_LINKS);
    expect(SOCIALS_AT_8FE98F5.map(({ label, href }) => ({ label, href }))).toEqual(DATA.SOCIALS);
    expect(SETTINGS_AT_8FE98F5.email).toBe(DATA.CONTACT.email);
    expect(SETTINGS_AT_8FE98F5.defaultRestaurantId).toBe(DATA.DEFAULT_RESTAURANT_ID);
    expect(SECTIONS_AT_8FE98F5.heritage.link).toBe(DATA.CONTACT.story);
    expect(DESTINATIONS_AT_8FE98F5[0].footer.endsWith(DATA.CONTACT.resortPhoneLabel)).toBe(true);
    expect(DESTINATIONS_AT_8FE98F5[1].footer.endsWith(DATA.CONTACT.diningHousePhoneLabel)).toBe(true);
  });

  it('matches the copy written into the components', () => {
    const hero = source('components/home/Hero.tsx');
    expect(hero).toContain(`srcSet="${HERO_SLIDES_AT_8FE98F5[0].mobile}"`);
    expect(hero).toContain(`alt="${HERO_SLIDES_AT_8FE98F5[0].alt}"`);
    expect(hero).toContain(`}, ${HERO_AUTOPLAY_MS_AT_8FE98F5});`);
    expect(source('components/site/SiteProvider.tsx')).toContain(`occasion: '${SETTINGS_AT_8FE98F5.defaultOccasion}'`);
    const taya = DETAIL_PAGES_AT_8FE98F5['taya-house'];
    const tayaHero = source('components/detail/TayaHero.tsx');
    expect(tayaHero.split(taya.kicker)).toHaveLength(3); // desktop and phone copies
    expect(tayaHero.split(taya.story)).toHaveLength(3);
    expect(tayaHero).toContain(`<img src="${taya.portrait}" alt="${taya.portraitAlt}"`);
    const footer = source('components/site/Footer.tsx');
    for (const d of DESTINATIONS_AT_8FE98F5) {
      if (d.footer) expect(footer).toContain(d.footer.slice(0, d.footer.lastIndexOf(' · ') + 2));
    }
    const menu = source('components/overlays/MenuOverlay.tsx');
    for (const n of NAV_AT_8FE98F5) expect(menu).toContain(`${n.target}: '${n.menu}'`);
    const experiences = source('components/home/Experiences.tsx');
    expect(experiences).toContain(`src="${SECTIONS_AT_8FE98F5.experiences.image}" alt="${SECTIONS_AT_8FE98F5.experiences.alt}"`);
    expect(source('components/home/Heritage.tsx')).toContain(`src="${SECTIONS_AT_8FE98F5.heritage.image}" alt=""`);
    expect(source('components/overlays/FilmModal.tsx')).toContain(`src="${SECTIONS_AT_8FE98F5.film.image}" alt=""`);
    // Cuisine, destination and story images are drawn with alt="".
    expect(source('components/home/Cuisines.tsx')).toContain('src={cuisineImage(slug)} alt=""');
    expect(source('components/home/Destinations.tsx')).toContain('src={`/assets/${card.slot}.jpg`} alt=""');
    expect(source('components/home/Stories.tsx')).toContain('src={`/assets/${img}.jpg`} alt=""');
    expect(source('components/home/RestaurantCard.tsx')).toContain('alt={restaurant.name}');
  });
});

describe.skipIf(!TEST_DATABASE_URL)('migration 008 seeds exactly the content of 8fe98f5 (database)', () => {
  beforeAll(() => {
    resetDatabase(url);
    pool = new Pool({ connectionString: url, max: 2 });
  });
  afterAll(() => pool.end());

  /** What a guest's <img alt> says for each file: "" when decorative or without English alt text. */
  async function alts(): Promise<Map<string, string>> {
    const list = await rows<{ pathname: string; is_decorative: boolean; alt: string | null }>(
      `SELECT m.pathname, m.is_decorative, mi.alt
         FROM media m LEFT JOIN media_i18n mi ON mi.media_id = m.id AND mi.locale = 'en'`,
    );
    return new Map(list.map((m) => [m.pathname, m.is_decorative ? '' : (m.alt ?? '')]));
  }

  it('cuisines: slug, label, order and image, drawn as decoration', async () => {
    const list = await rows<{ id: string; label: string; image: string }>(
      `SELECT c.id, ci.label, m.pathname AS image
         FROM cuisines c
         JOIN cuisine_i18n ci ON ci.cuisine_id = c.id AND ci.locale = 'en'
         JOIN media m ON m.id = c.image_id
        WHERE c.is_published
        ORDER BY c.sort_order, c.id`,
    );
    expect(list.map((c) => [c.label, c.id])).toEqual(CUISINES_AT_8FE98F5);
    expect(list.map((c) => c.image)).toEqual(CUISINES_AT_8FE98F5.map(([, slug]) => `/assets/cuisine-${slug}.jpg`));
    const alt = await alts();
    expect(list.map((c) => alt.get(c.image))).toEqual(list.map(() => ''));
  });

  it('destinations: card lines, picture, name, and the footer line from name, address and phone', async () => {
    const list = await rows<{
      id: string; name: string | null; t1: string; t2: string; b1: string; b2: string; image: string;
      address: string | null; phone_display: string | null; phone_e164: string | null; show_in_footer: boolean;
    }>(
      `SELECT d.id, di.name, di.card_title_1 AS t1, di.card_title_2 AS t2, di.card_blurb_1 AS b1, di.card_blurb_2 AS b2,
              m.pathname AS image, di.address, d.phone_display, d.phone_e164, d.show_in_footer
         FROM destinations d
         JOIN destination_i18n di ON di.destination_id = d.id AND di.locale = 'en'
         JOIN media m ON m.id = d.card_image_id
        WHERE d.is_published
        ORDER BY d.sort_order, d.id`,
    );
    expect(
      list.map((d) => ({
        id: d.id,
        name: d.name,
        title: [d.t1, d.t2],
        blurb: [d.b1, d.b2],
        image: d.image,
        footer: d.show_in_footer ? `${d.name} · ${d.address} · ${d.phone_display}` : null,
      })),
    ).toEqual(DESTINATIONS_AT_8FE98F5);
    expect((await alts()).get('/assets/dest-resort.jpg')).toBe('');
    // The footer's tel: link becomes E.164 (CONTACT.diningHousePhone was the national 0859555759).
    expect(list.find((d) => d.id === 'dining-house')?.phone_e164).toBe(`+84${DATA.CONTACT.diningHousePhone.slice(1)}`);
  });

  it('restaurants: slug, destination, type label, cuisines and card image, from their phase-1 columns', async () => {
    const list = await rows<{
      id: string; name: string; type: string; destination: string; cuisines: string[];
      slug: string; destination_id: string; type_label: string; cuisine_ids: string[]; card: string;
      is_published: boolean; archived_at: Date | null; phone_e164: string | null; map_url: string | null;
    }>(
      `SELECT r.id, r.name, r.type, r.destination, r.cuisines, r.slug, r.destination_id, ri.type_label,
              ARRAY(SELECT rc.cuisine_id FROM restaurant_cuisines rc WHERE rc.restaurant_id = r.id ORDER BY rc.sort_order) AS cuisine_ids,
              m.pathname AS card, r.is_published, r.archived_at, r.phone_e164, r.map_url
         FROM restaurants r
         JOIN restaurant_i18n ri ON ri.restaurant_id = r.id AND ri.locale = 'en'
         JOIN media m ON m.id = r.card_image_id
        ORDER BY r.sort_order, r.id`,
    );
    expect(list).toHaveLength(12);
    const slugOf = new Map(CUISINES_AT_8FE98F5.map(([label, slug]) => [label, slug]));
    const alt = await alts();
    for (const r of list) {
      expect(r).toMatchObject({
        slug: r.id,
        destination_id: r.destination,
        type_label: r.type,
        cuisine_ids: r.cuisines.map((label) => slugOf.get(label)),
        card: `/assets/r-${r.id}.jpg`,
        is_published: true,
        archived_at: null,
        // Their own number and map are empty: CALL and MAP come from the destination, as contactFor did.
        phone_e164: null,
        map_url: null,
      });
      expect(alt.get(r.card)).toBe(r.name);
    }
  });

  it('the detail page: Tàya House only, with its copy, portrait, SEO, menu, highlights, CALL and MAP', async () => {
    const pages = await rows<{
      id: string; kicker: string; story: string; story_label: string | null; highlights_title: string | null;
      portrait: string; seo_title: string; seo_description: string; menu_pdf_url: string; menu_pdf_media_id: string | null;
      tel: string; map: string;
    }>(
      `SELECT r.id, ri.detail_kicker AS kicker, ri.story, ri.story_label, ri.highlights_title, m.pathname AS portrait,
              ri.seo_title, ri.seo_description, ri.menu_pdf_url, ri.menu_pdf_media_id,
              COALESCE(r.phone_e164, d.phone_e164) AS tel, COALESCE(r.map_url, d.map_url) AS map
         FROM restaurants r
         JOIN restaurant_i18n ri ON ri.restaurant_id = r.id AND ri.locale = 'en'
         JOIN destinations d ON d.id = r.destination_id
         JOIN media m ON m.id = r.detail_image_id
        WHERE r.has_detail_page
        ORDER BY r.sort_order`,
    );
    expect(pages.map((p) => p.id)).toEqual(Object.keys(DETAIL_PAGES_AT_8FE98F5));
    const taya = DETAIL_PAGES_AT_8FE98F5['taya-house'];
    expect(pages[0]).toEqual({
      id: 'taya-house',
      kicker: taya.kicker,
      story: taya.story,
      // NULL: the registry's "Brand Story" and "At {name}".
      story_label: null,
      highlights_title: null,
      portrait: taya.portrait,
      seo_title: taya.seo.title,
      seo_description: taya.seo.description,
      menu_pdf_url: taya.menuPdf,
      menu_pdf_media_id: null,
      tel: taya.call,
      map: taya.map,
    });
    const alt = await alts();
    expect(alt.get(taya.portrait)).toBe(taya.portraitAlt);
    const highlights = await rows<{ image: string; title: string; detail: string }>(
      `SELECT m.pathname AS image, hi.title, hi.detail
         FROM restaurant_highlights h
         JOIN restaurant_highlight_i18n hi ON hi.highlight_id = h.id AND hi.locale = 'en'
         JOIN media m ON m.id = h.image_id
        WHERE h.restaurant_id = 'taya-house' AND h.is_published
        ORDER BY h.sort_order, h.id`,
    );
    expect(highlights.map((h) => ({ ...h, alt: alt.get(h.image) }))).toEqual(
      taya.highlights.map(({ image, alt: a, title, detail }) => ({ image, title, detail, alt: a })),
    );
    // Another restaurant shows the reserve drawer, as before: none has highlights or page copy.
    expect(await rows(`SELECT 1 FROM restaurant_highlights WHERE restaurant_id <> 'taya-house'`)).toEqual([]);
    expect(
      await rows(
        `SELECT 1 FROM restaurant_i18n WHERE restaurant_id <> 'taya-house'
            AND num_nonnulls(detail_kicker, story, story_label, highlights_title, menu_pdf_url, menu_pdf_media_id, seo_title, seo_description) > 0`,
      ),
    ).toEqual([]);
  });

  it('hero slides with the phone crop and alt text, every section on, and their pictures and links', async () => {
    const slides = await rows<{ image: string; mobile: string | null }>(
      `SELECT m.pathname AS image, mm.pathname AS mobile
         FROM hero_slides s
         JOIN media m ON m.id = s.image_id
         LEFT JOIN media mm ON mm.id = s.image_mobile_id
        WHERE s.is_published
        ORDER BY s.sort_order, s.id`,
    );
    const alt = await alts();
    expect(slides.map((s) => ({ ...s, alt: alt.get(s.image) }))).toEqual(HERO_SLIDES_AT_8FE98F5);
    expect(alt.get('/assets/hero-hall-m.jpg')).toBe(HERO_SLIDES_AT_8FE98F5[0].alt);

    const sections = await rows<{ key: string; is_visible: boolean; image: string | null; link_url: string | null }>(
      `SELECT s.key, s.is_visible, m.pathname AS image, s.link_url FROM sections s LEFT JOIN media m ON m.id = s.image_id ORDER BY s.key`,
    );
    expect(sections.every((s) => s.is_visible)).toBe(true);
    const byKey = Object.fromEntries(sections.map((s) => [s.key, s]));
    expect(byKey.film).toMatchObject({ image: SECTIONS_AT_8FE98F5.film.image, link_url: SECTIONS_AT_8FE98F5.film.link });
    expect(byKey.experiences).toMatchObject({ image: SECTIONS_AT_8FE98F5.experiences.image, link_url: null });
    expect(alt.get(SECTIONS_AT_8FE98F5.experiences.image)).toBe(SECTIONS_AT_8FE98F5.experiences.alt);
    expect(byKey.heritage).toMatchObject({ image: SECTIONS_AT_8FE98F5.heritage.image, link_url: SECTIONS_AT_8FE98F5.heritage.link });
    expect(alt.get(SECTIONS_AT_8FE98F5.heritage.image)).toBe(SECTIONS_AT_8FE98F5.heritage.alt);
    expect(sections.filter((s) => !['film', 'experiences', 'heritage'].includes(s.key)).map((s) => [s.image, s.link_url])).toEqual(
      Array.from({ length: 8 }, () => [null, null]),
    );
  });

  it('experiences, and stories whose kicker is rebuilt from the category and the date', async () => {
    const experiences = await rows<{ title: string; blurb: string; link_url: string | null }>(
      `SELECT ei.title, ei.blurb, e.link_url
         FROM experiences e JOIN experience_i18n ei ON ei.experience_id = e.id AND ei.locale = 'en'
        WHERE e.is_published ORDER BY e.sort_order, e.id`,
    );
    expect(experiences.map(({ title, blurb }) => ({ title, blurb }))).toEqual(EXPERIENCES_AT_8FE98F5);
    expect(experiences.every((e) => e.link_url === null)).toBe(true); // still "#experiences"

    const stories = await rows<{ image: string; category: string; published_on: string | null; title: string; href: string }>(
      `SELECT m.pathname AS image, si.category, s.published_on::text AS published_on, si.title, COALESCE(si.href, s.href) AS href
         FROM stories s
         JOIN story_i18n si ON si.story_id = s.id AND si.locale = 'en'
         JOIN media m ON m.id = s.image_id
        WHERE s.is_published ORDER BY s.sort_order, s.id`,
    );
    expect(
      stories.map((s) => ({
        image: s.image,
        kicker: s.published_on ? `${s.category} · ${dayFirst(s.published_on)}` : s.category,
        title: s.title,
        href: s.href,
      })),
    ).toEqual(STORIES_AT_8FE98F5);
    const alt = await alts();
    expect(stories.map((s) => alt.get(s.image))).toEqual(['', '', '', '']);
  });

  it('offers: venue, title, the detail rebuilt from price and schedule, the restaurant, no expiry', async () => {
    const offers = await rows<{
      restaurant_id: string; venue: string; title: string; schedule: string; price_amount: string;
      currency: string; price_basis: string; valid_from: string | null; valid_until: string | null;
    }>(
      `SELECT o.restaurant_id, COALESCE(oi.venue_override, r.name) AS venue, oi.title, oi.schedule,
              o.price_amount, o.currency, o.price_basis, o.valid_from::text, o.valid_until::text
         FROM offers o
         JOIN offer_i18n oi ON oi.offer_id = o.id AND oi.locale = 'en'
         JOIN restaurants r ON r.id = o.restaurant_id
        WHERE o.is_published ORDER BY o.sort_order, o.id`,
    );
    expect(
      offers.map((o) => ({
        venue: o.venue,
        title: o.title,
        detail: `${price(o.price_amount, o.currency, o.price_basis)} · ${o.schedule}`,
        restaurant: o.restaurant_id,
        note: `Offer: ${o.title}`,
      })),
    ).toEqual(OFFERS_AT_8FE98F5);
    expect(offers.map((o) => [o.valid_from, o.valid_until])).toEqual([[null, null], [null, null], [null, null]]);
  });

  it('navigation, social links and the site settings', async () => {
    const nav = await rows<{ target_section: string; label: string }>(
      `SELECT n.target_section, ni.label FROM nav_items n JOIN nav_item_i18n ni ON ni.nav_item_id = n.id AND ni.locale = 'en'
        WHERE n.is_published ORDER BY n.sort_order, n.id`,
    );
    // One label: the menu shows it, the header shows it in capitals (CSS text-transform).
    expect(nav.map((n) => ({ target: n.target_section, header: n.label.toUpperCase(), menu: n.label }))).toEqual(NAV_AT_8FE98F5);

    const socials = await rows<{ platform: string; href: string; visible_locales: string[] | null }>(
      `SELECT platform, href, visible_locales FROM social_links WHERE is_published ORDER BY sort_order, id`,
    );
    expect(socials.map((s) => ({ platform: s.platform, label: s.platform.toUpperCase(), href: s.href }))).toEqual(SOCIALS_AT_8FE98F5);
    expect(socials.every((s) => s.visible_locales === null)).toBe(true);

    expect(await rows(`SELECT email, default_restaurant_id, default_occasion, og_image_id, hero_autoplay_ms FROM site_settings`)).toEqual([
      {
        email: SETTINGS_AT_8FE98F5.email,
        default_restaurant_id: SETTINGS_AT_8FE98F5.defaultRestaurantId,
        default_occasion: SETTINGS_AT_8FE98F5.defaultOccasion,
        og_image_id: null,
        hero_autoplay_ms: HERO_AUTOPLAY_MS_AT_8FE98F5,
      },
    ]);
  });

  it('seeds English only, reviewed, origin seed (spec §5.1 item 4)', async () => {
    const tables = [
      'media_i18n', 'destination_i18n', 'cuisine_i18n', 'restaurant_i18n', 'restaurant_highlight_i18n',
      'experience_i18n', 'story_i18n', 'offer_i18n', 'nav_item_i18n',
    ];
    for (const table of tables) {
      const [summary] = await rows<{ n: number; other: number }>(
        `SELECT count(*)::int AS n, count(*) FILTER (WHERE locale <> 'en' OR status <> 'reviewed' OR origin <> 'seed')::int AS other FROM ${table}`,
      );
      expect({ table, ...summary }).toMatchObject({ table, other: 0 });
      expect(summary.n).toBeGreaterThan(0);
    }
    // Section copy and UI text stay registry defaults: no content_strings row.
    expect(await rows(`SELECT key FROM content_strings`)).toEqual([]);
  });

  it('marks as decorative exactly the images drawn with alt="", so the phase-9 alt generator leaves them alone', async () => {
    const decorative = [
      ...CUISINES_AT_8FE98F5.map(([, slug]) => `/assets/cuisine-${slug}.jpg`),
      ...DESTINATIONS_AT_8FE98F5.map((d) => d.image),
      ...STORIES_AT_8FE98F5.map((s) => s.image),
      SECTIONS_AT_8FE98F5.heritage.image,
      ...HERO_SLIDES_AT_8FE98F5.filter((s) => s.alt === '').map((s) => s.image),
    ].sort();
    expect((await rows<{ pathname: string }>(`SELECT pathname FROM media WHERE is_decorative ORDER BY pathname`)).map((m) => m.pathname)).toEqual(
      decorative,
    );
    // Every other file has English alt text.
    expect(await rows(`SELECT pathname FROM media m WHERE NOT is_decorative AND NOT EXISTS (SELECT 1 FROM media_i18n mi WHERE mi.media_id = m.id AND mi.locale = 'en')`)).toEqual([]);
    expect(await rows(`SELECT pathname FROM media m WHERE is_decorative AND EXISTS (SELECT 1 FROM media_i18n mi WHERE mi.media_id = m.id)`)).toEqual([]);
  });

  it('has a row for every file in public/assets, measured from the file, and nothing else', async () => {
    const media = await rows<{
      storage: string; url: string; pathname: string; content_type: string; width: number; height: number; bytes: number;
      blur_data_url: string | null; deleted_at: Date | null;
    }>(`SELECT storage, url, pathname, content_type, width, height, bytes, blur_data_url, deleted_at FROM media ORDER BY pathname`);
    const files = readdirSync(ASSETS).filter((f) => !f.startsWith('.')).sort();
    expect(media.map((m) => m.pathname)).toEqual(files.map((f) => `/assets/${f}`));
    for (const m of media) {
      const bytes = new Uint8Array(readFileSync(join(process.cwd(), 'public', m.pathname)));
      const size = imageSize(bytes);
      expect({ path: m.pathname, storage: m.storage, url: m.url, type: m.content_type, w: m.width, h: m.height, bytes: m.bytes }).toEqual({
        path: m.pathname, storage: 'static', url: m.pathname, type: size?.contentType, w: size?.width, h: size?.height, bytes: bytes.length,
      });
      expect(jpegIsRotated(bytes)).toBe(false);
      // No blur placeholder: drawing one would change the pages (phase 7 decides).
      expect(m.blur_data_url).toBeNull();
      expect(m.deleted_at).toBeNull();
    }
  });
});
```

- [ ] **Bước 8: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/migration-008.test.ts test/integration/content-seed.test.ts`
Expected: FAIL `Test Files  2 failed (2)`, `Tests  31 failed | 2 passed (33)` (hai test xanh là khối 1, không cần DB):

```
       × seeds every table and leaves the bookings as they were, without an offer 10ms
       × does not bring back a seeded row an editor deleted: a list is seeded only while it is empty 2ms
       × stops, changing nothing, when a booking already carries an offer_id 325ms
       × stops with the label when restaurants.cuisines holds one no cuisine has 268ms
       × offers: a restaurant that still has an offer cannot be deleted (ON DELETE RESTRICT) 6ms
     × cuisines: slug, label, order and image, drawn as decoration 16ms
     × has a row for every file in public/assets, measured from the file, and nothing else 2ms
AssertionError: expected [Function] to throw an error
Error: ENOENT: no such file or directory, open 'db/migrations/008_content.sql'
AssertionError: expected [Function] to throw error matching /media_static_path/ but got 'relation "media" does not exist'
AssertionError: expected [Function] to throw error matching /restaurants_detail_image/ but got 'column "has_detail_page" of relation …'
```

- [ ] **Bước 9: Viết migration 008**

Seed nằm trong cùng transaction với lược đồ: Neon không bao giờ thấy bảng nội dung có mà rỗng (section trống). Những gì DB đã có (`type`, `name`, `cuisines`, `destination` của 002) được chép bằng `INSERT … SELECT`, nên giá trị thật trên Neon đi theo kể cả khi đã lệch khỏi 002. Khối `VALUES` của `media` là output của Bước 4. So với spike schema: mọi danh sách `WHERE NOT EXISTS (SELECT 1 FROM <bảng>)`, mọi bản dịch nối hàng cha (C3), `offers.restaurant_id … ON DELETE RESTRICT` (C7, R6).

Create `db/migrations/008_content.sql`:

```sql
-- Phase 6: guest content moves into the database (spec §5.1, §5.2 "Nội dung
-- (đợt 6)" and "File", §6.4, §14.1 row 6).
--
-- Expand only, one transaction, safe to re-run. New: media (+ media_i18n),
-- destination_i18n, cuisines (+ cuisine_i18n), restaurant_i18n,
-- restaurant_cuisines, restaurant_highlights (+ i18n), sections, hero_slides,
-- experiences (+ i18n), stories (+ i18n), offers (+ offer_i18n), nav_items
-- (+ nav_item_i18n), social_links. Extended: restaurants, destinations
-- (card_image_id gets its FK), site_settings (ADD COLUMN IF NOT EXISTS, never
-- CREATE: phase 5 created it), reservations (offer_id gets its FK).
--
-- The seed is exactly what the guest site shows at 8fe98f5: lib/data.ts, the
-- copy written into the components, and what 002/004 already put in the
-- database (copied with INSERT … SELECT, so Neon's own values carry over).
-- test/integration/content-seed.test.ts compares every row with a frozen copy
-- of that content and re-measures every file in public/assets. Section copy and
-- UI text are NOT seeded: they are registry keys (lib/i18n/registry.ts), whose
-- defaults apply while content_strings has no row (spec §8).
--
-- Seeds: every INSERT is ON CONFLICT DO NOTHING (spec §5.1 item 7), so a re-run
-- never overwrites an edit. List tables take fixed ids (OVERRIDING SYSTEM VALUE)
-- so their *_i18n rows can name them; the identity sequences are moved past
-- them at the end. A list is seeded only while it is empty, and a translation
-- only for a parent row that exists: fixed ids alone would bring back, on a
-- manual re-run, a seeded row an editor deleted. Seeded translations are status
-- 'reviewed', origin 'seed'.
-- Translatable text is never blank (CHECK btrim(x) <> ''): NULL means "fall back
-- to the default language" (spec §5.1 item 5), so blank must not mean "shown".
-- Text CHECKs are generous backstops; the design limits (spec §6.5) are the
-- admin's (phase 7), except nav_item_i18n.label ≤ 18, which the spec puts here.

-- ── Guards ────────────────────────────────────────────────────────────────
-- Nothing has written reservations.offer_id yet (phase 4 created it for this
-- phase). Offers 1–3 are seeded below, so a stray value would silently point at
-- one of them: stop instead.
DO $$
DECLARE n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE table_name = 'reservations' AND constraint_name = 'reservations_offer_id_fkey') THEN
    SELECT count(*) INTO n FROM reservations WHERE offer_id IS NOT NULL;
    IF n > 0 THEN
      RAISE EXCEPTION '% booking(s) already carry an offer_id before offers exist; set them to NULL, then migrate again', n;
    END IF;
  END IF;
END $$;

-- ── media → media_i18n ────────────────────────────────────────────────────
-- 'static': a file in public/, served at url = pathname (/assets/…). 'blob':
-- a Vercel Blob upload (phase 7). Images carry their pixel size (next/image
-- needs it); PDFs carry none. blur_data_url stays NULL for the static files:
-- the guest pages draw no blur placeholder today, and drawing one would change
-- them (spec §14.1 row 6 acceptance); phase 7 fills it on upload.
CREATE TABLE IF NOT EXISTS media (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  storage       text        NOT NULL CHECK (storage IN ('static', 'blob')),
  url           text        NOT NULL CHECK (length(url) <= 2000),
  pathname      text        NOT NULL CHECK (length(pathname) <= 500),
  content_type  text        NOT NULL
                CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif', 'application/pdf')),
  width         integer     CHECK (width BETWEEN 1 AND 20000),
  height        integer     CHECK (height BETWEEN 1 AND 20000),
  bytes         integer     NOT NULL CHECK (bytes BETWEEN 1 AND 15728640),  -- 15 MB upload cap (spec §11)
  blur_data_url text        CHECK (blur_data_url ~ '^data:image/(jpeg|png|webp);base64,' AND length(blur_data_url) <= 4000),
  -- alt="" wherever it is shown, and the phase-9 alt generator skips it.
  is_decorative boolean     NOT NULL DEFAULT false,
  -- Soft delete; media-sweep removes the file later. Content references keep RESTRICT either way.
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,
  -- registerMedia upserts by pathname (spec §11).
  CONSTRAINT media_pathname_key UNIQUE (pathname),
  CONSTRAINT media_static_path CHECK (
    storage <> 'static' OR (url = pathname AND pathname ~ '^/assets/[a-z0-9][a-z0-9._-]*\.(jpg|jpeg|png|webp|avif|pdf)$')
  ),
  CONSTRAINT media_blob_url CHECK (storage <> 'blob' OR url ~ '^https://'),
  CONSTRAINT media_dimensions CHECK (
    ((content_type = 'application/pdf') = (width IS NULL)) AND ((width IS NULL) = (height IS NULL))
  )
);

-- Alt text per language; a row exists only when there is alt text. Not for PDFs.
CREATE TABLE IF NOT EXISTS media_i18n (
  media_id    uuid        NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  locale      text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  alt         text        NOT NULL CHECK (btrim(alt) <> '' AND char_length(alt) <= 250),
  status      text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin      text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model    text,
  source_hash text,
  reviewed_by text,
  reviewed_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  PRIMARY KEY (media_id, locale)
);

-- Every file in public/assets, measured by `node scripts/measure-assets.mjs`
-- (the VALUES block is its output, verbatim). Decorative: the images the
-- components draw with alt="" today: cuisine chips (the label is beside them),
-- destination and story cards (their text is on or under them), the heritage
-- background, and hero slides 2 and 3.
INSERT INTO media (storage, url, pathname, content_type, width, height, bytes, is_decorative)
SELECT 'static', v.pathname, v.pathname, v.content_type, v.width, v.height, v.bytes,
       v.pathname ~ '^/assets/(cuisine|dest|story)-'
       OR v.pathname IN ('/assets/heritage.jpg', '/assets/hero-taya.jpg', '/assets/hero-indochine.jpg')
  FROM (VALUES
    ('/assets/chef.jpg', 'image/jpeg', 456, 378, 57833),
    ('/assets/cuisine-cafe-lounge.jpg', 'image/jpeg', 45, 45, 7915),
    ('/assets/cuisine-hotpot.jpg', 'image/jpeg', 45, 45, 8121),
    ('/assets/cuisine-international.jpg', 'image/jpeg', 45, 45, 8010),
    ('/assets/cuisine-italian.jpg', 'image/jpeg', 360, 360, 36591),
    ('/assets/cuisine-japanese.jpg', 'image/jpeg', 45, 45, 8019),
    ('/assets/cuisine-steak-grill.jpg', 'image/jpeg', 360, 360, 35685),
    ('/assets/cuisine-thai.jpg', 'image/jpeg', 360, 360, 36597),
    ('/assets/cuisine-vietnamese.jpg', 'image/jpeg', 360, 360, 33769),
    ('/assets/dest-dining-house.jpg', 'image/jpeg', 616, 960, 66715),
    ('/assets/dest-future.jpg', 'image/jpeg', 194, 302, 23552),
    ('/assets/dest-mm.jpg', 'image/jpeg', 194, 302, 30721),
    ('/assets/dest-resort.jpg', 'image/jpeg', 194, 302, 21681),
    ('/assets/heritage.jpg', 'image/jpeg', 908, 322, 76454),
    ('/assets/hero-beach.jpg', 'image/jpeg', 906, 515, 101208),
    ('/assets/hero-hall-m.jpg', 'image/jpeg', 245, 378, 28455),
    ('/assets/hero-indochine.jpg', 'image/jpeg', 125, 94, 13001),
    ('/assets/hero-taya.jpg', 'image/jpeg', 174, 264, 22416),
    ('/assets/r-cafe-indochine.jpg', 'image/jpeg', 960, 720, 163565),
    ('/assets/r-chaoshan-hotpot.jpg', 'image/jpeg', 125, 94, 12832),
    ('/assets/r-danaksara.jpg', 'image/jpeg', 125, 94, 12923),
    ('/assets/r-don-ciprianis.jpg', 'image/jpeg', 960, 720, 165717),
    ('/assets/r-hai-van-lounge.jpg', 'image/jpeg', 126, 94, 12757),
    ('/assets/r-hura-izakaya.jpg', 'image/jpeg', 960, 720, 134441),
    ('/assets/r-pho-cuon.jpg', 'image/jpeg', 960, 720, 120080),
    ('/assets/r-taya-house.jpg', 'image/jpeg', 960, 720, 178214),
    ('/assets/r-thai-siam-kitchen.jpg', 'image/jpeg', 960, 720, 161143),
    ('/assets/r-the-fan.jpg', 'image/jpeg', 960, 720, 162477),
    ('/assets/r-v-senses-cafe.jpg', 'image/jpeg', 960, 720, 154173),
    ('/assets/r-yum-food-village.jpg', 'image/jpeg', 126, 94, 12806),
    ('/assets/story-buffet-gala.jpg', 'image/jpeg', 816, 600, 153134),
    ('/assets/story-dh-opening.jpg', 'image/jpeg', 816, 600, 101681),
    ('/assets/story-thai-siam.jpg', 'image/jpeg', 816, 600, 121113),
    ('/assets/story-the-fan.jpg', 'image/jpeg', 816, 600, 61351),
    ('/assets/taya-class.jpg', 'image/jpeg', 960, 720, 170931),
    ('/assets/taya-garden.jpg', 'image/jpeg', 960, 720, 181719),
    ('/assets/taya-hero.jpg', 'image/jpeg', 174, 264, 22416),
    ('/assets/taya-lounge.jpg', 'image/jpeg', 960, 720, 152655),
    ('/assets/taya-stay.jpg', 'image/jpeg', 960, 720, 159098)
  ) AS v(pathname, content_type, width, height, bytes)
ON CONFLICT (pathname) DO NOTHING;

-- The alt text the components write today. hero-hall-m.jpg is slide 1's phone
-- crop (one <picture>, one alt). The film modal shows hero-beach.jpg as its
-- poster with alt="": that is the poster's role there, not the file's, so the
-- component keeps alt="" for it.
INSERT INTO media_i18n (media_id, locale, alt, origin)
SELECT m.id, 'en', v.alt, 'seed'
  FROM (VALUES
    ('/assets/chef.jpg',        'A Furama chef at work'),
    ('/assets/hero-beach.jpg',  'Dining at Furama Cuisine'),
    ('/assets/hero-hall-m.jpg', 'Dining at Furama Cuisine'),
    ('/assets/taya-hero.jpg',   'Tàya House'),
    ('/assets/taya-class.jpg',  'Cooking class photo'),
    ('/assets/taya-lounge.jpg', 'Tàya House interior'),
    ('/assets/taya-garden.jpg', 'Lagoon Garden'),
    ('/assets/taya-stay.jpg',   'Cooking class & stay')
  ) AS v(pathname, alt)
  JOIN media m ON m.pathname = v.pathname
ON CONFLICT DO NOTHING;

-- A restaurant card's alt is the restaurant's name (RestaurantCard.tsx).
INSERT INTO media_i18n (media_id, locale, alt, origin)
SELECT m.id, 'en', r.name, 'seed'
  FROM restaurants r
  JOIN media m ON m.pathname = '/assets/r-' || r.id || '.jpg'
ON CONFLICT DO NOTHING;

-- ── destinations (004) → destination_i18n ─────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'destinations_card_image_id_fkey') THEN
    ALTER TABLE destinations
      ADD CONSTRAINT destinations_card_image_id_fkey
      FOREIGN KEY (card_image_id) REFERENCES media (id) ON DELETE RESTRICT;
  END IF;
END $$;

UPDATE destinations d
   SET card_image_id = m.id
  FROM media m
 WHERE d.card_image_id IS NULL
   AND m.pathname = '/assets/dest-' || d.id || '.jpg';

-- name: dropdowns, the footer line, "More at {name}". card_*: the two-line
-- title and blurb of the home card. address: the footer line.
CREATE TABLE IF NOT EXISTS destination_i18n (
  destination_id text        NOT NULL REFERENCES destinations (id) ON UPDATE CASCADE ON DELETE CASCADE,
  locale         text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  name           text        CHECK (btrim(name) <> '' AND char_length(name) <= 80),
  card_title_1   text        CHECK (btrim(card_title_1) <> '' AND char_length(card_title_1) <= 40),
  card_title_2   text        CHECK (btrim(card_title_2) <> '' AND char_length(card_title_2) <= 40),
  card_blurb_1   text        CHECK (btrim(card_blurb_1) <> '' AND char_length(card_blurb_1) <= 60),
  card_blurb_2   text        CHECK (btrim(card_blurb_2) <> '' AND char_length(card_blurb_2) <= 60),
  address        text        CHECK (btrim(address) <> '' AND char_length(address) <= 200),
  status         text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin         text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model       text,
  source_hash    text,
  reviewed_by    text,
  reviewed_at    timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text,
  PRIMARY KEY (destination_id, locale)
);

-- DESTS, DESTINATION_CARDS (lib/data.ts) and the footer's addresses
-- (Footer.tsx). The teaser has no name today: its card is not a link and no
-- dropdown lists it.
INSERT INTO destination_i18n (destination_id, locale, name, card_title_1, card_title_2, card_blurb_1, card_blurb_2, address, origin)
SELECT v.destination_id, 'en', v.name, v.card_title_1, v.card_title_2, v.card_blurb_1, v.card_blurb_2, v.address, 'seed'
  FROM (VALUES
    ('resort',       'Furama Resort Danang',  'Furama',    'Resort Danang', 'Iconic beachfront dining', 'since 1997',     '103–105 Võ Nguyên Giáp, Ngũ Hành Sơn, Đà Nẵng'),
    ('dining-house', 'Furama Dining House',   'Furama',    'Dining House',  '4 floors · 4 flavours',    '1 night out',    '73 Trần Bạch Đằng, An Thượng'),
    ('mm',           'Furama MM Supercenter', 'Furama MM', 'Supercenter',   'Everyday dining',          'for everyone',   NULL),
    ('future',       NULL,                    'Future',    'Locations',     'Bringing great food',      'to more places', NULL)
  ) AS v(destination_id, name, card_title_1, card_title_2, card_blurb_1, card_blurb_2, address)
  JOIN destinations d ON d.id = v.destination_id
ON CONFLICT DO NOTHING;

-- ── cuisines → cuisine_i18n ───────────────────────────────────────────────
-- The id is the slug: the filter key (spec §6.3 item 2) and, today, the image name.
CREATE TABLE IF NOT EXISTS cuisines (
  id           text        PRIMARY KEY CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(id) <= 40),
  image_id     uuid        NOT NULL REFERENCES media (id) ON DELETE RESTRICT,
  sort_order   integer     NOT NULL DEFAULT 0,
  is_published boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text
);

CREATE TABLE IF NOT EXISTS cuisine_i18n (
  cuisine_id  text        NOT NULL REFERENCES cuisines (id) ON UPDATE CASCADE ON DELETE CASCADE,
  locale      text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  label       text        CHECK (btrim(label) <> '' AND char_length(label) <= 40),
  status      text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin      text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model    text,
  source_hash text,
  reviewed_by text,
  reviewed_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  PRIMARY KEY (cuisine_id, locale)
);

-- CUISINES (lib/data.ts), in its order: the rail, the dropdowns and the search chips.
INSERT INTO cuisines (id, image_id, sort_order)
SELECT v.id, m.id, v.sort_order
  FROM (VALUES ('vietnamese', 10), ('italian', 20), ('thai', 30), ('japanese', 40),
               ('steak-grill', 50), ('hotpot', 60), ('international', 70), ('cafe-lounge', 80))
       AS v(id, sort_order)
  JOIN media m ON m.pathname = '/assets/cuisine-' || v.id || '.jpg'
 WHERE NOT EXISTS (SELECT 1 FROM cuisines)
ON CONFLICT DO NOTHING;

INSERT INTO cuisine_i18n (cuisine_id, locale, label, origin)
SELECT v.cuisine_id, 'en', v.label, 'seed'
  FROM (VALUES ('vietnamese', 'Vietnamese'), ('italian', 'Italian'), ('thai', 'Thai'), ('japanese', 'Japanese'),
               ('steak-grill', 'Steak & Grill'), ('hotpot', 'Hotpot'), ('international', 'International'),
               ('cafe-lounge', 'Café & Lounge'))
       AS v(cuisine_id, label)
  JOIN cuisines c ON c.id = v.cuisine_id
ON CONFLICT DO NOTHING;

-- ── restaurants: the content columns ──────────────────────────────────────
-- name stays here, untranslated (spec §3). slug is the URL segment, the same
-- in every language. phone_*/map_url: NULL falls back to the destination's
-- (spec §6.4). archived_at: hidden for good while its bookings keep the row.
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS slug            text        CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 60),
  ADD COLUMN IF NOT EXISTS destination_id  text        REFERENCES destinations (id) ON UPDATE CASCADE,
  ADD COLUMN IF NOT EXISTS card_image_id   uuid        REFERENCES media (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS detail_image_id uuid        REFERENCES media (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS og_image_id     uuid        REFERENCES media (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS phone_e164      text        CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  ADD COLUMN IF NOT EXISTS phone_display   text        CHECK (btrim(phone_display) <> '' AND char_length(phone_display) <= 30),
  ADD COLUMN IF NOT EXISTS map_url         text        CHECK (map_url ~ '^https://' AND length(map_url) <= 2000),
  ADD COLUMN IF NOT EXISTS has_detail_page boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_published    boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS archived_at     timestamptz;

UPDATE restaurants SET slug = id WHERE slug IS NULL;
UPDATE restaurants SET destination_id = destination WHERE destination_id IS NULL;

UPDATE restaurants r
   SET card_image_id = m.id
  FROM media m
 WHERE r.card_image_id IS NULL
   AND m.pathname = '/assets/r-' || r.id || '.jpg';

-- DETAIL_PAGE_IDS: only Tàya House has a page today. Guarded on the image, so a
-- re-run never switches a page back on that an editor switched off.
UPDATE restaurants r
   SET detail_image_id = m.id, has_detail_page = true
  FROM media m
 WHERE r.id = 'taya-house'
   AND r.detail_image_id IS NULL
   AND m.pathname = '/assets/taya-hero.jpg';

ALTER TABLE restaurants
  ALTER COLUMN slug SET NOT NULL,
  ALTER COLUMN destination_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS restaurants_slug_key ON restaurants (slug);

ALTER TABLE restaurants DROP CONSTRAINT IF EXISTS restaurants_phone_pair;
ALTER TABLE restaurants ADD CONSTRAINT restaurants_phone_pair CHECK ((phone_e164 IS NULL) = (phone_display IS NULL));
-- A page draws its portrait (spec §6.4: the admin requires it when the page is on).
ALTER TABLE restaurants DROP CONSTRAINT IF EXISTS restaurants_detail_image;
ALTER TABLE restaurants ADD CONSTRAINT restaurants_detail_image CHECK (NOT has_detail_page OR detail_image_id IS NOT NULL);
-- A card a guest can see draws its picture.
ALTER TABLE restaurants DROP CONSTRAINT IF EXISTS restaurants_published_card;
ALTER TABLE restaurants ADD CONSTRAINT restaurants_published_card CHECK (NOT is_published OR card_image_id IS NOT NULL);

-- The phase-1 columns this phase replaces stay until phase 10 drops them
-- (spec §14.1 row 10). From here nothing reads them, and a restaurant added in
-- phase 7 need not fill the two that were NOT NULL (cuisines, meals and
-- slot_capacity have defaults already).
ALTER TABLE restaurants
  ALTER COLUMN type DROP NOT NULL,
  ALTER COLUMN destination DROP NOT NULL;
COMMENT ON COLUMN restaurants.type IS 'Phase 1, replaced by restaurant_i18n.type_label; dropped in phase 10.';
COMMENT ON COLUMN restaurants.destination IS 'Phase 1, replaced by destination_id; dropped in phase 10.';
COMMENT ON COLUMN restaurants.cuisines IS 'Phase 1, replaced by restaurant_cuisines; dropped in phase 10.';
COMMENT ON COLUMN restaurants.meals IS 'Phase 1, replaced by service_periods (006); dropped in phase 10.';
COMMENT ON COLUMN restaurants.slot_capacity IS 'Phase 1, replaced by service_periods.covers_per_slot (006); dropped in phase 10.';

-- ── restaurant_i18n ───────────────────────────────────────────────────────
-- story_label and highlights_title: NULL uses the registry's default ("Brand
-- Story", "At {name}"). The menu is one PDF per language: an uploaded file
-- (phase 7) or a link, never both.
CREATE TABLE IF NOT EXISTS restaurant_i18n (
  restaurant_id     text        NOT NULL REFERENCES restaurants (id) ON UPDATE CASCADE ON DELETE CASCADE,
  locale            text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  type_label        text        CHECK (btrim(type_label) <> '' AND char_length(type_label) <= 60),
  detail_kicker     text        CHECK (btrim(detail_kicker) <> '' AND char_length(detail_kicker) <= 100),
  story_label       text        CHECK (btrim(story_label) <> '' AND char_length(story_label) <= 40),
  story             text        CHECK (btrim(story) <> '' AND char_length(story) <= 1500),
  highlights_title  text        CHECK (btrim(highlights_title) <> '' AND char_length(highlights_title) <= 60),
  menu_pdf_media_id uuid        REFERENCES media (id) ON DELETE RESTRICT,
  menu_pdf_url      text        CHECK (menu_pdf_url ~ '^https://' AND length(menu_pdf_url) <= 2000),
  seo_title         text        CHECK (btrim(seo_title) <> '' AND char_length(seo_title) <= 120),
  seo_description   text        CHECK (btrim(seo_description) <> '' AND char_length(seo_description) <= 320),
  status            text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin            text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model          text,
  source_hash       text,
  reviewed_by       text,
  reviewed_at       timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text,
  PRIMARY KEY (restaurant_id, locale),
  CONSTRAINT restaurant_i18n_one_menu CHECK (menu_pdf_media_id IS NULL OR menu_pdf_url IS NULL)
);

-- Every restaurant's type label, copied from the column the cards read today.
INSERT INTO restaurant_i18n (restaurant_id, locale, type_label, origin)
SELECT r.id, 'en', r.type, 'seed'
  FROM restaurants r
 WHERE r.type IS NOT NULL
ON CONFLICT DO NOTHING;

-- Tàya House's page (TayaHero.tsx, DETAIL_SEO and CONTACT.tariffPdf in lib/data.ts).
-- Its type label row exists by now, so these columns are filled in place; the
-- IS NULL guard keeps a re-run off an edited page.
UPDATE restaurant_i18n
   SET detail_kicker   = 'A Wellness Dining Home · Furama Resort Danang',
       story           = 'Beneath the Lagoon Garden, the resort’s “Green Oasis in the Heart of the City” tells a journey from Mường Khụ, a land of stones, to Danang by the sea — with cooking classes led by Cơ Tu chef A Rất Thị Hép.',
       menu_pdf_url    = 'https://furamavietnam.com/wp-content/uploads/2026/03/Taya-CC-Tariff-A4-1-25.pdf',
       seo_title       = 'Tàya House — Furama Cuisine',
       seo_description = 'A wellness dining home beneath the Lagoon Garden at Furama Resort Danang, with Vietnamese cooking classes led by Cơ Tu chef A Rất Thị Hép.'
 WHERE restaurant_id = 'taya-house'
   AND locale = 'en'
   AND detail_kicker IS NULL AND story IS NULL AND menu_pdf_url IS NULL AND seo_title IS NULL AND seo_description IS NULL;

-- ── restaurant_cuisines ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS restaurant_cuisines (
  restaurant_id text    NOT NULL REFERENCES restaurants (id) ON UPDATE CASCADE ON DELETE CASCADE,
  -- A cuisine in use cannot be deleted; detach it from its restaurants first.
  cuisine_id    text    NOT NULL REFERENCES cuisines (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  sort_order    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (restaurant_id, cuisine_id)
);

CREATE INDEX IF NOT EXISTS restaurant_cuisines_cuisine_idx ON restaurant_cuisines (cuisine_id);

-- restaurants.cuisines holds English labels (002). A label with no cuisine
-- stops the migration with its name, as cuisineSlug() throws today, instead of
-- dropping out of every filter. Only restaurants still to be seeded count.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(DISTINCT c.label, ', ') INTO bad
    FROM restaurants r
    CROSS JOIN LATERAL unnest(r.cuisines) AS c(label)
   WHERE NOT EXISTS (SELECT 1 FROM restaurant_cuisines rc WHERE rc.restaurant_id = r.id)
     AND NOT EXISTS (SELECT 1 FROM cuisine_i18n ci WHERE ci.locale = 'en' AND ci.label = c.label);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'restaurants.cuisines holds label(s) with no cuisine: %; add them to migration 008''s cuisines, then migrate again', bad;
  END IF;
END $$;

-- In the array's order (Yum Food Village: International, Vietnamese, Thai).
INSERT INTO restaurant_cuisines (restaurant_id, cuisine_id, sort_order)
SELECT r.id, ci.cuisine_id, c.n * 10
  FROM restaurants r
  CROSS JOIN LATERAL unnest(r.cuisines) WITH ORDINALITY AS c(label, n)
  JOIN cuisine_i18n ci ON ci.locale = 'en' AND ci.label = c.label
 WHERE NOT EXISTS (SELECT 1 FROM restaurant_cuisines rc WHERE rc.restaurant_id = r.id)
ON CONFLICT DO NOTHING;

-- ── restaurant_highlights → restaurant_highlight_i18n ─────────────────────
-- The cards of a detail page (spec §6.4); 0 hides the section.
CREATE TABLE IF NOT EXISTS restaurant_highlights (
  id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurant_id text        NOT NULL REFERENCES restaurants (id) ON UPDATE CASCADE ON DELETE CASCADE,
  image_id      uuid        NOT NULL REFERENCES media (id) ON DELETE RESTRICT,
  sort_order    integer     NOT NULL DEFAULT 0,
  is_published  boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text
);

CREATE INDEX IF NOT EXISTS restaurant_highlights_restaurant_idx ON restaurant_highlights (restaurant_id, sort_order, id);

CREATE TABLE IF NOT EXISTS restaurant_highlight_i18n (
  highlight_id bigint      NOT NULL REFERENCES restaurant_highlights (id) ON DELETE CASCADE,
  locale       text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  title        text        CHECK (btrim(title) <> '' AND char_length(title) <= 80),
  detail       text        CHECK (btrim(detail) <> '' AND char_length(detail) <= 200),
  status       text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin       text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model     text,
  source_hash  text,
  reviewed_by  text,
  reviewed_at  timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text,
  PRIMARY KEY (highlight_id, locale)
);

-- TAYA_EXPERIENCES (lib/data.ts); their alt text went into media_i18n above.
INSERT INTO restaurant_highlights (id, restaurant_id, image_id, sort_order)
OVERRIDING SYSTEM VALUE
SELECT v.id, 'taya-house', m.id, v.sort_order
  FROM (VALUES (1, '/assets/taya-class.jpg', 10), (2, '/assets/taya-lounge.jpg', 20),
               (3, '/assets/taya-garden.jpg', 30), (4, '/assets/taya-stay.jpg', 40))
       AS v(id, pathname, sort_order)
  JOIN media m ON m.pathname = v.pathname
 WHERE NOT EXISTS (SELECT 1 FROM restaurant_highlights)
ON CONFLICT DO NOTHING;

INSERT INTO restaurant_highlight_i18n (highlight_id, locale, title, detail, origin)
SELECT v.highlight_id, 'en', v.title, v.detail, 'seed'
  FROM (VALUES
    (1, 'Vietnamese Cooking Class', 'Daily at 11:00 or 14:00 · VND 799,000++ per guest'),
    (2, 'Healthy Drinks & Snacks',  'Served in the garden house, daily 10:00–22:00'),
    (3, 'Private Gatherings',       'Outdoor celebrations and intimate events among the palms'),
    (4, 'Cooking Class & Stay',     'From USD 420 · 2 nights for 2 guests')
  ) AS v(highlight_id, title, detail)
  JOIN restaurant_highlights h ON h.id = v.highlight_id
ON CONFLICT DO NOTHING;

-- ── sections ──────────────────────────────────────────────────────────────
-- The home page's fixed blocks, in the design's order (no reordering: not a
-- page builder, spec §2). Their copy is registry keys; this row holds the
-- switch, the picture and the link. restaurants can never be hidden: the hero,
-- the cuisines, the finder and the tab bar all scroll to it (spec §6.5).
CREATE TABLE IF NOT EXISTS sections (
  key        text        PRIMARY KEY CHECK (key IN ('hero', 'film', 'finder', 'cuisines', 'restaurants', 'destinations',
                                                    'experiences', 'heritage', 'stories', 'offers', 'booking_bar')),
  is_visible boolean     NOT NULL DEFAULT true,
  image_id   uuid        REFERENCES media (id) ON DELETE RESTRICT,
  link_url   text        CHECK (link_url ~ '^https://' AND length(link_url) <= 2000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  CONSTRAINT sections_restaurants_visible CHECK (key <> 'restaurants' OR is_visible),
  -- The film plays a YouTube or Vimeo video; phase 7 parses the id.
  CONSTRAINT sections_film_video CHECK (
    key <> 'film' OR link_url ~ '^https://((www\.|m\.)?youtube\.com|youtu\.be|(player\.)?vimeo\.com)/'
  )
);

-- film: today's poster and no video yet ("THE FILM · COMING SOON").
-- heritage: CONTACT.story. experiences: its side picture.
INSERT INTO sections (key, image_id, link_url)
SELECT v.key, m.id, v.link_url
  FROM (VALUES ('hero', NULL, NULL),
               ('film', '/assets/hero-beach.jpg', NULL),
               ('finder', NULL, NULL),
               ('cuisines', NULL, NULL),
               ('restaurants', NULL, NULL),
               ('destinations', NULL, NULL),
               ('experiences', '/assets/chef.jpg', NULL),
               ('heritage', '/assets/heritage.jpg', 'https://furamavietnam.com/the-resort/'),
               ('stories', NULL, NULL),
               ('offers', NULL, NULL),
               ('booking_bar', NULL, NULL))
       AS v(key, pathname, link_url)
  LEFT JOIN media m ON m.pathname = v.pathname
ON CONFLICT DO NOTHING;

-- ── hero_slides ───────────────────────────────────────────────────────────
-- Alt text is the image's (media_i18n). image_mobile_id: the phone crop, used
-- by the first published slide only (phones show one slide).
CREATE TABLE IF NOT EXISTS hero_slides (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  image_id        uuid        NOT NULL REFERENCES media (id) ON DELETE RESTRICT,
  image_mobile_id uuid        REFERENCES media (id) ON DELETE RESTRICT,
  sort_order      integer     NOT NULL DEFAULT 0,
  is_published    boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text
);

-- HERO_SLIDES (lib/data.ts) and the phone crop of Hero.tsx.
INSERT INTO hero_slides (id, image_id, image_mobile_id, sort_order)
OVERRIDING SYSTEM VALUE
SELECT v.id, m.id, mm.id, v.sort_order
  FROM (VALUES (1, '/assets/hero-beach.jpg', '/assets/hero-hall-m.jpg', 10),
               (2, '/assets/hero-taya.jpg', NULL, 20),
               (3, '/assets/hero-indochine.jpg', NULL, 30))
       AS v(id, pathname, mobile_pathname, sort_order)
  JOIN media m ON m.pathname = v.pathname
  LEFT JOIN media mm ON mm.pathname = v.mobile_pathname
 WHERE NOT EXISTS (SELECT 1 FROM hero_slides)
ON CONFLICT DO NOTHING;

-- ── experiences → experience_i18n ─────────────────────────────────────────
-- link_url NULL: the row links nowhere, as today (#experiences); the owner has
-- yet to give the targets (spec §15 item 16).
CREATE TABLE IF NOT EXISTS experiences (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  link_url     text        CHECK (link_url ~ '^https://' AND length(link_url) <= 2000),
  sort_order   integer     NOT NULL DEFAULT 0,
  is_published boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text
);

CREATE TABLE IF NOT EXISTS experience_i18n (
  experience_id bigint      NOT NULL REFERENCES experiences (id) ON DELETE CASCADE,
  locale        text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  title         text        CHECK (btrim(title) <> '' AND char_length(title) <= 80),
  blurb         text        CHECK (btrim(blurb) <> '' AND char_length(blurb) <= 200),
  status        text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin        text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model      text,
  source_hash   text,
  reviewed_by   text,
  reviewed_at   timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,
  PRIMARY KEY (experience_id, locale)
);

-- EXPERIENCES (lib/data.ts).
INSERT INTO experiences (id, sort_order) OVERRIDING SYSTEM VALUE
SELECT v.id, v.sort_order
  FROM (VALUES (1, 10), (2, 20), (3, 30)) AS v(id, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM experiences)
ON CONFLICT DO NOTHING;

INSERT INTO experience_i18n (experience_id, locale, title, blurb, origin)
SELECT v.experience_id, 'en', v.title, v.blurb, 'seed'
  FROM (VALUES
    (1, 'Culinary Experiences',    'Tàya House cooking classes · Seafood & Steak Buffet · Champa dance nights'),
    (2, 'Private Dining & Events', 'Weddings · Corporate · Celebrations · MICE dining'),
    (3, 'Furama Fabulous',         'Membership · Rewards · Dining privileges')
  ) AS v(experience_id, title, blurb)
  JOIN experiences e ON e.id = v.experience_id
ON CONFLICT DO NOTHING;

-- ── stories → story_i18n ──────────────────────────────────────────────────
-- Links out to an article (spec §2). The card's kicker is the category, then
-- the date when there is one ("Restaurant News · 9 Sep 2026"), formatted for
-- the language. story_i18n.href: the article in that language, if any.
CREATE TABLE IF NOT EXISTS stories (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  image_id     uuid        NOT NULL REFERENCES media (id) ON DELETE RESTRICT,
  href         text        NOT NULL CHECK (href ~ '^https://' AND length(href) <= 2000),
  published_on date,
  sort_order   integer     NOT NULL DEFAULT 0,
  is_published boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text
);

CREATE TABLE IF NOT EXISTS story_i18n (
  story_id    bigint      NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  locale      text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  category    text        CHECK (btrim(category) <> '' AND char_length(category) <= 60),
  title       text        CHECK (btrim(title) <> '' AND char_length(title) <= 160),
  href        text        CHECK (href ~ '^https://' AND length(href) <= 2000),
  status      text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin      text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model    text,
  source_hash text,
  reviewed_by text,
  reviewed_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  PRIMARY KEY (story_id, locale)
);

-- STORIES (lib/data.ts), its dates taken out of the kicker; the fourth has none.
INSERT INTO stories (id, image_id, href, published_on, sort_order)
OVERRIDING SYSTEM VALUE
SELECT v.id, m.id, v.href, v.published_on::date, v.sort_order
  FROM (VALUES
    (1, '/assets/story-dh-opening.jpg',  'https://www.furamadining.com/diem-den/tin/furama-dining-house-grand-opening-mot-ngoi-nha-bon-huong-vi-giua-long-an-thuong', '2026-09-09', 10),
    (2, '/assets/story-the-fan.jpg',     'https://www.furamadining.com/diem-den/tin/steakhouse-the-fan-hanh-trinh-4-nha-hang-noi-am-thuc-va-nghe-thuat-gap-nhau', '2026-09-05', 20),
    (3, '/assets/story-thai-siam.jpg',   'https://www.furamadining.com/diem-den/tin/thai-siam-kitchen-tu-mot-can-bep-thai-den-nhip-cau-am-thuc-va-van-hoa-viet-nam-thai-lan', '2026-09-03', 30),
    (4, '/assets/story-buffet-gala.jpg', 'https://furamavietnam.com/a-premium-central-vietnam-seafood-steak-buffet-gala-a-culinary-masterpiece-at-furama-resort-danang/', NULL, 40)
  ) AS v(id, pathname, href, published_on, sort_order)
  JOIN media m ON m.pathname = v.pathname
 WHERE NOT EXISTS (SELECT 1 FROM stories)
ON CONFLICT DO NOTHING;

INSERT INTO story_i18n (story_id, locale, category, title, origin)
SELECT v.story_id, 'en', v.category, v.title, 'seed'
  FROM (VALUES
    (1, 'Restaurant News',      'Grand opening: one house, four flavours in An Thượng'),
    (2, 'Restaurant News',      'Steakhouse The Fan, where fine food meets art'),
    (3, 'Restaurant News',      'Thai Siam Kitchen, a bridge between Vietnam and Thailand'),
    (4, 'Furama Resort Danang', 'Inside the Central Vietnam Seafood & Steak Buffet Gala')
  ) AS v(story_id, category, title)
  JOIN stories s ON s.id = v.story_id
ON CONFLICT DO NOTHING;

-- ── offers → offer_i18n ───────────────────────────────────────────────────
-- bigint, to match reservations.offer_id (006). The card's detail line is
-- built from the price ("VND 888,000++ per guest") and the schedule, joined by
-- " · ". valid_from/valid_until are Da Nang calendar days; the reader caches
-- for hours and the daily cron expires content:offers (spec §6.2). The venue is
-- the restaurant's name unless venue_override says otherwise.
CREATE TABLE IF NOT EXISTS offers (
  id            bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- RESTRICT: offers have their own editor (phase 7), whose deletions land in
  -- audit_log one by one; deleting a restaurant must not take them silently.
  -- Restaurants are archived, not deleted, in the normal course.
  restaurant_id text          NOT NULL REFERENCES restaurants (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  price_amount  numeric(14,2) CHECK (price_amount >= 0),
  currency      text          NOT NULL DEFAULT 'VND' CHECK (currency ~ '^[A-Z]{3}$'),
  price_basis   text          CHECK (price_basis IN ('plus_plus', 'net')),
  valid_from    date,
  valid_until   date,
  sort_order    integer       NOT NULL DEFAULT 0,
  is_published  boolean       NOT NULL DEFAULT true,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  updated_by    text,
  CONSTRAINT offers_price_pair CHECK ((price_amount IS NULL) = (price_basis IS NULL)),
  CONSTRAINT offers_valid_range CHECK (valid_from <= valid_until)
);

CREATE INDEX IF NOT EXISTS offers_restaurant_idx ON offers (restaurant_id);

CREATE TABLE IF NOT EXISTS offer_i18n (
  offer_id       bigint      NOT NULL REFERENCES offers (id) ON DELETE CASCADE,
  locale         text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  title          text        CHECK (btrim(title) <> '' AND char_length(title) <= 80),
  schedule       text        CHECK (btrim(schedule) <> '' AND char_length(schedule) <= 120),
  venue_override text        CHECK (btrim(venue_override) <> '' AND char_length(venue_override) <= 80),
  status         text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin         text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model       text,
  source_hash    text,
  reviewed_by    text,
  reviewed_at    timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text,
  PRIMARY KEY (offer_id, locale)
);

-- OFFERS (lib/data.ts), the price taken out of the detail text. No validity
-- dates: none of the offers hides today (the section lede's "valid until 31
-- December 2026" is copy); the owner sets them in phase 7.
INSERT INTO offers (id, restaurant_id, price_amount, currency, price_basis, sort_order)
OVERRIDING SYSTEM VALUE
SELECT v.id, v.restaurant_id, v.price_amount, 'VND', v.price_basis, v.sort_order
  FROM (VALUES
    (1, 'cafe-indochine', 888000, 'plus_plus', 10),
    (2, 'taya-house',     799000, 'plus_plus', 20),
    (3, 'hai-van-lounge', 450000, 'net',       30)
  ) AS v(id, restaurant_id, price_amount, price_basis, sort_order)
  JOIN restaurants r ON r.id = v.restaurant_id
 WHERE NOT EXISTS (SELECT 1 FROM offers)
ON CONFLICT DO NOTHING;

INSERT INTO offer_i18n (offer_id, locale, title, schedule, origin)
SELECT v.offer_id, 'en', v.title, v.schedule, 'seed'
  FROM (VALUES
    (1, 'Seafood & Steak Buffet Dinner',  'Nightly 18:30–22:00'),
    (2, 'Vietnamese Cooking Class',       'Daily 11:00 or 14:00'),
    (3, 'Afternoon Tea & Dessert Buffet', '~30 pastries, 12+ teas')
  ) AS v(offer_id, title, schedule)
  JOIN offers o ON o.id = v.offer_id
ON CONFLICT DO NOTHING;

-- The booking keeps its date, time and party when an offer is deleted; it
-- loses only the link (spec §7.5 restores the offer under the same id).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservations_offer_id_fkey') THEN
    ALTER TABLE reservations
      ADD CONSTRAINT reservations_offer_id_fkey
      FOREIGN KEY (offer_id) REFERENCES offers (id) ON DELETE SET NULL;
  END IF;
END $$;

-- For the FK's ON DELETE and the admin's "bookings from this offer".
CREATE INDEX IF NOT EXISTS reservations_offer_idx ON reservations (offer_id) WHERE offer_id IS NOT NULL;

-- ── nav_items → nav_item_i18n ─────────────────────────────────────────────
-- One label per language, in natural case: the header uppercases it with CSS,
-- the menu overlay shows it as it is (spec §6.3 item 6). An item hides itself
-- when its section is hidden (spec §6.5). film and finder have no anchor.
CREATE TABLE IF NOT EXISTS nav_items (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  target_section text        NOT NULL REFERENCES sections (key) ON UPDATE CASCADE
                             CHECK (target_section NOT IN ('film', 'finder')),
  sort_order     integer     NOT NULL DEFAULT 0,
  is_published   boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text,
  CONSTRAINT nav_items_target_section_key UNIQUE (target_section)
);

CREATE TABLE IF NOT EXISTS nav_item_i18n (
  nav_item_id bigint      NOT NULL REFERENCES nav_items (id) ON DELETE CASCADE,
  locale      text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  -- 18: the one-line desktop header (spec §6.5); the admin warns past 14.
  label       text        NOT NULL CHECK (btrim(label) <> '' AND char_length(label) <= 18),
  status      text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin      text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model    text,
  source_hash text,
  reviewed_by text,
  reviewed_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  PRIMARY KEY (nav_item_id, locale)
);

-- NAV_LINKS (lib/data.ts) with the menu overlay's case (MENU_LABELS).
INSERT INTO nav_items (id, target_section, sort_order) OVERRIDING SYSTEM VALUE
SELECT v.id, v.target_section, v.sort_order
  FROM (VALUES (1, 'restaurants', 10), (2, 'destinations', 20), (3, 'experiences', 30),
               (4, 'offers', 40), (5, 'stories', 50), (6, 'heritage', 60))
       AS v(id, target_section, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM nav_items)
ON CONFLICT DO NOTHING;

INSERT INTO nav_item_i18n (nav_item_id, locale, label, origin)
SELECT v.nav_item_id, 'en', v.label, 'seed'
  FROM (VALUES (1, 'Restaurants'), (2, 'Destinations'), (3, 'Experiences'), (4, 'Offers'), (5, 'Stories'), (6, 'About'))
       AS v(nav_item_id, label)
  JOIN nav_items n ON n.id = v.nav_item_id
ON CONFLICT DO NOTHING;

-- ── social_links ──────────────────────────────────────────────────────────
-- The label is the platform's own name, written by the code (brand, not
-- translated). visible_locales NULL: every language (e.g. WeChat only for zh).
CREATE TABLE IF NOT EXISTS social_links (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform        text        NOT NULL
                  CHECK (platform IN ('facebook', 'instagram', 'youtube', 'tiktok', 'zalo', 'x', 'tripadvisor', 'wechat', 'kakao', 'line')),
  href            text        NOT NULL CHECK (href ~ '^https://' AND length(href) <= 2000),
  visible_locales text[]      CHECK (cardinality(visible_locales) >= 1 AND array_position(visible_locales, NULL) IS NULL),
  sort_order      integer     NOT NULL DEFAULT 0,
  is_published    boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text
);

-- SOCIALS (lib/data.ts). The TikTok handle awaits the owner (spec §15 item 14).
INSERT INTO social_links (id, platform, href, sort_order) OVERRIDING SYSTEM VALUE
SELECT v.id, v.platform, v.href, v.sort_order
  FROM (VALUES
    (1, 'facebook',  'https://www.facebook.com/furamaresort',            10),
    (2, 'instagram', 'https://www.instagram.com/furamaculinaryworld/',   20),
    (3, 'youtube',   'https://www.youtube.com/user/furamaresortvietnam', 30),
    (4, 'tiktok',    'https://www.tiktok.com/@furama.dining.hous',       40)
  ) AS v(id, platform, href, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM social_links)
ON CONFLICT DO NOTHING;

-- ── site_settings (007): the remaining columns ────────────────────────────
-- default_restaurant_id: the booking bar's first choice (NULL: the first
-- bookable restaurant). default_occasion: the finder's (NULL: any). The two
-- seeds ride on a DEFAULT that is dropped right after, as 006 did for
-- reservations.source: the existing row gets them, later rows do not, and a
-- re-run (the columns exist) changes nothing.
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS default_restaurant_id text    DEFAULT 'taya-house'
                                                         REFERENCES restaurants (id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_occasion      text    DEFAULT 'Dinner'
                                                         CHECK (default_occasion IN ('Breakfast', 'Lunch', 'Dinner', 'Drinks')),
  ADD COLUMN IF NOT EXISTS og_image_id           uuid    REFERENCES media (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS hero_autoplay_ms      integer NOT NULL DEFAULT 7000 CHECK (hero_autoplay_ms BETWEEN 3000 AND 20000);

ALTER TABLE site_settings
  ALTER COLUMN default_restaurant_id DROP DEFAULT,
  ALTER COLUMN default_occasion DROP DEFAULT;

-- ── identity sequences past the seeded ids ────────────────────────────────
-- Never moved back: a re-run after editors added rows keeps the sequence where it is.
SELECT setval('restaurant_highlights_id_seq', GREATEST((SELECT max(id) FROM restaurant_highlights), (SELECT last_value FROM restaurant_highlights_id_seq)));
SELECT setval('hero_slides_id_seq',           GREATEST((SELECT max(id) FROM hero_slides),           (SELECT last_value FROM hero_slides_id_seq)));
SELECT setval('experiences_id_seq',           GREATEST((SELECT max(id) FROM experiences),           (SELECT last_value FROM experiences_id_seq)));
SELECT setval('stories_id_seq',               GREATEST((SELECT max(id) FROM stories),               (SELECT last_value FROM stories_id_seq)));
SELECT setval('offers_id_seq',                GREATEST((SELECT max(id) FROM offers),                (SELECT last_value FROM offers_id_seq)));
SELECT setval('nav_items_id_seq',             GREATEST((SELECT max(id) FROM nav_items),             (SELECT last_value FROM nav_items_id_seq)));
SELECT setval('social_links_id_seq',          GREATEST((SELECT max(id) FROM social_links),          (SELECT last_value FROM social_links_id_seq)));
```

- [ ] **Bước 10: Chạy lại test, và so khối `VALUES` với bộ sinh**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/media/image-size.test.ts test/integration/migration-008.test.ts test/integration/content-seed.test.ts`
Expected: PASS `Test Files  3 passed (3)`, `Tests  37 passed (37)`

Run: `awk '/^  FROM \(VALUES$/{c++} c==1 && /\(.\/assets/{print}' db/migrations/008_content.sql | diff - "${TMPDIR:-/tmp}/media-values.sql" && echo SAME`
Expected: `SAME`

- [ ] **Bước 11: Kiểm rằng test bắt được C3 và C7**

Đột biến 1: trong seed của `offers`, xóa dòng ` WHERE NOT EXISTS (SELECT 1 FROM offers)` (ngay sau `JOIN restaurants r ON r.id = v.restaurant_id`), chạy `vitest run test/integration/migration-008.test.ts` (lệnh như Bước 10). Expected: `Tests  1 failed | 19 passed (20)`:

```
       × does not bring back a seeded row an editor deleted: a list is seeded only while it is empty 26ms
AssertionError: expected [ { id: 1 }, { id: 2 }, { id: 3 } ] to deeply equal [ { id: 1 }, { id: 2 } ]
```

Đột biến 2: trả file về, rồi đổi `REFERENCES restaurants (id) ON UPDATE CASCADE ON DELETE RESTRICT,` của `offers` thành `… ON DELETE CASCADE,`. Expected: `Tests  1 failed | 19 passed (20)`:

```
       × offers: a restaurant that still has an offer cannot be deleted (ON DELETE RESTRICT) 37ms
AssertionError: promise resolved "Result{ command: 'DELETE', …(9) }" instead of rejecting
```

Trả file về như Bước 9; `git diff` của file phải rỗng (file chưa track: so bằng `git diff --no-index` với một bản chép trước đột biến).

- [ ] **Bước 12: Viết và chạy thử các truy vấn kiểm cho Neon**

Hai file chỉ đọc, mỗi kiểm một hàng có cột `ok`; controller chạy chúng trên URL trực tiếp của branch đích trước và sau khi áp 008 (runbook ở Task 13). Ở đây chỉ chạy trên một DB cục bộ dựng tới 007.

Create `db/checks/preflight-008.sql`:

```sql
-- Read-only checks before applying 008_content.sql to a database at 007 (Neon).
-- Every row should say ok = true; a false row names what would stop or skew 008.
-- psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f db/checks/preflight-008.sql

SELECT 'migrations 001-007 applied, 008 not' AS check,
       (SELECT count(*) FROM _migrations WHERE name < '008') = 7
       AND NOT EXISTS (SELECT 1 FROM _migrations WHERE name >= '008') AS ok,
       (SELECT string_agg(name, ', ' ORDER BY name) FROM _migrations) AS detail
UNION ALL
SELECT 'no table 008 creates exists yet',
       NOT EXISTS (SELECT 1 FROM information_schema.tables
                    WHERE table_schema = current_schema()
                      AND table_name IN ('media', 'media_i18n', 'destination_i18n', 'cuisines', 'cuisine_i18n', 'restaurant_i18n',
                                         'restaurant_cuisines', 'restaurant_highlights', 'restaurant_highlight_i18n', 'sections',
                                         'hero_slides', 'experiences', 'experience_i18n', 'stories', 'story_i18n', 'offers',
                                         'offer_i18n', 'nav_items', 'nav_item_i18n', 'social_links')),
       NULL
UNION ALL
-- The guard in 008 stops on this.
SELECT 'no booking carries an offer_id',
       NOT EXISTS (SELECT 1 FROM reservations WHERE offer_id IS NOT NULL),
       (SELECT count(*)::text FROM reservations WHERE offer_id IS NOT NULL)
UNION ALL
-- The guard in 008 stops on this too.
SELECT 'every restaurants.cuisines label is one of the 8 cuisines',
       NOT EXISTS (SELECT 1 FROM restaurants r CROSS JOIN LATERAL unnest(r.cuisines) AS c(label)
                    WHERE c.label NOT IN ('Vietnamese', 'Italian', 'Thai', 'Japanese', 'Steak & Grill', 'Hotpot', 'International', 'Café & Lounge')),
       (SELECT string_agg(DISTINCT c.label, ', ') FROM restaurants r CROSS JOIN LATERAL unnest(r.cuisines) AS c(label))
UNION ALL
-- Each needs public/assets/r-<id>.jpg (restaurants_published_card would stop 008 otherwise).
SELECT 'the 12 restaurants of 002, each with a card picture in public/assets',
       (SELECT array_agg(id ORDER BY id) FROM restaurants) = ARRAY['cafe-indochine', 'chaoshan-hotpot', 'danaksara', 'don-ciprianis',
         'hai-van-lounge', 'hura-izakaya', 'pho-cuon', 'taya-house', 'thai-siam-kitchen', 'the-fan', 'v-senses-cafe', 'yum-food-village'],
       (SELECT string_agg(id, ', ' ORDER BY id) FROM restaurants)
UNION ALL
SELECT 'every restaurant has a type and a known destination',
       NOT EXISTS (SELECT 1 FROM restaurants r WHERE r.type IS NULL OR btrim(r.type) = ''
                      OR NOT EXISTS (SELECT 1 FROM destinations d WHERE d.id = r.destination)),
       NULL
UNION ALL
SELECT 'the four destinations of 004, without a card picture yet',
       (SELECT array_agg(id ORDER BY id) FROM destinations) = ARRAY['dining-house', 'future', 'mm', 'resort']
       AND NOT EXISTS (SELECT 1 FROM destinations WHERE card_image_id IS NOT NULL),
       (SELECT string_agg(id || ':' || coalesce(card_image_id::text, '-'), ', ' ORDER BY id) FROM destinations)
UNION ALL
SELECT 'site_settings has its one row (007)',
       (SELECT count(*) FROM site_settings) = 1,
       (SELECT email FROM site_settings)
UNION ALL
SELECT 'the en locale exists (every seeded translation is en)',
       EXISTS (SELECT 1 FROM locales WHERE code = 'en' AND is_default),
       NULL
UNION ALL
SELECT 'gen_random_uuid() is available (media.id)',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'gen_random_uuid'),
       NULL;
```

Create `db/checks/postcheck-008.sql`:

```sql
-- Read-only checks after applying 008_content.sql (Neon). Every row should say
-- ok = true. The same comparisons as test/integration/content-seed.test.ts,
-- restricted to what SQL alone can see (no files, no lib/data.ts).
-- psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f db/checks/postcheck-008.sql

SELECT 'row counts' AS check,
       (SELECT count(*) FROM media) = 39 AND (SELECT count(*) FROM media_i18n) = 20
       AND (SELECT count(*) FROM media WHERE is_decorative) = 19
       AND (SELECT count(*) FROM destination_i18n) = 4 AND (SELECT count(*) FROM cuisines) = 8
       AND (SELECT count(*) FROM restaurant_i18n) = 12 AND (SELECT count(*) FROM restaurant_cuisines) = 15
       AND (SELECT count(*) FROM restaurant_highlights) = 4 AND (SELECT count(*) FROM sections) = 11
       AND (SELECT count(*) FROM hero_slides) = 3 AND (SELECT count(*) FROM experiences) = 3
       AND (SELECT count(*) FROM stories) = 4 AND (SELECT count(*) FROM offers) = 3
       AND (SELECT count(*) FROM nav_items) = 6 AND (SELECT count(*) FROM social_links) = 4 AS ok
UNION ALL
SELECT 'restaurants: slug = id, destination_id = destination, card picture r-<id>.jpg',
       NOT EXISTS (SELECT 1 FROM restaurants r LEFT JOIN media m ON m.id = r.card_image_id
                    WHERE r.slug IS DISTINCT FROM r.id OR r.destination_id IS DISTINCT FROM r.destination
                       OR m.pathname IS DISTINCT FROM '/assets/r-' || r.id || '.jpg')
UNION ALL
SELECT 'restaurants: type_label (en) = type, and the card alt = name',
       NOT EXISTS (SELECT 1 FROM restaurants r
                     LEFT JOIN restaurant_i18n ri ON ri.restaurant_id = r.id AND ri.locale = 'en'
                     LEFT JOIN media_i18n mi ON mi.media_id = r.card_image_id AND mi.locale = 'en'
                    WHERE ri.type_label IS DISTINCT FROM r.type OR mi.alt IS DISTINCT FROM r.name)
UNION ALL
SELECT 'restaurants: restaurant_cuisines = cuisines, label for label, in order',
       NOT EXISTS (SELECT 1 FROM restaurants r
                    WHERE r.cuisines IS DISTINCT FROM ARRAY(SELECT ci.label FROM restaurant_cuisines rc
                                                              JOIN cuisine_i18n ci ON ci.cuisine_id = rc.cuisine_id AND ci.locale = 'en'
                                                             WHERE rc.restaurant_id = r.id ORDER BY rc.sort_order))
UNION ALL
SELECT 'only Tàya House has a page, with its portrait, story and 4 highlights',
       (SELECT array_agg(id) FROM restaurants WHERE has_detail_page) = ARRAY['taya-house']
       AND (SELECT m.pathname FROM restaurants r JOIN media m ON m.id = r.detail_image_id WHERE r.id = 'taya-house') = '/assets/taya-hero.jpg'
       AND (SELECT story IS NOT NULL AND seo_title = 'Tàya House — Furama Cuisine' FROM restaurant_i18n WHERE restaurant_id = 'taya-house' AND locale = 'en')
       AND (SELECT count(*) FROM restaurant_highlights WHERE restaurant_id = 'taya-house') = 4
UNION ALL
SELECT 'every destination has its card picture dest-<id>.jpg and an en row',
       NOT EXISTS (SELECT 1 FROM destinations d LEFT JOIN media m ON m.id = d.card_image_id
                    WHERE m.pathname IS DISTINCT FROM '/assets/dest-' || d.id || '.jpg'
                       OR NOT EXISTS (SELECT 1 FROM destination_i18n di WHERE di.destination_id = d.id AND di.locale = 'en'))
UNION ALL
SELECT 'reservations.offer_id has its FK, and no booking points at an offer',
       EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservations_offer_id_fkey')
       AND NOT EXISTS (SELECT 1 FROM reservations WHERE offer_id IS NOT NULL)
UNION ALL
SELECT 'site_settings: email kept, Tàya House and Dinner preselected, 7 s slides',
       (SELECT email IS NOT NULL AND default_restaurant_id = 'taya-house' AND default_occasion = 'Dinner'
               AND og_image_id IS NULL AND hero_autoplay_ms = 7000 FROM site_settings)
UNION ALL
SELECT 'every seeded translation is en, reviewed, seed',
       NOT EXISTS (SELECT 1 FROM (SELECT locale, status, origin FROM media_i18n UNION ALL SELECT locale, status, origin FROM destination_i18n
                     UNION ALL SELECT locale, status, origin FROM cuisine_i18n UNION ALL SELECT locale, status, origin FROM restaurant_i18n
                     UNION ALL SELECT locale, status, origin FROM restaurant_highlight_i18n UNION ALL SELECT locale, status, origin FROM experience_i18n
                     UNION ALL SELECT locale, status, origin FROM story_i18n UNION ALL SELECT locale, status, origin FROM offer_i18n
                     UNION ALL SELECT locale, status, origin FROM nav_item_i18n) t
                    WHERE locale <> 'en' OR status <> 'reviewed' OR origin <> 'seed')
UNION ALL
SELECT 'identity sequences are past the seeded ids',
       (SELECT last_value FROM offers_id_seq) >= 3 AND (SELECT last_value FROM stories_id_seq) >= 4
       AND (SELECT last_value FROM nav_items_id_seq) >= 6 AND (SELECT last_value FROM restaurant_highlights_id_seq) >= 4;
```

Run (DB `furama_cuisine_migrate008_test` thuộc test, lần chạy test sau dựng lại nó):

```bash
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_migrate008_test node scripts/reset-db.mjs --until 007_email_and_consent.sql
psql postgres://localhost:5432/furama_cuisine_migrate008_test -v ON_ERROR_STOP=1 -f db/checks/preflight-008.sql
DATABASE_URL_UNPOOLED=postgres://localhost:5432/furama_cuisine_migrate008_test node scripts/migrate.mjs
psql postgres://localhost:5432/furama_cuisine_migrate008_test -v ON_ERROR_STOP=1 -f db/checks/postcheck-008.sql
```

Expected: pre-flight 10 hàng, cột `ok` đều `t` (`migrations 001-007 applied, 008 not`, …, `every restaurants.cuisines label is one of the 8 cuisines` với chi tiết `Café & Lounge, Hotpot, International, Italian, Japanese, Steak & Grill, Thai, Vietnamese`, `the 12 restaurants of 002, each with a card picture in public/assets`, `site_settings has its one row (007)` với `fb@furamavietnam.com`); `migrate.mjs` in `✓ 008_content.sql` và `Applied 1 migration(s).`; post-check 10 hàng đều `t`:

```
 row counts                                                                    | t
 restaurants: slug = id, destination_id = destination, card picture r-<id>.jpg | t
 restaurants: type_label (en) = type, and the card alt = name                  | t
 restaurants: restaurant_cuisines = cuisines, label for label, in order        | t
 only Tàya House has a page, with its portrait, story and 4 highlights         | t
 every destination has its card picture dest-<id>.jpg and an en row            | t
 reservations.offer_id has its FK, and no booking points at an offer           | t
 site_settings: email kept, Tàya House and Dinner preselected, 7 s slides      | t
 every seeded translation is en, reviewed, seed                                | t
 identity sequences are past the seeded ids                                    | t
```

- [ ] **Bước 13: Chạy cổng kiểm tra**

Chạy đủ khối lệnh ở "Cổng kiểm tra của mọi task" (Global Constraints).

Expected:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo;
- `Test Files  71 passed (71)`, `Tests  943 passed (943)`;
- `reset-db` in `Applied 8 migration(s).`;
- build thoát 0; check-prerender in `Prerender check passed: /en, /en/restaurants/taya-house, /en/privacy (tags: restaurants, i18n:en, locales, content:ui; /en/privacy also content:legal).` cùng các dòng Admin, Uncached, Font, Inlined env;
- E2E `151 passed`, `1 skipped`; visual `8 passed`. (Code đợt 5 trên DB có 008: không gì đổi.)

- [ ] **Bước 14: Commit**

```bash
git add db/checks/postcheck-008.sql db/checks/preflight-008.sql db/migrations/008_content.sql lib/media/image-size.test.ts lib/media/image-size.ts scripts/measure-assets.mjs test/fixtures/phase5-content.ts test/integration/content-seed.test.ts test/integration/migration-008.test.ts
git commit -m "$(cat <<'EOF'
feat: add migration 008 for the content tables, seeded with the guest site of phase 5

Migration 008 creates every content table of spec §5.2 "Nội dung (đợt 6)"
and "File": media (pointing at /assets) with media_i18n, destination_i18n,
cuisines, restaurant_i18n, restaurant_cuisines, restaurant highlights,
sections, hero slides, experiences, stories, offers, nav items and social
links, each translatable table with the §5.1 item 3 columns. restaurants
gains its content columns (slug, destination_id, images, phone, map, page
switch, publish and archive) and loses NOT NULL on the phase-1 type and
destination; destinations.card_image_id and reservations.offer_id get their
FKs (offer_id ON DELETE SET NULL, offers.restaurant_id ON DELETE RESTRICT);
site_settings gains the default restaurant and occasion, the OG image and
the hero autoplay. One transaction, expand only, safe to re-run: a list is
seeded only while it is empty and a translation only for an existing
parent, so a manual re-run never brings back a row an editor deleted.

The seed is the content the site shows today. content-seed.test.ts compares
the database with a frozen copy of it (test/fixtures/phase5-content.ts) and
re-measures every file in public/assets with lib/media/image-size.ts, the
reader scripts/measure-assets.mjs uses to print the media rows. db/checks/
holds the read-only pre-flight and post-check SQL for Neon. No app code
reads the new tables yet: the phase-5 code runs unchanged on a 008 database.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Đặt bàn, email và admin rời các cột đợt 1

Từ 008, điểm đến của một nhà hàng là `restaurants.destination_id`; cột `destination` của đợt 1 còn đó tới đợt 10 nhưng không ai được đọc (R10, không trigger đồng bộ). Task này chuyển mọi bộ đọc của đặt bàn, email và admin, làm số điện thoại nhóm ưu tiên số riêng của nhà hàng, thêm `id` vào thứ tự (việc hoãn của đợt 4), và chặn đặt bàn online cho nhà hàng chưa đăng hoặc đã lưu trữ. Guard test cấm đọc cột cũ đến ở Task 3, khi bộ đọc cuối cùng (`db/queries.ts`) cũng đi.

**Files:**
- Modify: `lib/server/booking/rules.ts` (`groupPhoneSql`, `loadBookingRules`), `lib/server/booking/config.ts` (`RESTAURANT_COLUMNS`, `restaurantsInScope`), `lib/server/email/recipients.ts` (`restaurantsWithoutRecipient`, comment của `reachesSql`), `lib/server/email/outbox.ts` (`queueStaffNew`), `lib/server/email/drain.ts` (`recipientStillWanted`), `lib/server/email/booking/load.ts` (comment), `lib/booking/rules.ts` (comment của `GroupPhone`)
- Create: `test/integration/destination-id.test.ts`
- Test: `test/integration/booking-rules.test.ts`, `test/integration/submit-reservation.test.ts`

**Interfaces:**
- Consumes: các cột `restaurants.destination_id`, `phone_e164`, `phone_display`, `is_published`, `archived_at` của Task 1.
- Produces: `groupPhoneSql(alias)` (cùng chữ ký, `lib/server/booking/rules.ts`): số của nhà hàng, rồi của điểm đến theo `destination_id`, rồi điểm đến đầu tiên có số; NULL chỉ khi không có số nào. `loadBookingRules(db, ids, locale, from)` (cùng chữ ký): `rules.destinationId` = `destination_id`; `rules.bookingEnabled` = `booking_enabled AND is_published AND archived_at IS NULL`; thứ tự `sort_order, id`. `RestaurantBooking.destinationId` (`config.ts`) = `destination_id`.

- [ ] **Bước 1: Viết test của mọi bộ đọc theo `destination_id`**

Tàya House được dời sang Furama Dining House **chỉ** ở `destination_id` (cột đợt 1 vẫn ghi resort): ngày đóng cửa, số nhóm, phạm vi ngày đóng cửa, danh sách nhà hàng của admin, hàng đợi `staff.new`, lần kiểm lại người nhận của bộ gửi và danh sách "chưa có người nhận" đều phải theo nó.

Create `test/integration/destination-id.test.ts`:

```ts
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { listRestaurantBookings, restaurantsInScope } from '@/lib/server/booking/config';
import { createWebReservation } from '@/lib/server/booking/create';
import { parseReservationInput } from '@/lib/server/booking/input';
import { loadRestaurantRules } from '@/lib/server/booking/rules';
import { drainOutbox } from '@/lib/server/email/drain';
import { restaurantsWithoutRecipient } from '@/lib/server/email/recipients';
import { TEST_DATABASE_URL } from '../helpers/db';

/*
 * R10 (phase 6): a restaurant's destination is restaurants.destination_id
 * (migration 008). The phase-1 column restaurants.destination stays until
 * phase 10 drops it, but nothing reads it any more. Here Tàya House moves to
 * Furama Dining House in destination_id only (its phase-1 column still says
 * resort), and every reader that groups restaurants by destination follows:
 * the booking rules (closures, the group phone), the closure scope, the admin
 * restaurant list, the staff.new queue, the drain's re-check and the
 * overview's "no recipient" list.
 */

let pool: Pool;
// Friday 2 Oct 2026, 10:00 in Da Nang; the booking below is for Monday 5 Oct (the drain skips a passed sitting).
const NOW = new Date('2026-10-02T10:00:00+07:00');

const sql = (text: string, values: unknown[] = []) => pool.query(text, values);

describe.skipIf(!TEST_DATABASE_URL)('a restaurant’s destination is restaurants.destination_id (R10)', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
  });
  afterAll(async () => {
    await sql('TRUNCATE email_outbox, notification_recipients');
    await pool.end();
  });
  beforeEach(async () => {
    await sql('TRUNCATE reservations, reservation_events, closures, email_outbox, notification_recipients CASCADE');
    await sql('UPDATE restaurants SET booking_enabled = true, window_days = NULL, lead_minutes = NULL, max_party = NULL, auto_confirm = NULL');
    await sql('UPDATE booking_settings SET window_days = 14, lead_minutes = 30, same_day_cutoff = NULL, max_party = 12, auto_confirm = false');
    await sql(`UPDATE restaurants SET destination_id = 'dining-house' WHERE id = 'taya-house'`);
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await sql(`UPDATE restaurants SET destination_id = 'resort' WHERE id = 'taya-house'`);
  });

  it('the booking rules: the closures of that destination, and its phone for larger groups', async () => {
    await sql(`INSERT INTO closures (scope, destination_id, starts_on, ends_on) VALUES ('destination', 'dining-house', '2026-10-06', '2026-10-06')`);
    await sql(`INSERT INTO closures (scope, destination_id, starts_on, ends_on) VALUES ('destination', 'resort', '2026-10-07', '2026-10-07')`);
    const loaded = (await loadRestaurantRules(pool, 'taya-house', 'en', '2026-10-01'))!;
    expect(loaded.rules.destinationId).toBe('dining-house');
    expect(loaded.rules.closures.map((c) => [c.destinationId, c.startsOn])).toEqual([['dining-house', '2026-10-06']]);
    expect(loaded.groupPhone).toEqual({ display: '0859 555 759', tel: '+84859555759' });
  });

  it('the closure scope and the admin’s restaurant list', async () => {
    expect(await restaurantsInScope(pool, { scope: 'destination', destinationId: 'dining-house', restaurantId: null })).toContain('taya-house');
    expect(await restaurantsInScope(pool, { scope: 'destination', destinationId: 'resort', restaurantId: null })).not.toContain('taya-house');
    expect((await listRestaurantBookings(pool)).find((r) => r.id === 'taya-house')?.destinationId).toBe('dining-house');
  });

  it('staff.new: a recipient of that destination gets it, the drain still sends it, and the overview counts the restaurant reached', async () => {
    await sql(`INSERT INTO notification_recipients (scope, destination_id, email) VALUES ('destination', 'dining-house', 'dh@furama.test')`);
    const parsed = parseReservationInput({
      restaurant: 'taya-house', date: '2026-10-05', time: '19:00', guests: 2, name: 'Khách Web',
      phone: '0905 300 001', email: '', note: '', locale: 'en', consent: true,
    });
    if (!parsed.ok) throw new Error(parsed.code);
    expect((await createWebReservation(parsed.value, { now: NOW, pool })).ok).toBe(true);
    expect((await sql(`SELECT event, to_email, fallback FROM email_outbox`)).rows).toEqual([
      { event: 'staff.new', to_email: 'dh@furama.test', fallback: false },
    ]);
    expect(await drainOutbox({ pool, env: {}, now: NOW })).toMatchObject({ sent: 1, skipped: 0 });
    expect((await restaurantsWithoutRecipient(pool)).map((r) => r.id)).not.toContain('taya-house');
  });
});
```

- [ ] **Bước 2: Viết test số nhóm, thứ tự hòa và nhà hàng ẩn**

Sửa `test/integration/booking-rules.test.ts` (ba test mới; test thứ tự cập nhật từng hàng theo thứ tự id ngược, để `ORDER BY sort_order` một mình trả sai thứ tự):

```diff
diff --git a/test/integration/booking-rules.test.ts b/test/integration/booking-rules.test.ts
index 895c85f..7142c8e 100644
--- a/test/integration/booking-rules.test.ts
+++ b/test/integration/booking-rules.test.ts
@@ -107,6 +107,51 @@ describe.skipIf(!process.env.TEST_DATABASE_URL)('booking rule loaders (database)
     });
   });
 
+  it('prefers the restaurant’s own number, then its destination’s; none only when no number exists at all (phase-4 ledger T3)', async () => {
+    await sql(`UPDATE restaurants SET phone_e164 = '+842363847333', phone_display = '0236 3847 333' WHERE id = 'the-fan'`);
+    try {
+      const own = await loadBookingRules(getPool(), ['the-fan', 'pho-cuon'], 'en', '2026-10-01');
+      expect(own.get('the-fan')?.groupPhone).toEqual({ display: '0236 3847 333', tel: '+842363847333' });
+      expect(own.get('pho-cuon')?.groupPhone).toEqual({ display: '0859 555 759', tel: '+84859555759' });
+      await sql(`UPDATE restaurants SET phone_e164 = NULL, phone_display = NULL WHERE id = 'the-fan'`);
+      await sql(`UPDATE destinations SET phone_e164 = NULL, phone_display = NULL`);
+      // The drawer and the emails then say nothing about a number (no "call us on" with a blank).
+      expect((await loadRestaurantRules(getPool(), 'taya-house', 'en', '2026-10-01'))!.groupPhone).toBeNull();
+    } finally {
+      await sql(`UPDATE restaurants SET phone_e164 = NULL, phone_display = NULL WHERE id = 'the-fan'`);
+      await sql(`UPDATE destinations SET phone_e164 = '+842366519999', phone_display = '+84 236 651 9999' WHERE id = 'resort'`);
+      await sql(`UPDATE destinations SET phone_e164 = '+84859555759', phone_display = '0859 555 759' WHERE id = 'dining-house'`);
+    }
+  });
+
+  it('orders restaurants with the same sort_order by id (phase-4 ledger T3)', async () => {
+    const { rows } = await sql(`SELECT id, sort_order FROM restaurants WHERE id IN ('taya-house', 'danaksara', 'cafe-indochine')`);
+    // One by one, in reverse id order: each update moves its row to the end of the table, so an order
+    // on sort_order alone hands them back as taya-house, danaksara, cafe-indochine.
+    for (const id of ['taya-house', 'danaksara', 'cafe-indochine']) await sql(`UPDATE restaurants SET sort_order = 1 WHERE id = $1`, [id]);
+    try {
+      const loaded = await loadBookingRules(getPool(), ['taya-house', 'danaksara', 'cafe-indochine'], 'en', '2026-10-01');
+      expect([...loaded.keys()]).toEqual(['cafe-indochine', 'danaksara', 'taya-house']);
+    } finally {
+      for (const r of rows) await sql(`UPDATE restaurants SET sort_order = $2 WHERE id = $1`, [r.id, r.sort_order]);
+    }
+  });
+
+  it('an unpublished or archived restaurant does not book online, whatever its switch says (R10)', async () => {
+    try {
+      await sql(`UPDATE restaurants SET is_published = false WHERE id = 'the-fan'`);
+      await sql(`UPDATE restaurants SET archived_at = now() WHERE id = 'pho-cuon'`);
+      const loaded = await loadBookingRules(getPool(), ['the-fan', 'pho-cuon', 'taya-house'], 'en', '2026-10-01');
+      expect([...loaded].map(([id, l]) => [id, l.rules.bookingEnabled])).toEqual([
+        ['taya-house', true],
+        ['the-fan', false],
+        ['pho-cuon', false],
+      ]);
+    } finally {
+      await sql(`UPDATE restaurants SET is_published = true, archived_at = NULL WHERE id IN ('the-fan', 'pho-cuon')`);
+    }
+  });
+
   it('counts covers per date and time over the holding statuses only', async () => {
     await book('taya-house', '2026-10-05', '19:00', 2, 'requested', '+84905000001');
     await book('taya-house', '2026-10-05', '19:00', 3, 'confirmed', '+84905000002');
```

Sửa `test/integration/submit-reservation.test.ts`:

```diff
diff --git a/test/integration/submit-reservation.test.ts b/test/integration/submit-reservation.test.ts
index 71ce1d0..e4f85ff 100644
--- a/test/integration/submit-reservation.test.ts
+++ b/test/integration/submit-reservation.test.ts
@@ -178,6 +178,18 @@ describe.skipIf(!process.env.TEST_DATABASE_URL)('submitReservation v2 (database)
     expect(await submitReservation(request)).toEqual({ ok: false, code: 'restaurant_unavailable' });
   });
 
+  it('refuses a restaurant that is unpublished or archived, though its online booking is on (R10)', async () => {
+    try {
+      await sql(`UPDATE restaurants SET is_published = false WHERE id = 'taya-house'`);
+      expect(await submitReservation(request)).toEqual({ ok: false, code: 'restaurant_unavailable' });
+      await sql(`UPDATE restaurants SET is_published = true, archived_at = now() WHERE id = 'taya-house'`);
+      expect(await submitReservation(request)).toEqual({ ok: false, code: 'restaurant_unavailable' });
+      expect((await sql('SELECT count(*)::int AS n FROM reservations')).rows[0].n).toBe(0);
+    } finally {
+      await sql(`UPDATE restaurants SET is_published = true, archived_at = NULL WHERE id = 'taya-house'`);
+    }
+  });
+
   it('refuses a closed service and keeps the others open', async () => {
     await sql(
       `INSERT INTO closures (scope, destination_id, starts_on, ends_on, meals) VALUES ('destination', 'resort', '2026-10-02', '2026-10-02', '{Dinner}')`,
```

- [ ] **Bước 3: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/destination-id.test.ts test/integration/booking-rules.test.ts test/integration/submit-reservation.test.ts`
Expected: FAIL `Test Files  3 failed (3)`, `Tests  7 failed | 36 passed (43)`:

```
     × refuses a restaurant that is unpublished or archived, though its online booking is on (R10) 15ms
     × prefers the restaurant’s own number, then its destination’s; none only when no number exists at all (phase-4 ledger T3) 12ms
     × orders restaurants with the same sort_order by id (phase-4 ledger T3) 8ms
     × an unpublished or archived restaurant does not book online, whatever its switch says (R10) 5ms
     × the booking rules: the closures of that destination, and its phone for larger groups 60ms
     × the closure scope and the admin’s restaurant list 28ms
     × staff.new: a recipient of that destination gets it, the drain still sends it, and the overview counts the restaurant reached 42ms
AssertionError: expected { display: '0859 555 759', …(1) } to deeply equal { display: '0236 3847 333', …(1) }
AssertionError: expected [ 'danaksara', 'cafe-indochine', …(1) ] to deeply equal [ 'cafe-indochine', 'danaksara', …(1) ]
AssertionError: expected [ [ 'taya-house', true ], …(2) ] to deeply equal [ [ 'taya-house', true ], …(2) ]
AssertionError: expected 'resort' to be 'dining-house' // Object.is equality
AssertionError: expected [ 'the-fan', 'pho-cuon', …(2) ] to include 'taya-house'
AssertionError: expected [ { event: 'staff.new', …(2) } ] to deeply equal [ { event: 'staff.new', …(2) } ]
AssertionError: expected { ok: true, data: { …(3) } } to deeply equal { ok: false, …(1) }
```

- [ ] **Bước 4: Quy tắc đặt bàn theo `destination_id`, số của nhà hàng trước, nhà hàng ẩn không đặt online**

`restaurants_phone_pair` giữ hai dạng số đi cùng nhau, nên kiểm một dạng là đủ. `bookingEnabled` là "khách đặt online được": API availability và lần gửi của khách đọc nó qua `resolveDay`; đường của nhân viên dùng `planDay` nên không bị ảnh hưởng.

Sửa `lib/server/booking/rules.ts`:

```diff
diff --git a/lib/server/booking/rules.ts b/lib/server/booking/rules.ts
index be6b3c8..3078f1a 100644
--- a/lib/server/booking/rules.ts
+++ b/lib/server/booking/rules.ts
@@ -20,19 +20,26 @@ export type LoadedRules = { rules: BookingRules; groupPhone: GroupPhone | null }
 
 /**
  * SQL: the number guests call about the restaurant aliased `restaurant`: its
- * destination's, else the first destination that has one (phase-4 R11). The
- * booking emails print the same number (lib/server/email/booking/load.ts).
+ * own (restaurants.phone_*, migration 008), else its destination's, else the
+ * first destination that has one (phase-4 R11); the order of a restaurant
+ * page's CALL (spec §6.4), which stops before the last step. The booking
+ * emails print the same number (lib/server/email/booking/load.ts). NULL only
+ * when no number exists at all. restaurants_phone_pair keeps both forms
+ * together, so testing one of them is enough.
  */
-export const groupPhoneSql = (restaurant: string) => `(SELECT json_build_object('display', d.phone_display, 'tel', d.phone_e164)
-               FROM destinations d
-              WHERE d.phone_e164 IS NOT NULL
-              ORDER BY (d.id = ${restaurant}.destination) DESC, d.sort_order, d.id
-              LIMIT 1)`;
+export const groupPhoneSql = (restaurant: string) => `coalesce(
+              CASE WHEN ${restaurant}.phone_e164 IS NOT NULL
+                   THEN json_build_object('display', ${restaurant}.phone_display, 'tel', ${restaurant}.phone_e164) END,
+              (SELECT json_build_object('display', d.phone_display, 'tel', d.phone_e164)
+                 FROM destinations d
+                WHERE d.phone_e164 IS NOT NULL
+                ORDER BY (d.id = ${restaurant}.destination_id) DESC, d.sort_order, d.id
+                LIMIT 1))`;
 
 type RulesRow = {
   id: string;
   name: string;
-  destination: string;
+  destination_id: string;
   booking_enabled: boolean;
   window_days: number;
   lead_minutes: number;
@@ -50,10 +57,17 @@ type RulesRow = {
  * the guest's language when that language is on (a reviewed row, or a machine
  * row with serve_machine), else the default language's; NULL when the closure
  * hides its reason. Unknown ids are simply missing from the map.
+ *
+ * bookingEnabled is "guests may book it online": its switch, and it is
+ * published and not archived (migration 008), so the availability API and the
+ * guest's submit answer restaurant_unavailable for a hidden restaurant. Staff
+ * bookings go through planDay, which ignores it. The destination is
+ * destination_id; nothing reads the phase-1 restaurants.destination (R10).
  */
 export async function loadBookingRules(db: Db, restaurantIds: readonly string[], locale: string, from: IsoDate): Promise<Map<string, LoadedRules>> {
   const { rows } = await db.query<RulesRow>(
-    `SELECT r.id, r.name, r.destination, r.booking_enabled,
+    `SELECT r.id, r.name, r.destination_id,
+            r.booking_enabled AND r.is_published AND r.archived_at IS NULL AS booking_enabled,
             COALESCE(r.window_days, s.window_days)::int   AS window_days,
             COALESCE(r.lead_minutes, s.lead_minutes)::int AS lead_minutes,
             to_char(s.same_day_cutoff, 'HH24:MI')         AS same_day_cutoff,
@@ -86,12 +100,12 @@ export async function loadBookingRules(db: Db, restaurantIds: readonly string[],
                        ON d.closure_id = c.id AND d.locale = (SELECT code FROM locales WHERE is_default)
                WHERE c.ends_on >= $3::date
                  AND (c.scope = 'all'
-                      OR (c.scope = 'destination' AND c.destination_id = r.destination)
+                      OR (c.scope = 'destination' AND c.destination_id = r.destination_id)
                       OR (c.scope = 'restaurant' AND c.restaurant_id = r.id))), '[]') AS closures
        FROM restaurants r
       CROSS JOIN booking_settings s
       WHERE r.id = ANY ($1::text[])
-      ORDER BY r.sort_order`,
+      ORDER BY r.sort_order, r.id`,
     [restaurantIds, locale, from],
   );
   return new Map(
@@ -101,7 +115,7 @@ export async function loadBookingRules(db: Db, restaurantIds: readonly string[],
         rules: {
           restaurantId: r.id,
           restaurantName: r.name,
-          destinationId: r.destination,
+          destinationId: r.destination_id,
           bookingEnabled: r.booking_enabled,
           windowDays: r.window_days,
           leadMinutes: r.lead_minutes,
```

Sửa `lib/booking/rules.ts` (comment):

```diff
diff --git a/lib/booking/rules.ts b/lib/booking/rules.ts
index 95890e0..eb85517 100644
--- a/lib/booking/rules.ts
+++ b/lib/booking/rules.ts
@@ -68,7 +68,7 @@ export type BookingRules = {
   closures: ClosureRule[];
 };
 
-/** The number guests call for a larger group (spec §10.2): a destination's phone until phase 6 adds restaurants.phone_*. */
+/** The number guests call for a larger group (spec §10.2): the restaurant's own, else its destination's (lib/server/booking/rules.ts groupPhoneSql). */
 export type GroupPhone = { display: string; tel: string };
 
 /** Covers held per "HH:MM" on one date. */
```

- [ ] **Bước 5: Phạm vi ngày đóng cửa và danh sách nhà hàng của admin**

Sửa `lib/server/booking/config.ts`:

```diff
diff --git a/lib/server/booking/config.ts b/lib/server/booking/config.ts
index b5a9bba..d8f65a2 100644
--- a/lib/server/booking/config.ts
+++ b/lib/server/booking/config.ts
@@ -81,7 +81,7 @@ export type RestaurantBooking = {
   token: string;
 };
 
-const RESTAURANT_COLUMNS = `id, name, destination AS "destinationId", booking_enabled AS "bookingEnabled",
+const RESTAURANT_COLUMNS = `id, name, destination_id AS "destinationId", booking_enabled AS "bookingEnabled",
   window_days AS "windowDays", lead_minutes AS "leadMinutes", max_party AS "maxParty",
   auto_confirm AS "autoConfirm", ${US('updated_at')} AS token`;
 
@@ -386,7 +386,7 @@ export async function deleteClosure(
 export async function restaurantsInScope(db: Db, scope: ClosureScope): Promise<string[]> {
   const { rows } = await db.query<{ id: string }>(
     `SELECT id FROM restaurants
-      WHERE $1 = 'all' OR ($1 = 'destination' AND destination = $2) OR ($1 = 'restaurant' AND id = $3)
+      WHERE $1 = 'all' OR ($1 = 'destination' AND destination_id = $2) OR ($1 = 'restaurant' AND id = $3)
       ORDER BY sort_order, id`,
     [scope.scope, scope.destinationId, scope.restaurantId],
   );
```

- [ ] **Bước 6: Người nhận `staff.new` theo `destination_id`, ở hàng đợi, bộ gửi và Tổng quan**

Sửa `lib/server/email/recipients.ts`:

```diff
diff --git a/lib/server/email/recipients.ts b/lib/server/email/recipients.ts
index eb1fbb4..9c28490 100644
--- a/lib/server/email/recipients.ts
+++ b/lib/server/email/recipients.ts
@@ -20,7 +20,7 @@ type Duplicate = { ok: false; code: 'duplicate' };
 /**
  * SQL: notification_recipients row `n` reaches a booking at the restaurant
  * whose id and destination are the given SQL expressions: a row for that
- * restaurant, for its destination (restaurants.destination), or for 'all'
+ * restaurant, for its destination (restaurants.destination_id), or for 'all'
  * (spec §10.4, R4). The one definition: the queue (outbox.ts queueStaffNew)
  * and the overview's "Nhà hàng chưa có người nhận thông báo" both use it, so
  * they can never disagree about who hears about a booking. Callers add
@@ -36,7 +36,7 @@ export async function restaurantsWithoutRecipient(db: Db): Promise<{ id: string;
     `SELECT r.id, r.name FROM restaurants r
       WHERE r.booking_enabled
         AND NOT EXISTS (SELECT 1 FROM notification_recipients n
-                         WHERE n.active AND 'staff.new' = ANY (n.events) AND ${reachesSql('n', 'r.id', 'r.destination')})
+                         WHERE n.active AND 'staff.new' = ANY (n.events) AND ${reachesSql('n', 'r.id', 'r.destination_id')})
       ORDER BY r.sort_order, r.id`,
   );
   return rows;
```

Sửa `lib/server/email/outbox.ts`:

```diff
diff --git a/lib/server/email/outbox.ts b/lib/server/email/outbox.ts
index e53d302..926623f 100644
--- a/lib/server/email/outbox.ts
+++ b/lib/server/email/outbox.ts
@@ -53,14 +53,14 @@ export async function queueGuestEmail(
 export async function queueStaffNew(client: PoolClient, { reservationId, eventId, env }: Queue): Promise<string[]> {
   const { rows } = await client.query<{ id: string }>(
     `WITH booking AS (
-       SELECT r.id, r.restaurant_id, rest.destination
+       SELECT r.id, r.restaurant_id, rest.destination_id
          FROM reservations r JOIN restaurants rest ON rest.id = r.restaurant_id
         WHERE r.id = $2
      ),
      matched AS (
        SELECT DISTINCT ON (lower(n.email)) n.email, n.locale
          FROM notification_recipients n, booking b
-        WHERE n.active AND 'staff.new' = ANY (n.events) AND ${reachesSql('n', 'b.restaurant_id', 'b.destination')}
+        WHERE n.active AND 'staff.new' = ANY (n.events) AND ${reachesSql('n', 'b.restaurant_id', 'b.destination_id')}
         ORDER BY lower(n.email), CASE n.scope WHEN 'restaurant' THEN 0 WHEN 'destination' THEN 1 ELSE 2 END, n.id
      ),
      chosen AS (
```

Sửa `lib/server/email/drain.ts`:

```diff
diff --git a/lib/server/email/drain.ts b/lib/server/email/drain.ts
index 9e9d003..143c820 100644
--- a/lib/server/email/drain.ts
+++ b/lib/server/email/drain.ts
@@ -153,7 +153,7 @@ async function recipientStillWanted(pool: Pool, row: ClaimedRow): Promise<boolea
         `SELECT EXISTS (
            SELECT 1 FROM reservations r JOIN restaurants t ON t.id = r.restaurant_id, notification_recipients n
             WHERE r.id = $1 AND n.active AND 'staff.new' = ANY (n.events) AND lower(n.email) = lower($2)
-              AND ${reachesSql('n', 'r.restaurant_id', 't.destination')}
+              AND ${reachesSql('n', 'r.restaurant_id', 't.destination_id')}
          ) AS ok`,
         [row.reservation_id, row.to_email],
       );
```

Sửa `lib/server/email/booking/load.ts` (comment):

```diff
diff --git a/lib/server/email/booking/load.ts b/lib/server/email/booking/load.ts
index c7a0c0e..6c4d924 100644
--- a/lib/server/email/booking/load.ts
+++ b/lib/server/email/booking/load.ts
@@ -28,7 +28,7 @@ export type BookingEmailData = {
   email: string | null;
   /** The guest's own request from the form. */
   note: string | null;
-  /** The destination's number, which guests call (lib/server/booking/rules.ts groupPhoneSql). */
+  /** The restaurant's number, else its destination's, which guests call (lib/server/booking/rules.ts groupPhoneSql). */
   groupPhone: GroupPhone | null;
   /** Phase 10's anonymiser ran: nothing is sent about it any more. */
   anonymized: boolean;
```

- [ ] **Bước 7: Chạy lại test**

Run: lệnh của Bước 3.
Expected: PASS `Test Files  3 passed (3)`, `Tests  43 passed (43)`

Kiểm thêm: `grep -rnE "\.destination\b[^_A-Za-z]|[^._'a-zA-Z]destination (=|AS)" --include='*.ts' lib app | grep -v '\.test\.ts'` chỉ còn comment trong `lib/server/booking/rules.ts`; bộ đọc cuối cùng của cột cũ là `db/queries.ts` (Task 3 xóa nó).

- [ ] **Bước 8: Chạy cổng kiểm tra**

Expected:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo;
- `Test Files  72 passed (72)`, `Tests  950 passed (950)`;
- `Applied 8 migration(s).`; build thoát 0; check-prerender đạt (như Task 1);
- E2E `151 passed`, `1 skipped`; visual `8 passed`.

- [ ] **Bước 9: Commit**

```bash
git add lib/booking/rules.ts lib/server/booking/config.ts lib/server/booking/rules.ts lib/server/email/booking/load.ts lib/server/email/drain.ts lib/server/email/outbox.ts lib/server/email/recipients.ts test/integration/booking-rules.test.ts test/integration/destination-id.test.ts test/integration/submit-reservation.test.ts
git commit -m "$(cat <<'EOF'
fix: group restaurants by destination_id in booking, email and admin SQL, and never book a hidden restaurant online

Migration 008 made restaurants.destination_id the restaurant's destination
and left the phase-1 column for phase 10 to drop (R10). Every reader moves
to it: the booking rules (the closures of a destination, the group phone),
the closure scope and the admin's restaurant list, the staff.new queue, the
drain's re-check of a recipient, and the overview's restaurants without a
recipient. A restaurant moved to another destination is now closed, phoned
and notified as that destination's everywhere.

The group phone is the restaurant's own number first (restaurants.phone_*),
then its destination's, then the first destination that has one; NULL only
when there is no number at all (phase-4 deferral). The rule loader orders by
sort_order, then id. A restaurant that is unpublished or archived does not
book online whatever its switch says, so the availability API and the
guest's submit answer restaurant_unavailable; staff bookings are unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Lớp đọc, danh mục và một bộ đọc `site_settings` (chưa đổi gì trên trang)

Lớp đọc của đợt 6 (spec §6.1, §6.2): SQL không cache trong `*.queries.ts`, wrapper `'use cache'` gắn tag chỉ qua `lib/cache-plan.ts`. Danh mục (`getRestaurants`) chuyển sang các bảng của 008 và `db/queries.ts` đi; nội dung chrome có loader sẵn cho Task 4–5 dùng. Trang chưa đổi: layout vẫn chỉ nạp danh mục, và danh mục cho đúng các giá trị cũ.

**Files:**
- Create: `lib/server/content/sql.ts`, `lib/cache-plan.ts`, `lib/cache-plan.test.ts`, `lib/content/types.ts`, `lib/content/format.ts`, `lib/content/format.test.ts`, `lib/server/content/settings.queries.ts`, `lib/server/content/restaurants.queries.ts`, `lib/server/content/site.queries.ts`, `lib/server/content/site.ts`, `test/guards/legacy-columns.guard.test.ts`, `test/integration/content-loaders.test.ts`
- Modify: `lib/server/content/restaurants.ts`, `lib/server/content/{legal,locales,strings}.ts`, `lib/server/email/recipients.ts` (`getSharedInbox`), `lib/server/email/booking/render.ts` (`sharedInbox`), `lib/data.ts` (`Restaurant`, `DestKey`), `lib/booking/client.test.ts` (fixture), `scripts/check-prerender.mjs` (`TAGS`), `test/integration/catalogue.test.ts` (viết lại)
- Delete: `db/queries.ts`

**Interfaces:**
- Consumes: bảng của Task 1; `fold(x)` từ `lib/booking.ts`; `US(column)` từ `lib/server/booking/config.ts`; `toBcp47(code)` từ `lib/i18n/locales.ts`; `TAGS` từ `lib/cache-tags.ts`; `query<T>(text, values)`, `getPool()` từ `db/client.ts`.
- Produces:
  - `lib/server/content/sql.ts`: `LOCALE_CTE` (chuỗi CTE `lc(def, machine)` theo `$1`), `i18nJoin(table, alias, fk, parent)`, `tr(alias, column)`, `mediaJson(idExpr)` (JSON `{url, width, height, alt}` hay NULL), `VENUE_TODAY`.
  - `lib/content/types.ts`: `Media = {url, alt, width, height}`, `Phone = {tel, display}`, `SECTION_KEYS`, `SectionKey`, `Section = {visible, image, link}`, `Sections`, `Cuisine = {id, label, image}`, `Destination = {id, kind, name: string | null, cardTitle, cardBlurb, image, address, phone, map, showInFooter}`, `NavItem = {target, label}`, `SocialLink = {platform, href}`, `SiteSettings = {email, defaultRestaurantId, defaultOccasion, heroAutoplayMs}`, `SiteContent = {cuisines, destinations, nav, socials, sections, settings}` (Task 6, 7, 8 thêm kiểu của chúng).
  - `lib/content/format.ts`: `formatStoryDate(iso, locale)`, `storyKicker(category, publishedOn, locale)`, `OfferPrice = {amount, currency, basis}`, `formatPrice(price, locale)`, `offerDetail(price: string | null, schedule: string | null)`.
  - `lib/cache-plan.ts`: `CONTENT_TABLES`, `ContentTable`, `SAVE_TAGS`, `LOADERS` (ở task này: `locales`, `strings`, `legal`, `sections`, `settings`, `cuisines`, `destinations`, `nav`, `socials`, `restaurants`), `LoaderName`, `tagsForSave(tables, restaurantId?)`.
  - `lib/server/content/settings.queries.ts`: `SiteSettingsRow = {email, defaultRestaurantId, defaultOccasion, heroAutoplayMs, ogImageId, token}`, `loadSiteSettings(db = getPool()): Promise<SiteSettingsRow | null>`.
  - `lib/server/content/restaurants.queries.ts`: `loadRestaurants(locale): Promise<Restaurant[]>`; `restaurants.ts`: `getRestaurants(locale)`.
  - `lib/server/content/site.queries.ts`: `loadSections(locale): Promise<Sections>`, `loadCuisines`, `loadDestinations`, `loadNav`, `loadSocials`; `site.ts`: `getSections`, `getCuisines`, `getDestinations`, `getNav`, `getSocials`, `getSiteSettings(): Promise<SiteSettings>` (không locale, R17; ném lỗi khi thiếu hàng), `getSiteContent(locale): Promise<SiteContent>`.
  - `lib/data.ts`: `DestKey = string`; `Restaurant` thêm `image: Media | null`, `phone: Phone | null`, `search: string` (đã `fold()`).

- [ ] **Bước 1: Viết guard của các cột đợt 1**

Phân tích mọi file nguồn bằng `oxc-parser` (TypeScript 7 không có compiler API), lấy các chuỗi và template literal trông như SQL, rồi tìm cột đợt 1 được gọi qua bí danh mà chính câu đó đặt cho `restaurants`, qua tên bảng, hay qua bí danh nội suy (`${restaurant}.destination`); `destination` và `slot_capacity` bị bắt cả khi đứng trần, và `type`, `cuisines`, `meals` cũng vậy khi `restaurants` là bảng duy nhất của câu (`SELECT id, type FROM restaurants`, dạng dễ gặp ở danh sách admin của đợt 7). Test thứ hai kiểm chính bộ nhận dạng.

Create `test/guards/legacy-columns.guard.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';

/*
 * R10 (phase 6): migration 008 replaced five phase-1 columns of restaurants
 * (type → restaurant_i18n.type_label, destination → destination_id, cuisines →
 * restaurant_cuisines, meals and slot_capacity → service_periods). They stay
 * until phase 10 drops them, so the phase-5 code can still run on a 008
 * database, but no app SQL may read them: a restaurant added in phase 7 fills
 * only the new columns, and a reader of an old one would silently leave it out
 * of a destination's closures, recipients or the catalogue.
 *
 * The scan parses every source file (oxc-parser; TypeScript 7 has no compiler
 * API) and looks at its SQL: string and template literals that read like a
 * query. A column is flagged when it is qualified by an alias the same query
 * gives to restaurants (`FROM restaurants r` … `r.destination`), by the table
 * name itself, or by an interpolated alias (`${restaurant}.destination`, as a
 * shared fragment such as groupPhoneSql writes it); destination and
 * slot_capacity are flagged bare too (`SELECT … destination AS …`), since no
 * other table has a column of either name, and so are type, cuisines and
 * meals when restaurants is the query's only table (`SELECT id, type FROM
 * restaurants`): other tables have columns of those names, so a bare one in a
 * join cannot be placed and is left to the alias rule. Migrations, the Neon check SQL and
 * the tests (booking-seed.test.ts reads the phase-1 seed on purpose) are not
 * app code.
 */

const ROOT = join(__dirname, '..', '..');
const SCAN = ['app', 'components', 'lib', 'db', 'scripts'];
const LEGACY = ['type', 'destination', 'cuisines', 'meals', 'slot_capacity'];
const SQL = /\b(?:SELECT|INSERT INTO|UPDATE|DELETE FROM|WHERE|JOIN)\b|\bAS "\w+"/;

type Node = { type: string; [key: string]: unknown };

function files(path: string): string[] {
  const full = join(ROOT, path);
  let entries;
  try {
    entries = readdirSync(full, { withFileTypes: true });
  } catch {
    return /\.(?:ts|tsx|mjs)$/.test(path) && !/\.test\.ts$/.test(path) && !/\.d\.ts$/.test(path) ? [path] : [];
  }
  return entries.flatMap((e) => (e.name === 'node_modules' || e.name.startsWith('.') || path === 'db/migrations' ? [] : files(join(path, e.name))));
}

function walk(node: unknown, visit: (n: Node) => void): void {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (typeof node !== 'object' || node === null || typeof (node as Node).type !== 'string') return;
  visit(node as Node);
  for (const [key, value] of Object.entries(node)) if (key !== 'parent') walk(value, visit);
}

/** Every string and template literal of a file; an interpolation reads as `${}`. */
function literals(rel: string, source: string): string[] {
  const { program, errors } = parseSync(rel, source);
  if (errors.length) throw new Error(`${rel}: ${errors[0].message}`);
  const out: string[] = [];
  walk(program, (n) => {
    if (n.type === 'TemplateLiteral') {
      out.push((n.quasis as { value: { raw: string } }[]).map((q) => q.value.raw).join('${}'));
    } else if (n.type === 'Literal' && typeof n.value === 'string') {
      out.push(n.value);
    }
  });
  return out;
}

/** The phase-1 columns a piece of SQL reads, as they are written there. */
function legacyReads(sql: string): string[] {
  if (!SQL.test(sql)) return [];
  const aliases = new Set(['restaurants']);
  for (const m of sql.matchAll(/\b(?:FROM|JOIN|UPDATE)\s+restaurants\s+(?:AS\s+)?([a-z_]\w*)/gi)) {
    if (!/^(?:WHERE|ON|JOIN|LEFT|RIGHT|INNER|CROSS|SET|ORDER|GROUP|USING|LIMIT)$/i.test(m[1])) aliases.add(m[1]);
  }
  const cols = LEGACY.join('|');
  const qualified = new RegExp(`(?:\\b(${[...aliases].join('|')})|\\$\\{\\})\\.(${cols})\\b(?![\\w])`, 'g');
  const bare = /(?<![\w.'"$])(destination|slot_capacity)(?![\w'"])/g;
  const reads = [...[...sql.matchAll(qualified)].map((m) => m[0]), ...[...sql.matchAll(bare)].map((m) => m[0])];
  const tables = new Set([...sql.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_]\w*)/gi)].map((m) => m[1].toLowerCase()));
  if (tables.size === 1 && tables.has('restaurants')) {
    reads.push(...[...sql.matchAll(/(?<![\w.'"$])(type|cuisines|meals)(?![\w'"])/g)].map((m) => m[0]));
  }
  return reads;
}

describe('no app SQL reads the phase-1 columns of restaurants (R10)', () => {
  it('finds none in app, components, lib, db and scripts', () => {
    const found = SCAN.flatMap(files).flatMap((rel) =>
      literals(rel, readFileSync(join(ROOT, rel), 'utf8')).flatMap((sql) => legacyReads(sql).map((col) => `${rel}: ${col}`)),
    );
    expect(found).toEqual([]);
  });

  it('recognises the forms it is looking for, and leaves other tables alone', () => {
    expect(legacyReads(`SELECT r.id, r.type, r.destination FROM restaurants r`)).toEqual(['r.type', 'r.destination']);
    expect(legacyReads(`SELECT rest.cuisines FROM reservations r JOIN restaurants rest ON rest.id = r.restaurant_id`)).toEqual(['rest.cuisines']);
    expect(legacyReads(`SELECT id FROM restaurants WHERE restaurants.meals @> $1`)).toEqual(['restaurants.meals']);
    expect(legacyReads('(SELECT d.phone_e164 FROM destinations d ORDER BY (d.id = ${}.destination) DESC LIMIT 1)')).toEqual(['${}.destination']);
    expect(legacyReads(`id, name, destination AS "destinationId"`)).toEqual(['destination']);
    expect(legacyReads(`UPDATE restaurants SET slot_capacity = 4 WHERE id = $1`)).toEqual(['slot_capacity']);
    expect(legacyReads(`SELECT id, name, type, cuisines FROM restaurants WHERE id = $1`)).toEqual(['type', 'cuisines']);
    expect(legacyReads(`SELECT id FROM restaurants r WHERE meals @> $1`)).toEqual(['meals']);
    // New columns, other tables, scope literals and prose are not reads of the phase-1 columns.
    expect(legacyReads(`SELECT r.destination_id, c.meals, m.content_type FROM restaurants r JOIN closures c ON c.scope = 'destination'`)).toEqual([]);
    expect(legacyReads(`SELECT e.type FROM reservation_events e WHERE e.reservation_id = $1`)).toEqual([]);
    expect(legacyReads(`SELECT id, type FROM media WHERE id = $1`)).toEqual([]);
    expect(legacyReads(`SELECT r.id, type FROM restaurants r JOIN media m ON m.id = r.card_image_id`)).toEqual([]);
    expect(legacyReads(`SELECT id, name FROM restaurants WHERE content_type = 'type' ORDER BY sort_order`)).toEqual([]);
    expect(legacyReads('Any destination')).toEqual([]);
  });
});
```

- [ ] **Bước 2: Viết test của cache plan và của công thức định dạng**

Create `lib/cache-plan.test.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTENT_TABLES, LOADERS, SAVE_TAGS, tagsForSave, type ContentTable } from './cache-plan';
import { TAGS } from './cache-tags';

const ALL_TAGS = new Set<string>(Object.values(TAGS).flatMap((t) => (typeof t === 'string' ? [t] : [])));

describe('cache plan (spec §6.2)', () => {
  it('expires, on a save to any table a loader reads, at least one of that loader’s tags', () => {
    const gaps: string[] = [];
    for (const [name, loader] of Object.entries(LOADERS)) {
      for (const table of loader.reads as readonly ContentTable[]) {
        // A language switch reaches every loader through i18n:<locale>, which each one carries.
        if (table === 'locales' && name !== 'locales') continue;
        if (!SAVE_TAGS[table].some((tag) => (loader.tags as readonly string[]).includes(tag))) gaps.push(`${name} reads ${table}`);
      }
    }
    expect(gaps).toEqual([]);
  });

  it('names only tags from lib/cache-tags.ts', () => {
    const used = [...Object.values(SAVE_TAGS).flat(), ...Object.values(LOADERS).flatMap((l) => [...l.tags])];
    expect(used.filter((t) => !ALL_TAGS.has(t))).toEqual([]);
  });

  it('knows what a save to every content table expires', () => {
    for (const table of CONTENT_TABLES) expect(SAVE_TAGS[table].length).toBeGreaterThan(0);
  });

  it('adds restaurant:<id> for a restaurant’s own rows, once per tag', () => {
    expect(tagsForSave(['restaurants', 'restaurant_i18n'], 'taya-house')).toEqual(['restaurants', 'restaurant:taya-house']);
    expect(tagsForSave(['offers', 'offer_i18n'])).toEqual(['content:offers']);
  });

  it('is what the loaders tag: every cached loader calls cacheTag(...LOADERS.<its name>.tags)', () => {
    const dir = join(__dirname, 'server', 'content');
    const source = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.queries.ts') && !f.endsWith('.test.ts') && f !== 'sql.ts')
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n');
    const cached = source.split("'use cache';").length - 1;
    const tagged = [...source.matchAll(/cacheTag\(\.\.\.LOADERS\.(\w+)\.tags/g)].map((m) => m[1]);
    expect(tagged).toHaveLength(cached);
    expect(tagged.filter((n) => !(n in LOADERS))).toEqual([]);
    expect(Object.keys(LOADERS).filter((n) => !tagged.includes(n))).toEqual([]);
  });
});
```

`format.test.ts` chạy trên Node 24 ở CI: một ICU khác ở đó làm đỏ test này, không đợi tới visual (chỉ chạy cục bộ trên Node 22). Test cuối ghim việc một mã ngôn ngữ mà Intl từ chối (đoạn đầu của `/favicon.ico`, `/wp-login.php`) đọc như tiếng Anh thay vì ném `RangeError`.

Create `lib/content/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatPrice, formatStoryDate, offerDetail, storyKicker } from './format';

/*
 * The server-side recipes that keep the guest pages pixel-identical (spec
 * §14.1 row 6). CI runs this file on Node 24 (Vercel's runtime), the visual
 * baselines only run locally on Node 22: a different ICU there fails here.
 */

describe('story kicker', () => {
  it('writes English dates day first with a three-letter month, as the site did ("9 Sep 2026", not en-GB’s "Sept")', () => {
    expect(formatStoryDate('2026-09-09', 'en')).toBe('9 Sep 2026');
    expect(formatStoryDate('2026-12-31', 'en')).toBe('31 Dec 2026');
    expect(storyKicker('Restaurant News', '2026-09-05', 'en')).toBe('Restaurant News · 5 Sep 2026');
  });

  it('is the category alone for a story without a date', () => {
    expect(storyKicker('Furama Resort Danang', null, 'en')).toBe('Furama Resort Danang');
  });

  it('cannot move the date with the server’s zone (a calendar date, formatted in UTC)', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'Pacific/Kiritimati';
    try {
      expect(formatStoryDate('2026-09-03', 'en')).toBe('3 Sep 2026');
    } finally {
      process.env.TZ = tz;
    }
  });
});

describe('offer price and detail line', () => {
  it('reads as the three seeded offers did, with a plain space after the currency (no U+00A0)', () => {
    expect(offerDetail(formatPrice({ amount: '888000.00', currency: 'VND', basis: 'plus_plus' }, 'en'), 'Nightly 18:30–22:00')).toBe(
      'VND 888,000++ per guest · Nightly 18:30–22:00',
    );
    expect(offerDetail(formatPrice({ amount: 799000, currency: 'VND', basis: 'plus_plus' }, 'en'), 'Daily 11:00 or 14:00')).toBe(
      'VND 799,000++ per guest · Daily 11:00 or 14:00',
    );
    expect(offerDetail(formatPrice({ amount: '450000.00', currency: 'VND', basis: 'net' }, 'en'), '~30 pastries, 12+ teas')).toBe(
      'VND 450,000 net per guest · ~30 pastries, 12+ teas',
    );
    expect(formatPrice({ amount: '888000', currency: 'VND', basis: 'plus_plus' }, 'en')).not.toContain(' ');
  });

  it('keeps the cents of a price that has them', () => {
    expect(formatPrice({ amount: '42.50', currency: 'USD', basis: 'net' }, 'en')).toBe('USD 42.5 net per guest');
  });

  it('lets a price or a schedule stand alone', () => {
    expect(offerDetail(null, 'Every Friday')).toBe('Every Friday');
    expect(offerDetail(formatPrice({ amount: '120', currency: 'USD', basis: 'net' }, 'en'), null)).toBe('USD 120 net per guest');
    expect(offerDetail(null, null)).toBe('');
  });
});

describe('a language code Intl refuses', () => {
  it('reads as English instead of throwing: /favicon.ico reaches the loaders with "favicon.ico" as its language', () => {
    expect(() => new Intl.DateTimeFormat('favicon.ico')).toThrow(RangeError);
    expect(formatStoryDate('2026-09-09', 'favicon.ico')).toBe('9 Sep 2026');
    expect(storyKicker('Restaurant News', '2026-09-05', 'wp-login.php')).toBe('Restaurant News · 5 Sep 2026');
    expect(formatPrice({ amount: '888000.00', currency: 'VND', basis: 'plus_plus' }, 'apple-touch-icon.png')).toBe('VND 888,000++ per guest');
  });
});
```

- [ ] **Bước 3: Viết test của loader nội dung và của danh mục**

Giá trị mong đợi là bản đông cứng của Task 1; rồi các quy tắc: dự phòng theo từng trường, bản máy dịch sau `serve_machine`, alt dịch được (ảnh trang trí giữ rỗng), ngôn ngữ không có hàng nào là ngôn ngữ mặc định, hàng chưa đăng, mạng xã hội theo `visible_locales`, nav theo section.

Create `test/integration/content-loaders.test.ts`:

```ts
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import { loadSiteSettings } from '@/lib/server/content/settings.queries';
import { loadCuisines, loadDestinations, loadNav, loadSections, loadSocials } from '@/lib/server/content/site.queries';
import {
  CUISINES_AT_8FE98F5,
  DESTINATIONS_AT_8FE98F5,
  HERO_AUTOPLAY_MS_AT_8FE98F5,
  NAV_AT_8FE98F5,
  SECTIONS_AT_8FE98F5,
  SETTINGS_AT_8FE98F5,
  SOCIALS_AT_8FE98F5,
} from '../fixtures/phase5-content';

/*
 * The guest site's content loaders (lib/server/content/*.queries.ts) against
 * migration 008's seed. The expected values are the frozen content of phase 5
 * (test/fixtures/phase5-content.ts), so a loader that drifts from what the
 * site rendered fails here as well as in the visual baselines. Then the rules:
 * language fallback per field (spec §5.1 item 5), machine translations behind
 * serve_machine, unpublished rows, and nav items following their section.
 */

const sql = (text: string, values: unknown[] = []) => getPool().query(text, values);

describe.skipIf(!process.env.TEST_DATABASE_URL)('content loaders (database)', () => {
  afterEach(async () => {
    for (const table of ['cuisine_i18n', 'destination_i18n', 'media_i18n', 'nav_item_i18n']) await sql(`DELETE FROM ${table} WHERE locale <> 'en'`);
    await sql(`UPDATE locales SET serve_machine = false WHERE code = 'vi'`);
    await sql(`UPDATE sections SET is_visible = true`);
    await sql(`UPDATE cuisines SET is_published = true`);
    await sql(`UPDATE destinations SET is_published = true`);
    await sql(`UPDATE nav_items SET is_published = true`);
    await sql(`UPDATE social_links SET is_published = true, visible_locales = NULL`);
  });
  afterAll(() => getPool().end());

  describe('the seed is the content of phase 5', () => {
    it('cuisines: the rail in order, each with its picture and an empty alt (the label beside it says it)', async () => {
      const cuisines = await loadCuisines('en');
      expect(cuisines.map((c) => [c.label, c.id])).toEqual(CUISINES_AT_8FE98F5);
      for (const c of cuisines) expect(c.image).toMatchObject({ url: `/assets/cuisine-${c.id}.jpg`, alt: '' });
    });

    it('destinations: the four cards, the dropdown names and the footer lines', async () => {
      const ds = await loadDestinations('en');
      expect(ds.map((d) => [d.id, d.name, d.cardTitle, d.cardBlurb, d.image?.url, d.image?.alt])).toEqual(
        DESTINATIONS_AT_8FE98F5.map((d) => [d.id, d.name, d.title, d.blurb, d.image, '']),
      );
      expect(ds.map((d) => d.kind)).toEqual(['venue', 'venue', 'venue', 'teaser']);
      // Printed as the site printed it; the Dining House now dials in E.164 (R18; the owner confirms the number, spec §15 item 14).
      expect(ds.filter((d) => d.showInFooter).map((d) => `${d.name} · ${d.address} · ${d.phone?.display}`)).toEqual(
        DESTINATIONS_AT_8FE98F5.flatMap((d) => (d.footer ? [d.footer] : [])),
      );
      expect(ds.filter((d) => d.showInFooter).map((d) => d.phone?.tel)).toEqual(['+842366519999', '+84859555759']);
    });

    it('nav: the header’s targets with the menu’s labels, stored once in natural case', async () => {
      expect(await loadNav('en')).toEqual(NAV_AT_8FE98F5.map((n) => ({ target: n.target, label: n.menu })));
    });

    it('social links and the site settings', async () => {
      expect(await loadSocials('en')).toEqual(SOCIALS_AT_8FE98F5.map(({ platform, href }) => ({ platform, href })));
      expect(await loadSiteSettings()).toMatchObject({
        ...SETTINGS_AT_8FE98F5,
        heroAutoplayMs: HERO_AUTOPLAY_MS_AT_8FE98F5,
        ogImageId: null,
        token: expect.stringMatching(/^\d+$/),
      });
    });

    it('sections: every one on; the chef, the heritage picture and its link, the film poster', async () => {
      const s = await loadSections('en');
      expect(Object.values(s).every((x) => x.visible)).toBe(true);
      expect(s.experiences).toMatchObject({
        image: { url: SECTIONS_AT_8FE98F5.experiences.image, alt: SECTIONS_AT_8FE98F5.experiences.alt, width: 456, height: 378 },
        link: null,
      });
      expect(s.heritage).toMatchObject({ image: { url: SECTIONS_AT_8FE98F5.heritage.image, alt: '' }, link: SECTIONS_AT_8FE98F5.heritage.link });
      expect(s.film).toMatchObject({ image: { url: SECTIONS_AT_8FE98F5.film.image }, link: null });
      expect(s.hero).toEqual({ visible: true, image: null, link: null });
    });
  });

  describe('languages (spec §5.1 item 5)', () => {
    it('shows a reviewed translation, and the default language for each field it lacks', async () => {
      await sql(`INSERT INTO destination_i18n (destination_id, locale, name, status) VALUES ('mm', 'vi', 'Furama MM Siêu thị', 'reviewed')`);
      const mm = (await loadDestinations('vi')).find((d) => d.id === 'mm');
      expect(mm).toMatchObject({ name: 'Furama MM Siêu thị', cardTitle: ['Furama MM', 'Supercenter'], cardBlurb: ['Everyday dining', 'for everyone'] });
      expect((await loadDestinations('en')).find((d) => d.id === 'mm')?.name).toBe('Furama MM Supercenter');
    });

    it('hides a machine translation until the language serves them', async () => {
      await sql(`INSERT INTO cuisine_i18n (cuisine_id, locale, label, status, origin) VALUES ('thai', 'vi', 'Món Thái', 'machine', 'ai')`);
      expect((await loadCuisines('vi')).find((c) => c.id === 'thai')?.label).toBe('Thai');
      await sql(`UPDATE locales SET serve_machine = true WHERE code = 'vi'`);
      expect((await loadCuisines('vi')).find((c) => c.id === 'thai')?.label).toBe('Món Thái');
    });

    it('translates alt text, and keeps a decorative image’s empty', async () => {
      await sql(
        `INSERT INTO media_i18n (media_id, locale, alt)
         SELECT id, 'vi', 'Đầu bếp Furama' FROM media WHERE pathname = '/assets/chef.jpg'
         UNION ALL SELECT id, 'vi', 'Di sản' FROM media WHERE pathname = '/assets/heritage.jpg'`,
      );
      const s = await loadSections('vi');
      expect(s.experiences.image?.alt).toBe('Đầu bếp Furama');
      expect(s.heritage.image?.alt).toBe('');
    });

    it('a language with no rows at all is the default language throughout', async () => {
      expect(await loadNav('zz')).toEqual(await loadNav('en'));
      expect(await loadDestinations('zz')).toEqual(await loadDestinations('en'));
    });
  });

  describe('what the guest does not see', () => {
    it('an unpublished cuisine, destination, nav item or social link', async () => {
      await sql(`UPDATE cuisines SET is_published = false WHERE id = 'hotpot'`);
      await sql(`UPDATE destinations SET is_published = false WHERE id = 'future'`);
      await sql(`UPDATE nav_items SET is_published = false WHERE target_section = 'stories'`);
      await sql(`UPDATE social_links SET is_published = false WHERE platform = 'tiktok'`);
      expect((await loadCuisines('en')).map((c) => c.id)).not.toContain('hotpot');
      expect((await loadDestinations('en')).map((d) => d.id)).toEqual(['resort', 'dining-house', 'mm']);
      expect((await loadNav('en')).map((n) => n.target)).not.toContain('stories');
      expect((await loadSocials('en')).map((s) => s.platform)).toEqual(['facebook', 'instagram', 'youtube']);
    });

    it('a social link meant for other languages', async () => {
      await sql(`UPDATE social_links SET visible_locales = ARRAY['vi'] WHERE platform = 'youtube'`);
      expect((await loadSocials('en')).map((s) => s.platform)).not.toContain('youtube');
      expect((await loadSocials('vi')).map((s) => s.platform)).toContain('youtube');
    });

    it('a nav item whose section is switched off (spec §6.5)', async () => {
      await sql(`UPDATE sections SET is_visible = false WHERE key IN ('offers', 'stories')`);
      expect((await loadNav('en')).map((n) => n.target)).toEqual(['restaurants', 'destinations', 'experiences', 'heritage']);
      expect((await loadSections('en')).offers.visible).toBe(false);
    });
  });
});
```

Danh mục phải nói đúng điều các cột đợt 1 đã nói (chúng còn giữ seed). Thay toàn bộ `test/integration/catalogue.test.ts` bằng:

```ts
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import { fold } from '@/lib/booking';
import { loadRestaurants } from '@/lib/server/content/restaurants.queries';

/*
 * The guest catalogue (lib/server/content/restaurants.queries.ts), read from
 * migration 008's tables. Its type, destination and cuisines must equal what
 * the phase-1 columns said (they still hold the seed; phase 10 drops them),
 * which is what the site rendered before phase 6.
 */

const sql = (text: string, values: unknown[] = []) => getPool().query(text, values);
const list = (locale = 'en') => loadRestaurants(locale);

describe.skipIf(!process.env.TEST_DATABASE_URL)('restaurant catalogue (database)', () => {
  afterEach(async () => {
    await sql('UPDATE restaurants SET booking_enabled = true, is_published = true, archived_at = NULL, phone_e164 = NULL, phone_display = NULL');
    await sql(`UPDATE restaurants SET sort_order = 3 WHERE id = 'taya-house'`);
    await sql('UPDATE service_periods SET active = true');
    await sql(`DELETE FROM service_periods WHERE restaurant_id = 'hura-izakaya' AND meal = 'Breakfast'`);
    await sql(`DELETE FROM restaurant_i18n WHERE locale <> 'en'`);
    await sql(`DELETE FROM cuisine_i18n WHERE locale <> 'en'`);
    await sql(`UPDATE cuisines SET is_published = true`);
  });
  afterAll(() => getPool().end());

  it('serves the 12 seeded restaurants in design order', async () => {
    const restaurants = await list();
    expect(restaurants).toHaveLength(12);
    expect(restaurants[0].id).toBe('cafe-indochine');
    expect(restaurants.find((r) => r.id === 'taya-house')).toMatchObject({ meals: ['Lunch', 'Dinner'], bookingEnabled: true });
  });

  it('says what the phase-1 columns said: type, destination and cuisines, in their order', async () => {
    const { rows } = await sql(
      `SELECT r.id, r.type, r.destination,
              ARRAY(SELECT ci.cuisine_id FROM unnest(r.cuisines) WITH ORDINALITY AS c(label, n)
                      JOIN cuisine_i18n ci ON ci.locale = 'en' AND ci.label = c.label ORDER BY c.n) AS cuisines
         FROM restaurants r ORDER BY r.sort_order, r.id`,
    );
    expect((await list()).map((r) => ({ id: r.id, type: r.type, destination: r.dest, cuisines: r.cuisines }))).toEqual(rows);
    const byId = Object.fromEntries((await list()).map((r) => [r.id, r.cuisines]));
    expect(byId['yum-food-village']).toEqual(['international', 'vietnamese', 'thai']);
  });

  it('gives each card its picture, with the restaurant’s name as alt (R19)', async () => {
    const restaurants = await list();
    for (const r of restaurants) expect(r.image).toMatchObject({ url: `/assets/r-${r.id}.jpg`, alt: r.name });
    expect(restaurants.find((r) => r.id === 'taya-house')?.image).toMatchObject({ width: 960, height: 720 });
  });

  it('reads slug and has_detail_page from the table: only Tàya House has a page', async () => {
    const restaurants = await list();
    expect(restaurants.every((r) => r.slug === r.id)).toBe(true);
    expect(restaurants.filter((r) => r.hasDetailPage).map((r) => r.id)).toEqual(['taya-house']);
  });

  it('carries the booking switch', async () => {
    await sql(`UPDATE restaurants SET booking_enabled = false WHERE id = 'hai-van-lounge'`);
    const off = (await list()).filter((r) => !r.bookingEnabled).map((r) => r.id);
    expect(off).toEqual(['hai-van-lounge']);
  });

  it('gives the restaurant’s own number, else its destination’s; none at the MM Supercenter', async () => {
    await sql(`UPDATE restaurants SET phone_e164 = '+842363847333', phone_display = '0236 3847 333' WHERE id = 'the-fan'`);
    const phones = Object.fromEntries((await list()).map((r) => [r.id, r.phone]));
    expect(phones['the-fan']).toEqual({ tel: '+842363847333', display: '0236 3847 333' });
    expect(phones['pho-cuon']).toEqual({ tel: '+84859555759', display: '0859 555 759' });
    expect(phones['taya-house']).toEqual({ tel: '+842366519999', display: '+84 236 651 9999' });
    expect(phones['yum-food-village']).toBeNull();
  });

  it('leaves out unpublished and archived restaurants', async () => {
    await sql(`UPDATE restaurants SET is_published = false WHERE id = 'danaksara'`);
    await sql(`UPDATE restaurants SET archived_at = now() WHERE id = 'pho-cuon'`);
    const ids = (await list()).map((r) => r.id);
    expect(ids).toHaveLength(10);
    expect(ids).not.toContain('danaksara');
    expect(ids).not.toContain('pho-cuon');
  });

  it('breaks a sort_order tie by id, so the order is total (phase-4 ledger T3)', async () => {
    // cafe-indochine is 1; give Tàya House the same: the ids decide, and every read agrees.
    await sql(`UPDATE restaurants SET sort_order = 1 WHERE id = 'taya-house'`);
    const ids = (await list()).map((r) => r.id);
    expect(ids.slice(0, 2)).toEqual(['cafe-indochine', 'taya-house']);
  });

  it('derives meals from the active service periods, in the canonical meal order (spec §6.3)', async () => {
    // Seeded periods reproduce restaurants.meals exactly.
    const { rows } = await sql('SELECT id, meals FROM restaurants ORDER BY sort_order, id');
    expect((await list()).map((r) => [r.id, r.meals])).toEqual(rows.map((r) => [r.id, r.meals]));
    await sql(`UPDATE service_periods SET active = false WHERE restaurant_id = 'taya-house' AND meal = 'Lunch'`);
    await sql(
      `INSERT INTO service_periods (restaurant_id, meal, first_seating, last_seating, covers_per_slot, sort_order)
       VALUES ('hura-izakaya', 'Breakfast', '07:00', '09:00', 10, 50)`,
    );
    const meals = Object.fromEntries((await list()).map((r) => [r.id, r.meals]));
    expect(meals['taya-house']).toEqual(['Dinner']);
    expect(meals['hura-izakaya']).toEqual(['Breakfast', 'Dinner']);
  });

  describe('search text (spec §6.3 item 9)', () => {
    it('folds what the card says: name, type, cuisines and destination, as the search overlay matched before', async () => {
      const r = (await list()).find((x) => x.id === 'pho-cuon')!;
      expect(r.search).toBe(fold(`${r.name} ${r.type} Vietnamese Furama Dining House`));
      expect(r.search).toContain('pho cuon');
    });

    it('in another language, holds that language’s words and the default language’s', async () => {
      await sql(`INSERT INTO restaurant_i18n (restaurant_id, locale, type_label) VALUES ('pho-cuon', 'vi', 'Món cuốn · Tầng 1')`);
      await sql(`INSERT INTO cuisine_i18n (cuisine_id, locale, label) VALUES ('vietnamese', 'vi', 'Món Việt')`);
      const r = (await list('vi')).find((x) => x.id === 'pho-cuon')!;
      expect(r.type).toBe('Món cuốn · Tầng 1');
      expect(r.search).toContain(fold('Món cuốn'));
      expect(r.search).toContain(fold('Món Việt'));
      expect(r.search).toContain('vietnamese');
      expect(r.search).toContain('furama dining house');
    });

    it('lists only published cuisines', async () => {
      await sql(`UPDATE cuisines SET is_published = false WHERE id = 'thai'`);
      const r = (await list()).find((x) => x.id === 'yum-food-village')!;
      expect(r.cuisines).toEqual(['international', 'vietnamese']);
      expect(r.search).not.toContain('thai');
    });
  });
});
```

- [ ] **Bước 4: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/guards/legacy-columns.guard.test.ts lib/cache-plan.test.ts lib/content/format.test.ts test/integration/content-loaders.test.ts test/integration/catalogue.test.ts`
Expected: FAIL `Test Files  5 failed (5)`, `Tests  1 failed | 1 passed (2)`:

```
     × finds none in app, components, lib, db and scripts 109ms
 FAIL  lib/cache-plan.test.ts [ lib/cache-plan.test.ts ]
Error: Cannot find module './cache-plan' imported from …/lib/cache-plan.test.ts
 FAIL  lib/content/format.test.ts [ lib/content/format.test.ts ]
Error: Cannot find module './format' imported from …/lib/content/format.test.ts
 FAIL  test/integration/catalogue.test.ts [ test/integration/catalogue.test.ts ]
Error: Cannot find package '@/lib/server/content/restaurants.queries' imported from …/test/integration/catalogue.test.ts
 FAIL  test/integration/content-loaders.test.ts [ test/integration/content-loaders.test.ts ]
Error: Cannot find package '@/lib/server/content/settings.queries' imported from …/test/integration/content-loaders.test.ts
 FAIL  test/guards/legacy-columns.guard.test.ts > no app SQL reads the phase-1 columns of restaurants (R10) > finds none in app, components, lib, db and scripts
AssertionError: expected [ 'db/queries.ts: r.type', …(2) ] to deeply equal []
```

(Guard tìm thấy `db/queries.ts: r.type`, `r.destination`, `r.cuisines`: bộ đọc cuối cùng của cột cũ.)

- [ ] **Bước 5: Các mảnh SQL, kiểu, công thức định dạng, cache plan**

Create `lib/server/content/sql.ts`:

```ts
import 'server-only';

/*
 * SQL fragments shared by the content queries (spec §5.1 item 5). Every query
 * that uses them takes the requested locale as $1 and starts with
 * `WITH ${LOCALE_CTE}`, which names the default language (lc.def) and whether
 * $1 serves machine translations (lc.machine). Identifiers passed in are code
 * constants, never input.
 *
 * locales.is_enabled is not checked here (R16): the proxy and the (guarded)
 * layout decide which languages a guest may open, and phase 8's Draft Mode
 * must render a language that is not on yet.
 */

export const LOCALE_CTE = `lc AS (
  SELECT coalesce((SELECT code FROM locales WHERE is_default), 'en') AS def,
         coalesce((SELECT serve_machine FROM locales WHERE code = $1), false) AS machine
)`;

/** A translation row a guest may see in $1: the default language always, another one when reviewed (or machine, if it serves those). */
const visible = (alias: string) =>
  `(${alias}.locale = lc.def OR ${alias}.status = 'reviewed' OR (${alias}.status = 'machine' AND lc.machine))`;

/**
 * Joins `table` twice: `alias` (the row in $1, when visible) and `alias_d`
 * (the default language's). Read a field with tr(alias, column).
 */
export function i18nJoin(table: string, alias: string, fk: string, parent: string): string {
  return `LEFT JOIN ${table} ${alias} ON ${alias}.${fk} = ${parent} AND ${alias}.locale = $1 AND ${visible(alias)}
  LEFT JOIN ${table} ${alias}_d ON ${alias}_d.${fk} = ${parent} AND ${alias}_d.locale = lc.def`;
}

/** One translatable field, falling back to the default language on its own (NULL means "not translated": CHECKs forbid blanks). */
export const tr = (alias: string, column: string) => `coalesce(${alias}.${column}, ${alias}_d.${column})`;

/**
 * An image as JSON ({url, alt, width, height}) or NULL, for `idExpr`: alt in
 * $1, else the default language's, and "" for a decorative image. Use as
 * `LEFT JOIN LATERAL ${mediaJson('x.image_id')} AS img ON true` and select img.j.
 */
export function mediaJson(idExpr: string): string {
  return `(SELECT json_build_object(
            'url', m.url, 'width', m.width, 'height', m.height,
            'alt', CASE WHEN m.is_decorative THEN '' ELSE coalesce(ma.alt, ma_d.alt, '') END) AS j
     FROM media m
     ${i18nJoin('media_i18n', 'ma', 'media_id', 'm.id')}
    WHERE m.id = ${idExpr} AND m.deleted_at IS NULL)`;
}

/** Today in Da Nang, the day offers are shown for (spec §5.1 item 8; the offers loader). */
export const VENUE_TODAY = `(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`;
```

Create `lib/content/types.ts`:

```ts
/*
 * What the guest site's content loaders (lib/server/content/*) hand to the
 * components: plain, serialisable shapes, resolved for one language with the
 * default language filling any field that has no visible translation
 * (spec §5.1 item 5). Safe in the browser: Server Components pass these as
 * props, and the (guarded) layout passes the site-wide ones to SiteProvider.
 */

/** An image as a component draws it: alt already chosen ("" for a decorative one). */
export type Media = { url: string; alt: string; width: number; height: number };

/** A dialable number (E.164) and the way it is printed. */
export type Phone = { tel: string; display: string };

/** The home page's fixed blocks (sections.key), in the design's order. */
export const SECTION_KEYS = [
  'hero',
  'film',
  'finder',
  'cuisines',
  'restaurants',
  'destinations',
  'experiences',
  'heritage',
  'stories',
  'offers',
  'booking_bar',
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

/** A home-page block: on or off, and its picture and link where it has one. */
export type Section = { visible: boolean; image: Media | null; link: string | null };
export type Sections = Record<SectionKey, Section>;

export type Cuisine = { id: string; label: string; image: Media | null };

export type Destination = {
  id: string;
  kind: 'venue' | 'teaser';
  /** The dropdowns', the footer's and "More at …"'s name; null for a teaser that has none ("Future Locations"). */
  name: string | null;
  /** The home card's two title lines and two blurb lines. */
  cardTitle: [string, string];
  cardBlurb: [string, string];
  image: Media | null;
  address: string | null;
  phone: Phone | null;
  map: string | null;
  showInFooter: boolean;
};

export type NavItem = { target: SectionKey; label: string };

export type SocialLink = { platform: string; href: string };

/** site_settings as the guest site reads it. */
export type SiteSettings = {
  /** The shared inbox: the footer's and the privacy page's address. */
  email: string;
  /** The restaurant the booking bar starts on; null: the first bookable one. */
  defaultRestaurantId: string | null;
  /** The finder's occasion; null: any. */
  defaultOccasion: string | null;
  heroAutoplayMs: number;
};

/** Everything the chrome (header, menu, footer, finder, search, booking bar) needs, on every guest page. */
export type SiteContent = {
  cuisines: Cuisine[];
  destinations: Destination[];
  nav: NavItem[];
  socials: SocialLink[];
  sections: Sections;
  settings: SiteSettings;
};
```

`intlSafe` trả chính mã đó, hoặc `'en'` khi `Intl.getCanonicalLocales` từ chối dạng BCP 47 của nó; mọi mã của bảng `locales` đều qua.

Create `lib/content/format.ts`:

```ts
import { toBcp47 } from '@/lib/i18n/locales';

/*
 * Text the content loaders build from typed columns. They run on the server
 * only (inside 'use cache'), so the browser never formats these and server
 * and browser ICU data cannot disagree at hydration. English wording and
 * order are the site's as of phase 5, pixel for pixel; other languages use
 * Intl's own order until phase 8 gives them registry templates.
 */

/**
 * The code itself, or 'en' when Intl refuses its BCP 47 form. Every code the
 * locales table holds passes; a path such as /favicon.ico or /wp-login.php
 * reaches a loader with its first segment as the language, and a loader must
 * answer for it, not throw a RangeError.
 */
function intlSafe(locale: string): string {
  try {
    Intl.getCanonicalLocales(toBcp47(locale));
    return locale;
  } catch {
    return 'en';
  }
}

/** "9 Sep 2026": day first, the short month as en-US spells it (en-GB's CLDR says "Sept"). A calendar date: formatted in UTC. */
export function formatStoryDate(iso: string, locale: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const options = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' } as const;
  const code = intlSafe(locale);
  if (code !== 'en') return new Intl.DateTimeFormat(toBcp47(code), options).format(date);
  const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')} ${part('month')} ${part('year')}`;
}

/** A story card's kicker: "Restaurant News · 9 Sep 2026", or the category alone when the story has no date. */
export function storyKicker(category: string, publishedOn: string | null, locale: string): string {
  return publishedOn ? `${category} · ${formatStoryDate(publishedOn, locale)}` : category;
}

export type OfferPrice = { amount: string | number; currency: string; basis: 'plus_plus' | 'net' };

/**
 * "VND 888,000++ per guest", "VND 450,000 net per guest". The number alone
 * goes through Intl: the currency style would put U+00A0 after the code, and
 * the card printed a plain space. PHASE 7: "per guest" and the order become
 * registry templates (offers.price_plus_plus, offers.price_net).
 */
export function formatPrice(price: OfferPrice, locale: string): string {
  const amount = new Intl.NumberFormat(toBcp47(intlSafe(locale))).format(Number(price.amount));
  return `${price.currency} ${amount}${price.basis === 'plus_plus' ? '++' : ' net'} per guest`;
}

/** An offer card's detail line: the price, then the schedule, joined by " · "; either may stand alone. */
export function offerDetail(price: string | null, schedule: string | null): string {
  return [price, schedule].filter(Boolean).join(' · ');
}
```

`LOADERS` chỉ khai loader đã có (test đòi mỗi mục có một loader gắn nó); Task 6, 7, 8 thêm mục của chúng. `restaurants` mang thêm `content:cuisines` và `content:destinations`: chữ tìm kiếm và số gọi của danh mục đọc các bảng đó.

Create `lib/cache-plan.ts`:

```ts
import { TAGS } from './cache-tags';

/*
 * The cache plan of the guest site (spec §6.2): which tables each cached
 * loader reads and which tags it carries, and which tags a save to each table
 * must expire. lib/cache-plan.test.ts checks the two agree: a save to any
 * table a loader reads expires at least one of that loader's tags. The
 * loaders call cacheTag(...LOADERS.<name>.tags) from here, so a loader cannot
 * drift from its entry; a phase-7 editor expires tagsForSave(<tables>) (in a
 * Server Action: updateTag each) for the tables its transaction wrote.
 *
 * Every loader also carries i18n:<locale> (it takes the locale), so enabling,
 * disabling or changing the machine-translation switch of a language expires
 * everything served in it.
 */

export const CONTENT_TABLES = [
  'locales',
  'content_strings',
  'media',
  'media_i18n',
  'sections',
  'site_settings',
  'destinations',
  'destination_i18n',
  'cuisines',
  'cuisine_i18n',
  'restaurants',
  'restaurant_i18n',
  'restaurant_cuisines',
  'restaurant_highlights',
  'restaurant_highlight_i18n',
  'service_periods',
  'hero_slides',
  'experiences',
  'experience_i18n',
  'stories',
  'story_i18n',
  'offers',
  'offer_i18n',
  'nav_items',
  'nav_item_i18n',
  'social_links',
] as const;
export type ContentTable = (typeof CONTENT_TABLES)[number];

/**
 * What a save to each table expires. `restaurant:<id>` is added by the caller
 * for a restaurant's own rows (tagsForSave's second argument). content_strings
 * is per key prefix (phase 7: hero.* → content:hero, legal.* → content:legal,
 * the rest → content:ui); locales expire `locales` and the i18n tag of every
 * language whose fallback changed (phase 8).
 */
export const SAVE_TAGS: Record<ContentTable, readonly string[]> = {
  locales: [TAGS.locales],
  // By key prefix (phase 7): legal.* → content:legal, the rest → content:ui (and a section's own keys its tag).
  content_strings: [TAGS.contentUi, TAGS.contentLegal],
  media: [TAGS.media],
  media_i18n: [TAGS.media],
  sections: [TAGS.contentSections],
  site_settings: [TAGS.contentContact],
  destinations: [TAGS.contentDestinations],
  destination_i18n: [TAGS.contentDestinations],
  cuisines: [TAGS.contentCuisines],
  cuisine_i18n: [TAGS.contentCuisines],
  restaurants: [TAGS.restaurants],
  restaurant_i18n: [TAGS.restaurants],
  restaurant_cuisines: [TAGS.restaurants],
  restaurant_highlights: [TAGS.restaurants],
  restaurant_highlight_i18n: [TAGS.restaurants],
  // The catalogue's meals come from the active periods (phase 4 saves already expire `restaurants`).
  service_periods: [TAGS.restaurants],
  hero_slides: [TAGS.contentHero],
  experiences: [TAGS.contentExperiences],
  experience_i18n: [TAGS.contentExperiences],
  stories: [TAGS.contentStories],
  story_i18n: [TAGS.contentStories],
  offers: [TAGS.contentOffers],
  offer_i18n: [TAGS.contentOffers],
  nav_items: [TAGS.contentNav],
  nav_item_i18n: [TAGS.contentNav],
  social_links: [TAGS.contentContact],
};

type Loader = { reads: readonly ContentTable[]; tags: readonly string[] };

/** Every cached guest loader: the tables its SQL touches and the tags it carries (besides i18n:<locale>). */
export const LOADERS = {
  locales: { reads: ['locales'], tags: [TAGS.locales] },
  strings: { reads: ['locales', 'content_strings'], tags: [TAGS.contentUi] },
  legal: { reads: ['locales', 'content_strings'], tags: [TAGS.contentLegal] },
  sections: { reads: ['locales', 'sections', 'media', 'media_i18n'], tags: [TAGS.contentSections, TAGS.media] },
  settings: { reads: ['site_settings'], tags: [TAGS.contentContact] },
  cuisines: { reads: ['locales', 'cuisines', 'cuisine_i18n', 'media', 'media_i18n'], tags: [TAGS.contentCuisines, TAGS.media] },
  destinations: {
    reads: ['locales', 'destinations', 'destination_i18n', 'media', 'media_i18n'],
    tags: [TAGS.contentDestinations, TAGS.media],
  },
  nav: { reads: ['locales', 'nav_items', 'nav_item_i18n', 'sections'], tags: [TAGS.contentNav, TAGS.contentSections] },
  socials: { reads: ['social_links'], tags: [TAGS.contentContact] },
  // The search text folds cuisine labels and the destination's name in; CALL falls back to the destination's number.
  restaurants: {
    reads: [
      'locales',
      'restaurants',
      'restaurant_i18n',
      'restaurant_cuisines',
      'service_periods',
      'media',
      'media_i18n',
      'cuisines',
      'cuisine_i18n',
      'destinations',
      'destination_i18n',
    ],
    tags: [TAGS.restaurants, TAGS.media, TAGS.contentCuisines, TAGS.contentDestinations],
  },
} as const satisfies Record<string, Loader>;

export type LoaderName = keyof typeof LOADERS;

/** The tags a transaction that wrote `tables` must expire; `restaurantId` adds that restaurant's own tag. */
export function tagsForSave(tables: readonly ContentTable[], restaurantId?: string): string[] {
  const tags = new Set(tables.flatMap((t) => SAVE_TAGS[t]));
  if (restaurantId) tags.add(TAGS.restaurant(restaurantId));
  return [...tags];
}
```

- [ ] **Bước 6: Một bộ đọc `site_settings`**

Create `lib/server/content/settings.queries.ts`:

```ts
import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { getPool } from '@/db/client';
import { US } from '@/lib/server/booking/config';

/** The one row of site_settings (migrations 007, 008). */
export type SiteSettingsRow = {
  /** The shared inbox: the footer's and the privacy page's address, staff.new's fallback, a guest's Reply-To. */
  email: string;
  defaultRestaurantId: string | null;
  defaultOccasion: string | null;
  heroAutoplayMs: number;
  ogImageId: string | null;
  /** updated_at as text: the optimistic-concurrency token of the admin form. */
  token: string;
};

/**
 * The only reader of site_settings (phase-5 deferral T6.8): the cached guest
 * loader (lib/server/content/site.ts), the notifications screen and the email
 * sender all call this. `db` lets the sender read on its own pool or client
 * (after() and the cron run outside any Next cache scope). Uncached.
 */
export async function loadSiteSettings(db: Pool | PoolClient = getPool()): Promise<SiteSettingsRow | null> {
  const { rows } = await db.query<SiteSettingsRow>(
    `SELECT email,
            default_restaurant_id AS "defaultRestaurantId",
            default_occasion      AS "defaultOccasion",
            hero_autoplay_ms      AS "heroAutoplayMs",
            og_image_id           AS "ogImageId",
            ${US('updated_at')}   AS token
       FROM site_settings WHERE id`,
  );
  return rows[0] ?? null;
}
```

Hai bộ đọc cũ của `site_settings.email` gọi nó (việc hoãn T6.8 của đợt 5). Sửa `lib/server/email/recipients.ts`:

```diff
diff --git a/lib/server/email/recipients.ts b/lib/server/email/recipients.ts
index 9c28490..0a712b6 100644
--- a/lib/server/email/recipients.ts
+++ b/lib/server/email/recipients.ts
@@ -3,6 +3,7 @@ import type { Pool, PoolClient } from 'pg';
 import type { StaffEmailEventName } from '@/lib/email/events';
 import { insertAudit, withTransaction, type AuditActor } from '@/lib/server/audit';
 import { US, conflictBy, type Conflict } from '@/lib/server/booking/config';
+import { loadSiteSettings } from '@/lib/server/content/settings.queries';
 
 /*
  * Who receives staff notifications (spec §5.2 notification_recipients, §10.4),
@@ -159,8 +160,9 @@ export async function deleteRecipient(pool: Pool, actor: AuditActor, input: { id
 // ── the shared inbox (site_settings.email) ─────────────────────────────────
 
 export async function getSharedInbox(db: Db): Promise<{ email: string; token: string }> {
-  const { rows } = await db.query<{ email: string; token: string }>(`SELECT email, ${US('updated_at')} AS token FROM site_settings WHERE id`);
-  return rows[0];
+  const settings = await loadSiteSettings(db);
+  if (!settings) throw new Error('site_settings has no row (migration 007 seeds it)');
+  return { email: settings.email, token: settings.token };
 }
 
 /** R3: the same address is the general email of the site footer from phase 6/7; the screen says so. */
```

Sửa `lib/server/email/booking/render.ts`:

```diff
diff --git a/lib/server/email/booking/render.ts b/lib/server/email/booking/render.ts
index 64928af..2041f02 100644
--- a/lib/server/email/booking/render.ts
+++ b/lib/server/email/booking/render.ts
@@ -5,6 +5,7 @@ import { audienceOf, type EmailAudience, type EmailEvent } from '@/lib/email/eve
 import { formatMessage } from '@/lib/i18n/format';
 import { registryLocaleDefault, type StringKey } from '@/lib/i18n/registry';
 import { resolveStrings } from '@/lib/i18n/resolve';
+import { loadSiteSettings } from '@/lib/server/content/settings.queries';
 import { loadStringRows } from '@/lib/server/content/strings.queries';
 import { appOrigin } from '../auth-emails';
 import { renderEmail } from '../send';
@@ -192,8 +193,7 @@ export async function loadEmailStrings(db: Db, event: EmailEvent, locale: string
 
 /** Where a guest's reply lands: the shared inbox (site_settings.email). */
 export async function sharedInbox(db: Db): Promise<string | null> {
-  const { rows } = await db.query<{ email: string }>('SELECT email FROM site_settings WHERE id');
-  return rows[0]?.email ?? null;
+  return (await loadSiteSettings(db))?.email ?? null;
 }
 
 export type RenderedEmail = { subject: string; html: string; text: string; replyTo?: string; locale: string };
```

- [ ] **Bước 7: Danh mục từ các bảng của 008**

Chữ tìm kiếm giữ đúng thứ tự `SearchOverlay` ghép trước đợt 6 (tên, loại, nhãn ẩm thực, tên điểm đến), nên ở tiếng Anh nó giống hệt chuỗi cũ; ở ngôn ngữ khác, các từ của ngôn ngữ mặc định nối thêm khi chúng khác.

Create `lib/server/content/restaurants.queries.ts`:

```ts
import 'server-only';
import { query } from '@/db/client';
import { fold } from '@/lib/booking';
import type { Media } from '@/lib/content/types';
import { MEALS, type Meal, type Restaurant } from '@/lib/data';
import { LOCALE_CTE, i18nJoin, mediaJson, tr } from './sql';

/* Restaurants as the guest site shows them, uncached (lib/server/content/restaurants.ts wraps them). */

type RestaurantRow = {
  id: string;
  slug: string;
  name: string;
  type: string | null;
  type_default: string | null;
  destination_id: string;
  destination_name: string | null;
  destination_name_default: string | null;
  cuisines: string[];
  cuisine_labels: string[];
  cuisine_labels_default: string[];
  meals: string[];
  booking_enabled: boolean;
  has_detail_page: boolean;
  image: Media | null;
  phone_e164: string | null;
  phone_display: string | null;
};

/**
 * The catalogue in the order staff set (ties broken by id, so the order is
 * total: phase-4 ledger T3), published and not archived. type: the
 * restaurant's type line in `locale`, else the default language's. cuisines:
 * restaurant_cuisines ids (slugs) of published cuisines, in their own order.
 * meals: the meals of the active service periods, in MEALS order (spec §6.3
 * item 2). phone: the restaurant's own number, else its destination's (spec
 * §6.4). search: name, type, cuisine labels and destination name, in `locale`
 * and in the default language, folded once here (spec §6.3 item 9). The
 * booking path reads lib/server/booking/rules.ts, never this.
 */
export async function loadRestaurants(locale: string): Promise<Restaurant[]> {
  const rows = await query<RestaurantRow>(
    `WITH ${LOCALE_CTE}
     SELECT r.id, r.slug, r.name, ${tr('rt', 'type_label')} AS type, rt_d.type_label AS type_default,
            r.destination_id, ${tr('dt', 'name')} AS destination_name, dt_d.name AS destination_name_default,
            r.booking_enabled, r.has_detail_page, img.j AS image,
            CASE WHEN r.phone_e164 IS NOT NULL THEN r.phone_e164 ELSE d.phone_e164 END AS phone_e164,
            CASE WHEN r.phone_e164 IS NOT NULL THEN r.phone_display ELSE d.phone_display END AS phone_display,
            ARRAY(SELECT rc.cuisine_id
                    FROM restaurant_cuisines rc JOIN cuisines c ON c.id = rc.cuisine_id AND c.is_published
                   WHERE rc.restaurant_id = r.id
                   ORDER BY rc.sort_order, rc.cuisine_id) AS cuisines,
            ARRAY(SELECT ${tr('ct', 'label')}
                    FROM restaurant_cuisines rc JOIN cuisines c ON c.id = rc.cuisine_id AND c.is_published
                    ${i18nJoin('cuisine_i18n', 'ct', 'cuisine_id', 'c.id')}
                   WHERE rc.restaurant_id = r.id AND ${tr('ct', 'label')} IS NOT NULL
                   ORDER BY rc.sort_order, rc.cuisine_id) AS cuisine_labels,
            ARRAY(SELECT ct_d.label
                    FROM restaurant_cuisines rc JOIN cuisines c ON c.id = rc.cuisine_id AND c.is_published
                    JOIN cuisine_i18n ct_d ON ct_d.cuisine_id = c.id AND ct_d.locale = lc.def
                   WHERE rc.restaurant_id = r.id
                   ORDER BY rc.sort_order, rc.cuisine_id) AS cuisine_labels_default,
            ARRAY(SELECT m.meal
                    FROM unnest($2::text[]) WITH ORDINALITY AS m(meal, n)
                   WHERE EXISTS (SELECT 1 FROM service_periods p
                                  WHERE p.restaurant_id = r.id AND p.active AND p.meal = m.meal)
                   ORDER BY m.n) AS meals
       FROM restaurants r CROSS JOIN lc
       JOIN destinations d ON d.id = r.destination_id
       ${i18nJoin('restaurant_i18n', 'rt', 'restaurant_id', 'r.id')}
       ${i18nJoin('destination_i18n', 'dt', 'destination_id', 'd.id')}
       LEFT JOIN LATERAL ${mediaJson('r.card_image_id')} AS img ON true
      WHERE r.is_published AND r.archived_at IS NULL
      ORDER BY r.sort_order, r.id`,
    [locale, MEALS],
  );
  return rows.map((r) => {
    // What the card says, in the order the search overlay joined it before phase 6; then the default
    // language's words where they differ, so a guest can search in either (in English nothing is added).
    const shown = [r.name, r.type, ...r.cuisine_labels, r.destination_name];
    const fallback = [r.type_default, ...r.cuisine_labels_default, r.destination_name_default].filter((w) => !shown.includes(w));
    return {
      id: r.id,
      slug: r.slug,
      hasDetailPage: r.has_detail_page,
      name: r.name,
      type: r.type ?? '',
      cuisines: r.cuisines,
      dest: r.destination_id,
      meals: r.meals as Meal[],
      bookingEnabled: r.booking_enabled,
      image: r.image,
      phone: r.phone_e164 && r.phone_display ? { tel: r.phone_e164, display: r.phone_display } : null,
      search: fold([...shown, ...fallback].filter(Boolean).join(' ')),
    };
  });
}
```

Sửa `lib/server/content/restaurants.ts`:

```diff
diff --git a/lib/server/content/restaurants.ts b/lib/server/content/restaurants.ts
index 0f18957..b85f85b 100644
--- a/lib/server/content/restaurants.ts
+++ b/lib/server/content/restaurants.ts
@@ -1,19 +1,20 @@
 import 'server-only';
 import { cacheLife, cacheTag } from 'next/cache';
-import { listRestaurants } from '@/db/queries';
+import { LOADERS } from '@/lib/cache-plan';
 import { TAGS } from '@/lib/cache-tags';
 import type { Restaurant } from '@/lib/data';
+import { loadRestaurants } from './restaurants.queries';
 
-/**
- * The guest-facing catalogue. Cached across requests and baked into the
- * prerendered pages; an admin save will expire it with updateTag('restaurants').
- * `locale` is unused until restaurant_i18n exists, but it is already part of
- * the cache key so every language gets its own entry.
- * Never import this from Vitest: cacheTag() throws outside Next.
+/*
+ * Restaurants, cached (see lib/server/content/site.ts for the rules). Booking
+ * config saves expire 'restaurants' (phase 4); phase 7's restaurant editor
+ * expires 'restaurants' and 'restaurant:<id>' (lib/cache-plan.ts tagsForSave).
  */
+
+/** The guest-facing catalogue, baked into every prerendered guest page. */
 export async function getRestaurants(locale: string): Promise<Restaurant[]> {
   'use cache';
   cacheLife('max');
-  cacheTag(TAGS.restaurants, TAGS.i18n(locale));
-  return listRestaurants();
+  cacheTag(...LOADERS.restaurants.tags, TAGS.i18n(locale));
+  return loadRestaurants(locale);
 }
```

`Restaurant` mang thêm ảnh, số gọi và chữ tìm kiếm; `DestKey` thành `string` (các id là dữ liệu từ 004), để các component còn tra `DESTS[r.dest]` biên dịch được tới Task 5 và 7. Sửa `lib/data.ts`:

```diff
diff --git a/lib/data.ts b/lib/data.ts
index 59b11d4..80e4051 100644
--- a/lib/data.ts
+++ b/lib/data.ts
@@ -1,25 +1,36 @@
+import type { Media, Phone } from '@/lib/content/types';
+
 export type Meal = 'Breakfast' | 'Lunch' | 'Dinner' | 'Drinks';
-export type DestKey = 'resort' | 'dining-house' | 'mm';
+/** destinations.id: rows since migration 004, so any string (DESTS below names the three of phase 5 until it goes). */
+export type DestKey = string;
 
 export type Restaurant = {
   id: string;
-  /** URL segment of /[lang]/restaurants/[slug]. Phase 2: the id. Phase 6: restaurants.slug. */
+  /** URL segment of /[lang]/restaurants/[slug] (restaurants.slug). */
   slug: string;
-  /** Phase 2: DETAIL_PAGE_IDS below. Phase 6: restaurants.has_detail_page. */
+  /** restaurants.has_detail_page: the card opens the page instead of the reservation form. */
   hasDetailPage: boolean;
   name: string;
+  /** restaurant_i18n.type_label in the page's language, else the default language's. */
   type: string;
-  /** Cuisine slugs (the second column of CUISINES), never labels. */
+  /** Cuisine ids (slugs, via restaurant_cuisines), never labels. */
   cuisines: string[];
+  /** destinations.id (restaurants.destination_id). */
   dest: DestKey;
   /** The meals of its active service periods (spec §6.3 item 2), in MEALS order; drives the Occasion filter. */
   meals: Meal[];
   /** restaurants.booking_enabled: off hides its RESERVE entry points and drops it from the reservation form. */
   bookingEnabled: boolean;
+  /** The card picture (restaurants.card_image_id; alt: a copy of the name, R19); null draws the frame alone. */
+  image: Media | null;
+  /** The restaurant's own number, else its destination's (spec §6.4); null when neither has one. */
+  phone: Phone | null;
+  /** Name, type, cuisine labels and destination name, in the page's language and the default one, fold()ed: what search matches. */
+  search: string;
 };
 
-/* The restaurant catalogue lives in Neon (see db/migrations/002_seed_restaurants.sql)
-   and is loaded by db/queries.ts#listRestaurants. */
+/* The restaurant catalogue lives in the database (migrations 002, 008) and is
+   loaded by lib/server/content/restaurants.queries.ts#loadRestaurants. */
 
 /** Restaurants with their own page. Phase 6 replaces this with restaurants.has_detail_page. */
 export const DETAIL_PAGE_IDS: ReadonlySet<string> = new Set(['taya-house']);
```

Sửa `lib/booking/client.test.ts`:

```diff
diff --git a/lib/booking/client.test.ts b/lib/booking/client.test.ts
index 4796a73..302d3e5 100644
--- a/lib/booking/client.test.ts
+++ b/lib/booking/client.test.ts
@@ -22,6 +22,9 @@ const restaurant = (id: string, dest: Restaurant['dest'], bookingEnabled = true)
   dest,
   meals: ['Dinner'],
   bookingEnabled,
+  image: null,
+  phone: null,
+  search: id,
 });
 
 const all = [
```

Xóa bộ đọc cũ: `rm db/queries.ts`.

- [ ] **Bước 8: Nội dung của chrome**

Mỗi loader một truy vấn và một entry cache, nên mỗi wrapper mang đúng tag của bảng nó đọc. Thẻ teaser (`future`) không có tên: không lọc theo tên, nếu không section Destinations mất thẻ thứ tư.

Create `lib/server/content/site.queries.ts`:

```ts
import 'server-only';
import { query } from '@/db/client';
import {
  SECTION_KEYS,
  type Cuisine,
  type Destination,
  type Media,
  type NavItem,
  type SectionKey,
  type Sections,
  type SocialLink,
} from '@/lib/content/types';
import { LOCALE_CTE, i18nJoin, mediaJson, tr } from './sql';

/*
 * The site-wide content (the chrome of every guest page), uncached: the
 * 'use cache' wrappers live in lib/server/content/site.ts. One query each, so
 * each wrapper carries exactly the tags of the tables it read
 * (lib/cache-plan.ts LOADERS). Unpublished rows never leave the database;
 * lists are ordered by sort_order, then id.
 */

/** Every section, keyed; a key without a row is visible with nothing attached (a section added in code before its row). */
export async function loadSections(locale: string): Promise<Sections> {
  const rows = await query<{ key: SectionKey; is_visible: boolean; link_url: string | null; image: Media | null }>(
    `WITH ${LOCALE_CTE}
     SELECT s.key, s.is_visible, s.link_url, img.j AS image
       FROM sections s CROSS JOIN lc
       LEFT JOIN LATERAL ${mediaJson('s.image_id')} AS img ON true`,
    [locale],
  );
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return Object.fromEntries(
    SECTION_KEYS.map((key) => {
      const r = byKey.get(key);
      return [key, { visible: r?.is_visible ?? true, image: r?.image ?? null, link: r?.link_url ?? null }];
    }),
  ) as Sections;
}

export async function loadCuisines(locale: string): Promise<Cuisine[]> {
  return query<Cuisine>(
    `WITH ${LOCALE_CTE}
     SELECT c.id, ${tr('ct', 'label')} AS label, img.j AS image
       FROM cuisines c CROSS JOIN lc
       ${i18nJoin('cuisine_i18n', 'ct', 'cuisine_id', 'c.id')}
       LEFT JOIN LATERAL ${mediaJson('c.image_id')} AS img ON true
      WHERE c.is_published AND ${tr('ct', 'label')} IS NOT NULL
      ORDER BY c.sort_order, c.id`,
    [locale],
  );
}

type DestinationRow = {
  id: string;
  kind: 'venue' | 'teaser';
  name: string | null;
  title_1: string | null;
  title_2: string | null;
  blurb_1: string | null;
  blurb_2: string | null;
  address: string | null;
  phone_e164: string | null;
  phone_display: string | null;
  map_url: string | null;
  show_in_footer: boolean;
  image: Media | null;
};

/** The published destinations; a teaser may have no name (its card says it all). */
export async function loadDestinations(locale: string): Promise<Destination[]> {
  const rows = await query<DestinationRow>(
    `WITH ${LOCALE_CTE}
     SELECT d.id, d.kind, ${tr('dt', 'name')} AS name,
            ${tr('dt', 'card_title_1')} AS title_1, ${tr('dt', 'card_title_2')} AS title_2,
            ${tr('dt', 'card_blurb_1')} AS blurb_1, ${tr('dt', 'card_blurb_2')} AS blurb_2,
            ${tr('dt', 'address')} AS address,
            d.phone_e164, d.phone_display, d.map_url, d.show_in_footer, img.j AS image
       FROM destinations d CROSS JOIN lc
       ${i18nJoin('destination_i18n', 'dt', 'destination_id', 'd.id')}
       LEFT JOIN LATERAL ${mediaJson('d.card_image_id')} AS img ON true
      WHERE d.is_published
      ORDER BY d.sort_order, d.id`,
    [locale],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    cardTitle: [r.title_1 ?? r.name ?? '', r.title_2 ?? ''],
    cardBlurb: [r.blurb_1 ?? '', r.blurb_2 ?? ''],
    image: r.image,
    address: r.address,
    phone: r.phone_e164 && r.phone_display ? { tel: r.phone_e164, display: r.phone_display } : null,
    map: r.map_url,
    showInFooter: r.show_in_footer,
  }));
}

/** The header and menu links; an item whose section is switched off is left out (spec §6.5). */
export async function loadNav(locale: string): Promise<NavItem[]> {
  return query<NavItem>(
    `WITH ${LOCALE_CTE}
     SELECT n.target_section AS target, ${tr('nt', 'label')} AS label
       FROM nav_items n CROSS JOIN lc
       JOIN sections s ON s.key = n.target_section AND s.is_visible
       ${i18nJoin('nav_item_i18n', 'nt', 'nav_item_id', 'n.id')}
      WHERE n.is_published AND ${tr('nt', 'label')} IS NOT NULL
      ORDER BY n.sort_order, n.id`,
    [locale],
  );
}

/** The footer's social links shown in `locale` (visible_locales NULL: every language). */
export async function loadSocials(locale: string): Promise<SocialLink[]> {
  return query<SocialLink>(
    `SELECT platform, href FROM social_links
      WHERE is_published AND (visible_locales IS NULL OR $1 = ANY (visible_locales))
      ORDER BY sort_order, id`,
    [locale],
  );
}
```

Create `lib/server/content/site.ts`:

```ts
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { LOADERS } from '@/lib/cache-plan';
import { TAGS } from '@/lib/cache-tags';
import type { SiteContent, SiteSettings } from '@/lib/content/types';
import { loadSiteSettings } from './settings.queries';
import { loadCuisines, loadDestinations, loadNav, loadSections, loadSocials } from './site.queries';

/*
 * The site-wide content, cached (spec §6.2): 'use cache', cacheLife('max'),
 * the tags of lib/cache-plan.ts, and the locale as an argument (so it is part
 * of the cache key). One entry per tag group, so a save expires only what
 * read its table. Never import these from Vitest: cacheTag() throws outside
 * Next; test the *.queries.ts functions instead.
 */

export async function getSections(locale: string) {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.sections.tags, TAGS.i18n(locale));
  return loadSections(locale);
}

export async function getCuisines(locale: string) {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.cuisines.tags, TAGS.i18n(locale));
  return loadCuisines(locale);
}

export async function getDestinations(locale: string) {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.destinations.tags, TAGS.i18n(locale));
  return loadDestinations(locale);
}

export async function getNav(locale: string) {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.nav.tags, TAGS.i18n(locale));
  return loadNav(locale);
}

export async function getSocials(locale: string) {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.socials.tags, TAGS.i18n(locale));
  return loadSocials(locale);
}

/**
 * site_settings as the guest site needs it. Not per language (R17): nothing
 * in it is translated, so one entry serves every locale. A missing row is the
 * one content gap that throws: migration 007 seeds it and nothing deletes it.
 */
export async function getSiteSettings(): Promise<SiteSettings> {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.settings.tags);
  const row = await loadSiteSettings();
  if (!row) throw new Error('site_settings has no row (migration 007 seeds it)');
  return {
    email: row.email,
    defaultRestaurantId: row.defaultRestaurantId,
    defaultOccasion: row.defaultOccasion,
    heroAutoplayMs: row.heroAutoplayMs,
  };
}

/** Everything the chrome needs, for the (guarded) layout to hand to SiteProvider. Each part is its own cache entry. */
export async function getSiteContent(locale: string): Promise<SiteContent> {
  const [cuisines, destinations, nav, socials, sections, settings] = await Promise.all([
    getCuisines(locale),
    getDestinations(locale),
    getNav(locale),
    getSocials(locale),
    getSections(locale),
    getSiteSettings(),
  ]);
  return { cuisines, destinations, nav, socials, sections, settings };
}
```

- [ ] **Bước 9: Ba loader cũ gắn tag qua `LOADERS`**

Sửa `lib/server/content/legal.ts`:

```diff
diff --git a/lib/server/content/legal.ts b/lib/server/content/legal.ts
index 5b6430f..11b9d31 100644
--- a/lib/server/content/legal.ts
+++ b/lib/server/content/legal.ts
@@ -1,5 +1,6 @@
 import 'server-only';
 import { cacheLife, cacheTag } from 'next/cache';
+import { LOADERS } from '@/lib/cache-plan';
 import { TAGS } from '@/lib/cache-tags';
 import { resolveStrings } from '@/lib/i18n/resolve';
 import { PRIVACY_KEYS } from '@/lib/legal';
@@ -14,7 +15,7 @@ import { loadStringRows } from './strings.queries';
 export async function getPrivacyStrings(locale: string) {
   'use cache';
   cacheLife('max');
-  cacheTag(TAGS.contentLegal, TAGS.i18n(locale));
+  cacheTag(...LOADERS.legal.tags, TAGS.i18n(locale));
 
   const { defaultLocale, rows } = await loadStringRows(locale, PRIVACY_KEYS);
   return resolveStrings(rows, PRIVACY_KEYS, locale, defaultLocale);
```

Sửa `lib/server/content/locales.ts`:

```diff
diff --git a/lib/server/content/locales.ts b/lib/server/content/locales.ts
index b3c004c..e036831 100644
--- a/lib/server/content/locales.ts
+++ b/lib/server/content/locales.ts
@@ -1,6 +1,6 @@
 import 'server-only';
 import { cacheLife, cacheTag } from 'next/cache';
-import { TAGS } from '@/lib/cache-tags';
+import { LOADERS } from '@/lib/cache-plan';
 import { loadEnabledLocales, type SiteLocale } from './locales.queries';
 
 export type { SiteLocale };
@@ -9,6 +9,6 @@ export type { SiteLocale };
 export async function getEnabledLocales(): Promise<SiteLocale[]> {
   'use cache';
   cacheLife('max');
-  cacheTag(TAGS.locales);
+  cacheTag(...LOADERS.locales.tags);
   return loadEnabledLocales();
 }
```

Sửa `lib/server/content/strings.ts`:

```diff
diff --git a/lib/server/content/strings.ts b/lib/server/content/strings.ts
index 77467ae..4ccc022 100644
--- a/lib/server/content/strings.ts
+++ b/lib/server/content/strings.ts
@@ -1,5 +1,6 @@
 import 'server-only';
 import { cacheLife, cacheTag } from 'next/cache';
+import { LOADERS } from '@/lib/cache-plan';
 import { TAGS } from '@/lib/cache-tags';
 import type { StringKey } from '@/lib/i18n/registry';
 import { resolveStrings } from '@/lib/i18n/resolve';
@@ -18,7 +19,7 @@ export async function getStrings<K extends StringKey>(
 ): Promise<Record<K, string>> {
   'use cache';
   cacheLife('max');
-  cacheTag(TAGS.contentUi, TAGS.i18n(locale));
+  cacheTag(...LOADERS.strings.tags, TAGS.i18n(locale));
 
   const { defaultLocale, rows } = await loadStringRows(locale, keys);
   return resolveStrings(rows, keys, locale, defaultLocale);
```

- [ ] **Bước 10: check-prerender mong ba tag mới của danh mục**

Sửa `scripts/check-prerender.mjs`:

```diff
diff --git a/scripts/check-prerender.mjs b/scripts/check-prerender.mjs
index 1fd3cb5..2c71a41 100644
--- a/scripts/check-prerender.mjs
+++ b/scripts/check-prerender.mjs
@@ -32,7 +32,8 @@ const PAGES = {
   '/en/restaurants/taya-house': 'en/restaurants/taya-house',
   '/en/privacy': 'en/privacy',
 };
-const TAGS = ['restaurants', 'i18n:en', 'locales', 'content:ui'];
+/** The (guarded) layout's tags: the catalogue (lib/server/content/restaurants.ts) also reads cuisines, destinations and media. */
+const TAGS = ['restaurants', 'i18n:en', 'locales', 'content:ui', 'content:cuisines', 'content:destinations', 'media'];
 /** Tags a page carries beyond the layout's: the privacy policy's own reader (lib/server/content/legal.ts). */
 const PAGE_TAGS = { '/en/privacy': ['content:legal'] };
 const REVALIDATE = 2_592_000; // cacheLife('max'): 30 days
```

- [ ] **Bước 11: Chạy lại test**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/guards/legacy-columns.guard.test.ts lib/cache-plan.test.ts lib/content/format.test.ts test/integration/content-loaders.test.ts test/integration/catalogue.test.ts lib/booking/client.test.ts`
Expected: PASS `Test Files  6 passed (6)`, `Tests  57 passed (57)`

- [ ] **Bước 12: Kiểm rằng guard bắt được một lần đọc cột cũ (M9)**

Trong `lib/server/content/restaurants.queries.ts`, đổi `     SELECT r.id, r.slug, r.name, ${tr` thành `     SELECT r.id, r.slug, r.name, r.destination, ${tr`, chạy `npx vitest run test/guards/legacy-columns.guard.test.ts`. Expected: `Tests  1 failed | 1 passed (2)`:

```
     × finds none in app, components, lib, db and scripts 101ms
AssertionError: expected [ Array(1) ] to deeply equal []
+   "lib/server/content/restaurants.queries.ts: r.destination",
```

Trả file về như Bước 7.

- [ ] **Bước 13: Chạy cổng kiểm tra**

Expected:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo;
- `Test Files  76 passed (76)`, `Tests  983 passed (983)`;
- `Applied 8 migration(s).`; build thoát 0; check-prerender in `Prerender check passed: /en, /en/restaurants/taya-house, /en/privacy (tags: restaurants, i18n:en, locales, content:ui, content:cuisines, content:destinations, media; /en/privacy also content:legal).`;
- E2E `151 passed`, `1 skipped`; visual `8 passed`.

- [ ] **Bước 14: Commit**

```bash
git rm db/queries.ts
git add lib/booking/client.test.ts lib/cache-plan.test.ts lib/cache-plan.ts lib/content/format.test.ts lib/content/format.ts lib/content/types.ts lib/data.ts lib/server/content/legal.ts lib/server/content/locales.ts lib/server/content/restaurants.queries.ts lib/server/content/restaurants.ts lib/server/content/settings.queries.ts lib/server/content/site.queries.ts lib/server/content/site.ts lib/server/content/sql.ts lib/server/content/strings.ts lib/server/email/booking/render.ts lib/server/email/recipients.ts scripts/check-prerender.mjs test/guards/legacy-columns.guard.test.ts test/integration/catalogue.test.ts test/integration/content-loaders.test.ts
git commit -m "$(cat <<'EOF'
feat: read the catalogue and the site's content from the content tables through one cache plan

The read layer of phase 6 (spec §6.1, §6.2), with no visible change yet.
lib/server/content/sql.ts holds the language fallback in SQL (spec §5.1
item 5: the default language's row always, another language's when
reviewed, or machine with serve_machine; field by field; no is_enabled
filter, R16) and the media JSON (alt "" for a decorative file).
lib/cache-plan.ts names, for every cached loader, the tables it reads and
the tags it carries, and for every content table the tags a save must
expire; its test holds the two together and checks that every 'use cache'
loader tags through it.

The catalogue (restaurants.queries.ts) reads migration 008: the type line,
cuisine ids, destination_id, the card picture, a phone (the restaurant's,
else its destination's) and a search text folded on the server in the page
language and the default one; published and not archived only. db/queries.ts
goes. site.queries.ts and site.ts load sections, cuisines, destinations,
nav, social links and site settings, one cache entry per tag group, for the
chrome to use next. loadSiteSettings is the one reader of site_settings
(phase-5 deferral T6.8): the notifications screen and the email Reply-To use
it. format.ts holds the server recipes for story dates and offer prices.
A guard test fails on any app SQL that reads a phase-1 column of
restaurants (R10).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Chrome từ DB và việc chuyển giao `site_settings` của đợt 5

Layout `(guarded)` nạp nội dung chrome và đưa cho `SiteProvider`; header, menu, chân trang, thanh đặt bàn và film đọc từ DB. Lưu "Hộp thư chung" làm hết hạn `content:contact`, nên chân trang và `{email}` của trang chính sách đổi ngay (R22). Pixel không đổi; DOM chỉ khác ở hai điểm của R18.

**Files:**
- Create: `e2e/shared-inbox.serial.spec.ts`
- Modify: `playwright.config.ts`, `app/(site)/[lang]/(guarded)/layout.tsx`, `components/site/SiteProvider.tsx`, `components/site/Header.tsx`, `components/overlays/MenuOverlay.tsx`, `components/site/Footer.tsx`, `components/site/Chrome.tsx`, `components/overlays/FilmModal.tsx`, `components/home/Hero.tsx` (nút film), `styles/layout.css`, `app/(site)/[lang]/(guarded)/privacy/page.tsx`, `app/(site)/[lang]/error.tsx`, `app/global-error.tsx`, `lib/booking-errors.ts`, `lib/data.ts` (`FALLBACK_PHONE`), `app/admin/(shell)/settings/notifications/actions.ts`, `app/admin/(shell)/settings/notifications/page.tsx`, `lib/server/email/recipients.ts` (comment), `scripts/check-prerender.mjs`
- Test: `lib/data.test.ts`, `test/integration/content-loaders.test.ts`, `test/integration/content-seed.test.ts`

**Interfaces:**
- Consumes: `getSiteContent(locale)`, `getSiteSettings()` (`lib/server/content/site.ts`), `SiteContent`, `Destination`, `NavItem` (`lib/content/types.ts`), `TAGS.contentContact`.
- Produces:
  - `SiteProvider` nhận `site: SiteContent` (thay `defaultRestaurantId`); context thêm `site: SiteContent` và `destName(id: string): string` (`''` cho id lạ hay tên NULL). Finder bắt đầu với `site.settings.defaultOccasion ?? 'all'`; thanh đặt bàn với `site.settings.defaultRestaurantId`, NULL hoặc không đặt được thì nhà hàng đặt được đầu tiên.
  - `FALLBACK_PHONE = { display: '+84 236 651 9999', tel: '+842366519999' } as const` (`lib/data.ts`, giữ vĩnh viễn, R1); `DEFAULT_PHONE` (`lib/booking-errors.ts`) dựng từ nó.
  - CSS `.hdr-nav .hdr-link { text-transform: uppercase; }` (`styles/layout.css`).
  - `desktop-serial` chạy `workers: 1` (R21).

- [ ] **Bước 1: Viết E2E của hộp thư chung**

Admin lưu một địa chỉ mới; khách tải lại trang chủ và trang chính sách thấy nó ngay; `finally` lưu lại địa chỉ seed qua cùng form (R21: đường trả lại làm hết hạn cùng tag).

Create `e2e/shared-inbox.serial.spec.ts`:

```ts
import type { Browser, Page } from '@playwright/test';
import { HOME_PATH } from './paths';
import { STAFF, expect, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * The shared inbox (site_settings.email) is also the guest site's general
 * email, in the footer and the privacy policy (phase-5 handoff, R22): saving
 * it in "Thông báo email" expires content:contact, so both show the new
 * address at once. It changes where staff.new falls back to
 * (booking-email.spec.ts), so it runs in the desktop-serial project, and it
 * puts the seeded address back through the same form (R21), which expires the
 * same tag.
 */

const SEED = 'fb@furamavietnam.com';
const NEW = 'datban@furama.test';

async function guest(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

async function saveInbox(page: Page, email: string) {
  await page.goto('/admin/settings/notifications');
  const form = page.getByRole('form', { name: 'Hộp thư chung' });
  await form.getByLabel('Email hộp thư chung', { exact: true }).fill(email);
  await form.getByRole('button', { name: 'Lưu hộp thư chung' }).click();
  await expect(page.getByRole('form', { name: 'Hộp thư chung' }).getByRole('status')).toHaveText('Đã lưu.');
}

test.beforeAll(() => seedStaff());

test('saving the shared inbox changes the footer and the privacy policy at once', async ({ page, browser }) => {
  const visitor = await guest(browser);
  await visitor.goto(HOME_PATH);
  await expect(visitor.locator('footer a[href^="mailto:"]')).toHaveText(SEED);

  await signInAs(page, STAFF.admin);
  try {
    await saveInbox(page, NEW);

    await visitor.reload();
    await expect(visitor.locator('footer a[href^="mailto:"]')).toHaveText(NEW);
    await expect(visitor.locator('footer a[href^="mailto:"]')).toHaveAttribute('href', `mailto:${NEW}`);
    await visitor.goto('/en/privacy');
    await expect(visitor.locator('article.legal a[href^="mailto:"]').first()).toHaveText(NEW);
  } finally {
    await saveInbox(page, SEED);
  }
  await visitor.goto(HOME_PATH);
  await expect(visitor.locator('footer a[href^="mailto:"]')).toHaveText(SEED);
  await visitor.context().close();
});
```

- [ ] **Bước 2: Build code hiện tại và chạy E2E mới: phải đỏ**

Reset DB E2E, build (lệnh của cổng kiểm tra), rồi chạy riêng file này, không kéo project `desktop` (`--no-deps`):

```bash
rm -f "${TMPDIR:-/tmp}/furama-e2e-emails.ndjson"
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson CRON_SECRET=$(openssl rand -hex 16) E2E_PORT=3210 npx playwright test --retries=0 e2e/shared-inbox.serial.spec.ts --project=desktop-serial --no-deps
```

Expected: `1 failed` (chân trang còn đọc `CONTACT.email`):

```
  ✘  1 [desktop-serial] › e2e/shared-inbox.serial.spec.ts:34:5 › saving the shared inbox changes the footer and the privacy policy at once (6.2s)
    Error: expect(locator).toHaveText(expected) failed
    Locator:  locator('footer a[href^="mailto:"]')
    Expected: "datban@furama.test"
    Received: "fb@furamavietnam.com"
    > 44 |     await expect(visitor.locator('footer a[href^="mailto:"]')).toHaveText(NEW);
```

(`finally` đã lưu lại `fb@furamavietnam.com`.)

- [ ] **Bước 3: Viết test của số dự phòng**

`FALLBACK_PHONE` là hằng code có chủ ý (trang lỗi render khi DB không đọc được, spec §12), nên một test ghim nó bằng số của điểm đến resort trong DB.

Sửa `lib/data.test.ts`:

```diff
diff --git a/lib/data.test.ts b/lib/data.test.ts
index e95e00f..e78e690 100644
--- a/lib/data.test.ts
+++ b/lib/data.test.ts
@@ -1,5 +1,5 @@
 import { describe, expect, it } from 'vitest';
-import { CONTACT, CUISINES, MEALS, MEAL_LABELS, contactFor, cuisineLabel, cuisineSlug } from './data';
+import { CONTACT, CUISINES, FALLBACK_PHONE, MEALS, MEAL_LABELS, contactFor, cuisineLabel, cuisineSlug } from './data';
 
 describe('cuisine keys', () => {
   it('turns every label into its slug and back', () => {
@@ -25,6 +25,13 @@ describe('meal labels', () => {
   });
 });
 
+describe('FALLBACK_PHONE', () => {
+  it('is a dialable E.164 number, printed with the spaces the footer prints', () => {
+    expect(FALLBACK_PHONE.tel).toMatch(/^\+[1-9][0-9]{6,14}$/);
+    expect(FALLBACK_PHONE.display.replace(/ /g, '')).toBe(FALLBACK_PHONE.tel);
+  });
+});
+
 describe('contactFor', () => {
   it('gives the resort its phone and map, the dining house its phone only, and hides both elsewhere', () => {
     expect(contactFor('resort')).toEqual({ tel: CONTACT.resortPhone, map: CONTACT.map });
```

Sửa `test/integration/content-loaders.test.ts`:

```diff
diff --git a/test/integration/content-loaders.test.ts b/test/integration/content-loaders.test.ts
index f215830..c638a57 100644
--- a/test/integration/content-loaders.test.ts
+++ b/test/integration/content-loaders.test.ts
@@ -1,5 +1,6 @@
 import { afterAll, afterEach, describe, expect, it } from 'vitest';
 import { getPool } from '@/db/client';
+import { FALLBACK_PHONE } from '@/lib/data';
 import { loadSiteSettings } from '@/lib/server/content/settings.queries';
 import { loadCuisines, loadDestinations, loadNav, loadSections, loadSocials } from '@/lib/server/content/site.queries';
 import {
@@ -53,6 +54,8 @@ describe.skipIf(!process.env.TEST_DATABASE_URL)('content loaders (database)', ()
         DESTINATIONS_AT_8FE98F5.flatMap((d) => (d.footer ? [d.footer] : [])),
       );
       expect(ds.filter((d) => d.showInFooter).map((d) => d.phone?.tel)).toEqual(['+842366519999', '+84859555759']);
+      // The error pages print FALLBACK_PHONE without asking the database (spec §12): it is the resort's number.
+      expect(ds.find((d) => d.id === 'resort')?.phone).toEqual({ tel: FALLBACK_PHONE.tel, display: FALLBACK_PHONE.display });
     });
 
     it('nav: the header’s targets with the menu’s labels, stored once in natural case', async () => {
```

- [ ] **Bước 4: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/data.test.ts test/integration/content-loaders.test.ts`
Expected: FAIL `Test Files  2 failed (2)`, `Tests  2 failed | 16 passed (18)`:

```
       × destinations: the four cards, the dropdown names and the footer lines 7ms
     × is a dialable E.164 number, printed with the spaces the footer prints 1ms
 FAIL  lib/data.test.ts > FALLBACK_PHONE > is a dialable E.164 number, printed with the spaces the footer prints
TypeError: Cannot read properties of undefined (reading 'tel')
 FAIL  test/integration/content-loaders.test.ts > content loaders (database) > the seed is the content of phase 5 > destinations: the four cards, the dropdown names and the footer lines
TypeError: Cannot read properties of undefined (reading 'tel')
```

- [ ] **Bước 5: Layout và `SiteProvider` nhận nội dung chrome**

Sửa `app/(site)/[lang]/(guarded)/layout.tsx`:

```diff
diff --git a/app/(site)/[lang]/(guarded)/layout.tsx b/app/(site)/[lang]/(guarded)/layout.tsx
index e526408..be9ee53 100644
--- a/app/(site)/[lang]/(guarded)/layout.tsx
+++ b/app/(site)/[lang]/(guarded)/layout.tsx
@@ -1,9 +1,9 @@
 import { notFound } from 'next/navigation';
 import { lang } from 'next/root-params';
-import { DEFAULT_RESTAURANT_ID } from '@/lib/data';
 import { CLIENT_KEYS } from '@/lib/i18n/registry';
 import { getEnabledLocales } from '@/lib/server/content/locales';
 import { getRestaurants } from '@/lib/server/content/restaurants';
+import { getSiteContent } from '@/lib/server/content/site';
 import { getStrings } from '@/lib/server/content/strings';
 import { SiteProvider } from '@/components/site/SiteProvider';
 import { Chrome } from '@/components/site/Chrome';
@@ -12,23 +12,24 @@ import { Chrome } from '@/components/site/Chrome';
  * Every guest page sits below this layout. It checks the language against the
  * locales table, so notFound() renders [lang]/not-found.tsx with a real 404 (and
  * that cached 404 carries the `locales` tag, so enabling the language clears
- * it), and it reads the catalogue and the UI strings, so a database failure
- * renders [lang]/error.tsx. In the root layout neither could be caught.
+ * it), and it reads the catalogue, the chrome's content (lib/server/content/
+ * site.ts: nav, footer, cuisines, destinations, sections, site settings) and
+ * the UI strings, so a database failure renders [lang]/error.tsx. In the root
+ * layout neither could be caught.
  */
 export default async function GuardedLayout({ children }: { children: React.ReactNode }) {
   const locale = await lang();
   const enabled = await getEnabledLocales();
   // `locale` is string | undefined since app/admin added a second root layout (next-root-params.md:286-313).
   if (!locale || !enabled.some((l) => l.code === locale)) notFound();
-  const [restaurants, strings] = await Promise.all([getRestaurants(locale), getStrings(locale, CLIENT_KEYS)]);
+  const [restaurants, site, strings] = await Promise.all([
+    getRestaurants(locale),
+    getSiteContent(locale),
+    getStrings(locale, CLIENT_KEYS),
+  ]);
 
   return (
-    <SiteProvider
-      locale={locale}
-      restaurants={restaurants}
-      defaultRestaurantId={DEFAULT_RESTAURANT_ID}
-      strings={strings}
-    >
+    <SiteProvider locale={locale} restaurants={restaurants} site={site} strings={strings}>
       <Chrome>{children}</Chrome>
     </SiteProvider>
   );
```

Sửa `components/site/SiteProvider.tsx`:

```diff
diff --git a/components/site/SiteProvider.tsx b/components/site/SiteProvider.tsx
index a7574a4..57a1d33 100644
--- a/components/site/SiteProvider.tsx
+++ b/components/site/SiteProvider.tsx
@@ -10,6 +10,7 @@ import {
   useRef,
   useState,
 } from 'react';
+import type { SiteContent } from '@/lib/content/types';
 import type { DestKey, Restaurant } from '@/lib/data';
 import { findRestaurant, validate, type Booking, type BookingForm } from '@/lib/booking';
 import {
@@ -92,6 +93,10 @@ type SiteState = {
   /** The URL locale code (`en`). */
   locale: string;
   restaurants: Restaurant[];
+  /** The chrome's content in this language (cuisines, destinations, nav, socials, sections, settings). */
+  site: SiteContent;
+  /** A destination's name in this language ('' for an unknown id or a teaser without one). */
+  destName: (id: string) => string;
   /** Which page is showing; 'home' until the first <ViewMarker> registers. */
   view: View;
   /** The visible page's <main>; DOM queries search inside it. */
@@ -218,14 +223,14 @@ export function useSite(): SiteState {
 export function SiteProvider({
   locale,
   restaurants,
-  defaultRestaurantId,
+  site,
   strings,
   children,
 }: {
   locale: string;
   restaurants: Restaurant[];
-  /** The restaurant the booking bar starts on (DEFAULT_RESTAURANT_ID until phase 6). */
-  defaultRestaurantId: string;
+  /** The chrome's content (lib/server/content/site.ts), resolved on the server for this language. */
+  site: SiteContent;
   /** The booking.* and error.* copy for this language, resolved on the server (DB override, else registry). */
   strings: ClientStrings;
   children: React.ReactNode;
@@ -249,7 +254,8 @@ export function SiteProvider({
   const [finder, setFinderState] = useState<Finder>({
     location: 'Da Nang',
     cuisine: 'all',
-    occasion: 'Dinner',
+    // site_settings.default_occasion; NULL: any occasion.
+    occasion: site.settings.defaultOccasion ?? 'all',
     destination: 'all',
   });
   const [filter, setFilterState] = useState<Filter>({
@@ -258,9 +264,11 @@ export function SiteProvider({
     destination: 'all',
   });
   const bookable = useMemo(() => bookableRestaurants(restaurants), [restaurants]);
+  const destNames = useMemo(() => new Map(site.destinations.map((d) => [d.id, d.name ?? ''])), [site.destinations]);
+  const destName = useCallback((id: string) => destNames.get(id) ?? '', [destNames]);
   const [booking, setBookingState] = useState<Booking>(() => {
-    // Spec §5.2 site_settings.default_restaurant_id: the first bookable restaurant when that one is not.
-    const first = bookable.find((r) => r.id === defaultRestaurantId) ?? bookable[0];
+    // Spec §5.2 site_settings.default_restaurant_id: the first bookable restaurant when that one is not (or is NULL).
+    const first = bookable.find((r) => r.id === site.settings.defaultRestaurantId) ?? bookable[0];
     return { destination: first?.dest ?? 'resort', restaurant: first?.id ?? '', date: '', time: '19:00', guests: 2 };
   });
   const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
@@ -784,6 +792,8 @@ export function SiteProvider({
     () => ({
       locale,
       restaurants,
+      site,
+      destName,
       view,
       pageRoot,
       showPage,
@@ -849,10 +859,10 @@ export function SiteProvider({
     }),
     [
       applyFinder, booked, booking, bookable, chosenBoard, clearFilters, close, closeDrawer, closeDropdown,
-      confirmedDate, consent, dateMoved, days, done, errors, failureNudge, filter, finder, footLoading, form, goBackToRestaurants,
+      confirmedDate, consent, dateMoved, days, destName, done, errors, failureNudge, filter, finder, footLoading, form, goBackToRestaurants,
       goHomeTop, groupPhone, honeypot, invalidNudge, lang, loadFailed, locale, matches, maxParty, now, open, openDropdown, openReserve,
       openRestaurant, overlay, pageRoot, pending, pickCuisine, pickDestination, query, reference, restaurants,
-      retryAvailability, scrollToId, scrolled, serverError, setBooking, setFilter, setFinder, setFormField, showPage, shownCount,
+      retryAvailability, scrollToId, scrolled, serverError, setBooking, setFilter, setFinder, setFormField, showPage, shownCount, site,
       strings, submit, tab, today, toggleDropdown, tried, view,
     ],
   );
```

- [ ] **Bước 6: Header và menu từ `nav_items`, viết hoa bằng CSS**

Nhãn lưu một lần theo chữ thường tự nhiên ("Restaurants"); header in hoa bằng CSS, menu in như đã viết; `MENU_LABELS` bỏ (spec §6.3 mục 6, R18).

Sửa `components/site/Header.tsx`:

```diff
diff --git a/components/site/Header.tsx b/components/site/Header.tsx
index 6efb9ad..702f241 100644
--- a/components/site/Header.tsx
+++ b/components/site/Header.tsx
@@ -1,6 +1,5 @@
 'use client';
 
-import { NAV_LINKS } from '@/lib/data';
 import { useSite } from '@/components/site/SiteProvider';
 import { homeHref } from '@/lib/i18n/href';
 
@@ -12,6 +11,7 @@ const LANGS: { value: 'EN' | 'VI'; label: string }[] = [
 export function Header() {
   const {
     locale,
+    site,
     scrolled,
     open,
     openReserve,
@@ -46,8 +46,9 @@ export function Header() {
             <span className="hdr-logo-sub">CUISINE</span>
           </a>
 
+          {/* nav_item_i18n holds one label per language as written ("Restaurants"); styles/layout.css sets it in capitals here. */}
           <nav className="hdr-nav" aria-label="Main">
-            {NAV_LINKS.map((l) => (
+            {site.nav.map((l) => (
               <button type="button" key={l.target} className="hdr-link" onClick={() => scrollToId(l.target)}>
                 {l.label}
               </button>
```

Sửa `components/overlays/MenuOverlay.tsx`:

```diff
diff --git a/components/overlays/MenuOverlay.tsx b/components/overlays/MenuOverlay.tsx
index 4823620..bdc4427 100644
--- a/components/overlays/MenuOverlay.tsx
+++ b/components/overlays/MenuOverlay.tsx
@@ -1,20 +1,10 @@
 'use client';
 
-import { NAV_LINKS } from '@/lib/data';
 import { useSite } from '@/components/site/SiteProvider';
 import { useOpenAnimation } from '@/lib/motion';
 
-const MENU_LABELS: Record<string, string> = {
-  restaurants: 'Restaurants',
-  destinations: 'Destinations',
-  experiences: 'Experiences',
-  offers: 'Offers',
-  stories: 'Stories',
-  heritage: 'About',
-};
-
 export function MenuOverlay() {
-  const { overlay, close, open, scrollToId, openReserve, lang, setLang } = useSite();
+  const { site, overlay, close, open, scrollToId, openReserve, lang, setLang } = useSite();
   const isOpen = overlay === 'menu';
 
   useOpenAnimation(isOpen, (animate) => {
@@ -41,7 +31,8 @@ export function MenuOverlay() {
       </div>
 
       <nav className="menu-nav" aria-label="Sections">
-        {NAV_LINKS.map((l) => (
+        {/* The header's links, as written (the header uppercases them; this list does not). */}
+        {site.nav.map((l) => (
           <button
             key={l.target}
             type="button"
@@ -49,7 +40,7 @@ export function MenuOverlay() {
             className="menu-item"
             onClick={() => scrollToId(l.target)}
           >
-            {MENU_LABELS[l.target]}
+            {l.label}
             <span className="menu-arrow" aria-hidden="true">
               →
             </span>
```

Sửa `styles/layout.css`:

```diff
diff --git a/styles/layout.css b/styles/layout.css
index dc92bd4..1a79f8e 100644
--- a/styles/layout.css
+++ b/styles/layout.css
@@ -155,6 +155,11 @@ html:not([data-view]):has(main[data-view='other']) .hdr-full {
   transition: color 0.25s, background-size 0.45s var(--ease-soft);
 }
 
+/* nav_item_i18n stores one label as written ("Restaurants"); the header sets it in capitals (spec §6.3 item 6, R18). */
+.hdr-nav .hdr-link {
+  text-transform: uppercase;
+}
+
 .hdr-link:hover {
   color: var(--gold);
   background-size: 100% 1px;
```

- [ ] **Bước 7: Chân trang, thanh đặt bàn, film**

Dòng địa chỉ in thành một nút chữ `"${name} · ${address} · "` rồi link số (cùng pixel với JSX cũ, chỉ khác nút ngăn chữ của React); Dining House gọi số E.164 (R18). Nhãn mạng xã hội là thương hiệu, do code giữ.

Sửa `components/site/Footer.tsx`:

```diff
diff --git a/components/site/Footer.tsx b/components/site/Footer.tsx
index 90ceb1d..8209f3d 100644
--- a/components/site/Footer.tsx
+++ b/components/site/Footer.tsx
@@ -1,15 +1,31 @@
 'use client';
 
 import Link from 'next/link';
-import { CONTACT, SOCIALS } from '@/lib/data';
 import { privacyHref } from '@/lib/legal';
 import { useSite } from '@/components/site/SiteProvider';
 import { homeHref } from '@/lib/i18n/href';
 import { useReveal } from '@/lib/motion';
 
+/** A platform's name as the footer prints it: a brand, so code holds it, untranslated (social_links.platform). */
+const SOCIAL_LABELS: Record<string, string> = {
+  facebook: 'FACEBOOK',
+  instagram: 'INSTAGRAM',
+  youtube: 'YOUTUBE',
+  tiktok: 'TIKTOK',
+  zalo: 'ZALO',
+  x: 'X',
+  tripadvisor: 'TRIPADVISOR',
+  wechat: 'WECHAT',
+  kakao: 'KAKAOTALK',
+  line: 'LINE',
+};
+
 export function Footer() {
-  const { goHomeTop, locale, strings } = useSite();
+  const { goHomeTop, locale, site, strings } = useSite();
   const reveal = useReveal<HTMLDivElement>('fade');
+  // The destinations staff mark for the footer, each as "name · address · phone" (destinations.show_in_footer).
+  const venues = site.destinations.filter((d) => d.showInFooter);
+  const email = site.settings.email;
 
   return (
     <footer className="footer">
@@ -26,9 +42,9 @@ export function Footer() {
         </a>
         <div className="footer-tagline">PEOPLE | CULTURE | GREAT FOOD</div>
         <div className="footer-socials">
-          {SOCIALS.map((s) => (
-            <a key={s.label} href={s.href} target="_blank" rel="noopener" className="footer-social">
-              {s.label}
+          {site.socials.map((s) => (
+            <a key={s.platform + s.href} href={s.href} target="_blank" rel="noopener" className="footer-social">
+              {SOCIAL_LABELS[s.platform] ?? s.platform.toUpperCase()}
             </a>
           ))}
         </div>
@@ -37,20 +53,21 @@ export function Footer() {
 
       <div className="shell footer-bottom-wrap">
         <div className="footer-bottom">
-          <span>
-            Furama Resort Danang · 103–105 Võ Nguyên Giáp, Ngũ Hành Sơn, Đà Nẵng ·{' '}
-            <a href={`tel:${CONTACT.resortPhone}`} className="footer-strong">
-              {CONTACT.resortPhoneLabel}
-            </a>
-          </span>
-          <span>
-            Furama Dining House · 73 Trần Bạch Đằng, An Thượng ·{' '}
-            <a href={`tel:${CONTACT.diningHousePhone}`} className="footer-strong">
-              {CONTACT.diningHousePhoneLabel}
-            </a>
-          </span>
-          <a href={`mailto:${CONTACT.email}`} className="footer-strong">
-            {CONTACT.email}
+          {venues.map((d) => {
+            const line = [d.name, d.address].filter(Boolean).join(' · ');
+            return (
+              <span key={d.id}>
+                {d.phone ? `${line} · ` : line}
+                {d.phone && (
+                  <a href={`tel:${d.phone.tel}`} className="footer-strong">
+                    {d.phone.display}
+                  </a>
+                )}
+              </span>
+            );
+          })}
+          <a href={`mailto:${email}`} className="footer-strong">
+            {email}
           </a>
           {/* e2e/visual-added.css hides this link, so the pre-phase-5 baselines still compare pixel for pixel. */}
           <Link href={privacyHref(locale)} className="footer-strong footer-legal">
```

Sửa `components/site/Chrome.tsx`:

```diff
diff --git a/components/site/Chrome.tsx b/components/site/Chrome.tsx
index e9c9823..f22a9b2 100644
--- a/components/site/Chrome.tsx
+++ b/components/site/Chrome.tsx
@@ -19,7 +19,7 @@ import { useScrollMotion } from '@/lib/motion';
  * survive navigation between the home and restaurant views.
  */
 export function Chrome({ children }: { children: React.ReactNode }) {
-  const { overlay, pageRoot } = useSite();
+  const { site, overlay, pageRoot } = useSite();
 
   useScrollMotion(overlay !== null, pageRoot);
 
@@ -32,10 +32,12 @@ export function Chrome({ children }: { children: React.ReactNode }) {
       <div className="page">
         {children}
 
-        {/* The phone detail view hands reservations to its bottom bar instead (styles/booking.css). */}
-        <div className="booking-slot">
-          <BookingBar />
-        </div>
+        {/* The phone detail view hands reservations to its bottom bar instead (styles/booking.css). Staff can switch it off (sections.booking_bar). */}
+        {site.sections.booking_bar.visible && (
+          <div className="booking-slot">
+            <BookingBar />
+          </div>
+        )}
 
         <Footer />
       </div>
```

Sửa `components/overlays/FilmModal.tsx`:

```diff
diff --git a/components/overlays/FilmModal.tsx b/components/overlays/FilmModal.tsx
index 9b13672..d8f2b85 100644
--- a/components/overlays/FilmModal.tsx
+++ b/components/overlays/FilmModal.tsx
@@ -4,8 +4,11 @@ import { useSite } from '@/components/site/SiteProvider';
 import { useOpenAnimation } from '@/lib/motion';
 
 export function FilmModal() {
-  const { overlay, close } = useSite();
-  const open = overlay === 'film';
+  const { site, overlay, close } = useSite();
+  // The poster is the film section's picture, decorative here whatever its alt (the dialog is named); the
+  // video itself (sections.link_url, YouTube or Vimeo) is phase 7's embed. Switched off, the hero hides WATCH THE FILM.
+  const poster = site.sections.film.image;
+  const open = overlay === 'film' && site.sections.film.visible;
 
   useOpenAnimation(open, (animate) => {
     animate(
@@ -25,7 +28,7 @@ export function FilmModal() {
       </button>
 
       <div data-anim="film" className="film-frame">
-        <img src="/assets/hero-beach.jpg" alt="" className="fill" />
+        {poster && <img src={poster.url} alt="" className="fill" />}
         <div className="film-overlay">
           <span className="film-play">
             <span className="film-play-tri" />
```

Sửa `components/home/Hero.tsx` (chỉ nút WATCH THE FILM; Task 6 làm phần còn lại):

```diff
diff --git a/components/home/Hero.tsx b/components/home/Hero.tsx
index 330012b..bcd4948 100644
--- a/components/home/Hero.tsx
+++ b/components/home/Hero.tsx
@@ -12,7 +12,7 @@ import { readMotionLevel } from '@/lib/motion';
  * #top anchor instead of duplicating the section per breakpoint.
  */
 export function Hero() {
-  const { open, overlay, scrollToId } = useSite();
+  const { site, open, overlay, scrollToId } = useSite();
   const [slide, setSlide] = useState(0);
   const count = HERO_SLIDES.length;
 
@@ -94,12 +94,14 @@ export function Hero() {
               EXPLORE OUR RESTAURANTS<span className="hero-arrow">→</span>
             </button>
 
-            <button type="button" className="hero-film" onClick={() => open('film')}>
-              <span className="hero-play">
-                <span className="hero-play-tri" />
-              </span>
-              WATCH THE FILM
-            </button>
+            {site.sections.film.visible && (
+              <button type="button" className="hero-film" onClick={() => open('film')}>
+                <span className="hero-play">
+                  <span className="hero-play-tri" />
+                </span>
+                WATCH THE FILM
+              </button>
+            )}
 
             <button type="button" className="hero-find" onClick={() => open('sheet')}>
               FIND A RESTAURANT<span>→</span>
```

- [ ] **Bước 8: `{email}` của trang chính sách và số dự phòng**

Sửa `app/(site)/[lang]/(guarded)/privacy/page.tsx`:

```diff
diff --git a/app/(site)/[lang]/(guarded)/privacy/page.tsx b/app/(site)/[lang]/(guarded)/privacy/page.tsx
index 7eecb11..2125a0b 100644
--- a/app/(site)/[lang]/(guarded)/privacy/page.tsx
+++ b/app/(site)/[lang]/(guarded)/privacy/page.tsx
@@ -1,17 +1,19 @@
 import type { Metadata } from 'next';
 import { lang } from 'next/root-params';
 import { ViewMarker } from '@/components/site/ViewMarker';
-import { CONTACT } from '@/lib/data';
 import { formatMessage } from '@/lib/i18n/format';
 import { DEFAULT_LOCALE, toBcp47 } from '@/lib/i18n/locales';
 import { PRIVACY_POLICY_VERSION, PRIVACY_SECTIONS } from '@/lib/legal';
 import { getPrivacyStrings } from '@/lib/server/content/legal';
+import { getSiteSettings } from '@/lib/server/content/site';
 
 /*
  * The guest privacy policy (spec §11, Law 91/2025/QH15), linked from the
  * reserve drawer's consent box and the footer. Text from legal.* (registry
- * now, content_strings from phase 7). Prerendered and cached like every guest
- * page: the (guarded) layout has already checked the language.
+ * now, content_strings from phase 7); {email} is the shared inbox
+ * (site_settings.email, tagged content:contact), the address the footer
+ * shows. Prerendered and cached like every guest page: the (guarded) layout
+ * has already checked the language.
  */
 
 async function strings() {
@@ -31,21 +33,21 @@ export async function generateMetadata(): Promise<Metadata> {
 }
 
 /** A body whose {email} becomes a mailto link. */
-function WithEmail({ template }: { template: string }) {
+function WithEmail({ template, email }: { template: string; email: string }) {
   const parts = template.split('{email}');
   if (parts.length < 2) return <>{template}</>;
   return (
     <>
       {parts[0]}
-      <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
-      {parts.slice(1).join(CONTACT.email)}
+      <a href={`mailto:${email}`}>{email}</a>
+      {parts.slice(1).join(email)}
     </>
   );
 }
 
 export default async function PrivacyPage() {
   const locale = (await lang()) ?? DEFAULT_LOCALE;
-  const t = await getPrivacyStrings(locale);
+  const [t, settings] = await Promise.all([getPrivacyStrings(locale), getSiteSettings()]);
   // A calendar date: format it in UTC so the server's zone cannot move it. English reads day first, as the
   // booking form does ("Thu, 1 Oct"); other languages take their own order (phase 8).
   const updated = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : toBcp47(locale), {
@@ -65,7 +67,7 @@ export default async function PrivacyPage() {
           <section key={heading}>
             <h2>{t[heading]}</h2>
             <p>
-              <WithEmail template={t[body]} />
+              <WithEmail template={t[body]} email={settings.email} />
             </p>
           </section>
         ))}
```

Sửa `lib/data.ts`:

```diff
diff --git a/lib/data.ts b/lib/data.ts
index 80e4051..b41c7f5 100644
--- a/lib/data.ts
+++ b/lib/data.ts
@@ -236,5 +236,14 @@ export const SOCIALS = [
   { label: 'TIKTOK', href: 'https://www.tiktok.com/@furama.dining.hous' },
 ];
 
+/**
+ * The number the error pages print, and the one a booking failure names
+ * before the chosen restaurant's own has arrived (DEFAULT_PHONE). A code
+ * constant on purpose, kept when the content constants go (R1): those pages
+ * render when the database cannot be read (spec §12), so they cannot ask it.
+ * The resort destination's number (migration 004); a test holds the two equal.
+ */
+export const FALLBACK_PHONE = { display: '+84 236 651 9999', tel: '+842366519999' } as const;
+
 export const restaurantImage = (id: string) => `/assets/r-${id}.jpg`;
 export const cuisineImage = (slug: string) => `/assets/cuisine-${slug}.jpg`;
```

Sửa `app/(site)/[lang]/error.tsx`:

```diff
diff --git a/app/(site)/[lang]/error.tsx b/app/(site)/[lang]/error.tsx
index b89046a..ee642ef 100644
--- a/app/(site)/[lang]/error.tsx
+++ b/app/(site)/[lang]/error.tsx
@@ -1,7 +1,7 @@
 'use client';
 
 import { useEffect } from 'react';
-import { CONTACT } from '@/lib/data';
+import { FALLBACK_PHONE } from '@/lib/data';
 
 /*
  * A guest page failed to render, for example a request-time render while the
@@ -18,7 +18,7 @@ export default function SiteError({ error, retry }: { error: Error & { digest?:
     <main className="shell" style={{ padding: '160px 0 120px', textAlign: 'center' }}>
       <h1>We could not load this page.</h1>
       <p>
-        Please try again, or call us to book: <a href={`tel:${CONTACT.resortPhone}`}>{CONTACT.resortPhoneLabel}</a>
+        Please try again, or call us to book: <a href={`tel:${FALLBACK_PHONE.tel}`}>{FALLBACK_PHONE.display}</a>
       </p>
       <button type="button" className="btn-slab" onClick={() => retry()}>
         TRY AGAIN
```

Sửa `app/global-error.tsx`:

```diff
diff --git a/app/global-error.tsx b/app/global-error.tsx
index d148f86..05ef460 100644
--- a/app/global-error.tsx
+++ b/app/global-error.tsx
@@ -1,6 +1,6 @@
 'use client';
 
-import { CONTACT } from '@/lib/data';
+import { FALLBACK_PHONE } from '@/lib/data';
 import './globals.css';
 
 /*
@@ -17,7 +17,7 @@ export default function GlobalError({ retry }: { error: Error & { digest?: strin
           <h1>We could not load this page.</h1>
           <p>
             Please try again, or call us to book:{' '}
-            <a href={`tel:${CONTACT.resortPhone}`}>{CONTACT.resortPhoneLabel}</a>
+            <a href={`tel:${FALLBACK_PHONE.tel}`}>{FALLBACK_PHONE.display}</a>
           </p>
           <button type="button" className="btn-slab" onClick={() => retry()}>
             TRY AGAIN
```

Sửa `lib/booking-errors.ts`:

```diff
diff --git a/lib/booking-errors.ts b/lib/booking-errors.ts
index aa2d295..318c8a0 100644
--- a/lib/booking-errors.ts
+++ b/lib/booking-errors.ts
@@ -4,7 +4,7 @@
  * registry (lib/i18n/registry.ts) as error.<code>, so the DB can override it.
  */
 import { PHONE_DAY_LIMIT, type GroupPhone } from '@/lib/booking/rules';
-import { CONTACT } from '@/lib/data';
+import { FALLBACK_PHONE } from '@/lib/data';
 import { formatMessage } from '@/lib/i18n/format';
 import { REGISTRY } from '@/lib/i18n/registry';
 
@@ -42,7 +42,7 @@ export const DEFAULT_ERROR_STRINGS = Object.fromEntries(
  * The number a failure names when the chosen restaurant's own is not known yet
  * (its availability never arrived): the resort's switchboard.
  */
-export const DEFAULT_PHONE: GroupPhone = { display: CONTACT.resortPhoneLabel, tel: CONTACT.resortPhone };
+export const DEFAULT_PHONE: GroupPhone = { display: FALLBACK_PHONE.display, tel: FALLBACK_PHONE.tel };
 
 /**
  * Used when a message arrives without its params (the server always sends them
```

- [ ] **Bước 9: Lưu hộp thư chung làm hết hạn `content:contact` (R22)**

`updateTag` sau commit, trước `refresh()` (quy tắc action của đợt 3–5); câu ở màn hình nói cho Admin biết web khách đổi theo.

Sửa `app/admin/(shell)/settings/notifications/actions.ts`:

```diff
diff --git a/app/admin/(shell)/settings/notifications/actions.ts b/app/admin/(shell)/settings/notifications/actions.ts
index d1b4bb3..335f494 100644
--- a/app/admin/(shell)/settings/notifications/actions.ts
+++ b/app/admin/(shell)/settings/notifications/actions.ts
@@ -1,7 +1,8 @@
 'use server';
 
-import { refresh } from 'next/cache';
+import { refresh, updateTag } from 'next/cache';
 import { getPool } from '@/db/client';
+import { TAGS } from '@/lib/cache-tags';
 import { RecipientForm, RecipientTarget, SharedInboxForm, TestEmailForm } from '@/lib/admin/notification-schemas';
 import { actionError, type ActionResult } from '@/lib/server/action-result';
 import { auditActor, requirePermission } from '@/lib/server/dal/session';
@@ -13,8 +14,10 @@ import type { EmailDeliveryMode } from '@/lib/server/email/types';
  * "Thông báo email" (spec §7.1: Admin only, settings:update; the CI guard
  * holds this whole file to a permission the Editor lacks). Recipients and the
  * shared inbox save in one transaction with their audit_log row (spec §7.4).
- * Nothing here is cached: the queue reads recipients live when it writes
- * staff.new, so there is no tag to expire; refresh() redraws this page.
+ * Recipients are not cached: the queue reads them live when it writes
+ * staff.new, so there is no tag to expire; refresh() redraws this page. The
+ * shared inbox is also the guest site's general email (footer, privacy page),
+ * cached under content:contact: saveInbox expires that tag after its commit.
  */
 
 const DUPLICATE = { email: ['Địa chỉ này đã nhận thông báo cho cùng phạm vi.'] };
@@ -76,6 +79,8 @@ export async function saveInbox(_prev: ActionResult | null, formData: FormData):
     const input = SharedInboxForm.parse(Object.fromEntries(formData));
     const result = await saveSharedInbox(getPool(), auditActor(staff), input);
     if (!result.ok) return result;
+    // The footer and the privacy page print this address (lib/cache-plan.ts SAVE_TAGS.site_settings).
+    updateTag(TAGS.contentContact);
     refresh();
     return result;
   } catch (err) {
```

Sửa `app/admin/(shell)/settings/notifications/page.tsx`:

```diff
diff --git a/app/admin/(shell)/settings/notifications/page.tsx b/app/admin/(shell)/settings/notifications/page.tsx
index 7a0992e..e93fdd4 100644
--- a/app/admin/(shell)/settings/notifications/page.tsx
+++ b/app/admin/(shell)/settings/notifications/page.tsx
@@ -94,8 +94,8 @@ export default async function NotificationsPage() {
       <section aria-labelledby="notify-inbox-title">
         <h2 id="notify-inbox-title">Hộp thư chung</h2>
         <p className="a-muted">
-          Nhận email “đặt bàn mới” của những nhà hàng chưa có người nhận, và là địa chỉ khách trả lời khi họ bấm Reply. Từ đợt 6 đây cũng là email
-          chung hiện ở chân trang web.
+          Nhận email “đặt bàn mới” của những nhà hàng chưa có người nhận, và là địa chỉ khách trả lời khi họ bấm Reply. Đây cũng là email
+          chung hiện ở chân trang web và trong trang chính sách bảo mật; lưu xong, web khách đổi theo ngay.
         </p>
         <SharedInboxForm email={inbox.email} token={inbox.token} />
       </section>
```

Sửa `lib/server/email/recipients.ts` (comment):

```diff
diff --git a/lib/server/email/recipients.ts b/lib/server/email/recipients.ts
index 0a712b6..a201a0c 100644
--- a/lib/server/email/recipients.ts
+++ b/lib/server/email/recipients.ts
@@ -165,7 +165,11 @@ export async function getSharedInbox(db: Db): Promise<{ email: string; token: st
   return { email: settings.email, token: settings.token };
 }
 
-/** R3: the same address is the general email of the site footer from phase 6/7; the screen says so. */
+/**
+ * R3: the same address is the general email of the site footer and the
+ * privacy page (site_settings, read by the guest site under content:contact):
+ * the action expires that tag after this commits (saveInbox).
+ */
 export async function saveSharedInbox(pool: Pool, actor: AuditActor, input: { email: string; token: string }): Promise<{ ok: true; data: null } | Conflict> {
   return withTransaction(pool, async (client) => {
     const { rows } = await client.query<{ email: string; token: string; updated_by: string | null; updated_at: Date }>(
```

- [ ] **Bước 10: Tag của layout, project serial một worker, chữ component đã đổi nguồn**

Sửa `scripts/check-prerender.mjs`:

```diff
diff --git a/scripts/check-prerender.mjs b/scripts/check-prerender.mjs
index 2c71a41..9f83239 100644
--- a/scripts/check-prerender.mjs
+++ b/scripts/check-prerender.mjs
@@ -32,8 +32,19 @@ const PAGES = {
   '/en/restaurants/taya-house': 'en/restaurants/taya-house',
   '/en/privacy': 'en/privacy',
 };
-/** The (guarded) layout's tags: the catalogue (lib/server/content/restaurants.ts) also reads cuisines, destinations and media. */
-const TAGS = ['restaurants', 'i18n:en', 'locales', 'content:ui', 'content:cuisines', 'content:destinations', 'media'];
+/** The (guarded) layout's tags: the catalogue, the chrome's content (lib/server/content/site.ts) and the UI strings. */
+const TAGS = [
+  'restaurants',
+  'i18n:en',
+  'locales',
+  'content:ui',
+  'content:sections',
+  'content:cuisines',
+  'content:destinations',
+  'content:nav',
+  'content:contact',
+  'media',
+];
 /** Tags a page carries beyond the layout's: the privacy policy's own reader (lib/server/content/legal.ts). */
 const PAGE_TAGS = { '/en/privacy': ['content:legal'] };
 const REVALIDATE = 2_592_000; // cacheLife('max'): 30 days
```

Sửa `playwright.config.ts`:

```diff
diff --git a/playwright.config.ts b/playwright.config.ts
index e4e3c92..3ae84ce 100644
--- a/playwright.config.ts
+++ b/playwright.config.ts
@@ -66,12 +66,14 @@ export default defineConfig({
       testIgnore: [/\/visual[^/]*\.spec\.ts$/, /\.serial\.spec\.ts$/],
       use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } },
     },
-    // Specs that change what every guest page reads (a restaurant's booking switch) run
-    // after all the others (spec files otherwise run in parallel workers).
+    // Specs that change what every guest page reads (a restaurant's booking switch, the
+    // shared inbox) run after all the others, and one file at a time (R21): each puts the
+    // data back at its end, but another serial file must not see the middle.
     {
       name: 'desktop-serial',
       testMatch: /\.serial\.spec\.ts$/,
       dependencies: ['desktop'],
+      workers: 1,
       use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } },
     },
   ],
```

Footer, MenuOverlay, FilmModal và dòng `occasion: 'Dinner'` không còn giữ chữ cũ: bỏ các dòng tương ứng khỏi khối 1 của `test/integration/content-seed.test.ts`:

```diff
diff --git a/test/integration/content-seed.test.ts b/test/integration/content-seed.test.ts
index 1d9bb34..64114ea 100644
--- a/test/integration/content-seed.test.ts
+++ b/test/integration/content-seed.test.ts
@@ -91,22 +91,14 @@ describe('the snapshot is the content of 8fe98f5 (delete with the constants and
     expect(hero).toContain(`srcSet="${HERO_SLIDES_AT_8FE98F5[0].mobile}"`);
     expect(hero).toContain(`alt="${HERO_SLIDES_AT_8FE98F5[0].alt}"`);
     expect(hero).toContain(`}, ${HERO_AUTOPLAY_MS_AT_8FE98F5});`);
-    expect(source('components/site/SiteProvider.tsx')).toContain(`occasion: '${SETTINGS_AT_8FE98F5.defaultOccasion}'`);
     const taya = DETAIL_PAGES_AT_8FE98F5['taya-house'];
     const tayaHero = source('components/detail/TayaHero.tsx');
     expect(tayaHero.split(taya.kicker)).toHaveLength(3); // desktop and phone copies
     expect(tayaHero.split(taya.story)).toHaveLength(3);
     expect(tayaHero).toContain(`<img src="${taya.portrait}" alt="${taya.portraitAlt}"`);
-    const footer = source('components/site/Footer.tsx');
-    for (const d of DESTINATIONS_AT_8FE98F5) {
-      if (d.footer) expect(footer).toContain(d.footer.slice(0, d.footer.lastIndexOf(' · ') + 2));
-    }
-    const menu = source('components/overlays/MenuOverlay.tsx');
-    for (const n of NAV_AT_8FE98F5) expect(menu).toContain(`${n.target}: '${n.menu}'`);
     const experiences = source('components/home/Experiences.tsx');
     expect(experiences).toContain(`src="${SECTIONS_AT_8FE98F5.experiences.image}" alt="${SECTIONS_AT_8FE98F5.experiences.alt}"`);
     expect(source('components/home/Heritage.tsx')).toContain(`src="${SECTIONS_AT_8FE98F5.heritage.image}" alt=""`);
-    expect(source('components/overlays/FilmModal.tsx')).toContain(`src="${SECTIONS_AT_8FE98F5.film.image}" alt=""`);
     // Cuisine, destination and story images are drawn with alt="".
     expect(source('components/home/Cuisines.tsx')).toContain('src={cuisineImage(slug)} alt=""');
     expect(source('components/home/Destinations.tsx')).toContain('src={`/assets/${card.slot}.jpg`} alt=""');
```

- [ ] **Bước 11: Chạy lại test**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/data.test.ts test/integration/content-loaders.test.ts test/integration/content-seed.test.ts`
Expected: PASS `Test Files  3 passed (3)`, `Tests  31 passed (31)`

- [ ] **Bước 12: Chạy cổng kiểm tra, rồi diff DOM**

Expected:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo;
- `Test Files  76 passed (76)`, `Tests  984 passed (984)`;
- `Applied 8 migration(s).`; build thoát 0; check-prerender in `Prerender check passed: /en, /en/restaurants/taya-house, /en/privacy (tags: restaurants, i18n:en, locales, content:ui, content:sections, content:cuisines, content:destinations, content:nav, content:contact, media; /en/privacy also content:legal).`;
- E2E `152 passed`, `1 skipped` (cả `shared-inbox.serial`); visual `8 passed`.

Diff DOM: đây là lần đầu, nên ngay sau lệnh reset DB E2E của cổng kiểm tra (trước E2E) dựng bản gốc `4f67931` bằng ba lệnh của Global Constraints (worktree `${TMPDIR:-/tmp}/fc-base`, ngoài repo) và ghi `${TMPDIR:-/tmp}/fc-dom/normhtml.mjs`; các task sau dùng lại chúng. Ngay sau `npm run build` của cổng, chạy vòng `diff` của Global Constraints: trên `/en`, `/en/restaurants/taya-house` và `/en/privacy`, đúng hai khác biệt của R18, 14 dòng mỗi trang:

```
29,34c29,34
< <button type="button" class="hdr-link">RESTAURANTS</button>
…
< <button type="button" class="hdr-link">ABOUT</button>
---
> <button type="button" class="hdr-link">Restaurants</button>
…
> <button type="button" class="hdr-link">About</button>
645c645
< <span>Furama Dining House · 73 Trần Bạch Đằng, An Thượng · <a href="tel:0859555759" class="footer-strong">0859 555 759</a>
---
> <span>Furama Dining House · 73 Trần Bạch Đằng, An Thượng · <a href="tel:+84859555759" class="footer-strong">0859 555 759</a>
```

(Số dòng `645` là của `/en`; `292` ở trang Tàya, `166` ở trang chính sách.)

- [ ] **Bước 13: Commit**

```bash
git add "app/(site)/[lang]/(guarded)/layout.tsx" "app/(site)/[lang]/(guarded)/privacy/page.tsx" "app/(site)/[lang]/error.tsx" "app/admin/(shell)/settings/notifications/actions.ts" "app/admin/(shell)/settings/notifications/page.tsx" app/global-error.tsx components/home/Hero.tsx components/overlays/FilmModal.tsx components/overlays/MenuOverlay.tsx components/site/Chrome.tsx components/site/Footer.tsx components/site/Header.tsx components/site/SiteProvider.tsx e2e/shared-inbox.serial.spec.ts lib/booking-errors.ts lib/data.test.ts lib/data.ts lib/server/email/recipients.ts playwright.config.ts scripts/check-prerender.mjs styles/layout.css test/integration/content-loaders.test.ts test/integration/content-seed.test.ts
git commit -m "$(cat <<'EOF'
feat: draw the header, menu, footer and booking bar from the database, and refresh the footer when the shared inbox is saved

The (guarded) layout reads the chrome's content (lib/server/content/site.ts)
and hands it to SiteProvider with destName. The header and the menu list
nav_items, stored once in natural case: the header sets them in capitals with
CSS (spec §6.3 item 6; R18), the menu shows them as written. The footer lists
the destinations marked for it (name, address, number dialled in E.164), the
social links and the shared inbox. The booking bar, the film modal and the
hero's WATCH THE FILM follow their sections; the booking bar starts on
site_settings.default_restaurant_id and the finder on default_occasion.

Phase-5 handoff (R22): saveInbox expires content:contact after its commit,
so the footer and the privacy page's {email} (now site_settings.email) show
a new shared inbox at once; the notifications screen says so. The error
pages and DEFAULT_PHONE print FALLBACK_PHONE, a code constant pinned to the
resort's number, since they render without the database. check-prerender
expects the layout's ten tags; the desktop-serial project runs one file at
a time (R21). The page's pixels are unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Người dùng danh mục: thanh ẩm thực, bộ lọc, tìm kiếm, thanh đặt bàn, drawer, thẻ nhà hàng

Mọi component dùng danh mục đọc những gì layout đã nạp từ DB thay vì `lib/data.ts`: ẩm thực và điểm đến theo id, tên theo ngôn ngữ của trang (spec §6.3 mục 2), tìm kiếm theo chữ đã gấp trên server (§6.3 mục 9), ảnh của thẻ và chip qua `CmsImage` (R3). Hành vi và pixel không đổi.

**Files:**
- Create: `lib/content/options.ts`, `lib/content/options.test.ts`, `components/ui/CmsImage.tsx`
- Modify: `components/home/Finder.tsx`, `components/overlays/FinderSheet.tsx`, `components/home/Cuisines.tsx`, `components/home/RestaurantCard.tsx`, `components/home/Restaurants.tsx`, `components/overlays/SearchOverlay.tsx`, `components/booking/BookingBar.tsx`, `components/overlays/ReserveDrawer.tsx`
- Test: `e2e/filters.spec.ts`, `test/integration/content-seed.test.ts`

**Interfaces:**
- Consumes: `site`, `destName` của `useSite()` (Task 4); `Restaurant.image`, `Restaurant.search`, `Restaurant.dest` (Task 3); `Cuisine`, `Destination`, `Media` (`lib/content/types.ts`); `MEALS`, `MEAL_LABELS` (`lib/data.ts`).
- Produces:
  - `lib/content/options.ts`: `cuisineOptions(cuisines: readonly Cuisine[])`, `occasionOptions()`, `destinationOptions(destinations: readonly Destination[])` (chỉ `kind = 'venue'` có tên), `bookableDestinationOptions(destinations, bookable: readonly Pick<Restaurant, 'dest'>[])`; mỗi hàm trả `{ value: string; label: string }[]` (dạng `Option<string>` của `components/ui/Dropdown` nhận). Ba hàm cũ trong `components/home/Finder.tsx` bỏ.
  - `components/ui/CmsImage.tsx`: `CmsImage({ media: Media, decorative?: boolean, ...ImageProps không có src/alt })` = `next/image` với `src = media.url`, `alt = decorative ? '' : media.alt`. Task 6 (thẻ điểm đến, câu chuyện) và Task 7 (điểm nổi bật) dùng.

- [ ] **Bước 1: Viết E2E của tìm kiếm và bộ lọc (lưới giữ hành vi)**

Hai test mới của dàn ý: bỏ dấu và đ; khớp dòng loại, ẩm thực và tên điểm đến như DB gọi chúng; Finder lọc theo id ẩm thực, key bữa và id điểm đến rồi gọi mỗi chip bằng nhãn của nó. Spec viết trước unit test của task: `next build` typecheck cả file test, nên khi `lib/content/options.test.ts` (Bước 3) đã có mà `lib/content/options.ts` chưa, build hỏng.

Sửa `e2e/filters.spec.ts`:

```diff
diff --git a/e2e/filters.spec.ts b/e2e/filters.spec.ts
index 513539c..922d95b 100644
--- a/e2e/filters.spec.ts
+++ b/e2e/filters.spec.ts
@@ -20,3 +20,40 @@ test('search matches a cuisine by its label', async ({ page }) => {
   await expect(page.locator('.search-result')).toHaveCount(2);
   await expect(page.locator('.search-result-name')).toHaveText(['V-Senses Cafe', 'Hải Vân Lounge']);
 });
+
+test('search ignores accents and đ, and matches type, cuisine and destination as the database names them', async ({ page }) => {
+  await page.goto(HOME_PATH);
+  await page.locator('.hdr-full .hdr-link', { hasText: 'SEARCH' }).click();
+  const input = page.getByRole('textbox', { name: 'Search restaurants, cuisines, places' });
+  const names = page.locator('.search-result-name');
+  await input.fill('pho cuon');
+  await expect(names).toHaveText(['Phố Cuốn']);
+  await input.fill('HAI VAN');
+  await expect(names).toHaveText(['Hải Vân Lounge']);
+  // A destination name (destination_i18n), and the meta line under each result.
+  await input.fill('dining house');
+  await expect(names).toHaveText(['Steakhouse The Fan', 'Phố Cuốn', 'Thai Siam Kitchen', 'Hura Izakaya']);
+  await expect(page.locator('.search-result-meta').first()).toHaveText('Steak & Wine · 3F · Furama Dining House');
+  // A type line (restaurant_i18n.type_label), and a cuisine label (cuisine_i18n).
+  await input.fill('food hall');
+  await expect(names).toHaveText(['Yum Food Village']);
+  await input.fill('hotpot');
+  await expect(names).toHaveText(['ChaoShan Hotpot']);
+  await input.fill('zzz');
+  await expect(page.locator('.search-none')).toContainText('No matches for “zzz”');
+});
+
+test('the finder filters by cuisine id, meal and destination id, and names each chip by its label', async ({ page }) => {
+  await page.goto(HOME_PATH);
+  const finder = page.getByRole('region', { name: 'Find a restaurant' });
+  const pick = async (field: string, option: string) => {
+    await finder.getByRole('button', { name: new RegExp(`^${field}`) }).click();
+    await finder.getByRole('listbox', { name: field }).getByRole('option', { name: option, exact: true }).click();
+  };
+  await pick('Cuisine', 'Thai');
+  await pick('Occasion', 'Lunch');
+  await pick('Destination', 'Furama MM Supercenter');
+  await page.getByRole('button', { name: /SHOW RESTAURANTS/ }).click();
+  await expect(page.locator('#restaurant-grid .rcard:visible .rcard-name')).toHaveText(['Yum Food Village']);
+  await expect(page.locator('.filter-chip')).toHaveText([/^Thai/, /^Lunch/, /^Furama MM Supercenter/]);
+});
```

- [ ] **Bước 2: Chạy spec trên build Task 4: phải xanh**

Không cần build lại: spec không vào build, và build mà cổng kiểm tra của Task 4 vừa làm còn trong `.next`. Reset DB E2E (E2E của cổng đã ghi vào nó), rồi:

```bash
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
rm -f "${TMPDIR:-/tmp}/furama-e2e-emails.ndjson"
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson CRON_SECRET=$(openssl rand -hex 16) E2E_PORT=3210 npx playwright test --retries=0 e2e/filters.spec.ts --project=desktop
lsof -ti tcp:3210 | xargs kill
```

Expected: `4 passed`. Hành vi không đổi theo thiết kế; hai test mới giữ hành vi đó khi nguồn đổi ở các bước sau.

- [ ] **Bước 3: Viết test của các danh sách chọn**

Create `lib/content/options.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Cuisine, Destination } from './types';
import { bookableDestinationOptions, cuisineOptions, destinationOptions, occasionOptions } from './options';

const cuisine = (id: string, label: string): Cuisine => ({ id, label, image: null });
const destination = (id: string, kind: Destination['kind'], name: string | null): Destination => ({
  id,
  kind,
  name,
  cardTitle: [name ?? '', ''],
  cardBlurb: ['', ''],
  image: null,
  address: null,
  phone: null,
  map: null,
  showInFooter: false,
});

const DESTINATIONS = [
  destination('resort', 'venue', 'Furama Resort Danang'),
  destination('dining-house', 'venue', 'Furama Dining House'),
  destination('mm', 'venue', 'Furama MM Supercenter'),
  destination('future', 'teaser', null),
];

describe('the finder’s and booking form’s option lists (spec §6.3 item 2)', () => {
  it('cuisines: "All cuisines", then each cuisine by its id, named by its label, in the rail’s order', () => {
    expect(cuisineOptions([cuisine('thai', 'Thai'), cuisine('steak-grill', 'Steak & Grill')])).toEqual([
      { value: 'all', label: 'All cuisines' },
      { value: 'thai', label: 'Thai' },
      { value: 'steak-grill', label: 'Steak & Grill' },
    ]);
  });

  it('occasions: "Any occasion", then the meal keys with their labels', () => {
    expect(occasionOptions().map((o) => o.value)).toEqual(['all', 'Breakfast', 'Lunch', 'Dinner', 'Drinks']);
    expect(occasionOptions()[0]).toEqual({ value: 'all', label: 'Any occasion' });
  });

  it('destinations: the places restaurants are at, by id; a teaser card is not one', () => {
    expect(destinationOptions(DESTINATIONS)).toEqual([
      { value: 'all', label: 'Any destination' },
      { value: 'resort', label: 'Furama Resort Danang' },
      { value: 'dining-house', label: 'Furama Dining House' },
      { value: 'mm', label: 'Furama MM Supercenter' },
    ]);
    // A venue whose name is not written in any language yet has nothing to show in a list.
    expect(destinationOptions([destination('pop-up', 'venue', null)])).toEqual([{ value: 'all', label: 'Any destination' }]);
  });

  it('the booking form: only places with a restaurant that takes bookings online, no "any"', () => {
    expect(bookableDestinationOptions(DESTINATIONS, [{ dest: 'mm' }, { dest: 'resort' }, { dest: 'resort' }])).toEqual([
      { value: 'resort', label: 'Furama Resort Danang' },
      { value: 'mm', label: 'Furama MM Supercenter' },
    ]);
    expect(bookableDestinationOptions(DESTINATIONS, [])).toEqual([]);
  });
});
```

- [ ] **Bước 4: Chạy test, phải đỏ**

Run: `npx vitest run lib/content/options.test.ts`
Expected: FAIL `Test Files  1 failed (1)`, `Tests  no tests`:

```
 FAIL  lib/content/options.test.ts [ lib/content/options.test.ts ]
Error: Cannot find module './options' imported from …/lib/content/options.test.ts
 ❯ lib/content/options.test.ts:3:1
```

- [ ] **Bước 5: Danh sách chọn dùng chung và `CmsImage`**

Create `lib/content/options.ts`:

```ts
import { MEALS, MEAL_LABELS, type Restaurant } from '@/lib/data';
import type { Cuisine, Destination } from './types';

/*
 * The option lists of the finder (desktop dropdowns and the phone sheet) and
 * of the booking bar and drawer, from the content the (guarded) layout loaded
 * (spec §6.3 item 2: a filter's value is the key, its label the text in the
 * page's language). Plain { value, label } pairs, the shape
 * components/ui/Dropdown's Option takes. PHASE 7: the "All …"/"Any …" labels
 * become registry keys (finder.all_cuisines, finder.any_occasion,
 * finder.any_destination).
 */

type Choice = { value: string; label: string };

export const cuisineOptions = (cuisines: readonly Cuisine[]): Choice[] => [
  { value: 'all', label: 'All cuisines' },
  ...cuisines.map((c) => ({ value: c.id, label: c.label })),
];

export const occasionOptions = (): Choice[] => [
  { value: 'all', label: 'Any occasion' },
  ...MEALS.map((m) => ({ value: m, label: MEAL_LABELS[m] })),
];

/** The places restaurants are at: venues with a name (a teaser card such as "Future Locations" is not one). */
const venues = (destinations: readonly Destination[]): Choice[] =>
  destinations.flatMap((d) => (d.kind === 'venue' && d.name ? [{ value: d.id, label: d.name }] : []));

export const destinationOptions = (destinations: readonly Destination[]): Choice[] => [
  { value: 'all', label: 'Any destination' },
  ...venues(destinations),
];

/** The booking form's places: only those with a restaurant that takes bookings online (booking_enabled). */
export const bookableDestinationOptions = (destinations: readonly Destination[], bookable: readonly Pick<Restaurant, 'dest'>[]): Choice[] =>
  venues(destinations).filter((d) => bookable.some((r) => r.dest === d.value));
```

Create `components/ui/CmsImage.tsx`:

```tsx
import Image, { type ImageProps } from 'next/image';
import type { Media } from '@/lib/content/types';

type Props = Omit<ImageProps, 'src' | 'alt'> & {
  media: Media;
  /** alt="" whatever the media row says: the text beside or over the image already names it (decorative by role). */
  decorative?: boolean;
};

/**
 * A content image (spec §6.3 item 7): next/image with the media row's URL and
 * its alt in the page's language (already "" for a decorative file). Sizing
 * props (width/height or fill, sizes) stay the caller's: they belong to the
 * layout, not to the file.
 *
 * Only the images that were next/image before phase 6 use it (R3). The plain
 * <img> ones (hero slides, chef, heritage, the restaurant portrait, the film
 * poster) keep <img> with the media URL: the optimizer would re-encode those
 * files and change pixels the visual baselines pin at ratio 0. Phase 7 moves
 * them when it moves the files to Blob and re-takes the baselines.
 */
export function CmsImage({ media, decorative = false, ...rest }: Props) {
  return <Image src={media.url} alt={decorative ? '' : media.alt} {...rest} />;
}
```

Run: `npx vitest run lib/content/options.test.ts`
Expected: PASS `Tests  4 passed (4)`

- [ ] **Bước 6: Finder và bảng chọn trên điện thoại**

Sửa `components/home/Finder.tsx`:

```diff
diff --git a/components/home/Finder.tsx b/components/home/Finder.tsx
index 6f79e13..2ececfe 100644
--- a/components/home/Finder.tsx
+++ b/components/home/Finder.tsx
@@ -1,27 +1,12 @@
 'use client';
 
-import { CUISINES, DESTS, DEST_KEYS, MEALS, MEAL_LABELS } from '@/lib/data';
+import { cuisineOptions, destinationOptions, occasionOptions } from '@/lib/content/options';
 import { useSite } from '@/components/site/SiteProvider';
-import { Dropdown, type Option } from '@/components/ui/Dropdown';
-
-export const cuisineOptions = (): Option<string>[] => [
-  { value: 'all', label: 'All cuisines' },
-  ...CUISINES.map(([label, slug]) => ({ value: slug, label })),
-];
-
-export const occasionOptions = (): Option<string>[] => [
-  { value: 'all', label: 'Any occasion' },
-  ...MEALS.map((m) => ({ value: m, label: MEAL_LABELS[m] })),
-];
-
-export const destinationOptions = (): Option<string>[] => [
-  { value: 'all', label: 'Any destination' },
-  ...DEST_KEYS.map((k) => ({ value: k, label: DESTS[k] })),
-];
+import { Dropdown } from '@/components/ui/Dropdown';
 
 /** The desktop booking finder that sits under the hero. */
 export function Finder() {
-  const { finder, setFinder, applyFinder } = useSite();
+  const { site, finder, setFinder, applyFinder } = useSite();
 
   return (
     <section className="finder" aria-label="Find a restaurant">
@@ -42,7 +27,7 @@ export function Finder() {
             label="Cuisine"
             value={finder.cuisine}
             onPick={(cuisine) => setFinder({ cuisine })}
-            options={cuisineOptions()}
+            options={cuisineOptions(site.cuisines)}
           />
           <Dropdown
             id="fOccasion"
@@ -56,7 +41,7 @@ export function Finder() {
             label="Destination"
             value={finder.destination}
             onPick={(destination) => setFinder({ destination })}
-            options={destinationOptions()}
+            options={destinationOptions(site.destinations)}
           />
         </div>
 
```

Sửa `components/overlays/FinderSheet.tsx`:

```diff
diff --git a/components/overlays/FinderSheet.tsx b/components/overlays/FinderSheet.tsx
index 5b852af..f7d036a 100644
--- a/components/overlays/FinderSheet.tsx
+++ b/components/overlays/FinderSheet.tsx
@@ -3,11 +3,11 @@
 import { useSite } from '@/components/site/SiteProvider';
 import { ChipGroup } from '@/components/ui/Dropdown';
 import { useOpenAnimation } from '@/lib/motion';
-import { cuisineOptions, destinationOptions, occasionOptions } from '@/components/home/Finder';
+import { cuisineOptions, destinationOptions, occasionOptions } from '@/lib/content/options';
 
 /** The phone equivalent of the desktop finder. */
 export function FinderSheet() {
-  const { overlay, close, finder, setFinder, applyFinder } = useSite();
+  const { site, overlay, close, finder, setFinder, applyFinder } = useSite();
   const open = overlay === 'sheet';
 
   useOpenAnimation(open, (animate) => {
@@ -39,7 +39,7 @@ export function FinderSheet() {
         <ChipGroup
           label="Cuisine"
           value={finder.cuisine}
-          options={cuisineOptions()}
+          options={cuisineOptions(site.cuisines)}
           onPick={(cuisine) => setFinder({ cuisine })}
         />
         <ChipGroup
@@ -51,7 +51,7 @@ export function FinderSheet() {
         <ChipGroup
           label="Destination"
           value={finder.destination}
-          options={destinationOptions()}
+          options={destinationOptions(site.destinations)}
           onPick={(destination) => setFinder({ destination })}
         />
 
```

- [ ] **Bước 7: Thanh ẩm thực, thẻ nhà hàng, chip lọc**

Chip ẩm thực trang trí theo vai trò (nhãn bên cạnh gọi tên nó): `decorative`. Alt của thẻ nhà hàng là alt của ảnh (seed bằng tên nhà hàng, R19).

Sửa `components/home/Cuisines.tsx`:

```diff
diff --git a/components/home/Cuisines.tsx b/components/home/Cuisines.tsx
index 3ff3d97..f4888c2 100644
--- a/components/home/Cuisines.tsx
+++ b/components/home/Cuisines.tsx
@@ -1,12 +1,12 @@
 'use client';
 
-import Image from 'next/image';
-import { CUISINES, cuisineImage } from '@/lib/data';
+import type { Media } from '@/lib/content/types';
+import { CmsImage } from '@/components/ui/CmsImage';
 import { useSite } from '@/components/site/SiteProvider';
 import { useReveal } from '@/lib/motion';
 
 export function Cuisines() {
-  const { filter, pickCuisine, setFilter, scrollToId } = useSite();
+  const { site, filter, pickCuisine, setFilter, scrollToId } = useSite();
   const title = useReveal<HTMLHeadingElement>('title');
   const link = useReveal<HTMLButtonElement>('fade');
 
@@ -32,13 +32,13 @@ export function Cuisines() {
         </div>
 
         <div className="cuisine-rail">
-          {CUISINES.map(([label, slug]) => (
+          {site.cuisines.map((c) => (
             <CuisineChip
-              key={slug}
-              label={label}
-              slug={slug}
-              selected={filter.cuisine === slug}
-              onPick={() => pickCuisine(slug)}
+              key={c.id}
+              label={c.label}
+              image={c.image}
+              selected={filter.cuisine === c.id}
+              onPick={() => pickCuisine(c.id)}
             />
           ))}
         </div>
@@ -49,12 +49,12 @@ export function Cuisines() {
 
 function CuisineChip({
   label,
-  slug,
+  image,
   selected,
   onPick,
 }: {
   label: string;
-  slug: string;
+  image: Media | null;
   selected: boolean;
   onPick: () => void;
 }) {
@@ -70,7 +70,8 @@ function CuisineChip({
       onClick={onPick}
     >
       <span className="cuisine-ring" data-selected={selected}>
-        <Image src={cuisineImage(slug)} alt="" width={80} height={80} className="cuisine-img" />
+        {/* Decorative by role: the label beside it names the cuisine. */}
+        {image && <CmsImage media={image} decorative width={80} height={80} className="cuisine-img" />}
       </span>
       <span className="cuisine-label" data-selected={selected}>
         {label}
```

Sửa `components/home/RestaurantCard.tsx`:

```diff
diff --git a/components/home/RestaurantCard.tsx b/components/home/RestaurantCard.tsx
index d727be2..b614206 100644
--- a/components/home/RestaurantCard.tsx
+++ b/components/home/RestaurantCard.tsx
@@ -1,7 +1,7 @@
 'use client';
 
-import Image from 'next/image';
-import { restaurantImage, type Restaurant } from '@/lib/data';
+import type { Restaurant } from '@/lib/data';
+import { CmsImage } from '@/components/ui/CmsImage';
 import { useSite } from '@/components/site/SiteProvider';
 import { useReveal } from '@/lib/motion';
 
@@ -27,13 +27,15 @@ export function RestaurantCard({ restaurant, hidden }: { restaurant: Restaurant;
     >
       <span className="rcard-frame frame" data-reveal-img="1">
         <span className="rcard-zoom" data-reveal-zoom="1">
-          <Image
-            src={restaurantImage(restaurant.id)}
-            alt={restaurant.name}
-            fill
-            sizes="(max-width: 759px) 50vw, (max-width: 1079px) 33vw, 240px"
-            className="rcard-img"
-          />
+          {/* alt: the card picture's own (media_i18n; seeded as the restaurant's name, R19). */}
+          {restaurant.image && (
+            <CmsImage
+              media={restaurant.image}
+              fill
+              sizes="(max-width: 759px) 50vw, (max-width: 1079px) 33vw, 240px"
+              className="rcard-img"
+            />
+          )}
         </span>
         {tag && <span className="rcard-tag">{tag} →</span>}
       </span>
```

Sửa `components/home/Restaurants.tsx`:

```diff
diff --git a/components/home/Restaurants.tsx b/components/home/Restaurants.tsx
index 05dfa20..4cce618 100644
--- a/components/home/Restaurants.tsx
+++ b/components/home/Restaurants.tsx
@@ -1,25 +1,27 @@
 'use client';
 
-import { DESTS, MEAL_LABELS, cuisineLabel, type DestKey, type Meal } from '@/lib/data';
+import { MEAL_LABELS, type Meal } from '@/lib/data';
 import { useSite } from '@/components/site/SiteProvider';
 import { useReveal } from '@/lib/motion';
 import { RestaurantCard } from './RestaurantCard';
 
 export function Restaurants() {
-  const { restaurants, filter, matches, shownCount, setFilter, clearFilters } = useSite();
+  const { site, destName, restaurants, filter, matches, shownCount, setFilter, clearFilters } = useSite();
   const title = useReveal<HTMLHeadingElement>('title');
   const link = useReveal<HTMLButtonElement>('fade');
 
   const chips: { label: string; clear: () => void }[] = [];
   if (filter.cuisine !== 'all') {
-    chips.push({ label: cuisineLabel(filter.cuisine), clear: () => setFilter({ cuisine: 'all' }) });
+    // A cuisine no longer listed (unpublished since the filter was set) still names itself rather than nothing.
+    const label = site.cuisines.find((c) => c.id === filter.cuisine)?.label ?? filter.cuisine;
+    chips.push({ label, clear: () => setFilter({ cuisine: 'all' }) });
   }
   if (filter.occasion !== 'all') {
     chips.push({ label: MEAL_LABELS[filter.occasion as Meal], clear: () => setFilter({ occasion: 'all' }) });
   }
   if (filter.destination !== 'all') {
     chips.push({
-      label: DESTS[filter.destination as DestKey],
+      label: destName(filter.destination),
       clear: () => setFilter({ destination: 'all' }),
     });
   }
```

- [ ] **Bước 8: Tìm kiếm, thanh đặt bàn, drawer**

Sửa `components/overlays/SearchOverlay.tsx`:

```diff
diff --git a/components/overlays/SearchOverlay.tsx b/components/overlays/SearchOverlay.tsx
index 35189cb..0d39d70 100644
--- a/components/overlays/SearchOverlay.tsx
+++ b/components/overlays/SearchOverlay.tsx
@@ -1,13 +1,12 @@
 'use client';
 
 import { useEffect, useRef } from 'react';
-import { CUISINES, DESTS, cuisineLabel, restaurantImage } from '@/lib/data';
 import { fold } from '@/lib/booking';
 import { useSite } from '@/components/site/SiteProvider';
 import { useOpenAnimation } from '@/lib/motion';
 
 export function SearchOverlay() {
-  const { restaurants, overlay, close, query, setQuery, openRestaurant } = useSite();
+  const { site, destName, restaurants, overlay, close, query, setQuery, openRestaurant } = useSite();
   const inputRef = useRef<HTMLInputElement>(null);
   const open = overlay === 'search';
 
@@ -29,12 +28,9 @@ export function SearchOverlay() {
 
   if (!open) return null;
 
+  // r.search is folded on the server: name, type, cuisines and destination in this language and the default one (spec §6.3 item 9).
   const q = fold(query.trim());
-  const results = !q
-    ? []
-    : restaurants.filter((r) =>
-        fold([r.name, r.type, r.cuisines.map(cuisineLabel).join(' '), DESTS[r.dest]].join(' ')).includes(q),
-      );
+  const results = !q ? [] : restaurants.filter((r) => r.search.includes(q));
 
   return (
     <div data-anim="search" className="search-root" role="dialog" aria-modal="true" aria-label="Search">
@@ -60,9 +56,9 @@ export function SearchOverlay() {
           <>
             <div className="search-label">POPULAR CUISINES</div>
             <div className="search-chips">
-              {CUISINES.map(([label]) => (
-                <button key={label} type="button" className="search-chip" onClick={() => setQuery(label)}>
-                  {label}
+              {site.cuisines.map((c) => (
+                <button key={c.id} type="button" className="search-chip" onClick={() => setQuery(c.label)}>
+                  {c.label}
                 </button>
               ))}
             </div>
@@ -84,12 +80,12 @@ export function SearchOverlay() {
                 >
                   <span
                     className="search-thumb"
-                    style={{ backgroundImage: `url('${restaurantImage(r.id)}')` }}
+                    style={r.image ? { backgroundImage: `url('${r.image.url}')` } : undefined}
                     aria-hidden="true"
                   />
                   <span className="search-result-copy">
                     <span className="search-result-name">{r.name}</span>
-                    <span className="search-result-meta">{`${r.type} · ${DESTS[r.dest]}`}</span>
+                    <span className="search-result-meta">{`${r.type} · ${destName(r.dest)}`}</span>
                   </span>
                   {(r.hasDetailPage || r.bookingEnabled) && (
                     <span className="search-result-action">
```

Sửa `components/booking/BookingBar.tsx`:

```diff
diff --git a/components/booking/BookingBar.tsx b/components/booking/BookingBar.tsx
index 8a318db..269ee79 100644
--- a/components/booking/BookingBar.tsx
+++ b/components/booking/BookingBar.tsx
@@ -1,6 +1,7 @@
 'use client';
 
-import { DESTS, DEST_KEYS, MEAL_LABELS } from '@/lib/data';
+import { bookableDestinationOptions } from '@/lib/content/options';
+import { MEAL_LABELS } from '@/lib/data';
 import { fmtDay, guestLabel } from '@/lib/booking';
 import { dayReason, slotOpen } from '@/lib/booking/client';
 import { useSite } from '@/components/site/SiteProvider';
@@ -10,7 +11,7 @@ import { useReveal } from '@/lib/motion';
 
 /** The wide "Where would you like to dine?" bar above the footer. */
 export function BookingBar() {
-  const { bookable, booking, setBooking, board, openReserve, days, maxParty, groupPhone, now, strings, loadFailed } = useSite();
+  const { site, bookable, booking, setBooking, board, openReserve, days, maxParty, groupPhone, now, strings, loadFailed } = useSite();
   const title = useReveal<HTMLHeadingElement>('title');
   const panel = useReveal<HTMLDivElement>('up');
 
@@ -18,9 +19,7 @@ export function BookingBar() {
   const at = board ? now() : undefined;
 
   // Only places and restaurants that take bookings online (booking_enabled).
-  const destinationOptions: Option<string>[] = DEST_KEYS.filter((k) => bookable.some((r) => r.dest === k)).map(
-    (k) => ({ value: k, label: DESTS[k] }),
-  );
+  const destinationOptions: Option<string>[] = bookableDestinationOptions(site.destinations, bookable);
 
   const restaurantOptions: Option<string>[] = bookable
     .filter((r) => r.dest === booking.destination)
```

Sửa `components/overlays/ReserveDrawer.tsx`:

```diff
diff --git a/components/overlays/ReserveDrawer.tsx b/components/overlays/ReserveDrawer.tsx
index fa0a805..027a84c 100644
--- a/components/overlays/ReserveDrawer.tsx
+++ b/components/overlays/ReserveDrawer.tsx
@@ -1,7 +1,8 @@
 'use client';
 
 import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
-import { DESTS, DEST_KEYS, MEAL_LABELS } from '@/lib/data';
+import { bookableDestinationOptions } from '@/lib/content/options';
+import { MEAL_LABELS } from '@/lib/data';
 import { FIELD_MAX, findRestaurant, fmtDay, guestLabel } from '@/lib/booking';
 import { dayReason, movedReason, slotOpen, type DateMove } from '@/lib/booking/client';
 import type { DayInfo } from '@/lib/booking/api';
@@ -161,6 +162,8 @@ function DayStrip({
 
 export function ReserveDrawer() {
   const {
+    site,
+    destName,
     restaurants,
     bookable,
     overlay,
@@ -294,9 +297,7 @@ export function ReserveDrawer() {
   const hint = atLimit && groupPhone;
 
   // Only places and restaurants that take bookings online (booking_enabled).
-  const destinationOptions: Option<string>[] = DEST_KEYS.filter((k) => bookable.some((r) => r.dest === k)).map(
-    (k) => ({ value: k, label: DESTS[k] }),
-  );
+  const destinationOptions: Option<string>[] = bookableDestinationOptions(site.destinations, bookable);
   const restaurantOptions: Option<string>[] = bookable
     .filter((r) => r.dest === booking.destination)
     .map((r) => ({ value: r.id, label: r.name }));
@@ -324,7 +325,7 @@ export function ReserveDrawer() {
             </div>
             <div className="drawer-name">{restaurant?.name}</div>
             <div className="drawer-meta">
-              {restaurant ? `${restaurant.type} · ${DESTS[restaurant.dest]}` : ''}
+              {restaurant ? `${restaurant.type} · ${destName(restaurant.dest)}` : ''}
             </div>
           </div>
           <button type="button" className="drawer-close" aria-label="Close" onClick={closeDrawer}>
```

- [ ] **Bước 9: Bỏ chữ component đã đổi nguồn khỏi khối 1 của test seed**

Sửa `test/integration/content-seed.test.ts`:

```diff
diff --git a/test/integration/content-seed.test.ts b/test/integration/content-seed.test.ts
index 64114ea..361fc69 100644
--- a/test/integration/content-seed.test.ts
+++ b/test/integration/content-seed.test.ts
@@ -99,11 +99,9 @@ describe('the snapshot is the content of 8fe98f5 (delete with the constants and
     const experiences = source('components/home/Experiences.tsx');
     expect(experiences).toContain(`src="${SECTIONS_AT_8FE98F5.experiences.image}" alt="${SECTIONS_AT_8FE98F5.experiences.alt}"`);
     expect(source('components/home/Heritage.tsx')).toContain(`src="${SECTIONS_AT_8FE98F5.heritage.image}" alt=""`);
-    // Cuisine, destination and story images are drawn with alt="".
-    expect(source('components/home/Cuisines.tsx')).toContain('src={cuisineImage(slug)} alt=""');
+    // Destination and story images are drawn with alt="".
     expect(source('components/home/Destinations.tsx')).toContain('src={`/assets/${card.slot}.jpg`} alt=""');
     expect(source('components/home/Stories.tsx')).toContain('src={`/assets/${img}.jpg`} alt=""');
-    expect(source('components/home/RestaurantCard.tsx')).toContain('alt={restaurant.name}');
   });
 });
 
```

- [ ] **Bước 10: Chạy lại test**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/content/options.test.ts test/integration/content-seed.test.ts`
Expected: PASS `Test Files  2 passed (2)`, `Tests  17 passed (17)`

Kiểm thêm: `grep -rnE "DESTS|DEST_KEYS|cuisineLabel|cuisineImage|restaurantImage|CUISINES" --include='*.ts' --include='*.tsx' components app lib | grep -v '^lib/data' | grep -v '\.test\.ts'` chỉ còn `components/detail/MoreRestaurants.tsx` (Task 7), ba trang admin (Task 10) và hai chữ "ALL CUISINES →"/"POPULAR CUISINES" trong JSX.

- [ ] **Bước 11: Chạy cổng kiểm tra, rồi diff DOM**

Expected:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo;
- `Test Files  77 passed (77)`, `Tests  988 passed (988)`;
- `Applied 8 migration(s).`; build thoát 0; check-prerender như Task 4;
- E2E `154 passed`, `1 skipped`; visual `8 passed`;
- diff DOM như Task 4: chỉ R18, 14 dòng mỗi trang.

- [ ] **Bước 12: Commit**

```bash
git add components/booking/BookingBar.tsx components/home/Cuisines.tsx components/home/Finder.tsx components/home/RestaurantCard.tsx components/home/Restaurants.tsx components/overlays/FinderSheet.tsx components/overlays/ReserveDrawer.tsx components/overlays/SearchOverlay.tsx components/ui/CmsImage.tsx e2e/filters.spec.ts lib/content/options.test.ts lib/content/options.ts test/integration/content-seed.test.ts
git commit -m "$(cat <<'EOF'
feat: build the cuisine rail, filters, search, booking bar, drawer and cards from the database's catalogue

Every consumer of the catalogue now reads what the layout loaded from the
content tables instead of lib/data.ts. The cuisine rail and the search chips
list the published cuisines; the finder, its phone sheet and the active
filter chips work on cuisine ids, meal keys and destination ids and name
them in the page's language (spec §6.3 item 2). lib/content/options.ts
builds the option lists once for the finder, the booking bar and the drawer
(the booking form lists only places with a restaurant that books online; a
teaser destination is never a place). Search matches the catalogue's
server-folded search text (spec §6.3 item 9), so it covers the page language
and the default one; its meta line and the drawer's name the destination
through destName. Restaurant cards and cuisine chips draw their pictures
through CmsImage, next/image with the media row's URL and alt, exactly as
before (R3); the chips stay decorative by role.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Các section trang chủ từ DB (ưu đãi vẫn từ `lib/data.ts`), và trang khách kiểm ngôn ngữ trước khi đọc

Trang chủ nạp các section và danh sách của nó qua loader có cache (`lib/server/content/home.ts`) và bỏ section bị tắt hoặc không có gì để hiện (spec §6.5); `homeSections` quyết điều đó cho trang và cho chrome (nút film, nút finder, film, thanh đặt bàn), và có unit test. Hero, điểm đến, trải nghiệm, di sản và câu chuyện đọc bảng của chúng; ảnh vốn `<img>` giữ `<img>` (R3). Ưu đãi chuyển ở Task 8.

Từ task này trang chủ đọc nội dung theo ngôn ngữ của URL (trước đó chỉ trang chính sách làm vậy), song song với kiểm ngôn ngữ của layout (`01-getting-started/06-fetching-data.md:460`). Một đường dẫn có dấu chấm bỏ qua proxy (`proxy.ts`), nên `/favicon.ico`, `/wp-login.php`, `/apple-touch-icon.png` tới `[lang]` với chính nó làm ngôn ngữ: trang đọc trước sẽ hỏi DB cho ngôn ngữ "favicon.ico", và `RangeError` của Intl thắng `notFound()` của layout (500 thay 404; render hỏng không được cache, nên mỗi lần như thế lại hỏi DB). Từ task này mọi trang khách `await requireEnabledLocale(…)` trước mọi lần đọc, một guard giữ quy tắc đó, và một test E2E giữ 404 của các đường dẫn ấy. Trang chính sách có cùng 500 tiềm ẩn từ đợt 5 (`/favicon.ico/privacy`), nên nó đổi theo ở đây.

**Files:**
- Create: `lib/server/content/home.queries.ts`, `lib/server/content/home.ts`, `lib/content/home-sections.ts`, `lib/content/home-sections.test.ts`, `test/guards/guest-pages.guard.test.ts`
- Modify: `lib/content/types.ts` (`HeroSlide`, `Experience`, `Story`), `lib/cache-plan.ts` (`heroSlides`, `experiences`, `stories`), `lib/server/content/locales.ts` (`requireEnabledLocale`), `app/(site)/[lang]/(guarded)/page.tsx`, `app/(site)/[lang]/(guarded)/privacy/page.tsx`, `components/home/Hero.tsx`, `components/site/Chrome.tsx`, `components/overlays/FilmModal.tsx`, `components/home/Destinations.tsx`, `components/home/Experiences.tsx`, `components/home/Heritage.tsx`, `components/home/Stories.tsx`, `scripts/check-prerender.mjs` (`PAGE_TAGS`)
- Test: `e2e/routing.spec.ts`, `test/integration/content-loaders.test.ts`, `test/integration/content-seed.test.ts`

**Interfaces:**
- Consumes: `LOCALE_CTE`, `i18nJoin`, `tr`, `mediaJson` (`sql.ts`); `storyKicker(category, publishedOn, locale)` (`format.ts`); `getSections(locale)` (`site.ts`); `getEnabledLocales()` (`locales.ts`); `SECTION_KEYS`, `SectionKey`, `Sections` (`types.ts`); `site.sections`, `site.destinations`, `site.settings.heroAutoplayMs` của `useSite()`; `CmsImage` (Task 5).
- Produces:
  - `lib/content/types.ts`: `HeroSlide = { id: number; image: Media; mobile: Media | null }`, `Experience = { id: number; title: string; blurb: string; href: string | null }`, `Story = { id: number; image: Media | null; kicker: string; title: string; href: string }`.
  - `lib/server/content/home.queries.ts`: `loadHeroSlides(locale)`, `loadExperiences(locale)`, `loadStories(locale)`; `home.ts`: `getHeroSlides`, `getExperiences`, `getStories` (Task 8 thêm `loadOffers`/`getOffers` vào hai file này).
  - `lib/server/content/locales.ts`: `requireEnabledLocale(code: string | undefined): Promise<string>` (trả mã, hoặc `notFound()` khi ngôn ngữ không bật; Task 7 dùng ở trang chi tiết).
  - `lib/content/home-sections.ts`: `homeSections(sections: Sections, lists?: Partial<Record<SectionKey, readonly unknown[]>>): Set<SectionKey>` (section bật, trừ danh sách rỗng; `restaurants` luôn có; Task 8 thêm `offers`).
  - `Hero({ slides })`, `Experiences({ items })`, `Stories({ items })` nhận props; `Destinations()` và `Heritage()` đọc `site`.

- [ ] **Bước 1: Viết E2E: đường dẫn mà crawler hỏi là 404**

Spec viết trước test đơn vị của task (build typecheck cả file test). `/favicon.ico/privacy` đã 500 từ đợt 5; ba đường dẫn còn lại 404 tới Task 5 và sẽ 500 nếu trang chủ mới đọc trước khi kiểm ngôn ngữ.

Sửa `e2e/routing.spec.ts`:

```diff
diff --git a/e2e/routing.spec.ts b/e2e/routing.spec.ts
index e7072e5..ec5f3ba 100644
--- a/e2e/routing.spec.ts
+++ b/e2e/routing.spec.ts
@@ -84,6 +84,16 @@ test.describe('pages that do not exist', () => {
     expect(tags).toContain('locales');
   });
 
+  test('a file a crawler asks for is a 404, not a server error, though its name lands where a language goes', async ({
+    request,
+  }) => {
+    // A path with a dot skips the proxy (proxy.ts), so /favicon.ico is the home page of a language
+    // "favicon.ico": the page checks the language before it reads (requireEnabledLocale).
+    for (const path of ['/favicon.ico', '/apple-touch-icon.png', '/wp-login.php', '/favicon.ico/privacy']) {
+      expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
+    }
+  });
+
   test('an unknown restaurant says so and is not indexed', async ({ request }) => {
     const res = await request.get('/en/restaurants/nope');
     // The first request streams its answer (200); later ones get the cached 404 (spec deviation 8).
```

- [ ] **Bước 2: Chạy spec trên build Task 5: phải đỏ**

Không cần build lại (spec không vào build; build của cổng Task 5 còn trong `.next`). Reset DB E2E, rồi:

```bash
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
rm -f "${TMPDIR:-/tmp}/furama-e2e-emails.ndjson"
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson CRON_SECRET=$(openssl rand -hex 16) E2E_PORT=3210 npx playwright test --retries=0 e2e/routing.spec.ts --project=desktop
lsof -ti tcp:3210 | xargs kill
```

Expected: `1 failed`, `12 passed` (trang chính sách ném `RangeError` với ngôn ngữ "favicon.ico"):

```
  ✘   9 [desktop] › e2e/routing.spec.ts:87:7 › pages that do not exist › a file a crawler asks for is a 404, not a server error, though its name lands where a language goes (125ms)
    Error: /favicon.ico/privacy
    Expected: 404
    Received: 500
```

- [ ] **Bước 3: Viết test của các loader trang chủ, của `homeSections` và guard của trang khách**

Sửa `test/integration/content-loaders.test.ts`:

```diff
diff --git a/test/integration/content-loaders.test.ts b/test/integration/content-loaders.test.ts
index c638a57..f55e63a 100644
--- a/test/integration/content-loaders.test.ts
+++ b/test/integration/content-loaders.test.ts
@@ -1,16 +1,20 @@
 import { afterAll, afterEach, describe, expect, it } from 'vitest';
 import { getPool } from '@/db/client';
 import { FALLBACK_PHONE } from '@/lib/data';
+import { loadExperiences, loadHeroSlides, loadStories } from '@/lib/server/content/home.queries';
 import { loadSiteSettings } from '@/lib/server/content/settings.queries';
 import { loadCuisines, loadDestinations, loadNav, loadSections, loadSocials } from '@/lib/server/content/site.queries';
 import {
   CUISINES_AT_8FE98F5,
   DESTINATIONS_AT_8FE98F5,
+  EXPERIENCES_AT_8FE98F5,
   HERO_AUTOPLAY_MS_AT_8FE98F5,
+  HERO_SLIDES_AT_8FE98F5,
   NAV_AT_8FE98F5,
   SECTIONS_AT_8FE98F5,
   SETTINGS_AT_8FE98F5,
   SOCIALS_AT_8FE98F5,
+  STORIES_AT_8FE98F5,
 } from '../fixtures/phase5-content';
 
 /*
@@ -26,13 +30,18 @@ const sql = (text: string, values: unknown[] = []) => getPool().query(text, valu
 
 describe.skipIf(!process.env.TEST_DATABASE_URL)('content loaders (database)', () => {
   afterEach(async () => {
-    for (const table of ['cuisine_i18n', 'destination_i18n', 'media_i18n', 'nav_item_i18n']) await sql(`DELETE FROM ${table} WHERE locale <> 'en'`);
+    for (const table of ['cuisine_i18n', 'destination_i18n', 'media_i18n', 'nav_item_i18n', 'experience_i18n', 'story_i18n']) {
+      await sql(`DELETE FROM ${table} WHERE locale <> 'en'`);
+    }
     await sql(`UPDATE locales SET serve_machine = false WHERE code = 'vi'`);
     await sql(`UPDATE sections SET is_visible = true`);
     await sql(`UPDATE cuisines SET is_published = true`);
     await sql(`UPDATE destinations SET is_published = true`);
     await sql(`UPDATE nav_items SET is_published = true`);
     await sql(`UPDATE social_links SET is_published = true, visible_locales = NULL`);
+    await sql(`UPDATE experiences SET is_published = true`);
+    await sql(`UPDATE stories SET is_published = true`);
+    await sql(`UPDATE hero_slides SET is_published = true`);
   });
   afterAll(() => getPool().end());
 
@@ -83,9 +92,39 @@ describe.skipIf(!process.env.TEST_DATABASE_URL)('content loaders (database)', ()
       expect(s.film).toMatchObject({ image: { url: SECTIONS_AT_8FE98F5.film.image }, link: null });
       expect(s.hero).toEqual({ visible: true, image: null, link: null });
     });
+
+    it('hero slides: the three pictures in order, the first with its phone crop and the only alt text', async () => {
+      const slides = await loadHeroSlides('en');
+      expect(slides.map((h) => ({ image: h.image.url, mobile: h.mobile?.url ?? null, alt: h.image.alt }))).toEqual(HERO_SLIDES_AT_8FE98F5);
+      expect(slides[0].image).toMatchObject({ width: 906, height: 515 });
+    });
+
+    it('experiences: the three rows, linking nowhere yet (spec §15 item 16)', async () => {
+      expect((await loadExperiences('en')).map(({ title, blurb, href }) => ({ title, blurb, href }))).toEqual(
+        EXPERIENCES_AT_8FE98F5.map((e) => ({ ...e, href: null })),
+      );
+    });
+
+    it('stories: picture, kicker rebuilt from the category and the date ("9 Sep 2026"), title and link', async () => {
+      expect((await loadStories('en')).map((s) => ({ image: s.image?.url, kicker: s.kicker, title: s.title, href: s.href }))).toEqual(
+        STORIES_AT_8FE98F5,
+      );
+      for (const s of await loadStories('en')) expect(s.image?.alt).toBe('');
+    });
   });
 
   describe('languages (spec §5.1 item 5)', () => {
+    it('a story or an experience translated in part keeps the default language’s other fields', async () => {
+      await sql(`INSERT INTO experience_i18n (experience_id, locale, title, status) VALUES (1, 'vi', 'Trải nghiệm ẩm thực', 'reviewed')`);
+      await sql(`INSERT INTO story_i18n (story_id, locale, category, status) VALUES (1, 'vi', 'Tin nhà hàng', 'reviewed')`);
+      const [experience] = await loadExperiences('vi');
+      expect(experience).toMatchObject({ title: 'Trải nghiệm ẩm thực', blurb: EXPERIENCES_AT_8FE98F5[0].blurb });
+      const [story] = await loadStories('vi');
+      // The date follows the language (phase 8 gives each its template); the title stays English.
+      expect(story.kicker).toMatch(/^Tin nhà hàng · /);
+      expect(story.title).toBe(STORIES_AT_8FE98F5[0].title);
+    });
+
     it('shows a reviewed translation, and the default language for each field it lacks', async () => {
       await sql(`INSERT INTO destination_i18n (destination_id, locale, name, status) VALUES ('mm', 'vi', 'Furama MM Siêu thị', 'reviewed')`);
       const mm = (await loadDestinations('vi')).find((d) => d.id === 'mm');
@@ -118,6 +157,15 @@ describe.skipIf(!process.env.TEST_DATABASE_URL)('content loaders (database)', ()
   });
 
   describe('what the guest does not see', () => {
+    it('an unpublished slide, experience or story', async () => {
+      await sql(`UPDATE hero_slides SET is_published = false WHERE id = 2`);
+      await sql(`UPDATE experiences SET is_published = false WHERE id = 2`);
+      await sql(`UPDATE stories SET is_published = false WHERE id = 4`);
+      expect((await loadHeroSlides('en')).map((h) => h.id)).toEqual([1, 3]);
+      expect((await loadExperiences('en')).map((e) => e.id)).toEqual([1, 3]);
+      expect((await loadStories('en')).map((s) => s.id)).toEqual([1, 2, 3]);
+    });
+
     it('an unpublished cuisine, destination, nav item or social link', async () => {
       await sql(`UPDATE cuisines SET is_published = false WHERE id = 'hotpot'`);
       await sql(`UPDATE destinations SET is_published = false WHERE id = 'future'`);
```

`homeSections` là chỗ duy nhất quyết section nào hiện: một section tắt bị bỏ, một danh sách rỗng bị bỏ (không ưu đãi hôm nay, không slide), `restaurants` luôn có, và chrome hỏi cùng hàm cho film, finder và thanh đặt bàn. Create `lib/content/home-sections.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { homeSections } from './home-sections';
import { SECTION_KEYS, type SectionKey, type Sections } from './types';

/** Every section on, except those named. */
function sections(...off: SectionKey[]): Sections {
  return Object.fromEntries(SECTION_KEYS.map((key) => [key, { visible: !off.includes(key), image: null, link: null }])) as Sections;
}

const one = [{}];

describe('home sections (sections.is_visible, spec §6.5)', () => {
  it('leaves out a section staff switched off, and keeps the others', () => {
    const shown = homeSections(sections('stories', 'heritage'), { hero: one, experiences: one, stories: one, offers: one });
    expect([...shown]).toEqual(SECTION_KEYS.filter((key) => key !== 'stories' && key !== 'heritage'));
  });

  it('leaves out a list with nothing to show: no offer today, no slide', () => {
    const shown = homeSections(sections(), { hero: [], experiences: one, stories: one, offers: [] });
    expect(shown.has('offers')).toBe(false);
    expect(shown.has('hero')).toBe(false);
    expect(shown.has('experiences')).toBe(true);
    expect(shown.has('stories')).toBe(true);
  });

  it('always keeps the restaurants, whatever the row says', () => {
    expect(homeSections(sections('restaurants')).has('restaurants')).toBe(true);
  });

  it('answers the chrome too: film off hides WATCH THE FILM, finder off FIND A RESTAURANT, booking_bar off the bar', () => {
    const shown = homeSections(sections('film', 'finder', 'booking_bar'));
    expect((['film', 'finder', 'booking_bar'] as const).filter((key) => shown.has(key))).toEqual([]);
    expect(homeSections(sections()).has('film')).toBe(true);
  });
});
```

Guard của trang khách theo mẫu "every page awaits the session check before anything else" của `lib/admin/admin-pages.guard.test.ts`: trong hàm export default của mỗi `page.tsx` dưới `app/(site)`, lần `await` đầu tiên không phải `lang()` hay `params` phải là `requireEnabledLocale(…)`; trang không chờ gì khác thì qua. Test thứ hai kiểm chính bộ nhận dạng. Create `test/guards/guest-pages.guard.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';

/*
 * A guest page reads its content for the language in its URL, so it checks
 * that language before it reads anything: `await requireEnabledLocale(…)`
 * (lib/server/content/locales.ts). The (guarded) layout's own check is not
 * enough, since layouts and pages render in parallel
 * (node_modules/next/dist/docs/01-app/01-getting-started/06-fetching-data.md:460):
 * /favicon.ico would query the database with "favicon.ico" as its language,
 * and the page's error would win over the layout's 404. Reading the language
 * itself (`await lang()`, `await params`) may come first; a page that awaits
 * nothing else reads nothing. Awaits inside nested functions are not counted:
 * they run only when called. The admin's session rule is the same check
 * (lib/admin/admin-pages.guard.test.ts).
 */
const GUEST = 'app/(site)';
const CHECK = 'requireEnabledLocale';
const FUNCTIONS = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'];

type Node = { type: string; [key: string]: unknown };

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** Visits every node below `node`; a node for which `skip` is true is neither visited nor entered. */
function walk(node: unknown, visit: (n: Node) => void, skip?: (n: Node) => boolean): void {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit, skip));
  if (typeof node !== 'object' || node === null || typeof (node as Node).type !== 'string') return;
  if (skip?.(node as Node)) return;
  visit(node as Node);
  for (const [key, value] of Object.entries(node)) if (key !== 'parent') walk(value, visit, skip);
}

/** `export default async function Page…`: every guest page is written so. */
function defaultExportFunction(program: Node): Node | null {
  const exported = (program.body as Node[]).find((n) => n.type === 'ExportDefaultDeclaration')?.declaration as Node | undefined;
  return exported && FUNCTIONS.includes(exported.type) ? exported : null;
}

/** `await lang()` or `await params`: reading the language, not content. */
function readsLanguage(argument: Node): boolean {
  if (argument.type === 'Identifier') return argument.name === 'params';
  const callee = argument.type === 'CallExpression' ? (argument.callee as Node) : null;
  return callee?.type === 'Identifier' && callee.name === 'lang';
}

/** Null when the page's first await past the language is `await requireEnabledLocale(…)`, or it has none; otherwise why not. */
function languageCheckProblem(file: string, src: string): string | null {
  const page = defaultExportFunction(parseSync(file, src).program as unknown as Node);
  if (!page) return 'no `export default async function` to check';
  const awaits: Node[] = [];
  walk(
    page.body,
    (n) => {
      if (n.type === 'AwaitExpression') awaits.push(n);
    },
    (n) => FUNCTIONS.includes(n.type),
  );
  const unwrap = (n: Node): Node => (n.type === 'ParenthesizedExpression' ? unwrap(n.expression as Node) : n);
  const first = awaits
    .sort((a, b) => (a.start as number) - (b.start as number))
    .find((n) => !readsLanguage(unwrap(n.argument as Node)));
  if (!first) return null;
  const argument = unwrap(first.argument as Node);
  const callee = argument.type === 'CallExpression' ? (argument.callee as Node) : null;
  if (callee?.type === 'Identifier' && callee.name === CHECK) return null;
  const line = src.slice(0, first.start as number).split('\n').length;
  return `line ${line} awaits \`${src.slice(first.start as number, first.end as number)}\` before ${CHECK}()`;
}

describe('guest pages', () => {
  it('every page checks its language before it reads anything', () => {
    const pages = files(GUEST).filter((f) => f.endsWith('/page.tsx'));
    expect(pages.length).toBeGreaterThanOrEqual(3); // home, privacy, a restaurant's page
    const problems = pages.flatMap((f) => {
      const problem = languageCheckProblem(f, readFileSync(f, 'utf8'));
      return problem ? [`${relative('.', f)}: ${problem}`] : [];
    });
    expect(problems).toEqual([]);
  });

  it('the language-first rule: lang() and params may come first; a read before the check is flagged', () => {
    const compliant = [
      'export default async function Page({ params }) {',
      '  const { lang, slug } = await params;',
      '  await requireEnabledLocale(lang);',
      '  const detail = await getRestaurantDetail(slug, lang);',
      '  return <p>{detail.name}</p>;',
      '}',
    ].join('\n');
    expect(languageCheckProblem('compliant.tsx', compliant)).toBeNull();
    const readsFirst = [
      'export default async function Page() {',
      '  const locale = (await lang()) ?? DEFAULT_LOCALE;',
      '  const [stories] = await Promise.all([getStories(locale)]);',
      '  return <p>{stories.length}</p>;',
      '}',
    ].join('\n');
    expect(languageCheckProblem('reads-first.tsx', readsFirst)).toBe(
      'line 3 awaits `await Promise.all([getStories(locale)])` before requireEnabledLocale()',
    );
    expect(languageCheckProblem('static.tsx', 'export default async function Page() {\n  return <p />;\n}')).toBeNull();
  });
});
```

- [ ] **Bước 4: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/content-loaders.test.ts lib/content/home-sections.test.ts test/guards/guest-pages.guard.test.ts`
Expected: FAIL `Test Files  3 failed (3)`, `Tests  1 failed | 1 passed (2)` (guard tìm thấy trang chính sách; trang chủ của Task 5 chưa chờ gì):

```
     × every page checks its language before it reads anything 9ms
 FAIL  test/integration/content-loaders.test.ts [ test/integration/content-loaders.test.ts ]
Error: Cannot find package '@/lib/server/content/home.queries' imported from …/test/integration/content-loaders.test.ts
 FAIL  lib/content/home-sections.test.ts [ lib/content/home-sections.test.ts ]
Error: Cannot find module './home-sections' imported from …/lib/content/home-sections.test.ts
 FAIL  test/guards/guest-pages.guard.test.ts > guest pages > every page checks its language before it reads anything
+   "app/(site)/[lang]/(guarded)/privacy/page.tsx: line 50 awaits `await Promise.all([getPrivacyStrings(locale), getSiteSettings()])` before requireEnabledLocale()",
```

- [ ] **Bước 5: Kiểu và loader của trang chủ**

Kicker của câu chuyện định dạng ở đây, trên server ("9 Sep 2026"; trình duyệt không bao giờ định dạng, nên không lệch ICU lúc hydrate). Slide hay highlight có ảnh đã xóa mềm bị bỏ.

Sửa `lib/content/types.ts`:

```diff
diff --git a/lib/content/types.ts b/lib/content/types.ts
index a08abb7..d54280b 100644
--- a/lib/content/types.ts
+++ b/lib/content/types.ts
@@ -64,6 +64,15 @@ export type SiteSettings = {
   heroAutoplayMs: number;
 };
 
+/** A hero slide: its picture (alt "" when decorative) and, for the first, the phone crop. */
+export type HeroSlide = { id: number; image: Media; mobile: Media | null };
+
+/** An Experiences row; href null links to the section itself, as before phase 6. */
+export type Experience = { id: number; title: string; blurb: string; href: string | null };
+
+/** A story card: the kicker is already "Category · 9 Sep 2026" (lib/content/format.ts). */
+export type Story = { id: number; image: Media | null; kicker: string; title: string; href: string };
+
 /** Everything the chrome (header, menu, footer, finder, search, booking bar) needs, on every guest page. */
 export type SiteContent = {
   cuisines: Cuisine[];
```

Create `lib/server/content/home.queries.ts`:

```ts
import 'server-only';
import { query } from '@/db/client';
import { storyKicker } from '@/lib/content/format';
import type { Experience, HeroSlide, Media, Story } from '@/lib/content/types';
import { LOCALE_CTE, i18nJoin, mediaJson, tr } from './sql';

/* The home page's lists, uncached (lib/server/content/home.ts wraps them). Published rows, by sort_order then id. */

export async function loadHeroSlides(locale: string): Promise<HeroSlide[]> {
  const rows = await query<{ id: string; image: Media | null; mobile: Media | null }>(
    `WITH ${LOCALE_CTE}
     SELECT h.id::text, img.j AS image, mob.j AS mobile
       FROM hero_slides h CROSS JOIN lc
       LEFT JOIN LATERAL ${mediaJson('h.image_id')} AS img ON true
       LEFT JOIN LATERAL ${mediaJson('h.image_mobile_id')} AS mob ON true
      WHERE h.is_published
      ORDER BY h.sort_order, h.id`,
    [locale],
  );
  // A slide whose picture was soft-deleted has nothing to show.
  return rows.flatMap((r) => (r.image ? [{ id: Number(r.id), image: r.image, mobile: r.mobile }] : []));
}

export async function loadExperiences(locale: string): Promise<Experience[]> {
  const rows = await query<{ id: string; title: string; blurb: string | null; link_url: string | null }>(
    `WITH ${LOCALE_CTE}
     SELECT e.id::text, ${tr('et', 'title')} AS title, ${tr('et', 'blurb')} AS blurb, e.link_url
       FROM experiences e CROSS JOIN lc
       ${i18nJoin('experience_i18n', 'et', 'experience_id', 'e.id')}
      WHERE e.is_published AND ${tr('et', 'title')} IS NOT NULL
      ORDER BY e.sort_order, e.id`,
    [locale],
  );
  return rows.map((r) => ({ id: Number(r.id), title: r.title, blurb: r.blurb ?? '', href: r.link_url }));
}

/** The kicker is formatted here, on the server (spec §14.1 row 6: "9 Sep 2026", never the browser's ICU). */
export async function loadStories(locale: string): Promise<Story[]> {
  const rows = await query<{
    id: string;
    category: string | null;
    title: string;
    href: string;
    published_on: string | null;
    image: Media | null;
  }>(
    `WITH ${LOCALE_CTE}
     SELECT s.id::text, ${tr('st', 'category')} AS category, ${tr('st', 'title')} AS title,
            coalesce(st.href, s.href) AS href, to_char(s.published_on, 'YYYY-MM-DD') AS published_on, img.j AS image
       FROM stories s CROSS JOIN lc
       ${i18nJoin('story_i18n', 'st', 'story_id', 's.id')}
       LEFT JOIN LATERAL ${mediaJson('s.image_id')} AS img ON true
      WHERE s.is_published AND ${tr('st', 'title')} IS NOT NULL
      ORDER BY s.sort_order, s.id`,
    [locale],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    image: r.image,
    kicker: storyKicker(r.category ?? '', r.published_on, locale),
    title: r.title,
    href: r.href,
  }));
}
```

Create `lib/server/content/home.ts`:

```ts
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { LOADERS } from '@/lib/cache-plan';
import { TAGS } from '@/lib/cache-tags';
import { loadExperiences, loadHeroSlides, loadStories } from './home.queries';

/* The home page's lists, cached (see lib/server/content/site.ts for the rules). */

export async function getHeroSlides(locale: string) {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.heroSlides.tags, TAGS.i18n(locale));
  return loadHeroSlides(locale);
}

export async function getExperiences(locale: string) {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.experiences.tags, TAGS.i18n(locale));
  return loadExperiences(locale);
}

export async function getStories(locale: string) {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.stories.tags, TAGS.i18n(locale));
  return loadStories(locale);
}
```

Sửa `lib/cache-plan.ts`:

```diff
diff --git a/lib/cache-plan.ts b/lib/cache-plan.ts
index e2ce85f..7e9ec72 100644
--- a/lib/cache-plan.ts
+++ b/lib/cache-plan.ts
@@ -115,6 +115,9 @@ export const LOADERS = {
     ],
     tags: [TAGS.restaurants, TAGS.media, TAGS.contentCuisines, TAGS.contentDestinations],
   },
+  heroSlides: { reads: ['locales', 'hero_slides', 'media', 'media_i18n'], tags: [TAGS.contentHero, TAGS.media] },
+  experiences: { reads: ['locales', 'experiences', 'experience_i18n'], tags: [TAGS.contentExperiences] },
+  stories: { reads: ['locales', 'stories', 'story_i18n', 'media', 'media_i18n'], tags: [TAGS.contentStories, TAGS.media] },
 } as const satisfies Record<string, Loader>;
 
 export type LoaderName = keyof typeof LOADERS;
```

- [ ] **Bước 6: `requireEnabledLocale` và `homeSections`**

Với ngôn ngữ không bật, `notFound()` của trang cho cùng 404 của site như của layout: các test có sẵn của `routing.spec` vẫn xanh (`/vi` là 404 trong giao diện site, và 404 đã cache của nó vẫn mang thẻ `locales`, vì `getEnabledLocales` gắn thẻ đó). Sửa `lib/server/content/locales.ts`:

```diff
diff --git a/lib/server/content/locales.ts b/lib/server/content/locales.ts
index e036831..fabe01d 100644
--- a/lib/server/content/locales.ts
+++ b/lib/server/content/locales.ts
@@ -1,5 +1,6 @@
 import 'server-only';
 import { cacheLife, cacheTag } from 'next/cache';
+import { notFound } from 'next/navigation';
 import { LOADERS } from '@/lib/cache-plan';
 import { loadEnabledLocales, type SiteLocale } from './locales.queries';
 
@@ -12,3 +13,17 @@ export async function getEnabledLocales(): Promise<SiteLocale[]> {
   cacheTag(...LOADERS.locales.tags);
   return loadEnabledLocales();
 }
+
+/**
+ * The language of a guest page, or notFound() when it is not enabled. The
+ * (guarded) layout checks the same, but layouts and pages render in parallel
+ * (node_modules/next/dist/docs/01-app/01-getting-started/06-fetching-data.md:460):
+ * a page that read its content first would query the database for
+ * /favicon.ico or /wp-login.php (the first segment is the language), and an
+ * error of its own would win over the layout's 404. So every guest page awaits
+ * this before anything else (test/guards/guest-pages.guard.test.ts).
+ */
+export async function requireEnabledLocale(code: string | undefined): Promise<string> {
+  if (!code || !(await getEnabledLocales()).some((l) => l.code === code)) notFound();
+  return code;
+}
```

Create `lib/content/home-sections.ts` (thuần, không `server-only`: chrome của trình duyệt và trang của server dùng chung):

```ts
import { SECTION_KEYS, type SectionKey, type Sections } from './types';

/**
 * The home page's blocks that render (spec §6.5): those staff left on
 * (sections.is_visible), less a list with nothing in it (no slide, no offer
 * today). `restaurants` always renders: it cannot be switched off (CHECK
 * sections_restaurants_visible). The page renders by this, and the chrome asks
 * it about its own sections: film off hides WATCH THE FILM and the film
 * dialog, finder off FIND A RESTAURANT, booking_bar off the booking bar.
 * Pure, so the browser's chrome and the server's page agree.
 */
export function homeSections(sections: Sections, lists: Partial<Record<SectionKey, readonly unknown[]>> = {}): Set<SectionKey> {
  return new Set(
    SECTION_KEYS.filter((key) => {
      if (key === 'restaurants') return true;
      const list = lists[key];
      return sections[key].visible && (list === undefined || list.length > 0);
    }),
  );
}
```

- [ ] **Bước 7: Trang chủ kiểm ngôn ngữ trước, rồi bỏ section tắt hoặc rỗng**

Locale lấy bằng `lang()` (chỉ Server Component dưới `app/(site)/[lang]` được gọi nó) và qua `requireEnabledLocale` trước mọi loader. `restaurants` không tắt được (CHECK `sections_restaurants_visible`).

Thay toàn bộ `app/(site)/[lang]/(guarded)/page.tsx` bằng:

```tsx
import { lang } from 'next/root-params';
import { Hero } from '@/components/home/Hero';
import { Finder } from '@/components/home/Finder';
import { Cuisines } from '@/components/home/Cuisines';
import { Restaurants } from '@/components/home/Restaurants';
import { Destinations } from '@/components/home/Destinations';
import { Experiences } from '@/components/home/Experiences';
import { Heritage } from '@/components/home/Heritage';
import { Stories } from '@/components/home/Stories';
import { Offers } from '@/components/home/Offers';
import { IntroTrigger } from '@/components/site/IntroTrigger';
import { MobileBar } from '@/components/site/MobileBar';
import { ViewMarker } from '@/components/site/ViewMarker';
import { homeSections } from '@/lib/content/home-sections';
import { getExperiences, getHeroSlides, getStories } from '@/lib/server/content/home';
import { requireEnabledLocale } from '@/lib/server/content/locales';
import { getSections } from '@/lib/server/content/site';

/*
 * The home page. Its lists come from the database through cached loaders
 * (lib/server/content/home.ts); the chrome's content and the catalogue come
 * from the (guarded) layout. A section staff switched off (sections.is_visible)
 * is left out, and so is one with nothing to show (spec §6.5; homeSections).
 */
export default async function HomePage() {
  // First, before any read: /favicon.ico lands here with "favicon.ico" as its language (requireEnabledLocale).
  const locale = await requireEnabledLocale(await lang());
  const [sections, slides, experiences, stories] = await Promise.all([
    getSections(locale),
    getHeroSlides(locale),
    getExperiences(locale),
    getStories(locale),
  ]);
  const shown = homeSections(sections, { hero: slides, experiences, stories });

  return (
    <ViewMarker view="home">
      <IntroTrigger />
      {shown.has('hero') && <Hero slides={slides} />}
      {shown.has('finder') && <Finder />}
      {shown.has('cuisines') && <Cuisines />}
      {shown.has('restaurants') && <Restaurants />}
      {shown.has('destinations') && <Destinations />}
      {shown.has('experiences') && <Experiences items={experiences} />}
      {shown.has('heritage') && <Heritage />}
      {shown.has('stories') && <Stories items={stories} />}
      {shown.has('offers') && <Offers />}
      <MobileBar />
    </ViewMarker>
  );
}
```

- [ ] **Bước 8: Trang chính sách kiểm ngôn ngữ trước khi đọc**

`generateMetadata` của trang giữ nguyên (nó không định dạng ngày).

Sửa `app/(site)/[lang]/(guarded)/privacy/page.tsx`:

```diff
diff --git a/app/(site)/[lang]/(guarded)/privacy/page.tsx b/app/(site)/[lang]/(guarded)/privacy/page.tsx
index 2125a0b..42847e4 100644
--- a/app/(site)/[lang]/(guarded)/privacy/page.tsx
+++ b/app/(site)/[lang]/(guarded)/privacy/page.tsx
@@ -5,6 +5,7 @@ import { formatMessage } from '@/lib/i18n/format';
 import { DEFAULT_LOCALE, toBcp47 } from '@/lib/i18n/locales';
 import { PRIVACY_POLICY_VERSION, PRIVACY_SECTIONS } from '@/lib/legal';
 import { getPrivacyStrings } from '@/lib/server/content/legal';
+import { requireEnabledLocale } from '@/lib/server/content/locales';
 import { getSiteSettings } from '@/lib/server/content/site';
 
 /*
@@ -12,8 +13,9 @@ import { getSiteSettings } from '@/lib/server/content/site';
  * reserve drawer's consent box and the footer. Text from legal.* (registry
  * now, content_strings from phase 7); {email} is the shared inbox
  * (site_settings.email, tagged content:contact), the address the footer
- * shows. Prerendered and cached like every guest page: the (guarded) layout
- * has already checked the language.
+ * shows. Prerendered and cached like every guest page. The page checks the
+ * language itself before it reads (requireEnabledLocale): the layout's check
+ * runs in parallel, and Intl throws on a segment such as "favicon.ico".
  */
 
 async function strings() {
@@ -46,7 +48,7 @@ function WithEmail({ template, email }: { template: string; email: string }) {
 }
 
 export default async function PrivacyPage() {
-  const locale = (await lang()) ?? DEFAULT_LOCALE;
+  const locale = await requireEnabledLocale(await lang());
   const [t, settings] = await Promise.all([getPrivacyStrings(locale), getSiteSettings()]);
   // A calendar date: format it in UTC so the server's zone cannot move it. English reads day first, as the
   // booking form does ("Thu, 1 Oct"); other languages take their own order (phase 8).
```

- [ ] **Bước 9: Hero, film và thanh đặt bàn**

Slide, ảnh crop cho điện thoại của slide đầu và nhịp tự chạy từ DB; WATCH THE FILM theo section film, FIND A RESTAURANT theo section finder, cùng hỏi `homeSections`. Ảnh giữ `<img>` (R3).

Sửa `components/home/Hero.tsx`:

```diff
diff --git a/components/home/Hero.tsx b/components/home/Hero.tsx
index bcd4948..209e9df 100644
--- a/components/home/Hero.tsx
+++ b/components/home/Hero.tsx
@@ -1,7 +1,8 @@
 'use client';
 
 import { useEffect, useState } from 'react';
-import { HERO_SLIDES } from '@/lib/data';
+import { homeSections } from '@/lib/content/home-sections';
+import type { HeroSlide } from '@/lib/content/types';
 import { useSite } from '@/components/site/SiteProvider';
 import { readMotionLevel } from '@/lib/motion';
 
@@ -9,12 +10,17 @@ import { readMotionLevel } from '@/lib/motion';
  * One hero serves every width: the three cross-fading slides run on desktop,
  * while a phone gets a single art-directed crop, the shorter two-line headline
  * and the sheet trigger. Rendering one element keeps a single <h1> and a single
- * #top anchor instead of duplicating the section per breakpoint.
+ * #top anchor instead of duplicating the section per breakpoint. The slides
+ * (hero_slides) come from the page; the pace (site_settings.hero_autoplay_ms)
+ * and which buttons show (the film and finder sections, homeSections) from the chrome.
+ * Pictures stay plain <img> (R3; components/ui/CmsImage.tsx).
  */
-export function Hero() {
+export function Hero({ slides }: { slides: HeroSlide[] }) {
   const { site, open, overlay, scrollToId } = useSite();
   const [slide, setSlide] = useState(0);
-  const count = HERO_SLIDES.length;
+  const count = slides.length;
+  const autoplayMs = site.settings.heroAutoplayMs;
+  const shown = homeSections(site.sections);
 
   /* Slideshow: desktop only, paused behind an overlay or a hidden tab. It lives
      in the hero, so it stops whenever the home page is not on screen. */
@@ -23,14 +29,14 @@ export function Hero() {
     const timer = window.setInterval(() => {
       if (document.hidden || window.innerWidth < 760) return;
       setSlide((s) => (s + 1) % count);
-    }, 7000);
+    }, autoplayMs);
     return () => window.clearInterval(timer);
-  }, [count, overlay]);
+  }, [autoplayMs, count, overlay]);
 
   return (
     <section id="top" className="hero">
       <div className="hero-slides">
-        {HERO_SLIDES.map((s, i) => (
+        {slides.map((s, i) => (
           <div
             key={s.id}
             className="hero-slide"
@@ -40,18 +46,13 @@ export function Hero() {
           >
             <div className="hero-slide-zoom">
               {i === 0 ? (
+                // Phones show only this slide, in its own crop (spec §6.5).
                 <picture>
-                  <source media="(max-width: 759px)" srcSet="/assets/hero-hall-m.jpg" />
-                  <img
-                    src={`/assets/${s.img}.jpg`}
-                    alt="Dining at Furama Cuisine"
-                    className="fill"
-                    fetchPriority="high"
-                    decoding="async"
-                  />
+                  {s.mobile && <source media="(max-width: 759px)" srcSet={s.mobile.url} />}
+                  <img src={s.image.url} alt={s.image.alt} className="fill" fetchPriority="high" decoding="async" />
                 </picture>
               ) : (
-                <img src={`/assets/${s.img}.jpg`} alt="" className="fill" loading="lazy" decoding="async" />
+                <img src={s.image.url} alt={s.image.alt} className="fill" loading="lazy" decoding="async" />
               )}
             </div>
           </div>
@@ -94,7 +95,7 @@ export function Hero() {
               EXPLORE OUR RESTAURANTS<span className="hero-arrow">→</span>
             </button>
 
-            {site.sections.film.visible && (
+            {shown.has('film') && (
               <button type="button" className="hero-film" onClick={() => open('film')}>
                 <span className="hero-play">
                   <span className="hero-play-tri" />
@@ -103,14 +104,16 @@ export function Hero() {
               </button>
             )}
 
-            <button type="button" className="hero-find" onClick={() => open('sheet')}>
-              FIND A RESTAURANT<span>→</span>
-            </button>
+            {shown.has('finder') && (
+              <button type="button" className="hero-find" onClick={() => open('sheet')}>
+                FIND A RESTAURANT<span>→</span>
+              </button>
+            )}
           </div>
 
           {count > 1 && (
             <div className="hero-dots" data-intro="6">
-              {HERO_SLIDES.map((s, i) => (
+              {slides.map((s, i) => (
                 <button
                   key={s.id}
                   type="button"
```

Thanh đặt bàn và film hỏi cùng hàm (Task 4 đọc thẳng `site.sections.*.visible`). Sửa `components/site/Chrome.tsx`:

```diff
diff --git a/components/site/Chrome.tsx b/components/site/Chrome.tsx
index f22a9b2..c932a30 100644
--- a/components/site/Chrome.tsx
+++ b/components/site/Chrome.tsx
@@ -11,6 +11,7 @@ import { MenuOverlay } from '@/components/overlays/MenuOverlay';
 import { FilmModal } from '@/components/overlays/FilmModal';
 import { FinderSheet } from '@/components/overlays/FinderSheet';
 import { BookingBar } from '@/components/booking/BookingBar';
+import { homeSections } from '@/lib/content/home-sections';
 import { useScrollMotion } from '@/lib/motion';
 
 /**
@@ -33,7 +34,7 @@ export function Chrome({ children }: { children: React.ReactNode }) {
         {children}
 
         {/* The phone detail view hands reservations to its bottom bar instead (styles/booking.css). Staff can switch it off (sections.booking_bar). */}
-        {site.sections.booking_bar.visible && (
+        {homeSections(site.sections).has('booking_bar') && (
           <div className="booking-slot">
             <BookingBar />
           </div>
```

Sửa `components/overlays/FilmModal.tsx`:

```diff
diff --git a/components/overlays/FilmModal.tsx b/components/overlays/FilmModal.tsx
index d8f2b85..1ff85b0 100644
--- a/components/overlays/FilmModal.tsx
+++ b/components/overlays/FilmModal.tsx
@@ -1,6 +1,7 @@
 'use client';
 
 import { useSite } from '@/components/site/SiteProvider';
+import { homeSections } from '@/lib/content/home-sections';
 import { useOpenAnimation } from '@/lib/motion';
 
 export function FilmModal() {
@@ -8,7 +9,7 @@ export function FilmModal() {
   // The poster is the film section's picture, decorative here whatever its alt (the dialog is named); the
   // video itself (sections.link_url, YouTube or Vimeo) is phase 7's embed. Switched off, the hero hides WATCH THE FILM.
   const poster = site.sections.film.image;
-  const open = overlay === 'film' && site.sections.film.visible;
+  const open = overlay === 'film' && homeSections(site.sections).has('film');
 
   useOpenAnimation(open, (animate) => {
     animate(
```

- [ ] **Bước 10: Điểm đến, trải nghiệm, di sản, câu chuyện**

Thẻ điểm đến và câu chuyện qua `CmsImage decorative` (chữ trên/dưới thẻ gọi tên nó); ảnh đầu bếp và nền di sản giữ `<img>`. Một dòng trải nghiệm không có link riêng trỏ về section của nó như trước (spec §15 mục 16: chủ dự án đưa link); nút OUR STORY chỉ hiện khi section có link.

Sửa `components/home/Destinations.tsx`:

```diff
diff --git a/components/home/Destinations.tsx b/components/home/Destinations.tsx
index 07f4dd9..e6b8987 100644
--- a/components/home/Destinations.tsx
+++ b/components/home/Destinations.tsx
@@ -1,17 +1,19 @@
 'use client';
 
-import Image from 'next/image';
-import { DESTINATION_CARDS, type DestKey, type DestinationCard } from '@/lib/data';
+import type { Destination } from '@/lib/content/types';
 import { journeyStops } from '@/lib/journey';
+import { CmsImage } from '@/components/ui/CmsImage';
 import { useSite } from '@/components/site/SiteProvider';
 import { useReveal } from '@/lib/motion';
 
 export function Destinations() {
-  const { restaurants, pickDestination } = useSite();
+  const { site, restaurants, pickDestination } = useSite();
+  // destinations and destination_i18n: the venues, then the teaser ("Future Locations"), which is not a link.
+  const cards = site.destinations;
   const title = useReveal<HTMLHeadingElement>('title');
   const lede = useReveal<HTMLParagraphElement>('up');
   const journey = useReveal<HTMLDivElement>('journey');
-  const { inset, stops } = journeyStops(DESTINATION_CARDS.length);
+  const { inset, stops } = journeyStops(cards.length);
 
   return (
     <section id="destinations" className="destinations">
@@ -34,16 +36,16 @@ export function Destinations() {
         </div>
 
         <div className="dest-rail">
-          {DESTINATION_CARDS.map((card) => (
+          {cards.map((card) => (
             <DestCard
-              key={card.key}
+              key={card.id}
               card={card}
               count={
-                card.key === 'future'
+                card.kind === 'teaser'
                   ? 'Coming soon'
-                  : `${restaurants.filter((r) => r.dest === card.key).length} restaurants →`
+                  : `${restaurants.filter((r) => r.dest === card.id).length} restaurants →`
               }
-              onPick={card.key === 'future' ? undefined : () => pickDestination(card.key as DestKey)}
+              onPick={card.kind === 'teaser' ? undefined : () => pickDestination(card.id)}
             />
           ))}
         </div>
@@ -57,7 +59,7 @@ function DestCard({
   count,
   onPick,
 }: {
-  card: DestinationCard;
+  card: Destination;
   count: string;
   onPick?: () => void;
 }) {
@@ -66,25 +68,20 @@ function DestCard({
   const body = (
     <>
       <span className="dest-zoom" data-reveal-zoom="1">
-        <Image
-          src={`/assets/${card.slot}.jpg`}
-          alt=""
-          fill
-          sizes="(max-width: 759px) 76vw, 308px"
-          className="dest-img"
-        />
+        {/* Decorative by role: the card's own lines name the place. */}
+        {card.image && <CmsImage media={card.image} decorative fill sizes="(max-width: 759px) 76vw, 308px" className="dest-img" />}
       </span>
       <span className="dest-scrim" aria-hidden="true" />
       <span className="dest-copy">
         <span className="dest-title">
-          {card.title[0]}
+          {card.cardTitle[0]}
           <br />
-          {card.title[1]}
+          {card.cardTitle[1]}
         </span>
         <span className="dest-blurb">
-          {card.blurb[0]}
+          {card.cardBlurb[0]}
           <br />
-          {card.blurb[1]}
+          {card.cardBlurb[1]}
         </span>
         <span className="dest-count">{count}</span>
       </span>
@@ -96,7 +93,7 @@ function DestCard({
       {onPick ? (
         <button type="button" className="dest-hit" onClick={onPick}>
           {body}
-          <span className="sr-only">{`${card.title.join(' ')} — ${count}`}</span>
+          <span className="sr-only">{`${card.cardTitle.join(' ')} — ${count}`}</span>
         </button>
       ) : (
         <div className="dest-hit dest-hit-static">{body}</div>
```

Sửa `components/home/Experiences.tsx`:

```diff
diff --git a/components/home/Experiences.tsx b/components/home/Experiences.tsx
index 139ea68..8b6a4ac 100644
--- a/components/home/Experiences.tsx
+++ b/components/home/Experiences.tsx
@@ -1,9 +1,13 @@
 'use client';
 
-import { EXPERIENCES } from '@/lib/data';
+import type { Experience } from '@/lib/content/types';
+import { useSite } from '@/components/site/SiteProvider';
 import { useReveal } from '@/lib/motion';
 
-export function Experiences() {
+/** The rows (experiences) come from the page; the picture is the section's own (sections.image_id), a plain <img> (R3). */
+export function Experiences({ items }: { items: Experience[] }) {
+  const { site } = useSite();
+  const image = site.sections.experiences.image;
   const media = useReveal<HTMLDivElement>('wipe');
   const kicker = useReveal<HTMLDivElement>('fade');
   const title = useReveal<HTMLHeadingElement>('title');
@@ -11,7 +15,7 @@ export function Experiences() {
   return (
     <section id="experiences" className="experiences">
       <div ref={media} data-reveal="wipe" className="experiences-media">
-        <img src="/assets/chef.jpg" alt="A Furama chef at work" className="fill" loading="lazy" />
+        {image && <img src={image.url} alt={image.alt} className="fill" loading="lazy" />}
       </div>
 
       <div className="experiences-body">
@@ -25,8 +29,8 @@ export function Experiences() {
         </h2>
 
         <div className="experiences-list">
-          {EXPERIENCES.map((e) => (
-            <ExperienceRow key={e.title} title={e.title} blurb={e.blurb} />
+          {items.map((e) => (
+            <ExperienceRow key={e.id} title={e.title} blurb={e.blurb} href={e.href} />
           ))}
         </div>
       </div>
@@ -34,11 +38,18 @@ export function Experiences() {
   );
 }
 
-function ExperienceRow({ title, blurb }: { title: string; blurb: string }) {
+/** A row without its own link points at its section, as before phase 6 (spec §15 item 16: the owner supplies the links). */
+function ExperienceRow({ title, blurb, href }: { title: string; blurb: string; href: string | null }) {
   const ref = useReveal<HTMLAnchorElement>('right');
 
   return (
-    <a ref={ref} data-reveal="right" href="#experiences" className="experience-row">
+    <a
+      ref={ref}
+      data-reveal="right"
+      href={href ?? '#experiences'}
+      {...(href ? { target: '_blank', rel: 'noopener' } : {})}
+      className="experience-row"
+    >
       <span className="experience-copy">
         <span className="experience-name">{title}</span>
         <span className="experience-blurb">{blurb}</span>
```

Sửa `components/home/Heritage.tsx`:

```diff
diff --git a/components/home/Heritage.tsx b/components/home/Heritage.tsx
index 671b825..a680fc1 100644
--- a/components/home/Heritage.tsx
+++ b/components/home/Heritage.tsx
@@ -1,23 +1,22 @@
 'use client';
 
-import { CONTACT } from '@/lib/data';
+import { useSite } from '@/components/site/SiteProvider';
 import { useReveal } from '@/lib/motion';
 
+/** The picture and the OUR STORY link are the section's own (sections.image_id, link_url); no link, no button. */
 export function Heritage() {
+  const { site } = useSite();
+  const { image, link } = site.sections.heritage;
   const kicker = useReveal<HTMLDivElement>('fade');
   const title = useReveal<HTMLHeadingElement>('title');
   const cta = useReveal<HTMLAnchorElement>('up');
 
   return (
     <section id="heritage" className="heritage">
-      <img
-        src="/assets/heritage.jpg"
-        alt=""
-        className="heritage-img"
-        data-parallax="0.2"
-        data-parallax-max="0.11"
-        loading="lazy"
-      />
+      {/* A background: alt="" whatever the file says, a plain <img> (R3). */}
+      {image && (
+        <img src={image.url} alt="" className="heritage-img" data-parallax="0.2" data-parallax-max="0.11" loading="lazy" />
+      )}
       <div className="heritage-scrim" aria-hidden="true" />
 
       <div className="heritage-body">
@@ -29,16 +28,11 @@ export function Heritage() {
           <br />
           that keeps evolving
         </h2>
-        <a
-          ref={cta}
-          data-reveal="up"
-          href={CONTACT.story}
-          target="_blank"
-          rel="noopener"
-          className="btn-slab heritage-cta"
-        >
-          OUR STORY<span className="arrow">→</span>
-        </a>
+        {link && (
+          <a ref={cta} data-reveal="up" href={link} target="_blank" rel="noopener" className="btn-slab heritage-cta">
+            OUR STORY<span className="arrow">→</span>
+          </a>
+        )}
       </div>
     </section>
   );
```

Sửa `components/home/Stories.tsx`:

```diff
diff --git a/components/home/Stories.tsx b/components/home/Stories.tsx
index 4149682..c4102c7 100644
--- a/components/home/Stories.tsx
+++ b/components/home/Stories.tsx
@@ -1,10 +1,11 @@
 'use client';
 
-import Image from 'next/image';
-import { STORIES } from '@/lib/data';
+import type { Media, Story } from '@/lib/content/types';
+import { CmsImage } from '@/components/ui/CmsImage';
 import { useReveal } from '@/lib/motion';
 
-export function Stories() {
+/** The cards (stories) come from the page, their kicker already formatted on the server. */
+export function Stories({ items }: { items: Story[] }) {
   const title = useReveal<HTMLHeadingElement>('title');
   const lede = useReveal<HTMLParagraphElement>('up');
 
@@ -21,8 +22,8 @@ export function Stories() {
         </div>
 
         <div className="stories-rail">
-          {STORIES.map((s) => (
-            <StoryCard key={s.slot} {...s} />
+          {items.map((s) => (
+            <StoryCard key={s.id} image={s.image} kicker={s.kicker} title={s.title} href={s.href} />
           ))}
         </div>
       </div>
@@ -31,12 +32,12 @@ export function Stories() {
 }
 
 function StoryCard({
-  img,
+  image,
   kicker,
   title,
   href,
 }: {
-  img: string;
+  image: Media | null;
   kicker: string;
   title: string;
   href: string;
@@ -47,13 +48,8 @@ function StoryCard({
     <a ref={ref} data-reveal="card" href={href} target="_blank" rel="noopener" className="story">
       <span className="story-frame frame" data-reveal-img="1">
         <span className="story-zoom" data-reveal-zoom="1">
-          <Image
-            src={`/assets/${img}.jpg`}
-            alt=""
-            fill
-            sizes="(max-width: 759px) 72vw, 302px"
-            className="story-img"
-          />
+          {/* Decorative by role: the title below says what the story is. */}
+          {image && <CmsImage media={image} decorative fill sizes="(max-width: 759px) 72vw, 302px" className="story-img" />}
         </span>
       </span>
       <span className="story-kicker">{kicker}</span>
```

- [ ] **Bước 11: Tag của trang chủ, chữ component đã đổi nguồn**

Sửa `scripts/check-prerender.mjs`:

```diff
diff --git a/scripts/check-prerender.mjs b/scripts/check-prerender.mjs
index 9f83239..c73e159 100644
--- a/scripts/check-prerender.mjs
+++ b/scripts/check-prerender.mjs
@@ -45,8 +45,11 @@ const TAGS = [
   'content:contact',
   'media',
 ];
-/** Tags a page carries beyond the layout's: the privacy policy's own reader (lib/server/content/legal.ts). */
-const PAGE_TAGS = { '/en/privacy': ['content:legal'] };
+/** Tags a page carries beyond the layout's: the home page's lists (lib/server/content/home.ts), the privacy policy's text (legal.ts). */
+const PAGE_TAGS = {
+  '/en': ['content:hero', 'content:experiences', 'content:stories'],
+  '/en/privacy': ['content:legal'],
+};
 const REVALIDATE = 2_592_000; // cacheLife('max'): 30 days
 const EXPIRE = 31_536_000; // 1 year
 
```

Sửa `test/integration/content-seed.test.ts` (khối 1 chỉ còn chữ của `TayaHero`):

```diff
diff --git a/test/integration/content-seed.test.ts b/test/integration/content-seed.test.ts
index 361fc69..3e1b383 100644
--- a/test/integration/content-seed.test.ts
+++ b/test/integration/content-seed.test.ts
@@ -87,21 +87,11 @@ describe('the snapshot is the content of 8fe98f5 (delete with the constants and
   });
 
   it('matches the copy written into the components', () => {
-    const hero = source('components/home/Hero.tsx');
-    expect(hero).toContain(`srcSet="${HERO_SLIDES_AT_8FE98F5[0].mobile}"`);
-    expect(hero).toContain(`alt="${HERO_SLIDES_AT_8FE98F5[0].alt}"`);
-    expect(hero).toContain(`}, ${HERO_AUTOPLAY_MS_AT_8FE98F5});`);
     const taya = DETAIL_PAGES_AT_8FE98F5['taya-house'];
     const tayaHero = source('components/detail/TayaHero.tsx');
     expect(tayaHero.split(taya.kicker)).toHaveLength(3); // desktop and phone copies
     expect(tayaHero.split(taya.story)).toHaveLength(3);
     expect(tayaHero).toContain(`<img src="${taya.portrait}" alt="${taya.portraitAlt}"`);
-    const experiences = source('components/home/Experiences.tsx');
-    expect(experiences).toContain(`src="${SECTIONS_AT_8FE98F5.experiences.image}" alt="${SECTIONS_AT_8FE98F5.experiences.alt}"`);
-    expect(source('components/home/Heritage.tsx')).toContain(`src="${SECTIONS_AT_8FE98F5.heritage.image}" alt=""`);
-    // Destination and story images are drawn with alt="".
-    expect(source('components/home/Destinations.tsx')).toContain('src={`/assets/${card.slot}.jpg`} alt=""');
-    expect(source('components/home/Stories.tsx')).toContain('src={`/assets/${img}.jpg`} alt=""');
   });
 });
 
```

- [ ] **Bước 12: Chạy lại test**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/content-loaders.test.ts test/integration/content-seed.test.ts lib/cache-plan.test.ts lib/content/home-sections.test.ts test/guards/guest-pages.guard.test.ts`
Expected: PASS `Test Files  5 passed (5)`, `Tests  41 passed (41)`

- [ ] **Bước 13: Chạy cổng kiểm tra, rồi diff DOM**

Expected:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo;
- `Test Files  79 passed (79)`, `Tests  999 passed (999)`;
- `Applied 8 migration(s).`; build thoát 0; check-prerender in `Prerender check passed: /en, /en/restaurants/taya-house, /en/privacy (tags: restaurants, i18n:en, locales, content:ui, content:sections, content:cuisines, content:destinations, content:nav, content:contact, media; /en also content:hero, content:experiences, content:stories; /en/privacy also content:legal).`;
- E2E `155 passed`, `1 skipped` (cả test 404 mới của `routing.spec`); visual `8 passed`;
- diff DOM như Task 4: chỉ R18, 14 dòng mỗi trang;
- trên server của visual (cổng 3211, trước khi tắt nó): `/favicon.ico`, `/apple-touch-icon.png`, `/wp-login.php`, `/.env` và `/favicon.ico/privacy` trả `404` (`curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3211/favicon.ico`), không `RangeError` nào trong log của server.

- [ ] **Bước 14: Commit**

```bash
git add "app/(site)/[lang]/(guarded)/page.tsx" "app/(site)/[lang]/(guarded)/privacy/page.tsx" components/home/Destinations.tsx components/home/Experiences.tsx components/home/Heritage.tsx components/home/Hero.tsx components/home/Stories.tsx components/overlays/FilmModal.tsx components/site/Chrome.tsx e2e/routing.spec.ts lib/cache-plan.ts lib/content/home-sections.test.ts lib/content/home-sections.ts lib/content/types.ts lib/server/content/home.queries.ts lib/server/content/home.ts lib/server/content/locales.ts scripts/check-prerender.mjs test/guards/guest-pages.guard.test.ts test/integration/content-loaders.test.ts test/integration/content-seed.test.ts
git commit -m "$(cat <<'EOF'
feat: draw the hero, destinations, experiences, heritage and stories from the database

The home page loads its sections and lists through cached loaders
(lib/server/content/home.ts: hero slides, experiences, stories; tagged
content:hero, content:experiences, content:stories through the cache plan)
and leaves out a section staff switched off, or one with nothing to show
(spec §6.5). The hero takes its slides, the phone crop of the first and the
autoplay pace from the database; FIND A RESTAURANT follows the finder
section. The destination cards, the Experiences rows and picture, the
heritage picture and its OUR STORY link, and the story cards (their kicker
formatted on the server, "9 Sep 2026") all read their tables. Pictures that
were plain <img> stay plain <img> with the media URL; the destination and
story cards go through CmsImage, decorative by role (R3). The offers stay
on lib/data.ts until their own task. check-prerender expects the three new
tags on /en; the pixels are unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Trang chi tiết dùng chung và spec nghiệm thu

Trang nhà hàng đọc từ DB và mở cho mọi nhà hàng bật `has_detail_page` (spec §6.3 mục 1, §6.4, §14.1 dòng 6). Entry cache của trang mang `restaurants` (một lần lưu làm hết hạn danh mục cũng xóa 404 đã cache của nhà hàng vừa bật trang) và `restaurant:<id>`. `TayaHero`/`TayaExperiences` thành `RestaurantHero`/`Highlights` (`git mv`; class `taya-*` giữ nguyên, nên pixel cũng vậy). Nghiệm thu A2: trang của The Fan đi từ 404 đã cache tới một trang chạy được sau một lần lưu, rồi trở lại.

**Files:**
- Create: `e2e/restaurant-page.spec.ts`, `e2e/restaurant-pages.serial.spec.ts`
- Rename + rewrite: `components/detail/TayaHero.tsx` → `components/detail/RestaurantHero.tsx`, `components/detail/TayaExperiences.tsx` → `components/detail/Highlights.tsx`
- Modify: `app/(site)/[lang]/(guarded)/restaurants/[slug]/page.tsx`, `components/detail/MoreRestaurants.tsx`, `components/site/MobileBar.tsx`, `lib/content/types.ts`, `lib/cache-plan.ts` (`detail`, `detailSlugs`), `lib/server/content/restaurants.queries.ts`, `lib/server/content/restaurants.ts`, `scripts/check-prerender.mjs` (`PAGE_TAGS`), `e2e/page-scope.spec.ts` (comment)
- Test: `test/integration/content-loaders.test.ts`, `test/integration/content-seed.test.ts`

**Interfaces:**
- Consumes: `LOCALE_CTE`, `i18nJoin`, `tr`, `mediaJson`; `getEnabledLocales()`, `requireEnabledLocale(code)` (`lib/server/content/locales.ts`, Task 6); `TAGS.restaurant(id)`; `useSite()` (`restaurants`, `goBackToRestaurants`, `openReserve`, `scrollToId`, `setBooking`, `clearFilters`); `CmsImage` (Task 5).
- Produces:
  - `lib/content/types.ts`: `Highlight = { id: number; image: Media; title: string; detail: string }`; `MenuAction = { kind: 'pdf'; url: string } | { kind: 'scroll' }`; `RestaurantDetail = { id, slug, name, destinationName: string, kicker: string | null, storyLabel: string | null, story: string | null, highlightsTitle: string | null, portrait: Media, bookingEnabled: boolean, phone: Phone | null, map: string | null, menu: MenuAction | null, highlights: Highlight[], seo: { title: string | null; description: string | null } }`.
  - `lib/server/content/restaurants.queries.ts`: `loadDetailSlugs(): Promise<string[]>`, `loadRestaurantDetail(slug, locale): Promise<RestaurantDetail | null>`; `restaurants.ts`: `getDetailSlugs()`, `getRestaurantDetail(slug, locale)` (thêm `cacheTag(TAGS.restaurant(id))` sau truy vấn).
  - `RestaurantHero({ detail })`, `Highlights({ title, items })`, `MoreRestaurants({ slug, destinationName })` (giữ `restaurants.find((r) => r.slug === slug)`: `e2e/page-scope.spec.ts` tiêm lỗi qua đó), `MobileBar({ detail?: RestaurantDetail })` (số cột = số nút hiện; không nút nào thì `null`), `openMenu(menu: MenuAction, scrollToHighlights: () => void)` (thay `openMenuPdf`).

- [ ] **Bước 1: Viết E2E của trang Tàya và của nghiệm thu**

`restaurant-page.spec.ts` chỉ đọc: tiêu đề, mô tả, CALL và MAP của resort; MENU mở PDF ở tab mới (URL thật được thay bằng `context.route`, kiểu text/plain để Chromium headless hiện chứ không tải về) và trang không cuộn. `restaurant-pages.serial.spec.ts` là nghiệm thu: ghi thẳng DB (đợt 6 chưa có trình soạn nhà hàng) rồi lưu form quy tắc đặt bàn của the-fan (gọi `updateTag('restaurants')`, như lần lưu của trình soạn đợt 7 sẽ làm), và trả lại bằng chính đường đó trong `finally` (R21).

Create `e2e/restaurant-page.spec.ts`:

```ts
import { DETAIL_PATH } from './paths';
import { expect, test } from './staff-fixtures';

/*
 * Tàya House's page, read from the database since phase 6 (its pixels are
 * the visual baselines). Reads only.
 */

const TARIFF = 'https://furamavietnam.com/wp-content/uploads/2026/03/Taya-CC-Tariff-A4-1-25.pdf';

test.use({ reducedMotion: 'reduce' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

test('the page carries its own title, description, CALL and MAP from the database', async ({ page }) => {
  await page.goto(DETAIL_PATH);
  await expect(page).toHaveTitle('Tàya House — Furama Cuisine');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /^A wellness dining home beneath the Lagoon Garden/);
  const hero = page.locator('.taya-hero-copy');
  // The resort's: Tàya House has neither of its own (spec §6.4).
  await expect(hero.getByRole('link', { name: 'CALL' })).toHaveAttribute('href', 'tel:+842366519999');
  await expect(hero.getByRole('link', { name: 'MAP' })).toHaveAttribute('href', 'https://maps.google.com/?q=Furama+Resort+Danang');
  await expect(page.getByRole('heading', { name: 'More at Furama Resort Danang' })).toBeVisible();
});

test('MENU opens the menu PDF in a new tab and leaves the page where it was', async ({ page, context }) => {
  // Never reach the real host: the new tab gets a stand-in (text, so headless Chromium shows it rather than downloading it).
  await context.route(TARIFF, (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'tariff' }));
  await page.goto(DETAIL_PATH);
  const popup = context.waitForEvent('page');
  await page.locator('.taya-hero-copy').getByRole('button', { name: 'MENU' }).click();
  const tab = await popup;
  await tab.waitForURL(TARIFF);
  expect(await tab.evaluate(() => window.opener)).toBeNull();
  // The highlights are the fallback for a blocked popup only: the page has not moved.
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
```

Create `e2e/restaurant-pages.serial.spec.ts`:

```ts
import type { Browser, Page } from '@playwright/test';
import { DETAIL_PATH, HOME_PATH } from './paths';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * Phase 6's acceptance (spec §14.1 row 6): switching has_detail_page on for
 * another restaurant makes its page work, with no deploy. Steakhouse The Fan
 * gets a portrait, a kicker, an English story and two highlights (what the
 * phase-7 editor will ask for), then the switch. Phase 6 has no restaurant
 * editor, so the database is written directly and an existing admin save that
 * calls updateTag('restaurants') (the booking rules form) expires the cached
 * pages, as the editor's save will (R21: the restore goes through the same
 * save). The Fan has no map link and no menu PDF: MAP hides, and MENU scrolls
 * to the highlights; CALL is its destination's number.
 *
 * It changes what every guest page reads (the catalogue), so it runs in the
 * desktop-serial project, one file at a time, after every other spec.
 */

const FAN_PATH = '/en/restaurants/the-fan';

test.beforeAll(() => seedStaff());

async function openTheFan() {
  await one(
    `UPDATE restaurants SET has_detail_page = true, detail_image_id = (SELECT id FROM media WHERE pathname = '/assets/r-the-fan.jpg')
      WHERE id = 'the-fan'`,
  );
  await one(
    `UPDATE restaurant_i18n
        SET detail_kicker = 'Steak & Wine · Furama Dining House',
            story = 'Dry-aged cuts over charcoal and a cellar of New World reds, three floors above An Thượng.'
      WHERE restaurant_id = 'the-fan' AND locale = 'en'`,
  );
  await one(
    `WITH h(sort_order, pathname, title, detail) AS (
       VALUES (10, '/assets/story-the-fan.jpg', 'The Art Floor', 'Dinner among the paintings, 3F'),
              (20, '/assets/r-the-fan.jpg', 'Tomahawk for Two', 'Carved at the table')),
     ins AS (
       INSERT INTO restaurant_highlights (restaurant_id, image_id, sort_order)
       SELECT 'the-fan', m.id, h.sort_order FROM h JOIN media m ON m.pathname = h.pathname
       RETURNING id, sort_order)
     INSERT INTO restaurant_highlight_i18n (highlight_id, locale, title, detail)
     SELECT ins.id, 'en', h.title, h.detail FROM ins JOIN h USING (sort_order)`,
  );
}

async function closeTheFan() {
  await one(`DELETE FROM restaurant_highlights WHERE restaurant_id = 'the-fan'`);
  await one(`UPDATE restaurant_i18n SET detail_kicker = NULL, story = NULL WHERE restaurant_id = 'the-fan' AND locale = 'en'`);
  await one(`UPDATE restaurants SET has_detail_page = false, detail_image_id = NULL WHERE id = 'the-fan'`);
}

/** Saves The Fan's booking rules unchanged: the action calls updateTag('restaurants'). */
async function refreshGuestPages(page: Page) {
  await page.goto('/admin/restaurants/the-fan/booking');
  const rules = page.getByRole('form', { name: 'Quy tắc đặt bàn' });
  await rules.getByRole('checkbox', { name: /^Nhận đặt bàn online/ }).setChecked(true);
  await rules.getByRole('button', { name: 'Lưu quy tắc' }).click();
  await expect(page.getByRole('form', { name: 'Quy tắc đặt bàn' }).getByRole('status')).toHaveText('Đã lưu.');
}

/** A guest with no staff cookie, past the intro. */
async function guest(browser: Browser, viewport = { width: 1280, height: 860 }) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

test('switching has_detail_page on opens a working page for another restaurant, and off closes it again', async ({ page, browser }) => {
  const visitor = await guest(browser);
  // Before: no page (a cached 404 from here on, tagged restaurants), and the card only reserves.
  const before = await visitor.request.get(FAN_PATH);
  expect(await before.text()).toContain('Page not found');
  await visitor.goto(HOME_PATH);
  await expect(visitor.locator('.rcard:visible', { hasText: 'Steakhouse The Fan' }).locator('.rcard-tag')).toHaveText('Reserve a table →');

  await signInAs(page, STAFF.editor);
  await openTheFan();
  try {
    await refreshGuestPages(page);

    // The page renders from the database, at a URL that was a cached 404 a moment ago.
    await visitor.goto(FAN_PATH);
    await expect(visitor).toHaveTitle('Steakhouse The Fan — Furama Cuisine');
    const hero = visitor.locator('.taya-hero-copy');
    await expect(hero.getByRole('heading', { level: 1 })).toHaveText('Steakhouse The Fan');
    await expect(hero.locator('.taya-kicker')).toHaveText('Steak & Wine · Furama Dining House');
    await expect(hero.locator('.taya-story-label')).toHaveText('Brand Story');
    await expect(hero.locator('.taya-story')).toContainText('three floors above An Thượng');
    await expect(visitor.locator('.taya-portrait img')).toHaveAttribute('src', '/assets/r-the-fan.jpg');
    // CALL is the dining house's number; no map link anywhere, so no MAP.
    await expect(hero.getByRole('link', { name: 'CALL' })).toHaveAttribute('href', 'tel:+84859555759');
    await expect(hero.getByRole('link', { name: 'MAP' })).toHaveCount(0);
    await expect(visitor.getByRole('heading', { name: 'At Steakhouse The Fan' })).toBeVisible();
    await expect(visitor.locator('#dishes .dish-title')).toHaveText(['The Art Floor', 'Tomahawk for Two']);
    await expect(visitor.getByRole('heading', { name: 'More at Furama Dining House' })).toBeVisible();
    await expect(visitor.locator('.more-rail .rcard-name')).toHaveText(['Phố Cuốn', 'Thai Siam Kitchen', 'Hura Izakaya']);

    // No PDF: MENU takes the guest to the highlights.
    await hero.getByRole('button', { name: 'MENU' }).click();
    await expect.poll(() => visitor.locator('#dishes').evaluate((e) => Math.round(e.getBoundingClientRect().top))).toBeLessThan(120);

    // RESERVE books this restaurant.
    await hero.getByRole('button', { name: /RESERVE A TABLE/ }).click();
    await expect(visitor.getByRole('dialog', { name: 'Reserve a table' }).locator('.drawer-name')).toHaveText('Steakhouse The Fan');
    await visitor.keyboard.press('Escape');

    // From the home page, the card now opens the page, without a reload.
    await visitor.goto(HOME_PATH);
    await visitor.evaluate(() => {
      (window as Window & { pageMark?: string }).pageMark = 'same document';
    });
    const card = visitor.locator('.rcard:visible', { hasText: 'Steakhouse The Fan' });
    await expect(card.locator('.rcard-tag')).toHaveText('View restaurant →');
    await card.click();
    await visitor.waitForURL((u) => u.pathname === FAN_PATH);
    await expect(visitor.locator('.taya-kicker:visible')).toHaveText('Steak & Wine · Furama Dining House');
    expect(await visitor.evaluate(() => (window as Window & { pageMark?: string }).pageMark)).toBe('same document');

    // A phone gets one tab per button shown: CALL, MENU, RESERVE.
    const phone = await guest(browser, { width: 390, height: 844 });
    await phone.goto(FAN_PATH);
    const bar = phone.getByRole('navigation', { name: 'Restaurant actions' });
    await expect(bar.getByRole('link')).toHaveText(['CALL']);
    await expect(bar.getByRole('button')).toHaveText(['MENU', 'RESERVE']);
    await expect(bar).toHaveAttribute('style', /repeat\(3, minmax\(0, 1fr\)\)/);
    // Tàya House keeps all four.
    await phone.goto(DETAIL_PATH);
    await expect(phone.getByRole('navigation', { name: 'Restaurant actions' })).toHaveAttribute('style', /repeat\(4, minmax\(0, 1fr\)\)/);
    await phone.context().close();
  } finally {
    await closeTheFan();
    await refreshGuestPages(page);
  }

  // Off again: the page 404s and the card reserves.
  const after = await visitor.request.get(FAN_PATH);
  expect(await after.text()).toContain('Page not found');
  await visitor.goto(HOME_PATH);
  await expect(visitor.locator('.rcard:visible', { hasText: 'Steakhouse The Fan' }).locator('.rcard-tag')).toHaveText('Reserve a table →');
  await visitor.context().close();
});
```

- [ ] **Bước 2: Build code hiện tại và chạy hai spec mới: phải đỏ**

Reset DB E2E, build, rồi:

```bash
rm -f "${TMPDIR:-/tmp}/furama-e2e-emails.ndjson"
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson CRON_SECRET=$(openssl rand -hex 16) E2E_PORT=3210 npx playwright test --retries=0 e2e/restaurant-page.spec.ts e2e/restaurant-pages.serial.spec.ts --no-deps
```

Expected: `2 failed`, `1 passed` (tiêu đề và CALL/MAP của Tàya đã đúng; MENU mở PDF rồi vẫn cuộn trang, vì `window.open(url, '_blank', 'noopener')` luôn trả `null`; trang của The Fan vẫn 404 vì danh sách trang là hằng):

```
  ✓  1 [desktop] › e2e/restaurant-page.spec.ts:16:5 › the page carries its own title, description, CALL and MAP from the database (192ms)
  ✘  3 [desktop] › e2e/restaurant-page.spec.ts:27:5 › MENU opens the menu PDF in a new tab and leaves the page where it was (642ms)
  ✘  2 [desktop-serial] › e2e/restaurant-pages.serial.spec.ts:70:5 › switching has_detail_page on opens a working page for another restaurant, and off closes it again (6.3s)
    Error: expect(received).toBe(expected) // Object.is equality
    Expected: 0
    Received: 763
    > 38 |   expect(await page.evaluate(() => window.scrollY)).toBe(0);
    Error: expect(page).toHaveTitle(expected) failed
    Expected: "Steakhouse The Fan — Furama Cuisine"
    Received: "Page not found — Furama Cuisine"
    > 85 |     await expect(visitor).toHaveTitle('Steakhouse The Fan — Furama Cuisine');
```

(`finally` của spec nghiệm thu đã tắt trang của The Fan và lưu lại form quy tắc.)

- [ ] **Bước 3: Viết test của loader trang chi tiết**

Trang Tàya bằng bản đông cứng; không trang khi tắt, slug lạ, chưa đăng, đã lưu trữ; bật trang cho The Fan (CALL của Dining House, không MAP, MENU cuộn tới highlight khi có, ẩn khi không); số và bản đồ riêng của nhà hàng thắng; PDF của ngôn ngữ đang xem, rồi của ngôn ngữ mặc định.

Sửa `test/integration/content-loaders.test.ts`:

```diff
diff --git a/test/integration/content-loaders.test.ts b/test/integration/content-loaders.test.ts
index f55e63a..cd596b6 100644
--- a/test/integration/content-loaders.test.ts
+++ b/test/integration/content-loaders.test.ts
@@ -2,11 +2,13 @@ import { afterAll, afterEach, describe, expect, it } from 'vitest';
 import { getPool } from '@/db/client';
 import { FALLBACK_PHONE } from '@/lib/data';
 import { loadExperiences, loadHeroSlides, loadStories } from '@/lib/server/content/home.queries';
+import { loadDetailSlugs, loadRestaurantDetail } from '@/lib/server/content/restaurants.queries';
 import { loadSiteSettings } from '@/lib/server/content/settings.queries';
 import { loadCuisines, loadDestinations, loadNav, loadSections, loadSocials } from '@/lib/server/content/site.queries';
 import {
   CUISINES_AT_8FE98F5,
   DESTINATIONS_AT_8FE98F5,
+  DETAIL_PAGES_AT_8FE98F5,
   EXPERIENCES_AT_8FE98F5,
   HERO_AUTOPLAY_MS_AT_8FE98F5,
   HERO_SLIDES_AT_8FE98F5,
@@ -42,6 +44,13 @@ describe.skipIf(!process.env.TEST_DATABASE_URL)('content loaders (database)', ()
     await sql(`UPDATE experiences SET is_published = true`);
     await sql(`UPDATE stories SET is_published = true`);
     await sql(`UPDATE hero_slides SET is_published = true`);
+    await sql(`UPDATE restaurants SET is_published = true, archived_at = NULL, phone_e164 = NULL, phone_display = NULL, map_url = NULL`);
+    await sql(`DELETE FROM restaurant_highlights WHERE restaurant_id <> 'taya-house'`);
+    await sql(`UPDATE restaurants SET has_detail_page = false, detail_image_id = NULL WHERE id <> 'taya-house'`);
+    await sql(`DELETE FROM restaurant_i18n WHERE locale <> 'en'`);
+    await sql(
+      `UPDATE restaurant_i18n SET detail_kicker = NULL, story = NULL, menu_pdf_url = NULL WHERE restaurant_id <> 'taya-house'`,
+    );
   });
   afterAll(() => getPool().end());
 
@@ -113,6 +122,99 @@ describe.skipIf(!process.env.TEST_DATABASE_URL)('content loaders (database)', ()
     });
   });
 
+  describe('restaurant pages (spec §6.4, §14.1 row 6)', () => {
+    /** Switches a restaurant's page on as the acceptance spec does: a portrait, a kicker, an English story. */
+    async function openPage(id: string, portrait: string) {
+      await sql(`UPDATE restaurants SET has_detail_page = true, detail_image_id = (SELECT id FROM media WHERE pathname = $2) WHERE id = $1`, [
+        id,
+        portrait,
+      ]);
+      await sql(`UPDATE restaurant_i18n SET detail_kicker = 'A kicker', story = 'A story.' WHERE restaurant_id = $1 AND locale = 'en'`, [id]);
+    }
+
+    it('Tàya House’s page is the one the site drew: copy, portrait, SEO, menu, the resort’s CALL and MAP, the four highlights', async () => {
+      const taya = DETAIL_PAGES_AT_8FE98F5['taya-house'];
+      const d = await loadRestaurantDetail('taya-house', 'en');
+      expect(d).toMatchObject({
+        id: 'taya-house',
+        slug: 'taya-house',
+        name: 'Tàya House',
+        destinationName: 'Furama Resort Danang',
+        kicker: taya.kicker,
+        story: taya.story,
+        storyLabel: null,
+        highlightsTitle: null,
+        portrait: { url: taya.portrait, alt: taya.portraitAlt },
+        bookingEnabled: true,
+        menu: { kind: 'pdf', url: taya.menuPdf },
+        phone: { tel: taya.call, display: '+84 236 651 9999' },
+        map: taya.map,
+        seo: taya.seo,
+      });
+      expect(d?.highlights.map((h) => ({ image: h.image.url, alt: h.image.alt, title: h.title, detail: h.detail }))).toEqual(taya.highlights);
+      expect(await loadDetailSlugs()).toEqual(['taya-house']);
+    });
+
+    it('none for a restaurant without has_detail_page, an unknown slug, an unpublished or an archived one', async () => {
+      expect(await loadRestaurantDetail('danaksara', 'en')).toBeNull();
+      expect(await loadRestaurantDetail('nope', 'en')).toBeNull();
+      await sql(`UPDATE restaurants SET is_published = false WHERE id = 'taya-house'`);
+      expect(await loadRestaurantDetail('taya-house', 'en')).toBeNull();
+      expect(await loadDetailSlugs()).toEqual([]);
+      await sql(`UPDATE restaurants SET is_published = true, archived_at = now() WHERE id = 'taya-house'`);
+      expect(await loadRestaurantDetail('taya-house', 'en')).toBeNull();
+    });
+
+    it('switching has_detail_page on for another restaurant gives it a page: its destination’s CALL, no MAP, MENU to its highlights or none', async () => {
+      await openPage('the-fan', '/assets/r-the-fan.jpg');
+      expect(await loadDetailSlugs()).toEqual(['taya-house', 'the-fan']);
+      expect(await loadRestaurantDetail('the-fan', 'en')).toMatchObject({
+        name: 'Steakhouse The Fan',
+        destinationName: 'Furama Dining House',
+        kicker: 'A kicker',
+        story: 'A story.',
+        portrait: { url: '/assets/r-the-fan.jpg', alt: 'Steakhouse The Fan' },
+        phone: { tel: '+84859555759', display: '0859 555 759' },
+        map: null,
+        menu: null,
+        highlights: [],
+        seo: { title: null, description: null },
+      });
+      await sql(
+        `INSERT INTO restaurant_highlights (restaurant_id, image_id) SELECT 'the-fan', id FROM media WHERE pathname = '/assets/story-the-fan.jpg'`,
+      );
+      // A highlight without its English title shows nothing, so it is left out.
+      expect((await loadRestaurantDetail('the-fan', 'en'))?.highlights).toEqual([]);
+      await sql(
+        `INSERT INTO restaurant_highlight_i18n (highlight_id, locale, title, detail)
+         SELECT id, 'en', 'The Art Floor', 'Dinner among the paintings' FROM restaurant_highlights WHERE restaurant_id = 'the-fan'`,
+      );
+      expect(await loadRestaurantDetail('the-fan', 'en')).toMatchObject({
+        menu: { kind: 'scroll' },
+        highlights: [{ title: 'The Art Floor', detail: 'Dinner among the paintings', image: { url: '/assets/story-the-fan.jpg', alt: '' } }],
+      });
+    });
+
+    it('a restaurant’s own number and map beat its destination’s; a destination without them hides the buttons', async () => {
+      await sql(`UPDATE restaurants SET phone_e164 = '+842363847333', phone_display = '0236 3847 333', map_url = 'https://maps.example/taya' WHERE id = 'taya-house'`);
+      expect(await loadRestaurantDetail('taya-house', 'en')).toMatchObject({
+        phone: { tel: '+842363847333', display: '0236 3847 333' },
+        map: 'https://maps.example/taya',
+      });
+      await openPage('chaoshan-hotpot', '/assets/r-chaoshan-hotpot.jpg');
+      expect(await loadRestaurantDetail('chaoshan-hotpot', 'en')).toMatchObject({ phone: null, map: null, destinationName: 'Furama MM Supercenter' });
+    });
+
+    it('the menu PDF of the page’s language, else the default language’s', async () => {
+      await sql(`INSERT INTO restaurant_i18n (restaurant_id, locale, story, status) VALUES ('taya-house', 'vi', 'Câu chuyện.', 'reviewed')`);
+      const vi = await loadRestaurantDetail('taya-house', 'vi');
+      expect(vi).toMatchObject({ story: 'Câu chuyện.', kicker: DETAIL_PAGES_AT_8FE98F5['taya-house'].kicker });
+      expect(vi?.menu).toEqual({ kind: 'pdf', url: DETAIL_PAGES_AT_8FE98F5['taya-house'].menuPdf });
+      await sql(`UPDATE restaurant_i18n SET menu_pdf_url = 'https://furamavietnam.com/menu-vi.pdf' WHERE restaurant_id = 'taya-house' AND locale = 'vi'`);
+      expect((await loadRestaurantDetail('taya-house', 'vi'))?.menu).toEqual({ kind: 'pdf', url: 'https://furamavietnam.com/menu-vi.pdf' });
+    });
+  });
+
   describe('languages (spec §5.1 item 5)', () => {
     it('a story or an experience translated in part keeps the default language’s other fields', async () => {
       await sql(`INSERT INTO experience_i18n (experience_id, locale, title, status) VALUES (1, 'vi', 'Trải nghiệm ẩm thực', 'reviewed')`);
```

- [ ] **Bước 4: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/content-loaders.test.ts`
Expected: FAIL `Test Files  1 failed (1)`, `Tests  5 failed | 17 passed (22)`:

```
       × Tàya House’s page is the one the site drew: copy, portrait, SEO, menu, the resort’s CALL and MAP, the four highlights 7ms
       × none for a restaurant without has_detail_page, an unknown slug, an unpublished or an archived one 4ms
       × switching has_detail_page on for another restaurant gives it a page: its destination’s CALL, no MAP, MENU to its highlights or none 5ms
       × a restaurant’s own number and map beat its destination’s; a destination without them hides the buttons 4ms
       × the menu PDF of the page’s language, else the default language’s 4ms
TypeError: loadRestaurantDetail is not a function
TypeError: loadDetailSlugs is not a function
```

- [ ] **Bước 5: Kiểu và loader của trang chi tiết**

Sửa `lib/content/types.ts`:

```diff
diff --git a/lib/content/types.ts b/lib/content/types.ts
index d54280b..054df06 100644
--- a/lib/content/types.ts
+++ b/lib/content/types.ts
@@ -73,6 +73,38 @@ export type Experience = { id: number; title: string; blurb: string; href: strin
 /** A story card: the kicker is already "Category · 9 Sep 2026" (lib/content/format.ts). */
 export type Story = { id: number; image: Media | null; kicker: string; title: string; href: string };
 
+/** A card of a restaurant page's highlights (restaurant_highlights). */
+export type Highlight = { id: number; image: Media; title: string; detail: string };
+
+/** What a restaurant page's MENU does: open the menu PDF (this language's, else the default language's), or scroll to the highlights. */
+export type MenuAction = { kind: 'pdf'; url: string } | { kind: 'scroll' };
+
+/** One restaurant's page (spec §6.4), resolved for one language; CALL and MAP already fall back to the destination's. */
+export type RestaurantDetail = {
+  id: string;
+  slug: string;
+  name: string;
+  /** "More at …": the destination's name in this language. */
+  destinationName: string;
+  kicker: string | null;
+  /** null: the default label ("Brand Story"). */
+  storyLabel: string | null;
+  story: string | null;
+  /** null: "At {name}". */
+  highlightsTitle: string | null;
+  portrait: Media;
+  /** restaurants.booking_enabled: RESERVE shows only when it books online. */
+  bookingEnabled: boolean;
+  /** The restaurant's number, else its destination's; null hides CALL. */
+  phone: Phone | null;
+  /** The restaurant's map link, else its destination's; null hides MAP. */
+  map: string | null;
+  /** null hides MENU: no PDF in either language and no highlights to scroll to. */
+  menu: MenuAction | null;
+  highlights: Highlight[];
+  seo: { title: string | null; description: string | null };
+};
+
 /** Everything the chrome (header, menu, footer, finder, search, booking bar) needs, on every guest page. */
 export type SiteContent = {
   cuisines: Cuisine[];
```

Sửa `lib/server/content/restaurants.queries.ts`:

```diff
diff --git a/lib/server/content/restaurants.queries.ts b/lib/server/content/restaurants.queries.ts
index c5c51d4..cfea700 100644
--- a/lib/server/content/restaurants.queries.ts
+++ b/lib/server/content/restaurants.queries.ts
@@ -1,7 +1,7 @@
 import 'server-only';
 import { query } from '@/db/client';
 import { fold } from '@/lib/booking';
-import type { Media } from '@/lib/content/types';
+import type { Highlight, Media, RestaurantDetail } from '@/lib/content/types';
 import { MEALS, type Meal, type Restaurant } from '@/lib/data';
 import { LOCALE_CTE, i18nJoin, mediaJson, tr } from './sql';
 
@@ -95,3 +95,97 @@ export async function loadRestaurants(locale: string): Promise<Restaurant[]> {
     };
   });
 }
+
+/** Slugs with a page (generateStaticParams); unpublished or archived restaurants have none. */
+export async function loadDetailSlugs(): Promise<string[]> {
+  const rows = await query<{ slug: string }>(
+    `SELECT slug FROM restaurants
+      WHERE has_detail_page AND is_published AND archived_at IS NULL
+      ORDER BY sort_order, id`,
+  );
+  return rows.map((r) => r.slug);
+}
+
+type DetailRow = {
+  id: string;
+  slug: string;
+  name: string;
+  destination_name: string | null;
+  kicker: string | null;
+  story_label: string | null;
+  story: string | null;
+  highlights_title: string | null;
+  menu_pdf: string | null;
+  seo_title: string | null;
+  seo_description: string | null;
+  booking_enabled: boolean;
+  phone_e164: string | null;
+  phone_display: string | null;
+  map_url: string | null;
+  portrait: Media | null;
+};
+
+/**
+ * One restaurant's page, or null when it has none (no such slug, page off,
+ * unpublished, archived, or its portrait gone). CALL and MAP take the
+ * restaurant's own number and map, else its destination's (spec §6.4). MENU
+ * opens the PDF of this language, else the default language's (an uploaded
+ * file before a link), else scrolls to the highlights; with neither, no MENU.
+ */
+export async function loadRestaurantDetail(slug: string, locale: string): Promise<RestaurantDetail | null> {
+  const [row] = await query<DetailRow>(
+    `WITH ${LOCALE_CTE}
+     SELECT r.id, r.slug, r.name, ${tr('dt', 'name')} AS destination_name,
+            ${tr('rt', 'detail_kicker')} AS kicker, ${tr('rt', 'story_label')} AS story_label,
+            ${tr('rt', 'story')} AS story, ${tr('rt', 'highlights_title')} AS highlights_title,
+            coalesce((SELECT m.url FROM media m WHERE m.id = rt.menu_pdf_media_id AND m.deleted_at IS NULL), rt.menu_pdf_url,
+                     (SELECT m.url FROM media m WHERE m.id = rt_d.menu_pdf_media_id AND m.deleted_at IS NULL), rt_d.menu_pdf_url) AS menu_pdf,
+            ${tr('rt', 'seo_title')} AS seo_title, ${tr('rt', 'seo_description')} AS seo_description,
+            r.booking_enabled,
+            CASE WHEN r.phone_e164 IS NOT NULL THEN r.phone_e164 ELSE d.phone_e164 END AS phone_e164,
+            CASE WHEN r.phone_e164 IS NOT NULL THEN r.phone_display ELSE d.phone_display END AS phone_display,
+            coalesce(r.map_url, d.map_url) AS map_url,
+            img.j AS portrait
+       FROM restaurants r CROSS JOIN lc
+       JOIN destinations d ON d.id = r.destination_id
+       ${i18nJoin('restaurant_i18n', 'rt', 'restaurant_id', 'r.id')}
+       ${i18nJoin('destination_i18n', 'dt', 'destination_id', 'd.id')}
+       LEFT JOIN LATERAL ${mediaJson('r.detail_image_id')} AS img ON true
+      WHERE r.slug = $2 AND r.has_detail_page AND r.is_published AND r.archived_at IS NULL`,
+    [locale, slug],
+  );
+  if (!row || !row.portrait) return null;
+
+  const highlights = await query<{ id: string; title: string; detail: string | null; image: Media | null }>(
+    `WITH ${LOCALE_CTE}
+     SELECT h.id::text, ${tr('ht', 'title')} AS title, ${tr('ht', 'detail')} AS detail, img.j AS image
+       FROM restaurant_highlights h CROSS JOIN lc
+       ${i18nJoin('restaurant_highlight_i18n', 'ht', 'highlight_id', 'h.id')}
+       LEFT JOIN LATERAL ${mediaJson('h.image_id')} AS img ON true
+      WHERE h.restaurant_id = $2 AND h.is_published AND ${tr('ht', 'title')} IS NOT NULL
+      ORDER BY h.sort_order, h.id`,
+    [locale, row.id],
+  );
+  // A highlight whose picture was soft-deleted has nothing to show.
+  const cards = highlights.flatMap((h): Highlight[] =>
+    h.image ? [{ id: Number(h.id), title: h.title, detail: h.detail ?? '', image: h.image }] : [],
+  );
+
+  return {
+    id: row.id,
+    slug: row.slug,
+    name: row.name,
+    destinationName: row.destination_name ?? '',
+    kicker: row.kicker,
+    storyLabel: row.story_label,
+    story: row.story,
+    highlightsTitle: row.highlights_title,
+    portrait: row.portrait,
+    bookingEnabled: row.booking_enabled,
+    phone: row.phone_e164 && row.phone_display ? { tel: row.phone_e164, display: row.phone_display } : null,
+    map: row.map_url,
+    menu: row.menu_pdf ? { kind: 'pdf', url: row.menu_pdf } : cards.length > 0 ? { kind: 'scroll' } : null,
+    highlights: cards,
+    seo: { title: row.seo_title, description: row.seo_description },
+  };
+}
```

Một `null` cũng được cache, dưới `restaurants`: bật một trang (bất kỳ lần lưu nào làm hết hạn danh mục) xóa 404 đã cache. Sửa `lib/server/content/restaurants.ts`:

```diff
diff --git a/lib/server/content/restaurants.ts b/lib/server/content/restaurants.ts
index b85f85b..5f3fbfc 100644
--- a/lib/server/content/restaurants.ts
+++ b/lib/server/content/restaurants.ts
@@ -2,8 +2,9 @@ import 'server-only';
 import { cacheLife, cacheTag } from 'next/cache';
 import { LOADERS } from '@/lib/cache-plan';
 import { TAGS } from '@/lib/cache-tags';
+import type { RestaurantDetail } from '@/lib/content/types';
 import type { Restaurant } from '@/lib/data';
-import { loadRestaurants } from './restaurants.queries';
+import { loadDetailSlugs, loadRestaurantDetail, loadRestaurants } from './restaurants.queries';
 
 /*
  * Restaurants, cached (see lib/server/content/site.ts for the rules). Booking
@@ -18,3 +19,27 @@ export async function getRestaurants(locale: string): Promise<Restaurant[]> {
   cacheTag(...LOADERS.restaurants.tags, TAGS.i18n(locale));
   return loadRestaurants(locale);
 }
+
+/** The slugs prerendered at build (generateStaticParams). */
+export async function getDetailSlugs(): Promise<string[]> {
+  'use cache';
+  cacheLife('max');
+  cacheTag(...LOADERS.detailSlugs.tags);
+  return loadDetailSlugs();
+}
+
+/**
+ * One restaurant's page, or null (notFound). A null is cached too, under
+ * `restaurants`: switching a page on (any save that expires the catalogue)
+ * clears the cached 404 (spec §14.1 row 6). Once the slug is known to be a
+ * restaurant, the entry also carries restaurant:<id>, which phase 7's editor
+ * of that restaurant expires.
+ */
+export async function getRestaurantDetail(slug: string, locale: string): Promise<RestaurantDetail | null> {
+  'use cache';
+  cacheLife('max');
+  cacheTag(...LOADERS.detail.tags, TAGS.i18n(locale));
+  const detail = await loadRestaurantDetail(slug, locale);
+  if (detail) cacheTag(TAGS.restaurant(detail.id));
+  return detail;
+}
```

Sửa `lib/cache-plan.ts`:

```diff
diff --git a/lib/cache-plan.ts b/lib/cache-plan.ts
index 7e9ec72..25d4ec8 100644
--- a/lib/cache-plan.ts
+++ b/lib/cache-plan.ts
@@ -118,6 +118,22 @@ export const LOADERS = {
   heroSlides: { reads: ['locales', 'hero_slides', 'media', 'media_i18n'], tags: [TAGS.contentHero, TAGS.media] },
   experiences: { reads: ['locales', 'experiences', 'experience_i18n'], tags: [TAGS.contentExperiences] },
   stories: { reads: ['locales', 'stories', 'story_i18n', 'media', 'media_i18n'], tags: [TAGS.contentStories, TAGS.media] },
+  // Plus restaurant:<id>, added once the query has found the restaurant.
+  detail: {
+    reads: [
+      'locales',
+      'restaurants',
+      'restaurant_i18n',
+      'restaurant_highlights',
+      'restaurant_highlight_i18n',
+      'destinations',
+      'destination_i18n',
+      'media',
+      'media_i18n',
+    ],
+    tags: [TAGS.restaurants, TAGS.contentDestinations, TAGS.media],
+  },
+  detailSlugs: { reads: ['restaurants'], tags: [TAGS.restaurants] },
 } as const satisfies Record<string, Loader>;
 
 export type LoaderName = keyof typeof LOADERS;
```

- [ ] **Bước 6: Route của trang**

`generateStaticParams` trả các slug đang có trang, hoặc `['_none']` khi chưa có trang nào (Cache Components báo lỗi build với mảng rỗng, `migrating-to-cache-components.md:570`; không slug nào trùng được nó vì `restaurants_slug_check`). Không export `dynamicParams` (`dynamicParams.md:22`): slug lạ render lúc request và `notFound()` trả lời (`migrating-to-cache-components.md:612`). `generateMetadata` trả tiêu đề "không thấy trang" + noindex cho slug lạ và cho ngôn ngữ đang tắt (R14). `params` vẫn `await` ở đầu (quy tắc no-JS của đợt 2), rồi `await requireEnabledLocale(lang)` trước `getRestaurantDetail` (guard của Task 6 đòi: layout kiểm ngôn ngữ song song với trang).

Thay toàn bộ `app/(site)/[lang]/(guarded)/restaurants/[slug]/page.tsx` bằng:

```tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RestaurantHero } from '@/components/detail/RestaurantHero';
import { Highlights } from '@/components/detail/Highlights';
import { MoreRestaurants } from '@/components/detail/MoreRestaurants';
import { IntroTrigger } from '@/components/site/IntroTrigger';
import { MobileBar } from '@/components/site/MobileBar';
import { ViewMarker } from '@/components/site/ViewMarker';
import { getEnabledLocales, requireEnabledLocale } from '@/lib/server/content/locales';
import { getDetailSlugs, getRestaurantDetail } from '@/lib/server/content/restaurants';

type Props = { params: Promise<{ lang: string; slug: string }> };

/**
 * Cache Components refuses an empty list (migrating-to-cache-components.md:570),
 * so with no page switched on the build prerenders this placeholder, which
 * 404s like any unknown slug. No restaurant can take it: a slug is lower-case
 * words and hyphens (restaurants_slug_check).
 */
const NO_PAGE_SLUG = '_none';

/**
 * Every restaurant whose page is on at build time is prerendered. A page
 * switched on later renders on its first visit and is cached from then on.
 * dynamicParams is not available with Cache Components (dynamicParams.md:22):
 * an unknown slug also renders on request, and notFound() below answers it
 * (a cached 404 tagged restaurants, R13).
 */
export async function generateStaticParams() {
  const slugs = await getDetailSlugs();
  return (slugs.length > 0 ? slugs : [NO_PAGE_SLUG]).map((slug) => ({ slug }));
}

const NOT_FOUND: Metadata = { title: 'Page not found — Furama Cuisine', robots: { index: false } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, slug } = await params;
  // A language that is off 404s in the layout; its tab must not carry the restaurant's title (phase-2 risk 7, R14).
  if (!(await getEnabledLocales()).some((l) => l.code === lang)) return NOT_FOUND;
  const detail = await getRestaurantDetail(slug, lang);
  if (!detail) return NOT_FOUND;
  // PHASE 7: the SEO editor fills these, and "{name} — Furama Cuisine" becomes a registry template.
  return {
    title: detail.seo.title ?? `${detail.name} — Furama Cuisine`,
    ...(detail.seo.description ? { description: detail.seo.description } : {}),
  };
}

/* The params read below blocks on purpose (see the comment on the page); this tells dev validation so. */
export const instant = false;

/*
 * params is awaited at the top, not inside <Suspense>. Inside a boundary even
 * the prerendered slugs ship their content as a streamed segment that only an
 * inline script reveals, so visitors without JS saw an empty page. The cost:
 * a slug missing from generateStaticParams gets no App Shell for this segment
 * and renders at request time on its first visit.
 *
 * The page is the restaurant's (restaurant_i18n, restaurant_highlights, spec
 * §6.4): one without has_detail_page, unpublished or archived is notFound()
 * and its card opens the reservation form instead.
 */
export default async function RestaurantPage({ params }: Props) {
  const { lang, slug } = await params;
  // Before the read: the layout's language check runs in parallel (requireEnabledLocale).
  await requireEnabledLocale(lang);
  const detail = await getRestaurantDetail(slug, lang);
  if (!detail) notFound();

  return (
    <ViewMarker view="detail" restaurant={slug}>
      <IntroTrigger />
      <RestaurantHero detail={detail} />
      {detail.highlights.length > 0 && (
        <Highlights title={detail.highlightsTitle ?? `At ${detail.name}`} items={detail.highlights} />
      )}
      <MoreRestaurants slug={detail.slug} destinationName={detail.destinationName} />
      <MobileBar detail={detail} />
    </ViewMarker>
  );
}
```

- [ ] **Bước 7: Component dùng chung cho mọi nhà hàng**

```bash
git mv components/detail/TayaHero.tsx components/detail/RestaurantHero.tsx
git mv components/detail/TayaExperiences.tsx components/detail/Highlights.tsx
```

Thay toàn bộ `components/detail/RestaurantHero.tsx` bằng (kicker và câu chuyện ẩn khi không có; nhãn câu chuyện mặc định "Brand Story"; CALL, MAP, MENU ẩn khi không dẫn tới đâu; chân dung vẫn là `<img>`, R3):

```tsx
'use client';

import type { RestaurantDetail } from '@/lib/content/types';
import { useSite } from '@/components/site/SiteProvider';
import { openMenu } from '@/components/site/MobileBar';
import { useReveal } from '@/lib/motion';

/*
 * One hero across breakpoints: desktop shows the two-column split with the
 * brand story beside a tall portrait, while a phone collapses to a full-bleed
 * image with an overlaid back button and the story beneath it.
 *
 * Every restaurant with a page uses it (spec §6.3 item 1, §6.4); the class
 * names keep the taya-* prefix of the one page it was drawn for, so the
 * stylesheet and the visual baselines stay as they were. A field the
 * restaurant does not have (kicker, story) hides its element.
 */
export function RestaurantHero({ detail }: { detail: RestaurantDetail }) {
  const { goBackToRestaurants, openReserve, scrollToId } = useSite();
  const story = useReveal<HTMLParagraphElement>('up');
  // PHASE 7: the default label becomes the registry key detail.story_label.
  const storyLabel = detail.storyLabel ?? 'Brand Story';
  const menu = detail.menu;

  return (
    <>
      <section className="taya-hero">
        <div className="shell-wide taya-hero-inner">
          <div className="taya-hero-copy">
            <button type="button" className="taya-back" data-intro="0" onClick={goBackToRestaurants}>
              <span aria-hidden="true">←</span>ALL RESTAURANTS
            </button>

            {detail.kicker && (
              <div className="taya-kicker" data-intro="1">
                {detail.kicker}
              </div>
            )}

            <h1 className="taya-title">
              <span className="line-mask">
                <span data-intro="2" data-intro-kind="line">
                  {detail.name}
                </span>
              </span>
            </h1>

            {detail.story && (
              <>
                <div className="taya-story-label" data-intro="3">
                  {storyLabel}
                </div>
                <p className="taya-story" data-intro="4">
                  {detail.story}
                </p>
              </>
            )}

            <div className="taya-actions" data-intro="5">
              {/* restaurants.booking_enabled off: no RESERVE (spec §5.2). */}
              {detail.bookingEnabled && (
                <button
                  type="button"
                  className="btn-slab taya-reserve"
                  onClick={() => openReserve({ restaurant: detail.id })}
                >
                  RESERVE A TABLE<span className="arrow">→</span>
                </button>
              )}
              {/* The restaurant's own, else its destination's; neither hides the button (spec §6.4). */}
              {detail.phone && (
                <a href={`tel:${detail.phone.tel}`} className="taya-link">
                  CALL
                </a>
              )}
              {detail.map && (
                <a href={detail.map} target="_blank" rel="noopener" className="taya-link">
                  MAP
                </a>
              )}
              {menu && (
                <button type="button" className="taya-link" onClick={() => openMenu(menu, () => scrollToId('dishes'))}>
                  MENU
                </button>
              )}
            </div>
          </div>

          <div className="taya-portrait" data-intro="1" data-intro-kind="clip">
            {/* A plain <img> (R3): the page's LCP image, at the pixels the baselines were taken with. */}
            <img src={detail.portrait.url} alt={detail.portrait.alt} className="fill" fetchPriority="high" />
          </div>
        </div>

        <button type="button" className="taya-back-float" onClick={goBackToRestaurants}>
          <span aria-hidden="true">←</span>BACK
        </button>

        <div className="taya-hero-scrim" aria-hidden="true" />

        <div className="taya-hero-mobile-copy">
          {detail.kicker && (
            <div className="taya-kicker-m" data-intro="0">
              {detail.kicker}
            </div>
          )}
          <div className="taya-title-m">
            <span className="line-mask">
              <span data-intro="1" data-intro-kind="line">
                {detail.name}
              </span>
            </span>
          </div>
        </div>
      </section>

      {detail.story && (
        <section className="taya-story-mobile">
          <div className="taya-story-label">{storyLabel}</div>
          <p ref={story} data-reveal="up" className="taya-story-m">
            {detail.story}
          </p>
        </section>
      )}
    </>
  );
}
```

Thay toàn bộ `components/detail/Highlights.tsx` bằng (id `dishes` giữ: MENU cuộn tới đó; ảnh qua `CmsImage`):

```tsx
'use client';

import type { Highlight } from '@/lib/content/types';
import { CmsImage } from '@/components/ui/CmsImage';
import { useReveal } from '@/lib/motion';

/**
 * A restaurant page's highlights (restaurant_highlights; the page leaves the
 * section out when there are none). The id stays `dishes`, which MENU's
 * fallback scrolls to; the class names keep the first page's.
 */
export function Highlights({ title, items }: { title: string; items: Highlight[] }) {
  const heading = useReveal<HTMLHeadingElement>('title');

  return (
    <section id="dishes" className="dishes">
      <div className="shell">
        <h2 ref={heading} data-reveal="title" className="section-title">
          {title}
        </h2>

        <div className="dishes-rail">
          {items.map((h) => (
            <DishCard key={h.id} highlight={h} />
          ))}
        </div>
      </div>
    </section>
  );
}

function DishCard({ highlight }: { highlight: Highlight }) {
  const ref = useReveal<HTMLDivElement>('card');

  return (
    <div ref={ref} data-reveal="card" className="dish">
      <div className="dish-frame frame" data-reveal-img="1">
        <span className="dish-zoom" data-reveal-zoom="1">
          <CmsImage media={highlight.image} fill sizes="(max-width: 759px) 66vw, 240px" className="dish-img" />
        </span>
      </div>
      <div className="dish-title">{highlight.title}</div>
      <div className="dish-detail">{highlight.detail}</div>
    </div>
  );
}
```

Sửa `components/detail/MoreRestaurants.tsx`:

```diff
diff --git a/components/detail/MoreRestaurants.tsx b/components/detail/MoreRestaurants.tsx
index 4860b51..a7ba730 100644
--- a/components/detail/MoreRestaurants.tsx
+++ b/components/detail/MoreRestaurants.tsx
@@ -1,12 +1,16 @@
 'use client';
 
-import { DESTS } from '@/lib/data';
 import { useSite } from '@/components/site/SiteProvider';
 import { useReveal } from '@/lib/motion';
 import { RestaurantCard } from '@/components/home/RestaurantCard';
 
-/** The other restaurants at the same destination; hidden when there are none (spec §6.4). */
-export function MoreRestaurants({ slug }: { slug: string }) {
+/**
+ * The other restaurants at the same destination; hidden when there are none
+ * (spec §6.4). The list is the catalogue every page already has; the
+ * destination's name comes with the page. e2e/page-scope.spec.ts injects its
+ * fault through the restaurants.find() below, so keep that call.
+ */
+export function MoreRestaurants({ slug, destinationName }: { slug: string; destinationName: string }) {
   const { restaurants, clearFilters, scrollToId } = useSite();
   const title = useReveal<HTMLHeadingElement>('title');
   const link = useReveal<HTMLButtonElement>('fade');
@@ -20,7 +24,7 @@ export function MoreRestaurants({ slug }: { slug: string }) {
       <div className="shell">
         <div className="section-head">
           <h2 ref={title} data-reveal="title" className="section-title more-title">
-            More at {DESTS[current.dest]}
+            More at {destinationName}
           </h2>
           <button
             ref={link}
```

`openMenu` mở tab bằng `window.open(url, '_blank')` rồi tự cắt `opener`, và chỉ cuộn khi trình duyệt chặn popup (với `'noopener'` lời gọi luôn trả `null`, nên trước đây trang luôn cuộn đi dưới mọi PDF). Sửa `components/site/MobileBar.tsx`:

```diff
diff --git a/components/site/MobileBar.tsx b/components/site/MobileBar.tsx
index 65fd639..65ccf6f 100644
--- a/components/site/MobileBar.tsx
+++ b/components/site/MobileBar.tsx
@@ -1,39 +1,40 @@
 'use client';
 
-import { CONTACT, contactFor } from '@/lib/data';
+import type { MenuAction, RestaurantDetail } from '@/lib/content/types';
 import { useSite } from '@/components/site/SiteProvider';
 
 /**
  * The phone tab bar. Each page renders its own (inside its <ViewMarker>), so the
  * right variant is in the server HTML and a page hidden by <Activity> hides its
- * bar with it. The home page passes nothing, a restaurant page passes its slug.
+ * bar with it. The home page passes nothing, a restaurant page passes its page.
  */
-export function MobileBar({ slug }: { slug?: string }) {
-  const { restaurants, tab, openReserve, scrollToId, setBooking, close } = useSite();
+export function MobileBar({ detail }: { detail?: RestaurantDetail }) {
+  const { tab, openReserve, scrollToId, setBooking, close } = useSite();
 
-  if (slug) {
-    const restaurant = restaurants.find((r) => r.slug === slug);
-    const id = restaurant?.id ?? slug;
-    const contact = contactFor(restaurant?.dest);
-    const canReserve = restaurant?.bookingEnabled ?? false;
-    // One column per button shown (spec §6.4): MENU always; RESERVE when it books online; CALL and MAP when known.
-    const columns = 1 + (canReserve ? 1 : 0) + (contact.tel ? 1 : 0) + (contact.map ? 1 : 0);
+  if (detail) {
+    const id = detail.id;
+    const menu = detail.menu;
+    // One column per button shown (spec §6.4): RESERVE when it books online; CALL, MAP and MENU when they lead somewhere.
+    const columns = [detail.bookingEnabled, detail.phone, detail.map, menu].filter(Boolean).length;
+    if (columns === 0) return null;
     return (
       <nav
         className="tabbar tabbar-detail"
         aria-label="Restaurant actions"
         style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
       >
-        {contact.tel && <a href={`tel:${contact.tel}`}>CALL</a>}
-        {contact.map && (
-          <a href={contact.map} target="_blank" rel="noopener">
+        {detail.phone && <a href={`tel:${detail.phone.tel}`}>CALL</a>}
+        {detail.map && (
+          <a href={detail.map} target="_blank" rel="noopener">
             MAP
           </a>
         )}
-        <button type="button" onClick={() => openMenuPdf(() => scrollToId('dishes'))}>
-          MENU
-        </button>
-        {canReserve && (
+        {menu && (
+          <button type="button" onClick={() => openMenu(menu, () => scrollToId('dishes'))}>
+            MENU
+          </button>
+        )}
+        {detail.bookingEnabled && (
           <button
             type="button"
             className="tabbar-primary"
@@ -71,8 +72,19 @@ export function MobileBar({ slug }: { slug?: string }) {
   );
 }
 
-/** Opens the tariff PDF, falling back to the on-page section if popups are blocked. */
-export function openMenuPdf(fallback: () => void) {
-  const w = window.open(CONTACT.tariffPdf, '_blank', 'noopener');
-  if (!w) fallback();
+/**
+ * MENU (spec §6.4): the PDF in a new tab, falling back to the page's
+ * highlights when there is no PDF or the browser blocks the popup. Not
+ * window.open(url, '_blank', 'noopener'): with that feature it always returns
+ * null, so a blocked popup could not be told from an opened one and the page
+ * scrolled away under every PDF. The opener is cut by hand instead.
+ */
+export function openMenu(menu: MenuAction, scrollToHighlights: () => void) {
+  if (menu.kind === 'scroll') {
+    scrollToHighlights();
+    return;
+  }
+  const w = window.open(menu.url, '_blank');
+  if (w) w.opener = null;
+  else scrollToHighlights();
 }
```

- [ ] **Bước 8: Tag của trang Tàya, comment chỗ tiêm lỗi, chữ component cuối cùng**

Sửa `scripts/check-prerender.mjs`:

```diff
diff --git a/scripts/check-prerender.mjs b/scripts/check-prerender.mjs
index c73e159..4587dde 100644
--- a/scripts/check-prerender.mjs
+++ b/scripts/check-prerender.mjs
@@ -45,9 +45,10 @@ const TAGS = [
   'content:contact',
   'media',
 ];
-/** Tags a page carries beyond the layout's: the home page's lists (lib/server/content/home.ts), the privacy policy's text (legal.ts). */
+/** Tags a page carries beyond the layout's: the home page's lists (lib/server/content/home.ts), a restaurant page's own (restaurants.ts), the privacy policy's text (legal.ts). */
 const PAGE_TAGS = {
   '/en': ['content:hero', 'content:experiences', 'content:stories'],
+  '/en/restaurants/taya-house': ['restaurant:taya-house'],
   '/en/privacy': ['content:legal'],
 };
 const REVALIDATE = 2_592_000; // cacheLife('max'): 30 days
```

Sửa `e2e/page-scope.spec.ts`:

```diff
diff --git a/e2e/page-scope.spec.ts b/e2e/page-scope.spec.ts
index 1b44794..a63e755 100644
--- a/e2e/page-scope.spec.ts
+++ b/e2e/page-scope.spec.ts
@@ -129,7 +129,7 @@ test('a second visit to the restaurant page plays its entrance again', async ({
 
 test('navigation still works after the error page replaces a page the curtain was covering', async ({ page }) => {
   await page.goto(HOME_PATH);
-  // Test-only fault: while armed, TayaHero's restaurants.find(r => r.slug === slug) throws,
+  // Test-only fault: while armed, MoreRestaurants' restaurants.find(r => r.slug === slug) throws,
   // so the restaurant page fails to render under the covering curtain and [lang]/error.tsx
   // takes over (and unmounts the curtain mid-cover). No production code is involved.
   await page.evaluate(() => {
```

Khối 1 của test seed hết chữ component (chỉ còn so bản đông cứng với `lib/data.ts`, Task 10 xóa nốt); bỏ luôn hai hàm phụ không còn dùng. Sửa `test/integration/content-seed.test.ts`:

```diff
diff --git a/test/integration/content-seed.test.ts b/test/integration/content-seed.test.ts
index 3e1b383..99633f7 100644
--- a/test/integration/content-seed.test.ts
+++ b/test/integration/content-seed.test.ts
@@ -53,8 +53,6 @@ function price(amount: string, currency: string, basis: string): string {
   return `${currency} ${new Intl.NumberFormat('en').format(Number(amount))}${basis === 'plus_plus' ? '++' : ' net'} per guest`;
 }
 
-const collapse = (s: string) => s.replace(/\s+/g, ' ');
-const source = (path: string) => collapse(readFileSync(path, 'utf8'));
 
 describe('the snapshot is the content of 8fe98f5 (delete with the constants and literals it mirrors)', () => {
   it('matches lib/data.ts', () => {
@@ -85,14 +83,6 @@ describe('the snapshot is the content of 8fe98f5 (delete with the constants and
     expect(DESTINATIONS_AT_8FE98F5[0].footer.endsWith(DATA.CONTACT.resortPhoneLabel)).toBe(true);
     expect(DESTINATIONS_AT_8FE98F5[1].footer.endsWith(DATA.CONTACT.diningHousePhoneLabel)).toBe(true);
   });
-
-  it('matches the copy written into the components', () => {
-    const taya = DETAIL_PAGES_AT_8FE98F5['taya-house'];
-    const tayaHero = source('components/detail/TayaHero.tsx');
-    expect(tayaHero.split(taya.kicker)).toHaveLength(3); // desktop and phone copies
-    expect(tayaHero.split(taya.story)).toHaveLength(3);
-    expect(tayaHero).toContain(`<img src="${taya.portrait}" alt="${taya.portraitAlt}"`);
-  });
 });
 
 describe.skipIf(!TEST_DATABASE_URL)('migration 008 seeds exactly the content of 8fe98f5 (database)', () => {
```

- [ ] **Bước 9: Chạy lại test**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/content-loaders.test.ts test/integration/content-seed.test.ts lib/cache-plan.test.ts test/guards/legacy-columns.guard.test.ts test/guards/guest-pages.guard.test.ts`
Expected: PASS `Test Files  5 passed (5)`, `Tests  43 passed (43)`

- [ ] **Bước 10: Chạy cổng kiểm tra, rồi diff DOM**

Expected:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo (cảnh báo `no-img-element` của `TayaHero.tsx` giờ ở `components/detail/RestaurantHero.tsx`);
- `Test Files  79 passed (79)`, `Tests  1003 passed (1003)`;
- `Applied 8 migration(s).`; build thoát 0; check-prerender in `Prerender check passed: /en, /en/restaurants/taya-house, /en/privacy (tags: restaurants, i18n:en, locales, content:ui, content:sections, content:cuisines, content:destinations, content:nav, content:contact, media; /en also content:hero, content:experiences, content:stories; /en/restaurants/taya-house also restaurant:taya-house; /en/privacy also content:legal).`;
- E2E `158 passed`, `1 skipped` (cả `restaurant-page` 2 test và `restaurant-pages.serial`); visual `8 passed`;
- diff DOM như Task 4: chỉ R18, 14 dòng mỗi trang; trang Tàya (câu chuyện, kicker, chân dung, bốn điểm nổi bật, "More at Furama Resort Danang", thanh tab bốn cột) không khác gì khác.

- [ ] **Bước 11: Commit**

Hai file đổi tên đã nằm trong index từ Bước 7 (`git mv`, nên không cần `git rm` tên cũ); `git add` dưới đây thêm nội dung mới của chúng. Nội dung đổi nhiều (độ giống 45% với `TayaHero.tsx`, 36% với `TayaExperiences.tsx`, dưới ngưỡng 50% mặc định của git), nên `git show -M` in chúng như thêm/xóa; lịch sử vẫn theo được bằng `git log --follow -M30% -- components/detail/RestaurantHero.tsx`.

```bash
git add "app/(site)/[lang]/(guarded)/restaurants/[slug]/page.tsx" components/detail/Highlights.tsx components/detail/MoreRestaurants.tsx components/detail/RestaurantHero.tsx components/site/MobileBar.tsx e2e/page-scope.spec.ts e2e/restaurant-page.spec.ts e2e/restaurant-pages.serial.spec.ts lib/cache-plan.ts lib/content/types.ts lib/server/content/restaurants.queries.ts lib/server/content/restaurants.ts scripts/check-prerender.mjs test/integration/content-loaders.test.ts test/integration/content-seed.test.ts
git commit -m "$(cat <<'EOF'
feat: serve a page for every restaurant with has_detail_page, read from the database

The restaurant page is generic (spec §6.3 item 1, §6.4): getRestaurantDetail
reads restaurant_i18n, the highlights, the destination and the portrait, and
answers null (notFound) unless the restaurant is published, not archived and
has its page on. Its cache entry carries `restaurants`, so the cached 404 of
a restaurant without a page clears when a save expires the catalogue, and
restaurant:<id> once the slug is known. generateStaticParams lists the
restaurants with a page, or the `_none` placeholder when there is none (an
empty list fails the build under Cache Components); generateMetadata takes
the page's SEO fields, else "{name} — Furama Cuisine", and the not-found
title with noindex for an unknown slug or a language that is off.

TayaHero becomes RestaurantHero and TayaExperiences becomes Highlights
(git mv; the taya-* classes stay, so the pixels do too). CALL and MAP fall
back from the restaurant to its destination and hide without one; MENU opens
the menu PDF of the page's language, else the default language's, else
scrolls to the highlights, else hides; the highlights section hides at none;
"More at" names the destination; the phone tab bar gets one column per
button it shows. openMenu no longer passes 'noopener' to window.open (with
it the call always returns null, and the page scrolled away under every
PDF); it cuts the opener by hand.

e2e/restaurant-pages.serial.spec.ts is the phase's acceptance: The Fan's
page goes from a cached 404 to a working page after a save, and back.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## PHẦN B: ưu đãi, `offerId`, xóa hằng, "Gọi để đặt bàn", nghiệm thu, runbook

Task 8–13 nối tiếp trên commit của Task 7 (dàn ý §3 T8–T13), theo đúng quy ước của Phần A: spec E2E mới chạy đỏ trên build của task trước, rồi test đơn vị/tích hợp đỏ, rồi code; mỗi task kết thúc bằng khối "Cổng kiểm tra của mọi task" và diff DOM phía server (chỉ R18). Task 12 không thêm tính năng: nó chạy các đột biến của dàn ý và chỉ commit thay đổi test mà một đột biến sống sót đòi. Task 13 viết README và runbook migration 008, chạy cổng cuối và bàn giao phần sửa spec cho controller.

### Task 8: Ưu đãi từ DB và cron hằng ngày

Ưu đãi là danh sách duy nhất của trang chủ thay đổi theo ngày (spec §5.2, §6.2): loader đọc `offers` và `offer_i18n` theo khung `valid_from`..`valid_until` của ngày hôm nay ở Đà Nẵng, cache `'hours'`, và cron `/api/cron/daily` lúc 00:05 Đà Nẵng làm mới tag `content:offers` bằng `'max'` (R7). Thẻ ưu đãi trông y như trước: dòng chi tiết được dựng trên server từ giá và lịch ("VND 888,000++ per guest · Nightly 18:30–22:00"), VIEW OFFER vẫn chỉ hiện khi nhà hàng của ưu đãi đặt online được (F10), và ghi chú điền sẵn vẫn là `Offer: <tiêu đề>`. Từ task này `/en` revalidate mỗi giờ (`cacheLife('hours')` lan lên cả trang).

**Files:**
- Create: `app/api/cron/daily/route.ts`, `test/integration/cron-daily.test.ts`, `e2e/offers-expiry.serial.spec.ts`
- Modify: `lib/content/types.ts` (`Offer`), `lib/server/content/home.queries.ts` (`loadOffers`), `lib/server/content/home.ts` (`getOffers`), `lib/cache-plan.ts` (`offers`), `app/(site)/[lang]/(guarded)/page.tsx`, `components/home/Offers.tsx`, `scripts/check-prerender.mjs` (`PAGE_TAGS`, `LIFETIME`, `UNCACHED`), `vercel.json`
- Test: `test/integration/content-loaders.test.ts`

**Interfaces:**
- Consumes: `LOCALE_CTE`, `i18nJoin`, `tr`, `VENUE_TODAY` (`lib/server/content/sql.ts`, Task 3); `formatPrice(price, locale)`, `offerDetail(price, schedule)` (`lib/content/format.ts`, Task 3); `cronAuthorized(header, secret)` (`lib/server/cron.ts`, đợt 5); `TAGS.contentOffers`, `TAGS.restaurants`; `useSite()` (`bookable`, `openReserve(preset, note)`); `one()` (`e2e/staff-fixtures.ts`); `OFFERS_AT_8FE98F5` (`test/fixtures/phase5-content.ts`, Task 1).
- Produces:
  - `lib/content/types.ts`: `Offer = { id: number; restaurantId: string; venue: string; title: string; detail: string }`.
  - `lib/server/content/home.queries.ts`: `loadOffers(locale): Promise<Offer[]>`; `home.ts`: `getOffers(locale)` (`cacheLife('hours')`, `cacheTag(...LOADERS.offers.tags, TAGS.i18n(locale))`).
  - `lib/cache-plan.ts`: `LOADERS.offers = { reads: ['locales', 'offers', 'offer_i18n', 'restaurants'], tags: [TAGS.contentOffers, TAGS.restaurants] }`.
  - `Offers({ items }: { items: Offer[] })` (Task 9 đổi lời gọi `openReserve` của nó).
  - `GET /api/cron/daily`: 401 `{ error: 'unauthorized' }` khi thiếu secret; 200 `{ revalidated: ['content:offers'] }`; luôn `cache-control: no-store`; `export const maxDuration = 60`.

- [ ] **Bước 1: Viết spec E2E cho ưu đãi hết hạn**

Ngày được dời trong DB thay vì đồng hồ (đồng hồ của server là của máy). Với `'max'` (R7), lần tải ngay sau cron có thể vẫn nhận trang cũ trong lúc trang được render lại phía sau, nên spec tải lại tới khi thấy hai ưu đãi (tối đa 15 giây), rồi trả ngày về NULL và gọi cron lần nữa trong `finally` (R21), chờ tới khi thấy lại ba ưu đãi để spec serial sau không thấy trạng thái giữa chừng.

Create `e2e/offers-expiry.serial.spec.ts`:

```ts
import type { Browser, Page } from '@playwright/test';
import { HOME_PATH } from './paths';
import { expect, one, test } from './staff-fixtures';

/*
 * Spec §6.2: an offer past its valid_until leaves the home page once the daily
 * cron (/api/cron/daily, 00:05 in Da Nang) expires content:offers, with no
 * deploy and no admin save. The date moves in the database instead of the
 * clock (the server's clock is the machine's). The cron revalidates with
 * 'max' (R7): the visit right after it may still get the cached page while the
 * page renders again behind it, so the offer is gone from the next visit on.
 *
 * It changes what every guest page reads (the offers), so it runs in the
 * desktop-serial project, one file at a time, and it puts the date back and
 * runs the cron again at its end (R21).
 */

const TEA = 'Afternoon Tea & Dessert Buffet';
const DAILY = '/api/cron/daily';
const bearer = (secret?: string): { headers: Record<string, string> } => ({ headers: secret ? { authorization: `Bearer ${secret}` } : {} });

/** A guest with no staff cookie, past the intro. */
async function guest(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

/** Reloads until the page shows `n` offers: with 'max', the first visit after the cron may still be the cached page. */
async function untilOffers(home: Page, n: number) {
  await expect
    .poll(
      async () => {
        await home.reload();
        return home.locator('#offers .offer').count();
      },
      { timeout: 15_000 },
    )
    .toBe(n);
}

test('an offer past its valid_until stays until the daily cron, which takes it off the home page', async ({ browser, request }) => {
  const home = await guest(browser);
  const offers = home.locator('#offers .offer');
  try {
    await home.goto(HOME_PATH);
    await expect(offers).toHaveCount(3);
    await expect(offers.filter({ hasText: TEA })).toHaveCount(1);

    // Yesterday in Da Nang: the offer has ended, but nothing has told the cache.
    await one(`UPDATE offers SET valid_until = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 1 WHERE id = 3`);
    await home.reload();
    await expect(offers).toHaveCount(3);

    // Spec §12: without its secret the cron is refused, and nothing changes.
    for (const secret of [undefined, 'not-the-secret-at-all']) {
      const refused = await request.get(DAILY, bearer(secret));
      expect(refused.status()).toBe(401);
      expect(refused.headers()['cache-control']).toBe('no-store');
    }
    await home.reload();
    await home.reload();
    await expect(offers).toHaveCount(3);

    const res = await request.get(DAILY, bearer(process.env.CRON_SECRET));
    expect(res.status()).toBe(200);
    expect(res.headers()['cache-control']).toBe('no-store');
    expect(await res.json()).toEqual({ revalidated: ['content:offers'] });

    await untilOffers(home, 2);
    await expect(offers.filter({ hasText: TEA })).toHaveCount(0);
    // Only the offers were read again: the rest of the page is still there.
    await expect(home.locator('.rcard')).toHaveCount(12);
  } finally {
    await one(`UPDATE offers SET valid_until = NULL WHERE id = 3`);
    await request.get(DAILY, bearer(process.env.CRON_SECRET));
    // The specs after this one see the three offers again.
    await untilOffers(home, 3);
    await home.context().close();
  }
});
```

- [ ] **Bước 2: Build code hiện tại và chạy spec mới: phải đỏ**

Reset DB E2E, build (hoặc dùng luôn build mà cổng kiểm tra của Task 7 vừa làm; DB E2E vẫn phải reset, vì E2E của cổng đã ghi vào nó), rồi:

```bash
rm -f "${TMPDIR:-/tmp}/furama-e2e-emails.ndjson"
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson CRON_SECRET=$(openssl rand -hex 16) E2E_PORT=3210 npx playwright test --retries=0 e2e/offers-expiry.serial.spec.ts --project=desktop-serial --no-deps
```

Expected: `1 failed` (route cron chưa có, nên Next trả 404 thay vì 401):

```
  ✘  1 [desktop-serial] › e2e/offers-expiry.serial.spec.ts:42:5 › an offer past its valid_until stays until the daily cron, which takes it off the home page (436ms)
    Error: expect(received).toBe(expected) // Object.is equality
    Expected: 401
    Received: 404
    > 58 |       expect(refused.status()).toBe(401);
```

(`finally` đã trả `valid_until` về NULL; ưu đãi lúc này vẫn đến từ `lib/data.ts`, nên trang vẫn có ba thẻ.)

- [ ] **Bước 3: Viết test của loader ưu đãi và của cron**

Loader: ba thẻ bằng bản đông cứng; khung ngày tính cả hai đầu, theo ngày ở Đà Nẵng; ưu đãi không giá chỉ còn lịch; bản dịch thiếu trường rơi về tiếng Anh theo từng trường và `venue_override` thắng tên nhà hàng; ưu đãi chưa đăng, hay của nhà hàng chưa đăng hoặc đã lưu trữ, không hiện. Cron: 401 với mọi kiểu sai secret, đúng một lời gọi `revalidateTag('content:offers', 'max')` khi đúng, `no-store` cả hai trường hợp (không cần DB, nhưng nằm cạnh `cron-outbox.test.ts`).

Sửa `test/integration/content-loaders.test.ts`:

```diff
diff --git a/test/integration/content-loaders.test.ts b/test/integration/content-loaders.test.ts
index cd596b6..a739ea9 100644
--- a/test/integration/content-loaders.test.ts
+++ b/test/integration/content-loaders.test.ts
@@ -1,7 +1,7 @@
 import { afterAll, afterEach, describe, expect, it } from 'vitest';
 import { getPool } from '@/db/client';
 import { FALLBACK_PHONE } from '@/lib/data';
-import { loadExperiences, loadHeroSlides, loadStories } from '@/lib/server/content/home.queries';
+import { loadExperiences, loadHeroSlides, loadOffers, loadStories } from '@/lib/server/content/home.queries';
 import { loadDetailSlugs, loadRestaurantDetail } from '@/lib/server/content/restaurants.queries';
 import { loadSiteSettings } from '@/lib/server/content/settings.queries';
 import { loadCuisines, loadDestinations, loadNav, loadSections, loadSocials } from '@/lib/server/content/site.queries';
@@ -13,6 +13,7 @@ import {
   HERO_AUTOPLAY_MS_AT_8FE98F5,
   HERO_SLIDES_AT_8FE98F5,
   NAV_AT_8FE98F5,
+  OFFERS_AT_8FE98F5,
   SECTIONS_AT_8FE98F5,
   SETTINGS_AT_8FE98F5,
   SOCIALS_AT_8FE98F5,
@@ -25,14 +26,17 @@ import {
  * (test/fixtures/phase5-content.ts), so a loader that drifts from what the
  * site rendered fails here as well as in the visual baselines. Then the rules:
  * language fallback per field (spec §5.1 item 5), machine translations behind
- * serve_machine, unpublished rows, and nav items following their section.
+ * serve_machine, unpublished rows, nav items following their section, and
+ * offers shown by the date in Da Nang.
  */
 
 const sql = (text: string, values: unknown[] = []) => getPool().query(text, values);
+/** Today in Da Nang plus `days`, as SQL (the day offers are shown for). */
+const venueDay = (days: number) => `(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + ${days}`;
 
 describe.skipIf(!process.env.TEST_DATABASE_URL)('content loaders (database)', () => {
   afterEach(async () => {
-    for (const table of ['cuisine_i18n', 'destination_i18n', 'media_i18n', 'nav_item_i18n', 'experience_i18n', 'story_i18n']) {
+    for (const table of ['cuisine_i18n', 'destination_i18n', 'media_i18n', 'nav_item_i18n', 'experience_i18n', 'story_i18n', 'offer_i18n']) {
       await sql(`DELETE FROM ${table} WHERE locale <> 'en'`);
     }
     await sql(`UPDATE locales SET serve_machine = false WHERE code = 'vi'`);
@@ -44,6 +48,9 @@ describe.skipIf(!process.env.TEST_DATABASE_URL)('content loaders (database)', ()
     await sql(`UPDATE experiences SET is_published = true`);
     await sql(`UPDATE stories SET is_published = true`);
     await sql(`UPDATE hero_slides SET is_published = true`);
+    await sql(`UPDATE offers SET is_published = true, valid_from = NULL, valid_until = NULL`);
+    await sql(`UPDATE offers SET price_amount = 450000, price_basis = 'net' WHERE id = 3`);
+    await sql(`UPDATE offer_i18n SET venue_override = NULL`);
     await sql(`UPDATE restaurants SET is_published = true, archived_at = NULL, phone_e164 = NULL, phone_display = NULL, map_url = NULL`);
     await sql(`DELETE FROM restaurant_highlights WHERE restaurant_id <> 'taya-house'`);
     await sql(`UPDATE restaurants SET has_detail_page = false, detail_image_id = NULL WHERE id <> 'taya-house'`);
@@ -120,6 +127,29 @@ describe.skipIf(!process.env.TEST_DATABASE_URL)('content loaders (database)', ()
       );
       for (const s of await loadStories('en')) expect(s.image?.alt).toBe('');
     });
+
+    it('offers: the three cards as the site drew them, the detail line rebuilt from the price and the schedule', async () => {
+      expect((await loadOffers('en')).map(({ venue, title, detail, restaurantId }) => ({ venue, title, detail, restaurantId }))).toEqual(
+        OFFERS_AT_8FE98F5.map(({ venue, title, detail, restaurant }) => ({ venue, title, detail, restaurantId: restaurant })),
+      );
+      expect((await loadOffers('en')).map((o) => o.id)).toEqual([1, 2, 3]);
+    });
+  });
+
+  describe('offers by date (spec §6.2)', () => {
+    it('shows an offer from its valid_from to its valid_until, both days included, by the date in Da Nang', async () => {
+      await sql(`UPDATE offers SET valid_until = ${venueDay(0)} WHERE id = 1`);
+      await sql(`UPDATE offers SET valid_from = ${venueDay(0)} WHERE id = 2`);
+      expect((await loadOffers('en')).map((o) => o.id)).toEqual([1, 2, 3]);
+      await sql(`UPDATE offers SET valid_until = ${venueDay(-1)} WHERE id = 1`);
+      await sql(`UPDATE offers SET valid_from = ${venueDay(1)} WHERE id = 2`);
+      expect((await loadOffers('en')).map((o) => o.id)).toEqual([3]);
+    });
+
+    it('an offer without a price is its schedule alone', async () => {
+      await sql(`UPDATE offers SET price_amount = NULL, price_basis = NULL WHERE id = 3`);
+      expect((await loadOffers('en')).find((o) => o.id === 3)?.detail).toBe('~30 pastries, 12+ teas');
+    });
   });
 
   describe('restaurant pages (spec §6.4, §14.1 row 6)', () => {
@@ -252,9 +282,26 @@ describe.skipIf(!process.env.TEST_DATABASE_URL)('content loaders (database)', ()
       expect(s.heritage.image?.alt).toBe('');
     });
 
+    it('an offer translated in part keeps the default language’s other fields; its venue override beats the restaurant’s name', async () => {
+      await sql(`INSERT INTO offer_i18n (offer_id, locale, title, status) VALUES (3, 'vi', 'Trà chiều và tiệc bánh ngọt', 'reviewed')`);
+      await sql(`UPDATE offer_i18n SET venue_override = 'The Lounge, Furama Resort' WHERE offer_id = 3 AND locale = 'en'`);
+      const tea = (await loadOffers('vi')).find((o) => o.id === 3);
+      // vi formats the number its own way (phase 8 gives each language its template).
+      expect(tea).toMatchObject({
+        title: 'Trà chiều và tiệc bánh ngọt',
+        venue: 'The Lounge, Furama Resort',
+        detail: expect.stringMatching(/ · ~30 pastries, 12\+ teas$/),
+      });
+      expect((await loadOffers('en')).find((o) => o.id === 3)).toMatchObject({
+        title: 'Afternoon Tea & Dessert Buffet',
+        venue: 'The Lounge, Furama Resort',
+      });
+    });
+
     it('a language with no rows at all is the default language throughout', async () => {
       expect(await loadNav('zz')).toEqual(await loadNav('en'));
       expect(await loadDestinations('zz')).toEqual(await loadDestinations('en'));
+      expect(await loadOffers('zz')).toEqual(await loadOffers('en'));
     });
   });
 
@@ -279,6 +326,14 @@ describe.skipIf(!process.env.TEST_DATABASE_URL)('content loaders (database)', ()
       expect((await loadSocials('en')).map((s) => s.platform)).toEqual(['facebook', 'instagram', 'youtube']);
     });
 
+    it('an unpublished offer, and the offers of a restaurant that is unpublished or archived', async () => {
+      await sql(`UPDATE offers SET is_published = false WHERE id = 1`);
+      expect((await loadOffers('en')).map((o) => o.id)).toEqual([2, 3]);
+      await sql(`UPDATE restaurants SET is_published = false WHERE id = 'taya-house'`);
+      await sql(`UPDATE restaurants SET archived_at = now() WHERE id = 'hai-van-lounge'`);
+      expect(await loadOffers('en')).toEqual([]);
+    });
+
     it('a social link meant for other languages', async () => {
       await sql(`UPDATE social_links SET visible_locales = ARRAY['vi'] WHERE platform = 'youtube'`);
       expect((await loadSocials('en')).map((s) => s.platform)).not.toContain('youtube');
```

Create `test/integration/cron-daily.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * /api/cron/daily (spec §6.2, §12): Vercel Cron's bearer secret or 401; with
 * it, content:offers is revalidated with 'max' (R7), so a database that is
 * down at 00:05 cannot turn the home page into an error. No database here.
 */

const { revalidateTag } = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag }));

const { GET, maxDuration } = await import('@/app/api/cron/daily/route');

const SECRET = 'cron-secret-0123456789abcdef';
const call = (authorization?: string) =>
  GET(new Request('http://localhost/api/cron/daily', { headers: authorization ? { authorization } : {} }));

describe('GET /api/cron/daily', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    revalidateTag.mockReset();
  });

  it('answers 401 without the secret, with a wrong one, and when CRON_SECRET is unset or short; revalidates nothing', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    for (const header of [undefined, 'Bearer wrong-secret-0123456789', SECRET, `bearer ${SECRET}`]) {
      const res = await call(header);
      expect(res.status).toBe(401);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ error: 'unauthorized' });
    }
    vi.stubEnv('CRON_SECRET', '');
    expect((await call('Bearer ')).status).toBe(401);
    vi.stubEnv('CRON_SECRET', 'short');
    expect((await call('Bearer short')).status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('with the secret, revalidates content:offers once with the max profile (R7), never { expire: 0 }', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ revalidated: ['content:offers'] });
    expect(revalidateTag.mock.calls).toEqual([['content:offers', 'max']]);
  });

  it('is a short function: one call, no database', () => {
    expect(maxDuration).toBe(60);
  });
});
```

- [ ] **Bước 4: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/content-loaders.test.ts test/integration/cron-daily.test.ts`
Expected: FAIL `Test Files  2 failed (2)`, `Tests  6 failed | 21 passed (27)`:

```
 FAIL  test/integration/cron-daily.test.ts [ test/integration/cron-daily.test.ts ]
Error: Cannot find package '@/app/api/cron/daily/route' imported from …/test/integration/cron-daily.test.ts
 ❯ test/integration/cron-daily.test.ts:12:30
 FAIL  test/integration/content-loaders.test.ts > content loaders (database) > the seed is the content of phase 5 > offers: the three cards as the site drew them, the detail line rebuilt from the price and the schedule
TypeError: loadOffers is not a function
 ❯ test/integration/content-loaders.test.ts:132:21
```

(và cùng `TypeError` ở năm test ưu đãi còn lại.)

- [ ] **Bước 5: Kiểu, loader và wrapper có cache**

Khung ngày là `VENUE_TODAY` (ngày ở Đà Nẵng, tính trong SQL), nên server ở múi giờ nào cũng như nhau. Ưu đãi của nhà hàng chưa đăng hoặc đã lưu trữ không hiện; ưu đãi không có tiêu đề ở cả hai ngôn ngữ bị bỏ. Loader đọc `restaurants` (tên, cờ đăng), nên `LOADERS.offers` mang thêm `restaurants` (test của cache plan đòi).

Sửa `lib/content/types.ts`:

```diff
diff --git a/lib/content/types.ts b/lib/content/types.ts
index 054df06..18e73a9 100644
--- a/lib/content/types.ts
+++ b/lib/content/types.ts
@@ -73,6 +73,14 @@ export type Experience = { id: number; title: string; blurb: string; href: strin
 /** A story card: the kicker is already "Category · 9 Sep 2026" (lib/content/format.ts). */
 export type Story = { id: number; image: Media | null; kicker: string; title: string; href: string };
 
+/**
+ * An offer card on show today: the venue (an override, else the restaurant's
+ * name), the title, and the detail line already "VND 888,000++ per guest ·
+ * Nightly 18:30–22:00" (lib/content/format.ts). VIEW OFFER reserves at
+ * restaurantId.
+ */
+export type Offer = { id: number; restaurantId: string; venue: string; title: string; detail: string };
+
 /** A card of a restaurant page's highlights (restaurant_highlights). */
 export type Highlight = { id: number; image: Media; title: string; detail: string };
 
```

Sửa `lib/server/content/home.queries.ts`:

```diff
diff --git a/lib/server/content/home.queries.ts b/lib/server/content/home.queries.ts
index 1c2014d..ff1a45d 100644
--- a/lib/server/content/home.queries.ts
+++ b/lib/server/content/home.queries.ts
@@ -1,8 +1,8 @@
 import 'server-only';
 import { query } from '@/db/client';
-import { storyKicker } from '@/lib/content/format';
-import type { Experience, HeroSlide, Media, Story } from '@/lib/content/types';
-import { LOCALE_CTE, i18nJoin, mediaJson, tr } from './sql';
+import { formatPrice, offerDetail, storyKicker } from '@/lib/content/format';
+import type { Experience, HeroSlide, Media, Offer, Story } from '@/lib/content/types';
+import { LOCALE_CTE, VENUE_TODAY, i18nJoin, mediaJson, tr } from './sql';
 
 /* The home page's lists, uncached (lib/server/content/home.ts wraps them). Published rows, by sort_order then id. */
 
@@ -62,3 +62,47 @@ export async function loadStories(locale: string): Promise<Story[]> {
     href: r.href,
   }));
 }
+
+/**
+ * The offers on show today in Da Nang (spec §5.2, §6.2): published, their
+ * restaurant published and not archived, and today between valid_from and
+ * valid_until (both days included; either may be open). Only the date makes
+ * this list change by itself: its cached wrapper lives for hours, and the
+ * daily cron revalidates content:offers. The detail line is formatted here,
+ * on the server.
+ */
+export async function loadOffers(locale: string): Promise<Offer[]> {
+  const rows = await query<{
+    id: string;
+    restaurant_id: string;
+    venue: string;
+    title: string;
+    schedule: string | null;
+    price_amount: string | null;
+    currency: string;
+    price_basis: 'plus_plus' | 'net' | null;
+  }>(
+    `WITH ${LOCALE_CTE}
+     SELECT o.id::text, o.restaurant_id, coalesce(${tr('ot', 'venue_override')}, r.name) AS venue,
+            ${tr('ot', 'title')} AS title, ${tr('ot', 'schedule')} AS schedule,
+            o.price_amount::text AS price_amount, o.currency, o.price_basis
+       FROM offers o CROSS JOIN lc
+       JOIN restaurants r ON r.id = o.restaurant_id AND r.is_published AND r.archived_at IS NULL
+       ${i18nJoin('offer_i18n', 'ot', 'offer_id', 'o.id')}
+      WHERE o.is_published AND ${tr('ot', 'title')} IS NOT NULL
+        AND (o.valid_from IS NULL OR o.valid_from <= ${VENUE_TODAY})
+        AND (o.valid_until IS NULL OR o.valid_until >= ${VENUE_TODAY})
+      ORDER BY o.sort_order, o.id`,
+    [locale],
+  );
+  return rows.map((r) => ({
+    id: Number(r.id),
+    restaurantId: r.restaurant_id,
+    venue: r.venue,
+    title: r.title,
+    detail: offerDetail(
+      r.price_amount !== null && r.price_basis ? formatPrice({ amount: r.price_amount, currency: r.currency, basis: r.price_basis }, locale) : null,
+      r.schedule,
+    ),
+  }));
+}
```

Sửa `lib/server/content/home.ts` (`'hours'` = stale 5 phút, revalidate 1 giờ, expire 1 ngày, `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cacheLife.md:144`; vẫn được prerender, `cacheLife.md:270`):

```diff
diff --git a/lib/server/content/home.ts b/lib/server/content/home.ts
index 8976065..a4da3a3 100644
--- a/lib/server/content/home.ts
+++ b/lib/server/content/home.ts
@@ -2,7 +2,7 @@ import 'server-only';
 import { cacheLife, cacheTag } from 'next/cache';
 import { LOADERS } from '@/lib/cache-plan';
 import { TAGS } from '@/lib/cache-tags';
-import { loadExperiences, loadHeroSlides, loadStories } from './home.queries';
+import { loadExperiences, loadHeroSlides, loadOffers, loadStories } from './home.queries';
 
 /* The home page's lists, cached (see lib/server/content/site.ts for the rules). */
 
@@ -26,3 +26,16 @@ export async function getStories(locale: string) {
   cacheTag(...LOADERS.stories.tags, TAGS.i18n(locale));
   return loadStories(locale);
 }
+
+/**
+ * Date-bound (spec §6.2): 'hours' (stale 5 min, revalidate 1 h, expire 1 day;
+ * cacheLife.md:144), so the home page drops an ended offer within the hour
+ * even without the daily cron (app/api/cron/daily), which revalidates
+ * content:offers at 00:05 in Da Nang. It still prerenders (cacheLife.md:270).
+ */
+export async function getOffers(locale: string) {
+  'use cache';
+  cacheLife('hours');
+  cacheTag(...LOADERS.offers.tags, TAGS.i18n(locale));
+  return loadOffers(locale);
+}
```

Sửa `lib/cache-plan.ts`:

```diff
diff --git a/lib/cache-plan.ts b/lib/cache-plan.ts
index 25d4ec8..168ca08 100644
--- a/lib/cache-plan.ts
+++ b/lib/cache-plan.ts
@@ -118,6 +118,8 @@ export const LOADERS = {
   heroSlides: { reads: ['locales', 'hero_slides', 'media', 'media_i18n'], tags: [TAGS.contentHero, TAGS.media] },
   experiences: { reads: ['locales', 'experiences', 'experience_i18n'], tags: [TAGS.contentExperiences] },
   stories: { reads: ['locales', 'stories', 'story_i18n', 'media', 'media_i18n'], tags: [TAGS.contentStories, TAGS.media] },
+  // cacheLife('hours') and the daily cron. The venue is the restaurant's name, and a hidden restaurant hides its offers.
+  offers: { reads: ['locales', 'offers', 'offer_i18n', 'restaurants'], tags: [TAGS.contentOffers, TAGS.restaurants] },
   // Plus restaurant:<id>, added once the query has found the restaurant.
   detail: {
     reads: [
```

- [ ] **Bước 6: Trang chủ truyền ưu đãi; `Offers` nhận props**

Section ưu đãi bị bỏ khi không ưu đãi nào hiện hôm nay (spec §6.5), như các danh sách khác của Task 6: `homeSections` nhận thêm danh sách `offers`. Ở task này VIEW OFFER vẫn gọi `openReserve(preset, note)` với ghi chú dựng từ tiêu đề; Task 9 đổi sang truyền ưu đãi.

Sửa `app/(site)/[lang]/(guarded)/page.tsx`:

```diff
diff --git a/app/(site)/[lang]/(guarded)/page.tsx b/app/(site)/[lang]/(guarded)/page.tsx
index 9d4975a..1016c11 100644
--- a/app/(site)/[lang]/(guarded)/page.tsx
+++ b/app/(site)/[lang]/(guarded)/page.tsx
@@ -12,7 +12,7 @@ import { IntroTrigger } from '@/components/site/IntroTrigger';
 import { MobileBar } from '@/components/site/MobileBar';
 import { ViewMarker } from '@/components/site/ViewMarker';
 import { homeSections } from '@/lib/content/home-sections';
-import { getExperiences, getHeroSlides, getStories } from '@/lib/server/content/home';
+import { getExperiences, getHeroSlides, getOffers, getStories } from '@/lib/server/content/home';
 import { requireEnabledLocale } from '@/lib/server/content/locales';
 import { getSections } from '@/lib/server/content/site';
 
@@ -21,17 +21,20 @@ import { getSections } from '@/lib/server/content/site';
  * (lib/server/content/home.ts); the chrome's content and the catalogue come
  * from the (guarded) layout. A section staff switched off (sections.is_visible)
  * is left out, and so is one with nothing to show (spec §6.5; homeSections).
+ * The offers are today's (Da Nang), so this page revalidates hourly (getOffers,
+ * cacheLife('hours')).
  */
 export default async function HomePage() {
   // First, before any read: /favicon.ico lands here with "favicon.ico" as its language (requireEnabledLocale).
   const locale = await requireEnabledLocale(await lang());
-  const [sections, slides, experiences, stories] = await Promise.all([
+  const [sections, slides, experiences, stories, offers] = await Promise.all([
     getSections(locale),
     getHeroSlides(locale),
     getExperiences(locale),
     getStories(locale),
+    getOffers(locale),
   ]);
-  const shown = homeSections(sections, { hero: slides, experiences, stories });
+  const shown = homeSections(sections, { hero: slides, experiences, stories, offers });
 
   return (
     <ViewMarker view="home">
@@ -44,7 +47,7 @@ export default async function HomePage() {
       {shown.has('experiences') && <Experiences items={experiences} />}
       {shown.has('heritage') && <Heritage />}
       {shown.has('stories') && <Stories items={stories} />}
-      {shown.has('offers') && <Offers />}
+      {shown.has('offers') && <Offers items={offers} />}
       <MobileBar />
     </ViewMarker>
   );
```

Sửa `components/home/Offers.tsx`:

```diff
diff --git a/components/home/Offers.tsx b/components/home/Offers.tsx
index 1b99b89..e50db00 100644
--- a/components/home/Offers.tsx
+++ b/components/home/Offers.tsx
@@ -1,10 +1,11 @@
 'use client';
 
-import { OFFERS, type Offer } from '@/lib/data';
+import type { Offer } from '@/lib/content/types';
 import { useSite } from '@/components/site/SiteProvider';
 import { useReveal } from '@/lib/motion';
 
-export function Offers() {
+/** Today's offers (lib/server/content/home.ts getOffers); the page leaves the section out when there are none. */
+export function Offers({ items }: { items: Offer[] }) {
   const title = useReveal<HTMLHeadingElement>('title');
   const lede = useReveal<HTMLParagraphElement>('up');
 
@@ -22,8 +23,8 @@ export function Offers() {
         </div>
 
         <div className="offers-grid">
-          {OFFERS.map((o) => (
-            <OfferCard key={o.title} offer={o} />
+          {items.map((o) => (
+            <OfferCard key={o.id} offer={o} />
           ))}
         </div>
       </div>
@@ -35,7 +36,7 @@ function OfferCard({ offer }: { offer: Offer }) {
   const { bookable, openReserve } = useSite();
   const ref = useReveal<HTMLDivElement>('up');
   // An offer's only action is reserving at its restaurant: none while that restaurant books offline.
-  const canReserve = bookable.some((r) => r.id === offer.restaurant);
+  const canReserve = bookable.some((r) => r.id === offer.restaurantId);
 
   return (
     <div ref={ref} data-reveal="up" className="offer">
@@ -46,7 +47,7 @@ function OfferCard({ offer }: { offer: Offer }) {
         <button
           type="button"
           className="offer-cta"
-          onClick={() => openReserve({ restaurant: offer.restaurant }, offer.note)}
+          onClick={() => openReserve({ restaurant: offer.restaurantId }, `Offer: ${offer.title}`)}
         >
           VIEW OFFER<span>→</span>
         </button>
```

- [ ] **Bước 7: Cron hằng ngày**

`'max'` thay `{ expire: 0 }` (R7; `revalidateTag.md:23,25,30`: với `'max'` request kế tiếp nhận bản cũ trong lúc làm mới phía sau, với `{ expire: 0 }` nó phải chờ render, và render hỏng khi DB sập). Đọc `request.headers` giữ handler khỏi bị prerender (`01-getting-started/15-route-handlers.md:124`); `check-prerender` (Bước 8) giữ điều đó.

Create `app/api/cron/daily/route.ts`:

```ts
import { revalidateTag } from 'next/cache';
import { TAGS } from '@/lib/cache-tags';
import { cronAuthorized } from '@/lib/server/cron';

/*
 * Vercel Cron, daily at 17:05 UTC, which is 00:05 in Da Nang (vercel.json;
 * production deployments only). Offers are date-bound (spec §6.2): a new day
 * revalidates content:offers, so the home page drops an offer past its
 * valid_until, and shows one whose valid_from has come, a few minutes after
 * midnight instead of within the hour that the loader's cacheLife('hours')
 * allows.
 *
 * 'max', not { expire: 0 } (R7, amending spec §6.2): the next visitor is served
 * the cached page while it renders again (revalidateTag.md:23,30), so a
 * database that is down at 00:05 cannot turn the home page into an error; the
 * cost is that the first visitor after the cron may see yesterday's offers
 * once. { expire: 0 } would make that visit wait for a render, which fails
 * while the database is down (revalidateTag.md:25).
 *
 * Without `Authorization: Bearer $CRON_SECRET` it is 401 (spec §12). Reading
 * request.headers keeps the handler out of prerendering
 * (node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md:124).
 */

/** Seconds: one call, no database. */
export const maxDuration = 60;

const NO_STORE = { 'cache-control': 'no-store' };

export async function GET(request: Request): Promise<Response> {
  if (!cronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }
  revalidateTag(TAGS.contentOffers, 'max');
  console.info(`[cron:daily] revalidated ${TAGS.contentOffers}`);
  return Response.json({ revalidated: [TAGS.contentOffers] }, { headers: NO_STORE });
}
```

Thay toàn bộ `vercel.json` bằng:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    { "path": "/api/cron/outbox", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/daily", "schedule": "5 17 * * *" }
  ]
}
```

- [ ] **Bước 8: Tag, tuổi cache và route không cache trong `check-prerender`**

Một trang prerender sống bằng `cacheLife` ngắn nhất của nó: `/en` giờ là `'hours'` (3600/86400), hai trang kia vẫn `'max'`. Dòng "passed" in thêm tuổi cache của từng trang.

Sửa `scripts/check-prerender.mjs`:

```diff
diff --git a/scripts/check-prerender.mjs b/scripts/check-prerender.mjs
index 4587dde..0065a76 100644
--- a/scripts/check-prerender.mjs
+++ b/scripts/check-prerender.mjs
@@ -2,9 +2,10 @@
 /**
  * Run after `next build`. Exits 1 and lists the problems if any check fails.
  *
- * 1. The guest pages must be fully prerendered with cacheLife('max') and carry
- *    every cache tag their data readers declare, or a write that refreshes one
- *    of those tags (spec §6.2) would never reach them. The admin pages are the
+ * 1. The guest pages must be fully prerendered with their cacheLife ('max';
+ *    the home page 'hours', for today's offers) and carry every cache tag
+ *    their data readers declare, or a write that refreshes one of those tags
+ *    (spec §6.2) would never reach them. The admin pages are the
  *    opposite (1b): no static shell at all, since a shell built at build time
  *    could not carry the per-request CSP nonce (spec §11). /api/availability
  *    (1c) must be built as a route handler, and must not be prerendered either.
@@ -47,12 +48,15 @@ const TAGS = [
 ];
 /** Tags a page carries beyond the layout's: the home page's lists (lib/server/content/home.ts), a restaurant page's own (restaurants.ts), the privacy policy's text (legal.ts). */
 const PAGE_TAGS = {
-  '/en': ['content:hero', 'content:experiences', 'content:stories'],
+  '/en': ['content:hero', 'content:experiences', 'content:stories', 'content:offers'],
   '/en/restaurants/taya-house': ['restaurant:taya-house'],
   '/en/privacy': ['content:legal'],
 };
-const REVALIDATE = 2_592_000; // cacheLife('max'): 30 days
-const EXPIRE = 31_536_000; // 1 year
+/** A prerendered page lives as long as its shortest cacheLife (cacheLife.md:144-147). */
+const MAX = { revalidate: 2_592_000, expire: 31_536_000 }; // 'max': 30 days, 1 year
+const HOURS = { revalidate: 3_600, expire: 86_400 }; // 'hours': 1 hour, 1 day
+/** The home page shows today's offers (getOffers, 'hours'); every other page is 'max'. */
+const LIFETIME = { '/en': HOURS };
 
 /** The families lib/fonts/index.ts defines, by the CSS variable that carries each. */
 const FONTS = [
@@ -87,11 +91,12 @@ for (const [route, file] of Object.entries(PAGES)) {
     problems.push(`${route} is not prerendered`);
     continue;
   }
-  if (entry.initialRevalidateSeconds !== REVALIDATE) {
-    problems.push(`${route} revalidates after ${entry.initialRevalidateSeconds}s, expected ${REVALIDATE}s`);
+  const life = LIFETIME[route] ?? MAX;
+  if (entry.initialRevalidateSeconds !== life.revalidate) {
+    problems.push(`${route} revalidates after ${entry.initialRevalidateSeconds}s, expected ${life.revalidate}s`);
   }
-  if (entry.initialExpireSeconds !== EXPIRE) {
-    problems.push(`${route} expires after ${entry.initialExpireSeconds}s, expected ${EXPIRE}s`);
+  if (entry.initialExpireSeconds !== life.expire) {
+    problems.push(`${route} expires after ${entry.initialExpireSeconds}s, expected ${life.expire}s`);
   }
   const meta = JSON.parse(readFileSync(join(dir, 'server', 'app', `${file}.meta`), 'utf8'));
   if (meta.postponed) problems.push(`${route} is only partially prerendered`);
@@ -116,14 +121,15 @@ for (const [route, entry] of adminRoutes) {
 /*
  * 1c. Availability is never cached (spec §6.2): a GET handler that stops
  * reading the request is prerendered at build time, and every guest would get
- * the build's slots. The outbox cron (spec §10.4) likewise: prerendered, its
- * one build-time run would be all the sending it ever did. Neither route may
- * be in the prerender manifest at all.
+ * the build's slots. The crons likewise: prerendered, the outbox's one
+ * build-time run would be all the sending it ever did (spec §10.4), and the
+ * daily one would never revalidate the offers again (spec §6.2). None of these
+ * routes may be in the prerender manifest at all.
  * It must also be in the build as a route handler: a moved or renamed route
  * is missing from the prerender manifest too, so that test alone would pass
  * on a build without it.
  */
-const UNCACHED = ['/api/availability', '/api/cron/outbox'];
+const UNCACHED = ['/api/availability', '/api/cron/outbox', '/api/cron/daily'];
 const appPaths = JSON.parse(readFileSync(join(dir, 'server', 'app-paths-manifest.json'), 'utf8'));
 for (const route of UNCACHED) {
   if (!appPaths[`${route}/route`]) {
@@ -153,7 +159,7 @@ if (problems.length) {
   process.exit(1);
 }
 console.log(
-  `Prerender check passed: ${Object.keys(PAGES).join(', ')} (tags: ${TAGS.join(', ')}; ${Object.entries(PAGE_TAGS).map(([route, tags]) => `${route} also ${tags.join(', ')}`).join('; ')}).`,
+  `Prerender check passed: ${Object.keys(PAGES).join(', ')} (tags: ${TAGS.join(', ')}; ${Object.entries(PAGE_TAGS).map(([route, tags]) => `${route} also ${tags.join(', ')}`).join('; ')}; lifetimes: ${Object.keys(PAGES).map((route) => `${route} ${(LIFETIME[route] ?? MAX).revalidate}/${(LIFETIME[route] ?? MAX).expire}s`).join(', ')}).`,
 );
 console.log(`Admin check passed: ${adminRoutes.map(([route]) => route).join(', ')} have no static shell.`);
 console.log(`Uncached check passed: ${UNCACHED.join(', ')} built as a route handler, not prerendered.`);
```

- [ ] **Bước 9: Chạy lại test**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/content-loaders.test.ts test/integration/cron-daily.test.ts lib/cache-plan.test.ts lib/content/format.test.ts`
Expected: PASS `Test Files  4 passed (4)`, `Tests  42 passed (42)`

- [ ] **Bước 10: Chạy cổng kiểm tra, rồi diff DOM**

Expected:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo;
- `Test Files  80 passed (80)`, `Tests  1011 passed (1011)`;
- `Applied 8 migration(s).`; build thoát 0 (`ƒ /api/cron/daily`); check-prerender in `Prerender check passed: /en, /en/restaurants/taya-house, /en/privacy (tags: restaurants, i18n:en, locales, content:ui, content:sections, content:cuisines, content:destinations, content:nav, content:contact, media; /en also content:hero, content:experiences, content:stories, content:offers; /en/restaurants/taya-house also restaurant:taya-house; /en/privacy also content:legal; lifetimes: /en 3600/86400s, /en/restaurants/taya-house 2592000/31536000s, /en/privacy 2592000/31536000s).` và `Uncached check passed: /api/availability, /api/cron/outbox, /api/cron/daily built as a route handler, not prerendered.`;
- E2E `159 passed`, `1 skipped`; visual `8 passed`;
- diff DOM như Task 4: chỉ R18, 14 dòng mỗi trang (ba thẻ ưu đãi giống từng ký tự).

- [ ] **Bước 11: Commit**

```bash
git add "app/(site)/[lang]/(guarded)/page.tsx" app/api/cron/daily/route.ts components/home/Offers.tsx e2e/offers-expiry.serial.spec.ts lib/cache-plan.ts lib/content/types.ts lib/server/content/home.queries.ts lib/server/content/home.ts scripts/check-prerender.mjs test/integration/content-loaders.test.ts test/integration/cron-daily.test.ts vercel.json
git commit -m "$(cat <<'EOF'
feat: show the offers of the day from the database, and revalidate them every night at 00:05 in Da Nang

getOffers reads offers and offer_i18n: published offers of a published,
unarchived restaurant whose valid_from..valid_until (both days included,
either open) holds today in Da Nang. The venue is the override, else the
restaurant's name, and the detail line is formatted on the server
("VND 888,000++ per guest · Nightly 18:30–22:00"). It caches for 'hours'
(spec §6.2), so the home page now revalidates hourly (check-prerender
expects 3600/86400 for /en), and the section leaves the page when no offer
shows. VIEW OFFER still shows only while the offer's restaurant books online.

/api/cron/daily (vercel.json, 17:05 UTC) revalidates content:offers with
'max', not { expire: 0 } (R7): the first visit after it may see yesterday's
offers once, but a database that is down at 00:05 cannot turn the home page
into an error. It answers 401 without CRON_SECRET and is never prerendered.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `offerId` trên đặt bàn (liên kết mềm, R9)

Spec §14.1 dòng 6: form đặt bàn gửi `offerId`, và `reservations.offer_id` có khóa ngoại tới `offers` từ Task 1. Liên kết là mềm (R9): VIEW OFFER mở form kèm ưu đãi, lần gửi mang `offerId` chỉ khi nhà hàng đang chọn vẫn là của ưu đãi; server nhận một số nguyên dương int4 hoặc bỏ qua (không bao giờ là mã lỗi), và câu INSERT chỉ giữ một ưu đãi đã đăng của đúng nhà hàng đó, chạy vào ngày được đặt. Ghi chú điền sẵn `Offer: <tiêu đề>` giữ như trước, drawer không đổi gì (không tag, không dòng ở màn cảm ơn); email và màn admin hiện ưu đãi ở đợt 7.

**Files:**
- Create: `e2e/offer-booking.spec.ts`
- Modify: `lib/server/booking/input.ts`, `lib/server/booking/create.ts`, `components/site/SiteProvider.tsx`, `components/home/Offers.tsx`
- Test: `lib/server/booking/input.test.ts`, `test/integration/submit-reservation.test.ts`

**Interfaces:**
- Consumes: `Offer` và `Offers({ items })` (Task 8); `parseReservationInput`, `ReservationRequest` (đợt 4–5); `submitReservation(input: unknown)` (`app/actions.ts`, nhận `unknown` nên `lib/booking/client.ts` không đổi); `mockAvailability` (`e2e/availability-mock.ts`); offers 1–3 của migration 008 (1 Café Indochine, 2 Tàya House, 3 Hải Vân Lounge, không ngày).
- Produces:
  - `openReserve(preset?: Partial<Booking>, offer?: { id: number; title: string })` (thay tham số `note`): điền `Offer: <title>` vào ghi chú khi ghi chú trống, và nhớ `{ id, restaurant }`; quên nó khi đóng drawer sau một đặt bàn xong.
  - Lần gửi: thêm `offerId` khi `offer.restaurant === booking.restaurant`.
  - `ReservationRequest.offerId: number | null`; zod `offerId: z.number().int().positive().max(2_147_483_647).optional().catch(undefined)`.
  - `reservations.offer_id` = `(SELECT o.id FROM offers o WHERE o.id = $15 AND o.restaurant_id = $2 AND o.is_published AND (o.valid_from IS NULL OR o.valid_from <= $3::date) AND (o.valid_until IS NULL OR o.valid_until >= $3::date))`.

- [ ] **Bước 1: Viết spec E2E của `offerId`**

Mọi lời gọi Server Action đều bị chụp lại rồi hủy (`route.abort()`), nên không gì được ghi; đồng hồ và API availability là giả (`mockAvailability`), như các spec đặt bàn khác. Test thứ hai (RESERVE thường không mang ưu đãi) xanh cả trên code cũ: nó là lưới giữ cho ưu đãi không dính vào mọi lần gửi.

Create `e2e/offer-booking.spec.ts`:

```ts
import { expect, test, type Locator, type Request } from '@playwright/test';
import { mockAvailability } from './availability-mock';
import { HOME_PATH } from './paths';

/*
 * Spec §14.1 row 6: the reservation form sends the offer it was opened from
 * (reservations.offer_id, a foreign key since migration 008), as a soft link
 * (R9): only while the chosen restaurant is the offer's. Every request is
 * captured and aborted, so nothing is written;
 * test/integration/submit-reservation.test.ts covers what the server keeps.
 */

const NOW = new Date('2026-10-02T03:00:00Z'); // 10:00 in Da Nang
const isServerAction = (r: Request) => r.method() === 'POST' && !!r.headers()['next-action'];
const CONSENT = 'I agree to Furama Cuisine using my details as described in the privacy policy.';

/** REQUEST BOOKING, and the arguments the aborted Server Action call carried. */
async function send(drawer: Locator, sent: string[]): Promise<Record<string, unknown>> {
  const before = sent.length;
  await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
  await expect.poll(() => sent.length).toBe(before + 1);
  const [args] = JSON.parse(sent[before]) as [Record<string, unknown>];
  return args;
}

test('VIEW OFFER books with the offer’s id while its restaurant is the one chosen, and without it otherwise', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  await page.clock.setFixedTime(NOW);
  await mockAvailability(page, { today: () => '2026-10-02', now: () => NOW.toISOString() });
  const sent: string[] = [];
  await page.route('**/*', (route) => {
    if (!isServerAction(route.request())) return route.fallback();
    sent.push(route.request().postData() ?? '');
    return route.abort();
  });
  await page.goto(HOME_PATH);

  await page.locator('#offers .offer', { hasText: 'Seafood & Steak Buffet Dinner' }).getByRole('button', { name: /VIEW OFFER/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.drawer-name')).toHaveText('Café Indochine');
  // The note still names the offer, as before phase 6 (a labelled textarea's name includes its value, so by role).
  await expect(drawer.getByRole('textbox', { name: /^Special requests/ })).toHaveValue('Offer: Seafood & Steak Buffet Dinner');
  await drawer.getByLabel('Full name *', { exact: true }).fill('Nguyễn Minh Anh');
  await drawer.getByLabel('Phone *', { exact: true }).fill('0905 000 000');
  await drawer.getByRole('checkbox', { name: CONSENT }).check();

  expect(await send(drawer, sent)).toMatchObject({ restaurant: 'cafe-indochine', offerId: 1, note: 'Offer: Seafood & Steak Buffet Dinner' });

  // Another restaurant: the offer is not its own, so the request goes without it.
  await drawer.getByRole('button', { name: /^restaurant/i }).click();
  await page.getByRole('listbox', { name: 'Restaurant' }).getByRole('option', { name: 'Don Cipriani’s' }).click();
  await expect(drawer.locator('.drawer-name')).toHaveText('Don Cipriani’s');
  const other = await send(drawer, sent);
  expect(other).toMatchObject({ restaurant: 'don-ciprianis' });
  expect(other).not.toHaveProperty('offerId');

  // Back to the offer's restaurant: the offer comes back with it.
  await drawer.getByRole('button', { name: /^restaurant/i }).click();
  await page.getByRole('listbox', { name: 'Restaurant' }).getByRole('option', { name: 'Café Indochine' }).click();
  await expect(drawer.locator('.drawer-name')).toHaveText('Café Indochine');
  expect(await send(drawer, sent)).toMatchObject({ restaurant: 'cafe-indochine', offerId: 1 });
});

test('a plain RESERVE sends no offer', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  await page.clock.setFixedTime(NOW);
  await mockAvailability(page, { today: () => '2026-10-02', now: () => NOW.toISOString() });
  const sent: string[] = [];
  await page.route('**/*', (route) => {
    if (!isServerAction(route.request())) return route.fallback();
    sent.push(route.request().postData() ?? '');
    return route.abort();
  });
  await page.goto(HOME_PATH);

  await page.getByRole('button', { name: 'RESERVE', exact: true }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.drawer-name')).toHaveText('Tàya House');
  await drawer.getByLabel('Full name *', { exact: true }).fill('Nguyễn Minh Anh');
  await drawer.getByLabel('Phone *', { exact: true }).fill('0905 000 000');
  await drawer.getByRole('checkbox', { name: CONSENT }).check();
  const args = await send(drawer, sent);
  expect(args).toMatchObject({ restaurant: 'taya-house', note: '' });
  expect(args).not.toHaveProperty('offerId');
});
```

- [ ] **Bước 2: Build code hiện tại và chạy spec mới: phải đỏ**

Reset DB E2E, build (hoặc dùng luôn build mà cổng kiểm tra của Task 8 vừa làm, sau khi reset DB E2E), rồi:

```bash
rm -f "${TMPDIR:-/tmp}/furama-e2e-emails.ndjson"
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson CRON_SECRET=$(openssl rand -hex 16) E2E_PORT=3210 npx playwright test --retries=0 e2e/offer-booking.spec.ts --project=desktop
```

Expected: `1 failed`, `1 passed`:

```
  ✘  1 [desktop] › e2e/offer-booking.spec.ts:26:5 › VIEW OFFER books with the offer’s id while its restaurant is the one chosen, and without it otherwise (1.4s)
  ✓  2 [desktop] › e2e/offer-booking.spec.ts:64:5 › a plain RESERVE sends no offer (1.3s)
    Error: expect(received).toMatchObject(expected)
      Object {
        "note": "Offer: Seafood & Steak Buffet Dinner",
    -   "offerId": 1,
        "restaurant": "cafe-indochine",
      }
    > 47 |   expect(await send(drawer, sent)).toMatchObject({ restaurant: 'cafe-indochine', offerId: 1, note: 'Offer: Seafood & Steak Buffet Dinner' });
```

- [ ] **Bước 3: Viết test của zod và của câu INSERT**

zod: `offerId` đi qua khi là int4 dương; mọi giá trị khác (chuỗi, 0, âm, lẻ, 2³¹, null, object) bị bỏ, đặt bàn vẫn hợp lệ. INSERT: giữ ưu đãi của đúng nhà hàng, đã đăng, chạy vào ngày đặt (tính cả ngày cuối); bỏ ưu đãi của nhà hàng khác, id lạ, chưa đăng, chưa bắt đầu, đã hết hôm trước, và đặt bàn vẫn thành công. Mỗi lần gửi một số điện thoại khác (giới hạn ba yêu cầu một số một ngày của đợt 5); Tàya có 16 chỗ mỗi khung giờ, sáu lần hai khách là đủ chỗ.

Sửa `lib/server/booking/input.test.ts`:

```diff
diff --git a/lib/server/booking/input.test.ts b/lib/server/booking/input.test.ts
index 599a223..9de97cc 100644
--- a/lib/server/booking/input.test.ts
+++ b/lib/server/booking/input.test.ts
@@ -31,10 +31,21 @@ describe('parseReservationInput', () => {
         note: 'window seat',
         locale: 'en',
         consentVersion: PRIVACY_POLICY_VERSION,
+        offerId: null,
       },
     });
   });
 
+  it('carries the offer the form was opened from (R9: reservations.offer_id)', () => {
+    expect(parseReservationInput({ ...valid, offerId: 3 })).toMatchObject({ ok: true, value: { offerId: 3 } });
+    expect(parseReservationInput({ ...valid, offerId: 2 ** 31 - 1 })).toMatchObject({ ok: true, value: { offerId: 2 ** 31 - 1 } });
+  });
+
+  // A soft link (R9): a bad id costs the link, never the booking, and never names a field.
+  it.each([['3'], [0], [-1], [1.5], [2 ** 31], [null], [{ id: 3 }]])('books without an offerId of %j', (offerId) => {
+    expect(parseReservationInput({ ...valid, offerId })).toMatchObject({ ok: true, value: { offerId: null } });
+  });
+
   it.each([
     [{ restaurant: '' }, 'restaurant_unavailable'],
     [{ date: '2026-02-30' }, 'outside_window'],
```

Sửa `test/integration/submit-reservation.test.ts`:

```diff
diff --git a/test/integration/submit-reservation.test.ts b/test/integration/submit-reservation.test.ts
index e4f85ff..a6dea89 100644
--- a/test/integration/submit-reservation.test.ts
+++ b/test/integration/submit-reservation.test.ts
@@ -439,4 +439,31 @@ describe.skipIf(!process.env.TEST_DATABASE_URL)('submitReservation v2 (database)
       }
     });
   });
+
+  // Migration 008's offers: 1 Café Indochine's, 2 Tàya House's, 3 Hải Vân Lounge's, none with dates.
+  describe('the offer it was booked from (R9: a soft link, never a refusal)', () => {
+    afterEach(() => sql(`UPDATE offers SET is_published = true, valid_from = NULL, valid_until = NULL`));
+
+    it('keeps an offer of the booked restaurant that is published and runs on the booked date, its last day included', async () => {
+      await sql(`UPDATE offers SET valid_from = '2026-09-01', valid_until = '2026-10-02' WHERE id = 2`);
+      expect(await submitReservation({ ...request, offerId: 2 })).toMatchObject({ ok: true });
+      expect((await sql(`SELECT offer_id FROM reservations`)).rows).toEqual([{ offer_id: '2' }]);
+    });
+
+    it('books without it when the offer is another restaurant’s, unknown, unpublished, or not running on the booked date', async () => {
+      const cases: [label: string, offerId: number, setup?: string][] = [
+        ['another restaurant’s', 1],
+        ['unknown', 999],
+        ['unpublished', 2, `UPDATE offers SET is_published = false WHERE id = 2`],
+        ['not started yet', 2, `UPDATE offers SET is_published = true, valid_from = '2026-10-03' WHERE id = 2`],
+        ['ended the day before', 2, `UPDATE offers SET valid_from = NULL, valid_until = '2026-10-01' WHERE id = 2`],
+      ];
+      for (const [i, [, offerId, setup]] of cases.entries()) {
+        if (setup) await sql(setup);
+        expect(await submitReservation({ ...request, offerId, phone: phone(40 + i) })).toMatchObject({ ok: true });
+      }
+      const { rows } = await sql(`SELECT phone, offer_id FROM reservations ORDER BY id`);
+      expect(rows.map((r, i) => [cases[i][0], r.offer_id])).toEqual(cases.map(([label]) => [label, null]));
+    });
+  });
 });
```

- [ ] **Bước 4: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/server/booking/input.test.ts test/integration/submit-reservation.test.ts`
Expected: FAIL `Test Files  2 failed (2)`, `Tests  10 failed | 66 passed (76)`:

```
     × keeps an offer of the booked restaurant that is published and runs on the booked date, its last day included 25ms
     × trims, normalises the phone and defaults the locale 8ms
     × carries the offer the form was opened from (R9: reservations.offer_id) 3ms
     × books without an offerId of "3" 1ms
     × books without an offerId of 0 1ms
     × books without an offerId of -1 1ms
     × books without an offerId of 1.5 1ms
     × books without an offerId of 2147483648 0ms
     × books without an offerId of null 0ms
     × books without an offerId of {"id":3} 2ms
AssertionError: expected [ { offer_id: null } ] to deeply equal [ { offer_id: '2' } ]
AssertionError: expected { ok: true, value: { …(11) } } to match object { ok: true, value: { offerId: 3 } }
```

Test "books without it when the offer is another restaurant’s, unknown, unpublished, or not running on the booked date" xanh trên code cũ (code cũ không bao giờ ghi `offer_id`): nó là lưới cho Bước 5.

- [ ] **Bước 5: zod và câu INSERT**

`.catch(undefined)` biến mọi giá trị sai thành "không có ưu đãi" thay vì một mã lỗi: đặt bàn đứng được không cần ưu đãi (R9), và không có mã nào để gán cho trường này. Điều kiện nằm trong subselect của chính câu INSERT, nên không có lần đọc riêng nào để lệch với nó.

Sửa `lib/server/booking/input.ts`:

```diff
diff --git a/lib/server/booking/input.ts b/lib/server/booking/input.ts
index d0d1f34..c8170a6 100644
--- a/lib/server/booking/input.ts
+++ b/lib/server/booking/input.ts
@@ -49,6 +49,13 @@ const schema = z.object({
   consent: z.literal(true),
   /** The drawer's hidden field; step 1 (honeypotFilled) has already refused anything but empty. */
   honeypot: z.literal('').optional(),
+  /**
+   * offers.id of the VIEW OFFER the form was opened from. A soft link (R9): a
+   * value that is not a positive int4 is dropped, never an error, since the
+   * booking stands without it; the insert keeps only an offer of this
+   * restaurant that runs on the booked date.
+   */
+  offerId: z.number().int().positive().max(2_147_483_647).optional().catch(undefined),
 });
 
 /** First failing field → the code the drawer shows. Order follows the form, top to bottom. */
@@ -81,6 +88,8 @@ export type ReservationRequest = {
   locale: string;
   /** The privacy policy version the guest agreed to (lib/legal.ts), stored on the booking. */
   consentVersion: string;
+  /** The offer as sent (R9); reservations.offer_id gets it only if the insert's check passes. */
+  offerId: number | null;
 };
 
 export type ParseResult = { ok: true; value: ReservationRequest } | { ok: false; code: BookingErrorCode };
@@ -110,6 +119,7 @@ export function parseReservationInput(input: unknown): ParseResult {
       locale: v.locale ?? 'en',
       // The version this server shows; the box links to that page.
       consentVersion: PRIVACY_POLICY_VERSION,
+      offerId: v.offerId ?? null,
     },
   };
 }
```

Sửa `lib/server/booking/create.ts`:

```diff
diff --git a/lib/server/booking/create.ts b/lib/server/booking/create.ts
index 0ed6e05..4b2ebdd 100644
--- a/lib/server/booking/create.ts
+++ b/lib/server/booking/create.ts
@@ -116,12 +116,19 @@ async function insertInTransaction(client: PoolClient, input: ReservationRequest
   const { rows } = await client.query<{ id: string }>(
     `INSERT INTO reservations
        (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164,
-        email, note, status, confirmed_at, source, locale, consent_version, consented_at)
+        email, note, status, confirmed_at, source, locale, consent_version, consented_at, offer_id)
      VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12,
              CASE WHEN $12 = 'confirmed' THEN now() END, 'web',
              COALESCE((SELECT code FROM locales WHERE code = $13 AND is_enabled),
                       (SELECT code FROM locales WHERE is_default)),
-             $14, now())
+             $14, now(),
+             -- R9, a soft link: the id came over the wire, and the guest may have switched
+             -- restaurant or date since VIEW OFFER. Kept only for a published offer of this
+             -- restaurant that runs on the booked date; anything else books without it.
+             (SELECT o.id FROM offers o
+               WHERE o.id = $15 AND o.restaurant_id = $2 AND o.is_published
+                 AND (o.valid_from IS NULL OR o.valid_from <= $3::date)
+                 AND (o.valid_until IS NULL OR o.valid_until >= $3::date)))
      RETURNING id::text`,
     [
       reference,
@@ -138,6 +145,7 @@ async function insertInTransaction(client: PoolClient, input: ReservationRequest
       status,
       input.locale,
       input.consentVersion,
+      input.offerId,
     ],
   );
   const id = rows[0].id;
```

- [ ] **Bước 6: Drawer nhớ ưu đãi và gửi nó khi đúng nhà hàng**

Ưu đãi gắn với nhà hàng của chính nó (`preset.restaurant`, nhà hàng VIEW OFFER chỉ định), không với nhà hàng drawer đang chọn: đổi sang nhà hàng khác thì lần gửi không mang nó, đổi lại thì mang lại. Một lần RESERVE thường sau đó không xóa nó, cũng như không xóa ghi chú `Offer: …` vẫn còn trong form; đóng drawer sau một đặt bàn xong thì xóa cả hai.

Sửa `components/site/SiteProvider.tsx`:

```diff
diff --git a/components/site/SiteProvider.tsx b/components/site/SiteProvider.tsx
index 57a1d33..bbf3748 100644
--- a/components/site/SiteProvider.tsx
+++ b/components/site/SiteProvider.tsx
@@ -191,7 +191,8 @@ type SiteState = {
   submit: () => void;
 
   overlay: Overlay | null;
-  openReserve: (preset?: Partial<Booking>, note?: string) => void;
+  /** Opens the form; from VIEW OFFER with the offer, whose title goes into an empty note and whose id goes with the request (R9). */
+  openReserve: (preset?: Partial<Booking>, offer?: { id: number; title: string }) => void;
   closeDrawer: () => void;
   open: (o: Overlay) => void;
   close: () => void;
@@ -292,6 +293,8 @@ export function SiteProvider({
   const [booked, setBooked] = useState<Booked | null>(null);
   const [dateMoved, setDateMoved] = useState<DateMove | null>(null);
   const [overlay, setOverlay] = useState<Overlay | null>(null);
+  /* The offer the form was opened from, and its restaurant (R9): sent only while that is the restaurant chosen. */
+  const [offer, setOffer] = useState<{ id: number; restaurant: string } | null>(null);
   /* A move note belongs to the drawer visit it was shown in. Many paths close
      the overlay (×, Escape, a link), so the drop happens here, on the change,
      adjusting state during render; a move made from the booking bar while the
@@ -522,7 +525,7 @@ export function SiteProvider({
   }, [home, router]);
 
   const openReserve = useCallback(
-    (preset?: Partial<Booking>, note?: string) => {
+    (preset?: Partial<Booking>, from?: { id: number; title: string }) => {
       setOverlay('drawer');
       setOpenDropdown(null);
       setDone(false);
@@ -530,9 +533,14 @@ export function SiteProvider({
       setTried(false);
       setServerError(null);
       setWaitNote(null);
-      if (note) setForm((f) => (f.note ? f : { ...f, note }));
       // A restaurant that does not book online is ignored here (reconcileBooking keeps the current one).
       const next = reconcileBooking(latest.current.booking, { ...preset }, context(now()));
+      if (from) {
+        // The note still names the offer, as before phase 6; reservations.offer_id now says it for staff.
+        const note = `Offer: ${from.title}`;
+        setForm((f) => (f.note ? f : { ...f, note }));
+        setOffer({ id: from.id, restaurant: preset?.restaurant ?? next.restaurant });
+      }
       setBookingState(next);
       // Ask again: the tab may have been open past midnight, or a closure or a booking changed the picture.
       if (next.restaurant) loadCalendar(next.restaurant);
@@ -548,6 +556,7 @@ export function SiteProvider({
       setBooked(null);
       setTried(false);
       setServerError(null);
+      setOffer(null);
       setForm(EMPTY_FORM);
       setConsent(false);
       setHoneypot('');
@@ -655,6 +664,7 @@ export function SiteProvider({
       locale,
       consent,
       honeypot,
+      ...(offer && offer.restaurant === booking.restaurant ? { offerId: offer.id } : {}),
     })
       .then((result) => {
         if (result.ok) {
@@ -675,7 +685,7 @@ export function SiteProvider({
       // failing or passing its deadline (lib/botid.ts). Every one names the number to call.
       .catch(() => setServerError({ code: 'network', params: errorParams(booking.restaurant) }))
       .finally(() => setPending(false));
-  }, [booking, consent, context, errorParams, failed, form, honeypot, loadBoard, loadCalendar, locale, now, restaurants, valid]);
+  }, [booking, consent, context, errorParams, failed, form, honeypot, loadBoard, loadCalendar, locale, now, offer, restaurants, valid]);
 
   const setFormField = useCallback((key: keyof BookingForm, value: string) => {
     setForm((f) => ({ ...f, [key]: value }));
```

Sửa `components/home/Offers.tsx`:

```diff
diff --git a/components/home/Offers.tsx b/components/home/Offers.tsx
index e50db00..c3e083c 100644
--- a/components/home/Offers.tsx
+++ b/components/home/Offers.tsx
@@ -47,7 +47,7 @@ function OfferCard({ offer }: { offer: Offer }) {
         <button
           type="button"
           className="offer-cta"
-          onClick={() => openReserve({ restaurant: offer.restaurantId }, `Offer: ${offer.title}`)}
+          onClick={() => openReserve({ restaurant: offer.restaurantId }, { id: offer.id, title: offer.title })}
         >
           VIEW OFFER<span>→</span>
         </button>
```

- [ ] **Bước 7: Chạy lại test**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/server/booking/input.test.ts test/integration/submit-reservation.test.ts`
Expected: PASS `Test Files  2 passed (2)`, `Tests  76 passed (76)`

- [ ] **Bước 8: Chạy cổng kiểm tra, rồi diff DOM**

Expected:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo;
- `Test Files  80 passed (80)`, `Tests  1021 passed (1021)`;
- `Applied 8 migration(s).`; build thoát 0; check-prerender như Task 8;
- E2E `161 passed`, `1 skipped`; visual `8 passed`;
- diff DOM như Task 4: chỉ R18, 14 dòng mỗi trang.

- [ ] **Bước 9: Commit**

```bash
git add components/home/Offers.tsx components/site/SiteProvider.tsx e2e/offer-booking.spec.ts lib/server/booking/create.ts lib/server/booking/input.test.ts lib/server/booking/input.ts test/integration/submit-reservation.test.ts
git commit -m "$(cat <<'EOF'
feat: send the offer a booking was opened from, and keep it on the booking when it is that restaurant's and runs that day

VIEW OFFER now opens the form with the offer: its title still fills an
empty note ("Offer: …", as before), and REQUEST BOOKING sends offerId while
the chosen restaurant is the offer's (switching away leaves it out,
switching back brings it back). The server takes it as a soft link (R9):
zod drops anything that is not a positive int4 instead of refusing, and the
insert stores reservations.offer_id only for a published offer of the booked
restaurant whose dates cover the booked day. Any other id books the table
without the link; there is no new error code and nothing new in the drawer.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Xóa các hằng nội dung của `lib/data.ts` (R1)

Từ Task 9, không component nào của web khách còn đọc nội dung từ `lib/data.ts`. Task này xóa các hằng đó ngay ở đợt 6 (R1; spec §14.1 dòng 10 để chúng tới đợt 10): `lib/data.ts` chỉ còn code — enum `Meal`, `MEALS`, `MEAL_LABELS` (registry ở đợt 7), `SLOTS` (đợt 10 bỏ cùng `restaurants.slot_capacity`), `FALLBACK_PHONE` và kiểu `Restaurant`. Ba màn admin còn đọc `DESTS` lấy tên điểm đến từ DB. Bản đông cứng `test/fixtures/phase5-content.ts` giữ bằng chứng tương đương, nên khối 1 của `content-seed.test.ts` (so bản đông cứng với `lib/data.ts`) đi theo các hằng.

**Files:**
- Modify: `lib/data.ts`, `lib/server/booking/queries.ts` (`listDestinationOptions`), `app/admin/(shell)/reservations/closures/page.tsx`, `app/admin/(shell)/restaurants/page.tsx`, `app/admin/(shell)/settings/notifications/page.tsx`, `components/site/SiteProvider.tsx` (bỏ `DestKey`), `e2e/smoke.spec.ts`, `README.md` (hai chỗ nhắc `db/queries.ts`)
- Test: `lib/data.test.ts`, `test/integration/reservation-inbox.test.ts`, `test/integration/content-seed.test.ts`

**Interfaces:**
- Consumes: bảng `destinations`, `destination_i18n`, `locales` (004, 008); `listRestaurantOptions(pool)`, `listLocales(pool)` (`lib/server/booking/queries.ts`).
- Produces:
  - `lib/data.ts` export đúng `FALLBACK_PHONE`, `MEALS`, `MEAL_LABELS`, `SLOTS` (lúc chạy) cùng kiểu `Meal`, `Restaurant` (`Restaurant.dest: string`; `DestKey` bỏ).
  - `listDestinationOptions(pool: Pool): Promise<{ id: string; name: string }[]>`: mọi điểm đến `kind = 'venue'`, đã đăng hay chưa, theo tên ở ngôn ngữ mặc định, `ORDER BY sort_order, id`.

- [ ] **Bước 1: Viết test**

Một test ghim danh sách export lúc chạy của `lib/data.ts`; `contactFor` và các khóa ẩm thực mất test cùng hằng của chúng (thay bằng `restaurant_cuisines` và `content-loaders.test.ts` từ Task 3, 7). Bộ đọc điểm đến của admin lấy mọi điểm đến thật (kể cả chưa đăng: nhân viên vẫn đóng cửa hay nhận email theo nó), bỏ thẻ teaser, và đọc tên ở ngôn ngữ mặc định dù có bản dịch khác.

Thay toàn bộ `lib/data.test.ts` bằng:

```ts
import { describe, expect, it } from 'vitest';
import * as DATA from './data';
import { FALLBACK_PHONE, MEALS, MEAL_LABELS } from './data';

describe('lib/data.ts holds code, not content (R1)', () => {
  it('exports only the meal keys and their labels, the phase-1 slots and the fallback phone', () => {
    // The content lives in the database since phase 6 (migration 008); test/fixtures/phase5-content.ts keeps what it was.
    expect(Object.keys(DATA).sort()).toEqual(['FALLBACK_PHONE', 'MEALS', 'MEAL_LABELS', 'SLOTS']);
  });
});

describe('meal labels', () => {
  it('has display text for every meal key', () => {
    for (const meal of MEALS) expect(MEAL_LABELS[meal]).toBe(meal);
  });
});

describe('FALLBACK_PHONE', () => {
  it('is a dialable E.164 number, printed with the spaces the footer prints', () => {
    expect(FALLBACK_PHONE.tel).toMatch(/^\+[1-9][0-9]{6,14}$/);
    expect(FALLBACK_PHONE.display.replace(/ /g, '')).toBe(FALLBACK_PHONE.tel);
  });
});
```

Sửa `test/integration/reservation-inbox.test.ts`:

```diff
diff --git a/test/integration/reservation-inbox.test.ts b/test/integration/reservation-inbox.test.ts
index fb3fe57..fa82c71 100644
--- a/test/integration/reservation-inbox.test.ts
+++ b/test/integration/reservation-inbox.test.ts
@@ -1,6 +1,16 @@
 import { Pool } from 'pg';
 import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
-import { INBOX_PAGE_SIZE, daySheet, getReservation, listEvents, listInbox, listLocales, listNotes, overviewCounts } from '@/lib/server/booking/queries';
+import {
+  INBOX_PAGE_SIZE,
+  daySheet,
+  getReservation,
+  listDestinationOptions,
+  listEvents,
+  listInbox,
+  listLocales,
+  listNotes,
+  overviewCounts,
+} from '@/lib/server/booking/queries';
 import { TEST_DATABASE_URL } from '../helpers/db';
 
 /*
@@ -185,6 +195,22 @@ describe.skipIf(!TEST_DATABASE_URL)('reservation inbox (database)', () => {
     expect((await daySheet(pool, '2026-10-05')).map((r) => r.id)).toContain('hai-van-lounge');
   });
 
+  it('names the destinations staff pick from: every venue, published or not, by its default-language name (R1)', async () => {
+    await pool.query(`UPDATE destinations SET is_published = false WHERE id = 'mm'`);
+    await pool.query(`INSERT INTO destination_i18n (destination_id, locale, name, status) VALUES ('resort', 'vi', 'Khu nghỉ dưỡng Furama', 'reviewed')`);
+    try {
+      // The teaser ("Future Locations") is a home-page card, not a place: no closure or recipient can name it.
+      expect(await listDestinationOptions(pool)).toEqual([
+        { id: 'resort', name: 'Furama Resort Danang' },
+        { id: 'dining-house', name: 'Furama Dining House' },
+        { id: 'mm', name: 'Furama MM Supercenter' },
+      ]);
+    } finally {
+      await pool.query(`UPDATE destinations SET is_published = true WHERE id = 'mm'`);
+      await pool.query(`DELETE FROM destination_i18n WHERE locale = 'vi'`);
+    }
+  });
+
   it('lists every language a guest may speak, enabled or not, the default marked', async () => {
     expect(await listLocales(pool)).toEqual([
       { code: 'en', name: 'English', isDefault: true },
```

- [ ] **Bước 2: Chạy test, phải đỏ**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/data.test.ts test/integration/reservation-inbox.test.ts`
Expected: FAIL `Test Files  2 failed (2)`, `Tests  2 failed | 10 passed (12)`:

```
 FAIL  lib/data.test.ts > lib/data.ts holds code, not content (R1) > exports only the meal keys and their labels, the phase-1 slots and the fallback phone
AssertionError: expected [ 'CONTACT', 'CUISINES', …(22) ] to deeply equal [ 'FALLBACK_PHONE', 'MEALS', …(2) ]
 FAIL  test/integration/reservation-inbox.test.ts > reservation inbox (database) > names the destinations staff pick from: every venue, published or not, by its default-language name (R1)
TypeError: listDestinationOptions is not a function
 ❯ test/integration/reservation-inbox.test.ts:203:20
```

- [ ] **Bước 3: Bộ đọc điểm đến của admin**

Không cache (admin render lúc request). Đặt cạnh `listRestaurantOptions` và `listLocales`, hai bộ đọc danh sách chọn khác của các màn này.

Sửa `lib/server/booking/queries.ts`:

```diff
diff --git a/lib/server/booking/queries.ts b/lib/server/booking/queries.ts
index cd7d662..8f78496 100644
--- a/lib/server/booking/queries.ts
+++ b/lib/server/booking/queries.ts
@@ -174,6 +174,23 @@ export async function listRestaurantOptions(pool: Pool): Promise<{ id: string; n
   return rows;
 }
 
+/**
+ * The destinations staff pick from (a closure's or a recipient's scope) and
+ * the names the admin prints for them (R1: DESTS is gone): every venue,
+ * published or not, by its name in the default language, in display order.
+ * The teaser card ("Future Locations") is not a place, so it is left out.
+ */
+export async function listDestinationOptions(pool: Pool): Promise<{ id: string; name: string }[]> {
+  const { rows } = await pool.query<{ id: string; name: string }>(
+    `SELECT d.id, coalesce(dt.name, d.id) AS name
+       FROM destinations d
+       LEFT JOIN destination_i18n dt ON dt.destination_id = d.id AND dt.locale = (SELECT code FROM locales WHERE is_default)
+      WHERE d.kind = 'venue'
+      ORDER BY d.sort_order, d.id`,
+  );
+  return rows;
+}
+
 export type GuestContact = { reference: string; name: string; phone: string };
 
 /** Whom to phone, and on which number, for these bookings, in the order of `ids` (a bulk cancel's unemailed guests). */
```

- [ ] **Bước 4: Ba màn admin đọc tên điểm đến từ DB**

Danh sách chọn (ngày đóng cửa, người nhận) và tên in ở mỗi dòng (phạm vi "Điểm đến: …", cột "Điểm đến" của danh sách nhà hàng) đều từ `listDestinationOptions`; một id không còn trong danh sách in chính nó, như trước. Comment của màn nhà hàng sửa "phase 6" thành "phase 7" (đợt 6 không có trình soạn).

Sửa `app/admin/(shell)/reservations/closures/page.tsx`:

```diff
diff --git a/app/admin/(shell)/reservations/closures/page.tsx b/app/admin/(shell)/reservations/closures/page.tsx
index 98c71e0..88fdfeb 100644
--- a/app/admin/(shell)/reservations/closures/page.tsx
+++ b/app/admin/(shell)/reservations/closures/page.tsx
@@ -1,11 +1,11 @@
 import type { Metadata } from 'next';
 import { getPool } from '@/db/client';
 import { formatIsoDayVi } from '@/lib/admin/format';
-import { DESTS, MEALS, type DestKey } from '@/lib/data';
+import { MEALS } from '@/lib/data';
 import { STATUS_LABELS } from '@/lib/reservations/lifecycle';
 import { findAffected } from '@/lib/server/booking/affected';
 import { listClosures } from '@/lib/server/booking/config';
-import { listRestaurantOptions } from '@/lib/server/booking/queries';
+import { listDestinationOptions, listRestaurantOptions } from '@/lib/server/booking/queries';
 import { requirePagePermission } from '@/lib/server/dal/session';
 import { venueNow } from '@/lib/venue-time';
 import { AffectedList } from '../../_ui/AffectedList';
@@ -22,13 +22,18 @@ const SCOPE_LABELS = { all: 'Tất cả nhà hàng', destination: 'Điểm đế
 export default async function ClosuresPage() {
   await requirePagePermission({ schedule: ['read'] });
   const pool = getPool();
-  const [closures, restaurants] = await Promise.all([listClosures(pool, venueNow().date), listRestaurantOptions(pool)]);
+  const [closures, restaurants, destinations] = await Promise.all([
+    listClosures(pool, venueNow().date),
+    listRestaurantOptions(pool),
+    listDestinationOptions(pool),
+  ]);
   // Each closure's own list (spec §10.1): never acted on automatically.
   const affected = await Promise.all(closures.map((c) => findAffected(pool, { closureId: c.id })));
   const restaurantName = new Map(restaurants.map((r) => [r.id, r.name]));
+  const destinationName = new Map(destinations.map((d) => [d.id, d.name]));
   const options = {
     restaurants,
-    destinations: Object.entries(DESTS).map(([id, name]) => ({ id, name })),
+    destinations,
     meals: [...MEALS],
   };
 
@@ -44,7 +49,7 @@ export default async function ClosuresPage() {
           c.scope === 'all'
             ? SCOPE_LABELS.all
             : c.scope === 'destination'
-              ? `${SCOPE_LABELS.destination}: ${DESTS[c.destinationId as DestKey] ?? c.destinationId}`
+              ? `${SCOPE_LABELS.destination}: ${destinationName.get(c.destinationId ?? '') ?? c.destinationId}`
               : `${SCOPE_LABELS.restaurant}: ${restaurantName.get(c.restaurantId ?? '') ?? c.restaurantId}`;
         const values: ClosureValues = {
           id: c.id,
```

Sửa `app/admin/(shell)/restaurants/page.tsx`:

```diff
diff --git a/app/admin/(shell)/restaurants/page.tsx b/app/admin/(shell)/restaurants/page.tsx
index 5d86e71..e1431f8 100644
--- a/app/admin/(shell)/restaurants/page.tsx
+++ b/app/admin/(shell)/restaurants/page.tsx
@@ -1,8 +1,8 @@
 import type { Metadata } from 'next';
 import Link from 'next/link';
 import { getPool } from '@/db/client';
-import { DESTS, type DestKey } from '@/lib/data';
 import { getBookingSettings, listRestaurantBookings } from '@/lib/server/booking/config';
+import { listDestinationOptions } from '@/lib/server/booking/queries';
 import { requirePagePermission } from '@/lib/server/dal/session';
 
 // Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
@@ -10,11 +10,16 @@ export const instant = false;
 
 export const metadata: Metadata = { title: 'Nhà hàng' };
 
-/* Phase 4 keeps this list to each restaurant's booking screen (R16); content editing arrives with phase 6. */
+/* Phase 4 keeps this list to each restaurant's booking screen (R16); content editing arrives with phase 7. */
 export default async function RestaurantsPage() {
   await requirePagePermission({ schedule: ['read'] });
   const pool = getPool();
-  const [restaurants, settings] = await Promise.all([listRestaurantBookings(pool), getBookingSettings(pool)]);
+  const [restaurants, settings, destinations] = await Promise.all([
+    listRestaurantBookings(pool),
+    getBookingSettings(pool),
+    listDestinationOptions(pool),
+  ]);
+  const destinationName = new Map(destinations.map((d) => [d.id, d.name]));
   return (
     <>
       <h1>Nhà hàng</h1>
@@ -33,7 +38,7 @@ export default async function RestaurantsPage() {
           {restaurants.map((r) => (
             <tr key={r.id}>
               <td>{r.name}</td>
-              <td>{DESTS[r.destinationId as DestKey] ?? r.destinationId}</td>
+              <td>{destinationName.get(r.destinationId) ?? r.destinationId}</td>
               <td>{r.bookingEnabled ? 'Bật' : 'Tắt'}</td>
               <td>{r.maxParty ?? `${settings.maxParty} (mặc định)`}</td>
               <td>
```

Sửa `app/admin/(shell)/settings/notifications/page.tsx`:

```diff
diff --git a/app/admin/(shell)/settings/notifications/page.tsx b/app/admin/(shell)/settings/notifications/page.tsx
index e93fdd4..5be2b15 100644
--- a/app/admin/(shell)/settings/notifications/page.tsx
+++ b/app/admin/(shell)/settings/notifications/page.tsx
@@ -1,7 +1,6 @@
 import type { Metadata } from 'next';
 import { getPool } from '@/db/client';
-import { DESTS, type DestKey } from '@/lib/data';
-import { listLocales, listRestaurantOptions } from '@/lib/server/booking/queries';
+import { listDestinationOptions, listLocales, listRestaurantOptions } from '@/lib/server/booking/queries';
 import { requirePagePermission } from '@/lib/server/dal/session';
 import { deliveryModeNotice } from '@/lib/server/email/mode';
 import { getSharedInbox, listRecipients, restaurantsWithoutRecipient } from '@/lib/server/email/recipients';
@@ -26,16 +25,18 @@ export default async function NotificationsPage() {
   // Before any query: an Editor gets the 403 view.
   const staff = await requirePagePermission({ settings: ['read'] });
   const pool = getPool();
-  const [recipients, inbox, uncovered, restaurants, locales] = await Promise.all([
+  const [recipients, inbox, uncovered, restaurants, destinations, locales] = await Promise.all([
     listRecipients(pool),
     getSharedInbox(pool),
     restaurantsWithoutRecipient(pool),
     listRestaurantOptions(pool),
+    listDestinationOptions(pool),
     listLocales(pool),
   ]);
+  const destinationName = new Map(destinations.map((d) => [d.id, d.name]));
   const options: RecipientOptions = {
     restaurants,
-    destinations: Object.entries(DESTS).map(([id, name]) => ({ id, name })),
+    destinations,
     locales: locales.map((l) => ({ code: l.code, name: l.name })),
   };
 
@@ -59,7 +60,7 @@ export default async function NotificationsPage() {
             r.scope === 'all'
               ? SCOPE_LABELS.all
               : r.scope === 'destination'
-                ? `${SCOPE_LABELS.destination}: ${DESTS[r.destinationId as DestKey] ?? r.destinationId}`
+                ? `${SCOPE_LABELS.destination}: ${destinationName.get(r.destinationId ?? '') ?? r.destinationId}`
                 : `${SCOPE_LABELS.restaurant}: ${r.restaurantName ?? r.restaurantId}`;
           const values: RecipientValues = {
             id: r.id,
```

- [ ] **Bước 5: `lib/data.ts` chỉ còn code**

Thay toàn bộ `lib/data.ts` bằng:

```ts
import type { Media, Phone } from '@/lib/content/types';

/*
 * Code, not content (R1). The guest site's content lives in the database since
 * phase 6 (migration 008, read through lib/server/content/*); what it was at
 * the end of phase 5 is frozen in test/fixtures/phase5-content.ts. Left here:
 * the meal enum (service_periods.meal) and its labels (phase 7 moves the text
 * to the registry), phase 1's slots (phase 10 drops them), the number the
 * error pages print without the database, and the catalogue's client shape.
 */

export type Meal = 'Breakfast' | 'Lunch' | 'Dinner' | 'Drinks';

/** One restaurant as the catalogue loader (lib/server/content/restaurants.queries.ts#loadRestaurants) hands it to the client. */
export type Restaurant = {
  id: string;
  /** URL segment of /[lang]/restaurants/[slug] (restaurants.slug). */
  slug: string;
  /** restaurants.has_detail_page: the card opens the page instead of the reservation form. */
  hasDetailPage: boolean;
  name: string;
  /** restaurant_i18n.type_label in the page's language, else the default language's. */
  type: string;
  /** Cuisine ids (slugs, via restaurant_cuisines), never labels. */
  cuisines: string[];
  /** destinations.id (restaurants.destination_id). */
  dest: string;
  /** The meals of its active service periods (spec §6.3 item 2), in MEALS order; drives the Occasion filter. */
  meals: Meal[];
  /** restaurants.booking_enabled: off hides its RESERVE entry points and drops it from the reservation form. */
  bookingEnabled: boolean;
  /** The card picture (restaurants.card_image_id; alt: a copy of the name, R19); null draws the frame alone. */
  image: Media | null;
  /** The restaurant's own number, else its destination's (spec §6.4); null when neither has one. */
  phone: Phone | null;
  /** Name, type, cuisine labels and destination name, in the page's language and the default one, fold()ed: what search matches. */
  search: string;
};

/**
 * Phase 1's slots of each meal, from before service_periods (migration 006
 * seeded the periods from them). Only test/integration/booking-seed.test.ts
 * reads them; phase 10 drops them with restaurants.slot_capacity and meals.
 */
export const SLOTS: Record<Meal, string[]> = {
  Breakfast: ['06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '09:30'],
  Lunch: ['11:30', '12:00', '12:30', '13:00', '13:30'],
  Dinner: ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00'],
  Drinks: ['17:00', '18:00', '19:00', '20:00', '21:00', '22:00'],
};

export const MEALS: Meal[] = ['Breakfast', 'Lunch', 'Dinner', 'Drinks'];

/** Display text per meal. The Meal value itself is the key (spec §5.2 service_periods.meal); phase 7 moves the text to the registry. */
export const MEAL_LABELS: Record<Meal, string> = {
  Breakfast: 'Breakfast',
  Lunch: 'Lunch',
  Dinner: 'Dinner',
  Drinks: 'Drinks',
};

/**
 * The number the error pages print, and the one a booking failure names
 * before the chosen restaurant's own has arrived (DEFAULT_PHONE). A code
 * constant on purpose, kept when the content constants went (R1): those pages
 * render when the database cannot be read (spec §12), so they cannot ask it.
 * The resort destination's number (migration 004); a test holds the two equal.
 */
export const FALLBACK_PHONE = { display: '+84 236 651 9999', tel: '+842366519999' } as const;
```

`DestKey` (một bí danh của `string` từ Task 3) đi theo `DESTS`. Sửa `components/site/SiteProvider.tsx`:

```diff
diff --git a/components/site/SiteProvider.tsx b/components/site/SiteProvider.tsx
index bbf3748..e485907 100644
--- a/components/site/SiteProvider.tsx
+++ b/components/site/SiteProvider.tsx
@@ -11,7 +11,7 @@ import {
   useState,
 } from 'react';
 import type { SiteContent } from '@/lib/content/types';
-import type { DestKey, Restaurant } from '@/lib/data';
+import type { Restaurant } from '@/lib/data';
 import { findRestaurant, validate, type Booking, type BookingForm } from '@/lib/booking';
 import {
   boardFor,
@@ -115,7 +115,7 @@ type SiteState = {
   clearFilters: () => void;
   applyFinder: () => void;
   pickCuisine: (cuisine: string) => void;
-  pickDestination: (key: DestKey) => void;
+  pickDestination: (key: string) => void;
 
   booking: Booking;
   setBooking: (patch: Partial<Booking>) => void;
@@ -708,7 +708,7 @@ export function SiteProvider({
   );
 
   const pickDestination = useCallback(
-    (key: DestKey) => {
+    (key: string) => {
       setFilter({ destination: key, cuisine: 'all', occasion: 'all' });
       scrollToId('restaurants');
     },
```

- [ ] **Bước 6: Test seed, smoke và README thôi nhắc các hằng**

Khối 1 của test seed (so bản đông cứng với `lib/data.ts`) đi; khối 2 còn một chỗ đọc `DATA.CONTACT`, thay bằng số E.164 viết thẳng. Smoke đếm ba chấm của hero (ba slide 008 seed) thay vì `HERO_SLIDES.length`. README thay hai chỗ nhắc `db/queries.ts#listRestaurants` (đã xóa ở Task 3); phần còn lại của README là Task 13.

Sửa `test/integration/content-seed.test.ts`:

```diff
diff --git a/test/integration/content-seed.test.ts b/test/integration/content-seed.test.ts
index 99633f7..d0f20c3 100644
--- a/test/integration/content-seed.test.ts
+++ b/test/integration/content-seed.test.ts
@@ -2,7 +2,6 @@ import { readFileSync, readdirSync } from 'node:fs';
 import { join } from 'node:path';
 import { Pool } from 'pg';
 import { afterAll, beforeAll, describe, expect, it } from 'vitest';
-import * as DATA from '@/lib/data';
 import { imageSize, jpegIsRotated } from '@/lib/media/image-size';
 import {
   CUISINES_AT_8FE98F5,
@@ -22,11 +21,11 @@ import { TEST_DATABASE_URL, databaseUrl, resetDatabase } from '../helpers/db';
 
 /*
  * Spec §14.1 row 6: "the web is identical to before". Migration 008 must seed
- * exactly the content of 8fe98f5. Three links of one chain:
- *   1. the frozen snapshot (test/fixtures/phase5-content.ts) is what lib/data.ts
- *      and the components held — this block goes when phase 6 deletes them;
- *   2. the database holds the snapshot, rebuilt into the strings a guest reads;
- *   3. every media row is a real file in public/assets, measured.
+ * exactly the content of 8fe98f5, which the frozen snapshot
+ * (test/fixtures/phase5-content.ts) keeps now that lib/data.ts and the
+ * components no longer hold it (R1). Two links of one chain:
+ *   1. the database holds the snapshot, rebuilt into the strings a guest reads;
+ *   2. every media row is a real file in public/assets, measured.
  * Restaurants were already rows (002): their new columns are compared with
  * their phase-1 columns in the same database, which also holds on Neon.
  * A database of its own, freshly migrated: other files edit the shared one.
@@ -53,38 +52,6 @@ function price(amount: string, currency: string, basis: string): string {
   return `${currency} ${new Intl.NumberFormat('en').format(Number(amount))}${basis === 'plus_plus' ? '++' : ' net'} per guest`;
 }
 
-
-describe('the snapshot is the content of 8fe98f5 (delete with the constants and literals it mirrors)', () => {
-  it('matches lib/data.ts', () => {
-    expect(CUISINES_AT_8FE98F5).toEqual(DATA.CUISINES);
-    expect(DESTINATIONS_AT_8FE98F5.filter((d) => d.name).map((d) => [d.id, d.name])).toEqual(Object.entries(DATA.DESTS));
-    expect(
-      DESTINATIONS_AT_8FE98F5.map((d) => ({ key: d.id, slot: d.image.slice(8, -4), title: d.title, blurb: d.blurb })),
-    ).toEqual(DATA.DESTINATION_CARDS);
-    expect(HERO_SLIDES_AT_8FE98F5.map((s) => s.image)).toEqual(DATA.HERO_SLIDES.map((s) => `/assets/${s.img}.jpg`));
-    expect(EXPERIENCES_AT_8FE98F5).toEqual(DATA.EXPERIENCES);
-    expect(STORIES_AT_8FE98F5).toEqual(
-      DATA.STORIES.map(({ img, kicker, title, href }) => ({ image: `/assets/${img}.jpg`, kicker, title, href })),
-    );
-    expect(OFFERS_AT_8FE98F5).toEqual(DATA.OFFERS);
-    expect(Object.keys(DETAIL_PAGES_AT_8FE98F5)).toEqual([...DATA.DETAIL_PAGE_IDS]);
-    const taya = DETAIL_PAGES_AT_8FE98F5['taya-house'];
-    expect(taya.seo).toEqual(DATA.DETAIL_SEO['taya-house']);
-    expect(taya.menuPdf).toBe(DATA.CONTACT.tariffPdf);
-    expect({ tel: taya.call, map: taya.map }).toEqual(DATA.contactFor('resort'));
-    expect(taya.highlights).toEqual(
-      DATA.TAYA_EXPERIENCES.map(({ img, alt, title, detail }) => ({ image: `/assets/${img}.jpg`, alt, title, detail })),
-    );
-    expect(NAV_AT_8FE98F5.map((n) => ({ label: n.header, target: n.target }))).toEqual(DATA.NAV_LINKS);
-    expect(SOCIALS_AT_8FE98F5.map(({ label, href }) => ({ label, href }))).toEqual(DATA.SOCIALS);
-    expect(SETTINGS_AT_8FE98F5.email).toBe(DATA.CONTACT.email);
-    expect(SETTINGS_AT_8FE98F5.defaultRestaurantId).toBe(DATA.DEFAULT_RESTAURANT_ID);
-    expect(SECTIONS_AT_8FE98F5.heritage.link).toBe(DATA.CONTACT.story);
-    expect(DESTINATIONS_AT_8FE98F5[0].footer.endsWith(DATA.CONTACT.resortPhoneLabel)).toBe(true);
-    expect(DESTINATIONS_AT_8FE98F5[1].footer.endsWith(DATA.CONTACT.diningHousePhoneLabel)).toBe(true);
-  });
-});
-
 describe.skipIf(!TEST_DATABASE_URL)('migration 008 seeds exactly the content of 8fe98f5 (database)', () => {
   beforeAll(() => {
     resetDatabase(url);
@@ -140,8 +107,8 @@ describe.skipIf(!TEST_DATABASE_URL)('migration 008 seeds exactly the content of
       })),
     ).toEqual(DESTINATIONS_AT_8FE98F5);
     expect((await alts()).get('/assets/dest-resort.jpg')).toBe('');
-    // The footer's tel: link becomes E.164 (CONTACT.diningHousePhone was the national 0859555759).
-    expect(list.find((d) => d.id === 'dining-house')?.phone_e164).toBe(`+84${DATA.CONTACT.diningHousePhone.slice(1)}`);
+    // The footer's tel: link becomes E.164 (it dialled the national 0859555759; R18).
+    expect(list.find((d) => d.id === 'dining-house')?.phone_e164).toBe('+84859555759');
   });
 
   it('restaurants: slug, destination, type label, cuisines and card image, from their phase-1 columns', async () => {
```

Sửa `e2e/smoke.spec.ts`:

```diff
diff --git a/e2e/smoke.spec.ts b/e2e/smoke.spec.ts
index bf03a5b..65af71d 100644
--- a/e2e/smoke.spec.ts
+++ b/e2e/smoke.spec.ts
@@ -1,5 +1,4 @@
 import { expect, test } from '@playwright/test';
-import { HERO_SLIDES } from '../lib/data';
 import { HOME_PATH } from './paths';
 
 test.beforeEach(async ({ page }) => {
@@ -13,7 +12,8 @@ test('home page lists the restaurant catalogue', async ({ page }) => {
 
 test('the hero has one dot per slide, and a dot shows its slide', async ({ page }) => {
   await page.goto(HOME_PATH);
-  await expect(page.locator('.hero-dots .hero-dot')).toHaveCount(HERO_SLIDES.length);
+  // The three slides migration 008 seeds (hero_slides).
+  await expect(page.locator('.hero-dots .hero-dot')).toHaveCount(3);
   await page.locator('.hero-dot').nth(1).click();
   await expect(page.locator('.hero-slide').nth(1)).toHaveAttribute('data-active', 'true');
   await expect(page.locator('.hero-slide').nth(0)).toHaveAttribute('data-active', 'false');
```

Sửa `README.md`:

```diff
diff --git a/README.md b/README.md
index 093a905..959ebb5 100644
--- a/README.md
+++ b/README.md
@@ -208,9 +208,11 @@ either side of it breaks on the wrong database:
 
 - 006 must be on an environment's Neon branch **before that environment
   builds** the phase-4 code. `next build` prerenders `/en`, whose layout reads
-  the catalogue (`db/queries.ts#listRestaurants`: `restaurants.booking_enabled`
-  and the active `service_periods`), so a build against a 005 database stops
-  at `/en` with `column r.booking_enabled does not exist`.
+  the catalogue (then `db/queries.ts#listRestaurants`, since phase 6
+  `lib/server/content/restaurants.queries.ts#loadRestaurants`:
+  `restaurants.booking_enabled` and the active `service_periods`), so a build
+  against a 005 database stops at `/en` with `column r.booking_enabled does
+  not exist`.
 - The phase-3 code cannot write a booking on a 006 database: its INSERT names
   neither `meal` (now NOT NULL) nor `source` (no default).
 
@@ -719,9 +721,10 @@ page's `<main>` (`lib/page-scope.guard.test.ts` enforces it).
 ## Database
 
 The restaurant catalogue is the database's job, not the code's — `restaurants`
-is seeded by `db/migrations/002_seed_restaurants.sql` and read by
-`db/queries.ts#listRestaurants`, then handed to the client through
-`SiteProvider`. Editing the catalogue means editing a migration.
+is seeded by `db/migrations/002_seed_restaurants.sql` (and its content by
+008) and read by `lib/server/content/restaurants.queries.ts#loadRestaurants`,
+then handed to the client through `SiteProvider`. Editing the catalogue means
+editing a migration until the phase-7 editors.
 
 `locales`, `content_strings` and `destinations` (migration 004) are the
 shared foundations of the CMS. Which UI strings exist is decided by
```

- [ ] **Bước 7: Chạy lại test, và kiểm không còn ai import hằng đã xóa**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run lib/data.test.ts test/integration/reservation-inbox.test.ts test/integration/content-seed.test.ts`
Expected: PASS `Test Files  3 passed (3)`, `Tests  23 passed (23)`

Run: `grep -rhn "from '@/lib/data'\|from '../lib/data'" app components lib e2e test --include='*.ts' --include='*.tsx' | sed "s/.*import //" | sort -u`
Expected: 9 dòng, chỉ gồm `FALLBACK_PHONE`, `MEALS`, `MEAL_LABELS`, `SLOTS`, `type Meal` và `type Restaurant`:

```
type { Meal } from '@/lib/data';
type { Restaurant } from '@/lib/data';
{ FALLBACK_PHONE } from '@/lib/data';
{ MEALS } from '@/lib/data';
{ MEALS, MEAL_LABELS, type Restaurant } from '@/lib/data';
{ MEALS, type Meal, type Restaurant } from '@/lib/data';
{ MEAL_LABELS } from '@/lib/data';
{ MEAL_LABELS, type Meal } from '@/lib/data';
{ SLOTS, type Meal } from '@/lib/data';
```

(`lib/data.test.ts` và `lib/booking.ts` import bằng `./data`; typecheck ở Bước 8 bắt mọi tên đã xóa.)

- [ ] **Bước 8: Chạy cổng kiểm tra, rồi diff DOM**

Expected:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo;
- `Test Files  80 passed (80)`, `Tests  1018 passed (1018)` (bỏ 5 test của hằng cũ, thêm 2);
- `Applied 8 migration(s).`; build thoát 0; check-prerender như Task 8;
- E2E `161 passed`, `1 skipped` (gồm `admin-closures` và màn thông báo, giờ đọc tên điểm đến từ DB); visual `8 passed`;
- diff DOM như Task 4: chỉ R18, 14 dòng mỗi trang.

- [ ] **Bước 9: Commit**

```bash
git add README.md "app/admin/(shell)/reservations/closures/page.tsx" "app/admin/(shell)/restaurants/page.tsx" "app/admin/(shell)/settings/notifications/page.tsx" components/site/SiteProvider.tsx e2e/smoke.spec.ts lib/data.test.ts lib/data.ts lib/server/booking/queries.ts test/integration/content-seed.test.ts test/integration/reservation-inbox.test.ts
git commit -m "$(cat <<'EOF'
refactor: delete the content constants of lib/data.ts, and name destinations in the admin from the database

Every guest component reads its content from the database since the tasks
before this one, so lib/data.ts now holds code only (R1): the Meal enum and
its labels, phase 1's SLOTS (booking-seed.test.ts, until phase 10), the
fallback phone the error pages print without the database, and the
Restaurant shape. A test pins that export list. The frozen fixture
(test/fixtures/phase5-content.ts) keeps what the constants held, so
content-seed.test.ts loses the block that compared the two.

The closures, notifications and restaurants screens took destination names
from DESTS; listDestinationOptions reads them instead (every venue, published
or not, by its default-language name). The README's two references to the
deleted db/queries.ts point at loadRestaurants.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: "Gọi để đặt bàn" (R20)

Đóng rủi ro 8 của đợt 4. Luôn làm: khi mọi nhà hàng đều tắt đặt online, RESERVE mở drawer với câu `booking.all_offline` và số của resort thành link gọi, không form, thay cho "Checking tables…" mãi mãi. Nửa thẻ (chủ dự án đã đồng ý): thẻ hay kết quả tìm kiếm của nhà hàng không có trang mà tắt đặt online thì mời gọi số của nhà hàng, không có thì số của điểm đến; chạm vào là gọi. Không có số nào thì vẫn trơ như GX-6. Ba chữ mới vào registry (`screen: 'booking'`, `vars`, `context`) và tới trình duyệt cùng các key `booking.*` khác.

**Files:**
- Modify: `lib/i18n/registry.ts`, `components/overlays/ReserveDrawer.tsx`, `components/home/RestaurantCard.tsx`, `components/overlays/SearchOverlay.tsx`, `components/site/SiteProvider.tsx` (`openRestaurant`), `e2e/booking-switch.serial.spec.ts`
- Test: `lib/i18n/registry.test.ts`

**Interfaces:**
- Consumes: `Restaurant.phone: Phone | null` (số của nhà hàng, không có thì của điểm đến; Task 3); `DEFAULT_PHONE` (`lib/booking-errors.ts`, đọc `FALLBACK_PHONE`); `WithPhone({ template, params, phone })` (`components/booking/WithPhone.tsx`); `formatMessage(template, params)`; `useSite()` (`strings`, `bookable`, `openRestaurant`); `CLIENT_KEYS` (mọi key `booking.*` tới trình duyệt).
- Produces:
  - Registry: `booking.all_offline` ("Online booking is not available right now. Please call us on {phone} to book a table.", vars `phone`), `booking.call_tag` ("Call {phone}", vars `phone`), `booking.call_action` ("Call").
  - `RestaurantCard`: nhãn `View restaurant` / `Reserve a table` / `Call {display}` / không nhãn (và `aria-disabled`).
  - `SearchOverlay`: hành động `View` / `Reserve` / `Call` / không.
  - `openRestaurant(r)`: không trang, tắt đặt online, có số thì `window.location.assign('tel:<E.164>')`.

- [ ] **Bước 1: Sửa spec `booking-switch.serial`**

Spec tắt thêm Yum Food Village (MM Supercenter không có số) để giữ các kiểm GX-6 của thẻ trơ; Hải Vân Lounge (resort) giờ mời gọi `+84 236 651 9999`, và một lần chạm phát ra request `tel:+842366519999` (Chromium headless không có ứng dụng gọi, nên request đó hỏng, nhưng Playwright thấy nó) mà không mở form. Test mới tắt cả mười hai nhà hàng: mười một bằng SQL, cái thứ mười hai qua form admin (lần lưu làm hết hạn danh mục), và trả lại theo cùng đường đó trong `finally` (R21).

Sửa `e2e/booking-switch.serial.spec.ts`:

```diff
diff --git a/e2e/booking-switch.serial.spec.ts b/e2e/booking-switch.serial.spec.ts
index 4c827e0..618375a 100644
--- a/e2e/booking-switch.serial.spec.ts
+++ b/e2e/booking-switch.serial.spec.ts
@@ -4,17 +4,22 @@ import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures'
 
 /*
  * restaurants.booking_enabled (spec §5.2; ruling R14). It switches off Tàya
- * House (the default restaurant, with the only detail page) and Hải Vân
- * Lounge (a card that only reserves), which every guest page reads, so this
- * file runs in the desktop-serial project, after every other spec. The admin
- * save expires the cached catalogue with updateTag('restaurants'); without it
- * the guest pages below would keep their RESERVE buttons.
+ * House (the default restaurant, with the only detail page), Hải Vân Lounge (a
+ * card that only reserves, at the resort, which has a number) and Yum Food
+ * Village (the same at MM Supercenter, which has none). Every guest page reads
+ * them, so this file runs in the desktop-serial project, after every other
+ * spec. The admin save expires the cached catalogue with
+ * updateTag('restaurants'); without it the guest pages below would keep their
+ * RESERVE buttons. Phase 6 ("Gọi để đặt bàn", R20): a card that cannot
+ * reserve offers its number instead, and only a card with no number is inert.
  */
 
+const SWITCHED = ['taya-house', 'hai-van-lounge', 'yum-food-village'];
+
 test.beforeAll(() => seedStaff());
 test.afterAll(async () => {
-  // Whatever happened above, leave both restaurants bookable in the database.
-  await one(`UPDATE restaurants SET booking_enabled = true WHERE id IN ('taya-house', 'hai-van-lounge')`);
+  // Whatever happened below, leave every restaurant bookable in the database.
+  await one(`UPDATE restaurants SET booking_enabled = true`);
 });
 
 async function setOnline(page: Page, id: string, on: boolean) {
@@ -34,19 +39,27 @@ async function guest(browser: Browser, viewport = { width: 1280, height: 860 })
 
 test('switching online booking off hides every RESERVE of that restaurant; on again brings them back', async ({ page, browser }) => {
   await signInAs(page, STAFF.editor);
-  await setOnline(page, 'taya-house', false);
-  await setOnline(page, 'hai-van-lounge', false);
+  for (const id of SWITCHED) await setOnline(page, id, false);
 
   const home = await guest(browser);
   await home.goto(HOME_PATH);
   // Two of the three offers are theirs: only Café Indochine's keeps its button.
   await expect(home.getByRole('button', { name: /VIEW OFFER/ })).toHaveCount(1);
-  // Hải Vân Lounge has no page, so its card only reserved: now it does nothing.
-  const card = home.locator('.rcard', { hasText: 'Hải Vân Lounge' }).first();
+  // Hải Vân Lounge has no page, so its card only reserved: now it offers the resort's number (R20).
+  const lounge = home.locator('.rcard:visible', { hasText: 'Hải Vân Lounge' }).first();
+  await expect(lounge.locator('.rcard-tag')).toHaveText('Call +84 236 651 9999 →');
+  await expect(lounge).not.toHaveAttribute('aria-disabled', 'true');
+  // A tap dials that number (a tel: request, which headless Chromium has no app for), and opens no form.
+  const dialled = home.waitForRequest((r) => r.url().startsWith('tel:'));
+  await lounge.click();
+  expect((await dialled).url()).toBe('tel:+842366519999');
+  await expect(home.getByRole('dialog', { name: 'Reserve a table' })).toHaveCount(0);
+  // Yum Food Village's destination has no number: its card does nothing.
+  const card = home.locator('.rcard', { hasText: 'Yum Food Village' }).first();
   await expect(card.locator('.rcard-tag')).toHaveCount(0);
   await expect(card).toHaveAttribute('aria-disabled', 'true');
   // Nor does it look as if it did (GX-6): under the pointer, no hand and no push-in of its picture.
-  const shown = home.locator('.rcard:visible', { hasText: 'Hải Vân Lounge' }).first();
+  const shown = home.locator('.rcard:visible', { hasText: 'Yum Food Village' }).first();
   await shown.hover();
   const look = await shown.evaluate(async (el) => {
     const zoom = el.querySelector('.rcard-zoom')!;
@@ -54,11 +67,14 @@ test('switching online booking off hides every RESERVE of that restaurant; on ag
     return { cursor: getComputedStyle(el).cursor, zoom: getComputedStyle(zoom).transform };
   });
   expect(look).toEqual({ cursor: 'default', zoom: 'matrix(1, 0, 0, 1, 0, 0)' });
-  // Search names no action for it; V-Senses Cafe still reserves (phase-2 ledger: the View/Reserve label).
+  // Search offers the call for Hải Vân Lounge and nothing for Yum Food Village; V-Senses Cafe still reserves.
   await home.locator('.hdr-full .hdr-link', { hasText: 'SEARCH' }).click();
   await home.locator('.search-chip', { hasText: 'Café & Lounge' }).click();
-  await expect(home.locator('.search-result', { hasText: 'Hải Vân Lounge' }).locator('.search-result-action')).toHaveCount(0);
+  await expect(home.locator('.search-result', { hasText: 'Hải Vân Lounge' }).locator('.search-result-action')).toHaveText('Call →');
   await expect(home.locator('.search-result', { hasText: 'V-Senses Cafe' }).locator('.search-result-action')).toHaveText('Reserve →');
+  await home.locator('.search-input').fill('yum');
+  await expect(home.locator('.search-result', { hasText: 'Yum Food Village' })).toHaveCount(1);
+  await expect(home.locator('.search-result', { hasText: 'Yum Food Village' }).locator('.search-result-action')).toHaveCount(0);
   await home.keyboard.press('Escape');
   // The generic RESERVE opens on the first bookable restaurant, and the list leaves both out.
   await home.getByRole('button', { name: 'RESERVE', exact: true }).first().click();
@@ -80,8 +96,7 @@ test('switching online booking off hides every RESERVE of that restaurant; on ag
   await expect(bar.getByRole('button', { name: 'RESERVE' })).toHaveCount(0);
   await expect(bar).toHaveAttribute('style', /repeat\(3, minmax\(0, 1fr\)\)/); // CALL, MAP, MENU
 
-  await setOnline(page, 'taya-house', true);
-  await setOnline(page, 'hai-van-lounge', true);
+  for (const id of SWITCHED) await setOnline(page, id, true);
   await detail.reload();
   await expect(detail.getByRole('button', { name: /RESERVE A TABLE/ })).toBeVisible();
   await home.reload();
@@ -89,3 +104,28 @@ test('switching online booking off hides every RESERVE of that restaurant; on ag
   await expect(home.locator('.rcard', { hasText: 'Hải Vân Lounge' }).first().locator('.rcard-tag')).toHaveText('Reserve a table →');
   for (const p of [home, detail, phone]) await p.context().close();
 });
+
+test('with every restaurant booking offline, RESERVE opens on whom to call, not on a form that never loads', async ({ page, browser }) => {
+  await signInAs(page, STAFF.editor);
+  // Eleven in the database, then the twelfth through the admin, whose save expires the cached catalogue.
+  await one(`UPDATE restaurants SET booking_enabled = false WHERE id <> 'the-fan'`);
+  try {
+    await setOnline(page, 'the-fan', false);
+    const home = await guest(browser);
+    await home.goto(HOME_PATH);
+    await expect(home.getByRole('button', { name: /VIEW OFFER/ })).toHaveCount(0);
+    await home.getByRole('button', { name: 'RESERVE', exact: true }).first().click();
+    const drawer = home.getByRole('dialog', { name: 'Reserve a table' });
+    await expect(drawer.getByRole('alert')).toHaveText(
+      'Online booking is not available right now. Please call us on +84 236 651 9999 to book a table.',
+    );
+    await expect(drawer.getByRole('link', { name: '+84 236 651 9999' })).toHaveAttribute('href', 'tel:+842366519999');
+    await expect(drawer.getByRole('button', { name: 'REQUEST BOOKING' })).toHaveCount(0);
+    await expect(drawer.getByText('Checking tables…')).toHaveCount(0);
+    await home.context().close();
+  } finally {
+    // Back through the same save (R21), which expires the catalogue again.
+    await one(`UPDATE restaurants SET booking_enabled = true WHERE id <> 'the-fan'`);
+    await setOnline(page, 'the-fan', true);
+  }
+});
```

- [ ] **Bước 2: Build code hiện tại và chạy spec: phải đỏ**

Reset DB E2E, build, rồi:

```bash
rm -f "${TMPDIR:-/tmp}/furama-e2e-emails.ndjson"
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson CRON_SECRET=$(openssl rand -hex 16) E2E_PORT=3210 npx playwright test --retries=0 e2e/booking-switch.serial.spec.ts --project=desktop-serial --no-deps
```

Expected: `2 failed`:

```
  ✘  1 [desktop-serial] › e2e/booking-switch.serial.spec.ts:40:5 › switching online booking off hides every RESERVE of that restaurant; on again brings them back (6.5s)
  ✘  2 [desktop-serial] › e2e/booking-switch.serial.spec.ts:108:5 › with every restaurant booking offline, RESERVE opens on whom to call, not on a form that never loads (6.0s)
    Locator: locator('.rcard:visible').filter({ hasText: 'Hải Vân Lounge' }).first().locator('.rcard-tag')
    Expected: "Call +84 236 651 9999 →"
    Error: element(s) not found
    > 50 |   await expect(lounge.locator('.rcard-tag')).toHaveText('Call +84 236 651 9999 →');
    Locator: getByRole('dialog', { name: 'Reserve a table' }).getByRole('alert')
    Expected: "Online booking is not available right now. Please call us on +84 236 651 9999 to book a table."
    Error: element(s) not found
    > 119 |     await expect(drawer.getByRole('alert')).toHaveText(
```

Test đầu dừng giữa chừng, nên `afterAll` bật lại mọi nhà hàng bằng SQL mà không làm hết hạn cache: reset DB E2E và build lại trước lần chạy kế tiếp (cổng kiểm tra luôn làm vậy).

- [ ] **Bước 3: Viết test của registry**

Ngoài các kiểm chung của mọi key (độ dài, `context`, `screen` có thật, `vars` khớp chữ), ba key mới phải tới trình duyệt (`CLIENT_KEYS`), và hai key mang số khai `phone`.

Sửa `lib/i18n/registry.test.ts`:

```diff
diff --git a/lib/i18n/registry.test.ts b/lib/i18n/registry.test.ts
index df5671e..d3c328d 100644
--- a/lib/i18n/registry.test.ts
+++ b/lib/i18n/registry.test.ts
@@ -27,6 +27,12 @@ describe('registry', () => {
   it('sends the privacy notice, the consent label and the policy link to the browser (the drawer and the footer read them)', () => {
     expect(CLIENT_KEYS).toEqual(expect.arrayContaining(['booking.privacy_notice', 'booking.consent', 'legal.link']));
   });
+
+  it('sends "Gọi để đặt bàn" to the browser: the drawer’s all-offline message and the call labels of cards and search (R20)', () => {
+    expect(CLIENT_KEYS).toEqual(expect.arrayContaining(['booking.all_offline', 'booking.call_tag', 'booking.call_action']));
+    expect(REGISTRY['booking.all_offline'].vars).toEqual(['phone']);
+    expect(REGISTRY['booking.call_tag'].vars).toEqual(['phone']);
+  });
 });
 
 describe('formatMessage', () => {
```

- [ ] **Bước 4: Chạy test, phải đỏ**

Run: `npx vitest run lib/i18n/registry.test.ts`
Expected: FAIL `Tests  1 failed | 82 passed (83)`:

```
 FAIL  lib/i18n/registry.test.ts > registry > sends "Gọi để đặt bàn" to the browser: the drawer’s all-offline message and the call labels of cards and search (R20)
AssertionError: expected [ …(32) ] to deeply equal ArrayContaining{…}
- ArrayContaining [
-   "booking.all_offline",
-   "booking.call_tag",
-   "booking.call_action",
 ❯ lib/i18n/registry.test.ts:32:25
```

- [ ] **Bước 5: Ba key mới**

Sửa `lib/i18n/registry.ts`:

```diff
diff --git a/lib/i18n/registry.ts b/lib/i18n/registry.ts
index 53d5aff..a7c44c2 100644
--- a/lib/i18n/registry.ts
+++ b/lib/i18n/registry.ts
@@ -191,6 +191,30 @@ export const REGISTRY = {
     context: 'Reservation form, when no date in the booking window takes bookings. {phone} is the restaurant’s number; keep it.',
     screen: 'booking',
   },
+  // ── "Gọi để đặt bàn" (R20, phase 6): when online booking is off, the number to call instead. ──
+  'booking.all_offline': {
+    en: 'Online booking is not available right now. Please call us on {phone} to book a table.',
+    maxLength: 140,
+    vars: ['phone'],
+    context:
+      'Reservation form, in place of the whole form when staff have switched online booking off for every restaurant. {phone} is the resort’s number, shown as a link to call; keep it.',
+    screen: 'booking',
+  },
+  'booking.call_tag': {
+    en: 'Call {phone}',
+    maxLength: 40,
+    vars: ['phone'],
+    context:
+      'Restaurant card on the home page, the tag shown on hover (in capitals by CSS; "→" follows), for a restaurant with no page of its own whose online booking staff have switched off: a tap calls it. {phone} is the restaurant’s number, else its destination’s, as printed; keep it.',
+    screen: 'booking',
+  },
+  'booking.call_action': {
+    en: 'Call',
+    maxLength: 20,
+    context:
+      'Search results, the action at the end of a row ("→" follows), for a restaurant with no page of its own whose online booking staff have switched off: a tap calls it. Short: the row is narrow on a phone.',
+    screen: 'booking',
+  },
   'booking.day_outside': {
     en: 'Not open for booking yet',
     maxLength: 40,
```

- [ ] **Bước 6: Drawer khi mọi nhà hàng đều tắt**

Không còn nhà hàng nào để chọn và không availability nào để chờ, nên thân drawer chỉ còn câu báo (vai trò `alert`, cùng kiểu chữ `.drawer-error` với các lỗi đặt bàn khác) và số của resort (`DEFAULT_PHONE`, không cần DB) thành link `tel:`.

Sửa `components/overlays/ReserveDrawer.tsx`:

```diff
diff --git a/components/overlays/ReserveDrawer.tsx b/components/overlays/ReserveDrawer.tsx
index 027a84c..05003d0 100644
--- a/components/overlays/ReserveDrawer.tsx
+++ b/components/overlays/ReserveDrawer.tsx
@@ -15,6 +15,7 @@ import { animateSelector, useOpenAnimation } from '@/lib/motion';
 import { privacyHref } from '@/lib/legal';
 import { Honeypot } from '@/components/overlays/Honeypot';
 import { BookingError, WithPhone } from '@/components/booking/WithPhone';
+import { DEFAULT_PHONE } from '@/lib/booking-errors';
 
 /**
  * Availability that did not arrive: why, and a way to ask again when asking
@@ -333,7 +334,15 @@ export function ReserveDrawer() {
           </button>
         </div>
 
-        {done ? (
+        {bookable.length === 0 && !done ? (
+          // Every restaurant books offline (R14): there is nothing to choose and no availability to wait
+          // for, so no form, only whom to call (R20; before, "Checking tables…" stayed for good).
+          <div className="drawer-body">
+            <p className="drawer-error" role="alert">
+              <WithPhone template={strings['booking.all_offline']} params={{}} phone={DEFAULT_PHONE} />
+            </p>
+          </div>
+        ) : done ? (
           <div className="drawer-done">
             <div className="drawer-tick" aria-hidden="true">
               ✓
```

- [ ] **Bước 7: Thẻ, tìm kiếm và cú chạm gọi**

Thẻ in "Call {display}" (CSS viết hoa như mọi nhãn thẻ, rồi " →"); hàng tìm kiếm in "Call" ngắn vì hàng hẹp trên điện thoại (như spike detail; khác câu chữ R20 của dàn ý, số đo và lựa chọn cho controller ở R20). Một thẻ có hành động thì không `aria-disabled`, nên có con trỏ tay và ảnh phóng nhẹ như thẻ đặt bàn. Thẻ và hàng tìm kiếm cùng đi qua `openRestaurant`.

Sửa `components/home/RestaurantCard.tsx`:

```diff
diff --git a/components/home/RestaurantCard.tsx b/components/home/RestaurantCard.tsx
index b614206..b23793f 100644
--- a/components/home/RestaurantCard.tsx
+++ b/components/home/RestaurantCard.tsx
@@ -1,6 +1,7 @@
 'use client';
 
 import type { Restaurant } from '@/lib/data';
+import { formatMessage } from '@/lib/i18n/format';
 import { CmsImage } from '@/components/ui/CmsImage';
 import { useSite } from '@/components/site/SiteProvider';
 import { useReveal } from '@/lib/motion';
@@ -10,10 +11,17 @@ import { useReveal } from '@/lib/motion';
  * whole grid does not re-render on pointer move.
  */
 export function RestaurantCard({ restaurant, hidden }: { restaurant: Restaurant; hidden?: boolean }) {
-  const { openRestaurant } = useSite();
+  const { openRestaurant, strings } = useSite();
   const ref = useReveal<HTMLButtonElement>('card');
-  // A card without a page only reserves: with online booking off it has no action (R14).
-  const tag = restaurant.hasDetailPage ? 'View restaurant' : restaurant.bookingEnabled ? 'Reserve a table' : null;
+  // A card without a page reserves; with online booking off (R14) it calls instead (R20), and with
+  // no number either it has no action (GX-6).
+  const tag = restaurant.hasDetailPage
+    ? 'View restaurant'
+    : restaurant.bookingEnabled
+      ? 'Reserve a table'
+      : restaurant.phone
+        ? formatMessage(strings['booking.call_tag'], { phone: restaurant.phone.display })
+        : null;
 
   return (
     <button
```

Sửa `components/overlays/SearchOverlay.tsx`:

```diff
diff --git a/components/overlays/SearchOverlay.tsx b/components/overlays/SearchOverlay.tsx
index 0d39d70..71869fe 100644
--- a/components/overlays/SearchOverlay.tsx
+++ b/components/overlays/SearchOverlay.tsx
@@ -6,7 +6,7 @@ import { useSite } from '@/components/site/SiteProvider';
 import { useOpenAnimation } from '@/lib/motion';
 
 export function SearchOverlay() {
-  const { site, destName, restaurants, overlay, close, query, setQuery, openRestaurant } = useSite();
+  const { site, destName, restaurants, overlay, close, query, setQuery, openRestaurant, strings } = useSite();
   const inputRef = useRef<HTMLInputElement>(null);
   const open = overlay === 'search';
 
@@ -87,9 +87,10 @@ export function SearchOverlay() {
                     <span className="search-result-name">{r.name}</span>
                     <span className="search-result-meta">{`${r.type} · ${destName(r.dest)}`}</span>
                   </span>
-                  {(r.hasDetailPage || r.bookingEnabled) && (
+                  {/* With online booking off, a restaurant with a number is called (R20); one without has no action. */}
+                  {(r.hasDetailPage || r.bookingEnabled || r.phone) && (
                     <span className="search-result-action">
-                      {r.hasDetailPage ? 'View' : 'Reserve'} →
+                      {r.hasDetailPage ? 'View' : r.bookingEnabled ? 'Reserve' : strings['booking.call_action']} →
                     </span>
                   )}
                 </button>
```

Sửa `components/site/SiteProvider.tsx`:

```diff
diff --git a/components/site/SiteProvider.tsx b/components/site/SiteProvider.tsx
index e485907..6646017 100644
--- a/components/site/SiteProvider.tsx
+++ b/components/site/SiteProvider.tsx
@@ -566,8 +566,9 @@ export function SiteProvider({
   const openRestaurant = useCallback(
     (r: Restaurant) => {
       if (!r.hasDetailPage) {
-        // Its only action is reserving; with online booking off there is none (R14).
+        // Its action is reserving; with online booking off (R14) it is calling, when there is a number (R20).
         if (r.bookingEnabled) openReserve({ restaurant: r.id });
+        else if (r.phone) window.location.assign(`tel:${r.phone.tel}`);
         return;
       }
       setBooking({ restaurant: r.id });
```

- [ ] **Bước 8: Chạy lại test**

Run: `npx vitest run lib/i18n/registry.test.ts`
Expected: PASS `Test Files  1 passed (1)`, `Tests  86 passed (86)` (ba key mới mỗi key một kiểm chung, cộng test của Bước 3)

- [ ] **Bước 9: Chạy cổng kiểm tra, rồi diff DOM**

Expected:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo;
- `Test Files  80 passed (80)`, `Tests  1022 passed (1022)`;
- `Applied 8 migration(s).`; build thoát 0; check-prerender như Task 8;
- E2E `162 passed`, `1 skipped`; visual `8 passed` (mọi nhà hàng đặt online được trong baseline, nên không thẻ nào đổi nhãn);
- diff DOM như Task 4: chỉ R18, 14 dòng mỗi trang.

- [ ] **Bước 10: Commit**

```bash
git add components/home/RestaurantCard.tsx components/overlays/ReserveDrawer.tsx components/overlays/SearchOverlay.tsx components/site/SiteProvider.tsx e2e/booking-switch.serial.spec.ts lib/i18n/registry.test.ts lib/i18n/registry.ts
git commit -m "$(cat <<'EOF'
feat: name the number to call when online booking is off, on the card, in search and in the empty reservation form

Phase 4 left two dead ends (its risk 8, "Gọi để đặt bàn"), closed here as R20
rules. With every restaurant switched off, RESERVE opened a form that said
"Checking tables…" for good; it now says booking.all_offline instead, with
the resort's number as a link, and shows no form. A card or a search result
without a page whose online booking is off had no action; with a number (its
own, else its destination's) the card's tag reads "Call +84 … →", search
says "Call →", and a tap dials it. One with no number at all stays inert, as
GX-6 asked. The three strings are new guest text, so they enter the registry
(screen booking) and reach the browser with the other booking.* keys.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Nghiệm thu và các lần chạy đột biến

Hai tiêu chí nghiệm thu của spec §14.1 dòng 6 đã có test: "web giống hệt bản trước" là 8 ảnh baseline ở ngưỡng 0 (chưa đổi từ trước đợt 2, chạy xanh ở mọi task) cùng diff DOM chỉ còn R18; "bật `has_detail_page` cho một nhà hàng khác thì trang chạy" là `e2e/restaurant-pages.serial.spec.ts` (Task 7). Task này chứng minh các test đó, và các test giữ cache, ưu đãi, `offerId` và cột đợt 1, bắt được lỗi thật: mỗi đột biến sửa đúng một chỗ trong một bản sao tạm của repo, chạy test của nó, rồi trả lại. Theo dàn ý, chỉ commit thay đổi test mà đột biến chứng minh là cần. Một đột biến sống sót (M2 ở tầng E2E), nên task có một commit: spec nghiệm thu kiểm 404 trong trình duyệt và tắt trang mà không gỡ nội dung của nó.

**Files:**
- Modify: `e2e/restaurant-pages.serial.spec.ts`

**Interfaces:**
- Consumes: mọi thứ của Task 1–11; `seedStaff`, `signInAs`, `STAFF`, `one` (fixture E2E); hai trang 404 của site (`app/(site)/[lang]/(guarded)/not-found.tsx`: `<h1>Page not found</h1>`; tiêu đề `NOT_FOUND` của trang chi tiết: "Page not found — Furama Cuisine").
- Produces: không API mới. Bảng đột biến (Bước 2–7) cho "Bản kiểm chứng".

- [ ] **Bước 1: Dựng bản sao cho các đột biến**

Trên commit của Task 11, khi không server hay lần test nào khác đang chạy, từ gốc repo, làm một bản sao APFS ở `${TMPDIR:-/tmp}/fc-mut` và bỏ `.next` và `.env.local` của nó (file đó giữ URL Neon dùng chung và các bí mật; không để bản sao của nó trong thư mục tạm). Bản sao cũ bị xóa trước: `cp -R` vào một thư mục đã có tạo `fc-mut/<tên repo>/`, kèm một `.env.local` mà lệnh `rm` không với tới. Mọi lệnh của task này chạy từ gốc repo và tự đủ: đường dẫn tuyệt đối, `cd` chỉ trong ngoặc đơn, không biến nào sống qua hai lệnh (công cụ chạy lệnh của agent không giữ biến hay thư mục giữa hai lần gọi).

```bash
rm -rf "${TMPDIR:-/tmp}/fc-mut" && cp -cR "$(git rev-parse --show-toplevel)" "${TMPDIR:-/tmp}/fc-mut" && rm -rf "${TMPDIR:-/tmp}/fc-mut/.next" "${TMPDIR:-/tmp}/fc-mut/.env.local" && test ! -e "${TMPDIR:-/tmp}/fc-mut/.env.local" && echo READY
```

Expected: `READY`.

Mỗi đột biến, theo thứ tự: trả bản sao về commit (`git -C "${TMPDIR:-/tmp}/fc-mut" checkout -- .`), sửa đúng chỗ ghi trong bảng trong file của bản sao (`${TMPDIR:-/tmp}/fc-mut/<file>`, không bao giờ file của repo), rồi chạy lệnh của tầng đó:
- **Tích hợp:**

  ```bash
  (cd "${TMPDIR:-/tmp}/fc-mut" && TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/content-loaders.test.ts)
  ```

  với file của cột "Chạy" thay cho `test/integration/content-loaders.test.ts`.
- **E2E** (lệnh cho `restaurant-pages.serial`; dòng khác đổi tên spec theo cột "Spec", và `offer-booking` dùng `--project=desktop` thay cho `--project=desktop-serial --no-deps`):

  ```bash
  (cd "${TMPDIR:-/tmp}/fc-mut" && RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs && CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build && rm -f "${TMPDIR:-/tmp}/furama-e2e-emails.ndjson" && CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3210 EMAIL_DELIVERY=log EMAIL_LOG_FILE=${TMPDIR:-/tmp}/furama-e2e-emails.ndjson CRON_SECRET=$(openssl rand -hex 16) E2E_PORT=3210 npx playwright test --retries=0 e2e/restaurant-pages.serial.spec.ts --project=desktop-serial --no-deps); lsof -ti tcp:3210 | xargs kill
  ```

- **Visual:**

  ```bash
  (cd "${TMPDIR:-/tmp}/fc-mut" && RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs && CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build)
  lsof -nP -iTCP:3211 -sTCP:LISTEN
  (cd "${TMPDIR:-/tmp}/fc-mut" && CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3211 EMAIL_DELIVERY=log CRON_SECRET=$(openssl rand -hex 16) npx next start -p 3211 &)
  for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3211/en && break; sleep 1; done
  (cd "${TMPDIR:-/tmp}/fc-mut" && VISUAL_BASE_URL=http://localhost:3211 npm run test:visual)
  lsof -ti tcp:3211 | xargs kill
  ```

- [ ] **Bước 2: Đột biến của loader, cron, `offerId` và guard (tích hợp)**

| # | Đột biến (một sửa, trong bản sao) | Chạy | Kết quả |
|---|---|---|---|
| M2 | `lib/server/content/restaurants.queries.ts`: `WHERE has_detail_page AND is_published AND archived_at IS NULL` (của `loadDetailSlugs`) → `WHERE is_published AND archived_at IS NULL`, và `WHERE r.slug = $2 AND r.has_detail_page AND r.is_published` (của `loadRestaurantDetail`) → `WHERE r.slug = $2 AND r.is_published` | `test/integration/content-loaders.test.ts` | `Tests  3 failed \| 24 passed (27)`: "Tàya House’s page is the one the site drew …", "none for a restaurant without has_detail_page, an unknown slug, an unpublished or an archived one", "switching has_detail_page on for another restaurant gives it a page …" |
| M4 | `lib/server/content/home.queries.ts` (`loadOffers`): xóa hai dòng `AND (o.valid_from IS NULL OR o.valid_from <= ${VENUE_TODAY})` và `AND (o.valid_until IS NULL OR o.valid_until >= ${VENUE_TODAY})` | `test/integration/content-loaders.test.ts` | `Tests  1 failed \| 26 passed (27)`: "shows an offer from its valid_from to its valid_until, both days included, by the date in Da Nang" |
| M5 | `app/api/cron/daily/route.ts`: `if (!cronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET)) {` → `if (!cronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET) && false) {` | `test/integration/cron-daily.test.ts` | `Tests  1 failed \| 2 passed (3)`: "answers 401 without the secret, with a wrong one, and when CRON_SECRET is unset or short; revalidates nothing" |
| M6 (server) | `lib/server/booking/create.ts`: tham số cuối của INSERT `input.offerId,` → `null,` | `test/integration/submit-reservation.test.ts` | `Tests  1 failed \| 30 passed (31)`: "keeps an offer of the booked restaurant that is published and runs on the booked date, its last day included" |
| M7 | `loadOffers`: `WHERE o.is_published AND ${tr('ot', 'title')} IS NOT NULL` → `WHERE ${tr('ot', 'title')} IS NOT NULL` | `test/integration/content-loaders.test.ts` | `Tests  1 failed \| 26 passed (27)`: "an unpublished offer, and the offers of a restaurant that is unpublished or archived" |
| M9 | `lib/server/content/restaurants.queries.ts` (`loadRestaurants`): `r.destination_id, ${tr('dt', 'name')} AS destination_name` → `r.destination_id, r.destination, ${tr('dt', 'name')} AS destination_name` | `test/guards/legacy-columns.guard.test.ts` | `Tests  1 failed \| 1 passed (2)`: "finds none in app, components, lib, db and scripts" |

- [ ] **Bước 3: M10, mười đột biến seed và chín đột biến an toàn của migration 008 (spike schema), trên 008 cuối**

Seed (chạy `test/integration/content-seed.test.ts`; mỗi dòng `Tests  1 failed | 10 passed (11)`):

| # | Sửa trong `db/migrations/008_content.sql` | Test đỏ |
|---|---|---|
| S1 gạch ngang | `'Nightly 18:30–22:00'` → `'Nightly 18:30-22:00'` | "offers: venue, title, the detail rebuilt from price and schedule, the restaurant, no expiry" |
| S2 cờ trang trí | `OR v.pathname IN ('/assets/heritage.jpg', '/assets/hero-taya.jpg', '/assets/hero-indochine.jpg')` → bỏ `'/assets/hero-taya.jpg', ` | "marks as decorative exactly the images drawn with alt="", so the phase-9 alt generator leaves them alone" |
| S3 số byte | `('/assets/chef.jpg', 'image/jpeg', 456, 378, 57833)` → `… 57834)` | "has a row for every file in public/assets, measured from the file, and nothing else" |
| S4 ngày câu chuyện | `'2026-09-09', 10)` → `'2026-09-08', 10)` | "experiences, and stories whose kicker is rebuilt from the category and the date" |
| S5 nháy cong | `the resort’s “Green Oasis` → `the resort''s “Green Oasis` (nháy thẳng) | "the detail page: Tàya House only, with its copy, portrait, SEO, menu, highlights, CALL and MAP" |
| S6 chữ hoa nav | `(1, 'Restaurants')` → `(1, 'RESTAURANTS')` | "navigation, social links and the site settings" |
| S7 thứ tự ẩm thực | `('vietnamese', 10), ('italian', 20)` → `('vietnamese', 20), ('italian', 10)` | "cuisines: slug, label, order and image, drawn as decoration" |
| S8 địa chỉ NFD | `'73 Trần Bạch Đằng, An Thượng'` → cùng chữ, nhưng "Trần" ở dạng NFD (`unicodedata.normalize('NFD', 'Trần')`) | "destinations: card lines, picture, name, and the footer line from name, address and phone" |
| S9 chữ hoa alt | `'Cooking class photo'` → `'Cooking Class photo'` | "the detail page: Tàya House only, …" |
| S10 dịp mặc định | `DEFAULT 'Dinner'` → `DEFAULT 'Lunch'` | "navigation, social links and the site settings" |

An toàn của migration (chạy `test/integration/migration-008.test.ts`):

| # | Sửa trong `db/migrations/008_content.sql` | Kết quả |
|---|---|---|
| R1 chặn bật lại trang | bỏ dòng `   AND r.detail_image_id IS NULL` của câu UPDATE bật trang Tàya | `1 failed \| 19 passed (20)`: "is safe to apply again: no row added, no edit undone, no sequence moved back" |
| R2 sequence lùi | trong dòng `setval` của `stories` (`008_content.sql:829`, các cột căn bằng dãy khoảng trắng), thay `GREATEST((SELECT max(id) FROM stories),               (SELECT last_value FROM stories_id_seq))` (mười lăm khoảng trắng sau dấu phẩy) bằng `(SELECT max(id) FROM stories)` | `1 failed \| 19 passed (20)`: "is safe to apply again …" |
| R3 seed lại `site_settings` | thêm `UPDATE site_settings SET default_restaurant_id = 'taya-house', default_occasion = 'Dinner';` ngay trước khối `-- ── identity sequences` | `1 failed \| 19 passed (20)`: "is safe to apply again …" |
| R4 seed lại link đã gỡ | trong câu INSERT của `restaurant_cuisines`, bỏ dòng ` WHERE NOT EXISTS (SELECT 1 FROM restaurant_cuisines rc WHERE rc.restaurant_id = r.id)` | `1 failed \| 19 passed (20)`: "is safe to apply again …" |
| R5 chặn nhãn khi chạy lại | trong khối `DO` chặn nhãn lạ, bỏ điều kiện `NOT EXISTS (SELECT 1 FROM restaurant_cuisines rc …) AND` | `2 failed \| 18 passed (20)`: "is safe to apply again …" và "does not bring back a seeded row an editor deleted …", cả hai với `restaurants.cuisines holds label(s) with no cuisine: Thai` (nhãn Thai vừa được đổi tên) |
| R6 CHECK ảnh trang | `CHECK (NOT has_detail_page OR detail_image_id IS NOT NULL)` → `CHECK (true)` | `2 failed \| 18 passed (20)`: "restaurants: a page needs its portrait, …" (`promise resolved … instead of rejecting`), và kéo theo "cuisines: slug ids; …" (khối constraints chạy nối tiếp trên một DB, và nhà hàng `new-place` mà nó dùng chưa được test trước tạo) |
| R7 RESTRICT | trong `CREATE TABLE IF NOT EXISTS cuisines`, `REFERENCES media (id) ON DELETE RESTRICT` → `ON DELETE CASCADE` | `1 failed \| 19 passed (20)`: "a file in use cannot be deleted (ON DELETE RESTRICT); an unused one can" |
| R8 chặn `offer_id` có sẵn | `    IF n > 0 THEN` → `    IF false THEN` | `1 failed \| 19 passed (20)`: "stops, changing nothing, when a booking already carries an offer_id" |
| R9 cột đợt 1 còn NOT NULL | `ALTER COLUMN type DROP NOT NULL,` / `ALTER COLUMN destination DROP NOT NULL;` → `SET NOT NULL` | `5 failed \| 15 passed (20)`: "gives every restaurant a slug, a destination_id and a card picture, and only Tàya House a page" (`is_nullable`), ba test constraints chèn một nhà hàng kiểu đợt 7 (`null value in column "type" of relation "restaurants" violates not-null constraint`) và test `cuisines` kéo theo |

- [ ] **Bước 4: Đột biến E2E: M1, M2, M3, M4, M6 (client)**

Mỗi dòng một build trong bản sao (lệnh E2E của Bước 1).

| # | Đột biến | Spec | Kết quả |
|---|---|---|---|
| M1 | `lib/server/content/restaurants.ts` (`getRestaurantDetail`): `cacheTag(...LOADERS.detail.tags, TAGS.i18n(locale));` → `cacheTag(...LOADERS.detail.tags.filter((t) => t !== TAGS.restaurants), TAGS.i18n(locale));` | `restaurant-pages.serial` | `1 failed`: `Expected: "Steakhouse The Fan — Furama Cuisine"`, `Received: "Page not found — Furama Cuisine"` (404 đã cache không mang `restaurants`, nên lần lưu không xóa được nó) |
| M2 | như Bước 2 | `restaurant-pages.serial` | **`1 passed`: sống sót** |
| M3 | `app/admin/(shell)/settings/notifications/actions.ts` (`saveInbox`): xóa dòng `    updateTag(TAGS.contentContact);` | `shared-inbox.serial` | `1 failed`: `Expected: "datban@furama.test"`, `Received: "fb@furamavietnam.com"` |
| M4 | như Bước 2 | `offers-expiry.serial` | `1 failed`: `Expected: 2`, `Received: 3` sau 15 s tải lại |
| M6 (client) | `components/site/SiteProvider.tsx`: xóa dòng `      ...(offer && offer.restaurant === booking.restaurant ? { offerId: offer.id } : {}),` | `offer-booking` (`--project=desktop`) | `1 failed`, `1 passed`: thiếu `"offerId": 1` ở lần gửi đầu |

M2 sống ở tầng E2E vì hai lẽ. Kiểm "chưa có trang" của spec đọc chữ của response tìm "Page not found", mà chữ đó có trong mọi trang: payload RSC của mỗi trang mang boundary not-found của layout (`grep -c "Page not found"` trên HTML build của `/en` và của trang Tàya đều ra `1`). Và lúc tắt, spec gỡ luôn chân dung, nên loader có bỏ qua `has_detail_page` cũng không có gì để vẽ (thiếu chân dung là `null`). Test tích hợp đã đỏ với M2 (Bước 2); spec nghiệm thu phải đỏ theo.

- [ ] **Bước 5: Spec nghiệm thu kiểm 404 trong trình duyệt và tắt trang mà giữ nội dung**

404 được kiểm bằng heading `Page not found`, tiêu đề tab và việc không có hero của nhà hàng, trong trình duyệt. Tắt trang là chỉ công tắc, qua cùng lần lưu (R21); chân dung, chữ và highlight ở lại tới `afterAll` (với trang đã tắt, không trang khách nào đọc chúng, nên gỡ bằng SQL không làm lệch cache).

Sửa `e2e/restaurant-pages.serial.spec.ts` **trong repo**, không trong bản sao: đây là thay đổi duy nhất mà commit của task này mang (Bước 9), và Bước 6 chép nó sang bản sao.

Sửa `e2e/restaurant-pages.serial.spec.ts`:

```diff
diff --git a/e2e/restaurant-pages.serial.spec.ts b/e2e/restaurant-pages.serial.spec.ts
index 7cd7d1f..9dcab41 100644
--- a/e2e/restaurant-pages.serial.spec.ts
+++ b/e2e/restaurant-pages.serial.spec.ts
@@ -11,7 +11,11 @@ import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures'
  * calls updateTag('restaurants') (the booking rules form) expires the cached
  * pages, as the editor's save will (R21: the restore goes through the same
  * save). The Fan has no map link and no menu PDF: MAP hides, and MENU scrolls
- * to the highlights; CALL is its destination's number.
+ * to the highlights; CALL is its destination's number. Off is the switch
+ * alone: the portrait, the copy and the highlights stay, so the 404 that
+ * follows can only come from has_detail_page (a loader that ignored it would
+ * still draw the page). The rest goes after the test; with the page off, no
+ * guest page reads it.
  *
  * It changes what every guest page reads (the catalogue), so it runs in the
  * desktop-serial project, one file at a time, after every other spec.
@@ -20,6 +24,7 @@ import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures'
 const FAN_PATH = '/en/restaurants/the-fan';
 
 test.beforeAll(() => seedStaff());
+test.afterAll(() => closeTheFan());
 
 async function openTheFan() {
   await one(
@@ -60,6 +65,17 @@ async function refreshGuestPages(page: Page) {
   await expect(page.getByRole('form', { name: 'Quy tắc đặt bàn' }).getByRole('status')).toHaveText('Đã lưu.');
 }
 
+/**
+ * The site's 404, seen in a browser. Not the response's text: every page's RSC
+ * payload carries the not-found boundary, "Page not found" included, so a
+ * page that rendered would match that too.
+ */
+async function expectNotFound(visitor: Page) {
+  await expect(visitor.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
+  await expect(visitor).toHaveTitle('Page not found — Furama Cuisine');
+  await expect(visitor.locator('.taya-hero-copy')).toHaveCount(0);
+}
+
 /** A guest with no staff cookie, past the intro. */
 async function guest(browser: Browser, viewport = { width: 1280, height: 860 }) {
   const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
@@ -70,8 +86,8 @@ async function guest(browser: Browser, viewport = { width: 1280, height: 860 })
 test('switching has_detail_page on opens a working page for another restaurant, and off closes it again', async ({ page, browser }) => {
   const visitor = await guest(browser);
   // Before: no page (a cached 404 from here on, tagged restaurants), and the card only reserves.
-  const before = await visitor.request.get(FAN_PATH);
-  expect(await before.text()).toContain('Page not found');
+  await visitor.goto(FAN_PATH);
+  await expectNotFound(visitor);
   await visitor.goto(HOME_PATH);
   await expect(visitor.locator('.rcard:visible', { hasText: 'Steakhouse The Fan' }).locator('.rcard-tag')).toHaveText('Reserve a table →');
 
@@ -130,13 +146,13 @@ test('switching has_detail_page on opens a working page for another restaurant,
     await expect(phone.getByRole('navigation', { name: 'Restaurant actions' })).toHaveAttribute('style', /repeat\(4, minmax\(0, 1fr\)\)/);
     await phone.context().close();
   } finally {
-    await closeTheFan();
+    await one(`UPDATE restaurants SET has_detail_page = false WHERE id = 'the-fan'`);
     await refreshGuestPages(page);
   }
 
-  // Off again: the page 404s and the card reserves.
-  const after = await visitor.request.get(FAN_PATH);
-  expect(await after.text()).toContain('Page not found');
+  // Off again, with its portrait, copy and highlights still there: the page 404s and the card reserves.
+  await visitor.goto(FAN_PATH);
+  await expectNotFound(visitor);
   await visitor.goto(HOME_PATH);
   await expect(visitor.locator('.rcard:visible', { hasText: 'Steakhouse The Fan' }).locator('.rcard-tag')).toHaveText('Reserve a table →');
   await visitor.context().close();
```

- [ ] **Bước 6: Chạy lại M2 và M1 với spec mới, và spec mới trên code thật**

Ba lần chạy dưới đây (M2, M1, không đột biến), mỗi lần theo thứ tự: trả bản sao về commit **rồi** chép spec mới của repo vào nó (chép trước `git checkout` thì lệnh đó đưa spec của Task 7 trở lại, và M2 lại sống), rồi sửa đột biến của dòng đó (không sửa gì cho dòng cuối), rồi lệnh E2E của Bước 1 cho `restaurant-pages.serial`. Từ gốc repo:

```bash
git -C "${TMPDIR:-/tmp}/fc-mut" checkout -- . && cp e2e/restaurant-pages.serial.spec.ts "${TMPDIR:-/tmp}/fc-mut/e2e/"
```


| Code | Kết quả |
|---|---|
| M2 | `1 failed`, ở lần 404 thứ hai (dòng 155, `expectNotFound`): `Locator: getByRole('heading', { name: 'Page not found', level: 1 })`, `Error: element(s) not found` (trang The Fan vẫn hiện sau khi tắt) |
| M1 | `1 failed`, dòng 101: `Expected: "Steakhouse The Fan — Furama Cuisine"`, `Received: "Page not found — Furama Cuisine"` |
| không đột biến | `1 passed` |

- [ ] **Bước 7: Đột biến visual và đối chứng âm**

| # | Đột biến | Kết quả visual |
|---|---|---|
| M8 | `styles/layout.css`: xóa khối `.hdr-nav .hdr-link { text-transform: uppercase; }` | `3 failed`, `5 passed`: desktop `@visual home`, `@visual taya-house`, `@visual no-JS taya-house` (trên điện thoại nav nằm trong menu; ở `no-JS home` mặt nạ của hero phủ cả header) |
| đối chứng âm | không sửa code; dòng đầu của lệnh visual (Bước 1) sửa DB giữa reset và build: `(cd "${TMPDIR:-/tmp}/fc-mut" && RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs && psql postgres://localhost:5432/furama_cuisine_e2e_test -v ON_ERROR_STOP=1 -c "UPDATE experience_i18n SET title = 'Culinary Experience' WHERE experience_id = 1 AND locale = 'en'" && CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build)`, các dòng sau như cũ | `4 failed`, `4 passed`: `@visual home` và `@visual no-JS home`, desktop và phone; trang Tàya không đổi. Pixel của trang chủ đến từ DB. |

Xong thì `rm -rf "${TMPDIR:-/tmp}/fc-mut"`; Bước 8 reset lại DB E2E.

- [ ] **Bước 8: Cổng kiểm tra, E2E ba lần và một lần với `TZ=UTC`, diff DOM so với bản trước đợt 6**

Chạy đủ khối "Cổng kiểm tra của mọi task" (lần E2E thứ nhất), rồi trên cùng build hai lần E2E nữa và một lần với `TZ=UTC` đứng đầu tiền tố (server của Playwright thừa kế nó), mỗi lần reset DB E2E trước. Diff DOM so với build của `4f67931` (code y như `8fe98f5`), HTML chép ngay sau build.

Expected:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo; `Test Files  80 passed (80)`, `Tests  1022 passed (1022)`;
- `Applied 8 migration(s).`; build thoát 0; check-prerender như Task 8;
- E2E `162 passed`, `1 skipped` ở cả ba lần và ở lần `TZ=UTC`; visual `8 passed`;
- diff DOM: chỉ R18, 14 dòng mỗi trang.

- [ ] **Bước 9: Commit**

```bash
git add e2e/restaurant-pages.serial.spec.ts
git commit -m "$(cat <<'EOF'
test: prove the acceptance spec's 404s in a browser, and switch the page off without taking its content away

The mutation runs of phase 6 found one survivor: with the detail loaders
ignoring has_detail_page, restaurant-pages.serial.spec.ts still passed. Two
reasons. Its "no page" checks read the response's text for "Page not
found", which every page carries (the not-found boundary is in each RSC
payload); and switching the page off also removed the portrait, so the
loader had nothing to draw anyway.

The 404 is now checked in the browser (the heading, the tab title, no
restaurant hero), and switching off is the switch alone, through the same
admin save; the portrait, copy and highlights go after the test. The
mutation now fails at the second 404, and every other mutation of the
phase's list stays red.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: README, runbook migration 008, cổng cuối và bàn giao cho controller

README nhận runbook của migration 008 (dàn ý §8): 008 đi trước lần deploy đợt 6, kiểm trước chỉ đọc (`db/checks/preflight-008.sql`, gồm kiểm nhãn ẩm thực và điểm đến), chạy bằng `migrate.mjs`, kiểm sau, cron thứ hai, các kiểm ở preview đầu tiên, rollback và việc của chủ dự án; cùng route, cache plan, bảng nội dung mới, dữ liệu của các spec serial mới và spec nghiệm thu. Runbook được chạy thử trên một DB cục bộ dựng tới 007 trước khi viết. Việc chạy 008 lên Neon là của controller. Cuối task: cổng cuối hai lần, một lần E2E với `TZ=UTC`, và phần bàn giao (câu sửa spec §6.2 và §12 theo R7, R8; ghi chú cho sổ đợt 6).

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: `db/checks/preflight-008.sql`, `db/checks/postcheck-008.sql` (Task 1); `scripts/reset-db.mjs --until`, `scripts/migrate.mjs`; mọi route, spec và bảng của Task 1–12.
- Produces: không API mới. Câu sửa spec và ghi chú sổ cho controller (Bước 6).

- [ ] **Bước 1: Chạy thử runbook trên một DB cục bộ dựng tới 007**

Không bao giờ trên Neon. Như Task 1 Bước 12, trên DB của test `furama_cuisine_migrate008_test` (lần chạy test sau dựng lại nó) dựng tới 007, đúng các lệnh README sẽ ghi, chỉ thay URL của branch bằng URL cục bộ:

```bash
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_migrate008_test node scripts/reset-db.mjs --until 007_email_and_consent.sql
psql postgres://localhost:5432/furama_cuisine_migrate008_test -v ON_ERROR_STOP=1 -f db/checks/preflight-008.sql
DATABASE_URL_UNPOOLED=postgres://localhost:5432/furama_cuisine_migrate008_test node scripts/migrate.mjs
psql postgres://localhost:5432/furama_cuisine_migrate008_test -v ON_ERROR_STOP=1 -f db/checks/postcheck-008.sql
```

Expected: `Applied 7 migration(s).`; pre-flight 10 hàng, cột `ok` đều `t`:

```
 migrations 001-007 applied, 008 not                                  | t  | 001_init.sql, 002_seed_restaurants.sql, …, 007_email_and_consent.sql
 no table 008 creates exists yet                                      | t  |
 no booking carries an offer_id                                       | t  | 0
 every restaurants.cuisines label is one of the 8 cuisines            | t  | Café & Lounge, Hotpot, International, Italian, Japanese, Steak & Grill, Thai, Vietnamese
 the 12 restaurants of 002, each with a card picture in public/assets | t  | cafe-indochine, chaoshan-hotpot, danaksara, don-ciprianis, hai-van-lounge, hura-izakaya, pho-cuon, taya-house, thai-siam-kitchen, the-fan, v-senses-cafe, yum-food-village
 every restaurant has a type and a known destination                  | t  |
 the four destinations of 004, without a card picture yet             | t  | dining-house:-, future:-, mm:-, resort:-
 site_settings has its one row (007)                                  | t  | fb@furamavietnam.com
 the en locale exists (every seeded translation is en)                | t  |
 gen_random_uuid() is available (media.id)                            | t  |
(10 rows)
```

`migrate.mjs` in bảy dòng `· … (already applied)`, rồi `✓ 008_content.sql` và `Applied 1 migration(s).`; post-check 10 hàng đều `t` (`row counts`, `restaurants: slug = id, destination_id = destination, card picture r-<id>.jpg`, `restaurants: type_label (en) = type, and the card alt = name`, `restaurants: restaurant_cuisines = cuisines, label for label, in order`, `only Tàya House has a page, with its portrait, story and 4 highlights`, `every destination has its card picture dest-<id>.jpg and an en row`, `reservations.offer_id has its FK, and no booking points at an offer`, `site_settings: email kept, Tàya House and Dinner preselected, 7 s slides`, `every seeded translation is en, reviewed, seed`, `identity sequences are past the seeded ids`).

- [ ] **Bước 2: Viết README**

Testing: các spec serial mới trong bản đồ dữ liệu (và `workers: 1`, trả dữ liệu qua cùng kiểu lần lưu), spec nghiệm thu đợt 6 cạnh hai spec nghiệm thu đợt 4, 5. Deploying: "Migration 008 (phase 6: content)" ngay sau 007, rồi việc của chủ dự án cho đợt 6. Routes: `/en` revalidate mỗi giờ, trang chi tiết cho mọi nhà hàng `has_detail_page`, `/api/cron/daily`; đoạn cache trỏ tới `lib/cache-plan.ts`. Database, Assets, Scripts: các bảng nội dung, `lib/data.ts` chỉ còn code, bản đông cứng, `measure-assets.mjs`. Không nhắc mã phán quyết (README là cho người vận hành).

Sửa `README.md`:

````diff
diff --git a/README.md b/README.md
index 959ebb5..f5c1c06 100644
--- a/README.md
+++ b/README.md
@@ -85,10 +85,13 @@ kill %1   # stop the server (or: lsof -ti tcp:3201 | xargs kill)
 
 Playwright runs two projects. `desktop` holds every spec file, in parallel
 workers; `desktop-serial` holds the `*.serial.spec.ts` files and runs after
-`desktop` has finished (`dependencies`), because they change what every guest
-page reads (a restaurant's online-booking switch). Running one serial file
-also runs the whole `desktop` project first; add `--project=desktop-serial
---no-deps` to run it alone. Spec files run at the same time, so each one books
+`desktop` has finished (`dependencies`), one file at a time (`workers: 1`),
+because they change what every guest page reads (a restaurant's
+online-booking switch, the shared inbox, a restaurant's page, an offer's
+dates). Each puts the data back through the same kind of save (or the daily
+cron), which expires the same cache tags, never with a bare SQL update.
+Running one serial file also runs the whole `desktop` project first; add
+`--project=desktop-serial --no-deps` to run it alone. Spec files run at the same time, so each one books
 its own restaurant and dates, and puts back the rules it changes:
 
 | Spec | Restaurant | Dates or rules |
@@ -100,7 +103,10 @@ its own restaurant and dates, and puts back the rules it changes:
 | `admin-booking-settings` | Danaksara | `auto_confirm`; the last open day |
 | `admin-closures` | Phố Cuốn; the MM Supercenter (Yum Food Village, ChaoShan Hotpot) | +5; a destination closure at +11; closure edits at +60 and +61; Phố Cuốn +62 (the bulk cancel that emails guests: three bookings, two with an email, and a closure it deletes afterwards); Phố Cuốn +63 (two bookings with an email under a closure it deletes afterwards; one is moved to yesterday while the list is open) |
 | `booking-acceptance` | Yum Food Village | +3, +4, +12, +13, yesterday; dinner hours, covers and `max_party` |
-| `booking-switch.serial` | Tàya House, Hải Vân Lounge | online booking off, then on again |
+| `booking-switch.serial` | Tàya House, Hải Vân Lounge, Yum Food Village; then all twelve | online booking off, then on again |
+| `shared-inbox.serial` | — | the shared inbox (`site_settings.email`), then `fb@furamavietnam.com` again |
+| `restaurant-pages.serial` | Steakhouse The Fan | its page on (portrait, copy, two highlights), then off; its booking rules saved unchanged |
+| `offers-expiry.serial` | Hải Vân Lounge | offer 3's `valid_until` set to yesterday, then NULL again, each time with the daily cron |
 | `booking-email` | Café Indochine, Tàya House | the last open day (a guest booking: its staff email goes to the shared inbox); +3 (`seedReservation()`: a booking to confirm, and a confirmed one with an email row due for its second attempt) |
 | `admin-emails` | Hải Vân Lounge, Hura Izakaya | +40 (failed emails written straight into `email_outbox`); yesterday (a failed email whose sitting has passed); a restaurant recipient under a fresh address, deleted afterwards |
 | `guest-guard` | Phố Cuốn | today + 13 (three web requests seeded for a fresh number); the other tests book nothing, and the header-contrast tests write nothing |
@@ -123,6 +129,12 @@ staff (A1), confirming emails the guest (A2), a failed email is retried by
 the cron (A3), and with no recipient the staff email goes to the shared inbox
 (A4); bots are blocked (A5) in `guest-guard.spec.ts`, the integration tests
 and the BotID run below.
+`restaurant-pages.serial.spec.ts` checks phase 6's (§14.1 row 6): switching
+`has_detail_page` on for Steakhouse The Fan opens a working page, read from
+the database, after one admin save, and switching it off closes it again.
+The other half, "the site is identical", is the visual baselines: they have
+not changed since before phase 2, and every page they shoot now reads the
+database (a changed row turns them red).
 
 `e2e/botid.spec.ts` walks BotID's blocked path. Off Vercel nobody can judge a
 request, so it is skipped unless the server runs with `BOTID_DEV_BYPASS=BAD-BOT`
@@ -360,6 +372,83 @@ SELECT conname FROM pg_constraint WHERE conname = 'reservations_consent_check';
 Until recipients are added, every new booking's staff email goes to the
 shared inbox, and the overview lists the restaurants that do so.
 
+### Migration 008 (phase 6: content)
+
+`008_content.sql` moves the guest site's content into the database: `media`
+(one row per file in `public/assets`, served from there), the translation
+tables, `cuisines`, `restaurant_cuisines`, `restaurant_highlights`,
+`sections`, `hero_slides`, `experiences`, `stories`, `offers`, `nav_items`,
+`social_links`, the restaurants' content columns (`slug`, `destination_id`,
+pictures, phone, map, `has_detail_page`, `is_published`, `archived_at`), the
+rest of `site_settings`, and the foreign key of `reservations.offer_id`. It
+seeds exactly what the site showed at the end of phase 5. It only adds (the
+phase-1 columns `type`, `destination`, `cuisines`, `meals` and
+`slot_capacity` stay, unread, until phase 10 drops them), in one transaction
+that `migrate.mjs` sends as one query (about 80 ms on a local database).
+
+**008 goes first, then the phase-6 deploy.** The phase-5 code was built and
+tested on a 008 database (its E2E run and the visual baselines pass
+unchanged), and the phase-6 code needs 008 to build: `next build` prerenders
+the guest pages from its tables, so a build on a branch without it fails
+(safely: the previous deployment stays live). Until it commits, 008 holds an
+ACCESS EXCLUSIVE lock on `restaurants` and `site_settings` and a SHARE ROW
+EXCLUSIVE lock on `reservations`, so new bookings wait for it: apply it in
+the deploy window.
+
+1. **Pre-flight**, read-only, on the target branch's own direct URL (not
+   `npm run db:psql`, which reads `.env.local`):
+
+   ```bash
+   psql "<the branch's direct URL>" -v ON_ERROR_STOP=1 -f db/checks/preflight-008.sql
+   ```
+
+   Every row must say `ok` = `t`: 001–007 applied and 008 not; none of the
+   20 tables 008 creates exists yet; no booking has an `offer_id` (008
+   stops on one); every label in `restaurants.cuisines` is one of the 8
+   cuisines (008 stops on another and names it; the row's `detail` lists
+   the labels found); the 12 restaurants of 002, each with its
+   `public/assets/r-<id>.jpg`; every restaurant has a type and a destination
+   that exists; the 4 destinations of 004, none with a card picture yet; one
+   `site_settings` row; `en` the default language; `gen_random_uuid()`
+   available. Any `f`: stop and fix the data first (008 would roll back).
+2. **Apply**, the dev branch first, then production, in the deploy window:
+   `DATABASE_URL_UNPOOLED=<the branch's direct URL> node scripts/migrate.mjs`
+   (it prints `✓ 008_content.sql`).
+3. **Post-check**, read-only:
+   `psql "<the branch's direct URL>" -v ON_ERROR_STOP=1 -f db/checks/postcheck-008.sql`.
+   Every row `t`: the row counts; each restaurant's slug, destination, type
+   label, cuisines and card picture equal to its phase-1 columns; only Tàya
+   House has a page, with its portrait, story and 4 highlights; every
+   destination's picture; the offer FK, and no booking linked to an offer
+   yet; the settings (Tàya House, Dinner, 7 s slides); every seeded
+   translation `en`, `reviewed`, `seed`; the sequences past the seeded ids.
+4. **Deploy phase 6.** A preview branch forked before 008 reached production
+   must be migrated (steps 1–3 on its URL) before its preview builds.
+5. **Vercel:** after the production deploy, Settings → Cron Jobs lists
+   `/api/cron/daily` at `5 17 * * *` (00:05 in Da Nang) beside the outbox
+   cron. It uses the `CRON_SECRET` set for launch A and reads no database.
+6. **First preview:** switch a restaurant's online booking off in "Giờ và
+   sức chứa", then open the home page several times: every response drops
+   its RESERVE (each instance caches the pages; `updateTag` must reach them
+   all); switch it back on and check the same way. Do the same with "Hộp thư
+   chung" and the footer's address. Open `/en/restaurants/<a made-up word>`:
+   the site's "Page not found", with `noindex`. If the preview's Neon branch
+   can be suspended, see what a guest gets right after a save while the
+   database is unreachable (measured locally: a plain 500 on the home page
+   and a restaurant page that never finishes loading), then resume it.
+7. **Rollback:** leave 008 in place (the phase-5 code runs on it) and roll
+   back the deployment only.
+
+What the owner gives for phase 6: the Dining House number and whether it
+prints with +84 (it dials `+84859555759` and still prints "0859 555 759",
+spec §15 item 14); the TikTok handle (`@furama.dining.hous` today); whether
+the three offers end on 31 December 2026 (they are seeded without dates, so
+they show until someone sets one; the phase-7 editor does it); for each
+further restaurant that should get a page, a 4:5 portrait, a kicker, an
+English story, 2–5 highlights with photos and an optional menu PDF (spec §15
+item 17); the Experiences links and a film URL (§15 item 16). Until a page's
+content exists, its `has_detail_page` stays off.
+
 ### Environment variables (admin)
 
 | Variable | Production | Preview | Local E2E / CI |
@@ -671,12 +760,13 @@ bootstrapping production is what you mean to do.
 | Route | Rendering | Notes |
 | --- | --- | --- |
 | `/` and other unprefixed paths | Proxy (`proxy.ts`) | 307 to `/<locale>…` by the `NEXT_LOCALE` cookie, then `Accept-Language`, then `en` (only `en` is enabled in phase 2); the query is kept |
-| `/en` | Static, `cacheLife('max')` | Home: hero, finder, cuisines, restaurants, destinations, experiences, heritage, stories, offers |
-| `/en/restaurants/[slug]` | Static for `taya-house`. Any other slug is a 404: the first visit is a soft 404 (status 200 with `noindex`), later visits get the cached 404, and without JavaScript the body is empty | Restaurant detail (Tàya House only until phase 6) |
+| `/en` | Static, revalidated hourly (`cacheLife('hours')`, for today's offers) | Home: hero, finder, cuisines, restaurants, destinations, experiences, heritage, stories, offers, read from the database; a section switched off or with nothing to show is left out |
+| `/en/restaurants/[slug]` | Static for each restaurant with `has_detail_page` at build time (`_none` when there is none); a page switched on later renders on its first visit. Any other slug is a 404: the first visit is a soft 404 (status 200 with `noindex`), later visits get the cached 404, and without JavaScript the body is empty | Restaurant detail, read from the database (`taya-house` today). The cached 404 carries `restaurants`, so a save that expires the catalogue opens a page that was just switched on |
 | `/taya-house` | Redirect | 308 to `/en/restaurants/taya-house` (`next.config.ts`) |
 | `/en/privacy` | Static, `cacheLife('max')`, tag `content:legal` | The privacy policy (`legal.*`), linked from the footer and the reserve drawer's consent box |
 | `/api/availability` | Dynamic, `no-store` | `?restaurant=&lang=[&from=&to=]`: each day's state (open, full, past, closed, too_large, outside) and public closure reason, with the clock, the party limit and the number to call; `?restaurant=&date=&lang=[&guests=]`: one day's services and slots with the covers left. 404 for an unknown restaurant or one with online booking off; a range given in full that is backwards or too long (400) and an id that cannot exist (404) are answered before any query. `scripts/check-prerender.mjs` fails if it is ever prerendered, or missing from the build |
 | `/api/cron/outbox` | Dynamic, `no-store`, `maxDuration` 300 | Vercel Cron, every 5 minutes: sends the due outbox rows of its environment (at most 500 or 240 s) and answers only the counts. 401 without `Authorization: Bearer $CRON_SECRET` |
+| `/api/cron/daily` | Dynamic, `no-store`, `maxDuration` 60 | Vercel Cron, daily at 17:05 UTC (00:05 in Da Nang): `revalidateTag('content:offers', 'max')`, so the home page drops an offer past its `valid_until` and shows one whose `valid_from` has come. The first visit after it may still get yesterday's offers once; in exchange, a database that is down then cannot break the home page. 401 without `Authorization: Bearer $CRON_SECRET` |
 | `/admin/sign-in`, `/admin/accept-invite`, `/admin/reset-password` | Request time, nonce CSP | The only admin pages open without a session cookie |
 | `/admin`, `/admin/users`, `/admin/audit` | Request time, nonce CSP | Overview (with pending and today's bookings); staff and invitations (Admin); audit log of `audit_log` and booking events, paged with `?truoc=`/`?sau=` (Admin). Without a session cookie the proxy sends them to sign-in (307, `?next=` kept) |
 | `/admin/reservations`, `/admin/reservations/[id]`, `/admin/reservations/day` | Request time, nonce CSP | Inbox (Cần xử lý · Hôm nay · Sắp tới · Tất cả, search by reference, phone, name or email: the search posts, its text waits 30 minutes in an httpOnly cookie and the URL carries only `?tim=<id>`); a booking (status changes, edit, internal notes, timeline, its emails); the printable day sheet. `reservations:read` |
@@ -709,11 +799,20 @@ disabled language gets the site's 404 and a database error gets
 `[lang]/error.tsx`, but only for request-time renders with JavaScript on.
 An expired static route that fails to re-render, or a disabled-locale 404, gets
 a plain 500 or an empty shell instead. Guest pages are cached with
-`cacheLife('max')` (30 days) rather than hourly ISR, so a catalogue edit made
-directly on Neon needs a redeploy (or a tag purge) to appear; the uncached
-booking action reads the database directly. Pages carry the cache tags `restaurants`, `i18n:<code>`,
-`locales` and `content:ui`; `lib/cache-tags.ts` names every tag of the CMS
-(spec §6.2), so later phases never spell a tag by hand. Each page wraps its
+`cacheLife('max')` (30 days; the home page `'hours'`, for today's offers),
+so content edited directly on Neon needs a redeploy (or a tag purge) to
+appear; the uncached booking action reads the database directly.
+`lib/cache-tags.ts` names every tag of the CMS (spec §6.2), so no code spells
+a tag by hand, and `lib/cache-plan.ts` says which tables each cached loader
+reads and which tags it carries (`LOADERS`), and what a save to each table
+expires (`SAVE_TAGS`, `tagsForSave`); `lib/cache-plan.test.ts` holds the two
+together, and `scripts/check-prerender.mjs` checks each prerendered guest
+page carries its loaders' tags. Every guest page checks the language again
+before it reads (`requireEnabledLocale`): layouts and pages render in
+parallel, and a path with a dot such as `/favicon.ico` reaches `[lang]`, so
+without it a crawler's request would query the database as a language of its
+own, and an error in the page would win over the layout's 404
+(`test/guards/guest-pages.guard.test.ts` enforces it). Each page wraps its
 content in `<ViewMarker>`: with Cache Components the router keeps the page
 you left mounted but hidden, so page DOM is only queried inside the visible
 page's `<main>` (`lib/page-scope.guard.test.ts` enforces it).
@@ -726,6 +825,23 @@ is seeded by `db/migrations/002_seed_restaurants.sql` (and its content by
 then handed to the client through `SiteProvider`. Editing the catalogue means
 editing a migration until the phase-7 editors.
 
+The rest of the guest site's content is in the database too since phase 6
+(migration 008): `media` (every file in `public/assets`, served from there;
+alt text per language in `media_i18n`, empty for a decorative file),
+`sections` (the home page's fixed blocks: on or off, a picture, a link),
+`cuisines`, `destinations` and `restaurants` with their `*_i18n` rows,
+`restaurant_cuisines`, `restaurant_highlights`, `hero_slides`, `experiences`,
+`stories`, `offers`, `nav_items`, `social_links` and `site_settings`. A
+`*_i18n` row shows in its language when `reviewed` (or `machine`, where the
+language serves machine translations), and a field it lacks falls back to
+the default language's (`lib/server/content/sql.ts`). Phase 6 has no editor:
+until phase 7, content changes are migrations. `lib/data.ts` holds code
+only (the meal enum, phase 1's slots, the number the error pages print
+without the database); `test/fixtures/phase5-content.ts` keeps what its
+constants held, and `test/integration/content-seed.test.ts` checks the seed
+against it. `db/checks/preflight-008.sql` and `postcheck-008.sql` are the
+read-only checks of the 008 runbook (Deploying).
+
 `locales`, `content_strings` and `destinations` (migration 004) are the
 shared foundations of the CMS. Which UI strings exist is decided by
 `lib/i18n/registry.ts`; `content_strings` only overrides or translates them,
@@ -800,7 +916,9 @@ turns the whole system off.
 
 `public/assets/` holds the design's 39 photographs. `scripts/extract-assets.py`
 re-derives them from the DesignSync reads in a session transcript and is
-idempotent.
+idempotent. Each has a `media` row (migration 008) with its type, pixel size
+and byte count, which `node scripts/measure-assets.mjs` prints as the
+migration's `VALUES` block; `content-seed.test.ts` re-measures every file.
 
 Five source photos exceed the DesignSync 192 KiB per-file transfer cap and are
 substituted with the design's own smaller rendition of the same shot (listed in
@@ -826,3 +944,4 @@ reference so future design revisions can be diffed against what was built.
 | `npm run test:visual` | Screenshot comparison (local) |
 | `npm run db:migrate` | Apply pending SQL migrations   |
 | `npm run db:psql`    | psql shell against Neon        |
+| `node scripts/measure-assets.mjs` | The `media` rows of `public/assets` (migration 008's `VALUES`) |
````

- [ ] **Bước 3: Chạy cổng kiểm tra (lần 1 của cổng cuối)**

Expected:
- typecheck không lỗi; lint thoát 0, 19 cảnh báo;
- `Test Files  80 passed (80)`, `Tests  1022 passed (1022)`;
- `Applied 8 migration(s).`; build thoát 0; check-prerender như Task 8;
- E2E `162 passed`, `1 skipped`; visual `8 passed`;
- diff DOM so với build của `4f67931`: chỉ R18, 14 dòng mỗi trang.

- [ ] **Bước 4: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: write the migration 008 runbook, the daily cron and phase 6's content tables into the README

Deploying gains "Migration 008 (phase 6: content)": 008 goes before the
phase-6 deploy (the phase-5 code runs on it, the phase-6 build needs it);
the read-only pre-flight (db/checks/preflight-008.sql: 001–007 only, no
offer_id yet, only the 8 cuisine labels, the 12 restaurants with their
pictures, known destinations) and post-check, run on a local 007 database;
the lock it holds; the second cron; the first-preview checks (a save
reaching every instance, the 404 of a made-up restaurant, a database
outage right after a save); the rollback; and what the owner still gives.

Routes describe /en revalidating hourly, the detail page for every
restaurant with has_detail_page and /api/cron/daily; the cache paragraph
points at lib/cache-plan.ts. Testing lists the new serial specs and the
phase-6 acceptance; Database, Assets and Scripts name the content tables,
lib/data.ts as code only, the frozen fixture and measure-assets.mjs.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Bước 5: Cổng cuối lần 2, một lần E2E với `TZ=UTC`, và các kiểm thêm**

Trên commit của Bước 4, chạy đủ khối "Cổng kiểm tra của mọi task" lần nữa (reset DB E2E và build lại), rồi reset DB E2E và chạy E2E thêm một lần với `TZ=UTC` đứng đầu tiền tố. Rồi:

```bash
git diff --stat 4f67931 -- e2e/__visual__
grep -rn "revalidateTag(" app lib --include='*.ts' --include='*.tsx' | grep -v '\.test\.ts'
git diff --shortstat 4f67931 HEAD
git worktree remove --force "${TMPDIR:-/tmp}/fc-base" && rm -rf "${TMPDIR:-/tmp}/fc-dom" && git worktree list
```

Expected:
- lần 2: như Bước 3; lần `TZ=UTC`: `162 passed`, `1 skipped`;
- `git diff --stat … e2e/__visual__` không in gì (không baseline nào đổi trong cả đợt);
- `revalidateTag(` chỉ ở `app/api/cron/daily/route.ts:34: revalidateTag(TAGS.contentOffers, 'max');` (và comment của `lib/cache-tags.ts`): mọi lần lưu của admin dùng `updateTag`;
- `110 files changed, 5745 insertions(+), 872 deletions(-)` (13 commit của đợt 6);
- `git worktree list` chỉ còn repo: worktree bản gốc của diff DOM đã gỡ (Global Constraints).

Dừng mọi server (`lsof -ti tcp:3210 | xargs kill`, cổng 3211 cũng vậy) khi xong.

- [ ] **Bước 6: Bàn giao cho controller**

Không commit gì ở bước này. Controller commit file kế hoạch và thư mục `docs/superpowers/research/2026-10-03-phase-6-spikes/`, chạy 008 lên Neon theo runbook của README (dev trước, production sau, trước lần deploy đợt 6), và:

**Sửa spec `docs/superpowers/specs/2026-10-01-admin-cms-design.md` (R7, R8):**

§6.2, mục "Nội dung phụ thuộc ngày", thay dòng

```
  - Cron `/api/cron/daily` chạy lúc 17:05 UTC (00:05 giờ VN) và gọi `revalidateTag('content:offers', { expire: 0 })`. Nhờ vậy ưu đãi tự ẩn khi qua `valid_until` và tự hiện khi tới `valid_from` trong vài phút sau nửa đêm.
```

bằng

```
  - Cron `/api/cron/daily` chạy lúc 17:05 UTC (00:05 giờ VN) và gọi `revalidateTag('content:offers', 'max')`. Nhờ vậy ưu đãi tự ẩn khi qua `valid_until` và tự hiện khi tới `valid_from` ngay sau nửa đêm.
```

§6.2, mục "Làm mới cache", thay dòng

```
  - Riêng ưu đãi hết hạn dùng `{ expire: 0 }`.
```

bằng

```
  - Riêng cron ưu đãi hằng ngày dùng `'max'`: khách đầu tiên sau 00:05 có thể thấy bản cũ một lần, nhưng DB lỗi lúc đó không làm sập trang chủ.
```

§12, hàng "DB lỗi khi khách xem trang", thêm vào cuối ô "Hành vi":

```
 Ghi chú (đợt 6, đo trên Next 16.3.7): `error.tsx` chỉ hiện ở route render có stream. Một trang tĩnh vừa bị `updateTag` làm hết hạn mà render lại lúc DB lỗi trả 500 dạng chữ thường (`/en`, `/en/privacy`), còn trang chi tiết stream `error.tsx` nhưng không kết thúc response. Cửa sổ này cần DB hỏng giữa một lần lưu và lần ghé đầu tiên vào trang đó, và tự lành khi DB về. Đợt 10 làm ấm các trang bị ảnh hưởng trong `after()` sau commit và đặt `maxDuration` cho trang chi tiết; preview đầu tiên kiểm hành vi này trên Vercel.
```

**Ghi chú cho sổ đợt 6** (`docs/superpowers/ledgers/2026-10-03-phase-6-ledger.md`, theo mẫu sổ đợt 5):
- **Phán quyết:** R1–R22 của kế hoạch được chấp nhận (chủ dự án bảo làm theo đề xuất, kể cả nửa thẻ "Call {display} →" của R20); R7 và R8 sửa spec như trên. **Cần controller duyệt:** R20 như đã làm khác câu chữ dàn ý ở một chỗ: thẻ in "Call {display} →", kết quả tìm kiếm in "Call →" (dàn ý ghi "Call {display} →" cho cả hai). Lý do đo được: với số trong hàng tìm kiếm, ở 390 px tên nhà hàng gãy ba dòng, ở 320 px nhãn đè lên tên. Nếu controller (hay chủ dự án) muốn đúng câu chữ: đổi `SearchOverlay` sang `booking.call_tag` với `{ phone: r.phone.display }`, bỏ `booking.call_action` và test của nó, sửa kiểm `Call →` của `booking-switch.serial`, và cho `.search-result-action` xuống dòng trên màn hẹp.
- **Sửa của vòng review kế hoạch** (gộp vào task sở hữu file): mọi trang khách `await requireEnabledLocale(…)` trước khi đọc, có guard (Task 6; trước đó `/favicon.ico`, `/wp-login.php`, `/apple-touch-icon.png`, `/.env` trả 500 từ Task 6, và `/favicon.ico/privacy` từ đợt 5); `formatStoryDate`/`formatPrice` đọc mã Intl từ chối như `'en'` (Task 3); `homeSections` cho cờ `sections.is_visible` một unit test (Task 6); guard cột đợt 1 bắt cột trần khi `restaurants` là bảng duy nhất (Task 3); log email xóa trước mỗi lần E2E, lệnh của Task 12 tự đủ, worktree bản gốc ngoài repo và được gỡ (kế hoạch).
- **Đóng ở đợt 6:** rủi ro 9 của đợt 2 (`cuisineSlug`: ẩm thực có khóa ngoại, 008 dừng ở nhãn lạ; Task 1, 3); metadata của rủi ro 7 đợt 2 (Task 7, R14); điểm nhỏ `is_enabled` của Task 4/10 đợt 2 (chủ ý, R16); thứ tự hòa và số nhóm NULL của đợt 4 (Task 2); rủi ro 8 của đợt 4, cả drawer lẫn thẻ và tìm kiếm (Task 11); dư lượng RSC 404 của đợt 4 đã điều tra (R15); T6.2, T6.8, việc chuyển giao `content:contact` và `{email}` của trang chính sách của đợt 5 (Task 3, 4, R22); số gọi của Dining House (R18).
- **Mang sang đợt 7:** key registry cho mọi chữ section và chữ giao diện (bản đồ §2 của báo cáo schema, gồm nhãn thẻ "View restaurant"/"Reserve a table" và "View"/"Reserve" của tìm kiếm), `ADMIN_SCREENS` thêm cuisines, destinations, experiences, heritage, stories, offers, restaurants, `MEAL_LABELS` → `meal.*`, guard CI "không chữ khách nào ngoài registry hay DB"; trình soạn gọi `updateTag` cho `tagsForSave(bảng, restaurantId)`; khôi phục chèn với `OVERRIDING SYSTEM VALUE`; xóa/khôi phục ưu đãi theo R5 (đặt bàn không được nối lại); các ràng buộc SQL không giữ được (hàng EN bắt buộc; `has_detail_page` cần `detail_image_id` và câu chuyện EN, cảnh báo dưới 2 highlight hay nút bị ẩn; không alt cho PDF hay file trang trí; media menu là PDF; `image_mobile_id` chỉ ở slide 1; giới hạn §6.5; nhãn nav quá 14 cảnh báo); alt của thẻ theo tên khi đổi tên (R19); `blur_data_url` khi tải lên; `CmsImage` cho các `<img>` thường cùng việc chuyển lên Blob và chụp lại baseline (R3); hiện ưu đãi ở màn đặt bàn của admin và trong email `staff.new`, và quyết định có giữ ghi chú "Offer: …" điền sẵn không (R9); ngày kết thúc ưu đãi và lời dẫn của Offers (R4); link Experiences và URL film.
- **Mang sang đợt 8:** M7 (tiêu đề soft-404) và M4 (vỏ no-JS) (R14); `generateMetadata` của trang chính sách đọc `legal.*` trước khi kiểm ngôn ngữ (rủi ro 20 của kế hoạch); rủi ro 5–7 của đợt 2; `social_links.visible_locales` khi đổi mã ngôn ngữ; gấp chữ tìm kiếm cho ko/zh; công thức ngày và giá theo từng ngôn ngữ; nhãn nav tràn ở ngôn ngữ dài; Draft Mode render ngôn ngữ đang tắt (R16); các kiểm `toContain('Page not found')` trên chữ response của `e2e/routing.spec.ts` yếu như kiểm mà Task 12 sửa (payload RSC của mọi trang mang boundary not-found; các test đó còn kiểm status hay `noindex` nên vẫn đúng), nên việc 404 đa ngôn ngữ kiểm heading trong trình duyệt.
- **Mang sang đợt 10:** bỏ `restaurants.type/destination/cuisines/meals/slot_capacity` và `SLOTS` (cùng `booking-seed.test.ts`); gia cố của R8 (làm ấm trong `after()`, `maxDuration` cho trang chi tiết, cache handler nếu các instance không phối hợp); giới hạn tần suất WAF cho `/:lang/restaurants/:slug` (R13); thử lại cuộc đua RSC 404 trên Next ≥16.4 (R15); việc ẩn danh của spec §11 dùng chung route `/api/cron/daily`: khi đó nâng `maxDuration` (60 s hôm nay) và giữ lời gọi `revalidateTag('content:offers', 'max')` trước phần ẩn danh.
- **Rủi ro "Cần quyết định"** của danh sách rủi ro (1, 9, 13) là câu hỏi cho chủ dự án và cho preview đầu tiên; việc của chủ dự án nằm cuối mục "Migration 008" của README.

---

## Bản kiểm chứng

Mọi lần chạy ở `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p6-verify` (bản sao APFS của repo, gốc `4f67931`, đã xóa `.next` và `.env.local`, chưa bao giờ đọc `.env.local`), hai vòng:

1. **Lần chạy đầu**, nhánh `main` ở đó: Task 1–13 đúng thứ tự, mỗi task một commit (`6116e26` … `4e72d39`), RED thật trước code, cổng kiểm tra của task xanh trước khi commit.
2. **Vòng review kế hoạch.** Các sửa thành một commit thêm trên `main` (`c0cdc7f`), qua cổng đủ: typecheck không lỗi; lint thoát 0, 19 cảnh báo; `Test Files  80 passed (80)`, `Tests  1022 passed (1022)`; `Applied 8 migration(s).`; build thoát 0; check-prerender đạt; diff DOM chỉ R18 (14 dòng mỗi trang); E2E `162 passed`, `1 skipped`; visual `8 passed`; trên server của visual, `/favicon.ico`, `/apple-touch-icon.png`, `/apple-touch-icon-precomposed.png`, `/wp-login.php`, `/.env`, `/config.json`, `/favicon.ico/privacy` và `/wp-login.php/restaurants/taya-house` đều `404`, không dòng `RangeError` nào trong log. Trên build của `4e72d39` (trước sửa), cùng các đường dẫn: bảy cái đầu trả `500`, 33 dòng `RangeError: Incorrect locale information provided` trong log. Rồi nhánh `p6-folded` dựng từ `4f67931`: Task 1 và 2 là đúng hai commit của lần chạy đầu (không sửa nào thuộc chúng); Task 3–13 là cây của commit gốc, mỗi file của sửa lấy theo task sở hữu nó (Task 3: `lib/content/format.ts`, `format.test.ts`, guard cột đợt 1; Task 6: `lib/server/content/locales.ts`, `lib/content/home-sections.ts` (+ test), guard trang khách, trang chủ, trang chính sách, `Hero`, `Chrome`, `FilmModal`, `e2e/routing.spec.ts`; Task 7: trang chi tiết; Task 8: trang chủ có ưu đãi; Task 13: README), cùng commit message và tác giả. `git diff --stat c0cdc7f p6-folded` rỗng: cây của commit cuối giống hệt cây đã qua cổng.

Mọi khối code, diff, lệnh `git add` và commit message của kế hoạch được sinh từ các commit của `p6-folded` (`git show <sha>:<file>`, `git show -M <sha> -- <file>`, `git log -1 --format=%B <sha>`), nên gõ lại từ kế hoạch hay cherry-pick từng commit cho cùng một cây.

| Task | SHA (`p6-folded`) | Unit + tích hợp | Lệnh test riêng của task | E2E | Visual | Lint (cảnh báo) | RED đã thấy |
|---|---|---|---|---|---|---|---|
| mốc | `4f67931` | 68 file, 906 test | — | 151 + 1 skipped | 8/8 | 19 | — |
| 1 | `6116e26` | 71 file, 943 test | 3 file, 37 test | 151 + 1 skipped (lần chạy đầu) | 8/8 (lần chạy đầu) | 19 | commit của lần chạy đầu, không đổi: `image-size.test.ts` không import được; `migration-008` + `content-seed`: 31 đỏ, 2 xanh (33); C3 (bỏ chặn bảng rỗng của offers): 1 đỏ, 19 xanh; C7 (CASCADE): 1 đỏ, 19 xanh |
| 2 | `7660019` | 72 file, 950 test | 3 file, 43 test | 151 + 1 skipped (lần chạy đầu) | 8/8 (lần chạy đầu) | 19 | commit của lần chạy đầu, không đổi: 7 đỏ, 36 xanh (43) |
| 3 | `b636416` | 76 file, 983 test | 6 file, 57 test | 151 + 1 skipped | 8/8 | 19 | trên cây Task 2: guard 1 đỏ (`db/queries.ts`: `r.type`, `r.destination`, `r.cuisines`), 4 suite không import được (`Tests  1 failed | 1 passed (2)`); M9 (`r.destination` trong danh mục): guard 1 đỏ |
| 4 | `4c44c81` | 76 file, 984 test | 3 file, 31 test | 152 + 1 skipped | 8/8 | 19 | `shared-inbox.serial` trên build Task 3: 1 đỏ (`Received: "fb@furamavietnam.com"`); unit 2 đỏ, 16 xanh (18) |
| 5 | `d68befb` | 77 file, 988 test | 2 file, 17 test | 154 + 1 skipped | 8/8 | 19 | hai test mới của `filters.spec` trên build Task 4: `4 passed` (lưới giữ hành vi); `options.test.ts` không import được |
| 6 | `9aec5ed` | 79 file, 999 test | 5 file, 41 test | 155 + 1 skipped | 8/8 | 19 | `routing.spec` trên build Task 5: 1 đỏ (`/favicon.ico/privacy`: `Expected: 404`, `Received: 500`), 12 xanh; unit trên cây Task 5: guard trang khách 1 đỏ (trang chính sách), 1 xanh, `content-loaders` và `home-sections` không import được |
| 7 | `4c1481c` | 79 file, 1003 test | 5 file, 43 test | 158 + 1 skipped | 8/8 | 19 | trên build Task 6: `restaurant-page` MENU 1 đỏ, `restaurant-pages.serial` 1 đỏ, 1 xanh; loader 5 đỏ, 17 xanh (22) |
| 8 | `d4159c1` | 80 file, 1011 test | 4 file, 42 test | 159 + 1 skipped | 8/8 | 19 | `offers-expiry.serial` trên build Task 7: 1 đỏ (`Expected: 401`, `Received: 404`); `cron-daily.test.ts` không import được, `content-loaders` 6 đỏ, 21 xanh (27) |
| 9 | `0049f8d` | 80 file, 1021 test | 2 file, 76 test | 161 + 1 skipped | 8/8 | 19 | `offer-booking` trên build Task 8: 1 đỏ (thiếu `"offerId": 1`), 1 xanh; unit + tích hợp 10 đỏ, 66 xanh (76) |
| 10 | `e851757` | 80 file, 1018 test | 3 file, 23 test | 161 + 1 skipped | 8/8 | 19 | 2 đỏ, 10 xanh (12): danh sách export của `lib/data.ts`, `listDestinationOptions is not a function` |
| 11 | `e9c7def` | 80 file, 1022 test | 1 file, 86 test | 162 + 1 skipped | 8/8 | 19 | `booking-switch.serial` trên build Task 10: 2 đỏ; `registry.test.ts` 1 đỏ, 82 xanh (83) |
| 12 | `551beed` | 80 file, 1022 test | — | 162 + 1 skipped (3 lần trên một build, và 1 lần `TZ=UTC`) | 8/8 | 19 | 29 đột biến (31 lần chạy: M2 và M4 ở cả tầng tích hợp lẫn E2E) và một đối chứng âm (Bước 2–7), chạy lại trên `e9c7def` bằng lệnh của Bước 1–7: mọi lần chạy đỏ trừ M2 ở tầng E2E (`1 passed`); với spec mới, M2 đỏ ở lần 404 thứ hai (dòng 155), M1 vẫn đỏ (dòng 101), không đột biến `1 passed` |
| 13 | `3b333cd` | 80 file, 1022 test | — | 162 + 1 skipped (2 lần, và 1 lần `TZ=UTC`) | 8/8 | 19 | tài liệu, không RED; runbook 008 trên DB cục bộ dựng tới 007: pre-flight 10/10 `t`, `Applied 1 migration(s).`, post-check 10/10 `t` |

- **Mỗi commit của `p6-folded`** chạy lại typecheck (không lỗi), lint (thoát 0, 19 cảnh báo) và unit + tích hợp. Task 3–13 (app code của chúng khác commit gốc: sửa của Task 3 đi theo mọi commit sau) chạy thêm reset DB E2E (`Applied 8 migration(s).`), build, diff DOM, check-prerender, E2E `--retries=0` (gồm project `desktop-serial`, log email mới mỗi lần), visual `8 passed` ở `maxDiffPixelRatio: 0`, và một lần hỏi các đường dẫn của crawler trên server của visual. Task 1 và 2 giữ số E2E và visual của lần chạy đầu (cùng commit). Không baseline nào đổi (`git diff --stat 4f67931 -- e2e/__visual__` rỗng), không lần nào dùng `--update-snapshots`.
- **Số đếm của "Lệnh test riêng"** (bước "Chạy lại test" của mỗi task) đo trên chính từng commit của `p6-folded`. Task 12 và 13 không có lệnh test riêng.
- **RED:** E2E đỏ của task N chạy spec của task N (lấy từ commit N) trên build mà cổng của commit N−1 vừa làm, DB E2E reset trước; RED unit của task N chạy test của task N trên cây của commit N−1. Task 3–11 chạy lại hết trên `p6-folded`; output trong kế hoạch là output của lần đó, hoặc của lần chạy đầu khi chỉ khác thời gian chạy (`109ms` thay `102ms`).
- **Đường dẫn của crawler** (`curl` trên server của visual, sau visual): Task 3–5 trả `404` cho mọi đường dẫn trừ `/favicon.ico/privacy` (`500`, 3 dòng `RangeError`: tiềm ẩn từ đợt 5); Task 6–13 trả `404` cho tất cả, 0 dòng `RangeError`.
- **Diff DOM phía server** so với một build của `4f67931` (code y như `8fe98f5`), HTML chép ngay sau build: Task 3 không khác dòng nào; mọi task từ 4 tới 13 ra đúng hai khác biệt của R18, 14 dòng mỗi trang trên `/en`, `/en/restaurants/taya-house`, `/en/privacy` (hunk `29,34c29,34` và `645c645`/`292c292`/`166c166`). Bản gốc dựng đúng bằng ba lệnh của Global Constraints, chạy từ gốc repo với `TMPDIR` là thư mục scratchpad của phiên (worktree `…/fc-base`, ngoài repo): `git status` của repo không thấy nó, HTML chuẩn hóa của nó giống hệt bản gốc của lần chạy đầu, vòng `diff` với build của `3b333cd` ra 42 dòng (14 mỗi trang), và lệnh gỡ của Task 13 Bước 5 để `git worktree list` chỉ còn repo.
- **Đột biến (Task 12)**, chạy lại trên `e9c7def`: bản sao dựng bằng đúng lệnh của Bước 1 (`READY`, không `.env.local`), mỗi đột biến sau `git -C … checkout -- .`; tích hợp với `furama_cuisine_p6vm_test` (`TEST_DB_TAG=p6vm`), E2E và visual trên `furama_cuisine_p6vm_e2e_test`, cổng `3254`/`3255`, log email xóa trước mỗi lần. Kết quả trùng bảng của Bước 2–4, 6, 7 từng dòng: M2, M4, M5, M6 (server), M7, M9 và 19 đột biến M10 đỏ đúng số và đúng tên test (R2 bằng chuỗi có khoảng trắng của dòng 829); M1, M3, M4, M6 (client) đỏ ở E2E, M2 `1 passed`; Bước 6 (bản sao về commit rồi mới chép spec của repo ở `551beed`): M2 đỏ ở dòng 155, M1 ở dòng 101, không đột biến `1 passed`; M8 `3 failed`, `5 passed`; đối chứng âm `4 failed`, `4 passed`.
- **R20 ở hàng tìm kiếm** (vòng review): một build trung gian in "Call +84 236 651 9999 →" ở kết quả tìm kiếm; đo bằng Playwright (Hải Vân Lounge tắt đặt online qua form admin): ở 390 px tên gãy ba dòng, dòng loại · điểm đến năm dòng; ở 320 px hộp tên rộng 0 px và nhãn (165 px) đè lên cột chữ; trang không cuộn ngang. Bản đó bị bỏ; kế hoạch giữ "Call →" và đưa câu chữ R20 cho controller duyệt.
- **Kiểm SQL cho Neon:** Task 1 Bước 12 (lần chạy đầu) và Task 13 Bước 1 (chạy lại trên `3b333cd`, DB `furama_cuisine_p6v_pre_test`), trên một DB cục bộ dựng tới 007: pre-flight 10/10 `t`; `migrate.mjs` áp 008; post-check 10/10 `t`.
- **Bộ sinh `media`** (Task 1 Bước 4, commit không đổi): 39 dòng, sha256 `302055f0eba2337c335f121f1576d277b1768364738f9eb909def0fc5db76979`, trùng từng byte khối `VALUES` của migration.
- **Cổng cuối** (`3b333cd`): cổng đủ hai lần (lượt kiểm từng commit, rồi một lần nữa), mỗi lần reset DB E2E và build lại: typecheck không lỗi; lint thoát 0, 19 cảnh báo; `Test Files  80 passed (80)`, `Tests  1022 passed (1022)`; `Applied 8 migration(s).`; build thoát 0; check-prerender đạt với mười tag của layout, `PAGE_TAGS` của `/en` (gồm `content:offers`) và trang Tàya, `lifetimes: /en 3600/86400s, …`, và `/api/cron/daily` không prerender; diff DOM chỉ R18; E2E `162 passed`, `1 skipped`; visual `8 passed`; đường dẫn của crawler đều `404`. Rồi trên build lần 2, DB E2E vừa reset, một lần E2E với `TZ=UTC`: `162 passed`, `1 skipped`. Task 12 (`551beed`): cổng đủ hai lần, rồi trên build lần 2 hai lần E2E nữa và một lần `TZ=UTC`, cùng số. `git diff --stat 4f67931 -- e2e/__visual__` rỗng. `git diff --shortstat 4f67931 3b333cd`: `110 files changed, 5745 insertions(+), 872 deletions(-)`.
- **Tên DB và cổng của lần kiểm chứng:** giống khối "Cổng kiểm tra của mọi task", trừ tên DB và cổng, để không đụng agent khác dùng chung Postgres: `furama_cuisine_p6v_test` (`TEST_DB_TAG=p6v`) và `furama_cuisine_p6v_e2e_test`, cổng E2E `3250`, visual `3251`, E2E riêng file (RED) và lần đo bố cục `3252`, lần hỏi các đường dẫn trên build trước sửa `3256`; các DB mà test tự tạo mang cùng thẻ (`…_p6v_test`, `…_p6vm_test`); đột biến: `furama_cuisine_p6vm_test` (`TEST_DB_TAG=p6vm`) và `furama_cuisine_p6vm_e2e_test`, cổng `3254`/`3255`; runbook: `furama_cuisine_p6v_pre_test`; mỗi lần chạy có `CRON_SECRET=$(openssl rand -hex 16)`. Mọi DB đó đã xóa, không server nào còn chạy khi xong; `furama_cuisine_test`/`furama_cuisine_e2e_test` không bị đụng.
- Không gì chạm Neon, Vercel, máy SMTP thật hay dịch vụ ngoài; không gói nào được cài; không lệnh nào ra mạng. Request `tel:` của Task 11 là trong Chromium headless, không ra ngoài.
