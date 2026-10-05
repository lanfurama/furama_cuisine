import type { ContentTable } from '@/lib/cache-plan';
import type { AdminScreen } from '@/lib/i18n/registry';

/*
 * Where staff edit each thing a guest sees (spec §7.2, and its CI test: "mọi
 * key, bảng và cột khách nhìn thấy đều có màn hình sửa"). Two maps:
 *
 *   - EDIT_SCREENS: every admin screen that edits guest content, with its
 *     route and page file. The registry's `screen` of every key is one of
 *     them (AdminScreen ⊂ EditScreen).
 *   - COLUMN_SCREENS: every column of every content table (lib/cache-plan.ts
 *     CONTENT_TABLES) is either edited on a screen, or is bookkeeping /
 *     not shown to guests, with the reason.
 *
 * test/guards/editing-screens.guard.test.ts checks the page files exist and
 * render their screen, and test/integration/editing-screens.test.ts checks
 * COLUMN_SCREENS against the migrated database, so a column added by a later
 * migration fails CI until someone says where it is edited.
 */

export type EditScreen =
  | AdminScreen
  /** Section switches, section pictures and links (spec §7.2 content/sections). */
  | 'sections'
  /** The media library: files, alt text, decorative flag (spec §7.2 /admin/media). */
  | 'media'
  /** One restaurant: content, detail page, highlights, SEO (spec §7.2 /admin/restaurants/[id]). */
  | 'restaurant'
  /** One restaurant's booking: service periods, rules (phase 4, /admin/restaurants/[id]/booking). */
  | 'restaurant-booking'
  /** Languages (phase 8, /admin/locales). */
  | 'locales'
  /** The shared inbox (phase 5, /admin/settings/notifications). */
  | 'notifications';

export type ScreenRoute = {
  route: string;
  /** The page file, relative to the repo root. */
  page: string;
  /** The phase that builds it; a screen whose page does not exist yet must name a later phase than today's. */
  phase: number;
};

const content = (screen: string, phase = 7): ScreenRoute => ({
  route: `/admin/content/${screen}`,
  page: `app/admin/(shell)/content/${screen}/page.tsx`,
  phase,
});

export const EDIT_SCREENS: Record<EditScreen, ScreenRoute> = {
  hero: content('hero'),
  cuisines: content('cuisines'),
  restaurants: { route: '/admin/restaurants', page: 'app/admin/(shell)/restaurants/page.tsx', phase: 7 },
  destinations: content('destinations'),
  experiences: content('experiences'),
  heritage: content('heritage'),
  stories: content('stories'),
  offers: content('offers'),
  booking: content('booking'),
  navigation: content('navigation'),
  contact: content('contact'),
  seo: content('seo'),
  legal: content('legal'),
  emails: content('emails'),
  'ui-text': content('ui-text'),
  sections: content('sections'),
  media: { route: '/admin/media', page: 'app/admin/(shell)/media/page.tsx', phase: 7 },
  restaurant: { route: '/admin/restaurants/[id]', page: 'app/admin/(shell)/restaurants/[id]/page.tsx', phase: 7 },
  'restaurant-booking': {
    route: '/admin/restaurants/[id]/booking',
    page: 'app/admin/(shell)/restaurants/[id]/booking/page.tsx',
    phase: 4,
  },
  locales: { route: '/admin/locales', page: 'app/admin/(shell)/locales/page.tsx', phase: 8 },
  notifications: { route: '/admin/settings/notifications', page: 'app/admin/(shell)/settings/notifications/page.tsx', phase: 5 },
};

/** A column no guest reads as content: why. */
type NotEdited = { none: string };
export type ColumnOwner = EditScreen | NotEdited;

const KEY: NotEdited = { none: 'key or foreign key: set by the editor that creates the row, never typed' };
const ORDER: NotEdited = { none: 'list order: written by the SortableList of the list’s own screen' };
const BOOKKEEPING: NotEdited = { none: 'bookkeeping (created/updated at/by)' };
const TRANSLATION: NotEdited = { none: 'translation metadata (spec §5.1 item 3): written by the save flow, shown as status' };
const LEGACY: NotEdited = { none: 'legacy column, unread since phase 6; phase 10 drops it' };

/** The §5.1 item 3 columns of every *_i18n table and content_strings. */
const I18N_META = {
  locale: KEY,
  status: TRANSLATION,
  origin: TRANSLATION,
  ai_model: TRANSLATION,
  source_hash: TRANSLATION,
  reviewed_by: TRANSLATION,
  reviewed_at: TRANSLATION,
  updated_at: BOOKKEEPING,
  updated_by: BOOKKEEPING,
} as const;

const LIST_META = {
  id: KEY,
  sort_order: ORDER,
  created_at: BOOKKEEPING,
  updated_at: BOOKKEEPING,
  updated_by: BOOKKEEPING,
} as const;

export const COLUMN_SCREENS: Record<ContentTable, Record<string, ColumnOwner>> = {
  locales: {
    code: 'locales',
    bcp47: 'locales',
    native_name: 'locales',
    short_label: 'locales',
    script: 'locales',
    is_default: 'locales',
    is_enabled: 'locales',
    serve_machine: 'locales',
    sort_order: 'locales',
    created_at: BOOKKEEPING,
    updated_at: BOOKKEEPING,
    updated_by: BOOKKEEPING,
  },
  // The value's screen is the key's registry `screen` (the editing-screens guard checks those separately).
  content_strings: { key: KEY, value: { none: 'edited on the screen its key names (registry `screen`)' }, ...I18N_META },
  media: {
    id: KEY,
    storage: { none: 'set by the upload (static or blob)' },
    url: 'media',
    pathname: { none: 'set by the upload' },
    content_type: { none: 'set by the upload' },
    width: { none: 'measured at upload' },
    height: { none: 'measured at upload' },
    bytes: { none: 'measured at upload' },
    blur_data_url: { none: 'computed at upload (L-ledger: blur on upload)' },
    is_decorative: 'media',
    deleted_at: 'media',
    created_at: BOOKKEEPING,
    created_by: BOOKKEEPING,
    updated_at: BOOKKEEPING,
    updated_by: BOOKKEEPING,
  },
  media_i18n: { media_id: KEY, alt: 'media', ...I18N_META },
  sections: { key: KEY, is_visible: 'sections', image_id: 'sections', link_url: 'sections', updated_at: BOOKKEEPING, updated_by: BOOKKEEPING },
  site_settings: {
    id: KEY,
    email: 'notifications',
    default_restaurant_id: 'booking',
    default_occasion: 'booking',
    og_image_id: 'seo',
    hero_autoplay_ms: 'hero',
    updated_at: BOOKKEEPING,
    updated_by: BOOKKEEPING,
  },
  destinations: {
    ...LIST_META,
    kind: 'destinations',
    card_image_id: 'destinations',
    phone_e164: 'destinations',
    phone_display: 'destinations',
    email: 'destinations',
    map_url: 'destinations',
    show_in_footer: 'destinations',
    is_published: 'destinations',
  },
  destination_i18n: {
    destination_id: KEY,
    name: 'destinations',
    card_title_1: 'destinations',
    card_title_2: 'destinations',
    card_blurb_1: 'destinations',
    card_blurb_2: 'destinations',
    address: 'contact',
    ...I18N_META,
  },
  cuisines: { ...LIST_META, image_id: 'cuisines', is_published: 'cuisines' },
  cuisine_i18n: { cuisine_id: KEY, label: 'cuisines', ...I18N_META },
  restaurants: {
    ...LIST_META,
    name: 'restaurant',
    slug: 'restaurant',
    destination_id: 'restaurant',
    card_image_id: 'restaurant',
    detail_image_id: 'restaurant',
    og_image_id: 'restaurant',
    phone_e164: 'restaurant',
    phone_display: 'restaurant',
    map_url: 'restaurant',
    has_detail_page: 'restaurant',
    is_published: 'restaurant',
    archived_at: 'restaurant',
    booking_enabled: 'restaurant-booking',
    window_days: 'restaurant-booking',
    lead_minutes: 'restaurant-booking',
    max_party: 'restaurant-booking',
    auto_confirm: 'restaurant-booking',
    type: LEGACY,
    destination: LEGACY,
    cuisines: LEGACY,
    meals: LEGACY,
    slot_capacity: LEGACY,
  },
  restaurant_i18n: {
    restaurant_id: KEY,
    type_label: 'restaurant',
    detail_kicker: 'restaurant',
    story_label: 'restaurant',
    story: 'restaurant',
    highlights_title: 'restaurant',
    menu_pdf_media_id: 'restaurant',
    menu_pdf_url: 'restaurant',
    seo_title: 'restaurant',
    seo_description: 'restaurant',
    ...I18N_META,
  },
  restaurant_cuisines: { restaurant_id: KEY, cuisine_id: 'restaurant', sort_order: 'restaurant' },
  restaurant_highlights: { ...LIST_META, restaurant_id: KEY, image_id: 'restaurant', is_published: 'restaurant' },
  restaurant_highlight_i18n: { highlight_id: KEY, title: 'restaurant', detail: 'restaurant', ...I18N_META },
  service_periods: {
    ...LIST_META,
    restaurant_id: KEY,
    meal: 'restaurant-booking',
    weekdays: 'restaurant-booking',
    first_seating: 'restaurant-booking',
    last_seating: 'restaurant-booking',
    interval_min: 'restaurant-booking',
    covers_per_slot: 'restaurant-booking',
    active: 'restaurant-booking',
  },
  hero_slides: { ...LIST_META, image_id: 'hero', image_mobile_id: 'hero', is_published: 'hero' },
  experiences: { ...LIST_META, link_url: 'experiences', is_published: 'experiences' },
  experience_i18n: { experience_id: KEY, title: 'experiences', blurb: 'experiences', ...I18N_META },
  stories: { ...LIST_META, image_id: 'stories', href: 'stories', published_on: 'stories', is_published: 'stories' },
  story_i18n: { story_id: KEY, category: 'stories', title: 'stories', href: 'stories', ...I18N_META },
  offers: {
    ...LIST_META,
    restaurant_id: 'offers',
    price_amount: 'offers',
    currency: 'offers',
    price_basis: 'offers',
    valid_from: 'offers',
    valid_until: 'offers',
    is_published: 'offers',
  },
  offer_i18n: { offer_id: KEY, title: 'offers', schedule: 'offers', venue_override: 'offers', ...I18N_META },
  nav_items: { ...LIST_META, target_section: 'navigation', is_published: 'navigation' },
  nav_item_i18n: { nav_item_id: KEY, label: 'navigation', ...I18N_META },
  social_links: { ...LIST_META, platform: 'contact', href: 'contact', visible_locales: 'contact', is_published: 'contact' },
};

/** The screens some column or key is edited on. */
export function screensInUse(keyScreens: readonly EditScreen[]): Set<EditScreen> {
  const used = new Set<EditScreen>(keyScreens);
  for (const columns of Object.values(COLUMN_SCREENS))
    for (const owner of Object.values(columns)) if (typeof owner === 'string') used.add(owner);
  return used;
}
