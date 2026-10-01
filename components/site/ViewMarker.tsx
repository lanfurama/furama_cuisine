'use client';

import { createContext, useContext, useLayoutEffect, useRef, type RefObject } from 'react';
import { useSite, type View } from '@/components/site/SiteProvider';

const PageRootContext = createContext<RefObject<HTMLElement | null> | null>(null);

/** The <main> of the page this component sits in. */
export function usePageRoot(): RefObject<HTMLElement | null> | null {
  return useContext(PageRootContext);
}

/**
 * Each page's root. It tells the shared chrome which page is showing, instead
 * of the chrome reading usePathname() (which turns the whole layout into a
 * dynamic hole when a route param is unknown at build time).
 *
 * The registration lives in a layout effect on purpose: with Cache Components
 * the router keeps the previous page mounted but hidden in <Activity>, and
 * effects are torn down when a page hides and set up again when it shows. So
 * "the registered page" is always the visible one, and its <main> is the
 * container every DOM query should search.
 */
export function ViewMarker({
  view,
  restaurant,
  children,
}: {
  view: View;
  restaurant?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const { showPage } = useSite();

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    return showPage({ view, restaurant: restaurant ?? null, root });
  }, [showPage, view, restaurant]);

  return (
    <PageRootContext value={ref}>
      <main ref={ref} data-view={view}>
        {children}
      </main>
    </PageRootContext>
  );
}
