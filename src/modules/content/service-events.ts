import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { command } from '@/platform/audit/command';
import type { CommandContext } from '@/platform/audit/types';
import { authorize, type Actor } from '@/platform/authz';
import type { Queryable } from '@/platform/db';
import { Conflict, ValidationFailed, type FieldIssue } from '@/platform/errors';
import {
  endsBeforeStart,
  eventInputSchema,
  eventPatchSchema,
  type EventInputDraft,
  type EventPatchDraft,
} from './event-schema';
import type { BranchOption, EventView } from './event-types';
import {
  branchExists,
  insertEvent,
  publishEventRow,
  selectActiveBranchOptions,
  selectEventById,
  selectEvents,
  unpublishEventRow,
  updateEventRow,
  type EventDraftValues,
  type EventRow,
} from './repo-events';

const ENDS_BEFORE_START: FieldIssue = {
  path: 'endsAt',
  code: 'ends_before_start',
  message: 'ends_before_start',
};
const SLUG_ATTEMPTS = 5;

const iso = (value: Date | null) => value?.toISOString() ?? null;
const sameInstant = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

function hasUnpublishedChanges(row: EventRow): boolean {
  if (row.status !== 'published') return false;
  return (
    row.title_en !== row.published_title_en ||
    row.title_ur !== row.published_title_ur ||
    row.summary_en !== row.published_summary_en ||
    row.summary_ur !== row.published_summary_ur ||
    row.location !== row.published_location ||
    row.branch_id !== row.published_branch_id ||
    !sameInstant(row.starts_at, row.published_starts_at) ||
    !sameInstant(row.ends_at, row.published_ends_at)
  );
}

function toView(row: EventRow): EventView {
  return {
    id: row.id,
    slug: row.slug,
    titleEn: row.title_en,
    titleUr: row.title_ur,
    summaryEn: row.summary_en,
    summaryUr: row.summary_ur,
    location: row.location,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    branchId: row.branch_id,
    branchName: row.branch_name,
    status: row.status,
    hasUnpublishedChanges: hasUnpublishedChanges(row),
    publishedAt: iso(row.published_at),
    updatedAt: row.updated_at.toISOString(),
  };
}

// Audit snapshots use the event allowlist only; summaries and Urdu text are never recorded.
const draftSnapshot = (row: EventRow) => ({
  slug: row.slug,
  status: row.status,
  title_en: row.title_en,
  starts_at: row.starts_at,
  ends_at: row.ends_at,
  location: row.location,
  branch_id: row.branch_id,
});
const publicSnapshot = (row: EventRow) => ({
  slug: row.slug,
  status: row.status,
  title_en: row.published_title_en,
  starts_at: row.published_starts_at,
  ends_at: row.published_ends_at,
  location: row.published_location,
  branch_id: row.published_branch_id,
});

/** Maps the parsed camelCase fields that are present onto their draft columns. */
function draftValues(input: {
  titleEn?: string | null;
  titleUr?: string | null;
  summaryEn?: string | null;
  summaryUr?: string | null;
  location?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  branchId?: string | null;
}): EventDraftValues {
  return {
    title_en: input.titleEn,
    title_ur: input.titleUr,
    summary_en: input.summaryEn,
    summary_ur: input.summaryUr,
    location: input.location,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    branch_id: input.branchId,
  };
}

async function assertBranch(tx: PoolClient, branchId: string | null | undefined): Promise<void> {
  if (branchId && !(await branchExists(tx, branchId))) {
    throw new ValidationFailed([
      { path: 'branchId', code: 'invalid_branch', message: 'invalid_branch' },
    ]);
  }
}

const newSlug = () => `evt-${randomBytes(4).toString('hex')}`;

/**
 * Safety net for a concurrent change between the service's date check and the write:
 * the database constraint on the date pair becomes the same 422 the service would give.
 */
export function mapEventDbError(err: unknown): unknown {
  if (typeof err === 'object' && err !== null) {
    const { code, constraint } = err as { code?: unknown; constraint?: unknown };
    if (code === '23514' && constraint === 'events_ends_after_start') {
      return new ValidationFailed([ENDS_BEFORE_START]);
    }
  }
  return err;
}

export async function listEvents(db: Queryable, actor: Actor): Promise<EventView[]> {
  authorize(actor, 'content.read');
  return (await selectEvents(db)).map(toView);
}

export async function getEvent(db: Queryable, actor: Actor, id: string): Promise<EventView> {
  authorize(actor, 'content.read');
  return toView(await selectEventById(db, id));
}

/**
 * Active branches for the event editor's optional branch select. Branch names and ids are
 * not sensitive to the roles holding content.read, so the scope is not applied.
 */
export async function listBranchOptionsForContent(
  db: Queryable,
  actor: Actor,
): Promise<BranchOption[]> {
  authorize(actor, 'content.read');
  const rows = await selectActiveBranchOptions(db);
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

export async function createEvent(ctx: CommandContext, input: EventInputDraft): Promise<EventView> {
  authorize(ctx.actor!, 'content.edit');
  const parsed = eventInputSchema.parse(input);
  try {
    return await command(ctx, 'event.create', async (tx, audit) => {
      await assertBranch(tx, parsed.branchId);
      let id: string | null = null;
      for (let attempt = 0; attempt < SLUG_ATTEMPTS && !id; attempt++) {
        id = await insertEvent(tx, newSlug(), draftValues(parsed));
      }
      if (!id) throw new Error('Could not allocate a unique event slug');
      const created = await selectEventById(tx, id);
      audit({
        action: 'event.create',
        entityType: 'event',
        entityId: created.id,
        before: null,
        after: draftSnapshot(created),
      });
      return toView(created);
    });
  } catch (err) {
    throw mapEventDbError(err);
  }
}

/**
 * Edits the draft copy only. A key present in the patch (even null) replaces the stored
 * value; an absent key keeps it. The merged date pair is checked before any write.
 */
export async function updateEvent(
  ctx: CommandContext,
  id: string,
  patch: EventPatchDraft,
): Promise<EventView> {
  authorize(ctx.actor!, 'content.edit');
  const parsed = eventPatchSchema.parse(patch);
  try {
    return await command(ctx, 'event.update', async (tx, audit) => {
      const existing = await selectEventById(tx, id, { forUpdate: true });
      const startsAt = parsed.startsAt !== undefined ? parsed.startsAt : iso(existing.starts_at);
      const endsAt = parsed.endsAt !== undefined ? parsed.endsAt : iso(existing.ends_at);
      if (endsBeforeStart(startsAt, endsAt)) throw new ValidationFailed([ENDS_BEFORE_START]);
      await assertBranch(tx, parsed.branchId);
      await updateEventRow(tx, existing.id, draftValues(parsed));
      const updated = await selectEventById(tx, existing.id);
      audit({
        action: 'event.update',
        entityType: 'event',
        entityId: updated.id,
        before: draftSnapshot(existing),
        after: draftSnapshot(updated),
      });
      return toView(updated);
    });
  } catch (err) {
    throw mapEventDbError(err);
  }
}

export async function publishEvent(ctx: CommandContext, id: string): Promise<EventView> {
  authorize(ctx.actor!, 'content.publish');
  return command(ctx, 'event.publish', async (tx, audit) => {
    const existing = await selectEventById(tx, id, { forUpdate: true });
    const missing: FieldIssue[] = [];
    if (!existing.starts_at) {
      missing.push({
        path: 'startsAt',
        code: 'required_to_publish',
        message: 'required_to_publish',
      });
    }
    if (!existing.title_en?.trim()) {
      missing.push({
        path: 'titleEn',
        code: 'required_to_publish',
        message: 'required_to_publish',
      });
    }
    if (missing.length > 0) throw new ValidationFailed(missing);
    await publishEventRow(tx, existing.id);
    const published = await selectEventById(tx, existing.id);
    audit({
      action: 'event.publish',
      entityType: 'event',
      entityId: published.id,
      before: publicSnapshot(existing),
      after: publicSnapshot(published),
    });
    return toView(published);
  });
}

export async function unpublishEvent(ctx: CommandContext, id: string): Promise<EventView> {
  authorize(ctx.actor!, 'content.unpublish');
  return command(ctx, 'event.unpublish', async (tx, audit) => {
    const existing = await selectEventById(tx, id, { forUpdate: true });
    if (existing.status !== 'published') throw new Conflict('not_published');
    await unpublishEventRow(tx, existing.id);
    const unpublished = await selectEventById(tx, existing.id);
    audit({
      action: 'event.unpublish',
      entityType: 'event',
      entityId: unpublished.id,
      before: publicSnapshot(existing),
      after: publicSnapshot(unpublished),
    });
    return toView(unpublished);
  });
}
