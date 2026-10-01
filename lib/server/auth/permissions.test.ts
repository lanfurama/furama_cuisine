import { describe, expect, it } from 'vitest';
import { roleCan, statement, type Permissions } from './permissions';

// Spec §7.1 permission matrix, row by row.
const BOTH: Permissions[] = [
  { content: ['read', 'update', 'ai'] }, // content, files, translations; AI helpers
  { content: ['restore'] }, // history and restore (§7.5)
  { reservations: ['read', 'update', 'create', 'note'] },
  { schedule: ['read', 'update'] }, // service periods, capacity, closures
  { reservations: ['configure'] }, // per-restaurant booking switch and overrides
];
const ADMIN_ONLY: Permissions[] = [
  { reservations: ['auto-confirm'] },
  { locales: ['update'] },
  { settings: ['update'] },
  { user: ['create'] },
  { user: ['list'] },
  { user: ['set-role'] },
  { user: ['ban'] },
  { user: ['delete'] },
  { audit: ['read'] },
  { reservations: ['purge-test'] },
];

describe('roleCan', () => {
  it.each(BOTH)('Editor and Admin may %j', (p) => {
    expect(roleCan('editor', p)).toBe(true);
    expect(roleCan('admin', p)).toBe(true);
  });

  it.each(ADMIN_ONLY)('only Admin may %j', (p) => {
    expect(roleCan('editor', p)).toBe(false);
    expect(roleCan('admin', p)).toBe(true);
  });

  it('grants impersonation and email changes to no role', () => {
    for (const role of ['admin', 'editor']) {
      expect(roleCan(role, { user: ['impersonate'] })).toBe(false);
      expect(roleCan(role, { user: ['impersonate-admins'] })).toBe(false);
      expect(roleCan(role, { user: ['set-email'] })).toBe(false);
    }
  });

  it('gives the Editor nothing on user, session, audit, settings or locales', () => {
    for (const action of statement.user) expect(roleCan('editor', { user: [action] })).toBe(false);
    for (const action of statement.session) expect(roleCan('editor', { session: [action] })).toBe(false);
    for (const action of statement.settings) expect(roleCan('editor', { settings: [action] })).toBe(false);
    for (const action of statement.locales) expect(roleCan('editor', { locales: [action] })).toBe(false);
    expect(roleCan('editor', { audit: ['read'] })).toBe(false);
  });

  it('denies unknown, empty and missing roles', () => {
    expect(roleCan('user', { content: ['read'] })).toBe(false);
    expect(roleCan('', { content: ['read'] })).toBe(false);
    expect(roleCan(null, { content: ['read'] })).toBe(false);
    expect(roleCan(undefined, { content: ['read'] })).toBe(false);
  });

  it('needs every requested action', () => {
    expect(roleCan('editor', { content: ['read'], settings: ['read'] })).toBe(false);
  });
});
