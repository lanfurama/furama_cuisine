import { NextResponse } from 'next/server';
import { bookedCovers, slotCapacity } from '@/db/queries';
import { inWindow, type AvailabilityResponse } from '@/lib/booking';
import { isValidIsoDate, venueNow } from '@/lib/venue-time';

export const dynamic = 'force-dynamic';

/**
 * Booked covers per slot for one restaurant on one date (Da Nang's today when
 * no date is given). It also reports the server's clock, which the browser
 * uses as the authority for "today" and for which sittings have closed.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const restaurant = params.get('restaurant');
  const now = new Date();
  const today = venueNow(now).date;
  const date = params.get('date') ?? today;

  if (!restaurant) {
    return NextResponse.json({ error: 'restaurant is required' }, { status: 400 });
  }
  if (!isValidIsoDate(date) || !inWindow(date, today)) {
    return NextResponse.json({ error: 'date out of range' }, { status: 400 });
  }

  try {
    const [booked, capacity] = await Promise.all([bookedCovers(restaurant, date), slotCapacity(restaurant)]);
    const body: AvailabilityResponse = { today, now: now.toISOString(), date, booked, capacity };
    return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('availability_failed', err);
    return NextResponse.json({ error: 'availability unavailable' }, { status: 503 });
  }
}
