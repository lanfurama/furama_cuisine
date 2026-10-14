import type { Page } from '@playwright/test';
import { expectHydrated, watchCsp } from './csp';
import { STAFF, expect, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * The signed-in frame (app/admin/(shell)/AdminFrame.tsx). Up to 960 px the
 * sidebar is a drawer behind the header's "Menu": open, it takes focus to the
 * current page's link and makes the page inert; Escape, "Đóng menu" or a tap
 * outside closes it and gives focus back to "Menu"; following one of its
 * links closes it and puts focus on the new page; widening the window closes
 * it. On a desktop the skip link is the first Tab stop and lands on <main>,
 * and the header's shortcut to a phone booking reads "Tạo đặt bàn" like the
 * page it opens. Read-only: nothing is saved.
 */

test.beforeAll(() => seedStaff());

const menu = (page: Page) => page.getByRole('button', { name: 'Menu', exact: true });
const nav = (page: Page) => page.getByRole('navigation', { name: 'Điều hướng quản trị' });
// The header and the page: inert while the drawer is open.
const pageColumn = (page: Page) => page.locator('.a-main-col');

test.describe('on a 375 px phone', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('the menu opens over an inert page on the current link; Escape, "Đóng menu" and a tap outside close it', async ({ page }) => {
    const violations = await watchCsp(page);
    await signInAs(page, STAFF.editor);
    await expectHydrated(page);
    await expect(menu(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(nav(page)).toBeHidden();

    await menu(page).click();
    await expect(menu(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(nav(page)).toBeVisible();
    await expect(nav(page).getByRole('link', { name: 'Tổng quan', exact: true })).toBeFocused();
    await expect(pageColumn(page)).toHaveAttribute('inert');
    // Nothing behind the drawer to skip to.
    await expect(page.getByRole('link', { name: 'Bỏ qua đến nội dung chính' })).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(menu(page)).toBeFocused();
    await expect(pageColumn(page)).not.toHaveAttribute('inert');
    await expect(nav(page)).toBeHidden();

    await menu(page).click();
    await expect(nav(page)).toBeVisible();
    await page.getByRole('button', { name: 'Đóng menu', exact: true }).click();
    await expect(menu(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(menu(page)).toBeFocused();

    // The drawer is 300 px wide: a tap at the right edge falls on the shade over the page.
    await menu(page).click();
    await expect(nav(page)).toBeVisible();
    await page.mouse.click(360, 400);
    await expect(menu(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(menu(page)).toBeFocused();
    await expect(nav(page)).toBeHidden();
    expect(violations).toEqual([]);
  });

  test('following a link in the drawer closes it and puts focus on the new page, the current page’s link too', async ({ page }) => {
    await signInAs(page, STAFF.editor);
    await expectHydrated(page);

    await menu(page).click();
    await nav(page).getByRole('link', { name: 'Nhà hàng', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/restaurants$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nhà hàng');
    await expect(menu(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(pageColumn(page)).not.toHaveAttribute('inert');
    await expect(nav(page)).toBeHidden();
    await expect(page.locator('#admin-main')).toBeFocused();

    // A link to the page already shown changes no path: the drawer closes all the same.
    await menu(page).click();
    await expect(nav(page).getByRole('link', { name: 'Nhà hàng', exact: true })).toBeFocused();
    await nav(page).getByRole('link', { name: 'Nhà hàng', exact: true }).click();
    await expect(menu(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(nav(page)).toBeHidden();
    await expect(page.locator('#admin-main')).toBeFocused();
  });

  test('widening the window past 960 px closes the drawer: the sidebar is a column again', async ({ page }) => {
    await signInAs(page, STAFF.editor);
    await expectHydrated(page);
    await menu(page).click();
    await expect(pageColumn(page)).toHaveAttribute('inert');
    // Focus on the current link: the open drawer's listeners (Escape, the window's width) are in place.
    await expect(nav(page).getByRole('link', { name: 'Tổng quan', exact: true })).toBeFocused();

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(menu(page)).toBeHidden();
    // Hidden on a desktop, so only a query that includes hidden elements still finds it.
    await expect(page.getByRole('button', { name: 'Menu', exact: true, includeHidden: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(pageColumn(page)).not.toHaveAttribute('inert');
    await expect(nav(page)).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
  });
});

test.describe('on a desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the first Tab reaches the skip link, which moves focus to the page', async ({ page }) => {
    const violations = await watchCsp(page);
    await signInAs(page, STAFF.editor);
    // A fresh load, so focus starts at the top of the document.
    await page.goto('/admin');
    await expectHydrated(page);
    await expect(menu(page)).toBeHidden();
    await expect(nav(page)).toBeVisible();

    const skip = page.getByRole('link', { name: 'Bỏ qua đến nội dung chính', exact: true });
    await page.keyboard.press('Tab');
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await expect(skip).toHaveAttribute('href', '#admin-main');
    await page.keyboard.press('Enter');
    await expect(page.locator('#admin-main')).toBeFocused();
    await expect(page.locator('#admin-main')).toHaveRole('main');
    expect(violations).toEqual([]);
  });

  test('the header’s shortcut to a phone booking reads "Tạo đặt bàn", like the page it opens', async ({ page }) => {
    await signInAs(page, STAFF.editor);
    const header = page.getByRole('banner');
    await expect(header.getByRole('link', { name: 'Đặt bàn mới' })).toHaveCount(0);
    const cta = header.getByRole('link', { name: 'Tạo đặt bàn', exact: true });
    await expect(cta).toHaveAttribute('href', '/admin/reservations/new');
    await cta.click();
    await expect(page).toHaveURL(/\/admin\/reservations\/new$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tạo đặt bàn');
  });
});
