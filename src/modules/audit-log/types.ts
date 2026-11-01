import type { DateString } from '@/platform/time';

/** Parsed audit viewer query. Every field except `limit` is optional and already validated. */
export interface AuditQuery {
  from?: DateString;
  to?: DateString;
  actor?: string;
  action?: string;
  entity?: string;
  entityId?: string;
  branch?: string;
  before?: string;
  limit: number;
}

export interface AuditListItem {
  id: string;
  occurredAt: string;
  requestId: string | null;
  actorId: string | null;
  actorName: string | null;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  branchId: string | null;
  branchCode: string | null;
  reportId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface AuditPage {
  items: AuditListItem[];
  /** Pass as `before` to load the next (older) page; null when there is none. */
  nextBefore: string | null;
  /** True when the caller only sees finance entity types. */
  restricted: boolean;
}

export interface AuditFacets {
  actions: string[];
  entityTypes: string[];
  actors: { id: string; name: string; role: string }[];
  branches: { id: string; code: string; name: string }[];
  restricted: boolean;
}
