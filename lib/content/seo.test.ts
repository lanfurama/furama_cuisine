import { describe, expect, it } from 'vitest';
import { REGISTRY, sectionKeys } from '@/lib/i18n/registry';
import { homeMetadata, notFoundMetadata, ownPageMetadata, pageTitle, restaurantMetadata, type SeoCopy } from './seo';

/* The registry's defaults: what the site printed before plan 7B task B7, word for word. */
const T = Object.fromEntries(sectionKeys('seo').map((k) => [k, REGISTRY[k].en])) as SeoCopy;
const SHARE = { url: '/assets/hero-beach.jpg', alt: 'The beach at Furama Resort Danang', width: 1600, height: 1000 };
const OWN = { url: 'https://store.public.blob.vercel-storage.com/production/media/x/taya.jpg', alt: 'Tàya House', width: 1200, height: 630 };
const TAYA = { name: 'Tàya House', seo: { title: null, description: 'A wellness dining home.', image: null } };

describe('the guest site’s metadata (spec §7.2 content/seo, L7-13)', () => {
  it('the home page says what it said before, from seo.*', () => {
    expect(homeMetadata(T, null)).toEqual({
      title: 'Furama Cuisine — Many Flavours. Many Destinations.',
      description: 'From beachfront dining to vibrant city destinations – discover the restaurants, cuisines and people of Furama Cuisine in Da Nang.',
      openGraph: {
        title: 'Furama Cuisine',
        description: 'People · Culture · Great Food — dining across Furama’s Da Nang destinations.',
        type: 'website',
      },
    });
    expect(homeMetadata(T, SHARE).openGraph).toMatchObject({ images: [{ url: '/assets/hero-beach.jpg', width: 1600, height: 1000, alt: SHARE.alt }] });
  });

  it('a restaurant page shares its own title and description, never the home page’s, and falls back to the SEO screen’s picture', () => {
    expect(restaurantMetadata(T, TAYA, SHARE, 'en')).toEqual({
      title: 'Tàya House — Furama Cuisine',
      description: 'A wellness dining home.',
      openGraph: {
        title: 'Tàya House — Furama Cuisine',
        description: 'A wellness dining home.',
        type: 'website',
        images: [{ url: SHARE.url, width: 1600, height: 1000, alt: SHARE.alt }],
      },
    });
    // Its own picture wins; without a description of its own, the SEO screen's site description.
    const bare = restaurantMetadata(T, { name: 'The Fan', seo: { title: 'Steak in Da Nang', description: null, image: OWN } }, SHARE, 'en');
    expect(bare).toMatchObject({ title: 'Steak in Da Nang', description: T['seo.home_description'] });
    expect(bare.openGraph).toMatchObject({ title: 'Steak in Da Nang', images: [{ url: OWN.url }] });
    // No picture anywhere: none at all, rather than an empty list.
    expect(restaurantMetadata(T, TAYA, null, 'en').openGraph).not.toHaveProperty('images');
  });

  it('names the other pages from seo.page_title and seo.not_found_title', () => {
    expect(pageTitle(T, 'Privacy policy', 'en')).toBe('Privacy policy — Furama Cuisine');
    expect(ownPageMetadata('Privacy policy — Furama Cuisine', 'What we do with your details.', null)).toEqual({
      title: 'Privacy policy — Furama Cuisine',
      description: 'What we do with your details.',
      openGraph: { title: 'Privacy policy — Furama Cuisine', description: 'What we do with your details.', type: 'website' },
    });
    expect(notFoundMetadata(T)).toEqual({ title: 'Page not found — Furama Cuisine', robots: { index: false } });
  });
});
