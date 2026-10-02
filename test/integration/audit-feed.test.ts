import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AUDIT_PAGE_SIZE, entityLabels, isAuditCursor, listAuditFeed } from '@/lib/server/audit-feed';
import { TEST_DATABASE_URL } from '../helpers/db';
import { STAFF_TABLES, createBootstrapAdmin, createTestAuth, inviteBySql } from '../helpers/auth';

/*
 * /admin/audit reads audit_feed: audit_log ∪ reservation_events, newest first,
 * 50 to a page, keyset paging (spec §5.2, §7.2, §7.4; phase-3 ledger "Phase 4").
 */

let pool: Pool;

async function reservation(reference = 'FC-FEED0001'): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source)
     VALUES ($1, 'taya-house', '2026-10-05', '19:00', 'Dinner', 2, 'An', '0905000000', '+84905000000', 'web') RETURNING id::text`,
    [reference],
  );
  return rows[0].id;
}

describe.skipIf(!TEST_DATABASE_URL)('the audit feed', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    // The feed also shows reservation_events, and other files leave bookings behind.
    await pool.query(`TRUNCATE ${STAFF_TABLES}, reservations CASCADE`);
  });

  it('puts the newest first and breaks ties by source, then id as a number', async () => {
    await pool.query(
      `INSERT INTO audit_log (at, actor_email, action, entity_type, entity_id)
       VALUES (now() - interval '1 hour', 'a@furama.test', 'staff.invite', 'staff_invitation', 'old')`,
    );
    // Twelve rows from one statement share one `at`; the ids must sort as numbers ("9" after "10").
    await pool.query(
      `INSERT INTO audit_log (at, actor_email, action, entity_type, entity_id)
       SELECT now(), 'a@furama.test', 'staff.role', 'staff_user', 'u' || g FROM generate_series(1, 12) AS g`,
    );
    const { rows, older, newer } = await listAuditFeed(pool);
    expect([older, newer]).toEqual([null, null]);
    expect(rows.map((r) => r.entity_id)).toEqual(['u12', 'u11', 'u10', 'u9', 'u8', 'u7', 'u6', 'u5', 'u4', 'u3', 'u2', 'u1', 'old']);
    expect(rows[0]).toMatchObject({ source: 'audit', actor_label: 'a@furama.test', action: 'staff.role', entity_type: 'staff_user' });
    expect(rows[0].at).toBeInstanceOf(Date);
    expect(isAuditCursor(rows[0].cursor)).toBe(true);
  });

  it('merges reservation events into the same timeline, as reservation.<type>', async () => {
    await pool.query(
      `INSERT INTO audit_log (at, actor_email, action, entity_type, entity_id)
       VALUES (now() - interval '2 minutes', 'a@furama.test', 'update', 'closure', '7')`,
    );
    const id = await reservation();
    await pool.query(
      `INSERT INTO reservation_events (reservation_id, at, actor_kind, type, to_status)
       VALUES ($1, now() - interval '3 hours', 'guest', 'created', 'requested')`,
      [id],
    );
    await pool.query(
      `INSERT INTO reservation_events (reservation_id, at, actor_kind, actor_id, actor_label, type, from_status, to_status, reason)
       VALUES ($1, now() - interval '1 minute', 'staff', 'u1', 'Lan (lan@furama.test)', 'status_changed', 'requested', 'cancelled', 'Khách báo hủy')`,
      [id],
    );
    const { rows } = await listAuditFeed(pool);
    expect(rows.map((r) => [r.source, r.action, r.entity_type, r.entity_id, r.actor_label])).toEqual([
      ['reservation', 'reservation.status_changed', 'reservation', id, 'Lan (lan@furama.test)'],
      ['audit', 'update', 'closure', '7', 'a@furama.test'],
      ['reservation', 'reservation.created', 'reservation', id, 'Khách'],
    ]);
    expect(rows[0]).toMatchObject({ actor_id: 'u1', before: { status: 'requested' }, after: { status: 'cancelled', reason: 'Khách báo hủy' } });
    expect(rows[2]).toMatchObject({ before: null, after: { status: 'requested' } });
  });

  it('pages by 50 with keyset cursors, older and back newer', async () => {
    await pool.query(
      `INSERT INTO audit_log (at, action, entity_type, entity_id)
       SELECT now() - g * interval '1 second', 'update', 'restaurant', 'r' || g FROM generate_series(1, 55) AS g`,
    );
    const first = await listAuditFeed(pool);
    expect(AUDIT_PAGE_SIZE).toBe(50);
    expect(first.rows).toHaveLength(50);
    expect(first.newer).toBeNull();
    const second = await listAuditFeed(pool, { before: first.older });
    expect(second.rows.map((r) => r.entity_id)).toEqual(['r51', 'r52', 'r53', 'r54', 'r55']);
    expect(second.older).toBeNull();
    const back = await listAuditFeed(pool, { after: second.newer });
    expect(back.rows.map((r) => r.entity_id)).toEqual(first.rows.map((r) => r.entity_id));
    expect(back.newer).toBeNull();
  });

  it('never skips or repeats rows that share a millisecond (the cursor keeps microseconds)', async () => {
    // 65 rows, 1 µs apart: all inside one millisecond, which is all a JS Date would keep.
    await pool.query(
      `INSERT INTO audit_log (at, action, entity_type, entity_id)
       SELECT timestamptz '2026-10-02 10:00:00.000100+07' - g * interval '1 microsecond', 'update', 'restaurant', 'r' || g
         FROM generate_series(1, 65) AS g`,
    );
    const first = await listAuditFeed(pool);
    const second = await listAuditFeed(pool, { before: first.older });
    expect([...first.rows, ...second.rows].map((r) => r.entity_id)).toEqual(Array.from({ length: 65 }, (_, i) => `r${i + 1}`));
    const back = await listAuditFeed(pool, { after: second.newer });
    expect(back.rows.map((r) => r.entity_id)).toEqual(first.rows.map((r) => r.entity_id));
  });

  it('reads a malformed cursor as the newest page', async () => {
    await pool.query(`INSERT INTO audit_log (action, entity_type, entity_id) VALUES ('update', 'restaurant', 'x')`);
    expect(isAuditCursor("1_audit_1' OR 1=1")).toBe(false);
    expect((await listAuditFeed(pool, { before: "1_audit_1' OR 1=1" })).rows.map((r) => r.entity_id)).toEqual(['x']);
    expect((await listAuditFeed(pool, { after: '2' })).rows.map((r) => r.entity_id)).toEqual(['x']);
  });

  it('labels staff and invitations by email and bookings by reference', async () => {
    const owner = await createBootstrapAdmin(createTestAuth(pool));
    await inviteBySql(pool, 'moi@furama.test', 'editor');
    const { rows: invitation } = await pool.query<{ id: string }>(`SELECT id::text FROM staff_invitation WHERE email = 'moi@furama.test'`);
    const id = await reservation('FC-7K3QH9XA');
    const labels = await entityLabels(pool, [
      { entity_type: 'staff_user', entity_id: owner.id },
      { entity_type: 'staff_user', entity_id: 'removed-id' },
      { entity_type: 'staff_invitation', entity_id: invitation[0].id },
      { entity_type: 'reservation', entity_id: id },
      { entity_type: 'reservation', entity_id: 'not-a-number' },
    ]);
    expect(labels).toEqual(
      new Map([
        [`staff_user:${owner.id}`, owner.email],
        [`staff_invitation:${invitation[0].id}`, 'moi@furama.test'],
        [`reservation:${id}`, 'FC-7K3QH9XA'],
      ]),
    );
    expect(await entityLabels(pool, [])).toEqual(new Map());
  });
});
