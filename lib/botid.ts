/*
 * Vercel BotID, browser half (spec §10.2 step 1). instrumentation-client.ts
 * calls initBotId with this list before hydration; BotID then wraps
 * window.fetch, and every same-origin request matching an entry waits for a
 * challenge answer and carries it as x-is-human. submitReservation's
 * checkBotId (lib/server/guard/bot.ts) sends that answer to Vercel.
 *
 * A Server Action is not a route of its own: the browser POSTs it to the URL
 * of the page it runs on (proxy.md:249), and Next's action client calls the
 * global fetch at that moment (next/dist/client/components/segment-cache/
 * fetch.js:28), so the wrapper sees it. The drawer opens on every guest page
 * in every language, so the entry is every POST; the guest site sends no
 * other POST. Admin pages never install BotID (botIdEnabled), so their
 * actions are untouched.
 */
export const BOTID_PROTECT = [{ path: '/*', method: 'POST' }];

/**
 * VERCEL_ENV of a Vercel deployment, and NEXT_PUBLIC_VERCEL_ENV, its copy that `next build` inlines.
 * `vercel dev` and `vercel env pull` say 'development': not one. The one definition: the server half
 * (lib/server/guard/bot.ts) and the email gate (lib/server/email/send.ts, auth-emails.ts) decide by it.
 */
export const DEPLOYED: ReadonlySet<string> = new Set(['production', 'preview']);

/**
 * Only a Vercel deployment can answer BotID's challenge (its script is a
 * rewrite to Vercel added by withBotId in next.config.ts), and only guest
 * pages book. Off Vercel the wrapper would wait on a script that never loads
 * and the booking would fail, so local, CI and E2E runs leave fetch alone.
 */
export function botIdEnabled(vercelEnv: string | undefined, pathname: string): boolean {
  return DEPLOYED.has(vercelEnv ?? '') && pathname !== '/admin' && !pathname.startsWith('/admin/');
}

/**
 * How long a protected request may wait for BotID's challenge (its script, and
 * the answer the script gives) before it fails: then the guest sees the
 * restaurant's number (error.network) instead of a button stuck on SENDING….
 */
export const BOTID_CHALLENGE_TIMEOUT_MS = 15_000;

/** BotID's challenge failed or did not answer in time, so the request was never sent. */
export class BotIdUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('BotID’s challenge did not answer; the request was not sent', options);
    this.name = 'BotIdUnavailableError';
  }
}

/** A same-origin POST: every request BOTID_PROTECT makes BotID hold for its challenge. */
function sameOriginPost(input: RequestInfo | URL, init: RequestInit | undefined, win: Window): boolean {
  const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
  if ((init?.method ?? request?.method ?? 'GET').toUpperCase() !== 'POST') return false;
  return new URL(request ? request.url : String(input), win.location.href).origin === win.location.origin;
}

/**
 * Installs BotID (`init` calls initBotId) with a deadline on its challenge step
 * only. botid 1.5.11 loads its challenge script on the first protected request,
 * with no deadline: a script that stalls holds the request for ever, and one
 * that fails stays in <head>, so every later request waits on an answer it can
 * never get. Only a window `online` or `visibilitychange` event resets BotID.
 *
 * So each same-origin POST gets an AbortSignal of ours and `ms` to get past the
 * challenge. BotID passes the signal on to the fetch it captured when it
 * installed, which is a shim of ours: the shim seeing the signal means the
 * challenge is over and the request is on the network, and from then on it is
 * never cut (the server may already be booking). Before that, a timeout or a
 * failed script rejects the request with BotIdUnavailableError and fires
 * `online`, so BotID drops the dead script and the guest's next tap starts a
 * fresh challenge; a request whose signal was aborted is never sent late.
 */
export function installBotIdWithDeadline(
  init: () => void,
  win: Window = window,
  ms: number = BOTID_CHALLENGE_TIMEOUT_MS,
): void {
  const raw = win.fetch.bind(win);
  /** Signals BotID has handed to the network: their challenge is over. */
  const handedOff = new WeakSet<AbortSignal>();
  /** Signals of the requests under a deadline of ours. */
  const ours = new WeakSet<AbortSignal>();

  // BotID captures window.fetch as it is now, and calls it once a request's challenge is answered.
  win.fetch = (input, options) => {
    const signal = options?.signal;
    if (signal) {
      // Its deadline passed while BotID waited for the script: never send it late.
      if (signal.aborted) return Promise.reject(signal.reason);
      handedOff.add(signal);
    }
    return raw(input, options);
  };
  init();
  const botFetch = win.fetch;

  win.fetch = (input, options) => {
    const own = options?.signal ?? undefined;
    // Not something BotID holds (BOTID_PROTECT is every POST), or BotID's own second call for a
    // request already under our deadline (Deep Analysis calls window.fetch again with our signal).
    if (!sameOriginPost(input, options, win) || (own && ours.has(own))) return botFetch(input, options);
    const caller = own ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);
    if (caller?.aborted) return Promise.reject(caller.reason);

    const controller = new AbortController();
    const { signal } = controller;
    ours.add(signal);
    return new Promise<Response>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const settle = (done: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        caller?.removeEventListener('abort', onCallerAbort);
        done();
      };
      // BotID's own reset: a new answer to wait for, and the dead script out of <head>.
      const resetBotId = () => win.dispatchEvent(new Event('online'));
      function onCallerAbort() {
        controller.abort(caller?.reason);
        if (!handedOff.has(signal)) settle(() => reject(caller?.reason));
      }
      caller?.addEventListener('abort', onCallerAbort, { once: true });
      timer = setTimeout(() => {
        if (handedOff.has(signal)) return;
        controller.abort(new BotIdUnavailableError());
        resetBotId();
        settle(() => reject(signal.reason));
      }, ms);
      // Handled on both paths, so a challenge that answers after the deadline leaves no unhandled rejection.
      botFetch(input, { ...options, signal }).then(
        (response) => settle(() => resolve(response)),
        (error: unknown) => {
          if (settled) return;
          if (handedOff.has(signal)) return settle(() => reject(error));
          resetBotId();
          settle(() => reject(new BotIdUnavailableError({ cause: error })));
        },
      );
    });
  };
}
