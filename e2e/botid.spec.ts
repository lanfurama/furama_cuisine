import { HOME_PATH } from './paths';
import { expect, one, test } from './staff-fixtures';

/*
 * BotID's blocked path through a real server (spec §10.2 step 1). Off Vercel
 * nobody can judge a request, so this runs only when the server was started
 * with BOTID_DEV_BYPASS=BAD-BOT (lib/server/guard/bot.ts), which makes BotID's
 * own development bypass call every caller a bot. Every booking on that
 * server is refused, so it is a run of its own, never beside the other specs:
 *   BOTID_DEV_BYPASS=BAD-BOT <the E2E env prefix> npx playwright test e2e/botid.spec.ts --project=desktop
 */
test.skip(process.env.BOTID_DEV_BYPASS !== 'BAD-BOT', 'needs a server started with BOTID_DEV_BYPASS=BAD-BOT');
test.use({ reducedMotion: 'reduce' });

test('a request BotID calls a bot is refused with the number to call, and nothing is stored', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  await page.goto(HOME_PATH);
  await page.getByRole('button', { name: 'RESERVE', exact: true }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  await drawer.locator('.daystrip .day[data-state="open"]').last().click();
  await drawer.locator('.slot:not([disabled])').first().click();
  await drawer.getByLabel('Full name *', { exact: true }).fill('Nguyễn Minh Anh');
  const digits = String(Date.now()).slice(-6);
  await drawer.getByLabel('Phone *', { exact: true }).fill(`0907 ${digits.slice(0, 3)} ${digits.slice(3)}`);
  await drawer.getByRole('checkbox', { name: 'I agree to Furama Cuisine using my details as described in the privacy policy.' }).check();
  await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
  await expect(drawer.getByRole('alert')).toHaveText('We could not accept this request online. Please call us on +84 236 651 9999 to book.');
  expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM reservations WHERE phone_e164 = $1`, [`+84907${digits}`]))!.n).toBe(0);
});
