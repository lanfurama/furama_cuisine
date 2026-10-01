'use client';

import { DESTS, DEST_KEYS, MEAL_LABELS } from '@/lib/data';
import {
  MAX_GUESTS,
  findRestaurant,
  fmtDay,
  guestLabel,
  seatsLeft,
  slotsFor,
  unavailable,
} from '@/lib/booking';
import { formatDay } from '@/lib/venue-time';
import { useSite } from '@/components/site/SiteProvider';
import { Dropdown, type Option } from '@/components/ui/Dropdown';
import { animateSelector, useOpenAnimation } from '@/lib/motion';

export function ReserveDrawer() {
  const {
    restaurants,
    overlay,
    closeDrawer,
    booking,
    setBooking,
    availability,
    dayList,
    now,
    confirmedDate,
    form,
    setFormField,
    errors,
    serverError,
    pending,
    done,
    reference,
    submit,
  } = useSite();

  const open = overlay === 'drawer';

  useOpenAnimation(open, (animate) => {
    animate('[data-anim="drawer"]', [{ transform: 'translateX(100%)' }, { transform: 'none' }], 800);
    animate('[data-anim="backdrop"]', [{ opacity: 0 }, { opacity: 1 }], 450);
  });

  if (!open) return null;

  const restaurant = findRestaurant(restaurants, booking.restaurant) ?? restaurants[0];
  const at = now();
  const groups = slotsFor(restaurants, booking.restaurant);
  const anyAvailable = groups.some((g) =>
    g.times.some((t) => !unavailable(booking.date, t, booking.guests, availability, at)),
  );

  const destinationOptions: Option<string>[] = DEST_KEYS.map((k) => ({ value: k, label: DESTS[k] }));
  const restaurantOptions: Option<string>[] = restaurants
    .filter((r) => r.dest === booking.destination)
    .map((r) => ({ value: r.id, label: r.name }));

  const summary = [booking.date ? fmtDay(booking.date) : '', booking.time, guestLabel(booking.guests)]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="drawer-root" role="dialog" aria-modal="true" aria-label="Reserve a table">
      <button
        type="button"
        data-anim="backdrop"
        className="backdrop"
        aria-label="Close"
        onClick={closeDrawer}
      />

      <aside data-anim="drawer" className="drawer">
        <div className="drawer-head">
          <div className="drawer-head-copy">
            <div className="drawer-kicker">RESERVE A TABLE</div>
            <div className="drawer-name">{restaurant?.name}</div>
            <div className="drawer-meta">
              {restaurant ? `${restaurant.type} · ${DESTS[restaurant.dest]}` : ''}
            </div>
          </div>
          <button type="button" className="drawer-close" aria-label="Close" onClick={closeDrawer}>
            ×
          </button>
        </div>

        {done ? (
          <div className="drawer-done">
            <div className="drawer-tick" aria-hidden="true">
              ✓
            </div>
            <div className="drawer-thanks">Thank you, {form.name.trim() || 'you'}.</div>
            <p className="drawer-done-lede">
              Your table request at {restaurant?.name} has been received. Our team will contact you
              shortly to confirm.
            </p>
            <div className="drawer-summary">
              <div className="drawer-summary-row">
                <span>Date</span>
                <span>{confirmedDate ? fmtDay(confirmedDate) : ''}</span>
              </div>
              <div className="drawer-summary-row">
                <span>Time</span>
                <span>{booking.time}</span>
              </div>
              <div className="drawer-summary-row">
                <span>Guests</span>
                <span>{guestLabel(booking.guests)}</span>
              </div>
              <div className="drawer-summary-row">
                <span>Reference</span>
                <span className="drawer-ref">{reference}</span>
              </div>
            </div>
            <button type="button" className="drawer-done-btn" onClick={closeDrawer}>
              DONE
            </button>
          </div>
        ) : (
          <>
            <div className="drawer-body">
              <div className="drawer-selects">
                <Dropdown
                  id="dDestination"
                  variant="boxed"
                  label="Destination"
                  value={booking.destination}
                  options={destinationOptions}
                  onPick={(destination) => setBooking({ destination })}
                />
                <Dropdown
                  id="dRestaurant"
                  variant="boxed"
                  label="Restaurant"
                  value={booking.restaurant}
                  options={restaurantOptions}
                  onPick={(restaurant) => setBooking({ restaurant })}
                />
              </div>

              <div className="drawer-label">DATE</div>
              <div className="daystrip">
                {dayList.map((d, i) => {
                  const day = formatDay(d);
                  return (
                    <button
                      type="button"
                      key={d}
                      className="day"
                      data-selected={d === booking.date}
                      aria-pressed={d === booking.date}
                      onClick={() => setBooking({ date: d })}
                    >
                      <span className="day-wd">{i === 0 ? 'Today' : day.weekday}</span>
                      <span className="day-num">{day.day}</span>
                      <span className="day-mo">{day.month}</span>
                    </button>
                  );
                })}
              </div>

              <div className="guests">
                <div>
                  <div className="guests-label">GUESTS</div>
                  <div className="guests-value">{guestLabel(booking.guests)}</div>
                </div>
                <div className="guests-steppers">
                  <button
                    type="button"
                    aria-label="Fewer guests"
                    disabled={booking.guests <= 1}
                    onClick={() => setBooking({ guests: Math.max(1, booking.guests - 1) })}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    aria-label="More guests"
                    disabled={booking.guests >= MAX_GUESTS}
                    onClick={() => setBooking({ guests: Math.min(MAX_GUESTS, booking.guests + 1) })}
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="drawer-label">TIME</div>
              {groups.map((g) => (
                <div key={g.meal} className="slotgroup">
                  <div className="slotgroup-meal">{MEAL_LABELS[g.meal]}</div>
                  <div className="slotgrid">
                    {g.times.map((t) => {
                      const taken = unavailable(booking.date, t, booking.guests, availability, at);
                      const left = seatsLeft(t, availability);
                      return (
                        <button
                          type="button"
                          key={t}
                          className="slot"
                          data-selected={!taken && t === booking.time}
                          data-taken={taken}
                          disabled={taken}
                          aria-label={
                            taken
                              ? `${t} — fully booked`
                              : left !== null
                                ? `${t} — ${left} covers left`
                                : t
                          }
                          onClick={() => setBooking({ time: t })}
                        >
                          {t}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {!anyAvailable && (
                <div className="drawer-error">
                  No tables left on this date — please choose another day.
                </div>
              )}

              <div className="drawer-details">
                <div className="drawer-label">YOUR DETAILS</div>
                <div className="drawer-fields">
                  <label className="field">
                    <span className="field-cap">Full name *</span>
                    <input
                      value={form.name}
                      onChange={(e) => setFormField('name', e.target.value)}
                      placeholder="Nguyễn Minh Anh"
                      autoComplete="name"
                      data-invalid={errors.name}
                      aria-invalid={errors.name}
                    />
                    {errors.name && <span className="field-error">Please enter your name.</span>}
                  </label>

                  <label className="field">
                    <span className="field-cap">Phone *</span>
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => setFormField('phone', e.target.value)}
                      placeholder="+84 905 000 000"
                      autoComplete="tel"
                      data-invalid={errors.phone}
                      aria-invalid={errors.phone}
                    />
                    {errors.phone && (
                      <span className="field-error">Please enter a valid phone number.</span>
                    )}
                  </label>

                  <label className="field">
                    <span className="field-cap">Email</span>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setFormField('email', e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      data-invalid={errors.email}
                      aria-invalid={errors.email}
                    />
                    {errors.email && (
                      <span className="field-error">Please check your email address.</span>
                    )}
                  </label>

                  <label className="field">
                    <span className="field-cap">Special requests</span>
                    <textarea
                      rows={3}
                      value={form.note}
                      onChange={(e) => setFormField('note', e.target.value)}
                      placeholder="Occasion, dietary needs, seating preference"
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="drawer-foot">
              <div className="drawer-foot-copy">
                <div className="drawer-foot-label">YOUR TABLE</div>
                <div className="drawer-foot-summary">{summary}</div>
                {serverError && (
                  <div className="drawer-error" role="alert">
                    {serverError}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="drawer-submit"
                onClick={submit}
                disabled={pending}
                aria-busy={pending}
              >
                {pending ? 'SENDING…' : 'REQUEST BOOKING'}
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

export { animateSelector };
