'use client';

import { useIntro } from '@/lib/motion';

/**
 * Plays the staggered [data-intro] entrance for the page it is rendered in.
 * It lives in each page rather than in the persistent Chrome, so the entrance
 * runs again after every client-side navigation.
 */
export function IntroTrigger() {
  useIntro(true, 0);
  return null;
}
