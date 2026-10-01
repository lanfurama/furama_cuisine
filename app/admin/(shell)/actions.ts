'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_SIGN_IN } from '@/lib/admin/paths';
import { getAuth } from '@/lib/server/auth/auth';

/* Public action (on the CI guard's allowlist): it ends only the session whose cookie it carries, if any. */
export async function signOut(): Promise<void> {
  try {
    await getAuth().api.signOut({ headers: await headers() }); // nextCookies() clears the cookies
  } catch {
    // No session, or it already expired: nothing to end.
  }
  redirect(ADMIN_SIGN_IN);
}
