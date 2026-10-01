import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * getStaffSession answers a request without a Better Auth session cookie by
 * itself, so anonymous and bot hits on /admin/sign-in never build Better Auth
 * (nor run its first-use schema check). headers() still comes first.
 */
const { getSession, getAuth, requestHeaders } = vi.hoisted(() => {
  const sessionLookup = vi.fn();
  return {
    getSession: sessionLookup,
    getAuth: vi.fn(() => ({ api: { getSession: sessionLookup } })),
    requestHeaders: { current: new Headers() },
  };
});

vi.mock('next/headers', () => ({ headers: async () => requestHeaders.current }));
vi.mock('@/lib/server/auth/auth', () => ({ getAuth }));

const { getStaffSession } = await import('./session');

const staffUser = { id: 'u1', email: 'lan@furama.test', name: 'Lan', role: 'admin', banned: false };

beforeEach(() => {
  getAuth.mockClear();
  getSession.mockReset();
});

describe('getStaffSession', () => {
  it('without a session cookie: null, and Better Auth is never built', async () => {
    for (const cookie of [null, 'NEXT_LOCALE=en', 'better-auth.session_data=cached-only']) {
      requestHeaders.current = new Headers(cookie ? { cookie } : {});
      expect(await getStaffSession()).toBeNull();
    }
    expect(getAuth).not.toHaveBeenCalled();
  });

  it('with the cookie (http or __Secure- https name): asks Better Auth, which still decides', async () => {
    getSession.mockResolvedValue({ user: staffUser });
    for (const cookie of ['better-auth.session_token=t.sig', '__Secure-better-auth.session_token=t.sig']) {
      requestHeaders.current = new Headers({ cookie, 'x-forwarded-for': '203.0.113.9, 10.0.0.1' });
      expect(await getStaffSession()).toEqual({ userId: 'u1', email: 'lan@furama.test', name: 'Lan', role: 'admin', ip: '203.0.113.9' });
    }
    expect(getSession).toHaveBeenCalledTimes(2);

    // A forged or expired cookie is still only a cookie: no session in the database, no staff.
    getSession.mockResolvedValue(null);
    requestHeaders.current = new Headers({ cookie: 'better-auth.session_token=forged.value' });
    expect(await getStaffSession()).toBeNull();
  });
});
