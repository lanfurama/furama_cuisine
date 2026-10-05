// Points this Node process's fetch at the fake Blob server (test/helpers/fake-blob.ts),
// and refuses every other request that would leave the machine.
//
// Tests only. Two ways in:
//   - `NODE_OPTIONS=--import=<file URL of this file> FAKE_BLOB_ORIGIN=http://127.0.0.1:<port> next start`
//     (the E2E server, as playwright.config.ts starts it: no line of app code knows about the fake);
//   - `installBlobRedirect(origin)` from a Vitest file.
//
// Why a dispatcher and not only VERCEL_BLOB_API_URL: that variable moves the SDK's
// control-plane calls (put, head, list, del, signed-token), but a file's bytes are read
// from https://<store>.public.blob.vercel-storage.com, which nothing overrides. Node's
// fetch and the SDK's undici share one global dispatcher (Symbol.for('undici.globalDispatcher.1')),
// so both are caught here, before any DNS lookup.
import dns from 'node:dns';
import { Agent, setGlobalDispatcher } from 'undici';

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Every request this process tried to send elsewhere (and was refused). */
export const refused = [];

export function installBlobRedirect(fakeOrigin, { blockExternal = true } = {}) {
  const fake = new URL(fakeOrigin);
  const redirect = (dispatch) => (opts, handler) => {
    const target = new URL(opts.origin);
    if (target.hostname.endsWith('.public.blob.vercel-storage.com')) {
      return dispatch({ ...opts, origin: fake.origin, path: `/cdn${opts.path}` }, handler);
    }
    if (target.hostname === 'vercel.com' && opts.path.startsWith('/api/blob')) {
      return dispatch({ ...opts, origin: fake.origin }, handler);
    }
    if (blockExternal && !LOCAL.has(target.hostname)) {
      refused.push(`${opts.method} ${target.origin}${opts.path}`);
      console.error(`[blob-redirect] refused an external request: ${opts.method} ${target.origin}${opts.path}`);
      handler.onError(new Error(`blocked external request to ${target.origin}`));
      return true;
    }
    return dispatch(opts, handler);
  };
  setGlobalDispatcher(new Agent().compose(redirect));

  // next/image looks the host up before it fetches a remote image, to refuse private addresses
  // (node_modules/next/dist/server/image-optimizer.js fetchExternalImage). Answer that lookup here, for the
  // fake's hosts only, so no DNS query leaves the machine: a failed lookup is what Next tolerates
  // (it falls back to the hostname, which is not an IP, so not private) before the fetch above reroutes.
  const fakeHost = (hostname) => hostname.endsWith('.blob.vercel-storage.com') || hostname === 'vercel.com';
  const notFound = (hostname) => Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND', hostname });
  const lookup = dns.promises.lookup;
  dns.promises.lookup = (hostname, ...rest) => (fakeHost(hostname) ? Promise.reject(notFound(hostname)) : lookup.call(dns.promises, hostname, ...rest));
  const lookupCb = dns.lookup;
  dns.lookup = (hostname, ...rest) => {
    if (!fakeHost(hostname)) return lookupCb.call(dns, hostname, ...rest);
    const callback = rest[rest.length - 1];
    process.nextTick(() => callback(notFound(hostname)));
    return undefined;
  };
}

if (process.env.FAKE_BLOB_ORIGIN) {
  installBlobRedirect(process.env.FAKE_BLOB_ORIGIN);
  console.info(`[blob-redirect] Vercel Blob → ${process.env.FAKE_BLOB_ORIGIN}; other external hosts refused`);
}
