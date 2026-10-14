import 'server-only';
import { sourceHash, translationState, type TranslationState } from '@/lib/i18n/source-hash';
import type { Db } from '@/db/client';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import { SITE_LOCALE_ROWS } from '@/lib/i18n/site-locales';
import { readItems, type I18nRow, type ItemDef, type ItemSnapshot } from '@/lib/server/history/snapshot';

/*
 * The language tabs of the content forms (phase 8, spec §7.3, R8-5): every
 * language of lib/i18n/site-locales.ts, the default one first, then the
 * site's order; a language that is off is a tab too ("đang tắt"), since a
 * language is translated before it is turned on.
 */

const DEFAULT_FIRST = [...SITE_LOCALE_ROWS].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));

export type FormLocale = { code: string; label: string; isDefault: boolean; isEnabled: boolean };

export async function formLocales(): Promise<FormLocale[]> {
  return DEFAULT_FIRST.map((l) => ({
    code: l.code,
    label: l.isEnabled ? l.shortLabel : `${l.shortLabel} (đang tắt)`,
    isDefault: l.isDefault,
    isEnabled: l.isEnabled,
  }));
}

/**
 * One translatable column, per language that has a row, the default one
 * always (null when it has none): what a form's tabs start with, and what its
 * save posts back for the languages it did not touch.
 */
export function localeTexts(i18n: readonly I18nRow[], column: string): Record<string, string | null> {
  return {
    [DEFAULT_LOCALE]: null,
    ...Object.fromEntries(i18n.map((r) => [r.locale, r[column] === null || r[column] === undefined ? null : String(r[column])])),
  };
}

/** Each tab's state for one item (the badge): reviewed, machine, "EN đã đổi" or missing. */
export function itemStates(def: ItemDef, s: ItemSnapshot, locales: readonly FormLocale[]): Record<string, TranslationState> {
  const columns = def.i18n?.columns ?? [];
  const byLocale = new Map(s.i18n.map((r) => [r.locale, r]));
  const fallback = locales.find((l) => l.isDefault)?.code;
  const current = sourceHash(columns, fallback ? byLocale.get(fallback) : undefined);
  return Object.fromEntries(locales.map((l) => [l.code, translationState(byLocale.get(l.code), current, l.isDefault)]));
}

/** Each item's tab states on a list screen, by id. */
export async function listStates(db: Db, def: ItemDef, locales: readonly FormLocale[]): Promise<Map<string, Record<string, TranslationState>>> {
  return new Map((await readItems(db, def)).map((s) => [String(s.row.id), itemStates(def, s, locales)]));
}

/** The languages a strings screen can edit (its LocalePicker), the default first, by their own names. */
export async function pickerLocales(): Promise<{ code: string; name: string; isEnabled: boolean; isDefault: boolean }[]> {
  return DEFAULT_FIRST.map((l) => ({ code: l.code, name: l.nativeName, isEnabled: l.isEnabled, isDefault: l.isDefault }));
}

/** The language a screen's ?lang= asks for, when it is listed; else the default one. */
export function screenLocale(locales: readonly { code: string; isDefault: boolean }[], asked: string | string[] | undefined): string {
  const code = typeof asked === 'string' ? asked : undefined;
  return locales.find((l) => l.code === code)?.code ?? locales.find((l) => l.isDefault)?.code ?? DEFAULT_LOCALE;
}
