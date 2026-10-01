import type { Metadata } from 'next';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Đăng nhập' };

export default function SignInPage() {
  return (
    <section className="a-card" aria-labelledby="sign-in-title">
      <h1 id="sign-in-title">Đăng nhập</h1>
      <p className="a-lede">Trang quản trị Furama Cuisine</p>
    </section>
  );
}
