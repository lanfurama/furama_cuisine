'use client';

import { contactFor } from '@/lib/data';
import { useSite } from '@/components/site/SiteProvider';
import { openMenuPdf } from '@/components/site/MobileBar';
import { useReveal } from '@/lib/motion';

/*
 * One hero across breakpoints: desktop shows the two-column split with the
 * brand story beside a tall portrait, while a phone collapses to a full-bleed
 * image with an overlaid back button and the story beneath it.
 */
export function TayaHero({ slug }: { slug: string }) {
  const { restaurants, goBackToRestaurants, openReserve, scrollToId } = useSite();
  const story = useReveal<HTMLParagraphElement>('up');
  const restaurant = restaurants.find((r) => r.slug === slug);
  const contact = contactFor(restaurant?.dest);

  return (
    <>
      <section className="taya-hero">
        <div className="shell-wide taya-hero-inner">
          <div className="taya-hero-copy">
            <button type="button" className="taya-back" data-intro="0" onClick={goBackToRestaurants}>
              <span aria-hidden="true">←</span>ALL RESTAURANTS
            </button>

            <div className="taya-kicker" data-intro="1">
              A Wellness Dining Home · Furama Resort Danang
            </div>

            <h1 className="taya-title">
              <span className="line-mask">
                <span data-intro="2" data-intro-kind="line">
                  Tàya House
                </span>
              </span>
            </h1>

            <div className="taya-story-label" data-intro="3">
              Brand Story
            </div>
            <p className="taya-story" data-intro="4">
              Beneath the Lagoon Garden, the resort’s “Green Oasis in the Heart of the City” tells a
              journey from Mường Khụ, a land of stones, to Danang by the sea — with cooking classes
              led by Cơ Tu chef A Rất Thị Hép.
            </p>

            <div className="taya-actions" data-intro="5">
              <button
                type="button"
                className="btn-slab taya-reserve"
                onClick={() => openReserve({ restaurant: restaurant?.id ?? slug })}
              >
                RESERVE A TABLE<span className="arrow">→</span>
              </button>
              {contact.tel && (
                <a href={`tel:${contact.tel}`} className="taya-link">
                  CALL
                </a>
              )}
              {contact.map && (
                <a href={contact.map} target="_blank" rel="noopener" className="taya-link">
                  MAP
                </a>
              )}
              <button
                type="button"
                className="taya-link"
                onClick={() => openMenuPdf(() => scrollToId('dishes'))}
              >
                MENU
              </button>
            </div>
          </div>

          <div className="taya-portrait" data-intro="1" data-intro-kind="clip">
            <img src="/assets/taya-hero.jpg" alt="Tàya House" className="fill" fetchPriority="high" />
          </div>
        </div>

        <button type="button" className="taya-back-float" onClick={goBackToRestaurants}>
          <span aria-hidden="true">←</span>BACK
        </button>

        <div className="taya-hero-scrim" aria-hidden="true" />

        <div className="taya-hero-mobile-copy">
          <div className="taya-kicker-m" data-intro="0">
            A Wellness Dining Home · Furama Resort Danang
          </div>
          <div className="taya-title-m">
            <span className="line-mask">
              <span data-intro="1" data-intro-kind="line">
                Tàya House
              </span>
            </span>
          </div>
        </div>
      </section>

      <section className="taya-story-mobile">
        <div className="taya-story-label">Brand Story</div>
        <p ref={story} data-reveal="up" className="taya-story-m">
          Beneath the Lagoon Garden, the resort’s “Green Oasis in the Heart of the City” tells a
          journey from Mường Khụ, a land of stones, to Danang by the sea — with cooking classes led
          by Cơ Tu chef A Rất Thị Hép.
        </p>
      </section>
    </>
  );
}
