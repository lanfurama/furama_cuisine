# Phase 6 spike: the content data model, migration 008 and its seed

> Spike report, key `schema-seed` (clone `p6-schema`, DB tag `p6sch`). Topic: the content data model, migration 008 and its seed, the guest-content inventory map, and the plan for deleting `lib/data.ts`.
>
> Where this report and `00-plan-outline.md` disagree, **the outline wins** (its §0 lists every conflict and how it was settled). In particular, the outline:
> - keeps this spike's `008_content.sql` as the base, and adds the read-path spike's rule that a list table is seeded **only while it is empty** (so a manual re-run cannot bring back a seeded row an editor deleted; this spike's own risk list names that gap);
> - makes `offers.restaurant_id` `ON DELETE RESTRICT` (this spike: CASCADE);
> - defers the section-copy and UI-text registry keys of §2 to phase 7 (this spike proposed adding them in phase 6, its T4); the §2 map becomes phase 7's key list;
> - adopts this spike's `valid_until` NULL, its decorative set, its `reservations_offer_id_fkey ON DELETE SET NULL`, its legacy-column switch with a guard test (no sync trigger), and its deletion of `DESTS` including the admin pages.

## 0. Outcome and where the files are

**Clone:** `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p6-schema`
- Base: `8fe98f5`.
- `.next` and `.env.local` were deleted right after the clone; `.env.local` was never read.

**Authoritative copy of every file:**
- Patch: `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p6sch-phase6-schema.patch`.
- 9 new files, +1980 lines.
- `git apply --check` passes on the current main HEAD `4f67931`, which differs from `8fe98f5` only by `docs/superpowers/ledgers/2026-10-03-phase-5-ledger.md`.
- The migration, the generator, the image-size reader and the two Neon check files are reproduced in full below (§5, §6, §8), taken from the clone, which is byte-identical to the patch.

| New file | What it is |
|---|---|
| `db/migrations/008_content.sql` | 796 lines, 20 new tables, one transaction, idempotent, expand only. Full text in §5. |
| `scripts/measure-assets.mjs` | Generator of the media VALUES block (§6). |
| `lib/media/image-size.ts` + `.test.ts` | Dependency-free JPEG/PNG size reader and EXIF-rotation check, shared by the generator and the tests. |
| `test/fixtures/phase5-content.ts` | Frozen snapshot of the guest content at 8fe98f5 (§7). |
| `test/integration/content-seed.test.ts` | 13 tests: equivalence of the seed with the snapshot. |
| `test/integration/migration-008.test.ts` | 18 tests: upgrade, guards, re-run, constraints. |
| `db/checks/preflight-008.sql`, `db/checks/postcheck-008.sql` | Read-only checks for the Neon window. |

**Verified results:**
- **Typecheck:** exit 0.
- **Lint:** exit 0 with **19 warnings**, the baseline.
- **Unit + integration:** **71 files, 941 tests passed**. The pre-change suite is 68 files and 906 tests; the new files add 13 + 18 + 4.
- **Phase-5 code on a database that has 008:** the unchanged code was built against a database with all 8 migrations.
  - `next build` exit 0, and `check-prerender` passed.
  - E2E: **151 passed, 1 skipped** (botid), with `--retries=0` on port 3220.
  - Visual: **8 passed at maxDiffPixelRatio 0** on port 3221.
  - This proves 008 is invisible to the code now in production, so it can be applied to Neon before phase 6 ships.
- **Mutation checks:**
  - 10 seed mutations, all caught by content-seed after one fix (en dash, decorative flag, bytes, story date, curly quote, nav case, cuisine order, NFD address, alt case, default occasion).
  - 9 migration-safety mutations, all caught by migration-008 after two fixes (re-run page guard, sequence moving back, site_settings re-seed, removed links re-seeded, label guard on re-run, detail CHECK, RESTRICT, offer_id guard, legacy NOT NULL).
- **Timing:** 008 takes about 80 ms locally.
  - Locks held until COMMIT: ACCESS EXCLUSIVE on `restaurants` and `site_settings`; SHARE ROW EXCLUSIVE on `reservations` (new bookings wait), `destinations` and `locales`.
  - `migrate.mjs` sends the file as one query, so on Neon this is one round trip.
- **Cleanup:** every `furama_cuisine_*p6sch_test` database was dropped (9). No servers are running. The original repo was never modified.

## 1. Decisions

**1. Seed inside 008**, hand-written, in the same transaction as the schema.
- It is atomic: Neon never sees content tables that exist but are empty, which would mean blank home sections.
- The media metadata comes from a generator: `node scripts/measure-assets.mjs` prints the VALUES block, pasted verbatim. Its sizes match `sips` for all 39 files.
- A generator from `lib/data.ts` was rejected for three reasons:
  - Half the content lives in JSX: hero alt text, Tàya kicker and story, footer addresses, the heritage image, the film poster, menu labels, the 7000 ms autoplay, the 'Dinner' default.
  - The migration is immutable once applied, so it would never be regenerated.
  - `lib/data.ts` is the thing being retired.

**2. Copy from the database, not literals, for anything already in the database.**
- `restaurant_i18n.type_label` comes from `restaurants.type`.
- Card alt text comes from `restaurants.name`.
- `restaurant_cuisines` comes from the `restaurants.cuisines` labels (array order kept).
- `slug = id` and `destination_id = destination`.
- So Neon's actual values carry over even if they drifted from 002.

**3. Seeds use `ON CONFLICT DO NOTHING` everywhere** (spec §5.1 item 7).
- List tables use **fixed ids** (`OVERRIDING SYSTEM VALUE`), so their `*_i18n` rows can name them, and tests and E2E can refer to "offer 1".
- Afterwards each identity sequence is moved with `setval(seq, GREATEST(max(id), last_value))`, which never moves it back.
- Seeds that would undo an edit on a re-run are guarded:
  - Tàya's page switch is guarded on `detail_image_id IS NULL`.
  - The Tàya copy is guarded on all its columns being NULL.
  - `restaurant_cuisines` only seeds restaurants with no links yet.
  - The `site_settings` defaults use the DEFAULT-then-`DROP DEFAULT` pattern of 006's `reservations.source`.
- (Outline addition: every list seed also gets `WHERE NOT EXISTS (SELECT 1 FROM <table>)`, and every translation seed joins its parent row.)

**4. Ids.**
- `media.id` is a uuid (spec), with `UNIQUE (pathname)` for registerMedia's upsert.
- All new list tables use `bigint GENERATED ALWAYS AS IDENTITY`, as phases 4 and 5 do. `offers` must be bigint to match `reservations.offer_id`.
- `cuisines.id` is a text slug, like `destinations.id` and `restaurants.id`.

**5. Translations.**
- Every `*_i18n` table carries the §5.1 columns (status, origin, ai_model, source_hash, reviewed_by/at, updated_at/by), the locale FK `ON UPDATE CASCADE ON DELETE CASCADE`, and the parent FK with CASCADE.
- Seeds are `en`, `reviewed`, origin `seed`.
- Every translatable text column has `CHECK (btrim(x) <> '' AND char_length(x) <= N)`. NULL means "fall back per field", so a blank value must not be possible, for the same reason as 006's closure_i18n.

**6. Media.**
- Storage is `static`; `url = pathname = /assets/<file>`. The content type, pixel size and bytes are measured from the files.
- `blur_data_url` is NULL: the pages draw no placeholder today, and drawing one would change them. Phase 7 fills it on upload.
- No file has EXIF orientation; the test pins this.
- **Decorative (19):** the 8 cuisine chips, the 4 destination cards, the 4 story cards, `heritage.jpg`, and hero slides 2 and 3. These are exactly the images drawn with `alt=""`.
- **English alt text (20):**
  - `chef.jpg`: 'A Furama chef at work'
  - `hero-beach.jpg` and `hero-hall-m.jpg`: 'Dining at Furama Cuisine'
  - `taya-hero.jpg`: 'Tàya House'
  - the 4 Tàya highlight images: their alt from `TAYA_EXPERIENCES`
  - the 12 `r-*.jpg` cards: the restaurant name, as `RestaurantCard` renders it
- The film modal uses `hero-beach.jpg` as its poster with `alt=""`. That is decorative by role, not by file, so the component must keep `alt=""` (a CmsImage `decorative` prop).
- Every content reference to media is `ON DELETE RESTRICT`. Postgres 18 reports it as "violates RESTRICT setting of foreign key constraint <name>".

**7. Offers.**
- The free-text detail is split into structure: `price_amount numeric(14,2)`, `currency`, `price_basis plus_plus|net`, and `offer_i18n.schedule`.
- The venue is `COALESCE(venue_override, restaurants.name)`.
- `valid_from` and `valid_until` are NULL: no offer hides today. Seeding 2026-12-31 from the lede would hide offers on 2027-01-01 and break the visual and E2E runs after that date.
- `reservations.offer_id` gets its FK `ON DELETE SET NULL`: the booking keeps its date, time and party and loses only the link. Restore re-creates the offer under the same id.
- Partial index `reservations_offer_idx`.
- A guard stops the migration if any booking already carries an `offer_id`. Nothing in phases 4 and 5 writes it (verified with grep).

**8. Restaurants.**
- New columns: `slug` (NOT NULL, UNIQUE, slug CHECK), `destination_id` (NOT NULL, FK `ON UPDATE CASCADE`), `card_image_id`, `detail_image_id`, `og_image_id` (FK media RESTRICT), `phone_e164` and `phone_display` (pair CHECK, E.164 regex), `map_url` (https), `has_detail_page`, `is_published`, `archived_at`.
- DB guards: `restaurants_detail_image` (a page needs its portrait) and `restaurants_published_card` (a visible card needs its picture).
- Legacy `type` and `destination` become nullable, so phase-7 inserts fill only the new columns. COMMENT ON COLUMN marks all five phase-1 columns as "dropped in phase 10".
- `name` stays in the main table (spec §3: names are not translated).
- Tàya House gets `has_detail_page = true` and `detail_image_id = /assets/taya-hero.jpg`.

**9. Sections.** These are the 11 fixed keys, with no reordering (not a page builder).
- `is_visible`, with a CHECK that `restaurants` is always visible.
- `image_id`: film → hero-beach (poster), experiences → chef, heritage → heritage.
- `link_url`: heritage → `CONTACT.story`; the film's is NULL (no video yet). The film link must be YouTube or Vimeo.

**10. Navigation and social links.**
- `nav_items` hold one label per language, in natural case ('Restaurants' … 'About'). The header must uppercase it with CSS: `.hdr-link` has no text-transform today.
- Nav constraints: `UNIQUE(target_section)`, never `film` or `finder` (no anchor), label ≤ 18 characters.
- `social_links` store the platform enum and the URL. The label 'FACEBOOK' etc. is code (brand); `.footer-social` has no text-transform.

**11. site_settings** gains columns with `ADD COLUMN IF NOT EXISTS`:
- `default_restaurant_id`: 'taya-house'; FK `ON UPDATE CASCADE ON DELETE SET NULL`.
- `default_occasion`: 'Dinner', CHECK against the meal enum.
- `og_image_id`: NULL.
- `hero_autoplay_ms`: 7000, CHECK 3000–20000.

**12. Section copy and UI text are not seeded.** They become registry keys whose defaults apply while `content_strings` has no row (spec §8). The test asserts `content_strings` stays empty. (Outline: the keys themselves land in phase 7.)

## 2. Complete inventory map (content-inventory §2.1–2.19 plus later additions)

Legend:
- **T**: main-table column.
- **I**: `*_i18n` column (English seeded by 008).
- **R**: new registry key (`content_strings`); the screen is in brackets. (Outline: phase 7.)
- **R✓**: already in the registry.
- **D**: already in the database before 008.
- **C**: code (brand, glyph, enum, computed, or must render without the database).

Natural-case strings that are shown in capitals need CSS uppercase on their class; check each class when the key lands, since the visual baselines prove it.

| Surface | Datum (today) | Destination |
|---|---|---|
| 2.1 Layout/SEO | title 'Furama Cuisine — Many Flavours. Many Destinations.' and description | R `seo.home_title`, `seo.home_description` [seo] |
| | OG title 'Furama Cuisine', OG description | R `seo.og_title`, `seo.og_description` [seo] |
| | OG image (none) | T `site_settings.og_image_id` (NULL); per restaurant T `restaurants.og_image_id` |
| | `<html lang>` | D `locales.bcp47` |
| | themeColor, icon.svg, fonts, viewport | C |
| 2.2 Header | logo FURAMA/CUISINE, wordmark | C |
| | 6 nav labels and targets | T `nav_items(target_section, sort_order, is_published)` + I `nav_item_i18n.label` (title case) |
| | SEARCH; RESERVE ×2 | R `ui.search`, `ui.reserve` [ui-text] |
| | language code and names | D `locales.short_label`, `native_name` |
| | aria Main / Language / Open menu | R `ui.nav_aria`, `ui.language_aria`, `ui.open_menu` [ui-text] |
| | ▾ ● | C |
| 2.3 Menu overlay | `MENU_LABELS` (title case) | I `nav_item_i18n.label` (same rows) |
| | Search | R `ui.search` |
| | RESERVE A TABLE | R `ui.reserve_table` [ui-text] |
| | EN/VI | D `locales` |
| | tagline 'PEOPLE \| CULTURE \| GREAT FOOD' | R `footer.tagline` [contact], shared with the footer |
| | aria Menu / Close menu / Sections | R `ui.menu_aria`, `ui.close_menu`, `ui.sections_aria` |
| | wordmark, × → | C |
| 2.4 Mobile bar | EXPLORE / RESTAURANTS / RESERVE | R `ui.tab_explore`, `ui.tab_restaurants`, `ui.reserve` |
| | CALL / MAP / MENU | R `detail.call`, `detail.map`, `detail.menu` [restaurants] |
| | aria Restaurant actions / Sections | R `detail.actions_aria`, `ui.sections_aria` |
| | tel and map | T `restaurants.phone_e164/phone_display/map_url` → D `destinations.*` → hidden |
| | tariff PDF | I `restaurant_i18n.menu_pdf_url` \| `menu_pdf_media_id` (requested language → EN → `#dishes` → hidden) |
| | column count | C computed |
| 2.5 Hero | 3 slide images, order | T `hero_slides(image_id, sort_order, is_published)` |
| | phone crop hero-hall-m | T `hero_slides.image_mobile_id` (slide 1) |
| | alt (slide 1) / "" (slides 2–3) | I `media_i18n.alt` / T `media.is_decorative` |
| | kicker; title ×3 (line 2 desktop only); lede | R `hero.kicker`, `hero.title_1/2/3`, `hero.lede` [hero] |
| | 3 CTAs; 'Slide {n}' | R `hero.cta_explore`, `hero.cta_film`, `hero.cta_find`, `hero.slide_aria` (vars n) |
| | 7000 ms | T `site_settings.hero_autoplay_ms` |
| Film | poster hero-beach (alt "" by role) | T `sections[film].image_id`; alt "" is C (CmsImage `decorative`) |
| | 'One Furama Cuisine', 'THE FILM · COMING SOON' | R `film.title`, `film.coming_soon` [hero] |
| | aria 'Furama Cuisine film', 'Close film' | R `film.aria`, `film.close_aria` |
| | video URL (none); on/off (also hides WATCH THE FILM) | T `sections[film].link_url` (NULL) / `is_visible` |
| 2.6 Finder and sheet | 'Find a restaurant'; Location / Cuisine / Occasion / Destination | R `finder.title`, `finder.location/cuisine/occasion/destination` [booking] |
| | Da Nang / More cities / Coming soon | R `finder.city`, `finder.more_cities`, `common.coming_soon` |
| | All cuisines / Any occasion / Any destination; SHOW RESTAURANTS; Close | R `finder.all_cuisines`, `any_occasion`, `any_destination`, `finder.submit`, `common.close` |
| | occasion options | values: C `Meal`/`MEALS` enum; labels: R `meal.breakfast/lunch/dinner/drinks` (`MEAL_LABELS`) |
| | cuisine options | I `cuisine_i18n.label` |
| | destination options | I `destination_i18n.name` (venues with restaurants) |
| | default occasion 'Dinner' | T `site_settings.default_occasion` |
| | default location 'Da Nang' | C (the only city; not a filter) |
| 2.7 Cuisines | 'Explore by Cuisine', 'ALL CUISINES →' | R `cuisines.title`, `cuisines.all` [cuisines]; arrow C |
| | 8 chips | T `cuisines(id slug, image_id, sort_order, is_published)` + I `cuisine_i18n.label`; image decorative |
| 2.8 Restaurants | 'Our Restaurants', 'VIEW ALL RESTAURANTS →' | R `restaurants.title`, `restaurants.view_all` [restaurants] |
| | 'Showing {shown} of {total} restaurants', 'No matches' | R `restaurants.showing` (vars shown, total), `restaurants.no_matches` |
| | ', remove filter', CLEAR ALL, the 3 empty-state lines | R `restaurants.remove_filter_sr`, `clear_all`, `empty_title`, `empty_lede`, `show_all` |
| | id, name, sort_order, booking_enabled | D |
| | slug, destination | T `slug`, `destination_id` |
| | type | I `restaurant_i18n.type_label` |
| | cuisines | T `restaurant_cuisines` |
| | meals | D `service_periods` (006) |
| | publish / archive | T `is_published`, `archived_at` |
| | card image and alt (= name) | T `restaurants.card_image_id` + I `media_i18n.alt` |
| | 'View restaurant' / 'Reserve a table' | R `restaurants.card_view`, `restaurants.card_reserve`; choice by T `has_detail_page` |
| 2.9 Destinations | 'Our Destinations', lede | R `destinations.title`, `destinations.lede` [destinations] |
| | 4 cards: kind, order, publish | D `destinations.kind/sort_order/is_published` |
| | 2-line title and blurb | I `destination_i18n.card_title_1/2`, `card_blurb_1/2` |
| | card image | T `destinations.card_image_id` (FK added by 008); decorative |
| | '{count} restaurants →' / 'Coming soon' | R `destinations.count` (vars count), `common.coming_soon` |
| | sr '{title} — {count}'; journey dots | C |
| | names (dropdowns, footer, 'More at') | I `destination_i18n.name` ('future' is NULL) |
| 2.10 Experiences | chef.jpg and its alt | T `sections[experiences].image_id` + I `media_i18n.alt` |
| | eyebrow, title ×2 | R `experiences.eyebrow`, `experiences.title_1/2` [experiences] |
| | 3 rows | T `experiences(link_url NULL, sort_order, is_published)` + I `experience_i18n.title/blurb`; href fallback '#experiences' is C |
| 2.11 Heritage | background (decorative) | T `sections[heritage].image_id` |
| | kicker, title ×2, 'OUR STORY' | R `heritage.kicker`, `heritage.title_1/2`, `heritage.cta` [heritage] |
| | story link | T `sections[heritage].link_url` |
| 2.12 Stories | title, lede | R `stories.title`, `stories.lede` [stories] |
| | 4 cards: image (decorative), href, date | T `stories.image_id`, `href` (+ I `story_i18n.href` override), `published_on` |
| | category, title | I `story_i18n.category/title` |
| | kicker | R `stories.kicker` '{category} · {date}'; date formatted on the server, day-first ('9 Sep 2026') |
| 2.13 Offers | title; lede (keeps 'valid until 31 December 2026') | R `offers.title`, `offers.lede` [offers] |
| | restaurant | T `offers.restaurant_id` |
| | venue | `restaurants.name` ?? I `offer_i18n.venue_override` |
| | title | I `offer_i18n.title` |
| | detail | T `price_amount/currency/price_basis` + I `offer_i18n.schedule`, through R `offers.price_plus_plus` '{currency} {amount}++ per guest', `offers.price_net` '{currency} {amount} net per guest', `offers.detail` '{price} · {schedule}' |
| | validity, order, publish | T `valid_from/valid_until` (NULL), `sort_order`, `is_published` |
| | VIEW OFFER | R `offers.cta` |
| | note prefill 'Offer: {title}' | joined by T `reservations.offer_id`; R `offers.note` while the drawer keeps the prefill |
| 2.14 Booking bar | 'Where would you like to dine?' | R `booking.title` [booking] |
| | field labels | R `booking.label_destination/restaurant/date/time/guests` (shared with the drawer) |
| | Today / Tomorrow | R `common.today`, `common.tomorrow` |
| | Full / '{count} left' | R `booking.slot_full`, `booking.slot_left` |
| | meal note | R `meal.*` |
| | FIND A TABLE | R `booking.find_table` |
| | guest label | R `booking.guests_count` |
| | day labels | C Intl (phase 8) |
| | first restaurant | T `site_settings.default_restaurant_id` |
| 2.15 Drawer and actions | `error.*`, `booking.day_*`, `no_tables`, `no_dates`, `loading`, `done_*`, `retry`, `privacy_notice`, `consent`, `legal.link` | R✓ |
| | new drawer copy [booking] | R `booking.drawer_aria` 'Reserve a table', `booking.thanks` 'Thank you, {name}.', `booking.thanks_anon` 'you', `booking.label_reference`, `booking.done`, `booking.fewer_guests`, `booking.more_guests`, `booking.slot_full_aria` '{time} — fully booked', `booking.slot_left_aria` '{time} — {count} covers left', `booking.your_details`, `booking.your_table`, `booking.sending` 'SENDING…', `booking.submit` 'REQUEST BOOKING' |
| | field captions and placeholders [ui-text] | R `form.name` 'Full name *', `form.phone`, `form.email`, `form.note` 'Special requests', `form.ph_name` 'Nguyễn Minh Anh', `form.ph_phone`, `form.ph_email`, `form.ph_note` |
| | meta '{type} · {destination}' | C join |
| | {phone} | T restaurant phone ?? D destination phone ?? C `FALLBACK_PHONE` |
| 2.16 Search | dialog copy [ui-text] | R `search.aria`, `search.close`, `search.placeholder`, `search.popular`, `search.results` (plural), `search.view`, `search.reserve`, `search.none` 'No matches for “{query}”…' |
| | chips | I `cuisine_i18n.label` |
| | thumbnail | T `card_image_id` |
| | folded fields | D name + I type_label, cuisine labels, destination names (spec §6.3 item 9) |
| 2.17 Footer | wordmark | C |
| | tagline; 'A MEMBER OF FURAMA' | R `footer.tagline`, `footer.member` [contact] |
| | socials | T `social_links`; label from platform is C |
| | address lines | I `destination_i18n.name`/`address` + D `destinations.phone_display/phone_e164` where `show_in_footer` |
| | email | D `site_settings.email` (007) |
| | privacy link | R✓ `legal.link` |
| 2.18 Curtains | FURAMA / CUISINE | C |
| 2.19 Detail page | ALL RESTAURANTS / BACK | R `detail.back_all`, `detail.back` [restaurants] |
| | kicker ×2 | I `restaurant_i18n.detail_kicker` |
| | h1 ×2 | D `restaurants.name` |
| | 'Brand Story' | I `story_label` ?? R `detail.story_label` |
| | story ×2 | I `restaurant_i18n.story` |
| | RESERVE | R `ui.reserve_table` (shown when `booking_enabled`) |
| | portrait and alt | T `detail_image_id` + I `media_i18n.alt` |
| | 'At Tàya House' | I `highlights_title` ?? R `detail.highlights_title` 'At {name}' |
| | 4 cards | T `restaurant_highlights` + I `restaurant_highlight_i18n.title/detail` + media alt |
| | 'More at {destination}', 'ALL RESTAURANTS →' | R `detail.more_title`, `detail.more_all` |
| | `<title>` / description | I `restaurant_i18n.seo_title/seo_description` ?? R `seo.restaurant_title` '{name} — Furama Cuisine' |
| | unknown-slug title (M7) | R `seo.not_found_title` |
| | which restaurants have a page; URL | T `has_detail_page`, `slug` |
| Since the inventory | privacy page | R✓ `legal.*`; `{email}` → D `site_settings.email` |
| | (guarded)/not-found | R `common.not_found`, `common.back_home` |
| | `[lang]/not-found`, `global-not-found`, `error.tsx`, `global-error.tsx` copy and phone | C: they render with no database or language |
| | booking-errors `DEFAULT_PHONE` | C `FALLBACK_PHONE` |
| | emails | R✓ `email.*` + D `site_settings.email` + destination phones |

`ADMIN_SCREENS` must gain: `cuisines`, `destinations`, `experiences`, `heritage`, `stories`, `offers`, `restaurants` (spec §7.2) when these keys land.

## 3. `lib/data.ts`: delete now (phase 6) or in phase 10

| Export | Readers at 8fe98f5 | Replaced by | When |
|---|---|---|---|
| `DETAIL_PAGE_IDS`, `DETAIL_SEO`, `DEFAULT_RESTAURANT_ID` | `db/queries`, `[slug]/page`, `(guarded)/layout` | `has_detail_page`, `restaurant_i18n.seo_*`, `site_settings.default_restaurant_id` | 6 |
| `CUISINES`, `SLUG_BY_LABEL`/`LABEL_BY_SLUG`, `cuisineSlug`, `cuisineLabel`, `cuisineImage` | queries, Cuisines, Finder, Restaurants, SearchOverlay, catalogue.test | `cuisines`, `cuisine_i18n`, `restaurant_cuisines`, media | 6; rewrite catalogue.test's slug check against the table |
| `DESTS`, `DEST_KEYS`, `DestKey` | Finder, Restaurants, BookingBar, ReserveDrawer, SearchOverlay, MoreRestaurants, and 3 admin pages (closures, restaurants, notifications) | `destination_i18n.name` (ids are data) | 6, admin pages included |
| `DESTINATION_CARDS`, `EXPERIENCES`, `STORIES`, `OFFERS`/`Offer`, `TAYA_EXPERIENCES`, `HERO_SLIDES`, `NAV_LINKS`, `SOCIALS` | one component each | their tables | 6 |
| `CONTACT.email`, `.map`, `.tariffPdf`, `.story`, `.diningHouse*`; `contactFor`; `restaurantImage` | Footer, privacy, Heritage, MobileBar, TayaHero, cards | `site_settings`, `destinations`, `restaurant_i18n`, `sections`, media | 6 |
| `CONTACT.resortPhone`/`resortPhoneLabel` | `error.tsx`, `global-error.tsx`, `booking-errors` `DEFAULT_PHONE` | none: these render without the database | **keep** as `FALLBACK_PHONE` (a test can pin it equal to the resort destination) |
| `Restaurant` type | client and DTO | reshaped DTO (slug, hasDetailPage, typeLabel, destinationId, cardImage {src, width, height, alt}) | reshape in 6 |
| `MEAL_LABELS` | Finder, chips, BookingBar, ReserveDrawer | registry `meal.*` | 7 (its own comment), or 6 if the keys land then |
| `Meal`, `MEALS` | booking engine, admin zod, SQL ordering | the enum of `service_periods.meal` | **keep** (code enum) |
| `SLOTS` | `booking-seed.test.ts` only | `service_periods` | 10, with `restaurants.meals`/`slot_capacity`, which that test reads |

Spec §14.1 row 10 places "các hằng nội dung trong lib/data.ts" in phase 10. Constants have no deploy-compatibility reason to wait, and the frozen fixture keeps the equivalence proof. When phase 6 deletes them, also delete the first describe block of content-seed.test.ts.

**SQL readers of the legacy columns that phase 6 must switch:**
- `db/queries.ts:25` (`type`, `destination`, `cuisines`)
- `lib/server/booking/rules.ts:56,104` (`destination` → `destination_id`; also honour `is_published`/`archived_at` as `restaurant_unavailable`)
- `lib/server/booking/config.ts:389` (closure scope `destination = $2`)
- `lib/server/email/recipients.ts:39` (`r.destination`)
- the admin restaurant-option queries

Add a guard test that fails on `r.type`, `r.destination`, `r.cuisines`, `r.meals` or `slot_capacity` in SQL outside migrations and tests. `groupPhoneSql` should become `COALESCE(restaurant phone, destination phone)` (spec §6.4), with a null-phone test (phase-4 deferral).

## 4. Schema summary (008)

| Table | Key, FKs | Columns and constraints |
|---|---|---|
| `media` | uuid PK; `UNIQUE(pathname)` | storage static\|blob; url; content_type (5 MIME types); width/height (images only; `media_dimensions`); bytes ≤ 15 MB; blur_data_url (data: URI ≤ 4000); is_decorative; deleted_at; created/updated. `media_static_path`: url = pathname under /assets. `media_blob_url`: https. |
| `media_i18n` | (media_id CASCADE, locale) | alt NOT NULL, non-blank, ≤ 250 |
| `destinations` (004) | + FK `card_image_id` → media RESTRICT | backfilled with `dest-<id>.jpg` |
| `destination_i18n` | (destination_id, locale) | name, card_title_1/2, card_blurb_1/2, address |
| `cuisines` → `cuisine_i18n` | id slug PK; image_id NOT NULL RESTRICT | sort_order, is_published / label |
| `restaurants` (+) | slug UNIQUE, destination_id FK, 3 image FKs RESTRICT | phone pair, E.164, map https, has_detail_page, is_published, archived_at; `restaurants_detail_image`, `restaurants_published_card`; legacy type/destination nullable + comments |
| `restaurant_i18n` | (restaurant_id, locale) | type_label, detail_kicker, story_label, story ≤ 1500, highlights_title, menu_pdf_media_id (RESTRICT) xor menu_pdf_url (`restaurant_i18n_one_menu`), seo_title ≤ 120, seo_description ≤ 320 |
| `restaurant_cuisines` | PK (restaurant CASCADE, cuisine RESTRICT, both ON UPDATE CASCADE) | sort_order; index on cuisine_id |
| `restaurant_highlights` → i18n | bigint identity; restaurant CASCADE; image NOT NULL RESTRICT | sort_order, is_published / title ≤ 80, detail ≤ 200 |
| `sections` | key PK (11 values) | is_visible (`sections_restaurants_visible`), image_id RESTRICT, link_url https; `sections_film_video` (YouTube/Vimeo only); no sort_order (fixed design order) |
| `hero_slides` | bigint identity | image_id NOT NULL, image_mobile_id (both RESTRICT); alt from media_i18n |
| `experiences` → i18n | bigint identity | link_url https / title, blurb |
| `stories` → i18n | bigint identity | image_id NOT NULL, href https NOT NULL, published_on date / category, title, href override |
| `offers` → `offer_i18n` | bigint identity; restaurant CASCADE (outline: RESTRICT); index | price_amount numeric(14,2) ≥ 0, currency `^[A-Z]{3}$`, price_basis plus_plus\|net (`offers_price_pair`), valid_from ≤ valid_until / title, schedule, venue_override |
| `reservations` (+) | FK `offer_id` → offers ON DELETE SET NULL | partial index `reservations_offer_idx` |
| `nav_items` → `nav_item_i18n` | bigint identity; target_section FK sections; UNIQUE; NOT IN (film, finder) | label NOT NULL ≤ 18 |
| `social_links` | bigint identity | platform enum (facebook, instagram, youtube, tiktok, zalo, x, tripadvisor, wechat, kakao, line), href https, visible_locales text[] (non-empty, no NULLs, or NULL = all) |
| `site_settings` (+) | default_restaurant_id FK SET NULL; og_image_id RESTRICT | default_occasion enum; hero_autoplay_ms 3000–20000, default 7000 |

Every main list table has sort_order, is_published, created_at, updated_at, updated_by. Seeded `sort_order` values are unique, stepped by 10. Readers must still `ORDER BY sort_order, id` (phase-4 deferral).

## 5. `db/migrations/008_content.sql` (full text, from the clone)

```sql
-- Phase 6: guest content moves into the database (spec §5.1, §5.2 "Nội dung
-- (đợt 6)" and "File", §6.4, §14.1 row 6).
--
-- Expand only, one transaction, safe to re-run. New: media (+ media_i18n),
-- destination_i18n, cuisines (+ cuisine_i18n), restaurant_i18n,
-- restaurant_cuisines, restaurant_highlights (+ i18n), sections, hero_slides,
-- experiences (+ i18n), stories (+ i18n), offers (+ offer_i18n), nav_items
-- (+ nav_item_i18n), social_links. Extended: restaurants, destinations
-- (card_image_id gets its FK), site_settings (ADD COLUMN IF NOT EXISTS, never
-- CREATE: phase 5 created it), reservations (offer_id gets its FK).
--
-- The seed is exactly what the guest site shows at 8fe98f5: lib/data.ts, the
-- copy written into the components, and what 002/004 already put in the
-- database (copied with INSERT … SELECT, so Neon's own values carry over).
-- test/integration/content-seed.test.ts compares every row with a frozen copy
-- of that content and re-measures every file in public/assets. Section copy and
-- UI text are NOT seeded: they are registry keys (lib/i18n/registry.ts), whose
-- defaults apply while content_strings has no row (spec §8).
--
-- Seeds: every INSERT is ON CONFLICT DO NOTHING (spec §5.1 item 7), so a re-run
-- never overwrites an edit. List tables take fixed ids (OVERRIDING SYSTEM VALUE)
-- so their *_i18n rows can name them; the identity sequences are moved past
-- them at the end. Seeded translations are status 'reviewed', origin 'seed'.
-- Translatable text is never blank (CHECK btrim(x) <> ''): NULL means "fall back
-- to the default language" (spec §5.1 item 5), so blank must not mean "shown".
-- Text CHECKs are generous backstops; the design limits (spec §6.5) are the
-- admin's (phase 7), except nav_item_i18n.label ≤ 18, which the spec puts here.

-- ── Guards ────────────────────────────────────────────────────────────────
-- Nothing has written reservations.offer_id yet (phase 4 created it for this
-- phase). Offers 1–3 are seeded below, so a stray value would silently point at
-- one of them: stop instead.
DO $$
DECLARE n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE table_name = 'reservations' AND constraint_name = 'reservations_offer_id_fkey') THEN
    SELECT count(*) INTO n FROM reservations WHERE offer_id IS NOT NULL;
    IF n > 0 THEN
      RAISE EXCEPTION '% booking(s) already carry an offer_id before offers exist; set them to NULL, then migrate again', n;
    END IF;
  END IF;
END $$;

-- ── media → media_i18n ────────────────────────────────────────────────────
-- 'static': a file in public/, served at url = pathname (/assets/…). 'blob':
-- a Vercel Blob upload (phase 7). Images carry their pixel size (next/image
-- needs it); PDFs carry none. blur_data_url stays NULL for the static files:
-- the guest pages draw no blur placeholder today, and drawing one would change
-- them (spec §14.1 row 6 acceptance); phase 7 fills it on upload.
CREATE TABLE IF NOT EXISTS media (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  storage       text        NOT NULL CHECK (storage IN ('static', 'blob')),
  url           text        NOT NULL CHECK (length(url) <= 2000),
  pathname      text        NOT NULL CHECK (length(pathname) <= 500),
  content_type  text        NOT NULL
                CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif', 'application/pdf')),
  width         integer     CHECK (width BETWEEN 1 AND 20000),
  height        integer     CHECK (height BETWEEN 1 AND 20000),
  bytes         integer     NOT NULL CHECK (bytes BETWEEN 1 AND 15728640),  -- 15 MB upload cap (spec §11)
  blur_data_url text        CHECK (blur_data_url ~ '^data:image/(jpeg|png|webp);base64,' AND length(blur_data_url) <= 4000),
  -- alt="" wherever it is shown, and the phase-9 alt generator skips it.
  is_decorative boolean     NOT NULL DEFAULT false,
  -- Soft delete; media-sweep removes the file later. Content references keep RESTRICT either way.
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,
  -- registerMedia upserts by pathname (spec §11).
  CONSTRAINT media_pathname_key UNIQUE (pathname),
  CONSTRAINT media_static_path CHECK (
    storage <> 'static' OR (url = pathname AND pathname ~ '^/assets/[a-z0-9][a-z0-9._-]*\.(jpg|jpeg|png|webp|avif|pdf)$')
  ),
  CONSTRAINT media_blob_url CHECK (storage <> 'blob' OR url ~ '^https://'),
  CONSTRAINT media_dimensions CHECK (
    ((content_type = 'application/pdf') = (width IS NULL)) AND ((width IS NULL) = (height IS NULL))
  )
);

-- Alt text per language; a row exists only when there is alt text. Not for PDFs.
CREATE TABLE IF NOT EXISTS media_i18n (
  media_id    uuid        NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  locale      text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  alt         text        NOT NULL CHECK (btrim(alt) <> '' AND char_length(alt) <= 250),
  status      text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin      text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model    text,
  source_hash text,
  reviewed_by text,
  reviewed_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  PRIMARY KEY (media_id, locale)
);

-- Every file in public/assets, measured by `node scripts/measure-assets.mjs`
-- (the VALUES block is its output, verbatim). Decorative: the images the
-- components draw with alt="" today: cuisine chips (the label is beside them),
-- destination and story cards (their text is on or under them), the heritage
-- background, and hero slides 2 and 3.
INSERT INTO media (storage, url, pathname, content_type, width, height, bytes, is_decorative)
SELECT 'static', v.pathname, v.pathname, v.content_type, v.width, v.height, v.bytes,
       v.pathname ~ '^/assets/(cuisine|dest|story)-'
       OR v.pathname IN ('/assets/heritage.jpg', '/assets/hero-taya.jpg', '/assets/hero-indochine.jpg')
  FROM (VALUES
    ('/assets/chef.jpg', 'image/jpeg', 456, 378, 57833),
    ('/assets/cuisine-cafe-lounge.jpg', 'image/jpeg', 45, 45, 7915),
    ('/assets/cuisine-hotpot.jpg', 'image/jpeg', 45, 45, 8121),
    ('/assets/cuisine-international.jpg', 'image/jpeg', 45, 45, 8010),
    ('/assets/cuisine-italian.jpg', 'image/jpeg', 360, 360, 36591),
    ('/assets/cuisine-japanese.jpg', 'image/jpeg', 45, 45, 8019),
    ('/assets/cuisine-steak-grill.jpg', 'image/jpeg', 360, 360, 35685),
    ('/assets/cuisine-thai.jpg', 'image/jpeg', 360, 360, 36597),
    ('/assets/cuisine-vietnamese.jpg', 'image/jpeg', 360, 360, 33769),
    ('/assets/dest-dining-house.jpg', 'image/jpeg', 616, 960, 66715),
    ('/assets/dest-future.jpg', 'image/jpeg', 194, 302, 23552),
    ('/assets/dest-mm.jpg', 'image/jpeg', 194, 302, 30721),
    ('/assets/dest-resort.jpg', 'image/jpeg', 194, 302, 21681),
    ('/assets/heritage.jpg', 'image/jpeg', 908, 322, 76454),
    ('/assets/hero-beach.jpg', 'image/jpeg', 906, 515, 101208),
    ('/assets/hero-hall-m.jpg', 'image/jpeg', 245, 378, 28455),
    ('/assets/hero-indochine.jpg', 'image/jpeg', 125, 94, 13001),
    ('/assets/hero-taya.jpg', 'image/jpeg', 174, 264, 22416),
    ('/assets/r-cafe-indochine.jpg', 'image/jpeg', 960, 720, 163565),
    ('/assets/r-chaoshan-hotpot.jpg', 'image/jpeg', 125, 94, 12832),
    ('/assets/r-danaksara.jpg', 'image/jpeg', 125, 94, 12923),
    ('/assets/r-don-ciprianis.jpg', 'image/jpeg', 960, 720, 165717),
    ('/assets/r-hai-van-lounge.jpg', 'image/jpeg', 126, 94, 12757),
    ('/assets/r-hura-izakaya.jpg', 'image/jpeg', 960, 720, 134441),
    ('/assets/r-pho-cuon.jpg', 'image/jpeg', 960, 720, 120080),
    ('/assets/r-taya-house.jpg', 'image/jpeg', 960, 720, 178214),
    ('/assets/r-thai-siam-kitchen.jpg', 'image/jpeg', 960, 720, 161143),
    ('/assets/r-the-fan.jpg', 'image/jpeg', 960, 720, 162477),
    ('/assets/r-v-senses-cafe.jpg', 'image/jpeg', 960, 720, 154173),
    ('/assets/r-yum-food-village.jpg', 'image/jpeg', 126, 94, 12806),
    ('/assets/story-buffet-gala.jpg', 'image/jpeg', 816, 600, 153134),
    ('/assets/story-dh-opening.jpg', 'image/jpeg', 816, 600, 101681),
    ('/assets/story-thai-siam.jpg', 'image/jpeg', 816, 600, 121113),
    ('/assets/story-the-fan.jpg', 'image/jpeg', 816, 600, 61351),
    ('/assets/taya-class.jpg', 'image/jpeg', 960, 720, 170931),
    ('/assets/taya-garden.jpg', 'image/jpeg', 960, 720, 181719),
    ('/assets/taya-hero.jpg', 'image/jpeg', 174, 264, 22416),
    ('/assets/taya-lounge.jpg', 'image/jpeg', 960, 720, 152655),
    ('/assets/taya-stay.jpg', 'image/jpeg', 960, 720, 159098)
  ) AS v(pathname, content_type, width, height, bytes)
ON CONFLICT (pathname) DO NOTHING;

-- The alt text the components write today. hero-hall-m.jpg is slide 1's phone
-- crop (one <picture>, one alt). The film modal shows hero-beach.jpg as its
-- poster with alt="": that is the poster's role there, not the file's, so the
-- component keeps alt="" for it.
INSERT INTO media_i18n (media_id, locale, alt, origin)
SELECT m.id, 'en', v.alt, 'seed'
  FROM (VALUES
    ('/assets/chef.jpg',        'A Furama chef at work'),
    ('/assets/hero-beach.jpg',  'Dining at Furama Cuisine'),
    ('/assets/hero-hall-m.jpg', 'Dining at Furama Cuisine'),
    ('/assets/taya-hero.jpg',   'Tàya House'),
    ('/assets/taya-class.jpg',  'Cooking class photo'),
    ('/assets/taya-lounge.jpg', 'Tàya House interior'),
    ('/assets/taya-garden.jpg', 'Lagoon Garden'),
    ('/assets/taya-stay.jpg',   'Cooking class & stay')
  ) AS v(pathname, alt)
  JOIN media m ON m.pathname = v.pathname
ON CONFLICT DO NOTHING;

-- A restaurant card's alt is the restaurant's name (RestaurantCard.tsx).
INSERT INTO media_i18n (media_id, locale, alt, origin)
SELECT m.id, 'en', r.name, 'seed'
  FROM restaurants r
  JOIN media m ON m.pathname = '/assets/r-' || r.id || '.jpg'
ON CONFLICT DO NOTHING;

-- ── destinations (004) → destination_i18n ─────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'destinations_card_image_id_fkey') THEN
    ALTER TABLE destinations
      ADD CONSTRAINT destinations_card_image_id_fkey
      FOREIGN KEY (card_image_id) REFERENCES media (id) ON DELETE RESTRICT;
  END IF;
END $$;

UPDATE destinations d
   SET card_image_id = m.id
  FROM media m
 WHERE d.card_image_id IS NULL
   AND m.pathname = '/assets/dest-' || d.id || '.jpg';

-- name: dropdowns, the footer line, "More at {name}". card_*: the two-line
-- title and blurb of the home card. address: the footer line.
CREATE TABLE IF NOT EXISTS destination_i18n (
  destination_id text        NOT NULL REFERENCES destinations (id) ON UPDATE CASCADE ON DELETE CASCADE,
  locale         text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  name           text        CHECK (btrim(name) <> '' AND char_length(name) <= 80),
  card_title_1   text        CHECK (btrim(card_title_1) <> '' AND char_length(card_title_1) <= 40),
  card_title_2   text        CHECK (btrim(card_title_2) <> '' AND char_length(card_title_2) <= 40),
  card_blurb_1   text        CHECK (btrim(card_blurb_1) <> '' AND char_length(card_blurb_1) <= 60),
  card_blurb_2   text        CHECK (btrim(card_blurb_2) <> '' AND char_length(card_blurb_2) <= 60),
  address        text        CHECK (btrim(address) <> '' AND char_length(address) <= 200),
  status         text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin         text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model       text,
  source_hash    text,
  reviewed_by    text,
  reviewed_at    timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text,
  PRIMARY KEY (destination_id, locale)
);

-- DESTS, DESTINATION_CARDS (lib/data.ts) and the footer's addresses
-- (Footer.tsx). The teaser has no name today: its card is not a link and no
-- dropdown lists it.
INSERT INTO destination_i18n (destination_id, locale, name, card_title_1, card_title_2, card_blurb_1, card_blurb_2, address, origin)
VALUES
  ('resort',       'en', 'Furama Resort Danang',  'Furama',    'Resort Danang', 'Iconic beachfront dining', 'since 1997',     '103–105 Võ Nguyên Giáp, Ngũ Hành Sơn, Đà Nẵng', 'seed'),
  ('dining-house', 'en', 'Furama Dining House',   'Furama',    'Dining House',  '4 floors · 4 flavours',    '1 night out',    '73 Trần Bạch Đằng, An Thượng',                  'seed'),
  ('mm',           'en', 'Furama MM Supercenter', 'Furama MM', 'Supercenter',   'Everyday dining',          'for everyone',   NULL,                                            'seed'),
  ('future',       'en', NULL,                    'Future',    'Locations',     'Bringing great food',      'to more places', NULL,                                            'seed')
ON CONFLICT DO NOTHING;

-- ── cuisines → cuisine_i18n ───────────────────────────────────────────────
-- The id is the slug: the filter key (spec §6.3 item 2) and, today, the image name.
CREATE TABLE IF NOT EXISTS cuisines (
  id           text        PRIMARY KEY CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(id) <= 40),
  image_id     uuid        NOT NULL REFERENCES media (id) ON DELETE RESTRICT,
  sort_order   integer     NOT NULL DEFAULT 0,
  is_published boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text
);

CREATE TABLE IF NOT EXISTS cuisine_i18n (
  cuisine_id  text        NOT NULL REFERENCES cuisines (id) ON UPDATE CASCADE ON DELETE CASCADE,
  locale      text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  label       text        CHECK (btrim(label) <> '' AND char_length(label) <= 40),
  status      text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin      text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model    text,
  source_hash text,
  reviewed_by text,
  reviewed_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  PRIMARY KEY (cuisine_id, locale)
);

-- CUISINES (lib/data.ts), in its order: the rail, the dropdowns and the search chips.
INSERT INTO cuisines (id, image_id, sort_order)
SELECT v.id, m.id, v.sort_order
  FROM (VALUES ('vietnamese', 10), ('italian', 20), ('thai', 30), ('japanese', 40),
               ('steak-grill', 50), ('hotpot', 60), ('international', 70), ('cafe-lounge', 80))
       AS v(id, sort_order)
  JOIN media m ON m.pathname = '/assets/cuisine-' || v.id || '.jpg'
ON CONFLICT DO NOTHING;

INSERT INTO cuisine_i18n (cuisine_id, locale, label, origin)
VALUES
  ('vietnamese',    'en', 'Vietnamese',    'seed'),
  ('italian',       'en', 'Italian',       'seed'),
  ('thai',          'en', 'Thai',          'seed'),
  ('japanese',      'en', 'Japanese',      'seed'),
  ('steak-grill',   'en', 'Steak & Grill', 'seed'),
  ('hotpot',        'en', 'Hotpot',        'seed'),
  ('international', 'en', 'International', 'seed'),
  ('cafe-lounge',   'en', 'Café & Lounge', 'seed')
ON CONFLICT DO NOTHING;

-- ── restaurants: the content columns ──────────────────────────────────────
-- name stays here, untranslated (spec §3). slug is the URL segment, the same
-- in every language. phone_*/map_url: NULL falls back to the destination's
-- (spec §6.4). archived_at: hidden for good while its bookings keep the row.
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS slug            text        CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 60),
  ADD COLUMN IF NOT EXISTS destination_id  text        REFERENCES destinations (id) ON UPDATE CASCADE,
  ADD COLUMN IF NOT EXISTS card_image_id   uuid        REFERENCES media (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS detail_image_id uuid        REFERENCES media (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS og_image_id     uuid        REFERENCES media (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS phone_e164      text        CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  ADD COLUMN IF NOT EXISTS phone_display   text        CHECK (btrim(phone_display) <> '' AND char_length(phone_display) <= 30),
  ADD COLUMN IF NOT EXISTS map_url         text        CHECK (map_url ~ '^https://' AND length(map_url) <= 2000),
  ADD COLUMN IF NOT EXISTS has_detail_page boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_published    boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS archived_at     timestamptz;

UPDATE restaurants SET slug = id WHERE slug IS NULL;
UPDATE restaurants SET destination_id = destination WHERE destination_id IS NULL;

UPDATE restaurants r
   SET card_image_id = m.id
  FROM media m
 WHERE r.card_image_id IS NULL
   AND m.pathname = '/assets/r-' || r.id || '.jpg';

-- DETAIL_PAGE_IDS: only Tàya House has a page today. Guarded on the image, so a
-- re-run never switches a page back on that an editor switched off.
UPDATE restaurants r
   SET detail_image_id = m.id, has_detail_page = true
  FROM media m
 WHERE r.id = 'taya-house'
   AND r.detail_image_id IS NULL
   AND m.pathname = '/assets/taya-hero.jpg';

ALTER TABLE restaurants
  ALTER COLUMN slug SET NOT NULL,
  ALTER COLUMN destination_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS restaurants_slug_key ON restaurants (slug);

ALTER TABLE restaurants DROP CONSTRAINT IF EXISTS restaurants_phone_pair;
ALTER TABLE restaurants ADD CONSTRAINT restaurants_phone_pair CHECK ((phone_e164 IS NULL) = (phone_display IS NULL));
-- A page draws its portrait (spec §6.4: the admin requires it when the page is on).
ALTER TABLE restaurants DROP CONSTRAINT IF EXISTS restaurants_detail_image;
ALTER TABLE restaurants ADD CONSTRAINT restaurants_detail_image CHECK (NOT has_detail_page OR detail_image_id IS NOT NULL);
-- A card a guest can see draws its picture.
ALTER TABLE restaurants DROP CONSTRAINT IF EXISTS restaurants_published_card;
ALTER TABLE restaurants ADD CONSTRAINT restaurants_published_card CHECK (NOT is_published OR card_image_id IS NOT NULL);

-- The phase-1 columns this phase replaces stay until phase 10 drops them
-- (spec §14.1 row 10). From here nothing reads them, and a restaurant added in
-- phase 7 need not fill the two that were NOT NULL (cuisines, meals and
-- slot_capacity have defaults already).
ALTER TABLE restaurants
  ALTER COLUMN type DROP NOT NULL,
  ALTER COLUMN destination DROP NOT NULL;
COMMENT ON COLUMN restaurants.type IS 'Phase 1, replaced by restaurant_i18n.type_label; dropped in phase 10.';
COMMENT ON COLUMN restaurants.destination IS 'Phase 1, replaced by destination_id; dropped in phase 10.';
COMMENT ON COLUMN restaurants.cuisines IS 'Phase 1, replaced by restaurant_cuisines; dropped in phase 10.';
COMMENT ON COLUMN restaurants.meals IS 'Phase 1, replaced by service_periods (006); dropped in phase 10.';
COMMENT ON COLUMN restaurants.slot_capacity IS 'Phase 1, replaced by service_periods.covers_per_slot (006); dropped in phase 10.';

-- ── restaurant_i18n ───────────────────────────────────────────────────────
-- story_label and highlights_title: NULL uses the registry's default ("Brand
-- Story", "At {name}"). The menu is one PDF per language: an uploaded file
-- (phase 7) or a link, never both.
CREATE TABLE IF NOT EXISTS restaurant_i18n (
  restaurant_id     text        NOT NULL REFERENCES restaurants (id) ON UPDATE CASCADE ON DELETE CASCADE,
  locale            text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  type_label        text        CHECK (btrim(type_label) <> '' AND char_length(type_label) <= 60),
  detail_kicker     text        CHECK (btrim(detail_kicker) <> '' AND char_length(detail_kicker) <= 100),
  story_label       text        CHECK (btrim(story_label) <> '' AND char_length(story_label) <= 40),
  story             text        CHECK (btrim(story) <> '' AND char_length(story) <= 1500),
  highlights_title  text        CHECK (btrim(highlights_title) <> '' AND char_length(highlights_title) <= 60),
  menu_pdf_media_id uuid        REFERENCES media (id) ON DELETE RESTRICT,
  menu_pdf_url      text        CHECK (menu_pdf_url ~ '^https://' AND length(menu_pdf_url) <= 2000),
  seo_title         text        CHECK (btrim(seo_title) <> '' AND char_length(seo_title) <= 120),
  seo_description   text        CHECK (btrim(seo_description) <> '' AND char_length(seo_description) <= 320),
  status            text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin            text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model          text,
  source_hash       text,
  reviewed_by       text,
  reviewed_at       timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text,
  PRIMARY KEY (restaurant_id, locale),
  CONSTRAINT restaurant_i18n_one_menu CHECK (menu_pdf_media_id IS NULL OR menu_pdf_url IS NULL)
);

-- Every restaurant's type label, copied from the column the cards read today.
INSERT INTO restaurant_i18n (restaurant_id, locale, type_label, origin)
SELECT r.id, 'en', r.type, 'seed'
  FROM restaurants r
 WHERE r.type IS NOT NULL
ON CONFLICT DO NOTHING;

-- Tàya House's page (TayaHero.tsx, DETAIL_SEO and CONTACT.tariffPdf in lib/data.ts).
-- Its type label row exists by now, so these columns are filled in place; the
-- IS NULL guard keeps a re-run off an edited page.
UPDATE restaurant_i18n
   SET detail_kicker   = 'A Wellness Dining Home · Furama Resort Danang',
       story           = 'Beneath the Lagoon Garden, the resort’s “Green Oasis in the Heart of the City” tells a journey from Mường Khụ, a land of stones, to Danang by the sea — with cooking classes led by Cơ Tu chef A Rất Thị Hép.',
       menu_pdf_url    = 'https://furamavietnam.com/wp-content/uploads/2026/03/Taya-CC-Tariff-A4-1-25.pdf',
       seo_title       = 'Tàya House — Furama Cuisine',
       seo_description = 'A wellness dining home beneath the Lagoon Garden at Furama Resort Danang, with Vietnamese cooking classes led by Cơ Tu chef A Rất Thị Hép.'
 WHERE restaurant_id = 'taya-house'
   AND locale = 'en'
   AND detail_kicker IS NULL AND story IS NULL AND menu_pdf_url IS NULL AND seo_title IS NULL AND seo_description IS NULL;

-- ── restaurant_cuisines ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS restaurant_cuisines (
  restaurant_id text    NOT NULL REFERENCES restaurants (id) ON UPDATE CASCADE ON DELETE CASCADE,
  -- A cuisine in use cannot be deleted; detach it from its restaurants first.
  cuisine_id    text    NOT NULL REFERENCES cuisines (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  sort_order    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (restaurant_id, cuisine_id)
);

CREATE INDEX IF NOT EXISTS restaurant_cuisines_cuisine_idx ON restaurant_cuisines (cuisine_id);

-- restaurants.cuisines holds English labels (002). A label with no cuisine
-- stops the migration with its name, as cuisineSlug() throws today, instead of
-- dropping out of every filter. Only restaurants still to be seeded count.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(DISTINCT c.label, ', ') INTO bad
    FROM restaurants r
    CROSS JOIN LATERAL unnest(r.cuisines) AS c(label)
   WHERE NOT EXISTS (SELECT 1 FROM restaurant_cuisines rc WHERE rc.restaurant_id = r.id)
     AND NOT EXISTS (SELECT 1 FROM cuisine_i18n ci WHERE ci.locale = 'en' AND ci.label = c.label);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'restaurants.cuisines holds label(s) with no cuisine: %; add them to migration 008''s cuisines, then migrate again', bad;
  END IF;
END $$;

-- In the array's order (Yum Food Village: International, Vietnamese, Thai).
INSERT INTO restaurant_cuisines (restaurant_id, cuisine_id, sort_order)
SELECT r.id, ci.cuisine_id, c.n * 10
  FROM restaurants r
  CROSS JOIN LATERAL unnest(r.cuisines) WITH ORDINALITY AS c(label, n)
  JOIN cuisine_i18n ci ON ci.locale = 'en' AND ci.label = c.label
 WHERE NOT EXISTS (SELECT 1 FROM restaurant_cuisines rc WHERE rc.restaurant_id = r.id)
ON CONFLICT DO NOTHING;

-- ── restaurant_highlights → restaurant_highlight_i18n ─────────────────────
-- The cards of a detail page (spec §6.4); 0 hides the section.
CREATE TABLE IF NOT EXISTS restaurant_highlights (
  id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurant_id text        NOT NULL REFERENCES restaurants (id) ON UPDATE CASCADE ON DELETE CASCADE,
  image_id      uuid        NOT NULL REFERENCES media (id) ON DELETE RESTRICT,
  sort_order    integer     NOT NULL DEFAULT 0,
  is_published  boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text
);

CREATE INDEX IF NOT EXISTS restaurant_highlights_restaurant_idx ON restaurant_highlights (restaurant_id, sort_order, id);

CREATE TABLE IF NOT EXISTS restaurant_highlight_i18n (
  highlight_id bigint      NOT NULL REFERENCES restaurant_highlights (id) ON DELETE CASCADE,
  locale       text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  title        text        CHECK (btrim(title) <> '' AND char_length(title) <= 80),
  detail       text        CHECK (btrim(detail) <> '' AND char_length(detail) <= 200),
  status       text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin       text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model     text,
  source_hash  text,
  reviewed_by  text,
  reviewed_at  timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text,
  PRIMARY KEY (highlight_id, locale)
);

-- TAYA_EXPERIENCES (lib/data.ts); their alt text went into media_i18n above.
INSERT INTO restaurant_highlights (id, restaurant_id, image_id, sort_order)
OVERRIDING SYSTEM VALUE
SELECT v.id, 'taya-house', m.id, v.sort_order
  FROM (VALUES (1, '/assets/taya-class.jpg', 10), (2, '/assets/taya-lounge.jpg', 20),
               (3, '/assets/taya-garden.jpg', 30), (4, '/assets/taya-stay.jpg', 40))
       AS v(id, pathname, sort_order)
  JOIN media m ON m.pathname = v.pathname
ON CONFLICT DO NOTHING;

INSERT INTO restaurant_highlight_i18n (highlight_id, locale, title, detail, origin)
VALUES
  (1, 'en', 'Vietnamese Cooking Class', 'Daily at 11:00 or 14:00 · VND 799,000++ per guest',      'seed'),
  (2, 'en', 'Healthy Drinks & Snacks',  'Served in the garden house, daily 10:00–22:00',            'seed'),
  (3, 'en', 'Private Gatherings',       'Outdoor celebrations and intimate events among the palms', 'seed'),
  (4, 'en', 'Cooking Class & Stay',     'From USD 420 · 2 nights for 2 guests',                     'seed')
ON CONFLICT DO NOTHING;

-- ── sections ──────────────────────────────────────────────────────────────
-- The home page's fixed blocks, in the design's order (no reordering: not a
-- page builder, spec §2). Their copy is registry keys; this row holds the
-- switch, the picture and the link. restaurants can never be hidden: the hero,
-- the cuisines, the finder and the tab bar all scroll to it (spec §6.5).
CREATE TABLE IF NOT EXISTS sections (
  key        text        PRIMARY KEY CHECK (key IN ('hero', 'film', 'finder', 'cuisines', 'restaurants', 'destinations',
                                                    'experiences', 'heritage', 'stories', 'offers', 'booking_bar')),
  is_visible boolean     NOT NULL DEFAULT true,
  image_id   uuid        REFERENCES media (id) ON DELETE RESTRICT,
  link_url   text        CHECK (link_url ~ '^https://' AND length(link_url) <= 2000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  CONSTRAINT sections_restaurants_visible CHECK (key <> 'restaurants' OR is_visible),
  -- The film plays a YouTube or Vimeo video; phase 7 parses the id.
  CONSTRAINT sections_film_video CHECK (
    key <> 'film' OR link_url ~ '^https://((www\.|m\.)?youtube\.com|youtu\.be|(player\.)?vimeo\.com)/'
  )
);

-- film: today's poster and no video yet ("THE FILM · COMING SOON").
-- heritage: CONTACT.story. experiences: its side picture.
INSERT INTO sections (key, image_id, link_url)
SELECT v.key, m.id, v.link_url
  FROM (VALUES ('hero', NULL, NULL),
               ('film', '/assets/hero-beach.jpg', NULL),
               ('finder', NULL, NULL),
               ('cuisines', NULL, NULL),
               ('restaurants', NULL, NULL),
               ('destinations', NULL, NULL),
               ('experiences', '/assets/chef.jpg', NULL),
               ('heritage', '/assets/heritage.jpg', 'https://furamavietnam.com/the-resort/'),
               ('stories', NULL, NULL),
               ('offers', NULL, NULL),
               ('booking_bar', NULL, NULL))
       AS v(key, pathname, link_url)
  LEFT JOIN media m ON m.pathname = v.pathname
ON CONFLICT DO NOTHING;

-- ── hero_slides ───────────────────────────────────────────────────────────
-- Alt text is the image's (media_i18n). image_mobile_id: the phone crop, used
-- by the first published slide only (phones show one slide).
CREATE TABLE IF NOT EXISTS hero_slides (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  image_id        uuid        NOT NULL REFERENCES media (id) ON DELETE RESTRICT,
  image_mobile_id uuid        REFERENCES media (id) ON DELETE RESTRICT,
  sort_order      integer     NOT NULL DEFAULT 0,
  is_published    boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text
);

-- HERO_SLIDES (lib/data.ts) and the phone crop of Hero.tsx.
INSERT INTO hero_slides (id, image_id, image_mobile_id, sort_order)
OVERRIDING SYSTEM VALUE
SELECT v.id, m.id, mm.id, v.sort_order
  FROM (VALUES (1, '/assets/hero-beach.jpg', '/assets/hero-hall-m.jpg', 10),
               (2, '/assets/hero-taya.jpg', NULL, 20),
               (3, '/assets/hero-indochine.jpg', NULL, 30))
       AS v(id, pathname, mobile_pathname, sort_order)
  JOIN media m ON m.pathname = v.pathname
  LEFT JOIN media mm ON mm.pathname = v.mobile_pathname
ON CONFLICT DO NOTHING;

-- ── experiences → experience_i18n ─────────────────────────────────────────
-- link_url NULL: the row links nowhere, as today (#experiences); the owner has
-- yet to give the targets (spec §15 item 16).
CREATE TABLE IF NOT EXISTS experiences (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  link_url     text        CHECK (link_url ~ '^https://' AND length(link_url) <= 2000),
  sort_order   integer     NOT NULL DEFAULT 0,
  is_published boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text
);

CREATE TABLE IF NOT EXISTS experience_i18n (
  experience_id bigint      NOT NULL REFERENCES experiences (id) ON DELETE CASCADE,
  locale        text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  title         text        CHECK (btrim(title) <> '' AND char_length(title) <= 80),
  blurb         text        CHECK (btrim(blurb) <> '' AND char_length(blurb) <= 200),
  status        text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin        text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model      text,
  source_hash   text,
  reviewed_by   text,
  reviewed_at   timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,
  PRIMARY KEY (experience_id, locale)
);

-- EXPERIENCES (lib/data.ts).
INSERT INTO experiences (id, sort_order) OVERRIDING SYSTEM VALUE
VALUES (1, 10), (2, 20), (3, 30)
ON CONFLICT DO NOTHING;

INSERT INTO experience_i18n (experience_id, locale, title, blurb, origin)
VALUES
  (1, 'en', 'Culinary Experiences',    'Tàya House cooking classes · Seafood & Steak Buffet · Champa dance nights', 'seed'),
  (2, 'en', 'Private Dining & Events', 'Weddings · Corporate · Celebrations · MICE dining',                         'seed'),
  (3, 'en', 'Furama Fabulous',         'Membership · Rewards · Dining privileges',                                  'seed')
ON CONFLICT DO NOTHING;

-- ── stories → story_i18n ──────────────────────────────────────────────────
-- Links out to an article (spec §2). The card's kicker is the category, then
-- the date when there is one ("Restaurant News · 9 Sep 2026"), formatted for
-- the language. story_i18n.href: the article in that language, if any.
CREATE TABLE IF NOT EXISTS stories (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  image_id     uuid        NOT NULL REFERENCES media (id) ON DELETE RESTRICT,
  href         text        NOT NULL CHECK (href ~ '^https://' AND length(href) <= 2000),
  published_on date,
  sort_order   integer     NOT NULL DEFAULT 0,
  is_published boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text
);

CREATE TABLE IF NOT EXISTS story_i18n (
  story_id    bigint      NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  locale      text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  category    text        CHECK (btrim(category) <> '' AND char_length(category) <= 60),
  title       text        CHECK (btrim(title) <> '' AND char_length(title) <= 160),
  href        text        CHECK (href ~ '^https://' AND length(href) <= 2000),
  status      text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin      text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model    text,
  source_hash text,
  reviewed_by text,
  reviewed_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  PRIMARY KEY (story_id, locale)
);

-- STORIES (lib/data.ts), its dates taken out of the kicker; the fourth has none.
INSERT INTO stories (id, image_id, href, published_on, sort_order)
OVERRIDING SYSTEM VALUE
SELECT v.id, m.id, v.href, v.published_on::date, v.sort_order
  FROM (VALUES
    (1, '/assets/story-dh-opening.jpg',  'https://www.furamadining.com/diem-den/tin/furama-dining-house-grand-opening-mot-ngoi-nha-bon-huong-vi-giua-long-an-thuong', '2026-09-09', 10),
    (2, '/assets/story-the-fan.jpg',     'https://www.furamadining.com/diem-den/tin/steakhouse-the-fan-hanh-trinh-4-nha-hang-noi-am-thuc-va-nghe-thuat-gap-nhau', '2026-09-05', 20),
    (3, '/assets/story-thai-siam.jpg',   'https://www.furamadining.com/diem-den/tin/thai-siam-kitchen-tu-mot-can-bep-thai-den-nhip-cau-am-thuc-va-van-hoa-viet-nam-thai-lan', '2026-09-03', 30),
    (4, '/assets/story-buffet-gala.jpg', 'https://furamavietnam.com/a-premium-central-vietnam-seafood-steak-buffet-gala-a-culinary-masterpiece-at-furama-resort-danang/', NULL, 40)
  ) AS v(id, pathname, href, published_on, sort_order)
  JOIN media m ON m.pathname = v.pathname
ON CONFLICT DO NOTHING;

INSERT INTO story_i18n (story_id, locale, category, title, origin)
VALUES
  (1, 'en', 'Restaurant News',      'Grand opening: one house, four flavours in An Thượng',    'seed'),
  (2, 'en', 'Restaurant News',      'Steakhouse The Fan, where fine food meets art',           'seed'),
  (3, 'en', 'Restaurant News',      'Thai Siam Kitchen, a bridge between Vietnam and Thailand', 'seed'),
  (4, 'en', 'Furama Resort Danang', 'Inside the Central Vietnam Seafood & Steak Buffet Gala',   'seed')
ON CONFLICT DO NOTHING;

-- ── offers → offer_i18n ───────────────────────────────────────────────────
-- bigint, to match reservations.offer_id (006). The card's detail line is
-- built from the price ("VND 888,000++ per guest") and the schedule, joined by
-- " · ". valid_from/valid_until are Da Nang calendar days; the reader caches
-- for hours and the daily cron expires content:offers (spec §6.2). The venue is
-- the restaurant's name unless venue_override says otherwise.
CREATE TABLE IF NOT EXISTS offers (
  id            bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurant_id text          NOT NULL REFERENCES restaurants (id) ON UPDATE CASCADE ON DELETE CASCADE,
  price_amount  numeric(14,2) CHECK (price_amount >= 0),
  currency      text          NOT NULL DEFAULT 'VND' CHECK (currency ~ '^[A-Z]{3}$'),
  price_basis   text          CHECK (price_basis IN ('plus_plus', 'net')),
  valid_from    date,
  valid_until   date,
  sort_order    integer       NOT NULL DEFAULT 0,
  is_published  boolean       NOT NULL DEFAULT true,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  updated_by    text,
  CONSTRAINT offers_price_pair CHECK ((price_amount IS NULL) = (price_basis IS NULL)),
  CONSTRAINT offers_valid_range CHECK (valid_from <= valid_until)
);

CREATE INDEX IF NOT EXISTS offers_restaurant_idx ON offers (restaurant_id);

CREATE TABLE IF NOT EXISTS offer_i18n (
  offer_id       bigint      NOT NULL REFERENCES offers (id) ON DELETE CASCADE,
  locale         text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  title          text        CHECK (btrim(title) <> '' AND char_length(title) <= 80),
  schedule       text        CHECK (btrim(schedule) <> '' AND char_length(schedule) <= 120),
  venue_override text        CHECK (btrim(venue_override) <> '' AND char_length(venue_override) <= 80),
  status         text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin         text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model       text,
  source_hash    text,
  reviewed_by    text,
  reviewed_at    timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text,
  PRIMARY KEY (offer_id, locale)
);

-- OFFERS (lib/data.ts), the price taken out of the detail text. No validity
-- dates: none of the offers hides today (the section lede's "valid until 31
-- December 2026" is copy); the owner sets them in phase 7.
INSERT INTO offers (id, restaurant_id, price_amount, currency, price_basis, sort_order)
OVERRIDING SYSTEM VALUE
VALUES
  (1, 'cafe-indochine', 888000, 'VND', 'plus_plus', 10),
  (2, 'taya-house',     799000, 'VND', 'plus_plus', 20),
  (3, 'hai-van-lounge', 450000, 'VND', 'net',       30)
ON CONFLICT DO NOTHING;

INSERT INTO offer_i18n (offer_id, locale, title, schedule, origin)
VALUES
  (1, 'en', 'Seafood & Steak Buffet Dinner',  'Nightly 18:30–22:00',   'seed'),
  (2, 'en', 'Vietnamese Cooking Class',       'Daily 11:00 or 14:00',  'seed'),
  (3, 'en', 'Afternoon Tea & Dessert Buffet', '~30 pastries, 12+ teas', 'seed')
ON CONFLICT DO NOTHING;

-- The booking keeps its date, time and party when an offer is deleted; it
-- loses only the link (spec §7.5 restores the offer under the same id).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservations_offer_id_fkey') THEN
    ALTER TABLE reservations
      ADD CONSTRAINT reservations_offer_id_fkey
      FOREIGN KEY (offer_id) REFERENCES offers (id) ON DELETE SET NULL;
  END IF;
END $$;

-- For the FK's ON DELETE and the admin's "bookings from this offer".
CREATE INDEX IF NOT EXISTS reservations_offer_idx ON reservations (offer_id) WHERE offer_id IS NOT NULL;

-- ── nav_items → nav_item_i18n ─────────────────────────────────────────────
-- One label per language, in natural case: the header uppercases it with CSS,
-- the menu overlay shows it as it is (spec §6.3 item 6). An item hides itself
-- when its section is hidden (spec §6.5). film and finder have no anchor.
CREATE TABLE IF NOT EXISTS nav_items (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  target_section text        NOT NULL REFERENCES sections (key) ON UPDATE CASCADE
                             CHECK (target_section NOT IN ('film', 'finder')),
  sort_order     integer     NOT NULL DEFAULT 0,
  is_published   boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text,
  CONSTRAINT nav_items_target_section_key UNIQUE (target_section)
);

CREATE TABLE IF NOT EXISTS nav_item_i18n (
  nav_item_id bigint      NOT NULL REFERENCES nav_items (id) ON DELETE CASCADE,
  locale      text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  -- 18: the one-line desktop header (spec §6.5); the admin warns past 14.
  label       text        NOT NULL CHECK (btrim(label) <> '' AND char_length(label) <= 18),
  status      text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin      text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model    text,
  source_hash text,
  reviewed_by text,
  reviewed_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  PRIMARY KEY (nav_item_id, locale)
);

-- NAV_LINKS (lib/data.ts) with the menu overlay's case (MENU_LABELS).
INSERT INTO nav_items (id, target_section, sort_order) OVERRIDING SYSTEM VALUE
VALUES (1, 'restaurants', 10), (2, 'destinations', 20), (3, 'experiences', 30),
       (4, 'offers', 40), (5, 'stories', 50), (6, 'heritage', 60)
ON CONFLICT DO NOTHING;

INSERT INTO nav_item_i18n (nav_item_id, locale, label, origin)
VALUES (1, 'en', 'Restaurants', 'seed'), (2, 'en', 'Destinations', 'seed'), (3, 'en', 'Experiences', 'seed'),
       (4, 'en', 'Offers', 'seed'), (5, 'en', 'Stories', 'seed'), (6, 'en', 'About', 'seed')
ON CONFLICT DO NOTHING;

-- ── social_links ──────────────────────────────────────────────────────────
-- The label is the platform's own name, written by the code (brand, not
-- translated). visible_locales NULL: every language (e.g. WeChat only for zh).
CREATE TABLE IF NOT EXISTS social_links (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform        text        NOT NULL
                  CHECK (platform IN ('facebook', 'instagram', 'youtube', 'tiktok', 'zalo', 'x', 'tripadvisor', 'wechat', 'kakao', 'line')),
  href            text        NOT NULL CHECK (href ~ '^https://' AND length(href) <= 2000),
  visible_locales text[]      CHECK (cardinality(visible_locales) >= 1 AND array_position(visible_locales, NULL) IS NULL),
  sort_order      integer     NOT NULL DEFAULT 0,
  is_published    boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text
);

-- SOCIALS (lib/data.ts). The TikTok handle awaits the owner (spec §15 item 14).
INSERT INTO social_links (id, platform, href, sort_order) OVERRIDING SYSTEM VALUE
VALUES
  (1, 'facebook',  'https://www.facebook.com/furamaresort',              10),
  (2, 'instagram', 'https://www.instagram.com/furamaculinaryworld/',     20),
  (3, 'youtube',   'https://www.youtube.com/user/furamaresortvietnam',   30),
  (4, 'tiktok',    'https://www.tiktok.com/@furama.dining.hous',         40)
ON CONFLICT DO NOTHING;

-- ── site_settings (007): the remaining columns ────────────────────────────
-- default_restaurant_id: the booking bar's first choice (NULL: the first
-- bookable restaurant). default_occasion: the finder's (NULL: any). The two
-- seeds ride on a DEFAULT that is dropped right after, as 006 did for
-- reservations.source: the existing row gets them, later rows do not, and a
-- re-run (the columns exist) changes nothing.
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS default_restaurant_id text    DEFAULT 'taya-house'
                                                         REFERENCES restaurants (id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_occasion      text    DEFAULT 'Dinner'
                                                         CHECK (default_occasion IN ('Breakfast', 'Lunch', 'Dinner', 'Drinks')),
  ADD COLUMN IF NOT EXISTS og_image_id           uuid    REFERENCES media (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS hero_autoplay_ms      integer NOT NULL DEFAULT 7000 CHECK (hero_autoplay_ms BETWEEN 3000 AND 20000);

ALTER TABLE site_settings
  ALTER COLUMN default_restaurant_id DROP DEFAULT,
  ALTER COLUMN default_occasion DROP DEFAULT;

-- ── identity sequences past the seeded ids ────────────────────────────────
-- Never moved back: a re-run after editors added rows keeps the sequence where it is.
SELECT setval('restaurant_highlights_id_seq', GREATEST((SELECT max(id) FROM restaurant_highlights), (SELECT last_value FROM restaurant_highlights_id_seq)));
SELECT setval('hero_slides_id_seq',           GREATEST((SELECT max(id) FROM hero_slides),           (SELECT last_value FROM hero_slides_id_seq)));
SELECT setval('experiences_id_seq',           GREATEST((SELECT max(id) FROM experiences),           (SELECT last_value FROM experiences_id_seq)));
SELECT setval('stories_id_seq',               GREATEST((SELECT max(id) FROM stories),               (SELECT last_value FROM stories_id_seq)));
SELECT setval('offers_id_seq',                GREATEST((SELECT max(id) FROM offers),                (SELECT last_value FROM offers_id_seq)));
SELECT setval('nav_items_id_seq',             GREATEST((SELECT max(id) FROM nav_items),             (SELECT last_value FROM nav_items_id_seq)));
SELECT setval('social_links_id_seq',          GREATEST((SELECT max(id) FROM social_links),          (SELECT last_value FROM social_links_id_seq)));
```

## 6. Generator and its output

`scripts/measure-assets.mjs`:

```js
#!/usr/bin/env node
/**
 * Prints the `media` seed rows of migration 008 for every file in
 * public/assets: path, type, pixel size and byte count, measured from the files
 * themselves. The migration's VALUES block is this output pasted verbatim, so
 * re-running the script after an asset changes shows the drift, and
 * test/integration/content-seed.test.ts re-measures every file against the
 * database. Reads nothing else and writes nothing.
 *
 *   node scripts/measure-assets.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Node strips the types of this .ts file itself (Node ≥ 22.18); it has no imports of its own.
import { imageSize, jpegIsRotated } from '../lib/media/image-size.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'public', 'assets');

const files = (await readdir(dir)).filter((f) => !f.startsWith('.')).sort();
const rows = [];
for (const file of files) {
  const bytes = new Uint8Array(await readFile(join(dir, file)));
  const size = imageSize(bytes);
  if (!size) throw new Error(`${file}: not a JPEG or PNG this script can measure`);
  if (size.contentType === 'image/jpeg' && jpegIsRotated(bytes)) {
    throw new Error(`${file}: EXIF orientation is set; store the displayed (rotated) size instead`);
  }
  rows.push(`    ('/assets/${file}', '${size.contentType}', ${size.width}, ${size.height}, ${bytes.length})`);
}
console.log(rows.join(',\n'));
```

`lib/media/image-size.ts`:

```ts
/**
 * Reads an image's pixel size from its header, with no dependency, for the
 * files under public/assets (spec §5.2 media.width/height). Erasable syntax
 * only and no imports: scripts/measure-assets.mjs loads this file directly
 * through Node's type stripping, and the content-seed test imports it, so the
 * migration's numbers and the test's check come from the same reader.
 * JPEG and PNG only: that is every static asset today. Uploads (phase 7) are
 * measured by the upload path, not here.
 */

export type ImageSize = { contentType: 'image/jpeg' | 'image/png'; width: number; height: number };

export function imageSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // IHDR is always the first chunk: width and height at bytes 16 and 20.
    return { contentType: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes);
  return null;
}

/**
 * Walks the JPEG segments to the first start-of-frame marker (SOF0–SOF15,
 * except DHT C4, JPG C8 and DAC CC), which carries the height then the width.
 * Ignores EXIF orientation on purpose: the browser applies it, so a rotated
 * file would need its width and height swapped. None of the assets has one
 * (`sips -g orientation`); the test pins that.
 */
function jpegSize(bytes: Uint8Array): ImageSize | null {
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    // Fill bytes and markers without a length.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bytes[at + 5] << 8) | bytes[at + 6];
      const width = (bytes[at + 7] << 8) | bytes[at + 8];
      return width > 0 && height > 0 ? { contentType: 'image/jpeg', width, height } : null;
    }
    at += 2 + length;
  }
  return null;
}

/** True when a JPEG carries an EXIF orientation other than 1 (normal), which would swap the displayed size. */
export function jpegIsRotated(bytes: Uint8Array): boolean {
  let at = 2;
  while (at + 4 < bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1];
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (marker === 0xda) return false; // start of scan: no more metadata
    if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === 'Exif') {
      const tiff = at + 10;
      const little = bytes[tiff] === 0x49;
      const u16 = (o: number) => (little ? bytes[o] | (bytes[o + 1] << 8) : (bytes[o] << 8) | bytes[o + 1]);
      const u32 = (o: number) => (little ? u16(o) | (u16(o + 2) << 16) : (u16(o) << 16) | u16(o + 2));
      const ifd = tiff + u32(tiff + 4);
      const count = u16(ifd);
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (u16(entry) === 0x0112) return u16(entry + 8) !== 1;
      }
      return false;
    }
    at += 2 + length;
  }
  return false;
}
```

**Output.** stdout is exactly the 39-row VALUES block in §5, from `('/assets/chef.jpg', 'image/jpeg', 456, 378, 57833)` to `('/assets/taya-stay.jpg', 'image/jpeg', 960, 720, 159098)`. Exit 0. Cross-checked against `sips -g pixelWidth -g pixelHeight`: 39 of 39 equal. stderr carries a harmless Node `MODULE_TYPELESS_PACKAGE_JSON` notice about the `.ts` import.

## 7. Tests (exact text in the patch)

**`test/fixtures/phase5-content.ts`** freezes the guest content at 8fe98f5, in 12 exported constants:
- `CUISINES_AT_8FE98F5`, `DESTINATIONS_AT_8FE98F5` (including the full footer lines), `HERO_SLIDES_AT_8FE98F5` (with mobile crop and alt), `HERO_AUTOPLAY_MS_AT_8FE98F5` (7000)
- `SECTIONS_AT_8FE98F5` (film, experiences, heritage), `EXPERIENCES_AT_8FE98F5`, `STORIES_AT_8FE98F5` (kickers as rendered), `OFFERS_AT_8FE98F5` (venue, title, detail, restaurant, note)
- `DETAIL_PAGES_AT_8FE98F5` (Tàya kicker, story, portrait and alt, SEO, menu PDF, call/map, 4 highlights), `NAV_AT_8FE98F5` (header capitals and menu case), `SOCIALS_AT_8FE98F5`, `SETTINGS_AT_8FE98F5`

It is the same pattern as PHASE1 in booking-seed.test.ts: the proof survives the deletion of what it mirrors.

**`test/integration/content-seed.test.ts`** (13 tests) uses its own fresh database, `furama_cuisine_seed008_<tag>_test`.

Block 1 (no database), to be deleted with the constants:
- **(a)** the fixture equals the `lib/data.ts` exports;
- **(b)** the fixture equals the component literals. The source is read with whitespace collapsed: Tàya's kicker and story each appear twice; the footer lines, `MENU_LABELS`, the hero alt and srcSet, `}, 7000);`, `occasion: 'Dinner'`, and the `alt=""` sites are all present.

Block 2 (database) rebuilds what a guest reads and compares it with the fixture:
- cuisines (order, label, image, decorative);
- destinations (card lines, picture, name, footer line `${name} · ${address} · ${phone_display}`; the dining-house E.164 is `+84859555759`);
- restaurants against their own phase-1 columns (slug, destination_id, type_label, ordered cuisine slugs, card path, card alt = name; no own phone or map);
- the detail page (Tàya only; kicker, story, NULL story_label/highlights_title, portrait and alt, SEO, menu URL, CALL/MAP from the destination, 4 highlights with alt; nobody else has highlights or page copy);
- hero slides and sections (all visible; film, experiences and heritage pictures and links);
- experiences;
- stories, with the kicker rebuilt by `dayFirst()`;
- offers, with the detail rebuilt by `price()`, the venue, the note, and no expiry;
- nav (label, `toUpperCase()` for the header), socials, site_settings;
- every seeded translation is `en`/`reviewed`/`seed`, and `content_strings` is empty;
- the decorative set equals exactly the `alt=""` images, every other file has EN alt, and decorative files have none;
- the media rows equal the files in `public/assets`, re-measured with `imageSize` (type, width, height, bytes), with no EXIF rotation, blur NULL, deleted_at NULL.

The recipes the phase-6 read path must use (pixel identity):

```ts
function dayFirst(iso: string): string { // "9 Sep 2026"; en-GB gives "9 Sept 2026" on Node 22.22 / ICU 77.1
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .formatToParts(new Date(`${iso}T00:00:00Z`)).map((part) => [part.type, part.value]));
  return `${p.day} ${p.month} ${p.year}`;
}
function price(amount: string, currency: string, basis: string): string { // currency style would insert U+00A0
  return `${currency} ${new Intl.NumberFormat('en').format(Number(amount))}${basis === 'plus_plus' ? '++' : ' net'} per guest`;
}
```

**`test/integration/migration-008.test.ts`** (18 tests) uses `furama_cuisine_migrate008_<tag>_test`.
- **Upgrade from 007 with a booking:** exact row counts per table; the booking is unchanged (version 1, no offer); 12 restaurants have slug = id, destination_id = destination and a card; only Tàya has a page; `type`/`destination` are nullable and `slug`/`destination_id` are NOT NULL.
- **Offer FK:** an unknown offer_id is refused; deleting an offer sets the link to NULL.
- **Sequences:** `nextval` = max + 1 for 6 tables.
- **Re-apply** after editor changes (offer title, Tàya page off, story, settings NULLed, heritage no longer decorative, a removed v-senses link, a renamed Thai label, a deleted newest story): counts unchanged, every edit kept, no link re-added, the label guard silent, and the sequence not moved back.
- **Guards:**
  - A pre-existing offer_id makes `migrate.mjs` fail; `media` does not exist afterwards and `_migrations` has no 008.
  - An unknown cuisine label raises 'label(s) with no cuisine: Fusion'.
- **Constraints:**
  - media path, size, PDF, type, 15 MB and blob rules, plus a blank alt;
  - RESTRICT for 9 named FKs (PG18 wording);
  - restaurants: the detail image needed; enabling the-fan **with** a portrait works (acceptance at the database level); the published-card rule, phone pair, E.164, slug unique and pattern, destination FK, map https; a phase-7-style insert without legacy columns works;
  - restaurant_i18n: blank, length, http, menu xor, locale FK, partial vi row;
  - cuisines: slug, RESTRICT in use, CASCADE with the restaurant, ON UPDATE CASCADE;
  - sections: key list, restaurants visible, film YouTube/Vimeo, `javascript:` refused;
  - nav: 18 characters, unique, film refused, FK;
  - offers: price pair, basis, ≥ 0, currency, date range, no-price row;
  - social links: platform, https, `visible_locales` empty or containing NULL refused;
  - site_settings: occasion, autoplay, FK, ON DELETE SET NULL;
  - a locale rename cascades and a locale delete cascades.

**`lib/media/image-size.test.ts`** (4 tests):
- `sips`-verified sizes of hero-beach 906×515, dest-dining-house 616×960, r-hai-van-lounge 126×94, cuisine-hotpot 45×45;
- a synthetic PNG of 1280×720;
- a PDF and a truncated header return null;
- a synthetic EXIF orientation 6 reads as rotated, 1 as not, and the asset as not.

## 8. Neon check SQL (read-only, one row per check with `ok`)

- **`db/checks/preflight-008.sql`** (10 checks): exactly 001–007 applied; none of the 20 tables exists; no `offer_id` set; all cuisine labels known; the 12 expected restaurant ids (each has `r-<id>.jpg`); type and destination present; the 4 destinations with no picture; one site_settings row; `en` is the default locale; `gen_random_uuid` exists.
- **`db/checks/postcheck-008.sql`** (10 checks): counts, then the restaurant, type, cuisine and card equivalences in SQL, Tàya's page, destination pictures, the offer FK, the settings values, the seed status, and the sequences.
- **Tested here:** 10 of 10 ok at 007; 10 of 10 ok after 008; on an already migrated database, preflight flags 3 rows.
- Run: `psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f db/checks/preflight-008.sql` (the controller, on the target branch's own direct URL).

Full text of both files follows.

`db/checks/preflight-008.sql`:

```sql
-- Read-only checks before applying 008_content.sql to a database at 007 (Neon).
-- Every row should say ok = true; a false row names what would stop or skew 008.
-- psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f db/checks/preflight-008.sql

SELECT 'migrations 001-007 applied, 008 not' AS check,
       (SELECT count(*) FROM _migrations WHERE name < '008') = 7
       AND NOT EXISTS (SELECT 1 FROM _migrations WHERE name >= '008') AS ok,
       (SELECT string_agg(name, ', ' ORDER BY name) FROM _migrations) AS detail
UNION ALL
SELECT 'no table 008 creates exists yet',
       NOT EXISTS (SELECT 1 FROM information_schema.tables
                    WHERE table_schema = current_schema()
                      AND table_name IN ('media', 'media_i18n', 'destination_i18n', 'cuisines', 'cuisine_i18n', 'restaurant_i18n',
                                         'restaurant_cuisines', 'restaurant_highlights', 'restaurant_highlight_i18n', 'sections',
                                         'hero_slides', 'experiences', 'experience_i18n', 'stories', 'story_i18n', 'offers',
                                         'offer_i18n', 'nav_items', 'nav_item_i18n', 'social_links')),
       NULL
UNION ALL
-- The guard in 008 stops on this.
SELECT 'no booking carries an offer_id',
       NOT EXISTS (SELECT 1 FROM reservations WHERE offer_id IS NOT NULL),
       (SELECT count(*)::text FROM reservations WHERE offer_id IS NOT NULL)
UNION ALL
-- The guard in 008 stops on this too.
SELECT 'every restaurants.cuisines label is one of the 8 cuisines',
       NOT EXISTS (SELECT 1 FROM restaurants r CROSS JOIN LATERAL unnest(r.cuisines) AS c(label)
                    WHERE c.label NOT IN ('Vietnamese', 'Italian', 'Thai', 'Japanese', 'Steak & Grill', 'Hotpot', 'International', 'Café & Lounge')),
       (SELECT string_agg(DISTINCT c.label, ', ') FROM restaurants r CROSS JOIN LATERAL unnest(r.cuisines) AS c(label))
UNION ALL
-- Each needs public/assets/r-<id>.jpg (restaurants_published_card would stop 008 otherwise).
SELECT 'the 12 restaurants of 002, each with a card picture in public/assets',
       (SELECT array_agg(id ORDER BY id) FROM restaurants) = ARRAY['cafe-indochine', 'chaoshan-hotpot', 'danaksara', 'don-ciprianis',
         'hai-van-lounge', 'hura-izakaya', 'pho-cuon', 'taya-house', 'thai-siam-kitchen', 'the-fan', 'v-senses-cafe', 'yum-food-village'],
       (SELECT string_agg(id, ', ' ORDER BY id) FROM restaurants)
UNION ALL
SELECT 'every restaurant has a type and a known destination',
       NOT EXISTS (SELECT 1 FROM restaurants r WHERE r.type IS NULL OR btrim(r.type) = ''
                      OR NOT EXISTS (SELECT 1 FROM destinations d WHERE d.id = r.destination)),
       NULL
UNION ALL
SELECT 'the four destinations of 004, without a card picture yet',
       (SELECT array_agg(id ORDER BY id) FROM destinations) = ARRAY['dining-house', 'future', 'mm', 'resort']
       AND NOT EXISTS (SELECT 1 FROM destinations WHERE card_image_id IS NOT NULL),
       (SELECT string_agg(id || ':' || coalesce(card_image_id::text, '-'), ', ' ORDER BY id) FROM destinations)
UNION ALL
SELECT 'site_settings has its one row (007)',
       (SELECT count(*) FROM site_settings) = 1,
       (SELECT email FROM site_settings)
UNION ALL
SELECT 'the en locale exists (every seeded translation is en)',
       EXISTS (SELECT 1 FROM locales WHERE code = 'en' AND is_default),
       NULL
UNION ALL
SELECT 'gen_random_uuid() is available (media.id)',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'gen_random_uuid'),
       NULL;
```

`db/checks/postcheck-008.sql`:

```sql
-- Read-only checks after applying 008_content.sql (Neon). Every row should say
-- ok = true. The same comparisons as test/integration/content-seed.test.ts,
-- restricted to what SQL alone can see (no files, no lib/data.ts).
-- psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f db/checks/postcheck-008.sql

SELECT 'row counts' AS check,
       (SELECT count(*) FROM media) = 39 AND (SELECT count(*) FROM media_i18n) = 20
       AND (SELECT count(*) FROM media WHERE is_decorative) = 19
       AND (SELECT count(*) FROM destination_i18n) = 4 AND (SELECT count(*) FROM cuisines) = 8
       AND (SELECT count(*) FROM restaurant_i18n) = 12 AND (SELECT count(*) FROM restaurant_cuisines) = 15
       AND (SELECT count(*) FROM restaurant_highlights) = 4 AND (SELECT count(*) FROM sections) = 11
       AND (SELECT count(*) FROM hero_slides) = 3 AND (SELECT count(*) FROM experiences) = 3
       AND (SELECT count(*) FROM stories) = 4 AND (SELECT count(*) FROM offers) = 3
       AND (SELECT count(*) FROM nav_items) = 6 AND (SELECT count(*) FROM social_links) = 4 AS ok
UNION ALL
SELECT 'restaurants: slug = id, destination_id = destination, card picture r-<id>.jpg',
       NOT EXISTS (SELECT 1 FROM restaurants r LEFT JOIN media m ON m.id = r.card_image_id
                    WHERE r.slug IS DISTINCT FROM r.id OR r.destination_id IS DISTINCT FROM r.destination
                       OR m.pathname IS DISTINCT FROM '/assets/r-' || r.id || '.jpg')
UNION ALL
SELECT 'restaurants: type_label (en) = type, and the card alt = name',
       NOT EXISTS (SELECT 1 FROM restaurants r
                     LEFT JOIN restaurant_i18n ri ON ri.restaurant_id = r.id AND ri.locale = 'en'
                     LEFT JOIN media_i18n mi ON mi.media_id = r.card_image_id AND mi.locale = 'en'
                    WHERE ri.type_label IS DISTINCT FROM r.type OR mi.alt IS DISTINCT FROM r.name)
UNION ALL
SELECT 'restaurants: restaurant_cuisines = cuisines, label for label, in order',
       NOT EXISTS (SELECT 1 FROM restaurants r
                    WHERE r.cuisines IS DISTINCT FROM ARRAY(SELECT ci.label FROM restaurant_cuisines rc
                                                              JOIN cuisine_i18n ci ON ci.cuisine_id = rc.cuisine_id AND ci.locale = 'en'
                                                             WHERE rc.restaurant_id = r.id ORDER BY rc.sort_order))
UNION ALL
SELECT 'only Tàya House has a page, with its portrait, story and 4 highlights',
       (SELECT array_agg(id) FROM restaurants WHERE has_detail_page) = ARRAY['taya-house']
       AND (SELECT m.pathname FROM restaurants r JOIN media m ON m.id = r.detail_image_id WHERE r.id = 'taya-house') = '/assets/taya-hero.jpg'
       AND (SELECT story IS NOT NULL AND seo_title = 'Tàya House — Furama Cuisine' FROM restaurant_i18n WHERE restaurant_id = 'taya-house' AND locale = 'en')
       AND (SELECT count(*) FROM restaurant_highlights WHERE restaurant_id = 'taya-house') = 4
UNION ALL
SELECT 'every destination has its card picture dest-<id>.jpg and an en row',
       NOT EXISTS (SELECT 1 FROM destinations d LEFT JOIN media m ON m.id = d.card_image_id
                    WHERE m.pathname IS DISTINCT FROM '/assets/dest-' || d.id || '.jpg'
                       OR NOT EXISTS (SELECT 1 FROM destination_i18n di WHERE di.destination_id = d.id AND di.locale = 'en'))
UNION ALL
SELECT 'reservations.offer_id has its FK, and no booking points at an offer',
       EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservations_offer_id_fkey')
       AND NOT EXISTS (SELECT 1 FROM reservations WHERE offer_id IS NOT NULL)
UNION ALL
SELECT 'site_settings: email kept, Tàya House and Dinner preselected, 7 s slides',
       (SELECT email IS NOT NULL AND default_restaurant_id = 'taya-house' AND default_occasion = 'Dinner'
               AND og_image_id IS NULL AND hero_autoplay_ms = 7000 FROM site_settings)
UNION ALL
SELECT 'every seeded translation is en, reviewed, seed',
       NOT EXISTS (SELECT 1 FROM (SELECT locale, status, origin FROM media_i18n UNION ALL SELECT locale, status, origin FROM destination_i18n
                     UNION ALL SELECT locale, status, origin FROM cuisine_i18n UNION ALL SELECT locale, status, origin FROM restaurant_i18n
                     UNION ALL SELECT locale, status, origin FROM restaurant_highlight_i18n UNION ALL SELECT locale, status, origin FROM experience_i18n
                     UNION ALL SELECT locale, status, origin FROM story_i18n UNION ALL SELECT locale, status, origin FROM offer_i18n
                     UNION ALL SELECT locale, status, origin FROM nav_item_i18n) t
                    WHERE locale <> 'en' OR status <> 'reviewed' OR origin <> 'seed')
UNION ALL
SELECT 'identity sequences are past the seeded ids',
       (SELECT last_value FROM offers_id_seq) >= 3 AND (SELECT last_value FROM stories_id_seq) >= 4
       AND (SELECT last_value FROM nav_items_id_seq) >= 6 AND (SELECT last_value FROM restaurant_highlights_id_seq) >= 4;
```

## 9. Lock and time profile

About 80 ms locally. Locks held until COMMIT:
- **ACCESS EXCLUSIVE:** `restaurants`, `site_settings`.
- **SHARE ROW EXCLUSIVE:** `reservations` (new bookings wait), `destinations`, `locales`.

Run it in the deploy window.

## 10. Errors hit

| Error | Cause | Fix |
|---|---|---|
| `zsh: command not found: psql -h localhost -d furama_cuisine_p6sch_test -At` (a psql command stored in `$P`, run as `$P -c ...`) | zsh does not split an unquoted variable into words, so the whole string was taken as one command name (the phase-5 Global Constraints warn about this) | Ran psql directly, with the SQL in a heredoc (`psql ... <<'SQL' ... SQL`) |
| migration-008 test 'a file in use cannot be deleted' failed: expected `/violates foreign key constraint/` but got `update or delete on table "media" violates RESTRICT setting of foreign key constraint "sections_image_id_fkey" on table "sections"` | Postgres 18 words an ON DELETE RESTRICT refusal differently from a NO ACTION one | Each of the 9 media references now asserts `/violates RESTRICT setting of foreign key constraint "<name>"/` with the exact constraint name, which is a stronger check |
| Mutation M2 (hero-taya.jpg no longer decorative) was not caught by content-seed.test.ts | A file with no alt row renders `alt=""` whether or not it is decorative, so the rendered-alt comparison could not see the flag. The flag still matters: phase 9's alt generator skips decorative files. | Added a test that pins the decorative set to exactly the images drawn with `alt=""` (from the fixture), requires every other file to have EN alt text, and forbids alt rows on decorative files. M2 is now caught. |
| Mutation R2 (`setval(max(id))`, which can move a sequence back) was not caught by migration-008.test.ts | The re-apply scenario only added a row, so max(id) equalled last_value and both forms gave the same result | The scenario adds two stories, deletes the newest, then re-applies and expects nextval = deleted id + 1. R2 is now caught. |
| Mutation R4 (restaurant_cuisines re-seed without the per-restaurant NOT EXISTS guard) was not caught | The scenario removed the yum-food-village/thai link and also renamed the Thai label; the rename alone stopped the re-seed from matching, which masked the missing guard | Split into two edits: remove the v-senses-cafe/cafe-lounge link (label unchanged, so only the guard keeps it out), and rename the Thai label (proves the unknown-label guard stays silent on a re-run). R4 and the new R9 are both caught. |
| Lint went from 19 to 20 warnings: `import(no-named-as-default-member)` "pg" also has a named export "Pool" (content-seed.test.ts) | Used `import pg from 'pg'` with `new pg.Pool` | `import { Pool } from 'pg'`, as db/client.ts does. Lint is back to 19 (the baseline). |
| Node prints `[MODULE_TYPELESS_PACKAGE_JSON] Warning` on stderr when scripts/measure-assets.mjs imports ../lib/media/image-size.ts | Node's type stripping loads a .ts file in a package without "type", detects ESM syntax and reparses it | Accepted: stdout (the SQL rows) is unaffected and the exit code is 0. Renaming to .mts would break the extensionless TS imports, and adding `"type": "module"` would affect the whole app. Run with `node --no-warnings` if the noise matters. |
| A comment in content-seed.test.ts claimed en-GB prints 'Sept' from 'ICU 72+' | Observed only on Node 22.22 with ICU 77.1 | Comment changed to the observed fact (Node 22.22, ICU 77.1); typecheck and lint re-run green; patch regenerated |
| (Investigated) The main repo HEAD moved from 8fe98f5 to 4f67931 during the spike | The controller committed docs/superpowers/ledgers/2026-10-03-phase-5-ledger.md | Verified the commit changes only that docs file (no db/lib/components/app/test/public/e2e paths), its phase-6 items are already covered, and `git apply --check` of the spike patch passes on 4f67931 |

## 11. Package versions

- next@16.3.7, react@19.3.0, typescript@7.0.2, pg@8.23.0, vitest@5.0.3, @playwright/test@1.63.0, oxlint@1.86.0: all unchanged.
- No new packages: the image-size reader is dependency-free (sharp is installed only as Next's optional dependency and is not used).
- Local runtime: Node v22.22.0 (ICU 77.1, CLDR 47.0, type stripping on by default since 22.18), PostgreSQL 18.3 (Homebrew).
- CI and Vercel run Node 24: its ICU output for the day-first date recipe was not verified (no Node 24 locally). The outline pins the recipe with a unit test, which CI runs on Node 24.

## 12. The spike's recommended task breakdown

T1. Schema and seed (this spike, ready to lift from the patch).
- Files: 008_content.sql, scripts/measure-assets.mjs, lib/media/image-size.ts (+ test), test/fixtures/phase5-content.ts, test/integration/content-seed.test.ts, test/integration/migration-008.test.ts, db/checks/preflight-008.sql and postcheck-008.sql.
- Gate: unit + integration 71 files / 941 tests; E2E and visual unchanged (old code on the new schema: 151 + 1 skipped, 8/8).
- It is expand-only, so the controller can apply it to Neon before any code ships.

T2. Switch every SQL reader off the legacy columns.
- Files: db/queries.ts, lib/server/booking/rules.ts:56/104, config.ts:389, recipients.ts:39, admin restaurant options.
- Read destination_id, restaurant_cuisines and restaurant_i18n instead.
- The booking path treats is_published = false or archived_at as restaurant_unavailable.
- groupPhone = COALESCE(restaurant, destination), with a null-phone test (phase-4 deferral).
- Add a guard test against r.type, r.destination, r.cuisines, r.meals and slot_capacity in app SQL.
- Every list query orders by sort_order, id (phase-4 deferral).

T3. Content read layer.
- lib/server/content/*.queries.ts with 'use cache' loaders, one per spec §6.2 tag; locale is a parameter.
- Per-field EN fallback and the serve_machine rule, as loadStringRows does.
- A media DTO {src, width, height, alt, decorative}.
- offers use cacheLife('hours') and filter valid_from/valid_until on Da Nang's today.
- Format story dates and offer prices on the server, with the recipes in §7.

T4. Registry (outline: phase 7).
- Add the section-copy and UI keys from the §2 map, with screen, vars and context.
- Extend ADMIN_SCREENS (cuisines, destinations, experiences, heritage, stories, offers, restaurants).
- CLIENT_KEYS grows as components move to t().

T5. Home and chrome components read props, not lib/data.
- CmsImage (with a decorative prop; the film poster keeps alt="").
- Nav: one label, with CSS uppercase on .hdr-link.
- Footer from destinations, social_links and site_settings.
- Privacy {email} from site_settings, and one reader of site_settings.email.
- saveSharedInbox calls updateTag(content:contact); rewrite the "Từ đợt 6…" sentence.

T6. Generic detail page.
- generateStaticParams from has_detail_page; generateMetadata from seo_* with the template fallback and the M7 not-found title.
- Decide dynamicParams (phase-2 ruling 8).
- CALL/MAP/MENU fallbacks; the highlights section is hidden at 0; 'More at' is filtered by destination_id.
- MobileBar column count; the restaurant phone falls back to the destination's.

T7. Offers.
- /api/cron/daily at 17:05 UTC calling revalidateTag('content:offers', {expire: 0}), plus vercel.json and CRON_SECRET.
- The booking form sends offerId; the action checks it is published, valid today and of the same restaurant, and writes reservations.offer_id.
- Decide what replaces the 'Offer: …' note prefill (owner).
- The admin booking page and the staff email name the offer.

T8. Contract.
- Delete the lib/data.ts constants in §3 and the content-seed block 1.
- Keep FALLBACK_PHONE, Meal, MEALS, SLOTS, and MEAL_LABELS (phase 7).
- Acceptance E2E: switching has_detail_page on (with detail_image_id and an EN story) for another restaurant makes /en/restaurants/<slug> work; visual 8/8 at ratio 0; never --update-snapshots.

T9. Neon window (controller).
- Run preflight-008.sql (all ok), apply 008 with migrate.mjs, then run postcheck-008.sql (all ok).
- Do it before or with the phase-6 deploy, since the old code is verified to work on the new schema.

## 13. Risks and open questions

1. Pixel identity: en-GB formats a short month as '9 Sept 2026' (Node 22.22, ICU 77.1), but the story kickers read '9 Sep 2026'. Use en-US parts in day-first order for 'en' (recipe in §7), and format on the server: Stories is a client component, and browser formatting would also risk a hydration mismatch. The Node 24 (CI) output is unverified.
2. Pixel identity: Intl currency style ('VND 888,000') inserts U+00A0 after the code. Format only the number and keep '{currency} {amount}' in the template.
3. Pixel identity: nav labels are stored once, in natural case ('About'), but .hdr-link has no text-transform. Phase 6 must add uppercase on the header class, or the header changes. The same check applies to every registry string shown in capitals: each class needs text-transform, or the stored value stays in capitals.
4. Film poster: hero-beach.jpg carries slide 1's alt ('Dining at Furama Cuisine'), while FilmModal draws it with alt="". CmsImage needs a context `decorative` prop, or the accessibility tree changes (pixels do not).
5. Restaurant card alt is seeded as the restaurant name, a copy. A rename in phase 7 leaves the alt stale unless the editor syncs it or the read path uses `alt ?? name`. The alternative is no alt row plus a name fallback, which breaks the invariant that every non-decorative image has EN alt. Decide in the phase-6 plan.
6. Offers: the section lede promises 'valid until 31 December 2026', but valid_until is seeded NULL. Seeding the date would hide the offers on 2027-01-01 and break the visual and E2E runs after that date, since the server clock is not frozen. Owner decision in phase 7.
7. Offers: spec §14.1 row 6 says the booking form sends offerId. Whether the drawer still pre-fills 'Offer: <title>' in the guest note, or shows the offer another way, is undecided. It is not in the visual baselines.
8. Dining House phone_display '0859 555 759' (no +84) stays for pixel identity, pending owner confirmation (spec §15 item 14). The footer tel: link changes from national 0859555759 (CONTACT) to E.164 +84859555759 (destinations); this is invisible and better.
9. The TikTok handle @furama.dining.hous is still unverified (spec §15 item 14).
10. Legacy restaurants.type and restaurants.destination become nullable in 008. If phase 6 misses a reader, a restaurant created in phase 7 silently drops out of destination recipients, closures or the catalogue. The guard test in T2 is required.
11. The booking path checks only booking_enabled today. It must also refuse is_published = false and archived_at, or a hidden restaurant stays bookable through the API.
12. The database cannot require 'EN row present with type_label, name, label…' without hard-coding 'en' (the default locale is data). The phase-7 save actions must enforce it, and the read path must tolerate NULL EN fields.
13. DB guards are stricter than the spec text: restaurants_detail_image (spec §6.4 says the admin requires the portrait) and restaurants_published_card. The phase-6 acceptance test must set detail_image_id when switching a page on; the migration test proves this works.
14. Re-applying 008 by hand brings back seeded rows an editor deleted (ON CONFLICT DO NOTHING; the same as 004's seeds). migrate.mjs never re-applies a file. Edits survive a re-apply (tested). (Outline: closed by the empty-table guard.)
15. Identity sequence names are literal (<table>_id_seq). migration-008.test pins them through nextval.
16. social_links.visible_locales is a text[] with no FK, so a locale rename does not cascade into it. The locale editor (phase 8) must rewrite the arrays.
17. Cross-table invariants are not enforced in SQL: no media_i18n for PDFs, no alt on decorative files, the menu PDF media being a PDF, the offer's restaurant matching the booking's restaurant, image_mobile_id used only on the first slide. The tests assert the seed; phases 6 and 7 must enforce the rest in code.
18. Neon: 008 holds ACCESS EXCLUSIVE locks on restaurants and site_settings, and SHARE ROW EXCLUSIVE on reservations, for the transaction (about 80 ms locally, one round trip). Uncached guest reads and new bookings wait briefly. Run it in the deploy window.
19. Not investigated here (read-path spikes): the phase-4 residual (a guest RSC request answered 404 with x-nextjs-postponed while updateTag('restaurants') ran), phase-2 ruling 7 (a raw 500 from an expired static route while the database is down), dynamicParams for random slugs, and the M7 soft-404 title.
20. Open: should the FALLBACK_PHONE in code (the resort number) become a site_settings column? It is not in the spec, and the error pages must render without the database, so a code copy stays either way.

## 14. Spec deviations proposed by the spike

1. Spec §14.1 row 10 deletes the content constants of lib/data.ts in phase 10. Recommendation: delete each one in phase 6 once nothing reads it (§3 list). Only the database columns need phase 10's contract step; the frozen fixture keeps the equivalence proof.
2. sections has is_visible and no sort_order or is_published, and keeps the fixed design order. Spec §5.2 says every main table has sort_order and is_published, but sections is not a list (no page builder, spec §2).
3. Constraints added beyond the spec text: restaurants_detail_image, restaurants_published_card, nav_items UNIQUE(target_section) and NOT IN ('film','finder'), the media static/blob/dimension CHECKs, non-blank CHECKs on every translatable column, generous length caps, https-only links, and the offers price-pair and date-range CHECKs.
4. restaurants.type and restaurants.destination are made nullable in 008 (an expand step, so phase-7 inserts need not fill dead columns). The spec only says phase 10 drops them.
5. The spec does not set the reservations.offer_id FK's delete behaviour. Chosen: ON DELETE SET NULL plus a partial index; 008 guards against pre-existing values.
6. offers.valid_from and valid_until are seeded NULL, although the offers lede says 'valid until 31 December 2026' (see risks).
7. Seeds use fixed ids (OVERRIDING SYSTEM VALUE) with ON CONFLICT (id) DO NOTHING, then setval(GREATEST(max(id), last_value)). The spec only requires ON CONFLICT DO NOTHING, which is met.
8. media_i18n alt is seeded for restaurant card images (the name, as RestaurantCard renders it) and for the hero-hall-m phone crop (slide 1's alt). The spec does not specify these.
9. story_label and highlights_title are seeded NULL for Tàya House; the registry defaults 'Brand Story' and 'At {name}' render identically. The future destination's name is NULL (none exists today).
10. site_settings defaults are seeded with the DEFAULT-then-DROP DEFAULT pattern of 006, not an UPDATE, so a re-run cannot overwrite an edit.
11. The social_links platform enum is chosen here: facebook, instagram, youtube, tiktok, zalo, x, tripadvisor, wechat, kakao, line.
12. blur_data_url stays NULL and phase 6 draws no blur placeholder (pixel identity). The spec lists the column; phase 7 fills it on upload.
13. No content_strings rows are seeded. Section copy and UI text become registry keys with defaults (spec §8 allows this); the registry's ADMIN_SCREENS must gain 7 screens that spec §7.2 already lists.

## 15. User steps

1. Owner: confirm the Dining House phone number and its display form (0859 555 759 today, with no +84) and the TikTok handle @furama.dining.hous (spec §15 item 14). 008 keeps today's values so the site stays pixel-identical.
2. Owner: decide whether the three offers really end on 31 December 2026. If they do, set valid_until in the phase-7 editor; until then they never hide.
3. Owner: decide whether choosing VIEW OFFER should still pre-fill 'Offer: <title>' in the guest's note, now that the booking records the offer itself (reservations.offer_id).
4. Owner (non-blocking): link targets for the 3 Experiences rows and a YouTube or Vimeo film URL (spec §15 item 16). Both are NULL in 008, as on the site today.
5. Controller, in the phase-6 deploy window: run db/checks/preflight-008.sql on Neon (all rows ok), apply 008 with scripts/migrate.mjs (unpooled URL), then run db/checks/postcheck-008.sql (all rows ok). The phase-5 code was verified to build and pass E2E and visual 8/8 on a database with 008, so the migration can go first.
