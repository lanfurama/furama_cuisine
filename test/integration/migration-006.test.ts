import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { fold } from '@/lib/booking';
import { TEST_DATABASE_URL, databaseUrl, migrate, resetDatabase, withClient } from '../helpers/db';

const url = databaseUrl('furama_cuisine_migrate006_test');
const sql = (text: string, values: unknown[] = []) => withClient(url, (c) => c.query(text, values));
const one = async (text: string, values: unknown[] = []) => (await sql(text, values)).rows[0];

/** A phase-1 booking, written the way the phase-1 action wrote it (no v2 columns). */
const legacy = (reference: string, restaurant: string, at: string, status: string, phone = '0905 000 000', e164 = '+84905000000') =>
  sql(
    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164, email, status)
     VALUES ($1, $2, '2026-10-05', $3, 2, 'Nguyễn Văn An', $4, $5, 'An@Example.com', $6)`,
    [reference, restaurant, at, phone, e164, status],
  );

/** A v2 booking with only the columns that have no default. */
const v2 = (over: Record<string, unknown> = {}) => {
  const row = {
    reference: `FC-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    restaurant_id: 'taya-house',
    reserved_on: '2026-10-06',
    reserved_at: '19:00',
    meal: 'Dinner',
    guests: 2,
    guest_name: 'Guest',
    phone: '0905 111 111',
    phone_e164: '+84905111111',
    source: 'web',
    ...over,
  };
  const cols = Object.keys(row);
  return sql(
    `INSERT INTO reservations (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id, version`,
    Object.values(row),
  );
};

/** Latin-1, Latin Extended-A, Ơơ/Ưư and the Vietnamese block: checked against fold() letter by letter. */
const BLOCKS: [number, number][] = [[0xc0, 0x17f], [0x1a0, 0x1a1], [0x1af, 0x1b0], [0x1ea0, 0x1ef9]];

/** Names a guest might type: Vietnamese, upper case, other Latin accents, and letters NFD leaves whole. */
const NAMES = ['Nguyễn Thị Ánh ĐỨC', 'Trần Văn Ơn', 'Lê Đức Ưng', 'PHẠM THỊ HỒNG NHUNG', 'José Muñoz', 'Zoë Brontë', 'Łukasz Dvořák', 'ØRSTED ÆSIR', 'plain ascii 42'];

describe.skipIf(!TEST_DATABASE_URL)('migration 006: booking v2 (database)', () => {
  describe('on a database that already has phase-1 bookings', () => {
    beforeAll(async () => {
      resetDatabase(url, '005_staff_auth_audit.sql');
      await legacy('FC-12345', 'taya-house', '19:00', 'confirmed');
      await legacy('FC-AAAAAAAA', 'cafe-indochine', '07:00', 'cancelled', '0905 000 001', '+84905000001');
      await legacy('FC-BBBBBBBB', 'hai-van-lounge', '18:00', 'requested', '+1 415 555 0100', '+14155550100');
      migrate(url);
    });

    it('keeps every row, its status and reference, and marks it legacy test data', async () => {
      const { rows } = await sql(
        `SELECT reference, status, meal, source, locale, is_test, version, updated_at = created_at AS same_time
           FROM reservations ORDER BY id`,
      );
      expect(rows).toEqual([
        { reference: 'FC-12345', status: 'confirmed', meal: 'Dinner', source: 'legacy', locale: 'en', is_test: true, version: 1, same_time: true },
        { reference: 'FC-AAAAAAAA', status: 'cancelled', meal: 'Breakfast', source: 'legacy', locale: 'en', is_test: true, version: 1, same_time: true },
        { reference: 'FC-BBBBBBBB', status: 'requested', meal: 'Drinks', source: 'legacy', locale: 'en', is_test: true, version: 1, same_time: true },
      ]);
    });

    it('writes search_text and one system created event for each old row', async () => {
      const { rows: text } = await sql(`SELECT reference, search_text FROM reservations ORDER BY id`);
      expect(text).toEqual([
        { reference: 'FC-12345', search_text: 'nguyen van an an@example.com fc-12345 84905000000 0905000000' },
        { reference: 'FC-AAAAAAAA', search_text: 'nguyen van an an@example.com fc-aaaaaaaa 84905000001 0905000001' },
        { reference: 'FC-BBBBBBBB', search_text: 'nguyen van an an@example.com fc-bbbbbbbb 14155550100' },
      ]);
      const { rows } = await sql(
        `SELECT r.reference, e.actor_kind, e.actor_label, e.type, e.to_status
           FROM reservation_events e JOIN reservations r ON r.id = e.reservation_id ORDER BY r.id`,
      );
      expect(rows).toEqual([
        { reference: 'FC-12345', actor_kind: 'system', actor_label: 'migration 006', type: 'created', to_status: 'confirmed' },
        { reference: 'FC-AAAAAAAA', actor_kind: 'system', actor_label: 'migration 006', type: 'created', to_status: 'cancelled' },
        { reference: 'FC-BBBBBBBB', actor_kind: 'system', actor_label: 'migration 006', type: 'created', to_status: 'requested' },
      ]);
    });

    it('seeds one period per restaurant meal from SLOTS, at slot_capacity covers', async () => {
      const { rows } = await sql(
        `SELECT meal, to_char(first_seating, 'HH24:MI') AS first, to_char(last_seating, 'HH24:MI') AS last,
                interval_min, covers_per_slot, weekdays, sort_order
           FROM service_periods WHERE restaurant_id = 'cafe-indochine' ORDER BY sort_order`,
      );
      expect(rows).toEqual([
        { meal: 'Breakfast', first: '06:30', last: '09:30', interval_min: 30, covers_per_slot: 40, weekdays: [1, 2, 3, 4, 5, 6, 7], sort_order: 10 },
        { meal: 'Lunch', first: '11:30', last: '13:30', interval_min: 30, covers_per_slot: 40, weekdays: [1, 2, 3, 4, 5, 6, 7], sort_order: 20 },
        { meal: 'Dinner', first: '18:00', last: '21:00', interval_min: 30, covers_per_slot: 40, weekdays: [1, 2, 3, 4, 5, 6, 7], sort_order: 40 },
      ]);
      const mismatched = await sql(
        `SELECT r.id FROM restaurants r
          WHERE r.meals::text[] IS DISTINCT FROM ARRAY(
                  SELECT p.meal FROM service_periods p WHERE p.restaurant_id = r.id
                   ORDER BY array_position(r.meals::text[], p.meal))`,
      );
      expect(mismatched.rows).toEqual([]);
      expect(await one(`SELECT count(*)::int AS periods, (SELECT sum(cardinality(meals))::int FROM restaurants) AS meals FROM service_periods`)).toEqual({
        periods: 25,
        meals: 25,
      });
    });

    it('creates the single booking_settings row with the spec defaults', async () => {
      expect(await one('SELECT window_days, lead_minutes, same_day_cutoff, max_party, auto_confirm, guest_ack_email, pii_retention_months FROM booking_settings')).toEqual({
        window_days: 14, lead_minutes: 30, same_day_cutoff: null, max_party: 12, auto_confirm: false, guest_ack_email: true, pii_retention_months: 24,
      });
      await expect(sql('INSERT INTO booking_settings (id) VALUES (false)')).rejects.toThrow(/booking_settings_single_row/);
      await expect(sql('INSERT INTO booking_settings (id) VALUES (true)')).rejects.toThrow(/booking_settings_pkey/);
    });

    it('turns booking on everywhere, with no overrides', async () => {
      expect(
        await one(`SELECT bool_and(booking_enabled) AS on, count(window_days) + count(lead_minutes) + count(max_party) + count(auto_confirm) AS overrides FROM restaurants`),
      ).toEqual({ on: true, overrides: '0' });
    });

    it('lists the old reservations in audit_feed with the same columns as before', async () => {
      const { rows } = await sql(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'audit_feed' ORDER BY ordinal_position`,
      );
      expect(rows.map((r) => r.column_name)).toEqual([
        'source', 'id', 'at', 'actor_id', 'actor_label', 'action', 'entity_type', 'entity_id', 'locale', 'before', 'after',
      ]);
      const feed = await sql(`SELECT action, entity_type, before, after FROM audit_feed WHERE source = 'reservation' ORDER BY id::bigint LIMIT 1`);
      expect(feed.rows).toEqual([
        { action: 'reservation.created', entity_type: 'reservation', before: null, after: { status: 'confirmed', reason: 'phase-1 booking' } },
      ]);
    });

    it('is safe to apply again', async () => {
      await sql(readFileSync('db/migrations/006_booking_v2.sql', 'utf8'));
      expect(await one(`SELECT (SELECT count(*)::int FROM service_periods) AS p, (SELECT count(*)::int FROM reservation_events) AS e,
                               (SELECT count(*)::int FROM booking_settings) AS s, (SELECT max(version) FROM reservations) AS v`)).toEqual({
        p: 25, e: 3, s: 1, v: 1,
      });
    });
  });

  describe('constraints, the trigger and search folding', () => {
    beforeAll(() => resetDatabase(url));

    it('accepts the six statuses only, and 1–50 guests', async () => {
      const statuses = ['requested', 'confirmed', 'seated', 'no_show', 'cancelled', 'declined'];
      for (const [i, status] of statuses.entries()) await v2({ status, phone_e164: `+8490511000${i}`, reserved_on: '2026-10-07' });
      expect((await one(`SELECT count(DISTINCT status)::int AS n FROM reservations`)).n).toBe(6);
      await expect(v2({ status: 'arrived' })).rejects.toThrow(/reservations_status_check/);
      await expect(v2({ guests: 51 })).rejects.toThrow(/reservations_guests_check/);
      await expect(v2({ guests: 0 })).rejects.toThrow(/reservations_guests_check/);
      await v2({ guests: 50, phone_e164: '+84905999999' });
    });

    it('requires HH:MM times, a known meal, a named source and a known locale', async () => {
      await expect(v2({ reserved_at: '7:00' })).rejects.toThrow(/reservations_reserved_at_check/);
      await expect(v2({ reserved_at: '24:00' })).rejects.toThrow(/reservations_reserved_at_check/);
      await expect(v2({ meal: 'Brunch' })).rejects.toThrow(/reservations_meal_check/);
      await expect(v2({ meal: null })).rejects.toThrow(/null value in column "meal"/);
      await expect(v2({ source: 'email' })).rejects.toThrow(/reservations_source_check/);
      await expect(v2({ locale: 'xx' })).rejects.toThrow(/reservations_locale_fkey/);
      // No default: an insert that forgets the source fails loudly.
      await expect(
        sql(`INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164)
             VALUES ('FC-NOSOURCE', 'taya-house', '2026-10-06', '19:00', 'Dinner', 2, 'G', '0905 111 112', '+84905111112')`),
      ).rejects.toThrow(/null value in column "source"/);
    });

    it('bumps version once per update and touches updated_at, whatever the SQL sets', async () => {
      const { rows } = await v2({ phone_e164: '+84905333333' });
      expect(rows[0].version).toBe(1);
      await sql(`UPDATE reservations SET status = 'confirmed' WHERE id = $1`, [rows[0].id]);
      // A write that tries to set version or search_text itself is overruled.
      await sql(`UPDATE reservations SET guests = 3, version = 99, search_text = 'x' WHERE id = $1`, [rows[0].id]);
      expect(await one(`SELECT version, updated_at > created_at AS touched, search_text FROM reservations WHERE id = $1`, [rows[0].id])).toMatchObject({
        version: 3,
        touched: true,
        search_text: expect.stringMatching(/^guest /),
      });
    });

    it('keeps search_text on insert and update, and drops it once the row is anonymised', async () => {
      const { rows } = await v2({ guest_name: 'Nguyễn Thị Ánh', email: 'Anh@Example.com', phone: '0905 444 555', phone_e164: '+84905444555', reference: 'FC-SEARCH01' });
      const text = async () => (await one(`SELECT search_text FROM reservations WHERE id = $1`, [rows[0].id])).search_text;
      expect(await text()).toBe('nguyen thi anh anh@example.com fc-search01 84905444555 0905444555');
      await sql(`UPDATE reservations SET guest_name = 'Lê Đức' WHERE id = $1`, [rows[0].id]);
      expect(await text()).toMatch(/^le duc /);
      await sql(`UPDATE reservations SET anonymized_at = now() WHERE id = $1`, [rows[0].id]);
      expect(await text()).toBeNull();
    });

    it('folds names and every Latin-1, Latin Extended-A, ơ/ư and Vietnamese character as fold() does, composed or decomposed, under the database collation and under C', async () => {
      expect(fold('Nguyễn Thị Ánh ĐỨC')).toBe('nguyen thi anh duc');
      // Every character of the blocks, not only the ones that fold to a–z: under the C
      // collation lower() leaves non-ASCII letters alone, so Ø, Æ, Ł… need a pair too.
      const chars = BLOCKS.flatMap(([from, to]) => Array.from({ length: to - from + 1 }, (_, i) => String.fromCodePoint(from + i)));
      expect(chars).toHaveLength(286);
      // Each also in NFD, as Unikey's "Unicode tổ hợp" and some pasted text send it.
      const inputs = [...new Set([...NAMES, ...chars].flatMap((x) => [x.normalize('NFC'), x.normalize('NFD')]))];
      expect(inputs.filter((x) => x !== x.normalize('NFC'))).toHaveLength(262);
      const { rows } = await sql(
        `SELECT fold_search(x) AS db, fold_search(x COLLATE "C") AS c FROM unnest($1::text[]) WITH ORDINALITY AS t(x, i) ORDER BY i`,
        [inputs],
      );
      expect(rows).toHaveLength(inputs.length);
      const mismatches = (collation: 'db' | 'c') =>
        inputs.flatMap((input, i) =>
          rows[i][collation] === fold(input) ? [] : [{ input, form: input === input.normalize('NFC') ? 'NFC' : 'NFD', sql: rows[i][collation], fold: fold(input) }],
        );
      expect(mismatches('db')).toEqual([]);
      expect(mismatches('c')).toEqual([]);
      // A search typed decomposed finds a booking stored precomposed.
      expect(
        await one(`SELECT fold_search($1) AS f, fold_search($2) LIKE '%' || fold_search($1) || '%' AS hit`, [
          'Nguyễn Thị'.normalize('NFD'),
          'Nguyễn Thị Ánh'.normalize('NFC'),
        ]),
      ).toEqual({ f: 'nguyen thi', hit: true });
    });

    it('beyond those blocks, strips the marks of whatever NFD decomposes, as fold() does', async () => {
      // Pinyin (Latin Extended-B, composed and decomposed), Latin Extended Additional, Cyrillic, Greek.
      const inputs = ['ǎ', 'a\u030c', 'Ǎ', 'Lǚ Xùn', 'Ḃ', 'й', 'Й', 'ё', 'Ё', 'ά', 'Ά'];
      const { rows } = await sql(
        `SELECT fold_search(x) AS db, fold_search(x COLLATE "C") AS c FROM unnest($1::text[]) WITH ORDINALITY AS t(x, i) ORDER BY i`,
        [inputs],
      );
      expect(rows.map((r) => r.db)).toEqual(inputs.map(fold));
      expect(fold('Й')).toBe('и');
      // Under C, lower() only knows A–Z: the marks still go, but a non-Latin capital keeps
      // its case (accepted risk 20), so Й folds to И, not и.
      const capitals = new Set(['Й', 'Ё', 'Ά']);
      expect(rows.map((r) => r.c)).toEqual(inputs.map((x) => (capitals.has(x) ? fold(x).toUpperCase() : fold(x))));
    });

    it('still rejects a second active request for the same table and number', async () => {
      await v2({ reserved_on: '2026-10-08', phone_e164: '+84905444444' });
      await expect(v2({ reserved_on: '2026-10-08', phone_e164: '+84905444444' })).rejects.toThrow(/reservations_dedupe_v2_idx/);
    });

    it('checks service periods: weekdays 1–7, last ≥ first, on the interval grid', async () => {
      const period = (over: Record<string, unknown>) => {
        const row = { restaurant_id: 'taya-house', meal: 'Dinner', first_seating: '18:00', last_seating: '21:00', interval_min: 30, covers_per_slot: 10, ...over };
        const cols = Object.keys(row);
        return sql(`INSERT INTO service_periods (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(row));
      };
      await period({ weekdays: [6, 7] });
      await expect(period({ weekdays: [0] })).rejects.toThrow(/service_periods_weekdays_check/);
      await expect(period({ weekdays: [] })).rejects.toThrow(/service_periods_weekdays_check/);
      await expect(period({ last_seating: '17:30' })).rejects.toThrow(/service_periods_order/);
      await expect(period({ last_seating: '20:45' })).rejects.toThrow(/service_periods_grid/);
      await expect(period({ first_seating: '18:00:30' })).rejects.toThrow(/service_periods_grid/);
      // 150 minutes is a multiple of 25, so only the interval CHECK can fail.
      await expect(period({ interval_min: 25, last_seating: '20:30' })).rejects.toThrow(/service_periods_interval_min_check/);
      await expect(period({ meal: 'Supper' })).rejects.toThrow(/service_periods_meal_check/);
      await expect(period({ covers_per_slot: 1001 })).rejects.toThrow(/service_periods_covers_per_slot_check/);
    });

    it('checks closures: scope matches its target, dates in order, meals known, reasons short', async () => {
      const closure = (over: Record<string, unknown>) => {
        const row = { scope: 'all', starts_on: '2026-12-24', ends_on: '2026-12-25', ...over };
        const cols = Object.keys(row);
        return sql(`INSERT INTO closures (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id, show_reason`, Object.values(row));
      };
      const { rows } = await closure({});
      expect(rows[0].show_reason).toBe(true);
      await closure({ scope: 'destination', destination_id: 'resort', meals: ['Dinner'] });
      await closure({ scope: 'restaurant', restaurant_id: 'taya-house' });
      await expect(closure({ scope: 'all', restaurant_id: 'taya-house' })).rejects.toThrow(/closures_scope_target/);
      await expect(closure({ scope: 'restaurant' })).rejects.toThrow(/closures_scope_target/);
      await expect(closure({ scope: 'destination', destination_id: 'resort', restaurant_id: 'taya-house' })).rejects.toThrow(/closures_scope_target/);
      await expect(closure({ starts_on: '2026-12-26' })).rejects.toThrow(/closures_dates/);
      await expect(closure({ meals: [] })).rejects.toThrow(/closures_meals_check/);
      await expect(closure({ meals: ['Tea'] })).rejects.toThrow(/closures_meals_check/);
      await expect(closure({ internal_note: 'x'.repeat(2001) })).rejects.toThrow(/closures_internal_note_check/);
      const reason = (locale: string, text: string) =>
        sql(`INSERT INTO closure_i18n (closure_id, locale, public_reason) VALUES ($1, $2, $3)`, [rows[0].id, locale, text]);
      await expect(reason('en', '')).rejects.toThrow(/closure_i18n_public_reason_check/);
      // Blank is empty to a guest: the same rule as reservation_notes.body.
      await expect(reason('en', '   ')).rejects.toMatchObject({ code: '23514', constraint: 'closure_i18n_public_reason_check' });
      await expect(reason('en', 'x'.repeat(161))).rejects.toThrow(/closure_i18n_public_reason_check/);
      await reason('en', 'Christmas');
      await expect(reason('xx', 'Noël')).rejects.toThrow(/closure_i18n_locale_fkey/);
      await sql('DELETE FROM closures WHERE id = $1', [rows[0].id]);
      expect((await one('SELECT count(*)::int AS n FROM closure_i18n')).n).toBe(0);
    });

    it('checks events and notes: staff need an id, a status change needs two different ends', async () => {
      const { rows } = await v2({ phone_e164: '+84905555555' });
      const event = (over: Record<string, unknown>) => {
        const row = { reservation_id: rows[0].id, actor_kind: 'staff', actor_id: 'u1', type: 'status_changed', from_status: 'requested', to_status: 'confirmed', ...over };
        const cols = Object.keys(row);
        return sql(`INSERT INTO reservation_events (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(row));
      };
      await event({});
      await expect(event({ actor_id: null })).rejects.toThrow(/reservation_events_staff_actor/);
      await expect(event({ from_status: null })).rejects.toThrow(/reservation_events_transition/);
      await expect(event({ to_status: 'requested' })).rejects.toThrow(/reservation_events_transition/);
      await expect(event({ type: 'created', from_status: null, to_status: null })).rejects.toThrow(/reservation_events_created_status/);
      await expect(event({ type: 'email_sent' })).rejects.toThrow(/reservation_events_type_check/);
      await expect(event({ reason: 'x'.repeat(501) })).rejects.toThrow(/reservation_events_reason_check/);
      const note = (body: string) =>
        sql(`INSERT INTO reservation_notes (reservation_id, author_id, author_label, body) VALUES ($1, 'u1', 'A', $2)`, [rows[0].id, body]);
      await expect(note('  ')).rejects.toThrow(/reservation_notes_body_check/);
      await expect(note('x'.repeat(2001))).rejects.toThrow(/reservation_notes_body_check/);
      await note('Window table, please.');
    });

    it('has pg_trgm, the trigram index on search_text, and the load index on holding statuses', async () => {
      expect((await one(`SELECT extversion FROM pg_extension WHERE extname = 'pg_trgm'`)).extversion).toMatch(/^1\./);
      expect((await one(`SELECT indexdef FROM pg_indexes WHERE indexname = 'reservations_search_trgm_idx'`)).indexdef).toContain('gin_trgm_ops');
      expect((await one(`SELECT indexdef FROM pg_indexes WHERE indexname = 'reservations_load_idx'`)).indexdef).toMatch(
        /INCLUDE \(guests\) WHERE \(status = ANY \(ARRAY\['requested'::text, 'confirmed'::text, 'seated'::text\]\)\)/,
      );
      expect((await sql(`SELECT 1 FROM pg_indexes WHERE indexname = 'reservations_slot_idx'`)).rowCount).toBe(0);
    });
  });

  it('stops, and changes nothing, when an old row has a malformed time', async () => {
    resetDatabase(url, '005_staff_auth_audit.sql');
    await legacy('FC-77777', 'taya-house', '7pm', 'requested');
    expect(() => migrate(url)).toThrow();
    expect((await sql(`SELECT 1 FROM information_schema.tables WHERE table_name = 'service_periods'`)).rowCount).toBe(0);
    expect((await one(`SELECT count(*)::int AS n FROM _migrations WHERE name = '006_booking_v2.sql'`)).n).toBe(0);
  });
});
