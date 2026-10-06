import 'server-only';
import { sourceHash, translationState, type TranslationState } from '@/lib/i18n/source-hash';
import type { Db } from '@/lib/server/booking/rules';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import { readItems, type I18nRow, type ItemDef, type ItemSnapshot } from './snapshot';

/*
 * The language tabs of the content forms (phase 8, spec §7.3, R8-5): every
 * language in the table, the default one first, then the site's order; a
 * language that is off is a tab too ("đang tắt"), since a language is
 * translated before it is turned on.
 */

export type FormLocale = { code: string; label: string; isDefault: boolean; isEnabled: boolean };

export async function formLocales(db: Db): Promise<FormLocale[]> {
  const { rows } = await db.query<{ code: string; short_label: string; is_default: boolean; is_enabled: boolean }>(
    'SELECT code, short_label, is_default, is_enabled FROM locales ORDER BY is_default DESC, sort_order, code',
  );
  return rows.map((r) => ({
    code: r.code,
    label: r.is_enabled ? r.short_label : `${r.short_label} (đang tắt)`,
    isDefault: r.is_default,
    isEnabled: r.is_enabled,
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
export async function pickerLocales(db: Db): Promise<{ code: string; name: string; isEnabled: boolean; isDefault: boolean }[]> {
  const { rows } = await db.query<{ code: string; native_name: string; is_default: boolean; is_enabled: boolean }>(
    'SELECT code, native_name, is_default, is_enabled FROM locales ORDER BY is_default DESC, sort_order, code',
  );
  return rows.map((r) => ({ code: r.code, name: r.native_name, isEnabled: r.is_enabled, isDefault: r.is_default }));
}

/** The language a screen's ?lang= asks for, when the table has it; else the default one. */
export function screenLocale(locales: readonly { code: string; isDefault: boolean }[], asked: string | string[] | undefined): string {
  const code = typeof asked === 'string' ? asked : undefined;
  return locales.find((l) => l.code === code)?.code ?? locales.find((l) => l.isDefault)?.code ?? DEFAULT_LOCALE;
}
