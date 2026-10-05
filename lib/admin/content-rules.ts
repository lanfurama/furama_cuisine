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
