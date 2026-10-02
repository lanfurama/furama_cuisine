import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  // Every global beforeAll replaces, so afterAll puts all of them back.
  const original = {
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    fetch: globalThis.fetch,
    XMLHttpRequest: globalThis.XMLHttpRequest,
  };

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

/** A script element BotID adds to <head>; the test decides when it loads or fails. */
type FakeScript = { src: string; async: boolean; onload: (() => void) | null; onerror: ((e: unknown) => void) | null; settled: boolean; remove: () => void };

/**
 * A browser just big enough for BotID's client: <script> elements that load
 * or fail when the test says, window events, and a network (`network`) that
 * answers after `delay` ms and, like a real fetch, rejects on an aborted
 * signal. When BotID's challenge script loads it pushes `answer` into
 * window.V_C, as Vercel's c.js does; the Deep Analysis script (p.js) sets up
 * window.KPSDK and fires its ready events.
 */
function fakeBrowser() {
  const created: FakeScript[] = [];
  const head: FakeScript[] = [];
  const document = Object.assign(new EventTarget(), {
    hidden: false,
    querySelector(selector: string) {
      const exact = /^script\[src="(.*)"\]$/.exec(selector);
      if (exact) return head.find((s) => s.src === exact[1]) ?? null;
      const part = /^script\[src\*="(.*)"\]$/.exec(selector);
      if (part) return head.find((s) => s.src.includes(part[1])) ?? null;
      throw new Error(`unexpected selector ${selector}`);
    },
    createElement(tag: string): FakeScript {
      if (tag !== 'script') throw new Error(`unexpected element ${tag}`);
      const script: FakeScript = {
        src: '',
        async: false,
        onload: null,
        onerror: null,
        settled: false,
        remove: () => head.splice(head.indexOf(script), 1),
      };
      return script;
    },
    head: {
      appendChild(script: FakeScript) {
        head.push(script);
        created.push(script);
      },
    },
  });
  const window = Object.assign(new EventTarget(), {
    location: new URL('https://cuisine.example/en'),
    V_C: undefined as unknown,
    KPSDK: undefined as unknown,
    fetch: undefined as unknown as typeof fetch,
  });
  const browser = {
    window,
    document,
    answer: { b: 1, v: 'challenge-answer', e: 'e', d: 0 } as Record<string, unknown>,
    delay: 0,
    /** Every script BotID asked for, in order. */
    requested: () => created.map((s) => s.src),
    /** Loads every script that has neither loaded nor failed yet, in <head> or already taken out of it. */
    loadPending() {
      for (const script of created.filter((s) => !s.settled)) {
        script.settled = true;
        if (script.src.includes('/c.js')) (window.V_C as unknown[]).push(browser.answer);
        if (script.src.endsWith('/p.js')) {
          window.KPSDK = { configure: () => {} };
          document.dispatchEvent(new Event('kpsdk-load'));
          document.dispatchEvent(new Event('kpsdk-ready'));
        }
        script.onload?.();
      }
    },
    /** Fails every script still loading, as a blocked or broken request does. */
    failPending() {
      for (const script of created.filter((s) => !s.settled)) {
        script.settled = true;
        script.onerror?.(new Event('error'));
      }
    },
    network: vi.fn((_input: RequestInfo | URL, init: RequestInit = {}) => {
      const { signal } = init;
      if (signal?.aborted) return Promise.reject(signal.reason);
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response('ok')), browser.delay);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(signal.reason);
        });
      });
    }),
  };
  window.fetch = browser.network as unknown as typeof fetch;
  return browser;
}

/** Where a promise stands, read synchronously between timer steps. */
function track<T>(promise: Promise<T>) {
  const at: { state: 'pending' | 'resolved' | 'rejected'; error?: unknown } = { state: 'pending' };
  promise.then(
    () => (at.state = 'resolved'),
    (error: unknown) => Object.assign(at, { state: 'rejected', error }),
  );
  return at;
}

/*
 * Vercel BotID's challenge script (c.js) loads lazily on the first protected
 * POST, with no deadline. If it fails, BotID keeps the dead <script> and the
 * next POST waits for an answer that never comes; if it stalls, the first POST
 * waits for ever. Either way the guest's REQUEST BOOKING stayed on "SENDING…"
 * (B2). installBotIdWithDeadline bounds the challenge step, never the request
 * once it is on the network. The real initBotId runs against fakeBrowser().
 */
describe('installBotIdWithDeadline: BotID’s challenge has 15 s, the request itself is never cut', () => {
  const original = {
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    XMLHttpRequest: globalThis.XMLHttpRequest,
  };
  let browser: ReturnType<typeof fakeBrowser>;
  let botid: typeof import('./botid');
  let initBotId: typeof import('botid/client/core').initBotId;

  beforeEach(async () => {
    vi.useFakeTimers();
    browser = fakeBrowser();
    Object.assign(globalThis, {
      window: browser.window,
      document: browser.document,
      location: browser.window.location,
      // BotID patches XMLHttpRequest too; the booking uses fetch.
      XMLHttpRequest: class {
        open() {}
        send() {}
      },
    });
    // BotID logs a script that failed to load.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.resetModules();
    botid = await import('./botid');
    ({ initBotId } = await import('botid/client/core'));
  });

  afterEach(() => {
    Object.assign(globalThis, original);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** What instrumentation-client.ts does on a deployment. */
  const install = () => botid.installBotIdWithDeadline(() => initBotId({ protect: BOTID_PROTECT }));
  /** The booking's Server Action, as Next's action client sends it. */
  const callAction = () => window.fetch('/en', { method: 'POST', headers: { 'next-action': 'abc123' }, body: '[]' });
  const challengeScripts = () => browser.requested().filter((src) => src.includes('/c.js'));
  const sentHeader = (call: number, name: string) => new Headers(browser.network.mock.calls[call][1]?.headers).get(name);

  it('the deadline is 15 s', () => {
    expect(botid.BOTID_CHALLENGE_TIMEOUT_MS).toBe(15_000);
  });

  it('(a) a challenge script that failed to load is asked for again on the next tap, which then books', async () => {
    install();
    const first = track(callAction());
    await vi.advanceTimersByTimeAsync(0);
    browser.failPending();
    await vi.advanceTimersByTimeAsync(0);
    expect(first.state).toBe('rejected');
    expect(first.error).toBeInstanceOf(botid.BotIdUnavailableError);
    expect(browser.network).not.toHaveBeenCalled();

    // The guest taps REQUEST BOOKING again: a fresh copy of the script is fetched, and loads this time.
    const second = track(callAction());
    await vi.advanceTimersByTimeAsync(0);
    browser.loadPending();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(second.state).toBe('resolved');
    expect(challengeScripts()).toHaveLength(2);
    expect(browser.network).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sentHeader(0, 'x-is-human')!)).toMatchObject({ v: 'challenge-answer' });
    expect(sentHeader(0, 'next-action')).toBe('abc123');
  });

  it('(b) a challenge script that never loads fails the request at 15 s; nothing is sent, even when it loads later, and the next tap books', async () => {
    install();
    const post = track(callAction());
    await vi.advanceTimersByTimeAsync(14_999);
    expect(post.state).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(post.state).toBe('rejected');
    expect(post.error).toBeInstanceOf(botid.BotIdUnavailableError);
    expect(post.error).toMatchObject({ name: 'BotIdUnavailableError' });

    // The stalled script arrives after all: the request that timed out is never sent late.
    browser.loadPending();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(browser.network).not.toHaveBeenCalled();

    const again = track(callAction());
    await vi.advanceTimersByTimeAsync(0);
    browser.loadPending();
    await vi.advanceTimersByTimeAsync(0);
    expect(again.state).toBe('resolved');
    expect(challengeScripts()).toHaveLength(2);
    expect(browser.network).toHaveBeenCalledTimes(1);
  });

  it('(c) a request handed to the network is never cut: the server may already be booking', async () => {
    browser.delay = 20_000;
    install();
    const post = track(callAction());
    await vi.advanceTimersByTimeAsync(0);
    browser.loadPending();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(browser.network).toHaveBeenCalledTimes(1);
    expect(post.state).toBe('pending');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(post.state).toBe('resolved');
    expect(browser.network.mock.calls[0][1]?.signal?.aborted).toBe(false);
  });

  it('(d) a GET and another site’s POST get no deadline of ours: they reach the network as sent', async () => {
    browser.delay = 20_000;
    install();
    const get = track(window.fetch('/api/availability?restaurant=taya-house&lang=en'));
    const other = track(window.fetch('https://other.example/en', { method: 'POST' }));
    await vi.advanceTimersByTimeAsync(15_000);
    expect([get.state, other.state]).toEqual(['pending', 'pending']);
    await vi.advanceTimersByTimeAsync(5_000);
    expect([get.state, other.state]).toEqual(['resolved', 'resolved']);
    expect(browser.network.mock.calls.map(([, init]) => init?.signal)).toEqual([undefined, undefined]);
  });

  it('(d) BotID’s Deep Analysis calls fetch again with our signal: the same request, not a second deadline that would cut it', async () => {
    browser.answer = { b: 0, v: 'challenge-answer', e: 'e', d: 1 };
    browser.delay = 20_000;
    install();
    const post = track(callAction());
    await vi.advanceTimersByTimeAsync(0);
    browser.loadPending(); // c.js
    await vi.advanceTimersByTimeAsync(0);
    expect(browser.requested().at(-1)).toMatch(/\/p\.js$/);
    browser.loadPending(); // p.js, which Deep Analysis waits for before it sends the request again
    await vi.advanceTimersByTimeAsync(15_000);
    expect(browser.network).toHaveBeenCalledTimes(1);
    expect(post.state).toBe('pending');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(post.state).toBe('resolved');
    expect(JSON.parse(sentHeader(0, 'x-is-human')!)).toMatchObject({ d: 1 });
  });

  it('the caller’s own abort still works while the challenge waits, and sends nothing', async () => {
    install();
    const caller = new AbortController();
    const post = track(window.fetch('/en', { method: 'POST', body: '[]', signal: caller.signal }));
    await vi.advanceTimersByTimeAsync(1_000);
    caller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(post.state).toBe('rejected');
    expect(post.error).toMatchObject({ name: 'AbortError' });
    browser.loadPending();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(browser.network).not.toHaveBeenCalled();
  });
});
