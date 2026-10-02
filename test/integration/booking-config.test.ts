import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { planDay } from '@/lib/booking/resolve-day';
import type { AuditActor } from '@/lib/server/audit';
import { findAffected } from '@/lib/server/booking/affected';
import {
  createClosure,
  deleteClosure,
  getBookingSettings,
  getRestaurantBooking,
  listClosures,
  loadPeriods,
  overlappingPeriods,
  restaurantsInScope,
  saveAutoConfirm,
  saveBookingSettings,
  saveRestaurantRules,
  saveServicePeriods,
  updateClosure,
  type ClosureInput,
  type PeriodInput,
} from '@/lib/server/booking/config';
import { createWebReservation } from '@/lib/server/booking/create';
import { parseReservationInput } from '@/lib/server/booking/input';
import { loadRestaurantRules } from '@/lib/server/booking/rules';
import { TEST_DATABASE_URL } from '../helpers/db';

/*
 * Spec §10.1: hours, capacity and the booking rules as staff edit them, each
 * save with its audit_log row and a concurrency token naming who saved
 * first; the bookings the new rules leave out are listed, never cancelled.
 */

let pool: Pool;
const ACTOR: AuditActor = { id: 'staff-lan', email: 'lan@furama.test', name: 'Lan' };
// Friday 2 Oct 2026, 10:00 in Vietnam.
const NOW = new Date('2026-10-02T10:00:00+07:00');

async function seed(over: { date?: string; time?: string; guests?: number; status?: string; restaurant?: string } = {}) {
  const phone = `+849051${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164, status, meal, source)
     VALUES ('FC-' || upper(substr(md5(random()::text), 1, 8)), $1, $2::date, $3, $4, 'Khách', $5, $5, $6,
             CASE WHEN $3 < '15:00' THEN 'Lunch' ELSE 'Dinner' END, 'web')
     RETURNING id::text`,
    [over.restaurant ?? 'taya-house', over.date ?? '2026-10-05', over.time ?? '19:00', over.guests ?? 2, phone, over.status ?? 'confirmed'],
  );
  return rows[0].id;
}

const audit = async () => (await pool.query('SELECT actor_id, action, entity_type, entity_id, before, after FROM audit_log ORDER BY id')).rows;
const periodsOf = () => loadPeriods(pool, 'taya-house');
const asInput = (list: Awaited<ReturnType<typeof periodsOf>>): PeriodInput[] => list.map(({ sortOrder: _sortOrder, ...p }) => p);
const token = async () => (await getRestaurantBooking(pool, 'taya-house'))!.token;
const dinnerTimes = async () =>
  planDay((await loadRestaurantRules(pool, 'taya-house', 'en', '2026-10-05'))!.rules, '2026-10-05')
    .periods.find((p) => p.meal === 'Dinner')!
    .slots.map((s) => `${s.time}/${s.capacity}`);

/** Migration 006's seed for Tàya House (Lunch and Dinner, 16 covers a slot), and every restaurant on its defaults. */
async function resetTaya() {
  await pool.query(`DELETE FROM service_periods WHERE restaurant_id = 'taya-house'`);
  await pool.query(
    `INSERT INTO service_periods (restaurant_id, meal, first_seating, last_seating, interval_min, covers_per_slot, sort_order)
     VALUES ('taya-house', 'Lunch', '11:30', '13:30', 30, 16, 20), ('taya-house', 'Dinner', '18:00', '21:00', 30, 16, 40)`,
  );
  await pool.query(`UPDATE restaurants SET booking_enabled = true, window_days = NULL, lead_minutes = NULL, max_party = NULL, auto_confirm = NULL`);
  await pool.query(`UPDATE booking_settings SET window_days = 14, lead_minutes = 30, same_day_cutoff = NULL, max_party = 12, auto_confirm = false`);
}

describe.skipIf(!TEST_DATABASE_URL)('booking configuration (database)', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });
  afterAll(async () => {
    // The next files read the catalogue and the rules as seeded.
    await resetTaya();
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE reservations, reservation_events, closures, audit_log CASCADE');
    await resetTaya();
    await pool.query(`DELETE FROM staff_user WHERE id = 'staff-lan'`);
  });

  describe('service periods', () => {
    it('an Editor shortens dinner and halves its capacity: the very next read has the new slots, and the audit row both lists', async () => {
      const before = await periodsOf();
      const input = asInput(before).map((p) => (p.meal === 'Dinner' ? { ...p, lastSeating: '20:00', coversPerSlot: 8 } : p));
      expect(await saveServicePeriods(pool, ACTOR, { restaurantId: 'taya-house', token: await token(), periods: input })).toEqual({ ok: true, data: null });
      expect(await dinnerTimes()).toEqual(['18:00/8', '18:30/8', '19:00/8', '19:30/8', '20:00/8']);
      const [row] = await audit();
      expect(row).toMatchObject({ actor_id: ACTOR.id, action: 'update', entity_type: 'service_periods', entity_id: 'taya-house' });
      expect(row.before.find((p: { meal: string }) => p.meal === 'Dinner')).toMatchObject({ lastSeating: '21:00', coversPerSlot: 16 });
      expect(row.after.find((p: { meal: string }) => p.meal === 'Dinner')).toMatchObject({ lastSeating: '20:00', coversPerSlot: 8 });
    });

    it('adds, removes and switches off periods in one save; the list keeps its order', async () => {
      const lunchOnly = asInput(await periodsOf()).filter((p) => p.meal === 'Lunch');
      const breakfast: PeriodInput = { id: null, meal: 'Breakfast', weekdays: [6, 7], firstSeating: '07:00', lastSeating: '09:00', intervalMin: 60, coversPerSlot: 10, active: true };
      const drinks: PeriodInput = { id: null, meal: 'Drinks', weekdays: [5], firstSeating: '20:00', lastSeating: '22:00', intervalMin: 60, coversPerSlot: 30, active: false };
      expect(await saveServicePeriods(pool, ACTOR, { restaurantId: 'taya-house', token: await token(), periods: [breakfast, ...lunchOnly, drinks] })).toMatchObject({ ok: true });
      expect((await periodsOf()).map((p) => [p.meal, p.weekdays, p.active, p.sortOrder])).toEqual([
        ['Breakfast', [6, 7], true, 10],
        ['Lunch', [1, 2, 3, 4, 5, 6, 7], true, 20],
        ['Drinks', [5], false, 30],
      ]);
      // The guest's rules see the active ones only.
      expect((await loadRestaurantRules(pool, 'taya-house', 'en', '2026-10-05'))!.rules.periods.map((p) => p.meal)).toEqual(['Breakfast', 'Lunch']);
    });

    it('a page saved from a stale token is a conflict naming who saved, and when', async () => {
      await pool.query(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ('staff-lan', 'Lan', 'lan@furama.test', true, 'editor')`);
      const stale = await token();
      const input = asInput(await periodsOf());
      expect(await saveServicePeriods(pool, ACTOR, { restaurantId: 'taya-house', token: stale, periods: input })).toMatchObject({ ok: true });
      const second = await saveServicePeriods(pool, ACTOR, { restaurantId: 'taya-house', token: stale, periods: input });
      expect(second).toMatchObject({ ok: false, code: 'conflict', params: { by: 'Lan' } });
      expect((second as { params: { at: string } }).params.at).toMatch(/^\d{2}:\d{2} \d{2}\/\d{2}\/\d{4}$/);
      // The rules form shares the token: a period save makes its page stale too.
      expect(await saveRestaurantRules(pool, ACTOR, { restaurantId: 'taya-house', token: stale, bookingEnabled: true, windowDays: null, leadMinutes: null, maxParty: null })).toMatchObject({
        ok: false,
        code: 'conflict',
      });
      expect(await audit()).toHaveLength(1);
      expect(await saveServicePeriods(pool, ACTOR, { restaurantId: 'nowhere', token: stale, periods: input })).toEqual({ ok: false, code: 'not_found' });
    });

    it('refuses two services that share a time on a shared weekday (capacity is per time)', async () => {
      const base: Omit<PeriodInput, 'meal' | 'firstSeating' | 'lastSeating'> = { id: null, weekdays: [1, 2, 3], intervalMin: 60, coversPerSlot: 10, active: true };
      const dinner = { ...base, meal: 'Dinner' as const, firstSeating: '18:00', lastSeating: '21:00' };
      const drinks = { ...base, meal: 'Drinks' as const, firstSeating: '21:00', lastSeating: '23:00' };
      expect(overlappingPeriods([dinner, drinks])).toBe('Dinner và Drinks cùng có giờ 21:00.');
      expect(overlappingPeriods([dinner, { ...drinks, weekdays: [4, 5] }])).toBeNull();
      expect(overlappingPeriods([dinner, { ...drinks, active: false }])).toBeNull();
      expect(await saveServicePeriods(pool, ACTOR, { restaurantId: 'taya-house', token: await token(), periods: [dinner, drinks] })).toEqual({
        ok: false,
        code: 'invalid',
        fieldErrors: { periods: ['Hai ca trùng giờ: Dinner và Drinks cùng có giờ 21:00.'] },
      });
    });
  });

  describe('affected bookings (rules)', () => {
    it('lists the upcoming bookings the new hours leave out, and cancels none of them', async () => {
      const late = await seed({ time: '21:00' });
      const lateRequest = await seed({ time: '21:00', status: 'requested' });
      const fine = await seed({ time: '19:00' });
      await seed({ time: '21:00', status: 'cancelled' });
      await seed({ time: '21:00', status: 'seated' });
      await seed({ time: '21:00', date: '2026-10-01' }); // already past
      const input = asInput(await periodsOf()).map((p) => (p.meal === 'Dinner' ? { ...p, lastSeating: '20:00' } : p));
      await saveServicePeriods(pool, ACTOR, { restaurantId: 'taya-house', token: await token(), periods: input });
      const affected = await findAffected(pool, { restaurantIds: ['taya-house'], now: NOW });
      expect(affected.map((a) => [a.id, a.kind])).toEqual([
        [late, 'outside_hours'],
        [lateRequest, 'outside_hours'],
      ]);
      expect(affected[0]).toMatchObject({ restaurantName: 'Tàya House', date: '2026-10-05', time: '21:00', status: 'confirmed', version: 1 });
      const { rows } = await pool.query(`SELECT status FROM reservations WHERE id = ANY ($1::bigint[]) ORDER BY id`, [[late, lateRequest, fine]]);
      expect(rows.map((x) => x.status)).toEqual(['confirmed', 'requested', 'confirmed']);
    });

    it('lists the bookings of a slot that now holds more covers than its new capacity', async () => {
      const a = await seed({ guests: 6 });
      const b = await seed({ guests: 4, status: 'requested' });
      await seed({ guests: 3, status: 'seated' }); // holds covers, but is the service's to settle
      const input = asInput(await periodsOf()).map((p) => (p.meal === 'Dinner' ? { ...p, coversPerSlot: 8 } : p));
      await saveServicePeriods(pool, ACTOR, { restaurantId: 'taya-house', token: await token(), periods: input });
      expect((await findAffected(pool, { now: NOW })).map((x) => [x.id, x.kind])).toEqual([
        [a, 'over_capacity'],
        [b, 'over_capacity'],
      ]);
    });

    it('lists the bookings a closure takes out, with the closure that does it', async () => {
      const dinner = await seed({ time: '19:00' });
      await seed({ time: '12:00' });
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO closures (scope, restaurant_id, starts_on, ends_on, meals) VALUES ('restaurant', 'taya-house', '2026-10-05', '2026-10-05', '{Dinner}') RETURNING id::text`,
      );
      expect((await findAffected(pool, { restaurantIds: ['taya-house'], now: NOW })).map((x) => [x.id, x.kind, x.closureId])).toEqual([[dinner, 'closed', rows[0].id]]);
    });
  });

  describe('rules', () => {
    it('saves the switch and the overrides (null follows the defaults), with an audit row', async () => {
      const r = await getRestaurantBooking(pool, 'taya-house');
      expect(r).toMatchObject({ bookingEnabled: true, windowDays: null, leadMinutes: null, maxParty: null, autoConfirm: null });
      expect(await saveRestaurantRules(pool, ACTOR, { restaurantId: 'taya-house', token: r!.token, bookingEnabled: false, windowDays: null, leadMinutes: 60, maxParty: 8 })).toEqual({
        ok: true,
        data: null,
      });
      expect(await getRestaurantBooking(pool, 'taya-house')).toMatchObject({ bookingEnabled: false, windowDays: null, leadMinutes: 60, maxParty: 8 });
      // The guest's rules: max_party 8, lead 60, the window still the default 14, online booking off.
      expect((await loadRestaurantRules(pool, 'taya-house', 'en', '2026-10-05'))!.rules).toMatchObject({ bookingEnabled: false, maxParty: 8, leadMinutes: 60, windowDays: 14 });
      expect((await audit()).map((a) => [a.entity_type, a.entity_id, a.before, a.after])).toEqual([
        [
          'restaurant_booking',
          'taya-house',
          { booking_enabled: true, window_days: null, lead_minutes: null, max_party: null },
          { booking_enabled: false, window_days: null, lead_minutes: 60, max_party: 8 },
        ],
      ]);
    });
  });

  describe('settings and auto-confirm (Admin)', () => {
    it('saves the defaults every restaurant inherits, with a token and a settings audit row', async () => {
      const s = await getBookingSettings(pool);
      expect(s).toMatchObject({ windowDays: 14, leadMinutes: 30, sameDayCutoff: null, maxParty: 12, autoConfirm: false, guestAckEmail: true, piiRetentionMonths: 24 });
      expect(await saveBookingSettings(pool, ACTOR, { ...s, maxParty: 8, sameDayCutoff: '17:00' })).toEqual({ ok: true, data: null });
      expect(await getBookingSettings(pool)).toMatchObject({ maxParty: 8, sameDayCutoff: '17:00' });
      // Every restaurant without its own override now takes parties of up to 8, and closes today at 17:00.
      expect((await loadRestaurantRules(pool, 'danaksara', 'en', '2026-10-05'))!.rules).toMatchObject({ maxParty: 8, sameDayCutoff: '17:00' });
      expect(await saveBookingSettings(pool, ACTOR, s)).toMatchObject({ ok: false, code: 'conflict' });
      const [row] = await audit();
      expect(row).toMatchObject({ action: 'settings', entity_type: 'booking_settings', entity_id: null });
      expect(row.after).toMatchObject({ maxParty: 8, sameDayCutoff: '17:00' });
      expect(row.after).not.toHaveProperty('token');
    });

    it('auto-confirm per restaurant: a guest’s booking there is confirmed at once', async () => {
      const r = await getRestaurantBooking(pool, 'danaksara');
      expect(await saveAutoConfirm(pool, ACTOR, { restaurantId: 'danaksara', token: 'stale', autoConfirm: true })).toMatchObject({ ok: false, code: 'conflict' });
      expect(await saveAutoConfirm(pool, ACTOR, { restaurantId: 'danaksara', token: r!.token, autoConfirm: true })).toEqual({ ok: true, data: null });
      expect(await getRestaurantBooking(pool, 'danaksara')).toMatchObject({ autoConfirm: true });
      const parsed = parseReservationInput({ restaurant: 'danaksara', date: '2026-10-05', time: '19:00', guests: 2, name: 'Khách Web', phone: '0905 444 555', email: '', note: '', locale: 'en' });
      if (!parsed.ok) throw new Error(parsed.code);
      expect(await createWebReservation(parsed.value, { now: NOW, pool })).toMatchObject({ ok: true, status: 'confirmed' });
      // Elsewhere the default (off) still holds.
      const other = parseReservationInput({ restaurant: 'don-ciprianis', date: '2026-10-05', time: '19:00', guests: 2, name: 'Khách Web', phone: '0905 444 555', email: '', note: '', locale: 'en' });
      if (!other.ok) throw new Error(other.code);
      expect(await createWebReservation(other.value, { now: NOW, pool })).toMatchObject({ ok: true, status: 'requested' });
      expect((await audit()).map((a) => [a.entity_type, a.entity_id, a.before, a.after])).toEqual([
        ['restaurant_booking', 'danaksara', { auto_confirm: null }, { auto_confirm: true }],
      ]);
    });
  });

  describe('closures', () => {
    const closure = (over: Partial<ClosureInput> = {}): ClosureInput => ({
      scope: 'restaurant',
      destinationId: null,
      restaurantId: 'taya-house',
      startsOn: '2026-10-05',
      endsOn: '2026-10-06',
      meals: null,
      showReason: true,
      publicReason: { en: 'Private event', vi: 'Sự kiện riêng' },
      internalNote: 'Tiệc cưới',
      ...over,
    });
    const idOf = (result: unknown) => (result as { data: { id: string } }).data.id;

    it('creates, reads back with its reasons, updates and deletes, each with an audit row', async () => {
      const id = idOf(await createClosure(pool, ACTOR, closure()));
      let [view] = await listClosures(pool, '2026-10-02');
      expect(view).toMatchObject({
        id,
        scope: 'restaurant',
        restaurantId: 'taya-house',
        startsOn: '2026-10-05',
        endsOn: '2026-10-06',
        meals: null,
        showReason: true,
        publicReason: { en: 'Private event', vi: 'Sự kiện riêng' },
        internalNote: 'Tiệc cưới',
      });
      // A typed reason is reviewed, by a human (spec §5.1.4); the guest reads it in their language.
      expect((await pool.query(`SELECT locale, status, origin, reviewed_by FROM closure_i18n WHERE closure_id = $1 ORDER BY locale`, [id])).rows).toEqual([
        { locale: 'en', status: 'reviewed', origin: 'human', reviewed_by: ACTOR.id },
        { locale: 'vi', status: 'reviewed', origin: 'human', reviewed_by: ACTOR.id },
      ]);
      expect(await updateClosure(pool, ACTOR, { ...closure({ meals: ['Dinner'], publicReason: { en: 'Closed for dinner' } }), id, token: view.token })).toEqual({
        ok: true,
        data: null,
      });
      [view] = await listClosures(pool, '2026-10-02');
      expect(view).toMatchObject({ meals: ['Dinner'], publicReason: { en: 'Closed for dinner' } });
      expect(await updateClosure(pool, ACTOR, { ...closure(), id, token: 'stale' })).toMatchObject({ ok: false, code: 'conflict' });
      expect(await deleteClosure(pool, ACTOR, { id, token: 'stale' })).toMatchObject({ ok: false, code: 'conflict' });
      expect(await deleteClosure(pool, ACTOR, { id, token: view.token })).toEqual({ ok: true, data: null });
      expect(await deleteClosure(pool, ACTOR, { id, token: view.token })).toEqual({ ok: false, code: 'not_found' });
      expect(await listClosures(pool, '2026-10-02')).toEqual([]);
      expect((await audit()).map((a) => `${a.action}:${a.entity_type}:${a.entity_id === id}`)).toEqual([
        'create:closure:true',
        'update:closure:true',
        'delete:closure:true',
      ]);
      // A closure that ended before `from` is not listed.
      await createClosure(pool, ACTOR, closure({ startsOn: '2026-09-20', endsOn: '2026-09-21' }));
      expect(await listClosures(pool, '2026-10-02')).toEqual([]);
    });

    it('lists exactly the bookings a closure covers: its scope, both end dates, its meals', async () => {
      const dinner5 = await seed({ date: '2026-10-05', time: '19:00' });
      const lunch5 = await seed({ date: '2026-10-05', time: '12:00' });
      const dinner7 = await seed({ date: '2026-10-07', time: '19:00' });
      const elsewhere = await seed({ date: '2026-10-05', time: '19:00', restaurant: 'pho-cuon' });
      const dinner8 = await seed({ date: '2026-10-08', time: '19:00' });

      const meal = idOf(await createClosure(pool, ACTOR, closure({ meals: ['Dinner'] })));
      expect((await findAffected(pool, { closureId: meal, now: NOW })).map((a) => a.id)).toEqual([dinner5]);

      // The resort: Tàya House is there, Phố Cuốn (the Dining House) is not; the 7th is the last day.
      const resort = idOf(await createClosure(pool, ACTOR, closure({ scope: 'destination', destinationId: 'resort', restaurantId: null, endsOn: '2026-10-07' })));
      const covered = await findAffected(pool, { closureId: resort, now: NOW });
      expect(covered.map((a) => a.id)).toEqual([lunch5, dinner5, dinner7]);
      expect(covered.every((a) => a.kind === 'closed' && a.closureId === resort)).toBe(true);
      expect(covered.map((a) => a.id)).not.toContain(elsewhere);
      expect(covered.map((a) => a.id)).not.toContain(dinner8);
      // Dinner on the 5th is under both closures, so both lists show it.
      expect((await findAffected(pool, { closureId: meal, now: NOW })).map((a) => a.id)).toEqual([dinner5]);

      const all = idOf(await createClosure(pool, ACTOR, closure({ scope: 'all', restaurantId: null, startsOn: '2026-10-05', endsOn: '2026-10-05' })));
      expect((await findAffected(pool, { closureId: all, now: NOW })).map((a) => a.id).sort()).toEqual([dinner5, lunch5, elsewhere].sort());

      expect(await restaurantsInScope(pool, { scope: 'destination', destinationId: 'resort', restaurantId: null })).toEqual(
        expect.arrayContaining(['taya-house', 'cafe-indochine', 'hai-van-lounge']),
      );
      expect(await restaurantsInScope(pool, { scope: 'restaurant', destinationId: null, restaurantId: 'pho-cuon' })).toEqual(['pho-cuon']);
      expect(await restaurantsInScope(pool, { scope: 'all', destinationId: null, restaurantId: null })).toHaveLength(12);
      // Listed, never cancelled.
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM reservations WHERE status = 'confirmed'`);
      expect(rows[0].n).toBe(5);
    });

    it('never lists cancelled, declined, seated or no-show bookings, nor a sitting that has started', async () => {
      const requested = await seed({ date: '2026-10-02', time: '19:00', status: 'requested' });
      for (const status of ['cancelled', 'declined', 'seated', 'no_show']) await seed({ date: '2026-10-02', time: '19:00', status });
      await seed({ date: '2026-10-02', time: '12:00' }); // 12:00 has started at 13:00
      const id = idOf(await createClosure(pool, ACTOR, closure({ startsOn: '2026-10-02', endsOn: '2026-10-02' })));
      expect((await findAffected(pool, { closureId: id, now: new Date('2026-10-02T13:00:00+07:00') })).map((a) => a.id)).toEqual([requested]);
    });
  });
});
