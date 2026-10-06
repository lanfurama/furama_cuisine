import { afterAll, describe, expect, it, vi } from 'vitest';
import { getPool } from '@/db/client';
import { TEST_DATABASE_URL } from '../helpers/db';

// Outside a Next build the cache calls are no-ops: the readers below query the test database each time.
vi.mock('next/cache', () => ({ cacheLife: () => {}, cacheTag: () => {} }));
vi.stubEnv('SITE_URL', 'https://dining.example');
const { default: sitemap } = await import('@/app/sitemap');
const { default: robots } = await import('@/app/robots');

/*
 * L8-7: sitemap.xml lists every guest page in every enabled language with its
 * hreflang alternates, and never a disabled one; robots.txt points at it.
 */
describe.skipIf(!TEST_DATABASE_URL)('sitemap.xml and robots.txt (database)', () => {
  const sql = (text: string) => getPool().query(text);
  afterAll(async () => {
    await sql(`UPDATE locales SET is_enabled = false WHERE code = 'vi'`);
    await sql(`DELETE FROM locales WHERE code = 'ko'`);
  });

  it('lists the home page, the policy and each restaurant page in each enabled language, with alternates', async () => {
    await sql(`UPDATE locales SET is_enabled = true WHERE code = 'vi'`);
    await sql(`INSERT INTO locales (code, bcp47, native_name, short_label, script, sort_order) VALUES ('ko', 'ko', '한국어', 'KO', 'hangul', 30)`);
    const entries = await sitemap();
    const urls = entries.map((e) => e.url);
    expect(urls).toContain('https://dining.example/en');
    expect(urls).toContain('https://dining.example/vi');
    expect(urls).toContain('https://dining.example/vi/privacy');
    expect(urls).toContain('https://dining.example/en/restaurants/taya-house');
    expect(urls.some((u) => u.includes('/ko'))).toBe(false);
    expect(entries.find((e) => e.url === 'https://dining.example/vi/restaurants/taya-house')?.alternates).toEqual({
      languages: { en: 'https://dining.example/en/restaurants/taya-house', vi: 'https://dining.example/vi/restaurants/taya-house' },
    });
    expect(urls.length % 2).toBe(0);
  });

  it('robots.txt keeps crawlers out of the admin and the API, and names the sitemap', () => {
    expect(robots()).toEqual({
      rules: { userAgent: '*', allow: '/', disallow: ['/admin', '/api'] },
      sitemap: 'https://dining.example/sitemap.xml',
    });
  });
});
