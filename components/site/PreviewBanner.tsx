import { isDraftMode } from '@/lib/server/draft-mode';
import { getStrings } from '@/lib/server/content/strings';

/**
 * The bar staff see on a guest page in Draft Mode (C6, R8-11): this language is
 * not open to guests yet, and the way out. isDraftMode reads Draft Mode inside
 * a cache scope, so outside a preview this renders nothing and the page stays
 * prerendered.
 */
export async function PreviewBanner({ locale }: { locale: string }) {
  if (!(await isDraftMode())) return null;
  const t = await getStrings(locale, ['ui.preview_banner', 'ui.preview_exit']);
  return (
    <div className="preview-banner" role="status">
      <span>{t['ui.preview_banner']}</span>
      <a href={`/api/preview/exit?path=/${locale}`}>{t['ui.preview_exit']}</a>
    </div>
  );
}
