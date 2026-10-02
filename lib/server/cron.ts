import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when the project has
 * CRON_SECRET. Compared in constant time over SHA-256 digests (equal lengths,
 * whatever was sent); no secret, or one shorter than 16 characters,
 * authorises nothing (spec §12: a cron call without it is 401). Kept out of
 * the route file, which exports only its handler and segment config.
 */
export function cronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header ?? ''), digest(`Bearer ${secret}`));
}
