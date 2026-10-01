import Link from 'next/link';

/* forbidden() from requirePagePermission(): inside the shell, the URL kept, no data of the page rendered. */
export default function Forbidden() {
  return (
    <>
      <h1>Không có quyền truy cập</h1>
      <p className="a-lede">Trang này chỉ dành cho Admin. Nếu bạn cần quyền này, hãy liên hệ Admin.</p>
      <Link className="a-btn a-btn--ghost" href="/admin">
        Về trang tổng quan
      </Link>
    </>
  );
}
