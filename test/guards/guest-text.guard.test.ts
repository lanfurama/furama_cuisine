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
  "app/(site)/[lang]/layout.tsx: Furama Cuisine": "the title of the pages that render without the database (R8); every page with one names itself from seo.* ((guarded)/layout.tsx)",
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
  "components/overlays/MenuOverlay.tsx: EN": "phase 8: locales.short_label (language switcher)",
  "components/overlays/MenuOverlay.tsx: VI": "phase 8: locales.short_label",
  "components/site/Header.tsx: EN": "phase 8: locales.short_label",
  "components/site/Header.tsx: English": "phase 8: locales.native_name",
  "components/site/Header.tsx: Tiếng Việt": "phase 8: locales.native_name",
  "components/site/Header.tsx: VI": "phase 8: locales.short_label",
  "components/site/SiteProvider.tsx: EN": "phase 8: locales.short_label",
  "lib/booking-errors.ts: The restaurant": "error.restaurant_fallback (the {restaurant} of error.slot_unavailable before the catalogue loads)",
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
    // 161 found by the phase-7 spike, less the six offers.* literals moved in plan 7A task A3, the
    // thirteen hero.* and film.* ones moved in A9, the thirteen detail.* ones moved in A10, the
    // thirteen restaurants.* ones moved in A11, the four of the destinations section moved in plan
    // 7B task B1, the two of the cuisines section moved in B2, the three of the experiences section
    // moved in B3, the eighteen of the header, the phone menu and tab bar, the restaurant page's
    // and the reservation form's RESERVE A TABLE and the 404 page moved in B4, the twelve of the
    // footer and the phone menu's tagline moved in B5, the sixty-two of the booking bar, the
    // finder and the reservation form moved in B6 and the seven of the metadata moved in B7 (the
    // root layout's brand title is LOCKED). Plan 7B empties it.
    expect(Object.keys(PENDING).length).toBeLessThanOrEqual(8);
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
