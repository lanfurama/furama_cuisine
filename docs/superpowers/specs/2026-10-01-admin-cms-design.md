# Furama Cuisine — Admin CMS: thiết kế tổng

- **Ngày:** 2026-10-01 (bản 2, đã qua một vòng rà soát với 3 reviewer độc lập)
- **Trạng thái:** chờ duyệt
- **Phạm vi tài liệu:** spec tổng gồm kiến trúc, mô hình dữ liệu, các luồng chính và lộ trình 11 đợt. Mỗi đợt có kế hoạch triển khai riêng trong `docs/superpowers/plans/`, viết khi bắt đầu đợt đó.
- **Tài liệu nghiên cứu làm căn cứ:** `docs/superpowers/research/2026-10-01-admin-cms/` (7 báo cáo và 1 bản tổng hợp, có trích dẫn `file:line` và nguồn). Tài liệu này dùng để tham khảo khi lập kế hoạch. Chỗ nào nghiên cứu nói khác spec thì **làm theo spec**.

---

## 1. Mục tiêu

Nhân viên Furama không biết code vẫn tự cấu hình được **mọi nội dung khách nhìn thấy** trên website, trong một trang admin. Bấm lưu là web khách cập nhật, không cần dev, không cần deploy lại. Trang admin đó cũng dùng để quản lý đặt bàn.

**Thành công khi:**
1. Mọi chữ, ảnh, link, giá, số điện thoại, danh sách và section trên web khách đều sửa được trong admin. Sau khi lưu, khách mở trang mới thấy thay đổi trong vài giây.
2. Admin tự thêm được ngôn ngữ mới, trong giới hạn ở mục 8. Web khách có URL theo ngôn ngữ và nút chuyển ngôn ngữ hoạt động thật.
3. Có đặt bàn mới thì nhân viên nhận email. Nhân viên xác nhận, hủy hoặc đánh dấu no-show trong admin, và khách nhận email bằng ngôn ngữ của mình.
4. Vertex AI dịch, gợi ý nội dung, sinh SEO và alt ảnh. Model, prompt và thuật ngữ được cấu hình trong admin.

## 2. Phạm vi

**Trong phạm vi:** 8 yêu cầu đã chốt ở mục 3.

**Ngoài phạm vi:**
- Page builder; đổi màu, font hay bố cục từ admin.
- Thanh toán hoặc đặt cọc.
- SMS hoặc Zalo cho khách.
- Link để khách tự đổi hoặc hủy đặt bàn.
- Đồng bộ với hệ thống đặt bàn hoặc POS có sẵn của nhà hàng.
- Đăng bài viết (stories) ngay trên site. Stories vẫn chỉ là link ra bài viết bên ngoài.
- Dịch giao diện admin sang ngôn ngữ khác. Admin chỉ có tiếng Việt.
- Ngôn ngữ viết từ phải sang trái.
- Các tính năng ở mục 14.2 ("Tùy chọn sau mốc B").

## 3. Các quyết định đã chốt

| # | Quyết định | Nguồn |
|---|---|---|
| 1 | Admin sửa **nội dung bên trong design hiện tại**: chữ, ảnh, link, giá; thêm, xóa, sắp xếp, ẩn hiện từng mục; bật tắt từng section. | Người dùng |
| 2 | **Đa ngôn ngữ; admin tự thêm ngôn ngữ** mà không cần dev. | Người dùng |
| 3 | **2 vai trò: Admin và Editor.** Mời qua email. Có nhật ký ai sửa gì. | Người dùng |
| 4 | **Vertex AI** dùng cho dịch tự động, trợ lý viết, SEO và alt ảnh. Admin cấu hình model (Gemini hoặc Claude trên Vertex), region, prompt, thuật ngữ và bật tắt từng tính năng. **Khóa GCP không lưu trong DB.** | Người dùng |
| 5 | Làm thêm: **quản lý đặt bàn**, **trang chi tiết cho mọi nhà hàng**, **giờ mở cửa và sức chứa theo từng nhà hàng**, **email thông báo**. | Người dùng |
| 6 | **Kiến trúc:** tự xây admin trong chính app Next.js, dùng chung DB Neon. Không dùng Payload hay Sanity. | Người dùng (phương án 1) |
| 7 | **Lưu là lên web ngay**, không có bước nháp hay xuất bản. Editor cũng được lưu. Muốn quay lại bản cũ thì dùng **Lịch sử và khôi phục** (mục 7.5). | Người dùng |
| 8 | **Giao diện admin bằng tiếng Việt.** | Người dùng |

**Các mặc định** (đã duyệt ở phần 1, sau này chỉnh được trong admin):

| Hạng mục | Mặc định |
|---|---|
| Ngôn ngữ | **Mốc ra mắt A** (sau đợt 5): chỉ `en`. **Mốc ra mắt B** (sau đợt 10): `en` (mặc định) và `vi`; bản `vi` do người dịch, hoặc AI dịch rồi người duyệt. Admin thêm `ko` hoặc `zh-hans` sau. Khi chỉ có một ngôn ngữ đang bật thì ẩn nút chuyển ngôn ngữ. |
| Bản máy dịch | Ở ngôn ngữ khác EN, khách chỉ thấy bản đã duyệt; thiếu thì hiện bản tiếng Anh. Mỗi ngôn ngữ có công tắc `serve_machine`, mặc định tắt. |
| Đặt bàn | Nhân viên xác nhận thủ công, không tự động xác nhận. Có trạng thái Đã đến và No-show. Đặt trước tối đa **14 ngày tính cả hôm nay** (từ hôm nay đến hôm nay + 13, theo giờ Việt Nam). Tối đa 12 khách. Mỗi nhà hàng ghi đè được. Email của khách không bắt buộc. |
| Editor | Thấy và sửa được tất cả nhà hàng. |
| Hạ tầng | Vercel **Pro**, region `iad1`; Neon ở `us-east-1`. |
| AI | Mọi tính năng dùng `gemini-3.8-flash` trên endpoint `global`; Claude bật thêm trong trang cấu hình. Ngân sách $20/tháng, tính cho mọi lời gọi. Mỗi người (Admin hoặc Editor) tối đa 10 lượt/phút và 100 lượt/ngày; chỉ tính những lời gọi do chính người đó bấm. Bản preview không gọi AI. |
| Dữ liệu cá nhân | Ẩn danh dữ liệu khách sau 24 tháng. |
| Email | Gửi nhân viên bằng tiếng Việt. Gửi khách bằng ngôn ngữ khách dùng khi đặt bàn. |
| Ngôn ngữ khi vào `/` | Lấy theo cookie, rồi đến ngôn ngữ trình duyệt, cuối cùng là `en`. |
| URL trang nhà hàng | `/{lang}/restaurants/{slug}`. Slug giống nhau ở mọi ngôn ngữ. |
| Tên nhà hàng | Không dịch. Nhập một lần, dùng chung cho mọi ngôn ngữ, và tự động đưa vào bảng thuật ngữ không dịch. |

## 4. Kiến trúc tổng thể

```
Một app Next.js 16.3 (App Router) trên Vercel
├── app/(site)/[lang]/…      Web khách (root layout 1): cache theo tag, đa ngôn ngữ
├── app/admin/…              Admin tiếng Việt (root layout 2): render động, Better Auth, Admin/Editor
├── app/api/…                auth, availability, AI (Vertex), upload, preview, cron
├── proxy.ts                 chỉ chạy cho đường dẫn chưa có tiền tố ngôn ngữ và /admin (xem 6.1)
└── lib/server/** (server-only)
      dal/       verifySession(), requirePermission(): cổng duy nhất cho mọi thao tác ghi của admin
      content/   đọc (cache, nhận locale) và ghi (Server Action → quyền → zod → ghi → audit → làm mới cache)
      booking/   lịch phục vụ, sức chứa, giao dịch đặt bàn, vòng đời trạng thái
      email/     outbox, template React Email, gửi qua SMTP (nodemailer)
      media/     đăng ký và dọn file
      ai/        client Vertex không khóa, danh mục model, các tính năng, sổ chi phí
           │
           ├── Neon Postgres   nội dung, bản dịch, đặt bàn, nhân viên, nhật ký (một DB, migration SQL)
           ├── Vercel Blob     ảnh và PDF upload (store public, iad1)
           ├── Máy chủ SMTP    email (tài khoản SMTP; tên miền gửi có SPF, DKIM, DMARC)
           └── Vertex AI       qua AI SDK 7 + @ai-sdk/google-vertex; xác thực Vercel OIDC → GCP WIF
```

**Thư viện mới.** Phiên bản lấy theo `npm view` ngày 2026-10-01; kiểm tra lại khi cài.

| Gói | Phiên bản | Dùng cho |
|---|---|---|
| `better-auth` | ^1.7.7 | Đăng nhập, phiên, plugin admin (vai trò) |
| `ai`, `@ai-sdk/google-vertex`, `@ai-sdk/react` | ^7.0, ^5.0, ^4.0 | Gọi Gemini và Claude trên Vertex; `useCompletion` |
| `google-auth-library`, `@vercel/oidc` | ^10.9, ^3.8 | Xác thực Vertex không cần khóa |
| `@vercel/blob` | ^2.8 | Upload trực tiếp từ trình duyệt (presigned) |
| `nodemailer`, `react-email` | ^10.0, ^6.11 | Gửi email qua SMTP (587 STARTTLS hoặc 465 TLS). Import component từ `'react-email'`, vì `@react-email/components` đã ngừng hỗ trợ. `smtp-server` (dev) là máy SMTP giả trong test. |
| `zod` | ^4 | Kiểm tra đầu vào, thông báo lỗi tiếng Việt qua `z.locales.vi()` |
| `intl-messageformat` | ^12 | Chuỗi ICU (số nhiều, biến) |
| `libphonenumber-js` | ^1.13 | Chuẩn hóa số điện thoại sang E.164 |
| `sharp` | mới nhất | Thu nhỏ ảnh trước khi sinh alt |
| `botid` | ^1.5 | Chống bot ở form đặt bàn |
| `vitest`, `@playwright/test` | mới nhất | Kiểm thử |

Truy cập DB vẫn dùng `pg` và SQL viết tay như hiện nay, không thêm ORM.

## 5. Mô hình dữ liệu

### 5.1 Nguyên tắc

1. **Nội dung dạng danh sách** gồm một **bảng chính** (các cột không dịch: ảnh, thứ tự, `is_published`, link) và một **bảng `*_i18n`** khóa `(id, locale)`. Bảng `*_i18n` chứa các cột dịch được, cho phép NULL.
2. **Chữ của section, chữ giao diện, SEO, nội dung email và trang chính sách** nằm trong bảng `content_strings(key, locale, value)`. **Danh sách key do code quy định**, trong file `lib/i18n/registry.ts`. Mỗi key khai báo:
   - bản mặc định EN; với `email.*` và `legal.*` có thêm bản VI;
   - độ dài tối đa;
   - các biến ICU;
   - ghi chú ngữ cảnh cho người dịch và cho AI;
   - **màn hình admin dùng để sửa key đó** (`screen`).

   Admin không tạo được key mới. Một key chưa có hàng trong DB thì dùng bản mặc định trong registry.
3. **Mọi hàng bản dịch** (`*_i18n`, `content_strings`, `media_i18n`) có các cột:
   - `status`: `machine` hoặc `reviewed`. Không có trạng thái nháp, vì lưu là lên web ngay.
   - `origin`: `human`, `ai` hoặc `seed`.
   - `ai_model`.
   - `source_hash`: hash các trường EN tại thời điểm dịch.
   - `reviewed_by`, `reviewed_at`, `updated_at`, `updated_by`.
4. **Ghi trạng thái:**
   - Mọi lần lưu từ form admin đều ghi `reviewed`, kể cả khi chữ do AI gợi ý và người dùng bấm lưu.
   - Chỉ hai luồng ghi `machine`: job dịch hàng loạt và alt ảnh tự sinh.
   - Seed ghi `reviewed` với `origin='seed'`.
5. **Hiển thị cho khách:**
   - Hàng ngôn ngữ mặc định (`en`) luôn hiển thị, kể cả alt EN có `machine`. Alt này có hàng chờ duyệt riêng (mục 8).
   - Hàng ở ngôn ngữ khác hiển thị khi `reviewed`, hoặc khi là `machine` và ngôn ngữ đó bật `serve_machine`.
   - Thiếu bản dịch thì lấy tiếng Anh cho **riêng trường đó**.
   - Khi bản EN thay đổi, bản dịch đã duyệt vẫn hiển thị, nhưng admin đánh dấu "EN đã đổi".
6. **ID người thao tác** là `text` (theo id của Better Auth) và không có khóa ngoại, để nhật ký vẫn còn khi một nhân viên bị xóa.
7. **Migration:**
   - Vẫn là file SQL trong `db/migrations/`, chạy bằng `scripts/migrate.mjs`, mỗi file một transaction.
   - Đánh số tiếp theo file mới nhất lúc viết. Spec không cố định số file.
   - Mở rộng trước, thu gọn sau. Danh sách cột và hằng sẽ bỏ ở mục 14, đợt 10.
   - **Mọi seed dùng `ON CONFLICT DO NOTHING`.**
8. **"Hôm nay" trong SQL** luôn là `(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`.

### 5.2 Danh sách bảng

Cột "Đợt" cho biết đợt nào tạo bảng. Bảng dùng chung cho cả hai nhánh (đặt bàn và nội dung) được tạo sớm, ở đợt 2.

**Nền tảng (đợt 2)**

| Bảng | Cột chính |
|---|---|
| `locales` | `code` (khóa chính, dùng trong URL: `en`, `vi`, `zh-hans`), `bcp47` (`zh-Hans`), `native_name`, `short_label`, `script` (theo bảng `SCRIPT_FONTS`, mục 8), `is_default` (chỉ một hàng), `is_enabled`, `serve_machine`, `sort_order`. Seed: `en` (mặc định, bật) và `vi` (tắt). |
| `content_strings` | `(key, locale)`, `value` (ICU), cùng các cột bản dịch. Bảng tạo ở đợt 2, rỗng; hàm đọc rơi về registry khi thiếu. |
| `destinations` | `id` (resort, dining-house, mm, future), `kind` (venue/teaser), `card_image_id`, `phone_e164`, `phone_display`, `email`, `map_url`, `show_in_footer`, `sort_order`, `is_published`. Seed từ `lib/data.ts`. Bảng dịch thêm ở đợt 6. |

**Nội dung (đợt 6).** Mọi bảng chính có `sort_order`, `is_published`, `updated_at`, `updated_by`.

| Bảng chính → bảng dịch | Cột chính | Cột dịch |
|---|---|---|
| `destination_i18n` | | `name`, `card_title_1/2`, `card_blurb_1/2`, `address` |
| `sections` | `key` (hero, film, finder, cuisines, restaurants, destinations, experiences, heritage, stories, offers, booking_bar), `is_visible` (restaurants luôn bật, có CHECK), `image_id`, `link_url` (với film chỉ nhận URL YouTube hoặc Vimeo) | chữ nằm trong `content_strings` |
| `site_settings` (một hàng; đợt 5 tạo sớm với cột `email`, đợt 6 thêm các cột còn lại bằng `ADD COLUMN IF NOT EXISTS`) | `email`, `default_restaurant_id` (nhà hàng chọn sẵn ở thanh đặt bàn trang chủ; NULL thì lấy nhà hàng đặt được đầu tiên), `default_occasion`, `og_image_id`, `hero_autoplay_ms` | — |
| `cuisines` → `cuisine_i18n` | `id` (slug), `image_id` | `label` |
| `restaurants` (bảng có sẵn, mở rộng) → `restaurant_i18n` | `name` (giữ ở bảng chính, không dịch); thêm `slug`, `destination_id` (FK), `card_image_id`, `detail_image_id`, `og_image_id`, `phone_e164`, `phone_display`, `map_url`, `has_detail_page`, `is_published`, `archived_at` | `type_label`, `detail_kicker`, `story_label`, `story`, `highlights_title`, `menu_pdf_media_id` hoặc `menu_pdf_url`, `seo_title`, `seo_description` |
| `restaurant_cuisines` | `(restaurant_id, cuisine_id)`, `sort_order` | — |
| `restaurant_highlights` → `restaurant_highlight_i18n` | `restaurant_id`, `image_id` | `title`, `detail` |
| `hero_slides` | `image_id`, `image_mobile_id` (chỉ slide đầu tiên dùng) | alt lấy từ `media_i18n` |
| `experiences` → `experience_i18n` | `link_url` | `title`, `blurb` |
| `stories` → `story_i18n` | `image_id`, `href`, `published_on` | `category`, `title`, `href` (ghi đè theo ngôn ngữ) |
| `offers` → `offer_i18n` | `restaurant_id`, `price_amount`, `currency`, `price_basis` (`plus_plus`/`net`), `valid_from`, `valid_until` | `title`, `schedule`, `venue_override` |
| `nav_items` → `nav_item_i18n` | `target_section` (FK tới `sections`) | `label` (CHECK ≤ 18 ký tự) |
| `social_links` | `platform` (enum), `href`, `visible_locales` | — |

**File (đợt 6 tạo bảng; đợt 7 thêm upload)**

| Bảng | Cột chính |
|---|---|
| `media` | `id` (uuid), `storage` (`static` hoặc `blob`), `url`, `pathname`, `content_type` (jpeg/png/webp/avif/pdf), `width`, `height`, `bytes`, `blur_data_url`, `is_decorative`, `deleted_at` |
| `media_i18n` | `(media_id, locale)`, `alt` (≤ 250 ký tự), cùng các cột bản dịch. Không dùng cho PDF. |

Bảng nội dung tham chiếu `media` với `ON DELETE RESTRICT`, nên không xóa được file đang được dùng.

**Đặt bàn (đợt 4)**

| Bảng | Cột chính |
|---|---|
| `booking_settings` (một hàng) | `window_days` 14, `lead_minutes` 30, `same_day_cutoff` (kiểu `time`; NULL = không giới hạn; ví dụ `17:00` nghĩa là sau 17:00 giờ VN không nhận đặt bàn online cho chính hôm đó), `max_party` 12, `auto_confirm` false, `guest_ack_email` true, `pii_retention_months` 24 |
| `restaurants` (thêm cột) | `booking_enabled`: cờ duy nhất. Tắt thì ẩn nút RESERVE, bỏ nhà hàng khỏi danh sách trong form đặt bàn, và API/action trả `restaurant_unavailable`. Thêm `window_days`, `lead_minutes`, `max_party`, `auto_confirm` (NULL = theo mặc định chung). |
| `service_periods` | `restaurant_id`, `meal` (Breakfast/Lunch/Dinner/Drinks), `weekdays smallint[]` (ISO 1–7), `first_seating`, `last_seating` (kiểu `time`), `interval_min`, `covers_per_slot`, `active`, `sort_order` |
| `closures` → `closure_i18n` | `scope` (all/destination/restaurant), `destination_id`, `restaurant_id`, `starts_on`, `ends_on`, `meals[]` (NULL = cả ngày), `show_reason`, `internal_note`. Bảng dịch có `public_reason`. |
| `reservations` (mở rộng) | Trạng thái: `requested`, `confirmed`, `seated`, `no_show`, `cancelled`, `declined`. Thêm `meal`, `phone_e164`, `locale` (FK `locales`), `source` (web/phone/walk_in/staff/legacy), `offer_id` (cột tạo ở đợt 4, khóa ngoại tới `offers` thêm ở đợt 6), `over_capacity`, `status_reason`, `confirmed_at`, `cancelled_at`, `search_text`, `is_test`, `anonymized_at`, `version`, `updated_at`, `updated_by`. **`reserved_at` vẫn là `text`**, có CHECK `^([01][0-9]\|2[0-3]):[0-5][0-9]$` (kiểm tra dữ liệu cũ trước khi thêm); so sánh trong SQL viết `reserved_at::time`. `guests` CHECK 1–50; giới hạn thật lấy theo `max_party`. |
| `reservation_events` | dòng thời gian của đặt bàn: `actor_kind`, `actor_id`, `actor_label`, `type`, `from_status`, `to_status`, `changes`, `reason` |
| `reservation_notes` | ghi chú nội bộ của nhân viên; không bao giờ gửi cho khách |
| `notification_recipients` | `scope`, `destination_id`, `restaurant_id`, `email`, `events[]`, `locale` (mặc định `vi`), `active` |
| `email_outbox` | `env`, `event`, `audience`, `reservation_id`, `to_email`, `locale`, `idempotency_key` (UNIQUE, có dạng `outbox:{id}`), `status`, `attempts`, `next_attempt_at`, `locked_until`, `last_error`, `provider_id`, `sent_at` |

Index của đặt bàn:
- `reservations_dedupe_v2_idx`: unique trên `(restaurant_id, reserved_on, reserved_at, phone_e164)`, chỉ với trạng thái requested hoặc confirmed. Tạo ở đợt 1.
- `reservations_load_idx`.
- `reservations_inbox_idx` trên `(status, created_at DESC, id DESC)`.
- `reservations_pending_idx`, `reservations_day_idx`, `reservations_phone_idx`.
- Index trigram (`pg_trgm`) trên `search_text`.

**Nhân viên, quản trị, AI (đợt 3, riêng AI ở đợt 9)**

| Bảng | Cột chính |
|---|---|
| `staff_user`, `staff_session`, `staff_account`, `staff_verification` | Bảng của Better Auth. Đổi tên từng bảng bằng `modelName`, ví dụ `user: { modelName: 'staff_user' }`; Better Auth không có tùy chọn tiền tố chung. SQL sinh bằng `npx auth@latest generate` **sau khi** đã khai `modelName` và plugin `admin` (plugin này thêm `role`, `banned`, `banReason`, `banExpires`). |
| `auth_rate_limit` | giới hạn số lần đăng nhập, lưu trong DB |
| `staff_invitation` | `email`, `role`, `token_hash` (SHA-256), `expires_at` (sau 7 ngày), `used_at`, `revoked_at`, `invited_by`, `email_error` |
| `audit_log` | `at`, `actor_id`, `actor_email`, `action` (create/update/delete/reorder/restore/settings/staff.*), `entity_type`, `entity_id`, `locale`, `before jsonb`, `after jsonb`, `ip` |
| `audit_feed` (view) | gộp `audit_log` với `reservation_events` để hiển thị chung một dòng thời gian |
| `ai_settings` (một hàng, có phiên bản) | JSON được zod kiểm tra |
| `ai_glossary` | `term`, `mode` (keep/map), `locale`, `target` |
| `ai_usage` | `at`, `actor_id`, `feature`, `model`, `input_tokens`, `output_tokens`, `cost_usd` |
| `ai_jobs` | `locale`, `scope`, `status` (queued/running/paused/done/cancelled), `progress`, `error` |

## 6. Web khách

### 6.1 Routing và layout

- **Hai root layout:**
  - `app/(site)/[lang]/layout.tsx`: font, `<html lang={bcp47}>`, `SiteProvider`, `Chrome`.
  - `app/admin/layout.tsx`: có `<html lang="vi">` riêng, CSS admin, `noindex`. Cách render động xem mục 11.
  - Chuyển giữa web khách và admin sẽ tải lại toàn trang. Đây là chủ ý.
- **`proxy.ts`:**
  - **Matcher chỉ gồm `/admin/:path*` và các đường dẫn chưa có tiền tố ngôn ngữ.** Bỏ qua `/api`, `/_next`, file tĩnh, và mọi đường dẫn bắt đầu bằng mã ngôn ngữ (`/en`, `/vi`, `/zh-hans`…). Nhờ vậy trang khách đã cache không phải gọi proxy. Regex của matcher có unit test.
  - Đường dẫn chưa có tiền tố (trừ `/admin`) được chuyển hướng theo cookie, rồi `Accept-Language`, rồi `en`.
  - `/admin/*` không có cookie phiên thì chuyển về `/admin/sign-in?next=…`, **trừ** `/admin/sign-in`, `/admin/accept-invite`, `/admin/reset-password`.
  - Danh sách ngôn ngữ đang bật được lấy kiểu best-effort: biến trong module có TTL 60 giây, truy vấn có timeout ≤ 500 ms; lỗi hoặc quá giờ thì dùng `['en']`. Đây là truy vấn DB duy nhất của proxy. Bước kiểm tra `/admin` chỉ đọc cookie.
- **Tạo trang tĩnh:**
  - `[lang]/layout.tsx` có `generateStaticParams` trả về các ngôn ngữ đang bật lúc build (luôn có `en`).
  - `restaurants/[slug]/page.tsx` có `generateStaticParams` trả về các slug đang bật `has_detail_page`.
  - Bật `partialPrefetching: true` cùng `cacheComponents: true`. Ngôn ngữ hoặc nhà hàng thêm sau build sẽ nhận App Shell ở request đầu tiên, sau đó được nâng lên trang tĩnh và cache.
  - Ngôn ngữ đã tắt, hoặc nhà hàng đã tắt trang chi tiết, thì `notFound()`.
- **Xem trước** ngôn ngữ chưa bật: nhân viên đã đăng nhập bấm "Xem trước" trong admin. Route `/api/admin/preview` kiểm tra quyền rồi bật Draft Mode. Ở Draft Mode trang render động, hiện được ngôn ngữ đang tắt, có `noindex`, và không xuất hiện trong nút chuyển ngôn ngữ, sitemap hay hreflang.
- **Đường dẫn và trang phụ:**
  - `/taya-house` chuyển hướng 308 sang `/en/restaurants/taya-house`.
  - Có `app/global-not-found.tsx` (cần `experimental.globalNotFound`), `app/(site)/[lang]/error.tsx`, `sitemap.ts` (có hreflang) và `robots.ts`.
- **Nút chuyển ngôn ngữ** là link thường và tải lại trang. Trạng thái của form đặt bàn không được giữ qua lần chuyển này.

### 6.2 Đọc dữ liệu và cache

- Bật `cacheComponents: true` và `partialPrefetching: true` (cả hai đều do đợt 2 làm).
- **Mọi hàm đọc nội dung** đều là `server-only`, có `'use cache'`, `cacheLife('max')`, `cacheTag(...)`, và **nhận `locale` làm tham số** (tham số này tự vào cache key).
  - Chỉ Server Component trong cây `app/(site)/[lang]` lấy ngôn ngữ bằng `lang()` của `next/root-params`, rồi truyền vào hàm đọc.
  - Các nơi sau luôn truyền `locale` tường minh, vì `next/root-params` không dùng được ở đó: Server Action, Route Handler (`/api/availability` nhận thêm `&lang=`), `after()`, bộ gửi email (dùng `email_outbox.locale`), cron, `sitemap.ts`, trang admin.
- **Nội dung phụ thuộc ngày:**
  - Hàm đọc offers dùng `cacheLife('hours')`.
  - Cron `/api/cron/daily` chạy lúc 17:05 UTC (00:05 giờ VN) và gọi `revalidateTag('content:offers', 'max')`. Nhờ vậy ưu đãi tự ẩn khi qua `valid_until` và tự hiện khi tới `valid_from` ngay sau nửa đêm.
- **Danh sách tag** (đầy đủ, nằm ở `lib/cache-tags.ts`):

  | Nhóm | Tag |
  |---|---|
  | Nội dung | `content:hero`, `content:film`, `content:finder`, `content:cuisines`, `content:destinations`, `content:experiences`, `content:heritage`, `content:stories`, `content:offers`, `content:booking`, `content:sections` (bật tắt section), `content:nav`, `content:contact` (site_settings, social_links, footer), `content:seo`, `content:legal`, `content:ui` (chữ giao diện) |
  | File | `media` (gắn cho mọi hàm đọc có alt ảnh) |
  | Nhà hàng | `restaurants`, `restaurant:<id>`, `booking-rules:<id>` |
  | Hệ thống | `locales`, `ai-settings` |
  | Theo ngôn ngữ | `i18n:<code>`: gắn cho mọi hàm đọc của ngôn ngữ đó; làm mới khi đổi `serve_machine`, khi bật hoặc tắt ngôn ngữ, và khi job dịch xong một phần |

  Mỗi hàm lưu khai báo rõ tag nó làm mới. Lưu bản dịch dùng cùng tag với nội dung gốc.
- **Làm mới cache:**
  - Thao tác ghi trong Server Action gọi `updateTag(tag)`.
  - Thao tác ghi ngoài Server Action (job dịch hàng loạt, alt ảnh tự sinh trong `after()`, cron) gọi `revalidateTag(tag, 'max')`.
  - Riêng cron ưu đãi hằng ngày dùng `'max'`: khách đầu tiên sau 00:05 có thể thấy bản cũ một lần, nhưng DB lỗi lúc đó không làm sập trang chủ.
  - Khách mở trang mới thấy thay đổi ngay. Khách đang mở sẵn trang có thể thấy bản cũ tối đa khoảng 5 phút.
- **Không cache:** đặt bàn, availability, mọi trang admin.
- **Phương án dự phòng** nếu chuyển sang Cache Components tốn quá nhiều công: dùng `unstable_cache` với tham số `locale` tường minh (không gọi `next/root-params` bên trong), giữ nguyên tên tag và các lời gọi làm mới.

### 6.3 Thay đổi bắt buộc trong component

Phải xong trước khi admin được phép thêm hoặc xóa mục. Mục 8 làm cùng lúc với việc bật `cacheComponents` ở đợt 2.

1. **Bỏ mọi chỗ viết riêng cho `'taya-house'`** (`SiteProvider.tsx:33,108,299`, `RestaurantCard.tsx:15`, `SearchOverlay.tsx:95`, `MobileBar.tsx:12-24`, `TayaHero.tsx:51`, `MoreRestaurants.tsx:12`). Thay bằng `has_detail_page`, `slug` và tham số route. Nhà hàng chọn sẵn (`SiteProvider.tsx:126`) lấy từ `site_settings.default_restaurant_id`.
2. **Lọc ẩm thực và bữa ăn theo slug hoặc key**, không theo nhãn tiếng Anh (`SiteProvider.tsx:199`, `Cuisines.tsx:40`, `Finder.tsx:14`). Từ đợt 4, các bữa của một nhà hàng (dùng cho lọc "Occasion" và nhóm giờ trong form đặt bàn) được tính từ các `service_periods` đang `active`.
3. **Số slide hero và vị trí chấm hành trình tính theo số lượng thật**, thay cho `% 3` ở `SiteProvider.tsx:447` và 4 vị trí cố định ở `Destinations.tsx:29` / `home.css:626-627`.
4. **Ngày, số và số nhiều dùng `Intl` và ICU**, thay cho mảng `WD`/`MO` và hàm `fmtDay`.
5. **Mọi Server Action trả về cùng một dạng:** `{ok:true, data}` hoặc `{ok:false, code, params?, fieldErrors?}`. Client tra câu hiển thị theo `error.<code>`. Danh sách mã ở mục 10.2.
6. **Nhãn menu chỉ lưu một bản;** chữ hoa do CSS (`text-transform`). Bỏ `MENU_LABELS` bị lặp.
7. **Mọi ảnh hiển thị qua component `CmsImage`** bọc `next/image`. Alt lấy theo ngôn ngữ; ảnh trang trí có `alt=""`.
8. **Không suy ra trang hiện tại bằng `usePathname()` trong layout dùng chung** (`SiteProvider.tsx:107`, `PageCurtain.tsx:68`). Mỗi trang đặt một `<ViewMarker view=… restaurant=…/>`. Chỗ nào vẫn cần `usePathname` thì bọc component đó trong `<Suspense>`. Mọi truy vấn DOM (`lib/motion.tsx`, `scrollToId`, `IntroTrigger`) chỉ tìm trong container của trang đang hiện, vì Cache Components giữ route cũ ở trạng thái ẩn bằng `<Activity>`.
9. **Ô tìm kiếm khớp cả bản dịch đang hiển thị lẫn bản EN** (tên, loại, ẩm thực, điểm đến) và bỏ dấu khi so sánh (`SearchOverlay.tsx:36`).

### 6.4 Trang chi tiết dùng chung cho mọi nhà hàng

- **Route:** `app/(site)/[lang]/restaurants/[slug]/page.tsx`. `params` được `await` bên trong `<Suspense>`. Nhà hàng không bật `has_detail_page` thì `notFound()`, và thẻ nhà hàng mở form đặt bàn như hiện nay.
  - Ở đợt 2, route này thay cho `app/taya-house`. Lúc đó chỉ Tàya có trang, còn `slug` và `has_detail_page` tạm là hằng trong code.
  - Từ đợt 6, trang đọc dữ liệu từ DB.
- **Nội dung trang:**
  - Kicker, tên, nhãn câu chuyện, câu chuyện, ảnh chân dung.
  - Nút RESERVE.
  - Nút CALL và MAP: lấy của nhà hàng; thiếu thì lấy của điểm đến; thiếu nữa thì ẩn nút.
  - Nút MENU: PDF của ngôn ngữ đang xem, rồi PDF tiếng Anh, rồi cuộn xuống phần nổi bật; không có gì thì ẩn nút.
  - Phần nổi bật.
  - "More at {destination}": ẩn nếu không có nhà hàng nào khác cùng điểm đến.
- **Thanh tab mobile** của trang chi tiết tự chia cột theo số nút đang hiện.
- **Khi bật `has_detail_page`,** admin bắt buộc có `detail_image_id` và câu chuyện EN. Admin cảnh báo nếu có ít hơn 2 điểm nổi bật hoặc nếu có nút bị ẩn.
- **Sửa lỗi animation intro:** mỗi trang có một `IntroTrigger` chạy lại animation `[data-intro]` sau mỗi lần điều hướng phía client, thay cho `useIntro(true,0)` đang gắn cố định trong `Chrome.tsx:26`.

### 6.5 Giới hạn bố cục admin phải tuân theo

| Mục | Giới hạn |
|---|---|
| Hero slides | 1–5. Slide 1 bắt buộc có ảnh crop cho mobile. Tiêu đề giữ 3 dòng; dòng 2 chỉ hiện trên desktop. |
| Destinations | 2–5, tối đa 1 thẻ teaser (sau khi đã sửa cách tính vị trí chấm) |
| Stories | Tối đa 4 |
| Offers | 0–6, nên là bội số của 3. Không có ưu đãi nào thì ẩn section. |
| Experiences | 1–5 |
| Cuisines | Nên tối đa 10 |
| Điểm nổi bật ở trang chi tiết | 0–5. Bằng 0 thì ẩn section. |
| Menu điều hướng | Tối đa 6 mục. Nhãn dài hơn 14 ký tự thì cảnh báo; dài hơn 18 thì không cho lưu. Mục tự ẩn khi section đích bị ẩn. |
| Mạng xã hội | Tối đa 6 |
| Section restaurants | Không được ẩn |
| Tên nhà hàng ở trang chi tiết | Cảnh báo khi dài hơn 24 ký tự |

Độ dài tối đa của từng chuỗi khai trong registry. Form cảnh báo khi bản dịch dài hơn khoảng 1,3 lần bản EN.

## 7. Admin

### 7.1 Đăng nhập và phân quyền

- **Better Auth** chạy trong app, dùng chung pool `pg` hiện có:
  - đăng nhập bằng email và mật khẩu, có chức năng quên mật khẩu;
  - plugin `admin` với `createAccessControl` định nghĩa vai trò `admin` và `editor`;
  - plugin `nextCookies()`;
  - giới hạn số lần thử lưu trong DB;
  - phiên đăng nhập kéo dài 7 ngày.
- **Chỉ vào được khi có lời mời:**
  - Tắt đăng ký công khai (`disableSignUp`).
  - Hook `databaseHooks.user.create.before` từ chối mọi email không có lời mời còn hiệu lực (chưa dùng, chưa thu hồi, chưa hết hạn).
  - Ngoại lệ duy nhất: email trong `BOOTSTRAP_ADMIN_EMAIL`, và chỉ khi `staff_user` chưa có Admin nào. Ngoại lệ này cần vì script tạo Admin đầu tiên cũng đi qua hook.
- **Admin đầu tiên** được tạo một lần bằng script.
- **Mời nhân viên:**
  1. Admin nhập email và chọn vai trò.
  2. Server tạo token 32 byte, lưu hash SHA-256, đặt hạn 7 ngày, rồi gửi email tiếng Việt.
  3. Người được mời mở `/admin/accept-invite?token=…`, đặt tên và mật khẩu. Server gọi `auth.api.createUser`, đánh dấu lời mời đã dùng và đăng nhập luôn cho họ.
  4. Màn Nhân viên có nút **Thu hồi** và **Gửi lại**. Gửi lại tạo token mới và token cũ hết hiệu lực.
  5. Gửi email lỗi thì lời mời vẫn được tạo, lỗi ghi vào `email_error`, và màn hình báo "Chưa gửi được email, bấm Gửi lại".
- **Khóa các endpoint HTTP của plugin admin:**
  - Mọi request từ trình duyệt tới `/api/auth/admin/*` bị chặn bằng `hooks.before` trả 403. Ngày đầu của đợt 3 phải kiểm chứng rằng server vẫn gọi được `auth.api.*`.
  - Không cấp quyền `impersonate` cho vai trò nào.
  - Đổi vai trò, khóa, xóa tài khoản và đặt mật khẩu chỉ làm qua Server Action theo thứ tự: `requirePermission`, kiểm tra Admin cuối cùng, gọi `auth.api.*`, ghi audit.
- **Bảo vệ theo lớp:**
  - `proxy.ts` chỉ kiểm tra có cookie hay không.
  - Mỗi trang admin gọi `verifySession()`.
  - **Mọi Server Action và route handler của admin tự gọi `requirePermission()`**, kiểm tra đầu vào bằng zod, ghi audit trong cùng transaction, và chỉ trả dữ liệu tối thiểu.
  - Route handler của admin kiểm tra header `Origin`.
  - Một bài test CI quét mọi export `'use server'` và mọi route `/api/admin/*`, bắt buộc có `requirePermission`. Ngoại lệ là danh sách action công khai ghi cố định trong test; hiện chỉ có `submitReservation`, action này tự kiểm tra bằng zod, honeypot, BotID và giới hạn theo số điện thoại.
- **Ma trận quyền:**

| Quyền | Editor | Admin |
|---|---|---|
| Sửa nội dung, file, bản dịch; dùng AI | ✓ | ✓ |
| Xem lịch sử và khôi phục bản ghi nội dung (7.5) | ✓ | ✓ |
| Đặt bàn: xem, xử lý, tạo, ghi chú | ✓ | ✓ |
| Giờ phục vụ, sức chứa, ngày đóng cửa | ✓ | ✓ |
| Bật/tắt đặt bàn online của nhà hàng; ghi đè cửa sổ đặt trước, lead time, số khách tối đa | ✓ | ✓ |
| Tự động xác nhận (`auto_confirm`) theo nhà hàng | — | ✓ |
| Quản lý ngôn ngữ (thêm, bật/tắt, `serve_machine`) | — | ✓ |
| Cài đặt đặt bàn, thông báo, AI | — | ✓ |
| Nhân viên, lời mời, nhật ký toàn hệ thống | — | ✓ |
| Xóa dữ liệu test | — | ✓ |

- Không hạ quyền hoặc xóa được Admin cuối cùng.

### 7.2 Màn hình

```
/admin/sign-in · /admin/accept-invite · /admin/reset-password
/admin                         Tổng quan: đặt bàn chờ xử lý, bản dịch thiếu hoặc lỗi thời, email lỗi,
                               nhà hàng chưa có người nhận thông báo
/admin/reservations            Hộp thư (Cần xử lý · Hôm nay · Sắp tới · Tất cả); tìm theo mã, SĐT, tên, email
/admin/reservations/[id]       Chi tiết, chuyển trạng thái, sửa, ghi chú, dòng thời gian, email
/admin/reservations/new        Tạo đặt bàn qua điện thoại hoặc khách vãng lai (có chọn ngôn ngữ của khách)
/admin/reservations/day        Bảng theo ngày (in được cho quầy đón khách)
/admin/reservations/closures   Ngày đóng cửa, kèm danh sách đặt bàn bị ảnh hưởng
/admin/reservations/emails     Nhật ký email, gửi lại
/admin/restaurants             Danh sách nhà hàng
/admin/restaurants/[id]        Nội dung, trang chi tiết, điểm nổi bật, SEO, chữ section "Our Restaurants", lịch sử
/admin/restaurants/[id]/booking  Giờ phục vụ, sức chứa, ghi đè quy tắc (ô auto_confirm chỉ Admin thấy), xem trước slot
/admin/content/…               (xem bảng dưới)
/admin/media                   Thư viện ảnh và PDF
/admin/translations            Độ phủ bản dịch theo ngôn ngữ; hàng chờ duyệt (bản máy dịch, alt EN do AI viết);
                               job dịch hàng loạt (Tiếp tục / Hủy)
/admin/locales                 Ngôn ngữ (Admin)
/admin/settings/{ai,booking,notifications}   (Admin)
/admin/users · /admin/audit                  (Admin)
```

| Màn `content/…` | Sửa gì |
|---|---|
| `sections` | Bật/tắt section; ảnh và link của section |
| `hero` | Slide, chữ hero, thời gian tự chuyển slide; **film**: poster, URL YouTube/Vimeo, chữ `film.*` |
| `cuisines`, `destinations`, `experiences`, `heritage`, `stories`, `offers` | Danh sách và chữ của section tương ứng |
| `booking` | Chữ `booking.*`, `finder.*`; occasion mặc định; nhà hàng chọn sẵn |
| `navigation` | Menu điều hướng |
| `contact` | Email chung, mạng xã hội, chữ footer |
| `seo` | `seo.*`, ảnh chia sẻ |
| `legal` | Trang chính sách bảo mật, câu đồng ý ở form đặt bàn |
| `emails` | Tiêu đề và nội dung email theo từng loại và ngôn ngữ, xem trước với dữ liệu mẫu |
| `ui-text` | Các key `ui.*`, `form.*`, `error.*`, `search.*`, `common.*` còn lại |

Một bài test CI kiểm tra rằng mọi key, bảng và cột khách nhìn thấy đều có màn hình sửa (dựa vào `screen` trong registry).

### 7.3 Bộ form dùng chung

- `TranslatableField`: tab theo ngôn ngữ, nút "Dịch từ EN", trạng thái (máy dịch / đã duyệt / EN đã đổi), đếm ký tự so với giới hạn.
- `ImagePicker`: chọn file từ thư viện hoặc upload; sửa alt theo ngôn ngữ; đánh dấu ảnh trang trí.
- `SortableList`: kéo thả, bật/tắt hiển thị, ép số lượng tối thiểu và tối đa.
- `SaveBar`: báo xung đột khi người khác vừa sửa (so sánh `updated_at`).
- `HistoryPanel`: xem mục 7.5.
- Nút "Xem trên web".

**Tiếng Việt trong admin:**
- Form dùng `useActionState`; lỗi hiện ngay cạnh từng trường.
- Thông báo lỗi của zod dùng tiếng Việt (`z.config(z.locales.vi())`); các trường quan trọng có câu báo lỗi riêng.
- Lỗi của Better Auth (sai mật khẩu, tài khoản bị khóa, token hết hạn, thử quá nhiều lần) được ánh xạ theo `code` sang câu tiếng Việt.
- Ngày giờ hiển thị bằng `Intl` `vi-VN`, múi giờ `Asia/Ho_Chi_Minh`.
- Chữ còn lại viết thẳng bằng tiếng Việt trong component.

### 7.4 Luồng lưu

Mọi thao tác ghi **nội dung, cài đặt và nhân viên** đi theo thứ tự:

```
Server Action
  → requirePermission(perm)
  → zod.parse(input)
  → BEGIN
  → ghi dữ liệu
  → INSERT audit_log (before, after)
  → COMMIT
  → updateTag(các tag liên quan)
  → trả về { ok:true, data } hoặc { ok:false, code, fieldErrors? }   (mã admin: conflict, db_error, forbidden, invalid)
```

- Lưu bản dịch mà các biến `{placeholder}` hoặc ICU khác bản EN thì server từ chối.
- Thao tác trên **đặt bàn** ghi vào `reservation_events` **thay cho** `audit_log`, không ghi cả hai. View `audit_feed` gộp hai nguồn lại để hiển thị.

### 7.5 Lịch sử và khôi phục

Thay cho bước nháp (quyết định 7).

- Mỗi bản ghi nội dung đều có tab **Lịch sử**, lấy từ `audit_log` theo `(entity_type, entity_id)`: nhà hàng, các bảng danh sách, `sections`, `site_settings`, `content_strings`, `media_i18n`. Editor và Admin đều xem được.
- Bản chụp `before`/`after` của một mục danh sách chứa **hàng bảng chính và mọi hàng `*_i18n`**, nên mục đã xóa cũng khôi phục được. Khi sắp xếp lại thứ tự, toàn bộ thứ tự cũ được lưu.
- Nút **"Khôi phục phiên bản này"** chạy đúng luồng ở 7.4: `requirePermission` → zod → transaction → audit với `action='restore'` → `updateTag`. Có kiểm tra xung đột như khi lưu thường.
- Không áp dụng cho đặt bàn (đã có vòng đời trạng thái) và tài khoản nhân viên.

## 8. Đa ngôn ngữ

**Thêm ngôn ngữ (Admin):**
1. Chọn ngôn ngữ trong danh sách có sẵn: `code`, `bcp47`, tên gốc, nhãn ngắn. Chỉ ngôn ngữ có chữ viết nằm trong `SCRIPT_FONTS` mới chọn được. Ngôn ngữ mới thêm ở trạng thái tắt.
2. Xem độ phủ bản dịch ở `/admin/translations`. Nút "Dịch tất cả phần còn thiếu bằng AI" tạo một `ai_job`.
3. Xem trước bằng Draft Mode (mục 6.1).
4. Bật ngôn ngữ. Lúc này tag `locales` và `i18n:<code>` được làm mới, sitemap và hreflang cập nhật theo.

**Chữ viết và font:**
- Code khai sẵn bảng `SCRIPT_FONTS`:
  - Latin và tiếng Việt dùng font hiện tại.
  - `ko` dùng Noto Sans KR, `zh-hans` dùng Noto Sans SC, `ja` dùng Noto Sans JP. Ba font này được khai bằng `next/font` với `preload: false`, và layout chỉ gắn font của ngôn ngữ đang xem.
- Ngôn ngữ dùng chữ viết chưa có trong bảng (ví dụ tiếng Thái, chữ Kirin) cần dev thêm font và deploy. Đây là **giới hạn duy nhất** của "thêm ngôn ngữ không cần dev".
- Không hỗ trợ ngôn ngữ viết từ phải sang trái.

**Chuỗi giao diện khách:** registry trong code chứa bản EN mặc định. Key mới thêm trong code dùng được ngay, không cần seed.

**Hàng chờ duyệt:** gồm bản máy dịch, alt EN do AI viết, và bản dịch có "EN đã đổi".

**Kiểm tra trực quan:** chụp màn hình trang chủ và trang chi tiết ở EN và ở ngôn ngữ có chữ dài nhất, để bắt lỗi tràn chữ trong các khối cố định.

## 9. Vertex AI

### 9.1 Kết nối

- **Mặc định không có khóa GCP nào trong env hay DB.**
  - Vercel OIDC (issuer `https://oidc.vercel.com/<team>`) đổi lấy quyền qua GCP Workload Identity Federation, để dùng một service account có `roles/aiplatform.user`.
  - Principal Vercel của môi trường production và development được cấp `roles/iam.workloadIdentityUser` trên service account đó. Preview không được cấp.
  - Code dùng `ExternalAccountClient` với `getSubjectToken: () => getVercelOidcToken()`. Phải bọc thành hàm như vậy.
  - Env chỉ chứa các ID: project, project number, pool, provider, email service account.
- **Phương án dự phòng** khi tổ chức GCP không cho dùng WIF: đặt một khóa service account trong env. Không bao giờ lưu khóa trong DB.
- **Provider** được tạo theo từng request, dựa trên `ai_settings`:
  - `@ai-sdk/google-vertex` cho Gemini;
  - `@ai-sdk/google-vertex/anthropic` cho Claude.
- **Danh mục model** nằm trong code (`lib/server/ai/models.ts`). Mỗi model ghi: nhà cung cấp, region hỗ trợ (hiện là `global`, `us`, `eu`), có nhận ảnh không, có structured output không, giá.
- **Model mặc định:** `gemini-3.8-flash` ở region `global`.
  - Claude: chọn `claude-opus-5-5` hoặc `claude-sonnet-5-5`, và phải bật trong Model Garden trước.
  - Mọi lời gọi Claude đặt `providerOptions.anthropic.structuredOutputMode: 'outputFormat'`.

### 9.2 Trang cấu hình `/admin/settings/ai` (Admin)

**Cho từng tính năng** (dịch, trợ lý viết, SEO, alt ảnh):
- bật/tắt;
- model;
- region (chỉ hiện region mà model đó hỗ trợ);
- mức suy luận;
- số token tối đa;
- system prompt.

**Cài đặt chung:**
- Prompt giọng thương hiệu.
- Bảng thuật ngữ `ai_glossary`. Ví dụ: giữ nguyên "Tàya House", "Phố Cuốn"; đổi "Da Nang" thành "Đà Nẵng" khi dịch sang VI. Tên nhà hàng tự động được thêm vào bảng.
- Giới hạn số lượt theo người: mỗi phút và mỗi ngày.
- Ngân sách USD mỗi tháng.

**Thông tin chỉ đọc:** từng biến môi trường GCP đã có hay chưa (chỉ hiện có/không), và project ID.

**Nút "Kiểm tra kết nối"** là một Server Action, giới hạn 20 giây. Nó chạy **lần lượt cho từng cặp (model, region) đang bật** và kiểm tra:
1. Có đủ biến môi trường.
2. Lấy được access token.
3. Nhận được một câu trả lời văn bản ngắn.
4. Nhận được structured output.
5. (Tùy chọn) Mô tả được một ảnh.

Kết quả hiện theo từng tính năng, kèm độ trễ và số token. Lỗi được giải thích bằng tiếng Việt:

| Mã lỗi | Ý nghĩa |
|---|---|
| 401 / 403 | Thiếu quyền, hoặc model chưa được bật |
| 404 | Model không có ở region đã chọn |
| 429 | Hết quota |
| 400 | Tham số sai, hoặc bị chính sách của tổ chức GCP chặn |

Mỗi lần lưu cấu hình đều ghi audit và gọi `updateTag('ai-settings')`.

### 9.3 Tính năng

**Dịch** (`/api/admin/ai/translate`):
- Thuật ngữ được thay bằng ký hiệu `⟦G1⟧`, `⟦G2⟧`… trước khi gửi đi.
- Mỗi tài liệu dịch trong một lần gọi: `generateText` với `Output.object`, trả về `{items:[{id,text}]}`.
- Server kiểm tra đủ mọi id, ký hiệu thuật ngữ và biến ICU.
- Kết quả điền vào form. Người dùng bấm lưu thì ghi `reviewed`.

**Dịch hàng loạt:**
- Cron `/api/cron/ai-jobs` chạy mỗi 5 phút, chỉ ở Production, bảo vệ bằng `CRON_SECRET`. *(Ghi chú 2026-10-05: Neon đang ở gói Free; phase 9 phải xem lại nhịp này như cron outbox ở §10.4, ví dụ chỉ chạy khi có job hoặc chạy thưa hơn.)*
- Mỗi lần chạy lấy job `queued` hoặc `running` bằng `FOR UPDATE SKIP LOCKED`, rồi dịch tối đa 20 tài liệu.
- Kiểm tra ngân sách trước mỗi phần. Ghi kết quả với `status='machine'`. Cập nhật `progress`. Gọi `revalidateTag('i18n:<code>', 'max')`.
- Hết ngân sách hoặc Vertex lỗi thì chuyển sang `paused` và ghi `error`. Màn `/admin/translations` có nút Tiếp tục và Hủy.

**Trợ lý viết** (`/api/admin/ai/assist`):
- Trả về dạng stream: `streamText` → `createTextStreamResponse`, phía client dùng `useCompletion({ streamProtocol: 'text' })`.
- Có các thao tác: viết lại, rút gọn, gợi ý theo giọng thương hiệu.
- Đóng panel thì request bị hủy.

**SEO** (`/api/admin/ai/seo`):
- Sinh title (≤ 60 ký tự) và description (≤ 155 ký tự) cho từng trang, từng nhà hàng, từng ngôn ngữ.
- Chỉ là gợi ý; người dùng phải bấm lưu.

**Alt ảnh:**
- Sau khi `registerMedia`, `after()` thu nhỏ ảnh về khoảng 1024 px bằng `sharp` rồi gọi model mô tả.
- Kết quả lưu thành alt EN với `machine`, sau đó gọi `revalidateTag('media', 'max')`.
- Ảnh trang trí và PDF không sinh alt.

### 9.4 Rào chắn

- Lời gọi AI dài chạy trong route handler, không chạy trong Server Action.
- Giới hạn độ dài đầu vào và token đầu ra; `maxRetries: 1`; có timeout.
- **Trước** mỗi lời gọi:
  - kiểm tra ngân sách tháng (áp cho mọi lời gọi);
  - kiểm tra giới hạn theo người (chỉ áp cho lời gọi do người đó bấm: dịch từng trường, trợ lý viết, SEO).
- **Sau** mỗi lời gọi: ghi `ai_usage`.
- **Không bao giờ gửi dữ liệu cá nhân của khách cho Vertex.**
- Đặt cảnh báo ngân sách và quota phía GCP làm lớp chặn cuối.

## 10. Đặt bàn

### 10.1 Giờ phục vụ, sức chứa, ngày đóng cửa

**`resolveDay(restaurant, date)`** là hàm thuần, dùng chung cho API khách, Server Action và admin:
1. Lấy các `service_periods` đang `active` có `weekdays` chứa thứ của ngày đó.
2. Bỏ những phần bị đóng cửa. Lấy các `closures` có phạm vi khớp (`all`, điểm đến của nhà hàng, hoặc chính nhà hàng) và có ngày nằm trong `starts_on…ends_on`. `meals` NULL nghĩa là đóng cả ngày; nếu có `meals` thì chỉ bỏ các bữa đó.
3. Sinh slot từ `first_seating` đến `last_seating`, cách nhau `interval_min`. Sức chứa mỗi slot là `covers_per_slot`.
4. Một slot đặt được khi thỏa đủ các điều kiện:
   - còn ít nhất `lead_minutes` trước giờ ngồi;
   - nếu là hôm nay thì chưa qua `same_day_cutoff`;
   - `số khách đã đặt + số khách mới ≤ sức chứa`;
   - `số khách ≤ max_party`;
   - ngày nằm trong `[hôm nay, hôm nay + window_days − 1]`.

**Seed** nằm trong migration đặt bàn của đợt 4. Nó tạo ca phục vụ khớp đúng hành vi hiện tại: `SLOTS` chung × `restaurants.meals` × `slot_capacity`.

**Khi sửa giờ hoặc thêm ngày đóng cửa:**
- Admin liệt kê các đặt bàn tương lai bị ảnh hưởng và đề nghị "Hủy và báo khách" hàng loạt. **Không bao giờ tự hủy.**
- Lưu ca phục vụ thì gọi `updateTag('restaurants')` và `updateTag('booking-rules:<id>')`.

### 10.2 Luồng đặt bàn của khách

**Múi giờ:** `lib/venue-time.ts` chạy được cả ở client lẫn server, dựa trên `Intl` với `Asia/Ho_Chi_Minh`, gồm `venueNow`, `addDays`, `isoWeekday`, `minutesUntil`, `formatDay`. Đây là phần **sửa lỗi múi giờ**.

**API, không cache:**
- `GET /api/availability?restaurant=&from=&to=&lang=` trả `{today, nowMinutes, maxParty, days:[{date, state, reason?}]}`.
- `GET /api/availability?restaurant=&date=&guests=&lang=` trả các ca và slot, kèm số chỗ còn lại.
- Ghi chú (đợt 1): `/api/availability` hiện trả `now` là một thời điểm ISO (client suy ra độ lệch đồng hồ từ đó) thay vì `nowMinutes`.

**Phía client:**
- Lấy "hôm nay" từ server.
- Khi SSR, nhãn ngày hiển thị placeholder. Việc này sửa lỗi hydration #418.

**`submitReservation`** nhận `{restaurant, date (ISO), time, guests, name, phone, email, note, locale, consent, honeypot}`. `offerId` bổ sung từ đợt 6.
1. Kiểm tra BotID và honeypot.
2. Kiểm tra dữ liệu bằng zod.
3. Kiểm tra ngày, cửa sổ đặt trước, lead time và số khách theo đồng hồ server ở giờ Việt Nam.
4. Chuẩn hóa số điện thoại về E.164.
5. Kiểm tra tối đa 3 yêu cầu đang hoạt động cho mỗi số điện thoại mỗi ngày.
6. Mở **một transaction**:
   - `pg_advisory_xact_lock(hash(restaurant, date))`;
   - tính lại `resolveDay` và sức chứa;
   - INSERT đặt bàn;
   - INSERT sự kiện `created`;
   - INSERT các hàng outbox.
7. COMMIT, sau đó `after(() => drainOutbox(ids))`.

**Mã tham chiếu:**
- Dạng `FC-` + 8 ký tự Crockford base32, sinh bằng `node:crypto`.
- Nếu trùng ràng buộc `reservations_reference_key` thì sinh lại, tối đa 3 lần. Phân biệt với lỗi trùng đặt bàn qua `err.constraint`.
- Ô tìm kiếm vẫn nhận mã cũ dạng `FC-12345`.

**Mã lỗi.** Mỗi mã có key `error.<code>` trong registry.

| Mã | Ý nghĩa |
|---|---|
| `full` | Hết chỗ |
| `closed` | Đóng cửa |
| `past` | Giờ đã qua |
| `outside_window` | Ngoài cửa sổ đặt trước |
| `slot_unavailable` | Giờ đó không có trong ca của ngày |
| `duplicate` | Trùng đặt bàn |
| `invalid_name`, `invalid_phone`, `invalid_email` | Dữ liệu không hợp lệ |
| `consent_required` | Chưa đồng ý chính sách |
| `party_too_large` | Quá số khách; kèm số điện thoại nhà hàng để đặt nhóm lớn |
| `restaurant_unavailable` | Nhà hàng không nhận đặt bàn online |
| `too_many_requests` | Quá giới hạn theo số điện thoại |
| `bot_blocked` | Bị chặn vì nghi là bot |
| `unknown` | Lỗi khác |
| `network` | Lỗi mạng (chỉ phía client) |

### 10.3 Vòng đời trạng thái

| Chuyển trạng thái | Ai | Email khách (theo template) |
|---|---|---|
| (mới, khách đặt trên web) → `requested`; → `confirmed` nếu `auto_confirm` | khách | `guest.ack` nếu là requested (khi có email và `guest_ack_email` bật); `guest.confirmed` nếu được tự xác nhận |
| (mới, nhân viên tạo) → `confirmed` (đặt qua điện thoại) hoặc `seated` (khách vãng lai) | Editor/Admin | `guest.confirmed` nếu có email và tick "Gửi email xác nhận" |
| `requested` → `confirmed` | Editor/Admin | `guest.confirmed` |
| `requested` → `declined` | Editor/Admin | `guest.declined`, kèm lý do |
| `requested`/`confirmed` → `cancelled` | Editor/Admin | `guest.cancelled` nếu tick "Báo khách" (mặc định có) |
| `confirmed` → `seated` (Đã đến) | Editor/Admin | — (chỉ từ 60 phút trước giờ ngồi) |
| `confirmed` → `no_show` | Editor/Admin | — (chỉ sau giờ ngồi 15 phút) |
| `no_show` → `seated`, `seated` → `confirmed` (sửa bấm nhầm) | Editor/Admin | — (chỉ trong cùng ngày phục vụ) |

- Các chuyển trạng thái nằm trong một map TypeScript duy nhất.
- Mỗi lần chuyển chạy `UPDATE … WHERE id=$1 AND version=$2 AND status = ANY($from)`, cùng với sự kiện và outbox, trong một transaction. Nếu không có hàng nào được cập nhật thì báo "Vừa được {người} thay đổi, tải lại".
- Các trạng thái đang giữ chỗ: `requested`, `confirmed`, `seated`.
- Đặt bàn do nhân viên tạo được phép vượt sức chứa (`over_capacity`) nếu ghi lý do.

### 10.4 Email

**SMTP** (thay Resend theo quyết định của chủ dự án ngày 2026-10-02). Gửi qua máy chủ SMTP truyền thống bằng nodemailer, cổng 587 (bắt buộc STARTTLS) hoặc 465 (TLS), từ `EMAIL_FROM`. Thông số nằm trong `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, đọc lúc gửi.

**Sự kiện và template:** một bộ tên duy nhất, dùng cho `email_outbox.event`, `notification_recipients.events[]` và key nội dung.

| Sự kiện | Người nhận | Ngôn ngữ |
|---|---|---|
| `staff.new` | nhân viên trong `notification_recipients`: gộp các phạm vi nhà hàng, điểm đến và `all`, bỏ trùng. **Không có ai khớp thì gửi về `site_settings.email`** và màn Tổng quan cảnh báo. | của người nhận (mặc định VI) |
| `guest.ack` | khách | của khách |
| `guest.confirmed` | khách | của khách |
| `guest.declined` | khách | của khách |
| `guest.cancelled` | khách | của khách |

**Nội dung email:**
- Template viết bằng React Email.
- Chữ lấy từ key `email.<sự kiện>.<trường>`, ví dụ `email.guest.confirmed.subject`.
- Đợt 5: chữ lấy từ registry trong code (có sẵn bản EN và VI).
- Từ đợt 7: sửa được trong `/admin/content/emails`, lưu vào `content_strings`.

**Outbox:**
- Các hàng outbox được ghi **trong cùng transaction** với đặt bàn hoặc lần chuyển trạng thái. Mỗi người nhận là một hàng riêng.
- Idempotency key là `outbox:{id}` (UNIQUE). SMTP không có idempotency key, nên email được gửi **ít nhất một lần**: bộ gửi giữ hàng bằng lease trước khi gửi và đánh dấu `sent` ngay sau đó; mọi lần gửi của một hàng dùng cùng Message-ID `<outbox-{id}.{12 ký tự hex}@{tên miền gửi}>`. Nếu tiến trình chết giữa lúc máy chủ SMTP nhận thư và lúc đánh dấu, người nhận có thể nhận hai bản giống hệt.
- Bộ gửi lấy hàng bằng `FOR UPDATE SKIP LOCKED` và đọc lại đặt bàn trước khi gửi. Nếu sự kiện không còn khớp trạng thái thì đánh dấu `skipped`.
- Gửi lần đầu ngay sau commit. Lỗi thì thử lại sau 1 phút, 5 phút, 15 phút, 1 giờ, 6 giờ, 12 giờ, tức tối đa 7 lần gửi. Mọi lần gửi nằm trong khoảng 19,4 giờ. Hết số lần thì đánh dấu `failed` và hiện trên Tổng quan.
- Một mốc thử lại đến hạn giữa hai lần chạy cron được xử lý ở lần chạy cron kế tiếp (chậm tối đa 1 giờ), hoặc sớm hơn nếu `after()` của một thao tác khác chạy bộ gửi.

**Kích hoạt bộ gửi:**
- `after()` sau mỗi lần ghi.
- Cron `/api/cron/outbox` mỗi giờ (`0 * * * *`), bảo vệ bằng `CRON_SECRET`. *(Sửa 2026-10-05: Neon ở gói Free tự tắt compute sau 5 phút không dùng; cron 5 phút sẽ giữ DB chạy suốt ngày đêm và vượt hạn mức. Nếu nâng lên Launch có thể quay lại 5 phút.)*
- Nút "Gửi lại" trong admin.
- Nút **"Gửi email thử"** ở `/admin/settings/notifications`.

**Cổng môi trường:**

| `EMAIL_DELIVERY` | Hành vi |
|---|---|
| `live` | Gửi thật. Chỉ đặt ở Production. |
| `redirect` | Preview và Dev: mọi email gửi tới `EMAIL_REDIRECT_TO`. |
| `log` | Mặc định khi không đặt; dùng cho CI và máy dev. |

- Cổng này áp cho **cả email mời và đặt lại mật khẩu**. Hai loại email này đi thẳng qua SMTP, không qua outbox.
- Cột `env` lấy từ `VERCEL_ENV`; không có thì là `development`. Bộ gửi chỉ gửi những hàng có `env` trùng với môi trường của nó.

## 11. Bảo mật và dữ liệu cá nhân

- **Chung:** làm theo `node_modules/next/dist/docs/01-app/02-guides/authentication.md` và `data-security.md`. Có DAL, dùng `server-only`, mỗi action tự kiểm tra quyền, DTO chỉ chứa dữ liệu tối thiểu.
- **Admin render động và CSP có nonce:**
  - `cacheComponents` bật prerender cho mọi route, mà CSP nonce lại không dùng được với static shell.
  - Vì vậy `app/admin/layout.tsx` đặt `export const instant = false` và gọi `await connection()` ngay đầu layout, trước khi render `<html>`. Mọi trang admin render hoàn toàn lúc request và nhận nonce do `proxy.ts` tạo.
  - Kèm theo: `noindex`, `X-Frame-Options: DENY`.
- **Web khách:**
  - CSP tĩnh trong `next.config.ts` (`headers()`), áp cho mọi đường dẫn **trừ `/admin`**, để trang vẫn cache được.
  - `script-src 'self' 'unsafe-inline'` (cho script inline của Next và `MOTION_BOOTSTRAP`).
  - `img-src` có host của Blob store.
  - `frame-src` có `www.youtube-nocookie.com` và `player.vimeo.com`.
- **Upload:**
  - Trình duyệt dùng `uploadPresigned`. Route `/api/admin/media/upload` dùng `handleUploadPresigned` và chỉ cấp token sau khi kiểm tra phiên đăng nhập và quyền.
  - Upload xong, client gọi Server Action `registerMedia` (upsert theo `pathname`, ghi audit) để tạo hàng `media`. `onUploadCompleted` chỉ là dự phòng, vì nó không chạy trên localhost và trên preview có Deployment Protection.
  - Chỉ nhận jpeg/png/webp/avif/pdf, tối đa 15 MB.
  - Đặt `experimental.serverActions.bodySizeLimit: '2mb'`.
- **Môi trường:**
  - Dev dùng branch Neon riêng; mỗi preview có một branch riêng; Production dùng branch mặc định.
  - Blob store tách riêng cho Production và cho Preview/Dev.
- **Dữ liệu cá nhân** (Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15, hiệu lực từ 2026-01-01; cần luật sư xác nhận):
  - Form đặt bàn có thông báo bảo mật, ô đồng ý và trang chính sách (`legal.*`).
  - Cron `/api/cron/daily` ẩn danh các đặt bàn có `reserved_on` cũ hơn `pii_retention_months`, mỗi lô một transaction:
    - `reservations`: `guest_name='—'`; đặt NULL cho `phone`, `phone_e164`, `email`, `note`, `search_text`; ghi `anonymized_at=now()`;
    - xóa `reservation_notes` của các đặt bàn đó;
    - thay `email_outbox.to_email` bằng giá trị ẩn;
    - xóa các khóa chứa dữ liệu cá nhân trong `reservation_events.changes`.
  - Giữ lại ngày, giờ, số khách, nhà hàng và trạng thái để làm thống kê.
  - Lưu ý: migration 003 đã đặt `reservations.phone_e164` là NOT NULL, nên job ẩn danh ở đợt 10 phải chạy `ALTER … DROP NOT NULL` (hoặc ghi một giá trị thay thế) trước khi đặt cột này về NULL.
  - Dữ liệu test hiện có được đánh dấu `is_test`. Admin xóa chúng trước khi ra mắt.

## 12. Xử lý lỗi

| Tình huống | Hành vi |
|---|---|
| DB lỗi khi khách xem trang | Trang đã prerender hoặc đã cache vẫn được phục vụ. Các trường hợp phải render lúc request (bot hoặc crawler, trang vừa `updateTag`, URL chưa render lần nào, cache trong bộ nhớ đã mất) sẽ hiện `error.tsx`: trang lỗi thân thiện kèm số điện thoại đặt bàn. Riêng đặt bàn báo `error.network` kèm số điện thoại nhà hàng. Ghi chú (đợt 6, đo trên Next 16.3.7): `error.tsx` chỉ hiện ở route render có stream. Một trang tĩnh vừa bị `updateTag` làm hết hạn mà render lại lúc DB lỗi trả 500 dạng chữ thường (`/en`, `/en/privacy`), còn trang chi tiết stream `error.tsx` nhưng không kết thúc response. Cửa sổ này cần DB hỏng giữa một lần lưu và lần ghé đầu tiên vào trang đó, và tự lành khi DB về. Đợt 10 làm ấm các trang bị ảnh hưởng trong `after()` sau commit và đặt `maxDuration` cho trang chi tiết; preview đầu tiên kiểm hành vi này trên Vercel. |
| DB lỗi khi admin lưu | Transaction rollback. Form giữ nguyên dữ liệu đang nhập. Báo `db_error` bằng tiếng Việt. Không làm mới cache. |
| Hai người sửa cùng lúc | So `updated_at` (nội dung) hoặc `version` (đặt bàn). Người lưu sau thấy báo `conflict` và nút tải lại. |
| Gửi email lỗi | Đặt bàn vẫn thành công. Outbox tự thử lại. Tổng quan hiện số email lỗi. |
| Vertex lỗi | Form vẫn dùng được. Nút AI báo lỗi tiếng Việt theo mã (mục 9.2). Job dịch hàng loạt chuyển sang `paused`. |
| Vượt ngân sách AI | Từ chối ngay trước khi gọi, báo "Đã hết ngân sách AI tháng này". |
| Upload lỗi | Không tạo hàng `media`. Cron `media-sweep` xóa blob không có hàng `media` sau 24 giờ, chỉ trong store của môi trường đó. |
| Cron thiếu `CRON_SECRET` | Trả 401. |
| Ghi log | Lỗi server ghi `console.error` kèm mã lỗi, xem được trong Vercel Logs. Không ghi dữ liệu cá nhân. |

## 13. Kiểm thử

| Lớp | Nội dung |
|---|---|
| Unit (Vitest) | `venue-time` (server ở UTC, lúc 23:59, 00:01, 06:59 giờ VN); `resolveDay` (ca, ngày đóng cửa, biên cửa sổ 14 ngày); bảng chuyển trạng thái; chuẩn hóa mã tham chiếu và số điện thoại; ICU; che thuật ngữ và kiểm tra biến; zod cho cấu hình AI và quy tắc model/region; quy tắc chọn bản dịch hiển thị; regex matcher của proxy (`unstable_doesMiddlewareMatch` từ `next/experimental/testing/server`, vì Next 16.3.7 chưa có `unstable_doesProxyMatch`) |
| Tích hợp DB (Postgres 18 trong CI; advisory lock kiểm một lần trên branch Neon qua URL pooled) | Migration chạy được trên bản sao dữ liệu; đặt bàn song song không vượt sức chứa; chặn trùng; outbox gửi ít nhất một lần và không gửi trùng khi hai bộ gửi chạy song song; cổng môi trường; audit ghi cùng transaction; khôi phục từ nhật ký (sửa, xóa, sắp xếp); ẩn danh xong không bảng nào còn tên, SĐT hay email của đặt bàn quá hạn; media-sweep chỉ xóa blob mồ côi đúng môi trường; job dịch chia phần, dừng khi hết ngân sách và chạy tiếp được |
| E2E (Playwright) | Đặt bàn bằng EN và VI; chuyển ngôn ngữ; ngày đóng cửa; đổi giờ ca thì slot của khách đổi theo; ma trận quyền (Editor bị chặn ở `/admin/settings` **và** khi POST thẳng vào action chỉ dành cho Admin; chưa đăng nhập bị từ chối; `POST /api/auth/admin/set-role` từ trình duyệt bị từ chối); không hạ quyền được Admin cuối cùng; token mời dùng lại hoặc hết hạn; sửa nội dung thì web khách hiện thay đổi; ưu đãi quá `valid_until` biến mất (giả lập đồng hồ); thêm `ko` → dịch → duyệt → bật thì `/ko` hoạt động, sitemap có hreflang, không cần deploy; xác nhận đặt bàn tạo email (`EMAIL_DELIVERY=log`); nhà hàng chưa có người nhận vẫn gửi email về hộp thư chung; cron trả 401 khi thiếu secret |
| AI | CI dùng phản hồi ghi sẵn; một bộ nhỏ gọi Vertex thật khi cần |
| Trực quan | Chụp màn hình trang chủ và trang chi tiết ở EN và ở ngôn ngữ dài nhất, trên mobile và desktop |
| Bảo vệ | Mọi export `'use server'` (trừ danh sách action công khai) và mọi route `/api/admin/*` đều gọi `requirePermission`; mọi chữ khách nhìn thấy đều nằm trong registry hoặc bảng nội dung; mọi key đều có màn hình sửa |

**CI trên GitHub Actions:**
- Chạy: typecheck, lint, unit, tích hợp, E2E, build.
- Lint dùng oxlint, không dùng ESLint (`next lint` đã bị bỏ ở Next 16), vì typescript-eslint chỉ hỗ trợ TypeScript < 6.1 mà dự án dùng TypeScript 7.
- Từ khi web khách đọc dữ liệu từ DB, `next build` cũng truy vấn DB. Vì vậy trong CI, bước build chạy sau `db:migrate` và seed trên Postgres của CI. Build trên Vercel đọc branch Neon của đúng môi trường.

## 14. Lộ trình

### 14.1 Mười một đợt bắt buộc

Ước lượng tính theo ngày công của một dev, sai số ±25%, đã gồm công làm admin bằng tiếng Việt.

| # | Đợt | Bàn giao | Nghiệm thu | Ngày công |
|---|---|---|---|---|
| 0 | Môi trường an toàn | Branch Neon `dev` và branch cho từng preview; `.env.local` trỏ sang `dev`; tắt đăng ký Neon Auth; Vitest, Playwright, oxlint (không dùng ESLint vì typescript-eslint chỉ hỗ trợ TypeScript < 6.1, còn dự án dùng TypeScript 7); CI trên GitHub Actions; sửa `npm run lint` | CI xanh; môi trường dev không còn dùng DB production | 1–2 |
| 1 | Sửa lỗi đặt bàn và giao diện | `venue-time`; ngày ISO giữa client và server; "hôm nay" do server cấp; cutoff đúng; mã tham chiếu mới có thử lại; `phone_e164` và index chặn trùng mới; mã lỗi; ngày render sau khi mount; `IntroTrigger` | Test giờ VN 00:00–07:00 lưu đúng ngày; hero hiện lại sau khi chuyển trang; hết lỗi hydration | 4–5 |
| 2 | Tái cấu trúc web khách | `app/(site)/[lang]` (chỉ `en`); `proxy.ts`; chuyển `app/taya-house` thành `restaurants/[slug]` (tạm dùng hằng) và chuyển hướng `/taya-house`; `global-not-found`, `error.tsx`; Cache Components và Partial Prefetching; bảng `locales`, `content_strings`, `destinations`; khung lớp đọc dữ liệu và registry; slug cho ẩm thực và bữa ăn; bỏ code viết riêng cho Tàya; hero và chấm hành trình tính theo số lượng; `ViewMarker`; truy vấn DOM theo trang | `/en` giống hệt trang hiện tại (so ảnh chụp màn hình); `/taya-house` chuyển hướng đúng; build xanh | 6–8 |
| 3 | Đăng nhập và khung admin | Better Auth, vai trò, mời (thu hồi, gửi lại), đặt lại mật khẩu, khóa endpoint plugin admin, `audit_log`, màn nhân viên, layout admin tiếng Việt (render động, CSP nonce), Resend cho email đăng nhập (từ đợt 5: SMTP) | Mời → nhận → đăng nhập; Editor bị chặn khỏi khu vực Admin; đổi vai trò tạo đúng một dòng audit với đúng người thực hiện; gọi thẳng `/api/auth/admin/*` từ trình duyệt bị từ chối | 7–9 |
| 4 | Đặt bàn v2 | Migration đặt bàn; ca phục vụ, ngày đóng cửa, quy tắc đặt bàn; engine availability và API; form khách dùng slot từ server và hiện ngày đóng cửa; vòng đời trạng thái; màn hộp thư, chi tiết, tạo mới, theo ngày, ngày đóng cửa; màn **Giờ và sức chứa** `/admin/restaurants/[id]/booking`; màn **Cài đặt đặt bàn** | Đặt bàn song song không vượt sức chứa; ngày đóng cửa hiện xám cho khách; xác nhận, hủy, no-show chạy đúng; Editor đổi giờ ca tối và sức chứa thì khách thấy slot mới ngay; đặt `max_party` = 8 thì form chặn 9 khách; liệt kê đúng các đặt bàn bị ảnh hưởng | 9–11 |
| 5 | Email và chống spam → **mốc ra mắt A (bản EN)** | Outbox; template EN/VI (chữ lấy từ registry); gửi sau commit; cron; người nhận và "Gửi email thử"; nhật ký email; cổng môi trường; trang chính sách và ô đồng ý; honeypot, giới hạn theo số điện thoại, BotID | Có đặt bàn mới thì nhân viên nhận email; xác nhận thì khách nhận email; email lỗi được gửi lại; không có người nhận thì gửi về email chung; bot bị chặn | 5–7 |
| 6 | Chuyển nội dung vào DB | Toàn bộ bảng nội dung và bản dịch; `sections`, `site_settings`, `media` (trỏ tới `/assets`); seed từ `lib/data.ts`; web khách đọc từ DB; trang chi tiết đọc từ DB và mở cho mọi nhà hàng bật `has_detail_page`; khóa ngoại `reservations.offer_id`; form đặt bàn gửi `offerId` | Web giống hệt bản trước (so ảnh chụp màn hình); bật `has_detail_page` cho một nhà hàng khác thì trang chạy | 8–10 |
| 7 | Trình soạn nội dung và thư viện | Bộ form dùng chung; trình soạn cho mọi màn ở 7.2; sắp xếp, ẩn hiện, giới hạn bố cục; SEO; chữ giao diện; nội dung email; trang chính sách; upload ảnh và PDF; nhúng film; chuyển ảnh cũ lên Blob; cron dọn file; **Lịch sử và khôi phục** | Đi hết checklist sinh từ `content-inventory.md` mục 2.1–2.19: mỗi mục (trừ chữ thương hiệu bị khóa) sửa bằng EN trong admin và hiện trên web trong vài giây; test CI không tìm thấy chữ khách nhìn thấy nằm ngoài registry hoặc DB; không xóa được file đang dùng; sửa rồi xóa một ưu đãi, khôi phục được cả hai lần | 13–16 |
| 8 | Đa ngôn ngữ | Quản lý ngôn ngữ; `SCRIPT_FONTS`; nút chuyển ngôn ngữ; hreflang và sitemap; tab ngôn ngữ trong mọi form; độ phủ bản dịch và hàng chờ duyệt; Draft Mode để xem trước; email theo ngôn ngữ của khách; tìm kiếm khớp bản dịch | Thêm `ko` không cần deploy; `/vi` hiện bản đã duyệt và lấy EN cho chỗ thiếu | 8–10 |
| 9 | Vertex AI | WIF; danh mục model; **trang cấu hình AI**; kiểm tra kết nối; dịch từng trường và dịch hàng loạt (cron `ai-jobs`, có thuật ngữ); trợ lý viết dạng stream; SEO; alt ảnh; sổ chi phí và ngân sách | Kiểm tra kết nối xanh với Gemini; dịch giữ nguyên tên riêng và biến; vượt ngân sách bị chặn; job tạm dừng rồi chạy tiếp được | 9–11 |
| 10 | Gia cố → **mốc ra mắt B (đầy đủ)** | CSP web khách; cron ẩn danh dữ liệu; migration thu gọn (bỏ `restaurants.slot_capacity`, `type`, `destination`, `cuisines`, `meals`, hằng `SLOTS` và các hằng nội dung trong `lib/data.ts`); xóa dữ liệu test; runbook và hướng dẫn cho nhân viên | Kiểm tra bảo mật; đi hết checklist ra mắt | 3–4 |
| | **Tổng** | | | **≈ 73–93** (riêng tới mốc A, sau đợt 5: ≈ 32–42) |

**Thứ tự phụ thuộc:** 0 → 1 → 2 → 3 → (4 → 5) và (6 → 7 → 8 → 9) → 10. Bảng dùng chung (`locales`, `content_strings`, `destinations`) có từ đợt 2, nên sau đợt 3 nhánh đặt bàn và nhánh nội dung làm song song được.

Với 1 dev, thời gian thực tế khoảng 4–4,5 tháng. Với 2 dev làm song song sau đợt 3, khoảng 2,5–3 tháng.

### 14.2 Tùy chọn sau mốc B (không nằm trong ước lượng)

- Lịch tháng có % lấp đầy.
- Ghi đè sức chứa cho từng slot.
- Trần số khách cho cả ca.
- Ca phục vụ theo mùa.
- Đóng cửa một phần (giảm % sức chứa).
- Admin đặt lại đặt bàn đã hủy hoặc bị từ chối.
- Điểm lấy nét cho ảnh.
- Xuất CSV đặt bàn.

## 15. Việc cần bạn làm hoặc cung cấp

**Ngay bây giờ**
1. Neon Console → branch production → Auth: **tắt đăng ký**. Hiện ai có URL cũng tạo được tài khoản.
2. Nâng Vercel lên **Pro** (đã xong ngày 2026-10-02).
3. Cho biết **domain production** và **email của Admin đầu tiên**.

**Trước đợt 3 (email)**

4. Cung cấp tài khoản SMTP (host, cổng 587 hoặc 465, tên đăng nhập, mật khẩu hoặc app password) và địa chỉ gửi `EMAIL_FROM` mà tài khoản đó được phép gửi. Đặt chúng làm biến môi trường trên Vercel, không gửi qua chat và không commit.
5. IT Furama cấu hình SPF, DKIM, DMARC cho tên miền gửi tại nhà cung cấp mail (DMARC bắt đầu `p=none`; kiểm trước xem domain gốc đã có DMARC chưa).

**Trước đợt 9 (Google Cloud)**

6. Tạo một GCP project có bật billing, và cho biết project có nằm trong một Organization không.
7. Bật các API: Vertex AI, IAM Service Account Credentials, Security Token Service.
8. Tạo service account có `roles/aiplatform.user`. Cấp `roles/iam.workloadIdentityUser` trên service account đó cho principal Vercel của production và development.
9. Tạo Workload Identity pool và provider OIDC cho Vercel. Lệnh cụ thể sẽ có trong kế hoạch đợt 9.
10. Nếu dùng Claude: bật model trong Model Garden, và cho phép `structured_outputs` trong org policy.
11. Đặt cảnh báo ngân sách trên GCP.

**Nội dung**

12. Ảnh gốc độ phân giải cao. Khoảng 17 ảnh hiện chỉ là thumbnail.
13. PDF menu theo từng ngôn ngữ.
14. Xác nhận handle TikTok `@furama.dining.hous` và số điện thoại của Dining House.
15. Danh sách email nhận thông báo đặt bàn theo nhà hàng hoặc điểm đến.
16. Link đích cho 3 mục Experiences, và video YouTube/Vimeo cho phần film. Nếu chưa có thì chọn ẩn.
17. Nội dung trang chi tiết cho 11 nhà hàng còn lại: ảnh dọc tỉ lệ 4:5, kicker, câu chuyện tiếng Anh, 2–5 điểm nổi bật có ảnh, PDF menu nếu có. Nhà hàng chưa đủ nội dung thì để `has_detail_page` tắt; khi đó thẻ nhà hàng mở form đặt bàn như hiện nay.

## 16. Rủi ro và điểm chưa kiểm chứng

| Rủi ro / điểm chưa chắc | Cách xử lý |
|---|---|
| Kiểu dữ liệu của Better Auth và AI SDK 7 khi chạy với TypeScript 7 chưa được kiểm tra | Thử ngay ngày đầu của đợt 3 và đợt 9 |
| `hooks.before` có chặn được `/api/auth/admin/*` mà không chặn `auth.api.*` phía server hay không | Kiểm chứng ngày đầu đợt 3. Phương án dự phòng: chặn đường dẫn này trong route `/api/auth/[...all]` |
| Advisory lock qua URL pooled của Neon chưa được kiểm tra | Viết test tích hợp ở đợt 4. Dự phòng: dùng `SELECT … FOR UPDATE` trên một hàng khóa theo `(restaurant, date)` |
| Cache Components và Partial Prefetching (App Shell cho URL mới) | Kiểm chứng ở đợt 2; nếu không ổn thì dùng phương án dự phòng ở 6.2 |
| Vercel Functions chưa chắc ra được cổng 587/465 của nhà cung cấp SMTP | Kiểm bằng "Gửi email thử" ở preview đầu tiên; dự phòng: đổi 587↔465 hoặc đổi nhà cung cấp |
| Bố cục cố định có thể tràn chữ sau khi dịch | Giới hạn độ dài, cảnh báo, kiểm tra bằng ảnh chụp màn hình |
| Đây là phương án nhiều code nhất | Chia nhỏ thành từng đợt, mỗi đợt có test và nghiệm thu; phần không bắt buộc để ở 14.2 |
| Repo GitHub đang để **public** | Spec và code không chứa bí mật; nên cân nhắc chuyển repo sang private |
