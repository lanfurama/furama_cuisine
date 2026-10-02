'use client';

import { useState } from 'react';
import { DESTS, DEST_KEYS, MEAL_LABELS } from '@/lib/data';
import { FIELD_MAX, findRestaurant, fmtDay, guestLabel } from '@/lib/booking';
import { dayReason, slotOpen } from '@/lib/booking/client';
import type { DayInfo } from '@/lib/booking/api';
import type { GroupPhone } from '@/lib/booking/rules';
import { formatMessage, type MessageParams } from '@/lib/i18n/format';
import { formatDay, type IsoDate } from '@/lib/venue-time';
import { useSite, type ClientStrings } from '@/components/site/SiteProvider';
import { Dropdown, type Option } from '@/components/ui/Dropdown';
import { animateSelector, useOpenAnimation } from '@/lib/motion';

/** A message with {phone} turned into a tel: link (any other placeholder is filled as text). */
function WithPhone({ template, params, phone }: { template: string; params: MessageParams; phone: GroupPhone }) {
  const parts = template.split('{phone}');
  if (parts.length < 2 || !phone.tel) return <>{formatMessage(template, { ...params, phone: phone.display })}</>;
  return (
    <>
      {formatMessage(parts[0], params)}
      <a href={`tel:${phone.tel}`}>{phone.display}</a>
      {formatMessage(parts.slice(1).join(phone.display), params)}
    </>
  );
}

/** Availability that did not arrive: the network message and a way to ask again. */
function LoadFailed({ count, strings, onRetry }: { count: number; strings: ClientStrings; onRetry: () => void }) {
  return (
    <div className="load-failed">
      {/* A new alert per failure, so a Try again that fails again is read out again. */}
      <div key={count} className="drawer-error" role="alert">
        {strings['error.network']}
      </div>
      <button type="button" className="load-retry" onClick={onRetry}>
        {strings['booking.retry']}
      </button>
    </div>
  );
}

/**
 * The booking window as the server sent it. A day that takes no bookings is
 * greyed out and cannot be chosen; tapping it shows why, until another
 * calendar arrives (another restaurant's, or a fresh answer). Mounted only
 * while the drawer shows, so the note starts empty on every open.
 */
function DayStrip({
  days,
  selected,
  onPick,
  strings,
  groupPhone,
}: {
  days: DayInfo[];
  selected: IsoDate | '';
  onPick: (date: IsoDate) => void;
  strings: ClientStrings;
  groupPhone: GroupPhone | null;
}) {
  /* The unavailable day a guest last tapped, and the calendar it was tapped on. */
  const [tapped, setTapped] = useState<{ days: DayInfo[]; day: DayInfo } | null>(null);
  const note = tapped?.days === days ? tapped.day : null;
  const noDates = days.length > 0 && !days.some((d) => d.state === 'open');

  return (
    <>
      <div className="daystrip">
        {days.map((d, i) => {
          const day = formatDay(d.date);
          const open = d.state === 'open';
          const isSelected = open && d.date === selected;
          return (
            <button
              type="button"
              key={d.date}
              className="day"
              data-selected={isSelected}
              data-state={d.state}
              aria-pressed={isSelected}
              // Still focusable, so the reason in its name is read out; a tap shows it below.
              aria-disabled={open ? undefined : true}
              aria-label={
                open
                  ? undefined
                  : formatMessage(strings['booking.day_note'], { date: day.label, reason: dayReason(d, strings) })
              }
              onClick={() => {
                setTapped(open ? null : { days, day: d });
                if (open) onPick(d.date);
              }}
            >
              <span className="day-wd">{i === 0 ? 'Today' : day.weekday}</span>
              <span className="day-num">{day.day}</span>
              <span className="day-mo">{day.month}</span>
            </button>
          );
        })}
      </div>
      {note && (
        <p className="day-note" role="status">
          {formatMessage(strings['booking.day_note'], { date: fmtDay(note.date), reason: dayReason(note, strings) })}
        </p>
      )}
      {noDates && groupPhone && (
        <p className="day-note">
          <WithPhone template={strings['booking.no_dates']} params={{}} phone={groupPhone} />
        </p>
      )}
    </>
  );
}

export function ReserveDrawer() {
  const {
    restaurants,
    bookable,
    overlay,
    closeDrawer,
    booking,
    setBooking,
    days,
    maxParty,
    groupPhone,
    board,
    loadFailed,
    retryAvailability,
    now,
    strings,
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

  const restaurant = findRestaurant(bookable, booking.restaurant) ?? findRestaurant(restaurants, booking.restaurant);
  const at = now();
  const anyAvailable =
    board?.periods.some((p) => p.slots.some((s) => slotOpen(board, p, s, booking.guests, at))) ?? true;
  const atLimit = maxParty !== null && booking.guests >= maxParty;

  // Only places and restaurants that take bookings online (booking_enabled).
  const destinationOptions: Option<string>[] = DEST_KEYS.filter((k) => bookable.some((r) => r.dest === k)).map(
    (k) => ({ value: k, label: DESTS[k] }),
  );
  const restaurantOptions: Option<string>[] = bookable
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
              {loadFailed?.at === 'dates' ? (
                <LoadFailed count={loadFailed.count} strings={strings} onRetry={retryAvailability} />
              ) : (
                <DayStrip
                  days={days}
                  selected={booking.date}
                  onPick={(date) => setBooking({ date })}
                  strings={strings}
                  groupPhone={groupPhone}
                />
              )}

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
                    // The limit comes from the server (booking rules); until it answers, no growing.
                    disabled={maxParty === null || atLimit}
                    onClick={() => setBooking({ guests: booking.guests + 1 })}
                  >
                    +
                  </button>
                </div>
              </div>
              {atLimit && groupPhone && (
                <p className="guests-hint">
                  <WithPhone
                    template={strings['error.party_too_large']}
                    params={{ max: maxParty }}
                    phone={groupPhone}
                  />
                </p>
              )}

              <div className="drawer-label">TIME</div>
              {loadFailed
                ? loadFailed.at === 'times' && (
                    <LoadFailed count={loadFailed.count} strings={strings} onRetry={retryAvailability} />
                  )
                : !board && booking.date && <div className="slot-loading">{strings['booking.loading']}</div>}
              {board?.state === 'closed' && <div className="drawer-error">{strings['error.closed']}</div>}
              {board?.periods.map((p) => (
                <div key={p.meal} className="slotgroup" data-closed={p.closed || undefined}>
                  <div className="slotgroup-meal">{MEAL_LABELS[p.meal]}</div>
                  {p.closed ? (
                    <div className="slotgroup-note">
                      <span>{strings['booking.meal_closed']}</span>
                      {p.reason && <span className="slotgroup-reason">{p.reason}</span>}
                    </div>
                  ) : (
                    <div className="slotgrid">
                      {p.slots.map((s) => {
                        const taken = !slotOpen(board, p, s, booking.guests, at);
                        return (
                          <button
                            type="button"
                            key={s.time}
                            className="slot"
                            data-selected={!taken && s.time === booking.time}
                            data-taken={taken}
                            disabled={taken}
                            aria-label={taken ? `${s.time} — fully booked` : `${s.time} — ${s.left} covers left`}
                            onClick={() => setBooking({ time: s.time })}
                          >
                            {s.time}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
              {!anyAvailable && board?.state !== 'closed' && (
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
                      maxLength={FIELD_MAX.name}
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
                      maxLength={FIELD_MAX.phone}
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
                      maxLength={FIELD_MAX.email}
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
                      maxLength={FIELD_MAX.note}
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
