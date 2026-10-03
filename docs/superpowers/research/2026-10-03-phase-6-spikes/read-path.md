# Phase 6 spike: the guest site reads from the database, pixel-identical

> Spike report, key `read-path` (clone `p6-read`, DB tag `p6rd`, ports 3230–3239). Topic: the guest site reads all content from the DB (cached loaders, tags, cron, offerId), pixel-identical; plus phase-2 ruling 7 (DB down), the phase-4 RSC 404 race, phase-2 ruling 8 and M7, and the site_settings handoff, all measured.
>
> Where this report and `00-plan-outline.md` disagree, **the outline wins** (its §0 lists every conflict). In particular, the outline:
> - takes migration 008 from the `schema-seed` spike (`GENERATED ALWAYS` identities with `OVERRIDING SYSTEM VALUE`, its names, its decorative set, `reservations_offer_id_fkey`), keeping **this** spike's rule that a list is seeded only while it is empty and a translation joins its parent;
> - seeds `offers.valid_until` NULL (this spike: `DATE '2026-12-31'`);
> - adopts this spike's read layer (`sql.ts`, `lib/cache-plan.ts`, `site.ts`/`home.ts`/`restaurants.ts`, one `loadSiteSettings`), its no-`is_enabled` locale CTE, its plain-`<img>` rule, and its phase-5 handoff;
> - takes the detail-page components, the `_none` placeholder, the `openMenu` fix and the server-folded `search` field from the `detail-offers` spike;
> - rules the daily cron to `revalidateTag('content:offers', 'max')` (this spike's recommendation), not `{ expire: 0 }`;
> - keeps `offerId` a soft link, but checks restaurant, publication **and** the offer's window on the booked date in the insert's subselect (this spike checked the restaurant only).

## 0. Where everything is

- **Clone:** `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p6-read`
  - Branch `p6-read`, commit `30ea85b` on `8fe98f5`.
  - The real repo is untouched. Its main has since moved to `4f67931`, a docs-only commit that adds `docs/superpowers/ledgers/2026-10-03-phase-5-ledger.md`; its phase-6 items are the same as in phase 5's `final-deferred.md`.
- **Complete source of truth for every file:** `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p6-read.patch` (`git format-patch`, 77 files, +2987/−649).
- **Logs:** `…/scratchpad/p6rd-logs/`
  - `build-*`, `unit-*`, `e2e-*`, `visual-*`, `lint-*`.
  - `measure-3.log`, `measure-swr*.log`, `race-*.log`.
  - `html-base/` and `html-new/`: normalised server DOM of /en, the detail page and privacy, before and after.
- **Temporary measurement harness (NOT in the patch):**
  - `…/scratchpad/p6rd-logs/measure-specs/`: `zz-p6measure.spec.ts`, `zz-p6swr.spec.ts`, `zz-p6race.spec.ts`, and `route.ts`, a probe that calls `revalidateTag(tag, 'max' | {expire:0})`.
  - `…/scratchpad/p6rd-pgproxy.mjs`: a TCP proxy that makes "DB down" possible for one server without stopping the shared Postgres.
  - `…/scratchpad/p6rd-measure.sh`, `p6rd-race.sh`, `p6rd-e2e.sh`, `p6rd-visual.sh`, `p6rd-env.sh`, `p6rd-normhtml.mjs`.
- **Cleanup:** all local DBs dropped (`furama_cuisine_{,e2e_,migrate_,migrate004..008_}p6rd_test`); ports 3230–3239 free; the baseline clone `p6-read-base` removed.

## 1. Gate (final state; every command with the phase-5 EXTENDED env prefix, DB tag p6rd, ports 3230 E2E / 3231 visual)

| Check | Baseline 8fe98f5 | Final |
|---|---|---|
| typecheck | 0 | 0 |
| lint | exit 0, 19 warnings | exit 0, 19 warnings (`diff` of the warning set is empty) |
| unit + integration (`TEST_DATABASE_URL=…p6rd_test`, `TEST_DB_TAG=p6rd`) | 68 files, 906 tests | **73 files, 951 tests** |
| build + `scripts/check-prerender.mjs` | pass | pass (updated: new tags, /en lifetime, `/api/cron/daily` uncached) |
| E2E `--retries=0` | 151 passed + 1 skipped | **155 passed + 1 skipped** (151 desktop + 4 desktop-serial) |
| visual `maxDiffPixelRatio: 0`, never `--update-snapshots` | 8 passed | **8 passed** (run 5 times on fresh builds; `e2e/__visual__` untouched) |

**Proof that the pixels come from the DB (negative control):** `experience_i18n` 1's title and `restaurant_highlight_i18n` 4's detail were changed in the DB and the app rebuilt. Visual went 6 failed / 2 passed: home ×4, and taya-house desktop ×2 (on the phone the 4th card is outside the rail). Both rows were then restored.

**Normalised server-DOM diff against HEAD** (scripts, links, build hashes and React text separators stripped). Exactly two differences on every page:
1. The header nav labels are stored once ("Restaurants"). The header prints them in capitals through CSS `.hdr-nav .hdr-link{text-transform:uppercase}` (spec §6.3 item 6). The pixels are identical.
2. The Dining House footer link is `tel:+84859555759` (E.164 from `destinations`) instead of `tel:0859555759`. The display "0859 555 759" is unchanged.

**Payload:** HTML/RSC grow by about 1.3–1.6 KB gzipped per page; the chrome's content (cuisines, destinations, nav, socials, sections, settings, card images) is now serialised to SiteProvider.

| Page | HTML (gzip) | RSC |
|---|---|---|
| /en | 11574 → 12908 | 22319 → 29942 |
| /en/restaurants/taya-house | 8741 → 10301 | — |
| /en/privacy | 7214 → 8237 | — |

## 2. Architecture as built

1. **`db/migrations/008_content.sql`** (spike version; the outline takes the schema spike's file instead):
   - **Tables:** `media` (uuid; storage static|blob; partial unique index on url WHERE storage='static'; `is_decorative`; `deleted_at`; RESTRICT from every content FK), `media_i18n`, `destination_i18n` (plus the FK `destinations.card_image_id`), `sections` (CHECK restaurants visible; CHECK film YouTube/Vimeo), `site_settings` ADD COLUMN IF NOT EXISTS (`default_restaurant_id` seeded 'taya-house' with the default dropped, `default_occasion` 'Dinner', `og_image_id`, `hero_autoplay_ms` 7000), `cuisines`/`cuisine_i18n`, `restaurants` gains `slug` (UNIQUE + pattern), `destination_id` (NOT NULL), `card_image_id`, `detail_image_id`, `og_image_id`, `phone_*` (pair CHECK), `map_url`, `has_detail_page`, `is_published`, `archived_at`, `updated_*`, CHECK `restaurants_detail_image`; `restaurant_i18n`, `restaurant_cuisines`, `restaurant_highlights` + i18n; `hero_slides` (`image_mobile_id`); `experiences`, `stories`, `offers`, `nav_items` each with its i18n table; `social_links`; FK `reservations_offer_fk` → `offers(id)` ON DELETE SET NULL.
   - **Ids:** every list id is `bigint GENERATED BY DEFAULT AS IDENTITY` (`reservations.offer_id` is bigint).
   - **Seed:** `lib/data.ts`, character for character. A list is seeded **only while it is empty** (`WHERE NOT EXISTS (SELECT 1 FROM t)`), and a translation **joins its parent**. With fixed ids, `ON CONFLICT DO NOTHING` alone brought back a deleted offer on a re-run; the test proved it, then the guard fixed it.
   - `restaurant_cuisines` is built from the English labels in `restaurants.cuisines`; an unknown label fails the whole migration (phase-2 ruling 9 moves from page time to migration time; tested).
2. **Read path (`lib/server/content/`):**
   - `*.queries.ts` hold uncached SQL; Vitest tests these.
   - `site.ts`, `home.ts` and `restaurants.ts` wrap them with `'use cache'`, `cacheLife('max')` (offers: `'hours'`), and `cacheTag(...LOADERS.<name>.tags, TAGS.i18n(locale))`.
   - One query per loader; the detail page takes two.
   - Language fallback in SQL: `LOCALE_CTE` + `i18nJoin`/`tr`. Each field falls back on its own; a non-default row shows only if `reviewed`, or `machine` with `serve_machine`.
   - Images come as JSON from `mediaJson(id)`. A decorative image gets alt "".
3. **`lib/cache-plan.ts`** (full text in §8): `SAVE_TAGS[table]`, `LOADERS[name].{reads,tags}`, `tagsForSave(tables, restaurantId?)`. `lib/cache-plan.test.ts` checks that every table a loader reads has a save tag the loader carries, and that every `'use cache'` loader calls `cacheTag(...LOADERS.<name>.tags)`.
4. **Data flow:**
   - The (guarded) layout loads `getRestaurants` + `getSiteContent` (6 cached parts) + `getStrings`, and passes them to `SiteProvider` (new: `site`, `destName`).
   - The home page (a server component) loads `getSections/getHeroSlides/getExperiences/getStories/getOffers` and passes props. A section switched off is left out; offers are hidden when none show today.
   - The detail page loads `getRestaurantDetail(slug, lang)`; `generateStaticParams` uses `getDetailSlugs()`; null → `notFound()`.
   - The privacy page reads `{email}` from `getSiteSettings()`.
   - `ViewMarker`, `<Activity>` page scope, `IntroTrigger` and the curtain contracts are untouched. TayaHero keeps `restaurants.find((r) => r.slug === slug)`, which the page-scope fault-injection E2E relies on.
5. **Server-side formatting:** text is formatted inside the cached loaders, so server and browser ICU cannot disagree at hydration.
   - Story kicker: `en-GB` prints "9 Sept 2026" on Node 22 (ICU 77.1); en-US parts assembled day-first give "9 Sep 2026".
   - Offer line: `VND 888,000++ per guest · Nightly 18:30–22:00`.
6. **Images:**
   - `components/ui/CmsImage.tsx` wraps `next/image` only where `next/image` was already used: cuisine chips, restaurant cards, destination cards, stories, highlights. Byte-identical DOM.
   - The plain `<img>` elements stay `<img>` with the media URL: hero slides with `<picture>` mobile crop, chef, heritage, the Tàya portrait, the film poster. Reason: the optimizer would re-encode those files (other pixels); phase 7 moves them when the files move to Blob and the baselines are re-taken.
7. **`lib/data.ts`** now holds only: `Meal`, `MEALS`, `MEAL_LABELS` (registry in phase 7), `SLOTS` (phase 10); the `Restaurant` type (`dest: string`, `image: Media | null`); `DESTS`/`DestKey` for admin only (outline: deleted in phase 6); `FALLBACK_PHONE` (used by `error.tsx`, `global-error.tsx` and `DEFAULT_PHONE`, which must work without the DB).
8. **site_settings:**
   - **One reader:** `loadSiteSettings(db?)` (`settings.queries.ts`), used by the cached guest loader, `getSharedInbox` (admin) and `sharedInbox` (email Reply-To). Closes phase-5 T6.8.
   - `saveInbox` calls `updateTag(TAGS.contentContact)` after the commit, then `refresh()`.
   - The notifications screen's "Từ đợt 6…" sentence becomes "Đây cũng là email chung hiện ở chân trang web và trong trang chính sách bảo mật; lưu xong, web khách đổi theo ngay." Closes phase-5 T6.2.
9. **Offers:**
   - New `app/api/cron/daily/route.ts`: exports only `GET` and `maxDuration = 60`, checks `cronAuthorized` (`lib/server/cron.ts`), calls `revalidateTag('content:offers', { expire: 0 })` with `cache-control: no-store` (outline: `'max'`).
   - `vercel.json` gets `{ "path": "/api/cron/daily", "schedule": "5 17 * * *" }`.
   - **offerId (spec §14.1 row 6):** `openReserve(preset, {id, title})`; SiteProvider sends `offerId` only while the chosen restaurant is still the offer's; zod `offerId` int 1..2^31−1; the insert stores `(SELECT o.id FROM offers o WHERE o.id=$15 AND o.restaurant_id=$2)`, never a refusal, NULL for another restaurant's or an unknown id; the note prefill "Offer: …" is kept, so the drawer looks the same.
10. **Booking rules (phase-4 ledger):** `groupPhoneSql` takes the restaurant's own phone first, then its destination's (now `destination_id`), then the first destination that has one; `ORDER BY r.sort_order, r.id`. Tests: a null group phone, and the tiebreak.
11. **`playwright.config.ts`:** the `desktop-serial` project gets `workers: 1`, so serial files that mutate shared guest data do not interleave (`testProject.workers`, Playwright 1.63).

### Load-bearing file contents (exact; everything else is in the patch)

`lib/server/content/sql.ts`
```ts
import 'server-only';
export const LOCALE_CTE = `lc AS (
  SELECT coalesce((SELECT code FROM locales WHERE is_default), 'en') AS def,
         coalesce((SELECT serve_machine FROM locales WHERE code = $1), false) AS machine
)`;
const visible = (alias: string) =>
  `(${alias}.locale = lc.def OR ${alias}.status = 'reviewed' OR (${alias}.status = 'machine' AND lc.machine))`;
export function i18nJoin(table: string, alias: string, fk: string, parent: string): string {
  return `LEFT JOIN ${table} ${alias} ON ${alias}.${fk} = ${parent} AND ${alias}.locale = $1 AND ${visible(alias)}
  LEFT JOIN ${table} ${alias}_d ON ${alias}_d.${fk} = ${parent} AND ${alias}_d.locale = lc.def`;
}
export const tr = (alias: string, column: string) => `coalesce(${alias}.${column}, ${alias}_d.${column})`;
export function mediaJson(idExpr: string): string {
  return `(SELECT json_build_object(
            'url', m.url, 'width', m.width, 'height', m.height,
            'alt', CASE WHEN m.is_decorative THEN '' ELSE coalesce(ma.alt, ma_d.alt, '') END) AS j
     FROM media m
     ${i18nJoin('media_i18n', 'ma', 'media_id', 'm.id')}
    WHERE m.id = ${idExpr} AND m.deleted_at IS NULL)`;
}
export const VENUE_TODAY = `(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`;
```

`lib/server/content/home.queries.ts` (offers; hero, experiences and stories follow the same pattern)
```ts
export async function loadOffers(locale: string): Promise<OfferCard[]> {
  const rows = await query<{ id: string; restaurant_id: string; venue: string; title: string; schedule: string | null;
    price_amount: string | null; currency: string; price_basis: 'plus_plus' | 'net' | null }>(
    `WITH ${LOCALE_CTE}
     SELECT o.id::text, o.restaurant_id, coalesce(${tr('ot', 'venue_override')}, r.name) AS venue,
            ${tr('ot', 'title')} AS title, ${tr('ot', 'schedule')} AS schedule,
            o.price_amount::text AS price_amount, o.currency, o.price_basis
       FROM offers o CROSS JOIN lc
       JOIN restaurants r ON r.id = o.restaurant_id AND r.is_published AND r.archived_at IS NULL
       ${i18nJoin('offer_i18n', 'ot', 'offer_id', 'o.id')}
      WHERE o.is_published AND ${tr('ot', 'title')} IS NOT NULL
        AND (o.valid_from IS NULL OR o.valid_from <= ${VENUE_TODAY})
        AND (o.valid_until IS NULL OR o.valid_until >= ${VENUE_TODAY})
      ORDER BY o.sort_order, o.id`, [locale]);
  return rows.map((r) => ({ id: Number(r.id), restaurantId: r.restaurant_id, venue: r.venue, title: r.title,
    detail: offerDetail(r.price_amount !== null && r.price_basis ? { amount: r.price_amount, currency: r.currency, basis: r.price_basis } : null, r.schedule, locale) }));
}
```

`lib/server/content/restaurants.ts` (cached wrappers; `site.ts` and `home.ts` have the same shape; `getOffers` uses `cacheLife('hours')`)
```ts
export async function getRestaurants(locale: string): Promise<Restaurant[]> {
  'use cache'; cacheLife('max'); cacheTag(...LOADERS.restaurants.tags, TAGS.i18n(locale));
  return loadRestaurants(locale);
}
export async function getDetailSlugs(): Promise<string[]> {
  'use cache'; cacheLife('max'); cacheTag(...LOADERS.detailSlugs.tags);
  return loadDetailSlugs();
}
export async function getRestaurantDetail(slug: string, locale: string) {
  'use cache'; cacheLife('max'); cacheTag(...LOADERS.detail.tags, TAGS.i18n(locale));
  const detail = await loadRestaurantDetail(slug, locale);
  if (detail) cacheTag(TAGS.restaurant(detail.id));
  return detail;
}
```

`loadRestaurantDetail` SQL (key part): phone and map fall back from the restaurant to its destination; the menu PDF falls back from this language's (media, then url) to the default language's; no portrait → `null` → `notFound()`.
```sql
coalesce(r.phone_e164, CASE WHEN r.phone_display IS NULL THEN d.phone_e164 END) AS phone_e164,
coalesce(r.phone_display, CASE WHEN r.phone_e164 IS NULL THEN d.phone_display END) AS phone_display,
coalesce(r.map_url, d.map_url) AS map_url,
coalesce((SELECT m.url FROM media m WHERE m.id = rt.menu_pdf_media_id AND m.deleted_at IS NULL), rt.menu_pdf_url,
         (SELECT m.url FROM media m WHERE m.id = rt_d.menu_pdf_media_id AND m.deleted_at IS NULL), rt_d.menu_pdf_url) AS menu_pdf
… WHERE r.slug = $2 AND r.has_detail_page AND r.is_published AND r.archived_at IS NULL
```

`app/(site)/[lang]/(guarded)/page.tsx`
```tsx
export default async function HomePage() {
  const locale = (await lang()) ?? DEFAULT_LOCALE;
  const [sections, slides, experiences, stories, offers] = await Promise.all([
    getSections(locale), getHeroSlides(locale), getExperiences(locale), getStories(locale), getOffers(locale)]);
  const on = (key: keyof typeof sections) => sections[key].visible;
  return (
    <ViewMarker view="home">
      <IntroTrigger />
      {on('hero') && slides.length > 0 && <Hero slides={slides} />}
      {on('finder') && <Finder />}
      {on('cuisines') && <Cuisines />}
      <Restaurants />
      {on('destinations') && <Destinations />}
      {on('experiences') && experiences.length > 0 && <Experiences items={experiences} />}
      {on('heritage') && <Heritage />}
      {on('stories') && stories.length > 0 && <Stories items={stories} />}
      {on('offers') && offers.length > 0 && <Offers items={offers} />}
      <MobileBar />
    </ViewMarker>
  );
}
```

`app/(site)/[lang]/(guarded)/restaurants/[slug]/page.tsx`
- `generateStaticParams` returns `(await getDetailSlugs()).map((slug) => ({ slug }))` (outline: plus the `_none` placeholder when empty).
- `generateMetadata` uses `detail.seo.title ?? \`${name} — Furama Cuisine\``, or "Page not found — Furama Cuisine" with noindex.
- `instant = false`; params are awaited at the top (the phase-2 no-JS rule).
- `TayaHero detail`, plus `TayaExperiences` (only when it has highlights; title `highlightsTitle ?? \`At ${name}\``), `MoreRestaurants`, and `MobileBar detail={{slug, phone, map, menuPdf, hasHighlights}}`.
- MENU and the mobile columns are hidden when there is no PDF and no highlights.

`app/api/cron/daily/route.ts`
```ts
import { revalidateTag } from 'next/cache';
import { TAGS } from '@/lib/cache-tags';
import { cronAuthorized } from '@/lib/server/cron';
export const maxDuration = 60;
const NO_STORE = { 'cache-control': 'no-store' };
export async function GET(request: Request): Promise<Response> {
  if (!cronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }
  revalidateTag(TAGS.contentOffers, { expire: 0 });
  console.info(`[cron:daily] expired ${TAGS.contentOffers}`);
  return Response.json({ expired: [TAGS.contentOffers] }, { headers: NO_STORE });
}
```

Seed-guard pattern in this spike's 008 (the same for every list):
```sql
INSERT INTO offers (id, restaurant_id, price_amount, currency, price_basis, valid_until, sort_order)
SELECT v.id, v.restaurant_id, v.price_amount, 'VND', v.price_basis, DATE '2026-12-31', v.id * 10
  FROM (VALUES (1,'cafe-indochine',888000,'plus_plus'),(2,'taya-house',799000,'plus_plus'),(3,'hai-van-lounge',450000,'net'))
       AS v(id, restaurant_id, price_amount, price_basis)
 WHERE NOT EXISTS (SELECT 1 FROM offers)
ON CONFLICT DO NOTHING;
INSERT INTO offer_i18n (offer_id, locale, title, schedule, origin)
SELECT v.*, 'seed' FROM (VALUES (1,'en','Seafood & Steak Buffet Dinner','Nightly 18:30–22:00'), …) AS v(offer_id, locale, title, schedule)
  JOIN offers o ON o.id = v.offer_id
ON CONFLICT DO NOTHING;
SELECT setval(pg_get_serial_sequence('offers', 'id'), GREATEST((SELECT max(id) FROM offers), 1));
```

## 3. Cache invalidation plan for phase 7 (implemented as `lib/cache-plan.ts`; tested)

| Table saved | Tags to expire |
|---|---|
| media, media_i18n | `media` |
| sections | `content:sections` (+ the section's own tag when its strings change) |
| site_settings, social_links | `content:contact` |
| destinations, destination_i18n | `content:destinations` |
| cuisines, cuisine_i18n | `content:cuisines` |
| restaurants, restaurant_i18n, restaurant_cuisines, restaurant_highlights(+i18n), service_periods | `restaurants` + `restaurant:<id>` |
| hero_slides | `content:hero` |
| experiences(+i18n), stories(+i18n), nav_items(+i18n) | `content:experiences`, `content:stories`, `content:nav` |
| offers, offer_i18n | `content:offers` |
| content_strings | by key prefix: `legal.*` → `content:legal`, a section's keys → its tag, the rest → `content:ui` |
| locales | `locales` + `i18n:<code>` of each language affected |

How each kind of write expires its tags:
- **Server Action saves** call `updateTag` for each tag in `tagsForSave(tables, id)`, after the commit (spec). Docs: `updateTag.md:16` (expires immediately; the next request waits).
- **Non-action writers** (jobs, `after()`, cron) call `revalidateTag(tag,'max')`. Docs: `revalidateTag.md:21-26`.
- **Date window:** `getOffers` has `cacheLife('hours')`, so the home page's prerender gets revalidate 3600 / expire 86400 (`cacheLife.md:144`; included in prerenders, `cacheLife.md:266-270`). The daily cron then expires `content:offers` at 00:05 Da Nang.
- **Which pages carry which tags** (measured in the `.meta` files):
  - /en: the layout's 10 tags + `content:hero/experiences/stories/offers`.
  - The detail page: + `restaurant:taya-house`.
  - Privacy: + `content:legal`.
  - A cached 404 of an unknown slug also carries `restaurants`, so turning a page on clears it (E2E `detail-page.serial`).

## 4. New tests (all green)

| Test | What it shows |
|---|---|
| `test/integration/content-loaders.test.ts` | Loader output equals the pre-phase-6 `lib/data.ts` constants. Also: language fallback per field, machine rows behind `serve_machine`, translated alt (a decorative one stays empty), unpublished rows hidden, a nav item follows its section, the offers' date window in Da Nang (inclusive, by dates), archived restaurants, the detail page's null cases and the portrait CHECK, another restaurant switched on with the resort's CALL/MAP, own phone beats the destination's. |
| `test/integration/migration-008.test.ts` | From 007 with an admin-edited inbox: counts, `site_settings` columns, offer FK (refused unknown id / SET NULL on delete), CHECKs, RESTRICT on media, safe re-run without resurrecting a deleted row, an unknown cuisine label fails the whole migration. |
| `test/integration/cron-daily.test.ts` | 401 cases; with the secret, `revalidateTag('content:offers',{expire:0})` exactly once; `no-store`. |
| `lib/cache-plan.test.ts`, `lib/content/format.test.ts` | Cache-plan coverage; the "9 Sep 2026" and price-line formats. |
| Additions to `catalogue`, `booking-rules`, `submit-reservation`, `input` tests | Published/archived filter, sort tiebreak, own and null group phone, `offer_id` kept/dropped. |
| E2E `offers-expiry.serial` | An offer past `valid_until` stays cached, a 401 cron changes nothing, a 200 cron removes it. |
| E2E `detail-page.serial` (the phase-6 acceptance) | Danaksara's 404, then DB switch + a rules save, then its page with kicker, story, title, resort CALL/MAP, no MENU or highlights, "More at…", and the card opens it without a reload. |
| E2E `shared-inbox.serial` | Saving the shared inbox changes the footer and the privacy page at once. Mutation-checked: without `updateTag(content:contact)` it fails with `Received: "fb@furamavietnam.com"`. |
| E2E `offer-booking` | VIEW OFFER sends `{restaurant:'cafe-indochine', offerId:1}`; the POST is aborted, so nothing is written. |

## 5. Deferred item 1: phase-2 ruling 7, the database is down (measured)

Setup: built against the local DB; `next start` on 3232 with `DATABASE_URL` pointing at the proxy on 3238. Killing the proxy drops every pooled connection and refuses new ones; the server never crashed.

| Step | /en | /en/restaurants/taya-house | /en/privacy | RSC /en |
|---|---|---|---|---|
| A: up, warm | 200 HIT | 200 HIT | 200 HIT | 200 HIT |
| B: down, nothing expired | 200 HIT | 200 HIT | 200 HIT | 200 HIT |
| C: `revalidateTag('restaurants',{expire:0})`, then down | **500 text/plain "Internal Server Error" (21 B)** | **200 `__next_error__`; the response never ends** (curl: 16 KB, then timeout at 12 s) | **500 plain** | **500 plain** |
| C2: DB back, first request | 200 MISS (correct content) | 200 | 200 MISS | 200 |
| D: a real admin save (`saveRules`, `updateTag('restaurants')`), then down | same as C | same as C | same as C | same as C |
| E: `revalidateTag('restaurants','max')`, then down | 200 **STALE**, then HIT | 200 STALE | 200 STALE | 200 STALE |
| F: `/api/cron/daily` (`content:offers`, expire 0), then down | **500 plain** | 200 HIT | 200 HIT | 500 plain |

What the guest sees:
- **C:** a full load of /en shows the plain text "Internal Server Error". The detail page shows `error.tsx` ("We could not load this page… +84 236 651 9999 TRY AGAIN") but never finishes loading (`goto` hit its 15 s timeout).
- **F:** a guest on /en/privacy clicks the logo. The RSC request gets a 500, the client falls back to a full load, and the guest sees the plain-text 500.
- **Unknown slug, DB down (B):** 2 of 3 runs never answered; 1 run answered 200 `__next_error__` in 100 ms.

`'max'` in detail (`measure-swr*.log`):
- **DB up:** the first request is STALE with the old content, the second is HIT with the new content.
- **DB down during that window:** STALE, STALE, then after the DB returns **HIT with the OLD content**. The edit is lost on that page until it is rendered again. A later re-render for another reason (here `content:offers` expiry) shows the new content, so the inner `'use cache'` entry is not stuck; only the page entry is.
- **`{ expire: 30 }`:** behaves like `expire:0` for an entry older than 30 s (500 while down; correct content as soon as the DB is back).

Why the 500 is plain text: `base-server.js:1902-1931` falls back to `'Internal Server Error','text/plain'` because production `getFallbackErrorComponents` returns null (`next-server.js:1401-1405`). So spec §12's "error.tsx with the phone" holds only for routes that stream (the detail page), and even there the response hangs. On fully static routes after an expiry, it does not hold.

Proposal (the lead decides; outline R7/R8):
- **(a) Admin saves:** keep `updateTag` (spec, read-your-own-writes). Accept the residual window, which needs the DB to fail between a save and the first visit to each page; it heals itself when the DB returns. Optional hardening (phase 10): after the commit, `after(() => fetch(<affected guest URLs>))` warms the pages while the DB is known to be up. Not prototyped. A last-known-good map inside the loaders does not help: the loaders never run at runtime before the first expiry, so the map is empty exactly when it is needed.
- **(b) Daily cron:** `revalidateTag('content:offers','max')` instead of `{expire:0}`. Measured: never a 500 at 00:05, even with the DB down. DB up: one visitor sees yesterday's offers once. DB down: stale offers until the next hourly revalidate after recovery (/en revalidates hourly because of `cacheLife('hours')`). Implemented per spec (`expire:0`) until the lead rules.
- **(c) Hanging detail/unknown-slug response:** an upstream Next 16.3.7 behaviour. Check it on the first Vercel preview. Mitigation candidate, unverifiable locally: `export const maxDuration = 15` on the detail page, so Vercel ends the stream.
- **(d) Monitoring:** a loader failure already logs `⨯ AggregateError ECONNREFUSED` with a digest.

## 6. Deferred item 2: the phase-4 residual RSC 404 during `updateTag('restaurants')` (reproduced and explained)

Harness: the guest clicks the Tàya card and back, repeatedly; a loop expires `restaurants` about every 120 ms.

| Expiry | Navigations | Expiries | Hard reloads |
|---|---|---|---|
| `{expire:0}` (the same cache state as `updateTag`) | 50 | 647 | 1 |
| `{expire:0}` | 80 | 1033 | 1 |
| `'max'` | 80 | 1027 | **0** |

Signature, the same each time: `404 GET /en/restaurants/taya-house?_rsc=… x-nextjs-postponed: 1`; no `x-nextjs-cache`, empty content-type; a navigation request, not a prefetch or a segment request; only the `[slug]` route, never /en or /privacy.

Mechanism (`node_modules/next/dist/build/templates/app-page-runtime.js`):
1. For a build-generated path, an RSC navigation is not "dynamic": it has a `prefetchDataRoute` (`:319-321`). That makes it eligible for the PPR **fallback-shell** branch (`:705-836`, `handleResponse({isFallback:true})`), which serves the shell of `/en/restaurants/[slug]`. That shell is html-only and postponed.
2. The RSC branch then finds no `rscData` and, under `cacheComponents`, answers 404 (`:1228-1240`), with the postponed header set at `:1220`.
3. The client treats a non-OK RSC answer as `doMpaNavigation` (`client/components/router-reducer/fetch-server-response.js:139-148`): a full reload with correct content.

Root-param shells stay blocking (`:680-687`), so /en and /en/privacy cannot hit this. The exact moment the concurrent regeneration lets the request fall into the fallback branch is likely, not proven, to be a missing previous entry during an in-flight regen.

Proposal: accept. It needs a navigation to coincide with the regeneration window of a save; the outcome is a full reload with correct content. Revisit if phase 7 ever saves at a high rate. `'max'` removes it, but loses read-your-own-writes.

## 7. Other deferred items

- **Ruling 8 (random slugs):** 20 random `/en/restaurants/zz-random-N` requests: each answers 200 (noindex) on the first visit, then 404 HIT with `s-maxage=2592000`; they added 120 files under `.next/server/app/en/restaurants` (6 per slug). `dynamicParams` is not available with Cache Components (`02-route-segment-config/dynamicParams.md:22`). Proposal: phase 10 (a Vercel WAF rate limit on `/*/restaurants/*`).
- **M7 (soft-404 title):** unchanged by phase 6. First visit: 200, `<title>` is the home title, `noindex` present, even for the Googlebot UA. The cached 404 has no `<title>` and keeps `noindex`. Proposal: accept (noindex covers SEO); revisit in phase 8 with the i18n 404 work.
- **Phase-4 T3 tiebreaker:** done in the rule loaders and the catalogue (`ORDER BY sort_order, id`); tested.
- **Null `groupPhone`:** tested. The restaurant's own phone now comes first.
- **Risk 8 ("Gọi để đặt bàn"):** the data now exists (the detail page's phone, `groupPhone` with the restaurant's own number). The UI and its registry keys are left to phase 7 (outline: an owner-gated phase-6 task).
- **Phase-2 ruling 9:** cuisines are FK'd. `cuisineSlug` is gone; an unknown label fails migration 008.
- **The phase-5 phase-6 group:** done. T6.8 one reader; handoff `updateTag(content:contact)` and the privacy `{email}`; T6.2 the copy; the Dining House number: E.164 dial target, the display text unchanged pending the owner (§15 item 14).

Doc citations used (`node_modules/next/dist/docs/01-app/…`): `03-api-reference/04-functions/revalidateTag.md:21-26,30`; `updateTag.md:12,16`; `cacheLife.md:139-147,266-270`; `03-api-reference/03-file-conventions/02-route-segment-config/dynamicParams.md:22`; `generate-static-params.md:310`; `02-guides/incremental-static-regeneration-cache-components.md:20,190`; `how-revalidation-works.md:57-62` (invalidation is per instance unless a cache handler coordinates); `use-cache.md:241`; `01-getting-started/15-route-handlers.md:124`.

## 8. `lib/cache-plan.ts` (full text, from the clone at `30ea85b`)

```ts
import { TAGS } from './cache-tags';

/*
 * The cache plan of the guest site (spec §6.2): which tables each cached
 * loader reads and which tags it carries, and which tags a save to each table
 * must expire. lib/cache-plan.test.ts checks the two agree: a save to any
 * table a loader reads expires at least one of that loader's tags. The
 * loaders call cacheTag(...LOADERS.<name>.tags) from here, so a loader cannot
 * drift from its entry; a phase-7 editor expires tagsForSave(<tables>) (in a
 * Server Action: updateTag each) for the tables its transaction wrote.
 *
 * Every loader also carries i18n:<locale> (it takes the locale), so enabling,
 * disabling or changing the machine-translation switch of a language expires
 * everything served in it.
 */

export const CONTENT_TABLES = [
  'locales',
  'content_strings',
  'media',
  'media_i18n',
  'sections',
  'site_settings',
  'destinations',
  'destination_i18n',
  'cuisines',
  'cuisine_i18n',
  'restaurants',
  'restaurant_i18n',
  'restaurant_cuisines',
  'restaurant_highlights',
  'restaurant_highlight_i18n',
  'service_periods',
  'hero_slides',
  'experiences',
  'experience_i18n',
  'stories',
  'story_i18n',
  'offers',
  'offer_i18n',
  'nav_items',
  'nav_item_i18n',
  'social_links',
] as const;
export type ContentTable = (typeof CONTENT_TABLES)[number];

/**
 * What a save to each table expires. `restaurant:<id>` is added by the caller
 * for a restaurant's own rows (tagsForSave's second argument). content_strings
 * is per key prefix (phase 7: hero.* → content:hero, legal.* → content:legal,
 * the rest → content:ui); locales expire `locales` and the i18n tag of every
 * language whose fallback changed (phase 8).
 */
export const SAVE_TAGS: Record<ContentTable, readonly string[]> = {
  locales: [TAGS.locales],
  // By key prefix (phase 7): legal.* → content:legal, the rest → content:ui (and a section's own keys its tag).
  content_strings: [TAGS.contentUi, TAGS.contentLegal],
  media: [TAGS.media],
  media_i18n: [TAGS.media],
  sections: [TAGS.contentSections],
  site_settings: [TAGS.contentContact],
  destinations: [TAGS.contentDestinations],
  destination_i18n: [TAGS.contentDestinations],
  cuisines: [TAGS.contentCuisines],
  cuisine_i18n: [TAGS.contentCuisines],
  restaurants: [TAGS.restaurants],
  restaurant_i18n: [TAGS.restaurants],
  restaurant_cuisines: [TAGS.restaurants],
  restaurant_highlights: [TAGS.restaurants],
  restaurant_highlight_i18n: [TAGS.restaurants],
  // The catalogue's meals come from the active periods (phase 4 saves already expire `restaurants`).
  service_periods: [TAGS.restaurants],
  hero_slides: [TAGS.contentHero],
  experiences: [TAGS.contentExperiences],
  experience_i18n: [TAGS.contentExperiences],
  stories: [TAGS.contentStories],
  story_i18n: [TAGS.contentStories],
  offers: [TAGS.contentOffers],
  offer_i18n: [TAGS.contentOffers],
  nav_items: [TAGS.contentNav],
  nav_item_i18n: [TAGS.contentNav],
  social_links: [TAGS.contentContact],
};

type Loader = { reads: readonly ContentTable[]; tags: readonly string[] };

/** Every cached guest loader: the tables its SQL touches and the tags it carries (besides i18n:<locale>). */
export const LOADERS = {
  locales: { reads: ['locales'], tags: [TAGS.locales] },
  strings: { reads: ['locales', 'content_strings'], tags: [TAGS.contentUi] },
  legal: { reads: ['locales', 'content_strings'], tags: [TAGS.contentLegal] },
  sections: { reads: ['locales', 'sections', 'media', 'media_i18n'], tags: [TAGS.contentSections, TAGS.media] },
  settings: { reads: ['site_settings'], tags: [TAGS.contentContact] },
  cuisines: { reads: ['locales', 'cuisines', 'cuisine_i18n', 'media', 'media_i18n'], tags: [TAGS.contentCuisines, TAGS.media] },
  destinations: {
    reads: ['locales', 'destinations', 'destination_i18n', 'media', 'media_i18n'],
    tags: [TAGS.contentDestinations, TAGS.media],
  },
  nav: { reads: ['locales', 'nav_items', 'nav_item_i18n', 'sections'], tags: [TAGS.contentNav, TAGS.contentSections] },
  socials: { reads: ['social_links'], tags: [TAGS.contentContact] },
  restaurants: {
    reads: ['locales', 'restaurants', 'restaurant_i18n', 'restaurant_cuisines', 'service_periods', 'media', 'media_i18n'],
    tags: [TAGS.restaurants, TAGS.media],
  },
  heroSlides: { reads: ['locales', 'hero_slides', 'media', 'media_i18n'], tags: [TAGS.contentHero, TAGS.media] },
  experiences: { reads: ['locales', 'experiences', 'experience_i18n'], tags: [TAGS.contentExperiences] },
  stories: { reads: ['locales', 'stories', 'story_i18n', 'media', 'media_i18n'], tags: [TAGS.contentStories, TAGS.media] },
  // Date-bound (cacheLife('hours') and the daily cron); the venue is the restaurant's name.
  offers: { reads: ['locales', 'offers', 'offer_i18n', 'restaurants'], tags: [TAGS.contentOffers, TAGS.restaurants] },
  detail: {
    reads: [
      'locales',
      'restaurants',
      'restaurant_i18n',
      'restaurant_highlights',
      'restaurant_highlight_i18n',
      'destinations',
      'destination_i18n',
      'media',
      'media_i18n',
    ],
    tags: [TAGS.restaurants, TAGS.contentDestinations, TAGS.media],
  },
  detailSlugs: { reads: ['restaurants'], tags: [TAGS.restaurants] },
} as const satisfies Record<string, Loader>;

export type LoaderName = keyof typeof LOADERS;

/** The tags a transaction that wrote `tables` must expire; `restaurantId` adds that restaurant's own tag. */
export function tagsForSave(tables: readonly ContentTable[], restaurantId?: string): string[] {
  const tags = new Set(tables.flatMap((t) => SAVE_TAGS[t]));
  if (restaurantId) tags.add(TAGS.restaurant(restaurantId));
  return [...tags];
}
```

## 9. Errors hit

| Error | Cause | Fix |
|---|---|---|
| `scripts/check-prerender.mjs`: "/en revalidates after 3600s, expected 2592000s" and "/en expires after 86400s, expected 31536000s" | getOffers uses cacheLife('hours') (spec §6.2), and a prerendered page takes the shortest lifetime of what it renders. | check-prerender gained a per-route LIFETIME (`{'/en': {revalidate: 3600, expire: 86400}}`) and the full tag lists (layout tags plus PAGE_TAGS), and adds /api/cron/daily to UNCACHED. |
| migration-008 test: after `DELETE FROM offers WHERE id = 3`, re-applying 008 counted offers 3 instead of 2 | Fixed seed ids with ON CONFLICT DO NOTHING only protect rows that still exist, so a re-run brought back a row an editor had deleted. | Every list seed now runs only while its table is empty (`WHERE NOT EXISTS (SELECT 1 FROM t)`), and every translation seed JOINs its parent; ON CONFLICT DO NOTHING is kept. |
| next build failed at 'Running TypeScript': e2e/offers-expiry.serial.spec.ts headers union not assignable to `{ [key: string]: string }`; lib/cache-plan.test.ts 'A type predicate's type must be assignable to its parameter's type' | next build typechecks test files too; typecheck ran before those specs were written. | Typed the cron helper as `(secret?: string): { headers: Record<string, string> }`, and built ALL_TAGS with `new Set<string>(Object.values(TAGS).flatMap((t) => (typeof t === 'string' ? [t] : [])))`. |
| migration-008 test expected `/violates foreign key constraint/` but got 'update or delete on table "media" violates RESTRICT setting of foreign key constraint "sections_image_id_fkey"' | Postgres words an ON DELETE RESTRICT violation differently from a NO ACTION one. | Asserted the RESTRICT wording with the constraint name. |
| E2E offer-booking: `getByLabel('Special requests', { exact: true })` found no element | The textarea sits inside a `<label>`, so Chrome's accessible name includes the embedded control's value ('Special requests Offer: …'). | Located it with `getByRole('textbox', { name: /^Special requests/ })`. The first failure also kept the 3 desktop-serial specs from running (the project depends on desktop). |
| lint: 21 warnings instead of 19 (no-underscore-dangle on `__mark` in e2e/detail-page.serial.spec.ts) | New test code used a window marker named `__mark`. | Renamed it `pageMark`. The warning set is now identical to the baseline (diff empty). |
| Pixel risk: Intl en-GB `{ day, month: 'short', year }` gives '9 Sept 2026' on Node 22.22 (ICU 77.1, CLDR 47), but the site shows '9 Sep 2026' | CLDR en-GB short month for September is 'Sept'. | lib/content/format.ts formatStoryDate takes formatToParts from en-US and builds 'day month year', on the server inside the cached loader, so the browser never formats the date (no hydration mismatch). |
| Measurement: a probe with only `RSC: 1` on /en answered 307 | Next validates the `_rsc` cache-busting search param of RSC requests and redirects when it is missing. | The probe follows redirects; the race harness uses real client navigations. |
| Measurement: `request.get('/en/restaurants/nope')` and the expired detail page never finished with the DB down (a 180 s test timeout) | A real finding: after the DB fails, Next 16.3.7 streams a 200 `__next_error__` document for a route with a fallback shell (or an unknown slug) and never ends the response. | The harness uses an 8 s request timeout and `waitUntil: 'domcontentloaded'`, and records 'NO ANSWER'. Reported under ruling 7 (§5). |
| Mutation run: `npm run test:e2e -- --retries=0 e2e/shared-inbox.serial.spec.ts` also ran all 151 desktop specs | The desktop-serial project depends on desktop, and dependency projects run in full even with a file filter. | No code change: counted per project (mutant: 151 desktop passed and the shared-inbox spec failed as intended; green: 152 passed). |

## 10. Package versions

- next 16.3.7, react / react-dom 19.3.0, typescript 7.0.2, pg 8.23.0, zod 4.6.5, vitest 5.0.3, oxlint 1.86.0, @vercel/functions 3.9.9: unchanged.
- @playwright/test 1.63.0 unchanged; `testProject.workers` used for desktop-serial.
- Node 22.22.0 (ICU 77.1, CLDR 47) locally; PostgreSQL 18.3 local.
- No package added or removed; no npm network access used.

## 11. The spike's recommended task breakdown

Each task gets one commit and runs the full gate (typecheck, lint with 19 warnings, unit + integration, reset the E2E DB, build, check-prerender, E2E --retries=0, visual at ratio 0). The p6-read patch has working code for every task.

- **T1.** Migration 008 plus test/integration/migration-008.test.ts, reconciled with the p6-schema spike: bigint list ids (reservations.offer_id is bigint); the media static-url unique index; seeds only while a list is empty, translations joined to their parent; the restaurants CHECKs (slug, phone pair, detail image); the sections CHECKs; site_settings ADD COLUMN with the default dropped after the seed; the offer FK. README pre-flight queries for Neon, e.g. `SELECT DISTINCT unnest(cuisines) FROM restaurants` must all map to the 8 seeded labels, or the migration fails.
- **T2.** The read layer, with no UI change: lib/server/content/sql.ts and the *.queries.ts files (site, home, restaurants, settings); the cached wrappers (site.ts, home.ts, restaurants.ts); lib/cache-plan.ts with its test; lib/content/types.ts and format.ts with its test; test/integration/content-loaders.test.ts and catalogue.test.ts; delete db/queries.ts.
- **T3.** Chrome switch: the (guarded) layout calls getSiteContent; SiteProvider gets site and destName; Header, MenuOverlay (labels stored once, CSS uppercase on `.hdr-nav .hdr-link`), Footer (destinations with show_in_footer, socials, site_settings.email), Finder/FinderSheet, SearchOverlay, BookingBar, ReserveDrawer, Chrome (booking_bar section), FilmModal (film section); FALLBACK_PHONE in error.tsx, global-error.tsx and DEFAULT_PHONE. Visual must stay 8/8.
- **T4.** Home page lists: the page reads sections, hero, experiences, stories and offers; Hero, Cuisines, Destinations, Experiences, Heritage, Stories and Offers take DB data; CmsImage only where next/image already existed, plain `<img>` kept; the RestaurantCard image; check-prerender gets the /en lifetime (3600/86400) and the new tags. Prove it with the visual run, a negative control and the normalised DOM diff.
- **T5.** The DB-driven detail page: generateStaticParams from getDetailSlugs, generateMetadata from SEO, notFound; TayaHero, TayaExperiences and MobileBar take props, with the CALL/MAP/MENU fallbacks; e2e/detail-page.serial.spec.ts (the acceptance). Merge with the p6-detail spike's generic-page work.
- **T6.** site_settings: loadSiteSettings is the one reader (recipients and render.ts use it); the privacy page's {email}; saveInbox calls updateTag(content:contact); the notifications copy; e2e/shared-inbox.serial.spec.ts, mutation-checked.
- **T7.** Offers: /api/cron/daily plus the vercel.json cron, and its test; the offerId path (zod, the insert subselect, SiteProvider, Offers) with unit, integration and E2E tests; e2e/offers-expiry.serial.spec.ts; desktop-serial workers: 1. The lead first rules on expire:0 versus 'max' for the cron.
- **T8.** Booking rules: groupPhoneSql takes the restaurant's own phone first and uses destination_id; ORDER BY sort_order, id; their tests.
- **T9.** Cleanup and docs: trim lib/data.ts, then the README and runbook (migration 008 pre-checks and post-checks on Neon, the new cron, the owner confirming the Dining House number) and the ledger entries for the rulings.

## 12. Risks and open questions

1. Ruling 7 needs a decision. With updateTag (the spec), if the DB fails after a save and before the next visit to a page, the fully static pages (/en, /en/privacy) answer a plain-text 500 for full loads and for RSC navigations (which then fall back to a full load). The detail page streams error.tsx but its response never ends. The cached pages that the save did not expire stay up. Measured locally; Vercel's 500 page and stream handling are unverified, so check them on the first preview.
2. The daily cron with `{ expire: 0 }` (the spec) takes the home page down with a plain 500 if the DB is unavailable at 00:05 Da Nang. 'max' was measured to serve stale content instead: one stale view with the DB up, bounded to about an hour with the DB down, because /en revalidates hourly. Recommendation: switch to 'max'.
3. `revalidateTag(tag,'max')` can lose an edit on a page: if the DB fails between the save and the page's background regeneration, the page entry is re-marked fresh with the old content (HIT). It stays until another re-render: the hourly revalidate for /en, but up to 30 days for the detail and privacy pages. So 'max' is not a blanket fix for admin saves.
4. The phase-4 RSC 404 residual was reproduced at about 1–2% of navigations to /en/restaurants/[slug] while `restaurants` was expiring every 120 ms with expire:0. It never happened with 'max' (0/80). The outcome is a full reload with correct content. Proposed ruling: accept. The exact trigger inside Next's response cache is inferred from the code path, not proven.
5. The response that never ends (the detail page or an unknown slug, after an expiry, with the DB down) looks like an upstream Next 16.3.7 behaviour. A possible mitigation is `export const maxDuration` on the detail page, so Vercel ends the stream; it cannot be verified locally.
6. The 'use cache' entries live in memory per instance, and invalidation is per instance unless a cache handler coordinates it (how-revalidation-works.md:57-62, 74). Whether updateTag reaches every Vercel instance is still the phase-4 risk #4: check it on the first preview.
7. The p6-schema spike may choose other names or id types. This read layer depends on: the media JSON shape; bigint list ids; restaurants.destination_id/slug/has_detail_page/detail_image_id/card_image_id/phone_*/map_url/is_published/archived_at; the restaurant_i18n columns; sections.is_visible/image_id/link_url; site_settings.default_restaurant_id/default_occasion/hero_autoplay_ms. (Outline: the schema spike's names match all of these.)
8. Section copy and UI microcopy (hero titles, 'Our Restaurants', 'Brand Story', 'At {name}', 'More at {destination}', 'per guest', 'VIEW OFFER', the meal labels) are still inline in components. Phase 7's guard that 'all guest text is in the registry or the DB' will fail until those keys and their editor screens exist.
9. Admin code still reads DESTS and restaurants.destination (closures scope, reachesSql, the notifications page). Once phase 7 lets editors change destination_id, both columns must be kept in sync, or every reader must switch, before phase 10 drops the old columns. (Outline: every reader switches in phase 6.)
10. Ruling 8 (random slugs) is unchanged: each random /en/restaurants/<x> adds about 6 files to the ISR cache, and its 404 is cached for 30 days. dynamicParams is not available with Cache Components, so this needs a WAF rate limit or a proxy check (phase 10).
11. M7 is unchanged: the first visit to an unknown slug answers 200 with the home `<title>` (noindex present, even for Googlebot), and the cached 404 has no `<title>`. Proposed: accept.
12. Each guest page's payload grows by about 1.3–1.6 KB gzipped (the site content serialised to SiteProvider). It could be trimmed later, for example by not sending media width/height to the client.
13. The nav labels now rely on CSS uppercase. Phase 8 translations longer than about 14 characters may still overflow the header (spec §6.5 limits).
14. The plain `<img>` elements (the hero with its mobile `<picture>`, the chef, heritage, the Tàya portrait, the film poster) do not use CmsImage yet, so spec §6.3 item 7 is partly deferred to phase 7, when the files move to Blob and the visual baselines are re-taken.
15. The 'Offer: …' note prefill is kept beside offer_id. Phase 7 should show the offer on the admin booking screen, and may then drop the prefill.
16. Owner input still needed: the Dining House phone (shown '0859 555 759', dialled +84859555759), and the TikTok handle, which is seeded as the site had it.

## 13. Spec deviations proposed by the spike

1. Spec §6.3 item 7 (every image through CmsImage): CmsImage wraps next/image only where next/image was already used. The hero slides (with their mobile `<picture>`), the chef, heritage, the Tàya portrait and the film poster keep plain `<img>` with the media URL, because the optimizer would re-encode those files and break the ratio-0 baselines. Deferred to phase 7 (Blob move and new baselines).
2. Spec §6.2 (every content reader takes the locale): getSiteSettings() has no locale parameter. Nothing in site_settings is translated, so one cache entry serves every language.
3. Spec §5.2 leaves the id types open (the content inventory proposed uuid): every list table uses bigint identity ids, because the phase-4 reservations.offer_id is already bigint and the FK needs a matching type. media keeps uuid.
4. Spec §5.1 item 7 (seeds use ON CONFLICT DO NOTHING): kept, and in addition a list is seeded only while it is empty and a translation joins its parent, so a manual re-run cannot bring back a row an editor deleted.
5. Spec §6.2 (offers expire with `{ expire: 0 }` in the cron): implemented as specified, but the measurements recommend `revalidateTag('content:offers', 'max')`.
6. Consequence of spec §6.2 (offers cacheLife('hours')): the whole /en prerender now revalidates every 3600 s and expires after 86400 s, instead of max. check-prerender was updated to expect that.
7. Spec §14.1 row 6 (the form sends offerId): done, and the old note prefill 'Offer: <title>' is kept, so the drawer looks the same. The server keeps offer_id only when the offer belongs to the booked restaurant, and never refuses a booking over it.
8. Spec §6.4 (CALL from the restaurant, else the destination): also applied to the booking group phone (availability API, emails) through groupPhoneSql, which now uses destinations via destination_id instead of the legacy destination column.
9. Section and UI text (hero.*, section titles, 'Brand Story', 'At {name}', 'per guest', the meal labels) stays in components for phase 7's registry keys and their editor screens. Phase 6 moves only lib/data.ts content and the sections, site_settings and media rows. A scoping ruling; spec §14.1 row 7 owns 'chữ giao diện'.
10. playwright.config.ts: the desktop-serial project gets workers: 1 (a test-infrastructure change), so serial specs that mutate guest-visible data cannot interleave.

## 14. User steps

1. Decide ruling 7. Option (a): keep updateTag for admin saves and accept the measured DB-down-after-save window, optionally warming the affected pages in after() in phase 10. Also decide the cron: keep `{ expire: 0 }` (spec) or switch to 'max' (recommended, measured).
2. Decide the phase-4 RSC 404 residual. Proposed: accept (about 1–2% of navigations to a restaurant page during a burst of saves; the result is a full reload with correct content).
3. Confirm the Dining House phone number and whether it should print with +84 (spec §15 item 14), and confirm the TikTok handle '@furama.dining.hous'.
4. Before migration 008 runs on Neon (the controller's job, in the phase-6 deploy window), check read-only that `SELECT DISTINCT unnest(cuisines) FROM restaurants` returns only the 8 seeded English labels, and that every restaurants.destination exists in destinations. Otherwise 008 rolls back.
5. After deploying, check in the Vercel dashboard that the second cron (/api/cron/daily, `5 17 * * *`) is registered; CRON_SECRET is already set for production.
6. On the first Vercel preview, check: updateTag reaching every instance; what a guest sees on a 500 or a hanging detail page there; and the payload growth of about 1.5 KB gzipped per page.
