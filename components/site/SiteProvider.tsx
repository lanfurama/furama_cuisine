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
import type { DestKey, Restaurant } from '@/lib/data';
import { findRestaurant, validate, type Booking, type BookingForm } from '@/lib/booking';
import {
  boardFor,
  bookableRestaurants,
  bookingOpen,
  calendarFor,
  reconcileBooking,
  type BookingContext,
} from '@/lib/booking/client';
import type { CalendarResponse, DayInfo, DayResponse } from '@/lib/booking/api';
import { clockBlock } from '@/lib/booking/resolve-day';
import type { GroupPhone } from '@/lib/booking/rules';
import { bookingErrorMessage } from '@/lib/booking-errors';
import type { ClientKey } from '@/lib/i18n/registry';
import type { IsoDate } from '@/lib/venue-time';
import { submitReservation } from '@/app/actions';
import { coverThen } from '@/components/site/PageCurtain';
import { homeHref, restaurantHref } from '@/lib/i18n/href';

export type Filter = { cuisine: string; occasion: string; destination: string };
export type Finder = Filter & { location: string };
export type Overlay = 'drawer' | 'search' | 'menu' | 'film' | 'sheet';
/** 'other': a page with no view of its own (an unknown restaurant), so the chrome's links go home. */
export type View = 'home' | 'detail' | 'other';

/** The page currently on screen, as registered by its <ViewMarker>. `restaurant` is a detail page's slug. */
export type PageView = { view: View; restaurant: string | null; root: HTMLElement };

const EMPTY_FORM: BookingForm = { name: '', phone: '', email: '', note: '' };

export type ClientStrings = Record<ClientKey, string>;

type Fetched<T> = { ok: true; data: T } | { ok: false };

async function getJson<T>(url: string): Promise<Fetched<T>> {
  const r = await fetch(url);
  return r.ok ? { ok: true, data: (await r.json()) as T } : { ok: false };
}

const NO_DAYS: DayInfo[] = [];

/* The two forms of GET /api/availability (lib/booking/api.ts). */
const calendarUrl = (restaurant: string, locale: string) =>
  `/api/availability?restaurant=${encodeURIComponent(restaurant)}&lang=${encodeURIComponent(locale)}`;
const dayUrl = (restaurant: string, date: IsoDate, locale: string) =>
  `${calendarUrl(restaurant, locale)}&date=${date}`;

type SiteState = {
  /** The URL locale code (`en`). */
  locale: string;
  restaurants: Restaurant[];
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
  pickDestination: (key: DestKey) => void;

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
   */
  loadFailed: { at: 'dates' | 'times'; count: number } | null;
  /** Asks again for the chosen restaurant's calendar and day (the drawer's Try again). */
  retryAvailability: () => void;
  /** The server's clock, as last reported by /api/availability. */
  now: () => Date;
  /** The reservation form's copy and error messages for this language. */
  strings: ClientStrings;
  /** The date the server stored for the last confirmed request. */
  confirmedDate: IsoDate | '';
  form: BookingForm;
  setFormField: (key: keyof BookingForm, value: string) => void;
  tried: boolean;
  done: boolean;
  pending: boolean;
  reference: string;
  serverError: string | null;
  errors: { name: boolean; phone: boolean; email: boolean };
  submit: () => void;

  overlay: Overlay | null;
  openReserve: (preset?: Partial<Booking>, note?: string) => void;
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
  defaultRestaurantId,
  strings,
  children,
}: {
  locale: string;
  restaurants: Restaurant[];
  /** The restaurant the booking bar starts on (DEFAULT_RESTAURANT_ID until phase 6). */
  defaultRestaurantId: string;
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
    return () => setPage((cur) => (cur === next ? null : cur));
  }, []);

  const [scrolled, setScrolled] = useState(false);
  const [tab, setTab] = useState<SiteState['tab']>('explore');
  const [finder, setFinderState] = useState<Finder>({
    location: 'Da Nang',
    cuisine: 'all',
    occasion: 'Dinner',
    destination: 'all',
  });
  const [filter, setFilterState] = useState<Filter>({
    cuisine: 'all',
    occasion: 'all',
    destination: 'all',
  });
  const bookable = useMemo(() => bookableRestaurants(restaurants), [restaurants]);
  const [booking, setBookingState] = useState<Booking>(() => {
    // Spec §5.2 site_settings.default_restaurant_id: the first bookable restaurant when that one is not.
    const first = bookable.find((r) => r.id === defaultRestaurantId) ?? bookable[0];
    return { destination: first?.dest ?? 'resort', restaurant: first?.id ?? '', date: '', time: '19:00', guests: 2 };
  });
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [board, setBoard] = useState<DayResponse | null>(null);
  const [form, setForm] = useState<BookingForm>(EMPTY_FORM);
  const [tried, setTried] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [reference, setReference] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [confirmedDate, setConfirmedDate] = useState<IsoDate | ''>('');
  const [overlay, setOverlay] = useState<Overlay | null>(null);
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
  /* Which kind of answer did not arrive (an HTTP error, or no network). Only
     the newest request of a kind sets or clears its flag, and the flag stays
     until a later request of that kind answers, so a Try again that fails
     again leaves the message (and the focus on its button) where it was. */
  const [failed, setFailed] = useState({ calendar: false, board: false, count: 0 });
  const settle = useCallback((kind: 'calendar' | 'board', ok: boolean) => {
    setFailed((f) => (ok ? (f[kind] ? { ...f, [kind]: false } : f) : { ...f, [kind]: true, count: f.count + 1 }));
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
      setBookingState((b) => reconcileBooking(b, patch, context(now())));
    },
    [context, now],
  );

  /* The calendar: which days of the window take bookings, the party limit,
     and the server's today and clock. Nothing date-related renders before it
     answers, so the server render carries no date at all (hydration #418).
     Its answer picks the first open day when the chosen one is not. */
  const loadCalendar = useCallback(
    (restaurant: string) => {
      const seq = ++calendarSeq.current;
      getJson<CalendarResponse>(calendarUrl(restaurant, locale))
        .then((res) => {
          if (seq !== calendarSeq.current) return;
          settle('calendar', res.ok);
          if (!res.ok) return;
          const data = res.data;
          const serverNow = new Date(data.now);
          setClockOffset(serverNow.getTime() - Date.now());
          setCalendar(data);
          setBookingState((b) => reconcileBooking(b, {}, context(serverNow, { calendar: data })));
        })
        .catch(() => {
          if (seq === calendarSeq.current) settle('calendar', false);
        });
    },
    [context, locale, settle],
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
          settle('board', res.ok);
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
          if (seq === boardSeq.current) settle('board', false);
        });
    },
    [context, loadCalendar, locale, settle],
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
    (preset?: Partial<Booking>, note?: string) => {
      setOverlay('drawer');
      setOpenDropdown(null);
      setDone(false);
      setTried(false);
      setServerError(null);
      if (note) setForm((f) => (f.note ? f : { ...f, note }));
      // A restaurant that does not book online is ignored here (reconcileBooking keeps the current one).
      const next = reconcileBooking(latest.current.booking, { ...preset }, context(now()));
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
      setTried(false);
      setServerError(null);
      setForm(EMPTY_FORM);
    }
  }, [done]);

  const openRestaurant = useCallback(
    (r: Restaurant) => {
      if (!r.hasDetailPage) {
        // Its only action is reserving; with online booking off there is none (R14).
        if (r.bookingEnabled) openReserve({ restaurant: r.id });
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
    () => ({ name: tried && !valid.name, phone: tried && !valid.phone, email: tried && !valid.email }),
    [tried, valid],
  );

  const submit = useCallback(() => {
    setServerError(null);
    const date = booking.date;
    const fieldsValid = valid.name && valid.phone && valid.email;
    const at = now();
    // null: no board for this restaurant and date yet, so the server alone decides.
    if (!(date && fieldsValid && bookingOpen(context(at), booking) !== false)) {
      setTried(true);
      if (date && fieldsValid) {
        // The form is fine, so the slot is the problem (it closed or filled
        // while the drawer sat open): say so and slide to the nearest open one.
        const day = boardFor(latest.current.board, booking.restaurant, date);
        const past = day ? clockBlock(date, booking.time, at, day) !== null : false;
        setServerError(bookingErrorMessage(past ? 'past' : 'full', {}, strings));
        setBookingState((b) => reconcileBooking(b, {}, context(at)));
      } else if (fieldsValid && booking.restaurant && !calendarFor(latest.current.calendar, booking.restaurant)) {
        // No date because this restaurant's calendar never came (it failed, or
        // is still on its way): say so rather than nothing, and ask again.
        setServerError(bookingErrorMessage('network', {}, strings));
        loadCalendar(booking.restaurant);
      }
      return;
    }

    setPending(true);
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
    })
      .then((result) => {
        if (result.ok) {
          setReference(result.data.reference);
          setConfirmedDate(result.data.date);
          setDone(true);
          return;
        }
        setServerError(bookingErrorMessage(result.code, result.params, strings));
        setTried(true);
        // Ask again so a lost race (or a new closure) shows up at once; the
        // answers move the time off a slot that has just filled.
        loadCalendar(booking.restaurant);
        loadBoard(booking.restaurant, date);
      })
      .catch(() => setServerError(bookingErrorMessage('network', {}, strings)))
      .finally(() => setPending(false));
  }, [booking, context, form, loadBoard, loadCalendar, locale, now, strings, valid]);

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
    (key: DestKey) => {
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
  /* A failure shows only where it leaves the form with nothing true to show:
     the dates (no calendar for this restaurant), else the chosen day's times. */
  const loadFailed = useMemo<SiteState['loadFailed']>(() => {
    if (!failed.calendar && !failed.board) return null;
    if (failed.calendar && !chosenCalendar) return { at: 'dates', count: failed.count };
    if (booking.date && !chosenBoard) return { at: 'times', count: failed.count };
    return null;
  }, [booking.date, chosenBoard, chosenCalendar, failed]);

  const value = useMemo<SiteState>(
    () => ({
      locale,
      restaurants,
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
      now,
      strings,
      confirmedDate,
      form,
      setFormField,
      tried,
      done,
      pending,
      reference,
      serverError,
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
      applyFinder, booking, bookable, chosenBoard, clearFilters, close, closeDrawer, closeDropdown,
      confirmedDate, days, done, errors, filter, finder, form, goBackToRestaurants, goHomeTop, groupPhone,
      lang, loadFailed, locale, matches, maxParty, now, open, openDropdown, openReserve, openRestaurant, overlay,
      pageRoot, pending, pickCuisine, pickDestination, query, reference, restaurants, retryAvailability, scrollToId, scrolled,
      serverError, setBooking, setFilter, setFinder, setFormField, showPage, shownCount, strings, submit,
      tab, today, toggleDropdown, tried, view,
    ],
  );

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

export { findRestaurant };
