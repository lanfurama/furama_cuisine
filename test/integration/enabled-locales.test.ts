import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import { enabledLocalesBestEffort, resetEnabledLocalesCache } from '@/lib/i18n/enabled-locales';
import { TEST_DATABASE_URL } from '../helpers/db';

/*
 * The proxy's read against the migrated schema: the phase-2 spike's version
 * named a column `enabled` that the table never had (it is `is_enabled`), and a
 * mock would not have noticed. TEST_DATABASE_URL becomes DATABASE_URL in
 * test/setup-env.ts, so getPool() is the test database.
 */
describe.skipIf(!TEST_DATABASE_URL)('enabledLocalesBestEffort (database)', () => {
  const sql = (text: string) => getPool().query(text);
  beforeEach(() => resetEnabledLocalesCache());
  afterAll(() => sql(`UPDATE locales SET is_enabled = false WHERE code = 'vi'`));

  it('reads en alone from the seed, then en and vi once vi is on', async () => {
    expect(await enabledLocalesBestEffort()).toEqual(['en']);
    await sql(`UPDATE locales SET is_enabled = true WHERE code = 'vi'`);
    resetEnabledLocalesCache();
    expect(await enabledLocalesBestEffort()).toEqual(['en', 'vi']);
  });
});
