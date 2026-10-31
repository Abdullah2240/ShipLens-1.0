import type { PoolClient } from 'pg';
import { command, MissingAuditError } from '@/platform/audit/command';
import type { CommandContext } from '@/platform/audit/types';
import { authorize, type Actor, type Scope } from '@/platform/authz';
import type { Action } from '@/platform/authz/permissions';
import type { ReportStatus } from '@/platform/config/constants';
import type { Queryable } from '@/platform/db';
import { Conflict, Unauthenticated, ValidationFailed } from '@/platform/errors';
import { compareMoney } from '@/platform/money';
import { addDays, pktDate, pktWeekStart } from '@/platform/time';
import type { z } from 'zod';
import {
  applyTransition,
  countReports,
  insertDraftIfMissing,
  insertReportEvent,
  liveTotals,
  lockReport,
  selectActiveBranchesMissingWeek,
  selectReportCollections,
  selectReportDetail,
  selectReportEvents,
  selectReports,
  selectReviewQueue,
  type LockedReport,
  type ReportRecord,
  type TransitionSet,
} from './repo';
import { returnInputSchema, submitInputSchema } from './schema';
import { REPORT_ACTION_PERMISSION, allowedActionsFor, nextReportStatus } from './transitions';
import type { ReportAction, ReportDetail, ReportListItem, ReportPage, ReportQuery } from './types';

const FROZEN_STATUSES: readonly ReportStatus[] = ['submitted', 'approved'];

function requireActor(actor: Actor | null): Actor {
  if (!actor) throw new Unauthenticated();
  return actor;
}

function scopeFor(actor: Actor | null, action: Action): Scope {
  return authorize(requireActor(actor), action);
}

/** Input validation inside the service, so pages and routes get the same 422. */
function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  throw new ValidationFailed(
    parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.') || 'body',
      code: issue.code,
      message: issue.message,
    })),
  );
}

function toListItem(record: ReportRecord): ReportListItem {
  const frozen = FROZEN_STATUSES.includes(record.status) && record.totalAmount !== null;
  return {
    id: record.id,
    branchId: record.branchId,
    branchCode: record.branchCode,
    branchName: record.branchName,
    branchStatus: record.branchStatus,
    weekStart: record.weekStart,
    weekEnd: addDays(record.weekStart, 6),
    status: record.status,
    amount: frozen ? record.totalAmount! : record.liveAmount,
    count: frozen ? (record.collectionCount ?? 0) : record.liveCount,
    amountIsFrozen: frozen,
    submittedAt: record.submittedAt,
    submittedByName: record.submittedByName,
    reviewedAt: record.reviewedAt,
    reviewedByName: record.reviewedByName,
    version: record.version,
  };
}

/**
 * Creates this PKT week's draft for every in-scope `active` branch that has none.
 * Idempotent and safe under concurrent calls; returns the number of drafts inserted.
 */
export async function ensureCurrentWeekDrafts(ctx: CommandContext): Promise<number> {
  const scope = scopeFor(ctx.actor, 'report.read');
  const weekStart = pktWeekStart(pktDate(ctx.clock.now()));
  const missing = await selectActiveBranchesMissingWeek(ctx.pool, scope, weekStart);
  if (missing.length === 0) return 0;
  try {
    return await command(ctx, 'report.create_draft', async (tx, audit) => {
      let inserted = 0;
      for (const branchId of missing) {
        const id = await insertDraftIfMissing(tx, branchId, weekStart);
        if (!id) continue;
        inserted += 1;
        audit({
          action: 'report.create_draft',
          entityType: 'report',
          entityId: id,
          branchId,
          reportId: id,
          after: { status: 'draft', week_start: weekStart },
        });
      }
      return inserted;
    });
  } catch (error) {
    // Another request inserted every missing draft first: nothing to write, nothing to audit.
    if (error instanceof MissingAuditError) return 0;
    throw error;
  }
}

export async function listReports(
  db: Queryable,
  actor: Actor,
  q: ReportQuery,
): Promise<ReportPage> {
  const scope = scopeFor(actor, 'report.read');
  const [records, total] = await Promise.all([
    selectReports(db, scope, q),
    countReports(db, scope, q),
  ]);
  return { items: records.map(toListItem), total };
}

export async function listReviewQueue(db: Queryable, actor: Actor): Promise<ReportListItem[]> {
  scopeFor(actor, 'report.approve');
  return (await selectReviewQueue(db)).map(toListItem);
}

export async function getReport(db: Queryable, actor: Actor, id: string): Promise<ReportDetail> {
  const record = await selectReportDetail(db, scopeFor(actor, 'report.read'), id);
  const [collections, events] = await Promise.all([
    selectReportCollections(db, record.id),
    selectReportEvents(db, record.id),
  ]);
  return {
    ...toListItem(record),
    returnReason: record.returnReason,
    liveAmount: record.liveAmount,
    liveCount: record.liveCount,
    frozenAmount: record.totalAmount,
    frozenCount: record.collectionCount,
    collections,
    events,
    allowedActions: allowedActionsFor(actor, record),
  };
}

interface TransitionPlan {
  set: Omit<TransitionSet, 'status'>;
  reason: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

/** Audit and command name: a submit from `returned` is a resubmission. */
function actionName(action: ReportAction, from: ReportStatus): string {
  return action === 'submit' && from === 'returned' ? 'report.resubmit' : `report.${action}`;
}

/**
 * One audited transition: lock the report under the scope, check the move and the
 * branch, run the action's own checks, then write the conditional update, one
 * report_events row and one audit event, in that order, in one transaction.
 */
async function transition(
  ctx: CommandContext,
  id: string,
  action: ReportAction,
  plan: (tx: PoolClient, report: LockedReport, actor: Actor) => Promise<TransitionPlan>,
): Promise<ReportDetail> {
  const actor = requireActor(ctx.actor);
  const scope = authorize(actor, REPORT_ACTION_PERMISSION[action]);
  // command() is named before the row is locked. Only submit has two names, so it reads
  // the status first; if the status moves to the other name before the lock, it conflicts.
  const name =
    action === 'submit'
      ? actionName(action, (await selectReportDetail(ctx.pool, scope, id)).status)
      : actionName(action, 'submitted');

  return command(ctx, name, async (tx, audit) => {
    const report = await lockReport(tx, scope, id);
    const move = nextReportStatus(report.status, action);
    if (!move || actionName(action, report.status) !== name)
      throw new Conflict('invalid_transition');
    if (report.branchStatus === 'closed') throw new Conflict('branch_closed');

    const p = await plan(tx, report, actor);
    const changed = await applyTransition(tx, scope, report.id, report.status, {
      ...p.set,
      status: move.to,
    });
    if (!changed) throw new Conflict('invalid_transition');

    await insertReportEvent(tx, {
      reportId: report.id,
      type: move.event,
      fromStatus: report.status,
      toStatus: move.to,
      actorId: actor.userId,
      reason: p.reason,
      occurredAt: ctx.clock.now(),
    });
    audit({
      action: name,
      entityType: 'report',
      entityId: report.id,
      branchId: report.branchId,
      reportId: report.id,
      before: { status: report.status, version: report.version, ...p.before },
      after: { status: move.to, version: changed.version, ...p.after },
    });
    return getReport(tx, actor, report.id);
  });
}

export async function submitReport(
  ctx: CommandContext,
  id: string,
  input: { confirmNil?: boolean },
): Promise<ReportDetail> {
  const { confirmNil } = parseInput(submitInputSchema, input);
  return transition(ctx, id, 'submit', async (tx, report, actor) => {
    const live = await liveTotals(tx, report.id);
    if (live.count === 0 && confirmNil !== true) {
      throw new ValidationFailed([
        {
          path: 'confirmNil',
          code: 'nil_confirmation_required',
          message: 'nil_confirmation_required',
        },
      ]);
    }
    return {
      set: {
        totalAmount: live.amount,
        collectionCount: live.count,
        submittedAt: ctx.clock.now(),
        submittedBy: actor.userId,
      },
      reason: null,
      before: { total_amount: report.totalAmount, collection_count: report.collectionCount },
      after: { total_amount: live.amount, collection_count: live.count },
    };
  });
}

export async function returnReport(
  ctx: CommandContext,
  id: string,
  input: { reason: string },
): Promise<ReportDetail> {
  const { reason } = parseInput(returnInputSchema, input);
  return transition(ctx, id, 'return', async (_tx, report, actor) => ({
    set: { returnReason: reason, reviewedAt: ctx.clock.now(), reviewedBy: actor.userId },
    reason,
    before: { return_reason: report.returnReason },
    after: { return_reason: reason },
  }));
}

export async function approveReport(ctx: CommandContext, id: string): Promise<ReportDetail> {
  return transition(ctx, id, 'approve', async (tx, report, actor) => {
    if (report.submittedBy === actor.userId) throw new Conflict('self_approval');
    const live = await liveTotals(tx, report.id);
    if (
      report.totalAmount === null ||
      compareMoney(report.totalAmount, live.amount) !== 0 ||
      report.collectionCount !== live.count
    ) {
      throw new Conflict('totals_mismatch');
    }
    return {
      set: { reviewedAt: ctx.clock.now(), reviewedBy: actor.userId },
      reason: null,
      before: {},
      after: {},
    };
  });
}
