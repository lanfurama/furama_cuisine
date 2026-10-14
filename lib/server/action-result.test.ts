import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from '@/lib/admin/zod';
import { actionError, PermissionError } from './action-result';
import { AiError } from './ai-error';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('actionError', () => {
  it('answers forbidden for a missing session and for a missing permission alike', () => {
    expect(actionError(new PermissionError('unauthenticated'))).toEqual({ ok: false, code: 'forbidden' });
    expect(actionError(new PermissionError('forbidden'))).toEqual({ ok: false, code: 'forbidden' });
  });

  it('turns a ZodError into invalid, with zod’s messages in Vietnamese', () => {
    const parsed = z.object({ email: z.email(), role: z.enum(['admin', 'editor']) }).safeParse({ email: 'x', role: 'owner' });
    const result = actionError(parsed.error);
    expect(result.code).toBe('invalid');
    expect(result.fieldErrors?.email).toEqual(['địa chỉ email không hợp lệ']);
    expect(result.fieldErrors?.role?.[0]).toMatch(/^Tùy chọn không hợp lệ/);
  });

  it('logs anything else by name only and answers db_error', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(actionError(new TypeError('secret detail owner@furama.test'))).toEqual({ ok: false, code: 'db_error' });
    expect(logged).toHaveBeenCalledWith('[admin] action failed', { code: 'db_error', name: 'TypeError' });
    expect(JSON.stringify(logged.mock.calls)).not.toContain('secret');
  });
});

describe('actionError and Next’s control flow (unstable_rethrow)', () => {
  it('rethrows redirect(), notFound() and forbidden() instead of turning them into db_error', async () => {
    const { forbidden, notFound, redirect } = await import('next/navigation');
    // next.config.ts sets experimental.authInterrupts, which Next exposes to forbidden() as this variable.
    vi.stubEnv('__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS', '1');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const interrupt of [() => redirect('/admin/reservations/1'), () => notFound(), () => forbidden()]) {
      let thrown: unknown;
      try {
        interrupt();
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeDefined();
      expect(() => actionError(thrown)).toThrow(thrown as Error);
    }
    expect(logged).not.toHaveBeenCalled();
  });
});

describe('actionError and AiError', () => {
  it('keeps the code and turns numeric params into strings', () => {
    expect(actionError(new AiError('ai_rate_minute', { limit: 10 }))).toEqual({ ok: false, code: 'ai_rate_minute', params: { limit: '10' } });
    expect(actionError(new AiError('ai_quota'))).toEqual({ ok: false, code: 'ai_quota' });
  });
});
