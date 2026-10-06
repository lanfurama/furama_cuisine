import type { Browser, Page } from '@playwright/test';
import { REGISTRY, STRING_KEYS, type StringDef } from '../lib/i18n/registry';
import { STAFF, db, expect, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * The longest language (spec §13, §8; plan 2 line 160): a test language,
 * German (`de`, in the catalogue), whose UI words and menu labels are the
 * English ones stretched to 1.3 times (the editors' warning length), cut at
 * each key's maximum. On a phone (375 px) and a desktop (1440 px), nothing in
 * the header, the menus or the restaurant cards may overflow its box that
 * does not already overflow in English: checked in code (scrollWidth against
 * clientWidth), not by eye. The screenshots of this page belong to the visual
 * suite's macOS baselines (playwright.visual.config.ts), recorded by the owner.
 *
 * Serial (desktop-serial): it adds a language every guest page offers.
 */

const PLAIN = (def: StringDef) => !def.en.includes('{') && !def.en.includes('\n');
/** The guest words the chrome and the cards print (ui.*, the finder, the restaurants list, the booking bar). */
const STRETCHED = STRING_KEYS.filter((k) => /^(ui|finder|restaurants|nav|booking)\./.test(k) && PLAIN(REGISTRY[k]));
const GUEST_EMAIL_KEYS = STRING_KEYS.filter((k) => k.startsWith('email.') && !k.startsWith('email.staff.') && k !== 'email.common.footer_staff');

/** The English text made 1.3 times as long with its own words, cut at the key's maximum. */
function stretch(text: string, max: number): string {
  const target = Math.min(max, Math.ceil([...text].length * 1.3));
  let out = text;
  while ([...out].length < target) out += ` ${text}`;
  return [...out].slice(0, target).join('').trim();
}

async function cleanUp() {
  const c = db();
  await c.connect();
  try {
    await c.query(`DELETE FROM audit_log WHERE locale = 'de'`);
    await c.query(`DELETE FROM locales WHERE code = 'de'`);
  } finally {
    await c.end();
  }
}

/** Elements of the header, the menus and the cards whose content is wider than their box, by a stable name. */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out = new Set<string>();
    for (const root of document.querySelectorAll('header, nav, .rcard, .menu')) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        const box = el as HTMLElement;
        if (box.offsetParent === null && getComputedStyle(box).position !== 'fixed') continue;
        if (box.scrollWidth > box.clientWidth + 1 && box.clientWidth > 0) out.add(`${box.tagName.toLowerCase()}.${[...box.classList].sort().join('.')}`);
      }
    }
    return [...out].sort();
  });
}

async function visit(browser: Browser, width: number, path: string): Promise<string[]> {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  const page = await context.newPage();
  try {
    expect((await page.goto(path))?.status()).toBe(200);
    await page.waitForLoadState('networkidle');
    return await overflowing(page);
  } finally {
    await context.close();
  }
}

test.beforeAll(async () => {
  await seedStaff();
  await cleanUp();
});
test.afterAll(cleanUp);

test('the longest language overflows nothing in the header, the menus or the cards that English does not, on a phone and a desktop', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const c = db();
  await c.connect();
  try {
    await c.query(`INSERT INTO locales (code, bcp47, native_name, short_label, script, sort_order) VALUES ('de', 'de', 'Deutsch', 'DE', 'latin', 90)`);
    for (const key of STRETCHED) {
      await c.query(`INSERT INTO content_strings (key, locale, value, status) VALUES ($1, 'de', $2, 'reviewed')`, [key, stretch(REGISTRY[key].en, REGISTRY[key].maxLength)]);
    }
    for (const key of GUEST_EMAIL_KEYS) {
      await c.query(`INSERT INTO content_strings (key, locale, value, status) VALUES ($1, 'de', $2, 'reviewed') ON CONFLICT DO NOTHING`, [key, REGISTRY[key].en]);
    }
    await c.query(
      `INSERT INTO nav_item_i18n (nav_item_id, locale, label, status)
       SELECT nav_item_id, 'de', left(label || ' ' || label, greatest(length(label), ceil(length(label) * 1.3)::int)), 'reviewed' FROM nav_item_i18n WHERE locale = 'en'`,
    );
    // On through the screen, so every cached page learns of it at once.
    await signInAs(page, STAFF.admin);
    await page.goto('/admin/locales');
    const de = page.locator('tr', { hasText: 'Deutsch (de)' });
    await de.getByRole('button', { name: 'Bật cho khách' }).click();
    await expect(de).toContainText('Đang bật');

    for (const width of [375, 1440]) {
      for (const path of ['', '/restaurants/taya-house']) {
        const english = await visit(browser, width, `/en${path}`);
        const german = await visit(browser, width, `/de${path}`);
        expect(german.filter((el) => !english.includes(el)), `${width} px /de${path}`).toEqual([]);
      }
    }

    // Off and deleted through the screen, so every cached page forgets it (the locales tag); a delete in SQL
    // alone would leave the switcher on pages cached meanwhile, for the specs after this one.
    page.once('dialog', (d) => d.accept());
    await de.getByRole('button', { name: 'Tắt' }).click();
    await expect(de).toContainText('Đang tắt');
    page.once('dialog', (d) => d.accept());
    await de.getByRole('button', { name: 'Xóa' }).click();
    await expect(de).toHaveCount(0);
  } finally {
    await c.end();
  }
});
