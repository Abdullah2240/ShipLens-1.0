// Public reads require no actor; the queries expose only published copy and public branch fields.
import type { Queryable } from '@/platform/db';
import { type Clock, systemClock } from '@/platform/time';
import type { ContentKey } from './keys';
import { findPublishedEntries, selectActiveBranches, selectUpcomingEvents } from './repo';
import type { ContentLocale, PublicBranch, PublicEvent, PublishedContent } from './types';

export async function getPublishedContent(
  db: Queryable,
  key: ContentKey,
  locale: ContentLocale,
): Promise<PublishedContent | null> {
  const entries = await findPublishedEntries(db, key);
  const visible = (entry: (typeof entries)[number]) =>
    Boolean(entry.title?.trim() || entry.body?.trim());
  const selected =
    entries.find((entry) => entry.locale === locale && visible(entry)) ??
    (locale === 'ur'
      ? entries.find((entry) => entry.locale === 'en' && visible(entry))
      : undefined);
  return selected
    ? {
        key,
        title: selected.title,
        body: selected.body,
        locale: selected.locale,
        fallback: selected.locale !== locale,
      }
    : null;
}

export async function listPublicBranches(db: Queryable): Promise<PublicBranch[]> {
  return selectActiveBranches(db);
}

export async function listUpcomingEvents(
  db: Queryable,
  locale: ContentLocale,
  clock: Clock = systemClock,
): Promise<PublicEvent[]> {
  const rows = await selectUpcomingEvents(db, clock.now());
  return rows.map((row) => ({
    slug: row.slug,
    title:
      (locale === 'ur'
        ? (row.published_title_ur ?? row.published_title_en)
        : row.published_title_en) ?? '',
    summary:
      locale === 'ur'
        ? (row.published_summary_ur ?? row.published_summary_en)
        : row.published_summary_en,
    location: row.published_location,
    startsAt: row.published_starts_at.toISOString(),
    endsAt: row.published_ends_at?.toISOString() ?? null,
    branchName: row.branch_name,
    locale,
  }));
}
