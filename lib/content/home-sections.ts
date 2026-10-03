import { SECTION_KEYS, type NavItem, type SectionKey, type Sections } from './types';

/**
 * The home page's blocks that render (spec §6.5): those staff left on
 * (sections.is_visible), less a list with nothing in it (no slide, no offer
 * today). `restaurants` always renders: it cannot be switched off (CHECK
 * sections_restaurants_visible). The page renders by this, and the chrome asks
 * it about its own sections: film off hides WATCH THE FILM and the film
 * dialog, finder off FIND A RESTAURANT, booking_bar off the booking bar.
 * Pure, so the browser's chrome and the server's page agree.
 */
export function homeSections(sections: Sections, lists: Partial<Record<SectionKey, readonly unknown[]>> = {}): Set<SectionKey> {
  return new Set(
    SECTION_KEYS.filter((key) => {
      if (key === 'restaurants') return true;
      const list = lists[key];
      return sections[key].visible && (list === undefined || list.length > 0);
    }),
  );
}

/**
 * The header's and the menu's items, less those whose section the home page
 * leaves out (spec §6.5: an item hides itself when its target section is
 * hidden). loadNav already drops an item whose section staff switched off;
 * this also drops one whose list has nothing to show (no offer today), which
 * only the home page's answer knows. Without it the item would scroll to
 * nothing on the home page, and from any other page land on the home page's
 * top. In the nav's own order.
 */
export function navFor(nav: readonly NavItem[], shown: ReadonlySet<SectionKey>): NavItem[] {
  return nav.filter((item) => shown.has(item.target));
}

/**
 * html[data-hero]: 'none' while the page on screen is a home page without its
 * hero, so styles/layout.css gives the header its solid, condensed form from
 * the top (as on a page with no hero of its own; nothing dark sits under the
 * header's cream text then). Every other page shown takes the mark off. It
 * lives on <html>, set by the page that shows (SiteProvider's showPage), and
 * not in a document-wide :has(): <Activity> keeps a hidden home page mounted,
 * and its <main data-hero="none"> would match while another page shows.
 * Takes the dataset, so it runs without a DOM.
 */
export function markHero(dataset: Record<string, string | undefined>, page: { view: string; hero: boolean }): void {
  if (page.view === 'home' && !page.hero) dataset.hero = 'none';
  else delete dataset.hero;
}
