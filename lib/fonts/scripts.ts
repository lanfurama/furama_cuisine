import type { Script } from '@/lib/i18n/scripts';

/*
 * SCRIPT_FONTS (spec §8): the stylesheet a page in a script links. Crimson Pro
 * and Be Vietnam Pro have no Hangul or Han glyphs, so a Korean, Chinese or
 * Japanese page links its Noto stylesheet, which declares the faces and sets
 * --font-script; --serif and --sans (styles/tokens.css) name it after the
 * site's own fonts, so Latin text keeps them and the rest falls back to Noto.
 *
 * The stylesheets and their files are fetched at build time into public/fonts/
 * by scripts/fetch-script-fonts.mjs (why not next/font/google: its CSS went to
 * every page). Only the guest root layout links one, and only its own script's.
 */
export const SCRIPT_FONTS: Record<Script, string | null> = {
  latin: null,
  vietnamese: null,
  hangul: '/fonts/hangul.css',
  'han-simplified': '/fonts/han-simplified.css',
  japanese: '/fonts/japanese.css',
};
