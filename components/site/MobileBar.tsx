'use client';

import type { MenuAction, RestaurantDetail } from '@/lib/content/types';
import { useSite } from '@/components/site/SiteProvider';

/**
 * The phone tab bar. Each page renders its own (inside its <ViewMarker>), so the
 * right variant is in the server HTML and a page hidden by <Activity> hides its
 * bar with it. The home page passes nothing, a restaurant page passes its page.
 */
export function MobileBar({ detail }: { detail?: RestaurantDetail }) {
  const { tab, openReserve, scrollToId, setBooking, close, strings } = useSite();

  if (detail) {
    const id = detail.id;
    const menu = detail.menu;
    // One column per button shown (spec §6.4): RESERVE when it books online; CALL, MAP and MENU when they lead somewhere.
    const columns = [detail.bookingEnabled, detail.phone, detail.map, menu].filter(Boolean).length;
    if (columns === 0) return null;
    return (
      <nav
        className="tabbar tabbar-detail"
        aria-label={strings['detail.actions_aria']}
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {detail.phone && <a href={`tel:${detail.phone.tel}`}>{strings['detail.call']}</a>}
        {detail.map && (
          <a href={detail.map} target="_blank" rel="noopener">
            {strings['detail.map']}
          </a>
        )}
        {menu && (
          <button type="button" onClick={() => openMenu(menu, () => scrollToId('dishes'))}>
            {strings['detail.menu']}
          </button>
        )}
        {detail.bookingEnabled && (
          <button
            type="button"
            className="tabbar-primary"
            onClick={() => {
              setBooking({ restaurant: id });
              openReserve({ restaurant: id });
            }}
          >
            RESERVE
          </button>
        )}
      </nav>
    );
  }

  return (
    <nav className="tabbar tabbar-home" aria-label="Sections">
      <button
        type="button"
        data-active={tab === 'explore'}
        onClick={() => {
          close();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      >
        EXPLORE
      </button>
      <button type="button" data-active={tab === 'restaurants'} onClick={() => scrollToId('restaurants')}>
        RESTAURANTS
      </button>
      <button type="button" data-active={tab === 'reserve'} onClick={() => openReserve()}>
        RESERVE
      </button>
    </nav>
  );
}

/**
 * MENU (spec §6.4): the PDF in a new tab, falling back to the page's
 * highlights when there is no PDF or the browser blocks the popup. Not
 * window.open(url, '_blank', 'noopener'): with that feature it always returns
 * null, so a blocked popup could not be told from an opened one and the page
 * scrolled away under every PDF. The opener is cut by hand instead.
 */
export function openMenu(menu: MenuAction, scrollToHighlights: () => void) {
  if (menu.kind === 'scroll') {
    scrollToHighlights();
    return;
  }
  const w = window.open(menu.url, '_blank');
  if (w) w.opener = null;
  else scrollToHighlights();
}
