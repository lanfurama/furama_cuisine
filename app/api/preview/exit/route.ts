import { draftMode } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import { loadEnabledLocales } from '@/lib/server/content/locales.queries';
import { previewPath } from '@/lib/server/content/preview';

/*
 * Leaves Draft Mode (C6) and goes back to ?path= if guests can open it (its
 * language is on), else to the default language's home page. Open to anyone,
 * so not under /api/admin (whose handlers all check a permission first): it
 * only turns off the Draft Mode of the browser that calls it, and reads or
 * writes no data.
 */
export async function GET(request: NextRequest) {
  (await draftMode()).disable();
  const enabled = (await loadEnabledLocales()).map((l) => l.code);
  const target = previewPath(request.nextUrl.searchParams.get('path'), enabled) ?? `/${DEFAULT_LOCALE}`;
  return NextResponse.redirect(new URL(target, request.nextUrl.origin), 303);
}
