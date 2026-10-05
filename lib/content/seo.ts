import type { Metadata } from 'next';
import { formatMessage } from '@/lib/i18n/format';
import type { Copy } from '@/lib/i18n/registry';
import type { Media } from './types';

/*
 * The guest site's metadata from the SEO screen's words (seo.*, spec §7.2
 * content/seo) and share picture (site_settings.og_image_id). Pure, so a
 * test holds the fallbacks (phase-6 L7-13): a page that sets its own
 * openGraph replaces the layout's whole object (generate-metadata.md,
 * "Merging"), so every page below says its own title, description and
 * picture, and one without its own falls back to the SEO screen's, on
 * purpose, never by inheriting the home page's share text.
 */

export type SeoCopy = Copy<'seo'>;

/** og:image of a library file. A Blob file's URL is absolute; a static one's path is resolved by Next against the deployment's address. */
function images(image: Media | null): NonNullable<Metadata['openGraph']>['images'] | undefined {
  return image ? [{ url: image.url, width: image.width, height: image.height, alt: image.alt }] : undefined;
}

function page(title: string, description: string, image: Media | null): Metadata {
  const shared = images(image);
  return { title, description, openGraph: { title, description, type: 'website', ...(shared ? { images: shared } : {}) } };
}

/** "{page} — Furama Cuisine": a page's tab title from seo.page_title. */
export function pageTitle(t: Pick<SeoCopy, 'seo.page_title'>, name: string, locale: string): string {
  return formatMessage(t['seo.page_title'], { page: name }, locale);
}

/** The home page and every page that says nothing of its own: the SEO screen's title, description, share text and picture. */
export function homeMetadata(t: SeoCopy, share: Media | null): Metadata {
  const shared = images(share);
  return {
    title: t['seo.home_title'],
    description: t['seo.home_description'],
    openGraph: { title: t['seo.og_title'], description: t['seo.og_description'], type: 'website', ...(shared ? { images: shared } : {}) },
  };
}

/** A page with its own title and description (the policy page): its share text is its own, its picture the SEO screen's. */
export function ownPageMetadata(title: string, description: string, share: Media | null): Metadata {
  return page(title, description, share);
}

/**
 * A restaurant's page (L7-13): its SEO title, else "{name} — Furama Cuisine";
 * its SEO description, else the SEO screen's; its own share picture, else the
 * SEO screen's. Its share text is always its own title and description.
 */
export function restaurantMetadata(
  t: SeoCopy,
  detail: { name: string; seo: { title: string | null; description: string | null; image: Media | null } },
  share: Media | null,
  locale: string,
): Metadata {
  const title = detail.seo.title ?? pageTitle(t, detail.name, locale);
  return page(title, detail.seo.description ?? t['seo.home_description'], detail.seo.image ?? share);
}

/** A page that does not exist (an unknown restaurant): its own tab title, never indexed. */
export function notFoundMetadata(t: Pick<SeoCopy, 'seo.not_found_title'>): Metadata {
  return { title: t['seo.not_found_title'], robots: { index: false } };
}
