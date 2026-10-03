import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RESTAURANT_SLUG, isRestaurantSlug } from './slug';

/*
 * The restaurant page answers a slug no restaurant can have with a 404 before
 * it reads anything: a NUL byte made Postgres raise an encoding error on every
 * hit, and any other junk slug cost a query. The cases a browser test must not
 * request live here: on a case-insensitive disk the cached 404 of an
 * upper-case slug overwrites taya-house.html, and a long one overflows the
 * file name.
 */

describe('isRestaurantSlug', () => {
  it('accepts the slugs restaurants have, up to 60 characters', () => {
    expect(isRestaurantSlug('taya-house')).toBe(true);
    expect(isRestaurantSlug('the-fan')).toBe(true);
    expect(isRestaurantSlug('a'.repeat(60))).toBe(true);
  });

  it('refuses what no restaurant can have, so the page answers 404 without a read', () => {
    const refused = ['', 'TAYA-HOUSE', 'taya_house', '-x', 'x-', 'taya--house', 'taya-house\u0000', 'taya-house\n', 'a'.repeat(61), '_none'];
    expect(refused.filter((slug) => isRestaurantSlug(slug))).toEqual([]);
  });
});

describe('the slug rule is the database’s', () => {
  it('uses the pattern and the length limit of the restaurants.slug CHECK in migration 008', () => {
    const sql = readFileSync(join(process.cwd(), 'db/migrations/008_content.sql'), 'utf8');
    const check = sql.match(/slug ~ '([^']+)' AND length\(slug\) <= (\d+)/);
    expect(check, 'the slug CHECK of restaurants').not.toBeNull();
    expect(RESTAURANT_SLUG.pattern.source).toBe(check![1]);
    expect(RESTAURANT_SLUG.pattern.flags).toBe('');
    expect(RESTAURANT_SLUG.maxLength).toBe(Number(check![2]));
  });
});
