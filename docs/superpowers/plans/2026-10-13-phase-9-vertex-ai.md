# Đợt 9: Vertex AI — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Kế hoạch đợt 9, ba phần, 12 task (D1–D12).**
> - **Phần 1 (D1–D5): nền.**
>   - D1: gói npm và migration 011.
>   - D2: danh mục model, cấu hình AI (zod) và đọc/ghi `ai_settings`.
>   - D3: client Vertex không khóa (WIF), chế độ giả `fake`, guard import.
>   - D4: rào chắn: ngân sách, giới hạn theo người, sổ `ai_usage`.
>   - D5: thuật ngữ: che và trả ký hiệu `⟦G1⟧`, kiểm biến ICU, màn thuật ngữ.
> - **Phần 2 (D6–D10): tính năng.**
>   - D6: màn `/admin/settings/ai` và nút "Kiểm tra kết nối".
>   - D7: dịch từng trường ("Dịch từ EN").
>   - D8: dịch hàng loạt (`ai_jobs`, cron, Tiếp tục/Hủy).
>   - D9: trợ lý viết dạng stream.
>   - D10: gợi ý SEO.
> - **Phần 3 (D11–D12): alt ảnh và nghiệm thu.**
>   - D11: alt ảnh tự sinh sau upload, và nút "Viết alt bằng AI".
>   - D12: nghiệm thu, README (runbook GCP), sổ đợt 9, cổng cuối.
>
> **Chuẩn chung.** Plan 7A, 7B và 8 (`docs/superpowers/plans/2026-10-0{5,6}-*.md`) là chuẩn về văn phong, quy ước và giao diện code mà đợt 9 dùng lại. Chỗ nào spec (`docs/superpowers/specs/2026-10-01-admin-cms-design.md`) nói khác plan thì **làm theo spec**, trừ các Ruling ghi rõ ở dưới.
>
> **Mức chi tiết.** Code đầy đủ chỉ có cho phần mới hoặc dễ sai: migration, client và xác thực, rào chắn chi phí, che thuật ngữ, lõi dịch, job hàng loạt, alt ảnh. Phần giao diện sửa theo khuôn đã có (form kit, màn settings): task chỉ ra file, hàm, hành vi cần đạt, kèm test khóa hành vi.
>
> **Đầu vào đã kiểm chứng (2026-10-13).**
> - Spike AI SDK trong clone `scratchpad/p9-spike` (`lib/server/ai/spike.ts`, `spike.test.ts`):
>   - AI SDK 7 với `@ai-sdk/google-vertex` 5 qua typecheck TypeScript 7.0.2 (rủi ro §16 đã hết) và qua oxlint.
>   - Chuỗi WIF chạy được offline, với fetch giả.
>   - Mock model `ai/test` chạy được cả `generateText` + `Output.object` lẫn `streamText`.
> - Danh mục model: tra trên tài liệu Google Cloud ngày 2026-10-13. Nguồn ghi trong `lib/server/ai/models.ts`.

**Goal:** Admin cấu hình Vertex AI trong `/admin/settings/ai`, gồm model, region, prompt, thuật ngữ, giới hạn và ngân sách. Editor và Admin dùng được bốn tính năng: dịch từng trường, trợ lý viết, gợi ý SEO và viết alt ảnh. Admin chạy được dịch hàng loạt các phần còn thiếu của một ngôn ngữ. Mọi lời gọi đi qua cùng một rào chắn (ngân sách tháng, giới hạn theo người) và được ghi vào sổ chi phí. Không khóa GCP nào nằm trong DB, và mặc định cũng không có khóa nào trong env.

Nghiệm thu theo spec §14.1, dòng 9:
- Kiểm tra kết nối xanh với Gemini.
- Dịch giữ nguyên tên riêng và biến.
- Vượt ngân sách thì bị chặn.
- Job tạm dừng rồi chạy tiếp được.

**Architecture:**
- **Một cổng duy nhất tới Vertex: `lib/server/ai/`** (server-only). Không file nào khác được import `ai`, `@ai-sdk/*`, `google-auth-library` hay `@vercel/oidc`; một guard test giữ luật này (D3).
  - `models.ts`: danh mục model nằm trong code (spec §9.1).
  - `settings.ts`: đọc cấu hình (cache theo tag `ai-settings`) và lưu cấu hình (D2).
  - `client.ts`:
    - `aiMode()` trả `vertex` hoặc `fake`, hoặc báo chưa cấu hình;
    - `vertexAuth()` dùng WIF hoặc khóa dự phòng;
    - `languageModel(feature, settings)` dựng provider mới ở mỗi request (D3).
  - `fake.ts`: model giả cho dev, CI và E2E, trả kết quả có thể đoán trước (D3).
  - `guard.ts`: `runAiCall()` giữ chỗ chi phí trong `ai_usage`, gọi model, rồi chốt chi phí thật. Hàm này kiểm ngân sách cho **mọi** lời gọi, và kiểm giới hạn theo người cho lời gọi do người bấm (D4).
  - `glossary.ts`: che và trả thuật ngữ, che biến đơn giản, kiểm kết quả (D5).
  - `translate.ts`: lõi dịch một "tài liệu" `{items:[{id,text}]}` trong một lần gọi (D7).
  - `jobs.ts`: dịch hàng loạt (D8).
  - `assist.ts` (D9), `seo.ts` (D10), `alt.ts` (D11).
- **Lời gọi dài chạy trong route handler** dưới `app/api/admin/ai/*`, không chạy trong Server Action (spec §9.4). Ngoại lệ duy nhất là "Kiểm tra kết nối": spec §9.2 ghi nó là Server Action, giới hạn 20 giây.
- **Chế độ chạy** (R9-1): env `AI_PROVIDER`.
  - `vertex`: gọi thật.
  - `fake`: model giả. Production từ chối giá trị này.
  - Không đặt: là `vertex` nếu env GCP đã đủ, ngược lại AI ở trạng thái "chưa cấu hình". Khi đó các nút AI ẩn đi, và màn cấu hình nói rõ thiếu biến nào.
  - E2E và CI chạy `fake`; `blob-redirect.mjs` vốn đã chặn mọi host lạ.
- **Ghi bản dịch máy (L9-1):** chỉ hai luồng ghi `status='machine', origin='ai', ai_model=<id>`: job hàng loạt (D8) và alt ảnh tự sinh (D11).
  - Cả hai chỉ chèn vào chỗ **còn trống**, dùng `ON CONFLICT DO NOTHING` hoặc điều kiện `WHERE` tương đương. Bản người viết không bao giờ bị đè.
  - Dịch từng trường, trợ lý viết và SEO chỉ điền vào form. Người dùng bấm lưu thì ghi `reviewed` như mọi lần lưu khác (spec §5.1 mục 4).
- **Chi phí:** giá nằm trong danh mục model. Trước lời gọi, ước lượng trần (token vào ước theo ký tự, cộng `maxOutputTokens`) được giữ chỗ trong `ai_usage`; sau lời gọi, chốt bằng `totalUsage` thật. Hai lời gọi song song vì vậy không vượt được ngân sách.

**Tech Stack:**
- Next.js 16.3 (route handler, `after()`, `maxDuration`), React 19, TypeScript 7.
- `pg` với SQL viết tay, zod 4, Vitest, Playwright. Giữ nguyên như các đợt trước.
- Gói mới (bản lấy theo `npm view` ngày 2026-10-13, spike đã cài thử):

| Gói | Pin | Ghi chú |
|---|---|---|
| `ai` | `^7.0.138` | `generateText`, `Output`, `streamText`, `createTextStreamResponse`, `toTextStream`; `ai/test` cho mock |
| `@ai-sdk/google-vertex` | `^5.0.110` | `createGoogleVertex`; `/anthropic` → `createVertexAnthropic` |
| `@ai-sdk/react` | `^4.0.141` | `useCompletion` |
| `@ai-sdk/google` | `4.0.94` (exact) | chỉ import type `GoogleLanguageModelOptions` |
| `@ai-sdk/anthropic` | `4.0.79` (exact) | chỉ import type `AnthropicLanguageModelOptions` |
| `google-auth-library` | `^10.9.1` | **Không dùng 11.x.** `@ai-sdk/google-vertex` phụ thuộc `^10.6.2`, nên bản 11 sẽ cài thêm một bản thứ hai, và auth client tạo từ bản đó không khớp kiểu. |
| `@vercel/oidc` | `^3.8.10` | **Không dùng 4.x.** Đây là bản `@vercel/blob` đang dùng. |

**Spec:** `docs/superpowers/specs/2026-10-01-admin-cms-design.md` §3 (dòng AI), §5.1 mục 4, §5.2 (bảng AI), §7.1 (quyền `content:ai`, `settings`), §8, §9, §12 (Vertex lỗi), §14.1 dòng 9, §15 mục 6–11.

## Global Constraints

- Mặc định AI: mọi tính năng dùng `gemini-3.8-flash` ở region `global`. Ngân sách **$20/tháng**, tính cho mọi lời gọi. Mỗi người (Admin hoặc Editor) tối đa **10 lượt/phút và 100 lượt/ngày**; chỉ tính lời gọi do chính người đó bấm. Bản preview (Draft Mode) không gọi AI. (spec §3)
- **Khóa GCP không lưu trong DB.** Mặc định env cũng không có khóa: dùng Vercel OIDC → GCP WIF. Phương án dự phòng là `GCP_SERVICE_ACCOUNT_KEY` trong env. (spec §3 mục 4, §9.1)
- `GOOGLE_VERTEX_API_KEY` **không bao giờ được đặt**: có biến này thì provider tự chuyển sang express mode. Client từ chối chạy khi thấy nó (spike, gotcha 4).
- Mọi lời gọi Claude đặt `providerOptions.anthropic.structuredOutputMode: 'outputFormat'`. (spec §9.1)
- `maxRetries: 1`; mỗi lời gọi có timeout; độ dài đầu vào và số token đầu ra có giới hạn. (spec §9.4)
- **Không bao giờ gửi dữ liệu cá nhân của khách cho Vertex.** `lib/server/ai/**` không import `lib/server/booking/**`, `lib/server/email/**` hay bảng `reservations`; guard test giữ luật này. (spec §9.4)
- SEO: title ≤ 60 ký tự, description ≤ 155 ký tự. (spec §9.3)
- Ảnh trang trí và PDF không sinh alt; ảnh được thu nhỏ về khoảng 1024 px bằng `sharp` trước khi gửi. (spec §9.3)
- Mỗi lần lưu cấu hình AI ghi audit và gọi `updateTag('ai-settings')`. (spec §9.2)
- Màn cấu hình AI chỉ Admin dùng được (`settings:update`). Dùng AI là quyền `content:ai`, Editor cũng có. (spec §7.1)
- Giao diện admin bằng tiếng Việt. Lỗi Vertex được giải thích bằng tiếng Việt theo mã 401/403, 404, 429, 400. (spec §9.2, §12)
- Repo đang **public**: không commit bí mật, kể cả trong test hay README.
- Lệnh build, E2E và Better Auth CLI phải chạy với `PGHOST= PGUSER= PGPASSWORD= PGDATABASE=`. Typecheck là `npm run typecheck`. Migration mới phải có mục `### Migration 011 (` trong README (`test/guards/runbook.guard.test.ts`).

## Rulings

- **R9-1 (chế độ chạy).** `AI_PROVIDER` ∈ {`vertex`, `fake`}. `resolveAiMode(env)` trả `{ mode: 'vertex' | 'fake' } | { mode: 'off', missing: string[] }`, viết theo khuôn `lib/server/email/mode.ts`.
  - `fake` cùng `VERCEL_ENV=production` thì ném lỗi.
  - Không đặt: là `vertex` khi đủ env GCP. Thiếu env thì là `off`, kèm tên các biến còn thiếu.
  - `GOOGLE_VERTEX_API_KEY` có mặt thì ném lỗi ở mọi chế độ.
- **R9-2 (nhịp cron, Neon Free).** Spec §9.3 viết cron 5 phút, nhưng ghi chú 2026-10-05 trong spec yêu cầu xem lại. Chốt như sau:
  - `/api/cron/ai-jobs` chạy **mỗi giờ** (`20 * * * *`).
  - Tạo job hoặc bấm "Tiếp tục" thì `after()` chạy job ngay trong ngân sách thời gian của request (240 giây, `maxDuration = 300`).
  - Cron chỉ nhặt phần còn dư, hoặc job mà function bị chết giữa chừng (lease hết hạn).
  - Không có job nào thì cron trả về ngay sau một `SELECT`.
- **R9-3 (giới hạn theo người).** Đếm hàng trong `ai_usage` theo `actor_id`: trong 60 giây gần nhất, và từ 00:00 giờ Việt Nam hôm nay. Phép đếm và phép chèn hàng giữ chỗ nằm trong một transaction có `pg_advisory_xact_lock(hashtext('ai:' || actor))`, nên hai cú bấm cùng lúc không vượt giới hạn. Giới hạn chỉ áp cho `actor_id` khác NULL. Job và alt tự sinh ghi `actor_id = NULL`, không tính vào giới hạn theo người.
- **R9-4 (ngân sách).** "Tháng" là tháng dương lịch theo giờ Việt Nam.
  - Mỗi lời gọi chèn một hàng `status='pending'` với `cost_usd` bằng trần ước lượng, trong cùng transaction có `pg_advisory_xact_lock(hashtext('ai:budget'))`.
  - Tổng tháng (gồm cả hàng pending) cộng trần ước lượng mà vượt ngân sách thì từ chối với mã `ai_budget`.
  - Gọi xong thì chốt `ok` với chi phí thật. Lỗi thì chốt `error` và chi phí 0, trừ khi `usage` cho biết đã có token: khi đó tính token đó.
  - Hàng pending quá 10 phút (function chết) giữ nguyên trần ước lượng, tức ước theo hướng thận trọng.
- **R9-5 (giá trong danh mục).** Giá ghi theo USD/1M token, ở region `global`. Region `us`/`eu` nhân 1,1.
  - `gemini-3.8-flash` ghi theo **giá sau khuyến mãi** (1,50/7,50), vì khuyến mãi tới 31/12/2026 được hoàn dưới dạng credit, có thể không giảm thẳng.
  - Token "nghĩ" của Gemini đã nằm trong `outputTokens` (spike, gotcha 6).
- **R9-6 (thuật ngữ, tên nhà hàng).** Tên nhà hàng **không chép vào `ai_glossary`**: lúc dịch, danh sách thuật ngữ được tính bằng `ai_glossary` hợp với `restaurants.name` (`keep`, mọi ngôn ngữ, kể cả nhà hàng đã lưu trữ). Màn thuật ngữ hiện các tên này thành dòng chỉ đọc "Tên nhà hàng (tự động)". Spec §9.2 nói "tự động được thêm vào bảng"; cách này cho đúng kết quả mà không phải đồng bộ hai nơi khi đổi tên hay xóa nhà hàng.
- **R9-7 (che chữ khi dịch).**
  - Thuật ngữ được thay bằng `⟦G1⟧`, `⟦G2⟧`…, ưu tiên cụm dài trước, phân biệt hoa thường, và chỉ khớp trọn từ.
  - Biến ICU đơn giản `{name}` được thay bằng `⟦V1⟧`…
  - Chuỗi có `plural`, `select` hay `selectordinal` thì gửi nguyên, vì phần chữ bên trong cần dịch. Sau khi dịch, `checkMessage(text, vars, messageArgs(english))` phải không còn lỗi.
  - Mỗi ký hiệu phải xuất hiện đúng một lần trong kết quả. Thiếu hay thừa thì item đó bị loại với mã `ai_placeholder`.
  - Khi trả ký hiệu: `keep` trả lại đúng thuật ngữ gốc; `map` trả `target` của ngôn ngữ đích, hoặc thuật ngữ gốc nếu ngôn ngữ đó không có `target`.
- **R9-8 (dịch từng trường).** Nút "Dịch từ EN" nằm trong tab ngôn ngữ (khác EN) của `TranslatableField` và của `StringsForm`.
  - Nút gửi chữ EN **đang hiện trong form**, kể cả khi chưa lưu, tới `POST /api/admin/ai/translate`, rồi điền kết quả vào ô. Không có gì được lưu.
  - Với chuỗi registry, client gửi `key` để server lấy `context`, `maxLength` và `vars`.
  - Đầu vào tối đa 4 000 ký tự.
- **R9-9 (dịch hàng loạt: phạm vi).** Một job dịch **mọi chỗ còn thiếu** của một ngôn ngữ, theo `CONTENT_KINDS` (`lib/server/content-admin/translations.ts`): các loại item cộng các màn chuỗi.
  - **Trừ** chữ chính sách và câu đồng ý (`PRIVACY_KEYS` ∪ `AGREED_KEYS` trong `lib/legal.ts`): khách đồng ý với đúng chữ đó, nên phải do người viết (spec §15, README "Before launch B").
  - **Trừ** alt ảnh, vì alt EN do D11 lo, còn alt các ngôn ngữ khác vẫn thuộc job như mọi item.
  - Mỗi ngôn ngữ chỉ có một job còn sống (`queued`, `running` hoặc `paused`); partial unique index giữ luật này.
  - "Tài liệu" là một item (mọi cột dịch được của nó), hoặc tối đa 20 key của một màn chuỗi. Mỗi lượt chạy dịch tối đa 20 tài liệu rồi tính lại phần còn thiếu, nên chạy tiếp, chạy lại hay bị người khác lưu chen vào giữa đều đúng.
- **R9-10 (trợ lý viết).** Ba thao tác: `rewrite` (viết lại), `shorten` (rút gọn), `brand` (theo giọng thương hiệu).
  - Kết quả hiện trong panel. Nút "Dùng bản này" thay chữ trong ô; người dùng vẫn phải bấm lưu.
  - Đóng panel thì gọi `stop()`, và server truyền `request.signal` vào `abortSignal`.
  - Trợ lý có ở mọi `TranslatableField` có `rows ≥ 3` và ở ô nhiều dòng của `StringsForm`, cho ngôn ngữ của tab đang mở.
- **R9-11 (SEO).** `POST /api/admin/ai/seo` nhận `{ target: { kind: 'page', page } | { kind: 'restaurant', id }, locale }`. Server tự đọc nội dung (không nhận chữ từ client) và trả `{ title, description }`.
  - Quá 60 hoặc 155 ký tự thì cắt ở ranh giới từ cuối cùng còn vừa.
  - Nút "Gợi ý bằng AI" có ở màn SEO (`/admin/content/seo`) cho từng trang, và ở phần SEO của `RestaurantForm`.
- **R9-12 (alt ảnh).** Có hai đường.
  - **Tự sinh:** `registerMediaAction` gọi `after(() => generateAltQuietly(id))` khi đủ năm điều kiện: file **mới** (`created`), là ảnh, không trang trí, chưa có alt EN, và tính năng alt đang bật.
    - Không tính vào giới hạn theo người (`actor_id = NULL`), nhưng có tính vào ngân sách.
    - Ghi alt EN với `machine`, `ai`, `ai_model`, chỉ khi vẫn chưa có alt.
  - **Nút "Viết alt bằng AI"** ở `/admin/media/[id]`:
    - gọi `POST /api/admin/ai/alt`;
    - có tính vào giới hạn theo người;
    - trả chữ về điền vào ô, không lưu.
  - Đây là cách xử lý 17 ảnh cũ chưa có alt.
- **R9-13 (Claude và structured output).** Theo spec, dùng `structuredOutputMode: 'outputFormat'`.
  - Org policy GCP phải cho phép `structured_outputs`; spec §15 mục 10 là việc của chủ dự án.
  - "Kiểm tra kết nối", bước 4, báo lỗi 400 thành câu "bị chính sách của tổ chức GCP chặn".
- **R9-14 (Draft Mode).** Các route AI từ chối khi request đang ở Draft Mode (`draftMode().isEnabled`), với mã `ai_preview`. Các nút AI không hiện trên trang khách, nên luật này chỉ là lưới an toàn cho "Bản preview không gọi AI" (spec §3).
- **R9-15 (mã lỗi mới).** Thêm vào `ActionCode` và `actionErrorMessage` các mã sau:
  - `ai_off`: "AI chưa được cấu hình hoặc tính năng đang tắt."
  - `ai_budget`: "Đã dùng hết ngân sách AI tháng này."
  - `ai_rate_minute`: "Bạn đã dùng AI 10 lần trong một phút. Thử lại sau ít giây."
  - `ai_rate_day`: "Bạn đã dùng hết 100 lượt AI hôm nay."
  - `ai_auth`: 401/403, "Thiếu quyền, hoặc model chưa được bật."
  - `ai_not_found`: 404, "Model không có ở region đã chọn."
  - `ai_quota`: 429, "Hết quota Vertex."
  - `ai_bad_request`: 400, "Tham số sai, hoặc bị chính sách của tổ chức GCP chặn."
  - `ai_failed`: lỗi khác hoặc timeout, "Vertex không trả lời được. Thử lại sau."
  - `ai_placeholder`: "AI làm mất tên riêng hoặc biến; không dùng được bản dịch này."
  - `ai_preview`: "Bản xem trước không gọi AI."

  Các câu `ai_rate_*` lấy con số từ cấu hình, không viết cứng.

## Review Focus

1. **Bản người viết bị AI đè.** Một Editor lưu bản VI trong lúc job dịch VI đang chạy, hoặc ngay giữa lúc job đọc "còn thiếu" và lúc ghi. Bản của Editor phải còn nguyên, với `reviewed`. Test nằm ở D8, `jobs.test.ts › never overwrites a row written after the scan`.
2. **Hai cú bấm cùng lúc lách được giới hạn và ngân sách.** Mười một lời gọi song song của cùng một người khi giới hạn là 10/phút: đúng 10 lời gọi qua. Hai lời gọi song song khi ngân sách chỉ còn đủ cho một: đúng một lời gọi qua. Test ở D4, `guard.test.ts › concurrent calls`.
3. **Tên riêng hoặc biến bị dịch hay bị mất.** "Tàya House", `{phone}`, và một `{count, plural, …}`. Ký hiệu bị model nhân đôi hay bỏ mất thì item bị loại, chữ hỏng không bao giờ được điền vào form hay ghi vào DB. Test ở D5, `glossary.test.ts`, và D7, `translate.test.ts › rejects a dropped token`.
4. **Production chạy model giả, hoặc lộ khóa.** `AI_PROVIDER=fake` trên Production, hoặc `GOOGLE_VERTEX_API_KEY` có mặt: phải ném lỗi, không âm thầm chạy. Màn cấu hình chỉ hiện có/không cho từng biến, không bao giờ hiện giá trị. Test ở D3, `client.test.ts`, và D6, `settings-ai.spec.ts`.
5. **Vertex lỗi giữa job.** Một lỗi 429 ở tài liệu thứ 7 trên 20: job chuyển `paused` với `error='ai_quota'`, 6 tài liệu trước vẫn được giữ, và bấm "Tiếp tục" thì làm từ tài liệu thứ 7. Một function chết khi đang giữ lease: lần cron kế tiếp nhặt lại job. Test ở D8.

## Rủi ro đã biết

| Rủi ro | Cách xử lý |
|---|---|
| Chưa có GCP project. Chủ dự án làm spec §15 mục 6–11 sau. | Toàn bộ đợt 9 chạy với `AI_PROVIDER=fake`. Riêng nghiệm thu "kết nối xanh với Gemini" thật là việc của chủ dự án, có hướng dẫn ở README và ghi trong sổ đợt 9. |
| `google-auth-library` gọi STS qua `node-fetch` nội bộ, không qua `fetch` toàn cục. | Test WIF gán `client.stsCredential.transporter = client.transporter` (spike, gotcha 1). Test không bao giờ ra mạng: `vitest` đặt `fetch` giả, và có một test bảo đảm không có lời gọi nào tới host thật. |
| `generateText` không kiểm `signal.aborted` trước khi gọi. | `runAiCall` kiểm trước (spike, gotcha 5). |
| Vercel ghi sai role trong hướng dẫn console (ghi "Service account users"). | README dùng `roles/iam.workloadIdentityUser`, theo tài liệu của Google. |
| Preview không được cấp WIF (spec §9.1). | Trên Preview, AI báo `ai_auth`. README ghi rõ điều này. |

## Sơ đồ file

```
db/migrations/011_ai_phase9.sql                      D1  ai_settings, ai_glossary, ai_usage, ai_jobs
db/checks/preflight-011.sql, postcheck-011.sql       D1
test/integration/migration-011.test.ts               D1
lib/server/ai/models.ts (+ .test.ts)                 D2  danh mục model, giá, region
lib/admin/ai-schemas.ts                              D2  zod AiSettings (dùng cả client lẫn server)
lib/server/ai/settings.ts (+ .test.ts)               D2  loadAiSettings (cache), saveAiSettings
lib/server/ai/mode.ts (+ .test.ts)                   D3  resolveAiMode
lib/server/ai/client.ts (+ .test.ts)                 D3  vertexAuth, languageModel
lib/server/ai/fake.ts                                D3  model giả
test/guards/ai-imports.guard.test.ts                 D3
lib/server/ai/guard.ts (+ .test.ts)                  D4  runAiCall, AiError
lib/server/ai/errors.ts                              D4  mã Vertex → ActionCode
lib/server/ai/glossary.ts (+ .test.ts)               D5  mask, unmask, loadGlossary, saveGlossary
app/admin/(shell)/settings/ai/                       D5–D6  page.tsx, AiSettingsForm.tsx, GlossaryTable.tsx, ConnectionCheck.tsx, actions.ts
lib/server/ai/check.ts (+ .test.ts)                  D6  checkConnection
lib/server/ai/translate.ts (+ .test.ts)              D7  translateItems
app/api/admin/ai/translate/route.ts                  D7
app/admin/(shell)/_kit/AiTranslateButton.tsx         D7
lib/server/ai/jobs.ts (+ .test.ts)                   D8  createJob, runJobs, resumeJob, cancelJob
lib/server/ai/machine-write.ts (+ .test.ts)          D8  ghi machine, chỉ vào chỗ trống
app/api/admin/ai/jobs/route.ts, [id]/route.ts        D8
app/api/cron/ai-jobs/route.ts                        D8
app/admin/(shell)/translations/AiJobPanel.tsx        D8
lib/server/ai/assist.ts, app/api/admin/ai/assist/route.ts, _kit/AssistPanel.tsx   D9
lib/server/ai/seo.ts, app/api/admin/ai/seo/route.ts, _kit/SeoSuggestButton.tsx     D10
lib/server/ai/alt.ts (+ .test.ts), app/api/admin/ai/alt/route.ts                   D11
e2e/ai.serial.spec.ts                                D12
docs/superpowers/ledgers/2026-10-13-phase-9-ledger.md  D12
```

Các file sửa:
- `lib/server/action-result.ts`, `lib/admin/auth-errors.ts`: thêm các mã R9-15.
- `lib/admin/nav.ts`: thêm "AI" dưới Cài đặt.
- `lib/admin/audit-labels.ts`: thêm nhãn `ai_settings` và `ai_glossary`.
- `test/guards/require-permission.guard.test.ts`: `ADMIN_ONLY_ACTIONS`, hoặc ma trận `CONTENT_ACTIONS`.
- `vercel.json`, `test/guards/vercel-crons.guard.test.ts`.
- `_kit/TranslatableField.tsx`, `content/_ui/StringsForm.tsx`, `content/seo/page.tsx`, `restaurants/[id]/RestaurantForm.tsx`.
- `media/actions.ts`, `media/[id]/MediaForms.tsx`.
- `translations/page.tsx`.
- `README.md`.

---

## PHẦN 1: nền (D1–D5)

### Task D1: Gói npm và migration 011

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `db/migrations/011_ai_phase9.sql`, `db/checks/preflight-011.sql`, `db/checks/postcheck-011.sql`
- Test: `test/integration/migration-011.test.ts`
- Modify: `README.md` (mục `### Migration 011 (phase 9: AI)`, đặt ngay sau mục Migration 010)

**Interfaces:**
- Produces: bốn bảng.
  - `ai_settings (id smallint PK = 1, data jsonb, updated_at, updated_by)`
  - `ai_glossary (id bigserial, term, mode, locale, target, …)`
  - `ai_usage (id bigserial, at, actor_id, feature, model, region, input_tokens, output_tokens, cost_usd, status, error_code, job_id)`
  - `ai_jobs (id bigserial, locale, scope, status, progress, error, created_by, created_at, updated_at, locked_until, attempts)`

- [ ] **Step 1: Cài gói.**

```bash
npm install ai@^7.0.138 @ai-sdk/google-vertex@^5.0.110 @ai-sdk/react@^4.0.141 google-auth-library@^10.9.1 @vercel/oidc@^3.8.10
npm install --save-exact @ai-sdk/google@4.0.94 @ai-sdk/anthropic@4.0.79
npm ls google-auth-library @vercel/oidc
```

Expected:
- `npm ls` chỉ hiện **một** bản `google-auth-library` 10.x (deduped) và một bản `@vercel/oidc` 3.x.
- Có một cảnh báo deprecated cho `node-domexception`. Cảnh báo này đến từ google-auth-library và chấp nhận được.

- [ ] **Step 2: Viết test migration (thất bại).** Chép khuôn của `test/integration/migration-010.test.ts`:
  - `databaseUrl('furama_cuisine_migrate011_test')`;
  - `resetDatabase(url, '010_locales_phase8.sql')`;
  - chạy preflight, rồi `migrate(url)`, rồi postcheck (mọi dòng `ok = true`);
  - chạy lại `migrate` và postcheck vẫn xanh.

  Thêm các khẳng định riêng:

```ts
it('keeps one live job per language', async () => {
  await withClient(url, async (c) => {
    await c.query(`INSERT INTO ai_jobs (locale, scope, created_by) VALUES ('vi', '{}', NULL)`);
    await expect(c.query(`INSERT INTO ai_jobs (locale, scope, created_by) VALUES ('vi', '{}', NULL)`)).rejects.toThrow(/ai_jobs_one_live_idx/);
    await c.query(`UPDATE ai_jobs SET status = 'done' WHERE locale = 'vi'`);
    await c.query(`INSERT INTO ai_jobs (locale, scope, created_by) VALUES ('vi', '{}', NULL)`); // a finished job does not block
  });
});

it('refuses a second settings row and a bad glossary mode', async () => {
  await withClient(url, async (c) => {
    await expect(c.query(`INSERT INTO ai_settings (id, data) VALUES (2, '{}')`)).rejects.toThrow();
    await expect(c.query(`INSERT INTO ai_glossary (term, mode) VALUES ('x', 'translate')`)).rejects.toThrow();
    await expect(c.query(`INSERT INTO ai_glossary (term, mode, locale) VALUES ('Da Nang', 'map', 'vi')`)).rejects.toThrow(/target/);
  });
});

it('seeds the default settings row once', async () => {
  await withClient(url, async (c) => {
    const { rows } = await c.query(`SELECT data FROM ai_settings`);
    expect(rows).toHaveLength(1);
    expect(rows[0].data).toEqual({}); // defaults live in code (D2); {} parses to them
  });
});
```

Run: `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npx vitest run test/integration/migration-011.test.ts`
Expected: FAIL (không có file migration).

- [ ] **Step 3: Viết migration.**

```sql
-- Phase 9: Vertex AI (spec §5.2 "Nhân viên, quản trị, AI", §9). Expand only, one transaction, safe to re-run.
--
-- ai_settings: one row (id = 1) whose data is the zod-checked AiSettings
--   (lib/admin/ai-schemas.ts); {} parses to the spec's defaults, so the row is
--   seeded empty and code owns the defaults. updated_at is the save's conflict token.
-- ai_glossary: terms kept as written (keep) or mapped per language (map).
--   Restaurant names are not stored here (R9-6): the translator adds them.
-- ai_usage: one row per call, written BEFORE the call as 'pending' with the
--   cost ceiling, settled after (R9-4). actor_id NULL = not counted per person
--   (bulk jobs, automatic alt text).
-- ai_jobs: bulk translation (spec §9.3), one live job per language.

CREATE TABLE IF NOT EXISTS ai_settings (
  id          smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text        REFERENCES staff_user (id) ON DELETE SET NULL
);
INSERT INTO ai_settings (id, data) VALUES (1, '{}'::jsonb) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ai_glossary (
  id          bigserial   PRIMARY KEY,
  term        text        NOT NULL CHECK (length(btrim(term)) BETWEEN 1 AND 80),
  mode        text        NOT NULL CHECK (mode IN ('keep', 'map')),
  -- NULL: every language (keep); a code: that language only (map needs one).
  locale      text        REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  target      text        CHECK (target IS NULL OR length(btrim(target)) BETWEEN 1 AND 80),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text        REFERENCES staff_user (id) ON DELETE SET NULL,
  CONSTRAINT ai_glossary_map_target CHECK (mode = 'keep' OR (locale IS NOT NULL AND target IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_glossary_term_locale_idx ON ai_glossary (term, coalesce(locale, ''));

CREATE TABLE IF NOT EXISTS ai_jobs (
  id           bigserial   PRIMARY KEY,
  locale       text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  scope        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status       text        NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued', 'running', 'paused', 'done', 'cancelled')),
  progress     jsonb       NOT NULL DEFAULT '{"done":0,"failed":0,"remaining":null}'::jsonb,
  error        text,
  attempts     integer     NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_by   text        REFERENCES staff_user (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_jobs_one_live_idx ON ai_jobs (locale) WHERE status IN ('queued', 'running', 'paused');

CREATE TABLE IF NOT EXISTS ai_usage (
  id            bigserial    PRIMARY KEY,
  at            timestamptz  NOT NULL DEFAULT now(),
  actor_id      text         REFERENCES staff_user (id) ON DELETE SET NULL,
  feature       text         NOT NULL CHECK (feature IN ('translate', 'assist', 'seo', 'alt', 'check')),
  model         text         NOT NULL,
  region        text         NOT NULL,
  input_tokens  integer      NOT NULL DEFAULT 0,
  output_tokens integer      NOT NULL DEFAULT 0,
  cost_usd      numeric(12,6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  status        text         NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok', 'error')),
  error_code    text,
  job_id        bigint       REFERENCES ai_jobs (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ai_usage_at_idx ON ai_usage (at);
CREATE INDEX IF NOT EXISTS ai_usage_actor_at_idx ON ai_usage (actor_id, at) WHERE actor_id IS NOT NULL;
```

- [ ] **Step 4: Viết preflight và postcheck** theo khuôn `db/checks/preflight-010.sql`, mỗi dòng là `(check, ok, detail)`.
  - **Preflight:**
    - `_migrations` có `010_locales_phase8.sql`;
    - chưa có `011`, hoặc có rồi thì được báo là "re-run";
    - `locales` có `en`.
  - **Postcheck:**
    - đủ bốn bảng;
    - `ai_settings` có đúng 1 hàng;
    - có index `ai_jobs_one_live_idx`;
    - có constraint `ai_glossary_map_target`;
    - `_migrations` có `011_ai_phase9.sql`.

- [ ] **Step 5: Chạy test.** Expected: PASS.

- [ ] **Step 6: README.** Thêm mục `### Migration 011 (phase 9: AI)` theo khuôn mục 010, gồm:
  - migration đổi gì;
  - chạy lại an toàn;
  - **thứ tự deploy:** áp migration lên Neon trước khi deploy code đợt 9, vì màn admin đọc `ai_settings`;
  - các lệnh `psql` cho preflight và postcheck.

  Chạy `npx vitest run test/guards/runbook.guard.test.ts` → PASS.

- [ ] **Step 7: Commit.**

```bash
git add package.json package-lock.json db/migrations/011_ai_phase9.sql db/checks/*-011.sql test/integration/migration-011.test.ts README.md
git commit -m "Phase 9 D1: AI packages and migration 011 (settings, glossary, usage ledger, jobs)"
```

---

### Task D2: Danh mục model và cấu hình AI

**Files:**
- Create: `lib/server/ai/models.ts`, `lib/server/ai/models.test.ts`
- Create: `lib/admin/ai-schemas.ts`, `lib/admin/ai-schemas.test.ts`
- Create: `lib/server/ai/settings.ts`, `lib/server/ai/settings.test.ts`
- Modify: `lib/admin/audit-labels.ts` (`ai_settings`: "Cấu hình AI", `ai_glossary`: "Thuật ngữ AI")

**Interfaces:**
- Produces:
  - `MODELS`, `ModelId`, `Region`, `modelById(id)`, `priceUsd(model, region, inputTokens, outputTokens): number` (`models.ts`)
  - `AI_FEATURES = ['translate','assist','seo','alt'] as const`, `AiFeature`, `AiSettings`, `AiSettingsSchema`, `FeatureConfig` (`ai-schemas.ts`)
  - `loadAiSettings(): Promise<{ settings: AiSettings; token: string }>`, `cachedAiSettings(): Promise<AiSettings>` (`'use cache'`, `cacheTag(TAGS.aiSettings)`), `saveAiSettings(pool, actor, { settings, token })` (`settings.ts`)

- [ ] **Step 1: Test danh mục (thất bại).**

```ts
import { MODELS, modelById, priceUsd } from './models';

describe('model catalogue', () => {
  it('defaults to gemini-3.8-flash on global', () => {
    expect(MODELS[0]).toMatchObject({ id: 'gemini-3.8-flash', provider: 'google', regions: ['global', 'us', 'eu'] });
  });
  it('prices a call per million tokens, +10% outside global', () => {
    expect(priceUsd('gemini-3.8-flash', 'global', 1_000_000, 0)).toBeCloseTo(1.5);
    expect(priceUsd('gemini-3.8-flash', 'eu', 0, 1_000_000)).toBeCloseTo(8.25);
  });
  it('knows every Claude model as anthropic with images and structured output', () => {
    for (const id of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const) {
      expect(modelById(id)).toMatchObject({ provider: 'anthropic', image: true, structured: true });
    }
  });
  it('throws on an unknown model', () => expect(() => modelById('gpt-x' as never)).toThrow());
});
```

- [ ] **Step 2: Viết `models.ts`.**

```ts
import 'server-only';

/*
 * The models the admin may choose (spec §9.1), checked against Google Cloud's
 * model cards on 2026-10-13:
 * https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models
 * https://cloud.google.com/vertex-ai/generative-ai/pricing
 * Prices are USD per 1M tokens on the global endpoint; us/eu cost 10% more
 * (R9-5). gemini-3.8-flash is priced after its promotion (credits back until
 * 2026-12-31), so the budget errs high. Gemini's thinking tokens are inside
 * outputTokens. Claude must be enabled in Model Garden first (spec §15.10).
 */
export const REGIONS = ['global', 'us', 'eu'] as const;
export type Region = (typeof REGIONS)[number];

export type ModelInfo = {
  id: string;
  label: string;
  provider: 'google' | 'anthropic';
  regions: readonly Region[];
  image: boolean;
  structured: boolean;
  /** USD per 1M tokens, global. */
  inUsd: number;
  outUsd: number;
};

export const MODELS = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (mặc định)', provider: 'google', regions: REGIONS, image: true, structured: true, inUsd: 1.5, outUsd: 7.5 },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (rẻ)', provider: 'google', regions: REGIONS, image: true, structured: true, inUsd: 0.3, outUsd: 2.5 },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', provider: 'anthropic', regions: REGIONS, image: true, structured: true, inUsd: 0.5, outUsd: 2.5 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', provider: 'anthropic', regions: REGIONS, image: true, structured: true, inUsd: 2, outUsd: 10 },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', provider: 'anthropic', regions: REGIONS, image: true, structured: true, inUsd: 4, outUsd: 20 },
] as const satisfies readonly ModelInfo[];

export type ModelId = (typeof MODELS)[number]['id'];
export const MODEL_IDS = MODELS.map((m) => m.id) as [ModelId, ...ModelId[]];
export const DEFAULT_MODEL: ModelId = 'gemini-3.8-flash';

export function modelById(id: ModelId): ModelInfo {
  const m = MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`unknown model ${id}`);
  return m;
}

export function priceUsd(id: ModelId, region: Region, inputTokens: number, outputTokens: number): number {
  const m = modelById(id);
  const factor = region === 'global' ? 1 : 1.1;
  return ((inputTokens * m.inUsd + outputTokens * m.outUsd) / 1_000_000) * factor;
}
```

Claude Haiku 5.5 được ghi theo giá phần trên 100K token (0,50/2,50), vì giá này cao hơn và ngân sách nên ước theo hướng thận trọng.

> `models.ts` có `import 'server-only'`, còn `ai-schemas.ts` thì client cũng dùng. Vì vậy chép **id, nhãn và region** sang `lib/admin/ai-models.ts` (không có `server-only`) và để `models.ts` re-export từ đó. Giá chỉ nằm ở `models.ts`.

- [ ] **Step 3: Test schema (thất bại).**

```ts
import { AiSettingsSchema } from './ai-schemas';

it('fills the spec defaults from {}', () => {
  const s = AiSettingsSchema.parse({});
  expect(s.budgetUsd).toBe(20);
  expect(s.limits).toEqual({ perMinute: 10, perDay: 100 });
  for (const f of ['translate', 'assist', 'seo', 'alt'] as const) {
    expect(s.features[f]).toMatchObject({ enabled: true, model: 'gemini-3.8-flash', region: 'global', reasoning: 'low' });
  }
});
it('refuses a region the model does not serve', () => {
  // every catalogue model serves all three today; the refine still guards a future one
  expect(AiSettingsSchema.safeParse({ features: { translate: { region: 'asia' } } }).success).toBe(false);
});
it('bounds tokens, prompts, limits and budget', () => {
  expect(AiSettingsSchema.safeParse({ features: { assist: { maxOutputTokens: 50_000 } } }).success).toBe(false);
  expect(AiSettingsSchema.safeParse({ limits: { perMinute: 0, perDay: 100 } }).success).toBe(false);
  expect(AiSettingsSchema.safeParse({ budgetUsd: -1 }).success).toBe(false);
  expect(AiSettingsSchema.safeParse({ brandVoice: 'x'.repeat(2001) }).success).toBe(false);
});
```

- [ ] **Step 4: Viết `ai-schemas.ts`.**

```ts
import { z } from '@/lib/admin/zod';
import { MODEL_IDS, MODEL_REGIONS, type ModelId } from '@/lib/admin/ai-models';

export const AI_FEATURES = ['translate', 'assist', 'seo', 'alt'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];
export const REASONING = ['minimal', 'low', 'medium', 'high'] as const;

/** Each feature's default max output tokens: a document of 20 items, a rewrite, two SEO lines, one alt. */
const MAX_OUT: Record<AiFeature, number> = { translate: 4000, assist: 1500, seo: 400, alt: 300 };

const feature = (f: AiFeature) =>
  z
    .object({
      enabled: z.boolean().default(true),
      model: z.enum(MODEL_IDS).default('gemini-3.8-flash'),
      region: z.enum(['global', 'us', 'eu']).default('global'),
      reasoning: z.enum(REASONING).default('low'),
      maxOutputTokens: z.number().int().min(100).max(8000).default(MAX_OUT[f]),
      systemPrompt: z.string().max(4000, { error: 'Prompt tối đa 4000 ký tự.' }).default(''),
    })
    .refine((c) => MODEL_REGIONS[c.model as ModelId].includes(c.region), { error: 'Model này không có ở region đã chọn.', path: ['region'] })
    .prefault({});

export const AiSettingsSchema = z.object({
  features: z.object({ translate: feature('translate'), assist: feature('assist'), seo: feature('seo'), alt: feature('alt') }).prefault({}),
  brandVoice: z.string().max(2000, { error: 'Tối đa 2000 ký tự.' }).default(''),
  limits: z
    .object({ perMinute: z.number().int().min(1).max(100).default(10), perDay: z.number().int().min(1).max(5000).default(100) })
    .prefault({}),
  budgetUsd: z.number().min(0).max(10_000).default(20),
});
export type AiSettings = z.infer<typeof AiSettingsSchema>;
export type FeatureConfig = AiSettings['features'][AiFeature];
```

Kiểm cách zod 4 xử lý `.prefault`/`.default` trong `node_modules/zod`, rồi sửa nếu test Step 3 chưa xanh. Mục tiêu là `parse({})` ra đủ giá trị mặc định.

- [ ] **Step 5: Test đọc/ghi (thất bại; test DB, `describe.skipIf(!process.env.TEST_DATABASE_URL)` như các test integration khác).**
  - `loadAiSettings` trên hàng `{}` trả về giá trị mặc định, và `token` là `updated_at` dạng microsecond (`US('updated_at')` trong `lib/server/booking/config.ts`).
  - Lưu với token đúng: `data` đổi, có một dòng `audit_log` với `entity_type='ai_settings'`, `before` và `after`.
  - Lưu với token cũ: trả `{ ok:false, code:'conflict', params:{ by, at } }`.
  - Lưu `{ features: { seo: { model: 'gpt' } } }`: ném `ZodError`, vì action biến nó thành `invalid`.

- [ ] **Step 6: Viết `settings.ts`** theo khuôn `saveBookingSettings` (`lib/server/booking/config.ts:279`): `withTransaction`, rồi `SELECT … FOR UPDATE`, so token, `UPDATE`, `insertAudit`.

```ts
export async function cachedAiSettings(): Promise<AiSettings> {
  'use cache';
  cacheTag(TAGS.aiSettings);
  cacheLife('hours');
  const { rows } = await getPool().query<{ data: unknown }>('SELECT data FROM ai_settings WHERE id = 1');
  return AiSettingsSchema.parse(rows[0]?.data ?? {});
}
```

`cachedAiSettings` dùng cho các route AI. `loadAiSettings` (không cache, có token) dùng cho màn cấu hình.

- [ ] **Step 7: Chạy test.** Expected: PASS. Chạy thêm `npm run typecheck`.

- [ ] **Step 8: Commit** `Phase 9 D2: model catalogue, AI settings schema, read and save with conflict and audit`.

---

### Task D3: Client Vertex không khóa, chế độ `fake`, guard import

**Files:**
- Create: `lib/server/ai/mode.ts` (+ `.test.ts`), `lib/server/ai/client.ts` (+ `.test.ts`), `lib/server/ai/fake.ts`
- Create: `test/guards/ai-imports.guard.test.ts`
- Delete nothing. (Spike file không vào repo: chỉ chép ý từ `scratchpad/p9-spike/lib/server/ai/spike.ts`.)

**Interfaces:**
- Produces:
  - `resolveAiMode(env = process.env): AiMode`, với `type AiMode = { mode: 'vertex' | 'fake' } | { mode: 'off'; missing: string[] }`
  - `GCP_ENV = ['GCP_PROJECT_ID','GCP_PROJECT_NUMBER','GCP_SERVICE_ACCOUNT_EMAIL','GCP_WORKLOAD_IDENTITY_POOL_ID','GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID'] as const`
  - `envStatus(env): { name: string; present: boolean }[]`: tên biến và có/không, gồm `GCP_SERVICE_ACCOUNT_KEY`, **không bao giờ có giá trị**
  - `languageModel(cfg: FeatureConfig, env?): LanguageModel`
  - `providerOptions(cfg: FeatureConfig): ProviderOptions`

- [ ] **Step 1: Test `mode` (thất bại).**

```ts
const GCP = { GCP_PROJECT_ID: 'p', GCP_PROJECT_NUMBER: '1', GCP_SERVICE_ACCOUNT_EMAIL: 'sa@p.iam.gserviceaccount.com', GCP_WORKLOAD_IDENTITY_POOL_ID: 'vercel', GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: 'vercel' };

it('is vertex when every WIF id is set', () => expect(resolveAiMode(GCP)).toEqual({ mode: 'vertex' }));
it('is vertex with only the key fallback and the project', () =>
  expect(resolveAiMode({ GCP_PROJECT_ID: 'p', GCP_SERVICE_ACCOUNT_KEY: '{}' })).toEqual({ mode: 'vertex' }));
it('is off and names what is missing', () =>
  expect(resolveAiMode({ GCP_PROJECT_ID: 'p' })).toEqual({ mode: 'off', missing: ['GCP_PROJECT_NUMBER', 'GCP_SERVICE_ACCOUNT_EMAIL', 'GCP_WORKLOAD_IDENTITY_POOL_ID', 'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID'] }));
it('is fake when asked, except on Production', () => {
  expect(resolveAiMode({ AI_PROVIDER: 'fake' })).toEqual({ mode: 'fake' });
  expect(() => resolveAiMode({ AI_PROVIDER: 'fake', VERCEL_ENV: 'production' })).toThrow(/production/i);
});
it('refuses GOOGLE_VERTEX_API_KEY in every mode', () => {
  expect(() => resolveAiMode({ ...GCP, GOOGLE_VERTEX_API_KEY: 'k' })).toThrow(/GOOGLE_VERTEX_API_KEY/);
  expect(() => resolveAiMode({ AI_PROVIDER: 'fake', GOOGLE_VERTEX_API_KEY: 'k' })).toThrow();
});
it('refuses an unknown AI_PROVIDER', () => expect(() => resolveAiMode({ AI_PROVIDER: 'openai' })).toThrow());
it('reports presence, never values', () => {
  const s = envStatus({ ...GCP, GCP_SERVICE_ACCOUNT_KEY: 'secret' });
  expect(JSON.stringify(s)).not.toContain('secret');
  expect(s.find((x) => x.name === 'GCP_SERVICE_ACCOUNT_KEY')).toEqual({ name: 'GCP_SERVICE_ACCOUNT_KEY', present: true });
});
```

- [ ] **Step 2: Viết `mode.ts`** sao cho test xanh. Không `server-only`, để test thuần dùng được.

- [ ] **Step 3: Test `client` (thất bại).** Ba test, đều không ra mạng: `vi.stubGlobal('fetch', …)`, và fetch giả ném lỗi với mọi host không có trong danh sách giả.
  1. **WIF:** `vertexAuth(GCP, { getToken: async () => 'oidc-jwt' })` trả về một `ExternalAccountClient`.
     - Gán `client.stsCredential.transporter = client.transporter` (spike, gotcha 1).
     - Fetch giả trả STS `{access_token:'fed'}` rồi IAM `{accessToken:'sa-token', expireTime}`.
     - `getAccessToken()` phải ra `sa-token`.
     - Khẳng định body gửi STS có `subject_token=oidc-jwt` và `audience=//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/vercel/providers/vercel`.
  2. **Gemini:** `languageModel({ model:'gemini-3.8-flash', region:'global', … }, GCP, { authClient: fakeAuth, fetch })` gọi `doGenerate`. URL phải là `https://aiplatform.googleapis.com/v1beta1/projects/p/locations/global/publishers/google/models/gemini-3.8-flash:generateContent`, kèm `Authorization: Bearer sa-token`.
  3. **Claude:** `claude-sonnet-5-5` ở `us` thì URL chứa `aiplatform.us.rep.googleapis.com` và `publishers/anthropic/models/claude-sonnet-5-5:rawPredict`. `providerOptions(cfg)` có `anthropic.structuredOutputMode === 'outputFormat'`.

- [ ] **Step 4: Viết `client.ts`.**

```ts
import 'server-only';
import { createGoogleVertex } from '@ai-sdk/google-vertex';
import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic';
import type { GoogleLanguageModelOptions } from '@ai-sdk/google';
import type { AnthropicLanguageModelOptions } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import { ExternalAccountClient, type AuthClient } from 'google-auth-library';
import { getVercelOidcToken } from '@vercel/oidc';
import { modelById, type ModelId } from './models';
import { resolveAiMode } from './mode';
import { fakeModel } from './fake';
import type { FeatureConfig } from '@/lib/admin/ai-schemas';

type Env = Record<string, string | undefined>;

/*
 * Keyless Vertex auth (spec §9.1): the deployment's Vercel OIDC token is
 * exchanged at Google STS through Workload Identity Federation, then the
 * service account (roles/aiplatform.user) is impersonated. The supplier must
 * be a wrapper: called with GCP's audience, getVercelOidcToken would read it
 * as its own and make another request (spike gotcha 2). The fallback is a
 * service-account key in GCP_SERVICE_ACCOUNT_KEY, never in the database.
 */
export function vertexAuth(env: Env = process.env, deps: { getToken?: () => Promise<string> } = {}): AuthClient | { credentials: { client_email: string; private_key: string } } {
  if (env.GCP_SERVICE_ACCOUNT_KEY && !env.GCP_WORKLOAD_IDENTITY_POOL_ID) {
    const key = JSON.parse(env.GCP_SERVICE_ACCOUNT_KEY) as { client_email: string; private_key: string };
    return { credentials: { client_email: key.client_email, private_key: key.private_key } };
  }
  const getToken = deps.getToken ?? (() => getVercelOidcToken());
  const client = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience: `//iam.googleapis.com/projects/${env.GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${env.GCP_WORKLOAD_IDENTITY_POOL_ID}/providers/${env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID}`,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${env.GCP_SERVICE_ACCOUNT_EMAIL}:generateAccessToken`,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    subject_token_supplier: { getSubjectToken: () => getToken() },
  });
  if (!client) throw new Error('WIF configuration rejected by google-auth-library');
  return client;
}

/** A fresh provider per request (spec §9.1), from the feature's settings. */
export function languageModel(cfg: FeatureConfig, env: Env = process.env, deps: { authClient?: AuthClient; fetch?: typeof fetch } = {}): LanguageModel {
  const mode = resolveAiMode(env);
  if (mode.mode === 'fake') return fakeModel(cfg.model);
  if (mode.mode === 'off') throw new AiOffError(mode.missing);
  const auth = deps.authClient ?? vertexAuth(env);
  const googleAuthOptions = 'credentials' in auth ? { credentials: auth.credentials, projectId: env.GCP_PROJECT_ID } : { authClient: auth };
  const common = { project: env.GCP_PROJECT_ID!, location: cfg.region, googleAuthOptions, fetch: deps.fetch };
  return modelById(cfg.model as ModelId).provider === 'anthropic'
    ? createVertexAnthropic(common)(cfg.model)
    : createGoogleVertex(common)(cfg.model);
}

export function providerOptions(cfg: FeatureConfig) {
  if (modelById(cfg.model as ModelId).provider === 'anthropic') {
    return { anthropic: { structuredOutputMode: 'outputFormat', effort: cfg.reasoning === 'minimal' ? 'low' : cfg.reasoning } satisfies AnthropicLanguageModelOptions };
  }
  return { vertex: { thinkingConfig: { thinkingLevel: cfg.reasoning } } satisfies GoogleLanguageModelOptions };
}

export class AiOffError extends Error {
  constructor(readonly missing: string[]) {
    super('AI is not configured');
  }
}
```

  - Kiểm lại hai tên `effort` và `thinkingLevel` trong `node_modules/@ai-sdk/anthropic` và `node_modules/@ai-sdk/google` (spike đã ghi: `effort: 'low'…'max'`; `thinkingLevel: 'minimal'|'low'|'medium'|'high'`).
  - Gemini 3.8 Flash từ chối `minimal` (nghiên cứu model). Vì vậy `providerOptions` đổi `minimal` thành `low` khi model là `gemini-3.8-flash`, và test khóa điều này.

- [ ] **Step 5: Viết `fake.ts`.** Model giả dựng trên `MockLanguageModelV4` từ `ai/test`, có thể đoán trước:
  - **`doGenerate`:**
    - Nếu prompt chứa JSON `{"items":[…]}` (dịch), trả `{items}` với mỗi `text` là `«<locale>» ` cộng chữ gốc, giữ nguyên mọi `⟦…⟧`.
    - Nếu là SEO, trả `{title:'Fake title', description:'Fake description'}`.
    - Nếu là alt, trả `'A fake description of the image.'`.
    - Nhận biết loại lời gọi qua dòng đầu của `instructions`: `TASK: translate|seo|alt|check`. Các module D7, D10, D11 đặt dòng này.
  - **`doStream`:** stream `«<action>» ` cộng chữ gốc, chia ba mảnh.
  - **Usage** cố định: `inputTokens.total = 100`, `outputTokens.total = 50`.
  - **Hai cờ test, chỉ đọc khi `mode = fake`:**
    - `AI_FAKE_FAIL=<feature>:<status>` (ví dụ `translate:429`) làm `doGenerate` ném `APICallError` với status đó. E2E dùng cờ này cho Review Focus 5.
    - `AI_FAKE_DROP_TOKEN=1` làm bản dịch giả bỏ ký hiệu `⟦G1⟧`.

  > `ai/test` là entry point trong gói `ai`, nằm trong dependencies, nên import được ở runtime. Kiểm `next build` không cảnh báo về nó. Nếu có, chép class mock tối thiểu vào `fake.ts` (implement `LanguageModelV4`).

- [ ] **Step 6: Guard import (thất bại trước, rồi xanh).** `test/guards/ai-imports.guard.test.ts`, theo khuôn `blob-imports.guard.test.ts`:
  - Quét `app/`, `lib/`, `components/` và `scripts/`.
  - Chỉ file dưới `lib/server/ai/` được import `ai`, `ai/test`, `@ai-sdk/google-vertex*`, `@ai-sdk/google`, `@ai-sdk/anthropic`, `google-auth-library` và `@vercel/oidc`.
  - Ngoại lệ:
    - `@ai-sdk/react`, chỉ ở `app/admin/(shell)/_kit/AssistPanel.tsx`;
    - `ai`, chỉ ở `app/api/admin/ai/**/route.ts`, cho `createTextStreamResponse` và `toTextStream`.
  - File dưới `lib/server/ai/` không được import `@/lib/server/booking`, `@/lib/server/email`, và không chứa chuỗi `reservations` (Global Constraints: dữ liệu cá nhân).

- [ ] **Step 7: Chạy** `npx vitest run lib/server/ai test/guards/ai-imports.guard.test.ts` và `npm run typecheck`. Expected: PASS.

- [ ] **Step 8: Commit** `Phase 9 D3: keyless Vertex client (WIF, key fallback), the fake model, AI import guard`.

---

### Task D4: Rào chắn: ngân sách, giới hạn theo người, sổ `ai_usage`

**Files:**
- Create: `lib/server/ai/guard.ts`, `lib/server/ai/guard.test.ts`, `lib/server/ai/errors.ts`, `lib/server/ai/errors.test.ts`
- Modify: `lib/server/action-result.ts` (các mã R9-15), `lib/admin/auth-errors.ts` (câu tiếng Việt)

**Interfaces:**
- Consumes: `priceUsd`, `ModelId`, `Region` (D2); `AiSettings`, `AiFeature` (D2).
- Produces:

```ts
export type AiCallMeta = {
  feature: AiFeature | 'check';
  model: ModelId;
  region: Region;
  /** NULL: not counted per person (bulk job, automatic alt). */
  actorId: string | null;
  jobId?: string;
  /** Characters sent (for the ceiling); output ceiling is maxOutputTokens. */
  inputChars: number;
  maxOutputTokens: number;
  signal?: AbortSignal;
};
export class AiError extends Error { constructor(readonly code: AiErrorCode, readonly params?: Record<string, string | number>) }
export type AiErrorCode = 'ai_off' | 'ai_budget' | 'ai_rate_minute' | 'ai_rate_day' | 'ai_auth' | 'ai_not_found' | 'ai_quota' | 'ai_bad_request' | 'ai_failed' | 'ai_placeholder' | 'ai_preview';
/** Reserve → call → settle (R9-3, R9-4). fn receives the signal; returns its result and usage. */
export function runAiCall<T>(pool: Pool, settings: AiSettings, meta: AiCallMeta,
  fn: (signal: AbortSignal | undefined) => Promise<{ value: T; usage: { inputTokens?: number; outputTokens?: number } }>): Promise<T>;
export function monthSpendUsd(db: Db): Promise<{ spent: number; byFeature: Record<string, number> }>;
export function vertexErrorCode(err: unknown): AiErrorCode; // errors.ts
```

- [ ] **Step 1: Test `errors.ts` (thất bại).** Đầu vào là `APICallError` của `ai` (`import { APICallError } from 'ai'`):

| Đầu vào | Mã |
|---|---|
| `statusCode` 401 hoặc 403 | `ai_auth` |
| 404 | `ai_not_found` |
| 429 | `ai_quota` |
| 400 | `ai_bad_request` |
| 500 | `ai_failed` |
| `DOMException` `TimeoutError`/`AbortError` | `ai_failed` |
| `NoObjectGeneratedError` | `ai_failed` |
| `AiOffError` | `ai_off` |
| `AiError` | giữ nguyên mã |

  Thêm một lỗi `GaxiosError` của google-auth-library, có `response.status = 403`, phải ra `ai_auth`: lỗi đổi token WIF đi qua đường này.

- [ ] **Step 2: Viết `errors.ts`.**

- [ ] **Step 3: Test `guard.ts` (thất bại, test DB).** Seed một `staff_user`. Cấu hình: `budgetUsd: 1`, `limits: { perMinute: 3, perDay: 5 }`.

```ts
const ok = async () => ({ value: 'x', usage: { inputTokens: 1000, outputTokens: 1000 } });
const meta = (o: Partial<AiCallMeta> = {}): AiCallMeta => ({ feature: 'translate', model: 'gemini-3.8-flash', region: 'global', actorId: STAFF, inputChars: 300, maxOutputTokens: 1000, ...o });

it('settles the real cost', async () => {
  await runAiCall(pool, settings, meta(), ok);
  const { rows } = await pool.query(`SELECT status, input_tokens, output_tokens, cost_usd::float AS c FROM ai_usage`);
  expect(rows).toEqual([{ status: 'ok', input_tokens: 1000, output_tokens: 1000, c: expect.closeTo(0.009, 6) }]);
});

it('blocks the fourth call in a minute, counting only that person', async () => {
  for (let i = 0; i < 3; i++) await runAiCall(pool, settings, meta(), ok);
  await expect(runAiCall(pool, settings, meta(), ok)).rejects.toMatchObject({ code: 'ai_rate_minute' });
  await runAiCall(pool, settings, meta({ actorId: null }), ok); // a job is not a person
});

it('blocks per day from 00:00 Vietnam time', async () => {
  await pool.query(`INSERT INTO ai_usage (at, actor_id, feature, model, region, status) SELECT now() - interval '2 minutes', $1, 'translate', 'gemini-3.8-flash', 'global', 'ok' FROM generate_series(1,5)`, [STAFF]);
  await expect(runAiCall(pool, settings, meta(), ok)).rejects.toMatchObject({ code: 'ai_rate_day' });
});

it('blocks when the month plus the ceiling would pass the budget, for every caller', async () => {
  await pool.query(`INSERT INTO ai_usage (actor_id, feature, model, region, status, cost_usd) VALUES (NULL, 'translate', 'gemini-3.8-flash', 'global', 'ok', 0.995)`);
  await expect(runAiCall(pool, settings, meta({ actorId: null }), ok)).rejects.toMatchObject({ code: 'ai_budget' });
});

it('concurrent calls: exactly the limit passes, exactly one passes on the last of the budget', async () => {
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => runAiCall(pool, settings, meta(), ok)));
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
  await pool.query(`DELETE FROM ai_usage`);
  // ceiling of one call ≈ (100 + 1000×7.5)/1e6… set the month so that one ceiling fits, two do not
  await pool.query(`INSERT INTO ai_usage (actor_id, feature, model, region, status, cost_usd) VALUES (NULL, 'translate', 'gemini-3.8-flash', 'global', 'ok', 0.990)`);
  const two = await Promise.allSettled([runAiCall(pool, settings, meta({ actorId: null }), ok), runAiCall(pool, settings, meta({ actorId: null }), ok)]);
  expect(two.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
});

it('settles an error at zero and maps its code', async () => {
  await expect(runAiCall(pool, settings, meta(), async () => { throw new APICallError({ message: 'q', url: 'u', requestBodyValues: {}, statusCode: 429 }); }))
    .rejects.toMatchObject({ code: 'ai_quota' });
  const { rows } = await pool.query(`SELECT status, error_code, cost_usd::float AS c FROM ai_usage`);
  expect(rows).toEqual([{ status: 'error', error_code: 'ai_quota', c: 0 }]);
});

it('refuses an already aborted signal without a row', async () => {
  const ac = new AbortController(); ac.abort();
  await expect(runAiCall(pool, settings, meta({ signal: ac.signal }), ok)).rejects.toMatchObject({ code: 'ai_failed' });
  expect((await pool.query('SELECT 1 FROM ai_usage')).rowCount).toBe(0);
});
```

  Khi viết, chỉnh số `0.990` sao cho đúng một trần ước lượng còn vừa. Trần là `priceUsd(model, region, ceil(inputChars/3) + 500, maxOutputTokens)`, trong đó 500 là phần cho prompt hệ thống và thuật ngữ.

- [ ] **Step 4: Viết `guard.ts`.**

```ts
import 'server-only';
import type { Pool } from 'pg';
import { withTransaction } from '@/lib/server/audit';
import { priceUsd } from './models';
import { AiError, vertexErrorCode } from './errors';

/** Tokens for the system prompt, glossary and JSON frame on top of the text (R9-4 ceiling). */
const OVERHEAD_TOKENS = 500;
const VN_DAY = `date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'`;
const VN_MONTH = `date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'`;

export function ceilingUsd(meta: AiCallMeta): number {
  return priceUsd(meta.model, meta.region, Math.ceil(meta.inputChars / 3) + OVERHEAD_TOKENS, meta.maxOutputTokens);
}

async function reserve(pool: Pool, settings: AiSettings, meta: AiCallMeta): Promise<string> {
  const ceiling = ceilingUsd(meta);
  return withTransaction(pool, async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('ai:budget'))`);
    if (meta.actorId) {
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('ai:' || $1))`, [meta.actorId]);
      const { rows } = await c.query<{ minute: number; day: number }>(
        `SELECT count(*) FILTER (WHERE at > now() - interval '60 seconds')::int AS minute,
                count(*) FILTER (WHERE at >= ${VN_DAY})::int AS day
           FROM ai_usage WHERE actor_id = $1 AND feature <> 'check' AND at >= ${VN_DAY} - interval '1 minute'`,
        [meta.actorId],
      );
      if (rows[0].minute >= settings.limits.perMinute) throw new AiError('ai_rate_minute', { limit: settings.limits.perMinute });
      if (rows[0].day >= settings.limits.perDay) throw new AiError('ai_rate_day', { limit: settings.limits.perDay });
    }
    const { rows: m } = await c.query<{ spent: string }>(`SELECT coalesce(sum(cost_usd), 0) AS spent FROM ai_usage WHERE at >= ${VN_MONTH}`);
    if (Number(m[0].spent) + ceiling > settings.budgetUsd) throw new AiError('ai_budget', { budget: settings.budgetUsd });
    const { rows: r } = await c.query<{ id: string }>(
      `INSERT INTO ai_usage (actor_id, feature, model, region, cost_usd, status, job_id) VALUES ($1, $2, $3, $4, $5, 'pending', $6) RETURNING id::text`,
      [meta.actorId, meta.feature, meta.model, meta.region, ceiling, meta.jobId ?? null],
    );
    return r[0].id;
  });
}

export async function runAiCall<T>(pool, settings, meta, fn) {
  if (meta.signal?.aborted) throw new AiError('ai_failed');
  const id = await reserve(pool, settings, meta);
  try {
    const { value, usage } = await fn(meta.signal);
    const i = usage.inputTokens ?? 0, o = usage.outputTokens ?? 0;
    await pool.query(`UPDATE ai_usage SET status='ok', input_tokens=$2, output_tokens=$3, cost_usd=$4 WHERE id=$1`, [id, i, o, priceUsd(meta.model, meta.region, i, o)]);
    return value;
  } catch (err) {
    const code = vertexErrorCode(err);
    await pool.query(`UPDATE ai_usage SET status='error', error_code=$2, cost_usd=0 WHERE id=$1`, [id, code]).catch(() => {});
    throw err instanceof AiError ? err : new AiError(code);
  }
}
```

  - Lời gọi "Kiểm tra kết nối" (`feature: 'check'`) cũng đi qua `runAiCall` với `actorId: null`. Nó có tính vào ngân sách, nhưng không tính vào giới hạn theo người, và không bị giới hạn chặn: Admin đã hết lượt vẫn kiểm tra kết nối được.
  - Gọi `vertexErrorCode` lên chính `AiError` thì giữ nguyên mã của nó.

- [ ] **Step 5: Sửa `action-result.ts`.** Thêm các mã R9-15 vào `ActionCode`. `actionError(err)` biến `AiError` thành `{ ok:false, code: err.code, params: err.params }`. Thêm câu tiếng Việt vào `actionErrorMessage`, có test trong `action-result.test.ts`.
  - Viết thêm helper `aiErrorResponse(err): Response` cho route handler (`lib/server/ai/http.ts`). Hàm này trả `Response.json({ code, message }, { status })`, với status như sau:

| Mã | Status |
|---|---|
| `ai_rate_*` | 429 |
| `ai_budget` | 402 |
| `ai_off`, `ai_preview` | 409 |
| `ai_placeholder` | 422 |
| các mã Vertex | 502 |
| `forbidden` | 403 |
| `invalid` | 400 |

    Mọi response đều có `NO_STORE`.

- [ ] **Step 6: Chạy test.** Expected: PASS. Chạy thêm `npm run typecheck`.

- [ ] **Step 7: Commit** `Phase 9 D4: one guard for every AI call: budget, per-person limits, usage ledger reserve and settle`.

---

### Task D5: Thuật ngữ: che, trả, kiểm biến; màn thuật ngữ

**Files:**
- Create: `lib/server/ai/glossary.ts`, `lib/server/ai/glossary.test.ts`
- Create: `app/admin/(shell)/settings/ai/GlossaryTable.tsx`. Action nằm trong `settings/ai/actions.ts` (D6 tạo trang; D5 tạo `actions.ts` với `saveGlossaryAction` và `deleteGlossaryAction`).

**Interfaces:**
- Produces:

```ts
export type GlossaryEntry = { term: string; mode: 'keep' | 'map'; locale: string | null; target: string | null; auto?: boolean };
export function loadGlossary(db: Db, locale: string): Promise<GlossaryEntry[]>; // ai_glossary rows for that locale or NULL, plus restaurant names (auto, keep)
export type Masked = { text: string; tokens: { token: string; restore: string }[] };
export function mask(text: string, glossary: readonly GlossaryEntry[], targetLocale: string): Masked;
export function unmask(translated: string, masked: Masked): { ok: true; text: string } | { ok: false };
export function listGlossary(db: Db): Promise<(GlossaryEntry & { id: string | null })[]>;
export function saveGlossaryEntry(pool, actor, input: { id?: string; term; mode; locale; target }): Promise<ActionResult<{ id: string }>>;
export function deleteGlossaryEntry(pool, actor, id: string): Promise<ActionResult>;
```

- [ ] **Step 1: Test che và trả (thất bại).** Hàm thuần, không cần DB.

```ts
const G: GlossaryEntry[] = [
  { term: 'Tàya House', mode: 'keep', locale: null, target: null },
  { term: 'Tàya', mode: 'keep', locale: null, target: null },
  { term: 'Da Nang', mode: 'map', locale: 'vi', target: 'Đà Nẵng' },
];

it('masks longest terms first, whole words only, and simple ICU variables', () => {
  const m = mask('Book Tàya House in Da Nang, call {phone}. Tàyara is not Tàya.', G, 'vi');
  expect(m.text).toBe('Book ⟦G1⟧ in ⟦G2⟧, call ⟦V1⟧. Tàyara is not ⟦G3⟧.');
  expect(m.tokens.map((t) => t.restore)).toEqual(['Tàya House', 'Đà Nẵng', '{phone}', 'Tàya']);
});
it('keeps a map term as written when the target language has no target', () => {
  expect(mask('Da Nang', G, 'ko').text).toBe('Da Nang'); // a vi-only mapping is not a ko term
});
it('restores every token once', () => {
  const m = mask('Tàya House, {phone}', G, 'vi');
  expect(unmask('⟦G1⟧, gọi ⟦V1⟧', m)).toEqual({ ok: true, text: 'Tàya House, gọi {phone}' });
});
it('refuses a dropped, duplicated or invented token', () => {
  const m = mask('Tàya House, {phone}', G, 'vi');
  expect(unmask('gọi ⟦V1⟧', m)).toEqual({ ok: false });
  expect(unmask('⟦G1⟧ ⟦G1⟧ ⟦V1⟧', m)).toEqual({ ok: false });
  expect(unmask('⟦G1⟧ ⟦V1⟧ ⟦G9⟧', m)).toEqual({ ok: false });
});
it('leaves plural and select messages unmasked (their words need translating)', () => {
  const t = '{count, plural, one {# guest} other {# guests}} at Tàya House';
  expect(mask(t, G, 'vi').text).toBe('{count, plural, one {# guest} other {# guests}} at ⟦G1⟧');
});
it('does not match inside a word or across case', () => {
  expect(mask('tàya house', G, 'vi').tokens).toHaveLength(0);
});
```

  Ranh giới từ: dùng `(?<![\p{L}\p{N}])` và `(?![\p{L}\p{N}])` với cờ `u`. Ký tự đặc biệt trong thuật ngữ phải được escape. So khớp trên chuỗi đã chuẩn hóa NFC: cả thuật ngữ lẫn văn bản đều qua `.normalize('NFC')`.

  Biến ICU: chỉ che `{name}` đứng riêng, tức không có dấu phẩy bên trong. Nếu `messageArgs(text)` có `plural`, `select` hay `selectordinal`, thì không che biến nào cả. Lúc đó việc kiểm biến dựa vào `checkMessage` ở D7.

- [ ] **Step 2: Viết `mask`/`unmask`.** Đánh số ký hiệu theo thứ tự xuất hiện trong văn bản: G cho thuật ngữ, V cho biến.

- [ ] **Step 3: Test DB (thất bại).**
  - `loadGlossary(db, 'vi')` trả các hàng có `locale IS NULL` hoặc `locale = 'vi'`, cộng mọi `restaurants.name` (`auto: true`, `keep`).
  - Đổi tên một nhà hàng thì lần đọc kế tiếp thấy ngay tên mới.
  - `saveGlossaryEntry`:
    - trùng `(term, locale)` thì trả `invalid` với câu "Thuật ngữ này đã có.";
    - `map` thiếu `target` hoặc `locale` thì trả `invalid`;
    - lưu thành công thì có audit `entity_type='ai_glossary'`;
    - `locale` không có trong `locales` thì trả `invalid`.
  - `deleteGlossaryEntry` ghi audit.

- [ ] **Step 4: Viết phần DB.** `updateTag(TAGS.aiSettings)` nằm ở action, không nằm trong lib.

- [ ] **Step 5: `GlossaryTable.tsx` và action.**
  - **Bảng:** cột Thuật ngữ, Cách xử lý (Giữ nguyên / Đổi thành…), Ngôn ngữ (Mọi ngôn ngữ / mã), Đổi thành, và nút Sửa/Xóa. Dòng tự động có nhãn "Tên nhà hàng (tự động)" và không có nút.
  - **Form thêm:** viết theo form kit (`TextField`, `SaveBar`).
  - **Actions** (`settings/ai/actions.ts`, `'use server'`):
    - `saveGlossaryAction(_prev, formData)` và `deleteGlossaryAction(_prev, formData)`;
    - cả hai `requirePermission({ settings: ['update'] })` ở câu lệnh đầu tiên;
    - zod;
    - `updateTag(TAGS.aiSettings)`.
  - Thêm `app/admin/(shell)/settings/ai/actions.ts` vào `ADMIN_ONLY_ACTIONS` (`test/guards/require-permission.guard.test.ts:47`).

- [ ] **Step 6: Chạy** `npx vitest run lib/server/ai/glossary.test.ts test/guards/require-permission.guard.test.ts`. Expected: PASS.

- [ ] **Step 7: Commit** `Phase 9 D5: glossary masking (terms, simple variables), restaurant names as keep terms, the glossary table`.

## Bản kiểm chứng (Phần 1)

- `npm run typecheck`, `npm run lint` (0 warnings), `TEST_DATABASE_URL=… npm test`: đều xanh.
- `npm ls google-auth-library @vercel/oidc`: mỗi gói một bản.
- Không test nào gọi ra mạng. Chạy `npx vitest run lib/server/ai` trong lúc tắt mạng (hoặc đặt `HTTPS_PROXY=http://127.0.0.1:9`) vẫn phải xanh.

### Bàn giao cho Phần 2

`runAiCall`, `languageModel`, `providerOptions`, `cachedAiSettings`, `mask`/`unmask`, `loadGlossary` và các mã lỗi đều đã có. Phần 2 chỉ ghép chúng lại thành tính năng.

---

## PHẦN 2: tính năng (D6–D10)

### Task D6: Màn `/admin/settings/ai` và "Kiểm tra kết nối"

**Files:**
- Create: `app/admin/(shell)/settings/ai/page.tsx`, `AiSettingsForm.tsx`, `ConnectionCheck.tsx`. Mở rộng `actions.ts` (có từ D5) với `saveAiSettingsAction` và `checkConnectionAction`.
- Create: `lib/server/ai/check.ts`, `lib/server/ai/check.test.ts`
- Modify: `lib/admin/nav.ts` (mục "AI", `href: '/admin/settings/ai'`, chỉ Admin, giống mục "Thông báo")
- Test: `e2e/settings-ai.spec.ts`

**Interfaces:**
- Consumes: `loadAiSettings`, `saveAiSettings` (D2); `resolveAiMode`, `envStatus`, `languageModel`, `providerOptions` (D3); `runAiCall`, `monthSpendUsd` (D4); `listGlossary` (D5).
- Produces: `checkConnection(pool, settings, opts: { deadlineMs: number; withImage: boolean }): Promise<CheckRow[]>`, với `CheckRow = { features: AiFeature[]; model; region; steps: { step: 'env'|'token'|'text'|'structured'|'image'; ok: boolean; ms: number; tokens?: number; code?: AiErrorCode }[] }`.

- [ ] **Step 1: Test `check.ts` (thất bại, chạy với `AI_PROVIDER=fake` và test DB).**
  - Các tính năng dùng chung một cặp (model, region) được gộp vào một dòng.
  - Một tính năng đang tắt thì không được kiểm.
  - Ở chế độ `fake`, cả năm bước `ok`.
  - Với `AI_FAKE_FAIL=check:403`: bước `text` trả `ai_auth`, các bước sau của cặp đó bị bỏ qua (không có trong `steps`).
  - Chế độ `off`: chỉ có bước `env` và nó `ok:false`.
  - Hạn 20 giây chung: các cặp chưa kịp chạy có `steps: []` và cờ `timedOut: true`.
  - Mỗi bước gọi model thì tạo một hàng `ai_usage` với `feature='check'`.

- [ ] **Step 2: Viết `check.ts`.** Các bước:
  1. `env`: `resolveAiMode`.
  2. `token`: ở chế độ `vertex`, `vertexAuth().getAccessToken()`; ở chế độ `fake`, bỏ qua và coi là `ok`.
  3. `text`: `generateText({ model, instructions: 'TASK: check', prompt: 'Reply with OK.', maxOutputTokens: 20 })`.
  4. `structured`: `Output.object({ schema: z.object({ ok: z.boolean() }) })`.
  5. `image`: chỉ chạy khi `withImage` và model có `image: true`. Gửi một PNG 8×8 dựng sẵn bằng `sharp` (màu đỏ), như một `file` part.

  Mỗi bước có `AbortSignal.timeout(min(8000, thời gian còn lại tới hạn))`.

- [ ] **Step 3: Trang.**
  - `page.tsx` gọi `requirePagePermission({ settings: ['read'] })`.
  - **Khối "Kết nối":**
    - chế độ: Vertex / Giả (dev) / Chưa cấu hình;
    - bảng có/không cho từng biến (`envStatus`);
    - `GCP_PROJECT_ID` hiện nguyên giá trị, vì đây là ID chứ không phải bí mật (spec §9.2);
    - nút "Kiểm tra kết nối" (`ConnectionCheck.tsx`, `useActionState`), kết quả là một bảng theo cặp (model, region): tính năng, các bước ✓/✗, độ trễ, số token, câu lỗi tiếng Việt;
    - ô "Thử cả mô tả ảnh".
  - **Khối "Chi phí tháng này":**
    - đã dùng / ngân sách, kèm thanh phần trăm;
    - bảng theo tính năng;
    - 20 lời gọi gần nhất: thời điểm, người (tên, hoặc "Tự động"), tính năng, model, token, $, trạng thái hoặc mã lỗi.
  - **Khối "Tính năng"** (`AiSettingsForm.tsx`): mỗi tính năng có các ô bật/tắt, model (`<select>` theo danh mục), region (chỉ các region model đó hỗ trợ; đổi model thì danh sách region đổi theo), mức suy luận, token tối đa, system prompt (textarea).
  - **Khối "Chung":** prompt giọng thương hiệu, giới hạn mỗi phút và mỗi ngày, ngân sách USD.
  - **Khối "Thuật ngữ":** `GlossaryTable` (D5).
  - **Lưu:** một `SaveBar` cho cả form, có token chống xung đột như các màn settings khác. Action `saveAiSettingsAction`:
    1. `requirePermission({ settings: ['update'] })`;
    2. `AiSettingsSchema.parse` (form gửi `data` dạng JSON trong một field ẩn, như các danh sách của 7B);
    3. `saveAiSettings`;
    4. `updateTag(TAGS.aiSettings)`.
  - **`checkConnectionAction`:** `requirePermission({ settings: ['update'] })`, rồi `checkConnection(…, { deadlineMs: 20_000 })`.

- [ ] **Step 4: E2E `e2e/settings-ai.spec.ts`** (chạy với `AI_PROVIDER=fake`, thêm vào `playwright.config.ts` `webServer.env`):
  - Admin mở `/admin/settings/ai` và thấy "Giả (dev)".
  - Bấm "Kiểm tra kết nối": thấy ✓ ở mọi bước của `gemini-3.8-flash · global`.
  - Đổi model của SEO sang Claude Sonnet 5.5 ở `eu` rồi lưu, tải lại trang vẫn còn. Kiểm tra lại thì có hai dòng.
  - Đổi ngân sách thành `abc` thì thấy câu lỗi tiếng Việt ở đúng ô.
  - Editor vào `/admin/settings/ai` thì bị chặn, giống `/admin/settings/booking`.
  - Trang không chứa giá trị của biến bí mật nào. Đặt `GCP_SERVICE_ACCOUNT_KEY=e2e-secret-marker` trong env của web server E2E, rồi khẳng định HTML không chứa `e2e-secret-marker`.

- [ ] **Step 5: Chạy** unit, rồi `npm run test:e2e -- e2e/settings-ai.spec.ts` (kèm khối env đã blank của README). Expected: PASS.

- [ ] **Step 6: Commit** `Phase 9 D6: /admin/settings/ai: features, brand voice, limits, budget, spend, glossary, and the connection check`.

---

### Task D7: Dịch từng trường ("Dịch từ EN")

**Files:**
- Create: `lib/server/ai/translate.ts`, `lib/server/ai/translate.test.ts`
- Create: `app/api/admin/ai/translate/route.ts`, `lib/server/ai/http.ts` (nếu D4 chưa tạo), `lib/server/ai/route-guard.ts`
- Create: `app/admin/(shell)/_kit/AiTranslateButton.tsx`, `app/admin/(shell)/_kit/useAiFeatures.ts`
- Modify: `app/admin/(shell)/_kit/TranslatableField.tsx`, `app/admin/(shell)/content/_ui/StringsForm.tsx`, layout admin `(shell)/layout.tsx` (cấp `aiFeatures` qua context)
- Test: `e2e/ai.serial.spec.ts` (phần dịch từng trường)

**Interfaces:**
- Consumes: D2–D5.
- Produces:

```ts
export type TranslateItem = { id: string; text: string; context?: string; maxLength?: number; vars?: readonly string[] };
export type Translated = { id: string; ok: true; text: string } | { id: string; ok: false; code: 'ai_placeholder' | 'too_long' };
/** One document, one call (spec §9.3). */
export function translateItems(pool: Pool, input: { items: TranslateItem[]; locale: string; actorId: string | null; jobId?: string; signal?: AbortSignal }): Promise<{ results: Translated[]; model: ModelId }>;
/** Every /api/admin/ai/* route's first lines: permission, origin, draft mode, feature on. */
export function aiRoute(request: Request, feature: AiFeature): Promise<{ staff: StaffSession; settings: AiSettings }>;
/** Client: which AI features this page may show (mode not off and feature enabled). */
export type AiFeatures = Record<AiFeature, boolean>;
export function loadAiFeatures(): Promise<AiFeatures>;
```

- [ ] **Step 1: Test `translate.ts` (thất bại, chạy `fake`, test DB).**

```ts
it('translates a document in one call, keeping names and variables', async () => {
  const { results } = await translateItems(pool, { locale: 'vi', actorId: STAFF, items: [
    { id: 'a', text: 'Book Tàya House on {date}.', vars: ['date'] },
    { id: 'b', text: '{count, plural, one {# guest} other {# guests}}', vars: ['count'] },
  ] });
  expect(results).toEqual([
    { id: 'a', ok: true, text: '«vi» Book Tàya House on {date}.' },
    { id: 'b', ok: true, text: '«vi» {count, plural, one {# guest} other {# guests}}' },
  ]);
  expect((await pool.query(`SELECT count(*)::int AS n FROM ai_usage WHERE feature='translate'`)).rows[0].n).toBe(1);
});

it('rejects a dropped token (AI_FAKE_DROP_TOKEN)', async () => {
  vi.stubEnv('AI_FAKE_DROP_TOKEN', '1');
  const { results } = await translateItems(pool, { locale: 'vi', actorId: STAFF, items: [{ id: 'a', text: 'Tàya House' }] });
  expect(results).toEqual([{ id: 'a', ok: false, code: 'ai_placeholder' }]);
});

it('rejects a missing id or a changed ICU structure', async () => { /* a MockLanguageModelV4 injected via a test-only seam returning items without 'b', and one whose plural lost its `other` */ });
it('marks a result longer than maxLength', async () => { /* maxLength: 5 → { ok:false, code:'too_long' } */ });
it('sends the glossary map target, the brand voice, the context and the system prompt', async () => {
  /* inspect model.doGenerateCalls[0].prompt: instructions contain the settings.features.translate.systemPrompt and the item's context; the text contains ⟦G1⟧, never 'Tàya House' */
});
```

  Test seam: `translateItems` nhận thêm tham số thứ ba, tùy chọn, `deps?: { model?: LanguageModel }`. Test truyền `MockLanguageModelV4` qua đó. Route không bao giờ truyền tham số này.

- [ ] **Step 2: Viết `translate.ts`.**

```ts
const Result = z.object({ items: z.array(z.object({ id: z.string(), text: z.string() })) });

export async function translateItems(pool, { items, locale, actorId, jobId, signal }, deps = {}) {
  const settings = await cachedAiSettings();
  const cfg = settings.features.translate;
  if (!cfg.enabled) throw new AiError('ai_off');
  const glossary = await loadGlossary(pool, locale);
  const masked = items.map((it) => ({ it, m: mask(it.text, glossary, locale) }));
  const language = localeName(locale); // lib/i18n/catalog.ts English name, e.g. 'Vietnamese'
  const instructions = [
    'TASK: translate',
    `Translate each item's text from English to ${language} for a luxury resort's restaurant website.`,
    'Keep every ⟦…⟧ token exactly once and unchanged. Keep ICU MessageFormat syntax ({name}, {n, plural, …}, #) and translate only the words inside it.',
    'Return JSON {"items":[{"id","text"}]} with the same ids.',
    settings.brandVoice && `Brand voice: ${settings.brandVoice}`,
    cfg.systemPrompt,
  ].filter(Boolean).join('\n');
  const prompt = JSON.stringify({ items: masked.map(({ it, m }) => ({ id: it.id, text: m.text, context: it.context, maxLength: it.maxLength })) });
  const model = deps.model ?? languageModel(cfg);
  const out = await runAiCall(pool, settings, { feature: 'translate', model: cfg.model, region: cfg.region, actorId, jobId, inputChars: prompt.length + instructions.length, maxOutputTokens: cfg.maxOutputTokens, signal }, async (sig) => {
    const r = await generateText({ model, instructions, prompt, output: Output.object({ schema: Result }), maxOutputTokens: cfg.maxOutputTokens, maxRetries: 1, timeout: 60_000, abortSignal: sig, providerOptions: providerOptions(cfg) });
    return { value: r.output, usage: r.totalUsage };
  });
  const byId = new Map(out.items.map((x) => [x.id, x.text]));
  const results = masked.map(({ it, m }): Translated => {
    const raw = byId.get(it.id);
    if (raw === undefined) return { id: it.id, ok: false, code: 'ai_placeholder' };
    const u = unmask(raw, m);
    if (!u.ok) return { id: it.id, ok: false, code: 'ai_placeholder' };
    if (checkMessage(u.text, it.vars ?? [], messageArgs(it.text)).length) return { id: it.id, ok: false, code: 'ai_placeholder' };
    if (it.maxLength && [...u.text].length > it.maxLength) return { id: it.id, ok: false, code: 'too_long' };
    return { id: it.id, ok: true, text: u.text };
  });
  return { results, model: cfg.model };
}
```

  - Model giả (D3) đọc ngôn ngữ đích từ dòng `Translate each item's text from English to <Language>` trong `instructions`, và in ra mã ngôn ngữ, ví dụ `«vi»`.
  - Nếu `lib/i18n/catalog.ts` chưa có tên tiếng Anh của ngôn ngữ, thêm trường `english` cho 13 ngôn ngữ.
  - Đầu vào tối đa: 20 item, tổng 4 000 ký tự. Route trả `invalid` khi vượt.

- [ ] **Step 3: `route-guard.ts` và route.**

```ts
export async function aiRoute(request: Request, feature: AiFeature) {
  const staff = await requirePermission({ content: ['ai'] }); // first statement: the CI guard
  assertSameOrigin(request);                                  // as app/api/admin/media/upload/route.ts
  if ((await draftMode()).isEnabled) throw new AiError('ai_preview');
  const settings = await cachedAiSettings();
  if (resolveAiMode().mode === 'off' || !settings.features[feature].enabled) throw new AiError('ai_off');
  return { staff, settings };
}
```

  Route `POST /api/admin/ai/translate`:
  - body zod: `{ locale: LOCALE_CODE (khác mặc định, có trong bảng locales), items: [{ id, text ≤ 4000, key?: StringKey }] (1..20) }`;
  - với item có `key`, server lấy `context`, `maxLength` và `vars` từ `REGISTRY` (không tin client);
  - gọi `translateItems`, trả `{ results }`;
  - lỗi đi qua `aiErrorResponse`;
  - `export const maxDuration = 60`.

  Mỗi route handler bắt đầu bằng `try { await requirePermission(...) } catch` theo khuôn guard. Nếu guard chưa nhận `aiRoute` là đủ, viết `requirePermission` trực tiếp ở dòng đầu rồi mới gọi `aiRoute` cho phần còn lại.

- [ ] **Step 4: UI.**
  - `loadAiFeatures()` (server) đọc `cachedAiSettings` và `resolveAiMode`. Layout `(shell)` truyền kết quả vào `AiFeaturesProvider`, và `useAiFeatures()` đọc nó. Chế độ `off` thì mọi tính năng là `false`.
  - **`AiTranslateButton({ english, locale, itemKey?, onResult })`:**
    - nút "Dịch từ EN", có trạng thái đang dịch;
    - `fetch('/api/admin/ai/translate', { method:'POST', body })`;
    - lỗi thì hiện câu tiếng Việt từ `message` của response, ngay dưới nút, trong `role="status"`;
    - thành công thì gọi `onResult(text)`.
  - **`TranslatableField`:** trong panel của mỗi ngôn ngữ khác mặc định, khi `useAiFeatures().translate` và có chữ EN, hiện `AiTranslateButton`.
    - `onResult`: ở chế độ uncontrolled thì `setTyped(t => ({ ...t, [code]: text }))`, ở chế độ controlled thì `onChange(code, text)`.
    - Ô đó được đánh dấu là đã đổi, như khi người dùng tự gõ, để `SaveBar` và cảnh báo rời trang thấy có thay đổi.
    - Bỏ dòng ghi chú "Dịch từ EN arrives with phase 9" ở `:23`.
  - **`StringsForm`:** khi `locale ≠ en`, mỗi key có nút cạnh textarea, gửi `{ key, text: english }`.

- [ ] **Step 5: E2E (`e2e/ai.serial.spec.ts`, phần 1).** Bật `vi` bằng fixture có sẵn của đợt 8.
  - Editor mở một ưu đãi, chọn tab VI của tiêu đề, bấm "Dịch từ EN": ô điền `«vi» …`.
  - Bấm Lưu: `/vi` hiện bản này, và trạng thái là "Đã duyệt".
  - Trên màn chuỗi `?lang=vi`, dịch `booking.party_too_big`: kết quả giữ `{max}` và `{phone}`.
  - Gọi thẳng `/api/admin/ai/translate` không có phiên đăng nhập: 401 hoặc 403.

- [ ] **Step 6: Chạy** unit, guard và E2E phần này. Expected: PASS.

- [ ] **Step 7: Commit** `Phase 9 D7: translate one field from English (glossary tokens, ICU check), in every language tab and strings screen`.

---

### Task D8: Dịch hàng loạt (`ai_jobs`)

**Files:**
- Create: `lib/server/ai/machine-write.ts` (+ `.test.ts`), `lib/server/ai/jobs.ts` (+ `.test.ts`)
- Create: `app/api/admin/ai/jobs/route.ts` (POST tạo), `app/api/admin/ai/jobs/[id]/route.ts` (POST `{action:'resume'|'cancel'}`), `app/api/cron/ai-jobs/route.ts`
- Create: `app/admin/(shell)/translations/AiJobPanel.tsx`
- Modify: `app/admin/(shell)/translations/page.tsx` (thay nút tắt ở `:46-54`), `vercel.json`, `test/guards/vercel-crons.guard.test.ts`

**Interfaces:**
- Consumes: `translateItems` (D7); `CONTENT_KINDS`, `ItemDef` (`translations.ts`, `snapshot.ts`); `sourceHash` (`lib/i18n/source-hash.ts`); `stringSource` (`strings-admin.ts`); `PRIVACY_KEYS`, `AGREED_KEYS` (`lib/legal.ts`).
- Produces:

```ts
// machine-write.ts — the only writers of status='machine' translations (L9-1)
export function insertMachineTranslation(client: PoolClient, def: ItemDef, id: string, locale: string, values: Record<string, string>, model: ModelId, source: string, actorId: string | null): Promise<boolean>; // false: a row already existed
export function insertMachineString(client: PoolClient, key: StringKey, locale: string, value: string, model: ModelId, source: string, actorId: string | null): Promise<boolean>;

// jobs.ts
export type Doc = { kind: string; id: string; items: TranslateItem[]; source: string; def?: ItemDef };
export function missingDocs(db: Db, locale: string, limit: number): Promise<{ docs: Doc[]; remaining: number }>;
export function createJob(pool, actor, locale: string): Promise<ActionResult<{ id: string }>>; // 'conflict' if a live job exists
export function runJobs(pool, opts: { budgetMs: number; ids?: string[] }): Promise<{ jobs: number; docs: number }>;
export function resumeJob(pool, actor, id: string): Promise<ActionResult>;
export function cancelJob(pool, actor, id: string): Promise<ActionResult>;
export function liveJobs(db): Promise<JobView[]>;
```

- [ ] **Step 1: Test `machine-write` (thất bại, test DB).**
  - Chèn bản VI cho một ưu đãi: hàng có `status='machine'`, `origin='ai'`, `ai_model='gemini-3.8-flash'`, `source_hash` đúng và `reviewed_by IS NULL`.
  - Hàng VI đã có thì trả `false` và không đổi gì, **kể cả khi hàng đó là `machine`**: job không bao giờ sửa bản đã có.
  - Với chuỗi: tương tự trên `content_strings`.
  - Không có tham số nào làm hàm ghi `reviewed`.

- [ ] **Step 2: Viết `machine-write.ts`.** `INSERT … ON CONFLICT (<fk>, locale) DO NOTHING RETURNING 1`. Hàm này nằm cạnh `upsertTranslation` về mặt ý nghĩa, nhưng tách file để guard AI quản lý.

- [ ] **Step 3: Test `jobs.ts` (thất bại, `fake`, test DB).**

```ts
it('lists what is missing, never legal or consent text, never English alt', async () => {
  const { docs } = await missingDocs(pool, 'vi', 1000);
  const keys = docs.flatMap((d) => d.items.map((i) => i.id));
  for (const k of [...PRIVACY_KEYS, ...AGREED_KEYS]) expect(keys).not.toContain(k);
  expect(docs.every((d) => d.kind !== 'media' || d.items.every((i) => i.id.startsWith('alt')))).toBe(true); // media docs translate alt into vi, never write en
});

it('runs a job to done, writing machine rows and revalidating', async () => {
  const { data } = await createJob(pool, ADMIN, 'vi');
  await runJobs(pool, { budgetMs: 60_000 });
  const job = await jobById(pool, data.id);
  expect(job).toMatchObject({ status: 'done', progress: { remaining: 0 } });
  expect((await missingDocs(pool, 'vi', 1)).remaining).toBe(0);
  expect(revalidateTag).toHaveBeenCalledWith('i18n:vi', 'max');
});

it('never overwrites a row written after the scan', async () => {
  // a hook in the fake model writes a reviewed VI title for offer 1 between missingDocs and the insert
  …
  expect(await offerTitle(pool, 1, 'vi')).toEqual({ title: 'Của Editor', status: 'reviewed' });
});

it('pauses on Vertex trouble and resumes from where it stopped', async () => {
  vi.stubEnv('AI_FAKE_FAIL', 'translate:429@7'); // the 7th call fails
  const { data } = await createJob(pool, ADMIN, 'vi');
  await runJobs(pool, { budgetMs: 60_000 });
  expect(await jobById(pool, data.id)).toMatchObject({ status: 'paused', error: 'ai_quota', progress: { done: 6 } });
  vi.unstubAllEnvs(); vi.stubEnv('AI_PROVIDER', 'fake');
  await resumeJob(pool, ADMIN, data.id);
  await runJobs(pool, { budgetMs: 60_000 });
  expect(await jobById(pool, data.id)).toMatchObject({ status: 'done' });
});

it('pauses when the budget runs out (ai_budget) and keeps what it wrote', async () => { /* budgetUsd tiny */ });
it('claims a job whose lease expired (a dead function)', async () => { /* status running, locked_until in the past → runJobs picks it */ });
it('cancel stops a job; a cancelled job never runs again', async () => {});
it('refuses a second live job for a language', async () => { /* createJob twice → conflict */ });
```

  Thêm cú pháp `AI_FAKE_FAIL=<feature>:<status>@<n>` vào `fake.ts`: lời gọi thứ n của tính năng đó thất bại. Bộ đếm sống theo tiến trình và test reset được qua `resetFake()`.

- [ ] **Step 4: Viết `jobs.ts`.**
  - **`missingDocs`:**
    - Với mỗi `ContentKind` loại item có `i18n`: lấy các id có hàng mặc định nhưng chưa có hàng ở `locale`, dùng cùng điều kiện `where` như `coverage()`.
    - Mỗi id thành một `Doc`, `items` là các cột có chữ của hàng EN (`id = <cột>`), và `source = sourceHash(columns, defaultRow)`.
    - Riêng media: chỉ các ảnh không trang trí, có alt EN.
    - Với mỗi màn chuỗi: các key chưa có hàng ở `locale` và có chữ EN (registry hoặc DB), **trừ** `PRIVACY_KEYS` ∪ `AGREED_KEYS`. Mỗi màn chia thành các doc tối đa 20 key, `source = stringSource(english)` theo từng key.
    - Chuỗi email dùng `vi` mặc định của registry: vẫn tính là "còn thiếu" nếu DB chưa có hàng `vi`? **Không.** Coverage của đợt 8 tính registry `vi` là có. Chép đúng quy tắc `translationState` của coverage để hai màn khớp nhau.
    - Thứ tự ổn định: theo kind trong `CONTENT_KINDS`, rồi theo id.
  - **`claimJob`:**
    - `UPDATE ai_jobs SET status='running', attempts=attempts+1, locked_until=now()+interval '5 minutes', updated_at=now() WHERE id = (SELECT id FROM ai_jobs WHERE status IN ('queued') OR (status='running' AND locked_until < now()) ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`.
    - Có `ids` thì giới hạn vào các id đó.
  - **`runJobs`**, lặp tới khi hết `budgetMs` (để dư 30 giây):
    1. Claim một job.
    2. `missingDocs(locale, 20)`.
    3. Với mỗi doc: `translateItems({ actorId: null, jobId })`. Các item `ok` được ghi trong một transaction (`insertMachineTranslation` một lần cho mỗi item-doc với mọi cột ok; `insertMachineString` cho từng key). Item hỏng thì `progress.failed += 1` và để trống, nên lần sau doc đó lại được thử.
    4. Cập nhật `progress.done`, gia hạn lease.
    5. Bắt `AiError`. Mã `ai_budget`, `ai_off`, `ai_auth`, `ai_quota`, `ai_not_found` hoặc `ai_bad_request` thì `status='paused'`, `error=code`, `locked_until=NULL`, rồi dừng job này. Mã `ai_failed` thì thử lại doc đó một lần trong lượt; vẫn lỗi thì pause.
    6. Hết doc thì `status='done'`, `progress.remaining=0`.
    7. Sau mỗi lần ghi: `revalidateTag(TAGS.i18n(locale), 'max')`, cộng các tag của bảng đã ghi (`tagsForSave` / `tagsForStrings`). Gọi một lần sau mỗi lô 20 doc, không gọi theo từng doc.
  - **Chống lặp vô hạn:** một doc thất bại `ai_placeholder` ba lần trong cùng job thì bị bỏ qua cho tới hết job. Ghi id của nó vào `progress.skipped` (giới hạn 200 phần tử) để màn hình liệt kê.
  - **`resumeJob`:** `paused` → `queued`, xóa `error`. **`cancelJob`:** `queued`/`running`/`paused` → `cancelled`.
  - Không ghi audit cho job: kết quả là các hàng `machine` hiện trong hàng chờ duyệt. `created_by` cho biết ai tạo job.

- [ ] **Step 5: Routes và cron.**
  - **`POST /api/admin/ai/jobs`** `{ locale }`:
    - `requirePermission({ content: ['ai'] })` và origin;
    - spec §8 ghi "Admin" bấm nút, nhưng quyền `content:ai` là của cả Editor. Giữ `content:ai` và ghi vào sổ;
    - `createJob`;
    - `after(() => runJobs(pool, { budgetMs: 240_000, ids: [id] }))`;
    - `maxDuration = 300`.
  - **`POST /api/admin/ai/jobs/[id]`** `{ action }`: resume thì cũng dùng `after(runJobs…)`.
  - **`GET /api/cron/ai-jobs`:** theo khuôn `app/api/cron/outbox/route.ts`. Đầu tiên chạy `SELECT 1 FROM ai_jobs WHERE status IN ('queued','running') LIMIT 1`; không có hàng thì trả `{ jobs: 0 }` ngay.
  - **`vercel.json`:** thêm `{ "path": "/api/cron/ai-jobs", "schedule": "20 * * * *" }`, và sửa guard cho khớp.

- [ ] **Step 6: UI `AiJobPanel`** trên `/admin/translations`, thay cho nút đang tắt:
  - Chọn ngôn ngữ (mọi ngôn ngữ khác mặc định), rồi nút "Dịch tất cả phần còn thiếu bằng AI", kèm dòng "Còn thiếu N mục". Ẩn khi `useAiFeatures().translate` là false, và thay bằng câu "AI đang tắt".
  - **Mỗi job còn sống:** ngôn ngữ, trạng thái (Đang chờ / Đang chạy / Tạm dừng / Xong / Đã hủy), tiến độ "đã dịch X, còn Y, lỗi Z", lỗi tiếng Việt, và các nút Tiếp tục / Hủy.
  - Trang tự làm mới bằng `router.refresh()` mỗi 5 giây khi có job đang chạy, và ngừng khi không còn job nào.
  - Bỏ ghi chú "Có từ đợt 9" ở `page.tsx:21` và `:46-54`.

- [ ] **Step 7: Chạy** unit, guard (`vercel-crons`, `require-permission`), rồi E2E phần 2 trong `e2e/ai.serial.spec.ts`:
  1. Admin tạo job VI và chờ tới "Xong".
  2. `/admin/translations` có các mục "Máy dịch" trong hàng chờ.
  3. Bật `serve_machine` cho VI: `/vi` hiện một tiêu đề `«vi» …`.
  4. Chạy job với `AI_FAKE_FAIL=translate:429@2` (env theo request không đặt được, nên dùng một route chỉ có ở test, `POST /api/test/ai-fake`, bật khi `AI_PROVIDER=fake` và `E2E=1`, giống các route test sẵn có trong `e2e/blob-routes.ts`): job thành "Tạm dừng", lỗi "Hết quota Vertex.".
  5. Bấm "Tiếp tục": job thành "Xong".

  Expected: PASS.

- [ ] **Step 8: Commit** `Phase 9 D8: bulk translation jobs (machine rows into empty places only, pause and resume, hourly cron plus after())`.

---

### Task D9: Trợ lý viết (stream)

**Files:**
- Create: `lib/server/ai/assist.ts` (+ `.test.ts`), `app/api/admin/ai/assist/route.ts`, `app/admin/(shell)/_kit/AssistPanel.tsx`
- Modify: `TranslatableField.tsx` (nút "Trợ lý viết" khi `rows ≥ 3`), `StringsForm.tsx` (textarea nhiều dòng)

**Interfaces:**
- Produces: `assistStream(pool, { action: 'rewrite'|'shorten'|'brand'; text: string; locale: string; maxLength?: number; actorId: string; signal: AbortSignal }): Promise<Response>`

- [ ] **Step 1: Test (thất bại, `fake`).**
  - Trả về `Response` có `content-type: text/plain; charset=utf-8`; đọc hết stream ra `«rewrite» …`.
  - Ghi một hàng `ai_usage` `ok`, với token lấy từ `onFinish({ totalUsage })`.
  - Hủy `signal` giữa stream: `ai_usage` thành `error` với `ai_failed`. Model giả nhận `abortSignal`, xem trong `doStreamCalls[0].abortSignal`.
  - `text` dài hơn 4 000 ký tự thì route trả 400.
  - Giới hạn theo người được áp: lần gọi thứ 11 trong một phút bị 429.

- [ ] **Step 2: Viết `assist.ts`.**
  - `runAiCall` ở đây cần chờ stream xong. Viết thêm `reserveAiCall(pool, settings, meta): Promise<{ settle(usage), fail(err) }>` trong `guard.ts`. `runAiCall` dùng lại nó; `assist` gọi `reserve` trước, rồi `settle` trong `onFinish` và `fail` trong `onError`/`onAbort`.
  - Instructions: `TASK: assist`, mô tả thao tác bằng tiếng Anh, ngôn ngữ đầu ra = ngôn ngữ của `locale`, "Trả lời chỉ bằng đoạn văn", kèm `brandVoice` (bắt buộc khi `brand`), `systemPrompt`, và `maxLength` nếu có.
  - `streamText({ … maxRetries: 1, timeout: { totalMs: 60_000 }, abortSignal })`, rồi `createTextStreamResponse({ stream: toTextStream({ stream: result.stream }) })` (spike: `toTextStreamResponse` đã deprecated).

- [ ] **Step 3: Route** `POST /api/admin/ai/assist`. Body đến từ `useCompletion`: `{ prompt, action, locale, maxLength? }`, trong đó `prompt` là chữ hiện tại. Route chạy `aiRoute(request, 'assist')` và truyền `signal: request.signal`. `maxDuration = 60`.

- [ ] **Step 4: `AssistPanel.tsx`.**
  - Dùng `useCompletion({ api: '/api/admin/ai/assist', streamProtocol: 'text' })`.
  - Ba nút Viết lại / Rút gọn / Theo giọng thương hiệu, mỗi nút gọi `complete(text, { body: { action, locale, maxLength } })`.
  - Vùng kết quả có `aria-live="polite"`, đếm ký tự so với `max`, và nút "Dùng bản này" (gọi `onUse(completion)`).
  - Nút Đóng gọi `stop()`. Unmount cũng gọi `stop()`.
  - Lỗi hiện câu tiếng Việt: response lỗi là JSON `{message}`, `useCompletion` đưa nó vào `error.message`; nếu không có thì đọc `response`. Kiểm trong spike.

- [ ] **Step 5: E2E (phần 3).** Mở trợ lý trên câu chuyện của Tàya House và bấm "Rút gọn": thấy `«shorten» …`. Bấm "Dùng bản này" rồi Lưu: trang khách hiện bản mới.

- [ ] **Step 6: Commit** `Phase 9 D9: writing assistant (rewrite, shorten, brand voice), streamed, cancelled on close`.

---

### Task D10: Gợi ý SEO

**Files:**
- Create: `lib/server/ai/seo.ts` (+ `.test.ts`), `app/api/admin/ai/seo/route.ts`, `app/admin/(shell)/_kit/SeoSuggestButton.tsx`
- Modify: `app/admin/(shell)/content/seo/page.tsx` (hoặc `StringsPanel` khi `screen="seo"`), `app/admin/(shell)/restaurants/[id]/RestaurantForm.tsx:180-181`

**Interfaces:**
- Produces: `suggestSeo(pool, { target: { kind: 'page'; page: SeoPage } | { kind: 'restaurant'; id: string }; locale: string; actorId: string; signal }): Promise<{ title: string; description: string }>`; `fitWords(text, max): string`

- [ ] **Step 1: Test (thất bại).**
  - `fitWords('A long title …', 60)` cắt ở ranh giới từ, không để dấu câu hay khoảng trắng ở cuối, và luôn `≤ 60`. Một từ duy nhất dài hơn 60 ký tự thì cắt cứng.
  - `suggestSeo` cho một nhà hàng: prompt chứa tên, ẩm thực, điểm đến và câu chuyện của nhà hàng **ở ngôn ngữ đích nếu đã có, ngược lại bằng EN**, và không chứa gì từ `reservations` (guard D3 đã giữ ở mức import; test khẳng định thêm trên prompt).
  - Kết quả qua `fitWords` 60/155.
  - Tên nhà hàng được che như thuật ngữ, rồi `unmask` phải ok; không ok thì `ai_placeholder`.

- [ ] **Step 2: Viết `seo.ts`.**
  - Danh sách `SeoPage` lấy từ các key `seo.*` của registry: mỗi trang có cặp `seo.<page>.title` / `.description`.
  - Nội dung trang `home` gồm chữ hero, giới thiệu và danh sách tên nhà hàng; các trang khác theo bảng của registry. Đọc bằng các reader có sẵn trong `lib/server/content/*` ở `locale`.
  - Dùng `Output.object({ schema: z.object({ title: z.string(), description: z.string() }) })` và `instructions` `TASK: seo`.

- [ ] **Step 3: Route và nút.**
  - `POST /api/admin/ai/seo` chạy `aiRoute(request, 'seo')`.
  - `SeoSuggestButton({ target, locale, onResult({title, description}) })`: nút "Gợi ý bằng AI", điền vào hai ô của tab ngôn ngữ đang mở.
  - Trên màn SEO, mỗi trang có một nút. Trên `RestaurantForm`, nút nằm cạnh hai ô SEO.
  - Người dùng vẫn phải bấm Lưu.

- [ ] **Step 4: E2E (phần 4).** Bấm "Gợi ý bằng AI" ở SEO của Tàya House: hai ô được điền và độ dài nằm trong giới hạn.

- [ ] **Step 5: Commit** `Phase 9 D10: SEO title and description suggestions per page, restaurant and language`.

## Bản kiểm chứng (Phần 2)

- Unit, guard và E2E của D6–D10 xanh với `AI_PROVIDER=fake`.
- Chạy `rg -n "status = 'machine'|'machine'," lib app`: chỉ có `lib/server/ai/machine-write.ts`, `lib/server/ai/alt.ts` (D11), các reader và màn duyệt của đợt 8.

### Bàn giao cho Phần 3

`reserveAiCall`/`runAiCall`, `insertMachine*` và `aiRoute` đã có. D11 chỉ thêm đường ảnh.

---

## PHẦN 3: alt ảnh và nghiệm thu (D11–D12)

### Task D11: Alt ảnh

**Files:**
- Create: `lib/server/ai/alt.ts` (+ `.test.ts`), `app/api/admin/ai/alt/route.ts`
- Modify: `app/admin/(shell)/media/actions.ts` (`registerMediaAction`), `app/admin/(shell)/media/[id]/MediaForms.tsx` (nút "Viết alt bằng AI"), `lib/server/media/register.ts` (trả về `created`, `contentType`, `decorative`, `hasAlt` nếu chưa trả)

**Interfaces:**
- Produces:
  - `describeImage(pool, { mediaId: string; actorId: string | null; signal? }): Promise<{ alt: string; model: ModelId }>`
  - `generateAltQuietly(mediaId: string): Promise<void>`: không bao giờ ném lỗi, chỉ log mã lỗi
  - `writeMachineAlt(pool, mediaId, alt, model): Promise<boolean>`

- [ ] **Step 1: Test (thất bại, `fake`, test DB, Blob giả `test/helpers/fake-blob.ts`).**
  - Một ảnh JPEG 3000×2000 trong Blob giả: `describeImage` gửi một `file` part `image/jpeg` có cạnh dài ≤ 1024. Xem trong `doGenerateCalls[0].prompt`, giải mã bằng `sharp(buf).metadata()`.
  - Alt ≤ 250 ký tự (cột `media_i18n.alt` ≤ 250): dài hơn thì `fitWords(…, 250)`.
  - `writeMachineAlt` trên ảnh chưa có alt EN: chèn hàng `en` `machine`/`ai`/`ai_model`. Đã có alt (người viết) thì trả `false` và không đổi. Sau khi ghi thì gọi `revalidateTag('media','max')`.
  - Ảnh trang trí, PDF, hoặc ảnh đã xóa thì không gọi model (không có hàng `ai_usage`).
  - `generateAltQuietly` khi tính năng alt tắt thì không làm gì. Khi `ai_budget` thì log `[ai:alt] skipped code=ai_budget` và không ném lỗi.
  - Lời gọi tự sinh có `actor_id IS NULL`.

- [ ] **Step 2: Viết `alt.ts`.**
  - `downloadBlob(url)` (`lib/server/media/blob.ts`), rồi `sharp(buf).rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()`.
  - Gọi `generateText({ instructions: 'TASK: alt\nDescribe this photo for a screen-reader user of a luxury resort restaurant website in one English sentence, under 125 characters, no "image of".' + brand + systemPrompt, messages: [{ role: 'user', content: [{ type: 'file', mediaType: 'image/jpeg', data: jpeg }] }] })`.
  - Model không có `image: true` thì báo `ai_off`, kèm câu "Model đã chọn không nhận ảnh". Thêm mã `ai_no_image` nếu muốn câu riêng; khi đó ghi vào R9-15 lúc làm.

- [ ] **Step 3: Đường tự sinh.** Trong `registerMediaAction`, sau khi lưu thành công và **trước** `refresh()`:

```ts
if (result.data.created && result.data.kind === 'image' && !parsed.decorative && !parsed.alt) {
  after(() => generateAltQuietly(result.data.id));
}
```

  `generateAltQuietly` tự kiểm `resolveAiMode`, `features.alt.enabled` và Draft Mode, rồi mới gọi `describeImage({ actorId: null })` và `writeMachineAlt`.

- [ ] **Step 4: Route và nút.**
  - `POST /api/admin/ai/alt` `{ mediaId }`: chạy `aiRoute(request, 'alt')`, gọi `describeImage({ actorId: staff.id })`, trả `{ alt }`.
  - Nút "Viết alt bằng AI" trong `MediaForms` (ô alt EN) điền vào ô và không lưu. Nút ẩn với PDF và ảnh trang trí.

- [ ] **Step 5: E2E (phần 5).**
  - Upload một ảnh qua Blob giả, không nhập alt, chờ vài giây rồi mở trang chi tiết: alt là `A fake description of the image.`, nhãn "Máy dịch".
  - `/admin/translations` có mục "Alt ảnh" trong hàng chờ.
  - Bấm "Duyệt": nhãn thành "Đã duyệt".

- [ ] **Step 6: Commit** `Phase 9 D11: alt text written by AI after an upload (machine, never over a person's), and on request`.

---

### Task D12: Nghiệm thu, README, sổ đợt 9, cổng cuối

**Files:**
- Modify: `e2e/ai.serial.spec.ts` (thêm phần nghiệm thu)
- Modify: `README.md`
- Create: `docs/superpowers/ledgers/2026-10-13-phase-9-ledger.md`

- [ ] **Step 1: E2E nghiệm thu** (spec §14.1, dòng 9). Mỗi ý là một `test()` có tên đúng câu nghiệm thu:
  1. **"Kiểm tra kết nối xanh"** (với model giả; bản Gemini thật là bước của chủ dự án, Step 3).
  2. **"Dịch giữ nguyên tên riêng và biến":**
     - thêm thuật ngữ `Da Nang → Đà Nẵng (vi)`;
     - dịch một chuỗi chứa "Tàya House", "Da Nang", `{phone}` và một plural;
     - kết quả có "Tàya House", "Đà Nẵng", `{phone}`, và cấu trúc plural còn nguyên;
     - với `AI_FAKE_DROP_TOKEN=1`: thấy câu `ai_placeholder` và ô không đổi.
  3. **"Vượt ngân sách bị chặn":**
     - đặt ngân sách `$0.001`;
     - "Dịch từ EN" hiện "Đã dùng hết ngân sách AI tháng này.";
     - tạo job thì job thành "Tạm dừng", lỗi ngân sách;
     - upload ảnh thì không có alt tự sinh.
  4. **"Job tạm dừng rồi chạy tiếp được":** như D8, Step 7, mục 4–5.
  5. **Giới hạn theo người:** đặt `perMinute = 2`; lần dịch thứ ba hiện câu `ai_rate_minute`.

- [ ] **Step 2: README.**
  - **"### Environment variables (admin)":** thêm các dòng sau, theo cột Production | Preview | Local E2E / CI:
    - `AI_PROVIDER` (không đặt / không đặt / `fake`);
    - `GCP_PROJECT_ID`, `GCP_PROJECT_NUMBER`, `GCP_SERVICE_ACCOUNT_EMAIL`, `GCP_WORKLOAD_IDENTITY_POOL_ID`, `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID`;
    - `GCP_SERVICE_ACCOUNT_KEY` (chỉ dùng dự phòng);
    - cảnh báo "Không bao giờ đặt `GOOGLE_VERTEX_API_KEY`".
  - **Mục mới "### Before AI: Google Cloud (phase 9)":** danh sách đánh số cho chủ dự án, theo spec §15 mục 6–11. Dùng đúng các lệnh `gcloud` đã kiểm chứng (nghiên cứu ngày 2026-10-13; thay `TEAM_SLUG`, `PROJECT_NAME`, `PROJECT_ID`, `PROJECT_NUMBER`):

```bash
gcloud services enable aiplatform.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com
gcloud iam workload-identity-pools create vercel --location=global --display-name=Vercel
gcloud iam workload-identity-pools providers create-oidc vercel \
  --location=global --workload-identity-pool=vercel \
  --issuer-uri="https://oidc.vercel.com/TEAM_SLUG" \
  --allowed-audiences="https://vercel.com/TEAM_SLUG" \
  --attribute-mapping="google.subject=assertion.sub,attribute.owner=assertion.owner,attribute.project=assertion.project,attribute.environment=assertion.environment" \
  --attribute-condition="assertion.owner=='TEAM_SLUG' && assertion.project=='PROJECT_NAME'"
gcloud iam service-accounts create vercel-vertex --display-name="Vercel Vertex"
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:vercel-vertex@PROJECT_ID.iam.gserviceaccount.com" --role=roles/aiplatform.user
gcloud iam service-accounts add-iam-policy-binding vercel-vertex@PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="principal://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/vercel/subject/owner:TEAM_SLUG:project:PROJECT_NAME:environment:production"
# repeat the last command with environment:development for `vercel dev`; Preview is not granted (spec §9.1)
```

    Mục này còn ghi:
    - Vercel phải bật OIDC ở chế độ Team issuer: Project → Settings → Security → Secure backend access with OIDC federation.
    - Đặt 5 biến env.
    - Redeploy.
    - Mở `/admin/settings/ai` và bấm "Kiểm tra kết nối": mong đợi ✓ với `gemini-3.8-flash · global`.
    - Muốn dùng Claude thì bật model trong Model Garden và đặt org policy `constraints/vertexai.allowedPartnerModelFeatures` cho `structured_outputs`.
    - Đặt cảnh báo ngân sách GCP ở mức bằng ngân sách trong app.
    - Cron `ai-jobs` chạy mỗi giờ; job thường xong ngay nhờ `after()`.
  - **"Before launch B", bước 4:** trỏ tới nút dịch hàng loạt và hàng chờ duyệt.
  - **Bảng script/cron:** thêm `/api/cron/ai-jobs`.

- [ ] **Step 3: Sổ đợt 9** (`docs/superpowers/ledgers/2026-10-13-phase-9-ledger.md`, theo khuôn sổ đợt 8):
  - Nghiệm thu đã đóng, kèm test chứng minh.
  - Rulings R9-1 … R9-15 và kết quả của từng ruling.
  - Những gì đã đóng: L9-1, R8-13, ghi chú ai-jobs của sổ đợt 5.
  - Những gì hoãn, kèm lý do.
  - **Việc chủ dự án**, mỗi việc một dòng:
    - GCP (spec §15 mục 6–11);
    - "Kiểm tra kết nối xanh với Gemini thật";
    - quyết định có cho Editor tạo job hàng loạt không (R9-9 đang để `content:ai`).
  - Cổng cuối.

- [ ] **Step 4: Cổng cuối.** Chạy đủ và chép số liệu vào sổ:
  - `npm run typecheck`
  - `npm run lint` (0 warnings)
  - `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test` (số file / số test)
  - `PGHOST= PGUSER= PGPASSWORD= PGDATABASE= npm run build && node scripts/check-prerender.mjs`: `/en` vẫn prerender đầy đủ, và trang khách không kéo theo gói AI nào. Kiểm rằng `.next/static` không chứa `google-auth-library`.
  - `npm run test:e2e` (passed/skipped)
  - `npm run test:visual` (nếu máy là macOS; ngược lại ghi "baseline macOS, chủ dự án chạy")

- [ ] **Step 5: Commit** `Phase 9 D12: acceptance (connection, names and variables kept, budget, pause and resume), README for Google Cloud, the phase-9 ledger`.

## Bản kiểm chứng (toàn bộ đợt 9)

| Nghiệm thu (spec §14.1, dòng 9) | Test |
|---|---|
| Kiểm tra kết nối xanh với Gemini | `check.test.ts`, `e2e/ai.serial.spec.ts` (model giả); bản thật là bước của chủ dự án ở README |
| Dịch giữ nguyên tên riêng và biến | `glossary.test.ts`, `translate.test.ts`, E2E nghiệm thu 2 |
| Vượt ngân sách bị chặn | `guard.test.ts`, E2E nghiệm thu 3 |
| Job tạm dừng rồi chạy tiếp được | `jobs.test.ts`, E2E nghiệm thu 4 |

## Migration lên Neon

Migration 011 chỉ mở rộng (thêm bảng), nhưng code đợt 9 đọc `ai_settings`, nên **phải áp lên Neon trước khi push hay deploy `main`**: preflight chỉ đọc, rồi áp, rồi postcheck, theo README "Migration 011". Controller hỏi chủ dự án trước khi áp, như các đợt trước.

## Cần chủ dự án quyết định

| # | Câu hỏi | Mặc định khi chưa trả lời |
|---|---|---|
| 1 | Tạo GCP project và làm README "Before AI" (spec §15 mục 6–11)? | AI ở trạng thái "Chưa cấu hình" trên Production; mọi thứ khác vẫn chạy |
| 2 | Editor có được bấm dịch hàng loạt không? | Có (quyền `content:ai`, R9-9) |
| 3 | Dùng Claude không (phải bật trong Model Garden và đặt org policy)? | Không; mọi tính năng dùng Gemini 3.8 Flash |

---

## Đối chiếu với code ngày 2026-10-16 (trước D8)

> Plan này viết ngày 2026-10-13. Sau đó có ba thay đổi:
> - **Ngôn ngữ thành code** (`cbeb62d`): `lib/i18n/site-locales.ts`, migration `011_drop_locales.sql`; bảng `locales`, cột `serve_machine` và màn ngôn ngữ của admin đã bỏ.
> - **Migration AI là `012_ai_phase9.sql`** (merge `47fc872`, D1–D7), không phải 011.
> - **Redesign admin và web khách**: design system `--a-*` trong `styles/admin.css`, `app/admin/(shell)/_ui/` (`PageHeader`, `Icon`, `FormMessage`…), `_kit/`; rồi đến `.claude/architecture.md` (`fbd78a0`), viết **sau** plan và là luật bắt buộc (CLAUDE.md).
>
> Mục này đối chiếu D8–D12 với code ở `origin/main` `5657868`. Phần cũ của plan giữ nguyên. Chỗ nào phần cũ nói khác mục này thì **làm theo mục này**: các Ruling R9-16 … R9-26 dưới đây thay hoặc bổ sung Ruling cũ đúng như từng Ruling ghi.

### Chỗ plan nhắc thứ đã đổi

| Plan (dòng) | Hiện tại |
|---|---|
| Migration 011 (`:7`, `:97`, `:191-193`, `:236-242`, `:264-265`, `:298`, `:373-381`, `:385`, `:396-397`, mục "Migration lên Neon" `:1594`) | `db/migrations/012_ai_phase9.sql`, `db/checks/preflight-012.sql`/`postcheck-012.sql`, `test/integration/migration-012.test.ts`, README "### Migration 012 (phase 9: AI)" (`README.md:721-773`). D8–D12 không thêm migration (R9-25). |
| `REFERENCES locales (code) …` của `ai_glossary.locale`, `ai_jobs.locale` (`:329`, `:339`) | Không có khóa ngoại (`012_ai_phase9.sql:12-13`, `:28`, `:38`). App kiểm mã theo `LISTED_LOCALE_CODES` (`lib/i18n/site-locales.ts:51`). |
| Preflight "`locales` có `en`" (`:375`); D5 "không có trong `locales` thì `invalid`" (`:999`) | Preflight 012 chỉ kiểm 011 đã áp. Glossary kiểm `LISTED_LOCALE_CODES` (`lib/server/ai/glossary.ts:113`). |
| D7: `localeName(locale)` (`:1164`), body "có trong bảng locales" (`:1211`) | `englishName` (`lib/i18n/catalog.ts:32`); route kiểm `LISTED_LOCALE_CODES` (`app/api/admin/ai/translate/route.ts:37`). |
| D7: `aiRoute(request, feature)` (`:1117`, `:1200`) | `aiRoute(request, feature, staff)` (`lib/server/ai/route-guard.ts:17`); dòng đầu của handler vẫn là `const staff = await requirePermission({ content: ['ai'] })` (guard). |
| D7: lỗi hiện trong `role="status"` (`:1224`) | Vùng `aria-live="polite"` luôn mount (`_kit/AiTranslateButton.tsx:57-65`): `role="status"` dành cho thông báo lưu của form. D9–D11 theo khuôn này. |
| D7 E2E: "Bật `vi` bằng fixture của đợt 8" (`:1232`) | `vi` đã bật trong code (`lib/i18n/site-locales.ts:24`). |
| D8: nút tắt ở `translations/page.tsx:46-54`, ghi chú `:21` (`:1250`, `:1361`) | Nút tắt và tag "Sắp có" nằm trong `actions` của `PageHeader` ở `page.tsx:47-57`; ghi chú R8-13 ở `:23`. |
| D8 E2E bước 3: "Bật `serve_machine` cho VI" (`:1366`) | Cột này đã mất cùng bảng `locales` (`011_drop_locales.sql:32`; cột ở `004_…sql:19`). Xem R9-19. |
| D10: `RestaurantForm.tsx:180-181` (`:1416`) | `:179-181` (`<h2>SEO</h2>`, `seoTitle` max 120, `seoDescription` max 320 `rows={3}`). |
| D11: `describeImage({ actorId: staff.id })` (`:1491`), `lib/server/media/register.ts` "trả `created`, `contentType`, `decorative`, `hasAlt`" (`:1459`) | `StaffSession` có `userId`, không có `id` (`lib/server/dal/session.ts:21`). `RegisterResult` chỉ có `{ id, created }` (`register.ts:18-20`). Xem R9-21. |
| Sổ đợt 9 `2026-10-13-phase-9-ledger.md` (`:218`, `:1508`, `:1562`) | Đặt theo ngày D12 xong (R9-26). |

Plan không nhắc `/admin/locales`, và không nhắc tên component hay class CSS admin nào đã đổi. `SaveBar`, `StringsPanel`, `GlossaryTable` và `_kit/*` vẫn đúng tên. Giao diện mới của D8–D11 dùng `PageHeader`/`Icon` (`_ui/`), các class `a-card-row`, `a-table`, `a-btn`, `a-tag`, `a-tag--warn`, `<progress>` (như `settings/ai/page.tsx:96`) và token `--a-*`. Không có `style=""` (CSP, `lib/admin/admin-pages.guard.test.ts`). Id lấy từ `useId()`, vì `<Activity>` giữ trang cũ trong DOM. Màu cảnh báo chỉ dùng `--a-warn*` (`test/guards/admin-css.guard.test.ts`).

### Task D8: Dịch hàng loạt

**Còn đúng:**
- Bảng `ai_jobs` đủ cột, có partial unique index một job sống mỗi ngôn ngữ (`012_ai_phase9.sql:36-50`). `ai_usage.job_id` có, và `feature='translate'` dùng được cho job.
- `translateItems` đã nhận `actorId: null` và `jobId` (`lib/server/ai/translate.ts:41-46`), tối đa 20 item mỗi lần gọi (`:26`).
- `PRIVACY_KEYS`, `AGREED_KEYS` vẫn ở `lib/legal.ts:30`, `:33`. `CONTENT_KINDS` có đủ item và các màn chuỗi (`lib/server/content-admin/translations.ts:98-126`).
- Quy tắc coverage coi bản `vi` của registry là đã có (`translations.ts:207-209`). Hàng chờ duyệt nhận hàng `machine` ở mọi ngôn ngữ (`:297`).
- "Duyệt" đã expire qua cache plan (`translations/actions.ts:38-40`).
- `ADMIN_SCREENS` gồm `legal` và `emails`. Khi trừ `PRIVACY_KEYS ∪ AGREED_KEYS`, màn `legal` không còn gì để dịch.
- R9-3: job ghi `actor_id NULL`, không tính vào giới hạn theo người; R9-4: vẫn tính ngân sách.

**Lệch:**
- **Kiến trúc.** `.claude/architecture.md:61` cho `ai` phụ thuộc đúng `dal, kernel`. `jobs.ts` và `machine-write.ts` của plan nằm trong `lib/server/ai/` nhưng import `CONTENT_KINDS` (content-admin), `ItemDef` (history), `stringSource`/`tagsForStrings` (content). `content-admin/offers.ts:81` còn đọc `reservations`. → R9-17.
- **Ngôn ngữ của job.** `ai_jobs.locale` không còn khóa ngoại (`012_ai_phase9.sql:38`): không gì chặn một mã lạ, hay job của một ngôn ngữ vừa bị gỡ khỏi danh sách. → R9-18.
- **Khách thấy gì.** `serve_machine` không còn. Khách chỉ thấy bản `reviewed` ở ngôn ngữ khác mặc định (`lib/server/content/sql.ts:19`, `strings.queries.ts:31`; lý do đóng cửa `lib/server/booking/rules.ts:109-110`). `TAGS.i18n(locale)` (`lib/cache-tags.ts:37`) không loader nào gắn, nên `revalidateTag(TAGS.i18n(locale))` ở Step 4.7 không expire gì. → R9-19.
- **Audit.** Step 4 viết "Không ghi audit cho job", nhưng `.claude/architecture.md:101` (Luật 4) đòi mỗi lần ghi có `insertAudit`. Thêm nữa, form đang mở của một Editor sẽ gặp `conflict` khi job chèn bản dịch (token snapshot gồm cả hàng dịch), và `conflictFromHistory` (`lib/server/conflict.ts:31-46`) lấy người của dòng audit mới nhất: không có dòng của job thì Editor được báo sai người. → R9-20.
- **Cron.** `vercel.json:3-7` có ba cron, outbox `0 * * * *`. Guard so khớp cả danh sách (`test/guards/vercel-crons.guard.test.ts:22-28`) và chú thích lý do Neon Free (`:5-15`). Plan đặt ai-jobs ở `20 * * * *` (R9-2), tức thêm một lần đánh thức Neon mỗi giờ (README `:1297-1311`, và `:1308`: "Phase 9's AI-jobs cron must follow the same rule"). → R9-16.
- **Model giả.** `AI_FAKE_FAIL` chưa có cú pháp `@<n>` (`lib/server/ai/fake.ts:13`, `:55-63`). Chưa có route `/api/test/*` nào. `playwright.config.ts:117-127` chưa đặt `E2E=1`. `e2e/blob-routes.ts` là route chặn của Playwright, không phải route của app.
- **Chỗ gắn UI.** `translations/page.tsx:47-57`. Trang tải `coverage()` + `reviewQueue()`, đọc mọi bảng dịch (`translations.ts:231-235`), nên `router.refresh()` 5 giây một lần là nặng. → R9-24.
- **Ghi máy.** `upsertTranslation` luôn ghi `reviewed`/`human` (`lib/server/history/snapshot.ts:226-248`). Hàm ghi `machine` vẫn phải viết mới, như plan đã dự kiến.
- Chú thích `e2e/ai.serial.spec.ts:11-13` còn nói "puts the table back as migration 004 seeded it", là chuyện của bảng đã bỏ. Sửa khi viết phần 2 của spec này.
- Test cần DB của D4–D7 nằm cạnh code (`lib/server/ai/*.test.ts`). `.claude/architecture.md` §1 đặt test cần DB ở `test/integration/`.

**Xử lý:**
- Làm theo R9-16 … R9-20, R9-24, R9-25.
- Step 1–4 chuyển file theo R9-17. Test DB của phần CMS (scan, ghi máy, vòng chạy job) đặt ở `test/integration/machine-translations.test.ts`; Review Focus 1 thành `machine-translations.test.ts › never overwrites a row written after the scan`. Test thuần của `ai/jobs.ts` (claim, lease, chuyển trạng thái) giữ cạnh code như D4–D7.
- Thêm `@<n>` vào `AI_FAKE_FAIL` (bộ đếm trên `globalThis`, như `aiFakeState`).
- Route test `POST /api/test/ai-fake` chỉ chạy khi `AI_PROVIDER=fake`, `E2E=1` và `VERCEL_ENV` không đặt; ngược lại trả 404. Thêm `E2E: '1'` vào `webServer.env`.
- Sửa `vercel.json` và `vercel-crons.guard.test.ts` (danh sách và chú thích) **trong cùng commit**.
- D8 không cần migration (R9-25).
- Câu hỏi "Editor có được tạo job không" vẫn để mở (bảng "Cần chủ dự án quyết định", mục 2).

### Task D9: Trợ lý viết

**Còn đúng:**
- `reserveAiCall` đã có từ D4 (`lib/server/ai/guard.ts:77`), nên `runAiCall` (`:110`) dùng lại nó. Step 2 không phải viết thêm, chỉ dùng.
- Guard import đã có ngoại lệ cho `_kit/AssistPanel.tsx` và cho `ai` trong route AI (`test/guards/ai-imports.guard.test.ts:27-28`).
- Model giả stream được (`fake.ts:92-106`). `useAiFeatures().assist` đã có (`_kit/useAiFeatures.tsx:7`).
- Chỗ gắn có sẵn: trong panel từng ngôn ngữ của `TranslatableField` (`_kit/TranslatableField.tsx:142-149`, cạnh `AiTranslateButton`), và `StringField` (`content/_ui/StringsForm.tsx:192-201`).
- Ô nhiều dòng của màn chuỗi là `multiline` (`StringsForm.tsx:165`: `maxLength > 120` hoặc có xuống dòng, `rows={4}`). Các form dùng `rows` 3, 4, 6 có sẵn.
- Khuôn dùng lại của D7: `fillLikeTyping` (`AiTranslateButton.tsx:11-15`), để điền vào ô cũng tính là gõ, nên `SaveBar` và cảnh báo rời trang đều thấy. `AbortController` hủy khi unmount (`:22-24`). Class `.a-ai-translate` (`styles/admin.css:1827`).

**Lệch:**
- Model giả đọc thao tác từ dòng `ACTION: <rewrite|shorten|brand>` (`fake.ts:78`). Step 2 chưa nói instructions phải có dòng này, sau dòng `TASK: assist`.
- `useCompletion` (`@ai-sdk/react`) kéo `ai`, `@ai-sdk/provider-utils` và `swr` vào bundle admin (`package-lock.json`). D7 đã ghi rằng phép thử `eval` của zod làm CSP admin báo lỗi (`useAiFeatures.tsx:4`). → R9-23.

**Xử lý:**
- Instructions có `TASK: assist` rồi `ACTION: <action>` ở đầu.
- Panel theo R9-23.
- Nút "Dùng bản này" gọi đúng `onResult` mà `AiTranslateButton` đang dùng ở mỗi chỗ gắn.

### Task D10: Gợi ý SEO

**Còn đúng:**
- `RestaurantForm.tsx:179-181` có hai ô SEO, dạng `TranslatableField`.
- Màn SEO là `content/seo/page.tsx` dùng `StringsPanel`.
- Caps 60/155 vẫn theo spec §9.3: registry cho tới 70/200 (`lib/i18n/registry.ts:1353-1366`), nhưng gợi ý vẫn cắt ở 60/155.

**Lệch:**
- Registry **không có** cặp `seo.<page>.title/.description` cho từng trang. Màn SEO chỉ có `seo.home_title`, `seo.home_description`, `seo.og_title`, `seo.og_description`, mẫu `seo.page_title` (`{page}`) và `seo.not_found_title` (`registry.ts:1353-1395`). `{ kind: 'page', page: SeoPage }` của R9-11 không có gì để trỏ vào.
- Mỗi `TranslatableField` giữ tab đang mở của riêng nó (`TranslatableField.tsx:71`). `LocaleTabs` không có tab chung (`_kit/LocaleTabs.tsx`), nên trên `RestaurantForm` không có một "tab ngôn ngữ đang mở" chung cho hai ô.
- `lib/page-scope.guard.test.ts:17-18`, `:30` quét cả `app/`: nút không được `document.querySelector`.
- `suggestSeo` đọc nội dung bằng reader của `lib/server/content/*` từ trong `ai`, tức thêm cạnh `ai → content` mà bảng §2 không cho. → R9-17.

**Xử lý:** Làm theo R9-22. Nội dung gửi cho model do phía CMS gom (R9-17); server vẫn tự đọc, không nhận chữ từ client.

### Task D11: Alt ảnh

**Còn đúng:**
- Hàng chờ duyệt đã nhận alt EN `machine` (`translations.ts:25-26`, `:116`, `:297`), và "Duyệt" xử lý hàng ngôn ngữ mặc định (`:393`).
- Khách thấy alt EN ngay, kể cả `machine`, vì nó là ngôn ngữ mặc định (`sql.ts:19`).
- Model giả trả `A fake description of the image.` (`fake.ts:77`). Blob giả của E2E nhận cả lượt đọc lại file (`test/helpers/blob-redirect.mjs`).
- Luồng upload: presigned Blob (`_kit/MediaUploader.tsx`), rồi `registerMediaAction` (`media/actions.ts:49-60`), rồi `registerUploadedMedia` (`lib/server/media/register.ts:32-60`, đã tải file về để đo). `after()` gắn được trong action này, trước `refresh()` ở `:55`.

**Lệch:**
- `RegisterResult` chỉ có `{ id, created }` (`register.ts:18-20`): không có `kind`. Uploader chỉ gửi `pathname` (`MediaUploader.tsx:85`), nên lúc upload alt luôn trống và cờ trang trí luôn tắt.
- `downloadBlob` chỉ nhận URL `*.public.blob.vercel-storage.com` (`lib/server/media/blob.ts:102-104`). Các hàng `storage='static'` (`008_content.sql:65`, `:85`; thêm 37 ảnh ở `013_official_photos.sql:3`, `:18-19`) có URL `/assets/…` và không đọc được qua cổng này. Con số "17 ảnh cũ chưa có alt" (R9-12) tính trước 013, nay phải đếm lại.
- `ai → media` (`downloadBlob`, ghi `media_i18n`) là cạnh mà bảng §2 không cho. → R9-17.
- Trang chi tiết không hiện trạng thái của alt EN: `MediaForms.tsx:73-86` là textarea trần, và `itemStates` chỉ tính ngôn ngữ khác mặc định (`media/[id]/page.tsx:100-103`). E2E "nhãn Máy dịch" ở Step 5 chưa có chỗ hiện.
- Ô alt các ngôn ngữ khác (`MediaForms.tsx:88-94`) chưa có "Dịch từ EN". D7 chỉ gắn vào `TranslatableField` và `StringsForm`.
- `saveMediaDetails` ghi lại alt EN mỗi lần lưu (`lib/server/media/library.ts:217`), nên lưu form (kể cả chỉ đổi cờ trang trí) là duyệt luôn alt máy. Hợp spec §5.1 mục 4 (lưu là `reviewed`), chỉ cần ghi nhận.
- Mọi model trong danh mục có `image: true` (`lib/admin/ai-models.ts:19-23`), nên mã `ai_no_image` của Step 2 không cần.

**Xử lý:** Làm theo R9-21. Thêm `AiTranslateButton` vào ô alt từng ngôn ngữ khác (mở rộng R9-8), theo khuôn của `StringField`: dùng `ref`, rồi `fillLikeTyping`.

### Task D12: Nghiệm thu, README, sổ đợt 9

**Còn đúng:**
- README có mục "Migration 012" (`README.md:721-773`) và dòng `/admin/settings/ai` trong bảng route (`:1527`).
- "Before launch A" bước 2 đã nói cron AI-jobs phải theo luật Neon (`:1308`), và bước 3 đã bật OIDC Federation cho BotID (`:1312-1314`).
- `e2e/settings-ai.spec.ts` đã có "Kiểm tra kết nối" với model giả và marker bí mật.

**Lệch:**
- README chưa có biến AI/GCP trong bảng env (`:1107-1125`). Dòng `CRON_SECRET` liệt kê ba cron (`:1120`). Chưa có mục "Before AI".
- "Before launch A" bước 11 nói "three crons" (`:1391-1397`), bước 13 nói "all three crons" (`:1413-1416`). Bảng route chưa có `/api/cron/ai-jobs` hay `/api/admin/ai/*` (`:1508-1517`). Dòng `/admin/translations` còn ghi "comes with phase 9" (`:1525`).
- Plan trỏ "Before launch B, bước 4" (`:1559`), nhưng nay bước 4 là công cụ tìm kiếm (`:1466`). Bước dịch là bước 2 (`:1455`).
- Sổ đợt 8 viết tiếng Anh, theo các mục `Rulings` / `Closed in 8` / `Deferred, with the reason` / `Needs a decision (owner)` / `Final gate` (`docs/superpowers/ledgers/2026-10-06-phase-8-ledger.md:14`, `:28`, `:42`, `:53`, `:64`). Step 3 của plan liệt kê bằng tiếng Việt.
- Mục "Before AI" nên trỏ về bước 3 thay vì bật OIDC lần thứ hai. Phần còn phải kiểm là chế độ Team issuer.

**Xử lý:**
- README:
  - thêm các biến AI/GCP vào bảng env, và thêm `/api/cron/ai-jobs` vào dòng `CRON_SECRET`;
  - sửa bước 11 và 13 thành bốn cron;
  - bảng route: thêm `/api/cron/ai-jobs` và `/api/admin/ai/{translate,jobs,assist,seo,alt}`, sửa dòng `/admin/translations`;
  - mục "Before AI" trỏ về bước 3, và ghi lịch cron `0 * * * *` (R9-16);
  - "Before launch B" bước 2 thêm câu về nút dịch hàng loạt, hàng chờ duyệt, và rằng job không dịch chính sách và câu đồng ý.
- Sổ theo R9-26.
- Cổng cuối như Step 4. `test:visual` chỉ chạy trên macOS.

### Các Ruling hiện có

- **Còn đúng nguyên:** R9-1 (`lib/server/ai/mode.ts`, có thêm trạng thái `error` ở màn cấu hình), R9-3, R9-4, R9-5, R9-6, R9-7, R9-13, R9-14.
- **R9-2:** phần `after()`, 240 giây, lease và "không job thì một `SELECT`" còn đúng. Lịch `20 * * * *` thay bằng R9-16.
- **R9-8:** đã làm ở D7. Mở rộng sang ô alt các ngôn ngữ khác (R9-21). Lỗi hiện trong `aria-live`, không dùng `role="status"`.
- **R9-9:** phạm vi còn đúng. Thêm R9-17 (file nằm đâu), R9-18 (ngôn ngữ), R9-19 (khách thấy gì) và R9-20 (audit).
- **R9-10:** ba thao tác và hành vi còn đúng. `useCompletion` thay bằng R9-23.
- **R9-11:** thay bằng R9-22.
- **R9-12:** sửa bằng R9-21.
- **R9-15:** đủ mã, đã có trong `lib/server/ai-error.ts:4-15` (kernel). Không thêm `ai_no_image`.
- **L9-1:** "chỉ hai luồng ghi `machine`" còn đúng. Theo R9-17, hai luồng đó nằm ở `lib/server/content-admin/machine-translations.ts` và `lib/server/media/library.ts` (`writeMachineAlt`). Lệnh `rg` của "Bản kiểm chứng (Phần 2)" kiểm hai file này thay cho `lib/server/ai/machine-write.ts` và `alt.ts`.

### Ruling mới

- **R9-16 (lịch cron ai-jobs, thay lịch của R9-2).**
  - `/api/cron/ai-jobs` chạy `0 * * * *`, **cùng phút với outbox**. Neon Free thức một lần mỗi giờ cho cả hai cron, thay vì hai lần (README `:1297-1311`).
  - Một lượt `after()` hết 240 giây mà job còn việc: job về `queued`, xóa lease. Panel hiện "Đang chờ lượt sau" kèm nút "Chạy tiếp ngay" (cùng route với "Tiếp tục", lại `after()`); không bấm thì cron giờ kế tiếp chạy tiếp.
  - Sửa `vercel.json`, danh sách và chú thích của `vercel-crons.guard.test.ts`, cùng README (bước 2, 11, 13, dòng `CRON_SECRET`, bảng route) trong cùng commit D8.
  - Nếu sai: số liệu Neon tháng đầu cho thấy hai cron cùng phút vẫn đánh thức compute hai lần, hoặc chủ dự án lên gói Launch. Khi đó đổi lịch ở `vercel.json` và guard cùng lúc, kèm ghi chú trong guard.
- **R9-17 (đặt file theo `.claude/architecture.md`, thay sơ đồ file của D8, D10 và D11).**
  - `lib/server/ai/` vẫn là cổng, chỉ phụ thuộc `dal, kernel`. Hàm AI nhận chữ hoặc byte đã gom sẵn, không tự đọc bảng nội dung:
    - `ai/jobs.ts`: chỉ SQL của `ai_jobs` (tạo, claim, lease, tiến độ, tạm dừng, tiếp tục, hủy, `liveJobs`);
    - `ai/translate.ts`: như D7;
    - `ai/seo.ts`: `suggestSeo(pool, { material, locale, … })`;
    - `ai/alt.ts`: `describeImage(pool, { bytes, contentType, actorId })`;
    - `ai/assist.ts`.
  - Phía CMS nằm ở `lib/server/content-admin/`, module này **được import `ai`**:
    - `machine-translations.ts`: `missingDocs`, vòng `runTranslationJobs`, `insertMachineTranslation`, `insertMachineString`;
    - `seo-material.ts`: gom nội dung cho `suggestSeo`;
    - `machine-alt.ts`: `generateAltQuietly`.
  - `media` thêm `imageForAi(db, id)` (byte của file) và `writeMachineAlt` vào `library.ts`, vì `media_i18n` là bảng của module media.
  - Route, cron và `registerMediaAction` gọi các hàm của content-admin.
  - Commit D8 sửa `.claude/architecture.md:62` thành `content, email, history, media, ai, kernel`. Thứ tự bảng không đổi: `ai` vốn đã nằm dưới `content-admin`.
  - Siết `ai-imports.guard.test.ts`: các file `content-admin/machine-*.ts` và `seo-material.ts` cũng không được import `booking`/`email` hay chứa `reservations`, như `lib/server/ai/`.
  - Nếu sai: đội muốn giữ `jobs.ts` và `alt.ts` trong `ai` như plan. Khi đó `ai` phải lên trên `content-admin` trong bảng §2, và chấp nhận `ai` kéo gián tiếp `content-admin/offers.ts` (đọc `reservations`). Spec §9.4 không muốn điều này, nên phải có quyết định của `kien-truc`.
- **R9-18 (ngôn ngữ của job).**
  - `createJob` chỉ nhận một mã trong `LISTED_LOCALE_CODES`, khác `DEFAULT_LOCALE`, giống route dịch. Ngôn ngữ đang tắt cũng được, vì README "Before launch B" bước 2 dịch trước rồi mới bật.
  - Panel chọn ngôn ngữ từ `SITE_LOCALE_ROWS`; ngôn ngữ đang tắt có thêm chữ "(đang tắt)".
  - Lúc claim, job có ngôn ngữ đã bị gỡ khỏi danh sách thì thành `cancelled`, `error='locale_unlisted'`. Panel hiện "Ngôn ngữ này không còn trên web."
  - Nếu sai: chủ dự án muốn chỉ dịch hàng loạt ngôn ngữ đã bật. Khi đó lọc theo `ENABLED_LOCALE_CODES`.
- **R9-19 (khách thấy gì, thay D8 Step 4.7 và Step 7 mục 3).**
  - Bản `machine` ở ngôn ngữ khác mặc định không hiện cho khách cho tới khi được "Duyệt". Vì vậy job **không expire tag nào**: `TAGS.i18n` không loader nào gắn, và "Duyệt" đã expire qua cache plan.
  - Ngoại lệ là alt EN do AI viết: khách thấy ngay. `writeMachineAlt` expire `tagsForSave(MEDIA.tables)` bằng `revalidateTag(tag, 'max')` khi file đang được dùng lúc ghi, như `expireIfShown` (`media/actions.ts:35-40`).
  - E2E bước 3 mới: sau job, `/vi` vẫn hiện tiêu đề tiếng Anh. "Duyệt" trên `/admin/translations` xong thì `/vi` hiện `«vi» …`.
  - Siết `content-tags.guard.test.ts`: `revalidateTag` cũng chỉ đi qua cache plan, trừ `TAGS.contentOffers` của cron daily.
  - Nếu sai: sau này chủ dự án cho khách xem bản máy dịch. Khi đó mỗi lô của job expire `tagsForSave(def.tables)` và `tagsForStrings(keys)`.
- **R9-20 (audit cho mọi ghi máy, thay "Không ghi audit cho job").**
  - Mỗi item-doc hay mỗi key mà job ghi, và mỗi alt EN tự sinh, có một dòng `insertAudit(client, null, { action: 'machine', … })` trong cùng transaction. Actor `null` ("Tự động", như `ai_usage`); `insertAudit` đã nhận `null` (`lib/server/audit.ts:23`).
  - Thực thể theo `kind.audit` của `CONTENT_KINDS` (highlight ghi vào nhà hàng; `audit: null` như lý do đóng cửa thì không ghi). Chuỗi theo khuôn `content_strings` + `locale` (`strings-admin.ts:266-273`).
  - Thêm nhãn "Máy dịch (AI)" vào `lib/admin/audit-labels.ts`.
  - Form đang mở bị job chen vào thì nhận `conflict` như mọi lần, với câu đúng người.
  - Nếu sai: History quá dày, ví dụ một job ngôn ngữ mới sinh hàng trăm dòng. Khi đó gộp một dòng audit cho mỗi lô, nhưng vẫn phải có dòng mới nhất cho từng thực thể, để `conflictFromHistory` báo đúng.
- **R9-21 (alt ảnh: nguồn byte và điều kiện, sửa R9-12).**
  - `imageForAi` chỉ trả byte cho file `storage='blob'`, chưa xóa, là ảnh, không trang trí. Byte đọc qua `downloadBlob`.
  - File `static` không có nút "Viết alt bằng AI": thay bằng câu "Ảnh tĩnh: chuyển lên Blob trước" ("Before launch A" 1.3). Đường tự sinh không gặp file static, vì upload luôn là Blob.
  - Khi thành công, `RegisterResult.data` có thêm `kind: 'image' | 'pdf'`. `registerMediaAction` kiểm Draft Mode **trước** khi gọi `after()`, rồi `after(() => generateAltQuietly(id))` khi `created && kind === 'image'`. `generateAltQuietly` đọc lại hàng để kiểm cờ trang trí và alt EN, rồi tính năng `alt` và `resolveAiMode`.
  - Nút gọi với `actorId: staff.userId`.
  - Trang chi tiết hiện tag "Máy dịch" cạnh alt EN khi `media_i18n.status='machine'`.
  - D11 đếm lại số ảnh chưa có alt (truy vấn đọc, ghi vào sổ) thay cho số 17.
  - Nếu sai: Production còn hàng `static` sau 013, vì chưa chạy `move-assets-to-blob.mjs` lại. Khi đó thêm đường đọc `public/assets` (fs, kèm `outputFileTracingIncludes` cho route alt), có spike trước.
- **R9-22 (SEO: đích và chỗ gắn, thay R9-11).**
  - `POST /api/admin/ai/seo` nhận `{ target: { kind: 'home' } | { kind: 'restaurant', id }, locale }`. Server gom nội dung (R9-17) và trả `{ title, description }` đã qua `fitWords` 60/155.
  - Với `home`, kết quả điền `seo.home_title` và `seo.home_description`. Cặp `og_*`, mẫu `page_title` và `not_found_title` không gợi ý.
  - Màn SEO: một nút cạnh khối trang chủ, tìm ô bằng `form.elements.namedItem('v:seo.home_title')` (tên `v:<key>`, `StringsForm.tsx:170`) rồi `fillLikeTyping`. Không truy vấn `document`.
  - `RestaurantForm`: nút có ô chọn ngôn ngữ riêng (các ngôn ngữ của form, mặc định EN), điền `seoTitle.<code>` và `seoDescription.<code>`, rồi báo "Đã điền tab XX".
  - Người dùng vẫn phải bấm Lưu.
  - Nếu sai: review UX muốn nút nằm trong từng tab. Khi đó thêm prop `aside?: (code) => ReactNode` cho `TranslatableField`, và một nút điền cả hai ô qua `form.elements`.
- **R9-23 (trợ lý viết phía trình duyệt, thay `useCompletion` của R9-10).**
  - `AssistPanel` dùng `fetch` + `response.body.getReader()` + `TextDecoder`, cùng khuôn `AbortController` của `AiTranslateButton`: đóng panel hay unmount thì `abort()`, và server nhận qua `request.signal`.
  - Lỗi trước stream là JSON `{ message }`, như route dịch.
  - Bỏ ngoại lệ `ASSIST_PANEL` trong `ai-imports.guard.test.ts` (siết) và gói `@ai-sdk/react`. Không gói AI nào vào bundle trình duyệt.
  - Nếu sai: một kiểm tra bundle (`.next/static` không có zod, E2E không có báo cáo CSP) cho thấy `useCompletion` sạch. Khi đó dùng `useCompletion` theo R9-10, và giữ ngoại lệ.
- **R9-24 (panel job tự làm mới, thay `router.refresh()` 5 giây ở D8 Step 6).**
  - `AiJobPanel` là một `section.a-card-row` đặt ngay sau `PageHeader`; bỏ nút tắt và tag "Sắp có" khỏi `actions`.
  - Panel hỏi `GET /api/admin/ai/jobs` mỗi 5 giây; route chỉ trả `liveJobs`, với quyền `content:read`. Panel ngừng hỏi khi không còn job `queued` hay `running`.
  - Panel chỉ gọi `router.refresh()` khi một job đổi trạng thái, để bảng độ phủ và hàng chờ cập nhật.
  - Nếu sai: đo trên Neon thấy trang `/admin/translations` render dưới khoảng 200 ms. Khi đó `router.refresh()` 5 giây như plan cũng được.
- **R9-25 (D8–D12 không thêm migration).**
  - 012 đã có đủ bảng. `progress.skipped` nằm trong `jsonb`. `ai_usage.feature` đã có `translate` và `alt`.
  - Nếu cần thay đổi schema thì đó là migration `016_*.sql`, kèm "### Migration 016" trong README và `db/checks` (`runbook.guard.test.ts`), và chủ dự án áp lên production.
  - Nếu sai: thiếu cột (ví dụ cần index theo `ai_jobs.status`). Khi đó viết 016, chỉ thêm.
- **R9-26 (sổ đợt 9).**
  - Tên file là `docs/superpowers/ledgers/<ngày D12 xong>-phase-9-ledger.md`. Sổ viết tiếng Anh như sổ đợt 8, cùng các mục `Acceptance` / `Rulings` / `Closed in 9` / `Deferred, with the reason` / `Needs a decision (owner)` / `Final gate`; chữ giao diện trích nguyên tiếng Việt.
  - Sổ ghi R9-1 … R9-26 và kết quả từng cái; ghi việc đánh số lại 011 → 012 và tác động của "ngôn ngữ là code" (không còn `serve_machine`).
  - Nếu sai: chủ dự án muốn sổ tiếng Việt. Khi đó đổi cả khuôn cho đợt 10.

### Cần chủ dự án quyết định (bổ sung)

| # | Câu hỏi | Mặc định khi chưa trả lời |
|---|---|---|
| 4 | 012 đã áp lên Neon production chưa? README "Migration 012" chưa có dòng "Done". Preview chạy trên DB production, nên code ở `main` có `/admin/settings/ai` đọc `ai_settings`. | Coi là chưa áp. Mở issue `owner` kèm pre-flight, apply và post-check của README. |
| 5 | Cho phép job hàng loạt dịch ngôn ngữ đang tắt (R9-18)? | Có. |
| 6 | Production còn ảnh `static` không (R9-21)? | Coi như đã chạy `move-assets-to-blob.mjs` sau 013; ảnh `static` không có nút alt AI. |

### Đính chính sau review độc lập (2026-10-17)

Review độc lập của PR #19 kiểm từng `file:dòng` của mục trên ở `origin/main` 5657868. Phần lớn đúng. Các chỗ sau thay chữ của Ruling tương ứng; chỗ nào hai mục nói khác nhau thì làm theo mục này.

- **R9-17: xác nhận.** Ở `main` không module nào import `content-admin`, nên cạnh mới `content-admin → ai` không tạo chu trình. Sửa `.claude/architecture.md:62` thành `content, email, history, media, ai, kernel`; `media` chỉ thêm `imageForAi` và `writeMachineAlt`, không import `ai`.
  - Guard `server-modules` chỉ bắt chu trình, không so từng cạnh với bảng §2. Việc theo bảng §2 vẫn dựa vào review (việc tồn cho đợt 10: thêm assertion "mỗi cạnh nằm trong bảng §2").
  - `content-admin` có 16 file và `translations.ts` đã 434 dòng (quá ngưỡng ~400 của §5). Code mới đặt trong file mới (`machine-translations.ts`, `seo-material.ts`, `machine-alt.ts`), không dồn thêm vào `translations.ts`.
  - Câu "Spec §9.4 không muốn" ở nhánh "Nếu sai" nói quá: §9.4 cấm *gửi* dữ liệu khách cho Vertex, không cấm import gián tiếp. Hàng rào thật là guard theo từng file (`ai-imports.guard.test.ts`).
- **R9-20: sửa (blocker).** `audit_log.action` có CHECK `^(create|update|delete|reorder|restore|settings|staff\.[a-z_]+)$` (`db/migrations/005_staff_auth_audit.sql:108`), nên `action: 'machine'` bị DB từ chối. Ghi máy dùng `insertAudit(client, null, { action: 'update' | 'create', … })` như lần ghi thường (item → `update`, hàng chuỗi mới → `create`), và đánh dấu máy trong `after.meta` (ví dụ `meta: { machine: { model } }`; `meta` không thuộc token, `lib/server/history/snapshot.ts:24`). Nhãn "Máy dịch (AI)" đọc từ `meta`, không thêm vào danh sách action của `lib/admin/audit-labels.ts`. Nhờ vậy R9-25 (không migration) vẫn đứng.
  - Với actor null, `conflictBy` báo "người khác" (`lib/server/conflict.ts:18-21`) và History hiện "Hệ thống" (`lib/server/history/history.ts:27`). Chấp nhận như vậy; không sửa kernel.
  - Lý do đóng cửa: job dịch nó thì ghi audit thực thể `closure` (`lib/server/booking/config.ts:406-444`); không thì loại closures khỏi job, và ghi rõ trong sổ.
- **R9-19: sửa lý do.** Câu "`TAGS.i18n(locale)` không loader nào gắn" sai: có 14 chỗ gắn (`lib/server/content/home.ts`, `legal.ts`, `restaurants.ts`, `seo.ts`, `site.ts`, `strings.ts`). Kết luận vẫn đứng vì lý do khác: ở ngôn ngữ khác mặc định khách chỉ thấy bản `reviewed` (`content/sql.ts:19`, `strings.queries.ts:31`, `booking/rules.ts:110`), email cũng chỉ đếm `reviewed` (`email/booking/render.ts:133`). Đây là lệch có chủ đích so với spec §9.3 ("Gọi `revalidateTag('i18n:<code>', 'max')`"). Nếu sai: một `revalidateTag(TAGS.i18n(locale), 'max')` ở route/cron là đủ.
  - Theo Luật 3, `lib/server/**` không gọi `revalidateTag`/`updateTag`. `writeMachineAlt` (R9-21) trả `{ wrote, shown }`; callback `after()` ở `app/` (action upload, route alt) mới expire `tagsForSave(MEDIA.tables)`.
- **Test cần DB:** claim, lease (`FOR UPDATE SKIP LOCKED`) và chuyển trạng thái của `ai/jobs.ts` cần DB, nên đặt ở `test/integration/` theo `.claude/architecture.md` §1. Test không cần DB thì cạnh code.
- **R9-16:** "Chạy tiếp ngay" dùng chung route với "Tiếp tục", nên route nhận cả job `queued` có `progress.done > 0`, không chỉ `paused`.
- **Lệch spec có chủ đích (ghi vào sổ đợt 9):** R9-19 (không expire tag, §9.3), R9-22 (SEO chỉ cho trang chủ và nhà hàng, vì registry không có cặp key cho từng trang, §9.3), R9-23 (không dùng `useCompletion`, §9.3).
- **R9-26:** sổ đợt 9 theo các mục của sổ đợt 8 và thêm mục `Acceptance`; câu "như sổ đợt 8" hiểu là cùng ngôn ngữ và văn phong.
