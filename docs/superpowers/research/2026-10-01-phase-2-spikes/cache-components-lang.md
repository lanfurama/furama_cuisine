# Phase 2 spike: guest site under app/(site)/[lang] with cacheComponents + partialPrefetching on Next 16.3.7. Build and start are green, /en is pixel-identical to today's /, and DB-down and Activity behaviour were measured.

## Verified patterns

# Spike result: Cache Components restructure (clone `spike-cc`)

**Clone:** `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/spike-cc`

**Supporting files:** `.../scratchpad/spike-cc-out/`
- build logs: `build-final3.log`
- the Playwright rig used for verification: `pw.config.ts`, `pw-e2e.config.ts`, `visual/*.spec.ts`
- baseline screenshots: `visual/__shots__/`
- full component diff: `component-changes.diff`

The original repo was never modified (still clean at 537b7a9). The servers on ports 3266 and 3267 are stopped, and the `_test` databases are dropped.

## Final verification (all on the final code)

| Check | Command | Result |
|---|---|---|
| Build | `DATABASE_URL=postgres://localhost:5432/furama_cuisine_spikecc_test npx next build` | green; 0 warn/error lines |
| Unit + integration | `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_spikecc2_test npm test` | **68/68 passed** (11 files) |
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Lint | `npx oxlint` | exit 0; 13 warnings, none new (baseline had 4 more `exhaustive-effect-dependencies`) |
| Repo E2E | `e2e/*` against `next start -p 3266` | **7/7** after changing `e2e/navigation.spec.ts` from `'/'` to `'/en'` (goto and `waitForURL`) |
| Visual, JS on | Playwright `toHaveScreenshot`, `maxDiffPixelRatio: 0`, desktop 1280x860 and mobile 390x844@2x, full page, reduced motion, `.hero-slides` masked | **/en is pixel-identical to the baseline /, and /en/restaurants/taya-house to the baseline /taya-house** |
| Visual, JS off | same rig with `javaScriptEnabled: false` | identical for home and detail on both viewports |
| Behaviour | 5 tests × 2 projects | all pass; also pass in `next dev` with no console errors |
| Server Action | book a table from the prerendered detail page | POST to `/en/restaurants/taya-house`, reference `FC-6T9V2DJW`, row inserted (`taya-house\|2026-10-14\|11:30\|+84905111222`) |

The baseline screenshots needed `.hero-slides` masked: 10–16k pixels differ run to run from the slide crossfade.

The five behaviour tests:
- card → detail, where the curtain goes `['true','false']` and scrollY is 0
- detail header DESTINATIONS → `/en` scrolled to `#destinations` (top 75px)
- detail back → `/en#restaurants` (top 75px)
- direct load of the detail page, then the logo → home top
- a second visit to the detail page replays its entrance (opacity samples `0,0,0,0.11,…`)

### Build output (final)
```
Route (app)
┌ ○ /_not-found
├   /[lang]
│ ├ ◐ /[lang]
│ └ ○ /en
├   /[lang]/restaurants/[slug]
│ ├ ◐ /[lang]/restaurants/[slug]
│ ├ ◐ /en/restaurants/[slug]
│ └ ○ /en/restaurants/taya-house
├ ƒ /api/availability
└ ○ /icon.svg
ƒ Proxy (Middleware)
```

- `/en` and `/en/restaurants/taya-house` are **○ fully prerendered**.
- In `prerender-manifest`: `initialRevalidateSeconds 2592000` and `initialExpireSeconds 31536000`, which is `cacheLife('max')`.
- The `.meta` file has `x-next-cache-tags: …,restaurants,i18n:en`, so `updateTag('restaurants')` purges the pages.
- Baseline, for comparison: `○ / 1h 1y` and `○ /taya-house 1h 1y`.

### curl against `next start -p 3266` (final)
```
307 → /en                       /
200 HIT  rcards=12 #restaurants=1  /en         (cache-control s-maxage=2592000, swr=28944000)
200 HIT  rcards=5                  /en/restaurants/taya-house
200 (1st visit, noindex, streamed) /en/restaurants/nope
404 HIT  (2nd visit, cached 30d)   /en/restaurants/nope
308 → /en/restaurants/taya-house   /taya-house
404 MISS s-maxage=31536000 noindex /fr          (root-layout notFound; bare Next 404 UI)
404 global-not-found               /nothing/here
200 no-store                       /api/availability?restaurant=taya-house  {"today":"2026-10-01",...,"capacity":16}
400                                /api/availability (no restaurant) and date=2020-01-01
```

### DB failure at runtime
I restarted `next start` with `DATABASE_URL=postgres://localhost:5999/...`, a port with no listener (`ECONNREFUSED`), and expired the tag through a temporary route handler (deleted afterwards).

```
DB down, nothing invalidated:  /en 200 HIT rcards=12 | taya-house 200 HIT | /api/availability 503
revalidateTag('restaurants','max'):  /en 200 STALE (log: "Error revalidating the page in the background"), then 200 HIT with the old content: stale is kept
revalidateTag('restaurants',{expire:0}):  /en 500 text/plain "Internal Server Error" (21 bytes)
                                          taya-house 200 with an empty <html id="__next_error__"> doc; the browser then renders app/global-error.tsx
                                          /en/restaurants/nope (uncached) → same as taya-house
```

**Answer to "does a DB failure still serve the cached page":** yes for prerendered and ISR entries, including after a `'max'` revalidate. No once the entry is expired (`updateTag` or `{expire:0}`) or was never rendered.

## Files changed (final contents)

### next.config.ts
```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    globalNotFound: true,
  },
  async redirects() {
    return [
      // The detail page moved under the locale prefix in phase 2.
      { source: '/taya-house', destination: '/en/restaurants/taya-house', permanent: true },
    ];
  },
};

export default nextConfig;
```

### proxy.ts (spike-minimal; the real proxy is a separate task)
```ts
import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';

export function proxy(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = `/${DEFAULT_LOCALE}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/'] };
```

### app/(site)/[lang]/layout.tsx (moved from app/layout.tsx; root layout #1)
```tsx
import type { Metadata, Viewport } from 'next';
import { Be_Vietnam_Pro, Crimson_Pro } from 'next/font/google';
import { notFound } from 'next/navigation';
import { lang } from 'next/root-params';
import { getRestaurants } from '@/lib/server/content/restaurants';
import { ENABLED_LOCALES, bcp47, isEnabledLocale } from '@/lib/i18n/locales';
import { SiteProvider } from '@/components/site/SiteProvider';
import { MotionProvider } from '@/lib/motion';
import { Chrome } from '@/components/site/Chrome';
import '../../globals.css';

const crimson = Crimson_Pro({ subsets: ['latin', 'latin-ext'], weight: ['300', '400', '500', '600'], style: ['normal', 'italic'], display: 'swap', variable: '--font-crimson' });
const beVietnam = Be_Vietnam_Pro({ subsets: ['latin', 'latin-ext', 'vietnamese'], weight: ['300', '400', '500', '600'], display: 'swap', variable: '--font-be-vietnam' });

export const metadata: Metadata = { /* unchanged from app/layout.tsx */ };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#14201c' };
// `export const revalidate = 3600` REMOVED (errors under cacheComponents); cacheLife('max') in the read fn replaces it.

/** Every enabled locale is prerendered; Cache Components needs at least one. */
export async function generateStaticParams() {
  return ENABLED_LOCALES.map((code) => ({ lang: code }));
}

const MOTION_BOOTSTRAP = `try{document.documentElement.dataset.motion=matchMedia('(prefers-reduced-motion: reduce)').matches?'off':'on'}catch(e){}`;

export default async function SiteLayout({ children }: LayoutProps<'/[lang]'>) {
  const locale = await lang();
  if (!isEnabledLocale(locale)) notFound();
  const restaurants = await getRestaurants(locale);
  return (
    <html lang={bcp47(locale)} className={`${crimson.variable} ${beVietnam.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: MOTION_BOOTSTRAP }} /></head>
      <body>
        <MotionProvider>
          <SiteProvider locale={locale} restaurants={restaurants}>
            <Chrome>{children}</Chrome>
          </SiteProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
```
Note: `await lang()` sits outside Suspense in the root layout, which has to be so for `<html lang>`. As a result the `/[lang]` fallback shell is empty (0 bytes), and an unlisted locale renders at request time on its first visit. Nothing failed in build or dev because of this.

### lib/server/content/restaurants.ts (read layer)
```ts
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { listRestaurants } from '@/db/queries';
import type { Restaurant } from '@/lib/data';

export async function getRestaurants(locale: string): Promise<Restaurant[]> {
  'use cache';
  cacheLife('max');
  cacheTag('restaurants', `i18n:${locale}`);
  return listRestaurants();
}
```
`app/actions.ts` stays where it is and keeps calling the **uncached** `listRestaurants()`. The spec says booking is never cached, and `lang()` is not available in Server Actions anyway, so the locale will be passed explicitly. A 'use server' module is not a route file, and the action POSTs to whichever page calls it (verified: POST to `/en/restaurants/taya-house`).

### lib/i18n/locales.ts
```ts
export const DEFAULT_LOCALE = 'en';
const BCP47: Record<string, string> = { en: 'en' };
export const ENABLED_LOCALES = Object.keys(BCP47);
export function isEnabledLocale(code: string): boolean { return Object.hasOwn(BCP47, code); }
export function bcp47(code: string): string { return BCP47[code] ?? code; }
```

### lib/detail-pages.ts
```ts
export const DETAIL_SLUGS: readonly string[] = ['taya-house'];
export function hasDetailPage(restaurantId: string): boolean { return DETAIL_SLUGS.includes(restaurantId); }
export function homePath(locale: string): string { return `/${locale}`; }
export function detailPath(locale: string, slug: string): string { return `/${locale}/restaurants/${slug}`; }
```

### app/(site)/[lang]/page.tsx (moved from app/page.tsx)
```tsx
// imports unchanged + MobileBar, ViewMarker
export default function HomePage() {
  return (
    <ViewMarker view="home">
      <IntroTrigger />
      <Hero /><Finder /><Cuisines /><Restaurants /><Destinations /><Experiences /><Heritage /><Stories /><Offers />
      <MobileBar />
    </ViewMarker>
  );
}
```

### app/(site)/[lang]/restaurants/[slug]/page.tsx (moved from app/taya-house/page.tsx)
```tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TayaHero } from '@/components/detail/TayaHero';
import { TayaExperiences } from '@/components/detail/TayaExperiences';
import { MoreRestaurants } from '@/components/detail/MoreRestaurants';
import { IntroTrigger } from '@/components/site/IntroTrigger';
import { MobileBar } from '@/components/site/MobileBar';
import { ViewMarker } from '@/components/site/ViewMarker';
import { DETAIL_SLUGS } from '@/lib/detail-pages';

export async function generateStaticParams() {
  return DETAIL_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<'/[lang]/restaurants/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  if (slug !== 'taya-house') return {};
  return { title: 'Tàya House — Furama Cuisine', description: 'A wellness dining home beneath the Lagoon Garden at Furama Resort Danang, with Vietnamese cooking classes led by Cơ Tu chef A Rất Thị Hép.' };
}

/* The params read below blocks on purpose; this tells dev validation so. */
export const instant = false;

/* params awaited at the top, NOT inside <Suspense>: inside a boundary even prerendered slugs ship their
   content as a hidden streamed segment revealed only by an inline script, so no-JS visitors saw an empty page. */
export default async function RestaurantPage({ params }: PageProps<'/[lang]/restaurants/[slug]'>) {
  const { slug } = await params;
  if (!DETAIL_SLUGS.includes(slug)) notFound();
  return (
    <ViewMarker view="detail" restaurant={slug}>
      <IntroTrigger />
      <TayaHero />
      <TayaExperiences />
      <MoreRestaurants />
      <MobileBar restaurant={slug} />
    </ViewMarker>
  );
}
```
The alternative variant I tried (`<Suspense fallback={null}><RestaurantDetail params={params}/></Suspense>`) is saved at `spike-cc-out/page-suspense-variant.tsx`. It builds green and gives `/en/restaurants/[slug]` a 6.3 KB App Shell with the full chrome. The cost is that, with JS off, the detail body is blank: the no-JS screenshot came out 1280x860 against the expected 1280x2508. The HTML has `<template id="B:0">`, `<div hidden id="S:0">…</div>` and `$RC("B:0","S:0")`.

### components/site/ViewMarker.tsx (new)
```tsx
'use client';
import { createContext, useContext, useLayoutEffect, useRef, type RefObject } from 'react';
import { useSite, type View } from '@/components/site/SiteProvider';

const PageRootContext = createContext<RefObject<HTMLElement | null> | null>(null);
export function usePageRoot(): RefObject<HTMLElement | null> | null { return useContext(PageRootContext); }

/* Registers the visible page with the chrome. A layout effect, because Activity tears effects down
   when a page hides and re-runs them when it shows, so the registered page is always the visible one. */
export function ViewMarker({ view, restaurant, children }: { view: View; restaurant?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const { showPage } = useSite();
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    return showPage({ view, restaurant: restaurant ?? null, root });
  }, [showPage, view, restaurant]);
  return (
    <PageRootContext value={ref}>
      <main ref={ref} data-view={view}>{children}</main>
    </PageRootContext>
  );
}
```

### components/site/SiteProvider.tsx (key hunks; full diff in `spike-cc-out/component-changes.diff`)
```tsx
import { useRouter } from 'next/navigation';               // usePathname removed
import { detailPath, hasDetailPage, homePath } from '@/lib/detail-pages';
export type View = 'home' | 'detail';
export type PageView = { view: View; restaurant: string | null; root: HTMLElement };
// SiteState gains: locale, pageRoot: HTMLElement | null, showPage(page) => () => void; `navigate` removed

export function SiteProvider({ locale, restaurants, children }: { locale: string; restaurants: Restaurant[]; children: React.ReactNode }) {
  const router = useRouter();
  const home = homePath(locale);
  const [page, setPage] = useState<PageView | null>(null);
  const view: View = page?.view ?? 'home';
  const pageRoot = page?.root ?? null;
  const showPage = useCallback((next: PageView) => {
    setPage(next);
    document.documentElement.dataset.view = next.view; // drives the view-specific chrome CSS
    return () => setPage((cur) => (cur === next ? null : cur));
  }, []);
  …
  /* Only the visible page counts: hidden <Activity> pages keep their sections in the DOM. */
  const findSection = useCallback((id: string) => page?.root.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`) ?? null, [page]);
  const scrollTo = useCallback((id: string) => { const el = findSection(id); if (!el) return; /* unchanged offset math */ }, [findSection]);
  scrollToId:  if (!findSection(id) && view !== 'home') { pendingScroll.current = id; coverThen(() => router.push(home)); return; }
  pending-scroll effect:  if (!id || !pageRoot) return; …  deps [pageRoot, scrollTo]   (was [pathname, scrollTo])
  goHomeTop / goBackToRestaurants: router.push(home)  (was '/')
  openRestaurant: if (!hasDetailPage(r.id)) { openReserve({ restaurant: r.id }); return; }
                  setBooking({ restaurant: r.id }); setOverlay(null); setOpenDropdown(null);
                  if (page?.view === 'detail' && page.restaurant === r.id) return;
                  coverThen(() => router.push(detailPath(locale, r.id)));
  tab-sync effect: pageRoot?.querySelector('#restaurants' / '#destinations'), deps [pageRoot]
  scroll-top effect: useEffect(() => { if (pageRoot) window.scrollTo(0, 0); }, [pageRoot]);
```

### components/site/PageCurtain.tsx (only the hook changed)
```tsx
import { useSite } from '@/components/site/SiteProvider';   // usePathname removed
export function PageCurtain() {
  const ref = useRef<HTMLDivElement>(null);
  const { pageRoot } = useSite();          // changes once the new page has actually rendered
  const shown = useRef<HTMLElement | null>(null);
  useEffect(() => { curtain = ref.current; return () => { curtain = null; }; }, []);
  useEffect(() => {
    if (!pageRoot || pageRoot === shown.current) return;
    const first = shown.current === null;
    shown.current = pageRoot;
    if (!first) uncover();
  }, [pageRoot]);
  return (<div ref={ref} className="page-curtain" data-active="false" aria-hidden="true"><span>FURAMA</span></div>);
}
```
Comparing root identity rather than the object survives the StrictMode double layout effect without a spurious uncover.

### lib/motion.tsx (useIntro and useScrollMotion scoped to the page)
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
    const timer = window.setTimeout(() => { /* unchanged animate loop */ }, 30);
    return () => {
      window.clearTimeout(timer);
      // A page hidden by <Activity> keeps its DOM; re-arm the entrance so it plays again when shown.
      if (root) all.forEach((el) => el.removeAttribute('data-intro-done'));
    };
  }, [active, baseDelay, motion, root]);
}
export function useScrollMotion(overlayOpen: boolean, page: HTMLElement | null) {
  … useEffect(() => { if (!motion || !page) return; …
      page.querySelectorAll<HTMLElement>('[data-parallax]')…   // was document
      const hero = page.querySelector<HTMLElement>('[data-hero-content]');   // was document
      // [data-header] stays document-wide (chrome)
  }, [motion, overlayOpen, page]);
}
```
- IntroTrigger: `useIntro(true, 0, usePageRoot());`
- Chrome: `const { overlay, pageRoot } = useSite(); useScrollMotion(overlay !== null, pageRoot);`. `<MobileBar/>` moved out of Chrome into the pages, and `data-view` removed from `.booking-slot`.
- MobileBar: `export function MobileBar({ restaurant }: { restaurant?: string })`. The detail variant renders when `restaurant` is set and uses `setBooking({ restaurant }); openReserve({ restaurant })`.
- Header and Footer: `href={homePath(locale)}`. Header loses `view` and `data-hide-mobile`.

### styles (view-specific chrome without usePathname)
```css
/* styles/booking.css */
@media (max-width: 759px) {
  html[data-view='detail'] .booking-slot,
  html:not([data-view]):has(main[data-view='detail']) .booking-slot { display: none; }
}
/* styles/layout.css (replaces .hdr[data-hide-mobile='true']) */
@media (max-width: 759px) {
  html[data-view='detail'] .hdr,
  html:not([data-view]):has(main[data-view='detail']) .hdr { display: none; }
}
```
Before hydration the HTML holds exactly one `<main data-view>`, so `:has()` is correct for first paint and for no-JS (verified by the no-JS screenshots). After hydration `html[data-view]` is authoritative. That matters because Activity keeps hidden pages' `<main>` in the DOM.

### app/api/availability/route.ts
`export const dynamic = 'force-dynamic'` was removed and nothing else changed. Under Cache Components a GET handler stops prerendering once it reads `request.url` (route-handlers.md:124), so it is ƒ in the build. The live response carries `cache-control: no-store`.

### Error and not-found files (new)
- `app/global-error.tsx` (`'use client'`, imports `./globals.css`, renders its own `<html>`/`<body>`, the friendly text, the `tel:` link and a `retry()` button). This is the only boundary that catches a failure of the root layout's `getRestaurants`.
- `app/(site)/[lang]/error.tsx` (`'use client'`, `{ error, retry }` props; in 16.3 the prop is `retry`, not `reset`). It catches page-level errors only.
- `app/(site)/[lang]/not-found.tsx` renders inside the chrome for `notFound()` thrown from a page (unknown slug).
- `app/global-not-found.tsx` (imports `./globals.css`, metadata title, own `<html>`) handles unmatched URLs such as `/nothing/here`. It needs `experimental.globalNotFound`.

### e2e/navigation.spec.ts
`page.goto('/')` becomes `page.goto('/en')`, and `url.pathname === '/'` becomes `url.pathname === '/en'`.

## Not needed / confirmed
- Phase 1 already removed SSR clock reads. `BookingBar` calls `now()` only when `booking.date` is set, which is empty at SSR. `ReserveDrawer` returns null while closed, and `Date.now()` is only in callbacks and effects. The build raised no sync-IO error, and `e2e` "home page hydrates without React errors" passes.
- `app/icon.svg` still prerenders at the app root (○ /icon.svg) with no root `app/layout.tsx`.


## Errors hit
- **Not a build failure, but with usePathname() kept in SiteProvider and PageCurtain the build was green and produced empty fallback shells: .next/server/app/en/restaurants/[slug].html was 0 bytes, with the whole document postponed.**
  - cause: In a 'prerender-client' with any fallback route param, usePathname, useParams and useSelectedLayoutSegment(s) call React.use() on a promise that never resolves, so the component becomes a dynamic hole (node_modules/next/dist/server/app-render/dynamic-rendering.js:524-552; called from client/components/navigation.js:125-126,178,195,219). Because SiteProvider wraps the whole body with no Suspense above it, the entire HTML shell for unlisted slugs was empty. The docs say this 'fails the build' (migrating-to-cache-components.md:674), but in 16.3.7 it silently produced an empty shell.
  - fix: Removed usePathname from the shared layout. Each page's <ViewMarker> registers {view, restaurant, root} via useLayoutEffect, and PageCurtain uncovers when pageRoot changes. With the Suspense page variant the [slug] shell then held the full chrome (6.3 KB).
- **Activity regression: on the detail page, clicking the header 'DESTINATIONS' did nothing. waitForURL('/en') timed out after 5 s. The baseline build passed the same test.**
  - cause: With cacheComponents the router keeps the previous route mounted but hidden in <Activity> (cacheComponents.md:44-56). document.getElementById('destinations') found the hidden home section, so scrollToId scrolled to a display:none element instead of navigating home.
  - fix: findSection(id) = pageRoot.querySelector(`[id="${CSS.escape(id)}"]`), using the root registered by the visible page's ViewMarker. The tab-sync effect is scoped the same way, and the pending-scroll effect waits for pageRoot.
- **Activity regression: on a second visit to the detail page the entrance did not replay. The .taya-kicker opacity samples were all 1; on the baseline they were 0,0,0,0.11,…**
  - cause: The preserved DOM keeps data-intro-done, and useIntro filtered those elements out. Effects re-run on show, but there was nothing left to animate.
  - fix: useIntro(active, delay, rootRef) queries inside the page root, and its cleanup (which runs when Activity hides the page) removes data-intro-done so the next show replays.
- **No-JS regression with the spec's pattern (await params inside <Suspense>): the detail page body was blank with JS off. The screenshot was 1280x860 against the expected 1280x2508 (mobile 390x844 against 390x1889).**
  - cause: Even for a slug listed in generateStaticParams and fully prerendered (○), the boundary is emitted as <template id="B:0"> and the content as <div hidden id="S:0">…</div>, which only the inline $RC("B:0","S:0") script reveals. The baseline served it inline. This is how the per-URL prerender keeps the shared App Shell (ISR guide :87).
  - fix: Await params at the top of the page with no Suspense, and add `export const instant = false`. Content is then inline: 0 pending boundaries, no-JS screenshots identical. Trade-off: the /en/restaurants/[slug] App Shell is empty again, so an unlisted slug renders at request time on its first visit. This is a decision for the plan; see spec_deviations.
- **next dev only: 'Route "/[lang]/restaurants/[slug]": Next.js encountered URL data during prerendering' (instant-shell-url-data) and 'encountered runtime data during prerendering' (blocking-prerender-runtime) at page.tsx:33 `await params`.**
  - cause: Dev-time instant-navigation validation flags a params read outside Suspense. It never blocks the build (adopting-partial-prefetching.md:361).
  - fix: `export const instant = false` on the detail page marks the block as intentional (instant.md:66-68). After that the dev log was clean.
- **next dev only: hydration mismatch on /en, 'style={{translate:"0px 6px"}}' on [data-parallax] hero slides.**
  - cause: Chrome's useScrollMotion rAF loop (in the layout) started before the page segment hydrated. Under Cache Components the segments stream and hydrate separately, so it wrote style.translate into page DOM that was not yet hydrated.
  - fix: useScrollMotion(overlayOpen, pageRoot) only queries [data-parallax] and [data-hero-content] inside the registered page root. ViewMarker registers after its subtree hydrates. Dev re-check: no mismatch, 5/5 behaviours.
- **With the DB unreachable, after revalidateTag('restaurants',{expire:0}): /en returned 500 text/plain 'Internal Server Error'; /en/restaurants/taya-house and unknown slugs returned 200 with an empty <html id="__next_error__">. error.tsx never rendered.**
  - cause: getRestaurants() runs in the root layout body, and error.js 'does not wrap the layout.js … above it in the same segment' (error.md:96). Without app/global-error.tsx there is no friendly UI. The /en case is a blocking revalidation of a fully static route that fails with Next's plain 500.
  - fix: Added app/global-error.tsx (error.md:163). Playwright then shows 'We could not load this page… +84 236 651 9999' for the streamed cases. The /en plain-text 500 remains (see risks). An expired or never-cached entry cannot be served while the DB is down.
- **/fr (a disabled locale) returns 404 with Next's bare default UI ('404: This page could not be found.', no styles or chrome), and the response is cached with s-maxage=31536000.**
  - cause: notFound() is thrown by the root layout itself, so neither [lang]/not-found.tsx nor global-not-found applies. global-not-found only covers unmatched routes (not-found.md:49,133).
  - fix: Unfixed in the spike. Options for the plan: have the proxy (which has the active-locale list) rewrite unknown locale prefixes to a 404 route, or accept the bare 404. Either way, the cached 404 must carry the 'locales' tag so that enabling a locale clears it.
- **/en/restaurants/nope initially rendered Next's bare default 404 (no chrome).**
  - cause: There was no segment not-found.tsx.
  - fix: Added app/(site)/[lang]/not-found.tsx. A browser now shows 'Page not found' inside the site chrome with status 404.
- **The first visit to an unlisted slug returns HTTP 200 (with <meta name=robots content=noindex>), and only the second visit returns 404 (x-nextjs-cache HIT, s-maxage 30d). Googlebot's first visit also got 200.**
  - cause: A streamed not-found cannot change the status once headers are sent (loading.md:101-113). After the first visit the ISR upgrade caches the 404 (ISR guide :186-190).
  - fix: Accepted, since it is the documented behaviour. A hard 404 on the first hit needs a proxy check (loading.md:113).
- **The next start server I launched with nohup died silently between tool calls, giving ERR_CONNECTION_REFUSED in Playwright. One earlier run also used the wrong env (paths '/'), which caused 60 s timeouts.**
  - cause: Tooling: the process was attached to a shell that ended, and the test was run without HOME_PATH/DETAIL_PATH. Not an app issue.
  - fix: Ran each server as a tracked background task, stopped it explicitly, and checked with lsof; ports 3266 and 3267 are free at the end.
- **The baseline home screenshot was flaky: 10,895 to 16,503 pixels differed between identical runs.**
  - cause: The hero slide crossfade and zoom inside .hero-slides.
  - fix: Masked .hero-slides in toHaveScreenshot. The baseline was then stable for 3 runs × 4 shots, and the comparison stays strict everywhere else (maxDiffPixelRatio 0).
- **The repo's e2e/navigation.spec.ts failed: waitForURL(pathname === '/') timed out.**
  - cause: Home is now /en; '/' redirects with 307 through proxy.ts.
  - fix: Changed the test to goto('/en') and pathname === '/en'. The repo's E2E suite is now 7/7.

## Recommended task breakdown

Order and dependencies:
- T1 → T2 → T3 → T4 → T5 is the critical path.
- T6 (proxy) and T7 (tables) can run in parallel after T1.
- T8 needs T3, and T7 for the destinations data.

T1. Config and route move. No data changes.
- Moves: app/layout.tsx → app/(site)/[lang]/layout.tsx, app/page.tsx → app/(site)/[lang]/page.tsx, app/taya-house/page.tsx → app/(site)/[lang]/restaurants/[slug]/page.tsx.
- Change '../../globals.css'.
- next.config: cacheComponents, partialPrefetching, experimental.globalNotFound, and a redirects() rule /taya-house → /en/restaurants/taya-house (permanent, 308).
- Delete `export const revalidate` and route.ts `dynamic`.
- Keep app/actions.ts in place. It still calls the uncached listRestaurants, and the locale will be an explicit argument later.
- Add a minimal `/` → `/en` redirect so the app stays usable until T6.
- Update e2e/navigation.spec.ts paths.
- Tests:
  - `npm run build` green with DATABASE_URL set to a _test DB.
  - curl matrix: / 307, /en 200, /taya-house 308, /api/availability 200/400.
  - Repo E2E 7/7.
- Add a visual regression test: Playwright toHaveScreenshot, maxDiffPixelRatio 0, desktop 1280x860 and mobile 390x844, reduced motion, mask .hero-slides. Snapshots come from the pre-change build. The rig is in spike-cc-out/pw.config.ts and visual/pages.spec.ts and can be copied into e2e/.

T2. Read layer and locale skeleton.
- lib/server/content/restaurants.ts: getRestaurants(locale) with 'use cache', cacheLife('max'), cacheTag('restaurants', `i18n:${locale}`).
- lib/cache-tags.ts.
- lib/i18n/locales.ts (constant now; the locales table later). lib/i18n/registry.ts skeleton.
- Layout: `await lang()`, notFound for disabled locales, `<html lang={bcp47}>`, generateStaticParams from ENABLED_LOCALES.
- Tests:
  - The build shows ○ /en.
  - .next/server/app/en.meta x-next-cache-tags contains 'restaurants' and 'i18n:en'.
  - Unit test for isEnabledLocale and bcp47.

T3. ViewMarker and DOM scoping (spec §6.3.8). Biggest risk, so do it before any content work.
- ViewMarker renders `<main data-view>` and registers {view, restaurant, root} in useLayoutEffect.
- SiteProvider: drop usePathname; add page, pageRoot, showPage; findSection; effects keyed on pageRoot.
- PageCurtain keys on pageRoot.
- useIntro and useScrollMotion take the root.
- Move MobileBar into the pages.
- CSS: html[data-view] plus a :has() fallback for the header and the booking-slot.
- Tests: copy spike-cc-out/visual/behaviour.spec.ts (5 cases) and nojs.spec.ts into e2e/:
  - curtain sequence ['true','false']
  - detail header nav → home section at offset 75
  - detail back → #restaurants
  - logo → home top
  - entrance replays on the second visit
  - no-JS home and detail screenshots
- Also load the pages in `next dev` and grep the log for 'hydrated but some attributes' (must be 0).

T4. Detail route.
- generateStaticParams from DETAIL_SLUGS.
- Decide the params pattern (see spec_deviations). The spike's recommendation is a top-level `await params` plus `export const instant = false`.
- notFound for unknown slugs; generateMetadata.
- app/(site)/[lang]/not-found.tsx.
- Remove the 'taya-house' hardcodes in RestaurantCard, SearchOverlay, TayaHero, MoreRestaurants and the SiteProvider default booking via hasDetailPage and the slug prop.
- Tests:
  - /en/restaurants/taya-house ○ and pixel-identical.
  - /en/restaurants/nope: first request 200 + noindex, second 404, rendered inside the chrome.
  - No-JS detail screenshot identical.

T5. Error surfaces (spec §12).
- app/global-error.tsx (required, because the DB read is in the root layout), app/(site)/[lang]/error.tsx (prop `retry`), app/global-not-found.tsx.
- Tests: an integration or E2E job that starts `next start` with DATABASE_URL pointing at a closed port and asserts:
  - prerendered /en is 200 HIT with 12 cards
  - /api/availability is 503
  - an unknown slug in the browser shows the global-error text with the phone number
- A test-only revalidate route can drive the expire paths. Delete it, or guard it with env, before shipping.

T6. proxy.ts (a separate spike exists): matcher, cookie or Accept-Language negotiation, and unknown-locale handling. Consider rejecting unknown locale prefixes to avoid cached bare 404s and cache growth. Unit-test the matcher.

T7. Tables (migrations): locales (seed en enabled, vi disabled), content_strings (empty), destinations (seeded from lib/data.ts). The spike did not exercise these. getRestaurants and the locale check must later read locales via a 'use cache' function tagged 'locales'.

T8. Content refactors from §6.3: slug keys for cuisines and meals, and hero and journey dots computed from counts. These are independent of Cache Components and use the visual tests from T1.

## Risks / open questions
- DECISION NEEDED on detail params (§6.4). Following the spec (await params inside <Suspense>) makes the detail body invisible without JS, even for prerendered slugs: the content ships as <div hidden id=S:0> plus an inline $RC script. Awaiting at the top (the spike's final choice, with instant=false) keeps the HTML inline and no-JS identical, but unlisted slugs (restaurants enabled after deploy in phase 6) get no App Shell and render at request time on first visit. Googlebot executes JS, so the SEO impact is probably small. The MOTION_BOOTSTRAP comment shows the project deliberately supports no-JS visitors.
- DB-down UX after cache expiry. An expired entry (updateTag after an admin save, the daily offers cron's {expire:0}, a crawler's request-time render, or an uncached URL) cannot render while Neon is down. /en (fully static, blocking revalidate) then returns a plain-text 500 'Internal Server Error'. Other routes return an empty __next_error__ document that global-error.tsx fills in only with JS. error.tsx never applies, because the failing read is in the root layout. Mitigations to evaluate: prefer revalidateTag(tag,'max') where read-your-own-write is not needed (stale is kept when regeneration fails: verified as STALE then HIT with old content); move DB reads out of the root layout into page-level components, so error.tsx and catchError can handle them.
- Cached 404s. /fr returned 404 with cache-control s-maxage=31536000, and unknown slugs return 404 HIT with s-maxage 30 days after their first visit. (1) Enabling a locale or detail page later must invalidate these entries, so the locale and slug checks must be 'use cache' reads tagged 'locales' and 'restaurants' that run before notFound(), and updateTag must fire on enable. Not verified, because the spike used constants. (2) Bots requesting random /xx/... or /en/restaurants/<random> create one ISR entry per URL, so storage and write costs grow on Vercel. The proxy could reject unknown locale prefixes.
- notFound() in the root layout (a disabled locale) renders Next's bare unstyled 404, not the site's not-found or global-not-found. A proxy-level 404 or rewrite is the only clean fix found.
- Unlisted slugs are a soft 404 on the first hit (200 + noindex) and a hard 404 afterwards. Acceptable per loading.md:101-113, but analytics and monitoring will see 200s.
- Verified only with self-hosted `next start`. On Vercel, 'use cache' runtime entries are in-memory per instance (use-cache.md:251), and the ISR and CDN behaviour of tag-carrying pages, the cached 404 headers, and the plain 500 on a failed blocking revalidate are unverified. Needs a preview-deploy check once Vercel is connected to GitHub.
- ViewMarker's SSR-visible chrome relies on CSS :has() for first paint (html:not([data-view]):has(main[data-view='detail'])). This is fine in evergreen browsers. Very old Safari (<15.4) would briefly show the header and booking bar on the phone detail view until hydration sets html[data-view].
- Activity side effects not addressed in the spike: useReveal's data-revealed persists, so scroll reveals do not replay when returning to a preserved page (baseline remounted, so they did); per-page component state such as Finder dropdowns or filters is preserved across back and forth. Neither was in today's tests; decide whether either matters.
- useIntro's cleanup also removes data-intro-done when the `motion` level changes (a prefers-reduced-motion toggle), which replays the entrance. Harmless, but it is a behaviour change.
- partialPrefetching is on, but the site navigates with router.push from buttons, not <Link>, so nothing is prefetched. The curtain hides the request. Navigation latency on Vercel (RSC fetch of a static page) was not measured; consider router.prefetch on card hover if needed.
- The spike's proxy only handles '/'. The real matcher, locale negotiation and /admin guard are untested here; another spike covers them.
- The locales, content_strings and destinations tables, the registry skeleton, slug keys for cuisines and meals, and hero and journey-dot counts were NOT implemented in this spike.

## Spec deviations
- §6.4 says 'params được await bên trong <Suspense>'. Implemented and measured, it blanks the detail body for no-JS visitors (screenshot 1280x860 against 1280x2508), because even prerendered slugs stream their content into a hidden segment. Recommend instead: `const { slug } = await params` at the top of the page plus `export const instant = false` (instant.md:66-68), accepting request-time first renders for slugs not in generateStaticParams. If the team prefers the App Shell for later-enabled restaurants, keep Suspense and accept JS-only detail content.
- §6.3.8 describes a self-closing <ViewMarker view restaurant/>. It needs a DOM root to scope queries under Activity, so it was implemented as a wrapper that renders the page's <main data-view> and provides usePageRoot(). A marker alone also cannot fix the SSR-visible chrome: the phone header hide, the booking bar hide and the tab bar variant used to come from usePathname at SSR. MobileBar therefore moved into each page, and the header and booking-bar hides became CSS: html[data-view='detail'] plus an html:not([data-view]):has(main[data-view='detail']) fallback.
- §6.3.8 also lists lib/motion.tsx useScrollMotion only implicitly. It must be scoped too: unscoped, it caused a dev hydration mismatch by writing parallax styles into a page subtree that had not hydrated yet.
- §12 says that on a DB error during a request-time render the guest sees error.tsx with the phone number. That cannot work while the catalogue is read in the root layout (error.md:96), so app/global-error.tsx is required (verified to show the friendly text client-side). Even then, a fully static route whose expired entry is re-rendered while the DB is down returns Next's plain-text 500 with no HTML. Either move DB reads below the root layout or accept this.
- §6.1 says a disabled locale gets notFound(). It does (404), but the UI is Next's bare default 404 and the response is cached for a year. The cached 404 must be tagged 'locales' (or produced by the proxy) so that enabling the locale later takes effect.
- §6.1 /taya-house → 308: implemented with next.config redirects() (permanent: true gives 308), which runs before the proxy (proxy.md:236-244). No proxy code needed.
- §6.2 'route segment configs': `export const revalidate = 3600` (old layout) and `export const dynamic = 'force-dynamic'` (availability route) must be deleted (migrating-to-cache-components.md:76). The replacements are cacheLife('max') in the read function, and nothing for the route, which is dynamic because it reads request.url.

## Doc citations
- node_modules/next/dist/docs/01-app/03-api-reference/04-functions/next-root-params.md:49 (root params work only in Server Components; not in Client Components, Server Actions or Route Handlers)
- node_modules/next/dist/docs/01-app/03-api-reference/04-functions/next-root-params.md:54 (with Cache Components each root param needs generateStaticParams with at least one value)
- node_modules/next/dist/docs/01-app/03-api-reference/04-functions/next-root-params.md:198-200 (only the root params a cached function reads go into its cache key)
- node_modules/next/dist/docs/01-app/03-api-reference/04-functions/next-root-params.md:376-399 (not available in unstable_cache or Server Actions)
- node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/cacheComponents.md:44-56 (Activity keeps previous routes hidden; effects are cleaned up on hide and re-run on show)
- node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/partialPrefetching.md:36 (requires cacheComponents), :45-55 (App Shell per route)
- node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md:76 (dynamic, revalidate and fetchCache exports error)
- node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md:138-140 (force-dynamic is not needed), :226-228 (revalidate becomes cacheLife)
- node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md:86,103 (sync IO such as new Date() still fails the prerender, even with instant=false)
- node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md:568-572 (generateStaticParams must return at least one param), :606-612 (dynamicParams unsupported; use notFound())
- node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md:614-616 (await params inside Suspense), :674-679 (usePathname, useParams and useSelectedLayoutSegment(s) suspend for unknown params)
- node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md:781 (an <html> attribute from runtime data makes the whole subtree request-bound)
- node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md:940-950 (UI state preserved across navigations)
- node_modules/next/dist/docs/01-app/02-guides/incremental-static-regeneration-cache-components.md:20,87,172-190 (App Shell for unlisted params, upgrade after first visit, keep the params read inside the boundary)
- node_modules/next/dist/docs/01-app/02-guides/adopting-partial-prefetching.md:335-361 (URL data outside Suspense is a dev-only insight that never blocks the build)
- node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/instant.md:66-68 (instant=false marks a segment as allowed to block)
- node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md:89 (GET handlers follow the page model under Cache Components), :124 (reading request.url stops prerendering)
- node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md:47-72 (global-not-found + experimental.globalNotFound), :133 (unmatched URLs)
- node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md:101-113 (a streamed notFound returns 200 + noindex; a hard 404 needs a check before streaming, e.g. in proxy)
- node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md:27-30 (the prop is `retry`), :96 (error.js does not wrap its own segment's layout), :163 (global-error for root layout errors)
- node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cacheLife.md:147 (max: stale 5m, revalidate 30d, expire 1y; matches the manifest's 2592000/31536000), :262-270 (prerender thresholds)
- node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache.md:241 (no request APIs inside a cached scope), :251-252 (the in-memory cache does not persist on serverless)
- node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidateTag.md:19-25 ('max' serves stale; {expire:0} forces a blocking re-render)
- node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md:1272-1281 (metadata reading params under Cache Components)
- node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:236-244 (execution order: next.config redirects run before proxy)
- node_modules/next/dist/docs/01-app/03-api-reference/04-functions/catchError.md (a client-side boundary; it cannot catch the root layout's own await)
- node_modules/next/dist/server/app-render/dynamic-rendering.js:524-552 (source: useDynamicRouteParams hangs in prerender-client when fallbackRouteParams.size > 0)
- node_modules/next/dist/client/components/navigation.js:125-126,178-179,195-196,219-220 (usePathname, useParams and useSelectedLayoutSegment(s) call useDynamicRouteParams)
- docs/superpowers/specs/2026-10-01-admin-cms-design.md §6.1, §6.2, §6.3 item 8, §6.4, §12, §14.1 row 2 (repo spec)