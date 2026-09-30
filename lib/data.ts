export type Meal = 'Breakfast' | 'Lunch' | 'Dinner' | 'Drinks';
export type DestKey = 'resort' | 'dining-house' | 'mm';

export type Restaurant = {
  id: string;
  name: string;
  type: string;
  cuisines: string[];
  dest: DestKey;
  meals: Meal[];
  /** Covers bookable per time slot; drives real availability. */
  slotCapacity: number;
};

/* The restaurant catalogue lives in Neon (see db/migrations/002_seed_restaurants.sql)
   and is loaded by db/queries.ts#listRestaurants. */


/** [label, asset slug] — order drives the cuisine rail and the search suggestions. */
export const CUISINES: [string, string][] = [
  ['Vietnamese', 'vietnamese'],
  ['Italian', 'italian'],
  ['Thai', 'thai'],
  ['Japanese', 'japanese'],
  ['Steak & Grill', 'steak-grill'],
  ['Hotpot', 'hotpot'],
  ['International', 'international'],
  ['Café & Lounge', 'cafe-lounge'],
];

export const DESTS: Record<DestKey, string> = {
  resort: 'Furama Resort Danang',
  'dining-house': 'Furama Dining House',
  mm: 'Furama MM Supercenter',
};

export const DEST_KEYS = Object.keys(DESTS) as DestKey[];

export const SLOTS: Record<Meal, string[]> = {
  Breakfast: ['06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '09:30'],
  Lunch: ['11:30', '12:00', '12:30', '13:00', '13:30'],
  Dinner: ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00'],
  Drinks: ['17:00', '18:00', '19:00', '20:00', '21:00', '22:00'],
};

export const MEALS: Meal[] = ['Breakfast', 'Lunch', 'Dinner', 'Drinks'];
export const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type DestinationCard = {
  key: DestKey | 'future';
  slot: string;
  title: [string, string];
  blurb: [string, string];
};

export const DESTINATION_CARDS: DestinationCard[] = [
  { key: 'resort', slot: 'dest-resort', title: ['Furama', 'Resort Danang'], blurb: ['Iconic beachfront dining', 'since 1997'] },
  { key: 'dining-house', slot: 'dest-dining-house', title: ['Furama', 'Dining House'], blurb: ['4 floors · 4 flavours', '1 night out'] },
  { key: 'mm', slot: 'dest-mm', title: ['Furama MM', 'Supercenter'], blurb: ['Everyday dining', 'for everyone'] },
  { key: 'future', slot: 'dest-future', title: ['Future', 'Locations'], blurb: ['Bringing great food', 'to more places'] },
];

export const EXPERIENCES = [
  { title: 'Culinary Experiences', blurb: 'Tàya House cooking classes · Seafood & Steak Buffet · Champa dance nights' },
  { title: 'Private Dining & Events', blurb: 'Weddings · Corporate · Celebrations · MICE dining' },
  { title: 'Furama Fabulous', blurb: 'Membership · Rewards · Dining privileges' },
];

export const STORIES = [
  {
    slot: 'story-chef',
    img: 'story-dh-opening',
    kicker: 'Restaurant News · 9 Sep 2026',
    title: 'Grand opening: one house, four flavours in An Thượng',
    href: 'https://www.furamadining.com/diem-den/tin/furama-dining-house-grand-opening-mot-ngoi-nha-bon-huong-vi-giua-long-an-thuong',
  },
  {
    slot: 'story-italian',
    img: 'story-the-fan',
    kicker: 'Restaurant News · 5 Sep 2026',
    title: 'Steakhouse The Fan, where fine food meets art',
    href: 'https://www.furamadining.com/diem-den/tin/steakhouse-the-fan-hanh-trinh-4-nha-hang-noi-am-thuc-va-nghe-thuat-gap-nhau',
  },
  {
    slot: 'story-izakaya',
    img: 'story-thai-siam',
    kicker: 'Restaurant News · 3 Sep 2026',
    title: 'Thai Siam Kitchen, a bridge between Vietnam and Thailand',
    href: 'https://www.furamadining.com/diem-den/tin/thai-siam-kitchen-tu-mot-can-bep-thai-den-nhip-cau-am-thuc-va-van-hoa-viet-nam-thai-lan',
  },
  {
    slot: 'story-producers',
    img: 'story-buffet-gala',
    kicker: 'Furama Resort Danang',
    title: 'Inside the Central Vietnam Seafood & Steak Buffet Gala',
    href: 'https://furamavietnam.com/a-premium-central-vietnam-seafood-steak-buffet-gala-a-culinary-masterpiece-at-furama-resort-danang/',
  },
];

export type Offer = {
  venue: string;
  title: string;
  detail: string;
  restaurant: string;
  note: string;
};

export const OFFERS: Offer[] = [
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
];

export const TAYA_EXPERIENCES = [
  { slot: 'taya-exp-class', img: 'taya-class', alt: 'Cooking class photo', title: 'Vietnamese Cooking Class', detail: 'Daily at 11:00 or 14:00 · VND 799,000++ per guest' },
  { slot: 'taya-exp-drinks', img: 'taya-lounge', alt: 'Tàya House interior', title: 'Healthy Drinks & Snacks', detail: 'Served in the garden house, daily 10:00–22:00' },
  { slot: 'taya-exp-garden', img: 'taya-garden', alt: 'Lagoon Garden', title: 'Private Gatherings', detail: 'Outdoor celebrations and intimate events among the palms' },
  { slot: 'taya-exp-stay', img: 'taya-stay', alt: 'Cooking class & stay', title: 'Cooking Class & Stay', detail: 'From USD 420 · 2 nights for 2 guests' },
];

export const HERO_SLIDES = [
  { id: 'hero-slide-1', img: 'hero-beach', alt: 'Hero slide 1' },
  { id: 'hero-slide-2', img: 'hero-taya', alt: 'Hero slide 2' },
  { id: 'hero-slide-3', img: 'hero-indochine', alt: 'Hero slide 3' },
];

export const NAV_LINKS = [
  { label: 'RESTAURANTS', target: 'restaurants' },
  { label: 'DESTINATIONS', target: 'destinations' },
  { label: 'EXPERIENCES', target: 'experiences' },
  { label: 'OFFERS', target: 'offers' },
  { label: 'STORIES', target: 'stories' },
  { label: 'ABOUT', target: 'heritage' },
];

export const CONTACT = {
  resortPhone: '+842366519999',
  resortPhoneLabel: '+84 236 651 9999',
  diningHousePhone: '0859555759',
  diningHousePhoneLabel: '0859 555 759',
  email: 'fb@furamavietnam.com',
  map: 'https://maps.google.com/?q=Furama+Resort+Danang',
  tariffPdf: 'https://furamavietnam.com/wp-content/uploads/2026/03/Taya-CC-Tariff-A4-1-25.pdf',
  story: 'https://furamavietnam.com/the-resort/',
};

export const SOCIALS = [
  { label: 'FACEBOOK', href: 'https://www.facebook.com/furamaresort' },
  { label: 'INSTAGRAM', href: 'https://www.instagram.com/furamaculinaryworld/' },
  { label: 'YOUTUBE', href: 'https://www.youtube.com/user/furamaresortvietnam' },
  { label: 'TIKTOK', href: 'https://www.tiktok.com/@furama.dining.hous' },
];

export const restaurantImage = (id: string) => `/assets/r-${id}.jpg`;
export const cuisineImage = (slug: string) => `/assets/cuisine-${slug}.jpg`;
