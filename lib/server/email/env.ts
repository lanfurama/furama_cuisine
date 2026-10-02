import 'server-only';

/*
 * The environment an outbox row belongs to (spec §10.4: "Cột env lấy từ
 * VERCEL_ENV; không có thì là development"). The writer stamps it, every
 * sender and every admin read filters on it, so a Preview branch forked from
 * production never sends or shows production's queue. The one helper for the
 * queue, the drain, the email log and the overview (code rule 4).
 */
export type OutboxEnv = 'production' | 'preview' | 'development';

export function outboxEnv(env: Record<string, string | undefined> = process.env): OutboxEnv {
  const value = env.VERCEL_ENV;
  return value === 'production' || value === 'preview' ? value : 'development';
}
