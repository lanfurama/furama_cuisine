import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';
import { EDIT_SCREENS, screensInUse, type EditScreen } from '../../lib/admin/content-screens';
import { ADMIN_SCREENS, REGISTRY, STRING_KEYS, keysForScreen, type AdminScreen } from '../../lib/i18n/registry';
import { walk } from './guest-text';

/*
 * Spec §7.2: "Một bài test CI kiểm tra rằng mọi key, bảng và cột khách nhìn
 * thấy đều có màn hình sửa (dựa vào `screen` trong registry)". Keys name a
 * screen (registry `screen`), columns name one (lib/admin/content-screens.ts
 * COLUMN_SCREENS; test/integration/editing-screens.test.ts holds that map to
 * the real schema). Here: every screen in use has its page, and a screen that
 * edits strings renders them (a JSX element with screen="<screen>" in the
 * page's folder: <StringsPanel screen="ui-text" />).
 */

/** Screens phase 7 has not built yet. The plan's tasks empty this list; the last task of phase 7 asserts it is []. */
const NOT_BUILT: readonly EditScreen[] = [
  'booking',
  'contact',
  'seo',
];

const CURRENT_PHASE = 7;

function screenAttributes(dir: string): Set<string> {
  const found = new Set<string>();
  for (const name of readdirSync(dir)) {
    if (!/\.tsx$/.test(name)) continue;
    const file = join(dir, name);
    const { program } = parseSync(file, readFileSync(file, 'utf8'));
    walk(program, (n) => {
      if (n.type !== 'JSXAttribute') return;
      const attr = n as unknown as { name: { name: string }; value: { type: string; value: unknown } | null };
      if (attr.name.name === 'screen' && attr.value?.type === 'Literal' && typeof attr.value.value === 'string') found.add(attr.value.value);
    });
  }
  return found;
}

describe('every key, table and column guests see has an editing screen (spec §7.2)', () => {
  it('every key names a screen that has a route', () => {
    for (const key of STRING_KEYS) expect(EDIT_SCREENS[REGISTRY[key].screen], key).toBeDefined();
  });

  const used = [...screensInUse(STRING_KEYS.map((k) => REGISTRY[k].screen))];

  it.each(used)('%s: its page exists (or a later phase or a listed phase-7 task builds it)', (screen) => {
    const { page, phase } = EDIT_SCREENS[screen];
    if (existsSync(page)) return expect(NOT_BUILT).not.toContain(screen);
    expect(phase > CURRENT_PHASE || NOT_BUILT.includes(screen), `${screen}: ${page} is missing`).toBe(true);
  });

  const stringScreens = ADMIN_SCREENS.filter((s) => keysForScreen(s).length > 0 && existsSync(EDIT_SCREENS[s].page));
  it.each(stringScreens)('%s: the page renders its strings (screen="%s" in its folder)', (screen: AdminScreen) => {
    expect([...screenAttributes(dirname(EDIT_SCREENS[screen].page))]).toContain(screen);
  });

  it('NOT_BUILT lists only screens whose page is missing', () => {
    expect(NOT_BUILT.filter((s) => existsSync(EDIT_SCREENS[s].page))).toEqual([]);
  });
});
