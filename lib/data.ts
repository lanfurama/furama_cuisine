import type { Media, Phone } from '@/lib/content/types';

/*
 * Code, not content (R1). The guest site's content lives in the database since
 * phase 6 (migration 008, read through lib/server/content/*); what it was at
 * the end of phase 5 is frozen in test/fixtures/phase5-content.ts. Left here:
 * the meal enum (service_periods.meal) and its labels (phase 7 moves the text
 * to the registry), phase 1's slots (phase 10 drops them), the number the
 * error pages print without the database, and the catalogue's client shape.
 */

export type Meal = 'Breakfast' | 'Lunch' | 'Dinner' | 'Drinks';

/** One restaurant as the catalogue loader (lib/server/content/restaurants.queries.ts#loadRestaurants) hands it to the client. */
export type Restaurant = {
  id: string;
  /** URL segment of /[lang]/restaurants/[slug] (restaurants.slug). */
  slug: string;
  /** restaurants.has_detail_page: the card opens the page instead of the reservation form. */
  hasDetailPage: boolean;
  name: string;
  /** restaurant_i18n.type_label in the page's language, else the default language's. */
  type: string;
  /** Cuisine ids (slugs, via restaurant_cuisines), never labels. */
  cuisines: string[];
  /** destinations.id (restaurants.destination_id). */
  dest: string;
  /** The meals of its active service periods (spec §6.3 item 2), in MEALS order; drives the Occasion filter. */
  meals: Meal[];
  /** restaurants.booking_enabled: off hides its RESERVE entry points and drops it from the reservation form. */
  bookingEnabled: boolean;
  /** The card picture (restaurants.card_image_id; alt: a copy of the name, R19); null draws the frame alone. */
  image: Media | null;
  /** The restaurant's own number, else its destination's (spec §6.4); null when neither has one. */
  phone: Phone | null;
  /** Name, type, cuisine labels and destination name, in the page's language and the default one, fold()ed: what search matches. */
  search: string;
};

/**
 * Phase 1's slots of each meal, from before service_periods (migration 006
 * seeded the periods from them). Only test/integration/booking-seed.test.ts
 * reads them; phase 10 drops them with restaurants.slot_capacity and meals.
 */
export const SLOTS: Record<Meal, string[]> = {
  Breakfast: ['06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '09:30'],
  Lunch: ['11:30', '12:00', '12:30', '13:00', '13:30'],
  Dinner: ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00'],
  Drinks: ['17:00', '18:00', '19:00', '20:00', '21:00', '22:00'],
};

export const MEALS: Meal[] = ['Breakfast', 'Lunch', 'Dinner', 'Drinks'];

/** Display text per meal. The Meal value itself is the key (spec §5.2 service_periods.meal); phase 7 moves the text to the registry. */
export const MEAL_LABELS: Record<Meal, string> = {
  Breakfast: 'Breakfast',
  Lunch: 'Lunch',
  Dinner: 'Dinner',
  Drinks: 'Drinks',
};

/**
 * The number the error pages print, and the one a booking failure names
 * before the chosen restaurant's own has arrived (DEFAULT_PHONE). A code
 * constant on purpose, kept when the content constants went (R1): those pages
 * render when the database cannot be read (spec §12), so they cannot ask it.
 * The resort destination's number (migration 004); a test holds the two equal.
 */
export const FALLBACK_PHONE = { display: '+84 236 651 9999', tel: '+842366519999' } as const;
