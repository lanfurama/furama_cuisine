'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';

/** 0 = no motion, 1 = subtle, 2 = full. */
export type MotionLevel = 0 | 1 | 2;

export type RevealKind =
  | 'title'
  | 'fade'
  | 'up'
  | 'card'
  | 'wipe'
  | 'right'
  | 'pop'
  /* A box whose pieces reveal themselves: shown at once, the choreography passed to useReveal plays inside it. */
  | 'stage';

export const EASE_OUT = 'cubic-bezier(.16,1,.3,1)';
export const EASE_INOUT = 'cubic-bezier(.76,0,.24,1)';
export const EASE_POP = 'cubic-bezier(.22,1,.36,1)';
/** A drawer's slide (iOS-like): under way at once, a long soft landing. In and out alike. */
export const EASE_DRAWER = 'cubic-bezier(.32,.72,0,1)';

type Spec = { frames: Keyframe[]; duration: number; easing: string };

const SPECS: Record<RevealKind, Spec> = {
  title: { frames: [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], duration: 1000, easing: EASE_OUT },
  fade: { frames: [{ opacity: 0 }, { opacity: 1 }], duration: 1000, easing: 'ease' },
  up: { frames: [{ opacity: 0, transform: 'translateY(22px)' }, { opacity: 1, transform: 'none' }], duration: 1000, easing: EASE_OUT },
  card: { frames: [{ opacity: 0, transform: 'translateY(28px)' }, { opacity: 1, transform: 'none' }], duration: 1100, easing: EASE_OUT },
  wipe: { frames: [{ clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)' }], duration: 1500, easing: EASE_INOUT },
  right: { frames: [{ opacity: 0, transform: 'translateX(20px)' }, { opacity: 1, transform: 'none' }], duration: 1000, easing: EASE_OUT },
  // A plate set down with a little bounce: the cuisine chips.
  pop: {
    frames: [
      { opacity: 0, transform: 'scale(.6) rotate(-10deg)' },
      { opacity: 1, transform: 'scale(1.08) rotate(2deg)', offset: 0.62 },
      { opacity: 1, transform: 'none' },
    ],
    duration: 950,
    easing: EASE_POP,
  },
  stage: { frames: [{ opacity: 0 }, { opacity: 1 }], duration: 0, easing: 'linear' },
};

/** What a 'stage' plays inside itself as it comes into view, from `delay` on (its animations, fill 'backwards'). */
export type Choreography = (el: HTMLElement, delay: number) => Animation[];

/** A heading's words (components/ui/SplitWords.tsx) rise out of their masks one after another. */
const WORD_FRAMES: Keyframe[] = [
  { transform: 'translateY(108%) rotate(3deg)', opacity: 0 },
  { transform: 'none', opacity: 1 },
];

function prefersReducedMotion() {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function readMotionLevel(): MotionLevel {
  return prefersReducedMotion() ? 0 : 2;
}

type Registry = {
  motion: MotionLevel;
  observe: (el: HTMLElement, kind: RevealKind, choreography?: Choreography) => () => void;
};

const MotionContext = createContext<Registry | null>(null);

/**
 * Owns a single IntersectionObserver so everything that scrolls into view in the
 * same frame can be sorted top-to-bottom and staggered as one batch — matching
 * the design's reveal cadence rather than firing each element independently.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  const [motion, setMotion] = useState<MotionLevel>(2);
  const kinds = useRef(new WeakMap<HTMLElement, RevealKind>());
  const choreographies = useRef(new WeakMap<HTMLElement, Choreography>());
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setMotion(mq.matches ? 0 : 2);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.motion = motion ? 'on' : 'off';
  }, [motion]);

  const play = useCallback((el: HTMLElement, kind: RevealKind, delay: number, level: MotionLevel) => {
    const spec = SPECS[kind];
    const settle = () => el.setAttribute('data-revealed', '');

    if (!level || !el.animate) {
      settle();
      return;
    }

    const duration = level === 1 ? spec.duration * 0.6 : spec.duration;
    const anims: Animation[] = [
      el.animate(spec.frames, { duration, delay, easing: spec.easing, fill: 'backwards' }),
    ];

    // A split heading: each word rises out of its own mask, staggered.
    if (kind === 'title') {
      el.querySelectorAll<HTMLElement>('[data-word]').forEach((w, i) =>
        anims.push(w.animate(WORD_FRAMES, { duration: 1100, delay: delay + 120 + i * 65, easing: EASE_OUT, fill: 'backwards' })),
      );
    }

    // Cards wipe their image box up, then let the photo settle out of a slight push-in.
    if (kind === 'card' || kind === 'wipe') {
      const box = kind === 'card' ? el.querySelector<HTMLElement>('[data-reveal-img]') : el;
      if (box && kind === 'card') {
        anims.push(
          box.animate(
            [{ clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)' }],
            { duration: 1200, delay, easing: EASE_INOUT, fill: 'backwards' },
          ),
        );
      }
      const img = box?.querySelector<HTMLElement>('[data-reveal-zoom]');
      if (img) {
        anims.push(
          img.animate([{ transform: 'scale(1.08)' }, { transform: 'scale(1)' }], {
            duration: 1600,
            delay,
            easing: EASE_OUT,
            fill: 'backwards',
          }),
        );
      }
    }

    const choreography = choreographies.current.get(el);
    if (choreography) anims.push(...choreography(el, delay));

    settle();
    Promise.all(anims.map((a) => a.finished))
      .then(() => anims.forEach((a) => a.cancel()))
      .catch(() => {});
  }, []);

  const getObserver = useCallback(() => {
    if (observerRef.current) return observerRef.current;
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).map((e) => e.target as HTMLElement);
        visible.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return Math.round(ra.top / 40) - Math.round(rb.top / 40) || ra.left - rb.left;
        });
        visible.forEach((el, i) => {
          observerRef.current?.unobserve(el);
          const kind = kinds.current.get(el) ?? 'up';
          play(el, kind, Math.min(i, 10) * 70, readMotionLevel());
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
    return observerRef.current;
  }, [play]);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    },
    [],
  );

  const observe = useCallback(
    (el: HTMLElement, kind: RevealKind, choreography?: Choreography) => {
      if (el.hasAttribute('data-revealed')) return () => {};
      if (!readMotionLevel()) {
        el.setAttribute('data-revealed', '');
        return () => {};
      }
      kinds.current.set(el, kind);
      if (choreography) choreographies.current.set(el, choreography);
      const io = getObserver();
      io.observe(el);
      return () => io.unobserve(el);
    },
    [getObserver],
  );

  const value = useMemo<Registry>(() => ({ motion, observe }), [motion, observe]);
  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>;
}

export function useMotion(): MotionLevel {
  return useContext(MotionContext)?.motion ?? 0;
}

/**
 * Attach to any element to have it reveal on scroll. The matching
 * `data-reveal="<kind>"` attribute sets the pre-animation state in CSS, so
 * nothing flashes before hydration and no-JS visitors still see content.
 * A 'stage' also takes the choreography it plays inside itself (read once,
 * when it starts watching: a module-level function, not one made per render).
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(kind: RevealKind = 'up', choreography?: Choreography): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const ctx = useContext(MotionContext);

  useEffect(() => {
    const el = ref.current;
    if (!el || !ctx) return;
    return ctx.observe(el, kind, choreography);
  }, [ctx, kind, choreography]);

  return ref;
}

/**
 * One rAF loop for everything scroll-driven: header auto-hide, parallax, hero
 * fade, a picture settling from a zoom as it scrolls in ([data-scale-in]) and
 * the lean of whatever follows the scroll's speed ([data-velocity], the
 * marquee). Everything but the header only touches `page` (the visible page's
 * <main>): a page hidden by <Activity>, or one still hydrating, is left alone.
 */
export function useScrollMotion(overlayOpen: boolean, page: HTMLElement | null) {
  const motion = useMotion();
  const hidden = useRef(false);
  const lastY = useRef<number | null>(null);
  const velocity = useRef(0);

  useEffect(() => {
    if (!motion || !page) return;
    let raf = 0;

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const y = window.scrollY || 0;
      const vh = window.innerHeight || 800;
      const prev = lastY.current ?? y;
      const delta = y - prev;
      lastY.current = y;

      // Headers retract on downward scroll once past the hero lip.
      let hide = hidden.current;
      if (overlayOpen || y < 240) hide = false;
      else if (delta > 6) hide = true;
      else if (delta < -6) hide = false;
      if (hide !== hidden.current) {
        hidden.current = hide;
        document.querySelectorAll<HTMLElement>('[data-header]').forEach((el) => {
          el.style.translate = hide ? '0 -110%' : '0 0';
        });
      }

      page.querySelectorAll<HTMLElement>('[data-parallax]').forEach((el) => {
        const parent = el.parentElement;
        if (!parent) return;
        const r = parent.getBoundingClientRect();
        if (r.bottom < -200 || r.top > vh + 200) return;
        const factor = Number(el.getAttribute('data-parallax')) || 0;
        const max = Number(el.getAttribute('data-parallax-max')) || 0;
        let off = (r.top + r.height / 2 - vh / 2) * -factor;
        if (max) off = Math.max(-r.height * max, Math.min(r.height * max, off));
        el.style.translate = `0 ${off.toFixed(1)}px`;
      });

      // The scroll's speed, smoothed, in px per frame (clamped): what the marquee leans by.
      velocity.current = velocity.current * 0.86 + Math.max(-60, Math.min(60, delta)) * 0.14;
      const lean = Math.abs(velocity.current) < 0.05 ? 0 : velocity.current;
      page.querySelectorAll<HTMLElement>('[data-velocity]').forEach((el) => {
        el.style.setProperty('--velocity', lean.toFixed(2));
      });

      page.querySelectorAll<HTMLElement>('[data-scale-in]').forEach((el) => {
        const parent = el.parentElement;
        if (!parent) return;
        const r = parent.getBoundingClientRect();
        if (r.bottom < -200 || r.top > vh + 200) return;
        const from = Number(el.getAttribute('data-scale-in')) || 1.2;
        // 0 as the section's top enters the viewport's foot, 1 once its middle reaches the viewport's middle.
        const t = Math.max(0, Math.min(1, (vh - r.top) / (vh / 2 + r.height / 2)));
        el.style.scale = (from - (from - 1) * t).toFixed(4);
      });

      const hero = page.querySelector<HTMLElement>('[data-hero-content]');
      if (hero && y < vh * 1.4) {
        hero.style.translate = `0 ${(-y * 0.12).toFixed(1)}px`;
        hero.style.opacity = Math.max(0, 1 - y / (vh * 0.75)).toFixed(3);
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [motion, overlayOpen, page]);
}

/**
 * An overlay that animates out as well as in (the Reserve drawer). Returns
 * whether it is in the document: from the moment `open` turns true until its
 * way out has played. `enter` plays the way in after a closed overlay
 * renders, before the browser paints it. `exit` starts the way out and
 * returns its animations (fill 'forwards'); the overlay leaves when they
 * finish (at once when there are none). Both start from wherever the other
 * has got to, so opening again on the way out, or closing on the way in,
 * changes direction instead of jumping. Reduced motion is theirs to honour:
 * this hook plays whatever they return.
 */
export function usePresence(open: boolean, plays: { enter: () => void; exit: () => Animation[] }): boolean {
  const [present, setPresent] = useState(open);
  // Adjusting state during render: in at once, out once the way out has played (the effect below).
  if (open && !present) setPresent(true);

  const latest = useRef(plays);
  useLayoutEffect(() => {
    latest.current = plays;
  });
  const was = useRef(open);
  /* Which turn the last wait belongs to: a way out turned round before it finished stands down. */
  const turn = useRef(0);

  useLayoutEffect(() => {
    if (was.current === open) return;
    was.current = open;
    if (!present) return;
    const mine = ++turn.current;
    if (open) {
      latest.current.enter();
      return;
    }
    const settle = () => {
      if (mine === turn.current) setPresent(false);
    };
    // A way out cancelled from elsewhere settles too: the overlay must never stay behind, inert, for good.
    Promise.all(latest.current.exit().map((a) => a.finished)).then(settle, settle);
  }, [open, present]);

  return present;
}

/** One moving piece of an overlay: where it stands while away, and how it comes in and goes out. */
export type OverlayPart = {
  el: Element | null;
  /** Its state offstage, e.g. { opacity: 0 } or { transform: 'translateY(100%)' }; at rest it is opacity 1, no transform. */
  away: Keyframe;
  in: { duration: number; easing: string };
  out: { duration: number; easing: string };
};

/** With reduced motion an overlay only fades, this long each way. */
const OVERLAY_FADE_MS = 150;

/** The way in or out playing on an element (a script animation, not a CSS transition or animation of its own). */
const scripted = (el: Element) => el.getAnimations().filter((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation));

/** Stops the way in or out on `el` where it stands; returns that point (for `away`'s properties) and whether it was moving. */
function halt(el: Element, away: Keyframe) {
  const style = getComputedStyle(el);
  const at: Keyframe = {};
  if ('opacity' in away) at.opacity = style.opacity;
  if ('transform' in away) at.transform = style.transform;
  const moving = scripted(el);
  moving.forEach((a) => a.cancel());
  return { at, moving: moving.length > 0 };
}

const rest = (away: Keyframe): Keyframe => ({
  ...('opacity' in away && { opacity: 1 }),
  ...('transform' in away && { transform: 'none' }),
});

/**
 * An overlay's way in and out (menu, search, finder sheet, film; the Reserve
 * drawer has its own, components/overlays/DrawerMotion.tsx), on usePresence.
 * `parts` names its moving pieces inside `root`; each comes in from `away` and
 * goes back there, the way out quicker than the way in. Turned round mid-way,
 * a piece starts from where it stands. `after` plays on a fresh way in only
 * (the menu's lines rising), never on a turn. With reduced motion nothing
 * moves: the root fades in and out. Returns whether the overlay is in the
 * document; while it leaves it must drop role="dialog" and be inert, like the
 * drawer, so the page behind has the focus back at once (Chrome.tsx).
 */
export function useOverlayPresence(
  open: boolean,
  root: RefObject<HTMLElement | null>,
  parts: (box: HTMLElement) => OverlayPart[],
  after?: (box: HTMLElement) => void,
): boolean {
  const enter = () => {
    const box = root.current;
    if (!box?.animate) return;
    if (!readMotionLevel()) {
      const fade = { opacity: 0 };
      const { at, moving } = halt(box, fade);
      box.animate([moving ? at : fade, rest(fade)], { duration: OVERLAY_FADE_MS, easing: 'ease', fill: 'backwards' });
      return;
    }
    let turned = false;
    for (const part of parts(box)) {
      if (!part.el) continue;
      const { at, moving } = halt(part.el, part.away);
      turned ||= moving;
      part.el.animate([moving ? at : part.away, rest(part.away)], { ...part.in, fill: 'backwards' });
    }
    if (!turned) after?.(box);
  };

  const exit = () => {
    const box = root.current;
    if (!box?.animate) return [];
    if (!readMotionLevel()) {
      const fade = { opacity: 0 };
      const { at } = halt(box, fade);
      return [box.animate([at, fade], { duration: OVERLAY_FADE_MS, easing: 'ease', fill: 'forwards' })];
    }
    return parts(box).flatMap((part) => {
      if (!part.el) return [];
      const { at } = halt(part.el, part.away);
      return [part.el.animate([at, part.away], { ...part.out, fill: 'forwards' })];
    });
  };

  return usePresence(open, { enter, exit });
}
