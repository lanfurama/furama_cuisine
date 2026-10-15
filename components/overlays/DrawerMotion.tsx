'use client';

import { memo, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { EASE_IN, EASE_OUT, EASE_POP, readMotionLevel, usePresence } from '@/lib/motion';

/*
 * The Reserve drawer's motion (components/overlays/ReserveDrawer.tsx): its
 * way in and out, the times of a day coming in, and the thanks. Transforms
 * and opacity only, on the drawer's own elements (no document queries), and
 * none of it with reduced motion: the drawer then opens and closes at once.
 * The small motions that need no script (a day or a time giving under the
 * finger, a message fading in) are in styles/overlays.css.
 */

/**
 * The drawer as it was when it closed, held while it slides away: a close
 * after a booking clears the form at once (closeDrawer), and the leaving
 * panel must not change under the guest's eyes. Back to live on a reopen.
 */
export const Still = memo(
  function Still({ children }: { children: ReactNode; still: boolean }) {
    return children;
  },
  (_, next) => next.still,
);

/** A line of the drawer settling into place: up a little, out of nothing. */
const RISE: Keyframe[] = [
  { opacity: 0, transform: 'translateY(14px)' },
  { opacity: 1, transform: 'none' },
];

/** Where the panel comes from and goes to: the right edge beside the page, or the foot of a phone it fills. */
function offstage(root: HTMLElement, panel: HTMLElement) {
  return panel.offsetWidth >= root.clientWidth - 1 ? 'translateY(100%)' : 'translateX(100%)';
}

type Parts = {
  /** The dialog's box (the whole window), its shade, and the panel. */
  root: RefObject<HTMLElement | null>;
  backdrop: RefObject<HTMLElement | null>;
  panel: RefObject<HTMLElement | null>;
};

/**
 * Plays the drawer in and out, and says whether it is in the document (open,
 * or on its way out). `times` names the day whose times are shown (null while
 * none are), `done` whether the booking went through.
 */
export function useDrawerMotion(open: boolean, { root, backdrop, panel }: Parts, times: string | null, done: boolean): boolean {
  /* The way in: the shade, the panel, then the head and the form's sections
     one after another (only those on screen: below the fold nothing is seen
     to wait), with the footer early, so REQUEST BOOKING is never the last to
     come. Measured before the panel moves, so a line's place is where it
     will settle. */
  const enter = () => {
    const box = root.current;
    const shade = backdrop.current;
    const sheet = panel.current;
    if (!box || !shade || !sheet?.animate) return;
    const fold = box.clientHeight;
    const lines = [...sheet.querySelectorAll<HTMLElement>('.drawer-head>*,.drawer-body>*')].filter((el) => {
      const at = el.getBoundingClientRect();
      return at.height > 0 && at.top < fold;
    });
    const rise = (el: Element, delay: number) => el.animate(RISE, { duration: 560, delay, easing: EASE_OUT, fill: 'backwards' });
    shade.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, easing: 'ease', fill: 'backwards' });
    sheet.animate([{ transform: offstage(box, sheet) }, { transform: 'none' }], { duration: 640, easing: EASE_OUT, fill: 'backwards' });
    lines.forEach((el, i) => rise(el, 140 + Math.min(i, 8) * 45));
    const foot = sheet.querySelector('.drawer-foot');
    if (foot) rise(foot, 300);
  };

  /* The way out: the panel back where it came from, the shade lifting with it,
     from wherever the way in has got to (a quick close turns round there). */
  const exit = () => {
    const box = root.current;
    const shade = backdrop.current;
    const sheet = panel.current;
    if (!box || !shade || !sheet?.animate) return [];
    const from = getComputedStyle(sheet).transform;
    const dim = getComputedStyle(shade).opacity;
    for (const el of [sheet, shade]) el.getAnimations().forEach((a) => a.cancel());
    return [
      sheet.animate([{ transform: from }, { transform: offstage(box, sheet) }], { duration: 380, easing: EASE_IN, fill: 'forwards' }),
      shade.animate([{ opacity: dim }, { opacity: 0 }], { duration: 380, easing: 'linear', fill: 'forwards' }),
    ];
  };

  const present = usePresence(open, { enter, exit });

  /* A day's times arriving (another day, another restaurant, or the first
     answer after opening) come in one after another, under their meals. Not
     on opening with the times already there (the way in moves them), nor
     when the same day is asked again (Try again, a reopen's refresh). */
  const timesSeen = useRef<string | null | undefined>(undefined);
  useLayoutEffect(() => {
    if (!open) {
      timesSeen.current = undefined;
      return;
    }
    const before = timesSeen.current;
    timesSeen.current = times;
    if (before === undefined || !times || times === before || !readMotionLevel()) return;
    panel.current?.querySelectorAll<HTMLElement>('.slotgroup-meal,.slotgroup-note,.slot').forEach((el, i) => {
      el.animate?.(
        [
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'none' },
        ],
        {
          duration: 420,
          delay: Math.min(i, 16) * 24,
          easing: EASE_OUT,
          fill: 'backwards',
        },
      );
    });
  }, [open, times, panel]);

  /* The booking made: the tick set down with a little bounce, then the thanks, and what was booked row by row. */
  useLayoutEffect(() => {
    const sheet = panel.current;
    if (!done || !open || !readMotionLevel() || !sheet?.animate) return;
    sheet.querySelector('.drawer-tick')?.animate(
      [
        { opacity: 0, transform: 'scale(.4)' },
        { opacity: 1, transform: 'scale(1.12)', offset: 0.6 },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 720, delay: 60, easing: EASE_POP, fill: 'backwards' },
    );
    const settle = (selector: string, from: number, frames = RISE) =>
      sheet.querySelectorAll(selector).forEach((el, i) => {
        el.animate(frames, { duration: 560, delay: from + i * 70, easing: EASE_OUT, fill: 'backwards' });
      });
    settle('.drawer-thanks,.drawer-done-lede,.drawer-summary', 200);
    settle('.drawer-summary-row', 420, [
      { opacity: 0, transform: 'translateY(6px)' },
      { opacity: 1, transform: 'none' },
    ]);
    settle('.drawer-done-btn', 740);
  }, [done, open, panel]);

  return present;
}
