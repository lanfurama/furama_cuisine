import type { Metadata, Viewport } from 'next';
import { Be_Vietnam_Pro, Crimson_Pro } from 'next/font/google';
import { DEFAULT_RESTAURANT_ID } from '@/lib/data';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import { getRestaurants } from '@/lib/server/content/restaurants';
import { SiteProvider } from '@/components/site/SiteProvider';
import { MotionProvider } from '@/lib/motion';
import { Chrome } from '@/components/site/Chrome';
import './globals.css';

const crimson = Crimson_Pro({
  subsets: ['latin', 'latin-ext'],
  weight: ['300', '400', '500', '600'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-crimson',
});

const beVietnam = Be_Vietnam_Pro({
  subsets: ['latin', 'latin-ext', 'vietnamese'],
  weight: ['300', '400', '500', '600'],
  display: 'swap',
  variable: '--font-be-vietnam',
});

export const metadata: Metadata = {
  title: 'Furama Cuisine — Many Flavours. Many Destinations.',
  description:
    'From beachfront dining to vibrant city destinations – discover the restaurants, cuisines and people of Furama Cuisine in Da Nang.',
  openGraph: {
    title: 'Furama Cuisine',
    description: 'People · Culture · Great Food — dining across Furama’s Da Nang destinations.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#14201c',
};

/*
 * Sets [data-motion] before first paint so reveal elements can start hidden
 * without flashing, while a visitor without JS still gets everything visible.
 */
const MOTION_BOOTSTRAP = `try{document.documentElement.dataset.motion=matchMedia('(prefers-reduced-motion: reduce)').matches?'off':'on'}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const restaurants = await getRestaurants(DEFAULT_LOCALE);

  /* suppressHydrationWarning: the inline script below stamps data-motion onto
     <html> before React hydrates, so the server markup differs by design. */
  return (
    <html
      lang="en"
      className={`${crimson.variable} ${beVietnam.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: MOTION_BOOTSTRAP }} />
      </head>
      <body>
        <MotionProvider>
          <SiteProvider restaurants={restaurants} defaultRestaurantId={DEFAULT_RESTAURANT_ID}>
            <Chrome>{children}</Chrome>
          </SiteProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
