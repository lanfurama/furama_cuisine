'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_HOME } from '@/lib/admin/paths';
import { z } from '@/lib/admin/zod';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { getAuth, staffDeps } from '@/lib/server/auth/auth';
import { acceptInvitation as accept } from '@/lib/server/auth/staff';

const AcceptInput = z.object({
  token: z.string(),
  name: z.string().trim().min(1, { error: 'Nhập họ tên.' }).max(100, { error: 'Họ tên tối đa 100 ký tự.' }),
  // admin createUser checks only the maximum; the minimum is ours (spec §7.1: 12–128).
  password: z
    .string()
    .min(12, { error: 'Mật khẩu cần ít nhất 12 ký tự.' })
    .max(128, { error: 'Mật khẩu tối đa 128 ký tự.' }),
});

/*
 * Public action (no session yet; on the CI guard's allowlist): the 256-bit,
 * single-use invitation token is the credential, and accept() checks it
 * again. Not rate-limited: guessing a token is hopeless.
 */
export async function acceptInvitation(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await createAccount(formData);
  // Outside any try: redirect() throws. Setting the cookie re-renders this page, where
  // the now-used invitation would show as invalid, so the action leaves it itself.
  if (result.ok) redirect(ADMIN_HOME);
  return result;
}

async function createAccount(formData: FormData): Promise<ActionResult> {
  try {
    const input = AcceptInput.parse({
      token: formData.get('token'),
      name: formData.get('name'),
      password: formData.get('password'),
    });
    const requestHeaders = await headers();
    const ip = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
    const result = await accept(staffDeps(), input, ip);
    if (!result.ok) return result;
    // The one auth.api sign-in in the app: the account was created a moment ago
    // with this password. nextCookies() puts the session cookie on this response.
    await getAuth().api.signInEmail({
      body: { email: result.email, password: input.password, rememberMe: true },
      headers: requestHeaders,
    });
    return { ok: true, data: null };
  } catch (err) {
    return actionError(err);
  }
}
