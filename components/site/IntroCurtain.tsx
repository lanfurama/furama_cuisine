'use client';

import { useEffect, useState } from 'react';
import { readMotionLevel } from '@/lib/motion';

/** Opening title card. Shown once per session, and never when motion is reduced. */
export function IntroCurtain() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!readMotionLevel()) return;
    if (sessionStorage.getItem('fc-intro-seen')) return;
    sessionStorage.setItem('fc-intro-seen', '1');
    setShow(true);
    const timer = window.setTimeout(() => setShow(false), 2150);
    return () => window.clearTimeout(timer);
  }, []);

  if (!show) return null;

  return (
    <div className="intro-curtain" aria-hidden="true">
      <div>
        <div className="intro-curtain-word">FURAMA</div>
        <div className="intro-curtain-rule" />
        <div className="intro-curtain-sub">CUISINE</div>
      </div>
    </div>
  );
}
