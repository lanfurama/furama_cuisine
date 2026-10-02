import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/availability/route';
import { getPool } from '@/db/client';

const get = (query: string) => GET(new Request(`http://test/api/availability?${query}`));

describe.skipIf(!process.env.TEST_DATABASE_URL)('GET /api/availability (database)', () => {
  beforeEach(async () => {
    await getPool().query('DELETE FROM reservations');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T18:00:00Z')); // 01:00 on 2 Oct in Da Nang
  });
  afterEach(() => vi.useRealTimers());
  afterAll(() => getPool().end());

  it("defaults to Da Nang's today and reports the server clock", async () => {
    const res = await get('restaurant=taya-house');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      today: '2026-10-02',
      now: '2026-10-01T18:00:00.000Z',
      date: '2026-10-02',
      booked: {},
      capacity: 16,
    });
  });

  it('sums the covers booked on the requested date', async () => {
    await getPool().query(
      `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source)
       VALUES ('FC-AAAAAAAA', 'taya-house', '2026-10-03', '19:00', 'Dinner', 4, 'An', '0905000000', '+84905000000', 'web')`,
    );
    const body = await (await get('restaurant=taya-house&date=2026-10-03')).json();
    expect(body.booked).toEqual({ '19:00': 4 });
  });

  it.each(['restaurant=taya-house&date=2026-10-01', 'restaurant=taya-house&date=2026-10-16', 'restaurant=taya-house&date=tomorrow', 'date=2026-10-02'])(
    'rejects %j with 400',
    async (query) => {
      expect((await get(query)).status).toBe(400);
    },
  );
});
