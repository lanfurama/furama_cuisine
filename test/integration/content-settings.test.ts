import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import type { AuditActor } from '@/lib/server/audit';
import { listHistory } from '@/lib/server/content-admin/history';
import {
  BOOKING_DEFAULTS,
  getSettingsEditor,
  restoreSettings,
  saveSettings,
  UNKNOWN_OCCASION,
  UNKNOWN_RESTAURANT,
} from '@/lib/server/content-admin/settings';
import { loadSiteSettings } from '@/lib/server/content/settings.queries';
import { getSharedInbox, saveSharedInbox } from '@/lib/server/email/recipients';

/*
 * The booking screen's defaults (spec §5.2 site_settings, §7.2
 * content/booking) through the shared site_settings group writer: the guest
 * site's settings (loadSiteSettings) follow each save at once; History puts a
 * version back under today's rules; the group's token ignores the shared
 * inbox's save (R2), and the hero's pace keeps its own History.
 */

const pool = getPool();
const ACTOR: AuditActor = { id: 'staff-lan', email: 'lan@furama.test', name: 'Lan' };
const OTHER: AuditActor = { id: 'staff-minh', email: 'minh@furama.test', name: 'Minh' };

const editor = () => getSettingsEditor(pool, BOOKING_DEFAULTS);
const guest = async () => {
  const s = await loadSiteSettings(pool);
  return { restaurant: s?.defaultRestaurantId, occasion: s?.defaultOccasion };
};

describe.skipIf(!process.env.TEST_DATABASE_URL)('site settings groups: the booking defaults (database)', () => {
  let inbox = '';
  beforeAll(async () => {
    inbox = (await getSharedInbox(pool)).email;
    for (const a of [ACTOR, OTHER]) {
      await pool.query(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ($1, $2, $3, true, 'editor') ON CONFLICT (id) DO NOTHING`, [
        a.id,
        a.name,
        a.email,
      ]);
    }
  });
  beforeEach(() => pool.query('TRUNCATE audit_log'));
  afterEach(() =>
    pool.query(`UPDATE site_settings SET default_restaurant_id = 'taya-house', default_occasion = 'Dinner', email = $1`, [inbox]),
  );
  afterAll(async () => {
    await pool.query('TRUNCATE audit_log');
    await pool.query(`DELETE FROM staff_user WHERE id = ANY($1::text[])`, [[ACTOR.id, OTHER.id]]);
    await pool.end();
  });

  it('a save reaches the guest site’s settings at once; History brings the old defaults back; a page older than another save is a conflict', async () => {
    expect(await guest()).toEqual({ restaurant: 'taya-house', occasion: 'Dinner' });
    const { token } = await editor();
    expect(await saveSettings(pool, ACTOR, BOOKING_DEFAULTS, { token, values: { default_restaurant_id: 'the-fan', default_occasion: 'Lunch' } })).toEqual({
      ok: true,
      data: null,
    });
    expect(await guest()).toEqual({ restaurant: 'the-fan', occasion: 'Lunch' });
    const [saved] = await listHistory(pool, 'site_settings', BOOKING_DEFAULTS.id, 10);
    expect(saved).toMatchObject({ action: 'update' });
    expect(await saveSettings(pool, OTHER, BOOKING_DEFAULTS, { token, values: { default_restaurant_id: null, default_occasion: null } })).toMatchObject({
      ok: false,
      code: 'conflict',
      params: { by: 'Lan' },
    });
    expect(
      await restoreSettings(pool, OTHER, BOOKING_DEFAULTS, { id: BOOKING_DEFAULTS.id, auditId: saved.id, side: 'before', token: (await editor()).token }),
    ).toEqual({ ok: true, data: null });
    expect(await guest()).toEqual({ restaurant: 'taya-house', occasion: 'Dinner' });
    const [restored] = await listHistory(pool, 'site_settings', BOOKING_DEFAULTS.id, 10);
    expect(restored).toMatchObject({ action: 'restore' });
  });

  it('“none” is a choice for both; an archived or unknown restaurant and a meal the CHECK refuses are not, on a save or a restore', async () => {
    expect(await saveSettings(pool, ACTOR, BOOKING_DEFAULTS, { token: (await editor()).token, values: { default_restaurant_id: null, default_occasion: null } })).toEqual({
      ok: true,
      data: null,
    });
    expect(await guest()).toEqual({ restaurant: null, occasion: null });
    const { token } = await editor();
    expect(await saveSettings(pool, ACTOR, BOOKING_DEFAULTS, { token, values: { default_restaurant_id: 'atlantis', default_occasion: null } })).toEqual({
      ok: false,
      code: 'invalid',
      fieldErrors: { defaultRestaurantId: [UNKNOWN_RESTAURANT] },
    });
    expect(await saveSettings(pool, ACTOR, BOOKING_DEFAULTS, { token, values: { default_restaurant_id: null, default_occasion: 'Brunch' } })).toEqual({
      ok: false,
      code: 'invalid',
      fieldErrors: { defaultOccasion: [UNKNOWN_OCCASION] },
    });

    // A version naming a restaurant archived since cannot come back (today's rules, code rule 5).
    expect(await saveSettings(pool, ACTOR, BOOKING_DEFAULTS, { token, values: { default_restaurant_id: 'the-fan', default_occasion: null } })).toMatchObject({ ok: true });
    const [saved] = await listHistory(pool, 'site_settings', BOOKING_DEFAULTS.id, 10);
    expect(await saveSettings(pool, ACTOR, BOOKING_DEFAULTS, { token: (await editor()).token, values: { default_restaurant_id: null, default_occasion: null } })).toMatchObject({
      ok: true,
    });
    await pool.query(`UPDATE restaurants SET archived_at = now() WHERE id = 'the-fan'`);
    try {
      expect(
        await restoreSettings(pool, OTHER, BOOKING_DEFAULTS, { id: BOOKING_DEFAULTS.id, auditId: saved.id, side: 'after', token: (await editor()).token }),
      ).toEqual({ ok: false, code: 'invalid', fieldErrors: { defaultRestaurantId: [UNKNOWN_RESTAURANT] } });
    } finally {
      await pool.query(`UPDATE restaurants SET archived_at = NULL WHERE id = 'the-fan'`);
    }
    // A stored version the CHECK refuses (written by hand into History) is refused cleanly.
    await pool.query(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, before, after)
       VALUES ($1, 'update', 'site_settings', $2, NULL, $3::jsonb)`,
      [ACTOR.id, BOOKING_DEFAULTS.id, JSON.stringify({ v: 1, row: { id: BOOKING_DEFAULTS.id, default_restaurant_id: null, default_occasion: 'Supper' }, i18n: [] })],
    );
    const [crafted] = await listHistory(pool, 'site_settings', BOOKING_DEFAULTS.id, 10);
    expect(
      await restoreSettings(pool, OTHER, BOOKING_DEFAULTS, { id: BOOKING_DEFAULTS.id, auditId: crafted.id, side: 'after', token: (await editor()).token }),
    ).toEqual({ ok: false, code: 'invalid', fieldErrors: { defaultOccasion: [UNKNOWN_OCCASION] } });
  });

  it('the group’s token is its own values only: a save of the shared inbox (phase 5) is no conflict, and a restore of another group’s row is not found', async () => {
    const { token } = await editor();
    const shared = await getSharedInbox(pool);
    expect(await saveSharedInbox(pool, OTHER, { email: 'reservations@furama.test', token: shared.token })).toEqual({ ok: true, data: null });
    expect(await saveSettings(pool, ACTOR, BOOKING_DEFAULTS, { token, values: { default_restaurant_id: 'taya-house', default_occasion: 'Drinks' } })).toEqual({
      ok: true,
      data: null,
    });
    const [saved] = await listHistory(pool, 'site_settings', BOOKING_DEFAULTS.id, 10);
    expect(await restoreSettings(pool, OTHER, BOOKING_DEFAULTS, { id: 'hero_autoplay_ms', auditId: saved.id, side: 'before', token: (await editor()).token })).toEqual({
      ok: false,
      code: 'not_found',
    });
  });
});
