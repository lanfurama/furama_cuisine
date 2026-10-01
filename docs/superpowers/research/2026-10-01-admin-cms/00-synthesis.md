# Furama Cuisine admin CMS: architecture decision document

*Lead architect synthesis of 7 research reports · 2026-10-01 · written in English for translation*

## Executive summary

- **Recommendation: Approach 1.** Build a custom admin inside the existing Next.js app, on the existing Neon Postgres database. It uses:
  - Better Auth for staff accounts
  - Vercel Blob for images
  - Resend for email
  - Vertex AI, called from the server. Models, region, prompts, glossary and per-feature switches are set on an **AI settings page in the admin**, as requested ("dùng Vertex AI, config Vertex AI trong admin được").
- It is the only approach that meets all 8 requirements without workarounds, keeps a single login, database and audit log, and costs the least to run (about **$45–95/month**).
- It also takes the most building: about **75–90 developer-days**, roughly 10–15 more than Payload.
- **Payload CMS (Approach 2) is a close runner-up.** It works on this exact stack: a report installed and ran it on Next 16.3.7, React 19.3 and TS 7. It would save about 10–15 days. Its weak point is languages. A brand-new language needs a developer deploy, and admins can only switch on languages from a list fixed in code. It also brings a steady stream of framework upgrades and four open bugs that need workarounds.
- **Sanity (Approach 3) fits worst.** Staff would have two logins and two user lists. The Editor role needs a paid plan ($15/seat/month). The full audit trail is Enterprise-only. Sanity's built-in AI is not Vertex, so we would have to replace it.
- **The site can go live early, in English, after sub-project 5** (about 35–40 days of work). That point delivers bookings with an admin inbox and email alerts. Content editing, languages and AI follow as separately shippable stages.

**Do now, whatever approach is chosen:**
- **Close the open sign-up on the unused Neon Auth.** Today anyone with its URL can create an account.
- **Create a Neon dev branch.** `.env.local` points at the production database.

---

## A) Three architecture approaches

### Shared base (identical in all three)

These parts are needed whatever the CMS choice, so they don't separate the options:
- the guest-site refactor: `app/(site)/[lang]` routing, `proxy.ts`, and removing the hard-coded `taya-house` special cases;
- the timezone and intro bug fixes;
- the reservations engine, kept in our own SQL in every approach;
- Resend email with an outbox table;
- Vercel Blob for images;
- the Vertex AI server code (AI SDK 7 with `@ai-sdk/google-vertex` 5.x, keyless sign-in from Vercel to Google Cloud).

### How each approach meets requirements 1–8

| # | Requirement | 1. Custom admin in Next.js on Neon | 2. Payload CMS 3.90 embedded | 3. Sanity (content) + small custom admin |
|---|---|---|---|---|
| 1 | Edit all guest content within the design | **Built.** Form editors over typed tables. Every collection gets add/remove/reorder/show-hide. A `sections` table handles section show/hide. Layout limits are enforced in the form (hero 1–5 slides, stories ≤4, nav ≤6, etc.). | **Bought.** Globals and collections with arrays, drag-reorder, `visible` checkboxes, media uploads, live preview. | **Bought.** Sanity Studio (can be embedded at `/studio`) with real-time co-editing and visual editing through `next-sanity`. |
| 2 | Admin adds languages; every text translatable; real locale routing | **Full.** A `locales` table, so admins add any language with no deploy. A translation table per entity, with per-field English fallback and review status. Routing via `app/(site)/[lang]` + `proxy.ts`. | **Partial.** Locales are a Postgres enum built from code (`@payloadcms/drizzle/dist/postgres/init.js:24`). Workaround: declare a fixed list of languages in code and let admins switch them on. A language not on the list needs a migration and deploy. Admin UI ships in 44 languages. | **Full for content.** `sanity-plugin-internationalized-array` can load its language list with a query, so editors add languages as documents (README "Loading languages", verified). Guest routing is the same custom work. |
| 3 | Admin/Editor roles, email invites, audit log | **Built on a library.** Better Auth admin plugin with real `admin`/`editor` roles (`createAccessControl`). App-owned invites sent through Resend. An `audit_log` row written in the same transaction as every change. One login for everything. | **Mixed.** Role and field access is built in. Invites and audit log are custom: Payload v3 version history stores no author (verified by the report). | **Weak.** Content staff are managed in Sanity, but the Free plan has only Administrator/Viewer; **Editor needs Growth at $15/seat/month**. The activity feed keeps 90 days; the **full audit trail is Enterprise-only** (sanity.io/pricing, fetched 2026-10-01). Reservations and AI settings need a second login system, so two user lists and two audit logs. |
| 4 | Vertex AI: translate, writing help, SEO and alt text; settings page in admin | **Built.** Route handlers call Vertex. The settings page and AI buttons are ordinary parts of our own admin. | **Built.** Same server code. Buttons are Payload `afterInput` components; settings are an admin-only global. Must avoid Payload bug #18246 (translation saves landing in the wrong language; still **open**, checked via `gh`). | **Built, awkward.** Sanity's built-in AI Assist runs on Sanity's own AI credits, not Vertex, so it must be switched off. Vertex buttons become a Studio plugin calling our app from another domain, which needs a way to trust Sanity users. The settings page lives in the separate custom admin. |
| 5 | Reservations inbox, confirm/cancel/no-show, search, closures | Native screens in the same admin. | Custom views inside the Payload admin, over our SQL tables (rendered fine in the report's test). | A separate custom Next.js admin with its own login. |
| 6 | Detail page for every restaurant (toggle) | `has_detail_page` switch plus a generic `/[lang]/restaurants/[slug]` page. | Same; tested by the report. | Same, reading from Sanity. |
| 7 | Per-restaurant hours, slots, capacity | SQL tables (service periods, slot overrides, closures) next to the bookings. Capacity is checked in one transaction. | Can be modelled in Payload, but the booking engine then reads across two schemas. Better kept in SQL behind a custom view. | Must stay in Neon (it needs transactions), so it is edited in the custom admin. |
| 8 | Email: staff on new booking, guest on confirmation | Resend, outbox table, `after()`, cron retries. | Same, plus `@payloadcms/email-resend` for login emails. | Same. Sanity sends its own invite emails to content staff. |

### Built vs bought, effort, cost, lock-in

| | 1. Custom | 2. Payload | 3. Sanity + custom |
|---|---|---|---|
| Bought or open source | Next.js, Better Auth (MIT), AI SDK, Resend, Blob | Payload admin, auth, media, versions/drafts, localisation UI, SEO plugin | Studio, hosted content store, CDN, invites, document history |
| Built by us | Admin forms and form kit, media library, translation workflow, invites, audit, AI, reservations, emails | Invites, audit, all AI features, reservations views, guest i18n routing, workarounds for 4 open bugs | Reservations admin **plus its own login**, AI Studio plugin, Vertex bridge, content reads in GROQ, revalidation webhook, i18n routing |
| Effort (1 experienced dev, ±25%) | **75–90 dev-days** | **60–75 dev-days** | **68–85 dev-days** |
| Monthly running cost | **$45–95** | **$45–95** (Payload is free, MIT) | **$90–185** (adds Sanity Growth at $15/seat × 3–6 staff) |
| Lock-in | **Low.** Plain Postgres tables and open-source libraries. Vercel ties (Blob, keyless sign-in, cron) are moderate. Vertex sits behind the AI SDK. | **Medium.** Payload's schema and conventions, in our own database. A v4 migration is coming. | **High.** Content lives in Sanity's hosted store and uses GROQ/Portable Text. Export is possible. Pricing is per seat. |

How the monthly cost adds up for Approaches 1 and 2:

| Item | Cost | Basis |
|---|---|---|
| Vercel Pro | $20/developer seat, includes a $20 usage credit | Required: Hobby is "for personal, non-commercial use" (vercel.com/pricing) |
| Neon Launch | about $0–20 | $0.106 per CU-hour, $0.35 per GB-month (neon.com/pricing) |
| Resend Pro | $20 | The free tier's 100 emails/day is too tight |
| Blob + Image Optimization | about $1–5, mostly inside the Vercel credit | |
| Vertex AI | about $1–20 | Translating the whole site into one new language with `gemini-3.8-flash` costs well under $1 (my estimate: ~15k tokens of source text). A monthly budget cap is enforced in the app. |

### Main risks

1. **Custom:**
   - Admin UX quality depends on our own form kit. Mitigated by one small reusable form kit.
   - We own the auth configuration, so security mistakes would be ours. Mitigated by following the Next 16 data-access-layer pattern, with a permission check in every action.
   - Biggest code volume.
   - Better Auth and AI SDK 7 types under TypeScript 7 are unverified, so plan a day-1 test.
2. **Payload:**
   - Arbitrary new languages need a deploy.
   - **Data-loss trap.** Payload's development "push" mode, run against the shared database, tried to rename `restaurants`/`reservations` and to drop `reservations_id_seq` (report tests A and B).
   - Open bugs (all confirmed **OPEN** via `gh` on 2026-10-01):
     - #18065: admin errors with Cache Components on Next 16.3
     - #17906: a global `Critical-CH` header makes Chrome send the first guest request twice
     - #16939: crashes on Neon connection drops
     - #18246: translated values saved into the wrong language
   - 3.90.0 was a critical security release with breaking changes, and a large v4 migration is ahead.
   - `node_modules` grows from 372 MB to about 810 MB.
   - React 19.3 is not in Payload's tested combination.
3. **Sanity:**
   - Two admin apps, two user lists, two audit trails.
   - Seat pricing.
   - Full audit trail only on Enterprise.
   - Content outside our database.
   - The Vertex integration means cross-site calls from Studio into our app.

### Scores (1 = poor, 5 = excellent)

| | Requirement fit | Editor UX | Time to launch | Maintainability | Security | Cost | **Total /30** |
|---|---|---|---|---|---|---|---|
| 1. Custom | **5** | 3 | 2 | **4** | 4 | **5** | **23** |
| 2. Payload | 4 | **4** | **3** | 3 | 3 | **5** | **22** |
| 3. Sanity + custom | 3 | 4 | 3 | 3 | 3 | 3 | **19** |

---

## B) Recommendation: Approach 1, custom admin in the Next.js app on Neon

1. **It is the only approach that meets requirement 2 as written.** "Admin can add locales" works without a deploy, and translations keep a review status per language. That status is what the Vertex translate-then-review workflow depends on.
2. **A CMS framework saves little here.** The design is fixed, there is no page builder, and there are about 50 content rows plus around 200 interface strings. Payload's value is mostly ready-made form screens, worth an estimated 10–15 developer-days. The largest admin area, reservations, is custom in every approach.
3. **One system, one database, one login, one audit log, one migration history.** Payload would add a second migration history and a second database connection pool. Sanity would add a second user directory.
4. **Lower long-term maintenance.** There is no framework upgrade cycle to follow (Payload releases weekly, had critical security fixes with breaking changes in 3.90, and v4 is coming) and no open-bug workarounds to carry.
5. **Vertex AI and its admin settings sit naturally in our own admin.** We avoid Payload's localisation bug #18246 and Sanity's competing built-in AI.

**When to switch to Payload instead:** if a launch 2–3 weeks earlier matters more than runtime languages, and the owner accepts that admins choose from a fixed list of languages (e.g. en, vi, ko, zh-Hans, zh-Hant, ja, ru, th, fr) and anything else needs a small deploy. The server code (reservations, AI, email) carries over unchanged.

---

## C) Design of the recommended approach

### C1. Components (one clear purpose each)

**Guest side**

| Unit | Purpose |
|---|---|
| `lib/venue-time.ts` | Vietnam-time date maths for both client and server: `venueNow`, `addDays`, `isoWeekday`, `minutesUntil`, `formatDay` (Intl). Fixes the timezone bug. |
| `proxy.ts` | Redirects paths with no language prefix (cookie → browser language → `en`). Does a quick sign-in cookie check for `/admin` and sets the admin security policy. Next 16 allows only one proxy file. |
| `lib/server/content/get-*.ts` | Cached read functions (`'use cache'` + `cacheLife('max')` + `cacheTag`) with per-field fallback to English. |
| `lib/cache-tags.ts` | The single list of cache tag names. |
| `lib/i18n/*` | Locale config, language negotiation, ICU message formatting, the registry of interface-text keys (English default, max length, placeholders, context note). |
| `components/site/*` | Existing components, now fed by props from the read functions instead of `lib/data.ts`. |
| `CmsImage`, `LanguageSwitcher`, `ViewMarker`, `IntroTrigger` | Image wrapper with localised alt text; language switch link (a full page load); page-type signal that replaces reading the URL path; intro animation trigger on each page (fixes the intro bug). |

**Booking**

| Unit | Purpose |
|---|---|
| `booking/availability.ts` | Pure function: (restaurant, date) → service periods minus closures → slots with covers left. |
| `booking/reservations.ts` | Booking transaction: advisory lock, capacity check, insert, event row, outbox rows. |
| `booking/transitions.ts` | The status map (requested → confirmed / declined / cancelled; confirmed → seated / no_show) with optimistic concurrency. |
| `booking/reference.ts` | `FC-` + 8 Crockford base32 characters from `node:crypto`. Lookup also accepts legacy references. |

**Admin side**

| Unit | Purpose |
|---|---|
| `auth/server.ts`, `auth/permissions.ts` | Better Auth configuration; admin/editor permission statements. |
| `dal/session.ts` | `verifySession()` and `requirePermission()`, the only gate for pages, actions and route handlers. |
| `audit.ts` | Writes the audit row inside the caller's transaction. |
| `content/save-*.ts` | Server Actions: authorise → validate (zod) → write → audit → `updateTag`. |
| `media/*` | Upload-token route, register, cleanup sweep. |
| `email/*` | React Email templates, outbox enqueue, sender, Resend client, environment gate. |
| `ai/*` | Keyless Google auth client, model catalogue, provider factory, settings (zod), glossary masking, translate / assist / SEO / alt features, usage ledger and budget. |
| Admin form kit | `TranslatableField` (language tabs + AI button), `ImagePicker`, `SortableList`, `VisibilityToggle`, `SaveBar` with conflict message. |
| Cron routes | `outbox` (email retries), `media-sweep`, `ai-jobs` (batch translation), `retention` (personal-data anonymisation). |

### C2. Data model (tables)

**Languages and site-wide content**

| Table | Purpose |
|---|---|
| `locales` | Code, BCP-47 tag, native name, short label, default, enabled, `serve_machine`, order. |
| `content_strings` | `(key, locale)` → value. Holds section copy, interface text, SEO text and guest email copy (`email.*` keys). |
| `sections` | Visibility, image and link per home section. Restaurants can never be hidden. |
| `site_settings` | One row: contact email, defaults, hero autoplay timing, default share image. |

**Content collections**

- Each has a base table plus a `*_i18n` table: `destinations`, `cuisines`, `restaurants` (existing table, extended with slug, destination, images, phone, map, `has_detail_page`, `is_bookable`, `is_published`, `archived_at`), `restaurant_highlights`, `experiences`, `stories`, `offers`, `nav_items`.
- Also `restaurant_cuisines`, `hero_slides` and `social_links`.
- Every translation row carries `status` (draft / machine / reviewed), `origin`, `ai_model`, `source_hash`, reviewer and `updated_by`.

**Media**

| Table | Purpose |
|---|---|
| `media` | Storage type (`blob` / `static`), URL, size, dimensions, blur placeholder, focal point, decorative flag, soft-delete. |
| `media_i18n` | Alt text per language, with the same review-status columns. |

Content tables point at images with `ON DELETE RESTRICT`, so an image in use cannot be deleted.

**Bookings**

| Table | Purpose |
|---|---|
| `booking_settings` | One row of defaults: booking window, lead time, same-day cutoff, max party, auto-confirm, retention period. Each restaurant can override. |
| `service_periods`, `service_slot_overrides` | Weekly opening template per restaurant, with per-slot capacity changes. |
| `closures` + `closure_i18n` | Closed days or services, by restaurant, destination or everywhere, with an optional public reason per language. |
| `reservations` | Extended with `meal`, `phone_e164`, `locale`, `source`, `offer_id`, status timestamps, `version`, `search_text`, `is_test`. Status list widened. |
| `reservation_events` | Booking timeline. |
| `reservation_notes` | Internal staff notes, never shown to guests. |
| `notification_recipients` | Who gets booking alerts, per restaurant, destination or everywhere, and in which language. |
| `email_outbox` | Emails waiting to be sent, with retry state. |

**Staff and governance**

| Table | Purpose |
|---|---|
| `staff_user`, `staff_session`, `staff_account`, `staff_verification` | Better Auth tables, SQL generated by `npx auth@latest generate`. |
| `auth_rate_limit` | Sign-in rate limiting. |
| `staff_invitation` | Hashed token, 7-day expiry, single use. |
| `audit_log` | Actor, action, entity, locale, before/after JSON, IP. No foreign key, so history survives user removal. |
| `ai_settings` | One row, zod-validated, versioned. |
| `ai_glossary` | Terms to keep or map per language, e.g. keep "Tàya House"; map "Da Nang" to "Đà Nẵng" in Vietnamese. |
| `ai_usage` | Token and cost ledger. |
| `ai_jobs` | Progress of batch translations. |

**Migration rules:**
- Hand-written SQL files in `db/migrations`, applied by `scripts/migrate.mjs`. Each file runs in one transaction.
- Seed data always uses `ON CONFLICT DO NOTHING`. The existing seed uses `DO UPDATE` (002:18-25) and would overwrite admin edits if re-run.
- Expand first; contract later. Dropping `slot_capacity`, the global `SLOTS` table and the `lib/data.ts` constants waits until the new code is live.

### C3. Route and file layout

```
proxy.ts
next.config.ts   cacheComponents:true; experimental:{ globalNotFound:true, serverActions:{bodySizeLimit:'2mb'} };
                 images.remotePatterns = exact Blob hosts; minimumCacheTTL ≈ 31 d; qualities [75,85];
                 redirects(/taya-house → /en/restaurants/taya-house); headers() guest CSP
app/
  global-not-found.tsx  sitemap.ts (hreflang alternates)  robots.ts  icon.svg
  (site)/[lang]/layout.tsx            ROOT 1: <html lang>, fonts (+Noto KO/ZH per locale), SiteProvider, Chrome
  (site)/[lang]/page.tsx              home
  (site)/[lang]/restaurants/[slug]/page.tsx   generic Tàya-House template; notFound() unless has_detail_page
  (site)/actions.ts                   submitReservation({..., date: ISO, locale}) → error codes, not English text
  admin/layout.tsx                    ROOT 2: own <html>, admin.css, noindex, instant=false
  admin/sign-in · accept-invite · reset-password
  admin/(app)/page.tsx                dashboard (pending bookings, missing/out-of-date translations, failed emails)
  admin/(app)/reservations/           inbox · [id] · new · day · calendar · closures · emails
  admin/(app)/restaurants/            list · [id] (content, detail page, highlights, SEO) · [id]/booking (hours, capacity)
  admin/(app)/content/                sections · hero · cuisines · destinations · experiences · heritage · stories
                                      · offers · navigation · contact-socials · seo · ui-text · emails
  admin/(app)/media · translations · locales
  admin/(app)/settings/ai · settings/booking · settings/notifications   (Admin only)
  admin/(app)/users · audit                                            (Admin only)
  api/auth/[...all]/route.ts
  api/availability/route.ts           never cached; returns server "today"
  api/admin/ai/{translate,assist,seo,alt}/route.ts
  api/admin/media/upload/route.ts
  api/cron/{outbox,media-sweep,ai-jobs,retention}/route.ts
lib/venue-time.ts  lib/cache-tags.ts  lib/i18n/*
lib/server/** (import 'server-only'): db, dal, auth, audit, content, booking, email, media, ai
components/site/* · components/admin/form/*
```

Notes on the layout:
- Two root layouts mean that moving between the guest site and `/admin` is a full page load. That is intended (`route-groups.md:30`).
- Switching only the language is a soft navigation within the same layout (router source `is-navigating-to-new-root-layout.js:16-24`). The language switcher therefore uses a plain link, which reloads the page cleanly.

### C4. Staff sign-in flow

1. **First Admin.** Created once with `npx auth@latest create-admin`. Allowed by an exception for a bootstrap email set in env.
2. **Invite.** An Admin invites someone with a role. A Server Action checks `user:create`, stores the SHA-256 of a random 32-byte token (7-day expiry) and emails `/admin/accept-invite?token=…` through Resend.
3. **Accept.** The page re-checks the token, collects name and password, then calls `auth.api.createUser` with the role, marks the invite used and signs the person in. Cookies are set via the `nextCookies()` plugin.
   - Public sign-up is off (`disableSignUp`).
   - A `user.create.before` hook rejects any email without an open invitation, even direct calls to the sign-up API.
4. **Every request.**
   - `proxy.ts` only checks that a session cookie exists on `/admin/*`; it never queries the database.
   - Each admin page calls `verifySession()`.
   - **Every Server Action and route handler** calls `requirePermission()` itself, validates input, writes the audit row in the same transaction, and returns minimal data. Pages and Proxy are not security boundaries (`authentication.md:1033,1121`; `data-security.md:281-291,339`).
   - Admin route handlers also check the `Origin` header themselves, because the built-in cross-site protection covers Server Actions only.
5. **Permissions.**
   - Editor: content (read, update, publish), reservations, closures.
   - Admin: all of that plus users, settings (AI, booking, notifications) and the audit viewer.
   - The last Admin cannot be demoted or removed.
6. **Housekeeping.**
   - Password reset through Resend.
   - Sessions last about 7 days.
   - Rate-limit storage set to `database`, because the in-memory default does not work across serverless instances.
   - `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` in env.
   - Preview hosts allowed by a narrow project pattern, not `*.vercel.app`.

### C5. AI flow (Vertex AI, configured in the admin)

**Google Cloud sign-in (keyless).**
- Vercel already issues an OIDC identity token for this project: team issuer `https://oidc.vercel.com/lannguyenvkus-projects`.
- Google Cloud Workload Identity Federation exchanges it for access as a service account that has `roles/aiplatform.user`. No GCP secret is stored anywhere, not in env or the database.
- In code, `ExternalAccountClient` gets `getSubjectToken: () => getVercelOidcToken()`. **Wrap it in a function.** Vercel's own sample passes it bare, which triggers an unwanted token exchange.
- A service-account key in env is the fallback only.

**AI settings page (`/admin/settings/ai`, Admin only).**
- For each feature (translate, assist, SEO, alt text):
  - on/off switch
  - model family: Gemini or Claude on Vertex
  - model, from a dropdown filtered by a model catalogue in code
  - region, filtered by that model: current models offer only `global`, `us` and `eu`
  - reasoning level and max output tokens
  - system prompt
- Global settings: brand-voice prompt; do-not-translate glossary; limits per user per minute and per day, plus a monthly USD budget.
- The page shows only *whether* each GCP env var is present (yes/no) and the project id.
- Every save is audited and calls `updateTag('ai-settings')`.

**Defaults.**
- `gemini-3.8-flash` on `global` for every feature: GA, cheapest, no Model Garden step.
- Claude is opt-in. If chosen, `claude-opus-5-5` by default with `claude-sonnet-5-5` selectable. Claude needs:
  - each model enabled in Model Garden;
  - `providerOptions.anthropic.structuredOutputMode: 'outputFormat'` on every call. Without it, Claude 5.5 on Vertex can silently fail to return structured output.
  - if the GCP project belongs to an Organization, an org policy allowing `structured_outputs`.
- Do not default to `gemini-2.5-flash` (retires 2026-10-20) or `claude-haiku-4-5` (retires no sooner than 2026-10-15).

**Test connection.** A Server Action, with a 20 s limit, that checks in order:
1. env vars present
2. Google access token
3. a short text reply
4. a structured-output reply
5. optionally, an image description

It returns latency, usage and warnings. Errors are explained in plain terms: 401/403 means a missing permission or the model is not enabled; 404 means the model is not offered in that region; 429 means quota; 400 means bad parameters or an org policy block.

**Translate.**
- **Interactive.** "Translate from EN" on a field or document calls `/api/admin/ai/translate`.
  - Glossary terms are swapped for placeholders (`⟦G1⟧`) before sending.
  - One call per document, returning `{items:[{id,text}]}` via `generateText` + `Output.object`.
  - Checks that every id, placeholder and ICU variable such as `{name}` comes back, and that "Tàya House" and "Phố Cuốn" are unchanged.
  - The suggestion fills the form; the editor saves it as reviewed.
- **Batch.** "Fill all missing or out-of-date VI/KO text" creates an `ai_jobs` row.
  - It runs in chunks through a route handler or cron, using Gemini Flex pricing (50% off on `global`).
  - Rows are written with `status='machine'`. Guests see machine text only if that language's `serve_machine` switch is on.
  - A review queue lists them. When the English source changes, `source_hash` no longer matches and the row is flagged "EN changed since translation".

**Writing assistant.** A streaming route handler (`streamText` → `toTextStream` → `createTextStreamResponse`) consumed by `useCompletion({ streamProtocol: 'text' })`. Closing the panel stops the request, and billing.

**SEO meta.** Generates a title and description per page, restaurant and language. Lengths (≤60 and ≤155 characters) are enforced after generation. Results are suggestions only.

**Alt text on upload.**
1. The browser uploads straight to Blob.
2. The `registerMedia` action saves the media row.
3. `after()` resizes the image to about 1024 px with `sharp`, then Gemini describes it.
4. The text is saved as English alt, status `machine`.
5. Later translation runs through the normal pipeline.

Images marked decorative never get alt text.

**Guardrails.**
- Long AI calls run in route handlers, not Server Actions, because a browser tab runs Server Actions one at a time (`server-actions.md:28-30`).
- Server-side caps on input length and output tokens; `maxRetries: 1`; timeouts.
- Every call is recorded in `ai_usage`, and the per-user and monthly limits are checked first.
- GCP budget alerts and quota overrides act as a backstop.
- **Guest personal data is never sent to Vertex.** Email templates are translated with their placeholders; individual bookings are never translated.

### C6. Caching and revalidation

1. **Guest pages are cached.**
   - Every guest read goes through a cached function (`'use cache'`, `cacheLife('max')`, `cacheTag(...)`).
   - The language comes from `lang()` in `next/root-params`, which works only inside `'use cache'`, not inside `unstable_cache` (`next-root-params.md:376-378`, verified).
   - `unstable_cache` "has been replaced by `use cache`" in Next 16 (`unstable_cache.md:7`, verified).
2. **Tags:**
   - `content:{hero|cuisines|destinations|experiences|heritage|stories|offers|nav|contact|seo|sections}`
   - `restaurants`, `restaurant:<id>`, `booking-rules:<id>`
   - `locales`, `i18n:<code>`, `ai-settings`
3. **Admin save** → `updateTag(tag)`. This is allowed only in Server Actions (`updateTag.md:12`, verified) and re-renders the editor's page in the same response. On Vercel the cached guest pages are purged globally within about 300 ms. A guest who already has the page open can see the old version for up to 5 minutes (the client router cache).
4. **Never cached:** reservations, availability, all admin lists. After a status change, admin actions call `refresh()`.
5. **New languages and restaurants added later** are not in the build-time list (`generateStaticParams`, which always includes `en`). They render on first request and are then cached. Every page calls `notFound()` for a disabled language or a restaurant whose detail page is off.
6. **`proxy.ts` reads the list of active languages** from a small in-memory copy refreshed every ~60 s, because Proxy cannot use the Next cache. Pages remain the real check.
7. **Fallback** if the Cache Components migration overruns its budget: use `unstable_cache` with tags and an explicit `lang` argument, keeping the same tag names and the same `updateTag` calls. Moving to Cache Components later is then mechanical.
8. **Draft preview** is optional (decision D2). If chosen, a signed-in "Preview" action turns on Draft Mode, and the read functions return draft values.

### C7. Reservations flow and notifications

1. **Guest booking.**
   - The day strip and time slots come from `GET /api/availability?restaurant=&from=&to=` and `?date=&guests=`. The server supplies "today" in Vietnam time, so the guest's device clock and timezone no longer matter.
   - Closed days appear greyed out with an optional public reason.
2. **Submit.** `submitReservation({restaurant, date (ISO), time, guests, name, phone, email, note, locale, offerId})`:
   - validates the date, booking window, lead time and party size against the server clock in `Asia/Ho_Chi_Minh`;
   - normalises the phone to E.164;
   - in **one transaction**: `pg_advisory_xact_lock(restaurant+date)`, re-check capacity (slot and whole service), insert, `created` event, outbox rows (staff alert in each recipient's language; guest "request received" if they gave an email);
   - commits, then `after(() => drainOutbox(ids))`.
   - A reference collision retries with a new reference; only the duplicate-booking constraint returns `duplicate`.
   - Errors come back as codes (`full`, `closed`, `past`, …) that the browser shows in the guest's language.
3. **Staff actions.** In the inbox (tabs: needs action, today, upcoming, all; one search box for reference, phone, name or email), a status change runs: `UPDATE … WHERE id=$1 AND version=$2 AND status = ANY(allowed)` + event + outbox row (`guest.confirmed`, `.cancelled` or `.declined`) in one transaction, then `after()` sends.
4. **Sending.**
   - The sender claims rows with `FOR UPDATE SKIP LOCKED` and re-reads the booking first; if the status has changed since, it skips the email.
   - It renders the React Email template in the row's language, falling back to English, and sends through Resend with an idempotency key.
   - Retries every 5 minutes via cron (Vercel Pro; Hobby allows only one run a day), also on each new booking and admin action, and from a "Retry now" button.
   - `EMAIL_DELIVERY=live` is set in Production only. Elsewhere emails are logged or redirected, and the sender only sends rows from its own environment.
5. **Changing hours or closures** shows the existing bookings affected and offers a bulk "Cancel & notify". Nothing is cancelled automatically.

### C8. Testing strategy

| Layer | What it covers |
|---|---|
| Unit (Vitest or `node:test`, to be chosen) | `venue-time`, with a server on UTC at 23:59/00:01/06:59 Vietnam time; availability (periods, closures, overrides, reduced capacity); the status map; reference normalisation; ICU messages and plurals; glossary masking and placeholder checks; zod settings validation and model/region rules |
| Database integration (a fresh Neon branch per CI run, or local Postgres 18) | Migrations run on a copy of production data; parallel bookings never overbook; duplicate detection; outbox idempotency; sweep jobs touch only their own environment |
| End-to-end (Playwright) | Guest booking in EN and VI; language switch; closed days; role matrix (Editor blocked from `/admin/settings` **and** from direct POSTs to Admin-only actions; signed-out POSTs rejected); invite token reuse and expiry; content edit appears on the guest page; reservation confirm captures the email (`EMAIL_DELIVERY=log`) |
| Proxy | Matcher tests with `unstable_doesProxyMatch` |
| AI | Recorded-response tests in CI; a small real-Vertex set run on demand (glossary names kept, placeholders kept, lengths respected); "Test connection" checked against each configured model |
| Visual | Screenshots of home and detail pages at phone and desktop width, in EN and the longest language, to catch overflow in the fixed layouts (nowrap header, fixed-height heritage block, 418 px mobile detail hero) |
| Security guard | A CI check that every `'use server'` export and admin route handler calls `requirePermission` |

### C9. Sub-projects in build order (each shippable on its own)

| # | Sub-project | Delivers | Size (dev-days) |
|---|---|---|---|
| 0 | **Environments and safety** | Neon dev branch + a branch per preview; Neon Auth sign-up closed; Vercel Pro; CI with unit and Playwright skeletons | S · 1–2 |
| 1 | **Booking correctness and bug fixes** | `venue-time.ts`; ISO dates sent between browser and server; server-supplied "today"; fixed cutoff check; new references with retry; `phone_e164` and a new duplicate index; error codes; date computed after load instead of during render; intro fix (`IntroTrigger` replaces `useIntro(true,0)` in the persistent `Chrome.tsx:26`, whose effect at `lib/motion.tsx:257` never re-runs) | S · 4–5 |
| 2 | **Guest restructure** | `app/(site)/[lang]` with only EN active; `proxy.ts`; `/taya-house` redirect; `global-not-found`; Cache Components on; read-layer skeleton; slug keys for cuisines and meals; `taya-house` special cases removed (`has_detail_page`); hero autoplay and journey dots computed from counts (now `% 3` at `SiteProvider.tsx:447` and fixed percentages at `Destinations.tsx:29`); `ViewMarker`; DOM queries scoped to the page | M · 5–7 |
| 3 | **Staff sign-in and admin shell** | Better Auth, roles, invites, password reset, `audit_log`, users page, admin layout, Resend for sign-in emails | M · 6–8 |
| 4 | **Reservations v2 and inbox** | Expand migration; service periods, overrides, closures, booking rules; availability engine and API; drawer using server slots and showing closed days; status lifecycle; inbox, detail, new booking, day sheet, calendar, closures screens; search | L · 10–12 |
| 5 | **Booking notifications** → **launch point A (EN site live)** | Outbox, React Email templates EN/VI (copy kept in code for now), `after()` sending, cron retries, recipients settings, email log, environment gate | M · 4–6 |
| 6 | **Content model, guest site from the database** | All content and translation tables; `locales` with `en`; `content_strings`; `sections`; `site_settings`; media rows pointing at `/assets`; seeds from `lib/data.ts`; guest site reading cached functions; **generic detail page for every restaurant** | M/L · 8–10 |
| 7 | **Admin content editors and media library** | Form kit; editors for every collection and singleton; reorder, show/hide, layout limits; restaurant editor with detail-page switch and highlights; SEO; interface text; email copy; Blob uploads; existing images moved to Blob; daily cleanup | L · 12–15 |
| 8 | **Multiple languages** | Language admin (add, enable, `serve_machine`); language switcher; hreflang and sitemap; Noto fonts for KO/ZH; language tabs in every editor; coverage and out-of-date dashboard; guest email language | L · 8–10 |
| 9 | **Vertex AI** | Keyless Google sign-in; model catalogue; **AI settings page**; test connection; translate (field and batch, glossary); streaming writing assistant; SEO meta; alt text on upload; usage ledger and budget | L · 9–11 |
| 10 | **Hardening → launch point B** | Security headers (CSP); bot and rate protection on booking (honeypot, per-phone limit, BotID or Firewall rule); personal-data retention job; final cleanup migration (drop `slot_capacity`, `SLOTS`, `data.ts` constants); runbook and staff training | M · 4–6 |
| | **Total** | | **≈ 75–90** |

**Calendar time:** about 4–4.5 months with one developer. With two developers, about 2.5–3 months: after step 3, steps 4–5 can run in parallel with steps 6–7.

---

## D) What we need from you

### D1. Decisions that change the design (recommended default in brackets)

1. **Languages without a developer.** Must admins be able to add *any* new language with no developer, or is choosing from a fixed list enough? [Any language. This is what makes Approach 1 better than Payload.] Also: which languages at launch, and which Chinese script, zh-Hans or zh-Hant? [EN + VI at launch; zh-Hans.]
2. **Publishing.** Do edits go live on save, or draft → preview → publish? [Live on save, +0 days; drafts add about 5 days.] May Editors publish, or only Admins? [Editors may publish.]
3. **Machine translations for guests.** Should guests ever see unreviewed AI translations? [No. Only reviewed text, falling back to English. A per-language switch exists if wanted.]
4. **Admin interface language.** [English only at launch; Vietnamese admin interface adds about 3–4 days.]
5. **Booking policy.**
   - Should any restaurant confirm bookings automatically? [No, staff confirm.]
   - Will staff mark guests "Arrived"? [Yes, needed for the no-show rate.]
   - Booking window and maximum party size? [14 days, 12 guests, editable per restaurant.]
   - Should guest email stay optional? [Yes; guests without email are confirmed by phone.]
6. **Editor scope.** Can every Editor see all restaurants, or only their own restaurant or destination? [All. Per-restaurant scoping adds about 2–3 days.]
7. **Hosting.** Confirm Vercel Pro and that servers stay in the US region iad1 next to Neon. [Yes.] The Blob store region cannot be changed later.
8. **AI.**
   - Gemini only at launch, or Claude as well? [Gemini only; Claude can be switched on later from the settings page.]
   - Monthly AI budget and per-Editor daily limit? [$20/month, 100 calls per Editor per day.]
   - Should preview deployments have AI access? [No.]
9. **Personal data.** How long do we keep guest names, phones and notes before anonymising? [24 months, under Vietnam's Personal Data Protection Law 91/2025, in force 2026-01-01.] Delete the existing pre-launch test bookings? [Yes.]
10. **Domains.** Production domain, and a sending subdomain for email (e.g. `mail.furamavietnam.com`).

### D2. Setup you need to do yourself (or approve)

**Now**
1. **Neon Console** → production branch → Auth: **disable sign-up**. Create a `dev` branch and point `.env.local` at it. Turn on "branch per preview deployment" in the Neon–Vercel integration.
2. **Vercel:** upgrade to **Pro**.

**Before sub-project 3**
3. **Resend.** Choose the Marketplace or a direct account. The Marketplace guide expects a domain bought on Vercel; the fallback is a direct account plus `vercel env add RESEND_API_KEY`.
   - Region `ap-northeast-1` (Tokyo); **Pro plan**.
   - Furama IT adds DNS records at furamavietnam.com's DNS host:
     - MX on `send.mail` → `feedback-smtp.ap-northeast-1.amazonses.com` (priority 10)
     - TXT on `send.mail` → `v=spf1 include:amazonses.com ~all`
     - DKIM TXT on `resend._domainkey.mail`
     - DMARC on `_dmarc.mail` starting at `p=none`. First check whether the root domain already has a DMARC record.
4. **Secrets in Vercel** (Production, Preview, Development): `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CRON_SECRET`, `EMAIL_FROM`, `EMAIL_DELIVERY=live` (Production only), `EMAIL_REDIRECT_TO` (Preview/Development). Also give us the first Admin's email.

**Before sub-project 9 (Google Cloud)**

5. Create a GCP project with billing, and tell us whether it sits under a Google Cloud Organization.
6. Enable the Vertex AI API (`aiplatform.googleapis.com`), the IAM Service Account Credentials API and the Security Token Service API.
7. Create a service account, e.g. `furama-vertex`, with `roles/aiplatform.user`.
8. Create a Workload Identity pool `vercel` with an OIDC provider `vercel`:
   - issuer `https://oidc.vercel.com/lannguyenvkus-projects`
   - allowed audience `https://vercel.com/lannguyenvkus-projects`
   - mapping `google.subject = assertion.sub`
9. Grant `roles/iam.workloadIdentityUser` on the service account to the subjects `owner:lannguyenvkus-projects:project:furama-cuisine:environment:production` and `…:development`.
10. If you want Claude: enable `claude-opus-5-5` and/or `claude-sonnet-5-5` in Model Garden. If the project is under an Organization, also allow `structured_outputs` in the org policy `vertexai.allowedPartnerModelFeatures`.
11. Set a billing budget alert and lower the Vertex quotas as a hard cap.
12. Add to Vercel env: `GCP_PROJECT_ID`, `GCP_PROJECT_NUMBER`, `GCP_SERVICE_ACCOUNT_EMAIL`, `GCP_WORKLOAD_IDENTITY_POOL_ID`, `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID`.

**Before sub-project 7**

13. Create Blob stores: `furama-media` (public, iad1, Production) and a second store for Preview and Development.

**Content inputs**

14. Original high-resolution photos. Several current images are 45–174 px wide but shown large: 4 cuisine icons, 2 hero slides, 4 restaurant cards.
15. Menu PDFs per language.
16. Confirm the TikTok handle `@furama.dining.hous` (possible typo) and the Dining House phone (+84 859 555 759).

---

## Conflicts between the reports and how I resolved them

| # | Conflict | Resolution |
|---|---|---|
| 1 | **Cache Components:** the Payload report says keep it off; the Next.js report says turn it on. | The "off" advice only applies to Payload (#18065 confirmed **open**). For Approach 1, turn it on: `unstable_cache.md:7` says it is replaced, and root params fail inside `unstable_cache` (`next-root-params.md:376-378`). Fallback described in C6 step 7. |
| 2 | **Staff sign-in and emails:** the storage report plans Neon Managed Auth with Resend SMTP or webhooks; the auth report recommends self-hosted Better Auth. | **Better Auth.** Managed Auth cannot express an Editor role, its SDK is still `0.5.0-beta`, and its emails are Neon-templated. That part of the storage report no longer applies. |
| 3 | **Existing images:** the content report keeps `/assets` as media rows; the storage report uploads them to Blob. | Both, in sequence. Seed as `storage='static'` in step 6 (no new infrastructure needed), move to Blob in step 7, delete `public/assets` one release later. |
| 4 | **Translation storage for closure reasons and email templates:** the reservations report sketched JSON columns and an `email_templates` table; the content report rejects per-field JSON. | `closure_i18n` table. Email copy goes into `content_strings` under `email.*` keys, so one review and AI pipeline covers it. |
| 5 | **Type of actor ids:** `uuid` (content report) vs `text` (auth report). | `text`, matching Better Auth's string ids, with no foreign key. |
| 6 | **Booking time column:** the reservations report converts `reserved_at` from text to `time`. | **Keep `text`** with `CHECK (reserved_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')`. Zero-padded HH:MM sorts correctly as text, and the database driver would otherwise return `'19:00:00'` in every query (a risk that report flags itself). |
| 7 | **Alt-text table:** `media_alt` vs `media_i18n`. | `media_i18n`, with the shared review-status columns. |
| 8 | **AI output:** "suggestions only" (Next.js report) vs "machine rows waiting for review" (content report). | Both. Interactive calls fill the form; batch jobs write `machine` rows that guests don't see unless that language's switch is on. |
| 9 | **Where AI calls run.** | Test connection (short, Admin only) is a Server Action. Translate, assist, SEO and alt text use route handlers, because a tab runs Server Actions one at a time. |
| 10 | **Location of the intro bug:** the brief says `motion.tsx:257`; the Next.js report says `Chrome.tsx:26`. | Both are right. I read both files: the effect's dependencies at `lib/motion.tsx:257` never change because the persistent `Chrome` calls `useIntro(true, 0)`. |
| 11 | **Sanity:** the Payload report dismissed it without evaluating it. | I evaluated it. Sanity peer dependencies fit Next 16 and React 19.3 (`sanity@6.17.0`, `next-sanity@13.3.4`, via `npm view`). Plan limits are from sanity.io/pricing and runtime languages from the internationalized-array README. |
| 12 | **Server Action upload limit:** whether the setting sits under `experimental`. | Confirmed: it is `experimental.serverActions.bodySizeLimit` in this Next version (`serverActions.md:69-71`). Images are uploaded straight to Blob anyway. |

## Not verified

- Better Auth and AI SDK 7 types under TypeScript 7.
- Whether transaction-scoped advisory locks work through Neon's pooled connection URL.
- Whether the Resend Marketplace accepts a domain not hosted on Vercel.
- Whether Neon Object Storage is formally GA. It wasn't chosen.
- Whether `app/icon.svg`, `sitemap.ts` and `robots.ts` still apply with two root layouts.
- The effort estimates are mine, ±25%.

I verified these myself:
- Payload issues #18065, #17906, #16939 and #18246 are open (`gh`).
- Sanity, Vercel and Neon pricing (fetched 2026-10-01).
- Sanity package peer dependencies (`npm view`).
- The `unstable_cache`, `next/root-params`, `updateTag` and `serverActions` doc lines cited above, in `node_modules/next/dist/docs`.
- The schema (`001_init.sql`) and the bug locations: `lib/booking.ts:22-58`, `SiteProvider.tsx:33,108,447`, `Chrome.tsx:26`.

No project files were changed.