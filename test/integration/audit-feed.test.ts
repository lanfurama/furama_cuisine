import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AUDIT_PAGE_SIZE, listAuditFeed, staffEmails } from '@/lib/server/audit-feed';
import { TEST_DATABASE_URL } from '../helpers/db';
import { STAFF_TABLES, createBootstrapAdmin, createTestAuth } from '../helpers/auth';

/* /admin/audit reads audit_feed, newest first, 50 to a page (spec §5.2, §7.2). */

let pool: Pool;

describe.skipIf(!TEST_DATABASE_URL)('the audit feed', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    // Since migration 006 the feed also shows reservation_events, and other files leave bookings behind.
    await pool.query(`TRUNCATE ${STAFF_TABLES}, reservations CASCADE`);
  });

  it('puts the newest first and breaks ties by id, numerically', async () => {
    await pool.query(
      `INSERT INTO audit_log (at, actor_email, action, entity_type, entity_id)
       VALUES (now() - interval '1 hour', 'a@furama.test', 'staff.invite', 'staff_invitation', 'old')`,
    );
    // Twelve rows from one statement share one `at`; the text ids must sort as numbers ("9" after "10").
    await pool.query(
      `INSERT INTO audit_log (at, actor_email, action, entity_type, entity_id)
       SELECT now(), 'a@furama.test', 'staff.role', 'staff_user', 'u' || g FROM generate_series(1, 12) AS g`,
    );
    const { rows, hasNext } = await listAuditFeed(pool, 1);
    expect(hasNext).toBe(false);
    expect(rows.map((r) => r.entity_id)).toEqual(['u12', 'u11', 'u10', 'u9', 'u8', 'u7', 'u6', 'u5', 'u4', 'u3', 'u2', 'u1', 'old']);
    expect(rows[0]).toMatchObject({ source: 'audit', actor_label: 'a@furama.test', action: 'staff.role', entity_type: 'staff_user' });
    expect(rows[0].at).toBeInstanceOf(Date);
  });

  it('pages by 50', async () => {
    await pool.query(
      `INSERT INTO audit_log (at, action, entity_type, entity_id)
       SELECT now() - g * interval '1 second', 'update', 'restaurant', 'r' || g FROM generate_series(1, 55) AS g`,
    );
    const first = await listAuditFeed(pool, 1);
    const second = await listAuditFeed(pool, 2);
    expect(AUDIT_PAGE_SIZE).toBe(50);
    expect(first.rows).toHaveLength(50);
    expect(first.hasNext).toBe(true);
    expect(second.rows.map((r) => r.entity_id)).toEqual(['r51', 'r52', 'r53', 'r54', 'r55']);
    expect(second.hasNext).toBe(false);
    expect((await listAuditFeed(pool, 99)).rows).toEqual([]);
  });

  it('merges reservation events into the same timeline', async () => {
    await pool.query(
      `INSERT INTO audit_log (at, actor_email, action, entity_type, entity_id)
       VALUES (now() - interval '2 minutes', 'a@furama.test', 'update', 'restaurant', 'taya-house')`,
    );
    const { rows } = await pool.query(
      `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source)
       VALUES ('FC-FEED0001', 'taya-house', '2026-10-05', '19:00', 'Dinner', 2, 'An', 'x', '+84905000000', 'web') RETURNING id`,
    );
    await pool.query(
      `INSERT INTO reservation_events (reservation_id, at, actor_kind, type, to_status)
       VALUES ($1, now() - interval '3 hours', 'guest', 'created', 'requested')`,
      [rows[0].id],
    );
    await pool.query(
      `INSERT INTO reservation_events (reservation_id, at, actor_kind, actor_id, actor_label, type, from_status, to_status, changes)
       VALUES ($1, now() - interval '1 minute', 'staff', 'u1', 'ed@furama.test', 'status_changed', 'requested', 'confirmed', '{"note": ["a", "b"]}')`,
      [rows[0].id],
    );
    const feed = await listAuditFeed(pool, 1);
    expect(feed.rows.map((r) => [r.source, r.action, r.entity_type, r.entity_id, r.actor_label])).toEqual([
      ['reservation', 'reservation.status_changed', 'reservation', String(rows[0].id), 'ed@furama.test'],
      ['audit', 'update', 'restaurant', 'taya-house', 'a@furama.test'],
      ['reservation', 'reservation.created', 'reservation', String(rows[0].id), 'Khách'],
    ]);
    expect(feed.rows[0]).toMatchObject({ before: { status: 'requested' }, after: { status: 'confirmed', changes: { note: ['a', 'b'] } } });
    expect(feed.rows[2]).toMatchObject({ before: null, after: { status: 'requested' } });
  });

  it('looks up the email of staff the rows are about, skipping removed accounts', async () => {
    const owner = await createBootstrapAdmin(createTestAuth(pool));
    expect(await staffEmails(pool, [owner.id, 'removed-id'])).toEqual(new Map([[owner.id, owner.email]]));
    expect(await staffEmails(pool, [])).toEqual(new Map());
  });
});
