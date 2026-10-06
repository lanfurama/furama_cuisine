import 'server-only';
import { formatMessage } from '@/lib/i18n/format';
import { toBcp47 } from '@/lib/i18n/locales';

/*
 * Text the content loaders build from typed columns. They run on the server
 * only (inside 'use cache'), so the browser never formats these and server
 * and browser ICU data cannot disagree at hydration. `server-only` holds that:
 * a client component that imports this module fails the build. English
 * wording and order are the site's as of phase 5, pixel for pixel; every
 * other language takes Intl's order for its dates, which is that language's
 * own, and its number grouping. The words around them (an offer's price) are
 * registry templates each language edits on its strings screens (phase 8).
 */

/**
 * The code itself, or 'en' when Intl has no data for it. Every code the
 * locales table holds passes; a path such as /favicon.ico or /wp-login.php
 * reaches a loader with its first segment as the language, and a loader must
 * answer for it, not throw a RangeError; and a well-formed code Intl has no
 * data for ('zz') must not fall to the process's default locale, which
 * differs between machines (L8-3).
 */
function intlSafe(locale: string): string {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([toBcp47(locale)]).length > 0 ? locale : 'en';
  } catch {
    return 'en';
  }
}

/** "9 Sep 2026": day first, the short month as en-US spells it (en-GB's CLDR says "Sept"). A calendar date: formatted in UTC. */
export function formatStoryDate(iso: string, locale: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const options = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' } as const;
  const code = intlSafe(locale);
  if (code !== 'en') return new Intl.DateTimeFormat(toBcp47(code), options).format(date);
  const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')} ${part('month')} ${part('year')}`;
}

/**
 * A story card's kicker: "Restaurant News · 9 Sep 2026", the category alone
 * when the story has no date, the date alone when it has no category (L7-7:
 * never a leading or trailing separator).
 */
export function storyKicker(category: string, publishedOn: string | null, locale: string): string {
  return [category.trim(), publishedOn ? formatStoryDate(publishedOn, locale) : ''].filter(Boolean).join(' · ');
}

export type OfferPrice = { amount: string | number; currency: string; basis: 'plus_plus' | 'net' };

/** The price wording by basis: the registry's offers.price_plus_plus and offers.price_net, as the offers screen saved them. */
export type PriceTemplates = Record<OfferPrice['basis'], string>;

/**
 * "VND 888,000++ per guest", "VND 450,000 net per guest" with the registry's
 * templates ({currency} {amount}). The number alone goes through Intl: the
 * currency style would put U+00A0 after the code, and the card printed a
 * plain space.
 */
export function formatPrice(price: OfferPrice, locale: string, templates: PriceTemplates): string {
  const amount = new Intl.NumberFormat(toBcp47(intlSafe(locale))).format(Number(price.amount));
  return formatMessage(templates[price.basis], { currency: price.currency, amount }, locale);
}

/** An offer card's detail line: the price, then the schedule, joined by " · "; either may stand alone. */
export function offerDetail(price: string | null, schedule: string | null): string {
  return [price, schedule].filter(Boolean).join(' · ');
}
