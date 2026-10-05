import 'server-only';
import { SOCIAL_PLATFORMS, type SocialPlatform } from '@/lib/content/footer';
import type { Db } from '@/lib/server/booking/rules';
import { makeListEditor, type ListFailure } from './list-editor';
import { orderToken, readItems, snapshotToken, type ItemDef, type ItemSnapshot } from './snapshot';

/*
 * The footer's social links (spec §7.2 content/contact, §6.5 "Social links
 * tối đa 6"): a platform and its https address each, in the footer's order.
 * No translations: the footer prints the platform's registry label
 * (social.<platform>, R11, L7-15), edited on the same screen. Every write
 * goes through makeListEditor: at most 6 shown (R4), the platform one of
 * migration 008's (CHECK social_links.platform), the address https (CHECK;
 * the form's schema says so first). visible_locales (which languages show the
 * link; NULL: every one) is no field of the form: a save leaves it as it is,
 * a restore puts back the version's (phase 8 edits it, L8-6).
 */

export const SOCIAL_LINK: ItemDef = {
  entityType: 'social_links',
  table: 'social_links',
  idType: 'bigint',
  columns: ['platform', 'href', 'visible_locales', 'sort_order', 'is_published'],
  tables: ['social_links'],
};

export type SocialInput = { platform: SocialPlatform; href: string; isPublished: boolean };

/** How the admin names each platform (the guest's label is its social.<platform> key). */
export const SOCIAL_NAMES: Record<SocialPlatform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  zalo: 'Zalo',
  x: 'X (Twitter)',
  tripadvisor: 'Tripadvisor',
  wechat: 'WeChat',
  kakao: 'KakaoTalk',
  line: 'LINE',
};

export const SOCIAL_PLATFORM_INVALID = 'Chọn một mạng xã hội trong danh sách.';
export const SOCIAL_HREF_INVALID = 'Đường dẫn phải bắt đầu bằng https://';

const socials = makeListEditor<SocialInput>(SOCIAL_LINK, {
  listKey: 'social_links',
  limit: 'socials',
  toRow: (input) => ({ platform: input.platform, href: input.href, is_published: input.isPublished }),
  // Today's rules, on a save and on a restore alike (code rule 5); the CHECKs stay the last guard.
  async validate(_client, { row }): Promise<ListFailure | null> {
    if (!(SOCIAL_PLATFORMS as readonly unknown[]).includes(row.platform)) return { ok: false, code: 'invalid', fieldErrors: { platform: [SOCIAL_PLATFORM_INVALID] } };
    if (typeof row.href !== 'string' || !/^https:\/\/\S+$/.test(row.href)) return { ok: false, code: 'invalid', fieldErrors: { href: [SOCIAL_HREF_INVALID] } };
    return null;
  },
});

export const createSocialLink = socials.create;
export const updateSocialLink = socials.update;
export const setSocialLinkPublished = socials.setPublished;
export const reorderSocialLinks = socials.reorder;
export const deleteSocialLink = socials.remove;
export const restoreSocialLink = socials.restore;
export const restoreSocialLinkOrder = socials.restoreOrder;

/** The form's values for one link, from its snapshot. */
export function socialValues(s: ItemSnapshot): SocialInput {
  return { platform: s.row.platform as SocialPlatform, href: String(s.row.href), isPublished: Boolean(s.row.is_published) };
}

export type SocialListItem = { id: string; name: string; isPublished: boolean; token: string; values: SocialInput };

/** Every link in the footer's order, with its token and form values, and the list's token (the ids in order). */
export async function listSocialLinksAdmin(db: Db): Promise<{ items: SocialListItem[]; token: string }> {
  const items = (await readItems(db, SOCIAL_LINK)).map((s) => {
    const values = socialValues(s);
    return { id: String(s.row.id), name: SOCIAL_NAMES[values.platform] ?? values.platform, isPublished: values.isPublished, token: snapshotToken(s), values };
  });
  return { items, token: orderToken({ v: 1, order: items.map((i) => ({ id: i.id, sort_order: 0 })) }) };
}
