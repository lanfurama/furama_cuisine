# Kiến trúc Furama Dining World

> Modular monolith gọn cho một app Next.js (App Router, Cache Components) trên Vercel + Neon free tier.
> Mọi code mới PHẢI theo tài liệu này. Luật nào có guard test thì CI chặn — xem mục 6.

---

## 0. Triết lý

1. **Chia theo domain.** Mỗi thư mục trong `lib/server/` là một module. `app/` chỉ ghép các module lại.
2. **Phụ thuộc một chiều.** Không module nào import vòng về module khác. Module dưới cần việc của module trên → module trên được *truyền vào* (port/effects), không import ngược.
3. **Một DB, một schema, SQL tay.** `pg` + SQL viết thẳng, không ORM. JOIN giữa các bảng của module khác nhau là được phép — một DB nhỏ, một team.
4. **Ghi an toàn:** một transaction, kèm dòng `audit_log`, kiểm tra token đồng thời. Email ghi vào outbox trong cùng transaction, gửi sau COMMIT.
5. **Mỗi I/O ra ngoài có đúng một cổng** (DB, SMTP, Blob, BotID) — đổi nhà cung cấp chỉ sửa một chỗ.
6. **Đơn giản trước.** Không thêm tầng (contract, entity, event bus, schema riêng…) khi chưa có nhu cầu thật — xem mục 7.

---

## 1. Cấu trúc thư mục

```
app/                     # Next.js routes: trang, Server Actions, route handlers — tầng ghép
  (site)/[lang]/         #   site khách
  admin/                 #   CMS cho staff
    (shell)/_ui/         #     UI dùng chung của các trang admin: PageHeader, Icon, FormMessage, AffectedList
    (shell)/_kit/        #     bộ form sửa nội dung (ô nhiều ngôn ngữ, chọn ảnh, danh sách sắp xếp, History, thanh lưu…)
  api/                   #   auth, cron (outbox, daily, media-sweep), preview, admin upload
  actions.ts             #   submitReservation
components/              # React UI của site khách
styles/                  # CSS: base/overlays… (site khách); admin.css = design system của admin (token --a-*; CSP không cho style="")
lib/                     # Code thuần, dùng được cả client lẫn server (không DB, không I/O)
  booking/ i18n/ content/ admin/ media/ reservations/ email/ …
lib/server/              # Code chỉ chạy server ('server-only')
  *.ts                   #   kernel: audit, conflict, action-result, ai-error, reference, client-ip, cron, draft-mode, audit-feed
  <module>/              #   một module (mục 2)
db/
  client.ts              # pool Postgres duy nhất (getPool) + kiểu Db
  migrations/NNN_*.sql   # migration đánh số, chạy theo thứ tự
  checks/                # preflight/postcheck SQL cho từng migration trên Neon
  content-packs/*.json   # gói nội dung đã duyệt (ảnh, chữ) — scripts/apply-content-pack.mjs áp dụng, chỉ thay chỗ còn là seed
test/                    # integration, guards (luật kiến trúc), helpers, fixtures
e2e/                     # Playwright
```

Test unit nằm cạnh code (`foo.ts` + `foo.test.ts`). Test cần DB nằm ở `test/integration/`.

---

## 2. Các module trong `lib/server/`

| Module | Trách nhiệm | Được phụ thuộc vào |
|---|---|---|
| *kernel* (`lib/server/*.ts`) | transaction + audit (`audit.ts`), token đồng thời (`conflict.ts`), kết quả Server Action + `PermissionError` (`action-result.ts`), mã đặt bàn, IP, cron auth | — (không import module nào) |
| `history` | snapshot item + i18n, ghi/khôi phục, đọc History từ `audit_log` | kernel |
| `content` | đọc nội dung cho site khách (`*.queries.ts`), locale, SEO, legal, preview | history, kernel |
| `media` | thư viện ảnh/PDF, Blob (`blob.ts`), đo ảnh, dọn rác | history, kernel |
| `booking` | luật đặt bàn, tạo đặt bàn, vòng đời reservation, cấu hình giờ/đóng cửa | content, history, kernel |
| `email` | outbox, render, gửi SMTP (`send.ts`), người nhận | booking, content, kernel |
| `auth` | Better Auth, staff, quyền, email mời / đặt lại mật khẩu | email, kernel |
| `dal` | phiên đăng nhập, `requirePermission`, `auditActor` | auth, kernel |
| `ai` | Vertex AI (phase 9): dịch máy, glossary, cấu hình + ngân sách, chặn route AI, bảng `ai_jobs` (tạo, claim, lease, tạm dừng/tiếp tục/hủy). Nhận chữ/byte đã gom sẵn, không tự đọc bảng nội dung | dal, kernel |
| `content-admin` | các màn sửa nội dung của CMS; phía CMS của AI: gom nội dung gửi model và ghi bản máy dịch (`machine-translations.ts`: chỗ còn thiếu, vòng chạy job, ghi `machine` chỉ vào chỗ trống) | content, email, history, media, ai, kernel |
| `guard` | BotID | — |

Thứ tự trên là thứ tự từ dưới lên. Module mới đặt vào đúng tầng và cập nhật bảng này cùng PR.

---

## 3. Bảy luật

### Luật 1 — Không import vòng giữa module *(CI)*
Bảng mục 2 là một đồ thị không có chu trình. Import kiểu `type` cũng tính.
Cần gọi "ngược lên" → module dưới khai báo **port** (kiểu hàm), `app/` truyền implementation vào. Mẫu chuẩn:

```ts
// booking/reservations.ts — port
export type ReservationEffects = { afterTransition?…; afterCreate?…; afterWebCreate?… };
// email/outbox.ts — implementation
export function outboxEffects(): Required<ReservationEffects> & { queued: string[] } { … }
// app/actions.ts — ghép
await createWebReservation(input, { effects: outboxEffects() });
```

Thứ dùng chung nhiều module (kiểu `Db`, `Conflict`, `US`) → đưa xuống kernel hoặc `db/client.ts`, không để trong một module nghiệp vụ.

### Luật 2 — Kernel không import module *(CI)*
`lib/server/*.ts` chỉ import `lib/` thuần, `db/`, thư viện ngoài. Kernel không chứa nghiệp vụ của riêng module nào.

### Luật 3 — `app/` là tầng ghép, không chứa nghiệp vụ
Server Action / route handler làm đúng thứ tự:
1. `requirePermission(...)` là câu lệnh đầu tiên *(CI)*;
2. validate bằng zod (schema ở `lib/admin/*-schemas.ts`);
3. gọi hàm của `lib/server/<module>`, truyền `getPool()` và effects;
4. `updateTag` / `refresh` qua cache plan *(CI)*;
5. bọc lỗi bằng `actionError` → `ActionResult`.

SQL và luật nghiệp vụ nằm trong `lib/server`, không viết trong `app/`.

### Luật 4 — Đọc và ghi tách đường
- **Đọc cho site khách**: `lib/server/content/*.queries.ts` — chỉ SELECT, có cache tag (`lib/cache-tags.ts`). Đặt bàn và availability không cache.
- **Ghi**: một transaction (`withTransaction`) gồm thay đổi + `insertAudit` + token đồng thời (`conflictBy` / `conflictFromHistory`). Ngày ra khỏi SQL qua `to_char` (tránh lệch múi giờ).

### Luật 5 — Outbox cho mọi email
Chỉ `email/outbox.ts` ghi `email_outbox`, và luôn trên client của transaction làm thay đổi booking. Không gửi trong transaction: `drainAfterCommit` sau COMMIT, cron `/api/cron/outbox` gom phần còn sót. Lỗi gửi không làm hỏng đặt bàn. Email staff (mời, reset) gửi thẳng qua `send.ts`, có idempotency key.

### Luật 6 — Mỗi I/O ngoài một cổng *(CI một phần)*
| I/O | Cổng duy nhất |
|---|---|
| Postgres | `db/client.ts` (`getPool`) |
| SMTP (nodemailer) | `lib/server/email/send.ts` / `smtp.ts` *(CI)* |
| Vercel Blob | `lib/server/media/blob.ts` + presigned flow *(CI)* |
| BotID | `lib/server/guard/bot.ts` |
| Vertex AI (AI SDK) | `lib/server/ai/` *(CI)* |

Mỗi cổng có chế độ fake/log cho dev và test (`EMAIL_DELIVERY=log`, fake Blob, `AI_PROVIDER=fake`).

### Luật 7 — Migration
Một DB, schema `public`. Migration mới = `db/migrations/NNN_*.sql` kế tiếp, kèm mục "### Migration NNN" trong README và file `db/checks` nếu cần *(CI)*. Cột cũ chờ xoá thì không đọc nữa *(CI: legacy-columns)*.
Nội dung khách đọc thuộc CMS: migration chỉ *thêm* (file ảnh mới vào `media`), còn thay nội dung đã seed trên DB thật thì qua content pack (`db/content-packs/`, `lib/server/content-admin/content-pack.ts`) — một transaction, audit từng mục, bỏ qua chỗ staff đã sửa.

---

## 4. Site khách & i18n

- Ngôn ngữ là **code**: `lib/i18n/site-locales.ts` (bật/tắt, thứ tự, mặc định). Không có bảng `locales`, không có màn admin. Đổi ngôn ngữ = sửa file + deploy. SQL cần ngôn ngữ mặc định dùng `DEFAULT_LOCALE_SQL`; ngôn ngữ của khách qua `guestLocale()`.
- Khách chỉ thấy bản dịch **đã duyệt**; thiếu thì về ngôn ngữ mặc định. Email khách chỉ gửi bằng ngôn ngữ đó khi đủ mọi key.
- Trang khách gọi `await requireEnabledLocale(...)` trước khi đọc gì *(CI)*.
- Chữ khách nhìn thấy nằm trong registry (`lib/i18n/registry.ts`) hoặc DB, không literal trong component *(CI)*.
- Truy vấn DOM trong phạm vi trang đang hiện (`usePageRoot()`), không cả document *(CI)*.
- Lớp phủ khách (`components/overlays/*`, `role="dialog" aria-modal`) đánh dấu chỗ nhận focus bằng `data-autofocus`; `useModalOverlays` trong `components/site/Chrome.tsx` chuyển focus vào khi mở, `inert` phần trang phía sau và trả focus về nút đã mở khi đóng. Lớp phủ mới đặt trong khối overlays của `Chrome`, không tự làm việc này. Mọi lớp phủ có hiệu ứng đóng và ở lại trong DOM khi đang ra: drawer đặt bàn qua `usePresence` (`lib/motion.tsx`, chuyển động riêng ở `DrawerMotion.tsx`), menu/search/finder sheet/film qua `useOverlayPresence` (cùng file, khai báo từng phần chuyển động, query trong root của lớp phủ). Lúc đang ra nó `inert`, không còn `role="dialog"`.
- Responsive: màn hình ngang thấp (điện thoại xoay ngang) dùng đúng một media query `(orientation: landscape) and (max-height: 500px)` ở mọi file CSS; chiều cao thanh cố định đọc từ token (`--header-h*`, `--tabbar-h` trong `styles/tokens.css`, `--tabbar-space` trong `styles/layout.css`), lề tránh tai thỏ từ `--safe-x`, không viết số cứng.

---

## 5. Chống thoái hoá

- File > ~400 dòng hoặc hàm > ~150 dòng → tách theo use case trong cùng module.
- Hai module cần nhau hai chiều → một chiều thành port (Luật 1), hoặc phần chung xuống kernel/`history`.
- Một module phình > ~20 file với nhiều trách nhiệm → cân nhắc tách module mới, cập nhật mục 2.

---

## 6. Guard test — CI chặn merge

| Luật | Test |
|---|---|
| Không import vòng; kernel không import module | `test/guards/server-modules.guard.test.ts` |
| `requirePermission` đầu mỗi action/route admin | `test/guards/require-permission.guard.test.ts` |
| Cache tag qua cache plan | `test/guards/content-tags.guard.test.ts` |
| nodemailer chỉ trong `lib/server/email` | `lib/server/email/mail-transport.guard.test.ts` |
| `@vercel/blob` chỉ ở cổng của nó | `test/guards/blob-imports.guard.test.ts` |
| Trang khách kiểm tra locale | `test/guards/guest-pages.guard.test.ts` |
| Chữ khách trong registry/DB | `test/guards/guest-text.guard.test.ts` |
| Mọi key/cột có màn sửa | `test/guards/editing-screens.guard.test.ts` |
| Migration có runbook | `test/guards/runbook.guard.test.ts` |
| Không đọc cột cũ | `test/guards/legacy-columns.guard.test.ts` |
| Admin: `instant = false`, không inline style (CSP), id không trùng giữa các trang (`<Activity>`), mỗi trang đúng một tiêu đề (`<h1>`/`PageHeader`) | `lib/admin/admin-pages.guard.test.ts` |
| Admin CSS: màu cảnh báo chỉ là token `--a-warn*`, một class cho form inline | `test/guards/admin-css.guard.test.ts` |
| AI SDK chỉ trong `lib/server/ai`; `lib/server/ai` và `content-admin/machine-*.ts`, `seo-material.ts` không chạm dữ liệu khách (booking, email, `reservations`) | `test/guards/ai-imports.guard.test.ts` |
| Route `app/api/admin/ai/*`: đúng quyền từng method (dịch hàng loạt chỉ Admin) | `test/guards/require-permission.guard.test.ts` |
| `revalidateTag` cũng chỉ qua cache plan (trừ tag ưu đãi của cron daily) | `test/guards/content-tags.guard.test.ts` |
| Mục nav khách trỏ tới section có anchor | `test/guards/nav-anchors.guard.test.ts` |
| Truy vấn DOM theo trang | `lib/page-scope.guard.test.ts` |
| Cron khớp `vercel.json` | `test/guards/vercel-crons.guard.test.ts` |

Chạy: `npm test` (unit + guard), `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test` (thêm integration), `npm run typecheck`, `npm run lint`.

---

## 7. Cố ý KHÔNG làm (và khi nào xem lại)

| Không làm | Vì sao | Xem lại khi |
|---|---|---|
| Schema DB riêng từng module | Một DB nhỏ, JOIN đơn giản hơn gọi qua contract | Cần tách một module thành service riêng |
| Thư mục `contract/` + manifest | Bảng mục 2 + guard test đã đủ ranh giới | Có team thứ hai làm song song |
| Domain entity / repository port cho DB | SQL tay trong một transaction đã rõ và test được bằng DB thật | Luật nghiệp vụ lặp lại ở nhiều hàm ghi |
| Event bus / domain event có version | Outbox email là side effect duy nhất cần tin cậy | Có side effect thứ hai (webhook, sync…) |
| Vertical slice mỗi use case một thư mục | Module nhỏ, một file theo màn/use case là đủ | Module vượt ngưỡng mục 5 |

---

## 8. Checklist thêm tính năng

1. Chọn module theo mục 2 (hoặc tạo module mới, thêm vào bảng).
2. Đọc: thứ cần đọc cho khách → `*.queries.ts` + cache tag. Ghi → transaction + audit + token.
3. Cần module tầng trên → thêm port vào module của mình, ghép ở `app/`.
4. Side effect cần chắc chắn → outbox.
5. Server Action theo Luật 3.
6. Migration theo Luật 7.
7. Test cạnh code; DB thì `test/integration/`. Chạy `npm test`, `typecheck`, `lint`.
