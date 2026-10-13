import 'server-only';
import type { Pool, PoolClient } from 'pg';
import type { AiFeature, AiSettings } from '@/lib/admin/ai-schemas';
import { withTransaction } from '@/lib/server/audit';
import { AiError, vertexErrorCode } from './errors';
import { priceUsd, type ModelId, type Region } from './models';

export { AiError, type AiErrorCode } from './errors';

/*
 * The one guard in front of Vertex (R9-3, R9-4). Reserve: in one transaction,
 * under advisory locks, check the budget (every call) and the person's limits
 * (calls a person pressed), then insert a 'pending' row at the cost ceiling.
 * Settle: after the call, the row takes the real cost. Two calls at once
 * therefore cannot both pass on the last of a limit or of the budget. A row left
 * pending (the function died) keeps its ceiling: the estimate errs high.
 * Nothing here holds guest data; the row has none.
 */
export type AiCallMeta = {
  feature: AiFeature | 'check';
  model: ModelId;
  region: Region;
  /** NULL: not counted per person (bulk job, automatic alt, connection check). */
  actorId: string | null;
  jobId?: string;
  /** Characters sent (for the ceiling); output ceiling is maxOutputTokens. */
  inputChars: number;
  maxOutputTokens: number;
  signal?: AbortSignal;
};

export type AiUsage = { inputTokens?: number; outputTokens?: number };

/** Tokens for the system prompt, glossary and JSON frame on top of the text (R9-4 ceiling). */
const OVERHEAD_TOKENS = 500;
const VN_DAY = `date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'`;
const VN_MONTH = `date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'`;

export function ceilingUsd(meta: AiCallMeta): number {
  return priceUsd(meta.model, meta.region, Math.ceil(meta.inputChars / 3) + OVERHEAD_TOKENS, meta.maxOutputTokens);
}

async function reserve(pool: Pool, settings: AiSettings, meta: AiCallMeta): Promise<string> {
  const ceiling = ceilingUsd(meta);
  return withTransaction(pool, async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('ai:budget'))`);
    if (meta.actorId) {
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('ai:' || $1::text))`, [meta.actorId]);
      const { rows } = await c.query<{ minute: number; day: number }>(
        `SELECT count(*) FILTER (WHERE at > now() - interval '60 seconds')::int AS minute,
                count(*) FILTER (WHERE at >= ${VN_DAY})::int AS day
           FROM ai_usage WHERE actor_id = $1 AND feature <> 'check' AND at >= least(${VN_DAY}, now() - interval '60 seconds')`,
        [meta.actorId],
      );
      if (rows[0].minute >= settings.limits.perMinute) throw new AiError('ai_rate_minute', { limit: settings.limits.perMinute });
      if (rows[0].day >= settings.limits.perDay) throw new AiError('ai_rate_day', { limit: settings.limits.perDay });
    }
    const { rows: m } = await c.query<{ spent: string }>(`SELECT coalesce(sum(cost_usd), 0) AS spent FROM ai_usage WHERE at >= ${VN_MONTH}`);
    if (Number(m[0].spent) + ceiling > settings.budgetUsd) throw new AiError('ai_budget', { budget: settings.budgetUsd });
    const { rows: r } = await c.query<{ id: string }>(
      `INSERT INTO ai_usage (actor_id, feature, model, region, cost_usd, status, job_id) VALUES ($1, $2, $3, $4, $5, 'pending', $6) RETURNING id::text`,
      [meta.actorId, meta.feature, meta.model, meta.region, ceiling, meta.jobId ?? null],
    );
    return r[0].id;
  });
}

export type AiReservation = {
  /** The call went through: record the real tokens and cost. */
  settle(usage: AiUsage): Promise<void>;
  /** The call failed: record the error (tokens already spent, if known, are charged) and get the AiError to throw. */
  fail(err: unknown, usage?: AiUsage): Promise<AiError>;
};

/** Throws AiError ai_rate_minute / ai_rate_day / ai_budget. Streaming callers settle in onFinish and fail in onError. */
export async function reserveAiCall(pool: Pool, settings: AiSettings, meta: AiCallMeta): Promise<AiReservation> {
  const id = await reserve(pool, settings, meta);
  const cost = (u: AiUsage) => priceUsd(meta.model, meta.region, u.inputTokens ?? 0, u.outputTokens ?? 0);
  return {
    async settle(usage) {
      await pool.query(`UPDATE ai_usage SET status = 'ok', input_tokens = $2, output_tokens = $3, cost_usd = $4 WHERE id = $1`, [
        id,
        usage.inputTokens ?? 0,
        usage.outputTokens ?? 0,
        cost(usage),
      ]);
    },
    async fail(err, usage = {}) {
      const code = vertexErrorCode(err);
      // A failed UPDATE leaves the row pending at its ceiling, which errs high.
      await pool
        .query(`UPDATE ai_usage SET status = 'error', error_code = $2, input_tokens = $3, output_tokens = $4, cost_usd = $5 WHERE id = $1`, [
          id,
          code,
          usage.inputTokens ?? 0,
          usage.outputTokens ?? 0,
          cost(usage),
        ])
        .catch(() => {});
      return err instanceof AiError ? err : new AiError(code);
    },
  };
}

/** Reserve → call → settle. `fn` receives the signal and returns its result and usage. */
export async function runAiCall<T>(
  pool: Pool,
  settings: AiSettings,
  meta: AiCallMeta,
  fn: (signal: AbortSignal | undefined) => Promise<{ value: T; usage: AiUsage }>,
): Promise<T> {
  if (meta.signal?.aborted) throw new AiError('ai_failed');
  const reservation = await reserveAiCall(pool, settings, meta);
  let result: { value: T; usage: AiUsage };
  try {
    result = await fn(meta.signal);
  } catch (err) {
    throw await reservation.fail(err);
  }
  // The answer is in hand; a failed ledger write leaves the ceiling pending and does not lose it.
  await reservation.settle(result.usage).catch(() => {});
  return result.value;
}

/** This Vietnam calendar month's spend, pending rows at their ceiling, in total and by feature. */
export async function monthSpendUsd(db: Pool | PoolClient): Promise<{ spent: number; byFeature: Record<string, number> }> {
  const { rows } = await db.query<{ feature: string; spent: string }>(
    `SELECT feature, sum(cost_usd) AS spent FROM ai_usage WHERE at >= ${VN_MONTH} GROUP BY feature HAVING sum(cost_usd) > 0`,
  );
  const byFeature: Record<string, number> = {};
  let spent = 0;
  for (const r of rows) {
    byFeature[r.feature] = Number(r.spent);
    spent += Number(r.spent);
  }
  return { spent, byFeature };
}
