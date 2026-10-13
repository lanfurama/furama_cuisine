import { APICallError, NoObjectGeneratedError, RetryError } from 'ai';
import { describe, expect, it } from 'vitest';
import { AiOffError } from './client';
import { AiError, vertexErrorCode } from './errors';

const api = (statusCode: number) => new APICallError({ message: 'x', url: 'u', requestBodyValues: {}, statusCode });

describe('vertexErrorCode', () => {
  it.each([
    [401, 'ai_auth'],
    [403, 'ai_auth'],
    [404, 'ai_not_found'],
    [429, 'ai_quota'],
    [400, 'ai_bad_request'],
    [500, 'ai_failed'],
  ])('maps HTTP %i to %s', (status, code) => {
    expect(vertexErrorCode(api(status))).toBe(code);
  });

  it('maps a timeout or an abort to ai_failed', () => {
    expect(vertexErrorCode(new DOMException('t', 'TimeoutError'))).toBe('ai_failed');
    expect(vertexErrorCode(new DOMException('a', 'AbortError'))).toBe('ai_failed');
  });

  it('maps an unusable answer to ai_failed', () => {
    const err = new NoObjectGeneratedError({ message: 'n', response: { id: 'i', timestamp: new Date(), modelId: 'm' }, usage: {} as never, finishReason: 'stop' });
    expect(vertexErrorCode(err)).toBe('ai_failed');
  });

  it('maps AiOffError to ai_off and keeps an AiError code', () => {
    expect(vertexErrorCode(new AiOffError(['GCP_PROJECT_ID']))).toBe('ai_off');
    expect(vertexErrorCode(new AiError('ai_budget'))).toBe('ai_budget');
  });

  it('reads the status of a Gaxios error (the WIF token exchange)', () => {
    const gaxios = Object.assign(new Error('Request failed with status code 403'), { name: 'GaxiosError', response: { status: 403 } });
    expect(vertexErrorCode(gaxios)).toBe('ai_auth');
  });

  it('unwraps a RetryError to the status of the last failure', () => {
    const retry = (status: number) => new RetryError({ message: 'r', reason: 'maxRetriesExceeded', errors: [api(status), api(status)] });
    expect(vertexErrorCode(retry(429))).toBe('ai_quota');
    expect(vertexErrorCode(retry(403))).toBe('ai_auth');
  });

  it('falls back to ai_failed for anything else', () => {
    expect(vertexErrorCode(new TypeError('x'))).toBe('ai_failed');
    expect(vertexErrorCode('boom')).toBe('ai_failed');
  });
});
