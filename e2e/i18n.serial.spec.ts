import { readFileSync } from 'node:fs';
import type { Browser, Page } from '@playwright/test';
import { REGISTRY } from '../lib/i18n/registry';
import { expectHydrated } from './csp';
import { STAFF, db, expect, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * The languages are code (lib/i18n/site-locales.ts: English and Vietnamese,
 * owner 2026-10-14): the switcher offers Vietnamese and keeps the page, a
 * language that is not on is a 404, the admin has no language screen, and
 * Vietnamese saved in the admin reaches /vi; a booking on /vi keeps it.
 *
 * Serial (desktop-serial): it writes Vietnamese text every guest page reads.
 */

async function guest(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

test.beforeAll(() => seedStaff());

test('the switcher opens the same page in Vietnamese and remembers it; a language that is not on is a 404', async ({ browser }) => {
  const visitor = await guest(browser);
  await visitor.goto('/en/restaurants/taya-house?x=1');
  await visitor.locator('.hdr-lang-btn').click();
  await Promise.all([visitor.waitForURL(/\/vi\/restaurants\/taya-house\?x=1$/), visitor.getByRole('link', { name: 'Tiếng Việt' }).click()]);
  await expect(visitor.locator('html')).toHaveAttribute('lang', 'vi');
  expect((await visitor.context().cookies()).find((c) => c.name === 'NEXT_LOCALE')?.value).toBe('vi');
  expect((await visitor.goto('/ko'))?.status()).toBe(404);
  expect(await (await visitor.request.get('/sitemap.xml')).text()).toContain('/vi');
  await visitor.context().close();
});

test('the admin has no language screen', async ({ page }) => {
  await signInAs(page, STAFF.admin);
  await expect(page.getByRole('link', { name: 'Ngôn ngữ' })).toHaveCount(0);
});

test('a content form has a tab per language: a Vietnamese save shows on /vi, and an English edit marks it "EN đã đổi"', async ({ page, browser }) => {
  const c = db();
  await c.connect();
  const { rows } = await c.query<{ title: string }>(`SELECT title FROM offer_i18n WHERE offer_id = 2 AND locale = 'en'`);
  const original = rows[0].title;
  try {
    await signInAs(page, STAFF.admin);

    await page.goto('/admin/content/offers/2');
    const tabs = page.getByRole('tablist', { name: 'Tiêu đề: ngôn ngữ' });
    await expect(tabs.getByRole('tab')).toHaveText(['EN', 'VIChưa dịch']);
    await tabs.getByRole('tab', { name: /VI/ }).click();
    await page.locator('input[name="title.vi"]').fill('Lớp học nấu ăn Việt');
    await page.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Đã lưu' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('tablist', { name: 'Tiêu đề: ngôn ngữ' }).getByRole('tab')).toHaveText(['EN', 'VIĐã duyệt']);

    const visitor = await guest(browser);
    await visitor.goto('/vi');
    await expect(visitor.getByText('Lớp học nấu ăn Việt').first()).toBeAttached();

    await page.locator('input[name="title.en"]').fill(`${original}!`);
    await page.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Đã lưu' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('tablist', { name: 'Tiêu đề: ngôn ngữ' }).getByRole('tab')).toHaveText(['EN', 'VIEN đã đổi']);
  } finally {
    await c.query(`DELETE FROM offer_i18n WHERE offer_id = 2 AND locale <> 'en'`);
    await c.query(`UPDATE offer_i18n SET title = $1 WHERE offer_id = 2 AND locale = 'en'`, [original]);
    await c.end();
  }
});

test('a strings screen edits one language: Vietnamese text saved on ?lang=vi shows on /vi, English stays', async ({ page, browser }) => {
  const c = db();
  await c.connect();
  try {
    await signInAs(page, STAFF.admin);

    await page.goto('/admin/content/stories');
    await expectHydrated(page);
    await page.getByRole('navigation', { name: 'Ngôn ngữ đang sửa' }).getByRole('link', { name: 'Tiếng Việt' }).click();
    await page.waitForURL(/\?lang=vi#strings-stories$/);
    // The screen's strings form (the cards' list has its own form of the same name).
    const form = page.locator('form').filter({ has: page.locator('[name="v:stories.title"]') });
    await expect(form).toContainText('Đang sửa: Tiếng Việt');
    await expectHydrated(page);
    const field = form.getByLabel(/^Tiêu đề mục Stories/);
    await expect(field).toHaveValue('');
    await expect(field).toHaveAttribute('placeholder', 'Stories from our Kitchens');
    await expect(form.locator('label', { hasText: 'Tiêu đề mục Stories' })).toContainText('Chưa dịch');
    await field.fill('Chuyện từ gian bếp');
    await form.getByRole('button', { name: 'Lưu stories' }).click();
    await expect(form.getByRole('status')).toContainText('Đã lưu 1 mục');
    await expect(form.locator('label', { hasText: 'Tiêu đề mục Stories' })).toContainText('Đã duyệt');

    const visitor = await guest(browser);
    await visitor.goto('/vi');
    await expect(visitor.getByRole('heading', { level: 2, name: 'Chuyện từ gian bếp' })).toBeVisible();
    await visitor.goto('/en');
    await expect(visitor.getByRole('heading', { level: 2, name: 'Stories from our Kitchens' })).toBeVisible();
    await visitor.context().close();
  } finally {
    await c.query(`DELETE FROM content_strings WHERE key = 'stories.title'`);
    await c.end();
  }
});

test('the Vietnamese email screen previews the Vietnamese being typed, the staff email too (R7, 7A ledger A4)', async ({ page }) => {
  await signInAs(page, STAFF.editor);
  await page.goto('/admin/content/emails?lang=vi');
  await expectHydrated(page);
  const form = page.getByRole('form', { name: 'Nội dung email' });
  await expect(form).toContainText('Đang sửa: Tiếng Việt');
  const heading = form.getByLabel(/^Dòng tiêu đề trong email \(Báo nhân viên: đặt bàn mới\)/);
  await expect(heading).toHaveValue('Có đặt bàn online mới');
  await heading.fill('Đặt bàn mới, chưa lưu');
  await form.getByLabel('Loại email', { exact: true }).selectOption('staff.new');
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/admin/emails/preview') && r.request().method() === 'POST'),
    form.getByRole('button', { name: 'Xem trước' }).click(),
  ]);
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain('Đặt bàn mới, chưa lưu');
  expect(body).toContain('· vi</div>');
});

test('an Editor approves a machine translation on Bản dịch: /vi shows it only once it is reviewed', async ({ page, browser }) => {
  const c = db();
  await c.connect();
  const { rows } = await c.query<{ title: string }>(`SELECT title FROM offer_i18n WHERE offer_id = 2 AND locale = 'en'`);
  const english = rows[0].title;
  const machine = 'Lớp nấu ăn (máy dịch)';
  try {
    await c.query(`INSERT INTO offer_i18n (offer_id, locale, title, status, origin, ai_model) VALUES (2, 'vi', $1, 'machine', 'ai', 'e2e')`, [machine]);
    await signInAs(page, STAFF.admin);

    const visitor = await guest(browser);
    const titles = () => visitor.locator('#offers .offer-title').allTextContents();
    await visitor.goto('/vi');
    expect(await titles()).toContain(english);
    expect(await titles()).not.toContain(machine);

    const editor = await (await browser.newContext()).newPage();
    await signInAs(editor, STAFF.editor);
    await editor.getByRole('link', { name: 'Bản dịch' }).click();
    await expect(editor.getByRole('heading', { level: 1, name: 'Bản dịch' })).toBeVisible();
    await editor.getByRole('combobox', { name: 'Ngôn ngữ' }).selectOption('vi');
    await editor.getByRole('combobox', { name: 'Loại' }).selectOption('offers');
    await editor.getByRole('button', { name: 'Lọc' }).click();
    const queue = editor.getByRole('form', { name: 'Hàng chờ duyệt' });
    await expect(queue.getByRole('row')).toHaveCount(2);
    await expect(queue).toContainText(machine);
    await expectHydrated(editor);
    await queue.getByRole('button', { name: /^Duyệt: Ưu đãi 2 \(VI\)$/ }).click();
    await expect(editor.getByText('Không có bản dịch nào chờ duyệt.')).toBeVisible();

    await visitor.reload();
    expect(await titles()).toContain(machine);
    await visitor.context().close();
    await editor.context().close();
  } finally {
    await c.query(`DELETE FROM offer_i18n WHERE offer_id = 2 AND locale <> 'en'`);
    await c.end();
  }
});

type Logged = { to: string; subject: string; text: string; html: string };
function logged(): Logged[] {
  const file = process.env.EMAIL_LOG_FILE;
  if (!file) throw new Error('Set EMAIL_LOG_FILE (the server writes emails there) to run the booking email tests.');
  try {
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Logged);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/** Books Café Indochine's last open day from `path` (its drawer in English but for `submit`), and returns the reference. */
async function bookFrom(visitor: Page, path: string, email: string, submit: string): Promise<string> {
  await visitor.goto(path);
  await visitor.locator('.rcard:visible', { hasText: 'Café Indochine' }).first().click();
  const drawer = visitor.getByRole('dialog', { name: 'Reserve a table' });
  await drawer.locator('.daystrip .day[data-state="open"]').last().click();
  await drawer.locator('.slot:not([disabled])').first().click();
  await drawer.getByLabel('Full name *', { exact: true }).fill('Nguyễn Minh Anh');
  const digits = String(Date.now()).slice(-6);
  await drawer.getByLabel('Phone *', { exact: true }).fill(`0907 ${digits.slice(0, 3)} ${digits.slice(3)}`);
  await drawer.getByLabel('Email', { exact: true }).fill(email);
  await drawer.getByRole('checkbox', { name: REGISTRY['booking.consent'].en }).check();
  await drawer.getByRole('button', { name: submit }).click();
  await expect(drawer.locator('.drawer-ref')).toHaveText(/^FC-[0-9A-HJKMNP-TV-Z]{8}$/);
  return (await drawer.locator('.drawer-ref').textContent()) ?? '';
}

/** Saves booking.submit's Vietnamese on the booking screen's strings form ('' puts the English back). */
async function saveSubmitWord(page: Page, value: string) {
  await page.goto('/admin/content/booking?lang=vi');
  await expectHydrated(page);
  const form = page.locator('form').filter({ has: page.locator('[name="v:booking.submit"]') });
  await expect(form).toContainText('Đang sửa: Tiếng Việt');
  await form.getByLabel(/^Nút gửi yêu cầu đặt bàn/).fill(value);
  await form.getByRole('button', { name: /^Lưu/ }).click();
  await expect(form.getByRole('status')).toContainText('Đã lưu');
}

test('a booking on /vi is kept in Vietnamese with the consent it showed; its emails go out in Vietnamese; /en books in English with en-GB dates (spec §13)', async ({
  page,
  browser,
}) => {
  const c = db();
  await c.connect();
  try {
    // A Vietnamese drawer word, saved on the booking screen so the cached /vi pages learn of it (the rest falls back to English).
    await signInAs(page, STAFF.admin);
    await saveSubmitWord(page, 'GỬI YÊU CẦU');

    const visitor = await guest(browser);
    const viGuest = `vi-${Date.now()}@example.com`;
    const vi = await bookFrom(visitor, '/vi', viGuest, 'GỬI YÊU CẦU');
    const policy = (await c.query<{ version: string }>(`SELECT version FROM legal_versions WHERE locale = 'en' ORDER BY created_at DESC, version DESC LIMIT 1`)).rows[0].version;
    expect((await c.query(`SELECT locale, consent_locale, consent_version FROM reservations WHERE reference = $1`, [vi])).rows).toEqual([
      // Vietnamese has no policy wording of its own yet: the guest agreed to the English one, and the booking says which.
      { locale: 'vi', consent_locale: 'en', consent_version: policy },
    ]);
    await expect.poll(() => logged().find((e) => e.to === viGuest && e.subject.includes(vi))?.subject).toBe(`Chúng tôi đã nhận yêu cầu đặt bàn của bạn (${vi})`);
    const ack = logged().find((e) => e.to === viGuest && e.subject.includes(vi))!;
    expect(ack.html).toContain('lang="vi"');
    expect(ack.text).toContain('Yêu cầu đặt bàn của bạn tại Café Indochine đã được tiếp nhận.');
    // The staff email goes to the shared inbox in the staff's language (the default staff locale, Vietnamese).
    await expect.poll(() => logged().find((e) => e.to !== viGuest && e.subject.includes(vi))?.subject).toMatch(new RegExp(`^Đặt bàn mới ${vi}: Café Indochine, `));

    const enGuest = `en-${Date.now()}@example.com`;
    const en = await bookFrom(visitor, '/en', enGuest, 'REQUEST BOOKING');
    await expect.poll(() => logged().find((e) => e.to === enGuest && e.subject.includes(en))?.subject).toBe(`We have received your table request (${en})`);
    const enAck = logged().find((e) => e.to === enGuest && e.subject.includes(en))!;
    // Day first and a 24-hour clock (R8-8): "Monday, 5 October 2026", "19:00 (Da Nang time, GMT+7)".
    expect(enAck.text).toMatch(/[A-Z][a-z]+day, \d{1,2} [A-Z][a-z]+ \d{4}/);
    expect(enAck.text).toMatch(/\b\d{2}:\d{2} \(Da Nang time, GMT\+7\)/);
    await visitor.context().close();
  } finally {
    // Emptied, the key falls back to English again, through the screen so no cached page keeps the word.
    await saveSubmitWord(page, '');
    await c.end();
  }
});
