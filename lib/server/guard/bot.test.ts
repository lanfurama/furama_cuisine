import { checkBotId } from 'botid/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOTID_TIMEOUT_MS, isBotRequest, type BotCheck } from './bot';

type Verdict = Awaited<ReturnType<BotCheck>>;
const verdict = (isBot: boolean, extra: Partial<Verdict> = {}): Verdict =>
  ({ isHuman: !isBot, isBot, isVerifiedBot: false, bypassed: false, ...extra }) as Verdict;

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
  it.each(['production', 'preview'])('%s: asks BotID with no options and follows its verdict', async (VERCEL_ENV) => {
    const check = vi.fn<BotCheck>(async () => verdict(true));
    expect(await isBotRequest({ VERCEL_ENV }, check)).toBe(true);
    expect(check).toHaveBeenCalledWith();
    check.mockResolvedValueOnce(verdict(false));
    expect(await isBotRequest({ VERCEL_ENV }, check)).toBe(false);
  });

  it('ignores BOTID_DEV_BYPASS', async () => {
    const check = vi.fn<BotCheck>(async () => verdict(false));
    expect(await isBotRequest({ VERCEL_ENV: 'production', BOTID_DEV_BYPASS: 'BAD-BOT' }, check)).toBe(false);
    expect(check).toHaveBeenCalledWith();
  });

  it('refuses a verified bot too: booking is for people', async () => {
    const check = vi.fn<BotCheck>(async () => verdict(true, { isVerifiedBot: true }));
    expect(await isBotRequest({ VERCEL_ENV: 'production' }, check)).toBe(true);
  });

  it('fails open when BotID cannot answer, and logs no request data', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    // What checkBotId throws when the project has OIDC switched off.
    const check = vi.fn<BotCheck>(async () => {
      throw new Error("The 'x-vercel-oidc-token' header is missing from the request.");
    });
    expect(await isBotRequest({ VERCEL_ENV: 'production' }, check)).toBe(false);
    expect(log).toHaveBeenCalledWith('[botid] check failed, request let through', {
      name: 'Error',
      message: "The 'x-vercel-oidc-token' header is missing from the request.",
    });
  });

  it('fails open when BotID does not answer within 3 s', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // checkBotId's fetch to Vercel has no deadline of its own: a hanging API never settles.
      const check = vi.fn<BotCheck>(() => new Promise<Verdict>(() => {}));
      let settled = false;
      const pending = isBotRequest({ VERCEL_ENV: 'production' }, check).finally(() => {
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
});
