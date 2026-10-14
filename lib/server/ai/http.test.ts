import { APICallError } from 'ai';
import { describe, expect, it } from 'vitest';
import { z } from '@/lib/admin/zod';
import { PermissionError } from '@/lib/server/dal/session';
import { AiError, type AiErrorCode } from '@/lib/server/ai-error';
import { aiErrorResponse } from './http';

describe('aiErrorResponse', () => {
  it.each<[AiErrorCode, number]>([
    ['ai_rate_minute', 429],
    ['ai_rate_day', 429],
    ['ai_budget', 402],
    ['ai_off', 409],
    ['ai_preview', 409],
    ['ai_placeholder', 422],
    ['ai_auth', 502],
    ['ai_not_found', 502],
    ['ai_quota', 502],
    ['ai_bad_request', 502],
    ['ai_failed', 502],
  ])('%s is %i, uncached, with a code and a message', async (code, status) => {
    const res = aiErrorResponse(new AiError(code));
    expect(res.status).toBe(status);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ code, message: expect.any(String) });
  });

  it('reads the configured limit into the message', async () => {
    const res = aiErrorResponse(new AiError('ai_rate_minute', { limit: 7 }));
    expect((await res.json()).message).toContain('7 lần');
  });

  it('maps permission to 403, bad input to 400, and a raw Vertex error to its code', async () => {
    expect(aiErrorResponse(new PermissionError('forbidden')).status).toBe(403);
    const bad = z.object({ a: z.string() }).safeParse({});
    const invalid = aiErrorResponse(bad.error);
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).code).toBe('invalid');
    const quota = aiErrorResponse(new APICallError({ message: 'x', url: 'u', requestBodyValues: {}, statusCode: 429 }));
    expect(quota.status).toBe(502);
    expect((await quota.json()).code).toBe('ai_quota');
  });
});
