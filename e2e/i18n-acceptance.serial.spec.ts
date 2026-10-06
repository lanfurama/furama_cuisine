import type { Browser, Page } from '@playwright/test';
import { REGISTRY, STRING_KEYS } from '../lib/i18n/registry';
import { expectHydrated } from './csp';
import { STAFF, db, expect, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * Phase 8's acceptance (spec §14.1 row 8, §13): on one build, made while only
 * English was on, an Admin adds Korean, translates it (an email key, an
 * offer's title, a UI string), previews it, turns it on, and guests get /ko
 * with its font, the switcher, the sitemap and hreflang, the proxy's language
 * redirect; turned off, all of it goes; deleted, its rows go. No deploy.
 * Korean was not in the table at build time, so /ko/restaurants/taya-house is
 * a path generateStaticParams never listed (plan risk 1).
 *
 * Serial (desktop-serial): it changes which languages every guest page offers.
 */

const KO_OFFER = '쿠킹 클래스';
const KO_STORIES = '주방 이야기';
const ENGLISH_STORIES = REGISTRY['stories.title'].en;

/** Every guest email key but one, as reviewed Korean rows (the English words: the gate asks for a row, not for good Korean). */
const GUEST_EMAIL_KEYS = STRING_KEYS.filter((k) => k.startsWith('email.') && !k.startsWith('email.staff.') && k !== 'email.common.footer_staff');
const BY_HAND = 'email.guest.ack.subject';

async function guest(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  return context.newPage();
}

const row = (page: Page, name: string) => page.locator('tr', { hasText: name });

async function cleanUp() {
  const c = db();
  await c.connect();
  try {
    // Deleting the language takes its *_i18n and content_strings rows with it (ON DELETE CASCADE).
    await c.query(`DELETE FROM audit_log WHERE locale = 'ko'`);
    await c.query(`DELETE FROM locales WHERE code = 'ko'`);
  } finally {
    await c.end();
  }
}

test.beforeAll(async () => {
  await seedStaff();
  await cleanUp();
});
test.afterAll(cleanUp);

test('ACCEPTANCE: Korean is added, translated, previewed, turned on and off, and deleted, without a deploy', async ({ page, browser, playwright, baseURL }) => {
  test.setTimeout(240_000);
  const c = db();
  await c.connect();
  try {
    // 2. Added: off, so /ko is a 404.
    await signInAs(page, STAFF.admin);
    await page.goto('/admin/locales');
    await page.getByRole('form', { name: 'Thêm ngôn ngữ' }).getByLabel('Ngôn ngữ').selectOption('ko');
    await page.getByRole('button', { name: 'Thêm ngôn ngữ' }).click();
    await expect(row(page, '한국어 (ko)')).toContainText('Đang tắt');
    const visitor = await guest(browser);
    expect((await visitor.goto('/ko'))?.status()).toBe(404);

    // 3. The guest emails: every key but one from the fixture, that one on the emails screen in Korean.
    for (const key of GUEST_EMAIL_KEYS.filter((k) => k !== BY_HAND)) {
      await c.query(`INSERT INTO content_strings (key, locale, value, status, origin) VALUES ($1, 'ko', $2, 'reviewed', 'human')`, [key, REGISTRY[key].en]);
    }
    await page.goto('/admin/content/emails?lang=ko');
    await expectHydrated(page);
    const emails = page.getByRole('form', { name: 'Nội dung email' });
    await expect(emails).toContainText('Đang sửa: 한국어');
    await emails.getByLabel(/^Tiêu đề email \(Khách: đã nhận yêu cầu\)/).fill('예약 요청을 받았습니다 ({reference})');
    await emails.getByRole('button', { name: 'Lưu nội dung email' }).click();
    await expect(emails.getByRole('status')).toContainText('Đã lưu 1 mục');

    // 4. An offer's title in its KO tab, and a UI string in Korean.
    await page.goto('/admin/content/offers/2');
    await expectHydrated(page);
    await page.getByRole('tablist', { name: 'Tiêu đề: ngôn ngữ' }).getByRole('tab', { name: /KO/ }).click();
    await page.locator('input[name="title.ko"]').fill(KO_OFFER);
    await page.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Đã lưu' })).toBeVisible();
    await page.goto('/admin/content/stories?lang=ko');
    await expectHydrated(page);
    const stories = page.locator('form').filter({ has: page.locator('[name="v:stories.title"]') });
    await stories.locator('[name="v:stories.title"]').fill(KO_STORIES);
    await stories.getByRole('button', { name: 'Lưu stories' }).click();
    await expect(stories.getByRole('status')).toContainText('Đã lưu 1 mục');

    // 5. Preview: staff see /ko, marked, never indexed.
    await page.goto('/admin/locales');
    await row(page, '한국어 (ko)').getByRole('link', { name: 'Xem trước' }).click();
    await page.waitForURL(/\/ko$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
    await expect(page.locator('.preview-banner')).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    await expect(page.getByRole('heading', { level: 2, name: KO_STORIES })).toBeVisible();
    await expect(page.getByText(KO_OFFER).first()).toBeAttached();

    // 6. Turned on: the emails are there, so nothing blocks it. 7. Out of the preview.
    await page.locator('.preview-banner a').click();
    await page.waitForURL(/\/en$/);
    await page.goto('/admin/locales');
    await row(page, '한국어 (ko)').getByRole('button', { name: 'Bật cho khách' }).click();
    await expect(row(page, '한국어 (ko)')).toContainText('Đang bật');

    // 7. A guest's /ko: Korean where translated, English where not, the Korean font, the switcher.
    const ko = await visitor.goto('/ko');
    expect(ko?.status()).toBe(200);
    await expect(visitor.locator('html')).toHaveAttribute('lang', 'ko');
    await expect(visitor.locator('link[href="/fonts/hangul.css"]')).toHaveCount(1);
    await expect(visitor.getByRole('heading', { level: 2, name: KO_STORIES })).toBeVisible();
    await expect(visitor.getByText(KO_OFFER).first()).toBeAttached();
    await expect(visitor.locator('meta[name="robots"]')).toHaveCount(0);
    await expect(visitor.locator('.hdr-lang-btn')).toContainText('KO');
    // Untranslated: the English heading of another section is still there.
    await expect(visitor.getByText(REGISTRY['experiences.title_1'].en).first()).toBeAttached();
    await visitor.goto('/en');
    await expect(visitor.locator('link[href="/fonts/hangul.css"]')).toHaveCount(0);
    await expect(visitor.getByRole('heading', { level: 2, name: ENGLISH_STORIES })).toBeVisible();

    // 8. A page whose static params never had Korean (plan risk 1).
    expect((await visitor.goto('/ko/restaurants/taya-house'))?.status()).toBe(200);
    await expect(visitor.locator('html')).toHaveAttribute('lang', 'ko');

    // 9. The sitemap and the hreflang alternates.
    const sitemap = await (await visitor.request.get('/sitemap.xml')).text();
    expect(sitemap).toMatch(/<loc>[^<]*\/ko<\/loc>/);
    expect(sitemap).toContain('hreflang="ko"');
    await visitor.goto('/en');
    await expect(visitor.locator('link[rel="alternate"][hreflang="ko"]')).toHaveCount(1);

    // 10. The proxy's redirect by Accept-Language: it reads the table at most once a minute per instance
    // (lib/i18n/enabled-locales.ts, TTL 60 s), so a fresh guest may still be sent to /en for up to a minute.
    const fresh = await playwright.request.newContext({ baseURL });
    try {
      await expect
        .poll(async () => (await fresh.get('/', { headers: { 'accept-language': 'ko-KR,ko;q=0.9' }, maxRedirects: 0 })).headers().location, { timeout: 70_000, intervals: [2_000] })
        .toMatch(/\/ko$/);
    } finally {
      await fresh.dispose();
    }

    // 11. Turned off: /ko is a 404 again, the switcher and the sitemap forget it.
    page.once('dialog', (d) => d.accept());
    await row(page, '한국어 (ko)').getByRole('button', { name: 'Tắt' }).click();
    await expect(row(page, '한국어 (ko)')).toContainText('Đang tắt');
    expect((await visitor.goto('/ko'))?.status()).toBe(404);
    await visitor.goto('/en');
    await expect(visitor.locator('.hdr-lang-btn')).toHaveCount(0);
    expect(await (await visitor.request.get('/sitemap.xml')).text()).not.toContain('hreflang="ko"');

    // 12. Deleted from the screen: its translations go with it.
    page.once('dialog', (d) => d.accept());
    await row(page, '한국어 (ko)').getByRole('button', { name: 'Xóa' }).click();
    await expect(row(page, '한국어 (ko)')).toHaveCount(0);
    const left = await c.query(
      `SELECT (SELECT count(*) FROM content_strings WHERE locale = 'ko')::int AS strings, (SELECT count(*) FROM offer_i18n WHERE locale = 'ko')::int AS offers`,
    );
    expect(left.rows[0]).toEqual({ strings: 0, offers: 0 });
    await visitor.context().close();
  } finally {
    await c.end();
  }
});
