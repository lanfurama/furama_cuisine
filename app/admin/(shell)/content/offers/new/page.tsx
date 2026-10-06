import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { listRestaurantOptions } from '@/lib/server/booking/queries';
import { formLocales } from '@/lib/server/content-admin/form-locales';
import { requirePagePermission } from '@/lib/server/dal/session';
import { LocaleTabs } from '../../../_kit/LocaleTabs';
import { OfferForm } from '../OfferForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Thêm ưu đãi' };

export default async function NewOfferPage() {
  await requirePagePermission({ content: ['update'] });
  const [restaurants, tabs] = await Promise.all([listRestaurantOptions(getPool()), formLocales(getPool())]);
  return (
    <>
      <p className="a-crumbs">
        <Link href="/admin/content/offers">← Ưu đãi</Link>
      </p>
      <h1>Thêm ưu đãi</h1>
      <LocaleTabs locales={tabs}>
      <OfferForm
        id={null}
        token="new"
        restaurants={restaurants}
        lastSaved={null}
        values={{
          restaurantId: '',
          priceAmount: null,
          currency: 'VND',
          priceBasis: null,
          validFrom: null,
          validUntil: null,
          isPublished: true,
          title: { en: null },
          schedule: { en: null },
          venueOverride: { en: null },
        }}
      />
      </LocaleTabs>
    </>
  );
}
