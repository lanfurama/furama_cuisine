'use client';

import { CONTACT } from '@/lib/data';
import { useSite } from '@/components/site/SiteProvider';

export function MobileBar() {
  const { view, tab, openReserve, scrollToId, setBooking, close } = useSite();

  if (view === 'detail') {
    return (
      <nav className="tabbar tabbar-detail" aria-label="Restaurant actions">
        <a href={`tel:${CONTACT.resortPhone}`}>CALL</a>
        <a href={CONTACT.map} target="_blank" rel="noopener">
          MAP
        </a>
        <button type="button" onClick={() => openMenuPdf(() => scrollToId('dishes'))}>
          MENU
        </button>
        <button
          type="button"
          className="tabbar-primary"
          onClick={() => {
            setBooking({ restaurant: 'taya-house' });
            openReserve({ restaurant: 'taya-house' });
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
