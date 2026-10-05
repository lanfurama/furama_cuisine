/*
 * What the guest site's content loaders (lib/server/content/*) hand to the
 * components: plain, serialisable shapes, resolved for one language with the
 * default language filling any field that has no visible translation
 * (spec §5.1 item 5). Safe in the browser: Server Components pass these as
 * props, and the (guarded) layout passes the site-wide ones to SiteProvider.
 */

/**
 * An image as a component draws it: alt already chosen ("" for a decorative
 * one); `blur` is the upload's tiny placeholder (media.blur_data_url), absent
 * for the static files.
 */
export type Media = { url: string; alt: string; width: number; height: number; blur?: string };

/** A dialable number (E.164) and the way it is printed. */
export type Phone = { tel: string; display: string };

/** The home page's fixed blocks (sections.key), in the design's order. */
export const SECTION_KEYS = [
  'hero',
  'film',
  'finder',
  'cuisines',
  'restaurants',
  'destinations',
  'experiences',
  'heritage',
  'stories',
  'offers',
  'booking_bar',
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

/** A home-page block: on or off, and its picture and link where it has one. */
export type Section = { visible: boolean; image: Media | null; link: string | null };
export type Sections = Record<SectionKey, Section>;

export type Cuisine = { id: string; label: string; image: Media | null };

export type Destination = {
  id: string;
  kind: 'venue' | 'teaser';
  /** The dropdowns', the footer's and "More at …"'s name; null for a teaser that has none ("Future Locations"). */
  name: string | null;
  /** The home card's two title lines and two blurb lines. */
  cardTitle: [string, string];
  cardBlurb: [string, string];
  image: Media | null;
  address: string | null;
  phone: Phone | null;
  map: string | null;
  showInFooter: boolean;
};

export type NavItem = { target: SectionKey; label: string };

export type SocialLink = { platform: string; href: string };

/** site_settings as the guest site reads it. */
export type SiteSettings = {
  /** The shared inbox: the footer's and the privacy page's address. */
  email: string;
  /** The restaurant the booking bar starts on; null: the first bookable one. */
  defaultRestaurantId: string | null;
  /** The finder's occasion; null: any. */
  defaultOccasion: string | null;
  heroAutoplayMs: number;
};

/** A hero slide: its picture (alt "" when decorative) and, for the first, the phone crop. */
export type HeroSlide = { id: number; image: Media; mobile: Media | null };

/** An Experiences row; href null links to the section itself, as before phase 6. */
export type Experience = { id: number; title: string; blurb: string; href: string | null };

/** A story card: the kicker is already "Category · 9 Sep 2026" (lib/content/format.ts). */
export type Story = { id: number; image: Media | null; kicker: string; title: string; href: string };

/**
 * An offer card on show today: the venue (an override, else the restaurant's
 * name), the title, and the detail line already "VND 888,000++ per guest ·
 * Nightly 18:30–22:00" (lib/content/format.ts). VIEW OFFER reserves at
 * restaurantId.
 */
export type Offer = { id: number; restaurantId: string; venue: string; title: string; detail: string };

/** A card of a restaurant page's highlights (restaurant_highlights). */
export type Highlight = { id: number; image: Media; title: string; detail: string };

/** What a restaurant page's MENU does: open the menu PDF (this language's, else the default language's), or scroll to the highlights. */
export type MenuAction = { kind: 'pdf'; url: string } | { kind: 'scroll' };

/** One restaurant's page (spec §6.4), resolved for one language; CALL and MAP already fall back to the destination's. */
export type RestaurantDetail = {
  id: string;
  slug: string;
  name: string;
  /** "More at …": the destination's name in this language. */
  destinationName: string;
  kicker: string | null;
  /** null: the default label ("Brand Story"). */
  storyLabel: string | null;
  story: string | null;
  /** null: "At {name}". */
  highlightsTitle: string | null;
  portrait: Media;
  /** restaurants.booking_enabled: RESERVE shows only when it books online. */
  bookingEnabled: boolean;
  /** The restaurant's number, else its destination's; null hides CALL. */
  phone: Phone | null;
  /** The restaurant's map link, else its destination's; null hides MAP. */
  map: string | null;
  /** null hides MENU: no PDF in either language and no highlights to scroll to. */
  menu: MenuAction | null;
  highlights: Highlight[];
  seo: { title: string | null; description: string | null };
};

/** Everything the chrome (header, menu, footer, finder, search, booking bar) needs, on every guest page. */
export type SiteContent = {
  cuisines: Cuisine[];
  destinations: Destination[];
  nav: NavItem[];
  socials: SocialLink[];
  sections: Sections;
  settings: SiteSettings;
};
