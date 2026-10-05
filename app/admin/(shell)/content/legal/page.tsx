import type { Metadata } from 'next';
import { getPool } from '@/db/client';
import { requirePagePermission } from '@/lib/server/dal/session';
import { listPolicyVersions } from '@/lib/server/content/policy-version';
import { StringsPanel } from '../_ui/StringsPanel';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Chính sách bảo mật' };

/*
 * Spec §7.2 /admin/content/legal: the privacy page (legal.*) and the consent
 * sentence of the booking form (booking.privacy_notice, booking.consent). A
 * save that changes what a guest agrees to adds a policy version
 * (legal_versions, migration 009); bookings from then on store it.
 */
export default async function LegalPage() {
  await requirePagePermission({ content: ['read'] });
  const versions = await listPolicyVersions(getPool());
  return (
    <>
      <h1>Chính sách bảo mật</h1>
      <p className="a-lede">
        Trang chính sách và câu đồng ý ở form đặt bàn (tiếng Anh). Mỗi lần đổi chữ mà khách đồng ý sẽ tạo một phiên bản mới; đặt bàn từ lúc đó
        ghi phiên bản mới.
      </p>
      <p className="a-muted" data-testid="policy-version">
        Phiên bản đang dùng: {versions[0]?.version ?? '—'}
      </p>
      <StringsPanel screen="legal" title="Chính sách bảo mật" />
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
