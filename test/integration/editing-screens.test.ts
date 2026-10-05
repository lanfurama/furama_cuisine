import { afterAll, describe, expect, it } from 'vitest';
import { getPool, query } from '@/db/client';
import { COLUMN_SCREENS } from '../../lib/admin/content-screens';
import { CONTENT_TABLES } from '../../lib/cache-plan';

/*
 * COLUMN_SCREENS (lib/admin/content-screens.ts) against the migrated schema:
 * every column of every content table is listed (an editing screen, or why
 * none), and the map lists no column that does not exist. A migration that
 * adds a guest-visible column fails here until its screen is named.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('every content column has an owner (spec §7.2 CI test)', () => {
  afterAll(() => getPool().end());

  it('COLUMN_SCREENS equals information_schema for the content tables', async () => {
    {
      const rows = await query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
        [CONTENT_TABLES],
      );
      const actual = rows.map((r) => `${r.table_name}.${r.column_name}`).sort();
      const mapped = Object.entries(COLUMN_SCREENS)
        .flatMap(([t, cols]) => Object.keys(cols).map((c) => `${t}.${c}`))
        .sort();
      expect({ unmapped: actual.filter((c) => !mapped.includes(c)), missing: mapped.filter((c) => !actual.includes(c)) }).toEqual({
        unmapped: [],
        missing: [],
      });
    }
  });
});
