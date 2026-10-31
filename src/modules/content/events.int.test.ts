import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { listUpcomingEvents } from '@/modules/public-site';
import type { CommandContext } from '@/platform/audit/types';
import type { Actor } from '@/platform/authz';
import { Conflict, Forbidden, NotFound, ValidationFailed, mapError } from '@/platform/errors';
import { fixedClock, systemClock } from '@/platform/time';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../../../tests/support/db';
import type { EventInputDraft } from './event-schema';
import {
  createEvent,
  getEvent,
  listBranchOptionsForContent,
  listEvents,
  mapEventDbError,
  publishEvent,
  unpublishEvent,
  updateEvent,
} from './service-events';

const db = testPool();
// public reads are judged against a fixed "now" before every fixture date below
const clock = fixedClock('2026-11-01T00:00:00.000Z');

async function actorFor(role: Actor['role']): Promise<Actor> {
  const branchId = role === 'hr_lead' || role === 'branch_lead' ? (await seedBranch(db)).id : null;
  const user = await seedUser(db, { role, branchId });
  return { userId: user.id, role, branchId };
}
const ctx = (actor: Actor): CommandContext => ({
  actor,
  requestId: randomUUID(),
  clock: systemClock,
  pool: db,
});
async function auditRows(action?: string) {
  const { rows } = await db.query<{
    action: string;
    entity_type: string;
    entity_id: string;
    actor_id: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }>(
    `SELECT action, entity_type, entity_id, actor_id, before, after FROM audit_events
     ${action ? 'WHERE action = $1' : ''} ORDER BY occurred_at, id`,
    action ? [action] : [],
  );
  return rows;
}
async function eventRow(id: string) {
  const { rows } = await db.query<Record<string, unknown>>(`SELECT * FROM events WHERE id = $1`, [
    id,
  ]);
  return rows[0]!;
}
async function eventCount(): Promise<number> {
  const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM events');
  return rows[0]!.n;
}
const publicList = (locale: 'en' | 'ur' = 'en') => listUpcomingEvents(db, locale, clock);

const camp: EventInputDraft = {
  titleEn: 'Health camp',
  titleUr: 'طبی کیمپ',
  summaryEn: 'Free checkups',
  summaryUr: 'مفت معائنہ',
  location: 'Community hall',
  startsAt: '2026-11-15T09:00:00Z',
  endsAt: '2026-11-15T11:00:00Z',
};

beforeEach(() => resetDb(db));
afterAll(() => closeTestPool());

describe('event permissions', () => {
  it('allows content_editor and super_admin to call every function', async () => {
    for (const role of ['content_editor', 'super_admin'] as const) {
      await resetDb(db);
      const actor = await actorFor(role);
      const created = await createEvent(ctx(actor), camp);
      expect(await listEvents(db, actor)).toHaveLength(1);
      expect((await getEvent(db, actor, created.id)).titleEn).toBe('Health camp');
      await updateEvent(ctx(actor), created.id, { location: 'Main hall' });
      await publishEvent(ctx(actor), created.id);
      expect((await unpublishEvent(ctx(actor), created.id)).status).toBe('draft');
      expect(await listBranchOptionsForContent(db, actor)).toEqual([]);
    }
  });

  it('forbids every other role from every function without writing anything', async () => {
    const editor = await actorFor('content_editor');
    const event = await createEvent(ctx(editor), camp);
    await publishEvent(ctx(editor), event.id);
    const before = (await auditRows()).length;
    for (const role of ['hr_lead', 'branch_lead', 'finance_reviewer'] as const) {
      const actor = await actorFor(role);
      await expect(listEvents(db, actor)).rejects.toThrow(Forbidden);
      await expect(getEvent(db, actor, event.id)).rejects.toThrow(Forbidden);
      await expect(createEvent(ctx(actor), camp)).rejects.toThrow(Forbidden);
      await expect(updateEvent(ctx(actor), event.id, { titleEn: 'Nope' })).rejects.toThrow(
        Forbidden,
      );
      await expect(publishEvent(ctx(actor), event.id)).rejects.toThrow(Forbidden);
      await expect(unpublishEvent(ctx(actor), event.id)).rejects.toThrow(Forbidden);
      await expect(listBranchOptionsForContent(db, actor)).rejects.toThrow(Forbidden);
      // forbidden even for unknown ids, so the id space is not probeable
      await expect(getEvent(db, actor, randomUUID())).rejects.toThrow(Forbidden);
    }
    expect(await auditRows()).toHaveLength(before);
    expect(await eventCount()).toBe(1);
    expect((await getEvent(db, editor, event.id)).status).toBe('published');
  });
});

describe('createEvent', () => {
  it('creates a draft with a generated slug and audits it without summaries', async () => {
    const editor = await actorFor('content_editor');
    const created = await createEvent(ctx(editor), camp);
    expect(created).toMatchObject({
      slug: expect.stringMatching(/^evt-[0-9a-f]{8}$/),
      titleEn: 'Health camp',
      titleUr: 'طبی کیمپ',
      summaryEn: 'Free checkups',
      summaryUr: 'مفت معائنہ',
      location: 'Community hall',
      startsAt: '2026-11-15T09:00:00.000Z',
      endsAt: '2026-11-15T11:00:00.000Z',
      branchId: null,
      branchName: null,
      status: 'draft',
      hasUnpublishedChanges: false,
      publishedAt: null,
    });
    expect(created.updatedAt).toEqual(expect.any(String));

    const row = await eventRow(created.id);
    expect(row).toMatchObject({ status: 'draft', published_title_en: null });

    const audits = await auditRows('event.create');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      entity_type: 'event',
      entity_id: created.id,
      actor_id: editor.userId,
      before: null,
      after: {
        slug: created.slug,
        status: 'draft',
        title_en: 'Health camp',
        starts_at: '2026-11-15T09:00:00.000Z',
        ends_at: '2026-11-15T11:00:00.000Z',
        location: 'Community hall',
        branch_id: null,
      },
    });
    const text = JSON.stringify(audits);
    expect(text).not.toContain('Free checkups');
    expect(text).not.toContain('summary');
    expect(text).not.toContain('title_ur');
  });

  it('gives each event its own slug', async () => {
    const editor = await actorFor('content_editor');
    const slugs = new Set<string>();
    for (let i = 0; i < 5; i++) slugs.add((await createEvent(ctx(editor), camp)).slug);
    expect(slugs.size).toBe(5);
  });

  it('stores an existing branch and rejects an unknown one without writing', async () => {
    const editor = await actorFor('content_editor');
    const branch = await seedBranch(db, { name: 'Lahore' });
    const withBranch = await createEvent(ctx(editor), { ...camp, branchId: branch.id });
    expect(withBranch).toMatchObject({ branchId: branch.id, branchName: 'Lahore' });

    const before = (await auditRows()).length;
    const error = await createEvent(ctx(editor), { ...camp, branchId: randomUUID() }).catch(
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(ValidationFailed);
    expect((error as ValidationFailed).details).toEqual({
      fields: [{ path: 'branchId', code: 'invalid_branch', message: 'invalid_branch' }],
    });
    expect(await eventCount()).toBe(1);
    expect(await auditRows()).toHaveLength(before);
  });

  it('keeps a draft invisible to the public list', async () => {
    const editor = await actorFor('content_editor');
    await createEvent(ctx(editor), camp);
    expect(await publicList('en')).toEqual([]);
    expect(await publicList('ur')).toEqual([]);
  });
});

describe('publishEvent', () => {
  it('copies every draft column to the public copy and audits the change', async () => {
    const editor = await actorFor('content_editor');
    const branch = await seedBranch(db, { name: 'Karachi' });
    const created = await createEvent(ctx(editor), { ...camp, branchId: branch.id });
    const published = await publishEvent(ctx(editor), created.id);
    expect(published).toMatchObject({ status: 'published', hasUnpublishedChanges: false });
    expect(published.publishedAt).toEqual(expect.any(String));

    const row = await eventRow(created.id);
    expect(row).toMatchObject({
      status: 'published',
      published_title_en: 'Health camp',
      published_title_ur: 'طبی کیمپ',
      published_summary_en: 'Free checkups',
      published_summary_ur: 'مفت معائنہ',
      published_location: 'Community hall',
      published_starts_at: new Date('2026-11-15T09:00:00Z'),
      published_ends_at: new Date('2026-11-15T11:00:00Z'),
      published_branch_id: branch.id,
    });
    expect(row.published_at).toBeInstanceOf(Date);

    expect(await publicList('en')).toEqual([
      {
        slug: created.slug,
        title: 'Health camp',
        summary: 'Free checkups',
        location: 'Community hall',
        startsAt: '2026-11-15T09:00:00.000Z',
        endsAt: '2026-11-15T11:00:00.000Z',
        branchName: 'Karachi',
        locale: 'en',
      },
    ]);
    expect((await publicList('ur'))[0]).toMatchObject({ title: 'طبی کیمپ', summary: 'مفت معائنہ' });

    const audits = await auditRows('event.publish');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      entity_type: 'event',
      entity_id: created.id,
      before: { status: 'draft', title_en: null, starts_at: null },
      after: {
        status: 'published',
        title_en: 'Health camp',
        starts_at: '2026-11-15T09:00:00.000Z',
        location: 'Community hall',
        branch_id: branch.id,
      },
    });
  });

  it('falls back to the English title when there is no Urdu title', async () => {
    const editor = await actorFor('content_editor');
    const created = await createEvent(ctx(editor), {
      titleEn: 'Clean-up drive',
      startsAt: '2026-11-20T05:00:00Z',
    });
    await publishEvent(ctx(editor), created.id);
    expect((await publicList('ur'))[0]).toMatchObject({ title: 'Clean-up drive', summary: null });
  });

  it('refuses to publish without an English title or a start time', async () => {
    const editor = await actorFor('content_editor');
    const created = await createEvent(ctx(editor), { titleEn: 'No date yet' });
    const noStart = await publishEvent(ctx(editor), created.id).catch((err: unknown) => err);
    expect(noStart).toBeInstanceOf(ValidationFailed);
    expect((noStart as ValidationFailed).details).toEqual({
      fields: [{ path: 'startsAt', code: 'required_to_publish', message: 'required_to_publish' }],
    });

    // only reachable through older rows; the schemas never store an empty English title
    await db.query(`UPDATE events SET title_en = NULL WHERE id = $1`, [created.id]);
    const neither = await publishEvent(ctx(editor), created.id).catch((err: unknown) => err);
    expect((neither as ValidationFailed).details).toEqual({
      fields: [
        { path: 'startsAt', code: 'required_to_publish', message: 'required_to_publish' },
        { path: 'titleEn', code: 'required_to_publish', message: 'required_to_publish' },
      ],
    });
    expect(await auditRows('event.publish')).toHaveLength(0);
    expect((await eventRow(created.id)).status).toBe('draft');
  });

  it('accepts a past event but keeps it off the upcoming list', async () => {
    const editor = await actorFor('content_editor');
    const past = await createEvent(ctx(editor), {
      titleEn: 'Last month',
      startsAt: '2026-10-01T09:00:00Z',
      endsAt: '2026-10-01T11:00:00Z',
    });
    expect((await publishEvent(ctx(editor), past.id)).status).toBe('published');
    expect(await publicList()).toEqual([]);
  });

  it('shows the branch name publicly only while that branch is Active', async () => {
    const editor = await actorFor('content_editor');
    const branch = await seedBranch(db, { name: 'Multan' });
    const created = await createEvent(ctx(editor), { ...camp, branchId: branch.id });
    await publishEvent(ctx(editor), created.id);
    expect((await publicList())[0]?.branchName).toBe('Multan');
    await db.query(`UPDATE branches SET status = 'paused' WHERE id = $1`, [branch.id]);
    expect((await publicList())[0]?.branchName).toBeNull();
    // the editor still sees the draft branch name
    expect((await getEvent(db, editor, created.id)).branchName).toBe('Multan');
  });
});

describe('updateEvent', () => {
  it('changes only the draft copy of a published event until it is published again', async () => {
    const editor = await actorFor('content_editor');
    const created = await createEvent(ctx(editor), camp);
    await publishEvent(ctx(editor), created.id);

    const edited = await updateEvent(ctx(editor), created.id, {
      titleEn: 'Health camp (moved)',
      summaryEn: 'New summary text',
      location: 'Main hall',
      startsAt: '2026-11-16T09:00:00Z',
      endsAt: '2026-11-16T11:00:00Z',
    });
    expect(edited).toMatchObject({
      status: 'published',
      titleEn: 'Health camp (moved)',
      location: 'Main hall',
      startsAt: '2026-11-16T09:00:00.000Z',
      hasUnpublishedChanges: true,
    });
    expect(await publicList()).toEqual([
      expect.objectContaining({
        title: 'Health camp',
        location: 'Community hall',
        startsAt: '2026-11-15T09:00:00.000Z',
      }),
    ]);

    const audits = await auditRows('event.update');
    expect(audits).toHaveLength(1);
    expect(audits[0]!.before).toEqual({
      starts_at: '2026-11-15T09:00:00.000Z',
      ends_at: '2026-11-15T11:00:00.000Z',
      location: 'Community hall',
      title_en: 'Health camp',
    });
    expect(audits[0]!.after).toEqual({
      starts_at: '2026-11-16T09:00:00.000Z',
      ends_at: '2026-11-16T11:00:00.000Z',
      location: 'Main hall',
      title_en: 'Health camp (moved)',
    });
    expect(JSON.stringify(audits)).not.toContain('New summary text');

    const republished = await publishEvent(ctx(editor), created.id);
    expect(republished.hasUnpublishedChanges).toBe(false);
    expect(await publicList()).toEqual([
      expect.objectContaining({
        title: 'Health camp (moved)',
        summary: 'New summary text',
        location: 'Main hall',
        startsAt: '2026-11-16T09:00:00.000Z',
      }),
    ]);
  });

  it('flags unpublished changes for any draft column, including a cleared one', async () => {
    const editor = await actorFor('content_editor');
    const created = await createEvent(ctx(editor), camp);
    await publishEvent(ctx(editor), created.id);
    expect(
      (await updateEvent(ctx(editor), created.id, { summaryUr: null })).hasUnpublishedChanges,
    ).toBe(true);
    expect(
      (await updateEvent(ctx(editor), created.id, { summaryUr: 'مفت معائنہ' }))
        .hasUnpublishedChanges,
    ).toBe(false);
  });

  it('never flags a never-published draft as having unpublished changes', async () => {
    const editor = await actorFor('content_editor');
    const created = await createEvent(ctx(editor), camp);
    const edited = await updateEvent(ctx(editor), created.id, { titleEn: 'Renamed' });
    expect(edited).toMatchObject({ status: 'draft', hasUnpublishedChanges: false });
  });

  it('rejects an unknown branch without writing', async () => {
    const editor = await actorFor('content_editor');
    const created = await createEvent(ctx(editor), camp);
    const error = await updateEvent(ctx(editor), created.id, { branchId: randomUUID() }).catch(
      (err: unknown) => err,
    );
    expect((error as ValidationFailed).details).toEqual({
      fields: [{ path: 'branchId', code: 'invalid_branch', message: 'invalid_branch' }],
    });
    expect(await auditRows('event.update')).toHaveLength(0);
    expect((await eventRow(created.id)).branch_id).toBeNull();
  });
});

describe('single-date patches', () => {
  const stored = {
    titleEn: 'Pair',
    startsAt: '2026-11-15T09:00:00Z',
    endsAt: '2026-11-15T11:00:00Z',
  };
  const endsBeforeStart = {
    fields: [{ path: 'endsAt', code: 'ends_before_start', message: 'ends_before_start' }],
  };

  async function expectRejected(id: string, patch: Record<string, string | null>) {
    const editor = await actorFor('content_editor');
    const before = await eventRow(id);
    const error = await updateEvent(ctx(editor), id, patch).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ValidationFailed);
    expect((error as ValidationFailed).details).toEqual(endsBeforeStart);
    expect(await eventRow(id)).toEqual(before);
  }

  it('rejects a start moved past the stored end, and an end moved before the stored start', async () => {
    const editor = await actorFor('content_editor');
    const { id } = await createEvent(ctx(editor), stored);
    await expectRejected(id, { startsAt: '2026-11-15T12:00:00.000Z' });
    await expectRejected(id, { endsAt: '2026-11-15T08:00:00.000Z' });
    expect(await auditRows('event.update')).toHaveLength(0);
  });

  it('accepts single dates that keep the pair consistent', async () => {
    const editor = await actorFor('content_editor');
    const { id } = await createEvent(ctx(editor), stored);
    expect(await updateEvent(ctx(editor), id, { endsAt: null })).toMatchObject({
      startsAt: '2026-11-15T09:00:00.000Z',
      endsAt: null,
    });
    await updateEvent(ctx(editor), id, { endsAt: '2026-11-15T11:00:00Z' });
    expect(
      await updateEvent(ctx(editor), id, { startsAt: '2026-11-15T10:00:00.000Z' }),
    ).toMatchObject({ startsAt: '2026-11-15T10:00:00.000Z', endsAt: '2026-11-15T11:00:00.000Z' });
    expect(await auditRows('event.update')).toHaveLength(3);
  });

  it('accepts any single date when the other is not stored', async () => {
    const editor = await actorFor('content_editor');
    const noEnd = await createEvent(ctx(editor), { titleEn: 'No end', startsAt: stored.startsAt });
    expect(
      (await updateEvent(ctx(editor), noEnd.id, { startsAt: '2030-01-01T00:00:00Z' })).startsAt,
    ).toBe('2030-01-01T00:00:00.000Z');
    const noStart = await createEvent(ctx(editor), { titleEn: 'No start', endsAt: stored.endsAt });
    expect(
      (await updateEvent(ctx(editor), noStart.id, { endsAt: '2000-01-01T00:00:00Z' })).endsAt,
    ).toBe('2000-01-01T00:00:00.000Z');
  });

  it('judges a patch carrying both dates on the pair', async () => {
    const editor = await actorFor('content_editor');
    const { id } = await createEvent(ctx(editor), stored);
    const moved = await updateEvent(ctx(editor), id, {
      startsAt: '2026-11-20T12:00:00Z',
      endsAt: '2026-11-20T13:00:00Z',
    });
    expect(moved).toMatchObject({
      startsAt: '2026-11-20T12:00:00.000Z',
      endsAt: '2026-11-20T13:00:00.000Z',
    });
    await expect(
      updateEvent(ctx(editor), id, {
        startsAt: '2026-11-20T12:00:00Z',
        endsAt: '2026-11-20T11:00:00Z',
      }),
    ).rejects.toThrow();
    expect(await auditRows('event.update')).toHaveLength(1);
  });
});

describe('mapEventDbError', () => {
  it('turns a violation of events_ends_after_start into ValidationFailed on endsAt', async () => {
    const editor = await actorFor('content_editor');
    const { id } = await createEvent(ctx(editor), {
      titleEn: 'x',
      startsAt: '2026-11-15T09:00:00Z',
    });
    const dbError = await db
      .query(`UPDATE events SET ends_at = '2026-11-15T08:00:00Z' WHERE id = $1`, [id])
      .catch((err: unknown) => err);
    expect(dbError).toMatchObject({ code: '23514', constraint: 'events_ends_after_start' });

    for (const err of [dbError, { code: '23514', constraint: 'events_ends_after_start' }]) {
      const mapped = mapEventDbError(err);
      expect(mapped).toBeInstanceOf(ValidationFailed);
      expect((mapped as ValidationFailed).details).toEqual({
        fields: [{ path: 'endsAt', code: 'ends_before_start', message: 'ends_before_start' }],
      });
    }
  });

  it('returns every other error unchanged', () => {
    const other = { code: '23514', constraint: 'other' };
    const unique = { code: '23505', constraint: 'events_slug_key' };
    const plain = new Error('boom');
    expect(mapEventDbError(other)).toBe(other);
    expect(mapEventDbError(unique)).toBe(unique);
    expect(mapEventDbError(plain)).toBe(plain);
    expect(mapEventDbError(null)).toBeNull();
  });
});

describe('unpublishEvent', () => {
  it('removes the event from the public list at once and keeps both copies', async () => {
    const editor = await actorFor('content_editor');
    const created = await createEvent(ctx(editor), camp);
    await publishEvent(ctx(editor), created.id);
    expect(await publicList()).toHaveLength(1);

    const unpublished = await unpublishEvent(ctx(editor), created.id);
    expect(unpublished).toMatchObject({
      status: 'draft',
      titleEn: 'Health camp',
      location: 'Community hall',
      startsAt: '2026-11-15T09:00:00.000Z',
      hasUnpublishedChanges: false,
    });
    expect(await publicList()).toEqual([]);
    expect(await eventRow(created.id)).toMatchObject({
      status: 'draft',
      title_en: 'Health camp',
      published_title_en: 'Health camp',
    });

    const audits = await auditRows('event.unpublish');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      entity_type: 'event',
      entity_id: created.id,
      before: { status: 'published' },
      after: { status: 'draft' },
    });
  });

  it('refuses to unpublish a draft', async () => {
    const editor = await actorFor('content_editor');
    const created = await createEvent(ctx(editor), camp);
    const error = await unpublishEvent(ctx(editor), created.id).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Conflict);
    expect((error as Conflict).code).toBe('not_published');
    expect(await auditRows('event.unpublish')).toHaveLength(0);
  });
});

describe('unknown ids', () => {
  it('returns the same NotFound for missing and malformed ids from every function', async () => {
    const editor = await actorFor('content_editor');
    const bodies: unknown[] = [];
    for (const id of [randomUUID(), 'not-a-uuid', '']) {
      for (const call of [
        () => getEvent(db, editor, id),
        () => updateEvent(ctx(editor), id, { titleEn: 'x' }),
        () => publishEvent(ctx(editor), id),
        () => unpublishEvent(ctx(editor), id),
      ]) {
        const error = await call().catch((err: unknown) => err);
        expect(error).toBeInstanceOf(NotFound);
        bodies.push(mapError(error, 'req').body);
      }
    }
    for (const body of bodies) expect(body).toEqual(bodies[0]);
    expect(await auditRows()).toHaveLength(0);
  });
});

describe('listEvents', () => {
  it('orders by start, newest first, with undated drafts first', async () => {
    const editor = await actorFor('content_editor');
    const early = await createEvent(ctx(editor), {
      titleEn: 'Early',
      startsAt: '2026-11-02T09:00:00Z',
    });
    const undated = await createEvent(ctx(editor), { titleEn: 'Undated' });
    const late = await createEvent(ctx(editor), {
      titleEn: 'Late',
      startsAt: '2026-12-02T09:00:00Z',
    });
    await publishEvent(ctx(editor), early.id);
    const list = await listEvents(db, editor);
    expect(list.map((event) => event.id)).toEqual([undated.id, late.id, early.id]);
    expect(list[2]).toMatchObject({ status: 'published', titleEn: 'Early' });
  });
});

describe('listBranchOptionsForContent', () => {
  it('returns only Active branches as id and name, ordered by name ignoring case', async () => {
    await seedBranch(db, { name: 'Beta forming', status: 'forming' });
    const zeta = await seedBranch(db, { name: 'Zeta', status: 'active' });
    await seedBranch(db, { name: 'Gamma paused', status: 'paused' });
    await seedBranch(db, { name: 'Delta closed', status: 'closed' });
    const alpha = await seedBranch(db, { name: 'alpha', status: 'active' });

    for (const role of ['content_editor', 'super_admin'] as const) {
      const actor = await actorFor(role);
      expect(await listBranchOptionsForContent(db, actor)).toEqual([
        { id: alpha.id, name: 'alpha' },
        { id: zeta.id, name: 'Zeta' },
      ]);
    }
    for (const role of ['hr_lead', 'branch_lead', 'finance_reviewer'] as const) {
      const actor = await actorFor(role);
      await expect(listBranchOptionsForContent(db, actor)).rejects.toThrow(Forbidden);
    }
  });
});
