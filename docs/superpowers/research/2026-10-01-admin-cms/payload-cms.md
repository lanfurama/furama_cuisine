# Is Payload CMS v3 (embedded in the Next.js 16.3.7 app, @payloadcms/db-postgres on Neon) a viable foundation for the Furama Cuisine admin CMS?

# Payload CMS for the Furama admin: research findings (2026-10-01)

**Verdict: conditional GO** for Payload **3.90.x** (not v4). On this exact stack (Next 16.3.7, React 19.3.0, TypeScript 7.0.2, Postgres) it installs with no peer warnings, typechecks, builds with Turbopack and runs. I checked this in a throwaway app, not only by reading docs. Two parts need care:
- **Locales an admin adds at runtime** are not supported natively.
- **Sharing the Neon database with the existing hand-rolled tables** needs strict settings.

Everything else either fits natively or is custom code that Payload makes easy to host.

---

## 1. Versions and peer dependencies (`npm view`, 2026-10-01)

| package | latest | peer `next` | peer `react` |
|---|---|---|---|
| payload | 3.90.2 (2026-09-23) | – | – (peer: graphql ^16.8.1) |
| @payloadcms/next | 3.90.2 | `>=15.2.9 <15.3.0 \|\| >=15.3.9 <15.4.0 \|\| >=15.4.11 <15.5.0 \|\| >=16.3.3 <17.0.0` | – |
| @payloadcms/ui | 3.90.2 | same as above | `^19.0.1 \|\| ^19.1.2 \|\| ^19.2.1` |
| @payloadcms/richtext-lexical | 3.90.2 | – | `^19.0.1 \|\| ^19.1.2 \|\| ^19.2.1` |
| @payloadcms/db-postgres | 3.90.2 | – | – (deps: drizzle-orm 0.45.2, drizzle-kit 0.31.7, pg 8.20.0) |
| @payloadcms/storage-vercel-blob | 3.90.2 | – | – (deps: @vercel/blob 2.3.1) |
| canary | 4.0.0-canary.37 (2026-09-24) | `>=16.2.6 <17.0.0` | same React range |

**Next 16.3.7: supported.**
- Next 16 entered the peer range by 3.73.0 (2026-01-23).
- The minimum was then raised several times for security: 16.2.0-canary.10 (3.76), 16.2.2 (3.82), 16.2.6 (3.85), and **16.3.3 (3.90.0)**.
- So Next 16.3.0–16.3.2 are excluded and 16.3.7 is included. I confirmed this with `semver.satisfies`.

**React 19.3.0: supported by the declared range.**
- `^19.2.1` means `>=19.2.1 <20`, so 19.3.0 satisfies it. The `||` list exists to exclude older vulnerable patch versions, not to cap at 19.2.
- `npm install` of next@16.3.7, react@19.3.0 and all @payloadcms/*@3.90.2 gave no ERESOLVE, and `npm ls` showed no invalid peers.
- Caveat: Payload's own templates pin `next 16.3.3` with `react 19.2.6` (templates/website, with-vercel-website and with-vercel-postgres package.json on main). React 19.3 is therefore not in the vendor's tested combination.
- Mitigating factor: the App Router runs on Next's vendored React anyway, which is `19.3.0-canary-cbb046ab-20260731` (node_modules/next/dist/compiled/react).
- No Payload issue or PR mentions React 19.3, checked with `gh search`.

**TypeScript 7.0.2 (native Go tsc, no JS compiler API):**
- No Payload package imports `typescript` at runtime (grep of the dist folders).
- Payload's CLI uses its own bundled `tsx`.
- `tsc --noEmit` passed on the config, the custom view and the generated `payload-types.ts`.

**v4 status:**
- Still canary (4.0.0-canary.37). The migration guide on main is `docs/migration-guide/v4.mdx`, 2,177 lines.
- It requires Node ≥24.15.0, Next ≥16.2.6 and TS ≥6.0.3.
- Defaults change: versions on by default, `createdBy`/`updatedBy` authorship on by default, `overrideAccess` defaults to false, depth 1.
- Storage adapters move under `storage`.
- The admin UI is redesigned and Sass is removed.
- No stable release date. Building on 3.x now means a codemod-assisted migration later.

**Ownership:** Figma acquired Payload in June 2025. The licence remains MIT. Releases are weekly in 2026.

## 2. Hands-on test (scratchpad only; the project was not touched, `git status` clean)

Location: `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/pltest`

The test app copied the Furama stack (Next 16.3.7, React 19.3.0, TS 7.0.2) plus payload, next, ui, richtext-lexical, db-postgres, storage-vercel-blob and plugin-seo, all at 3.90.2. Its config had:
- 6 locales;
- Users with an admin/editor `role` field (`saveToJWT`) and field-level access;
- Restaurants with a custom text `id`, drafts, an `openingHours` array and an `afterChange` hook that calls `revalidateTag`;
- Media on Vercel Blob with `clientUploads`;
- an `ai-settings` global;
- a custom `/admin/reservations` root view;
- an `afterInput` "AI suggest" client button on fields;
- `filterAvailableLocales` reading the global.

Results:
1. **CLI:** `payload generate:importmap` and `generate:types` both succeeded, with extensionless imports and `"type": "module"`. Issue #16684 did not reproduce on 3.90.2.
2. **Typecheck:** `tsc` (TypeScript 7) passed in about 1s. I injected a deliberate error to confirm it was really checking.
3. **Build:** clean `next build` with Turbopack took **11.4s**, with **~2.1 GB peak memory**.
   - `.next/server` was 69 MB.
   - node_modules was **810 MB**, against 372 MB in the project today.
4. **Traced function sizes** (what a deploy includes):
   - guest page using the Local API: 34.2 MB
   - `/admin`: 38.3 MB
   - `/api/[...slug]`: 37.4 MB
   - About 28 MB of each is the `sharp`/libvips image library. All are far under Vercel's 250 MB limit.
5. **Browser JavaScript:** guest routes ship **the same 14 KiB** of client-component JS as a page without Payload. The admin's ~2.4 MB of JS stays on `/admin`.
6. **Runtime** (`next start` with Postgres 18, project schema loaded):
   - `/admin`, the restaurants list and edit pages, `/admin/reservations` (custom view), `/admin/globals/ai-settings` and `/admin/account` all returned 200 after first-register and login.
   - REST `/api/restaurants` returned **200** (issue #16727 did not reproduce).
   - The guest `/r/[slug]` page reading through the Local API returned 200.
7. **Guest-route headers:** the guest `/` route carried `Accept-CH` and `Critical-CH: Sec-CH-Prefers-Color-Scheme` plus `X-Powered-By: Next.js, Payload`. This confirms issue #17906 (section 6).

## 3. Fit against each requirement

| # | Requirement | Fit | How / caveats |
|---|---|---|---|
| 1 | Edit all guest content inside the fixed design | **Strong** | Model each page as fixed-shape globals and collections (Home global with arrays for hero slides, experiences, heritage, stories and offers; `visible` checkbox per section and per item; drag-to-reorder arrays; Media uploads; links, prices, phones; Navigation/Footer/Contact/SEO globals). No page builder is needed. Live Preview and draftMode are available for previews. |
| 2 | Admin adds locales; every text field translatable; real locale routing | **Partial** | Translating fields is native (`localized: true`): per-locale writes, `en` fallback, `locale:'all'` and `fallbackLocale:false` all verified. **Locales are defined in code**, and Postgres stores them as an enum `_locales` built from the config (`@payloadcms/drizzle/dist/postgres/init.js:24`). Adding `th` generated `ALTER TYPE "public"."_locales" ADD VALUE 'th'` (plus one more enum), so it needs a **migration and a redeploy**. Removing a locale drops and recreates the enum. **Workaround:** declare a superset in code (e.g. en, vi, ko, zh, ja, ru, th, fr), let admins enable or disable them in a global, filter the admin's language picker with `filterAvailableLocales` (`payload/dist/config/types.d.ts:404`, verified), and have the guest `proxy.ts` and `[lang]` routes read the same list. A truly new language becomes a developer ticket. The admin UI itself ships in 44 languages, including vi, ko and zh. Guest locale routing is plain Next work (`app/[lang]` plus `proxy.ts` per `01-app/02-guides/internationalization.md`); its matcher must exclude `/admin`, `/api` and `/_next`. |
| 3 | Admin/Editor roles, invite by email, audit log | **Roles strong; invite and audit custom** | Role-based access per collection, field and operation is native. **No built-in invite flow** (auth docs): build an admin-only create plus a hook that triggers a set-password email (forgotPassword) via `@payloadcms/email-resend` 3.90.2, with custom email HTML. **No audit log in v3**: versions record snapshots and dates but **no author** (verified; `authorship` exists only in v4). Build an `audit-log` collection fed by afterChange/afterDelete hooks (user, collection, document, locale, operation, version id), or evaluate the community `payload-auditor` 2.0.2 (peer `payload ^3.76.1`, not vetted). Payload brings its own users and sessions, so the provisioned Neon Auth would go unused. |
| 4 | Vertex AI: translate, writing help, SEO and alt text; admin settings page | **Fits as custom code** | No official AI plugin (`@payloadcms/plugin-ai` returns 404 on npm). Build an `ai-settings` global restricted to admins (provider Gemini or Claude-on-Vertex, model, region, system prompts, do-not-translate glossary, per-feature switches); the test showed it rendering. Field buttons go in `afterInput` client components (verified) that call a custom endpoint or server function using the Vertex SDK, with GCP credentials from env vars only. A "Test connection" button works the same way. `@payloadcms/plugin-seo` provides meta title, description and image with `generateTitle/Description` hooks for AI. Alt text on upload: a `beforeChange`/`afterChange` hook on Media, or a job. Batch translation can use the Payload jobs queue triggered by Vercel Cron. **Pitfall: #18246** — a nested Local API call that passes the parent `req` with a different `locale` corrupts the parent's locale. Do translation writes as separate operations, not inside the save hook with the parent `req`. |
| 5 | Reservations inbox: confirm/cancel/no-show, search, closures | **Good (custom view)** | A custom root view at `/admin/reservations` rendered fine as a server component with `DefaultTemplate` and the auth result. Recommendation: keep `reservations` and the availability engine in the existing SQL (partial unique dedupe index, capacity checks, the planned timezone fix) and query it from the custom view and server actions. Moving reservations into a Payload collection is possible, but the partial indexes would need hand-written SQL in a Payload migration and the booking hot path would gain hook overhead. Closures and blackouts can be a small Payload collection that the booking engine reads. |
| 6 | Detail page for every restaurant (Tàya House template, toggle) | **Strong** | `hasDetailPage` checkbox plus an `app/[lang]/restaurants/[slug]` page reading the Local API; tested at `/r/[slug]`. A custom text `id` keeps slugs like `taya-house` and `pho-cuon` (verified). |
| 7 | Per-restaurant hours, slots and capacity | **Strong (data model)** | `openingHours` array per restaurant (weekdays, open, close, slot minutes, capacity) was verified in the schema. The booking engine reads it; the Asia/Ho_Chi_Minh timezone bug in `lib/booking.ts` and `app/actions.ts` is independent of Payload. |
| 8 | Email: staff on new booking, guest on confirmation | **Fits** | `@payloadcms/email-resend` 3.90.2 (no dependencies) for auth emails; booking emails sent from the booking server action or a confirm action with Resend. |

## 4. Sharing the Neon database with the existing tables (tested on Postgres 18, project schema loaded)

- **Dev "push" mode is on by default outside production** (`@payloadcms/db-postgres/dist/connect.js:109-111`: `NODE_ENV !== 'production' && push !== false`).
- **Test A** (push, no `tablesFilter`): drizzle-kit read the database and **asked interactively whether `users_sessions` was created or renamed from `restaurants`, `reservations` or `_migrations`**, then hung. In `next dev` that blocks startup, and a wrong answer destroys data.
- **Test B** (push with `tablesFilter: ['!restaurants','!reservations','!_migrations']`): it still emitted **`DROP SEQUENCE "public"."reservations_id_seq"`**, because the filter covers tables, not sequences. Postgres refused only because the `bigserial` default depends on that sequence. Push had **already created Payload's 21 tables without a transaction**, and Payload startup failed.
- **Test C** (`push: false`, then `payload migrate`): clean. Both migrations applied, the 12 restaurants and the sequence were intact, and Payload tracked its state in its own `payload_migrations` table.
- **Test D** (`schemaName: 'cms'` with push): isolated. 21 tables went into `cms`, and `public` was untouched. The option is marked `@experimental` ("only works when there are not other tables or enums of the same name… under a different schema", `@payloadcms/db-postgres/dist/types.d.ts:63-68`), so a collection named `restaurants` would still collide with `public.restaurants`.
- **`migrate:create` works offline.** It diffs drizzle snapshots rather than the live database (`@payloadcms/drizzle/dist/utilities/buildCreateMigration.js:13-67`) and never generated DROPs for the existing tables.
- **Name collision:** a Payload `restaurants` collection maps to table `restaurants`. Use `dbName` (tested `cms_restaurants`) or `schemaName`, or migrate the 12 rows into Payload and point the booking engine at it.
- **Two migration ledgers** (`_migrations` and `payload_migrations`): run both in one deploy step, or port the hand-rolled SQL into Payload migrations (`db.execute(sql\`…\`)`).
- **Database connections:** Payload creates its own `pg.Pool` (nested pg 8.20.0) and **attaches no `'error'` listener** (`connect.js:45`; grep found none). That fits open issue **#16939** on Vercel with Neon ("Uncaught Exception: terminating connection due to administrator command"). Fix: in `onInit`, add `payload.db.pool.on('error', …)` and call `attachDatabasePool(payload.db.pool)` from `@vercel/functions`, as `db/client.ts` already does. Two pools (the app's and Payload's) both draw on Neon's connection limit, so use the pooled URL.
- **App structure:**
  - Payload requires its own root layout in `app/(payload)/layout.tsx`. The current `app/layout.tsx`, with fonts, SiteProvider and `revalidate = 3600`, must move into something like `app/(site)/[lang]/layout.tsx`. Two root layouts mean a full page reload when switching between the site and the admin, which is fine.
  - Payload's `/api/[...slug]` catch-all should coexist with `app/api/availability/route.ts`, since specific routes win over catch-alls. I did not test that collision; `routes.api` can be moved if needed.
  - `"type": "module"` is required (installation docs).

## 5. How the guest site reads content, and revalidation

- **Reading:** call `getPayload({ config })` in server components. This is the Local API: no HTTP hop and no extra client JS (verified). Cache it with `unstable_cache(..., { tags })`, the pattern in Payload's own website template (`templates/website/src/utilities/getGlobals.ts`). Next 16 docs say `unstable_cache` is superseded by `'use cache'` + `cacheTag`, but that requires `cacheComponents`. **Open issue #18065** reports admin errors with Next 16.3 and Cache Components, so **do not enable `cacheComponents` yet**.
- **Admin saves go through the REST route handler:** the edit form posts to `/api/<slug>/<id>` (`@payloadcms/ui/dist/providers/DocumentInfo/index.js:304-316`). **`updateTag` therefore cannot be used in Payload hooks**, because it is Server-Actions-only (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/updateTag.md`).
  - Use `revalidateTag(tag, 'max')` (stale-while-revalidate), or `revalidateTag(tag, { expire: 0 })` when editors must see changes immediately (`revalidateTag.md`), plus `revalidatePath`.
  - This matches the template's `revalidatePage` hook.
  - `revalidateTag` only invalidates the instance it runs on (`how-revalidation-works.md`); this is relevant only if the app runs on several Next instances.
- **Calling `revalidateTag` outside a Next request throws** `Invariant: static generation store missing` (verified). The whole save then rolls back (verified: the document was not created). Seed scripts, migrations and cron jobs need `context: { disableRevalidate: true }` checked in every hook, or a try/catch.

## 6. Other side effects and open issues (2026)

- **#17906 (open):** `withPayload` adds `Accept-CH`, `Vary` and **`Critical-CH`** on `source: '/:path*'` (`@payloadcms/next/dist/withPayload/withPayload.js:86-100`), which covers **every guest page** (verified). On a visitor's first visit, Chromium discards and retries the request, an extra round trip that hurts LCP. Workaround: post-process `headers()` to scope it to `/admin`, or pin `admin.theme`.
- `withPayload` also sets `experimental.turbopackServerFastRefresh: false` (line 52), `serverExternalPackages` and `outputFileTracingExcludes` for drizzle-kit, and an `X-Powered-By` header.
- **Open localization bugs:**
  - #18246: a nested Local API call with a different locale corrupts the parent save's locale.
  - #18180: REST `where` on a localized field returns 500 with `fallback:false`.
  - #17858: `generate:types` crash; avoid the object form of `locales` with `value` keys.
  - #17914: localized `_status` stale check.
  - #17736: `generate:db-schema` enum name.
- **Admin/UI bugs:**
  - #18162: account view crash on an empty auth collection (not reproduced with a `role` field).
  - #18220 and #18348: form/autosave edits being lost.
  - #18420: error data dropped in production.
- #16727 (REST 404 on Next 16) and #16684 (CLI extensionless imports) **did not reproduce** on 3.90.2.
- **3.90.0 contained critical security fixes** with breaking changes and a migration (password-reset fields). 3.89.0 backported the v4 jobs-access changes. Expect frequent security bumps and keep all `@payloadcms/*` packages on exactly the same version.
- `@payloadcms/db-vercel-postgres` depends on the deprecated `@vercel/postgres`; use `@payloadcms/db-postgres` with the Neon URL.
- Vercel Blob adapter: only `access: 'public'`; use `clientUploads` to get past the 4.5 MB function body limit. 3.90.0 hardened SVG/XML uploads and capped multipart uploads at 50 MB.

## 7. Alternatives (not researched in depth)

- **Hand-rolled admin:** full control, including runtime locales, but you rebuild auth, sessions, media, versions/drafts, the editing UI and access control. That is most of Payload.
- **Sanity:** the only Marketplace CMS. Content lives in Sanity's hosted store, outside Neon, and its AI Assist is Sanity's own rather than Vertex. It breaks the requirement that the admin lives in this app and database, so I did not evaluate it further.

## Recommendation
GO on Payload 3.90.x, with these conditions:

1. **Pin versions exactly.** Every payload and @payloadcms/* package on the same exact version, Next ≥16.3.3 (currently 16.3.7), and React 19.3.0. Fall back to React 19.2.x (the vendor's tested line) only if an admin bug looks React-related.
2. **Never run dev push against Neon.**
   - Set `push: false` and use `payload migrate:create` / `payload migrate` only.
   - Give each developer their own Neon branch.
   - Run both migration ledgers (`scripts/migrate.mjs`, then `payload migrate`) in one pre-build step.
   - Keep Payload's tables apart from the existing ones with `dbName` prefixes, or the experimental `schemaName: 'cms'` (tested isolated).
3. **Agree the locale model with the user.**
   - Declare a superset of locale codes in code and let admins enable or disable them in a global.
   - Use `filterAvailableLocales` for the admin picker, and have the guest proxy and `[lang]` routes read the same list.
   - A brand-new language means a developer deploy with a one-line migration.
   - If true runtime locale creation is non-negotiable, Payload's native localization cannot do it. That would be a no-go for this part, or a fallback to JSON translation fields, which loses Payload's locale UI.
4. **Keep the booking engine in hand-rolled SQL.** That covers reservations, availability, capacity and the Asia/Ho_Chi_Minh fix. Build the reservations inbox as a custom Payload admin view, and model restaurants, hours, slots, closures and all marketing content in Payload.
5. **Revalidate from hooks the supported way.** Call `revalidateTag(tag, 'max')` or `revalidateTag(tag, { expire: 0 })` plus `revalidatePath` in afterChange/afterDelete hooks, guarded by `context.disableRevalidate`. Read on the guest side with the Local API inside `unstable_cache` with tags. Do not enable `cacheComponents` until #18065 is fixed.
6. **Apply the two known fixes.** Scope the client-hint headers to `/admin` (#17906). In `onInit`, add a pool `'error'` listener and call `attachDatabasePool(payload.db.pool)` (#16939).
7. **Build the missing pieces as custom code:**
   - invite-by-email (admin-only create plus a set-password email through @payloadcms/email-resend);
   - an audit-log collection fed by hooks;
   - all Vertex AI features: an admin-only `ai-settings` global, `afterInput` buttons, a server endpoint using the Vertex SDK with env-only GCP credentials, the jobs queue for batch translation, and no nested locale writes through the parent req (#18246).
8. **Budget for the Payload v4 migration** (codemod-assisted; Node 24.15+) once v4 goes stable.

Expect the restructure to move the current root layout under `app/(site)/[lang]`, add `"type": "module"`, and wrap next.config with `withPayload`.

## Risks
- Runtime locale creation is impossible with native Payload localization: locale codes are a Postgres enum built from code, so every new language needs a migration and a redeploy, and removing one rewrites the enum.
- Data-loss risk if dev push mode is ever used against the shared Neon DB. It offered to rename restaurants/reservations, tried to DROP the reservations_id_seq sequence even with tablesFilter, and pushed without a transaction.
- React 19.3.0 is inside the declared peer range but not in Payload's tested template combination (React 19.2.6, Next 16.3.3), so a React-19.3-specific admin regression would be on us to diagnose.
- Frequent security releases with breaking notes (3.90.0 critical fixes plus a DB migration; 3.89.0 jobs-access change), so ongoing upgrade work is required.
- Payload v4 is a large breaking release (2,177-line migration guide; Node >=24.15, default changes to access, versions and authorship); building on v3 now means a later migration.
- Open localization bugs relevant to auto-translate: #18246 (nested Local API locale corruption), #18180, #17914, #17858. Open form-state/autosave bugs (#18220, #18348) could lose editor input.
- withPayload's global Critical-CH header makes Chromium send the first request twice on guest pages, hurting LCP, until it is scoped to /admin (#17906).
- Payload's pg Pool has no error listener, so Neon scale-to-zero or compute restarts can crash a function instance (#16939) unless an error handler is added in onInit.
- revalidateTag in hooks throws outside a Next request and rolls back the write, which breaks seeds, cron and AI batch jobs unless guarded.
- updateTag cannot be used because admin saves run in a Route Handler, so editors only get read-your-writes through revalidateTag(tag,{expire:0}).
- Cache Components (use cache/cacheTag) currently break the Payload admin on Next 16.3 (#18065), so the guest site stays on unstable_cache, which Next 16 docs mark as superseded.
- Restructuring is required: there must be separate root layouts for the site and the admin, "type": "module", and the withPayload wrapper. Disk/install footprint grows by ~440 MB of node_modules and build memory reaches ~2 GB.
- Invite flow, audit log and all AI features are custom code (no official plugins), so the timeline must include them.
- Two Postgres pools (the app's and Payload's) both draw on Neon's connection limit, and there are two migration ledgers to keep in sync.

## Open questions
- Is it acceptable that admins can enable/disable a predefined set of languages (e.g. en, vi, ko, zh, ja, ru, th, fr), while adding a brand-new language code needs a small developer deploy? Or must admins be able to create arbitrary new locales with no deploy?
- Should reservations and the availability/capacity engine stay in the existing SQL tables, managed through a custom Payload admin screen (recommended), or be moved fully into Payload?
- Should Payload's tables live in a separate Postgres schema ('cms', experimental but tested isolated), or in the public schema with prefixed table names?
- Are you OK with Payload's own user accounts and auth for staff, leaving the provisioned Neon Auth unused?
- Is /admin acceptable as the admin URL, and should the admin UI default to Vietnamese for staff?
- Do you accept planning a Payload v4 upgrade later (it needs Node 24.15+ and a codemod-assisted migration), or would you rather wait for v4 stable before starting?

## Key facts
- [verified] Latest stable Payload is 3.90.2 (2026-09-23); @payloadcms/next and @payloadcms/ui peer next is '>=15.2.9 <15.3.0 || >=15.3.9 <15.4.0 || >=15.4.11 <15.5.0 || >=16.3.3 <17.0.0', so Next 16.3.7 is supported and 16.3.0-16.3.2 are excluded. (npm view @payloadcms/next@3.90.2 peerDependencies; semver.satisfies check)
- [verified] The React peer range '^19.0.1 || ^19.1.2 || ^19.2.1' is satisfied by React 19.3.0 (a caret range, not a cap). npm install of next@16.3.7 + react@19.3.0 + @payloadcms/*@3.90.2 gave no ERESOLVE and npm ls showed no invalid peers. (npm view @payloadcms/ui@3.90.2 peerDependencies; scratch install in scratchpad/pltest)
- [verified] Payload's own templates pin next 16.3.3 with react 19.2.6, so React 19.3 is outside the vendor's tested combination. Next 16.3.7 vendors React 19.3.0-canary-cbb046ab-20260731 for the App Router. (gh api payloadcms/payload templates/website, with-vercel-website and with-vercel-postgres package.json; node_modules/next/dist/compiled/react/cjs/react.production.js)
- [verified] On Next 16.3.7 + React 19.3.0 + TS 7.0.2, a Payload 3.90.2 app passed generate:importmap, generate:types, tsc --noEmit and a clean Turbopack next build (11.4s, ~2.1 GB peak memory). Admin views (including a custom root view and a global), REST and a Local-API guest page all returned 200 at runtime. (Scratch test in /private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/pltest)
- [verified] Payload localization locales are defined in code. On Postgres they are a pg enum '_locales' built from config at init, so adding a locale generates 'ALTER TYPE "public"."_locales" ADD VALUE ...' (a migration plus a deploy). There is no runtime locale addition; filterAvailableLocales({locales, req}) can only filter the admin's locale picker. (@payloadcms/drizzle/dist/postgres/init.js:24; payload/dist/config/types.d.ts:404-407; migrate:create output in scratch test)
- [verified] Dev push is on by default outside production. Against a DB containing restaurants/reservations/_migrations it hung on an interactive 'create or rename from restaurants/reservations' prompt. With tablesFilter it still issued DROP SEQUENCE reservations_id_seq, after creating 21 tables without a transaction. push:false + payload migrate was clean, and schemaName:'cms' (experimental) isolated push to its own schema. (@payloadcms/db-postgres/dist/connect.js:109-111; @payloadcms/drizzle/dist/utilities/pushDevSchema.js; Postgres 18 tests A-D in scratchpad)
- [verified] Admin document saves post to the REST route handler (/api/<slug>/<id>), so Payload hooks run in a Route Handler where Next 16's updateTag is not allowed (Server Actions only). Use revalidateTag(tag,'max') or revalidateTag(tag,{expire:0}) instead. (@payloadcms/ui/dist/providers/DocumentInfo/index.js:304-316; node_modules/next/dist/docs/01-app/03-api-reference/04-functions/updateTag.md and revalidateTag.md)
- [verified] Calling revalidateTag inside an afterChange hook outside a Next request (payload run scripts, seeds, jobs) throws 'Invariant: static generation store missing' and the save is rolled back. A context.disableRevalidate guard is needed. (Scratch test scripts/local.ts output; Payload website template revalidatePage.ts uses context.disableRevalidate)
- [verified] withPayload injects Accept-CH/Vary/Critical-CH: Sec-CH-Prefers-Color-Scheme and X-Powered-By on source '/:path*' (all guest routes). This causes a Chromium first-visit retry (open issue #17906; workaround: scope headers to /admin). (@payloadcms/next/dist/withPayload/withPayload.js:86-100; curl -I on scratch guest '/'; github.com/payloadcms/payload/issues/17906)
- [verified] @payloadcms/db-postgres 3.90.2 creates its own pg.Pool with no 'error' listener. This matches open issue #16939 (uncaught 'terminating connection due to administrator command' on Vercel + Neon). (@payloadcms/db-postgres/dist/connect.js:45 (grep found no .on('error')); github.com/payloadcms/payload/issues/16939)
- [verified] Payload v3 versions store no author (authorship/createdBy/updatedBy exist only in v4), and there is no built-in invite flow or audit-log plugin (@payloadcms/plugin-audit-log and @payloadcms/plugin-ai return 404 on npm). Community payload-auditor 2.0.2 exists (peer payload ^3.76.1). (scratch findVersions output; payload/dist/collections/config/types.d.ts; v4 migration guide 'Authorship'; npm view; payloadcms.com/docs/authentication/overview)
- [verified] Guest routes that read Payload through the Local API ship the same 14 KiB client-reference JS as a non-Payload page. Admin client JS is ~2.4 MB raw. Traced functions are ~34-38 MB (about 28 MB is sharp/libvips), well under Vercel's 250 MB. node_modules grows from 372 MB to ~810 MB. (Scratch build .nft.json and client-reference-manifest analysis; du of project node_modules)
- [verified] Payload v4 is still canary (4.0.0-canary.37). Its migration guide requires Node >=24.15.0, Next >=16.2.6, TS >=6.0.3, and makes versions, authorship and overrideAccess:false defaults. No stable date. (gh api payloadcms/payload docs/migration-guide/v4.mdx (main); npm dist-tags)
- [verified] Open issue #18065: Payload admin errors on Next 16.3 with cacheComponents enabled. The Furama project does not enable cacheComponents today. (github.com/payloadcms/payload/issues/18065; project next.config.ts)
- [verified] Open issue #18246: a nested Local API call passing the parent req with a different locale rewrites the parent's req.locale, so localized values land in the wrong locale. This is relevant to auto-translate hooks. (github.com/payloadcms/payload/issues/18246)
- [verified] The Payload admin UI ships translations in 44 languages, including vi, ko, zh, ja and ru. (node_modules/@payloadcms/translations/dist/languages in scratch install)
- [likely] Figma acquired Payload in June 2025; the repo remains MIT-licensed. (Web search (cmswire.com, uithings.com, bfj.digital articles))