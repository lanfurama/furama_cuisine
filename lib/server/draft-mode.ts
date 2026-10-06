import 'server-only';
import { cacheLife } from 'next/cache';
import { draftMode } from 'next/headers';

/**
 * Draft Mode (C6), read inside a cache scope (use-cache.md:265-287): outside
 * Draft Mode this is a cached false, so a prerendered page stays fully static;
 * in Draft Mode every cache scope runs again per request, and this reads true.
 * Not a content loader (it reads no table), so it lives outside
 * lib/server/content, whose cached functions all carry LOADERS tags.
 */
export async function isDraftMode(): Promise<boolean> {
  'use cache';
  cacheLife('max');
  return (await draftMode()).isEnabled;
}
