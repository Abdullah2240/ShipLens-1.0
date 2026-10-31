import type { Queryable } from '@/platform/db';
import type { ContentLocale, ContentStatus } from './types';

export interface ContentEntryRow {
  id: string;
  key: string;
  locale: ContentLocale;
  title: string | null;
  body: string | null;
  published_title: string | null;
  published_body: string | null;
  status: ContentStatus;
  published_at: Date | null;
  updated_at: Date;
}

const COLUMNS = `id, key, locale, title, body, published_title, published_body, status,
  published_at, updated_at`;

export async function selectEntries(db: Queryable): Promise<ContentEntryRow[]> {
  const { rows } = await db.query<ContentEntryRow>(
    `SELECT ${COLUMNS} FROM content_entries ORDER BY key, locale`,
  );
  return rows;
}

export async function selectEntry(
  db: Queryable,
  key: string,
  locale: ContentLocale,
  opts: { forUpdate?: boolean } = {},
): Promise<ContentEntryRow | null> {
  const { rows } = await db.query<ContentEntryRow>(
    `SELECT ${COLUMNS} FROM content_entries WHERE key = $1 AND locale = $2
     ${opts.forUpdate ? 'FOR UPDATE' : ''}`,
    [key, locale],
  );
  return rows[0] ?? null;
}

/** Writes the draft copy only; status and the public copy are left as they are. */
export async function upsertDraft(
  db: Queryable,
  key: string,
  locale: ContentLocale,
  title: string | null,
  body: string | null,
  userId: string,
): Promise<ContentEntryRow> {
  const { rows } = await db.query<ContentEntryRow>(
    `INSERT INTO content_entries (key, locale, title, body, updated_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (key, locale) DO UPDATE
       SET title = EXCLUDED.title, body = EXCLUDED.body,
           updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING ${COLUMNS}`,
    [key, locale, title, body, userId],
  );
  return rows[0]!;
}

export async function publishRow(
  db: Queryable,
  id: string,
  userId: string,
): Promise<ContentEntryRow> {
  const { rows } = await db.query<ContentEntryRow>(
    `UPDATE content_entries
     SET published_title = title, published_body = body, status = 'published',
         published_at = now(), updated_by = $2, updated_at = now()
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [id, userId],
  );
  return rows[0]!;
}

/** Hides the entry from the public read; both copies are kept for a later re-publish. */
export async function unpublishRow(
  db: Queryable,
  id: string,
  userId: string,
): Promise<ContentEntryRow> {
  const { rows } = await db.query<ContentEntryRow>(
    `UPDATE content_entries
     SET status = 'draft', updated_by = $2, updated_at = now()
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [id, userId],
  );
  return rows[0]!;
}
