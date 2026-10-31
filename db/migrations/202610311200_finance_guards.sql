-- Database guards for the weekly report lifecycle and collection immutability.
-- The services check these rules first and answer with 409s; these row triggers are the
-- second line of defence against direct SQL writes and service bugs. They are row-level
-- only, so TRUNCATE (test harness reset) is unaffected.

CREATE FUNCTION weekly_reports_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'finance_guard: weekly reports are never deleted' USING ERRCODE = 'P0001';
  END IF;

  IF OLD.status = 'approved' THEN
    RAISE EXCEPTION 'finance_guard: approved report is locked' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id OR NEW.week_start IS DISTINCT FROM OLD.week_start THEN
    RAISE EXCEPTION 'finance_guard: report branch and week are immutable' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND (OLD.status, NEW.status) NOT IN (
    ('draft', 'submitted'),
    ('submitted', 'returned'),
    ('submitted', 'approved'),
    ('returned', 'submitted')
  ) THEN
    RAISE EXCEPTION 'finance_guard: invalid report transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER weekly_reports_guard_update
  BEFORE UPDATE ON weekly_reports
  FOR EACH ROW EXECUTE FUNCTION weekly_reports_guard();

CREATE TRIGGER weekly_reports_guard_delete
  BEFORE DELETE ON weekly_reports
  FOR EACH ROW EXECUTE FUNCTION weekly_reports_guard();

CREATE FUNCTION collections_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'finance_guard: collections are never deleted' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT status, branch_id, week_start INTO r FROM weekly_reports WHERE id = NEW.report_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'finance_guard: report not found' USING ERRCODE = 'P0001';
    END IF;
    IF r.status NOT IN ('draft', 'returned') THEN
      RAISE EXCEPTION 'finance_guard: report is not open for collections' USING ERRCODE = 'P0001';
    END IF;
    IF r.branch_id <> NEW.branch_id THEN
      RAISE EXCEPTION 'finance_guard: collection branch differs from report branch' USING ERRCODE = 'P0001';
    END IF;
    IF r.week_start <> pkt_week_start(NEW.collected_on) THEN
      RAISE EXCEPTION 'finance_guard: collection date is outside the report week' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.routed_at IS NOT NULL THEN
      RAISE EXCEPTION 'finance_guard: a new collection cannot be routed' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.report_id IS DISTINCT FROM OLD.report_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'finance_guard: collection identity columns are immutable' USING ERRCODE = 'P0001';
  END IF;

  IF OLD.status = 'voided' AND NEW.status = 'active' THEN
    RAISE EXCEPTION 'finance_guard: a voided collection cannot be reactivated' USING ERRCODE = 'P0001';
  END IF;

  IF pkt_week_start(NEW.collected_on) <> pkt_week_start(OLD.collected_on) THEN
    RAISE EXCEPTION 'finance_guard: collection date cannot leave its report week' USING ERRCODE = 'P0001';
  END IF;

  SELECT status INTO r FROM weekly_reports WHERE id = NEW.report_id;

  IF r.status IN ('submitted', 'approved') AND (
       NEW.amount IS DISTINCT FROM OLD.amount
    OR NEW.collected_on IS DISTINCT FROM OLD.collected_on
    OR NEW.purpose IS DISTINCT FROM OLD.purpose
    OR NEW.note IS DISTINCT FROM OLD.note
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.void_reason IS DISTINCT FROM OLD.void_reason
    OR NEW.voided_at IS DISTINCT FROM OLD.voided_at
    OR NEW.voided_by IS DISTINCT FROM OLD.voided_by
  ) THEN
    RAISE EXCEPTION 'finance_guard: collection is locked in a % report', r.status USING ERRCODE = 'P0001';
  END IF;

  IF NEW.routed_at IS NOT NULL AND (r.status IS DISTINCT FROM 'approved' OR NEW.status <> 'active') THEN
    RAISE EXCEPTION 'finance_guard: only active collections in an approved report can be routed'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER collections_guard_write
  BEFORE INSERT OR UPDATE ON collections
  FOR EACH ROW EXECUTE FUNCTION collections_guard();

CREATE TRIGGER collections_guard_delete
  BEFORE DELETE ON collections
  FOR EACH ROW EXECUTE FUNCTION collections_guard();

CREATE INDEX weekly_reports_status_submitted_idx ON weekly_reports (status, submitted_at);
CREATE INDEX collections_report_status_idx ON collections (report_id, status);
