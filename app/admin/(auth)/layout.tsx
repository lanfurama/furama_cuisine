import { BrandMark } from '../(shell)/_ui/BrandMark';

/* Sign-in, accept-invite and reset-password: the brand over one centred card, no navigation. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="a-auth">
      <div className="a-auth-inner">
        <p className="a-auth-brand">
          <BrandMark className="a-brand-mark" />
          <span className="a-brand-text">
            Furama Dining World
            <small>Quản trị</small>
          </span>
        </p>
        {children}
      </div>
    </main>
  );
}
