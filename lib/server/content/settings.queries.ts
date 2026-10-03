import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { getPool } from '@/db/client';
import { US } from '@/lib/server/booking/config';

/** The one row of site_settings (migrations 007, 008). */
export type SiteSettingsRow = {
  /** The shared inbox: the footer's and the privacy page's address, staff.new's fallback, a guest's Reply-To. */
  email: string;
  defaultRestaurantId: string | null;
  defaultOccasion: string | null;
  heroAutoplayMs: number;
  ogImageId: string | null;
  /** updated_at as text: the optimistic-concurrency token of the admin form. */
  token: string;
};

/**
 * The shared reader of site_settings (phase-5 deferral T6.8). The cached
 * guest loader (getSiteSettings, lib/server/content/site.ts), the
 * notifications screen (getSharedInbox, lib/server/email/recipients.ts) and
 * the guest email's Reply-To (sharedInbox, lib/server/email/booking/render.ts)
 * call this. It is not the only one: three statements read the table in their
 * own SQL, so a cache or column change must look at them too. queueStaffNew
 * (lib/server/email/outbox.ts) queues staff.new to site_settings.email when no
 * recipient matches; the sender's recheck of that row, recipientStillWanted
 * (lib/server/email/drain.ts), compares it with site_settings.email again; and
 * saveSharedInbox (recipients.ts) locks the row and reads its email and
 * updated_at before it writes. `db` lets the sender read on its own pool or
 * client (after() and the cron run outside any Next cache scope). Uncached.
 */
export async function loadSiteSettings(db: Pool | PoolClient = getPool()): Promise<SiteSettingsRow | null> {
  const { rows } = await db.query<SiteSettingsRow>(
    `SELECT email,
            default_restaurant_id AS "defaultRestaurantId",
            default_occasion      AS "defaultOccasion",
            hero_autoplay_ms      AS "heroAutoplayMs",
            og_image_id           AS "ogImageId",
            ${US('updated_at')}   AS token
       FROM site_settings WHERE id`,
  );
  return rows[0] ?? null;
}
