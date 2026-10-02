import { checkBotId } from 'botid/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOTID_TIMEOUT_MS, isBotRequest, type BotCheck } from './bot';

type Verdict = Awaited<ReturnType<BotCheck>>;
const verdict = (isBot: boolean, extra: Partial<Verdict> = {}): Verdict =>
  ({ isHuman: !isBot, isBot, isVerifiedBot: false, bypassed: false, ...extra }) as Verdict;

/** A deployment as Vercel runs it: VERCEL_ENV at runtime, and the same value inlined into the build as NEXT_PUBLIC_VERCEL_ENV. */
const deployed = (VERCEL_ENV: string) => ({ VERCEL_ENV, NEXT_PUBLIC_VERCEL_ENV: VERCEL_ENV });

const HALF_SET_UP =
  '[botid] off, bookings let through unchecked: this deployment was built without NEXT_PUBLIC_VERCEL_ENV, so browsers were never given BotID. Turn on "Automatically expose System Environment Variables" in the Vercel project settings, then redeploy.';

afterEach(() => vi.restoreAllMocks());

describe('isBotRequest off Vercel (local, CI, E2E)', () => {
  it('asks nobody and lets everyone through', async () => {
    const check = vi.fn<BotCheck>();
    expect(await isBotRequest({}, check)).toBe(false);
    expect(await isBotRequest({ VERCEL_ENV: 'development' }, check)).toBe(false); // vercel dev / vercel env pull
    expect(check).not.toHaveBeenCalled();
  });

  it('BOTID_DEV_BYPASS=BAD-BOT blocks through BotID’s own development bypass (the real package, no network)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // BotID notes the missing x-is-human header
    expect(await isBotRequest({ BOTID_DEV_BYPASS: 'BAD-BOT' })).toBe(true);
    // Any other value is the default: human.
    expect(await isBotRequest({ BOTID_DEV_BYPASS: 'HUMAN' })).toBe(false);
  });

  it('the bypass passes isDevelopment, so it works under next start (NODE_ENV=production) too', async () => {
    const check = vi.fn<BotCheck>(async () => verdict(true));
    await isBotRequest({ BOTID_DEV_BYPASS: 'BAD-BOT' }, check);
    expect(check).toHaveBeenCalledWith({ developmentOptions: { isDevelopment: true, bypass: 'BAD-BOT' } });
  });
});

describe('isBotRequest on a Vercel deployment', () => {
  it.each(['production', 'preview'])('%s: asks BotID with no options and follows its verdict', async (env) => {
    const check = vi.fn<BotCheck>(async () => verdict(true));
    expect(await isBotRequest(deployed(env), check)).toBe(true);
    expect(check).toHaveBeenCalledWith();
    check.mockResolvedValueOnce(verdict(false));
    expect(await isBotRequest(deployed(env), check)).toBe(false);
  });

  it('ignores BOTID_DEV_BYPASS', async () => {
    const check = vi.fn<BotCheck>(async () => verdict(false));
    expect(await isBotRequest({ ...deployed('production'), BOTID_DEV_BYPASS: 'BAD-BOT' }, check)).toBe(false);
    expect(check).toHaveBeenCalledWith();
  });

  it.each([
    ['isBot and isVerifiedBot', verdict(true, { isVerifiedBot: true })],
    // The shape BotID's own GOOD-BOT bypass gives a verified bot.
    ['isVerifiedBot alone', verdict(false, { isHuman: false, isVerifiedBot: true })],
  ])('refuses a verified bot too, whichever flag marks it (%s): booking is for people', async (_, answer) => {
    const check = vi.fn<BotCheck>(async () => answer);
    expect(await isBotRequest(deployed('production'), check)).toBe(true);
  });

  it('fails open when BotID cannot answer, and logs no request data', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    // What checkBotId throws when the project has OIDC switched off.
    const check = vi.fn<BotCheck>(async () => {
      throw new Error("The 'x-vercel-oidc-token' header is missing from the request.");
    });
    expect(await isBotRequest(deployed('production'), check)).toBe(false);
    expect(log).toHaveBeenCalledWith('[botid] check failed, request let through', {
      name: 'Error',
      message: "The 'x-vercel-oidc-token' header is missing from the request.",
    });
  });

  it('fails open, and logs it, when BotID answers without a verdict', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    // What checkBotId resolves to when the API answers with a JSON error (see the real-package test below).
    const check = vi.fn<BotCheck>(async () => ({ isHuman: true }) as Verdict);
    expect(await isBotRequest(deployed('production'), check)).toBe(false);
    expect(log).toHaveBeenCalledWith('[botid] check failed, request let through', {
      name: 'BotIdError',
      message: 'no verdict in the BotID response',
    });
  });

  it('fails open when BotID does not answer within 3 s', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // checkBotId's fetch to Vercel has no deadline of its own: a hanging API never settles.
      const check = vi.fn<BotCheck>(() => new Promise<Verdict>(() => {}));
      let settled = false;
      const pending = isBotRequest(deployed('production'), check).finally(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(BOTID_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toBe(false);
      expect(BOTID_TIMEOUT_MS).toBe(3_000);
      expect(log).toHaveBeenCalledWith('[botid] check failed, request let through', { name: 'TimeoutError', message: 'no verdict within 3000 ms' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('the real checkBotId, deployed but with no OIDC token, throws (so the fail-open path is the one that runs)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const saved = process.env.VERCEL_OIDC_TOKEN;
    delete process.env.VERCEL_OIDC_TOKEN;
    try {
      await expect(checkBotId({ developmentOptions: { isDevelopment: false } })).rejects.toThrow(/x-vercel-oidc-token/);
    } finally {
      if (saved !== undefined) process.env.VERCEL_OIDC_TOKEN = saved;
    }
  });

  it('the real checkBotId turns an error reply from the BotID API into a verdict with no isBot, which is logged and let through', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Nothing leaves the process: the API address is one that cannot resolve, and fetch is stubbed.
    vi.stubEnv('OVERRIDE_BOTID_SERVER_URL', 'https://botid.invalid');
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string | URL) => {
      asked.push(String(url));
      // checkBotId reads the body whatever the status: an expired OIDC token, BotID off for the project, a rate limit.
      return Response.json({ error: { code: 'forbidden', message: 'Not authorized' } }, { status: 403 });
    });
    // What a Vercel Function gives BotID: the request's headers (its OIDC token included) and a hook on the response headers.
    const requestContext = Symbol.for('@vercel/request-context');
    const vercel = globalThis as unknown as Record<symbol, unknown>;
    vercel[requestContext] = {
      get: () => ({
        url: 'https://cuisine.example/en',
        headers: { 'x-vercel-oidc-token': 'oidc-token', 'x-is-human': '{}' },
        mutateResponseHeadersBeforeFlush: () => {},
      }),
    };
    try {
      const real: BotCheck = () => checkBotId({ developmentOptions: { isDevelopment: false } });
      expect(await real()).toMatchObject({ isHuman: true, isBot: undefined });
      expect(await isBotRequest(deployed('production'), real)).toBe(false);
      expect(log).toHaveBeenCalledWith('[botid] check failed, request let through', {
        name: 'BotIdError',
        message: 'no verdict in the BotID response',
      });
      expect(asked.length).toBeGreaterThan(0);
      expect(asked.every((url) => url.startsWith('https://botid.invalid/'))).toBe(true);
    } finally {
      delete vercel[requestContext];
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});

describe('isBotRequest on a deployment built without NEXT_PUBLIC_VERCEL_ENV', () => {
  // instrumentation-client.ts installs BotID only when the build inlined NEXT_PUBLIC_VERCEL_ENV, which Vercel
  // provides only with "Automatically expose System Environment Variables" on. Without it, no request carries
  // x-is-human, and asking BotID would call every guest a bot.
  it('never asks BotID, lets the booking through, and says once which setting to turn on', async () => {
    vi.resetModules(); // a fresh module: the warning is once per server instance
    const fresh = await import('./bot');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const check = vi.fn<BotCheck>(async () => verdict(true));
    expect(await fresh.isBotRequest({ VERCEL_ENV: 'production' }, check)).toBe(false);
    expect(await fresh.isBotRequest({ VERCEL_ENV: 'preview', NEXT_PUBLIC_VERCEL_ENV: '' }, check)).toBe(false);
    // A deployment still ignores the test bypass.
    expect(await fresh.isBotRequest({ VERCEL_ENV: 'production', BOTID_DEV_BYPASS: 'BAD-BOT' }, check)).toBe(false);
    expect(check).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(HALF_SET_UP);
  });
});
