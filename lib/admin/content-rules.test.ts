import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SECTION_KEYS } from '@/lib/content/types';
import {
  charCount,
  checkLength,
  detailPageErrors,
  detailPageWarnings,
  followRename,
  LIMITS,
  limitError,
  LENGTHS,
  limitWarnings,
  NAV_LABEL_WARNING,
  NAV_TARGETS,
  offerPageTitle,
  sectionErrors,
} from './content-rules';

describe('content rules (spec §6.5)', () => {
  it('counts characters as Postgres char_length does, not UTF-16 units', () => {
    expect(charCount('Tàya')).toBe(4);
    expect(charCount('🍜🍜')).toBe(2);
  });

  it('a nav label: up to 14 is fine, 15–18 warns, 19 is refused', () => {
    expect(checkLength('A'.repeat(14), 18, 14)).toEqual({ level: 'ok', count: 14 });
    expect(checkLength('A'.repeat(15), 18, 14)).toEqual({ level: 'warn', count: 15 });
    expect(checkLength('A'.repeat(18), 18, 14).level).toBe('warn');
    expect(checkLength('A'.repeat(19), 18, 14)).toEqual({ level: 'error', count: 19 });
  });

  it("the nav label's warning names the length it warns past, so it cannot go stale", () => {
    expect(NAV_LABEL_WARNING).toContain(`Dài hơn ${String(LENGTHS.navLabel.warn)} ký tự`);
  });

  it('holds the layout limits of spec §6.5', () => {
    expect(LIMITS).toMatchObject({
      heroSlides: { min: 1, max: 5 },
      destinations: { min: 2, max: 5 },
      stories: { max: 4 },
      offers: { max: 6, multipleOf: 3 },
      experiences: { min: 1, max: 5 },
      cuisines: { max: 10 },
      highlights: { max: 5, warnBelow: 2 },
      navItems: { max: 6 },
      socials: { max: 6 },
    });
  });

  it('refuses only above the maximum of shown items', () => {
    expect(limitError('offers', 6)).toBeNull();
    expect(limitError('offers', 7)).toMatch(/Tối đa 6/);
    expect(limitError('highlights', 5)).toBeNull();
    expect(limitError('highlights', 6)).toMatch(/Tối đa 5/);
    expect(limitError('heroSlides', 6)).toMatch(/Tối đa 5/);
    expect(limitError('navItems', 7)).toMatch(/Tối đa 6/);
  });

  it('warns about a count that is allowed but off the layout', () => {
    expect(limitWarnings('offers', 3)).toEqual([]);
    expect(limitWarnings('offers', 4)[0]).toMatch(/bội số của 3/);
    expect(limitWarnings('offers', 0)).toEqual([expect.stringMatching(/ẩn section Offers/)]);
    expect(limitWarnings('highlights', 1)).toEqual([expect.stringMatching(/ít nhất 2/)]);
    expect(limitWarnings('experiences', 0)[0]).toMatch(/ít nhất 1/);
    // Ten cuisines is advice (spec §6.5 "nên"): more only warns.
    expect(limitWarnings('cuisines', 10)).toEqual([]);
    expect(limitWarnings('cuisines', 11)).toEqual(['Đang hiện 11 ẩm thực; thanh ẩm thực đẹp nhất khi không quá 10.']);
  });

  it('a section: restaurants never hides; the film plays a YouTube or Vimeo video only; other links are https (code rule 5)', () => {
    expect(sectionErrors('restaurants', { visible: false, link: null })).toEqual({ isVisible: [expect.stringMatching(/luôn hiện/)] });
    expect(sectionErrors('restaurants', { visible: true, link: null })).toEqual({});
    expect(sectionErrors('hero', { visible: false, link: null })).toEqual({});
    expect(sectionErrors('film', { visible: true, link: 'https://youtu.be/dQw4w9WgXcQ' })).toEqual({});
    expect(sectionErrors('film', { visible: true, link: 'https://vimeo.com/76979871' })).toEqual({});
    // 008's CHECK accepts any youtube.com link; a channel page names no video.
    expect(sectionErrors('film', { visible: true, link: 'https://www.youtube.com/@furama' })).toEqual({ link: [expect.stringMatching(/YouTube hoặc Vimeo/)] });
    expect(sectionErrors('film', { visible: true, link: 'https://example.com/video.mp4' }).link).toHaveLength(1);
    expect(sectionErrors('heritage', { visible: true, link: 'https://furamavietnam.com/the-resort/' })).toEqual({});
    expect(sectionErrors('heritage', { visible: true, link: 'http://furamavietnam.com/' })).toEqual({ link: ['Đường dẫn phải bắt đầu bằng https://'] });
  });

  it('a detail page needs its portrait and an EN story', () => {
    expect(detailPageErrors({ hasDetailPage: false, detailImageId: null, storyEn: null })).toEqual({});
    expect(detailPageErrors({ hasDetailPage: true, detailImageId: null, storyEn: '  ' })).toEqual({
      detailImageId: [expect.any(String)],
      story: [expect.any(String)],
    });
    expect(detailPageErrors({ hasDetailPage: true, detailImageId: 'm', storyEn: 'Story' })).toEqual({});
  });

  it('warns about a page with few highlights, hidden buttons or a long name', () => {
    const base = { hasDetailPage: true, name: 'Tàya House', shownHighlights: 4, hasPhone: true, hasMap: true, hasMenu: true };
    expect(detailPageWarnings(base)).toEqual([]);
    expect(detailPageWarnings({ ...base, hasDetailPage: false, shownHighlights: 0 })).toEqual([]);
    expect(detailPageWarnings({ ...base, shownHighlights: 1 })[0]).toMatch(/1 điểm nổi bật/);
    expect(detailPageWarnings({ ...base, hasMap: false, hasMenu: false })[0]).toMatch(/MAP, MENU/);
    expect(detailPageWarnings({ ...base, name: 'A very long restaurant name indeed' })[0]).toMatch(/24/);
  });

  it('R19: the card alt follows a rename only while it still equals the old name', () => {
    expect(followRename('Tàya House', 'Tàya House', 'Tàya Garden House')).toBe('Tàya Garden House');
    expect(followRename('A garden house among palms', 'Tàya House', 'Tàya Garden House')).toBeNull();
    expect(followRename('Tàya House', 'Tàya House', 'Tàya House')).toBeNull();
    expect(followRename(null, 'Tàya House', 'Other')).toBeNull();
  });
});

describe('an offer page’s heading', () => {
  it('names a live offer by its EN title, an untitled one by its id as the list does, and a gone one as deleted', () => {
    expect(offerPageTitle('2', { values: { title: { en: 'Vietnamese Cooking Class' } } })).toBe('Vietnamese Cooking Class');
    expect(offerPageTitle('7', { values: { title: { en: null } } })).toBe('Ưu đãi 7');
    expect(offerPageTitle('7', { values: { title: { en: '' } } })).toBe('Ưu đãi 7');
    expect(offerPageTitle('7', null)).toBe('Ưu đãi đã xóa');
  });
});

describe('the navigation menu (spec §6.5, plan 7B B4)', () => {
  it('the menu scrolls to every home section but those migration 008 forbids (CHECK nav_items.target_section)', () => {
    const migration = readFileSync('db/migrations/008_content.sql', 'utf8');
    const forbidden = /CHECK \(target_section NOT IN \(([^)]*)\)\)/.exec(migration)?.[1] ?? '';
    const refused = [...forbidden.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(refused).toEqual(['film', 'finder', 'hero', 'booking_bar']);
    expect([...NAV_TARGETS]).toEqual(SECTION_KEYS.filter((k) => !refused.includes(k)));
  });
});
