/*
 * Furama Dining World's mark, on a 64 × 64 grid: Crimson Pro's F (wght 500) in a
 * square rule whose corners turn in as the key fret (hồi văn) of Furama's
 * emblem, the fret that tops the footer (styles/ornament.css). The site's
 * <BrandMark> (components/ui) and the admin's (app/admin/(shell)/_ui) draw it
 * inline; the favicons (app/icon.svg, favicon.ico, apple-icon.png) and the
 * files in public/brand/ are drawn from the same paths.
 */

/** The square rule and its four key-fret corners: a stroke, 1.5 wide at header size. */
export const BRAND_MARK_RULE =
  'M5 17L5 5L17 5L17 14L8 14L8 8L14 8L14 11L11 11M59 17L59 5L47 5L47 14L56 14L56 8L50 8L50 11L53 11M59 47L59 59L47 59L47 50L56 50L56 56L50 56L50 53L53 53M5 47L5 59L17 59L17 50L8 50L8 56L14 56L14 53L11 53M17 5H47M17 59H47M5 17V47M59 17V47';

/** The F: a fill. */
export const BRAND_MARK_F =
  'M21.87 46.1 21.75 44.18 24.42 43.51Q24.46 43.33 24.5 42.52Q24.53 41.71 24.56 40.26Q24.6 38.81 24.6 36.81L24.64 28.01Q24.64 26.15 24.61 24.8Q24.58 23.45 24.54 22.65Q24.51 21.85 24.46 21.71L21.59 21.02L21.73 19.1H36Q36.78 19.1 37.69 19.08Q38.59 19.05 39.55 19Q40.51 18.94 41.36 18.89L42.41 25.2L40.12 25.53L38.49 21.62Q38.11 21.53 37.65 21.49Q37.19 21.46 36.68 21.46H32.07Q31.36 21.46 30.54 21.49Q29.73 21.53 29.22 21.62Q29.22 21.8 29.2 22.25Q29.17 22.71 29.17 23.42Q29.17 24.14 29.17 25.12Q29.17 26.09 29.17 27.37L29.22 37.53Q29.22 39.3 29.25 40.58Q29.29 41.86 29.33 42.6Q29.38 43.33 29.43 43.51L33.15 44.09L33.04 46.1ZM36.84 37.15 36.28 33.86Q35.92 33.76 35.32 33.72Q34.73 33.67 33.95 33.67H30.47Q29.88 33.67 29.28 33.71Q28.69 33.74 27.99 33.79V31.04Q28.52 31.09 29.17 31.13Q29.81 31.18 30.47 31.18H33.95Q34.87 31.18 35.45 31.12Q36.03 31.06 36.28 31.02L36.84 27.91H39.03V37.15Z';
