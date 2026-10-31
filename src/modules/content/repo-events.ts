import type { Queryable } from '@/platform/db';
import { NotFound } from '@/platform/errors';
import type { EventStatus } from './event-types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EventRow {
  id: string;
  slug: string;
  title_en: string | null;
  title_ur: string | null;
  summary_en: string | null;
  summary_ur: string | null;
  location: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  branch_id: string | null;
  branch_name: string | null;
  published_title_en: string | null;
  published_title_ur: string | null;
  published_summary_en: string | null;
  published_summary_ur: string | null;
  published_location: string | null;
  published_starts_at: Date | null;
  published_ends_at: Date | null;
  published_branch_id: string | null;
  status: EventStatus;
  published_at: Date | null;
  updated_at: Date;
}

/** The draft columns an edit may write. Anything else in a SET map is a programming error. */
export const EVENT_DRAFT_COLUMNS = [
  'title_en',
  'title_ur',
  'summary_en',
  'summary_ur',
  'location',
  'starts_at',
  'ends_at',
  'branch_id',
] as const;
export type EventDraftColumn = (typeof EVENT_DRAFT_COLUMNS)[number];
export type EventDraftValues = Partial<Record<EventDraftColumn, string | null>>;

const COLUMNS = `e.id, e.slug, e.title_en, e.title_ur, e.summary_en, e.summary_ur, e.location,
  e.starts_at, e.ends_at, e.branch_id, b.name AS branch_name,
  e.published_title_en, e.published_title_ur, e.published_summary_en, e.published_summary_ur,
  e.published_location, e.published_starts_at, e.published_ends_at, e.published_branch_id,
  e.status, e.published_at, e.updated_at`;
const FROM = `FROM events e LEFT JOIN branches b ON b.id = e.branch_id`;

export async function selectEvents(db: Queryable): Promise<EventRow[]> {
  const { rows } = await db.query<EventRow>(
    `SELECT ${COLUMNS} ${FROM} ORDER BY e.starts_at DESC NULLS FIRST, e.id`,
  );
  return rows;
}

/** Missing and malformed ids are the same NotFound. */
export async function selectEventById(
  db: Queryable,
  id: string,
  opts: { forUpdate?: boolean } = {},
): Promise<EventRow> {
  if (!UUID.test(id)) throw new NotFound();
  const { rows } = await db.query<EventRow>(
    `SELECT ${COLUMNS} ${FROM} WHERE e.id = $1 ${opts.forUpdate ? 'FOR UPDATE OF e' : ''}`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new NotFound();
  return row;
}

/** Inserts a draft. Returns null when the slug is already taken, so the caller can retry. */
export async function insertEvent(
  db: Queryable,
  slug: string,
  values: EventDraftValues,
): Promise<string | null> {
  const columns = EVENT_DRAFT_COLUMNS.filter((column) => values[column] !== undefined);
  const placeholders = columns.map((_, i) => `$${i + 2}`);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO events (slug${columns.map((column) => `, ${column}`).join('')})
     VALUES ($1${placeholders.map((p) => `, ${p}`).join('')})
     ON CONFLICT (slug) DO NOTHING
     RETURNING id`,
    [slug, ...columns.map((column) => values[column])],
  );
  return rows[0]?.id ?? null;
}

/** Writes the draft copy only; status and the public copy are left as they are. */
export async function updateEventRow(
  db: Queryable,
  id: string,
  set: EventDraftValues,
): Promise<void> {
  const columns = EVENT_DRAFT_COLUMNS.filter((column) => set[column] !== undefined);
  const assignments = columns.map((column, i) => `${column} = $${i + 2}`);
  await db.query(
    `UPDATE events SET ${[...assignments, 'updated_at = now()'].join(', ')} WHERE id = $1`,
    [id, ...columns.map((column) => set[column])],
  );
}

export async function publishEventRow(db: Queryable, id: string): Promise<void> {
  await db.query(
    `UPDATE events
     SET published_title_en = title_en, published_title_ur = title_ur,
         published_summary_en = summary_en, published_summary_ur = summary_ur,
         published_location = location, published_starts_at = starts_at,
         published_ends_at = ends_at, published_branch_id = branch_id,
         status = 'published', published_at = now(), updated_at = now()
     WHERE id = $1`,
    [id],
  );
}

/** Hides the event from the public read; both copies are kept for a later re-publish. */
export async function unpublishEventRow(db: Queryable, id: string): Promise<void> {
  await db.query(`UPDATE events SET status = 'draft', updated_at = now() WHERE id = $1`, [id]);
}

export async function branchExists(db: Queryable, id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const { rows } = await db.query(`SELECT 1 FROM branches WHERE id = $1`, [id]);
  return rows.length > 0;
}

/** Same Active status value as the public branch list. */
export async function selectActiveBranchOptions(
  db: Queryable,
): Promise<{ id: string; name: string }[]> {
  const { rows } = await db.query<{ id: string; name: string }>(
    `SELECT id, name FROM branches WHERE status = 'active' ORDER BY lower(name), id`,
  );
  return rows;
}
