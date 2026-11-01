// Links out of the audit viewer. Pure: no React, no database.
import { traceHref } from '@/modules/reporting/figures';
import type { AuditListItem, AuditQuery } from '../types';
import { AUDIT_LIMITS } from '../schema';

export const AUDIT_PATH = '/audit';

/** Query keys in their canonical URL order. */
export const AUDIT_QUERY_KEYS = [
  'from',
  'to',
  'actor',
  'action',
  'entity',
  'entityId',
  'branch',
  'before',
] as const;

export type AuditQueryKey = (typeof AUDIT_QUERY_KEYS)[number];

/**
 * Viewer URL (no locale prefix) for a set of filters. Empty values are left out and the
 * default page size never appears in the URL.
 */
export function auditHref(query: Partial<Pick<AuditQuery, AuditQueryKey | 'limit'>>): string {
  const params = new URLSearchParams();
  for (const key of AUDIT_QUERY_KEYS) {
    const value = query[key];
    if (value) params.set(key, value);
  }
  if (query.limit && query.limit !== AUDIT_LIMITS.defaultLimit) {
    params.set('limit', String(query.limit));
  }
  const search = params.toString();
  return search ? `${AUDIT_PATH}?${search}` : AUDIT_PATH;
}

/** The next (older) page: same filters, keyset cursor set. */
export function olderHref(query: AuditQuery, nextBefore: string | null): string | null {
  return nextBefore ? auditHref({ ...query, before: nextBefore }) : null;
}

/** True when the link for this event opens the drill-down rather than a viewer filter. */
export function isTraceLink(
  item: Pick<AuditListItem, 'entityType' | 'branchId' | 'reportId'>,
): boolean {
  return (
    (item.entityType === 'report' || item.entityType === 'collection') &&
    Boolean(item.branchId) &&
    (item.entityType === 'report' || Boolean(item.reportId))
  );
}

/**
 * Where an event's record lives. Reports and collections open their drill-down level
 * under "collected" (every non-voided record is in it; a voided collection may 404 there).
 * Everything else filters the viewer to that record.
 */
export function auditEntityHref(
  item: Pick<AuditListItem, 'entityType' | 'entityId' | 'branchId' | 'reportId'>,
): string {
  if (item.entityType === 'report' && item.branchId) {
    return traceHref('collected', { branchId: item.branchId, reportId: item.entityId }, {});
  }
  if (item.entityType === 'collection' && item.branchId && item.reportId) {
    return traceHref(
      'collected',
      { branchId: item.branchId, reportId: item.reportId, collectionId: item.entityId },
      {},
    );
  }
  return auditHref({ entity: item.entityType, entityId: item.entityId });
}
