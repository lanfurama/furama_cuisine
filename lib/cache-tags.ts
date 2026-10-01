/**
 * Every cache tag of the site: the complete list of spec §6.2. A reader
 * declares the tags it depends on with cacheTag(...); a write refreshes them
 * with updateTag (in a Server Action) or revalidateTag(tag, 'max') (anywhere
 * else). Phase 2 only tags restaurants, i18n:<code>, locales and content:ui;
 * the rest are named now so later phases use these constants, never literals.
 */
export const TAGS = {
  contentHero: 'content:hero',
  contentFilm: 'content:film',
  contentFinder: 'content:finder',
  contentCuisines: 'content:cuisines',
  contentDestinations: 'content:destinations',
  contentExperiences: 'content:experiences',
  contentHeritage: 'content:heritage',
  contentStories: 'content:stories',
  /** Date-bound: its reader uses cacheLife('hours') and the daily cron expires it. */
  contentOffers: 'content:offers',
  contentBooking: 'content:booking',
  /** Which home sections are switched on. */
  contentSections: 'content:sections',
  contentNav: 'content:nav',
  /** site_settings, social_links and the footer. */
  contentContact: 'content:contact',
  contentSeo: 'content:seo',
  contentLegal: 'content:legal',
  /** UI strings: ui.*, form.*, error.*, search.*, common.* */
  contentUi: 'content:ui',
  /** Every reader that returns image alt text. */
  media: 'media',
  /** The restaurant catalogue. */
  restaurants: 'restaurants',
  restaurant: (id: string) => `restaurant:${id}`,
  bookingRules: (restaurantId: string) => `booking-rules:${restaurantId}`,
  /** Which languages exist and which are enabled. */
  locales: 'locales',
  aiSettings: 'ai-settings',
  /** Everything served in one language; refreshed when it is enabled or disabled. */
  i18n: (locale: string) => `i18n:${locale}`,
} as const;
