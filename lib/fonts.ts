import { Be_Vietnam_Pro, Crimson_Pro } from 'next/font/google';

/*
 * The two site fonts, loaded once and shared ("Using a font definitions file",
 * node_modules/next/dist/docs/01-app/03-api-reference/02-components/font.md:944):
 * the guest root layout and app/global-not-found.tsx, which bypasses every
 * layout, both put these classes on <html>.
 */
const crimson = Crimson_Pro({
  subsets: ['latin', 'latin-ext'],
  weight: ['300', '400', '500', '600'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-crimson',
});

const beVietnam = Be_Vietnam_Pro({
  subsets: ['latin', 'latin-ext', 'vietnamese'],
  weight: ['300', '400', '500', '600'],
  display: 'swap',
  variable: '--font-be-vietnam',
});

/** Class names that define --font-crimson and --font-be-vietnam (used by styles/tokens.css). */
export const fontVariables = `${crimson.variable} ${beVietnam.variable}`;
