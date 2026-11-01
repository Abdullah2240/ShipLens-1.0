import { authorize, type Actor } from '@/platform/authz';
import type { Queryable } from '@/platform/db';
import { Unauthenticated } from '@/platform/errors';
import { diffSnapshots } from './diff';
import {
  findCollectionBranch,
  findReportBranch,
  selectAuditByCollection,
  selectAuditByReport,
  type AuditTimelineRow,
} from './repo';
import type { TimelineEntry } from './types';

function timelineScope(actor: Actor | null) {
  if (!actor) throw new Unauthenticated();
  return authorize(actor, 'audit.read_timeline');
}

const toEntry = ({ before, after, ...row }: AuditTimelineRow): TimelineEntry => ({
  id: row.id,
  occurredAt: row.occurredAt,
  action: row.action,
  actorName: row.actorName,
  actorRole: row.actorRole,
  entityType: row.entityType,
  entityId: row.entityId,
  changes: diffSnapshots(before, after),
  requestId: row.requestId,
});

/** Audit trail of a report and the collections inside it, oldest first. */
export async function getReportTimeline(
  db: Queryable,
  actor: Actor,
  reportId: string,
): Promise<TimelineEntry[]> {
  const scope = timelineScope(actor);
  await findReportBranch(db, scope, reportId);
  return (await selectAuditByReport(db, reportId)).map(toEntry);
}

/** Audit trail of one collection, oldest first. */
export async function getCollectionTimeline(
  db: Queryable,
  actor: Actor,
  collectionId: string,
): Promise<TimelineEntry[]> {
  const scope = timelineScope(actor);
  await findCollectionBranch(db, scope, collectionId);
  return (await selectAuditByCollection(db, collectionId)).map(toEntry);
}
