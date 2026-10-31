import type { z } from 'zod';
import { command } from '@/platform/audit/command';
import type { CommandContext } from '@/platform/audit/types';
import { authorize, type Actor, type Scope } from '@/platform/authz';
import type { Action } from '@/platform/authz/permissions';
import type { Queryable } from '@/platform/db';
import {
  Conflict,
  Forbidden,
  NotFound,
  Unauthenticated,
  ValidationFailed,
} from '@/platform/errors';
import {
  addDays,
  daysBetween,
  pktDate,
  pktWeekStart,
  type Clock,
  type DateString,
} from '@/platform/time';
import { collectionEditability, isLocked, lockState } from './lock';
import {
  countCollections,
  ensureDraftReport,
  insertCollection,
  lockBranchForShare,
  lockCollection,
  lockReportForShare,
  markVoided,
  selectCollectionById,
  selectCollections,
  selectCurrentWeek,
  updateCollectionFields,
  type CollectionFieldChanges,
} from './repo';
import { collectionInputSchema, collectionPatchSchema, voidInputSchema } from './schema';
import {
  ACCEPTING_BRANCH_STATUSES,
  OPEN_REPORT_STATUSES,
  type BranchStatus,
  type CollectionInput,
  type CollectionItem,
  type CollectionPage,
  type CollectionPatch,
  type CollectionQuery,
  type CollectionRecord,
  type CurrentWeek,
  type ReportStatus,
  type VoidInput,
} from './types';

/** Thrown inside a command when, after locking, there is nothing to write; never escapes. */
class NothingToWrite extends Error {}

function scopeFor(actor: Actor | null, action: Action): Scope {
  if (!actor) throw new Unauthenticated();
  return authorize(actor, action);
}

/** collection.create/amend/void are own-branch grants: the branch comes from the session. */
function ownBranch(scope: Scope): string {
  if (scope.kind !== 'branch') throw new Forbidden();
  return scope.branchId;
}

function fieldError(path: string, code: string): ValidationFailed {
  return new ValidationFailed([{ path, code, message: code }]);
}

/** Services re-validate their input so callers other than routes get the same rules. */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new ValidationFailed(
    result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.') || 'body',
      code: issue.message,
      message: issue.message,
    })),
  );
}

function withLock(record: CollectionRecord, today: DateString): CollectionItem {
  return {
    ...record,
    lock: lockState(record.collectedOn, today),
    editability: collectionEditability({
      status: record.status,
      reportStatus: record.reportStatus,
      branchStatus: record.branchStatus,
      collectedOn: record.collectedOn,
      today,
    }),
  };
}

function assertNotFuture(collectedOn: DateString, today: DateString): void {
  if (daysBetween(today, collectedOn) > 0) throw fieldError('collectedOn', 'future_date');
}

/**
 * Decides whether a change is allowed under the current statuses and returns whether it is
 * the audited returned-report exemption. Throws the matching 409 otherwise.
 */
function changeMode(state: {
  status: CollectionRecord['status'];
  reportStatus: ReportStatus;
  branchStatus: BranchStatus;
  collectedOn: DateString;
  today: DateString;
}): 'normal' | 'exempt' {
  switch (collectionEditability(state)) {
    case 'editable':
      return 'normal';
    case 'editable_exempt':
      return 'exempt';
    case 'voided':
      throw new Conflict('collection_voided');
    case 'branch_closed':
      throw new Conflict('branch_closed');
    case 'report_submitted':
    case 'report_approved':
      throw new Conflict('report_not_open');
    case 'locked':
      throw new Conflict('collection_locked');
  }
}

/** Locks the collection, then its report and branch, and returns them with fresh statuses. */
async function lockForChange(tx: Queryable, scope: Scope, id: string) {
  const record = await lockCollection(tx, scope, id);
  const reportStatus = await lockReportForShare(tx, record.reportId);
  const branchStatus = await lockBranchForShare(tx, record.branchId);
  if (!reportStatus || !branchStatus) throw new NotFound();
  return { record, reportStatus, branchStatus };
}

function changesFrom(record: CollectionRecord, patch: CollectionPatch): CollectionFieldChanges {
  const out: CollectionFieldChanges = {};
  if (patch.amount !== undefined && patch.amount !== record.amount) out.amount = patch.amount;
  if (patch.collectedOn !== undefined && patch.collectedOn !== record.collectedOn)
    out.collectedOn = patch.collectedOn;
  if (patch.purpose !== undefined && patch.purpose !== record.purpose) out.purpose = patch.purpose;
  if (patch.note !== undefined && (patch.note ?? null) !== record.note) out.note = patch.note;
  return out;
}

/** Checks a new date: same PKT week, not in the future, and inside the window unless exempt. */
function assertNewDate(
  record: CollectionRecord,
  collectedOn: DateString,
  today: DateString,
  mode: 'normal' | 'exempt',
): void {
  if (pktWeekStart(collectedOn) !== record.weekStart)
    throw fieldError('collectedOn', 'week_change_not_allowed');
  assertNotFuture(collectedOn, today);
  if (mode === 'normal' && isLocked(collectedOn, today))
    throw fieldError('collectedOn', 'outside_lock_window');
}

export async function listCollections(
  db: Queryable,
  actor: Actor,
  clock: Clock,
  q: CollectionQuery,
): Promise<CollectionPage> {
  const scope = scopeFor(actor, 'collection.read');
  const today = pktDate(clock.now());
  const [records, totals] = await Promise.all([
    selectCollections(db, scope, q),
    countCollections(db, scope, q),
  ]);
  return {
    items: records.map((record) => withLock(record, today)),
    total: totals.total,
    totalActiveAmount: totals.activeAmount,
  };
}

export async function getCollection(
  db: Queryable,
  actor: Actor,
  clock: Clock,
  id: string,
): Promise<CollectionItem> {
  const scope = scopeFor(actor, 'collection.read');
  return withLock(await selectCollectionById(db, scope, id), pktDate(clock.now()));
}

/** The Branch Lead's current PKT week. Reads only: never creates the draft. */
export async function getCurrentWeek(
  db: Queryable,
  actor: Actor,
  clock: Clock,
): Promise<CurrentWeek> {
  const branchId = ownBranch(scopeFor(actor, 'collection.create'));
  const today = pktDate(clock.now());
  const weekStart = pktWeekStart(today);
  const week = await selectCurrentWeek(db, branchId, weekStart);
  if (!week) throw new NotFound();
  return { weekStart, weekEnd: addDays(weekStart, 6), today, ...week };
}

export async function createCollection(
  ctx: CommandContext,
  input: CollectionInput,
): Promise<CollectionItem> {
  const scope = scopeFor(ctx.actor, 'collection.create');
  const branchId = ownBranch(scope);
  const value = parse(collectionInputSchema, input);
  const today = pktDate(ctx.clock.now());
  assertNotFuture(value.collectedOn, today);
  if (isLocked(value.collectedOn, today)) throw fieldError('collectedOn', 'outside_lock_window');
  const weekStart = pktWeekStart(value.collectedOn);

  return command(ctx, 'collection.create', async (tx, audit) => {
    const branchStatus = await lockBranchForShare(tx, branchId);
    if (!branchStatus) throw new NotFound();
    if (!(ACCEPTING_BRANCH_STATUSES as readonly BranchStatus[]).includes(branchStatus))
      throw new Conflict('branch_not_accepting');

    const report = await ensureDraftReport(tx, branchId, weekStart);
    if (report.created)
      audit({
        action: 'report.create_draft',
        entityType: 'report',
        entityId: report.id,
        branchId,
        reportId: report.id,
        after: { status: 'draft', week_start: weekStart },
      });
    if (!(OPEN_REPORT_STATUSES as readonly ReportStatus[]).includes(report.status))
      throw new Conflict('report_not_open');

    const id = await insertCollection(tx, {
      branchId,
      reportId: report.id,
      amount: value.amount,
      collectedOn: value.collectedOn,
      purpose: value.purpose,
      note: value.note ?? null,
      createdBy: ctx.actor!.userId,
    });
    audit({
      action: 'collection.create',
      entityType: 'collection',
      entityId: id,
      branchId,
      reportId: report.id,
      after: {
        amount: value.amount,
        collected_on: value.collectedOn,
        purpose: value.purpose,
        status: 'active',
        report_id: report.id,
      },
    });
    return withLock(await selectCollectionById(tx, scope, id), today);
  });
}

export async function amendCollection(
  ctx: CommandContext,
  id: string,
  patch: CollectionPatch,
): Promise<CollectionItem> {
  const scope = scopeFor(ctx.actor, 'collection.amend');
  ownBranch(scope);
  const today = pktDate(ctx.clock.now());
  // Missing and out-of-scope ids fail first, before any input or state check.
  const current = await selectCollectionById(ctx.pool, scope, id);
  const value = parse(collectionPatchSchema, patch);
  const expected = changeMode({ ...current, today });
  const early = changesFrom(current, value);
  if (Object.keys(early).length === 0) return withLock(current, today);
  if (early.collectedOn !== undefined) assertNewDate(current, early.collectedOn, today, expected);
  const name = expected === 'exempt' ? 'collection.amend_exempt' : 'collection.amend';

  try {
    return await command(ctx, name, async (tx, audit) => {
      // Statuses and the clock may have moved since the read above: decide again under locks.
      const { record, reportStatus, branchStatus } = await lockForChange(tx, scope, id);
      const mode = changeMode({ ...record, reportStatus, branchStatus, today });
      const changes = changesFrom(record, value);
      if (Object.keys(changes).length === 0) throw new NothingToWrite();
      if (changes.collectedOn !== undefined)
        assertNewDate(record, changes.collectedOn, today, mode);

      await updateCollectionFields(tx, id, changes);
      audit({
        action: mode === 'exempt' ? 'collection.amend_exempt' : 'collection.amend',
        entityType: 'collection',
        entityId: id,
        branchId: record.branchId,
        reportId: record.reportId,
        before: {
          amount: record.amount,
          collected_on: record.collectedOn,
          purpose: record.purpose,
        },
        // Note changes are recorded with no field values: note is not allowlisted.
        after: {
          amount: changes.amount,
          collected_on: changes.collectedOn,
          purpose: changes.purpose,
        },
      });
      return withLock(await selectCollectionById(tx, scope, id), today);
    });
  } catch (error) {
    if (error instanceof NothingToWrite)
      return withLock(await selectCollectionById(ctx.pool, scope, id), today);
    throw error;
  }
}

export async function voidCollection(
  ctx: CommandContext,
  id: string,
  input: VoidInput,
): Promise<CollectionItem> {
  const scope = scopeFor(ctx.actor, 'collection.void');
  ownBranch(scope);
  const now = ctx.clock.now();
  const today = pktDate(now);
  const current = await selectCollectionById(ctx.pool, scope, id);
  const { reason } = parse(voidInputSchema, input);
  const expected = changeMode({ ...current, today });
  const name = expected === 'exempt' ? 'collection.void_exempt' : 'collection.void';

  return command(ctx, name, async (tx, audit) => {
    const { record, reportStatus, branchStatus } = await lockForChange(tx, scope, id);
    const mode = changeMode({ ...record, reportStatus, branchStatus, today });
    await markVoided(tx, id, { reason, voidedAt: now, voidedBy: ctx.actor!.userId });
    audit({
      action: mode === 'exempt' ? 'collection.void_exempt' : 'collection.void',
      entityType: 'collection',
      entityId: id,
      branchId: record.branchId,
      reportId: record.reportId,
      before: { status: record.status },
      after: { status: 'voided', void_reason: reason },
    });
    return withLock(await selectCollectionById(tx, scope, id), today);
  });
}
