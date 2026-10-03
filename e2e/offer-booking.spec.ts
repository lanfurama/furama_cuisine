import { expect, test, type Locator, type Request } from '@playwright/test';
import { mockAvailability } from './availability-mock';
import { HOME_PATH } from './paths';

/*
 * Spec §14.1 row 6: the reservation form sends the offer it was opened from
 * (reservations.offer_id, a foreign key since migration 008), as a soft link
 * (R9): only while the chosen restaurant is the offer's. Every request is
 * captured and aborted, so nothing is written;
 * test/integration/submit-reservation.test.ts covers what the server keeps.
 */

const NOW = new Date('2026-10-02T03:00:00Z'); // 10:00 in Da Nang
const isServerAction = (r: Request) => r.method() === 'POST' && !!r.headers()['next-action'];
const CONSENT = 'I agree to Furama Cuisine using my details as described in the privacy policy.';

/** REQUEST BOOKING, and the arguments the aborted Server Action call carried. */
async function send(drawer: Locator, sent: string[]): Promise<Record<string, unknown>> {
  const before = sent.length;
  await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
  await expect.poll(() => sent.length).toBe(before + 1);
  const [args] = JSON.parse(sent[before]) as [Record<string, unknown>];
  return args;
}

test('VIEW OFFER books with the offer’s id while its restaurant is the one chosen, and without it otherwise', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  await page.clock.setFixedTime(NOW);
  await mockAvailability(page, { today: () => '2026-10-02', now: () => NOW.toISOString() });
  const sent: string[] = [];
  await page.route('**/*', (route) => {
    if (!isServerAction(route.request())) return route.fallback();
    sent.push(route.request().postData() ?? '');
    return route.abort();
  });
  await page.goto(HOME_PATH);

  await page.locator('#offers .offer', { hasText: 'Seafood & Steak Buffet Dinner' }).getByRole('button', { name: /VIEW OFFER/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.drawer-name')).toHaveText('Café Indochine');
  // The note still names the offer, as before phase 6 (a labelled textarea's name includes its value, so by role).
  await expect(drawer.getByRole('textbox', { name: /^Special requests/ })).toHaveValue('Offer: Seafood & Steak Buffet Dinner');
  await drawer.getByLabel('Full name *', { exact: true }).fill('Nguyễn Minh Anh');
  await drawer.getByLabel('Phone *', { exact: true }).fill('0905 000 000');
  await drawer.getByRole('checkbox', { name: CONSENT }).check();

  expect(await send(drawer, sent)).toMatchObject({ restaurant: 'cafe-indochine', offerId: 1, note: 'Offer: Seafood & Steak Buffet Dinner' });

  // Another restaurant: the offer is not its own, so the request goes without it.
  await drawer.getByRole('button', { name: /^restaurant/i }).click();
  await page.getByRole('listbox', { name: 'Restaurant' }).getByRole('option', { name: 'Don Cipriani’s' }).click();
  await expect(drawer.locator('.drawer-name')).toHaveText('Don Cipriani’s');
  const other = await send(drawer, sent);
  expect(other).toMatchObject({ restaurant: 'don-ciprianis' });
  expect(other).not.toHaveProperty('offerId');

  // Back to the offer's restaurant: the offer comes back with it.
  await drawer.getByRole('button', { name: /^restaurant/i }).click();
  await page.getByRole('listbox', { name: 'Restaurant' }).getByRole('option', { name: 'Café Indochine' }).click();
  await expect(drawer.locator('.drawer-name')).toHaveText('Café Indochine');
  expect(await send(drawer, sent)).toMatchObject({ restaurant: 'cafe-indochine', offerId: 1 });
});

test('a plain RESERVE sends no offer', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  await page.clock.setFixedTime(NOW);
  await mockAvailability(page, { today: () => '2026-10-02', now: () => NOW.toISOString() });
  const sent: string[] = [];
  await page.route('**/*', (route) => {
    if (!isServerAction(route.request())) return route.fallback();
    sent.push(route.request().postData() ?? '');
    return route.abort();
  });
  await page.goto(HOME_PATH);

  await page.getByRole('button', { name: 'RESERVE', exact: true }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.drawer-name')).toHaveText('Tàya House');
  await drawer.getByLabel('Full name *', { exact: true }).fill('Nguyễn Minh Anh');
  await drawer.getByLabel('Phone *', { exact: true }).fill('0905 000 000');
  await drawer.getByRole('checkbox', { name: CONSENT }).check();
  const args = await send(drawer, sent);
  expect(args).toMatchObject({ restaurant: 'taya-house', note: '' });
  expect(args).not.toHaveProperty('offerId');
});
