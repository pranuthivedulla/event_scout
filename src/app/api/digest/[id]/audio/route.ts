import { getDigestAudio } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Serves the spoken deadline note for one digest, as a plain WAV. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const digestId = Number(id);
  if (!Number.isInteger(digestId) || digestId <= 0) {
    return new Response('bad digest id', { status: 400 });
  }

  const found = await getDigestAudio(digestId);
  if (!found) return new Response('no audio for this digest', { status: 404 });

  return new Response(new Uint8Array(found.audio), {
    headers: {
      'content-type': 'audio/wav',
      'content-length': String(found.audio.length),
      // the clip for a given digest never changes
      'cache-control': 'public, max-age=31536000, immutable',
      'accept-ranges': 'bytes',
    },
  });
}
