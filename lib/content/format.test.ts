import { describe, expect, it } from 'vitest';
import { formatPrice, formatStoryDate, offerDetail, storyKicker } from './format';

/*
 * The server-side recipes that keep the guest pages pixel-identical (spec
 * §14.1 row 6). CI runs this file on Node 24 (Vercel's runtime), the visual
 * baselines only run locally on Node 22: a different ICU there fails here.
 */

describe('story kicker', () => {
  it('writes English dates day first with a three-letter month, as the site did ("9 Sep 2026", not en-GB’s "Sept")', () => {
    expect(formatStoryDate('2026-09-09', 'en')).toBe('9 Sep 2026');
    expect(formatStoryDate('2026-12-31', 'en')).toBe('31 Dec 2026');
    expect(storyKicker('Restaurant News', '2026-09-05', 'en')).toBe('Restaurant News · 5 Sep 2026');
  });

  it('is the category alone for a story without a date', () => {
    expect(storyKicker('Furama Resort Danang', null, 'en')).toBe('Furama Resort Danang');
  });

  it('cannot move the date with the server’s zone (a calendar date, formatted in UTC)', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'Pacific/Kiritimati';
    try {
      expect(formatStoryDate('2026-09-03', 'en')).toBe('3 Sep 2026');
    } finally {
      process.env.TZ = tz;
    }
  });
});

describe('offer price and detail line', () => {
  it('reads as the three seeded offers did, with a plain space after the currency (no U+00A0)', () => {
    expect(offerDetail(formatPrice({ amount: '888000.00', currency: 'VND', basis: 'plus_plus' }, 'en'), 'Nightly 18:30–22:00')).toBe(
      'VND 888,000++ per guest · Nightly 18:30–22:00',
    );
    expect(offerDetail(formatPrice({ amount: 799000, currency: 'VND', basis: 'plus_plus' }, 'en'), 'Daily 11:00 or 14:00')).toBe(
      'VND 799,000++ per guest · Daily 11:00 or 14:00',
    );
    expect(offerDetail(formatPrice({ amount: '450000.00', currency: 'VND', basis: 'net' }, 'en'), '~30 pastries, 12+ teas')).toBe(
      'VND 450,000 net per guest · ~30 pastries, 12+ teas',
    );
    expect(formatPrice({ amount: '888000', currency: 'VND', basis: 'plus_plus' }, 'en')).not.toContain(' ');
  });

  it('keeps the cents of a price that has them', () => {
    expect(formatPrice({ amount: '42.50', currency: 'USD', basis: 'net' }, 'en')).toBe('USD 42.5 net per guest');
  });

  it('lets a price or a schedule stand alone', () => {
    expect(offerDetail(null, 'Every Friday')).toBe('Every Friday');
    expect(offerDetail(formatPrice({ amount: '120', currency: 'USD', basis: 'net' }, 'en'), null)).toBe('USD 120 net per guest');
    expect(offerDetail(null, null)).toBe('');
  });
});

describe('a language code Intl refuses', () => {
  it('reads as English instead of throwing: /favicon.ico reaches the loaders with "favicon.ico" as its language', () => {
    expect(() => new Intl.DateTimeFormat('favicon.ico')).toThrow(RangeError);
    expect(formatStoryDate('2026-09-09', 'favicon.ico')).toBe('9 Sep 2026');
    expect(storyKicker('Restaurant News', '2026-09-05', 'wp-login.php')).toBe('Restaurant News · 5 Sep 2026');
    expect(formatPrice({ amount: '888000.00', currency: 'VND', basis: 'plus_plus' }, 'apple-touch-icon.png')).toBe('VND 888,000++ per guest');
  });
});
