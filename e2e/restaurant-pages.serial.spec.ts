import type { Browser, Page } from '@playwright/test';
import { DETAIL_PATH, HOME_PATH } from './paths';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * Phase 6's acceptance (spec §14.1 row 6): switching has_detail_page on for
 * another restaurant makes its page work, with no deploy. Steakhouse The Fan
 * gets a portrait, a kicker, an English story and two highlights (what the
 * phase-7 editor will ask for), then the switch. Phase 6 has no restaurant
 * editor, so the database is written directly and an existing admin save that
 * calls updateTag('restaurants') (the booking rules form) expires the cached
 * pages, as the editor's save will (R21: the restore goes through the same
 * save). The Fan has no map link and no menu PDF: MAP hides, and MENU scrolls
 * to the highlights; CALL is its destination's number. Off is the switch
 * alone: the portrait, the copy and the highlights stay, so the 404 that
 * follows can only come from has_detail_page (a loader that ignored it would
 * still draw the page). The rest goes after the test; with the page off, no
 * guest page reads it.
 *
 * It changes what every guest page reads (the catalogue), so it runs in the
 * desktop-serial project, one file at a time, after every other spec.
 */

const FAN_PATH = '/en/restaurants/the-fan';

test.beforeAll(() => seedStaff());
test.afterAll(() => closeTheFan());

async function openTheFan() {
  await one(
    `UPDATE restaurants SET has_detail_page = true, detail_image_id = (SELECT id FROM media WHERE pathname = '/assets/r-the-fan.jpg')
      WHERE id = 'the-fan'`,
  );
  await one(
    `UPDATE restaurant_i18n
        SET detail_kicker = 'Steak & Wine · Furama Dining House',
            story = 'Dry-aged cuts over charcoal and a cellar of New World reds, three floors above An Thượng.'
      WHERE restaurant_id = 'the-fan' AND locale = 'en'`,
  );
  await one(
    `WITH h(sort_order, pathname, title, detail) AS (
       VALUES (10, '/assets/story-the-fan.jpg', 'The Art Floor', 'Dinner among the paintings, 3F'),
              (20, '/assets/r-the-fan.jpg', 'Tomahawk for Two', 'Carved at the table')),
     ins AS (
       INSERT INTO restaurant_highlights (restaurant_id, image_id, sort_order)
       SELECT 'the-fan', m.id, h.sort_order FROM h JOIN media m ON m.pathname = h.pathname
       RETURNING id, sort_order)
     INSERT INTO restaurant_highlight_i18n (highlight_id, locale, title, detail)
     SELECT ins.id, 'en', h.title, h.detail FROM ins JOIN h USING (sort_order)`,
  );
}

async function closeTheFan() {
  await one(`DELETE FROM restaurant_highlights WHERE restaurant_id = 'the-fan'`);
  await one(`UPDATE restaurant_i18n SET detail_kicker = NULL, story = NULL WHERE restaurant_id = 'the-fan' AND locale = 'en'`);
  await one(`UPDATE restaurants SET has_detail_page = false, detail_image_id = NULL WHERE id = 'the-fan'`);
}

/** Saves The Fan's booking rules unchanged: the action calls updateTag('restaurants'). */
async function refreshGuestPages(page: Page) {
  await page.goto('/admin/restaurants/the-fan/booking');
  const rules = page.getByRole('form', { name: 'Quy tắc đặt bàn' });
  await rules.getByRole('checkbox', { name: /^Nhận đặt bàn online/ }).setChecked(true);
  await rules.getByRole('button', { name: 'Lưu quy tắc' }).click();
  await expect(page.getByRole('form', { name: 'Quy tắc đặt bàn' }).getByRole('status')).toHaveText('Đã lưu.');
}

/**
 * The site's 404, seen in a browser. Not the response's text: every page's RSC
 * payload carries the not-found boundary, "Page not found" included, so a
 * page that rendered would match that too.
 */
async function expectNotFound(visitor: Page) {
  await expect(visitor.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await expect(visitor).toHaveTitle('Page not found — Furama Cuisine');
  await expect(visitor.locator('.taya-hero-copy')).toHaveCount(0);
}

/** A guest with no staff cookie, past the intro. */
async function guest(browser: Browser, viewport = { width: 1280, height: 860 }) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

test('switching has_detail_page on opens a working page for another restaurant, and off closes it again', async ({ page, browser }) => {
  const visitor = await guest(browser);
  // Before: no page (a cached 404 from here on, tagged restaurants), and the card only reserves.
  await visitor.goto(FAN_PATH);
  await expectNotFound(visitor);
  await visitor.goto(HOME_PATH);
  await expect(visitor.locator('.rcard:visible', { hasText: 'Steakhouse The Fan' }).locator('.rcard-tag')).toHaveText('Reserve a table →');

  await signInAs(page, STAFF.editor);
  await openTheFan();
  try {
    await refreshGuestPages(page);

    // The page renders from the database, at a URL that was a cached 404 a moment ago.
    await visitor.goto(FAN_PATH);
    await expect(visitor).toHaveTitle('Steakhouse The Fan — Furama Cuisine');
    const hero = visitor.locator('.taya-hero-copy');
    await expect(hero.getByRole('heading', { level: 1 })).toHaveText('Steakhouse The Fan');
    await expect(hero.locator('.taya-kicker')).toHaveText('Steak & Wine · Furama Dining House');
    await expect(hero.locator('.taya-story-label')).toHaveText('Brand Story');
    await expect(hero.locator('.taya-story')).toContainText('three floors above An Thượng');
    await expect(visitor.locator('.taya-portrait img')).toHaveAttribute('src', '/assets/r-the-fan.jpg');
    // CALL is the dining house's number; no map link anywhere, so no MAP.
    await expect(hero.getByRole('link', { name: 'CALL' })).toHaveAttribute('href', 'tel:+84859555759');
    await expect(hero.getByRole('link', { name: 'MAP' })).toHaveCount(0);
    await expect(visitor.getByRole('heading', { name: 'At Steakhouse The Fan' })).toBeVisible();
    await expect(visitor.locator('#dishes .dish-title')).toHaveText(['The Art Floor', 'Tomahawk for Two']);
    await expect(visitor.getByRole('heading', { name: 'More at Furama Dining House' })).toBeVisible();
    await expect(visitor.locator('.more-rail .rcard-name')).toHaveText(['Phố Cuốn', 'Thai Siam Kitchen', 'Hura Izakaya']);

    // No PDF: MENU takes the guest to the highlights.
    await hero.getByRole('button', { name: 'MENU' }).click();
    await expect.poll(() => visitor.locator('#dishes').evaluate((e) => Math.round(e.getBoundingClientRect().top))).toBeLessThan(120);

    // RESERVE books this restaurant.
    await hero.getByRole('button', { name: /RESERVE A TABLE/ }).click();
    await expect(visitor.getByRole('dialog', { name: 'Reserve a table' }).locator('.drawer-name')).toHaveText('Steakhouse The Fan');
    await visitor.keyboard.press('Escape');

    // From the home page, the card now opens the page, without a reload.
    await visitor.goto(HOME_PATH);
    await visitor.evaluate(() => {
      (window as Window & { pageMark?: string }).pageMark = 'same document';
    });
    const card = visitor.locator('.rcard:visible', { hasText: 'Steakhouse The Fan' });
    await expect(card.locator('.rcard-tag')).toHaveText('View restaurant →');
    await card.click();
    await visitor.waitForURL((u) => u.pathname === FAN_PATH);
    await expect(visitor.locator('.taya-kicker:visible')).toHaveText('Steak & Wine · Furama Dining House');
    expect(await visitor.evaluate(() => (window as Window & { pageMark?: string }).pageMark)).toBe('same document');

    // A phone gets one tab per button shown: CALL, MENU, RESERVE.
    const phone = await guest(browser, { width: 390, height: 844 });
    await phone.goto(FAN_PATH);
    const bar = phone.getByRole('navigation', { name: 'Restaurant actions' });
    await expect(bar.getByRole('link')).toHaveText(['CALL']);
    await expect(bar.getByRole('button')).toHaveText(['MENU', 'RESERVE']);
    await expect(bar).toHaveAttribute('style', /repeat\(3, minmax\(0, 1fr\)\)/);
    // Tàya House keeps all four.
    await phone.goto(DETAIL_PATH);
    await expect(phone.getByRole('navigation', { name: 'Restaurant actions' })).toHaveAttribute('style', /repeat\(4, minmax\(0, 1fr\)\)/);
    await phone.context().close();
  } finally {
    await one(`UPDATE restaurants SET has_detail_page = false WHERE id = 'the-fan'`);
    await refreshGuestPages(page);
  }

  // Off again, with its portrait, copy and highlights still there: the page 404s and the card reserves.
  await visitor.goto(FAN_PATH);
  await expectNotFound(visitor);
  await visitor.goto(HOME_PATH);
  await expect(visitor.locator('.rcard:visible', { hasText: 'Steakhouse The Fan' }).locator('.rcard-tag')).toHaveText('Reserve a table →');
  await visitor.context().close();
});
