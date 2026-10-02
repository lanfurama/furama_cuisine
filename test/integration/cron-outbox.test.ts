import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/cron/outbox/route';
import { getPool } from '@/db/client';
import { cronAuthorized } from '@/lib/server/cron';

/* /api/cron/outbox (spec §10.4, §12): Vercel Cron's bearer secret or 401; with it, one drain of this env's due rows. */

const SECRET = 'cron-secret-0123456789abcdef';
const call = (authorization?: string) =>
  GET(new Request('http://localhost/api/cron/outbox', { headers: authorization ? { authorization } : {} }));
const sql = (text: string, values: unknown[] = []) => getPool().query(text, values);

/** One booking and three outbox rows: due in this env, due later, due in production. */
async function seed() {
  const { rows } = await sql(
    `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source)
     VALUES ('FC-CRON0001', 'taya-house', '2026-10-05', '19:00', 'Dinner', 2, 'G', '0905 000 000', '+84905000000', 'web') RETURNING id`,
  );
  await sql(
    `INSERT INTO email_outbox (env, event, audience, reservation_id, to_email, locale, next_attempt_at)
     VALUES ('development', 'staff.new', 'staff', $1, 'a@furama.test', 'vi', now()),
            ('development', 'staff.new', 'staff', $1, 'b@furama.test', 'vi', now() + interval '5 minutes'),
            ('production',  'staff.new', 'staff', $1, 'c@furama.test', 'vi', now())`,
    [rows[0].id],
  );
}

describe('cronAuthorized', () => {
  it('wants exactly "Bearer <CRON_SECRET>", and a secret of 16+ characters', () => {
    expect(cronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(cronAuthorized(SECRET, SECRET)).toBe(false);
    expect(cronAuthorized(`Bearer ${SECRET} `, SECRET)).toBe(false);
    expect(cronAuthorized(`bearer ${SECRET}`, SECRET)).toBe(false);
    expect(cronAuthorized(null, SECRET)).toBe(false);
    expect(cronAuthorized('Bearer undefined', undefined)).toBe(false);
    expect(cronAuthorized('Bearer ', '')).toBe(false);
    expect(cronAuthorized('Bearer short', 'short')).toBe(false);
    expect(cronAuthorized('Bearer 123456789012345', '123456789012345')).toBe(false);
    expect(cronAuthorized('Bearer 1234567890123456', '1234567890123456')).toBe(true);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('GET /api/cron/outbox (database)', () => {
  beforeEach(async () => {
    await sql('TRUNCATE reservations, reservation_events, email_outbox CASCADE');
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await sql('TRUNCATE reservations, reservation_events, email_outbox CASCADE');
    await getPool().end();
  });

  it('answers 401 without the secret, with a wrong one, and when CRON_SECRET is not set; sends nothing and says nothing more', async () => {
    await seed();
    vi.stubEnv('CRON_SECRET', SECRET);
    for (const header of [undefined, 'Bearer wrong-secret-0123456789', SECRET]) {
      const res = await call(header);
      expect(res.status).toBe(401);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ error: 'unauthorized' });
    }
    vi.stubEnv('CRON_SECRET', '');
    expect((await call('Bearer ')).status).toBe(401);
    expect((await sql(`SELECT status FROM email_outbox ORDER BY id`)).rows).toEqual([{ status: 'queued' }, { status: 'queued' }, { status: 'queued' }]);
  });

  it('with the secret, drains the due rows of its env and reports only the counts', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    vi.stubEnv('EMAIL_DELIVERY', 'log');
    await seed();
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ claimed: 1, sent: 1, skipped: 0, retried: 0, failed: 0, lost: 0 });
    expect((await sql(`SELECT to_email, status FROM email_outbox ORDER BY id`)).rows).toEqual([
      { to_email: 'a@furama.test', status: 'sent' },
      { to_email: 'b@furama.test', status: 'queued' },
      { to_email: 'c@furama.test', status: 'queued' },
    ]);
  });

  it('a drain that cannot run answers 500 with a code only', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    vi.stubEnv('EMAIL_DELIVERY', 'Live x');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await seed();
    // An unknown EMAIL_DELIVERY fails each send, not the drain: the row is retried later.
    expect(await (await call(`Bearer ${SECRET}`)).json()).toMatchObject({ claimed: 1, retried: 1 });
    await sql(`ALTER TABLE email_outbox RENAME TO email_outbox_gone`);
    try {
      const res = await call(`Bearer ${SECRET}`);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'drain_failed' });
      expect(errors).toHaveBeenCalledWith('[cron:outbox] drain failed code=42P01');
    } finally {
      await sql(`ALTER TABLE email_outbox_gone RENAME TO email_outbox`);
    }
  });
});
