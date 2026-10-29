import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '@/platform/time';
import { closeTestPool, resetDb, seedBranch, testPool } from '../../../tests/support/db';
import { isContentKey } from './keys';
import { getPublishedContent, listPublicBranches, listUpcomingEvents } from './service';

const db = testPool();

beforeEach(() => resetDb(db));
afterAll(() => closeTestPool());

async function insertContent(
  locale: 'en' | 'ur',
  status: 'draft' | 'published',
  publishedTitle: string | null,
  publishedBody: string | null,
) {
  await db.query(
    `INSERT INTO content_entries (key, locale, title, body, published_title, published_body, status)
     VALUES ('about', $1, 'Draft title', 'Draft body', $2, $3, $4)`,
    [locale, publishedTitle, publishedBody, status],
  );
}

async function insertEvent(options: {
  slug: string;
  status?: 'draft' | 'published';
  startsAt: string;
  endsAt?: string | null;
  branchId?: string | null;
  titleUr?: string | null;
  summaryUr?: string | null;
}) {
  await db.query(
    `INSERT INTO events
      (slug, title_en, title_ur, summary_en, summary_ur, location, starts_at,
       published_title_en, published_title_ur, published_summary_en, published_summary_ur,
       published_location, published_starts_at, published_ends_at, published_branch_id, status)
     VALUES ($1, 'Draft title', 'مسودہ', 'Draft summary', null, 'Draft place', $2,
       $3, $4, $5, $6, 'Published place', $7, $8, $9, $10)`,
    [
      options.slug,
      options.startsAt,
      `Published ${options.slug}`,
      options.titleUr ?? null,
      `Summary ${options.slug}`,
      options.summaryUr ?? null,
      options.startsAt,
      options.endsAt ?? null,
      options.branchId ?? null,
      options.status ?? 'published',
    ],
  );
}

describe('public content', () => {
  it('recognises only registered keys', () => {
    expect(isContentKey('about')).toBe(true);
    expect(isContentKey('admin')).toBe(false);
  });

  it('returns null for missing and draft rows, serves the published copy, and hides it after unpublish', async () => {
    expect(await getPublishedContent(db, 'about', 'en')).toBeNull();
    await insertContent('en', 'draft', null, null);
    expect(await getPublishedContent(db, 'about', 'en')).toBeNull();
    await db.query(
      `UPDATE content_entries SET status = 'published', published_title = 'Live title', published_body = 'Live body'
       WHERE key = 'about' AND locale = 'en'`,
    );
    expect(await getPublishedContent(db, 'about', 'en')).toEqual({
      key: 'about',
      title: 'Live title',
      body: 'Live body',
      locale: 'en',
      fallback: false,
    });
    await db.query(
      `UPDATE content_entries SET title = 'New draft', body = 'New draft body' WHERE key = 'about'`,
    );
    expect((await getPublishedContent(db, 'about', 'en'))?.body).toBe('Live body');
    await db.query(`UPDATE content_entries SET status = 'draft' WHERE key = 'about'`);
    expect(await getPublishedContent(db, 'about', 'en')).toBeNull();
  });

  it('falls back to English when Urdu is missing or its published copy is empty', async () => {
    await insertContent('en', 'published', 'English title', 'English body');
    expect(await getPublishedContent(db, 'about', 'ur')).toEqual({
      key: 'about',
      title: 'English title',
      body: 'English body',
      locale: 'en',
      fallback: true,
    });
    await insertContent('ur', 'published', null, '');
    expect((await getPublishedContent(db, 'about', 'ur'))?.locale).toBe('en');
    await db.query(
      `UPDATE content_entries SET published_title = 'اردو', published_body = 'متن' WHERE key = 'about' AND locale = 'ur'`,
    );
    expect(await getPublishedContent(db, 'about', 'ur')).toEqual({
      key: 'about',
      title: 'اردو',
      body: 'متن',
      locale: 'ur',
      fallback: false,
    });
  });
});

describe('public branches', () => {
  it('returns only Active branches, in city and name order, with exactly the public fields', async () => {
    const karachi = await seedBranch(db, {
      name: 'Karachi A',
      city: 'Karachi',
      summary: 'Public summary',
    });
    const lahore = await seedBranch(db, { name: 'Lahore A', city: 'Lahore' });
    const another = await seedBranch(db, { name: 'Karachi B', city: 'Karachi' });
    const noCity = await seedBranch(db, { name: 'No city', city: null });
    for (const status of ['forming', 'paused', 'closed']) await seedBranch(db, { status });
    const rows = await listPublicBranches(db);
    expect(rows.map((row) => row.id)).toEqual([karachi.id, another.id, lahore.id, noCity.id]);
    expect(rows[0]).toEqual({
      id: karachi.id,
      name: 'Karachi A',
      city: 'Karachi',
      summary: 'Public summary',
    });
    rows.forEach((row) =>
      expect(Object.keys(row).sort()).toEqual(['city', 'id', 'name', 'summary']),
    );
  });
});

describe('public events', () => {
  const clock = fixedClock('2026-11-01T12:00:00.000Z');

  it('includes upcoming and ongoing published events in published-start order, with field fallback', async () => {
    const active = await seedBranch(db, { name: 'Active branch' });
    const paused = await seedBranch(db, { name: 'Paused branch', status: 'paused' });
    await insertEvent({ slug: 'draft', status: 'draft', startsAt: '2026-11-02T00:00:00Z' });
    await insertEvent({
      slug: 'ended',
      startsAt: '2026-10-30T00:00:00Z',
      endsAt: '2026-10-31T00:00:00Z',
    });
    await insertEvent({
      slug: 'future',
      startsAt: '2026-11-03T00:00:00Z',
      branchId: active.id,
      titleUr: 'مستقبل',
    });
    await insertEvent({
      slug: 'ongoing',
      startsAt: '2026-10-31T00:00:00Z',
      endsAt: '2026-11-02T00:00:00Z',
      branchId: paused.id,
    });
    const rows = await listUpcomingEvents(db, 'ur', clock);
    expect(rows.map((row) => row.slug)).toEqual(['ongoing', 'future']);
    expect(rows[0]).toEqual({
      slug: 'ongoing',
      title: 'Published ongoing',
      summary: 'Summary ongoing',
      location: 'Published place',
      startsAt: '2026-10-31T00:00:00.000Z',
      endsAt: '2026-11-02T00:00:00.000Z',
      branchName: null,
      locale: 'ur',
    });
    expect(rows[1]?.title).toBe('مستقبل');
    expect(rows[1]?.branchName).toBe('Active branch');
    expect(rows[1]?.summary).toBe('Summary future');
  });

  it('keeps draft edits private and removes an unpublished event immediately', async () => {
    await insertEvent({ slug: 'event', startsAt: '2026-11-03T00:00:00Z' });
    await db.query(
      `UPDATE events SET title_en = 'New draft', summary_en = 'New summary', starts_at = '2026-01-01T00:00:00Z' WHERE slug = 'event'`,
    );
    expect((await listUpcomingEvents(db, 'en', clock))[0]?.title).toBe('Published event');
    await db.query(`UPDATE events SET status = 'draft' WHERE slug = 'event'`);
    expect(await listUpcomingEvents(db, 'en', clock)).toEqual([]);
  });
});
