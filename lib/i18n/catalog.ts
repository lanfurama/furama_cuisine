import type { Script } from './scripts';

/*
 * The languages an Admin may add on /admin/locales (spec §8 step 1: "chọn
 * ngôn ngữ trong danh sách có sẵn"). Configuration, not UI text: each name is
 * the language's own, as the switcher shows it. Only scripts with fonts
 * (SCRIPTS); no right-to-left language (spec §2). The URL code is lower case
 * (LOCALE_CODE_RE), bcp47 its BCP 47 spelling (toBcp47 of the code).
 */
export type CatalogLanguage = { code: string; bcp47: string; nativeName: string; shortLabel: string; script: Script };

export const LANGUAGE_CATALOG: readonly CatalogLanguage[] = [
  { code: 'en', bcp47: 'en', nativeName: 'English', shortLabel: 'EN', script: 'latin' },
  { code: 'vi', bcp47: 'vi', nativeName: 'Tiếng Việt', shortLabel: 'VI', script: 'vietnamese' },
  { code: 'ko', bcp47: 'ko', nativeName: '한국어', shortLabel: 'KO', script: 'hangul' },
  { code: 'zh-hans', bcp47: 'zh-Hans', nativeName: '简体中文', shortLabel: '中文', script: 'han-simplified' },
  { code: 'ja', bcp47: 'ja', nativeName: '日本語', shortLabel: 'JA', script: 'japanese' },
  { code: 'fr', bcp47: 'fr', nativeName: 'Français', shortLabel: 'FR', script: 'latin' },
  { code: 'de', bcp47: 'de', nativeName: 'Deutsch', shortLabel: 'DE', script: 'latin' },
  { code: 'es', bcp47: 'es', nativeName: 'Español', shortLabel: 'ES', script: 'latin' },
  { code: 'it', bcp47: 'it', nativeName: 'Italiano', shortLabel: 'IT', script: 'latin' },
  { code: 'nl', bcp47: 'nl', nativeName: 'Nederlands', shortLabel: 'NL', script: 'latin' },
  { code: 'pt-br', bcp47: 'pt-BR', nativeName: 'Português (Brasil)', shortLabel: 'PT', script: 'latin' },
  { code: 'id', bcp47: 'id', nativeName: 'Bahasa Indonesia', shortLabel: 'ID', script: 'latin' },
  { code: 'ms', bcp47: 'ms', nativeName: 'Bahasa Melayu', shortLabel: 'MS', script: 'latin' },
];

/** The catalogue's entry for a URL code, if any. */
export const catalogLanguage = (code: string): CatalogLanguage | undefined => LANGUAGE_CATALOG.find((l) => l.code === code);
