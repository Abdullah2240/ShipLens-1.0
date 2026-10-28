import type { Pool } from 'pg';
import type { Actor } from '../authz/actor';
import type { Clock } from '../time';

export interface CommandContext {
  actor: Actor | null;
  requestId: string;
  clock: Clock;
  pool: Pool;
}

export interface AuditEventInput {
  action: string;
  entityType: string;
  entityId: string;
  branchId?: string | null;
  reportId?: string | null;
  before?: object | null;
  after?: object | null;
}

export interface AuditRow {
  id: string;
  occurred_at: Date;
  request_id: string | null;
  actor_id: string | null;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  branch_id: string | null;
  report_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}
