'use client';

import { useSite } from '@/components/site/SiteProvider';
import { Header } from '@/components/site/Header';
import { Footer } from '@/components/site/Footer';
import { MobileBar } from '@/components/site/MobileBar';
import { IntroCurtain } from '@/components/site/IntroCurtain';
import { PageCurtain } from '@/components/site/PageCurtain';
import { ReserveDrawer } from '@/components/overlays/ReserveDrawer';
import { SearchOverlay } from '@/components/overlays/SearchOverlay';
import { MenuOverlay } from '@/components/overlays/MenuOverlay';
import { FilmModal } from '@/components/overlays/FilmModal';
import { FinderSheet } from '@/components/overlays/FinderSheet';
import { BookingBar } from '@/components/booking/BookingBar';
import { useScrollMotion } from '@/lib/motion';

/**
 * Everything that wraps a view: the headers, the reservation bar, the footer and
 * every overlay. Living above the pages means booking state and an open drawer
 * survive navigation between the home and restaurant views.
 */
export function Chrome({ children }: { children: React.ReactNode }) {
  const { overlay, view } = useSite();

  useScrollMotion(overlay !== null);

  return (
    <>
      <IntroCurtain />
      <PageCurtain />
      <Header />

      <div className="page">
        {children}

        {/* The phone detail view hands reservations to its bottom bar instead. */}
        <div className="booking-slot" data-view={view}>
          <BookingBar />
        </div>

        <Footer />
      </div>

      <MobileBar />

      <ReserveDrawer />
      <SearchOverlay />
      <MenuOverlay />
      <FilmModal />
      <FinderSheet />
    </>
  );
}
