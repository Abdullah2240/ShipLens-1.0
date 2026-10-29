import type { Queryable } from '@/platform/db';
import type { ContentKey } from './keys';
import type { ContentLocale, PublicBranch } from './types';

export interface PublishedEntryRow {
  locale: ContentLocale;
  title: string | null;
  body: string | null;
}

export interface UpcomingEventRow {
  slug: string;
  published_title_en: string | null;
  published_title_ur: string | null;
  published_summary_en: string | null;
  published_summary_ur: string | null;
  published_location: string | null;
  published_starts_at: Date;
  published_ends_at: Date | null;
  branch_name: string | null;
}

export async function findPublishedEntries(
  db: Queryable,
  key: ContentKey,
): Promise<PublishedEntryRow[]> {
  const { rows } = await db.query<PublishedEntryRow>(
    `SELECT locale, published_title AS title, published_body AS body
     FROM content_entries
     WHERE key = $1 AND status = 'published'`,
    [key],
  );
  return rows;
}

export async function selectActiveBranches(db: Queryable): Promise<PublicBranch[]> {
  const { rows } = await db.query<PublicBranch>(
    `SELECT id, name, city, summary
     FROM branches
     WHERE status = 'active'
     ORDER BY city NULLS LAST, name, id`,
  );
  return rows;
}

export async function selectUpcomingEvents(db: Queryable, now: Date): Promise<UpcomingEventRow[]> {
  const { rows } = await db.query<UpcomingEventRow>(
    `SELECT e.slug, e.published_title_en, e.published_title_ur,
            e.published_summary_en, e.published_summary_ur, e.published_location,
            e.published_starts_at, e.published_ends_at, b.name AS branch_name
     FROM events e
     LEFT JOIN branches b ON b.id = e.published_branch_id AND b.status = 'active'
     WHERE e.status = 'published'
       AND e.published_starts_at IS NOT NULL
       AND coalesce(e.published_ends_at, e.published_starts_at) >= $1
     ORDER BY e.published_starts_at, e.id`,
    [now],
  );
  return rows;
}
