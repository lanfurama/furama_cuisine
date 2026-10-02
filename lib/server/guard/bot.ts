import 'server-only';
import { checkBotId } from 'botid/server';
import { DEPLOYED } from '@/lib/botid';

/*
 * Step 1 of submitReservation (spec §10.2): Vercel BotID.
 *
 * In the browser, instrumentation-client.ts makes BotID's script answer a
 * challenge and attach the answer (x-is-human) to the Server Action's POST.
 * Here, checkBotId sends that answer and the deployment's OIDC token to
 * Vercel and gets a verdict back. Both halves exist only on a Vercel
 * deployment, so off Vercel (local, CI, E2E under `next start`) there is
 * nobody to ask and every caller counts as human. BOTID_DEV_BYPASS=BAD-BOT
 * turns that into "every caller is a bot", through BotID's own development
 * bypass (developmentOptions), which is how tests walk the blocked path in a
 * real server. A deployment ignores the variable.
 *
 * The two halves must agree. A request without x-is-human gets a bot verdict
 * from Vercel, so the server asks BotID only when the browser was given it:
 * when the build inlined NEXT_PUBLIC_VERCEL_ENV as a deployment, which is
 * what instrumentation-client.ts decides by, as well as VERCEL_ENV saying so
 * at runtime.
 */

export type BotCheck = typeof checkBotId;
type Verdict = Awaited<ReturnType<BotCheck>>;

/**
 * How long a booking waits for BotID's verdict. checkBotId's fetch to Vercel has no deadline of
 * its own (botid 1.5.11), so a slow or hanging BotID API would otherwise hold every guest's submit
 * until the function's maxDuration.
 */
export const BOTID_TIMEOUT_MS = 3_000;

/**
 * What isBotRequest decides by, read at each call. NEXT_PUBLIC_VERCEL_ENV is written out in full
 * on purpose: `next build` replaces that exact expression with its build-time value in server
 * code just as in the browser bundle (node_modules/next/dist/build/define-env.js gives the client,
 * nodejs and edge builds the same values), so this is the value instrumentation-client.ts saw. Next
 * inlines a NEXT_PUBLIC_* variable from the environment only when it exists at build time
 * (node_modules/next/dist/docs/01-app/02-guides/environment-variables.md:164), so next.config.ts
 * also sets it under `env`, which is always inlined, as '' when the build had none: a build
 * without it can never leave this half reading the runtime value while browsers have no BotID.
 * scripts/check-prerender.mjs fails a build where the expression survived. A lookup through a
 * variable is not inlined (same guide, :182-191) and would read the runtime environment instead.
 */
const processEnv = (): Record<string, string | undefined> => ({
  VERCEL_ENV: process.env.VERCEL_ENV,
  NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
  BOTID_DEV_BYPASS: process.env.BOTID_DEV_BYPASS,
});

const HALF_SET_UP =
  '[botid] off, bookings let through unchecked: this deployment was built without NEXT_PUBLIC_VERCEL_ENV, so browsers were never given BotID. Turn on "Automatically expose System Environment Variables" in the Vercel project settings, then redeploy.';

/** Once per server instance: the cause is the deployment's settings, not any one request. */
let warnedHalfSetUp = false;

/**
 * A bot, verified or not. BotID's own GOOD-BOT bypass marks a verified bot
 * `isBot: false, isVerifiedBot: true`, so either flag refuses.
 */
const refused = (verdict: Verdict): boolean => verdict.isBot === true || verdict.isVerifiedBot === true;

/**
 * True when the request should be refused as a bot. A verified bot (a search
 * crawler, an AI agent acting for someone) is refused too: booking is for
 * people, and the refusal gives the phone number (error.bot_blocked).
 *
 * Fails open: when BotID cannot answer (Vercel's API down, OIDC switched off
 * in the project), answers without a verdict, or has not answered within
 * BOTID_TIMEOUT_MS, the booking goes ahead and the failure is logged. The
 * honeypot, consent and the per-phone limit still stand, and a guest who
 * cannot book costs more than a bot that gets through for a while.
 */
export async function isBotRequest(
  env: Record<string, string | undefined> = processEnv(),
  check: BotCheck = checkBotId,
): Promise<boolean> {
  if (!DEPLOYED.has(env.VERCEL_ENV ?? '')) {
    if (env.BOTID_DEV_BYPASS !== 'BAD-BOT') return false;
    return refused(await check({ developmentOptions: { isDevelopment: true, bypass: 'BAD-BOT' } }));
  }
  if (!DEPLOYED.has(env.NEXT_PUBLIC_VERCEL_ENV ?? '')) {
    // Deployed, but the browser half was never installed: no request carries x-is-human.
    if (!warnedHalfSetUp) {
      warnedHalfSetUp = true;
      console.warn(HALF_SET_UP);
    }
    return false;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const verdict = await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Object.assign(new Error(`no verdict within ${BOTID_TIMEOUT_MS} ms`), { name: 'TimeoutError' })),
          BOTID_TIMEOUT_MS,
        );
      }),
    ]);
    // checkBotId parses the API's reply without looking at its status, so a JSON error (an expired
    // OIDC token, BotID off for the project, a rate limit) comes back as a "verdict" with no isBot.
    if (typeof verdict?.isBot !== 'boolean') {
      throw Object.assign(new Error('no verdict in the BotID response'), { name: 'BotIdError' });
    }
    return refused(verdict);
  } catch (err) {
    // BotID's own messages name configuration, never the guest.
    console.error('[botid] check failed, request let through', {
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : undefined,
    });
    return false;
  } finally {
    clearTimeout(timer);
  }
}
