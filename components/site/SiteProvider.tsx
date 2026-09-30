'use client';

import { usePathname, useRouter } from 'next/navigation';
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
import {
  NO_AVAILABILITY,
  findRestaurant,
  reconcile,
  slotBookable,
  validate,
  type Availability,
  type Booking,
  type BookingForm,
} from '@/lib/booking';
import { readMotionLevel } from '@/lib/motion';
import { submitReservation } from '@/app/actions';
import { coverThen } from '@/components/site/PageCurtain';

export type Filter = { cuisine: string; occasion: string; destination: string };
export type Finder = Filter & { location: string };
export type Overlay = 'drawer' | 'search' | 'menu' | 'film' | 'sheet';

const EMPTY_FORM: BookingForm = { name: '', phone: '', email: '', note: '' };
const DETAIL_PATH = '/taya-house';

type SiteState = {
  restaurants: Restaurant[];
  view: 'home' | 'detail';
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
  availability: Availability;
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

  slide: number;
  goSlide: (i: number) => void;

  scrollToId: (id: string) => void;
  goHomeTop: () => void;
  goBackToRestaurants: () => void;
  openRestaurant: (r: Restaurant) => void;
  navigate: (view: 'home' | 'detail') => void;
};

const SiteContext = createContext<SiteState | null>(null);

export function useSite(): SiteState {
  const ctx = useContext(SiteContext);
  if (!ctx) throw new Error('useSite must be used inside <SiteProvider>');
  return ctx;
}

export function SiteProvider({
  restaurants,
  children,
}: {
  restaurants: Restaurant[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const view: 'home' | 'detail' = pathname === DETAIL_PATH ? 'detail' : 'home';

  const [scrolled, setScrolled] = useState(false);
  const [tab, setTab] = useState<SiteState['tab']>('explore');
  const [slide, setSlide] = useState(0);
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
  const [booking, setBookingState] = useState<Booking>({
    destination: 'resort',
    restaurant: 'taya-house',
    day: 0,
    time: '19:00',
    guests: 2,
  });
  const [availability, setAvailability] = useState<Availability>(NO_AVAILABILITY);
  const [form, setForm] = useState<BookingForm>(EMPTY_FORM);
  const [tried, setTried] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [reference, setReference] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [query, setQuery] = useState('');
  const [lang, setLang] = useState<'EN' | 'VI'>('EN');
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const pendingScroll = useRef<string | null>(null);
  const availabilityRef = useRef(availability);
  availabilityRef.current = availability;

  /* Default to tomorrow once the kitchens have closed for the night. Resolved on
     the client so the server render stays deterministic. */
  useEffect(() => {
    setBookingState((b) =>
      reconcile(restaurants, b, new Date().getHours() >= 21 ? { day: 1 } : {}, NO_AVAILABILITY),
    );
  }, [restaurants]);

  const setBooking = useCallback(
    (patch: Partial<Booking>) => {
      setBookingState((b) => reconcile(restaurants, b, patch, availabilityRef.current));
    },
    [restaurants],
  );

  /* Pull live slot pressure whenever the restaurant or date changes. */
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    fetch(`/api/availability?restaurant=${encodeURIComponent(booking.restaurant)}&day=${booking.day}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Availability | null) => {
        if (cancelled || !data) return;
        setAvailability(data);
        // A slot that filled while the drawer was open slides to the nearest free one.
        setBookingState((b) => reconcile(restaurants, b, {}, data));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [booking.restaurant, booking.day, restaurants]);

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

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const offset = window.innerWidth < 1080 ? 63 : 75;
    window.scrollTo({
      top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - offset),
      behavior: 'smooth',
    });
  }, []);

  const scrollToId = useCallback(
    (id: string) => {
      setOverlay(null);
      setOpenDropdown(null);
      if (!document.getElementById(id) && view !== 'home') {
        pendingScroll.current = id;
        coverThen(() => router.push('/'));
        return;
      }
      window.setTimeout(() => scrollTo(id), 30);
    },
    [router, scrollTo, view],
  );

  /* A cross-view scroll target survives the route change and fires once the
     destination section is in the DOM. */
  useEffect(() => {
    const id = pendingScroll.current;
    if (!id) return;
    pendingScroll.current = null;
    const frame = requestAnimationFrame(() => scrollTo(id));
    return () => cancelAnimationFrame(frame);
  }, [pathname, scrollTo]);

  const navigate = useCallback(
    (next: 'home' | 'detail') => {
      if (next === view) return;
      setOverlay(null);
      setOpenDropdown(null);
      coverThen(() => router.push(next === 'detail' ? DETAIL_PATH : '/'));
    },
    [router, view],
  );

  const goHomeTop = useCallback(() => {
    setOverlay(null);
    if (view !== 'home') coverThen(() => router.push('/'));
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [router, view]);

  const goBackToRestaurants = useCallback(() => {
    pendingScroll.current = 'restaurants';
    setOverlay(null);
    coverThen(() => router.push('/'));
  }, [router]);

  const openReserve = useCallback(
    (preset?: Partial<Booking>, note?: string) => {
      setOverlay('drawer');
      setOpenDropdown(null);
      setDone(false);
      setTried(false);
      setServerError(null);
      if (note) setForm((f) => (f.note ? f : { ...f, note }));
      setBooking(preset ?? {});
    },
    [setBooking],
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
      if (r.id === 'taya-house') {
        setBooking({ restaurant: 'taya-house' });
        setOverlay(null);
        navigate('detail');
      } else {
        openReserve({ restaurant: r.id });
      }
    },
    [navigate, openReserve, setBooking],
  );

  const valid = useMemo(() => validate(form), [form]);
  const errors = useMemo(
    () => ({ name: tried && !valid.name, phone: tried && !valid.phone, email: tried && !valid.email }),
    [tried, valid],
  );

  const submit = useCallback(() => {
    setServerError(null);
    if (!(valid.name && valid.phone && valid.email && slotBookable(restaurants, booking, availability))) {
      setTried(true);
      return;
    }

    setPending(true);
    submitReservation({
      restaurant: booking.restaurant,
      day: booking.day,
      time: booking.time,
      guests: booking.guests,
      name: form.name,
      phone: form.phone,
      email: form.email,
      note: form.note,
    })
      .then((result) => {
        if (result.ok) {
          setReference(result.reference);
          setDone(true);
          return;
        }
        setServerError(result.error);
        setTried(true);
        // Re-read the slot board so a lost race shows up immediately.
        return fetch(
          `/api/availability?restaurant=${encodeURIComponent(booking.restaurant)}&day=${booking.day}`,
        )
          .then((r) => (r.ok ? r.json() : null))
          .then((data: Availability | null) => data && setAvailability(data))
          .catch(() => {});
      })
      .catch(() => setServerError('We could not reach the reservations desk. Please try again.'))
      .finally(() => setPending(false));
  }, [availability, booking, form, restaurants, valid]);

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
  const goSlide = useCallback((i: number) => setSlide(i), []);

  /* Header solidity, plus which pill the mobile bar highlights. */
  useEffect(() => {
    const sync = () => {
      const y = window.scrollY || 0;
      const vh = window.innerHeight || 800;
      let nextTab: SiteState['tab'] = 'explore';
      const r = document.getElementById('restaurants');
      const d = document.getElementById('destinations');
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
  }, [pathname]);

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

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  /* Hero slideshow: desktop only, paused behind an overlay or a hidden tab. */
  useEffect(() => {
    if (view !== 'home' || overlay || !readMotionLevel()) return;
    const timer = window.setInterval(() => {
      if (document.hidden || window.innerWidth < 760) return;
      setSlide((s) => (s + 1) % 3);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [overlay, view]);

  const value = useMemo<SiteState>(
    () => ({
      restaurants,
      view,
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
      availability,
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
      slide,
      goSlide,
      scrollToId,
      goHomeTop,
      goBackToRestaurants,
      openRestaurant,
      navigate,
    }),
    [
      applyFinder, availability, booking, clearFilters, close, closeDrawer, closeDropdown, done,
      errors, filter, finder, form, goBackToRestaurants, goHomeTop, goSlide, lang, matches,
      navigate, open, openDropdown, openReserve, openRestaurant, overlay, pending, pickCuisine,
      pickDestination, query, reference, restaurants, scrollToId, scrolled, serverError, setBooking,
      setFilter, setFinder, setFormField, shownCount, slide, submit, tab, toggleDropdown, tried, view,
    ],
  );

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

export { findRestaurant };
