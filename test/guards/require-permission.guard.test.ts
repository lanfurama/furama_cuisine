import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adminPluginCalls, adminPluginCallsIn, checkActions, publicActionsMissing, scanRepo } from './server-actions';

/*
 * Spec §7.1 / §13 "Bảo vệ": every Server Action ('use server' export or inline
 * 'use server' function) and every /api/admin/* route handler checks
 * requirePermission as its first statement, so nothing runs before the check.
 * The exceptions are public on purpose, and each says what protects it.
 */
const PUBLIC_ACTIONS = new Map([
  ['app/actions.ts#submitReservation', 'zod, the slot and window checks, the per-table unique index (spec §7.1)'],
  ['app/admin/(auth)/sign-in/actions.ts#signIn', 'Better Auth checks the password, rate-limited per IP in auth_rate_limit'],
  ['app/admin/(shell)/actions.ts#signOut', 'ends only the session of the cookie it is sent with'],
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

  it('accepts the check as the first statement of a top-level try', () => {
    expect(
      check(`'use server';\nexport async function a(x) {\n  try {\n    const actor = await requirePermission({ user: ['ban'] });\n    return actor;\n  } catch (e) { return e; }\n}`),
    ).toEqual([]);
  });

  it('a try whose catch lets a failed check fall through, or that has a finally', () => {
    const source = `'use server';
export async function a() {
  try { await requirePermission({ user: ['ban'] }); } catch {}
  await write();
}
export async function b() {
  try { await requirePermission({ user: ['ban'] }); } finally { await write(); }
}`;
    const fallsThrough = 'a failed requirePermission() can fall through its try (end the catch with return or throw; no finally)';
    expect(check(source)).toEqual([`app/x/actions.ts#a: ${fallsThrough}`, `app/x/actions.ts#b: ${fallsThrough}`]);
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

  it('the public list exempts exactly the named export', () => {
    const source = `'use server';\nexport async function signIn() {}\nexport async function other() {}`;
    expect(check(source, 'app/a/actions.ts', new Set(['app/a/actions.ts#signIn']))).toEqual([
      'app/a/actions.ts#other: does not start with await requirePermission()',
    ]);
  });
});
