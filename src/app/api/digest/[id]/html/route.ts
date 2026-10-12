import { NextResponse } from 'next/server';
import { digestHtml } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * The exact HTML of one sent digest.
 *
 * The archive swaps cards client-side, so the preview has to follow the
 * selection without a page navigation. No wider exposure than the archive
 * page itself, which already renders the same HTML.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const digestId = Number(id);
  if (!Number.isInteger(digestId) || digestId <= 0) {
    return NextResponse.json({ error: 'bad digest id' }, { status: 400 });
  }
  const found = await digestHtml(digestId);
  if (!found) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(found);
}
