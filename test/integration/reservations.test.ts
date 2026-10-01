import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import { createReservation, type NewReservation } from '@/db/queries';

const booking = (over: Partial<NewReservation> = {}): NewReservation => ({
  restaurantId: 'taya-house',
  isoDate: '2026-10-05',
  time: '19:00',
  guests: 2,
  name: 'Nguyễn Minh Anh',
  phone: '0905 000 000',
  phoneE164: '+84905000000',
  ...over,
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('createReservation (database)', () => {
  beforeEach(async () => {
    await getPool().query('DELETE FROM reservations');
  });
  afterAll(() => getPool().end());

  it('stores the normalised phone next to what the guest typed', async () => {
    expect((await createReservation(booking())).ok).toBe(true);
    const { rows } = await getPool().query('SELECT phone, phone_e164 FROM reservations');
    expect(rows).toEqual([{ phone: '0905 000 000', phone_e164: '+84905000000' }]);
  });

  it('treats the same number written differently as a duplicate', async () => {
    await createReservation(booking());
    expect(await createReservation(booking({ phone: '+84 905 000 000' }))).toEqual({
      ok: false,
      reason: 'duplicate',
    });
  });

  it('lets only one of two simultaneous requests take the last seats', async () => {
    // Tàya House seats 16 per slot, so 10 + 10 cannot both fit.
    const [a, b] = await Promise.all([
      createReservation(booking({ guests: 10, phone: '0905 000 001', phoneE164: '+84905000001' })),
      createReservation(booking({ guests: 10, phone: '0905 000 002', phoneE164: '+84905000002' })),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)).toEqual({ ok: false, reason: 'full' });
  });

  it('draws a new reference when the first one is already taken', async () => {
    await createReservation(booking(), () => 'FC-AAAAAAAA');
    const queue = ['FC-AAAAAAAA', 'FC-BBBBBBBB'];
    const result = await createReservation(
      booking({ phone: '0905 000 003', phoneE164: '+84905000003' }),
      () => queue.shift() ?? 'FC-CCCCCCCC',
    );
    expect(result).toEqual({ ok: true, reference: 'FC-BBBBBBBB' });
  });

  it('gives up after three colliding references instead of looping forever', async () => {
    await createReservation(booking(), () => 'FC-AAAAAAAA');
    await expect(
      createReservation(booking({ phone: '0905 000 004', phoneE164: '+84905000004' }), () => 'FC-AAAAAAAA'),
    ).rejects.toThrow();
  });
});
