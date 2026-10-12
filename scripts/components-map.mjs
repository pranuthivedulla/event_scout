/**
 * Generates the Components Map as an SVG, laid out programmatically so lanes,
 * columns and connectors line up exactly.
 *
 *   node scripts/components-map.mjs
 *
 * Reflects the system as built, not as originally drawn: Eventbrite and RSS are
 * out, ETBFSI and Nasscom are in, LinkedIn is wired but returns nothing, the
 * window is 90 days, and the Monday run lands 07:30-08:29 IST.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'spike', 'out');

const W = 2560;
const PAD = 44;
const LANE_LABEL_W = 232;

const COLUMNS = [
  { key: 'trigger', label: 'TRIGGER', w: 300 },
  { key: 'input', label: 'INPUT', w: 330 },
  { key: 'context', label: 'CONTEXT', w: 330 },
  { key: 'processing', label: 'PROCESSING', w: 900 },
  { key: 'output', label: 'OUTPUT', w: 380 },
];

const LANES = [
  { key: 'vikram', name: 'VIKRAM', sub: '(the user)', h: 132 },
  { key: 'dashboard', name: 'DASHBOARD', sub: '(frontend)', h: 132 },
  { key: 'vercel', name: 'VERCEL', sub: '(hosting + schedule)', h: 132 },
  { key: 'github', name: 'GITHUB', sub: '(version control)', h: 110 },
  { key: 'backend', name: 'BACKEND', sub: '(app logic)', h: 188 },
  { key: 'sources', name: 'EVENT SOURCES', sub: '(Luma, ETBFSI, Nasscom)', h: 132 },
  { key: 'apify', name: 'APIFY', sub: '(LinkedIn scraper)', h: 132 },
  { key: 'gemini', name: 'GEMINI FLASH', sub: '(the only AI)', h: 160 },
  { key: 'neon', name: 'NEON', sub: '(database)', h: 160 },
  { key: 'gmail', name: 'GMAIL SMTP', sub: '(email sending)', h: 118 },
  { key: 'gcal', name: 'GOOGLE CALENDAR', sub: '(pre-filled link)', h: 118 },
];

const HEADER_H = 74;
const TITLE_H = 118;

// ---- geometry -------------------------------------------------------------
let x = PAD + LANE_LABEL_W;
const colX = {};
for (const c of COLUMNS) { colX[c.key] = { x, w: c.w, cx: x + c.w / 2 }; x += c.w; }
const GRID_RIGHT = x;

let y = TITLE_H + HEADER_H;
const laneY = {};
for (const l of LANES) { laneY[l.key] = { y, h: l.h, cy: y + l.h / 2 }; y += l.h; }
const GRID_BOTTOM = y;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Wrap text to a pixel width, roughly, at ~8.6px per character at 21px. */
function wrap(text, maxW, perChar = 8.6) {
  const max = Math.floor(maxW / perChar);
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max && line) { lines.push(line.trim()); line = w; }
    else line += ' ' + w;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

const parts = [];
const boxes = {}; // id -> {x,y,w,h}

function box({ id, col, lane, text, kind = 'plain', inset = 26, slot }) {
  const c = colX[col], l = laneY[lane];
  // `slot` lays several boxes side by side in one cell. This has to happen
  // before the rect is emitted, not after, or they all draw on top of
  // each other and only the last is visible.
  const gap = 26;
  const bw = slot
    ? (c.w - inset * 2 - gap * (slot.of - 1)) / slot.of
    : c.w - inset * 2;
  const lines = wrap(text, bw - 36);
  const bh = Math.max(74, lines.length * 27 + 34);
  const bx = c.x + inset + (slot ? slot.i * (bw + gap) : 0);
  const by = l.cy - bh / 2;

  const fill = kind === 'ai' ? '#e8f6ef' : kind === 'human' ? '#fff6e3' : '#ffffff';
  const stroke = kind === 'ai' ? '#2f8f6d' : kind === 'human' ? '#d79a2b' : '#51605c';
  const sw = kind === 'plain' ? 1.6 : 2.4;

  parts.push(
    `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="9" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
  );
  lines.forEach((ln, i) => {
    parts.push(
      `<text x="${bx + bw / 2}" y="${by + 32 + i * 27}" text-anchor="middle" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="21" fill="#12302a">${esc(ln)}</text>`
    );
  });
  if (id) boxes[id] = { x: bx, y: by, w: bw, h: bh, cx: bx + bw / 2, cy: by + bh / 2 };
  return boxes[id];
}

/** Dashed connector with an arrowhead, routed as an elbow. */
function arrow(fromId, toId, { via = 'h' } = {}) {
  const a = boxes[fromId], b = boxes[toId];
  if (!a || !b) return;
  let d;
  if (via === 'right') {
    // a long hop up the page: go out past the boxes and come back in, so it
    // does not run straight through whatever sits between the two lanes
    const lane = GRID_RIGHT + 2;
    d = `M ${a.x + a.w} ${a.cy} H ${lane} V ${b.cy} H ${b.x + b.w}`;
  } else if (via === 'h') {
    const x1 = a.x + a.w, y1 = a.cy, x2 = b.x, y2 = b.cy;
    const mx = x1 + Math.max(18, (x2 - x1) / 2);
    d = `M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`;
  } else {
    // vertical hop, in whichever direction the target actually lies. Without
    // this the elbow doubles back and draws straight through the box's text.
    const down = b.cy > a.cy;
    const x1 = a.cx, y1 = down ? a.y + a.h : a.y;
    const x2 = b.cx, y2 = down ? b.y : b.y + b.h;
    const my = y1 + (y2 - y1) / 2;
    d = `M ${x1} ${y1} V ${my} H ${x2} V ${y2}`;
  }
  parts.push(`<path d="${d}" fill="none" stroke="#3c4a46" stroke-width="2" stroke-dasharray="7 6" marker-end="url(#ah)"/>`);
}

// ---- grid -----------------------------------------------------------------
parts.push(`<rect x="0" y="0" width="${W}" height="${GRID_BOTTOM + 330}" fill="#eaf4ee"/>`);
parts.push(`<rect x="${PAD - 14}" y="${TITLE_H - 14}" width="${GRID_RIGHT - PAD + 28}" height="${GRID_BOTTOM - TITLE_H + 28}" rx="16" fill="#ffffff" stroke="#cfdcd6" stroke-width="2"/>`);

parts.push(`<text x="${PAD}" y="70" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="46" font-weight="800" fill="#0f3b30">Industry Event Scout — Components Map</text>`);

for (const c of COLUMNS) {
  parts.push(`<text x="${colX[c.key].cx}" y="${TITLE_H + 46}" text-anchor="middle" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="23" font-weight="700" letter-spacing="1.6" fill="#2b4039">${c.label}</text>`);
}
parts.push(`<line x1="${PAD - 14}" y1="${TITLE_H + HEADER_H}" x2="${GRID_RIGHT + 14}" y2="${TITLE_H + HEADER_H}" stroke="#9fb3ac" stroke-width="2"/>`);

for (const l of LANES) {
  const ly = laneY[l.key];
  parts.push(`<line x1="${PAD - 14}" y1="${ly.y + ly.h}" x2="${GRID_RIGHT + 14}" y2="${ly.y + ly.h}" stroke="#dde7e3" stroke-width="1.5"/>`);
  parts.push(`<text x="${PAD + LANE_LABEL_W - 24}" y="${ly.cy - 4}" text-anchor="end" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="22" font-weight="800" fill="#12302a">${esc(l.name)}</text>`);
  parts.push(`<text x="${PAD + LANE_LABEL_W - 24}" y="${ly.cy + 22}" text-anchor="end" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="18" fill="#5c716b">${esc(l.sub)}</text>`);
}
for (const c of COLUMNS) {
  parts.push(`<line x1="${colX[c.key].x}" y1="${TITLE_H - 14}" x2="${colX[c.key].x}" y2="${GRID_BOTTOM}" stroke="#dde7e3" stroke-width="1.5"/>`);
}

// ---- boxes ----------------------------------------------------------------
box({ id: 'cron', col: 'trigger', lane: 'vercel', text: 'Every Monday, 07:30–08:29 IST, the schedule starts the run' });
box({ id: 'push', col: 'trigger', lane: 'github', text: 'Code is pushed to the repository' });

box({ id: 'srcIn', col: 'input', lane: 'sources', text: 'Luma city pages, ETBFSI and Nasscom event pages' });
box({ id: 'apifyIn', col: 'input', lane: 'apify', text: 'Apify searches public LinkedIn events' });

box({ id: 'settings', col: 'context', lane: 'backend', text: 'Loads saved cities, focus areas, organiser sites and calendar events' });
box({ id: 'neonHold', col: 'context', lane: 'neon', text: 'Holds settings, events, scores, digests, calendar clicks' });

box({ id: 'fetch', col: 'processing', lane: 'backend', inset: 18, slot: { i: 0, of: 3 },
  text: 'Fetches pages and feeds' });
box({ id: 'filter', col: 'processing', lane: 'backend', inset: 18, slot: { i: 1, of: 3 },
  text: 'Filters: city, next 90 days, in-person or hybrid, still open; merges duplicates' });
box({ id: 'rank', col: 'processing', lane: 'backend', inset: 18, slot: { i: 2, of: 3 },
  text: 'Ranks top 15, urgent first; flags under 7 days' });

box({ id: 'extract', col: 'processing', lane: 'gemini', kind: 'ai', inset: 18, slot: { i: 0, of: 3 },
  text: 'Reads pages with no structured data; writes the 2-line summary' });
box({ id: 'score', col: 'processing', lane: 'gemini', kind: 'ai', inset: 18, slot: { i: 1, of: 3 },
  text: 'Scores fit to focus areas, gives a one-line reason' });
box({ id: 'speak', col: 'processing', lane: 'gemini', kind: 'ai', inset: 18, slot: { i: 2, of: 3 },
  text: 'Reads the urgent items aloud for the voice note' });

box({ id: 'save', col: 'processing', lane: 'neon', text: 'Saves events, scores, the digest and its audio', inset: 18 });

box({ id: 'vikram', col: 'output', lane: 'vikram', kind: 'human', text: 'Reads the Monday email, clicks Register or Add to calendar, opens the dashboard anytime' });
box({ id: 'dash', col: 'output', lane: 'dashboard', text: 'Events, filters, charts, mini calendar, digest archive' });
box({ id: 'deploy', col: 'output', lane: 'vercel', text: 'Deploys from GitHub and hosts the dashboard at a public URL' });
box({ id: 'send', col: 'output', lane: 'gmail', text: 'Sends the digest email' });
box({ id: 'gcal', col: 'output', lane: 'gcal', text: 'Opens a pre-filled entry' });

// ---- connectors -----------------------------------------------------------
arrow('cron', 'settings');
arrow('settings', 'fetch');
arrow('srcIn', 'fetch');
arrow('apifyIn', 'fetch');
arrow('fetch', 'extract', { via: 'v' });
arrow('extract', 'filter', { via: 'v' });
arrow('filter', 'score', { via: 'v' });
arrow('score', 'rank', { via: 'v' });
arrow('rank', 'save', { via: 'v' });
arrow('save', 'send');
arrow('save', 'dash');
arrow('send', 'vikram', { via: 'right' });
arrow('push', 'deploy');
arrow('neonHold', 'settings', { via: 'v' });

writeFileSync(join(OUT, 'map.parts.json'), JSON.stringify({ W, GRID_BOTTOM }, null, 2));

// ---- legend and notes -----------------------------------------------------
const ly = GRID_BOTTOM + 58;
parts.push(`<line x1="${PAD}" y1="${ly - 26}" x2="${PAD + 150}" y2="${ly - 26}" stroke="#3c4a46" stroke-width="2" stroke-dasharray="7 6" marker-end="url(#ah)"/>`);
parts.push(`<text x="${PAD + 170}" y="${ly - 19}" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="21" fill="#12302a">Data flow</text>`);
parts.push(`<rect x="${PAD + 330}" y="${ly - 44}" width="40" height="30" rx="6" fill="#e8f6ef" stroke="#2f8f6d" stroke-width="2.4"/>`);
parts.push(`<text x="${PAD + 384}" y="${ly - 19}" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="21" fill="#12302a">AI step (Gemini Flash only)</text>`);
parts.push(`<rect x="${PAD + 800}" y="${ly - 44}" width="40" height="30" rx="6" fill="#fff6e3" stroke="#d79a2b" stroke-width="2.4"/>`);
parts.push(`<text x="${PAD + 854}" y="${ly - 19}" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="21" fill="#12302a">Human decision (Vikram chooses whether to register)</text>`);

const NOTES = [
  'Cities, focus areas and organiser sites are set once on the dashboard and saved. They are not entered each run.',
  'Vercel’s free tier fires a cron anywhere inside its scheduled hour, so the run is scheduled early to guarantee it is never late.',
  'A small Admin button on the dashboard (passcode, capped per day) emails the digest on demand from events already stored. It does not re-run the research.',
  'AI is used only to read pages that carry no structured data, write the 2-line summary, score fit with a reason, and speak the voice note. Filters, ranking, the 7-day flag, the 15-event cap and all date arithmetic are plain code.',
  'No source publishes a registration deadline, so the red flag reads “Closes in N days” only where a page stated one and counts down to the event otherwise. The agent never guesses a deadline, never registers Vikram, and never labels an event “registered”.',
  'If a source fails or returns nothing — LinkedIn currently returns nothing — the digest still sends and names it.',
];
parts.push(`<text x="${PAD}" y="${ly + 42}" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="23" font-weight="800" fill="#12302a">Notes</text>`);
let ny = ly + 78;
NOTES.forEach((n, i) => {
  const lines = wrap(`${i + 1}.  ${n}`, W - PAD * 2 - 20, 9.4);
  lines.forEach((ln, j) => {
    parts.push(`<text x="${PAD + (j ? 28 : 0)}" y="${ny}" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="20" fill="#2b4039">${esc(ln)}</text>`);
    ny += 29;
  });
  ny += 8;
});

const H = ny + 30;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
<path d="M 0 0 L 10 5 L 0 10 z" fill="#3c4a46"/></marker></defs>
<rect width="${W}" height="${H}" fill="#eaf4ee"/>
${parts.join('\n')}
</svg>`;

writeFileSync(join(OUT, 'components-map-v3.svg'), svg);
console.log(`wrote components-map-v3.svg  (${W} x ${H})`);
