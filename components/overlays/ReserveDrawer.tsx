'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { bookableDestinationOptions } from '@/lib/content/options';
import { MEAL_LABELS } from '@/lib/data';
import { FIELD_MAX, findRestaurant, fmtDay, guestLabel } from '@/lib/booking';
import { dayReason, movedReason, slotOpen, type DateMove } from '@/lib/booking/client';
import type { DayInfo } from '@/lib/booking/api';
import type { GroupPhone } from '@/lib/booking/rules';
import { formatMessage } from '@/lib/i18n/format';
import { formatDay, type IsoDate } from '@/lib/venue-time';
import { useSite, type ClientStrings, type LoadFailure } from '@/components/site/SiteProvider';
import { Dropdown, type Option } from '@/components/ui/Dropdown';
import { animateSelector, useOpenAnimation } from '@/lib/motion';
import { privacyHref } from '@/lib/legal';
import { Honeypot } from '@/components/overlays/Honeypot';
import { BookingError, WithPhone } from '@/components/booking/WithPhone';
import { DEFAULT_PHONE } from '@/lib/booking-errors';

/**
 * Availability that did not arrive: why, and a way to ask again when asking
 * again can help. A 404 (the restaurant stopped taking online bookings) gets
 * its own message and no Try again. The message describes the button, so a
 * guest sent here by REQUEST BOOKING hears why. tabIndex -1: REQUEST BOOKING
 * moves the focus here when there is no button to land on, and so does the
 * drawer when a 404 takes the focused button away. `onFocus` tells the drawer
 * the focus is in here, so it can keep it in the dialog when the button goes.
 */
function LoadFailed({
  count,
  code,
  strings,
  phone,
  onRetry,
  onFocus,
}: {
  count: number;
  code: LoadFailure;
  strings: ClientStrings;
  phone: GroupPhone | null;
  onRetry: () => void;
  onFocus: () => void;
}) {
  const messageId = useId();
  return (
    <div className="load-failed" tabIndex={-1} onFocus={onFocus}>
      {/* A new alert per failure, so a Try again that fails again is read out again. */}
      <div key={count} id={messageId} className="drawer-error" role="alert">
        <BookingError code={code} strings={strings} phone={phone} />
      </div>
      {code === 'network' && (
        <button type="button" className="load-retry" aria-describedby={messageId} onClick={onRetry}>
          {strings['booking.retry']}
        </button>
      )}
    </div>
  );
}

/**
 * The booking window as the server sent it. A day that takes no bookings is
 * greyed out and cannot be chosen; tapping it shows why, until another
 * calendar arrives (another restaurant's, or a fresh answer). Under the strip,
 * one live region says, in order: why a tapped day is greyed, why the chosen
 * date moved (`moved`), or, before any calendar has answered, that the dates
 * are loading. Mounted only while the drawer shows, so the note starts empty
 * on every open.
 */
function DayStrip({
  days,
  selected,
  onPick,
  strings,
  groupPhone,
  moved,
}: {
  days: DayInfo[];
  selected: IsoDate | '';
  onPick: (date: IsoDate) => void;
  strings: ClientStrings;
  groupPhone: GroupPhone | null;
  moved: DateMove | null;
}) {
  /* The unavailable day a guest last tapped, and the calendar it was tapped on. */
  const [tapped, setTapped] = useState<{ days: DayInfo[]; day: DayInfo } | null>(null);
  const note = tapped?.days === days ? tapped.day : null;
  const noDates = days.length > 0 && !days.some((d) => d.state === 'open');
  const loading = days.length === 0;
  const message = note
    ? formatMessage(strings['booking.day_note'], { date: fmtDay(note.date), reason: dayReason(note, strings) })
    : moved
      ? formatMessage(strings['booking.date_moved'], {
          date: fmtDay(moved.from),
          reason: movedReason(moved, days, strings),
          to: fmtDay(moved.to),
        })
      : loading
        ? strings['booking.loading']
        : '';

  /* The chosen day stays in view: on open (a restaurant closed for its first
     days chooses a day off-screen) and when an answer moves the date. Only the
     strip scrolls; scrollIntoView could also scroll the drawer or the page. */
  const strip = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = strip.current;
    const chip = el?.children[days.findIndex((d) => d.state === 'open' && d.date === selected)];
    if (!el || !(chip instanceof HTMLElement)) return;
    const box = el.getBoundingClientRect();
    const at = chip.getBoundingClientRect();
    // The strip's side padding is where it meets the drawer's edge: keep the chip clear of it.
    const pad = parseFloat(getComputedStyle(el).paddingLeft) || 0;
    if (at.left < box.left + pad) el.scrollLeft -= box.left + pad - at.left;
    else if (at.right > box.right - pad) el.scrollLeft += at.right - (box.right - pad);
  }, [selected, days]);

  return (
    <>
      {!loading && (
        <div ref={strip} className="daystrip">
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
      )}
      {/* Always mounted, empty when there is nothing to say, so a screen reader hears its first message. */}
      <div role="status">{message && <p className={loading ? 'slot-loading' : 'day-note'}>{message}</p>}</div>
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
    site,
    destName,
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
    failureNudge,
    invalidNudge,
    dateMoved,
    now,
    strings,
    confirmedDate,
    booked,
    form,
    setFormField,
    consent,
    setConsent,
    honeypot,
    setHoneypot,
    locale,
    errors,
    serverError,
    footLoading,
    pending,
    done,
    reference,
    submit,
  } = useSite();

  const open = overlay === 'drawer';
  const hintId = useId();
  const privacyId = useId();
  const consentErrorId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLDivElement>(null);
  const datesLabelRef = useRef<HTMLDivElement>(null);
  const timesLabelRef = useRef<HTMLDivElement>(null);

  /* A failure's Try again goes while it may hold the focus: when an answer
     comes, whoever asked for it (Try again, or REQUEST BOOKING, which focuses
     Try again and asks again itself), and when the answer is a 404, which
     keeps the message but takes the button. A removed button drops the focus
     to <body>, outside this modal dialog. So while the focus was last in a
     failure message (or Try again was clicked: Safari does not focus a
     clicked button), the render that leaves the focus outside the dialog puts
     it back, on the first of: what arrived (the chosen day, or the chosen
     time); the message, if it is still there; the section's label, when the
     answer came with nothing to choose (a closed day, every time taken, no
     open date); the drawer's heading. While the answer is still on its way,
     the label holds the focus (`parked`) and hands it on when it comes.
     Checked after every render (no dependency list): the target comes with
     an answer, and the check is a ref read while nothing is armed. */
  const restore = useRef<{ at: 'dates' | 'times'; parked: HTMLElement | null } | null>(null);
  const arm = (at: 'dates' | 'times') => {
    restore.current = { at, parked: null };
  };
  const retry = () => {
    if (loadFailed) arm(loadFailed.at);
    retryAvailability();
  };
  useLayoutEffect(() => {
    const armed = restore.current;
    if (!armed) return;
    const dialog = dialogRef.current;
    const root = drawerRef.current;
    if (!dialog || !root) {
      restore.current = null; // closed: nothing to put back on the next open
      return;
    }
    const active = document.activeElement;
    if (active && active !== armed.parked && dialog.contains(active)) {
      // Still in the message (its Try again is still there), or the guest moved on: leave the focus be.
      if (!active.closest('.load-failed')) restore.current = null;
      return;
    }
    const time =
      armed.at === 'times'
        ? (root.querySelector<HTMLElement>('.slot[data-selected="true"]') ?? root.querySelector<HTMLElement>('.slot:not([disabled])'))
        : null;
    const day = armed.at === 'dates' ? root.querySelector<HTMLElement>('.daystrip .day[aria-pressed="true"]') : null;
    const failure = root.querySelector<HTMLElement>('.load-failed');
    const label = (armed.at === 'dates' ? datesLabelRef : timesLabelRef).current;
    // No message and no answer yet: the dates, or the chosen day's times, are on their way.
    const onItsWay = !time && !day && !failure && (armed.at === 'dates' ? days.length === 0 : !!booking.date && !board);
    restore.current = onItsWay && label ? { at: armed.at, parked: label } : null;
    // A time may lie below the fold: scroll to it. The rest sit where Try again was, and the strip
    // keeps the chosen day in view itself (no scrollIntoView), so a phone's drawer does not jump.
    if (time) time.focus();
    else (day ?? failure?.querySelector<HTMLElement>('.load-retry') ?? failure ?? label ?? headingRef.current)?.focus({ preventScroll: true });
  });

  /* REQUEST BOOKING stopped on a failure shown above: take the guest to it (its Try again, or the message). */
  useEffect(() => {
    if (!failureNudge) return;
    const failure = drawerRef.current?.querySelector<HTMLElement>('.load-failed');
    (failure?.querySelector<HTMLElement>('.load-retry') ?? failure)?.focus();
  }, [failureNudge]);

  /* REQUEST BOOKING stopped on the form's own check: the first field at fault, in the order the
     guest fills them (name, phone, email, then the consent box, which always sits below the fold),
     gets the focus and comes into view, so the screen visibly answers the press. Its error is in
     its name or its description, so a screen reader says what is wrong; no second alert (risk 27). */
  useEffect(() => {
    if (!invalidNudge) return;
    const field = drawerRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    field?.focus();
    field?.scrollIntoView({ block: 'center' });
  }, [invalidNudge]);

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
  // The limit comes from the server (booking rules); until it answers, no growing.
  const noMore = maxParty === null || atLimit;
  const hint = atLimit && groupPhone;

  // Only places and restaurants that take bookings online (booking_enabled).
  const destinationOptions: Option<string>[] = bookableDestinationOptions(site.destinations, bookable);
  const restaurantOptions: Option<string>[] = bookable
    .filter((r) => r.dest === booking.destination)
    .map((r) => ({ value: r.id, label: r.name }));

  const summary = [booking.date ? fmtDay(booking.date) : '', booking.time, guestLabel(booking.guests)]
    .filter(Boolean)
    .join(' · ');

  return (
    <div ref={dialogRef} className="drawer-root" role="dialog" aria-modal="true" aria-label="Reserve a table">
      <button
        type="button"
        data-anim="backdrop"
        className="backdrop"
        aria-label="Close"
        onClick={closeDrawer}
      />

      <aside ref={drawerRef} data-anim="drawer" className="drawer">
        <div className="drawer-head">
          <div className="drawer-head-copy">
            {/* tabIndex -1, like the DATE and TIME labels: where the focus goes when nothing else is left to hold it. */}
            <div ref={headingRef} className="drawer-kicker" tabIndex={-1}>
              RESERVE A TABLE
            </div>
            {/* With every restaurant booking offline (R20) none is chosen: no empty name and meta band above the message. */}
            {restaurant && (
              <>
                <div className="drawer-name">{restaurant.name}</div>
                <div className="drawer-meta">{`${restaurant.type} · ${destName(restaurant.dest)}`}</div>
              </>
            )}
          </div>
          <button type="button" className="drawer-close" aria-label="Close" onClick={closeDrawer}>
            ×
          </button>
        </div>

        {bookable.length === 0 && !done ? (
          // Every restaurant books offline (R14): there is nothing to choose and no availability to wait
          // for, so no form, only whom to call (R20; before, "Checking tables…" stayed for good).
          <div className="drawer-body">
            <p className="drawer-error" role="alert">
              <WithPhone template={strings['booking.all_offline']} params={{}} phone={DEFAULT_PHONE} />
            </p>
          </div>
        ) : done ? (
          <div className="drawer-done">
            <div className="drawer-tick" aria-hidden="true">
              ✓
            </div>
            <div className="drawer-thanks">Thank you, {form.name.trim() || 'you'}.</div>
            {/* What was booked, as sent, in the words for its status: an auto-confirmed
                booking never waits in the pending tab, so nobody would call to confirm it. */}
            <p className="drawer-done-lede">
              {formatMessage(strings[booked?.status === 'confirmed' ? 'booking.done_confirmed' : 'booking.done_requested'], {
                restaurant: booked?.restaurantName ?? '',
              })}
            </p>
            <div className="drawer-summary">
              <div className="drawer-summary-row">
                <span>Date</span>
                <span>{confirmedDate ? fmtDay(confirmedDate) : ''}</span>
              </div>
              <div className="drawer-summary-row">
                <span>Time</span>
                <span>{booked?.time}</span>
              </div>
              <div className="drawer-summary-row">
                <span>Guests</span>
                <span>{booked ? guestLabel(booked.guests) : ''}</span>
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

              <div ref={datesLabelRef} className="drawer-label" tabIndex={-1}>
                DATE
              </div>
              {loadFailed?.at === 'dates' ? (
                <LoadFailed
                  count={loadFailed.count}
                  code={loadFailed.code}
                  strings={strings}
                  phone={groupPhone}
                  onRetry={retry}
                  onFocus={() => arm('dates')}
                />
              ) : (
                <DayStrip
                  days={days}
                  selected={booking.date}
                  onPick={(date) => setBooking({ date })}
                  strings={strings}
                  groupPhone={groupPhone}
                  moved={dateMoved?.restaurant === booking.restaurant ? dateMoved : null}
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
                  {/* aria-disabled, not disabled: a button that turns disabled loses the
                      focus to <body>, which drops a keyboard user out of the stepper at
                      the limit, just as the hint below tells them whom to call. */}
                  <button
                    type="button"
                    aria-label="More guests"
                    aria-disabled={noMore || undefined}
                    aria-describedby={hint ? hintId : undefined}
                    onClick={() => {
                      if (!noMore) setBooking({ guests: booking.guests + 1 });
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
              {/* Always mounted, empty below the limit, so the hint is read out when it appears. */}
              <div id={hintId} role="status">
                {hint && (
                  <p className="guests-hint">
                    <WithPhone
                      template={strings['error.party_too_large']}
                      params={{ max: maxParty }}
                      phone={groupPhone}
                    />
                  </p>
                )}
              </div>

              <div ref={timesLabelRef} className="drawer-label" tabIndex={-1}>
                TIME
              </div>
              {loadFailed
                ? loadFailed.at === 'times' && (
                    <LoadFailed
                      count={loadFailed.count}
                      code={loadFailed.code}
                      strings={strings}
                      phone={groupPhone}
                      onRetry={retry}
                      onFocus={() => arm('times')}
                    />
                  )
                : !board && booking.date && <div className="slot-loading">{strings['booking.loading']}</div>}
              {/* Why there is no time to choose: the day closed, or every time is taken. Always mounted,
                  empty otherwise, so a screen reader hears the news when the day's answer brings it. */}
              <div role="status">
                {board?.state === 'closed' ? (
                  <div className="drawer-error">{strings['error.closed']}</div>
                ) : (
                  !anyAvailable && <div className="drawer-error">{strings['booking.no_tables']}</div>
                )}
              </div>
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
                  <Honeypot value={honeypot} onChange={setHoneypot} />
                </div>

                {/* Spec §11: the notice at the point of collection, the policy one tap away (a new tab keeps this form), and a box only a person ticks. */}
                <div className="drawer-consent">
                  <p className="drawer-privacy" id={privacyId}>
                    {strings['booking.privacy_notice']}{' '}
                    <a href={privacyHref(locale)} target="_blank" rel="noopener">
                      {strings['legal.link']}
                    </a>
                  </p>
                  <label className="consent">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                      // The error sits outside the label (the label is the box's name), so it joins the description while it shows.
                      aria-describedby={errors.consent ? `${privacyId} ${consentErrorId}` : privacyId}
                      aria-invalid={errors.consent}
                      data-invalid={errors.consent}
                    />
                    <span>{strings['booking.consent']}</span>
                  </label>
                  {errors.consent && (
                    <span id={consentErrorId} className="field-error">
                      {strings['error.consent_required']}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="drawer-foot">
              <div className="drawer-foot-copy">
                <div className="drawer-foot-label">YOUR TABLE</div>
                <div className="drawer-foot-summary">{summary}</div>
                {serverError && (
                  <div className="drawer-error" role="alert">
                    <BookingError code={serverError.code} params={serverError.params} strings={strings} phone={groupPhone} />
                  </div>
                )}
                {/* REQUEST BOOKING waiting for the dates: news, not an error. Always mounted, so it is read out. */}
                <div className="drawer-foot-status" role="status">
                  {footLoading ? strings['booking.loading'] : null}
                </div>
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
