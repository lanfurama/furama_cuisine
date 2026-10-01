/**
 * Where the guest pages live. The phase-2 route move edits only this file:
 * every spec and the visual baselines read their URLs from here.
 */
export const HOME_PATH = '/';
export const DETAIL_PATH = '/taya-house';

/** Logical page -> URL. Snapshot names come from the key, never the URL. */
export const PAGES = {
  home: HOME_PATH,
  'taya-house': DETAIL_PATH,
} as const;
