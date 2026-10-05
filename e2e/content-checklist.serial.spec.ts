import type { APIRequestContext, Page } from '@playwright/test';
import { EDIT_SCREENS } from '../lib/admin/content-screens';
import { REGISTRY, type StringDef, type StringKey } from '../lib/i18n/registry';
import { expectHydrated } from './csp';
import { emailsTo } from './email-log';
import { HOME_PATH } from './paths';
import { seedReservation, venueDay } from './reservation-fixtures';
import { STAFF, expect, one, seedStaff, signInAs, test, uniqueIp } from './staff-fixtures';

/*
 * AC1 (spec §14.1 row 7): every item of the content checklist — the edit
 * report's §1 map (docs/superpowers/research/2026-10-05-phase-7-spikes/
 * editors-registry.md), less its locked (L) and phase-8 (P8) rows — is
 * edited in English in the admin by the Editor, reaches the guest within
 * 5 seconds, and is put back through History.
 *
 * One test per section of the map, one step per row. A row's guest check
 * reads what a guest is served (the page's HTML, the availability answer,
 * or an email), polled for at most 5 s from the save. Each row puts back
 * what it changed through the History of the screen it edited, except the
 * two screens that have none (spec §7.5 gives History to content): the
 * booking switch (phase 4) and the shared inbox (phase 5, the Admin's),
 * which are saved back to their old value. afterAll repairs by SQL anything
 * a failed step left: every row's marker contains "AC1-".
 *
 * Serial (desktop-serial): it touches every guest page.
 */

const GUEST_MS = 5_000;
const TAYA = '/en/restaurants/taya-house';
const MISSING = '/en/restaurants/ac1-missing';
const SAVED = 'Đã lưu. Trang khách cập nhật ngay.';
const RESTORE = /^Khôi phục bản trước lần này/;

const mark = (row: number) => `AC1-${row}`;

/** The Editor's admin page, signed in once for the file, and a guest's plain HTTP client. */
let editor: Page;
let guestApi: APIRequestContext;
let guestPage: Page;

test.beforeAll(async ({ browser }, testInfo) => {
  await seedStaff();
  editor = await (await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueIp(testInfo) } })).newPage();
  await signInAs(editor, STAFF.editor);
  guestApi = (await browser.newContext()).request;
  const guest = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  await guest.addInitScript(() => sessionStorage.setItem('fc-intro-seen', '1'));
  guestPage = await guest.newPage();
});

test.afterAll(async () => {
  await editor.context().close();
  await guestPage.context().close();
  // A step that failed half-way leaves its marker: the override rows go (the next save of any key expires them).
  await one(`DELETE FROM content_strings WHERE value LIKE '%AC1-%'`);
});

/** What a guest is served at `path`: the HTML of the page, with its payload. */
async function served(api: APIRequestContext, path: string): Promise<string> {
  return (await api.get(path)).text();
}

/** The guest gets `seen` (a string, or a pattern) at `path` within 5 s of the save, or `absent` no longer. */
async function reachesGuest(api: APIRequestContext, path: string, check: { seen?: string | RegExp; absent?: string }) {
  await expect
    .poll(
      async () => {
        const html = await served(api, path);
        const seen = check.seen === undefined || (typeof check.seen === 'string' ? html.includes(check.seen) : check.seen.test(html));
        return seen && (check.absent === undefined || !html.includes(check.absent));
      },
      { timeout: GUEST_MS, intervals: [200, 300, 500] },
    )
    .toBe(true);
}

/** A registry key's row: the key's own screen, its field, the save, the guest, then History. */
async function stringRow(admin: Page, api: APIRequestContext, key: StringKey, row: number, path: string) {
  const def: StringDef = REGISTRY[key];
  const value = `${mark(row)}${(def.vars ?? []).map((v) => ` {${v}}`).join('')}`;
  await admin.goto(EDIT_SCREENS[def.screen].route);
  await expectHydrated(admin);
  const field = admin.locator(`[name="v:${key}"]`);
  const form = admin.locator('form').filter({ has: field });
  await field.fill(value);
  await form.getByRole('button', { name: /^Lưu / }).click();
  await expect(form.getByRole('status').filter({ hasText: 'Đã lưu' })).toBeVisible();
  await reachesGuest(api, path, { seen: mark(row) });
  // History: the newest row of this key, its version before the edit (the default).
  const item = admin
    .getByRole('listitem')
    .filter({ has: admin.locator('strong').getByText(def.label, { exact: true }) })
    .first();
  admin.once('dialog', (d) => void d.accept());
  await item.getByRole('button', { name: RESTORE }).click();
  await expect.poll(() => one(`SELECT count(*)::int AS n FROM content_strings WHERE key = $1`, [key])).toEqual({ n: 0 });
  await reachesGuest(api, path, { absent: mark(row) });
}

/** Restores the newest change of a record from its History region. */
async function restoreNewest(admin: Page, history: ReturnType<Page['getByRole']>) {
  admin.once('dialog', (d) => void d.accept());
  await history.getByRole('listitem').first().getByRole('button', { name: RESTORE }).click();
  await expect(history.getByRole('status')).toContainText('Đã khôi phục');
}

/** The steps of one section: strings by key and path, then the table rows. */
type Row = { row: number; item: string } & ({ key: StringKey; path?: string } | { run: (admin: Page, api: APIRequestContext) => Promise<void> });

async function walk(rows: readonly Row[]) {
  for (const r of rows) {
    await test.step(`${r.row}. ${r.item}`, async () => {
      if ('key' in r) await stringRow(editor, guestApi, r.key, r.row, r.path ?? HOME_PATH);
      else await r.run(editor, guestApi);
    });
  }
}

/**
 * A list item's row on a list screen, its form opened through "Sửa “…”". Found by its place, not its
 * text: a row renames the item it edits. (Direct children only: each row holds its History's list.)
 */
async function openItem(admin: Page, route: string, list: string, name: string) {
  await admin.goto(route);
  await expectHydrated(admin);
  const items = admin.getByRole('list', { name: list }).locator(':scope > li');
  const texts = await items.allTextContents();
  const item = items.nth(texts.findIndex((t) => t.includes(`Sửa “${name}”`)));
  await item.getByText(`Sửa “${name}”`).click();
  return item;
}

/** The restaurant content screen of Tàya House: change fields, save, check the guest, restore through History. */
async function restaurantRow(admin: Page, api: APIRequestContext, edit: (form: ReturnType<Page['getByRole']>) => Promise<void>, path: string, seen: string | RegExp) {
  await admin.goto('/admin/restaurants/taya-house');
  await expectHydrated(admin);
  const form = admin.getByRole('form', { name: 'Nội dung nhà hàng' });
  await edit(form);
  await form.getByRole('button', { name: 'Lưu nhà hàng' }).click();
  await expect(form.getByRole('status').filter({ hasText: 'Đã lưu' })).toBeVisible();
  await reachesGuest(api, path, { seen });
  await restoreNewest(admin, admin.getByRole('region', { name: 'Lịch sử', exact: true }));
}

test('2.1 head of the page: title and description, the shared title, the shared picture', async () => {
  await walk([
    { row: 1, item: '<title>, meta description', key: 'seo.home_title' },
    { row: 2, item: 'OG title, OG description', key: 'seo.og_title' },
    {
      row: 3,
      item: 'OG image (site_settings.og_image_id, seo)',
      run: async (admin, api) => {
        await admin.goto('/admin/content/seo');
        await expectHydrated(admin);
        const form = admin.getByRole('form', { name: 'Ảnh chia sẻ' });
        await form.getByText(/^Chọn ảnh khác/).click();
        await form.getByRole('radio', { name: 'hero-beach.jpg' }).check();
        await form.getByRole('button', { name: 'Lưu', exact: true }).click();
        await expect(form.getByRole('status')).toHaveText(SAVED);
        await reachesGuest(api, HOME_PATH, { seen: /property="og:image" content="[^"]*hero-beach\.jpg"/ });
        await restoreNewest(admin, admin.getByRole('region', { name: 'Lịch sử: ảnh chia sẻ' }));
      },
    },
  ]);
});

/** The navigation item of `section` renamed to the row's marker; its History puts the label back. */
const navRow = (row: number, item: string, section: string, label: string): Row => ({
  row,
  item,
  run: async (admin, api) => {
    const entry = await openItem(admin, '/admin/content/navigation', 'Thứ tự menu', label);
    await entry.getByRole('form', { name: `Mục menu “${label}”` }).getByLabel('Nhãn', { exact: true }).fill(mark(row));
    await entry.getByRole('button', { name: 'Lưu mục menu' }).click();
    await expect(entry.getByRole('status')).toHaveText(SAVED);
    await reachesGuest(api, HOME_PATH, { seen: `>${mark(row)}<` });
    await restoreNewest(admin, entry.getByRole('region', { name: /^Lịch sử: / }));
    expect(await one(`SELECT label FROM nav_item_i18n t JOIN nav_items n ON n.id = t.nav_item_id WHERE n.target_section = $1 AND t.locale = 'en'`, [section])).toEqual({ label });
  },
});

test('2.2–2.4 header, phone menu and tab bar', async () => {
  await walk([
    navRow(4, '6 nav labels and targets', 'offers', 'Offers'),
    { row: 5, item: 'SEARCH, RESERVE ×2', key: 'ui.search' },
    { row: 6, item: 'aria Main / Language / Open menu', key: 'ui.nav_aria' },
    navRow(7, 'menu labels (same rows as nav)', 'stories', 'Stories'),
    { row: 8, item: 'Search, RESERVE A TABLE (menu)', key: 'ui.search_link' },
    { row: 9, item: 'tagline PEOPLE | CULTURE | GREAT FOOD', key: 'footer.tagline' },
    { row: 10, item: 'aria Menu / Close menu / Sections', key: 'ui.close_menu' },
    { row: 11, item: 'EXPLORE / RESTAURANTS / RESERVE', key: 'ui.tab_explore' },
    { row: 12, item: 'CALL / MAP / MENU, aria Restaurant actions', key: 'detail.call', path: TAYA },
    {
      row: 13,
      item: 'tel, map (restaurants.phone_*/map_url)',
      run: (admin, api) =>
        restaurantRow(admin, api, (form) => form.getByLabel('Số điện thoại', { exact: true }).fill('0236 3847 913'), TAYA, 'tel:+842363847913'),
    },
    {
      row: 14,
      item: 'menu PDF (restaurant_i18n.menu_pdf_url)',
      run: (admin, api) =>
        restaurantRow(admin, api, (form) => form.getByLabel('Link thực đơn PDF', { exact: true }).fill('https://furamavietnam.com/ac1-14-menu.pdf'), TAYA, 'ac1-14-menu.pdf'),
    },
  ]);
});

test('2.5 hero and film', async () => {
  const last = await one<{ name: string }>(
    `SELECT split_part(m.pathname, '/', 3) AS name FROM hero_slides h JOIN media m ON m.id = h.image_id WHERE h.is_published ORDER BY h.sort_order DESC LIMIT 1`,
  );
  const beach = await one<{ id: string }>(`SELECT id FROM media WHERE pathname = '/assets/hero-beach.jpg'`);
  await walk([
    {
      row: 15,
      item: 'slides, order, publish (hero_slides)',
      run: async (admin) => {
        // The slides a guest's browser draws (the picture's file may show elsewhere on the page).
        const slides = async () => {
          await guestPage.goto(HOME_PATH);
          return guestPage.locator('.hero-slides .hero-slide').count();
        };
        const shown = await slides();
        await admin.goto('/admin/content/hero');
        await expectHydrated(admin);
        await admin.getByRole('list', { name: 'Thứ tự slide' }).getByRole('button', { name: `Ẩn “${last!.name}”` }).click();
        await expect.poll(slides, { timeout: GUEST_MS }).toBe(shown - 1);
        await restoreNewest(admin, admin.getByRole('region', { name: `Lịch sử: ${last!.name}` }));
        await expect.poll(slides, { timeout: GUEST_MS }).toBe(shown);
      },
    },
    {
      row: 16,
      item: 'slide alt / decorative (media_i18n.alt)',
      run: async (admin, api) => {
        await admin.goto(`/admin/media/${beach!.id}`);
        await expectHydrated(admin);
        const form = admin.getByRole('form', { name: 'Mô tả ảnh' });
        await form.getByLabel('Mô tả ảnh (tiếng Anh, cho trình đọc màn hình)', { exact: true }).fill(mark(16));
        await form.getByRole('button', { name: 'Lưu mô tả' }).click();
        await expect(form.getByRole('status')).toHaveText(SAVED);
        await reachesGuest(api, HOME_PATH, { seen: `alt="${mark(16)}"` });
        await restoreNewest(admin, admin.getByRole('region', { name: 'Lịch sử', exact: true }));
      },
    },
    { row: 17, item: 'kicker, title 1/2/3, lede', key: 'hero.kicker' },
    { row: 18, item: '3 CTAs, "Slide {n}"', key: 'hero.cta_explore' },
    {
      row: 19,
      item: 'autoplay ms (site_settings.hero_autoplay_ms)',
      run: async (admin, api) => {
        await admin.goto('/admin/content/hero');
        await expectHydrated(admin);
        const form = admin.getByRole('form', { name: 'Tốc độ slide' });
        await form.getByLabel('Thời gian mỗi slide (giây)', { exact: true }).fill('9');
        await form.getByRole('button', { name: 'Lưu', exact: true }).click();
        await expect(form.getByRole('status')).toHaveText(SAVED);
        await reachesGuest(api, HOME_PATH, { seen: /heroAutoplayMs\\?":9000/ });
        await restoreNewest(admin, admin.getByRole('region', { name: 'Lịch sử: tốc độ slide' }));
      },
    },
    {
      row: 20,
      item: 'film poster, video URL, on/off (sections[film])',
      run: async (admin, api) => {
        await admin.goto('/admin/content/hero');
        await expectHydrated(admin);
        const form = admin.getByRole('form', { name: 'Phim' });
        await form.getByLabel('Link video (YouTube hoặc Vimeo)', { exact: true }).fill('https://youtu.be/dQw4w9WgXcQ');
        await form.getByRole('button', { name: 'Lưu', exact: true }).click();
        await expect(form.getByRole('status')).toHaveText(SAVED);
        await reachesGuest(api, HOME_PATH, { seen: 'dQw4w9WgXcQ' });
        await restoreNewest(admin, admin.getByRole('region', { name: 'Lịch sử: phim' }));
      },
    },
    { row: 21, item: 'film title, coming soon, 2 aria labels', key: 'film.title' },
  ]);
});

/** The booking screen's defaults: one select changed, saved, seen, restored through its History. */
const defaultsRow = (row: number, item: string, field: string, value: string, seen: RegExp): Row => ({
  row,
  item,
  run: async (admin, api) => {
    await admin.goto('/admin/content/booking');
    await expectHydrated(admin);
    const form = admin.getByRole('form', { name: 'Mặc định khi khách mở trang' });
    await form.getByLabel(field, { exact: true }).selectOption(value);
    await form.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(form.getByRole('status')).toHaveText(SAVED);
    await reachesGuest(api, HOME_PATH, { seen });
    await restoreNewest(admin, admin.getByRole('region', { name: 'Lịch sử: lựa chọn sẵn' }));
  },
});

/** One cuisine relabelled to the row's marker; its History puts the label back. */
const cuisineRow = (row: number, item: string, name: string): Row => ({
  row,
  item,
  run: async (admin, api) => {
    const entry = await openItem(admin, '/admin/content/cuisines', 'Thứ tự ẩm thực', name);
    await entry.getByRole('form', { name: `Ẩm thực “${name}”` }).getByLabel('Tên ẩm thực', { exact: true }).fill(mark(row));
    await entry.getByRole('button', { name: 'Lưu ẩm thực' }).click();
    await expect(entry.getByRole('status').first()).toHaveText(SAVED);
    await reachesGuest(api, HOME_PATH, { seen: mark(row) });
    await restoreNewest(admin, entry.getByRole('region', { name: /^Lịch sử: / }));
  },
});

test('2.6–2.7 finder and cuisines', async () => {
  await walk([
    { row: 22, item: 'Find a restaurant; Location/Cuisine/Occasion/Destination', key: 'finder.title' },
    { row: 23, item: 'Da Nang / More cities / Coming soon', key: 'finder.city' },
    { row: 24, item: 'All cuisines / Any occasion / Any destination', key: 'finder.all_cuisines' },
    { row: 25, item: 'occasion options (meal names)', key: 'meal.dinner' },
    { row: 26, item: 'SHOW RESTAURANTS, Close', key: 'finder.submit' },
    defaultsRow(27, 'default occasion (site_settings.default_occasion)', 'Dịp chọn sẵn ở ô tìm', 'Lunch', /defaultOccasion\\?":\\?"Lunch/),
    cuisineRow(28, 'cuisine and destination options', 'Thai'),
    { row: 29, item: 'Explore by Cuisine, ALL CUISINES', key: 'cuisines.title' },
    {
      row: 30,
      item: '8 chips (label, image, order, publish)',
      run: async (admin) => {
        // The rail as a guest's browser draws it: the label is also a restaurant's cuisine elsewhere on the page.
        const rail = async () => {
          await guestPage.goto(HOME_PATH);
          return guestPage.locator('#cuisines .cuisine-label').allTextContents();
        };
        const entry = await openItem(admin, '/admin/content/cuisines', 'Thứ tự ẩm thực', 'Japanese');
        // "Ẩn" says first what hiding takes off the site.
        admin.once('dialog', (d) => void d.accept());
        await entry.getByRole('button', { name: 'Ẩn “Japanese”' }).click();
        await expect.poll(rail, { timeout: GUEST_MS }).not.toContain('Japanese');
        await restoreNewest(admin, entry.getByRole('region', { name: /^Lịch sử: / }));
        await expect.poll(rail, { timeout: GUEST_MS }).toContain('Japanese');
      },
    },
  ]);
});

test('2.8 restaurants', async () => {
  await walk([
    { row: 31, item: 'Our Restaurants, VIEW ALL RESTAURANTS', key: 'restaurants.title' },
    { row: 32, item: 'Showing {shown} of {total} restaurants, No matches', key: 'restaurants.showing' },
    { row: 33, item: ', remove filter / CLEAR ALL / 3 empty-state lines', key: 'restaurants.clear_all' },
    { row: 34, item: 'card View restaurant / Reserve a table', key: 'restaurants.card_view' },
    {
      row: 35,
      item: 'name, slug, destination, type, cuisines, images, publish, archive',
      run: (admin, api) => restaurantRow(admin, api, (form) => form.getByLabel('Loại nhà hàng', { exact: true }).fill(mark(35)), HOME_PATH, mark(35)),
    },
    {
      row: 36,
      item: 'booking on/off, meals (restaurant-booking, phase 4: saved back, no History)',
      run: async (admin, api) => {
        await admin.goto('/admin/restaurants/taya-house/booking');
        await expectHydrated(admin);
        const rules = admin.getByRole('form', { name: 'Quy tắc đặt bàn' });
        const save = async (on: boolean) => {
          await rules.getByRole('checkbox', { name: /^Nhận đặt bàn online/ }).setChecked(on);
          await rules.getByRole('button', { name: 'Lưu quy tắc' }).click();
          await expect(rules.getByRole('status')).toHaveText('Đã lưu.');
        };
        const status = async () => (await api.get('/api/availability?restaurant=taya-house')).status();
        await save(false);
        await expect.poll(status, { timeout: GUEST_MS }).toBe(404);
        await save(true);
        await expect.poll(status, { timeout: GUEST_MS }).toBe(200);
      },
    },
  ]);
});

/** A list item's text field set to the row's marker; its History puts it back. */
const listRow = (
  row: number,
  item: string,
  where: { route: string; list: string; name: string; form: string; field: string; button: string },
): Row => ({
  row,
  item,
  run: async (admin, api) => {
    const entry = await openItem(admin, where.route, where.list, where.name);
    await entry.getByRole('form', { name: where.form }).getByLabel(where.field, { exact: true }).fill(mark(row));
    await entry.getByRole('button', { name: where.button }).click();
    await expect(entry.getByRole('status').first()).toHaveText(SAVED);
    await reachesGuest(api, HOME_PATH, { seen: mark(row) });
    await restoreNewest(admin, entry.getByRole('region', { name: /^Lịch sử: / }));
  },
});

/** A home section's picture or link changed on the sections screen; its History puts it back. */
const sectionRow = (row: number, item: string, label: string, change: (form: ReturnType<Page['getByRole']>) => Promise<void>, seen: string): Row => ({
  row,
  item,
  run: async (admin, api) => {
    await admin.goto('/admin/content/sections');
    await expectHydrated(admin);
    const card = admin.getByRole('region', { name: label, exact: true });
    const form = card.getByRole('form', { name: label });
    await change(form);
    await form.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(form.getByRole('status')).toHaveText(SAVED);
    await reachesGuest(api, HOME_PATH, { seen });
    await restoreNewest(admin, card.getByRole('region', { name: `Lịch sử: ${label}` }));
  },
});

test('2.9–2.12 destinations, experiences, heritage, stories', async () => {
  const destinations = { route: '/admin/content/destinations', list: 'Thứ tự điểm đến', button: 'Lưu điểm đến' };
  await walk([
    { row: 37, item: 'Our Destinations, lede', key: 'destinations.title' },
    listRow(38, 'cards: kind, order, publish, 2-line title and blurb, image, name', {
      ...destinations,
      name: 'Furama MM Supercenter',
      form: 'Điểm đến “Furama MM Supercenter”',
      field: 'Tiêu đề thẻ, dòng 2',
    }),
    { row: 39, item: '"{count} restaurants →" / Coming soon', key: 'destinations.count' },
    sectionRow(
      40,
      'picture and its alt (sections[experiences].image_id)',
      'Experiences',
      async (form) => {
        await form.getByText(/^Chọn ảnh khác/).click();
        await form.getByRole('radio', { name: 'taya-garden.jpg' }).check();
      },
      'taya-garden.jpg',
    ),
    { row: 41, item: 'eyebrow, title lines 1 and 2', key: 'experiences.eyebrow' },
    listRow(42, 'rows (title, blurb, link)', {
      route: '/admin/content/experiences',
      list: 'Thứ tự Experiences',
      name: 'Private Dining & Events',
      form: 'Mục “Private Dining & Events”',
      field: 'Tiêu đề',
      button: 'Lưu mục',
    }),
    sectionRow(
      43,
      'background picture, OUR STORY link (sections[heritage])',
      'Heritage',
      (form) => form.getByLabel('Link nút “Our story”', { exact: true }).fill('https://furamavietnam.com/ac1-43/'),
      'ac1-43',
    ),
    { row: 44, item: 'kicker, title 1/2, OUR STORY', key: 'heritage.kicker' },
    { row: 45, item: 'title, lede (stories)', key: 'stories.title' },
    listRow(46, '4 cards (image, href, date, category, title)', {
      route: '/admin/content/stories',
      list: 'Thứ tự Stories',
      name: 'Steakhouse The Fan, where fine food meets art',
      form: 'Câu chuyện “Steakhouse The Fan, where fine food meets art”',
      field: 'Tiêu đề',
      button: 'Lưu câu chuyện',
    }),
  ]);
});

/** The first offer's edit page: one field, saved, seen, restored through its History. */
const offerRow = (row: number, item: string, field: string, value: string, seen: string): Row => ({
  row,
  item,
  run: async (admin, api) => {
    await admin.goto('/admin/content/offers');
    await admin.getByRole('list', { name: 'Thứ tự ưu đãi' }).getByRole('link', { name: 'Seafood & Steak Buffet Dinner' }).click();
    await expectHydrated(admin);
    const form = admin.getByRole('form', { name: 'Sửa ưu đãi' });
    await form.getByLabel(field, { exact: true }).fill(value);
    await form.getByRole('button', { name: 'Lưu ưu đãi' }).click();
    await expect(form.getByRole('status')).toHaveText(SAVED);
    await reachesGuest(api, HOME_PATH, { seen });
    await restoreNewest(admin, admin.getByRole('region', { name: 'Lịch sử', exact: true }));
  },
});

test('2.13–2.16 offers, booking bar, drawer, search', async () => {
  await walk([
    { row: 47, item: 'Offers title; lede with its date', key: 'offers.title' },
    offerRow(48, 'restaurant, price, basis, validity, order, publish', 'Giá', '913000', '913,000'),
    offerRow(49, 'title, schedule, venue (offer_i18n)', 'Tiêu đề', mark(49), mark(49)),
    { row: 50, item: '"VND 888,000++ per guest"', key: 'offers.price_plus_plus' },
    { row: 51, item: 'VIEW OFFER; "Offer: …" note prefill', key: 'offers.cta' },
    { row: 52, item: 'Where would you like to dine?', key: 'booking.title' },
    { row: 53, item: 'Destination/Restaurant/Date/Time/Guests', key: 'booking.label_date' },
    { row: 54, item: 'Today / Tomorrow / Full / "{count} left" / meal', key: 'common.today' },
    { row: 55, item: 'FIND A TABLE; "{n} guest(s)"', key: 'booking.find_table' },
    defaultsRow(56, 'first restaurant (site_settings.default_restaurant_id)', 'Nhà hàng chọn sẵn', 'the-fan', /defaultRestaurantId\\?":\\?"the-fan/),
    { row: 57, item: 'error.*, booking.day_*, no_tables, loading, done_*, retry, privacy notice, consent', key: 'error.invalid_name' },
    { row: 58, item: 'drawer copy', key: 'booking.your_details' },
    { row: 59, item: 'captions and placeholders', key: 'form.ph_name' },
    { row: 60, item: 'inline field errors', key: 'error.invalid_phone' },
    { row: 61, item: 'search dialog copy', key: 'search.placeholder' },
    cuisineRow(62, 'search chips; thumbnails', 'Vietnamese'),
  ]);
});

test('2.17 footer', async ({ browser }) => {
  await walk([
    { row: 63, item: 'tagline, A MEMBER OF FURAMA', key: 'footer.member' },
    {
      row: 64,
      item: 'socials (href, order, publish, locales); platform labels',
      run: async (admin, api) => {
        const entry = await openItem(admin, '/admin/content/contact', 'Thứ tự mạng xã hội', 'Facebook');
        await entry.getByRole('form', { name: 'Link Facebook' }).getByLabel('Đường dẫn', { exact: true }).fill('https://www.facebook.com/ac1-64');
        await entry.getByRole('button', { name: 'Lưu link' }).click();
        await expect(entry.getByRole('status').first()).toHaveText(SAVED);
        await reachesGuest(api, HOME_PATH, { seen: 'facebook.com/ac1-64' });
        await restoreNewest(admin, entry.getByRole('region', { name: 'Lịch sử: Facebook' }));
      },
    },
    { row: 65, item: 'platform labels (social.<platform>)', key: 'social.facebook' },
    listRow(66, 'address lines (destination_i18n.address)', {
      route: '/admin/content/destinations',
      list: 'Thứ tự điểm đến',
      name: 'Furama Resort Danang',
      form: 'Điểm đến “Furama Resort Danang”',
      field: 'Địa chỉ',
      button: 'Lưu điểm đến',
    }),
  ]);
  // The shared inbox is the Admin's (R10; notifications, phase 5), with no History: saved back.
  await test.step('67. email (site_settings.email, notifications: the Admin)', async () => {
    const admin = await (await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueIp(test.info()) } })).newPage();
    try {
      await signInAs(admin, STAFF.admin);
      await admin.goto('/admin/settings/notifications');
      await expectHydrated(admin);
      const form = admin.getByRole('form', { name: 'Hộp thư chung' });
      const before = await form.getByLabel('Email hộp thư chung', { exact: true }).inputValue();
      const save = async (value: string) => {
        await form.getByLabel('Email hộp thư chung', { exact: true }).fill(value);
        await form.getByRole('button', { name: 'Lưu hộp thư chung' }).click();
        await expect(form.getByRole('status')).toHaveText('Đã lưu.');
      };
      await save('ac1-67@furama.test');
      await reachesGuest(guestApi, HOME_PATH, { seen: 'ac1-67@furama.test' });
      await save(before);
      await reachesGuest(guestApi, HOME_PATH, { seen: before, absent: 'ac1-67@furama.test' });
    } finally {
      await admin.context().close();
    }
  });
});

test('2.19 and later: restaurant pages, the policy, the 404, the booking emails', async () => {
  await walk([
    { row: 68, item: 'ALL RESTAURANTS, BACK', key: 'detail.back_all', path: TAYA },
    {
      row: 69,
      item: 'kicker, story, Brand Story label',
      run: (admin, api) => restaurantRow(admin, api, (form) => form.getByLabel('Dòng trên tên', { exact: true }).fill(mark(69)), TAYA, mark(69)),
    },
    {
      row: 70,
      item: '<h1> name (restaurants.name)',
      run: (admin, api) => restaurantRow(admin, api, (form) => form.getByLabel('Tên nhà hàng', { exact: true }).fill(`Tàya ${mark(70)}`), TAYA, `Tàya ${mark(70)}`),
    },
    { row: 71, item: 'RESERVE A TABLE', key: 'ui.reserve_table', path: TAYA },
    {
      row: 72,
      item: 'portrait and alt (restaurants.detail_image_id)',
      run: (admin, api) =>
        restaurantRow(
          admin,
          api,
          async (form) => {
            const portrait = form.getByRole('group', { name: /^Ảnh chân dung/ });
            await portrait.getByText(/^Chọn ảnh khác/).click();
            await portrait.getByRole('radio', { name: 'dest-future.jpg' }).check();
          },
          TAYA,
          'dest-future.jpg',
        ),
    },
    {
      row: 73,
      item: '"At {name}", highlights',
      run: (admin, api) =>
        restaurantRow(
          admin,
          api,
          (form) => form.getByRole('list', { name: 'Điểm nổi bật' }).getByRole('listitem').first().getByLabel('Tiêu đề', { exact: true }).fill(mark(73)),
          TAYA,
          mark(73),
        ),
    },
    { row: 74, item: 'More at {destination}, ALL RESTAURANTS →', key: 'detail.more_title', path: TAYA },
    {
      row: 75,
      item: '<title>/description (restaurant_i18n.seo_*)',
      run: (admin, api) => restaurantRow(admin, api, (form) => form.getByLabel('Tiêu đề SEO', { exact: true }).fill(`Tàya ${mark(75)}`), TAYA, `<title>Tàya ${mark(75)}</title>`),
    },
    { row: 76, item: 'unknown slug title (seo.not_found_title)', key: 'seo.not_found_title', path: MISSING },
    { row: 77, item: 'privacy page (legal.*)', key: 'legal.title', path: '/en/privacy' },
    { row: 78, item: '(guarded)/not-found', key: 'common.not_found', path: MISSING },
    {
      row: 79,
      item: 'booking emails (email.*, EN)',
      run: async (admin, api) => {
        const key: StringKey = 'email.guest.confirmed.subject';
        const r = await seedReservation({ status: 'confirmed', date: venueDay(5) });
        const guestEmail = `ac1-79-${r.reference.toLowerCase()}@example.com`;
        await one(`UPDATE reservations SET email = $2 WHERE id = $1`, [r.id, guestEmail]);
        await admin.goto('/admin/content/emails');
        await expectHydrated(admin);
        const field = admin.locator(`[name="v:${key}"]`);
        const form = admin.locator('form').filter({ has: field });
        await field.fill(`${mark(79)} ({reference})`);
        await form.getByRole('button', { name: /^Lưu / }).click();
        await expect(form.getByRole('status').filter({ hasText: 'Đã lưu' })).toBeVisible();
        // The guest's next confirmation: queued as the panel queues it, sent by the cron.
        await one(
          `INSERT INTO email_outbox (env, event, audience, reservation_id, to_email, locale) VALUES ('development', 'guest.confirmed', 'guest', $1, $2, 'en')`,
          [r.id, guestEmail],
        );
        expect((await api.get('/api/cron/outbox', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })).status()).toBe(200);
        await expect.poll(() => emailsTo(guestEmail).map((e) => e.subject), { timeout: GUEST_MS }).toEqual([`${mark(79)} (${r.reference})`]);
        const item = admin
          .getByRole('listitem')
          .filter({ has: admin.locator('strong').getByText(REGISTRY[key].label, { exact: true }) })
          .first();
        admin.once('dialog', (d) => void d.accept());
        await item.getByRole('button', { name: RESTORE }).click();
        await expect.poll(() => one(`SELECT count(*)::int AS n FROM content_strings WHERE key = $1`, [key])).toEqual({ n: 0 });
      },
    },
  ]);
});
