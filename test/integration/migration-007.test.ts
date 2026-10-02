import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMAIL_EVENTS, EMAIL_STATUSES } from '@/lib/email/events';
import { TEST_DATABASE_URL, databaseUrl, migrate, resetDatabase, withClient } from '../helpers/db';

/*
 * Migration 007 (phase 5): the early site_settings row, notification_recipients,
 * email_outbox, and the consent columns of reservations. reservation_events
 * keeps 006's CHECK: email history lives in email_outbox (R2).
 */

const url = databaseUrl('furama_cuisine_migrate007_test');
const sql = (text: string, values: unknown[] = []) => withClient(url, (c) => c.query(text, values));
const one = async (text: string, values: unknown[] = []) => (await sql(text, values)).rows[0];
const checkDef = async (name: string) => (await one(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1`, [name]))?.def;

/** A phase-4 booking with its created event, as 006 leaves the tables. */
async function booking(): Promise<{ id: string; event: string }> {
  const r = await one(
    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, email, source)
     VALUES ('FC-' || upper(substr(md5(random()::text), 1, 8)), 'taya-house', '2026-10-06', '19:00', 'Dinner', 2, 'G', '0905 111 111',
             '+849051' || lpad((floor(random() * 1e5))::int::text, 5, '0'), 'g@example.com', 'web')
     RETURNING id::text`,
  );
  const e = await one(`INSERT INTO reservation_events (reservation_id, actor_kind, type, to_status) VALUES ($1, 'guest', 'created', 'requested') RETURNING id::text`, [r.id]);
  return { id: r.id, event: e.id };
}

const row = (over: Record<string, unknown>) => {
  const cols = Object.keys(over);
  return sql(`INSERT INTO email_outbox (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, Object.values(over));
};

describe.skipIf(!TEST_DATABASE_URL)('migration 007: email outbox, recipients, site settings, consent (database)', () => {
  describe('on a database at 006 that already has bookings', () => {
    let existing: { id: string; event: string };
    beforeAll(async () => {
      resetDatabase(url, '006_booking_v2.sql');
      existing = await booking();
      migrate(url);
    });

    it('adds the three tables, seeds the general email, and leaves the bookings and their events as they were', async () => {
      expect(await one(`SELECT count(*)::int AS r, (SELECT count(*)::int FROM reservation_events) AS e FROM reservations`)).toEqual({ r: 1, e: 1 });
      expect(await one(`SELECT count(*)::int AS o, (SELECT count(*)::int FROM notification_recipients) AS n FROM email_outbox`)).toEqual({ o: 0, n: 0 });
      expect((await sql(`SELECT id, email FROM site_settings`)).rows).toEqual([{ id: true, email: 'fb@furamavietnam.com' }]);
      // An older booking carries no consent: neither column, which the pair CHECK allows.
      expect(await one(`SELECT consent_version, consented_at FROM reservations`)).toEqual({ consent_version: null, consented_at: null });
    });

    it('keeps 006’s reservation_events type CHECK: email history lives in email_outbox', async () => {
      expect(await checkDef('reservation_events_type_check')).toBe(
        `CHECK ((type = ANY (ARRAY['created'::text, 'status_changed'::text, 'edited'::text, 'note_added'::text])))`,
      );
    });

    it('knows exactly the events and statuses of lib/email/events.ts', async () => {
      const list = (values: readonly string[]) => values.map((v) => `'${v}'::text`).join(', ');
      expect(await checkDef('email_outbox_event_check')).toBe(`CHECK ((event = ANY (ARRAY[${list(EMAIL_EVENTS)}])))`);
      expect(await checkDef('email_outbox_status_check')).toBe(`CHECK ((status = ANY (ARRAY[${list(EMAIL_STATUSES)}])))`);
    });

    it('derives the idempotency key from the id (STORED, UNIQUE), and starts a row queued with no attempts, due now', async () => {
      const { rows } = await row({
        env: 'production', event: 'guest.ack', audience: 'guest', reservation_id: existing.id, reservation_event_id: existing.event,
        to_email: 'g@example.com', locale: 'en',
      });
      expect(rows[0]).toMatchObject({ idempotency_key: `outbox:${rows[0].id}`, status: 'queued', attempts: 0, fallback: false, locked_until: null, sent_at: null, message_id: null });
      expect(Math.abs(Date.now() - rows[0].next_attempt_at.getTime())).toBeLessThan(60_000);
      await expect(sql(`UPDATE email_outbox SET idempotency_key = 'x'`)).rejects.toThrow(/can only be updated to DEFAULT/);
      expect(await one(`SELECT attgenerated FROM pg_attribute WHERE attrelid = 'email_outbox'::regclass AND attname = 'idempotency_key'`)).toEqual({ attgenerated: 's' });
      expect((await one(`SELECT indexdef FROM pg_indexes WHERE indexname = 'email_outbox_idempotency_key_key'`)).indexdef).toMatch(/UNIQUE INDEX/);
    });

    it('is safe to apply again', async () => {
      await sql(readFileSync('db/migrations/007_email_and_consent.sql', 'utf8'));
      expect(await one(`SELECT (SELECT count(*)::int FROM site_settings) AS s, (SELECT count(*)::int FROM email_outbox) AS o`)).toEqual({ s: 1, o: 1 });
      expect(await checkDef('reservations_consent_check')).toMatch(/consent_version IS NOT NULL/);
    });
  });

  describe('constraints', () => {
    let b: { id: string; event: string };
    const base = () => ({ env: 'development', event: 'staff.new', audience: 'staff', reservation_id: b.id, to_email: 'lan@furama.test', locale: 'vi' });
    beforeAll(async () => {
      resetDatabase(url);
      b = await booking();
    });

    it('knows the envs, the events, the statuses, and matches the audience to the event', async () => {
      await expect(row({ ...base(), env: 'staging' })).rejects.toThrow(/email_outbox_env_check/);
      await expect(row({ ...base(), event: 'guest.edited', audience: 'guest' })).rejects.toThrow(/email_outbox_event_check/);
      await expect(row({ ...base(), event: 'staff.test' })).rejects.toThrow(/email_outbox_event_check/);
      await expect(row({ ...base(), status: 'bounced' })).rejects.toThrow(/email_outbox_status_check/);
      await expect(row({ ...base(), audience: 'guest' })).rejects.toThrow(/email_outbox_audience_event/);
      await expect(row({ ...base(), event: 'guest.ack', audience: 'staff' })).rejects.toThrow(/email_outbox_audience_event/);
      await expect(row({ ...base(), locale: 'xx' })).rejects.toThrow(/email_outbox_locale_fkey/);
    });

    it('every row belongs to a booking; one @ in the address; at most 7 attempts; a sending row has a lease; sent and sent_at go together', async () => {
      await expect(row({ ...base(), reservation_id: null })).rejects.toThrow(/null value in column "reservation_id"/);
      await expect(row({ ...base(), to_email: 'not an address' })).rejects.toThrow(/email_outbox_to_email_check/);
      await expect(row({ ...base(), to_email: 'a@home@example.com' })).rejects.toThrow(/email_outbox_to_email_check/);
      await expect(row({ ...base(), to_email: `${'a'.repeat(250)}@x.vn` })).rejects.toThrow(/email_outbox_to_email_check/);
      await expect(row({ ...base(), attempts: 8 })).rejects.toThrow(/email_outbox_attempts_check/);
      await expect(row({ ...base(), status: 'sending' })).rejects.toThrow(/email_outbox_sending_leased/);
      await expect(row({ ...base(), status: 'sent' })).rejects.toThrow(/email_outbox_sent_at/);
      await expect(row({ ...base(), sent_at: new Date() })).rejects.toThrow(/email_outbox_sent_at/);
      await expect(row({ ...base(), last_error: 'x'.repeat(301) })).rejects.toThrow(/email_outbox_last_error_check/);
      // The phase-10 anonymiser's placeholder still passes.
      await row({ ...base(), to_email: 'anonymized@invalid' });
    });

    it('goes with its booking, and outlives its timeline event', async () => {
      const own = await booking();
      await row({ ...base(), reservation_id: own.id, reservation_event_id: own.event });
      await sql(`DELETE FROM reservation_events WHERE id = $1`, [own.event]);
      expect((await one(`SELECT reservation_event_id FROM email_outbox WHERE reservation_id = $1`, [own.id])).reservation_event_id).toBeNull();
      await sql(`DELETE FROM reservations WHERE id = $1`, [own.id]);
      expect((await one(`SELECT count(*)::int AS n FROM email_outbox WHERE reservation_id = $1`, [own.id])).n).toBe(0);
    });

    it('recipients: scope matches its target, staff events only, one row per address and target (any case)', async () => {
      const add = (over: Record<string, unknown>) => {
        const r = { scope: 'all', email: 'lan@furama.test', ...over };
        const cols = Object.keys(r);
        return sql(`INSERT INTO notification_recipients (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, Object.values(r));
      };
      const { rows } = await add({});
      expect(rows[0]).toMatchObject({ events: ['staff.new'], locale: 'vi', active: true });
      await expect(add({ email: 'LAN@Furama.test' })).rejects.toThrow(/notification_recipients_target_email_idx/);
      await add({ scope: 'restaurant', restaurant_id: 'taya-house' }); // the same address, another target
      await expect(add({ scope: 'restaurant' })).rejects.toThrow(/notification_recipients_scope_target/);
      await expect(add({ scope: 'all', destination_id: 'resort', email: 'x@furama.test' })).rejects.toThrow(/notification_recipients_scope_target/);
      await expect(add({ email: 'y@furama.test', events: ['guest.ack'] })).rejects.toThrow(/notification_recipients_events_check/);
      await expect(add({ email: 'z@furama.test', events: [] })).rejects.toThrow(/notification_recipients_events_check/);
      await expect(add({ email: 'two@at@furama.test' })).rejects.toThrow(/notification_recipients_email_check/);
      await expect(add({ scope: 'destination', destination_id: 'atlantis', email: 'w@furama.test' })).rejects.toThrow(/notification_recipients_destination_id_fkey/);
      // A restaurant that goes takes its recipients with it.
      await sql(`INSERT INTO notification_recipients (scope, restaurant_id, email) VALUES ('restaurant', 'the-fan', 'fan@furama.test')`);
      await sql(`DELETE FROM restaurants WHERE id = 'the-fan'`);
      expect((await one(`SELECT count(*)::int AS n FROM notification_recipients WHERE restaurant_id = 'the-fan'`)).n).toBe(0);
    });

    it('site_settings stays one row with a real address', async () => {
      await expect(sql(`INSERT INTO site_settings (id, email) VALUES (false, 'a@b.vn')`)).rejects.toThrow(/site_settings_single_row/);
      await expect(sql(`INSERT INTO site_settings (id, email) VALUES (true, 'a@b.vn')`)).rejects.toThrow(/site_settings_pkey/);
      await expect(sql(`UPDATE site_settings SET email = 'nobody'`)).rejects.toThrow(/site_settings_email_check/);
      await expect(sql(`UPDATE site_settings SET email = NULL`)).rejects.toThrow(/null value in column "email"/);
    });

    it('keeps the consent version and its time together (a NULL version cannot slip through)', async () => {
      const insert = (version: string | null, at: string | null) =>
        sql(
          `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source, consent_version, consented_at)
           VALUES ('FC-' || upper(substr(md5(random()::text), 1, 8)), 'taya-house', '2026-10-07', '19:00', 'Dinner', 2, 'G', 'x',
                   '+849052' || lpad((floor(random() * 1e5))::int::text, 5, '0'), 'web', $1, $2)`,
          [version, at],
        );
      await expect(insert('2026-10-02', null)).rejects.toThrow(/reservations_consent_check/);
      await expect(insert(null, '2026-10-02T00:00:00Z')).rejects.toThrow(/reservations_consent_check/);
      await expect(insert('', '2026-10-02T00:00:00Z')).rejects.toThrow(/reservations_consent_check/);
      await expect(insert('x'.repeat(41), '2026-10-02T00:00:00Z')).rejects.toThrow(/reservations_consent_check/);
      await insert('2026-10-02', '2026-10-02T00:00:00Z');
      await insert(null, null); // a staff-entered or older booking
    });

    it('has the drain index on due rows, the booking index and the log indexes', async () => {
      const { rows } = await sql(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'email_outbox' ORDER BY indexname`);
      const defs = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
      expect(Object.keys(defs)).toEqual([
        'email_outbox_due_idx',
        'email_outbox_failed_idx',
        'email_outbox_idempotency_key_key',
        'email_outbox_log_idx',
        'email_outbox_pkey',
        'email_outbox_reservation_idx',
      ]);
      expect(defs.email_outbox_due_idx).toMatch(/\(env, next_attempt_at, id\) WHERE \(status = ANY \(ARRAY\['queued'::text, 'sending'::text\]\)\)/);
      expect(defs.email_outbox_reservation_idx).toMatch(/\(reservation_id, id\)/);
      expect(defs.email_outbox_log_idx).toMatch(/\(created_at DESC, id DESC\)/);
      expect(defs.email_outbox_failed_idx).toMatch(/WHERE \(status = 'failed'::text\)/);
    });
  });
});
