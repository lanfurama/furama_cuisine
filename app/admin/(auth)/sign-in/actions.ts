'use server';

import { redirect } from 'next/navigation';
import { authErrorMessage } from '@/lib/admin/auth-errors';
import { safeAdminNext } from '@/lib/admin/paths';
import { z } from '@/lib/admin/zod';
import { applySetCookies, callAuthEndpoint } from '@/lib/server/auth/endpoint';

export type SignInState = {
  email: string;
  message?: string;
  fieldErrors?: { email?: string[]; password?: string[] };
} | null;

const schema = z.object({
  email: z.email({ error: 'Nhập email công việc, ví dụ ten@furamavietnam.com.' }),
  password: z.string().min(1, { error: 'Nhập mật khẩu.' }),
});

/*
 * Public action (no session yet; on the CI guard's allowlist). It goes
 * through Better Auth's HTTP router (lib/server/auth/endpoint.ts), so the
 * attempt counts toward the rate limit in auth_rate_limit: 3 per 10 s per IP.
 */
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim();
  const parsed = schema.safeParse({ email, password: formData.get('password') ?? '' });
  if (!parsed.success) return { email, fieldErrors: z.flattenError(parsed.error).fieldErrors };

  let res: Response;
  try {
    // rememberMe: the 7-day session (spec §7.1), never a browser-session cookie.
    res = await callAuthEndpoint('/sign-in/email', { ...parsed.data, rememberMe: true });
  } catch (error) {
    console.error('[admin] sign-in failed', { name: error instanceof Error ? error.name : typeof error });
    return { email, message: authErrorMessage(500) };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    return { email, message: authErrorMessage(res.status, body?.code, Number(res.headers.get('x-retry-after')) || null) };
  }
  await applySetCookies(res);
  redirect(safeAdminNext(formData.get('next')));
}
