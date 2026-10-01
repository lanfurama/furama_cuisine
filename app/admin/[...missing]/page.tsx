import { notFound } from 'next/navigation';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

/*
 * Unknown /admin/* URLs: without this, they match no route and get the guest
 * site's English app/global-not-found.tsx. Here they get app/admin/not-found.tsx,
 * in Vietnamese, inside the admin's own document. (Its status is 200: see the
 * note on response codes in app/admin/layout.tsx.)
 */
export default function MissingAdminPage(): never {
  notFound();
}
