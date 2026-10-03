'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { SiteContent } from '@/lib/content/types';
import type { Restaurant } from '@/lib/data';
import { findRestaurant, validate, type Booking, type BookingForm } from '@/lib/booking';
import {
  boardFor,
  bookableRestaurants,
  bookingOpen,
  calendarFor,
  dateMove,
  reconcileBooking,
  type BookingContext,
  type DateMove,
} from '@/lib/booking/client';
import type { CalendarResponse, DayInfo, DayResponse } from '@/lib/booking/api';
import { clockBlock } from '@/lib/booking/resolve-day';
import type { GroupPhone } from '@/lib/booking/rules';
import type { BookingErrorCode } from '@/lib/booking-errors';
import type { ClientKey } from '@/lib/i18n/registry';
import type { IsoDate } from '@/lib/venue-time';
import { submitReservation } from '@/app/actions';
import { coverThen } from '@/components/site/PageCurtain';
import { homeHref, restaurantHref } from '@/lib/i18n/href';
import { markHero } from '@/lib/content/home-sections';

export type Filter = { cuisine: string; occasion: string; destination: string };
export type Finder = Filter & { location: string };
export type Overlay = 'drawer' | 'search' | 'menu' | 'film' | 'sheet';
/** 'other': a page with no view of its own (an unknown restaurant), so the chrome's links go home. */
export type View = 'home' | 'detail' | 'other';

/**
 * The page currently on screen, as registered by its <ViewMarker>. `restaurant`
 * is a detail page's slug; `hero` is false for a home page without its hero.
 */
export type PageView = { view: View; restaurant: string | null; root: HTMLElement; hero: boolean };

const EMPTY_FORM: BookingForm = { name: '', phone: '', email: '', note: '' };

export type ClientStrings = Record<ClientKey, string>;

/** `gone`: a 404, the restaurant takes no online bookings (any more); asking again cannot help. */
type Fetched<T> = { ok: true; data: T } | { ok: false; gone: boolean };

async function getJson<T>(url: string): Promise<Fetched<T>> {
  const r = await fetch(url);
  return r.ok ? { ok: true, data: (await r.json()) as T } : { ok: false, gone: r.status === 404 };
}

const NO_DAYS: DayInfo[] = [];

/** What was booked, as sent: later answers for the open form must not change the done screen. */
export type Booked = { status: 'requested' | 'confirmed'; time: string; guests: number; restaurantName: string };

/**
 * Availability that did not arrive (an HTTP error, or no network), and what it
 * was for: the calendar's restaurant, the board's restaurant and date.
 * `gone`: the answer was a 404 (the restaurant stopped taking bookings).
 */
type Failed = {
  calendar: { restaurant: string; gone: boolean } | null;
  board: { restaurant: string; date: IsoDate; gone: boolean } | null;
  count: number;
};

/** Why availability is missing, as the drawer and the booking bar say it (error.<code>). */
export type LoadFailure = 'network' | 'restaurant_unavailable';

/**
 * A footer status about the dates still to come, from a REQUEST BOOKING
 * pressed before they arrived. A failure is said once, where the dates or
 * times would be, beside its Try again; the footer never repeats it.
 */
type WaitNote = { restaurant: string };

/** A failure the footer says: its error.<code> and the params that fill it. */
export type ServerError = { code: BookingErrorCode; params: Record<string, string> };

/* The two forms of GET /api/availability (lib/booking/api.ts). */
const calendarUrl = (restaurant: string, locale: string) =>
  `/api/availability?restaurant=${encodeURIComponent(restaurant)}&lang=${encodeURIComponent(locale)}`;
const dayUrl = (restaurant: string, date: IsoDate, locale: string) =>
  `${calendarUrl(restaurant, locale)}&date=${date}`;

type SiteState = {
  /** The URL locale code (`en`). */
  locale: string;
  restaurants: Restaurant[];
  /** The chrome's content in this language (cuisines, destinations, nav, socials, sections, settings). */
  site: SiteContent;
  /** A destination's name in this language ('' for an unknown id or a teaser without one). */
  destName: (id: string) => string;
  /** Which page is showing; 'home' until the first <ViewMarker> registers. */
  view: View;
  /** The visible page's <main>; DOM queries search inside it. */
  pageRoot: HTMLElement | null;
  /** Called by <ViewMarker> when its page shows; returns the hide callback. */
  showPage: (page: PageView) => () => void;
  scrolled: boolean;
  tab: 'explore' | 'restaurants' | 'reserve';

  finder: Finder;
  filter: Filter;
  matches: (r: Restaurant) => boolean;
  shownCount: number;
  setFinder: (patch: Partial<Finder>) => void;
  setFilter: (patch: Partial<Filter>) => void;
  clearFilters: () => void;
  applyFinder: () => void;
  pickCuisine: (cuisine: string) => void;
  pickDestination: (key: string) => void;

  booking: Booking;
  setBooking: (patch: Partial<Booking>) => void;
  /** Restaurants that take bookings online (booking_enabled): the form's list and every RESERVE button. */
  bookable: Restaurant[];
  /** Da Nang's today by the server's clock; null until /api/availability has answered (and during the server render). */
  today: IsoDate | null;
  /** The booking window as the server sees it, today first; empty until it has answered. */
  days: DayInfo[];
  /** The online party limit for the chosen restaurant; null until known. */
  maxParty: number | null;
  /** Who to call for a larger group; null until known. */
  groupPhone: GroupPhone | null;
  /** The slots for the chosen restaurant and date; null while they load. */
  board: DayResponse | null;
  /**
   * The availability the form needs did not arrive (an HTTP error, or no
   * network): 'dates' when there is no calendar for this restaurant, else
   * 'times' when there is no board for the chosen day; null otherwise.
   * `count` changes on every failure, so a repeated one can be read out again.
   * `code` says why: 'restaurant_unavailable' (a 404) offers no Try again.
   */
  loadFailed: { at: 'dates' | 'times'; count: number; code: LoadFailure } | null;
  /** Asks again for the chosen restaurant's calendar and day (the drawer's Try again). */
  retryAvailability: () => void;
  /**
   * Changes each time REQUEST BOOKING stops on a failure the drawer already
   * shows (loadFailed): the drawer moves the focus to that message's Try again
   * instead of saying the same thing twice.
   */
  failureNudge: number;
  /**
   * Changes each time REQUEST BOOKING stops on the form's own check (a name,
   * phone, email or the consent box): the drawer takes the guest to the first
   * field that blocks it, which may be below the fold. A counter, not a flag:
   * `tried` is already true on the second press.
   */
  invalidNudge: number;
  /**
   * The chosen date a calendar's answer replaced (another restaurant does not
   * take it, or fresh availability greyed it), so the drawer can say so; null
   * once the guest picks a date or closes the drawer.
   */
  dateMoved: DateMove | null;
  /** The server's clock, as last reported by /api/availability. */
  now: () => Date;
  /** The reservation form's copy and error messages for this language. */
  strings: ClientStrings;
  /** The date the server stored for the last confirmed request. */
  confirmedDate: IsoDate | '';
  /** The last booking made, as sent, with the status the server gave it; null until done. */
  booked: Booked | null;
  form: BookingForm;
  setFormField: (key: keyof BookingForm, value: string) => void;
  /** The privacy consent box (spec §11); the request is not sent without it. */
  consent: boolean;
  setConsent: (value: boolean) => void;
  /** The hidden honeypot field's value (components/overlays/Honeypot.tsx); people leave it empty. */
  honeypot: string;
  setHoneypot: (value: string) => void;
  tried: boolean;
  done: boolean;
  pending: boolean;
  reference: string;
  /**
   * The footer's alert: why REQUEST BOOKING did not book, as error.<code> and
   * its params; the drawer renders it with the number to call as a link.
   */
  serverError: ServerError | null;
  /** REQUEST BOOKING is waiting for the dates, which are on their way (the footer's status says so). */
  footLoading: boolean;
  errors: { name: boolean; phone: boolean; email: boolean; consent: boolean };
  submit: () => void;

  overlay: Overlay | null;
  /** Opens the form; from VIEW OFFER with the offer, whose title goes into an empty note and whose id goes with the request (R9). */
  openReserve: (preset?: Partial<Booking>, offer?: { id: number; title: string }) => void;
  closeDrawer: () => void;
  open: (o: Overlay) => void;
  close: () => void;

  query: string;
  setQuery: (q: string) => void;

  lang: 'EN' | 'VI';
  setLang: (l: 'EN' | 'VI') => void;

  openDropdown: string | null;
  toggleDropdown: (id: string) => void;
  closeDropdown: () => void;

  scrollToId: (id: string) => void;
  goHomeTop: () => void;
  goBackToRestaurants: () => void;
  openRestaurant: (r: Restaurant) => void;
};

const SiteContext = createContext<SiteState | null>(null);

export function useSite(): SiteState {
  const ctx = useContext(SiteContext);
  if (!ctx) throw new Error('useSite must be used inside <SiteProvider>');
  return ctx;
}

export function SiteProvider({
  locale,
  restaurants,
  site,
  strings,
  children,
}: {
  locale: string;
  restaurants: Restaurant[];
  /** The chrome's content (lib/server/content/site.ts), resolved on the server for this language. */
  site: SiteContent;
  /** The booking.* and error.* copy for this language, resolved on the server (DB override, else registry). */
  strings: ClientStrings;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const home = homeHref(locale);
  const [page, setPage] = useState<PageView | null>(null);
  const view: View = page?.view ?? 'home';
  /* Changes once per page shown; DOM-dependent effects key on it. */
  const pageRoot = page?.root ?? null;

  const showPage = useCallback((next: PageView) => {
    setPage(next);
    // Drives the view-specific chrome CSS (styles/layout.css, styles/booking.css).
    document.documentElement.dataset.view = next.view;
    // html[data-hero='none'] only while a home page without its hero shows; every other page takes it off.
    markHero(document.documentElement.dataset, next);
    return () => setPage((cur) => (cur === next ? null : cur));
  }, []);

  const [scrolled, setScrolled] = useState(false);
  const [tab, setTab] = useState<SiteState['tab']>('explore');
  const [finder, setFinderState] = useState<Finder>({
    location: 'Da Nang',
    cuisine: 'all',
    // site_settings.default_occasion; NULL: any occasion.
    occasion: site.settings.defaultOccasion ?? 'all',
    destination: 'all',
  });
  const [filter, setFilterState] = useState<Filter>({
    cuisine: 'all',
    occasion: 'all',
    destination: 'all',
  });
  const bookable = useMemo(() => bookableRestaurants(restaurants), [restaurants]);
  const destNames = useMemo(() => new Map(site.destinations.map((d) => [d.id, d.name ?? ''])), [site.destinations]);
  const destName = useCallback((id: string) => destNames.get(id) ?? '', [destNames]);
  const [booking, setBookingState] = useState<Booking>(() => {
    // Spec §5.2 site_settings.default_restaurant_id: the first bookable restaurant when that one is not (or is NULL).
    const first = bookable.find((r) => r.id === site.settings.defaultRestaurantId) ?? bookable[0];
    return { destination: first?.dest ?? 'resort', restaurant: first?.id ?? '', date: '', time: '19:00', guests: 2 };
  });
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [board, setBoard] = useState<DayResponse | null>(null);
  const [form, setForm] = useState<BookingForm>(EMPTY_FORM);
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState('');
  const [tried, setTried] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [reference, setReference] = useState('');
  const [serverError, setServerError] = useState<ServerError | null>(null);
  /* Cleared when the answer it is about arrives (answered); shown only while
     the choice is still the one it is about (footNote below), so it neither
     outlives the answer nor shows during a switch to another restaurant. */
  const [waitNote, setWaitNote] = useState<WaitNote | null>(null);
  const [failureNudge, setFailureNudge] = useState(0);
  const [invalidNudge, setInvalidNudge] = useState(0);
  const [clockOffset, setClockOffset] = useState(0);
  const [confirmedDate, setConfirmedDate] = useState<IsoDate | ''>('');
  const [booked, setBooked] = useState<Booked | null>(null);
  const [dateMoved, setDateMoved] = useState<DateMove | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  /* The offer the form was opened from, and its restaurant (R9): sent only while that is the restaurant chosen. */
  const [offer, setOffer] = useState<{ id: number; restaurant: string } | null>(null);
  /* A move note belongs to the drawer visit it was shown in. Many paths close
     the overlay (×, Escape, a link), so the drop happens here, on the change,
     adjusting state during render; a move made from the booking bar while the
     drawer is shut still shows when it opens. */
  const drawerOpen = overlay === 'drawer';
  const [drawerWasOpen, setDrawerWasOpen] = useState(drawerOpen);
  if (drawerWasOpen !== drawerOpen) {
    setDrawerWasOpen(drawerOpen);
    if (!drawerOpen) setDateMoved(null);
  }
  const [query, setQuery] = useState('');
  const [lang, setLang] = useState<'EN' | 'VI'>('EN');
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const pendingScroll = useRef<string | null>(null);
  /* The latest booking and answers, for callbacks that must not re-create on every change. */
  const latest = useRef({ booking, calendar, board });
  latest.current = { booking, calendar, board };
  /* Only the newest request of each kind may land: a slow answer for the
     previous restaurant or date must not overwrite the current one. */
  const calendarSeq = useRef(0);
  const boardSeq = useRef(0);
  /* Which answers did not arrive, and for what. Only the newest request of a
     kind sets or clears its flag, and the flag stays until a later request of
     that kind answers, so a Try again that fails again leaves the message (and
     the focus on its button) where it was. A flag counts only while it matches
     the current choice (loadFailed): one restaurant's or day's failure says
     nothing about another, even while the other's answer is on its way. */
  const [failed, setFailed] = useState<Failed>({ calendar: null, board: null, count: 0 });
  const settleCalendar = useCallback((restaurant: string, ok: boolean, gone = false) => {
    setFailed((f) =>
      ok ? (f.calendar === null ? f : { ...f, calendar: null }) : { ...f, calendar: { restaurant, gone }, count: f.count + 1 },
    );
  }, []);
  const settleBoard = useCallback((restaurant: string, date: IsoDate, ok: boolean, gone = false) => {
    setFailed((f) =>
      ok ? (f.board === null ? f : { ...f, board: null }) : { ...f, board: { restaurant, date, gone }, count: f.count + 1 },
    );
  }, []);
  /* The dates answered (or failed, which shows where they would be, with its Try again): the footer's wait note goes. */
  const answered = useCallback((restaurant: string) => {
    setWaitNote((n) => (n && n.restaurant === restaurant ? null : n));
  }, []);

  const now = useCallback(() => new Date(Date.now() + clockOffset), [clockOffset]);

  const context = useCallback(
    (at: Date, over: Partial<BookingContext> = {}): BookingContext => ({
      restaurants: bookable,
      calendar: latest.current.calendar,
      board: latest.current.board,
      now: at,
      ...over,
    }),
    [bookable],
  );

  const setBooking = useCallback(
    (patch: Partial<Booking>) => {
      // The guest picked a date: an earlier move is no longer news.
      if (patch.date !== undefined) setDateMoved(null);
      setBookingState((b) => reconcileBooking(b, patch, context(now())));
    },
    [context, now],
  );

  /* The calendar: which days of the window take bookings, the party limit,
     and the server's today and clock. Nothing date-related renders before it
     answers, so the server render carries no date at all (hydration #418).
     When it refuses the chosen date, its answer moves to the nearest open day
     and records the move, so the drawer can say so. */
  const loadCalendar = useCallback(
    (restaurant: string) => {
      const seq = ++calendarSeq.current;
      getJson<CalendarResponse>(calendarUrl(restaurant, locale))
        .then((res) => {
          if (seq !== calendarSeq.current) return;
          settleCalendar(restaurant, res.ok, !res.ok && res.gone);
          answered(restaurant);
          if (!res.ok) return;
          const data = res.data;
          const serverNow = new Date(data.now);
          const ctx = context(serverNow, { calendar: data });
          // Outside the updater below, which React may run twice: what this answer does to the date on screen.
          const shown = latest.current.booking;
          const move = dateMove(shown, reconcileBooking(shown, {}, ctx), data);
          // A fresh answer for the same restaurant keeps an earlier move (openReserve asks again); another's drops it.
          setDateMoved((m) => move ?? (m?.restaurant === data.restaurant ? m : null));
          setClockOffset(serverNow.getTime() - Date.now());
          setCalendar(data);
          setBookingState((b) => reconcileBooking(b, {}, ctx));
        })
        .catch(() => {
          if (seq !== calendarSeq.current) return;
          settleCalendar(restaurant, false);
          answered(restaurant);
        });
    },
    [answered, context, locale, settleCalendar],
  );

  /* The slots of one day, with the covers left. A slot that filled or closed
     while the drawer was open slides the time to the nearest open one. Not
     keyed on the party size: the browser checks the party against `left`. */
  const loadBoard = useCallback(
    (restaurant: string, date: IsoDate) => {
      const seq = ++boardSeq.current;
      getJson<DayResponse>(dayUrl(restaurant, date, locale))
        .then((res) => {
          if (seq !== boardSeq.current) return;
          settleBoard(restaurant, date, res.ok, !res.ok && res.gone);
          if (!res.ok) return;
          const data = res.data;
          // The date left the window (a tab open past midnight): the calendar's answer moves it.
          if (data.state === 'outside') {
            loadCalendar(restaurant);
            return;
          }
          const serverNow = new Date(data.now);
          setClockOffset(serverNow.getTime() - Date.now());
          setBoard(data);
          setBookingState((b) => reconcileBooking(b, {}, context(serverNow, { board: data })));
        })
        .catch(() => {
          if (seq === boardSeq.current) settleBoard(restaurant, date, false);
        });
    },
    [context, loadCalendar, locale, settleBoard],
  );

  useEffect(() => {
    if (booking.restaurant) loadCalendar(booking.restaurant);
  }, [booking.restaurant, loadCalendar]);

  useEffect(() => {
    if (booking.restaurant && booking.date) loadBoard(booking.restaurant, booking.date);
  }, [booking.restaurant, booking.date, loadBoard]);

  const retryAvailability = useCallback(() => {
    const { restaurant, date } = latest.current.booking;
    if (restaurant) loadCalendar(restaurant);
    if (restaurant && date) loadBoard(restaurant, date);
  }, [loadBoard, loadCalendar]);

  const setFinder = useCallback((patch: Partial<Finder>) => {
    setFinderState((f) => ({ ...f, ...patch }));
  }, []);

  const setFilter = useCallback((patch: Partial<Filter>) => {
    setFilterState((f) => ({ ...f, ...patch }));
    setFinderState((f) => ({ ...f, ...patch }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilter({ cuisine: 'all', occasion: 'all', destination: 'all' });
  }, [setFilter]);

  const matches = useCallback(
    (r: Restaurant) =>
      (filter.cuisine === 'all' || r.cuisines.includes(filter.cuisine)) &&
      (filter.destination === 'all' || r.dest === filter.destination) &&
      (filter.occasion === 'all' || (r.meals as string[]).includes(filter.occasion)),
    [filter],
  );

  const shownCount = useMemo(() => restaurants.filter(matches).length, [matches, restaurants]);

  const close = useCallback(() => {
    setOverlay(null);
    setOpenDropdown(null);
  }, []);

  const open = useCallback((o: Overlay) => {
    setOverlay(o);
    setOpenDropdown(null);
    if (o === 'search') setQuery('');
  }, []);

  /* Only the visible page counts: hidden <Activity> pages keep their sections in the DOM. */
  const findSection = useCallback(
    (id: string) => page?.root.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`) ?? null,
    [page],
  );

  const scrollTo = useCallback((id: string) => {
    const el = findSection(id);
    if (!el) return;
    const offset = window.innerWidth < 1080 ? 63 : 75;
    window.scrollTo({
      top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - offset),
      behavior: 'smooth',
    });
  }, [findSection]);

  const scrollToId = useCallback(
    (id: string) => {
      setOverlay(null);
      setOpenDropdown(null);
      if (!findSection(id) && view !== 'home') {
        pendingScroll.current = id;
        coverThen(() => router.push(home));
        return;
      }
      window.setTimeout(() => scrollTo(id), 30);
    },
    [findSection, home, router, scrollTo, view],
  );

  /* A cross-view scroll target survives the route change and fires once the
     destination page has registered. */
  useEffect(() => {
    const id = pendingScroll.current;
    if (!id || !pageRoot) return;
    pendingScroll.current = null;
    const frame = requestAnimationFrame(() => scrollTo(id));
    return () => cancelAnimationFrame(frame);
  }, [pageRoot, scrollTo]);

  const goHomeTop = useCallback(() => {
    setOverlay(null);
    if (view !== 'home') coverThen(() => router.push(home));
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [home, router, view]);

  const goBackToRestaurants = useCallback(() => {
    pendingScroll.current = 'restaurants';
    setOverlay(null);
    coverThen(() => router.push(home));
  }, [home, router]);

  const openReserve = useCallback(
    (preset?: Partial<Booking>, from?: { id: number; title: string }) => {
      setOverlay('drawer');
      setOpenDropdown(null);
      setDone(false);
      setBooked(null);
      setTried(false);
      setServerError(null);
      setWaitNote(null);
      // A restaurant that does not book online is ignored here (reconcileBooking keeps the current one).
      const next = reconcileBooking(latest.current.booking, { ...preset }, context(now()));
      if (from) {
        // The note still names the offer, as before phase 6; reservations.offer_id now says it for staff.
        const note = `Offer: ${from.title}`;
        setForm((f) => (f.note ? f : { ...f, note }));
        setOffer({ id: from.id, restaurant: preset?.restaurant ?? next.restaurant });
      }
      setBookingState(next);
      // Ask again: the tab may have been open past midnight, or a closure or a booking changed the picture.
      if (next.restaurant) loadCalendar(next.restaurant);
      if (next.restaurant && next.date) loadBoard(next.restaurant, next.date);
    },
    [context, loadBoard, loadCalendar, now],
  );

  const closeDrawer = useCallback(() => {
    setOverlay(null);
    if (done) {
      setDone(false);
      setBooked(null);
      setTried(false);
      setServerError(null);
      setOffer(null);
      setForm(EMPTY_FORM);
      setConsent(false);
      setHoneypot('');
    }
  }, [done]);

  const openRestaurant = useCallback(
    (r: Restaurant) => {
      if (!r.hasDetailPage) {
        // Its action is reserving; with online booking off (R14) it is calling, when there is a number (R20).
        if (r.bookingEnabled) openReserve({ restaurant: r.id });
        else if (r.phone) window.location.assign(`tel:${r.phone.tel}`);
        return;
      }
      setBooking({ restaurant: r.id });
      setOverlay(null);
      setOpenDropdown(null);
      if (page?.view === 'detail' && page.restaurant === r.slug) return;
      coverThen(() => router.push(restaurantHref(locale, r.slug)));
    },
    [locale, openReserve, page, router, setBooking],
  );

  const valid = useMemo(() => validate(form), [form]);
  const errors = useMemo(
    () => ({ name: tried && !valid.name, phone: tried && !valid.phone, email: tried && !valid.email, consent: tried && !consent }),
    [tried, valid, consent],
  );
  /* The chosen restaurant's group phone fills {phone} in a refusal the server sends without one (bot_blocked, too_many_requests). */
  const errorParams = useCallback((restaurant: string, params: Record<string, string> = {}) => {
    const phone = calendarFor(latest.current.calendar, restaurant)?.groupPhone;
    return phone ? { phone: phone.display, ...params } : params;
  }, []);

  const submit = useCallback(() => {
    setServerError(null);
    setWaitNote(null);
    const { restaurant, date } = booking;
    const at = now();
    const ctx = context(at);
    if (!(valid.name && valid.phone && valid.email && consent)) {
      setTried(true);
      // The field at fault may be below the fold (the consent box always is): the drawer goes there.
      setInvalidNudge((n) => n + 1);
      return;
    }
    if (restaurant && !calendarFor(ctx.calendar, restaurant)) {
      // No dates for this restaurant yet, so nothing to book. They failed: the
      // drawer already says so, so point the guest at it (one alert, not two)
      // and ask again, unless the restaurant has stopped taking bookings. Or
      // they are on their way: say so and wait (asking again would only
      // restart the request every click); their answer clears the note.
      setTried(true);
      if (failed.calendar?.restaurant === restaurant) {
        setFailureNudge((n) => n + 1);
        if (!failed.calendar.gone) loadCalendar(restaurant);
      } else setWaitNote({ restaurant });
      return;
    }
    if (!date) {
      setTried(true); // no open day: the note under the strip says whom to call
      return;
    }
    const day = boardFor(ctx.board, restaurant, date);
    if (!day && failed.board?.restaurant === restaurant && failed.board.date === date) {
      // The guest never saw this day's times: sending would book the default time unseen.
      // The drawer says why beside its Try again; take the guest there.
      setTried(true);
      setFailureNudge((n) => n + 1);
      return;
    }
    // Without the day's board (still on its way) the server alone decides.
    if (day && !bookingOpen(ctx, booking)) {
      setTried(true);
      if (day.state === 'closed') {
        // A closure came after the calendar: say so, and fetch the calendar
        // again, which greys the day and moves the date off it.
        setServerError({ code: 'closed', params: {} });
        loadCalendar(restaurant);
      } else {
        // The form is fine, so the slot is the problem (it closed or filled
        // while the drawer sat open): say so and slide to the nearest open one.
        const past = clockBlock(date, booking.time, at, day) !== null;
        setServerError({ code: past ? 'past' : 'full', params: {} });
        setBookingState((b) => reconcileBooking(b, {}, context(at)));
      }
      return;
    }

    setPending(true);
    // As sent: a board answering after this must not change what the done screen says was booked.
    const sent = {
      time: booking.time,
      guests: booking.guests,
      restaurantName: findRestaurant(restaurants, restaurant)?.name ?? '',
    };
    submitReservation({
      restaurant: booking.restaurant,
      date,
      time: booking.time,
      guests: booking.guests,
      name: form.name,
      phone: form.phone,
      email: form.email,
      note: form.note,
      locale,
      consent,
      honeypot,
      ...(offer && offer.restaurant === booking.restaurant ? { offerId: offer.id } : {}),
    })
      .then((result) => {
        if (result.ok) {
          setReference(result.data.reference);
          setConfirmedDate(result.data.date);
          setBooked({ status: result.data.status, ...sent });
          setDone(true);
          return;
        }
        setServerError({ code: result.code, params: errorParams(booking.restaurant, result.params) });
        setTried(true);
        // Ask again so a lost race (or a new closure) shows up at once; the
        // answers move the time off a slot that has just filled.
        loadCalendar(booking.restaurant);
        loadBoard(booking.restaurant, date);
      })
      // No answer: the network, the 5 s phone lock timing out (risk 16), or BotID's challenge
      // failing or passing its deadline (lib/botid.ts). Every one names the number to call.
      .catch(() => setServerError({ code: 'network', params: errorParams(booking.restaurant) }))
      .finally(() => setPending(false));
  }, [booking, consent, context, errorParams, failed, form, honeypot, loadBoard, loadCalendar, locale, now, offer, restaurants, valid]);

  const setFormField = useCallback((key: keyof BookingForm, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  const applyFinder = useCallback(() => {
    setFilterState({
      cuisine: finder.cuisine,
      occasion: finder.occasion,
      destination: finder.destination,
    });
    scrollToId('restaurants');
  }, [finder, scrollToId]);

  const pickCuisine = useCallback(
    (cuisine: string) => {
      setFilter({ cuisine: filter.cuisine === cuisine ? 'all' : cuisine });
    },
    [filter.cuisine, setFilter],
  );

  const pickDestination = useCallback(
    (key: string) => {
      setFilter({ destination: key, cuisine: 'all', occasion: 'all' });
      scrollToId('restaurants');
    },
    [scrollToId, setFilter],
  );

  const toggleDropdown = useCallback((id: string) => {
    setOpenDropdown((cur) => (cur === id ? null : id));
  }, []);

  const closeDropdown = useCallback(() => setOpenDropdown(null), []);

  /* Header solidity, plus which pill the mobile bar highlights. */
  useEffect(() => {
    const sync = () => {
      const y = window.scrollY || 0;
      const vh = window.innerHeight || 800;
      let nextTab: SiteState['tab'] = 'explore';
      const r = pageRoot?.querySelector('#restaurants');
      const d = pageRoot?.querySelector('#destinations');
      if (r && d) {
        const rt = r.getBoundingClientRect().top;
        const dt = d.getBoundingClientRect().top;
        if (rt < vh * 0.55 && dt > vh * 0.55) nextTab = 'restaurants';
      }
      setScrolled(y > 40);
      setTab(nextTab);
    };
    sync();
    window.addEventListener('scroll', sync, { passive: true });
    return () => window.removeEventListener('scroll', sync);
  }, [pageRoot]);

  /* Escape closes everything; a click outside a dropdown closes just that. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpenDropdown(null);
      setOverlay(null);
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-dd]')) return;
      setOpenDropdown(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, []);

  /* Lock the page behind any overlay. */
  useEffect(() => {
    document.documentElement.style.overflow = overlay ? 'hidden' : '';
    return () => {
      document.documentElement.style.overflow = '';
    };
  }, [overlay]);

  /* Each page shown starts at the top (the pending-scroll effect above may then move it). */
  useEffect(() => {
    if (pageRoot) window.scrollTo(0, 0);
  }, [pageRoot]);

  const chosenCalendar = calendarFor(calendar, booking.restaurant);
  const maxParty = chosenCalendar?.maxParty ?? null;
  const groupPhone = chosenCalendar?.groupPhone ?? null;
  const chosenBoard = boardFor(board, booking.restaurant, booking.date);
  /* The last calendar answered, even for the previous restaurant, so the strip does not blink on a switch. */
  const days = calendar?.days ?? NO_DAYS;
  const today = calendar?.today ?? null;
  /* A failure shows only where it leaves the form with nothing true to show,
     and only for what is chosen now: the dates (no calendar for this
     restaurant), else the chosen day's times. */
  const loadFailed = useMemo<SiteState['loadFailed']>(() => {
    const code = (gone: boolean): LoadFailure => (gone ? 'restaurant_unavailable' : 'network');
    const dates = failed.calendar;
    if (dates?.restaurant === booking.restaurant && !chosenCalendar) return { at: 'dates', count: failed.count, code: code(dates.gone) };
    const day = failed.board;
    if (day && day.restaurant === booking.restaurant && day.date === booking.date && !chosenBoard) {
      return { at: 'times', count: failed.count, code: code(day.gone) };
    }
    return null;
  }, [booking.date, booking.restaurant, chosenBoard, chosenCalendar, failed]);
  /* The footer's wait note, while the restaurant is still the one it is about. */
  const footLoading = waitNote !== null && waitNote.restaurant === booking.restaurant;

  const value = useMemo<SiteState>(
    () => ({
      locale,
      restaurants,
      site,
      destName,
      view,
      pageRoot,
      showPage,
      scrolled,
      tab: overlay === 'drawer' ? 'reserve' : tab,
      finder,
      filter,
      matches,
      shownCount,
      setFinder,
      setFilter,
      clearFilters,
      applyFinder,
      pickCuisine,
      pickDestination,
      booking,
      setBooking,
      bookable,
      today,
      days,
      maxParty,
      groupPhone,
      board: chosenBoard,
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
      tried,
      done,
      pending,
      reference,
      serverError,
      footLoading,
      errors,
      submit,
      overlay,
      openReserve,
      closeDrawer,
      open,
      close,
      query,
      setQuery,
      lang,
      setLang,
      openDropdown,
      toggleDropdown,
      closeDropdown,
      scrollToId,
      goHomeTop,
      goBackToRestaurants,
      openRestaurant,
    }),
    [
      applyFinder, booked, booking, bookable, chosenBoard, clearFilters, close, closeDrawer, closeDropdown,
      confirmedDate, consent, dateMoved, days, destName, done, errors, failureNudge, filter, finder, footLoading, form, goBackToRestaurants,
      goHomeTop, groupPhone, honeypot, invalidNudge, lang, loadFailed, locale, matches, maxParty, now, open, openDropdown, openReserve,
      openRestaurant, overlay, pageRoot, pending, pickCuisine, pickDestination, query, reference, restaurants,
      retryAvailability, scrollToId, scrolled, serverError, setBooking, setFilter, setFinder, setFormField, showPage, shownCount, site,
      strings, submit, tab, today, toggleDropdown, tried, view,
    ],
  );

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

export { findRestaurant };
