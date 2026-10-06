/*
 * The scripts this build has fonts for (spec §8 SCRIPT_FONTS; the fonts are
 * lib/fonts/scripts.ts). locales.script names one: migration 010's CHECK lists
 * the same keys, and test/integration/migration-010.test.ts compares the two.
 * A language in another script needs fonts here, a deploy and a migration
 * widening that CHECK. Safe in the proxy, on the server and in the browser.
 */
export const SCRIPTS = ['latin', 'vietnamese', 'hangul', 'han-simplified', 'japanese'] as const;
export type Script = (typeof SCRIPTS)[number];

export const isScript = (value: string): value is Script => (SCRIPTS as readonly string[]).includes(value);
