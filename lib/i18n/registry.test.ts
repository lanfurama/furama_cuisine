import { describe, expect, it } from 'vitest';
import { formatMessage, usesIcuSyntax } from './format';
import { checkMessage } from './icu';
import { ADMIN_SCREENS, CLIENT_KEYS, HOME_KEYS, KEY_PATTERN, REGISTRY, STRING_KEYS, keysForScreen, sectionKeys, type StringDef } from './registry';
import { resolveStrings } from './resolve';

describe('registry', () => {
  it.each(STRING_KEYS)('%s is well formed', (key) => {
    const def: StringDef = REGISTRY[key];
    expect(key).toMatch(KEY_PATTERN);
    expect(def.en.length).toBeGreaterThan(0);
    expect(def.en.length).toBeLessThanOrEqual(def.maxLength);
    if (def.vi) expect(def.vi.length).toBeLessThanOrEqual(def.maxLength);
    expect(def.context.length).toBeGreaterThan(10);
    expect(ADMIN_SCREENS).toContain(def.screen);
    // Valid ICU, and the declared variables are exactly the ones used, in every language (spec §7.4).
    for (const text of [def.en, def.vi].filter((t): t is string => !!t)) {
      expect(checkMessage(text, def.vars ?? [])).toEqual([]);
    }
  });

  it('error.outside_window names no fixed span: each restaurant sets its own window, 1–90 days', () => {
    expect(REGISTRY['error.outside_window'].en).not.toMatch(/week|fortnight|\d+ days/i);
  });

  it('sends the privacy notice, the consent label and the policy link to the browser (the drawer and the footer read them)', () => {
    expect(CLIENT_KEYS).toEqual(expect.arrayContaining(['booking.privacy_notice', 'booking.consent', 'legal.link']));
  });

  it('sends "Gọi để đặt bàn" to the browser: the drawer’s all-offline message and the call labels of cards and search (R20)', () => {
    expect(CLIENT_KEYS).toEqual(expect.arrayContaining(['booking.all_offline', 'booking.call_tag', 'booking.call_action']));
    expect(REGISTRY['booking.all_offline'].vars).toEqual(['phone']);
    expect(REGISTRY['booking.call_tag'].vars).toEqual(['phone']);
  });
});

describe('key delivery', () => {
  it('names a section’s own keys by prefix, and every screen in the list edits at least one key or is a list screen', () => {
    expect(sectionKeys('stories')).toEqual(['stories.title', 'stories.lede']);
    expect(HOME_KEYS).toEqual(expect.arrayContaining(['stories.title', 'heritage.cta']));
    expect(keysForScreen('heritage')).toEqual(['heritage.kicker', 'heritage.title_1', 'heritage.title_2', 'heritage.cta']);
  });
  it('sends search, meal and finder copy to the browser, and keeps page copy, SEO, policy and email copy on the server', () => {
    expect(CLIENT_KEYS).toEqual(expect.arrayContaining(['search.results', 'meal.dinner', 'finder.any_occasion', 'form.ph_note', 'common.close', 'booking.submit']));
    expect(CLIENT_KEYS.filter((k) => /^(stories|heritage|seo|email)\./.test(k) || (k.startsWith('legal.') && k !== 'legal.link'))).toEqual([]);
  });
});

describe('formatMessage', () => {
  it('formats ICU plurals with the language’s plural rules', () => {
    const t = REGISTRY['search.results'].en;
    expect(formatMessage(t, { count: 1 })).toBe('1 RESULT');
    expect(formatMessage(t, { count: 12 })).toBe('12 RESULTS');
    expect(formatMessage(t, { count: 0 })).toBe('0 RESULTS');
  });
  it('words the party size, the covers left and the slot names as the booking bar and the form did before plan 7B B6', () => {
    const guests = REGISTRY['booking.guests_count'].en;
    expect([1, 2, 12].map((count) => formatMessage(guests, { count }, 'en'))).toEqual(['1 guest', '2 guests', '12 guests']);
    expect(formatMessage(REGISTRY['booking.slot_left'].en, { count: 4 })).toBe('4 left');
    expect(formatMessage(REGISTRY['booking.slot_full_aria'].en, { time: '19:00' })).toBe('19:00 — fully booked');
    expect(formatMessage(REGISTRY['booking.slot_left_aria'].en, { time: '19:00', count: 16 })).toBe('19:00 — 16 covers left');
    expect(formatMessage(REGISTRY['booking.thanks'].en, { name: REGISTRY['booking.thanks_anon'].en })).toBe('Thank you, you.');
  });
  it('keeps the plain path for plain templates: an ASCII apostrophe stays and an unknown var stays visible', () => {
    expect(formatMessage("It's {name}'s table, {other}", { name: 'An' })).toBe("It's An's table, {other}");
    expect(usesIcuSyntax("It's {name}")).toBe(false);
  });
  it('fills known variables and leaves unknown ones visible', () => {
    expect(formatMessage('{a} and {b}', { a: 'x' })).toBe('x and {b}');
    expect(formatMessage('{n} guests', { n: 4 })).toBe('4 guests');
  });
  it('flags ICU plural syntax', () => {
    expect(usesIcuSyntax('{n, plural, one {# guest} other {# guests}}')).toBe(true);
  });
});

describe('resolveStrings', () => {
  const keys = ['error.full', 'error.past'] as const;
  it('uses the default-language row, else the registry', () => {
    const out = resolveStrings([{ key: 'error.full', locale: 'en', value: 'Sold out.' }], keys, 'en', 'en');
    expect(out['error.full']).toBe('Sold out.');
    expect(out['error.past']).toContain('can no longer be booked online');
  });
  it('falls back per key: a missing vi row shows the English row, not an empty string', () => {
    const rows = [
      { key: 'error.full', locale: 'en', value: 'Sold out.' },
      { key: 'error.past', locale: 'vi', value: 'Đã qua giờ.' },
    ];
    const out = resolveStrings(rows, keys, 'vi', 'en');
    expect(out).toEqual({ 'error.full': 'Sold out.', 'error.past': 'Đã qua giờ.' });
  });
});
