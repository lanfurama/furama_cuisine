import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { submitReservation } from '@/app/actions';
import { getPool } from '@/db/client';

const request = {
  restaurant: 'taya-house',
  date: '2026-10-02',
  time: '19:00',
  guests: 2,
  name: 'Nguyễn Minh Anh',
  phone: '0905 000 000',
  email: '',
  note: '',
};

describe.skipIf(!process.env.TEST_DATABASE_URL)('submitReservation (database)', () => {
  beforeEach(async () => {
    await getPool().query('DELETE FROM reservations');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T18:00:00Z')); // 01:00 on 2 Oct in Da Nang, server on UTC
  });
  afterEach(() => vi.useRealTimers());
  afterAll(() => getPool().end());

  it('stores the date the guest picked, not the UTC server date', async () => {
    const result = await submitReservation(request);
    expect(result).toMatchObject({ ok: true, data: { date: '2026-10-02' } });
    const { rows } = await getPool().query('SELECT reserved_on::text AS day, phone_e164 FROM reservations');
    expect(rows).toEqual([{ day: '2026-10-02', phone_e164: '+84905000000' }]);
  });

  it('answers with codes, never English copy', async () => {
    expect(await submitReservation({ ...request, guests: 40 })).toEqual({ ok: false, code: 'party_too_large' });
    await submitReservation(request);
    expect(await submitReservation({ ...request, phone: '+84 905 000 000' })).toEqual({ ok: false, code: 'duplicate' });
  });

  it('still books a valid restaurant, logging the label instead of failing', async () => {
    const pool = getPool();
    const { rows } = await pool.query<{ cuisines: string[] }>(`SELECT cuisines FROM restaurants WHERE id = 'cafe-indochine'`);
    const original = rows[0].cuisines;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await pool.query(`UPDATE restaurants SET cuisines = $1 WHERE id = 'cafe-indochine'`, [[...original, 'Molecular']]);
      expect(await submitReservation(request)).toMatchObject({ ok: true });
      expect(log).toHaveBeenCalledWith('unknown_cuisine_label', 'Molecular');
    } finally {
      log.mockRestore();
      await pool.query(`UPDATE restaurants SET cuisines = $1 WHERE id = 'cafe-indochine'`, [original]);
    }
  });
});
