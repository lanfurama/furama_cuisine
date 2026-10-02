import type { Page } from '@playwright/test';

/**
 * Answers GET /api/availability in the v2 shapes (lib/booking/api.ts) without
 * a database, so a spec can pin the server's clock and the booking rules.
 * Every day is open with Lunch and Dinner at 16 covers unless the options say
 * otherwise. Values are read per request, so a spec can move the server's
 * clock between calls. A date outside the window answers state 'outside', as
 * the server does.
 */
export type MockDay = { state: 'closed' | 'full' | 'past'; reason?: string };
export type MockOptions = {
  today: () => string;
  now: () => string;
  maxParty?: number;
  windowDays?: number;
  /** Days that take no bookings, by date. */
  days?: Record<string, MockDay>;
  /** Meals closed on a date: date → meal → public reason (null for none). */
  mealClosures?: Record<string, Record<string, string | null>>;
};

const MEALS = {
  Lunch: ['11:30', '12:00', '12:30', '13:00', '13:30'],
  Dinner: ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00'],
};

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const GROUP_PHONE = { display: '+84 236 651 9999', tel: '+842366519999' };

export async function mockAvailability(page: Page, options: MockOptions) {
  await page.route('**/api/availability**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    const restaurant = params.get('restaurant') ?? '';
    const date = params.get('date');
    const today = options.today();
    const now = options.now();
    const maxParty = options.maxParty ?? 12;
    const windowDays = options.windowDays ?? 14;
    const dates = Array.from({ length: windowDays }, (_, i) => addDays(today, i));

    if (date === null) {
      return route.fulfill({
        json: {
          restaurant,
          today,
          now,
          maxParty,
          groupPhone: GROUP_PHONE,
          days: dates.map((d) => ({ date: d, state: 'open', ...options.days?.[d] })),
        },
      });
    }
    const clock = { restaurant, today, now, date, maxParty, leadMinutes: 30, sameDayCutoff: null };
    if (!dates.includes(date)) return route.fulfill({ json: { ...clock, state: 'outside', periods: [] } });

    const closedDay = options.days?.[date];
    const closedMeals = options.mealClosures?.[date] ?? {};
    return route.fulfill({
      json: {
        ...clock,
        state: closedDay?.state ?? 'open',
        ...(closedDay?.reason ? { reason: closedDay.reason } : {}),
        periods:
          closedDay?.state === 'closed'
            ? []
            : Object.entries(MEALS).map(([meal, times]) =>
                meal in closedMeals
                  ? { meal, closed: true, ...(closedMeals[meal] ? { reason: closedMeals[meal] } : {}), slots: [] }
                  : {
                      meal,
                      closed: false,
                      slots: times.map((time) =>
                        closedDay?.state === 'full' ? { time, left: 0, bookable: false, block: 'full' } : { time, left: 16, bookable: true },
                      ),
                    },
              ),
      },
    });
  });
}
