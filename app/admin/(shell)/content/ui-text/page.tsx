import type { Metadata } from 'next';
import { requirePagePermission } from '@/lib/server/dal/session';
import { StringsPanel } from '../_ui/StringsPanel';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Chữ giao diện' };

/* Spec §7.2 /admin/content/ui-text: the remaining ui.*, form.*, error.*, search.*, common.* keys. */
export default async function Page() {
  await requirePagePermission({ content: ['read'] });
  return (
    <>
      <h1>Chữ giao diện</h1>
      <p className="a-lede">Chữ của các nút, nhãn và thông báo trên web khách (tiếng Anh). Lưu là web khách đổi ngay.</p>
      <StringsPanel screen="ui-text" title="Chữ giao diện" />
    </>
  );
}
