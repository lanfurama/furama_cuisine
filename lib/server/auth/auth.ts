import 'server-only';
import { after } from 'next/server';
import { getPool } from '@/db/client';
import { sendPasswordReset, sendStaffInvitation } from '@/lib/server/email/auth-emails';
import { createAuth, type Auth } from './config';
import type { StaffDeps } from './staff';

/*
 * The app's Better Auth instance. Built on first use, never at import time:
 * `next build` loads route modules while collecting page data and runs admin
 * pages up to their first request-time call, and getPool() throws without
 * DATABASE_URL. So the build needs no BETTER_AUTH_* variable.
 */
let instance: Auth | undefined;

export function getAuth(): Auth {
  instance ??= createAuth({
    pool: getPool(),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    // The bootstrap exception lives in scripts/create-admin.mjs only: the app
    // never admits an email without an invitation, whatever the environment holds.
    bootstrapAdminEmail: undefined,
    sendResetPassword: (email) => sendPasswordReset(email),
    // The reset email runs after the response, so its timing says nothing about
    // whether the address has an account. after() keeps a Vercel function alive
    // until it settles (next/dist/docs/01-app/03-api-reference/04-functions/after.md:250).
    backgroundTask: (task) => after(task),
  });
  return instance;
}

/** What lib/server/auth/staff.ts needs at run time: the pool, Better Auth and the invitation email. */
export function staffDeps(): StaffDeps {
  return { pool: getPool(), auth: getAuth(), sendInvite: (email) => sendStaffInvitation(email) };
}
