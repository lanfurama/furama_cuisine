import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, query } from '@/db/client';
import { resolveStrings } from '@/lib/i18n/resolve';
import { CLIENT_KEYS, REGISTRY } from '@/lib/i18n/registry';
import { loadStringRows } from '@/lib/server/content/strings.queries';

/** The read layer, uncached: loaders hit the database, resolveStrings picks the text. */
async function read(locale: string, keys = ['error.full', 'error.past', 'error.network'] as const) {
  const { defaultLocale, rows } = await loadStringRows(locale, keys);
  return resolveStrings(rows, keys, locale, defaultLocale);
}

const put = (key: string, locale: string, value: string, status = 'reviewed') =>
  query(
    `INSERT INTO content_strings (key, locale, value, status, origin) VALUES ($1, $2, $3, $4, 'human')`,
    [key, locale, value, status],
  );

describe.skipIf(!process.env.TEST_DATABASE_URL)('content strings read layer (database)', () => {
  beforeEach(async () => {
    await query('DELETE FROM content_strings');
  });
  afterAll(async () => {
    await query('DELETE FROM content_strings');
    await getPool().end();
  });

  it('returns the registry defaults while content_strings is empty', async () => {
    const out = await read('en');
    expect(out['error.full']).toBe(REGISTRY['error.full'].en);
    expect(out['error.network']).toBe(REGISTRY['error.network'].en);
  });

  it('serves an English override at once', async () => {
    await put('error.full', 'en', 'Sold out for that time.');
    expect((await read('en'))['error.full']).toBe('Sold out for that time.');
  });

  it('shows reviewed vi rows, falls back to English per key, and hides machine rows by default', async () => {
    await put('error.full', 'en', 'Sold out.');
    await put('error.past', 'vi', 'Đã qua giờ.');
    await put('error.network', 'vi', 'Bản dịch máy', 'machine');
    const out = await read('vi');
    expect(out['error.past']).toBe('Đã qua giờ.');
    expect(out['error.full']).toBe('Sold out.');
    expect(out['error.network']).toBe(REGISTRY['error.network'].en);
  });

  it('never shows a machine row', async () => {
    await put('error.network', 'vi', 'Bản dịch máy', 'machine');
    expect((await read('vi'))['error.network']).toBe(REGISTRY['error.network'].en);
  });

  it('asks for the client keys in one query and returns every one', async () => {
    const { rows } = await loadStringRows('en', CLIENT_KEYS);
    expect(rows).toEqual([]);
    expect(Object.keys(resolveStrings(rows, CLIENT_KEYS, 'en', 'en')).sort()).toEqual([...CLIENT_KEYS].sort());
  });

});
