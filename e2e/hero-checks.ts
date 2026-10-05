import { expect, type Locator, type Page } from '@playwright/test';

/*
 * How a home page without its hero must look (phase-6 F-A, styles/layout.css):
 * a solid, condensed header from the top, and the first section below it.
 * Shared by e2e/home-heroless.spec.ts (the CSS contract, the hero taken out
 * in the browser) and e2e/content-hero.serial.spec.ts (the hero really
 * switched off by an editor, L7-1).
 */

/** Runs in the page: the alpha of a computed colour ("rgba(20, 32, 28, 0)" is 0, "rgb(…)" 1). */
export function backgroundAlpha(el: Element): number {
  const parts = (getComputedStyle(el).backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
  return parts.length === 4 ? parts[3] : 1;
}

/** Runs in the page: how far the page's first visible section starts below the visible header's bottom (negative: under it), and which section that is. */
export function firstSectionBelowHeader(main: HTMLElement): { gap: number; section: string } {
  const visible = (el: Element) => el.getClientRects().length > 0;
  const header = [...document.querySelectorAll('header')].find(visible);
  const first = [...main.querySelectorAll<HTMLElement>(':scope > section')].find(visible);
  if (!header || !first) throw new Error('no visible header or section');
  return {
    gap: first.getBoundingClientRect().top - header.getBoundingClientRect().bottom,
    section: first.id || first.getAttribute('aria-label') || first.className,
  };
}

/** The visible header is solid (and, on desktop, condensed) at the top, and `first` starts below it. */
export async function expectSolidAndClear(page: Page, home: Locator, width: number, first: string) {
  const header = page.getByRole('banner');
  await expect.poll(() => header.evaluate(backgroundAlpha)).toBeGreaterThanOrEqual(0.9);
  if (width >= 1080) {
    // The roomy header condenses, as once scrolled.
    const solid = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h-solid')));
    expect(solid).toBe(76);
    await expect.poll(() => header.evaluate((el) => el.getBoundingClientRect().height)).toBe(solid);
  }
  expect((await home.evaluate(firstSectionBelowHeader)).section).toBe(first);
  await expect.poll(async () => (await home.evaluate(firstSectionBelowHeader)).gap).toBeGreaterThanOrEqual(0);
}

export const VIEWPORTS = [
  // The finder comes first from 760 px up; on a phone it is Cuisines.
  { width: 1280, height: 860, first: 'Find a restaurant' },
  { width: 900, height: 860, first: 'Find a restaurant' },
  { width: 390, height: 844, first: 'cuisines' },
];
