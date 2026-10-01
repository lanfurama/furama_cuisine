'use server';

import { authErrorMessage } from '@/lib/admin/auth-errors';
import { z } from '@/lib/admin/zod';
import { callAuthEndpoint } from '@/lib/server/auth/endpoint';

/*
 * Both steps are public actions (on the CI guard's allowlist) that go through
 * Better Auth's HTTP router (lib/server/auth/endpoint.ts), so its rate limit
 * applies: 3 requests per 60 s per IP on /request-password-reset. The email
 * itself is sent by config.ts's sendResetPassword after the answer (after(),
 * lib/server/auth/auth.ts), so a staff address answers as fast as any other.
 */

export type RequestResetState = { email: string; sent?: true; message?: string; fieldErrors?: { email?: string[] } } | null;
export type ResetState = { done?: true; message?: string; fieldErrors?: { password?: string[] } } | null;

const retryAfter = (res: Response) => Number(res.headers.get('x-retry-after')) || null;

export async function requestPasswordReset(_prev: RequestResetState, formData: FormData): Promise<RequestResetState> {
  const email = String(formData.get('email') ?? '').trim();
  const parsed = z
    .object({ email: z.email({ error: 'Nhập email công việc, ví dụ ten@furamavietnam.com.' }) })
    .safeParse({ email });
  if (!parsed.success) return { email, fieldErrors: z.flattenError(parsed.error).fieldErrors };

  let res: Response;
  try {
    res = await callAuthEndpoint('/request-password-reset', { email: parsed.data.email });
  } catch (error) {
    console.error('[admin] reset request failed', { name: error instanceof Error ? error.name : typeof error });
    return { email, message: 'Không gửi được yêu cầu. Vui lòng thử lại sau ít phút.' };
  }
  if (res.status === 429) return { email, message: authErrorMessage(429, null, retryAfter(res)) };
  if (!res.ok) return { email, message: 'Không gửi được yêu cầu. Vui lòng thử lại sau ít phút.' };
  // Better Auth answers 200 whether or not the address has an account, and so do we.
  return { email, sent: true };
}

export async function resetPassword(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const parsed = z
    .object({
      token: z.string().min(1),
      password: z
        .string()
        .min(12, { error: 'Mật khẩu cần ít nhất 12 ký tự.' })
        .max(128, { error: 'Mật khẩu tối đa 128 ký tự.' }),
    })
    .safeParse({ token: formData.get('token'), password: formData.get('password') });
  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error);
    return fieldErrors.password ? { fieldErrors: { password: fieldErrors.password } } : { message: authErrorMessage(400, 'INVALID_TOKEN') };
  }

  let res: Response;
  try {
    res = await callAuthEndpoint('/reset-password', { token: parsed.data.token, newPassword: parsed.data.password });
  } catch (error) {
    console.error('[admin] password reset failed', { name: error instanceof Error ? error.name : typeof error });
    return { message: 'Không đổi được mật khẩu. Vui lòng thử lại sau ít phút.' };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    return { message: authErrorMessage(res.status, body?.code, retryAfter(res), 'Không đổi được mật khẩu. Vui lòng thử lại sau ít phút.') };
  }
  // Better Auth also ended every session of this account (revokeSessionsOnPasswordReset).
  return { done: true };
}
