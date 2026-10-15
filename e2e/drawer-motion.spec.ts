import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { mockAvailability } from './availability-mock';
import { HOME_PATH } from './paths';

/*
 * The Reserve drawer's way in and out (components/overlays/DrawerMotion.tsx,
 * usePresence in lib/motion.tsx). It slides out after a close, and while it
 * does, the page behind already has the focus and the keyboard back
 * (components/site/Chrome.tsx, useModalOverlays): the leaving panel is no
 * longer a dialog, and inert. Opening it again on its way out turns the same
 * panel round. With reduced motion it opens and closes at once. Animations
 * are slowed through Chrome's DevTools protocol, so a step can land mid-way;
 * availability is mocked: nothing here needs the database.
 */

/* 10:00 on Friday 2 Oct in Da Nang. */
const NOW = new Date('2026-10-02T03:00:00Z');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  await page.clock.setFixedTime(NOW);
  await mockAvailability(page, { today: () => '2026-10-02', now: () => NOW.toISOString() });
});

/** The header's RESERVE (the full header's on a desktop, the compact one's on a phone). */
const reserveButton = (page: Page) => page.getByRole('button', { name: 'RESERVE', exact: true }).filter({ visible: true }).first();

/** What an open overlay makes inert: the plain box around the header and `.page`. */
const behind = (page: Page) => page.locator('.page').locator('xpath=..');

const sessions = new WeakMap<Page, CDPSession>();
/** Every animation on the page at `rate` times its speed (1 is normal). */
async function playAt(page: Page, rate: number) {
  let cdp = sessions.get(page);
  if (!cdp) {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Animation.enable');
    sessions.set(page, cdp);
  }
  await cdp.send('Animation.setPlaybackRate', { playbackRate: rate });
}

/** The drawer's own animations still playing (script ones: not a CSS transition of a hovered day). */
const playing = (page: Page) =>
  page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation) && a.playState === 'running')
        .filter((a) => (a.effect as KeyframeEffect | null)?.target?.closest('.drawer-root')).length,
  );

/** How far the panel stands from its place, in px along x and y. */
const offset = (page: Page) =>
  page.locator('.drawer').evaluate((el) => {
    const m = new DOMMatrix(getComputedStyle(el).transform);
    return { x: Math.round(m.m41), y: Math.round(m.m42) };
  });

async function openAndSettle(page: Page) {
  await reserveButton(page).click();
  const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
  await expect(drawer.locator('.slot').first()).toBeVisible();
  await expect.poll(() => playing(page)).toBe(0);
  return drawer;
}

test.describe('with motion', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('the drawer slides in from the right, its head and form settling after it', async ({ page }) => {
    await page.goto(HOME_PATH);
    await playAt(page, 0.1);
    await reserveButton(page).click();
    await expect(page.getByRole('dialog', { name: 'Reserve a table' }).locator('.drawer-kicker')).toBeFocused();
    const at = await offset(page);
    expect(at.x).toBeGreaterThan(0);
    expect(at.y).toBe(0);
    expect(await playing(page)).toBeGreaterThan(2);
    await playAt(page, 1);
    await expect.poll(() => playing(page)).toBe(0);
    expect(await offset(page)).toEqual({ x: 0, y: 0 });
  });

  test('closing slides the drawer out while the focus is already back on RESERVE, over a page that is no longer inert', async ({ page }) => {
    await page.goto(HOME_PATH);
    const reserve = reserveButton(page);
    await openAndSettle(page);

    await playAt(page, 0.05);
    await page.keyboard.press('Escape');
    // On its way out: still in the document, no longer a dialog, and nothing in it reachable.
    const root = page.locator('.drawer-root');
    await expect(root).toHaveAttribute('inert', '');
    await expect(page.getByRole('dialog', { name: 'Reserve a table' })).toHaveCount(0);
    await expect(reserve).toBeFocused();
    await expect(behind(page)).not.toHaveAttribute('inert');
    expect(await playing(page)).toBeGreaterThan(0);
    await expect.poll(async () => (await offset(page)).x).toBeGreaterThan(0);

    // Then it leaves, and the focus stays where it went.
    await playAt(page, 1);
    await expect(root).toHaveCount(0);
    await expect(reserve).toBeFocused();
  });

  test('opening the drawer again on its way out turns the same panel round', async ({ page }) => {
    await page.goto(HOME_PATH);
    const drawer = await openAndSettle(page);
    await drawer.getByRole('textbox', { name: /^Full name/ }).fill('Lan Anh');
    await page.locator('.drawer-root').evaluate((el) => el.setAttribute('data-e2e-mark', ''));

    await playAt(page, 0.05);
    await page.keyboard.press('Escape');
    await expect(page.locator('.drawer-root')).toHaveAttribute('inert', '');
    await expect.poll(async () => (await offset(page)).x).toBeGreaterThan(0);

    // The leaving panel lets the click through to the page's RESERVE.
    await reserveButton(page).click();
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('.drawer-kicker')).toBeFocused();
    await expect(behind(page)).toHaveAttribute('inert');
    // The same panel, not a new one, coming back from where it was, with what the guest typed.
    await expect(page.locator('.drawer-root[data-e2e-mark]')).toHaveCount(1);
    await expect(page.locator('.drawer-root')).not.toHaveAttribute('inert');
    await expect(drawer.getByRole('textbox', { name: /^Full name/ })).toHaveValue('Lan Anh');

    await playAt(page, 1);
    await expect.poll(() => playing(page)).toBe(0);
    expect(await offset(page)).toEqual({ x: 0, y: 0 });
    await expect(page.locator('.drawer-root[data-e2e-mark]')).toHaveCount(1);
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });

    test('the drawer, the whole screen wide, rises from the foot of it and goes back down', async ({ page }) => {
      await page.goto(HOME_PATH);
      await playAt(page, 0.1);
      await reserveButton(page).click();
      const at = await offset(page);
      expect(at.x).toBe(0);
      expect(at.y).toBeGreaterThan(0);

      await playAt(page, 1);
      await expect.poll(() => playing(page)).toBe(0);
      await playAt(page, 0.05);
      await page.keyboard.press('Escape');
      await expect.poll(async () => (await offset(page)).y).toBeGreaterThan(0);
      expect((await offset(page)).x).toBe(0);
      await playAt(page, 1);
      await expect(page.locator('.drawer-root')).toHaveCount(0);
    });
  });
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the drawer opens and closes at once, without moving', async ({ page }) => {
    await page.goto(HOME_PATH);
    const reserve = reserveButton(page);
    await reserve.click();
    const drawer = page.getByRole('dialog', { name: 'Reserve a table' });
    await expect(drawer.locator('.slot').first()).toBeVisible();
    expect(await playing(page)).toBe(0);
    expect(await offset(page)).toEqual({ x: 0, y: 0 });

    await page.keyboard.press('Escape');
    // Gone in the same update as the close: no assertion that waits.
    expect(await page.locator('.drawer-root').count()).toBe(0);
    await expect(reserve).toBeFocused();
    await expect(behind(page)).not.toHaveAttribute('inert');
  });
});
