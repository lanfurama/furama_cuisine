import type { Browser, BrowserContext, Page } from '@playwright/test';
import { REGISTRY, STRING_KEYS, type StringDef } from '../lib/i18n/registry';
import { STAFF, db, expect, seedStaff, signInAs, test } from './staff-fixtures';

/*
 * The longest language (spec §13, §8; plan 2 line 160): Vietnamese, for the
 * length of this test, whose UI words and menu labels are the English ones
 * stretched to 1.3 times (the editors' warning length), cut at each key's
 * maximum. On a phone (375 px) and a desktop (1440 px), nothing in the header,
 * the menus or the restaurant cards may overflow its box that does not already
 * overflow in English: checked in code (scrollWidth against clientWidth), not
 * by eye. The pages are a member of staff's Draft Mode preview, both languages
 * alike: it renders afresh, so the rows written here show at once, where a
 * guest would get the cached page. The screenshots of this page belong to the
 * visual suite's macOS baselines (playwright.visual.config.ts), recorded by
 * the owner.
 *
 * Serial (desktop-serial): it writes Vietnamese text every guest page reads,
 * and takes it out again.
 */

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

const PLAIN = (def: StringDef) => !def.en.includes('{') && !def.en.includes('\n');
/** The guest words the chrome and the cards print (ui.*, the finder, the restaurants list, the booking bar). */
const STRETCHED = STRING_KEYS.filter((k) => /^(ui|finder|restaurants|nav|booking)\./.test(k) && PLAIN(REGISTRY[k]));

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
    await c.query(`DELETE FROM content_strings WHERE locale = 'vi' AND key = ANY ($1::text[])`, [STRETCHED]);
    await c.query(`DELETE FROM nav_item_i18n WHERE locale = 'vi'`);
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

/** `path` in Draft Mode, as the signed-in member of staff whose cookies `staff` holds. */
async function visit(browser: Browser, staff: StorageState, width: number, path: string): Promise<string[]> {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', storageState: staff });
  await context.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  const page = await context.newPage();
  try {
    expect((await page.goto(`/api/admin/preview?path=${encodeURIComponent(path)}`))?.status()).toBe(200);
    await expect(page.locator('.preview-banner')).toBeVisible();
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
    for (const key of STRETCHED) {
      await c.query(`INSERT INTO content_strings (key, locale, value, status) VALUES ($1, 'vi', $2, 'reviewed')`, [key, stretch(REGISTRY[key].en, REGISTRY[key].maxLength)]);
    }
    await c.query(
      `INSERT INTO nav_item_i18n (nav_item_id, locale, label, status)
       SELECT nav_item_id, 'vi', left(label || ' ' || label, greatest(length(label), ceil(length(label) * 1.3)::int)), 'reviewed' FROM nav_item_i18n WHERE locale = 'en'`,
    );
    await signInAs(page, STAFF.admin);
    const staff = await page.context().storageState();

    for (const width of [375, 1440]) {
      for (const path of ['', '/restaurants/taya-house']) {
        const english = await visit(browser, staff, width, `/en${path}`);
        const longest = await visit(browser, staff, width, `/vi${path}`);
        expect(longest.filter((el) => !english.includes(el)), `${width} px /vi${path}`).toEqual([]);
      }
    }
  } finally {
    await cleanUp();
    await c.end();
  }
});
