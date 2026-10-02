'use client';

import { CONTACT, contactFor } from '@/lib/data';
import { useSite } from '@/components/site/SiteProvider';

/**
 * The phone tab bar. Each page renders its own (inside its <ViewMarker>), so the
 * right variant is in the server HTML and a page hidden by <Activity> hides its
 * bar with it. The home page passes nothing, a restaurant page passes its slug.
 */
export function MobileBar({ slug }: { slug?: string }) {
  const { restaurants, tab, openReserve, scrollToId, setBooking, close } = useSite();

  if (slug) {
    const restaurant = restaurants.find((r) => r.slug === slug);
    const id = restaurant?.id ?? slug;
    const contact = contactFor(restaurant?.dest);
    const canReserve = restaurant?.bookingEnabled ?? false;
    // One column per button shown (spec §6.4): MENU always; RESERVE when it books online; CALL and MAP when known.
    const columns = 1 + (canReserve ? 1 : 0) + (contact.tel ? 1 : 0) + (contact.map ? 1 : 0);
    return (
      <nav
        className="tabbar tabbar-detail"
        aria-label="Restaurant actions"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {contact.tel && <a href={`tel:${contact.tel}`}>CALL</a>}
        {contact.map && (
          <a href={contact.map} target="_blank" rel="noopener">
            MAP
          </a>
        )}
        <button type="button" onClick={() => openMenuPdf(() => scrollToId('dishes'))}>
          MENU
        </button>
        {canReserve && (
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

/** Opens the tariff PDF, falling back to the on-page section if popups are blocked. */
export function openMenuPdf(fallback: () => void) {
  const w = window.open(CONTACT.tariffPdf, '_blank', 'noopener');
  if (!w) fallback();
}
