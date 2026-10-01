'use client';

import { useEffect } from 'react';

/*
 * An admin page failed to render (the database is down, a bug). It sits
 * inside the shell, so for an error in a page the menu and sign-out still
 * work. It does not catch an error in (shell)/layout.tsx itself (an error.tsx
 * never wraps its own segment's layout): app/admin/error.tsx does, without
 * the shell. Never show error.message: production minifies it; the digest
 * matches the server log.
 */
export default function AdminError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error('admin_render_failed', error.digest ?? error.message);
  }, [error]);

  return (
    <>
      <h1>Không tải được trang</h1>
      <p className="a-lede">
        {`Đã có lỗi khi tải trang này. Hãy thử lại; nếu vẫn lỗi, báo cho Admin${error.digest ? ` (mã lỗi ${error.digest})` : ''}.`}
      </p>
      <button className="a-btn" type="button" onClick={() => retry()}>
        Thử lại
      </button>
    </>
  );
}
