-- Tamper-evident hash chain over audit_events.
--
-- Every audit row carries chain_seq (1, 2, 3, ... with no gaps), prev_hash (the hash of
-- the row before it; 64 zeros for the first row) and hash = sha256 of canonical form v1
-- of the row. Editing any stored field changes the recomputed hash; deleting or inserting
-- a row breaks the sequence or the links. The TypeScript verifier recomputes the same
-- canonical string from columns read as text (src/platform/audit/chain/canonical.ts).
--
-- Canonical form v1:
--   'shiplens-audit-v1' || f(chain_seq) || f(prev_hash) || f(id) || f(occurred_at_utc)
--   || f(request_id) || f(actor_id) || f(actor_role) || f(action) || f(entity_type)
--   || f(entity_id) || f(branch_id) || f(report_id) || f(before::text) || f(after::text)
--   f(v) = '|' || CASE WHEN v IS NULL THEN '-' ELSE octet_length(v)::text || ':' || v END
--   occurred_at_utc = to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
-- The byte-length prefix makes the encoding unambiguous: no value can imitate a separator.

ALTER TABLE audit_events
  ADD COLUMN chain_seq bigint,
  ADD COLUMN prev_hash text,
  ADD COLUMN hash text;

CREATE FUNCTION audit_chain_field(v text) RETURNS text
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT '|' || CASE WHEN v IS NULL THEN '-' ELSE octet_length(v)::text || ':' || v END $$;

-- STABLE, not IMMUTABLE: to_char() and convert_to() are STABLE in pg_proc, and a function
-- must not claim a stronger volatility than the functions it calls.
CREATE FUNCTION audit_event_canonical(
  p_chain_seq bigint,
  p_prev_hash text,
  p_id bigint,
  p_occurred_at timestamptz,
  p_request_id text,
  p_actor_id uuid,
  p_actor_role text,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_branch_id uuid,
  p_report_id uuid,
  p_before jsonb,
  p_after jsonb
) RETURNS text
  LANGUAGE sql STABLE
  AS $$
SELECT 'shiplens-audit-v1'
  || audit_chain_field(p_chain_seq::text)
  || audit_chain_field(p_prev_hash)
  || audit_chain_field(p_id::text)
  || audit_chain_field(to_char(p_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
  || audit_chain_field(p_request_id)
  || audit_chain_field(p_actor_id::text)
  || audit_chain_field(p_actor_role)
  || audit_chain_field(p_action)
  || audit_chain_field(p_entity_type)
  || audit_chain_field(p_entity_id)
  || audit_chain_field(p_branch_id::text)
  || audit_chain_field(p_report_id::text)
  || audit_chain_field(p_before::text)
  || audit_chain_field(p_after::text)
$$;

CREATE FUNCTION audit_event_hash(
  p_chain_seq bigint,
  p_prev_hash text,
  p_id bigint,
  p_occurred_at timestamptz,
  p_request_id text,
  p_actor_id uuid,
  p_actor_role text,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_branch_id uuid,
  p_report_id uuid,
  p_before jsonb,
  p_after jsonb
) RETURNS text
  LANGUAGE sql STABLE
  AS $$
SELECT encode(sha256(convert_to(audit_event_canonical(
  p_chain_seq, p_prev_hash, p_id, p_occurred_at, p_request_id, p_actor_id, p_actor_role,
  p_action, p_entity_type, p_entity_id, p_branch_id, p_report_id, p_before, p_after), 'UTF8')), 'hex')
$$;

-- Backfill existing rows in id order. The immutability trigger is disabled only for this
-- block and re-enabled below; the migration runner wraps the whole file in one transaction,
-- so no other session ever sees audit_events without it.
ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_update_delete;

DO $$
DECLARE
  r record;
  v_seq bigint := 0;
  v_prev text := repeat('0', 64);
  v_hash text;
BEGIN
  FOR r IN SELECT * FROM audit_events ORDER BY id LOOP
    v_seq := v_seq + 1;
    v_hash := audit_event_hash(v_seq, v_prev, r.id, r.occurred_at, r.request_id, r.actor_id,
      r.actor_role, r.action, r.entity_type, r.entity_id, r.branch_id, r.report_id, r.before, r.after);
    UPDATE audit_events SET chain_seq = v_seq, prev_hash = v_prev, hash = v_hash WHERE id = r.id;
    v_prev := v_hash;
  END LOOP;
END;
$$;

ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_update_delete;

ALTER TABLE audit_events
  ALTER COLUMN chain_seq SET NOT NULL,
  ALTER COLUMN prev_hash SET NOT NULL,
  ALTER COLUMN hash SET NOT NULL,
  ADD CONSTRAINT audit_events_hash_hex CHECK (hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT audit_events_prev_hash_hex CHECK (prev_hash ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX audit_events_chain_seq_key ON audit_events (chain_seq);

-- Chain trigger. Runs BEFORE INSERT for every writer (command(), seed, tests) and always
-- overwrites chain_seq, prev_hash and hash, so no writer can skip or forge them.
--
-- Why chain_seq and not id: the identity value is allocated before this trigger takes the
-- lock, so under concurrency id order and commit order can differ. chain_seq is assigned
-- under the lock, so it follows commit order with no gaps.
--
-- Why the lock: pg_advisory_xact_lock(727275) serialises audit inserts from the moment the
-- first audit row of a transaction is inserted until that transaction ends (the migration
-- runner uses 727274). command() writes its audit rows last, so the lock is held briefly.
--
-- READ COMMITTED requirement: the head lookup below takes a fresh snapshot after the lock
-- is granted, so it sees the row committed by the previous lock holder. Audited
-- transactions run at READ COMMITTED (the default; withTransaction sets no isolation level).
-- A REPEATABLE READ or SERIALIZABLE transaction could read a stale head; the unique index
-- on chain_seq then rejects the insert loudly instead of forking the chain.
--
-- The append-only triggers audit_events_no_update_delete and audit_events_no_truncate are
-- untouched by this migration (apart from the backfill window above).
CREATE FUNCTION audit_events_chain() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  v_last_seq bigint;
  v_last_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(727275);

  SELECT chain_seq, hash INTO v_last_seq, v_last_hash
  FROM audit_events
  ORDER BY chain_seq DESC
  LIMIT 1;

  NEW.chain_seq := coalesce(v_last_seq, 0) + 1;
  NEW.prev_hash := coalesce(v_last_hash, repeat('0', 64));
  NEW.hash := audit_event_hash(NEW.chain_seq, NEW.prev_hash, NEW.id, NEW.occurred_at, NEW.request_id,
    NEW.actor_id, NEW.actor_role, NEW.action, NEW.entity_type, NEW.entity_id, NEW.branch_id,
    NEW.report_id, NEW.before, NEW.after);
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_events_chain
  BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_chain();
