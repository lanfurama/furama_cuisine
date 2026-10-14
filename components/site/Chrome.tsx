'use client';

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useSite, type Overlay } from '@/components/site/SiteProvider';
import { Header } from '@/components/site/Header';
import { Footer } from '@/components/site/Footer';
import { IntroCurtain } from '@/components/site/IntroCurtain';
import { PageCurtain } from '@/components/site/PageCurtain';
import { PointerFx } from '@/components/site/PointerFx';
import { ReserveDrawer } from '@/components/overlays/ReserveDrawer';
import { SearchOverlay } from '@/components/overlays/SearchOverlay';
import { MenuOverlay } from '@/components/overlays/MenuOverlay';
import { FilmModal } from '@/components/overlays/FilmModal';
import { FinderSheet } from '@/components/overlays/FinderSheet';
import { BookingBar } from '@/components/booking/BookingBar';
import { homeSections } from '@/lib/content/home-sections';
import { useScrollMotion } from '@/lib/motion';

/**
 * Whether an element can take the focus where it is: still in the document,
 * and shown (not in a page <Activity> hides, nor in a header the view hides).
 * checkVisibility is Safari 17.4+; before it, a hidden element has no boxes.
 */
function shown(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  return typeof el.checkVisibility === 'function' ? el.checkVisibility({ visibilityProperty: true }) : el.getClientRects().length > 0;
}

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Where the focus goes when what opened an overlay cannot take it back: the
 * RESERVE on screen (the header's, or a phone's tab bar's), else the first
 * control of the page on screen (<Activity> hides the others).
 */
function landing(page: HTMLElement, reserve: string): HTMLElement | null {
  const shownIn = (root: Element | null, selector: string) => [...(root?.querySelectorAll<HTMLElement>(selector) ?? [])].filter(shown);
  return shownIn(page, 'button').find((b) => b.textContent?.trim() === reserve) ?? shownIn(page.querySelector('.page'), FOCUSABLE)[0] ?? null;
}

/**
 * Every overlay is a modal dialog (role="dialog", aria-modal). While one is
 * open the page behind it is inert, so neither the keyboard nor a screen
 * reader wanders out of it, and the focus moves into it, to its
 * [data-autofocus] (the drawer's heading, the search box, a close button),
 * unless it took the focus itself. When the last one closes, the focus goes
 * back to what opened the first (RESERVE, the burger, SEARCH), so the guest
 * carries on where they were; an overlay opened from another (the menu's
 * RESERVE) keeps the first one's. When that is gone or hidden (Back left its
 * page behind the drawer), or the close led to a page that hides it (a search
 * result on a phone, whose restaurant page has no header), the focus lands on
 * landing() instead of <body>. Element queries only, inside `behind` and
 * `layer` (lib/page-scope.guard.test.ts).
 */
function useModalOverlays(overlay: Overlay | null, pageRoot: HTMLElement | null, reserve: string) {
  const behind = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  /* What the last close gave the focus back to, until the next page shows. */
  const restored = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const page = behind.current;
    if (!page) return;
    // The overlay as rendered: 'film' with the film section off renders none, and must not leave the page inert.
    const dialog = overlay ? layer.current?.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]') : null;
    if (dialog) {
      // No dialog moves the focus in an effect of its own on opening: it is still on the opener here.
      const active = document.activeElement;
      if (!opener.current && active instanceof HTMLElement && page.contains(active)) opener.current = active;
      restored.current = null;
      page.inert = true;
      if (!dialog.contains(document.activeElement)) dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    } else {
      page.inert = false;
      const back = opener.current;
      opener.current = null;
      restored.current = back;
      if (back) (shown(back) ? back : landing(page, reserve))?.focus({ preventScroll: true });
    }
  }, [overlay, reserve]);

  /* A close that goes somewhere (a search result, a menu link to the other view) shows the next page after the
     focus went back: if that page hides it and the guest has not moved on, land it again. */
  useEffect(() => {
    const page = behind.current;
    if (!pageRoot || !page) return;
    const back = restored.current;
    restored.current = null;
    if (!back || shown(back)) return;
    const active = document.activeElement;
    if (active === back || active === document.body) landing(page, reserve)?.focus({ preventScroll: true });
  }, [pageRoot, reserve]);

  return { behind, layer };
}

/**
 * Everything that wraps a view: the headers, the reservation bar, the footer and
 * every overlay. Living above the pages means booking state and an open drawer
 * survive navigation between the home and restaurant views.
 */
export function Chrome({ children, banner }: { children: ReactNode; banner?: ReactNode }) {
  const { site, overlay, pageRoot, strings } = useSite();
  const { behind, layer } = useModalOverlays(overlay, pageRoot, strings['ui.reserve']);

  useScrollMotion(overlay !== null, pageRoot);

  return (
    <>
      <IntroCurtain />
      <PageCurtain />
      {/* How far down the page is: a gold hairline, drawn by the scroll itself (styles/fx.css). */}
      <div className="scroll-progress" aria-hidden="true" />
      <PointerFx />
      {/* What an open overlay makes inert (useModalOverlays). A plain box: the headers are fixed, the page a block. */}
      <div ref={behind}>
        <Header />

        <div className="page">
          {children}

          {/* The phone detail view hands reservations to its bottom bar instead (styles/booking.css). Staff can switch it off (sections.booking_bar). */}
          {homeSections(site.sections).has('booking_bar') && (
            <div className="booking-slot">
              <BookingBar />
            </div>
          )}

          <Footer />
        </div>

        {/* Draft Mode's bar (the layout's PreviewBanner, in its own Suspense): fixed at the foot, and inert with the page. */}
        {banner}
      </div>

      <div ref={layer}>
        <ReserveDrawer />
        <SearchOverlay />
        <MenuOverlay />
        <FilmModal />
        <FinderSheet />
      </div>
    </>
  );
}
