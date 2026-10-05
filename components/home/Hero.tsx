'use client';

import { useEffect, useState } from 'react';
import { homeSections } from '@/lib/content/home-sections';
import type { HeroSlide } from '@/lib/content/types';
import { useSite } from '@/components/site/SiteProvider';
import { CmsImage, cmsPictureProps } from '@/components/ui/CmsImage';
import { readMotionLevel } from '@/lib/motion';

/**
 * The hero's headline, a line each. Section copy in JSX (R2) until phase 7
 * moves it into the registry, and kept in one place for HeroHeading, which
 * says the same words when the hero is left out.
 */
const TITLE = ['Many Flavours.', 'Many Destinations.', 'One Furama Cuisine.'] as const;

/**
 * The home page's <h1> when it has no hero (switched off, or no slide with a
 * picture: homeSections). The hero holds the page's only <h1>, and without it
 * the page would have none, so this names the page with the hero's own words,
 * visually hidden. A component rather than the exported lines: a value
 * exported from a 'use client' module reaches the Server Component page as a
 * client reference, not as the strings.
 */
export function HeroHeading() {
  return <h1 className="sr-only">{TITLE.join(' ')}</h1>;
}

/*
 * One hero serves every width: the three cross-fading slides run on desktop,
 * while a phone gets a single art-directed crop, the shorter two-line headline
 * and the sheet trigger. Rendering one element keeps a single <h1> and a single
 * #top anchor instead of duplicating the section per breakpoint. The slides
 * (hero_slides) come from the page; the pace (site_settings.hero_autoplay_ms)
 * and which buttons show (the film and finder sections, homeSections) from the chrome.
 * Pictures go through next/image's optimiser (R3; components/ui/CmsImage.tsx); slide 1
 * is an art-directed <picture> of both files' optimised srcsets.
 */
export function Hero({ slides }: { slides: HeroSlide[] }) {
  const { site, open, overlay, scrollToId } = useSite();
  const [slide, setSlide] = useState(0);
  const count = slides.length;
  const autoplayMs = site.settings.heroAutoplayMs;
  const shown = homeSections(site.sections);

  /* Slideshow: desktop only, paused behind an overlay or a hidden tab. It lives
     in the hero, so it stops whenever the home page is not on screen. */
  useEffect(() => {
    if (overlay || count < 2 || !readMotionLevel()) return;
    const timer = window.setInterval(() => {
      if (document.hidden || window.innerWidth < 760) return;
      setSlide((s) => (s + 1) % count);
    }, autoplayMs);
    return () => window.clearInterval(timer);
  }, [autoplayMs, count, overlay]);

  return (
    <section id="top" className="hero">
      <div className="hero-slides">
        {slides.map((s, i) => (
          <div
            key={s.id}
            className="hero-slide"
            data-active={i === slide}
            data-parallax="0.3"
            aria-hidden={i !== slide}
          >
            <div className="hero-slide-zoom">
              {i === 0 ? (
                // Phones show only this slide, in its own crop (spec §6.5).
                <FirstSlide slide={s} />
              ) : (
                <CmsImage media={s.image} sizes="100vw" width={s.image.width} height={s.image.height} className="fill" loading="lazy" />
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="hero-scrim" aria-hidden="true" />

      <div className="hero-content" data-hero-content="1">
        <div className="hero-copy">
          <div className="hero-kicker" data-intro="0">
            People · Culture · Great Food
          </div>

          <h1 className="hero-title">
            <span className="line-mask">
              <span data-intro="1" data-intro-kind="line">
                {TITLE[0]}
              </span>
            </span>
            <span className="line-mask hero-title-mid">
              <span data-intro="2" data-intro-kind="line">
                {TITLE[1]}
              </span>
            </span>
            <span className="line-mask">
              <span data-intro="3" data-intro-kind="line">
                {TITLE[2]}
              </span>
            </span>
          </h1>

          <p className="hero-lede" data-intro="4">
            From beachfront dining to vibrant city destinations – discover the restaurants, cuisines
            and people of Furama Cuisine.
          </p>

          <div className="hero-actions" data-intro="5">
            <button type="button" className="btn-slab hero-explore" onClick={() => scrollToId('restaurants')}>
              EXPLORE OUR RESTAURANTS<span className="hero-arrow">→</span>
            </button>

            {shown.has('film') && (
              <button type="button" className="hero-film" onClick={() => open('film')}>
                <span className="hero-play">
                  <span className="hero-play-tri" />
                </span>
                WATCH THE FILM
              </button>
            )}

            {shown.has('finder') && (
              <button type="button" className="hero-find" onClick={() => open('sheet')}>
                FIND A RESTAURANT<span>→</span>
              </button>
            )}
          </div>

          {count > 1 && (
            <div className="hero-dots" data-intro="6">
              {slides.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  aria-label={`Slide ${i + 1}`}
                  aria-current={i === slide}
                  onClick={() => setSlide(i)}
                  className="hero-dot"
                >
                  <span data-active={i === slide} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** Slide 1: the art-directed <picture> (desktop file + phone crop), both optimised (components/ui/CmsImage.tsx). */
function FirstSlide({ slide }: { slide: HeroSlide }) {
  const { img, mobileSrcSet } = cmsPictureProps(slide.image, slide.mobile, { sizes: '100vw', priority: true });
  return (
    <picture>
      {mobileSrcSet && <source media="(max-width: 759px)" srcSet={mobileSrcSet} sizes="100vw" />}
      <img {...img} alt={slide.image.alt} className="fill" />
    </picture>
  );
}
