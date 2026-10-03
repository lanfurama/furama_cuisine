# Phase 6 spike: generic restaurant pages, offers with `offerId`, search and filters from the DB

> Spike report, key `detail-offers` (clone `p6-detail`, DB tag `p6dt`, ports 3240/3241). Topic: restaurant detail pages read from the DB for every restaurant with `has_detail_page`; offers from the DB with date windows and `offerId` on bookings; search and filters from the DB. Result: every gate green; visual 8/8 at `maxDiffPixelRatio 0`, so /en and the Tàya page are pixel-identical; the acceptance test that switches `has_detail_page` on for another restaurant passes.
>
> Where this report and `00-plan-outline.md` disagree, **the outline wins** (its §0 lists every conflict). In particular, the outline:
> - takes migration 008 from the `schema-seed` spike: no `restaurants_sync_destination` trigger (every reader switches to `destination_id` instead, pinned by a guard test); `reservations_offer_id_fkey ON DELETE SET NULL` (this spike: RESTRICT); `valid_until` NULL (this spike: 2026-12-31); the schema spike's decorative set (this spike: cuisine chips only); `url = pathname = /assets/…`;
> - keeps this spike's `offers.restaurant_id ON DELETE RESTRICT`, its generic detail components (`RestaurantHero`, `Highlights`, `MoreRestaurants({slug, destinationName})`, `MobileBar({detail})`), the `_none` placeholder, the `openMenu` fix, the locale check in `generateMetadata`, the server-folded `search` field and the acceptance spec on The Fan;
> - uses the read-path spike's translation SQL (no `is_enabled` filter: phase 8's Draft Mode must render a disabled language) and its site-content shape;
> - makes `offerId` a **soft link**: no `offer_unavailable` code, no drawer offer tag, the "Offer: …" note prefill kept, the offer checked (restaurant, published, window on the booked date) inside the insert's subselect; the staff-email row and the admin "Ưu đãi" row move to phase 7;
> - keeps "Gọi để đặt bàn" as an owner-gated task, with the all-offline drawer message done regardless.

## 0. Where it is

- **Clone:** `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p6-detail`. An APFS clone of HEAD 8fe98f5, with `.env.local` and `.next` removed. Nothing is committed in the clone (working-tree changes, two renames: `TayaHero.tsx → RestaurantHero.tsx`, `TayaExperiences.tsx → Highlights.tsx`).
- **Complete patch** (all 64 files, new files included): `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p6dt-out/p6-detail.patch` (4368 lines, `git diff HEAD -M`).
- **Logs** in the same `p6dt-out/` folder: `g3-*.log` is the final gate, `mut1-*`/`mut2-*` are the mutation runs, `build-base.log`/`test-base.log` are the baseline.
- **Helper scripts:** `scratchpad/p6dt-env.sh` provides the `p6env` wrapper with the phase-5 EXTENDED prefix and `DATABASE_URL=postgres://localhost:5432/furama_cuisine_p6dt_test`. `scratchpad/p6dt-gate.sh <tag>` runs the full gate: typecheck → lint → unit+integration (`TEST_DB_TAG=p6dt`) → reset → build → check-prerender → E2E on 3240 → visual on 3241.

## 1. Final gate numbers (g3)

| Check | Baseline at 8fe98f5 (measured in the clone) | After the spike |
|---|---|---|
| typecheck | ok | ok |
| lint | exit 0, 19 warnings | exit 0, **19 warnings** (TayaHero's `no-img-element` warning moved to RestaurantHero) |
| unit + integration | 68 files, 906 tests | **71 files, 946 tests** |
| build + `scripts/check-prerender.mjs` | ok | ok, with new tags, the offers lifetime and the cron route |
| E2E (`--retries=0`) | 151 + 1 skipped | **161 passed + 1 skipped** (botid) |
| visual (`maxDiffPixelRatio 0`, never `--update-snapshots`) | 8 passed | **8 passed** |

### Mutation (RED) proofs

- **mut1.** Dropping `TAGS.restaurants` from `getRestaurantDetail` makes `restaurant-pages.serial.spec.ts` fail. The tab title stays "Page not found — Furama Cuisine": the cached `null` keeps the 404 after the admin save. The restaurants tag on the detail reader is load-bearing.
- **mut2.** Restoring `window.open(url,'_blank','noopener')` makes `restaurant-page.spec.ts` fail with "Expected: 0 / Received: 763", the page scroll position (error 4 below).

## 2. Architecture verified

### 2.1 Migration `db/migrations/008_content_restaurants_offers.sql` (spike version; the outline uses the schema spike's `008_content.sql`)

One transaction, expand only, seeds with `ON CONFLICT DO NOTHING` or `NOT EXISTS`. Seeds copied byte for byte from `lib/data.ts` and the components (all sources are NFC).

- **media:** uuid; `storage` static|blob; `url` UNIQUE; `pathname`; `content_type`; `width`/`height`/`bytes`; `blur_data_url`; `is_decorative`; `deleted_at`. CHECKs `media_url_by_storage` (static: `^/assets/…` with `pathname = substr(url,2)`; blob: `^https://`) and `media_size_by_type` (a PDF has no size, an image has one). Seeded with all 39 `/assets/*.jpg` files, sizes taken with `sips`; `cuisine-*` files are `is_decorative`.
- **media_i18n:** seeded with the alt text the code hard-coded (card alt = name, the Tàya portrait and its 4 highlight alts).
- **destinations:** `card_image_id` filled and `destinations_card_image_fk` added (phase 2 left it open).
- **destination_i18n:** name, `card_title_1/2`, `card_blurb_1/2`, `address`, from DESTS, DESTINATION_CARDS and the footer.
- **cuisines / cuisine_i18n:** 8 rows in CUISINES order, `sort_order` 10..80, `image_id` = `cuisine-<slug>.jpg`.
- **restaurants** (expand): `slug` (CHECK, UNIQUE, NOT NULL, seeded = id), `destination_id` (FK, NOT NULL, seeded = destination), `card_image_id`, `detail_image_id`, `og_image_id`, `phone_e164`/`phone_display` (pair CHECK), `map_url` (https), `has_detail_page` (true for taya-house only), `is_published`, `archived_at`, `updated_at`/`updated_by`. CHECK `restaurants_detail_needs_image`: `NOT has_detail_page OR detail_image_id IS NOT NULL`. **Trigger `restaurants_sync_destination`** keeps `destination` and `destination_id` as one fact until phase 10, because phases 4–5 still read `restaurants.destination` (closures, email routing, booking config).
- **restaurant_i18n:** `type_label`, `detail_kicker`, `story_label`, `story`, `highlights_title`, `menu_pdf_media_id` | `menu_pdf_url` (`restaurant_i18n_one_menu`), `seo_title`, `seo_description`, plus the translation columns. Seeded: EN `type_label` for all 12 (from `restaurants.type`); Tàya's kicker, story, "Brand Story", "At Tàya House", tariff PDF and SEO.
- **restaurant_cuisines:** restaurant side cascades; cuisine side `ON DELETE RESTRICT`. Seeded from the `restaurants.cuisines` labels in their order. **An unknown label raises an exception and rolls back** (phase-2 ruling 9).
- **restaurant_highlights / restaurant_highlight_i18n:** identity ids, seeded through a CTE that joins on `sort_order`; `image_id NOT NULL` (RESTRICT).
- **offers / offer_i18n:** `restaurant_id` (`ON DELETE RESTRICT`), `price_amount numeric(12,2)`, `currency ^[A-Z]{3}$`, `price_basis` plus_plus|net, `valid_from`/`valid_until`, `sort_order`, `is_published`; CHECKs `offers_price_complete`, `offers_window_order`; i18n `title`, `schedule`, `venue_override`. Seeded: the 3 OFFERS, VND, `valid_until 2026-12-31` (from the section lede).
- **reservations:** `reservations_offer_fk` → `offers(id) ON DELETE RESTRICT`, plus a partial index `reservations_offer_idx`.
- **site_settings:** `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, never CREATE: `default_restaurant_id` (FK `ON DELETE SET NULL`, seeded taya-house), `default_occasion` (CHECK on meals, seeded Dinner), `og_image_id` (FK media), `hero_autoplay_ms` (3000–20000, seeded 7000).

`test/integration/migration-008.test.ts` (9 tests) runs on a DB at 007 that already holds a booking: counts; slug, destination and card image of every restaurant; the cuisine mapping keeps the label order; site_settings values; every seeded row `reviewed`/`seed`; RESTRICT stops deleting a file in use; the destination sync trigger; an unknown label (`'Steak and Grill'`) aborts with `restaurants.cuisines holds labels with no cuisine: Steak and Grill`, leaving `offers` uncreated and no `_migrations` row.

### 2.2 Translation-aware SQL helpers (`lib/server/content/i18n-sql.ts`)

```ts
export const localeCtes = (param: string) =>
  `def AS (SELECT code FROM locales WHERE is_default),
   loc AS (SELECT code, serve_machine FROM locales WHERE code = ${param} AND is_enabled)`;
export function i18nJoin(table: string, alias: string, key: (t: string) => string): string {
  const l = `${alias}_l`; const d = `${alias}_d`;
  return `LEFT JOIN ${table} ${l} ON ${key(l)} AND ${l}.locale = loc.code AND (${l}.status = 'reviewed' OR loc.serve_machine)
          LEFT JOIN ${table} ${d} ON ${key(d)} AND ${d}.locale = def.code`;
}
export const pick = (alias: string, column: string) => `COALESCE(NULLIF(${alias}_l.${column}, ''), NULLIF(${alias}_d.${column}, ''))`;
export const pickDefault = (alias: string, column: string) => `NULLIF(${alias}_d.${column}, '')`;
```

Usage: `WITH ${localeCtes('$1')} SELECT … FROM x CROSS JOIN def LEFT JOIN loc ON true ${i18nJoin(...)}`. Implements spec §5.1 item 5: default-language rows always show; rows in another language show when `reviewed`, or when `machine` and `serve_machine` is on; a missing field falls back field by field; a disabled language serves the default language. Integration tests cover reviewed, machine, serve_machine and a disabled language. (Outline: the read-path helpers are used instead; a disabled language is gated by the layout and proxy, and phase 8's Draft Mode must be able to render it.)

### 2.3 Read path and cache tags

| Reader (`'use cache'`) | cacheLife | Tags |
|---|---|---|
| `getCatalogue(locale)` (`lib/server/content/catalogue.ts`, replaces `getRestaurants` and `db/queries.ts`); returns `{restaurants, cuisines, destinations, defaultRestaurantId}`; the guarded layout passes it to SiteProvider | max | restaurants, content:cuisines, content:destinations, content:contact, media, i18n:&lt;locale&gt; |
| `getDetailSlugs()`, for generateStaticParams | max | restaurants |
| `getRestaurantDetail(locale, slug)` | max | restaurants, content:destinations, media, i18n:&lt;locale&gt;, plus `restaurant:<id>` added after the query (`cacheTag` called after `await`) |
| `getOffers(locale)` | **hours** | content:offers, restaurants, i18n:&lt;locale&gt; |

- The `Restaurant` type (in `lib/data.ts`) gains `image: CmsImage | null`; `phone: Phone | null` (the restaurant's own number, else its destination's); `search` (a server-folded string of name + type (locale and EN) + cuisine labels (locale and EN) + destination name (locale and EN)). `dest` is the `destination_id`; `DestKey` is now `string`.
- New types in `lib/data.ts`: `Cuisine`, `Destination`, `OfferCard`, `RestaurantDetail`, `Highlight`, `MenuAction`. They live there so client components can import them; `restaurant-detail.queries.ts` is server-only.
- Removed from `lib/data.ts`: `DETAIL_PAGE_IDS`, `DEFAULT_RESTAURANT_ID`, `DETAIL_SEO`, `CUISINES`, `cuisineSlug`, `cuisineLabel`, `OFFERS`, `TAYA_EXPERIENCES`, `contactFor`, `restaurantImage`, `cuisineImage`, `DEST_KEYS`, `CONTACT.map`, `CONTACT.tariffPdf`. `DESTS` stays, for the Vietnamese admin screens only.
- Build facts: with `cacheLife('hours')` in the home page, `/en` gets `initialRevalidateSeconds 3600`, `initialExpireSeconds 86400` (`cacheLife.md:144`, `262-270`: 'hours' still prerenders). `scripts/check-prerender.mjs` now carries per-route `LIFETIMES` (`'/en': HOURS`) and extended tag lists (layout `TAGS` + `PAGE_TAGS`: `/en` adds `content:offers`, the Tàya page adds `restaurant:taya-house`); `/api/cron/daily` joins `UNCACHED`.

### 2.4 Generic detail page: `app/(site)/[lang]/(guarded)/restaurants/[slug]/page.tsx`

```tsx
const NO_PAGE_SLUG = '_none'; // cannot match restaurants_slug_check
export async function generateStaticParams() {
  const slugs = await getDetailSlugs();
  return (slugs.length > 0 ? slugs : [NO_PAGE_SLUG]).map((slug) => ({ slug }));
}
const NOT_FOUND: Metadata = { title: 'Page not found — Furama Cuisine', robots: { index: false } };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!(await getEnabledLocales()).some((l) => l.code === lang)) return NOT_FOUND; // phase-2 plan risk 7 (/zz/restaurants/taya-house carried Tàya metadata)
  const detail = await getRestaurantDetail(lang, slug);
  if (!detail) return NOT_FOUND;
  return { title: detail.seoTitle ?? `${detail.name} — Furama Cuisine`, description: detail.seoDescription ?? detail.story?.slice(0, 160) ?? undefined };
}
export const instant = false;
export default async function RestaurantPage({ params }: Props) {
  const { lang, slug } = await params;            // awaited at the top on purpose (no-JS, phase 2)
  const detail = await getRestaurantDetail(lang, slug);
  if (!detail) notFound();
  return (
    <ViewMarker view="detail" restaurant={slug}>
      <IntroTrigger />
      <RestaurantHero detail={detail} />
      <Highlights title={detail.highlightsTitle ?? `At ${detail.name}`} highlights={detail.highlights} />
      <MoreRestaurants slug={detail.slug} destinationName={detail.destinationName} />
      <MobileBar detail={detail} />
    </ViewMarker>
  );
}
```

- **Empty `generateStaticParams`.** With Cache Components an empty list is an error (`migrating-to-cache-components.md:570`), so the build uses the `_none` placeholder, which 404s.
- **`dynamicParams` is not available** with Cache Components (`dynamicParams.md:22`; `migrating-to-cache-components.md:606-612`). Unknown slugs are handled by `notFound()`.
- **Components:**
  - `components/detail/RestaurantHero.tsx` (was TayaHero) keeps the markup and `taya-*` classes: kicker, story and story label hidden when null; the story label falls back to "Brand Story"; the portrait stays a raw `<img fetchPriority="high">` from `detail.portrait`; RESERVE only if `bookingEnabled`; CALL from the restaurant, then the destination; MAP from the restaurant's `map_url`, then the destination's; MENU hidden when `menu` is null.
  - `Highlights.tsx` (was TayaExperiences) keeps `id="dishes"` and is hidden at 0 highlights.
  - `MoreRestaurants({slug, destinationName})`: "More at {destinationName}", hidden when the destination has no other restaurant.
  - `MobileBar({detail})`: columns = number of visible buttons out of [reserve, phone, map, menu]; returns null at 0.
- **MENU behaviour** (`detail.menu`): the PDF in the page language, else the EN PDF (`restaurant_i18n.menu_pdf_media_id` URL, or `menu_pdf_url`); else `{kind:'scroll'}` when there are highlights; else null.
- **`openMenu` fix:**

  ```ts
  const w = window.open(menu.url, '_blank');
  if (w) w.opener = null;
  else scrollToHighlights();
  ```

- Tàya's page and the home page stay pixel-identical: visual 8/8 at ratio 0, both with JS and without JS.

### 2.5 Switching `has_detail_page` on (the phase-6 acceptance)

Spec: `e2e/restaurant-pages.serial.spec.ts`. It writes the DB directly: The Fan gets a portrait (`r-the-fan.jpg`), a kicker, an EN story, 2 highlights and `has_detail_page = true`. It then saves the existing admin booking-rules form for the-fan, which calls `updateTag('restaurants')` (phase 6 has no restaurant editor, so this stands in for the phase-7 save). It asserts:
- before the switch, `/en/restaurants/the-fan` says "Page not found" (now cached) and the home card says "Reserve a table →";
- after it: the same URL renders the page, with title "Steakhouse The Fan — Furama Cuisine"; h1, kicker, "Brand Story" and the story; the portrait src is `/assets/r-the-fan.jpg`; CALL is `tel:+84859555759` (the dining house); no MAP; "At Steakhouse The Fan" heads 2 highlight cards; "More at Furama Dining House" lists Phố Cuốn, Thai Siam Kitchen and Hura Izakaya; MENU scrolls to `#dishes` (no PDF); RESERVE opens the drawer on The Fan; the home card says "View restaurant →" and navigates client-side; on a phone, the tab bar shows CALL, MENU, RESERVE as `repeat(3, …)`, while Tàya keeps 4;
- after switching off again (in `finally`), it 404s and the card reserves again.

Mutation mut1 proved that the `restaurants` tag on the detail reader is what clears the cached 404.

### 2.6 Offers

- **`lib/offers.ts` `formatOfferPrice`:** "VND 888,000++ per guest" and "VND 450,000 net per guest". Code and amount joined with a plain space (Intl's currency display uses U+00A0). A whole amount prints with 0 decimals; otherwise the currency's own digits (`resolvedOptions().maximumFractionDigits`). Digits grouped by the page's bcp47 (`vi` gives 888.000). `offerDetail` joins price and schedule with " · ". Unit tests pin the 3 seeded strings.
- **`loadOffers`:** requires `is_published`, a published restaurant, and Da Nang's today (`(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`) inside `[valid_from, valid_until]`, both inclusive. Venue = `venue_override`, else the restaurant name. Offers without a title are skipped.
- The home page (an async server component) does `getOffers((await lang()) ?? DEFAULT_LOCALE)` and passes the result to `<Offers offers>`. The section hides when the list is empty (§6.5).
- **`app/api/cron/daily/route.ts`:** GET only; `cronAuthorized`; `revalidateTag(TAGS.contentOffers, { expire: 0 })` (`revalidateTag.md:25`); `cache-control: no-store`. `vercel.json` adds `{ "path": "/api/cron/daily", "schedule": "5 17 * * *" }`.
- `e2e/offers-expiry.serial.spec.ts`: 401 without the secret or with a wrong one; the offer stays shown until the cron runs; gone after a cron call with the secret; extending `valid_until` and calling the cron brings it back.

### 2.7 `offerId` end to end (this spike's strict version; the outline keeps a soft link)

- **Client:** `openReserve(preset, offer?: BookingOffer)` replaces the old `note` parameter; the note is no longer pre-filled. `SiteProvider` keeps `chosenOffer`; the active offer = `chosenOffer` while `booking.restaurant === chosenOffer.restaurant` (switching away sets it aside, coming back restores it); any non-offer RESERVE clears it, as does closing after done. The submit sends `offerId`. The drawer shows a `.drawer-offer` tag (label "Offer", the title, a × named "Remove the offer {title}"); the done screen adds an "Offer" row.
- **Server:** zod `offerId: z.string().regex(/^[1-9][0-9]{0,17}$/).optional()`, mapped to the new code `offer_unavailable`. In the transaction, after the slot verdict, `offerBookable` runs:

  ```sql
  SELECT 1 FROM offers
   WHERE id = $1::bigint AND restaurant_id = $2 AND is_published
     AND (valid_from IS NULL OR valid_from <= $3::date)
     AND (valid_until IS NULL OR valid_until >= $3::date)
     FOR KEY SHARE
  ```

  A failure returns `offer_unavailable`; a pass inserts `offer_id`. Registry gains `error.offer_unavailable` (screen `ui-text`).
- **Staff side:** `staff.new` email gets `email.staff.new.label_offer` (en "Offer", vi "Ưu đãi") with the default-language offer title (`load.ts` subquery); guest emails do not show the offer. Admin `/admin/reservations/[id]` shows "Ưu đãi" when an offer is set.
- **Tests:** integration (stores `offer_id`; refuses another restaurant's offer, an unknown id, `valid_from` after the date, `valid_until` before the date, an unpublished offer, with nothing inserted; books on the last valid day; the FK refuses deleting an offer that has a booking). E2E `offers.spec.ts`: the cards match the old text; the drawer offer tag survives switching restaurant away and back; × clears it, a plain RESERVE carries none; a real booking on Tàya's last open day stores the offer with an empty note, shows the done row, puts `Ưu đãi\s+Vietnamese Cooking Class` in the logged staff email, and shows it on the admin page.

### 2.8 Search and filters (spec §6.3 items 2 and 9)

- `SearchOverlay` keeps `r.search.includes(fold(query))`. Chips from DB cuisines; meta `${r.type} · ${destName(r.dest)}`; thumbnail `r.image.src`.
- Finder, FinderSheet, Cuisines, Restaurants chips, BookingBar and the drawer read `cuisines`/`destinations`/`destName` from the context. Filter values are cuisine slugs, meal keys and destination ids. `destinationOptions(destinations)` keeps only `kind === 'venue'`.
- E2E (`filters.spec.ts`, +2): "pho cuon" finds Phố Cuốn and "HAI VAN" finds Hải Vân Lounge; "dining house" finds the 4 Dining House restaurants, with meta "Steak & Wine · 3F · Furama Dining House"; "food hall" (a type line) finds Yum Food Village and "hotpot" (a cuisine) finds ChaoShan Hotpot; the Finder with Thai + Lunch + MM Supercenter leaves only Yum Food Village, with chips Thai, Lunch and Furama MM Supercenter.

### 2.9 Default restaurant, group phone and ordering

- `SiteProvider` takes `defaultRestaurantId: string | null` from `site_settings`; null means the first bookable restaurant.
- `groupPhoneSql` prefers the restaurant's own `phone_e164`, then its destination's (via `destination_id`), then the first destination that has one. Emails and the drawer use the same rule.
- `ORDER BY r.sort_order, r.id` tiebreakers (phase-4 deferral) in the booking rules and catalogue loaders.

### 2.10 "Gọi để đặt bàn" (phase-4 risk 8): proposal, implemented and tested (owner must approve; it changes GX-6)

- A card or search result with no page and online booking off: with a number (the restaurant's, else the destination's), the tag reads `Call {display} →` (e.g. "Call +84 236 651 9999 →"), the search action reads "Call →", and a click sets `window.location.href = tel:…`; with no number (the MM restaurants), still inert, `aria-disabled` (GX-6 kept).
- With every restaurant offline, RESERVE opens the drawer on `booking.all_offline` ("Online booking is not available right now. Please call us on {phone} to book a table.", with a tel link to `DEFAULT_PHONE`) and no form. Before, the drawer said "Checking tables…" forever.
- `booking-switch.serial.spec.ts` updated: Hải Vân Lounge now shows the Call tag; Yum Food Village carries the GX-6 inert-card assertions; a new test covers the all-offline drawer.

## 3. Test files added or changed

- **Unit:** `lib/offers.test.ts` (5); `lib/server/booking/input.test.ts` (offerId cases); `lib/server/email/booking/render.test.ts` (staff.new offer row); `lib/data.test.ts` shrunk to the meal labels; fixtures in `lib/booking/client.test.ts`, `drain.test.ts` and `sample.ts`.
- **Integration:** `test/integration/catalogue.test.ts` rewritten (12 tests: order, cuisines vs the old CUISINES, destinations vs the old DESTS, phone fallback, default restaurant, unpublished/archived, booking switch, meals, search fold, and the vi reviewed/machine/disabled cases); `test/integration/content-pages.test.ts` new (11 tests: the Tàya detail equals the old hand-written page, null cases, another restaurant, CALL/MAP priority, MENU vi→en, the portrait CHECK, the 3 offers, the inclusive window, unpublished, venue override and no price, the price and window CHECKs); `test/integration/migration-008.test.ts` new (9); `submit-reservation.test.ts` +3 offer tests.
- **E2E:** new `offers.spec.ts` (3), `restaurant-page.spec.ts` (2), `restaurant-pages.serial.spec.ts` (1), `offers-expiry.serial.spec.ts` (1); changed `filters.spec.ts` (+2), `booking-switch.serial.spec.ts` (+1, assertions changed), `page-scope.spec.ts` (comment only).
- **`playwright.config.ts`:** the `desktop-serial` project gets `workers: 1` (`testProject.workers`, `@playwright/test` 1.63, `types/test.d.ts:723-757`), so serial files run one at a time; each asserts what another changes (the VIEW OFFER count, the catalogue).

## 4. Investigations (empirical)

- **Random slugs (phase-2 ruling 8): confirmed, not fixable with dynamicParams.** Each unknown `/en/restaurants/<x>` first answers 200 with `x-nextjs-postponed: 1` and private no-store; every later request gets a cached 404 with `s-maxage=2592000`. Each slug writes `<x>.html`/`.meta`/`.segments`, about 92 KB on disk locally; the 404 meta carries the `restaurants` tag. Experiment: `await connection()` before `notFound()` made every request 200 + postponed (never a 404 status), and shells were still written; reverted. Options: accept (Vercel purges on deploy; every `updateTag('restaurants')` invalidates them), or a Vercel Firewall / phase-10 rate limit on `/:lang/restaurants/:slug`.
- **Phase-4 residual (guest RSC 404 with x-nextjs-postponed during an admin `updateTag('restaurants')`): reproduced.** 80 client navigations Home↔Tàya while an editor saved the booking rules in a loop (763 saves in 2.2 min, about 6/s): exactly one `404 /en/restaurants/taya-house rsc=1 postponed=1`, one hard reload, server log clean. With `revalidateTag('content:offers',{expire:0})` called every 150 ms during 50 navigations: 0 occurrences. Looks like a framework race in Next 16.3.7 between a postponed-resume RSC request and an invalidated route entry. Recommend accepting it (rare, costs one reload, no data loss) and re-checking on Next ≥16.4.

## 5. Errors hit

| Error | Cause | Fix |
|---|---|---|
| `scripts/check-prerender.mjs`: "/en revalidates after 3600s, expected 2592000s" and "/en expires after 86400s, expected 31536000s" | The home page calls getOffers with cacheLife('hours') (spec §6.2); the shortest cacheLife on a page sets the prerendered route's lifetimes. | check-prerender now has per-route LIFETIMES (`{'/en': HOURS}`, MAX otherwise), the full layout tag list (restaurants, content:cuisines, content:destinations, content:contact, media, i18n:en, locales, content:ui) and PAGE_TAGS (`/en` adds content:offers, the Tàya page adds restaurant:taya-house). /api/cron/daily joins UNCACHED. |
| E2E `page-scope.spec.ts:130` 'navigation still works after the error page replaces a page the curtain was covering' failed: heading 'We could not load this page.' not found (desktop-serial then 'did not run') | The test injects a fault by patching `Array.prototype.find` to throw for predicates whose source contains 'slug'. It relied on TayaHero's `restaurants.find(r => r.slug === slug)`; the new RestaurantHero gets its data from the page. | MoreRestaurants now takes `{slug, destinationName}` and looks up the current restaurant with `restaurants.find((r) => r.slug === slug)`. The test comment now names MoreRestaurants. |
| E2E `restaurant-page.spec.ts`: `popup.url()` was '' instead of the tariff PDF URL | `context.waitForEvent('page')` resolves before the new tab commits its navigation; a PDF response could also make headless Chromium download the file. | `await tab.waitForURL(TARIFF)`, and stub the URL with `context.route` as text/plain, so the real host is never reached. |
| Pre-existing bug: MENU on a restaurant page opened the PDF and also scrolled the page to the highlights (scrollY 763) | `window.open(url, '_blank', 'noopener')` always returns null when the noopener feature is passed (verified in Chromium), so `if (!w) fallback()` always ran. | `openMenu` calls `window.open(url, '_blank')` then `w.opener = null`, falling back only when `w` is null. Covered by restaurant-page.spec.ts; mutation mut2 (old code) fails with Expected 0, Received 763. |
| Experiment: `await connection()` before notFound() for unknown slugs | An attempt to stop unknown slugs creating ISR entries (phase-2 ruling 8). | Reverted: every request became 200 + x-nextjs-postponed and postponed shells were still written. |
| `zsh: command not found: timeout` | macOS has no GNU timeout. | Ran the probe without it (tooling only). |

## 6. Package versions

next 16.3.7, react / react-dom 19.3.0, typescript 7.0.2, pg 8.23.0, zod 4.6.5, @playwright/test 1.63.0 (testProject.workers used), vitest 5.0.3, oxlint 1.86.0, react-email 6.11.0: all unchanged. Node 22.22.0 locally; Postgres 18 on localhost:5432. No package added or removed.

## 7. The spike's recommended task breakdown

Each task ends on the full gate (typecheck, lint at 19 warnings, unit+integration, reset, build, check-prerender, E2E, visual 8/8 at ratio 0).

- **T1.** Migration 008: merge this spike's tables into the schema spike's 008 (media/media_i18n, destination_i18n, cuisines/cuisine_i18n, the restaurants expansion with restaurant_i18n, restaurant_cuisines, restaurant_highlights(_i18n), offers/offer_i18n, the offer FK, site_settings ADD COLUMN IF NOT EXISTS), the unknown-label guard and the `restaurants_sync_destination` trigger; migration-008 test; the Neon pre-flight and post-check SQL.
- **T2.** Translation SQL helpers and the catalogue reader: `i18n-sql.ts`; `catalogue.queries.ts` / `catalogue.ts` replacing `db/queries.ts` and `content/restaurants.ts`; Restaurant fields image, phone, search; types Cuisine and Destination; `DestKey = string`; the guarded layout passes cuisines, destinations and defaultRestaurantId to SiteProvider; Finder, FinderSheet, Cuisines, Restaurants, RestaurantCard image, BookingBar, ReserveDrawer and SearchOverlay; check-prerender layout tags; catalogue.test rewrite and the 2 filters tests.
- **T3.** Generic detail page: `restaurant-detail.queries.ts` / `restaurant-detail.ts` with `restaurant:<id>` added after the query; page with the `_none` placeholder, metadata with the locale check; RestaurantHero, Highlights, MoreRestaurants(slug, destinationName), MobileBar(detail); the openMenu fix; content-pages tests (detail part), restaurant-page.spec.ts and restaurant-pages.serial.spec.ts (the acceptance); desktop-serial workers: 1.
- **T4.** Offers display: lib/offers.ts with tests; offers.queries.ts / offers.ts with cacheLife('hours'); async home page; Offers takes props and hides when empty; /api/cron/daily and vercel.json; check-prerender LIFETIMES and UNCACHED; content-pages offer tests and offers-expiry.serial.spec.ts.
- **T5.** offerId: zod field and FIELD_CODES; create.ts offerBookable (FOR KEY SHARE) and the offer_id insert; code `offer_unavailable` with its registry key; SiteProvider BookingOffer state; drawer offer tag and done row; email label_offer, load.ts subquery and the staff.new row; admin "Ưu đãi" row; tests.
- **T6.** groupPhoneSql restaurant-first and the ORDER BY id tiebreakers; booking-path readers of restaurants.destination stay (the trigger keeps them consistent), optionally switched to destination_id here.
- **T7.** Owner-gated: the risk-8 "Call to book" card/search action and the all-offline drawer (`booking.all_offline`), with the booking-switch.serial update; droppable as a unit.
- **T8.** Docs: README (replace the two `db/queries.ts#listRestaurants` references; the daily cron; the 008 runbook, whose pre-flight `SELECT DISTINCT u FROM restaurants, unnest(cuisines) u` must list only the 8 labels; the ISR random-slug note); ledger rulings.

## 8. Risks and open questions

1. Random /en/restaurants/<x> slugs still create ISR entries (about 92 KB each locally; a 30-day s-maxage 404 from the second request on). dynamicParams is unavailable with Cache Components, and the connection() workaround made things worse. Decide: accept (purged on deploy and on every updateTag('restaurants')), or a Vercel Firewall or phase-10 rate limit on /:lang/restaurants/:slug.
2. The phase-4 residual reproduced: 1 hard reload (RSC 404 with x-nextjs-postponed) in 80 client navigations while an editor saved about 6 times a second with updateTag('restaurants'). A framework race in Next 16.3.7, not app code. Recommend accepting and re-testing on Next ≥16.4.
3. reservations_offer_fk is ON DELETE RESTRICT here: an offer with bookings cannot be deleted, only unpublished. This conflicts with phase-7 acceptance 'sửa rồi xóa một ưu đãi, khôi phục được' when the offer has bookings. The alternative, SET NULL, loses the link on bookings. (Outline: SET NULL, R5.)
4. An offer is validated against the booked date (reserved_on within valid_from..valid_until), not against today. The drawer does not grey out dates outside the offer window, so the guest only learns of it on submit. Option: send validFrom/validUntil to the client and mark those days. (Outline: soft link, never refused.)
5. 'Gọi để đặt bàn' changes the GX-6 behaviour of phase 4 for Hải Vân Lounge (and its serial E2E). On desktop, tel: may do nothing visible. Needs the owner's yes or no.
6. The Offers section lede still hard-codes 'valid until 31 December 2026' (section copy, content_strings in phase 7). It will drift from offers.valid_until once editors change dates.
7. Interface text still in components, to move to the registry in phase 7: 'Brand Story' (default story label), 'At {name}', 'More at {destination}', 'per guest' / '++' / ' net' (lib/offers.ts), 'Call {phone}', 'Offer', 'Remove the offer {title}'.
8. The restaurant portrait stays a raw `<img>` (not CmsImage / next/image) to stay pixel-identical. Spec §6.3 item 7 asks for CmsImage on every image; a later visual-reviewed change is needed, possibly next/image with unoptimized for static media.
9. Only part of site_settings is used here (the catalogue reads default_restaurant_id under content:contact). The phase-5 handoffs are not done here (the read-path spike did them).
10. Booking-path readers (closures scope, loadBookingRules.destinationId, email routing, admin config) still read restaurants.destination here; the trigger keeps it equal to destination_id. (Outline: they switch, no trigger.)
11. A restaurant whose page is switched on after the build is not prerendered: its first visit renders at request time with no App Shell, because params are awaited at the top for no-JS reasons. The first response for an unknown slug is a streamed 200 with noindex and later ones are a 404 (phase-2 deviation 8, unchanged).
12. Search folding uses lib/booking `fold` (Latin diacritics and đ only). ko/zh need nothing extra, but phase 8 should test it. The server-side `search` field adds about 80 bytes per restaurant to the RSC payload.
13. README still references `db/queries.ts#listRestaurants` in 2 places.
14. Migration 008 on Neon: the cuisine-label guard fails, and safely rolls back, if production restaurants.cuisines holds a label outside the 8 seeded ones. Run the pre-flight first.

## 9. Spec deviations proposed by the spike

1. New booking error code `offer_unavailable` (not in spec §10.2), with registry key `error.offer_unavailable` (screen ui-text). (Outline: dropped; soft link.)
2. New registry keys: `booking.all_offline` (screen booking, vars phone) and `email.staff.new.label_offer` (en 'Offer', vi 'Ưu đãi', screen emails). (Outline: `booking.all_offline` kept; the email key moves to phase 7.)
3. Only the staff.new email mentions the offer (and the admin booking page shows an 'Ưu đãi' row, read-only). Guest emails do not. (Outline: phase 7.)
4. reservations_offer_fk is ON DELETE RESTRICT (the spec does not say). offers.restaurant_id is also RESTRICT.
5. An offer's window is checked against the booked date, not the booking time (the spec does not say).
6. The restaurant portrait is a raw `<img>`, not CmsImage (§6.3 item 7), to stay pixel-identical. CSS class names keep the taya-* prefix.
7. A trigger `restaurants_sync_destination` (not in the spec) so restaurants.destination and destination_id cannot drift before phase 10 drops destination. (Outline: not adopted.)
8. The cuisine-label migration raises an exception on an unknown label instead of skipping it (keeps phase 2's 'fail loudly').
9. generateStaticParams returns the placeholder slug '_none' when no restaurant has a page (Cache Components forbids an empty list). dynamicParams is impossible with Cache Components, so unknown slugs still render on request and are cached as 404s.
10. Search text is folded once on the server (Restaurant.search) and covers both the page language and the default one, rather than folding in the browser on every keystroke.
11. site_settings.default_restaurant_id is read under the content:contact tag (spec §6.2 maps site_settings to content:contact).
12. Offers make the whole /en route revalidate hourly (cacheLife('hours') propagates to the page). check-prerender expects 3600/86400 for /en.
13. Out of this spike's scope (left to the schema/read spikes): sections, hero_slides, experiences, stories, nav_items, social_links, the footer and the Destinations section still read lib/data.ts constants here; DESTS stays for the admin.
14. Owner-gated proposal implemented (phase-4 risk 8): an offline card or search result with a number offers 'Call {display}' with a tel: link, and the all-offline drawer shows booking.all_offline. Changes the approved GX-6 behaviour for cards that have a phone; cards with no phone stay inert.
15. MobileBar renders nothing when a page has no buttons. Previously MENU was always shown, so this case never arose.

## 10. User steps

1. Decide on the 'Gọi để đặt bàn' proposal: a restaurant without a page that is switched off for online booking shows 'Call +84 … →' on its card and dials the number; with every restaurant off, RESERVE opens on whom to call. Keep it, or drop the task.
2. Decide whether an offer that already has bookings may be deleted (this spike: no, only hidden), and whether the booking form should grey out dates outside an offer's dates.
3. Before migration 008 runs on Neon (controller's deploy window): run the read-only pre-flight `SELECT DISTINCT u FROM restaurants, unnest(cuisines) u ORDER BY 1` and confirm it lists only Vietnamese, Italian, Thai, Japanese, Steak & Grill, Hotpot, International, Café & Lounge. If any other label appears, the migration stops and rolls back by design.
4. After deploy, Vercel picks up the new daily cron (/api/cron/daily at 17:05 UTC, 00:05 Da Nang) from vercel.json. CRON_SECRET is already set for the outbox cron.
5. Content still owed (spec §15 #17): for each other restaurant that should get a page, a 4:5 portrait, kicker, English story, 2–5 highlights with photos and an optional menu PDF. Until then has_detail_page stays off.
