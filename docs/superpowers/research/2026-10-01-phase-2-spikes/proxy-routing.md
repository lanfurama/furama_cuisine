# Phase 2 routing edges: proxy.ts matcher + locale redirect, enabled-locales in proxy, /taya-house redirect, global-not-found vs [lang]/not-found, error.tsx, sitemap/robots/icon with no root layout (spike in clone spike-proxy)

## Verified patterns

Clone: /private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/spike-proxy (DB furama_cuisine_spikepx_test, server port 3237 killed, lsof clean). All below verified with `next build` + `next start -p 3237` (Next 16.3.7 Turbopack, cacheComponents + partialPrefetching + experimental.globalNotFound all on). Build output: `/en` static, `/en/restaurants/taya-house` static, `/en/boom` partial prerender, `ƒ Proxy (Middleware)`, `/icon.svg /robots.txt /sitemap.xml` static.

### Layout of files (no app/layout.tsx, no app/page.tsx)
```
app/global-not-found.tsx
app/sitemap.ts  app/robots.ts  app/icon.svg  app/globals.css  app/api/availability/route.ts
app/(site)/[lang]/layout.tsx          <- the "root layout" (html/body), NEVER calls notFound()
app/(site)/[lang]/not-found.tsx
app/(site)/[lang]/error.tsx
app/(site)/[lang]/(guarded)/layout.tsx   <- locale guard (notFound for unknown/disabled locale)
app/(site)/[lang]/(guarded)/page.tsx
app/(site)/[lang]/(guarded)/restaurants/[slug]/layout.tsx  <- slug guard (optional)
app/(site)/[lang]/(guarded)/restaurants/[slug]/page.tsx
proxy.ts   lib/i18n/locales.ts   lib/i18n/enabled-locales.ts   lib/i18n/proxy-matcher.test.ts
```

### next.config.ts (WORKED)
```ts
import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  reactStrictMode: true,
  cacheComponents: true,
  partialPrefetching: true,
  experimental: { globalNotFound: true },
  async redirects() {
    return [{ source: '/taya-house', destination: '/en/restaurants/taya-house', permanent: true }];
  },
};
export default nextConfig;
```

### lib/i18n/locales.ts (pure, unit-tested)
```ts
export const DEFAULT_LOCALE = 'en';
export const LOCALE_COOKIE = 'NEXT_LOCALE';
/** Phase 2: only 'en' exists. Phase 8 swaps this for the locales table. */
export const ENABLED_LOCALES: readonly string[] = ['en'];

export function pickLocale(cookie: string | undefined, acceptLanguage: string | null, enabled: readonly string[]): string {
  const set = new Set(enabled.map((l) => l.toLowerCase()));
  const c = cookie?.toLowerCase();
  if (c && set.has(c)) return c;
  const ranked = (acceptLanguage ?? '').split(',').map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag: tag.toLowerCase(), q: q ? Number(q.slice(2)) : 1 };
    }).filter((x) => x.tag && x.tag !== '*' && x.q > 0).sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    if (set.has(tag)) return tag;
    const primary = tag.split('-')[0];
    if (set.has(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}
```

### proxy.ts (WORKED; Node runtime, named export `proxy`, async OK)
```ts
import { NextResponse, type NextRequest } from 'next/server';
import { ENABLED_LOCALES, LOCALE_COOKIE, pickLocale } from '@/lib/i18n/locales';
import { getEnabledLocalesBestEffort } from '@/lib/i18n/enabled-locales';   // optional, see below

export const config = {
  matcher: [
    '/admin/:path*',
    '/((?!api(?:/|$)|_next(?:/|$)|admin(?:/|$)|[a-z]{2,3}(?:-[a-z0-9]{2,8})*(?:/|$)|.*\\..*).*)',
  ],
};

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return NextResponse.next(); // phase 4+: session-cookie check
  }
  const locale = pickLocale(
    request.cookies.get(LOCALE_COOKIE)?.value,
    request.headers.get('accept-language'),
    process.env.PROXY_DB === '1' ? await getEnabledLocalesBestEffort() : ENABLED_LOCALES, // phase 2: just ENABLED_LOCALES
  );
  const url = request.nextUrl.clone();           // keeps ?query
  url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
  const res = NextResponse.redirect(url, 307);   // 307: depends on cookie/header, must not be cached as permanent
  res.headers.append('Vary', 'Cookie, Accept-Language');
  return res;
}
```
Matcher design: "locale-shaped first segment" = `[a-z]{2,3}(?:-[a-z0-9]{2,8})*` followed by `/` or end. Matches en, vi, zh-hans, pt-br. A matcher cannot enumerate DB locales (must be build-time constants, proxy.md "Good to know"), so shape-based is the only way to honour spec 6.1 (cached guest pages never invoke proxy) while locales are added without deploy.

### Vitest unit test (31 tests pass: `TZ=UTC npx vitest run lib/i18n`)
```ts
import { describe, expect, it } from 'vitest';
import { unstable_doesMiddlewareMatch as matches } from 'next/experimental/testing/server';
import { config } from '@/proxy';
import { pickLocale } from '@/lib/i18n/locales';
const m = (url: string) => matches({ config, url });
describe('proxy matcher', () => {
  it.each(['/', '/restaurants', '/restaurants/taya-house', '/anything', '/english', '/admin', '/admin/sign-in', '/admin/a/b'])('runs on %s', (u) => expect(m(u)).toBe(true));
  it.each(['/en', '/en/', '/en/restaurants/taya-house', '/vi/x', '/zh-hans', '/zh-hans/restaurants', '/pt-br/a', '/xx/nope',
    '/api/availability', '/api', '/_next/static/a.js', '/_next/image', '/favicon.ico', '/icon.svg', '/sitemap.xml', '/robots.txt', '/images/a.png'])('skips %s', (u) => expect(m(u)).toBe(false));
});
// Known limitation: unprefixed top-level 2-3 letter path ('/faq') looks like a locale -> skipped -> 404.
it('treats 2-3 letter first segments as locale-shaped (skipped)', () => expect(m('/faq/x')).toBe(false));
describe('pickLocale', () => { /* default en; disabled cookie ignored; cookie beats AL; q-order + primary subtag (vi-VN -> vi); no match -> en */ });
```
The test imports `@/proxy` -> proxy.ts must keep top-level imports vitest-resolvable (it did; `@/` alias exists in vitest.config.mts). Import name is `unstable_doesMiddlewareMatch` (not ...ProxyMatch) from `next/experimental/testing/server`; signature `{config, url, headers?, cookies?, nextConfig?}` -> boolean (node_modules/next/dist/experimental/testing/server/middleware-testing-utils.d.ts).

### curl proof (production server)
```
GET /                      -> 307 location: /en            vary: Cookie, Accept-Language
GET /restaurants           -> 307 /en/restaurants
GET /anything?x=1          -> 307 /en/anything?x=1
GET /x/y (cookie en, AL fr)-> 307 /en/x/y
GET /en                    -> 200 x-nextjs-cache: HIT, x-nextjs-prerender: 1, s-maxage=31536000   (no proxy hop)
GET /en/restaurants/taya-house -> 200 prerendered
GET /taya-house            -> 308 Permanent Redirect location: /en/restaurants/taya-house   (curl -I)
GET /api/availability      -> 400 (route handler reached, not redirected)
GET /icon.svg /sitemap.xml /robots.txt -> 200 (not redirected)
GET /admin/x               -> proxy ran (NextResponse.next) then 404 global-not-found
```
With DB-backed enabled list (PROXY_DB=1, locales table en,vi enabled; ko disabled): AL `vi,en;q=0.5` -> /vi/restaurants; cookie NEXT_LOCALE=vi -> /vi; AL ko -> /en/restaurants; AL fr -> /en. After `update locales set enabled=true where code='ko'`: still /en/restaurants immediately (60s TTL cache hit), /ko/restaurants after 61s. With DATABASE_URL pointing at a dead port (localhost:1): redirect still works, falls back to ['en'], 44ms first call then 2ms (negative cache); with DATABASE_URL unset: 77ms, still /en.

### lib/i18n/enabled-locales.ts (WORKED but NOT recommended for phase 2)
```ts
import { getPool } from '@/db/client';
import { ENABLED_LOCALES } from './locales';
const TTL_MS = 60_000, TIMEOUT_MS = 500;
let cache: { at: number; value: readonly string[] } | null = null;
export async function getEnabledLocalesBestEffort(): Promise<readonly string[]> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.value;
  try {
    const q = getPool().query<{ code: string }>('select code from locales where enabled order by code');
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS));
    const { rows } = await Promise.race([q, timeout]);
    const value = rows.length ? rows.map((r) => r.code) : ENABLED_LOCALES;
    cache = { at: now, value };
    return value;
  } catch {
    cache = { at: now - TTL_MS + 5_000, value: ENABLED_LOCALES }; // negative-cache fallback for 5s
    return ENABLED_LOCALES;
  }
}
```
(Race leaves the pg query running on timeout; harmless but note it.)

### (site)/[lang]/layout.tsx (root layout, WORKED)
```tsx
import { ENABLED_LOCALES } from '@/lib/i18n/locales';
import '../../globals.css';
export function generateStaticParams() { return ENABLED_LOCALES.map((lang) => ({ lang })); }
export default async function LangLayout({ children, params }: { children: React.ReactNode; params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  return (<html lang={ENABLED_LOCALES.includes(lang) ? lang : 'en'}><body>{children}</body></html>);
}
```
### (guarded)/layout.tsx (locale guard, WORKED) — same shape for restaurants/[slug]/layout.tsx
```tsx
import { notFound } from 'next/navigation';
import { ENABLED_LOCALES } from '@/lib/i18n/locales';
export default async function Guard({ children, params }: { children: React.ReactNode; params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!ENABLED_LOCALES.includes(lang)) notFound();
  return children;
}
```
### app/global-not-found.tsx, [lang]/not-found.tsx, [lang]/error.tsx
```tsx
// app/global-not-found.tsx  (must return full <html>; can import './globals.css' and fonts; can export metadata)
import './globals.css';
export const metadata = { title: '404 global' };
export default function GlobalNotFound() { return (<html lang="en"><body><h1>GLOBAL not-found</h1></body></html>); }
// [lang]/not-found.tsx: plain server component, NO html/body: export default function NotFound() { return <main><h1>LANG not-found</h1></main>; }
// [lang]/error.tsx
'use client';
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (<main><h1>LANG error boundary</h1><p data-digest>{error.digest ?? 'no-digest'}</p><p data-msg>{error.message}</p><button onClick={reset}>retry</button></main>);
}
```
Simulated render failure page (must be under Suspense with cacheComponents, else build error):
```tsx
import { Suspense } from 'react'; import { connection } from 'next/server';
async function Boom(): Promise<React.ReactNode> { await connection(); throw new Error('simulated render failure'); }
export default function Page() { return <main><Suspense fallback={<p>loading</p>}><Boom /></Suspense></main>; }
```
(An `async function` that only throws has return type Promise<void> and fails tsc as JSX; annotate Promise<React.ReactNode>.)

### What renders where (Chromium via Playwright against next start; status = first navigation)
| URL | status | UI |
|---|---|---|
| /en/nope (unmatched under valid locale) | 404 | GLOBAL not-found (title "404 global", html lang=en) |
| /xx/nope (unmatched, unknown locale) | 404 | GLOBAL not-found |
| /nope | 307 -> /en/nope -> 404 GLOBAL |
| /xx, /zz, /zz/restaurants/taya-house (unknown locale, route matches) | 404 | LANG not-found (with guard layout), html lang falls back to en, meta noindex |
| /en/restaurants/<unknown> (notFound() in page or slug guard) | first hit 200 (soft 404, noindex), later hits 404 (cached) | LANG not-found inside the html layout |
| /en/boom (render throws) | 200 (streamed) | LANG error boundary; server log `Error: simulated render failure digest '705950102'`; client error.message is only "Minified React error #441..." plus digest -> use digest to correlate to server logs, don't show message |
| /favicon.ico (nonexistent file) | 404 | Next default unbranded 404 (not global-not-found); fine |
Rule: global-not-found handles URLs that match no route; [lang]/not-found.tsx handles notFound() thrown from below the [lang] layout. A notFound() thrown by the root layout itself falls to Next's own default "404: This page could not be found" (observed for /xx before introducing the (guarded) layout) -> that's why the guard is a nested layout.

### sitemap/robots/icon with no root layout (WORKED, answers spec §16)
`app/sitemap.ts`, `app/robots.ts`, `app/icon.svg` stay at app/ root exactly as today. Build lists `/sitemap.xml`, `/robots.txt`, `/icon.svg` as static. `/sitemap.xml` returns valid urlset XML, `/robots.txt` text with Sitemap line, `/icon.svg` image/svg+xml; `<link rel="icon" href="/icon.svg?icon.<hash>.svg" sizes="any" type="image/svg+xml"/>` is injected into pages under [lang] AND into the global-not-found page. They are not locale routes, matcher excludes them (dot in path; sitemap.ts/robots.ts have no dot-less path issue because served as sitemap.xml/robots.txt).

## Errors hit
- **Route segment config "dynamic" is not compatible with `nextConfig.cacheComponents`. Please remove it. (app/api/availability/route.ts:6 `export const dynamic = 'force-dynamic'`)**
  - cause: Enabling cacheComponents rejects route segment config `dynamic` (and presumably `revalidate`, `fetchCache`) everywhere, including route handlers; the current app/layout.tsx also has `export const revalidate = 3600` which will hit the same error.
  - fix: Delete `export const dynamic = 'force-dynamic'` from the route handler (GET handlers reading request.url / DB are dynamic anyway under cacheComponents); drop `revalidate` from layout and use 'use cache' + cacheLife instead.
- **TS2786 'Boom' cannot be used as a JSX component. Type '() => Promise<void>'**
  - cause: async component that only throws infers Promise<void>.
  - fix: Annotate `: Promise<React.ReactNode>`.
- **/xx rendered Next's default 'The page could not be found' (unbranded, html lang null, body empty in SSR HTML) when [lang]/layout.tsx called notFound() for an unknown locale**
  - cause: notFound() thrown from the root layout has no layout to render the segment's not-found.tsx into, and global-not-found is only used for unmatched URLs.
  - fix: Keep root layout non-throwing; put the locale check in a nested `(guarded)/layout.tsx` (route group) so [lang]/not-found.tsx renders inside the html layout, giving a branded 404 with real 404 status.
- **`/en/restaurants/<unknown-slug>` first request returns HTTP 200 (noindex meta), 404 only on later requests**
  - cause: Cache Components streams a static shell first, so notFound() inside the dynamic-param boundary happens after headers are sent (docs not-found.md:193, loading.md:105-113). Adding a slug-guard layout did not change it.
  - fix: Accept soft-404 with noindex for unknown/disabled slugs (spec forbids proxy on locale-prefixed paths, which is the documented way to get a real 404). Unknown LOCALE is a true 404 via the guard layout.
- **vitest matcher test expected '/faq/x' to run proxy but it did not**
  - cause: Shape-based locale exclusion treats any 2-3 letter first segment as a locale code.
  - fix: Documented as known limitation and asserted in the test; unprefixed top-level routes must be 4+ letters (or listed in a future explicit allow-list).
- **zsh: no matches found: http://localhost:3237/anything?x=1**
  - cause: unquoted ? glob in zsh
  - fix: quote URLs / run through bash -c.

## Recommended task breakdown

Task A (pure, TDD): lib/i18n/locales.ts (DEFAULT_LOCALE, LOCALE_COOKIE, ENABLED_LOCALES constant, pickLocale) + proxy matcher unit test with unstable_doesMiddlewareMatch (the 31-test file above); proxy.ts using only the constant. No DB in proxy for phase 2. Task B: restructure to app/(site)/[lang] with non-throwing html layout + generateStaticParams, (guarded)/layout.tsx locale guard, [lang]/not-found.tsx, [lang]/error.tsx, app/global-not-found.tsx, next.config (cacheComponents, partialPrefetching, experimental.globalNotFound, redirects for /taya-house); remove `dynamic`/`revalidate` exports (route.ts, layout) in the same task or build breaks; keep sitemap.ts/robots.ts/icon.svg at app/ root. Depends on A for ENABLED_LOCALES. Task C: move taya-house -> (guarded)/restaurants/[slug] with generateStaticParams from constant slugs; E2E curl/Playwright checks: /taya-house 308, / -> /en 307, /xx 404 branded, /en/nope global 404, /en/boom error boundary, favicon/sitemap/robots 200. Task D (later, phase 8): swap ENABLED_LOCALES for locales table read in the guard (cached 'use cache' tag 'locales'), and decide whether to enable the best-effort DB lookup in proxy. Order: A -> B -> C; Playwright screenshot comparison of /en vs old / after C.

## Risks / open questions
- Recommendation for item 2: in phase 2 use the ENABLED_LOCALES constant in proxy (zero DB, zero latency, nothing to fail), since only 'en' exists and the redirect target set cannot differ. proxy.md says not to rely on shared modules/globals, and the proxy would be a second DB consumer with its own pool on Neon. The DB lookup is technically fine (Node runtime, pg works, 60s module cache + 500ms cap + fallback verified) so adopt it in phase 8 when a second locale exists; even then, consider that a redirect to a locale that is enabled in the DB but not in the stale cache simply lands on /en for up to 60s per instance (verified), harmless.
- Real 404 status for unknown slug is not achievable without proxy on locale-prefixed paths; first request returns 200+noindex (soft 404), subsequent cached requests 404. Spec §6.1 deliberately forbids proxy there. Decide whether SEO tolerance is acceptable (noindex present). Unknown locale is a true 404.
- Matcher is shape-based: any unprefixed 2-3 letter top-level segment (/faq, /vip) is treated as a locale and 404s instead of redirecting. Also a not-yet-enabled-but-shaped locale (/ko when disabled) is not redirected by proxy; it goes to the guard and 404s (correct). Also codes with 4+ letter primary subtags (e.g. 'fil' ok; 'zh-hans' ok) are fine, but a locale code like 'haw-us' passes; a code longer than 3 letters in primary subtag would NOT be excluded and would redirect to /en/xxxx/... -- constrain locale codes in the locales table CHECK to ^[a-z]{2,3}(-[a-z0-9]{2,8})*$.
- /admin/* is in the matcher but proxy only returns next() right now; admin must be a separate root layout (spec) -> app/admin/layout.tsx with its own html; global-not-found then covers admin 404s (observed /admin/x -> GLOBAL not-found). Admin routes will need their own not-found handling if branded.
- Existing app/layout.tsx uses `export const revalidate = 3600` and awaits listRestaurants() directly; under cacheComponents the layout's data reads must move into 'use cache' functions or Suspense (not spiked here, belongs to the read-layer spike). Any other `dynamic`/`revalidate`/`fetchCache` exports must be removed (build error).
- error.tsx: production client error.message is not the server message (showed 'Minified React error #441' for a server-thrown error inside streamed Suspense); only digest is reliable. error.tsx cannot render the html layout (it is inside it) but the layout stays intact; it did render in a 200 response. Errors thrown in the root layout itself would NOT be caught by [lang]/error.tsx (need app/global-error.tsx) -- not tested.
- partialPrefetching/cacheComponents interplay with real pages (Chrome, SiteProvider reading restaurants, 'use client' providers) not exercised: spike used skeleton pages, so 'build green' for the real /en page is still to be proven in the restructure task.
- Cookie NEXT_LOCALE is read but nothing sets it yet; language switcher (phase 8) must set it (path=/, 1 year) or the cookie branch is dead code.
- Vitest imports `@/proxy`; if proxy.ts later imports server-only modules (pg via enabled-locales), the unit test would pull them in -- keep config in a separate file or keep DB import dynamic.

## Spec deviations
- Spec §6.1 says global-not-found is needed 'for app/global-not-found.tsx' and implies [lang] layout may call notFound() for disabled languages ('Ngôn ngữ đã tắt ... thì notFound()'). Done literally in the root layout it yields Next's unbranded default 404 (blank SSR body). Deviation: root layout `app/(site)/[lang]/layout.tsx` must not throw; add a route-group `(guarded)/layout.tsx` (all pages live under it) that performs the locale check and calls notFound(), rendered by [lang]/not-found.tsx.
- Spec §6.1 matcher 'chỉ gồm /admin/:path* và các đường dẫn chưa có tiền tố ngôn ngữ ... bỏ qua mọi đường dẫn bắt đầu bằng mã ngôn ngữ': can't be literal because matcher must be build-time constants and locales are DB-driven; implemented as locale-SHAPED first segment `[a-z]{2,3}(-[a-z0-9]{2,8})*`, so unprefixed 2-3 letter top-level paths are skipped by proxy. Constrain locale codes accordingly.
- Spec §6.1 says enabled locales come from a best-effort DB query in proxy. For phase 2 recommend the constant ['en'] instead (DB variant verified working and available as lib/i18n/enabled-locales.ts for phase 8).
- Spec §6.1 'Ngôn ngữ đã tắt, hoặc nhà hàng đã tắt trang chi tiết, thì notFound()' gives a true 404 for locales but only a streamed 200+noindex soft-404 for restaurant slugs on first request (Cache Components behaviour, docs not-found.md:193).
- Spec §6.2 says enable cacheComponents in phase 2: it forces removal of `export const dynamic` in app/api/availability/route.ts and `export const revalidate` in app/layout.tsx (build errors), which the spec does not mention.

## Doc citations
- node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:21-25 (proxy invoked separately; do not rely on shared modules/globals)
- node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:58-70 (matcher regex w/ negative lookahead; without matcher runs on every request incl. static)
- node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:~145 'Execution order': headers, redirects (next.config), proxy, beforeFiles rewrites, filesystem routes (verified by curl: /taya-house -> 308 from next.config, not proxy's 307)
- node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md 'Runtime' section: 'Proxy defaults to using the Node.js runtime. The runtime config option is not available in Proxy files' (pg works; verified)
- node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:~296 matcher 'matcher values need to be constants so they can be statically analyzed' + _next/data always invoked
- node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/redirects.md:30 (permanent:true -> 308, false -> 307)
- node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md:50-125 (experimental.globalNotFound, app/global-not-found.tsx must return full html/body, for multiple root layouts / top-level dynamic segment root layout)
- node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md:133 (global-not-found handles unmatched URLs for whole app)
- node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md:13 and 04-functions/not-found.md:193 (200 for streamed, 404 non-streamed; with Cache Components a real 404 needs a check in proxy)
- node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md:101-113 (Status Codes: streaming returns 200, noindex meta added, real 404 requires check before streaming)
- node_modules/next/dist/docs/01-app/02-guides/adopting-partial-prefetching.md:54-65 (cacheComponents: true + partialPrefetching: true config)
- node_modules/next/dist/server/config-shared.d.ts:1553 (partialPrefetching?: boolean | 'unstable_eager')
- node_modules/next/dist/experimental/testing/server/middleware-testing-utils.d.ts (unstable_doesMiddlewareMatch signature)