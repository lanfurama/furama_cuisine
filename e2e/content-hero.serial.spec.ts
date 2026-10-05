import type { Browser, Page } from '@playwright/test';
import { REGISTRY } from '../lib/i18n/registry';
import { expectHydrated, watchCsp } from './csp';
import { backgroundAlpha, expectSolidAndClear, VIEWPORTS } from './hero-checks';
import { HOME_PATH } from './paths';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * The sections and hero editors in a browser (spec §7.2 content/sections and
 * content/hero), and the end-to-end test the phase-6 ledger ruled for F-A
 * (L7-1): an editor hides the hero, first by its section's switch, then by
 * unpublishing every slide; at 1280, 900 and 390 px the home page then has a
 * solid header at the top, exactly one <h1> (the hidden one, in the hero's
 * words) and its first section below the header. Putting it back through
 * History and through the save (R21) brings the transparent header and the
 * hero's own <h1> back. Also the film's link (YouTube plays in the guest
 * dialog; a link that names no video is refused) and the hero's words.
 *
 * Serial (desktop-serial): every test changes what every guest page reads and
 * puts it back through the same screens; afterAll repairs by SQL, then a save,
 * only if a step failed half-way.
 */

const TITLE = [REGISTRY['hero.title_1'].en, REGISTRY['hero.title_2'].en, REGISTRY['hero.title_3'].en].join(' ');
const SAVED = 'Đã lưu. Trang khách cập nhật ngay.';
const SLIDES = ['hero-taya.jpg', 'hero-indochine.jpg', 'hero-beach.jpg'];

async function visitor(browser: Browser, viewport = { width: 1280, height: 860 }): Promise<Page> {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

/** L7-1 at every width: no hero, a solid header at the top, one <h1> (the hidden one), the first section below the header. */
async function expectNoHero(browser: Browser) {
  for (const { width, height, first } of VIEWPORTS) {
    const guest = await visitor(browser, { width, height });
    try {
      const home = guest.locator('main[data-view="home"]');
      await expect
        .poll(
          async () => {
            await guest.goto(HOME_PATH);
            return home.getAttribute('data-hero');
          },
          { timeout: 10_000 },
        )
        .toBe('none');
      expect(await guest.evaluate(() => window.scrollY)).toBe(0);
      await expect(guest.locator('#top')).toHaveCount(0);
      await expect(guest.locator('h1')).toHaveCount(1);
      await expect(guest.locator('h1')).toHaveText(TITLE);
      await expectSolidAndClear(guest, home, width, first);
    } finally {
      await guest.context().close();
    }
  }
}

/** The hero is back at every width: its own <h1>, the only one, and the header transparent over it at the top. */
async function expectHero(browser: Browser) {
  for (const { width, height } of VIEWPORTS) {
    const guest = await visitor(browser, { width, height });
    try {
      await expect
        .poll(
          async () => {
            await guest.goto(HOME_PATH);
            return guest.locator('#top').count();
          },
          { timeout: 10_000 },
        )
        .toBe(1);
      await expect(guest.locator('main[data-view="home"]')).not.toHaveAttribute('data-hero', 'none');
      await expect(guest.locator('h1')).toHaveCount(1);
      await expect(guest.locator('#top h1.hero-title')).toBeVisible();
      await expect.poll(() => guest.getByRole('banner').evaluate(backgroundAlpha)).toBeLessThan(0.5);
    } finally {
      await guest.context().close();
    }
  }
}

/** One home section's form on the sections screen. */
const sectionForm = (page: Page, label: string) => page.getByRole('region', { name: label, exact: true }).getByRole('form', { name: label });

test.beforeAll(() => seedStaff());

test.afterAll(async ({ browser }) => {
  const broken = await one(
    `SELECT 1 AS broken WHERE EXISTS (SELECT 1 FROM sections WHERE (key = 'hero' AND NOT is_visible) OR (key = 'film' AND link_url IS NOT NULL))
        OR EXISTS (SELECT 1 FROM hero_slides WHERE NOT is_published)
        OR EXISTS (SELECT 1 FROM content_strings WHERE key LIKE 'hero.%')`,
  );
  if (!broken) return;
  await one(`UPDATE sections SET is_visible = true, link_url = CASE WHEN key = 'film' THEN NULL ELSE link_url END WHERE key IN ('hero', 'film')`);
  await one(`UPDATE hero_slides SET is_published = true WHERE NOT is_published`);
  await one(`DELETE FROM content_strings WHERE key LIKE 'hero.%'`);
  // The SQL expires nothing: a save of the hero section, unchanged, does (content:sections; every guest page carries it, D2).
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/content/sections');
  await sectionForm(page, 'Hero (ảnh lớn đầu trang)').getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(sectionForm(page, 'Hero (ảnh lớn đầu trang)').getByRole('status')).toHaveText(SAVED);
  await page.context().close();
});

test('L7-1: the hero switched off on the sections screen leaves a solid header, one h1 and the page below it at every width; History brings it back', async ({
  page,
  browser,
}) => {
  const csp = await watchCsp(page);
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/content');
  await page.getByRole('link', { name: 'Section trang chủ' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Section trang chủ');
  await expectHydrated(page);
  const hero = sectionForm(page, 'Hero (ảnh lớn đầu trang)');
  // Restaurants has no switch to turn off (spec §6.5).
  await expect(sectionForm(page, 'Nhà hàng').getByRole('checkbox')).toHaveCount(0);

  await hero.getByRole('checkbox', { name: 'Hiện trên trang chủ' }).uncheck();
  await hero.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(hero.getByRole('status')).toHaveText(SAVED);
  await expectNoHero(browser);

  const history = page.getByRole('region', { name: 'Lịch sử: Hero (ảnh lớn đầu trang)' });
  await expect(history.getByRole('listitem').first()).toContainText('Đổi: Hiện trên trang chủ');
  page.once('dialog', (d) => void d.accept());
  await history.getByRole('listitem').first().getByRole('button', { name: /^Khôi phục bản trước lần này/ }).click();
  await expect(hero.getByRole('checkbox', { name: 'Hiện trên trang chủ' })).toBeChecked();
  await expectHero(browser);
  expect(csp).toEqual([]);
});

test('L7-1: every slide unpublished on the hero screen does the same; showing them again through the save brings the hero back', async ({ page, browser }) => {
  const csp = await watchCsp(page);
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/content/hero');
  await expectHydrated(page);
  const list = page.getByRole('list', { name: 'Thứ tự slide' });
  // The thumbnails go through /_next/image under the admin CSP (R18, code rule 6).
  await expect.poll(() => list.locator('img').first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

  // Slide 1 has the only phone crop: hiding it while another slide shows is refused (spec §6.5).
  await list.getByRole('button', { name: 'Ẩn “hero-beach.jpg”' }).click();
  await expect(list.getByRole('alert')).toBeVisible();
  await expect(list.getByText('Slide đầu tiên đang hiện cần ảnh cắt cho điện thoại', { exact: false })).toBeVisible();
  await expect(list.getByRole('button', { name: 'Ẩn “hero-beach.jpg”' })).toBeVisible();

  for (const name of SLIDES) {
    await list.getByRole('button', { name: `Ẩn “${name}”` }).click();
    await expect(list.getByRole('button', { name: `Hiện “${name}”` })).toBeVisible();
  }
  await expect(page.getByText('Đang hiện 0/5 mục')).toBeVisible();
  await expectNoHero(browser);

  for (const name of [...SLIDES].reverse()) {
    await list.getByRole('button', { name: `Hiện “${name}”` }).click();
    await expect(list.getByRole('button', { name: `Ẩn “${name}”` })).toBeVisible();
  }
  await expectHero(browser);
  expect(csp).toEqual([]);
});

test('the film: a link that names no video is refused; a YouTube link plays in the guest dialog; put back after', async ({ page, browser }) => {
  const guest = await visitor(browser);
  const outside: string[] = [];
  await guest.context().route(/^https?:\/\//, async (route) => {
    const url = new URL(route.request().url());
    if (['localhost', '127.0.0.1'].includes(url.hostname)) return route.fallback();
    // The player is expected to try (no network in tests); its address is what is asserted.
    if (!['www.youtube-nocookie.com', 'player.vimeo.com'].includes(url.hostname)) outside.push(url.origin);
    return route.abort('blockedbyclient');
  });
  const film = page.getByRole('form', { name: 'Phim' });
  const saveLink = async (link: string) => {
    await page.goto('/admin/content/hero');
    await film.getByLabel('Link video (YouTube hoặc Vimeo)', { exact: true }).fill(link);
    await film.getByRole('button', { name: 'Lưu', exact: true }).click();
  };
  const dialog = guest.getByRole('dialog', { name: REGISTRY['film.aria'].en });
  try {
    await signInAs(page, STAFF.editor);
    await saveLink('https://example.com/video.mp4');
    await expect(film.getByText('Dán link một video YouTube hoặc Vimeo', { exact: false })).toBeVisible();
    await expect(film.getByLabel('Link video (YouTube hoặc Vimeo)', { exact: true })).toHaveAttribute('aria-invalid', 'true');

    await saveLink('https://youtu.be/dQw4w9WgXcQ');
    await expect(film.getByRole('status')).toHaveText(SAVED);
    await guest.goto(HOME_PATH);
    await guest.getByRole('button', { name: REGISTRY['hero.cta_film'].en }).click();
    await expect(dialog.locator('iframe')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0');
    await expect(dialog.locator('iframe')).toHaveAttribute('title', REGISTRY['film.player_title'].en);
  } finally {
    await saveLink('');
    await expect(film.getByRole('status')).toHaveText(SAVED);
    await guest.goto(HOME_PATH);
    await guest.getByRole('button', { name: REGISTRY['hero.cta_film'].en }).click();
    await expect(dialog.getByText(REGISTRY['film.coming_soon'].en)).toBeVisible();
    await guest.context().close();
  }
  expect(outside).toEqual([]);
});

test('the hero’s words are the hero screen’s: an edited kicker reaches the guest within seconds, and the default comes back', async ({ page, browser }) => {
  const guest = await visitor(browser);
  const kicker = guest.locator('.hero-kicker');
  const form = page.getByRole('form', { name: 'Chữ hero và phim' });
  const save = async (value: string) => {
    await page.goto('/admin/content/hero');
    await form.getByLabel('Dòng nhỏ phía trên tiêu đề', { exact: true }).fill(value);
    await form.getByRole('button', { name: 'Lưu chữ hero và phim' }).click();
    await expect(form.getByRole('status')).toContainText('Đã lưu 1 mục');
  };
  try {
    await guest.goto(HOME_PATH);
    await expect(kicker).toHaveText(REGISTRY['hero.kicker'].en);
    await signInAs(page, STAFF.editor);
    try {
      await save('Since 1997 · Da Nang');
      const started = Date.now();
      await guest.reload();
      await expect(kicker).toHaveText('Since 1997 · Da Nang');
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      await save(REGISTRY['hero.kicker'].en);
    }
    await guest.reload();
    await expect(kicker).toHaveText(REGISTRY['hero.kicker'].en);
    expect(await one(`SELECT 1 FROM content_strings WHERE key = 'hero.kicker'`)).toBeUndefined();
  } finally {
    await guest.context().close();
  }
});
