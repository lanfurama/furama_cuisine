'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { homeSections } from '@/lib/content/home-sections';
import type { HeroSlide } from '@/lib/content/types';
import { formatMessage } from '@/lib/i18n/format';
import type { Copy } from '@/lib/i18n/registry';
import { useSite } from '@/components/site/SiteProvider';
import { CmsImage, cmsPictureProps } from '@/components/ui/CmsImage';
import { SplitWords } from '@/components/ui/SplitWords';
import { readMotionLevel } from '@/lib/motion';

/** The hero's headline, a line each (registry hero.title_*, spec §7.2 content/hero). */
const titleOf = (copy: Copy<'hero'>) => [copy['hero.title_1'], copy['hero.title_2'], copy['hero.title_3']] as const;

/**
 * The home page's <h1> when it has no hero (switched off, or no slide with a
 * picture: homeSections). The hero holds the page's only <h1>, and without it
 * the page would have none, so this names the page with the hero's own words
 * (the same keys, L7-16), visually hidden.
 */
export function HeroHeading({ copy }: { copy: Copy<'hero'> }) {
  return <h1 className="sr-only">{titleOf(copy).join(' ')}</h1>;
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
export function Hero({ slides, copy }: { slides: HeroSlide[]; copy: Copy<'hero'> }) {
  const { site, open, overlay, scrollToId, locale } = useSite();
  const TITLE = titleOf(copy);
  const [slide, setSlide] = useState(0);
  // The slide being wiped over stays whole underneath until the new one covers it.
  const [prev, setPrev] = useState<number | null>(null);
  const current = useRef(0);
  const go = useCallback((next: (s: number) => number) => {
    const from = current.current;
    const to = next(from);
    if (to === from) return;
    current.current = to;
    setPrev(from);
    setSlide(to);
  }, []);
  const count = slides.length;
  const autoplayMs = site.settings.heroAutoplayMs;
  const shown = homeSections(site.sections);

  /* Slideshow: desktop only, paused behind an overlay or a hidden tab. It lives
     in the hero, so it stops whenever the home page is not on screen. */
  useEffect(() => {
    if (overlay || count < 2 || !readMotionLevel()) return;
    const timer = window.setInterval(() => {
      if (document.hidden || window.innerWidth < 760) return;
      go((s) => (s + 1) % count);
    }, autoplayMs);
    return () => window.clearInterval(timer);
  }, [autoplayMs, count, go, overlay]);

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <section id="top" className="hero" style={{ ['--hero-ms' as string]: `${autoplayMs}ms` }}>
      <div className="hero-slides">
        {slides.map((s, i) => (
          <div
            key={s.id}
            className="hero-slide"
            data-active={i === slide}
            data-prev={i === prev && i !== slide ? true : undefined}
            data-wipe={i === slide && prev !== null ? true : undefined}
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
            {copy['hero.kicker']}
          </div>

          {/* Each word rises on its own (SplitWords); the lines still read as one heading. */}
          <h1 className="hero-title">
            <span className="hero-line">
              <SplitWords text={TITLE[0]} intro={1} />
            </span>{' '}
            <span className="hero-line hero-title-mid">
              <SplitWords text={TITLE[1]} intro={2} />
            </span>{' '}
            <span className="hero-line hero-line-accent">
              <SplitWords text={TITLE[2]} intro={3} />
            </span>
          </h1>

          <p className="hero-lede" data-intro="4">
            {copy['hero.lede']}
          </p>

          <div className="hero-actions" data-intro="5">
            <button type="button" className="btn-slab hero-explore" data-magnetic="" onClick={() => scrollToId('restaurants')}>
              {copy['hero.cta_explore']}
              <span className="hero-arrow">→</span>
            </button>

            {shown.has('film') && (
              <button type="button" className="hero-film" data-magnetic="" onClick={() => open('film')}>
                <span className="hero-play">
                  <span className="hero-play-tri" />
                </span>
                {copy['hero.cta_film']}
              </button>
            )}

            {shown.has('finder') && (
              <button type="button" className="hero-find" onClick={() => open('sheet')}>
                {copy['hero.cta_find']}
                <span>→</span>
              </button>
            )}
          </div>

          {count > 1 && (
            <div className="hero-dots" data-intro="6">
              <span className="hero-count" aria-hidden="true">
                <span className="hero-count-now">{pad(slide + 1)}</span>
                <span className="hero-count-of">{pad(count)}</span>
              </span>
              {slides.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  aria-label={formatMessage(copy['hero.slide_aria'], { n: i + 1 }, locale)}
                  aria-current={i === slide}
                  onClick={() => go(() => i)}
                  className="hero-dot"
                >
                  {/* The live dot fills over the slide's time (--hero-ms), like a progress bar. */}
                  <span data-active={i === slide} data-run={i === slide && !overlay ? true : undefined} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* A drop of light down a hairline: there is more below. */}
        <span className="hero-scroll" aria-hidden="true">
          <span />
        </span>
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
