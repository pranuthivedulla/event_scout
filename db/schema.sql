-- Event Scout schema. Neon serverless Postgres.
-- Single source of truth: the Monday email and the dashboard both read these rows.
-- Everything temporal is stored UTC; display converts to Asia/Kolkata.

-- --------------------------------------------------------------------------
-- settings: set once on the dashboard, never entered per run.
-- Exactly one row, id = 1.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  id            int PRIMARY KEY DEFAULT 1,
  cities        text[]      NOT NULL DEFAULT ARRAY['Bengaluru','Mumbai','Hyderabad'],
  -- [{ "name": "...", "level": "High" | "Medium" | "Low" }]
  focus_areas   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- organiser URLs Vikram adds himself: [{ "label": "...", "url": "..." }]
  extra_sources jsonb       NOT NULL DEFAULT '[]'::jsonb,
  recipient     text        NOT NULL DEFAULT '',
  -- 90, not the brief's 30. See DECISIONS.md.
  window_days   int         NOT NULL DEFAULT 90,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settings_singleton CHECK (id = 1)
);

-- --------------------------------------------------------------------------
-- runs: one Monday run, or one admin test run. The pipeline is chained short
-- steps on Vercel Hobby, so progress is saved here between every stage.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS runs (
  id          serial PRIMARY KEY,
  kind        text        NOT NULL CHECK (kind IN ('monday_auto','test_send')),
  stage       text        NOT NULL DEFAULT 'fetch'
                          CHECK (stage IN ('fetch','extract','linkcheck','score','persist','send','done')),
  status      text        NOT NULL DEFAULT 'running'
                          CHECK (status IN ('running','done','failed')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  error       text,
  stats       jsonb       NOT NULL DEFAULT '{}'::jsonb
);

-- --------------------------------------------------------------------------
-- events: every event ever extracted. Deduplicated by fingerprint.
-- first_seen is what makes an event "new" in a given digest.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id                    serial PRIMARY KEY,
  fingerprint           text        NOT NULL UNIQUE,
  run_id                int         REFERENCES runs(id) ON DELETE SET NULL,

  source                text        NOT NULL,
  source_url            text        NOT NULL,

  title                 text        NOT NULL,
  start_date            date,
  end_date              date,
  city                  text,
  venue                 text,
  format                text        CHECK (format IN ('in-person','hybrid','online')),
  -- ONLY when a page stated it. Never the event date, never inferred.
  registration_deadline date,
  organiser             text,
  -- ONLY when a page named its audience. Never inferred from the topic.
  audience_tag          text,
  summary               text,

  -- from Gemini
  score                 int         CHECK (score IS NULL OR (score >= 0 AND score <= 5)),
  reason                text,
  focus_area            text,

  -- from code
  rank_value            int,
  link_ok               boolean,
  link_status           int,

  first_seen            timestamptz NOT NULL DEFAULT now(),
  last_seen             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_start_date_idx  ON events (start_date);
CREATE INDEX IF NOT EXISTS events_first_seen_idx  ON events (first_seen);
CREATE INDEX IF NOT EXISTS events_city_idx        ON events (city);

-- --------------------------------------------------------------------------
-- calendar_clicks: "Add to calendar" was clicked. This is an interest signal
-- and NOTHING more. The system cannot know whether he registered, so no row
-- here may ever be rendered as "registered".
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calendar_clicks (
  id         serial PRIMARY KEY,
  event_id   int         NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  clicked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calendar_clicks_event_idx ON calendar_clicks (event_id);

-- --------------------------------------------------------------------------
-- digests: archive of every digest sent. Also the proof the Monday run fired.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS digests (
  id             serial PRIMARY KEY,
  run_id         int         REFERENCES runs(id) ON DELETE SET NULL,
  sent_at        timestamptz NOT NULL DEFAULT now(),
  kind           text        NOT NULL CHECK (kind IN ('monday_auto','test_send')),
  recipient      text        NOT NULL,
  subject        text        NOT NULL,
  new_count      int         NOT NULL DEFAULT 0,
  calendar_count int         NOT NULL DEFAULT 0,
  closing_count  int         NOT NULL DEFAULT 0,
  html           text        NOT NULL
);

CREATE INDEX IF NOT EXISTS digests_sent_at_idx ON digests (sent_at DESC);

-- The spoken deadline note. Only present when something was actually flagged;
-- we never generate a clip that says "nothing is urgent". The script is
-- composed in plain code and stored alongside, so what was said is auditable.
ALTER TABLE digests ADD COLUMN IF NOT EXISTS audio         bytea;
ALTER TABLE digests ADD COLUMN IF NOT EXISTS audio_script  text;
ALTER TABLE digests ADD COLUMN IF NOT EXISTS audio_seconds numeric(5,1);

-- --------------------------------------------------------------------------
-- send_log: every send attempt, successful or not. Drives the daily cap.
-- The Monday auto-send is logged but does NOT consume one of the 10
-- (components map note 2; see DECISIONS.md).
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS send_log (
  id         serial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  kind       text        NOT NULL CHECK (kind IN ('monday_auto','test_send')),
  result     text        NOT NULL CHECK (result IN ('sent','error','blocked')),
  recipient  text,
  message_id text,
  error      text
);

CREATE INDEX IF NOT EXISTS send_log_at_idx ON send_log (at DESC);

-- --------------------------------------------------------------------------
-- source_runs: one row per source per run. This is what the email's one-line
-- source status is built from. A source that fails must appear here, never
-- be silently omitted.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_runs (
  id       serial PRIMARY KEY,
  run_id   int         REFERENCES runs(id) ON DELETE CASCADE,
  source   text        NOT NULL,
  ok       boolean     NOT NULL,
  error    text,
  found    int         NOT NULL DEFAULT 0,
  ran_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS source_runs_run_idx ON source_runs (run_id);

-- --------------------------------------------------------------------------
-- Seed the single settings row if it is not there yet.
-- --------------------------------------------------------------------------
INSERT INTO settings (id, cities, focus_areas, extra_sources, recipient, window_days)
VALUES (
  1,
  ARRAY['Bengaluru','Mumbai','Hyderabad'],
  '[{"name":"Banking and core banking technology","level":"High"},
    {"name":"Payments and digital payments","level":"High"},
    {"name":"Fintech and BFSI at large","level":"Medium"}]'::jsonb,
  '[]'::jsonb,
  '',
  90
)
ON CONFLICT (id) DO NOTHING;
