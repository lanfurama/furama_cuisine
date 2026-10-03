import { describe, expect, it } from 'vitest';
import { homeSections } from './home-sections';
import { SECTION_KEYS, type SectionKey, type Sections } from './types';

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
