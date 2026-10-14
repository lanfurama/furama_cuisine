import { draftMode } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { LISTED_LOCALE_CODES } from '@/lib/i18n/site-locales';
import { previewPath } from '@/lib/server/content/preview';
import { requirePermission } from '@/lib/server/dal/session';

/*
 * Staff open a guest page in Draft Mode (spec §6.1, R8-11): a language that is
 * listed in lib/i18n/site-locales.ts but off renders for them, unindexed, outside the switcher, the
 * sitemap and hreflang. ?path=/<code>/… (lib/server/content/preview.ts).
 * No Origin check, unlike the email preview's POST: this is a top-level GET
 * from a link, which carries none, and its only effect is the Draft Mode
 * cookie of a signed-in member of staff.
 */
export async function GET(request: NextRequest) {
  try {
    await requirePermission({ content: ['read'] });
  } catch {
    return new Response('Forbidden', { status: 403 });
  }
  const target = previewPath(request.nextUrl.searchParams.get('path'), LISTED_LOCALE_CODES);
  if (!target) return new Response('Bad preview path', { status: 400 });
  (await draftMode()).enable();
  return NextResponse.redirect(new URL(target, request.nextUrl.origin), 303);
}
