'use client';

import { DESTS, DEST_KEYS } from '@/lib/data';
import { MAX_GUESTS, fmtDay, guestLabel, seatsLeft, slotsFor, unavailable } from '@/lib/booking';
import { useSite } from '@/components/site/SiteProvider';
import { Dropdown, type Option } from '@/components/ui/Dropdown';
import { useReveal } from '@/lib/motion';

/** The wide "Where would you like to dine?" bar above the footer. */
export function BookingBar() {
  const { restaurants, booking, setBooking, availability, openReserve, dayList, now } = useSite();
  const title = useReveal<HTMLHeadingElement>('title');
  const panel = useReveal<HTMLDivElement>('up');

  // No date during the server render, so no clock read either.
  const at = booking.date ? now() : undefined;

  const destinationOptions: Option<string>[] = DEST_KEYS.map((k) => ({
    value: k,
    label: DESTS[k],
  }));

  const restaurantOptions: Option<string>[] = restaurants
    .filter((r) => r.dest === booking.destination)
    .map((r) => ({ value: r.id, label: r.name }));

  const dayOptions: Option<string>[] = dayList.map((d, i) => ({
    value: d,
    label: fmtDay(d),
    note: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : undefined,
  }));

  const timeOptions: Option<string>[] = slotsFor(restaurants, booking.restaurant).flatMap((g) =>
    g.times.map((t) => {
      const taken = unavailable(booking.date, t, booking.guests, availability, at);
      const left = seatsLeft(t, availability);
      return {
        value: t,
        label: t,
        note: taken ? 'Full' : left !== null && left <= 6 ? `${left} left` : g.meal,
        disabled: taken,
      };
    }),
  );

  const guestOptions: Option<number>[] = Array.from({ length: MAX_GUESTS }, (_, i) => ({
    value: i + 1,
    label: guestLabel(i + 1),
  }));

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
