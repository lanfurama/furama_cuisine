import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The Server Actions behind sign-in and reset call Better Auth's own HTTP
 * router in process, so its rate limit and origin check apply (spec §7.1, §7.3).
 * What they pass on is an allowlist: never the visitor's cookies.
 */

const handler = vi.fn<(request: Request) => Promise<Response>>();
const incoming = new Headers({
  cookie: 'better-auth.session_token=someone-else',
  'x-forwarded-for': '203.0.113.5',
  'x-real-ip': '203.0.113.5',
  'user-agent': 'UA/1',
  origin: 'https://evil.example',
  'x-other': 'x',
});
const jar = { set: vi.fn() };

vi.mock('next/headers', () => ({ headers: async () => incoming, cookies: async () => jar }));
vi.mock('./auth', () => ({
  getAuth: () => ({ handler, $context: Promise.resolve({ baseURL: 'http://localhost:3210/api/auth' }) }),
}));

const { applySetCookies, callAuthEndpoint } = await import('./endpoint');

beforeEach(() => {
  handler.mockReset();
  handler.mockResolvedValue(new Response('{}'));
  jar.set.mockReset();
});

describe('callAuthEndpoint', () => {
  it('POSTs JSON from the app’s own origin, forwarding only the client address and user agent', async () => {
    await callAuthEndpoint('/sign-in/email', { email: 'a@furama.test', password: 'x' });
    const request = handler.mock.calls[0][0];
    expect(request.method).toBe('POST');
    expect(request.url).toBe('http://localhost:3210/api/auth/sign-in/email');
    expect(Object.fromEntries(request.headers)).toEqual({
      'content-type': 'application/json',
      origin: 'http://localhost:3210',
      'x-forwarded-for': '203.0.113.5',
      'x-real-ip': '203.0.113.5',
      'user-agent': 'UA/1',
    });
    expect(await request.json()).toEqual({ email: 'a@furama.test', password: 'x' });
  });
});

describe('applySetCookies', () => {
  it('copies each Set-Cookie into the action’s response with its attributes', async () => {
    const res = new Response(null, {
      headers: [
        ['set-cookie', 'better-auth.session_token=abc.def; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax'],
        ['set-cookie', 'other=1; Path=/admin; Secure'],
      ],
    });
    await applySetCookies(res);
    expect(jar.set).toHaveBeenCalledWith(
      'better-auth.session_token',
      'abc.def',
      expect.objectContaining({ maxAge: 604800, path: '/', httpOnly: true, sameSite: 'lax' }),
    );
    expect(jar.set).toHaveBeenCalledWith('other', '1', expect.objectContaining({ path: '/admin', secure: true }));
  });
});
