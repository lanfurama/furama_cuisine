import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { roleCan } from '../../lib/server/auth/permissions';
import { actionFiles, actionPermissions, adminOnlyProblems, adminPluginCalls, adminPluginCallsIn, checkActions, publicActionsMissing, scanRepo } from './server-actions';

/*
 * Spec §7.1 / §13 "Bảo vệ": every Server Action ('use server' export or inline
 * 'use server' function) and every /api/admin/* route handler checks
 * requirePermission as its first statement, so nothing runs before the check.
 * The exceptions are public on purpose, and each says what protects it.
 */
const PUBLIC_ACTIONS = new Map([
  [
    'app/actions.ts#submitReservation',
    'honeypot and BotID first, then zod with consent, the per-phone daily limit, the slot and window checks, the per-table unique index (spec §7.1, §10.2)',
  ],
  ['app/admin/(auth)/sign-in/actions.ts#signIn', 'Better Auth checks the password, rate-limited per IP in auth_rate_limit'],
  ['app/admin/(shell)/actions.ts#signOut', 'ends only the session of the cookie it is sent with'],
  ['app/admin/(auth)/accept-invite/actions.ts#acceptInvitation', 'the 256-bit, single-use, 7-day invitation token is the credential'],
  ['app/admin/(auth)/reset-password/actions.ts#requestPasswordReset', 'same answer for every email; rate-limited per IP'],
  ['app/admin/(auth)/reset-password/actions.ts#resetPassword', 'Better Auth checks the 1-hour reset token; rate-limited per IP'],
]);

const ROOT = join(__dirname, '..', '..');

describe('requirePermission guard (the repository)', () => {
  it('every Server Action and /api/admin route handler checks requirePermission first, except the public list', () => {
    expect(scanRepo(ROOT, new Set(PUBLIC_ACTIONS.keys()))).toEqual([]);
  });

  it('every public action on the list still exists (a renamed one would leave a stale exception)', () => {
    expect(publicActionsMissing(ROOT, [...PUBLIC_ACTIONS.keys()])).toEqual([]);
  });

  it('the admin plugin’s endpoints are called only from lib/server/auth/staff.ts and scripts/create-admin.mjs', () => {
    expect(adminPluginCalls(ROOT)).toEqual([]);
  });

  it('every staff-screen action asks for a permission the Editor lacks', () => {
    expect(adminOnlyProblems(ROOT, ADMIN_ONLY_ACTIONS)).toEqual([]);
  });
});

/** Files whose every action is Admin-only (spec §7.1: staff, invitations; booking and notification settings; auto_confirm). */
const ADMIN_ONLY_ACTIONS = [
  'app/admin/(shell)/users/actions.ts',
  'app/admin/(shell)/settings/booking/actions.ts',
  'app/admin/(shell)/settings/notifications/actions.ts',
  'app/admin/(shell)/restaurants/[id]/booking/auto-confirm-actions.ts',
];

/*
 * Spec §7.1's matrix for the booking screens, action by action: the exact
 * permission each one asks for, and whether an Editor has it. A swapped
 * permission (an Editor locked out of a booking screen, or let into an
 * Admin-only one) fails here, and so does an action added without a row.
 */
const BOOKING_ACTIONS: Record<string, Record<string, { permission: object; editor: boolean }>> = {
  'app/admin/(shell)/reservations/actions.ts': {
    changeStatus: { permission: { reservations: ['update'] }, editor: true },
    updateReservation: { permission: { reservations: ['update'] }, editor: true },
    addNote: { permission: { reservations: ['note'] }, editor: true },
    createReservation: { permission: { reservations: ['create'] }, editor: true },
    cancelReservations: { permission: { reservations: ['update'] }, editor: true },
    searchReservations: { permission: { reservations: ['read'] }, editor: true },
  },
  'app/admin/(shell)/reservations/closures/actions.ts': {
    addClosure: { permission: { schedule: ['update'] }, editor: true },
    editClosure: { permission: { schedule: ['update'] }, editor: true },
    removeClosure: { permission: { schedule: ['update'] }, editor: true },
  },
  'app/admin/(shell)/restaurants/[id]/booking/actions.ts': {
    savePeriods: { permission: { schedule: ['update'] }, editor: true },
    saveRules: { permission: { reservations: ['configure'] }, editor: true },
  },
  'app/admin/(shell)/restaurants/[id]/booking/auto-confirm-actions.ts': {
    saveAutoConfirmSetting: { permission: { reservations: ['auto-confirm'] }, editor: false },
  },
  'app/admin/(shell)/settings/booking/actions.ts': {
    saveSettings: { permission: { settings: ['update'] }, editor: false },
  },
  // Phase 5: "Gửi lại" is a booking action for both roles; "Cài đặt … thông báo" is Admin only (spec §7.1),
  // and "Gửi email thử" sends to any address typed.
  'app/admin/(shell)/reservations/emails/actions.ts': {
    resendEmail: { permission: { reservations: ['update'] }, editor: true },
  },
  'app/admin/(shell)/settings/notifications/actions.ts': {
    addRecipient: { permission: { settings: ['update'] }, editor: false },
    editRecipient: { permission: { settings: ['update'] }, editor: false },
    removeRecipient: { permission: { settings: ['update'] }, editor: false },
    saveInbox: { permission: { settings: ['update'] }, editor: false },
    sendTest: { permission: { settings: ['update'] }, editor: false },
  },
};

/*
 * Spec §7.1, content (phase 7): Editor and Admin edit content and files and
 * restore their history; a restore asks for content:restore, every other
 * write content:update. Each content editor adds its action file here, and
 * the test after the matrix fails while a content screen's action file has
 * no rows.
 */
const CONTENT_ACTIONS: Record<string, Record<string, { permission: object; editor: boolean }>> = {
  // The registry keys of every string screen (lib/server/content/strings-admin.ts).
  'app/admin/(shell)/content/actions.ts': {
    saveScreenStrings: { permission: { content: ['update'] }, editor: true },
    restoreScreenString: { permission: { content: ['restore'] }, editor: true },
  },
  'app/admin/(shell)/content/offers/actions.ts': {
    createOfferAction: { permission: { content: ['update'] }, editor: true },
    saveOfferAction: { permission: { content: ['update'] }, editor: true },
    toggleOfferAction: { permission: { content: ['update'] }, editor: true },
    deleteOfferAction: { permission: { content: ['update'] }, editor: true },
    reorderOffersAction: { permission: { content: ['update'] }, editor: true },
    restoreOfferAction: { permission: { content: ['restore'] }, editor: true },
    restoreOfferOrderAction: { permission: { content: ['restore'] }, editor: true },
  },
  // Home sections (spec §7.2 content/sections); the hero screen's film part posts saveSectionAction too (C5).
  'app/admin/(shell)/content/sections/actions.ts': {
    saveSectionAction: { permission: { content: ['update'] }, editor: true },
    restoreSectionAction: { permission: { content: ['restore'] }, editor: true },
  },
  // The hero's slides and their pace (spec §7.2 content/hero).
  'app/admin/(shell)/content/hero/actions.ts': {
    createSlideAction: { permission: { content: ['update'] }, editor: true },
    saveSlideAction: { permission: { content: ['update'] }, editor: true },
    toggleSlideAction: { permission: { content: ['update'] }, editor: true },
    deleteSlideAction: { permission: { content: ['update'] }, editor: true },
    reorderSlidesAction: { permission: { content: ['update'] }, editor: true },
    restoreSlideAction: { permission: { content: ['restore'] }, editor: true },
    restoreSlideOrderAction: { permission: { content: ['restore'] }, editor: true },
    saveAutoplayAction: { permission: { content: ['update'] }, editor: true },
    restoreAutoplayAction: { permission: { content: ['restore'] }, editor: true },
  },
  // One restaurant's content (spec §7.2 /admin/restaurants/[id]): the aggregate's save and History.
  'app/admin/(shell)/restaurants/[id]/actions.ts': {
    saveRestaurantAction: { permission: { content: ['update'] }, editor: true },
    restoreRestaurantAction: { permission: { content: ['restore'] }, editor: true },
  },
  // The media library (spec §7.2 /admin/media): upload step 2, alt text, delete, and History.
  'app/admin/(shell)/media/actions.ts': {
    registerMediaAction: { permission: { content: ['update'] }, editor: true },
    saveMediaDetailsAction: { permission: { content: ['update'] }, editor: true },
    deleteMediaAction: { permission: { content: ['update'] }, editor: true },
    restoreMediaAction: { permission: { content: ['restore'] }, editor: true },
  },
};

/** Where content editors keep their Server Actions (spec §7.2): every 'use server' file here needs CONTENT_ACTIONS rows. */
const CONTENT_SCREENS = ['app/admin/(shell)/content/', 'app/admin/(shell)/media/', 'app/admin/(shell)/restaurants/[id]/actions.ts', 'app/admin/(shell)/restaurants/actions.ts'];

describe('booking and content actions follow the permission matrix (spec §7.1)', () => {
  it('every content screen’s action file has its rows in CONTENT_ACTIONS', () => {
    expect(actionFiles(ROOT, CONTENT_SCREENS).filter((rel) => !(rel in CONTENT_ACTIONS))).toEqual([]);
  });

  for (const [rel, actions] of Object.entries({ ...BOOKING_ACTIONS, ...CONTENT_ACTIONS })) {
    it(rel, () => {
      const found = actionPermissions(ROOT, rel);
      expect(Object.keys(found).sort()).toEqual(Object.keys(actions).sort());
      for (const [name, { permission, editor }] of Object.entries(actions)) {
        expect(found[name], name).toEqual(permission);
        expect(roleCan('editor', permission), `${name}: Editor`).toBe(editor);
        expect(roleCan('admin', permission), `${name}: Admin`).toBe(true);
      }
    });
  }
});

describe('requirePermission guard (what it catches)', () => {
  const none = new Set<string>();
  const check = (source: string, rel = 'app/x/actions.ts', allow = none) => checkActions(rel, source, allow);

  it('an exported action that never checks', () => {
    expect(check(`'use server';\nexport async function ok() { await requirePermission({ user: ['list'] }); }\nexport const bad = async () => {};`)).toEqual([
      'app/x/actions.ts#bad: does not start with await requirePermission()',
    ]);
  });

  it('a check that comes after a side effect', () => {
    expect(check(`'use server';\nexport async function late() { await db.query('DELETE'); await requirePermission({}); }`)).toEqual([
      'app/x/actions.ts#late: does not start with await requirePermission()',
    ]);
  });

  it('a check that is not awaited, or runs only under a condition', () => {
    const source = `'use server';
export async function a() { requirePermission({ user: ['ban'] }); await write(); }
export async function b(x) { if (x) await requirePermission({ user: ['ban'] }); await write(); }`;
    expect(check(source)).toEqual([
      'app/x/actions.ts#a: does not start with await requirePermission()',
      'app/x/actions.ts#b: does not start with await requirePermission()',
    ]);
  });

  it('accepts the check as the first statement of a top-level try whose catch only returns or throws', () => {
    expect(
      check(`'use server';\nexport async function a(x) {\n  try {\n    const actor = await requirePermission({ user: ['ban'] });\n    return actor;\n  } catch (e) { return actionError(e); }\n}
export async function b() {\n  try { await requirePermission({ user: ['ban'] }); } catch (e) { throw e; }\n  await write();\n}`),
    ).toEqual([]);
  });

  const runsMore = 'a failed requirePermission() can run more code (its catch must be one return or throw statement; no finally)';

  it('a try whose catch lets a failed check fall through, or that has a finally', () => {
    const source = `'use server';
export async function a() {
  try { await requirePermission({ user: ['ban'] }); } catch {}
  await write();
}
export async function b() {
  try { await requirePermission({ user: ['ban'] }); } finally { await write(); }
}`;
    expect(check(source)).toEqual([`app/x/actions.ts#a: ${runsMore}`, `app/x/actions.ts#b: ${runsMore}`]);
  });

  it('a catch that does anything besides one return or throw (it runs for a refused caller)', () => {
    const source = `'use server';
export async function a() {
  try { await requirePermission({ user: ['ban'] }); await write(); } catch (e) { await db.query('DELETE FROM staff_user'); return actionError(e); }
}
export async function b() {
  try { await requirePermission({ user: ['ban'] }); await write(); } catch (e) { notify(e); throw e; }
}`;
    expect(check(source)).toEqual([`app/x/actions.ts#a: ${runsMore}`, `app/x/actions.ts#b: ${runsMore}`]);
  });

  it('an export that is not a function declared in the file', () => {
    expect(check(`'use server';\nexport { other } from './elsewhere';\nexport const n = 1;`)).toEqual([
      'app/x/actions.ts#other: export the action as a function declared in this file',
      'app/x/actions.ts#n: export the action as a function declared in this file',
    ]);
  });

  it('an inline action without the check', () => {
    expect(check(`export function Page() { async function save() { 'use server'; await write(); } return save; }`, 'app/x/page.tsx')).toEqual([
      "app/x/page.tsx: inline 'use server' function save: does not start with await requirePermission()",
    ]);
  });

  it('a route handler under app/api/admin', () => {
    expect(check(`export async function POST(req) { return Response.json(await req.json()); }`, 'app/api/admin/x/route.ts')).toEqual([
      'app/api/admin/x/route.ts#POST: does not start with await requirePermission()',
    ]);
  });

  it('scans every directory of app code, and every route under app/api/admin for every method', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-'));
    const put = (rel: string, source: string) => {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), source);
    };
    const unchecked = `'use server';\nexport async function wipe() { await write(); }`;
    put('db/actions.ts', unchecked);
    put('actions.mjs', unchecked);
    put('app/api/admin/route.ts', 'export function HEAD() { return new Response(null); }\nexport function OPTIONS() { return new Response(null); }');
    for (const skipped of ['test/actions.ts', 'e2e/actions.ts', 'node_modules/x/actions.ts', '.claude/actions.ts', 'app/x/actions.test.ts']) {
      put(skipped, unchecked);
    }
    expect(scanRepo(root, none).sort()).toEqual([
      'actions.mjs#wipe: does not start with await requirePermission()',
      'app/api/admin/route.ts#HEAD: does not start with await requirePermission()',
      'app/api/admin/route.ts#OPTIONS: does not start with await requirePermission()',
      'db/actions.ts#wipe: does not start with await requirePermission()',
    ]);
  });

  it('an admin plugin endpoint outside the two allowed files, called or destructured', () => {
    const source = `export async function a(auth) {
  await auth.api.adminUpdateUser({ body: { userId: 'u', data: { role: 'admin' } } });
  const { setRole, getSession } = auth.api;
  const { api: { revokeUserSessions } } = auth;
  return [setRole, getSession, revokeUserSessions];
}`;
    expect(adminPluginCallsIn('app/x/actions.ts', source)).toEqual([
      'app/x/actions.ts: auth.api.adminUpdateUser',
      'app/x/actions.ts: auth.api.setRole',
      'app/x/actions.ts: auth.api.revokeUserSessions',
    ]);
    expect(adminPluginCallsIn('lib/server/auth/staff.ts', source)).toEqual([]);
  });

  it('an Admin-only action whose permission an Editor also has, or that is not a literal', () => {
    const source = `'use server';
export async function a() { await requirePermission({ user: ['create'] }); }
export async function b() { await requirePermission({ content: ['update'] }); }
export async function c() { await requirePermission(PERMS); }`;
    expect(adminOnlyProblems(ROOT, ['x.ts'], () => source)).toEqual([
      'x.ts#b: an Editor passes requirePermission({"content":["update"]})',
      'x.ts#c: requirePermission() must take an object literal of plain keys and string arrays',
    ]);
  });

  it('a computed key, which names whatever the variable holds (here a resource the Editor has)', () => {
    const source = `'use server';
const r = 'content';
export async function d() { await requirePermission({ [r]: ['update'] }); }
export async function e() { await requirePermission({ ['user']: ['create'] }); }`;
    expect(adminOnlyProblems(ROOT, ['x.ts'], () => source)).toEqual([
      'x.ts#d: requirePermission() must take an object literal of plain keys and string arrays',
      'x.ts#e: requirePermission() must take an object literal of plain keys and string arrays',
    ]);
  });

  it('the public list exempts exactly the named export', () => {
    const source = `'use server';\nexport async function signIn() {}\nexport async function other() {}`;
    expect(check(source, 'app/a/actions.ts', new Set(['app/a/actions.ts#signIn']))).toEqual([
      'app/a/actions.ts#other: does not start with await requirePermission()',
    ]);
  });
});
