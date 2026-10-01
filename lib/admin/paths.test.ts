import { describe, expect, it } from 'vitest';
import { isAdminPath, isPublicAdminPath, safeAdminNext } from './paths';

describe('isAdminPath / isPublicAdminPath', () => {
  it.each([
    ['/admin', true],
    ['/admin/users', true],
    ['/administrator', false],
    ['/en/admin', false],
  ])('%s → %s', (p, expected) => expect(isAdminPath(p)).toBe(expected));

  it('only the three auth pages are public, matched exactly', () => {
    expect(['/admin/sign-in', '/admin/accept-invite', '/admin/reset-password'].every(isPublicAdminPath)).toBe(true);
    expect(isPublicAdminPath('/admin')).toBe(false);
    expect(isPublicAdminPath('/admin/sign-in/x')).toBe(false);
  });
});

describe('safeAdminNext', () => {
  it.each([
    ['/admin/users', '/admin/users'],
    ['/admin/users?tab=moi', '/admin/users?tab=moi'],
    ['/admin/users?_rsc=1&tab=moi', '/admin/users?tab=moi'],
    ['/admin', '/admin'],
  ])('keeps %s', (input, out) => expect(safeAdminNext(input)).toBe(out));

  it.each([
    [undefined],
    [null],
    [''],
    ['admin/users'],
    ['//evil.example/admin'],
    ['/\\evil.example'],
    ['https://evil.example/admin'],
    ['/en'],
    ['/administrator'],
    ['/admin/sign-in'],
    ['/admin/../en'],
    ['/admin/%2e%2e/en'],
  ])('rejects %s → /admin', (input) => expect(safeAdminNext(input)).toBe('/admin'));
});
