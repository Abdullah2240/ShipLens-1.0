CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- title and body are the DRAFT copy; published_* is the live copy. status = 'published' makes the published copy public. Unpublishing sets status back to 'draft' without clearing the published copy.
ALTER TABLE content_entries
  ADD COLUMN published_title text,
  ADD COLUMN published_body text;

UPDATE content_entries
SET published_title = title,
    published_body = body
WHERE status = 'published';

ALTER TABLE events
  ADD COLUMN ends_at timestamptz,
  ADD COLUMN published_title_en text,
  ADD COLUMN published_title_ur text,
  ADD COLUMN published_summary_en text,
  ADD COLUMN published_summary_ur text,
  ADD COLUMN published_location text,
  ADD COLUMN published_starts_at timestamptz,
  ADD COLUMN published_ends_at timestamptz,
  ADD COLUMN published_branch_id uuid REFERENCES branches (id),
  ADD CONSTRAINT events_ends_after_start
    CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at);

UPDATE events
SET published_title_en = title_en,
    published_title_ur = title_ur,
    published_summary_en = summary_en,
    published_summary_ur = summary_ur,
    published_location = location,
    published_starts_at = starts_at,
    published_ends_at = ends_at,
    published_branch_id = branch_id
WHERE status = 'published';

CREATE INDEX events_published_upcoming_idx
  ON events (published_starts_at)
  WHERE status = 'published';

ALTER TABLE members
  DROP CONSTRAINT members_status_check,
  ADD CONSTRAINT members_status_check CHECK (status IN ('active', 'inactive', 'left'));

CREATE INDEX members_team_id_idx ON members (team_id);
CREATE INDEX members_branch_order_idx ON members (branch_id, lower(full_name), id);

-- Member search queries MUST use exactly this expression so the planner can use the trigram index.
CREATE INDEX members_search_trgm_idx
  ON members USING gin (
    (lower(full_name || ' ' || member_code || ' ' || coalesce(email, '') || ' ' || coalesce(phone, ''))) gin_trgm_ops
  );
