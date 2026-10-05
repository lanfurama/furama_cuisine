import type { Metadata } from 'next';
import { requirePagePermission } from '@/lib/server/dal/session';
import { StringsPanel } from '../_ui/StringsPanel';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Stories' };

/* Spec §7.2 /admin/content/stories: the section's copy; the list editor (stories, story_i18n) joins it in phase 7. */
export default async function Page() {
  await requirePagePermission({ content: ['read'] });
  return (
    <>
      <h1>Stories</h1>
      <p className="a-lede">Tiêu đề và câu dẫn của mục Stories trên trang chủ. (Danh sách bài viết: đợt 7, màn danh sách.)</p>
      <StringsPanel screen="stories" title="Stories" />
    </>
  );
}
