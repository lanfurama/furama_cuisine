import { describe, expect, it } from 'vitest';
import { findingId, looksLikeProse, scanGuestText, templateHasWord } from './guest-text';

/*
 * Spec §13 "Bảo vệ" and §14.1 row 7 acceptance: "test CI không tìm thấy chữ
 * khách nhìn thấy nằm ngoài registry hoặc DB". The scanner (./guest-text.ts)
 * lists every literal in the guest site's source that reads like words; each
 * must be LOCKED (with the reason it is not content) or PENDING (still to
 * move, with the registry key it moves to). Phase 7 empties PENDING; a new
 * literal in a guest component fails here until it becomes a key.
 *
 * Entries are "file: text" (no line numbers), and an entry nothing matches
 * any more fails too, so the lists only shrink and never go stale.
 */

/** Not content: brand marks, pages that render without a database, code tokens. */
const LOCKED: Record<string, string> = {
  "app/(site)/[lang]/(guarded)/privacy/page.tsx: UTC": "code token, not text",
  "app/(site)/[lang]/(guarded)/privacy/page.tsx: en-GB": "code token, not text",
  "app/(site)/[lang]/error.tsx: Please try again, or call us to book:": "renders without the database or a language (spec §12): code text by design",
  "app/(site)/[lang]/error.tsx: TRY AGAIN": "renders without the database or a language (spec §12): code text by design",
  "app/(site)/[lang]/error.tsx: We could not load this page.": "renders without the database or a language (spec §12): code text by design",
  "app/(site)/[lang]/not-found.tsx: Back to Furama Cuisine": "renders without the database or a language (spec §12): code text by design",
  "app/(site)/[lang]/not-found.tsx: Page not found": "renders without the database or a language (spec §12): code text by design",
  "app/global-error.tsx: Furama Cuisine": "renders without the database or a language (spec §12): code text by design",
  "app/global-error.tsx: Please try again, or call us to book:": "renders without the database or a language (spec §12): code text by design",
  "app/global-error.tsx: TRY AGAIN": "renders without the database or a language (spec §12): code text by design",
  "app/global-error.tsx: We could not load this page.": "renders without the database or a language (spec §12): code text by design",
  "app/global-not-found.tsx: Back to Furama Cuisine": "renders without the database or a language (spec §12): code text by design",
  "app/global-not-found.tsx: Page not found": "renders without the database or a language (spec §12): code text by design",
  "app/global-not-found.tsx: Page not found — Furama Cuisine": "renders without the database or a language (spec §12): code text by design",
  "components/overlays/Honeypot.tsx: Website": "honeypot label: hidden from people (aria-hidden, off-screen), bait for bots",
  "components/overlays/MenuOverlay.tsx: FURAMA CUISINE": "brand wordmark (inventory §2.2/§2.17/§2.18, class L)",
  "components/overlays/ReserveDrawer.tsx: .daystrip .day[aria-pressed=\"true\"]": "code token, not text",
  "components/overlays/SearchOverlay.tsx: FURAMA CUISINE": "brand wordmark (inventory §2.2/§2.17/§2.18, class L)",
  "components/site/Footer.tsx: FURAMA CUISINE": "brand wordmark (inventory §2.2/§2.17/§2.18, class L)",
  "components/site/Header.tsx: CUISINE": "brand wordmark (inventory §2.2/§2.17/§2.18, class L)",
  "components/site/Header.tsx: FURAMA": "brand wordmark (inventory §2.2/§2.17/§2.18, class L)",
  "components/site/Header.tsx: FURAMA CUISINE": "brand wordmark (inventory §2.2/§2.17/§2.18, class L)",
  "components/site/IntroCurtain.tsx: CUISINE": "brand wordmark (inventory §2.2/§2.17/§2.18, class L)",
  "components/site/IntroCurtain.tsx: FURAMA": "brand wordmark (inventory §2.2/§2.17/§2.18, class L)",
  "components/site/PageCurtain.tsx: FURAMA": "brand wordmark (inventory §2.2/§2.17/§2.18, class L)",
  "components/site/SiteProvider.tsx: Escape": "code token, not text",
  "lib/booking.ts: NFD": "code token, not text",
  "lib/content/format.ts: UTC": "code token, not text",
  "lib/content/format.ts: en-US": "code token, not text",
  "lib/motion.tsx: 0px 0px -8% 0px": "code token, not text",
};

/** Still inline. Each moves to the registry key named (proposed names; spec §5.1 item 2), or to its phase. */
const PENDING: Record<string, string> = {
  "app/(site)/[lang]/(guarded)/not-found.tsx: Back to Furama Cuisine": "common.back_home",
  "app/(site)/[lang]/(guarded)/not-found.tsx: Page not found": "common.not_found",
  "app/(site)/[lang]/(guarded)/privacy/page.tsx: — Furama Cuisine": "seo.page_title ('{page} — Furama Cuisine')",
  "app/(site)/[lang]/(guarded)/restaurants/[slug]/page.tsx: At": "detail.highlights_title ('At {name}')",
  "app/(site)/[lang]/(guarded)/restaurants/[slug]/page.tsx: Page not found — Furama Cuisine": "seo.not_found_title",
  "app/(site)/[lang]/(guarded)/restaurants/[slug]/page.tsx: — Furama Cuisine": "seo.page_title",
  "app/(site)/[lang]/layout.tsx: From beachfront dining to vibrant city destinations – discover the restaurants, cuisines and people of Furama Cuisine in Da Nang.": "seo.home_description",
  "app/(site)/[lang]/layout.tsx: Furama Cuisine": "seo.og_title",
  "app/(site)/[lang]/layout.tsx: Furama Cuisine — Many Flavours. Many Destinations.": "seo.home_title",
  "app/(site)/[lang]/layout.tsx: People · Culture · Great Food — dining across Furama’s Da Nang destinations.": "seo.og_description",
  "components/booking/BookingBar.tsx: Date": "booking.label_date",
  "components/booking/BookingBar.tsx: Destination": "booking.label_destination",
  "components/booking/BookingBar.tsx: FIND A TABLE": "booking.find_table",
  "components/booking/BookingBar.tsx: Full": "booking.slot_full",
  "components/booking/BookingBar.tsx: Guests": "booking.label_guests",
  "components/booking/BookingBar.tsx: Restaurant": "booking.label_restaurant",
  "components/booking/BookingBar.tsx: Time": "booking.label_time",
  "components/booking/BookingBar.tsx: Today": "common.today",
  "components/booking/BookingBar.tsx: Tomorrow": "common.tomorrow",
  "components/booking/BookingBar.tsx: Where would you like to dine?": "booking.title",
  "components/booking/BookingBar.tsx: left": "booking.slot_left ('{count} left')",
  "components/detail/MoreRestaurants.tsx: ALL RESTAURANTS →": "detail.more_all",
  "components/detail/MoreRestaurants.tsx: More at": "detail.more_title ('More at {destination}')",
  "components/detail/RestaurantHero.tsx: ALL RESTAURANTS": "detail.back_all",
  "components/detail/RestaurantHero.tsx: BACK": "detail.back",
  "components/detail/RestaurantHero.tsx: Brand Story": "detail.story_label (restaurant_i18n.story_label overrides)",
  "components/detail/RestaurantHero.tsx: CALL": "detail.call",
  "components/detail/RestaurantHero.tsx: MAP": "detail.map",
  "components/detail/RestaurantHero.tsx: MENU": "detail.menu",
  "components/detail/RestaurantHero.tsx: RESERVE A TABLE": "ui.reserve_table",
  "components/home/Cuisines.tsx: ALL CUISINES →": "cuisines.all",
  "components/home/Cuisines.tsx: Explore by Cuisine": "cuisines.title",
  "components/home/Destinations.tsx: Coming soon": "common.coming_soon",
  "components/home/Destinations.tsx: Different places. One culinary family.": "destinations.lede",
  "components/home/Destinations.tsx: Our Destinations": "destinations.title",
  "components/home/Destinations.tsx: restaurants →": "destinations.count ('{count, plural, one {# restaurant} other {# restaurants}}')",
  "components/home/Experiences.tsx: A meaningful experience.": "experiences.title_2",
  "components/home/Experiences.tsx: Experiences": "experiences.eyebrow",
  "components/home/Experiences.tsx: More than a meal.": "experiences.title_1",
  "components/home/Finder.tsx: Coming soon": "common.coming_soon",
  "components/home/Finder.tsx: Cuisine": "finder.cuisine",
  "components/home/Finder.tsx: Da Nang": "finder.city",
  "components/home/Finder.tsx: Destination": "finder.destination",
  "components/home/Finder.tsx: Find a restaurant": "finder.title",
  "components/home/Finder.tsx: Location": "finder.location",
  "components/home/Finder.tsx: More cities": "finder.more_cities",
  "components/home/Finder.tsx: Occasion": "finder.occasion",
  "components/home/Finder.tsx: SHOW RESTAURANTS": "finder.submit",
  "components/home/RestaurantCard.tsx: Reserve a table": "restaurants.card_reserve",
  "components/home/RestaurantCard.tsx: View restaurant": "restaurants.card_view",
  "components/home/Restaurants.tsx: , remove filter": "restaurants.remove_filter_sr",
  "components/home/Restaurants.tsx: CLEAR ALL": "restaurants.clear_all",
  "components/home/Restaurants.tsx: No matches": "restaurants.no_matches",
  "components/home/Restaurants.tsx: No restaurants match these filters": "restaurants.empty_title",
  "components/home/Restaurants.tsx: Our Restaurants": "restaurants.title",
  "components/home/Restaurants.tsx: SHOW ALL RESTAURANTS": "restaurants.show_all",
  "components/home/Restaurants.tsx: Showing": "restaurants.showing ('Showing {shown} of {total} restaurants')",
  "components/home/Restaurants.tsx: Try another cuisine, occasion or destination.": "restaurants.empty_lede",
  "components/home/Restaurants.tsx: VIEW ALL RESTAURANTS →": "restaurants.view_all",
  "components/home/Restaurants.tsx: of": "restaurants.showing",
  "components/home/Restaurants.tsx: restaurants": "restaurants.showing",
  "components/overlays/FinderSheet.tsx: Close": "common.close",
  "components/overlays/FinderSheet.tsx: Cuisine": "finder.cuisine",
  "components/overlays/FinderSheet.tsx: Destination": "finder.destination",
  "components/overlays/FinderSheet.tsx: Find a restaurant": "finder.title",
  "components/overlays/FinderSheet.tsx: Occasion": "finder.occasion",
  "components/overlays/FinderSheet.tsx: SHOW RESTAURANTS": "finder.submit",
  "components/overlays/MenuOverlay.tsx: Close menu": "ui.close_menu",
  "components/overlays/MenuOverlay.tsx: EN": "phase 8: locales.short_label (language switcher)",
  "components/overlays/MenuOverlay.tsx: Menu": "ui.menu_aria",
  "components/overlays/MenuOverlay.tsx: PEOPLE | CULTURE | GREAT FOOD": "footer.tagline",
  "components/overlays/MenuOverlay.tsx: RESERVE A TABLE": "ui.reserve_table",
  "components/overlays/MenuOverlay.tsx: Search": "ui.search_link",
  "components/overlays/MenuOverlay.tsx: Sections": "ui.sections_aria",
  "components/overlays/MenuOverlay.tsx: VI": "phase 8: locales.short_label",
  "components/overlays/ReserveDrawer.tsx: Close": "common.close",
  "components/overlays/ReserveDrawer.tsx: DATE": "booking.section_date",
  "components/overlays/ReserveDrawer.tsx: DONE": "booking.done",
  "components/overlays/ReserveDrawer.tsx: Date": "booking.label_date",
  "components/overlays/ReserveDrawer.tsx: Destination": "booking.label_destination",
  "components/overlays/ReserveDrawer.tsx: Email": "form.email",
  "components/overlays/ReserveDrawer.tsx: Fewer guests": "booking.fewer_guests",
  "components/overlays/ReserveDrawer.tsx: Full name *": "form.name",
  "components/overlays/ReserveDrawer.tsx: GUESTS": "booking.section_guests",
  "components/overlays/ReserveDrawer.tsx: Guests": "booking.label_guests",
  "components/overlays/ReserveDrawer.tsx: More guests": "booking.more_guests",
  "components/overlays/ReserveDrawer.tsx: Nguyễn Minh Anh": "form.ph_name",
  "components/overlays/ReserveDrawer.tsx: Occasion, dietary needs, seating preference": "form.ph_note",
  "components/overlays/ReserveDrawer.tsx: Phone *": "form.phone",
  "components/overlays/ReserveDrawer.tsx: Please check your email address.": "error.invalid_email (exists)",
  "components/overlays/ReserveDrawer.tsx: Please enter a valid phone number.": "error.invalid_phone (exists)",
  "components/overlays/ReserveDrawer.tsx: Please enter your name.": "error.invalid_name (exists)",
  "components/overlays/ReserveDrawer.tsx: REQUEST BOOKING": "booking.submit",
  "components/overlays/ReserveDrawer.tsx: RESERVE A TABLE": "ui.reserve_table",
  "components/overlays/ReserveDrawer.tsx: Reference": "booking.label_reference",
  "components/overlays/ReserveDrawer.tsx: Reserve a table": "booking.drawer_aria",
  "components/overlays/ReserveDrawer.tsx: Restaurant": "booking.label_restaurant",
  "components/overlays/ReserveDrawer.tsx: SENDING…": "booking.sending",
  "components/overlays/ReserveDrawer.tsx: Special requests": "form.note",
  "components/overlays/ReserveDrawer.tsx: TIME": "booking.section_time",
  "components/overlays/ReserveDrawer.tsx: Thank you,": "booking.thanks ('Thank you, {name}.')",
  "components/overlays/ReserveDrawer.tsx: Time": "booking.label_time",
  "components/overlays/ReserveDrawer.tsx: Today": "common.today",
  "components/overlays/ReserveDrawer.tsx: YOUR DETAILS": "booking.your_details",
  "components/overlays/ReserveDrawer.tsx: YOUR TABLE": "booking.your_table",
  "components/overlays/ReserveDrawer.tsx: covers left": "booking.slot_left_aria ('{time} — {count} covers left')",
  "components/overlays/ReserveDrawer.tsx: you": "booking.thanks_anon",
  "components/overlays/ReserveDrawer.tsx: you@example.com": "form.ph_email",
  "components/overlays/ReserveDrawer.tsx: — fully booked": "booking.slot_full_aria ('{time} — fully booked')",
  "components/site/Footer.tsx: A MEMBER OF FURAMA": "footer.member",
  "components/site/Footer.tsx: FACEBOOK": "social.facebook (L7-15)",
  "components/site/Footer.tsx: INSTAGRAM": "social.instagram",
  "components/site/Footer.tsx: KAKAOTALK": "social.kakao",
  "components/site/Footer.tsx: LINE": "social.line",
  "components/site/Footer.tsx: PEOPLE | CULTURE | GREAT FOOD": "footer.tagline",
  "components/site/Footer.tsx: TIKTOK": "social.tiktok",
  "components/site/Footer.tsx: TRIPADVISOR": "social.tripadvisor",
  "components/site/Footer.tsx: WECHAT": "social.wechat",
  "components/site/Footer.tsx: YOUTUBE": "social.youtube",
  "components/site/Footer.tsx: ZALO": "social.zalo",
  "components/site/Header.tsx: EN": "phase 8: locales.short_label",
  "components/site/Header.tsx: English": "phase 8: locales.native_name",
  "components/site/Header.tsx: Language": "ui.language_aria",
  "components/site/Header.tsx: Main": "ui.nav_aria",
  "components/site/Header.tsx: Open menu": "ui.open_menu",
  "components/site/Header.tsx: RESERVE": "ui.reserve",
  "components/site/Header.tsx: SEARCH": "ui.search",
  "components/site/Header.tsx: Tiếng Việt": "phase 8: locales.native_name",
  "components/site/Header.tsx: VI": "phase 8: locales.short_label",
  "components/site/MobileBar.tsx: CALL": "detail.call",
  "components/site/MobileBar.tsx: EXPLORE": "ui.tab_explore",
  "components/site/MobileBar.tsx: MAP": "detail.map",
  "components/site/MobileBar.tsx: MENU": "detail.menu",
  "components/site/MobileBar.tsx: RESERVE": "ui.reserve",
  "components/site/MobileBar.tsx: RESTAURANTS": "ui.tab_restaurants",
  "components/site/MobileBar.tsx: Restaurant actions": "detail.actions_aria",
  "components/site/MobileBar.tsx: Sections": "ui.sections_aria",
  "components/site/SiteProvider.tsx: Da Nang": "finder.city (the finder's default location)",
  "components/site/SiteProvider.tsx: EN": "phase 8: locales.short_label",
  "lib/booking-errors.ts: The restaurant": "error.restaurant_fallback (the {restaurant} of error.slot_unavailable before the catalogue loads)",
  "lib/booking.ts: guest": "booking.guests_count ('{count, plural, one {# guest} other {# guests}}')",
  "lib/booking.ts: guests": "booking.guests_count",
};

const findings = scanGuestText();

describe('guest-visible text lives in the registry or the database (spec §13)', () => {
  it('finds no literal words outside LOCKED and PENDING', () => {
    const unlisted = findings.filter((f) => !(findingId(f) in LOCKED) && !(findingId(f) in PENDING));
    expect(unlisted.map((f) => `${f.file}:${f.line} ${f.kind}${f.attr ? `[${f.attr}]` : ''} ${JSON.stringify(f.text)}`)).toEqual([]);
  });

  it('lists nothing that is gone: a moved string leaves PENDING in the same change', () => {
    const found = new Set(findings.map(findingId));
    expect([...Object.keys(LOCKED), ...Object.keys(PENDING)].filter((id) => !found.has(id))).toEqual([]);
  });

  it('PENDING only shrinks during phase 7 (the number in the plan’s task table)', () => {
    // 161 found by the phase-7 spike, less the six offers.* literals moved in plan 7A task A3 and the
    // thirteen hero.* and film.* ones moved in A9.
    expect(Object.keys(PENDING).length).toBeLessThanOrEqual(142);
  });
});

describe('the scanner', () => {
  it('reads prose, capitalised and all-capitals words as text; code-like tokens as code', () => {
    for (const t of ['Explore by Cuisine', 'Today', 'RESULTS', 'Showing ', 'Thank you,']) expect(looksLikeProse(t), t).toBe(true);
    for (const t of ['all', 'resort', 'home', '→', ' · ', '#restaurants', 'search-label', '12px']) expect(looksLikeProse(t), t).toBe(false);
  });
  it('reads a word between template slots as text, a word glued to code as code', () => {
    for (const t of [' restaurants →', ' left', ' of ']) expect(templateHasWord(t), t).toBe(true);
    for (const t of ['px', 'tel:', 'error.', '/api/availability?restaurant=']) expect(templateHasWord(t), t).toBe(false);
  });
});
