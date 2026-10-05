# Phase 7 spike: content screens, the registry move, the coverage guards, the strings editor, the policy version and the email preview

> Spike report, key `editors-registry` (clone `p7-edit`, DB tag `p7ed`, ports 3240–3249). Topic: content screens of §7.2, the registry move, the coverage guards (guest text and editing screens), the `content_strings` editor with ICU validation, the policy version bump and the email preview.
>
> Where this report and `00-plan-outline.md` disagree, **the outline wins** (its §0 lists every conflict). In particular, the outline:
> - adopts this spike's 7A/7B split in principle but with a different task boundary (destinations moves to 7B; legal/emails/strings history stay in 7A; the offers and restaurants editors carry their own keys);
> - plans **no** visual baseline re-take for R3 (the `media-blob` spike measured it inside the gate);
> - gives the film poster/link to the hero screen as well (spec §7.2), through one `sections` save shared with the sections screen;
> - keeps the `/admin/content` index and its one "Nội dung" nav item from this spike, plus a "Thư viện" item for `/admin/media`.

# Spike p7-edit: phase 7 content editors, registry move, coverage guards

Clone: `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p7-edit` (HEAD c896b13, working tree changes only, nothing committed).

**The full patch**, with every new file and every diff (55 files, +2454/−124, 3483 lines): `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p7ed-work/p7-edit-spike.patch`. It applies on c896b13 with `git apply`. The patch is the authoritative file content; the most important files are quoted below.

Other artefacts in `…/scratchpad/p7ed-work/`:
- logs: `gate-*.log`, `e2e-full1.log`, `e2e-full2utc.log`, `visual-gate.log`, `final-unit2.log`;
- scanner output: `scan3.txt` (every finding with its line);
- admin screenshots: `admin-ui-text.png`, `admin-email-preview.png`;
- mutation runner: `mut.py`.

Original repo: untouched (`git status` clean at c896b13). Databases `*_p7ed_test` (9 of them) dropped. No server is left on 3240–3249.

## 0. Outcome in one screen

| Asked | Result |
|---|---|
| 1. Inventory and acceptance checklist | §1 below. 191 guest literals found by the scanner and classified:<br>• 30 LOCKED;<br>• 161 PENDING, which collapse to 128 proposed new keys and 3 existing ones.<br>25 keys are already moved by this spike. Every content column has an owner in `COLUMN_SCREENS`, and an integration test holds that map equal to the schema. |
| 2. Registry move, keeping the site pixel-identical | Pattern proven on 3 sections plus the meal and finder labels:<br>• Stories and Heritage go server → page props;<br>• Search goes through the SiteProvider path and includes an ICU plural;<br>• `MEAL_LABELS` is replaced by the `meal.*` keys, and the "All/Any …" options by `finder.*`.<br>DOM diff against a c896b13 build is **0 lines** on `/en`, `/en/restaurants/taya-house` and `/en/privacy`. Visual is **8/8 at ratio 0** twice: after the move, and again after a full E2E run. |
| 3. CI guards | (a) `test/guards/guest-text.guard.test.ts`: oxc-parser scanner with LOCKED and PENDING allowlists.<br>(b) Two parts:<br>• `test/guards/editing-screens.guard.test.ts`: every key's screen has a route and page, and the page renders `screen="<x>"`;<br>• `test/integration/editing-screens.test.ts`: `COLUMN_SCREENS` equals `information_schema` for every content table. |
| 4. Editor prototype | `/admin/content/{ui-text,stories,heritage,legal,emails}` plus an index page.<br>• Per-key token and conflict check; untouched fields are skipped.<br>• §7.4 ICU and placeholder validation against the registry `vars`.<br>• Audit row per key; "Khôi phục mặc định" deletes the row.<br>• `updateTag` of exactly the tags the keys are cached under.<br>• The legal save adds a `legal_versions` row (migration 009) when the agreed text changes.<br>• The email preview is a route handler with its own CSP, posted into a sandboxed iframe with a `formAction` button, so unsaved text is previewed. |
| 5. Editor list and split | §6: split into 7A and 7B. |

Bonus finding, fixed in the spike: **the whole registry (contexts, email texts, VI defaults) ships to every guest page today**, through the test-only `DEFAULT_ERROR_STRINGS` and `bookingErrorMessage` in `lib/booking-errors.ts`.

Home-page JS, gzip:

| Build | Bytes | Change from HEAD |
|---|---|---|
| HEAD | 215,435 | — |
| + intl-messageformat | 226,207 | +10,772 |
| + registry off the client | 218,294 | **+2,859** |

Phase 7 roughly doubles the registry, so without this fix the bundle would have grown by about 8 KB more.

---

## 1. Inventory and acceptance checklist (content-inventory §2.1–2.19 → admin screen → field)

Legend:
- **R** = registry key (screen in brackets);
- **T** = table column, with its screen from `lib/admin/content-screens.ts` `COLUMN_SCREENS`;
- **L** = locked;
- **P8** = phase 8 (locales);
- ✓ = done in this spike;
- ✓6 = already in the DB or registry since phase 5/6.

The checklist's "EN edit shows on the web within seconds" applies to every row except L. Proposed key names follow the phase-6 schema-seed map where it named one.

| § | Guest-visible item | Owner → admin screen → field | Status |
|---|---|---|---|
| 2.1 | `<title>`, meta description | R `seo.home_title`, `seo.home_description` → [seo] | pending |
| | OG title, OG description | R `seo.og_title`, `seo.og_description` → [seo] | pending |
| | OG image | T `site_settings.og_image_id` → seo | column ✓6, editor pending |
| | `<html lang>` | T `locales.bcp47` → locales | P8 |
| | theme colour, favicon | L | — |
| 2.2 | logo FURAMA/CUISINE, wordmark | L (brand) | — |
| | 6 nav labels and targets | T `nav_items.target_section/sort_order/is_published` + `nav_item_i18n.label` → navigation | ✓6 data, editor pending |
| | SEARCH, RESERVE ×2 | R `ui.search`, `ui.reserve` → [ui-text] | pending |
| | language code and names | T `locales.short_label/native_name` → locales | P8 |
| | aria Main / Language / Open menu | R `ui.nav_aria`, `ui.language_aria`, `ui.open_menu` → [ui-text] | pending |
| 2.3 | menu labels (same rows as nav) | T `nav_item_i18n.label` → navigation | ✓6 |
| | Search, RESERVE A TABLE | R `ui.search_link`, `ui.reserve_table` → [ui-text] | pending |
| | tagline PEOPLE \| CULTURE \| GREAT FOOD | R `footer.tagline` → [contact] (shared with the footer) | pending |
| | aria Menu / Close menu / Sections | R `ui.menu_aria`, `ui.close_menu`, `ui.sections_aria` → [ui-text] | pending |
| | EN/VI buttons | locales | P8 |
| 2.4 | EXPLORE / RESTAURANTS / RESERVE | R `ui.tab_explore`, `ui.tab_restaurants`, `ui.reserve` → [ui-text] | pending |
| | CALL / MAP / MENU, aria Restaurant actions | R `detail.call/map/menu`, `detail.actions_aria` → [restaurants] | pending |
| | tel, map | T `restaurants.phone_e164/phone_display/map_url` → restaurant; fallback `destinations.*` → destinations | ✓6 data, editor pending |
| | menu PDF | T `restaurant_i18n.menu_pdf_media_id \| menu_pdf_url` → restaurant (upload: media) | pending |
| 2.5 | slides, order, publish, phone crop | T `hero_slides.image_id/image_mobile_id/sort_order/is_published` → hero | ✓6, editor pending |
| | slide alt / decorative | T `media_i18n.alt`, `media.is_decorative` → media | pending |
| | kicker, title 1/2/3, lede | R `hero.kicker`, `hero.title_1/2/3`, `hero.lede` → [hero] | pending |
| | 3 CTAs, "Slide {n}" | R `hero.cta_explore/cta_film/cta_find`, `hero.slide_aria` (vars n) → [hero] | pending |
| | autoplay ms | T `site_settings.hero_autoplay_ms` → hero | pending |
| | film poster, video URL, on/off | T `sections[film].image_id/link_url/is_visible` → sections (spec §7.2 also shows them on hero: one owner needed, see risks) | pending |
| | film title, coming soon, 2 aria labels | R `film.title`, `film.coming_soon`, `film.aria`, `film.close_aria` → [hero] | pending |
| 2.6 | Find a restaurant; Location/Cuisine/Occasion/Destination | R `finder.title`, `finder.location/cuisine/occasion/destination` → [booking] | pending |
| | Da Nang / More cities / Coming soon | R `finder.city`, `finder.more_cities`, `common.coming_soon` | pending |
| | All cuisines / Any occasion / Any destination | R `finder.all_cuisines/any_occasion/any_destination` → [booking] | **✓** |
| | occasion options (meal names) | R `meal.breakfast/lunch/dinner/drinks` → [booking] | **✓** (`MEAL_LABELS` deleted) |
| | SHOW RESTAURANTS, Close | R `finder.submit`, `common.close` | pending |
| | default occasion | T `site_settings.default_occasion` → booking | pending |
| | cuisine and destination options | T `cuisine_i18n.label` → cuisines; `destination_i18n.name` → destinations | ✓6 |
| 2.7 | Explore by Cuisine, ALL CUISINES (arrow stays code) | R `cuisines.title`, `cuisines.all` → [cuisines] | pending |
| | 8 chips (label, image, order, publish) | T `cuisines.*` + `cuisine_i18n.label` → cuisines | ✓6, editor pending |
| 2.8 | Our Restaurants, VIEW ALL RESTAURANTS | R `restaurants.title`, `restaurants.view_all` → [restaurants] | pending |
| | Showing {shown} of {total} restaurants, No matches | R `restaurants.showing` (vars shown, total), `restaurants.no_matches` | pending |
| | , remove filter / CLEAR ALL / 3 empty-state lines | R `restaurants.remove_filter_sr/clear_all/empty_title/empty_lede/show_all` | pending |
| | card View restaurant / Reserve a table | R `restaurants.card_view/card_reserve`; "Gọi để đặt bàn" `booking.call_tag` | `call_tag` ✓6, rest pending |
| | name, slug, destination, type, cuisines, images, publish, archive | T `restaurants.*`, `restaurant_i18n.type_label`, `restaurant_cuisines` → restaurant | ✓6, editor pending |
| | booking on/off, meals | T `restaurants.booking_enabled`, `service_periods` → restaurant-booking | ✓ (phase 4 screen) |
| 2.9 | Our Destinations, lede | R `destinations.title/lede` → [destinations] | pending |
| | cards: kind, order, publish, 2-line title and blurb, image, name | T `destinations.*` + `destination_i18n.*` → destinations | ✓6, editor pending |
| | "{count} restaurants →" / Coming soon | R `destinations.count` (ICU plural `{count, plural, one {# restaurant} other {# restaurants}}`), `common.coming_soon` | pending |
| | screen-reader text, journey dots | code (join and arithmetic) | — |
| 2.10 | picture and its alt | T `sections[experiences].image_id` → sections; alt → media | pending |
| | eyebrow, title lines 1 and 2 | R `experiences.eyebrow/title_1/title_2` → [experiences] | pending |
| | rows (title, blurb, link) | T `experiences.link_url/sort_order/is_published` + `experience_i18n.*` → experiences | ✓6, editor pending (owner: links) |
| 2.11 | background picture, OUR STORY link | T `sections[heritage].image_id/link_url` → sections | pending |
| | kicker, title 1/2, OUR STORY | R `heritage.kicker/title_1/title_2/cta` → [heritage] | **✓** |
| 2.12 | title, lede | R `stories.title/lede` → [stories] | **✓** |
| | 4 cards (image, href, date, category, title) | T `stories.*` + `story_i18n.*` → stories | ✓6, editor pending |
| | kicker "category · date" | code join (server, format.ts) | — |
| 2.13 | Offers title; lede with its date | R `offers.title`, `offers.lede` → [offers] (owner rules on the date: ledger #9) | pending |
| | restaurant, price, basis, validity, order, publish | T `offers.*` → offers | ✓6, editor pending |
| | title, schedule, venue | T `offer_i18n.title/schedule/venue_override` → offers | ✓6 |
| | "VND 888,000++ per guest" | R `offers.price_plus_plus`, `offers.price_net` (vars currency, amount) | pending |
| | VIEW OFFER; "Offer: …" note prefill | R `offers.cta`; `offers.note` or drop the prefill (L7-11) | pending |
| 2.14 | Where would you like to dine? | R `booking.title` → [booking] | pending |
| | Destination/Restaurant/Date/Time/Guests | R `booking.label_*` (shared with the drawer) | pending |
| | Today / Tomorrow / Full / "{count} left" / meal | R `common.today/tomorrow`, `booking.slot_full/slot_left`; `meal.*` ✓ | partly ✓ |
| | FIND A TABLE; "{n} guest(s)" | R `booking.find_table`, `booking.guests_count` (ICU plural) | pending |
| | first restaurant | T `site_settings.default_restaurant_id` → booking | pending |
| 2.15 | `error.*`, `booking.day_*`, `no_tables`, `loading`, `done_*`, `retry`, privacy notice, consent | R (exists) → ui-text / booking / legal | ✓6, editor: ui-text ✓, legal ✓ |
| | drawer copy (aria, thanks, labels, DONE, ± guests, slot aria, YOUR DETAILS/TABLE, SENDING…, REQUEST BOOKING, `you`) | R `booking.drawer_aria/thanks/thanks_anon/label_reference/done/fewer_guests/more_guests/slot_full_aria/slot_left_aria/section_date/section_guests/section_time/your_details/your_table/sending/submit` | pending |
| | captions and placeholders | R `form.name/phone/email/note`, `form.ph_name/ph_phone/ph_email/ph_note` → [ui-text] | pending |
| | inline field errors | existing `error.invalid_name/phone/email` (today duplicated inline) | pending |
| 2.16 | search dialog copy (aria, close, placeholder, popular, results plural, View, Reserve, no matches) | R `search.*` (8 keys) → [ui-text] | **✓** |
| | chips; thumbnails | `cuisine_i18n.label`; `restaurants.card_image_id` | ✓6 |
| 2.17 | wordmark | L | — |
| | tagline, A MEMBER OF FURAMA | R `footer.tagline`, `footer.member` → [contact] | pending |
| | socials (href, order, publish, locales); platform labels | T `social_links.*` → contact; R `social.<platform>` (L7-15; or L if the owner rules "brand") | pending |
| | address lines | T `destination_i18n.name/address` (contact), `destinations.phone_*/show_in_footer` (destinations) | ✓6, editor pending |
| | email | T `site_settings.email` → notifications (Admin; see risks) | ✓ phase 5 |
| 2.18 | curtains FURAMA/CUISINE | L | — |
| 2.19 | ALL RESTAURANTS, BACK | R `detail.back_all`, `detail.back` → [restaurants] | pending |
| | kicker, story, Brand Story label | T `restaurant_i18n.detail_kicker/story/story_label` → restaurant; fallback R `detail.story_label` | pending |
| | `<h1>` name | T `restaurants.name` → restaurant | ✓6 |
| | RESERVE A TABLE | R `ui.reserve_table` | pending |
| | portrait and alt | T `restaurants.detail_image_id` → restaurant; alt → media | pending |
| | "At {name}", highlights | T `restaurant_i18n.highlights_title` ?? R `detail.highlights_title`; T `restaurant_highlights(+i18n)` → restaurant | pending |
| | More at {destination}, ALL RESTAURANTS → | R `detail.more_title` (vars destination), `detail.more_all` | pending |
| | `<title>`/description, unknown slug title | T `restaurant_i18n.seo_*` → restaurant; R `seo.page_title` ('{page} — Furama Cuisine'), `seo.not_found_title` → [seo] | pending |
| later | privacy page | R `legal.*` → [legal]; version via `legal_versions` | **✓** |
| | (guarded)/not-found | R `common.not_found`, `common.back_home` → [ui-text] | pending |
| | `[lang]/error.tsx`, `[lang]/not-found.tsx`, `global-error`, `global-not-found` | L: they render without the database or a language (spec §12), so they need a ruling | — |
| | booking emails | R `email.*` → [emails], preview ✓ | **✓** EN |

Every key's admin screen is a §7.2 route: `EDIT_SCREENS` in `lib/admin/content-screens.ts`. Every column of the 27 content tables, `legal_versions` included, is mapped in `COLUMN_SCREENS`, either to a screen or to `{ none: reason }` (key, order, bookkeeping, translation metadata, upload-measured, legacy).

### Proposed new registry keys (128, plus 25 done)

Delivery rule: a key reaches the browser through the SiteProvider (`CLIENT_KEYS`) only when a component of the chrome shows it. A page's own section copy is read by the page on the server and passed as props. `seo.*`, the `legal.*` page keys and `email.*` stay on the server.

| Key prefix | Screen | Delivery | Keys |
|---|---|---|---|
| `ui.*` | ui-text | client | search, reserve, reserve_table, search_link, nav_aria, language_aria, open_menu, menu_aria, close_menu, sections_aria, tab_explore, tab_restaurants |
| `common.*` | ui-text | client | close, today, tomorrow, coming_soon, not_found, back_home |
| `form.*` | ui-text | client | name, phone, email, note, ph_name, ph_phone, ph_email, ph_note |
| `booking.*` | booking | client | title, label_destination/restaurant/date/time/guests/reference, find_table, slot_full, slot_left{count}, slot_full_aria{time}, slot_left_aria{time,count}, guests_count{count, plural}, drawer_aria, thanks{name}, thanks_anon, done, fewer_guests, more_guests, section_date/guests/time, your_details, your_table, sending, submit |
| `finder.*` | booking | client | title, location, cuisine, occasion, destination, city, more_cities, submit; all_cuisines, any_occasion, any_destination ✓ |
| `meal.*` | booking | client | breakfast, lunch, dinner, drinks ✓ |
| `search.*` | ui-text | client | ✓ aria, close, placeholder, popular, results{count, plural}, view, reserve, none{query} |
| `film.*` | hero | client | title, coming_soon, aria, close_aria |
| `footer.*` | contact | client | tagline, member |
| `social.*` | contact | client | facebook, instagram, youtube, tiktok, zalo, x, tripadvisor, wechat, kakao, line |
| `detail.*` | restaurants | client (MobileBar, RestaurantHero) or detail-page props | back_all, back, call, map, menu, actions_aria, story_label, highlights_title{name}, more_title{destination}, more_all |
| `hero.*` | hero | home props | kicker, title_1/2/3, lede, cta_explore, cta_film, cta_find, slide_aria{n} |
| `cuisines.*` | cuisines | home props | title, all |
| `restaurants.*` | restaurants | home props (+ detail props for the card labels) | title, view_all, showing{shown,total}, no_matches, remove_filter_sr, clear_all, empty_title, empty_lede, show_all, card_view, card_reserve |
| `destinations.*` | destinations | home props | title, lede, count{count, plural} |
| `experiences.*` | experiences | home props | eyebrow, title_1, title_2 |
| `heritage.*` | heritage | home props | ✓ kicker, title_1, title_2, cta |
| `stories.*` | stories | home props | ✓ title, lede |
| `offers.*` | offers | home props or loader | title, lede, cta, price_plus_plus{currency,amount}, price_net{currency,amount}, note{title} |
| `seo.*` | seo | server (metadata) | home_title, home_description, og_title, og_description, page_title{page}, not_found_title |
| `error.restaurant_fallback` | ui-text | client | the `{restaurant}` used before the catalogue arrives (`lib/booking-errors.ts` 'The restaurant') |

Every EN default is today's exact text, casing included, so the site stays pixel-identical. Arrows and glyphs stay in the component as `${t} →` in one text node.

---

## 2. Registry move: the verified pattern

**Path A, section copy (server → page props).**
- `app/(site)/[lang]/(guarded)/page.tsx` reads `getStrings(locale, HOME_KEYS)` in parallel with `getHomeContent`. That loader is `'use cache'` and tagged content:ui; the page already carries the tag.
- It passes each client section only its own slice: `copyOf(strings, 'heritage')`, typed `Copy<'heritage'>`.
- `requireEnabledLocale` is still the first read, so the guard is unchanged.
- A two-line title is two keys with `<br/>` between them.

```tsx
const [{ shown, slides, experiences, stories, offers }, strings] = await Promise.all([getHomeContent(locale), getStrings(locale, HOME_KEYS)]);
…
{shown.has('heritage') && <Heritage copy={copyOf(strings, 'heritage')} />}
{shown.has('stories') && <Stories items={stories} copy={copyOf(strings, 'stories')} />}
```

**Path B, chrome copy (layout → SiteProvider).**
- Keys whose prefix is in `CLIENT_PREFIXES` (`error. booking. search. meal. finder.`, plus `legal.link`) arrive in `useSite().strings`. The `ClientKey` type is derived from the same prefixes.
- SearchOverlay uses `formatMessage(strings['search.results'], { count }, locale)`.

**Registry additions** (`lib/i18n/registry.ts`):
- `ADMIN_SCREENS` covers all 15 §7.2 string screens;
- `StringDef.label?` holds the Vietnamese field name (required by the end of phase 7);
- `CLIENT_PREFIXES` / `ClientKey` / `CLIENT_KEYS`;
- `SectionKey<P>`, `Copy<P>`, `sectionKeys(prefix)`, `HOME_SECTIONS`/`HOME_KEYS`, `keysForScreen(screen)`, `isStringKey`;
- the 25 keys.

**ICU** (`lib/i18n/icu.ts`, new; intl-messageformat 12.1.2):

```ts
import { IntlMessageFormat } from 'intl-messageformat';
const NAMED = new Set([1, 2, 3, 4, 5, 6]); // argument, number, date, time, select, plural
const SELECT = 5; const PLURAL = 6;
type Element = { type: number; value?: unknown; options?: Record<string, { value: Element[] }> };
export type MessageProblem =
  | { code: 'syntax'; detail: string } | { code: 'missing_var'; name: string }
  | { code: 'unknown_var'; name: string } | { code: 'no_other'; name: string };
function ast(text: string): Element[] {
  return new IntlMessageFormat(text, 'en', undefined, { ignoreTag: true }).getAst() as unknown as Element[];
}
function collect(elements: Element[], names: Set<string>, problems: MessageProblem[]): void {
  for (const el of elements) {
    if (NAMED.has(el.type) && typeof el.value === 'string') names.add(el.value);
    if ((el.type === SELECT || el.type === PLURAL) && el.options) {
      if (!('other' in el.options)) problems.push({ code: 'no_other', name: String(el.value) });
      for (const option of Object.values(el.options)) collect(option.value, names, problems);
    }
  }
}
export function messageArgs(text: string): string[] { const names = new Set<string>(); collect(ast(text), names, []); return [...names].sort(); }
export function checkMessage(text: string, vars: readonly string[] = []): MessageProblem[] {
  let elements: Element[];
  try { elements = ast(text); } catch (err) { return [{ code: 'syntax', detail: err instanceof Error ? err.message : String(err) }]; }
  const names = new Set<string>(); const problems: MessageProblem[] = [];
  collect(elements, names, problems);
  for (const v of vars) if (!names.has(v)) problems.push({ code: 'missing_var', name: v });
  for (const n of names) if (!vars.includes(n)) problems.push({ code: 'unknown_var', name: n });
  return problems;
}
export function describeProblem(p: MessageProblem): string { /* Vietnamese: 'Thiếu biến {x}: phải giữ nguyên biến này.' … */ }
```

**`lib/i18n/format.ts`** is hybrid, so no existing string changes behaviour. A plain `{name}` template keeps the phase-2 replace: an unknown variable stays visible and an ASCII `'` stays literal. Only templates with ICU syntax go through IntlMessageFormat with the page's locale; on a throw the raw template is returned.

`lib/i18n/registry.test.ts` now asserts `checkMessage(text, def.vars) === []` for EN and VI of every key. It replaces the regex check and the "no ICU" assertion.

**Registry off the client bundle.** `lib/booking-errors.ts` no longer imports `REGISTRY` at runtime. `DEFAULT_ERROR_STRINGS` and `bookingErrorMessage` were used only by its own test and moved into `lib/booking-errors.test.ts`. A type-level check keeps "every code has a key":

```ts
type _EveryCodeHasAKey = ErrorKey extends StringKey ? true : never;
export const EVERY_CODE_HAS_A_KEY: _EveryCodeHasAKey = true;
```

Verified: no chunk under `.next/static` contains any registry context text.

**Proof:**
- DOM diff after `npm run build`, with the base copied from the c896b13 build, normalised as in the phase-6 plan: **0 lines** on all three pages, measured twice (after the move, and after the editor and version work).
- Visual: 8 passed (`maxDiffPixelRatio: 0`) after the move, and 8 passed again after two full E2E runs.

---

## 3. CI guards

### (a) Guest text: `test/guards/guest-text.ts` + `guest-text.guard.test.ts`

Mechanism: oxc-parser (0.152) ESTree walk over `GUEST_SOURCES`:
- `components`
- `app/(site)`
- `app/global-not-found.tsx`, `app/global-error.tsx`
- `lib/content`, `lib/booking`, `lib/booking.ts`, `lib/booking-errors.ts`
- `lib/motion.tsx`

Four rules:
1. JSXText with a letter.
2. A string literal in a JSX attribute that is not in `NON_TEXT_ATTRIBUTES` (className, id, href, type, role, aria-hidden/modal/controls/…, data-*, plus enum props view/variant/kind/tone). So `aria-label`, `label`, `placeholder`, `alt`, `title` and any unknown prop are text.
3. Other string literals and template parts that `looksLikeProse`: two words, a Capitalised word, or an ALL-CAPS word. Template parts also count when a word stands alone after a space (`templateHasWord`: " restaurants →", " left", " of "), not glued to code (`${n}px`, `tel:${x}`, `error.${code}`).
4. `rendersDirectly`: any literal that flows straight into a JSX child or a template slot through `?:`, `||` or `??` (`{name || 'you'}`, `${n === 1 ? 'guest' : 'guests'}`). This catches lone lowercase words with no false positives on this codebase.

Code positions are skipped: imports, directives, object keys, member properties, TS types, under a non-text attribute (`className={a ? 'x y' : 'z'}`), `new *Error()`, `throw`, `console.*`.

Allowlists are keyed by `file: text`, with no line number:
- `LOCKED` (30, each with a reason): brand wordmarks, the 4 database-less error and not-found files, code tokens (UTC, en-GB, en-US, NFD, Escape, an IntersectionObserver margin, a querySelector), the honeypot label.
- `PENDING` (161, each mapped to its proposed key): this list is the move checklist.

Three tests:
1. No unlisted finding.
2. No stale entry: a moved string must leave PENDING in the same change.
3. PENDING size ≤ 161, so it only shrinks.

Phase 7's last task asserts PENDING is `{}`. CSS was checked by hand: no `content:` with letters.

Known blind spots, documented:
- lone lowercase words that pass through a variable or object map (e.g. a `label: 'x'` map);
- single-letter 'X';
- text built in modules outside `GUEST_SOURCES`.

Mitigation: review, and extend `GUEST_SOURCES` when a guest-facing lib file appears.

### (b) Editing screens

**`lib/admin/content-screens.ts`:**
- `EditScreen` = AdminScreen | sections | media | restaurant | restaurant-booking | locales | notifications.
- `EDIT_SCREENS: Record<EditScreen, { route, page, phase }>`.
- `COLUMN_SCREENS: Record<ContentTable, Record<column, EditScreen | { none: reason }>>`.
- `screensInUse()`.

**`test/guards/editing-screens.guard.test.ts`** (unit, no database):
1. Every key's screen has a route.
2. Every screen in use has its page file. Otherwise it must be in `NOT_BUILT` (12 screens today) or belong to a later phase (locales: 8).
3. Every string screen whose page exists renders a JSX element with `screen="<screen>"` in that folder (oxc).
4. `NOT_BUILT` lists only screens whose page is missing.

The red-then-green run is in errors_hit.

**`test/integration/editing-screens.test.ts`:** `COLUMN_SCREENS` equals `information_schema.columns` for every `CONTENT_TABLES` table, checked both ways, so a migration that adds a column fails CI until its owner is named. `legal_versions` was added to `CONTENT_TABLES`, `SAVE_TAGS` and `LOADERS.policyVersion`, and `lib/cache-plan.test.ts` still passes.

---

## 4. Editor prototype (content_strings)

### Server: `lib/server/content/strings-admin.ts` (full logic)

```ts
export async function loadScreenStrings(db: Db, screen: AdminScreen): Promise<StringField[]>  // value = row ?? registry en, token = US(updated_at) or ''
export type StringsInput = { screen: AdminScreen; values: Partial<Record<string,string>>; originals: Partial<Record<string,string>>; tokens: Partial<Record<string,string>> };
export function validateValue(key: StringKey, value: string): string[] {
  const def: StringDef = REGISTRY[key];
  if (value.trim() === '') return ['Không được để trống. Muốn dùng chữ mặc định thì bấm “Khôi phục mặc định”.'];
  const errors: string[] = [];
  if ([...value].length > def.maxLength) errors.push(`Tối đa ${def.maxLength} ký tự (đang có ${[...value].length}).`);
  errors.push(...checkMessage(value, def.vars ?? []).map(describeProblem));
  return errors;
}
export async function saveStrings(pool, actor, input) {
  // 1. for each submitted key: refuse keys of another screen (forged form); normalise CRLF + trim;
  //    skip when value === original (untouched by this editor); validateValue → fieldErrors `v:<key>`
  // 2. withTransaction: per key pg_advisory_xact_lock(hashtext('content_strings:'||key)) (no row to FOR UPDATE yet),
  //    read row; if row value === new value → skip; token mismatch → conflictBy(updated_by, updated_at);
  //    value === registry en → DELETE row ("Khôi phục mặc định"), else UPSERT status 'reviewed', origin 'human',
  //    reviewed_by/at, updated_by/at; insertAudit(action create|update|delete, entity 'content_strings', entity_id key,
  //    locale 'en', before {value, overridden}, after {value, overridden})
  // 3. if any changed key ∈ AGREED_KEYS → recordPolicyVersion(client, actor) in the same transaction
  // returns { ok:true, data:{ changed, policyVersion } } | invalid | conflict
}
export function tagsForStrings(keys: readonly StringKey[], policyVersionChanged = false): string[] {
  const tags = new Set<string>();
  for (const key of keys) {
    if (key.startsWith('email.')) continue;                 // read uncached by the email sender
    tags.add((PRIVACY_KEYS as readonly string[]).includes(key) ? TAGS.contentLegal : TAGS.contentUi);
  }
  if (policyVersionChanged) tags.add(TAGS.contentLegal);
  return [...tags];
}
```

### Action: `app/admin/(shell)/content/actions.ts`

It follows the §7.4 order. `updateTag` is valid here because it runs in a Server Action: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/updateTag.md:6,8,12`.

```ts
export async function saveScreenStrings(_prev, formData) {
  try {
    const staff = await requirePermission({ content: ['update'] });
    const { screen } = Screen.parse({ screen: formData.get('screen') });
    const result = await saveStrings(getPool(), auditActor(staff), {
      screen, values: fields(formData, 'v:'), originals: fields(formData, 'o:'), tokens: fields(formData, 't:') });
    if (!result.ok) return result;
    for (const tag of tagsForStrings(result.data.changed, result.data.policyVersion !== null)) updateTag(tag);
    refresh();
    return result;
  } catch (err) { return actionError(err); }
}
```

### UI

**`app/admin/(shell)/content/_ui/StringsPanel.tsx`** (server) loads the screen's fields and renders **`StringsForm.tsx`** (client):
- `useActionState(saveScreenStrings)`; `<form method="post" onSubmit={submitKeepingValues(action)} key={tokens.join('|')} aria-label={title}>`. Rule 9: the inner form re-keys, the holder keeps its message.
- Per field:
  - hidden `o:` / `t:` inputs;
  - an input, or a textarea when maxLength > 120;
  - a live counter `n/max ký tự`;
  - "Giữ nguyên biến: {x}" and "Đã sửa so với mặc định" / "Đang dùng chữ mặc định";
  - `aria-invalid` and `aria-describedby` built with `useId` (hint plus error);
  - `<details>` with the EN context and default, and a "Khôi phục mặc định" button.
- `children` slot before Save, used by the emails preview.

**Pages** (each: `instant = false`, `requirePagePermission({content:['read']})` first):
- `/admin/content`: index;
- `/admin/content/ui-text`, `stories`, `heritage`: `<StringsPanel screen=…>`;
- `/admin/content/legal`: panel, the current version and the version list;
- `/admin/content/emails`: panel plus preview.

Nav: "Nội dung" (`content:read`), visible to the Editor. `lib/admin/nav.test.ts` and two E2E nav expectations were updated.

### Legal version (phase-5 ledger T8.2)

`db/migrations/009_legal_versions.sql`:

```sql
CREATE TABLE IF NOT EXISTS legal_versions (
  version      text        PRIMARY KEY CHECK (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]{1,3})?$'),
  effective_on date        NOT NULL,
  text_sha256  text        NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text
);
INSERT INTO legal_versions (version, effective_on, text_sha256, created_at, created_by)
VALUES ('2026-10-03', DATE '2026-10-03', 'f49aa3f58723d14d6491c1801466c411fe9439acab85b4da5272d4c7676e10d2',
        TIMESTAMPTZ '2026-10-03 00:00:00+07', 'seed')
ON CONFLICT DO NOTHING;
```

The seed hash is the pair `lib/legal.test.ts` already pins. The integration test proves that restoring every default reproduces exactly that hash.

`lib/server/content/policy-version.ts`:
- `policyTextHash`: sha256 of the JSON `[[key, EN]]` over `AGREED_KEYS`. `AGREED_KEYS` now lives in `lib/legal.ts` and is the policy keys plus `booking.privacy_notice` and `booking.consent`.
- `currentPolicyVersion(db)`.
- `recordPolicyVersion(client, actor)`:
  - takes an advisory lock;
  - recomputes the resolved EN text inside the transaction;
  - inserts `YYYY-MM-DD` (Da Nang date), or `.2`, `.3` … for a later change the same day, only when the hash differs from the newest row;
  - writes an audit row.
- `listPolicyVersions`.

Wiring:
- `lib/server/booking/create.ts` stores `COALESCE((SELECT version FROM legal_versions ORDER BY created_at DESC, version DESC LIMIT 1), $14)`; `PRIVACY_POLICY_VERSION` is only the fallback.
- The privacy page prints `getPolicyVersion().effectiveOn`. That is a new cached loader (`cacheLife('max')`, tag content:legal).
- The DOM of `/en/privacy` is identical.

### Email preview

Route `app/api/admin/emails/preview/route.ts` (POST):
1. `try { await requirePermission({content:['read']}) } catch { return 403 }`, which passes the CI guard's shape.
2. Origin must equal the request origin.
3. Validates the posted `v:email.*` with `validateValue`; a refusal is a 422 page.
4. Calls `renderSampleEmail(pool, event, locale, { adminOrigin, overrides })` (new `overrides` option, EN only) and injects a "Tiêu đề: …" banner.
5. Response headers: `CSP: default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`, `X-Frame-Options SAMEORIGIN`, `no-store`, `noindex`.

Why a route handler: email HTML is inline-styled. The admin CSP has no `'unsafe-inline'`, and an `srcdoc` frame would inherit that policy.

The emails page puts `<button formAction="/api/admin/emails/preview" formMethod="post" formTarget="email-preview">` inside the strings form, followed by `<iframe name="email-preview" sandbox="">`. `lib/admin/form.ts` `submitKeepingValues` now returns before `preventDefault()` when the submitter has `formaction`, so the browser submits normally. The CSS is `.a-email-preview`.

---

## 5. Test outputs

**HEAD c896b13** (my environment):

| Check | Result |
|---|---|
| typecheck | clean |
| lint | 19 warnings |
| unit + integration | 83 files / 1039 tests |
| visual | 8 passed |
| E2E | 169 tests listed |

**Final:**

| Check | Result |
|---|---|
| typecheck | exit 0 |
| lint | exit 0, **19 warnings** (unchanged) |
| unit + integration | **88 files / 1112 tests, all passed**: new icu.test, guest-text guard (5), editing-screens guard (27 cases), editing-screens integration, content-strings-admin integration (8) |
| reset → build | exit 0 |
| `check-prerender` | passed; the admin check lists `/admin/content*` with no static shell |
| DOM diff | 0 lines × 3 pages |
| E2E full, run 1 | **172 passed, 1 skipped** (botid), 1.8 m |
| E2E full, run 2 (`TZ=UTC`) | **172 passed, 1 skipped** |
| new `e2e/content-strings.serial.spec.ts` | 4/4 (below) |
| visual after both E2E runs | **8 passed** |

The 4 new E2E tests in `e2e/content-strings.serial.spec.ts`:
1. The Editor renames the Stories title: the guest's next load shows it (asserted < 10 s), then the default is put back through the form and the row is gone.
2. `{n} RESULTS` is refused: alert, `aria-invalid`, the value is kept, the message names `{count}`, nothing is written. A valid `search.popular` reaches the search dialog, and the default ICU plural still renders "1 RESULT".
3. A legal edit says "Phiên bản chính sách mới", and `/en/privacy` shows the new text and "Last updated <today>". Cleanup deletes the extra versions first, then restores through the form, so no version is added and the page shows "3 October 2026" again.
4. The email preview POSTs the unsaved subject: 200, body has the banner, CSP has `frame-ancestors 'self'`, the frame navigated, nothing written. A dropped `{reference}` gets 422 "Thiếu biến {reference}".

**Mutations** (each reverted after the run):

| # | Mutation | Caught by |
|---|---|---|
| M1 | no `updateTag` | E2E 1–3 fail ("Kitchen Stories E2E" expected, the old title received) |
| M2 | no token check | integration fails |
| M3 | no ICU check | integration fails |
| M3b | untouched fields not skipped | integration fails (after the test helper was fixed, see errors) |
| M5 | page renders the wrong `screen=` | guard fails |
| M6 | a column unmapped | integration fails |
| M7 | no policy version | 2 integration tests fail |
| M8 | inline `aria-label="Close search"` | guest-text guard fails |

An earlier manual mutation, re-inlining "Stories from our Kitchens", also failed the guard with `file:line` output.

---

## 6. Screen-by-screen editors and the 7A / 7B split

**Shared kit.** Strings parts are built in this spike; the rest comes from the p7-kit and p7-media spikes:
- **StringsPanel/StringsForm** (registry keys by screen, EN until phase 8);
- Field primitives: TextField, NumberField, LinkField (https), PhoneField (E.164 pair), DateRange, MoneyField, with `useId`, `aria-invalid`, echo on refusal;
- SaveBar (row tokens and conflict with "Tải lại");
- SortableList (min/max, publish toggle);
- ImagePicker (library, upload, alt, decorative);
- LimitNotice (§6.5 warn and refuse);
- HistoryPanel and restore;
- "Xem trên web".

| Screen | Edits | Kit parts | Limits and rules |
|---|---|---|---|
| content/sections | `sections.is_visible`, picture and link of experiences, heritage, film | toggles, ImagePicker, LinkField | restaurants locked on; L7-1 E2E (hero hidden then restored) |
| content/hero | `hero_slides`, `hero.*`, `film.*`, `site_settings.hero_autoplay_ms`, film poster/URL | SortableList, ImagePicker, StringsPanel | 1–5 slides; slide 1 needs a mobile crop; YouTube/Vimeo only |
| content/cuisines | `cuisines` + i18n, `cuisines.*` | SortableList, ImagePicker | soft max 10 |
| content/destinations | `destinations` + i18n, `destinations.*` | SortableList, PhoneField, ImagePicker | 2–5, ≤ 1 teaser; L7-2 hide semantics plus the warning count |
| content/experiences | `experiences` + i18n, `experiences.*` | SortableList, LinkField | 1–5 |
| content/heritage | `heritage.*` ✓ (picture and link on sections) | StringsPanel | lines fit a fixed box |
| content/stories | `stories` + i18n, `stories.*` ✓ | SortableList, ImagePicker, date | ≤ 4 |
| content/offers | `offers` + i18n, `offers.*` | SortableList, MoneyField, DateRange, delete/restore | 0–6 (multiple of 3 advised); R5/L7-12; acceptance: edit then delete, restore ×2 |
| content/booking | `booking.*`, `finder.*`, `meal.*`, `form.*`, default occasion and restaurant | StringsPanel, selects | — |
| content/navigation | `nav_items` + i18n | SortableList | ≤ 6; label warn > 14, refuse > 18; hides with its section |
| content/contact | `social_links`, `social.*`, `footer.*`, footer address lines | SortableList, LinkField | ≤ 6 socials; L7-7 a venue needs a name |
| content/seo | `seo.*`, `site_settings.og_image_id` | StringsPanel, ImagePicker | title ≤ 60, description ≤ 155 advised |
| content/legal | ✓ legal keys + version list | StringsPanel | version bump |
| content/emails | ✓ `email.*` + preview | StringsPanel, preview | group by event; VI tab decision |
| content/ui-text | ✓ `ui/form/error/search/common` | StringsPanel | — |
| /admin/restaurants | list, publish/archive/order, `restaurants.*` + `detail.*` | SortableList, StringsPanel | — |
| /admin/restaurants/[id] | name, slug, destination, cuisines, images, phone, map, detail page, kicker, story, highlights, menu PDF, SEO, history | many | `has_detail_page` ⇒ `detail_image_id` + EN story; 0–5 highlights; name warn > 24; L7-3/4/5/13 |
| /admin/media | library, alt, decorative, delete refused while in use, sweep | upload | jpeg/png/webp/avif/pdf ≤ 15 MB |

**Recommendation: split into two plans.**

**7A — kit, media, history, strings infrastructure and the high-risk editors (about 11 tasks).**
- Strings infrastructure (this spike as task 1);
- form kit;
- history and restore engine;
- media library, Blob upload and sweep;
- old images to Blob, CmsImage for the plain `<img>`, baselines re-taken (R3);
- sections + hero (L7-1);
- offers (R5, L7-11/12);
- restaurants list + `[id]` (L7-3/4/5/13);
- destinations (L7-2);
- 7A acceptance: a file in use cannot be deleted; an offer can be edited, deleted and restored twice.

**7B — remaining editors, the registry move and acceptance (about 9 tasks).**
- cuisines; experiences + stories lists; navigation (with the chrome `ui.*` keys); contact; booking (with the drawer and `form.*` keys); SEO (metadata from the registry); emails/legal completion; ui-text completion;
- each task moves its section's PENDING keys, then gates visual 8/8 and the DOM diff;
- final task: PENDING `{}` and NOT_BUILT `[]` asserted, plus a table-driven E2E walk of the §2.1–2.19 checklist (EN edit → guest shows within seconds → restore).

**Rationale.**
1. Every shared mechanism, and every place where rework is likely, sits in 7A: Blob and CSP/`remotePatterns`, restore with `OVERRIDING SYSTEM VALUE`, a visual baseline retake that needs the owner, the history snapshots.
2. 7B is wide but mechanical, uses the kit unchanged, and its tasks are independent per screen.
3. Each plan stays at about 10 tasks, with a reviewable checkpoint: 7A owns the "file in use" and "offer restore" acceptance, 7B the "every item editable" and "no guest text outside registry/DB" acceptance.
4. The registry move is pixel-sensitive and pairs naturally with each screen's editor, so each 7B task's own E2E covers its strings. Phase 7 is estimated at 13–16 days; one plan would hold about 20 tasks.

## Errors hit, and their fixes

| # | Error | Cause | Fix |
|---|---|---|---|
| 1 | node: ERR_MODULE_NOT_FOUND 'oxc-parser' when running the literal probe from the scratch work directory | The probe lived outside the clone, so Node could not see the clone's node_modules | Ran probes from a `.p7probe` directory inside the clone (removed afterwards; a copy is kept at `p7ed-work/p7probe-copy`) |
| 2 | Every JSX attribute name came out as 'undefined' in the first scan | oxc gives a JSXIdentifier whose `.name` is a string; my code read `.name.name` | `attributeName()` handles both JSXIdentifier and JSXNamespacedName |
| 3 | The scanner test printed nothing | vitest swallowed console.log in this setup | The probe writes its output to a file named by `SCAN_OUT` |
| 4 | The registry test's variable check failed for `'{count, plural, one {# RESULT} other {# RESULTS}}'` | The phase-2 regex `/\{(\w+)\}/` cannot see ICU arguments, and the test also asserted that no string uses ICU | Replaced both with `checkMessage(text, vars)` from the new `lib/i18n/icu.ts`, which parses with `IntlMessageFormat.getAst` |
| 5 | TS2304 Cannot find name 'Choice' in lib/content/options.ts; TS errors in options.test.ts and data.test.ts | A python edit removed the local Choice type; the tests called the old signatures and imported MEAL_LABELS | Restored the type. occasionOptions, cuisineOptions and destinationOptions now take the client strings; MEAL_KEYS maps each Meal to its ClientKey; the tests were updated, and data.test now checks the meal.* defaults equal the meal names |
| 6 | Template-word rule flagged 'error.', 'tel:' and 'px' | The first regex allowed a word at the start of a template part and ':' as a terminator | A word must follow a space: `/\s\p{L}{2,}(?=[\s.,!?…→]\|$)/u` |
| 7 | Full E2E: 2 failures in admin-acceptance.spec.ts:106 and admin-users.spec.ts:159; the serial project never ran | The Editor's sidebar now has 'Nội dung'. desktop-serial depends on desktop, so a desktop failure skipped it | Updated both expectations. Single-file runs now use `--project=desktop-serial --no-deps` |
| 8 | The email preview test could not read the iframe ('Blocked script execution in about:blank … sandboxed') | Playwright cannot inject its script into a `sandbox=""` frame, which is what the sandbox is for | Kept `sandbox=""`. The test asserts the POST response (status, body, CSP header) and that the named frame navigated |
| 9 | The preview button sent no POST (the submit event bubbled with defaultPrevented = true) | My edit to submitKeepingValues put the formaction passthrough after `event.preventDefault()` | Check the submitter's formaction first and return before preventDefault; confirmed in the built chunk and by E2E |
| 10 | Mutation M3b (no skip for untouched fields) survived the integration tests | The test helper submitted only the edited fields, unlike the real form, which posts every field | The helper posts every field as loaded, with edits typed over them; M3b now fails the 'two editors' test |
| 11 | The /admin/content index used existsSync on page source files | Source files are not present at runtime on Vercel | A static list of the built screens |
| 12 | One full unit run: migration-008.test.ts 'Hook timed out in 10000ms' | A pre-existing test's database-reset hook ran slowly under load once; it passed in the gate before and on two reruns | None needed (88/88 passed on rerun). Watch it: the 10 s hook limit is tight |
| 13 | The whole REGISTRY (contexts, email texts, VI defaults) was in a 15 kB-gzip client chunk on every guest page | lib/booking-errors.ts, which ships via WithPhone, built DEFAULT_ERROR_STRINGS from REGISTRY at module level; it and bookingErrorMessage were used only by tests | Moved both into lib/booking-errors.test.ts and kept a type-level 'every code has a key' check. No chunk contains registry text any more; home JS is +2,859 B gzip over HEAD instead of +10,772 |
| 14 | Ran 'git checkout -p --' with stdin from /dev/null while restoring a mutation | An operator slip in a one-liner | No hunk was discarded (EOF quits); git status and typecheck confirmed the tree was intact |

## Package versions
- `intl-messageformat@12.1.2` (new dependency, installed in the clone from the npm registry; spec §4 names ^12)
- `@formatjs/icu-messageformat-parser@3.5.20`, `@formatjs/fast-memoize@3.1.7`, `@formatjs/icu-skeleton-parser@2.1.12` (transitive; the parser also has a './no-parser.js' export for precompiled messages)
- `next@16.3.7`
- `react@19.3.0` / `react-dom@19.3.0`
- `typescript@7.0.2`
- `oxc-parser@0.152` (guards)
- `oxlint@1.86.0`
- `vitest@5.0.3`
- `@playwright/test@1.63.0`
- `pg@8.23.0`
- `zod@4.6.5`
- Node 22.22.0 locally, Postgres 18.3 locally

## Recommended task breakdown (spike's proposal; the outline's §3 supersedes it)

Split phase 7 into two plans (rationale in §6).

7A: kit, media, history, strings infrastructure and the high-risk editors.
- A1. Strings infrastructure (this spike's patch). intl-messageformat; lib/i18n/icu.ts; ICU-aware formatMessage; registry ADMIN_SCREENS (15), the Vietnamese label field, delivery helpers (CLIENT_PREFIXES, sectionKeys/Copy, keysForScreen); registry off the client bundle (booking-errors); StringsPanel/StringsForm with the content/actions.ts save; tagsForStrings; /admin/content index and nav; guest-text guard with LOCKED/PENDING; editing-screens guard and its column integration test; migration 009 legal_versions with recordPolicyVersion and the booking/privacy wiring; email preview route. Proof sections: stories, heritage, search, meal, finder. Gate: visual 8/8 and a 0-line DOM diff.
- A2. Form-kit field primitives and SaveBar (p7-kit spike), plus the phase 3–5 ledger form items: echo on refusal, useId, aria-invalid/describedby, number inputs, unsaved-changes guard.
- A3. History and restore engine: audit snapshots of the main row plus every *_i18n row; restore through §7.4 with OVERRIDING SYSTEM VALUE for identity ids; HistoryPanel; restore of content_strings rows.
- A4. Media library (/admin/media): alt, decorative, and a refused delete while the file is in use (RESTRICT, with a pre-check that lists the users), soft delete.
- A5. Blob upload: token route after session and permission checks; registerMedia; sharp metadata and blur_data_url; limits; local fake Blob; images.remotePatterns; L7-8.
- A6. Move /assets to Blob (idempotent script, its own environment's store); CmsImage for every plain <img> (R3) with re-taken baselines after owner sign-off; media-sweep cron.
- A7. Sections and hero editors: move the hero.* and film.* keys; L7-1 E2E; slide limits; film URL rules.
- A8. Offers editor: delete and restore (R5, L7-12), L7-11, the offers.* keys including the price templates, the owner's lede ruling.
- A9. /admin/restaurants list and [id] editor: restaurants.* and detail.* keys; has_detail_page constraints; highlights 0–5; menu PDF; restaurant SEO; L7-3/4/5/13.
- A10. Destinations editor: L7-2 publish semantics in the loaders and bookingEnabled, tags, warning count.
- A11. 7A acceptance gate: file in use cannot be deleted; offer edit → delete → restore twice; visual and DOM diff; three E2E runs.

7B: remaining editors, the registry move and acceptance.
- B1. Cuisines editor and cuisines.* keys.
- B2. Experiences and stories list editors and experiences.* keys (owner: links, film URL).
- B3. Navigation editor (≤ 6, labels 14/18) and the chrome ui.* keys (Header, MenuOverlay, MobileBar).
- B4. Contact editor: social_links (≤ 6) and social.* labels (L7-15), footer.*, footer venue lines (L7-7).
- B5. Booking screen: booking.*, finder.*, form.*, drawer copy, ICU booking.guests_count and slot aria, site_settings defaults.
- B6. SEO screen: seo.* keys (metadata from the registry), the og image.
- B7. Emails and legal completion: group the emails by event, decide the VI tab, ledger items T5.1/T5.3/T5.5/T8.1.
- B8. ui-text completion: common.*, (guarded)/not-found, restaurants.* filter copy. Assert guest-text PENDING == {} and editing-screens NOT_BUILT == [].
- B9. Acceptance walk: table-driven E2E over the §2.1–2.19 checklist (edit EN → guest within seconds → restore), then the full gates.

Every 7B task moves its section's PENDING keys (the PENDING map is the per-task checklist) and gates on visual 8/8 at ratio 0 plus the 0-line DOM diff.

## Risks and open questions
1. Email editing is English-only in phase 7 (per the brief), but staff.new goes to staff in Vietnamese by default, and the registry already has VI defaults for email.*. Staff email text stays uneditable until phase 8 unless phase 7 opens a VI tab on the emails screen only. Owner or controller to decide.
2. Pages that render without the database ([lang]/error.tsx, [lang]/not-found.tsx, global-error, global-not-found) cannot read content_strings. The guard locks them by design (spec §12). The phase-7 acceptance ('no guest text outside registry or DB') needs a ruling that these count as locked.
3. Social platform labels: today's code comment calls them a brand (untranslated), while ledger L7-15 says move them to the registry. The guard lists them as PENDING social.* keys. Decide which.
4. Two screens claim the same columns. The film poster and URL (sections[film]) are listed on both the hero and the sections screens in spec §7.2; COLUMN_SCREENS gives them to 'sections'. site_settings.email is 'Email chung' on the contact screen (Editor) but is edited today in Admin-only notifications, and it is where staff.new falls back, so an Editor would gain the power to redirect booking mail. Recommendation: contact shows it read-only.
5. Cache tags: every content_strings save expires content:ui, and the policy keys content:legal. Spec §6.2 names per-section tags (content:hero etc.) for section copy. Since D2 every guest page carries content:ui anyway, so finer tags buy nothing. Confirm as a ruling.
6. Bundle: intl-messageformat adds about 10.5 kB gzip to every guest page. That is offset here by taking the registry off the client (net +2.9 kB). A further option: precompile ICU strings on the server, ship ASTs, and alias the parser to its 'no-parser' export (about 6 kB more saved). Not verified.
7. CLIENT_KEYS will grow from about 37 to about 110 keys as the chrome moves (ui.*, form.*, common.*, film.*, footer.*, social.*, detail.*): roughly +4 kB raw and +1.5 kB gzip of RSC payload per page. Page-only section copy goes through page props so that only the home page pays for it.
8. Scanner blind spots: lone lowercase words passed through variables or object maps; single letters ('X'); guest text built in lib files outside GUEST_SOURCES. Rule 4 (rendersDirectly) catches direct uses. Review must extend GUEST_SOURCES when a new guest-facing lib file appears.
9. legal_versions: the version is the Da Nang date with a .n suffix (≤ 40 characters, consent_version's limit). The privacy page shows effective_on. Restoring old wording is a new version (it never moves back), which is right legally but should be confirmed with the owner or lawyer. Migration 009 must go to Neon through the runbook (controller step).
10. UI polish seen in the screenshots: in the a-grid-form three-column grid, the email preview fieldset sits in a narrow cell (it needs grid-column: 1/-1), and the 31 email keys need grouping by event. Keys without a 'label' show their raw key; phase 7 must give every key a Vietnamese label.
11. migration-008.test.ts timed out its 10 s hook once (pre-existing test) and passed on rerun; it could flake on CI.
12. Not covered by this spike (owned by p7-kit and p7-media): restore with OVERRIDING SYSTEM VALUE, Blob upload and the fake API, 'file in use cannot be deleted', offers delete/restore. The history snapshot shape for content_strings ({value, overridden} before and after) is ready for the restore engine.

## Spec deviations (the spike's list; rulings in the outline §2)
1. §6.2 tag list: content_strings saves expire content:ui (getStrings) or content:legal (getPrivacyStrings, PRIVACY_KEYS); email.* keys expire nothing (read uncached). Section-specific tags (content:hero, content:stories …) are not used for strings, because every page already carries content:ui (phase-6 D2).
2. §5.1 item 2 registry fields: adds an optional Vietnamese 'label' per key for the admin (to become required in phase 7), because the admin is Vietnamese-only (§7.3) while 'context' is English for translators and the AI.
3. §11 / phase-5 T8.2 'version = time of the save': implemented as an append-only legal_versions table (new migration 009). The version string is the Da Nang date plus a suffix, added only when the hash of the agreed EN text changes; PRIVACY_POLICY_VERSION stays as the seed and fallback.
4. §7.2 emails preview: implemented as a POST route handler (/api/admin/emails/preview) with its own CSP, framed by the admin, rather than inside the admin page, because the email's inline styles break under the admin's nonce CSP.
5. §7.2 emails 'theo từng loại và ngôn ngữ': phase 7 edits EN only, per the brief and §7.3; VI preview shows saved or registry text. Flagged as an open question, since staff emails are Vietnamese.
6. Spec silent: saving a value equal to the registry default deletes the content_strings row instead of storing a copy, so a later code default still reaches the site; the audit row records action 'delete'.
7. §13 'no guest-visible text outside registry or DB': the database-less fallback pages are LOCKED in the guard (they cannot read the database by design, §12); this needs a ruling.
8. ADMIN_SCREENS now lists the §7.2 list screens (cuisines, restaurants, destinations, experiences, heritage, stories, offers) as string screens. No deviation in substance; noted because the phase-6 registry listed only 8 screens.

## User steps
- Owner: say whether the English-only email editor in phase 7 is enough, or whether the Vietnamese staff emails need a VI tab in phase 7.
- Owner: confirm that the error and not-found pages shown when the database is down stay fixed text (locked), outside the 'every text editable' checklist.
- Owner: decide whether the social network names in the footer (FACEBOOK, INSTAGRAM …) are fixed brand text or editable and translatable labels.
- Owner (carried from phase 6): the date in the Offers lede, the link targets of the 3 Experiences, and the film's YouTube or Vimeo URL.
- Owner: create the two Vercel Blob stores (Production; Preview/Dev) in the Vercel dashboard. This spike did not touch Blob; that is the p7-media spike.
- Controller: rule on the content:ui-only tag strategy for strings, and on who edits site_settings.email (contact vs notifications).
- Controller: when phase 7 lands, apply migration 009_legal_versions.sql to Neon through the README runbook (preflight → migrate → postcheck); it is expand-only and its seed is idempotent.
- Controller: review and apply the spike patch at …/scratchpad/p7ed-work/p7-edit-spike.patch on c896b13 as the basis for task A1.
