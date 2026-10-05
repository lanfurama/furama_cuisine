'use client';

import { useEffect } from 'react';

/*
 * The leave-page guard of a form with unsaved edits (spec §7.3): a reload, a
 * closed tab, another site, or a plain GET form on the same page (the
 * "Xem trước giờ đặt" date picker, phase-4 ledger ADM-3) asks first. A client
 * link inside the admin does not (risk 8 of the phase-7 outline: a router
 * guard is phase 10's).
 */
export function useLeaveGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}
