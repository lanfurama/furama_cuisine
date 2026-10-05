import type { Page } from '@playwright/test';
import { DETAIL_PATH, HOME_PATH } from './paths';
import { STAFF, expect, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * L7-18 (phase-6 ledger D2, plan 6 R15): a measurement, not a gate. Saves to
 * the hero, the offers and the stories expire every guest page (D2); this
 * counts what a guest browsing at the same time gets: client navigations
 * home ↔ Tàya House that end in a full page load (the RSC request answered
 * 404, `x-nextjs-postponed`, R15) instead of a soft one.
 *
 * Opt-in, like botid.spec.ts (it takes minutes and changes content while it
 * runs): RSC_RACE=1 <the E2E env prefix> npx playwright test e2e/rsc-race.spec.ts
 * --project=desktop --retries=0. RSC_RACE_SAVE_MS sets the pause between
 * saves (default 3000: an editor working fast), RSC_RACE_ROUNDS the round
 * trips (default 60). The result goes to the test's output and the phase-7
 * ledger.
 */

test.skip(process.env.RSC_RACE !== '1', 'a measurement: run with RSC_RACE=1');
test.setTimeout(15 * 60_000);

const SAVE_MS = Number(process.env.RSC_RACE_SAVE_MS ?? 3000);
const ROUNDS = Number(process.env.RSC_RACE_ROUNDS ?? 60);

test.beforeAll(() => seedStaff());

const OFFER = 'Afternoon Tea & Dessert Buffet';

/**
 * Saves that expire every guest page (D2), taken in turn: an offer hidden and
 * shown again (content:offers), and the hero's slide pace, 8 s then 7 s
 * (site_settings: content:contact, also on every page). Each save waits for
 * its answer; the pause is between saves.
 */
async function saveLoop(admin: Page, stop: () => boolean): Promise<number> {
  let saves = 0;
  const pace = async (seconds: string) => {
    await admin.goto('/admin/content/hero');
    const form = admin.getByRole('form', { name: 'Tốc độ slide' });
    await form.getByLabel('Thời gian mỗi slide (giây)', { exact: true }).fill(seconds);
    await form.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(form.getByRole('status')).toHaveText('Đã lưu. Trang khách cập nhật ngay.');
  };
  const offer = async (action: 'Ẩn' | 'Hiện') => {
    await admin.goto('/admin/content/offers');
    await admin.getByRole('button', { name: `${action} “${OFFER}”` }).click();
    await expect(admin.getByRole('button', { name: `${action === 'Ẩn' ? 'Hiện' : 'Ẩn'} “${OFFER}”` })).toBeVisible();
  };
  const steps = [() => offer('Ẩn'), () => pace('8'), () => offer('Hiện'), () => pace('7')];
  while (!stop() || saves % steps.length !== 0) {
    // A stopped loop finishes its round, so the offer is shown and the pace is 7 s again.
    await steps[saves % steps.length]();
    saves += 1;
    if (!stop()) await admin.waitForTimeout(SAVE_MS);
  }
  return saves;
}

test('R15 at real save rates: client navigations that end in a full load while the hero is saved', async ({ page, browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await signInAs(admin, STAFF.editor);
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  let rsc404 = 0;
  page.on('response', (res) => {
    if (res.url().includes('_rsc=') && res.status() === 404) rsc404 += 1;
  });
  await page.goto(HOME_PATH);
  await page.evaluate(() => ((window as Window & { softMark?: number }).softMark = 1));
  let done = false;
  const saving = saveLoop(admin, () => done);
  let hard = 0;
  let navigations = 0;
  try {
    for (let i = 0; i < ROUNDS; i++) {
      for (const go of [
        async () => {
          await page.locator('.rcard:visible', { hasText: 'Tàya House' }).first().click();
          await page.waitForURL((u) => u.pathname === DETAIL_PATH);
        },
        async () => {
          await page.locator('.taya-back:visible').click();
          await page.waitForURL((u) => u.pathname === HOME_PATH);
        },
      ]) {
        await go();
        navigations += 1;
        // A full load starts a new window: the mark is gone. Count it, then mark the new one.
        if (!(await page.evaluate(() => (window as Window & { softMark?: number }).softMark === 1))) {
          hard += 1;
          await page.evaluate(() => ((window as Window & { softMark?: number }).softMark = 1));
        }
      }
    }
  } finally {
    done = true;
  }
  const saves = await saving;
  console.log(`[rsc-race] ${navigations} navigations, ${saves} saves (every ${SAVE_MS} ms): ${hard} full loads, ${rsc404} RSC 404 answers`);
  await admin.context().close();
  test.info().annotations.push({ type: 'rsc-race', description: `${navigations} navigations, ${saves} saves every ${SAVE_MS} ms: ${hard} full loads, ${rsc404} RSC 404` });
});
