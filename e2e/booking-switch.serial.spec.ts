import type { Browser, Locator, Page } from '@playwright/test';
import { DETAIL_PATH, HOME_PATH } from './paths';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * restaurants.booking_enabled (spec §5.2; ruling R14). It switches off Tàya
 * House (the default restaurant, with the only detail page), Hải Vân Lounge (a
 * card that only reserves, at the resort, which has a number) and Yum Food
 * Village (the same at MM Supercenter, which has none). Every guest page reads
 * them, so this file runs in the desktop-serial project, after every other
 * spec. The admin save expires the cached catalogue with
 * updateTag('restaurants'); without it the guest pages below would keep their
 * RESERVE buttons. Phase 6 ("Gọi để đặt bàn", R20): a card that cannot
 * reserve offers its number instead, and only a card with no number is inert.
 */

const SWITCHED = ['taya-house', 'hai-van-lounge', 'yum-food-village'];

test.beforeAll(() => seedStaff());
test.afterAll(async () => {
  // Whatever happened below, leave every restaurant bookable in the database.
  await one(`UPDATE restaurants SET booking_enabled = true`);
});

async function setOnline(page: Page, id: string, on: boolean) {
  await page.goto(`/admin/restaurants/${id}/booking`);
  const rules = page.getByRole('form', { name: 'Quy tắc đặt bàn' });
  await rules.getByRole('checkbox', { name: /^Nhận đặt bàn online/ }).setChecked(on);
  await rules.getByRole('button', { name: 'Lưu quy tắc' }).click();
  await expect(page.getByRole('form', { name: 'Quy tắc đặt bàn' }).getByRole('status')).toHaveText('Đã lưu.');
}

/** A guest with no staff cookie, past the intro; `opened` collects it, so the test's finally closes it whatever fails. */
async function guest(browser: Browser, opened: Page[], viewport = { width: 1280, height: 860 }) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  const page = await context.newPage();
  opened.push(page);
  return page;
}

async function closeAll(opened: Page[]) {
  for (const p of opened) await p.context().close();
}

/*
 * Where Hải Vân Lounge's card is narrowest: the home grid's cards are 150–200 px
 * wide on a phone, a tablet and the narrow desktops, and the detail page's rail
 * holds them at min(44vw, 180px).
 */
const CALL_CARDS: { path: string; width: number; height: number }[] = [
  { path: HOME_PATH, width: 390, height: 844 },
  { path: HOME_PATH, width: 560, height: 860 },
  { path: HOME_PATH, width: 768, height: 1024 },
  { path: HOME_PATH, width: 1024, height: 860 },
  { path: HOME_PATH, width: 1120, height: 860 },
  { path: HOME_PATH, width: 1200, height: 860 },
  { path: DETAIL_PATH, width: 390, height: 844 },
  { path: DETAIL_PATH, width: 1024, height: 860 },
];

/**
 * How far the shown call tag of a card, or any line of its text, reaches past the
 * card's picture, which clips it (0 when it all lies inside), and how much text the
 * tag cuts off itself. A clipped tag read "+84 236 651 999": a wrong number.
 */
async function callTagSpill(card: Locator) {
  await card.hover();
  return card.evaluate(async (el) => {
    const frame = el.querySelector('.rcard-frame')!.getBoundingClientRect();
    const tag = el.querySelector('.rcard-tag')!;
    await Promise.all(tag.getAnimations().map((a) => a.finished)); // it rises in over 0.35 s
    const text = document.createRange();
    text.selectNodeContents(tag);
    const boxes = [tag.getBoundingClientRect(), ...text.getClientRects()];
    const past = boxes.flatMap((b) => [frame.left - b.left, b.right - frame.right, frame.top - b.top, b.bottom - frame.bottom]);
    return { past: Math.max(0, ...past), cut: tag.scrollWidth - tag.clientWidth };
  });
}

/**
 * The call tag's arrow is joined to the number by a no-break space, so a wrapping tag never
 * leaves "→" alone on a line (Firefox did); toHaveText folds that space, so the raw text is read.
 */
async function endsOnNumberLine(tag: Locator) {
  expect(await tag.textContent()).toMatch(/\d\u00a0→$/);
}

test('switching online booking off hides every RESERVE of that restaurant; on again brings them back', async ({ page, browser }) => {
  const guests: Page[] = [];
  try {
    await signInAs(page, STAFF.editor);
    for (const id of SWITCHED) await setOnline(page, id, false);

    const home = await guest(browser, guests);
    await home.goto(HOME_PATH);
    // Two of the three offers are theirs: only Café Indochine's keeps its button.
    await expect(home.getByRole('button', { name: /VIEW OFFER/ })).toHaveCount(1);
    // Hải Vân Lounge has no page, so its card only reserved: now it offers the resort's number (R20).
    const lounge = home.locator('.rcard:visible', { hasText: 'Hải Vân Lounge' }).first();
    await expect(lounge.locator('.rcard-tag')).toHaveText('Call +84 236 651 9999 →');
    await endsOnNumberLine(lounge.locator('.rcard-tag'));
    await expect(lounge).not.toHaveAttribute('aria-disabled', 'true');
    // A tap dials that number (a tel: request, which headless Chromium has no app for), and opens no form.
    const dialled = home.waitForRequest((r) => r.url().startsWith('tel:'));
    await lounge.click();
    expect((await dialled).url()).toBe('tel:+842366519999');
    await expect(home.getByRole('dialog', { name: 'Reserve a table' })).toHaveCount(0);
    // Yum Food Village's destination has no number: its card does nothing.
    const card = home.locator('.rcard', { hasText: 'Yum Food Village' }).first();
    await expect(card.locator('.rcard-tag')).toHaveCount(0);
    await expect(card).toHaveAttribute('aria-disabled', 'true');
    // Nor does it look as if it did (GX-6): under the pointer, no hand and no push-in of its picture.
    const shown = home.locator('.rcard:visible', { hasText: 'Yum Food Village' }).first();
    await shown.hover();
    const look = await shown.evaluate(async (el) => {
      const zoom = el.querySelector('.rcard-zoom')!;
      await Promise.all(zoom.getAnimations().map((a) => a.finished)); // the push-in is a 0.9 s transition
      return { cursor: getComputedStyle(el).cursor, zoom: getComputedStyle(zoom).transform };
    });
    expect(look).toEqual({ cursor: 'default', zoom: 'matrix(1, 0, 0, 1, 0, 0)' });
    // Search offers the call for Hải Vân Lounge and nothing for Yum Food Village; V-Senses Cafe still reserves.
    await home.locator('.hdr-full .hdr-link', { hasText: 'SEARCH' }).click();
    await home.locator('.search-chip', { hasText: 'Café & Lounge' }).click();
    await expect(home.locator('.search-result', { hasText: 'Hải Vân Lounge' }).locator('.search-result-action')).toHaveText('Call →');
    await expect(home.locator('.search-result', { hasText: 'V-Senses Cafe' }).locator('.search-result-action')).toHaveText('Reserve →');
    await home.locator('.search-input').fill('yum');
    await expect(home.locator('.search-result', { hasText: 'Yum Food Village' })).toHaveCount(1);
    await expect(home.locator('.search-result', { hasText: 'Yum Food Village' }).locator('.search-result-action')).toHaveCount(0);
    await home.keyboard.press('Escape');
    // The generic RESERVE opens on the first bookable restaurant, and the list leaves both out.
    await home.getByRole('button', { name: 'RESERVE', exact: true }).first().click();
    const drawer = home.getByRole('dialog', { name: 'Reserve a table' });
    await expect(drawer.locator('.drawer-name')).toHaveText('Café Indochine');
    await drawer.locator('.dd').nth(1).locator('.dd-trigger').click();
    const names = await drawer.getByRole('listbox', { name: 'Restaurant' }).getByRole('option').allTextContents();
    expect(names.join('|')).not.toMatch(/Tàya House|Hải Vân Lounge/);
    expect(names).toHaveLength(4); // the resort's others: Café Indochine, Don Cipriani’s, Danaksara, V-Senses Cafe

    const detail = await guest(browser, guests);
    await detail.goto(DETAIL_PATH);
    await expect(detail.locator('.taya-kicker')).toBeVisible();
    await expect(detail.getByRole('button', { name: /RESERVE A TABLE/ })).toHaveCount(0);

    const phone = await guest(browser, guests, { width: 390, height: 844 });
    await phone.goto(DETAIL_PATH);
    const bar = phone.getByRole('navigation', { name: 'Restaurant actions' });
    await expect(bar.getByRole('button', { name: 'RESERVE' })).toHaveCount(0);
    await expect(bar).toHaveAttribute('style', /repeat\(3, minmax\(0, 1fr\)\)/); // CALL, MAP, MENU

    // However narrow the card, its call tag shows the whole number, last digit included, inside the picture.
    for (const { path, width, height } of CALL_CARDS) {
      const narrow = await guest(browser, guests, { width, height });
      await narrow.goto(path);
      const list = narrow.locator(path === DETAIL_PATH ? '.more-rail' : '.restaurant-grid');
      const caller = list.locator('.rcard:visible', { hasText: 'Hải Vân Lounge' });
      await expect(caller.locator('.rcard-tag')).toHaveText('Call +84 236 651 9999 →');
      await endsOnNumberLine(caller.locator('.rcard-tag'));
      expect.soft(await callTagSpill(caller), `${path} at ${width} px`).toEqual({ past: 0, cut: 0 });
      await narrow.context().close();
    }

    for (const id of SWITCHED) await setOnline(page, id, true);
    await detail.reload();
    await expect(detail.getByRole('button', { name: /RESERVE A TABLE/ })).toBeVisible();
    await home.reload();
    await expect(home.getByRole('button', { name: /VIEW OFFER/ })).toHaveCount(3);
    const reserves = home.locator('.rcard', { hasText: 'Hải Vân Lounge' }).first().locator('.rcard-tag');
    await expect(reserves).toHaveText('Reserve a table →');
    // Only the call tag's space changed: VIEW and RESERVE keep their plain one (the DOM diff and the baselines hold them).
    expect(await reserves.textContent()).toBe('Reserve a table →');
  } finally {
    await closeAll(guests);
  }
});

test('with every restaurant booking offline, RESERVE opens on whom to call, not on a form that never loads', async ({ page, browser }) => {
  const guests: Page[] = [];
  try {
    await signInAs(page, STAFF.editor);
    // Eleven in the database, then the twelfth through the admin, whose save expires the cached catalogue.
    await one(`UPDATE restaurants SET booking_enabled = false WHERE id <> 'the-fan'`);
    try {
      await setOnline(page, 'the-fan', false);
      const home = await guest(browser, guests);
      await home.goto(HOME_PATH);
      await expect(home.getByRole('button', { name: /VIEW OFFER/ })).toHaveCount(0);
      await home.getByRole('button', { name: 'RESERVE', exact: true }).first().click();
      const drawer = home.getByRole('dialog', { name: 'Reserve a table' });
      await expect(drawer.getByRole('alert')).toHaveText(
        'Online booking is not available right now. Please call us on +84 236 651 9999 to book a table.',
      );
      await expect(drawer.getByRole('link', { name: '+84 236 651 9999' })).toHaveAttribute('href', 'tel:+842366519999');
      await expect(drawer.getByRole('button', { name: 'REQUEST BOOKING' })).toHaveCount(0);
      await expect(drawer.getByText('Checking tables…')).toHaveCount(0);
      // With no restaurant chosen, the head is the kicker and the close button: no empty name or meta line
      // above the message. The head is the nearest box around the kicker that holds a button.
      const head = drawer.getByText('RESERVE A TABLE', { exact: true }).locator('xpath=ancestor::*[.//button][1]');
      await expect(head.getByRole('button')).toHaveAccessibleName('Close');
      const leaves = await head.evaluate((el) =>
        [...el.querySelectorAll('*')].filter((e) => e.children.length === 0).map((e) => e.textContent?.trim()),
      );
      expect(leaves).toEqual(['RESERVE A TABLE', '×']);
    } finally {
      // Back through the same save (R21), which expires the catalogue again.
      await one(`UPDATE restaurants SET booking_enabled = true WHERE id <> 'the-fan'`);
      await setOnline(page, 'the-fan', true);
    }
    // The home page this test re-rendered goes back to disk as it was: every offer reserves again.
    const after = await guest(browser, guests);
    await after.goto(HOME_PATH);
    await expect(after.getByRole('button', { name: /VIEW OFFER/ })).toHaveCount(3);
  } finally {
    await closeAll(guests);
  }
});

test('a search result’s Call → dials the restaurant’s own number, not its destination’s', async ({ page, browser }) => {
  // Hải Vân Lounge, without a page of its own, gets a number unlike the resort's, and its online booking goes off.
  const OWN = { tel: '+842360000000', display: '+84 236 000 0000' };
  const guests: Page[] = [];
  try {
    await signInAs(page, STAFF.editor);
    await one(`UPDATE restaurants SET phone_e164 = $1, phone_display = $2 WHERE id = 'hai-van-lounge'`, [OWN.tel, OWN.display]);
    try {
      await setOnline(page, 'hai-van-lounge', false); // the save expires the catalogue, own number included
      const home = await guest(browser, guests);
      await home.goto(HOME_PATH);
      await home.getByRole('banner').getByRole('button', { name: 'SEARCH', exact: true }).click();
      const search = home.getByRole('dialog', { name: 'Search' });
      await search.getByRole('textbox', { name: 'Search restaurants, cuisines, places' }).fill('hai van');
      const result = search.getByRole('button', { name: /^Hải Vân Lounge.*Call →$/ });
      await expect(result).toHaveCount(1);
      const dialled: string[] = [];
      home.on('request', (r) => {
        if (r.url().startsWith('tel:')) dialled.push(r.url());
      });
      await result.click();
      await expect.poll(() => dialled).toEqual([`tel:${OWN.tel}`]);
      await expect(home.getByRole('dialog', { name: 'Reserve a table' })).toHaveCount(0);
    } finally {
      // Back through the same save (R21), which expires the catalogue again.
      await one(`UPDATE restaurants SET phone_e164 = NULL, phone_display = NULL WHERE id = 'hai-van-lounge'`);
      await setOnline(page, 'hai-van-lounge', true);
    }
    // The home page this test re-rendered goes back to disk as it was: the lounge reserves again.
    const after = await guest(browser, guests);
    await after.goto(HOME_PATH);
    await after.getByRole('banner').getByRole('button', { name: 'SEARCH', exact: true }).click();
    const search = after.getByRole('dialog', { name: 'Search' });
    await search.getByRole('textbox', { name: 'Search restaurants, cuisines, places' }).fill('hai van');
    await expect(search.getByRole('button', { name: /^Hải Vân Lounge.*Reserve →$/ })).toHaveCount(1);
  } finally {
    await closeAll(guests);
  }
});
