# Inventory of all guest-visible content and a proposed Postgres content model with admin-added locales (Furama Cuisine CMS)

# 1. Scope and method

I read every file under `components/` (24 files), `app/` (7 files), `lib/data.ts`, `lib/booking.ts`, `db/` (both migrations, `queries.ts`, `client.ts`), plus the CSS in `styles/` where layout fixes item counts. Line numbers below are 1-indexed against the clean `main` checkout (commit c1bff63).

Classification legend:
- **A**: entity collection (rows the admin adds, removes, reorders, shows or hides).
- **B**: singleton or section settings (section copy, images, links, SEO).
- **C**: UI microcopy. This is interface text and belongs in an admin-editable "ui strings" dictionary.
- **L**: locked brand text or glyphs. The admin should not edit these.

---

# 2. Inventory by surface

## 2.1 Global layout and SEO (`app/layout.tsx`)
| Content | Where | Class | Notes |
|---|---|---|---|
| `<title>` "Furama Cuisine — Many Flavours. Many Destinations." | layout.tsx:25 | B (seo.home) | |
| meta description | layout.tsx:26-27 | B | |
| OG title "Furama Cuisine" and OG description "People · Culture · Great Food — …" | layout.tsx:29-30 | B | No OG image is set today. Add `og_image_id`. |
| `<html lang="en">` hard-coded | layout.tsx:58 | n/a | Must come from `locales.bcp47`. |
| `revalidate = 3600` | layout.tsx:36 | n/a | Admin writes should invalidate on demand: `updateTag` inside Server Actions (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/updateTag.md:6-12) or `revalidateTag(tag,'max')` (revalidateTag.md:23,35). |
| theme colour, favicon (`app/icon.svg`) | layout.tsx:42, icon.svg | L | Design or brand. Not editable. |

## 2.2 Header (`components/site/Header.tsx`)
| Content | Where | Class |
|---|---|---|
| Logo "FURAMA" / "CUISINE" and compact wordmark "FURAMA CUISINE" | :48-49, :120 | L |
| Nav labels (6): RESTAURANTS, DESTINATIONS, EXPERIENCES, OFFERS, STORIES, ABOUT, each with a section anchor target | data.ts:146-153, rendered :53-57 | A (nav_items) |
| "SEARCH" | :62 | C |
| Language button shows the code (EN) | :72 | from `locales.short_label` |
| Language names "English", "Tiếng Việt" | :6-9 | from `locales.native_name` |
| "RESERVE" (twice) | :99, :124 | C |
| aria "Main", "Language", "Open menu" | :52, :76, :126 | C |

## 2.3 Menu overlay (`components/overlays/MenuOverlay.tsx`)
| Content | Where | Class | Notes |
|---|---|---|---|
| A second, title-case copy of the nav labels (`MENU_LABELS`) | :7-14 | A (same nav_items) | Duplicates data.ts:146-153 in different casing. `.hdr-link` has no `text-transform` (styles/layout.css:122-134), so the header copy is stored in caps. Store one label and add `text-transform:uppercase` to `.hdr-link`. |
| "Search" | :59 | C | |
| "RESERVE A TABLE" | :68 | C | |
| EN/VI buttons hard-coded | :72-83 | locales | |
| Tagline "PEOPLE \| CULTURE \| GREAT FOOD" | :85, also Footer.tsx:24 | B (footer) | |
| aria "Menu", "Close menu", "Sections"; wordmark | :35, :38, :43, :37 | C / L | |

## 2.4 Mobile tab bar (`components/site/MobileBar.tsx`)
| Content | Where | Class | Notes |
|---|---|---|---|
| Home bar: EXPLORE, RESTAURANTS, RESERVE | :43, :46, :49 | C | Fixed 3-column grid (layout.css:353-355). Not an editable list. |
| Detail bar: CALL, MAP, MENU, RESERVE | :12, :14, :17, :27 | C | Fixed 4-column grid (layout.css:357-359). Hard-coded to `CONTACT.resortPhone`, `CONTACT.map` and `'taya-house'` (:12, :13, :23-24). |
| Menu PDF URL `CONTACT.tariffPdf` | :57, data.ts:162 | A (per restaurant, per locale) | |
| aria "Restaurant actions", "Sections" | :11, :34 | C | |

## 2.5 Hero (`components/home/Hero.tsx`) and film modal (`components/overlays/FilmModal.tsx`)
| Content | Where | Class | Notes |
|---|---|---|---|
| Slides (3): desktop images hero-beach, hero-taya, hero-indochine | data.ts:140-144, Hero.tsx:18-43 | A (hero_slides) | The `alt` values in data.ts ("Hero slide 1…3") are never used. |
| Mobile art-directed crop `/assets/hero-hall-m.jpg` | Hero.tsx:29 | A (slide 1 only) | Phones show only the first slide (home.css:66-70). |
| Alt "Dining at Furama Cuisine" on slide 1; `alt=""` on the others | Hero.tsx:32, :39 | media alt | |
| Kicker "People · Culture · Great Food" | :51 | B | |
| Title in three lines: "Many Flavours." / "Many Destinations." / "One Furama Cuisine." | :57, :62, :67 | B | **Line 2 is desktop-only** (`.hero-title-mid`, home.css:163-172), so lines 1+3 must read on their own. Store as three fields. |
| Lede | :73-74 | B | Desktop-only (home.css:174-188). |
| CTAs: EXPLORE OUR RESTAURANTS, WATCH THE FILM, FIND A RESTAURANT | :79, :86, :90 | C (hero) | FIND is mobile-only; EXPLORE and FILM are desktop-only (home.css:210-237, 261-280). |
| Dot aria "Slide {n}" | :99 | C | |
| Film: poster hero-beach.jpg, title "One Furama Cuisine", sub "THE FILM · COMING SOON" | FilmModal.tsx:28, :33, :34 | B (film section) | There is no video URL anywhere. Add `video_url` and a show/hide toggle that also hides the WATCH THE FILM button. |
| Film aria "Furama Cuisine film", "Close film" ×2 | FilmModal.tsx:21-23 | C | |
| Autoplay `% 3` and 7000 ms | SiteProvider.tsx:447-448 | n/a | **Assumes exactly 3 slides.** |

## 2.6 Finder and finder sheet (`components/home/Finder.tsx`, `components/overlays/FinderSheet.tsx`)
| Content | Where | Class |
|---|---|---|
| aria and sheet title "Find a restaurant" | Finder.tsx:27; FinderSheet.tsx:21, :33 | C |
| Labels Location / Cuisine / Occasion / Destination | Finder.tsx:32,42,49,56; FinderSheet.tsx:40,46,52 | C |
| Options "Da Nang", "More cities", "Coming soon" | Finder.tsx:36-37 | C (or a city list) |
| "All cuisines", "Any occasion", "Any destination" | Finder.tsx:8, :13, :18 | C |
| Occasion options are the meal enum Breakfast/Lunch/Dinner/Drinks, shown raw | data.ts:46, Finder.tsx:14 | C (`meal.*` labels) |
| "SHOW RESTAURANTS" | Finder.tsx:64; FinderSheet.tsx:59 | C |
| Defaults: location 'Da Nang', occasion 'Dinner' | SiteProvider.tsx:113-118 | B (site_settings) |

## 2.7 Cuisines (`components/home/Cuisines.tsx`)
| Content | Where | Class | Notes |
|---|---|---|---|
| "Explore by Cuisine", "ALL CUISINES →" | :18, :30 | B/C | |
| 8 cuisines, each a label plus an image `cuisine-{slug}.jpg` | data.ts:20-29, :174; :35-43 | A (cuisines) | Image is `alt=""` (:73), which is fine because the label sits next to it. |
| Filtering compares the **English label** | :40, SiteProvider.tsx:199, Restaurants.tsx:15 | n/a | **Breaks once labels are translated.** Switch to slug keys. |

## 2.8 Restaurants grid (`components/home/Restaurants.tsx`, `RestaurantCard.tsx`)
| Content | Where | Class | Notes |
|---|---|---|---|
| "Our Restaurants", "VIEW ALL RESTAURANTS →" | Restaurants.tsx:32, :41 | B/C | |
| "Showing {n} of {total} restaurants", "No matches" | :49-50 | C (ICU) | |
| ", remove filter" (screen-reader only), "CLEAR ALL" | :58, :62 | C | |
| Empty state: "No restaurants match these filters" / "Try another cuisine, occasion or destination." / "SHOW ALL RESTAURANTS" | :75, :76, :78 | C | |
| 12 restaurants: id, name, type, destination, cuisines[], meals[], slot_capacity, sort_order | 001_init.sql:5-16; 002_seed_restaurants.sql:5-17 | A | |
| Card image `/assets/r-{id}.jpg`, alt = name | RestaurantCard.tsx:29-30, data.ts:173 | A | |
| Card tag "View restaurant" vs "Reserve a table", chosen by `id === 'taya-house'` | RestaurantCard.tsx:15, :36 | C, plus a `has_detail_page` flag | |

## 2.9 Destinations (`components/home/Destinations.tsx`)
| Content | Where | Class | Notes |
|---|---|---|---|
| "Our Destinations", lede "Different places. One culinary family." | :19, :22 | B | |
| 4 cards (3 venues and a "Future Locations" teaser). Each has a title in exactly 2 lines and a blurb in exactly 2 lines, joined with `<br/>` | data.ts:57-62; :78-86 | A (destinations) | |
| Card image `/assets/{slot}.jpg`, `alt=""` | :68-69 | A | |
| Count "{n} restaurants →" / "Coming soon"; screen-reader text "{title} — {count}" | :41-42, :97 | C (ICU plural) | |
| Destination names used in dropdowns and meta ("Furama Resort Danang"…) | data.ts:31-35 | A (destination.name) | |
| `DestKey` is a hard-coded TS union | data.ts:2 | n/a | Must become a FK to `destinations`. |
| Journey dots at fixed `[12.5, 37.5, 62.5, 87.5]` | :29; line inset 12.5% home.css:626-627 | n/a | **Assumes exactly 4 cards.** |

## 2.10 Experiences (`components/home/Experiences.tsx`)
| Content | Where | Class | Notes |
|---|---|---|---|
| Image `/assets/chef.jpg`, alt "A Furama chef at work" | :14 | B | |
| Eyebrow "Experiences"; title in 2 lines "More than a meal." / "A meaningful experience." | :19, :22-24 | B | |
| 3 rows of title + blurb | data.ts:64-68 | A (experiences) | Every row links to `#experiences` (:41), i.e. nowhere. Needs a `link_url`. The React key is the title (:29). |

## 2.11 Heritage (`components/home/Heritage.tsx`)
| Content | Where | Class | Notes |
|---|---|---|---|
| Background `/assets/heritage.jpg`, `alt=""` | :14-15 | B | |
| Kicker "Since 1997 · Furama Resort Danang"; title in 2 lines | :25, :28-30 | B | Fixed height `clamp(440px,35.5vw,560px)` with `overflow:hidden` (home.css:855-856). Needs length limits. |
| CTA "OUR STORY" → `CONTACT.story` | :40, :35, data.ts:163 | B | |

## 2.12 Stories (`components/home/Stories.tsx`)
| Content | Where | Class | Notes |
|---|---|---|---|
| "Stories from our Kitchens", lede | :16, :19 | B | |
| 4 stories: image, kicker, title, external href | data.ts:70-99 | A (stories) | The kicker hard-codes the date inside a string ("Restaurant News · 9 Sep 2026"). Story 4 has no date (data.ts:95). Model as category + optional `published_on`, formatted with Intl. The `slot` field is unused. Images are `alt=""` (:53). |

## 2.13 Offers (`components/home/Offers.tsx`)
| Content | Where | Class | Notes |
|---|---|---|---|
| "Offers"; lede with "…valid until 31 December 2026." | :16, :19-20 | B | The validity date is buried in copy. Move it to per-offer `valid_until`. |
| 3 offers: venue, title, detail (price and schedule as free text, e.g. "VND 888,000++ per guest · Nightly 18:30–22:00"), restaurant FK, note | data.ts:101-131 | A (offers) | `venue` repeats the restaurant name. `note` is pre-filled into the guest's free-text note (SiteProvider.tsx:281), so staff see guest-language text. Store `reservations.offer_id` instead. |
| "VIEW OFFER" | :48 | C | |

## 2.14 Booking bar (`components/booking/BookingBar.tsx`)
| Content | Where | Class |
|---|---|---|
| "Where would you like to dine?" | :54 | B/C |
| Labels Destination/Restaurant/Date/Time/Guests | :61, :68, :75, :82, :89 | C |
| Notes "Today", "Tomorrow", "Full", "{n} left", meal name | :29, :39 | C |
| "FIND A TABLE" | :97 | C |
| Guest label "{n} guest(s)" | lib/booking.ts:140 | C (ICU plural) |
| Day labels built from English `WD`/`MO` arrays | lib/booking.ts:32; data.ts:47-48 | Replace with `Intl.DateTimeFormat(locale,{timeZone:'Asia/Ho_Chi_Minh'})`. Not stored. |

## 2.15 Reserve drawer (`components/overlays/ReserveDrawer.tsx`), `SiteProvider.tsx` and `app/actions.ts`
All entries below are class C unless noted.
- aria "Reserve a table" (:60). "Close" (:65, :78). Kicker "RESERVE A TABLE" (:72). Meta line "{type} · {destination}" (:75).
- Success view:
  - "Thank you, {name}." with fallback 'you' (:88).
  - Lede "Your table request at {restaurant} has been received. Our team will contact you shortly to confirm." (:90-91).
  - Summary rows Date/Time/Guests/Reference (:95, :99, :103, :107).
  - "DONE" (:112).
- Form view:
  - Section labels "DATE" (:137), "Today" (:148), weekday and month (:148-150), "GUESTS" (:157), "TIME" (:180), meal group heading (:183), "YOUR DETAILS" (:219).
  - aria "Fewer guests" / "More guests" (:163, :171).
  - Slot aria "{time} — fully booked" / "{time} — {n} covers left" (:198, :200).
  - "No tables left on this date — please choose another day." (:214).
  - Captions "Full name *", "Phone *", "Email", "Special requests" (:222, :235, :251, :267).
  - Placeholders "Nguyễn Minh Anh", "+84 905 000 000", "you@example.com", "Occasion, dietary needs, seating preference" (:226, :240, :256, :272). These are locale-appropriate examples, so translate them too.
  - Inline errors "Please enter your name." / "Please enter a valid phone number." / "Please check your email address." (:231, :246, :262).
  - Footer "YOUR TABLE" (:281). Submit "SENDING…" / "REQUEST BOOKING" (:296).
- Network error "We could not reach the reservations desk. Please try again." (SiteProvider.tsx:350).
- Server-action errors are returned as English strings (app/actions.ts):
  - "That restaurant is no longer available." (:31, :82)
  - "Please choose between 1 and 12 guests." (:35)
  - "Please choose a date within the next two weeks." (:40)
  - "{restaurant} does not serve at that time." (:45)
  - "That sitting has already started — please pick a later time." (:49)
  - name/phone/email (:58-60)
  - "That slot just filled up — please choose another time." (:77)
  - "We already have a request for this table under your number." (:80)
  - **Change these to return `{ok:false, code, params}`** and have the client look up `ui.error.<code>`. Server Actions cannot read `next/root-params` (node_modules/next/dist/docs/01-app/02-guides/internationalization.md:254), so the action does not know the locale on its own.
- `dateLabel` (actions.ts:88) is returned but the client never reads it.
- Not guest-visible: the JSON errors in app/api/availability/route.ts:13, :16, :25. The client ignores non-OK responses (SiteProvider.tsx:169).

## 2.16 Search overlay (`components/overlays/SearchOverlay.tsx`)
All entries below are class C.
- aria "Search" (:40) and "Close search" (:44).
- Placeholder and aria "Search restaurants, cuisines, places" (:55-56).
- "POPULAR CUISINES" (:61). The chips are the cuisine labels (:63-66).
- "{n} RESULT(S)" (:75). Needs ICU plural.
- Result meta "{type} · {destination}" (:92). Action "View" vs "Reserve", chosen by `id === 'taya-house'` (:95).
- "No matches for “{query}”. Try a cuisine such as Vietnamese or Italian." (:105).
- Search folds only the English fields (:36). It should fold both the localized and the default-locale fields.

## 2.17 Footer (`components/site/Footer.tsx`)
| Content | Where | Class |
|---|---|---|
| Wordmark | :22 | L |
| Tagline | :24 | B (footer) |
| 4 socials (label + href) | data.ts:166-171, :26-30 | A (social_links). TikTok handle `@furama.dining.hous` (data.ts:170) may be a typo. Not verified. |
| "A MEMBER OF FURAMA" | :32 | B |
| Address lines with phone: "Furama Resort Danang · 103–105 Võ Nguyên Giáp, Ngũ Hành Sơn, Đà Nẵng · +84 236 651 9999" and "Furama Dining House · 73 Trần Bạch Đằng, An Thượng · 0859 555 759" | :37-48; phones data.ts:156-159 | A (per destination). MM Supercenter has no line. `diningHousePhone` '0859555759' is not E.164. |
| Email fb@furamavietnam.com | :49-50, data.ts:160 | B (site_settings) |

## 2.18 Curtains (brand, locked)
- IntroCurtain "FURAMA" / "CUISINE" (IntroCurtain.tsx:24, :26).
- PageCurtain "FURAMA" (PageCurtain.tsx:88).
- These are aria-hidden brand marks. Keep them as code constants.

## 2.19 Tàya House detail page (the template to generalise)
| Content | Where | Generalised field |
|---|---|---|
| Page title "Tàya House — Furama Cuisine" and description | app/taya-house/page.tsx:6-10 | `restaurant_i18n.seo_title/seo_description`, plus the template `seo.restaurant.title_template` "{name} — Furama Cuisine" |
| "ALL RESTAURANTS" (back), "BACK" (mobile float) | TayaHero.tsx:23, :77 | C |
| Kicker "A Wellness Dining Home · Furama Resort Danang" (desktop and mobile copies) | :27, :84 | `restaurant_i18n.detail_kicker` |
| `<h1>` "Tàya House" (desktop and mobile copies) | :33, :89 | `restaurant_i18n.name` |
| "Brand Story" label | :39, :97 | C default with an optional per-restaurant override |
| Story paragraph (desktop and mobile copies) | :42-44, :99-101 | `restaurant_i18n.story` |
| "RESERVE A TABLE" → `openReserve({restaurant:'taya-house'})` | :51-53 | C; the restaurant id comes from the route |
| CALL `tel:CONTACT.resortPhone`, MAP `CONTACT.map`, MENU `CONTACT.tariffPdf` (falls back to scrolling to `#dishes`) | :55-67, MobileBar.tsx:56-59 | `restaurants.phone_*` and `map_url`, falling back to the destination; `restaurant_i18n.menu_pdf_url` |
| Portrait `/assets/taya-hero.jpg`, alt "Tàya House" | :72 | `restaurants.detail_image_id` (4/5 portrait, max-height 680 on desktop, detail.css:59-60; full-bleed 418 px tall on mobile, detail.css:5) |
| Section title "At Tàya House" | TayaExperiences.tsx:14 | C template "At {name}" with an optional override |
| 4 cards (image, alt, title, detail) | data.ts:133-138; TayaExperiences.tsx:18-20 | A (`restaurant_highlights`) |
| "More at Furama Resort Danang" plus a rail filtered on hard-coded `dest==='resort' && id!=='taya-house'` | MoreRestaurants.tsx:12, :19 | C template "More at {destination}". The filter should use the current restaurant's destination. Hide the section when it is empty. |
| Hard-coded detail route `DETAIL_PATH='/taya-house'`, view detection, `openRestaurant` special case | SiteProvider.tsx:33, :108, :257, :299-300 | `restaurants.has_detail_page` and `slug` |

## 2.20 Glyphs (L, not translatable)
- `→ × ▾ ● — ✓ − +` (e.g. Dropdown.tsx:45, :73; ReserveDrawer.tsx:86, :167, :175).
- Strip arrows out of translatable strings such as "ALL CUISINES →" and "VIEW ALL RESTAURANTS →", and render them in the component. Hero.tsx:79 already does this.

---

# 3. Code coupling the CMS must remove first

1. **Labels used as keys.** The cuisine filter matches English labels (SiteProvider.tsx:199; Cuisines.tsx:40). Meals are both enum values and display labels (Finder.tsx:14; ReserveDrawer.tsx:183; BookingBar.tsx:39). Switch to slug or enum keys with translated labels.
2. **'taya-house' special cases** in RestaurantCard.tsx:15, SearchOverlay.tsx:95, SiteProvider.tsx:33/108/126/299, MobileBar.tsx:12-24, TayaHero.tsx:51, MoreRestaurants.tsx:12. Replace with `has_detail_page`, `slug` and route params.
3. **Fixed counts in code:** hero `% 3` (SiteProvider.tsx:447) and journey dots (Destinations.tsx:29; home.css:626-627).
4. **Duplicate nav labels** (MenuOverlay.tsx:7-14 vs data.ts:146-153).
5. **English date arrays** `WD`/`MO` (data.ts:47-48) and `fmtDay` (lib/booking.ts:32).
6. **Hand-built plurals** (lib/booking.ts:140; SearchOverlay.tsx:75; Destinations.tsx:42).
7. **Seed migration overwrites.** 002_seed_restaurants.sql:18-25 uses `ON CONFLICT DO UPDATE`. scripts/migrate.mjs applies each file once, but any future seed must use `DO NOTHING` or it will overwrite admin edits.

---

# 4. Fixed counts and layout limits the admin UI must enforce
| Collection | Today | What the CSS or code assumes | Proposed admin rule |
|---|---|---|---|
| Hero slides | 3 | `% 3` autoplay (SiteProvider.tsx:447). With 2 slides the hero goes blank on the third tick; with 4 the fourth never auto-plays. Phones show slide 1 only, with its own mobile crop (home.css:66-70; Hero.tsx:27-29). | After the code fix: 1–5 published. Slide 1 needs a mobile crop. Hide dots when there is 1. |
| Hero title | 3 lines | Line 2 hidden below 760 px (home.css:163-172) | Three separate fields. Warn when a line exceeds about 1.3× the EN length. |
| Destination cards | 4 (incl. 1 teaser) | Dots at 12.5/37.5/62.5/87.5 % (Destinations.tsx:29) and line inset 12.5 % (home.css:626-627). Columns `minmax(240px,1fr)` (home.css:668) fit 5 in the 1280 px content width. Image `sizes` is 308 px (Destinations.tsx:71). | **Exactly 4 until the dots are computed** as `(2i+1)/(2n)`. After that, 2–5 with at most 1 teaser. Title and blurb are 2 lines each. |
| Stories | 4 | `minmax(min(72vw,250px),1fr)` with a 24 px gap (home.css:935-936). A 5th card overflows into a hidden-scrollbar rail on desktop (home.css:938, :943). | 1–4 published (or "latest 4"). |
| Offers | 3 | `repeat(auto-fill, minmax(max(280px,(100%-48px)/3),1fr))` (home.css:1009) gives 3 per row | 0–6, recommend multiples of 3. Hide the section when there are 0. Auto-hide past `valid_until`. |
| Experiences | 3 | Flex column next to an image of min-height clamp(340px, 41.6vw, 600px) (home.css:783, :805-809) | 1–5 |
| Cuisines | 8 | `minmax(104px,1fr)` with a 24 px gap (home.css:370-371). About 10 fit before the rail scrolls with a hidden scrollbar. | Soft maximum 10 |
| Restaurants | 12 | `auto-fill` grid, 6 per row maximum (home.css:485) | Any count |
| Detail highlights | 4 | `minmax(min(66vw,240px),1fr)` (detail.css:261) | 0–5. With 0, hide the section; the MENU fallback then has no `#dishes` target. |
| "More at…" rail | resort list minus self | `minmax(min(44vw,180px),1fr)` (detail.css:329) | Any count. Hide when empty. |
| Nav items | 6 | One `nowrap` row with SEARCH, the language button and RESERVE at ≥1080 px (layout.css:45-50, :115-134) | Maximum 6. Label limit about 14 characters per locale, with a preview warning. Hide an item automatically when its target section is hidden, because `scrollToId` fails silently (SiteProvider.tsx:219-220). |
| Mobile tab bars | 3 and 4 | Fixed grids (layout.css:353-359) | Labels only. If a restaurant has no phone or menu, fall back to the destination phone or the highlights section instead of leaving a gap. |
| Detail title | "Tàya House" | 44 px on mobile inside a fixed 418 px hero (detail.css:5-6, :172) | Name of about 24 characters or less. |
| Socials | 4 | One footer row | Maximum 6 |

Section toggles: hero, film, finder (desktop) and finder sheet, cuisines, destinations, experiences, heritage, stories, offers, booking bar (Chrome.tsx:38-40). **The restaurants section must stay visible.** Hero, Cuisines, Finder, Destinations and the mobile RESTAURANTS tab all scroll to `#restaurants` (Hero.tsx:78; Cuisines.tsx:27; SiteProvider.tsx:364, :377; MobileBar.tsx:45), and the tab highlighting reads `#restaurants`/`#destinations` (SiteProvider.tsx:395-400).

---

# 5. How to store translations: three options compared

| Criterion | (1) Per-field JSONB `{"en":…,"vi":…}` | (2) A `*_i18n` table per entity (typed columns, PK `(entity_id, locale)`) | (3) Generic key/value `(entity_type, entity_id, field, locale, value)` |
|---|---|---|---|
| Read query | Simplest: `COALESCE(name->>$1, name->>'en')`, no joins (`->>` per PostgreSQL 18 docs) | Two LEFT JOINs (requested and default locale), each field `COALESCE`d. Easy to wrap in a helper or view. | Pivot with `max(value) FILTER (WHERE field='…')` per field. Verbose. |
| Validation | Weak. Keys are not linked to `locales` by FK, so a typo like "vn" or an orphan after deleting a locale is accepted silently. Per-locale length checks need functions. | Strong: FK to `locales` with CASCADE, per-column `CHECK (char_length…)`, typed nullability | None per field. Polymorphic id means no FK and no cascade. |
| AI workflow metadata (machine vs reviewed, model, reviewer, source hash) | Needs a parallel JSONB "meta" blob per field | One row per (entity, locale) holds status, origin, model, reviewer and `source_hash` | Fits per field, but every field needs its own row |
| Missing or stale report | `NOT (col ? 'vi')` repeated per column and per table | `LEFT JOIN … WHERE t IS NULL OR t.status<>'reviewed' OR t.source_hash<>current` | Easy for keys, hard for entities |
| Concurrent editing (EN editor and VI reviewer on the same row) | Whole-column overwrite unless every write uses `jsonb_set` | Separate rows, so no lost updates | Separate rows |
| Adding a locale | Data only | Data only (a row in `locales`) | Data only |
| Precedent | Elixir `trans` library (JSONB "translations" column) | Payload's Postgres adapter keeps localized fields in a `<table>_locales` table; Strapi 5 stores one row per locale sharing a `documentId` | Common for UI dictionaries |

**Recommendation: a hybrid.**
- **Entity collections (A)** use **option 2**: base table plus a `<entity>_i18n` table with typed, nullable translatable columns. Fallback is per field to the default locale.
- **Section copy (B) and UI microcopy (C)** go in **one key/value table, `content_strings(key, locale, value, …)`**. The **set of keys is defined by a registry in code** (key, EN default, max length, multiline, placeholders such as `{name}`, translator/AI context note). The polymorphism problem does not arise because keys are not user-created rows. A missing value falls back to the default locale, then to the code default, so a key shipped in code works before any migration seeds it.
- Non-text section settings (visibility, image, link) go in a small `sections` table.
- **Reject per-field JSONB.** Its single advantage, join-free reads, is negligible at this size (about 50 content rows). Its weaknesses hit exactly the requirements that matter here: a reviewable AI translation workflow, admin-added locales with FK integrity, and audit per locale.

Guest-side rules:
- A non-default value is served only when `status='reviewed'`, or when `status='machine'` and `locales.serve_machine` is true.
- Default-locale rows are always live.
- Fallback is per field, so a partly translated VI row still renders with English in the untranslated fields.
- When the EN source changes, `source_hash` stops matching and the admin shows "EN changed since translation". The reviewed text stays live until someone re-reviews it.

---

# 6. Proposed DDL (proposal only, not applied)

The existing style is `text` + `CHECK` with idempotent statements. `ADD CONSTRAINT` has no `IF NOT EXISTS`, so wrap those in `DO` blocks. `gen_random_uuid()` is built in since PG 13.

```sql
-- Shared columns on every *_i18n table and on content_strings (written out in each table in the real migration)
--   status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','machine','reviewed')),
--   origin      text NOT NULL DEFAULT 'human' CHECK (origin IN ('human','ai','seed')),
--   ai_model    text,                 -- model id as configured in admin AI settings
--   source_hash text,                 -- hash of the default-locale fields this was made from
--   reviewed_by uuid, reviewed_at timestamptz,
--   updated_at  timestamptz NOT NULL DEFAULT now(), updated_by uuid   -- staff user id (auth/roles topic)

CREATE TABLE IF NOT EXISTS locales (
  code          text PRIMARY KEY CHECK (code ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})?$'), -- URL segment: en, vi, ko, zh-hans
  bcp47         text NOT NULL,              -- <html lang>, Intl: 'zh-Hans'
  native_name   text NOT NULL,              -- 'Tiếng Việt' (Header.tsx:8)
  short_label   text NOT NULL,              -- 'VI' (Header.tsx:72, MenuOverlay.tsx:81)
  is_default    boolean NOT NULL DEFAULT false,
  is_enabled    boolean NOT NULL DEFAULT false,   -- routable on guest site
  serve_machine boolean NOT NULL DEFAULT false,   -- show unreviewed AI text to guests
  sort_order    integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS locales_single_default ON locales ((true)) WHERE is_default;

CREATE TABLE IF NOT EXISTS media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,                     -- seed: '/assets/hero-beach.jpg'; uploads: storage URL
  content_type text NOT NULL, width int, height int, bytes int,
  focal_x real CHECK (focal_x BETWEEN 0 AND 1), focal_y real CHECK (focal_y BETWEEN 0 AND 1), -- object-position for cover crops
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid
);
CREATE TABLE IF NOT EXISTS media_i18n (
  media_id uuid REFERENCES media(id) ON DELETE CASCADE,
  locale text REFERENCES locales(code) ON UPDATE CASCADE ON DELETE CASCADE,
  alt text NOT NULL CHECK (char_length(alt) <= 250),   -- AI alt text on upload
  /* shared columns */ PRIMARY KEY (media_id, locale)
);

CREATE TABLE IF NOT EXISTS sections (
  key text PRIMARY KEY CHECK (key IN ('hero','film','finder','cuisines','restaurants','destinations',
                                       'experiences','heritage','stories','offers','booking_bar')),
  is_visible boolean NOT NULL DEFAULT true CHECK (key <> 'restaurants' OR is_visible),
  image_id uuid REFERENCES media(id),        -- experiences chef.jpg, heritage.jpg, film poster
  link_url text,                              -- heritage CTA (data.ts:163); film video URL
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid
);

CREATE TABLE IF NOT EXISTS content_strings (      -- section copy (B) + UI microcopy (C) + SEO
  key text NOT NULL CHECK (key ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$'),   -- 'hero.title_2', 'ui.drawer.submit'
  locale text NOT NULL REFERENCES locales(code) ON UPDATE CASCADE ON DELETE CASCADE,
  value text NOT NULL,                       -- ICU MessageFormat where plural/placeholder
  /* shared columns */ PRIMARY KEY (key, locale)
);

CREATE TABLE IF NOT EXISTS destinations (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]+$'),        -- resort, dining-house, mm, future
  kind text NOT NULL DEFAULT 'venue' CHECK (kind IN ('venue','teaser')),  -- teaser = "Future Locations"
  card_image_id uuid REFERENCES media(id),
  phone_e164 text CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'), phone_display text,
  email text, map_url text,
  show_in_footer boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0, is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid
);
CREATE TABLE IF NOT EXISTS destination_i18n (
  destination_id text REFERENCES destinations(id) ON UPDATE CASCADE ON DELETE CASCADE,
  locale text REFERENCES locales(code) ON UPDATE CASCADE ON DELETE CASCADE,
  name text,                                 -- 'Furama Resort Danang' (data.ts:32): dropdowns, meta, search, "More at {destination}"
  card_title_1 text, card_title_2 text,      -- data.ts:58 two-line title
  card_blurb_1 text, card_blurb_2 text,      -- two-line blurb
  address text,                              -- Footer.tsx:38/44
  /* shared columns */ PRIMARY KEY (destination_id, locale)
);

CREATE TABLE IF NOT EXISTS cuisines (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]+$'),   -- 'steak-grill'
  image_id uuid REFERENCES media(id),
  sort_order int NOT NULL DEFAULT 0, is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid
);
CREATE TABLE IF NOT EXISTS cuisine_i18n (cuisine_id text REFERENCES cuisines(id) ON UPDATE CASCADE ON DELETE CASCADE,
  locale text REFERENCES locales(code) ON UPDATE CASCADE ON DELETE CASCADE, label text,
  /* shared columns */ PRIMARY KEY (cuisine_id, locale));

-- restaurants: extend the existing table (001_init.sql:5-16)
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS slug text UNIQUE;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS destination_id text REFERENCES destinations(id); -- replaces free-text destination
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS card_image_id uuid REFERENCES media(id);
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS detail_image_id uuid REFERENCES media(id);
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS og_image_id uuid REFERENCES media(id);
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS phone_e164 text;      -- NULL → destination phone
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS phone_display text;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS map_url text;         -- NULL → destination map
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS has_detail_page boolean NOT NULL DEFAULT false;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS is_bookable boolean NOT NULL DEFAULT true;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT true;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS archived_at timestamptz;   -- soft delete: reservations FK it
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS updated_by uuid;
-- DO $$ ... ADD CONSTRAINT restaurants_detail_image CHECK (NOT has_detail_page OR detail_image_id IS NOT NULL) ... $$;
-- name/type move to restaurant_i18n; cuisines text[] → restaurant_cuisines; meals text[] → per-restaurant
-- sittings/hours tables (reservations topic). Drop the old columns only after code cut-over.

CREATE TABLE IF NOT EXISTS restaurant_i18n (
  restaurant_id text REFERENCES restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
  locale text REFERENCES locales(code) ON UPDATE CASCADE ON DELETE CASCADE,
  name text,              -- proper noun; auto-added to the AI do-not-translate glossary
  type_label text,        -- 'Vietnamese · Cooking Class'
  detail_kicker text,     -- TayaHero.tsx:27/84
  story_label text,       -- NULL → ui 'detail.story_label' ('Brand Story')
  story text,             -- TayaHero.tsx:42-44
  highlights_title text,  -- NULL → ui 'detail.highlights_title' ('At {name}')
  menu_pdf_url text,      -- data.ts:162; menus are language-specific; NULL → default locale's PDF
  seo_title text, seo_description text,   -- app/taya-house/page.tsx:7-9
  /* shared columns */ PRIMARY KEY (restaurant_id, locale)
);
CREATE TABLE IF NOT EXISTS restaurant_cuisines (
  restaurant_id text REFERENCES restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
  cuisine_id text REFERENCES cuisines(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  sort_order int NOT NULL DEFAULT 0, PRIMARY KEY (restaurant_id, cuisine_id)
);
CREATE TABLE IF NOT EXISTS restaurant_highlights (       -- generalises TAYA_EXPERIENCES (data.ts:133-138)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id text NOT NULL REFERENCES restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
  image_id uuid REFERENCES media(id),
  sort_order int NOT NULL DEFAULT 0, is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid
);
CREATE TABLE IF NOT EXISTS restaurant_highlight_i18n (highlight_id uuid REFERENCES restaurant_highlights(id) ON DELETE CASCADE,
  locale text REFERENCES locales(code) ON UPDATE CASCADE ON DELETE CASCADE,
  title text, detail text, /* shared columns */ PRIMARY KEY (highlight_id, locale));

CREATE TABLE IF NOT EXISTS hero_slides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id uuid NOT NULL REFERENCES media(id),
  image_mobile_id uuid REFERENCES media(id),    -- only the first published slide uses it
  sort_order int NOT NULL DEFAULT 0, is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid
);   -- alt text comes from media_i18n; headline copy is shared → content_strings 'hero.*'

CREATE TABLE IF NOT EXISTS experiences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), link_url text,   -- today '#experiences' (Experiences.tsx:41)
  sort_order int NOT NULL DEFAULT 0, is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid);
CREATE TABLE IF NOT EXISTS experience_i18n (experience_id uuid REFERENCES experiences(id) ON DELETE CASCADE,
  locale text REFERENCES locales(code) ON UPDATE CASCADE ON DELETE CASCADE,
  title text, blurb text, /* shared columns */ PRIMARY KEY (experience_id, locale));

CREATE TABLE IF NOT EXISTS stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid REFERENCES media(id),
  href text NOT NULL, published_on date,         -- kicker = category · Intl-formatted date
  sort_order int NOT NULL DEFAULT 0, is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid);
CREATE TABLE IF NOT EXISTS story_i18n (story_id uuid REFERENCES stories(id) ON DELETE CASCADE,
  locale text REFERENCES locales(code) ON UPDATE CASCADE ON DELETE CASCADE,
  category text, title text, href text,           -- href NULL → base href (articles may exist per language)
  /* shared columns */ PRIMARY KEY (story_id, locale));

CREATE TABLE IF NOT EXISTS offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id text NOT NULL REFERENCES restaurants(id) ON UPDATE CASCADE,
  price_amount numeric(12,0), currency text NOT NULL DEFAULT 'VND',
  price_basis text CHECK (price_basis IN ('plus_plus','net')),   -- '++' vs 'net' (data.ts:113,127)
  valid_from date, valid_until date,                              -- auto-hide in Asia/Ho_Chi_Minh
  sort_order int NOT NULL DEFAULT 0, is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid);
CREATE TABLE IF NOT EXISTS offer_i18n (offer_id uuid REFERENCES offers(id) ON DELETE CASCADE,
  locale text REFERENCES locales(code) ON UPDATE CASCADE ON DELETE CASCADE,
  title text, schedule text,      -- 'Nightly 18:30–22:00'; price rendered with Intl.NumberFormat
  venue_override text,            -- NULL → restaurant name
  /* shared columns */ PRIMARY KEY (offer_id, locale));
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES offers(id) ON DELETE SET NULL; -- replaces pre-filled note
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS locale text;   -- guest language for confirmation email (req 8)

CREATE TABLE IF NOT EXISTS nav_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_section text NOT NULL REFERENCES sections(key),   -- anchors only; hidden when section hidden
  sort_order int NOT NULL DEFAULT 0, is_published boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid);
CREATE TABLE IF NOT EXISTS nav_item_i18n (nav_item_id uuid REFERENCES nav_items(id) ON DELETE CASCADE,
  locale text REFERENCES locales(code) ON UPDATE CASCADE ON DELETE CASCADE,
  label text CHECK (char_length(label) <= 18), /* shared columns */ PRIMARY KEY (nav_item_id, locale));

CREATE TABLE IF NOT EXISTS social_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('facebook','instagram','youtube','tiktok','zalo','wechat','kakao','x','tripadvisor')),
  href text NOT NULL, visible_locales text[],      -- NULL = all (e.g. WeChat only for zh)
  sort_order int NOT NULL DEFAULT 0, is_published boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid);   -- label = platform name (brand, not translated)

CREATE TABLE IF NOT EXISTS site_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  email text NOT NULL,                                        -- data.ts:160
  default_restaurant_id text REFERENCES restaurants(id),     -- SiteProvider.tsx:126
  default_occasion text,                                      -- SiteProvider.tsx:116
  og_image_id uuid REFERENCES media(id),
  hero_autoplay_ms int NOT NULL DEFAULT 7000 CHECK (hero_autoplay_ms BETWEEN 3000 AND 20000), -- SiteProvider.tsx:448
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid);

-- Audit log: here JSONB snapshots are the right tool
CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid, actor_email text,
  action text NOT NULL,          -- create|update|delete|reorder|publish|translate.ai|translate.review|settings
  entity_type text NOT NULL, entity_id text NOT NULL, locale text,
  before jsonb, after jsonb);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity_type, entity_id, at DESC);
```

Invariants enforced in the write Server Action, inside one transaction:
- An entity and its default-locale i18n row are created together, and required default-locale fields are non-null (e.g. restaurant `name`, `type_label`; destination `name`, `card_title_1`; cuisine `label`).
- A reorder rewrites `sort_order` for the whole list.
- Each write appends to `audit_log` and invalidates a per-collection cache tag such as `content:restaurants`.

## 6.1 Read pattern with fallback
```sql
-- $1 requested locale, $2 default locale, $3 locales.serve_machine for $1
SELECT r.id, r.slug, r.destination_id, r.has_detail_page,
       COALESCE(t.name, d.name)             AS name,
       COALESCE(t.type_label, d.type_label) AS type_label,
       COALESCE(t.story, d.story)           AS story,
       (t.restaurant_id IS NULL)            AS is_fallback
  FROM restaurants r
  JOIN restaurant_i18n d ON d.restaurant_id = r.id AND d.locale = $2
  LEFT JOIN restaurant_i18n t ON t.restaurant_id = r.id AND t.locale = $1
        AND (t.status = 'reviewed' OR (t.status = 'machine' AND $3))
 WHERE r.is_published AND r.archived_at IS NULL
 ORDER BY r.sort_order;
```

## 6.2 Coverage and staleness report for the admin dashboard
```sql
SELECT l.code, r.id,
       CASE WHEN t.restaurant_id IS NULL THEN 'missing'
            WHEN t.source_hash IS DISTINCT FROM md5(concat_ws('|', d.name, d.type_label, d.story, d.detail_kicker)) THEN 'stale'
            ELSE t.status END AS state
  FROM locales l CROSS JOIN restaurants r
  JOIN restaurant_i18n d ON d.restaurant_id = r.id AND d.locale = (SELECT code FROM locales WHERE is_default)
  LEFT JOIN restaurant_i18n t ON t.restaurant_id = r.id AND t.locale = l.code
 WHERE NOT l.is_default AND l.is_enabled;
```
The AI translate job selects rows in 'missing' or 'stale', sends the default-locale row plus the glossary, and writes `status='machine', origin='ai', ai_model, source_hash`. The editor then reviews: `status='reviewed', reviewed_by/at`.

---

# 7. UI-string registry (seed EN from the current code)

Namespaces and keys, each with its source line:
- **seo.\***
  - `home.title` / `home.description` / `og.title` / `og.description` (layout.tsx:25-30)
  - `restaurant.title_template` "{name} — Furama Cuisine" (taya-house/page.tsx:7)
- **hero.\***
  - `kicker`, `title_1`, `title_2` (desktop only), `title_3`, `lede` (Hero.tsx:51-74)
  - `cta_explore`, `cta_film`, `cta_find` (:79, :86, :90)
  - `slide_aria` "Slide {n}" (:99)
- **film.\***: `title`, `subtitle`, `aria`, `close_aria` (FilmModal.tsx:21-34)
- **finder.\***
  - `aria`, `location`, `cuisine`, `occasion`, `destination`
  - `city_default`, `more_cities`
  - `all_cuisines`, `any_occasion`, `any_destination`
  - `submit` (Finder.tsx:8-64; FinderSheet.tsx:33)
- **meal.\***: `breakfast`, `lunch`, `dinner`, `drinks` (data.ts:46)
- **cuisines.\***: `title`, `all` (Cuisines.tsx:18, :30)
- **restaurants.\***
  - `title`, `view_all`
  - `showing` "Showing {shown} of {total} restaurants", `no_matches`
  - `remove_filter_sr`, `clear_all`
  - `empty_title`, `empty_lede`, `show_all` (Restaurants.tsx:32-78)
  - `card_view`, `card_reserve` (RestaurantCard.tsx:36)
- **destinations.\***
  - `title`, `lede` (Destinations.tsx:19, :22)
  - `count` "{count, plural, one {# restaurant} other {# restaurants}}" (:42)
- **experiences.\***: `eyebrow`, `title_1`, `title_2` (Experiences.tsx:19-24)
- **heritage.\***: `kicker`, `title_1`, `title_2`, `cta` (Heritage.tsx:25-40)
- **stories.\***: `title`, `lede` (Stories.tsx:16, :19)
- **offers.\***: `title`, `lede`, `cta` (Offers.tsx:16-48)
- **booking.\***
  - `title`, `restaurant`, `date`, `time`, `guests`, `submit` (BookingBar.tsx:54-97)
  - `guests_count` with plural (lib/booking.ts:140)
- **slot.\***
  - `full`, `left` "{count} left" (BookingBar.tsx:39)
  - `full_aria`, `left_aria` (ReserveDrawer.tsx:198-200)
- **common.\***: `today`, `tomorrow`, `close`, `coming_soon`
- **drawer.\***
  - `aria`, `kicker`
  - `thanks` "Thank you, {name}.", `thanks_anon`, `done_lede` "…at {restaurant}…"
  - `reference`, `done`
  - `fewer_guests`, `more_guests`
  - `no_tables`, `your_details`, `your_table`
  - `submit`, `sending` (ReserveDrawer.tsx:60-296)
- **form.\***
  - `name`, `phone`, `email`, `note`
  - `ph_name`, `ph_phone`, `ph_email`, `ph_note`
  - `err_name`, `err_phone`, `err_email` (ReserveDrawer.tsx:222-272)
- **error.\***
  - `network` (SiteProvider.tsx:350)
  - `restaurant_unavailable`, `guests_range`, `date_window`, `not_served`, `sitting_started`, `slot_full`, `duplicate` (actions.ts:31-82)
- **search.\***
  - `aria`, `close_aria`, `placeholder`, `popular`
  - `results` with plural
  - `view`, `reserve`, `none` "No matches for “{query}”…" (SearchOverlay.tsx:40-105)
- **header/menu/mobilebar.\***
  - `search`, `reserve`, `reserve_table`
  - `open_menu`, `close_menu`
  - `nav_aria`, `sections_aria`, `language_aria`
  - `explore`, `restaurants`
  - `detail_aria`, `call`, `map`, `menu`
- **detail.\***
  - `back_all`, `back` (TayaHero.tsx:23, :77)
  - `reserve` (:53)
  - `story_label` (:39)
  - `highlights_title` "At {name}" (TayaExperiences.tsx:14)
  - `more_title` "More at {destination}" (MoreRestaurants.tsx:19)
  - `more_all` (:31)
- **footer.\***: `tagline` (Footer.tsx:24, MenuOverlay.tsx:85), `member` (Footer.tsx:32)

Notes on string handling:
- Plurals: Vietnamese, Korean and Chinese use only the `other` category, so ICU messages are needed. `intl-messageformat` is at 12.1.2 and `next-intl` at 4.14.8 per `npm view` on 2026-10-01. Choosing a library belongs to the i18n-routing topic.
- Store strings in natural case and let CSS uppercase them; most labels already have `text-transform:uppercase` (e.g. home.css:733, 985, 1032; base.css:109). All-caps source text also degrades machine-translation quality.
- The save action, including when it writes AI output, must reject a translation whose `{placeholders}` differ from the EN source.

---

# 8. Generalised restaurant detail page (requirement 6)
- **Route:** `app/[lang]/restaurants/[slug]/page.tsx` for every restaurant with `has_detail_page = true`. Otherwise `notFound()`, and the card opens the drawer. This replaces `DETAIL_PATH` and view detection (SiteProvider.tsx:33, :108). `generateMetadata` reads `restaurant_i18n.seo_*`, falling back to the title template plus `story`.
- **Hero:**
  - Kicker: `detail_kicker` in restaurant_i18n.
  - Title: `name`.
  - Story: `story_label` and `story`.
  - Portrait: `detail_image_id`.
  - Actions:
    - RESERVE presets the current id.
    - CALL uses `restaurants.phone_e164`, falling back to `destinations.phone_e164`.
    - MAP uses `map_url`, falling back to the destination's.
    - MENU uses `restaurant_i18n.menu_pdf_url` in the requested locale, then the default locale, then scrolls to the highlights.
  - The desktop and mobile copies share the same fields.
- **Highlights:** published `restaurant_highlights` for this restaurant, in `sort_order`. The title is `highlights_title`, or the "At {name}" template.
- **More at {destination}:** published restaurants with the same `destination_id`, excluding self. Hide when there are none.
- **Mobile tab bar:** gets the current restaurant from route context instead of `'taya-house'`.
- **Admin validation when `has_detail_page` is turned on:** require `detail_image_id` and a default-locale `story`; warn if there are fewer than 2 highlights.

# 9. Seed mapping (current source → new rows)
- `CUISINES` → cuisines + cuisine_i18n(en). Image `/assets/cuisine-{slug}.jpg` becomes a media row.
- `DESTS` + `DESTINATION_CARDS` + footer addresses and phones → destinations + destination_i18n. 'future' has `kind='teaser'`.
- Restaurants: name/type go to restaurant_i18n(en). The `cuisines[]` labels map to slugs in restaurant_cuisines. `has_detail_page` is true only for taya-house.
- `TAYA_EXPERIENCES` → restaurant_highlights for taya-house.
- `HERO_SLIDES`, `EXPERIENCES`, `STORIES` (dates split out of the kicker), `OFFERS` (price parsed into amount and basis) → their tables.
- `NAV_LINKS` → nav_items with title-case labels. `SOCIALS` → social_links. `CONTACT.email` → site_settings.
- `CONTACT.story` → sections.heritage.link_url. `CONTACT.tariffPdf` → restaurant_i18n(taya-house,en).menu_pdf_url.
- All existing `/assets/*.jpg` files become `media` rows pointing at their current paths, so no re-upload is needed. Uploaded images on a remote host will need `images.remotePatterns` (next.config.ts has none today).
- Every seed `INSERT … ON CONFLICT DO NOTHING`.

## Recommendation
I recommend a hybrid schema.

1. **Entity collections** (restaurants, destinations, cuisines, hero slides, experiences, stories, offers, restaurant highlights, nav items; media alt text) get a base table plus a typed `<entity>_i18n` table keyed by (entity_id, locale).
   - The locale column is a foreign key to `locales`.
   - Translatable columns are nullable, so fallback to the default locale works field by field.
   - Each translation row records `status` (draft/machine/reviewed), `origin`, `ai_model`, `source_hash`, reviewer and `updated_by`.
2. **Section copy, UI microcopy and SEO strings** go in one `content_strings(key, locale, value, …)` table. The allowed keys come from a registry in code that holds the EN default, max length, ICU placeholders and context. Non-text section settings (visibility, image, link) go in a small `sections` table. A `site_settings` singleton holds email, defaults and the hero timing.
3. **Do not use per-field JSONB.** Its only advantage, join-free reads, is negligible at about 50 content rows. It cannot cleanly hold per-locale review status or the staleness hash, which the Vertex AI translate-then-review workflow needs. It has no foreign key to admin-added locales, and two editors working on different languages of the same row overwrite each other.

Guests see non-default text only when it is reviewed, or when it is machine-translated and that locale's `serve_machine` flag is on. Fallback is per field to EN, and staleness is detected by comparing `source_hash` with the current EN fields. The audit log stores JSONB before/after snapshots per (entity, locale).

**Before the admin can safely add or remove items:**
- Replace the `% 3` hero autoplay.
- Compute the journey-dot positions from the card count.
- Switch the cuisine and meal filters to slug keys.
- Remove every `'taya-house'` special case.
- Have server actions return error codes instead of English strings.
- Use `Intl` for dates, numbers and plurals.

**Limits the admin UI should enforce:**
- Hero slides: 1–5. Slide 1 needs a mobile crop. The headline stays 3 lines, and line 2 is desktop-only.
- Destinations: exactly 4 until the dot fix, then 2–5 with at most 1 teaser.
- Stories: at most 4.
- Offers: multiples of 3 recommended; hide the section at 0.
- Experiences: 1–5.
- Detail highlights: 0–5.
- Nav: at most 6 items with labels of about 14 characters or less.
- Socials: at most 6.
- The restaurants section can never be hidden.

The Tàya House page becomes a per-restaurant template (`has_detail_page`, `slug`, `detail_image_id`, phone and map with fallback to the destination, plus kicker, story, menu PDF per locale and SEO fields in `restaurant_i18n`). The page lives at `/[lang]/restaurants/[slug]`.

## Risks
- Per-field fallback can show mixed-language cards (e.g. VI title with EN detail) while a translation is partial. The admin needs a coverage view, and per-locale `serve_machine` should default to off.
- Review status is tracked per row (entity + locale), not per field. Editing one EN field marks the whole translated row stale, which is coarse but simple.
- Fixed-count CSS and code (`% 3` hero, 4 hard-coded journey dots, 4-story rail, 3-column offers, nowrap header) will visibly break as soon as the admin adds or removes items, unless the code is fixed first or the UI enforces the limits.
- Translated labels are often 20–40% longer than EN. The nowrap header (layout.css:128), the heritage block with fixed height and overflow hidden (home.css:855-856) and the 418px mobile detail hero (detail.css:5-6) can clip or overflow. Length warnings and a per-locale preview are needed.
- Cuisine and meal filtering by English label breaks the moment labels are localized. The data migration to slug keys must ship at the same time as the code change.
- Seed migrations with ON CONFLICT DO UPDATE (002) would overwrite admin edits if re-applied. Every future seed must be insert-if-missing.
- Server Actions cannot read the locale via next/root-params. If the error-code refactor is skipped, booking errors stay in English on localized pages.
- Offer notes pre-filled into the guest's note field end up stored in the guest's language. Adding reservations.offer_id avoids staff seeing Korean or Chinese notes.
- Uploaded images on a remote host need next.config `images.remotePatterns` (none today). Decorative images (alt="") must stay decorative even when AI generates alt text.
- updated_by/actor_id columns assume an app-side staff user id from the auth/roles topic. The FK target (Neon Auth tables vs an app `staff` table) is not yet decided, so the FKs are left out of this proposal.

## Open questions
- Should unreviewed (machine) Vertex AI translations ever be shown to guests (per-locale toggle), or only reviewed text with EN fallback?
- Do edits go live on save, or do you want draft/preview before publishing (e.g. Next.js draft mode)?
- Should restaurant names ever be localized (e.g. Korean/Chinese script for 'Tàya House', 'Phố Cuốn'), or always kept as-is via the do-not-translate glossary?
- Should admins be able to add or remove destinations (this needs the journey-dot code fix), and should the 'Future Locations' teaser card remain?
- Where should the three Experiences rows link? Today they point to '#experiences' (nowhere).
- Stories: keep linking to external articles (furamadining.com / furamavietnam.com), possibly a different URL per language, or host articles in the CMS?
- Offers: do you want structured price (amount, VND, '++'/'net') and validity dates with auto-expiry, or free-text detail as today?
- Restaurant detail URL shape: /{lang}/restaurants/{slug} or /{lang}/{slug}? Should slugs be translated per locale?
- Are menu/tariff PDFs available per language, or one PDF for all?
- Are all restaurants bookable online (e.g. Yum Food Village food hall), or do we need an is_bookable flag shown as 'call to book'?
- Should the brand wordmark ('FURAMA CUISINE', curtains, tagline 'PEOPLE | CULTURE | GREAT FOOD') be locked, or should the tagline be translatable?
- Is the TikTok handle '@furama.dining.hous' correct, and should the Dining House phone be stored as +84 859 555 759?

## Key facts
- [verified] Only 'restaurants' (12 rows) and 'reservations' live in Postgres; all other guest copy is in lib/data.ts constants or hard-coded JSX. (db/migrations/001_init.sql:5-42; 002_seed_restaurants.sql:5-17; lib/data.ts:20-171)
- [verified] Collection counts today: 12 restaurants, 8 cuisines, 4 destination cards (3 venues + 1 'Future Locations' teaser), 3 hero slides, 3 experiences, 4 stories, 3 offers, 4 Tàya highlight cards, 6 nav links, 4 socials. (002_seed_restaurants.sql:6-17; lib/data.ts:20-29,57-62,64-68,70-99,109-131,133-138,140-144,146-153,166-171)
- [verified] Hero autoplay hard-codes 3 slides with `(s + 1) % 3`, so adding or removing slides breaks the slideshow. (components/site/SiteProvider.tsx:447)
- [verified] Destination journey dots are fixed at 12.5/37.5/62.5/87.5% and the dotted line inset at 12.5%, so the layout assumes exactly 4 destination cards. (components/home/Destinations.tsx:29; styles/home.css:626-627)
- [verified] Hero headline is 3 separate lines, and line 2 is hidden below 760px; the hero lede is desktop-only; phones show only the first slide with a separate crop (hero-hall-m.jpg). (components/home/Hero.tsx:27-37,55-75; styles/home.css:66-70,163-188)
- [likely] The stories rail fits 4 cards at desktop width; a 5th overflows into a horizontal rail with a hidden scrollbar. (styles/home.css:930-945 (minmax(min(72vw,250px),1fr), gap 24px, shell 1440px minus gutters))
- [verified] The offers grid lays out 3 per row; the header nav is one nowrap row (6 links + search + language + reserve) at >=1080px; mobile tab bars are fixed 3- and 4-column grids. (styles/home.css:1009; styles/layout.css:45-50,115-134,353-359)
- [verified] Cuisine filtering compares English display labels, and meal enum values double as display labels. This breaks once labels are translated, so the data needs slug keys. (components/site/SiteProvider.tsx:199-201; components/home/Cuisines.tsx:40; components/home/Finder.tsx:14; components/overlays/ReserveDrawer.tsx:183)
- [verified] The Tàya House page is hard-wired: DETAIL_PATH '/taya-house', and `id === 'taya-house'` checks in the card, search, mobile bar, hero reserve and 'More at' filter. (SiteProvider.tsx:33,108,126,299; RestaurantCard.tsx:15; SearchOverlay.tsx:95; MobileBar.tsx:12-24; TayaHero.tsx:51; MoreRestaurants.tsx:12)
- [verified] Nav labels are duplicated: uppercase in data.ts NAV_LINKS (header) and title-case in MenuOverlay MENU_LABELS; .hdr-link has no text-transform. (lib/data.ts:146-153; components/overlays/MenuOverlay.tsx:7-14; styles/layout.css:122-134)
- [verified] Server-action reservation errors are returned as English strings; root-param getters (next/root-params) do not run in Server Actions, so the actions should return error codes for the client to translate. (app/actions.ts:31-82; node_modules/next/dist/docs/01-app/02-guides/internationalization.md:254)
- [verified] Next 16: updateTag can only be called from Server Actions (read-your-own-writes); revalidateTag(tag, 'max') is the recommended two-argument form, and the one-argument form is deprecated. (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/updateTag.md:6-12; revalidateTag.md:23,35,61)
- [verified] Payload's Postgres adapter stores localized fields in a separate table with a '_locales' suffix (precedent for per-entity translation tables). (https://payloadcms.com/docs/database/postgres)
- [likely] Strapi 5 stores each locale variant as its own record sharing a documentId. (https://docs.strapi.io/cms/api/document-service)
- [likely] The per-field JSONB translation pattern (one map column per translatable field) is used by the Elixir 'trans' library. (https://hex.pm/packages/trans/1.1.0/files)
- [verified] PostgreSQL 18 docs: jsonb ->> extracts a field as text; ? tests key existence; jsonb_object_keys lists keys. (https://www.postgresql.org/docs/current/functions-json.html)
- [verified] intl-messageformat 12.1.2 (modified 2026-09-19) and next-intl 4.14.8 (modified 2026-09-29) are current on npm. (npm view intl-messageformat / next-intl, run 2026-10-01)
- [verified] The seed migration uses ON CONFLICT DO UPDATE, and scripts/migrate.mjs applies each file once. Once admin edits exist, any re-applied or new seed must use DO NOTHING or it will overwrite them. (db/migrations/002_seed_restaurants.sql:18-25; scripts/migrate.mjs)
- [unverified] The Dining House phone is stored as '0859555759' (not E.164), and the TikTok handle '@furama.dining.hous' may be a typo. (lib/data.ts:158,170)