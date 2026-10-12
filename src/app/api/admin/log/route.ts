import { NextResponse } from 'next/server';
import { recentSends } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ sends: await recentSends(12) });
  } catch {
    return NextResponse.json({ sends: [] });
  }
}
