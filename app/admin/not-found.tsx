import Link from 'next/link';

export default function AdminNotFound() {
  return (
    <main className="a-auth">
      <section className="a-card">
        <h1>Không tìm thấy trang</h1>
        <p className="a-lede">Đường dẫn này không có trong trang quản trị.</p>
        <Link className="a-btn" href="/admin">
          Về trang tổng quan
        </Link>
      </section>
    </main>
  );
}
