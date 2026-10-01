import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from '@/lib/admin/zod';
import { actionError } from './action-result';
import { PermissionError } from './dal/session';

afterEach(() => {
  vi.restoreAllMocks();
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
