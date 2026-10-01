import Link from 'next/link';
import { navFor, ROLE_LABELS } from '@/lib/admin/nav';
import { verifySession } from '@/lib/server/dal/session';
import { signOut } from './actions';
import { NavLinks } from './NavLinks';

/*
 * The signed-in frame. The session read here only shapes the UI (who is
 * signed in, which links to show); it is not the access check: layouts do not
 * re-run on client navigation (authentication.md:1350-1360), so every page
 * calls verifySession() or requirePagePermission() itself.
 */
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const staff = await verifySession();
  const items = navFor(staff.role).map(({ href, label }) => ({ href, label }));

  return (
    <div className="a-shell">
      <aside className="a-sidebar">
        <Link className="a-brand" href="/admin">
          Furama Cuisine
          <small>Quản trị</small>
        </Link>
        <nav className="a-nav" aria-label="Điều hướng quản trị">
          <NavLinks items={items} />
        </nav>
      </aside>
      <div className="a-main-col">
        <header className="a-header">
          <div className="a-user">
            <span data-testid="staff-name">{staff.name}</span>
            <small>
              {staff.email} · {ROLE_LABELS[staff.role]}
            </small>
          </div>
          <form action={signOut}>
            <button className="a-btn a-btn--ghost" type="submit">
              Đăng xuất
            </button>
          </form>
        </header>
        <main className="a-main">{children}</main>
      </div>
    </div>
  );
}
