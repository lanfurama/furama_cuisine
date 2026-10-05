import type { Phone } from './types';

/*
 * The footer's pieces that are rules, not markup, so a test holds them
 * (phase-6 ledger L7-7, L7-15). Pure: the footer is a client component.
 */

/**
 * The platforms a social link may name: the CHECK on social_links.platform
 * (migration 008), in its order. Each prints as its registry key
 * social.<platform> (R11, L7-15), so no platform falls back to code text.
 */
export const SOCIAL_PLATFORMS = ['facebook', 'instagram', 'youtube', 'tiktok', 'zalo', 'x', 'tripadvisor', 'wechat', 'kakao', 'line'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/** The registry key of a platform's footer label. */
export const socialKey = (platform: SocialPlatform) => `social.${platform}` as const;

/**
 * A footer venue line's text before its phone link: "name · address · " when
 * a phone follows, else "name · address", joining only the parts it has, so
 * a venue saved without a name or an address never starts or ends with a
 * stray " · " (L7-7; the destinations screen also requires a venue's EN name, R28).
 */
export function footerVenueText(venue: { name: string | null; address: string | null; phone: Phone | null }): string {
  const line = [venue.name, venue.address].filter((p): p is string => !!p && p.trim() !== '').join(' · ');
  return venue.phone && line ? `${line} · ` : line;
}
