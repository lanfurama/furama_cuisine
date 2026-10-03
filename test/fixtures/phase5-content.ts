/**
 * The guest site's content as it stood at 8fe98f5 (end of phase 5), written
 * out once: lib/data.ts plus the copy that lived in the components. Migration
 * 008 must seed exactly this (test/integration/content-seed.test.ts compares the
 * database with it), and the phase-6 read path must render it unchanged (the
 * visual baselines). It is frozen on purpose, like PHASE1 in
 * booking-seed.test.ts: the comparison must survive the deletion of the
 * constants and component literals it was taken from.
 *
 * Only what moves into content tables is here. The restaurants' own columns
 * (name, type, destination, cuisines) were already in the database (002); the
 * test compares the new columns with those. Section copy and UI text become
 * registry keys, whose defaults are proven by the visual baselines.
 */

export const CUISINES_AT_8FE98F5: readonly (readonly [label: string, slug: string])[] = [
  ['Vietnamese', 'vietnamese'],
  ['Italian', 'italian'],
  ['Thai', 'thai'],
  ['Japanese', 'japanese'],
  ['Steak & Grill', 'steak-grill'],
  ['Hotpot', 'hotpot'],
  ['International', 'international'],
  ['Café & Lounge', 'cafe-lounge'],
];

/** The home cards in order, the dropdown name, and the footer line (null: not in the footer). */
export const DESTINATIONS_AT_8FE98F5 = [
  {
    id: 'resort',
    name: 'Furama Resort Danang',
    title: ['Furama', 'Resort Danang'],
    blurb: ['Iconic beachfront dining', 'since 1997'],
    image: '/assets/dest-resort.jpg',
    footer: 'Furama Resort Danang · 103–105 Võ Nguyên Giáp, Ngũ Hành Sơn, Đà Nẵng · +84 236 651 9999',
  },
  {
    id: 'dining-house',
    name: 'Furama Dining House',
    title: ['Furama', 'Dining House'],
    blurb: ['4 floors · 4 flavours', '1 night out'],
    image: '/assets/dest-dining-house.jpg',
    footer: 'Furama Dining House · 73 Trần Bạch Đằng, An Thượng · 0859 555 759',
  },
  {
    id: 'mm',
    name: 'Furama MM Supercenter',
    title: ['Furama MM', 'Supercenter'],
    blurb: ['Everyday dining', 'for everyone'],
    image: '/assets/dest-mm.jpg',
    footer: null,
  },
  {
    id: 'future',
    name: null,
    title: ['Future', 'Locations'],
    blurb: ['Bringing great food', 'to more places'],
    image: '/assets/dest-future.jpg',
    footer: null,
  },
] as const;

/** Hero.tsx: slide 1 has the phone crop and the only alt text. */
export const HERO_SLIDES_AT_8FE98F5 = [
  { image: '/assets/hero-beach.jpg', mobile: '/assets/hero-hall-m.jpg', alt: 'Dining at Furama Cuisine' },
  { image: '/assets/hero-taya.jpg', mobile: null, alt: '' },
  { image: '/assets/hero-indochine.jpg', mobile: null, alt: '' },
] as const;

/** SiteProvider.tsx: the slideshow's interval. */
export const HERO_AUTOPLAY_MS_AT_8FE98F5 = 7000;

/** The pictures and links of the home sections (Experiences.tsx, Heritage.tsx, FilmModal.tsx). */
export const SECTIONS_AT_8FE98F5 = {
  film: { image: '/assets/hero-beach.jpg', link: null },
  experiences: { image: '/assets/chef.jpg', alt: 'A Furama chef at work', link: null },
  heritage: { image: '/assets/heritage.jpg', alt: '', link: 'https://furamavietnam.com/the-resort/' },
} as const;

export const EXPERIENCES_AT_8FE98F5 = [
  { title: 'Culinary Experiences', blurb: 'Tàya House cooking classes · Seafood & Steak Buffet · Champa dance nights' },
  { title: 'Private Dining & Events', blurb: 'Weddings · Corporate · Celebrations · MICE dining' },
  { title: 'Furama Fabulous', blurb: 'Membership · Rewards · Dining privileges' },
] as const;

/** Stories.tsx draws every image with alt="". */
export const STORIES_AT_8FE98F5 = [
  {
    image: '/assets/story-dh-opening.jpg',
    kicker: 'Restaurant News · 9 Sep 2026',
    title: 'Grand opening: one house, four flavours in An Thượng',
    href: 'https://www.furamadining.com/diem-den/tin/furama-dining-house-grand-opening-mot-ngoi-nha-bon-huong-vi-giua-long-an-thuong',
  },
  {
    image: '/assets/story-the-fan.jpg',
    kicker: 'Restaurant News · 5 Sep 2026',
    title: 'Steakhouse The Fan, where fine food meets art',
    href: 'https://www.furamadining.com/diem-den/tin/steakhouse-the-fan-hanh-trinh-4-nha-hang-noi-am-thuc-va-nghe-thuat-gap-nhau',
  },
  {
    image: '/assets/story-thai-siam.jpg',
    kicker: 'Restaurant News · 3 Sep 2026',
    title: 'Thai Siam Kitchen, a bridge between Vietnam and Thailand',
    href: 'https://www.furamadining.com/diem-den/tin/thai-siam-kitchen-tu-mot-can-bep-thai-den-nhip-cau-am-thuc-va-van-hoa-viet-nam-thai-lan',
  },
  {
    image: '/assets/story-buffet-gala.jpg',
    kicker: 'Furama Resort Danang',
    title: 'Inside the Central Vietnam Seafood & Steak Buffet Gala',
    href: 'https://furamavietnam.com/a-premium-central-vietnam-seafood-steak-buffet-gala-a-culinary-masterpiece-at-furama-resort-danang/',
  },
] as const;

/** Offers.tsx: venue, title and detail on the card; the note pre-filled into the drawer. */
export const OFFERS_AT_8FE98F5 = [
  {
    venue: 'Café Indochine',
    title: 'Seafood & Steak Buffet Dinner',
    detail: 'VND 888,000++ per guest · Nightly 18:30–22:00',
    restaurant: 'cafe-indochine',
    note: 'Offer: Seafood & Steak Buffet Dinner',
  },
  {
    venue: 'Tàya House',
    title: 'Vietnamese Cooking Class',
    detail: 'VND 799,000++ per guest · Daily 11:00 or 14:00',
    restaurant: 'taya-house',
    note: 'Offer: Vietnamese Cooking Class',
  },
  {
    venue: 'Hải Vân Lounge',
    title: 'Afternoon Tea & Dessert Buffet',
    detail: 'VND 450,000 net per guest · ~30 pastries, 12+ teas',
    restaurant: 'hai-van-lounge',
    note: 'Offer: Afternoon Tea & Dessert Buffet',
  },
] as const;

/** The detail pages (TayaHero.tsx, TayaExperiences.tsx, DETAIL_SEO, contactFor, MobileBar's tariff PDF). */
export const DETAIL_PAGES_AT_8FE98F5 = {
  'taya-house': {
    kicker: 'A Wellness Dining Home · Furama Resort Danang',
    story:
      'Beneath the Lagoon Garden, the resort’s “Green Oasis in the Heart of the City” tells a journey from Mường Khụ, a land of stones, to Danang by the sea — with cooking classes led by Cơ Tu chef A Rất Thị Hép.',
    portrait: '/assets/taya-hero.jpg',
    portraitAlt: 'Tàya House',
    seo: {
      title: 'Tàya House — Furama Cuisine',
      description:
        'A wellness dining home beneath the Lagoon Garden at Furama Resort Danang, with Vietnamese cooking classes led by Cơ Tu chef A Rất Thị Hép.',
    },
    menuPdf: 'https://furamavietnam.com/wp-content/uploads/2026/03/Taya-CC-Tariff-A4-1-25.pdf',
    call: '+842366519999',
    map: 'https://maps.google.com/?q=Furama+Resort+Danang',
    highlights: [
      { image: '/assets/taya-class.jpg', alt: 'Cooking class photo', title: 'Vietnamese Cooking Class', detail: 'Daily at 11:00 or 14:00 · VND 799,000++ per guest' },
      { image: '/assets/taya-lounge.jpg', alt: 'Tàya House interior', title: 'Healthy Drinks & Snacks', detail: 'Served in the garden house, daily 10:00–22:00' },
      { image: '/assets/taya-garden.jpg', alt: 'Lagoon Garden', title: 'Private Gatherings', detail: 'Outdoor celebrations and intimate events among the palms' },
      { image: '/assets/taya-stay.jpg', alt: 'Cooking class & stay', title: 'Cooking Class & Stay', detail: 'From USD 420 · 2 nights for 2 guests' },
    ],
  },
} as const;

/** Header.tsx shows NAV_LINKS' capitals, MenuOverlay.tsx its own title case: one label, CSS uppercases the header. */
export const NAV_AT_8FE98F5 = [
  { target: 'restaurants', header: 'RESTAURANTS', menu: 'Restaurants' },
  { target: 'destinations', header: 'DESTINATIONS', menu: 'Destinations' },
  { target: 'experiences', header: 'EXPERIENCES', menu: 'Experiences' },
  { target: 'offers', header: 'OFFERS', menu: 'Offers' },
  { target: 'stories', header: 'STORIES', menu: 'Stories' },
  { target: 'heritage', header: 'ABOUT', menu: 'About' },
] as const;

/** Footer.tsx; the label is the platform's name in capitals. */
export const SOCIALS_AT_8FE98F5 = [
  { platform: 'facebook', label: 'FACEBOOK', href: 'https://www.facebook.com/furamaresort' },
  { platform: 'instagram', label: 'INSTAGRAM', href: 'https://www.instagram.com/furamaculinaryworld/' },
  { platform: 'youtube', label: 'YOUTUBE', href: 'https://www.youtube.com/user/furamaresortvietnam' },
  { platform: 'tiktok', label: 'TIKTOK', href: 'https://www.tiktok.com/@furama.dining.hous' },
] as const;

/** site_settings: the footer email, the booking bar's restaurant, the finder's occasion. */
export const SETTINGS_AT_8FE98F5 = {
  email: 'fb@furamavietnam.com',
  defaultRestaurantId: 'taya-house',
  defaultOccasion: 'Dinner',
} as const;
