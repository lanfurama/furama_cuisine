import 'server-only';
import { DEPLOYED } from '@/lib/botid';
import { EmailSendError } from './types';

/**
 * The origin of every emailed link (invite, reset, and the booking link in
 * staff.new). It fails closed (R23): without BETTER_AUTH_URL a live or
 * redirected email, or any email on a Vercel deployment, would carry a
 * localhost link that works for nobody. Only log mode off Vercel (dev, tests)
 * keeps the localhost default.
 */
export function appOrigin(env: Record<string, string | undefined> = process.env): string {
  const url = env.BETTER_AUTH_URL?.trim();
  if (url) return url.replace(/\/$/, '');
  const mode = env.EMAIL_DELIVERY?.trim() || 'log';
  if (mode !== 'log' || DEPLOYED.has(env.VERCEL_ENV ?? '')) {
    throw new EmailSendError('missing_app_url', 'BETTER_AUTH_URL is required for emailed links outside log mode and on Vercel deployments');
  }
  return 'http://localhost:3000';
}
