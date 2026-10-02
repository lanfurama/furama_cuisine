import { expect, test } from '@playwright/test';
import { mockAvailability } from './availability-mock';
import { serveImagesFromPublic } from './images';
import { DETAIL_PATH, HOME_PATH } from './paths';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

test.describe('hydration', () => {
  // The browser sits at UTC+14 and three days ahead of the server's build
  // time, so any date rendered during SSR would differ from the client's first
  // render and surface as a hydration error. UTC in both places would hide it.
  test.use({ timezoneId: 'Pacific/Kiritimati' });

  // networkidle also waits for the lazy images.
  test.beforeEach(({ page }) => serveImagesFromPublic(page));

  for (const [name, path] of [
    ['home', HOME_PATH],
    ['restaurant', DETAIL_PATH],
  ] as const) {
    test(`the ${name} page hydrates without React errors`, async ({ page }) => {
      const problems: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') problems.push(m.text());
      });
      page.on('pageerror', (e) => problems.push(e.message));
      await page.clock.setFixedTime(new Date(Date.now() + 3 * 86_400_000));
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(problems.filter((p) => /hydrat|#418|#423|#425/i.test(p))).toEqual([]);
    });
  }
});

test.describe('a guest whose phone is set to Honolulu time', () => {
  test.use({ timezoneId: 'Pacific/Honolulu' });

  test('sees Da Nang dates in the reserve drawer', async ({ page }) => {
    // 18:00 UTC on 1 Oct: still 1 Oct in Honolulu (08:00), already 2 Oct in Da Nang (01:00).
    await page.clock.setFixedTime(new Date('2026-10-01T18:00:00Z'));
    await mockAvailability(page, { today: () => '2026-10-02', now: () => '2026-10-01T18:00:00.000Z' });

    await page.goto(HOME_PATH);
    await page.getByRole('button', { name: 'RESERVE', exact: true }).first().click();

    const first = page.locator('.daystrip .day').first();
    await expect(first.locator('.day-wd')).toHaveText('Today');
    await expect(first.locator('.day-num')).toHaveText('2');
    await expect(first.locator('.day-mo')).toHaveText('Oct');
  });
});

test("a guest whose device clock is a day behind still books from Da Nang's today", async ({ page }) => {
  // 10:00 on 1 Oct in Da Nang: the browser thinks today is 1 Oct, the server says 2 Oct.
  await page.clock.setFixedTime(new Date('2026-10-01T03:00:00Z'));
  // The calendar comes first and starts at 2 Oct; a stray day request for 1 Oct would answer state 'outside', as the server does.
  await mockAvailability(page, { today: () => '2026-10-02', now: () => '2026-10-02T03:00:00.000Z' });

  await page.goto(HOME_PATH);
  await page.getByRole('button', { name: 'RESERVE', exact: true }).first().click();

  const first = page.locator('.daystrip .day').first();
  await expect(first.locator('.day-wd')).toHaveText('Today');
  await expect(first.locator('.day-num')).toHaveText('2');
  await expect(first.locator('.day-mo')).toHaveText('Oct');
  const selected = page.locator('.daystrip .day[aria-pressed="true"]');
  await expect(selected.locator('.day-num')).toHaveText('2');
  await expect(selected.locator('.day-mo')).toHaveText('Oct');
});

test('reopening the drawer the next day moves Today forward', async ({ page }) => {
  let serverNow = new Date('2026-10-01T03:00:00Z');
  let serverToday = '2026-10-01';
  await page.clock.setFixedTime(serverNow);
  await mockAvailability(page, { today: () => serverToday, now: () => serverNow.toISOString() });

  await page.goto(HOME_PATH);
  const reserve = page.getByRole('button', { name: 'RESERVE', exact: true }).first();
  await reserve.click();
  await expect(page.locator('.daystrip .day').first().locator('.day-num')).toHaveText('1');

  await page.keyboard.press('Escape');
  await expect(page.locator('.daystrip')).toHaveCount(0);
  serverNow = new Date('2026-10-02T03:00:00Z');
  serverToday = '2026-10-02';
  await page.clock.setFixedTime(serverNow);
  await reserve.click();

  await expect(page.locator('.daystrip .day').first().locator('.day-num')).toHaveText('2');
  await expect(page.locator('.daystrip .day[aria-pressed="true"] .day-num')).toHaveText('2');
});

test('submitting after the chosen sitting has closed explains why and moves the time', async ({ page }) => {
  // 10:00 in Da Nang; the drawer is opened, a 19:00 sitting chosen, then the clock
  // runs on to 18:45 while the guest fills in the form.
  let serverNow = new Date('2026-10-02T03:00:00Z');
  await page.clock.setFixedTime(serverNow);
  await mockAvailability(page, { today: () => '2026-10-02', now: () => serverNow.toISOString() });
  // The client gate must stop this; if it ever lets the request through, abort it.
  let reachedServer = false;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.headers()['next-action']) reachedServer = true;
  });
  await page.route('**/*', (route) =>
    route.request().method() === 'POST' && route.request().headers()['next-action']
      ? route.abort()
      : route.fallback(),
  );

  await page.goto(HOME_PATH);
  await page.getByRole('button', { name: 'RESERVE', exact: true }).first().click();
  await expect(page.locator('.daystrip')).toBeVisible();
  await page.locator('.slot', { hasText: '19:00' }).first().click();
  await page.getByLabel('Full name *').fill('Nguyễn Minh Anh');
  await page.getByLabel('Phone *').fill('0905 000 000');
  await page.getByRole('checkbox', { name: 'I agree to Furama Cuisine using my details as described in the privacy policy.' }).check();

  serverNow = new Date('2026-10-02T11:45:00Z');
  await page.clock.setFixedTime(serverNow);
  await page.getByRole('button', { name: 'REQUEST BOOKING' }).click();

  await expect(page.locator('.drawer-error[role="alert"]')).toHaveText(
    'That time can no longer be booked online — please choose a later time or another day.',
  );
  await expect(page.locator('.drawer-done')).toHaveCount(0);
  expect(reachedServer).toBe(false);
});
