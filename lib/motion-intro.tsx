'use client';

import { useEffect, type RefObject } from 'react';
import { EASE_INOUT, EASE_OUT, readMotionLevel, useMotion } from '@/lib/motion';

/*
 * A page's entrance: the staggered [data-intro] elements (IntroTrigger) and
 * the opening curtain they wait for (IntroCurtain). Split from lib/motion.tsx,
 * which keeps the scroll reveals and the scroll loop.
 */

export type IntroKind = 'rise' | 'line' | 'clip' | 'word';

const INTRO_FRAMES: Record<IntroKind, Keyframe[]> = {
  rise: [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }],
  line: [{ transform: 'translateY(110%)' }, { transform: 'none' }],
  clip: [{ clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)' }],
  // The hero's words: up out of the line's mask, out of a blur, a touch of tilt.
  word: [
    { transform: 'translateY(110%) rotate(5deg)', filter: 'blur(8px)', opacity: 0 },
    { transform: 'none', filter: 'blur(0)', opacity: 1 },
  ],
};

/**
 * The opening curtain (components/site/IntroCurtain.tsx) claims the first
 * visit of a session; while it covers the page the entrance waits for it, so
 * the hero's words rise as the curtain parts instead of underneath it.
 */
let curtainLiftsAt = 0;

/** True once per session (sessionStorage), when the curtain should play; records when it lifts. */
export function claimIntroCurtain(lift: number): boolean {
  if (!readMotionLevel()) return false;
  try {
    if (sessionStorage.getItem('fc-intro-seen')) return false;
    sessionStorage.setItem('fc-intro-seen', '1');
  } catch {
    return false;
  }
  curtainLiftsAt = performance.now() + lift;
  return true;
}

/**
 * Staggered page entrance for `[data-intro]` elements, ordered by their
 * `data-intro` index. Both keyframes are explicit so `fill: backwards` holds the
 * hidden state through the delay — a single target keyframe would resolve its
 * start against the already-visible element and animate nothing.
 */
export function useIntro(active: boolean, baseDelay = 0, root?: RefObject<HTMLElement | null> | null) {
  const motion = useMotion();

  useEffect(() => {
    if (!active) return;
    const scope: ParentNode | null = root ? root.current : document;
    if (!scope) return;
    const all = Array.from(scope.querySelectorAll<HTMLElement>('[data-intro]'));
    const els = all.filter((el) => !el.hasAttribute('data-intro-done'));
    if (!els.length) return;

    const timer = window.setTimeout(() => {
      const curtain = Math.max(0, curtainLiftsAt - performance.now());
      els.forEach((el) => {
        const kind = (el.getAttribute('data-intro-kind') as IntroKind) || 'rise';
        el.setAttribute('data-intro-done', '');
        if (!motion || !el.animate) return;
        const i = Number(el.getAttribute('data-intro')) || 0;
        // Words of one line follow each other (data-intro-sub).
        const sub = Number(el.getAttribute('data-intro-sub')) || 0;
        const a = el.animate(INTRO_FRAMES[kind], {
          duration: kind === 'clip' ? 1500 : kind === 'word' ? 1300 : 1250,
          delay: curtain + baseDelay + i * 110 + sub * 75,
          easing: kind === 'clip' ? EASE_INOUT : EASE_OUT,
          fill: 'backwards',
        });
        a.finished.then(() => a.cancel()).catch(() => {});
      });
    }, 30);

    return () => {
      window.clearTimeout(timer);
      // A page hidden by <Activity> keeps its DOM; re-arm the entrance so it
      // plays again when the page is shown (its effects re-run then).
      if (root) all.forEach((el) => el.removeAttribute('data-intro-done'));
    };
  }, [active, baseDelay, motion, root]);
}
