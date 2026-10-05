'use client';

import { bookableDestinationOptions, mealLabel } from '@/lib/content/options';
import { fmtDay } from '@/lib/booking';
import { dayReason, slotOpen } from '@/lib/booking/client';
import { formatMessage } from '@/lib/i18n/format';
import { useSite } from '@/components/site/SiteProvider';
import { Dropdown, type Option } from '@/components/ui/Dropdown';
import { BookingError } from '@/components/booking/WithPhone';
import { useReveal } from '@/lib/motion';

/** The wide "Where would you like to dine?" bar above the footer. */
export function BookingBar() {
  const { site, bookable, booking, setBooking, board, openReserve, days, maxParty, groupPhone, now, strings, loadFailed, locale } = useSite();
  const title = useReveal<HTMLHeadingElement>('title');
  const panel = useReveal<HTMLDivElement>('up');

  // No board during the server render, so no clock read either.
  const at = board ? now() : undefined;

  // Only places and restaurants that take bookings online (booking_enabled).
  const destinationOptions: Option<string>[] = bookableDestinationOptions(site.destinations, bookable);

  const restaurantOptions: Option<string>[] = bookable
    .filter((r) => r.dest === booking.destination)
    .map((r) => ({ value: r.id, label: r.name }));

  const dayOptions: Option<string>[] = days.map((d, i) => {
    const open = d.state === 'open';
    return {
      value: d.date,
      label: fmtDay(d.date),
      note: open ? (i === 0 ? strings['common.today'] : i === 1 ? strings['common.tomorrow'] : undefined) : dayReason({ ...d, reason: undefined }, strings),
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
              note: taken ? strings['booking.slot_full'] : s.left <= 6 ? formatMessage(strings['booking.slot_left'], { count: s.left }, locale) : mealLabel(strings, p.meal),
              disabled: taken,
            };
          }),
        )
      : [{ value: booking.time, label: booking.time }];

  /* Likewise the party: 1…maxParty once the server has said, the chosen size before. */
  const guestLabel = (n: number) => formatMessage(strings['booking.guests_count'], { count: n }, locale);
  const guestOptions: Option<number>[] =
    maxParty !== null
      ? Array.from({ length: maxParty }, (_, i) => ({ value: i + 1, label: guestLabel(i + 1) }))
      : [{ value: booking.guests, label: guestLabel(booking.guests) }];

  return (
    <section id="reserve" className="booking">
      <div className="shell">
        <h2 ref={title} data-reveal="title" className="booking-title">
          {strings['booking.title']}
        </h2>

        <div ref={panel} data-reveal="up" className="booking-panel">
          <div className="booking-fields">
            <Dropdown
              id="bDestination"
              label={strings['booking.label_destination']}
              value={booking.destination}
              options={destinationOptions}
              onPick={(destination) => setBooking({ destination })}
            />
            <Dropdown
              id="bRestaurant"
              label={strings['booking.label_restaurant']}
              value={booking.restaurant}
              options={restaurantOptions}
              onPick={(restaurant) => setBooking({ restaurant })}
            />
            <Dropdown
              id="bDate"
              label={strings['booking.label_date']}
              value={booking.date}
              options={dayOptions}
              onPick={(date) => setBooking({ date })}
            />
            <Dropdown
              id="bTime"
              label={strings['booking.label_time']}
              value={booking.time}
              options={timeOptions}
              onPick={(time) => setBooking({ time })}
            />
            <Dropdown
              id="bGuests"
              label={strings['booking.label_guests']}
              value={booking.guests}
              options={guestOptions}
              onPick={(guests) => setBooking({ guests })}
            />
          </div>

          <button type="button" className="btn-green booking-submit" onClick={() => openReserve()}>
            {strings['booking.find_table']}
            <span className="arrow">→</span>
          </button>
        </div>
        {/* Without its dates or times the bar would just sit empty: say why, with the number to call
            (FIND A TABLE asks again). Always mounted and empty otherwise, so it takes no space and is
            read out when it fills. */}
        <div role="status">
          {loadFailed && (
            <p className="booking-note">
              <BookingError code={loadFailed.code} strings={strings} phone={groupPhone} />
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
