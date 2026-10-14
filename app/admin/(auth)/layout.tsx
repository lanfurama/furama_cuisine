/* Sign-in, accept-invite and reset-password: the brand over one centred card, no navigation. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="a-auth">
      <div className="a-auth-inner">
        <p className="a-auth-brand">
          <span className="a-brand-mark" aria-hidden="true">
            F
          </span>
          <span className="a-brand-text">
            Furama Cuisine
            <small>Quản trị</small>
          </span>
        </p>
        {children}
      </div>
    </main>
  );
}
