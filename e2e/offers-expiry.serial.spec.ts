import type { Browser, Page } from '@playwright/test';
import { DETAIL_PATH, HOME_PATH } from './paths';
import { expect, one, test } from './staff-fixtures';

/*
 * Spec §6.2: an offer past its valid_until leaves the home page once the daily
 * cron (/api/cron/daily, 00:05 in Da Nang) expires content:offers, with no
 * deploy and no admin save. The date moves in the database instead of the
 * clock (the server's clock is the machine's). The cron revalidates with
 * 'max' (R7): the visit right after it may still get the cached page while the
 * page renders again behind it, so the offer is gone from the next visit on.
 *
 * It changes what every guest page reads (the offers, and through them the
 * nav: an Offers item with nothing to scroll to is left out on every page), so
 * it runs in the desktop-serial project, one file at a time, and it puts the
 * dates back and runs the cron again at its end (R21).
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

/** The desktop header's link to the Offers section (1280 px: the "Main" navigation). */
const offersLink = (page: Page) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Offers', exact: true });

/** Visits `path` until its header lists Offers `n` times (0 or 1): after the cron, each page's first visit may still get the cached copy ('max', R7). */
async function untilOffersLink(page: Page, path: string, n: 0 | 1) {
  await expect
    .poll(
      async () => {
        await page.goto(path);
        return offersLink(page).count();
      },
      { timeout: 15_000 },
    )
    .toBe(n);
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

/*
 * Spec §6.5: a nav item hides itself when its target section is hidden. With
 * no offer running today the home page leaves Offers out (homeSections), and
 * the header and the phone's menu follow the same answer on every page
 * (getSiteContent, navFor), instead of a link that scrolls to nothing on the
 * home page and lands on its top from anywhere else.
 */
test('with no offer running today, Offers leaves the header and the menu on every page', async ({ browser, request }) => {
  // Two pages each wait out a stale copy, twice (the cron, then the restore).
  test.setTimeout(90_000);
  const home = await guest(browser);
  const detail = await home.context().newPage();
  const restaurantsLink = (page: Page) =>
    page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Restaurants', exact: true });
  try {
    await home.goto(HOME_PATH);
    await expect(home.locator('#offers .offer')).toHaveCount(3);
    await expect(offersLink(home)).toHaveCount(1);

    // Every offer ended yesterday in Da Nang; the cron tells the cache.
    await one(`UPDATE offers SET valid_until = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 1 WHERE id IN (1, 2, 3)`);
    const res = await request.get(DAILY, bearer(process.env.CRON_SECRET));
    expect(res.status()).toBe(200);

    await expect
      .poll(
        async () => {
          await home.reload();
          return home.locator('#offers').count();
        },
        { timeout: 15_000 },
      )
      .toBe(0);
    // The same render's header: the other items stay, Offers is gone.
    await expect(restaurantsLink(home)).toBeVisible();
    await expect(offersLink(home)).toHaveCount(0);

    // The phone's menu lists the same items.
    await home.setViewportSize({ width: 390, height: 844 });
    await home.getByRole('button', { name: 'Open menu' }).click();
    const sections = home.getByRole('dialog', { name: 'Menu' }).getByRole('navigation', { name: 'Sections' });
    await expect(sections.getByRole('button', { name: 'Restaurants', exact: true })).toBeVisible();
    await expect(sections.getByRole('button', { name: 'Offers', exact: true })).toHaveCount(0);
    await home.getByRole('button', { name: 'Close menu' }).click();
    await home.setViewportSize({ width: 1280, height: 860 });

    // A restaurant page reads the same answer: stale once after the cron, then without Offers.
    await untilOffersLink(detail, DETAIL_PATH, 0);
    await expect(restaurantsLink(detail)).toBeVisible();
  } finally {
    await one(`UPDATE offers SET valid_until = NULL WHERE id IN (1, 2, 3)`);
    await request.get(DAILY, bearer(process.env.CRON_SECRET));
    try {
      // The specs after this one see the offers and their nav item again; the visits put the restored copies on disk.
      await home.setViewportSize({ width: 1280, height: 860 });
      await untilOffers(home, 3);
      await untilOffersLink(home, HOME_PATH, 1);
      await untilOffersLink(detail, DETAIL_PATH, 1);
    } finally {
      await home.context().close();
    }
  }
});
