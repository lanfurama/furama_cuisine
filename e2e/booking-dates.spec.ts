import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

test('the home page hydrates without React errors', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(problems.filter((p) => /hydrat|#418|#423|#425/i.test(p))).toEqual([]);
});

test.describe('a guest whose phone is set to Honolulu time', () => {
  test.use({ timezoneId: 'Pacific/Honolulu' });

  test('sees Da Nang dates in the reserve drawer', async ({ page }) => {
    // 18:00 UTC on 1 Oct: still 1 Oct in Honolulu (08:00), already 2 Oct in Da Nang (01:00).
    await page.clock.setFixedTime(new Date('2026-10-01T18:00:00Z'));
    await page.route('**/api/availability**', (route) =>
      route.fulfill({
        json: { today: '2026-10-02', now: '2026-10-01T18:00:00.000Z', date: '2026-10-02', booked: {}, capacity: 16 },
      }),
    );

    await page.goto('/');
    await page.getByRole('button', { name: 'RESERVE', exact: true }).first().click();

    const first = page.locator('.daystrip .day').first();
    await expect(first.locator('.day-wd')).toHaveText('Today');
    await expect(first.locator('.day-num')).toHaveText('2');
    await expect(first.locator('.day-mo')).toHaveText('Oct');
  });
});
