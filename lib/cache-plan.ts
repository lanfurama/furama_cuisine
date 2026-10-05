import { TAGS } from './cache-tags';

/*
 * The cache plan of the guest site (spec §6.2): which tables each cached
 * loader reads and which tags it carries, and which tags a save to each table
 * must expire. lib/cache-plan.test.ts checks the two agree: a save to any
 * table a loader reads expires at least one of that loader's tags. The
 * loaders call cacheTag(...LOADERS.<name>.tags) from here, so a loader cannot
 * drift from its entry; a phase-7 editor expires tagsForSave(<tables>) (in a
 * Server Action: updateTag each) for the tables its transaction wrote.
 *
 * Every loader also carries i18n:<locale> (it takes the locale), so enabling,
 * disabling or changing the machine-translation switch of a language expires
 * everything served in it.
 */

export const CONTENT_TABLES = [
  'locales',
  'content_strings',
  'media',
  'media_i18n',
  'sections',
  'site_settings',
  'destinations',
  'destination_i18n',
  'cuisines',
  'cuisine_i18n',
  'restaurants',
  'restaurant_i18n',
  'restaurant_cuisines',
  'restaurant_highlights',
  'restaurant_highlight_i18n',
  'service_periods',
  'hero_slides',
  'experiences',
  'experience_i18n',
  'stories',
  'story_i18n',
  'offers',
  'offer_i18n',
  'nav_items',
  'nav_item_i18n',
  'social_links',
] as const;
export type ContentTable = (typeof CONTENT_TABLES)[number];

/**
 * What a save to each table expires. `restaurant:<id>` is added by the caller
 * for a restaurant's own rows (tagsForSave's second argument). content_strings
 * is per key prefix (phase 7: hero.* → content:hero, legal.* → content:legal,
 * the rest → content:ui); locales expire `locales` and the i18n tag of every
 * language whose fallback changed (phase 8).
 */
export const SAVE_TAGS: Record<ContentTable, readonly string[]> = {
  locales: [TAGS.locales],
  // By key prefix (phase 7): legal.* → content:legal, the rest → content:ui (and a section's own keys its tag).
  content_strings: [TAGS.contentUi, TAGS.contentLegal],
  media: [TAGS.media],
  media_i18n: [TAGS.media],
  sections: [TAGS.contentSections],
  site_settings: [TAGS.contentContact],
  destinations: [TAGS.contentDestinations],
  destination_i18n: [TAGS.contentDestinations],
  cuisines: [TAGS.contentCuisines],
  cuisine_i18n: [TAGS.contentCuisines],
  restaurants: [TAGS.restaurants],
  restaurant_i18n: [TAGS.restaurants],
  restaurant_cuisines: [TAGS.restaurants],
  restaurant_highlights: [TAGS.restaurants],
  restaurant_highlight_i18n: [TAGS.restaurants],
  // The catalogue's meals come from the active periods (phase 4 saves already expire `restaurants`).
  service_periods: [TAGS.restaurants],
  hero_slides: [TAGS.contentHero],
  experiences: [TAGS.contentExperiences],
  experience_i18n: [TAGS.contentExperiences],
  stories: [TAGS.contentStories],
  story_i18n: [TAGS.contentStories],
  offers: [TAGS.contentOffers],
  offer_i18n: [TAGS.contentOffers],
  nav_items: [TAGS.contentNav],
  nav_item_i18n: [TAGS.contentNav],
  social_links: [TAGS.contentContact],
};

type Loader = { reads: readonly ContentTable[]; tags: readonly string[] };

/** Every cached guest loader: the tables its SQL touches and the tags it carries (besides i18n:<locale>). */
export const LOADERS = {
  locales: { reads: ['locales'], tags: [TAGS.locales] },
  strings: { reads: ['locales', 'content_strings'], tags: [TAGS.contentUi] },
  legal: { reads: ['locales', 'content_strings'], tags: [TAGS.contentLegal] },
  sections: { reads: ['locales', 'sections', 'media', 'media_i18n'], tags: [TAGS.contentSections, TAGS.media] },
  settings: { reads: ['site_settings'], tags: [TAGS.contentContact] },
  cuisines: { reads: ['locales', 'cuisines', 'cuisine_i18n', 'media', 'media_i18n'], tags: [TAGS.contentCuisines, TAGS.media] },
  destinations: {
    reads: ['locales', 'destinations', 'destination_i18n', 'media', 'media_i18n'],
    tags: [TAGS.contentDestinations, TAGS.media],
  },
  nav: { reads: ['locales', 'nav_items', 'nav_item_i18n', 'sections'], tags: [TAGS.contentNav, TAGS.contentSections] },
  socials: { reads: ['social_links'], tags: [TAGS.contentContact] },
  // The search text folds cuisine labels and the destination's name in; CALL falls back to the destination's number.
  restaurants: {
    reads: [
      'locales',
      'restaurants',
      'restaurant_i18n',
      'restaurant_cuisines',
      'service_periods',
      'media',
      'media_i18n',
      'cuisines',
      'cuisine_i18n',
      'destinations',
      'destination_i18n',
    ],
    tags: [TAGS.restaurants, TAGS.media, TAGS.contentCuisines, TAGS.contentDestinations],
  },
  heroSlides: { reads: ['locales', 'hero_slides', 'media', 'media_i18n'], tags: [TAGS.contentHero, TAGS.media] },
  experiences: { reads: ['locales', 'experiences', 'experience_i18n'], tags: [TAGS.contentExperiences] },
  stories: { reads: ['locales', 'stories', 'story_i18n', 'media', 'media_i18n'], tags: [TAGS.contentStories, TAGS.media] },
  // cacheLife('hours') and the daily cron. The venue is the restaurant's name, and a hidden restaurant hides its offers.
  // The price wording is the offers screen's registry keys (offers.price_*), hence content_strings and content:ui.
  offers: {
    reads: ['locales', 'offers', 'offer_i18n', 'restaurants', 'content_strings'],
    tags: [TAGS.contentOffers, TAGS.restaurants, TAGS.contentUi],
  },
  // Plus restaurant:<id>, added once the query has found the restaurant.
  detail: {
    reads: [
      'locales',
      'restaurants',
      'restaurant_i18n',
      'restaurant_highlights',
      'restaurant_highlight_i18n',
      'destinations',
      'destination_i18n',
      'media',
      'media_i18n',
    ],
    tags: [TAGS.restaurants, TAGS.contentDestinations, TAGS.media],
  },
  detailSlugs: { reads: ['restaurants'], tags: [TAGS.restaurants] },
} as const satisfies Record<string, Loader>;

export type LoaderName = keyof typeof LOADERS;

/** The tags a transaction that wrote `tables` must expire; `restaurantId` adds that restaurant's own tag. */
export function tagsForSave(tables: readonly ContentTable[], restaurantId?: string): string[] {
  const tags = new Set(tables.flatMap((t) => SAVE_TAGS[t]));
  if (restaurantId) tags.add(TAGS.restaurant(restaurantId));
  return [...tags];
}
