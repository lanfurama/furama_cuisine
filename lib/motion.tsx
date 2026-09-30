'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
  | 'clip'
  | 'wipe'
  | 'journey'
  | 'right';

const EASE_OUT = 'cubic-bezier(.16,1,.3,1)';
const EASE_INOUT = 'cubic-bezier(.76,0,.24,1)';
const EASE_POP = 'cubic-bezier(.22,1,.36,1)';

type Spec = { frames: Keyframe[]; duration: number; easing: string };

const SPECS: Record<RevealKind, Spec> = {
  title: { frames: [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], duration: 1000, easing: EASE_OUT },
  fade: { frames: [{ opacity: 0 }, { opacity: 1 }], duration: 1000, easing: 'ease' },
  up: { frames: [{ opacity: 0, transform: 'translateY(22px)' }, { opacity: 1, transform: 'none' }], duration: 1000, easing: EASE_OUT },
  card: { frames: [{ opacity: 0, transform: 'translateY(28px)' }, { opacity: 1, transform: 'none' }], duration: 1100, easing: EASE_OUT },
  clip: { frames: [{ clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)' }], duration: 1400, easing: EASE_INOUT },
  wipe: { frames: [{ clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)' }], duration: 1500, easing: EASE_INOUT },
  journey: { frames: [{ opacity: 0 }, { opacity: 1 }], duration: 400, easing: 'ease' },
  right: { frames: [{ opacity: 0, transform: 'translateX(20px)' }, { opacity: 1, transform: 'none' }], duration: 1000, easing: EASE_OUT },
};

function prefersReducedMotion() {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function readMotionLevel(): MotionLevel {
  return prefersReducedMotion() ? 0 : 2;
}

type Registry = {
  motion: MotionLevel;
  observe: (el: HTMLElement, kind: RevealKind) => () => void;
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

    // Cards wipe their image box up, then let the photo settle out of a slight push-in.
    if (kind === 'card' || kind === 'clip' || kind === 'wipe') {
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

    if (kind === 'journey') {
      el.querySelectorAll<HTMLElement>('[data-jline]').forEach((x) =>
        anims.push(
          x.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
            duration: 1700,
            delay,
            easing: EASE_INOUT,
            fill: 'backwards',
          }),
        ),
      );
      el.querySelectorAll<HTMLElement>('[data-jdot]').forEach((x, i) =>
        anims.push(
          x.animate(
            [{ transform: 'scale(0)' }, { transform: 'scale(1.6)', offset: 0.6 }, { transform: 'none' }],
            { duration: 700, delay: delay + 150 + i * 420, easing: EASE_POP, fill: 'backwards' },
          ),
        ),
      );
    }

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
    (el: HTMLElement, kind: RevealKind) => {
      if (el.hasAttribute('data-revealed')) return () => {};
      if (!readMotionLevel()) {
        el.setAttribute('data-revealed', '');
        return () => {};
      }
      kinds.current.set(el, kind);
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
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(kind: RevealKind = 'up'): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const ctx = useContext(MotionContext);

  useEffect(() => {
    const el = ref.current;
    if (!el || !ctx) return;
    return ctx.observe(el, kind);
  }, [ctx, kind]);

  return ref;
}

export type IntroKind = 'rise' | 'line' | 'clip';

const INTRO_FRAMES: Record<IntroKind, Keyframe[]> = {
  rise: [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }],
  line: [{ transform: 'translateY(110%)' }, { transform: 'none' }],
  clip: [{ clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)' }],
};

/**
 * Staggered page entrance for `[data-intro]` elements, ordered by their
 * `data-intro` index. Both keyframes are explicit so `fill: backwards` holds the
 * hidden state through the delay — a single target keyframe would resolve its
 * start against the already-visible element and animate nothing.
 */
export function useIntro(active: boolean, baseDelay = 0) {
  const motion = useMotion();

  useEffect(() => {
    if (!active) return;
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-intro]')).filter(
      (el) => !el.hasAttribute('data-intro-done'),
    );
    if (!els.length) return;

    const timer = window.setTimeout(() => {
      els.forEach((el) => {
        const kind = (el.getAttribute('data-intro-kind') as IntroKind) || 'rise';
        el.setAttribute('data-intro-done', '');
        if (!motion || !el.animate) return;
        const i = Number(el.getAttribute('data-intro')) || 0;
        const a = el.animate(INTRO_FRAMES[kind], {
          duration: kind === 'clip' ? 1500 : 1250,
          delay: baseDelay + i * 110,
          easing: kind === 'clip' ? EASE_INOUT : EASE_OUT,
          fill: 'backwards',
        });
        a.finished.then(() => a.cancel()).catch(() => {});
      });
    }, 30);

    return () => window.clearTimeout(timer);
  }, [active, baseDelay, motion]);
}

/** One rAF loop for everything scroll-driven: header auto-hide, parallax, hero fade. */
export function useScrollMotion(overlayOpen: boolean) {
  const motion = useMotion();
  const hidden = useRef(false);
  const lastY = useRef<number | null>(null);

  useEffect(() => {
    if (!motion) return;
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

      document.querySelectorAll<HTMLElement>('[data-parallax]').forEach((el) => {
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

      const hero = document.querySelector<HTMLElement>('[data-hero-content]');
      if (hero && y < vh * 1.4) {
        hero.style.translate = `0 ${(-y * 0.12).toFixed(1)}px`;
        hero.style.opacity = Math.max(0, 1 - y / (vh * 0.75)).toFixed(3);
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [motion, overlayOpen]);
}

/** Entrance animations for overlays (drawer, sheet, search, menu, film). */
export function useOpenAnimation(open: boolean, run: (animate: typeof animateSelector) => void) {
  const motion = useMotion();
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (!open || !motion) return;
    const id = requestAnimationFrame(() => runRef.current(animateSelector));
    return () => cancelAnimationFrame(id);
  }, [open, motion]);
}

export function animateSelector(
  selector: string,
  frames: Keyframe[],
  duration: number,
  delay = 0,
  easing: string = EASE_OUT,
  stagger = 0,
) {
  document.querySelectorAll<HTMLElement>(selector).forEach((el, i) => {
    if (!el.animate) return;
    el.animate(frames, { duration, delay: delay + stagger * i, easing, fill: 'backwards' });
  });
}
