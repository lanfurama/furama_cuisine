import type { Page } from '@playwright/test';
import { expectHydrated } from './csp';
import { seedReservation, venueDay } from './reservation-fixtures';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * The admin on the screens between the 375 px phone and the 1280 laptop (admin-phone.spec.ts), and past them
 * (styles/admin.css). On a 320 px phone a list item's editor, a strings screen and the inbox's search stay inside
 * the page's column with every <details> open. On a tablet either way up, the inbox and a restaurant's periods
 * turn into cards: "Xác nhận" and "Xóa ca …" are on screen, and nothing scrolls sideways. On a phone on its side
 * the header scrolls away, the save bar is one line, and the menu shows every link at once. A touch screen gets
 * bigger targets. On a 2560 screen the page sits in the middle, the header's ends on its edges. Read-only, with a
 * pending booking of this file's own (Café Indochine, tomorrow) so the inbox has a "Xác nhận".
 */

const GUEST = 'Khách màn máy tính bảng E2E';
const clearOwn = () => one(`DELETE FROM reservations WHERE guest_name = $1`, [GUEST]);

test.beforeAll(async () => {
  await seedStaff();
  await clearOwn();
  await seedReservation({ restaurant: 'cafe-indochine', date: venueDay(1), name: GUEST });
});
test.afterAll(() => clearOwn());

/** Elements of the page that cross the right edge of its column (.a-main less its padding), outside any scroll box. */
async function pastColumn(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const main = document.querySelector('.a-main')!;
    const edge = main.getBoundingClientRect().right - parseFloat(getComputedStyle(main).paddingRight);
    const out: string[] = [];
    for (const el of main.querySelectorAll('*')) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.right <= edge + 1 || getComputedStyle(el).position === 'absolute') continue;
      let scrolls = false;
      for (let a = el.parentElement; a && a !== main; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') scrolls = true;
      if (!scrolls) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} +${Math.round(box.right - edge)}px`);
    }
    return out.slice(0, 5);
  });
}

/** Opens a screen with every <details> open (item editors, pickers, a key's context). */
async function openAll(page: Page, path: string) {
  await page.goto(path);
  await expectHydrated(page);
  await page.locator('details').evaluateAll((all) => all.forEach((d) => ((d as HTMLDetailsElement).open = true)));
}

/** How far each box around a table scrolls sideways (0 when the table fits). */
const tableScroll = (page: Page) =>
  page.locator('.a-main table').evaluateAll((all) => all.map((t) => t.parentElement!.scrollWidth - t.parentElement!.clientWidth));

test.describe('on a 320 px phone', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test('list item editors, a strings screen and the inbox search stay inside the column', async ({ page }) => {
    await signInAs(page, STAFF.editor);
    for (const path of ['/admin/content/cuisines', '/admin/content/stories', '/admin/content/legal', '/admin/reservations']) {
      await openAll(page, path);
      expect(await pastColumn(page), path).toEqual([]);
    }
  });
});

for (const viewport of [
  { width: 768, height: 1024 },
  { width: 1194, height: 834 },
]) {
  test.describe(`on a ${viewport.width}×${viewport.height} tablet`, () => {
    test.use({ viewport, hasTouch: true });

    test('the inbox and the periods are cards: their actions are on screen and nothing scrolls sideways', async ({ page }) => {
      await signInAs(page, STAFF.editor);
      await page.goto('/admin/reservations');
      await expectHydrated(page);
      const confirms = page.getByRole('main').getByRole('button', { name: /^Xác nhận FC-/ });
      expect(await confirms.count()).toBeGreaterThan(0);
      for (const box of await confirms.evaluateAll((all) => all.map((b) => b.getBoundingClientRect().right))) expect(box).toBeLessThanOrEqual(viewport.width);
      expect((await tableScroll(page)).filter((n) => n > 0)).toEqual([]);

      await page.goto('/admin/restaurants/taya-house/booking');
      await expectHydrated(page);
      const remove = page.getByRole('button', { name: /^Xóa ca / });
      expect(await remove.count()).toBeGreaterThan(0);
      for (const box of await remove.evaluateAll((all) => all.map((b) => b.getBoundingClientRect().right))) expect(box).toBeLessThanOrEqual(viewport.width);
      expect((await tableScroll(page)).filter((n) => n > 0)).toEqual([]);
    });

    test('a touch screen gets fingertip targets: checkboxes, a list item’s ↑ ↓, its "Sửa …"', async ({ page }) => {
      await signInAs(page, STAFF.editor);
      await page.goto('/admin/content/cuisines');
      await expectHydrated(page);
      const item = page.locator('.a-sortable-item').first();
      expect((await item.getByRole('button', { name: /lên$/ }).boundingBox())!.height).toBeGreaterThanOrEqual(34);
      expect((await item.locator('summary').first().boundingBox())!.height).toBeGreaterThanOrEqual(34);
      await page.goto('/admin/reservations/new');
      await expectHydrated(page);
      const box = (await page.getByRole('main').getByRole('checkbox').first().boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(20);
    });
  });
}

test.describe('on a phone on its side (568×320)', () => {
  test.use({ viewport: { width: 568, height: 320 }, hasTouch: true });

  test('the header scrolls away and the save bar is one line', async ({ page }) => {
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/restaurants/taya-house');
    await expectHydrated(page);
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect.poll(() => page.evaluate(() => document.querySelector('.a-header')!.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0);
    const bar = page.locator('.a-savebar').filter({ hasText: 'Lưu nhà hàng' });
    await expect(bar).toBeInViewport();
    expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(64);
  });
});

test.describe('on a 750×342 phone on its side', () => {
  test.use({ viewport: { width: 750, height: 342 }, hasTouch: true });

  test('the menu lays its groups side by side: every link is on screen at once', async ({ page }) => {
    // The Admin has every group (Vận hành, Web khách, Hệ thống).
    await signInAs(page, STAFF.admin);
    await expectHydrated(page);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    const nav = page.getByRole('navigation', { name: 'Điều hướng quản trị' });
    await expect(nav.getByRole('link', { name: 'Tổng quan', exact: true })).toBeFocused();
    const links = nav.getByRole('link');
    expect(await links.count()).toBeGreaterThan(8);
    for (const link of await links.all()) await expect(link).toBeInViewport({ ratio: 1 });
  });
});

test.describe('on a 2560 px screen', () => {
  test.use({ viewport: { width: 2560, height: 1440 } });

  test('the page sits in the middle beside the sidebar, the header’s ends on its edges', async ({ page }) => {
    await signInAs(page, STAFF.editor);
    const at = await page.evaluate(() => {
      const box = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const column = box('.a-main-col');
      const main = box('.a-main');
      const pad = parseFloat(getComputedStyle(document.querySelector('.a-main')!).paddingLeft);
      return {
        left: main.left - column.left,
        right: column.right - main.right,
        h1: box('.a-main h1').left,
        cta: box('.a-header-cta').left,
        end: box('.a-header-bar').right,
        content: main.right - pad,
      };
    });
    expect(at.left).toBeGreaterThan(400);
    expect(Math.abs(at.left - at.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(at.cta - at.h1)).toBeLessThanOrEqual(1);
    expect(Math.abs(at.end - at.content)).toBeLessThanOrEqual(1);
  });
});
