import { describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, databaseUrl, migrate, resetDatabase, withClient } from '../helpers/db';

const url = databaseUrl('furama_cuisine_migrate_test');

const insertLegacy = (rows: [reference: string, phone: string][]) =>
  withClient(url, (c) =>
    c.query(
      `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone)
       SELECT r, 'taya-house', '2026-10-05', '19:00', 2, 'Guest', p
         FROM unnest($1::text[], $2::text[]) AS t(r, p)`,
      [rows.map((r) => r[0]), rows.map((r) => r[1])],
    ),
  );

describe.skipIf(!TEST_DATABASE_URL)('migration 003: normalised phones (database)', () => {
  it('backfills E.164 phones on existing bookings and keeps their references', async () => {
    resetDatabase(url, '002_seed_restaurants.sql');
    await insertLegacy([
      ['FC-12345', '0905 000 000'],
      ['FC-23456', '84 912 345 678'],
    ]);

    migrate(url);

    const { rows } = await withClient(url, (c) =>
      c.query('SELECT reference, phone, phone_e164 FROM reservations ORDER BY reference'),
    );
    expect(rows).toEqual([
      { reference: 'FC-12345', phone: '0905 000 000', phone_e164: '+84905000000' },
      { reference: 'FC-23456', phone: '84 912 345 678', phone_e164: '+84912345678' },
    ]);
  });

  it('stops, and changes nothing, when two active bookings share a phone once normalised', async () => {
    resetDatabase(url, '002_seed_restaurants.sql');
    await insertLegacy([
      ['FC-11111', '0905 000 000'],
      ['FC-22222', '+84 905 000 000'],
    ]);

    expect(() => migrate(url)).toThrow();

    const column = await withClient(url, (c) =>
      c.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'reservations' AND column_name = 'phone_e164'`,
      ),
    );
    expect(column.rowCount).toBe(0);
  });
});
