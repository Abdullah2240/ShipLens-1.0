import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDb, seedBranch, testPool } from '../support/db';

afterAll(async () => closeTestPool());
beforeEach(async () => resetDb());

async function constraintFailure(sql: string, values: unknown[] = []) {
  try {
    await testPool().query(sql, values);
    throw new Error('expected query to fail');
  } catch (error) {
    return error as { constraint?: string; code?: string };
  }
}

describe('phase 2 schema', () => {
  it('keeps content draft and published copies separate', async () => {
    const { rows } = await testPool().query(
      "INSERT INTO content_entries (key, locale, title, body) VALUES ('home', 'en', 'Draft', 'Draft body') RETURNING published_title, published_body",
    );
    expect(rows[0]).toEqual({ published_title: null, published_body: null });
  });

  it('provides event draft and published copies with optional end times', async () => {
    const { rows: columns } = await testPool().query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'events'",
    );
    for (const name of ['ends_at', 'published_title_en', 'published_title_ur', 'published_summary_en', 'published_summary_ur', 'published_location', 'published_starts_at', 'published_ends_at', 'published_branch_id']) {
      expect(columns.map((row) => row.column_name)).toContain(name);
    }
    const branch = await seedBranch(testPool());
    await expect(testPool().query(
      "INSERT INTO events (slug, title_en, title_ur, summary_en, summary_ur, location, starts_at, ends_at, branch_id) VALUES ('event', 'Title', 'عنوان', 'Summary', 'خلاصہ', 'Venue', now(), NULL, $1)",
      [branch.id],
    )).resolves.toBeDefined();
  });

  it('rejects an event end before its start', async () => {
    const error = await constraintFailure(
      "INSERT INTO events (slug, title_en, title_ur, summary_en, summary_ur, location, starts_at, ends_at) VALUES ('bad-event', 'Title', 'عنوان', 'Summary', 'خلاصہ', 'Venue', '2026-10-29T12:00:00Z', '2026-10-29T11:00:00Z')",
    );
    expect(error.constraint).toBe('events_ends_after_start');
  });

  it('accepts left members and rejects other unknown statuses', async () => {
    const branch = await seedBranch(testPool());
    const { rows } = await testPool().query(
      "INSERT INTO members (member_code, branch_id, full_name, status) VALUES ('M-1', $1, 'Abc Person', 'left') RETURNING status",
      [branch.id],
    );
    expect(rows[0].status).toBe('left');
    const error = await constraintFailure(
      "INSERT INTO members (member_code, branch_id, full_name, status) VALUES ('M-2', $1, 'Gone Person', 'gone')",
      [branch.id],
    );
    expect(error.constraint).toBe('members_status_check');
  });

  it('creates the trigram and ordering indexes', async () => {
    const { rows } = await testPool().query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE indexname = ANY($1)",
      [['members_search_trgm_idx', 'members_team_id_idx', 'members_branch_order_idx', 'events_published_upcoming_idx']],
    );
    expect(rows.map((row) => row.indexname).sort()).toEqual([
      'events_published_upcoming_idx', 'members_branch_order_idx', 'members_search_trgm_idx', 'members_team_id_idx',
    ]);
  });

  it('uses the trigram index for the exact member search expression', async () => {
    const client = await testPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(
        "EXPLAIN SELECT id FROM members WHERE lower(full_name || ' ' || member_code || ' ' || coalesce(email, '') || ' ' || coalesce(phone, '')) LIKE '%abc%'",
      );
      expect(rows.map((row) => row['QUERY PLAN']).join('\n')).toContain('members_search_trgm_idx');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
