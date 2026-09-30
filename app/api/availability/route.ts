import { NextResponse } from 'next/server';
import { fetchAvailability } from '@/app/actions';
import { DAY_COUNT } from '@/lib/booking';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const restaurant = params.get('restaurant');
  const day = Number(params.get('day') ?? '0');

  if (!restaurant) {
    return NextResponse.json({ error: 'restaurant is required' }, { status: 400 });
  }
  if (!Number.isFinite(day) || day < 0 || day >= DAY_COUNT) {
    return NextResponse.json({ error: 'day out of range' }, { status: 400 });
  }

  try {
    const availability = await fetchAvailability(restaurant, day);
    return NextResponse.json(availability, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'availability unavailable' }, { status: 503 });
  }
}
