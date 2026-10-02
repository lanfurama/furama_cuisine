'use client';

import { DESTS, DEST_KEYS, MEAL_LABELS } from '@/lib/data';
import { fmtDay, guestLabel } from '@/lib/booking';
import { dayReason, slotOpen } from '@/lib/booking/client';
import { useSite } from '@/components/site/SiteProvider';
import { Dropdown, type Option } from '@/components/ui/Dropdown';
import { useReveal } from '@/lib/motion';

/** The wide "Where would you like to dine?" bar above the footer. */
export function BookingBar() {
  const { bookable, booking, setBooking, board, openReserve, days, maxParty, now, strings } = useSite();
  const title = useReveal<HTMLHeadingElement>('title');
  const panel = useReveal<HTMLDivElement>('up');

  // No board during the server render, so no clock read either.
  const at = board ? now() : undefined;

  // Only places and restaurants that take bookings online (booking_enabled).
  const destinationOptions: Option<string>[] = DEST_KEYS.filter((k) => bookable.some((r) => r.dest === k)).map(
    (k) => ({ value: k, label: DESTS[k] }),
  );

  const restaurantOptions: Option<string>[] = bookable
    .filter((r) => r.dest === booking.destination)
    .map((r) => ({ value: r.id, label: r.name }));

  const dayOptions: Option<string>[] = days.map((d, i) => {
    const open = d.state === 'open';
    return {
      value: d.date,
      label: fmtDay(d.date),
      note: open ? (i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : undefined) : dayReason({ ...d, reason: undefined }, strings),
      hint: open ? undefined : dayReason(d, strings),
      disabled: !open,
    };
  });

  /* Until the day's slots arrive (and in the server HTML), the field shows the chosen time as it is. */
  const timeOptions: Option<string>[] =
    board && at
      ? board.periods.flatMap((p) =>
          p.slots.map((s) => {
            const taken = !slotOpen(board, p, s, booking.guests, at);
            return {
              value: s.time,
              label: s.time,
              note: taken ? 'Full' : s.left <= 6 ? `${s.left} left` : MEAL_LABELS[p.meal],
              disabled: taken,
            };
          }),
        )
      : [{ value: booking.time, label: booking.time }];

  /* Likewise the party: 1…maxParty once the server has said, the chosen size before. */
  const guestOptions: Option<number>[] =
    maxParty !== null
      ? Array.from({ length: maxParty }, (_, i) => ({ value: i + 1, label: guestLabel(i + 1) }))
      : [{ value: booking.guests, label: guestLabel(booking.guests) }];

  return (
    <section id="reserve" className="booking">
      <div className="shell">
        <h2 ref={title} data-reveal="title" className="booking-title">
          Where would you like to dine?
        </h2>

        <div ref={panel} data-reveal="up" className="booking-panel">
          <div className="booking-fields">
            <Dropdown
              id="bDestination"
              label="Destination"
              value={booking.destination}
              options={destinationOptions}
              onPick={(destination) => setBooking({ destination })}
            />
            <Dropdown
              id="bRestaurant"
              label="Restaurant"
              value={booking.restaurant}
              options={restaurantOptions}
              onPick={(restaurant) => setBooking({ restaurant })}
            />
            <Dropdown
              id="bDate"
              label="Date"
              value={booking.date}
              options={dayOptions}
              onPick={(date) => setBooking({ date })}
            />
            <Dropdown
              id="bTime"
              label="Time"
              value={booking.time}
              options={timeOptions}
              onPick={(time) => setBooking({ time })}
            />
            <Dropdown
              id="bGuests"
              label="Guests"
              value={booking.guests}
              options={guestOptions}
              onPick={(guests) => setBooking({ guests })}
            />
          </div>

          <button type="button" className="btn-green booking-submit" onClick={() => openReserve()}>
            FIND A TABLE<span className="arrow">→</span>
          </button>
        </div>
      </div>
    </section>
  );
}
