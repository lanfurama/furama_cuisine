import 'server-only';

/**
 * SQL: notification_recipients row `n` reaches a booking at the restaurant
 * whose id and destination are the given SQL expressions: a row for that
 * restaurant, for its destination (restaurants.destination), or for 'all'
 * (spec §10.4, R4). The one definition: the queue (outbox.ts queueStaffNew)
 * and the overview's "Nhà hàng chưa có người nhận thông báo" both use it, so
 * they can never disagree about who hears about a booking. Callers add
 * `n.active AND 'staff.new' = ANY (n.events)`.
 */
export const reachesSql = (n: string, restaurantId: string, destination: string): string =>
  `(${n}.scope = 'all' OR (${n}.scope = 'destination' AND ${n}.destination_id = ${destination})` +
  ` OR (${n}.scope = 'restaurant' AND ${n}.restaurant_id = ${restaurantId}))`;
