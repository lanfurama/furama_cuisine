'use client';

import { memo, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { EASE_DRAWER, EASE_OUT, EASE_POP, readMotionLevel, usePresence } from '@/lib/motion';

/*
 * The Reserve drawer's motion (components/overlays/ReserveDrawer.tsx): its
 * way in and out, the times of a day coming in, and the thanks. Transforms
 * and opacity only, on the drawer's own elements (no document queries). With
 * reduced motion nothing moves: the drawer fades in and out, nothing else plays.
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

/** The panel's slide in, its slide out (a quicker reply to a close), and the fade that stands for both with reduced motion. */
const IN_MS = 450;
const OUT_MS = 280;
const FADE_MS = 150;

/** The way in or out playing on an element (not a CSS transition or animation of its own). */
const playingOn = (el: Element) => el.getAnimations().filter((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation));

/**
 * Where the panel and its shade stand now, mid-way or at rest, and the way in
 * or out stopped there: what follows starts from this point, so a quick
 * reopen or close turns round instead of jumping.
 */
function standstill(sheet: HTMLElement, shade: HTMLElement) {
  const moving = playingOn(sheet).length > 0 || playingOn(shade).length > 0;
  const at = { moving, transform: getComputedStyle(sheet).transform, opacity: getComputedStyle(sheet).opacity, dim: getComputedStyle(shade).opacity };
  for (const el of [sheet, shade]) playingOn(el).forEach((a) => a.cancel());
  return at;
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
     to wait), with the footer early, so REQUEST BOOKING is there with the
     panel. Measured before the panel moves, so a line's place is where it
     will settle. Turned round on its way out, the panel comes back from where
     it is, its lines already in place. */
  const enter = () => {
    const box = root.current;
    const shade = backdrop.current;
    const sheet = panel.current;
    if (!box || !shade || !sheet?.animate) return;
    const at = standstill(sheet, shade);
    if (!readMotionLevel()) {
      sheet.animate([{ opacity: at.moving ? at.opacity : 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease', fill: 'backwards' });
      shade.animate([{ opacity: at.moving ? at.dim : 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease', fill: 'backwards' });
      return;
    }
    const fold = box.clientHeight;
    const lines = at.moving
      ? []
      : [...sheet.querySelectorAll<HTMLElement>('.drawer-head>*,.drawer-body>*')].filter((el) => {
          const place = el.getBoundingClientRect();
          return place.height > 0 && place.top < fold;
        });
    shade.animate([{ opacity: at.moving ? at.dim : 0 }, { opacity: 1 }], { duration: 300, easing: EASE_OUT, fill: 'backwards' });
    sheet.animate([{ transform: at.moving ? at.transform : offstage(box, sheet) }, { transform: 'none' }], {
      duration: IN_MS,
      easing: EASE_DRAWER,
      fill: 'backwards',
    });
    if (at.moving) return;
    const rise = (el: Element, delay: number) => el.animate(RISE, { duration: 300, delay, easing: EASE_OUT, fill: 'backwards' });
    lines.forEach((el, i) => rise(el, 80 + Math.min(i, 8) * 30));
    const foot = sheet.querySelector('.drawer-foot');
    if (foot) rise(foot, 120);
  };

  /* The way out: the panel back where it came from, the shade lifting with it,
     from wherever the way in has got to (a quick close turns round there). */
  const exit = () => {
    const box = root.current;
    const shade = backdrop.current;
    const sheet = panel.current;
    if (!box || !shade || !sheet?.animate) return [];
    const at = standstill(sheet, shade);
    if (!readMotionLevel()) {
      return [
        sheet.animate([{ opacity: at.opacity }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease', fill: 'forwards' }),
        shade.animate([{ opacity: at.dim }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease', fill: 'forwards' }),
      ];
    }
    return [
      sheet.animate([{ transform: at.transform }, { transform: offstage(box, sheet) }], { duration: OUT_MS, easing: EASE_DRAWER, fill: 'forwards' }),
      shade.animate([{ opacity: at.dim }, { opacity: 0 }], { duration: OUT_MS, easing: EASE_OUT, fill: 'forwards' }),
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
          { opacity: 0, transform: 'translateY(4px)' },
          { opacity: 1, transform: 'none' },
        ],
        {
          duration: 200,
          delay: Math.min(i, 8) * 15,
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
    const settle = (selector: string, from: number, frames = RISE, duration = 400) =>
      sheet.querySelectorAll(selector).forEach((el, i) => {
        el.animate(frames, { duration, delay: from + i * 70, easing: EASE_OUT, fill: 'backwards' });
      });
    settle('.drawer-thanks,.drawer-done-lede,.drawer-summary', 200);
    settle('.drawer-summary-row', 420, [
      { opacity: 0, transform: 'translateY(6px)' },
      { opacity: 1, transform: 'none' },
    ]);
    // The way out is not kept waiting behind the thanks.
    settle('.drawer-done-btn', 400, RISE, 300);
  }, [done, open, panel]);

  return present;
}
