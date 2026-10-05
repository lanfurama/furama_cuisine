import { expectHydrated } from './csp';
import { STAFF, expect, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * The phase-7A editors on a phone (UX-6): at 375 px no screen is wider than
 * the viewport, with every <details> open (pickers, uploaders, contexts), so
 * nothing scrolls sideways. Read-only: it opens pages and changes nothing.
 */

const SCREENS = ['/admin/content/hero', '/admin/restaurants', '/admin/restaurants/taya-house', '/admin/content/sections', '/admin/media'];

test.use({ viewport: { width: 375, height: 800 } });

test.beforeAll(() => seedStaff());

test('the 7A screens fit a 375 px phone with every details open', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  const wide: string[] = [];
  for (const path of SCREENS) {
    await page.goto(path);
    await expectHydrated(page);
    await page.locator('details').evaluateAll((all) => all.forEach((d) => ((d as HTMLDetailsElement).open = true)));
    const width = await page.evaluate(() => document.scrollingElement?.scrollWidth ?? 0);
    if (width > 375) wide.push(`${path}: ${width}px`);
  }
  expect(wide).toEqual([]);
});
