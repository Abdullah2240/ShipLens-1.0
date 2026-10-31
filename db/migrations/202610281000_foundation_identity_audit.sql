-- Foundation: identity, sessions, login throttling, branches, append-only audit log.
-- Forward-only plain SQL. The migration runner wraps each file in a transaction.
-- Conventions: uuid keys, timestamptz instants, text + CHECK instead of enum types.

-- Human-readable ID sequences. Branch codes and member IDs are built by the service
-- from these values and the ID_FORMATS constant. Gaps are allowed (rolled-back
-- transactions consume values); uniqueness is what matters.
CREATE SEQUENCE branch_code_seq;
CREATE SEQUENCE member_id_seq;

-- Monday of the ISO week containing d. Business dates are PKT calendar dates.
CREATE FUNCTION pkt_week_start(d date) RETURNS date
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT d - (EXTRACT(ISODOW FROM d)::int - 1) $$;

CREATE TABLE branches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Not defaulted in SQL: the service builds the code from branch_code_seq.
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  city        text,
  summary     text,
  status      text NOT NULL DEFAULT 'forming'
              CONSTRAINT branches_status_check
              CHECK (status IN ('forming', 'active', 'paused', 'closed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL,
  name           text NOT NULL,
  password_hash  text NOT NULL,
  role           text NOT NULL
                 CONSTRAINT users_role_check
                 CHECK (role IN ('super_admin', 'finance_reviewer', 'content_editor', 'branch_lead', 'hr_lead')),
  branch_id      uuid REFERENCES branches (id),
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- Branch-scoped roles must have a branch; head-office roles must not.
  CONSTRAINT users_role_branch_check CHECK (
    (role IN ('branch_lead', 'hr_lead') AND branch_id IS NOT NULL)
    OR (role IN ('super_admin', 'finance_reviewer', 'content_editor') AND branch_id IS NULL)
  )
);
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));
CREATE INDEX users_branch_id_idx ON users (branch_id);

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- sha256 hex of the opaque cookie token. The token itself is never stored.
  token_hash    text NOT NULL UNIQUE,
  user_id       uuid NOT NULL REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  ip            text,
  user_agent    text
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE login_attempts (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text NOT NULL, -- lowercased by the caller
  ip            text,
  succeeded     boolean NOT NULL,
  attempted_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_email_idx ON login_attempts (email, attempted_at DESC);
CREATE INDEX login_attempts_ip_idx ON login_attempts (ip, attempted_at DESC);

CREATE TABLE audit_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  request_id   text,
  -- No foreign key on actor_id or branch_id: history must survive later changes.
  actor_id     uuid,
  actor_role   text NOT NULL, -- 'system' for seed and system actors
  action       text NOT NULL,
  entity_type  text NOT NULL,
  entity_id    text NOT NULL,
  branch_id    uuid,
  report_id    uuid,
  before       jsonb,
  after        jsonb
);
CREATE INDEX audit_events_report_id_idx ON audit_events (report_id);
CREATE INDEX audit_events_branch_idx ON audit_events (branch_id, occurred_at);
CREATE INDEX audit_events_entity_idx ON audit_events (entity_type, entity_id);
CREATE INDEX audit_events_actor_idx ON audit_events (actor_id);
CREATE INDEX audit_events_occurred_at_idx ON audit_events (occurred_at);

-- Append-only: UPDATE and DELETE are rejected at the database level.
CREATE FUNCTION audit_events_immutable() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();

-- TRUNCATE is also rejected, unless the transaction sets shiplens.allow_truncate = 'on'.
-- Only the integration-test harness sets it (to reset state between tests).
CREATE FUNCTION audit_events_truncate_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF current_setting('shiplens.allow_truncate', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_truncate_guard();
