# Event Scout

Finds industry events worth a consultant's time, ranks them against his focus
areas, and emails a digest every Monday morning. A dashboard shows the same
data, from the same database.

Built for MESA's *AI and its Applications* final exam, Problem Statement 15.

**The problem.** Vikram gets ~40% of new business from events and converts 3x
better face to face than cold. He checks event sites by hand every Monday,
about 45 minutes, and still misses things — including a CIO roundtable that was
the right room for three live prospects. This replaces the 45 minutes.

---

## What it does

```
Monday 02:00 UTC    Vercel Cron fires
                      |
  fetch              Luma (code parses JSON-LD) + ETBFSI, Nasscom
                     (Gemini url_context reads the prose) + any organiser
                     sites Vikram added in Settings
  merge              duplicates collapsed on a title+date fingerprint
  pre-filter         city, 90-day window, in-person or hybrid, still open
  link check         every source URL fetched; a dead link drops the event
  enrich             Gemini: two-line summary, audience tag, and a
                     registration deadline IF the page states one
  filter             the same hard filters, now with enriched fields
  score              Gemini: 0-5 fit to each focus area, one-line reason
  rank + cap         plain code: score x focus weight, top 15
                      |
                     Neon  ->  the Monday email AND the dashboard
```

**Gemini does four things and no more:** extracts event details, writes the
two-line summary, scores fit with a reason, and (when enabled) structures
LinkedIn text. Every filter, the ranking, the 7-day flag, the 15 cap, duplicate
merging and all date arithmetic are plain code, covered by tests.

---

## The deadline problem, and what we did about it

The brief is built around a red **"Closes in N days"** badge on events whose
registration deadline is under 7 days away.

**No accessible source publishes a registration deadline.** Fifteen sites were
checked — Eventbrite, Luma, Meetup, AllEvents, 10times, and nine BFSI organiser
sites. Not one exposes a registration-close date. On Luma and Meetup
registration simply stays open until the event begins.

So the badge works like this, and the two cases never share wording:

| Situation | Badge | Line |
|---|---|---|
| A page stated a deadline, under 7 days away | `Closes in 4 days` | `Registration closes Fri 16 Oct` |
| No deadline stated anywhere, event under 7 days away | `Event in 4 days` | `Deadline unknown` |

The system never claims a registration closes on a date nobody published. A
test asserts the word "closes" cannot appear without a stated deadline.

---

## The spoken deadline note

When something is **both** closing or starting within seven days **and** matches
a focus area, the digest carries a link to a short spoken summary — a player
page with the transcript printed underneath it.

It is a link, not a player. No mainstream email client runs `<audio>` or
script, so embedding one would simply show nothing in Gmail and Outlook.

The transcript is composed in plain code from the same rows the email uses,
with dates computed by `dates.ts`. Gemini TTS is handed a finished script and
does nothing but read it, so no model can introduce a date, a count or a
deadline. A stated deadline is spoken as *"closes for registration"*; an event
date is spoken as *"takes place"*, and the absence of a published deadline is
said out loud — the same distinction the email and the dashboard hold.

**It is silent some weeks, by design.** An earlier version read out whatever
was soonest and spent 47 seconds on iOS meetups and a wellness talk, because
the flag fires on event-date proximity and the nearest events are routinely
the least relevant. Anything scoring 0/5 is no longer read aloud. Those events
remain in the email and on the dashboard — nothing is hidden by focus area —
they are simply not spoken. Given how thin and far-out the real BFSI supply
is, that means some digests carry no clip at all. That is the feature working,
not failing.

---

## Setup

Needs Node 20+.

```bash
npm install
cp .env.example .env     # then fill it in
npm run migrate          # creates the tables in Neon
npm run dev              # http://localhost:3000
```

### Environment variables

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Neon Postgres. Use the **pooled** string (host contains `-pooler`). |
| `GEMINI_API_KEY` | Google AI Studio key. |
| `SMTP_USER` | The dedicated Gmail that sends the digest. |
| `SMTP_APP_PASSWORD` | A 16-character Google **app password**, not the account password. Gmail rejects account passwords over SMTP. |
| `DIGEST_RECIPIENT` | Default address the Monday digest goes to. |
| `ADMIN_PASSCODE` | Gates "Send digest now" and saving Settings. Server-checked only, never in the client bundle. |
| `CRON_SECRET` | Vercel Cron sends this as `Authorization: Bearer`. The cron route refuses without it. |
| `APIFY_TOKEN` | Optional. Empty means LinkedIn reports itself as not configured and the run continues. |

`.env` is in `.gitignore` and was there before the first commit.

### Useful commands

```bash
npm test                              # 33 tests: filters, the flag, ranking, dates
npm run migrate -- --check            # list tables, change nothing
node scripts/set-secret.mjs KEY       # write a secret to .env without echoing it
node scripts/test-smtp.mjs            # check SMTP credentials, send nothing
npx tsx scripts/run-and-save.ts       # run the pipeline, save to Neon
```

---

## How to test it as a grader

1. Open the public URL. **This week** shows real events from live sources, with
   their source links, fit scores and reasons. There is no sample data anywhere
   in the app — with no database the pages say so rather than inventing rows.
2. Click **Admin** in the footer. Enter the passcode, put **your own email
   address** in the second box, and click Send.
3. The page shows the result — recipient, time, counts — and the email arrives
   in your inbox.
4. **Digests** holds every digest ever sent, with the exact HTML that was
   delivered, not a re-render.
5. **Settings** shows the cities and focus areas that drive the ranking.
   Changing them applies from the next Monday run.

---

## Known gaps

Stated plainly, because the alternative is a grader finding them.

**Supply is thin, and that is real.** The Indian BFSI conference circuit is a
handful of summits a year, mostly Mumbai. Some Mondays will have nothing new.
The digest says so and still sends — it never pads.

**Eventbrite is not used.** Its search ignores the query: `fintech`, `banking`,
`payments` and `bfsi` all return the same 134 generic Bangalore results,
including Java training and a SAFe course in Worcester, Massachusetts labelled
"Bangalore". Including it would have meant paying Gemini to score noise.

**LinkedIn is wired but returns nothing.** It runs through Apify on every
Monday run and reports its own result into the digest's source line. It is not
depended on, and here is why: `maximedupre/linkedin-events` runs cleanly
(HTTP 201) and returns **zero events for every query tried**, including the
broadest possible one with no city, no format and no timing filter.
`memo23/linkedin-events-scraper` timed out at 150s on two consecutive
attempts. Neither cost anything, since both bill per result.

So the integration exists and the plumbing is real, but LinkedIn currently
contributes no events. If an actor starts working, or a better one appears,
`APIFY_ACTOR` swaps it without a code change. The field mapping follows the
actor's published output schema and has **not** been exercised against live
output, because there has been none.

This matters more than the other gaps: the CIO roundtable Vikram missed was
LinkedIn-only. That is exactly the hole this source was meant to close, and it
is still open.

**10times and e4m return 403** to a plain fetch. They are the densest Indian
conference indexes and would need Apify too.

**The organiser-site parsers are brittle.** Those pages have no structured data,
so Gemini reads the prose. A site that changes shape shows up as a failed source
in the digest, never as a silent zero.

**The admin button does not re-run the research.** It emails the digest built
from events already in the database. A full fetch takes ~5 minutes and would
exceed Vercel's function limit on a button press. The Monday cron is what goes
and finds new events.

**The Monday send is not at 9:00 IST.** Vercel Hobby fires a cron anywhere
inside its scheduled hour, so `0 2 * * 1` lands between 07:30 and 08:29 IST —
always before 9:00, never after. Nothing in the UI claims 9:00; the dashboard
shows the real timestamp from the database.

**A heavy week can leave summaries missing.** Enrichment stops at an absolute
deadline so the run fits Vercel's 300s ceiling. Events are never dropped for
this — only their summaries are missing, and a follow-up pass fills them in
after the digest has gone.

**Nothing is ever labelled "registered".** "Add to calendar" records interest.
Registration happens on the organiser's own page and this system cannot observe
it, so it never claims it.

---

## Design decisions

`DECISIONS.md` records every departure from the original brief with the
evidence behind it — including the ones that contradict instructions marked
"do not re-decide", and why the live data justified changing them.

The seven pre-build spikes are in `spike/`, with their raw output in
`spike/out/`. They are what established that Eventbrite was unusable, that no
source publishes deadlines, and that a 30-day window produced an empty digest.
