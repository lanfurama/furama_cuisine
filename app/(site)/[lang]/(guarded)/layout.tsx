import { notFound } from 'next/navigation';
import { lang } from 'next/root-params';
import { DEFAULT_RESTAURANT_ID } from '@/lib/data';
import { ENABLED_LOCALES } from '@/lib/i18n/locales';
import { getRestaurants } from '@/lib/server/content/restaurants';
import { SiteProvider } from '@/components/site/SiteProvider';
import { Chrome } from '@/components/site/Chrome';

/*
 * Every guest page sits below this layout. It checks the language, so notFound()
 * renders [lang]/not-found.tsx with a real 404, and reads the catalogue, so a
 * database failure renders [lang]/error.tsx. In the root layout neither could
 * be caught.
 */
export default async function GuardedLayout({ children }: { children: React.ReactNode }) {
  const locale = await lang();
  if (!ENABLED_LOCALES.includes(locale)) notFound();
  const restaurants = await getRestaurants(locale);

  return (
    <SiteProvider locale={locale} restaurants={restaurants} defaultRestaurantId={DEFAULT_RESTAURANT_ID}>
      <Chrome>{children}</Chrome>
    </SiteProvider>
  );
}
