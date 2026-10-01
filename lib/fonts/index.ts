import localFont from 'next/font/local';
import './fallbacks.css';

/*
 * The two site fonts, loaded once and shared ("Using a font definitions file",
 * node_modules/next/dist/docs/01-app/03-api-reference/02-components/font.md:944):
 * the guest root layout and app/global-not-found.tsx, which bypasses every
 * layout, both put these classes on <html>.
 *
 * Self-hosted, so a build never fetches Google Fonts. The .woff2 files are the
 * ones fonts.googleapis.com served on 2026-10-01 for the previous
 * next/font/google calls, byte for byte (OFL 1.1, licence next to them), and
 * the @font-face rules below are the ones Google served: one face per weight,
 * style and subset, Google's unicode-range for each subset, declared in
 * Google's order (vietnamese, latin-ext, latin). Keep that order: where the
 * ranges overlap, the face declared last wins.
 *
 * next/font/local has no per-file descriptors, so each subset is its own call,
 * and every call sets `font-family` to the name next/font gives the call that
 * carries the CSS variable, which is that const's name (crimsonPro,
 * beVietnamPro). Renaming either const means renaming its family in all three
 * calls. Automatic fallbacks are off: fallbacks.css has the fallback faces
 * next/font/google generated, with its metrics. Preloads match the old
 * `subsets`: every file except Crimson Pro's vietnamese ones.
 *
 * Turbopack reads these options back from a query string that it splits on
 * `&` and `=` and percent-decodes (the same parsing that broke
 * next/font/google), so no option value may contain `&`, `=` or `%`.
 */

// oxlint-disable-next-line no-unused-vars -- only its @font-face rules are needed
const crimsonProVietnamese = localFont({
  src: [
    { path: './crimson-pro/crimson-pro-vietnamese-italic.woff2', weight: '300', style: 'italic' },
    { path: './crimson-pro/crimson-pro-vietnamese-italic.woff2', weight: '400', style: 'italic' },
    { path: './crimson-pro/crimson-pro-vietnamese-italic.woff2', weight: '500', style: 'italic' },
    { path: './crimson-pro/crimson-pro-vietnamese-italic.woff2', weight: '600', style: 'italic' },
    { path: './crimson-pro/crimson-pro-vietnamese.woff2', weight: '300', style: 'normal' },
    { path: './crimson-pro/crimson-pro-vietnamese.woff2', weight: '400', style: 'normal' },
    { path: './crimson-pro/crimson-pro-vietnamese.woff2', weight: '500', style: 'normal' },
    { path: './crimson-pro/crimson-pro-vietnamese.woff2', weight: '600', style: 'normal' },
  ],
  declarations: [
    { prop: 'font-family', value: "'crimsonPro'" },
    {
      prop: 'unicode-range',
      value:
        'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
    },
  ],
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});

// oxlint-disable-next-line no-unused-vars -- only its @font-face rules are needed
const crimsonProLatinExt = localFont({
  src: [
    { path: './crimson-pro/crimson-pro-latin-ext-italic.woff2', weight: '300', style: 'italic' },
    { path: './crimson-pro/crimson-pro-latin-ext-italic.woff2', weight: '400', style: 'italic' },
    { path: './crimson-pro/crimson-pro-latin-ext-italic.woff2', weight: '500', style: 'italic' },
    { path: './crimson-pro/crimson-pro-latin-ext-italic.woff2', weight: '600', style: 'italic' },
    { path: './crimson-pro/crimson-pro-latin-ext.woff2', weight: '300', style: 'normal' },
    { path: './crimson-pro/crimson-pro-latin-ext.woff2', weight: '400', style: 'normal' },
    { path: './crimson-pro/crimson-pro-latin-ext.woff2', weight: '500', style: 'normal' },
    { path: './crimson-pro/crimson-pro-latin-ext.woff2', weight: '600', style: 'normal' },
  ],
  declarations: [
    { prop: 'font-family', value: "'crimsonPro'" },
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
    },
  ],
  display: 'swap',
  adjustFontFallback: false,
});

const crimsonPro = localFont({
  src: [
    { path: './crimson-pro/crimson-pro-latin-italic.woff2', weight: '300', style: 'italic' },
    { path: './crimson-pro/crimson-pro-latin-italic.woff2', weight: '400', style: 'italic' },
    { path: './crimson-pro/crimson-pro-latin-italic.woff2', weight: '500', style: 'italic' },
    { path: './crimson-pro/crimson-pro-latin-italic.woff2', weight: '600', style: 'italic' },
    { path: './crimson-pro/crimson-pro-latin.woff2', weight: '300', style: 'normal' },
    { path: './crimson-pro/crimson-pro-latin.woff2', weight: '400', style: 'normal' },
    { path: './crimson-pro/crimson-pro-latin.woff2', weight: '500', style: 'normal' },
    { path: './crimson-pro/crimson-pro-latin.woff2', weight: '600', style: 'normal' },
  ],
  declarations: [
    { prop: 'font-family', value: "'crimsonPro'" },
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
  display: 'swap',
  adjustFontFallback: false,
  fallback: ['Crimson Pro Fallback'],
  variable: '--font-crimson',
});

// oxlint-disable-next-line no-unused-vars -- only its @font-face rules are needed
const beVietnamProVietnamese = localFont({
  src: [
    { path: './be-vietnam-pro/be-vietnam-pro-vietnamese-300.woff2', weight: '300', style: 'normal' },
    { path: './be-vietnam-pro/be-vietnam-pro-vietnamese-400.woff2', weight: '400', style: 'normal' },
    { path: './be-vietnam-pro/be-vietnam-pro-vietnamese-500.woff2', weight: '500', style: 'normal' },
    { path: './be-vietnam-pro/be-vietnam-pro-vietnamese-600.woff2', weight: '600', style: 'normal' },
  ],
  declarations: [
    { prop: 'font-family', value: "'beVietnamPro'" },
    {
      prop: 'unicode-range',
      value:
        'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
    },
  ],
  display: 'swap',
  adjustFontFallback: false,
});

// oxlint-disable-next-line no-unused-vars -- only its @font-face rules are needed
const beVietnamProLatinExt = localFont({
  src: [
    { path: './be-vietnam-pro/be-vietnam-pro-latin-ext-300.woff2', weight: '300', style: 'normal' },
    { path: './be-vietnam-pro/be-vietnam-pro-latin-ext-400.woff2', weight: '400', style: 'normal' },
    { path: './be-vietnam-pro/be-vietnam-pro-latin-ext-500.woff2', weight: '500', style: 'normal' },
    { path: './be-vietnam-pro/be-vietnam-pro-latin-ext-600.woff2', weight: '600', style: 'normal' },
  ],
  declarations: [
    { prop: 'font-family', value: "'beVietnamPro'" },
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
    },
  ],
  display: 'swap',
  adjustFontFallback: false,
});

const beVietnamPro = localFont({
  src: [
    { path: './be-vietnam-pro/be-vietnam-pro-latin-300.woff2', weight: '300', style: 'normal' },
    { path: './be-vietnam-pro/be-vietnam-pro-latin-400.woff2', weight: '400', style: 'normal' },
    { path: './be-vietnam-pro/be-vietnam-pro-latin-500.woff2', weight: '500', style: 'normal' },
    { path: './be-vietnam-pro/be-vietnam-pro-latin-600.woff2', weight: '600', style: 'normal' },
  ],
  declarations: [
    { prop: 'font-family', value: "'beVietnamPro'" },
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
  display: 'swap',
  adjustFontFallback: false,
  fallback: ['Be Vietnam Pro Fallback'],
  variable: '--font-be-vietnam',
});

/** Class names that define --font-crimson and --font-be-vietnam (used by styles/tokens.css). */
export const fontVariables = `${crimsonPro.variable} ${beVietnamPro.variable}`;
