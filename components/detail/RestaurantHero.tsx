'use client';

import type { RestaurantDetail } from '@/lib/content/types';
import { useSite } from '@/components/site/SiteProvider';
import { CmsImage } from '@/components/ui/CmsImage';
import { openMenu } from '@/components/site/MobileBar';
import { useReveal } from '@/lib/motion';

/*
 * One hero across breakpoints: desktop shows the two-column split with the
 * brand story beside a tall portrait, while a phone collapses to a full-bleed
 * image with an overlaid back button and the story beneath it.
 *
 * Every restaurant with a page uses it (spec §6.3 item 1, §6.4); the class
 * names keep the taya-* prefix of the one page it was drawn for, so the
 * stylesheet and the visual baselines stay as they were. A field the
 * restaurant does not have (kicker, story) hides its element.
 */
export function RestaurantHero({ detail }: { detail: RestaurantDetail }) {
  const { goBackToRestaurants, openReserve, scrollToId, strings } = useSite();
  const story = useReveal<HTMLParagraphElement>('up');
  // The restaurant's own label, else the one every page shares (detail.story_label, /admin/restaurants).
  const storyLabel = detail.storyLabel ?? strings['detail.story_label'];
  const menu = detail.menu;

  return (
    <>
      <section className="taya-hero">
        <div className="shell-wide taya-hero-inner">
          <div className="taya-hero-copy">
            <button type="button" className="taya-back" data-intro="0" onClick={goBackToRestaurants}>
              <span aria-hidden="true">←</span>
              {strings['detail.back_all']}
            </button>

            {detail.kicker && (
              <div className="taya-kicker" data-intro="1">
                {detail.kicker}
              </div>
            )}

            <h1 className="taya-title">
              <span className="line-mask">
                <span data-intro="2" data-intro-kind="line">
                  {detail.name}
                </span>
              </span>
            </h1>

            {detail.story && (
              <>
                <div className="taya-story-label" data-intro="3">
                  {storyLabel}
                </div>
                <p className="taya-story" data-intro="4">
                  {detail.story}
                </p>
              </>
            )}

            <div className="taya-actions" data-intro="5">
              {/* restaurants.booking_enabled off: no RESERVE (spec §5.2). */}
              {detail.bookingEnabled && (
                <button
                  type="button"
                  className="btn-slab taya-reserve"
                  onClick={() => openReserve({ restaurant: detail.id })}
                >
                  RESERVE A TABLE<span className="arrow">→</span>
                </button>
              )}
              {/* The restaurant's own, else its destination's; neither hides the button (spec §6.4). */}
              {detail.phone && (
                <a href={`tel:${detail.phone.tel}`} className="taya-link">
                  {strings['detail.call']}
                </a>
              )}
              {detail.map && (
                <a href={detail.map} target="_blank" rel="noopener" className="taya-link">
                  {strings['detail.map']}
                </a>
              )}
              {menu && (
                <button type="button" className="taya-link" onClick={() => openMenu(menu, () => scrollToId('dishes'))}>
                  {strings['detail.menu']}
                </button>
              )}
            </div>
          </div>

          <div className="taya-portrait" data-intro="1" data-intro-kind="clip">
            {/* The page's LCP image: preloaded, fetched first, optimised by next/image (CmsImage). */}
            <CmsImage
              media={detail.portrait}
              width={detail.portrait.width}
              height={detail.portrait.height}
              sizes="(max-width: 759px) 100vw, 45vw"
              className="fill"
              preload
              fetchPriority="high"
            />
          </div>
        </div>

        <button type="button" className="taya-back-float" onClick={goBackToRestaurants}>
          <span aria-hidden="true">←</span>
          {strings['detail.back']}
        </button>

        <div className="taya-hero-scrim" aria-hidden="true" />

        <div className="taya-hero-mobile-copy">
          {detail.kicker && (
            <div className="taya-kicker-m" data-intro="0">
              {detail.kicker}
            </div>
          )}
          <div className="taya-title-m">
            <span className="line-mask">
              <span data-intro="1" data-intro-kind="line">
                {detail.name}
              </span>
            </span>
          </div>
        </div>
      </section>

      {detail.story && (
        <section className="taya-story-mobile">
          <div className="taya-story-label">{storyLabel}</div>
          <p ref={story} data-reveal="up" className="taya-story-m">
            {detail.story}
          </p>
        </section>
      )}
    </>
  );
}
