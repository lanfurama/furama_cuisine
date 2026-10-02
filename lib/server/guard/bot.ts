import 'server-only';
import { checkBotId } from 'botid/server';

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
 */

/** VERCEL_ENV of a Vercel deployment. `vercel dev` and `vercel env pull` say 'development': not one. */
const DEPLOYED = new Set(['production', 'preview']);

export type BotCheck = typeof checkBotId;

/**
 * How long a booking waits for BotID's verdict. checkBotId's fetch to Vercel has no deadline of
 * its own (botid 1.5.11), so a slow or hanging BotID API would otherwise hold every guest's submit
 * until the function's maxDuration.
 */
export const BOTID_TIMEOUT_MS = 3_000;

/**
 * True when the request should be refused as a bot. A verified bot (a search
 * crawler, an AI agent acting for someone) is refused too: booking is for
 * people, and the refusal gives the phone number (error.bot_blocked).
 *
 * Fails open: when BotID cannot answer (Vercel's API down, OIDC switched off
 * in the project) or has not answered within BOTID_TIMEOUT_MS, the booking
 * goes ahead and the failure is logged. The honeypot, consent and the
 * per-phone limit still stand, and a guest who cannot book costs more than a
 * bot that gets through for a while.
 */
export async function isBotRequest(
  env: Record<string, string | undefined> = process.env,
  check: BotCheck = checkBotId,
): Promise<boolean> {
  if (!DEPLOYED.has(env.VERCEL_ENV ?? '')) {
    if (env.BOTID_DEV_BYPASS !== 'BAD-BOT') return false;
    const verdict = await check({ developmentOptions: { isDevelopment: true, bypass: 'BAD-BOT' } });
    return verdict.isBot;
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
    return verdict.isBot;
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
