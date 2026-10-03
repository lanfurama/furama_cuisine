import type { Browser, Page } from '@playwright/test';
import { HOME_PATH } from './paths';
import { expect, one, test } from './staff-fixtures';

/*
 * Spec §6.2: an offer past its valid_until leaves the home page once the daily
 * cron (/api/cron/daily, 00:05 in Da Nang) expires content:offers, with no
 * deploy and no admin save. The date moves in the database instead of the
 * clock (the server's clock is the machine's). The cron revalidates with
 * 'max' (R7): the visit right after it may still get the cached page while the
 * page renders again behind it, so the offer is gone from the next visit on.
 *
 * It changes what every guest page reads (the offers), so it runs in the
 * desktop-serial project, one file at a time, and it puts the date back and
 * runs the cron again at its end (R21).
 */

const TEA = 'Afternoon Tea & Dessert Buffet';
const DAILY = '/api/cron/daily';
const bearer = (secret?: string): { headers: Record<string, string> } => ({ headers: secret ? { authorization: `Bearer ${secret}` } : {} });

/** A guest with no staff cookie, past the intro. */
async function guest(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

/** Reloads until the page shows `n` offers: with 'max', the first visit after the cron may still be the cached page. */
async function untilOffers(home: Page, n: number) {
  await expect
    .poll(
      async () => {
        await home.reload();
        return home.locator('#offers .offer').count();
      },
      { timeout: 15_000 },
    )
    .toBe(n);
}

test('an offer past its valid_until stays until the daily cron, which takes it off the home page', async ({ browser, request }) => {
  const home = await guest(browser);
  const offers = home.locator('#offers .offer');
  try {
    await home.goto(HOME_PATH);
    await expect(offers).toHaveCount(3);
    await expect(offers.filter({ hasText: TEA })).toHaveCount(1);

    // Yesterday in Da Nang: the offer has ended, but nothing has told the cache.
    await one(`UPDATE offers SET valid_until = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 1 WHERE id = 3`);
    await home.reload();
    await expect(offers).toHaveCount(3);

    // Spec §12: without its secret the cron is refused, and nothing changes.
    for (const secret of [undefined, 'not-the-secret-at-all']) {
      const refused = await request.get(DAILY, bearer(secret));
      expect(refused.status()).toBe(401);
      expect(refused.headers()['cache-control']).toBe('no-store');
    }
    await home.reload();
    await home.reload();
    await expect(offers).toHaveCount(3);

    const res = await request.get(DAILY, bearer(process.env.CRON_SECRET));
    expect(res.status()).toBe(200);
    expect(res.headers()['cache-control']).toBe('no-store');
    expect(await res.json()).toEqual({ revalidated: ['content:offers'] });

    await untilOffers(home, 2);
    await expect(offers.filter({ hasText: TEA })).toHaveCount(0);
    // Only the offers were read again: the rest of the page is still there.
    await expect(home.locator('.rcard')).toHaveCount(12);
  } finally {
    await one(`UPDATE offers SET valid_until = NULL WHERE id = 3`);
    await request.get(DAILY, bearer(process.env.CRON_SECRET));
    // The specs after this one see the three offers again.
    await untilOffers(home, 3);
    await home.context().close();
  }
});
