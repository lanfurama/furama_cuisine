'use client';

import { useEffect, useState } from 'react';
import { HERO_SLIDES } from '@/lib/data';
import { useSite } from '@/components/site/SiteProvider';
import { readMotionLevel } from '@/lib/motion';

/*
 * One hero serves every width: the three cross-fading slides run on desktop,
 * while a phone gets a single art-directed crop, the shorter two-line headline
 * and the sheet trigger. Rendering one element keeps a single <h1> and a single
 * #top anchor instead of duplicating the section per breakpoint.
 */
export function Hero() {
  const { site, open, overlay, scrollToId } = useSite();
  const [slide, setSlide] = useState(0);
  const count = HERO_SLIDES.length;

  /* Slideshow: desktop only, paused behind an overlay or a hidden tab. It lives
     in the hero, so it stops whenever the home page is not on screen. */
  useEffect(() => {
    if (overlay || count < 2 || !readMotionLevel()) return;
    const timer = window.setInterval(() => {
      if (document.hidden || window.innerWidth < 760) return;
      setSlide((s) => (s + 1) % count);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [count, overlay]);

  return (
    <section id="top" className="hero">
      <div className="hero-slides">
        {HERO_SLIDES.map((s, i) => (
          <div
            key={s.id}
            className="hero-slide"
            data-active={i === slide}
            data-parallax="0.3"
            aria-hidden={i !== slide}
          >
            <div className="hero-slide-zoom">
              {i === 0 ? (
                <picture>
                  <source media="(max-width: 759px)" srcSet="/assets/hero-hall-m.jpg" />
                  <img
                    src={`/assets/${s.img}.jpg`}
                    alt="Dining at Furama Cuisine"
                    className="fill"
                    fetchPriority="high"
                    decoding="async"
                  />
                </picture>
              ) : (
                <img src={`/assets/${s.img}.jpg`} alt="" className="fill" loading="lazy" decoding="async" />
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
                Many Flavours.
              </span>
            </span>
            <span className="line-mask hero-title-mid">
              <span data-intro="2" data-intro-kind="line">
                Many Destinations.
              </span>
            </span>
            <span className="line-mask">
              <span data-intro="3" data-intro-kind="line">
                One Furama Cuisine.
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

            {site.sections.film.visible && (
              <button type="button" className="hero-film" onClick={() => open('film')}>
                <span className="hero-play">
                  <span className="hero-play-tri" />
                </span>
                WATCH THE FILM
              </button>
            )}

            <button type="button" className="hero-find" onClick={() => open('sheet')}>
              FIND A RESTAURANT<span>→</span>
            </button>
          </div>

          {count > 1 && (
            <div className="hero-dots" data-intro="6">
              {HERO_SLIDES.map((s, i) => (
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
