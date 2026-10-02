'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { DESTS, DEST_KEYS, MEAL_LABELS } from '@/lib/data';
import { FIELD_MAX, findRestaurant, fmtDay, guestLabel } from '@/lib/booking';
import { dayReason, movedReason, slotOpen, type DateMove } from '@/lib/booking/client';
import type { DayInfo } from '@/lib/booking/api';
import type { GroupPhone } from '@/lib/booking/rules';
import { formatMessage, type MessageParams } from '@/lib/i18n/format';
import { formatDay, type IsoDate } from '@/lib/venue-time';
import { useSite, type ClientStrings, type LoadFailure } from '@/components/site/SiteProvider';
import { Dropdown, type Option } from '@/components/ui/Dropdown';
import { animateSelector, useOpenAnimation } from '@/lib/motion';
import { privacyHref } from '@/lib/legal';
import { Honeypot } from '@/components/overlays/Honeypot';

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

/**
 * Availability that did not arrive: why, and a way to ask again when asking
 * again can help. A 404 (the restaurant stopped taking online bookings) gets
 * its own message and no Try again. The message describes the button, so a
 * guest sent here by REQUEST BOOKING hears why. tabIndex -1: REQUEST BOOKING
 * moves the focus here when there is no button to land on.
 */
function LoadFailed({
  count,
  code,
  strings,
  onRetry,
}: {
  count: number;
  code: LoadFailure;
  strings: ClientStrings;
  onRetry: () => void;
}) {
  const messageId = useId();
  return (
    <div className="load-failed" tabIndex={-1}>
      {/* A new alert per failure, so a Try again that fails again is read out again. */}
      <div key={count} id={messageId} className="drawer-error" role="alert">
        {strings[`error.${code}`]}
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
  const drawerRef = useRef<HTMLElement>(null);

  /* Try again removes itself once the answer arrives, and a removed button
     drops the focus to <body>, outside this modal dialog. The focus moves to
     what arrived instead: the chosen day, or the chosen time. Checked after
     every render (no dependency list): the target appears with the answer,
     and the check is a ref read until a Try again is pending. */
  const retriedAt = useRef<'dates' | 'times' | null>(null);
  const retry = () => {
    retriedAt.current = loadFailed?.at ?? null;
    retryAvailability();
  };
  useLayoutEffect(() => {
    const at = retriedAt.current;
    const root = drawerRef.current;
    if (!at || !root || loadFailed?.at === at) return; // still failing: the button is still there
    const target =
      at === 'dates'
        ? root.querySelector<HTMLElement>('.daystrip .day[aria-pressed="true"]')
        : (root.querySelector<HTMLElement>('.slot[data-selected="true"]') ?? root.querySelector<HTMLElement>('.slot:not([disabled])'));
    if (!target) return; // the times are still on their way
    retriedAt.current = null;
    if (!root.contains(document.activeElement)) target.focus();
  });

  /* REQUEST BOOKING stopped on a failure shown above: take the guest to it (its Try again, or the message). */
  useEffect(() => {
    if (!failureNudge) return;
    const failure = drawerRef.current?.querySelector<HTMLElement>('.load-failed');
    (failure?.querySelector<HTMLElement>('.load-retry') ?? failure)?.focus();
  }, [failureNudge]);

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

      <aside ref={drawerRef} data-anim="drawer" className="drawer">
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

              <div className="drawer-label">DATE</div>
              {loadFailed?.at === 'dates' ? (
                <LoadFailed count={loadFailed.count} code={loadFailed.code} strings={strings} onRetry={retry} />
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

              <div className="drawer-label">TIME</div>
              {loadFailed
                ? loadFailed.at === 'times' && (
                    <LoadFailed count={loadFailed.count} code={loadFailed.code} strings={strings} onRetry={retry} />
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
                  <Honeypot value={honeypot} onChange={setHoneypot} />
                </div>

                {/* Spec §11: the notice at the point of collection, the policy one tap away (a new tab keeps this form), and a box only a person ticks. */}
                <div className="drawer-consent">
                  <p className="drawer-privacy" id="drawer-privacy">
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
                      aria-describedby="drawer-privacy"
                      aria-invalid={errors.consent}
                      data-invalid={errors.consent}
                    />
                    <span>{strings['booking.consent']}</span>
                  </label>
                  {errors.consent && <span className="field-error">{strings['error.consent_required']}</span>}
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
