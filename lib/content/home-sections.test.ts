import { describe, expect, it } from 'vitest';
import { homeSections, markHero, navFor } from './home-sections';
import { SECTION_KEYS, type NavItem, type SectionKey, type Sections } from './types';

/** Every section on, except those named. */
function sections(...off: SectionKey[]): Sections {
  return Object.fromEntries(SECTION_KEYS.map((key) => [key, { visible: !off.includes(key), image: null, link: null }])) as Sections;
}

const one = [{}];

describe('home sections (sections.is_visible, spec §6.5)', () => {
  it('leaves out a section staff switched off, and keeps the others', () => {
    const shown = homeSections(sections('stories', 'heritage'), { hero: one, experiences: one, stories: one, offers: one });
    expect([...shown]).toEqual(SECTION_KEYS.filter((key) => key !== 'stories' && key !== 'heritage'));
  });

  it('leaves out a list with nothing to show: no offer today, no slide', () => {
    const shown = homeSections(sections(), { hero: [], experiences: one, stories: one, offers: [] });
    expect(shown.has('offers')).toBe(false);
    expect(shown.has('hero')).toBe(false);
    expect(shown.has('experiences')).toBe(true);
    expect(shown.has('stories')).toBe(true);
  });

  it('always keeps the restaurants, whatever the row says', () => {
    expect(homeSections(sections('restaurants')).has('restaurants')).toBe(true);
  });

  it('answers the chrome too: film off hides WATCH THE FILM, finder off FIND A RESTAURANT, booking_bar off the bar', () => {
    const shown = homeSections(sections('film', 'finder', 'booking_bar'));
    expect((['film', 'finder', 'booking_bar'] as const).filter((key) => shown.has(key))).toEqual([]);
    expect(homeSections(sections()).has('film')).toBe(true);
  });
});

describe('a home page without its hero (the F4 marks)', () => {
  it('loses its hero when staff switch it off or no slide has a picture to show, and <html> is then marked', () => {
    // Off by the flag, or no slide left: loadHeroSlides drops a slide whose picture was soft-deleted.
    for (const shown of [homeSections(sections('hero'), { hero: one }), homeSections(sections(), { hero: [] })]) {
      expect(shown.has('hero')).toBe(false);
      const html: Record<string, string | undefined> = { view: 'home' };
      markHero(html, { view: 'home', hero: shown.has('hero') });
      expect(html).toEqual({ view: 'home', hero: 'none' });
    }
    expect(homeSections(sections(), { hero: one }).has('hero')).toBe(true);
  });

  it('a home page with its hero, a restaurant page and any other page each take the mark off', () => {
    const pages = [
      { view: 'home', hero: true },
      { view: 'detail', hero: true },
      { view: 'other', hero: true },
      // Only a home page has a hero to lose.
      { view: 'detail', hero: false },
      { view: 'other', hero: false },
    ];
    for (const page of pages) {
      const html: Record<string, string | undefined> = { view: page.view, hero: 'none' };
      markHero(html, page);
      expect(html).toEqual({ view: page.view });
    }
    const html: Record<string, string | undefined> = {};
    markHero(html, { view: 'home', hero: true });
    expect(html).toEqual({});
  });
});

describe('the nav follows the home page (spec §6.5: an item hides itself when its section is hidden)', () => {
  const item = (target: SectionKey): NavItem => ({ target, label: target });
  // The seeded six, and one to the cuisines (the database allows it).
  const NAV = (['restaurants', 'destinations', 'experiences', 'offers', 'stories', 'heritage', 'cuisines'] as const).map(item);
  const full = { hero: one, experiences: one, stories: one, offers: one, cuisines: one, destinations: one };
  const targets = (nav: NavItem[]) => nav.map((n) => n.target);

  it('keeps every item while every section has something to show', () => {
    expect(navFor(NAV, homeSections(sections(), full))).toEqual(NAV);
  });

  it('drops the item of a list with nothing to show: no offer today, no experience, no story', () => {
    for (const empty of ['offers', 'experiences', 'stories'] as const) {
      const nav = navFor(NAV, homeSections(sections(), { ...full, [empty]: [] }));
      expect(targets(nav)).toEqual(targets(NAV).filter((t) => t !== empty));
    }
  });

  it('drops the item of a section staff switched off', () => {
    expect(targets(navFor(NAV, homeSections(sections('heritage', 'offers'), full)))).toEqual([
      'restaurants',
      'destinations',
      'experiences',
      'stories',
      'cuisines',
    ]);
  });

  it('an empty cuisines or destinations list hides its section, and the item to it', () => {
    const shown = homeSections(sections(), { ...full, cuisines: [], destinations: [] });
    expect(shown.has('cuisines')).toBe(false);
    expect(shown.has('destinations')).toBe(false);
    expect(targets(navFor(NAV, shown))).toEqual(['restaurants', 'experiences', 'offers', 'stories', 'heritage']);
  });

  it('always keeps the restaurants', () => {
    const empty = { hero: [], experiences: [], stories: [], offers: [], cuisines: [], destinations: [] };
    expect(targets(navFor(NAV, homeSections(sections(...SECTION_KEYS), empty)))).toEqual(['restaurants']);
  });

  it('keeps the nav’s own order (sort_order), not the page’s', () => {
    const reversed = [...NAV].reverse();
    expect(navFor(reversed, homeSections(sections(), { ...full, offers: [] }))).toEqual(reversed.filter((n) => n.target !== 'offers'));
  });
});
