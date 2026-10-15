import Link from 'next/link';
import { navGroupsFor, ROLE_LABELS } from '@/lib/admin/nav';
import { roleCan } from '@/lib/server/auth/permissions';
import { loadAiFeatures } from '@/lib/server/ai/features';
import { verifySession } from '@/lib/server/dal/session';
import { BrandMark } from './_ui/BrandMark';
import { Icon } from './_ui/Icon';
import { signOut } from './actions';
import { AdminFrame } from './AdminFrame';
import { NavLinks } from './NavLinks';
import { AiFeaturesProvider } from './_kit/useAiFeatures';

/** Up to two initials for the account badge: "Lan Admin" → "LA", "an" → "A". */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const picked = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return picked.map((w) => [...w][0]?.toUpperCase() ?? '').join('') || '?';
}

/*
 * The signed-in frame. The session read here only shapes the UI (who is
 * signed in, which links and shortcuts to show); it is not the access check:
 * layouts do not re-run on client navigation (authentication.md:1350-1360),
 * so every page calls verifySession() or requirePagePermission() itself.
 */
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const staff = await verifySession();
  const aiFeatures = await loadAiFeatures();
  const groups = navGroupsFor(staff.role);
  const canBook = roleCan(staff.role, { reservations: ['create'] });

  return (
    <AdminFrame
      sidebar={
        <>
          <Link className="a-brand" href="/admin">
            <BrandMark className="a-brand-mark" />
            <span className="a-brand-text">
              Furama Dining World
              <small>Quản trị</small>
            </span>
          </Link>
          <nav className="a-nav" aria-label="Điều hướng quản trị">
            <NavLinks groups={groups} />
          </nav>
          <a className="a-sidebar-foot" href="/" target="_blank" rel="noopener">
            <Icon name="globe" />
            <span>Mở web khách</span>
            <Icon name="external" size={14} className="a-icon--end" />
          </a>
        </>
      }
      header={
        <div className="a-header-bar">
          {canBook ? (
            <Link className="a-btn a-btn--small a-header-cta" href="/admin/reservations/new">
              <Icon name="plus" size={16} />
              <span>Tạo đặt bàn</span>
            </Link>
          ) : null}
          <div className="a-user">
            <span className="a-avatar" aria-hidden="true">
              {initials(staff.name)}
            </span>
            <span className="a-user-text">
              <span data-testid="staff-name">{staff.name}</span>
              <small>
                {staff.email} · {ROLE_LABELS[staff.role]}
              </small>
            </span>
          </div>
          <form action={signOut}>
            <button className="a-btn a-btn--ghost a-btn--small" type="submit">
              <Icon name="logout" size={16} />
              <span className="a-hide-sm">Đăng xuất</span>
            </button>
          </form>
        </div>
      }
    >
      <AiFeaturesProvider features={aiFeatures}>{children}</AiFeaturesProvider>
    </AdminFrame>
  );
}
