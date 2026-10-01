'use client';

import { CONTACT, contactFor } from '@/lib/data';
import { useSite } from '@/components/site/SiteProvider';

/**
 * The phone tab bar. Each page renders its own, so the right variant is in the
 * server HTML: the home page passes nothing, a restaurant page passes its slug.
 */
export function MobileBar({ slug }: { slug?: string }) {
  const { restaurants, tab, openReserve, scrollToId, setBooking, close } = useSite();

  if (slug) {
    const restaurant = restaurants.find((r) => r.slug === slug);
    const id = restaurant?.id ?? slug;
    const contact = contactFor(restaurant?.dest);
    // One column per button shown (spec §6.4): MENU and RESERVE always, CALL and MAP when known.
    const columns = 2 + (contact.tel ? 1 : 0) + (contact.map ? 1 : 0);
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
