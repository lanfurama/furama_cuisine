'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

/*
 * One restore outcome per History panel (7A review UX-5). A restore that
 * succeeds changes the record, so the version it brought back is no longer
 * a choice and its RestoreButton unmounts with its "Đã khôi phục.". The
 * button reports the success here instead: a status line at the top of the
 * panel, which stays mounted, says what was restored and when it was from,
 * as FormMessage says a save (a role="status" line).
 */
const Report = createContext<((text: string) => void) | null>(null);

export function RestoreOutcome({ children }: { children: ReactNode }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <Report.Provider value={setText}>
      {text ? (
        <p className="a-notice" role="status">
          {text}
        </p>
      ) : null}
      {children}
    </Report.Provider>
  );
}

/** The panel's reporter, or null outside a RestoreOutcome (the button then shows its own notice). */
export const useRestoreReport = () => useContext(Report);
