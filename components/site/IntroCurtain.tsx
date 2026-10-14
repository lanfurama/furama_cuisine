'use client';

import { useEffect, useState } from 'react';
import { claimIntroCurtain } from '@/lib/motion-intro';

/** When the curtain's two halves start to part (styles/motion.css): the hero's words rise from then. */
const LIFT_MS = 1650;
/** When it is gone and leaves the page. */
const GONE_MS = 2500;

const WORD = 'FURAMA';

/**
 * Opening title card, once per session and never when motion is reduced: the
 * wordmark's letters rise one by one, a gold rule draws under them, then the
 * card splits in two and the halves slide away from the hero.
 */
export function IntroCurtain() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!claimIntroCurtain(LIFT_MS)) return;
    setShow(true);
    const timer = window.setTimeout(() => setShow(false), GONE_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!show) return null;

  return (
    <div className="intro-curtain" aria-hidden="true">
      <span className="intro-curtain-half intro-curtain-top" />
      <span className="intro-curtain-half intro-curtain-bottom" />
      <div className="intro-curtain-card">
        <div className="intro-curtain-word">
          {WORD.split('').map((letter, i) => (
            <span key={i} style={{ ['--i' as string]: i }}>
              {letter}
            </span>
          ))}
        </div>
        <div className="intro-curtain-rule" />
        <div className="intro-curtain-sub">CUISINE</div>
      </div>
    </div>
  );
}
