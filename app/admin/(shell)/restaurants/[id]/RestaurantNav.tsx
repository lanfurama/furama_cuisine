import Link from 'next/link';

/*
 * The two screens of one restaurant, under its name: its content (phase 7)
 * and its hours and capacity (phase 4). On both, so each leads back to the
 * other (7A review UX-10: the booking screen had no way back).
 */
export function RestaurantNav({ id, current }: { id: string; current: 'content' | 'booking' }) {
  return (
    <nav className="a-subnav" aria-label="Màn của nhà hàng">
      <Link href={`/admin/restaurants/${id}`} aria-current={current === 'content' ? 'page' : undefined}>
        Nội dung
      </Link>
      <Link href={`/admin/restaurants/${id}/booking`} aria-current={current === 'booking' ? 'page' : undefined}>
        Giờ và sức chứa
      </Link>
    </nav>
  );
}
