import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Vercel runs only the crons vercel.json lists, and no other gate reads the
 * file: a lost or mistyped entry would pass them all. The outbox drains once
 * an hour, on the hour: Neon is on the Free plan, which suspends an idle
 * compute after 5 minutes, so a 5-minute cron would keep it awake around the
 * clock, past Free's monthly compute allowance (owner, 2026-10-05). The daily
 * cron runs at 17:05 UTC, 00:05 in Da Nang, so the day's offers, and with
 * them the Offers nav item, change at the venue's midnight instead of at the
 * next hourly revalidation. The media sweep (phase 7, spec §12) runs once a
 * day at 18:35 UTC, 01:35 in Da Nang: one more wake-up of the database a day.
 */

type Cron = { path: string; schedule: string };

const crons = (): Cron[] => JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')).crons;

describe('the crons in vercel.json', () => {
  it('drain the outbox hourly, run the daily cron at 00:05 in Da Nang (17:05 UTC) and sweep media at 01:35 (18:35 UTC)', () => {
    expect(crons()).toEqual([
      { path: '/api/cron/outbox', schedule: '0 * * * *' },
      { path: '/api/cron/daily', schedule: '5 17 * * *' },
      { path: '/api/cron/media-sweep', schedule: '35 18 * * *' },
    ]);
  });

  it('each call a route that exists', () => {
    const missing = crons().filter(({ path }) => !existsSync(join(process.cwd(), 'app', ...path.split('/').filter(Boolean), 'route.ts')));
    expect(missing).toEqual([]);
  });
});
