import { SECTION_KEYS, type SectionKey, type Sections } from './types';

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
