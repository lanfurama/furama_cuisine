import type { ReservationStatus } from '@/lib/booking/rules';
import { STATUS_LABELS } from '@/lib/reservations/lifecycle';

/* The status as a coloured label; the colour comes from admin.css (.a-status--<status>), never style="". */
export function StatusBadge({ status }: { status: ReservationStatus }) {
  return <span className={`a-status a-status--${status}`}>{STATUS_LABELS[status]}</span>;
}
