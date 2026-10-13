import type { Script } from './scripts';

/*
 * The languages an Admin may add on /admin/locales (spec §8 step 1: "chọn
 * ngôn ngữ trong danh sách có sẵn"). Configuration, not UI text: each name is
 * the language's own, as the switcher shows it. Only scripts with fonts
 * (SCRIPTS); no right-to-left language (spec §2). The URL code is lower case
 * (LOCALE_CODE_RE), bcp47 its BCP 47 spelling (toBcp47 of the code).
 */
export type CatalogLanguage = { code: string; /** The language's name in English (the AI prompts). */ english: string; bcp47: string; nativeName: string; shortLabel: string; script: Script };

export const LANGUAGE_CATALOG: readonly CatalogLanguage[] = [
  { code: 'en', english: 'English', bcp47: 'en', nativeName: 'English', shortLabel: 'EN', script: 'latin' },
  { code: 'vi', english: 'Vietnamese', bcp47: 'vi', nativeName: 'Tiếng Việt', shortLabel: 'VI', script: 'vietnamese' },
  { code: 'ko', english: 'Korean', bcp47: 'ko', nativeName: '한국어', shortLabel: 'KO', script: 'hangul' },
  { code: 'zh-hans', english: 'Simplified Chinese', bcp47: 'zh-Hans', nativeName: '简体中文', shortLabel: '中文', script: 'han-simplified' },
  { code: 'ja', english: 'Japanese', bcp47: 'ja', nativeName: '日本語', shortLabel: 'JA', script: 'japanese' },
  { code: 'fr', english: 'French', bcp47: 'fr', nativeName: 'Français', shortLabel: 'FR', script: 'latin' },
  { code: 'de', english: 'German', bcp47: 'de', nativeName: 'Deutsch', shortLabel: 'DE', script: 'latin' },
  { code: 'es', english: 'Spanish', bcp47: 'es', nativeName: 'Español', shortLabel: 'ES', script: 'latin' },
  { code: 'it', english: 'Italian', bcp47: 'it', nativeName: 'Italiano', shortLabel: 'IT', script: 'latin' },
  { code: 'nl', english: 'Dutch', bcp47: 'nl', nativeName: 'Nederlands', shortLabel: 'NL', script: 'latin' },
  { code: 'pt-br', english: 'Brazilian Portuguese', bcp47: 'pt-BR', nativeName: 'Português (Brasil)', shortLabel: 'PT', script: 'latin' },
  { code: 'id', english: 'Indonesian', bcp47: 'id', nativeName: 'Bahasa Indonesia', shortLabel: 'ID', script: 'latin' },
  { code: 'ms', english: 'Malay', bcp47: 'ms', nativeName: 'Bahasa Melayu', shortLabel: 'MS', script: 'latin' },
];

/** The catalogue's entry for a URL code, if any. */
export const catalogLanguage = (code: string): CatalogLanguage | undefined => LANGUAGE_CATALOG.find((l) => l.code === code);

/** A language's English name for a prompt; a code outside the catalogue stands for itself. */
export const englishName = (code: string): string => catalogLanguage(code)?.english ?? code;
