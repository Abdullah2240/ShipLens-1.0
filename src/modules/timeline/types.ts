export interface TimelineChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface TimelineEntry {
  id: string;
  occurredAt: string;
  action: string;
  actorName: string | null;
  actorRole: string;
  entityType: string;
  entityId: string;
  changes: TimelineChange[];
  requestId: string | null;
}
