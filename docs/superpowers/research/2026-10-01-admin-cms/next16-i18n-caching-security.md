# Next.js 16.3.7 mechanics for the Furama Cuisine admin CMS: i18n routing with locales stored in the DB, caching and revalidation (Cache Components, tags, draft mode), security (DAL, Server Actions, uploads, CSP), admin forms, and a proposed file and route layout. Vertex AI settings are configured in the admin as the user asked.

Paths: **docs/** means `/Users/bcmac/Desktop/projects/Outside Projects/furama_cuisine/node_modules/next/dist/docs/01-app/`. Project files are relative to `/Users/bcmac/Desktop/projects/Outside Projects/furama_cuisine/`. Installed: next 16.3.7 (`node_modules/next/package.json`). Today `next.config.ts` only sets `reactStrictMode`.

## 0. Current code that the design has to change

- `app/layout.tsx:52` is the only root layout. It awaits `listRestaurants()`, sets `export const revalidate = 3600` (`:36`, which errors once Cache Components is on), hard-codes `<html lang="en">` (`:58`), and injects the inline `MOTION_BOOTSTRAP` script (`:49,63`, which affects CSP).
- `components/site/SiteProvider.tsx` works out the current view from the URL: `DETAIL_PATH='/taya-house'` (`:33`) is compared against `usePathname()` (`:107-108`). Language is local state, `useState<'EN'|'VI'>` (`:140`). `components/site/PageCurtain.tsx:68` also calls `usePathname()`.
- `components/booking/BookingBar.tsx:15` and `components/overlays/ReserveDrawer.tsx:46` call `days()`, which runs `new Date()`, during render. The date is baked into static HTML, and in UTC on Vercel. This is part of the time-zone bug.
- `components/site/Chrome.tsx:26` calls `useIntro(true, 0)` inside a layout that persists across navigations. Its effect (`lib/motion.tsx:230-258`) never re-runs after a client-side navigation: this is the hero `[data-intro]` bug. `lib/motion.tsx:235,285,290` and `SiteProvider.tsx:219,232` query the whole `document` (`querySelectorAll`, `getElementById`).
- `app/api/availability/route.ts:5` sets `export const dynamic='force-dynamic'`, which errors under Cache Components.

## 1. i18n routing (docs/02-guides/internationalization.md)

**Structure the docs recommend.** Put every special file under `app/[lang]` (`internationalization.md:74`). The root layout can live in that folder, and pages read the locale from `params` or from `next/root-params`, available since 16.3.0 (`next-root-params.md:426`). Inside a route group the guest root layout becomes **`app/(site)/[lang]/layout.tsx`**. Any Server Component or helper can then call `import { lang } from 'next/root-params'`. That does **not** work in Client Components, **Server Actions** or Route Handlers (`next-root-params.md:49,390`; `internationalization.md:252`), so actions such as the guest booking and the admin saves must receive the locale as an explicit argument. Inside `'use cache'`, only the root params a function actually reads go into its cache key (`next-root-params.md:198-200`). Root params are not available inside `unstable_cache` (`:376`).

**`generateStaticParams` with locales from the DB.** Put it in the `[lang]` layout and return the active locales from the DB (`internationalization.md:256-273`). It runs only at build time and is not called again during ISR (`generate-static-params.md:60`). A locale an admin adds later is therefore rendered on demand:
- Without Cache Components: the default `dynamicParams=true` handles it.
- With Cache Components: the visitor gets the App Shell, which ISR then upgrades (`incremental-static-regeneration-cache-components.md`). Two constraints apply. `generateStaticParams` must return **at least one** param, so always include `en` (`generate-static-params.md:310`; `migrating-to-cache-components.md:568-570`). And `dynamicParams` is not supported (`:606-610`).

Every page or layout must call `notFound()` when `lang` is not an active locale. That check is a cached DAL read tagged `locales`.

**`<html lang>`.** Use `<html lang={await lang()}>` in the `[lang]` root layout (`next-root-params.md:20-30`). Store a BCP-47 `html_lang`/`hreflang` value per locale in the DB, separate from the URL code (for example URL `zh` maps to `zh-Hans`).

**hreflang.** `generateMetadata` returns `alternates: { canonical, languages: { en:'/en/..', vi:'/vi/..', 'x-default':'/en/..' } }`, which renders `<link rel="alternate" hreflang>` tags (`generate-metadata.md:823-857`). Set `metadataBase` from an env var such as SITE_URL. Under Cache Components, a DB read in `generateMetadata` must be `'use cache'`d or the build raises an error (`generate-metadata.md:1272-1291`). `app/sitemap.ts` supports `alternates.languages` per URL (`03-file-conventions/01-metadata/sitemap.md:219-247`).

**proxy.ts.** Middleware is now Proxy and runs on Node by default (`01-getting-started/16-proxy.md:13`; `proxy.md:255`). The docs pattern redirects any path without a locale prefix using Accept-Language, via `@formatjs/intl-localematcher` (0.9.0) and `negotiator` (1.1.0) (`internationalization.md:25-72`). Constraints:
- The `matcher` must be a constant (`proxy.md:136`).
- The fetch cache has no effect in Proxy (`16-proxy.md:31`), and Proxy is "not intended for slow data fetching" (`:30`).

Proposal: run Proxy only on paths **without** a locale prefix, plus `/admin`, so cached guest pages never invoke it:
```ts
export const config = { matcher: [
  '/admin/:path*',
  '/((?!api|admin|_next|[a-z]{2}(?:-[a-z0-9]+)?(?:/|$)|.*\\..*).*)',
]}
```
Verify the regex with `unstable_doesProxyMatch` from `next/experimental/testing/server` (`proxy.md:732-745`). The redirect target is chosen in this order: the `NEXT_LOCALE` cookie if that locale is active, then Accept-Language matched against active locales, then `en`. Two ways to get the active-locale list in Proxy:
- A module-scope memo with a ~60 s TTL, filled from a small pg query and falling back to `['en']` on error.
- Edge Config.

Pages still enforce `notFound()` either way. Old URL `/taya-house`: use `redirects()` in next.config (it runs before Proxy, `proxy.md:236-244`) or a Proxy rule to `/{locale}/restaurants/taya-house`.

**Language switcher.** It links to the same path with the other locale prefix. Keep slugs the same in every language (restaurant ids). Verified in source (`node_modules/next/dist/client/components/router-reducer/is-navigating-to-new-root-layout.js:16-24`, which ignores dynamic param values): `/en` to `/vi` is the **same root layout**, so the router does a soft navigation, not a full reload. Recommendation: switch language with a plain `<a href>` full navigation and set the cookie on the client. That resets client state and `<html lang>` cleanly, and avoids the Activity issue with duplicate IDs (section 2).

**Root layout restructure (multiple root layouts).** Delete `app/layout.tsx`. Each layout that has no layout above it is a root layout (`layout.md:142-146`). Navigating between root layouts is a full page load (`route-groups.md:30`), which is what we want between the guest site and admin.

- `app/(site)/[lang]/layout.tsx` takes over everything `app/layout.tsx` does today: fonts, `globals.css`, `MOTION_BOOTSTRAP`, viewport, `MotionProvider`, `SiteProvider`, `Chrome`. It loads chrome data (restaurants, nav, contact, UI dictionary) through cached DAL getters and passes `lang` and `locales` into `SiteProvider`.
- `app/admin/layout.tsx` has its own `<html>`/`<body>`, `admin.css`, no Chrome or Motion, and `metadata.robots = { index:false }`.
- `/` is handled by the Proxy redirect (`route-groups.md:32`).
- With multiple root layouts and a dynamic root segment there is no single place to build a 404, so add `app/global-not-found.tsx` with `experimental.globalNotFound: true` (`not-found.md:47-72`, specifically cases `:57-58`).
- Under Cache Components, `usePathname()` in a client component of a shared layout **suspends** for dynamic params that are not known yet, and the build fails unless it is wrapped in Suspense (`migrating-to-cache-components.md:674`). So stop deriving `view` from the pathname in `SiteProvider`. Each page renders a small client `<ViewMarker view="home"|"detail" restaurant=…/>` that sets context. `PageCurtain` either gets a Suspense wrapper or uses the same signal.
- Fonts: Be Vietnam Pro and Crimson Pro have no Hangul or Han glyphs (only latin, latin-ext and vietnamese subsets are loaded). Adding KO or ZH needs Noto fonts declared statically with `next/font` (`preload:false`) and applied per locale (likely).

## 2. Caching and revalidation

**APIs.**
- `cacheTag(...tags)`: up to 128 tags per call, 256 chars each (`cacheTag.md` "Good to know"). Tags are stored as plain text, so never put PII in them (`authentication-with-cache-components.md:196`).
- `updateTag(tag)`: **Server Actions only** (`updateTag.md:12`). It expires the tag immediately, so the next request waits for fresh data (`:56`). It also re-renders the current route in the same action response (`server-actions.md:40-46,150`). It works with or without Cache Components (`migrating-to-cache-components.md:456`).
- `revalidateTag(tag,'max')`: stale-while-revalidate, allowed in Route Handlers too. The single-argument form is deprecated (`revalidateTag.md:26`). Use `{expire:0}` for immediate expiry outside actions. Revalidation happens on the next request to each page (`:30`).
- `revalidatePath`: when called from a Server Function it currently also refreshes every previously visited page (`revalidatePath.md:19`). The docs say to prefer tags (`09-revalidating.md:187`), and recommend `cacheTag` with `cacheLife('max')` for CMS data (`:195`).

**Should Cache Components be enabled? Yes, as part of the same restructure.** Reasons:
1. `unstable_cache` "has been replaced by `use cache`" (`unstable_cache.md:7`), and root params only work inside `'use cache'`.
2. The pg queries are not `fetch`, so `'use cache'` with `cacheTag` is the documented way to tag them.
3. Pages for new locales and restaurants get the App Shell plus ISR upgrade.
4. Draft mode bypasses `'use cache'` automatically.
5. Its prerender validation catches exactly this repo's bug class: Client Components are prerendered too, and `new Date()` during render raises `blocking-prerender-current-time-client` (`client-side-data-fetching/tanstack-query.md:369`).

Costs, all concrete for this repo:
- Remove `revalidate` and `dynamic` exports (`migrating-to-cache-components.md:76`).
- Wrap `usePathname` consumers in Suspense or replace them (section 1).
- Move the `days()`/`new Date()` calls out of render: compute after mount, or in Suspense with `connection()`.
- Admin pages read the session, so either put Suspense boundaries around those reads or set `export const instant = false` on the admin layout (`instant.md`; `migrating-to-cache-components.md:83-86`). `instant=false` does not excuse sync-IO errors.
- **Activity**: up to 3 previous routes stay mounted with `display:none` (`preserving-ui-state.md:19`). Effects clean up and re-run when a route is shown again (`cacheComponents.md:52`). Scope `lib/motion.tsx` and `scrollToId` DOM queries to the visible page container, or use refs.
- Node runtime is required (`cacheComponents.md:28`).

Fallback if the team wants less churn: keep the previous model. Use `unstable_cache(fn,[key],{tags})` with `updateTag` and pass `lang` explicitly. The same tag names still apply.

**Strategy: guest pages stay static, admin saves show up immediately.**
- Every guest read goes through a `server-only` DAL getter with `'use cache'`, `cacheLife('max')` and `cacheTag(...)`. `await lang()` inside the getter puts the locale in the cache key. The getter also reads `(await draftMode()).isEnabled`, which is allowed inside `'use cache'` (`use-cache.md:276-287`), to choose draft or published columns.
- Tag scheme, kept in a shared `lib/cache-tags.ts`:
  - `content:hero`, `content:cuisines`, `content:destinations`, `content:experiences`, `content:heritage`, `content:stories`, `content:offers`, `content:nav`, `content:contact`, `content:seo`, `content:sections`
  - `restaurants`, `restaurant:<id>`, `booking-rules:<id>` (hours, slots, capacity, closures)
  - `locales`, `i18n:<code>`
- Each admin Server Action follows the same order: authorize, validate, write, audit, then `updateTag(<type>)` plus the specific tag, and return state.
- Reservations, availability and admin lists are **never** cached. After a status change, admin actions call `refresh()` (`server-actions.md:148`).
- On Vercel, prerendered and ISR pages sit in durable storage, and on-demand revalidation "update[s] within 300ms" globally, purging HTML and RSC payload together. That storage is scoped per deployment ([Vercel ISR docs](https://vercel.com/docs/incremental-static-regeneration), updated 2026-08-28).
- Runtime `'use cache'` entries are in memory and do not persist across serverless invocations (`use-cache.md:251`). A page re-render after `updateTag` therefore queries Neon, which is fine here (iad1 and us-east-1). Bots skip the static shell and render fully per request (`08-caching.md:607`). If crawler load matters, add `'use cache: remote'` on hot getters (Vercel Runtime Cache, regional).
- Client router cache: `max` has a 5-minute `stale` (`09-revalidating.md:46`), with a 30-second minimum (`use-cache.md:321`). A guest with the page already loaded may see the old version for up to 5 minutes. New visitors get the new content right away.

**Draft and preview of unpublished content.** Store `draft` and `published` JSON or revisions per item. A "Preview" Server Action (session plus role checked) calls `(await draftMode()).enable()` and then `redirect()` to the guest path. Enabling and disabling must happen in a Route Handler or Server Action, never inside a cache scope (`draft-mode.md:308`). In draft mode, `'use cache'` re-executes and is not stored, and the page is served `Cache-Control: private, no-store` (`draft-mode.md:15-23`). Render a `PreviewBanner` with an exit form (`draft-mode.md:147-191`). The `__prerender_bypass` cookie value rotates on every build (`draft-mode` API, "Good to know"). "Publish" copies draft to published, then calls `updateTag`.

## 3. Security (authentication.md, data-security.md, server-actions.md)

- **DAL.** `lib/server/**` starts with `import 'server-only'`. Next handles the import itself, so no install is needed (`data-security.md:190`). It also works in `'use server'` files (`:437`). Put `verifySession()` and `requireRole('admin'|'editor')` in the DAL, memoized with `React.cache` (`authentication.md:1131+`), and return DTOs. **Only the DAL reads `process.env`** (`data-security.md:132`); that includes the GCP and Vertex credentials and the Resend key.
- **Every Server Action re-verifies.** A page-level check does not extend to the actions on that page (`data-security.md:339`). Treat each action as an untrusted POST (`server-actions.md:78`). Check ownership and IDOR: send the ID, re-read the row (`server-actions.md` "completeItem" example). Layout checks are not a boundary (`authentication.md:1352,1458`). Proxy is for optimistic cookie checks only, with no DB (`authentication.md:1026-1033`). A Proxy matcher that skips a path also skips the Server Actions on it (`proxy.md:249`).
- **Built-in CSRF protection applies to Server Actions only.** The `Origin` host is compared to `Host`/`X-Forwarded-Host`, and mismatches are rejected (`server-actions.md:82`). A request **with no Origin header is allowed with a warning** (`serverActions.md:13`). Action IDs are encrypted, unused actions are removed, and closure variables are encrypted (`server-actions.md:84-85`). Route Handlers (`app/admin/api/*`) do not get this check (the docs mention CSRF only for actions; no-check not verified). They need a manual `Origin` check plus `SameSite=lax|strict` httpOnly session cookies.
- **Uploads.** The Server Action body limit is **1 MB by default**. Raise it with `experimental.serverActions.bodySizeLimit` (`serverActions.md:61`), which sits under `experimental` according to `dist/server/config-shared.d.ts:928-940`. Multipart overhead counts against it. Vercel caps function bodies at **4.5 MB** (413 `FUNCTION_PAYLOAD_TOO_LARGE`, [Vercel limits page](https://vercel.com/docs/functions/limitations), 2026-08-24). Proxy buffers up to 10 MB (`proxyClientMaxBodySize.md:9`). Images should go client-direct to storage (for example Blob client upload with a token from a session-checked Route Handler). A small Server Action then registers the URL, and `after()` runs Vertex alt-text generation once the response is sent (`after.md:6,186`; on Vercel this uses `waitUntil`).
- **Sequential dispatch.** Each client runs one Server Action at a time (`server-actions.md:28-30`). A 20–60 s Vertex translate call made as an action would block Save in that tab. Run long or streaming AI calls in POST Route Handlers (`app/admin/api/ai/*`) with session, role and Origin checks. Set `maxDuration` at page level for actions (`maxDuration.md:18`) or in the route handler.
- **Emails and audit.** In `submitReservation` and the admin status actions, send Resend emails inside `after()` so the guest does not wait.
- **CSP.**
  - **Admin**: dynamic, so use a nonce CSP set in `proxy.ts` for `/admin` only (`content-security-policy.md` "Adding a nonce with Proxy"). In development it needs `'unsafe-eval'`.
  - **Guest**: nonces are incompatible with PPR and static pages (`content-security-policy.md:385-397`). Use the header CSP in `next.config` `headers()` (`:417-447`; the docs sample uses `'unsafe-inline'` for scripts), or experimental SRI (`:456+`; unverified whether it removes the need for `'unsafe-inline'` for inline Flight scripts). `MOTION_BOOTSTRAP` will need either `'unsafe-inline'` or its `sha256` hash. `img-src` must include the storage domain.
- Optional: `experimental.authInterrupts` enables `forbidden()` plus `forbidden.tsx`, so an Editor who opens an Admin-only page gets a proper page (`server-actions.md:111`).

## 4. Admin forms (forms.md)

- Use a Client form, `useActionState(action, initialState)`. The action signature becomes `(prevState, formData)` (`forms.md:190-215`). Return `{ ok, message?, fieldErrors?: Record<string,string[]>, values? }` from zod 4 (4.6.5) `safeParse`. Disable the button while pending (`:278`) or use `useFormStatus` in a SubmitButton. Make `<p aria-live="polite">` the error region.
- Pass the IDs with `action.bind(null, id)` (`forms.md:72-91`). Still re-authorize by ID inside the action.
- Name translatable fields `title[en]` and `title[vi]`; the editor shows tabs per active locale. Add a hidden `version` or `updated_at` for optimistic concurrency, with a conflict message. Write the audit diff at the same time.
- Extra buttons use `formAction`: "Save draft", "Publish", "AI suggest". For AI calls, prefer `fetch` to the AI Route Handler so Save is not blocked.
- React 19 resets uncontrolled fields after a successful action. This is React behaviour and is not in the bundled docs. On error, return `values` and re-seed `defaultValue`, or keep the fields controlled.

## 5. Proposed file and route layout

```
proxy.ts                 # bare-path → /{locale}; /admin optimistic cookie check + nonce CSP
next.config.ts           # cacheComponents:true; experimental:{serverActions:{bodySizeLimit:'2mb'}, globalNotFound:true, authInterrupts?}; redirects(/taya-house); headers() guest CSP
app/
  global-not-found.tsx
  sitemap.ts  robots.ts  icon.svg
  (site)/[lang]/
    layout.tsx           # ROOT #1: generateStaticParams(active locales ≥1), generateMetadata('use cache'), <html lang>, fonts, SiteProvider/Chrome, <Suspense><PreviewBanner/></Suspense>
    page.tsx             # home: section visibility + ordered items from DAL; <ViewMarker view="home"/> <IntroTrigger/>
    not-found.tsx
    restaurants/[slug]/page.tsx   # generic Tàya-House template; generateStaticParams(detail_enabled, ≥1); notFound() if off
  admin/
    layout.tsx           # ROOT #2: own <html>, admin.css, robots noindex, instant=false
    login/page.tsx  invite/[token]/page.tsx
    (app)/layout.tsx     # shell; session UI in Suspense
    (app)/page.tsx       # dashboard
    (app)/content/{hero,cuisines,destinations,experiences,heritage,stories,offers,nav,contact,seo,sections}/page.tsx + actions.ts
    (app)/restaurants/page.tsx, [id]/page.tsx, [id]/hours/page.tsx, actions.ts
    (app)/reservations/page.tsx, [ref]/page.tsx, closures/page.tsx, actions.ts
    (app)/locales/page.tsx, media/page.tsx, audit/page.tsx
    (app)/users/page.tsx (admin)        (app)/settings/ai/page.tsx (admin) + actions.ts (save, testConnection)
    api/ai/{translate,rewrite,seo,alt}/route.ts   api/upload/route.ts
  api/availability/route.ts   # drop `dynamic` export
lib/cache-tags.ts  lib/i18n/config.ts
lib/server/  (import 'server-only')
  db/ auth/{session,dal}.ts  content/{get*.ts,mutations.ts}  reservations.ts  audit.ts  email.ts  ai/{vertex,settings}.ts
```

## 6. Vertex AI configured in admin (Next.js side only; SDK and model choice are another topic)

- `settings/ai` is admin-only. A DB row holds model id (Gemini or Claude on Vertex), region, system prompts, the do-not-translate glossary (for example "Tàya House", "Phố Cuốn") and per-feature toggles. Saving calls `requireRole('admin')`, validates, writes the audit log, then `updateTag('ai-settings')`.
- GCP credentials live only in env vars, read in `lib/server/ai/vertex.ts` and never `NEXT_PUBLIC_`.
- "Test connection" is a Server Action that makes a one-token call with a timeout and returns `{ok, latencyMs, model, error}` with no secrets.
- Translate, rewrite, SEO and alt text run through Route Handlers (section 3) and **return suggestions only**. An editor reviews them in the form before saving.

## 7. Folding in the known bugs

- **Time zone.** Compute the business date in `Asia/Ho_Chi_Minh` with `Intl.DateTimeFormat`, both in the actions (request time, allowed under Cache Components) and on the client after mount. Never compute it in a prerendered render, which Cache Components flags anyway.
- **Intro.** Templates remount and re-run effects on navigation (`template.md:10,65`), but only at their own segment level. Simplest fix: a per-page client `<IntroTrigger/>` replacing `Chrome`'s `useIntro(true,0)`. Alternative: `template.tsx` at both `[lang]` and `restaurants`.

## Recommendation
Restructure into two root layouts:
- `app/(site)/[lang]/layout.tsx` takes over everything `app/layout.tsx` does today: fonts, `MOTION_BOOTSTRAP`, `SiteProvider`/`Chrome`, `<html lang={await lang()}>`. It also has `generateStaticParams` for the active DB locales (always including 'en') and a cached `generateMetadata` with hreflang alternates.
- `app/admin/layout.tsx` has its own html/body and no guest Chrome.
- Add `app/global-not-found.tsx` with `experimental.globalNotFound`.

Use `proxy.ts` only for paths without a locale prefix (cookie, then Accept-Language, then 'en' redirect) and for `/admin` (optimistic session-cookie check plus a nonce CSP).

Enable `cacheComponents: true` in the same change:
- Every guest read goes through a `server-only` DAL getter with `'use cache'`, `cacheLife('max')`, a `cacheTag` per content type (`content:hero`, `restaurants`, `restaurant:<id>`, `booking-rules:<id>`, `locales`, `i18n:<code>`) and `lang()` from `next/root-params`.
- Each admin Server Action calls `requireRole` and validates with zod, then writes, audits and calls `updateTag`, so changes are live on the next request with a global purge of about 300 ms on Vercel.
- Reservations and availability are never cached.
- Preview works through Draft Mode, enabled by an authenticated Server Action, with the DAL reading draft columns when `isEnabled`.

As part of the same work, fix the issues Cache Components will report:
- Remove the `revalidate` and `dynamic` exports.
- Replace pathname-derived `view` with a per-page ViewMarker.
- Move `new Date()` and `days()` out of render, using the `Asia/Ho_Chi_Minh` business date in actions.
- Scope `document`-wide DOM queries to the visible page.
- Replace `Chrome`'s `useIntro` with a per-page IntroTrigger.
- Set `instant = false` on the admin layout.

Security and forms:
- Every Server Action and admin Route Handler re-verifies session and role. Route Handlers also check Origin.
- Upload images directly from the client to storage; the 1 MB action default and Vercel's 4.5 MB limit rule out large Server Action uploads.
- Run long Vertex AI calls in admin Route Handlers, not Server Actions, because actions are dispatched one at a time.
- Send emails, audit entries and alt-text jobs in `after()`.
- Admin forms use `useActionState` with `{ok, fieldErrors, message, values}` and `bind(null, id)`.

If the team won't take on the Cache Components migration now, keep the previous model with `unstable_cache` plus tags and `updateTag`. The tag names and DAL shape are the same, so moving to Cache Components later is mechanical.

## Risks
- Cache Components migration touches the shared client chrome. SiteProvider and PageCurtain call usePathname, which needs Suspense for dynamic params. BookingBar and ReserveDrawer call new Date() in render, which is a build error. lib/motion.tsx and scrollToId query the whole document, and Activity keeps up to 3 hidden routes in the DOM, so they can hit hidden duplicate IDs.
- Admin-added locales and restaurants are not in the build-time generateStaticParams. The first visit gets the App Shell or an on-demand render, and every page must call notFound() for inactive locales and restaurants with the detail page switched off. Proxy can't use the Next cache, so its active-locale list needs a TTL memo or Edge Config and can lag by up to the TTL.
- The proposed Proxy matcher regex (a negative lookahead for locale-shaped first segments) is untested. Verify it with unstable_doesProxyMatch before relying on it, or Proxy may run on every cached guest page and cost a function call per request.
- Runtime 'use cache' entries don't persist on serverless, and crawlers bypass the static shell. Every re-render after an updateTag, and every bot hit, queries Neon. If load grows, add 'use cache: remote' (Vercel Runtime Cache, regional, billed).
- Guests who already have a page in their client router cache can see old content for up to cacheLife stale (5 min for 'max', 30 s minimum) after an admin save. Only new requests are guaranteed fresh.
- Language switch with <Link> is a soft navigation within the same root layout (verified in router source). Whether client state such as the booking drawer survives it, and whether Activity keeps the other locale's tree hidden, is unverified, hence the recommendation to use a full <a href> navigation.
- Nonce CSP is incompatible with static and PPR guest pages. The guest CSP will likely need 'unsafe-inline' or hashes, including for the inline MOTION_BOOTSTRAP script. SRI is experimental, and it is unverified whether it covers Next's inline Flight scripts.
- Server Actions accept requests with no Origin header (only a warning is logged). The CSRF defence therefore also relies on SameSite session cookies, and admin Route Handlers need their own Origin check.
- Image uploads through Server Actions hit the 1 MB default and Vercel's 4.5 MB payload cap; direct client-to-storage upload adds a token-issuing route that must be auth-checked.
- Vertex calls made as Server Actions block the editor's other actions in that tab, because actions are dispatched one at a time. Long calls also need maxDuration set (Vercel's default is 300 s).
- Removing app/layout.tsx (multiple root layouts) needs experimental.globalNotFound. Whether app/icon.svg, sitemap.ts and robots.ts at the app root still apply under multiple root layouts was not verified in the bundled docs.
- The fonts (Be Vietnam Pro and Crimson Pro, latin and vietnamese subsets) lack Hangul and Han glyphs. KO and ZH locales need additional next/font declarations, which adds payload unless per-locale class switching is used.
- Several config flags are experimental in 16.3.7: serverActions under experimental, globalNotFound, authInterrupts and sri.

## Open questions
- Should a new visitor at / be redirected by browser language (Accept-Language), or always go to /en (or /vi) first?
- When an admin adds a locale (KO or ZH), should it go live only after every text field has a reviewed translation, or as soon as it is switched on, with untranslated fields falling back to English?
- What language should the admin interface itself use: Vietnamese, English, or switchable per staff member?
- When a guest switches language, may the page fully reload (simpler, and the booking drawer state is lost), or must booking state survive the switch?
- Is there a hard requirement for a strict CSP on the guest site? A nonce-based CSP would make every guest page dynamic and give up static/CDN speed.
- Do restaurant URLs need translated slugs per language (e.g. /vi/nha-hang/...), or can they stay the same in every language (/vi/restaurants/taya-house)?
- Is it acceptable for a guest who already has a page open to see content up to 5 minutes old after an admin save? New visitors would see the change immediately.
- Where should uploaded images be stored: Vercel Blob or Google Cloud Storage (alongside Vertex AI)? And what is the maximum upload size?

## Key facts
- [verified] Recommended i18n structure: all special files under app/[lang]. The root layout may live in app/[lang]/layout.tsx and uses generateStaticParams for locales and <html lang>. (docs/02-guides/internationalization.md:74,96,256-273)
- [verified] The next/root-params lang() getter works in Server Components and server utilities but NOT in Client Components, Server Actions or Route Handlers. It was introduced in 16.3.0, and only the root params a cached function reads enter its cache key. (docs/03-api-reference/04-functions/next-root-params.md:49,198-200,390,426)
- [verified] With Cache Components, generateStaticParams must return at least one param (an empty array is a build error) and dynamicParams is not supported. (docs/03-api-reference/04-functions/generate-static-params.md:310; docs/02-guides/migrating-to-cache-components.md:568-570,606-610)
- [verified] generateStaticParams is not called again during ISR, so admin-added locales or restaurants render on demand and pages must call notFound() for inactive values. (docs/03-api-reference/04-functions/generate-static-params.md:60)
- [verified] Navigating between different root layouts (route groups) causes a full page load. Changing only the value of the [lang] root param is NOT a new root layout, so it is a soft navigation. (docs/03-api-reference/03-file-conventions/route-groups.md:30; node_modules/next/dist/client/components/router-reducer/is-navigating-to-new-root-layout.js:16-24)
- [verified] global-not-found.tsx (experimental.globalNotFound) is the documented 404 solution for apps with multiple root layouts or a dynamic root segment. (docs/03-api-reference/03-file-conventions/not-found.md:47-72)
- [verified] updateTag can only be called in Server Actions. It expires the tag so the next request waits for fresh data, and it re-renders the current route in the same action response. It also works without Cache Components. (docs/03-api-reference/04-functions/updateTag.md:12,56; docs/02-guides/server-actions.md:40-46; docs/02-guides/migrating-to-cache-components.md:456)
- [verified] revalidateTag requires a second profile argument ('max' for stale-while-revalidate, {expire:0} for immediate). The single-argument form is deprecated. (docs/03-api-reference/04-functions/revalidateTag.md:22-30)
- [verified] revalidatePath called from a Server Function currently also refreshes all previously visited pages; the docs say to prefer tags. (docs/03-api-reference/04-functions/revalidatePath.md:19; docs/01-getting-started/09-revalidating.md:187)
- [verified] unstable_cache 'has been replaced by use cache in Next.js 16'. (docs/03-api-reference/04-functions/unstable_cache.md:7)
- [verified] On serverless, runtime 'use cache' entries are in-memory and typically don't persist across requests. Prerendered/ISR output is durable. (docs/03-api-reference/01-directives/use-cache.md:251; https://vercel.com/docs/incremental-static-regeneration (2026-08-28))
- [verified] On Vercel, ISR storage is durable and per-deployment, and on-demand revalidation purges HTML and RSC payload across all regions within about 300 ms. (https://vercel.com/docs/incremental-static-regeneration (last_updated 2026-08-28))
- [likely] Tags added with cacheTag inside 'use cache' are attached to the Vercel ISR page entries, so updateTag purges those guest pages globally. (Inferred from docs/02-guides/how-revalidation-works.md (explicit tags) and the Vercel ISR docs; not stated verbatim)
- [verified] With Cache Components, Client Components are also prerendered, and new Date() during render raises the blocking-prerender-current-time-client error. BookingBar.tsx:15 and ReserveDrawer.tsx:46 call days() during render. (docs/02-guides/client-side-data-fetching/tanstack-query.md:369; components/booking/BookingBar.tsx:15)
- [verified] Under Cache Components, usePathname/useParams in a shared-layout client component suspends for unknown dynamic params, and the build fails without a Suspense boundary. SiteProvider and PageCurtain use usePathname. (docs/02-guides/migrating-to-cache-components.md:674; components/site/SiteProvider.tsx:107)
- [verified] With Cache Components, Activity keeps up to 3 previous routes mounted but hidden; effects clean up when hidden and re-run when shown. (docs/02-guides/preserving-ui-state.md:19; docs/03-api-reference/05-config/01-next-config-js/cacheComponents.md:52)
- [verified] Route segments exporting dynamic, revalidate or fetchCache error once cacheComponents is on (app/layout.tsx:36 and app/api/availability/route.ts:5 do this). (docs/02-guides/migrating-to-cache-components.md:76)
- [verified] In Draft Mode, 'use cache' re-executes and is not stored, and the page is served private/no-store. draftMode().isEnabled is readable inside 'use cache'; enable() and disable() only work in Route Handlers or Server Actions. (docs/02-guides/draft-mode.md:15-23,308; docs/03-api-reference/01-directives/use-cache.md:276-287)
- [verified] Server Actions have a built-in CSRF check comparing the Origin host to Host/X-Forwarded-Host. Requests without an Origin header are allowed with a warning. (docs/02-guides/server-actions.md:82; docs/03-api-reference/05-config/01-next-config-js/serverActions.md:13)
- [likely] Route Handlers do not get the Server Action Origin check, so admin POST route handlers need a manual Origin check. (The docs mention CSRF protection only for Server Actions (grep of docs/))
- [verified] The Server Action body limit is 1 MB by default and is configured with experimental.serverActions.bodySizeLimit; multipart overhead counts toward it. (docs/03-api-reference/05-config/01-next-config-js/serverActions.md:61-75; node_modules/next/dist/server/config-shared.d.ts:928-940)
- [verified] Vercel Functions cap request and response bodies at 4.5 MB (413 FUNCTION_PAYLOAD_TOO_LARGE). (https://vercel.com/docs/functions/limitations (last_updated 2026-08-24))
- [verified] Next.js dispatches Server Actions one at a time per client, so long AI calls made as actions block other actions; use Route Handlers for long or streaming work. (docs/02-guides/server-actions.md:28-30)
- [verified] Only the Data Access Layer should read process.env secrets. import 'server-only' works in both the DAL and 'use server' files. (docs/02-guides/data-security.md:132,437)
- [verified] A page-level auth check does not extend to its Server Actions; every action must re-verify. Proxy should do only optimistic cookie checks with no DB, and a Proxy matcher that excludes a path also skips the Server Actions on it. (docs/02-guides/data-security.md:339; docs/02-guides/authentication.md:1026-1033; docs/03-api-reference/03-file-conventions/proxy.md:249)
- [verified] Nonce-based CSP requires dynamic rendering and is incompatible with PPR/static pages. Without nonces, the docs sample header CSP uses 'unsafe-inline' for scripts. SRI hash-based CSP is experimental. (docs/02-guides/content-security-policy.md:385-397,417-447,456)
- [verified] In Proxy, the fetch cache options have no effect, matchers must be constants, and Proxy runs on Node by default. unstable_doesProxyMatch can unit-test matchers. (docs/01-getting-started/16-proxy.md:31; docs/03-api-reference/03-file-conventions/proxy.md:136,255,732-745)
- [verified] useActionState changes the action signature to (prevState, formData) and exposes a pending flag. bind() passes ids and supports progressive enhancement. (docs/02-guides/forms.md:72-91,190-215,278)
- [verified] template.tsx remounts and re-runs effects on navigation, but only at its own segment level. (docs/03-api-reference/03-file-conventions/template.md:10,65)
- [verified] after() runs after the response in Server Functions and Route Handlers (Vercel uses waitUntil), which suits Resend emails, audit logging and AI alt-text. (docs/03-api-reference/04-functions/after.md:6,186)
- [verified] Under Cache Components, crawlers skip the static shell and get a full request-time render. (docs/01-getting-started/08-caching.md:607)
- [verified] Latest npm versions: @formatjs/intl-localematcher 0.9.0, negotiator 1.1.0, zod 4.6.5. (npm view (2026-10-01))