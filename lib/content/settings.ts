import type { SiteSettings } from './types';

/**
 * site_settings as a guest page may carry it (SEC-6, L7-2): the booking
 * screen accepts any restaurant that is not archived as the default (plan 7B
 * risk 16), a hidden draft or one at a hidden destination included, but a
 * restaurant guests cannot see never reaches their payload. Such a default
 * becomes null, which SiteProvider already reads as "the first bookable one".
 * The keys keep their order, so the seeded pages' payload stays byte-identical.
 */
export function guestSettings(settings: SiteSettings, catalogue: readonly { id: string }[]): SiteSettings {
  const id = settings.defaultRestaurantId;
  return { ...settings, defaultRestaurantId: id !== null && catalogue.some((r) => r.id === id) ? id : null };
}
