-- Public verification codes for approved weekly reports.
--
-- Every approved report gets one short code (10 Crockford base32 characters, 50 random
-- bits, shown as XXXXX-XXXXX) that anyone can type or scan to check the approved figures.
-- Codes are public by design: they carry no personal data and only identify a report.
--
-- Why issuance is a trigger: the code must exist from the moment a report is approved,
-- whichever writer approves it (the approve service, the demo seed loading approved rows,
-- direct SQL). AFTER triggers on weekly_reports issue it in the same transaction, so a
-- rolled-back approval leaves no code and the Phase 2 services need no change. The triggers
-- write only to report_verifications and coexist with the finance guards on weekly_reports.
--
-- Why there is no separate audit row: the code is derived from the approval and never
-- changes, and the approval audit event (report.approve) is the anchor that the public
-- check reads. A trigger-written audit row would also change the audit-row counts that the
-- report lifecycle tests assert.
--
-- The table is append-only: UPDATE and DELETE raise. TRUNCATE is not guarded, so the test
-- harness can still empty it through TRUNCATE weekly_reports ... CASCADE.

CREATE TABLE report_verifications (
  report_id  uuid PRIMARY KEY REFERENCES weekly_reports (id),
  code       text NOT NULL UNIQUE
             CONSTRAINT report_verifications_code_format CHECK (code ~ '^[0-9A-HJKMNP-TV-Z]{10}$'),
  issued_at  timestamptz NOT NULL DEFAULT now()
);

-- 10 symbols from the random bytes of a version 4 uuid. Bytes 6 (version) and 8 (variant)
-- hold fixed bits, so only offsets 0-5 and 9-12 are used. byte % 32 keeps the low five
-- bits, which is uniform because 256 is a multiple of 32. gen_random_uuid() draws from the
-- server's cryptographic random source; the non-cryptographic random generator is never
-- used for codes.
CREATE FUNCTION shiplens_verification_code() RETURNS text
  LANGUAGE plpgsql VOLATILE
  AS $$
DECLARE
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea := uuid_send(gen_random_uuid());
  v_offset int;
  v_code text := '';
BEGIN
  FOREACH v_offset IN ARRAY ARRAY[0, 1, 2, 3, 4, 5, 9, 10, 11, 12] LOOP
    v_code := v_code || substr(v_alphabet, get_byte(v_bytes, v_offset) % 32 + 1, 1);
  END LOOP;
  RETURN v_code;
END;
$$;

-- Issues the code for one report unless it already has one. A collision on the code itself
-- (about one in 10^15 per pair) is retried with a fresh code, up to five attempts. Shared
-- by the issuance triggers and the backfill below.
CREATE FUNCTION shiplens_issue_report_verification(p_report_id uuid, p_issued_at timestamptz)
  RETURNS void
  LANGUAGE plpgsql
  AS $$
DECLARE
  v_attempt int;
  v_constraint text;
BEGIN
  FOR v_attempt IN 1..5 LOOP
    BEGIN
      INSERT INTO report_verifications (report_id, code, issued_at)
      VALUES (p_report_id, shiplens_verification_code(), p_issued_at)
      ON CONFLICT (report_id) DO NOTHING;
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint IS DISTINCT FROM 'report_verifications_code_key' THEN
        RAISE;
      END IF;
    END;
  END LOOP;
  RAISE EXCEPTION 'report_verifications: could not issue a unique verification code for report %',
    p_report_id USING ERRCODE = 'P0001';
END;
$$;

CREATE FUNCTION issue_report_verification() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  PERFORM shiplens_issue_report_verification(NEW.id, coalesce(NEW.reviewed_at, now()));
  RETURN NULL;
END;
$$;

CREATE TRIGGER weekly_reports_issue_verification_ins
  AFTER INSERT ON weekly_reports
  FOR EACH ROW WHEN (NEW.status = 'approved')
  EXECUTE FUNCTION issue_report_verification();

CREATE TRIGGER weekly_reports_issue_verification_upd
  AFTER UPDATE OF status ON weekly_reports
  FOR EACH ROW WHEN (NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved')
  EXECUTE FUNCTION issue_report_verification();

CREATE FUNCTION report_verifications_append_only() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'report_verifications is append-only' USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER report_verifications_no_update_delete
  BEFORE UPDATE OR DELETE ON report_verifications
  FOR EACH ROW EXECUTE FUNCTION report_verifications_append_only();

-- Backfill: approved reports that existed before this migration, through the same
-- function as the triggers so a code collision is retried here too.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id, reviewed_at FROM weekly_reports WHERE status = 'approved' ORDER BY id LOOP
    PERFORM shiplens_issue_report_verification(r.id, coalesce(r.reviewed_at, now()));
  END LOOP;
END;
$$;
