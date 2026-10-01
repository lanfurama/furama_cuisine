# Phase 2 client-code map: taya-house hardcodes, slug keys, count-based hero/journey, Activity-scoped DOM queries, nav labels, locale-aware links (Furama Cuisine, Next 16.3.7)

## Verified patterns

# 0. What the spike proved about Activity (Next 16.3.7, cacheComponents + partialPrefetching + generateStaticParams)

Spike dir (scratch only): `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p2-client-spike` (APFS clone, no .env.local, no DB; app/ replaced by a 3-file toy: `(site)/[lang]/layout.tsx` with `lang()` from `next/root-params`, `page.tsx`, `restaurants/[slug]/page.tsx`). `npx next build` was green (`/en` static, `/en/restaurants/taya-house` and `/other` static, `/en/restaurants/[slug]` partial prerender). `next start -p 3217`, driven by Playwright (probe.mjs, probe2.mjs, probe3.mjs in that dir). Port 3217 killed, `lsof -i :3217` empty.

Evidence (all from probes):
- Route navigation keeps previous page DOM: after home -> taya, `document.querySelectorAll('main[data-page-root]')` returned `["taya-house:", "home:none"]`; after -> other: `["other:", "taya-house:none", "home:none"]`. Hidden page = same `<main>` with inline `style.display = 'none'`, still in `document`. Source: `node_modules/next/dist/client/components/layout-router.js:684-688` wraps EVERY segment level in `<Activity mode={stateKey === activeStateKey ? 'visible' : 'hidden'}>` when `__NEXT_CACHE_COMPONENTS`; `:553-558` explains it keeps the last N segments hidden. Docs: `node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md:17` (DOM stays in document, `display: none`), `:19` (max 3 preserved routes), `:355` (hidden content "remains in the document"), `cacheComponents.md:52` (effects cleaned up when hidden, recreated when visible), `preserving-ui-state.md:70` (useLayoutEffect cleanup runs synchronously on hide), `:543` (refs persist).
- The `[lang]` layout segment (SiteProvider, Chrome, Header, overlays) has a constant stateKey, so it is never hidden. Only the page segment (`__PAGE__` home vs `restaurants/[slug]`) swaps. So everything inside Chrome is safe to query at document level; only page content is not.
- BROKEN-BY-ACTIVITY proof: while the detail page was visible, `document.getElementById('restaurants')` (a home-only section) returned the hidden home element (`restaurantsFoundInDoc: true`, its `<main>` display `none`). Today's `scrollToId` (SiteProvider.tsx:287) uses exactly that check to decide whether to `router.push('/')`, so after Phase 2 it would never navigate home and would scroll to a display:none rect (top 0).
- Duplicate ids: up to 3 hidden detail pages each contain `id="dishes"`. Activity happened to render the active one first in document order in the spike, so `getElementById` returned the right one, but that is not a guarantee; scope anyway.
- Layout-effect ordering on navigation (log from a module-level registry): `show home` -> `hide home` -> `show detail:taya-house` -> `hide detail:taya-house` -> `show detail:other` -> `hide detail:other` -> `show detail:taya-house`. i.e. cleanup of the leaving page runs, then setup of the arriving page, every time, including bfcache re-show. A `useLayoutEffect` in a `<ViewMarker>` that sets/clears a module-level `active` page is therefore a reliable "current page" signal.
- `<span hidden>` as the first DOM node of a page (ViewMarker/IntroTrigger anchor) does NOT break Next's scroll-to-top: after scrolling to 1200 on home and clicking a Link, `scrollY` was 0 (`layout-router.js:70-84` `shouldSkipElement` skips zero-rect nodes and uses the next sibling). Also back-navigation showed scrollY 0 (no restore), so the manual `window.scrollTo(0,0)` effect at SiteProvider.tsx:515-517 is redundant and can be deleted.
- Page-owned `<style>` with ref-callback cleanup (docs pattern `preserving-ui-state.md:289-300`) works under Activity AND is SSR-correct: SSR HTML contains the `<style>`; detail visible -> `nav` background red; navigate home (detail hidden) -> transparent (media='not all'); navigate back -> red again.
- `usePathname()` in a shared client layout is what the spec wants gone (`usePathname` doc `01-app/03-api-reference/04-functions/use-pathname.md:70-79`: suspends for params not covered by generateStaticParams; build fails without Suspense). The proposal below removes both usages (SiteProvider.tsx:3,135 and PageCurtain.tsx:4,68) so no Suspense is needed.

# 1. Inventory of every special case (re-located on main@537b7a9)

taya-house / DETAIL_PATH:
- `components/site/SiteProvider.tsx:39` `DETAIL_PATH`; `:136` `view = pathname === DETAIL_PATH`; `:154` default `booking.restaurant: 'taya-house'`; `:312` `navigate()` pushes DETAIL_PATH or '/'; `:363-367` `openRestaurant` `r.id === 'taya-house'`.
- `components/home/RestaurantCard.tsx:15` `isDetailLink`, `:36` tag text.
- `components/overlays/SearchOverlay.tsx:95` `r.id === 'taya-house' ? 'View' : 'Reserve'`.
- `components/site/MobileBar.tsx:23-24` `setBooking/openReserve({restaurant:'taya-house'})`, `:9` `view === 'detail'`, `:12-13` CALL/MAP = resort constants.
- `components/detail/TayaHero.tsx:51` `openReserve({ restaurant: 'taya-house' })`; `:55,:58` resort phone/map; content strings `:27-45,72,84-90,99-101` are Taya copy (stay as a constant map until phase 6).
- `components/detail/MoreRestaurants.tsx:12` `r.dest === 'resort' && r.id !== 'taya-house'` and `:19` hardcoded "More at Furama Resort Danang".
- `app/taya-house/page.tsx` (whole file; also metadata). `app/layout.tsx` is deleted/moved (see section 8).
- Tests/e2e referencing the URL: `e2e/navigation.spec.ts:12` (`**/taya-house`), `:16` (`pathname === '/'`), `e2e/smoke.spec.ts:8` (`goto('/')`).
- Data-level (legitimate, keep): `lib/data.ts:119` OFFERS restaurant id, unit-test fixtures, seed SQL.

# 2. Where slug / has_detail_page live in phase 2

Put them on the `Restaurant` type so no component imports a constant; the read layer fills them from code constants. Phase 6 replaces only the read layer (DB columns).

`lib/data.ts`
```ts
export type Restaurant = {
  id: string;
  /** URL segment of /[lang]/restaurants/[slug]. Phase 2: = id. Phase 6: restaurants.slug. */
  slug: string;
  /** Phase 2: constant below. Phase 6: restaurants.has_detail_page. */
  hasDetailPage: boolean;
  name: string;
  type: string;
  /** Cuisine SLUGS (see section 3). */
  cuisines: string[];
  dest: DestKey;
  meals: Meal[];
  slotCapacity: number;
};

/** Phase 2 stand-ins for restaurants.has_detail_page. */
export const DETAIL_PAGE_IDS: ReadonlySet<string> = new Set(['taya-house']);
/** Phase 2 stand-in for site_settings.default_restaurant_id (phase 6). */
export const DEFAULT_RESTAURANT_ID = 'taya-house';

/** Content of the shared detail page until phase 6 reads it from the DB. */
export const DETAIL_CONTENT: Record<string, { kicker: string; heroImage: string; story: string; label: string }> = {
  'taya-house': {
    kicker: 'A Wellness Dining Home · Furama Resort Danang',
    label: 'Brand Story',
    heroImage: '/assets/taya-hero.jpg',
    story: 'Beneath the Lagoon Garden, the resort’s “Green Oasis in the Heart of the City” tells a journey from Mường Khụ, a land of stones, to Danang by the sea — with cooking classes led by Cơ Tu chef A Rất Thị Hép.',
  },
};
```
`db/queries.ts` `listRestaurants()` (`:17-32`) becomes the future read-layer seam:
```ts
import { DETAIL_PAGE_IDS, cuisineSlug } from '@/lib/data';
return rows.map((r) => ({
  id: r.id, slug: r.id, hasDetailPage: DETAIL_PAGE_IDS.has(r.id),
  name: r.name, type: r.type, dest: r.destination as DestKey,
  cuisines: r.cuisines.map(cuisineSlug),   // label -> slug, see section 3
  meals: r.meals as Meal[], slotCapacity: r.slot_capacity,
}));
```
Route `app/(site)/[lang]/restaurants/[slug]/page.tsx` (server): `generateStaticParams = () => [...DETAIL_PAGE_IDS].map((slug) => ({ slug }))`; inside `<Suspense>` `const { slug } = await params; const r = restaurants.find(x => x.slug === slug); if (!r?.hasDetailPage) notFound();` then render
```tsx
<main data-page-root>
  <ViewMarker view="detail" restaurant={r.id} />
  <IntroTrigger />
  <DetailPhoneStyles />          {/* section 4, replaces data-view / data-hide-mobile */}
  <RestaurantHero restaurant={r} />   {/* renamed TayaHero */}
  <DetailTabBar restaurant={r} />     {/* page-owned, replaces MobileBar detail branch */}
  <TayaExperiences />                 {/* keeps id="dishes"; content constant until phase 6 */}
  <MoreRestaurants restaurant={r} />
</main>
```
Components after change:
- `RestaurantCard.tsx`: `const isDetailLink = restaurant.hasDetailPage;` (line 15). Nothing else.
- `SearchOverlay.tsx:95`: `{r.hasDetailPage ? 'View' : 'Reserve'} →`.
- `MoreRestaurants({restaurant})`: `const others = restaurants.filter((r) => r.dest === restaurant.dest && r.id !== restaurant.id);` heading `More at ${DESTS[restaurant.dest]}`; render `null` if `others.length === 0` (spec 6.4).
- `RestaurantHero({restaurant})` (TayaHero.tsx): `openReserve({ restaurant: restaurant.id })` (line 51), title `restaurant.name` (lines 33,89), kicker/story/image from `DETAIL_CONTENT[restaurant.slug]`, CALL/MAP from `contactFor(restaurant.dest)`:
```ts
// lib/data.ts
export const contactFor = (dest: DestKey) =>
  dest === 'resort' ? { tel: CONTACT.resortPhone, map: CONTACT.map }
  : dest === 'dining-house' ? { tel: CONTACT.diningHousePhone, map: null }
  : { tel: null, map: null };           // hide buttons when null (spec 6.4)
```
- `SiteProvider.openRestaurant` (replaces `:361-372`; `navigate` and `view` are deleted from the context):
```ts
const openRestaurant = useCallback((r: Restaurant) => {
  if (r.hasDetailPage) {
    setBooking({ restaurant: r.id });
    setOverlay(null); setOpenDropdown(null);
    coverThen(() => router.push(restaurantHref(locale, r.slug)));
  } else {
    openReserve({ restaurant: r.id });
  }
}, [locale, openReserve, router, setBooking]);
```
- Default restaurant (`:152-158`): SiteProvider takes a `defaultRestaurantId` prop (layout passes `DEFAULT_RESTAURANT_ID` now, `site_settings.default_restaurant_id ?? first bookable` in phase 6):
```ts
const first = restaurants.find((r) => r.id === defaultRestaurantId) ?? restaurants[0];
const [booking, setBookingState] = useState<Booking>({ destination: first?.dest ?? 'resort', restaurant: first?.id ?? '', date: '', time: '19:00', guests: 2 });
```
- `/taya-house` redirect: `next.config.ts` `async redirects() { return [{ source: '/taya-house', destination: '/en/restaurants/taya-house', permanent: true }] }` (permanent = 308) per research doc (redirects run before proxy). Not client code but required for acceptance.

# 3. Labels used as keys -> slug keys (decision: NO DB migration in phase 2)

Cuisines: `restaurants.cuisines text[]` holds labels (`db/migrations/002_seed_restaurants.sql:6-17`; 8 distinct: Vietnamese, Italian, Thai, Japanese, Steak & Grill, Hotpot, International, Café & Lounge; all exist in `CUISINES` `lib/data.ts:20-29`). Decision: map label -> slug in the read layer only. Reasons: (a) 002 is re-runnable (`ON CONFLICT DO UPDATE`) and a data-rewriting migration would fight it on a fresh DB; (b) the column is dropped in phase 10 and replaced by `restaurant_cuisines(cuisine_id = slug)` in phase 6, so any phase-2 rewrite is throwaway; (c) `restaurants.cuisines` stays the legacy column the old booking code does not read anyway. Guard it with a test so a new label cannot silently slip through.
```ts
// lib/data.ts
const SLUG_BY_LABEL = new Map(CUISINES.map(([label, slug]) => [label, slug]));
const LABEL_BY_SLUG = new Map(CUISINES.map(([label, slug]) => [slug, label]));
export const cuisineSlug = (label: string) => {
  const s = SLUG_BY_LABEL.get(label);
  if (!s) throw new Error(`Unknown cuisine label in restaurants.cuisines: ${label}`);
  return s;
};
export const cuisineLabel = (slug: string) => LABEL_BY_SLUG.get(slug) ?? slug;
```
Add to `test/integration/catalogue.test.ts`: every `restaurants[*].cuisines` element is in `CUISINES` slugs.

Consumers:
- `Cuisines.tsx:40` `selected={filter.cuisine === slug}`, `:41` `onPick={() => pickCuisine(slug)}`.
- `Finder.tsx:9` `cuisineOptions`: `...CUISINES.map(([label, slug]) => ({ value: slug, label }))` (used by FinderSheet too).
- `SiteProvider.tsx:254` stays `r.cuisines.includes(filter.cuisine)` (now slug vs slug).
- `Restaurants.tsx:19` chip label `cuisineLabel(filter.cuisine)`; `:22` `MEAL_LABELS[filter.occasion as Meal]`.
- `SearchOverlay.tsx:36` haystack `[r.name, r.type, r.cuisines.map(cuisineLabel).join(' '), DESTS[r.dest]]` (label, folded by `fold`). `:63-66` chips keep label (query is free text).
Meals: keep the enum strings `'Breakfast'|'Lunch'|'Dinner'|'Drinks'` AS the key (spec 5.2 `service_periods.meal` stores them), and separate display labels:
```ts
export const MEAL_LABELS: Record<Meal, string> = { Breakfast: 'Breakfast', Lunch: 'Lunch', Dinner: 'Dinner', Drinks: 'Drinks' }; // phase 7: registry keys meal.<key>
```
Use at `Finder.tsx:14` (`label: MEAL_LABELS[m]`, value stays `m`), `BookingBar.tsx:40` (`: MEAL_LABELS[g.meal]`), `ReserveDrawer.tsx:191` (`{MEAL_LABELS[g.meal]}`). `SiteProvider.tsx:256` unchanged. Destinations already keyed (`DestKey`).

# 4. Hidden pages: ViewMarker, page-scoped DOM, SSR-correct page chrome

New dependency-free module `lib/page-root.ts` (no React, avoids import cycle with motion.tsx):
```ts
export type PageView = 'home' | 'detail';
export type PageInfo = { view: PageView; restaurant: string | null; root: HTMLElement };
let active: PageInfo | null = null;
let pendingScroll: string | null = null;
export const activePage = () => active;
export const setActivePage = (p: PageInfo | null) => { active = p; };
export const queryPage = <T extends Element = HTMLElement>(sel: string) => active?.root.querySelector<T>(sel) ?? null;
export const requestScroll = (id: string) => { pendingScroll = id; };
export const takeScroll = () => { const id = pendingScroll; pendingScroll = null; return id; };
export function scrollToSection(id: string) {
  const el = queryPage(`#${CSS.escape(id)}`);
  if (!el) return;
  const offset = window.innerWidth < 1080 ? 63 : 75;
  window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - offset), behavior: 'smooth' });
}
```
`components/site/ViewMarker.tsx` (verified pattern, spike used the same body):
```tsx
'use client';
import { useLayoutEffect, useRef } from 'react';
import { setActivePage, activePage, takeScroll, scrollToSection, type PageView } from '@/lib/page-root';
import { uncover } from '@/components/site/PageCurtain';

export function ViewMarker({ view, restaurant = null }: { view: PageView; restaurant?: string | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const root = ref.current?.closest<HTMLElement>('[data-page-root]');
    if (!root) return;
    const me = { view, restaurant, root };
    setActivePage(me);
    uncover();                                   // no-op unless the curtain is covering
    const id = takeScroll();
    const frame = id ? requestAnimationFrame(() => scrollToSection(id)) : 0;
    return () => { cancelAnimationFrame(frame); if (activePage() === me) setActivePage(null); };
  }, [view, restaurant]);
  return <span hidden ref={ref} data-view-marker="" />;
}
```
Each page: `<main data-page-root>` + `<ViewMarker .../>` + `<IntroTrigger/>` as first children. (Spec writes ViewMarker self-closing; this keeps that.)

A. `lib/motion.tsx` query changes (line numbers on main):
- `:235` `useIntro`: `document.querySelectorAll('[data-intro]')` -> scoped to the page that owns the trigger. New signature `useIntro(anchor: RefObject<HTMLElement | null>, baseDelay = 0)`:
```ts
useEffect(() => {
  const root = anchor.current?.closest<HTMLElement>('[data-page-root]');
  if (!root) return;
  const els = Array.from(root.querySelectorAll<HTMLElement>('[data-intro]')).filter((el) => !el.hasAttribute('data-intro-done'));
  if (!els.length) return;
  const timer = window.setTimeout(/* unchanged animation body */, 30);
  return () => window.clearTimeout(timer);
}, [anchor, baseDelay, motion]);
// replay on every re-show (bfcache keeps data-intro-done): clear flags when Activity hides the page
useLayoutEffect(() => () => {
  anchor.current?.closest('[data-page-root]')?.querySelectorAll('[data-intro-done]').forEach((el) => el.removeAttribute('data-intro-done'));
}, [anchor]);
```
`IntroTrigger.tsx`: `const ref = useRef<HTMLSpanElement>(null); useIntro(ref); return <span hidden ref={ref} />;` (Without the clear-on-hide effect, going home -> detail -> home would NOT replay because Activity keeps `data-intro-done`; the existing e2e `navigation.spec.ts` passes trivially for the same reason, since the hero is simply still visible. Strengthen the test to assert an animation actually runs, e.g. `page.evaluate(() => document.querySelector('.hero-kicker').getAnimations().length)` right after returning.)
- `:285` `[data-header]` -> KEEP document-level (Header lives in the persistent layout).
- `:290` `[data-parallax]` -> `const root = activePage()?.root; root?.querySelectorAll(...)` (import `activePage` from `@/lib/page-root`; computed once per frame before the loops; skip block if no root).
- `:302` `document.querySelector('[data-hero-content]')` -> `root?.querySelector(...)`.
- `:335` `animateSelector` (overlays) -> KEEP (overlays live in Chrome, not in pages).
- `useReveal`/`observe` use refs + one IntersectionObserver: nothing to change; hidden pages do not intersect and re-observe on show (`data-revealed` stays set so no replay).
B. `SiteProvider.tsx` DOM/pathname uses:
- `:3,135-136` drop `usePathname` and `view`. `:273-281 scrollTo` -> `scrollToSection` from page-root.
- `:283-295 scrollToId`:
```ts
const scrollToId = useCallback((id: string) => {
  setOverlay(null); setOpenDropdown(null);
  const page = activePage();
  if (!page?.root.querySelector(`#${CSS.escape(id)}`)) {
    if (page?.view !== 'home') { requestScroll(id); coverThen(() => router.push(homeHref(locale))); }
    return;
  }
  window.setTimeout(() => scrollToSection(id), 30);
}, [locale, router]);
```
- `:297-305` pending-scroll effect keyed on pathname -> delete (ViewMarker's `takeScroll()` does it, only after the new page is visible).
- `:307-315 navigate` -> delete. `:317-321 goHomeTop`: `if (activePage()?.view !== 'home') coverThen(() => router.push(homeHref(locale))); else window.scrollTo({top:0,behavior:'smooth'})`. `:323-327 goBackToRestaurants`: `requestScroll('restaurants'); setOverlay(null); coverThen(() => router.push(homeHref(locale)))`.
- `:466-485` sync effect: keep ONLY `setScrolled(window.scrollY > 40)` with deps `[]`; remove the `getElementById('restaurants'|'destinations')` tab logic and the `tab` state. Move tab logic into the page-owned `HomeTabBar` (below).
- `:515-517` `window.scrollTo(0,0)` on pathname -> delete (verified Next resets scroll).
- `:519-527` hero autoplay -> moves into Hero (below), removing `slide/goSlide` from the context (only Hero uses them, grep-verified).
- Context exports to delete: `view`, `tab`, `slide`, `goSlide`, `navigate`. Add `locale`.
C. `PageCurtain.tsx`: remove `usePathname` (`:4,68`), the `first` ref and the pathname effect (`:70-79`); `uncover()` becomes exported and guarded:
```ts
export function uncover() {
  if (!curtain || !busy) return;      // was: unconditional
  ...rest unchanged
}
```
and in `coverThen` add a safety so a route that never mounts a ViewMarker cannot leave the curtain up: after `swap()` in `run`, `window.setTimeout(uncover, 4000)`.
D. Page-owned chrome (SSR-correct and auto-hidden by Activity; replaces `view`/`data-view`/`data-hide-mobile`):
- `Chrome.tsx:23,36-38`: `<div className="booking-slot"><BookingBar /></div>` (drop `data-view`); `:25` `<MobileBar />` deleted from Chrome.
- `MobileBar.tsx` splits into `HomeTabBar` (home branch, owns the tab state + scroll listener, rendered in `app/(site)/[lang]/page.tsx`) and `DetailTabBar({restaurant})` (detail branch, rendered in the detail page). `position: fixed` inside `<main>` is fine (no transformed ancestor: `.page` only has relative/overflow-x:clip, `styles/home.css:1-6`). `HomeTabBar` local state:
```tsx
const { overlay, openReserve, scrollToId, close } = useSite();
const [tab, setTab] = useState<'explore' | 'restaurants'>('explore');
useEffect(() => {                       // effect is cleaned up when the home page is hidden
  const sync = () => {
    const vh = window.innerHeight || 800;
    const r = queryPage('#restaurants'), d = queryPage('#destinations');
    setTab(r && d && r.getBoundingClientRect().top < vh * 0.55 && d.getBoundingClientRect().top > vh * 0.55 ? 'restaurants' : 'explore');
  };
  sync(); window.addEventListener('scroll', sync, { passive: true });
  return () => window.removeEventListener('scroll', sync);
}, []);
const active = overlay === 'drawer' ? 'reserve' : tab;
```
(the `queryPage` relies on ViewMarker having registered; ViewMarker's layout effect runs before this passive effect, same commit.) `DetailTabBar({restaurant})`: `setBooking({restaurant: restaurant.id}); openReserve({restaurant: restaurant.id})`, CALL/MAP from `contactFor(restaurant.dest)` and render only the buttons that exist; use `style={{gridTemplateColumns: \`repeat(${n}, minmax(0,1fr))\`}}` for the column count (spec 6.4). `openMenuPdf` stays exported from MobileBar.tsx (or move to lib).
- Header hide-on-phone and booking-slot hide on phone for the detail page become one page-owned style (verified under Activity + SSR). `components/detail/DetailPhoneStyles.tsx`:
```tsx
'use client';
export function DetailPhoneStyles() {
  return (
    <style ref={(el) => { if (el) el.media = ''; return () => { if (el) el.media = 'not all'; }; }}>
      {`@media (max-width: 759px) { .hdr[data-header], .booking-slot { display: none; } }`}
    </style>
  );
}
```
Then delete `styles/layout.css:68-73` (`.hdr[data-hide-mobile]`) and `styles/booking.css:10-15` (`.booking-slot[data-view='detail']`), and `Header.tsx:13,28-29,37,109` (`view`, `hideOnMobile`, `data-hide-mobile`). Selector `.hdr[data-header]` (0,2,0) in a later `<style>` beats the base `.hdr` display rules; check `.hdr-compact` (`layout.css:60-67`) visually. Fallback if this is rejected: keep `view` as React state set by ViewMarker (works, but SSR/first paint of a detail page on a phone shows header + booking bar until hydration).

Document-level query inventory (final): CHANGE `lib/motion.tsx:235,290,302`; `SiteProvider.tsx:274,287,472,473`; `PageCurtain.tsx` (pathname). KEEP `lib/motion.tsx:285,335`, `SiteProvider.tsx:496-504` (global key/click listeners), `:509` (documentElement overflow), `MobileBar.tsx:40,57` (window.scrollTo/open), `app/layout.tsx:49` bootstrap (moves with layout). `Experiences.tsx:41` `<a href="#experiences">` is a native hash link to a home-only id: fine. Tests: use `getByRole`/`.filter({ visible: true })` when locating elements that may also exist hidden in another page (`preserving-ui-state.md:361-389`); `.rcard` count assertions on home must run on the visible page (`toHaveCount(12)` still holds on a fresh `/en` load; after navigating away and back, hidden copies are the same elements so the count is unchanged, but add `.filter({visible:true})` anyway).

# 5. Counts instead of constants

`Hero.tsx` (slide state and autoplay move local; slides array length drives everything; `HERO_SLIDES` becomes a prop later):
```tsx
export function Hero() {
  const { open, overlay, scrollToId } = useSite();
  const [slide, setSlide] = useState(0);
  const count = HERO_SLIDES.length;
  useEffect(() => {                    // cleaned up automatically when the home page is hidden
    if (overlay || count < 2 || !readMotionLevel()) return;
    const timer = window.setInterval(() => {
      if (document.hidden || window.innerWidth < 760) return;
      setSlide((s) => (s + 1) % count);
    }, 7000);                           // phase 6: site_settings.hero_autoplay_ms
    return () => window.clearInterval(timer);
  }, [overlay, count]);
  // replace goSlide(i) with setSlide(i); dots map HERO_SLIDES (already count-based at Hero.tsx:95)
```
(replaces `SiteProvider.tsx:519-527` `% 3`; guard `count < 2` hides dots via `{count > 1 && ...}` around `.hero-dots`.)
`Destinations.tsx:29` journey, count-based, plus CSS (spec 6.5 allows 2-5 cards so n = 2..5; for n=4 values are exactly 12.5/37.5/62.5/87.5, so pixel-identical):
```tsx
const n = DESTINATION_CARDS.length;
<div ref={journey} data-reveal="journey" className="journey" aria-hidden="true">
  <div data-jline="1" className="journey-line" style={{ left: `${50 / n}%`, right: `${50 / n}%` }} />
  {DESTINATION_CARDS.map((c, i) => (
    <span key={c.key} data-jdot="1" className="journey-dot" style={{ left: `${((2 * i + 1) / (2 * n)) * 100}%` }} />
  ))}
</div>
```
`styles/home.css:626-627` delete `left: 12.5%; right: 12.5%;` from `.journey-line` (now inline). Note: the dest rail uses `grid-auto-columns: minmax(min(76vw, 300px), 1fr)` (`home.css` ~`.dest-rail`) so dot centers equal card centers only while all n cards fit the shell width at >=1140px (`.journey` is `display:none` below 1140, `home.css:615-621`); n<=5 per spec 6.5, verify n=5 at 1140px in the screenshot pass, otherwise set `.journey` hidden when n>4.

# 6. Nav labels (spec 6.3 item 6)

One title-case label per link; case by CSS. `lib/data.ts:144-151`:
```ts
export const NAV_LINKS = [
  { label: 'Restaurants', target: 'restaurants' }, { label: 'Destinations', target: 'destinations' },
  { label: 'Experiences', target: 'experiences' }, { label: 'Offers', target: 'offers' },
  { label: 'Stories', target: 'stories' }, { label: 'About', target: 'heritage' },
];
```
`MenuOverlay.tsx:7-14` delete `MENU_LABELS`; `:52` render `{l.label}`. `Header.tsx:54-56` keeps `{l.label}` with CSS `.hdr-nav .hdr-link { text-transform: uppercase; }` added after `styles/layout.css:136` (letter-spacing already 0.14em; "SEARCH" hardcoded outside `.hdr-nav`, unaffected). Menu overlay items already render title case, no CSS needed. (Registry key `nav.<target>` in phase 6/7.)

# 7. Links and locale

Where the client knows the lang: `app/(site)/[lang]/layout.tsx` (Server Component) does `const locale = await lang()` (`next/root-params`, Server Components only: `next-root-params.md` "Good to know") and passes `locale` and `defaultRestaurantId` to `<SiteProvider>`; `useSite().locale` exposes it. Existing cosmetic `lang: 'EN'|'VI'` state (`SiteProvider.tsx:171`, Header/MenuOverlay language pickers) is unrelated to routing: leave it untouched in phase 2 so `/en` stays visually identical; rename it to avoid confusion if desired; phase 8 replaces it with plain `<a>` links.
`lib/i18n/href.ts` (pure, server+client):
```ts
export const localeHref = (locale: string, path = '/') => `/${locale}${path === '/' ? '' : path}`;
export const homeHref = (locale: string) => localeHref(locale);
export const restaurantHref = (locale: string, slug: string) => localeHref(locale, `/restaurants/${slug}`);
```
Every internal navigation target to change: `Header.tsx:41` and `:113` (`<a href="/" ... onClick preventDefault goHomeTop>`), `Footer.tsx:15` same; `SiteProvider.tsx:289,312,319,326` `router.push('/')`/`DETAIL_PATH`. Replace anchors with `next/link` (clears oxlint `nextjs/no-html-link-for-pages`; keeps the click handler for the curtain/scroll):
```tsx
import Link from 'next/link';
const { locale, goHomeTop } = useSite();
<Link href={homeHref(locale)} className="hdr-logo" onClick={(e) => { e.preventDefault(); goHomeTop(); }}>
```
Not locale-prefixed (leave as is): `/api/availability` fetch (`SiteProvider.tsx:46`; phase 4 adds `&lang=`), `/assets/*` image URLs, `/api/*`, tel:/mailto:/external hrefs (Footer `:27,39,45,49`, MobileBar `:12-13`, TayaHero `:55,58`, Stories, Heritage), `href="#experiences"` (Experiences.tsx:41). e2e/Playwright: `smoke.spec.ts:8` `goto('/en')`; `navigation.spec.ts:7,12,16` -> `goto('/en')`, `waitForURL('**/en/restaurants/taya-house')`, `waitForURL((u) => u.pathname === '/en')`; add a test that `/taya-house` ends at `/en/restaurants/taya-house` and `/` ends at `/en`.

# 8. Other required wiring seen while mapping (client-adjacent)

- `app/layout.tsx` moves to `app/(site)/[lang]/layout.tsx` (root layout: fonts, `globals.css`, MOTION_BOOTSTRAP, `<html lang>`). `export const revalidate = 3600` (`app/layout.tsx:36`) must be deleted (errors with cacheComponents), `await listRestaurants()` (`:52`) must go through a `'use cache'` read function, `/api/availability/route.ts` `dynamic = 'force-dynamic'` must go (research doc section 0). `app/page.tsx` moves to `app/(site)/[lang]/page.tsx` with `<main data-page-root><ViewMarker view="home"/><IntroTrigger/>...`.
- `generateStaticParams` in the `[lang]` layout must return `[{ lang: 'en' }]` at minimum (root params with cacheComponents need at least one value; `next-root-params.md` "Root parameters and generateStaticParams"). Verified in the spike: build green with this shape.


## Errors hit
- **Bash tool refused `cd $S/spike && rm -rf app/* ...` (dangerous rm with a relative glob after cd)**
  - cause: First clone attempt chained cd + rm -rf on a glob; the safety check blocked it before anything ran (no clone was created, main repo untouched, verified with git status).
  - fix: Re-did it with a single absolute-path clone, then `mv app app-orig` instead of deleting, and only `rm -rf` of the explicit absolute `.next` and `.env.local` inside the clone.
- **next build: `Failed to type check` (components/site/SiteProvider.tsx cannot find '@/app/actions', test files cannot find '@/app/api/availability/route')**
  - cause: The spike replaced app/ with a toy tree but tsconfig still type-checks components/ and test/ that import the removed files.
  - fix: Spike-only: `typescript: { ignoreBuildErrors: true }` in the clone's next.config.ts. Not needed in the real implementation.

## Recommended task breakdown

Order matters because tasks 1-4 are behaviour-preserving refactors on the current single-root app (screenshots must stay identical), and only task 5 flips routing and turns on Cache Components.

1. Slug keys + constants (no routing change). Add `slug`, `hasDetailPage` to `Restaurant`, `DETAIL_PAGE_IDS`, `DEFAULT_RESTAURANT_ID`, `cuisineSlug/cuisineLabel`, `MEAL_LABELS`, `contactFor`, `DETAIL_CONTENT`; `listRestaurants` maps label->slug; switch Cuisines/Finder/Restaurants/SearchOverlay/BookingBar/ReserveDrawer to slugs and labels. Remove the `'taya-house'` hardcodes in RestaurantCard, SearchOverlay, MoreRestaurants, openRestaurant, default booking. Tests: vitest for cuisineSlug/Label, extend `test/integration/catalogue.test.ts` (every DB cuisine label maps to a slug, slug/hasDetailPage set); existing Playwright smoke must stay green.
2. Counts, nav labels, DOM-free cleanups (still current routes). Hero local slide state + `count`-based autoplay, journey dots/line by count + delete `home.css:626-627` left/right, single NAV_LINKS (title case) + `.hdr-nav .hdr-link` uppercase CSS, delete MENU_LABELS. Verify with a before/after screenshot of the home page at 1280 and 390 widths (journey dots at 1280 must be pixel-identical).
3. Page-scope infrastructure: `lib/page-root.ts`, `ViewMarker`, scoped `useIntro`/`IntroTrigger`, scoped `useScrollMotion` queries, `PageCurtain` without usePathname (exported guarded `uncover` + 4 s safety), `SiteProvider` scrollToId/goHomeTop/goBackToRestaurants/pending-scroll via page-root, remove `view/tab/slide/navigate/pathname` from context, split MobileBar into HomeTabBar/DetailTabBar, `DetailPhoneStyles`, delete `data-view`/`data-hide-mobile` CSS. Pages (still `app/page.tsx`, `app/taya-house/page.tsx`) get `<main data-page-root>` + ViewMarker + IntroTrigger. Playwright: navigation spec asserts the entrance animation actually replays after home->detail->home (getAnimations), nav button on detail goes home and scrolls, mobile (390px) detail has no header/booking bar and a 4-button tab bar. Unit-test the pure parts (localeHref, page-root helpers with a jsdom-free stub if desired).
4. Locale-aware links + helper: `lib/i18n/href.ts`, `locale` prop on SiteProvider, Header/Footer `<Link>`, router.push targets via helpers. Still testable on a temporary `locale='en'` constant.
5. Routing/structure flip (the risky one, one commit): create `app/(site)/[lang]/layout.tsx` (move app/layout.tsx; `generateStaticParams` -> en; `await lang()`; `<html lang>`), move page.tsx, create `restaurants/[slug]/page.tsx` (Suspense + `await params` + `notFound()` + `generateStaticParams` from DETAIL_PAGE_IDS), delete `app/taya-house`, `redirects()` for `/taya-house` (308), `proxy.ts` (`/` -> `/en`, matcher with a unit test), `global-not-found.tsx` + `experimental.globalNotFound`, `error.tsx`, `cacheComponents: true` + `partialPrefetching: true`, drop `revalidate`/`force-dynamic`, wrap DB reads in a `'use cache'` read layer with tags (skeleton `lib/i18n/registry.ts`). Update e2e URLs. Gate: `npm run build` green, `npm run lint`, `npm test`, `npm run test:e2e` (CI uses `next start`).
6. Tables migration `004`: `locales` (seed en default+enabled, vi disabled), `content_strings` (empty), `destinations` (seed from `lib/data.ts`); all `ON CONFLICT DO NOTHING`; integration test in `test/integration/` and wire into `scripts/reset-db.mjs` flow; read-layer functions for locales/destinations with fall back to constants.
7. Acceptance: Playwright screenshots of `/en` vs current `/` (desktop 1280x860 and mobile 390) with `animations: 'disabled'` and intro curtain suppressed via `sessionStorage 'fc-intro-seen'`; `/taya-house` redirect test; run on a local `*_test` DB only.

## Risks / open questions
- Activity hides route DOM but does NOT hide it from `document.getElementById/querySelector`: any new document-level page query silently targets hidden pages (verified). Rule for the plan: page content is only queried via `queryPage`/`activePage().root` or refs; add an oxlint/grep CI check for `document.getElementById|document.querySelector` outside Chrome/overlay files if desired.
- ViewMarker is client-only state: it never runs during SSR, so nothing visible may depend on `activePage()` during render. That is why MobileBar, booking-slot hide and header hide are moved to page-owned elements/styles. If someone later reads `activePage()` in render it will hydrate-mismatch.
- Replaying intro on every re-show relies on clearing `data-intro-done` in a layout-effect cleanup. Under React StrictMode dev double-invoke this clears flags harmlessly; confirm no double animation in dev.
- Curtain: `uncover()` now fires from ViewMarker. If a page streams its ViewMarker inside a Suspense boundary (e.g. detail page `await params` inside Suspense, as spec 6.4 requires), the curtain stays covering until that boundary resolves; the 4 s safety timeout bounds it. Place ViewMarker inside the Suspense body (as in the spike) or in the static shell, and check the felt latency.
- Header-hide/booking-hide via page `<style>` assumes the `.hdr[data-header]` (0,2,0) selector in a later `<style>` outranks base rules, and that React 19.3 ref-callback cleanup runs on Activity hide (verified in the spike with a simple rule). Confirm `.hdr-compact` and `.hdr-full` rules visually at 390px and 760-1079px.
- Next resets scroll to top on navigation and does not restore on back (verified) so deleting the manual scrollTo is safe, but this is Next's behaviour, not ours; pin it with an e2e test.
- Journey dots assume all n destination cards fit the shell at >=1140px; spec allows up to 5 (6.5). Check n=5; may need to hide the journey line above 4 cards or change `.dest-rail` to equal-width columns.
- `cuisineSlug` throws on an unknown label: a DB row edited by hand with a new label would 500 the whole site. Alternative is slugify-with-fallback and a test; I chose fail-fast + integration test because phase 6 replaces the column. Decide.
- `tab`/`slide` removal changes the `useSite()` public shape; any code or tests I did not grep (docs/design-src excluded) would break. Grep showed only Header/MobileBar/Chrome/Hero use them.
- Language state: SiteProvider `lang: 'EN'|'VI'` and the Header/Menu pickers stay a cosmetic no-op in phase 2 to keep `/en` identical; spec 6.1 says the real switcher is a plain link added in phase 8. Confirm that is acceptable (vs hiding VI).
- `redirects()` for `/taya-house` vs a proxy rule: research doc says `redirects()` runs before proxy; I did not verify this behaviour in the spike (only the client mechanics were spiked). `next.config` redirects also apply to `next start`/CI.

## Spec deviations
- Spec 6.3 item 8 allows keeping `usePathname` wrapped in Suspense where still needed; this proposal removes both uses entirely (SiteProvider.tsx:135, PageCurtain.tsx:68), so no Suspense is needed.
- Spec writes `<ViewMarker view=… restaurant=…/>` self-closing and implies it drives `view` state. Implemented as a self-closing marker that registers the page root in a module-level registry (not React state) because render-affecting state set from an effect is not SSR-correct (first paint of a detail page on a phone would show the home variant). Visible per-page differences (mobile tab bar, header/booking hide on phone) move into page-owned components/styles instead.
- Spec 6.3 item 3 says hero slide count and journey dots by real counts; autoplay timer and `slide` state move from SiteProvider into Hero (not stated in the spec) so the interval is automatically cleaned up when Activity hides the home page.
- Spec 6.3 item 2 says filter by 'slug or key'. Cuisines get slug keys via a read-layer label->slug map with no DB change in phase 2 (spec 5.2 adds `cuisines(id=slug)` only in phase 6); meals keep the existing enum strings as keys with a separate `MEAL_LABELS` display map, because spec 5.2 stores those exact strings in `service_periods.meal`.
- Spec 6.3 item 1 says the default restaurant comes from `site_settings.default_restaurant_id`; in phase 2 that table does not exist, so it is the constant `DEFAULT_RESTAURANT_ID`, passed as a `defaultRestaurantId` prop so phase 6 only changes the layout.
- Spec 6.3 item 6 says nav label stored once and uppercase via CSS; Header needs a new `.hdr-nav .hdr-link { text-transform: uppercase }` rule (the existing `.hdr-link` has none), while the mobile tab bar labels (hardcoded uppercase in MobileBar) are left as is.

## Doc citations
- node_modules/next/dist/client/components/layout-router.js:553-558 (last N segments kept inside hidden Activity)
- node_modules/next/dist/client/components/layout-router.js:684-688 (<Activity mode visible|hidden> per segment when __NEXT_CACHE_COMPONENTS)
- node_modules/next/dist/client/components/layout-router.js:70-84 (shouldSkipElement skips zero-rect/fixed first nodes in scroll handler)
- node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md:17 (Activity keeps DOM in document, display:none)
- node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md:19 (up to 3 routes preserved)
- node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md:70 (useLayoutEffect cleanup runs synchronously on hide)
- node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md:283-323 (page-level <style> media toggle pattern; :has() warning at 325-351)
- node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md:355-389 (hidden content in DOM; Playwright visibility-aware selectors)
- node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md:476-516,543 (effects cleaned on hide, refs persist)
- node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/cacheComponents.md:44-58 (Navigation with Activity; effects cleaned up and recreated)
- node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/partialPrefetching.md:14,36,45-55 (requires cacheComponents; one App Shell per route)
- node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-pathname.md:70-79 (usePathname may suspend under Cache Components; Suspense needed)
- node_modules/next/dist/docs/01-app/03-api-reference/04-functions/next-root-params.md (lang() Server Components only; generateStaticParams needs >=1 value)
- node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md:47-72 (global-not-found, experimental.globalNotFound)
- docs/superpowers/specs/2026-10-01-admin-cms-design.md section 6.1, 6.3 items 1-3 and 6-8, 6.4, 6.5, 14.1 row 2
- docs/superpowers/research/2026-10-01-admin-cms/next16-i18n-caching-security.md sections 0-1