import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Vercel runs only the crons vercel.json lists, and no other gate reads the
 * file: a lost or mistyped entry would pass them all. The outbox drains every
 * five minutes (phase 5). The daily cron runs at 17:05 UTC, 00:05 in Da Nang,
 * so the day's offers, and with them the Offers nav item, change at the
 * venue's midnight instead of at the next hourly revalidation.
 */

type Cron = { path: string; schedule: string };

const crons = (): Cron[] => JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')).crons;

describe('the crons in vercel.json', () => {
  it('drain the outbox every five minutes and run the daily cron at 00:05 in Da Nang (17:05 UTC)', () => {
    expect(crons()).toEqual([
      { path: '/api/cron/outbox', schedule: '*/5 * * * *' },
      { path: '/api/cron/daily', schedule: '5 17 * * *' },
    ]);
  });

  it('each call a route that exists', () => {
    const missing = crons().filter(({ path }) => !existsSync(join(process.cwd(), 'app', ...path.split('/').filter(Boolean), 'route.ts')));
    expect(missing).toEqual([]);
  });
});
