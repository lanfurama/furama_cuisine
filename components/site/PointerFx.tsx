'use client';

import { useEffect } from 'react';
import { useMotion } from '@/lib/motion';

/**
 * The main buttons lean a little towards a mouse ([data-magnetic]). Only for
 * a fine pointer that can hover, and never when motion is reduced. One
 * listener on the window: nothing here queries the page, and nothing is drawn.
 */
export function PointerFx() {
  const motion = useMotion();

  useEffect(() => {
    if (!motion) return;
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    let magnet: HTMLElement | null = null;

    const release = () => {
      if (magnet) magnet.style.translate = '';
      magnet = null;
    };

    const move = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null;

      const m = target?.closest<HTMLElement>('[data-magnetic]') ?? null;
      if (m !== magnet) release();
      if (m) {
        magnet = m;
        const r = m.getBoundingClientRect();
        m.style.translate = `${((e.clientX - (r.left + r.width / 2)) * 0.16).toFixed(1)}px ${((e.clientY - (r.top + r.height / 2)) * 0.24).toFixed(1)}px`;
      }
    };

    const away = () => release();

    const root = document.documentElement;
    window.addEventListener('pointermove', move, { passive: true });
    root.addEventListener('pointerleave', away);
    window.addEventListener('blur', away);
    return () => {
      window.removeEventListener('pointermove', move);
      root.removeEventListener('pointerleave', away);
      window.removeEventListener('blur', away);
      away();
    };
  }, [motion]);

  return null;
}
