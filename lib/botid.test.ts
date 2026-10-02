import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BOTID_PROTECT, botIdEnabled } from './botid';

describe('botIdEnabled', () => {
  it.each([
    ['production', '/en', true],
    ['preview', '/en/restaurants/taya-house', true],
    ['preview', '/vi/privacy', true],
    ['production', '/admin', false],
    ['production', '/admin/reservations', false],
    ['development', '/en', false], // vercel dev / vercel env pull
    [undefined, '/en', false], // local, CI, E2E: nobody can answer the challenge
  ])('%s %s → %s', (env, path, on) => {
    expect(botIdEnabled(env, path)).toBe(on);
  });

  it('a guest path that merely starts with "admin" is still a guest path', () => {
    expect(botIdEnabled('production', '/administration')).toBe(true);
  });
});

/*
 * The real initBotId from botid/client/core, run against a minimal browser:
 * the challenge script counts as loaded and window.V_C already holds an
 * answer, which is what Vercel's c.js pushes. What is checked is ours: that
 * BOTID_PROTECT makes the wrapper put x-is-human on a Server Action's POST to
 * any guest page, and on nothing else.
 */
describe('BOTID_PROTECT under the real BotID fetch wrapper', () => {
  const sent: { url: string; method: string; headers: Headers }[] = [];
  const original = { window: globalThis.window, document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch };

  beforeAll(async () => {
    const fakeWindow = {
      V_C: [{ b: 1, v: 'challenge-answer', e: 'e', d: 0 }],
      location: new URL('https://cuisine.example/en'),
      addEventListener: () => {},
      fetch: async (input: string | URL, init: RequestInit = {}) => {
        sent.push({ url: String(input), method: init.method ?? 'GET', headers: new Headers(init.headers) });
        return new Response('ok');
      },
    };
    Object.assign(globalThis, {
      window: fakeWindow,
      location: fakeWindow.location,
      // Every <script src> counts as present, so getChallenge does not wait for a load.
      document: { querySelector: () => ({}), hidden: false, addEventListener: () => {} },
      // BotID patches XMLHttpRequest too; these tests only use fetch.
      XMLHttpRequest: class {
        open() {}
        send() {}
      },
    });
    const { initBotId } = await import('botid/client/core');
    initBotId({ protect: BOTID_PROTECT });
  });

  afterAll(() => {
    Object.assign(globalThis, original);
    vi.resetModules();
  });

  /** What Next's action client does (segment-cache/fetch.js:28): the global fetch, at call time, to the page's URL. */
  const callAction = (url: string) =>
    window.fetch(url, { method: 'POST', headers: { accept: 'text/x-component', 'next-action': 'abc123' }, body: '[]' });

  it.each(['/en', '/en/restaurants/taya-house', '/vi/privacy', '/zh-hans/restaurants/don-ciprianis?x=1'])(
    'a Server Action posted to %s carries the challenge answer',
    async (url) => {
      sent.length = 0;
      await callAction(url);
      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0].headers.get('x-is-human')!)).toMatchObject({ v: 'challenge-answer' });
      expect(sent[0].headers.get('x-path')).toBe(new URL(url, 'https://cuisine.example').pathname);
      expect(sent[0].headers.get('x-method')).toBe('POST');
      // Next's own headers survive the wrapper.
      expect(sent[0].headers.get('next-action')).toBe('abc123');
    },
  );

  it('the availability GETs and another site are left alone', async () => {
    sent.length = 0;
    await window.fetch('/api/availability?restaurant=taya-house&lang=en');
    await window.fetch('https://other.example/en', { method: 'POST' });
    expect(sent.map((s) => s.headers.has('x-is-human'))).toEqual([false, false]);
  });
});
