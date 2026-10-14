/*
 * Which way the AI runs (R9-1), read from the environment at request time.
 * Pure (no server-only) so a plain test can call it. `fake` is the stand-in
 * model for dev, CI and E2E and is refused on Production; the express-mode key
 * is refused everywhere, because with it the Vertex provider silently leaves
 * the keyless path (spike gotcha 4).
 */
export const GCP_ENV = [
  'GCP_PROJECT_ID',
  'GCP_PROJECT_NUMBER',
  'GCP_SERVICE_ACCOUNT_EMAIL',
  'GCP_WORKLOAD_IDENTITY_POOL_ID',
  'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID',
] as const;

export type AiMode = { mode: 'vertex' | 'fake' } | { mode: 'off'; missing: string[] };
type Env = Record<string, string | undefined>;

const has = (env: Env, name: string) => Boolean(env[name]?.trim());

/** Every Workload Identity id is set: the one test for "keyless", used by the mode and by the client. */
export const wifComplete = (env: Env): boolean => GCP_ENV.every((n) => has(env, n));

export function resolveAiMode(env: Env = process.env): AiMode {
  if (env.GOOGLE_VERTEX_API_KEY !== undefined) {
    throw new Error('GOOGLE_VERTEX_API_KEY must not be set: it switches the Vertex provider to express mode (keyless WIF is the only way in).');
  }
  const provider = env.AI_PROVIDER?.trim();
  if (provider && provider !== 'vertex' && provider !== 'fake') throw new Error(`AI_PROVIDER must be "vertex" or "fake", got "${provider}".`);
  if (provider === 'fake') {
    if (env.VERCEL_ENV === 'production') throw new Error('AI_PROVIDER=fake is refused on Production.');
    return { mode: 'fake' };
  }
  if (wifComplete(env)) return { mode: 'vertex' };
  if (has(env, 'GCP_PROJECT_ID') && has(env, 'GCP_SERVICE_ACCOUNT_KEY')) return { mode: 'vertex' };
  return { mode: 'off', missing: GCP_ENV.filter((n) => !has(env, n)) };
}

/** Each variable the AI needs and whether it is set: never a value. */
export function envStatus(env: Env = process.env): { name: string; present: boolean }[] {
  return [...GCP_ENV, 'GCP_SERVICE_ACCOUNT_KEY'].map((name) => ({ name, present: has(env, name) }));
}
