'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { readMotionLevel } from '@/lib/motion';

/*
 * The brand curtain that covers a view swap: it wipes in, the route changes
 * underneath it, then it wipes back off. The element is held in a module-level
 * ref and driven with the Web Animations API so navigation never waits on a
 * React re-render, and a stalled route change still resolves via the fallback.
 */
let curtain: HTMLElement | null = null;
let busy = false;

export function coverThen(swap: () => void) {
  if (!curtain || !curtain.animate || !readMotionLevel()) {
    swap();
    return;
  }
  if (busy) return;
  busy = true;

  curtain.dataset.active = 'true';
  const inAnim = curtain.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: 380,
    easing: 'ease',
    fill: 'forwards',
  });

  let swapped = false;
  const run = () => {
    if (swapped) return;
    swapped = true;
    window.clearTimeout(fallback);
    swap();
  };
  const fallback = window.setTimeout(run, 900);
  inAnim.finished.then(run).catch(run);
}

function uncover() {
  if (!curtain) return;
  busy = false;
  if (!curtain.animate || !readMotionLevel()) {
    curtain.style.opacity = '0';
    curtain.dataset.active = 'false';
    return;
  }
  const out = curtain.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: 520,
    delay: 140,
    easing: 'ease',
    fill: 'forwards',
  });
  out.finished
    .then(() => {
      if (!curtain) return;
      curtain.dataset.active = 'false';
      out.cancel();
      curtain.style.opacity = '0';
    })
    .catch(() => {});
}

export function PageCurtain() {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    curtain = ref.current;
    return () => {
      curtain = null;
    };
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    uncover();
  }, [pathname]);

  return (
    <div ref={ref} className="page-curtain" data-active="false" aria-hidden="true">
      <span>FURAMA</span>
    </div>
  );
}
