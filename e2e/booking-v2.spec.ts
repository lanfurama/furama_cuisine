import type { Locator, Page, Request, Route } from '@playwright/test';
import { addDays, formatDay, venueNow } from '../lib/venue-time';
import { GROUP_PHONE, mockAvailability, type MockDay, type MockOptions } from './availability-mock';
import { HOME_PATH } from './paths';
import { exclusive, expect, one, test } from './staff-fixtures';

/*
 * The guest form on server availability (spec §10.2, phase-4 acceptance
 * "closed days greyed out for guests" and "max_party = 8 blocks 9 guests").
 * The first tests pin the server with a mock; the last three go to the real
 * API and database (one() refuses any database but a local _test one).
 */

/* 10:00 on Friday 2 Oct in Da Nang. */
const NOW = new Date('2026-10-02T03:00:00Z');
const clock = { today: () => '2026-10-02', now: () => NOW.toISOString() };

test.use({ reducedMotion: 'reduce' }); // no reveal animation on the booking bar
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
});

/** The header's RESERVE (the full header's on a desktop, the compact one's on a phone). */
const reserveButton = (page: Page) => page.getByRole('button', { name: 'RESERVE', exact: true }).filter({ visible: true }).first();

async function openDrawer(page: Page, options: Partial<MockOptions> = {}) {
  await page.clock.setFixedTime(NOW);
  await mockAvailability(page, { ...clock, ...options });
  await page.goto(HOME_PATH);
  await reserveButton(page).click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  return drawer;
}

/**
 * The live messages inside `scope` that say something. The drawer keeps its
 * role="status" regions mounted while they are empty (so a screen reader
 * hears their first message), so an empty one is not a message.
 */
const said = (scope: Locator) => scope.getByRole('status').filter({ hasText: /\S/ });

const foot = (drawer: Locator) => drawer.locator('.drawer-foot');

/** The booking bar's dropdowns, in order: destination, restaurant, date, time, guests. */
const barField = (page: Page, i: number) => page.locator('#reserve .dd').nth(i);

test('a closed day is greyed out, cannot be chosen, and says why', async ({ page }) => {
  const drawer = await openDrawer(page, {
    days: {
      '2026-10-04': { state: 'closed', reason: 'Closed for a private event' },
      '2026-10-05': { state: 'closed' },
      '2026-10-06': { state: 'full' },
    },
  });

  const closed = drawer.getByRole('button', { name: 'Sun, 4 Oct: Closed for a private event' });
  await expect(closed).toHaveAttribute('aria-disabled', 'true');
  await expect(closed).toHaveAttribute('data-state', 'closed');
  await expect(closed.locator('.day-num')).toHaveCSS('text-decoration-line', 'line-through');

  // Playwright waits for aria-disabled elements to become enabled; a guest's tap still lands (it is not `disabled`).
  await closed.click({ force: true });
  await expect(closed).toHaveAttribute('aria-pressed', 'false');
  await expect(drawer.locator('.day[aria-pressed="true"] .day-num')).toHaveText('2');
  await expect(said(drawer)).toHaveText('Sun, 4 Oct: Closed for a private event');

  // Without a public reason, and when full, the generic words from the registry.
  await expect(drawer.getByRole('button', { name: 'Mon, 5 Oct: Closed' })).toHaveAttribute('aria-disabled', 'true');
  await expect(drawer.getByRole('button', { name: 'Tue, 6 Oct: Fully booked' })).toHaveAttribute('data-state', 'full');

  // An open day still selects.
  await drawer.locator('.day[data-state="open"]', { hasText: '7' }).click();
  await expect(drawer.locator('.day[aria-pressed="true"] .day-num')).toHaveText('7');
  await expect(said(drawer)).toHaveCount(0);

  // The booking bar's date list greys the same days and shows the reason on hover.
  await page.keyboard.press('Escape');
  await barField(page, 2).locator('.dd-trigger').click();
  const option = page.getByRole('option', { name: /Sun, 4 Oct/ });
  await expect(option).toHaveAttribute('aria-disabled', 'true');
  await expect(option).toHaveAttribute('title', 'Closed for a private event');
  await expect(option.locator('.dd-note')).toHaveText('Closed');
  await option.click({ force: true });
  await expect(barField(page, 2).locator('.dd-value-text')).toHaveText('Wed, 7 Oct');
});

test('a closure of one meal keeps the rest of the day bookable', async ({ page }) => {
  const drawer = await openDrawer(page, { mealClosures: { '2026-10-02': { Lunch: 'Staff training' } } });

  const lunch = drawer.locator('.slotgroup', { hasText: 'Lunch' });
  await expect(lunch.locator('.slotgroup-note')).toHaveText('Not available on this date.Staff training');
  await expect(lunch.locator('.slot')).toHaveCount(0);
  await expect(drawer.locator('.slotgroup', { hasText: 'Dinner' }).locator('.slot:not([disabled])')).toHaveCount(7);
});

test('the party limit comes from the server: max_party 8 blocks a ninth guest and says whom to call', async ({ page }) => {
  const drawer = await openDrawer(page, { maxParty: 8 });

  const more = drawer.getByRole('button', { name: 'More guests' });
  for (let i = 2; i < 8; i++) await more.click();
  await expect(drawer.locator('.guests-value')).toHaveText('8 guests');
  await expect(more).toBeDisabled();
  await expect(drawer.locator('.guests-hint')).toHaveText(
    `For more than 8 guests, please call us on ${GROUP_PHONE.display}.`,
  );
  await expect(drawer.locator('.guests-hint a')).toHaveAttribute('href', `tel:${GROUP_PHONE.tel}`);

  await drawer.getByRole('button', { name: 'Fewer guests' }).click();
  await expect(drawer.locator('.guests-hint')).toHaveCount(0);

  // The booking bar offers 1…8 and nothing above.
  await page.keyboard.press('Escape');
  await barField(page, 4).locator('.dd-trigger').click();
  const options = page.getByRole('listbox', { name: 'Guests' }).getByRole('option');
  await expect(options).toHaveCount(8);
  await expect(options.last()).toHaveText(/8 guests/);
});

test('the reason under the strip belongs to that calendar: another restaurant’s answer clears it', async ({ page }) => {
  const days: Record<string, MockDay> = { '2026-10-04': { state: 'closed', reason: 'Closed for a private event' } };
  const drawer = await openDrawer(page, { days });
  await drawer.getByRole('button', { name: 'Sun, 4 Oct: Closed for a private event' }).click({ force: true });
  await expect(said(drawer)).toHaveText('Sun, 4 Oct: Closed for a private event');

  // The next restaurant takes bookings that day (the mock reads `days` per request).
  delete days['2026-10-04'];
  await drawer.getByRole('button', { name: /^restaurant/i }).click();
  await page.getByRole('listbox', { name: 'Restaurant' }).getByRole('option', { name: 'Don Cipriani’s' }).click();
  await expect(drawer.locator('.daystrip .day[data-state="closed"]')).toHaveCount(0);
  await expect(said(drawer)).toHaveCount(0);
});

/** The chosen day's chip lies inside the strip's box: scrolled into view, not off either edge. */
async function expectChosenDayInView(drawer: Locator) {
  const strip = drawer.locator('.daystrip');
  const chosen = drawer.locator('.daystrip .day[aria-pressed="true"]');
  await expect
    .poll(async () => {
      const [s, c] = await Promise.all([strip.boundingBox(), chosen.boundingBox()]);
      return !!s && !!c && c.x >= s.x && c.x + c.width <= s.x + s.width && c.y >= s.y && c.y + c.height <= s.y + s.height;
    })
    .toBe(true);
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a switch to a restaurant that does not take the chosen day moves to the next open day, says why, and shows it', async ({ page }) => {
    // Mon 12 Oct (today + 10) is open at Tàya House and closed at Don Cipriani’s.
    const drawer = await openDrawer(page, {
      daysByRestaurant: { 'don-ciprianis': { '2026-10-12': { state: 'closed', reason: 'Closed on Mondays' } } },
    });
    await drawer.locator('.daystrip .day').nth(10).click();
    await expect(drawer.locator('.drawer-foot-summary')).toContainText('Mon, 12 Oct');

    await drawer.getByRole('button', { name: /^restaurant/i }).click();
    await page.getByRole('listbox', { name: 'Restaurant' }).getByRole('option', { name: 'Don Cipriani’s' }).click();
    await expect(drawer.locator('.drawer-name')).toHaveText('Don Cipriani’s');

    // The next open day after it, not today.
    await expect(drawer.locator('.drawer-foot-summary')).toContainText('Tue, 13 Oct');
    await expect(said(drawer)).toContainText('Closed on Mondays');
    await expect(said(drawer)).toContainText('Tue, 13 Oct');
    await expectChosenDayInView(drawer);
  });

  test('a restaurant closed for its first days opens on its first open day, in view', async ({ page }) => {
    const firstWeek = Object.fromEntries(
      ['02', '03', '04', '05', '06', '07', '08'].map((d) => [`2026-10-${d}`, { state: 'closed' as const }]),
    );
    const drawer = await openDrawer(page, { daysByRestaurant: { 'taya-house': firstWeek } });
    await expect(drawer.locator('.daystrip .day[aria-pressed="true"] .day-num')).toHaveText('9');
    await expectChosenDayInView(drawer);
  });
});

test('the details stop at the lengths the server accepts', async ({ page }) => {
  const drawer = await openDrawer(page);
  // lib/server/booking/input.ts refuses anything longer, with a message retrying cannot fix.
  await expect(drawer.getByLabel('Full name *', { exact: true })).toHaveAttribute('maxlength', '120');
  await expect(drawer.getByLabel('Phone *', { exact: true })).toHaveAttribute('maxlength', '40');
  await expect(drawer.getByLabel('Email', { exact: true })).toHaveAttribute('maxlength', '254');
  await expect(drawer.getByLabel('Special requests', { exact: true })).toHaveAttribute('maxlength', '1000');
});

/* Every booking failure names the number to call (spec §12); the mock's is the resort's. */
const NETWORK = `We could not reach the reservations desk. Please try again, or call us on ${GROUP_PHONE.display}.`;
const GONE = `This restaurant is not taking online bookings right now. Please call us on ${GROUP_PHONE.display}.`;

/** The number in a message, as a link that calls it. */
const telLink = (scope: Locator) => scope.getByRole('link', { name: GROUP_PHONE.display });

/** Puts a failing answer in front of the mock while `failing()` says so; registered last, it runs first. */
async function failAvailability(page: Page, failing: (url: URL) => boolean, answer: (route: Route) => Promise<void>) {
  await page.route('**/api/availability**', (route) =>
    failing(new URL(route.request().url())) ? answer(route) : route.fallback(),
  );
}

const isCalendar = (url: URL) => url.pathname === '/api/availability' && !url.searchParams.has('date');
const isServerAction = (r: Request) => r.method() === 'POST' && !!r.headers()['next-action'];

/** Counts the page's requests that match, from now on. */
function countRequests(page: Page, matches: (r: Request) => boolean) {
  const seen = { count: 0 };
  page.on('request', (r) => {
    if (matches(r)) seen.count += 1;
  });
  return seen;
}

/** Holds the matching availability requests until the returned function is called; registered last, it runs first. */
async function holdAvailability(page: Page, held: (url: URL) => boolean) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/availability**', async (route) => {
    if (held(new URL(route.request().url()))) await gate;
    await route.fallback().catch(() => {}); // the page may have closed meanwhile
  });
  return release;
}

/** Aborts every Server Action POST, so nothing is written whichever way the test goes, and counts them. */
async function abortServerActions(page: Page) {
  const posts = countRequests(page, isServerAction);
  await page.route('**/*', (route) => (isServerAction(route.request()) ? route.abort() : route.fallback()));
  return posts;
}

async function fillDetails(drawer: Locator) {
  await drawer.getByLabel('Full name *', { exact: true }).fill('Nguyễn Minh Anh');
  await drawer.getByLabel('Phone *', { exact: true }).fill('0905 000 000');
  await drawer.getByRole('checkbox', { name: 'I agree to Furama Cuisine using my details as described in the privacy policy.' }).check();
}

/** Whether the focus is inside the modal booking dialog: not on <body>, whose next Tab reaches the page behind it. */
const focusInDialog = (page: Page) =>
  page.evaluate(() => !!document.activeElement?.closest('[role="dialog"][aria-modal="true"]'));

test('when the dates cannot load, the guest is told once: REQUEST BOOKING points at Try again, which recovers and keeps the focus in the dialog', async ({ page }) => {
  let failing = true;
  await page.clock.setFixedTime(NOW);
  await mockAvailability(page, clock);
  await failAvailability(page, () => failing, (route) => route.fulfill({ status: 503, json: { error: 'unavailable' } }));
  await page.goto(HOME_PATH);
  await reserveButton(page).click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });

  // In place of an empty strip, with the number to call.
  await expect(drawer.getByRole('alert')).toHaveText(NETWORK);
  await expect(telLink(drawer.getByRole('alert'))).toHaveAttribute('href', `tel:${GROUP_PHONE.tel}`);
  await expect(drawer.locator('.daystrip')).toHaveCount(0);

  // Valid details and no date to book: the button answers by taking the guest to the one way
  // forward, the Try again under the message, rather than repeating the message in the footer.
  await fillDetails(drawer);
  await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
  const retry = drawer.getByRole('button', { name: 'Try again' });
  await expect(retry).toBeFocused();
  await expect(retry).toHaveAccessibleDescription(NETWORK);
  await expect(drawer.getByRole('alert')).toHaveCount(1);
  await expect(foot(drawer).getByRole('alert')).toHaveCount(0);

  failing = false;
  await retry.click();
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  await expect(drawer.locator('.day[aria-pressed="true"] .day-num')).toHaveText('2');
  await expect(drawer.locator('.slot:not([disabled])')).toHaveCount(12);
  await expect(retry).toHaveCount(0);
  await expect(drawer.getByRole('alert')).toHaveCount(0);
  // The button that had the focus is gone: the focus moves to the chosen day, not to <body> behind the modal.
  await expect(drawer.locator('.day[aria-pressed="true"]')).toBeFocused();
});

test('when the dates cannot load, the booking bar says so too', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await mockAvailability(page, clock);
  await failAvailability(page, isCalendar, (route) => route.fulfill({ status: 503, json: { error: 'unavailable' } }));
  await page.goto(HOME_PATH);
  await expect(said(page.locator('#reserve'))).toHaveText(NETWORK);
});

test('a restaurant that stopped taking bookings says so, with no futile Try again, and nothing is sent', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await mockAvailability(page, clock);
  // What /api/availability answers once the Admin switches the restaurant's online booking off.
  await failAvailability(page, isCalendar, (route) => route.fulfill({ status: 404, json: { error: 'restaurant_unavailable' } }));
  const posts = await abortServerActions(page);
  await page.goto(HOME_PATH);
  await expect(said(page.locator('#reserve'))).toHaveText(GONE);
  await expect(telLink(said(page.locator('#reserve')))).toHaveAttribute('href', `tel:${GROUP_PHONE.tel}`);
  await reserveButton(page).click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });

  await expect(drawer.getByRole('alert')).toHaveText(GONE);
  await expect(telLink(drawer.getByRole('alert'))).toHaveAttribute('href', `tel:${GROUP_PHONE.tel}`);
  await expect(drawer.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await fillDetails(drawer);
  await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
  // No button to land on: the button takes the guest to the message itself.
  await expect(drawer.locator('.load-failed')).toBeFocused();
  await expect(drawer.getByRole('alert')).toHaveCount(1);
  expect(posts.count).toBe(0);
});

test('when REQUEST BOOKING’s own re-ask brings the dates, the focus goes from its Try again to the chosen day, inside the dialog', async ({ page }) => {
  let failing = true;
  let holding = false;
  await page.clock.setFixedTime(NOW);
  await mockAvailability(page, clock);
  await failAvailability(page, (url) => failing && isCalendar(url), (route) => route.fulfill({ status: 503, json: { error: 'unavailable' } }));
  // Holds the re-ask until the button has moved the focus to Try again.
  const release = await holdAvailability(page, (url) => holding && isCalendar(url));
  const posts = await abortServerActions(page);
  await page.goto(HOME_PATH);
  await reserveButton(page).click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.getByRole('alert')).toHaveText(NETWORK);
  await fillDetails(drawer);

  // Back online before the guest presses REQUEST BOOKING: it points at Try again and asks again itself.
  failing = false;
  holding = true;
  await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
  const retry = drawer.getByRole('button', { name: 'Try again' });
  await expect(retry).toBeFocused();

  release();
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  await expect(retry).toHaveCount(0);
  // The focused Try again is gone: the focus is on the chosen day, not on <body> behind the modal.
  await expect(drawer.locator('.day[aria-pressed="true"]')).toBeFocused();
  expect(await focusInDialog(page)).toBe(true);
  expect(posts.count).toBe(0);
});

test('when Try again is answered with a 404, the message stays and keeps the focus, inside the dialog', async ({ page }) => {
  let status = 503;
  await page.clock.setFixedTime(NOW);
  await mockAvailability(page, clock);
  await failAvailability(page, isCalendar, (route) =>
    route.fulfill({ status, json: { error: status === 404 ? 'restaurant_unavailable' : 'unavailable' } }),
  );
  await page.goto(HOME_PATH);
  await reserveButton(page).click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.getByRole('alert')).toHaveText(NETWORK);

  // The Admin switched online booking off meanwhile: the answer takes Try again away, and leaves the message.
  status = 404;
  const retry = drawer.getByRole('button', { name: 'Try again' });
  await retry.click();
  await expect(drawer.getByRole('alert')).toHaveText(GONE);
  await expect(retry).toHaveCount(0);
  await expect(drawer.locator('.load-failed')).toBeFocused();
  expect(await focusInDialog(page)).toBe(true);
});

test('when the times cannot load, the guest is told instead of waiting forever, and Try again recovers with the focus on the chosen time', async ({ page }) => {
  let failing = true;
  await page.clock.setFixedTime(NOW);
  await mockAvailability(page, clock);
  // The calendar answers; the day's request finds no network.
  await failAvailability(page, (url) => failing && url.searchParams.has('date'), (route) => route.abort('internetdisconnected'));
  await page.goto(HOME_PATH);
  await reserveButton(page).click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });

  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  await expect(drawer.getByRole('alert')).toHaveText(NETWORK);
  await expect(drawer.getByText('Checking tables…')).toHaveCount(0);

  failing = false;
  await drawer.getByRole('button', { name: 'Try again' }).click();
  await expect(drawer.locator('.slot:not([disabled])')).toHaveCount(12);
  await expect(drawer.getByRole('alert')).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: '19:00 — 16 covers left' })).toBeFocused();
});

test('when Try again brings a day with no time to choose, the focus goes to the TIME label, inside the dialog', async ({ page }) => {
  let failing = true;
  const dayAnswers: Record<string, MockDay> = {};
  await page.clock.setFixedTime(NOW);
  await mockAvailability(page, { ...clock, dayAnswers });
  await failAvailability(page, (url) => failing && url.searchParams.has('date'), (route) => route.abort('internetdisconnected'));
  await page.goto(HOME_PATH);
  await reserveButton(page).click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  await expect(drawer.getByRole('alert')).toHaveText(NETWORK);

  // The answer that comes back: a closure took the day meanwhile, so no time arrives to take the focus.
  dayAnswers['2026-10-02'] = { state: 'closed' };
  failing = false;
  const retry = drawer.getByRole('button', { name: 'Try again' });
  await retry.click();
  await expect(drawer.getByText('The restaurant is closed at that time — please choose another time or day.')).toBeVisible();
  await expect(retry).toHaveCount(0);
  await expect(drawer.locator('.slot')).toHaveCount(0);
  await expect(drawer.getByText('TIME', { exact: true })).toBeFocused();
  expect(await focusInDialog(page)).toBe(true);
});

test('while the dates are on their way the drawer says so, and REQUEST BOOKING waits for them instead of failing', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await mockAvailability(page, clock);
  const release = await holdAvailability(page, isCalendar);
  const calendars = countRequests(page, (r) => isCalendar(new URL(r.url())));
  const posts = await abortServerActions(page);
  await page.goto(HOME_PATH);
  await reserveButton(page).click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });

  // Under DATE, in place of an empty strip.
  await expect(said(drawer)).toHaveText('Checking tables…');
  await fillDetails(drawer);
  const asked = calendars.count;
  await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
  await expect(said(foot(drawer))).toHaveText('Checking tables…');
  await expect(drawer.getByRole('alert')).toHaveCount(0);

  release();
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  await expect(said(foot(drawer))).toHaveCount(0);
  await expect(drawer.getByRole('alert')).toHaveCount(0);
  // The click asked for nothing: the answer already on its way is the one that counts.
  expect(calendars.count).toBe(asked);
  expect(posts.count).toBe(0);
});

test('when the chosen day’s times did not load, REQUEST BOOKING points at Try again and sends nothing', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await mockAvailability(page, clock);
  await failAvailability(page, (url) => url.searchParams.has('date'), (route) => route.fulfill({ status: 500, json: { error: 'unavailable' } }));
  const posts = await abortServerActions(page);
  await page.goto(HOME_PATH);
  await reserveButton(page).click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);

  await drawer.locator('.daystrip .day').nth(3).click();
  await expect(drawer.getByRole('button', { name: 'Try again' })).toBeVisible();
  await fillDetails(drawer);
  await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
  await expect(drawer.getByRole('button', { name: 'Try again' })).toBeFocused();
  await expect(drawer.getByRole('alert')).toHaveText(NETWORK);
  // No time the guest never saw (the default 19:00) goes to the server.
  expect(posts.count).toBe(0);
});

test('when the chosen day turns out closed, REQUEST BOOKING says so and asks for the dates again', async ({ page }) => {
  const calendars = countRequests(page, (r) => isCalendar(new URL(r.url())));
  const posts = await abortServerActions(page);
  // The calendar still offers today; the day's own answer says a closure took it since.
  const drawer = await openDrawer(page, { dayAnswers: { '2026-10-02': { state: 'closed' } } });
  await expect(drawer.locator('.day[aria-pressed="true"] .day-num')).toHaveText('2');
  // Under TIME, in a live region: a screen reader hears it when the day's answer brings it (F17).
  await expect(drawer.getByRole('status').filter({ hasText: 'The restaurant is closed at that time — please choose another time or day.' })).toBeVisible();
  await fillDetails(drawer);

  const asked = calendars.count;
  await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();
  await expect(foot(drawer).getByRole('alert')).toHaveText('The restaurant is closed at that time — please choose another time or day.');
  await expect.poll(() => calendars.count).toBeGreaterThan(asked);
  expect(posts.count).toBe(0);
});

test('when every time of the chosen day is taken, the drawer says so in a live region, from the registry', async ({ page }) => {
  // The calendar still offers today; the day's own answer has every slot taken.
  const drawer = await openDrawer(page, { dayAnswers: { '2026-10-02': { state: 'full' } } });
  await expect(drawer.locator('.slot')).toHaveCount(12);
  await expect(drawer.locator('.slot:not([disabled])')).toHaveCount(0);
  await expect(drawer.getByRole('status').filter({ hasText: 'No tables left on this date — please choose another day.' })).toBeVisible();

  // Another day with free tables: the region empties, and stays mounted for the next message.
  await drawer.locator('.daystrip .day').nth(1).click();
  await expect(drawer.locator('.slot:not([disabled])')).toHaveCount(12);
  await expect(drawer.getByText('No tables left on this date')).toHaveCount(0);
});

test('when the booking cannot reach the server, the footer gives the number to call as a link, and REQUEST BOOKING works again', async ({ page }) => {
  const drawer = await openDrawer(page);
  // Nothing is written: the action's POST fails on its way out, as with no network.
  const posts = await abortServerActions(page);
  await fillDetails(drawer);
  const button = drawer.getByRole('button', { name: 'REQUEST BOOKING' });
  await button.click();

  const alert = foot(drawer).getByRole('alert');
  await expect(alert).toHaveText(NETWORK);
  await expect(alert.locator('a[href^="tel:"]')).toHaveAttribute('href', `tel:${GROUP_PHONE.tel}`);
  await expect(button).toBeEnabled();
  await expect(button).toHaveText('REQUEST BOOKING');
  expect(posts.count).toBe(1);
});

test('a failed calendar for one restaurant does not show while the next one’s is on its way', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await mockAvailability(page, clock);
  const forRestaurant = (url: URL, id: string) => isCalendar(url) && url.searchParams.get('restaurant') === id;
  const release = await holdAvailability(page, (url) => forRestaurant(url, 'don-ciprianis'));
  await failAvailability(page, (url) => forRestaurant(url, 'taya-house'), (route) => route.fulfill({ status: 503, json: { error: 'unavailable' } }));
  await page.goto(HOME_PATH);
  await reserveButton(page).click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.getByRole('button', { name: 'Try again' })).toBeVisible();

  await drawer.getByRole('button', { name: /^restaurant/i }).click();
  await page.getByRole('listbox', { name: 'Restaurant' }).getByRole('option', { name: 'Don Cipriani’s' }).click();
  await expect(drawer.locator('.drawer-name')).toHaveText('Don Cipriani’s');
  // Tàya House's failure is not Don Cipriani’s: its dates are on their way.
  await expect(drawer.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(drawer.getByRole('alert')).toHaveCount(0);
  await expect(said(drawer)).toHaveText('Checking tables…');

  release();
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  await expect(said(drawer)).toHaveCount(0);
});

test('books a table against the real availability API', async ({ page }) => {
  await page.goto(HOME_PATH);
  await reserveButton(page).click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  await expect(drawer.locator('.daystrip .day').first().locator('.day-wd')).toHaveText('Today');

  // The last day of the window is never past its sittings.
  await drawer.locator('.daystrip .day[data-state="open"]').last().click();
  await drawer.locator('.slot:not([disabled])').first().click();
  await drawer.getByLabel('Full name *', { exact: true }).fill('Nguyễn Minh Anh');
  const digits = String(Date.now()).slice(-6);
  await drawer.getByLabel('Phone *', { exact: true }).fill(`0905 ${digits.slice(0, 3)} ${digits.slice(3)}`);
  await drawer.getByRole('checkbox', { name: 'I agree to Furama Cuisine using my details as described in the privacy policy.' }).check();
  await drawer.getByRole('button', { name: 'REQUEST BOOKING' }).click();

  await expect(drawer.locator('.drawer-ref')).toHaveText(/^FC-[0-9A-HJKMNP-TV-Z]{8}$/);
  // Auto-confirm is off: a request, which staff confirm.
  const lede = drawer.locator('.drawer-done-lede');
  await expect(lede).toContainText('has been received');
  await expect(lede).toContainText('contact you shortly to confirm');
});

/** Opens the drawer from a home-page card (a restaurant without its own page only reserves). */
async function openFromCard(page: Page, name: string) {
  await page.goto(HOME_PATH);
  await page.locator('.rcard:visible', { hasText: name }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.daystrip .day')).toHaveCount(14);
  return drawer;
}

test('a closure written to the database greys the day on the next calendar fetch', async ({ page }) => {
  const date = addDays(venueNow().date, 9);
  const closure = await one<{ id: string }>(
    `INSERT INTO closures (scope, restaurant_id, starts_on, ends_on, created_by) VALUES ('restaurant', 'don-ciprianis', $1, $1, 'e2e') RETURNING id::text`,
    [date],
  );
  try {
    await one(`INSERT INTO closure_i18n (closure_id, locale, public_reason) VALUES ($1, 'en', 'Closed for a wine dinner')`, [closure!.id]);
    const drawer = await openFromCard(page, 'Don Cipriani');
    // That date's chip by its spoken name. Today is greyed too ('past') once its
    // last sitting is inside the lead time, so only closed chips are counted.
    const chip = drawer.getByRole('button', { name: `${formatDay(date).label}: Closed for a wine dinner`, exact: true });
    await expect(chip).toHaveAttribute('aria-disabled', 'true');
    await expect(chip).toHaveAttribute('data-state', 'closed');
    await expect(drawer.locator('.daystrip .day[data-state="closed"]')).toHaveCount(1);
  } finally {
    await one('DELETE FROM closures WHERE id = $1', [closure!.id]);
  }
});

test('a max_party of 8 in the database stops the stepper at 8 and names the destination’s number', async ({ page }) => {
  // The Fan's row is shared: under --repeat-each another copy of this test would put it back half-way.
  await exclusive('the-fan:max_party', async () => {
    await one(`UPDATE restaurants SET max_party = 8 WHERE id = 'the-fan'`);
    try {
      const drawer = await openFromCard(page, 'Steakhouse The Fan');
      const more = drawer.getByRole('button', { name: 'More guests' });
      const hint = 'For more than 8 guests, please call us on 0859 555 759.';
      // From the keyboard: at the limit the button keeps the focus, and the hint is read out.
      // The strip can still show the previous calendar's days: the stepper waits for The Fan's own.
      await expect(more).toBeEnabled();
      await more.focus();
      for (let i = 2; i < 8; i++) await page.keyboard.press('Enter');
      await expect(drawer.locator('.guests-value')).toHaveText('8 guests');
      await expect(more).toBeDisabled();
      // Chrome moves the focus off a button that turned `disabled` at its next rendering update, not at once.
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))));
      await expect(more).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(drawer.locator('.guests-value')).toHaveText('8 guests');
      await expect(said(drawer)).toHaveText(hint);
      await expect(more).toHaveAccessibleDescription(hint);
      await expect(drawer.locator('.guests-hint')).toHaveText(hint);
      await expect(drawer.locator('.guests-hint a')).toHaveAttribute('href', 'tel:+84859555759');
    } finally {
      await one(`UPDATE restaurants SET max_party = NULL WHERE id = 'the-fan'`);
    }
  });
});
