import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/availability/route';
import { getPool } from '@/db/client';
import type { CalendarResponse, DayResponse } from '@/lib/booking/api';

/* GET /api/availability v2 (spec §10.2; the contract is ruling R4 of the phase-4 plan). */

const get = (query: string) => GET(new Request(`http://test/api/availability?${query}`));
const json = async (query: string) => (await get(query)).json();
const calendar = async (query: string) => (await json(query)) as CalendarResponse;
const day = async (query: string) => (await json(query)) as DayResponse;
const sql = (text: string, values: unknown[] = []) => getPool().query(text, values);

const book = (date: string, time: string, guests: number, status = 'requested', phone = '+84905000000') =>
  sql(
    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source, status)
     VALUES ('FC-' || substr(md5(random()::text), 1, 8), 'taya-house', $1, $2, 'Dinner', $3, 'An', '0905000000', $4, 'web', $5)`,
    [date, time, guests, phone, status],
  );

describe.skipIf(!process.env.TEST_DATABASE_URL)('GET /api/availability v2 (database)', () => {
  beforeEach(async () => {
    await sql('DELETE FROM reservations');
    await sql('DELETE FROM closures');
    await sql(`UPDATE locales SET is_enabled = false, serve_machine = false WHERE code = 'vi'`);
    await sql('UPDATE booking_settings SET window_days = 14, lead_minutes = 30, max_party = 12, same_day_cutoff = NULL');
    await sql('UPDATE restaurants SET booking_enabled = true, max_party = NULL, window_days = NULL, lead_minutes = NULL');
    // Restore the seeded Tàya dinner (a test below edits it).
    await sql(
      `UPDATE service_periods SET first_seating = '18:00', last_seating = '21:00', covers_per_slot = 16, active = true
        WHERE restaurant_id = 'taya-house' AND meal = 'Dinner'`,
    );
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T18:00:00Z')); // 01:00 on 2 Oct in Da Nang
  });
  afterEach(() => vi.useRealTimers());
  afterAll(() => getPool().end());

  describe('the calendar (?restaurant=&lang=[&from=&to=])', () => {
    it("covers the booking window from Da Nang's today, with the clock, the party limit and the number to call", async () => {
      const res = await get('restaurant=taya-house&lang=en');
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = (await res.json()) as CalendarResponse;
      expect(body).toMatchObject({
        restaurant: 'taya-house',
        today: '2026-10-02',
        now: '2026-10-01T18:00:00.000Z',
        maxParty: 12,
        groupPhone: { display: '+84 236 651 9999', tel: '+842366519999' },
      });
      expect(body.days).toHaveLength(14);
      expect(body.days[0]).toEqual({ date: '2026-10-02', state: 'open' });
      expect(body.days[13]).toEqual({ date: '2026-10-15', state: 'open' });
    });

    it('gives a destination without a phone the first number there is', async () => {
      expect((await calendar('restaurant=yum-food-village')).groupPhone).toEqual({ display: '+84 236 651 9999', tel: '+842366519999' });
      expect((await calendar('restaurant=the-fan')).groupPhone).toEqual({ display: '0859 555 759', tel: '+84859555759' });
    });

    it('greys out closed days with the reason in the guest’s language when that language is on', async () => {
      const { rows } = await sql(
        `INSERT INTO closures (scope, restaurant_id, starts_on, ends_on) VALUES ('restaurant', 'taya-house', '2026-10-04', '2026-10-05') RETURNING id`,
      );
      await sql(`INSERT INTO closure_i18n (closure_id, locale, public_reason) VALUES ($1, 'en', 'Private event'), ($1, 'vi', 'Sự kiện riêng')`, [rows[0].id]);
      expect((await calendar('restaurant=taya-house&from=2026-10-03&to=2026-10-06')).days).toEqual([
        { date: '2026-10-03', state: 'open' },
        { date: '2026-10-04', state: 'closed', reason: 'Private event' },
        { date: '2026-10-05', state: 'closed', reason: 'Private event' },
        { date: '2026-10-06', state: 'open' },
      ]);
      // vi is off for the site, and an invalid lang is ignored: English.
      expect((await calendar('restaurant=taya-house&from=2026-10-04&to=2026-10-04&lang=vi')).days[0].reason).toBe('Private event');
      expect((await calendar('restaurant=taya-house&from=2026-10-04&to=2026-10-04&lang=../etc')).days[0].reason).toBe('Private event');
      await sql(`UPDATE locales SET is_enabled = true WHERE code = 'vi'`);
      expect((await calendar('restaurant=taya-house&from=2026-10-04&to=2026-10-04&lang=vi')).days[0].reason).toBe('Sự kiện riêng');
      // show_reason off: closed, no reason.
      await sql('UPDATE closures SET show_reason = false');
      expect((await calendar('restaurant=taya-house&from=2026-10-04&to=2026-10-04')).days[0]).toEqual({ date: '2026-10-04', state: 'closed' });
    });

    it('says full when every sitting of a day is taken, and past once today’s sittings have closed', async () => {
      for (const t of ['11:30', '12:00', '12:30', '13:00', '13:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00']) {
        await book('2026-10-03', t, 16);
      }
      expect((await calendar('restaurant=taya-house&from=2026-10-03&to=2026-10-03')).days).toEqual([{ date: '2026-10-03', state: 'full' }]);
      vi.setSystemTime(new Date('2026-10-02T14:00:00Z')); // 21:00 in Da Nang
      expect((await calendar('restaurant=taya-house&from=2026-10-02&to=2026-10-02')).days).toEqual([{ date: '2026-10-02', state: 'past' }]);
    });

    it('follows a per-restaurant window and max party, and marks dates past the window outside', async () => {
      await sql(`UPDATE restaurants SET window_days = 3, max_party = 8 WHERE id = 'taya-house'`);
      const body = await calendar('restaurant=taya-house');
      expect(body.maxParty).toBe(8);
      expect(body.days.map((d) => d.state)).toEqual(['open', 'open', 'open']);
      expect((await calendar('restaurant=taya-house&from=2026-10-04&to=2026-10-05')).days[1]).toEqual({ date: '2026-10-05', state: 'outside' });
    });
  });

  describe('one day (?restaurant=&date=&lang=[&guests=])', () => {
    it('lists the services and slots with the covers left, the clock rules and the party limit', async () => {
      await book('2026-10-03', '19:00', 4);
      await book('2026-10-03', '19:00', 9, 'cancelled', '+84905000001');
      const body = await day('restaurant=taya-house&date=2026-10-03');
      expect(body).toMatchObject({
        restaurant: 'taya-house',
        today: '2026-10-02',
        now: '2026-10-01T18:00:00.000Z',
        date: '2026-10-03',
        state: 'open',
        maxParty: 12,
        leadMinutes: 30,
        sameDayCutoff: null,
      });
      expect(body.periods.map((p) => [p.meal, p.closed])).toEqual([
        ['Lunch', false],
        ['Dinner', false],
      ]);
      expect(body.periods[1].slots.slice(0, 3)).toEqual([
        { time: '18:00', left: 16, bookable: true },
        { time: '18:30', left: 16, bookable: true },
        { time: '19:00', left: 12, bookable: true },
      ]);
    });

    it('answers for the party asked about (one guest by default)', async () => {
      await book('2026-10-03', '19:00', 5);
      expect((await day('restaurant=taya-house&date=2026-10-03&guests=12')).periods[1].slots[2]).toEqual({
        time: '19:00', left: 11, bookable: false, block: 'full',
      });
      await sql(`UPDATE restaurants SET max_party = 8 WHERE id = 'taya-house'`);
      expect((await day('restaurant=taya-house&date=2026-10-03&guests=9')).state).toBe('too_large');
    });

    it('marks today’s sittings inside the lead time, and today’s sittings after the cut-off', async () => {
      vi.setSystemTime(new Date('2026-10-02T12:00:00Z')); // 19:00 in Da Nang
      const slots = (await day('restaurant=taya-house&date=2026-10-02')).periods[1].slots;
      expect(slots.find((s) => s.time === '19:30')).toEqual({ time: '19:30', left: 16, bookable: false, block: 'lead' });
      expect(slots.find((s) => s.time === '20:00')).toEqual({ time: '20:00', left: 16, bookable: true });
      await sql(`UPDATE booking_settings SET same_day_cutoff = '18:00'`);
      const cut = await day('restaurant=taya-house&date=2026-10-02');
      expect(cut).toMatchObject({ state: 'past', sameDayCutoff: '18:00' });
      expect(cut.periods[1].slots.find((s) => s.time === '20:00')).toEqual({ time: '20:00', left: 16, bookable: false, block: 'cutoff' });
    });

    it('shows an Editor’s new dinner hours and covers on the very next request', async () => {
      const before = await day('restaurant=taya-house&date=2026-10-03');
      expect(before.periods[1].slots.map((s) => s.time)).toEqual(['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00']);
      await sql(
        `UPDATE service_periods SET first_seating = '17:30', last_seating = '22:00', covers_per_slot = 20
          WHERE restaurant_id = 'taya-house' AND meal = 'Dinner'`,
      );
      const after = await day('restaurant=taya-house&date=2026-10-03');
      expect(after.periods[1].slots.map((s) => s.time)).toEqual([
        '17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00',
      ]);
      expect(after.periods[1].slots[0]).toEqual({ time: '17:30', left: 20, bookable: true });
    });

    it('keeps a closed meal’s heading and reason, with no slots', async () => {
      const { rows } = await sql(
        `INSERT INTO closures (scope, destination_id, starts_on, ends_on, meals) VALUES ('destination', 'resort', '2026-10-03', '2026-10-03', '{Dinner}') RETURNING id`,
      );
      await sql(`INSERT INTO closure_i18n (closure_id, locale, public_reason) VALUES ($1, 'en', 'Wedding')`, [rows[0].id]);
      const body = await day('restaurant=taya-house&date=2026-10-03');
      expect(body.state).toBe('open');
      expect(body.periods[1]).toEqual({ meal: 'Dinner', closed: true, reason: 'Wedding', slots: [] });
    });

    it('answers a date outside the window with state outside, not an error', async () => {
      const res = await get('restaurant=taya-house&date=2026-10-01');
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ date: '2026-10-01', state: 'outside', periods: [] });
    });

    it('answers exactly the v2 fields, nothing of the phase-1 shape', async () => {
      expect(Object.keys(await json('restaurant=taya-house&date=2026-10-03')).sort()).toEqual(
        ['date', 'leadMinutes', 'maxParty', 'now', 'periods', 'restaurant', 'sameDayCutoff', 'state', 'today'],
      );
    });
  });

  it('answers 404 for an unknown restaurant and for one whose online booking is off', async () => {
    await sql(`UPDATE restaurants SET booking_enabled = false WHERE id = 'hai-van-lounge'`);
    for (const query of ['restaurant=nowhere', 'restaurant=hai-van-lounge', 'restaurant=hai-van-lounge&date=2026-10-03']) {
      const res = await get(query);
      expect(res.status).toBe(404);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ error: 'restaurant_unavailable' });
    }
  });

  it('L7-5: answers 404 for a restaurant guests cannot see (unpublished or archived), its booking switch on', async () => {
    for (const hide of ['is_published = false', 'archived_at = now()']) {
      await sql(`UPDATE restaurants SET ${hide} WHERE id = 'hai-van-lounge'`);
      for (const query of ['restaurant=hai-van-lounge', 'restaurant=hai-van-lounge&date=2026-10-03']) {
        const res = await get(query);
        expect(res.status, `${hide}: ${query}`).toBe(404);
        expect(await res.json()).toEqual({ error: 'restaurant_unavailable' });
      }
      await sql(`UPDATE restaurants SET is_published = true, archived_at = NULL WHERE id = 'hai-van-lounge'`);
    }
    expect((await get('restaurant=hai-van-lounge')).status).toBe(200);
  });

  it.each([
    ['date=2026-10-02', 'restaurant_required'],
    ['restaurant=taya-house&date=tomorrow', 'invalid_date'],
    ['restaurant=taya-house&date=2026-02-30', 'invalid_date'],
    ['restaurant=taya-house&from=soon', 'invalid_date'],
    ['restaurant=taya-house&from=2026-10-05&to=2026-10-04', 'invalid_range'],
    ['restaurant=taya-house&from=2026-10-01&to=2027-10-01', 'invalid_range'],
    ['restaurant=taya-house&date=2026-10-03&guests=0', 'invalid_guests'],
    ['restaurant=taya-house&date=2026-10-03&guests=two', 'invalid_guests'],
    ['restaurant=taya-house&date=2026-10-03&guests=51', 'invalid_guests'],
  ])('answers %j with 400 %s', async (query, error) => {
    const res = await get(query);
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ error });
  });

  // Phase-4 deferral T5: the cheap answers come first, so a stream of junk requests costs no database round trip.
  it.each([
    ['restaurant=taya-house&from=2026-10-05&to=2026-10-04', 400],
    ['restaurant=taya-house&from=2026-10-01&to=2027-10-01', 400],
    // A bad range is a 400 even for a restaurant that does not exist: the range is checked first.
    ['restaurant=nowhere&from=2026-10-01&to=2027-10-01', 400],
    [`restaurant=${'x'.repeat(65)}`, 404],
    ['restaurant=%3Cscript%3E', 404],
    ['restaurant=Taya-House', 404],
  ])('answers %j (%i) without touching the database', async (query, status) => {
    const spy = vi.spyOn(getPool(), 'query');
    try {
      expect((await get(query)).status).toBe(status);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
