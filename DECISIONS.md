# Decisions log — Industry Event Scout

Decisions made during the build that a later session must not quietly reverse.
The brief is `CLAUDE_CODE_BUILD_PROMPT.md` in the OneDrive folder; this file
records where we departed from it and why.

---

## Answered before any code (11 Oct 2026)

| Question | Decision |
|---|---|
| Who the digest can be emailed to | Admin panel takes a recipient address. Grader enters their own email + passcode and the digest goes there. This **weakens brief §6** ("never email anyone except the configured recipient") to "only an address a passcode-holder names". Accepted knowingly: a leaked passcode is a spam vector, bounded by the 10/day cap. |
| Cron hour | `0 2 * * 1` — 2 UTC, firing 07:30–08:29 IST. Always lands **before** 9:00, never late. Consequence: the mockups' "Your digest went out at 9:00 IST" is wrong and must be replaced by the real timestamp from Neon, with the standing line reading "every Monday morning". |
| Event with no stated registration deadline | Still gets "Add to calendar". The calendar entry lands on the **event date**, with "registration deadline not stated" in the description, and the event drops off the carry-over list once the event date passes. No date is ever invented — we only use a date the page actually stated. |
| Source list | I assemble and test candidate Eventbrite / Luma / RSS sources, then get them approved before they go in. |
| Repo location | `C:\Users\vedul\Projects\event-scout`, outside OneDrive, to keep sync away from `node_modules` and `.next`. The OneDrive folder stays the brief + design reference. |
| Gemini key | Reusing the research-chain key. Shared quota; rotating it later breaks research-chain too. |
| Vercel plan | Hobby. The Monday run must be small self-chaining steps saving progress to Neon between each. |
| Send cap conflict | Brief §7 says the Monday auto-send counts toward the 10/day; components map note 2 says it does not. Following the **map**: Monday does not consume one of the 10, and is never blocked. Graders get the full 10. |
| Settings page protection | Save is gated behind the same admin passcode, held in `sessionStorage` so Vikram types it once. The brief does not mention this; without it anyone with the public URL can delete Vikram's cities. |

---

## Departure from brief §5 — extraction (11 Oct 2026)

**§5 assigns "extract event details from page text" to Gemini. We moved most of
that to plain code.** Approved explicitly after spike 1.

**Why.** Spike 1 (`spike/gemini-url-context.mjs`, raw responses in `spike/out/`)
ran `gemini-3.8-flash` + `url_context` against two real event pages and one real
discovery page:

- `registration_deadline` came back **`null` on both event pages**. That field
  drives the red flag, the calendar entry date and the carry-over expiry — the
  centre of the whole product.
- The **discovery page returned every field null** with `page_readable: false`,
  while the retrieval tool reported `status: "success"`. url_context cannot read
  listing pages, and its own success flag does not mean usable content.
- `summary` came back null on the Eventbrite page even with `page_readable: true`.
- 15–46 seconds per page, against a Hobby function ceiling.

A plain `fetch()` with a browser user-agent returns the full HTML of all three
pages, no JS rendering needed, and the data is embedded:

- Eventbrite discovery: `__SERVER_DATA__` holds the whole event list, including
  `"end_sales_date":{"local":"...","utc":"..."}` — the exact deadline Gemini
  returned as null. Plus JSON-LD `itemListElement` per event.
- Luma: JSON-LD `@type:Event` with `eventAttendanceMode`, `offers`, dates, and
  `__NEXT_DATA__`.

**This does not weaken rule 6, it strengthens it.** Parsing `end_sales_date` is
reading a deadline the page states, in JSON instead of prose. There is no model
in the loop to hallucinate it.

**The split now:**

- **Code** parses title, start/end date, city, venue, format, registration
  deadline, organiser, source URL — from `__SERVER_DATA__` / JSON-LD /
  `__NEXT_DATA__`. Code also does every filter, the 7-day flag, the 15 cap,
  ranking, duplicate merging and all date arithmetic, unchanged from §5.
- **Gemini** does its four §5 jobs only: the 2-line summary, the audience tag
  (stated only, never inferred), fit score with a one-line reason, and
  structuring LinkedIn text from Apify. It is no longer responsible for dates.

**Known risk:** parsing embedded JSON is brittle against markup changes. A site
that changes its shape must surface as a **failed source** in the email's
source-status line, never as silently zero events.

**Also found:** `lu.ma/<id>` now redirects to `luma.com/<id>`; store the
resolved URL. And a spike prompt of mine asked Gemini for `is_past`, which is
date arithmetic and breaks §6 — dropped, code computes it.

---

## Facts verified against live docs (11 Oct 2026)

- Current Flash model id is **`gemini-3.8-flash`**; `gemini-3.7-flash` is
  deprecated and auto-rerouted. Kept in one config constant, per the exam rule.
- Interactions API: `POST https://generativelanguage.googleapis.com/v1beta/interactions`,
  headers `x-goog-api-key` + `Content-Type` + **`Api-Revision: 2026-05-20`**
  (the research-chain notes omit the revision header).
- url_context: up to 20 URLs per request, 34 MB per URL, no paywalled pages, no
  localhost or private networks. Retrieved content bills as input tokens.
- Response shape: `steps[]` with `url_context_call` → `url_context_result`
  (`result` is `[{url, status}]`, plus a step-level `is_error`) → `thought` →
  `model_output` whose `content[].text` holds the output.
- The `AQ.`-prefix key format works. Clean 200s, three for three.

---

## Still open

- `APIFY_TOKEN` — spike 2 (LinkedIn) is blocked without it. LinkedIn is
  optional by design: its failure must not break the run.
- Per-token price for `gemini-3.8-flash` not yet confirmed. Spike 1 cost 17,563
  tokens for three calls, ~7k per event page via url_context.
- Neon, Gmail + app password, GitHub repo, Vercel project: all still to be
  created by Pranuthi.

---

## Source and scope decisions after spikes 3–7 (11 Oct 2026)

Seven spikes, fifteen sites. Raw evidence in `spike/out/`.

### What the spikes proved

| Finding | Evidence |
|---|---|
| **Eventbrite has no BFSI supply in these cities and its search is broken.** `?q=` is echoed back by the server and ignored: `fintech`, `banking`, `payments`, `bfsi` all return `object_count=134`, the same generic Bangalore list — Java training, SAFe certification in Worcester MA labelled "Bangalore". | `spike/out/probe.json` |
| **No source anywhere states a registration deadline.** Fifteen sites. Zero `registration closes` / `early bird ends` strings. Luma's full event object has no registration-close field; on Luma and Meetup registration stays open until the event starts. The `end_sales_date` found in spike 1 was inside a **promoted ad** payload — organic results and individual event pages do not carry it. | `spike/out/source-sweep.json`, `probe.json`, `organisers.json` |
| **Meetup looked relevant and isn't.** Keyword search works, but it returns Bitcoin developer meetups and retail-investing sessions, not industry events. Rejected by Pranuthi on exactly this ground. | `spike/out/alt-sources.json` |
| **Organiser sites have no structured data.** Zero JSON-LD across Exito, UBS Forums, Entraine, ETBFSI, Nasscom. Global Fintech Fest is the only site on the list with any. Dates live in prose. | `spike/out/organisers.json` |
| **Gemini url_context CAN read BFSI listing pages**, unlike Eventbrite's. `page_readable=true` on both ETBFSI and Nasscom. | `spike/out/gemini-discovery.json` |
| **Gemini invents URLs.** It produced `/events/converge`, `/events/etbfsi-converge`, `/events/nbfc-connect-2027` — all returned `status: error`. | same |
| **Real supply is thin.** The entire BFSI circuit in these three cities is a handful of summits a year, mostly Mumbai. | all of the above |

### Decisions

**Source mix: ETBFSI + Nasscom + Luma to start.** Prove the pipeline end to end on three
sources, then add organiser sites (Exito, UBS Forums, Entraine, BFSI Tech Summit,
BFSI Bharat, Global Fintech Fest) one at a time. 10times and e4m are `403` and need
Apify — deferred on cost, along with LinkedIn.

**Extraction is per-source, not global.** This supersedes the blanket "code parses"
decision above:
- **Luma** → code parses JSON-LD / `__NEXT_DATA__`. Clean, exact, free.
- **ETBFSI, Nasscom, organiser sites** → Gemini url_context reads the prose. There is
  no structured data to parse, so §5's original design is right for these sources.
- Filters, ranking, the flag, the cap, duplicate merging and **all** date arithmetic
  stay in plain code regardless of source.

**Deadline flag.** Gemini reads each event's description for a *stated* registration
deadline. Where none exists — which the spikes say is almost always — the badge keys
off the **event date** and says so in its own words ("Event in 4 days"), never
"registration closes". The two cases must stay visibly distinct in UI and email.
This reopens the "no event-date flag" decision of 20:55, on evidence.

**Research window: 30 days → 90 days.** The 30-day rule filtered out ETBFSI Converge
2026 (Mumbai, BFSI, in-person, 10 Dec) — the single most relevant event the whole
system found. Zero events survived the filters on the day of the test; the digest
would have gone out empty. Conferences are announced a quarter ahead, and that is
when early-bird pricing and speaking slots close. 30 days is a meetup window;
Vikram sells at conferences. Changes a §5 do-not-re-decide item.

**Settings gains an editable Sources list.** Vikram pastes organiser URLs he follows
and the Monday run reads them. Beyond the brief's Settings spec, but it is the only
thing that closes the coverage gap — he knows the circuit, the crawler does not.
Same passcode gate as the rest of Settings. One Gemini call per added URL per run.

**Every source URL is HTTP-checked before it can appear**, because Gemini demonstrably
invents them and rule 6 forbids showing an event without a working source link. A URL
that fails the check means the event is dropped, not shown with a dead link.

**An empty digest is a valid outcome and must read as one.** Given real supply, some
Mondays will have nothing new. The email still sends, still shows "On your calendar",
and says plainly that nothing new was found — it never pads, and it never implies
the sources failed when they simply had nothing.
