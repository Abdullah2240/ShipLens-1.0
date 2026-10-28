-- Full domain schema for later phases, declared up front so migrations stay one ordered sequence.
-- Later plans only add new migration files; they never edit these two.
-- Approved-report immutability triggers and reporting views are added by the Phase 2
-- and Phase 3 migrations, not here.

CREATE TABLE weekly_reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id         uuid NOT NULL REFERENCES branches (id),
  -- Monday of the report week (PKT business date).
  week_start        date NOT NULL
                    CONSTRAINT weekly_reports_week_start_monday CHECK (EXTRACT(ISODOW FROM week_start) = 1),
  status            text NOT NULL DEFAULT 'draft'
                    CONSTRAINT weekly_reports_status_check
                    CHECK (status IN ('draft', 'submitted', 'returned', 'approved')),
  total_amount      numeric(14,2)
                    CONSTRAINT weekly_reports_total_amount_check CHECK (total_amount >= 0),
  collection_count  integer,
  submitted_at      timestamptz,
  submitted_by      uuid REFERENCES users (id),
  reviewed_at       timestamptz,
  reviewed_by       uuid REFERENCES users (id),
  return_reason     text,
  version           integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weekly_reports_branch_week_key UNIQUE (branch_id, week_start)
);
CREATE INDEX weekly_reports_status_idx ON weekly_reports (status);

CREATE TABLE collections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   uuid NOT NULL REFERENCES branches (id),
  report_id   uuid NOT NULL REFERENCES weekly_reports (id),
  amount      numeric(14,2) NOT NULL
              CONSTRAINT collections_amount_positive CHECK (amount > 0),
  collected_on date NOT NULL,
  purpose     text NOT NULL,
  note        text,
  status      text NOT NULL DEFAULT 'active'
              CONSTRAINT collections_status_check CHECK (status IN ('active', 'voided')),
  void_reason text,
  voided_at   timestamptz,
  voided_by   uuid REFERENCES users (id),
  created_by  uuid NOT NULL REFERENCES users (id),
  -- Set when the collection has been routed onward (oracle data loads this column).
  routed_at   timestamptz,
  routed_by   uuid REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collections_void_reason_required CHECK (status <> 'voided' OR void_reason IS NOT NULL)
);
CREATE INDEX collections_branch_date_idx ON collections (branch_id, collected_on);
CREATE INDEX collections_report_id_idx ON collections (report_id);
CREATE INDEX collections_unrouted_idx ON collections (routed_at) WHERE routed_at IS NULL;

CREATE TABLE report_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id   uuid NOT NULL REFERENCES weekly_reports (id),
  event_type  text NOT NULL
              CONSTRAINT report_events_type_check
              CHECK (event_type IN ('submitted', 'returned', 'approved', 'resubmitted')),
  from_status text,
  to_status   text,
  actor_id    uuid,
  reason      text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_events_report_idx ON report_events (report_id, id);

CREATE TABLE applications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     uuid NOT NULL REFERENCES branches (id),
  full_name     text NOT NULL,
  email         text NOT NULL,
  phone         text,
  message       text,
  status        text NOT NULL DEFAULT 'pending'
                CONSTRAINT applications_status_check CHECK (status IN ('pending', 'accepted', 'declined')),
  decided_by    uuid REFERENCES users (id),
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- A duplicate pending application (same email, same branch) is rejected.
CREATE UNIQUE INDEX applications_pending_email_branch_key
  ON applications (lower(email), branch_id) WHERE status = 'pending';
CREATE INDEX applications_branch_status_idx ON applications (branch_id, status);

CREATE TABLE teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   uuid NOT NULL REFERENCES branches (id),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX teams_branch_name_key ON teams (branch_id, lower(name));

CREATE TABLE members (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_code    text NOT NULL UNIQUE,
  branch_id      uuid NOT NULL REFERENCES branches (id),
  -- At most one member per application.
  application_id uuid UNIQUE REFERENCES applications (id),
  full_name      text NOT NULL,
  email          text,
  phone          text,
  team_id        uuid REFERENCES teams (id),
  member_role    text NOT NULL DEFAULT 'volunteer',
  status         text NOT NULL DEFAULT 'active'
                 CONSTRAINT members_status_check CHECK (status IN ('active', 'inactive')),
  joined_on      date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX members_branch_id_idx ON members (branch_id);
CREATE INDEX members_email_lower_idx ON members (lower(email));

CREATE TABLE content_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key           text NOT NULL,
  locale        text NOT NULL
                CONSTRAINT content_entries_locale_check CHECK (locale IN ('en', 'ur')),
  title         text,
  body          text,
  status        text NOT NULL DEFAULT 'draft'
                CONSTRAINT content_entries_status_check CHECK (status IN ('draft', 'published')),
  updated_by    uuid REFERENCES users (id),
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_entries_key_locale_key UNIQUE (key, locale)
);

CREATE TABLE events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  title_en      text,
  title_ur      text,
  summary_en    text,
  summary_ur    text,
  location      text,
  starts_at     timestamptz,
  branch_id     uuid REFERENCES branches (id),
  status        text NOT NULL DEFAULT 'draft'
                CONSTRAINT events_status_check CHECK (status IN ('draft', 'published')),
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
