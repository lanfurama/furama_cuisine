import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { requirePagePermission } from '@/lib/server/dal/session';
import { pickerLocales, screenLocale } from '@/lib/server/content-admin/form-locales';
import { listPolicyVersions } from '@/lib/server/content/policy-version';
import { StringsPanel, type ScreenSearchParams } from '../_ui/StringsPanel';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Chính sách bảo mật' };

/*
 * Spec §7.2 /admin/content/legal: the privacy page (legal.*) and the consent
 * sentence of the booking form (booking.privacy_notice, booking.consent). A
 * save that changes what a guest agrees to adds a policy version of each
 * language whose text moved (legal_versions, migrations 009 and 010, R8-7);
 * bookings from then on store it.
 */
export default async function LegalPage({ searchParams }: { searchParams: ScreenSearchParams }) {
  await requirePagePermission({ content: ['read'] });
  const pool = getPool();
  // The versions of the language the panel edits (its ?lang=, as StringsPanel picks it).
  const locale = screenLocale(await pickerLocales(pool), (await searchParams).lang);
  const versions = await listPolicyVersions(pool, locale);
  return (
    <>
      <p className="a-crumbs">
        <Link href="/admin/content">← Nội dung</Link>
      </p>
      <h1>Chính sách bảo mật</h1>
      <p className="a-lede">
        Trang chính sách và câu đồng ý ở form đặt bàn, từng ngôn ngữ một. Mỗi ngôn ngữ có phiên bản riêng: đổi chữ mà khách của ngôn ngữ đó
        đồng ý sẽ tạo một phiên bản mới, và đặt bàn từ lúc đó ghi phiên bản mới. Ngôn ngữ chưa dịch một câu thì khách đọc câu tiếng Anh, nên
        sửa câu tiếng Anh cũng tạo phiên bản mới cho ngôn ngữ đó.
      </p>
      <p className="a-muted" data-testid="policy-version">
        Phiên bản đang dùng: {versions[0]?.version ?? '—'}
      </p>
      <StringsPanel searchParams={searchParams} screen="legal" title="Chính sách bảo mật" />
      <section aria-labelledby="legal-versions-title">
        <h2 id="legal-versions-title">Các phiên bản</h2>
        <ul>
          {versions.map((v) => (
            <li key={v.version}>
              {v.version} · hiệu lực {v.effectiveOn}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
