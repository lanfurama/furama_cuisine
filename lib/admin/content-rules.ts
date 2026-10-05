import { parseFilmUrl } from '@/lib/media/film';

/*
 * The content rules SQL cannot hold (spec §6.5; phase-6 ledger L7-14): layout
 * limits and the warn/refuse lengths. Pure functions, so the editors' forms
 * (as hints) and the save flow (as the rule, on a save and on a restore: code
 * rule 5) share one definition. Messages are the admin's Vietnamese.
 */

/** Spec §6.5. `max` refuses a save; `min`, `warnBelow` and `multipleOf` only warn. Counts are of shown (published) items (R4). */
export const LIMITS = {
  heroSlides: { min: 1, max: 5 },
  destinations: { min: 2, max: 5 },
  stories: { min: 0, max: 4 },
  offers: { min: 0, max: 6, multipleOf: 3 },
  experiences: { min: 1, max: 5 },
  cuisines: { min: 0, max: 10 },
  highlights: { min: 0, max: 5, warnBelow: 2 },
  navItems: { min: 0, max: 6 },
  socials: { min: 0, max: 6 },
} as const satisfies Record<string, { min: number; max: number; warnBelow?: number; multipleOf?: number }>;

export type LimitKey = keyof typeof LIMITS;

/** Spec §6.5 lengths that warn before the column's or registry's maximum refuses. */
export const LENGTHS = {
  /** Menu label: longer than 14 warns, longer than 18 is refused (nav_item_i18n CHECK ≤ 18). */
  navLabel: { warn: 14, max: 18 },
  /** A restaurant's name on its detail page: longer than 24 warns. */
  restaurantName: { warn: 24, max: 60 },
} as const;

/** A translation this much longer than its EN warns (spec §6.5 note). */
export const TRANSLATION_STRETCH = 1.3;

/** Characters as a guest sees them (code points, not UTF-16 units), like Postgres char_length. */
export function charCount(value: string): number {
  return [...value].length;
}

export type LengthCheck = { level: 'ok' | 'warn' | 'error'; count: number };

/** Where `value` stands against a warn length and a hard maximum. */
export function checkLength(value: string, max: number, warn?: number): LengthCheck {
  const count = charCount(value);
  if (count > max) return { level: 'error', count };
  if (warn !== undefined && count > warn) return { level: 'warn', count };
  return { level: 'ok', count };
}

/**
 * The refusal for a list that would show more than its limit, or null. `shown`
 * is the count after the change. Only `max` refuses: fewer than `min` hides a
 * section (offers, highlights) or is the editor's call while they work, and the
 * screens say so as a warning.
 */
export function limitError(key: LimitKey, shown: number): string | null {
  const { max } = LIMITS[key];
  return shown > max ? `Tối đa ${max} mục được hiện (giới hạn bố cục). Hãy ẩn một mục khác trước.` : null;
}

/** Non-blocking notes about a list's count (spec §6.5 "nên là bội số của 3", "ít hơn 2 điểm nổi bật"). */
export function limitWarnings(key: LimitKey, shown: number): string[] {
  const limit: { min: number; max: number; warnBelow?: number; multipleOf?: number } = LIMITS[key];
  const out: string[] = [];
  if (shown < limit.min) out.push(`Cần ít nhất ${limit.min} mục được hiện.`);
  if (limit.warnBelow !== undefined && shown > 0 && shown < limit.warnBelow) out.push(`Nên có ít nhất ${limit.warnBelow} mục.`);
  if (limit.multipleOf && shown > 0 && shown % limit.multipleOf !== 0) {
    out.push(`Đang hiện ${shown} mục; bố cục đẹp nhất khi số mục là bội số của ${limit.multipleOf}.`);
  }
  if (key === 'offers' && shown === 0) out.push('Không có ưu đãi nào được hiện: trang chủ ẩn section Offers.');
  if (key === 'highlights' && shown === 0) out.push('Không có điểm nổi bật nào: trang chi tiết ẩn phần này.');
  return out;
}

/** Spec §5.2 site_settings.hero_autoplay_ms (CHECK 3000–20000): how long each hero slide shows on desktop. */
export const HERO_AUTOPLAY_MS = { min: 3000, max: 20000 } as const;

/** Spec §6.5 "Slide 1 bắt buộc có ảnh crop cho mobile": phones show only the first slide the guest sees. */
export const FIRST_SLIDE_NEEDS_CROP = 'Slide đầu tiên đang hiện cần ảnh cắt cho điện thoại. Chọn ảnh mobile cho slide đó, hoặc đưa slide có ảnh mobile lên đầu.';

/** The sections that carry a picture or a link (spec §7.2 content/sections; 008 sections.image_id / link_url). */
export const SECTION_PARTS: Record<string, { image?: string; link?: string }> = {
  film: { image: 'Ảnh poster', link: 'Link video (YouTube hoặc Vimeo)' },
  experiences: { image: 'Ảnh bên cạnh danh sách' },
  heritage: { image: 'Ảnh nền', link: 'Link nút “Our story”' },
};

/**
 * A section's version, as a save or a restore would write it (code rule 5):
 * the restaurants section never hides (spec §6.5; CHECK
 * sections_restaurants_visible), the film's link names one YouTube or Vimeo
 * video (lib/media/film.ts; stricter than 008's sections_film_video, which
 * only checks the host), and any other link is https.
 */
export function sectionErrors(key: string, version: { visible: boolean; link: string | null }): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  if (key === 'restaurants' && !version.visible) errors.isVisible = ['Section Nhà hàng luôn hiện: thẻ nhà hàng, ô tìm và thanh tab đều dẫn tới nó.'];
  if (version.link !== null) {
    if (key === 'film' && !parseFilmUrl(version.link)) {
      errors.link = ['Dán link một video YouTube hoặc Vimeo (ví dụ https://youtu.be/… hoặc https://vimeo.com/…).'];
    } else if (key !== 'film' && !/^https:\/\/\S+$/.test(version.link)) {
      errors.link = ['Đường dẫn phải bắt đầu bằng https://'];
    }
  }
  return errors;
}

export type DetailPageInput = {
  hasDetailPage: boolean;
  detailImageId: string | null;
  storyEn: string | null;
};

/**
 * Spec §6.4: switching the page on needs the portrait and the EN story. The
 * restaurants_detail_image CHECK holds the first in SQL; the story lives in
 * restaurant_i18n, which no CHECK on restaurants can see.
 */
export function detailPageErrors(input: DetailPageInput): Record<string, string[]> {
  if (!input.hasDetailPage) return {};
  const errors: Record<string, string[]> = {};
  if (!input.detailImageId) errors.detailImageId = ['Trang chi tiết cần ảnh chân dung.'];
  if (!input.storyEn?.trim()) errors.story = ['Trang chi tiết cần câu chuyện tiếng Anh.'];
  return errors;
}

export type DetailPageWarningInput = {
  hasDetailPage: boolean;
  name: string;
  shownHighlights: number;
  /** The restaurant's or its destination's (spec §6.4 fallbacks); false hides that button. */
  hasPhone: boolean;
  hasMap: boolean;
  hasMenu: boolean;
};

/** Spec §6.4/§6.5 warnings for a restaurant whose page is on. */
export function detailPageWarnings(input: DetailPageWarningInput): string[] {
  if (!input.hasDetailPage) return [];
  const out: string[] = [];
  if (input.shownHighlights < LIMITS.highlights.warnBelow) out.push(`Trang chi tiết chỉ có ${input.shownHighlights} điểm nổi bật (nên có ít nhất 2).`);
  const hidden = [!input.hasPhone && 'CALL', !input.hasMap && 'MAP', !input.hasMenu && 'MENU'].filter(Boolean);
  if (hidden.length) out.push(`Nút ${hidden.join(', ')} bị ẩn vì chưa có số điện thoại, bản đồ hoặc thực đơn.`);
  if (checkLength(input.name, LENGTHS.restaurantName.max, LENGTHS.restaurantName.warn).level !== 'ok') {
    out.push(`Tên dài hơn ${LENGTHS.restaurantName.warn} ký tự có thể xuống dòng ở trang chi tiết.`);
  }
  return out;
}

/**
 * R19: the card's EN alt was seeded as a copy of the restaurant's name. A
 * rename carries it along while it still equals the old name; an alt an
 * editor wrote by hand stays. The new alt, or null for "leave it".
 */
export function followRename(alt: string | null, oldName: string, newName: string): string | null {
  if (oldName === newName || alt === null) return null;
  return alt.trim() === oldName.trim() ? newName : null;
}
