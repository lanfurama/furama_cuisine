'use client';

import { useSite } from '@/components/site/SiteProvider';
import { Header } from '@/components/site/Header';
import { Footer } from '@/components/site/Footer';
import { IntroCurtain } from '@/components/site/IntroCurtain';
import { PageCurtain } from '@/components/site/PageCurtain';
import { ReserveDrawer } from '@/components/overlays/ReserveDrawer';
import { SearchOverlay } from '@/components/overlays/SearchOverlay';
import { MenuOverlay } from '@/components/overlays/MenuOverlay';
import { FilmModal } from '@/components/overlays/FilmModal';
import { FinderSheet } from '@/components/overlays/FinderSheet';
import { BookingBar } from '@/components/booking/BookingBar';
import { homeSections } from '@/lib/content/home-sections';
import { useScrollMotion } from '@/lib/motion';

/**
 * Everything that wraps a view: the headers, the reservation bar, the footer and
 * every overlay. Living above the pages means booking state and an open drawer
 * survive navigation between the home and restaurant views.
 */
export function Chrome({ children }: { children: React.ReactNode }) {
  const { site, overlay, pageRoot } = useSite();

  useScrollMotion(overlay !== null, pageRoot);

  return (
    <>
      <IntroCurtain />
      <PageCurtain />
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

      <ReserveDrawer />
      <SearchOverlay />
      <MenuOverlay />
      <FilmModal />
      <FinderSheet />
    </>
  );
}
