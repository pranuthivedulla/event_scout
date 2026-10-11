/**
 * Every source URL is HTTP-checked before an event may be shown.
 *
 * Spike 7 showed Gemini inventing plausible URLs (/events/converge,
 * /events/etbfsi-converge) that do not resolve. Rule 6: never show an event
 * without a working source link. An event that fails this check is dropped,
 * not shown with a dead link.
 */

import { USER_AGENT } from '@/config';

export interface LinkResult {
  url: string;
  ok: boolean;
  status: number | null;
  /** The URL after redirects — luma's lu.ma/x now lands on luma.com/x. */
  finalUrl: string | null;
}

const TIMEOUT_MS = 8000;

async function probe(url: string, method: 'HEAD' | 'GET'): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      method,
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'user-agent': USER_AGENT, 'accept-language': 'en-IN,en;q=0.9' },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function checkLink(url: string): Promise<LinkResult> {
  if (!/^https?:\/\//i.test(url)) return { url, ok: false, status: null, finalUrl: null };

  // HEAD first; plenty of sites answer 403/405 to HEAD but serve GET fine.
  let res = await probe(url, 'HEAD');
  if (!res || res.status === 405 || res.status === 403 || res.status >= 500) {
    res = await probe(url, 'GET');
  }
  if (!res) return { url, ok: false, status: null, finalUrl: null };

  return {
    url,
    ok: res.status >= 200 && res.status < 400,
    status: res.status,
    finalUrl: res.url || url,
  };
}

/** Check many URLs with a small concurrency limit, so we stay polite. */
export async function checkLinks(urls: string[], concurrency = 4): Promise<Map<string, LinkResult>> {
  const out = new Map<string, LinkResult>();
  const queue = [...new Set(urls)];

  async function worker() {
    for (;;) {
      const url = queue.shift();
      if (!url) return;
      out.set(url, await checkLink(url));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return out;
}
