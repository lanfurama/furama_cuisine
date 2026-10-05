import type { Browser, Page } from '@playwright/test';
import { expectHydrated, watchCsp } from './csp';
import { HOME_PATH } from './paths';
import { STAFF, expect, one, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * The Experiences and Stories list editors in a browser (spec §7.2
 * content/experiences and content/stories): an Editor gives an Experiences
 * row its link (the owner's content) and a new title, and guests follow it
 * within seconds; a story without its category shows the date alone, with no
 * stray separator (L7-7). History puts both back.
 *
 * Serial (desktop-serial): every guest page reads these lists (phase-6 D2);
 * each test puts its row back through History; afterAll repairs by SQL, then
 * a save, only if a step failed half-way.
 */

const SAVED = 'Đã lưu. Trang khách cập nhật ngay.';
const LINK = 'https://furamavietnam.com/meetings-events/';

async function guest(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

/** The second Experiences row as the home page draws it: its words and where it leads. */
async function secondRow(visitor: Page): Promise<{ text: string; href: string | null }> {
  await visitor.goto(HOME_PATH);
  const row = visitor.locator('#experiences .experience-row').nth(1);
  return { text: (await row.locator('.experience-name').textContent()) ?? '', href: await row.getAttribute('href') };
}

async function firstKicker(visitor: Page): Promise<string> {
  await visitor.goto(HOME_PATH);
  return (await visitor.locator('#stories .story-kicker').first().textContent()) ?? '';
}

test.beforeAll(() => seedStaff());

test.afterAll(async ({ browser }) => {
  const broken = await one(
    `SELECT 1 AS broken WHERE EXISTS (SELECT 1 FROM experiences WHERE id = 2 AND link_url IS NOT NULL)
        OR EXISTS (SELECT 1 FROM experience_i18n WHERE experience_id = 2 AND locale = 'en' AND title <> 'Private Dining & Events')
        OR EXISTS (SELECT 1 FROM story_i18n WHERE story_id = 1 AND locale = 'en' AND category IS DISTINCT FROM 'Restaurant News')`,
  );
  if (!broken) return;
  await one(`UPDATE experiences SET link_url = NULL WHERE id = 2`);
  await one(`UPDATE experience_i18n SET title = 'Private Dining & Events' WHERE experience_id = 2 AND locale = 'en'`);
  await one(`UPDATE story_i18n SET category = 'Restaurant News' WHERE story_id = 1 AND locale = 'en'`);
  // The SQL expires nothing: a save of each row, unchanged, does (content:experiences, content:stories).
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, STAFF.editor);
  for (const [path, list, name, button] of [
    ['/admin/content/experiences', 'Thứ tự Experiences', 'Private Dining & Events', 'Lưu mục'],
    ['/admin/content/stories', 'Thứ tự Stories', 'Grand opening: one house, four flavours in An Thượng', 'Lưu câu chuyện'],
  ]) {
    await page.goto(path);
    const row = page.getByRole('list', { name: list }).getByRole('listitem').filter({ hasText: name });
    await row.getByText(`Sửa “${name}”`).click();
    await row.getByRole('button', { name: button }).click();
    await expect(row.getByRole('status')).toHaveText(SAVED);
  }
  await page.context().close();
});

test('an Editor gives an Experiences row its link and a new title: guests follow it within seconds; History puts the row back', async ({ page, browser }) => {
  const csp = await watchCsp(page);
  const visitor = await guest(browser);
  try {
    expect(await secondRow(visitor)).toEqual({ text: 'Private Dining & Events', href: '#experiences' });
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/content/experiences');
    await expectHydrated(page);
    const row = page.getByRole('list', { name: 'Thứ tự Experiences' }).getByRole('listitem').filter({ hasText: 'Private Dining & Events' });
    await row.getByText('Sửa “Private Dining & Events”').click();
    const form = row.getByRole('form', { name: 'Mục “Private Dining & Events”' });
    await form.getByLabel('Tiêu đề', { exact: true }).fill('Private Dining & Weddings');
    await form.getByLabel('Link', { exact: true }).fill(LINK);
    await form.getByRole('button', { name: 'Lưu mục' }).click();
    // The form is named after the row, so after the rename it is found through its row.
    const renamed = page.getByRole('list', { name: 'Thứ tự Experiences' }).getByRole('listitem').filter({ hasText: 'Private Dining & Weddings' });
    await expect(renamed.getByRole('status')).toHaveText(SAVED);
    const saved = Date.now();
    await expect.poll(() => secondRow(visitor), { timeout: 10_000 }).toEqual({ text: 'Private Dining & Weddings', href: LINK });
    expect(Date.now() - saved).toBeLessThan(5000);

    const history = renamed.getByRole('region', { name: 'Lịch sử: Private Dining & Weddings' });
    await expect(history.getByRole('listitem').first()).toContainText('Đổi: Tiêu đề, Link');
    page.once('dialog', (d) => void d.accept());
    await history.getByRole('listitem').first().getByRole('button', { name: /^Khôi phục bản trước lần này/ }).click();
    await expect.poll(() => secondRow(visitor), { timeout: 10_000 }).toEqual({ text: 'Private Dining & Events', href: '#experiences' });
    expect(csp).toEqual([]);
  } finally {
    await visitor.context().close();
  }
});

test('a story without its category shows its date alone, with no stray separator (L7-7); History puts the category back', async ({ page, browser }) => {
  const csp = await watchCsp(page);
  const visitor = await guest(browser);
  const name = 'Grand opening: one house, four flavours in An Thượng';
  try {
    expect(await firstKicker(visitor)).toBe('Restaurant News · 9 Sep 2026');
    await signInAs(page, STAFF.editor);
    await page.goto('/admin/content/stories');
    await expectHydrated(page);
    const row = page.getByRole('list', { name: 'Thứ tự Stories' }).getByRole('listitem').filter({ hasText: name });
    await row.getByText(`Sửa “${name}”`).click();
    const form = row.getByRole('form', { name: `Câu chuyện “${name}”` });
    await form.getByLabel('Chuyên mục', { exact: true }).fill('');
    await form.getByRole('button', { name: 'Lưu câu chuyện' }).click();
    await expect(form.getByRole('status')).toHaveText(SAVED);
    await expect.poll(() => firstKicker(visitor), { timeout: 10_000 }).toBe('9 Sep 2026');

    const history = row.getByRole('region', { name: `Lịch sử: ${name}` });
    page.once('dialog', (d) => void d.accept());
    await history.getByRole('listitem').first().getByRole('button', { name: /^Khôi phục bản trước lần này/ }).click();
    await expect.poll(() => firstKicker(visitor), { timeout: 10_000 }).toBe('Restaurant News · 9 Sep 2026');
    expect(csp).toEqual([]);
  } finally {
    await visitor.context().close();
  }
});
