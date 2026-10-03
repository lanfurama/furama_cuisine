'use client';

import type { Offer } from '@/lib/content/types';
import { useSite } from '@/components/site/SiteProvider';
import { useReveal } from '@/lib/motion';

/** Today's offers (lib/server/content/home.ts getOffers); the page leaves the section out when there are none. */
export function Offers({ items }: { items: Offer[] }) {
  const title = useReveal<HTMLHeadingElement>('title');
  const lede = useReveal<HTMLParagraphElement>('up');

  return (
    <section id="offers" className="offers">
      <div className="shell">
        <div className="offers-head">
          <h2 ref={title} data-reveal="title" className="section-title">
            Offers
          </h2>
          <p ref={lede} data-reveal="up" className="section-lede">
            Seasonal menus and special evenings across our restaurants — valid until 31 December
            2026.
          </p>
        </div>

        <div className="offers-grid">
          {items.map((o) => (
            <OfferCard key={o.id} offer={o} />
          ))}
        </div>
      </div>
    </section>
  );
}

function OfferCard({ offer }: { offer: Offer }) {
  const { bookable, openReserve } = useSite();
  const ref = useReveal<HTMLDivElement>('up');
  // An offer's only action is reserving at its restaurant: none while that restaurant books offline.
  const canReserve = bookable.some((r) => r.id === offer.restaurantId);

  return (
    <div ref={ref} data-reveal="up" className="offer">
      <div className="offer-venue">{offer.venue}</div>
      <div className="offer-title">{offer.title}</div>
      <div className="offer-detail">{offer.detail}</div>
      {canReserve && (
        <button
          type="button"
          className="offer-cta"
          onClick={() => openReserve({ restaurant: offer.restaurantId }, { id: offer.id, title: offer.title })}
        >
          VIEW OFFER<span>→</span>
        </button>
      )}
    </div>
  );
}
