import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePagePermission } from '@/lib/server/dal/session';
import { StringsPanel, type ScreenSearchParams } from '../_ui/StringsPanel';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Heritage' };

/* Spec §7.2 /admin/content/heritage: the section's copy (heritage.*); its picture and link are sections.image_id/link_url. */
export default async function Page({ searchParams }: { searchParams: ScreenSearchParams }) {
  await requirePagePermission({ content: ['read'] });
  return (
    <>
      <p className="a-crumbs">
        <Link href="/admin/content">← Nội dung</Link>
      </p>
      <h1>Heritage</h1>
      <p className="a-lede">Chữ của mục Heritage trên trang chủ. Ảnh nền và link “Our story” nằm ở màn Section.</p>
      <StringsPanel searchParams={searchParams} screen="heritage" title="Heritage" />
    </>
  );
}
