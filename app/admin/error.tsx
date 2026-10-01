'use client';

import { useEffect } from 'react';

/*
 * The admin's outer error boundary. An error.tsx does not wrap the layout of
 * its own segment (03-file-conventions/error.md:96), so (shell)/error.tsx
 * cannot catch a failure in
 * (shell)/layout.tsx, which reads the session, and nothing below catches one
 * in an (auth) page such as sign-in. Without this file both reach
 * app/global-error.tsx: English guest copy, with an inline style the admin CSP
 * blocks. A Neon blip, a cold-start timeout or a missing BETTER_AUTH_SECRET
 * lands here.
 *
 * It renders inside app/admin/layout.tsx (the root layout, which it cannot
 * catch) but outside the shell and the auth card, so it brings its own card,
 * as not-found.tsx does. Never show error.message: production hides it; the
 * digest matches the server log.
 */
export default function AdminRootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error('admin_render_failed', error.digest ?? error.message);
  }, [error]);

  return (
    <main className="a-auth">
      <section className="a-card" aria-labelledby="admin-error-title">
        <h1 id="admin-error-title">Không tải được trang quản trị</h1>
        <p className="a-lede">
          {`Đã có lỗi khi tải trang. Hãy thử lại sau ít phút; nếu vẫn lỗi, báo cho bộ phận kỹ thuật${error.digest ? ` (mã lỗi ${error.digest})` : ''}.`}
        </p>
        <button className="a-btn" type="button" onClick={() => retry()}>
          Thử lại
        </button>
      </section>
    </main>
  );
}
